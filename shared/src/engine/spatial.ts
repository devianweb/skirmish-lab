import { GameState, TerrainPiece, Unit } from '../gameTypes';
import { Vector3 } from '../types';
import { hasTrait } from '../rules/traits';
import {
  EYE_HEIGHT,
  FLANK_RAY_HEIGHT,
  TARGET_SAMPLE_HEIGHTS,
  isManningBox,
  localToWorldXZ,
  resolveTerrainStructure,
  distanceToBoxXZ,
  segmentBoxIntersection,
  worldToLocal,
} from './terrainStructure';

import { classifySegment, CLIMB_MAX, FREE_DROP_MAX, pathMovementCost } from './traversal';
import { isClimbable } from '../data/mapSchema';

export * from './terrainStructure';

/**
 * Pure 2D spatial geometry on the XZ board plane for movement collision,
 * obstacle clamping, OPR-style Line of Sight (LoS), and visibility fan
 * computation. Shared between the host rules engine and the client renderer
 * so visual LoS shadows and path clamping match host validation identically.
 */

/** Base collision radius of a fighter for movement blocking (board units: 1.0" base -> 0.45" radius). */
export const UNIT_COLLISION_RADIUS = 0.45;
/** Points sampled round a base to test that it is fully supported (`isBaseOverhanging`). */
const BASE_SUPPORT_SAMPLES = 16;
/** Slack so a base placed exactly at its radius from an edge (after 0.01" rounding) still counts as supported. */
const BASE_SUPPORT_TOLERANCE = 0.02;
/** Minimum center-to-center distance between two fighters during movement (1.0" base contact). */
export const UNIT_SEPARATION_DISTANCE = 1.0;
/** Base radius of a fighter for Line of Sight blocking (board units). */
export const LOS_UNIT_RADIUS = 0.4;
/** How far a ladder's foot/head standing spots sit off its position along local Z (base radius 0.5 + 0.05 clearance). */
export const LADDER_STANDOFF = 0.55;
/** How far past a floor edge a model steps (base radius 0.5 + 0.05 clearance) so its whole base is clear before it drops. */
export const DROP_STANDOFF = 0.55;

/** Local XZ half-extents of a terrain piece before rotation. */
export function terrainHalfExtents(piece: TerrainPiece): { hx: number; hz: number } {
  const sx = Math.max(0.05, piece.scale.x);
  const sz = Math.max(0.05, piece.scale.z);
  if (
    piece.terrainType === 'wall' ||
    piece.terrainType === 'wall-long' ||
    piece.terrainType === 'wall-window' ||
    piece.terrainType === 'wall-doorway'
  ) {
    return { hx: 0.5 * sx, hz: 0.5 * sz };
  }
  return { hx: 0.5 * sx, hz: 0.5 * sz };
}

export interface TerrainDebugInfo {
  id: string;
  terrainType: string;
  modelFile: string;
  rawGlbSize: string;
  position: Vector3;
  scale: Vector3;
  rotationDeg: number;
  halfExtents: { hx: number; hz: number };
  worldFootprint: { width: number; depth: number };
  blocksLineOfSight: boolean;
  isObstacle: boolean;
  providesCover: boolean;
}

const TERRAIN_MODEL_META: Record<string, { modelFile: string; rawGlbSize: string }> = {
  wall: { modelFile: 'models/wall.glb', rawGlbSize: '0.2 × 1.0 × 1.0 (normalized to 1×1×1)' },
  'wall-window': {
    modelFile: 'models/wall-window-medium.glb',
    rawGlbSize: '0.3 × 1.0 × 1.0 (normalized to 1×1×1)',
  },
  'wall-doorway': {
    modelFile: 'models/wall-doorway.glb',
    rawGlbSize: '0.3 × 1.0 × 1.0 (normalized to 1×1×1)',
  },
  crate: { modelFile: 'models/crate.glb', rawGlbSize: '0.5 × 0.5 × 0.5 (×1.4 = 0.7×0.7×0.7)' },
  column: { modelFile: 'models/column.glb', rawGlbSize: '0.2 × 1.0 × 0.2 (×2.5 XZ = 0.5×1.0×0.5)' },
};

/** Build human-readable debug metadata for a terrain piece (model, bounds, flags). */
export function describeTerrainPiece(piece: TerrainPiece): TerrainDebugInfo {
  const { hx, hz } = terrainHalfExtents(piece);
  const meta = TERRAIN_MODEL_META[piece.terrainType] ?? {
    modelFile: '(procedural 1×1×1 block)',
    rawGlbSize: '1.0 × 1.0 × 1.0',
  };
  const rotationDeg = Math.round(((piece.rotation.y || 0) * 180) / Math.PI);
  return {
    id: piece.id,
    terrainType: piece.terrainType,
    modelFile: meta.modelFile,
    rawGlbSize: meta.rawGlbSize,
    position: piece.position,
    scale: piece.scale,
    rotationDeg,
    halfExtents: { hx, hz },
    worldFootprint: { width: hx * 2, depth: hz * 2 },
    blocksLineOfSight: piece.blocksLineOfSight,
    isObstacle: piece.isObstacle,
    providesCover: piece.providesCover,
  };
}

/**
 * The legacy whole-footprint elevation of a piece (older maps flag a piece `isWalkable` + `elevation`).
 * Ignored for pieces whose structure defines walkable solids (their floors come from the boxes), and
 * for `elevation <= 0`, which just means ground level.
 */
export function legacyElevation(piece: TerrainPiece): number | undefined {
  if (piece.elevation === undefined || piece.elevation <= 0) return undefined;
  if (resolveTerrainStructure(piece).solids.some((solid) => solid.walkable)) return undefined;
  return piece.elevation;
}

/** True if the piece's structure has at least one walkable solid (deck, catwalk, ledge, roof). */
export function hasStructuredFloor(piece: TerrainPiece): boolean {
  return resolveTerrainStructure(piece).solids.some((solid) => solid.walkable);
}

/**
 * Find the terrain piece whose 2D oriented bounding box (plus a small hover
 * margin) contains `point` on the XZ board plane.
 */
export function findTerrainAtPosition(
  state: GameState,
  point: Vector3,
  margin: number = 0.15
): TerrainPiece | null {
  let bestPiece: TerrainPiece | null = null;
  let minVertDiff = Infinity;

  for (const piece of state.terrain) {
    const { hx, hz } = terrainHalfExtents(piece);
    const yaw = piece.rotation.y || 0;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const dx = point.x - piece.position.x;
    const dz = point.z - piece.position.z;
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    if (Math.abs(localX) <= hx + margin && Math.abs(localZ) <= hz + margin) {
      if (point.y === undefined) {
        return piece;
      }
      const pieceBaseY = piece.position.y ?? 0;
      const pieceHeight = piece.scale.y ?? 1.0;
      const pieceTopY = legacyElevation(piece) ?? pieceBaseY + pieceHeight;

      if (point.y >= pieceBaseY - 0.25 && point.y <= pieceTopY + 0.6) {
        const vertDiff = Math.abs(point.y - pieceTopY);
        if (vertDiff < minVertDiff) {
          minVertDiff = vertDiff;
          bestPiece = piece;
        }
      } else if (!bestPiece) {
        bestPiece = piece;
      }
    }
  }
  return bestPiece;
}

/**
 * Intersect a 2D ray `origin + t * (dirX, dirZ)` (`0 <= t <= maxDist`) with a
 * terrain piece's oriented bounding box (expanded by `margin`).
 */
export function intersectRayTerrain(
  origin: Vector3,
  dirX: number,
  dirZ: number,
  maxDist: number,
  piece: TerrainPiece,
  margin: number = 0
): { tEntry: number; tExit: number } | null {
  const { hx: baseHx, hz: baseHz } = terrainHalfExtents(piece);
  const hx = baseHx + margin;
  const hz = baseHz + margin;

  const yaw = piece.rotation.y || 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);

  const dx = origin.x - piece.position.x;
  const dz = origin.z - piece.position.z;

  // Transform ray origin and direction into the terrain piece's local XZ space.
  const localOx = dx * cos - dz * sin;
  const localOz = dx * sin + dz * cos;
  const localDx = dirX * cos - dirZ * sin;
  const localDz = dirX * sin + dirZ * cos;

  return intersectLocalBox(localOx, localOz, localDx, localDz, -hx, hx, -hz, hz, maxDist);
}

/**
 * Test intersection of a ray in local coordinates with an axis-aligned box [minX, maxX] x [minZ, maxZ].
 */
export function intersectLocalBox(
  localOx: number,
  localOz: number,
  localDx: number,
  localDz: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  maxDist: number
): { tEntry: number; tExit: number } | null {
  let tMin = 0;
  let tMax = maxDist;

  if (Math.abs(localDx) < 1e-8) {
    if (localOx < minX || localOx > maxX) return null;
  } else {
    const t1 = (minX - localOx) / localDx;
    const t2 = (maxX - localOx) / localDx;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
    if (tMin > tMax) return null;
  }

  if (Math.abs(localDz) < 1e-8) {
    if (localOz < minZ || localOz > maxZ) return null;
  } else {
    const t1 = (minZ - localOz) / localDz;
    const t2 = (maxZ - localOz) / localDz;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
    if (tMin > tMax) return null;
  }

  if (tMax < 0 || tMin > maxDist) return null;
  return { tEntry: Math.max(0, tMin), tExit: Math.min(maxDist, tMax) };
}

/**
 * Intersect a 2D ray `origin + t * (dirX, dirZ)` (`0 <= t <= maxDist`) with a
 * circle on the XZ plane.
 */
export function intersectRayCircle(
  origin: Vector3,
  dirX: number,
  dirZ: number,
  maxDist: number,
  center: Vector3,
  radius: number
): { tEntry: number; tExit: number } | null {
  const fx = origin.x - center.x;
  const fz = origin.z - center.z;
  const b = fx * dirX + fz * dirZ;
  const c = fx * fx + fz * fz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;

  const sqrtDisc = Math.sqrt(disc);
  const t1 = -b - sqrtDisc;
  const t2 = -b + sqrtDisc;
  if (t2 < 0 || t1 > maxDist) return null;

  return {
    tEntry: Math.max(0, t1),
    tExit: Math.min(maxDist, t2),
  };
}

/**
 * True if a straight vertical drop from `from` down to `to` (same x/z) would pass through terrain:
 * a base circle of `UNIT_COLLISION_RADIUS` swept down the column must not overlap any solid whose
 * vertical span lies in the fall, nor the stair wedge. The floor being landed on (top at the landing
 * height) and ladders do not count; the floor being stepped off does, until the circle is clear of it.
 */
export function isFallColumnBlocked(state: GameState, from: Vector3, to: Vector3): boolean {
  const topY = from.y ?? 0;
  const botY = to.y ?? 0;
  if (topY - botY <= 0.5) return false;
  const r = UNIT_COLLISION_RADIUS;
  const lo = botY + 0.05;
  const hi = topY - 0.05;

  for (const piece of state.terrain) {
    if (isLadderPiece(piece)) continue;

    if (isStairPiece(piece)) {
      const { hx, hz } = terrainHalfExtents(piece);
      const yaw = piece.rotation.y || 0;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const dxp = from.x - piece.position.x;
      const dzp = from.z - piece.position.z;
      const lx = dxp * cos + dzp * sin;
      const lz = -dxp * sin + dzp * cos;
      const outX = Math.max(0, Math.abs(lx) - hx);
      if (outX >= r) continue;
      const half = Math.sqrt(r * r - outX * outX);
      // Is the head end (higher side) toward +lz or -lz? Same rule as getStairSurfaceHeight.
      const wp = getStairWaypoints(state, piece);
      const flz = -(wp.foot.x - piece.position.x) * sin + (wp.foot.z - piece.position.z) * cos;
      const headSign = flz > 0 ? -1 : 1;
      const lzMin = Math.max(-hz, lz - half);
      const lzMax = Math.min(hz, lz + half);
      if (lzMin >= lzMax) continue;
      const headLz = headSign > 0 ? lzMax : lzMin;
      if (stairHeightAtLocalZ(piece, wp, headLz, hz) > lo) return true;
      continue;
    }

    const baseY = piece.position.y ?? 0;
    const local = worldToLocal(piece, from);
    for (const solid of resolveTerrainStructure(piece).solids) {
      // Obstacles and walkable floors are solid to a falling model; decorative boxes are not.
      if (!solid.isObstacle && !solid.walkable) continue;
      if (baseY + solid.minY >= hi || baseY + solid.maxY <= lo) continue;
      const cx = Math.max(solid.minX, Math.min(local.x, solid.maxX));
      const cz = Math.max(solid.minZ, Math.min(local.z, solid.maxZ));
      if (Math.hypot(local.x - cx, local.z - cz) < r) return true;
    }
  }
  return false;
}

/** Height of a stair's slope surface at local z (strictly inside the footprint), given its waypoints. */
function stairHeightAtLocalZ(
  piece: TerrainPiece,
  wp: { foot: Vector3; head: Vector3 },
  lz: number,
  hz: number
): number {
  const botY = piece.position.y ?? 0;
  const topY = legacyElevation(piece) ?? botY + (piece.scale.y ?? 2.5);
  const yaw = piece.rotation.y || 0;
  const flz =
    -(wp.foot.x - piece.position.x) * Math.sin(yaw) + (wp.foot.z - piece.position.z) * Math.cos(yaw);
  const footLz = flz > 0 ? hz : -hz;
  const headLz = -footLz;
  const t = Math.max(0, Math.min(1, (lz - footLz) / (headLz - footLz)));
  return botY + t * (topY - botY);
}

/**
 * Check whether a movement path for `movingUnit` is blocked by obstacle
 * terrain (`isObstacle`) or by any other living fighter on the board.
 */
