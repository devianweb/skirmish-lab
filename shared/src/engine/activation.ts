import {
  GameState,
  MAX_ROUNDS,
  Objective,
  OBJECTIVE_CONTROL_MAX_VERTICAL,
  OBJECTIVE_CONTROL_RADIUS,
  Unit,
} from '../gameTypes';
import { Vector3 } from '../types';
import { hasTrait } from '../rules/traits';
import { MoraleTestOutcome, resolveMoraleTest } from './combat';
import { findTerrainAtPosition } from './spatial';

/**
 * Alternating-activation turn management (pure functions over GameState).
 *
 * Flow per round:
 *   1. The starting player activates one unit (activate-unit), acts with it
 *      (move / shoot / charge / fight), then ends the activation.
 *   2. The right to activate then passes to the other player.
 *   3. If one player has no unactivated units left, the other player
 *      activates their remaining units one after another.
 *   4. When every unit has activated, the round ends: activations reset and
 *      the new round starts with the other player as the starting player.
 *
 * A stunned unit may still be activated — spending the activation is what
 * clears the stun. Routed units cannot activate at all.
 */

/** Units a player may still activate this round: alive, not yet activated, not routed. */
export function getActivatableUnits(state: GameState, playerId: string): Unit[] {
  return state.units.filter(
    (u) => u.ownerId === playerId && !u.isDestroyed && !u.isActivated && !u.status.includes('routed')
  );
}

/** True when the player has at least one unit they may still activate. */
export function hasActivatableUnits(state: GameState, playerId: string): boolean {
  return getActivatableUnits(state, playerId).length > 0;
}

/** The opposing player's ID for the given player. */
export function getOpponentId(state: GameState, playerId: string): string {
  return playerId === state.hostId ? state.guestId : state.hostId;
}

/** True when every unit on both sides has activated this round. */
export function isRoundComplete(state: GameState): boolean {
  return !hasActivatableUnits(state, state.hostId) && !hasActivatableUnits(state, state.guestId);
}

/**
 * Pass the right to activate after the current player's activation ends:
 *   - opponent activates next if they still have units;
 *   - otherwise the current player keeps activating their remaining units;
 *   - if nobody has units left, the round ends and a new one begins.
 */
export function advanceActivation(state: GameState): void {
  const current = state.turnState.currentPlayerId;
  const opponent = getOpponentId(state, current);

  if (hasActivatableUnits(state, opponent)) {
    state.turnState.currentPlayerId = opponent;
  }
  // If the opponent is out, the current player simply keeps activating.
  // When both sides are out the round is over.

  if (isRoundComplete(state)) {
    endRound(state);
  }
}

/**
 * Evaluate objective control at the end of a round per OPR skirmish rules.
 *
 * Rules:
 *   1. 3" horizontal radius and 3" vertical cylinder bounds (|Δy| <= 3.0") around each marker.
 *   2. Only living, non-routed, non-shaken units can seize or contest objectives.
 *   3. If only friendly models are within 3", the friendly player controls it.
 *   4. If opposing models are simultaneously within 3", the objective becomes
 *      contested and reverts to neutral (controllingPlayerId = null, isContested = true).
 *   5. Persistent control: markers remain controlled if units move away, until an
 *      enemy seizes or contests them.
 */
export function isUnitInObjectiveRange(unit: Unit, obj: Objective): boolean {
  if (unit.isDestroyed || unit.status.includes('routed') || unit.status.includes('shaken')) {
    return false;
  }
  const objY = obj.position.y ?? 0;
  // If unit position is within range, it counts
  const uDist = Math.hypot(unit.position.x - obj.position.x, unit.position.z - obj.position.z);
  const uDelta = Math.abs((unit.position.y ?? 0) - objY);
  if (
    uDist <= OBJECTIVE_CONTROL_RADIUS + 0.001 &&
    uDelta <= OBJECTIVE_CONTROL_MAX_VERTICAL + 0.001
  ) {
    return true;
  }
  // Also check if any constituent model in a multi-model squad is within range
  if (unit.models && unit.models.length > 1) {
    const livingModels = unit.models.filter((m) => !m.isDestroyed);
    return livingModels.some((m) => {
      const pos = m.position ?? unit.position;
      const hDist = Math.hypot(pos.x - obj.position.x, pos.z - obj.position.z);
      const vDelta = Math.abs((pos.y ?? 0) - objY);
      return (
        hDist <= OBJECTIVE_CONTROL_RADIUS + 0.001 &&
        vDelta <= OBJECTIVE_CONTROL_MAX_VERTICAL + 0.001
      );
    });
  }
  return false;
}

