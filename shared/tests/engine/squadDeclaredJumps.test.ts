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

/** After a fall of 2" or more every other living model stands on the floor below within 1" (edge to edge) of the faller. */
function expectGatheredAtBottom(models: any[], fallenIndex: number): void {
  const anchor = models[fallenIndex].position;
  models.forEach((m, i) => {
    if (i === fallenIndex || m.isDestroyed) return;
    expect(m.position.y).toBeLessThan(0.3);
    expect(Math.hypot(m.position.x - anchor.x, m.position.z - anchor.z)).toBeLessThanOrEqual(2.0 + 1e-6);
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

  it('requests ONE jump roll for the squad (untagged, one die per started inch of the 3.1" hop) plus the faller\'s fall dice', () => {
    const state = makeState(makeSquad());
    const specs = getDiceSpecs(state, squadMove(state.units[0]))!;
    expect(specs.map((s) => s.purpose)).toEqual(['jump', 'fall', 'morale']);
    expect(specs[0].count).toBe(4);
    expect(specs[1].count).toBe(3); // a failed jump falls 3" from the take-off
  });

  it('a passed jump places every model and the activation continues', () => {
    const state = makeState(makeSquad());
    const out = applyAction(state, squadMove(state.units[0]), [roll('jump', [3, 4, 6, 2]), roll('fall', [1, 1, 1])]);
    if (!out.ok) throw new Error(out.reason);
    const u = out.state.units[0];
    expect(u.models.every((m) => !m.isDestroyed)).toBe(true);
    expect(u.models[1].position).toMatchObject(landing);
    expect(out.state.turnState.activeUnitId).toBe('u');
    const entry = out.state.actionLog[out.state.actionLog.length - 1];
    const events = entry.dice!.outcome.traversal!;
    expect(events).toHaveLength(1); // one jump roll for the unit, no fall
    expect(events[0]).toMatchObject({ type: 'gap-jump', passed: true, rolls: [3, 4, 6, 2] });
    expect(entry.dice!.results.map((r) => r.purpose)).toContain('jump');
  });

  it('one die under 2 fails the whole jump', () => {
    const state = makeState(makeSquad());
    const out = applyAction(state, squadMove(state.units[0]), [roll('jump', [6, 6, 6, 1]), roll('fall', [4, 5, 6])]);
    if (!out.ok) throw new Error(out.reason);
    expect(out.state.turnState.activeUnitId).not.toBe('u');
  });

  it('a failed jump: the jumper falls from its take-off to the floor below; a fall wound makes it the casualty, and the activation ends', () => {
    const state = makeState(makeSquad());
    const out = applyAction(state, squadMove(state.units[0]), [roll('jump', [1, 4, 6, 6]), roll('fall', [1, 6, 6])]);
    if (!out.ok) throw new Error(out.reason);
    const u = out.state.units[0];
    expect(u.models.map((m) => m.isDestroyed)).toEqual([false, true, false]);
    expect(u.models[1].position!.y).toBe(0); // it fell to the floor below
    expect(Math.hypot(u.models[1].position!.x - takeoff.x, u.models[1].position!.z - takeoff.z)).toBeLessThanOrEqual(2);
    expect(u.wounds).toBe(2);
    expect(out.state.turnState.activeUnitId).not.toBe('u');
  });

  it('a failed jump whose fall dice are all 4+ costs no model, but the faller still lands below and the activation ends', () => {
    const state = makeState(makeSquad());
    const out = applyAction(state, squadMove(state.units[0]), [roll('jump', [1, 4, 6, 6]), roll('fall', [4, 5, 6])]);
    if (!out.ok) throw new Error(out.reason);
    const u = out.state.units[0];
    expect(u.models.map((m) => m.isDestroyed)).toEqual([false, false, false]);
    expect(u.models[1].position!.y).toBe(0);
    expect(out.state.turnState.activeUnitId).not.toBe('u');
  });

  it('a failed rush jump behaves the same way', () => {
    const state = makeState(makeSquad());
    const out = applyAction(state, squadMove(state.units[0], 'rush'), [roll('jump', [1, 1, 1, 1]), roll('fall', [1, 6, 6])]);
    if (!out.ok) throw new Error(out.reason);
    expect(out.state.units[0].models[1].isDestroyed).toBe(true);
    expect(out.state.turnState.activeUnitId).not.toBe('u');
  });

  it('the last remaining model falls normally: its Tough wounds drop instead of it being removed', () => {
    const unit = makeSquad(3);
    unit.models[0].isDestroyed = true;
    unit.models[2].isDestroyed = true;
    unit.models[1].wounds = 2; // a Tough(2) model: one fall wound does not kill it
    unit.models[1].maxWounds = 2;
    unit.wounds = 2;
    unit.position = { ...takeoff };
    const state = makeState(unit);
    const action = squadMove(state.units[0]);
    expect(getDiceSpecs(state, action)!.map((s) => s.purpose)).toEqual(['jump', 'fall', 'morale']);
    const out = applyAction(state, action, [roll('jump', [1, 1, 1, 1]), roll('fall', [1, 6, 6])]);
    if (!out.ok) throw new Error(out.reason);
    const u = out.state.units[0];
    expect(u.models[1].isDestroyed).toBe(false);
    expect(u.position.y).toBe(0);
    expect(u.models[1].wounds).toBe(1);
    expect(out.state.turnState.activeUnitId).not.toBe('u');
  });

  // Two models jump from the same edge: model 2's hop (3.6") is longer than model 1's (3.1")
  const takeoff2 = P(-0.1, 3, 0.9);
  const landing2 = P(3.0, 3, -1.0);
  function twoJumpers() {
    const unit = makeSquad(3);
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
    return { state, action };
  }

  it('two jumpers share one roll sized by the leader; on a failure the leader falls and the other stays at its take-off', () => {
    const { state, action } = twoJumpers();
    expect(validateAction(state, action)).toEqual({ valid: true });
    const specs = getDiceSpecs(state, action)!;
    expect(specs.map((s) => s.purpose)).toEqual(['jump', 'fall', 'morale']);
    expect(specs[0].count).toBe(4); // the leader's 3.1" hop: ceil(3.05)
    const out = applyAction(state, action, [roll('jump', [1, 1, 1, 1]), roll('fall', [1, 6, 6])]);
    if (!out.ok) throw new Error(out.reason);
    const u = out.state.units[0];
    expect(u.models.map((m) => m.isDestroyed)).toEqual([false, true, false]); // model 2 (the leader, the lowest-index jumper) fell
    expectGatheredAtBottom(u.models, 1); // the other jumper is brought down to the faller
    expect(out.state.turnState.activeUnitId).not.toBe('u');
  });

  it('an explicit jumpLeader sizes the roll and falls, even when another hop is longer', () => {
    const { state, action } = twoJumpers();
    (action.payload as any).jumpLeader = 2; // the 3.6" hop
    expect(validateAction(state, action)).toEqual({ valid: true });
    expect(getDiceSpecs(state, action)![0].count).toBe(4); // 3.63": ceil(3.58)
    const out = applyAction(state, action, [roll('jump', [1, 1, 1, 1]), roll('fall', [1, 6, 6])]);
    if (!out.ok) throw new Error(out.reason);
    const u = out.state.units[0];
    expect(u.models.map((m) => m.isDestroyed)).toEqual([false, false, true]);
    expectGatheredAtBottom(u.models, 2);
  });

  it('the dice follow the leader, not the longest follower hop', () => {
    const { state, action } = twoJumpers();
    // model 3 lands far away (a 5.5" hop = 6 dice); the leader's 3.1" hop still sizes the roll
    const far = P(4.4, 3, 1.5);
    (action.payload as any).modelPositions[2] = far;
    (action.payload as any).modelPaths[2] = [takeoff2, far];
    (action.payload as any).modelTraversals[2] = { kind: 'jump-gap', takeoff: takeoff2, landing: far };
    expect(getDiceSpecs(state, action)![0].count).toBe(4);
    (action.payload as any).jumpLeader = 2;
    expect(getDiceSpecs(state, action)![0].count).toBeGreaterThan(4);
  });

  it('rejects a jump leader that does not declare a jump', () => {
    const { state, action } = twoJumpers();
    (action.payload as any).jumpLeader = 0;
    const res = validateAction(state, action);
    expect(res.valid).toBe(false);
    expect((res as { reason: string }).reason).toMatch(/jump leader/);
  });

  it('with equal hops the lowest living-model index (the default leader) falls', () => {
    const unit = makeSquad(3);
    const t0 = P(-0.1, 3, 0.9);
    const t1 = takeoff2;
    // models 1 and 2 both hop 3.1" straight across (same length)
    unit.models[1].position = P(-0.1, 3, 0.9);
    unit.models[2].position = P(-0.1, 3, -0.9);
    unit.models[0].position = P(2.0, 3, 0);
    unit.position = { ...unit.models[0].position! };
    const state = makeState(unit);
    const l1 = P(3.0, 3, 0.9);
    const l2 = P(3.0, 3, -0.9);
    const action = createAction(HOST, 'advance', {
      type: 'advance',
      unitId: 'u',
      path: [unit.position, unit.position],
      finalPosition: unit.position,
      modelPositions: [unit.models[0].position, l1, l2],
      modelPaths: [[unit.models[0].position, unit.models[0].position], [t0, l1], [P(-0.1, 3, -0.9), l2]],
      modelTraversals: [null, { kind: 'jump-gap', takeoff: t0, landing: l1 }, { kind: 'jump-gap', takeoff: P(-0.1, 3, -0.9), landing: l2 }],
    });
    void t1;
    expect(validateAction(state, action)).toEqual({ valid: true });
    const out = applyAction(state, action, [roll('jump', [1, 1, 1, 1]), roll('fall', [1, 6, 6])]);
    if (!out.ok) throw new Error(out.reason);
    expect(out.state.units[0].models.map((m) => m.isDestroyed)).toEqual([false, true, false]);
    expectGatheredAtBottom(out.state.units[0].models, 1);
  });

  it('both jumpers pass on one roll: both cross and the activation continues', () => {
    const { state, action } = twoJumpers();
    const out = applyAction(state, action, [roll('jump', [6, 6, 6, 2]), roll('fall', [1, 1, 1])]);
    if (!out.ok) throw new Error(out.reason);
    const u = out.state.units[0];
    expect(u.models[1].position).toMatchObject(landing);
    expect(u.models[2].position).toMatchObject(landing2);
    expect(u.models.every((m) => !m.isDestroyed)).toBe(true);
    expect(out.state.turnState.activeUnitId).toBe('u');
  });

  it('a plain fall over 6" in a squad hurts the falling model (no jump roll), not the first one', () => {
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
    const specs = getDiceSpecs(state, action)!;
    expect(specs.some((d) => d.purpose === 'jump')).toBe(false);
    expect(specs.find((d) => d.purpose === 'fall')?.count).toBe(8);
    const out = applyAction(state, action, [roll('fall', [1, 6, 6, 6, 6, 6, 6, 6])]);
    if (!out.ok) throw new Error(out.reason);
    expect(out.state.units[0].models.map((x) => x.isDestroyed)).toEqual([false, true, false]);
  });

  describe('a failed jump stops the other declared jumpers', () => {
    const takeoff3 = takeoff2;
    const landing3 = landing2;

    // A 4-model squad: models 1 and 2 jump (2 has the longer hop), models 0 and 3 walk
    function fourModel(): { state: GameState; action: ReturnType<typeof createAction> } {
      const unit = makeSquad(3);
      unit.models.push({ id: 'u-m3', wounds: 1, maxWounds: 1, isDestroyed: false, position: P(4.2, 3, 0) } as any);
      unit.wounds = 4;
      unit.maxWounds = 4;
      unit.models[0].position = P(3.0, 3, 1.0);
      unit.models[1].position = { ...takeoff };
      unit.models[2].position = { ...takeoff3 };
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
        modelPositions: [m[0].position, landing, landing3, walkEnd],
        modelPaths: [
          [m[0].position, m[0].position],
          [takeoff, landing],
          [takeoff3, landing3],
          [m[3].position, walkEnd],
        ],
        modelTraversals: [null, traversal, { kind: 'jump-gap', takeoff: takeoff3, landing: landing3 }, null],
        jumpLeader: 2, // model 3 is the one the player declared the jump with
      });
      return { state, action };
    }

    it('asks for one jump roll and one set of fall dice, however many jumpers', () => {
      const { state, action } = fourModel();
      expect(validateAction(state, action)).toEqual({ valid: true });
      expect(getDiceSpecs(state, action)!.map((s) => s.purpose)).toEqual(['jump', 'fall', 'morale']);
    });

    it('the leader falls, everyone else is brought down to it, the log says why', () => {
      const { state, action } = fourModel();
      const out = applyAction(state, action, [roll('jump', [1, 1, 1, 1]), roll('fall', [1, 6, 6])]);
      if (!out.ok) throw new Error(out.reason);
      const u = out.state.units[0];
      expect(u.models.map((m) => m.isDestroyed)).toEqual([false, false, true, false]);
      expectGatheredAtBottom(u.models, 2);
      expect(out.state.turnState.activeUnitId).not.toBe('u');
      const entry = out.state.actionLog[out.state.actionLog.length - 1];
      const texts = entry.dice!.outcome.traversal!.map((e) => e.text);
      expect(texts).toContain('Model 2: jump not attempted (activation ended)');
      expect(entry.dice!.results.map((r) => r.purpose)).toEqual(expect.arrayContaining(['jump', 'fall']));
    });

    it('a stopped jumper is tallied only up to its take-off spot', () => {
      const { state, action } = fourModel();
      // model 2 (the stopped one) walks 1.0" along deck A to reach its edge, then would jump
      const m = state.units[0].models;
      m[1].position = P(-1.1, 3, 0);
      (action.payload as any).modelPaths[1] = [P(-1.1, 3, 0), takeoff, landing];
      expect(validateAction(state, action)).toEqual({ valid: true });
      const out = applyAction(state, action, [roll('jump', [1, 1, 1, 1]), roll('fall', [1, 6, 6])]);
      if (!out.ok) throw new Error(out.reason);
      const u = out.state.units[0];
      expectGatheredAtBottom(u.models, 2);
      expect(u.modelMovementSpent!['u-m1']).toBeCloseTo(1.0, 1);
    });

    it('both pass: nothing is stopped', () => {
      const { state, action } = fourModel();
      const out = applyAction(state, action, [roll('jump', [6, 6, 6, 6]), roll('fall', [6, 6, 6])]);
      if (!out.ok) throw new Error(out.reason);
      const u = out.state.units[0];
      expect(u.models[2].position).toMatchObject(landing3);
      expect(u.models[1].position).toMatchObject(landing);
      expect(out.state.turnState.activeUnitId).toBe('u');
    });

    it('a failed rush jump stops the other jumpers the same way', () => {
      const { state, action } = fourModel();
      const rush = createAction(HOST, 'rush', { ...(action.payload as object), type: 'rush' });
      const out = applyAction(state, rush, [roll('jump', [1, 1, 1, 1]), roll('fall', [1, 6, 6])]);
      if (!out.ok) throw new Error(out.reason);
      expectGatheredAtBottom(out.state.units[0].models, 2);
    });

    it('a failed jump in a charge leg also stops the other jumper', () => {
      const unit = makeSquad(3);
      unit.models[0].position = P(3.0, 3, 1.0);
      unit.models[2].position = { ...takeoff3 };
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
        modelPositions: [P(3.6, 3, 1.0), landing, landing3],
        modelPaths: [
          [m[0].position, P(3.6, 3, 1.0)],
          [takeoff, landing],
          [takeoff3, landing3],
        ],
        modelTraversals: [null, traversal, { kind: 'jump-gap', takeoff: takeoff3, landing: landing3 }],
        jumpLeader: 2,
      });
      const v = validateAction(state, leg);
      if (!v.valid) throw new Error((v as { reason: string }).reason);
      const specs = getDiceSpecs(state, leg)!;
      expect(specs.map((s) => s.purpose)).toEqual(['jump', 'fall', 'morale']);
      const out = applyAction(state, leg, [roll('jump', [1, 1, 1, 1]), roll('fall', [4, 4, 4])]);
      if (!out.ok) throw new Error(out.reason);
      expectGatheredAtBottom(out.state.units[0].models, 2);
      expect(out.state.turnState.activeUnitId).not.toBe('u');
    });
  });
});
