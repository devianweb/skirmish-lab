import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, GameState, TerrainPiece, Unit, Vector3, Weapon } from '../../src/gameTypes';
import { DiceSpec } from '../../src/types';
import { WEAPONS } from '../../src/data/weapons';
import { createJumpRangeMap } from '../../src/data/builtinMaps';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';
import { recordWoundBaseline } from '../../src/engine/activation';
import { validateSquadCoherency } from '../../src/engine/spatial';
import { PUSH_AUTO_CHOICE, PUSH_CONFIRM_CHOICE, PUSH_DECLINE_CHOICE, autoPush, createPushReaction, planPush, pushAttackerFor } from '../../src/engine/push';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, z: number, y = 0): Vector3 => ({ x, y, z });

function weapon(id: keyof typeof WEAPONS): Weapon {
  return { ...WEAPONS[id], profile: { ...WEAPONS[id].profile } };
}

/** A unit of `count` one-wound models in a row from (x, z), 1" apart. */
function mkUnit(id: string, ownerId: string, x: number, z: number, count = 1, y = 0): Unit {
  const models = Array.from({ length: count }, (_, i) => ({
    id: `${id}-m${i}`,
    wounds: 1,
    maxWounds: 1,
    isDestroyed: false,
    position: P(x + i, z, y),
    rotation: { x: 0, y: 0, z: 0 },
  }));
  return {
    id,
    ownerId,
    armyId: 'a',
    unitType: 'trooper',
    name: id,
    quality: 4,
    defense: 5,
    speed: 6,
    position: P(x + (count - 1) / 2, z, y),
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    wounds: count,
    maxWounds: 1,
    isActivated: false,
    isDestroyed: false,
    models,
    weapons: [weapon('rifle')],
    specialRules: [],
    hasMoved: false,
    remainingMovement: 6,
  };
}

function mkState(units: Unit[], terrain: TerrainPiece[] = []): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.terrain = terrain;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  return state;
}

const unitOf = (state: GameState, id: string) => state.units.find((u) => u.id === id)!;
const roll = (purpose: string, rolls: number[]): DiceResult => ({
  rolls,
  total: rolls.reduce((a, b) => a + b, 0),
  finalTotal: rolls.reduce((a, b) => a + b, 0),
  purpose,
});

/** Take `n` wounds off the first models of a unit. */
function wound(unit: Unit, n: number): void {
  let left = n;
  for (const m of unit.models) {
    if (left > 0 && !m.isDestroyed) {
      m.wounds = 0;
      m.isDestroyed = true;
      left -= 1;
    }
  }
  unit.wounds = unit.models.filter((m) => !m.isDestroyed).length;
}

/** The state when `h1` ends its activation having wounded the given enemy units to half strength. */
function endOfActivation(
  units: Unit[],
  woundBy: Record<string, number>,
  terrain: TerrainPiece[] = [],
  { recordAttack = true }: { recordAttack?: boolean } = {}
): GameState {
  const state = mkState(units, terrain);
  state.turnState.activeUnitId = 'h1';
  unitOf(state, 'h1').isActivated = true;
  recordWoundBaseline(state);
  for (const [id, n] of Object.entries(woundBy)) {
    wound(unitOf(state, id), n);
    if (recordAttack && id !== 'h1' && n > 0) {
      const attacked = state.turnState.attackedFrom ?? (state.turnState.attackedFrom = {});
      attacked[id] = { shot: 10 };
    }
  }
  return state;
}

const endAction = () => createAction(HOST, 'end-activation', { type: 'end-activation' });

function endWith(state: GameState, answers: Record<string, number[]> = {}) {
  const specs = getDiceSpecs(state, endAction()) ?? [];
  const dice = specs.map((s: DiceSpec) => roll(s.purpose, answers[s.purpose] ?? Array(s.count).fill(1)));
  const out = applyAction(state, endAction(), dice);
  if (!out.ok) throw new Error(out.reason);
  return out;
}

