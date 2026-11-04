import { GameState, Unit } from '../gameTypes';
import { Vector3 } from '../types';
import {
  MODEL_OVERLAP_DISTANCE,
  coherencyShortfall,
  describeEndOverlap,
  findEndOverlap,
  findKeepAwayViolation,
  findMoveBlocker,
  findNavPath,
  isBaseOverhanging,
  isLadderPiece,
  isOnLadderClimbLine,
  isSuspendedInMidAir,
  validateSquadCoherency,
} from './spatial';
import { isPathDangerous, isPathDifficult, pathMovementCost } from './traversal';
import { edgeGapToCentre, livingModelPositions, modelGap } from './unitGeometry';

/**
 * "As close as possible": where one model of a squad could stand if it walked as near to a target unit as
 * ordinary movement lets it. Used to judge squad chargers (and, later, defenders piling in), and to fill in
 * the models a player did not place.
 *
 * Ordinary movement only: the pathfinder never chooses a jump, a long fall or a gap crossing, and a spot that
 * would need a Hazard test is not required either. The result is deterministic.
 */

export interface ClosestApproachOptions {
  /** Distance cap that applies when the walk crosses Difficult Terrain (e.g. 6" minus what was already spent). */
  difficultBudget?: number;
  /** Unit that may be approached inside the 1" keep-away rule (defaults to `target`). */
  ignoreUnitId?: string;
  /** How many of the target's models (nearest first) to aim at. Default 6. */
  maxTargetModels?: number;
}

export interface ClosestApproach {
  /** Where the model ends (a spot it may legally stand on). */
  position: Vector3;
  /** The walk from `start` to `position` (one point when it stays put). */
  path: Vector3[];
  /** Base-edge gap from that spot to the nearest living model of the target. */
  gap: number;
  /** Movement the walk costs. */
  cost: number;
}

const COST_TOLERANCE = 0.05;
/** Contact spots are tried at these angles either side of the straight line to the target model. */
const NEAR_ANGLES = [0, 30, -30, 60, -60, 90, -90, 120, -120].map((d) => (d * Math.PI) / 180);
const FAR_ANGLES = [0, 45, -45, 90, -90].map((d) => (d * Math.PI) / 180);
/** Spots this far back along a walk (inches) are also tried, in case the end is taken or breaks coherency. */
const BACK_OFF_STEPS = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3];
/** At most this many ranked candidates are fully checked before giving up. */
const MAX_CHECKED = 80;

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** The point `distance` along the polyline from its start (clamped to its end), with interpolated height. */
function pointAlong(path: Vector3[], distance: number): { point: Vector3; upTo: Vector3[] } {
  const upTo: Vector3[] = [path[0]];
  let left = distance;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, (b.y ?? 0) - (a.y ?? 0), b.z - a.z);
    if (left <= len + 1e-6) {
      const t = len > 1e-9 ? Math.max(0, Math.min(1, left / len)) : 1;
      const p: Vector3 = {
        x: r2(a.x + (b.x - a.x) * t),
        y: r2((a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * t),
        z: r2(a.z + (b.z - a.z) * t),
      };
      upTo.push(p);
      return { point: p, upTo };
    }
    left -= len;
    upTo.push(b);
  }
  return { point: path[path.length - 1], upTo };
}

function polylineLength(path: Vector3[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, (path[i].y ?? 0) - (path[i - 1].y ?? 0), path[i].z - path[i - 1].z);
  }
  return total;
}

function isWithinBoard(state: GameState, p: Vector3): boolean {
  const halfW = (state.board.width * state.board.gridSize) / 2;
  const halfH = (state.board.height * state.board.gridSize) / 2;
  return p.x >= -halfW && p.x <= halfW && p.z >= -halfH && p.z <= halfH;
}

/**
 * Why a model may not end at `end` (terrain, models, support, ladders, the 1" rule), or null when the spot is
 * fine. Shared by the chooser here and usable by callers that want the same terrain checks.
 */
export function endSpotProblem(
  state: GameState,
  unit: Unit,
  start: Vector3,
  end: Vector3,
  ignoreUnitId?: string
): string | null {
  if (!isWithinBoard(state, end)) return 'leaves the board';
  const overlap = findEndOverlap(state, unit.id, end);
  if (overlap) return describeEndOverlap(overlap);
  if (isSuspendedInMidAir(state, end)) return 'would end suspended in mid-air';
  if (isBaseOverhanging(state, end)) return 'would end overhanging an edge';
  for (const piece of state.terrain) {
    if (isLadderPiece(piece) && isOnLadderClimbLine(state, piece, end)) return 'would end on ladder rungs';
  }
  if (findKeepAwayViolation(state, unit.id, end, start, ignoreUnitId)) return 'is within 1" of another unit';
  return null;
}

/**
 * The legal end spot closest (base edge to base edge) to any living model of `target` that the model at
 * `start` can reach within `budget` by ordinary movement, or null when it has no legal spot at all (not even
 * staying put).
 *
 * @param modelIndex index of the moving model among the unit's living models (its start is `start`)
 * @param otherFinalPositions where the squad's other living models end (their submitted or chosen spots)
 *
 * The squad has to stay coherent with `otherFinalPositions`; a squad that started out of coherency only has
 * to not get worse (its coherency shortfall may not grow).
 */
