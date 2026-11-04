import { describe, it, expect } from 'vitest';
import {
  baseRadius,
  edgeGapToCentre,
  markerGap,
  modelGap,
  unitGap,
} from '../../src/engine/unitGeometry';

const at = (x: number, z: number, y = 0) => ({ x, y, z });

describe('unitGeometry: base-edge measuring', () => {
  it('standard bases have a 0.5" radius', () => {
    expect(baseRadius()).toBe(0.5);
  });

  it('modelGap is centre distance minus both radii, never negative', () => {
    expect(modelGap(at(0, 0), at(0, 5))).toBeCloseTo(4);
    expect(modelGap(at(0, 0), at(3, 4))).toBeCloseTo(4);
    expect(modelGap(at(0, 0), at(0, 1))).toBe(0); // touching
    expect(modelGap(at(0, 0), at(0, 0.4))).toBe(0); // overlapping
  });

  it('modelGap honours different radii and ignores height', () => {
    expect(modelGap(at(0, 0), at(0, 5), 1, 0.5)).toBeCloseTo(3.5);
    expect(modelGap(at(0, 0, 0), at(0, 5, 3))).toBeCloseTo(4);
  });

  it('markerGap subtracts only the model radius', () => {
    expect(markerGap(at(3.5, 0), at(0, 0))).toBeCloseTo(3);
    expect(markerGap(at(0.2, 0), at(0, 0))).toBe(0);
  });

  it('unitGap measures anchor to anchor over both radii', () => {
    expect(unitGap({ position: at(0, 0) }, { position: at(0, 10) })).toBeCloseTo(9);
  });

  it('edgeGapToCentre converts a tabletop gap to a centre distance', () => {
    expect(edgeGapToCentre(0)).toBe(1);
    expect(edgeGapToCentre(1)).toBe(2);
    expect(edgeGapToCentre(6)).toBe(7);
  });
});
