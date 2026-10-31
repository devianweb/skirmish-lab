import { GameState, TerrainPiece, Unit } from '../gameTypes';
import { Vector3 } from '../types';

/**
 * Pure 2D spatial geometry on the XZ board plane for movement collision,
 * obstacle clamping, OPR-style Line of Sight (LoS), and visibility fan
 * computation. Shared between the host rules engine and the client renderer
 * so visual LoS shadows and path clamping match host validation identically.
 */

/** Base collision radius of a fighter for movement blocking (board units). */
export const UNIT_COLLISION_RADIUS = 0.25;
/** Minimum center-to-center distance between two fighters during movement. */
export const UNIT_SEPARATION_DISTANCE = 0.6;
/** Base radius of a fighter for Line of Sight blocking (board units). */
export const LOS_UNIT_RADIUS = 0.4;

/** Local XZ half-extents of a terrain piece before rotation. */
export function terrainHalfExtents(piece: TerrainPiece): { hx: number; hz: number } {
  const sx = Math.max(0.05, piece.scale.x);
  const sz = Math.max(0.05, piece.scale.z);
  if (
    piece.terrainType === 'wall' ||
    piece.terrainType === 'wall-window' ||
    piece.terrainType === 'wall-doorway'
  ) {
    return { hx: 0.5 * sx, hz: 0.5 * sz };
  }
  if (piece.terrainType === 'column') {
    return { hx: 0.25 * sx, hz: 0.25 * sz };
  }
  if (piece.terrainType === 'crate') {
    return { hx: 0.35 * sx, hz: 0.35 * sz };
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
      const pieceTopY = piece.elevation !== undefined ? piece.elevation : pieceBaseY + pieceHeight;

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

export interface ApertureRayResult {
  hitPiece: boolean;
  passesAperture: boolean;
  hitsJamb: boolean;
  tEntry?: number;
  tExit?: number;
}

/**
 * Check whether a ray hits the solid jambs of an aperture piece (wall-doorway or wall-window)
 * or passes through the central 1.0" opening (|localX| <= 0.5).
 */
export function intersectAperturePiece(
  origin: Vector3,
  dirX: number,
  dirZ: number,
  maxDist: number,
  piece: TerrainPiece,
  margin: number = 0
): ApertureRayResult {
  const { hx, hz } = terrainHalfExtents(piece);
  const yaw = piece.rotation.y || 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const dx = origin.x - piece.position.x;
  const dz = origin.z - piece.position.z;

  const localOx = dx * cos - dz * sin;
  const localOz = dx * sin + dz * cos;
  const localDx = dirX * cos - dirZ * sin;
  const localDz = dirX * sin + dirZ * cos;

  const overall = intersectLocalBox(
    localOx,
    localOz,
    localDx,
    localDz,
    -hx - margin,
    hx + margin,
    -hz - margin,
    hz + margin,
    maxDist
  );
  if (!overall) {
    return { hitPiece: false, passesAperture: false, hitsJamb: false };
  }

  const apertureHalfWidth = 0.5; // Central 1.0" opening
  const leftJamb = intersectLocalBox(
    localOx,
    localOz,
    localDx,
    localDz,
    -hx - margin,
    -apertureHalfWidth + margin,
    -hz - margin,
    hz + margin,
    maxDist
  );
  const rightJamb = intersectLocalBox(
    localOx,
    localOz,
    localDx,
    localDz,
    apertureHalfWidth - margin,
    hx + margin,
    -hz - margin,
    hz + margin,
    maxDist
  );

  const hitsJamb = !!(leftJamb || rightJamb);
  const apertureHit = intersectLocalBox(
    localOx,
    localOz,
    localDx,
    localDz,
    -apertureHalfWidth,
    apertureHalfWidth,
    -hz,
    hz,
    maxDist
  );
  const passesAperture = !!apertureHit && !hitsJamb;

  return {
    hitPiece: true,
    passesAperture,
    hitsJamb,
    tEntry: overall.tEntry,
    tExit: overall.tExit,
  };
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
    if (segLen < 1e-6) continue;
    const dirX = dx / segLen;
    const dirZ = dz / segLen;

    const fromY = from.y ?? 0;
    const toY = to.y ?? 0;
    const minSegY = Math.min(fromY, toY);
    const maxSegY = Math.max(fromY, toY);

    for (const piece of state.terrain) {
      if (!piece.isObstacle) continue;

      const pieceBaseY = piece.position.y ?? 0;
      const pieceHeight = piece.scale.y ?? 1.0;
      const pieceTopY = piece.elevation !== undefined ? piece.elevation : pieceBaseY + pieceHeight;

      // 1. If piece is walkable or an elevated platform, moving on top does not collide with the obstacle
      if (piece.isWalkable || piece.elevation !== undefined) {
        if (minSegY >= (piece.elevation ?? pieceTopY) - 0.15) {
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

      if (piece.terrainType === 'wall-doorway') {
        const ap = intersectAperturePiece(from, dirX, dirZ, segLen, piece, UNIT_COLLISION_RADIUS);
        if (
          ap.hitsJamb &&
          ap.tExit !== undefined &&
          ap.tExit > 0.02 &&
          (ap.tEntry === undefined || ap.tEntry > 0.001 || ap.tExit >= segLen - 0.02)
        ) {
          return { blocked: true, reason: 'Move path is blocked by terrain' };
        }
        continue;
      }
      const hit = intersectRayTerrain(from, dirX, dirZ, segLen, piece, UNIT_COLLISION_RADIUS);
      // Allow moving away if the start point happened to touch the margin,
      // but block entering or crossing through the obstacle.
      if (hit && hit.tExit > 0.02 && (hit.tEntry > 0.001 || hit.tExit >= segLen - 0.02)) {
        return { blocked: true, reason: 'Move path is blocked by terrain' };
      }
    }

    for (const other of state.units) {
      if (other.isDestroyed || other.id === movingUnit.id || other.id === options.ignoreUnitId) {
        continue;
      }
      const otherY = other.position.y ?? 0;
      // Fighters on separate vertical tiers (> 1.8" difference) don't block each other
      if (Math.abs(minSegY - otherY) >= 1.8 && Math.abs(maxSegY - otherY) >= 1.8) {
        continue;
      }

      const hit = intersectRayCircle(
        from,
        dirX,
        dirZ,
        segLen,
        other.position,
        UNIT_SEPARATION_DISTANCE
      );
      const endDist = Math.hypot(to.x - other.position.x, to.z - other.position.z);
      if (
        endDist < UNIT_SEPARATION_DISTANCE - 0.01 ||
        (hit && hit.tExit > 0.02 && hit.tEntry > 0.001)
      ) {
        return { blocked: true, reason: 'Move path is blocked by another fighter' };
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
      if (!piece.isObstacle) continue;
      const pieceBaseY = piece.position.y ?? 0;
      const pieceHeight = piece.scale.y ?? 1.0;
      const pieceTopY = piece.elevation !== undefined ? piece.elevation : pieceBaseY + pieceHeight;

      if (piece.isWalkable || piece.elevation !== undefined) {
        if (Math.min(startY, y) >= (piece.elevation ?? pieceTopY) - 0.15) {
          continue;
        }
      }
      if (Math.min(startY, y) >= pieceTopY - 0.05) {
        continue;
      }
      if (pieceBaseY >= Math.max(startY, y) + 1.2) {
        continue;
      }

      const hit = intersectRayTerrain(
        unit.position,
        dirX,
        dirZ,
        allowedDist,
        piece,
        UNIT_COLLISION_RADIUS
      );
      if (hit && hit.tExit > 0.02 && hit.tEntry > 0.001) {
        allowedDist = Math.min(allowedDist, Math.max(0, hit.tEntry - 0.05));
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
  const platform = findWalkablePlatformAt(state, candPoint);
  if (platform && platform.elevation !== undefined && y >= platform.elevation - 0.5) {
    y = platform.elevation;
  } else if (!platform && y < 0.5) {
    y = 0;
  }

  return {
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    z: Math.round(z * 100) / 100,
  };
}

/**
 * Finds a walkable elevated platform terrain piece at `point`.
 */
export function findWalkablePlatformAt(state: GameState, point: Vector3): TerrainPiece | null {
  for (const piece of state.terrain) {
    if (
      piece.isWalkable ||
      piece.terrainType === 'platform' ||
      piece.terrainType === 'floor' ||
      (piece.elevation !== undefined && piece.elevation > 0)
    ) {
      const { hx, hz } = terrainHalfExtents(piece);
      const yaw = piece.rotation.y || 0;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const dx = point.x - piece.position.x;
      const dz = point.z - piece.position.z;
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;
      if (Math.abs(localX) <= hx + 0.1 && Math.abs(localZ) <= hz + 0.1) {
        return piece;
      }
    }
  }
  return null;
}

/**
 * Distance from an elevated point on a platform to the platform's perimeter edge
 * in the direction toward another point on the XZ plane.
 */
export function getPlatformEdgeDistance(
  point: Vector3,
  toward: Vector3,
  platform: TerrainPiece
): number {
  const { hx, hz } = terrainHalfExtents(platform);
  const yaw = platform.rotation.y || 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);

  const dx = toward.x - point.x;
  const dz = toward.z - point.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-4) return 0;

  const dirX = dx / dist;
  const dirZ = dz / dist;

  const ox = point.x - platform.position.x;
  const oz = point.z - platform.position.z;
  const localOx = ox * cos - oz * sin;
  const localOz = ox * sin + oz * cos;
  const localDx = dirX * cos - dirZ * sin;
  const localDz = dirX * sin + dirZ * cos;

  let tExit = Infinity;
  if (localDx > 1e-6) {
    tExit = Math.min(tExit, (hx - localOx) / localDx);
  } else if (localDx < -1e-6) {
    tExit = Math.min(tExit, (-hx - localOx) / localDx);
  }

  if (localDz > 1e-6) {
    tExit = Math.min(tExit, (hz - localOz) / localDz);
  } else if (localDz < -1e-6) {
    tExit = Math.min(tExit, (-hz - localOz) / localDz);
  }

  return Math.max(0, tExit === Infinity ? 0 : tExit);
}

/**
 * OPR-style Line of Sight check between `attacker` and `target`.
 *
 * Line of Sight is blocked by:
 *   1. Any terrain piece with `blocksLineOfSight: true` (walls, columns).
 *   2. Any other living fighter on the board (friendly or enemy not part of
 *      the attacker/target pair).
 *   3. 3D roof floor plane blind spots for models set back > 1.0" from platform edges.
 */
export function hasLineOfSight(state: GameState, attacker: Unit, target: Unit): boolean {
  const dx = target.position.x - attacker.position.x;
  const dz = target.position.z - attacker.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-4) return true;

  const attackerY = attacker.position.y ?? 0;
  const targetY = target.position.y ?? 0;

  // Setback Blind Spot:
  // If target is elevated >= 1.0" above attacker, check if target is set back from platform edge
  if (targetY >= attackerY + 1.0) {
    const platform = findWalkablePlatformAt(state, target.position);
    if (platform) {
      const setback = getPlatformEdgeDistance(target.position, attacker.position, platform);
      if (setback > 1.05) {
        return false; // Ground shooter's sight is blocked by the floor plane
      }
    }
  }

  // If attacker is elevated >= 1.0" above target, check if attacker is set back from platform edge
  if (attackerY >= targetY + 1.0) {
    const platform = findWalkablePlatformAt(state, attacker.position);
    if (platform) {
      const setback = getPlatformEdgeDistance(attacker.position, target.position, platform);
      if (setback > 1.05) {
        return false; // Elevated shooter cannot see over floor lip to ground below
      }
    }
  }

  const dirX = dx / dist;
  const dirZ = dz / dist;

  for (const piece of state.terrain) {
    if (!piece.blocksLineOfSight) continue;

    const hit = intersectRayTerrain(attacker.position, dirX, dirZ, dist, piece, 0);
    if (hit && hit.tEntry < dist - 0.05 && hit.tExit > 0.05) {
      // Check 3D vertical ray clearance
      const tMid = (hit.tEntry + hit.tExit) / 2;
      const rayY = attackerY + (tMid / dist) * (targetY - attackerY);
      const pieceBottom = piece.position.y ?? 0;
      const pieceTop = pieceBottom + (piece.scale?.y ?? 1.5);
      if (rayY > pieceTop + 0.05 || rayY < pieceBottom - 0.05) {
        // Ray passes completely above or below the piece
        continue;
      }

      if (piece.terrainType === 'wall-doorway') {
        const ap = intersectAperturePiece(attacker.position, dirX, dirZ, dist, piece, 0);
        if (ap.hitsJamb && ap.tEntry !== undefined && ap.tEntry < dist - 0.05 && (ap.tExit ?? 0) > 0.05) {
          return false;
        }
        continue;
      }

      if (piece.terrainType === 'wall-window') {
        const ap = intersectAperturePiece(attacker.position, dirX, dirZ, dist, piece, 0);
        if (ap.hitsJamb && ap.tEntry !== undefined && ap.tEntry < dist - 0.05 && (ap.tExit ?? 0) > 0.05) {
          return false;
        }
        if (ap.passesAperture) {
          const { hx, hz } = terrainHalfExtents(piece);
          const pieceRadius = Math.hypot(hx, hz);
          const distAttacker = Math.hypot(attacker.position.x - piece.position.x, attacker.position.z - piece.position.z);
          const distTarget = Math.hypot(target.position.x - piece.position.x, target.position.z - piece.position.z);
          if (distAttacker <= pieceRadius + 1.0 || distTarget <= pieceRadius + 1.0) {
            continue; // Peeking / manning the firing port allows sight
          }
          return false; // Distant window blocks sight
        }
        continue;
      }

      return false;
    }
  }

  for (const other of state.units) {
    if (other.isDestroyed || other.id === attacker.id || other.id === target.id) {
      continue;
    }
    const hit = intersectRayCircle(
      attacker.position,
      dirX,
      dirZ,
      dist,
      other.position,
      LOS_UNIT_RADIUS
    );
    if (hit && hit.tEntry < dist - 0.05 && hit.tExit > 0.05) {
      const tMid = (hit.tEntry + hit.tExit) / 2;
      const rayY = attackerY + (tMid / dist) * (targetY - attackerY);
      const otherY = other.position.y ?? 0;
      if (rayY > otherY + 1.5 || rayY < otherY - 0.1) {
        continue; // Ray passes above the intermediate fighter
      }
      return false;
    }
  }

  return true;
}

/**
 * Determine whether `target` receives a Cover bonus (+1 Defense) against a
 * ranged attack from `attacker`.
 *
 * Cover applies when:
 *   1. `target.status` explicitly includes `'in-cover'`, OR
 *   2. `target` is on an elevated platform within 1.0" of the edge facing the shooter (Parapet Cover), OR
 *   3. The attack ray passes across a non-LoS-blocking `providesCover` terrain
 *      piece (e.g. crates, barricades) situated between attacker and target,
 *      excluding cover adjacent to the attacker (shooting out of cover does
 *      not grant cover to the open target), and excluding low ground cover against
 *      plunging fire (attacker elevated >= 2.0"), OR
 *   4. For LoS-blocking cover (walls, columns): `target` is within 1.0" of the
 *      piece AND the piece partially obscures the target.
 */
export function hasCoverAgainstAttack(
  state: GameState,
  attacker: Unit,
  target: Unit
): boolean {
  if (target.status.includes('in-cover')) return true;

  const attackerY = attacker.position.y ?? 0;
  const targetY = target.position.y ?? 0;

  // 1. Parapet / Ledge Cover:
  // If target is on an elevated platform >= 1.0" above attacker, and within 1.0" of the edge facing attacker
  if (targetY >= attackerY + 1.0) {
    const platform = findWalkablePlatformAt(state, target.position);
    if (platform) {
      const setback = getPlatformEdgeDistance(target.position, attacker.position, platform);
      if (setback <= 1.05) {
        return true; // Target claims Parapet Cover (+1 Defense)
      }
    }
  }

  const isPlungingFire = attackerY >= targetY + 2.0;

  const dx = target.position.x - attacker.position.x;
  const dz = target.position.z - attacker.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-4) return false;

  const dirX = dx / dist;
  const dirZ = dz / dist;
  const perpX = -dirZ;
  const perpZ = dirX;

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
          return true;
        }
      }
    } else {
      // Apertures (doorways and windows): if the shot passes through the opening,
      // a target within 1.0" of the doorway/window claims Cover (+1 Defense).
      if (piece.terrainType === 'wall-doorway' || piece.terrainType === 'wall-window') {
        const ap = intersectAperturePiece(attacker.position, dirX, dirZ, dist, piece, 0);
        if (ap.passesAperture && ap.tExit !== undefined) {
          const distToTarget = Math.hypot(
            target.position.x - piece.position.x,
            target.position.z - piece.position.z
          );
          if (distToTarget <= pieceRadius + 1.0 && dist - ap.tExit <= 1.0) {
            return true;
          }
        }
      }

      // Sight-blocking cover (walls, columns): target must be adjacent to the piece (within 1.0")
      // and partially obscured by it from the shooter's vantage point.
      const distToTarget = Math.hypot(
        target.position.x - piece.position.x,
        target.position.z - piece.position.z
      );
      if (distToTarget > pieceRadius + 1.0) continue;

      // Cast rays to target's left and right flanks (±0.3" perpendicular to the line of fire).
      const flankOffset = 0.3;
      const leftX = target.position.x + perpX * flankOffset;
      const leftZ = target.position.z + perpZ * flankOffset;
      const rightX = target.position.x - perpX * flankOffset;
      const rightZ = target.position.z - perpZ * flankOffset;

      const leftDx = leftX - attacker.position.x;
      const leftDz = leftZ - attacker.position.z;
      const leftDist = Math.hypot(leftDx, leftDz);

      const rightDx = rightX - attacker.position.x;
      const rightDz = rightZ - attacker.position.z;
      const rightDist = Math.hypot(rightDx, rightDz);

      const hitLeft =
        leftDist > 1e-4
          ? intersectRayTerrain(attacker.position, leftDx / leftDist, leftDz / leftDist, leftDist, piece, 0)
          : null;
      const hitRight =
        rightDist > 1e-4
          ? intersectRayTerrain(attacker.position, rightDx / rightDist, rightDz / rightDist, rightDist, piece, 0)
          : null;

      const leftObscured = !!(hitLeft && hitLeft.tEntry >= 0.8 && hitLeft.tEntry < leftDist - 0.05);
      const rightObscured = !!(hitRight && hitRight.tEntry >= 0.8 && hitRight.tEntry < rightDist - 0.05);

      if (leftObscured || rightObscured) {
        return true;
      }
    }
  }

  return false;
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
 * center line from attacker to target/aim position, entry and exit coordinates
 * on all intersected terrain bounding boxes, LoS obstruction, cover provider,
 * and left/right flank rays showing partial corner obscuration.
 */
