import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RoomManager } from '../src/Room';
import { WebSocket } from 'ws';

describe('RoomManager', () => {
  let roomManager: RoomManager;
  let mockHost: WebSocket;
  let mockGuest: WebSocket;

  beforeEach(() => {
    roomManager = new RoomManager();
    mockHost = {} as WebSocket;
    mockGuest = {} as WebSocket;
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
});
