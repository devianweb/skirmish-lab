import { WebSocket } from 'ws';

export interface Room {
  code: string;
  host: WebSocket | null;
  guest: WebSocket | null;
  createdAt: number;
  lastActivity: number;
  gameStarted: boolean;
  rollCache?: Map<string, any>;
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private readonly codeLength = 6;
  private readonly inactivityTimeout = 5 * 60 * 1000; // 5 minutes
  private readonly graceTimeout = 5 * 60 * 1000; // 5 minutes grace window for disconnected peer
  private readonly maxLifetime = 3 * 60 * 60 * 1000; // 3 hours
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
  }

  generateCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 3; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    code += '-';
    for (let i = 0; i < 3; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  createRoom(host: WebSocket): string {
    let code: string;
    do {
      code = this.generateCode();
    } while (this.rooms.has(code));

    const room: Room = {
      code,
      host,
      guest: null,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      gameStarted: false,
    };

    this.rooms.set(code, room);
    console.log(`Room created: ${code}`);
    return code;
  }

  joinRoom(code: string, guest: WebSocket): Room | null {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) {
      return null;
    }
    if (room.guest) {
      return null; // Room full
    }

    room.guest = guest;
    room.lastActivity = Date.now();
    console.log(`Guest joined room: ${code}`);
    return room;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  updateActivity(code: string): void {
    const room = this.rooms.get(code.toUpperCase());
    if (room) {
      room.lastActivity = Date.now();
    }
  }

  reconnectRoom(code: string, role: 'host' | 'guest', ws: WebSocket): Room | null {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) {
      return null;
    }
    if (role === 'host') {
      room.host = ws;
      room.lastActivity = Date.now();
      console.log(`Host reconnected to room ${code}`);
      return room;
    }
    if (role === 'guest') {
      room.guest = ws;
      room.lastActivity = Date.now();
      console.log(`Guest reconnected to room ${code}`);
      return room;
    }
    return null;
  }

  removeClient(ws: WebSocket): string | null {
    for (const [code, room] of this.rooms.entries()) {
      if (room.host === ws) {
        room.host = null;
        room.lastActivity = Date.now();
        console.log(`Host disconnected from room ${code} (5-min grace window started)`);
        return code;
      }
      if (room.guest === ws) {
        room.guest = null;
        room.lastActivity = Date.now();
        console.log(`Guest disconnected from room ${code} (5-min grace window started)`);
        return code;
      }
    }
    return null;
  }

  endGame(code: string): void {
    const room = this.rooms.get(code.toUpperCase());
    if (room) {
      room.gameStarted = false;
      // Room will be cleaned up by cleanup logic
    }
  }

  cleanup(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      const inactive = now - room.lastActivity > this.inactivityTimeout;
      const expired = now - room.createdAt > this.maxLifetime;
      const hostGoneLongEnough = !room.host && (now - room.lastActivity > this.graceTimeout);
      const abandoned = !room.host && !room.guest && (now - room.lastActivity > this.graceTimeout);
      
      if (inactive || expired || hostGoneLongEnough || abandoned) {
        this.rooms.delete(code);
        console.log(`Room ${code} cleaned up (inactive/expired/grace expired)`);
      }
    }
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.rooms.clear();
  }
}
