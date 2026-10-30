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

  it('updates unit rotation.y toward the direction of movement', () => {
    const state = moveState();
    // Move from (0,0,0) to (3,0,0) -> +X direction -> yaw = Math.atan2(3, 0) = PI/2
    const action = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h1',
      path: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }],
      finalPosition: { x: 3, y: 0, z: 0 },
    });
    const outcome = act(state, action);
    expect(outcome.ok).toBe(true);
    const moved = outcome.state!.units.find((u) => u.id === 'h1')!;
    expect(moved.rotation.y).toBeCloseTo(Math.PI / 2);
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
      { count: 1, sides: 6, purpose: 'trauma' },
    ]);

    // Q4: a 5 hits. D5: a 3 fails to block. One wound on a 1-wound fighter.
    const outcome = act(state, action, dice(1, [5], [3]));
    expect(outcome.ok).toBe(true);

    const target = outcome.state!.units.find((u) => u.id === 'g1')!;
    expect(target.wounds).toBe(0);
    expect(target.isDestroyed).toBe(true);

    const logEntry = outcome.state!.actionLog[0];
    expect(logEntry.dice).toBeDefined();
    expect(logEntry.dice!.outcome).toMatchObject({
      attackCount: 1,
      hitCount: 1,
      blockedCount: 0,
      wounds: 1,
      targetDestroyed: true,
    });
    expect(logEntry.dice!.context.attackerId).toBe('h1');
    expect(logEntry.dice!.context.targetId).toBe('g1');
    expect(logEntry.dice!.rollId).toBe(action.id);
    const attacker = outcome.state!.units.find((u) => u.id === 'h1')!;
    expect(attacker.rotation.y).toBeCloseTo(0);
  });

  it('applies a +1 Defense bonus when the target is in cover', () => {
    const state = shootState();
    state.units[1].status = ['in-cover'];
    const action = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'rifle',
    });
    // D5+ in cover blocks on 4+ (4 + 1 >= 5).
    const outcome = act(state, action, dice(1, [4], [4]));
    expect(outcome.state!.actionLog[0].dice!.outcome.hitCount).toBe(1);
    expect(outcome.state!.actionLog[0].dice!.outcome.blockedCount).toBe(1);
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

function chargeState(): GameState {
  const state = makeState([
    makeUnit('h1', HOST, { weapons: [weapon('blade')] }),
    makeUnit('g1', GUEST, { position: { x: 0, y: 0, z: 5 } as Vector3 }),
  ]);
  state.turnState.activeUnitId = 'h1';
  state.units[0].isActivated = true;
  return state;
}

