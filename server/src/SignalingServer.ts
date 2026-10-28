import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager } from './Room';
import { DiceRoller } from './DiceRoller';
import { SignalingMessage } from '@skirmish-lab/shared';

export class SignalingServer {
  private wss: WebSocketServer;
  private roomManager: RoomManager;
  private diceRoller: DiceRoller;
  private clientRooms: Map<WebSocket, string> = new Map();

  constructor(port: number) {
    this.wss = new WebSocketServer({ port });
    this.roomManager = new RoomManager();
    this.diceRoller = new DiceRoller();
    this.setupServer();
    console.log(`Signaling server running on port ${port}`);
  }

  private setupServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('Client connected');

      ws.on('message', (data: Buffer) => {
        try {
          const message: SignalingMessage = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
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
            } else if (room.guest === ws && room.host) {
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

  private handleMessage(ws: WebSocket, message: SignalingMessage): void {
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
        console.log('Unhandled message type:', (message as any).type);
    }
  }

  private handleCreateRoom(ws: WebSocket): void {
    const code = this.roomManager.createRoom(ws);
    this.clientRooms.set(ws, code);
    this.send(ws, { type: 'room-created', code });
  }

  private handleJoinRoom(ws: WebSocket, code: string): void {
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

  private relayMessage(ws: WebSocket, message: SignalingMessage): void {
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
    } else if (room.guest === ws && room.host) {
      this.send(room.host, message);
    }
  }

  private handleDiceRoll(ws: WebSocket, message: any): void {
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

  private handleLeaveRoom(ws: WebSocket): void {
    const roomCode = this.clientRooms.get(ws);
    if (roomCode) {
      const room = this.roomManager.getRoom(roomCode);
      if (room) {
        if (room.host === ws && room.guest) {
          this.send(room.guest, { type: 'error', message: 'Host left room' });
        } else if (room.guest === ws && room.host) {
          this.send(room.host, { type: 'error', message: 'Guest left room' });
        }
      }
      this.roomManager.removeClient(ws);
      this.clientRooms.delete(ws);
    }
  }

  private send(ws: WebSocket, message: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.roomManager.destroy();
    this.wss.close();
  }
}