const respondAuto = (state: GameState) =>
  createAction(HOST, 'respond-reaction', {
    type: 'respond-reaction',
    reactionId: state.turnState.pendingReaction!.id,
    choiceId: PUSH_AUTO_CHOICE,
  });

function resolve(state: GameState, action: ReturnType<typeof createAction>, answers: Record<string, number[]> = {}) {
  const specs = getDiceSpecs(state, action) ?? [];
  const dice = specs.map((s: DiceSpec) => roll(s.purpose, answers[s.purpose] ?? Array(s.count).fill(6)));
  const out = applyAction(state, action, dice);
  if (!out.ok) throw new Error(out.reason);
  return out;
}

/** h1 (host) stands south of a five-model guest squad g1 strung along x at z = 10; g1 is at half strength. */
function squadScenario(): GameState {
  const h1 = mkUnit('h1', HOST, 4, 0);
  const g1 = mkUnit('g1', GUEST, 0, 10, 5);
  return endOfActivation([h1, g1], { g1: 3 });
}

describe('push: when it is offered', () => {
  it('a unit that fails its Morale Test and is attacked by an enemy gets one push die, rolled for the attacker', () => {
    const specs = getDiceSpecs(squadScenario(), endAction())!;
    expect(specs.map((s) => s.purpose)).toEqual(['morale', 'push']);
    expect(specs[1].count).toBe(1);
  });

  it('a unit that is already Shaken fails without a roll and is not pushed again (no push die)', () => {
    const state = squadScenario();
    unitOf(state, 'g1').status = ['shaken'];
    expect((getDiceSpecs(state, endAction()) ?? []).some((s) => s.purpose === 'push')).toBe(false);
  });

  it('a passed test is never pushed, whatever the push die shows', () => {
    const out = endWith(squadScenario(), { morale: [6], push: [6] });
    expect(out.state!.turnState.pendingReaction ?? null).toBeNull();
    expect(out.logEntry.dice?.outcome.moraleTests?.[0].pushRoll).toBeUndefined();
  });

  it('Shaken but the push die is under 4: nothing happens, the die is recorded', () => {
    const out = endWith(squadScenario(), { morale: [1], push: [3] });
    expect(unitOf(out.state!, 'g1').status).toEqual(['shaken']);
    expect(out.state!.turnState.pendingReaction ?? null).toBeNull();
    expect(out.logEntry.dice?.outcome.moraleTests?.[0]).toMatchObject({ outcome: 'shaken', pushRoll: 3 });
  });

  it('Shaken and the push die is exactly 4: the attacker gets a push prompt with Auto, Confirm and Don\'t push', () => {
    const out = endWith(squadScenario(), { morale: [1], push: [4] });
    const pending = out.state!.turnState.pendingReaction!;
    expect(pending).toMatchObject({
      type: 'push',
      promptingPlayerId: HOST,
      sourceUnitId: 'h1',
      targetUnitId: 'g1',
    });
    expect(pending.options.map((o) => o.id)).toEqual([PUSH_AUTO_CHOICE, PUSH_CONFIRM_CHOICE, PUSH_DECLINE_CHOICE]);
    expect(pending.options[0].isDefault).toBe(true);
    expect(out.logEntry.dice?.outcome.moraleTests?.[0]).toMatchObject({ pushRoll: 4 });
  });

  it('a unit that is Routed (a melee loser at half strength) is gone: no push', () => {
    const h1 = mkUnit('h1', HOST, 4, 9);
    h1.weapons = [weapon('blade')];
    const g1 = mkUnit('g1', GUEST, 0, 10, 5);
    const state = endOfActivation([h1, g1], { g1: 3 });
    state.turnState.meleeUnitIds = ['h1', 'g1'];
    state.turnState.meleePairs = [['h1', 'g1']];
    const out = endWith(state, { morale: [1], push: [6] });
    expect(unitOf(out.state!, 'g1').status).toEqual(['routed']);
    expect(out.state!.turnState.pendingReaction ?? null).toBeNull();
  });

  it('the active unit that is Shaken without having fought in melee is not pushed (nobody attacked it)', () => {
    const h1 = mkUnit('h1', HOST, 4, 0, 4);
    const g1 = mkUnit('g1', GUEST, 0, 10, 4);
    const state = endOfActivation([h1, g1], { h1: 2 });
    const specs = getDiceSpecs(state, endAction())!;
    expect(specs.some((s) => s.purpose === 'push')).toBe(false);
  });

  it('a melee-struck active unit that is Shaken is pushed by the unit it fought', () => {
    const h1 = mkUnit('h1', HOST, 4, 9, 4);
    const g1 = mkUnit('g1', GUEST, 4, 10, 4);
    const state = endOfActivation([h1, g1], { h1: 1, g1: 0 });
    // h1 took a wound in melee but stayed above half: use the wound test instead (not in melee) via an extra wound
    wound(unitOf(state, 'h1'), 1);
    state.turnState.meleePairs = [['h1', 'g1']];
    state.turnState.meleeUnitIds = ['h1', 'g1'];
    // h1 lost the melee: it tests; it is at half strength (2 of 4) and so would Rout, not become Shaken
    const out = endWith(state, { morale: [1], push: [6] });
    expect(unitOf(out.state!, 'h1').status).toEqual(['routed']);
    expect(out.state!.turnState.pendingReaction ?? null).toBeNull();
  });
});

