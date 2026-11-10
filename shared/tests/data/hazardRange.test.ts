import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { GameState, Unit, Vector3 } from '../../src/gameTypes';
import { BUILTIN_MAPS, createHazardRangeMap } from '../../src/data/builtinMaps';
import { STARTER_ARMIES, createUnitsFromStarterArmy } from '../../src/data/armies';
import { getDeploymentZoneBounds } from '../../src/engine/activation';
import { getDiceSpecs } from '../../src/engine/actions';
import { isDangerousPiece } from '../../src/data/mapSchema';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

/** A Hazard Check unit (0 squad, 1 hero, 2 flyers) standing in a row from `at` on the Hazard Range. */
function setup(index: number, at: Vector3): { state: GameState; unit: Unit } {
  const state = createInitialGameState(HOST, GUEST);
  state.terrain = createHazardRangeMap().terrain;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  const unit = createUnitsFromStarterArmy(STARTER_ARMIES['test-hazard-army'], HOST)[index] as Unit;
  unit.position = { ...at };
  unit.models.forEach((m, i) => (m.position = { ...at, z: at.z - i * 1.2 }));
  const foe = createUnitsFromStarterArmy(STARTER_ARMIES['test-hazard-army'], GUEST)[0] as Unit;
  foe.position = P(0, 0, 20);
  foe.models.forEach((m, i) => (m.position = P(i * 1.2, 0, 20)));
  state.units = [unit, foe];
  return { state, unit };
}

/** A straight Rush along z = -8 from x0 to x1 (the row of models follows behind in z). */
const rush = (unitId: string, x0: number, x1: number) => {
  const path = [P(x0, 0, -8), P(x1, 0, -8)];
  return createAction(HOST, 'rush', { type: 'rush', unitId, path, finalPosition: path[1] });
};

describe('Hazard Range map and TEST: Hazard Check army (manual dangerous terrain testing)', () => {
  it('is a built-in map, point-symmetric, with three dangerous pools per side', () => {
    expect(BUILTIN_MAPS['hazard-range']().name).toBe('Hazard Range');
    const { terrain } = createHazardRangeMap();
    expect(terrain.filter(isDangerousPiece)).toHaveLength(6);
    for (const t of terrain) {
      const twin = terrain.find(
        (o) => o !== t && Math.abs(o.position.x + t.position.x) < 1e-6 && Math.abs(o.position.z + t.position.z) < 1e-6
      );
      expect(twin, `twin of ${t.id}`).toBeDefined();
    }
  });

  it('keeps every pool outside both deployment zones', () => {
    const state = createInitialGameState(HOST, GUEST);
    const zones = [getDeploymentZoneBounds(state, HOST), getDeploymentZoneBounds(state, GUEST)];
    for (const t of createHazardRangeMap().terrain) {
      for (const z of zones) {
        const overlapZ = t.position.z + t.scale.z / 2 > z.minZ && t.position.z - t.scale.z / 2 < z.maxZ;
        expect(overlapZ, t.id).toBe(false);
      }
    }
  });

  it('the army is a 5-model Tough 1 squad, a Tough 3 Hero and a Flying squad', () => {
    const [squad, hero, flyers] = createUnitsFromStarterArmy(STARTER_ARMIES['test-hazard-army'], HOST) as Unit[];
    expect(squad.models).toHaveLength(5);
    expect(hero.specialRules).toEqual(expect.arrayContaining(['hero', 'tough(3)']));
    expect(flyers.specialRules).toContain('flying');
  });

  it('the squad rushing across pools A and B asks for two tests of 5 dice', () => {
    const { state, unit } = setup(0, P(-13, 0, -8));
    const specs = getDiceSpecs(state, rush(unit.id, -13, 1));
    expect(specs.filter((s) => s.purpose?.startsWith('hazard_'))).toEqual([
      expect.objectContaining({ count: 5 }),
      expect.objectContaining({ count: 5 }),
    ]);
  });

  it('the Hero asks for 3 dice crossing pool C, 2 once it has taken a wound', () => {
    const { state, unit } = setup(1, P(5, 0, -8));
    expect(getDiceSpecs(state, rush(unit.id, 5, 13))).toEqual([expect.objectContaining({ count: 3 })]);
    unit.models[0].wounds = 2;
    unit.wounds = 2;
    expect(getDiceSpecs(state, rush(unit.id, 5, 13))).toEqual([expect.objectContaining({ count: 2 })]);
  });

  it('the Flying squad asks for no dice', () => {
    const { state, unit } = setup(2, P(-13, 0, -8));
    expect((getDiceSpecs(state, rush(unit.id, -13, 1)) ?? []).filter((s) => s.purpose?.startsWith('hazard_'))).toEqual([]);
  });
});
