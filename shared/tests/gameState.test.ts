import { describe, it, expect } from 'vitest';
import { createInitialGameState, cloneGameState, isGameStateSerializable, createAction } from '../src/gameState';
import { GameState } from '../src/gameTypes';

describe('gameState', () => {
  it('should create initial game state with correct setup', () => {
    const state = createInitialGameState('host1', 'guest1');
    expect(state.hostId).toBe('host1');
    expect(state.guestId).toBe('guest1');
    expect(state.status).toBe('setting-up');
    expect(state.turnState.phase).toBe('setup');
    expect(state.turnState.currentPlayerId).toBe('host1');
    expect(state.units).toEqual([]);
    expect(state.actionLog).toEqual([]);
  });

  it('should create game state with custom player names', () => {
    const state = createInitialGameState('h1', 'g1', 'Alice', 'Bob');
    expect(state.players[0].name).toBe('Alice');
    expect(state.players[1].name).toBe('Bob');
  });

  it('should clone game state deeply', () => {
    const state = createInitialGameState('h1', 'g1');
    const cloned = cloneGameState(state);
    expect(cloned).toEqual(state);
    cloned.units.push({ id: 'u1' } as any);
    expect(state.units.length).toBe(0);
  });

  it('should validate serializable game state', () => {
    const state = createInitialGameState('h1', 'g1');
    expect(isGameStateSerializable(state)).toBe(true);
  });

  it('should create action with correct structure', () => {
    const action = createAction('player1', 'end-turn', { type: 'end-turn' });
    expect(action.actorId).toBe('player1');
    expect(action.type).toBe('end-turn');
    expect(action.payload.type).toBe('end-turn');
    expect(action.id).toBeDefined();
    expect(action.timestamp).toBeDefined();
  });
});
