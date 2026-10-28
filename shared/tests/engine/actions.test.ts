import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState, SCHEMA_VERSION } from '../../src/gameState';
import {
  DiceResult,
  GameAction,
  GameState,
  Unit,
  Vector3,
  Weapon,
} from '../../src/gameTypes';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';
import { WEAPONS } from '../../src/data/weapons';

const HOST = 'host1';
const GUEST = 'guest1';

function weapon(id: keyof typeof WEAPONS): Weapon {
  return { ...WEAPONS[id], profile: { ...WEAPONS[id].profile } };
}

function makeUnit(id: string, ownerId: string, overrides: Partial<Unit> = {}): Unit {
  return {
    id,
    ownerId,
    armyId: 'army-x',
    unitType: 'trooper',
    name: id,
    quality: 4,
    defense: 5,
    speed: 6,
    position: { x: 0, y: 0, z: 0 } as Vector3,
    rotation: { x: 0, y: 0, z: 0 } as Vector3,
    status: [],
    wounds: 1,
    maxWounds: 1,
    isActivated: false,
    isDestroyed: false,
    models: [],
    weapons: [weapon('rifle')],
    specialRules: [],
    hasMoved: false,
    remainingMovement: 6,
    ...overrides,
  };
}

function makeState(units: Unit[], overrides: Partial<GameState> = {}): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  return { ...state, ...overrides };
}

function dice(attacks: number, toHit: number[], defense: number[]): DiceResult[] {
  return [
    { rolls: toHit, total: toHit.reduce((a, b) => a + b, 0), finalTotal: 0, purpose: 'to-hit' },
    {
      rolls: defense,
      total: defense.reduce((a, b) => a + b, 0),
      finalTotal: 0,
      purpose: 'defense',
    },
  ];
}

function act(state: GameState, action: GameAction, results?: DiceResult[]) {
  return applyAction(state, action, results);
}

describe('validateAction + applyAction: activate-unit', () => {
  it('activates a unit and records it for the round', () => {
    const state = makeState([
      makeUnit('h1', HOST),
      makeUnit('g1', GUEST),
    ]);
    const action = createAction(HOST, 'activate-unit', { type: 'activate-unit', unitId: 'h1' });
    const outcome = act(state, action);

    expect(outcome.ok).toBe(true);
    const unit = outcome.state!.units.find((u) => u.id === 'h1')!;
    expect(unit.isActivated).toBe(true);
    expect(outcome.state!.turnState.activeUnitId).toBe('h1');
    expect(outcome.state!.turnState.unitsActivatedThisRound).toContain('h1');
    expect(outcome.state!.turnState.phase).toBe('activation');
    expect(outcome.state!.actionLog).toHaveLength(1);
    expect(outcome.state!.actionLog[0].action).toBe(action);
  });

  it('spends a stunned unit\'s activation clearing the stun and passes initiative', () => {
    const state = makeState([
      makeUnit('h1', HOST, { status: ['stunned'] as any }),
      makeUnit('g1', GUEST),
    ]);
    const action = createAction(HOST, 'activate-unit', { type: 'activate-unit', unitId: 'h1' });
    const outcome = act(state, action);

    expect(outcome.ok).toBe(true);
    const unit = outcome.state!.units.find((u) => u.id === 'h1')!;
    expect(unit.isActivated).toBe(true);
    expect(unit.status).not.toContain('stunned');
    expect(outcome.state!.turnState.activeUnitId).toBeNull();
    expect(outcome.state!.turnState.currentPlayerId).toBe(GUEST);
  });

  it('rejects activation of a routed unit', () => {
    const state = makeState([makeUnit('h1', HOST, { status: ['routed'] as any })]);
    const action = createAction(HOST, 'activate-unit', { type: 'activate-unit', unitId: 'h1' });
    expect(act(state, action).reason).toBe('Unit is routed and cannot activate');
  });

  it('rejects activation while another unit is mid-activation', () => {
    const state = makeState([makeUnit('h1', HOST), makeUnit('h2', HOST)]);
    state.turnState.activeUnitId = 'h1';
    const action = createAction(HOST, 'activate-unit', { type: 'activate-unit', unitId: 'h2' });
    expect(act(state, action).reason).toBe('Another unit is already activating');
  });

  it('rejects activation of an enemy unit', () => {
    const state = makeState([makeUnit('g1', GUEST)]);
    const action = createAction(HOST, 'activate-unit', { type: 'activate-unit', unitId: 'g1' });
    expect(act(state, action).reason).toBe('Unit does not belong to acting player');
  });

  it('rejects actions when it is not the acting player\'s turn', () => {
    const state = makeState([makeUnit('g1', GUEST)]);
    const action = createAction(GUEST, 'activate-unit', { type: 'activate-unit', unitId: 'g1' });
    expect(act(state, action).reason).toBe('Not your turn');
  });
});

