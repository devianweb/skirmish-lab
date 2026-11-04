import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function piece(id: string, terrainType: string, pos: Vector3): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG[terrainType];
  return {
    id,
    terrainType,
    position: pos,
    rotation: { x: 0, y: 0, z: 0 },
    scale: { ...meta.defaultScale },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
    isWalkable: true,
  } as TerrainPiece;
}

// Deck A spans x -4..0 and deck B x 1.5..5.5, both 3" high: a 1.5" gap. Model 1 hops it; models 0 and 2 stay.
const deckA = piece('deck-a', 'platform-small', P(-2, 0, 0));
const deckB = piece('deck-b', 'platform-small', P(3.5, 0, 0));
const takeoff = P(-0.1, 3, 0);
const landing = P(3.0, 3, 0);

function makeSquad(count = 3): Unit {
  const starts = [P(2.0, 3, 0.9), takeoff, P(2.0, 3, -0.9)].slice(0, count);
  return {
    id: 'u',
    ownerId: HOST,
    armyId: 'army-1',
    unitType: 'trooper',
    name: 'u',
    quality: 4,
    defense: 5,
    speed: 6,
    position: { ...starts[0] },
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    wounds: count,
    maxWounds: count,
    isActivated: true,
    isDestroyed: false,
    models: starts.map((p, i) => ({
      id: `u-m${i}`,
      wounds: 1,
      maxWounds: 1,
      isDestroyed: false,
      position: { ...p },
    })) as any,
    weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }],
    specialRules: [],
    hasMoved: false,
    remainingMovement: 6,
  };
}

function makeState(unit: Unit): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = [unit];
  state.terrain = [deckA, deckB];
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = unit.id;
  return state;
}

const roll = (purpose: string, rolls: number[]): DiceResult => ({
  rolls,
  total: rolls.reduce((a, b) => a + b, 0),
  finalTotal: rolls.reduce((a, b) => a + b, 0),
  purpose,
});

const traversal = { kind: 'jump-gap' as const, takeoff, landing };

function squadMove(unit: Unit, type: 'move-unit' | 'rush' = 'move-unit', declare = true) {
  const alive = unit.models.filter((m) => !m.isDestroyed);
  const jumperIdx = alive.findIndex((m) => m.position!.x === takeoff.x);
  const modelPositions = alive.map((m, i) => (i === jumperIdx ? landing : { ...m.position! }));
  const modelPaths = alive.map((m, i) => (i === jumperIdx ? [takeoff, landing] : [m.position!, m.position!]));
  const modelTraversals = alive.map((_, i) => (i === jumperIdx && declare ? traversal : null));
  return createAction(HOST, type, {
    type,
    unitId: 'u',
    path: [unit.position, modelPositions[0]],
    finalPosition: modelPositions[0],
    modelPositions,
    modelPaths,
    modelTraversals,
  });
}

