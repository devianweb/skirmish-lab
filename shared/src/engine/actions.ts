import { cloneGameState } from '../gameState';
import { createRematchState } from './rematch';
import {
  DEPLOYMENT_ROLL_OFF_PURPOSE,
  MISSION_ROLL_OFF_PURPOSE,
  OBJECTIVE_COUNT_PURPOSE,
  createObjectiveMarker,
  objectiveCountFromRoll,
  objectivePlacementProblem,
  resolveRollOff,
  rollOffSpec,
} from './setup';
import { closestApproach } from './closestApproach';
import {
  ActionLogEntry,
  DiceResolution,
  GameAction,
  MeleeResultRecord,
  MoraleTestRecord,
  GameState,
  TraversalEvent,
  Model,
  PendingReaction,
  RetaliationOutcome,
  Unit,
  Weapon,
  WeaponAllocation,
  WeaponAttackOutcome,
  BlastSplashOutcome,
  BlastSplitRecord,
  SpecialStrikeOutcome,
} from '../gameTypes';
import { DiceSpec, DiceResult, Vector3 } from '../types';
import {
  advanceActivation,
  advanceAmbushStep,
  ambushFootprintProblem,
  advanceDeployment,
  isDeploymentComplete,
  applyEndOfActivationMorale,
  endRound,
  getUnitsRequiringMorale,
  isRoundComplete,
  markInMelee,
  getMeleeResults,
  moraleDiceCounts,
  recordWoundBaseline,
  noteAttackedFrom,
  validateDeploymentPosition,
} from './activation';
import {
  BlastShare,
  CombatOutcome,
  blastPurpose,
  countShotHits,
  extractAllocationRolls,
  extractAttackRolls,
  extractBlastRolls,
  extractRetaliationRolls,
  getAttackDiceSpecs,
  resolveAttack,
  resolveImpact,
  getImpactDiceSpecs,
  type AttackRolls,
} from './combat';
import { autoSplitForParticipants, getBlastParticipants } from './blast';
import {
  BLAST_SPLIT_AUTO_CHOICE,
  createBlastSplitReaction,
  validateBlastSplit,
  type BlastSplitData,
  type BlastSplitPayload,
  type BlastSplitPrompt,
} from './blastSplit';
import {
  computeSquadCentroid,
  pushBackChargerModels,
  createSquadPositions,
  findMoveBlocker,
  hasCoverAgainstAttack,
  hasLineOfSight,
  isLadderPiece,
  isOnLadderClimbLine,
  isSuspendedInMidAir,
  isBaseOverhanging,
  findEndOverlap,
  describeEndOverlap,
  validateSquadCoherency,
  isRegroupingMove,
  coherencyShortfall,
} from './spatial';
import {
  detectPathFall,
  classifySegment,
  JUMP_KINDS,
  JUMP_TARGET,
  fallDiceCount,
  countFallWounds,
  getEffectiveMaxMovement,
  dangerousPieceIdsOnPaths,
  dangerousPieceIdsUnderUnit,
  woundsToDestroy,
  isPathDifficult,
  isPathDangerous,
  pathMovementCost,
  resolveDangerousTerrain,
  calculateJumpDice,
  FREE_DROP_MAX,
  findFallLanding,
  JUMP_DROP_MAX,
  detectPathGapJump,
  validateDeclaredTraversal,
  DeclaredTraversal,
  distance3D,
  MELEE_MAX_VERTICAL_REACH,
} from './traversal';
import { describeLeftBehind, takeoffSpotProblem, validateCrossers } from './crossing';
import type { ChargeState } from '../gameTypes';
import {
  PUSH_AUTO_CHOICE,
  PUSH_DECLINE_CHOICE,
  PUSH_TARGET,
  PushData,
  PushQueueEntry,
  autoPush,
  createPushReaction,
  gatherAroundFallen,
  planPush,
  pushAttackerFor,
  regroupAfterPush,
} from './push';
import { getTraitValue, hasTrait, sumTraitValue } from '../rules/traits';
import {
  findCounterWeapons,
  findMeleeWeapon,
  findMeleeWeapons,
  findNonCounterMeleeWeapons,
  getEffectiveSpeed,
  hasMeleeWeapon,
  impactDiceCount,
  isCarried,
  isMeleeWeapon,
  meleeWeaponSlots,
} from './specialRules';
import {
  unitDistance,
  edgeGapToCentre,
  pointEngagesUnit,
  unitsInContact,
  modelsWithin,
  chargeContact,
  chargeDestination,
  strikingModelCount,
  ENGAGEMENT_EDGE_GAP,
  CHARGE_END_EDGE_GAP,
  modelGap,
  modelCarries,
  livingModelPositions,
} from './unitGeometry';
import { firingModels, ignoresSight, targetCoverByMajority } from './squadTargeting';
import {
  PILE_IN_AUTO_CHOICE,
  PILE_IN_DISTANCE,
  PILE_IN_DURATION_MS,
  PileInPayload,
  autoPileIn,
  pileInModelIds,
  validatePileIn,
  withModelPositions,
} from './pileIn';
import {
  CasualtyContinuation,
  CasualtyEntry,
  PICK_CASUALTIES_AUTO_CHOICE,
  PickCasualtiesData,
  PickCasualtiesPayload,
  WoundApplication,
  WoundAllocation,
  allocateWounds,
  autoPickCasualties,
  createPickCasualtiesReaction,
  lockedWoundedModels,
  restoreUnit,
  snapshotUnit,
  validatePickCasualties,
} from './casualties';
import { modelRemainingMovement, resetModelMovement, spendAllModels, spendModelMovement } from './modelMovement';

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
/** Rejection text for an end position whose base hangs over an edge. */
const OVERHANG_REASON = 'Models cannot end movement partly overhanging an edge — the whole base must rest on the floor';
const ENGAGEMENT_DISTANCE = edgeGapToCentre(0);

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

/**
 * Deadly weapons put their wounds on before the others when one attack uses several weapons. A stable
 * partition: Deadly items first, everything else keeps its order.
 */
function deadlyFirst<T>(items: T[], weaponOf: (item: T) => Weapon | undefined): T[] {
  const isDeadly = (item: T) => hasTrait(weaponOf(item)?.profile.specialRules ?? [], 'deadly');
  return [...items.filter(isDeadly), ...items.filter((item) => !isDeadly(item))];
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
/**
 * A squad that starts its activation out of coherency must spend it getting back
 * together: it may not Hold or end the activation without having moved. Shaken
 * units are exempt (they cannot move; their idle activation only clears Shaken).
 * Returns a rejection, or null when the unit is free to hold/end.
 */
function incoherentStartBlock(unit: Unit): { valid: false; reason: string } | null {
  if (unit.status.includes('shaken')) return null;
  const positions = (unit.models ?? [])
    .filter((m) => !m.isDestroyed)
    .map((m) => m.position ?? unit.position);
  if (positions.length <= 1) return null;
  if (validateSquadCoherency(positions).coherent) return null;
  return {
    valid: false,
    reason:
      'Squad is out of coherency: this activation must move it back together (it cannot hold or end without moving)',
  };
}

/** Positions of a unit's living models right now (before the action being validated). */
function livingModelPositionsNow(unit: Unit): Vector3[] {
  return (unit.models ?? []).filter((m) => !m.isDestroyed).map((m) => m.position ?? unit.position);
}

/**
 * Coherency of a squad's end positions. A squad that started coherent must end coherent; one that started
 * (the action or leg) out of coherency may also end measurably closer to coherent ("closer counts").
 */
function squadEndCoherency(
  unit: Unit,
  end: Vector3[],
  traversals?: ReadonlyArray<DeclaredTraversal | null | undefined>
): { valid: true } | { valid: false; reason: string } {
  const coherency = validateSquadCoherency(end);
  if (coherency.coherent) return { valid: true };
  const before = livingModelPositionsNow(unit);
  if (before.length === end.length && isRegroupingMove(before, end)) return { valid: true };
  let base = coherency.reason ?? 'Squad models lose coherency';
  // Some models crossed a gap or drop and others did not: say who was left behind (14C-2 PR 4B)
  const behind = describeLeftBehind(traversals, end);
  if (behind.length > 0) {
    base += ` (${behind.length > 1 ? 'models' : 'model'} ${behind.join(', ')} did not cross with the squad: after a passed jump the other models can be placed across within 1\" of a model that has crossed)`;
  }
  const wasOut = before.length === end.length && coherencyShortfall(before) > 0;
  return {
    valid: false,
    reason: wasOut ? `${base} (the squad started out of coherency: it must end closer to coherent than it began)` : base,
  };
}

/** A non-contact charger may end this much (base-edge inches) farther from the target than its best spot. */
const CLOSEST_APPROACH_TOLERANCE = 0.5;

/** Per-model parts of a squad charge / charge leg payload (a single model keeps the plain `path`). */
interface SquadChargePayload {
  modelPositions?: Vector3[];
  modelPaths?: Vector3[][];
  modelTraversals?: (DeclaredTraversal | null)[];
  /** Living-model indices carried across the leader's crossing (placed by `modelPositions`, no path, no move spent). */
  crossers?: number[];
  /** Index of the model whose declared jump the others follow (default: the lowest-index jumper). */
  jumpLeader?: number;
}

/** Indices of the models a payload carries across the leader's crossing. */
function crosserSet(payload: { crossers?: number[] }): Set<number> {
  return new Set(Array.isArray(payload.crossers) ? payload.crossers : []);
}

function livingModels(unit: Unit): Model[] {
  return (unit.models ?? []).filter((m) => !m.isDestroyed);
}

/** A squad (more than one living model) that sent per-model positions. */
function isSquadChargePayload(unit: Unit, payload: SquadChargePayload): boolean {
  return !!payload.modelPositions && livingModels(unit).length > 1;
}

const SQUAD_CHARGE_NEEDS_POSITIONS =
  'A squad charge must place every model (modelPositions) — block charges are not accepted';

/** Each living model's path: the one sent, or a straight line from where it stands to its end spot. */
function squadChargePaths(unit: Unit, payload: SquadChargePayload): Vector3[][] {
  return livingModels(unit).map((m, i) => {
    const start = m.position ?? unit.position;
    const sent = payload.modelPaths?.[i];
    return sent && sent.length >= 2 ? sent : [start, payload.modelPositions![i]];
  });
}

/** Each living model's advance/rush path: the explicit path, or a straight segment from its current spot to `modelPositions[i]`. */
function squadMovePaths(
  unit: Unit,
  payload: { modelPositions?: Vector3[]; modelPaths?: Vector3[][] }
): Vector3[][] {
  return livingModels(unit).map((m, i) => {
    const start = m.position ?? unit.position;
    const sent = payload.modelPaths?.[i];
    return sent && sent.length >= 2 ? sent : [start, payload.modelPositions![i]];
  });
}

/** Shared geometry, keep-away, traversal, and end-spot checks for a single consolidation path (unit or one squad model). */
function validateConsolidationPath(
  state: GameState,
  unit: Unit,
  path: Vector3[],
  maxDistance: number,
  actorId: string,
  label?: string
): ValidationResult {
  const prefix = label ? `${label} ` : '';
  for (const pt of path) {
    if (!isWithinBoard(state, pt)) {
      return { valid: false, reason: `${prefix}consolidation move leaves the board` };
    }
  }
  const isDifficult = isPathDifficult(state, path, unit);
  const effectiveCap = getEffectiveMaxMovement(unit, 'move', isDifficult);
  const maxAllowed = Math.min(maxDistance, effectiveCap);
  const distance = pathMovementCost(state, path, unit);
  if (distance > maxAllowed + 0.05) {
    return {
      valid: false,
      reason: isDifficult && effectiveCap === 6.0 && maxAllowed < maxDistance
        ? `${prefix}consolidation move exceeds Difficult Terrain speed cap`
        : `${prefix}consolidation move exceeds max distance (${maxDistance}")`,
    };
  }
  const blocker = findMoveBlocker(state, unit, path, { keepAway: true });
  if (blocker.blocked) {
    return { valid: false, reason: label ? `${label} ${blocker.reason}` : blocker.reason };
  }
  const gap = detectPathGapJump(state, path, unit);
  if (gap.isGapJump || gap.tooWide) {
    return { valid: false, reason: `${prefix}consolidation move cannot jump across gaps` };
  }
  if (isPathDangerous(state, path, unit)) {
    return { valid: false, reason: `${prefix}consolidation move cannot cross dangerous terrain` };
  }
  if (detectPathFall(path, state).maxDrop > FREE_DROP_MAX) {
    return { valid: false, reason: `${prefix}consolidation move cannot drop more than ${FREE_DROP_MAX}"` };
  }
  const traversalProblem = validateDeclaredTraversal(state, unit, path, undefined);
  if (traversalProblem) {
    return { valid: false, reason: label ? `${label}: ${traversalProblem}` : traversalProblem };
  }
  const end = path[path.length - 1];
  if (isSuspendedInMidAir(state, end)) {
    return { valid: false, reason: `${prefix}models cannot end movement suspended in mid-air — stop at an edge or reach a floor` };
  }
  if (isBaseOverhanging(state, end)) {
    return { valid: false, reason: label ? `${label}: ${OVERHANG_REASON}` : OVERHANG_REASON };
  }
  for (const piece of state.terrain) {
    if (isLadderPiece(piece) && isOnLadderClimbLine(state, piece, end)) {
      return {
        valid: false,
        reason: `${prefix}models cannot end movement suspended on ladder rungs — must reach the platform or stop at the ladder foot`,
      };
    }
  }
  const overlap = findEndOverlap(state, unit.id, end);
  if (overlap) {
    return { valid: false, reason: label ? `${label}: ${describeEndOverlap(overlap)}` : describeEndOverlap(overlap) };
  }
  const wouldEngage = state.units.some(
    (u) =>
      !u.isDestroyed &&
      u.isDeployed !== false &&
      u.ownerId !== actorId &&
      pointEngagesUnit(end, u)
  );
  if (wouldEngage) {
    return { valid: false, reason: 'Consolidation move cannot end in melee contact' };
  }
  return { valid: true };
}

/**
 * Host check of a squad's charge move: every model walks its own path from where it stands (a shared budget:
 * each model's path must fit what is left of the charge), the squad ends coherent, and no model passes through
 * another unit or comes within 1" of any unit but the target. A final move needs at least one model in base
 * contact with a target model; every other model must end about as close as ordinary movement could have got
 * it ("as close as possible", `closestApproach` with the model's own remaining distance and the other models'
 * submitted spots, allowing `CLOSEST_APPROACH_TOLERANCE`). Legs have no closeness rule.
 */
function validateSquadChargeMove(
  state: GameState,
  unit: Unit,
  target: Unit,
  payload: SquadChargePayload,
  mode: 'leg' | 'final'
): ValidationResult {
  const positions = payload.modelPositions ?? [];
  const alive = livingModels(unit);
  const declared = declaredCharge(state, unit.id);
  const unitRemaining = declared ? unit.remainingMovement : chargeBudget(unit);
  if (positions.length !== alive.length) {
    return {
      valid: false,
      reason: `Model positions count mismatch (${positions.length} vs ${alive.length} active models)`,
    };
  }
  if (
    (payload.modelTraversals && payload.modelTraversals.length > positions.length) ||
    (payload.modelPaths && payload.modelPaths.length > positions.length)
  ) {
    return { valid: false, reason: 'More model paths or declared jumps than squad models' };
  }
  const crossProblem = validateCrossers(state, unit, payload, positions, target.id);
  if (crossProblem) return { valid: false, reason: crossProblem };
  const coherency = squadEndCoherency(unit, positions, payload.modelTraversals);
  if (!coherency.valid) return coherency;
  const spotProblem = takeoffSpotProblem(payload.modelTraversals, positions, payload.jumpLeader);
  if (spotProblem) return { valid: false, reason: spotProblem };
  const carried = crosserSet(payload);
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      if (boardDistance(positions[i], positions[j]) < 0.9) {
        return { valid: false, reason: `Squad models ${i + 1} and ${j + 1} cannot overlap` };
      }
    }
    if (!isWithinBoard(state, positions[i])) {
      return { valid: false, reason: 'Squad model position leaves the board' };
    }
  }

  const paths = squadChargePaths(unit, payload);
  const targetModels = livingModelPositions(target);
  let moved = 0;
  let inContact = false;
  let reachedTooHigh = false;
  const pending: Array<{ index: number; endGap: number; remaining: number; spent: number }> = [];
  for (let i = 0; i < alive.length; i++) {
    const n = i + 1;
    const mStart = alive[i].position ?? unit.position;
    const mEnd = positions[i];
    if (carried.has(i)) {
      // Carried across: its spot was checked by validateCrossers; it only counts toward contact with the target
      if (mode === 'final') {
        for (const t of targetModels) {
          if (modelGap(mEnd, t) <= CHARGE_END_EDGE_GAP + 0.001 && Math.abs((mEnd.y ?? 0) - (t.y ?? 0)) <= MELEE_MAX_VERTICAL_REACH) inContact = true;
        }
      }
      continue;
    }
    const mPath = paths[i];
    if (boardDistance(mPath[0], mStart) > 0.05) {
      return { valid: false, reason: `Squad model ${n} move path does not start at model position` };
    }
    if (boardDistance(mPath[mPath.length - 1], mEnd) > 0.05) {
      return { valid: false, reason: `Squad model ${n} move path does not end at its position` };
    }
    for (const pt of mPath) {
      if (!isWithinBoard(state, pt)) return { valid: false, reason: `Squad model ${n} move path leaves the board` };
    }
    const difficult = isPathDifficult(state, mPath, unit);
    const cap = getEffectiveMaxMovement(unit, 'charge', difficult);
    const dist = pathMovementCost(state, mPath, unit);
    // Each model spends its own distance: what it has walked in earlier legs counts, not a squad-mate's
    const remaining = modelRemainingMovement(unit, alive[i], unitRemaining);
    const spent = declared ? chargeBudget(unit) - remaining : 0;
    if (dist > remaining + 0.05 || spent + dist > cap + 0.05) {
      return {
        valid: false,
        reason:
          difficult && cap === 6.0
            ? `Squad model ${n} exceeds the Difficult Terrain charge cap (6.0")`
            : `Squad model ${n} exceeds the charge distance (${dist.toFixed(1)}" vs ${Math.max(0, Math.min(remaining, cap - spent)).toFixed(1)}")`,
      };
    }
    // A hop is free but still a move (the leader of a group crossing may spend nothing else)
    moved = Math.max(moved, dist, payload.modelTraversals?.[i] ? boardDistance(mStart, mEnd) : 0);
    // The 1" rule is ignored only toward the declared target, and nobody walks through a model
    const blocker = findMoveBlocker(state, unit, mPath, { ignoreUnitId: target.id, keepAway: true });
    if (blocker.blocked) return { valid: false, reason: `Squad model ${n} move path is blocked: ${blocker.reason}` };
    if (detectPathGapJump(state, mPath, unit).tooWide) {
      return { valid: false, reason: `Squad model ${n} cannot cross a gap wider than 6"` };
    }
    const jumpProblem = validateDeclaredTraversal(state, unit, mPath, payload.modelTraversals?.[i]);
    if (jumpProblem) return { valid: false, reason: `Squad model ${n}: ${jumpProblem}` };
    if (isSuspendedInMidAir(state, mEnd)) {
      return { valid: false, reason: `Squad model ${n} cannot end movement suspended in mid-air — stop at an edge or reach a floor` };
    }
    if (isBaseOverhanging(state, mEnd)) return { valid: false, reason: `Squad model ${n}: ${OVERHANG_REASON}` };
    for (const piece of state.terrain) {
      if (isLadderPiece(piece) && isOnLadderClimbLine(state, piece, mEnd)) {
        return {
          valid: false,
          reason: `Squad model ${n} cannot end movement suspended on ladder rungs — must reach the platform or stop at the ladder foot`,
        };
      }
    }
    const overlap = findEndOverlap(state, unit.id, mEnd);
    if (overlap) return { valid: false, reason: `Squad model ${n}: ${describeEndOverlap(overlap)}` };

    if (mode === 'final') {
      let modelInContact = false;
      let endGap = Infinity;
      for (const t of targetModels) {
        const gap = modelGap(mEnd, t);
        endGap = Math.min(endGap, gap);
        if (gap <= CHARGE_END_EDGE_GAP + 0.001) {
          if (Math.abs((mEnd.y ?? 0) - (t.y ?? 0)) <= MELEE_MAX_VERTICAL_REACH) modelInContact = true;
          else reachedTooHigh = true;
        }
      }
      if (modelInContact) inContact = true;
      else pending.push({ index: i, endGap, remaining, spent });
    }
  }
  if (mode === 'leg' && moved < 0.05) return { valid: false, reason: 'Charge leg moves nothing' };
  if (mode === 'final' && !inContact) {
    return {
      valid: false,
      reason: reachedTooHigh
        ? 'Target is on a ledge outside vertical melee reach (> 4.0" vertical difference)'
        : 'Charge must end in engagement range',
    };
  }
  // "As close as possible": a model not in contact must end about as close as ordinary movement lets it get,
  // given where the rest of the squad ends and what it has left of its own distance
  for (const p of pending) {
    const i = p.index;
    const mStart = alive[i].position ?? unit.position;
    const others = positions.filter((_, j) => j !== i);
    const best = closestApproach(state, unit, i, mStart, p.remaining, target, others, {
      difficultBudget: Math.max(0, getEffectiveMaxMovement(unit, 'charge', true) - p.spent),
    });
    if (best && p.endGap > best.gap + CLOSEST_APPROACH_TOLERANCE) {
      return { valid: false, reason: `Model ${i + 1} could get closer to the target` };
    }
  }
  return { valid: true };
}

/**
 * Put a squad's living models on their new spots (anchor = centroid), turning each toward where it moved.
 * Returns the positions they left, in model order.
 */
function placeSquadModels(unit: Unit, positions: Vector3[]): Vector3[] {
  const alive = livingModels(unit);
  const prev = alive.map((m) => ({ ...(m.position ?? unit.position) }));
  alive.forEach((m, i) => {
    m.position = { ...positions[i] };
  });
  unit.position = computeSquadCentroid(positions);
  if (positions.length > 0 && prev.length > 0) {
    const dx = positions[0].x - prev[0].x;
    const dz = positions[0].z - prev[0].z;
    if (Math.hypot(dx, dz) > 1e-4) unit.rotation = { ...unit.rotation, y: Math.atan2(dx, dz) };
  }
  alive.forEach((m, i) => {
    const dx = positions[i].x - prev[i].x;
    const dz = positions[i].z - prev[i].z;
    m.rotation = Math.hypot(dx, dz) > 1e-4 ? { x: 0, y: Math.atan2(dx, dz), z: 0 } : { ...unit.rotation };
  });
  return prev;
}

/** Purpose tag of the dice for the dangerous terrain test of one piece (one test per piece per activation). */
const hazardPurpose = (pieceId: string) => `hazard_${pieceId}`;

/** The pieces that still call for a test this activation: not yet tested by this unit. */
function untestedPieces(unit: Unit, pieceIds: string[]): string[] {
  const tested = unit.hazardTestedPieceIds ?? [];
  return pieceIds.filter((id, i) => !tested.includes(id) && pieceIds.indexOf(id) === i);
}

/** One test per piece: as many dice as the wounds it would take to destroy the unit. */
function hazardSpecsForPieces(unit: Unit, pieceIds: string[]): DiceSpec[] {
  const count = woundsToDestroy(unit);
  return untestedPieces(unit, pieceIds).map((id) => ({ count, sides: 6, purpose: hazardPurpose(id) }));
}

/** Dice for the tests of the dangerous pieces the unit starts its activation in (one test per piece). */
function activationHazardSpecs(state: GameState, unit: Unit): DiceSpec[] {
  // A new activation starts with a clean list (beginActivation clears it), whatever a past activation left
  const count = woundsToDestroy(unit);
  return dangerousPieceIdsUnderUnit(state, unit).map((id) => ({ count, sides: 6, purpose: hazardPurpose(id) }));
}

/**
 * Rolls the test for each piece in `pieceIds` the unit has not tested yet and has dice for: every 1 is a wound,
 * allocated like other wounds (the player's casualty priority, else wounded models first). Marks the pieces
 * tested, so crossing them again, or leaving the piece the unit activated in, does not roll again.
 */
