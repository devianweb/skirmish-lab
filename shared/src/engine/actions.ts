import { cloneGameState } from '../gameState';
import {
  ActionLogEntry,
  DiceResolution,
  GameAction,
  GameState,
  RetaliationOutcome,
  Unit,
  Weapon,
} from '../gameTypes';
import { DiceSpec, DiceResult, Vector3 } from '../types';
import {
  advanceActivation,
  applyRoundEndMorale,
  endRound,
  getUnitsRequiringRoundMorale,
  isRoundComplete,
} from './activation';
import {
  CombatOutcome,
  extractAttackRolls,
  extractRetaliationRolls,
  getAttackDiceSpecs,
  resolveAttack,
  resolveTraumaRoll,
  TraumaOutcome,
} from './combat';
import {
  computePushBackPosition,
  findMoveBlocker,
  hasCoverAgainstAttack,
  hasLineOfSight,
} from './spatial';
import { getTraitValue, hasTrait } from '../rules/traits';

/**
 * Host-side action validation and application (Phase 5 basic actions).
 *
 * `validateAction` performs the full legality check; `getDiceSpecs` reports
 * the dice the action needs (null when none); `applyAction` validates again
 * and, when legal, returns the new state plus its log entry. All functions
 * are pure with respect to the input state — applyAction clones first.
 *
 * Phase 6 replaces/extends this with the full rules-engine validation
 * (line of sight, terrain, special rules); Phase 5 covers the basic flow.
 */

/** Distance between two points on the board plane (y ignored). */
export function boardDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Total length of a movement path (sum of segment lengths). */
export function pathLength(path: Vector3[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += boardDistance(path[i - 1], path[i]);
  }
  return total;
}

/** Engagement distance: how close a charging unit ends to its target. */
const ENGAGEMENT_DISTANCE = 1;
/** Melee is legal within this many board units of the target. */
const ENGAGEMENT_RANGE = 1.5;

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export interface ActionOutcome {
  ok: boolean;
  reason?: string;
  state?: GameState;
  logEntry?: ActionLogEntry;
}

interface PayloadWithUnitId {
  unitId: string;
}
interface PayloadWithAttacker {
  attackerId: string;
  targetId: string;
  weaponId?: string;
}

function getUnit(state: GameState, unitId: string): Unit | undefined {
  return state.units.find((u) => u.id === unitId);
}

function getWeapon(unit: Unit, weaponId: string): Weapon | undefined {
  return unit.weapons.find((w) => w.id === weaponId && w.isEquipped);
}

function isEnemyOf(state: GameState, unit: Unit, playerId: string): boolean {
  return unit.ownerId !== playerId;
}

function isEngaged(unit: Unit): boolean {
  return unit.status.includes('engaged');
}

/** The unit currently mid-activation, if any. */
export function getActiveUnit(state: GameState): Unit | undefined {
  const id = state.turnState.activeUnitId;
  return id ? getUnit(state, id) : undefined;
}

/**
 * Full Phase 5 validation: turn order, ownership, activation sequencing,
 * movement allowance, range, and engagement. Dice completeness is NOT
 * checked here (the host requests dice only after this passes).
 */
