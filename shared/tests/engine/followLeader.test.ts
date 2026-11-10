import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';
import { DeclaredTraversal, findJumpOption } from '../../src/engine/traversal';
import { planFollowerCrossing, FollowerPlan } from '../../src/engine/followLeader';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function piece(id: string, terrainType: string, pos: Vector3, scaleY?: number, scaleZ?: number): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG[terrainType];
  return {
    id,
    terrainType,
    position: pos,
    rotation: { x: 0, y: 0, z: 0 },
    scale: { ...meta.defaultScale, ...(scaleY ? { y: scaleY } : {}), ...(scaleZ ? { z: scaleZ } : {}) },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
    isWalkable: true,
  } as TerrainPiece;
}

// Deck A spans x -4..0, deck B x 1.5..5.5 (both 3" high): a 1.5" gap, 2.6" hop between the edge spots.
// (8" deep so a whole squad fits along the edge)
const deckA = piece('deck-a', 'platform-small', P(-2, 0, 0), undefined, 8);
const deckB = piece('deck-b', 'platform-small', P(3.5, 0, 0), undefined, 8);
const leaderTakeoff = P(-0.55, 3, 0);
const leaderLanding = P(2.05, 3, 0);
const leaderJump: DeclaredTraversal = { kind: 'jump-gap', takeoff: leaderTakeoff, landing: leaderLanding };

// Only the leader (model 0) stands at the edge; the others are 1-2" back
const starts = [leaderTakeoff, P(-1.55, 3, 0.9), P(-1.55, 3, -0.9), P(-2.55, 3, 0)];

function makeSquad(rules: string[] = []): Unit {
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
    wounds: starts.length,
    maxWounds: starts.length,
    isActivated: true,
    isDestroyed: false,
    models: starts.map((p, i) => ({ id: `u-m${i}`, wounds: 1, maxWounds: 1, isDestroyed: false, position: { ...p } })) as any,
    weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }],
    specialRules: rules,
    hasMoved: false,
    remainingMovement: 6,
  };
}

function makeState(unit: Unit, terrain: TerrainPiece[] = [deckA, deckB]): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = [unit];
  state.terrain = terrain;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = unit.id;
  // keeps the round going so a failed activation does not end the game
  const bystander = makeSquad();
  bystander.id = 'bystander';
  bystander.ownerId = GUEST;
  bystander.isActivated = false;
  bystander.position = P(-20, 0, 20);
  bystander.models.forEach((m, i) => {
    m.id = `by-m${i}`;
    m.position = P(-20 + i * 1.5, 0, 20);
  });
  state.units.push(bystander);
  return state;
}

const roll = (purpose: string, rolls: number[]): DiceResult => ({
  rolls,
  total: rolls.reduce((a, b) => a + b, 0),
  finalTotal: rolls.reduce((a, b) => a + b, 0),
  purpose,
});

/** Route every follower to the leader's crossing the way the HUD does; returns the move payload parts. */
function routeSquad(state: GameState, leader: DeclaredTraversal, leaderLandingPos: Vector3, plans?: FollowerPlan[]) {
  const unit = state.units[0];
  const alive = unit.models.filter((m) => !m.isDestroyed);
  const taken: Vector3[] = [leader.takeoff, leader.landing];
  const positions: Vector3[] = [leaderLandingPos];
  const paths: Vector3[][] = [[leader.takeoff, leader.landing]];
  const traversals: (DeclaredTraversal | null)[] = [leader];
  for (let i = 1; i < alive.length; i++) {
    const plan = planFollowerCrossing(state, unit, alive[i].position!, leader, { budget: 6, taken, navOptions: { keepAway: true } });
    plans?.push(plan);
    if (plan.status !== 'route') {
      positions.push({ ...alive[i].position! });
      paths.push([alive[i].position!, alive[i].position!]);
      traversals.push(null);
      continue;
    }
    const { path, option } = plan.route;
    taken.push(option.takeoff, option.landing);
    positions.push(option.landing);
    paths.push(path);
    traversals.push({ kind: option.kind, takeoff: option.takeoff, landing: option.landing });
  }
  return { positions, paths, traversals };
}

function moveAction(type: 'advance' | 'rush', r: ReturnType<typeof routeSquad>) {
  return createAction(HOST, type, {
    type,
    unitId: 'u',
    path: [starts[0], r.positions[0]],
    finalPosition: r.positions[0],
    modelPositions: r.positions,
    modelPaths: r.paths,
    modelTraversals: r.traversals,
  });
}

