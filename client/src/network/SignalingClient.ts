import { SignalingMessage } from '@skirmish-lab/shared';

type MessageHandler = (message: SignalingMessage) => void;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private url: string;

  constructor(url: string = 'ws://localhost:8080') {
    this.url = url;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('Connected to signaling server');
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message: SignalingMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('Error parsing signaling message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('Disconnected from signaling server');
      };
    });
  }

  send(message: Partial<SignalingMessage>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  on(type: string, handler: MessageHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);
  }

  off(type: string, handler: MessageHandler): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  private handleMessage(message: SignalingMessage): void {
    const type = message.type;
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.forEach(handler => handler(message));
    }
    // Also call wildcard handlers
    const wildcardHandlers = this.handlers.get('*');
    if (wildcardHandlers) {
      wildcardHandlers.forEach(handler => handler(message));
    }
  }

  createRoom(): void {
    this.send({ type: 'create-room' });
  }

  joinRoom(code: string): void {
    this.send({ type: 'join-room', code });
  }

  sendOffer(sdp: RTCSessionDescriptionInit): void {
    this.send({ type: 'offer', sdp });
  }

  sendAnswer(sdp: RTCSessionDescriptionInit): void {
    this.send({ type: 'answer', sdp });
  }

  sendIceCandidate(candidate: RTCIceCandidateInit): void {
    this.send({ type: 'ice-candidate', candidate });
  }

  requestDiceRoll(rollId: string, dice: any[]): void {
    this.send({ type: 'roll-dice-request', rollId, dice });
  }

  ping(): void {
    this.send({ type: 'ping' });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
