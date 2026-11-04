import { GameState, PendingReaction, Unit } from '../gameTypes';
import { Vector3 } from '../types';
import { closestApproach, endSpotProblem } from './closestApproach';
import { coherencyShortfall, findMoveBlocker, validateSquadCoherency } from './spatial';
import {
  FREE_DROP_MAX,
  MELEE_MAX_VERTICAL_REACH,
  detectPathFall,
  detectPathGapJump,
  isPathDangerous,
  pathMovementCost,
} from './traversal';
import { CHARGE_END_EDGE_GAP, livingModelPositions, modelGap } from './unitGeometry';

/**
 * The defender's pile-in after a charge: the target's models that are not in base contact with a charging
 * model each move up to `PILE_IN_DISTANCE` by ordinary movement, into contact or as close as they can get
 * (`closestApproach`), keeping the squad together. The defending player places them; the host checks the
 * placement here, and also places them itself when the prompt runs out of time (`autoPileIn`).
 */

export const PILE_IN_DISTANCE = 3.0;
/** Reaction choice that lets the host place the models itself (the timeout default). */
export const PILE_IN_AUTO_CHOICE = 'auto-pile-in';
/** How long the defender has to place the models (placing several takes longer than a strike-back choice). */
export const PILE_IN_DURATION_MS = 60000;
/** A piling model may end this much (base-edge inches) farther from the chargers than its best spot. */
export const PILE_IN_TOLERANCE = 0.5;

export type PileInResult = { valid: true } | { valid: false; reason: string };

export interface PileInPayload {
  modelPositions?: Vector3[];
  modelPaths?: Vector3[][];
}

function living(unit: Unit) {
  return (unit.models ?? []).filter((m) => !m.isDestroyed);
}

/** True when a model at `p` is in base contact (and within vertical melee reach) of a model in `foes`. */
function inContactWith(p: Vector3, foes: Vector3[]): boolean {
  return foes.some(
    (f) =>
      modelGap(p, f) <= CHARGE_END_EDGE_GAP + 0.001 && Math.abs((p.y ?? 0) - (f.y ?? 0)) <= MELEE_MAX_VERTICAL_REACH
  );
}

/**
 * Ids of the target's living models that have to pile in: not in base contact with any charging model. Empty for
 * a target with a single living model (a charge only succeeds when a target model is touched, so it is in
 * contact already) and when everyone is already touching.
 */
export function pileInModelIds(target: Unit, charger: Unit): string[] {
  const alive = living(target);
  if (alive.length <= 1) return [];
  const foes = livingModelPositions(charger);
  return alive.filter((m) => !inContactWith(m.position ?? target.position, foes)).map((m) => m.id);
}

/** A copy of `unit` with its living models standing on `positions` (living-model order). */
export function withModelPositions(unit: Unit, positions: Vector3[]): Unit {
  let i = 0;
  return {
    ...unit,
    models: (unit.models ?? []).map((m) => (m.isDestroyed ? m : { ...m, position: { ...positions[i++] } })),
  };
}

const sqDist = (a: Vector3, b: Vector3): number => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Host check of a pile-in placement. `payload.modelPositions` (and optional `modelPaths`) are in living-model
 * order. Only the models listed in the reaction may move; each walks at most 3" by ordinary movement (no jumps,
 * long drops or hazards) to a legal spot that is in base contact with a charging model or about as close as
 * `closestApproach` can get it; the unit stays coherent (or no less coherent than it began).
 */