describe('push: the Auto choice', () => {
  const afterShaken = () => endWith(squadScenario(), { morale: [1], push: [5] }).state!;

  it('moves the model nearest the attacker 2" straight away from it', () => {
    const state = afterShaken();
    const before = unitOf(state, 'g1').models.filter((m) => !m.isDestroyed);
    const out = resolve(state, respondAuto(state));
    const g1 = unitOf(out.state!, 'g1');
    // h1 stands at (4, 0): the nearest living model is the one at x = 4, so it moves to (4, 12)
    const pushed = g1.models.find((m) => m.id === 'g1-m4')!;
    expect(pushed.position).toMatchObject({ x: 4, z: 12, y: 0 });
    expect(before.find((m) => m.id === 'g1-m4')!.position).toMatchObject({ x: 4, z: 10 });
    expect(out.state!.turnState.pendingReaction ?? null).toBeNull();
  });

  it('keeps the unit together: only the models cut off by the push step in, nearest first; the rest stay put', () => {
    const state = afterShaken();
    const out = resolve(state, respondAuto(state));
    const g1 = unitOf(out.state!, 'g1');
    const alive = g1.models.filter((m) => !m.isDestroyed);
    expect(validateSquadCoherency(alive.map((m) => m.position!)).coherent).toBe(true);
    // models 2 and 3 were not cut off from each other: model 2 (the far end of the chain) did not need to move
    expect(g1.models.find((m) => m.id === 'g1-m2')!.position).toMatchObject({ x: 2, z: 10 });
    // model 3 moved to link up with the pushed model
    const m3 = g1.models.find((m) => m.id === 'g1-m3')!.position!;
    expect(Math.hypot(m3.x - 4, m3.z - 12)).toBeLessThanOrEqual(2.02);
    expect(Math.hypot(m3.x - 3, m3.z - 10)).toBeGreaterThan(0.01);
  });

  it('goes as far as is legal: stopped by the board edge', () => {
    const h1 = mkUnit('h1', HOST, 0, 0);
    const g1 = mkUnit('g1', GUEST, 0, 23.0);
    const state = endOfActivation([h1, g1], { g1: 0 });
    const auto = autoPush(state, unitOf(state, 'g1'), unitOf(state, 'h1'))!;
    // the board is 24" from the centre line to the edge; a base needs 0.45" of room
    expect(auto.plan.position.z).toBeCloseTo(23.5, 1);
  });

  it('stops short of terrain in the way', () => {
    const crate = TERRAIN_PALETTE_CATALOG['crate'];
    const wall = {
      id: 'crate',
      terrainType: 'crate',
      position: P(0, 12.0),
      rotation: { x: 0, y: 0, z: 0 },
      scale: { ...crate.defaultScale },
      blocksLineOfSight: crate.blocksLineOfSight,
      providesCover: crate.providesCover,
      isObstacle: crate.isObstacle,
      isWalkable: true,
    } as TerrainPiece;
    const h1 = mkUnit('h1', HOST, 0, 0);
    const g1 = mkUnit('g1', GUEST, 0, 10);
    const state = endOfActivation([h1, g1], { g1: 0 }, [wall]);
    const auto = autoPush(state, unitOf(state, 'g1'), unitOf(state, 'h1'))!;
    expect(auto.plan.position.z).toBeGreaterThan(10);
    expect(auto.plan.position.z).toBeLessThan(12);
  });

  it('a pushed model that ends overhanging an edge falls: 3" is 3 dice, each 1-3 a wound, and the activation of nobody ends', () => {
    const deckMeta = TERRAIN_PALETTE_CATALOG['platform-small'];
    const deck = {
      id: 'deck',
      terrainType: 'platform-small',
      position: P(-2, 0),
      rotation: { x: 0, y: 0, z: 0 },
      scale: { ...deckMeta.defaultScale },
      blocksLineOfSight: deckMeta.blocksLineOfSight,
      providesCover: deckMeta.providesCover,
      isObstacle: deckMeta.isObstacle,
      isWalkable: true,
    } as TerrainPiece; // x -4..0, top at 3"
    const h1 = mkUnit('h1', HOST, -9, 0);
    const g1 = mkUnit('g1', GUEST, -1, 0, 4, 3); // along the deck, pushed east off its edge
    g1.models.forEach((m, i) => (m.position = P(-4 + i * 1.0, 0, 3)));
    g1.position = P(-2.5, 0, 3);
    const state = endOfActivation([h1, g1], { g1: 2 }, [deck]);
    const shaken = endWith(state, { morale: [1], push: [4] }).state!;
    const act = respondAuto(shaken);
    const specs = getDiceSpecs(shaken, act)!;
    expect(specs).toEqual([{ count: 3, sides: 6, purpose: 'fall' }]);
    const out = resolve(shaken, act, { fall: [1, 5, 2] });
    const g = unitOf(out.state!, 'g1');
    const events = out.logEntry.dice!.outcome.traversal!;
    expect(events.map((e) => e.type)).toEqual(['push', 'fall']);
    expect(events[1]).toMatchObject({ wounds: 2, rolls: [1, 5, 2] });
    // fall wounds belong to the model that fell: it dies (3 casualties with the 2 already gone), the excess wound is lost
    expect(g.models.filter((m) => m.isDestroyed)).toHaveLength(3);
    expect(g.models.find((m) => m.id === 'g1-m2')!.isDestroyed).toBe(true);
    expect(g.models.find((m) => m.id === 'g1-m2')!.position!.y).toBe(0);
    expect(out.state!.turnState.activeUnitId ?? null).toBeNull();
  });

  it('a fall under 2" needs no dice', () => {
    const lowMeta = TERRAIN_PALETTE_CATALOG['platform-small'];
    const deck = {
      id: 'deck',
      terrainType: 'platform-small',
      position: P(-2, 0),
      rotation: { x: 0, y: 0, z: 0 },
      scale: { ...lowMeta.defaultScale, y: 1.5 },
      blocksLineOfSight: lowMeta.blocksLineOfSight,
      providesCover: lowMeta.providesCover,
      isObstacle: lowMeta.isObstacle,
      isWalkable: true,
    } as TerrainPiece;
    const h1 = mkUnit('h1', HOST, -9, 0);
    const g1 = mkUnit('g1', GUEST, -0.5, 0, 1, 1.5);
    const state = endOfActivation([h1, g1], { g1: 0 }, [deck]);
    const auto = autoPush(state, unitOf(state, 'g1'), unitOf(state, 'h1'))!;
    expect(auto.plan.fallHeight).toBeCloseTo(1.5);
    expect(auto.plan.fallDice).toBe(0);
    expect(auto.plan.position.y).toBe(0);
  });

  it('the host applies Auto when the prompt times out (the default option), and play moves on', () => {
    const state = afterShaken();
    const pending = state.turnState.pendingReaction!;
    const fallback = pending.options.find((o) => o.isDefault)!;
    const action = createAction(HOST, 'respond-reaction', { type: 'respond-reaction', reactionId: pending.id, choiceId: fallback.id });
    expect(validateAction(state, action)).toEqual({ valid: true });
    const out = resolve(state, action);
    expect(out.state!.turnState.pendingReaction ?? null).toBeNull();
    expect(out.state!.turnState.currentPlayerId).toBe(GUEST);
  });

  it('while a push is pending nothing else is allowed, and only the attacker may answer', () => {
    const state = afterShaken();
    expect(validateAction(state, createAction(GUEST, 'respond-reaction', { type: 'respond-reaction', reactionId: state.turnState.pendingReaction!.id, choiceId: PUSH_AUTO_CHOICE })).valid).toBe(false);
    expect(validateAction(state, createAction(GUEST, 'activate-unit', { type: 'activate-unit', unitId: 'g1' })).valid).toBe(false);
  });
});