export function findMoveBlocker(
  state: GameState,
  movingUnit: Unit,
  path: Vector3[],
  options: { ignoreUnitId?: string } = {}
): { blocked: true; reason: string } | { blocked: false } {
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1];
    const to = path[i];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const segLen = Math.hypot(dx, dz);
    if (segLen < 1e-6) {
      // A vertical drop has no horizontal length: sweep the base circle down the fall column instead.
      if (isFallColumnBlocked(state, from, to)) {
        return { blocked: true, reason: 'Move path is blocked: a drop needs clear air below the base' };
      }
      continue;
    }
    const dirX = dx / segLen;
    const dirZ = dz / segLen;

    const fromY = from.y ?? 0;
    const toY = to.y ?? 0;
    const minSegY = Math.min(fromY, toY);
    const maxSegY = Math.max(fromY, toY);
    const isOnStairs = isSegmentOnRampOrStairs(state, from, to);

    // A near-vertical descent that is not on stairs or a ladder is a drop: the base must be clear of
    // everything below at the take-off spot and at the landing spot (it steps off first, then falls).
    if (fromY - toY > 0.5 && segLen <= 0.7 && !isOnStairs) {
      if (
        isFallColumnBlocked(state, from, to) ||
        isFallColumnBlocked(state, { x: to.x, y: fromY, z: to.z }, to)
      ) {
        return { blocked: true, reason: 'Move path is blocked: a drop needs clear air below the base' };
      }
    }

    for (const piece of state.terrain) {
      if (isStairPiece(piece)) {
        if (isOnStairs) {
          continue;
        }
        // Check if movement segment intersects the solid triangular wedge body of the stairs
        const hit = intersectRayTerrain(from, dirX, dirZ, segLen, piece, UNIT_COLLISION_RADIUS);
        if (hit && hit.tExit > 0.02 && (hit.tEntry > 0.001 || hit.tExit >= segLen - 0.02)) {
          const entryT = Math.max(0, hit.tEntry);
          const entryX = from.x + dirX * entryT;
          const entryZ = from.z + dirZ * entryT;
          const entryY = fromY + (toY - fromY) * (segLen > 1e-6 ? entryT / segLen : 0);
          const slopeY = getStairSurfaceHeight(piece, { x: entryX, y: entryY, z: entryZ }, state);
          if (slopeY !== null && entryY < slopeY - 0.15) {
            return { blocked: true, reason: 'Move path is blocked by stairs' };
          }
        }
        // A segment that starts on the slope can still dive into the body (e.g. mid-slope straight down
        // to the ground at the head end): sample the part inside the footprint.
        const { hx, hz } = terrainHalfExtents(piece);
        const yawS = piece.rotation.y || 0;
        const cosS = Math.cos(yawS);
        const sinS = Math.sin(yawS);
        const t1 = hit ? Math.min(segLen, hit.tExit) : -1;
        for (let t = hit ? Math.max(0, hit.tEntry) : 0; t <= t1 + 1e-6; t += 0.1) {
          const px = from.x + dirX * t;
          const pz = from.z + dirZ * t;
          const py = fromY + (toY - fromY) * (t / segLen);
          const ddx = px - piece.position.x;
          const ddz = pz - piece.position.z;
          const plx = ddx * cosS + ddz * sinS;
          const plz = -ddx * sinS + ddz * cosS;
          if (Math.abs(plx) >= hx - 0.05 || Math.abs(plz) >= hz - 0.05) continue;
          const sY = getStairSurfaceHeight(piece, { x: px, y: py, z: pz }, state);
          if (sY !== null && py < sY - 0.15) {
            return { blocked: true, reason: 'Move path is blocked by stairs' };
          }
        }
        continue;
      }

      if (!piece.isObstacle) continue;

      if (isOnStairs) {
        // Stairs, ladders, and ramps: do not block segments traversing them
        if (
          piece.climbType === 'stairs' ||
          piece.climbType === 'ladder' ||
          piece.climbType === 'ramp' ||
          piece.terrainType?.includes('stairs') ||
          piece.terrainType?.includes('ladder')
        ) {
          continue;
        }

        const pieceBaseY = piece.position.y ?? 0;
        const pieceHeight = piece.scale.y ?? 1.0;
        const pieceTopY = legacyElevation(piece) ?? pieceBaseY + pieceHeight;

        // If the stair segment connects to the top/roof level of this landing piece
        if (maxSegY >= pieceTopY - 0.25) {
          continue;
        }

        // Low walls or parapet railings at stair access points do not block access
        if (piece.terrainType === 'wall-low' || piece.terrainType?.includes('wall')) {
          continue;
        }
      }

      const pieceBaseY = piece.position.y ?? 0;
      const pieceHeight = piece.scale.y ?? 1.0;
      const pieceTopY = legacyElevation(piece) ?? pieceBaseY + pieceHeight;

      // 1. If piece is walkable or an elevated platform, moving on top does not collide with the obstacle
      if (piece.isWalkable || legacyElevation(piece) !== undefined) {
        if (minSegY >= (legacyElevation(piece) ?? pieceTopY) - 0.15) {
          continue;
        }
      }

      // 2. If movement is entirely above the obstacle (e.g. moving across an elevated walkway or jumping)
      if (minSegY >= pieceTopY - 0.05) {
        continue;
      }

      // 3. If obstacle is entirely overhead (e.g. high overhead pipe or roof above standard model height ~1.2")
      if (pieceBaseY >= maxSegY + 1.2) {
        continue;
      }

      const broadHit = intersectRayTerrain(from, dirX, dirZ, segLen, piece, UNIT_COLLISION_RADIUS);
      if (!broadHit) continue;

      const parts = resolveTerrainStructure(piece).solids;
      const yaw = piece.rotation.y || 0;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const pDx = from.x - piece.position.x;
      const pDz = from.z - piece.position.z;
      const localOx = pDx * cos - pDz * sin;
      const localOz = pDx * sin + pDz * cos;
      const localDx = dirX * cos - dirZ * sin;
      const localDz = dirX * sin + dirZ * cos;

      for (const part of parts) {
        if (!part.isObstacle) continue;

        const partBaseY = pieceBaseY + part.minY;
        const partTopY = pieceBaseY + part.maxY;
        if (minSegY >= partTopY - 0.05) continue;
        if (partBaseY >= maxSegY + 1.2) continue;

        const margin = UNIT_COLLISION_RADIUS;
        const hit = intersectLocalBox(
          localOx,
          localOz,
          localDx,
          localDz,
          part.minX - margin,
          part.maxX + margin,
          part.minZ - margin,
          part.maxZ + margin,
          segLen
        );
        if (hit && hit.tExit > 0.02 && (hit.tEntry > 0.001 || hit.tExit >= segLen - 0.02)) {
          return { blocked: true, reason: 'Move path is blocked by terrain' };
        }
      }
    }

    for (const other of state.units) {
      if (other.isDestroyed || other.id === movingUnit.id || other.id === options.ignoreUnitId) {
        continue;
      }
      const otherModels = other.models && other.models.length > 0
        ? other.models.filter((m) => !m.isDestroyed)
        : [{ position: other.position }];

      for (const m of otherModels) {
        const mPos = m.position ?? other.position;
        const otherY = mPos.y ?? other.position.y ?? 0;
        // Fighters on separate vertical tiers (> 1.8" difference) don't block each other
        if (Math.abs(minSegY - otherY) >= 1.8 && Math.abs(maxSegY - otherY) >= 1.8) {
          continue;
        }

        const hit = intersectRayCircle(
          from,
          dirX,
          dirZ,
          segLen,
          mPos,
          UNIT_SEPARATION_DISTANCE
        );
        const endDist = Math.hypot(to.x - mPos.x, to.z - mPos.z);
        if (
          endDist < UNIT_SEPARATION_DISTANCE - 0.01 ||
          (hit && hit.tExit > 0.02 && hit.tEntry > 0.001)
        ) {
          return { blocked: true, reason: 'Move path is blocked by another fighter' };
        }
      }
    }
  }
  return { blocked: false };
}

/**
 * Clamp a straight-line move destination from `unit.position` toward `raw` so
 * that it stays within `maxDistance`, inside the board, and stops cleanly in
 * front of the first obstacle terrain piece or fighter along the ray.
 */
export function clampMoveDestinationWithObstacles(
  state: GameState,
  unit: Unit,
  raw: Vector3,
  maxDistance: number = unit.remainingMovement
): Vector3 {
  const startY = unit.position.y ?? 0;
  const rawY = raw.y ?? startY;
  const dx = raw.x - unit.position.x;
  const dy = rawY - startY;
  const dz = raw.z - unit.position.z;
  const rawDist = Math.hypot(dx, dy, dz);
  const maxMove = Math.max(0, maxDistance);

  let x = raw.x;
  let y = rawY;
  let z = raw.z;
  if (rawDist > maxMove && rawDist > 0) {
    const ratio = maxMove / rawDist;
    x = unit.position.x + dx * ratio;
    y = startY + dy * ratio;
    z = unit.position.z + dz * ratio;
  }

  const halfW = (state.board.width * state.board.gridSize) / 2;
  const halfH = (state.board.height * state.board.gridSize) / 2;
  x = Math.max(-halfW, Math.min(halfW, x));
  z = Math.max(-halfH, Math.min(halfH, z));

  const clampedDx = x - unit.position.x;
  const clampedDz = z - unit.position.z;
  const segLen = Math.hypot(clampedDx, clampedDz);
  if (segLen > 1e-6) {
    const dirX = clampedDx / segLen;
    const dirZ = clampedDz / segLen;
    let allowedDist = segLen;

    for (const piece of state.terrain) {
      if (isStairPiece(piece)) {
        const segOnStairs = isSegmentOnRampOrStairs(state, unit.position, { x, y, z });
        if (segOnStairs) {
          continue;
        }
        // Check if movement segment intersects the solid triangular wedge body of the stairs
        const hit = intersectRayTerrain(unit.position, dirX, dirZ, allowedDist, piece, UNIT_COLLISION_RADIUS);
        if (hit && hit.tExit > 0.02 && (hit.tEntry > 0.001 || hit.tExit >= allowedDist - 0.02)) {
          const entryT = Math.max(0, hit.tEntry);
          const entryX = unit.position.x + dirX * entryT;
          const entryZ = unit.position.z + dirZ * entryT;
          const entryY = startY + (y - startY) * (segLen > 1e-6 ? entryT / segLen : 0);
          const slopeY = getStairSurfaceHeight(piece, { x: entryX, y: entryY, z: entryZ }, state);
          if (slopeY !== null && entryY < slopeY - 0.15) {
            allowedDist = Math.min(allowedDist, Math.max(0, entryT - 0.05));
          }
        }
        continue;
      }

      if (!piece.isObstacle) continue;
      const pieceBaseY = piece.position.y ?? 0;
      const pieceHeight = piece.scale.y ?? 1.0;
      const pieceTopY = legacyElevation(piece) ?? pieceBaseY + pieceHeight;

      if (piece.isWalkable || legacyElevation(piece) !== undefined) {
        if (Math.min(startY, y) >= (legacyElevation(piece) ?? pieceTopY) - 0.15) {
          continue;
        }
      }
      if (Math.min(startY, y) >= pieceTopY - 0.05) {
        continue;
      }
      if (pieceBaseY >= Math.max(startY, y) + 1.2) {
        continue;
      }

      const broadHit = intersectRayTerrain(
        unit.position,
        dirX,
        dirZ,
        allowedDist,
        piece,
        UNIT_COLLISION_RADIUS
      );
      if (!broadHit) continue;

      const parts = resolveTerrainStructure(piece).solids;
      const yaw = piece.rotation.y || 0;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const pDx = unit.position.x - piece.position.x;
      const pDz = unit.position.z - piece.position.z;
      const localOx = pDx * cos - pDz * sin;
      const localOz = pDx * sin + pDz * cos;
      const localDx = dirX * cos - dirZ * sin;
      const localDz = dirX * sin + dirZ * cos;

      for (const part of parts) {
        if (!part.isObstacle) continue;

        const partBaseY = pieceBaseY + part.minY;
        const partTopY = pieceBaseY + part.maxY;
        if (Math.min(startY, y) >= partTopY - 0.05) continue;
        if (partBaseY >= Math.max(startY, y) + 1.2) continue;

        const margin = UNIT_COLLISION_RADIUS;
        const hit = intersectLocalBox(
          localOx,
          localOz,
          localDx,
          localDz,
          part.minX - margin,
          part.maxX + margin,
          part.minZ - margin,
          part.maxZ + margin,
          allowedDist
        );
        if (hit && hit.tExit > 0.02 && hit.tEntry > 0.001) {
          allowedDist = Math.min(allowedDist, Math.max(0, hit.tEntry - 0.05));
        }
      }
    }

    for (const other of state.units) {
      if (other.isDestroyed || other.id === unit.id) continue;
      const otherY = other.position.y ?? 0;
      if (Math.abs(startY - otherY) >= 1.8 && Math.abs(y - otherY) >= 1.8) {
        continue;
      }
      const hit = intersectRayCircle(
        unit.position,
        dirX,
        dirZ,
        allowedDist,
        other.position,
        UNIT_SEPARATION_DISTANCE
      );
      if (hit && hit.tExit > 0.02 && hit.tEntry > 0.001) {
        allowedDist = Math.min(allowedDist, Math.max(0, hit.tEntry - 0.05));
      }
    }

    if (allowedDist < segLen) {
      const frac = allowedDist / segLen;
      x = unit.position.x + dirX * allowedDist;
      y = startY + (y - startY) * frac;
      z = unit.position.z + dirZ * allowedDist;
    }
  }

  // Snap y to walkable surface if point is on a platform
  const candPoint = { x, y, z };
  const surface = findWalkableSurfaceAt(state, candPoint);
  if (surface && y >= surface.topY - 0.5) {
    y = surface.topY;
  } else if (!surface && y < 0.5) {
    y = 0;
  }

  return {
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    z: Math.round(z * 100) / 100,
  };
}

/** A standable floor: a footprint (piece-local XZ box) and the height of its top face. */
export interface WalkableSurface {
  piece: TerrainPiece;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  topY: number;
}

/**
 * Standable floors of a piece. Structured pieces expose their `walkable` solids (deck, catwalk,
 * ruin ledge) at the height of each solid's top face. Legacy pieces flagged walkable/elevated
 * (older saved maps) expose their whole footprint at `elevation`.
 */
export function getWalkableSurfaces(piece: TerrainPiece): WalkableSurface[] {
  const baseY = piece.position.y ?? 0;
  const surfaces: WalkableSurface[] = [];
  for (const solid of resolveTerrainStructure(piece).solids) {
    if (solid.walkable) {
      surfaces.push({
        piece,
        minX: solid.minX,
        maxX: solid.maxX,
        minZ: solid.minZ,
        maxZ: solid.maxZ,
        topY: baseY + solid.maxY,
      });
    }
  }
  if (surfaces.length > 0) return surfaces;

  if (
    piece.isWalkable ||
    piece.terrainType === 'platform' ||
    piece.terrainType === 'floor' ||
    (piece.elevation !== undefined && piece.elevation > 0)
  ) {
    const { hx, hz } = terrainHalfExtents(piece);
    return [
      { piece, minX: -hx, maxX: hx, minZ: -hz, maxZ: hz, topY: legacyElevation(piece) ?? piece.position.y ?? 2.5 },
    ];
  }
  return [];
}

/**
 * The standable floor under `point` (within `margin` of its footprint). With several floors
 * stacked, the one whose top is closest to the point's height wins (highest when y is unknown).
 */
export function findWalkableSurfaceAt(
  state: GameState,
  point: { x: number; z: number; y?: number },
  margin: number = 0.1,
  excludePieceId?: string
): WalkableSurface | null {
  return findWalkableSurfaceIn(collectWalkableSurfaces(state), point, margin, excludePieceId);
}

/** Every standable floor on the board (resolve once, then query many points with `findWalkableSurfaceIn`). */
export function collectWalkableSurfaces(state: GameState): WalkableSurface[] {
  const out: WalkableSurface[] = [];
  for (const piece of state.terrain) out.push(...getWalkableSurfaces(piece));
  return out;
}

/** `findWalkableSurfaceAt` over a pre-collected list of floors (hot loops such as gap sampling). */
export function findWalkableSurfaceIn(
  surfaces: WalkableSurface[],
  point: { x: number; z: number; y?: number },
  margin: number = 0.1,
  excludePieceId?: string
): WalkableSurface | null {
  let best: WalkableSurface | null = null;
  let bestScore = Infinity;
  const probe = { x: point.x, y: 0, z: point.z };
  for (const surface of surfaces) {
    const piece = surface.piece;
    if (piece.id === excludePieceId) continue;
    const l = worldToLocal(piece, probe);
    if (
      l.x >= surface.minX - margin &&
      l.x <= surface.maxX + margin &&
      l.z >= surface.minZ - margin &&
      l.z <= surface.maxZ + margin
    ) {
      const score = point.y === undefined ? -surface.topY : Math.abs(point.y - surface.topY);
      if (score < bestScore) {
        bestScore = score;
        best = surface;
      }
    }
  }
  return best;
}

/**
 * Finds a walkable elevated platform terrain piece at `point`.
 */
export function findWalkablePlatformAt(state: GameState, point: Vector3): TerrainPiece | null {
  return findWalkableSurfaceAt(state, point)?.piece ?? null;
}

/**
 * True if `point` is hanging in mid-air: well above the ground, yet not standing on a floor, a
 * stair/ramp slope, or a ladder (ladders have their own deck-arrival rule).
 */
