import { GameState, Unit } from '../gameTypes';
import { Vector3 } from '../types';
import { hasTrait } from '../rules/traits';
import { findNavPath, findWalkableSurfaceAt } from './spatial';
import {
  DeclaredTraversal,
  JumpOption,
  distanceHorizontal,
  findJumpOption,
  isPathDifficult,
  pathMovementCost,
} from './traversal';

/**
 * Follow the leader (14C-2 PR 4B): when one model of a squad declares a jump, the other models moved in the
 * same leg are carried across the same gap or drop. Each walks to the take-off edge on its own move (the
 * crossing itself is free) and hops from there. These are pure helpers: the HUD uses them to route the
 * followers, the host re-checks every route with its normal per-model validation, and `describeLeftBehind`
 * names the models that did not cross when the squad would be split.
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

export interface FollowerRoute {
  /** Walk to the take-off spot, then the hop to the landing. */
  path: Vector3[];
  /** The full jump option (declared traversal plus dice) for the hop. */
  option: JumpOption;
  /** Movement the walk to the take-off edge uses (the hop itself is free). */
  walkCost: number;
}

export type FollowerPlan =
  | { status: 'route'; route: FollowerRoute }
  | { status: 'not-needed' }
  | { status: 'unreachable'; reason: string };

export interface FollowerOptions {
  /** What this model can still walk in the move. */
  budget: number;
  /** The smaller allowance that applies when its walk crosses Difficult Terrain. */
  difficultBudget?: number;
  /** Options passed to the pathfinder (keep-away, charge target, stop before difficult). */
  navOptions?: Parameters<typeof findNavPath>[4];
  /** Spots other models of the squad take (take-off spots and end spots): a route keeps 0.95" clear of them. */
  taken?: Vector3[];
  /** Extra veto on a landing spot (ending in melee contact, standing on an enemy). */
  landingAllowed?: (landing: Vector3) => boolean;
}

const SPACING = 0.95;
const MAX_LATERAL = 6;

/**
 * Route one follower to the leader's crossing: a spot along the same edge, shifted sideways in half-inch steps
 * (nearest first), keeping the leader's hop vector so the crossing is the same gap or drop. Returns the
 * cheapest walk that reaches an edge spot within the model's own allowance. Flying models and jumps that are
 * certain falls are never followed.
 */
export function planFollowerCrossing(
  state: GameState,
  unit: Unit,
  start: Vector3,
  leader: DeclaredTraversal,
  options: FollowerOptions
): FollowerPlan {
  if (leader.kind === 'fall' || hasTrait(unit.specialRules, 'flying')) return { status: 'not-needed' };
  if (isBeyondCrossing(leader, start, state)) return { status: 'not-needed' };
  const dir = hopDirection(leader);
  if (!dir) return { status: 'not-needed' };
  const taken = options.taken ?? [];
  const clear = (p: Vector3): boolean => taken.every((t) => Math.abs((t.y ?? 0) - (p.y ?? 0)) >= 1.0 || distanceHorizontal(t, p) >= SPACING);
  const hop = { x: leader.landing.x - leader.takeoff.x, z: leader.landing.z - leader.takeoff.z };

  // Take-off spots to try: the leader's spot shifted sideways in half-inch steps. The edge a hop leaves from
  // is not always square to the hop (a diagonal hop from near a corner), so spots are searched on a grid around
  // the leader's spot, not only along the line square to the hop; each is kept only when the engine offers the
  // same hop vector from it. Nearest to the follower first.
  const steps: number[] = [0];
  for (let k = 0.5; k <= MAX_LATERAL + 1e-6; k += 0.5) steps.push(k, -k);
  const spots: Array<{ takeoff: Vector3; landing: Vector3; rank: number }> = [];
  const addSpot = (ox: number, oz: number): void => {
    const takeoff = { x: leader.takeoff.x + ox, y: leader.takeoff.y ?? 0, z: leader.takeoff.z + oz };
    const landing = { x: takeoff.x + hop.x, y: leader.landing.y ?? 0, z: takeoff.z + hop.z };
    spots.push({ takeoff, landing, rank: distanceHorizontal(start, takeoff) });
  };
  const tangent = { x: -dir.dz, z: dir.dx };
  for (const off of steps) addSpot(tangent.x * off, tangent.z * off);
  for (const ox of steps) {
    for (const oz of steps) {
      if (Math.hypot(ox, oz) <= MAX_LATERAL + 1e-6) addSpot(ox, oz);
    }
  }
  spots.sort((a, b) => a.rank - b.rank);

  let anyValid = false;
  let nearestValid = Infinity; // straight-line distance to the nearest legal take-off spot
  let shortest = Infinity; // walking distance of the cheapest walk that was found but too long
  for (const c of spots) {
    if (!clear(c.takeoff) || !clear(c.landing)) continue;
    if (options.landingAllowed && !options.landingAllowed(c.landing)) continue;
    const option = findJumpOption(state, unit, c.takeoff, c.landing);
    if (!option || option.kind !== leader.kind) continue;
    anyValid = true;
    nearestValid = Math.min(nearestValid, c.rank);
    // A straight-line walk is a lower bound: later spots are only farther
    if (c.rank > options.budget + 0.05) break;
    const walk = findNavPath(state, unit, c.takeoff, options.budget, { ...options.navOptions, startPosition: start });
    if (walk.length < 2) continue;
    const end = walk[walk.length - 1];
    if (distanceHorizontal(end, c.takeoff) > 0.1 || Math.abs((end.y ?? 0) - (c.takeoff.y ?? 0)) > 0.3) continue;
    const walkCost = pathMovementCost(state, walk, unit);
    const allowed = isPathDifficult(state, walk, unit) ? Math.min(options.budget, options.difficultBudget ?? options.budget) : options.budget;
    shortest = Math.min(shortest, walkCost);
    if (walkCost > allowed + 0.05) continue;
    const path = [...walk.slice(0, -1), c.takeoff, c.landing];
    return { status: 'route', route: { path, option, walkCost } };
  }
  if (!anyValid) {
    return { status: 'unreachable', reason: 'there is no free spot along that edge to jump from' };
  }
  const left = Math.max(0, options.budget);
  const away = Number.isFinite(shortest) ? shortest : nearestValid;
  return {
    status: 'unreachable',
    reason: Number.isFinite(away)
      ? `the take-off edge is ${away.toFixed(1)}" away and it has ${left.toFixed(1)}" of move left`
      : `it cannot walk to the take-off edge with ${left.toFixed(1)}" of move left`,
  };
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