describe('push: a chosen push (push-move)', () => {
  const afterShaken = () => endWith(squadScenario(), { morale: [1], push: [5] }).state!;
  const move = (modelId: string, x: number, z: number, actor = HOST) =>
    createAction(actor, 'push-move', { type: 'push-move', modelId, destination: { x, y: 0, z } });

  it('moves the chosen model up to 2" in any direction', () => {
    const state = afterShaken();
    const action = move('g1-m3', 3, 11.5);
    expect(validateAction(state, action)).toEqual({ valid: true });
    const out = resolve(state, action);
    expect(unitOf(out.state!, 'g1').models.find((m) => m.id === 'g1-m3')!.position).toMatchObject({ x: 3, z: 11.5 });
    expect(out.state!.turnState.pendingReaction ?? null).toBeNull();
  });

  it('exactly 2.0" is allowed; just over is not', () => {
    const state = afterShaken();
    expect(validateAction(state, move('g1-m3', 3, 12)).valid).toBe(true);
    const far = validateAction(state, move('g1-m3', 3, 12.1));
    expect(far.valid).toBe(false);
    expect(far.reason).toMatch(/at most 2/);
  });

  it('rejects the wrong player, an unknown model, a spot on top of another model and a spot off the board', () => {
    const state = afterShaken();
    expect(validateAction(state, move('g1-m3', 3, 11.5, GUEST)).valid).toBe(false);
    expect(validateAction(state, move('nope', -1.5, 11)).valid).toBe(false);
    expect(validateAction(state, move('g1-m3', 4, 10.2)).valid).toBe(false); // on top of model 4
    const edge = endOfActivation([mkUnit('h1', HOST, 0, 0), mkUnit('g1', GUEST, 0, 23.5)], { g1: 0 });
    expect(planPush(edge, unitOf(edge, 'g1'), unitOf(edge, 'g1').models[0], { x: 0, z: 25 }).ok).toBe(false);
  });

  it('ignores any height the client sends: the host works it out', () => {
    const state = afterShaken();
    const action = createAction(HOST, 'push-move', { type: 'push-move', modelId: 'g1-m3', destination: { x: 3, y: 40, z: 11 } });
    const out = resolve(state, action);
    expect(unitOf(out.state!, 'g1').models.find((m) => m.id === 'g1-m3')!.position!.y).toBe(0);
  });

  it('is not accepted without a pending push', () => {
    const state = squadScenario();
    expect(validateAction(state, move('g1-m3', 3, 11.5)).valid).toBe(false);
  });
});