export function isSuspendedInMidAir(state: GameState, point: Vector3): boolean {
  const y = point.y ?? 0;
  if (y <= 0.3) return false;
  const surface = findWalkableSurfaceAt(state, point, 0.1);
  if (surface && Math.abs(y - surface.topY) <= 0.3) return false;
  for (const piece of state.terrain) {
    if (isStairPiece(piece)) {
      const slopeY = getStairSurfaceHeight(piece, point, state);
      if (slopeY !== null && Math.abs(y - slopeY) <= 0.3) return false;
    }
    if (isLadderPiece(piece) && isOnLadderClimbLine(state, piece, point)) return false; // the ladder deck-arrival rule covers it
  }
  return true;
}

/**
 * True if a model standing at `point` would have its base hanging over open air: elevated, and some part of
 * the base circle (`UNIT_COLLISION_RADIUS`) is not over a walkable floor at the model's height. Floors are
 * taken as a union, so standing across the seam of two flush decks is fine. Ground-level points are not
 * judged here, and a stair slope or a ladder arrival counts as support (they have their own rules). A centre
 * in open air also counts, so this covers `isSuspendedInMidAir` for floors.
 */
export function isBaseOverhanging(
  state: GameState,
  point: Vector3,
  surfaces: WalkableSurface[] = collectWalkableSurfaces(state)
): boolean {
  const y = point.y ?? 0;
  if (y <= 0.3) return false;
  const supportedAt = (x: number, z: number): boolean => {
    const surface = findWalkableSurfaceIn(surfaces, { x, z, y }, BASE_SUPPORT_TOLERANCE);
    if (surface && Math.abs(y - surface.topY) <= 0.3) return true;
    for (const piece of state.terrain) {
      if (!isStairPiece(piece)) continue;
      const slopeY = getStairSurfaceHeight(piece, { x, y, z }, state);
      if (slopeY !== null && Math.abs(y - slopeY) <= 0.3) return true;
    }
    return false;
  };
  if (!supportedAt(point.x, point.z)) {
    // Centre not on a floor: a ladder arrival is judged by its own rule
    return !state.terrain.some((p) => isLadderPiece(p) && isOnLadderClimbLine(state, p, point));
  }
  for (let k = 0; k < BASE_SUPPORT_SAMPLES; k++) {
    const ang = (k / BASE_SUPPORT_SAMPLES) * Math.PI * 2;
    if (!supportedAt(point.x + Math.cos(ang) * UNIT_COLLISION_RADIUS, point.z + Math.sin(ang) * UNIT_COLLISION_RADIUS)) {
      return true;
    }
  }
  return false;
}

/** Two models of different units closer than this (centre to centre, at a similar height) overlap. */
export const MODEL_OVERLAP_DISTANCE = 0.9;
/** Lets a base that stops exactly at the movement clearance (`UNIT_COLLISION_RADIUS`) count as clear. */
const OVERLAP_TOLERANCE = 0.02;

export type EndOverlap =
  | { kind: 'terrain'; pieceId: string; solidId?: string }
  | { kind: 'model'; unitId: string };

/**
 * What a model standing at `point` would overlap, or null. Terrain: the base circle (`UNIT_COLLISION_RADIUS`)
 * intersects an obstacle solid whose height span overlaps the model body (`y + 0.15` to `y + EYE_HEIGHT`), so the
 * floor stood on and lintels overhead don't count. Other models: any living model of another unit within
 * `MODEL_OVERLAP_DISTANCE` at a similar height. Stairs and ladders are skipped (they have their own rules).
 */
export function findEndOverlap(state: GameState, unitId: string, point: Vector3): EndOverlap | null {
  const y = point.y ?? 0;
  const bodyLo = y + 0.15;
  const bodyHi = y + EYE_HEIGHT;
  for (const piece of state.terrain) {
    if (isLadderPiece(piece) || isStairPiece(piece)) continue;
    const baseY = piece.position.y ?? 0;
    // Legacy raised pieces (saved maps with an elevation): standing on the top is not an overlap
    const legacyTop = legacyElevation(piece);
    if (legacyTop !== undefined && y >= legacyTop - 0.15) continue;
    for (const solid of resolveTerrainStructure(piece).solids) {
      if (!solid.isObstacle) continue;
      if (baseY + solid.maxY <= bodyLo || baseY + solid.minY >= bodyHi) continue;
      if (distanceToBoxXZ(piece, solid, point.x, point.z) < UNIT_COLLISION_RADIUS - OVERLAP_TOLERANCE) {
        return { kind: 'terrain', pieceId: piece.id, solidId: solid.id };
      }
    }
  }
  for (const other of state.units) {
    if (other.isDestroyed || other.id === unitId) continue;
    const models =
      other.models && other.models.length > 0
        ? other.models.filter((m) => !m.isDestroyed).map((m) => m.position ?? other.position)
        : [other.position];
    for (const pos of models) {
      if (Math.abs((pos.y ?? 0) - y) >= 1.0) continue;
      if (Math.hypot(pos.x - point.x, pos.z - point.z) < MODEL_OVERLAP_DISTANCE) {
        return { kind: 'model', unitId: other.id };
      }
    }
  }
  return null;
}

/** Player-facing rejection text for an end overlap. */
export function describeEndOverlap(o: EndOverlap): string {
  return o.kind === 'terrain'
    ? 'Models cannot end movement overlapping terrain - stop short of it'
    : 'Models cannot end movement overlapping another model - stop short of it';
}

/**
 * Pull a path's end back to the first point that doesn't overlap terrain or another model, walking back along
 * the path in 0.05" steps (across segments). Never returns a point further along the path; if nothing is clear
 * it returns just the start.
 */
export function settleMoveEnd(state: GameState, unit: Unit, path: Vector3[]): Vector3[] {
  return pullBackEnd(path, (pt) => findEndOverlap(state, unit.id, pt) !== null);
}

/**
 * Shortens a path's end until `bad` is false: walks back along the last segment (then earlier ones) in 0.05"
 * steps, never forward. A straight climb or drop (`isSheer`) is all or nothing.
 */
function pullBackEnd(
  path: Vector3[],
  bad: (pt: Vector3) => boolean,
  isSheer: (a: Vector3, b: Vector3) => boolean = (a, b) =>
    Math.abs((b.y ?? 0) - (a.y ?? 0)) > 0.5 && Math.hypot(b.x - a.x, b.z - a.z) < 0.1
): Vector3[] {
  if (path.length < 2) return path;
  const out = path.map((p) => ({ ...p }));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  while (out.length > 1 && bad(out[out.length - 1])) {
    const a = out[out.length - 2];
    const b = out[out.length - 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, (b.y ?? 0) - (a.y ?? 0), b.z - a.z) / 0.05));
    let found: Vector3 | null = null;
    const sheer = isSheer(a, b);
    for (let k = steps - 1; !sheer && k >= 1; k--) {
      const t = k / steps;
      const pt = {
        x: r2(a.x + (b.x - a.x) * t),
        y: r2((a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * t),
        z: r2(a.z + (b.z - a.z) * t),
      };
      if (!bad(pt)) {
        found = pt;
        break;
      }
    }
    if (found) {
      out[out.length - 1] = found;
      break;
    }
    out.pop();
  }
  return out;
}

/**
 * True if `point` is on the ladder's climb line: directly above the foot (within `tolerance` horizontally)
 * at a height between just above the ground and the top of the climb.
 */
export function isOnLadderClimbLine(state: GameState, ladder: TerrainPiece, point: Vector3, tolerance = 0.3): boolean {
  const { foot, head } = getStairWaypoints(state, ladder);
  if (Math.hypot(point.x - foot.x, point.z - foot.z) > tolerance) return false;
  const y = point.y ?? 0;
  return y > foot.y + 0.2 && y <= head.y + 0.05;
}

/**
 * True if `a` -> `b` is the free level step between the top of a ladder's climb line and its head spot
 * (either direction). Like on the tabletop, the shuffle on or off the ladder isn't measured.
 */
export function isLadderStepSegment(state: GameState, a: Vector3, b: Vector3): boolean {
  if (Math.abs((a.y ?? 0) - (b.y ?? 0)) > 0.05) return false;
  for (const piece of state.terrain) {
    if (!isLadderPiece(piece)) continue;
    const { foot, head } = getStairWaypoints(state, piece);
    if (Math.abs((a.y ?? 0) - head.y) > 0.05) continue;
    const near = (p: Vector3, q: Vector3) => Math.hypot(p.x - q.x, p.z - q.z) < 0.05;
    if ((near(a, foot) && near(b, head)) || (near(b, foot) && near(a, head))) return true;
  }
  return false;
}

/**
 * A descent of more than 0.5" that is not a stair, ramp or ladder is a drop: the model steps off
 * an edge rather than walking a slope. Drops cost only their horizontal distance in movement.
 */
export function isFreeDropSegment(state: GameState, a: Vector3, b: Vector3): boolean {
  return (a.y ?? 0) - (b.y ?? 0) > 0.5 && !isSegmentOnRampOrStairs(state, a, b);
}

type SpatialSubject = Pick<Unit, 'position'> & { id?: string; models?: Unit['models']; status?: Unit['status'] };

export interface LineOfSightTrace {
  clear: boolean;
  blockedByPieceId?: string;
  blockedByUnitId?: string;
  /** Height on the target (inches above its feet) of the ray that got through, when clear. */
  visibleSampleHeight?: number;
}

/** First LoS-blocking terrain piece crossed by the 3D segment `from` -> `to`, or null. */
function terrainBlockingSegment(
  state: GameState,
  from: Vector3,
  to: Vector3,
  attacker: SpatialSubject,
  target: SpatialSubject
): string | null {
  const segLen = Math.hypot(to.x - from.x, (to.y ?? 0) - (from.y ?? 0), to.z - from.z);
  const eps = segLen > 1e-6 ? 0.05 / segLen : 0;
  for (const piece of state.terrain) {
    if (!piece.blocksLineOfSight) continue;
    const structure = resolveTerrainStructure(piece);
    const a = worldToLocal(piece, from);
    const b = worldToLocal(piece, to);
    for (const solid of structure.solids) {
      if (!solid.blocksLineOfSight) continue;
      const hit = segmentBoxIntersection(a, b, solid);
      if (hit && hit.s1 > eps && hit.s0 < 1 - eps) return piece.id;
    }
    for (const ap of structure.apertures) {
      const hit = segmentBoxIntersection(a, b, ap);
      if (hit && hit.s1 > eps && hit.s0 < 1 - eps) {
        // A port only passes sight while the shooter or the target is manning it.
        if (!isManningBox(piece, ap, attacker) && !isManningBox(piece, ap, target)) return piece.id;
      }
    }
  }
  return null;
}

/** First intervening fighter (not attacker/target) whose body the 3D segment passes through, or null. */
function unitBlockingSegment(
  state: GameState,
  from: Vector3,
  to: Vector3,
  attackerId: string,
  targetId: string | undefined
): string | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-4) return null;
  const dirX = dx / dist;
  const dirZ = dz / dist;
  for (const other of state.units) {
    if (other.isDestroyed || other.id === attackerId || other.id === targetId) continue;
    const otherModels =
      other.models && other.models.length > 0
        ? other.models.filter((m) => !m.isDestroyed)
        : [{ position: other.position }];
    for (const m of otherModels) {
      const mPos = m.position ?? other.position;
      const hit = intersectRayCircle(from, dirX, dirZ, dist, mPos, LOS_UNIT_RADIUS);
      if (hit && hit.tEntry < dist - 0.05 && hit.tExit > 0.05) {
        const tMid = (hit.tEntry + hit.tExit) / 2;
        const rayY = (from.y ?? 0) + (tMid / dist) * ((to.y ?? 0) - (from.y ?? 0));
        const otherY = mPos.y ?? other.position.y ?? 0;
        if (rayY > otherY + 1.5 || rayY < otherY - 0.1) continue; // ray passes above/below the fighter
        return other.id;
      }
    }
  }
  return null;
}

/**
 * Trace Line of Sight in 3D from the attacker's eye to the target. The target is visible if a ray
 * reaches any sampled part of it (head, torso or feet). Solids block by box height (lintels, sills,
 * walls); a port (aperture) passes sight only while the shooter or target is manning it.
 */
export function traceLineOfSight(
  state: GameState,
  attacker: Unit,
  targetOrPoint: SpatialSubject | Vector3
): LineOfSightTrace {
  const target: SpatialSubject =
    'position' in targetOrPoint ? (targetOrPoint as SpatialSubject) : { position: targetOrPoint as Vector3 };
  const dx = target.position.x - attacker.position.x;
  const dz = target.position.z - attacker.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-4) return { clear: true };

  const attackerY = attacker.position.y ?? 0;
  const targetY = target.position.y ?? 0;

  const eye: Vector3 = { x: attacker.position.x, y: attackerY + EYE_HEIGHT, z: attacker.position.z };
  let firstBlock: LineOfSightTrace = { clear: false };
  let recorded = false;
  for (const h of TARGET_SAMPLE_HEIGHTS) {
    const to: Vector3 = { x: target.position.x, y: targetY + h, z: target.position.z };
    const pieceId = terrainBlockingSegment(state, eye, to, attacker, target);
    if (pieceId) {
      if (!recorded) firstBlock = { clear: false, blockedByPieceId: pieceId };
      recorded = true;
      continue;
    }
    const unitId = unitBlockingSegment(state, eye, to, attacker.id, target.id);
    if (unitId) {
      if (!recorded) firstBlock = { clear: false, blockedByUnitId: unitId };
      recorded = true;
      continue;
    }
    return { clear: true, visibleSampleHeight: h };
  }
  return firstBlock;
}

/**
 * OPR-style Line of Sight check between `attacker` and `target`, traced in 3D from the attacker's
 * eye to any sampled part of the target (see `traceLineOfSight`). Blocked by:
 *   1. Solid terrain boxes with `blocksLineOfSight` (walls, jambs, sills, lintels, columns) at the
 *      height the ray actually crosses them.
 *   2. Port apertures (windows) unless the shooter or target is manning the port.
 *   3. Other living fighters between the pair.
 *   4. Roof floor plane blind spots for models set back > 1.0" from platform edges.
 */
export function hasLineOfSight(state: GameState, attacker: Unit, target: Unit): boolean {
  return traceLineOfSight(state, attacker, target).clear;
}

export interface CoverSource {
  pieceId?: string;
  reason: string;
}

/**
 * Find why `target` receives a Cover bonus (+1 Defense) against a ranged attack from `attacker`,
 * or null if it does not.
 *
 * Cover applies when:
 *   1. `target.status` explicitly includes `'in-cover'`, OR
 *   2. `target` is on an elevated platform within 1.0" of the edge facing the shooter (Parapet Cover), OR
 *   3. The attack ray passes across a non-LoS-blocking `providesCover` terrain
 *      piece (e.g. crates, barricades) situated between attacker and target,
 *      excluding cover adjacent to the attacker (shooting out of cover does
 *      not grant cover to the open target), and excluding low ground cover against
 *      plunging fire (attacker elevated >= 2.0"), OR
 *   4. The shot passes through a window port that `target` is manning, OR
 *   5. `target` is manning a sight-blocking solid (wall, jamb, column, sill) that partially
 *      obscures it (a torso-height flank ray is blocked). Doorway openings give no cover by themselves.
 */