describe('applyAction: hold', () => {
  it('holds as a one-step activation that passes initiative', () => {
    const state = makeState([
      makeUnit('h1', HOST, { status: ['stunned'] as any }),
      makeUnit('g1', GUEST),
    ]);
    const action = createAction(HOST, 'hold', { type: 'hold', unitId: 'h1' });
    const outcome = act(state, action);

    expect(outcome.ok).toBe(true);
    const unit = outcome.state!.units.find((u) => u.id === 'h1')!;
    expect(unit.isActivated).toBe(true);
    // Holding spends the activation clearing the stun.
    expect(unit.status).not.toContain('stunned');
    expect(outcome.state!.turnState.activeUnitId).toBeNull();
    expect(outcome.state!.turnState.currentPlayerId).toBe(GUEST);
  });

  it('rejects holding with an already-activated unit', () => {
    const state = makeState([makeUnit('h1', HOST, { isActivated: true })]);
    const action = createAction(HOST, 'hold', { type: 'hold', unitId: 'h1' });
    expect(act(state, action).reason).toBe('Unit already activated this round');
  });

  it('allows holding from the action bar before the active unit moves or attacks', () => {
    const state = makeState([makeUnit('h1', HOST, { isActivated: true }), makeUnit('g1', GUEST)]);
    state.turnState.activeUnitId = 'h1';
    const action = createAction(HOST, 'hold', { type: 'hold', unitId: 'h1' });
    const outcome = act(state, action);
    expect(outcome.ok).toBe(true);
    expect(outcome.state!.turnState.activeUnitId).toBeNull();
    expect(outcome.state!.turnState.currentPlayerId).toBe(GUEST);
  });

  it('rejects holding after the active unit has moved', () => {
    const state = makeState([
      makeUnit('h1', HOST, { isActivated: true, hasMoved: true }),
      makeUnit('g1', GUEST),
    ]);
    state.turnState.activeUnitId = 'h1';
    const action = createAction(HOST, 'hold', { type: 'hold', unitId: 'h1' });
    expect(act(state, action).reason).toBe('Unit has already acted and cannot hold');
  });
});

