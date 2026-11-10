import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { WEAPONS } from '../../src/data/weapons';
import { applyAction, validateAction } from '../../src/engine/actions';

const HOST = 'host1';
const GUEST = 'guest1';
const P = (x: number, z: number): Vector3 => ({ x, y: 0, z });

function mkUnit(id: string, ownerId: string, spots: Array<[number, number]>, extra: Partial<Unit> = {}): Unit {
  const models = spots.map(([x, z], i) => ({
    id: `${id}-m${i}`, wounds: 1, maxWounds: 1, isDestroyed: false, position: P(x, z), rotation: { x: 0, y: 0, z: 0 },
  }));
  const cx = spots.reduce((a, s) => a + s[0], 0) / spots.length;
  const cz = spots.reduce((a, s) => a + s[1], 0) / spots.length;
  return {
    id, ownerId, armyId: 'a', unitType: 'trooper', name: id, quality: 4, defense: 5, speed: 6,
    position: P(cx, cz), rotation: { x: 0, y: 0, z: 0 }, status: [], wounds: spots.length, maxWounds: spots.length,
    isActivated: ownerId === HOST, isDestroyed: false, models,
    weapons: [{ ...WEAPONS.blade, profile: { ...WEAPONS.blade.profile } }],
    specialRules: [], hasMoved: false, remainingMovement: 6, ...extra,
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

const block = (): GameState =>
  mkState([mkUnit('h1', HOST, [[0, 0], [1, 0], [0, 1], [1, 1]]), mkUnit('g1', GUEST, [[0, 40]])]);

const home = (state: GameState) => state.units[0].models.map((m) => ({ ...m.position! }));

/** One model walks `out` inches away and straight back (costs 2*out, ends where it started); the rest stay. */
function wander(state: GameState, index: number, out: number, type: 'advance' | 'rush' = 'advance', dz = -1) {
  const positions = home(state);
  const start = positions[index];
  const paths = positions.map((p) => [p]);
  paths[index] = [start, P(start.x, start.z + dz * out), { ...start }];
  const u = state.units[0];
  return createAction(HOST, type, {
    type, unitId: 'h1', path: [u.position, u.position], finalPosition: u.position,
    modelPositions: positions, modelPaths: paths,
  });
}

describe('per-model movement budget: split move', () => {
  it('lets a second model use its full distance after the first used all of its own', () => {
    const s0 = block();
    const leg1 = wander(s0, 0, 3);
    expect(validateAction(s0, leg1)).toEqual({ valid: true });
    const s1 = applyAction(s0, leg1).state!;
    const u1 = s1.units[0];
    // Model 1 spent 6", the others none: somebody can still move the full 6"
    expect(u1.remainingMovement).toBe(6);
    expect(u1.modelMovementSpent).toMatchObject({ 'h1-m0': 6 });
    const leg2 = wander(s1, 1, 3);
    expect(validateAction(s1, leg2)).toEqual({ valid: true });
    const s2 = applyAction(s1, leg2).state!;
    expect(s2.units[0].modelMovementSpent).toMatchObject({ 'h1-m0': 6, 'h1-m1': 6 });
  });

  it('rejects the model that is out of distance even when a squad-mate can still move', () => {
    const s1 = applyAction(block(), wander(block(), 0, 3)).state!;
    const res = validateAction(s1, wander(s1, 0, 0.25));
    expect(res.valid).toBe(false);
    expect(res).toMatchObject({ reason: expect.stringContaining('Squad model 1') });
  });

  it('adds up legs per model (4" then 2" is fine, 4" then 2.5" is not)', () => {
    const s0 = block();
    const s1 = applyAction(s0, wander(s0, 2, 2, 'advance', 1)).state!;
    expect(validateAction(s1, wander(s1, 2, 1, 'advance', 1))).toEqual({ valid: true });
    expect(validateAction(s1, wander(s1, 2, 1.25, 'advance', 1)).valid).toBe(false);
  });

  it('unit remainingMovement is the budget minus the smallest spend', () => {
    let s = block();
    for (let i = 0; i < 4; i++) s = applyAction(s, wander(s, i, 1)).state!;
    expect(s.units[0].remainingMovement).toBe(4);
    expect(s.units[0].modelMovementSpent).toEqual({ 'h1-m0': 2, 'h1-m1': 2, 'h1-m2': 2, 'h1-m3': 2 });
  });

  it('survives a JSON round trip in the middle of a split move', () => {
    const s1 = applyAction(block(), wander(block(), 0, 3)).state!;
    const copy = JSON.parse(JSON.stringify(s1)) as GameState;
    expect(copy.units[0].modelMovementSpent).toMatchObject({ 'h1-m0': 6 });
    expect(validateAction(copy, wander(copy, 1, 3))).toEqual({ valid: true });
    expect(validateAction(copy, wander(copy, 0, 0.25)).valid).toBe(false);
  });

  it('a new activation starts every model fresh', () => {
    const s = block();
    s.units[0].modelMovementSpent = { 'h1-m0': 6 };
    s.units[0].remainingMovement = 6;
    s.units[0].isActivated = false;
    s.turnState.activeUnitId = null;
    const next = applyAction(s, createAction(HOST, 'activate-unit', { type: 'activate-unit', unitId: 'h1' }));
    expect(next.ok).toBe(true);
    expect(next.state!.units[0].modelMovementSpent).toBeUndefined();
    expect(next.state!.units[0].remainingMovement).toBe(6);
  });
});

describe('per-model movement budget: split rush', () => {
  it('each model has its own 12"', () => {
    const s0 = block();
    const s1 = applyAction(s0, wander(s0, 0, 6, 'rush')).state!;
    expect(s1.units[0].isRushing).toBe(true);
    expect(s1.units[0].remainingMovement).toBe(12);
    expect(validateAction(s1, wander(s1, 1, 6, 'rush'))).toEqual({ valid: true });
    expect(validateAction(s1, wander(s1, 0, 0.25, 'rush')).valid).toBe(false);
  });

  it('keeps the 6" Difficult Terrain cap per model', () => {
    const mud: TerrainPiece = {
      id: 'mud', terrainType: 'mud', position: P(1, -3), rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 4, y: 0.1, z: 4 }, isDifficult: true, isWalkable: true, blocksLineOfSight: false,
      providesCover: false, isObstacle: false,
    };
    const s0 = block();
    s0.terrain = [mud];
    const s1 = applyAction(s0, wander(s0, 0, 3, 'rush', 1)).state!;
    expect(validateAction(s1, wander(s1, 1, 3.5, 'rush'))).toMatchObject({ valid: false });
    expect(validateAction(s1, wander(s1, 1, 3, 'rush'))).toEqual({ valid: true });
  });
});

describe('per-model movement budget: split squad charge', () => {
  const lineAbreast = () =>
    mkState([
      mkUnit('h1', HOST, [[0, 0], [1, 0], [2, 0], [3, 0]], { speed: 4, remainingMovement: 4 }),
      mkUnit('g1', GUEST, [[0, 9], [1, 9], [0.5, 10]]),
    ]);
  const begin = () => createAction(HOST, 'begin-charge', { type: 'begin-charge', attackerId: 'h1', targetId: 'g1' });
  const cur = (s: GameState) => s.units[0].models.map((m) => ({ ...m.position! }));
  const act = (s: GameState, ends: Vector3[], type: 'charge' | 'charge-leg') =>
    createAction(HOST, type, {
      type, attackerId: 'h1', ...(type === 'charge' ? { targetId: 'g1', weaponId: 'blade' } : {}),
      path: [P(0, 0), ends[0]], modelPositions: ends, modelPaths: cur(s).map((c, i) => [c, ends[i]]),
    } as any);
  const dice = (): DiceResult[] => [
    { rolls: Array(40).fill(1), total: 40, finalTotal: 40, purpose: 'to-hit' },
    { rolls: Array(40).fill(6), total: 240, finalTotal: 240, purpose: 'defense' },
    { rolls: [1], total: 1, finalTotal: 1, purpose: 'trauma' },
  ];

  it('regression: the furthest mover in each leg does not cost a squad-mate its distance', () => {
    let s = applyAction(lineAbreast(), begin()).state!;
    // Leg 1: model 1 walks 5", the rest 4"
    s = applyAction(s, act(s, [P(0, 5), P(1, 4), P(2, 4), P(3, 4)], 'charge-leg')).state!;
    expect(s.units[0].remainingMovement).toBe(4);
    // Leg 2: model 1 walks 1" more (6" used), the rest 1" (5" used)
    const leg2 = act(s, [P(0, 6), P(1, 5), P(2, 5), P(3, 5)], 'charge-leg');
    expect(validateAction(s, leg2)).toEqual({ valid: true });
    s = applyAction(s, leg2).state!;
    expect(s.units[0].remainingMovement).toBe(3);
    // Final: model 1 has 2" left, models 2-4 have 3" left: all reach z = 8
    const finalMove = act(s, [P(0, 8), P(1, 8), P(2, 8), P(3, 8)], 'charge');
    expect(validateAction(s, finalMove)).toEqual({ valid: true });
    expect(applyAction(s, finalMove, dice()).ok).toBe(true);
  });

  it('rejects a model that asks for more than its own leftover', () => {
    let s = applyAction(lineAbreast(), begin()).state!;
    s = applyAction(s, act(s, [P(0, 5), P(1, 4), P(2, 4), P(3, 4)], 'charge-leg')).state!;
    s = applyAction(s, act(s, [P(0, 6), P(1, 5), P(2, 5), P(3, 5)], 'charge-leg')).state!;
    // Model 1 has 2" left, so z = 8.5 is too far for it
    const res = validateAction(s, act(s, [P(0, 8.5), P(1, 8), P(2, 8), P(3, 8)], 'charge'));
    expect(res.valid).toBe(false);
    expect(res).toMatchObject({ reason: expect.stringContaining('Squad model 1') });
  });

  it('keeps the tally serializable mid-charge', () => {
    let s = applyAction(lineAbreast(), begin()).state!;
    s = applyAction(s, act(s, [P(0, 5), P(1, 4), P(2, 4), P(3, 4)], 'charge-leg')).state!;
    const copy = JSON.parse(JSON.stringify(s)) as GameState;
    expect(copy.units[0].modelMovementSpent).toEqual({ 'h1-m0': 5, 'h1-m1': 4, 'h1-m2': 4, 'h1-m3': 4 });
    const leg2 = act(copy, [P(0, 6), P(1, 5), P(2, 5), P(3, 5)], 'charge-leg');
    expect(validateAction(copy, leg2)).toEqual({ valid: true });
  });
});

describe('single-model units are unchanged', () => {
  it('never get a per-model tally', () => {
    const s0 = mkState([mkUnit('h1', HOST, [[0, 0]]), mkUnit('g1', GUEST, [[0, 40]])]);
    const move = createAction(HOST, 'advance', {
      type: 'advance', unitId: 'h1', path: [P(0, 0), P(0, 4)], finalPosition: P(0, 4),
    });
    const s1 = applyAction(s0, move).state!;
    expect(s1.units[0].remainingMovement).toBe(2);
    expect(s1.units[0].modelMovementSpent).toBeUndefined();
  });
});
