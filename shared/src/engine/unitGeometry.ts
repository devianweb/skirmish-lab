import type { Vector3 } from '../types';
import type { Unit } from '../gameTypes';
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

/** Base-edge gap between a model and a point marker (objectives have no radius). */
export function markerGap(model: Vector3, marker: Vector3, radius: number = UNIT_BASE_RADIUS): number {
  return Math.max(0, centreDistance(model, marker) - radius);
}

/**
 * Base-edge gap between two units' anchor points (`unit.position` is only the display anchor, the
 * centroid for squads). Shooting and "> 9 inch" rules measure between models with `unitDistance`;
 * charges and engagement still use this until PR 9b swaps them.
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

/** World position of every living model (a unit with no model list is one model at its anchor). */
export function livingModelPositions(unit: Pick<Unit, 'position' | 'models'>): Vector3[] {
  if (!unit.models || unit.models.length === 0) return [{ ...unit.position }];
  return unit.models.filter((m) => !m.isDestroyed).map((m) => ({ ...(m.position ?? unit.position) }));
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
