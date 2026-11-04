import { cloneGameState } from '../gameState';
import { closestApproach } from './closestApproach';
import {
  ActionLogEntry,
  DiceResolution,
  GameAction,
  GameState,
  TraversalEvent,
  Model,
  PendingReaction,
  RetaliationOutcome,
  Unit,
  Weapon,
  WeaponAllocation,
  WeaponAttackOutcome,
} from '../gameTypes';
import { DiceSpec, DiceResult, Vector3 } from '../types';
import {
  advanceActivation,
  advanceDeployment,
  applyRoundEndMorale,
  endRound,
  getUnitsRequiringRoundMorale,
  isRoundComplete,
  validateDeploymentPosition,
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
  calculateFallingDamage,
  detectPathFall,
  getEffectiveMaxMovement,
  isPathDangerous,
  isPathDifficult,
  pathMovementCost,
  resolveDangerousTerrain,
  resolveFallingDamage,
  resolveGapJump,
  resolveDropJump,
  calculateJumpDice,
  FREE_DROP_MAX,
  FALL_DAMAGE_MIN,
  findFallLanding,
  JUMP_DROP_MAX,
  detectPathGapJump,
  validateDeclaredTraversal,
  DeclaredTraversal,
  allocateSquadCasualties,
  distance3D,
  MELEE_MAX_VERTICAL_REACH,
} from './traversal';
import type { ChargeState } from '../gameTypes';
import { getTraitValue, hasTrait } from '../rules/traits';
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
  livingModelPositions,
} from './unitGeometry';
import { firingModels, targetCoverByMajority } from './squadTargeting';
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
 * together: it may not Hold or end the activation without having moved. Stunned
 * units are exempt (their Hold only clears the stun and they cannot move).
 * Returns a rejection, or null when the unit is free to hold/end.
 */
