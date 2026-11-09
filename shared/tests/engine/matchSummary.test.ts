import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { GameState, Model, Unit, Vector3 } from '../../src/gameTypes';
import { applyAction } from '../../src/engine/actions';
import { endRound } from '../../src/engine/activation';
import { summarizeMatch } from '../../src/engine/matchSummary';

const HOST = 'host1';
const GUEST = 'guest1';

function makeModel(id: string, destroyed = false): Model {
  return { id, wounds: destroyed ? 0 : 1, maxWounds: 1, isDestroyed: destroyed };
}

function makeUnit(id: string, ownerId: string, overrides: Partial<Unit> = {}): Unit {
  return {
    id, ownerId, armyId: 'army-x', unitType: 'trooper', name: id, quality: 4, defense: 5, speed: 6,
    position: { x: 0, y: 0, z: 0 } as Vector3, rotation: { x: 0, y: 0, z: 0 } as Vector3,
    status: [], wounds: 1, maxWounds: 1, isActivated: false, isDestroyed: false,
    models: [makeModel(`${id}-m0`)], weapons: [], specialRules: [], hasMoved: false, remainingMovement: 6,
    ...overrides,
  };
}

function makeState(units: Unit[]): GameState {
  const s = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  s.units = units;
  s.status = 'in-progress';
  s.turnState.phase = 'activation';
  return s;
}

const objective = (id: string, who: string | null) => ({
  id, name: id, position: { x: 40, y: 0, z: 40 } as Vector3, controllingPlayerId: who,
});

describe('summarizeMatch endings', () => {
  it('reports a round-4 objective win', () => {
    const s = makeState([makeUnit('h1', HOST), makeUnit('g1', GUEST)]);
    s.objectives = [objective('o1', HOST), objective('o2', HOST), objective('o3', GUEST)];
    s.turnState.roundNumber = 4;
    endRound(s);
    const sum = summarizeMatch(s);
    expect(sum.winnerId).toBe(HOST);
    expect(sum.endReason).toBe('Objective victory (2 to 1)');
    expect(sum.roundsPlayed).toBe(4);
    expect(sum.objectiveScore).toEqual({ [HOST]: 2, [GUEST]: 1 });
  });

  it('reports a draw with no winner', () => {
    const s = makeState([makeUnit('h1', HOST), makeUnit('g1', GUEST)]);
    s.objectives = [objective('o1', HOST), objective('o2', GUEST)];
    s.turnState.roundNumber = 4;
    endRound(s);
    const sum = summarizeMatch(s);
    expect(sum.winnerId).toBeUndefined();
    expect(sum.endReason).toContain('drawn');
    expect(sum.objectiveScore).toEqual({ [HOST]: 1, [GUEST]: 1 });
  });

  it('reports an elimination', () => {
    const s = makeState([
      makeUnit('h1', HOST),
      makeUnit('h2', HOST),
      makeUnit('g1', GUEST, { isDestroyed: true, wounds: 0, models: [makeModel('g1-m0', true)] }),
    ]);
    s.turnState.roundNumber = 2;
    // Any accepted action runs the elimination check.
    const out = applyAction(s, createAction(HOST, 'hold', { type: 'hold', unitId: 'h1' }));
    if (!out.ok) throw new Error(`expected ok: ${out.reason}`);
    const sum = summarizeMatch(out.state);
    expect(sum.winnerId).toBe(HOST);
    expect(sum.endReason).toBe('Opponent eliminated');
    expect(sum.roundsPlayed).toBe(2);
    expect(sum.losses[GUEST]).toEqual({ unitsLost: 1, unitsTotal: 1, modelsLost: 1, modelsTotal: 1 });
    expect(sum.losses[HOST]).toEqual({ unitsLost: 0, unitsTotal: 2, modelsLost: 0, modelsTotal: 2 });
  });

  it('reports a concede', () => {
    const s = makeState([makeUnit('h1', HOST), makeUnit('g1', GUEST)]);
    s.turnState.roundNumber = 3;
    const out = applyAction(s, createAction(GUEST, 'concede', { type: 'concede' }));
    if (!out.ok) throw new Error('expected ok');
    const sum = summarizeMatch(out.state);
    expect(sum.winnerId).toBe(HOST);
    expect(sum.endReason).toBe('Bob conceded');
    expect(sum.roundsPlayed).toBe(3);
  });

  it('has no end reason before the match ends', () => {
    const sum = summarizeMatch(makeState([makeUnit('h1', HOST), makeUnit('g1', GUEST)]));
    expect(sum.winnerId).toBeUndefined();
    expect(sum.endReason).toBeUndefined();
  });
});