describe('applyAction: move-unit', () => {
  function moveState(): GameState {
    const state = makeState([makeUnit('h1', HOST), makeUnit('g1', GUEST, { position: { x: 0, y: 0, z: 20 } as Vector3 })]);
    state.turnState.activeUnitId = 'h1';
    state.units.find((u) => u.id === 'h1')!.isActivated = true;
    return state;
  }

  it('moves the active unit and spends movement', () => {
    const state = moveState();
    const path: Vector3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 4 },
    ];
    const action = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h1',
      path,
      finalPosition: { x: 3, y: 0, z: 4 },
    });
    const outcome = act(state, action);

    expect(outcome.ok).toBe(true);
    const unit = outcome.state!.units.find((u) => u.id === 'h1')!;
    expect(unit.position).toEqual({ x: 3, y: 0, z: 4 });
    expect(unit.hasMoved).toBe(true);
    expect(unit.remainingMovement).toBe(1); // 6 - 5
  });

  it('rejects moving further than the remaining movement', () => {
    const state = moveState();
    const action = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h1',
      path: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 7 }],
      finalPosition: { x: 0, y: 0, z: 7 },
    });
    expect(act(state, action).reason).toBe('Move exceeds remaining movement');
  });

  it('rejects moves that leave the board', () => {
    const state = moveState();
    state.units.find((u) => u.id === 'h1')!.position = { x: 0, y: 0, z: -29.5 };
    const action = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h1',
      path: [{ x: 0, y: 0, z: -29.5 }, { x: 0, y: 0, z: -30.5 }],
      finalPosition: { x: 0, y: 0, z: -30.5 },
    });
    expect(act(state, action).reason).toBe('Move leaves the board');
  });

  it('rejects moving a unit that is not the active unit', () => {
    const state = makeState([makeUnit('h1', HOST, { isActivated: true }), makeUnit('h2', HOST, { isActivated: true })]);
    state.turnState.activeUnitId = 'h1';
    const action = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h2',
      path: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      finalPosition: { x: 1, y: 0, z: 0 },
    });
    expect(act(state, action).reason).toBe('Unit is not the active unit');
  });

  it('rejects moving an engaged unit away', () => {
    const state = moveState();
    state.units.find((u) => u.id === 'h1')!.status = ['engaged'];
    const action = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h1',
      path: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      finalPosition: { x: 1, y: 0, z: 0 },
    });
    expect(act(state, action).reason).toBe('Engaged units cannot move away');
  });

  it('rejects a move path that does not start at the unit position', () => {
    const state = moveState();
    const action = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h1',
      path: [{ x: 10, y: 0, z: 10 }, { x: 10, y: 0, z: 11 }],
      finalPosition: { x: 10, y: 0, z: 11 },
    });
    expect(act(state, action).reason).toBe('Move path must start at unit position');
  });
});

describe('applyAction: shoot', () => {
  function shootState(): GameState {
    const state = makeState([
      makeUnit('h1', HOST, { weapons: [weapon('rifle')] }),
      makeUnit('g1', GUEST, { position: { x: 0, y: 0, z: 10 } as Vector3 }),
    ]);
    state.turnState.activeUnitId = 'h1';
    state.units[0].isActivated = true;
    return state;
  }

  it('resolves an attack from server-rolled dice and logs the resolution', () => {
    const state = shootState();
    const action = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'rifle',
    });

    const specs = getDiceSpecs(state, action);
    expect(specs).toEqual([
      { count: 1, sides: 6, purpose: 'to-hit' },
      { count: 1, sides: 6, purpose: 'defense' },
    ]);

    // Q4: a 5 hits. D5: a 3 fails to block. One wound on a 1-wound fighter.
    const outcome = act(state, action, dice(1, [5], [3]));
    expect(outcome.ok).toBe(true);

    const target = outcome.state!.units.find((u) => u.id === 'g1')!;
    expect(target.wounds).toBe(0);
    expect(target.isDestroyed).toBe(true);

    const logEntry = outcome.state!.actionLog[0];
    expect(logEntry.dice).toBeDefined();
    expect(logEntry.dice!.outcome).toEqual({
      attackCount: 1,
      hitCount: 1,
      blockedCount: 0,
      wounds: 1,
      targetDestroyed: true,
    });
    expect(logEntry.dice!.context.attackerId).toBe('h1');
    expect(logEntry.dice!.context.targetId).toBe('g1');
    expect(logEntry.dice!.rollId).toBe(action.id);
  });

  it('applies a cover penalty to hit rolls', () => {
    const state = shootState();
    state.units[1].status = ['in-cover'];
    const action = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'rifle',
    });
    // Q4 in cover means 5+ is needed — a 4 misses.
    const outcome = act(state, action, dice(1, [4], [6]));
    expect(outcome.state!.actionLog[0].dice!.outcome.hitCount).toBe(0);
    expect(outcome.state!.units.find((u) => u.id === 'g1')!.wounds).toBe(1);
  });

  it('rejects shooting beyond weapon range', () => {
    const state = shootState();
    state.units[1].position = { x: 0, y: 0, z: 25 }; // rifle range 24
    const action = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'rifle',
    });
    expect(act(state, action, dice(1, [6], [1])).reason).toBe('Target out of range');
  });

  it('rejects shooting while engaged', () => {
    const state = shootState();
    state.units[0].status = ['engaged'];
    const action = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'rifle',
    });
    expect(act(state, action, dice(1, [6], [1])).reason).toBe(
      'Engaged units must fight instead of shooting'
    );
  });

  it('rejects shooting a friendly unit', () => {
    const state = shootState();
    state.units.push(makeUnit('h2', HOST, { position: { x: 0, y: 0, z: 10 } as Vector3 }));
    const action = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      targetId: 'h2',
      weaponId: 'rifle',
    });
    expect(act(state, action, dice(1, [6], [1])).reason).toBe('Target is not an enemy unit');
  });

  it('rejects shooting without dice results', () => {
    const state = shootState();
    const action = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'rifle',
    });
    expect(act(state, action).reason).toBe('Dice results required');
  });

  it('ends the game when the last enemy unit is destroyed', () => {
    const state = shootState(); // guest has exactly one unit
    const action = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'rifle',
    });
    const outcome = act(state, action, dice(1, [5], [3]));
    expect(outcome.state!.status).toBe('game-over');
    expect(outcome.state!.winner).toBe(HOST);
    expect(outcome.state!.turnState.phase).toBe('game-over');

    // Further actions are rejected.
    const after = createAction(GUEST, 'hold', { type: 'hold', unitId: 'g1' });
    expect(act(outcome.state!, after).reason).toBe('Game is over');
  });
});