export function validateAction(state: GameState, action: GameAction): ValidationResult {
  if (state.status === 'game-over') {
    return { valid: false, reason: 'Game is over' };
  }
  if (action.actorId !== state.turnState.currentPlayerId) {
    return { valid: false, reason: 'Not your turn' };
  }
  if (state.status !== 'in-progress' && state.status !== 'setting-up') {
    return { valid: false, reason: `Game is ${state.status}` };
  }

  switch (action.type) {
    case 'activate-unit': {
      const { unitId } = action.payload as PayloadWithUnitId;
      if (state.turnState.activeUnitId) {
        return { valid: false, reason: 'Another unit is already activating' };
      }
      const unit = getUnit(state, unitId);
      if (!unit) return { valid: false, reason: 'Unknown unit' };
      if (unit.ownerId !== action.actorId) {
        return { valid: false, reason: 'Unit does not belong to acting player' };
      }
      if (unit.isDestroyed) return { valid: false, reason: 'Unit is destroyed' };
      if (unit.isActivated || state.turnState.unitsActivatedThisRound.includes(unitId)) {
        return { valid: false, reason: 'Unit already activated this round' };
      }
      if (unit.status.includes('routed')) {
        return { valid: false, reason: 'Unit is routed and cannot activate' };
      }
      return { valid: true };
    }

    case 'hold': {
      const { unitId } = action.payload as PayloadWithUnitId;
      const unit = getUnit(state, unitId);
      if (!unit) return { valid: false, reason: 'Unknown unit' };
      if (unit.ownerId !== action.actorId) {
        return { valid: false, reason: 'Unit does not belong to acting player' };
      }
      if (unit.isDestroyed) return { valid: false, reason: 'Unit is destroyed' };
      if (unit.status.includes('routed')) {
        return { valid: false, reason: 'Unit is routed and cannot activate' };
      }
      if (state.turnState.activeUnitId) {
        if (state.turnState.activeUnitId !== unitId) {
          return { valid: false, reason: 'Another unit is already activating' };
        }
        if (unit.hasMoved || unit.hasAttacked) {
          return { valid: false, reason: 'Unit has already acted and cannot hold' };
        }
        return { valid: true };
      }
      if (unit.isActivated || state.turnState.unitsActivatedThisRound.includes(unitId)) {
        return { valid: false, reason: 'Unit already activated this round' };
      }
      return { valid: true };
    }

    case 'move-unit': {
      const { unitId, path, finalPosition } = action.payload as {
        unitId: string;
        path: Vector3[];
        finalPosition?: Vector3;
      };
      const unit = requireActiveUnit(state, action.actorId, unitId);
      if ('reason' in unit) return unit;
      if (hasTrait(unit.result.specialRules, 'stationary')) {
        return { valid: false, reason: 'Stationary units cannot move or charge' };
      }
      if (isEngaged(unit.result)) {
        return { valid: false, reason: 'Engaged units cannot move away' };
      }
      if (!path || path.length === 0) {
        return { valid: false, reason: 'Move path is empty' };
      }
      if (boardDistance(path[0], unit.result.position) > 0.01) {
        return { valid: false, reason: 'Move path must start at unit position' };
      }
      const end = path[path.length - 1];
      if (finalPosition && boardDistance(end, finalPosition) > 0.01) {
        return { valid: false, reason: 'Final position does not match path end' };
      }
      const distance = pathLength(path);
      if (distance > unit.result.remainingMovement + 0.01) {
        return { valid: false, reason: 'Move exceeds remaining movement' };
      }
      for (const point of path) {
        if (!isWithinBoard(state, point)) {
          return { valid: false, reason: 'Move leaves the board' };
        }
      }
      const blocker = findMoveBlocker(state, unit.result, path);
      if (blocker.blocked) {
        return { valid: false, reason: blocker.reason };
      }
      return { valid: true };
    }

    case 'shoot': {
      const { attackerId, targetId, weaponId } = action.payload as PayloadWithAttacker;
      const attacker = requireActiveUnit(state, action.actorId, attackerId);
      if ('reason' in attacker) return attacker;
      if (attacker.result.hasAttacked) {
        return { valid: false, reason: 'Unit has already attacked this activation' };
      }
      const target = requireTarget(state, action.actorId, targetId);
      if ('reason' in target) return target;
      const weapon = getWeapon(attacker.result, weaponId ?? '');
      if (!weapon || weapon.profile.type !== 'ranged') {
        return { valid: false, reason: 'Unit has no such ranged weapon' };
      }
      if (isEngaged(attacker.result)) {
        return { valid: false, reason: 'Engaged units must fight instead of shooting' };
      }
      const distance = boardDistance(attacker.result.position, target.result.position);
      if (distance > weapon.profile.range + 0.01) {
        return { valid: false, reason: 'Target out of range' };
      }
      if (
        !hasTrait(weapon.profile.specialRules, 'lobbed') &&
        !hasLineOfSight(state, attacker.result, target.result)
      ) {
        return { valid: false, reason: 'No line of sight to target' };
      }
      return { valid: true };
    }

    case 'charge': {
      const { attackerId, targetId, path, weaponId } = action.payload as {
        attackerId: string;
        targetId: string;
        path: Vector3[];
        weaponId?: string;
      };
      const attacker = requireActiveUnit(state, action.actorId, attackerId);
      if ('reason' in attacker) return attacker;
      if (hasTrait(attacker.result.specialRules, 'stationary')) {
        return { valid: false, reason: 'Stationary units cannot move or charge' };
      }
      if (attacker.result.hasMoved || attacker.result.hasAttacked) {
        return { valid: false, reason: 'Unit has already moved or attacked this activation' };
      }
      const target = requireTarget(state, action.actorId, targetId);
      if ('reason' in target) return target;
      if (isEngaged(attacker.result)) {
        return { valid: false, reason: 'Already engaged — fight instead' };
      }
      if (!path || path.length === 0) {
        return { valid: false, reason: 'Charge path is empty' };
      }
      const fullPath =
        boardDistance(path[0], attacker.result.position) < 0.01
          ? path
          : [{ ...attacker.result.position }, ...path];
      const distance = pathLength(fullPath);
      if (distance > attacker.result.speed * 2 + 0.01) {
        return { valid: false, reason: 'Target out of charge range' };
      }
      if (!hasLineOfSight(state, attacker.result, target.result)) {
        return { valid: false, reason: 'No line of sight to target' };
      }
      const chargeBlocker = findMoveBlocker(state, attacker.result, fullPath, {
        ignoreUnitId: target.result.id,
      });
      if (chargeBlocker.blocked) {
        return { valid: false, reason: chargeBlocker.reason };
      }
      const end = path[path.length - 1];
      const distToEnd = boardDistance(end, target.result.position);
      if (distToEnd > 1.25) {
        return { valid: false, reason: 'Charge must end in engagement range' };
      }
      const weapon = weaponId
        ? attacker.result.weapons.find((w) => w.id === weaponId)
        : attacker.result.weapons.find((w) => w.isEquipped && w.profile.type === 'melee');
      if (!weapon || weapon.profile.type !== 'melee') {
        return { valid: false, reason: 'No equipped melee weapon for charge strike' };
      }
      return { valid: true };
    }

    case 'rush': {
      const { unitId, path, finalPosition } = action.payload as {
        unitId: string;
        path: Vector3[];
        finalPosition?: Vector3;
      };
      const actor = requireActiveUnit(state, action.actorId, unitId);
      if ('reason' in actor) return actor;
      const unit = actor.result;
      if (hasTrait(unit.specialRules, 'stationary')) {
        return { valid: false, reason: 'Stationary units cannot move or rush' };
      }
      if (unit.hasMoved || unit.hasAttacked) {
        return { valid: false, reason: 'Unit has already moved or attacked this activation' };
      }
      if (isEngaged(unit)) {
        return { valid: false, reason: 'Engaged units cannot rush' };
      }
      if (!path || path.length === 0) {
        return { valid: false, reason: 'Rush path is empty' };
      }
      const fullPath =
        boardDistance(path[0], unit.position) < 0.01
          ? path
          : [{ ...unit.position }, ...path];
      const dist = pathLength(fullPath);
      if (dist > unit.speed * 2 + 0.01) {
        return {
          valid: false,
          reason: `Rush distance exceeds double speed (${dist.toFixed(1)}" vs ${(unit.speed * 2).toFixed(1)}")`,
        };
      }
      const blocker = findMoveBlocker(state, unit, fullPath);
      if (blocker.blocked) {
        return { valid: false, reason: blocker.reason };
      }
      const end = path[path.length - 1];
      if (finalPosition && boardDistance(end, finalPosition) > 0.01) {
        return { valid: false, reason: 'Final position does not match path end' };
      }
      const wouldEngage = state.units.some(
        (u) =>
          !u.isDestroyed &&
          u.ownerId !== action.actorId &&
          boardDistance(end, u.position) <= ENGAGEMENT_RANGE
      );
      if (wouldEngage) {
        return {
          valid: false,
          reason: 'Rush cannot end in melee contact (use Charge instead)',
        };
      }
      return { valid: true };
    }

    case 'fight': {
      const { attackerId, targetId, weaponId } = action.payload as PayloadWithAttacker;
      const attacker = requireActiveUnit(state, action.actorId, attackerId);
      if ('reason' in attacker) return attacker;
      if (attacker.result.hasAttacked) {
        return { valid: false, reason: 'Unit has already attacked this activation' };
      }
      const target = requireTarget(state, action.actorId, targetId);
      if ('reason' in target) return target;
      if (!isEngaged(attacker.result)) {
        return { valid: false, reason: 'Unit is not engaged' };
      }
      const distance = boardDistance(attacker.result.position, target.result.position);
      if (distance > ENGAGEMENT_RANGE + 0.01) {
        return { valid: false, reason: 'Target not in engagement range' };
      }
      const weapon = getWeapon(attacker.result, weaponId ?? '');
      if (!weapon || weapon.profile.type !== 'melee') {
        return { valid: false, reason: 'Unit has no such melee weapon' };
      }
      return { valid: true };
    }

    case 'end-activation': {
      if (!state.turnState.activeUnitId) {
        return { valid: false, reason: 'No unit is activating' };
      }
      return { valid: true };
    }

    case 'end-round': {
      if (!isRoundComplete(state)) {
        return { valid: false, reason: 'Round is not complete' };
      }
      return { valid: true };
    }

    default:
      return { valid: false, reason: 'Unsupported action type' };
  }
}

