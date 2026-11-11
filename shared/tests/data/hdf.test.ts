import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../../src/gameState';
import { STARTER_ARMIES, createUnitsFromStarterArmy } from '../../src/data/armies';
import { applyDefaultScenario } from '../../src/data/scenario';
import { deploymentFootprintProblem, getDeploymentZoneBounds } from '../../src/engine/activation';
import { getTraitValue, hasTrait } from '../../src/rules/traits';
import { Unit } from '../../src/gameTypes';

const hdf = STARTER_ARMIES['hdf'];
const fighter = (id: string) => hdf.fighters.find((f) => f.id === id)!;

/** The weapon names a unit's models carry, as `[model] -> names`. */
function loadoutNames(unit: Unit): string[][] {
  return unit.models.map((m) => (m.weaponIds ?? unit.weapons.map((w) => w.id)).map((id) => unit.weapons.find((w) => w.id === id)!.name));
}

describe('Human Defense Force list (Decision 6)', () => {
  it('is a 400-pt, 4-unit list of the four book units at their book costs', () => {
    expect(hdf.fighters.map((f) => [f.name, f.points])).toEqual([
      ['Company Leader', 100],
      ['Veterans', 125],
      ['Infantry Squad', 120],
      ['Sniper', 55],
    ]);
    expect(hdf.fighters.reduce((s, f) => s + f.points, 0)).toBe(400);
    expect(hdf.totalPoints).toBe(400);
  });

  it('has one Hero, Hold the Line everywhere and 30 Tough in total', () => {
    expect(hdf.fighters.filter((f) => hasTrait(f.specialRules, 'hero'))).toHaveLength(1);
    expect(hdf.fighters.every((f) => hasTrait(f.specialRules, 'hold-the-line'))).toBe(true);
    const tough = hdf.fighters.reduce((s, f) => s + (getTraitValue(f.specialRules, 'tough') ?? 1) * (f.modelCount ?? 1), 0);
    expect(tough).toBe(30);
  });

  it('has the book Quality, Defense, model count and Tough for each unit', () => {
    const row = (id: string) => {
      const f = fighter(id);
      return [f.quality, f.defense, f.modelCount ?? 1, getTraitValue(f.specialRules, 'tough')];
    };
    expect(row('hdf-company-leader')).toEqual([4, 5, 1, 9]);
    expect(row('hdf-veterans')).toEqual([4, 5, 3, 3]);
    expect(row('hdf-infantry-squad')).toEqual([5, 5, 3, 3]);
    expect(row('hdf-sniper')).toEqual([5, 5, 1, 3]);
    // Each model's wounds are its own Tough value
    const units = createUnitsFromStarterArmy(hdf, 'p');
    expect(units.find((u) => u.name.startsWith('Veterans'))!.models.map((m) => m.maxWounds)).toEqual([3, 3, 3]);
  });

  it('Sniper is a Scout with Stealth', () => {
    const rules = fighter('hdf-sniper').specialRules;
    expect(hasTrait(rules, 'scout')).toBe(true);
    expect(hasTrait(rules, 'stealth')).toBe(true);
  });

  describe('per-model weapons', () => {
    const units = createUnitsFromStarterArmy(hdf, 'p');
    const unit = (name: string) => units.find((u) => u.name.startsWith(name))!;

    it('Company Leader: Hand Weapon A6 and Pistol A2 (Assault)', () => {
      const leader = unit('Company Leader');
      const [hand, pistol] = ['hand-weapon', 'pistol'].map((id) => leader.weapons.find((w) => w.id === id)!);
      expect(hand.profile).toMatchObject({ type: 'melee', attacks: 6, specialRules: [] });
      expect(pistol.profile).toMatchObject({ type: 'ranged', range: 12, attacks: 2, specialRules: ['assault'] });
    });

    it('Veterans: three Strikes, two Battle Rifles and one Grenade Launcher (the only Blast)', () => {
      const vets = unit('Veterans');
      expect(loadoutNames(vets)).toEqual([
        ['Strike', 'Battle Rifle'],
        ['Strike', 'Battle Rifle'],
        ['Strike', 'Grenade Launcher'],
      ]);
      const blast = vets.weapons.filter((w) => hasTrait(w.profile.specialRules, 'blast'));
      expect(blast.map((w) => w.name)).toEqual(['Grenade Launcher']);
      expect(blast[0].profile).toMatchObject({ range: 24, attacks: 2, specialRules: ['blast(3)'] });
    });

    it('Infantry Squad: Plasma Rifle + Strike, a Sergeant with Plasma Pistol + Sgt. Hand Weapon, Battle Rifle + Strike', () => {
      const squad = unit('Infantry Squad');
      expect(loadoutNames(squad)).toEqual([
        ['Strike', 'Plasma Rifle'],
        ['Plasma Pistol', 'Sgt. Hand Weapon'],
        ['Strike', 'Battle Rifle'],
      ]);
      const plasma = squad.weapons.find((w) => w.id === 'plasma-rifle')!;
      expect(plasma.profile).toMatchObject({ range: 24, attacks: 4, specialRules: ['ap(2)'] });
      const pistol = squad.weapons.find((w) => w.id === 'plasma-pistol')!;
      expect(pistol.profile).toMatchObject({ range: 12, attacks: 2, specialRules: ['ap(2)', 'assault'] });
      expect(squad.weapons.find((w) => w.id === 'sgt-hand-weapon')!.profile).toMatchObject({ type: 'melee', attacks: 2 });
    });

    it('Sniper: Strike and a Sniper Rifle (30", A1, AP(1), Deadly(2), Reliable)', () => {
      const sniper = unit('Sniper');
      expect(loadoutNames(sniper)).toEqual([['Strike', 'Sniper Rifle']]);
      expect(sniper.weapons.find((w) => w.id === 'sniper-rifle')!.profile).toMatchObject({
        range: 30,
        attacks: 1,
        specialRules: ['ap(1)', 'deadly(2)', 'reliable'],
      });
    });
  });
});

