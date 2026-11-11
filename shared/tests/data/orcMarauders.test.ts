import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { STARTER_ARMIES, createUnitsFromStarterArmy } from '../../src/data/armies';
import { applyDefaultScenario } from '../../src/data/scenario';
import { applyAction } from '../../src/engine/actions';
import { deploymentFootprintProblem, getDeploymentZoneBounds } from '../../src/engine/activation';
import { getEffectiveSpeed } from '../../src/engine/specialRules';
import { getTraitValue, hasTrait } from '../../src/rules/traits';

const orcs = STARTER_ARMIES['orc-marauders'];
const fighter = (id: string) => orcs.fighters.find((f) => f.id === id)!;
const units = () => createUnitsFromStarterArmy(orcs, 'p');
const unit = (name: string) => units().find((u) => u.name.startsWith(name))!;

describe('Orc Marauders list (Decision 6)', () => {
  it('is a 400-pt, 5-unit list of the book units at their book costs', () => {
    expect(orcs.fighters.map((f) => [f.name, f.points])).toEqual([
      ['Orc Leader', 95],
      ['Orc Biker', 120],
      ['Veteran', 60],
      ['Infiltrator', 60],
      ['Specialist', 65],
    ]);
    expect(orcs.fighters.reduce((s, f) => s + f.points, 0)).toBe(400);
    expect(orcs.totalPoints).toBe(400);
  });

  it('has one Hero, Bad Shot and Ferocious everywhere, and 27 Tough in total', () => {
    expect(orcs.fighters.filter((f) => hasTrait(f.specialRules, 'hero'))).toHaveLength(1);
    expect(orcs.fighters.every((f) => hasTrait(f.specialRules, 'bad-shot') && hasTrait(f.specialRules, 'ferocious'))).toBe(true);
    const tough = orcs.fighters.reduce((s, f) => s + (getTraitValue(f.specialRules, 'tough') ?? 1) * (f.modelCount ?? 1), 0);
    expect(tough).toBe(27);
  });

  it('has the book Quality, Defense and Tough for each unit, all single models', () => {
    const row = (id: string) => {
      const f = fighter(id);
      return [f.quality, f.defense, f.modelCount ?? 1, getTraitValue(f.specialRules, 'tough')];
    };
    expect(row('orc-leader')).toEqual([4, 5, 1, 9]);
    expect(row('orc-biker')).toEqual([4, 5, 1, 9]);
    expect(row('orc-veteran')).toEqual([3, 4, 1, 3]);
    expect(row('orc-infiltrator')).toEqual([4, 5, 1, 3]);
    expect(row('orc-specialist')).toEqual([4, 5, 1, 3]);
    expect(unit('Orc Leader').models.map((m) => m.maxWounds)).toEqual([9]);
  });

  it('carries the book unit rules', () => {
    const rules = (id: string) => fighter(id).specialRules.filter((r) => !['bad-shot', 'ferocious'].includes(r)).sort();
    expect(rules('orc-leader')).toEqual(['hero', 'tough(9)']);
    expect(rules('orc-biker')).toEqual(['fast', 'tough(9)']);
    expect(rules('orc-veteran')).toEqual(['tough(3)']);
    expect(rules('orc-infiltrator')).toEqual(['scout', 'stealth', 'strider', 'tough(3)']);
    expect(rules('orc-specialist')).toEqual(['relentless', 'tough(3)']);
  });

  it('the Biker advances 2" further than its Speed (Fast)', () => {
    expect(getEffectiveSpeed(unit('Orc Biker'))).toBe(8);
    expect(getEffectiveSpeed(unit('Veteran'))).toBe(6);
  });

  describe('weapons', () => {
    const weapon = (u: string, id: string) => unit(u).weapons.find((w) => w.id === id)!.profile;

    it('Orc Leader: Hand Weapon A2, Heavy Flamer-Mod (12", A2, AP(1), Blast(3), Limited), Carbine (18", A4)', () => {
      expect(unit('Orc Leader').weapons.map((w) => w.name)).toEqual(['Hand Weapon', 'Heavy Flamer-Mod', 'Carbine']);
      expect(weapon('Orc Leader', 'orc-hand-weapon')).toMatchObject({ type: 'melee', attacks: 2 });
      expect(weapon('Orc Leader', 'heavy-flamer-mod')).toMatchObject({
        type: 'ranged',
        range: 12,
        attacks: 2,
        specialRules: ['ap(1)', 'blast(3)', 'limited'],
      });
      expect(weapon('Orc Leader', 'orc-carbine')).toMatchObject({ type: 'ranged', range: 18, attacks: 4, specialRules: [] });
    });

    it('Orc Biker: Hand Weapon A2, Pistol (12", A2, Assault), Bike-Gun (24", A4)', () => {
      expect(unit('Orc Biker').weapons.map((w) => w.name)).toEqual(['Hand Weapon', 'Pistol', 'Bike-Gun']);
      expect(weapon('Orc Biker', 'pistol')).toMatchObject({ range: 12, attacks: 2, specialRules: ['assault'] });
      expect(weapon('Orc Biker', 'bike-gun')).toMatchObject({ type: 'ranged', range: 24, attacks: 4, specialRules: [] });
    });

    it('Veteran and Infiltrator: Hand Weapon A2 and Pistol (12", A2, Assault)', () => {
      for (const name of ['Veteran', 'Infiltrator']) {
        expect(unit(name).weapons.map((w) => w.name)).toEqual(['Hand Weapon', 'Pistol']);
        expect(weapon(name, 'orc-hand-weapon')).toMatchObject({ type: 'melee', attacks: 2 });
        expect(weapon(name, 'pistol')).toMatchObject({ range: 12, attacks: 2, specialRules: ['assault'] });
      }
    });

    it('Specialist: Strike A2 and Flamer (12", A2, Blast(3), Reliable)', () => {
      expect(unit('Specialist').weapons.map((w) => w.name)).toEqual(['Strike', 'Flamer']);
      expect(weapon('Specialist', 'strike')).toMatchObject({ type: 'melee', attacks: 2 });
      expect(weapon('Specialist', 'flamer')).toMatchObject({ range: 12, attacks: 2, specialRules: ['blast(3)', 'reliable'] });
    });
  });

  it('the Heavy Flamer-Mod fires once (Limited): it is put away after the first shot', () => {
    const state = createInitialGameState('host', 'guest');
    applyDefaultScenario(state, { hostArmyId: 'orc-marauders', guestArmyId: 'hdf', useDeploymentPhase: false });
    const leader = state.units.find((u) => u.ownerId === 'host' && u.name.startsWith('Orc Leader'))!;
    const target = state.units.find((u) => u.ownerId === 'guest')!;
    // Stand the leader 6" from the target in the open
    state.terrain = [];
    leader.position = { x: 0, y: 0, z: 0 };
    leader.models[0].position = { ...leader.position };
    target.position = { x: 0, y: 0, z: 7 };
    target.models.forEach((m) => (m.position = { ...target.position }));
    state.status = 'in-progress';
    state.turnState.phase = 'activation';
    state.turnState.currentPlayerId = 'host';
    state.turnState.activeUnitId = leader.id;
    const flamer = leader.weapons.find((w) => w.id === 'heavy-flamer-mod')!;
    expect(flamer.isEquipped).toBe(true);
    const shoot = createAction('host', 'shoot', { type: 'shoot', attackerId: leader.id, targetId: target.id, weaponId: flamer.id });
    const dice = [
      { rolls: [1, 1], total: 2, finalTotal: 2, purpose: 'to-hit' },
      { rolls: [6, 6, 6, 6, 6, 6, 6, 6], total: 48, finalTotal: 48, purpose: 'defense' },
    ];
    const res = applyAction(state, shoot, dice);
    expect(res.ok).toBe(true);
    const after = res.state!.units.find((u) => u.id === leader.id)!;
    expect(after.weapons.find((w) => w.id === 'heavy-flamer-mod')!.isEquipped).toBe(false);
  });
});