/**
 * Dice the action needs from the signaling server. Returns null for actions
 * that need no dice. Call after validateAction passes.
 */
export function getDiceSpecs(state: GameState, action: GameAction): DiceSpec[] | null {
  if (action.type === 'end-round') {
    const moraleUnits = getUnitsRequiringRoundMorale(state);
    if (moraleUnits.length === 0) return null;
    const specs: DiceSpec[] = [{ count: moraleUnits.length, sides: 6, purpose: 'morale' }];
    const stoicCount = moraleUnits.filter((u) => hasTrait(u.specialRules, 'stoic')).length;
    if (stoicCount > 0) {
      specs.push({ count: stoicCount, sides: 6, purpose: 'stoic' });
    }
    return specs;
  }

  if (action.type !== 'shoot' && action.type !== 'fight' && action.type !== 'charge') return null;

  const payload = action.payload as { attackerId: string; targetId: string; weaponId?: string };
  const attacker = getUnit(state, payload.attackerId);
  const target = getUnit(state, payload.targetId);
  const weapon = attacker
    ? payload.weaponId
      ? getWeapon(attacker, payload.weaponId)
      : attacker.weapons.find((w) =>
          w.isEquipped && (action.type === 'shoot' ? w.profile.type === 'ranged' : w.profile.type === 'melee')
        )
    : undefined;
  if (!attacker || !weapon) return null;

  const attacks = weapon.profile.attacks;
  if (typeof attacks !== 'number' || !Number.isInteger(attacks) || attacks < 1) {
    return null;
  }

  const isMelee = action.type === 'fight' || action.type === 'charge';
  const distance = target ? boardDistance(attacker.position, target.position) : 12;
  const aliveModels = target
    ? Math.max(1, target.models.filter((m) => !m.isDestroyed).length)
    : 1;

  const specs = getAttackDiceSpecs(attacks, {
    attackerRules: attacker.specialRules,
    weaponRules: weapon.profile.specialRules,
    defenderRules: target?.specialRules ?? [],
    defenderModelCount: aliveModels,
    isMelee,
    isCharging: action.type === 'charge' || (isMelee && attacker.hasMoved),
    distance,
    includeTrauma: true,
  });

  // For Charge: if the defending target has an equipped melee weapon, request
  // retaliation attack dice so the defender strikes back if they survive.
  if (action.type === 'charge' && target) {
    const defenderMelee = target.weapons.find((w) => w.isEquipped && w.profile.type === 'melee');
    if (defenderMelee && typeof defenderMelee.profile.attacks === 'number' && defenderMelee.profile.attacks > 0) {
      const isTargetFatigued = target.status.includes('fatigued') || target.status.includes('shaken');
      const retSpecs = getAttackDiceSpecs(defenderMelee.profile.attacks, {
        attackerRules: target.specialRules,
        weaponRules: defenderMelee.profile.specialRules,
        defenderRules: attacker.specialRules,
        defenderModelCount: Math.max(1, attacker.models?.filter((m) => !m.isDestroyed).length ?? 1),
        isMelee: true,
        isCharging: false,
        isFatigued: isTargetFatigued,
        distance: 1,
        includeTrauma: true,
      });
      for (const s of retSpecs) {
        specs.push({
          ...s,
          purpose: `retaliation-${s.purpose}`,
        });
      }
    }
  }

  return specs;
}