describe('push: several Shaken units in one end of activation', () => {
  it('prompts one after the other', () => {
    const h1 = mkUnit('h1', HOST, 4, 0);
    const g1 = mkUnit('g1', GUEST, 0, 10, 5);
    const g2 = mkUnit('g2', GUEST, 10, 10, 5);
    const state = endOfActivation([h1, g1, g2], { g1: 3, g2: 3 });
    const specs = getDiceSpecs(state, endAction())!;
    expect(specs.find((s) => s.purpose === 'push')!.count).toBe(2);
    const out = endWith(state, { morale: [1, 1], push: [4, 6] });
    // the second push die failed: only g1 is prompted
    expect(out.state!.turnState.pendingReaction).toMatchObject({ targetUnitId: 'g1' });
    const both = endWith(state, { morale: [1, 1], push: [4, 5] });
    const first = both.state!;
    expect(first.turnState.pendingReaction).toMatchObject({ targetUnitId: 'g1' });
    const next = resolve(first, respondAuto(first));
    expect(next.state!.turnState.pendingReaction).toMatchObject({ targetUnitId: 'g2' });
    const last = resolve(next.state!, respondAuto(next.state!));
    expect(last.state!.turnState.pendingReaction ?? null).toBeNull();
  });
});

function tallDeck(): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG['platform-small'];
  return {
    id: 'deck',
    terrainType: 'platform-small',
    position: P(-2, 0),
    rotation: { x: 0, y: 0, z: 0 },
    scale: { ...meta.defaultScale, y: 6 },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
    isWalkable: true,
  } as TerrainPiece; // x -4..0, top at 6"
}

