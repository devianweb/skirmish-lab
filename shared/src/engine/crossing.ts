import { GameState, Unit } from '../gameTypes';
import { Vector3 } from '../types';
import { hasTrait } from '../rules/traits';
import { MODEL_OVERLAP_DISTANCE, findWalkableSurfaceAt } from './spatial';
import { DeclaredTraversal, distanceHorizontal } from './traversal';
import { endSpotProblem } from './closestApproach';
import { modelGap } from './unitGeometry';

/**
 * Group crossing (14C-2 PR 4C): in a squad's Advance, Rush or charge leg one model (the leader) declares the
 * jump at its take-off edge and the single roll is sized by its crossing. On a pass every other model may be
 * carried across: each is placed on the far side within 1" (base edge) of a model that has already crossed, with
 * no walk to the edge and nothing taken off its move. These pure helpers are shared by the host's validation and
 * the HUD's Auto placement / hover check, so what the preview shows is what the host accepts.
 */

/** Horizontal unit vector of a declared hop (take-off to landing), or null when it has no length. */
function hopDirection(t: DeclaredTraversal): { dx: number; dz: number; length: number } | null {
  const dx = t.landing.x - t.takeoff.x;
  const dz = t.landing.z - t.takeoff.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return null;
  return { dx: dx / length, dz: dz / length, length };
}

/** How far along the hop (from the take-off edge) a point is, in inches (negative: behind the edge). */
function alongHop(t: DeclaredTraversal, p: Vector3): number {
  const dir = hopDirection(t);
  if (!dir) return 0;
  return (p.x - t.takeoff.x) * dir.dx + (p.z - t.takeoff.z) * dir.dz;
}

/**
 * True when a model at `p` is already past the crossing, so it has nothing to cross. With the game state it is
 * judged by the floor: the model stands at the landing's level on a different floor than the take-off spot
 * (already across the gap, or down on the lower level). That holds for a hop that is not square to the edge,
 * where "how far along the hop" would call a model beside the take-off spot "past halfway". Without the state
 * it falls back to the distance along the hop.
 */
export function isBeyondCrossing(t: DeclaredTraversal, p: Vector3, state?: GameState): boolean {
  const dir = hopDirection(t);
  if (!dir) return false;
  if (Math.abs((p.y ?? 0) - (t.landing.y ?? 0)) > 0.3) return false;
  if (state) {
    const from = findWalkableSurfaceAt(state, { x: t.takeoff.x, y: t.takeoff.y ?? 0, z: t.takeoff.z }, 0.1);
    const here = findWalkableSurfaceAt(state, { x: p.x, y: p.y ?? 0, z: p.z }, 0.1);
    // Same floor as the take-off spot (a deck made of several parts counts as one): still on this side
    if (from && here && from.piece.id === here.piece.id) return false;
    if (!from && !here) return alongHop(t, p) > Math.max(0.25, dir.length * 0.5);
    return alongHop(t, p) > 0;
  }
  return alongHop(t, p) > Math.max(0.25, dir.length * 0.5);
}

/**
 * The 1-based numbers of models that did not cross while others did: no declared jump of their own and still
 * on the near side of the first declared crossing. Empty when nobody crossed.
 */
export function describeLeftBehind(
  traversals: ReadonlyArray<DeclaredTraversal | null | undefined> | undefined,
  ends: Vector3[]
): number[] {
  const leader = traversals?.find((t): t is DeclaredTraversal => !!t && t.kind !== 'fall');
  if (!leader) return [];
  const dir = hopDirection(leader);
  if (!dir) return [];
  const behind: number[] = [];
  ends.forEach((p, i) => {
    if (traversals?.[i]) return;
    if (alongHop(leader, p) < dir.length * 0.5 && Math.abs((p.y ?? 0) - (leader.takeoff.y ?? 0)) <= 0.3) behind.push(i + 1);
  });
  return behind;
}

/**
 * Host check that a failed jump leaves every model on its own spot. On a failure the leader falls and
 * every other declared jumper stops at its take-off spot, so those spots must be clear of each other and of the
 * models that do not jump (the faller leaves its spot, so it is exempt). Returns a rejection reason, or null.
 */
