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
import { hasLineOfSight } from '../../src/engine/spatial';
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

describe('applyAction: deploy-unit', () => {
  it('places unit in deployment zone, sets isDeployed = true, and advances turn', () => {
    const state = makeState([
      makeUnit('h1', HOST, { isDeployed: false }),
      makeUnit('g1', GUEST, { isDeployed: false }),
    ]);
    state.turnState.phase = 'deployment';
    state.turnState.currentPlayerId = HOST;

    const action = createAction(HOST, 'deploy-unit', {
      type: 'deploy-unit',
      unitId: 'h1',
      position: { x: 0, y: 0, z: -12 },
    });

    const outcome = act(state, action);
    expect(outcome.ok).toBe(true);

    const placed = outcome.state!.units.find((u) => u.id === 'h1')!;
    expect(placed.isDeployed).toBe(true);
    expect(placed.position).toEqual({ x: 0, y: 0, z: -12 });
    expect(outcome.state!.turnState.currentPlayerId).toBe(GUEST);
  });

  it('rejects deployment when not the player turn', () => {
    const state = makeState([makeUnit('h1', HOST, { isDeployed: false })]);
    state.turnState.phase = 'deployment';
    state.turnState.currentPlayerId = GUEST;

    const action = createAction(HOST, 'deploy-unit', {
      type: 'deploy-unit',
      unitId: 'h1',
      position: { x: 0, y: 0, z: -12 },
    });

    const outcome = act(state, action);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('Not your turn');
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
    // Speed is 6, moved 5 -> 1 inch remains for a subsequent micro-move
    expect(unit.remainingMovement).toBe(1);

    // Second micro-move spending the remaining 1 inch
    const action2 = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h1',
      path: [
        { x: 3, y: 0, z: 4 },
        { x: 3, y: 0, z: 5 },
      ],
      finalPosition: { x: 3, y: 0, z: 5 },
    });
    const outcome2 = act(outcome.state!, action2);
    expect(outcome2.ok).toBe(true);
    const unit2 = outcome2.state!.units.find((u) => u.id === 'h1')!;
    expect(unit2.position).toEqual({ x: 3, y: 0, z: 5 });
    expect(unit2.remainingMovement).toBe(0);
  });

  it('rejects moving further than unit speed', () => {
    const state = moveState();
    const action = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h1',
      path: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 7 }],
      finalPosition: { x: 0, y: 0, z: 7 },
    });
    expect(act(state, action).reason).toBe('Move exceeds unit speed');
  });

  it('rejects moving when remaining movement is exhausted', () => {
    const state = moveState();
    state.units.find((u) => u.id === 'h1')!.remainingMovement = 0;
    const action = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h1',
      path: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 2 }],
      finalPosition: { x: 0, y: 0, z: 2 },
    });
    expect(act(state, action).reason).toBe('Unit has no remaining movement this activation');
  });

  it('supports move -> move -> shoot flow and closes movement window upon shooting', () => {
    const state = moveState();
    const h1 = state.units.find((u) => u.id === 'h1')!;
    h1.weapons = [weapon('rifle', { type: 'ranged', range: 24, attacks: 1 })];
    state.units.find((u) => u.id === 'g1')!.position = { x: 5, y: 0, z: 5 };

    // Move 1: 2.0"
    const move1 = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h1',
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      finalPosition: { x: 2, y: 0, z: 0 },
    });
    const s1 = act(state, move1).state!;
    expect(s1.units.find((u) => u.id === 'h1')!.remainingMovement).toBe(4);

    // Move 2: 1.5"
    const move2 = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h1',
      path: [
        { x: 2, y: 0, z: 0 },
        { x: 3.5, y: 0, z: 0 },
      ],
      finalPosition: { x: 3.5, y: 0, z: 0 },
    });
    const s2 = act(s1, move2).state!;
    expect(s2.units.find((u) => u.id === 'h1')!.remainingMovement).toBe(2.5);

    // Shoot target g1
    const shootAction = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'rifle',
    });
    const s3 = act(s2, shootAction, dice(1, [5], [5])).state!;
    const postShooter = s3.units.find((u) => u.id === 'h1')!;
    expect(postShooter.hasAttacked).toBe(true);
    // Shooting immediately closes movement window
    expect(postShooter.remainingMovement).toBe(0);

    // Further move is now rejected
    const move3 = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h1',
      path: [
        { x: 3.5, y: 0, z: 0 },
        { x: 4.5, y: 0, z: 0 },
      ],
      finalPosition: { x: 4.5, y: 0, z: 0 },
    });
    expect(act(s3, move3).reason).toBe('Unit has already moved or attacked this activation');
  });

  it('rejects moving if the unit has already attacked this activation', () => {
    const state = moveState();
    state.units.find((u) => u.id === 'h1')!.hasAttacked = true;
    const action = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h1',
      path: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 2 }],
      finalPosition: { x: 0, y: 0, z: 2 },
    });
    expect(act(state, action).reason).toBe('Unit has already moved or attacked this activation');
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

  it('translates all squad models rigidly when modelPositions is omitted', () => {
    const state = moveState();
    const unit = state.units.find((u) => u.id === 'h1')!;
    unit.models = [
      { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: 0 } },
      { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0.8, y: 0, z: 0 } },
    ];
    const action = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h1',
      path: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 4 }],
      finalPosition: { x: 0, y: 0, z: 4 },
    });
    const outcome = act(state, action);
    expect(outcome.ok).toBe(true);
    const moved = outcome.state!.units.find((u) => u.id === 'h1')!;
    expect(moved.position).toEqual({ x: 0, y: 0, z: 4 });
    expect(moved.models[0].position).toEqual({ x: 0, y: 0, z: 4 });
    expect(moved.models[1].position).toEqual({ x: 0.8, y: 0, z: 4 });
  });

  it('applies explicit coherent modelPositions and sets centroid', () => {
    const state = moveState();
    const unit = state.units.find((u) => u.id === 'h1')!;
    unit.models = [
      { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: 0 } },
      { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0.8, y: 0, z: 0 } },
    ];
    const explicitPositions: Vector3[] = [
      { x: 0, y: 0, z: 3 },
      { x: 0, y: 0, z: 3.7 },
    ];
    const action = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h1',
      path: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3.35 }],
      finalPosition: { x: 0, y: 0, z: 3.35 },
      modelPositions: explicitPositions,
    });
    const outcome = act(state, action);
    expect(outcome.ok).toBe(true);
    const moved = outcome.state!.units.find((u) => u.id === 'h1')!;
    expect(moved.position).toEqual({ x: 0, y: 0, z: 3.35 });
    expect(moved.models[0].position).toEqual({ x: 0, y: 0, z: 3 });
    expect(moved.models[1].position).toEqual({ x: 0, y: 0, z: 3.7 });
  });

  it('rejects move-unit when explicit modelPositions violate coherency', () => {
    const state = moveState();
    const unit = state.units.find((u) => u.id === 'h1')!;
    unit.models = [
      { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: 0 } },
      { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0.8, y: 0, z: 0 } },
    ];
    const incoherentPositions: Vector3[] = [
      { x: 0, y: 0, z: 3 },
      { x: 2.5, y: 0, z: 3 }, // 2.5" apart > 1.0"
    ];
    const action = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h1',
      path: [{ x: 0, y: 0, z: 0 }, { x: 1.25, y: 0, z: 3 }],
      finalPosition: { x: 1.25, y: 0, z: 3 },
      modelPositions: incoherentPositions,
    });
    const outcome = act(state, action);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain('exceeds 2" limit');
  });

  it('permits a multi-model squad to flank obstacles without centroid terrain collision false-positives', () => {
    const state = moveState();
    // Add a solid crate obstacle at x: 0, z: 2, extent [-0.5, 0.5] in x
    state.terrain = [
      {
        id: 'crate-center',
        terrainType: 'crate',
        position: { x: 0, y: 0, z: 2 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1.0, y: 1.0, z: 1.0 },
        blocksLineOfSight: true,
        providesCover: true,
        isObstacle: true,
      },
    ];
    const unit = state.units.find((u) => u.id === 'h1')!;
    unit.speed = 6;
    unit.position = { x: 0, y: 0, z: 0 };
    unit.models = [
      { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: -0.9, y: 0, z: 0 } },
      { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0.9, y: 0, z: 0 } },
    ];

    // Both models flank on either side of the crate (x: -0.9 and x: 0.9), staying coherent (1.8" <= 2.0")
    // Centroid line goes from (0, 0, 0) to (0, 0, 4) straight through the crate at (0, 0, 2)
    const flankingPositions: Vector3[] = [
      { x: -0.9, y: 0, z: 4 },
      { x: 0.9, y: 0, z: 4 },
    ];
    const flankingPaths: Vector3[][] = [
      [
        { x: -0.9, y: 0, z: 0 },
        { x: -0.9, y: 0, z: 4 },
      ],
      [
        { x: 0.9, y: 0, z: 0 },
        { x: 0.9, y: 0, z: 4 },
      ],
    ];

    const action = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h1',
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 4 },
      ],
      finalPosition: { x: 0, y: 0, z: 4 },
      modelPositions: flankingPositions,
      modelPaths: flankingPaths,
    });

    const outcome = act(state, action);
    expect(outcome.ok).toBe(true);
    const postUnit = outcome.state!.units.find((u) => u.id === 'h1')!;
    expect(postUnit.models[0].position).toEqual({ x: -0.9, y: 0, z: 4 });
    expect(postUnit.models[1].position).toEqual({ x: 0.9, y: 0, z: 4 });
  });

  it('rejects move-unit if an individual squad model path intersects an obstacle', () => {
    const state = moveState();
    state.terrain = [
      {
        id: 'crate-center',
        terrainType: 'crate',
        position: { x: 0, y: 0, z: 2 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1.0, y: 1.0, z: 1.0 },
        blocksLineOfSight: true,
        providesCover: true,
        isObstacle: true,
      },
    ];
    const unit = state.units.find((u) => u.id === 'h1')!;
    unit.speed = 6;
    unit.position = { x: 0.45, y: 0, z: 0 };
    unit.models = [
      { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: 0 } },
      { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0.9, y: 0, z: 0 } },
    ];

    // Model 1 moves straight through the crate at (0, 0, 2)
    const blockedPositions: Vector3[] = [
      { x: 0, y: 0, z: 4 },
      { x: 0.9, y: 0, z: 4 },
    ];
    const blockedPaths: Vector3[][] = [
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 4 },
      ],
      [
        { x: 0.9, y: 0, z: 0 },
        { x: 0.9, y: 0, z: 4 },
      ],
    ];

    const action = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h1',
      path: [
        { x: 0.45, y: 0, z: 0 },
        { x: 0.45, y: 0, z: 4 },
      ],
      finalPosition: { x: 0.45, y: 0, z: 4 },
      modelPositions: blockedPositions,
      modelPaths: blockedPaths,
    });

    const outcome = act(state, action);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain('Squad model 1 move path is blocked');
  });

  it('moves a multi-model squad successfully when constituent models start away from the squad centroid', () => {
    const state = moveState();
    const unit = state.units.find((u) => u.id === 'h1')!;
    unit.speed = 6;
    unit.position = { x: 0, y: 0, z: 0 };
    unit.remainingMovement = 6;
    unit.models = [
      { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: -0.9, y: 0, z: 0 } },
      { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0.9, y: 0, z: 0 } },
    ];

    const action = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h1',
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 3 },
      ],
      finalPosition: { x: 0, y: 0, z: 3 },
      modelPositions: [
        { x: -0.9, y: 0, z: 3 },
        { x: 0.9, y: 0, z: 3 },
      ],
      modelPaths: [
        [
          { x: -0.9, y: 0, z: 0 },
          { x: -0.9, y: 0, z: 3 },
        ],
        [
          { x: 0.9, y: 0, z: 0 },
          { x: 0.9, y: 0, z: 3 },
        ],
      ],
    });

    const outcome = act(state, action);
    expect(outcome.ok).toBe(true);
    const postUnit = outcome.state!.units.find((u) => u.id === 'h1')!;
    expect(postUnit.position).toEqual({ x: 0, y: 0, z: 3 });
    expect(postUnit.models[0].position).toEqual({ x: -0.9, y: 0, z: 3 });
    expect(postUnit.models[1].position).toEqual({ x: 0.9, y: 0, z: 3 });
    expect(postUnit.remainingMovement).toBe(3);
  });

  it('rushes a multi-model squad successfully with individual model paths and deducts double speed budget', () => {
    const state = moveState();
    const unit = state.units.find((u) => u.id === 'h1')!;
    unit.speed = 6;
    unit.position = { x: 0, y: 0, z: 0 };
    unit.remainingMovement = 6;
    unit.models = [
      { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: -0.8, y: 0, z: 0 } },
      { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0.8, y: 0, z: 0 } },
    ];

    const action = createAction(HOST, 'rush', {
      type: 'rush',
      unitId: 'h1',
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 8 },
      ],
      finalPosition: { x: 0, y: 0, z: 8 },
      modelPositions: [
        { x: -0.8, y: 0, z: 8 },
        { x: 0.8, y: 0, z: 8 },
      ],
      modelPaths: [
        [
          { x: -0.8, y: 0, z: 0 },
          { x: -0.8, y: 0, z: 8 },
        ],
        [
          { x: 0.8, y: 0, z: 0 },
          { x: 0.8, y: 0, z: 8 },
        ],
      ],
    });

    const outcome = act(state, action);
    expect(outcome.ok).toBe(true);
    const postUnit = outcome.state!.units.find((u) => u.id === 'h1')!;
    expect(postUnit.isRushing).toBe(true);
    expect(postUnit.hasAttacked).toBe(true);
    expect(postUnit.position).toEqual({ x: 0, y: 0, z: 8 });
    expect(postUnit.models[0].position).toEqual({ x: -0.8, y: 0, z: 8 });
    expect(postUnit.models[1].position).toEqual({ x: 0.8, y: 0, z: 8 });
    // Total rush budget was 12", moved 8", remaining budget is 4"
    expect(postUnit.remainingMovement).toBe(4);
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

  it('resolves multi-weapon firing with multiple weapons on a single target', () => {
    const state = shootState();
    // Add pistol to h1
    state.units[0].weapons.push({
      id: 'pistol',
      weaponType: 'pistol',
      name: 'Pistol',
      isEquipped: true,
      profile: { type: 'ranged', range: 12, attacks: 2, specialRules: [] },
    });
    // Add another enemy so game doesn't end immediately
    state.units.push(makeUnit('g2', GUEST, { position: { x: 5, y: 0, z: 10 } as Vector3 }));

    const action = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      allocations: [
        { weaponId: 'rifle', targetId: 'g1' },
        { weaponId: 'pistol', targetId: 'g1' },
      ],
    });

    const specs = getDiceSpecs(state, action)!;
    expect(specs.length).toBeGreaterThanOrEqual(4);
    expect(specs[0].purpose).toBe('alloc_0_to-hit');
    expect(specs[1].purpose).toBe('alloc_0_defense');

    const multiDice: DiceResult[] = [
      { rolls: [5], total: 5, finalTotal: 5, purpose: 'alloc_0_to-hit' },
      { rolls: [3], total: 3, finalTotal: 3, purpose: 'alloc_0_defense' }, // unsaved
      { rolls: [5, 6], total: 11, finalTotal: 11, purpose: 'alloc_1_to-hit' },
      { rolls: [5, 5], total: 10, finalTotal: 10, purpose: 'alloc_1_defense' }, // blocked
    ];

    const outcome = act(state, action, multiDice);
    expect(outcome.ok).toBe(true);
    const diceRes = outcome.state!.actionLog[0].dice!;
    expect(diceRes.outcome.allocations).toHaveLength(2);
    expect(diceRes.outcome.allocations![0].weaponId).toBe('rifle');
    expect(diceRes.outcome.allocations![0].wounds).toBe(1);
    expect(diceRes.outcome.allocations![1].weaponId).toBe('pistol');
    expect(diceRes.outcome.allocations![1].wounds).toBe(0);
    expect(diceRes.outcome.hitCount).toBe(3); // 1 + 2
    expect(diceRes.outcome.blockedCount).toBe(2); // 0 + 2
  });

  it('resolves split-fire across up to 2 distinct targets', () => {
    const state = shootState();
    state.units[0].weapons.push({
      id: 'pistol',
      weaponType: 'pistol',
      name: 'Pistol',
      isEquipped: true,
      profile: { type: 'ranged', range: 12, attacks: 1, specialRules: [] },
    });
    state.units.push(makeUnit('g2', GUEST, { position: { x: 5, y: 0, z: 10 } as Vector3 }));

    const action = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      allocations: [
        { weaponId: 'rifle', targetId: 'g1' },
        { weaponId: 'pistol', targetId: 'g2' },
      ],
    });

    const multiDice: DiceResult[] = [
      { rolls: [5], total: 5, finalTotal: 5, purpose: 'alloc_0_to-hit' },
      { rolls: [5], total: 5, finalTotal: 5, purpose: 'alloc_0_defense' },
      { rolls: [5], total: 5, finalTotal: 5, purpose: 'alloc_1_to-hit' },
      { rolls: [2], total: 2, finalTotal: 2, purpose: 'alloc_1_defense' },
    ];

    const outcome = act(state, action, multiDice);
    expect(outcome.ok).toBe(true);
    const diceRes = outcome.state!.actionLog[0].dice!;
    expect(diceRes.outcome.allocations).toHaveLength(2);
    expect(diceRes.outcome.allocations![0].targetId).toBe('g1');
    expect(diceRes.outcome.allocations![1].targetId).toBe('g2');
    expect(diceRes.outcome.allocations![1].wounds).toBe(1);
  });

  it('rejects split fire when more than 2 distinct targets are allocated', () => {
    const state = shootState();
    state.units[0].weapons.push(
      { id: 'w2', weaponType: 'pistol', name: 'W2', isEquipped: true, profile: { type: 'ranged', range: 12, attacks: 1, specialRules: [] } },
      { id: 'w3', weaponType: 'pistol', name: 'W3', isEquipped: true, profile: { type: 'ranged', range: 12, attacks: 1, specialRules: [] } }
    );
    state.units.push(
      makeUnit('g2', GUEST, { position: { x: 5, y: 0, z: 10 } as Vector3 }),
      makeUnit('g3', GUEST, { position: { x: -5, y: 0, z: 10 } as Vector3 })
    );

    const action = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      allocations: [
        { weaponId: 'rifle', targetId: 'g1' },
        { weaponId: 'w2', targetId: 'g2' },
        { weaponId: 'w3', targetId: 'g3' },
      ],
    });

    expect(act(state, action).reason).toBe('Cannot split fire across more than 2 distinct targets');
  });

  it('rejects allocating the same weapon multiple times in one salvo', () => {
    const state = shootState();
    state.units.push(makeUnit('g2', GUEST, { position: { x: 5, y: 0, z: 10 } as Vector3 }));

    const action = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      allocations: [
        { weaponId: 'rifle', targetId: 'g1' },
        { weaponId: 'rifle', targetId: 'g2' },
      ],
    });

    expect(act(state, action).reason).toBe('A weapon cannot be fired multiple times');
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

  it('charge initiates pendingReaction when defender survives with a melee weapon', () => {
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
    ];

    const outcome = applyAction(state, action, dice);
    expect(outcome.ok).toBe(true);

    const attacker = outcome.state!.units.find((u) => u.id === 'h1')!;
    const target = outcome.state!.units.find((u) => u.id === 'g1')!;

    // Charger is fatigued
    expect(attacker.status).toContain('fatigued');
    // Pending reaction is created awaiting target's decision
    const pending = outcome.state!.turnState.pendingReaction;
    expect(pending).toBeDefined();
    expect(pending?.type).toBe('melee-retaliation');
    expect(pending?.promptingPlayerId).toBe(GUEST);
    expect(pending?.sourceUnitId).toBe('h1');
    expect(pending?.targetUnitId).toBe('g1');
    expect(pending?.options.map((o) => o.id)).toEqual(['strike-back', 'decline']);

    // Charger remains in contact pending resolution
    expect(attacker.position.z).toBe(4);
    // Defender has not yet reacted, so defender is not yet fatigued (unless shaken)
    // Note: shaken is present from trauma, but fatigued status is added only upon striking back
    expect(target.status).not.toContain('fatigued');
  });

  it('respond-reaction with strike-back resolves retaliation and pushes charger back', () => {
    const state = chargeState();
    state.units[1].weapons = [weapon('blade')];

    const chargeAction = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      path: [{ x: 0, y: 0, z: 4 }],
    });

    const chargeDice: DiceResult[] = [
      { purpose: 'to-hit', rolls: [6, 5] } as any,
      { purpose: 'defense', rolls: [1, 2] } as any,
      { purpose: 'trauma', rolls: [1] } as any,
    ];

    const chargeOutcome = applyAction(state, chargeAction, chargeDice);
    expect(chargeOutcome.ok).toBe(true);
    const chargedState = chargeOutcome.state!;
    const reaction = chargedState.turnState.pendingReaction!;
    expect(reaction).toBeDefined();

    const respondAction = createAction(GUEST, 'respond-reaction', {
      type: 'respond-reaction',
      reactionId: reaction.id,
      choiceId: 'strike-back',
    });

    // Check dice specs required for strike back
    const specs = getDiceSpecs(chargedState, respondAction);
    expect(specs).toBeDefined();
    expect(specs?.some((s) => s.purpose === 'to-hit')).toBe(true);
    expect(specs?.some((s) => s.purpose === 'defense')).toBe(true);

    const retDice: DiceResult[] = [
      { purpose: 'to-hit', rolls: [6, 5] } as any, // Defender strikes back
      { purpose: 'defense', rolls: [6, 6] } as any, // Charger blocks
    ];

    const outcome = applyAction(chargedState, respondAction, retDice);
    expect(outcome.ok).toBe(true);

    const diceOut = outcome.logEntry.dice?.outcome;
    expect(diceOut?.hitCount).toBe(1); // Defender was shaken, hits on 6 only
    expect(diceOut?.blockedCount).toBe(1);
    expect(diceOut?.wounds).toBe(0);
    expect(diceOut?.pushedBack).toBe(true);

    const attacker = outcome.state!.units.find((u) => u.id === 'h1')!;
    const target = outcome.state!.units.find((u) => u.id === 'g1')!;

    // Charger pushed back to create >= 1.0" gap between models (target is at z = 5, charger pushed back to z = 3.0)
    expect(attacker.position.z).toBeCloseTo(3.0, 1);
    expect(Math.hypot(attacker.position.x - target.position.x, attacker.position.z - target.position.z)).toBeGreaterThanOrEqual(1.5);
    if (attacker.models && attacker.models.length > 0) {
      expect(attacker.models[0].position?.z).toBeCloseTo(attacker.position.z, 1);
    }

    // Both models become fatigued and are NOT locked in engaged status
    expect(attacker.status).toContain('fatigued');
    expect(target.status).toContain('fatigued');
    expect(attacker.status).not.toContain('engaged');
    expect(target.status).not.toContain('engaged');
    // Pending reaction cleared
    expect(outcome.state!.turnState.pendingReaction).toBeNull();
  });

  it('respond-reaction with decline avoids fatigue and pushes charger back without strikes', () => {
    const state = chargeState();
    state.units[1].weapons = [weapon('blade')];

    const chargeAction = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      path: [{ x: 0, y: 0, z: 4 }],
    });

    const chargeDice: DiceResult[] = [
      { purpose: 'to-hit', rolls: [5, 4] } as any,
      { purpose: 'defense', rolls: [5, 5] } as any, // 0 wounds, target untouched and not shaken
    ];

    const chargeOutcome = applyAction(state, chargeAction, chargeDice);
    expect(chargeOutcome.ok).toBe(true);
    const chargedState = chargeOutcome.state!;
    const reaction = chargedState.turnState.pendingReaction!;
    expect(reaction).toBeDefined();

    const declineAction = createAction(GUEST, 'respond-reaction', {
      type: 'respond-reaction',
      reactionId: reaction.id,
      choiceId: 'decline',
    });

    // Decline does not require dice
    const specs = getDiceSpecs(chargedState, declineAction);
    expect(specs).toBeNull();

    const outcome = applyAction(chargedState, declineAction);
    expect(outcome.ok).toBe(true);

    const diceOut = outcome.logEntry.dice?.outcome;
    expect(diceOut?.pushedBack).toBe(true);
    expect(diceOut?.hitCount).toBe(0);
    expect(diceOut?.wounds).toBe(0);

    const attacker = outcome.state!.units.find((u) => u.id === 'h1')!;
    const target = outcome.state!.units.find((u) => u.id === 'g1')!;

    // Charger pushed back
    expect(attacker.position.z).toBeCloseTo(3.0, 1);
    // Charger is fatigued from charging
    expect(attacker.status).toContain('fatigued');
    // Defender declined so defender is NOT fatigued!
    expect(target.status).not.toContain('fatigued');
    // Pending reaction cleared
    expect(outcome.state!.turnState.pendingReaction).toBeNull();
  });

  it('validates reaction permissions and blocks other actions while reaction is pending', () => {
    const state = chargeState();
    state.units[1].weapons = [weapon('blade')];

    const chargeAction = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      path: [{ x: 0, y: 0, z: 4 }],
    });

    const chargeDice: DiceResult[] = [
      { purpose: 'to-hit', rolls: [5, 4] } as any,
      { purpose: 'defense', rolls: [5, 5] } as any,
    ];

    const chargeOutcome = applyAction(state, chargeAction, chargeDice);
    const chargedState = chargeOutcome.state!;
    const reaction = chargedState.turnState.pendingReaction!;

    // 1. Host tries to take another action while reaction is pending -> rejected
    const endAct = createAction(HOST, 'end-activation', { type: 'end-activation' });
    const endVal = validateAction(chargedState, endAct);
    expect(endVal.valid).toBe(false);
    expect(endVal.reason).toContain('A reaction is pending');

    // 2. Host tries to respond to Guest's reaction -> rejected
    const hostReaction = createAction(HOST, 'respond-reaction', {
      type: 'respond-reaction',
      reactionId: reaction.id,
      choiceId: 'strike-back',
    });
    const hostVal = validateAction(chargedState, hostReaction);
    expect(hostVal.valid).toBe(false);
    expect(hostVal.reason).toContain('Not your reaction to respond to');

    // 3. Guest tries to respond with an invalid reactionId -> rejected
    const badIdReaction = createAction(GUEST, 'respond-reaction', {
      type: 'respond-reaction',
      reactionId: 'wrong-id',
      choiceId: 'strike-back',
    });
    const badIdVal = validateAction(chargedState, badIdReaction);
    expect(badIdVal.valid).toBe(false);
    expect(badIdVal.reason).toContain('No matching pending reaction');

    // 4. Guest tries to respond with an invalid choiceId -> rejected
    const badChoiceReaction = createAction(GUEST, 'respond-reaction', {
      type: 'respond-reaction',
      reactionId: reaction.id,
      choiceId: 'teleport',
    });
    const badChoiceVal = validateAction(chargedState, badChoiceReaction);
    expect(badChoiceVal.valid).toBe(false);
    expect(badChoiceVal.reason).toContain('Invalid reaction choice');
  });

  it('charge destroying target: no retaliation and no push-back', () => {
    const state = chargeState();
    state.units[1].weapons = [weapon('blade')];
    // Keep another enemy alive so match does not end immediately with game-over
    state.units.push(makeUnit('g2', GUEST, { position: { x: 10, y: 0, z: 10 } }));

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
    // Prompts victor for interactive 3.0" victory consolidation move
    expect(outcome.state!.turnState.pendingReaction).toBeDefined();
    expect(outcome.state!.turnState.pendingReaction?.type).toBe('melee-consolidation');
    expect(outcome.state!.turnState.pendingReaction?.promptingPlayerId).toBe(HOST);

    // Victor can consolidate up to 3.0" in any valid direction
    const consolidateAction = createAction(HOST, 'consolidate-move', {
      type: 'consolidate-move',
      unitId: attacker.id,
      path: [
        { x: 0, y: 0, z: 4 },
        { x: 0, y: 0, z: 6.5 },
      ],
    });
    const consOutcome = applyAction(outcome.state!, consolidateAction);
    expect(consOutcome.ok).toBe(true);
    expect(consOutcome.state!.units.find((u) => u.id === 'h1')!.position.z).toBeCloseTo(6.5, 1);
    expect(consOutcome.state!.turnState.pendingReaction).toBeNull();

    // Alternatively, victor can decline and stay put
    const stayAction = createAction(HOST, 'respond-reaction', {
      type: 'respond-reaction',
      reactionId: outcome.state!.turnState.pendingReaction!.id,
      choiceId: 'stay',
    });
    const stayOutcome = applyAction(outcome.state!, stayAction);
    expect(stayOutcome.ok).toBe(true);
    expect(stayOutcome.state!.units.find((u) => u.id === 'h1')!.position.z).toBe(4);
    expect(stayOutcome.state!.turnState.pendingReaction).toBeNull();
  });

  it('allows charging around an obstacle when there is no direct Line of Sight', () => {
    const state = chargeState();
    // Place a solid wall between attacker at (0, 0, 0) and target at (0, 0, 5)
    state.terrain = [
      {
        id: 'wall-1',
        terrainType: 'wall',
        position: { x: 0, y: 0, z: 2.5 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 4, y: 2, z: 0.5 },
        blocksLineOfSight: true,
        providesCover: true,
        isObstacle: true,
      },
    ];
    // Ensure direct Line of Sight is actually blocked
    expect(hasLineOfSight(state, state.units[0], state.units[1])).toBe(false);

    // Path routes around the wall to engagement range (0, 0, 4.2) of target at (0, 0, 5)
    const action = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      path: [
        { x: 3, y: 0, z: 1 },
        { x: 3, y: 0, z: 4 },
        { x: 0, y: 0, z: 4.2 },
      ],
    });
    const outcome = act(state, action, [
      { purpose: 'to-hit', rolls: [6, 5] } as any,
      { purpose: 'defense', rolls: [1, 2] } as any,
      { purpose: 'trauma', rolls: [1] } as any,
    ]);
    expect(outcome.ok).toBe(true);
    const target = outcome.state!.units.find((u) => u.id === 'g1')!;
    expect(target.status).toContain('shaken');
  });

  it('charging a defender with no melee weapon pushes charger back, leaves defender unfatigued, and clears engaged', () => {
    const state = chargeState();
    // Defender has only a ranged weapon
    state.units[1].weapons = [weapon('rifle')];
    state.units[1].wounds = 3;
    state.units[1].maxWounds = 3;
    state.units[1].specialRules = ['resilient(3)'];

    const action = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      path: [{ x: 0, y: 0, z: 4 }],
    });

    const outcome = act(state, action, dice(2, [6, 6], [6, 6]));
    expect(outcome.ok).toBe(true);

    const attacker = outcome.state!.units.find((u) => u.id === 'h1')!;
    const defender = outcome.state!.units.find((u) => u.id === 'g1')!;

    // Charger pushed back and is fatigued
    expect(attacker.status).toContain('fatigued');
    expect(attacker.status).not.toContain('engaged');
    // Defender never struck back: NOT fatigued, NOT engaged
    expect(defender.status).not.toContain('fatigued');
    expect(defender.status).not.toContain('engaged');
    expect(outcome.state!.turnState.pendingReaction).toBeUndefined();
  });

  it('getDiceSpecs for charge includes attacker attack dice and NOT defender retaliation dice', () => {
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
    expect(specs?.some((s) => s.purpose === 'retaliation-to-hit')).toBe(false);
    expect(specs?.some((s) => s.purpose === 'retaliation-defense')).toBe(false);
  });

  it('Phase 9B: defending squad members consolidate up to 3" into contact when charged', () => {
    const state = chargeState();
    const defender = state.units.find((u) => u.id === 'g1')!;
    // Target squad with front model at (0, 0, 5.0) and rear model at (0, 0, 5.8)
    // Centroid is (0, 0, 5.4)
    defender.models = [
      { id: 'gm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: 5.0 } },
      { id: 'gm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: 5.8 } },
    ];
    defender.position = { x: 0, y: 0, z: 5.4 };

    // Charger ends at z=4.5 (0.9" from defender centroid, <= 1.0" engagement range)
    const action = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      path: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 4.5 }],
      weaponId: 'blade',
    });

    const diceResults: DiceResult[] = [
      { purpose: 'to-hit', rolls: [1, 1] } as any, // Misses
      { purpose: 'defense', rolls: [6, 6] } as any,
      { purpose: 'trauma', rolls: [1] } as any,
    ];

    const outcome = applyAction(state, action, diceResults);
    expect(outcome.ok).toBe(true);

    const postDefender = outcome.state!.units.find((u) => u.id === 'g1')!;
    // Front model was already at z=5.0 (0.5" from charger at z=4.5) -> <= 1.0" so stays in place
    expect(postDefender.models[0].position?.z).toBeCloseTo(5.0, 1);
    // Rear model was at z=5.8 (1.3" from charger at z=4.5) -> consolidates into base contact (z=5.1)
    expect(postDefender.models[1].position?.z).toBeLessThan(5.8);
    expect(postDefender.models[1].position?.z).toBeCloseTo(5.1, 1);
  });
});

