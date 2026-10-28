import { describe, it, expect } from 'vitest';
import { createInitialGameState, cloneGameState, isGameStateSerializable, createAction, validateActionBasic } from '../src/gameState';
import { GameState, Unit, Vector3 } from '../src/gameTypes';

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'u1',
    ownerId: 'h1',
    armyId: 'army-host',
    unitType: 'trooper',
    name: 'Trooper One',
    quality: 3,
    defense: 4,
    speed: 6,
    position: { x: 0, y: 0, z: 0 } as Vector3,
    rotation: { x: 0, y: 0, z: 0 } as Vector3,
    status: [],
    wounds: 1,
    maxWounds: 1,
    isActivated: false,
    isDestroyed: false,
    models: [],
    weapons: [],
    specialRules: [],
    hasMoved: false,
    remainingMovement: 6,
    ...overrides,
  };
}

describe('gameState', () => {
  it('should create initial game state with alternating-activation setup', () => {
    const state = createInitialGameState('host1', 'guest1');
    expect(state.hostId).toBe('host1');
    expect(state.guestId).toBe('guest1');
    expect(state.status).toBe('setting-up');
    expect(state.turnState.phase).toBe('setup');
    expect(state.turnState.roundNumber).toBe(1);
    expect(state.turnState.currentPlayerId).toBe('host1');
    expect(state.turnState.startingPlayerId).toBe('host1');
    expect(state.turnState.unitsActivatedThisRound).toEqual([]);
    expect(state.units).toEqual([]);
    expect(state.actionLog).toEqual([]);
    expect(state.version).toBe('2.1.0');
  });

  it('should create game state with custom player names', () => {
    const state = createInitialGameState('h1', 'g1', 'Alice', 'Bob');
    expect(state.players[0].name).toBe('Alice');
    expect(state.players[1].name).toBe('Bob');
    expect(state.players[0].role).toBe('host');
    expect(state.players[1].role).toBe('guest');
  });

  it('should clone game state deeply', () => {
    const state = createInitialGameState('h1', 'g1');
    const cloned = cloneGameState(state);
    expect(cloned).toEqual(state);
    expect(cloned).not.toBe(state);
    cloned.units.push({ id: 'u1' } as any);
    expect(state.units.length).toBe(0);
  });

  it('should validate serializable game state', () => {
    const state = createInitialGameState('h1', 'g1');
    expect(isGameStateSerializable(state)).toBe(true);

    const serialized = JSON.stringify(state);
    const parsed = JSON.parse(serialized);
    expect(parsed.gameId).toBe(state.gameId);
  });

  it('should create action with correct structure', () => {
    const action = createAction('player1', 'end-round', { type: 'end-round' });
    expect(action.actorId).toBe('player1');
    expect(action.type).toBe('end-round');
    expect(action.payload.type).toBe('end-round');
    expect(action.id).toBeDefined();
    expect(typeof action.id).toBe('string');
    expect(action.timestamp).toBeDefined();
    expect(typeof action.timestamp).toBe('number');
  });

  describe('validateActionBasic - general checks', () => {
    it('should validate action from known player', () => {
      const state = createInitialGameState('h1', 'g1');
      const action = createAction('h1', 'end-round', { type: 'end-round' });
      const result = validateActionBasic(action, state);
      expect(result.valid).toBe(true);
    });

    it('should reject action from unknown player', () => {
      const state = createInitialGameState('h1', 'g1');
      const action = createAction('unknown', 'end-round', { type: 'end-round' });
      const result = validateActionBasic(action, state);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Unknown actor');
    });

    it('should reject action when game is over', () => {
      const state = createInitialGameState('h1', 'g1');
      state.status = 'game-over';
      const action = createAction('h1', 'end-round', { type: 'end-round' });
      const result = validateActionBasic(action, state);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Game is over');
    });

    it('should reject action when it is not the player turn', () => {
      const state = createInitialGameState('h1', 'g1');
      const action = createAction('g1', 'end-round', { type: 'end-round' });
      const result = validateActionBasic(action, state);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Not your turn');
    });

    it('should allow action when it is the player turn', () => {
      const state = createInitialGameState('h1', 'g1');
      state.turnState.currentPlayerId = 'g1';
      const action = createAction('g1', 'end-round', { type: 'end-round' });
      const result = validateActionBasic(action, state);
      expect(result.valid).toBe(true);
    });
  });

  describe('validateActionBasic - unit activation checks', () => {
    it('should reject action targeting an unknown unit', () => {
      const state = createInitialGameState('h1', 'g1');
      state.units = [makeUnit()];
      const action = createAction('h1', 'activate-unit', { type: 'activate-unit', unitId: 'missing' });
      const result = validateActionBasic(action, state);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Unknown unit');
    });

    it('should reject action targeting a unit owned by the other player', () => {
      const state = createInitialGameState('h1', 'g1');
      state.units = [makeUnit({ id: 'enemy', ownerId: 'g1' })];
      const action = createAction('h1', 'activate-unit', { type: 'activate-unit', unitId: 'enemy' });
      const result = validateActionBasic(action, state);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Unit does not belong to acting player');
    });

    it('should reject activating a destroyed unit', () => {
      const state = createInitialGameState('h1', 'g1');
      state.units = [makeUnit({ isDestroyed: true })];
      const action = createAction('h1', 'activate-unit', { type: 'activate-unit', unitId: 'u1' });
      const result = validateActionBasic(action, state);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Unit is destroyed');
    });

    it('should reject activating a unit already activated this round', () => {
      const state = createInitialGameState('h1', 'g1');
      state.units = [makeUnit()];
      state.turnState.unitsActivatedThisRound = ['u1'];
      const action = createAction('h1', 'activate-unit', { type: 'activate-unit', unitId: 'u1' });
      const result = validateActionBasic(action, state);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Unit already activated this round');
    });

    it('should reject activating a routed unit', () => {
      const state = createInitialGameState('h1', 'g1');
      state.units = [makeUnit({ status: ['routed'] })];
      const action = createAction('h1', 'activate-unit', { type: 'activate-unit', unitId: 'u1' });
      const result = validateActionBasic(action, state);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Unit is routed and cannot activate');
    });

    it('should allow activating a stunned unit (activation is spent clearing the stun)', () => {
      const state = createInitialGameState('h1', 'g1');
      state.units = [makeUnit({ status: ['stunned'] })];
      const action = createAction('h1', 'activate-unit', { type: 'activate-unit', unitId: 'u1' });
      const result = validateActionBasic(action, state);
      expect(result.valid).toBe(true);
    });

    it('should reject acting with a stunned unit inside an activation', () => {
      const state = createInitialGameState('h1', 'g1');
      state.units = [makeUnit({ status: ['stunned'] })];
      const action = createAction('h1', 'move-unit', {
        type: 'move-unit',
        unitId: 'u1',
        path: [{ x: 1, y: 0, z: 1 }],
        finalPosition: { x: 1, y: 0, z: 1 },
      });
      const result = validateActionBasic(action, state);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Unit is stunned or routed and cannot act');
    });

    it('should validate attackerId-based actions (shoot)', () => {
      const state = createInitialGameState('h1', 'g1');
      state.units = [
        makeUnit({ id: 'attacker', weapons: [{ id: 'w1', weaponType: 'rifle', name: 'Rifle', profile: { type: 'ranged', range: 24, attacks: 1, specialRules: [] }, isEquipped: true }] }),
        makeUnit({ id: 'target', ownerId: 'g1' }),
      ];
      const action = createAction('h1', 'shoot', { type: 'shoot', attackerId: 'attacker', targetId: 'target', weaponId: 'w1' });
      const result = validateActionBasic(action, state);
      expect(result.valid).toBe(true);
    });

    it('should reject shooting with a unit owned by the other player', () => {
      const state = createInitialGameState('h1', 'g1');
      state.units = [makeUnit({ id: 'enemy-gun', ownerId: 'g1' }), makeUnit({ id: 'target' })];
      const action = createAction('h1', 'shoot', { type: 'shoot', attackerId: 'enemy-gun', targetId: 'target', weaponId: 'w1' });
      const result = validateActionBasic(action, state);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Unit does not belong to acting player');
    });

    it('should validate actions with no unit target (end-round, end-activation)', () => {
      const state = createInitialGameState('h1', 'g1');
      const endRound = createAction('h1', 'end-round', { type: 'end-round' });
      expect(validateActionBasic(endRound, state).valid).toBe(true);

      state.units = [makeUnit({ isDestroyed: true })]; // unit state must not affect unitless actions
      const endActivation = createAction('h1', 'end-activation', { type: 'end-activation' });
      expect(validateActionBasic(endActivation, state).valid).toBe(true);
    });
  });

  describe('unit schema (OPR stats)', () => {
    it('should keep OPR stats on units and stay serializable', () => {
      const state: GameState = createInitialGameState('h1', 'g1');
      state.units = [
        makeUnit({ quality: 2, defense: 5, speed: 8 }),
        makeUnit({ id: 'u2', ownerId: 'g1', quality: 3, defense: 4, speed: 6, status: ['stunned', 'in-cover'] }),
      ];
      expect(state.units[0].quality).toBe(2);
      expect(state.units[1].defense).toBe(4);
      expect(isGameStateSerializable(state)).toBe(true);
    });
  });
});