describe('Human Defense Force deployment fit (Decision 9)', () => {
  it('all four units on each side settle inside the 12" zone with the default helpers, none overlapping', () => {
    const state = createInitialGameState('host', 'guest');
    applyDefaultScenario(state, { hostArmyId: 'hdf', guestArmyId: 'hdf', useDeploymentPhase: false });
    for (const owner of ['host', 'guest']) {
      const mine = state.units.filter((u) => u.ownerId === owner);
      expect(mine).toHaveLength(4);
      const bounds = getDeploymentZoneBounds(state, owner);
      for (const u of mine) {
        expect(u.isDeployed).toBe(true);
        for (const m of u.models) {
          expect(m.position!.x).toBeGreaterThanOrEqual(bounds.minX);
          expect(m.position!.x).toBeLessThanOrEqual(bounds.maxX);
          expect(m.position!.z).toBeGreaterThanOrEqual(bounds.minZ - 0.01);
          expect(m.position!.z).toBeLessThanOrEqual(bounds.maxZ + 0.01);
        }
      }
    }
    // Re-checking each unit against the others finds no problem (zone, terrain, spacing)
    for (const u of state.units) {
      u.isDeployed = false;
      expect(deploymentFootprintProblem(state, u, u.position)).toBeNull();
      u.isDeployed = true;
    }
  });

  it('with the deployment phase on, the four units start undeployed and all fit side by side in the zone', () => {
    const state = createInitialGameState('host', 'guest');
    applyDefaultScenario(state, { hostArmyId: 'hdf', guestArmyId: 'hdf', useDeploymentPhase: true });
    const lane = [-9, -3, 3, 9];
    for (const [owner, z] of [['host', -17], ['guest', 17]] as const) {
      const mine = state.units.filter((u) => u.ownerId === owner);
      expect(mine).toHaveLength(4);
      expect(mine.every((u) => u.isDeployed === false)).toBe(true);
      // Placed one after another (as a player would) on a 6" lane, every unit can stand in its spot
      mine.forEach((u, i) => {
        expect(deploymentFootprintProblem(state, u, { x: lane[i], y: 0, z })).toBeNull();
        u.position = { x: lane[i], y: 0, z };
        u.models.forEach((m) => (m.position = { ...u.position }));
        u.isDeployed = true;
      });
    }
  });
});