describe('squad follow-the-leader jumps (14C-2 PR 4B)', () => {
  it("routes models that start back from the edge to the leader's crossing, walking only to the take-off", () => {
    const state = makeState(makeSquad());
    const plans: FollowerPlan[] = [];
    const r = routeSquad(state, leaderJump, leaderLanding, plans);
    expect(plans.every((p) => p.status === 'route')).toBe(true);
    // every follower ends on deck B, and its path walks to a spot at the edge before the hop
    for (let i = 1; i < 4; i++) {
      expect(r.positions[i].x).toBeGreaterThan(1.9);
      expect(r.traversals[i]!.takeoff.x).toBeGreaterThan(-0.7);
      expect(r.traversals[i]!.takeoff.x).toBeLessThanOrEqual(-0.5);
    }
    // all four end spots are distinct bases
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) {
        expect(Math.hypot(r.positions[i].x - r.positions[j].x, r.positions[i].z - r.positions[j].z)).toBeGreaterThanOrEqual(0.9);
      }
  });

  it('host accepts the group jump: one roll sized by the hop, one set of fall dice; all cross on a pass', () => {
    const state = makeState(makeSquad());
    const r = routeSquad(state, leaderJump, leaderLanding);
    const action = moveAction('advance', r);
    expect(validateAction(state, action)).toEqual({ valid: true });
    const specs = getDiceSpecs(state, action)!;
    expect(specs.map((s) => s.purpose)).toEqual(['jump', 'fall', 'morale']);
    expect(specs[0].count).toBe(3);
    const out = applyAction(state, action, [roll('jump', [6, 6, 2]), roll('fall', [6, 6, 6])]);
    if (!out.ok) throw new Error(out.reason);
    const u = out.state.units[0];
    u.models.forEach((m, i) => expect(m.position).toMatchObject(r.positions[i]));
    expect(out.state.turnState.activeUnitId).toBe('u');
    expect(out.state.actionLog[out.state.actionLog.length - 1].dice!.outcome.traversal).toHaveLength(1);
  });

  it("a follower's move is spent only on the walk to the edge, not on the crossing", () => {
    const state = makeState(makeSquad());
    state.units[0].modelMovementSpent = { 'u-m0': 0, 'u-m1': 0, 'u-m2': 0, 'u-m3': 0 };
    const r = routeSquad(state, leaderJump, leaderLanding);
    const out = applyAction(state, moveAction('advance', r), [roll('jump', [6, 6, 6, 6]), roll('fall', [6, 6, 6])]);
    if (!out.ok) throw new Error(out.reason);
    const spent = out.state.units[0].modelMovementSpent!;
    expect(spent['u-m0']).toBeCloseTo(0, 1);
    const walkOf3 = Math.hypot(r.traversals[3]!.takeoff.x - starts[3].x, r.traversals[3]!.takeoff.z - starts[3].z);
    expect(spent['u-m3']).toBeGreaterThan(walkOf3 - 0.2);
    expect(spent['u-m3']).toBeLessThan(walkOf3 + 0.2);
  });

  it('a failed roll: the leader falls, the followers stop at their take-off spots, the activation ends', () => {
    const state = makeState(makeSquad());
    state.units[0].modelMovementSpent = { 'u-m0': 0, 'u-m1': 0, 'u-m2': 0, 'u-m3': 0 };
    const r = routeSquad(state, leaderJump, leaderLanding);
    const out = applyAction(state, moveAction('advance', r), [roll('jump', [1, 6, 6, 6]), roll('fall', [4, 6, 6])]);
    if (!out.ok) throw new Error(out.reason);
    const u = out.state.units[0];
    const fallen = u.models.findIndex((m) => m.isDestroyed || (m.position!.y ?? 0) === 0);
    expect(fallen).toBe(0); // the leader, whatever the followers' hops measure
    u.models.forEach((m, i) => {
      if (i === fallen) return;
      expect(m.position).toMatchObject({ x: r.traversals[i]!.takeoff.x, z: r.traversals[i]!.takeoff.z });
      expect(m.position!.y).toBe(3);
    });
    expect(out.state.turnState.activeUnitId).not.toBe('u');
    const texts = out.state.actionLog[out.state.actionLog.length - 1].dice!.outcome.traversal!.map((e) => e.text);
    expect(texts.filter((t) => /jump not attempted/.test(t))).toHaveLength(3);
  });

  it('rush legs follow the leader the same way', () => {
    const state = makeState(makeSquad());
    const r = routeSquad(state, leaderJump, leaderLanding);
    const action = moveAction('rush', r);
    expect(validateAction(state, action)).toEqual({ valid: true });
    const out = applyAction(state, action, [roll('jump', [6, 6, 6, 6]), roll('fall', [6, 6, 6])]);
    if (!out.ok) throw new Error(out.reason);
    expect(out.state.units[0].models.every((m) => m.position!.x > 1.9)).toBe(true);
  });

  it('a charge leg carries the followers across too', () => {
    const state = makeState(makeSquad());
    const foe = makeSquad();
    foe.id = 'foe';
    foe.ownerId = GUEST;
    foe.models.forEach((m, i) => {
      m.id = `foe-m${i}`;
      m.position = P(5.0, 3, -1.5 + i * 1.0);
    });
    foe.position = P(5.0, 3, 0);
    state.units.push(foe);
    state.turnState.charge = { unitId: 'u', targetId: 'foe', legs: 0 };
    state.units[0].remainingMovement = 12;
    const r = routeSquad(state, leaderJump, leaderLanding);
    const leg = createAction(HOST, 'charge-leg', {
      type: 'charge-leg',
      attackerId: 'u',
      path: [starts[0], r.positions[0]],
      modelPositions: r.positions,
      modelPaths: r.paths,
      modelTraversals: r.traversals,
    });
    const check = validateAction(state, leg);
    if (!check.valid) throw new Error(check.reason);
    expect(getDiceSpecs(state, leg)!.map((s) => s.purpose).slice(0, 2)).toEqual(['jump', 'fall']);
    const pass = applyAction(state, leg, [roll('jump', [6, 6, 6, 6]), roll('fall', [6, 6, 6])]);
    if (!pass.ok) throw new Error(pass.reason);
    expect(pass.state.units[0].models.every((m) => m.position!.x > 1.9)).toBe(true);
    const fail = applyAction(state, leg, [roll('jump', [1, 1, 1, 1]), roll('fall', [6, 6, 6])]);
    if (!fail.ok) throw new Error(fail.reason);
    expect(fail.state.turnState.activeUnitId).not.toBe('u');
  });

  it('a drop of 3" to 6" is a group jump: the dice follow the hop and the followers drop with the leader', () => {
    const tall = piece('tall', 'platform-small', P(-2, 0, 0), 4, 8);
    const state = makeState(makeSquad(), [tall]);
    const unit = state.units[0];
    const at: Array<[number, number, number]> = [[-0.55, 4, 0], [-1.55, 4, 0.9], [-1.55, 4, -0.9], [-2.55, 4, 0]];
    unit.models.forEach((m, i) => (m.position = P(...at[i])));
    const edge = P(-0.55, 4, 0);
    unit.position = { ...edge };
    const opt = findJumpOption(state, unit, edge, P(0.55, 0, 0))!;
    expect(opt.kind).toBe('jump-drop');
    const leader: DeclaredTraversal = { kind: opt.kind, takeoff: opt.takeoff, landing: opt.landing };
    const r = routeSquad(state, leader, opt.landing);
    expect(r.traversals.every((t) => t && t.kind === 'jump-drop')).toBe(true);
    const action = moveAction('advance', r);
    const check = validateAction(state, action);
    if (!check.valid) throw new Error(check.reason);
    const specs = getDiceSpecs(state, action)!;
    expect(specs[0]).toMatchObject({ purpose: 'jump', count: opt.dice });
    expect(opt.dice).toBeGreaterThanOrEqual(4);
    const out = applyAction(state, action, [roll('jump', Array(opt.dice).fill(5)), roll('fall', [6, 6, 6, 6, 6])]);
    if (!out.ok) throw new Error(out.reason);
    expect(out.state.units[0].models.every((m) => m.position!.y === 0)).toBe(true);
  });

  it('Strider rolls half the dice for the group jump', () => {
    const state = makeState(makeSquad(['strider']));
    const r = routeSquad(state, leaderJump, leaderLanding);
    const action = moveAction('advance', r);
    expect(validateAction(state, action)).toEqual({ valid: true });
    expect(getDiceSpecs(state, action)![0]).toMatchObject({ purpose: 'jump', count: 2 });
  });

  it('Flying squads are never routed to a crossing and never roll', () => {
    const state = makeState(makeSquad(['flying']));
    const unit = state.units[0];
    const plan = planFollowerCrossing(state, unit, starts[1], leaderJump, { budget: 6 });
    expect(plan.status).toBe('not-needed');
    const action = createAction(HOST, 'advance', {
      type: 'advance',
      unitId: 'u',
      path: [starts[0], leaderLanding],
      finalPosition: leaderLanding,
      modelPositions: [P(2.05, 3, 0), P(2.05, 3, 1.0), P(2.05, 3, -1.0), P(2.05, 3, 2.0)],
      modelPaths: [
        [starts[0], P(2.05, 3, 0)],
        [starts[1], P(2.05, 3, 1.0)],
        [starts[2], P(2.05, 3, -1.0)],
        [starts[3], P(2.05, 3, 2.0)],
      ],
    });
    expect(validateAction(state, action)).toEqual({ valid: true });
    expect((getDiceSpecs(state, action) ?? []).some((s) => s.purpose === 'jump')).toBe(false);
  });

  describe('models that cannot reach the take-off edge', () => {
    function withTiredModel() {
      const state = makeState(makeSquad());
      // Model 4 has already walked 5.5" this action: 0.5" left, the edge is 2" away
      state.units[0].modelMovementSpent = { 'u-m0': 0, 'u-m1': 0, 'u-m2': 0, 'u-m3': 5.5 };
      return state;
    }

    it('the planner says why a model cannot make it', () => {
      const state = withTiredModel();
      const plan = planFollowerCrossing(state, state.units[0], starts[3], leaderJump, { budget: 0.5, taken: [leaderTakeoff, leaderLanding] });
      expect(plan.status).toBe('unreachable');
      expect((plan as { reason: string }).reason).toMatch(/0\.5" of move left/);
    });

    it('the host rejects the leg when that model is left behind and the squad splits, naming it', () => {
      const state = withTiredModel();
      const r = routeSquad(state, leaderJump, leaderLanding);
      r.positions[3] = { ...starts[3] };
      r.paths[3] = [starts[3], starts[3]];
      r.traversals[3] = null;
      const res = validateAction(state, moveAction('advance', r));
      expect(res.valid).toBe(false);
      expect((res as { reason: string }).reason).toMatch(/model 4 did not cross/);
    });

    it('is valid when nobody crosses and the squad stays together', () => {
      const state = makeState(makeSquad());
      const action = createAction(HOST, 'advance', {
        type: 'advance',
        unitId: 'u',
        path: [starts[0], starts[0]],
        finalPosition: starts[0],
        modelPositions: starts.map((p) => ({ ...p })),
        modelPaths: starts.map((p) => [p, p]),
      });
      expect(validateAction(state, action)).toEqual({ valid: true });
    });

    it('a model already beyond the gap needs no crossing and just moves', () => {
      const state = makeState(makeSquad());
      const plan = planFollowerCrossing(state, state.units[0], P(4.2, 3, 0), leaderJump, { budget: 6 });
      expect(plan.status).toBe('not-needed');
    });
  });

  it('rejects take-off spots so close that a failed jump would leave two models stopped on top of each other', () => {
    const state = makeState(makeSquad());
    const jump = (takeoff: Vector3, landing: Vector3): DeclaredTraversal => ({ kind: 'jump-gap', takeoff, landing });
    const t1 = P(-0.55, 3, 1.0);
    const t2 = P(-0.55, 3, -1.0);
    const l = [P(2.05, 3, 0), P(3.5, 3, 1.0), P(2.05, 3, -1.0), P(2.05, 3, -2.5)];
    const r = {
      positions: l,
      // model 2 hops the farthest (it is the one that falls); models 3 and 4 share one take-off spot
      paths: [[leaderTakeoff, l[0]], [starts[1], t1, l[1]], [starts[2], t2, l[2]], [starts[3], t2, l[3]]],
      traversals: [leaderJump, jump(t1, l[1]), jump(t2, l[2]), jump(t2, l[3])],
    };
    const res = validateAction(state, moveAction('advance', r));
    expect(res.valid).toBe(false);
    expect((res as { reason: string }).reason).toMatch(/models 3 and 4 would be on top of each other/);
  });

  it("never trusts a client route: a follower's walk longer than its allowance is refused", () => {
    const state = makeState(makeSquad());
    state.units[0].modelMovementSpent = { 'u-m0': 0, 'u-m1': 0, 'u-m2': 0, 'u-m3': 5.5 };
    const r = routeSquad(state, leaderJump, leaderLanding); // routed as if it had the full 6"
    const res = validateAction(state, moveAction('advance', r));
    expect(res.valid).toBe(false);
  });
});

