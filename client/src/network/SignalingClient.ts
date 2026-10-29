import { SignalingMessage } from '@skirmish-lab/shared';

type MessageHandler = (message: SignalingMessage) => void;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private url: string;
  private currentRoomCode: string | null = null;
  private currentRole: 'host' | 'guest' | null = null;
  private reconnectTimeout: any = null;
  private intentionalClose = false;
  private stateChangeHandlers: Array<(state: 'connected' | 'disconnected' | 'reconnecting') => void> = [];
  private currentConnectionState: 'connected' | 'disconnected' | 'reconnecting' = 'disconnected';

  constructor(url: string = import.meta.env.VITE_SIGNALING_URL ?? 'ws://localhost:8080') {
    this.url = url;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.intentionalClose = false;
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('Connected to signaling server');
        this.setConnectionState('connected');
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
        this.setConnectionState('disconnected');
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('Disconnected from signaling server');
        this.setConnectionState(this.intentionalClose ? 'disconnected' : 'reconnecting');
        if (!this.intentionalClose && (this.currentRoomCode || this.handlers.size > 0)) {
          this.scheduleReconnect();
        }
      };
    });
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  scheduleReconnect(delayMs = 1500): void {
    if (this.reconnectTimeout) return;
    this.setConnectionState('reconnecting');
    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      try {
        await this.connect();
        if (this.currentRoomCode && this.currentRole) {
          this.reconnectRoom(this.currentRoomCode, this.currentRole);
        }
      } catch (err) {
        console.warn('Signaling reconnect attempt failed, retrying...', err);
        this.scheduleReconnect(3000);
      }
    }, delayMs);
  }

  onConnectionState(callback: (state: 'connected' | 'disconnected' | 'reconnecting') => void): void {
    this.stateChangeHandlers.push(callback);
    callback(this.currentConnectionState);
  }

  private setConnectionState(newState: 'connected' | 'disconnected' | 'reconnecting'): void {
    if (this.currentConnectionState === newState) return;
    this.currentConnectionState = newState;
    for (const h of this.stateChangeHandlers) {
      h(newState);
    }
  }

  async ensureConnected(): Promise<void> {
    if (this.isConnected()) return;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    await this.connect();
    if (this.currentRoomCode && this.currentRole) {
      this.reconnectRoom(this.currentRoomCode, this.currentRole);
    }
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
    if (type === 'room-created') {
      this.currentRoomCode = (message as any).code;
      this.currentRole = 'host';
    } else if (type === 'room-joined') {
      this.currentRoomCode = (message as any).code;
      this.currentRole = 'guest';
    } else if (type === 'room-reconnected') {
      this.currentRoomCode = (message as any).code;
      this.currentRole = (message as any).role;
    }

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

  reconnectRoom(code: string, role: 'host' | 'guest'): void {
    this.currentRoomCode = code;
    this.currentRole = role;
    this.send({ type: 'reconnect-room', code, role });
  }

  leaveRoom(): void {
    this.send({ type: 'leave-room' });
    this.currentRoomCode = null;
    this.currentRole = null;
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

  /**
   * Periodic signaling pings. These keep the room alive on the server while
   * a game runs over WebRTC: without signaling traffic the room would hit
   * the inactivity timeout and mid-game dice requests would fail.
   * Default 25s comfortably beats Azure App Service's 230-second idle proxy
   * timeout even when browsers throttle background tab timers.
   * Returns a stop function.
   */
  startKeepAlive(intervalMs = 25000): () => void {
    const interval = setInterval(() => this.ping(), intervalMs);
    return () => clearInterval(interval);
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.setConnectionState('disconnected');
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.currentRoomCode = null;
    this.currentRole = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