/**
 * Validate and apply an action, returning the new state and log entry.
 * `dice` must contain the server-rolled results for shoot/fight (the host
 * requests them via getDiceSpecs between validation and this call).
 */
export function applyAction(state: GameState, action: GameAction, dice?: DiceResult[]): ActionOutcome {
  const validation = validateAction(state, action);
  if (!validation.valid) {
    return { ok: false, reason: validation.reason };
  }

  const newState = cloneGameState(state);
  let logEntry: ActionLogEntry;
  let diceResolution: DiceResolution | undefined;

  switch (action.type) {
    case 'activate-unit': {
      const { unitId } = action.payload as PayloadWithUnitId;
      const unit = getUnit(newState, unitId)!;
      const wasSuppressed =
        unit.status.includes('stunned') || unit.status.includes('shaken');
      beginActivation(newState, unit);
      // A stunned/shaken unit spends its activation clearing suppression and
      // passes initiative immediately (cannot move or attack on this activation).
      if (wasSuppressed) {
        finishActivation(newState, dice);
      }
      logEntry = acceptedEntry(action);
      break;
    }

    case 'hold': {
      const { unitId } = action.payload as PayloadWithUnitId;
      const unit = getUnit(newState, unitId)!;
      if (!newState.turnState.activeUnitId) {
        beginActivation(newState, unit);
      }
      // A hold ends the unit's activation immediately without moving or acting.
      finishActivation(newState, dice);
      logEntry = acceptedEntry(action);
      break;
    }

    case 'move-unit': {
      const { unitId, path, finalPosition } = action.payload as {
        unitId: string;
        path: Vector3[];
        finalPosition?: Vector3;
      };
      const unit = getUnit(newState, unitId)!;
      const distance = pathLength(path);
      if (path.length >= 2) {
        const lastStep = path[path.length - 1];
        const prevStep = path[path.length - 2];
        const dx = lastStep.x - prevStep.x;
        const dz = lastStep.z - prevStep.z;
        if (Math.hypot(dx, dz) > 1e-4) {
          unit.rotation = { ...unit.rotation, y: Math.atan2(dx, dz) };
        }
      }
      unit.position = finalPosition ? { ...finalPosition } : { ...path[path.length - 1] };
      unit.hasMoved = true;
      unit.remainingMovement = round2(unit.remainingMovement - distance);
      logEntry = acceptedEntry(action);
      break;
    }

    case 'shoot':
    case 'fight': {
      const { attackerId, targetId, weaponId } = action.payload as PayloadWithAttacker;
      const attacker = getUnit(newState, attackerId)!;
      const target = getUnit(newState, targetId)!;
      const weapon = getWeapon(attacker, weaponId ?? '')!;
      const isMelee = action.type === 'fight';
      const distance = boardDistance(attacker.position, target.position);
      const isLobbed = hasTrait(weapon.profile.specialRules, 'lobbed');
      const inCover =
        !isMelee &&
        (target.status.includes('in-cover') ||
          (!isLobbed && hasCoverAgainstAttack(newState, attacker, target)));
      const aliveModels = Math.max(1, target.models.filter((m) => !m.isDestroyed).length);
      const isFatigued =
        isMelee && (attacker.status.includes('fatigued') || attacker.status.includes('shaken'));

      // Turn attacker to face the target
      const adx = target.position.x - attacker.position.x;
      const adz = target.position.z - attacker.position.z;
      if (Math.hypot(adx, adz) > 1e-4) {
        attacker.rotation = { ...attacker.rotation, y: Math.atan2(adx, adz) };
      }

      let outcome: CombatOutcome;
      let traumaRolls: number[] | undefined;
      try {
        if (!dice) throw new Error('Dice results required');
        const rolls = extractAttackRolls(dice);
        traumaRolls = rolls.trauma;
        outcome = resolveAttack(
          {
            quality: attacker.quality,
            specialRules: attacker.specialRules,
            weaponRules: weapon.profile.specialRules,
            isMelee,
            isCharging: isMelee && attacker.hasMoved,
            hasMoved: attacker.hasMoved,
            isFatigued,
            distance,
          },
          {
            defense: target.defense,
            inCover,
            specialRules: target.specialRules,
            modelCount: aliveModels,
            hasMoved: target.hasMoved,
          },
          weapon.profile.attacks as number,
          rolls
        );
      } catch (error) {
        return { ok: false, reason: (error as Error).message };
      }

      attacker.hasAttacked = true;
      if (hasTrait(weapon.profile.specialRules, 'expendable')) {
        weapon.isEquipped = false;
      }
      if (isMelee && !attacker.status.includes('fatigued')) {
        attacker.status.push('fatigued');
      }

      const dreadBonus = isMelee ? (getTraitValue(attacker.specialRules, 'dread') ?? 0) : 0;
      const lethalValue = getTraitValue(weapon.profile.specialRules, 'lethal') ?? 1;
      const trauma = applyWounds(
        target,
        outcome.wounds,
        traumaRolls,
        dreadBonus,
        lethalValue
      );
      refreshEngagements(newState);

      diceResolution = {
        rollId: action.id,
        specs: getDiceSpecs(state, action) ?? getAttackDiceSpecs(weapon.profile.attacks as number),
        results: dice,
        context: {
          attackerId,
          targetId,
          weaponId,
          actionId: action.id,
        },
        outcome: {
          attackCount: outcome.attackCount,
          hitCount: outcome.hitCount,
          ...(outcome.bonusHits > 0 ? { bonusHits: outcome.bonusHits } : {}),
          blockedCount: outcome.blockedCount,
          ...(outcome.wardSavedCount > 0 ? { wardSavedCount: outcome.wardSavedCount } : {}),
          wounds: outcome.wounds,
          targetDestroyed: target.isDestroyed,
          ...(trauma?.outcome === 'shaken' ? { targetShaken: true } : {}),
          effectiveQuality: outcome.effectiveQuality,
          effectiveDefense: outcome.effectiveDefense,
          baseQuality: outcome.baseQuality,
          hitModifiers: outcome.hitModifiers,
          baseDefense: outcome.baseDefense,
          defenseModifiers: outcome.defenseModifiers,
          ...(outcome.coverApplied ? { coverApplied: true } : {}),
          ...(outcome.apApplied > 0 ? { apApplied: outcome.apApplied } : {}),
          ...(trauma
            ? {
                traumaRoll: trauma.roll,
                traumaTokens: trauma.tokens,
                traumaDreadBonus: trauma.dreadBonus,
                traumaTotal: trauma.total,
                traumaOutcome: trauma.outcome,
              }
            : {}),
        },
      };
      logEntry = acceptedEntry(action, diceResolution);
      break;
    }

    case 'rush': {
      const { unitId, path } = action.payload as { unitId: string; path: Vector3[] };
      const unit = getUnit(newState, unitId)!;
      const end = path[path.length - 1];
      const dx = end.x - unit.position.x;
      const dz = end.z - unit.position.z;
      if (Math.hypot(dx, dz) > 1e-4) {
        unit.rotation = { ...unit.rotation, y: Math.atan2(dx, dz) };
      }
      unit.position = { ...end };
      unit.hasMoved = true;
      unit.hasAttacked = true;
      unit.remainingMovement = 0;
      refreshEngagements(newState);
      logEntry = acceptedEntry(action);
      break;
    }

    case 'charge': {
      const { attackerId, targetId, path, weaponId } = action.payload as {
        attackerId: string;
        targetId: string;
        path: Vector3[];
        weaponId?: string;
      };
      const attacker = getUnit(newState, attackerId)!;
      const target = getUnit(newState, targetId)!;
      attacker.position = { ...path[path.length - 1] };
      attacker.hasMoved = true;
      attacker.hasAttacked = true;
      attacker.remainingMovement = 0;
      const cdx = target.position.x - attacker.position.x;
      const cdz = target.position.z - attacker.position.z;
      if (Math.hypot(cdx, cdz) > 1e-4) {
        attacker.rotation = { ...attacker.rotation, y: Math.atan2(cdx, cdz) };
        target.rotation = { ...target.rotation, y: Math.atan2(-cdx, -cdz) };
      }
      if (!attacker.status.includes('engaged')) attacker.status.push('engaged');
      if (!target.status.includes('engaged')) target.status.push('engaged');

      const weapon = weaponId
        ? getWeapon(attacker, weaponId)
        : attacker.weapons.find((w) => w.isEquipped && w.profile.type === 'melee');

      if (weapon && dice) {
        const rolls = extractAttackRolls(dice);
        const aliveModels = target.models?.filter((m) => !m.isDestroyed).length ?? 1;
        const outcome = resolveAttack(
          {
            quality: attacker.quality,
            specialRules: attacker.specialRules,
            weaponRules: weapon.profile.specialRules,
            isMelee: true,
            isCharging: true,
            hasMoved: true,
            isFatigued: attacker.status.includes('fatigued') || attacker.status.includes('shaken'),
            distance: Math.hypot(cdx, cdz),
          },
          {
            defense: target.defense,
            inCover: false,
            specialRules: target.specialRules,
            hasMoved: target.hasMoved,
            modelCount: aliveModels,
          },
          weapon.profile.attacks as number,
          rolls
        );

        const dreadBonus = getTraitValue(attacker.specialRules, 'dread') ?? 0;
        const lethalValue = getTraitValue(weapon.profile.specialRules, 'lethal') ?? 1;
        const trauma = applyWounds(
          target,
          outcome.wounds,
          rolls.trauma,
          dreadBonus,
          lethalValue
        );

        if (!attacker.status.includes('fatigued')) {
          attacker.status.push('fatigued');
        }

        // 2. Defender Retaliation Strike (if defender survived)
        let retOutcome: RetaliationOutcome | undefined;
        const defenderMelee = target.weapons.find((w) => w.isEquipped && w.profile.type === 'melee');
        const retRolls = extractRetaliationRolls(dice);

        if (!target.isDestroyed && defenderMelee && retRolls) {
          const isTargetFatigued = target.status.includes('fatigued') || target.status.includes('shaken');
          const retAliveModels = attacker.models?.filter((m) => !m.isDestroyed).length ?? 1;
          const retCombat = resolveAttack(
            {
              quality: target.quality,
              specialRules: target.specialRules,
              weaponRules: defenderMelee.profile.specialRules,
              isMelee: true,
              isCharging: false,
              hasMoved: target.hasMoved,
              isFatigued: isTargetFatigued,
              distance: 1,
            },
            {
              defense: attacker.defense,
              inCover: false,
              specialRules: attacker.specialRules,
              hasMoved: attacker.hasMoved,
              modelCount: retAliveModels,
            },
            defenderMelee.profile.attacks as number,
            retRolls
          );

          const retDreadBonus = getTraitValue(target.specialRules, 'dread') ?? 0;
          const retLethalValue = getTraitValue(defenderMelee.profile.specialRules, 'lethal') ?? 1;
          const retTrauma = applyWounds(
            attacker,
            retCombat.wounds,
            retRolls.trauma,
            retDreadBonus,
            retLethalValue
          );

          retOutcome = {
            weaponId: defenderMelee.id,
            weaponName: defenderMelee.name,
            attackCount: retCombat.attackCount,
            hitCount: retCombat.hitCount,
            ...(retCombat.bonusHits > 0 ? { bonusHits: retCombat.bonusHits } : {}),
            blockedCount: retCombat.blockedCount,
            ...(retCombat.wardSavedCount > 0 ? { wardSavedCount: retCombat.wardSavedCount } : {}),
            wounds: retCombat.wounds,
            targetDestroyed: attacker.isDestroyed,
            targetShaken: attacker.status.includes('shaken'),
            baseQuality: target.quality,
            effectiveQuality: retCombat.effectiveQuality,
            hitModifiers: retCombat.hitModifiers,
            baseDefense: attacker.defense,
            effectiveDefense: retCombat.effectiveDefense,
            defenseModifiers: retCombat.defenseModifiers,
            ...(retTrauma
              ? {
                  traumaRoll: retTrauma.roll,
                  traumaTokens: retTrauma.tokens,
                  traumaDreadBonus: retTrauma.dreadBonus,
                  traumaTotal: retTrauma.total,
                  traumaOutcome: retTrauma.outcome,
                }
              : {}),
          };
        }

        if (!target.isDestroyed && !target.status.includes('fatigued')) {
          target.status.push('fatigued');
        }

        // 3. Separation / 1" Push-Back (if both units survived)
        let pushedBack = false;
        let pushBackPos: Vector3 | undefined;
        if (!attacker.isDestroyed && !target.isDestroyed) {
          pushBackPos = computePushBackPosition(newState, attacker, target, 2.0);
          attacker.position = { ...pushBackPos };
          pushedBack = true;
        }

        refreshEngagements(newState);

        diceResolution = {
          rollId: action.id,
          specs: getDiceSpecs(state, action) ?? getAttackDiceSpecs(weapon.profile.attacks as number),
          results: dice,
          context: {
            attackerId,
            targetId,
            weaponId: weapon.id,
            retaliationWeaponId: defenderMelee?.id,
            actionId: action.id,
          },
          outcome: {
            attackCount: outcome.attackCount,
            hitCount: outcome.hitCount,
            ...(outcome.bonusHits > 0 ? { bonusHits: outcome.bonusHits } : {}),
            blockedCount: outcome.blockedCount,
            ...(outcome.wardSavedCount > 0 ? { wardSavedCount: outcome.wardSavedCount } : {}),
            wounds: outcome.wounds,
            targetDestroyed: target.isDestroyed,
            targetShaken: target.status.includes('shaken'),
            baseQuality: attacker.quality,
            effectiveQuality: outcome.effectiveQuality,
            hitModifiers: outcome.hitModifiers,
            baseDefense: target.defense,
            effectiveDefense: outcome.effectiveDefense,
            defenseModifiers: outcome.defenseModifiers,
            coverApplied: false,
            ...(outcome.apApplied > 0 ? { apApplied: outcome.apApplied } : {}),
            ...(trauma
              ? {
                  traumaRoll: trauma.roll,
                  traumaTokens: trauma.tokens,
                  traumaDreadBonus: trauma.dreadBonus,
                  traumaTotal: trauma.total,
                  traumaOutcome: trauma.outcome,
                }
              : {}),
            retaliation: retOutcome,
            pushedBack,
            pushBackPosition: pushBackPos,
          },
        };
        logEntry = acceptedEntry(action, diceResolution);
      } else {
        logEntry = acceptedEntry(action);
      }
      break;
    }

    case 'end-activation': {
      finishActivation(newState, dice);
      logEntry = acceptedEntry(action);
      break;
    }

    case 'end-round': {
      runMoraleIfProvided(newState, dice);
      endRound(newState);
      logEntry = acceptedEntry(action);
      break;
    }

    default:
      return { ok: false, reason: 'Unsupported action type' };
  }

  checkGameEnd(newState);

  newState.lastActionId = action.id;
  newState.actionLog.push(logEntry);

  return { ok: true, state: newState, logEntry };
}

