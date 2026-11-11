import { describe, it, expect } from 'vitest';
import { STARTER_ARMIES, createUnitsFromStarterArmy } from '../../src/data/armies';
import { hasTrait, getTraitValue } from '../../src/rules/traits';
import { findCounterWeapon, getEffectiveSpeed, isMeleeWeapon } from '../../src/engine/specialRules';
import { Unit } from '../../src/gameTypes';

describe('TEST: Special Rules Check army (manual special rule testing)', () => {
  const units = createUnitsFromStarterArmy(STARTER_ARMIES['test-special-rules-army'], 'host') as Unit[];

  it('has one squad for each rule: Fast, Slow, Impact, Counter, Assault, Shred', () => {
    expect(units.find((u) => hasTrait(u.specialRules, 'fast'))).toBeDefined();
    expect(units.find((u) => hasTrait(u.specialRules, 'slow'))).toBeDefined();
    expect(units.find((u) => getTraitValue(u.specialRules, 'impact') === 3)).toBeDefined();
    expect(units.find((u) => !!findCounterWeapon(u))).toBeDefined();
    expect(units.find((u) => u.weapons.some((w) => w.profile.type === 'ranged' && isMeleeWeapon(w)))).toBeDefined();
    expect(units.find((u) => u.weapons.some((w) => hasTrait(w.profile.specialRules, 'shred')))).toBeDefined();
  });

  it('the Fast and Slow squads advance 8" and 4" from the same Speed 6 stat', () => {
    const fast = units.find((u) => hasTrait(u.specialRules, 'fast'))!;
    const slow = units.find((u) => hasTrait(u.specialRules, 'slow'))!;
    expect(fast.speed).toBe(6);
    expect(getEffectiveSpeed(fast)).toBe(8);
    expect(getEffectiveSpeed(slow)).toBe(4);
  });
});
