import { describe, it, expect } from 'vitest';
import {
  easeInOut,
  computePathLength,
  samplePathAtProgress,
  interpolateTween,
} from '../../src/renderer/animationMath';

describe('animationMath', () => {
  describe('easeInOut', () => {
    it('evaluates to 0 at t=0', () => {
      expect(easeInOut(0)).toBe(0);
    });

    it('evaluates to 0.5 at t=0.5 (symmetric midpoint)', () => {
      expect(easeInOut(0.5)).toBe(0.5);
    });

    it('evaluates to 1.0 at t=1', () => {
      expect(easeInOut(1)).toBe(1);
    });

    it('clamps values below 0 and above 1', () => {
      expect(easeInOut(-0.5)).toBe(0);
      expect(easeInOut(1.5)).toBe(1);
    });

    it('has ease-in curvature below 0.5 and ease-out curvature above 0.5', () => {
      // At t=0.25 (linear would be 0.25), ease-in should be slower (< 0.25)
      expect(easeInOut(0.25)).toBeLessThan(0.25);
      // At t=0.75 (linear would be 0.75), ease-out should be further along (> 0.75)
      expect(easeInOut(0.75)).toBeGreaterThan(0.75);
      // Symmetry: easeInOut(0.25) + easeInOut(0.75) === 1
      expect(easeInOut(0.25) + easeInOut(0.75)).toBeCloseTo(1, 5);
    });
  });

  describe('computePathLength', () => {
    it('returns 0 for empty or single point paths', () => {
      expect(computePathLength([])).toBe(0);
      expect(computePathLength([{ x: 1, y: 2, z: 3 }])).toBe(0);
    });

    it('computes distance for a straight segment', () => {
      const path = [
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 4, z: 0 },
      ];
      expect(computePathLength(path)).toBe(5);
    });

    it('sums distance across multiple segments', () => {
      const path = [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 0, z: 10 },
      ];
      expect(computePathLength(path)).toBe(20);
    });
  });

  describe('samplePathAtProgress', () => {
    it('returns start at 0%, midpoint at 50%, and end at 100% for a straight line', () => {
      const path = [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ];
      const p0 = samplePathAtProgress(path, 0);
      expect(p0.x).toBeCloseTo(0);
      expect(p0.y).toBeCloseTo(0);
      expect(p0.z).toBeCloseTo(0);

      const p50 = samplePathAtProgress(path, 0.5);
      expect(p50.x).toBeCloseTo(5);
      expect(p50.y).toBeCloseTo(0);
      expect(p50.z).toBeCloseTo(0);

      const p100 = samplePathAtProgress(path, 1.0);
      expect(p100.x).toBeCloseTo(10);
      expect(p100.y).toBeCloseTo(0);
      expect(p100.z).toBeCloseTo(0);
    });

    it('traverses multi-segment waypoints accurately at 0%, 50%, and 100%', () => {
      // 2 equal 10" segments: total length 20"
      const path = [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 0, z: 10 },
      ];

      const p0 = samplePathAtProgress(path, 0);
      expect(p0.x).toBeCloseTo(0);
      expect(p0.z).toBeCloseTo(0);

      // At 50% (distance 10), it should be exactly at waypoint 1 (10, 0, 0)
      const p50 = samplePathAtProgress(path, 0.5);
      expect(p50.x).toBeCloseTo(10);
      expect(p50.z).toBeCloseTo(0);

      // At 75% (distance 15), halfway through second segment (10, 0, 5)
      const p75 = samplePathAtProgress(path, 0.75);
      expect(p75.x).toBeCloseTo(10);
      expect(p75.z).toBeCloseTo(5);

      const p100 = samplePathAtProgress(path, 1);
      expect(p100.x).toBeCloseTo(10);
      expect(p100.z).toBeCloseTo(10);
    });
  });

  describe('interpolateTween', () => {
    it('interpolates with ease-in-out over specified duration', () => {
      const path = [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ];
      const duration = 0.4;

      // 0%
      const at0 = interpolateTween(path, 0, duration);
      expect(at0.done).toBe(false);
      expect(at0.position.x).toBeCloseTo(0);

      // 50% (elapsed 0.2s of 0.4s)
      const at50 = interpolateTween(path, 0.2, duration);
      expect(at50.done).toBe(false);
      expect(at50.position.x).toBeCloseTo(5);

      // 100% (elapsed 0.4s)
      const at100 = interpolateTween(path, 0.4, duration);
      expect(at100.done).toBe(true);
      expect(at100.position.x).toBeCloseTo(10);
    });

    it('marks done and clamps to end when elapsed exceeds duration', () => {
      const path = [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ];
      const res = interpolateTween(path, 0.8, 0.4);
      expect(res.done).toBe(true);
      expect(res.position.x).toBe(10);
    });
  });
});