// --- internals ------------------------------------------------------------

type RequireResult = { result: Unit } | { valid: false; reason: string };

function requireActiveUnit(state: GameState, actorId: string, unitId: string): RequireResult {
  const unit = getUnit(state, unitId);
  if (!unit) return { valid: false, reason: 'Unknown unit' };
  if (unit.ownerId !== actorId) return { valid: false, reason: 'Unit does not belong to acting player' };
  if (unit.isDestroyed) return { valid: false, reason: 'Unit is destroyed' };
  if (state.turnState.activeUnitId !== unitId) {
    return { valid: false, reason: 'Unit is not the active unit' };
  }
  if (unit.status.includes('stunned') || unit.status.includes('routed')) {
    return { valid: false, reason: 'Unit is stunned or routed and cannot act' };
  }
  return { result: unit };
}

function requireTarget(state: GameState, actorId: string, targetId: string): RequireResult {
  const target = getUnit(state, targetId);
  if (!target) return { valid: false, reason: 'Unknown target' };
  if (!isEnemyOf(state, target, actorId)) return { valid: false, reason: 'Target is not an enemy unit' };
  if (target.isDestroyed) return { valid: false, reason: 'Target is destroyed' };
  return { result: target };
}

function isWithinBoard(state: GameState, point: Vector3): boolean {
  const halfW = (state.board.width * state.board.gridSize) / 2;
  const halfH = (state.board.height * state.board.gridSize) / 2;
  return point.x >= -halfW && point.x <= halfW && point.z >= -halfH && point.z <= halfH;
}