describe('squad declared jumps', () => {
  it('validates a squad where one model declares a jump', () => {
    const state = makeState(makeSquad());
    expect(validateAction(state, squadMove(state.units[0]))).toEqual({ valid: true });
  });

  it('still rejects a squad model whose path needs a jump that was not declared', () => {
    const state = makeState(makeSquad());
    const res = validateAction(state, squadMove(state.units[0], 'move-unit', false));
    expect(res.valid).toBe(false);
    expect((res as { reason: string }).reason).toMatch(/Squad model 2.*needs a jump/);
  });

  it('rejects a declared jump the path does not contain', () => {
    const state = makeState(makeSquad());
    const action = squadMove(state.units[0]);
    (action.payload as any).modelTraversals = [traversal, traversal, null];
    const res = validateAction(state, action);
    expect(res.valid).toBe(false);
    expect((res as { reason: string }).reason).toMatch(/Squad model 1/);
  });

  it('rejects a declaration whose take-off is not at a floor edge', () => {
    const state = makeState(makeSquad());
    const action = squadMove(state.units[0]);
    const from = P(-2.5, 3, 0);
    state.units[0].models[1].position = from;
    (action.payload as any).modelPaths[1] = [from, landing];
    (action.payload as any).modelTraversals[1] = { kind: 'jump-gap', takeoff: from, landing };
    expect(validateAction(state, action).valid).toBe(false);
  });

  it('rejects more declarations than models', () => {
    const state = makeState(makeSquad());
    const action = squadMove(state.units[0]);
    (action.payload as any).modelTraversals = [null, traversal, null, null];
    expect(validateAction(state, action)).toMatchObject({ valid: false });
  });

  it('requests dice only for the jumping model, tagged with its index', () => {
    const state = makeState(makeSquad());
    // 3 models, 1 jumper: it is simply lost on a fall, so no falling dice
    const specs = getDiceSpecs(state, squadMove(state.units[0]))!;
    expect(specs.map((s) => s.purpose)).toEqual(['m1_gap_jump']);
    expect(specs[0].count).toBe(2); // a 3.1" hop from spot to spot: one die per full 3" plus one
  });

  it('a passed jump places every model and the activation continues', () => {
    const state = makeState(makeSquad());
    const out = applyAction(state, squadMove(state.units[0]), [roll('m1_gap_jump', [3, 4, 6])]);
    if (!out.ok) throw new Error(out.reason);
    const u = out.state.units[0];
    expect(u.models.every((m) => !m.isDestroyed)).toBe(true);
    expect(u.models[1].position).toMatchObject(landing);
    expect(out.state.turnState.activeUnitId).toBe('u');
    const entry = out.state.actionLog[out.state.actionLog.length - 1];
    const events = entry.dice!.outcome.traversal!;
    expect(events[0]).toMatchObject({ type: 'gap-jump', passed: true });
    expect(events[0].text).toMatch(/^Model 2:/);
    expect(entry.dice!.results.map((r) => r.purpose)).toContain('m1_gap_jump');
  });

  it('a failed jump removes only that model and ends the activation', () => {
    const state = makeState(makeSquad());
    const out = applyAction(state, squadMove(state.units[0]), [roll('m1_gap_jump', [1, 4, 6])]);
    if (!out.ok) throw new Error(out.reason);
    const u = out.state.units[0];
    expect(u.models.map((m) => m.isDestroyed)).toEqual([false, true, false]);
    expect(u.models[1].position!.y).toBe(0); // it fell to the floor below
    expect(u.wounds).toBe(2);
    expect(out.state.turnState.activeUnitId).not.toBe('u');
  });

  it('a failed rush jump behaves the same way', () => {
    const state = makeState(makeSquad());
    const out = applyAction(state, squadMove(state.units[0], 'rush'), [roll('m1_gap_jump', [1, 1, 1])]);
    if (!out.ok) throw new Error(out.reason);
    expect(out.state.units[0].models[1].isDestroyed).toBe(true);
    expect(out.state.turnState.activeUnitId).not.toBe('u');
  });

  it('the last remaining model falls normally instead of being removed', () => {
    const unit = makeSquad(3);
    unit.models[0].isDestroyed = true;
    unit.models[2].isDestroyed = true;
    unit.wounds = 1;
    unit.position = { ...takeoff };
    const state = makeState(unit);
    const action = squadMove(state.units[0]);
    expect(getDiceSpecs(state, action)!.map((s) => s.purpose)).toEqual(['m0_gap_jump', 'm0_falling_defense', 'm0_trauma']);
    const out = applyAction(state, action, [
      roll('m0_gap_jump', [1, 1, 1]),
      roll('m0_falling_defense', [1]),
      roll('m0_trauma', [1]),
    ]);
    if (!out.ok) throw new Error(out.reason);
    const u = out.state.units[0];
    expect(u.models[1].isDestroyed).toBe(false);
    expect(u.position.y).toBe(0);
    expect(u.traumaTokens).toBe(1);
    expect(out.state.turnState.activeUnitId).not.toBe('u');
  });

  it('two jumping models roll in model order; one fails and the other keeps its own result', () => {
    const unit = makeSquad(3);
    const takeoff2 = P(-0.1, 3, 0.9);
    const landing2 = P(3.0, 3, -1.0);
    unit.models[2].position = { ...takeoff2 };
    unit.models[0].position = P(3.0, 3, 1.0);
    unit.position = { ...unit.models[0].position! };
    const state = makeState(unit);
    const action = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'u',
      path: [unit.position, unit.position],
      finalPosition: unit.position,
      modelPositions: [unit.models[0].position, landing, landing2],
      modelPaths: [
        [unit.models[0].position, unit.models[0].position],
        [takeoff, landing],
        [takeoff2, landing2],
      ],
      modelTraversals: [null, traversal, { kind: 'jump-gap', takeoff: takeoff2, landing: landing2 }],
    });
    expect(validateAction(state, action)).toEqual({ valid: true });
    expect(getDiceSpecs(state, action)!.map((s) => s.purpose)).toEqual(['m1_gap_jump', 'm2_gap_jump']);
    const out = applyAction(state, action, [roll('m1_gap_jump', [1, 1, 1]), roll('m2_gap_jump', [6, 6, 6])]);
    if (!out.ok) throw new Error(out.reason);
    const u = out.state.units[0];
    expect(u.models.map((m) => m.isDestroyed)).toEqual([false, true, false]);
    expect(u.models[2].position).toMatchObject(landing2);
    expect(out.state.turnState.activeUnitId).not.toBe('u');
  });

  it('a plain fall over 6" in a squad removes the falling model, not the first one', () => {
    const tall = piece('tall', 'platform-small', P(-2, 0, 0));
    tall.scale = { ...tall.scale, y: 8 };
    const unit = makeSquad(3);
    const from = P(-0.1, 8, 0);
    const to = P(1.5, 0, 0);
    unit.models[0].position = P(-0.6, 8, 0.9);
    unit.models[2].position = P(-0.6, 8, -0.9);
    unit.models[1].position = { ...from };
    unit.position = { ...from };
    const state = makeState(unit);
    state.terrain = [tall];
    const m = unit.models;
    const action = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'u',
      path: [from, to],
      finalPosition: to,
      modelPositions: [m[0].position, to, m[2].position],
      modelPaths: [
        [m[0].position, m[0].position],
        [from, to],
        [m[2].position, m[2].position],
      ],
      modelTraversals: [null, { kind: 'fall', takeoff: from, landing: to }, null],
    });
    expect(validateAction(state, action)).toEqual({ valid: true });
    const out = applyAction(state, action, []);
    if (!out.ok) throw new Error(out.reason);
    expect(out.state.units[0].models.map((x) => x.isDestroyed)).toEqual([false, true, false]);
  });
});