describe('applyAction: charge', () => {

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

  it('rejects charging beyond the charger\'s double speed', () => {
    const state = chargeState();
    state.units[1].position = { x: 0, y: 0, z: 15 }; // speed 6, double speed 12
    const action = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      path: [{ x: 0, y: 0, z: 14 }],
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

  it('charge with dice rolls automatically resolves melee attack against target', () => {
    const state = chargeState();
    const action = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      path: [{ x: 0, y: 0, z: 4 }],
    });
    const dice: DiceResult[] = [
      { purpose: 'to-hit', rolls: [6, 5] } as any,
      { purpose: 'defense', rolls: [1, 2] } as any,
      { purpose: 'trauma', rolls: [1] } as any,
    ];
    const outcome = applyAction(state, action, dice);
    expect(outcome.ok).toBe(true);
    expect(outcome.logEntry.dice).toBeDefined();
    expect(outcome.logEntry.dice?.outcome.hitCount).toBe(2);
    expect(outcome.logEntry.dice?.outcome.wounds).toBe(2);
    const target = outcome.state!.units.find((u) => u.id === 'g1')!;
    expect(target.status).toContain('shaken');
  });

  it('charge with defender retaliation and push-back separation when both survive', () => {
    const state = chargeState();
    // Give defender an equipped melee weapon so they can retaliate
    state.units[1].weapons = [weapon('blade')];

    const action = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      path: [{ x: 0, y: 0, z: 4 }],
    });

    const dice: DiceResult[] = [
      { purpose: 'to-hit', rolls: [6, 5] } as any,
      { purpose: 'defense', rolls: [1, 2] } as any,
      { purpose: 'trauma', rolls: [1] } as any, // Target takes wounds + shaken (survives)
      { purpose: 'retaliation-to-hit', rolls: [6, 5] } as any,
      { purpose: 'retaliation-defense', rolls: [6, 6] } as any, // Charger blocks retaliation
    ];

    const outcome = applyAction(state, action, dice);
    expect(outcome.ok).toBe(true);

    const diceOut = outcome.logEntry.dice?.outcome;
    expect(diceOut?.retaliation).toBeDefined();
    // Defender became shaken from the charge wounds, so they strike back fatigued (hitting on 6s only).
    // Given rolls [6, 5], only the natural 6 hits.
    expect(diceOut?.retaliation?.hitCount).toBe(1);
    expect(diceOut?.retaliation?.blockedCount).toBe(1);
    expect(diceOut?.retaliation?.wounds).toBe(0);
    expect(diceOut?.pushedBack).toBe(true);

    const attacker = outcome.state!.units.find((u) => u.id === 'h1')!;
    const target = outcome.state!.units.find((u) => u.id === 'g1')!;

    // Charger pushed back to create >= 1.0" gap between models (target is at z = 5, charger pushed back to z = 3.0)
    expect(attacker.position.z).toBeCloseTo(3.0, 1);
    expect(Math.hypot(attacker.position.x - target.position.x, attacker.position.z - target.position.z)).toBeGreaterThanOrEqual(1.5);

    // Both models become fatigued and are NOT locked in engaged status
    expect(attacker.status).toContain('fatigued');
    expect(target.status).toContain('fatigued');
    expect(attacker.status).not.toContain('engaged');
    expect(target.status).not.toContain('engaged');
  });

  it('charge destroying target: no retaliation and no push-back', () => {
    const state = chargeState();
    state.units[1].weapons = [weapon('blade')];

    const action = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      path: [{ x: 0, y: 0, z: 4 }],
    });

    const dice: DiceResult[] = [
      { purpose: 'to-hit', rolls: [6, 6] } as any,
      { purpose: 'defense', rolls: [1, 1] } as any,
      { purpose: 'trauma', rolls: [6] } as any, // 6 = Knocked Out
    ];

    const outcome = applyAction(state, action, dice);
    expect(outcome.ok).toBe(true);

    const diceOut = outcome.logEntry.dice?.outcome;
    expect(diceOut?.targetDestroyed).toBe(true);
    expect(diceOut?.retaliation).toBeUndefined();
    expect(diceOut?.pushedBack).toBe(false);

    const attacker = outcome.state!.units.find((u) => u.id === 'h1')!;
    const target = outcome.state!.units.find((u) => u.id === 'g1')!;
    expect(target.isDestroyed).toBe(true);
    expect(attacker.position.z).toBe(4); // Did not push back
    expect(attacker.status).toContain('fatigued');
  });

  it('getDiceSpecs for charge includes attacker attack dice and defender retaliation dice', () => {
    const state = chargeState();
    state.units[1].weapons = [weapon('blade')];

    const action = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      path: [{ x: 0, y: 0, z: 4 }],
    });

    const specs = getDiceSpecs(state, action);
    expect(specs).toBeDefined();
    expect(specs?.some((s) => s.purpose === 'to-hit')).toBe(true);
    expect(specs?.some((s) => s.purpose === 'defense')).toBe(true);
    expect(specs?.some((s) => s.purpose === 'retaliation-to-hit')).toBe(true);
    expect(specs?.some((s) => s.purpose === 'retaliation-defense')).toBe(true);
  });
});