/** Where a charging unit ends up: at engagement distance of its target. */
function engagementPosition(target: Unit, fromPosition: Vector3): Vector3 {
  const dx = fromPosition.x - target.position.x;
  const dz = fromPosition.z - target.position.z;
  const length = Math.hypot(dx, dz) || 1;
  return {
    x: round2(target.position.x + (dx / length) * ENGAGEMENT_DISTANCE),
    y: 0,
    z: round2(target.position.z + (dz / length) * ENGAGEMENT_DISTANCE),
  };
}

function beginActivation(state: GameState, unit: Unit): void {
  unit.isActivated = true;
  unit.status = unit.status.filter((s) => s !== 'stunned' && s !== 'shaken');
  state.turnState.unitsActivatedThisRound.push(unit.id);
  state.turnState.activeUnitId = unit.id;
  state.turnState.phase = 'activation';
}

function runMoraleIfProvided(state: GameState, dice?: DiceResult[]): void {
  if (!dice) return;
  const moraleRes = dice.find((d) => d.purpose === 'morale');
  if (!moraleRes || moraleRes.rolls.length === 0) return;
  const stoicRes = dice.find((d) => d.purpose === 'stoic');
  applyRoundEndMorale(state, moraleRes.rolls, stoicRes?.rolls ?? []);
}