function resolveHazardTests(
  unit: Unit,
  pieceIds: string[],
  dice: DiceResult[] | undefined,
  events: TraversalEvent[],
  title: string,
  priority?: string[],
  ledger?: WoundLedger
): void {
  for (const id of untestedPieces(unit, pieceIds)) {
    if (unit.isDestroyed) return;
    // Only as many dice as wounds still needed to destroy the unit count (earlier pieces may have wounded it)
    const rolls = dice?.find((d) => d.purpose === hazardPurpose(id))?.rolls?.slice(0, woundsToDestroy(unit));
    if (!rolls || rolls.length === 0) continue;
    unit.hazardTestedPieceIds = [...(unit.hazardTestedPieceIds ?? []), id];
    const wounds = resolveDangerousTerrain(unit, rolls).woundsInflicted;
    events.push({
      type: 'hazard',
      rolls,
      wounds,
      text: `${title}: rolled ${rolls.length} ${rolls.length === 1 ? 'die' : 'dice'} (${rollsText(rolls)}) → ${
        wounds > 0 ? `${wounds} wound${wounds > 1 ? 's' : ''} (each 1)` : 'no wounds'
      }`,
    });
    if (wounds > 0) {
      // Tracked wounds let the squad's owner pick who goes (the caller defers the casualties afterwards)
      if (ledger) applyTrackedWounds(ledger, unit, wounds);
      else applyTabletopWounds(unit, wounds, 1, priority && livingModels(unit).length > 1 ? [...priority] : undefined);
    }
  }
}

/**
 * Resolves the activation test: one per dangerous piece the unit starts in. A squad that loses models but
 * survives gets the casualty pick (Decision 42); returns true when that prompt is now pending. `finishAfterPick`
 * is set for a one-action `hold`, which ends the activation once the pick is in.
 */
function applyActivationHazard(
  state: GameState,
  unit: Unit,
  action: GameAction,
  dice: DiceResult[] | undefined,
  finishAfterPick: boolean
): boolean {
  if (!dice || dice.length === 0) return false;
  const events: TraversalEvent[] = [];
  const ledger: WoundLedger = new Map();
  resolveHazardTests(unit, dangerousPieceIdsUnderUnit(state, unit), dice, events, 'Hazard (activated in dangerous terrain)', undefined, ledger);
  recordTraversal(action, unit, events, dice);
  if (unit.isDestroyed) return false;
  return (
    deferCasualties(state, ledger, action.id, unit, {
      kind: 'activation-hazard',
      attackerId: unit.id,
      ...(finishAfterPick ? { finish: { dice: JSON.parse(JSON.stringify(dice)) as DiceResult[] } } : {}),
    }) !== null
  );
}

/** Jump, fall and hazard dice a squad charge (leg) needs: one `jump` roll for the squad, one test per new piece. */
function squadChargeTraversalSpecs(state: GameState, unit: Unit, payload: SquadChargePayload): DiceSpec[] {
  const carried = crosserSet(payload);
  const paths = squadChargePaths(unit, payload).filter((_, i) => !carried.has(i));
  return [
    ...legJumpSpecs(state, unit, chargeLegEntries(unit, payload)),
    ...pathTraversalSpecs(state, unit, paths),
  ];
}

/** Action types allowed while a charge is declared (Decision 22: no undo, no switching to another action). */
const CHARGE_LOCK_ALLOWED: string[] = ['charge-leg', 'charge', 'end-activation'];

/** Full charge budget of a unit (before Difficult Terrain caps). */
function chargeBudget(unit: Unit): number {
  return getEffectiveMaxMovement(unit, 'charge', false);
}

/** The declared charge belonging to this unit, if any. */
function declaredCharge(state: GameState, unitId: string): ChargeState | null {
  const c = state.turnState.charge;
  return c && c.unitId === unitId ? c : null;
}

/** Charge movement already spent this activation (budget minus what is left). */
function chargeSpent(unit: Unit): number {
  return Math.max(0, chargeBudget(unit) - unit.remainingMovement);
}