export function validatePileIn(
  state: GameState,
  pending: PendingReaction,
  defender: Unit,
  charger: Unit,
  payload: PileInPayload
): PileInResult {
  const alive = living(defender);
  const positions = payload.modelPositions;
  if (!positions) return { valid: false, reason: 'A pile-in must give a position for every model (modelPositions)' };
  if (positions.length !== alive.length) {
    return { valid: false, reason: `Model positions count mismatch (${positions.length} vs ${alive.length} active models)` };
  }
  if (payload.modelPaths && payload.modelPaths.length > positions.length) {
    return { valid: false, reason: 'More model paths than squad models' };
  }
  const mustMove: string[] = pending.data?.modelIds ?? [];
  const maxDistance: number = pending.data?.maxDistance ?? PILE_IN_DISTANCE;
  const foes = livingModelPositions(charger);
  const halfW = (state.board.width * state.board.gridSize) / 2;
  const halfH = (state.board.height * state.board.gridSize) / 2;

  const pendingChecks: Array<{ index: number; endGap: number }> = [];
  for (let i = 0; i < alive.length; i++) {
    const n = i + 1;
    const model = alive[i];
    const start = model.position ?? defender.position;
    const end = positions[i];
    const sent = payload.modelPaths?.[i];
    const path = sent && sent.length >= 2 ? sent : [start, end];
    if (!mustMove.includes(model.id)) {
      if (sqDist(start, end) > 0.05 || Math.abs((start.y ?? 0) - (end.y ?? 0)) > 0.05) {
        return { valid: false, reason: `Model ${n} is already in contact and may not move` };
      }
      continue;
    }
    if (sqDist(path[0], start) > 0.05) return { valid: false, reason: `Model ${n} move path does not start at its position` };
    if (sqDist(path[path.length - 1], end) > 0.05) {
      return { valid: false, reason: `Model ${n} move path does not end at its position` };
    }
    for (const pt of path) {
      if (pt.x < -halfW || pt.x > halfW || pt.z < -halfH || pt.z > halfH) {
        return { valid: false, reason: `Model ${n} move path leaves the board` };
      }
    }
    const cost = path.length < 2 ? 0 : pathMovementCost(state, path, defender);
    if (cost > maxDistance + 0.05) {
      return { valid: false, reason: `Model ${n} piles in too far (${cost.toFixed(1)}" vs ${maxDistance}")` };
    }
    if (path.length >= 2) {
      const gap = detectPathGapJump(state, path, defender);
      if (gap.isGapJump || gap.tooWide) return { valid: false, reason: `Model ${n} may not jump while piling in` };
      if (isPathDangerous(state, path, defender)) {
        return { valid: false, reason: `Model ${n} may not pile in through hazardous terrain` };
      }
      if (detectPathFall(path, state).maxDrop > FREE_DROP_MAX) {
        return { valid: false, reason: `Model ${n} may not drop that far while piling in` };
      }
      const blocker = findMoveBlocker(state, defender, path, { ignoreUnitId: charger.id, keepAway: true });
      if (blocker.blocked) return { valid: false, reason: `Model ${n} move path is blocked: ${blocker.reason}` };
    }
    const problem = endSpotProblem(state, defender, start, end, charger.id);
    if (problem) return { valid: false, reason: `Model ${n} ${problem}` };
    if (!inContactWith(end, foes)) {
      pendingChecks.push({ index: i, endGap: Math.min(...foes.map((f) => modelGap(end, f))) });
    }
  }
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      if (sqDist(positions[i], positions[j]) < 0.9) {
        return { valid: false, reason: `Squad models ${i + 1} and ${j + 1} cannot overlap` };
      }
    }
  }

  // Coherency: a coherent unit stays coherent; one that began broken may not get worse
  if (positions.length > 1 && !validateSquadCoherency(positions).coherent) {
    const before = alive.map((m) => m.position ?? defender.position);
    const startShortfall = coherencyShortfall(before);
    if (!(startShortfall > 0 && coherencyShortfall(positions) <= startShortfall + 0.001)) {
      const reason = validateSquadCoherency(positions).reason ?? 'Squad models lose coherency';
      return { valid: false, reason };
    }
  }

  // "As close as possible": a model not in contact must be about as near the chargers as it could have got
  for (const p of pendingChecks) {
    const start = alive[p.index].position ?? defender.position;
    const others = positions.filter((_, j) => j !== p.index);
    const best = closestApproach(state, defender, p.index, start, maxDistance, charger, others);
    if (best && p.endGap > best.gap + PILE_IN_TOLERANCE) {
      return { valid: false, reason: `Model ${p.index + 1} could get closer to the chargers` };
    }
  }
  return { valid: true };
}

/**
 * The host's own pile-in (used when the defender runs out of time): the listed models, nearest the chargers
 * first, each take their `closestApproach` spot given where the rest stand. Deterministic. Models that cannot
 * move stay put. Positions and paths are in living-model order.
 */
export function autoPileIn(
  state: GameState,
  pending: PendingReaction,
  defender: Unit,
  charger: Unit
): { modelPositions: Vector3[]; modelPaths: Vector3[][] } {
  const alive = living(defender);
  const mustMove: string[] = pending.data?.modelIds ?? [];
  const maxDistance: number = pending.data?.maxDistance ?? PILE_IN_DISTANCE;
  const foes = livingModelPositions(charger);
  const positions = alive.map((m) => ({ ...(m.position ?? defender.position) }));
  const paths: Vector3[][] = positions.map((p) => [{ ...p }]);
  const order = alive
    .map((m, i) => ({ i, d: Math.min(...foes.map((f) => sqDist(positions[i], f))) }))
    .filter(({ i }) => mustMove.includes(alive[i].id))
    .sort((a, b) => a.d - b.d || a.i - b.i);
  for (const { i } of order) {
    const start = positions[i];
    const others = positions.filter((_, j) => j !== i);
    const best = closestApproach(state, defender, i, start, maxDistance, charger, others);
    if (best && best.path.length >= 2) {
      positions[i] = best.position;
      paths[i] = best.path;
    }
  }
  return { modelPositions: positions, modelPaths: paths };
}
