import { GameState, Unit } from '../gameTypes';
import { Vector3 } from '../types';
import {
  MODEL_OVERLAP_DISTANCE,
  SQUAD_COHERENCY_CROSS_LEVEL_CENTRE,
  SQUAD_COHERENCY_SAME_LEVEL_CENTRE,
  SQUAD_COHERENCY_SPREAD,
  areOnDifferentLevels,
  findMoveBlocker,
  findNavPath,
  isRegroupingMove,
  validateSquadCoherency,
} from './spatial';
import { closestApproach, endSpotProblem, pointAlong, polylineLength } from './closestApproach';
import { MELEE_MAX_VERTICAL_REACH, isPathDangerous, isPathDifficult, pathMovementCost } from './traversal';
import { CHARGE_END_EDGE_GAP, livingModelPositions, modelGap } from './unitGeometry';

/**
 * Squad follow-through (UX): after the player hand-places one or more models of a squad's Advance, Rush or
 * charge leg, the models still unplaced are moved for them. This is a convenience, not a rule: every model still
 * walks its own legal path within its own allowance, and the host validates every model as it always does.
 *
 * Each follower aims at its own spot shifted by the average displacement of the hand-placed models (the squad
 * keeps its formation). It walks there with one `findNavPath` call; when it cannot get all the way it takes the
 * farthest point along the way that is legal and keeps the squad linked. Failing that it takes the nearest legal
 * spot (a straight, flat walk) within 1" of a model that is already settled, and failing that it stays put.
 * Hand-placed models are never moved.
 */

export interface FollowModel {
  /** Index among the unit's living models. */
  index: number;
  start: Vector3;
  /** What this model may still spend on this action (its own allowance). */
  budget: number;
  /** The cap that applies when the walk crosses Difficult Terrain (remaining of the 6" cap). Defaults to `budget`. */
  difficultBudget?: number;
}

export interface FollowInput {
  kind: 'move' | 'rush' | 'charge';
  /** Every living model, in order (`models[i].index === i`). */
  models: FollowModel[];
  /** Hand-placed models and where they end. They are never moved. */
  placed: Array<{ index: number; position: Vector3 }>;
  /** A Rush (or a unit that has rushed) stops short of Difficult Terrain so its speed bonus is not negated. */
  stopBeforeDifficult?: boolean;
  /** The declared charge target (charge only): exempt from the 1" keep-away and the thing models close on. */
  target?: Unit;
}

export interface FollowPlacement {
  position: Vector3;
  /** The walk from the model's start (one point when it stays). */
  path: Vector3[];
}

export type FollowResult =
  | {
      ok: true;
      /** The follower placements only (not the hand-placed models). */
      placements: Map<number, FollowPlacement>;
      /** Followers that found nothing legal to move to and stay where they are. */
      stayed: number[];
      /** On a final charge: models walked "as close as possible" because a placed model touches the target. */
      closedIn: number[];
    }
  | { ok: false; reason: string; modelIndex: number };

const COST_TOLERANCE = 0.05;
const r2 = (n: number): number => Math.round(n * 100) / 100;
/** Fallback ring spots (centre distance) tried around each settled model. */
const RING_RADII = [MODEL_OVERLAP_DISTANCE + 0.1, 1.5, 2.0];
const RING_STEPS = 16;
const MAX_RING_CHECKS = 60;
const WALK_BACK_STEP = 0.25;

function crowded(p: Vector3, others: Vector3[]): boolean {
  return others.some(
    (o) => Math.abs((o.y ?? 0) - (p.y ?? 0)) < 1.0 && Math.hypot(o.x - p.x, o.z - p.z) < MODEL_OVERLAP_DISTANCE - 0.01
  );
}

/** Linked to some settled model (1" same level, 3" across levels) and, optionally, within the 6" spread of all. */
function linkedTo(p: Vector3, settled: Vector3[], checkSpread: boolean): boolean {
  if (settled.length === 0) return true;
  if (checkSpread && settled.some((s) => Math.hypot(s.x - p.x, s.z - p.z) > SQUAD_COHERENCY_SPREAD + 0.02)) return false;
  return settled.some(
    (s) =>
      Math.hypot(s.x - p.x, s.z - p.z) <=
      (areOnDifferentLevels(s, p) ? SQUAD_COHERENCY_CROSS_LEVEL_CENTRE : SQUAD_COHERENCY_SAME_LEVEL_CENTRE) + 0.02
  );
}

