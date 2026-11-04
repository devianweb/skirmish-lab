import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import { validateAction } from '../../src/engine/actions';
import { closestApproach } from '../../src/engine/closestApproach';
import { coherencyShortfall, validateSquadCoherency } from '../../src/engine/spatial';
import { livingModelPositions, modelGap } from '../../src/engine/unitGeometry';

const HOST = 'host1';
const GUEST = 'guest1';
const P = (x: number, z: number, y = 0): Vector3 => ({ x, y, z });

function mkUnit(id: string, ownerId: string, spots: Array<[number, number]>, extra: Partial<Unit> = {}): Unit {
  const models = spots.map(([x, z], i) => ({
    id: `${id}-m${i}`,
    wounds: 1,
    maxWounds: 1,
    isDestroyed: false,
    position: P(x, z),
    rotation: { x: 0, y: 0, z: 0 },
  }));
  const cx = spots.reduce((a, s) => a + s[0], 0) / spots.length;
  const cz = spots.reduce((a, s) => a + s[1], 0) / spots.length;
  return {
    id,
    ownerId,
    armyId: 'a',
    unitType: 'trooper',
    name: id,
    quality: 4,
    defense: 5,
    speed: 4,
    position: P(cx, cz),
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    wounds: spots.length,
    maxWounds: spots.length,
    isActivated: ownerId === HOST,
    isDestroyed: false,
    models,
    weapons: [{ ...WEAPONS.blade, profile: { ...WEAPONS.blade.profile } }],
    specialRules: [],
    hasMoved: false,
    remainingMovement: 4,
    ...extra,
  };
}

function mkState(units: Unit[], terrain: TerrainPiece[] = []): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.terrain = terrain;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = 'h1';
  return state;
}

function piece(id: string, type: string, x: number, z: number, extra: Partial<TerrainPiece> = {}): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG[type as keyof typeof TERRAIN_PALETTE_CATALOG];
  return {
    id,
    terrainType: type,
    position: P(x, z),
    rotation: { x: 0, y: 0, z: 0 },
    scale: { ...meta.defaultScale },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
    ...extra,
  } as TerrainPiece;
}

const gapOf = (state: GameState, p: Vector3, targetId = 'g1') =>
  Math.min(...livingModelPositions(state.units.find((u) => u.id === targetId)!).map((t) => modelGap(p, t)));

