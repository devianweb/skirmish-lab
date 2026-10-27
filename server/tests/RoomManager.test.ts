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
    const room = roomManager.joinRoom(code, mockGuest);
    expect(room).toBeDefined();
    expect(room?.guest).toBe(mockGuest);
    expect(room?.host).toBe(mockHost);
  });

  it('should not allow joining non-existent room', () => {
    const room = roomManager.joinRoom('XXX-XXX', mockGuest);
    expect(room).toBeNull();
  });

  it('should not allow joining full room', () => {
    const code = roomManager.createRoom(mockHost);
    roomManager.joinRoom(code, mockGuest);
    const mockGuest2 = {} as WebSocket;
    const room = roomManager.joinRoom(code, mockGuest2);
    expect(room).toBeNull();
  });

  it('should handle case-insensitive room codes', () => {
    const code = roomManager.createRoom(mockHost);
    const lowerCode = code.toLowerCase();
    const room = roomManager.joinRoom(lowerCode, mockGuest);
    expect(room).toBeDefined();
  });

  it('should remove guest when they disconnect', () => {
    const code = roomManager.createRoom(mockHost);
    roomManager.joinRoom(code, mockGuest);
    const removedCode = roomManager.removeClient(mockGuest);
    expect(removedCode).toBe(code);
    const room = roomManager.getRoom(code);
    expect(room?.guest).toBeNull();
  });

  it('should remove room when host disconnects', () => {
    const code = roomManager.createRoom(mockHost);
    roomManager.joinRoom(code, mockGuest);
    const removedCode = roomManager.removeClient(mockHost);
    expect(removedCode).toBe(code);
    const room = roomManager.getRoom(code);
    expect(room).toBeUndefined();
  });
});