export function validateAction(state: GameState, action: GameAction): ValidationResult {
  // request-rematch is the only action that means anything once the match is over (and nothing else is valid then).
  if (action.type === 'request-rematch') {
    if (state.status !== 'game-over') {
      return { valid: false, reason: "The match isn't over" };
    }
    if (action.actorId !== state.hostId && action.actorId !== state.guestId) {
      return { valid: false, reason: 'Not a player in this match' };
    }
    return { valid: true };
  }
  if (state.status === 'game-over') {
    return { valid: false, reason: 'Game is over' };
  }
  // Conceding is allowed at any moment (either player's turn, mid-reaction, mid-charge): skip the turn gates.
  if (action.type === 'concede') {
    if (action.actorId !== state.hostId && action.actorId !== state.guestId) {
      return { valid: false, reason: 'Not a player in this match' };
    }
    return { valid: true };
  }
  if (state.turnState.pendingReaction) {
    if (
      action.type !== 'respond-reaction' &&
      action.type !== 'consolidate-move' &&
      action.type !== 'pile-in-move' &&
      action.type !== 'pick-casualties' &&
      action.type !== 'blast-split' &&
      action.type !== 'push-move'
    ) {
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
  // Before the first round only the setup actions are valid; during the Ambush step only placements
  const phase = state.turnState.phase;
  if (phase === 'objectives' && action.type !== 'roll-objectives' && action.type !== 'place-objective') {
    return { valid: false, reason: 'Objectives are being set up' };
  }
  if (phase === 'deployment' && action.type !== 'deploy-unit' && action.type !== 'hold-scout') {
    return { valid: false, reason: 'Units are being deployed' };
  }
  if (
    state.turnState.ambushStep &&
    action.type !== 'deploy-unit' &&
    action.type !== 'skip-ambush'
  ) {
    return { valid: false, reason: 'Ambush units are being placed before the round starts' };
  }
  // A declared charge can't be undone or turned into another action: legs, the final charge, or abandoning it.
  if (
    state.turnState.charge &&
    !state.turnState.pendingReaction &&
    !CHARGE_LOCK_ALLOWED.includes(action.type)
  ) {
    return {
      valid: false,
      reason: 'A charge is declared: make a charge leg, finish it on the target, or end the activation',
    };
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
      if (unit.isDeployed === false) return { valid: false, reason: 'Unit is not on the table yet' };
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
      if (unit.isDeployed === false) return { valid: false, reason: 'Unit is not on the table yet' };
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
        return incoherentStartBlock(unit) ?? { valid: true };
      }
      if (unit.isActivated || state.turnState.unitsActivatedThisRound.includes(unitId)) {
        return { valid: false, reason: 'Unit already activated this round' };
      }
      return incoherentStartBlock(unit) ?? { valid: true };
    }

    case 'roll-objectives': {
      if (state.turnState.phase !== 'objectives') {
        return { valid: false, reason: 'Objectives can only be rolled in the objectives phase' };
      }
      if (state.setupRolls?.objectiveCount !== undefined) {
        return { valid: false, reason: 'The objective count has already been rolled' };
      }
      return { valid: true };
    }

    case 'place-objective': {
      if (state.turnState.phase !== 'objectives') {
        return { valid: false, reason: 'Objectives can only be placed in the objectives phase' };
      }
      const count = state.setupRolls?.objectiveCount;
      if (count === undefined) {
        return { valid: false, reason: 'The objective count has not been rolled yet' };
      }
      if ((state.objectives ?? []).length >= count) {
        return { valid: false, reason: 'All objectives are already placed' };
      }
      const { position } = action.payload as { position: Vector3 };
      if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) {
        return { valid: false, reason: 'Objective needs a position' };
      }
      const problem = objectivePlacementProblem(state, position);
      return problem ? { valid: false, reason: problem } : { valid: true };
    }

    case 'hold-scout': {
      if (state.turnState.phase !== 'deployment' || state.turnState.scoutStage) {
        return { valid: false, reason: 'Scouts can only be held back while units are being deployed' };
      }
      const { unitId } = action.payload as PayloadWithUnitId;
      const unit = getUnit(state, unitId);
      if (!unit) return { valid: false, reason: 'Unit not found' };
      if (unit.ownerId !== action.actorId) return { valid: false, reason: 'Cannot hold back an opponent unit' };
      if (unit.isDeployed !== false || unit.isDestroyed) return { valid: false, reason: 'Unit is already deployed' };
      if (!hasTrait(unit.specialRules, 'scout') || hasTrait(unit.specialRules, 'ambush')) {
        return { valid: false, reason: 'Only Scout units can be held back' };
      }
      if (unit.heldAsScout) return { valid: false, reason: 'Unit is already held back' };
      return { valid: true };
    }

    case 'skip-ambush': {
      if (!state.turnState.ambushStep) {
        return { valid: false, reason: 'No Ambush units are being placed' };
      }
      return { valid: true };
    }

    case 'deploy-unit': {
      const inAmbushStep = Boolean(state.turnState.ambushStep);
      if (state.turnState.phase !== 'deployment' && !inAmbushStep) {
        return { valid: false, reason: 'Units can only be deployed during the deployment phase' };
      }
      const { unitId, position } = action.payload as {
        unitId: string;
        position: Vector3;
        rotation?: Vector3;
      };
      if (action.actorId !== state.turnState.currentPlayerId) {
        return { valid: false, reason: 'Not your turn to deploy' };
      }
      const unit = getUnit(state, unitId);
      if (!unit) {
        return { valid: false, reason: 'Unit not found' };
      }
      if (unit.ownerId !== action.actorId) {
        return { valid: false, reason: 'Cannot deploy opponent unit' };
      }
      if (unit.isDeployed !== false) {
        return { valid: false, reason: 'Unit is already deployed' };
      }
      if (inAmbushStep) {
        if (unit.isDestroyed || !hasTrait(unit.specialRules, 'ambush')) {
          return { valid: false, reason: 'Only Ambush units are placed now' };
        }
        const problem = ambushFootprintProblem(state, unit, position);
        return problem ? { valid: false, reason: problem } : { valid: true };
      }
      const val = validateDeploymentPosition(state, unit, position);
      if (!val.valid) {
        return { valid: false, reason: val.reason };
      }
      return { valid: true };
    }

    case 'advance': {
      const { unitId, path, finalPosition, modelPositions, modelPaths, modelTraversals } = action.payload as {
        unitId: string;
        path: Vector3[];
        finalPosition?: Vector3;
        modelPositions?: Vector3[];
        modelPaths?: Vector3[][];
        modelTraversals?: (DeclaredTraversal | null)[];
      };
      const unit = requireActiveUnit(state, action.actorId, unitId);
      if ('reason' in unit) return unit;
      if (hasTrait(unit.result.specialRules, 'immobile')) {
        return { valid: false, reason: 'Immobile units cannot move or charge' };
      }
      if (unit.result.hasAttacked && !unit.result.isRushing) {
        return { valid: false, reason: 'Unit has already moved or attacked this activation' };
      }
      if (unit.result.remainingMovement <= 0.01) {
        return { valid: false, reason: 'Unit has no remaining movement this activation' };
      }
      if (isEngaged(unit.result)) {
        return { valid: false, reason: 'Engaged units cannot move away' };
      }
      const isSquad = Boolean(modelPositions && modelPositions.length > 0);
      if (livingModels(unit.result).length > 1 && !isSquad) {
        return { valid: false, reason: 'Multi-model squad move requires modelPositions' };
      }
      if (!isSquad) {
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
        const isDifficult = isPathDifficult(state, path, unit.result);
        const distance = pathMovementCost(state, path, unit.result);
        const effectiveCap = getEffectiveMaxMovement(
          unit.result,
          unit.result.isRushing ? 'rush' : 'move',
          isDifficult
        );
        const maxMove = Math.min(effectiveCap, unit.result.remainingMovement);
        if (distance > maxMove + 0.01) {
          return {
            valid: false,
            reason: isDifficult && effectiveCap === 6.0
              ? 'Move exceeds Difficult Terrain speed cap (6.0")'
              : (distance > getEffectiveSpeed(unit.result) ? 'Move exceeds unit speed' : 'Move exceeds unit remaining movement allowance'),
          };
        }
        for (const point of path) {
          if (!isWithinBoard(state, point)) {
            return { valid: false, reason: 'Move leaves the board' };
          }
        }
        const wouldEngage = state.units.some(
          (u) =>
            !u.isDestroyed &&
            u.isDeployed !== false &&
            u.ownerId !== action.actorId &&
            pointEngagesUnit(end, u)
        );
        if (wouldEngage) {
          return {
            valid: false,
            reason: 'Move cannot end in melee contact (use Charge instead)',
          };
        }
        const blocker = findMoveBlocker(state, unit.result, path, { keepAway: true });
        if (blocker.blocked) {
          return { valid: false, reason: blocker.reason };
        }
        if (detectPathGapJump(state, path, unit.result).tooWide) {
          return { valid: false, reason: 'Gap is too wide to jump (6" maximum)' };
        }
        const jumpProblem = validateDeclaredTraversal(
          state,
          unit.result,
          path,
          (action.payload as { traversal?: DeclaredTraversal }).traversal
        );
        if (jumpProblem) return { valid: false, reason: jumpProblem };
        if (isSuspendedInMidAir(state, end)) {
          return { valid: false, reason: 'Models cannot end movement suspended in mid-air — stop at an edge or reach a floor' };
        }
        if (isBaseOverhanging(state, end)) {
          return { valid: false, reason: OVERHANG_REASON };
        }
        for (const piece of state.terrain) {
          if (isLadderPiece(piece) && isOnLadderClimbLine(state, piece, end)) {
            return {
              valid: false,
              reason: 'Models cannot end movement suspended on ladder rungs — must reach the platform or stop at the ladder foot',
            };
          }
        }
        const endOverlap = findEndOverlap(state, unit.result.id, end);
        if (endOverlap) return { valid: false, reason: describeEndOverlap(endOverlap) };
        return { valid: true };
      }

      // Multi-model squad validation: constituent models move along individual paths
      const activeCount = unit.result.models
        ? unit.result.models.filter((m) => !m.isDestroyed).length
        : 1;
      if (modelPositions!.length !== activeCount && activeCount > 1) {
        return {
          valid: false,
          reason: `Model positions count mismatch (${modelPositions!.length} vs ${activeCount} active models)`,
        };
      }
      if (modelTraversals && modelTraversals.length > modelPositions!.length) {
        return { valid: false, reason: 'More declared jumps than squad models' };
      }
      const crossProblem = validateCrossers(state, unit.result, action.payload as { crossers?: number[]; modelTraversals?: (DeclaredTraversal | null)[]; jumpLeader?: number }, modelPositions!);
      if (crossProblem) return { valid: false, reason: crossProblem };
      const coherency = squadEndCoherency(unit.result, modelPositions!, modelTraversals);
      if (!coherency.valid) return coherency;
      const spotProblem = takeoffSpotProblem(modelTraversals, modelPositions!, (action.payload as { jumpLeader?: number }).jumpLeader);
      if (spotProblem) return { valid: false, reason: spotProblem };
      const carried = crosserSet(action.payload as { crossers?: number[] });
      for (let i = 0; i < modelPositions!.length; i++) {
        for (let j = i + 1; j < modelPositions!.length; j++) {
          const dist = Math.hypot(
            modelPositions![i].x - modelPositions![j].x,
            modelPositions![i].z - modelPositions![j].z
          );
          if (dist < 0.90) {
            return {
              valid: false,
              reason: `Squad models ${i + 1} and ${j + 1} cannot overlap (distance ${dist.toFixed(1)}" < 0.9")`,
            };
          }
        }
      }
      for (const pos of modelPositions!) {
        if (!isWithinBoard(state, pos)) {
          return { valid: false, reason: 'Squad model position leaves the board' };
        }
      }
      const aliveModels = (unit.result.models ?? []).filter((m) => !m.isDestroyed);
      for (let i = 0; i < aliveModels.length && i < modelPositions!.length; i++) {
        if (carried.has(i)) continue; // placed across by `crossers`: no path, move or edge checks (validateCrossers did the spot)
        const mStart = aliveModels[i].position ?? unit.result.position;
        const mPath =
          modelPaths && modelPaths[i] && modelPaths[i].length >= 2
            ? modelPaths[i]
            : [mStart, modelPositions![i]];
        if (boardDistance(mPath[0], mStart) > 0.05) {
          return {
            valid: false,
            reason: `Squad model ${i + 1} move path does not start at model position`,
          };
        }
        for (const pt of mPath) {
          if (!isWithinBoard(state, pt)) {
            return { valid: false, reason: `Squad model ${i + 1} move path leaves the board` };
          }
        }
        const mDifficult = isPathDifficult(state, mPath, unit.result);
        const mCap = getEffectiveMaxMovement(
          unit.result,
          unit.result.isRushing ? 'rush' : 'move',
          mDifficult
        );
        const mMax = Math.min(mCap, modelRemainingMovement(unit.result, aliveModels[i], unit.result.remainingMovement));
        const mDist = pathMovementCost(state, mPath, unit.result);
        if (mDist > mMax + 0.05) {
          return {
            valid: false,
            reason: mDifficult && mCap === 6.0
              ? `Squad model ${i + 1} exceeds Difficult Terrain speed cap (6.0")`
              : `Squad model ${i + 1} movement exceeds speed allowance (${mDist.toFixed(1)}" vs ${mMax.toFixed(1)}")`,
          };
        }
        const mBlocker = findMoveBlocker(state, unit.result, mPath, { keepAway: true });
        if (mBlocker.blocked) {
          return {
            valid: false,
            reason: `Squad model ${i + 1} move path is blocked: ${mBlocker.reason}`,
          };
        }
        const mEnd = modelPositions![i];
        if (detectPathGapJump(state, mPath, unit.result).tooWide) {
          return { valid: false, reason: `Squad model ${i + 1} cannot cross a gap wider than 6"` };
        }
        const mJumpProblem = validateDeclaredTraversal(state, unit.result, mPath, modelTraversals?.[i]);
        if (mJumpProblem) {
          return { valid: false, reason: `Squad model ${i + 1}: ${mJumpProblem}` };
        }
        if (isSuspendedInMidAir(state, mEnd)) {
          return { valid: false, reason: `Squad model ${i + 1} cannot end movement suspended in mid-air — stop at an edge or reach a floor` };
        }
        if (isBaseOverhanging(state, mEnd)) {
          return { valid: false, reason: `Squad model ${i + 1}: ${OVERHANG_REASON}` };
        }
        for (const piece of state.terrain) {
          if (isLadderPiece(piece) && isOnLadderClimbLine(state, piece, mEnd)) {
            return {
              valid: false,
              reason: `Squad model ${i + 1} cannot end movement suspended on ladder rungs — must reach the platform or stop at the ladder foot`,
            };
          }
        }
        const mOverlap = findEndOverlap(state, unit.result.id, mEnd);
        if (mOverlap) {
          return { valid: false, reason: `Squad model ${i + 1}: ${describeEndOverlap(mOverlap)}` };
        }
      }
      const wouldEngage = state.units.some(
        (u) =>
          !u.isDestroyed &&
          u.isDeployed !== false &&
          u.ownerId !== action.actorId &&
          modelPositions!.some((pos) => pointEngagesUnit(pos, u))
      );
      if (wouldEngage) {
        return {
          valid: false,
          reason: 'Move cannot end in melee contact (use Charge instead)',
        };
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
      if (attacker.result.isRushing) {
        return { valid: false, reason: 'Rushing units cannot shoot' };
      }
      // Shooting without having moved is a Hold: a squad that started out of coherency must move first
      if (!attacker.result.hasMoved) {
        const blocked = incoherentStartBlock(attacker.result);
        if (blocked) return blocked;
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
      const targetByWeaponName = new Map<string, string>();

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
        // Weapons of the same name are one group: they cannot be split over different targets
        const groupTarget = targetByWeaponName.get(weapon.name);
        if (groupTarget !== undefined && groupTarget !== alloc.targetId) {
          return { valid: false, reason: `All ${weapon.name} weapons must shoot the same target` };
        }
        targetByWeaponName.set(weapon.name, alloc.targetId);

        const target = requireTarget(state, action.actorId, alloc.targetId);
        if ('reason' in target) return target;

        if (!isCarried(attacker.result, weapon)) {
          return { valid: false, reason: `No living model carries ${weapon.name}` };
        }
        if (firingModels(state, attacker.result, target.result, weapon).length === 0) {
          // Tell the player which condition failed (closest models decide range).
          const carriers = (attacker.result.models ?? []).filter((m) => !m.isDestroyed && modelCarries(m, weapon.id));
          const reach = unitDistance({ ...attacker.result, models: carriers.length > 0 ? carriers : attacker.result.models }, target.result);
          return {
            valid: false,
            reason: reach > weapon.profile.range + 0.01 ? 'Target out of range' : 'No line of sight to target',
          };
        }
      }

      // Split fire constraint: maximum 2 distinct targets
      if (targetIds.size > 2) {
        return { valid: false, reason: 'Cannot split fire across more than 2 distinct targets' };
      }

      return { valid: true };
    }

    case 'begin-charge': {
      const { attackerId, targetId } = action.payload as { attackerId: string; targetId: string };
      const attacker = requireActiveUnit(state, action.actorId, attackerId);
      if ('reason' in attacker) return attacker;
      if (state.turnState.charge) {
        return { valid: false, reason: 'A charge is already declared' };
      }
      if (hasTrait(attacker.result.specialRules, 'immobile')) {
        return { valid: false, reason: 'Immobile units cannot move or charge' };
      }
      if (attacker.result.hasMoved || attacker.result.hasAttacked) {
        return { valid: false, reason: 'Unit has already moved or attacked this activation' };
      }
      if (isEngaged(attacker.result)) {
        return { valid: false, reason: 'Already engaged — fight instead' };
      }
      const target = requireTarget(state, action.actorId, targetId);
      if ('reason' in target) return target;
      if (!hasMeleeWeapon(attacker.result)) {
        return { valid: false, reason: 'No equipped melee weapon for charge strike' };
      }
      // The target must be within charge reach at the start (straight line to base contact; a lower bound
      // on any real path, so legs can then only get closer or fail).
      const contactSpot = chargeDestination(attacker.result, target.result);
      if (boardDistance(attacker.result.position, contactSpot) > chargeBudget(attacker.result) + 0.01) {
        return { valid: false, reason: 'Target out of charge range' };
      }
      return { valid: true };
    }

    case 'charge-leg': {
      const { attackerId, path, traversal } = action.payload as {
        attackerId: string;
        path: Vector3[];
        traversal?: DeclaredTraversal;
      };
      const legModels = action.payload as SquadChargePayload;
      const attacker = requireActiveUnit(state, action.actorId, attackerId);
      if ('reason' in attacker) return attacker;
      const unit = attacker.result;
      const charge = declaredCharge(state, unit.id);
      if (!charge) return { valid: false, reason: 'No charge is declared' };
      const target = getUnit(state, charge.targetId);
      if (!target || target.isDestroyed) return { valid: false, reason: 'Charge target is gone' };
      if (isEngaged(unit)) return { valid: false, reason: 'Already engaged — fight instead' };
      if (unit.remainingMovement <= 0.01) {
        return { valid: false, reason: 'No charge movement left' };
      }
      if (isSquadChargePayload(unit, legModels)) {
        return validateSquadChargeMove(state, unit, target, legModels, 'leg');
      }
      if (livingModels(unit).length > 1) return { valid: false, reason: SQUAD_CHARGE_NEEDS_POSITIONS };
      if (!path || path.length < 2) return { valid: false, reason: 'Charge leg path is empty' };
      if (boardDistance(path[0], unit.position) > 0.01) {
        return { valid: false, reason: 'Charge leg must start at the unit position' };
      }
      const end = path[path.length - 1];
      const isDifficult = isPathDifficult(state, path, unit);
      const distance = pathMovementCost(state, path, unit);
      const cap = getEffectiveMaxMovement(unit, 'charge', isDifficult);
      if (distance > unit.remainingMovement + 0.01 || chargeSpent(unit) + distance > cap + 0.01) {
        return {
          valid: false,
          reason: isDifficult && cap === 6.0
            ? 'Charge in Difficult Terrain is capped at 6.0" (speed bonus negated)'
            : 'Charge leg exceeds the remaining charge movement',
        };
      }
      for (const point of path) {
        if (!isWithinBoard(state, point)) return { valid: false, reason: 'Move leaves the board' };
      }
      // Keep-away applies to every unit except the declared target, which may be approached into contact.
      const blocker = findMoveBlocker(state, unit, path, { ignoreUnitId: target.id, keepAway: true });
      if (blocker.blocked) return { valid: false, reason: blocker.reason };
      if (detectPathGapJump(state, path, unit).tooWide) {
        return { valid: false, reason: 'Gap is too wide to jump (6" maximum)' };
      }
      const legJumpProblem = validateDeclaredTraversal(state, unit, path, traversal);
      if (legJumpProblem) return { valid: false, reason: legJumpProblem };
      if (isSuspendedInMidAir(state, end)) {
        return { valid: false, reason: 'Models cannot end movement suspended in mid-air — stop at an edge or reach a floor' };
      }
      if (isBaseOverhanging(state, end)) return { valid: false, reason: OVERHANG_REASON };
      for (const piece of state.terrain) {
        if (isLadderPiece(piece) && isOnLadderClimbLine(state, piece, end)) {
          return {
            valid: false,
            reason: 'Models cannot end movement suspended on ladder rungs — must reach the platform or stop at the ladder foot',
          };
        }
      }
      const legOverlap = findEndOverlap(state, unit.id, end);
      if (legOverlap) return { valid: false, reason: describeEndOverlap(legOverlap) };
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
      const legs = declaredCharge(state, attackerId);
      if (legs && legs.targetId !== targetId) {
        return { valid: false, reason: 'The declared charge is locked to its target' };
      }
      if (hasTrait(attacker.result.specialRules, 'immobile')) {
        return { valid: false, reason: 'Immobile units cannot move or charge' };
      }
      if ((attacker.result.hasMoved && !legs) || attacker.result.hasAttacked) {
        return { valid: false, reason: 'Unit has already moved or attacked this activation' };
      }
      const target = requireTarget(state, action.actorId, targetId);
      if ('reason' in target) return target;
      if (isEngaged(attacker.result)) {
        return { valid: false, reason: 'Already engaged — fight instead' };
      }
      const squadMoves = action.payload as SquadChargePayload;
      if (isSquadChargePayload(attacker.result, squadMoves)) {
        const squadResult = validateSquadChargeMove(state, attacker.result, target.result, squadMoves, 'final');
        if (!squadResult.valid) return squadResult;
        if (chargeWeaponProblem(attacker.result, weaponId)) {
          return { valid: false, reason: 'No equipped melee weapon for charge strike' };
        }
        return { valid: true };
      }
      if (livingModels(attacker.result).length > 1) return { valid: false, reason: SQUAD_CHARGE_NEEDS_POSITIONS };
      if (!path || path.length === 0) {
        return { valid: false, reason: 'Charge path is empty' };
      }
      const fullPath =
        boardDistance(path[0], attacker.result.position) < 0.01
          ? path
          : [{ ...attacker.result.position }, ...path];
      const isDifficult = isPathDifficult(state, fullPath, attacker.result);
      const distance = pathMovementCost(state, fullPath, attacker.result);
      const maxCharge = getEffectiveMaxMovement(attacker.result, 'charge', isDifficult);
      // After legs, the final move may only use what the legs left of the one charge budget
      const spent = legs ? chargeSpent(attacker.result) : 0;
      if (distance + spent > maxCharge + 0.01 || (legs && distance > attacker.result.remainingMovement + 0.01)) {
        return {
          valid: false,
          reason: isDifficult
            ? 'Charge in Difficult Terrain is capped at 6.0" (speed bonus negated)'
            : 'Target out of charge range',
        };
      }
      const chargeBlocker = findMoveBlocker(state, attacker.result, fullPath, {
        ignoreUnitId: target.result.id,
        keepAway: true,
      });
      if (chargeBlocker.blocked) {
        return { valid: false, reason: chargeBlocker.reason };
      }
      if (detectPathGapJump(state, fullPath, attacker.result).tooWide) {
        return { valid: false, reason: 'Gap is too wide to jump (6" maximum)' };
      }
      const chargeJumpProblem = validateDeclaredTraversal(
        state,
        attacker.result,
        fullPath,
        (action.payload as { traversal?: DeclaredTraversal }).traversal
      );
      if (chargeJumpProblem) return { valid: false, reason: chargeJumpProblem };
      const end = path[path.length - 1];
      if (isBaseOverhanging(state, end)) return { valid: false, reason: OVERHANG_REASON };
      const chargeOverlap = findEndOverlap(state, attacker.result.id, end);
      if (chargeOverlap) return { valid: false, reason: describeEndOverlap(chargeOverlap) };
      const contact = chargeContact(attacker.result, target.result, end, MELEE_MAX_VERTICAL_REACH);
      if (contact === 'too-far') {
        return { valid: false, reason: 'Charge must end in engagement range' };
      }
      if (contact === 'too-high') {
        return {
          valid: false,
          reason: 'Target is on a ledge outside vertical melee reach (> 4.0" vertical difference)',
        };
      }
      if (chargeWeaponProblem(attacker.result, weaponId)) {
        return { valid: false, reason: 'No equipped melee weapon for charge strike' };
      }
      return { valid: true };
    }

    case 'rush': {
      const { unitId, path, finalPosition, modelPositions, modelPaths, modelTraversals } = action.payload as {
        unitId: string;
        path: Vector3[];
        finalPosition?: Vector3;
        modelPositions?: Vector3[];
        modelPaths?: Vector3[][];
        modelTraversals?: (DeclaredTraversal | null)[];
      };
      const actor = requireActiveUnit(state, action.actorId, unitId);
      if ('reason' in actor) return actor;
      const unit = actor.result;
      if (hasTrait(unit.specialRules, 'immobile')) {
        return { valid: false, reason: 'Immobile units cannot move or rush' };
      }
      if (unit.hasMoved && !unit.isRushing) {
        return { valid: false, reason: 'Unit has already moved or attacked this activation' };
      }
      if (unit.hasAttacked && !unit.isRushing) {
        return { valid: false, reason: 'Unit has already moved or attacked this activation' };
      }
      if (unit.isRushing && unit.remainingMovement <= 0.01) {
        return { valid: false, reason: 'Unit has no remaining movement this activation' };
      }
      if (isEngaged(unit)) {
        return { valid: false, reason: 'Engaged units cannot rush' };
      }
      const isSquad = Boolean(modelPositions && modelPositions.length > 0);
      if (livingModels(unit).length > 1 && !isSquad) {
        return { valid: false, reason: 'Multi-model squad move requires modelPositions' };
      }
      const currentRushBudget = unit.isRushing ? unit.remainingMovement : getEffectiveSpeed(unit) * 2;

      if (!isSquad) {
        if (!path || path.length === 0) {
          return { valid: false, reason: 'Rush path is empty' };
        }
        const fullPath =
          boardDistance(path[0], unit.position) < 0.01
            ? path
            : [{ ...unit.position }, ...path];
        const isDifficult = isPathDifficult(state, fullPath, unit);
        const dist = pathMovementCost(state, fullPath, unit);
        const effectiveCap = getEffectiveMaxMovement(unit, 'rush', isDifficult);
        const maxRush = Math.min(effectiveCap, currentRushBudget);
        if (dist > maxRush + 0.01) {
          return {
            valid: false,
            reason: isDifficult && maxRush === 6.0
              ? 'Rush in Difficult Terrain is capped at 6.0" (speed bonus negated)'
              : (dist > getEffectiveSpeed(unit) * 2
                  ? `Rush distance exceeds double speed (${dist.toFixed(1)}" vs ${(getEffectiveSpeed(unit) * 2).toFixed(1)}")`
                  : `Rush distance exceeds remaining rush allowance (${dist.toFixed(1)}" vs ${maxRush.toFixed(1)}")`),
          };
        }
        const blocker = findMoveBlocker(state, unit, fullPath, { keepAway: true });
        if (blocker.blocked) {
          return { valid: false, reason: blocker.reason };
        }
        const end = path[path.length - 1];
        if (finalPosition && boardDistance(end, finalPosition) > 0.01) {
          return { valid: false, reason: 'Final position does not match path end' };
        }
        if (detectPathGapJump(state, fullPath, unit).tooWide) {
          return { valid: false, reason: 'Gap is too wide to jump (6" maximum)' };
        }
        const jumpProblem = validateDeclaredTraversal(
          state,
          unit,
          fullPath,
          (action.payload as { traversal?: DeclaredTraversal }).traversal
        );
        if (jumpProblem) return { valid: false, reason: jumpProblem };
        if (isSuspendedInMidAir(state, end)) {
          return { valid: false, reason: 'Models cannot end movement suspended in mid-air — stop at an edge or reach a floor' };
        }
        if (isBaseOverhanging(state, end)) {
          return { valid: false, reason: OVERHANG_REASON };
        }
        for (const piece of state.terrain) {
          if (isLadderPiece(piece) && isOnLadderClimbLine(state, piece, end)) {
            return {
              valid: false,
              reason: 'Models cannot end movement suspended on ladder rungs — must reach the platform or stop at the ladder foot',
            };
          }
        }
        const endOverlap = findEndOverlap(state, unit.id, end);
        if (endOverlap) return { valid: false, reason: describeEndOverlap(endOverlap) };
        const wouldEngage = state.units.some(
          (u) =>
            !u.isDestroyed &&
            u.isDeployed !== false &&
            u.ownerId !== action.actorId &&
            pointEngagesUnit(end, u)
        );
        if (wouldEngage) {
          return {
            valid: false,
            reason: 'Rush cannot end in melee contact (use Charge instead)',
          };
        }
        return { valid: true };
      }

      // Multi-model squad validation for rush
      const activeCount = unit.models
        ? unit.models.filter((m) => !m.isDestroyed).length
        : 1;
      if (modelPositions!.length !== activeCount && activeCount > 1) {
        return {
          valid: false,
          reason: `Model positions count mismatch (${modelPositions!.length} vs ${activeCount} active models)`,
        };
      }
      if (modelTraversals && modelTraversals.length > modelPositions!.length) {
        return { valid: false, reason: 'More declared jumps than squad models' };
      }
      const crossProblem = validateCrossers(state, unit, action.payload as { crossers?: number[]; modelTraversals?: (DeclaredTraversal | null)[]; jumpLeader?: number }, modelPositions!);
      if (crossProblem) return { valid: false, reason: crossProblem };
      const coherency = squadEndCoherency(unit, modelPositions!, modelTraversals);
      if (!coherency.valid) return coherency;
      const spotProblem = takeoffSpotProblem(modelTraversals, modelPositions!, (action.payload as { jumpLeader?: number }).jumpLeader);
      if (spotProblem) return { valid: false, reason: spotProblem };
      const carried = crosserSet(action.payload as { crossers?: number[] });
      for (let i = 0; i < modelPositions!.length; i++) {
        for (let j = i + 1; j < modelPositions!.length; j++) {
          const dist = Math.hypot(
            modelPositions![i].x - modelPositions![j].x,
            modelPositions![i].z - modelPositions![j].z
          );
          if (dist < 0.90) {
            return {
              valid: false,
              reason: `Squad models ${i + 1} and ${j + 1} cannot overlap (distance ${dist.toFixed(1)}" < 0.9")`,
            };
          }
        }
      }
      for (const pos of modelPositions!) {
        if (!isWithinBoard(state, pos)) {
          return { valid: false, reason: 'Squad model position leaves the board' };
        }
      }
      const aliveModels = (unit.models ?? []).filter((m) => !m.isDestroyed);
      for (let i = 0; i < aliveModels.length && i < modelPositions!.length; i++) {
        if (carried.has(i)) continue; // placed across by `crossers`: no path, move or edge checks (validateCrossers did the spot)
        const mStart = aliveModels[i].position ?? unit.position;
        const mPath =
          modelPaths && modelPaths[i] && modelPaths[i].length >= 2
            ? modelPaths[i]
            : [mStart, modelPositions![i]];
        if (boardDistance(mPath[0], mStart) > 0.05) {
          return {
            valid: false,
            reason: `Squad model ${i + 1} rush path does not start at model position`,
          };
        }
        for (const pt of mPath) {
          if (!isWithinBoard(state, pt)) {
            return { valid: false, reason: `Squad model ${i + 1} path leaves the board` };
          }
        }
        const mDifficult = isPathDifficult(state, mPath, unit);
        const mCap = getEffectiveMaxMovement(unit, 'rush', mDifficult);
        const mMax = Math.min(mCap, modelRemainingMovement(unit, aliveModels[i], currentRushBudget));
        const mDist = pathMovementCost(state, mPath, unit);
        if (mDist > mMax + 0.05) {
          return {
            valid: false,
            reason: mDifficult && mCap === 6.0
              ? `Squad model ${i + 1} exceeds Difficult Terrain speed cap (6.0")`
              : `Squad model ${i + 1} movement exceeds speed allowance (${mDist.toFixed(1)}" vs ${mMax.toFixed(1)}")`,
          };
        }
        const mBlocker = findMoveBlocker(state, unit, mPath, { keepAway: true });
        if (mBlocker.blocked) {
          return {
            valid: false,
            reason: `Squad model ${i + 1} rush path is blocked: ${mBlocker.reason}`,
          };
        }
        const mEnd = modelPositions![i];
        const mJumpProblem = validateDeclaredTraversal(state, unit, mPath, modelTraversals?.[i]);
        if (mJumpProblem) {
          return { valid: false, reason: `Squad model ${i + 1}: ${mJumpProblem}` };
        }
        if (detectPathGapJump(state, mPath, unit).tooWide) {
          return { valid: false, reason: `Squad model ${i + 1} cannot cross a gap wider than 6"` };
        }
        if (isSuspendedInMidAir(state, mEnd)) {
          return { valid: false, reason: `Squad model ${i + 1} cannot end movement suspended in mid-air — stop at an edge or reach a floor` };
        }
        if (isBaseOverhanging(state, mEnd)) {
          return { valid: false, reason: `Squad model ${i + 1}: ${OVERHANG_REASON}` };
        }
        for (const piece of state.terrain) {
          if (isLadderPiece(piece) && isOnLadderClimbLine(state, piece, mEnd)) {
            return {
              valid: false,
              reason: `Squad model ${i + 1} cannot end movement suspended on ladder rungs — must reach the platform or stop at the ladder foot`,
            };
          }
        }
        const mOverlap = findEndOverlap(state, unit.id, mEnd);
        if (mOverlap) {
          return { valid: false, reason: `Squad model ${i + 1}: ${describeEndOverlap(mOverlap)}` };
        }
      }
      const wouldEngage = state.units.some(
        (u) =>
          !u.isDestroyed &&
          u.isDeployed !== false &&
          u.ownerId !== action.actorId &&
          modelPositions!.some((pos) => pointEngagesUnit(pos, u))
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
      const distance = unitDistance(attacker.result, target.result);
      if (distance > ENGAGEMENT_EDGE_GAP + 0.01) {
        return { valid: false, reason: 'Target not in engagement range' };
      }
      if (!modelsWithin(attacker.result, target.result, ENGAGEMENT_EDGE_GAP + 0.01, MELEE_MAX_VERTICAL_REACH)) {
        return {
          valid: false,
          reason: 'Target is on a ledge outside vertical melee reach (> 4.0" vertical difference)',
        };
      }
      // The unit strikes with every melee weapon it carries; a named weapon is only checked for sanity
      const weapon = getWeapon(attacker.result, weaponId ?? '');
      if (!weapon || !isMeleeWeapon(weapon) || !hasMeleeWeapon(attacker.result)) {
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
      // Confirm on a push is the HUD's pick-a-spot mode: the move itself arrives as a `push-move`
      if (pending.type === 'push' && choiceId !== PUSH_AUTO_CHOICE && choiceId !== PUSH_DECLINE_CHOICE) {
        return { valid: false, reason: 'Choose Auto, Don\'t push, or send a push-move' };
      }
      return { valid: true };
    }

    case 'pick-casualties': {
      const pending = state.turnState.pendingReaction;
      if (!pending || pending.type !== 'pick-casualties') {
        return { valid: false, reason: 'No pending casualty pick' };
      }
      const result = validatePickCasualties(state, pending, action.actorId, action.payload as PickCasualtiesPayload);
      return result.valid ? { valid: true } : { valid: false, reason: result.reason };
    }

    case 'blast-split': {
      const pending = state.turnState.pendingReaction;
      if (!pending || pending.type !== 'blast-split') {
        return { valid: false, reason: 'No pending Blast split' };
      }
      const result = validateBlastSplit(state, pending, action.actorId, action.payload as BlastSplitPayload);
      return result.valid ? { valid: true } : { valid: false, reason: result.reason };
    }

    case 'push-move': {
      const pending = state.turnState.pendingReaction;
      if (!pending || pending.type !== 'push') return { valid: false, reason: 'No pending push' };
      if (pending.promptingPlayerId !== action.actorId) return { valid: false, reason: 'Not your push' };
      const resolved = pushResolution(state, action);
      if (!resolved) return { valid: false, reason: 'No pending push' };
      if (!resolved.model) return { valid: false, reason: 'Pick a living model of the Shaken unit' };
      if (!resolved.plan.ok) return { valid: false, reason: resolved.plan.reason };
      return { valid: true };
    }

    case 'pile-in-move': {
      const pending = state.turnState.pendingReaction;
      if (!pending || pending.type !== 'pile-in') {
        return { valid: false, reason: 'No pending pile-in' };
      }
      if (pending.promptingPlayerId !== action.actorId) {
        return { valid: false, reason: 'Not your pile-in' };
      }
      const defender = getUnit(state, pending.targetUnitId);
      const charger = getUnit(state, pending.sourceUnitId);
      if (!defender || defender.isDestroyed || !charger || charger.isDestroyed) {
        return { valid: false, reason: 'Pile-in units are destroyed or missing' };
      }
      const result = validatePileIn(state, pending, defender, charger, action.payload as PileInPayload);
      return result.valid ? { valid: true } : { valid: false, reason: result.reason };
    }

    case 'consolidate-move': {
      const { unitId, path, modelPositions, modelPaths } = action.payload as {
        unitId: string;
        path: Vector3[];
        modelPositions?: Vector3[];
        modelPaths?: Vector3[][];
      };
      const pending = state.turnState.pendingReaction;
      if (!pending || pending.type !== 'melee-consolidation') {
        return { valid: false, reason: 'No pending consolidation move' };
      }
      if (pending.promptingPlayerId !== action.actorId) {
        return { valid: false, reason: 'Not your consolidation turn' };
      }
      if (pending.data?.unitId !== unitId) {
        return { valid: false, reason: 'Unit does not match consolidation' };
      }
      const unit = getUnit(state, unitId);
      if (!unit || unit.isDestroyed) {
        return { valid: false, reason: 'Consolidating unit is destroyed or missing' };
      }
      const maxDistance = pending.data?.maxDistance ?? 3.0;
      const alive = livingModels(unit);
      const isSquad = Boolean(modelPositions && modelPositions.length > 0);
      if (alive.length > 1 && !isSquad) {
        return { valid: false, reason: 'Multi-model squad consolidation requires modelPositions' };
      }

      if (!isSquad) {
        if (!path || path.length < 2) {
          return { valid: false, reason: 'Consolidation path is empty' };
        }
        if (
          boardDistance(path[0], unit.position) > 0.05 ||
          Math.abs((path[0].y ?? 0) - (unit.position.y ?? 0)) > 0.05
        ) {
          return { valid: false, reason: 'Consolidation path must start at unit position' };
        }
        return validateConsolidationPath(state, unit, path, maxDistance, action.actorId);
      }

      if (alive.length > 1 && modelPositions!.length !== alive.length) {
        return {
          valid: false,
          reason: `Model positions count mismatch (${modelPositions!.length} vs ${alive.length} active models)`,
        };
      }
      if (modelPaths && modelPaths.length > modelPositions!.length) {
        return { valid: false, reason: 'More model paths than squad models' };
      }
      const coherency = squadEndCoherency(unit, modelPositions!);
      if (!coherency.valid) return coherency;
      for (let i = 0; i < modelPositions!.length; i++) {
        for (let j = i + 1; j < modelPositions!.length; j++) {
          const dist = Math.hypot(
            modelPositions![i].x - modelPositions![j].x,
            modelPositions![i].z - modelPositions![j].z
          );
          if (dist < 0.90) {
            return {
              valid: false,
              reason: `Squad models ${i + 1} and ${j + 1} cannot overlap (distance ${dist.toFixed(1)}" < 0.9")`,
            };
          }
        }
      }
      const resolvedPaths = squadMovePaths(unit, { modelPositions, modelPaths });
      for (let i = 0; i < resolvedPaths.length && i < modelPositions!.length; i++) {
        const mStart = alive[i].position ?? unit.position;
        const mEnd = modelPositions![i];
        const mPath = resolvedPaths[i];
        if (
          boardDistance(mPath[0], mStart) > 0.05 ||
          Math.abs((mPath[0].y ?? 0) - (mStart.y ?? 0)) > 0.05
        ) {
          return { valid: false, reason: `Squad model ${i + 1} consolidation path does not start at model position` };
        }
        if (
          boardDistance(mPath[mPath.length - 1], mEnd) > 0.05 ||
          Math.abs((mPath[mPath.length - 1].y ?? 0) - (mEnd.y ?? 0)) > 0.05
        ) {
          return { valid: false, reason: `Squad model ${i + 1} consolidation path does not end at model position` };
        }
        const check = validateConsolidationPath(
          state,
          unit,
          mPath,
          maxDistance,
          action.actorId,
          `Squad model ${i + 1}`
        );
        if (!check.valid) return check;
      }
      return { valid: true };
    }

    case 'end-activation': {
      if (!state.turnState.activeUnitId) {
        return { valid: false, reason: 'No unit is activating' };
      }
      const activeUnit = getUnit(state, state.turnState.activeUnitId);
      if (activeUnit && !activeUnit.hasMoved && !activeUnit.hasAttacked) {
        const blocked = incoherentStartBlock(activeUnit);
        if (blocked) return blocked;
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
  const specs = getBaseDiceSpecs(state, action);
  // A move that can end in a fall can wound the mover and so end its activation with a Morale Test
  if (
    specs &&
    (action.type === 'advance' || action.type === 'rush' || action.type === 'charge-leg' || action.type === 'charge') &&
    specs.some((sp) => /^(jump|fall)$/.test(sp.purpose ?? ''))
  ) {
    const payload = action.payload as { unitId?: string; attackerId?: string };
    const mover = getUnit(state, payload.unitId ?? payload.attackerId ?? '');
    if (mover) return [...specs, ...selfMoraleSpecs(mover)];
  }
  return specs;
}

function getBaseDiceSpecs(state: GameState, action: GameAction): DiceSpec[] | null {
  if (action.type === 'roll-objectives') {
    // One d6 for the objective count, then the mission roll-off (who places the first objective)
    return [{ count: 1, sides: 6, purpose: OBJECTIVE_COUNT_PURPOSE }, rollOffSpec(MISSION_ROLL_OFF_PURPOSE)];
  }
  if (action.type === 'place-objective') {
    // The last marker ends the phase: the deployment roll-off (who deploys and activates first) is rolled with it
    const count = state.setupRolls?.objectiveCount;
    const placed = (state.objectives ?? []).length;
    return count !== undefined && placed + 1 === count ? [rollOffSpec(DEPLOYMENT_ROLL_OFF_PURPOSE)] : null;
  }

  if (action.type === 'end-activation') {
    // Every unit that took a wound this activation and is now at half strength or less tests Morale
    const active = getActiveUnit(state);
    // Match finishActivation: an active Shaken unit sheds Shaken before end-of-activation Morale Tests run
    const stateForMorale =
      active && active.status.includes('shaken')
        ? {
            ...state,
            units: state.units.map((u) =>
              u.id === active.id ? { ...u, status: u.status.filter((s) => s !== 'shaken') } : u
            ),
          }
        : state;
    const unitsForMorale = getUnitsRequiringMorale(stateForMorale);
    const counts = moraleDiceCounts(unitsForMorale);
    const specs: DiceSpec[] = [];
    if (counts.morale > 0) specs.push({ count: counts.morale, sides: 6, purpose: 'morale' });
    if (counts.fearless > 0) specs.push({ count: counts.fearless, sides: 6, purpose: 'fearless' });
    // One push die per tested unit that an enemy attacked and that is not Shaken yet (used only if it becomes Shaken)
    const pushable = unitsForMorale.filter(
      (u) => !u.status.includes('shaken') && pushAttackerFor(stateForMorale, u, active)
    ).length;
    if (pushable > 0) specs.push({ count: pushable, sides: 6, purpose: 'push' });
    return specs.length > 0 ? specs : null;
  }

  if (action.type === 'activate-unit' || (action.type === 'hold' && !state.turnState.activeUnitId)) {
    const unit = getUnit(state, (action.payload as PayloadWithUnitId).unitId);
    const specs = unit ? activationHazardSpecs(state, unit) : [];
    // A hold ends the activation at once, so wounds from the hazard test can owe a Morale Test
    if (unit && action.type === 'hold' && specs.length > 0) specs.push(...selfMoraleSpecs(unit));
    return specs.length > 0 ? specs : null;
  }

  if (action.type === 'advance' || action.type === 'rush') {
    const payload = action.payload as {
      unitId?: string;
      path?: Vector3[];
      modelPaths?: Vector3[][];
      modelPositions?: Vector3[];
      modelTraversals?: (DeclaredTraversal | null)[];
      jumpLeader?: number;
    };
    const unit = payload.unitId ? getUnit(state, payload.unitId) : undefined;
    const path = payload.path;
    const specs: DiceSpec[] = [];
    if (unit) specs.push(...legJumpSpecs(state, unit, moveLegEntries(unit, payload)));
    if (unit) {
      // Mirrors the apply path: a squad move is judged on its model paths (or synthesized straight segments), a single model on its path
      const carried = crosserSet(payload as { crossers?: number[] });
      const paths =
        payload.modelPositions && payload.modelPositions.length > 0
          ? squadMovePaths(unit, payload).filter((_, i) => !carried.has(i))
          : payload.modelPaths && payload.modelPaths.length > 0
            ? payload.modelPaths.filter((_, i) => !carried.has(i))
            : path && path.length > 0
              ? [path]
              : [];
      specs.push(...pathTraversalSpecs(state, unit, paths));
    }
    return specs.length > 0 ? specs : null;
  }

  if (action.type === 'charge-leg') {
    const payload = action.payload as { attackerId?: string; path?: Vector3[] } & SquadChargePayload;
    const unit = payload.attackerId ? getUnit(state, payload.attackerId) : undefined;
    if (unit && isSquadChargePayload(unit, payload)) {
      const squadSpecs = squadChargeTraversalSpecs(state, unit, payload);
      return squadSpecs.length > 0 ? squadSpecs : null;
    }
    if (!unit || !payload.path || payload.path.length === 0) return null;
    const specs = [...legJumpSpecs(state, unit, chargeLegEntries(unit, payload)), ...pathTraversalSpecs(state, unit, [payload.path])];
    return specs.length > 0 ? specs : null;
  }

  if (action.type === 'pile-in-move') return pileInStrikeSpecs(state, action);

  if (action.type === 'push-move' || (action.type === 'respond-reaction' && state.turnState.pendingReaction?.type === 'push')) {
    if (action.type === 'respond-reaction' && (action.payload as { choiceId?: string }).choiceId === PUSH_DECLINE_CHOICE) return null;
    const resolved = pushResolution(state, action);
    return resolved?.model && resolved.plan.ok && resolved.plan.fallDice > 0
      ? [{ count: resolved.plan.fallDice, sides: 6, purpose: 'fall' }]
      : null;
  }

  if (action.type === 'respond-reaction') {
    const { choiceId } = action.payload as { reactionId: string; choiceId: string };
    const pending = state.turnState.pendingReaction;
    if (pending?.type === 'pile-in') return choiceId === PILE_IN_AUTO_CHOICE ? pileInStrikeSpecs(state, action) : null;
    if (!pending || choiceId !== 'strike-back') {
      return null;
    }
    const defender = getUnit(state, pending.targetUnitId);
    const charger = getUnit(state, pending.sourceUnitId);
    if (!defender || !charger) return null;
    const entries = strikeBackEntries(defender, charger, pending);
    if (entries.length === 0) return null;

    const isTargetFatigued = defender.status.includes('fatigued') || defender.status.includes('shaken');
    return strikeSpecs(entries, defender, charger, { isCharging: false, isFatigued: isTargetFatigued, distance: 1 });
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

      const distance = unitDistance(attacker, target);
      const aliveDefenderModels = Math.max(1, target.models?.filter((m) => !m.isDestroyed).length ?? 1);
      // Only models that can see and reach the target contribute attacks.
      const firingCount = Math.max(1, firingModels(state, attacker, target, weapon).length);
      const totalAttacks = attacks * firingCount;
      const specs = getAttackDiceSpecs(totalAttacks, {
        attackerRules: attacker.specialRules,
        weaponRules: weapon.profile.specialRules,
        defenderRules: target.specialRules ?? [],
        defenderModelCount: aliveDefenderModels,
        isMelee: false,
        isCharging: false,
        distance,
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

      // Blast spills onto other enemy units near the target: each gets its own defense batch (sized for the
      // most hits its models could take; the split itself is only known once the to-hit dice are rolled).
      if (hasTrait(weapon.profile.specialRules, 'blast')) {
        for (const spill of getBlastParticipants(state, attacker, target).slice(1)) {
          const spillSpecs = getAttackDiceSpecs(totalAttacks, {
            attackerRules: attacker.specialRules,
            weaponRules: weapon.profile.specialRules,
            defenderRules: spill.unit.specialRules ?? [],
            defenderModelCount: spill.cap,
            isMelee: false,
            isCharging: false,
            distance,
          });
          for (const s of spillSpecs) {
            if (s.purpose === 'to-hit') continue;
            allSpecs.push({
              ...s,
              purpose: blastPurpose(
                spill.unit.id,
                s.purpose === 'regeneration' ? 'regeneration' : 'defense',
                isSingle ? undefined : index
              ),
            });
          }
        }
      }
    });

    return allSpecs.length > 0 ? allSpecs : null;
  }

  if (action.type !== 'fight' && action.type !== 'charge') return null;

  const payload = action.payload as { attackerId: string; targetId: string };
  const attacker = getUnit(state, payload.attackerId);
  const target = getUnit(state, payload.targetId);
  if (!attacker || !hasMeleeWeapon(attacker)) return null;

  const isMelee = true;
  const distance = target ? unitDistance(attacker, target) : 12;
  let strikeAttacker: Unit = attacker;
  let strikeTarget: Unit | undefined = target;
  let chargeExtras: DiceSpec[] = [];
  if (target) {
    if (action.type === 'charge') {
      // Strikers are counted after the charger has moved in and the defenders have piled in.
      const squadMoves = action.payload as SquadChargePayload;
      const chargeEnd = (action.payload as { path?: Vector3[] }).path?.slice(-1)[0];
      if (isSquadChargePayload(attacker, squadMoves) || chargeEnd) {
        const sim = JSON.parse(JSON.stringify(state)) as GameState;
        const simAttacker = getUnit(sim, attacker.id)!;
        const simTarget = getUnit(sim, target.id)!;
        if (isSquadChargePayload(attacker, squadMoves)) placeSquadModels(simAttacker, squadMoves.modelPositions!);
        else moveChargerModels(simAttacker, chargeEnd!);
        // Defenders not touching a charger place their own models first: the strike dice are rolled with that
        // pile-in (so a charge that has to wait only rolls its jump / hazard dice here)
        if (pileInModelIds(simTarget, simAttacker).length > 0) {
          const chargePayload = action.payload as { path?: Vector3[] } & SquadChargePayload;
          const moveSpecs = isSquadChargePayload(attacker, chargePayload)
            ? squadChargeTraversalSpecs(state, attacker, chargePayload)
            : chargePayload.path && chargePayload.path.length > 0
              ? [
                  ...legJumpSpecs(state, attacker, chargeLegEntries(attacker, chargePayload)),
                  ...pathTraversalSpecs(state, attacker, [chargePayload.path]),
                ]
              : [];
          return moveSpecs.length > 0 ? moveSpecs : null;
        }
        strikeAttacker = simAttacker;
        strikeTarget = simTarget;
        chargeExtras = chargeExtraSpecs(simAttacker, simTarget);
      }
    }
  }
  // One batch of dice per melee weapon a model within reach carries (the first unprefixed, later ones `w<slot>-`)
  const entries = strikeTarget ? strikeEntries(strikeAttacker, strikeTarget) : [];
  if (entries.length === 0) return null;

  const attackSpecs = strikeSpecs(entries, strikeAttacker, strikeTarget, {
    isCharging: action.type === 'charge' || (isMelee && attacker.hasMoved),
    distance,
  });

  if (action.type === 'charge') {
    attackSpecs.push(...chargeExtras);
    const chargePayload = action.payload as { path?: Vector3[] } & SquadChargePayload;
    if (isSquadChargePayload(attacker, chargePayload)) {
      const squadSpecs = squadChargeTraversalSpecs(state, attacker, chargePayload);
      return squadSpecs.length > 0 ? [...squadSpecs, ...attackSpecs] : attackSpecs;
    }
    if (chargePayload.path && chargePayload.path.length > 0) {
      // Jump, hazard and fall dice come from the validated path, same as a move (the declared traversal
      // is checked to match it), so a charge and a charge leg roll identically.
      const traversalSpecs = [
        ...legJumpSpecs(state, attacker, chargeLegEntries(attacker, chargePayload)),
        ...pathTraversalSpecs(state, attacker, [chargePayload.path]),
      ];
      if (traversalSpecs.length > 0) {
        return [...traversalSpecs, ...attackSpecs];
      }
    }
  }

  return attackSpecs;
}


/**
 * Morale dice a unit may need if what it does to itself (a fall, a hazard test) wounds it and ends its
 * activation: one test die, and a Fearless die for Fearless units. Unused dice are simply not consumed.
 */
function selfMoraleSpecs(unit: Unit): DiceSpec[] {
  const specs: DiceSpec[] = [{ count: 1, sides: 6, purpose: 'morale' }];
  if (hasTrait(unit.specialRules, 'fearless')) specs.push({ count: 1, sides: 6, purpose: 'fearless' });
  return specs;
}

/** One model's route in a move or charge leg (a single-model or unit-wide move is one entry). */
interface LegEntry {
  index: number;
  path: Vector3[];
  /** The model walking this route (undefined when the whole unit moves along one path). */
  model?: Model;
  declaration?: DeclaredTraversal | null;
  /** The model whose declared jump the squad follows: its crossing sizes the roll and it falls on a failure. */
  leader?: boolean;
}

/** A jump or fall a model's route contains. */
interface LegJump {
  entry: LegEntry;
  kind: 'gap' | 'drop' | 'fall';
  /** Jump length the dice are sized on (the height for a plain fall). */
  distance: number;
  takeoff: Vector3;
}

/** What a leg's jumps need and how a failure plays out; the same on the host's dice request and when applying. */
interface LegJumpPlan {
  jumps: LegJump[];
  /** Dice for the one jump roll (0 when nobody has to roll: no jump, or a fall that is certain). */
  testDice: number;
  /** The model that falls if the roll fails (or at once for a fall too far to jump). */
  faller: LegJump | null;
  fallPosition: Vector3 | null;
  fallHeight: number;
  fallDice: number;
}

/** Routes of a move (advance / rush), the way `case 'advance'` applies them. */
function moveLegEntries(
  unit: Unit,
  payload: {
    path?: Vector3[];
    modelPositions?: Vector3[];
    modelPaths?: Vector3[][];
    modelTraversals?: (DeclaredTraversal | null)[];
    crossers?: number[];
    jumpLeader?: number;
  }
): LegEntry[] {
  const living = livingModels(unit);
  if (payload.modelPositions && payload.modelPositions.length > 0) {
    const carried = crosserSet(payload);
    return squadMovePaths(unit, payload)
      .map((path, index) => ({
        index,
        path,
        model: living[index],
        declaration: payload.modelTraversals?.[index] ?? null,
        leader: payload.jumpLeader === index,
      }))
      .filter((e) => !carried.has(e.index)); // carried models walk no route: no jump, fall or hazard of their own
  }
  if (payload.modelPaths && payload.modelPaths.length > 0) {
    const carried = crosserSet(payload);
    return payload.modelPaths
      .map((path, index) => ({
        index,
        path,
        model: living[index],
        declaration: payload.modelTraversals?.[index] ?? null,
        leader: payload.jumpLeader === index,
      }))
      .filter((e) => !carried.has(e.index));
  }
  if (payload.path && payload.path.length > 0) {
    return [{ index: 0, path: payload.path, model: living.length === 1 ? living[0] : undefined, declaration: null }];
  }
  return [];
}

/** Routes of a charge or charge leg. */
function chargeLegEntries(unit: Unit, payload: { path?: Vector3[]; jumpLeader?: number } & SquadChargePayload): LegEntry[] {
  const living = livingModels(unit);
  if (isSquadChargePayload(unit, payload)) {
    const carried = crosserSet(payload);
    return squadChargePaths(unit, payload)
      .map((path, index) => ({
        index,
        path,
        model: living[index],
        declaration: payload.modelTraversals?.[index] ?? null,
        leader: payload.jumpLeader === index,
      }))
      .filter((e) => !carried.has(e.index));
  }
  return payload.path && payload.path.length > 0
    ? [{ index: 0, path: payload.path, model: living.length === 1 ? living[0] : undefined, declaration: null }]
    : [];
}

/** Where a route's jump starts: the declared take-off, else the start of its first jump or fall segment. */
function routeTakeoff(state: GameState, unit: Unit, entry: LegEntry): Vector3 {
  if (entry.declaration) return entry.declaration.takeoff;
  const { path } = entry;
  for (let i = 1; i < path.length; i++) {
    const kind = classifySegment(state, path[i - 1], path[i], unit).kind;
    if ((JUMP_KINDS as readonly string[]).includes(kind)) return path[i - 1];
  }
  return path[0];
}

/** The jumps and falls on each route (Flying units have none). */
function legJumps(state: GameState, unit: Unit, entries: LegEntry[]): LegJump[] {
  if (hasTrait(unit.specialRules, 'flying')) return [];
  const jumps: LegJump[] = [];
  for (const entry of entries) {
    if (entry.path.length < 2) continue;
    const gap = detectPathGapJump(state, entry.path, unit);
    if (gap.isGapJump) {
      jumps.push({ entry, kind: 'gap', distance: gap.gapDistance, takeoff: routeTakeoff(state, unit, entry) });
      continue;
    }
    const fall = detectPathFall(entry.path, state);
    if (fall.maxDrop > FREE_DROP_MAX) {
      const tooHigh = fall.maxDrop > JUMP_DROP_MAX;
      jumps.push({
        entry,
        kind: tooHigh ? 'fall' : 'drop',
        distance: tooHigh ? fall.maxDrop : fall.maxDropDistance,
        takeoff: routeTakeoff(state, unit, entry),
      });
    }
  }
  return jumps;
}

/** The longest jump (ties: lowest model index). */
function longestJump(jumps: LegJump[]): LegJump | null {
  let best: LegJump | null = null;
  for (const j of jumps) {
    if (!best || j.distance > best.distance + 1e-9 || (Math.abs(j.distance - best.distance) <= 1e-9 && j.entry.index < best.entry.index)) {
      best = j;
    }
  }
  return best;
}

/**
 * Plan a leg's jumps: one roll for the whole unit sized by the longest jump; if it fails, that model falls
 * from its take-off. A fall too far to jump is certain: the model falls with no jump roll.
 */
function planLegJumps(state: GameState, unit: Unit, entries: LegEntry[]): LegJumpPlan {
  const jumps = legJumps(state, unit, entries);
  const sure = jumps.filter((j) => j.kind === 'fall');
  const tests = jumps.filter((j) => j.kind !== 'fall');
  // A certain fall (over 6") is that model's. Otherwise the leader (the model the player declared the jump with;
  // default: the lowest-index jumper) sizes the roll and is the one that falls on a failure.
  const leaderJump = tests.find((j) => j.entry.leader) ?? tests.slice().sort((a, b) => a.entry.index - b.entry.index)[0] ?? null;
  const faller = sure.length > 0 ? longestJump(sure) : leaderJump;
  const plan: LegJumpPlan = { jumps, testDice: 0, faller, fallPosition: null, fallHeight: 0, fallDice: 0 };
  if (!faller) return plan;
  if (sure.length === 0) {
    plan.testDice = calculateJumpDice(faller.distance, hasTrait(unit.specialRules, 'strider'));
  }
  if (faller.kind === 'fall') {
    plan.fallHeight = faller.distance;
    plan.fallPosition = faller.entry.path[faller.entry.path.length - 1];
  } else {
    const landing = findFallLanding(state, unit, { x: faller.takeoff.x, z: faller.takeoff.z }, faller.takeoff.y ?? 0);
    plan.fallHeight = landing.height;
    plan.fallPosition = landing.position;
  }
  plan.fallDice = fallDiceCount(plan.fallHeight);
  return plan;
}

/** Dice a leg's jumps need: the one `jump` roll, and the fall dice a failure (or a certain fall) would roll. */
function legJumpSpecs(state: GameState, unit: Unit, entries: LegEntry[]): DiceSpec[] {
  const plan = planLegJumps(state, unit, entries);
  const specs: DiceSpec[] = [];
  if (plan.testDice > 0) specs.push({ count: plan.testDice, sides: 6, purpose: 'jump' });
  if (plan.faller && plan.fallDice > 0) specs.push({ count: plan.fallDice, sides: 6, purpose: 'fall' });
  return specs;
}

/**
 * Dice the dangerous terrain along a move needs: one test (as many dice as wounds to destroy the unit) for each
 * dangerous piece the paths cross that the unit has not already tested this activation. Flying units cross
 * nothing. (Jumps and falls: see `legJumpSpecs`.)
 */
function pathTraversalSpecs(state: GameState, unit: Unit, paths: Vector3[][]): DiceSpec[] {
  return hazardSpecsForPieces(unit, dangerousPieceIdsOnPaths(state, paths, unit));
}

/** Resolves a squad leg: its jumps (one roll), then the unit's dangerous terrain tests. */
function applyModelPathTraversals(
  state: GameState,
  unit: Unit,
  modelPaths: Vector3[][],
  models: Model[],
  action: GameAction,
  dice?: DiceResult[],
  starts?: Vector3[]
): void {
  const declared = (action.payload as { modelTraversals?: (DeclaredTraversal | null)[] }).modelTraversals;
  const leaderIndex = (action.payload as { jumpLeader?: number }).jumpLeader;
  const carried = crosserSet(action.payload as { crossers?: number[] });
  const entries: LegEntry[] = modelPaths
    .map((path, index) => ({
      index,
      path,
      model: models[index],
      declaration: declared?.[index] ?? null,
      leader: leaderIndex === index,
    }))
    .filter((e) => !carried.has(e.index));
  // Carried models are on their far-side spots; a failed jump takes them back to where they started
  const returning = starts
    ? [...carried].filter((i) => models[i] && starts[i]).map((i) => ({ model: models[i], start: starts[i], index: i }))
    : [];
  applyLegTraversals(state, unit, entries, action, dice, returning);
}

/** A declared jumper that did not fall: placed at its take-off spot, its jump not attempted, its tally cut back. */
function stopJumperAtTakeoff(
  state: GameState,
  unit: Unit,
  model: Model,
  path: Vector3[],
  takeoff: Vector3,
  events: TraversalEvent[],
  label: string
): void {
  model.position = { ...takeoff };
  const takeoffIdx = path.findIndex((p) => distance3D(p, takeoff) <= 0.1);
  if (takeoffIdx >= 1 && unit.modelMovementSpent && unit.modelMovementSpent[model.id] !== undefined) {
    const walked = pathMovementCost(state, path.slice(0, takeoffIdx + 1), unit);
    const full = pathMovementCost(state, path, unit);
    const spent = { ...unit.modelMovementSpent };
    spent[model.id] = Math.max(0, Math.round((spent[model.id] - full + walked) * 100) / 100);
    unit.modelMovementSpent = spent;
  }
  events.push({ type: 'jump-skipped', wounds: 0, text: `${label}jump not attempted (activation ended)` });
}

/** Traversal hazards resolved per action, so the log entry can show the dice story (jumps, falls, hazards). */
const traversalLog = new WeakMap<GameAction, { unitId: string; events: TraversalEvent[]; results: DiceResult[] }>();

function recordTraversal(action: GameAction, unit: Unit, events: TraversalEvent[], dice?: DiceResult[]): void {
  if (events.length === 0) return;
  const entry = traversalLog.get(action) ?? { unitId: unit.id, events: [], results: dice ?? [] };
  entry.events.push(...events);
  if (dice) entry.results = dice; // every roll stays on the log entry
  traversalLog.set(action, entry);
}

const rollsText = (rolls: number[]) => rolls.join(', ');

/**
 * Resolve a leg's traversals: the jump roll (one for the whole unit, sized by the longest jump), the fall if
 * it fails or the drop is too far to jump, each model's dangerous-terrain test, then the end of the activation
 * if someone fell. Returns whether the activation ended.
 */
function applyLegTraversals(
  state: GameState,
  unit: Unit,
  entries: LegEntry[],
  action: GameAction,
  dice?: DiceResult[],
  carriedBack: Array<{ model: Model; start: Vector3; index: number }> = []
): { terminated: boolean; wounds: number } {
  const payload = action.payload as any;
  const events: TraversalEvent[] = [];
  const multi = entries.length > 1;
  const labelFor = (e: LegEntry) => (multi ? `Model ${e.index + 1}: ` : '');
  const plan = planLegJumps(state, unit, entries);
  let fallen: LegJump | null = null;
  let fallWounds = 0;

  if (plan.faller) {
    const faller = plan.faller;
    let failed = true;
    if (plan.testDice > 0) {
      const rolls = dice?.find((d) => d.purpose === 'jump')?.rolls;
      const used = rolls?.slice(0, plan.testDice);
      const passed = !!used && used.length >= plan.testDice && used.every((r) => r >= JUMP_TARGET);
      failed = !passed;
      const what = faller.kind === 'gap' ? 'Gap jump' : 'Jump down';
      events.push({
        type: faller.kind === 'gap' ? 'gap-jump' : 'drop-jump',
        rolls: used,
        target: JUMP_TARGET,
        passed,
        text: `${what} ${faller.distance.toFixed(1)}" (${plan.testDice} dice, each ${JUMP_TARGET}+)${
          used ? `: rolled ${rollsText(used)}` : ''
        } → ${passed ? (faller.kind === 'gap' ? 'cleared the gap' : 'landed') : 'failed, falls'}`,
      });
    }
    if (failed) {
      fallen = faller;
      // The faller comes to rest on the floor below; every other declared jumper stays at its take-off
      const alive = livingModels(unit);
      const model = faller.entry.model && alive.includes(faller.entry.model) ? faller.entry.model : alive[0];
      const at = plan.fallPosition ?? unit.position;
      if (alive.length > 1 && model) {
        model.position = { ...at };
      } else {
        unit.position = { ...at };
        for (const m of alive) m.position = { ...at };
      }
      const fallRolls = dice?.find((d) => d.purpose === 'fall')?.rolls?.slice(0, plan.fallDice);
      const wounds = fallRolls ? countFallWounds(fallRolls) : 0;
      const cause = faller.kind === 'fall' ? 'Too far to jump. ' : '';
      events.push({
        type: 'fall',
        wounds,
        rolls: fallRolls && fallRolls.length > 0 ? fallRolls : undefined,
        text:
          plan.fallDice > 0
            ? `${labelFor(faller.entry)}${cause}Fell ${plan.fallHeight.toFixed(1)}" (${plan.fallDice} dice, 1-3 wounds)${
                fallRolls ? `: rolled ${rollsText(fallRolls)}` : ''
              } → ${wounds > 0 ? `${wounds} wound${wounds > 1 ? 's' : ''}` : 'unhurt'}`
            : `${labelFor(faller.entry)}${cause}Fell ${plan.fallHeight.toFixed(1)}"`,
      });
      // Models carried across never made the crossing: they are back where they stood (a fall of 2" or more
      // then gathers the whole unit at the bottom below)
      for (const c of carriedBack) {
        c.model.position = { ...c.start };
        events.push({ type: 'jump-skipped', wounds: 0, text: `Model ${c.index + 1}: not carried across (the jump failed)` });
      }
      for (const j of plan.jumps) {
        if (j === faller || !j.entry.declaration || !j.entry.model) continue;
        stopJumperAtTakeoff(state, unit, j.entry.model, j.entry.path, j.entry.declaration.takeoff, events, labelFor(j.entry));
      }
      if (wounds > 0) {
        applyFallWounds(unit, model, wounds);
      }
      // A fall of 2" or more brings the rest of the unit down to the fallen model (no dice of their own)
      if (plan.fallDice > 0 && alive.length > 1 && model && !unit.isDestroyed) {
        gatherAroundFallen(state, unit, model);
      }
      const survivors = livingModels(unit);
      if (survivors.length > 1) {
        unit.position = computeSquadCentroid(survivors.map((m) => m.position ?? unit.position));
      }
      fallWounds = wounds;
    }
  }

  // Dangerous terrain along the routes: one test for the unit per new piece (a model that fell never walked
  // the rest of its route)
  const walked = entries.filter((e) => !(fallen && fallen.entry === e)).map((e) => e.path);
  resolveHazardTests(unit, dangerousPieceIdsOnPaths(state, walked, unit), dice, events, 'Dangerous terrain', payload.casualtyModelIds);

  recordTraversal(action, unit, events, dice);
  if (fallen || unit.isDestroyed) {
    unit.hasMoved = true;
    unit.remainingMovement = 0;
    if (state.turnState.activeUnitId === unit.id) finishActivation(state, dice, action);
    return { terminated: true, wounds: fallWounds };
  }
  return { terminated: false, wounds: 0 };
}

export function applyTraversalHazardsAndFalls(
  state: GameState,
  unit: Unit,
  path: Vector3[],
  action: GameAction,
  dice?: DiceResult[],
  model?: Model
): { terminated: boolean; wounds: number } {
  const living = livingModels(unit);
  return applyLegTraversals(
    state,
    unit,
    [{ index: 0, path, model: model ?? (living.length === 1 ? living[0] : undefined), declaration: null }],
    action,
    dice
  );
}

export function createConsolidationReaction(
  actionId: string,
  victor: Unit,
  defeatedName: string
): PendingReaction {
  return {
    id: `${actionId}-consolidation`,
    type: 'melee-consolidation',
    promptingPlayerId: victor.ownerId,
    sourceUnitId: victor.id,
    targetUnitId: victor.id,
    title: 'Victory Consolidation',
    description: `${victor.name} wiped out ${defeatedName}! Move up to 3.0" in any direction, or stay put.`,
    options: [
      {
        id: 'stay',
        label: 'Stay Put',
        isDefault: true,
        style: 'secondary',
      },
    ],
    expiresAt: Date.now() + 15000,
    durationMs: 15000,
    data: {
      unitId: victor.id,
      maxDistance: 3.0,
    },
  };
}

/**
 * After a charge, the defender is asked to place the models that are not touching a charger. The charger's
 * strike waits for it. The default (timeout) choice lets the host place them with `closestApproach`.
 */
function createPileInReaction(
  actionId: string,
  charger: Unit,
  target: Unit,
  weaponId: string,
  modelIds: string[],
  chargeDistance: number
): PendingReaction {
  return {
    id: `${actionId}-pile-in`,
    type: 'pile-in',
    promptingPlayerId: target.ownerId,
    sourceUnitId: charger.id,
    targetUnitId: target.id,
    title: 'Pile In',
    description: `${charger.name} charged ${target.name}! Move the models that are not touching up to ${PILE_IN_DISTANCE}" toward the attackers.`,
    options: [
      {
        id: PILE_IN_AUTO_CHOICE,
        label: 'Auto place',
        isDefault: true,
        style: 'primary',
      },
    ],
    expiresAt: Date.now() + PILE_IN_DURATION_MS,
    durationMs: PILE_IN_DURATION_MS,
    data: {
      chargeActionId: actionId,
      attackerId: charger.id,
      targetId: target.id,
      weaponId,
      modelIds,
      maxDistance: PILE_IN_DISTANCE,
      chargeDistance,
    },
  };
}

/** The pile-in positions a `pile-in-move` carries, or the host's own when the defender chose 'auto place'. */
function pileInPlacement(
  state: GameState,
  action: GameAction
): { pending: PendingReaction; attacker: Unit; target: Unit; modelPositions: Vector3[]; modelPaths?: Vector3[][] } | null {
  const pending = state.turnState.pendingReaction;
  if (!pending || pending.type !== 'pile-in') return null;
  const attacker = getUnit(state, pending.sourceUnitId);
  const target = getUnit(state, pending.targetUnitId);
  if (!attacker || !target) return null;
  if (action.type === 'pile-in-move') {
    const payload = action.payload as PileInPayload;
    if (!payload.modelPositions) return null;
    return { pending, attacker, target, modelPositions: payload.modelPositions, modelPaths: payload.modelPaths };
  }
  if (action.type === 'respond-reaction') {
    const auto = autoPileIn(state, pending, target, attacker);
    return { pending, attacker, target, ...auto };
  }
  return null;
}

/**
 * Extra dice a charge strike needs on top of the charger's own attack: Impact(X) hits (none while the charger
 * is Fatigued) and the charged unit's Counter strikes, one batch per Counter weapon (`counter<i>-` purposes;
 * none while the charged unit is Fatigued or Shaken). All are sized from the units as they stand after the charge
 * move and pile-in, so they are an upper bound: casualties picked before a strike can only shrink the need.
 */
function chargeExtraSpecs(attacker: Unit, target: Unit): DiceSpec[] {
  const specs: DiceSpec[] = getImpactDiceSpecs(chargeImpactDice(attacker, target), target.specialRules ?? []);
  counterStrikeEntries(target, attacker).forEach(({ weapon: counterWeapon, index, strikers: count }) => {
    const counterSpecs = getAttackDiceSpecs((counterWeapon.profile.attacks as number) * count, {
      attackerRules: target.specialRules,
      weaponRules: counterWeapon.profile.specialRules,
      defenderRules: attacker.specialRules ?? [],
      defenderModelCount: Math.max(1, livingModels(attacker).length),
      isMelee: true,
      isCharging: false,
      distance: 1,
    });
    specs.push(...counterSpecs.map((sp) => ({ ...sp, purpose: `${counterPurposePrefix(index)}${sp.purpose}` })));
  });
  return specs;
}

/**
 * Impact dice a charger rolls: the unit's Impact(X) for each model within reach, plus each weapon's own Impact(X)
 * for each model within reach that carries it. None while the charger is Fatigued.
 */
function chargeImpactDice(attacker: Unit, target: Unit): number {
  const unitPart = impactDiceCount(attacker, undefined, strikers(attacker, target));
  if (attacker.status.includes('fatigued')) return 0;
  const weaponPart = meleeWeaponSlots(attacker).reduce(
    (sum, w) => sum + sumTraitValue(w.profile.specialRules, 'impact') * strikers(attacker, target, w),
    0
  );
  return unitPart + weaponPart;
}

/** Dice purpose prefix of the i-th Counter weapon's batch. */
function counterPurposePrefix(index: number): string {
  return `counter${index}-`;
}

/**
 * The Counter weapons that strike first when this unit is charged, with their stable index (their place among all
 * the unit's Counter weapons, which is what names their dice) and how many models of it within reach carry each.
 * None while it is Fatigued or Shaken (Shaken counts as Fatigued); a weapon nobody within reach carries is left out.
 */
function counterStrikeEntries(target: Unit, charger: Unit): { weapon: Weapon; index: number; strikers: number }[] {
  if (target.isDestroyed || target.status.includes('fatigued') || target.status.includes('shaken')) return [];
  const entries: { weapon: Weapon; index: number; strikers: number }[] = [];
  findCounterWeapons(target).forEach((weapon, index) => {
    if (typeof weapon.profile.attacks !== 'number' || weapon.profile.attacks < 1) return;
    const count = strikers(target, charger, weapon);
    if (count > 0) entries.push({ weapon, index, strikers: count });
  });
  return entries;
}

function pileInStrikeSpecs(state: GameState, action: GameAction): DiceSpec[] | null {
  const placed = pileInPlacement(state, action);
  if (!placed) return null;
  const { pending, attacker, target, modelPositions } = placed;
  const movedTarget = withModelPositions(target, modelPositions);
  const entries = strikeEntries(attacker, movedTarget);
  if (entries.length === 0) return null;
  const strike = strikeSpecs(entries, attacker, target, {
    isCharging: true,
    distance: pending.data?.chargeDistance ?? 1,
  });
  return [...strike, ...chargeExtraSpecs(attacker, movedTarget)];
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
      applyActivationHazard(newState, unit, action, dice, false);
      // A Shaken unit stays the active unit but may only end its activation idle (which clears Shaken).
      // A unit the hazard test destroyed has nothing left to activate.
      if (unit.isDestroyed) {
        finishActivation(newState, dice, action);
      }
      logEntry = acceptedEntry(action);
      break;
    }

    case 'hold': {
      const { unitId } = action.payload as PayloadWithUnitId;
      const unit = getUnit(newState, unitId)!;
      let pickPending = false;
      if (!newState.turnState.activeUnitId) {
        beginActivation(newState, unit);
        pickPending = applyActivationHazard(newState, unit, action, dice, true);
      }
      // A hold ends the unit's activation immediately without moving or acting (after the owner's casualty
      // pick, when the activation test took models off a squad).
      if (!pickPending) finishActivation(newState, dice, action);
      logEntry = acceptedEntry(action);
      break;
    }

    case 'roll-objectives': {
      const countRoll = dice?.find((d) => d.purpose === OBJECTIVE_COUNT_PURPOSE)?.rolls[0];
      const missionRolls = dice?.find((d) => d.purpose === MISSION_ROLL_OFF_PURPOSE)?.rolls;
      if (countRoll === undefined || !missionRolls || missionRolls.length < 2) {
        return { ok: false, reason: 'The objective count and mission roll-off dice are missing' };
      }
      const objectiveCount = objectiveCountFromRoll(countRoll);
      const missionRollOff = resolveRollOff('mission', missionRolls, newState.hostId, newState.guestId);
      newState.setupRolls = { objectiveRoll: countRoll, objectiveCount, missionRollOff };
      newState.turnState.currentPlayerId = missionRollOff.winnerId;
      logEntry = acceptedEntry(
        action,
        setupResolution(action, dice!, { objectiveCount: { roll: countRoll, count: objectiveCount }, rollOff: missionRollOff })
      );
      break;
    }

    case 'place-objective': {
      const { position } = action.payload as { position: Vector3 };
      const objectives = newState.objectives ?? (newState.objectives = []);
      objectives.push(createObjectiveMarker(objectives.length + 1, position));
      let resolution: DiceResolution | undefined;
      if (objectives.length >= (newState.setupRolls?.objectiveCount ?? Infinity)) {
        // All markers are down: the deployment roll-off decides who deploys and activates first
        const offRolls = dice?.find((d) => d.purpose === DEPLOYMENT_ROLL_OFF_PURPOSE)?.rolls;
        if (!offRolls || offRolls.length < 2) {
          return { ok: false, reason: 'The deployment roll-off dice are missing' };
        }
        const deploymentRollOff = resolveRollOff('deployment', offRolls, newState.hostId, newState.guestId);
        newState.setupRolls = { ...newState.setupRolls, deploymentRollOff };
        newState.turnState.startingPlayerId = deploymentRollOff.winnerId;
        newState.turnState.currentPlayerId = deploymentRollOff.winnerId;
        // A game without the deployment phase has every unit on the table already: straight to round 1
        if (isDeploymentComplete(newState)) {
          newState.turnState.phase = 'activation';
          newState.turnState.roundNumber = 1;
        } else {
          newState.turnState.phase = 'deployment';
        }
        resolution = setupResolution(action, dice!, { rollOff: deploymentRollOff });
      } else {
        newState.turnState.currentPlayerId = action.actorId === newState.hostId ? newState.guestId : newState.hostId;
      }
      logEntry = acceptedEntry(action, resolution);
      break;
    }

    case 'hold-scout': {
      const { unitId } = action.payload as PayloadWithUnitId;
      getUnit(newState, unitId)!.heldAsScout = true;
      advanceDeployment(newState, true);
      logEntry = acceptedEntry(action);
      break;
    }

    case 'skip-ambush': {
      const step = newState.turnState.ambushStep!;
      step.skippedPlayerIds.push(action.actorId);
      advanceAmbushStep(newState);
      logEntry = acceptedEntry(action);
      break;
    }

    case 'deploy-unit': {
      const { unitId, position, rotation } = action.payload as {
        unitId: string;
        position: Vector3;
        rotation?: Vector3;
      };
      const unit = getUnit(newState, unitId)!;
      const byAmbush = Boolean(newState.turnState.ambushStep);
      unit.isDeployed = true;
      unit.position = { ...position };
      if (rotation) {
        unit.rotation = { ...rotation };
      } else {
        const facing = unit.ownerId === newState.hostId ? 0 : Math.PI;
        unit.rotation = { x: 0, y: facing, z: 0 };
      }
      if (unit.models && unit.models.length > 0) {
        const count = unit.models.length;
        const positions = createSquadPositions(position, count);
        for (let i = 0; i < count; i++) {
          unit.models[i].position = { ...positions[i] };
          unit.models[i].rotation = { ...unit.rotation };
        }
      }
      if (byAmbush) {
        unit.ambushArrivedRound = newState.turnState.roundNumber;
        advanceAmbushStep(newState);
      } else {
        advanceDeployment(newState);
      }
      logEntry = acceptedEntry(action);
      break;
    }

    case 'advance': {
      const { unitId, path, finalPosition, modelPositions, modelPaths, modelTraversals } = action.payload as {
        unitId: string;
        path?: Vector3[];
        finalPosition?: Vector3;
        modelPositions?: Vector3[];
        modelPaths?: Vector3[][];
        modelTraversals?: (DeclaredTraversal | null)[];
      };
      const unit = getUnit(newState, unitId)!;
      const isSquad = Boolean(modelPositions && modelPositions.length > 0);

      if (isSquad && modelPositions) {
        const activeModels = unit.models ? unit.models.filter((m) => !m.isDestroyed) : [];
        const prevPositions = activeModels.map((m) => ({ ...(m.position ?? unit.position) }));
        const resolvedModelPaths = squadMovePaths(unit, { modelPositions, modelPaths });
        for (let i = 0; i < activeModels.length && i < modelPositions.length; i++) {
          activeModels[i].position = { ...modelPositions[i] };
        }
        unit.position = computeSquadCentroid(modelPositions);

        if (modelPositions.length > 0 && prevPositions.length > 0) {
          const m0dx = modelPositions[0].x - prevPositions[0].x;
          const m0dz = modelPositions[0].z - prevPositions[0].z;
          if (Math.hypot(m0dx, m0dz) > 1e-4) {
            unit.rotation = { ...unit.rotation, y: Math.atan2(m0dx, m0dz) };
          }
        }

        for (let i = 0; i < activeModels.length && i < modelPositions.length; i++) {
          const mdx = modelPositions[i].x - prevPositions[i].x;
          const mdz = modelPositions[i].z - prevPositions[i].z;
          if (Math.hypot(mdx, mdz) > 1e-4) {
            activeModels[i].rotation = { x: 0, y: Math.atan2(mdx, mdz), z: 0 };
          } else {
            activeModels[i].rotation = { ...unit.rotation };
          }
        }

        const carriedIdx = crosserSet(action.payload as { crossers?: number[] });
        const modelDistances = modelPositions.map((pos, i) => {
          if (carriedIdx.has(i)) return 0; // carried across: the crossing costs no move
          if (modelPaths && modelPaths[i] && modelPaths[i].length >= 2) {
            return pathMovementCost(state, modelPaths[i], unit);
          }
          const mStart = prevPositions[i] ?? unit.position;
          return boardDistance(mStart, pos);
        });
        unit.hasMoved = true;
        unit.remainingMovement = spendModelMovement(unit, unit.remainingMovement, modelDistances);

        applyModelPathTraversals(newState, unit, resolvedModelPaths, activeModels, action, dice, prevPositions);

        logEntry = acceptedEntry(action);
        break;
      }

      if (path && path.length >= 2) {
        const lastStep = path[path.length - 1];
        const prevStep = path[path.length - 2];
        const dx = lastStep.x - prevStep.x;
        const dz = lastStep.z - prevStep.z;
        if (Math.hypot(dx, dz) > 1e-4) {
          unit.rotation = { ...unit.rotation, y: Math.atan2(dx, dz) };
        }
      }
      const targetPos = finalPosition ? { ...finalPosition } : { ...(path ? path[path.length - 1] : unit.position) };
      const deltaX = targetPos.x - unit.position.x;
      const deltaZ = targetPos.z - unit.position.z;

      if (unit.models && unit.models.length > 0) {
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
            m.rotation = { ...unit.rotation };
          }
        }
        unit.position = targetPos;
      } else {
        unit.position = targetPos;
      }

      const distanceMoved = path ? pathMovementCost(state, path, unit) : 0;
      unit.hasMoved = true;
      unit.remainingMovement = Math.max(
        0,
        Math.round((unit.remainingMovement - distanceMoved) * 100) / 100
      );
      spendAllModels(unit, distanceMoved);
      const traversal = applyTraversalHazardsAndFalls(newState, unit, path ?? [], action, dice);
      if (traversal.terminated) {
        logEntry = acceptedEntry(action);
        break;
      }
      logEntry = acceptedEntry(action);
      break;
    }

    case 'shoot': {
      // A Blast shot that reaches several units waits for the defender's split (nothing is resolved yet)
      const pause = blastSplitPause(newState, action, dice);
      if (pause) {
        if (!pause.ok) return pause;
        newState.turnState.pendingReaction = pause.reaction;
        logEntry = acceptedEntry(action);
        break;
      }
      const shot = resolveShoot(state, newState, action, dice);
      if (!shot.ok) return shot;
      logEntry = shot.logEntry;
      break;
    }


    case 'fight': {
      const { attackerId, targetId } = action.payload as {
        attackerId: string;
        targetId: string;
        weaponId?: string;
      };
      const attacker = getUnit(newState, attackerId)!;
      const target = getUnit(newState, targetId)!;
      const isMelee = true;
      const distance = unitDistance(attacker, target);
      // Every melee weapon a model within reach carries strikes (the payload's weaponId is no longer a choice)
      const entries = strikeEntries(attacker, target);
      const isFatigued =
        attacker.status.includes('fatigued') || attacker.status.includes('shaken');

      // Turn attacker to face the target, and target to face attacker
      const adx = target.position.x - attacker.position.x;
      const adz = target.position.z - attacker.position.z;
      if (Math.hypot(adx, adz) > 1e-4) {
        attacker.rotation = { ...attacker.rotation, y: Math.atan2(adx, adz) };
        target.rotation = { ...target.rotation, y: Math.atan2(-adx, -adz) };
      }
      if (attacker.models && attacker.models.length > 0) {
        for (const m of attacker.models) {
          if (!m.isDestroyed) {
            const mPos = m.position ?? attacker.position;
            const mdx = target.position.x - mPos.x;
            const mdz = target.position.z - mPos.z;
            if (Math.hypot(mdx, mdz) > 1e-4) {
              m.rotation = { x: 0, y: Math.atan2(mdx, mdz), z: 0 };
            } else {
              m.rotation = { ...attacker.rotation };
            }
          }
        }
      }
      if (target.models && target.models.length > 0) {
        for (const m of target.models) {
          if (!m.isDestroyed) {
            const mPos = m.position ?? target.position;
            const mdx = attacker.position.x - mPos.x;
            const mdz = attacker.position.z - mPos.z;
            if (Math.hypot(mdx, mdz) > 1e-4) {
              m.rotation = { x: 0, y: Math.atan2(mdx, mdz), z: 0 };
            } else {
              m.rotation = { ...target.rotation };
            }
          }
        }
      }

      const ledger: WoundLedger = new Map();
      let strikes: StrikeResult[];
      try {
        if (!dice) throw new Error('Dice results required');
        strikes = resolveStrikes(entries, attacker, target, dice, ledger, {
          isCharging: isMelee && attacker.hasMoved,
          hasMoved: attacker.hasMoved,
          isFatigued,
          distance,
        });
      } catch (error) {
        return { ok: false, reason: (error as Error).message };
      }

      attacker.hasAttacked = true;
      attacker.remainingMovement = 0;
      for (const { weapon } of entries) {
        if (hasTrait(weapon.profile.specialRules, 'limited')) weapon.isEquipped = false;
      }
      if (isMelee && !attacker.status.includes('fatigued')) {
        attacker.status.push('fatigued');
      }

      if (isMelee) markInMelee(newState, attacker.id, target.id);
      deferCasualties(newState, ledger, action.id, attacker, {
        kind: 'fight',
        attackerId: attacker.id,
        targetId: target.id,
      });
      if (target.isDestroyed) {
        newState.turnState.pendingReaction = createConsolidationReaction(action.id, attacker, target.name);
      }
      refreshEngagements(newState);

      diceResolution = {
        rollId: action.id,
        specs: getDiceSpecs(state, action) ?? [],
        results: dice,
        context: {
          attackerId,
          targetId,
          weaponId: entries[0]?.weapon.id,
          actionId: action.id,
        },
        outcome: {
          ...summarizeStrikes(strikes),
          targetDestroyed: target.isDestroyed,
          ...(target.status.includes('shaken') ? { targetShaken: true } : {}),
        },
      };
      logEntry = acceptedEntry(action, diceResolution);
      break;
    }

    case 'rush': {
      const { unitId, path, finalPosition, modelPositions, modelPaths, modelTraversals } = action.payload as {
        unitId: string;
        path?: Vector3[];
        finalPosition?: Vector3;
        modelPositions?: Vector3[];
        modelPaths?: Vector3[][];
        modelTraversals?: (DeclaredTraversal | null)[];
      };
      const unit = getUnit(newState, unitId)!;
      const isSquad = Boolean(modelPositions && modelPositions.length > 0);
      const currentBudget = unit.isRushing ? unit.remainingMovement : getEffectiveSpeed(unit) * 2;

      if (isSquad && modelPositions) {
        const activeModels = unit.models ? unit.models.filter((m) => !m.isDestroyed) : [];
        const prevPositions = activeModels.map((m) => ({ ...(m.position ?? unit.position) }));
        const resolvedModelPaths = squadMovePaths(unit, { modelPositions, modelPaths });
        for (let i = 0; i < activeModels.length && i < modelPositions.length; i++) {
          activeModels[i].position = { ...modelPositions[i] };
        }
        unit.position = computeSquadCentroid(modelPositions);

        if (modelPositions.length > 0 && prevPositions.length > 0) {
          const m0dx = modelPositions[0].x - prevPositions[0].x;
          const m0dz = modelPositions[0].z - prevPositions[0].z;
          if (Math.hypot(m0dx, m0dz) > 1e-4) {
            unit.rotation = { ...unit.rotation, y: Math.atan2(m0dx, m0dz) };
          }
        }

        for (let i = 0; i < activeModels.length && i < modelPositions.length; i++) {
          const mdx = modelPositions[i].x - prevPositions[i].x;
          const mdz = modelPositions[i].z - prevPositions[i].z;
          if (Math.hypot(mdx, mdz) > 1e-4) {
            activeModels[i].rotation = { x: 0, y: Math.atan2(mdx, mdz), z: 0 };
          } else {
            activeModels[i].rotation = { ...unit.rotation };
          }
        }

        const carriedIdx = crosserSet(action.payload as { crossers?: number[] });
        const modelDistances = modelPositions.map((pos, i) => {
          if (carriedIdx.has(i)) return 0; // carried across: the crossing costs no move
          if (modelPaths && modelPaths[i] && modelPaths[i].length >= 2) {
            return pathMovementCost(state, modelPaths[i], unit);
          }
          const mStart = prevPositions[i] ?? unit.position;
          return boardDistance(mStart, pos);
        });

        unit.isRushing = true;
        unit.hasMoved = true;
        unit.hasAttacked = true;
        unit.remainingMovement = spendModelMovement(unit, currentBudget, modelDistances);
        refreshEngagements(newState);

        applyModelPathTraversals(newState, unit, resolvedModelPaths, activeModels, action, dice, prevPositions);

        logEntry = acceptedEntry(action);
        break;
      }

      const startPos = { ...unit.position };
      const fullPath =
        path && path.length > 0 && boardDistance(path[0], startPos) < 0.01
          ? path
          : [startPos, ...(path ?? [])];
      const distMoved = pathMovementCost(state, fullPath, unit);
      const end = finalPosition ? { ...finalPosition } : { ...(path ? path[path.length - 1] : unit.position) };
      const dx = end.x - unit.position.x;
      const dz = end.z - unit.position.z;
      if (Math.hypot(dx, dz) > 1e-4) {
        unit.rotation = { ...unit.rotation, y: Math.atan2(dx, dz) };
      }
      if (unit.models && unit.models.length > 0) {
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
            m.rotation = { ...unit.rotation };
          }
        }
        unit.position = { ...end };
      } else {
        unit.position = { ...end };
      }
      unit.isRushing = true;
      unit.hasMoved = true;
      unit.hasAttacked = true;
      unit.remainingMovement = Math.max(
        0,
        Math.round((currentBudget - distMoved) * 100) / 100
      );
      spendAllModels(unit, distMoved);
      refreshEngagements(newState);
      const traversal = applyTraversalHazardsAndFalls(newState, unit, path ?? [], action, dice);
      if (traversal.terminated) {
        logEntry = acceptedEntry(action);
        break;
      }
      logEntry = acceptedEntry(action);
      break;
    }

    case 'begin-charge': {
      const { attackerId, targetId } = action.payload as { attackerId: string; targetId: string };
      const attacker = getUnit(newState, attackerId)!;
      // The one charge move is budgeted in remainingMovement; legs spend it
      attacker.remainingMovement = chargeBudget(attacker);
      resetModelMovement(attacker);
      newState.turnState.charge = { unitId: attackerId, targetId, legs: 0 };
      const declaredTarget = getUnit(newState, targetId);
      if (declaredTarget) noteAttackedFrom(newState, targetId, 'charged', unitDistance(attacker, declaredTarget));
      logEntry = acceptedEntry(action);
      break;
    }

    case 'charge-leg': {
      const { attackerId, path } = action.payload as { attackerId: string; path: Vector3[] };
      const unit = getUnit(newState, attackerId)!;
      const legModels = action.payload as SquadChargePayload;
      if (isSquadChargePayload(unit, legModels)) {
        // Each model walks its own path and spends its own distance
        const legPaths = squadChargePaths(unit, legModels);
        const legCarried = crosserSet(legModels);
        const legCosts = legPaths.map((p, i) => (legCarried.has(i) ? 0 : pathMovementCost(state, p, unit)));
        const legAlive = livingModels(unit);
        const legPrev = placeSquadModels(unit, legModels.modelPositions!);
        unit.hasMoved = true;
        unit.remainingMovement = spendModelMovement(unit, unit.remainingMovement, legCosts);
        if (newState.turnState.charge) newState.turnState.charge.legs += 1;
        // A failed jump falls: the fall ends the activation (finishActivation drops the declared charge)
        applyModelPathTraversals(newState, unit, legPaths, legAlive, action, dice, legPrev);
        logEntry = acceptedEntry(action);
        break;
      }
      const lastStep = path[path.length - 1];
      const prevStep = path[path.length - 2];
      const ldx = lastStep.x - prevStep.x;
      const ldz = lastStep.z - prevStep.z;
      if (Math.hypot(ldx, ldz) > 1e-4) {
        unit.rotation = { ...unit.rotation, y: Math.atan2(ldx, ldz) };
      }
      const cost = pathMovementCost(state, path, unit);
      moveChargerModels(unit, lastStep);
      for (const m of unit.models ?? []) {
        if (!m.isDestroyed) m.rotation = { ...unit.rotation };
      }
      unit.hasMoved = true;
      unit.remainingMovement = Math.max(0, Math.round((unit.remainingMovement - cost) * 100) / 100);
      spendAllModels(unit, cost);
      const charge = newState.turnState.charge;
      if (charge) charge.legs += 1;
      // A failed jump falls: the fall ends the activation (finishActivation drops the declared charge)
      applyTraversalHazardsAndFalls(newState, unit, path, action, dice);
      logEntry = acceptedEntry(action);
      break;
    }

    case 'charge': {
      const { attackerId, targetId, path } = action.payload as {
        attackerId: string;
        targetId: string;
        path: Vector3[];
        weaponId?: string;
      };
      const wasDeclared = newState.turnState.charge?.unitId === attackerId;
      newState.turnState.charge = null;
      const attacker = getUnit(newState, attackerId)!;
      const target = getUnit(newState, targetId)!;
      // A one-click charge starts here; a declared one was measured when it was declared
      if (!wasDeclared) noteAttackedFrom(newState, targetId, 'charged', unitDistance(attacker, target));
      const squadMoves = action.payload as SquadChargePayload;
      const squadCharge = isSquadChargePayload(attacker, squadMoves);
      const squadAlive = livingModels(attacker);
      const squadPaths = squadCharge ? squadChargePaths(attacker, squadMoves) : [];
      let chargePrev: Vector3[] | undefined;
      if (squadCharge) chargePrev = placeSquadModels(attacker, squadMoves.modelPositions!);
      else moveChargerModels(attacker, path[path.length - 1]);
      attacker.hasMoved = true;
      attacker.hasAttacked = true;
      attacker.remainingMovement = 0;
      resetModelMovement(attacker);
      const cdx = target.position.x - attacker.position.x;
      const cdz = target.position.z - attacker.position.z;
      if (Math.hypot(cdx, cdz) > 1e-4) {
        attacker.rotation = { ...attacker.rotation, y: Math.atan2(cdx, cdz) };
        target.rotation = { ...target.rotation, y: Math.atan2(-cdx, -cdz) };
      }
      if (attacker.models && attacker.models.length > 0) {
        for (const m of attacker.models) {
          if (!m.isDestroyed) {
            const mPos = m.position ?? attacker.position;
            const mdx = target.position.x - mPos.x;
            const mdz = target.position.z - mPos.z;
            if (Math.hypot(mdx, mdz) > 1e-4) {
              m.rotation = { x: 0, y: Math.atan2(mdx, mdz), z: 0 };
            } else {
              m.rotation = { ...attacker.rotation };
            }
          }
        }
      }
      if (target.models && target.models.length > 0) {
        for (const m of target.models) {
          if (!m.isDestroyed) {
            const mPos = m.position ?? target.position;
            const mdx = attacker.position.x - mPos.x;
            const mdz = attacker.position.z - mPos.z;
            if (Math.hypot(mdx, mdz) > 1e-4) {
              m.rotation = { x: 0, y: Math.atan2(mdx, mdz), z: 0 };
            } else {
              m.rotation = { ...target.rotation };
            }
          }
        }
      }

      let chargeTerminated: boolean;
      if (squadCharge) {
        // A failed jump falls and ends the activation: no melee
        applyModelPathTraversals(newState, attacker, squadPaths, squadAlive, action, dice, chargePrev);
        chargeTerminated = newState.turnState.activeUnitId !== attackerId;
      } else {
        chargeTerminated = applyTraversalHazardsAndFalls(newState, attacker, path, action, dice).terminated;
      }
      if (chargeTerminated || attacker.isDestroyed) {
        logEntry = acceptedEntry(action);
        break;
      }

      if (!attacker.status.includes('engaged')) attacker.status.push('engaged');
      if (!target.status.includes('engaged')) target.status.push('engaged');

      // The charger strikes with every melee weapon it carries
      const strikeWeapons = findMeleeWeapons(attacker);

      // Defenders not touching a charger place their own models first (up to 3"); the strike waits for that
      const pileInIds = strikeWeapons.length > 0 ? pileInModelIds(target, attacker) : [];
      if (strikeWeapons.length > 0 && pileInIds.length > 0) {
        newState.turnState.pendingReaction = createPileInReaction(
          action.id,
          attacker,
          target,
          strikeWeapons[0].id,
          pileInIds,
          Math.hypot(cdx, cdz)
        );
        refreshEngagements(newState);
        logEntry = acceptedEntry(action);
        break;
      }

      if (strikeWeapons.length > 0 && dice && pileInIds.length === 0) {
        diceResolution = resolveChargeStrike(state, newState, action, attacker, target, dice, Math.hypot(cdx, cdz));
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
      if (pending.type === 'melee-consolidation') {
        newState.turnState.pendingReaction = null;
        refreshEngagements(newState);
        logEntry = acceptedEntry(action);
        break;
      }
      if (pending.type === 'push') {
        logEntry = applyPush(state, newState, action, dice);
        break;
      }
      if (pending.type === 'pile-in') {
        const piled = applyPileIn(state, newState, action, dice);
        if (!piled.ok) return piled;
        logEntry = piled.logEntry;
        break;
      }
      if (pending.type === 'blast-split') {
        // Auto split (the defender's choice or the host's timeout fallback): the host splits every weapon itself
        const blastData = pending.data as unknown as BlastSplitData;
        logEntry = applyBlastSplit(state, newState, action, blastData.blasts.map((b) => b.auto));
        break;
      }
      if (pending.type === 'pick-casualties') {
        // The owner ran out of time (the only option is the host's own pick)
        const pickData = pending.data as unknown as PickCasualtiesData;
        const damaged = getUnit(newState, pickData.entry.unitId)!;
        logEntry = applyPickCasualties(newState, action, autoPickCasualties(damaged, pickData.entry));
        break;
      }
      const defender = getUnit(newState, pending.targetUnitId)!;
      const charger = getUnit(newState, pending.sourceUnitId)!;
      const backEntries = strikeBackEntries(defender, charger, pending);

      let backStrikes: StrikeResult[] | undefined;
      const ledger: WoundLedger = new Map();

      if (choiceId === 'strike-back' && backEntries.length > 0 && dice) {
        // Turn defender to face the charger
        const rdx = charger.position.x - defender.position.x;
        const rdz = charger.position.z - defender.position.z;
        if (Math.hypot(rdx, rdz) > 1e-4) {
          defender.rotation = { ...defender.rotation, y: Math.atan2(rdx, rdz) };
        }
        if (defender.models && defender.models.length > 0) {
          for (const m of defender.models) {
            if (!m.isDestroyed) {
              const mPos = m.position ?? defender.position;
              const mdx = charger.position.x - mPos.x;
              const mdz = charger.position.z - mPos.z;
              if (Math.hypot(mdx, mdz) > 1e-4) {
                m.rotation = { x: 0, y: Math.atan2(mdx, mdz), z: 0 };
              } else {
                m.rotation = { ...defender.rotation };
              }
            }
          }
        }

        const isTargetFatigued = defender.status.includes('fatigued') || defender.status.includes('shaken');
        backStrikes = resolveStrikes(backEntries, defender, charger, dice, ledger, {
          isCharging: false,
          hasMoved: defender.hasMoved,
          isFatigued: isTargetFatigued,
          distance: 1,
        });
        markInMelee(newState, defender.id, charger.id);

        if (!defender.status.includes('fatigued')) {
          defender.status.push('fatigued');
        }
      }

      const chargerShaken = charger.status.includes('shaken');
      // A surviving charging squad that lost models: its owner picks who goes, then the step back follows
      const deferred = deferCasualties(newState, ledger, action.id, defender, {
        kind: 'strike-back',
        attackerId: defender.id,
        targetId: charger.id,
      });
      const { pushedBack, pushBackPos } = deferred
        ? { pushedBack: false, pushBackPos: undefined }
        : settleStrikeBack(newState, action.id, charger, defender);

      let diceResolution: DiceResolution | undefined;
      if (backStrikes && dice) {
        diceResolution = {
          rollId: action.id,
          specs: getDiceSpecs(state, action) ?? [],
          results: dice,
          context: {
            attackerId: defender.id,
            targetId: charger.id,
            weaponId: backEntries[0].weapon.id,
            actionId: action.id,
          },
          outcome: {
            ...summarizeStrikes(backStrikes),
            targetDestroyed: charger.isDestroyed,
            targetShaken: chargerShaken,
            baseQuality: defender.quality,
            baseDefense: charger.defense,
            pushedBack,
            pushBackPosition: pushBackPos,
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

    case 'blast-split': {
      logEntry = applyBlastSplit(state, newState, action, (action.payload as BlastSplitPayload).splits ?? []);
      break;
    }

    case 'pick-casualties': {
      const payload = action.payload as PickCasualtiesPayload;
      logEntry = applyPickCasualties(newState, action, payload.modelIds ?? []);
      break;
    }

    case 'pile-in-move': {
      const piled = applyPileIn(state, newState, action, dice);
      if (!piled.ok) return piled;
      logEntry = piled.logEntry;
      break;
    }

    case 'consolidate-move': {
      const { unitId, path, modelPositions } = action.payload as {
        unitId: string;
        path: Vector3[];
        modelPositions?: Vector3[];
      };
      const unit = getUnit(newState, unitId)!;
      if (modelPositions && modelPositions.length > 0 && livingModels(unit).length > 1) {
        placeSquadModels(unit, modelPositions);
      } else {
        const end = path[path.length - 1];
        const deltaX = end.x - unit.position.x;
        const deltaZ = end.z - unit.position.z;
        if (Math.hypot(deltaX, deltaZ) > 1e-4) {
          unit.rotation = { ...unit.rotation, y: Math.atan2(deltaX, deltaZ) };
        }
        unit.position = { ...end };
        const alive = livingModels(unit);
        for (const m of alive) {
          m.position = { ...end };
          m.rotation = { ...unit.rotation };
        }
      }
      newState.turnState.pendingReaction = null;
      refreshEngagements(newState);
      logEntry = acceptedEntry(action);
      break;
    }

    case 'push-move': {
      logEntry = applyPush(state, newState, action, dice);
      break;
    }

    case 'end-activation': {
      finishActivation(newState, dice, action);
      logEntry = acceptedEntry(action);
      break;
    }

    case 'end-round': {
      endRound(newState);
      logEntry = acceptedEntry(action);
      break;
    }

    case 'concede': {
      const winnerId = action.actorId === newState.hostId ? newState.guestId : newState.hostId;
      const fallback = action.actorId === newState.hostId ? 'Host' : 'Guest';
      const name = newState.players.find((p) => p.id === action.actorId)?.name?.trim() || fallback;
      newState.status = 'game-over';
      newState.turnState.phase = 'game-over';
      newState.turnState.activeUnitId = null;
      newState.turnState.pendingReaction = null;
      newState.turnState.charge = null;
      newState.winner = winnerId;
      newState.endReason = `${name} conceded`;
      logEntry = acceptedEntry(action);
      break;
    }

    case 'request-rematch': {
      const requested = newState.rematchRequestedBy ?? [];
      if (!requested.includes(action.actorId)) requested.push(action.actorId);
      if (requested.includes(newState.hostId) && requested.includes(newState.guestId)) {
        // Both agreed: the result is the fresh starting state, not a game-over state.
        return { ok: true, state: createRematchState(newState), logEntry: acceptedEntry(action) };
      }
      newState.rematchRequestedBy = requested;
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

/**
 * A Blast shot that reaches more than one unit pauses for the defender's split. This resolves the shot on a
 * throwaway copy to find the Blast weapons that need a split (the dice are already rolled); null means the shot
 * can resolve at once. The reaction carries the shot's action and dice so it resolves after the choice.
 */
function blastSplitPause(
  newState: GameState,
  action: GameAction,
  dice?: DiceResult[]
): { ok: true; reaction: PendingReaction } | { ok: false; reason: string } | null {
  const payload = action.payload as PayloadWithAttacker;
  const attacker = getUnit(newState, payload.attackerId);
  if (!attacker || !dice) return null;
  const hasBlast = getShootAllocations(payload).some((a) => {
    const w = getWeapon(attacker, a.weaponId);
    return !!w && hasTrait(w.profile.specialRules, 'blast');
  });
  if (!hasBlast) return null;
  const prompts: BlastSplitPrompt[] = [];
  const trial = resolveShoot(newState, cloneGameState(newState), action, dice, undefined, prompts);
  if (!trial.ok) return trial;
  if (prompts.length === 0) return null;
  const firstTarget = getUnit(newState, getShootAllocations(payload)[prompts[0].allocIndex].targetId)!;
  return {
    ok: true,
    reaction: createBlastSplitReaction(action.id, firstTarget.ownerId, attacker.id, firstTarget.id, {
      shoot: JSON.parse(JSON.stringify(action)) as GameAction,
      dice: JSON.parse(JSON.stringify(dice)) as DiceResult[],
      blasts: prompts,
    }),
  };
}

/** The defender's split (or the host's Auto) is in: resolve the paused shot with its stored dice. */
function applyBlastSplit(state: GameState, newState: GameState, action: GameAction, rows: number[][]): ActionLogEntry {
  const data = newState.turnState.pendingReaction!.data as unknown as BlastSplitData;
  newState.turnState.pendingReaction = null;
  const splits: Record<number, number[]> = {};
  data.blasts.forEach((b, k) => {
    splits[b.allocIndex] = rows[k] ?? b.auto;
  });
  // The shot resolves from the state it paused in (nothing changed meanwhile); the original action id is kept
  // for the dice resolution so both peers render the same roll.
  const resolved = resolveShoot(state, newState, data.shoot, data.dice, splits, undefined, action);
  if (!resolved.ok) throw new Error(resolved.reason);
  return resolved.logEntry;
}

/**
 * Resolve a shoot action with its dice. A Blast weapon with more than one eligible unit takes its split from
 * `splits` (by allocation index); without one the Auto split is used, and when `prompts` is given the weapon is
 * reported there instead (the caller then discards this trial run and asks the defender).
 */
function resolveShoot(
  state: GameState,
  newState: GameState,
  action: GameAction,
  dice: DiceResult[] | undefined,
  splits?: Record<number, number[]>,
  prompts?: BlastSplitPrompt[],
  /** The action the log entry is written for (the Blast split answer when the shot was paused). */
  logAction: GameAction = action
): { ok: true; logEntry: ActionLogEntry } | { ok: false; reason: string } {
  let diceResolution: DiceResolution | undefined;
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
  let totalRegenerationSavedCount = 0;
  let totalWounds = 0;
  let primaryTargetDestroyed = false;
  let primaryTargetShaken = false;
  const ledger: WoundLedger = new Map();
  const blastSplash: BlastSplashOutcome[] = [];
  const blastSplits: BlastSplitRecord[] = [];

  // Turn attacker to face the primary target
  const primaryTarget = getUnit(newState, allocations[0].targetId);
  if (primaryTarget) {
    const adx = primaryTarget.position.x - attacker.position.x;
    const adz = primaryTarget.position.z - attacker.position.z;
    if (Math.hypot(adx, adz) > 1e-4) {
      attacker.rotation = { ...attacker.rotation, y: Math.atan2(adx, adz) };
    }
    if (attacker.models && attacker.models.length > 0) {
      for (const m of attacker.models) {
        if (!m.isDestroyed) {
          const mPos = m.position ?? attacker.position;
          const mdx = primaryTarget.position.x - mPos.x;
          const mdz = primaryTarget.position.z - mPos.z;
          if (Math.hypot(mdx, mdz) > 1e-4) {
            m.rotation = { x: 0, y: Math.atan2(mdx, mdz), z: 0 };
          } else {
            m.rotation = { ...attacker.rotation };
          }
        }
      }
    }
  }

  // Deadly weapons put their wounds on first (the dice stay numbered by declared index)
  const resolveOrder = deadlyFirst(
    allocations.map((_, i) => i),
    (i) => getWeapon(attacker, allocations[i].weaponId)
  );
  for (const i of resolveOrder) {
    const alloc = allocations[i];
    const weapon = getWeapon(attacker, alloc.weaponId)!;
    const target = getUnit(newState, alloc.targetId)!;
    const distance = unitDistance(attacker, target);
    noteAttackedFrom(newState, target.id, 'shot', distance);
    // An Indirect weapon fired from a Hold ignores cover from sight blockers; after a move it is a normal shot
    const sightless = ignoresSight(attacker, weapon);
    const firing = firingModels(newState, attacker, target, weapon);
    const inCover =
      target.status.includes('in-cover') ||
      (!sightless && targetCoverByMajority(newState, firing, attacker, target));
    const aliveModels = Math.max(1, target.models.filter((m) => !m.isDestroyed).length);
    const totalAttacks = (weapon.profile.attacks as number) * Math.max(1, firing.length);

    const attackerStats = {
      quality: attacker.quality,
      specialRules: attacker.specialRules,
      weaponRules: weapon.profile.specialRules,
      isMelee: false,
      isCharging: false,
      hasMoved: attacker.hasMoved,
      isFatigued: false,
      distance,
    };
    const targetStats = {
      defense: target.defense,
      inCover,
      specialRules: target.specialRules,
      modelCount: aliveModels,
      hasMoved: target.hasMoved,
    };
    const isBlast = hasTrait(weapon.profile.specialRules, 'blast');
    const deadlyValue = getTraitValue(weapon.profile.specialRules, 'deadly') ?? 1;

    let outcome: CombatOutcome;
    try {
      const rolls = isSingle ? extractAttackRolls(dice) : extractAllocationRolls(dice, i);
      if (isBlast) {
        // Spread the shot's hits over the target and its neighbours; each unit rolls its own defense batch
        const participants = getBlastParticipants(newState, attacker, target);
        const shotHits = countShotHits(attackerStats, targetStats, totalAttacks, rolls.toHit);
        const auto = autoSplitForParticipants(shotHits, participants);
      const chosen = splits?.[i];
      if (!chosen && prompts && participants.length > 1 && shotHits > 0) {
        prompts.push({
          allocIndex: i,
          weaponId: weapon.id,
          weaponName: weapon.name,
          totalHits: shotHits,
          participants: participants.map((p) => ({ unitId: p.unit.id, unitName: p.unit.name, cap: p.cap })),
          auto,
        });
      }
      const shares = chosen ?? auto;
        blastSplits.push({
          weaponId: weapon.id,
          weaponName: weapon.name,
          multiplier: getTraitValue(weapon.profile.specialRules, 'blast') ?? 1,
          totalHits: shotHits,
          shares: participants.map((p, k) => ({
            targetId: p.unit.id,
            targetName: p.unit.name,
            hits: shares[k],
            cap: p.cap,
          })),
          lostHits: Math.max(0, shotHits - shares.reduce((sum, n) => sum + n, 0)),
        });
        let offset = 0;
        const share = (count: number): BlastShare => ({ offset, count, aimedAt: targetStats });
        outcome = resolveAttack(attackerStats, targetStats, totalAttacks, rolls, share(shares[0]));
        offset += shares[0];
        for (let k = 1; k < participants.length; k++) {
          const spill = participants[k].unit;
          const count = shares[k];
          if (count === 0) continue;
          // A unit that takes spilled hits was shot at too, measured from the shooter to that unit
          noteAttackedFrom(newState, spill.id, 'shot', unitDistance(attacker, spill));
          const spillRolls = extractBlastRolls(dice, spill.id, rolls.toHit, isSingle ? undefined : i);
          const spillOutcome = resolveAttack(
            attackerStats,
            {
              defense: spill.defense,
              inCover: false,
              specialRules: spill.specialRules,
              modelCount: participants[k].cap,
            },
            totalAttacks,
            spillRolls,
            share(count)
          );
          offset += count;
          applyOutcomeWounds(ledger, spill, spillOutcome, deadlyValue);
          blastSplash.push({
            weaponId: weapon.id,
            targetId: spill.id,
            targetName: spill.name,
            hitCount: spillOutcome.hitCount,
            blockedCount: spillOutcome.blockedCount,
            blockedRolls: spillOutcome.blockedRolls,
            regenerationSavedCount: spillOutcome.regenerationSavedCount,
            wounds: spillOutcome.wounds,
            targetDestroyed: spill.isDestroyed,
            targetShaken: spill.status.includes('shaken'),
            effectiveDefense: spillOutcome.effectiveDefense,
            baseDefense: spillOutcome.baseDefense,
            defenseModifiers: spillOutcome.defenseModifiers,
            defenseRolls: spillRolls.defense.slice(0, spillOutcome.hitCount),
          });
        }
      } else {
        outcome = resolveAttack(attackerStats, targetStats, totalAttacks, rolls);
      }
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }

    if (hasTrait(weapon.profile.specialRules, 'limited')) {
      weapon.isEquipped = false;
    }

    applyOutcomeWounds(ledger, target, outcome, deadlyValue);

    totalAttackCount += outcome.attackCount;
    totalHitCount += outcome.hitCount;
    totalBonusHits += outcome.bonusHits;
    totalBlockedCount += outcome.blockedCount;
    allBlockedRolls.push(...outcome.blockedRolls);
    totalRegenerationSavedCount += outcome.regenerationSavedCount;
    totalWounds += outcome.wounds;

    allocationOutcomes[i] = {
      weaponId: weapon.id,
      weaponName: weapon.name,
      targetId: target.id,
      targetName: target.name,
      attackCount: outcome.attackCount,
      hitCount: outcome.hitCount,
      bonusHits: outcome.bonusHits,
      blockedCount: outcome.blockedCount,
      blockedRolls: outcome.blockedRolls,
      regenerationSavedCount: outcome.regenerationSavedCount,
      wounds: outcome.wounds,
      ...(outcome.shredWounds ? { shredWounds: outcome.shredWounds } : {}),
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
    };
  }
  primaryTargetDestroyed = primaryTarget?.isDestroyed ?? false;
  primaryTargetShaken = primaryTarget?.status.includes('shaken') ?? false;
  prompts?.sort((a, b) => a.allocIndex - b.allocIndex);

  // Surviving squads that lost models: their owners pick who goes (the outcome above is unchanged)
  deferCasualties(newState, ledger, action.id, attacker, { kind: 'shoot', attackerId: attacker.id });

  attacker.hasAttacked = true;
  attacker.remainingMovement = 0;
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
      regenerationSavedCount: totalRegenerationSavedCount,
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
      allocations: allocationOutcomes,
      ...(blastSplash.length > 0 ? { blastSplash } : {}),
      ...(blastSplits.length > 0 ? { blastSplits } : {}),
    },
  };

  return { ok: true, logEntry: acceptedEntry(logAction, diceResolution) };
}


type RequireResult = { result: Unit } | { valid: false; reason: string };

/**
 * Puts the defender's models on their pile-in spots (their own, or the host's when the prompt timed out),
 * clears the prompt, then resolves the charger's strike with the dice rolled for those positions.
 */
function applyPileIn(
  state: GameState,
  newState: GameState,
  action: GameAction,
  dice?: DiceResult[]
): { ok: true; logEntry: ActionLogEntry } | { ok: false; reason: string } {
  const placed = pileInPlacement(state, action);
  if (!placed) return { ok: false, reason: 'No pending pile-in' };
  const attacker = getUnit(newState, placed.attacker.id)!;
  const target = getUnit(newState, placed.target.id)!;
  const pending = placed.pending;
  const alive = livingModels(target);
  alive.forEach((m, i) => {
    m.position = { ...placed.modelPositions[i] };
    const dx = attacker.position.x - m.position.x;
    const dz = attacker.position.z - m.position.z;
    if (Math.hypot(dx, dz) > 1e-4) m.rotation = { x: 0, y: Math.atan2(dx, dz), z: 0 };
  });
  target.position = computeSquadCentroid(placed.modelPositions);
  newState.turnState.pendingReaction = null;

  if (!hasMeleeWeapon(attacker) || !dice) {
    refreshEngagements(newState);
    return { ok: true, logEntry: acceptedEntry(action) };
  }
  let resolution: DiceResolution;
  try {
    resolution = resolveChargeStrike(state, newState, action, attacker, target, dice, pending.data?.chargeDistance ?? 1);
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  return { ok: true, logEntry: acceptedEntry(action, resolution) };
}

/** The parts of a charge exchange, in order. Each part after Impact can wait for a casualty pick first. */
type ChargeStage = 'impact' | 'counter' | 'strike';


/**
 * The charge exchange once the defenders are in their final places, in tabletop order: the charger's Impact
 * hits, then every Counter weapon of the charged unit (one resolution each), then the charger's own strike,
 * then the defender's strike-back prompt, the step back, or the winner's consolidation. Shared by a charge with
 * nothing to pile in and by the confirmed (or timed-out) pile-in.
 *
 * When a part takes models off a surviving squad that is about to be counted for the next part (Impact casualties
 * on a unit that Counters, Counter casualties on the charger), the exchange pauses for that owner's
 * `pick-casualties` and `resumeChargeStrike` carries on from `stage` with the same dice. The dice were rolled
 * for the full strike counts, so the part that follows simply uses as many as the survivors need.
 */
function resolveChargeStrike(
  state: GameState,
  newState: GameState,
  action: GameAction,
  attacker: Unit,
  target: Unit,
  dice: DiceResult[],
  chargeDistance: number,
  stage: ChargeStage = 'impact',
  counterStruckBefore: boolean = false
): DiceResolution {
  const attackerId = attacker.id;
  const targetId = target.id;
  const ledger: WoundLedger = new Map();
  const attackerWasFatigued = attacker.status.includes('fatigued');
  const rollsOf = (purpose: string): number[] => dice.find((d) => d.purpose === purpose)?.rolls ?? [];
  let counterStruck = counterStruckBefore;
  let paused = false;
  const resumeAt = (next: 'counter' | 'strike'): CasualtyContinuation => ({
    kind: 'charge-resume',
    stage: next,
    attackerId,
    targetId,
    weaponId: findMeleeWeapon(attacker)?.id ?? '',
    chargeDistance,
    dice,
    ...(counterStruck ? { counterStruck: true } : {}),
  });
  markInMelee(newState, attacker.id, target.id);

  // 1. Impact(X): hits land before anyone strikes (none while the charger is Fatigued)
  let impact: SpecialStrikeOutcome | undefined;
  if (stage === 'impact') {
    const impactDice = chargeImpactDice(attacker, target);
    if (impactDice > 0) {
      const rolled = resolveImpact(
        impactDice,
        { defense: target.defense, specialRules: target.specialRules },
        { impact: rollsOf('impact'), defense: rollsOf('impact-defense'), regeneration: rollsOf('impact-regeneration') }
      );
      applyTrackedWounds(ledger, target, rolled.wounds, 1);
      impact = {
        kind: 'impact',
        attackerId,
        targetId,
        attackCount: rolled.dice,
        hitCount: rolled.hitCount,
        blockedCount: rolled.blockedCount,
        wounds: rolled.wounds,
        targetDestroyed: target.isDestroyed,
      };
    }
    // A squad that is about to Counter has its Impact casualties picked first: the Counter counts the survivors
    if (counterStrikeEntries(target, attacker).length > 0 && deferCasualties(newState, ledger, action.id, attacker, resumeAt('counter'))) {
      paused = true;
    }
  }

  // 2. Counter: the charged unit strikes first with every Counter weapon, unless it is Fatigued, Shaken or already gone
  const counterStrikes: SpecialStrikeOutcome[] = [];
  if (!paused && stage !== 'strike') {
    const counterWeapons = deadlyFirst(counterStrikeEntries(target, attacker), (c) => c.weapon);
    for (let i = 0; i < counterWeapons.length && !attacker.isDestroyed; i++) {
      const { weapon: counterWeapon, index: counterIndex, strikers: counterStrikers } = counterWeapons[i];
      const prefix = counterPurposePrefix(counterIndex);
      const counterRegen = rollsOf(`${prefix}regeneration`);
      const counterRolls: AttackRolls = {
        toHit: rollsOf(`${prefix}to-hit`),
        defense: rollsOf(`${prefix}defense`),
        ...(counterRegen.length > 0 ? { regeneration: counterRegen } : {}),
      };
      const counterAttacks = (counterWeapon.profile.attacks as number) * counterStrikers;
      const counterOutcome = resolveAttack(
        {
          quality: target.quality,
          specialRules: target.specialRules,
          weaponRules: counterWeapon.profile.specialRules,
          isMelee: true,
          isCharging: false,
          hasMoved: target.hasMoved,
          isFatigued: false,
          distance: 1,
        },
        {
          defense: attacker.defense,
          inCover: false,
          specialRules: attacker.specialRules,
          modelCount: livingModels(attacker).length || 1,
        },
        counterAttacks,
        counterRolls
      );
      applyOutcomeWounds(ledger, attacker, counterOutcome, getTraitValue(counterWeapon.profile.specialRules, 'deadly') ?? 1);
      counterStrikes.push({
        kind: 'counter',
        attackerId: target.id,
        targetId: attackerId,
        weaponName: counterWeapon.name,
        attackCount: counterOutcome.attackCount,
        hitCount: counterOutcome.hitCount,
        blockedCount: counterOutcome.blockedCount,
        wounds: counterOutcome.wounds,
        targetDestroyed: attacker.isDestroyed,
      });
    }
    if (counterStrikes.length > 0) {
      counterStruck = true;
      if (!target.status.includes('fatigued')) target.status.push('fatigued');
      // Counter casualties on a surviving squad charger are picked before it strikes: it strikes with the survivors
      if (!attacker.isDestroyed && deferCasualties(newState, ledger, action.id, target, resumeAt('strike'))) paused = true;
    }
  }

  // 3. The charger's own strike with every melee weapon it carries (one resolution each), if it and its target are
  // still standing. Models are counted now: casualties from Impact or Counter take their weapons with them.
  let strikes: StrikeResult[] = [];
  if (!paused && !attacker.isDestroyed && !target.isDestroyed) {
    strikes = resolveStrikes(strikeEntries(attacker, target), attacker, target, dice, ledger, {
      isCharging: true,
      hasMoved: true,
      isFatigued: attackerWasFatigued || attacker.status.includes('shaken'),
      distance: chargeDistance,
      // How far away the target was when the charge began (Ferocious), as Hold the Line reads it
      chargedFrom: newState.turnState.attackedFrom?.[target.id]?.charged,
    });
  }

  let pushedBack = false;
  let pushBackPos: Vector3 | undefined;
  if (!paused) {
    // A surviving squad that lost models: its owner picks who goes, then the strike-back / push-back follows
    const deferred = deferCasualties(newState, ledger, action.id, attacker, {
      kind: 'charge-strike',
      attackerId: attacker.id,
      targetId: target.id,
      weaponId: findMeleeWeapon(attacker)?.id,
      ...(counterStruck ? { counterStruck: true } : {}),
    });
    if (!attacker.status.includes('fatigued')) {
      attacker.status.push('fatigued');
    }
    if (!deferred) ({ pushedBack, pushBackPos } = settleChargeStrike(newState, action.id, attacker, target, counterStruck));
  }
  const targetShaken = target.status.includes('shaken');
  const defenderMelee = paused ? undefined : strikeBackWeapons(target, counterStruck)[0];
  const summary = summarizeStrikes(strikes);
  // A resumed part only shows the dice it used (the earlier parts are in the entry of the action that rolled them)
  const resumed = stage !== 'impact';

  return {
    rollId: action.id,
    specs: resumed ? [] : getDiceSpecs(state, action) ?? [],
    results: !resumed
      ? dice
      : stage === 'strike'
        ? dice.filter((d) => !/^(impact|counter\d+-)/.test(d.purpose ?? ''))
        : paused
          ? dice.filter((d) => /^counter\d+-/.test(d.purpose ?? ''))
          : dice.filter((d) => !/^impact/.test(d.purpose ?? '')),
    context: {
      attackerId,
      targetId,
      weaponId: strikes[0]?.entry.weapon.id ?? findMeleeWeapon(attacker)?.id,
      retaliationWeaponId: defenderMelee?.id,
      actionId: action.id,
    },
    outcome: {
      ...summary,
      targetDestroyed: target.isDestroyed,
      targetShaken,
      baseQuality: attacker.quality,
      baseDefense: target.defense,
      coverApplied: false,
      pushedBack,
      ...(pushBackPos ? { pushBackPosition: pushBackPos } : {}),
      ...(impact ? { impact } : {}),
      ...(counterStrikes.length > 0 ? { counterStrikes } : {}),
    },
  };
}

/** Carry on with a charge exchange that paused for a casualty pick (the pick is now in). */
function resumeChargeStrike(
  newState: GameState,
  action: GameAction,
  after: Extract<CasualtyContinuation, { kind: 'charge-resume' }>
): DiceResolution {
  const attacker = getUnit(newState, after.attackerId)!;
  const target = getUnit(newState, after.targetId)!;
  return resolveChargeStrike(
    newState,
    newState,
    action,
    attacker,
    target,
    after.dice,
    after.chargeDistance,
    after.stage,
    !!after.counterStruck
  );
}

/**
 * What follows the charger's strike once its wounds are on the target: the winner's consolidation when the
 * target is gone, the step back when it cannot strike back, otherwise the defender's strike-back prompt.
 */
function settleChargeStrike(
  newState: GameState,
  actionId: string,
  attacker: Unit,
  target: Unit,
  counterStruck: boolean = false
): { pushedBack: boolean; pushBackPos?: Vector3 } {
  // The charger fell to the Counter strike: it is the defender's win
  if (attacker.isDestroyed) return settleStrikeBack(newState, actionId, attacker, target);
  const defenderMelee = strikeBackWeapons(target, counterStruck);
  let pushedBack = false;
  let pushBackPos: Vector3 | undefined;

  if (target.isDestroyed) {
    // If defender is destroyed, victor may consolidate up to 3"
    newState.turnState.pendingReaction = createConsolidationReaction(actionId, attacker, target.name);
    refreshEngagements(newState);
  } else if (defenderMelee.length === 0) {
    pushBackPos = pushBackChargerModels(newState, attacker, target);
    pushedBack = true;
    attacker.status = attacker.status.filter((s) => s !== 'engaged');
    target.status = target.status.filter((s) => s !== 'engaged');
    refreshEngagements(newState);
  } else {
    // Defer retaliation strike to defender's choice via pendingReaction
    newState.turnState.pendingReaction = {
      id: `${actionId}-retaliation`,
      type: 'melee-retaliation',
      promptingPlayerId: target.ownerId,
      sourceUnitId: attacker.id,
      targetUnitId: target.id,
      title: 'Melee Retaliation',
      description: `${attacker.name} charged ${target.name}! Strike back with ${defenderMelee.map((w) => w.name).join(' + ')}?`,
      warning: target.status.includes('fatigued') || target.status.includes('shaken')
        ? 'This unit is already Fatigued/Shaken (hits on natural 6s only).'
        : 'Striking back will make this unit Fatigued (hits on natural 6s in melee for the rest of the round).',
      options: [
        {
          id: 'strike-back',
          label: `Strike Back (${defenderMelee.map((w) => w.name).join(' + ')})`,
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
        chargeActionId: actionId,
        attackerId: attacker.id,
        targetId: target.id,
        weaponId: defenderMelee[0].id,
        weaponIds: defenderMelee.map((w) => w.id),
      },
    };
  }
  return { pushedBack, pushBackPos };
}

/**
 * What follows the defender's strike-back (or decline): both units step apart when both survive, and the
 * survivor of a wipe-out consolidates.
 */
function settleStrikeBack(
  newState: GameState,
  actionId: string,
  charger: Unit,
  defender: Unit
): { pushedBack: boolean; pushBackPos?: Vector3 } {
  // Separation / 1" Push-Back (if both units survived)
  let pushedBack = false;
  let pushBackPos: Vector3 | undefined;
  if (!charger.isDestroyed && !defender.isDestroyed) {
    pushBackPos = pushBackChargerModels(newState, charger, defender);
    pushedBack = true;
    charger.status = charger.status.filter((s) => s !== 'engaged');
    defender.status = defender.status.filter((s) => s !== 'engaged');
  }

  if (charger.isDestroyed && !defender.isDestroyed) {
    // Defender consolidates up to 3" upon wiping out charger in melee retaliation
    newState.turnState.pendingReaction = createConsolidationReaction(actionId, defender, charger.name);
  } else if (!charger.isDestroyed && defender.isDestroyed) {
    // Charger consolidates up to 3" upon wiping out defender in melee
    newState.turnState.pendingReaction = createConsolidationReaction(actionId, charger, defender.name);
  } else {
    newState.turnState.pendingReaction = null;
  }
  refreshEngagements(newState);
  return { pushedBack, pushBackPos };
}

function requireActiveUnit(state: GameState, actorId: string, unitId: string): RequireResult {
  const unit = getUnit(state, unitId);
  if (!unit) return { valid: false, reason: 'Unknown unit' };
  if (unit.ownerId !== actorId) return { valid: false, reason: 'Unit does not belong to acting player' };
  if (unit.isDestroyed) return { valid: false, reason: 'Unit is destroyed' };
  if (state.turnState.activeUnitId !== unitId) {
    return { valid: false, reason: 'Unit is not the active unit' };
  }
  if (unit.status.includes('shaken') || unit.status.includes('routed')) {
    return { valid: false, reason: 'Unit is Shaken or routed and cannot act' };
  }
  return { result: unit };
}

function requireTarget(state: GameState, actorId: string, targetId: string): RequireResult {
  const target = getUnit(state, targetId);
  if (!target) return { valid: false, reason: 'Unknown target' };
  if (!isEnemyOf(state, target, actorId)) return { valid: false, reason: 'Target is not an enemy unit' };
  if (target.isDestroyed) return { valid: false, reason: 'Target is destroyed' };
  if (target.isDeployed === false) return { valid: false, reason: 'Target is not on the table yet' };
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

/**
 * Models that strike in melee (within 3" / 4" of an enemy model); at least one so a lone fighter always swings.
 * With a `weapon`, only the models that carry it count: 0 means that weapon does not strike (a squad whose only
 * carrier is out of reach or dead). When nobody is in reach at all (a charge still being measured) a carried
 * weapon counts one striker, as the unit always did.
 */
function strikers(striker: Unit, foe: Unit, weapon?: Weapon): number {
  const any = strikingModelCount(striker, foe);
  if (!weapon) return Math.max(1, any);
  if (any === 0) return isCarried(striker, weapon) ? 1 : 0;
  return strikingModelCount(striker, foe, weapon.id);
}

/** Dice purpose prefix of a melee weapon's batch: the first slot is unprefixed (as the single weapon always was), later ones `w1-`, `w2-`, ... */
function strikePrefix(slot: number): string {
  return slot === 0 ? '' : `w${slot}-`;
}

/** One melee weapon taking part in a strike: its slot in the unit's fixed melee order and how many models strike with it. */
interface StrikeEntry {
  weapon: Weapon;
  slot: number;
  strikers: number;
}

/**
 * The melee weapons that strike `foe`: every equipped melee weapon (Assault included) in equipment order that at
 * least one living model within reach carries, with that model count. `only` restricts to named weapon ids.
 * Slots come from the unit's whole melee list, so a weapon losing its last carrier never renumbers the others.
 */
function strikeEntries(striker: Unit, foe: Unit, only?: string[]): StrikeEntry[] {
  const entries: StrikeEntry[] = [];
  meleeWeaponSlots(striker).forEach((weapon, slot) => {
    if (only && !only.includes(weapon.id)) return;
    const attacks = weapon.profile.attacks;
    if (typeof attacks !== 'number' || !Number.isInteger(attacks) || attacks < 1) return;
    const count = strikers(striker, foe, weapon);
    if (count > 0) entries.push({ weapon, slot, strikers: count });
  });
  return entries;
}

/** What a charged unit strikes back with: the weapons the prompt named, otherwise all it can strike with. */
function strikeBackEntries(defender: Unit, charger: Unit, pending: PendingReaction): StrikeEntry[] {
  const ids = pending.data?.weaponIds as string[] | undefined;
  const only = ids ?? (pending.data?.weaponId ? [pending.data.weaponId as string] : undefined);
  // The strike-back is sized and resolved from the same state, so its dice are numbered in the order they strike
  return strikeEntries(defender, charger, only).map((entry, i) => ({ ...entry, slot: i }));
}

/** The weapons a charged unit strikes back with: after Counter strikes only its non-Counter weapons, otherwise all of them. */
function strikeBackWeapons(target: Unit, counterStruck: boolean): Weapon[] {
  return counterStruck ? findNonCounterMeleeWeapons(target) : findMeleeWeapons(target);
}

/** Reason a charge has no weapon to strike with (a named weapon must be a melee one; some living model must carry one). */
function chargeWeaponProblem(unit: Unit, weaponId?: string): boolean {
  if (weaponId) {
    const named = unit.weapons.find((w) => w.id === weaponId);
    if (!named || !isMeleeWeapon(named)) return true;
  }
  return !hasMeleeWeapon(unit);
}

/** Dice for every striking weapon: one batch each, sized by attacks x models striking with it. */
function strikeSpecs(
  entries: StrikeEntry[],
  striker: Unit,
  foe: Unit | undefined,
  ctx: { isCharging: boolean; isFatigued?: boolean; distance: number }
): DiceSpec[] {
  const specs: DiceSpec[] = [];
  const foeModels = Math.max(1, foe?.models?.filter((m) => !m.isDestroyed).length ?? 1);
  for (const { weapon, slot, strikers: count } of entries) {
    const prefix = strikePrefix(slot);
    const batch = getAttackDiceSpecs((weapon.profile.attacks as number) * count, {
      attackerRules: striker.specialRules,
      weaponRules: weapon.profile.specialRules,
      defenderRules: foe?.specialRules ?? [],
      defenderModelCount: foeModels,
      isMelee: true,
      isCharging: ctx.isCharging,
      ...(ctx.isFatigued !== undefined ? { isFatigued: ctx.isFatigued } : {}),
      distance: ctx.distance,
    });
    specs.push(...batch.map((sp) => ({ ...sp, purpose: `${prefix}${sp.purpose}` })));
  }
  return specs;
}

/** The to-hit / defense / regeneration rolls of one melee weapon's batch. */
function strikeRolls(dice: DiceResult[], slot: number): AttackRolls {
  if (slot === 0) return extractAttackRolls(dice);
  const prefix = strikePrefix(slot);
  const find = (purpose: string) => dice.find((d) => d.purpose === `${prefix}${purpose}`);
  const toHit = find('to-hit');
  const defense = find('defense');
  const regeneration = find('regeneration');
  if (!toHit || !defense) throw new Error(`Dice results must include '${prefix}to-hit' and '${prefix}defense' purposes`);
  return { toHit: toHit.rolls, defense: defense.rolls, ...(regeneration ? { regeneration: regeneration.rolls } : {}) };
}

interface StrikeResult {
  entry: StrikeEntry;
  outcome: CombatOutcome;
  targetName: string;
  targetId: string;
  targetDestroyed: boolean;
  targetShaken: boolean;
}

/**
 * Resolve each striking weapon in order against `foe`, adding its wounds to `ledger`. Every weapon uses its own
 * pre-rolled batch, so a later weapon may still be resolved after an earlier one destroyed the foe (the wounds
 * simply run past the end, as for a multi-weapon shot).
 */
function resolveStrikes(
  entries: StrikeEntry[],
  striker: Unit,
  foe: Unit,
  dice: DiceResult[],
  ledger: WoundLedger,
  ctx: { isCharging: boolean; hasMoved: boolean; isFatigued: boolean; distance: number; chargedFrom?: number }
): StrikeResult[] {
  const results: StrikeResult[] = [];
  const foeModels = Math.max(1, foe.models?.filter((m) => !m.isDestroyed).length ?? 1);
  // Deadly weapons put their wounds on first; the results stay in weapon order
  const resolveOrder = deadlyFirst(entries, (e) => e.weapon);
  for (const entry of resolveOrder) {
    const { weapon, slot } = entry;
    const outcome = resolveAttack(
      {
        quality: striker.quality,
        specialRules: striker.specialRules,
        weaponRules: weapon.profile.specialRules,
        isMelee: true,
        isCharging: ctx.isCharging,
        hasMoved: ctx.hasMoved,
        isFatigued: ctx.isFatigued,
        distance: ctx.distance,
        ...(ctx.chargedFrom !== undefined ? { chargedFrom: ctx.chargedFrom } : {}),
      },
      {
        defense: foe.defense,
        inCover: false,
        specialRules: foe.specialRules,
        modelCount: foeModels,
      },
      (weapon.profile.attacks as number) * entry.strikers,
      strikeRolls(dice, slot)
    );
    applyOutcomeWounds(ledger, foe, outcome, getTraitValue(weapon.profile.specialRules, 'deadly') ?? 1);
    results.push({
      entry,
      outcome,
      targetId: foe.id,
      targetName: foe.name,
      targetDestroyed: foe.isDestroyed,
      targetShaken: foe.status.includes('shaken'),
    });
  }
  return entries.map((e) => results.find((r) => r.entry === e)!);
}

/** The totals of a melee exchange (sums over every weapon) plus the per-weapon results, for the dice outcome. */
function summarizeStrikes(results: StrikeResult[]): Pick<
  DiceResolution['outcome'],
  | 'attackCount'
  | 'hitCount'
  | 'bonusHits'
  | 'blockedCount'
  | 'blockedRolls'
  | 'regenerationSavedCount'
  | 'wounds'
  | 'shredWounds'
  | 'effectiveQuality'
  | 'effectiveDefense'
  | 'baseQuality'
  | 'hitModifiers'
  | 'baseDefense'
  | 'defenseModifiers'
  | 'coverApplied'
  | 'apApplied'
  | 'meleeStrikes'
> {
  const first = results[0]?.outcome;
  const sum = (pick: (o: CombatOutcome) => number) => results.reduce((n, r) => n + pick(r.outcome), 0);
  const bonusHits = sum((o) => o.bonusHits);
  const regenerationSavedCount = sum((o) => o.regenerationSavedCount);
  const shredWounds = sum((o) => o.shredWounds ?? 0);
  const apApplied = Math.max(0, ...results.map((r) => r.outcome.apApplied));
  return {
    attackCount: sum((o) => o.attackCount),
    hitCount: sum((o) => o.hitCount),
    ...(bonusHits > 0 ? { bonusHits } : {}),
    blockedCount: sum((o) => o.blockedCount),
    blockedRolls: results.flatMap((r) => r.outcome.blockedRolls),
    ...(regenerationSavedCount > 0 ? { regenerationSavedCount } : {}),
    wounds: sum((o) => o.wounds),
    ...(shredWounds > 0 ? { shredWounds } : {}),
    effectiveQuality: first?.effectiveQuality,
    effectiveDefense: first?.effectiveDefense,
    baseQuality: first?.baseQuality,
    hitModifiers: first?.hitModifiers,
    baseDefense: first?.baseDefense,
    defenseModifiers: first?.defenseModifiers,
    ...(first?.coverApplied ? { coverApplied: true } : {}),
    ...(apApplied > 0 ? { apApplied } : {}),
    meleeStrikes: results.map((r) => ({
      weaponId: r.entry.weapon.id,
      weaponName: r.entry.weapon.name,
      targetId: r.targetId,
      targetName: r.targetName,
      attackCount: r.outcome.attackCount,
      hitCount: r.outcome.hitCount,
      ...(r.outcome.bonusHits > 0 ? { bonusHits: r.outcome.bonusHits } : {}),
      blockedCount: r.outcome.blockedCount,
      blockedRolls: r.outcome.blockedRolls,
      ...(r.outcome.regenerationSavedCount > 0 ? { regenerationSavedCount: r.outcome.regenerationSavedCount } : {}),
      wounds: r.outcome.wounds,
      ...(r.outcome.shredWounds ? { shredWounds: r.outcome.shredWounds } : {}),
      targetDestroyed: r.targetDestroyed,
      targetShaken: r.targetShaken,
      effectiveQuality: r.outcome.effectiveQuality,
      effectiveDefense: r.outcome.effectiveDefense,
      baseQuality: r.outcome.baseQuality,
      hitModifiers: r.outcome.hitModifiers,
      baseDefense: r.outcome.baseDefense,
      defenseModifiers: r.outcome.defenseModifiers,
      ...(r.outcome.apApplied > 0 ? { apApplied: r.outcome.apApplied } : {}),
    })),
  };
}

/** Move a charging unit (anchor and every living model) as one block so its anchor stands at `end`. */
function moveChargerModels(attacker: Unit, end: Vector3): void {
  const deltaX = end.x - attacker.position.x;
  const deltaZ = end.z - attacker.position.z;
  if (attacker.models && attacker.models.length > 0) {
    for (const m of attacker.models) {
      if (m.isDestroyed) continue;
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
  attacker.position = { ...end };
}

function beginActivation(state: GameState, unit: Unit): void {
  unit.isActivated = true;
  unit.hasMoved = false;
  unit.hasAttacked = false;
  unit.isRushing = false;
  unit.remainingMovement = getEffectiveSpeed(unit);
  delete unit.hazardTestedPieceIds;
  resetModelMovement(unit);
  recordWoundBaseline(state);
  delete state.turnState.attackedFrom;
  state.turnState.unitsActivatedThisRound.push(unit.id);
  state.turnState.activeUnitId = unit.id;
  state.turnState.charge = null;
  state.turnState.phase = 'activation';
}

/** Morale Tests taken at the end of each action's activation, so the log entry can show them. */
const moraleLog = new WeakMap<GameAction, MoraleTestRecord[]>();
/** Melee results compared at the end of an action's activation. */
const meleeLog = new WeakMap<GameAction, MeleeResultRecord[]>();

/**
 * End the active unit's activation: units that took a wound and are at half strength or less test Morale
 * (server dice), the active unit sheds Shaken (its idle activation is over), then play passes on.
 */
function finishActivation(state: GameState, dice?: DiceResult[], action?: GameAction): void {
  const active = getActiveUnit(state);
  state.turnState.activeUnitId = null;
  state.turnState.charge = null; // an unfinished declared charge is abandoned: no melee

  const moraleRolls = dice?.find((d) => d.purpose === 'morale')?.rolls ?? [];
  const fearlessRolls = dice?.find((d) => d.purpose === 'fearless')?.rolls ?? [];
  // A Shaken active unit has spent its activation idle: it recovers before the tests, so it only tests
  // again if it was wounded meanwhile
  if (active && active.status.includes('shaken')) {
    active.status = active.status.filter((s) => s !== 'shaken');
  }
  const meleeResults = getMeleeResults(state);
  // Who would push each tested unit that is not Shaken yet (decided before the tests change anything)
  const pushers = new Map<string, Unit>();
  for (const u of getUnitsRequiringMorale(state)) {
    const attacker = u.status.includes('shaken') ? null : pushAttackerFor(state, u, active);
    if (attacker) pushers.set(u.id, attacker);
  }
  const tests = applyEndOfActivationMorale(state, moraleRolls, fearlessRolls);
  // A unit this test made Shaken (it rolled and failed; a Routed unit is gone) can be pushed on a 4+
  const pushRolls = dice?.find((d) => d.purpose === 'push')?.rolls ?? [];
  const queue: PushQueueEntry[] = [];
  let pushIdx = 0;
  for (const record of tests) {
    const attacker = pushers.get(record.unitId);
    if (!attacker || record.outcome !== 'shaken' || record.roll === undefined) continue;
    const pushRoll = pushRolls[pushIdx++];
    if (pushRoll === undefined) continue;
    record.pushRoll = pushRoll;
    if (pushRoll >= PUSH_TARGET) queue.push({ unitId: record.unitId, attackerId: attacker.id });
  }
  if (tests.length > 0 && action) moraleLog.set(action, tests);
  if (meleeResults.length > 0 && action) meleeLog.set(action, meleeResults);
  delete state.turnState.woundBaseline;
  delete state.turnState.meleeUnitIds;
  delete state.turnState.meleePairs;
  delete state.turnState.attackedFrom;
  advanceActivation(state);
  if (state.status !== 'game-over') startNextPush(state, action?.id ?? 'push', queue);
}

/** Set the next waiting push as the pending reaction (skipping units that are gone), if any. */
function startNextPush(state: GameState, actionId: string, queue: PushQueueEntry[]): void {
  const rest = [...queue];
  while (rest.length > 0) {
    const entry = rest.shift()!;
    const shaken = getUnit(state, entry.unitId);
    const attacker = getUnit(state, entry.attackerId);
    if (!shaken || shaken.isDestroyed || !shaken.status.includes('shaken') || !attacker) continue;
    state.turnState.pendingReaction = createPushReaction(actionId, shaken, attacker, rest);
    return;
  }
}

/** What a push action (the Auto choice, or a `push-move`) would do right now, from the pending `push` reaction. */
function pushResolution(
  state: GameState,
  action: GameAction
): { pending: PendingReaction; unit: Unit; attacker: Unit; model: Model | null; plan: ReturnType<typeof planPush> } | null {
  const pending = state.turnState.pendingReaction;
  if (!pending || pending.type !== 'push') return null;
  const unit = getUnit(state, pending.targetUnitId);
  const attacker = getUnit(state, pending.sourceUnitId);
  if (!unit || !attacker) return null;
  const none = { pending, unit, attacker, model: null, plan: { ok: false, reason: 'No legal push' } as ReturnType<typeof planPush> };
  if (action.type === 'respond-reaction' && (action.payload as { choiceId?: string }).choiceId === PUSH_DECLINE_CHOICE) return none;
  if (action.type === 'push-move') {
    const payload = action.payload as { modelId?: string; destination?: Vector3 };
    const model = livingModels(unit).find((m) => m.id === payload.modelId);
    if (!model || !payload.destination) return none;
    return { pending, unit, attacker, model, plan: planPush(state, unit, model, payload.destination) };
  }
  const auto = autoPush(state, unit, attacker);
  return auto ? { pending, unit, attacker, model: auto.model, plan: auto.plan } : none;
}

/** Apply a push (Auto or chosen), roll its fall if any, tidy the rest of the unit, and move on to the next push. */
function applyPush(state: GameState, newState: GameState, action: GameAction, dice?: DiceResult[]): ActionLogEntry {
  const resolved = pushResolution(state, action)!;
  const unit = getUnit(newState, resolved.unit.id)!;
  const model = resolved.model ? livingModels(unit).find((m) => m.id === resolved.model!.id) : undefined;
  const events: TraversalEvent[] = [];
  if (model && resolved.plan.ok) {
    const plan = resolved.plan;
    const from = model.position ?? unit.position;
    model.position = { ...plan.position };
    events.push({
      type: 'push',
      wounds: 0,
      text: `${unit.name} pushed: one model moved ${Math.hypot(plan.position.x - from.x, plan.position.z - from.z).toFixed(1)}"`,
    });
    if (plan.fallDice > 0) {
      const rolls = dice?.find((d) => d.purpose === 'fall')?.rolls?.slice(0, plan.fallDice);
      const wounds = rolls ? countFallWounds(rolls) : 0;
      events.push({
        type: 'fall',
        wounds,
        rolls: rolls && rolls.length > 0 ? rolls : undefined,
        text: `Pushed off an edge: fell ${plan.fallHeight.toFixed(1)}" (${plan.fallDice} dice, 1-3 wounds)${
          rolls ? `: rolled ${rollsText(rolls)}` : ''
        } → ${wounds > 0 ? `${wounds} wound${wounds > 1 ? 's' : ''}` : 'unhurt'}`,
      });
      if (wounds > 0) applyFallWounds(unit, model, wounds);
    } else if (plan.fallHeight > 0) {
      events.push({ type: 'fall', wounds: 0, text: `Pushed off an edge: fell ${plan.fallHeight.toFixed(1)}"` });
    }
    if (!unit.isDestroyed) {
      // A real fall (dice rolled) brings the whole unit down to the fallen model; a short drop just keeps the unit together
      if (plan.fallDice > 0) gatherAroundFallen(newState, unit, model);
      if (!model.isDestroyed) regroupAfterPush(newState, unit, model);
    }
    const alive = livingModels(unit);
    if (alive.length > 1) unit.position = computeSquadCentroid(alive.map((m) => m.position ?? unit.position));
    else if (alive.length === 1) unit.position = { ...(alive[0].position ?? unit.position) };
  } else {
    const declined = action.type === 'respond-reaction' && (action.payload as { choiceId?: string }).choiceId === PUSH_DECLINE_CHOICE;
    events.push({ type: 'push', wounds: 0, text: declined ? `${unit.name}: push declined` : `${unit.name}: no legal push` });
  }
  recordTraversal(action, unit, events, dice);

  const data = resolved.pending.data as unknown as PushData;
  newState.turnState.pendingReaction = null;
  refreshEngagements(newState);
  if (newState.status !== 'game-over') startNextPush(newState, data.actionId, data.rest);
  return acceptedEntry(action);
}

export function getUnitTough(unit: Unit, finalModel?: Model): number {
  return (
    getTraitValue(unit.specialRules, 'tough') ??
    finalModel?.maxWounds ??
    (unit.models.length <= 1 ? unit.maxWounds : 1) ??
    1
  );
}

/**
 * Apply unblocked wounds to a unit. A model is killed (removed) when its wounds reach its Tough value; a
 * wounded model keeps taking wounds until it dies before another model takes any. `victimIds` are the
 * owner's picks (consumed in order) for who takes the wounds when a fresh model has to be chosen; without a
 * pick the already-wounded model goes first, then the first living model. Deadly(X) wounds arrive in chunks of
 * X for one hit: the excess of a chunk past the model it kills does not spill over.
 */
function applyWounds(unit: Unit, wounds: number, deadlyValue: number = 1, victimIds?: string[]): void {
  if (wounds <= 0) return;

  if (!unit.models || unit.models.length === 0) {
    unit.wounds = Math.max(0, unit.wounds - wounds);
    if (unit.wounds <= 0) markUnitDestroyed(unit);
    return;
  }

  const step = Math.max(1, deadlyValue);
  let remaining = wounds;
  let victim: Model | undefined;
  while (remaining > 0) {
    const alive = unit.models.filter((m) => !m.isDestroyed);
    if (alive.length === 0) break;
    if (!victim || victim.isDestroyed) {
      victim = alive.find((m) => m.wounds < m.maxWounds);
      if (!victim) {
        const wanted = victimIds?.shift();
        victim = (wanted ? alive.find((m) => m.id === wanted) : undefined) ?? alive[0];
      }
    }
    const chunk = Math.min(remaining, step);
    victim.wounds = Math.max(0, victim.wounds - chunk);
    remaining -= chunk;
    if (victim.wounds <= 0) victim.isDestroyed = true;
  }

  settleAfterWounds(unit);
}

/** Recompute the unit's totals and squad position after its models took wounds (destroys it when none are left). */
function settleAfterWounds(unit: Unit): void {
  const surviving = unit.models.filter((m) => !m.isDestroyed);
  unit.wounds = surviving.reduce((sum, m) => sum + Math.max(0, m.wounds), 0);
  if (surviving.length === 0) {
    markUnitDestroyed(unit);
    return;
  }
  if (unit.models.length > 1 && surviving.some((m) => m.position)) {
    unit.position = computeSquadCentroid(surviving.map((m) => m.position ?? unit.position));
  }
}

/**
 * Attack wounds in the tabletop order (see `allocateWounds`): the most wounded living model first, then the
 * owner's ordered picks, else the first living model. Returns how many unhurt models had to be chosen.
 */
function applyTabletopWounds(unit: Unit, wounds: number, deadlyValue: number, picks?: string[]): WoundAllocation {
  const none: WoundAllocation = { unhurtStarts: 0, unhurtAtFirstStart: 0 };
  if (wounds <= 0) return none;
  if (!unit.models || unit.models.length === 0) {
    applyWounds(unit, wounds, deadlyValue);
    return none;
  }
  const stats = allocateWounds(unit.models, wounds, deadlyValue, picks ?? []);
  settleAfterWounds(unit);
  return stats;
}

/**
 * Fall wounds belong to the model that fell: it takes them until it dies, and any excess is lost (never carried
 * to the rest of the squad). A unit with no model list takes them as a whole.
 */
function applyFallWounds(unit: Unit, fallen: Model | undefined, wounds: number): void {
  if (wounds <= 0) return;
  if (!fallen || !unit.models || unit.models.length === 0) {
    applyWounds(unit, wounds);
    return;
  }
  const taken = Math.min(wounds, Math.max(0, fallen.wounds));
  if (taken <= 0) return;
  fallen.wounds = Math.max(0, fallen.wounds - taken);
  if (fallen.wounds <= 0) fallen.isDestroyed = true;
  settleAfterWounds(unit);
}

function markUnitDestroyed(unit: Unit): void {
  unit.wounds = 0;
  unit.isDestroyed = true;
  unit.status = unit.status.filter((s) => s !== 'engaged');
  for (const m of unit.models ?? []) {
    m.wounds = 0;
    m.isDestroyed = true;
  }
}

/** Wounds taken by multi-model units during one action, so each damaged unit's owner can be asked who goes. */
type WoundLedger = Map<
  string,
  {
    snapshot: Unit;
    livingBefore: number;
    applications: WoundApplication[];
    /** Times the wounds had to start on an unhurt model (each is one pick for the owner). */
    unhurtStarts: number;
    /** Unhurt living models at the first such moment (0 until it happens). */
    unhurtAtFirstStart: number;
  }
>;

/** An attack's wounds on a unit: the Deadly-multiplied wounds first, then Shred's extra single wounds. */
function applyOutcomeWounds(
  ledger: WoundLedger,
  unit: Unit,
  outcome: { wounds: number; shredWounds?: number },
  deadlyValue: number = 1
): void {
  const extra = outcome.shredWounds ?? 0;
  applyTrackedWounds(ledger, unit, outcome.wounds - extra, deadlyValue);
  applyTrackedWounds(ledger, unit, extra, 1);
}

/** `applyWounds`, remembering the unit as it was and each application so the casualties can be deferred. */
function applyTrackedWounds(ledger: WoundLedger, unit: Unit, wounds: number, deadlyValue: number = 1): void {
  const alive = livingModels(unit).length;
  if (wounds > 0 && (alive >= 2 || ledger.has(unit.id))) {
    let record = ledger.get(unit.id);
    if (!record) {
      record = { snapshot: snapshotUnit(unit), livingBefore: alive, applications: [], unhurtStarts: 0, unhurtAtFirstStart: 0 };
      ledger.set(unit.id, record);
    }
    record.applications.push({ wounds, deadlyValue });
    const stats = applyTabletopWounds(unit, wounds, deadlyValue);
    if (stats.unhurtStarts > 0 && record.unhurtStarts === 0) record.unhurtAtFirstStart = stats.unhurtAtFirstStart;
    record.unhurtStarts += stats.unhurtStarts;
    return;
  }
  applyWounds(unit, wounds, deadlyValue);
}

/**
 * After an attack's wounds are applied: every tracked unit that lost models but survived is put back as it was
 * and queued for its owner's pick (one prompt per unit, in resolution order). Units the attack wiped out keep
 * the result they have. Returns the first prompt (now pending), or null when nobody needs to pick.
 */
function deferCasualties(
  newState: GameState,
  ledger: WoundLedger,
  actionId: string,
  sourceUnit: Unit,
  after: CasualtyContinuation
): PendingReaction | null {
  const entries: CasualtyEntry[] = [];
  for (const [unitId, record] of ledger) {
    const unit = getUnit(newState, unitId);
    if (!unit || unit.isDestroyed) continue;
    // Every wound fitted on already-wounded models, or the only unhurt model was the only choice: keep the result
    if (record.unhurtStarts === 0 || record.unhurtAtFirstStart <= 1) continue;
    const removed = record.livingBefore - livingModels(unit).length;
    restoreUnit(unit, record.snapshot);
    entries.push({
      unitId,
      count: record.unhurtStarts,
      applications: record.applications,
      lockedModelIds: lockedWoundedModels(unit).map((m) => m.id),
      removed,
    });
  }
  if (entries.length === 0) return null;
  const [entry, ...rest] = entries;
  const reaction = createPickCasualtiesReaction(actionId, 0, getUnit(newState, entry.unitId)!, sourceUnit, {
    entry,
    rest,
    after,
  });
  newState.turnState.pendingReaction = reaction;
  refreshEngagements(newState);
  return reaction;
}

/** Remove the picked models from the damaged unit and put the rest of the wounds on the survivors. */
function replayCasualties(unit: Unit, entry: CasualtyEntry, victims: string[]): void {
  const ids = [...victims];
  for (const app of entry.applications) {
    applyTabletopWounds(unit, app.wounds, app.deadlyValue, ids);
  }
}

/** A pick-casualties action (the owner's, or the host's on timeout): apply it, then carry on with the interrupted flow. */
function applyPickCasualties(newState: GameState, action: GameAction, victims: string[]): ActionLogEntry {
  const pending = newState.turnState.pendingReaction!;
  const data = pending.data as unknown as PickCasualtiesData;
  const unit = getUnit(newState, data.entry.unitId)!;
  replayCasualties(unit, data.entry, victims);
  newState.turnState.pendingReaction = null;

  // Another damaged unit of the same action is still waiting for its owner
  if (data.rest.length > 0) {
    const [entry, ...rest] = data.rest;
    const next = getUnit(newState, entry.unitId)!;
    const source = getUnit(newState, data.after.attackerId) ?? unit;
    newState.turnState.pendingReaction = createPickCasualtiesReaction(data.actionId, data.index + 1, next, source, {
      entry,
      rest,
      after: data.after,
    });
    refreshEngagements(newState);
    return acceptedEntry(action);
  }

  const after = data.after;
  let settled: { pushedBack: boolean; pushBackPos?: Vector3 } = { pushedBack: false };
  if (after.kind === 'charge-strike') {
    const attacker = getUnit(newState, after.attackerId)!;
    settled = settleChargeStrike(newState, action.id, attacker, getUnit(newState, after.targetId) ?? unit, !!after.counterStruck);
  } else if (after.kind === 'charge-resume') {
    const resumed = resumeChargeStrike(newState, action, after);
    refreshEngagements(newState);
    return acceptedEntry(action, resumed);
  } else if (after.kind === 'strike-back') {
    const defender = getUnit(newState, after.attackerId)!;
    settled = settleStrikeBack(newState, action.id, unit, defender);
  } else if (after.kind === 'activation-hazard') {
    if (after.finish) finishActivation(newState, after.finish.dice, action);
  } else if (after.kind === 'fight' && unit.isDestroyed) {
    const attacker = getUnit(newState, after.attackerId)!;
    newState.turnState.pendingReaction = createConsolidationReaction(action.id, attacker, unit.name);
  }
  refreshEngagements(newState);

  if (!settled.pushedBack) return acceptedEntry(action);
  const dice: DiceResolution = {
    rollId: action.id,
    specs: [],
    results: [],
    context: {
      attackerId: after.attackerId,
      targetId: unit.id,
      actionId: action.id,
    },
    outcome: {
      attackCount: 0,
      hitCount: 0,
      blockedCount: 0,
      wounds: 0,
      targetDestroyed: false,
      pushedBack: true,
      pushBackPosition: settled.pushBackPos,
    },
  };
  return acceptedEntry(action, dice);
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
        other.isDeployed !== false &&
        other.ownerId !== unit.ownerId &&
        unitsInContact(unit, other) &&
        (hasMeleeWeapon(other) ||
         hasMeleeWeapon(unit))
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
  state.turnState.pendingReaction = null;
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

/** The dice story of a setup action: the raw results plus the objective count and/or roll-off they decided. */
function setupResolution(
  action: GameAction,
  dice: DiceResult[],
  outcome: Pick<DiceResolution['outcome'], 'objectiveCount' | 'rollOff'>
): DiceResolution {
  return {
    rollId: action.id,
    specs: dice.map((d) => ({ count: d.rolls.length, sides: 6, purpose: d.purpose })),
    results: dice,
    context: { attackerId: action.actorId, targetId: action.actorId, actionId: action.id },
    outcome: { attackCount: 0, hitCount: 0, blockedCount: 0, wounds: 0, targetDestroyed: false, ...outcome },
  };
}

function acceptedEntry(action: GameAction, dice?: DiceResolution): ActionLogEntry {
  const morale = moraleLog.get(action);
  const melee = meleeLog.get(action);
  const entry = acceptedEntryBase(action, dice);
  if ((morale && morale.length > 0) || (melee && melee.length > 0)) {
    const first = morale?.[0]?.unitId ?? melee![0].sides[0].unitId;
    const resolution: DiceResolution = entry.dice ?? {
      rollId: action.id,
      specs: [],
      results: [],
      context: { attackerId: first, targetId: first, actionId: action.id },
      outcome: { attackCount: 0, hitCount: 0, blockedCount: 0, wounds: 0, targetDestroyed: false },
    };
    if (morale && morale.length > 0) resolution.outcome.moraleTests = morale;
    if (melee && melee.length > 0) resolution.outcome.meleeResults = melee;
    entry.dice = resolution;
  }
  return entry;
}

function acceptedEntryBase(action: GameAction, dice?: DiceResolution): ActionLogEntry {
  const traversal = traversalLog.get(action);
  if (traversal && traversal.events.length > 0) {
    const wounds = traversal.events.reduce((sum, e) => sum + (e.wounds ?? 0), 0);
    if (dice) {
      dice.outcome.traversal = traversal.events; // charge: shown alongside the attack dice
    } else {
      // Movement with hazards: the dice story is just the traversal events
      dice = {
        rollId: action.id,
        specs: traversal.results.map((r) => ({ count: r.rolls.length, sides: 6, purpose: r.purpose })),
        results: traversal.results,
        context: { attackerId: traversal.unitId, targetId: traversal.unitId, actionId: action.id },
        outcome: {
          attackCount: 0,
          hitCount: 0,
          blockedCount: 0,
          wounds,
          targetDestroyed: false,
          traversal: traversal.events,
        },
      };
    }
  }
  return { action, result: 'accepted', dice, appliedAt: Date.now() };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
