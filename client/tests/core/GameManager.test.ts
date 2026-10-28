import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameManager } from '../../src/core/GameManager';
import { WebRTCClient } from '../../src/network/WebRTCClient';
import { createAction } from '@trench-heresy/shared';

describe('GameManager', () => {
  let mockWebRTC: WebRTCClient;
  let handlers: Map<string, Function>;
  let gameManagerHost: GameManager;
  let gameManagerGuest: GameManager;

  beforeEach(() => {
    handlers = new Map();
    mockWebRTC = {
      on: vi.fn((type: string, handler: Function) => {
        handlers.set(type, handler);
      }),
      send: vi.fn(),
    } as any;
    gameManagerHost = new GameManager(mockWebRTC, true);
    gameManagerGuest = new GameManager(mockWebRTC, false);
  });

  it('should initialize game as host', () => {
    gameManagerHost.initializeGame('host1', 'guest1');
    const state = gameManagerHost.getGameState();
    expect(state).toBeDefined();
    expect(state?.hostId).toBe('host1');
    expect(state?.guestId).toBe('guest1');
  });

  it('should not initialize game as guest', () => {
    gameManagerGuest.initializeGame('host1', 'guest1');
    expect(gameManagerGuest.getGameState()).toBeNull();
  });

  it('should save snapshots on init', () => {
    gameManagerHost.initializeGame('host1', 'guest1');
    const snapshot = gameManagerHost.getLatestSnapshot();
    expect(snapshot).toBeDefined();
    expect(snapshot?.hostId).toBe('host1');
    expect(snapshot?.gameId).toBeDefined();
  });

  it('should send action request as guest', () => {
    const action = createAction('guest1', 'end-turn', { type: 'end-turn' });
    gameManagerGuest.sendAction(action);
    expect(mockWebRTC.send).toHaveBeenCalledWith({
      type: 'action-request',
      action,
    });
  });

  it('should process action directly as host when it is actor turn', () => {
    gameManagerHost.initializeGame('host1', 'guest1');
    const action = createAction('host1', 'end-turn', { type: 'end-turn' });
    gameManagerHost.sendAction(action);
    
    const state = gameManagerHost.getGameState();
    expect(state?.lastActionId).toBe(action.id);
    expect(state?.actionLog.length).toBe(1);
    expect(state?.actionLog[0].result).toBe('accepted');
    expect(mockWebRTC.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'state-update', actionId: action.id })
    );
  });

  it('should reject action from wrong player as host', () => {
    gameManagerHost.initializeGame('host1', 'guest1');
    const action = createAction('guest1', 'end-turn', { type: 'end-turn' });
    gameManagerHost.sendAction(action);
    
    const state = gameManagerHost.getGameState();
    expect(state?.actionLog.length).toBe(0);
    expect(mockWebRTC.send).toHaveBeenCalledWith(
      expect.objectContaining({ 
        type: 'action-rejected', 
        actionId: action.id, 
        reason: 'Not your turn' 
      })
    );
  });

  it('should apply state updates as guest', () => {
    gameManagerHost.initializeGame('host1', 'guest1');
    const hostState = gameManagerHost.getGameState()!;
    const stateUpdateHandler = handlers.get('state-update');
    expect(stateUpdateHandler).toBeDefined();
    
    stateUpdateHandler!({ type: 'state-update', state: hostState, actionId: 'test' });
    
    const guestState = gameManagerGuest.getGameState();
    expect(guestState?.hostId).toBe('host1');
    expect(gameManagerGuest.getLatestSnapshot()).toBeDefined();
  });

  it('should return deep copies from getters', () => {
    gameManagerHost.initializeGame('host1', 'guest1');
    const state1 = gameManagerHost.getGameState()!;
    const state2 = gameManagerHost.getGameState()!;
    expect(state1).not.toBe(state2);
    state1.units.push({ id: 'x' } as any);
    expect(gameManagerHost.getGameState()!.units.length).toBe(0);
  });
});
