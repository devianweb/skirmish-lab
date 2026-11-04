import { describe, it, expect } from 'vitest';
import {
  baseRadius,
  edgeGapToCentre,
  markerGap,
  modelGap,
  unitGap,
  unitsInContact,
  strikingModelCount,
  chargeContact,
  modelsTranslatedTo,
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

const squadAt = (...spots: Array<[number, number, number?]>) => ({
  position: at(spots[0][0], spots[0][1], spots[0][2] ?? 0),
  models: spots.map(([x, z, y], i) => ({
    id: `m${i}`,
    wounds: 1,
    maxWounds: 1,
    isDestroyed: false,
    position: at(x, z, y ?? 0),
  })),
});

describe('unitGeometry: engagement and melee reach', () => {
  it('units are in contact when any model pair is within 0.5" and level', () => {
    const a = squadAt([0, 0], [0, 10]);
    expect(unitsInContact(a, squadAt([5, 5], [0, 11.5]))).toBe(true); // 0.5" edge gap
    expect(unitsInContact(a, squadAt([5, 5], [0, 11.6]))).toBe(false);
    expect(unitsInContact(a, squadAt([5, 5], [0, 11.2, 3]))).toBe(false); // other floor
  });

  it('strikers are the models within 2" (edge) and 4" height of an enemy model', () => {
    const foe = squadAt([0, 0]);
    const striker = squadAt([0, 1], [0, 3], [0, 3.1], [0, 8], [1, 1, 5]);
    // gaps 0, 2.0 (counts), 2.1 (no), 7 (no), height 5 (no)
    expect(strikingModelCount(striker, foe)).toBe(2);
  });

  it('dead models do not strike', () => {
    const striker = squadAt([0, 1], [0, 1.5]);
    striker.models[1].isDestroyed = true;
    expect(strikingModelCount(striker, squadAt([0, 0]))).toBe(1);
  });

  it('a unit without a model list counts as one model at its anchor', () => {
    expect(strikingModelCount({ position: at(0, 1), models: [] }, { position: at(0, 0), models: [] })).toBe(1);
  });

  it('chargeContact translates the whole block and measures its closest model', () => {
    const charger = squadAt([0, 0], [0, -1]);
    const target = squadAt([0, 5]);
    expect(modelsTranslatedTo(charger, at(0, 4))[1].z).toBeCloseTo(3);
    expect(chargeContact(charger, target, at(0, 4), 4.05)).toBe('ok');
    expect(chargeContact(charger, target, at(0, 3), 4.05)).toBe('too-far');
    const high = squadAt([0, 5, 6]);
    expect(chargeContact(charger, high, at(0, 4), 4.05)).toBe('too-high');
  });
});