describe('Orc Marauders deployment fit (Decision 9)', () => {
  it('all five units on each side settle inside the 12" zone with the default helpers, none overlapping', () => {
    const state = createInitialGameState('host', 'guest');
    applyDefaultScenario(state, { hostArmyId: 'orc-marauders', guestArmyId: 'orc-marauders', useDeploymentPhase: false });
    for (const owner of ['host', 'guest']) {
      const mine = state.units.filter((u) => u.ownerId === owner);
      expect(mine).toHaveLength(5);
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
    for (const u of state.units) {
      u.isDeployed = false;
      expect(deploymentFootprintProblem(state, u, u.position)).toBeNull();
      u.isDeployed = true;
    }
  });

  it('with the deployment phase on, the five units start undeployed and all fit side by side in the zone', () => {
    const state = createInitialGameState('host', 'guest');
    applyDefaultScenario(state, { hostArmyId: 'orc-marauders', guestArmyId: 'hdf', useDeploymentPhase: true });
    const lane = [-10, -5, 0, 5, 10];
    const mine = state.units.filter((u) => u.ownerId === 'host');
    expect(mine).toHaveLength(5);
    expect(mine.every((u) => u.isDeployed === false)).toBe(true);
    mine.forEach((u, i) => {
      expect(deploymentFootprintProblem(state, u, { x: lane[i], y: 0, z: -17 })).toBeNull();
      u.position = { x: lane[i], y: 0, z: -17 };
      u.models.forEach((m) => (m.position = { ...u.position }));
      u.isDeployed = true;
    });
  });
});
