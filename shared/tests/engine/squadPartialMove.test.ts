import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { GameState, Unit, Vector3 } from '../../src/gameTypes';
import { applyAction, validateAction } from '../../src/engine/actions';

const HOST = 'host1';
const GUEST = 'guest1';

function mk(id: string, x: number, z: number) {
  return { id, wounds: 1, maxWounds: 1, isDestroyed: false, position: { x, y: 0, z } as Vector3 };
}

function makeUnit(id: string, ownerId: string, overrides: Partial<Unit> = {}): Unit {
  return {
    id, ownerId, armyId: 'a', unitType: 'trooper', name: id, quality: 4, defense: 5, speed: 6,
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, status: [], wounds: 4, maxWounds: 4,
    isActivated: false, isDestroyed: false, models: [], weapons: [], specialRules: [],
    hasMoved: false, remainingMovement: 6, ...overrides,
  };
}

/** Four-model squad in a 2x2 block at z 0..1, optionally already activated. */
function squadState(startActive = true): GameState {
  const squad = makeUnit('h1', HOST, { position: { x: 0.5, y: 0, z: 0.5 } });
  squad.models = [mk('m1', 0, 0), mk('m2', 1, 0), mk('m3', 0, 1), mk('m4', 1, 1)];
  const state = createInitialGameState(HOST, GUEST);
  state.units = [squad, makeUnit('g1', GUEST, { position: { x: 0, y: 0, z: 30 } })];
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  if (startActive) {
    state.turnState.activeUnitId = 'h1';
    squad.isActivated = true;
  }
  return state;
}

function moveAction(positions: Vector3[], paths?: Vector3[][], type: 'advance' | 'rush' = 'advance') {
  const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
  const cz = positions.reduce((s, p) => s + p.z, 0) / positions.length;
  return createAction(HOST, type, {
    type,
    unitId: 'h1',
    path: [{ x: 0.5, y: 0, z: 0.5 }, { x: cx, y: 0, z: cz }],
    finalPosition: { x: cx, y: 0, z: cz },
    modelPositions: positions,
    ...(paths ? { modelPaths: paths } : {}),
  });
}

const starts: Vector3[] = [
  { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 },
];

describe('squad move with unmoved models', () => {
  it('accepts a 4-model move where two models stay put with a one-point path', () => {
    const state = squadState();
    const positions = [{ x: 0, y: 0, z: 2 }, { x: 1, y: 0, z: 2 }, starts[2], starts[3]];
    const paths = [[starts[0], positions[0]], [starts[1], positions[1]], [starts[2]], [starts[3]]];
    const action = moveAction(positions, paths);
    expect(validateAction(state, action).valid).toBe(true);
    const out = applyAction(state, action);
    expect(out.ok).toBe(true);
    const unit = out.state!.units.find((u) => u.id === 'h1')!;
    expect(unit.models[2].position).toEqual(starts[2]);
    expect(unit.models[0].position).toEqual(positions[0]);
    expect(unit.hasMoved).toBe(true);
  });

  it('accepts unmoved models with a [start, start] path', () => {
    const state = squadState();
    const positions = [{ x: 0, y: 0, z: 2 }, { x: 1, y: 0, z: 2 }, starts[2], starts[3]];
    const paths = [[starts[0], positions[0]], [starts[1], positions[1]], [starts[2], starts[2]], [starts[3], starts[3]]];
    expect(validateAction(state, moveAction(positions, paths)).valid).toBe(true);
  });

  it('accepts unmoved models when modelPaths is omitted entirely', () => {
    const state = squadState();
    const positions = [{ x: 0, y: 0, z: 2 }, starts[1], starts[2], starts[3]];
    expect(validateAction(state, moveAction(positions)).valid).toBe(true);
  });

  it('charges 0 inches for unmoved models: a full-speed mover still fits the allowance', () => {
    const state = squadState();
    const positions = [{ x: 0, y: 0, z: 6 }, { x: 1, y: 0, z: 6 }, { x: 0, y: 0, z: 7 }, { x: 1, y: 0, z: 7 }];
    // All move 6" (full speed): fine. Unmoved models do not subtract anything.
    const paths = positions.map((p, i) => [starts[i], p]);
    expect(validateAction(state, moveAction(positions, paths)).valid).toBe(true);
  });

  it('rejects the same shape when the result breaks coherency', () => {
    const state = squadState();
    const positions = [{ x: 0, y: 0, z: 5 }, starts[1], starts[2], starts[3]];
    const paths = [[starts[0], positions[0]], [starts[1]], [starts[2]], [starts[3]]];
    const res = validateAction(state, moveAction(positions, paths));
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/coheren|1"|6"/i);
  });

  it('still rejects a moved model that lands on an unmoved mate', () => {
    const state = squadState();
    const positions = [{ x: 1, y: 0, z: 1.2 }, starts[1], starts[2], starts[3]];
    const res = validateAction(state, moveAction(positions, [[starts[0], positions[0]], [starts[1]], [starts[2]], [starts[3]]]));
    expect(res.valid).toBe(false);
  });

  it('a rush with unmoved models still counts as a rush', () => {
    const state = squadState();
    const positions = [{ x: 0, y: 0, z: 2 }, { x: 1, y: 0, z: 2 }, starts[2], starts[3]];
    const action = moveAction(positions, [
      [starts[0], positions[0]], [starts[1], positions[1]], [starts[2]], [starts[3]],
    ], 'rush');
    const out = applyAction(state, action);
    expect(out.ok).toBe(true);
    expect(out.state!.units.find((u) => u.id === 'h1')!.isRushing).toBe(true);
  });
});

describe('squad out of coherency at the start of its activation', () => {
  function incoherent(active: boolean): GameState {
    const state = squadState(active);
    state.units[0].models = [mk('m1', 0, 0), mk('m2', 1, 0), mk('m3', 0, 1), mk('m4', 5, 5)];
    return state;
  }

  it('cannot Hold before activating', () => {
    const res = validateAction(incoherent(false), createAction(HOST, 'hold', { type: 'hold', unitId: 'h1' }));
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/coheren/i);
  });

  it('cannot Hold once activated', () => {
    const res = validateAction(incoherent(true), createAction(HOST, 'hold', { type: 'hold', unitId: 'h1' }));
    expect(res.valid).toBe(false);
  });

  it('cannot end its activation without moving', () => {
    const res = validateAction(incoherent(true), createAction(HOST, 'end-activation', { type: 'end-activation' }));
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/coheren/i);
  });

  it('can Advance back into coherency and then end its activation', () => {
    const state = incoherent(true);
    const paths = [[starts[0]], [starts[1]], [starts[2]], [{ x: 5, y: 0, z: 5 }, starts[3]]];
    const out = applyAction(state, moveAction(starts, paths));
    expect(out.ok).toBe(true);
    const end = createAction(HOST, 'end-activation', { type: 'end-activation' });
    expect(validateAction(out.state!, end).valid).toBe(true);
  });

  it('a coherent squad can still Hold', () => {
    const state = squadState(false);
    expect(validateAction(state, createAction(HOST, 'hold', { type: 'hold', unitId: 'h1' })).valid).toBe(true);
  });

  it('a lone survivor is always coherent and can Hold', () => {
    const state = incoherent(false);
    state.units[0].models.forEach((m, i) => {
      if (i > 0) m.isDestroyed = true;
    });
    expect(validateAction(state, createAction(HOST, 'hold', { type: 'hold', unitId: 'h1' })).valid).toBe(true);
  });
});