export function findCoverSource(
  state: GameState,
  attacker: Unit,
  target: SpatialSubject
): CoverSource | null {
  if (target.status?.includes('in-cover')) return { reason: 'Unit has in-cover status' };

  const attackerY = attacker.position.y ?? 0;
  const targetY = target.position.y ?? 0;

  const isPlungingFire = attackerY >= targetY + 2.0;

  const dx = target.position.x - attacker.position.x;
  const dz = target.position.z - attacker.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-4) return null;

  const dirX = dx / dist;
  const dirZ = dz / dist;
  const perpX = -dirZ;
  const perpZ = dirX;

  const eye: Vector3 = { x: attacker.position.x, y: attackerY + EYE_HEIGHT, z: attacker.position.z };

  for (const piece of state.terrain) {
    if (!piece.providesCover) continue;

    // Plunging fire looks over ground-level low cover (crates, low barricades <= 1.5")
    if (
      isPlungingFire &&
      (piece.scale?.y ?? 1.0) <= 1.5 &&
      (piece.position.y ?? 0) < targetY + 0.5
    ) {
      continue;
    }

    const { hx, hz } = terrainHalfExtents(piece);
    const pieceRadius = Math.hypot(hx, hz);

    // Distance of the piece projected along the shooter -> target vector.
    const toPieceX = piece.position.x - attacker.position.x;
    const toPieceZ = piece.position.z - attacker.position.z;
    const projDist = toPieceX * dirX + toPieceZ * dirZ;

    // Terrain adjacent to the shooter (within 1.0") is shot over/around by the attacker
    // and does not protect an open target downrange.
    if (projDist <= 1.0) continue;

    // Terrain situated entirely behind the target does not grant cover.
    if (projDist > dist + pieceRadius) continue;

    if (!piece.blocksLineOfSight) {
      // Low cover (crates, barricades): line of fire must pass across the piece,
      // and defender must be within 1.0" of the low cover along the line of fire.
      const hit = intersectRayTerrain(attacker.position, dirX, dirZ, dist, piece, 0.15);
      if (hit && hit.tEntry >= 0.8 && hit.tExit <= dist + 0.1 && hit.tEntry < dist - 0.05) {
        const distFromExitToTarget = dist - hit.tExit;
        if (distFromExitToTarget <= 1.0) {
          return { pieceId: piece.id, reason: `Intervening low cover (${piece.terrainType}, defender within 1.0")` };
        }
      }
      continue;
    }

    const structure = resolveTerrainStructure(piece);
    const localEye = worldToLocal(piece, eye);

    // Window ports: the shot passes through the port and the defender is manning it.
    for (const ap of structure.apertures) {
      if (!ap.providesCover || !isManningBox(piece, ap, target)) continue;
      const l = worldToLocal(piece, { x: attacker.position.x, y: 0, z: attacker.position.z });
      const yaw = piece.rotation.y || 0;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const hit2d = intersectLocalBox(
        l.x,
        l.z,
        dirX * cos - dirZ * sin,
        dirX * sin + dirZ * cos,
        ap.minX,
        ap.maxX,
        ap.minZ,
        ap.maxZ,
        dist
      );
      if (!hit2d || hit2d.tExit <= 0.05 || hit2d.tEntry >= dist - 0.05 || dist - hit2d.tExit > 1.0) continue;
      for (const h of TARGET_SAMPLE_HEIGHTS) {
        const b = worldToLocal(piece, { x: target.position.x, y: targetY + h, z: target.position.z });
        if (segmentBoxIntersection(localEye, b, ap)) {
          return { pieceId: piece.id, reason: 'Window firing port cover (defender manning the port)' };
        }
      }
    }

    // Sight-blocking cover (walls, jambs, sills, columns): target's base edge within 1.0" of a solid
    // and partially obscured by it (a torso-height flank ray is blocked).
    const flankOffset = 0.3;
    const flanks = [
      { x: target.position.x + perpX * flankOffset, z: target.position.z + perpZ * flankOffset },
      { x: target.position.x - perpX * flankOffset, z: target.position.z - perpZ * flankOffset },
    ];
    for (const solid of structure.solids) {
      if (!solid.blocksLineOfSight || !solid.providesCover) continue;
      if (!isManningBox(piece, solid, target)) continue;
      for (const f of flanks) {
        const b = worldToLocal(piece, { x: f.x, y: targetY + FLANK_RAY_HEIGHT, z: f.z });
        const segLen = Math.hypot(b.x - localEye.x, b.y - localEye.y, b.z - localEye.z);
        const hit = segmentBoxIntersection(localEye, b, solid);
        if (hit) {
          const entry = hit.s0 * segLen;
          if (entry >= 0.8 && entry < segLen - 0.05) {
            return { pieceId: piece.id, reason: `Sight-blocking partial cover (${piece.terrainType})` };
          }
        }
      }
    }
  }

  return null;
}

/** Whether `target` receives a Cover bonus (+1 Defense) against a ranged attack from `attacker`. */
export function hasCoverAgainstAttack(state: GameState, attacker: Unit, target: Unit): boolean {
  return findCoverSource(state, attacker, target) !== null;
}

export interface TerrainIntersectionDebug {
  pieceId: string;
  terrainType: string;
  entryPoint: Vector3;
  exitPoint: Vector3;
  tEntry: number;
  tExit: number;
  providesCover: boolean;
  blocksLineOfSight: boolean;
  isCoverProvider: boolean;
  isLoSBlocker: boolean;
  ignoredAsAdjacentShooterCover: boolean;
}

export interface FlankRayDebug {
  from: Vector3;
  to: Vector3;
  side: 'left' | 'right';
  blocked: boolean;
  blockedByPieceId?: string;
}

export interface ShootingRayDebugInfo {
  attackerId: string;
  targetId?: string;
  from: Vector3;
  to: Vector3;
  distance: number;
  hasLineOfSight: boolean;
  blockedByUnitId?: string;
  blockedByPieceId?: string;
  providesCover: boolean;
  coverReason?: string;
  coverPieceId?: string;
  intersections: TerrainIntersectionDebug[];
  flankRays?: FlankRayDebug[];
}

/**
 * Compute exhaustive shooting ray debug information for the F9 debugger:
 * the eye-level center line from attacker to target/aim position, entry and exit coordinates
 * on all intersected terrain bounding boxes, LoS obstruction, cover provider,
 * and left/right torso-height flank rays showing partial obscuration.
 */
export function computeShootingRayDebug(
  state: GameState,
  attacker: Unit,
  targetOrPoint: Unit | Vector3
): ShootingRayDebugInfo {
  const isTargetUnit = 'id' in targetOrPoint && 'position' in targetOrPoint;
  const targetUnit = isTargetUnit ? (targetOrPoint as Unit) : null;
  const targetPos = isTargetUnit ? targetUnit!.position : (targetOrPoint as Vector3);

  const attackerY = attacker.position.y ?? 0;
  const targetY = targetPos.y ?? 0;
  const from: Vector3 = { x: attacker.position.x, y: attackerY + EYE_HEIGHT, z: attacker.position.z };
  const to: Vector3 = { x: targetPos.x, y: targetY + EYE_HEIGHT, z: targetPos.z };

  const dx = targetPos.x - attacker.position.x;
  const dz = targetPos.z - attacker.position.z;
  const distance = Math.hypot(dx, dz);

  if (distance < 1e-4) {
    return {
      attackerId: attacker.id,
      targetId: targetUnit?.id,
      from,
      to,
      distance: 0,
      hasLineOfSight: true,
      providesCover: false,
      intersections: [],
    };
  }

  const dirX = dx / distance;
  const dirZ = dz / distance;
  const perpX = -dirZ;
  const perpZ = dirX;

  const subject: SpatialSubject = targetUnit ?? { position: targetPos };
  const trace = traceLineOfSight(state, attacker, subject);
  const cover = targetUnit ? findCoverSource(state, attacker, targetUnit) : null;

  // Footprint intersections along the ground-plane center line (for the debug overlay)
  const intersections: TerrainIntersectionDebug[] = [];
  for (const piece of state.terrain) {
    const { hx, hz } = terrainHalfExtents(piece);
    const pieceRadius = Math.hypot(hx, hz);
    const toPieceX = piece.position.x - attacker.position.x;
    const toPieceZ = piece.position.z - attacker.position.z;
    const projDist = toPieceX * dirX + toPieceZ * dirZ;

    const margin = piece.blocksLineOfSight ? 0 : 0.15;
    const hit = intersectRayTerrain(attacker.position, dirX, dirZ, distance, piece, margin);
    if (!hit) continue;

    intersections.push({
      pieceId: piece.id,
      terrainType: piece.terrainType,
      // The ray climbs or falls from the shooter's eye to the target, so heights follow the line
      entryPoint: {
        x: Math.round((attacker.position.x + dirX * hit.tEntry) * 100) / 100,
        y: Math.round((from.y + (to.y - from.y) * (hit.tEntry / distance)) * 100) / 100,
        z: Math.round((attacker.position.z + dirZ * hit.tEntry) * 100) / 100,
      },
      exitPoint: {
        x: Math.round((attacker.position.x + dirX * hit.tExit) * 100) / 100,
        y: Math.round((from.y + (to.y - from.y) * (hit.tExit / distance)) * 100) / 100,
        z: Math.round((attacker.position.z + dirZ * hit.tExit) * 100) / 100,
      },
      tEntry: Math.round(hit.tEntry * 100) / 100,
      tExit: Math.round(hit.tExit * 100) / 100,
      providesCover: piece.providesCover,
      blocksLineOfSight: piece.blocksLineOfSight,
      isCoverProvider: cover?.pieceId === piece.id,
      isLoSBlocker: !trace.clear && trace.blockedByPieceId === piece.id,
      ignoredAsAdjacentShooterCover: projDist <= 1.0 && projDist <= distance + pieceRadius,
    });
  }
  intersections.sort((a, b) => a.tEntry - b.tEntry);

  // Torso-height flank rays for target units (partial obscuration)
  let flankRays: FlankRayDebug[] | undefined;
  if (targetUnit) {
    flankRays = [];
    const flankOffset = 0.3;
    for (const [side, sgn] of [
      ['left', 1],
      ['right', -1],
    ] as const) {
      const fX = targetPos.x + perpX * flankOffset * sgn;
      const fZ = targetPos.z + perpZ * flankOffset * sgn;
      const flankTo: Vector3 = { x: fX, y: targetY + FLANK_RAY_HEIGHT, z: fZ };
      const segLen = Math.hypot(flankTo.x - from.x, flankTo.y - from.y, flankTo.z - from.z);
      let blocked = false;
      let pieceBlocked: string | undefined;
      for (const piece of state.terrain) {
        if (!piece.blocksLineOfSight) continue;
        const a = worldToLocal(piece, from);
        const b = worldToLocal(piece, flankTo);
        for (const solid of resolveTerrainStructure(piece).solids) {
          if (!solid.blocksLineOfSight) continue;
          const hit = segmentBoxIntersection(a, b, solid);
          if (hit && hit.s0 * segLen >= 0.8 && hit.s0 * segLen < segLen - 0.05) {
            blocked = true;
            pieceBlocked = piece.id;
            break;
          }
        }
        if (blocked) break;
      }
      flankRays.push({ from, to: flankTo, side, blocked, blockedByPieceId: pieceBlocked });
    }
  }

  return {
    attackerId: attacker.id,
    targetId: targetUnit?.id,
    from,
    to,
    distance: Math.round(distance * 100) / 100,
    hasLineOfSight: trace.clear,
    blockedByUnitId: trace.clear ? undefined : trace.blockedByUnitId,
    blockedByPieceId: trace.clear ? undefined : trace.blockedByPieceId,
    providesCover: !!cover,
    coverReason: cover?.reason,
    coverPieceId: cover?.pieceId,
    intersections,
    flankRays,
  };
}

/**
 * Compute a 2D visibility polygon (star-shaped fan around `origin` up to
 * `maxRange`) showing where Line of Sight is clear vs blocked by
 * `blocksLineOfSight` terrain, friendly fighters, and enemy fighters.
 *
 * Rays that hit an enemy fighter pass through the fighter's own footprint and
 * terminate at its far edge so the enemy model itself sits inside the visible
 * red region while casting a blank shadow behind it.
 */
export function computeLosVisibilityPolygon(
  state: GameState,
  origin: Vector3,
  maxRange: number,
  attackerId: string
): Array<{ x: number; z: number }> {
  if (maxRange <= 0) return [];

  const attacker = state.units.find((u) => u.id === attackerId);
  const attackerOwnerId = attacker?.ownerId ?? '';
  const halfW = (state.board.width * state.board.gridSize) / 2;
  const halfH = (state.board.height * state.board.gridSize) / 2;

  const angles: number[] = [];
  const baseSteps = 180;
  for (let i = 0; i < baseSteps; i++) {
    angles.push((i / baseSteps) * Math.PI * 2);
  }

  const addAngleWithJitter = (angle: number) => {
    const norm = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    angles.push(norm);
    angles.push(((norm - 0.002 + Math.PI * 2) % (Math.PI * 2)));
    angles.push(((norm + 0.002) % (Math.PI * 2)));
  };

  // Add board corner angles so the visibility fan clips sharply along board edges.
  for (const [bx, bz] of [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ]) {
    addAngleWithJitter(Math.atan2(bz - origin.z, bx - origin.x));
  }

  // Add corner angles of LoS-blocking terrain for crisp shadow edges.
  for (const piece of state.terrain) {
    if (!piece.blocksLineOfSight) continue;
    const yaw = piece.rotation.y || 0;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const structure = resolveTerrainStructure(piece);
    const boxes = [...structure.solids.filter((x) => x.blocksLineOfSight), ...structure.apertures];
    for (const part of boxes) {
      const partCorners = [
        [part.minX, part.minZ],
        [part.maxX, part.minZ],
        [part.maxX, part.maxZ],
        [part.minX, part.maxZ],
      ];
      for (const [lx, lz] of partCorners) {
        const wx = piece.position.x + lx * cos + lz * sin;
        const wz = piece.position.z - lx * sin + lz * cos;
        if (Math.hypot(wx - origin.x, wz - origin.z) <= maxRange + 2) {
          addAngleWithJitter(Math.atan2(wz - origin.z, wx - origin.x));
        }
      }
    }
  }

  // Add tangent angles of other living units for crisp unit shadows.
  for (const other of state.units) {
    if (other.isDestroyed || other.id === attackerId) continue;
    const dx = other.position.x - origin.x;
    const dz = other.position.z - origin.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-3 && d <= maxRange + LOS_UNIT_RADIUS) {
      const centerAngle = Math.atan2(dz, dx);
      const halfSpread = Math.asin(Math.min(1, LOS_UNIT_RADIUS / d));
      addAngleWithJitter(centerAngle - halfSpread);
      addAngleWithJitter(centerAngle + halfSpread);
    }
  }

  angles.sort((a, b) => a - b);

  const polygon: Array<{ x: number; z: number }> = [];
  for (const angle of angles) {
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    let bestDist = maxRange;

    // Clip rays to the board boundaries [-halfW, halfW] x [-halfH, halfH].
    if (dirX > 1e-8) {
      bestDist = Math.min(bestDist, Math.max(0, (halfW - origin.x) / dirX));
    } else if (dirX < -1e-8) {
      bestDist = Math.min(bestDist, Math.max(0, (-halfW - origin.x) / dirX));
    }
    if (dirZ > 1e-8) {
      bestDist = Math.min(bestDist, Math.max(0, (halfH - origin.z) / dirZ));
    } else if (dirZ < -1e-8) {
      bestDist = Math.min(bestDist, Math.max(0, (-halfH - origin.z) / dirZ));
    }

    for (const piece of state.terrain) {
      if (!piece.blocksLineOfSight) continue;

      const broadHit = intersectRayTerrain(origin, dirX, dirZ, bestDist, piece, 0);
      if (!broadHit) continue;

      const yaw = piece.rotation.y || 0;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const pDx = origin.x - piece.position.x;
      const pDz = origin.z - piece.position.z;
      const localOx = pDx * cos - pDz * sin;
      const localOz = pDx * sin + pDz * cos;
      const localDx = dirX * cos - dirZ * sin;
      const localDz = dirX * sin + dirZ * cos;

      // The fan is a slice of the 3D world at the shooter's eye height.
      const eyeLocalY = (origin.y ?? 0) + EYE_HEIGHT - (piece.position.y ?? 0);
      const structure = resolveTerrainStructure(piece);
      for (const solid of structure.solids) {
        if (!solid.blocksLineOfSight || eyeLocalY < solid.minY || eyeLocalY > solid.maxY) continue;
        const hit = intersectLocalBox(
          localOx, localOz, localDx, localDz,
          solid.minX, solid.maxX, solid.minZ, solid.maxZ, bestDist
        );
        if (hit && hit.tExit > 0.02) {
          bestDist = Math.min(bestDist, hit.tEntry);
        }
      }
      for (const ap of structure.apertures) {
        if (eyeLocalY < ap.minY || eyeLocalY > ap.maxY) continue;
        const hit = intersectLocalBox(
          localOx, localOz, localDx, localDz,
          ap.minX, ap.maxX, ap.minZ, ap.maxZ, bestDist
        );
        if (hit && hit.tExit > 0.02 && !isManningBox(piece, ap, { position: origin })) {
          bestDist = Math.min(bestDist, hit.tEntry);
        }
      }
    }

    for (const other of state.units) {
      if (other.isDestroyed || other.id === attackerId) continue;
      const hit = intersectRayCircle(
        origin,
        dirX,
        dirZ,
        bestDist,
        other.position,
        LOS_UNIT_RADIUS
      );
      if (hit && hit.tExit > 0.02) {
        // Friendly units block at their front edge; enemy units remain inside
        // the visible zone and cast a shadow starting from their back edge.
        const stopAt = other.ownerId === attackerOwnerId ? hit.tEntry : hit.tExit;
        bestDist = Math.min(bestDist, stopAt);
      }
    }

    polygon.push({
      x: origin.x + dirX * bestDist,
      z: origin.z + dirZ * bestDist,
    });
  }

  return polygon;
}