export function evaluateObjectives(state: GameState): void {
  if (!state.objectives || state.objectives.length === 0) return;

  for (const obj of state.objectives) {
    const eligibleUnitsInRange = state.units.filter((unit) => isUnitInObjectiveRange(unit, obj));

    const hostPresent = eligibleUnitsInRange.some((u) => u.ownerId === state.hostId);
    const guestPresent = eligibleUnitsInRange.some((u) => u.ownerId === state.guestId);

    if (hostPresent && guestPresent) {
      obj.isContested = true;
      obj.controllingPlayerId = null;
    } else if (hostPresent) {
      obj.isContested = false;
      obj.controllingPlayerId = state.hostId;
    } else if (guestPresent) {
      obj.isContested = false;
      obj.controllingPlayerId = state.guestId;
    } else {
      // Nobody in range: persistent control maintains current control / contested state
    }
  }
}

/**
 * End-of-round cleanup: reset per-round unit flags, evaluate objective control,
 * and either conclude the match (after round 4) or start a new round.
 *
 * The player who finished activating all of their units first in the previous
 * round (i.e. the opponent of whichever player took the final activation of
 * the round, `currentPlayerId`) activates first in the new round.
 *
 * Match duration is exactly 4 rounds. When round 4 finishes, the game ends
 * and the player controlling the most objectives wins.
 */
export function endRound(state: GameState): void {
  if (state.status === 'game-over') return;

  // 1. Evaluate objective control at the end of the round
  evaluateObjectives(state);

  // 2. Conclude match after Round 4
  if (state.turnState.roundNumber >= MAX_ROUNDS) {
    state.status = 'game-over';
    state.turnState.phase = 'game-over';
    state.turnState.activeUnitId = null;

    const hostScore = (state.objectives ?? []).filter((o) => o.controllingPlayerId === state.hostId).length;
    const guestScore = (state.objectives ?? []).filter((o) => o.controllingPlayerId === state.guestId).length;

    if (hostScore > guestScore) {
      state.winner = state.hostId;
      state.endReason = `Objective victory (${hostScore} to ${guestScore})`;
    } else if (guestScore > hostScore) {
      state.winner = state.guestId;
      state.endReason = `Objective victory (${guestScore} to ${hostScore})`;
    } else {
      state.winner = undefined;
      state.endReason = `Match drawn (${hostScore} to ${guestScore} objectives)`;
    }
    return;
  }

  // 3. Advance to the next round
  const lastActivatingPlayer = state.turnState.currentPlayerId;
  state.turnState.roundNumber += 1;
  state.turnState.startingPlayerId = getOpponentId(state, lastActivatingPlayer);
  state.turnState.currentPlayerId = state.turnState.startingPlayerId;
  state.turnState.unitsActivatedThisRound = [];
  state.turnState.activeUnitId = null;

  for (const unit of state.units) {
    if (unit.isDestroyed) continue;
    unit.isActivated = false;
    unit.hasMoved = false;
    unit.hasAttacked = false;
    unit.remainingMovement = unit.speed;
    unit.status = unit.status.filter((s) => s !== 'fatigued');
  }
}

/**
 * True when `playerId`'s surviving non-routed units are at or below 50% of
 * their starting unit count (triggers Round-End Army Morale tests).
 */
export function isArmyBroken(state: GameState, playerId: string): boolean {
  const allUnits = state.units.filter((u) => u.ownerId === playerId);
  if (allUnits.length === 0) return false;
  const surviving = allUnits.filter(
    (u) => !u.isDestroyed && !u.status.includes('routed')
  );
  return surviving.length > 0 && surviving.length * 2 <= allUnits.length;
}

