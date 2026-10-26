"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomManager = void 0;
class RoomManager {
    constructor() {
        this.rooms = new Map();
        this.codeLength = 6;
        this.inactivityTimeout = 5 * 60 * 1000; // 5 minutes
        this.maxLifetime = 60 * 60 * 1000; // 1 hour
        this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
    }
    generateCode() {
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
    createRoom(host) {
        let code;
        do {
            code = this.generateCode();
        } while (this.rooms.has(code));
        const room = {
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
    joinRoom(code, guest) {
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
    getRoom(code) {
        return this.rooms.get(code.toUpperCase());
    }
    updateActivity(code) {
        const room = this.rooms.get(code.toUpperCase());
        if (room) {
            room.lastActivity = Date.now();
        }
    }
    removeClient(ws) {
        for (const [code, room] of this.rooms.entries()) {
            if (room.host === ws) {
                // Host disconnected - remove room or mark for cleanup
                this.rooms.delete(code);
                console.log(`Room ${code} removed (host disconnected)`);
                return code;
            }
            if (room.guest === ws) {
                room.guest = null;
                room.lastActivity = Date.now();
                console.log(`Guest left room ${code}`);
                return code;
            }
        }
        return null;
    }
    endGame(code) {
        const room = this.rooms.get(code.toUpperCase());
        if (room) {
            room.gameStarted = false;
            // Room will be cleaned up by cleanup logic
        }
    }
    cleanup() {
        const now = Date.now();
        for (const [code, room] of this.rooms.entries()) {
            const inactive = now - room.lastActivity > this.inactivityTimeout;
            const expired = now - room.createdAt > this.maxLifetime;
            if (inactive || expired || (!room.host && !room.guest)) {
                this.rooms.delete(code);
                console.log(`Room ${code} cleaned up (inactive/expired/empty)`);
            }
        }
    }
    getRoomCount() {
        return this.rooms.size;
    }
    destroy() {
        clearInterval(this.cleanupInterval);
        this.rooms.clear();
    }
}
exports.RoomManager = RoomManager;
