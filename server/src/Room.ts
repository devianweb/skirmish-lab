import * as crypto from 'crypto';
import { WebSocket } from 'ws';
import { DiceSpec, DiceResult } from '@skirmish-lab/shared';

export const MAX_ROOMS = 500;

export interface CachedRoll {
  specs: DiceSpec[];
  results: DiceResult[];
}

export interface Room {
  code: string;
  host: WebSocket | null;
  guest: WebSocket | null;
  hostToken: string;
  guestToken?: string;
  hostDisconnectedAt?: number | null;
  guestDisconnectedAt?: number | null;
  createdAt: number;
  lastActivity: number;
  gameStarted: boolean;
  rollCache?: Map<string, CachedRoll>;
}

export interface JoinRoomResult {
  room: Room;
  role: 'host' | 'guest';
  rejoinToken: string;
  replacedSocket?: WebSocket | null;
}

function isSeatOpen(ws: WebSocket | null): boolean {
  if (!ws) return false;
  return ws.readyState === undefined || ws.readyState === WebSocket.OPEN;
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private readonly codeLength = 6;
  private readonly maxRooms = MAX_ROOMS;
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

  canCreateRoom(host: WebSocket): boolean {
    if (this.rooms.size < this.maxRooms) {
      return true;
    }
    return this.isSocketInSoloRoom(host);
  }

  private isSocketInSoloRoom(ws: WebSocket): boolean {
    for (const room of this.rooms.values()) {
      if ((room.host === ws && !room.guest) || (room.guest === ws && !room.host)) {
        return true;
      }
    }
    return false;
  }

  private removeSocketFromOtherRooms(ws: WebSocket, targetCode?: string): void {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      if (code === targetCode) continue;
      if (room.host === ws) {
        room.host = null;
        room.hostDisconnectedAt = now;
        room.lastActivity = now;
        if (!room.guest) {
          this.rooms.delete(code);
        }
      } else if (room.guest === ws) {
        room.guest = null;
        room.guestDisconnectedAt = now;
        room.lastActivity = now;
        if (!room.host) {
          this.rooms.delete(code);
        }
      }
    }
  }

  createRoom(host: WebSocket): string | null {
    if (!this.canCreateRoom(host)) {
      return null;
    }

    this.removeSocketFromOtherRooms(host);

    let code: string;
    do {
      code = this.generateCode();
    } while (this.rooms.has(code));

    const now = Date.now();
    const room: Room = {
      code,
      host,
      guest: null,
      hostToken: crypto.randomUUID(),
      hostDisconnectedAt: null,
      guestDisconnectedAt: null,
      createdAt: now,
      lastActivity: now,
      gameStarted: false,
    };

    this.rooms.set(code, room);
    console.log(`Room created: ${code}`);
    return code;
  }

  joinRoom(
    code: string | null | undefined,
    ws: WebSocket,
    rejoinToken?: string
  ): JoinRoomResult | null {
    if (typeof code !== 'string' || !code) {
      return null;
    }
    const room = this.rooms.get(code.toUpperCase());
    if (!room) {
      return null;
    }

    let role: 'host' | 'guest';
    let replacedSocket: WebSocket | null = null;

    if (rejoinToken && room.hostToken && rejoinToken === room.hostToken) {
      replacedSocket = room.host !== ws ? room.host : null;
      if (room.guest === ws) {
        room.guest = null;
        room.guestDisconnectedAt = Date.now();
      }
      room.host = ws;
      room.hostDisconnectedAt = null;
      role = 'host';
      console.log(`Host rejoined room: ${code}`);
    } else if (rejoinToken && room.guestToken && rejoinToken === room.guestToken) {
      replacedSocket = room.guest !== ws ? room.guest : null;
      if (room.host === ws) {
        room.host = null;
        room.hostDisconnectedAt = Date.now();
      }
      room.guest = ws;
      room.guestDisconnectedAt = null;
      role = 'guest';
      console.log(`Guest joined room: ${code}`);
    } else if (!isSeatOpen(room.host)) {
      replacedSocket = room.host !== ws ? room.host : null;
      if (room.guest === ws) {
        room.guest = null;
        room.guestDisconnectedAt = Date.now();
      }
      room.host = ws;
      room.hostDisconnectedAt = null;
      role = 'host';
      console.log(`Host rejoined room: ${code}`);
    } else if (!isSeatOpen(room.guest)) {
      replacedSocket = room.guest !== ws ? room.guest : null;
      if (room.host === ws) {
        room.host = null;
        room.hostDisconnectedAt = Date.now();
      }
      room.guest = ws;
      room.guestDisconnectedAt = null;
      role = 'guest';
      console.log(`Guest joined room: ${code}`);
    } else {
      return null; // Room full
    }

    this.removeSocketFromOtherRooms(ws, room.code);

    const assignedToken = crypto.randomUUID();
    if (role === 'host') {
      room.hostToken = assignedToken;
    } else {
      room.guestToken = assignedToken;
    }

    room.lastActivity = Date.now();
    return { room, role, rejoinToken: assignedToken, replacedSocket };
  }

  getRoom(code: string | null | undefined): Room | undefined {
    if (typeof code !== 'string' || !code) {
      return undefined;
    }
    return this.rooms.get(code.toUpperCase());
  }

  updateActivity(code: string | null | undefined): void {
    if (typeof code !== 'string' || !code) {
      return;
    }
    const room = this.rooms.get(code.toUpperCase());
    if (room) {
      room.lastActivity = Date.now();
    }
  }

  reconnectRoom(
    code: string | null | undefined,
    role: 'host' | 'guest',
    ws: WebSocket,
    rejoinToken?: string
  ): Room | null {
    if (typeof code !== 'string' || !code) {
      return null;
    }
    const room = this.rooms.get(code.toUpperCase());
    if (!room) {
      return null;
    }
    if (role === 'host') {
      if (isSeatOpen(room.host) && room.host !== ws) {
        if (!rejoinToken || !room.hostToken || rejoinToken !== room.hostToken) {
          return null;
        }
      }
      this.removeSocketFromOtherRooms(ws, room.code);
      if (room.guest === ws) {
        room.guest = null;
        room.guestDisconnectedAt = Date.now();
      }
      room.host = ws;
      room.hostDisconnectedAt = null;
      room.lastActivity = Date.now();
      console.log(`Host reconnected to room ${code}`);
      return room;
    }
    if (role === 'guest') {
      if (isSeatOpen(room.guest) && room.guest !== ws) {
        if (!rejoinToken || !room.guestToken || rejoinToken !== room.guestToken) {
          return null;
        }
      }
      this.removeSocketFromOtherRooms(ws, room.code);
      if (room.host === ws) {
        room.host = null;
        room.hostDisconnectedAt = Date.now();
      }
      room.guest = ws;
      room.guestDisconnectedAt = null;
      room.lastActivity = Date.now();
      console.log(`Guest reconnected to room ${code}`);
      return room;
    }
    return null;
  }

  removeClient(ws: WebSocket): string | null {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      if (room.host === ws) {
        room.host = null;
        room.hostDisconnectedAt = now;
        room.lastActivity = now;
        console.log(`Host disconnected from room ${code} (5-min grace window started)`);
        return code;
      }
      if (room.guest === ws) {
        room.guest = null;
        room.guestDisconnectedAt = now;
        room.lastActivity = now;
        console.log(`Guest disconnected from room ${code} (5-min grace window started)`);
        return code;
      }
    }
    return null;
  }

  endGame(code: string | null | undefined): void {
    if (typeof code !== 'string' || !code) {
      return;
    }
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
      const hostDisconnectTime = room.hostDisconnectedAt ?? room.lastActivity;
      const hostGoneLongEnough = !room.host && (now - hostDisconnectTime > this.graceTimeout);
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