/**
 * Return all surviving units across both players that must take a Round-End
 * Morale test because their army is Broken (<= 50% starting units).
 */
export function getUnitsRequiringRoundMorale(state: GameState): Unit[] {
  const result: Unit[] = [];
  for (const playerId of [state.hostId, state.guestId]) {
    if (!isArmyBroken(state, playerId)) continue;
    for (const unit of state.units) {
      if (
        unit.ownerId === playerId &&
        !unit.isDestroyed &&
        !unit.status.includes('routed')
      ) {
        result.push(unit);
      }
    }
  }
  return result;
}

/**
 * Apply Round-End Morale tests to all units in broken armies using pre-rolled
 * server morale dice (`purpose: 'morale'`, plus optional `purpose: 'stoic'`).
 */
export function applyRoundEndMorale(
  state: GameState,
  moraleRolls: number[],
  stoicRolls: number[] = []
): Array<{ unitId: string; outcome: MoraleTestOutcome }> {
  const unitsToTest = getUnitsRequiringRoundMorale(state);
  const outcomes: Array<{ unitId: string; outcome: MoraleTestOutcome }> = [];
  let rollIdx = 0;
  let stoicIdx = 0;

  for (const unit of unitsToTest) {
    if (rollIdx >= moraleRolls.length) break;
    const roll = moraleRolls[rollIdx++];
    const alreadyShaken =
      unit.status.includes('shaken') || unit.status.includes('stunned');

    // Check for friendly Commander (Hero) within 12" who is not shaken/routed.
    const commanders = state.units.filter(
      (c) =>
        c.ownerId === unit.ownerId &&
        !c.isDestroyed &&
        !c.status.includes('shaken') &&
        !c.status.includes('stunned') &&
        !c.status.includes('routed') &&
        hasTrait(c.specialRules, 'commander') &&
        Math.hypot(c.position.x - unit.position.x, c.position.z - unit.position.z) <= 12.01
    );
    const commanderQuality =
      commanders.length > 0
        ? Math.min(...commanders.map((c) => c.quality))
        : undefined;

    const stoicRoll =
      hasTrait(unit.specialRules, 'stoic') && stoicIdx < stoicRolls.length
        ? stoicRolls[stoicIdx++]
        : undefined;

    const testOutcome = resolveMoraleTest({
      quality: unit.quality,
      roll,
      specialRules: unit.specialRules,
      alreadyShaken,
      commanderQuality,
      stoicRoll,
    });

    // Consume one-shot morale-debuff if present.
    if (hasTrait(unit.specialRules, 'morale-debuff')) {
      unit.specialRules = unit.specialRules.filter((r) => r !== 'morale-debuff');
    }

    if (testOutcome.outcome === 'shaken') {
      if (!unit.status.includes('shaken')) unit.status.push('shaken');
      if (!unit.status.includes('stunned')) unit.status.push('stunned');
    } else if (testOutcome.outcome === 'routed') {
      if (!unit.status.includes('routed')) unit.status.push('routed');
      unit.isDestroyed = true;
      unit.wounds = 0;
      unit.status = unit.status.filter((s) => s !== 'engaged');
    }

    outcomes.push({ unitId: unit.id, outcome: testOutcome });
  }

  return outcomes;
}

// ============================================================================
// Interactive Pre-Match Deployment Engine (Phase 10B)
// ============================================================================

export interface DeploymentZoneBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Calculates rectangular battlefield boundaries for a player's deployment zone.
 * Standard depth is 12". Vanguard units may deploy up to 12" ahead.
 */
export function getDeploymentZoneBounds(
  state: GameState,
  playerId: string,
  isVanguard: boolean = false
): DeploymentZoneBounds {
  const halfW = (state.board.width * state.board.gridSize) / 2;
  const halfH = (state.board.height * state.board.gridSize) / 2;
  const isHost = playerId === state.hostId;

  if (isHost) {
    // Host deployed at South edge (-halfH) facing +z
    const minZ = -halfH;
    const maxZ = isVanguard ? Math.min(0, -halfH + 24) : -halfH + 12;
    return { minX: -halfW, maxX: halfW, minZ, maxZ };
  } else {
    // Guest deployed at North edge (+halfH) facing -z
    const maxZ = halfH;
    const minZ = isVanguard ? Math.max(0, halfH - 24) : halfH - 12;
    return { minX: -halfW, maxX: halfW, minZ, maxZ };
  }
}

