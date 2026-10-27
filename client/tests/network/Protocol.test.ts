import { describe, it, expect } from 'vitest';
import type { ConnectionState, RoomInfo, ConnectionStatus } from '../../src/network/Protocol';

describe('Protocol types', () => {
  it('should have valid connection states', () => {
    const states: ConnectionState[] = ['disconnected', 'connecting', 'signaling', 'connected', 'failed'];
    expect(states).toHaveLength(5);
  });

  it('should have valid room info', () => {
    const roomInfo: RoomInfo = {
      code: 'ABC-123',
      role: 'host',
    };
    expect(roomInfo.code).toBe('ABC-123');
    expect(roomInfo.role).toBe('host');
  });

  it('should have valid connection status', () => {
    const status: ConnectionStatus = {
      state: 'connected',
      roomCode: 'ABC-123',
      role: 'guest',
      peerConnected: true,
    };
    expect(status.state).toBe('connected');
    expect(status.peerConnected).toBe(true);
  });
});
