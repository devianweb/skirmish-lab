import type { Vector3 } from '../types';
import type { Model, Unit } from '../gameTypes';
import { UNIT_BASE_RADIUS } from './terrainStructure';

/**
 * Base-edge measuring. Tabletop distances between things run from the closest points of their bases,
 * not from their centres. Every rule distance goes through these helpers and is written with the real
 * tabletop number (1", 3", 6", 9", weapon range); only *path lengths* (a model moves its centre) stay
 * centre based. All measurements are horizontal; height limits are separate rules.
 */

/** Radius of a unit's bases (all fighters use 1" bases for now; will come from data later). */
export function baseRadius(_unit?: Pick<Unit, 'position'>): number {
  return UNIT_BASE_RADIUS;
}

/** Horizontal centre-to-centre distance. */
export function centreDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Base-edge gap between two models at `a` and `b` (0 once the bases touch). */
export function modelGap(
  a: Vector3,
  b: Vector3,
  radiusA: number = UNIT_BASE_RADIUS,
  radiusB: number = UNIT_BASE_RADIUS
): number {
  return Math.max(0, centreDistance(a, b) - radiusA - radiusB);
}

/**
 * The 1" keep-away rule measures real 3D distance between bases: the horizontal base-edge gap (floored at 0 once
 * the bases overlap) combined with the vertical difference of the two models' foot heights, i.e.
 * sqrt(modelGap^2 + dy^2). A model on a 3" deck is therefore never "within 1"" of one standing on the ground
 * beneath it, however close they are in plan view. Melee reach and cross-level coherency have their own rules.
 */
export function keepAwayGap3D(
  a: Vector3,
  b: Vector3,
  radiusA: number = UNIT_BASE_RADIUS,
  radiusB: number = UNIT_BASE_RADIUS
): number {
  return Math.hypot(modelGap(a, b, radiusA, radiusB), (a.y ?? 0) - (b.y ?? 0));
}

/** Base-edge gap between a model and a point marker (objectives have no radius). */
export function markerGap(model: Vector3, marker: Vector3, radius: number = UNIT_BASE_RADIUS): number {
  return Math.max(0, centreDistance(model, marker) - radius);
}

/**
 * Base-edge gap between two units' anchor points (`unit.position` is only the display anchor, the
 * centroid for squads). Rules between units measure between models with `unitDistance`; this anchor
 * version is only for places that really mean "the unit as a point".
 */
export function unitGap(a: Pick<Unit, 'position'>, b: Pick<Unit, 'position'>): number {
  return modelGap(a.position, b.position, baseRadius(a), baseRadius(b));
}

/** Centre-to-centre distance at which two standard bases are `edgeGap` inches apart. */
export function edgeGapToCentre(edgeGap: number): number {
  return edgeGap + 2 * UNIT_BASE_RADIUS;
}

/** Models whose bases are this close (edge gap) count as engaged in melee, and a move may not end this close to an enemy. */
export const ENGAGEMENT_EDGE_GAP = 0.5;
/** A charge must finish with its base edge at most this far from the target's (base contact is 0). */
export const CHARGE_END_EDGE_GAP = 0.25;
/** Deployment (and similar placement) must stay more than this far, edge to edge, from enemy models. */
export const ENEMY_KEEP_AWAY_GAP = 1;

// ---------------------------------------------------------------------------
// Per-model geometry (squads). `unit.position` is only an anchor; rules measure between models.
// ---------------------------------------------------------------------------

/** True when `model` carries the weapon (a model with no `weaponIds` carries every weapon of its unit). */
export function modelCarries(model: Pick<Model, 'weaponIds'>, weaponId: string): boolean {
  return !model.weaponIds || model.weaponIds.includes(weaponId);
}

/**
 * World position of every living model (a unit with no model list is one model at its anchor). With `weaponId`,
 * only the living models that carry that weapon.
 */
export function livingModelPositions(unit: Pick<Unit, 'position' | 'models'>, weaponId?: string): Vector3[] {
  if (!unit.models || unit.models.length === 0) return [{ ...unit.position }];
  return unit.models
    .filter((m) => !m.isDestroyed && (weaponId === undefined || modelCarries(m, weaponId)))
    .map((m) => ({ ...(m.position ?? unit.position) }));
}

