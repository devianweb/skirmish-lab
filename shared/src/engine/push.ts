import { GameState, Model, PendingReaction, Unit } from '../gameTypes';
import { Vector3 } from '../types';
import {
  MODEL_OVERLAP_DISTANCE,
  SQUAD_COHERENCY_CROSS_LEVEL_CENTRE,
  SQUAD_COHERENCY_SAME_LEVEL_CENTRE,
  UNIT_COLLISION_RADIUS,
  areOnDifferentLevels,
  collectWalkableSurfaces,
  findEndOverlap,
  isBaseOverhanging,
} from './spatial';
import { fallDiceCount, floorHeightBelow } from './traversal';

/**
 * Pushing: when an attack leaves an enemy unit Shaken, the attacking player rolls a die; on a 4+ they move
 * one model of that unit up to `PUSH_RANGE` inches. The host sets a `push` reaction for the attacker. It offers
 * Auto (the model nearest the attacker moves directly away, as far as is legal), Confirm (the attacker picks the
 * model and spot: the `push-move` action) and Don't push. A model pushed off an edge falls like any other (`fallDiceCount`) and the rest of the unit is placed
 * around it at the bottom (`gatherAroundFallen`); after a push that does not fall, the other models step in, the
 * least they must, to keep the unit together (`regroupAfterPush`).
 */

export const PUSH_RANGE = 2.0;
/** The push die needs this or better. */
export const PUSH_TARGET = 4;
/** Reaction choice that lets the host push (the timeout default). */
export const PUSH_AUTO_CHOICE = 'auto-push';
/** Reaction choice that declines the push: pushing is optional, so the attacker may leave the unit where it is. */
export const PUSH_DECLINE_CHOICE = 'no-push';
/** The Confirm button: the attacker picks the model and the spot on the board (sent as a `push-move`). */
export const PUSH_CONFIRM_CHOICE = 'confirm-push';
export const PUSH_DURATION_MS = 30000;

/** A queued push: the Shaken unit and who attacked it. */
export interface PushQueueEntry {
  unitId: string;
  attackerId: string;
}

export interface PushData {
  actionId: string;
  /** Further pushes from the same end of activation, in order. */
  rest: PushQueueEntry[];
}

export type PushPlan =
  | { ok: true; position: Vector3; fallHeight: number; fallDice: number }
  | { ok: false; reason: string };

function living(unit: Unit): Model[] {
  return (unit.models ?? []).filter((m) => !m.isDestroyed);
}

/**
 * Who pushes if `unit` becomes Shaken at the end of the active unit's activation, or null when nobody does
 * (it was not attacked by an enemy). An enemy of the active unit was attacked by it; the active unit itself
 * was attacked only if it fought in melee, and then its opponent in that fight pushes.
 */
export function pushAttackerFor(state: GameState, unit: Unit, active: Unit | null | undefined): Unit | null {
  if (!active) return null;
  if (unit.ownerId !== active.ownerId) return active;
  if (unit.id === active.id) {
    const pair = (state.turnState.meleePairs ?? []).find((p) => p.includes(unit.id));
    const partnerId = pair?.find((id) => id !== unit.id);
    return partnerId ? (state.units.find((u) => u.id === partnerId) ?? null) : null;
  }
  return null;
}

export function createPushReaction(
  actionId: string,
  shaken: Unit,
  attacker: Unit,
  rest: PushQueueEntry[]
): PendingReaction {
  return {
    id: `${actionId}-push-${shaken.id}`,
    type: 'push',
    promptingPlayerId: attacker.ownerId,
    sourceUnitId: attacker.id,
    targetUnitId: shaken.id,
    title: 'Push',
    description: `${shaken.name} is Shaken: move one of its models up to ${PUSH_RANGE}". Auto pushes the model nearest ${attacker.name} straight away from it.`,
    options: [
      { id: PUSH_AUTO_CHOICE, label: 'Auto', isDefault: true, style: 'primary' },
      { id: PUSH_CONFIRM_CHOICE, label: 'Confirm', style: 'secondary' },
      { id: PUSH_DECLINE_CHOICE, label: "Don't push", style: 'danger' },
    ],
    expiresAt: Date.now() + PUSH_DURATION_MS,
    durationMs: PUSH_DURATION_MS,
    data: { actionId, rest } as unknown as Record<string, any>,
  };
}

/**
 * Check and place a push of `model` to the horizontal spot (`x`, `z`): within `PUSH_RANGE`, on the board, not
 * overlapping terrain or another model. The host works out the height itself: the model stays on its floor
 * unless the spot hangs over open air, and then it falls to the floor below (a fall of 2" or more rolls dice).
 */
