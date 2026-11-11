import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { GameAction, GameState, TerrainPiece } from '../../src/gameTypes';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';
import { createRematchState } from '../../src/engine/rematch';
import { applyDefaultScenario, ScenarioOptions } from '../../src/data/scenario';
import { CustomMapDefinition } from '../../src/data/mapSchema';
import { playObjectivesPhase } from '../fixtures/setupFlow';

const HOST = 'host1';
const GUEST = 'guest1';

function startState(options?: ScenarioOptions): GameState {
  const state = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  if (options) applyDefaultScenario(state, options);
  else applyDefaultScenario(state);
  return state;
}

/**
 * A deployment-phase game as a rematch rebuilds it: the objectives phase is played (fixed dice) and its log is
 * cleared, because a rematch keeps the placed objectives and roll-offs but starts with an empty action log.
 */
function afterObjectivesPhase(state: GameState, options?: Parameters<typeof playObjectivesPhase>[1]): GameState {
  if (state.turnState.phase !== 'objectives') return state;
  const s = playObjectivesPhase(state, options);
  s.actionLog = [];
  s.lastActionId = '';
  return s;
}

const concede = (actorId: string): GameAction => createAction(actorId, 'concede', { type: 'concede' });
const rematch = (actorId: string): GameAction => createAction(actorId, 'request-rematch', { type: 'request-rematch' });

function apply(state: GameState, action: GameAction): GameState {
  const out = applyAction(state, action);
  if (!out.ok) throw new Error(`action ${action.type} rejected: ${out.reason}`);
  return out.state;
}

/** Plays a few real actions, changes units/objectives, then ends the match. */
function gameOverStateOf(start: GameState, ender: 'concede' | 'elimination' | 'round-4' = 'concede'): GameState {
  let s = JSON.parse(JSON.stringify(start)) as GameState;
  const hostUnit = s.units.find((u) => u.ownerId === HOST)!;
  if (s.turnState.phase === 'deployment') {
    s = apply(s, createAction(HOST, 'deploy-unit', {
      type: 'deploy-unit', unitId: hostUnit.id, position: { x: 0, y: 0, z: 2 - s.board.height / 2 },
    }));
  } else {
    s = apply(s, createAction(HOST, 'hold', { type: 'hold', unitId: hostUnit.id }));
  }
  // Real play also moves, wounds and captures things.
  s.units[0].position = { x: 3, y: 0, z: 3 };
  s.units[0].isActivated = true;
  s.units[1].wounds = 0;
  s.units[1].isDestroyed = true;
  for (const o of s.objectives ?? []) {
    o.controllingPlayerId = HOST;
    o.isContested = true;
  }
  s.turnState.roundNumber = 2;
  if (ender === 'concede') return apply(s, concede(GUEST));
  if (ender === 'elimination') {
    for (const u of s.units) if (u.ownerId === GUEST) u.isDestroyed = true;
    s.status = 'in-progress';
    s.turnState.phase = 'activation';
    s.turnState.currentPlayerId = HOST;
    s.turnState.pendingReaction = null;
    s.turnState.activeUnitId = null;
    const next = s.units.find((u) => u.ownerId === HOST && !u.isActivated && !u.isDestroyed)!;
    next.isDeployed = true;
    return apply(s, createAction(HOST, 'hold', { type: 'hold', unitId: next.id }));
  }
  s.status = 'game-over';
  s.turnState.phase = 'game-over';
  s.winner = HOST;
  s.endReason = 'Round limit';
  return s;
}

