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

function squadMove(unit: Unit, type: 'advance' | 'rush' = 'advance', declare = true) {
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
    const res = validateAction(state, squadMove(state.units[0], 'advance', false));
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
    expect(specs.map((s) => s.purpose)).toEqual(['m1_gap_jump', 'morale']);
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
    unit.models[1].wounds = 2; // a Tough(2) model: the fall wound does not kill it
    unit.models[1].maxWounds = 2;
    unit.wounds = 2;
    unit.position = { ...takeoff };
    const state = makeState(unit);
    const action = squadMove(state.units[0]);
    expect(getDiceSpecs(state, action)!.map((s) => s.purpose)).toEqual(['m0_gap_jump', 'm0_falling_defense', 'morale']);
    const out = applyAction(state, action, [
      roll('m0_gap_jump', [1, 1, 1]),
      roll('m0_falling_defense', [1]),
    ]);
    if (!out.ok) throw new Error(out.reason);
    const u = out.state.units[0];
    expect(u.models[1].isDestroyed).toBe(false);
    expect(u.position.y).toBe(0);
    expect(u.models[1].wounds).toBe(1);
    expect(out.state.turnState.activeUnitId).not.toBe('u');
  });

  it('two jumping models roll in model order; after the first fails the second is not attempted', () => {
    const unit = makeSquad(3);
    const takeoff2 = P(-0.1, 3, 0.9);
    const landing2 = P(3.0, 3, -1.0);
    unit.models[2].position = { ...takeoff2 };
    unit.models[0].position = P(3.0, 3, 1.0);
    unit.position = { ...unit.models[0].position! };
    const state = makeState(unit);
    const action = createAction(HOST, 'advance', {
      type: 'advance',
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
    expect(getDiceSpecs(state, action)!.map((s) => s.purpose)).toEqual(['m1_gap_jump', 'm2_gap_jump', 'morale']);
    const out = applyAction(state, action, [roll('m1_gap_jump', [1, 1, 1]), roll('m2_gap_jump', [6, 6, 6])]);
    if (!out.ok) throw new Error(out.reason);
    const u = out.state.units[0];
    expect(u.models.map((m) => m.isDestroyed)).toEqual([false, true, false]);
    expect(u.models[2].position).toMatchObject(takeoff2); // stopped at the edge, not at its landing
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
    const action = createAction(HOST, 'advance', {
      type: 'advance',
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

  describe('a failed jump stops the later jumpers', () => {
    const takeoff2 = P(-0.1, 3, 0.9);
    const landing2 = P(3.0, 3, -1.0);
    const takeoff3 = P(-0.1, 3, -0.9);
    const landing3 = P(3.0, 3, 0.0);

    // Models 0 and 3 walk; 1, 2 and 3... built as a 4-model squad: models 1 and 2 jump
    function fourModel(): { state: GameState; action: ReturnType<typeof createAction> } {
      const unit = makeSquad(3);
      unit.models.push({ id: 'u-m3', wounds: 1, maxWounds: 1, isDestroyed: false, position: P(4.2, 3, 0) } as any);
      unit.wounds = 4;
      unit.maxWounds = 4;
      unit.models[0].position = P(3.0, 3, 1.0);
      unit.models[1].position = { ...takeoff };
      unit.models[2].position = { ...takeoff2 };
      unit.models[3].position = P(4.2, 3, 0);
      unit.position = { ...unit.models[0].position! };
      // model 3 walks a short way along deck B
      const walkEnd = P(4.8, 3, 0);
      const state = makeState(unit);
      const bystander = makeSquad(1);
      bystander.id = 'bystander';
      bystander.ownerId = GUEST;
      bystander.isActivated = false;
      bystander.position = P(-20, 0, 20);
      bystander.models[0].id = 'bystander-m0';
      bystander.models[0].position = P(-20, 0, 20);
      state.units.push(bystander); // keeps the round going so the tally survives the failed activation
      state.units[0].modelMovementSpent = { 'u-m0': 0, 'u-m1': 0, 'u-m2': 0, 'u-m3': 0 };
      const m = unit.models;
      const action = createAction(HOST, 'advance', {
        type: 'advance',
        unitId: 'u',
        path: [unit.position, unit.position],
        finalPosition: unit.position,
        modelPositions: [m[0].position, landing, landing2, walkEnd],
        modelPaths: [
          [m[0].position, m[0].position],
          [takeoff, landing],
          [takeoff2, landing2],
          [m[3].position, walkEnd],
        ],
        modelTraversals: [null, traversal, { kind: 'jump-gap', takeoff: takeoff2, landing: landing2 }, null],
      });
      return { state, action };
    }

    it('keeps the dice request as it was (every jumper, in model order)', () => {
      const { state, action } = fourModel();
      expect(validateAction(state, action)).toEqual({ valid: true });
      expect(getDiceSpecs(state, action)!.map((s) => s.purpose)).toEqual(['m1_gap_jump', 'm2_gap_jump', 'morale']);
    });

    it('model 2 fails: it is lost, model 3 stays at its take-off, walkers finish, the log says why', () => {
      const { state, action } = fourModel();
      const out = applyAction(state, action, [roll('m1_gap_jump', [1, 1, 1]), roll('m2_gap_jump', [6, 6, 6])]);
      if (!out.ok) throw new Error(out.reason);
      const u = out.state.units[0];
      expect(u.models.map((m) => m.isDestroyed)).toEqual([false, true, false, false]);
      expect(u.models[2].position).toMatchObject(takeoff2);
      expect(u.models[0].position).toMatchObject({ x: 3.0, z: 1.0 });
      expect(u.models[3].position).toMatchObject({ x: 4.8, z: 0 });
      expect(out.state.turnState.activeUnitId).not.toBe('u');
      const entry = out.state.actionLog[out.state.actionLog.length - 1];
      const texts = entry.dice!.outcome.traversal!.map((e) => e.text);
      expect(texts).toContain('Model 3: jump not attempted (activation ended)');
      expect(texts.some((t) => /^Model 3: Gap jump/.test(t))).toBe(false);
      expect(entry.dice!.results.map((r) => r.purpose)).toContain('m2_gap_jump'); // roll kept on the entry
    });

    it('a stopped jumper is tallied only up to its take-off spot', () => {
      const { state, action } = fourModel();
      // model 3 walks 1.0" along deck A to reach its edge, then would jump
      const m = state.units[0].models;
      m[2].position = P(-1.1, 3, 0.9);
      (action.payload as any).modelPaths[2] = [P(-1.1, 3, 0.9), takeoff2, landing2];
      expect(validateAction(state, action)).toEqual({ valid: true });
      const out = applyAction(state, action, [roll('m1_gap_jump', [1, 1, 1]), roll('m2_gap_jump', [6, 6, 6])]);
      if (!out.ok) throw new Error(out.reason);
      const u = out.state.units[0];
      expect(u.models[2].position).toMatchObject(takeoff2);
      expect(u.modelMovementSpent!['u-m2']).toBeCloseTo(1.0, 1);
    });

    it('model 2 passes and model 3 fails: both resolve, the failure ends the activation', () => {
      const { state, action } = fourModel();
      const out = applyAction(state, action, [roll('m1_gap_jump', [6, 6, 6]), roll('m2_gap_jump', [1, 1, 1])]);
      if (!out.ok) throw new Error(out.reason);
      const u = out.state.units[0];
      expect(u.models.map((m) => m.isDestroyed)).toEqual([false, false, true, false]);
      expect(u.models[1].position).toMatchObject(landing);
      expect(u.models[3].position).toMatchObject({ x: 4.8, z: 0 });
      expect(out.state.turnState.activeUnitId).not.toBe('u');
    });

    it('both pass: nothing is stopped', () => {
      const { state, action } = fourModel();
      const out = applyAction(state, action, [roll('m1_gap_jump', [6, 6, 6]), roll('m2_gap_jump', [6, 6, 6])]);
      if (!out.ok) throw new Error(out.reason);
      const u = out.state.units[0];
      expect(u.models[2].position).toMatchObject(landing2);
      expect(out.state.turnState.activeUnitId).toBe('u');
    });

    it('a failed rush jump stops later jumpers the same way', () => {
      const { state, action } = fourModel();
      const rush = createAction(HOST, 'rush', { ...(action.payload as object), type: 'rush' });
      const out = applyAction(state, rush, [roll('m1_gap_jump', [1, 1, 1]), roll('m2_gap_jump', [6, 6, 6])]);
      if (!out.ok) throw new Error(out.reason);
      expect(out.state.units[0].models[2].position).toMatchObject(takeoff2);
    });

    it('a failed jump in a charge leg also stops the later jumper', () => {
      const unit = makeSquad(3);
      unit.models[0].position = P(3.0, 3, 1.0);
      unit.models[2].position = { ...takeoff2 };
      unit.position = { ...unit.models[0].position! };
      const foe: Unit = { ...makeSquad(1), id: 'foe', ownerId: GUEST, position: P(5.0, 3, 0) };
      foe.models = [{ id: 'foe-m0', wounds: 1, maxWounds: 1, isDestroyed: false, position: P(5.0, 3, 0) } as any];
      const state = makeState(unit);
      state.units.push(foe);
      state.turnState.charge = { unitId: 'u', targetId: 'foe', legs: 0 };
      state.units[0].remainingMovement = 12;
      const m = unit.models;
      const leg = createAction(HOST, 'charge-leg', {
        type: 'charge-leg',
        attackerId: 'u',
        path: [unit.position, unit.position],
        modelPositions: [P(3.6, 3, 1.0), landing, landing2],
        modelPaths: [
          [m[0].position, P(3.6, 3, 1.0)],
          [takeoff, landing],
          [takeoff2, landing2],
        ],
        modelTraversals: [null, traversal, { kind: 'jump-gap', takeoff: takeoff2, landing: landing2 }],
      });
      const v = validateAction(state, leg);
      if (!v.valid) throw new Error((v as { reason: string }).reason);
      const out = applyAction(state, leg, [roll('m1_gap_jump', [1, 1, 1]), roll('m2_gap_jump', [6, 6, 6])]);
      if (!out.ok) throw new Error(out.reason);
      expect(out.state.units[0].models[2].position).toMatchObject(takeoff2);
      expect(out.state.turnState.activeUnitId).not.toBe('u');
    });
  });
});