/** The model with the least company, plus the coherency reason; null when the squad is coherent. */
function incoherentModel(positions: Vector3[]): { index: number; reason: string } | null {
  const res = validateSquadCoherency(positions);
  if (res.coherent) return null;
  let worst = 0;
  let worstD = -1;
  positions.forEach((p, i) => {
    let nearest = Infinity;
    positions.forEach((q, j) => {
      if (i !== j) nearest = Math.min(nearest, Math.hypot(p.x - q.x, p.z - q.z));
    });
    if (nearest > worstD) {
      worstD = nearest;
      worst = i;
    }
  });
  return { index: worst, reason: res.reason ?? 'the squad would not be in coherency' };
}

/**
 * Move the squad's unplaced models after the player placed some by hand. Pure and deterministic. At most one
 * `findNavPath` per follower on an Advance/Rush or a charge leg (a final charge into contact uses
 * `closestApproach`, the same "as close as possible" search the host judges it by).
 */
export function autoPlaceSquadFollowers(state: GameState, unit: Unit, input: FollowInput): FollowResult {
  const { models, placed, kind, target } = input;
  const placedIdx = new Set(placed.map((p) => p.index));
  const followers = models.filter((m) => !placedIdx.has(m.index));
  const placements = new Map<number, FollowPlacement>();
  const stayed: number[] = [];
  const closedIn: number[] = [];
  const finalAt = new Map<number, Vector3>(placed.map((p) => [p.index, p.position]));
  const startPositions = models.map((m) => m.start);
  const startedIncoherent = !validateSquadCoherency(startPositions).coherent;
  const ignoreUnitId = kind === 'charge' ? target?.id : undefined;

  if (followers.length === 0 || placed.length === 0) return { ok: true, placements, stayed, closedIn };

  const stay = (m: FollowModel): void => {
    placements.set(m.index, { position: { ...m.start }, path: [{ ...m.start }] });
    finalAt.set(m.index, m.start);
    stayed.push(m.index);
  };

  /** The squad as a whole must be legal: no overlaps, and coherent (or closer to coherent when it began out). */
  const finish = (): FollowResult => {
    const ends = models.map((m) => finalAt.get(m.index) ?? m.start);
    for (const f of followers) {
      if (crowded(ends[f.index], ends.filter((_, j) => j !== f.index))) {
        return {
          ok: false,
          modelIndex: f.index,
          reason: `Model ${f.index + 1} has no legal spot to move to and its own spot is taken: place it by hand`,
        };
      }
    }
    const bad = incoherentModel(ends);
    if (bad && !(startedIncoherent && isRegroupingMove(startPositions, ends))) {
      const who = stayed.length > 0 ? stayed[0] : (followers.find((f) => f.index === bad.index) ?? followers[0]).index;
      return {
        ok: false,
        modelIndex: who,
        reason: `Model ${who + 1} could not follow the squad to a legal spot: ${bad.reason}. Place it by hand`,
      };
    }
    return { ok: true, placements, stayed, closedIn };
  };

  const targetModels = target ? livingModelPositions(target) : [];
  const touchesTarget = (p: Vector3): boolean =>
    targetModels.some(
      (t) => modelGap(p, t) <= CHARGE_END_EDGE_GAP + 0.001 && Math.abs((p.y ?? 0) - (t.y ?? 0)) <= MELEE_MAX_VERTICAL_REACH
    );

  // A final charge: a placed model touches the target, so every other model moves as close as it can
  if (kind === 'charge' && target && placed.some((p) => touchesTarget(p.position))) {
    const settled = new Set(placedIdx);
    for (const m of followers) {
      const others = models.filter((o) => o.index !== m.index && settled.has(o.index)).map((o) => finalAt.get(o.index)!);
      const best = closestApproach(state, unit, m.index, m.start, m.budget, target, others, {
        difficultBudget: m.difficultBudget ?? m.budget,
      });
      if (best && best.cost > COST_TOLERANCE) {
        placements.set(m.index, { position: best.position, path: best.path });
        finalAt.set(m.index, best.position);
        closedIn.push(m.index);
      } else {
        stay(m);
      }
      settled.add(m.index);
    }
    return finish();
  }

  // Formation shift: the average displacement of the hand-placed models
  let sx = 0;
  let sz = 0;
  let sy = 0;
  for (const p of placed) {
    const s = models[p.index].start;
    sx += p.position.x - s.x;
    sz += p.position.z - s.z;
    sy += (p.position.y ?? 0) - (s.y ?? 0);
  }
  const shift = { x: sx / placed.length, z: sz / placed.length, y: sy / placed.length };
  const settledStarts: Vector3[] = placed.map((p) => models[p.index].start);
  const remaining = [...followers];
  const checkSpread = !startedIncoherent;

  while (remaining.length > 0) {
    // The follower whose start is nearest a settled model's start goes next: the squad grows like a chain
    let pick = 0;
    let pickD = Infinity;
    remaining.forEach((m, k) => {
      const d = Math.min(...settledStarts.map((s) => Math.hypot(s.x - m.start.x, s.z - m.start.z)));
      if (d < pickD - 1e-9) {
        pickD = d;
        pick = k;
      }
    });
    const m = remaining.splice(pick, 1)[0];
    const final = [...finalAt.values()];
    const budget = Math.max(0, m.budget);
    const difficultBudget = m.difficultBudget ?? budget;

    const legal = (path: Vector3[]): boolean => {
      const end = path[path.length - 1];
      if (path.length >= 2) {
        const cost = pathMovementCost(state, path, unit);
        if (cost > budget + COST_TOLERANCE) return false;
        if (isPathDangerous(state, path, unit)) return false;
        if (isPathDifficult(state, path, unit) && cost > difficultBudget + COST_TOLERANCE) return false;
      }
      if (crowded(end, final)) return false;
      if (kind === 'charge' && touchesTarget(end)) return false; // a leg must not turn into a contact by accident
      if (endSpotProblem(state, unit, m.start, end, ignoreUnitId)) return false;
      if (!linkedTo(end, final, checkSpread)) return false;
      return true;
    };

    let chosen: Vector3[] | null = null;
    const aim: Vector3 = {
      x: r2(m.start.x + shift.x),
      y: r2((m.start.y ?? 0) + shift.y),
      z: r2(m.start.z + shift.z),
    };
    if (budget >= COST_TOLERANCE && Math.hypot(shift.x, shift.z) + Math.abs(shift.y) > 0.05) {
      const path = findNavPath(state, unit, aim, budget, {
        keepAway: true,
        startPosition: m.start,
        stopBeforeDifficult: input.stopBeforeDifficult,
        ...(ignoreUnitId ? { ignoreUnitId } : {}),
      });
      if (path.length >= 2) {
        const total = polylineLength(path);
        for (let want = total; want > 0.05; want -= WALK_BACK_STEP) {
          const prefix = want === total ? path : pointAlong(path, want).upTo;
          if (legal(prefix)) {
            chosen = prefix;
            break;
          }
        }
      }
    }

    // Nearest legal flat walk to a spot within 1" (edge) of a settled model
    if (!chosen && budget >= COST_TOLERANCE) {
      const cands: Vector3[] = [];
      for (const s of final) {
        if (Math.abs((s.y ?? 0) - (m.start.y ?? 0)) > 0.3) continue;
        for (const r of RING_RADII) {
          for (let k = 0; k < RING_STEPS; k++) {
            const a = (k / RING_STEPS) * Math.PI * 2;
            cands.push({ x: r2(s.x + Math.cos(a) * r), y: m.start.y ?? 0, z: r2(s.z + Math.sin(a) * r) });
          }
        }
      }
      cands.sort((a, b) => Math.hypot(a.x - aim.x, a.z - aim.z) - Math.hypot(b.x - aim.x, b.z - aim.z));
      let checked = 0;
      for (const c of cands) {
        if (checked >= MAX_RING_CHECKS) break;
        if (Math.hypot(c.x - m.start.x, c.z - m.start.z) > budget + COST_TOLERANCE) continue;
        checked++;
        const path = [m.start, c];
        if (crowded(c, final)) continue;
        if (findMoveBlocker(state, unit, path, { keepAway: true, ...(ignoreUnitId ? { ignoreUnitId } : {}) }).blocked) continue;
        if (legal(path)) {
          chosen = path;
          break;
        }
      }
    }

    if (chosen) {
      const end = chosen[chosen.length - 1];
      placements.set(m.index, { position: { ...end }, path: chosen.map((p) => ({ ...p })) });
      finalAt.set(m.index, end);
    } else {
      stay(m);
    }
    settledStarts.push(m.start);
  }
  return finish();
}
