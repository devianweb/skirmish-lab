import {
  GameState,
  MAX_ROUNDS,
  MoraleTestRecord,
  Objective,
  OBJECTIVE_CONTROL_MAX_VERTICAL,
  OBJECTIVE_CONTROL_RADIUS,
  Unit,
} from '../gameTypes';
import { Vector3 } from '../types';
import { getDeploymentZoneDepth } from '../data/mapSchema';
import { hasTrait } from '../rules/traits';
import { resolveMoraleTest } from './combat';
import { findTerrainAtPosition } from './spatial';
import { baseRadius, markerGap, unitDistance, gapToUnit, ENEMY_KEEP_AWAY_GAP } from './unitGeometry';

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
 * A Shaken unit may still be activated: it ends its activation idle, which clears Shaken. Routed units
 * cannot activate at all.
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
  const inRange = (pos: Vector3): boolean =>
    markerGap(pos, obj.position, baseRadius(unit)) <= OBJECTIVE_CONTROL_RADIUS + 0.001 &&
    Math.abs((pos.y ?? 0) - objY) <= OBJECTIVE_CONTROL_MAX_VERTICAL + 0.001;
  // Squads: every living model is checked on its own base edge. The unit anchor
  // (centroid) is only a display point and never counts for a multi-model unit.
  if (unit.models && unit.models.length > 1) {
    return unit.models.some((m) => !m.isDestroyed && inRange(m.position ?? unit.position));
  }
  return inRange(unit.position);
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
    unit.isRushing = false;
    unit.remainingMovement = unit.speed;
    delete unit.modelMovementSpent;
    unit.status = unit.status.filter((s) => s !== 'fatigued');
  }
}

// ============================================================================
// Morale (end of activation)
// ============================================================================

/** Friendly Heroes within this base-edge distance lend their Quality to Morale Tests. */
export const HERO_MORALE_RANGE = 6;

/** Total wounds the living models of a unit have left (a unit without models falls back to its own wounds). */
export function unitWoundsLeft(unit: Unit): number {
  if (!unit.models || unit.models.length === 0) return Math.max(0, unit.wounds);
  return unit.models.filter((m) => !m.isDestroyed).reduce((sum, m) => sum + Math.max(0, m.wounds), 0);
}

/** Record every living unit's wounds so the end of the activation can tell who took a wound. */
export function recordWoundBaseline(state: GameState): void {
  const baseline: Record<string, number> = {};
  for (const unit of state.units) {
    if (!unit.isDestroyed) baseline[unit.id] = unitWoundsLeft(unit);
  }
  state.turnState.woundBaseline = baseline;
  state.turnState.meleeUnitIds = [];
}

/** Note that units were in melee during this activation (they skip the wound-based Morale Test). */
export function markInMelee(state: GameState, ...unitIds: string[]): void {
  const list = state.turnState.meleeUnitIds ?? (state.turnState.meleeUnitIds = []);
  for (const id of unitIds) if (!list.includes(id)) list.push(id);
}

/** The Tough value of a single-model unit (its model's maximum wounds, at least 1). */
function singleModelTough(unit: Unit): number {
  const model = (unit.models ?? [])[0];
  return Math.max(1, model?.maxWounds ?? unit.maxWounds ?? 1);
}

/**
 * True when the unit is at half strength or less: for several models, living models x 2 <= starting
 * models; for a single model, remaining wounds x 2 <= Tough.
 */
export function isAtHalfOrLess(unit: Unit): boolean {
  const total = (unit.models ?? []).length;
  if (total > 1) {
    const living = unit.models.filter((m) => !m.isDestroyed).length;
    return living * 2 <= total;
  }
  return unitWoundsLeft(unit) * 2 <= singleModelTough(unit);
}

/**
 * Units that owe a Morale Test at the end of the current activation, in state order: alive, took at least
 * one wound since the activation began, were not in melee, and are now at half strength or less.
 */
export function getUnitsRequiringMorale(state: GameState): Unit[] {
  const baseline = state.turnState.woundBaseline;
  if (!baseline) return [];
  const melee = state.turnState.meleeUnitIds ?? [];
  return state.units.filter((u) => {
    if (u.isDestroyed || u.status.includes('routed')) return false;
    if (melee.includes(u.id)) return false;
    const before = baseline[u.id];
    if (before === undefined || unitWoundsLeft(u) >= before) return false;
    return isAtHalfOrLess(u);
  });
}

/** Fearless is a unit rule here, so a Fearless unit is one where most (all) models have it. */
function isFearlessUnit(unit: Unit): boolean {
  return hasTrait(unit.specialRules, 'fearless');
}

/**
 * Dice a set of Morale Tests needs: one d6 for each unit that is not already Shaken (a Shaken unit fails
 * without rolling) and one Fearless d6 for each Fearless unit (rolled after the failure, even an automatic one).
 */
export function moraleDiceCounts(units: Unit[]): { morale: number; fearless: number } {
  return {
    morale: units.filter((u) => !u.status.includes('shaken')).length,
    fearless: units.filter(isFearlessUnit).length,
  };
}

/** The best Quality a friendly, living, non-Shaken Hero within 6" offers `unit` (if any). */
export function heroQualityFor(state: GameState, unit: Unit): number | undefined {
  const heroes = state.units.filter(
    (c) =>
      c.ownerId === unit.ownerId &&
      !c.isDestroyed &&
      !c.status.includes('shaken') &&
      !c.status.includes('routed') &&
      hasTrait(c.specialRules, 'hero') &&
      unitDistance(c, unit) <= HERO_MORALE_RANGE + 0.001
  );
  return heroes.length > 0 ? Math.min(...heroes.map((c) => c.quality)) : undefined;
}