function incoherentStartBlock(unit: Unit): { valid: false; reason: string } | null {
  if (unit.status.includes('stunned')) return null;
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
function squadEndCoherency(unit: Unit, end: Vector3[]): { valid: true } | { valid: false; reason: string } {
  const coherency = validateSquadCoherency(end);
  if (coherency.coherent) return { valid: true };
  const before = livingModelPositionsNow(unit);
  if (before.length === end.length && isRegroupingMove(before, end)) return { valid: true };
  const base = coherency.reason ?? 'Squad models lose coherency';
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
  const coherency = squadEndCoherency(unit, positions);
  if (!coherency.valid) return coherency;
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
    moved = Math.max(moved, dist);
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

/** Jump, hazard and fall dice a squad charge (leg) needs: jumpers roll tagged `m<index>_` dice in model order. */
function squadChargeTraversalSpecs(state: GameState, unit: Unit, payload: SquadChargePayload): DiceSpec[] {
  const paths = squadChargePaths(unit, payload);
  const aliveCount = livingModels(unit).length;
  const jumpers = paths.map((_, i) => (payload.modelTraversals?.[i] ? i : -1)).filter((i) => i >= 0);
  const specs: DiceSpec[] = [];
  // Models that walk share one hazard roll for the squad; jumpers carry their own
  if (paths.some((p, i) => !jumpers.includes(i) && isPathDangerous(state, p, unit))) {
    specs.push({ count: aliveCount, sides: 6, purpose: 'hazard' });
  }
  const needsFallDice = jumpers.length >= aliveCount;
  for (const i of jumpers) {
    specs.push(
      ...pathTraversalSpecs(state, unit, paths[i], { prefix: `m${i}_`, singleModel: true, includeFallDice: needsFallDice })
    );
  }
  return specs;
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
  if (state.status === 'game-over') {
    return { valid: false, reason: 'Game is over' };
  }
  if (state.turnState.pendingReaction) {
    if (action.type !== 'respond-reaction' && action.type !== 'consolidate-move' && action.type !== 'pile-in-move') {
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
        return incoherentStartBlock(unit) ?? { valid: true };
      }
      if (unit.isActivated || state.turnState.unitsActivatedThisRound.includes(unitId)) {
        return { valid: false, reason: 'Unit already activated this round' };
      }
      return incoherentStartBlock(unit) ?? { valid: true };
    }

    case 'deploy-unit': {
      if (state.turnState.phase !== 'deployment') {
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
      const val = validateDeploymentPosition(state, unit, position);
      if (!val.valid) {
        return { valid: false, reason: val.reason };
      }
      return { valid: true };
    }

    case 'move-unit': {
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
      if (hasTrait(unit.result.specialRules, 'stationary')) {
        return { valid: false, reason: 'Stationary units cannot move or charge' };
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
              : (distance > unit.result.speed ? 'Move exceeds unit speed' : 'Move exceeds unit remaining movement allowance'),
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
      const coherency = squadEndCoherency(unit.result, modelPositions!);
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
      for (const pos of modelPositions!) {
        if (!isWithinBoard(state, pos)) {
          return { valid: false, reason: 'Squad model position leaves the board' };
        }
      }
      const aliveModels = (unit.result.models ?? []).filter((m) => !m.isDestroyed);
      for (let i = 0; i < aliveModels.length && i < modelPositions!.length; i++) {
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

        if (firingModels(state, attacker.result, target.result, weapon).length === 0) {
          // Tell the player which condition failed (closest models decide range).
          const reach = unitDistance(attacker.result, target.result);
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
      if (hasTrait(attacker.result.specialRules, 'stationary')) {
        return { valid: false, reason: 'Stationary units cannot move or charge' };
      }
      if (attacker.result.hasMoved || attacker.result.hasAttacked) {
        return { valid: false, reason: 'Unit has already moved or attacked this activation' };
      }
      if (isEngaged(attacker.result)) {
        return { valid: false, reason: 'Already engaged — fight instead' };
      }
      const target = requireTarget(state, action.actorId, targetId);
      if ('reason' in target) return target;
      if (!attacker.result.weapons.some((w) => w.isEquipped && w.profile.type === 'melee')) {
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
      if (hasTrait(attacker.result.specialRules, 'stationary')) {
        return { valid: false, reason: 'Stationary units cannot move or charge' };
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
        const squadWeapon = weaponId
          ? attacker.result.weapons.find((w) => w.id === weaponId)
          : attacker.result.weapons.find((w) => w.isEquipped && w.profile.type === 'melee');
        if (!squadWeapon || squadWeapon.profile.type !== 'melee') {
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
      const weapon = weaponId
        ? attacker.result.weapons.find((w) => w.id === weaponId)
        : attacker.result.weapons.find((w) => w.isEquipped && w.profile.type === 'melee');
      if (!weapon || weapon.profile.type !== 'melee') {
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
      if (hasTrait(unit.specialRules, 'stationary')) {
        return { valid: false, reason: 'Stationary units cannot move or rush' };
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
      const currentRushBudget = unit.isRushing ? unit.remainingMovement : unit.speed * 2;

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
              : (dist > unit.speed * 2
                  ? `Rush distance exceeds double speed (${dist.toFixed(1)}" vs ${(unit.speed * 2).toFixed(1)}")`
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
      for (const pos of modelPositions!) {
        if (!isWithinBoard(state, pos)) {
          return { valid: false, reason: 'Squad model position leaves the board' };
        }
      }
      const aliveModels = (unit.models ?? []).filter((m) => !m.isDestroyed);
      for (let i = 0; i < aliveModels.length && i < modelPositions!.length; i++) {
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
      const { unitId, path } = action.payload as {
        unitId: string;
        path: Vector3[];
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
      if (!path || path.length < 2) {
        return { valid: false, reason: 'Consolidation path is empty' };
      }
      const distance = pathMovementCost(state, path);
      const maxDistance = pending.data?.maxDistance ?? 3.0;
      if (distance > maxDistance + 0.05) {
        return { valid: false, reason: `Consolidation move exceeds max distance (${maxDistance}")` };
      }
      const blocker = findMoveBlocker(state, unit, path);
      if (blocker.blocked) {
        return { valid: false, reason: blocker.reason };
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

  if (action.type === 'move-unit' || action.type === 'rush') {
    const payload = action.payload as {
      unitId?: string;
      path?: Vector3[];
      modelPaths?: Vector3[][];
      modelTraversals?: (DeclaredTraversal | null)[];
    };
    const unit = payload.unitId ? getUnit(state, payload.unitId) : undefined;
    const path = payload.path;
    const specs: DiceSpec[] = [];
    const hasModelJumps = Boolean(payload.modelTraversals?.some((t) => t) && payload.modelPaths);
    if (unit && path && path.length > 0) {
      // With per-model jumps the summary path is not a jump itself: keep only its shared hazard roll
      const shared = pathTraversalSpecs(state, unit, path);
      specs.push(...(hasModelJumps ? shared.filter((sp) => sp.purpose === 'hazard') : shared));
    }
    // Squad models that declared a jump roll their own dice, tagged `m<index>_<purpose>` and listed in
    // model order so every model's rolls are consumed in order.
    if (unit && payload.modelTraversals && payload.modelPaths) {
      const jumpers = payload.modelTraversals
        .map((t, i) => (t ? i : -1))
        .filter((i) => i >= 0 && payload.modelPaths![i]?.length >= 2);
      const aliveCount = Math.max(1, unit.models?.filter((m) => !m.isDestroyed).length ?? 1);
      // A jumper only takes a normal falling hit if every other model could already have been lost.
      const needsFallDice = jumpers.length >= aliveCount;
      for (const i of jumpers) {
        specs.push(
          ...pathTraversalSpecs(state, unit, payload.modelPaths[i], {
            prefix: `m${i}_`,
            singleModel: true,
            includeFallDice: needsFallDice,
          })
        );
      }
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
    const specs = pathTraversalSpecs(state, unit, payload.path);
    return specs.length > 0 ? specs : null;
  }

  if (action.type === 'pile-in-move') return pileInStrikeSpecs(state, action);

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
    const defenderMelee = pending.data?.weaponId
      ? getWeapon(defender, pending.data.weaponId)
      : defender.weapons.find((w) => w.isEquipped && w.profile.type === 'melee');
    if (!defenderMelee || typeof defenderMelee.profile.attacks !== 'number' || defenderMelee.profile.attacks < 1) {
      return null;
    }

    const isTargetFatigued = defender.status.includes('fatigued') || defender.status.includes('shaken');
    const totalAttacks = (defenderMelee.profile.attacks as number) * strikers(defender, charger);
    return getAttackDiceSpecs(totalAttacks, {
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
  const distance = target ? unitDistance(attacker, target) : 12;
  const aliveModels = target
    ? Math.max(1, target.models.filter((m) => !m.isDestroyed).length)
    : 1;
  let strikingCount = 1;
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
              ? pathTraversalSpecs(state, attacker, chargePayload.path)
              : [];
          return moveSpecs.length > 0 ? moveSpecs : null;
        }
        strikingCount = strikers(simAttacker, simTarget);
      }
    } else {
      strikingCount = strikers(attacker, target);
    }
  }
  const totalAttacks = attacks * strikingCount;

  const attackSpecs = getAttackDiceSpecs(totalAttacks, {
    attackerRules: attacker.specialRules,
    weaponRules: weapon.profile.specialRules,
    defenderRules: target?.specialRules ?? [],
    defenderModelCount: aliveModels,
    isMelee,
    isCharging: action.type === 'charge' || (isMelee && attacker.hasMoved),
    distance,
    includeTrauma: true,
  });

  if (action.type === 'charge') {
    const chargePayload = action.payload as { path?: Vector3[] } & SquadChargePayload;
    if (isSquadChargePayload(attacker, chargePayload)) {
      const squadSpecs = squadChargeTraversalSpecs(state, attacker, chargePayload);
      return squadSpecs.length > 0 ? [...squadSpecs, ...attackSpecs] : attackSpecs;
    }
    if (chargePayload.path && chargePayload.path.length > 0) {
      // Jump, hazard and fall dice come from the validated path, same as a move (the declared traversal
      // is checked to match it), so a charge and a charge leg roll identically.
      const traversalSpecs = pathTraversalSpecs(state, attacker, chargePayload.path);
      if (traversalSpecs.length > 0) {
        return [...traversalSpecs, ...attackSpecs];
      }
    }
  }

  return attackSpecs;
}


/**
 * Dice a path's jumps, hazards and falls need. `prefix` tags the purposes (squad models), `singleModel`
 * rolls one hazard die instead of one per living model, and `includeFallDice` can drop the falling dice
 * for a squad model that is simply lost when it falls.
 */
function pathTraversalSpecs(
  state: GameState,
  unit: Unit,
  path: Vector3[],
  opts: { prefix?: string; singleModel?: boolean; includeFallDice?: boolean } = {}
): DiceSpec[] {
  const prefix = opts.prefix ?? '';
  const specs: DiceSpec[] = [];
  const gap = detectPathGapJump(state, path, unit);
  if (gap.isGapJump) {
    specs.push({ count: gap.dice, sides: 6, purpose: `${prefix}gap_jump` });
  }
  if (isPathDangerous(state, path, unit)) {
    const aliveCount = opts.singleModel ? 1 : unit.models?.filter((m) => !m.isDestroyed).length || 1;
    specs.push({ count: aliveCount, sides: 6, purpose: `${prefix}hazard` });
  }
  const fall = detectPathFall(path, state);
  // a hop that is already a gap jump rolls once, on its straight-line length
  const dropNeedsDice = !gap.isGapJump && fall.maxDrop > FREE_DROP_MAX && !hasTrait(unit.specialRules, 'airborne');
  if (dropNeedsDice && fall.maxDrop <= JUMP_DROP_MAX) {
    specs.push({ count: calculateJumpDice(fall.maxDropDistance), sides: 6, purpose: `${prefix}drop_jump` });
  }
  // A failed gap jump from height falls into the gap, so fall dice are needed as a fallback too
  const gapMayFall = gap.isGapJump && (path[0].y ?? 0) >= FALL_DAMAGE_MIN;
  if ((dropNeedsDice || gapMayFall) && opts.includeFallDice !== false) {
    specs.push({ count: 1, sides: 6, purpose: `${prefix}falling_defense` });
    specs.push({ count: 1, sides: 6, purpose: `${prefix}trauma` });
  }
  return specs;
}

/** The rolls a squad model uses: its own `m<index>_` dice (prefix removed) plus the untagged ones. */
function diceForModel(dice: DiceResult[] | undefined, index: number): DiceResult[] | undefined {
  if (!dice) return dice;
  const prefix = `m${index}_`;
  const own = dice.filter((d) => (d.purpose ?? '').startsWith(prefix)).map((d) => ({ ...d, purpose: (d.purpose ?? '').slice(prefix.length) }));
  return [...own, ...dice.filter((d) => !/^m\d+_/.test((d.purpose ?? '')))];
}

/**
 * Resolves each squad model's own path in order. Walking models always finish their paths. Declared jumps
 * resolve in model order; once one ends the activation (a failed jump or a fall), every later jumper stays at
 * its take-off spot, its jump is not attempted and its pre-rolled dice are ignored.
 */
function applyModelPathTraversals(
  state: GameState,
  unit: Unit,
  modelPaths: Vector3[][],
  models: Model[],
  action: GameAction,
  dice?: DiceResult[]
): void {
  const declared = (action.payload as { modelTraversals?: (DeclaredTraversal | null)[] }).modelTraversals;
  let activationEnded = false;
  let stoppedAny = false;
  for (let i = 0; i < modelPaths.length; i++) {
    const declaration = declared?.[i] ?? null;
    if (declaration && activationEnded && models[i]) {
      stopJumperAtTakeoff(state, unit, models[i], modelPaths[i], declaration, i, action, dice);
      stoppedAny = true;
      continue;
    }
    const before = traversalLog.get(action)?.events.length ?? 0;
    const result = applyTraversalHazardsAndFalls(state, unit, modelPaths[i], action, diceForModel(dice, i), models[i]);
    if (declaration && result.terminated) activationEnded = true;
    const entry = traversalLog.get(action);
    if (entry && dice) {
      entry.results = dice; // every roll stays on the log entry, tagged by model
      if (modelPaths.length > 1) {
        for (let e = before; e < entry.events.length; e++) {
          entry.events[e] = { ...entry.events[e], text: `Model ${i + 1}: ${entry.events[e].text}` };
        }
      }
    }
  }
  if (stoppedAny) {
    const living = (unit.models ?? []).filter((m) => !m.isDestroyed);
    if (living.length > 0) unit.position = computeSquadCentroid(living.map((m) => m.position ?? unit.position));
  }
}

/** A later jumper after a failed jump: placed at its take-off spot, its jump not attempted, its tally cut back. */
function stopJumperAtTakeoff(
  state: GameState,
  unit: Unit,
  model: Model,
  path: Vector3[],
  declaration: DeclaredTraversal,
  index: number,
  action: GameAction,
  dice?: DiceResult[]
): void {
  model.position = { ...declaration.takeoff };
  const takeoffIdx = path.findIndex((p) => distance3D(p, declaration.takeoff) <= 0.1);
  if (takeoffIdx >= 1 && unit.modelMovementSpent && unit.modelMovementSpent[model.id] !== undefined) {
    const walked = pathMovementCost(state, path.slice(0, takeoffIdx + 1), unit);
    const full = pathMovementCost(state, path, unit);
    const spent = { ...unit.modelMovementSpent };
    spent[model.id] = Math.max(0, Math.round((spent[model.id] - full + walked) * 100) / 100);
    unit.modelMovementSpent = spent;
  }
  recordTraversal(
    action,
    unit,
    [{ type: 'jump-skipped', wounds: 0, text: `Model ${index + 1}: jump not attempted (activation ended)` }],
    dice
  );
  const entry = traversalLog.get(action);
  if (entry && dice) entry.results = dice;
}

/** Traversal hazards resolved per action, so the log entry can show the dice story (jumps, falls, hazards). */
const traversalLog = new WeakMap<GameAction, { unitId: string; events: TraversalEvent[]; results: DiceResult[] }>();

function recordTraversal(action: GameAction, unit: Unit, events: TraversalEvent[], dice?: DiceResult[]): void {
  if (events.length === 0) return;
  const entry = traversalLog.get(action) ?? { unitId: unit.id, events: [], results: dice ?? [] };
  entry.events.push(...events);
  traversalLog.set(action, entry);
}

const rollsText = (rolls: number[]) => rolls.join(', ');

export function applyTraversalHazardsAndFalls(
  state: GameState,
  unit: Unit,
  path: Vector3[],
  action: GameAction,
  dice?: DiceResult[],
  model?: Model
): { terminated: boolean; wounds: number } {
  const payload = action.payload as any;
  const events: TraversalEvent[] = [];
  const done = (result: { terminated: boolean; wounds: number }) => {
    recordTraversal(action, unit, events, dice);
    return result;
  };

  // A fall ends the activation; with several squad models failing in one move it ends only once
  const endActivationOnce = () => {
    if (state.turnState.activeUnitId === unit.id) finishActivation(state, dice);
  };

  // Fall damage roll helper shared by failed jumps and plain falls
  const resolveFall = (height: number, cause: string, forcedFall = false) => {
    const defRoll =
      dice?.find((d) => d.purpose === 'falling_defense')?.rolls[0] ?? payload.fallingDefenseRoll;
    const traumaRolls = dice?.find((d) => d.purpose === 'trauma')?.rolls;
    const fallRes = resolveFallingDamage(unit, height, defRoll, forcedFall);
    if (fallRes.wounds > 0) {
      applyWounds(unit, fallRes.wounds, traumaRolls);
    }
    events.push({
      type: 'fall',
      wounds: fallRes.wounds,
      rolls: defRoll !== undefined ? [defRoll] : undefined,
      text: fallRes.isDangerous
        ? `${cause} Fell ${height.toFixed(1)}": Falling damage (AP ${fallRes.armorPiercing})${
            defRoll !== undefined ? `, save roll ${defRoll}` : ''
          } → ${fallRes.wounds > 0 ? `${fallRes.wounds} wound` : 'saved'}`
        : `${cause} Fell ${height.toFixed(1)}"`,
    });
    return fallRes;
  };

  // 1. Gap jump (X+1 dice, all 3+): a failed jump falls into the gap
  const gap = detectPathGapJump(state, path, unit);
  if (gap.isGapJump) {
    const rolls = dice?.find((d) => d.purpose === 'gap_jump')?.rolls ?? payload.gapJumpRolls;
    const jump = resolveGapJump(gap.gapDistance, unit, rolls);
    events.push({
      type: 'gap-jump',
      rolls: rolls?.slice(0, jump.dice),
      target: jump.target,
      passed: jump.passed,
      text: `Gap jump ${gap.gapDistance.toFixed(1)}" (${jump.dice} dice, all ${jump.target}+)${
        rolls ? `: rolled ${rollsText(rolls.slice(0, jump.dice))}` : ''
      } → ${jump.passed ? 'cleared the gap' : 'failed'}`,
    });
    if (!jump.passed) {
      // The model plummets into the gap and lands on the highest floor below, clear of terrain, within 2" of the fall
      const startPt = path[0] ?? unit.position;
      const endPt = path[path.length - 1] ?? unit.position;
      const landing = findFallLanding(
        state,
        unit,
        { x: (startPt.x + endPt.x) / 2, z: (startPt.z + endPt.z) / 2 },
        startPt.y ?? 0
      );
      const alive = unit.models?.filter((m) => !m.isDestroyed) ?? [];
      let fallWounds = 0;
      if (alive.length > 1) {
        // Squad: only the jumping model falls, and the fall eliminates it (the last survivor is never eliminated)
        const faller = (model && alive.includes(model) ? model : alive[0])!;
        faller.position = { ...landing.position };
        faller.isDestroyed = true;
        faller.wounds = 0;
        unit.wounds = Math.max(1, unit.wounds - 1);
        const left = alive.filter((m) => m !== faller);
        unit.position = computeSquadCentroid(left.map((m) => m.position ?? unit.position));
        fallWounds = 1;
        events.push({
          type: 'fall',
          wounds: 1,
          text: `Fell into the gap. Fell ${landing.height.toFixed(1)}": the model is lost`,
        });
      } else {
        unit.position = { ...landing.position };
        for (const m of alive) m.position = { ...landing.position };
        if (landing.height >= FALL_DAMAGE_MIN - 0.05 && !hasTrait(unit.specialRules, 'airborne')) {
          fallWounds = resolveFall(landing.height, 'Fell into the gap.', true).wounds;
        } else {
          events.push({ type: 'fall', wounds: 0, text: `Fell into the gap. Fell ${landing.height.toFixed(1)}"` });
        }
      }
      unit.hasMoved = true;
      unit.remainingMovement = 0;
      endActivationOnce();
      return done({ terminated: true, wounds: fallWounds });
    }
  }

  // 2. Dangerous terrain
  if (isPathDangerous(state, path, unit)) {
    const hazardDice =
      dice?.find((d) => d.purpose === 'hazard')?.rolls ?? payload.hazardDice;
    if (hazardDice && hazardDice.length > 0) {
      const hazardRes = resolveDangerousTerrain(unit, hazardDice);
      events.push({
        type: 'hazard',
        rolls: hazardDice,
        wounds: hazardRes.woundsInflicted,
        text: `Dangerous terrain: rolled ${rollsText(hazardDice)} → ${
          hazardRes.woundsInflicted > 0 ? `${hazardRes.woundsInflicted} wound${hazardRes.woundsInflicted > 1 ? 's' : ''} (each 1)` : 'no wounds'
        }`,
      });
      if (hazardRes.woundsInflicted > 0) {
        if (payload.casualtyModelIds && unit.models && unit.models.length > 1) {
          allocateSquadCasualties(unit, hazardRes.woundsInflicted, payload.casualtyModelIds);
        }
        applyWounds(unit, hazardRes.woundsInflicted);
      }
    }
  }

  // 3. Drops: up to 3" is regular movement; 3-6" must be jumped (X+1 dice, all 3+); otherwise the model falls
  const fall = detectPathFall(path, state);
  if (!gap.isGapJump && fall.maxDrop > FREE_DROP_MAX && !hasTrait(unit.specialRules, 'airborne')) {
    const jumpRolls = dice?.find((d) => d.purpose === 'drop_jump')?.rolls ?? payload.dropJumpRolls;
    const jump = resolveDropJump(unit, fall.maxDrop, jumpRolls, fall.maxDropDistance);
    if (jump.canJump) {
      events.push({
        type: 'drop-jump',
        rolls: jumpRolls?.slice(0, jump.dice),
        target: jump.target,
        passed: jump.passed,
        text: `Jump down ${fall.maxDropDistance.toFixed(1)}" (${jump.dice} dice, all ${jump.target}+)${
          jumpRolls ? `: rolled ${rollsText(jumpRolls.slice(0, jump.dice))}` : ''
        } → ${jump.passed ? 'landed' : 'failed, falls'}`,
      });
    }
    if (jump.canJump && jump.passed) {
      return done({ terminated: false, wounds: 0 }); // landed the jump
    }
    const aliveNow = unit.models?.filter((m) => !m.isDestroyed) ?? [];
    if (aliveNow.length > 1 && model && aliveNow.includes(model)) {
      // Squad: the model that fell is lost (the last survivor takes the normal falling hit instead)
      const cause = jump.canJump ? '' : 'Too far to jump.';
      model.isDestroyed = true;
      model.wounds = 0;
      unit.wounds = Math.max(1, unit.wounds - 1);
      unit.position = computeSquadCentroid(
        aliveNow.filter((m) => m !== model).map((m) => m.position ?? unit.position)
      );
      events.push({
        type: 'fall',
        wounds: 1,
        text: `${cause} Fell ${fall.maxDrop.toFixed(1)}": the model is lost`.trim(),
      });
      unit.hasMoved = true;
      unit.remainingMovement = 0;
      endActivationOnce();
      return done({ terminated: true, wounds: 1 });
    }
    const fallRes = resolveFall(fall.maxDrop, jump.canJump ? '' : 'Too far to jump.');
    unit.hasMoved = true;
    unit.remainingMovement = 0;
    endActivationOnce();
    return done({ terminated: true, wounds: fallRes.wounds });
  }

  return done({ terminated: false, wounds: 0 });
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

/** The charger's strike dice, counted from where the defenders stand after the pile-in. */
function pileInStrikeSpecs(state: GameState, action: GameAction): DiceSpec[] | null {
  const placed = pileInPlacement(state, action);
  if (!placed) return null;
  const { pending, attacker, target, modelPositions } = placed;
  const weapon = getWeapon(attacker, pending.data?.weaponId);
  if (!weapon || typeof weapon.profile.attacks !== 'number' || weapon.profile.attacks < 1) return null;
  const movedTarget = withModelPositions(target, modelPositions);
  const totalAttacks = weapon.profile.attacks * strikers(attacker, movedTarget);
  return getAttackDiceSpecs(totalAttacks, {
    attackerRules: attacker.specialRules,
    weaponRules: weapon.profile.specialRules,
    defenderRules: target.specialRules,
    defenderModelCount: Math.max(1, livingModels(target).length),
    isMelee: true,
    isCharging: true,
    distance: pending.data?.chargeDistance ?? 1,
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

    case 'deploy-unit': {
      const { unitId, position, rotation } = action.payload as {
        unitId: string;
        position: Vector3;
        rotation?: Vector3;
      };
      const unit = getUnit(newState, unitId)!;
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
      advanceDeployment(newState);
      logEntry = acceptedEntry(action);
      break;
    }

    case 'move-unit': {
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

        const modelDistances = modelPositions.map((pos, i) => {
          if (modelPaths && modelPaths[i] && modelPaths[i].length >= 2) {
            return pathMovementCost(state, modelPaths[i], unit);
          }
          const mStart = prevPositions[i] ?? unit.position;
          return boardDistance(mStart, pos);
        });
        unit.hasMoved = true;
        unit.remainingMovement = spendModelMovement(unit, unit.remainingMovement, modelDistances);

        if (modelPaths && modelPaths.length > 0) {
          applyModelPathTraversals(newState, unit, modelPaths, activeModels, action, dice);
        } else if (path && path.length > 0) {
          applyTraversalHazardsAndFalls(newState, unit, path, action, dice);
        }

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

      for (let i = 0; i < allocations.length; i++) {
        const alloc = allocations[i];
        const weapon = getWeapon(attacker, alloc.weaponId)!;
        const target = getUnit(newState, alloc.targetId)!;
        const distance = unitDistance(attacker, target);
        const isLobbed = hasTrait(weapon.profile.specialRules, 'lobbed');
        const firing = firingModels(newState, attacker, target, weapon);
        const inCover =
          target.status.includes('in-cover') ||
          (!isLobbed && targetCoverByMajority(newState, firing, attacker, target));
        const aliveModels = Math.max(1, target.models.filter((m) => !m.isDestroyed).length);
        const totalAttacks = (weapon.profile.attacks as number) * Math.max(1, firing.length);

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
            totalAttacks,
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
      const distance = unitDistance(attacker, target);
      const aliveModels = Math.max(1, target.models.filter((m) => !m.isDestroyed).length);
      const totalAttacks = (weapon.profile.attacks as number) * strikers(attacker, target);
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
          totalAttacks,
          rolls
        );
      } catch (error) {
        return { ok: false, reason: (error as Error).message };
      }

      attacker.hasAttacked = true;
      attacker.remainingMovement = 0;
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
      if (target.isDestroyed) {
        newState.turnState.pendingReaction = createConsolidationReaction(action.id, attacker, target.name);
      }
      refreshEngagements(newState);

      diceResolution = {
        rollId: action.id,
        specs: getDiceSpecs(state, action) ?? getAttackDiceSpecs(totalAttacks),
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
      const currentBudget = unit.isRushing ? unit.remainingMovement : unit.speed * 2;

      if (isSquad && modelPositions) {
        const activeModels = unit.models ? unit.models.filter((m) => !m.isDestroyed) : [];
        const prevPositions = activeModels.map((m) => ({ ...(m.position ?? unit.position) }));
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

        const modelDistances = modelPositions.map((pos, i) => {
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

        if (modelPaths && modelPaths.length > 0) {
          applyModelPathTraversals(newState, unit, modelPaths, activeModels, action, dice);
        } else if (path && path.length > 0) {
          applyTraversalHazardsAndFalls(newState, unit, path, action, dice);
        }

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
        const legCosts = legPaths.map((p) => pathMovementCost(state, p, unit));
        const legAlive = livingModels(unit);
        placeSquadModels(unit, legModels.modelPositions!);
        unit.hasMoved = true;
        unit.remainingMovement = spendModelMovement(unit, unit.remainingMovement, legCosts);
        if (newState.turnState.charge) newState.turnState.charge.legs += 1;
        // A failed jump falls: the fall ends the activation (finishActivation drops the declared charge)
        applyModelPathTraversals(newState, unit, legPaths, legAlive, action, dice);
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
      const { attackerId, targetId, path, weaponId } = action.payload as {
        attackerId: string;
        targetId: string;
        path: Vector3[];
        weaponId?: string;
      };
      newState.turnState.charge = null;
      const attacker = getUnit(newState, attackerId)!;
      const target = getUnit(newState, targetId)!;
      const squadMoves = action.payload as SquadChargePayload;
      const squadCharge = isSquadChargePayload(attacker, squadMoves);
      const squadAlive = livingModels(attacker);
      const squadPaths = squadCharge ? squadChargePaths(attacker, squadMoves) : [];
      if (squadCharge) placeSquadModels(attacker, squadMoves.modelPositions!);
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
        applyModelPathTraversals(newState, attacker, squadPaths, squadAlive, action, dice);
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

      const weapon = weaponId
        ? getWeapon(attacker, weaponId)
        : attacker.weapons.find((w) => w.isEquipped && w.profile.type === 'melee');

      // Defenders not touching a charger place their own models first (up to 3"); the strike waits for that
      const pileInIds = weapon ? pileInModelIds(target, attacker) : [];
      if (weapon && pileInIds.length > 0) {
        newState.turnState.pendingReaction = createPileInReaction(
          action.id,
          attacker,
          target,
          weapon.id,
          pileInIds,
          Math.hypot(cdx, cdz)
        );
        refreshEngagements(newState);
        logEntry = acceptedEntry(action);
        break;
      }

      if (weapon && dice && pileInIds.length === 0) {
        diceResolution = resolveChargeStrike(state, newState, action, attacker, target, weapon, dice, Math.hypot(cdx, cdz));
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
      if (pending.type === 'pile-in') {
        const piled = applyPileIn(state, newState, action, dice);
        if (!piled.ok) return piled;
        logEntry = piled.logEntry;
        break;
      }
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

        const retRolls = extractAttackRolls(dice);
        const isTargetFatigued = defender.status.includes('fatigued') || defender.status.includes('shaken');
        const retAliveModels = charger.models?.filter((m) => !m.isDestroyed).length ?? 1;
        const totalRetAttacks = (defenderMelee.profile.attacks as number) * strikers(defender, charger);
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
          totalRetAttacks,
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
        pushBackPos = pushBackChargerModels(newState, charger, defender);
        pushedBack = true;
        charger.status = charger.status.filter((s) => s !== 'engaged');
        defender.status = defender.status.filter((s) => s !== 'engaged');
      }

      if (charger.isDestroyed && !defender.isDestroyed) {
        // Defender consolidates up to 3" upon wiping out charger in melee retaliation
        newState.turnState.pendingReaction = createConsolidationReaction(action.id, defender, charger.name);
      } else if (!charger.isDestroyed && defender.isDestroyed) {
        // Charger consolidates up to 3" upon wiping out defender in melee
        newState.turnState.pendingReaction = createConsolidationReaction(action.id, charger, defender.name);
      } else {
        newState.turnState.pendingReaction = null;
      }
      refreshEngagements(newState);

      let diceResolution: DiceResolution | undefined;
      if (retCombat && dice && defenderMelee) {
        const totalRetAttacks = retCombat.attackCount;
        diceResolution = {
          rollId: action.id,
          specs: getDiceSpecs(state, action) ?? getAttackDiceSpecs(totalRetAttacks),
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

    case 'pile-in-move': {
      const piled = applyPileIn(state, newState, action, dice);
      if (!piled.ok) return piled;
      logEntry = piled.logEntry;
      break;
    }

    case 'consolidate-move': {
      const { unitId, path } = action.payload as {
        unitId: string;
        path: Vector3[];
      };
      const unit = getUnit(newState, unitId)!;
      const end = path[path.length - 1];
      const deltaX = end.x - unit.position.x;
      const deltaZ = end.z - unit.position.z;
      if (Math.hypot(deltaX, deltaZ) > 1e-4) {
        unit.rotation = { ...unit.rotation, y: Math.atan2(deltaX, deltaZ) };
      }
      unit.position = { ...end };
      if (unit.models && unit.models.length > 0) {
        for (const m of unit.models) {
          if (!m.isDestroyed && m.position) {
            m.position = {
              x: Math.round((m.position.x + deltaX) * 100) / 100,
              y: end.y ?? m.position.y ?? 0,
              z: Math.round((m.position.z + deltaZ) * 100) / 100,
            };
            m.rotation = { ...unit.rotation };
          }
        }
      }
      newState.turnState.pendingReaction = null;
      refreshEngagements(newState);
      logEntry = acceptedEntry(action);
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

  const weapon = getWeapon(attacker, pending.data?.weaponId);
  if (!weapon || !dice) {
    refreshEngagements(newState);
    return { ok: true, logEntry: acceptedEntry(action) };
  }
  let resolution: DiceResolution;
  try {
    resolution = resolveChargeStrike(state, newState, action, attacker, target, weapon, dice, pending.data?.chargeDistance ?? 1);
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  return { ok: true, logEntry: acceptedEntry(action, resolution) };
}

/**
 * The charger's strike once the defenders are in their final places: the pooled attack, wounds, then the
 * defender's strike-back prompt, the step back, or the winner's consolidation. Shared by a charge with nothing
 * to pile in and by the confirmed (or timed-out) pile-in.
 */
function resolveChargeStrike(
  state: GameState,
  newState: GameState,
  action: GameAction,
  attacker: Unit,
  target: Unit,
  weapon: Weapon,
  dice: DiceResult[],
  chargeDistance: number
): DiceResolution {
  const attackerId = attacker.id;
  const targetId = target.id;
  let diceResolution: DiceResolution;
    const rolls = extractAttackRolls(dice);
    const aliveModels = target.models?.filter((m) => !m.isDestroyed).length ?? 1;
    const totalAttacks = (weapon.profile.attacks as number) * strikers(attacker, target);
    const outcome = resolveAttack(
      {
        quality: attacker.quality,
        specialRules: attacker.specialRules,
        weaponRules: weapon.profile.specialRules,
        isMelee: true,
        isCharging: true,
        hasMoved: true,
        isFatigued: attacker.status.includes('fatigued') || attacker.status.includes('shaken'),
        distance: chargeDistance,
      },
      {
        defense: target.defense,
        inCover: false,
        specialRules: target.specialRules,
        hasMoved: target.hasMoved,
        modelCount: aliveModels,
      },
      totalAttacks,
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
      // If defender is destroyed, victor may consolidate up to 3"
      newState.turnState.pendingReaction = createConsolidationReaction(action.id, attacker, target.name);
      refreshEngagements(newState);
    } else if (!defenderMelee) {
      pushBackPos = pushBackChargerModels(newState, attacker, target);
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
      specs: getDiceSpecs(state, action) ?? getAttackDiceSpecs(totalAttacks),
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
  return diceResolution;
}

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

/** Models that strike in melee (within 2" / 4" of an enemy model); at least one so a lone fighter always swings. */
function strikers(striker: Unit, foe: Unit): number {
  return Math.max(1, strikingModelCount(striker, foe));
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
  unit.remainingMovement = unit.speed;
  resetModelMovement(unit);
  unit.status = unit.status.filter((s) => s !== 'stunned' && s !== 'shaken');
  state.turnState.unitsActivatedThisRound.push(unit.id);
  state.turnState.activeUnitId = unit.id;
  state.turnState.charge = null;
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
  state.turnState.charge = null; // an unfinished declared charge is abandoned: no melee
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
    const surviving = unit.models.filter((m) => !m.isDestroyed);
    if (surviving.length > 0 && surviving.some((m) => m.position)) {
      unit.position = computeSquadCentroid(surviving.map((m) => m.position ?? unit.position));
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
        unitsInContact(unit, other) &&
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

function acceptedEntry(action: GameAction, dice?: DiceResolution): ActionLogEntry {
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
