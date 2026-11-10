import type { GameState, Unit, Vector3 } from '@skirmish-lab/shared';
import { boardDistance, findKeepAwayViolation, pathMovementCost } from '@skirmish-lab/shared';

/**
 * Presentation helper for the move preview: when the planned path ends short of the cursor, say where and why.
 * No rules live here. Every cause is read from the engine (`pathMovementCost`, `findKeepAwayViolation`, and the
 * planner run once more with the keep-away rule off to see what it would have done without it).
 */
export type StopCause = 'keep-away' | 'budget' | 'difficult-cap' | 'difficult-edge' | 'climb' | 'terrain';

export interface StopNote {
  cause: StopCause;
  /** Player-facing one-liner, always starting "Stopped:". */
  text: string;
  /** Where the path ends (the marker goes here). */
  at: Vector3;
  /** The unit whose 1" keep-away zone ended the move (keep-away only). */
  unitId?: string;
  unitName?: string;
}

/** The path counts as reaching the cursor when it ends within this horizontal distance of it. */
export const STOP_REACH_TOLERANCE = 0.25;
/** A target higher than the end by more than this is a climb problem, not a terrain one. */
const CLIMB_HEIGHT = 0.5;
const SAMPLE_STEP = 0.1;
/** The keep-away probe starts this far before the stop along the unconstrained path (rounding slack). */
const PROBE_BEHIND = 0.5;

const inch = (n: number): string => (Number.isInteger(n) ? `${n}"` : `${n.toFixed(1)}"`);

function polylineLength(path: Vector3[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    len += Math.hypot(path[i].x - path[i - 1].x, (path[i].y ?? 0) - (path[i - 1].y ?? 0), path[i].z - path[i - 1].z);
  }
  return len;
}

/** The point `s` along the polyline (clamped to its ends). */
function pointAlong(path: Vector3[], s: number): Vector3 {
  let left = Math.max(0, s);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const seg = Math.hypot(b.x - a.x, (b.y ?? 0) - (a.y ?? 0), b.z - a.z);
    if (left <= seg || i === path.length - 1) {
      const t = seg < 1e-9 ? 1 : Math.min(1, left / seg);
      return { x: a.x + (b.x - a.x) * t, y: (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * t, z: a.z + (b.z - a.z) * t };
    }
    left -= seg;
  }
  return path[path.length - 1];
}

export function explainStop(opts: {
  state: GameState;
  unit: Unit;
  /** Where this move (or this model's move) began. */
  start: Vector3;
  /** The (edge-snapped) point the player is pointing at. */
  cursor: Vector3;
  /** The planned path (may be empty or a single point when nothing is reachable). */
  path: Vector3[];
  /** Movement the planner was allowed to spend on this path (after any difficult terrain cap). */
  budget: number;
  /** Set when the Difficult Terrain cap, not the remaining move, set the budget: the cap in inches. */
  difficultCap?: number | null;
  /** A Rush that was halted just outside difficult ground. */
  stoppedBeforeDifficult?: boolean;
  /** The same plan with the 1" keep-away rule off; only asked for when the cheaper causes do not explain the stop. */
  unconstrainedPath: () => Vector3[];
  ignoreUnitId?: string;
}): StopNote | null {
  const { state, unit, start, path } = opts;
  const end = path.length >= 2 ? path[path.length - 1] : start;
  const halfW = (state.board.width * state.board.gridSize) / 2 - 0.25;
  const halfH = (state.board.height * state.board.gridSize) / 2 - 0.25;
  const cursor: Vector3 = {
    x: Math.max(-halfW, Math.min(halfW, opts.cursor.x)),
    y: opts.cursor.y ?? 0,
    z: Math.max(-halfH, Math.min(halfH, opts.cursor.z)),
  };
  const heightShort = (cursor.y ?? 0) - (end.y ?? 0) > CLIMB_HEIGHT;
  if (boardDistance(end, cursor) <= STOP_REACH_TOLERANCE && !heightShort) return null;

  const at: Vector3 = { x: end.x, y: end.y ?? 0, z: end.z };
  const cost = path.length >= 2 ? pathMovementCost(state, path, unit) : 0;
  if (cost >= opts.budget - 0.05) {
    return opts.difficultCap != null
      ? { cause: 'difficult-cap', text: `Stopped: difficult terrain caps the move at ${inch(opts.difficultCap)}`, at }
      : { cause: 'budget', text: 'Stopped: out of movement', at };
  }
  if (opts.stoppedBeforeDifficult) {
    return { cause: 'difficult-edge', text: 'Stopped: a Rush halts at the edge of difficult terrain', at };
  }

  // Budget left, cursor not reached: was it the 1" keep-away rule? Probe the unconstrained plan around the stop.
  const free = opts.unconstrainedPath();
  if (free.length >= 2) {
    const stopAlong = polylineLength(path.length >= 2 ? path : [start]);
    const freeLen = polylineLength(free);
    if (freeLen > stopAlong + 0.05) {
      // The first spot, from the stop onward, where the unconstrained route would break the rule
      for (let s = Math.max(0, stopAlong - PROBE_BEHIND); s <= freeLen + 1e-9; s += SAMPLE_STEP) {
        const hit = findKeepAwayViolation(state, unit.id, pointAlong(free, s), start, opts.ignoreUnitId);
        if (hit) {
          const name = state.units.find((u) => u.id === hit.unitId)?.name ?? 'another unit';
          return { cause: 'keep-away', text: `Stopped: within 1" of ${name} (keep-away)`, at, unitId: hit.unitId, unitName: name };
        }
      }
    }
  }
  if (heightShort) {
    return { cause: 'climb', text: "Stopped: can't climb there (use stairs or a ladder)", at };
  }
  return { cause: 'terrain', text: 'Stopped: blocked by terrain', at };
}