/**
 * Computes the shortest legal movement path from `unit.position` to `destination`,
 * navigating around obstacle terrain (including door frames and solid walls) and other
 * fighters using 2D visibility-graph A* pathfinding.
 *
 * If the shortest path exceeds `maxDistance`, it is clamped along the polyline so
 * the returned path stops cleanly at the exact maximum movement allowed.
 */
/**
 * Identifies whether a terrain piece is an inclined stair or ramp.
 */
export function isStairPiece(piece: TerrainPiece): boolean {
  if (!piece) return false;
  return (
    piece.terrainType === 'stairs' ||
    piece.climbType === 'stairs' ||
    piece.terrainType === 'stairs-open' ||
    piece.terrainType === 'stairs-closed-short' ||
    piece.terrainType === 'stairs-sides' ||
    piece.terrainType === 'ramp' ||
    piece.climbType === 'ramp' ||
    Boolean(piece.terrainType && piece.terrainType.includes('stairs'))
  );
}

/**
 * Identifies whether a terrain piece is a vertical ladder.
 */
export function isLadderPiece(piece: TerrainPiece): boolean {
  if (!piece) return false;
  return (
    piece.terrainType === 'ladder' ||
    piece.climbType === 'ladder' ||
    Boolean(piece.terrainType && piece.terrainType.includes('ladder'))
  );
}

/**
 * Calculates the continuous elevation along the sloped hypotenuse surface of a triangular stair/ramp.
 * Returns null if the point is horizontally outside the stair footprint.
 */
export function getStairSurfaceHeight(
  piece: TerrainPiece,
  point: Vector3,
  state?: GameState
): number | null {
  if (!isStairPiece(piece)) return null;

  const { hx, hz } = terrainHalfExtents(piece);
  const yaw = piece.rotation.y || 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);

  const dx = point.x - piece.position.x;
  const dz = point.z - piece.position.z;
  const lx = dx * cos + dz * sin;
  const lz = -dx * sin + dz * cos;

  // Margin around stairs footprint
  const stairMargin = Math.max(0.35, UNIT_COLLISION_RADIUS + 0.05);
  if (Math.abs(lx) > hx + stairMargin || Math.abs(lz) > hz + stairMargin) {
    return null;
  }

  const botY = piece.position.y ?? 0;
  const topY = legacyElevation(piece) ?? botY + (piece.scale.y ?? 2.5);

  let footLocalZ = -hz;
  let headLocalZ = hz;
  if (state) {
    const waypoints = getStairWaypoints(state, piece);
    const fdx = waypoints.foot.x - piece.position.x;
    const fdz = waypoints.foot.z - piece.position.z;
    const flz = -fdx * sin + fdz * cos;
    if (flz > 0) {
      footLocalZ = hz;
      headLocalZ = -hz;
    }
  }

  const t = (lz - footLocalZ) / (headLocalZ - footLocalZ);
  const clampedT = Math.max(0, Math.min(1, t));
  return botY + clampedT * (topY - botY);
}

/**
 * Checks whether a 3D line segment traverses an active vertical ladder.
 */
export function findLadderForSegment(
  state: GameState,
  p1: Vector3,
  p2: Vector3
): TerrainPiece | null {
  for (const piece of state.terrain) {
    if (!isLadderPiece(piece)) continue;

    const { hx, hz } = terrainHalfExtents(piece);
    const yaw = piece.rotation.y || 0;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const margin = 0.5;
    const botY = Math.min(0, piece.position.y ?? 0);
    const topY = Math.max(
      legacyElevation(piece) ?? 0,
      (piece.position.y ?? 0) + (piece.scale.y ?? 2.5),
      (piece as any).size?.y ?? 0
    );

    const testPoints = [p1, p2];
    const onLadder = testPoints.every((pt) => {
      const py = pt.y ?? 0;
      if (py < botY - 0.5 || py > topY + 0.5) return false;
      const dx = pt.x - piece.position.x;
      const dz = pt.z - piece.position.z;
      const lx = dx * cos + dz * sin;
      const lz = -dx * sin + dz * cos;
      return Math.abs(lx) <= hx + margin && Math.abs(lz) <= hz + margin;
    });

    if (onLadder) return piece;
  }
  return null;
}

export function isSegmentOnLadder(
  state: GameState,
  p1: Vector3,
  p2: Vector3
): boolean {
  return findLadderForSegment(state, p1, p2) !== null;
}

/**
 * Checks whether a 3D line segment traverses an active staircase, ladder, or ramp.
 */
export function isSegmentOnRampOrStairs(
  state: GameState,
  p1: Vector3,
  p2: Vector3
): boolean {
  for (const piece of state.terrain) {
    const isRampOrStairs = isStairPiece(piece) || isLadderPiece(piece);
    if (!isRampOrStairs) continue;

    const { hx, hz } = terrainHalfExtents(piece);
    const yaw = piece.rotation.y || 0;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    // tight clearance margin around the stair spine; a ladder's foot and head stand LADDER_STANDOFF off it
    const margin = isLadderPiece(piece) ? LADDER_STANDOFF + 0.1 : 0.35;
    const botY = Math.min(0, piece.position.y ?? 0);
    const topY = Math.max(
      legacyElevation(piece) ?? 0,
      (piece.position.y ?? 0) + (piece.scale.y ?? 2.5),
      (piece as any).size?.y ?? 0
    );

    const testPoints = [
      p1,
      p2,
      {
        x: (p1.x + p2.x) / 2,
        y: ((p1.y ?? 0) + (p2.y ?? 0)) / 2,
        z: (p1.z + p2.z) / 2,
      },
    ];

    const allInFootprint = testPoints.every((pt) => {
      const py = pt.y ?? 0;
      if (py < botY - 0.5 || py > topY + 0.5) return false;
      // Stairs are a solid wedge: only a segment that follows the slope surface is "on" them
      if (isStairPiece(piece)) {
        const slopeY = getStairSurfaceHeight(piece, pt, state);
        if (slopeY === null || Math.abs(py - slopeY) > 0.3) return false;
      }
      const dx = pt.x - piece.position.x;
      const dz = pt.z - piece.position.z;
      const lx = dx * cos + dz * sin;
      const lz = -dx * sin + dz * cos;
      if (Math.abs(lx) > hx + margin || Math.abs(lz) > hz + margin) return false;

      return true;
    });

    if (allInFootprint) {
      return true;
    }
  }

  return false;
}

/**
 * Computes exact ground-foot entrance and platform-head exit waypoints for stairs or ladders.
 */
export function getStairWaypoints(
  state: GameState,
  piece: TerrainPiece
): { foot: Vector3; head: Vector3 } {
  const botY = piece.position.y ?? 0;
  const topY = legacyElevation(piece) ?? botY + (piece.scale.y ?? 2.5);

  if (piece.terrainType === 'ladder' || piece.climbType === 'ladder') {
    // The ladder sits on the deck face; local +Z points into the deck. The foot is a base off the face on
    // the ground, the head is the same distance in over the deck, so neither base overlaps the ladder or deck.
    const lyaw = piece.rotation.y || 0;
    const dx = Math.sin(lyaw) * LADDER_STANDOFF;
    const dz = Math.cos(lyaw) * LADDER_STANDOFF;
    return {
      foot: {
        x: Math.round((piece.position.x - dx) * 100) / 100 + 0, // + 0 turns -0 into 0
        y: botY,
        z: Math.round((piece.position.z - dz) * 100) / 100 + 0, // + 0 turns -0 into 0
      },
      head: {
        x: Math.round((piece.position.x + dx) * 100) / 100 + 0, // + 0 turns -0 into 0
        y: topY,
        z: Math.round((piece.position.z + dz) * 100) / 100 + 0, // + 0 turns -0 into 0
      },
    };
  }

  const { hz } = terrainHalfExtents(piece);
  const yaw = piece.rotation.y || 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);

  // In Three.js / Kenney assets, stair slope runs along local Z:
  // Rotation Y transforms local Z (0, hz) into world (hz * sin(yaw), hz * cos(yaw))
  const endA = {
    x: piece.position.x + hz * sin,
    z: piece.position.z + hz * cos,
  };
  const endB = {
    x: piece.position.x - hz * sin,
    z: piece.position.z - hz * cos,
  };

  // Orientation is data, not neighbours: the head (top) end is always local +Z, so the rendered wedge, the
  // F9 wireframe and the movement physics always agree. Rotate the piece to face the stairs at the deck.
  // End A (+Z) is the head at topY, End B (-Z) is the foot at botY
  return {
    foot: {
      x: Math.round((endB.x - sin * 0.2) * 100) / 100,
      y: botY,
      z: Math.round((endB.z - cos * 0.2) * 100) / 100,
    },
    head: {
      x: Math.round((endA.x + sin * 0.2) * 100) / 100,
      y: topY,
      z: Math.round((endA.z + cos * 0.2) * 100) / 100,
    },
  };
}

/**
 * Validates whether a 3D movement segment is constrained to a physical surface.
 * Airborne models can fly diagonally through open space.
 * Non-airborne models cannot fly diagonally across elevation changes; they must move along
 * flat surfaces (|dy| <= 0.35), scale vertical walls (|dh| <= 0.7), or traverse stairs/ramps.
 */
export function isSegmentSurfaceConstrained(
  state: GameState,
  p1: Vector3,
  p2: Vector3,
  unit?: Unit
): boolean {
  if (unit && hasTrait(unit.specialRules, 'airborne')) {
    return true; // Airborne units can fly diagonally through open air
  }

  const y1 = p1.y ?? 0;
  const y2 = p2.y ?? 0;
  const dy = Math.abs(y1 - y2);
  const dh = Math.hypot(p1.x - p2.x, p1.z - p2.z);

  // Flat horizontal movement on the same surface tier
  if (dy <= 0.35) {
    return true;
  }

  // Pure vertical movement (scaling a sheer wall, climbing a ladder, dropping off a ledge)
  if (dh <= 0.7) {
    return true;
  }

  // Diagonal elevation change: must be on a designated staircase, ladder, or ramp
  return isSegmentOnRampOrStairs(state, p1, p2);
}

/**
 * Nav candidates on a walkable surface at floor height: the four inset corners and the four edge midpoints,
 * in world space (rounded to 0.01"). Local-to-world uses `localToWorldXZ`, the convention collision uses, so
 * rotated pieces get their points on the surface.
 */
export function getDeckPoints(piece: TerrainPiece, surface: WalkableSurface): Vector3[] {
  const inset = Math.min(0.2, (surface.maxX - surface.minX) / 4, (surface.maxZ - surface.minZ) / 4);
  const midX = (surface.minX + surface.maxX) / 2;
  const midZ = (surface.minZ + surface.maxZ) / 2;
  const local = [
    { x: surface.minX + inset, z: surface.minZ + inset },
    { x: surface.maxX - inset, z: surface.minZ + inset },
    { x: surface.maxX - inset, z: surface.maxZ - inset },
    { x: surface.minX + inset, z: surface.maxZ - inset },
    { x: midX, z: surface.minZ },
    { x: midX, z: surface.maxZ },
    { x: surface.minX, z: midZ },
    { x: surface.maxX, z: midZ },
  ];
  return local.map((pt) => {
    const w = localToWorldXZ(piece, pt.x, pt.z);
    return { x: Math.round(w.x * 100) / 100, y: surface.topY, z: Math.round(w.z * 100) / 100 };
  });
}

/** Segment kinds the pathfinder may plan: ordinary, test-free movement (including climbs of climbable terrain). */
const PLANNABLE_KINDS: readonly string[] = ['walk', 'stairs', 'ladder', 'climb', 'drop', 'gap'];

/** True if `a` -> `b` is ordinary movement (no jump, fall, climb or impossible crossing). */
export function isOrdinarySegment(state: GameState, a: Vector3, b: Vector3, unit?: Unit): boolean {
  return PLANNABLE_KINDS.includes(classifySegment(state, a, b, unit).kind);
}

/**
 * True if `a` -> `b` is the step from a short ladder's head onto the top of its climb line (the way down). A
 * ladder of 3" or less is only climbed up; going down it is simply a free drop, which the planner finds itself.
 */
function isShortLadderDescentStep(state: GameState, a: Vector3, b: Vector3): boolean {
  if (!isLadderStepSegment(state, a, b)) return false;
  for (const piece of state.terrain) {
    if (!isLadderPiece(piece)) continue;
    const { foot, head } = getStairWaypoints(state, piece);
    const near = (p: Vector3, q: Vector3) => Math.hypot(p.x - q.x, p.z - q.z) < 0.05;
    if (near(a, head) && near(b, foot)) return head.y - foot.y <= FREE_DROP_MAX;
  }
  return false;
}

/**
 * Pull a planned path's end back so the model never stops suspended in mid-air or part-way up a ladder.
 * Walks back along the last segment (then earlier ones) to the nearest standable point, never forward.
 */
function settleEnd(state: GameState, unit: Unit, path: Vector3[], budget?: number): Vector3[] {
  if (path.length < 2) return path;
  const airborne = hasTrait(unit.specialRules, 'airborne');
  const surfaces = collectWalkableSurfaces(state);
  const bad = (pt: Vector3): boolean =>
    findEndOverlap(state, unit.id, pt) !== null ||
    (!airborne &&
      (isSuspendedInMidAir(state, pt) ||
        isBaseOverhanging(state, pt, surfaces) ||
        state.terrain.some((p) => isLadderPiece(p) && isOnLadderClimbLine(state, p, pt))));
  // Climbed onto a floor but stopped at its lip: step on until the whole base is on the floor, if the budget allows
  if (budget !== undefined && !airborne && path.length >= 3 && bad(path[path.length - 1])) {
    const onto = stepFullyOntoFloor(state, unit, path, budget, bad);
    if (onto) return onto;
  }
  // A straight climb or drop (no ladder, no stairs) has no standable point part-way: all or nothing
  return pullBackEnd(
    path,
    bad,
    (a, b) =>
      Math.abs((b.y ?? 0) - (a.y ?? 0)) > 0.5 &&
      Math.hypot(b.x - a.x, b.z - a.z) < 0.1 &&
      !isSegmentOnRampOrStairs(state, a, b)
  );
}