function finishActivation(state: GameState, dice?: DiceResult[]): void {
  state.turnState.activeUnitId = null;
  if (isRoundComplete(state)) {
    runMoraleIfProvided(state, dice);
  }
  advanceActivation(state);
}

function applyWounds(
  unit: Unit,
  wounds: number,
  traumaRolls?: number[],
  dreadBonus: number = 0,
  lethalValue: number = 1
): TraumaOutcome | undefined {
  if (wounds <= 0) return undefined;

  let remainingWounds = wounds;

  // 1. Multi-model squad allocation: eliminate non-final models first.
  // Lethal(X) excess wounds from a single hit do not spill over across models.
  if (unit.models.length > 1) {
    const step = Math.max(1, lethalValue);
    while (remainingWounds > 0) {
      const alive = unit.models.filter((m) => !m.isDestroyed);
      if (alive.length <= 1) break;
      const victim = alive[0];
      const applied = Math.min(remainingWounds, Math.max(victim.wounds, step));
      victim.wounds = 0;
      victim.isDestroyed = true;
      unit.wounds = Math.max(1, unit.wounds - 1);
      remainingWounds -= applied;
    }
  }

  if (remainingWounds <= 0) return undefined;

  // 2. Final surviving model (or single-model unit): reduce HP toward Tough threshold.
  unit.wounds -= remainingWounds;
  const finalModel = unit.models.find((m) => !m.isDestroyed);
  if (finalModel) {
    finalModel.wounds -= remainingWounds;
  }

  // Still above 0 HP (e.g. Resilient(3) / Tough(3) with wounds remaining): no trauma roll yet.
  if (unit.wounds > 0) {
    return undefined;
  }

  // 3. Reached 0 HP threshold: resolve Trauma Table if server trauma roll is present.
  if (traumaRolls && traumaRolls.length > 0) {
    const overkill = Math.abs(unit.wounds);
    const totalTokens = (unit.traumaTokens ?? 0) + 1 + overkill;
    const trauma = resolveTraumaRoll(traumaRolls[0], totalTokens, dreadBonus);

    if (trauma.outcome === 'knocked-out') {
      unit.wounds = 0;
      unit.isDestroyed = true;
      unit.status = unit.status.filter((s) => s !== 'engaged');
      if (finalModel) {
        finalModel.wounds = 0;
        finalModel.isDestroyed = true;
      }
    } else {
      // Suppressed (Shaken): remains in play on final HP with accumulated trauma tokens.
      unit.wounds = 1;
      unit.traumaTokens = totalTokens;
      if (!unit.status.includes('shaken')) unit.status.push('shaken');
      if (!unit.status.includes('stunned')) unit.status.push('stunned');
      if (finalModel) {
        finalModel.wounds = 1;
        finalModel.isDestroyed = false;
      }
    }
    return trauma;
  }

  // Fallback when no trauma roll was supplied (e.g. legacy 2-spec test helpers).
  unit.wounds = 0;
  unit.isDestroyed = true;
  unit.status = unit.status.filter((s) => s !== 'engaged');
  if (finalModel) {
    finalModel.wounds = 0;
    finalModel.isDestroyed = true;
  }
  return undefined;
}

