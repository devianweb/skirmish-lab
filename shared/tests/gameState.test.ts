import { describe, it, expect } from 'vitest';
import { createInitialGameState, cloneGameState, isGameStateSerializable, createAction } from '../src/gameState';
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