describe('applyAction: charge', () => {
  function chargeState(): GameState {
    const state = makeState([
      makeUnit('h1', HOST, { weapons: [weapon('blade')] }),
      makeUnit('g1', GUEST, { position: { x: 0, y: 0, z: 5 } as Vector3 }),
    ]);
    state.turnState.activeUnitId = 'h1';
    state.units[0].isActivated = true;
    return state;
  }

  it('moves the charger into engagement and engages both units', () => {
    const state = chargeState();
    const action = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      path: [{ x: 0, y: 0, z: 4 }],
    });
    const outcome = act(state, action);

    expect(outcome.ok).toBe(true);
    const attacker = outcome.state!.units.find((u) => u.id === 'h1')!;
    const target = outcome.state!.units.find((u) => u.id === 'g1')!;
    // The charger ends at engagement distance 1 from the target.
    expect(attacker.position).toEqual({ x: 0, y: 0, z: 4 });
    expect(attacker.status).toContain('engaged');
    expect(target.status).toContain('engaged');
    expect(attacker.remainingMovement).toBe(0);
    expect(attacker.hasMoved).toBe(true);
  });

  it('rejects charging beyond the charger\'s speed', () => {
    const state = chargeState();
    state.units[1].position = { x: 0, y: 0, z: 12 }; // speed 6
    const action = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      path: [{ x: 0, y: 0, z: 11 }],
    });
    expect(act(state, action).reason).toBe('Target out of charge range');
  });

  it('rejects a charge that does not end in engagement range', () => {
    const state = chargeState();
    const action = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      path: [{ x: 0, y: 0, z: 1 }], // stops 4 units away
    });
    expect(act(state, action).reason).toBe('Charge must end in engagement range');
  });

  it('rejects charging while already engaged', () => {
    const state = chargeState();
    state.units[0].status = ['engaged'];
    const action = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      path: [{ x: 0, y: 0, z: 4 }],
    });
    expect(act(state, action).reason).toBe('Already engaged — fight instead');
  });
});

