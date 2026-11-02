import { TerrainAperture, TerrainBox, TerrainGroup, TerrainPiece, TerrainSolid, Unit } from '../gameTypes';
import { Vector3 } from '../types';
import { TERRAIN_STRUCTURES } from '../data/terrainStructures';

/** Standard elevated floor tier (inches): decks and ledges sit with their top at this height. */
export const FLOOR_TIER = 3.0;

/** Eye height (inches) of a hero-scale fighter standing on a 1.0" base. */
export const EYE_HEIGHT = 1.1;
/**
 * Heights on the target sampled by line-of-sight rays: head, torso, feet. A target is visible if
 * a ray from the shooter's eye reaches any one of them (true line of sight to any visible part).
 */
export const TARGET_SAMPLE_HEIGHTS: readonly number[] = [1.1, 0.6, 0.1];
/** Height at which "partially obscured" flank rays are cast (torso). */
export const FLANK_RAY_HEIGHT = 0.6;

/** Reach (inches) from a model's base edge to a mannable surface (window port). */
export const MANNING_REACH = 1.0;
/** Base radius of a fighter (1.0" bases). */
export const UNIT_BASE_RADIUS = 0.5;

export type ResolvedSolid = TerrainSolid & { isObstacle: boolean; blocksLineOfSight: boolean; providesCover: boolean };
export type ResolvedAperture = TerrainAperture & { providesCover: boolean };

/** A piece's structure resolved to inches in the piece's local frame (y up from the piece base). */
export interface ResolvedStructure {
  solids: ResolvedSolid[];
  apertures: ResolvedAperture[];
}

const cache = new Map<string, ResolvedStructure>();

function flatten(
  group: TerrainGroup,
  scale: { x: number; y: number; z: number },
  ox: number,
  oz: number,
  out: ResolvedStructure,
  piece: TerrainPiece
): void {
  const gx = ox + (group.offset?.x ?? 0) * scale.x;
  const gz = oz + (group.offset?.z ?? 0) * scale.z;
  const box = (b: TerrainBox): TerrainBox => ({
    minX: gx + b.minX * scale.x,
    maxX: gx + b.maxX * scale.x,
    minY: b.minY * scale.y,
    maxY: b.maxY * scale.y,
    minZ: gz + b.minZ * scale.z,
    maxZ: gz + b.maxZ * scale.z,
  });
  for (const s of group.solids ?? []) {
    out.solids.push({
      ...s,
      ...box(s),
      isObstacle: (s.isObstacle ?? true) && piece.isObstacle,
      blocksLineOfSight: (s.blocksLineOfSight ?? true) && piece.blocksLineOfSight,
      providesCover: (s.providesCover ?? true) && piece.providesCover,
    });
  }
  for (const a of group.apertures ?? []) {
    out.apertures.push({ ...a, ...box(a), providesCover: (a.providesCover ?? true) && piece.providesCover });
  }
  for (const child of group.groups ?? []) flatten(child, scale, gx, gz, out, piece);
}

/**
 * Resolve a terrain piece into world-independent boxes (inches, piece-local frame).
 * Uses the piece's own `structure` override, then the catalog definition for its `terrainType`,
 * and otherwise falls back to a single solid box matching the piece's scale and flags.
 */
export function resolveTerrainStructure(piece: TerrainPiece): ResolvedStructure {
  const scale = {
    x: Math.max(0.05, piece.scale.x),
    y: piece.scale.y ?? 1.0,
    z: Math.max(0.05, piece.scale.z),
  };
  const group = piece.structure ?? TERRAIN_STRUCTURES[piece.terrainType];
  // Fallback: one solid body matching the piece's footprint.
  const fx = 0.5;
  const body: TerrainGroup = group ?? {
    id: `${piece.id}-body`,
    solids: [{ id: `${piece.id}-body`, minX: -fx, maxX: fx, minY: 0, maxY: 1, minZ: -fx, maxZ: fx }],
  };

  const key = piece.structure
    ? null
    : `${piece.terrainType}|${scale.x}|${scale.y}|${scale.z}|${piece.isObstacle ? 1 : 0}${piece.blocksLineOfSight ? 1 : 0}${piece.providesCover ? 1 : 0}`;
  if (key) {
    const hit = cache.get(key);
    if (hit) return hit;
  }

  const out: ResolvedStructure = { solids: [], apertures: [] };
  flatten(body, scale, 0, 0, out, piece);
  if (key) {
    if (cache.size > 500) cache.clear();
    cache.set(key, out);
  }
  return out;
}

/** Transform a world point into a terrain piece's local frame (y relative to the piece base). */
export function worldToLocal(piece: TerrainPiece, p: Vector3): Vector3 {
  const yaw = piece.rotation.y || 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const dx = p.x - piece.position.x;
  const dz = p.z - piece.position.z;
  return { x: dx * cos - dz * sin, y: (p.y ?? 0) - (piece.position.y ?? 0), z: dx * sin + dz * cos };
}

/**
 * Intersect the segment a -> b (both in the same local frame) with a box.
 * Returns the entry/exit parameters s in [0, 1] along the segment, or null if it misses.
 */
export function segmentBoxIntersection(
  a: Vector3,
  b: Vector3,
  box: TerrainBox
): { s0: number; s1: number } | null {
  let s0 = 0;
  let s1 = 1;
  const axes: Array<[number, number, number, number]> = [
    [a.x, b.x - a.x, box.minX, box.maxX],
    [a.y, b.y - a.y, box.minY, box.maxY],
    [a.z, b.z - a.z, box.minZ, box.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t0 = (lo - o) / d;
    let t1 = (hi - o) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    s0 = Math.max(s0, t0);
    s1 = Math.min(s1, t1);
    if (s0 > s1) return null;
  }
  return { s0, s1 };
}

/** Distance on the XZ plane from a world point to the nearest point of a local box (0 if inside). */
export function distanceToBoxXZ(piece: TerrainPiece, box: TerrainBox, x: number, z: number): number {
  const l = worldToLocal(piece, { x, y: 0, z });
  const cx = Math.max(box.minX, Math.min(l.x, box.maxX));
  const cz = Math.max(box.minZ, Math.min(l.z, box.maxZ));
  return Math.hypot(l.x - cx, l.z - cz);
}

/**
 * Whether a model (its base edge) is within MANNING_REACH of a box. Squads are tested per model
 * so any member at the port counts.
 */
export function isManningBox(
  piece: TerrainPiece,
  box: TerrainBox,
  unit: Pick<Unit, 'position'> & { models?: Unit['models'] }
): boolean {
  const reach = MANNING_REACH + UNIT_BASE_RADIUS;
  const points: Vector3[] = (unit.models ?? [])
    .filter((m) => !m.isDestroyed && m.position)
    .map((m) => m.position as Vector3);
  if (points.length === 0) points.push(unit.position);
  return points.some((pt) => distanceToBoxXZ(piece, box, pt.x, pt.z) <= reach);
}

/** Transform a local XZ coordinate on a terrain piece to world board coordinates. */
export function localToWorldXZ(piece: TerrainPiece, lx: number, lz: number): { x: number; z: number } {
  const yaw = piece.rotation.y || 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: piece.position.x + lx * cos + lz * sin,
    z: piece.position.z - lx * sin + lz * cos,
  };
}