/** h1 (host) with a Shaken four-model g1 along the 6" deck, the push prompt pending. */
function deckScenario(): GameState {
  const h1 = mkUnit('h1', HOST, -9, 0);
  const g1 = mkUnit('g1', GUEST, -3.5, 0, 4, 6);
  const state = endOfActivation([h1, g1], { g1: 0 }, [tallDeck()]);
  unitOf(state, 'g1').status = ['shaken'];
  state.turnState.pendingReaction = createPushReaction('a1', unitOf(state, 'g1'), unitOf(state, 'h1'), []);
  return state;
}

describe('push: declining and falling', () => {
  const afterShaken = () => endWith(squadScenario(), { morale: [1], push: [5] }).state!;
  const respond = (state: GameState, choiceId: string, actor = HOST) =>
    createAction(actor, 'respond-reaction', { type: 'respond-reaction', reactionId: state.turnState.pendingReaction!.id, choiceId });

  it("Don't push leaves every model where it was, needs no dice and moves play on", () => {
    const state = afterShaken();
    const before = JSON.stringify(unitOf(state, 'g1').models.map((m) => m.position));
    const act = respond(state, PUSH_DECLINE_CHOICE);
    expect(validateAction(state, act)).toEqual({ valid: true });
    expect(getDiceSpecs(state, act) ?? []).toEqual([]);
    const out = resolve(state, act);
    expect(JSON.stringify(unitOf(out.state!, 'g1').models.map((m) => m.position))).toBe(before);
    expect(out.state!.turnState.pendingReaction ?? null).toBeNull();
    expect(out.logEntry.dice?.outcome.traversal?.[0].text).toMatch(/declined/);
  });

  it('Confirm is not an answer on its own: the move must arrive as a push-move', () => {
    const state = afterShaken();
    expect(validateAction(state, respond(state, PUSH_CONFIRM_CHOICE)).valid).toBe(false);
  });

  it('a model pushed 2" off a 6" edge rolls 6 fall dice (1-3 wound) and the rest of its squad ends within 1" of it at the bottom', () => {
    const state = deckScenario();
    const act = createAction(HOST, 'push-move', { type: 'push-move', modelId: 'g1-m3', destination: { x: 1.5, y: 6, z: 0 } });
    expect(validateAction(state, act)).toEqual({ valid: true });
    expect(getDiceSpecs(state, act)).toEqual([{ count: 6, sides: 6, purpose: 'fall' }]);
    const out = resolve(state, act, { fall: [1, 2, 3, 4, 5, 6] });
    const events = out.logEntry.dice!.outcome.traversal!;
    expect(events.find((e) => e.type === 'fall')).toMatchObject({ wounds: 3, rolls: [1, 2, 3, 4, 5, 6] });
    const g = unitOf(out.state!, 'g1');
    const fallen = g.models.find((m) => m.id === 'g1-m3')!;
    expect(fallen.position!.y).toBe(0);
    // three wounds, but only the fallen model (Tough 1) takes them: it dies and the others are untouched
    const alive = g.models.filter((m) => !m.isDestroyed);
    expect(alive.length).toBe(3);
    for (const m of alive) {
      expect(m.position!.y).toBe(0);
      expect(Math.hypot(m.position!.x - fallen.position!.x, m.position!.z - fallen.position!.z)).toBeLessThanOrEqual(2.0 + 1e-6);
    }
    expect(out.state!.turnState.pendingReaction ?? null).toBeNull();
  });

  it('with no wounds from the fall, all four models stand within 1" of the fallen one at the bottom, not overlapping', () => {
    const state = deckScenario();
    const act = createAction(HOST, 'push-move', { type: 'push-move', modelId: 'g1-m3', destination: { x: 1.5, y: 6, z: 0 } });
    const out = resolve(state, act, { fall: [6, 5, 4, 6, 5, 4] });
    const g = unitOf(out.state!, 'g1');
    const fallen = g.models.find((m) => m.id === 'g1-m3')!;
    for (const m of g.models) {
      expect(m.isDestroyed).toBe(false);
      expect(m.position!.y).toBe(0);
      if (m !== fallen) expect(Math.hypot(m.position!.x - fallen.position!.x, m.position!.z - fallen.position!.z)).toBeLessThanOrEqual(2.0 + 1e-6);
      for (const o of g.models) {
        if (o !== m) expect(Math.hypot(m.position!.x - o.position!.x, m.position!.z - o.position!.z)).toBeGreaterThanOrEqual(0.9);
      }
    }
  });
});