describe('squad follow-the-leader: realistic layouts (playtest fix)', () => {
  /** Plan every follower for a squad standing at `layout` (model 0 is the leader, at the edge) hopping to `landing`. */
  function planAll(layout: Vector3[], landing: Vector3, budget = 6) {
    const unit = makeSquad();
    unit.models.forEach((m, i) => (m.position = { ...layout[i] }));
    unit.position = { ...layout[0] };
    const state = makeState(unit);
    const option = findJumpOption(state, unit, layout[0], landing);
    expect(option, 'the leader can declare the hop').not.toBeNull();
    const leader: DeclaredTraversal = { kind: option!.kind, takeoff: option!.takeoff, landing: option!.landing };
    const taken: Vector3[] = [leader.takeoff, leader.landing];
    const plans: FollowerPlan[] = [];
    for (let i = 1; i < layout.length; i++) {
      const plan = planFollowerCrossing(state, unit, layout[i], leader, { budget, taken, navOptions: { keepAway: true } });
      plans.push(plan);
      if (plan.status === 'route') taken.push(plan.route.option.takeoff, plan.route.option.landing);
    }
    return { plans, state, unit };
  }

  const layouts: Array<{ name: string; layout: Vector3[]; landing: Vector3 }> = [
    {
      name: 'a line parallel to the edge, straight hop',
      layout: [P(-0.55, 3, 3.4), P(-0.55, 3, 2.0), P(-0.55, 3, 0.6), P(-0.55, 3, -0.8)],
      landing: P(2.05, 3, 3.4),
    },
    {
      name: 'a line parallel to the edge, hop landing diagonally across the gap',
      layout: [P(-0.55, 3, 3.4), P(-0.55, 3, 2.0), P(-0.55, 3, 0.6), P(-0.55, 3, -0.8)],
      landing: P(2.4, 3, 1.4),
    },
    {
      name: 'a diagonal line running back from the leader at the corner',
      layout: [P(-0.55, 3, 3.45), P(-1.85, 3, 2.2), P(-3.15, 3, 1.0), P(-3.45, 3, -0.4)],
      landing: P(2.05, 3, 3.45),
    },
    {
      name: 'a diagonal line, hop landing diagonally',
      layout: [P(-0.55, 3, 3.45), P(-1.85, 3, 2.2), P(-3.15, 3, 1.0), P(-3.45, 3, -0.4)],
      landing: P(2.5, 3, 1.6),
    },
    {
      name: 'the leader at the near corner of the far deck side, line along the edge the other way',
      layout: [P(-0.55, 3, -3.45), P(-0.55, 3, -2.1), P(-0.55, 3, -0.7), P(-1.6, 3, 0.2)],
      landing: P(2.05, 3, -3.45),
    },
    {
      name: 'a tight cluster behind the leader',
      layout: [P(-0.55, 3, 0), P(-1.55, 3, 0.9), P(-1.55, 3, -0.9), P(-2.55, 3, 0)],
      landing: P(2.05, 3, 0),
    },
    {
      name: 'a cluster in the deck corner away from the edge',
      layout: [P(-0.55, 3, 3.45), P(-2.6, 3, 3.4), P(-3.45, 3, 3.45), P(-3.45, 3, 2.2)],
      landing: P(2.05, 3, 3.45),
    },
  ];

  for (const { name, layout, landing } of layouts) {
    it(`routes every follower across: ${name}`, () => {
      const { plans, unit, state } = planAll(layout, landing);
      plans.forEach((p, i) => expect(p.status, `model ${i + 2}`).toBe('route'));
      for (const p of plans) {
        if (p.status !== 'route') continue;
        // each route is a walk to a take-off spot that is itself a legal jump to the same kind of landing
        const { path, option, walkCost } = p.route;
        expect(option.kind).toBe('jump-gap');
        expect(walkCost).toBeLessThanOrEqual(6 + 0.05);
        expect(path[path.length - 1]).toEqual(option.landing);
        expect(findJumpOption(state, unit, option.takeoff, option.landing)).not.toBeNull();
      }
    });
  }

  it('says why with numbers when a model is out of move', () => {
    const { plans } = planAll(
      [P(-0.55, 3, 3.45), P(-0.55, 3, 2.1), P(-3.45, 3, -3.45), P(-3.45, 3, -2.4)],
      P(2.05, 3, 3.45),
      2
    );
    const far = plans[1];
    expect(far.status).toBe('unreachable');
    if (far.status === 'unreachable') expect(far.reason).toMatch(/\d\.\d" away and it has 2.0" of move left/);
  });
});