/**
 * When a path's last leg is the level step from the top of a climb onto the floor, and the end would leave the
 * base over the lip, push the end on along that step to the first spot where the base is fully on the floor.
 * Null when the path is not that shape, no such spot is close, or the extra distance exceeds `budget`.
 */
function stepFullyOntoFloor(
  state: GameState,
  unit: Unit,
  path: Vector3[],
  budget: number,
  bad: (pt: Vector3) => boolean
): Vector3[] | null {
  const n = path.length;
  const [prev, a, last] = [path[n - 3], path[n - 2], path[n - 1]];
  const climbedUp = (a.y ?? 0) - (prev.y ?? 0) > 0.5 && Math.hypot(a.x - prev.x, a.z - prev.z) < 0.1;
  if (!climbedUp || Math.abs((last.y ?? 0) - (a.y ?? 0)) > 0.05 || isSegmentOnRampOrStairs(state, prev, a)) return null;
  const len = Math.hypot(last.x - a.x, last.z - a.z);
  if (len < 1e-6) return null;
  for (let d = len; d <= len + 1.5; d += 0.05) {
    const pt = {
      x: Math.round((a.x + ((last.x - a.x) / len) * d) * 100) / 100,
      y: last.y ?? 0,
      z: Math.round((a.z + ((last.z - a.z) / len) * d) * 100) / 100,
    };
    if (bad(pt)) continue;
    // a little further in, so the base is clear of the lip rather than exactly touching it
    const ahead = {
      x: Math.round((pt.x + ((last.x - a.x) / len) * 0.05) * 100) / 100,
      y: pt.y,
      z: Math.round((pt.z + ((last.z - a.z) / len) * 0.05) * 100) / 100,
    };
    const extended = [...path.slice(0, n - 1), bad(ahead) ? pt : ahead];
    return pathMovementCost(state, extended, unit) <= budget + 1e-4 ? extended : null;
  }
  return null;
}

/**
 * Calculates projection points on a platform perimeter to provide a clean vertical
 * wall-base ascent fallback when climbing sheer walls.
 */
export function addPlatformAscentPoints(
  plat: TerrainPiece,
  refPoint: Vector3,
  waypoints: Vector3[]
): void {
  for (const surface of getWalkableSurfaces(plat)) {
    const { x: lx, z: lz } = worldToLocal(plat, refPoint);

    const clampedX = Math.max(surface.minX, Math.min(surface.maxX, lx));
    const clampedZ = Math.max(surface.minZ, Math.min(surface.maxZ, lz));

    let edgeX = clampedX;
    let edgeZ = clampedZ;
    const distToLeft = Math.abs(clampedX - surface.minX);
    const distToRight = Math.abs(clampedX - surface.maxX);
    const distToNear = Math.abs(clampedZ - surface.minZ);
    const distToFar = Math.abs(clampedZ - surface.maxZ);
    const minDist = Math.min(distToLeft, distToRight, distToNear, distToFar);

    if (minDist === distToLeft) edgeX = surface.minX;
    else if (minDist === distToRight) edgeX = surface.maxX;
    else if (minDist === distToNear) edgeZ = surface.minZ;
    else edgeZ = surface.maxZ;

    const w = localToWorldXZ(plat, edgeX, edgeZ);
    const wx = Math.round(w.x * 100) / 100;
    const wz = Math.round(w.z * 100) / 100;

    waypoints.push({ x: wx, y: 0, z: wz });
    waypoints.push({ x: wx, y: surface.topY, z: wz });
  }
}

/**
 * Computes the point along the line segment from `p1` (outside piece) to `p2` (inside piece)
 * where the segment intersects the piece's perimeter, backed off by a safe margin so the
 * resulting point is strictly outside the difficult terrain boundary.
 */
export function findDifficultTerrainEntry(
  p1: Vector3,
  p2: Vector3,
  piece: TerrainPiece
): Vector3 | null {
  const { hx, hz } = terrainHalfExtents(piece);
  const yaw = piece.rotation.y || 0;
  const cos = Math.cos(-yaw);
  const sin = Math.sin(-yaw);

  const dx1 = p1.x - piece.position.x;
  const dz1 = p1.z - piece.position.z;
  const l1x = dx1 * cos - dz1 * sin;
  const l1z = dx1 * sin + dz1 * cos;

  const dx2 = p2.x - piece.position.x;
  const dz2 = p2.z - piece.position.z;
  const l2x = dx2 * cos - dz2 * sin;
  const l2z = dx2 * sin + dz2 * cos;

  const dlx = l2x - l1x;
  const dlz = l2z - l1z;
  const segLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
  if (segLen < 1e-4) return null;

  let tMin = 0;
  let tMax = 1;

  if (Math.abs(dlx) > 1e-6) {
    const t1 = (-hx - l1x) / dlx;
    const t2 = (hx - l1x) / dlx;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }
  if (Math.abs(dlz) > 1e-6) {
    const t1 = (-hz - l1z) / dlz;
    const t2 = (hz - l1z) / dlz;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }

  if (tMin > tMax || tMin <= 0 || tMin > 1) {
    return null;
  }

  // Back off by 0.20" so the resulting point is strictly outside the terrain piece's 0.15" margin
  const offset = 0.2 / segLen;
  const entryT = Math.max(0, tMin - offset);
  return {
    x: Math.round((p1.x + (p2.x - p1.x) * entryT) * 100) / 100,
    y: Math.round(((p1.y ?? 0) + ((p2.y ?? 0) - (p1.y ?? 0)) * entryT) * 100) / 100,
    z: Math.round((p1.z + (p2.z - p1.z) * entryT) * 100) / 100,
  };
}

/**
 * Computes the shortest legal movement path from `unit.position` to `destination`,
 * navigating around obstacle terrain (including door frames and solid walls) and other
 * fighters using 3D surface-constrained visibility-graph A* pathfinding.
 *
 * If the shortest path exceeds `maxDistance`, it is clamped along the polyline so
 * the returned path stops cleanly at the exact maximum movement allowed.
 */