describe('push: the built-in Jump Range map supports hand-testing a push-fall', () => {
  it('a model at the east edge of the 4.5" deck pushed 2" east falls 4.5" (5 dice); a 3.0" deck edge is 3 dice', () => {
    const map = createJumpRangeMap();
    const mk = (x: number, z: number, y: number) => {
      const g1 = mkUnit('g1', GUEST, x, z, 1, y);
      const state = endOfActivation([mkUnit('h1', HOST, x - 12, z), g1], { g1: 0 }, map.terrain as TerrainPiece[]);
      return { state, g1: unitOf(state, 'g1') };
    };
    // deck D spans x -20..-16 (z -10..-2), top at 4.5"
    const tall = mk(-16.5, -6, 4.5);
    const tallPlan = planPush(tall.state, tall.g1, tall.g1.models[0], { x: -14.5, z: -6 });
    expect(tallPlan).toMatchObject({ ok: true, fallHeight: 4.5, fallDice: 5 });
    // deck A spans x -11..-7, top at 3.0"
    const low = mk(-7.5, -6, 3);
    const lowPlan = planPush(low.state, low.g1, low.g1.models[0], { x: -5.5, z: -6 });
    expect(lowPlan.ok && lowPlan.fallDice).toBe(3);
  });
});

describe('G-19: pushAttackerFor ignores destroyed attackers and destroyed melee partners', () => {
  it('returns null when the active attacker was destroyed (e.g. by Counter / strike-back)', () => {
    const h1 = mkUnit('h1', HOST, 0, 0, 1);
    h1.isDestroyed = true;
    const g1 = mkUnit('g1', GUEST, 0, 1, 2);
    const state = mkState([h1, g1]);

    expect(pushAttackerFor(state, g1, h1)).toBeNull();
  });

  it('returns null when the active unit meleePairs partner was destroyed', () => {
    const h1 = mkUnit('h1', HOST, 0, 0, 2);
    const g1 = mkUnit('g1', GUEST, 0, 1, 1);
    g1.isDestroyed = true;
    const state = mkState([h1, g1]);
    state.turnState.meleePairs = [['h1', 'g1']];

    expect(pushAttackerFor(state, h1, h1)).toBeNull();
  });
});