describe('applyAction: fight', () => {
  function fightState(): GameState {
    const state = makeState([
      makeUnit('h1', HOST, { weapons: [weapon('blade')], status: ['engaged'] as any, position: { x: 0, y: 0, z: 4 } as Vector3 }),
      makeUnit('g1', GUEST, { position: { x: 0, y: 0, z: 5 } as Vector3, status: ['engaged'] as any }),
    ]);
    state.turnState.activeUnitId = 'h1';
    state.units[0].isActivated = true;
    return state;
  }

  it('resolves a melee with server dice', () => {
    const state = fightState();
    const action = createAction(HOST, 'fight', {
      type: 'fight',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'blade',
    });
    const specs = getDiceSpecs(state, action);
    expect(specs).toEqual([
      { count: 2, sides: 6, purpose: 'to-hit' },
      { count: 2, sides: 6, purpose: 'defense' },
    ]);

    // Blade: 2 attacks. Rolls 6, 6 hit (Q4). Defense 5 blocks, 4 fails.
    const outcome = act(state, action, dice(2, [6, 6], [5, 4]));
    expect(outcome.state!.actionLog[0].dice!.outcome.wounds).toBe(1);
    expect(outcome.state!.units.find((u) => u.id === 'g1')!.wounds).toBe(0);
  });

  it('rejects fighting when not engaged', () => {
    const state = fightState();
    state.units[0].status = [];
    const action = createAction(HOST, 'fight', {
      type: 'fight',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'blade',
    });
    expect(act(state, action, dice(2, [6, 6], [6, 6])).reason).toBe('Unit is not engaged');
  });

  it('rejects fighting with a ranged weapon', () => {
    const state = fightState();
    state.units[0].weapons = [weapon('rifle')];
    const action = createAction(HOST, 'fight', {
      type: 'fight',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'rifle',
    });
    expect(act(state, action, dice(1, [6], [6])).reason).toBe('Unit has no such melee weapon');
  });

  it('clears engaged status on surviving units when their melee opponent is destroyed', () => {
    const state = makeState([
      makeUnit('h1', HOST, {
        weapons: [weapon('blade')],
        status: ['engaged'] as any,
        position: { x: 0, y: 0, z: 4 } as Vector3,
      }),
      makeUnit('g1', GUEST, {
        position: { x: 0, y: 0, z: 5 } as Vector3,
        status: ['engaged'] as any,
      }),
      makeUnit('g2', GUEST, {
        position: { x: 0, y: 0, z: 25 } as Vector3,
      }),
    ]);
    state.turnState.activeUnitId = 'h1';
    state.units[0].isActivated = true;

    const action = createAction(HOST, 'fight', {
      type: 'fight',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'blade',
    });
    const outcome = act(state, action, dice(2, [6, 6], [1, 1]));
    expect(outcome.ok).toBe(true);
    const attacker = outcome.state!.units.find((u) => u.id === 'h1')!;
    expect(attacker.status).not.toContain('engaged');
  });

  it('rejects a second attack in the same activation', () => {
    const state = fightState();
    state.units[1].wounds = 3;
    state.units[1].maxWounds = 3;
    const action = createAction(HOST, 'fight', {
      type: 'fight',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'blade',
    });
    const first = act(state, action, dice(2, [6, 6], [1, 6]));
    expect(first.ok).toBe(true);
    const second = act(first.state!, action, dice(2, [6, 6], [1, 1]));
    expect(second.reason).toBe('Unit has already attacked this activation');
  });
});

