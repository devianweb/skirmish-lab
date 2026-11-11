import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../../src/gameState';
import { GameState, Model, Unit, Vector3 } from '../../src/gameTypes';
import { WEAPONS } from '../../src/data/weapons';
import { firingModels, squadAim, computeSquadShootingRayDebug } from '../../src/engine/squadTargeting';
import { hasLineOfSight } from '../../src/engine/spatial';

const pt = (x: number, z: number): Vector3 => ({ x, y: 0, z });
const rifle = () => ({ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } });

function squad(id: string, owner: string, spots: Vector3[]): Unit {
  const models: Model[] = spots.map((p, i) => ({
    id: `${id}-m${i}`, wounds: 1, maxWounds: 1, isDestroyed: false, position: { ...p }, rotation: pt(0, 0),
  }));
  return {
    id, ownerId: owner, armyId: 'a', unitType: 'trooper', name: id, quality: 4, defense: 5, speed: 6,
    position: { ...spots[0] }, rotation: pt(0, 0), status: [], wounds: spots.length, maxWounds: spots.length,
    isActivated: false, isDestroyed: false, models, weapons: [rifle()], specialRules: [], hasMoved: false,
    remainingMovement: 6,
  };
}

function makeState(units: Unit[]): GameState {
  const state = createInitialGameState('h', 'g');
  state.units = units;
  state.terrain = [];
  return state;
}

describe('own squad-mates never block sight', () => {
  // Starting triangle: a front model with two models behind it, all facing the target straight ahead.
  const spots = [pt(0, 1.2), pt(-0.7, 0), pt(0.7, 0)];
  it.each([
    ['single-model target', [pt(0, 12)]],
    ['squad target, directly ahead', [pt(0, 12), pt(-1.2, 12.5), pt(1.2, 12.5)]],
  ])('every model fires: %s', (_n, targetSpots) => {
    const a = squad('a', 'h', spots);
    const t = squad('t', 'g', targetSpots);
    const state = makeState([a, t]);
    expect(firingModels(state, a, t, a.weapons[0])).toHaveLength(3);
    const aim = squadAim(state, a, t, a.weapons[0]);
    expect(aim.firingCount).toBe(3);
    expect(computeSquadShootingRayDebug(state, a, t, a.weapons[0]).hasLineOfSight).toBe(true);
    expect(hasLineOfSight(state, a, t)).toBe(true);
  });

  it('a rear model dead centre behind the front one still sees (squad-mates share the unit id)', () => {
    const a = squad('a', 'h', [pt(0, 1), pt(0, 0)]);
    const t = squad('t', 'g', [pt(0, 12)]);
    const state = makeState([a, t]);
    expect(firingModels(state, a, t, a.weapons[0])).toHaveLength(2);
  });

  it('other units still block', () => {
    const a = squad('a', 'h', [pt(0, 0)]);
    const t = squad('t', 'g', [pt(0, 12)]);
    const b = squad('b', 'h', [pt(0, 6)]);
    expect(firingModels(makeState([a, t, b]), a, t, a.weapons[0])).toHaveLength(0);
  });
});
