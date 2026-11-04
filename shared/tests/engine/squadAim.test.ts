import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../../src/gameState';
import { GameState, Model, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import { computeSquadShootingRayDebug, squadAim } from '../../src/engine/squadTargeting';

const HOST = 'host1';
const GUEST = 'guest1';
const pt = (x: number, z: number, y = 0): Vector3 => ({ x, y, z });
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

function wall(x: number, z: number): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG.wall;
  return {
    id: `wall-${x}-${z}`, terrainType: 'wall', position: pt(x, z), rotation: pt(0, 0),
    scale: { ...meta.defaultScale }, blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover, isObstacle: meta.isObstacle,
  };
}

function makeState(units: Unit[], terrain: TerrainPiece[] = []): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.terrain = terrain;
  return state;
}

describe('squadAim: one aim per attacker model', () => {
  it('each firing model aims at its own nearest target model, not at the squad middle', () => {
    const a = squad('a', HOST, [pt(0, 0), pt(10, 0)]);
    const t = squad('t', GUEST, [pt(0, 10), pt(10, 10)]);
    const aim = squadAim(makeState([a, t]), a, t, a.weapons[0]);
    expect(aim.aims).toHaveLength(2);
    expect(aim.aims[0].targetModel).toEqual(pt(0, 10));
    expect(aim.aims[1].targetModel).toEqual(pt(10, 10));
    expect(aim.aims.every((x) => x.fires)).toBe(true);
    expect(aim.firingCount).toBe(2);
    expect(aim.aims[0].from.y).toBeCloseTo(1.1);
  });

  it('a model walled off from every target model does not fire but still has a ray to the nearest model', () => {
    const a = squad('a', HOST, [pt(0, 0), pt(10, 0)]);
    const t = squad('t', GUEST, [pt(0, 10), pt(4, 10)]);
    const aim = squadAim(makeState([a, t], [wall(-2, 4), wall(2, 4)]), a, t, a.weapons[0]);
    expect(aim.aims[0].fires).toBe(false);
    expect(aim.aims[0].targetModel).toEqual(pt(0, 10));
    expect(aim.aims[1].fires).toBe(true);
    expect(aim.firingCount).toBe(1);
    expect(aim.shooterCount).toBe(2);
    expect(aim.targetModelCount).toBe(2);
  });

  it('skips a hidden near model and aims at the nearest VISIBLE one', () => {
    const a = squad('a', HOST, [pt(0, 0)]);
    const t = squad('t', GUEST, [pt(0, 10), pt(8, 10)]);
    const aim = squadAim(makeState([a, t], [wall(0, 5)]), a, t, a.weapons[0]);
    expect(aim.aims[0].fires).toBe(true);
    expect(aim.aims[0].targetModel).toEqual(pt(8, 10));
  });

  it('reports the picked model only when a firing model can see it', () => {
    const a = squad('a', HOST, [pt(0, 0)]);
    const t = squad('t', GUEST, [pt(0, 10), pt(8, 10)]);
    const state = makeState([a, t], [wall(0, 5)]);
    expect(squadAim(state, a, t, a.weapons[0], 't-m1').aimedModel).toEqual(pt(8, 10));
    expect(squadAim(state, a, t, a.weapons[0], 't-m0').aimedModel).toBeUndefined();
    expect(squadAim(state, a, t, a.weapons[0], 'nope').aimedModel).toBeUndefined();
  });

  it('out-of-range target models are not aimed at as visible', () => {
    const a = squad('a', HOST, [pt(0, 0)]);
    const t = squad('t', GUEST, [pt(0, 30)]);
    const aim = squadAim(makeState([a, t]), a, t, a.weapons[0], 't-m0');
    expect(aim.firingCount).toBe(0);
    expect(aim.aimedModel).toBeUndefined();
  });
});

describe('computeSquadShootingRayDebug', () => {
  it('gives one ray per attacker model and keeps the detailed trace on the closest pair', () => {
    const a = squad('a', HOST, [pt(0, 0), pt(10, 0)]);
    const t = squad('t', GUEST, [pt(10, 10), pt(14, 10)]);
    const info = computeSquadShootingRayDebug(makeState([a, t]), a, t, a.weapons[0]);
    expect(info.modelRays).toHaveLength(2);
    expect(info.firingCount).toBe(2);
    expect(info.shooterCount).toBe(2);
    expect(info.targetModelCount).toBe(2);
    expect(info.from.x).toBe(10);
    expect(info.to.x).toBe(10);
    expect(info.distance).toBeCloseTo(10);
  });

  it('squad is not LoS-blocked while any model can fire, even if the closest pair is walled off', () => {
    const a = squad('a', HOST, [pt(0, 0), pt(12, 0)]);
    const t = squad('t', GUEST, [pt(0, 6)]);
    const info = computeSquadShootingRayDebug(makeState([a, t], [wall(0, 3)]), a, t, a.weapons[0]);
    expect(info.hasLineOfSight).toBe(true);
    expect(info.firingCount).toBe(1);
  });

  it('cover follows the majority rule and reports the count', () => {
    const a = squad('a', HOST, [pt(0, 0)]);
    const t = squad('t', GUEST, [pt(-1, 6), pt(1, 6), pt(8, 6)]);
    const info = computeSquadShootingRayDebug(makeState([a, t], [wall(0, 4.5)]), a, t, a.weapons[0]);
    expect(info.targetModelCount).toBe(3);
    expect(info.providesCover).toBe(info.coveredModelCount! * 2 > 3);
    expect(info.coverReason).toContain(`${info.coveredModelCount}/3`);
  });

  it('a lone shooter and target behave like the plain single-model debug', () => {
    const a = squad('a', HOST, [pt(0, 0)]);
    const t = squad('t', GUEST, [pt(0, 8)]);
    const info = computeSquadShootingRayDebug(makeState([a, t]), a, t, a.weapons[0]);
    expect(info.modelRays).toHaveLength(1);
    expect(info.hasLineOfSight).toBe(true);
    expect(info.distance).toBeCloseTo(8);
  });
});