describe('applyAction: rush', () => {
  it('allows moving up to double speed, tracks remaining rush movement, and prohibits shooting', () => {
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
    expect(unit.isRushing).toBe(true);
    // Double speed is 12, moved 10 -> 2 inches remain
    expect(unit.remainingMovement).toBe(2);

    // Second rush move spending the remaining 2 inches
    const action2 = createAction(HOST, 'rush', {
      type: 'rush',
      unitId: 'h1',
      path: [{ x: 12, y: 0, z: 0 }],
      finalPosition: { x: 12, y: 0, z: 0 },
    });
    const outcome2 = act(outcome.state!, action2);
    expect(outcome2.ok).toBe(true);
    const unit2 = outcome2.state!.units.find((u) => u.id === 'h1')!;
    expect(unit2.position.x).toBe(12);
    expect(unit2.remainingMovement).toBe(0);

    // Rushing unit cannot shoot
    const shootAction = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'blade',
    });
    expect(act(outcome2.state!, shootAction).reason).toBe('Unit has already attacked this activation');
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

  it('Phase 9B: multi-model squad casualty cascade and centroid recomputation', () => {
    // 3-model squad: m1 at (0, 0, 10), m2 at (0.7, 0, 10), m3 at (1.4, 0, 10) -> Centroid is (0.7, 0, 10)
    const state = makeState([
      makeUnit('h1', HOST, { weapons: [weapon('rifle')] }),
      makeUnit('g-squad', GUEST, {
        position: { x: 0.7, y: 0, z: 10 } as Vector3,
        wounds: 3,
        maxWounds: 3,
        models: [
          { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: 10 } },
          { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0.7, y: 0, z: 10 } },
          { id: 'm3', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 1.4, y: 0, z: 10 } },
        ],
      }),
    ]);
    state.turnState.activeUnitId = 'h1';
    state.units[0].isActivated = true;

    const shootAction = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      targetId: 'g-squad',
      weaponId: 'rifle',
    });

    // 1st wound: eliminates m1 outright. 2 models remain (m2 at 0.7, m3 at 1.4 -> centroid moves to 1.05)
    const shot1 = act(state, shootAction, [
      { rolls: [5], total: 5, finalTotal: 5, purpose: 'to-hit' },
      { rolls: [1], total: 1, finalTotal: 1, purpose: 'defense' },
      { rolls: [6], total: 6, finalTotal: 6, purpose: 'trauma' },
    ]);
    const squad1 = shot1.state!.units.find((u) => u.id === 'g-squad')!;
    expect(squad1.isDestroyed).toBe(false);
    expect(squad1.models.filter((m) => !m.isDestroyed)).toHaveLength(2);
    expect(squad1.models[0].isDestroyed).toBe(true);
    expect(squad1.wounds).toBe(2);
    expect(squad1.position.x).toBeCloseTo(1.05, 2);
    expect(shot1.logEntry.dice?.outcome.traumaRoll).toBeUndefined(); // No trauma rolled!

    // 2nd wound: eliminates m2 outright. Only m3 remains at 1.4
    shot1.state!.units[0].hasAttacked = false;
    const shot2 = act(shot1.state!, shootAction, [
      { rolls: [5], total: 5, finalTotal: 5, purpose: 'to-hit' },
      { rolls: [1], total: 1, finalTotal: 1, purpose: 'defense' },
      { rolls: [6], total: 6, finalTotal: 6, purpose: 'trauma' },
    ]);
    const squad2 = shot2.state!.units.find((u) => u.id === 'g-squad')!;
    expect(squad2.isDestroyed).toBe(false);
    expect(squad2.models.filter((m) => !m.isDestroyed)).toHaveLength(1);
    expect(squad2.wounds).toBe(1);
    expect(squad2.position.x).toBeCloseTo(1.4, 2);
    expect(shot2.logEntry.dice?.outcome.traumaRoll).toBeUndefined(); // Still no trauma rolled!

    // 3rd wound: strikes final surviving model (m3). Trauma roll = 6 + 1 token = 7 >= 6 -> Knocked Out!
    shot2.state!.units[0].hasAttacked = false;
    const shot3 = act(shot2.state!, shootAction, [
      { rolls: [5], total: 5, finalTotal: 5, purpose: 'to-hit' },
      { rolls: [1], total: 1, finalTotal: 1, purpose: 'defense' },
      { rolls: [6], total: 6, finalTotal: 6, purpose: 'trauma' },
    ]);
    const squad3 = shot3.state!.units.find((u) => u.id === 'g-squad')!;
    expect(squad3.isDestroyed).toBe(true);
    expect(squad3.models.every((m) => m.isDestroyed)).toBe(true);
    expect(shot3.logEntry.dice?.outcome.traumaOutcome).toBe('knocked-out');
  });

  it('Tough(3) / Resilient(3) accumulates wounds without rolling until 3 wounds, and uses KO threshold 8+', () => {
    const state = makeState([
      makeUnit('h1', HOST, { weapons: [weapon('carbine')] }),
      makeUnit('g-boss', GUEST, {
        position: { x: 0, y: 0, z: 10 } as Vector3,
        wounds: 3,
        maxWounds: 3,
        specialRules: ['resilient(3)'],
      }),
    ]);
    state.turnState.activeUnitId = 'h1';
    state.units[0].isActivated = true;

    const shootAction = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      targetId: 'g-boss',
      weaponId: 'carbine',
    });

    // 1st attack: deals 2 wounds with carbine (2 attacks). 2 < 3 Tough -> No wound effect roll, boss takes 2 wounds.
    const shot1 = act(state, shootAction, [
      { rolls: [5, 5], total: 10, finalTotal: 10, purpose: 'to-hit' },
      { rolls: [1, 1], total: 2, finalTotal: 2, purpose: 'defense' },
      { rolls: [6], total: 6, finalTotal: 6, purpose: 'trauma' }, // Even with high roll, no check triggered
    ]);
    const bossAfter1 = shot1.state!.units.find((u) => u.id === 'g-boss')!;
    expect(bossAfter1.isDestroyed).toBe(false);
    expect(bossAfter1.wounds).toBe(1); // 3 - 2 = 1 HP remaining
    expect(bossAfter1.traumaTokens).toBe(2); // 2 wounds taken
    expect(bossAfter1.status).not.toContain('shaken');
    expect(shot1.logEntry.dice?.outcome.traumaRoll).toBeUndefined();

    // 2nd attack: deals 1 more wound (now 3 total >= 3 Tough).
    // Roll is 4: 4 + 3 = 7 < 8 (need 8+ to KO) -> Shaken, survives!
    shot1.state!.units[0].hasAttacked = false;
    const shot2 = act(shot1.state!, shootAction, [
      { rolls: [5, 1], total: 6, finalTotal: 6, purpose: 'to-hit' },
      { rolls: [1, 1], total: 2, finalTotal: 2, purpose: 'defense' },
      { rolls: [4], total: 4, finalTotal: 4, purpose: 'trauma' },
    ]);
    const bossAfter2 = shot2.state!.units.find((u) => u.id === 'g-boss')!;
    expect(bossAfter2.isDestroyed).toBe(false);
    expect(bossAfter2.status).toContain('shaken');
    expect(bossAfter2.traumaTokens).toBe(3);
    expect(shot2.logEntry.dice?.outcome.traumaRoll).toBe(4);
    expect(shot2.logEntry.dice?.outcome.traumaTotal).toBe(7);
    expect(shot2.logEntry.dice?.outcome.traumaOutcome).toBe('shaken');

    // 3rd attack: deals 1 more wound (now 4 total).
    // Roll is 4: 4 + 4 = 8 >= 8 -> Knocked out!
    shot2.state!.units[0].hasAttacked = false;
    const shot3 = act(shot2.state!, shootAction, [
      { rolls: [5, 1], total: 6, finalTotal: 6, purpose: 'to-hit' },
      { rolls: [1, 1], total: 2, finalTotal: 2, purpose: 'defense' },
      { rolls: [4], total: 4, finalTotal: 4, purpose: 'trauma' },
    ]);
    const bossAfter3 = shot3.state!.units.find((u) => u.id === 'g-boss')!;
    expect(bossAfter3.isDestroyed).toBe(true);
    expect(shot3.logEntry.dice?.outcome.traumaOutcome).toBe('knocked-out');
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
