"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalingServer = void 0;
const ws_1 = require("ws");
const Room_1 = require("./Room");
const DiceRoller_1 = require("./DiceRoller");
class SignalingServer {
    constructor(port) {
        this.clientRooms = new Map();
        this.wss = new ws_1.WebSocketServer({ port });
        this.roomManager = new Room_1.RoomManager();
        this.diceRoller = new DiceRoller_1.DiceRoller();
        this.setupServer();
        console.log(`Signaling server running on port ${port}`);
    }
    setupServer() {
        this.wss.on('connection', (ws) => {
            console.log('Client connected');
            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleMessage(ws, message);
                }
                catch (error) {
                    console.error('Error parsing message:', error);
                    this.send(ws, { type: 'error', message: 'Invalid message format' });
                }
            });
            ws.on('close', () => {
                console.log('Client disconnected');
                const roomCode = this.clientRooms.get(ws);
                if (roomCode) {
                    const room = this.roomManager.getRoom(roomCode);
                    if (room) {
                        // Notify other peer
                        if (room.host === ws && room.guest) {
                            this.send(room.guest, { type: 'error', message: 'Host disconnected' });
                        }
                        else if (room.guest === ws && room.host) {
                            this.send(room.host, { type: 'error', message: 'Guest disconnected' });
                        }
                    }
                    this.roomManager.removeClient(ws);
                    this.clientRooms.delete(ws);
                }
            });
            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
            });
        });
    }
    handleMessage(ws, message) {
        switch (message.type) {
            case 'create-room':
                this.handleCreateRoom(ws);
                break;
            case 'join-room':
                this.handleJoinRoom(ws, message.code);
                break;
            case 'offer':
            case 'answer':
            case 'ice-candidate':
                this.relayMessage(ws, message);
                break;
            case 'roll-dice-request':
                this.handleDiceRoll(ws, message);
                break;
            case 'ping':
                this.send(ws, { type: 'pong' });
                break;
            case 'leave-room':
                this.handleLeaveRoom(ws);
                break;
            default:
                console.log('Unhandled message type:', message.type);
        }
    }
    handleCreateRoom(ws) {
        const code = this.roomManager.createRoom(ws);
        this.clientRooms.set(ws, code);
        this.send(ws, { type: 'room-created', code });
    }
    handleJoinRoom(ws, code) {
        const room = this.roomManager.joinRoom(code, ws);
        if (!room) {
            this.send(ws, { type: 'error', message: 'Room not found or full' });
            return;
        }
        this.clientRooms.set(ws, room.code);
        this.send(ws, { type: 'room-joined', code: room.code, role: 'guest' });
        // Notify host
        if (room.host) {
            this.send(room.host, { type: 'peer-joined' });
        }
    }
    relayMessage(ws, message) {
        const roomCode = this.clientRooms.get(ws);
        if (!roomCode) {
            this.send(ws, { type: 'error', message: 'Not in a room' });
            return;
        }
        const room = this.roomManager.getRoom(roomCode);
        if (!room) {
            this.send(ws, { type: 'error', message: 'Room not found' });
            return;
        }
        this.roomManager.updateActivity(roomCode);
        // Relay to the other peer
        if (room.host === ws && room.guest) {
            this.send(room.guest, message);
        }
        else if (room.guest === ws && room.host) {
            this.send(room.host, message);
        }
    }
    handleDiceRoll(ws, message) {
        const roomCode = this.clientRooms.get(ws);
        if (!roomCode) {
            this.send(ws, { type: 'error', message: 'Not in a room' });
            return;
        }
        const room = this.roomManager.getRoom(roomCode);
        if (!room) {
            return;
        }
        this.roomManager.updateActivity(roomCode);
        // Roll dice on server
        const results = this.diceRoller.rollDice(message.dice);
        // Broadcast to both peers simultaneously
        const resultMessage = {
            type: 'roll-dice-result',
            rollId: message.rollId,
            results,
        };
        if (room.host) {
            this.send(room.host, resultMessage);
        }
        if (room.guest) {
            this.send(room.guest, resultMessage);
        }
        console.log(`Dice rolled in room ${roomCode}:`, results);
    }
    handleLeaveRoom(ws) {
        const roomCode = this.clientRooms.get(ws);
        if (roomCode) {
            const room = this.roomManager.getRoom(roomCode);
            if (room) {
                if (room.host === ws && room.guest) {
                    this.send(room.guest, { type: 'error', message: 'Host left room' });
                }
                else if (room.guest === ws && room.host) {
                    this.send(room.host, { type: 'error', message: 'Guest left room' });
                }
            }
            this.roomManager.removeClient(ws);
            this.clientRooms.delete(ws);
        }
    }
    send(ws, message) {
        if (ws.readyState === ws_1.WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }
    close() {
        this.roomManager.destroy();
        this.wss.close();
    }
}
exports.SignalingServer = SignalingServer;
