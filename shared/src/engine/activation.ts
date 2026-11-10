import {
  GameState,
  MAX_ROUNDS,
  MeleeResultRecord,
  MoraleTestRecord,
  Objective,
  OBJECTIVE_CONTROL_MAX_VERTICAL,
  OBJECTIVE_CONTROL_RADIUS,
  Unit,
} from '../gameTypes';
import { Vector3 } from '../types';
import { getDeploymentZoneDepth } from '../data/mapSchema';
import { getTraitValue, hasTrait } from '../rules/traits';
import { resolveMoraleTest } from './combat';
import { createSquadPositions, findEndOverlap, findTerrainAtPosition, isLadderPiece, isStairPiece } from './spatial';
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
  state.turnState.meleePairs = [];
}

/** Note that units were in melee during this activation (they skip the wound-based Morale Test). */
export function markInMelee(state: GameState, ...unitIds: string[]): void {
  const list = state.turnState.meleeUnitIds ?? (state.turnState.meleeUnitIds = []);
  for (const id of unitIds) if (!list.includes(id)) list.push(id);
  if (unitIds.length === 2) {
    const pairs = state.turnState.meleePairs ?? (state.turnState.meleePairs = []);
    const [a, b] = unitIds;
    if (!pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) pairs.push([a, b]);
  }
}

/** Wounds a unit lost since the activation began (a unit wiped out lost everything it had). */
function woundsTakenThisActivation(state: GameState, unit: Unit): number {
  const before = state.turnState.woundBaseline?.[unit.id];
  if (before === undefined) return 0;
  return Math.max(0, before - unitWoundsLeft(unit));
}

/** The Fear(X) a unit exerts: its highest value, and only while it still has living models. */
function fearValue(unit: Unit): number {
  if (unit.isDestroyed || unit.status.includes('routed')) return 0;
  if ((unit.models ?? []).length > 0 && unit.models.every((m) => m.isDestroyed)) return 0;
  return getTraitValue(unit.specialRules, 'fear') ?? 0;
}

/**
 * Compare the wounds each side of every melee of this activation took. A unit with Fear(X) adds X wounds to
 * the enemy's total, once per unit however many melees it was in. The higher total loses; a tie has no loser.
 */
export function getMeleeResults(state: GameState): MeleeResultRecord[] {
  const pairs = state.turnState.meleePairs ?? [];
  const fearUsed = new Set<string>();
  const results: MeleeResultRecord[] = [];
  for (const [aId, bId] of pairs) {
    const a = state.units.find((u) => u.id === aId);
    const b = state.units.find((u) => u.id === bId);
    if (!a || !b) continue;
    const fearAgainstA = fearUsed.has(b.id) ? 0 : fearValue(b);
    const fearAgainstB = fearUsed.has(a.id) ? 0 : fearValue(a);
    if (fearAgainstA > 0) fearUsed.add(b.id);
    if (fearAgainstB > 0) fearUsed.add(a.id);
    const woundsA = woundsTakenThisActivation(state, a);
    const woundsB = woundsTakenThisActivation(state, b);
    const totalA = woundsA + fearAgainstA;
    const totalB = woundsB + fearAgainstB;
    results.push({
      sides: [
        { unitId: a.id, unitName: a.name, wounds: woundsA, ...(fearAgainstA > 0 ? { fearBonus: fearAgainstA } : {}) },
        { unitId: b.id, unitName: b.name, wounds: woundsB, ...(fearAgainstB > 0 ? { fearBonus: fearAgainstB } : {}) },
      ],
      ...(totalA === totalB ? {} : { loserId: totalA > totalB ? a.id : b.id }),
    });
  }
  return results;
}

