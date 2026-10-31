import { cloneGameState } from '../gameState';
import {
  ActionLogEntry,
  DiceResolution,
  GameAction,
  GameState,
  Model,
  RetaliationOutcome,
  Unit,
  Weapon,
  WeaponAllocation,
  WeaponAttackOutcome,
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
  extractAllocationRolls,
  extractAttackRolls,
  extractRetaliationRolls,
  getAttackDiceSpecs,
  resolveAttack,
  resolveTraumaRoll,
  TraumaOutcome,
} from './combat';
import {
  computePushBackPosition,
  computeSquadCentroid,
  findMoveBlocker,
  hasCoverAgainstAttack,
  hasLineOfSight,
  validateSquadCoherency,
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
  targetId?: string;
  weaponId?: string;
  allocations?: WeaponAllocation[];
}

export function getShootAllocations(payload: PayloadWithAttacker): WeaponAllocation[] {
  if (payload.allocations && payload.allocations.length > 0) {
    return payload.allocations;
  }
  if (payload.weaponId && payload.targetId) {
    return [{ weaponId: payload.weaponId, targetId: payload.targetId }];
  }
  return [];
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
  if (state.turnState.pendingReaction) {
    if (action.type !== 'respond-reaction') {
      return { valid: false, reason: 'A reaction is pending — waiting for opponent' };
    }
    if (action.actorId !== state.turnState.pendingReaction.promptingPlayerId) {
      return { valid: false, reason: 'Not your reaction to respond to' };
    }
  } else {
    if (action.actorId !== state.turnState.currentPlayerId) {
      return { valid: false, reason: 'Not your turn' };
    }
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
      const { unitId, path, finalPosition, modelPositions } = action.payload as {
        unitId: string;
        path: Vector3[];
        finalPosition?: Vector3;
        modelPositions?: Vector3[];
      };
      const unit = requireActiveUnit(state, action.actorId, unitId);
      if ('reason' in unit) return unit;
      if (hasTrait(unit.result.specialRules, 'stationary')) {
        return { valid: false, reason: 'Stationary units cannot move or charge' };
      }
      if (unit.result.hasMoved || unit.result.hasAttacked) {
        return { valid: false, reason: 'Unit has already moved or attacked this activation' };
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
      const maxMove = Math.max(unit.result.speed, unit.result.remainingMovement);
      if (distance > maxMove + 0.01) {
        return { valid: false, reason: 'Move exceeds unit speed' };
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
      if (modelPositions && modelPositions.length > 0) {
        const activeCount = unit.result.models
          ? unit.result.models.filter((m) => !m.isDestroyed).length
          : 1;
        if (modelPositions.length !== activeCount && activeCount > 1) {
          return {
            valid: false,
            reason: `Model positions count mismatch (${modelPositions.length} vs ${activeCount} active models)`,
          };
        }
        const coherency = validateSquadCoherency(modelPositions);
        if (!coherency.coherent) {
          return { valid: false, reason: coherency.reason ?? 'Squad models lose coherency' };
        }
        for (const pos of modelPositions) {
          if (!isWithinBoard(state, pos)) {
            return { valid: false, reason: 'Squad model position leaves the board' };
          }
        }
      }
      return { valid: true };
    }

    case 'shoot': {
      const payload = action.payload as PayloadWithAttacker;
      const { attackerId } = payload;
      const attacker = requireActiveUnit(state, action.actorId, attackerId);
      if ('reason' in attacker) return attacker;
      if (attacker.result.hasAttacked) {
        return { valid: false, reason: 'Unit has already attacked this activation' };
      }
      if (isEngaged(attacker.result)) {
        return { valid: false, reason: 'Engaged units must fight instead of shooting' };
      }

      const allocations = getShootAllocations(payload);
      if (allocations.length === 0) {
        return { valid: false, reason: 'No weapon allocations specified for shooting' };
      }

      const weaponIds = new Set<string>();
      const targetIds = new Set<string>();

      for (const alloc of allocations) {
        if (weaponIds.has(alloc.weaponId)) {
          return { valid: false, reason: 'A weapon cannot be fired multiple times' };
        }
        weaponIds.add(alloc.weaponId);
        targetIds.add(alloc.targetId);

        const weapon = getWeapon(attacker.result, alloc.weaponId);
        if (!weapon || weapon.profile.type !== 'ranged') {
          return { valid: false, reason: `Unit has no such ranged weapon (${alloc.weaponId})` };
        }

        const target = requireTarget(state, action.actorId, alloc.targetId);
        if ('reason' in target) return target;

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
      }

      // Split fire constraint: maximum 2 distinct targets
      if (targetIds.size > 2) {
        return { valid: false, reason: 'Cannot split fire across more than 2 distinct targets' };
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
      const { unitId, path, finalPosition, modelPositions } = action.payload as {
        unitId: string;
        path: Vector3[];
        finalPosition?: Vector3;
        modelPositions?: Vector3[];
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
      if (modelPositions && modelPositions.length > 0) {
        const activeCount = unit.models
          ? unit.models.filter((m) => !m.isDestroyed).length
          : 1;
        if (modelPositions.length !== activeCount && activeCount > 1) {
          return {
            valid: false,
            reason: `Model positions count mismatch (${modelPositions.length} vs ${activeCount} active models)`,
          };
        }
        const coherency = validateSquadCoherency(modelPositions);
        if (!coherency.coherent) {
          return { valid: false, reason: coherency.reason ?? 'Squad models lose coherency' };
        }
        for (const pos of modelPositions) {
          if (!isWithinBoard(state, pos)) {
            return { valid: false, reason: 'Squad model position leaves the board' };
          }
        }
      }
      return { valid: true };
    }

    case 'fight': {
      const { attackerId, targetId, weaponId } = action.payload as {
        attackerId: string;
        targetId: string;
        weaponId: string;
      };
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

    case 'respond-reaction': {
      const { reactionId, choiceId } = action.payload as {
        reactionId: string;
        choiceId: string;
      };
      const pending = state.turnState.pendingReaction;
      if (!pending || pending.id !== reactionId) {
        return { valid: false, reason: 'No matching pending reaction' };
      }
      const option = pending.options.find((o) => o.id === choiceId);
      if (!option) {
        return { valid: false, reason: `Invalid reaction choice: ${choiceId}` };
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

  if (action.type === 'respond-reaction') {
    const { choiceId } = action.payload as { reactionId: string; choiceId: string };
    const pending = state.turnState.pendingReaction;
    if (!pending || choiceId !== 'strike-back') {
      return null;
    }
    const defender = getUnit(state, pending.targetUnitId);
    const charger = getUnit(state, pending.sourceUnitId);
    if (!defender || !charger) return null;
    const defenderMelee = pending.data?.weaponId
      ? getWeapon(defender, pending.data.weaponId)
      : defender.weapons.find((w) => w.isEquipped && w.profile.type === 'melee');
    if (!defenderMelee || typeof defenderMelee.profile.attacks !== 'number' || defenderMelee.profile.attacks < 1) {
      return null;
    }

    const isTargetFatigued = defender.status.includes('fatigued') || defender.status.includes('shaken');
    return getAttackDiceSpecs(defenderMelee.profile.attacks, {
      attackerRules: defender.specialRules,
      weaponRules: defenderMelee.profile.specialRules,
      defenderRules: charger.specialRules,
      defenderModelCount: Math.max(1, charger.models?.filter((m) => !m.isDestroyed).length ?? 1),
      isMelee: true,
      isCharging: false,
      isFatigued: isTargetFatigued,
      distance: 1,
      includeTrauma: true,
    });
  }

  if (action.type === 'shoot') {
    const payload = action.payload as PayloadWithAttacker;
    const attacker = getUnit(state, payload.attackerId);
    if (!attacker) return null;
    const allocations = getShootAllocations(payload);
    if (allocations.length === 0) return null;

    const isSingle = allocations.length === 1;
    const allSpecs: DiceSpec[] = [];

    allocations.forEach((alloc, index) => {
      const weapon = getWeapon(attacker, alloc.weaponId);
      const target = getUnit(state, alloc.targetId);
      if (!weapon || !target) return;
      const attacks = weapon.profile.attacks;
      if (typeof attacks !== 'number' || attacks < 1) return;

      const distance = boardDistance(attacker.position, target.position);
      const aliveModels = Math.max(1, target.models?.filter((m) => !m.isDestroyed).length ?? 1);
      const specs = getAttackDiceSpecs(attacks, {
        attackerRules: attacker.specialRules,
        weaponRules: weapon.profile.specialRules,
        defenderRules: target.specialRules ?? [],
        defenderModelCount: aliveModels,
        isMelee: false,
        isCharging: false,
        distance,
        includeTrauma: true,
      });

      if (isSingle) {
        allSpecs.push(...specs);
      } else {
        allSpecs.push(
          ...specs.map((s) => ({
            ...s,
            purpose: `alloc_${index}_${s.purpose}`,
          }))
        );
      }
    });

    return allSpecs.length > 0 ? allSpecs : null;
  }

  if (action.type !== 'fight' && action.type !== 'charge') return null;

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

  return getAttackDiceSpecs(attacks, {
    attackerRules: attacker.specialRules,
    weaponRules: weapon.profile.specialRules,
    defenderRules: target?.specialRules ?? [],
    defenderModelCount: aliveModels,
    isMelee,
    isCharging: action.type === 'charge' || (isMelee && attacker.hasMoved),
    distance,
    includeTrauma: true,
  });
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
      const { unitId, path, finalPosition, modelPositions } = action.payload as {
        unitId: string;
        path: Vector3[];
        finalPosition?: Vector3;
        modelPositions?: Vector3[];
      };
      const unit = getUnit(newState, unitId)!;
      if (path.length >= 2) {
        const lastStep = path[path.length - 1];
        const prevStep = path[path.length - 2];
        const dx = lastStep.x - prevStep.x;
        const dz = lastStep.z - prevStep.z;
        if (Math.hypot(dx, dz) > 1e-4) {
          unit.rotation = { ...unit.rotation, y: Math.atan2(dx, dz) };
        }
      }
      const targetPos = finalPosition ? { ...finalPosition } : { ...path[path.length - 1] };
      const deltaX = targetPos.x - unit.position.x;
      const deltaZ = targetPos.z - unit.position.z;

      if (modelPositions && modelPositions.length > 0) {
        const activeModels = unit.models ? unit.models.filter((m) => !m.isDestroyed) : [];
        for (let i = 0; i < activeModels.length && i < modelPositions.length; i++) {
          activeModels[i].position = { ...modelPositions[i] };
        }
        unit.position = computeSquadCentroid(modelPositions);
      } else if (unit.models && unit.models.length > 0) {
        for (const m of unit.models) {
          if (!m.isDestroyed) {
            if (m.position) {
              m.position = {
                x: Math.round((m.position.x + deltaX) * 100) / 100,
                y: targetPos.y ?? m.position.y ?? 0,
                z: Math.round((m.position.z + deltaZ) * 100) / 100,
              };
            } else {
              m.position = { ...targetPos };
            }
          }
        }
        unit.position = targetPos;
      } else {
        unit.position = targetPos;
      }

      unit.hasMoved = true;
      unit.remainingMovement = 0;
      logEntry = acceptedEntry(action);
      break;
    }

    case 'shoot': {
      const payload = action.payload as PayloadWithAttacker;
      const attacker = getUnit(newState, payload.attackerId)!;
      const allocations = getShootAllocations(payload);

      if (!dice) {
        return { ok: false, reason: 'Dice results required' };
      }

      const isSingle = allocations.length === 1;
      const allocationOutcomes: WeaponAttackOutcome[] = [];

      let totalAttackCount = 0;
      let totalHitCount = 0;
      let totalBonusHits = 0;
      let totalBlockedCount = 0;
      const allBlockedRolls: boolean[] = [];
      let totalWardSavedCount = 0;
      let totalWounds = 0;
      let primaryTargetDestroyed = false;
      let primaryTargetShaken = false;

      // Turn attacker to face the primary target
      const primaryTarget = getUnit(newState, allocations[0].targetId);
      if (primaryTarget) {
        const adx = primaryTarget.position.x - attacker.position.x;
        const adz = primaryTarget.position.z - attacker.position.z;
        if (Math.hypot(adx, adz) > 1e-4) {
          attacker.rotation = { ...attacker.rotation, y: Math.atan2(adx, adz) };
        }
      }

      for (let i = 0; i < allocations.length; i++) {
        const alloc = allocations[i];
        const weapon = getWeapon(attacker, alloc.weaponId)!;
        const target = getUnit(newState, alloc.targetId)!;
        const distance = boardDistance(attacker.position, target.position);
        const isLobbed = hasTrait(weapon.profile.specialRules, 'lobbed');
        const inCover =
          target.status.includes('in-cover') ||
          (!isLobbed && hasCoverAgainstAttack(newState, attacker, target));
        const aliveModels = Math.max(1, target.models.filter((m) => !m.isDestroyed).length);

        let outcome: CombatOutcome;
        let traumaRolls: number[] | undefined;
        try {
          const rolls = isSingle ? extractAttackRolls(dice) : extractAllocationRolls(dice, i);
          traumaRolls = rolls.trauma;
          outcome = resolveAttack(
            {
              quality: attacker.quality,
              specialRules: attacker.specialRules,
              weaponRules: weapon.profile.specialRules,
              isMelee: false,
              isCharging: false,
              hasMoved: attacker.hasMoved,
              isFatigued: false,
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

        if (hasTrait(weapon.profile.specialRules, 'expendable')) {
          weapon.isEquipped = false;
        }

        const lethalValue = getTraitValue(weapon.profile.specialRules, 'lethal') ?? 1;
        const trauma = applyWounds(target, outcome.wounds, traumaRolls, 0, lethalValue);

        totalAttackCount += outcome.attackCount;
        totalHitCount += outcome.hitCount;
        totalBonusHits += outcome.bonusHits;
        totalBlockedCount += outcome.blockedCount;
        allBlockedRolls.push(...outcome.blockedRolls);
        totalWardSavedCount += outcome.wardSavedCount;
        totalWounds += outcome.wounds;
        if (i === 0) {
          primaryTargetDestroyed = target.isDestroyed;
          primaryTargetShaken = target.status.includes('shaken');
        }

        allocationOutcomes.push({
          weaponId: weapon.id,
          weaponName: weapon.name,
          targetId: target.id,
          targetName: target.name,
          attackCount: outcome.attackCount,
          hitCount: outcome.hitCount,
          bonusHits: outcome.bonusHits,
          blockedCount: outcome.blockedCount,
          blockedRolls: outcome.blockedRolls,
          wardSavedCount: outcome.wardSavedCount,
          wounds: outcome.wounds,
          targetDestroyed: target.isDestroyed,
          targetShaken: target.status.includes('shaken'),
          effectiveQuality: outcome.effectiveQuality,
          effectiveDefense: outcome.effectiveDefense,
          baseQuality: outcome.baseQuality,
          hitModifiers: outcome.hitModifiers,
          baseDefense: outcome.baseDefense,
          defenseModifiers: outcome.defenseModifiers,
          coverApplied: outcome.coverApplied,
          apApplied: outcome.apApplied,
          ...(trauma
            ? {
                traumaRoll: trauma.roll,
                traumaTokens: trauma.tokens,
                traumaDreadBonus: trauma.dreadBonus,
                traumaTotal: trauma.total,
                traumaOutcome: trauma.outcome,
              }
            : {}),
        });
      }

      attacker.hasAttacked = true;
      refreshEngagements(newState);

      const firstAlloc = allocationOutcomes[0];
      diceResolution = {
        rollId: action.id,
        specs: getDiceSpecs(state, action) ?? [],
        results: dice,
        context: {
          attackerId: attacker.id,
          targetId: allocations[0].targetId,
          weaponId: allocations[0].weaponId,
          actionId: action.id,
        },
        outcome: {
          attackCount: totalAttackCount,
          hitCount: totalHitCount,
          bonusHits: totalBonusHits,
          blockedCount: totalBlockedCount,
          blockedRolls: allBlockedRolls,
          wardSavedCount: totalWardSavedCount,
          wounds: totalWounds,
          targetDestroyed: primaryTargetDestroyed,
          targetShaken: primaryTargetShaken,
          effectiveQuality: firstAlloc.effectiveQuality,
          effectiveDefense: firstAlloc.effectiveDefense,
          baseQuality: firstAlloc.baseQuality,
          hitModifiers: firstAlloc.hitModifiers,
          baseDefense: firstAlloc.baseDefense,
          defenseModifiers: firstAlloc.defenseModifiers,
          coverApplied: firstAlloc.coverApplied,
          apApplied: firstAlloc.apApplied,
          traumaRoll: firstAlloc.traumaRoll,
          traumaTokens: firstAlloc.traumaTokens,
          traumaDreadBonus: firstAlloc.traumaDreadBonus,
          traumaTotal: firstAlloc.traumaTotal,
          traumaOutcome: firstAlloc.traumaOutcome,
          allocations: allocationOutcomes,
        },
      };

      logEntry = acceptedEntry(action, diceResolution);
      break;
    }

    case 'fight': {
      const { attackerId, targetId, weaponId } = action.payload as {
        attackerId: string;
        targetId: string;
        weaponId: string;
      };
      const attacker = getUnit(newState, attackerId)!;
      const target = getUnit(newState, targetId)!;
      const weapon = getWeapon(attacker, weaponId ?? '')!;
      const isMelee = true;
      const distance = boardDistance(attacker.position, target.position);
      const aliveModels = Math.max(1, target.models.filter((m) => !m.isDestroyed).length);
      const isFatigued =
        attacker.status.includes('fatigued') || attacker.status.includes('shaken');

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
            inCover: false,
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
          blockedRolls: outcome.blockedRolls,
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
      const { unitId, path, finalPosition, modelPositions } = action.payload as {
        unitId: string;
        path: Vector3[];
        finalPosition?: Vector3;
        modelPositions?: Vector3[];
      };
      const unit = getUnit(newState, unitId)!;
      const end = finalPosition ? { ...finalPosition } : { ...path[path.length - 1] };
      const dx = end.x - unit.position.x;
      const dz = end.z - unit.position.z;
      if (Math.hypot(dx, dz) > 1e-4) {
        unit.rotation = { ...unit.rotation, y: Math.atan2(dx, dz) };
      }
      if (modelPositions && modelPositions.length > 0) {
        const activeModels = unit.models ? unit.models.filter((m) => !m.isDestroyed) : [];
        for (let i = 0; i < activeModels.length && i < modelPositions.length; i++) {
          activeModels[i].position = { ...modelPositions[i] };
        }
        unit.position = computeSquadCentroid(modelPositions);
      } else if (unit.models && unit.models.length > 0) {
        for (const m of unit.models) {
          if (!m.isDestroyed) {
            if (m.position) {
              m.position = {
                x: Math.round((m.position.x + dx) * 100) / 100,
                y: end.y ?? m.position.y ?? 0,
                z: Math.round((m.position.z + dz) * 100) / 100,
              };
            } else {
              m.position = { ...end };
            }
          }
        }
        unit.position = { ...end };
      } else {
        unit.position = { ...end };
      }
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
      const end = path[path.length - 1];
      const deltaX = end.x - attacker.position.x;
      const deltaZ = end.z - attacker.position.z;
      if (attacker.models && attacker.models.length > 0) {
        for (const m of attacker.models) {
          if (!m.isDestroyed) {
            if (m.position) {
              m.position = {
                x: Math.round((m.position.x + deltaX) * 100) / 100,
                y: end.y ?? m.position.y ?? 0,
                z: Math.round((m.position.z + deltaZ) * 100) / 100,
              };
            } else {
              m.position = { ...end };
            }
          }
        }
      }
      attacker.position = { ...end };
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

        const defenderMelee = target.weapons.find((w) => w.isEquipped && w.profile.type === 'melee');
        let pushedBack = false;
        let pushBackPos: Vector3 | undefined;

        if (target.isDestroyed) {
          refreshEngagements(newState);
        } else if (!defenderMelee) {
          pushBackPos = computePushBackPosition(newState, attacker, target, 2.0);
          attacker.position = { ...pushBackPos };
          pushedBack = true;
          attacker.status = attacker.status.filter((s) => s !== 'engaged');
          target.status = target.status.filter((s) => s !== 'engaged');
          refreshEngagements(newState);
        } else {
          // Defer retaliation strike to defender's choice via pendingReaction
          newState.turnState.pendingReaction = {
            id: `${action.id}-retaliation`,
            type: 'melee-retaliation',
            promptingPlayerId: target.ownerId,
            sourceUnitId: attacker.id,
            targetUnitId: target.id,
            title: 'Melee Retaliation',
            description: `${attacker.name} charged ${target.name}! Strike back with ${defenderMelee.name}?`,
            warning: target.status.includes('fatigued') || target.status.includes('shaken')
              ? 'This unit is already Fatigued/Shaken (hits on natural 6s only).'
              : 'Striking back will make this unit Fatigued (hits on natural 6s in melee for the rest of the round).',
            options: [
              {
                id: 'strike-back',
                label: `Strike Back (${defenderMelee.name})`,
                isDefault: true,
                style: 'primary',
              },
              {
                id: 'decline',
                label: 'Decline (Avoid Fatigue)',
                style: 'secondary',
              },
            ],
            expiresAt: Date.now() + 15000,
            durationMs: 15000,
            data: {
              chargeActionId: action.id,
              attackerId: attacker.id,
              targetId: target.id,
              weaponId: defenderMelee.id,
            },
          };
        }

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
          blockedRolls: outcome.blockedRolls,
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
            pushedBack,
            ...(pushBackPos ? { pushBackPosition: pushBackPos } : {}),
          },
        };
        logEntry = acceptedEntry(action, diceResolution);
      } else {
        logEntry = acceptedEntry(action);
      }
      break;
    }

    case 'respond-reaction': {
      const { reactionId, choiceId } = action.payload as {
        reactionId: string;
        choiceId: string;
      };
      const pending = newState.turnState.pendingReaction!;
      const defender = getUnit(newState, pending.targetUnitId)!;
      const charger = getUnit(newState, pending.sourceUnitId)!;
      const defenderMelee = pending.data?.weaponId
        ? getWeapon(defender, pending.data.weaponId)
        : defender.weapons.find((w) => w.isEquipped && w.profile.type === 'melee');

      let retCombat: ReturnType<typeof resolveAttack> | undefined;
      let trauma: ReturnType<typeof applyWounds> | undefined;

      if (choiceId === 'strike-back' && defenderMelee && dice) {
        // Turn defender to face the charger
        const rdx = charger.position.x - defender.position.x;
        const rdz = charger.position.z - defender.position.z;
        if (Math.hypot(rdx, rdz) > 1e-4) {
          defender.rotation = { ...defender.rotation, y: Math.atan2(rdx, rdz) };
        }

        const retRolls = extractAttackRolls(dice);
        const isTargetFatigued = defender.status.includes('fatigued') || defender.status.includes('shaken');
        const retAliveModels = charger.models?.filter((m) => !m.isDestroyed).length ?? 1;
        retCombat = resolveAttack(
          {
            quality: defender.quality,
            specialRules: defender.specialRules,
            weaponRules: defenderMelee.profile.specialRules,
            isMelee: true,
            isCharging: false,
            hasMoved: defender.hasMoved,
            isFatigued: isTargetFatigued,
            distance: 1,
          },
          {
            defense: charger.defense,
            inCover: false,
            specialRules: charger.specialRules,
            hasMoved: charger.hasMoved,
            modelCount: retAliveModels,
          },
          defenderMelee.profile.attacks as number,
          retRolls
        );

        const retDreadBonus = getTraitValue(defender.specialRules, 'dread') ?? 0;
        const retLethalValue = getTraitValue(defenderMelee.profile.specialRules, 'lethal') ?? 1;
        trauma = applyWounds(
          charger,
          retCombat.wounds,
          retRolls.trauma,
          retDreadBonus,
          retLethalValue
        );

        if (!defender.status.includes('fatigued')) {
          defender.status.push('fatigued');
        }
      }

      // Separation / 1" Push-Back (if both units survived)
      let pushedBack = false;
      let pushBackPos: Vector3 | undefined;
      if (!charger.isDestroyed && !defender.isDestroyed) {
        pushBackPos = computePushBackPosition(newState, charger, defender, 2.0);
        charger.position = { ...pushBackPos };
        pushedBack = true;
        charger.status = charger.status.filter((s) => s !== 'engaged');
        defender.status = defender.status.filter((s) => s !== 'engaged');
      }

      newState.turnState.pendingReaction = null;
      refreshEngagements(newState);

      let diceResolution: DiceResolution | undefined;
      if (retCombat && dice && defenderMelee) {
        diceResolution = {
          rollId: action.id,
          specs: getDiceSpecs(state, action) ?? getAttackDiceSpecs(defenderMelee.profile.attacks as number),
          results: dice,
          context: {
            attackerId: defender.id,
            targetId: charger.id,
            weaponId: defenderMelee.id,
            actionId: action.id,
          },
          outcome: {
            attackCount: retCombat.attackCount,
            hitCount: retCombat.hitCount,
            blockedCount: retCombat.blockedCount,
            blockedRolls: retCombat.blockedRolls,
            wounds: retCombat.wounds,
            targetDestroyed: charger.isDestroyed,
            targetShaken: charger.status.includes('shaken'),
            baseQuality: defender.quality,
            effectiveQuality: retCombat.effectiveQuality,
            hitModifiers: retCombat.hitModifiers,
            baseDefense: charger.defense,
            effectiveDefense: retCombat.effectiveDefense,
            defenseModifiers: retCombat.defenseModifiers,
            pushedBack,
            pushBackPosition: pushBackPos,
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
      } else if (pushedBack) {
        diceResolution = {
          rollId: action.id,
          specs: [],
          results: [],
          context: {
            attackerId: defender.id,
            targetId: charger.id,
            actionId: action.id,
          },
          outcome: {
            attackCount: 0,
            hitCount: 0,
            blockedCount: 0,
            wounds: 0,
            targetDestroyed: false,
            pushedBack: true,
            pushBackPosition: pushBackPos,
          },
        };
      }

      logEntry = acceptedEntry(action, diceResolution);
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

export function getUnitTough(unit: Unit, finalModel?: Model): number {
  return (
    getTraitValue(unit.specialRules, 'resilient') ??
    finalModel?.maxWounds ??
    (unit.models.length <= 1 ? unit.maxWounds : 1) ??
    1
  );
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

  // 2. Final surviving model (or single-model unit): accumulate wounds.
  const finalModel = unit.models.find((m) => !m.isDestroyed);
  const toughValue = getUnitTough(unit, finalModel);
  unit.traumaTokens = (unit.traumaTokens ?? 0) + remainingWounds;
  unit.wounds = Math.max(0, toughValue - unit.traumaTokens);
  if (finalModel) {
    finalModel.wounds = unit.wounds;
  }

  // Tough(X) rule (OPR v3.5.1):
  // "This model only rolls to check wound effects once it has taken X wounds or more,
  // and is only Knocked Out on rolls of 5+X or more."
  if (unit.traumaTokens < toughValue) {
    return undefined;
  }

  // 3. Reached Tough threshold: resolve Wound Effects if server trauma roll is present.
  const koThreshold = 5 + toughValue;
  if (traumaRolls && traumaRolls.length > 0) {
    const trauma = resolveTraumaRoll(traumaRolls[0], unit.traumaTokens, dreadBonus, koThreshold);

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
 * enemy within engagement range equipped with melee capability.
 */
function refreshEngagements(state: GameState): void {
  for (const unit of state.units) {
    if (unit.isDestroyed || !unit.status.includes('engaged')) continue;
    const hasEnemyInRange = state.units.some(
      (other) =>
        !other.isDestroyed &&
        other.ownerId !== unit.ownerId &&
        boardDistance(unit.position, other.position) <= ENGAGEMENT_RANGE + 0.01 &&
        (other.weapons.some((w) => w.isEquipped && w.profile.type === 'melee') ||
         unit.weapons.some((w) => w.isEquipped && w.profile.type === 'melee'))
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