/**
 * Clear 'engaged' from any surviving unit that no longer has a living
 * enemy within engagement range (e.g. after its melee opponent is destroyed).
 */
function refreshEngagements(state: GameState): void {
  for (const unit of state.units) {
    if (unit.isDestroyed || !unit.status.includes('engaged')) continue;
    const hasEnemyInRange = state.units.some(
      (other) =>
        !other.isDestroyed &&
        other.ownerId !== unit.ownerId &&
        boardDistance(unit.position, other.position) <= ENGAGEMENT_RANGE + 0.01
    );
    if (!hasEnemyInRange) {
      unit.status = unit.status.filter((s) => s !== 'engaged');
    }
  }
}

/**
 * Simple elimination win condition (v1 mission): the game ends when a
 * player has no living units; the other player wins. Mutual annihilation
 * ends the game without a winner.
 */
function checkGameEnd(state: GameState): void {
  if (state.status === 'game-over') return;
  const hostAlive = state.units.some((u) => u.ownerId === state.hostId && !u.isDestroyed);
  const guestAlive = state.units.some((u) => u.ownerId === state.guestId && !u.isDestroyed);
  if (hostAlive && guestAlive) return;

  state.status = 'game-over';
  state.turnState.phase = 'game-over';
  if (hostAlive) {
    state.winner = state.hostId;
    state.endReason = 'Opponent eliminated';
  } else if (guestAlive) {
    state.winner = state.guestId;
    state.endReason = 'Opponent eliminated';
  } else {
    state.endReason = 'Mutual elimination';
  }
}

function acceptedEntry(action: GameAction, dice?: DiceResolution): ActionLogEntry {
  return { action, result: 'accepted', dice, appliedAt: Date.now() };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