function customMap(): CustomMapDefinition {
  const terrain = [
    {
      id: 'w1', type: 'wall-short', position: { x: 4, y: 0, z: 2 }, rotation: { x: 0, y: 1.5, z: 0 },
      scale: { x: 4, y: 2, z: 0.5 },
    },
    {
      id: 'c1', type: 'crate', position: { x: -6, y: 0, z: -3 }, rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  ] as unknown as TerrainPiece[];
  return {
    id: 'm', name: 'Custom', version: 1,
    board: { width: 44, height: 30 },
    terrain,
    objectives: [
      { id: 'o1', name: 'One', position: { x: -9, y: 0, z: 0 } },
      { id: 'o2', name: 'Two', position: { x: 9, y: 0, z: 0 } },
      { id: 'o3', name: 'Three', position: { x: 0, y: 0, z: 4 } },
    ],
  };
}

const STARTERS = { hostArmyId: 'frontier-wardens-starter', guestArmyId: 'rust-raiders-starter' };

const VARIANTS: [string, () => ScenarioOptions | undefined][] = [
  ['a plain game with starter armies', () => ({ ...STARTERS })],
  ['a deployment-phase game', () => ({ hostArmyId: 'rust-raiders-starter', guestArmyId: 'frontier-wardens-starter', useDeploymentPhase: true })],
  ['a custom map (44x30, terrain, objectives)', () => ({ ...STARTERS, customMap: customMap() })],
  ['a custom map in a deployment game', () => ({ useDeploymentPhase: true, customMap: customMap() })],
  ['the default armies (no army ids)', () => ({})],
  ['no options at all', () => undefined],
];

function withoutVolatile(s: GameState) {
  const { gameId: _g, createdAt: _c, lastActionId: _l, ...rest } = s;
  return rest;
}

describe('applyDefaultScenario records setup', () => {
  it('omits setup when no setup option was given', () => {
    expect(startState().setup).toBeUndefined();
    expect(startState({}).setup).toBeUndefined();
    expect(startState({ customMap: customMap() }).setup).toBeUndefined();
  });

  it('records exactly the options that were given', () => {
    expect(startState({ hostArmyId: 'frontier-wardens-starter' }).setup).toEqual({ hostArmyId: 'frontier-wardens-starter' });
    expect(startState({ useDeploymentPhase: true }).setup).toEqual({ useDeploymentPhase: true });
    expect(
      startState({ hostArmyId: 'a', guestArmyId: 'b', useDeploymentPhase: false, customMap: customMap() }).setup,
    ).toEqual({ hostArmyId: 'a', guestArmyId: 'b', useDeploymentPhase: false });
  });

  it('keeps the state JSON-safe (no undefined keys)', () => {
    const s = startState({ hostArmyId: 'frontier-wardens-starter' });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('createRematchState exactness', () => {
  for (const [name, opts] of VARIANTS) {
    for (const ender of ['concede', 'elimination', 'round-4'] as const) {
      it(`rebuilds the exact starting state: ${name}, after ${ender}`, () => {
        const start = afterObjectivesPhase(startState(opts()));
        const over = gameOverStateOf(start, ender);
        expect(over.status).toBe('game-over');
        expect(over.units).not.toEqual(start.units);
        const fresh = createRematchState(over);
        expect(withoutVolatile(fresh)).toEqual(withoutVolatile(start));
        expect(fresh.actionLog).toEqual([]);
        expect(fresh.lastActionId).toBe('');
        expect(fresh.gameId).not.toBe(over.gameId);
      });
    }
  }

  it('does not alias the previous state (terrain and objectives are deep copies)', () => {
    const start = afterObjectivesPhase(startState({ useDeploymentPhase: true, customMap: customMap() }));
    const over = gameOverStateOf(start);
    const fresh = createRematchState(over);
    fresh.terrain[0].position.x = 99;
    fresh.objectives![0].position.x = 99;
    expect(over.terrain[0].position.x).not.toBe(99);
    expect(over.objectives![0].position.x).not.toBe(99);
  });

  it('keeps the placed objectives and both roll-offs, skips the objectives phase and starts with the same deployer', () => {
    const start = afterObjectivesPhase(startState({ useDeploymentPhase: true }), {
      countRoll: 5,
      missionWinner: 'guest',
      deploymentWinner: 'guest',
    });
    expect(start.objectives).toHaveLength(5);
    const over = apply(start, concede(HOST));
    for (const o of over.objectives!) o.controllingPlayerId = HOST;
    const fresh = createRematchState(over);
    expect(fresh.turnState.phase).toBe('deployment');
    expect(fresh.objectives!.map((o) => o.position)).toEqual(start.objectives!.map((o) => o.position));
    expect(fresh.objectives!.every((o) => o.controllingPlayerId === null && !o.isContested)).toBe(true);
    expect(fresh.setupRolls).toEqual(start.setupRolls);
    expect(fresh.setupRolls!.missionRollOff!.winnerId).toBe(GUEST);
    expect(fresh.turnState.currentPlayerId).toBe(GUEST);
    expect(fresh.turnState.startingPlayerId).toBe(GUEST);
  });

  it('keeps objectives and roll-offs of a game without the deployment phase and starts straight in round 1', () => {
    const start = afterObjectivesPhase(startState({ ...STARTERS, useDeploymentPhase: false }), {
      countRoll: 5,
      missionWinner: 'guest',
      deploymentWinner: 'guest',
    });
    expect(start.turnState.phase).toBe('activation');
    const over = apply(start, concede(HOST));
    for (const o of over.objectives!) o.controllingPlayerId = HOST;
    const fresh = createRematchState(over);
    expect(fresh.turnState.phase).toBe('activation');
    expect(fresh.turnState.roundNumber).toBe(1);
    expect(fresh.objectives!.map((o) => o.position)).toEqual(start.objectives!.map((o) => o.position));
    expect(fresh.objectives!.every((o) => o.controllingPlayerId === null && !o.isContested)).toBe(true);
    expect(fresh.setupRolls).toEqual(start.setupRolls);
    expect(fresh.turnState.currentPlayerId).toBe(GUEST);
    expect(fresh.turnState.startingPlayerId).toBe(GUEST);
    expect(fresh.units.every((u) => u.isDeployed !== false)).toBe(true);
  });

  it('starts over from the objectives phase when the original match never finished it', () => {
    const start = startState({ useDeploymentPhase: true });
    const over = apply(start, concede(GUEST)); // conceded before any roll
    const fresh = createRematchState(over);
    expect(fresh.turnState.phase).toBe('objectives');
    expect(fresh.objectives).toEqual([]);
    expect(fresh.setupRolls).toBeUndefined();
  });

  it('rebuilds a state without setup as a plain game with the default armies', () => {
    const start = afterObjectivesPhase(startState());
    const over = gameOverStateOf(start);
    delete over.setup;
    const fresh = createRematchState(over);
    expect(withoutVolatile(fresh)).toEqual(withoutVolatile(start));
    expect(fresh.turnState.phase).toBe('activation');
    expect(fresh.turnState.roundNumber).toBe(1);
  });
});

describe('request-rematch', () => {
  const overState = () => gameOverStateOf(afterObjectivesPhase(startState({ ...STARTERS })));

  it('is invalid before the match is over', () => {
    const s = afterObjectivesPhase(startState({ ...STARTERS }));
    expect(validateAction(s, rematch(HOST))).toEqual({ valid: false, reason: "The match isn't over" });
  });

  it('is invalid from a non-player', () => {
    expect(validateAction(overState(), rematch('stranger')).valid).toBe(false);
  });

  it('records the first request and treats a duplicate as a no-op', () => {
    const once = apply(overState(), rematch(HOST));
    expect(once.status).toBe('game-over');
    expect(once.rematchRequestedBy).toEqual([HOST]);
    expect(validateAction(once, rematch(HOST)).valid).toBe(true);
    const twice = apply(once, rematch(HOST));
    expect(twice.rematchRequestedBy).toEqual([HOST]);
    expect(twice.status).toBe('game-over');
  });

  it('returns the fresh starting state when the second player requests, in either order', () => {
    for (const [first, second] of [[HOST, GUEST], [GUEST, HOST]]) {
      const start = afterObjectivesPhase(startState({ ...STARTERS }));
      const over = gameOverStateOf(start);
      const next = apply(apply(over, rematch(first)), rematch(second));
      expect(withoutVolatile(next)).toEqual(withoutVolatile(start));
      expect(next.actionLog).toEqual([]);
      expect(next.winner).toBeUndefined();
      expect(next.endReason).toBeUndefined();
      expect(next.rematchRequestedBy).toBeUndefined();
      expect(next.setup).toEqual(start.setup);
      expect(next.gameId).not.toBe(over.gameId);
    }
  });

  it('restarts a deployment game in deployment', () => {
    const start = afterObjectivesPhase(startState({ useDeploymentPhase: true }));
    const over = gameOverStateOf(start);
    const next = apply(apply(over, rematch(HOST)), rematch(GUEST));
    expect(next.turnState.phase).toBe('deployment');
    expect(next.turnState.roundNumber).toBe(0);
    expect(withoutVolatile(next)).toEqual(withoutVolatile(start));
  });

  it('works after elimination and round-4 endings', () => {
    for (const ender of ['elimination', 'round-4'] as const) {
      const start = afterObjectivesPhase(startState({ ...STARTERS }));
      const over = gameOverStateOf(start, ender);
      const next = apply(apply(over, rematch(GUEST)), rematch(HOST));
      expect(next.status).toBe('in-progress');
      expect(withoutVolatile(next)).toEqual(withoutVolatile(start));
    }
  });

  it('needs no dice', () => {
    expect(getDiceSpecs(overState(), rematch(HOST))).toBeNull();
  });

  it('is the only action accepted at game over', () => {
    const over = overState();
    const unit = over.units[0];
    const others: GameAction[] = [
      createAction(HOST, 'concede', { type: 'concede' }),
      createAction(HOST, 'end-round', { type: 'end-round' }),
      createAction(HOST, 'end-activation', { type: 'end-activation' }),
      createAction(HOST, 'activate-unit', { type: 'activate-unit', unitId: unit.id }),
      createAction(HOST, 'hold', { type: 'hold', unitId: unit.id }),
    ];
    for (const a of others) {
      expect(validateAction(over, a)).toEqual({ valid: false, reason: 'Game is over' });
    }
    expect(validateAction(over, rematch(HOST)).valid).toBe(true);
  });
});
