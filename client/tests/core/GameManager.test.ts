import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameManager } from '../../src/core/GameManager';
import { WebRTCClient } from '../../src/network/WebRTCClient';

describe('GameManager', () => {
  let mockWebRTC: WebRTCClient;
  let gameManagerHost: GameManager;
  let gameManagerGuest: GameManager;

  beforeEach(() => {
    mockWebRTC = {
      on: vi.fn(),
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

  it('should save snapshots', () => {
    gameManagerHost.initializeGame('host1', 'guest1');
    const snapshot = gameManagerHost.getLatestSnapshot();
    expect(snapshot).toBeDefined();
    expect(snapshot?.hostId).toBe('host1');
  });

  it('should send action request as guest', () => {
    const action = {
      id: 'action1',
      timestamp: Date.now(),
      actorId: 'guest1',
      type: 'end-turn',
      payload: { type: 'end-turn' },
    };
    gameManagerGuest.sendAction(action as any);
    expect(mockWebRTC.send).toHaveBeenCalledWith({
      type: 'action-request',
      action,
    });
  });
});