export function computeShootingRayDebug(
  state: GameState,
  attacker: Unit,
  targetOrPoint: Unit | Vector3
): ShootingRayDebugInfo {
  const isTargetUnit = 'id' in targetOrPoint && 'position' in targetOrPoint;
  const targetUnit = isTargetUnit ? (targetOrPoint as Unit) : null;
  const targetPos = isTargetUnit ? targetUnit!.position : (targetOrPoint as Vector3);

  const from: Vector3 = { x: attacker.position.x, y: 0.45, z: attacker.position.z };
  const to: Vector3 = { x: targetPos.x, y: 0.45, z: targetPos.z };

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

  const intersections: TerrainIntersectionDebug[] = [];
  let blockedByPieceId: string | undefined;
  let blockedByUnitId: string | undefined;
  let coverPieceId: string | undefined;
  let coverReason: string | undefined;
  let earliestLoSBlockDist = Infinity;

  // 1. Raycast against all terrain pieces
  for (const piece of state.terrain) {
    const { hx, hz } = terrainHalfExtents(piece);
    const pieceRadius = Math.hypot(hx, hz);
    const toPieceX = piece.position.x - attacker.position.x;
    const toPieceZ = piece.position.z - attacker.position.z;
    const projDist = toPieceX * dirX + toPieceZ * dirZ;

    const margin = piece.blocksLineOfSight ? 0 : 0.15;
    const hit = intersectRayTerrain(attacker.position, dirX, dirZ, distance, piece, margin);
    if (!hit) continue;

    const isAdjacentShooterCover = projDist <= 1.0;
    const isBehindTarget = projDist > distance + pieceRadius;

    let isLoSBlocker = false;
    if (piece.blocksLineOfSight && hit.tEntry < distance - 0.05 && hit.tExit > 0.05) {
      if (piece.terrainType === 'wall-doorway') {
        const ap = intersectAperturePiece(attacker.position, dirX, dirZ, distance, piece, 0);
        if (ap.hitsJamb) {
          isLoSBlocker = true;
          if (hit.tEntry < earliestLoSBlockDist) {
            earliestLoSBlockDist = hit.tEntry;
            blockedByPieceId = piece.id;
          }
        }
      } else if (piece.terrainType === 'wall-window') {
        const ap = intersectAperturePiece(attacker.position, dirX, dirZ, distance, piece, 0);
        if (ap.hitsJamb) {
          isLoSBlocker = true;
          if (hit.tEntry < earliestLoSBlockDist) {
            earliestLoSBlockDist = hit.tEntry;
            blockedByPieceId = piece.id;
          }
        } else if (ap.passesAperture) {
          const distAttacker = Math.hypot(attacker.position.x - piece.position.x, attacker.position.z - piece.position.z);
          const distTarget = Math.hypot(targetPos.x - piece.position.x, targetPos.z - piece.position.z);
          const canPeek = distAttacker <= pieceRadius + 1.0 || distTarget <= pieceRadius + 1.0;
          if (!canPeek) {
            isLoSBlocker = true;
            if (hit.tEntry < earliestLoSBlockDist) {
              earliestLoSBlockDist = hit.tEntry;
              blockedByPieceId = piece.id;
            }
          }
        }
      } else {
        isLoSBlocker = true;
        if (hit.tEntry < earliestLoSBlockDist) {
          earliestLoSBlockDist = hit.tEntry;
          blockedByPieceId = piece.id;
        }
      }
    }

    let isCoverProvider = false;
    if (piece.providesCover && !isAdjacentShooterCover && !isBehindTarget) {
      if (!piece.blocksLineOfSight) {
        if (hit.tEntry >= 0.8 && hit.tExit <= distance + 0.1 && hit.tEntry < distance - 0.05) {
          if (distance - hit.tExit <= 1.0) {
            isCoverProvider = true;
            coverPieceId = piece.id;
            coverReason = `Intervening low cover (${piece.terrainType}, defender within 1.0")`;
          }
        }
      } else if (piece.terrainType === 'wall-doorway' || piece.terrainType === 'wall-window') {
        const ap = intersectAperturePiece(attacker.position, dirX, dirZ, distance, piece, 0);
        if (ap.passesAperture && ap.tExit !== undefined) {
          const distTarget = Math.hypot(targetPos.x - piece.position.x, targetPos.z - piece.position.z);
          if (distTarget <= pieceRadius + 1.0 && distance - ap.tExit <= 1.0) {
            isCoverProvider = true;
            coverPieceId = piece.id;
            coverReason = `${piece.terrainType === 'wall-doorway' ? 'Doorway' : 'Window firing port'} cover (defender within 1.0")`;
          }
        }
      }
    }

    intersections.push({
      pieceId: piece.id,
      terrainType: piece.terrainType,
      entryPoint: {
        x: Math.round((attacker.position.x + dirX * hit.tEntry) * 100) / 100,
        y: 0.45,
        z: Math.round((attacker.position.z + dirZ * hit.tEntry) * 100) / 100,
      },
      exitPoint: {
        x: Math.round((attacker.position.x + dirX * hit.tExit) * 100) / 100,
        y: 0.45,
        z: Math.round((attacker.position.z + dirZ * hit.tExit) * 100) / 100,
      },
      tEntry: Math.round(hit.tEntry * 100) / 100,
      tExit: Math.round(hit.tExit * 100) / 100,
      providesCover: piece.providesCover,
      blocksLineOfSight: piece.blocksLineOfSight,
      isCoverProvider,
      isLoSBlocker,
      ignoredAsAdjacentShooterCover: isAdjacentShooterCover,
    });
  }

  // Sort intersections along the ray from shooter to target
  intersections.sort((a, b) => a.tEntry - b.tEntry);

  // 2. Check intervening units for LoS blocking
  for (const other of state.units) {
    if (
      other.isDestroyed ||
      other.id === attacker.id ||
      (targetUnit && other.id === targetUnit.id)
    ) {
      continue;
    }
    const hit = intersectRayCircle(
      attacker.position,
      dirX,
      dirZ,
      distance,
      other.position,
      LOS_UNIT_RADIUS
    );
    if (hit && hit.tEntry < distance - 0.05 && hit.tExit > 0.05) {
      if (hit.tEntry < earliestLoSBlockDist) {
        earliestLoSBlockDist = hit.tEntry;
        blockedByUnitId = other.id;
        blockedByPieceId = undefined;
      }
    }
  }

  const hasLineOfSight = !blockedByPieceId && !blockedByUnitId;

  // 3. Flank rays for target units (partial wall obscuration)
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
      const fDx = fX - attacker.position.x;
      const fDz = fZ - attacker.position.z;
      const fDist = Math.hypot(fDx, fDz);
      let blocked = false;
      let pieceBlocked: string | undefined;

      if (fDist > 1e-4) {
        const fDirX = fDx / fDist;
        const fDirZ = fDz / fDist;
        for (const piece of state.terrain) {
          if (!piece.blocksLineOfSight) continue;
          const hit = intersectRayTerrain(attacker.position, fDirX, fDirZ, fDist, piece, 0);
          if (hit && hit.tEntry >= 0.8 && hit.tEntry < fDist - 0.05) {
            blocked = true;
            pieceBlocked = piece.id;
            break;
          }
        }
      }

      flankRays.push({
        from,
        to: { x: fX, y: 0.45, z: fZ },
        side,
        blocked,
        blockedByPieceId: pieceBlocked,
      });
    }

    if (!coverPieceId) {
      const blockedFlank = flankRays.find((f) => f.blocked);
      if (blockedFlank) {
        // Target must be adjacent to the wall (within 1.0") to claim partial cover
        const piece = state.terrain.find((p) => p.id === blockedFlank.blockedByPieceId);
        if (piece) {
          const { hx, hz } = terrainHalfExtents(piece);
          const pieceRadius = Math.hypot(hx, hz);
          const distToTarget = Math.hypot(
            targetUnit.position.x - piece.position.x,
            targetUnit.position.z - piece.position.z
          );
          if (distToTarget <= pieceRadius + 1.0) {
            coverPieceId = piece.id;
            coverReason = `Sight-blocking partial cover (${piece.terrainType} obscures ${blockedFlank.side} flank)`;
          }
        }
      }
    }

    if (targetUnit.status.includes('in-cover') && !coverPieceId) {
      coverReason = 'Unit has in-cover status';
    }
  }

  const providesCover =
    targetUnit
      ? hasCoverAgainstAttack(state, attacker, targetUnit)
      : !!coverPieceId;

  return {
    attackerId: attacker.id,
    targetId: targetUnit?.id,
    from,
    to,
    distance: Math.round(distance * 100) / 100,
    hasLineOfSight,
    blockedByUnitId,
    blockedByPieceId,
    providesCover,
    coverReason,
    coverPieceId,
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
    const { hx, hz } = terrainHalfExtents(piece);
    const yaw = piece.rotation.y || 0;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const corners = [
      [-hx, -hz],
      [hx, -hz],
      [hx, hz],
      [-hx, hz],
    ];
    if (piece.terrainType === 'wall-doorway' || piece.terrainType === 'wall-window') {
      const apHalf = 0.5;
      corners.push([-apHalf, -hz], [-apHalf, hz], [apHalf, -hz], [apHalf, hz]);
    }
    for (const [lx, lz] of corners) {
      const wx = piece.position.x + lx * cos + lz * sin;
      const wz = piece.position.z - lx * sin + lz * cos;
      if (Math.hypot(wx - origin.x, wz - origin.z) <= maxRange + 2) {
        addAngleWithJitter(Math.atan2(wz - origin.z, wx - origin.x));
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

      if (piece.terrainType === 'wall-doorway') {
        const ap = intersectAperturePiece(origin, dirX, dirZ, bestDist, piece, 0);
        if (ap.hitsJamb && ap.tEntry !== undefined && (ap.tExit ?? 0) > 0.02) {
          bestDist = Math.min(bestDist, ap.tEntry);
        }
        continue;
      }

      if (piece.terrainType === 'wall-window') {
        const ap = intersectAperturePiece(origin, dirX, dirZ, bestDist, piece, 0);
        if (ap.hitsJamb && ap.tEntry !== undefined && (ap.tExit ?? 0) > 0.02) {
          bestDist = Math.min(bestDist, ap.tEntry);
        } else if (ap.passesAperture) {
          const { hx, hz } = terrainHalfExtents(piece);
          const pieceRadius = Math.hypot(hx, hz);
          const distShooter = Math.hypot(origin.x - piece.position.x, origin.z - piece.position.z);
          // Only shooters manning the firing port (within 1.0" past radius) can project LoS through the window
          if (distShooter > pieceRadius + 1.0 && ap.tEntry !== undefined && (ap.tExit ?? 0) > 0.02) {
            bestDist = Math.min(bestDist, ap.tEntry);
          }
        }
        continue;
      }

      const hit = intersectRayTerrain(origin, dirX, dirZ, bestDist, piece, 0);
      if (hit && hit.tExit > 0.02) {
        bestDist = Math.min(bestDist, hit.tEntry);
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
export function findNavPath(
  state: GameState,
  unit: Unit,
  destination: Vector3,
  maxDistance: number = unit.remainingMovement,
  options: { ignoreUnitId?: string } = {}
): Vector3[] {
  const startY = unit.position.y ?? 0;
  const endY = destination.y ?? 0;
  const from: Vector3 = { x: unit.position.x, y: startY, z: unit.position.z };

  // 1. Board clamping: ensure destination is within board boundaries
  const halfW = (state.board.width * state.board.gridSize) / 2 - 0.25;
  const halfH = (state.board.height * state.board.gridSize) / 2 - 0.25;
  const target: Vector3 = {
    x: Math.max(-halfW, Math.min(halfW, destination.x)),
    y: endY,
    z: Math.max(-halfH, Math.min(halfH, destination.z)),
  };

  // 2. Fast path: check if straight line [from, target] is unblocked
  const directCheck = findMoveBlocker(state, unit, [from, target], options);
  if (!directCheck.blocked) {
    const dist = Math.hypot(target.x - from.x, endY - startY, target.z - from.z);
    if (dist <= maxDistance + 1e-4) {
      return [from, target];
    }
    const ratio = maxDistance / dist;
    return [
      from,
      {
        x: Math.round((from.x + (target.x - from.x) * ratio) * 100) / 100,
        y: Math.round((startY + (endY - startY) * ratio) * 100) / 100,
        z: Math.round((from.z + (target.z - from.z) * ratio) * 100) / 100,
      },
    ];
  }

  // 3. Obstacle waypoints generation
  const clearance = UNIT_COLLISION_RADIUS + 0.12; // ~0.47" clearance
  const candidateWaypoints: Vector3[] = [];

  const getSurfaceY = (x: number, z: number, refY: number = 0): number => {
    const plat = findWalkablePlatformAt(state, { x, y: refY, z });
    if (plat && plat.elevation !== undefined && plat.elevation > 0) {
      return plat.elevation;
    }
    return 0;
  };

  for (const piece of state.terrain) {
    if (
      piece.terrainType === 'stairs' ||
      piece.terrainType === 'ladder' ||
      piece.climbType === 'stairs' ||
      piece.climbType === 'ladder'
    ) {
      const topY = piece.elevation ?? piece.scale.y ?? 2.5;
      candidateWaypoints.push({ x: piece.position.x, y: 0, z: piece.position.z });
      candidateWaypoints.push({ x: piece.position.x, y: topY, z: piece.position.z });
    }

    if (piece.isWalkable || piece.terrainType === 'platform') {
      const { hx, hz } = terrainHalfExtents(piece);
      const platY = piece.elevation ?? piece.position.y ?? 0;
      const yaw = piece.rotation.y || 0;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const corners = [
        { x: -hx + 0.2, z: -hz + 0.2 },
        { x: hx - 0.2, z: -hz + 0.2 },
        { x: hx - 0.2, z: hz - 0.2 },
        { x: -hx + 0.2, z: hz - 0.2 },
      ];
      for (const c of corners) {
        const wx = piece.position.x + c.x * cos - c.z * sin;
        const wz = piece.position.z + c.x * sin + c.z * cos;
        if (Math.abs(wx) <= halfW && Math.abs(wz) <= halfH) {
          candidateWaypoints.push({ x: wx, y: platY, z: wz });
        }
      }
    }

    if (!piece.isObstacle) continue;
    const { hx, hz } = terrainHalfExtents(piece);
    const yaw = piece.rotation.y || 0;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const pieceBaseY = piece.position.y ?? 0;

    const addLocalBoxCorners = (minX: number, maxX: number, minZ: number, maxZ: number) => {
      const corners = [
        { x: minX - clearance, z: minZ - clearance },
        { x: maxX + clearance, z: minZ - clearance },
        { x: maxX + clearance, z: maxZ + clearance },
        { x: minX - clearance, z: maxZ + clearance },
      ];
      for (const c of corners) {
        const wx = piece.position.x + c.x * cos - c.z * sin;
        const wz = piece.position.z + c.x * sin + c.z * cos;
        if (Math.abs(wx) <= halfW && Math.abs(wz) <= halfH) {
          const wy = getSurfaceY(wx, wz, pieceBaseY);
          candidateWaypoints.push({ x: wx, y: wy, z: wz });
        }
      }
    };

    if (piece.terrainType === 'wall-doorway') {
      // Left jamb and right jamb with central opening
      addLocalBoxCorners(-hx, -0.5, -hz, hz);
      addLocalBoxCorners(0.5, hx, -hz, hz);
      // Doorway center waypoint for smooth passage through opening
      candidateWaypoints.push({
        x: piece.position.x,
        y: pieceBaseY,
        z: piece.position.z,
      });
    } else {
      addLocalBoxCorners(-hx, hx, -hz, hz);
    }
  }

  // Waypoints around other living fighters
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

  // Filter out any waypoint that is inside an obstacle
  const validWaypoints: Vector3[] = [];
  for (const wp of candidateWaypoints) {
    const wpY = wp.y ?? 0;
    const blk = findMoveBlocker(state, unit, [wp, { x: wp.x + 0.001, y: wpY, z: wp.z }], options);
    if (!blk.blocked) {
      validWaypoints.push(wp);
    }
  }

  // 4. A* Search
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
    h: Math.hypot(target.x - from.x, endY - startY, target.z - from.z),
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
      h: Math.hypot(target.x - p.x, endY - (p.y ?? 0), target.z - p.z),
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

    // Try direct link to target first
    if (!closedSet.has(targetNode)) {
      const directBlk = findMoveBlocker(state, unit, [current.pos, targetNode.pos], options);
      if (!directBlk.blocked) {
        const tentG =
          current.g +
          Math.hypot(
            targetNode.pos.x - current.pos.x,
            (targetNode.pos.y ?? 0) - (current.pos.y ?? 0),
            targetNode.pos.z - current.pos.z
          );
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

      const blk = findMoveBlocker(state, unit, [current.pos, neighbor.pos], options);
      if (blk.blocked) continue;

      const tentativeG = current.g + d;
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
    // If no path around obstacles, clamp straight toward target
    const clamped = clampMoveDestinationWithObstacles(state, unit, destination, maxDistance);
    return [from, clamped];
  }

  // 5. String pulling / shortcutting
  const smoothed: Vector3[] = [rawPath[0]];
  let curIdx = 0;
  while (curIdx < rawPath.length - 1) {
    let furthest = curIdx + 1;
    for (let test = rawPath.length - 1; test > curIdx + 1; test--) {
      const blk = findMoveBlocker(state, unit, [rawPath[curIdx], rawPath[test]], options);
      if (!blk.blocked) {
        furthest = test;
        break;
      }
    }
    smoothed.push(rawPath[furthest]);
    curIdx = furthest;
  }

  // 6. Cumulative distance clamping
  const result: Vector3[] = [{ ...smoothed[0] }];
  let distLeft = maxDistance;

  for (let i = 1; i < smoothed.length; i++) {
    const p1 = smoothed[i - 1];
    const p2 = smoothed[i];
    const segLen = Math.hypot(p2.x - p1.x, (p2.y ?? 0) - (p1.y ?? 0), p2.z - p1.z);
    if (segLen <= distLeft + 1e-4) {
      result.push({
        x: Math.round(p2.x * 100) / 100,
        y: Math.round((p2.y ?? 0) * 100) / 100,
        z: Math.round(p2.z * 100) / 100,
      });
      distLeft -= segLen;
    } else {
      const ratio = distLeft / segLen;
      const y1 = p1.y ?? 0;
      const y2 = p2.y ?? 0;
      result.push({
        x: Math.round((p1.x + (p2.x - p1.x) * ratio) * 100) / 100,
        y: Math.round((y1 + (y2 - y1) * ratio) * 100) / 100,
        z: Math.round((p1.z + (p2.z - p1.z) * ratio) * 100) / 100,
      });
      break;
    }
  }

  return result;
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
 * 2. The squad formation must form a connected graph (no isolated split clusters).
 * 3. All models in the squad must remain within 6.0" horizontal of all other squad members.
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
  // and construct an adjacency graph for connectivity
  const n = positions.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  let maxNearestDist = 0;

  for (let i = 0; i < n; i++) {
    let nearestDist = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = positions[i].x - positions[j].x;
      const dz = positions[i].z - positions[j].z;
      const d = Math.hypot(dx, dz);
      if (d < nearestDist) nearestDist = d;
      if (d <= maxMemberDist + tolerance) {
        adj[i].push(j);
      }
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

  // 3. Check graph connectivity: start BFS from model 0
  const visited = new Set<number>();
  const queue = [0];
  visited.add(0);
  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const neighbor of adj[curr]) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  if (visited.size < n) {
    return {
      coherent: false,
      reason: 'Squad formation is disconnected into separate clusters',
    };
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
 * stopping at base contact (`UNIT_SEPARATION_DISTANCE = 0.6"`).
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
  const targetContactDist = UNIT_SEPARATION_DISTANCE; // 0.6" base contact

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