export interface ModelPair {
  /** Model of unit `a`. */
  from: Vector3;
  /** Model of unit `b`. */
  to: Vector3;
  /** Base-edge gap between them. */
  gap: number;
}

/** The closest pair of living models (one from each unit) by base-edge gap, or null if a unit has none. */
export function closestModelPair(
  a: Pick<Unit, 'position' | 'models'>,
  b: Pick<Unit, 'position' | 'models'>
): ModelPair | null {
  let best: ModelPair | null = null;
  const rA = baseRadius(a);
  const rB = baseRadius(b);
  for (const from of livingModelPositions(a)) {
    for (const to of livingModelPositions(b)) {
      const gap = modelGap(from, to, rA, rB);
      if (!best || gap < best.gap) best = { from, to, gap };
    }
  }
  return best;
}

/** Base-edge distance between the closest models of two units. */
export function unitDistance(
  a: Pick<Unit, 'position' | 'models'>,
  b: Pick<Unit, 'position' | 'models'>
): number {
  return closestModelPair(a, b)?.gap ?? unitGap(a, b);
}

// ---------------------------------------------------------------------------
// Engagement and melee reach (per model)
// ---------------------------------------------------------------------------

/** Models at heights further apart than this (inches) are not engaged / do not keep each other away. */
export const ENGAGEMENT_MAX_DY = 1.5;
/** A model strikes in melee when its base edge is at most this far (horizontally) from an enemy model's. */
export const MELEE_STRIKE_EDGE_GAP = 3;
/** ...and at most this far apart vertically. */
export const MELEE_STRIKE_MAX_DY = 4;
const GEOMETRY_TOLERANCE = 0.001;

type ModelSource = Pick<Unit, 'position' | 'models'>;

/** Base-edge gap from a point (a model about to stand there) to the closest living model of `unit`. */
export function gapToUnit(point: Vector3, unit: ModelSource): number {
  let best = Infinity;
  const r = baseRadius(unit);
  for (const pos of livingModelPositions(unit)) {
    best = Math.min(best, modelGap(point, pos, UNIT_BASE_RADIUS, r));
  }
  return best;
}

/**
 * True when some model of `a` and some model of `b` are within `edgeGap` (base edge to base edge) and no more
 * than `maxDy` apart vertically.
 */
export function modelsWithin(
  a: ModelSource,
  b: ModelSource,
  edgeGap: number,
  maxDy: number = Infinity
): boolean {
  const rA = baseRadius(a);
  const rB = baseRadius(b);
  const bPositions = livingModelPositions(b);
  for (const from of livingModelPositions(a)) {
    for (const to of bPositions) {
      if (
        modelGap(from, to, rA, rB) <= edgeGap + GEOMETRY_TOLERANCE &&
        Math.abs((from.y ?? 0) - (to.y ?? 0)) <= maxDy + GEOMETRY_TOLERANCE
      ) {
        return true;
      }
    }
  }
  return false;
}

/** True when a model standing at `point` would be within the engagement gap (and level) of a model of `unit`. */
/**
 * Horizontal centre-to-centre distance below which two models `dy` apart in height are inside the 1" keep-away
 * (the 3D rule `keepAwayGap3D < edgeGap`), or null when `dy` alone already keeps them `edgeGap` apart.
 */
export function keepAwayCentreRadius(
  dy: number,
  edgeGap: number = ENEMY_KEEP_AWAY_GAP,
  radiusA: number = UNIT_BASE_RADIUS,
  radiusB: number = UNIT_BASE_RADIUS
): number | null {
  const ady = Math.abs(dy);
  if (ady >= edgeGap) return null;
  return radiusA + radiusB + Math.sqrt(edgeGap * edgeGap - ady * ady);
}

/** Smallest 3D keep-away gap (see `keepAwayGap3D`) from a point to any living model of `unit`. */
export function keepAwayGapToUnit3D(point: Vector3, unit: ModelSource): number {
  const r = baseRadius(unit);
  let best = Infinity;
  for (const pos of livingModelPositions(unit)) best = Math.min(best, keepAwayGap3D(point, pos, UNIT_BASE_RADIUS, r));
  return best;
}

