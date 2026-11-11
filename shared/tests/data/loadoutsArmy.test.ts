import { describe, it, expect } from 'vitest';
import { STARTER_ARMIES, createUnitsFromStarterArmy } from '../../src/data/armies';
import { findMeleeWeapons } from '../../src/engine/specialRules';
import { Unit } from '../../src/gameTypes';

describe('TEST: Loadouts Check army (manual per-model loadout testing)', () => {
  const units = createUnitsFromStarterArmy(STARTER_ARMIES['test-loadouts-army'], 'host') as Unit[];
  const squad = units.find((u) => u.name.startsWith('Test Mixed Squad'))!;
  const leader = units.find((u) => u.name.startsWith('Test Two-Weapon Leader'))!;

  it('the squad has two Rifle models and one Frag Launcher (Blast) model, all with a Blade', () => {
    expect(squad.models.map((m) => m.weaponIds)).toEqual([
      ['rifle', 'blade'],
      ['rifle', 'blade'],
      ['frag-launcher', 'blade'],
    ]);
    expect(squad.weapons.map((w) => w.id).sort()).toEqual(['blade', 'frag-launcher', 'rifle']);
  });

  it('the single model strikes with a true melee weapon and an Assault weapon', () => {
    expect(leader.models).toHaveLength(1);
    expect(findMeleeWeapons(leader).map((w) => w.id)).toEqual(['power-sword', 'assault-rifle']);
  });

  it('is a TEST army (stays out of the Force Org harness)', () => {
    expect(STARTER_ARMIES['test-loadouts-army'].id.startsWith('test')).toBe(true);
    expect(STARTER_ARMIES['test-loadouts-army'].name).toMatch(/TEST/);
  });
});