export function planPush(
  state: GameState,
  unit: Unit,
  model: Model,
  dest: { x: number; z: number }
): PushPlan {
  const start = model.position ?? unit.position;
  const startY = start.y ?? 0;
  if (Math.hypot(dest.x - start.x, dest.z - start.z) > PUSH_RANGE + 0.02) {
    return { ok: false, reason: `A push moves a model at most ${PUSH_RANGE}"` };
  }
  const halfW = (state.board.width * state.board.gridSize) / 2 - UNIT_COLLISION_RADIUS;
  const halfH = (state.board.height * state.board.gridSize) / 2 - UNIT_COLLISION_RADIUS;
  if (Math.abs(dest.x) > halfW + 1e-6 || Math.abs(dest.z) > halfH + 1e-6) {
    return { ok: false, reason: 'A push cannot move a model off the board' };
  }
  const surfaces = collectWalkableSurfaces(state);
  let position: Vector3 = { x: round2(dest.x), y: startY, z: round2(dest.z) };
  let fallHeight = 0;
  if (isBaseOverhanging(state, position, surfaces)) {
    const floor = floorHeightBelow(surfaces, position.x, position.z, startY);
    position = { ...position, y: floor };
    fallHeight = startY - floor;
    if (isBaseOverhanging(state, position, surfaces)) {
      return { ok: false, reason: 'The model would land half off a floor' };
    }
  }
  if (findEndOverlap(state, unit.id, position)) {
    return { ok: false, reason: 'A pushed model cannot end overlapping terrain or another unit' };
  }
  for (const other of living(unit)) {
    if (other.id === model.id) continue;
    const p = other.position ?? unit.position;
    if (Math.abs((p.y ?? 0) - (position.y ?? 0)) < 1.0 && Math.hypot(p.x - position.x, p.z - position.z) < MODEL_OVERLAP_DISTANCE) {
      return { ok: false, reason: 'A pushed model cannot end on top of another model' };
    }
  }
  return { ok: true, position, fallHeight, fallDice: fallDiceCount(fallHeight) };
}

/**
 * The Auto push: the model of `unit` nearest the attacker moves directly away from the attacker's nearest
 * model, as far as is legal up to `PUSH_RANGE` (a quarter inch at a time). Null when nothing legal exists.
 */
export function autoPush(
  state: GameState,
  unit: Unit,
  attacker: Unit
): { model: Model; plan: Extract<PushPlan, { ok: true }> } | null {
  const from = living(attacker).map((m) => m.position ?? attacker.position);
  const attackerSpots = from.length > 0 ? from : [attacker.position];
  let best: { model: Model; away: { x: number; z: number }; dist: number } | null = null;
  for (const model of living(unit)) {
    const p = model.position ?? unit.position;
    for (const a of attackerSpots) {
      const d = Math.hypot(p.x - a.x, p.z - a.z);
      if (!best || d < best.dist - 1e-9) {
        const len = d || 1;
        best = { model, away: d > 1e-6 ? { x: (p.x - a.x) / len, z: (p.z - a.z) / len } : { x: 0, z: 1 }, dist: d };
      }
    }
  }
  if (!best) return null;
  const start = best.model.position ?? unit.position;
  for (let t = PUSH_RANGE; t >= 0.25 - 1e-9; t -= 0.25) {
    const plan = planPush(state, unit, best.model, { x: start.x + best.away.x * t, z: start.z + best.away.z * t });
    if (plan.ok) return { model: best.model, plan };
  }
  return null;
}

/**
 * After a push, the unit's other models stay put unless the unit would split: each model cut off from the pushed
 * one steps to the closest legal spot (to where it stands) that links it to the connected group, nearest first.
 * A digital stand-in for the opponent placing the rest of the unit.
 */