export function pointEngagesUnit(point: Vector3, unit: ModelSource): boolean {
  const r = baseRadius(unit);
  return livingModelPositions(unit).some(
    (pos) =>
      modelGap(point, pos, UNIT_BASE_RADIUS, r) <= ENGAGEMENT_EDGE_GAP + GEOMETRY_TOLERANCE &&
      Math.abs((point.y ?? 0) - (pos.y ?? 0)) <= ENGAGEMENT_MAX_DY
  );
}

/** Two units are in melee contact when any pair of their models is within the engagement gap (and level). */
export function unitsInContact(a: ModelSource, b: ModelSource): boolean {
  return modelsWithin(a, b, ENGAGEMENT_EDGE_GAP, ENGAGEMENT_MAX_DY);
}

/**
 * Number of `striker`'s living models that can strike `foe` in melee: within 3" (base edge, horizontal) and 4"
 * (vertical) of some living model of `foe`. Attacks are pooled by the caller (weapon attacks x this count).
 * With `weaponId`, only the models that carry that weapon are counted.
 */
export function strikingModelCount(striker: ModelSource, foe: ModelSource, weaponId?: string): number {
  const rS = baseRadius(striker);
  const rF = baseRadius(foe);
  const foePositions = livingModelPositions(foe);
  let count = 0;
  for (const from of livingModelPositions(striker, weaponId)) {
    if (
      foePositions.some(
        (to) =>
          modelGap(from, to, rS, rF) <= MELEE_STRIKE_EDGE_GAP + GEOMETRY_TOLERANCE &&
          Math.abs((from.y ?? 0) - (to.y ?? 0)) <= MELEE_STRIKE_MAX_DY + 0.05
      )
    ) {
      count++;
    }
  }
  return count;
}

/**
 * Where a unit's models would stand if its whole formation moved so the anchor ends at `anchorEnd`
 * (the block move a squad charge without per-model positions still uses; also used by `chargeContact`).
 */
export function modelsTranslatedTo(unit: ModelSource, anchorEnd: Vector3): Vector3[] {
  const dx = anchorEnd.x - unit.position.x;
  const dz = anchorEnd.z - unit.position.z;
  return livingModelPositions(unit).map((p) => ({
    x: p.x + dx,
    y: anchorEnd.y ?? p.y ?? 0,
    z: p.z + dz,
  }));
}

export type ChargeContact = 'ok' | 'too-far' | 'too-high';

/**
 * Does a charge that ends with the charger's anchor at `anchorEnd` reach the target? Some charging model must end
 * within `CHARGE_END_EDGE_GAP` (base edge) of some target model, and that pair must be within `maxDy` vertically.
 */
export function chargeContact(
  charger: ModelSource,
  target: ModelSource,
  anchorEnd: Vector3,
  maxDy: number
): ChargeContact {
  let reached = false;
  const rC = baseRadius(charger);
  const rT = baseRadius(target);
  const targets = livingModelPositions(target);
  for (const from of modelsTranslatedTo(charger, anchorEnd)) {
    for (const to of targets) {
      if (modelGap(from, to, rC, rT) > CHARGE_END_EDGE_GAP + GEOMETRY_TOLERANCE) continue;
      reached = true;
      if (Math.abs((from.y ?? 0) - (to.y ?? 0)) <= maxDy) return 'ok';
    }
  }
  return reached ? 'too-high' : 'too-far';
}

/**
 * Where a charger's anchor should end to bring its closest model into base contact with the closest model of
 * `target` (a single model: simply base contact with the target). Used to plan the charge path.
 */
export function chargeDestination(charger: ModelSource, target: ModelSource): Vector3 {
  const pair = closestModelPair(charger, target);
  const y = charger.position.y ?? 0;
  if (!pair) return { x: charger.position.x, y, z: charger.position.z };
  const dx = pair.from.x - pair.to.x;
  const dz = pair.from.z - pair.to.z;
  const len = Math.hypot(dx, dz) || 1;
  const contact = edgeGapToCentre(0);
  const modelEndX = pair.to.x + (dx / len) * contact;
  const modelEndZ = pair.to.z + (dz / len) * contact;
  return {
    x: Math.round((modelEndX + (charger.position.x - pair.from.x)) * 100) / 100,
    y,
    z: Math.round((modelEndZ + (charger.position.z - pair.from.z)) * 100) / 100,
  };
}