export function takeoffSpotProblem(
  traversals: ReadonlyArray<DeclaredTraversal | null | undefined> | undefined,
  ends: Vector3[],
  jumpLeader?: number
): string | null {
  if (!traversals) return null;
  if (jumpLeader !== undefined && !(Number.isInteger(jumpLeader) && traversals[jumpLeader] && traversals[jumpLeader]!.kind !== 'fall')) {
    return 'The jump leader must be a squad model that declares a jump';
  }
  // The leader falls on a failure (default: the lowest-index jumper); the faller leaves its spot
  const faller = jumpLeader ?? ends.findIndex((_, i) => !!traversals[i] && traversals[i]!.kind !== 'fall');
  const stop = (i: number): Vector3 => traversals[i]?.takeoff ?? ends[i];
  for (let i = 0; i < ends.length; i++) {
    if (!traversals[i] || i === faller) continue;
    for (let j = 0; j < ends.length; j++) {
      if (j === i || j === faller) continue;
      if (traversals[j] && j < i) continue; // each pair of jumpers once
      if (Math.abs((stop(j).y ?? 0) - (stop(i).y ?? 0)) >= 1.0) continue;
      if (distanceHorizontal(stop(j), stop(i)) < 0.9 - 0.01) {
        return `Squad models ${i + 1} and ${j + 1} would be on top of each other if the jump failed (their take-off spots are too close)`;
      }
    }
  }
  return null;
}

/** How far (base edge to base edge) a carried model may land from a model that is already across. */
export const CROSSING_REACH = 1.0;
const REACH_TOLERANCE = 0.02;
/** A point far from the board: the 1" keep-away then applies in full (a carried model has no start to excuse it). */
const NO_START: Vector3 = { x: 1e6, y: 0, z: 1e6 };

export interface CrossingContext {
  /** The leader's declared crossing (take-off, landing and kind). */
  declared: DeclaredTraversal;
  /** The declared charge target: the 1" keep-away does not apply to it. */
  ignoreUnitId?: string;
  /** Where models are already across: the leader's landing and any spot already placed across. */
  across: Vector3[];
  /** End spots of the squad's other models (a carried model may not overlap them). */
  occupied: Vector3[];
}

/**
 * Why a carried model may not be placed at `spot` (terrain, models, support, the 1" keep-away, the board, the
 * far side of the crossing, overlap with squad-mates), or null. The reach to a model that is already across is
 * judged separately (`withinCrossingReach`) because it depends on the order models are placed in.
 */
export function crossingSpotProblem(state: GameState, unit: Unit, spot: Vector3, ctx: Omit<CrossingContext, 'across'>): string | null {
  const base = endSpotProblem(state, unit, NO_START, spot, ctx.ignoreUnitId);
  if (base) return `A model carried across cannot land there: it ${base}`;
  if (!isBeyondCrossing(ctx.declared, spot, state)) return 'A model carried across must land on the far side of the crossing';
  for (const o of ctx.occupied) {
    if (Math.abs((o.y ?? 0) - (spot.y ?? 0)) < 1.0 && distanceHorizontal(o, spot) < MODEL_OVERLAP_DISTANCE - 0.01) {
      return 'A model carried across cannot land on top of another model of its squad (bases would overlap)';
    }
  }
  return null;
}

/** True when `spot` is within the crossing reach (1" base edge, same level) of a model that is already across. */
export function withinCrossingReach(spot: Vector3, across: Vector3[]): boolean {
  return across.some(
    (a) => Math.abs((a.y ?? 0) - (spot.y ?? 0)) <= 0.3 && modelGap(a, spot) <= CROSSING_REACH + REACH_TOLERANCE
  );
}

export const CROSSING_REACH_REASON = `A model carried across must land within ${CROSSING_REACH}" (base edge) of a model that has already crossed`;

/** Full check for one spot: `crossingSpotProblem`, then the reach. The HUD preview and click use this. */
export function crossingPlacementProblem(state: GameState, unit: Unit, spot: Vector3, ctx: CrossingContext): string | null {
  return crossingSpotProblem(state, unit, spot, ctx) ?? (withinCrossingReach(spot, ctx.across) ? null : CROSSING_REACH_REASON);
}

/** Index of the leader: the one the player declared the jump with, else the lowest-index jumper (never a plain fall). */
export function crossingLeaderIndex(
  traversals: ReadonlyArray<DeclaredTraversal | null | undefined> | undefined,
  jumpLeader?: number
): number {
  if (!traversals) return -1;
  if (jumpLeader !== undefined) return traversals[jumpLeader] && traversals[jumpLeader]!.kind !== 'fall' ? jumpLeader : -1;
  return traversals.findIndex((t) => !!t && t.kind !== 'fall');
}

/**
 * Host check of the models a payload carries across (`crossers`, living-model indices): the leader must
 * have declared a jump, Flying units have no crossing, and every carried model needs a legal spot placed (in
 * any order) within 1" of a model already across. Returns a rejection reason, or null.
 */