describe('Rules Q2: only an attacking enemy can push a newly Shaken unit', () => {
  it('returns null for an enemy unit that active never attacked (no attackedFrom and not in meleePairs)', () => {
    const h1 = mkUnit('h1', HOST, 0, 0, 1);
    const g1 = mkUnit('g1', GUEST, 0, 10, 4);
    const state = endOfActivation([h1, g1], { g1: 2 }, [], { recordAttack: false });

    expect(pushAttackerFor(state, g1, h1)).toBeNull();
    const specs = getDiceSpecs(state, endAction()) ?? [];
    expect(specs.some((s) => s.purpose === 'push')).toBe(false);
    const out = endWith(state, { morale: [1] });
    expect(out.state!.turnState.pendingReaction ?? null).toBeNull();
  });

  it('does not request push dice or prompt self-push when active unit takes dangerous terrain wounds down to half strength', () => {
    const hazard: TerrainPiece = {
      id: 'pool-1',
      terrainType: 'hazard-pool',
      position: P(0, 3),
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 4, y: 0.1, z: 2 },
      blocksLineOfSight: false,
      providesCover: false,
      isObstacle: false,
      isDangerous: true,
    };
    const h1 = mkUnit('h1', HOST, 0, 0, 2);
    const g1 = mkUnit('g1', GUEST, 0, 20, 2);
    const base = mkState([h1, g1], [hazard]);

    const s1 = applyAction(base, createAction(HOST, 'activate-unit', { type: 'activate-unit', unitId: 'h1' })).state!;
    const adv = createAction(HOST, 'advance', {
      type: 'advance',
      unitId: 'h1',
      path: [P(0, 0), P(0, 5.5)],
      finalPosition: P(0, 5.5),
      modelPositions: [P(0, 5.5), P(1, 5.5)],
    });
    const moved = applyAction(s1, adv, [roll('hazard_pool-1', [1, 6])]);
    expect(moved.ok).toBe(true);
    const pick = moved.state!.turnState.pendingReaction;
    const afterPick =
      pick?.type === 'pick-casualties'
        ? applyAction(moved.state!, createAction(HOST, 'pick-casualties', { type: 'pick-casualties', unitId: 'h1', modelIds: ['h1-m0'] } as any)).state!
        : moved.state!;

    const specs = getDiceSpecs(afterPick, endAction()) ?? [];
    expect(specs.some((s) => s.purpose === 'push')).toBe(false);
    const ended = endWith(afterPick, { morale: [1] });
    expect(unitOf(ended.state!, 'h1').status).toContain('shaken');
    expect(ended.state!.turnState.pendingReaction ?? null).toBeNull();
  });

  it('a losing charger in meleePairs with living opponent can still be pushed by that opponent', () => {
    const h1 = mkUnit('h1', HOST, 4, 9, 4);
    const g1 = mkUnit('g1', GUEST, 4, 10, 4);
    const state = endOfActivation([h1, g1], {});
    // h1 lost melee by wounds+Fear without dropping to half strength -> Shaken -> g1 pushes
    unitOf(state, 'g1').specialRules = ['fear(2)'];
    state.turnState.meleePairs = [['h1', 'g1']];
    state.turnState.meleeUnitIds = ['h1', 'g1'];

    expect(pushAttackerFor(state, h1, h1)?.id).toBe('g1');
    const out = endWith(state, { morale: [1], push: [5] });
    expect(out.state!.turnState.pendingReaction).toMatchObject({
      type: 'push',
      promptingPlayerId: GUEST,
      sourceUnitId: 'g1',
      targetUnitId: 'h1',
    });
  });
});
