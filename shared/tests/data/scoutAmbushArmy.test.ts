import { describe, it, expect } from 'vitest';
import { STARTER_ARMIES, createUnitsFromStarterArmy } from '../../src/data/armies';
import { hasTrait } from '../../src/rules/traits';
import { Unit } from '../../src/gameTypes';

describe('TEST: Scout & Ambush Check army (manual setup testing)', () => {
  const units = createUnitsFromStarterArmy(STARTER_ARMIES['test-scout-ambush-army'], 'host') as Unit[];

  it('has ordinary, Scout and Ambush units, and no unit that is both a Scout and Ambush', () => {
    expect(units.filter((u) => hasTrait(u.specialRules, 'scout'))).toHaveLength(2);
    expect(units.filter((u) => hasTrait(u.specialRules, 'ambush'))).toHaveLength(2);
    expect(units.filter((u) => !hasTrait(u.specialRules, 'scout') && !hasTrait(u.specialRules, 'ambush')).length).toBeGreaterThanOrEqual(2);
    expect(units.some((u) => hasTrait(u.specialRules, 'scout') && hasTrait(u.specialRules, 'ambush'))).toBe(false);
  });

  it('every unit starts undeployed with at least one model and a weapon', () => {
    for (const u of units) {
      expect(u.models.length).toBeGreaterThan(0);
      expect(u.weapons.length).toBeGreaterThan(0);
    }
  });
});