/**
 * Get undeployed units eligible for deployment for a player.
 * Enforces rule sequencing:
 * 1. Standard units deploy first.
 * 2. Vanguard units deploy after all standard units are deployed.
 * 3. Drop Reserve units cannot deploy during pre-match deployment (held for Round 2+).
 */
export function getDeployableUnits(state: GameState, playerId: string): Unit[] {
  const undeployed = state.units.filter(
    (u) => u.ownerId === playerId && !u.isDestroyed && u.isDeployed === false
  );

  // Filter out drop-reserve units (held for Round 2+)
  const eligible = undeployed.filter((u) => !hasTrait(u.specialRules, 'drop-reserve'));

  // Standard units must deploy before vanguard units
  const standard = eligible.filter((u) => !hasTrait(u.specialRules, 'vanguard'));
  if (standard.length > 0) {
    return standard;
  }
  return eligible;
}

/** True when the player still has units to place during the deployment phase. */
export function hasDeployableUnits(state: GameState, playerId: string): boolean {
  return getDeployableUnits(state, playerId).length > 0;
}

/** True when all deployable units for both players have been placed. */
export function isDeploymentComplete(state: GameState): boolean {
  return !hasDeployableUnits(state, state.hostId) && !hasDeployableUnits(state, state.guestId);
}

/**
 * Passes turn to opponent during deployment phase, or transitions to 'activation'
 * (Round 1) if all units are placed.
 */
export function advanceDeployment(state: GameState): void {
  const current = state.turnState.currentPlayerId;
  const opponent = getOpponentId(state, current);

  if (hasDeployableUnits(state, opponent)) {
    state.turnState.currentPlayerId = opponent;
  }

  if (isDeploymentComplete(state)) {
    state.turnState.phase = 'activation';
    state.turnState.roundNumber = 1;
    state.turnState.currentPlayerId = state.turnState.startingPlayerId;
  }
}

/**
 * Validates whether a unit may be legally deployed at `position`.
 */
export function validateDeploymentPosition(
  state: GameState,
  unit: Unit,
  position: Vector3
): { valid: boolean; reason?: string } {
  if (hasTrait(unit.specialRules, 'drop-reserve')) {
    return { valid: false, reason: 'Drop Reserve units cannot be deployed pre-match (held for Round 2+)' };
  }

  const eligibleUnits = getDeployableUnits(state, unit.ownerId);
  if (!eligibleUnits.some((u) => u.id === unit.id)) {
    return { valid: false, reason: 'Unit is not currently eligible for deployment (vanguard units deploy after standard units)' };
  }

  const isVanguard = hasTrait(unit.specialRules, 'vanguard');
  const bounds = getDeploymentZoneBounds(state, unit.ownerId, isVanguard);

  if (
    position.x < bounds.minX - 0.01 ||
    position.x > bounds.maxX + 0.01 ||
    position.z < bounds.minZ - 0.01 ||
    position.z > bounds.maxZ + 0.01
  ) {
    return {
      valid: false,
      reason: isVanguard
        ? 'Position outside friendly vanguard deployment zone (up to 12" ahead)'
        : 'Position outside friendly 12" deployment zone',
    };
  }

  // Check obstacle collision
  const piece = findTerrainAtPosition(state, position);
  if (piece && piece.isObstacle) {
    return { valid: false, reason: 'Cannot deploy inside a terrain obstacle' };
  }

  // Check proximity to deployed enemy models (> 1.0")
  for (const other of state.units) {
    if (other.ownerId === unit.ownerId || other.isDestroyed || other.isDeployed === false) {
      continue;
    }
    const dist = Math.hypot(position.x - other.position.x, position.z - other.position.z);
    if (dist <= 1.0) {
      return { valid: false, reason: 'Cannot deploy within 1" of enemy models' };
    }
  }

  return { valid: true };
}