describe('applyAction: rush', () => {
  it('allows moving up to double speed and finishes activation without attacks', () => {
    const state = chargeState();
    const action = createAction(HOST, 'rush', {
      type: 'rush',
      unitId: 'h1',
      path: [{ x: 10, y: 0, z: 0 }],
      finalPosition: { x: 10, y: 0, z: 0 },
    });
    const outcome = act(state, action);
    expect(outcome.ok).toBe(true);
    const unit = outcome.state!.units.find((u) => u.id === 'h1')!;
    expect(unit.position.x).toBe(10);
    expect(unit.hasMoved).toBe(true);
    expect(unit.hasAttacked).toBe(true);
    expect(unit.remainingMovement).toBe(0);
  });

  it('rejects rush exceeding double speed', () => {
    const state = chargeState();
    const action = createAction(HOST, 'rush', {
      type: 'rush',
      unitId: 'h1',
      path: [{ x: 0, y: 0, z: 14 }],
      finalPosition: { x: 0, y: 0, z: 14 },
    });
    const outcome = act(state, action);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain('Rush distance exceeds double speed');
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
      { count: 1, sides: 6, purpose: 'trauma' },
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

  it('automatically ends the round after the last activation and gives first turn to the other player', () => {
    const state = makeState([
      makeUnit('h1', HOST, { isActivated: true }),
      makeUnit('g1', GUEST, { isActivated: true }),
    ]);
    state.turnState.activeUnitId = 'g1';
    state.turnState.currentPlayerId = GUEST;
    const action = createAction(GUEST, 'end-activation', { type: 'end-activation' });
    const outcome = act(state, action);

    expect(outcome.state!.turnState.roundNumber).toBe(2);
    // GUEST took the final activation of Round 1, so HOST (who finished
    // activating first) gets the first turn of Round 2.
    expect(outcome.state!.turnState.currentPlayerId).toBe(HOST);
    expect(outcome.state!.turnState.startingPlayerId).toBe(HOST);
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
      { count: 1, sides: 6, purpose: 'trauma' },
    ]);
  });

  it('resolves Trauma Table (1-5 Suppressed/Shaken, 6+ Knocked Out) and multi-model squad casualties', () => {
    const state = makeState([
      makeUnit('h1', HOST, { weapons: [weapon('rifle')] }),
      makeUnit('g1', GUEST, {
        position: { x: 0, y: 0, z: 10 } as Vector3,
        wounds: 2,
        maxWounds: 2,
        models: [
          { id: 'g1-m1', wounds: 1, maxWounds: 1, isDestroyed: false },
          { id: 'g1-m2', wounds: 1, maxWounds: 1, isDestroyed: false },
        ],
      }),
    ]);
    state.turnState.activeUnitId = 'h1';
    state.units[0].isActivated = true;

    const shootAction = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'rifle',
    });

    // 1st wound eliminates the first squad member without rolling trauma on the survivor.
    const firstShot = act(state, shootAction, [
      { rolls: [5], total: 5, finalTotal: 5, purpose: 'to-hit' },
      { rolls: [1], total: 1, finalTotal: 1, purpose: 'defense' },
      { rolls: [6], total: 6, finalTotal: 6, purpose: 'trauma' },
    ]);
    const g1After1 = firstShot.state!.units.find((u) => u.id === 'g1')!;
    expect(g1After1.models.filter((m) => !m.isDestroyed)).toHaveLength(1);
    expect(g1After1.isDestroyed).toBe(false);

    // 2nd wound hits the last survivor; trauma roll of 3 (+1 token = 4 <= 5) -> Shaken (survives!).
    firstShot.state!.units[0].hasAttacked = false;
    const secondShot = act(firstShot.state!, shootAction, [
      { rolls: [5], total: 5, finalTotal: 5, purpose: 'to-hit' },
      { rolls: [1], total: 1, finalTotal: 1, purpose: 'defense' },
      { rolls: [3], total: 3, finalTotal: 3, purpose: 'trauma' },
    ]);
    const g1After2 = secondShot.state!.units.find((u) => u.id === 'g1')!;
    expect(g1After2.isDestroyed).toBe(false);
    expect(g1After2.status).toContain('shaken');
    expect(g1After2.status).toContain('stunned');
    expect(g1After2.traumaTokens).toBe(1);

    // 3rd wound hits the last survivor; trauma roll of 4 (+2 tokens = 6 >= 6) -> Knocked Out!
    secondShot.state!.units[0].hasAttacked = false;
    const thirdShot = act(secondShot.state!, shootAction, [
      { rolls: [5], total: 5, finalTotal: 5, purpose: 'to-hit' },
      { rolls: [1], total: 1, finalTotal: 1, purpose: 'defense' },
      { rolls: [4], total: 4, finalTotal: 4, purpose: 'trauma' },
    ]);
    const g1After3 = thirdShot.state!.units.find((u) => u.id === 'g1')!;
    expect(g1After3.isDestroyed).toBe(true);
  });

  it('allows Lobbed (Indirect) weapons to fire without Line of Sight', () => {
    const state = makeState([
      makeUnit('h1', HOST, { weapons: [weapon('trench-mortar')] }),
      makeUnit('g1', GUEST, { position: { x: 0, y: 0, z: 10 } as Vector3 }),
    ]);
    state.terrain = [
      {
        id: 'wall-blocker',
        terrainType: 'wall',
        position: { x: 0, y: 0, z: 5 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 4, y: 2, z: 0.5 },
        blocksLineOfSight: true,
        providesCover: true,
        isObstacle: true,
      },
    ];
    state.turnState.activeUnitId = 'h1';
    state.units[0].isActivated = true;

    const shootAction = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'trench-mortar',
    });
    expect(validateAction(state, shootAction).valid).toBe(true);
  });

  it('triggers Round-End Army Morale when an army is Broken (<= 50% starting units)', () => {
    const state = makeState([
      makeUnit('h1', HOST, { isActivated: true }),
      makeUnit('h2', HOST, { isActivated: true }),
      makeUnit('g1', GUEST, { isActivated: true, isDestroyed: true }),
      makeUnit('g2', GUEST, { isActivated: true, quality: 5, status: ['shaken', 'stunned'] as any }),
    ]);
    const endRoundAction = createAction(HOST, 'end-round', { type: 'end-round' });
    const specs = getDiceSpecs(state, endRoundAction);
    expect(specs).toEqual([{ count: 1, sides: 6, purpose: 'morale' }]);

    // g2 is already shaken when its army is broken -> auto-fails morale and routs!
    const outcome = act(state, endRoundAction, [
      { rolls: [6], total: 6, finalTotal: 6, purpose: 'morale' },
    ]);
    const g2After = outcome.state!.units.find((u) => u.id === 'g2')!;
    expect(g2After.status).toContain('routed');
    expect(g2After.isDestroyed).toBe(true);
    expect(outcome.state!.status).toBe('game-over');
    expect(outcome.state!.winner).toBe(HOST);
  });
});