describe('summarizeMatch losses', () => {
  it('counts destroyed and routed units but only destroyed models', () => {
    const s = makeState([
      makeUnit('h1', HOST, { models: [makeModel('a'), makeModel('b', true), makeModel('c')] }),
      makeUnit('h2', HOST, { status: ['routed'], models: [makeModel('d'), makeModel('e'), makeModel('f', true)] }),
      makeUnit('h3', HOST, { isDestroyed: true, models: [makeModel('g', true), makeModel('h', true)] }),
      makeUnit('g1', GUEST),
    ]);
    const sum = summarizeMatch(s);
    expect(sum.losses[HOST]).toEqual({ unitsLost: 2, unitsTotal: 3, modelsLost: 4, modelsTotal: 8 });
    expect(sum.losses[GUEST]).toEqual({ unitsLost: 0, unitsTotal: 1, modelsLost: 0, modelsTotal: 1 });
  });

  it('treats a unit without a models array as one model', () => {
    const solo = makeUnit('g1', GUEST, { models: [] });
    const dead = makeUnit('g2', GUEST, { models: [], isDestroyed: true });
    const sum = summarizeMatch(makeState([makeUnit('h1', HOST), solo, dead]));
    expect(sum.losses[GUEST]).toEqual({ unitsLost: 1, unitsTotal: 2, modelsLost: 1, modelsTotal: 2 });
  });
});

describe('summarizeMatch rounds played', () => {
  it('is 0 in setup and deployment', () => {
    const s = makeState([makeUnit('h1', HOST)]);
    s.status = 'setting-up';
    s.turnState.phase = 'deployment';
    expect(summarizeMatch(s).roundsPlayed).toBe(0);
    s.turnState.phase = 'setup';
    expect(summarizeMatch(s).roundsPlayed).toBe(0);
  });

  it('is the current round during play', () => {
    const s = makeState([makeUnit('h1', HOST)]);
    s.turnState.roundNumber = 3;
    expect(summarizeMatch(s).roundsPlayed).toBe(3);
  });

  it('a concede in deployment reports 0 rounds', () => {
    const s = makeState([
      makeUnit('h1', HOST, { isDeployed: false }),
      makeUnit('g1', GUEST, { isDeployed: false }),
    ]);
    s.status = 'setting-up';
    s.turnState.phase = 'deployment';
    const out = applyAction(s, createAction(HOST, 'concede', { type: 'concede' }));
    if (!out.ok) throw new Error('expected ok');
    expect(summarizeMatch(out.state).roundsPlayed).toBe(0);
  });
});

describe('summarizeMatch purity', () => {
  it('does not mutate the state and survives a JSON round trip unchanged', () => {
    const s = makeState([makeUnit('h1', HOST, { status: ['routed'] }), makeUnit('g1', GUEST)]);
    s.objectives = [objective('o1', HOST)];
    s.status = 'game-over';
    s.endReason = 'Match drawn (1 to 0 objectives)';
    const before = JSON.stringify(s);
    const sum = summarizeMatch(s);
    expect(JSON.stringify(s)).toBe(before);
    expect(JSON.parse(JSON.stringify(sum))).toEqual(sum);
  });
});