export function validateCrossers(
  state: GameState,
  unit: Unit,
  payload: {
    crossers?: number[];
    modelTraversals?: ReadonlyArray<DeclaredTraversal | null | undefined>;
    jumpLeader?: number;
  },
  ends: Vector3[],
  ignoreUnitId?: string
): string | null {
  const crossers = payload.crossers;
  if (!crossers || crossers.length === 0) return null;
  if (!crossers.every((i) => Number.isInteger(i) && i >= 0 && i < ends.length) || new Set(crossers).size !== crossers.length) {
    return 'Carried models must be distinct squad models';
  }
  if (hasTrait(unit.specialRules, 'flying')) return 'Flying models do not need to be carried across: they simply move';
  const traversals = payload.modelTraversals;
  const leader = crossingLeaderIndex(traversals, payload.jumpLeader);
  if (leader < 0) return 'Models can only be carried across when a squad model declares a jump or drop';
  if (crossers.includes(leader)) return 'The model that declares the jump cannot be carried across';
  for (const i of crossers) {
    if (traversals?.[i]) return `Squad model ${i + 1} is carried across, so it declares no jump of its own`;
  }
  const declared = traversals![leader]!;
  const carried = new Set(crossers);
  const across: Vector3[] = [];
  traversals!.forEach((t, i) => {
    if (t && t.kind !== 'fall' && !carried.has(i)) across.push(ends[i]);
  });
  for (const i of crossers) {
    const problem = crossingSpotProblem(state, unit, ends[i], {
      declared,
      ignoreUnitId,
      occupied: ends.filter((_, j) => j !== i),
    });
    if (problem) return `Squad model ${i + 1}: ${problem}`;
  }
  let pending = [...crossers];
  while (pending.length > 0) {
    const placed = pending.filter((i) => withinCrossingReach(ends[i], across));
    if (placed.length === 0) return `Squad model ${pending[0] + 1}: ${CROSSING_REACH_REASON}`;
    for (const i of placed) across.push(ends[i]);
    pending = pending.filter((i) => !placed.includes(i));
  }
  return null;
}

export interface AutoCrossInput {
  declared: DeclaredTraversal;
  /** Leader's start of the leg and its landing: the displacement the squad is carried along. */
  leaderStart: Vector3;
  leaderEnd: Vector3;
  /** Models to place (any order), with where they stand now. */
  models: Array<{ index: number; position: Vector3 }>;
  /** Spots already across (at least the leader's landing). */
  across: Vector3[];
  /** Spots of the squad's other models that are not being placed. */
  occupied: Vector3[];
  ignoreUnitId?: string;
}

/**
 * Auto placement of a passed crossing. Models are handled nearest-the-leader first. Each first tries its current
 * position shifted by the leader's own displacement (the squad keeps its formation); when that spot is not legal,
 * on the far side and within 1" of a model already across, it takes the nearest legal spot within 1" of a model
 * already across. Models with no legal spot are left out (they stay where they stand).
 */
export function autoPlaceCrossers(state: GameState, unit: Unit, input: AutoCrossInput): Map<number, Vector3> {
  const out = new Map<number, Vector3>();
  const across = [...input.across];
  const occupied = [...input.occupied, ...input.across];
  const dx = input.leaderEnd.x - input.leaderStart.x;
  const dz = input.leaderEnd.z - input.leaderStart.z;
  const dy = (input.leaderEnd.y ?? 0) - (input.leaderStart.y ?? 0);
  const order = [...input.models].sort(
    (a, b) => distanceHorizontal(a.position, input.leaderStart) - distanceHorizontal(b.position, input.leaderStart) || a.index - b.index
  );
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  for (const m of order) {
    const ctx = { declared: input.declared, ignoreUnitId: input.ignoreUnitId, across, occupied };
    const shifted: Vector3 = { x: r2(m.position.x + dx), y: r2((m.position.y ?? 0) + dy), z: r2(m.position.z + dz) };
    let spot: Vector3 | null = crossingPlacementProblem(state, unit, shifted, ctx) === null ? shifted : null;
    if (!spot) {
      let bestD = Infinity;
      for (const a of across) {
        for (let r = MODEL_OVERLAP_DISTANCE; r <= 2 + 1e-9; r += 0.25) {
          const n = Math.max(12, Math.round(r * 12));
          for (let k = 0; k < n; k++) {
            const ang = (k / n) * Math.PI * 2;
            const cand: Vector3 = { x: r2(a.x + Math.cos(ang) * r), y: a.y ?? 0, z: r2(a.z + Math.sin(ang) * r) };
            const d = distanceHorizontal(cand, shifted);
            if (d >= bestD - 1e-9) continue;
            if (crossingPlacementProblem(state, unit, cand, ctx) === null) {
              bestD = d;
              spot = cand;
            }
          }
        }
      }
    }
    if (spot) {
      out.set(m.index, spot);
      across.push(spot);
      occupied.push(spot);
    }
  }
  return out;
}
