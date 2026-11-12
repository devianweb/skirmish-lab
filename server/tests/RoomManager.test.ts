import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from '../src/Room';
import { WebSocket } from 'ws';

describe('RoomManager', () => {
  let roomManager: RoomManager;
  let mockHost: WebSocket;
  let mockGuest: WebSocket;

  beforeEach(() => {
    roomManager = new RoomManager();
    mockHost = { readyState: WebSocket.OPEN } as unknown as WebSocket;
    mockGuest = { readyState: WebSocket.OPEN } as unknown as WebSocket;
  });

  afterEach(() => {
    roomManager.destroy();
    vi.useRealTimers();
  });

  it('should generate code in XXX-XXX format', () => {
    const code = roomManager.generateCode();
    expect(code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
  });

  it('should create a room and return code', () => {
    const code = roomManager.createRoom(mockHost);
    expect(code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    const room = roomManager.getRoom(code);
    expect(room).toBeDefined();
    expect(room?.host).toBe(mockHost);
    expect(room?.guest).toBeNull();
  });

  it('should allow guest to join room', () => {
    const code = roomManager.createRoom(mockHost);
    const result = roomManager.joinRoom(code, mockGuest);
    expect(result).toBeDefined();
    expect(result?.role).toBe('guest');
    expect(result?.room.guest).toBe(mockGuest);
    expect(result?.room.host).toBe(mockHost);
  });

  it('should allow host to rejoin vacant host slot via joinRoom when guest is present', () => {
    const code = roomManager.createRoom(mockHost);
    roomManager.joinRoom(code, mockGuest);
    roomManager.removeClient(mockHost); // Host drops, guest remains

    const newHost = {} as WebSocket;
    const result = roomManager.joinRoom(code, newHost);
    expect(result).toBeDefined();
    expect(result?.role).toBe('host');
    expect(result?.room.host).toBe(newHost);
    expect(result?.room.guest).toBe(mockGuest);
  });

  it('should not allow joining non-existent room', () => {
    const result = roomManager.joinRoom('XXX-XXX', mockGuest);
    expect(result).toBeNull();
  });

  it('should not allow joining full room', () => {
    const code = roomManager.createRoom(mockHost);
    roomManager.joinRoom(code, mockGuest);
    const mockGuest2 = {} as WebSocket;
    const result = roomManager.joinRoom(code, mockGuest2);
    expect(result).toBeNull();
  });

  it('should handle case-insensitive room codes', () => {
    const code = roomManager.createRoom(mockHost);
    const lowerCode = code.toLowerCase();
    const result = roomManager.joinRoom(lowerCode, mockGuest);
    expect(result).toBeDefined();
    expect(result?.room.guest).toBe(mockGuest);
  });

  it('should remove guest when they disconnect', () => {
    const code = roomManager.createRoom(mockHost);
    roomManager.joinRoom(code, mockGuest);
    const removedCode = roomManager.removeClient(mockGuest);
    expect(removedCode).toBe(code);
    const room = roomManager.getRoom(code);
    expect(room?.guest).toBeNull();
  });

  it('should mark host as disconnected but preserve room during grace window', () => {
    const code = roomManager.createRoom(mockHost);
    roomManager.joinRoom(code, mockGuest);
    const removedCode = roomManager.removeClient(mockHost);
    expect(removedCode).toBe(code);
    const room = roomManager.getRoom(code);
    expect(room).toBeDefined();
    expect(room?.host).toBeNull();
  });

  it('should allow host and guest to reconnect to room during grace window', () => {
    const code = roomManager.createRoom(mockHost);
    roomManager.joinRoom(code, mockGuest);
    roomManager.removeClient(mockHost);
    roomManager.removeClient(mockGuest);

    const newHost = {} as WebSocket;
    const newGuest = {} as WebSocket;

    const reconnectedHost = roomManager.reconnectRoom(code, 'host', newHost);
    expect(reconnectedHost?.host).toBe(newHost);

    const reconnectedGuest = roomManager.reconnectRoom(code, 'guest', newGuest);
    expect(reconnectedGuest?.guest).toBe(newGuest);
  });

  describe('seat takeover protection & rejoin tokens (G-02)', () => {
    it('assigns a rejoinToken on createRoom and joinRoom', () => {
      const code = roomManager.createRoom(mockHost)!;
      const room = roomManager.getRoom(code)!;
      expect(typeof room.hostToken).toBe('string');
      expect(room.hostToken.length).toBeGreaterThan(0);

      const joinRes = roomManager.joinRoom(code, mockGuest)!;
      expect(typeof joinRes.rejoinToken).toBe('string');
      expect(joinRes.rejoinToken.length).toBeGreaterThan(0);
      expect(room.guestToken).toBe(joinRes.rejoinToken);
    });

    it('rejects reconnectRoom to an OPEN host or guest seat without the matching token', () => {
      const code = roomManager.createRoom(mockHost)!;
      const joinRes = roomManager.joinRoom(code, mockGuest)!;
      const room = roomManager.getRoom(code)!;

      const attacker = { readyState: WebSocket.OPEN } as unknown as WebSocket;
      expect(roomManager.reconnectRoom(code, 'host', attacker)).toBeNull();
      expect(roomManager.reconnectRoom(code, 'host', attacker, 'wrong-token')).toBeNull();
      expect(room.host).toBe(mockHost);

      expect(roomManager.reconnectRoom(code, 'guest', attacker)).toBeNull();
      expect(roomManager.reconnectRoom(code, 'guest', attacker, 'wrong-token')).toBeNull();
      expect(room.guest).toBe(mockGuest);

      // With matching token, replacing an OPEN socket succeeds
      const validNewHost = { readyState: WebSocket.OPEN } as unknown as WebSocket;
      expect(roomManager.reconnectRoom(code, 'host', validNewHost, room.hostToken)).toBe(room);
      expect(room.host).toBe(validNewHost);

      const validNewGuest = { readyState: WebSocket.OPEN } as unknown as WebSocket;
      expect(roomManager.reconnectRoom(code, 'guest', validNewGuest, joinRes.rejoinToken)).toBe(room);
      expect(room.guest).toBe(validNewGuest);
    });

    it('allows reconnectRoom and joinRoom without a token when the seat socket is CLOSED or vacant', () => {
      const closingHost = { readyState: WebSocket.OPEN } as unknown as WebSocket;
      const code = roomManager.createRoom(closingHost)!;
      roomManager.joinRoom(code, mockGuest);

      // Host socket closes before removeClient runs
      (closingHost as any).readyState = WebSocket.CLOSED;

      const newHost = { readyState: WebSocket.OPEN } as unknown as WebSocket;
      const res = roomManager.joinRoom(code, newHost);
      expect(res?.role).toBe('host');
      expect(res?.room.host).toBe(newHost);

      // Guest socket closes before removeClient runs -> reconnectRoom without token succeeds
      (mockGuest as any).readyState = WebSocket.CLOSED;
      const newGuest = { readyState: WebSocket.OPEN } as unknown as WebSocket;
      expect(roomManager.reconnectRoom(code, 'guest', newGuest)?.guest).toBe(newGuest);
    });

    it('allows resuming an OPEN seat via joinRoom when the matching rejoinToken is provided', () => {
      const code = roomManager.createRoom(mockHost)!;
      const hostToken = roomManager.getRoom(code)!.hostToken;
      const guestJoin = roomManager.joinRoom(code, mockGuest)!;

      // Third socket with no token cannot join full room
      const stranger = { readyState: WebSocket.OPEN } as unknown as WebSocket;
      expect(roomManager.joinRoom(code, stranger)).toBeNull();
      expect(roomManager.joinRoom(code, stranger, 'bad-token')).toBeNull();

      // Host reloads and sends joinRoom with hostToken before old socket closes
      const reloadedHost = { readyState: WebSocket.OPEN } as unknown as WebSocket;
      const hostResume = roomManager.joinRoom(code, reloadedHost, hostToken);
      expect(hostResume).not.toBeNull();
      expect(hostResume?.role).toBe('host');
      expect(hostResume?.replacedSocket).toBe(mockHost);
      expect(roomManager.getRoom(code)?.host).toBe(reloadedHost);

      // Guest reloads and sends joinRoom with guestToken before old socket closes
      const reloadedGuest = { readyState: WebSocket.OPEN } as unknown as WebSocket;
      const guestResume = roomManager.joinRoom(code, reloadedGuest, guestJoin.rejoinToken);
      expect(guestResume).not.toBeNull();
      expect(guestResume?.role).toBe('guest');
      expect(guestResume?.replacedSocket).toBe(mockGuest);
      expect(roomManager.getRoom(code)?.guest).toBe(reloadedGuest);
    });
  });

  describe('limits and cleanup (G-25, G-29)', () => {
    it('enforces at most one room per socket when creating or joining rooms', () => {
      const code1 = roomManager.createRoom(mockHost)!;
      expect(roomManager.getRoomCount()).toBe(1);

      // Creating a second room on the same socket removes the solo first room
      const code2 = roomManager.createRoom(mockHost)!;
      expect(roomManager.getRoom(code1)).toBeUndefined();
      expect(roomManager.getRoom(code2)?.host).toBe(mockHost);
      expect(roomManager.getRoomCount()).toBe(1);

      // Joining another room vacates the socket's seat in its previous room
      const otherHost = { readyState: WebSocket.OPEN } as unknown as WebSocket;
      const code3 = roomManager.createRoom(otherHost)!;
      roomManager.joinRoom(code3, mockHost);
      expect(roomManager.getRoom(code2)).toBeUndefined();
      expect(roomManager.getRoom(code3)?.guest).toBe(mockHost);
      expect(roomManager.getRoomCount()).toBe(1);
    });

    it('caps total rooms at 500', () => {
      for (let i = 0; i < 500; i++) {
        const ws = { readyState: WebSocket.OPEN } as unknown as WebSocket;
        expect(roomManager.createRoom(ws)).not.toBeNull();
      }
      expect(roomManager.getRoomCount()).toBe(500);

      const extraWs = { readyState: WebSocket.OPEN } as unknown as WebSocket;
      expect(roomManager.createRoom(extraWs)).toBeNull();
      expect(roomManager.getRoomCount()).toBe(500);
    });

    it('expires inactive rooms after 5 minutes and rooms past 3-hour maxLifetime', () => {
      vi.useFakeTimers();
      const code1 = roomManager.createRoom(mockHost)!;
      const code2 = roomManager.createRoom({ readyState: WebSocket.OPEN } as unknown as WebSocket)!;

      // Advance 5 minutes + 1 ms; refresh code2 just before cleanup
      vi.advanceTimersByTime(5 * 60 * 1000 - 1000);
      roomManager.updateActivity(code2);
      vi.advanceTimersByTime(1001);
      roomManager.cleanup();

      expect(roomManager.getRoom(code1)).toBeUndefined();
      expect(roomManager.getRoom(code2)).toBeDefined();

      // Advance to > 3 hours while keeping code2 active
      for (let i = 0; i < 36; i++) {
        vi.advanceTimersByTime(5 * 60 * 1000);
        roomManager.updateActivity(code2);
      }
      roomManager.cleanup();
      expect(roomManager.getRoom(code2)).toBeUndefined();
    });

    it('expires a room whose host has been gone past the 5-minute grace window even if guest keeps pinging', () => {
      vi.useFakeTimers();
      const code = roomManager.createRoom(mockHost)!;
      roomManager.joinRoom(code, mockGuest);

      // Host disconnects
      roomManager.removeClient(mockHost);

      // Guest sends keep-alive pings every 25s for 4 minutes -> room still alive
      for (let elapsed = 0; elapsed < 4 * 60 * 1000; elapsed += 25 * 1000) {
        vi.advanceTimersByTime(25 * 1000);
        roomManager.updateActivity(code);
      }
      roomManager.cleanup();
      expect(roomManager.getRoom(code)).toBeDefined();

      // Guest keeps pinging past the 5-minute grace window -> room expires!
      for (let elapsed = 0; elapsed < 2 * 60 * 1000; elapsed += 25 * 1000) {
        vi.advanceTimersByTime(25 * 1000);
        roomManager.updateActivity(code);
      }
      roomManager.cleanup();
      expect(roomManager.getRoom(code)).toBeUndefined();
    });
  });
});