describe('applyAction: end-activation & end-round', () => {
  it('ends the activation and passes initiative', () => {
    const state = makeState([makeUnit('h1', HOST, { isActivated: true }), makeUnit('g1', GUEST)]);
    state.turnState.activeUnitId = 'h1';
    const action = createAction(HOST, 'end-activation', { type: 'end-activation' });
    const outcome = act(state, action);

    expect(outcome.state!.turnState.activeUnitId).toBeNull();
    expect(outcome.state!.turnState.currentPlayerId).toBe(GUEST);
  });

  it('automatically ends the round after the last activation', () => {
    const state = makeState([
      makeUnit('h1', HOST, { isActivated: true }),
      makeUnit('g1', GUEST, { isActivated: true }),
    ]);
    state.turnState.activeUnitId = 'g1';
    state.turnState.currentPlayerId = GUEST;
    const action = createAction(GUEST, 'end-activation', { type: 'end-activation' });
    const outcome = act(state, action);

    expect(outcome.state!.turnState.roundNumber).toBe(2);
    expect(outcome.state!.turnState.currentPlayerId).toBe(GUEST);
    expect(outcome.state!.turnState.startingPlayerId).toBe(GUEST);
    // Units reset for the new round.
    expect(outcome.state!.units.every((u) => !u.isActivated)).toBe(true);
  });

  it('rejects ending the activation when no unit is activating', () => {
    const state = makeState([makeUnit('h1', HOST), makeUnit('g1', GUEST)]);
    const action = createAction(HOST, 'end-activation', { type: 'end-activation' });
    expect(act(state, action).reason).toBe('No unit is activating');
  });

  it('rejects end-round while units remain unactivated', () => {
    const state = makeState([makeUnit('h1', HOST), makeUnit('g1', GUEST, { isActivated: true })]);
    const action = createAction(HOST, 'end-round', { type: 'end-round' });
    expect(act(state, action).reason).toBe('Round is not complete');
  });

  it('applies end-round when the round is complete', () => {
    const state = makeState([
      makeUnit('h1', HOST, { isActivated: true }),
      makeUnit('g1', GUEST, { isActivated: true }),
    ]);
    const action = createAction(HOST, 'end-round', { type: 'end-round' });
    const outcome = act(state, action);
    expect(outcome.state!.turnState.roundNumber).toBe(2);
  });
});

describe('applyAction invariants', () => {
  it('never mutates the input state', () => {
    const state = makeState([makeUnit('h1', HOST), makeUnit('g1', GUEST)]);
    const snapshot = JSON.stringify(state);
    const action = createAction(HOST, 'activate-unit', { type: 'activate-unit', unitId: 'h1' });
    act(state, action);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('keeps the state serializable after actions', () => {
    const state = makeState([
      makeUnit('h1', HOST, { weapons: [weapon('rifle')] }),
      makeUnit('g1', GUEST, { position: { x: 0, y: 0, z: 10 } as Vector3 }),
    ]);
    state.turnState.activeUnitId = 'h1';
    state.units[0].isActivated = true;
    const action = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'rifle',
    });
    const outcome = act(state, action, dice(1, [6], [2]));
    expect(() => JSON.stringify(outcome.state!)).not.toThrow();
    const roundTrip = JSON.parse(JSON.stringify(outcome.state!));
    expect(roundTrip).toEqual(outcome.state!);
  });

  it('reports the schema version', () => {
    const state = makeState([]);
    expect(state.version).toBe(SCHEMA_VERSION);
  });

  it('validates before dice are requested (validateAction + getDiceSpecs)', () => {
    const state = makeState([
      makeUnit('h1', HOST, { weapons: [weapon('rifle')] }),
      makeUnit('g1', GUEST, { position: { x: 0, y: 0, z: 30 } as Vector3 }),
    ]);
    state.turnState.activeUnitId = 'h1';
    state.units[0].isActivated = true;
    const action = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'rifle',
    });

    const validation = validateAction(state, action);
    expect(validation.valid).toBe(false);
    expect(validation.reason).toBe('Target out of range');
    // Hosts must not request dice for illegal actions.
    expect(getDiceSpecs(state, action)).toEqual([
      { count: 1, sides: 6, purpose: 'to-hit' },
      { count: 1, sides: 6, purpose: 'defense' },
    ]);
  });
});
