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

  it('the Deadly squad has a Deadly ranged weapon and plain ranged weapons that fire together at one target', () => {
    const deadly = units.find((u) => u.name.startsWith('Test Deadly Squad'))!;
    expect(deadly.models.map((m) => m.weaponIds)).toEqual([
      ['fusion-rifle', 'blade'],
      ['rifle', 'blade'],
      ['rifle', 'blade'],
    ]);
    const ranged = deadly.weapons.filter((w) => w.profile.type === 'ranged');
    const isDeadly = (w: (typeof ranged)[number]) => w.profile.specialRules.some((r) => r.startsWith('deadly'));
    expect(ranged.filter(isDeadly).map((w) => w.id)).toEqual(['fusion-rifle']);
    expect(ranged.filter((w) => !isDeadly(w)).map((w) => w.id)).toEqual(['rifle']);
    // Tough(3) models: a Deadly(3) wound kills an unhurt one, which is what the manual check shows
    expect(deadly.models.every((m) => m.maxWounds === 3)).toBe(true);
  });

  it('is a TEST army (stays out of the Force Org harness)', () => {
    expect(STARTER_ARMIES['test-loadouts-army'].id.startsWith('test')).toBe(true);
    expect(STARTER_ARMIES['test-loadouts-army'].name).toMatch(/TEST/);
  });
});