/** Units that lost a melee and are still standing: they owe a Morale Test. */
function meleeLosers(state: GameState): Unit[] {
  const losers: Unit[] = [];
  for (const result of getMeleeResults(state)) {
    if (!result.loserId) continue;
    const unit = state.units.find((u) => u.id === result.loserId);
    if (unit && !unit.isDestroyed && !unit.status.includes('routed') && !losers.includes(unit)) losers.push(unit);
  }
  return losers;
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
  const woundTests = state.units.filter((u) => {
    if (u.isDestroyed || u.status.includes('routed')) return false;
    if (melee.includes(u.id)) return false;
    const before = baseline[u.id];
    if (before === undefined || unitWoundsLeft(u) >= before) return false;
    return isAtHalfOrLess(u);
  });
  // Units in melee skip the wound test; the loser of each melee tests instead
  return [...woundTests, ...meleeLosers(state)];
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

/** A Routed unit is removed as destroyed by morale: every model goes and it is marked `routed`. */
function routUnit(unit: Unit): void {
  unit.wounds = 0;
  unit.isDestroyed = true;
  for (const m of unit.models ?? []) {
    m.wounds = 0;
    m.isDestroyed = true;
  }
  unit.status = ['routed'];
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
  const meleeLoserIds = meleeLosers(state).map((u) => u.id);

  for (const unit of getUnitsRequiringMorale(state)) {
    const lostMelee = meleeLoserIds.includes(unit.id);
    // Decided before the test changes anything: a failure at half strength or less is a Rout
    const wouldRout = lostMelee && isAtHalfOrLess(unit);
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

    let outcome = result.outcome;
    if (outcome === 'shaken' && wouldRout) {
      outcome = 'routed';
      routUnit(unit);
    } else if (outcome === 'shaken' && !unit.status.includes('shaken')) {
      unit.status.push('shaken');
    }

    // The Fearless die only matters (and is only shown) when the test itself failed.
    const testFailed = alreadyShaken || result.fearlessSaved || !result.passed;
    records.push({
      unitId: unit.id,
      unitName: unit.name,
      ...(roll !== undefined ? { roll } : {}),
      effectiveQuality: result.effectiveQuality,
      ...(fearlessRoll !== undefined && testFailed ? { fearlessRoll } : {}),
      passed: result.passed,
      outcome,
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

  const problem = deploymentFootprintProblem(state, unit, position, hasTrait(unit.specialRules, 'scout'));
  return problem ? { valid: false, reason: problem } : { valid: true };
}

/**
 * Why `unit` could not stand with its anchor at `position` (laid out exactly as `deploy-unit` places it), or
 * null when it can: every model inside the deployment zone, clear of terrain (obstacle pieces, structure solids
 * such as deck legs, stairs and ladders) and more than 1" from every model of any other deployed unit.
 */
export function deploymentFootprintProblem(
  state: GameState,
  unit: Unit,
  position: Vector3,
  isScout: boolean = false
): string | null {
  const bounds = getDeploymentZoneBounds(state, unit.ownerId, isScout);
  const modelCount = unit.models && unit.models.length > 0 ? unit.models.length : 1;
  const footprint = modelCount > 1 ? createSquadPositions(position, modelCount) : [position];

  for (const point of footprint) {
    if (
      point.x < bounds.minX - 0.01 ||
      point.x > bounds.maxX + 0.01 ||
      point.z < bounds.minZ - 0.01 ||
      point.z > bounds.maxZ + 0.01
    ) {
      return isScout
        ? 'Position outside friendly scout deployment zone (up to 12" ahead)'
        : 'Position outside friendly 12" deployment zone';
    }
  }

  for (const point of footprint) {
    const piece = findTerrainAtPosition(state, point);
    if (piece && (piece.isObstacle || isStairPiece(piece) || isLadderPiece(piece))) {
      return 'Cannot deploy inside a terrain obstacle';
    }
    // Structure solids (deck legs, walls of a ruin...) that the piece-level flag doesn't cover
    if (findEndOverlap(state, unit.id, point)?.kind === 'terrain') {
      return 'Cannot deploy inside a terrain obstacle';
    }
  }

  // Units may not start within 1" (base edge to base edge) of any other deployed unit, friend or foe.
  for (const other of state.units) {
    if (other.id === unit.id || other.isDestroyed || other.isDeployed === false) {
      continue;
    }
    for (const point of footprint) {
      if (gapToUnit(point, other) <= ENEMY_KEEP_AWAY_GAP) {
        return other.ownerId === unit.ownerId
          ? 'Cannot deploy within 1" of another friendly unit'
          : 'Cannot deploy within 1" of enemy models';
      }
    }
  }
  return null;
}

/**
 * Settle pre-placed units (deployment phase off) onto legal spots: each unit, in order, keeps its spawn anchor
 * if its whole footprint is legal there, otherwise moves to the nearest legal anchor (rings of 0.5" out to 12").
 * Mutates the units' anchors and model positions; units that can't be placed anywhere stay where they were.
 */
export function settleSpawnPositions(state: GameState, units: Unit[]): void {
  for (const u of units) u.isDeployed = false;
  for (const unit of units) {
    const origin = unit.position;
    let chosen: Vector3 | null = null;
    if (!deploymentFootprintProblem(state, unit, origin)) chosen = origin;
    for (let r = 0.5; !chosen && r <= 12.001; r += 0.5) {
      const steps = Math.max(8, Math.round((2 * Math.PI * r) / 0.75));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * 2 * Math.PI;
        const candidate = { x: Math.round((origin.x + Math.cos(a) * r) * 100) / 100, y: origin.y ?? 0, z: Math.round((origin.z + Math.sin(a) * r) * 100) / 100 };
        if (!deploymentFootprintProblem(state, unit, candidate)) {
          chosen = candidate;
          break;
        }
      }
    }
    if (chosen && chosen !== origin) {
      unit.position = { ...chosen };
      const count = unit.models?.length ?? 0;
      if (count > 0) {
        const positions = createSquadPositions(chosen, count);
        unit.models.forEach((m, i) => (m.position = { ...positions[i] }));
      }
    }
    unit.isDeployed = true;
  }
}
