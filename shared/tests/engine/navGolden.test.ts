import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { validateAction } from '../../src/engine/actions';
import { closestApproach } from '../../src/engine/closestApproach';
import { findNavPath } from '../../src/engine/spatial';
import {
  ALL_NAV_CASES,
  BuiltinMapId,
  CLOSEST_APPROACH_CASES,
  NavCase,
  SQUAD_CHARGE_CASES,
  buildClosestApproachCaseState,
  buildNavCaseState,
  buildSquadChargeAction,
  r2,
  roundPath,
  roundPoint,
  verifyClosestApproachCase,
  verifyNavCaseCategory,
  verifySquadChargeCase,
} from '../fixtures/navGoldenCases';

const SNAPSHOT_DIR = join(__dirname, '../fixtures/nav-golden');
const UPDATE_SNAPSHOTS = process.env.UPDATE_NAV_GOLDEN === '1';

function loadOrWriteSnapshot<T>(filename: string, compute: () => T): T {
  const fullPath = join(SNAPSHOT_DIR, filename);
  if (UPDATE_SNAPSHOTS) {
    const data = compute();
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
    writeFileSync(fullPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    return data;
  }
  if (!existsSync(fullPath)) {
    throw new Error(`Missing golden snapshot ${fullPath}; run with UPDATE_NAV_GOLDEN=1 to generate.`);
  }
  return JSON.parse(readFileSync(fullPath, 'utf8')) as T;
}

function runNavCase(c: NavCase) {
  const { state, unit } = buildNavCaseState(c);
  const path = findNavPath(state, unit, c.destination, c.maxDistance, c.options);
  verifyNavCaseCategory(c, state, unit, path);
  return {
    id: c.id,
    category: c.category,
    label: c.label,
    path: roundPath(path),
  };
}

const MAPS: BuiltinMapId[] = ['standard-battlefield', 'jump-range', 'hazard-range'];

describe('navGolden: case list coverage', () => {
  it('meets minimum case counts per map and covers every required category', () => {
    const byMap = (m: BuiltinMapId) => ALL_NAV_CASES.filter((c) => c.map === m);
    expect(byMap('standard-battlefield').length).toBeGreaterThanOrEqual(40);
    expect(byMap('jump-range').length).toBeGreaterThanOrEqual(15);
    expect(byMap('hazard-range').length).toBeGreaterThanOrEqual(15);
    expect(CLOSEST_APPROACH_CASES.length).toBeGreaterThanOrEqual(10);
    expect(SQUAD_CHARGE_CASES.length).toBeGreaterThanOrEqual(4);

    const categories = new Set(ALL_NAV_CASES.map((c) => c.category));
    for (const req of [
      'fast-path',
      'obstacle',
      'stairs',
      'ladder',
      'drop',
      'climb',
      'no-route',
      'clamped',
      'keep-away',
      'stop-before-difficult',
      'flying',
    ] as const) {
      expect(categories.has(req), `missing category ${req}`).toBe(true);
    }
  });
});

for (const mapId of MAPS) {
  const cases = ALL_NAV_CASES.filter((c) => c.map === mapId);
  const filename = `${mapId}.json`;
  const expectedList = loadOrWriteSnapshot(filename, () => {
    const errors: string[] = [];
    const results: ReturnType<typeof runNavCase>[] = [];
    for (const c of cases) {
      try {
        results.push(runNavCase(c));
      } catch (err) {
        errors.push((err as Error).message);
      }
    }
    if (errors.length > 0) throw new Error(`Category check failures on ${mapId}:\n${errors.join('\n')}`);
    return results;
  });
  const expectedById = new Map(expectedList.map((entry) => [entry.id, entry]));

  describe(`navGolden: findNavPath on ${mapId}`, () => {
    it.each(cases)('$id — $label', (c) => {
      const actual = runNavCase(c);
      const recorded = expectedById.get(c.id);
      expect(recorded, `missing snapshot for ${c.id}`).toBeDefined();
      expect(actual).toEqual(recorded);
    });
  });
}

const expectedClosestApproach = loadOrWriteSnapshot('closest-approach.json', () => {
  const errors: string[] = [];
  const results: Array<{ id: string; category: string; label: string; result: unknown }> = [];
  for (const c of CLOSEST_APPROACH_CASES) {
    try {
      const { state, unit, target } = buildClosestApproachCaseState(c);
      const res = closestApproach(state, unit, c.modelIndex, c.start, c.budget, target, c.otherFinalPositions, c.options);
      verifyClosestApproachCase(c, state, unit, res);
      results.push({
        id: c.id,
        category: c.category,
        label: c.label,
        result: res
          ? {
              position: roundPoint(res.position),
              path: roundPath(res.path),
              gap: r2(res.gap),
              cost: r2(res.cost),
            }
          : null,
      });
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  if (errors.length > 0) throw new Error(`closestApproach failures:\n${errors.join('\n')}`);
  return results;
});
const expectedClosestById = new Map(expectedClosestApproach.map((e) => [e.id, e]));

describe('navGolden: closestApproach', () => {
  it.each(CLOSEST_APPROACH_CASES)(
    '$id — $label',
    (c) => {
      const { state, unit, target } = buildClosestApproachCaseState(c);
      const res = closestApproach(state, unit, c.modelIndex, c.start, c.budget, target, c.otherFinalPositions, c.options);
      verifyClosestApproachCase(c, state, unit, res);
      const actual = {
        id: c.id,
        category: c.category,
        label: c.label,
        result: res
          ? {
              position: roundPoint(res.position),
              path: roundPath(res.path),
              gap: r2(res.gap),
              cost: r2(res.cost),
            }
          : null,
      };
      expect(actual).toEqual(expectedClosestById.get(c.id));
    },
    60_000
  );
});

const expectedSquadCharge = loadOrWriteSnapshot('squad-charge.json', () => {
  const errors: string[] = [];
  const results: Array<{ id: string; category: string; label: string; result: unknown }> = [];
  for (const c of SQUAD_CHARGE_CASES) {
    try {
      const { state, action } = buildSquadChargeAction(c);
      const res = validateAction(state, action);
      verifySquadChargeCase(c, res);
      results.push({
        id: c.id,
        category: c.category,
        label: c.label,
        result: res,
      });
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  if (errors.length > 0) throw new Error(`squadCharge failures:\n${errors.join('\n')}`);
  return results;
});
const expectedChargeById = new Map(expectedSquadCharge.map((e) => [e.id, e]));

describe('navGolden: squad charge validateAction', () => {
  it.each(SQUAD_CHARGE_CASES)(
    '$id — $label',
    (c) => {
      const { state, action } = buildSquadChargeAction(c);
      const res = validateAction(state, action);
      verifySquadChargeCase(c, res);
      const actual = {
        id: c.id,
        category: c.category,
        label: c.label,
        result: res,
      };
      expect(actual).toEqual(expectedChargeById.get(c.id));
    },
    300_000
  );
});