export function regroupAfterPush(state: GameState, unit: Unit, pushed: Model): void {
  const alive = living(unit);
  if (alive.length <= 1) return;
  const surfaces = collectWalkableSurfaces(state);
  const pos = (m: Model): Vector3 => m.position ?? unit.position;
  const linked = (a: Vector3, b: Vector3): boolean => {
    const limit = areOnDifferentLevels(a, b) ? SQUAD_COHERENCY_CROSS_LEVEL_CENTRE : SQUAD_COHERENCY_SAME_LEVEL_CENTRE;
    return Math.hypot(a.x - b.x, a.z - b.z) <= limit + 0.02;
  };
  const halfW = (state.board.width * state.board.gridSize) / 2 - UNIT_COLLISION_RADIUS;
  const halfH = (state.board.height * state.board.gridSize) / 2 - UNIT_COLLISION_RADIUS;

  for (let guard = 0; guard < alive.length; guard++) {
    const connected = new Set<Model>([pushed]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const m of alive) {
        if (connected.has(m)) continue;
        if ([...connected].some((c) => linked(pos(m), pos(c)))) {
          connected.add(m);
          grew = true;
        }
      }
    }
    const cut = alive.filter((m) => !connected.has(m));
    if (cut.length === 0) return;
    // Nearest cut-off model to the group moves first
    let mover = cut[0];
    let moverGap = Infinity;
    for (const m of cut) {
      for (const c of connected) {
        const d = Math.hypot(pos(m).x - pos(c).x, pos(m).z - pos(c).z);
        if (d < moverGap) {
          moverGap = d;
          mover = m;
        }
      }
    }
    let bestSpot: Vector3 | null = null;
    let bestDist = Infinity;
    const here = pos(mover);
    for (const c of connected) {
      const cp = pos(c);
      for (const r of [1.0, 1.25, 1.5, 1.75, 1.95]) {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const spot: Vector3 = { x: round2(cp.x + Math.cos(a) * r), y: cp.y ?? 0, z: round2(cp.z + Math.sin(a) * r) };
          if (Math.abs(spot.x) > halfW || Math.abs(spot.z) > halfH) continue;
          if (isBaseOverhanging(state, spot, surfaces) || findEndOverlap(state, unit.id, spot)) continue;
          if (
            alive.some(
              (o) =>
                o !== mover &&
                Math.abs((pos(o).y ?? 0) - (spot.y ?? 0)) < 1.0 &&
                Math.hypot(pos(o).x - spot.x, pos(o).z - spot.z) < 1.0
            )
          ) {
            continue;
          }
          const d = Math.hypot(spot.x - here.x, spot.z - here.z);
          if (d < bestDist) {
            bestDist = d;
            bestSpot = spot;
          }
        }
      }
    }
    if (!bestSpot) return;
    mover.position = bestSpot;
  }
}

/**
 * After a push-fall: every other living model of the unit is placed within 1" (base edge to base edge) of the
 * fallen model at the bottom, on the floor where it landed. Each takes the legal spot (supported, clear of terrain
 * and of models already placed) closest to where it stood; a model already there and in reach stays. Models that
 * find no spot are left for the usual regroup. `fallen` may be a casualty of the fall: its landing spot anchors.
 */
export function gatherAroundFallen(state: GameState, unit: Unit, fallen: Model): void {
  const anchor = fallen.position ?? unit.position;
  const others = living(unit).filter((m) => m.id !== fallen.id);
  if (others.length === 0) return;
  const surfaces = collectWalkableSurfaces(state);
  const halfW = (state.board.width * state.board.gridSize) / 2 - UNIT_COLLISION_RADIUS;
  const halfH = (state.board.height * state.board.gridSize) / 2 - UNIT_COLLISION_RADIUS;
  const reach = SQUAD_COHERENCY_SAME_LEVEL_CENTRE;
  const ay = anchor.y ?? 0;
  const candidates: Vector3[] = [];
  for (let r = 0; r <= reach + 1e-9; r += 0.25) {
    const n = r === 0 ? 1 : Math.max(8, Math.round(r * 16));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const spot = { x: round2(anchor.x + Math.cos(a) * r), y: ay, z: round2(anchor.z + Math.sin(a) * r) };
      // Rounding must never push a spot past the 1" edge gap
      if (Math.hypot(spot.x - anchor.x, spot.z - anchor.z) <= reach) candidates.push(spot);
    }
  }
  const placed: Vector3[] = fallen.isDestroyed ? [] : [anchor];
  // Nearest to the fallen model first, so the closest keep their places
  const order = [...others].sort((a, b) => {
    const pa = a.position ?? unit.position;
    const pb = b.position ?? unit.position;
    return Math.hypot(pa.x - anchor.x, pa.z - anchor.z) - Math.hypot(pb.x - anchor.x, pb.z - anchor.z);
  });
  for (const model of order) {
    const here = model.position ?? unit.position;
    let best: Vector3 | null = null;
    let bestDist = Infinity;
    for (const spot of candidates) {
      if (Math.abs(spot.x) > halfW || Math.abs(spot.z) > halfH) continue;
      if (isBaseOverhanging(state, spot, surfaces) || findEndOverlap(state, unit.id, spot)) continue;
      if (placed.some((p) => Math.abs((p.y ?? 0) - ay) < 1.0 && Math.hypot(p.x - spot.x, p.z - spot.z) < MODEL_OVERLAP_DISTANCE)) continue;
      const d = Math.hypot(spot.x - here.x, spot.z - here.z) + Math.abs((here.y ?? 0) - ay) * 0.01;
      if (d < bestDist - 1e-9) {
        bestDist = d;
        best = spot;
      }
    }
    if (best) {
      model.position = best;
      placed.push(best);
    } else {
      placed.push(here);
    }
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