/**
 * Take the end-of-activation Morale Tests with pre-rolled server dice (`morale`, plus `fearless`), in the
 * order `getUnitsRequiringMorale` lists the units. A failed test makes the unit Shaken.
 */
export function applyEndOfActivationMorale(
  state: GameState,
  moraleRolls: number[],
  fearlessRolls: number[] = []
): MoraleTestRecord[] {
  const records: MoraleTestRecord[] = [];
  let rollIdx = 0;
  let fearlessIdx = 0;

  for (const unit of getUnitsRequiringMorale(state)) {
    const alreadyShaken = unit.status.includes('shaken');
    const roll = alreadyShaken ? undefined : moraleRolls[rollIdx++];
    if (!alreadyShaken && roll === undefined) break;
    const fearlessRoll = isFearlessUnit(unit) ? fearlessRolls[fearlessIdx++] : undefined;
    const heroQuality = heroQualityFor(state, unit);

    const result = resolveMoraleTest({
      quality: unit.quality,
      roll,
      specialRules: unit.specialRules,
      alreadyShaken,
      heroQuality,
      fearlessRoll,
    });

    // Consume one-shot morale-debuff if present.
    if (hasTrait(unit.specialRules, 'morale-debuff')) {
      unit.specialRules = unit.specialRules.filter((r) => r !== 'morale-debuff');
    }

    if (result.outcome === 'shaken' && !unit.status.includes('shaken')) unit.status.push('shaken');

    // The Fearless die only matters (and is only shown) when the test itself failed.
    const testFailed = alreadyShaken || result.fearlessSaved || !result.passed;
    records.push({
      unitId: unit.id,
      unitName: unit.name,
      ...(roll !== undefined ? { roll } : {}),
      effectiveQuality: result.effectiveQuality,
      ...(fearlessRoll !== undefined && testFailed ? { fearlessRoll } : {}),
      passed: result.passed,
      outcome: result.outcome,
    });
  }

  return records;
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
 * Zones run in from the player's table edge, up to 12" deep, but never so deep that the two zones are less
 * than 24" apart (the rules allow smaller tables as long as armies deploy at least 24" apart). On a 48"-deep
 * table that is the usual 12"; on a 30"-deep table it is 3". Scout units may deploy up to 12" further
 * ahead of their zone, but never past the centre line.
 */
export function getDeploymentZoneBounds(
  state: GameState,
  playerId: string,
  isScout: boolean = false
): DeploymentZoneBounds {
  const halfW = (state.board.width * state.board.gridSize) / 2;
  const halfH = (state.board.height * state.board.gridSize) / 2;
  const isHost = playerId === state.hostId;
  const depth = getDeploymentZoneDepth(state.board.height * state.board.gridSize);

  if (isHost) {
    // Host deployed at South edge (-halfH) facing +z
    const minZ = -halfH;
    const zoneMax = -halfH + depth;
    const maxZ = isScout ? Math.min(0, zoneMax + 12) : zoneMax;
    return { minX: -halfW, maxX: halfW, minZ, maxZ };
  } else {
    // Guest deployed at North edge (+halfH) facing -z
    const maxZ = halfH;
    const zoneMin = halfH - depth;
    const minZ = isScout ? Math.max(0, zoneMin - 12) : zoneMin;
    return { minX: -halfW, maxX: halfW, minZ, maxZ };
  }
}

/**
 * Get undeployed units eligible for deployment for a player.
 * Enforces rule sequencing:
 * 1. Standard units deploy first.
 * 2. Scout units deploy after all standard units are deployed.
 * 3. Drop Reserve units cannot deploy during pre-match deployment (held for Round 2+).
 */
export function getDeployableUnits(state: GameState, playerId: string): Unit[] {
  const undeployed = state.units.filter(
    (u) => u.ownerId === playerId && !u.isDestroyed && u.isDeployed === false
  );

  // Filter out ambush units (held for Round 2+)
  const eligible = undeployed.filter((u) => !hasTrait(u.specialRules, 'ambush'));

  // Standard units must deploy before scout units
  const standard = eligible.filter((u) => !hasTrait(u.specialRules, 'scout'));
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
  if (hasTrait(unit.specialRules, 'ambush')) {
    return { valid: false, reason: 'Drop Reserve units cannot be deployed pre-match (held for Round 2+)' };
  }

  const eligibleUnits = getDeployableUnits(state, unit.ownerId);
  if (!eligibleUnits.some((u) => u.id === unit.id)) {
    return { valid: false, reason: 'Unit is not currently eligible for deployment (scout units deploy after standard units)' };
  }

  const isScout = hasTrait(unit.specialRules, 'scout');
  const bounds = getDeploymentZoneBounds(state, unit.ownerId, isScout);

  if (
    position.x < bounds.minX - 0.01 ||
    position.x > bounds.maxX + 0.01 ||
    position.z < bounds.minZ - 0.01 ||
    position.z > bounds.maxZ + 0.01
  ) {
    return {
      valid: false,
      reason: isScout
        ? 'Position outside friendly scout deployment zone (up to 12" ahead)'
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
    const dist = gapToUnit(position, other);
    if (dist <= ENEMY_KEEP_AWAY_GAP) {
      return { valid: false, reason: 'Cannot deploy within 1" of enemy models' };
    }
  }

  return { valid: true };
}