export function findNavPath(
  state: GameState,
  unit: Unit,
  destination: Vector3,
  maxDistance: number = unit.remainingMovement,
  options: {
    ignoreUnitId?: string;
    startPosition?: Vector3;
    stopBeforeDifficult?: boolean;
  } = {}
): Vector3[] {
  const from: Vector3 = options.startPosition
    ? { x: options.startPosition.x, y: options.startPosition.y ?? 0, z: options.startPosition.z }
    : { x: unit.position.x, y: unit.position.y ?? 0, z: unit.position.z };
  const startY = from.y;
  const endY = destination.y ?? 0;

  // 1. Board clamping: ensure destination is within board boundaries
  const halfW = (state.board.width * state.board.gridSize) / 2 - 0.25;
  const halfH = (state.board.height * state.board.gridSize) / 2 - 0.25;
  const target: Vector3 = {
    x: Math.max(-halfW, Math.min(halfW, destination.x)),
    y: endY,
    z: Math.max(-halfH, Math.min(halfH, destination.z)),
  };

  // 2. Fast path: check if straight line [from, target] is unblocked AND surface-constrained
  const isDirectSurfaceValid =
    isSegmentSurfaceConstrained(state, from, target, unit) && isOrdinarySegment(state, from, target, unit);
  if (isDirectSurfaceValid) {
    const directCheck = findMoveBlocker(state, unit, [from, target], options);
    if (!directCheck.blocked) {
      const dist = Math.hypot(target.x - from.x, endY - startY, target.z - from.z);

      // If stopBeforeDifficult is requested, check if the segment enters difficult terrain
      if (
        options.stopBeforeDifficult &&
        !hasTrait(unit.specialRules, 'pathfinder') &&
        !hasTrait(unit.specialRules, 'airborne') &&
        dist > 6.0
      ) {
        const p2Piece = findTerrainAtPosition(state, target);
        const isP2Difficult =
          p2Piece &&
          (p2Piece.isDifficult ||
            p2Piece.terrainType === 'mud' ||
            p2Piece.terrainType === 'trench' ||
            p2Piece.terrainType === 'forest');

        const p1Piece = findTerrainAtPosition(state, from);
        const isP1Difficult =
          p1Piece &&
          (p1Piece.isDifficult ||
            p1Piece.terrainType === 'mud' ||
            p1Piece.terrainType === 'trench' ||
            p1Piece.terrainType === 'forest');

        if (isP2Difficult && !isP1Difficult) {
          const entryPt = findDifficultTerrainEntry(from, target, p2Piece);
          if (entryPt) {
            const dEntry = Math.hypot(entryPt.x - from.x, (entryPt.y ?? 0) - startY, entryPt.z - from.z);
            if (dEntry <= maxDistance + 1e-4) {
              return [from, entryPt];
            }
          }
        }
      }

      if (dist <= maxDistance + 1e-4) {
        return settleEnd(state, unit, [from, target]);
      }
      const ratio = maxDistance / dist;
      return settleEnd(state, unit, [
        from,
        {
          x: Math.round((from.x + (target.x - from.x) * ratio) * 100) / 100,
          y: Math.round((startY + (endY - startY) * ratio) * 100) / 100,
          z: Math.round((from.z + (target.z - from.z) * ratio) * 100) / 100,
        },
      ]);
    }
  }

  // 3. Waypoint generation
  const clearance = UNIT_COLLISION_RADIUS + 0.12; // ~0.47" clearance
  const candidateWaypoints: Vector3[] = [];

  // 3a. Stairs and Ladders waypoints (accurate foot and head)
  for (const piece of state.terrain) {
    const isRampOrStairs =
      piece.terrainType === 'stairs' ||
      piece.terrainType === 'ladder' ||
      piece.climbType === 'stairs' ||
      piece.climbType === 'ladder' ||
      piece.climbType === 'ramp';
    if (isRampOrStairs) {
      const { foot, head } = getStairWaypoints(state, piece);
      candidateWaypoints.push(foot);
      candidateWaypoints.push(head);
      if (isLadderPiece(piece)) candidateWaypoints.push({ x: foot.x, y: head.y, z: foot.z }); // top of the climb line
      if (isStairPiece(piece)) {
        // Clearance points round the wedge's footprint corners, so a unit beside the stairs can walk round to
        // the foot (a straight line from the side is blocked by the wedge body).
        const { hx, hz } = terrainHalfExtents(piece);
        const off = UNIT_COLLISION_RADIUS + 0.12;
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const w = localToWorldXZ(piece, sx * (hx + off), sz * (hz + off));
            if (Math.abs(w.x) <= halfW && Math.abs(w.z) <= halfH) {
              candidateWaypoints.push({
                x: Math.round(w.x * 100) / 100,
                y: piece.position.y ?? 0,
                z: Math.round(w.z * 100) / 100,
              });
            }
          }
        }
      }
    }
  }

  // Drop spots come in pairs (over-air point at floor height, ground point below it). Only the descent from one
  // to the other is a legal edge, so these points can never serve as a stepping stone for climbing.
  const dropTwin = new Map<Vector3, Vector3>();
  const dropAirPts = new Set<Vector3>();
  // A climb is a drop in reverse: from the ground spot straight up to the over-air spot (climbable floors up to 3" only)
  const climbUp = new Map<Vector3, Vector3>();

  // 3b. Walkable floors (decks, catwalks, ledges) & wall-base ascent fallback
  const allSurfaces = collectWalkableSurfaces(state);
  /** Highest walkable floor under (x, z) that is well below `belowY` (the drop/climb lower level), or null for the ground. */
  const floorsUnder = (x: number, z: number, belowY: number) => {
    let best: (typeof allSurfaces)[number] | null = null;
    for (const s of allSurfaces) {
      if (s.topY > belowY - 0.5 || s.topY <= 0.3) continue;
      if (best && s.topY <= best.topY) continue;
      const hit = findWalkableSurfaceIn([s], { x, z, y: s.topY }, 0);
      if (hit) best = s;
    }
    return best;
  };
  for (const piece of state.terrain) {
    const surfaces = getWalkableSurfaces(piece);
    if (surfaces.length === 0) continue;

    // Deck corners and edge midpoints at floor height (local -> world with the collision convention)
    for (const surface of surfaces) {
      for (const pt of getDeckPoints(piece, surface)) {
        if (Math.abs(pt.x) <= halfW && Math.abs(pt.z) <= halfH) candidateWaypoints.push(pt);
      }
    }

    // Drop points: step a full base off an edge (DROP_STANDOFF) at floor height, then fall to the ground
    // below. The edge midpoints plus the edge points nearest the start and the target.
    for (const surface of surfaces) {
      const platY = surface.topY;
      if (platY <= 0.5) continue;
      const midX = (surface.minX + surface.maxX) / 2;
      const midZ = (surface.minZ + surface.maxZ) / 2;
      const edgeSpots: Array<{ x: number; z: number; nx: number; nz: number }> = [
        { x: midX, z: surface.minZ, nx: 0, nz: -1 },
        { x: midX, z: surface.maxZ, nx: 0, nz: 1 },
        { x: surface.minX, z: midZ, nx: -1, nz: 0 },
        { x: surface.maxX, z: midZ, nx: 1, nz: 0 },
      ];
      for (const ref of [from, target]) {
        const l = worldToLocal(piece, ref);
        const cx = Math.max(surface.minX, Math.min(surface.maxX, l.x));
        const cz = Math.max(surface.minZ, Math.min(surface.maxZ, l.z));
        const gaps = [
          { d: cx - surface.minX, x: surface.minX, z: cz, nx: -1, nz: 0 },
          { d: surface.maxX - cx, x: surface.maxX, z: cz, nx: 1, nz: 0 },
          { d: cz - surface.minZ, x: cx, z: surface.minZ, nx: 0, nz: -1 },
          { d: surface.maxZ - cz, x: cx, z: surface.maxZ, nx: 0, nz: 1 },
        ];
        gaps.sort((a, b) => a.d - b.d);
        edgeSpots.push(gaps[0]);
      }
      for (const e of edgeSpots) {
        const ox = e.x + e.nx * DROP_STANDOFF;
        const oz = e.z + e.nz * DROP_STANDOFF;
        const edgeW = localToWorldXZ(piece, e.x, e.z);
        const outW = localToWorldXZ(piece, ox, oz);
        if (Math.abs(outW.x) > halfW || Math.abs(outW.z) > halfH) continue;
        const r2 = (n: number) => Math.round(n * 100) / 100;
        // The lower twin stands on the highest floor under the stand-off spot (a deck a container is stacked
        // on), else the ground; it must itself be a legal standing spot
        const lowerSurface = floorsUnder(outW.x, outW.z, platY);
        const lowerY = lowerSurface ? lowerSurface.topY : 0;
        const airPt = { x: r2(outW.x), y: platY, z: r2(outW.z) };
        const groundPt = { x: r2(outW.x), y: lowerY, z: r2(outW.z) };
        if (lowerY > 0.3 && isBaseOverhanging(state, groundPt, allSurfaces)) continue;
        candidateWaypoints.push({ x: r2(edgeW.x), y: platY, z: r2(edgeW.z) });
        candidateWaypoints.push(airPt, groundPt);
        dropTwin.set(airPt, groundPt);
        dropTwin.set(groundPt, airPt);
        dropAirPts.add(airPt);
        if (isClimbable(piece) && platY - lowerY <= CLIMB_MAX) climbUp.set(groundPt, airPt);
      }
    }

  }

  // 3c. Ground Obstacles
  for (const piece of state.terrain) {
    if (!piece.isObstacle) continue;
    const pieceBaseY = piece.position.y ?? 0;

    const addLocalBoxCorners = (minX: number, maxX: number, minZ: number, maxZ: number) => {
      const corners = [
        { x: minX - clearance, z: minZ - clearance },
        { x: maxX + clearance, z: minZ - clearance },
        { x: maxX + clearance, z: maxZ + clearance },
        { x: minX - clearance, z: maxZ + clearance },
      ];
      for (const c of corners) {
        const { x: wx, z: wz } = localToWorldXZ(piece, c.x, c.z);
        if (Math.abs(wx) <= halfW && Math.abs(wz) <= halfH) {
          candidateWaypoints.push({
            x: Math.round(wx * 100) / 100,
            y: pieceBaseY,
            z: Math.round(wz * 100) / 100,
          });
        }
      }
    };

    for (const solid of resolveTerrainStructure(piece).solids) {
      // Overhead boxes (lintels) don't obstruct walking beneath them.
      if (!solid.isObstacle || solid.minY >= 1.2) continue;
      addLocalBoxCorners(solid.minX, solid.maxX, solid.minZ, solid.maxZ);
    }

    if (piece.terrainType === 'wall-doorway') {
      candidateWaypoints.push({
        x: piece.position.x,
        y: pieceBaseY,
        z: piece.position.z,
      });
    } else if (piece.terrainType === 'ruin-l' || piece.terrainType === 'ruin') {
      const court = localToWorldXZ(piece, 1.0, -1.0);
      candidateWaypoints.push({
        x: Math.round(court.x * 100) / 100,
        y: pieceBaseY,
        z: Math.round(court.z * 100) / 100,
      });
    }
  }

  // 3d. Other fighters clearance
  for (const other of state.units) {
    if (other.isDestroyed || other.id === unit.id || other.id === options.ignoreUnitId) {
      continue;
    }
    const otherY = other.position.y ?? 0;
    const fR = UNIT_SEPARATION_DISTANCE + 0.12;
    const offsets = [
      { x: fR, z: 0 },
      { x: -fR, z: 0 },
      { x: 0, z: fR },
      { x: 0, z: -fR },
    ];
    for (const off of offsets) {
      const wx = other.position.x + off.x;
      const wz = other.position.z + off.z;
      if (Math.abs(wx) <= halfW && Math.abs(wz) <= halfH) {
        candidateWaypoints.push({ x: wx, y: otherY, z: wz });
      }
    }
  }

  // Filter out any waypoint that is inside a solid obstacle (unless it's a climb connector or on a platform)
  const validWaypoints: Vector3[] = [];
  for (const wp of candidateWaypoints) {
    const wpY = wp.y ?? 0;
    // Don't filter out stairs/ladder points
    if (isSegmentOnRampOrStairs(state, wp, wp)) {
      validWaypoints.push(wp);
      continue;
    }
    const blk = findMoveBlocker(state, unit, [wp, { x: wp.x + 0.001, y: wpY, z: wp.z }], options);
    if (!blk.blocked) {
      validWaypoints.push(wp);
    }
  }

  // 4. A* Search
  /** Movement cost of the edge a -> b if it is ordinary (test-free) movement, otherwise null. */
  const hangCache = new Map<Vector3, boolean>();
  const hangs = (p: Vector3): boolean => {
    let h = hangCache.get(p);
    if (h === undefined) {
      h = (p.y ?? 0) >= 1.0 && isSuspendedInMidAir(state, p);
      hangCache.set(p, h);
    }
    return h;
  };
  const safeEdgeCost = (a: Vector3, b: Vector3): number | null => {
    if (isShortLadderDescentStep(state, a, b)) return null; // a short ladder is climbed up; down it is just a drop
    // Two points over open air (a drop's step-off spots) must not be chained: short gaps would add up to a jump
    if (Math.abs((a.y ?? 0) - (b.y ?? 0)) <= 0.5 && hangs(a) && hangs(b)) return null;
    const cls = classifySegment(state, a, b, unit);
    return PLANNABLE_KINDS.includes(cls.kind) ? cls.cost : null;
  };

  interface Node {
    pos: Vector3;
    g: number;
    h: number;
    f: number;
    parent?: Node;
  }

  const startNode: Node = {
    pos: from,
    g: 0,
    h: Math.hypot(target.x - from.x, target.z - from.z),
    f: 0,
  };
  startNode.f = startNode.h;

  const targetNode: Node = { pos: target, g: Infinity, h: 0, f: Infinity };
  const allNodes: Node[] = [
    startNode,
    targetNode,
    ...validWaypoints.map((p) => ({
      pos: p,
      g: Infinity,
      h: Math.hypot(target.x - p.x, target.z - p.z), // horizontal: drops cost only their horizontal distance
      f: Infinity,
    })),
  ];

  const openSet: Node[] = [startNode];
  const closedSet = new Set<Node>();
  let foundTarget: Node | null = null;

  while (openSet.length > 0) {
    openSet.sort((a, b) => a.f - b.f);
    const current = openSet.shift()!;
    if (
      current === targetNode ||
      Math.hypot(
        current.pos.x - target.x,
        (current.pos.y ?? 0) - endY,
        current.pos.z - target.z
      ) < 0.05
    ) {
      foundTarget = current;
      break;
    }
    closedSet.add(current);

    // Try direct link to target if surface-constrained
    if (
      !closedSet.has(targetNode) &&
      isSegmentSurfaceConstrained(state, current.pos, targetNode.pos, unit)
    ) {
      const directBlk = findMoveBlocker(state, unit, [current.pos, targetNode.pos], options);
      const directCost = directBlk.blocked ? null : safeEdgeCost(current.pos, targetNode.pos);
      if (directCost !== null) {
        const tentG = current.g + directCost;
        if (tentG < targetNode.g) {
          targetNode.g = tentG;
          targetNode.f = tentG;
          targetNode.parent = current;
          if (!openSet.includes(targetNode)) openSet.push(targetNode);
        }
      }
    }

    for (const neighbor of allNodes) {
      if (neighbor === current || closedSet.has(neighbor) || neighbor === startNode) continue;
      const d = Math.hypot(
        neighbor.pos.x - current.pos.x,
        (neighbor.pos.y ?? 0) - (current.pos.y ?? 0),
        neighbor.pos.z - current.pos.z
      );
      if (d > 16.0) continue;

      // Drop spots only link level (walking) or from their air point straight down to their ground twin
      const dropSpot = dropTwin.has(neighbor.pos) || dropTwin.has(current.pos);
      if (dropSpot) {
        const dyAbs = Math.abs((neighbor.pos.y ?? 0) - (current.pos.y ?? 0));
        const isTwinDescent =
          dropAirPts.has(current.pos) && dropTwin.get(current.pos) === neighbor.pos;
        const isTwinClimb = climbUp.get(current.pos) === neighbor.pos;
        if (dyAbs > 0.35 && !isTwinDescent && !isTwinClimb) continue;
        if (dropTwin.get(current.pos) === neighbor.pos && !isTwinDescent && !isTwinClimb) continue;
      }

      // Surface constraint check: non-airborne cannot fly diagonally across open air
      if (!isSegmentSurfaceConstrained(state, current.pos, neighbor.pos, unit)) {
        continue;
      }

      const blk = findMoveBlocker(state, unit, [current.pos, neighbor.pos], options);
      if (blk.blocked) continue;

      // Only ordinary movement is in the graph: walking, stairs, ladders, drops of 3" or less and gaps of 1" or
      // less. Jumps and falls are never planned; climbs only onto climbable floors.
      const edgeCost = safeEdgeCost(current.pos, neighbor.pos);
      if (edgeCost === null) continue;

      const tentativeG = current.g + edgeCost;
      if (tentativeG < neighbor.g) {
        neighbor.parent = current;
        neighbor.g = tentativeG;
        neighbor.f = tentativeG + neighbor.h;
        if (!openSet.includes(neighbor)) {
          openSet.push(neighbor);
        }
      }
    }
  }

  let rawPath: Vector3[];
  if (foundTarget) {
    const rev: Vector3[] = [];
    let cur: Node | undefined = foundTarget;
    while (cur) {
      rev.push({ ...cur.pos });
      cur = cur.parent;
    }
    rawPath = rev.reverse();
  } else {
    // If no path, clamp along current surface
    const flatTarget = hasTrait(unit.specialRules, 'airborne')
      ? destination
      : { ...destination, y: startY };
    const clamped = clampMoveDestinationWithObstacles(state, unit, flatTarget, maxDistance);
    // Never plan across a gap or off an edge: shorten the straight line to its ordinary (test-free) prefix
    let end: Vector3 = clamped;
    for (let t = 1; t > 0 && !isOrdinarySegment(state, from, end, unit); t -= 0.05) {
      end = {
        x: Math.round((from.x + (clamped.x - from.x) * t) * 100) / 100,
        y: clamped.y ?? startY,
        z: Math.round((from.z + (clamped.z - from.z) * t) * 100) / 100,
      };
      if (t <= 0.05) {
        end = { ...from };
        break;
      }
    }
    return settleEnd(state, unit, [from, end]);
  }

  // 5. String pulling / shortcutting (preserving surface constraints)
  const smoothed: Vector3[] = [rawPath[0]];
  let curIdx = 0;
  while (curIdx < rawPath.length - 1) {
    let furthest = curIdx + 1;
    for (let test = rawPath.length - 1; test > curIdx + 1; test--) {
      // Do not shortcut across elevation transitions if it bypasses an intermediate stair/ladder head or wall base
      const curY = rawPath[curIdx].y ?? 0;
      const testY = rawPath[test].y ?? 0;
      if (Math.abs(curY - testY) > 0.5 && !hasTrait(unit.specialRules, 'airborne')) {
        continue;
      }
      if (!isSegmentSurfaceConstrained(state, rawPath[curIdx], rawPath[test], unit)) {
        continue;
      }
      if (!isOrdinarySegment(state, rawPath[curIdx], rawPath[test], unit)) continue; // never shortcut over a gap
      const blk = findMoveBlocker(state, unit, [rawPath[curIdx], rawPath[test]], options);
      if (!blk.blocked) {
        furthest = test;
        break;
      }
    }
    smoothed.push(rawPath[furthest]);
    curIdx = furthest;
  }

  // 5b. Ladder climbs are vertical on the ladder's spine: walk to the foot, climb straight up (or down)
  // to the head, then continue. Without this, string-pulling can leave a slanted "climb" that starts
  // beside the ladder.
  const climbed: Vector3[] = [smoothed[0]];
  const sameSpot = (a: Vector3, b: Vector3) =>
    Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z) < 0.05;
  for (let i = 1; i < smoothed.length; i++) {
    const p1 = climbed[climbed.length - 1];
    const p2 = smoothed[i];
    if (Math.abs((p2.y ?? 0) - (p1.y ?? 0)) > 0.5 && !hasTrait(unit.specialRules, 'airborne')) {
      // A straight fall of up to 3" with clear air below is a free drop, not a ladder descent (the drop spot
      // a base off a deck edge and a ladder foot can share the same column)
      const isFreeFall =
        (p1.y ?? 0) - (p2.y ?? 0) > 0.5 &&
        (p1.y ?? 0) - (p2.y ?? 0) <= FREE_DROP_MAX &&
        Math.hypot(p2.x - p1.x, p2.z - p1.z) < 0.05 &&
        !isFallColumnBlocked(state, p1, p2);
      const ladder = isFreeFall ? null : findLadderForSegment(state, p1, p2);
      if (ladder) {
        const { foot, head } = getStairWaypoints(state, ladder);
        // Climb line: straight up/down above the foot, then a short level step to/from the head spot
        const top = { x: foot.x, y: head.y, z: foot.z };
        const goingUp = (p2.y ?? 0) > (p1.y ?? 0);
        const sequence = goingUp ? [foot, top, head] : [head, top, foot];
        // Ascent points sit on the deck face at the ladder itself; the standing spots replace them
        const atLadder = (pt: Vector3) =>
          Math.hypot(pt.x - ladder.position.x, pt.z - ladder.position.z) < 0.15;
        if (climbed.length > 1 && atLadder(p1)) climbed.pop();
        for (const pt of sequence) {
          if (!sameSpot(climbed[climbed.length - 1], pt)) climbed.push({ ...pt });
        }
        if (sequence.some((pt) => sameSpot(pt, p2))) continue;
        if (atLadder(p2) && i < smoothed.length - 1) continue;
      }
    }
    if (!sameSpot(climbed[climbed.length - 1], p2)) climbed.push(p2);
  }
  smoothed.length = 0;
  smoothed.push(...climbed);

  // 6. Cumulative distance clamping
  const result: Vector3[] = [{ ...smoothed[0] }];
  let distLeft = maxDistance;

  // Movement cost of a segment (same classification the host and the HUD use): drops cost their horizontal
  // distance only, the ladder shuffle is free, everything else is 3D length.
  const segCost = (a: Vector3, b: Vector3, prev?: Vector3): number => classifySegment(state, a, b, unit, prev).cost;

  let totalSmoothedLen = 0;
  for (let j = 1; j < smoothed.length; j++) {
    totalSmoothedLen += segCost(smoothed[j - 1], smoothed[j], smoothed[j - 2]);
  }

  for (let i = 1; i < smoothed.length; i++) {
    const p1 = smoothed[i - 1];
    const p2 = smoothed[i];
    const segLen = segCost(p1, p2, smoothed[i - 2]);

    // If stopBeforeDifficult is requested (e.g. for Rush actions where entering difficult terrain
    // would negate double speed and cap movement to 6"), stop
    // before difficult terrain pieces if the full traversal would exceed 6.0".
    if (
      options.stopBeforeDifficult &&
      !hasTrait(unit.specialRules, 'pathfinder') &&
      !hasTrait(unit.specialRules, 'airborne')
    ) {
      const p2Piece = findTerrainAtPosition(state, p2);
      const isP2Difficult =
        p2Piece &&
        (p2Piece.isDifficult ||
          p2Piece.terrainType === 'mud' ||
          p2Piece.terrainType === 'trench' ||
          p2Piece.terrainType === 'forest');

      const p1Piece = findTerrainAtPosition(state, p1);
      const isP1Difficult =
        p1Piece &&
        (p1Piece.isDifficult ||
          p1Piece.terrainType === 'mud' ||
          p1Piece.terrainType === 'trench' ||
          p1Piece.terrainType === 'forest');

      const isEnteringDifficult = isP2Difficult && !isP1Difficult;

      if (isEnteringDifficult && totalSmoothedLen > 6.0) {
        if (p2Piece) {
          const entryPt = findDifficultTerrainEntry(p1, p2, p2Piece);
          if (entryPt) {
            const dEntry = Math.hypot(entryPt.x - p1.x, (entryPt.y ?? 0) - (p1.y ?? 0), entryPt.z - p1.z);
            if (dEntry <= distLeft + 1e-4) {
              result.push(entryPt);
            }
          }
        }
        break;
      }
    }

    if (segLen <= distLeft + 1e-4) {
      result.push({
        x: Math.round(p2.x * 100) / 100,
        y: Math.round((p2.y ?? 0) * 100) / 100,
        z: Math.round(p2.z * 100) / 100,
      });
      distLeft -= segLen;
    } else {
      const y1 = p1.y ?? 0;
      const y2 = p2.y ?? 0;
      const isSheerWallClimb =
        y2 - y1 > 0.5 &&
        !hasTrait(unit.specialRules, 'airborne') &&
        !isSegmentOnRampOrStairs(state, p1, p2);
      if (isSheerWallClimb) {
        // Cannot end activation suspended in mid-air on a sheer vertical wall; stop at the wall base (p1)
        break;
      }
      const isLadderClimb =
        Math.abs(y2 - y1) > 0.5 &&
        !hasTrait(unit.specialRules, 'airborne') &&
        isSegmentOnLadder(state, p1, p2);
      if (isLadderClimb) {
        // Tabletop ladder rules: models scaling vertical ladders must have sufficient movement budget to reach the landing platform deck;
        // if movement is insufficient, the model remains at the ladder foot (p1) rather than hanging suspended on rungs.
        break;
      }
      // The step off an edge (level, over open air) is part of the drop: if the budget can't cover the step
      // and the fall, the model stays at the edge instead of stopping with its base over the air.
      const nextPt = smoothed[i + 1];
      const isStepOffBeforeDrop =
        !hasTrait(unit.specialRules, 'airborne') &&
        Math.abs(y1 - y2) <= 0.05 &&
        nextPt !== undefined &&
        classifySegment(state, p2, nextPt, unit).kind === 'drop' &&
        Math.hypot(nextPt.x - p2.x, nextPt.z - p2.z) < 0.05;
      if (isStepOffBeforeDrop) break;
      const isFreeDrop =
        y1 - y2 > 0.5 &&
        !hasTrait(unit.specialRules, 'airborne') &&
        classifySegment(state, p1, p2, unit).kind === 'drop';
      if (isFreeDrop) {
        // A drop is a step off an edge, not a slope: a model cannot stop hanging in mid-air part-way
        // down, so if the budget cannot finish the drop it stays at the edge (p1).
        break;
      }
      const ratio = distLeft / segLen;
      result.push({
        x: Math.round((p1.x + (p2.x - p1.x) * ratio) * 100) / 100,
        y: Math.round((y1 + (y2 - y1) * ratio) * 100) / 100,
        z: Math.round((p1.z + (p2.z - p1.z) * ratio) * 100) / 100,
      });
      break;
    }
  }

  return settleEnd(state, unit, result, maxDistance);
}

