import { cloneGameState } from '../gameState';
import {
  ActionLogEntry,
  DiceResolution,
  GameAction,
  GameState,
  Unit,
  Weapon,
} from '../gameTypes';
import { DiceSpec, DiceResult, Vector3 } from '../types';
import { advanceActivation, endRound, isRoundComplete } from './activation';
import {
  CombatOutcome,
  extractAttackRolls,
  getAttackDiceSpecs,
  resolveAttack,
} from './combat';

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
      if (state.turnState.activeUnitId) {
        return { valid: false, reason: 'Another unit is already activating' };
      }
      const unit = getUnit(state, unitId);
      if (!unit) return { valid: false, reason: 'Unknown unit' };
      if (unit.ownerId !== action.actorId) {
        return { valid: false, reason: 'Unit does not belong to acting player' };
      }
      if (unit.isDestroyed) return { valid: false, reason: 'Unit is destroyed' };
      if (unit.isActivated) {
        return { valid: false, reason: 'Unit already activated this round' };
      }
      if (unit.status.includes('routed')) {
        return { valid: false, reason: 'Unit is routed and cannot activate' };
      }
      return { valid: true };
    }

    case 'move-unit': {
      const { unitId, path, finalPosition } = action.payload as {
        unitId: string;
        path: Vector3[];
        finalPosition: Vector3;
      };
      const unit = requireActiveUnit(state, action.actorId, unitId);
      if ('reason' in unit) return unit;
      if (isEngaged(unit.result)) {
        return { valid: false, reason: 'Engaged units cannot move away' };
      }
      if (!path || path.length === 0) {
        return { valid: false, reason: 'Move path is empty' };
      }
      const end = path[path.length - 1];
      if (boardDistance(end, finalPosition) > 0.01) {
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
      return { valid: true };
    }

    case 'shoot': {
      const { attackerId, targetId, weaponId } = action.payload as PayloadWithAttacker;
      const attacker = requireActiveUnit(state, action.actorId, attackerId);
      if ('reason' in attacker) return attacker;
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
      return { valid: true };
    }

    case 'charge': {
      const { attackerId, targetId, path } = action.payload as {
        attackerId: string;
        targetId: string;
        path: Vector3[];
      };
      const attacker = requireActiveUnit(state, action.actorId, attackerId);
      if ('reason' in attacker) return attacker;
      const target = requireTarget(state, action.actorId, targetId);
      if ('reason' in target) return target;
      if (isEngaged(attacker.result)) {
        return { valid: false, reason: 'Already engaged — fight instead' };
      }
      if (!path || path.length === 0) {
        return { valid: false, reason: 'Charge path is empty' };
      }
      const distance = pathLength([{ ...attacker.result.position }, ...path]);
      if (distance > attacker.result.speed + 0.01) {
        return { valid: false, reason: 'Target out of charge range' };
      }
      const engagementPos = engagementPosition(target.result, attacker.result.position);
      const end = path[path.length - 1];
      if (boardDistance(end, engagementPos) > 0.25) {
        return { valid: false, reason: 'Charge must end in engagement range' };
      }
      return { valid: true };
    }

    case 'fight': {
      const { attackerId, targetId, weaponId } = action.payload as PayloadWithAttacker;
      const attacker = requireActiveUnit(state, action.actorId, attackerId);
      if ('reason' in attacker) return attacker;
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
  if (action.type !== 'shoot' && action.type !== 'fight') return null;

  const payload = action.payload as PayloadWithAttacker;
  const attacker = getUnit(state, payload.attackerId);
  const weapon = attacker ? getWeapon(attacker, payload.weaponId ?? '') : undefined;
  if (!attacker || !weapon) return null;

  const attacks = weapon.profile.attacks;
  if (typeof attacks !== 'number' || !Number.isInteger(attacks) || attacks < 1) {
    // Dice-expression attacks ('D3' etc.) are rules-engine territory (Phase 6).
    return null;
  }
  return getAttackDiceSpecs(attacks);
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
      beginActivation(newState, unit);
      logEntry = acceptedEntry(action);
      break;
    }

    case 'hold': {
      const { unitId } = action.payload as PayloadWithUnitId;
      const unit = getUnit(newState, unitId)!;
      beginActivation(newState, unit);
      // A hold is a one-step activation: the unit does nothing and the
      // activation ends immediately.
      finishActivation(newState);
      logEntry = acceptedEntry(action);
      break;
    }

    case 'move-unit': {
      const { unitId, path, finalPosition } = action.payload as {
        unitId: string;
        path: Vector3[];
        finalPosition: Vector3;
      };
      const unit = getUnit(newState, unitId)!;
      const distance = pathLength(path);
      unit.position = { ...finalPosition };
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

      let outcome: CombatOutcome;
      try {
        if (!dice) throw new Error('Dice results required');
        const rolls = extractAttackRolls(dice);
        outcome = resolveAttack(
          { quality: attacker.quality },
          { defense: target.defense, inCover: target.status.includes('in-cover') },
          weapon.profile.attacks as number,
          rolls
        );
      } catch (error) {
        return { ok: false, reason: (error as Error).message };
      }

      applyWounds(target, outcome.wounds);

      diceResolution = {
        rollId: action.id,
        specs: getAttackDiceSpecs(weapon.profile.attacks as number),
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
          blockedCount: outcome.blockedCount,
          wounds: outcome.wounds,
          targetDestroyed: target.isDestroyed,
        },
      };
      logEntry = acceptedEntry(action, diceResolution);
      break;
    }

    case 'charge': {
      const { attackerId, targetId, path } = action.payload as {
        attackerId: string;
        targetId: string;
        path: Vector3[];
      };
      const attacker = getUnit(newState, attackerId)!;
      const target = getUnit(newState, targetId)!;
      attacker.position = { ...path[path.length - 1] };
      attacker.hasMoved = true;
      attacker.remainingMovement = 0;
      if (!attacker.status.includes('engaged')) attacker.status.push('engaged');
      if (!target.status.includes('engaged')) target.status.push('engaged');
      logEntry = acceptedEntry(action);
      break;
    }

    case 'end-activation': {
      finishActivation(newState);
      logEntry = acceptedEntry(action);
      break;
    }

    case 'end-round': {
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
  unit.status = unit.status.filter((s) => s !== 'stunned');
  state.turnState.unitsActivatedThisRound.push(unit.id);
  state.turnState.activeUnitId = unit.id;
  state.turnState.phase = 'activation';
}

function finishActivation(state: GameState): void {
  state.turnState.activeUnitId = null;
  advanceActivation(state);
}

function applyWounds(unit: Unit, wounds: number): void {
  unit.wounds -= wounds;
  if (unit.models.length > 0) {
    const model = unit.models.find((m) => !m.isDestroyed);
    if (model) {
      model.wounds -= wounds;
      if (model.wounds <= 0) model.isDestroyed = true;
    }
  }
  if (unit.wounds <= 0) {
    unit.wounds = 0;
    unit.isDestroyed = true;
    unit.status = unit.status.filter((s) => s !== 'engaged');
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