export function closestApproach(
  state: GameState,
  unit: Unit,
  modelIndex: number,
  start: Vector3,
  budget: number,
  target: Unit,
  otherFinalPositions: Vector3[],
  opts: ClosestApproachOptions = {}
): ClosestApproach | null {
  const ignoreUnitId = opts.ignoreUnitId ?? target.id;
  const targetModels = livingModelPositions(target);
  if (targetModels.length === 0) return null;
  const limit = Math.max(0, budget);

  // How the squad stood before: a squad that began out of coherency only has to not get worse
  const before = livingModelPositions(unit);
  if (modelIndex >= 0 && modelIndex < before.length) before[modelIndex] = start;
  const startShortfall = coherencyShortfall(before);
  const coherentWith = (p: Vector3): boolean => {
    const trial = [...otherFinalPositions, p];
    if (trial.length <= 1) return true;
    if (validateSquadCoherency(trial).coherent) return true;
    return startShortfall > 0 && coherencyShortfall(trial) <= startShortfall + 0.001;
  };
  const crowded = (p: Vector3): boolean =>
    otherFinalPositions.some(
      (o) => Math.abs((o.y ?? 0) - (p.y ?? 0)) < 1.0 && Math.hypot(o.x - p.x, o.z - p.z) < MODEL_OVERLAP_DISTANCE
    );
  const gapTo = (p: Vector3): number => Math.min(...targetModels.map((t) => modelGap(p, t)));

  interface Candidate {
    path: Vector3[];
    end: Vector3;
    gap: number;
    cost: number;
  }
  const candidates = new Map<string, Candidate>();
  const add = (path: Vector3[]): void => {
    const end = path[path.length - 1];
    const key = `${r2(end.x)}|${r2(end.z)}|${r2(end.y ?? 0)}`;
    const gap = r2(gapTo(end));
    const existing = candidates.get(key);
    if (existing && existing.path.length <= path.length) return;
    candidates.set(key, { path, end, gap, cost: -1 });
  };

  // Staying put is always a candidate
  add([{ ...start }]);

  // Aim at the nearest target models first; each gets contact spots round it
  const order = targetModels
    .map((t) => ({ t, d: Math.hypot(t.x - start.x, t.z - start.z) }))
    .sort((a, b) => a.d - b.d || a.t.x - b.t.x || a.t.z - b.t.z)
    .slice(0, opts.maxTargetModels ?? 6);
  const contactCentre = edgeGapToCentre(0);
  let bestRough = Infinity;
  for (const { t, d } of order) {
    // Even a straight walk of `limit` leaves this gap; skip models that cannot beat what is already known
    if (Math.max(0, d - contactCentre - limit) > bestRough + 2) continue;
    const reachable = d - contactCentre <= limit + 0.5;
    const toStart = Math.atan2(start.z - t.z, start.x - t.x);
    const angles = reachable ? NEAR_ANGLES : FAR_ANGLES;
    const ys = [t.y ?? 0];
    if (Math.abs((start.y ?? 0) - (t.y ?? 0)) > 0.5) ys.push(start.y ?? 0);
    for (const a of angles) {
      for (const y of ys) {
        const dest: Vector3 = {
          x: r2(t.x + Math.cos(toStart + a) * contactCentre),
          y,
          z: r2(t.z + Math.sin(toStart + a) * contactCentre),
        };
        if (!isWithinBoard(state, dest)) continue;
        const path = findNavPath(state, unit, dest, limit, { startPosition: start, ignoreUnitId, keepAway: true });
        if (path.length < 2) continue;
        const total = polylineLength(path);
        for (const back of BACK_OFF_STEPS) {
          const want = total - back;
          if (want < 0.05) break;
          const { upTo } = pointAlong(path, want);
          add(upTo);
        }
        bestRough = Math.min(bestRough, gapTo(path[path.length - 1]));
      }
    }
  }

  const ranked = [...candidates.values()].sort(
    (a, b) => a.gap - b.gap || a.path.length - b.path.length || a.end.x - b.end.x || a.end.z - b.end.z
  );
  let checked = 0;
  for (const c of ranked) {
    if (checked++ >= MAX_CHECKED) break;
    if (crowded(c.end)) continue;
    const cost = c.path.length < 2 ? 0 : pathMovementCost(state, c.path, unit);
    if (cost > limit + COST_TOLERANCE) continue;
    if (c.path.length >= 2) {
      if (isPathDangerous(state, c.path, unit)) continue;
      if (isPathDifficult(state, c.path, unit) && opts.difficultBudget !== undefined && cost > opts.difficultBudget + COST_TOLERANCE) {
        continue;
      }
      if (findMoveBlocker(state, unit, c.path, { ignoreUnitId, keepAway: true }).blocked) continue;
    }
    if (endSpotProblem(state, unit, start, c.end, ignoreUnitId)) continue;
    if (!coherentWith(c.end)) continue;
    return { position: { ...c.end }, path: c.path.map((p) => ({ ...p })), gap: c.gap, cost: r2(cost) };
  }
  return null;
}