/**
 * Compute the 1" separation push-back position for a charging attacker after
 * melee resolution when both the attacker and defender survive.
 *
 * In tabletop rules, units do not stay locked in melee. The charger bounces
 * back to create a >= 1.0" gap directly away from the defender along the
 * attack line (with slight angular fan-out if terrain directly blocks straight back).
 */
export function computePushBackPosition(
  state: GameState,
  attacker: Unit,
  target: Unit,
  separationDistance: number = 2.0
): Vector3 {
  const halfW = (state.board.width * state.board.gridSize) / 2 - 0.25;
  const halfH = (state.board.height * state.board.gridSize) / 2 - 0.25;

  const dx = attacker.position.x - target.position.x;
  const dz = attacker.position.z - target.position.z;
  const len = Math.hypot(dx, dz) || 1;
  const baseAngle = Math.atan2(dx, dz);

  const elev = attacker.position.y ?? target.position.y ?? 0;

  // Test candidate angles: direct reverse, then slight lateral deviations (+-25 deg, +-50 deg, +-75 deg)
  const angleOffsets = [0, 0.44, -0.44, 0.87, -0.87, 1.3, -1.3];
  for (const offset of angleOffsets) {
    const angle = baseAngle + offset;
    const candidate: Vector3 = {
      x: Math.round((target.position.x + Math.sin(angle) * separationDistance) * 100) / 100,
      y: elev,
      z: Math.round((target.position.z + Math.cos(angle) * separationDistance) * 100) / 100,
    };
    if (Math.abs(candidate.x) > halfW || Math.abs(candidate.z) > halfH) continue;
    const blocker = findMoveBlocker(state, attacker, [attacker.position, candidate], {
      ignoreUnitId: target.id,
    });
    if (!blocker.blocked) {
      return candidate;
    }
  }

  // Fallback: clamp destination directly away
  const directCandidate: Vector3 = {
    x: Math.round((target.position.x + (dx / len) * separationDistance) * 100) / 100,
    y: elev,
    z: Math.round((target.position.z + (dz / len) * separationDistance) * 100) / 100,
  };
  return clampMoveDestinationWithObstacles(state, attacker, directCandidate, separationDistance);
}

// ============================================================================
// Multi-Model Squad Coherency & Formation Engine (Phase 9A)
// ============================================================================

export interface SquadCoherencyResult {
  coherent: boolean;
  reason?: string;
  maxDistanceBetweenModels?: number;
  maxDistanceToNearestMember?: number;
}

/**
 * Validates tabletop squad coherency according to Section 2.1:
 * 1. Every model must remain within 1.0" horizontal of at least one other squad member.
 * 1. Every model must remain within maxMemberDistance (<= 1.0" base gap, 2.0" center-to-center) of at least one other member.
 * 2. All models in the squad must remain within 6.0" horizontal of all other squad members (max pairwise spread <= 6.0").
 * Models may form separate pairs/sub-groups as long as each model has a buddy within 1.0" and squad spread <= 6.0".
 */
export function validateSquadCoherency(
  positions: Vector3[],
  options: {
    maxMemberDistance?: number;
    maxSquadSpread?: number;
  } = {}
): SquadCoherencyResult {
  const maxMemberDist = options.maxMemberDistance ?? 2.0;
  const maxSpread = options.maxSquadSpread ?? 6.0;
  const tolerance = 0.02; // Small floating-point margin for tabletop movement

  if (positions.length <= 1) {
    return { coherent: true, maxDistanceBetweenModels: 0, maxDistanceToNearestMember: 0 };
  }

  // 1. Check all pairs max squad spread (<= 6.0")
  let maxPairDist = 0;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dx = positions[i].x - positions[j].x;
      const dz = positions[i].z - positions[j].z;
      const d = Math.hypot(dx, dz);
      if (d > maxPairDist) maxPairDist = d;
      if (d > maxSpread + tolerance) {
        return {
          coherent: false,
          reason: `Squad model spread of ${d.toFixed(2)}" exceeds max coherency limit of ${maxSpread}"`,
          maxDistanceBetweenModels: d,
        };
      }
    }
  }

  // 2. Check every model is within maxMemberDistance (<= 1.0") of at least one other member
  let maxNearestDist = 0;

  for (let i = 0; i < positions.length; i++) {
    let nearestDist = Infinity;
    for (let j = 0; j < positions.length; j++) {
      if (i === j) continue;
      const dx = positions[i].x - positions[j].x;
      const dz = positions[i].z - positions[j].z;
      const d = Math.hypot(dx, dz);
      if (d < nearestDist) nearestDist = d;
    }
    if (nearestDist > maxNearestDist) maxNearestDist = nearestDist;
    if (nearestDist > maxMemberDist + tolerance) {
      return {
        coherent: false,
        reason: `Model ${i + 1} is ${nearestDist.toFixed(2)}" from nearest squad member (exceeds ${maxMemberDist}" limit)`,
        maxDistanceToNearestMember: nearestDist,
      };
    }
  }

  return {
    coherent: true,
    maxDistanceBetweenModels: Math.round(maxPairDist * 100) / 100,
    maxDistanceToNearestMember: Math.round(maxNearestDist * 100) / 100,
  };
}

/**
 * Computes the geometric centroid (average position) of squad model positions.
 */
export function computeSquadCentroid(positions: Vector3[]): Vector3 {
  if (positions.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  for (const pos of positions) {
    sumX += pos.x;
    sumY += pos.y ?? 0;
    sumZ += pos.z;
  }
  const n = positions.length;
  return {
    x: Math.round((sumX / n) * 100) / 100,
    y: Math.round((sumY / n) * 100) / 100,
    z: Math.round((sumZ / n) * 100) / 100,
  };
}

/**
 * Retrieves the current world positions of all living models in a unit.
 * If models have not yet been assigned individual positions, returns the unit anchor.
 */
export function getSquadModelPositions(unit: Unit): Vector3[] {
  if (!unit.models || unit.models.length === 0) {
    return [{ ...unit.position }];
  }
  const activeModels = unit.models.filter((m) => !m.isDestroyed);
  if (activeModels.length === 0) {
    return [{ ...unit.position }];
  }
  return activeModels.map((m) => (m.position ? { ...m.position } : { ...unit.position }));
}

/**
 * Procedurally generates coherent starting positions for a squad of `count` models
 * centered at `center`.
 * - 1 model: at `center`.
 * - 2 models: side-by-side with separation `spacing`.
 * - 3 models: equilateral triangle with edge length `spacing`.
 * - 4+ models: 1 central leader with remaining models arranged in a circle of radius `spacing`.
 */
export function createSquadPositions(
  center: Vector3,
  count: number,
  spacing: number = 1.4
): Vector3[] {
  if (count <= 1) {
    return [{ ...center }];
  }
  if (count === 2) {
    const half = Math.round((spacing / 2) * 100) / 100;
    return [
      { x: Math.round((center.x - half) * 100) / 100, y: center.y ?? 0, z: center.z },
      { x: Math.round((center.x + half) * 100) / 100, y: center.y ?? 0, z: center.z },
    ];
  }
  if (count === 3) {
    const radius = Math.round((spacing / Math.sqrt(3)) * 100) / 100;
    const angles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
    return angles.map((a) => ({
      x: Math.round((center.x + Math.sin(a) * radius) * 100) / 100,
      y: center.y ?? 0,
      z: Math.round((center.z + Math.cos(a) * radius) * 100) / 100,
    }));
  }
  // 4+ models: 1 leader in center, others in ring
  const ringCount = count - 1;
  const positions: Vector3[] = [{ ...center }];
  for (let i = 0; i < ringCount; i++) {
    const a = (i * 2 * Math.PI) / ringCount;
    positions.push({
      x: Math.round((center.x + Math.sin(a) * spacing) * 100) / 100,
      y: center.y ?? 0,
      z: Math.round((center.z + Math.cos(a) * spacing) * 100) / 100,
    });
  }
  return positions;
}

export interface FormationMoveResult {
  valid: boolean;
  reason?: string;
  destination: Vector3;
  modelPositions: Vector3[];
}

/**
 * Validates movement destination and formation positions for a multi-model squad.
 * If modelPositions are omitted, performs rigid translation from the squad's current positions.
 */
export function validateFormationMove(
  state: GameState,
  unit: Unit,
  destination: Vector3,
  modelPositions?: Vector3[],
  maxDistance: number = unit.remainingMovement
): FormationMoveResult {
  const currentPositions = getSquadModelPositions(unit);
  let resolvedPositions: Vector3[];

  if (modelPositions && modelPositions.length > 0) {
    if (modelPositions.length !== currentPositions.length) {
      return {
        valid: false,
        reason: `Formation count mismatch: received ${modelPositions.length} positions for ${currentPositions.length} active models`,
        destination,
        modelPositions: currentPositions,
      };
    }
    const coherency = validateSquadCoherency(modelPositions);
    if (!coherency.coherent) {
      return {
        valid: false,
        reason: coherency.reason ?? 'Formation violates coherency',
        destination,
        modelPositions,
      };
    }
    resolvedPositions = modelPositions;
  } else {
    // Rigid translation
    const deltaX = destination.x - unit.position.x;
    const deltaZ = destination.z - unit.position.z;
    resolvedPositions = currentPositions.map((pos) => ({
      x: Math.round((pos.x + deltaX) * 100) / 100,
      y: destination.y ?? pos.y ?? 0,
      z: Math.round((pos.z + deltaZ) * 100) / 100,
    }));
  }

  // Check board boundaries for all models
  const halfW = (state.board.width * state.board.gridSize) / 2;
  const halfH = (state.board.height * state.board.gridSize) / 2;
  for (let i = 0; i < resolvedPositions.length; i++) {
    const p = resolvedPositions[i];
    if (Math.abs(p.x) > halfW || Math.abs(p.z) > halfH) {
      return {
        valid: false,
        reason: `Model ${i + 1} position leaves the battlefield`,
        destination,
        modelPositions: resolvedPositions,
      };
    }
  }

  const finalCentroid = computeSquadCentroid(resolvedPositions);
  const moveDist = Math.hypot(finalCentroid.x - unit.position.x, finalCentroid.z - unit.position.z);
  if (moveDist > maxDistance + 0.02) {
    return {
      valid: false,
      reason: `Formation move distance of ${moveDist.toFixed(2)}" exceeds allowance of ${maxDistance}"`,
      destination: finalCentroid,
      modelPositions: resolvedPositions,
    };
  }

  return {
    valid: true,
    destination: finalCentroid,
    modelPositions: resolvedPositions,
  };
}

/**
 * Consolidates surviving models in a unit up to `maxDistance` toward `targetPosition`,
 * stopping at base contact (`UNIT_SEPARATION_DISTANCE = 1.0"`).
 */
export function consolidateSquadToward(
  state: GameState,
  unit: Unit,
  targetPosition: Vector3,
  maxDistance: number = 3.0,
  options: { intoContact?: boolean } = {}
): void {
  const intoContact = options.intoContact ?? false;
  const contactThreshold = 1.0;
  const targetContactDist = UNIT_SEPARATION_DISTANCE; // 1.0" base contact

  if (intoContact) {
    if (!unit.models || unit.models.length <= 1) {
      return;
    }

    let movedAny = false;
    for (const model of unit.models) {
      if (model.isDestroyed) continue;
      const mPos = model.position ?? unit.position;
      const dx = targetPosition.x - mPos.x;
      const dz = targetPosition.z - mPos.z;
      const dist = Math.hypot(dx, dz);
      // Only models outside contact (> 1.0") consolidate into contact
      if (dist > contactThreshold) {
        movedAny = true;
        const allowed = Math.min(maxDistance, dist - targetContactDist);
        model.position = {
          x: Math.round((mPos.x + (dx / dist) * allowed) * 100) / 100,
          y: mPos.y ?? 0,
          z: Math.round((mPos.z + (dz / dist) * allowed) * 100) / 100,
        };
      }
    }
    if (movedAny) {
      unit.position = computeSquadCentroid(getSquadModelPositions(unit));
    }
    return;
  }

  // Victory consolidation move (advancing up to maxDistance toward / through target position)
  const dx = targetPosition.x - unit.position.x;
  const dz = targetPosition.z - unit.position.z;
  const dist = Math.hypot(dx, dz);
  const dirX = dist > 1e-4 ? dx / dist : Math.sin(unit.rotation.y || 0);
  const dirZ = dist > 1e-4 ? dz / dist : Math.cos(unit.rotation.y || 0);
  const allowed = maxDistance;

  const targetCandidate: Vector3 = {
    x: Math.round((unit.position.x + dirX * allowed) * 100) / 100,
    y: unit.position.y ?? 0,
    z: Math.round((unit.position.z + dirZ * allowed) * 100) / 100,
  };
  const clamped = clampMoveDestinationWithObstacles(state, unit, targetCandidate, maxDistance);
  const deltaX = clamped.x - unit.position.x;
  const deltaZ = clamped.z - unit.position.z;
  unit.position = { ...clamped };

  if (unit.models && unit.models.length > 0) {
    for (const model of unit.models) {
      if (model.isDestroyed) continue;
      const mPos = model.position ?? unit.position;
      model.position = {
        x: Math.round((mPos.x + deltaX) * 100) / 100,
        y: clamped.y ?? mPos.y ?? 0,
        z: Math.round((mPos.z + deltaZ) * 100) / 100,
      };
    }
  }
}

