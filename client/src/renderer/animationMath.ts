import { Vector3 } from '@skirmish-lab/shared';

/**
 * Pure tween and path interpolation mathematics.
 * Zero external or Three.js dependencies so it can be tested in standard Node test runners.
 */

/**
 * Standard symmetric quadratic ease-in-out function.
 * Smoothly accelerates from 0 to 0.5, then decelerates from 0.5 to 1.0.
 */
export function easeInOut(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped < 0.5 ? 2 * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 2) / 2;
}

/**
 * Compute the total Euclidean distance along a polyline.
 */
export function computePathLength(path: Vector3[]): number {
  if (!path || path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const p1 = path[i - 1];
    const p2 = path[i];
    const dx = p2.x - p1.x;
    const dy = (p2.y ?? 0) - (p1.y ?? 0);
    const dz = p2.z - p1.z;
    total += Math.hypot(dx, dy, dz);
  }
  return total;
}

/**
 * Linearly interpolate between two scalar values.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Sample a 3D position along a path at a given normalized progress in [0, 1].
 * Uses arc-length parameterization so movement speed is constant along waypoints.
 */
export function samplePathAtProgress(path: Vector3[], progress: number): Vector3 {
  if (!path || path.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  if (path.length === 1) {
    return { x: path[0].x, y: path[0].y ?? 0, z: path[0].z };
  }

  const clampedProgress = Math.max(0, Math.min(1, progress));
  if (clampedProgress === 0) {
    return { x: path[0].x, y: path[0].y ?? 0, z: path[0].z };
  }
  if (clampedProgress === 1) {
    const end = path[path.length - 1];
    return { x: end.x, y: end.y ?? 0, z: end.z };
  }

  const totalLength = computePathLength(path);
  if (totalLength <= 0.00001) {
    return { x: path[0].x, y: path[0].y ?? 0, z: path[0].z };
  }

  const targetDist = clampedProgress * totalLength;
  let accumulated = 0;

  for (let i = 1; i < path.length; i++) {
    const p1 = path[i - 1];
    const p2 = path[i];
    const dx = p2.x - p1.x;
    const dy = (p2.y ?? 0) - (p1.y ?? 0);
    const dz = p2.z - p1.z;
    const segLen = Math.hypot(dx, dy, dz);

    if (accumulated + segLen >= targetDist || i === path.length - 1) {
      const segT = segLen > 0 ? (targetDist - accumulated) / segLen : 0;
      const clampedSegT = Math.max(0, Math.min(1, segT));
      return {
        x: lerp(p1.x, p2.x, clampedSegT),
        y: lerp(p1.y ?? 0, p2.y ?? 0, clampedSegT),
        z: lerp(p1.z, p2.z, clampedSegT),
      };
    }

    accumulated += segLen;
  }

  const last = path[path.length - 1];
  return { x: last.x, y: last.y ?? 0, z: last.z };
}

/**
 * Evaluate an ease-in-out tween over time along a polyline.
 */
export function interpolateTween(
  path: Vector3[],
  elapsedSeconds: number,
  durationSeconds: number
): { position: Vector3; done: boolean } {
  if (!path || path.length === 0) {
    return { position: { x: 0, y: 0, z: 0 }, done: true };
  }
  if (durationSeconds <= 0 || elapsedSeconds >= durationSeconds) {
    const end = path[path.length - 1];
    return { position: { x: end.x, y: end.y ?? 0, z: end.z }, done: true };
  }

  const t = Math.max(0, Math.min(1, elapsedSeconds / durationSeconds));
  const progress = easeInOut(t);
  const position = samplePathAtProgress(path, progress);
  return { position, done: false };
}