describe('closestApproach', () => {
  it('walks into base contact when the target is within the budget', () => {
    const state = mkState([mkUnit('h1', HOST, [[0, 0], [1, 0]]), mkUnit('g1', GUEST, [[0, 6]])]);
    const h1 = state.units[0];
    const res = closestApproach(state, h1, 0, P(0, 0), 8, state.units[1], [P(1, 0)]);
    // The other model stays at the back, so only the chain (2" centre links) holds this one close... but a
    // 2-model squad that has to remain coherent can only advance as far as the link allows
    expect(res).not.toBeNull();
    expect(validateSquadCoherency([res!.position, P(1, 0)]).coherent).toBe(true);
  });

  it('stops where the budget runs out when the target is farther than the budget', () => {
    const state = mkState([mkUnit('h1', HOST, [[0, 0], [1, 0]]), mkUnit('g1', GUEST, [[0, 20]])]);
    const res = closestApproach(state, state.units[0], 0, P(0, 0), 8, state.units[1], [P(1, 8)])!;
    expect(res.cost).toBeLessThanOrEqual(8.05);
    expect(res.cost).toBeGreaterThan(7.5);
    expect(res.position.z).toBeGreaterThan(7.5);
    expect(res.gap).toBeCloseTo(gapOf(state, res.position), 1);
  });

  it('reaches contact when nothing holds it back', () => {
    const state = mkState([mkUnit('h1', HOST, [[0, 0], [1, 0]]), mkUnit('g1', GUEST, [[0, 6]])]);
    // The other model has already closed up in contact, so this one may follow it
    const res = closestApproach(state, state.units[0], 0, P(0, 0), 8, state.units[1], [P(1, 5)])!;
    expect(res.gap).toBeLessThan(0.05);
    expect(res.path[0]).toEqual(P(0, 0));
  });

  it('never goes through the wall: it walks round it when the budget allows, and stops short when not', () => {
    // A wall between the model and the target
    const wall = piece('w', 'wall-long', 0, 4);
    const state = mkState([mkUnit('h1', HOST, [[0, 0]]), mkUnit('g1', GUEST, [[0, 8]])], [wall]);
    const other: Vector3[] = [];
    const direct = closestApproach(state, state.units[0], 0, P(0, 0), 3, state.units[1], other)!;
    expect(direct.position.z).toBeLessThan(4);
    const round = closestApproach(state, state.units[0], 0, P(0, 0), 14, state.units[1], [])!;
    expect(round.gap).toBeLessThan(0.6);
    expect(round.cost).toBeGreaterThan(8);
  });

  it('is held back by coherency with where the others end', () => {
    const state = mkState([mkUnit('h1', HOST, [[0, 0], [0, 1]]), mkUnit('g1', GUEST, [[0, 10]])]);
    // The other model stays at z = 1: this one can be at most 2" (centre) from it
    const res = closestApproach(state, state.units[0], 0, P(0, 0), 8, state.units[1], [P(0, 1)])!;
    expect(res.position.z).toBeLessThanOrEqual(3.05);
    expect(validateSquadCoherency([res.position, P(0, 1)]).coherent).toBe(true);
  });

  it('keeps the shortfall from growing when the squad started out of coherency', () => {
    const state = mkState([mkUnit('h1', HOST, [[0, 0], [9, 0]]), mkUnit('g1', GUEST, [[0, 12]])]);
    const before = coherencyShortfall(livingModelPositions(state.units[0]));
    expect(before).toBeGreaterThan(0);
    const other = [P(9, 0)];
    const res = closestApproach(state, state.units[0], 0, P(0, 0), 8, state.units[1], other)!;
    expect(coherencyShortfall([res.position, ...other])).toBeLessThanOrEqual(before + 0.001);
  });

  it('never needs a jump: a model on a high deck stays on it rather than leaping to the ground', () => {
    const deck = piece('deck', 'platform-small', -2, 0, {
      scale: { ...TERRAIN_PALETTE_CATALOG['platform-small'].defaultScale, y: 4.5 },
      isWalkable: true,
    });
    const state = mkState([mkUnit('h1', HOST, [[-0.5, 0], [-1.5, 0]], { speed: 6 }), mkUnit('g1', GUEST, [[6, 0]])], [deck]);
    const h1 = state.units[0];
    for (const m of h1.models) m.position = { ...m.position!, y: 4.5 };
    const res = closestApproach(state, h1, 0, P(-0.5, 0, 4.5), 12, state.units[1], [P(-1.5, 0, 4.5)])!;
    expect(res).not.toBeNull();
    expect(res.position.y).toBeCloseTo(4.5);
    expect(res.path.every((p) => (p.y ?? 0) > 4)).toBe(true);
  });

  it('is deterministic', () => {
    const wall = piece('w', 'wall', 1, 4);
    const state = mkState([mkUnit('h1', HOST, [[0, 0], [1, 0], [2, 0]]), mkUnit('g1', GUEST, [[1, 8], [2, 9]])], [wall]);
    const run = () => closestApproach(state, state.units[0], 1, P(1, 0), 8, state.units[1], [P(0, 0), P(2, 0)]);
    expect(run()).toEqual(run());
  });

  it('aims at the nearest of several target models', () => {
    const state = mkState([mkUnit('h1', HOST, [[0, 0]]), mkUnit('g1', GUEST, [[8, 3], [0, 9]])]);
    const res = closestApproach(state, state.units[0], 0, P(0, 0), 8, state.units[1], [])!;
    expect(res.gap).toBeLessThan(0.1);
    expect(res.position.z).toBeGreaterThan(6);
  });
});

describe('closestApproach: speed of the host check for a 10-model squad', () => {
  it('validates a ten-model charge quickly', () => {
    // Two rows of five (rows at z = 0 and z = -1), a crate off to the side, a row of five defenders
    const spots: Array<[number, number]> = [];
    for (let i = 0; i < 10; i++) spots.push([(i % 5) - 2, i < 5 ? 0 : -1]);
    const crate = piece('c', 'crate', 6, 4);
    const state = mkState(
      [mkUnit('h1', HOST, spots, { speed: 4 }), mkUnit('g1', GUEST, [[-2, 8.5], [-1, 8.5], [0, 8.5], [1, 8.5], [2, 8.5]])],
      [crate]
    );
    const ends: Vector3[] = spots.map(([x], i) => P(x, i < 5 ? 7.5 : 6.5));
    const action = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      path: [P(0, 0), ends[0]],
      modelPositions: ends,
      modelPaths: spots.map(([x, z], i) => [P(x, z), ends[i]]),
      weaponId: 'blade',
    } as any);
    const t0 = performance.now();
    const res = validateAction(state, action);
    const ms = performance.now() - t0;
    // Whether the back row is close enough is the rule's business; the check must be fast either way
    expect(ms).toBeLessThan(1500);
  });

  it('finds spots for ten models round a wall (worst case: every model has to path-find)', () => {
    const spots: Array<[number, number]> = [];
    for (let i = 0; i < 10; i++) spots.push([(i % 5) - 2, i < 5 ? 0 : -1]);
    const wall = piece('w', 'wall-long', 0, 4);
    const state = mkState(
      [mkUnit('h1', HOST, spots, { speed: 8 }), mkUnit('g1', GUEST, [[-2, 8.5], [-1, 8.5], [0, 8.5], [1, 8.5], [2, 8.5]])],
      [wall]
    );
    const placed: Vector3[] = [];
    const t0 = performance.now();
    spots.forEach(([x, z], i) => {
      const res = closestApproach(state, state.units[0], i, P(x, z), 16, state.units[1], placed);
      if (res) placed.push(res.position);
    });
    const ms = performance.now() - t0;
    expect(placed.length).toBeGreaterThan(5);
    expect(ms).toBeLessThan(3000);
  });
});
