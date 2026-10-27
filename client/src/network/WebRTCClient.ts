export type GameMessage =
  | { type: 'action-request', action: any }
  | { type: 'action-rejected', actionId: string, reason: string }
  | { type: 'state-update', state: any, actionId: string }
  | { type: 'heartbeat-ping', timestamp: number }
  | { type: 'heartbeat-pong', timestamp: number }
  | { type: 'request-snapshot' }
  | { type: 'snapshot', state: any }
  | { type: 'game-end', reason: string };

type GameMessageHandler = (message: GameMessage) => void;

export class WebRTCClient {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private handlers: Map<string, GameMessageHandler[]> = new Map();
  private heartbeatInterval: number | null = null;
  private lastPongTime: number = Date.now();
  private heartbeatTimeout: number = 10000;

  private rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  constructor() {
  }

  async createPeerConnection(): Promise<RTCPeerConnection> {
    this.peerConnection = new RTCPeerConnection(this.rtcConfig);
    return this.peerConnection;
  }

  createDataChannel(label: string = 'game'): RTCDataChannel {
    if (!this.peerConnection) {
      throw new Error('Peer connection not created');
    }
    this.dataChannel = this.peerConnection.createDataChannel(label, {
      ordered: true,
    });
    this.setupDataChannel();
    return this.dataChannel;
  }

  setupDataChannelFromEvent(event: RTCDataChannelEvent): void {
    this.dataChannel = event.channel;
    this.setupDataChannel();
  }

  private setupDataChannel(): void {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      console.log('Data channel opened');
      this.startHeartbeat();
    };

    this.dataChannel.onclose = () => {
      console.log('Data channel closed');
      this.stopHeartbeat();
    };

    this.dataChannel.onerror = (error) => {
      console.error('Data channel error:', error);
    };

    this.dataChannel.onmessage = (event) => {
      try {
        const message: GameMessage = JSON.parse(event.data);
        this.handleMessage(message);
        
        if (message.type === 'heartbeat-ping') {
          this.send({ type: 'heartbeat-pong', timestamp: (message as any).timestamp });
        }
        if (message.type === 'heartbeat-pong') {
          this.lastPongTime = Date.now();
        }
      } catch (error) {
        console.error('Error parsing game message:', error);
      }
    };
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) throw new Error('No peer connection');
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    return offer;
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) throw new Error('No peer connection');
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    return answer;
  }

  async setRemoteDescription(sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) throw new Error('No peer connection');
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) throw new Error('No peer connection');
    await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  }

  onIceCandidate(callback: (candidate: RTCIceCandidate) => void): void {
    if (!this.peerConnection) return;
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        callback(event.candidate);
      }
    };
  }

  onDataChannel(callback: (event: RTCDataChannelEvent) => void): void {
    if (!this.peerConnection) return;
    this.peerConnection.ondatachannel = callback;
  }

  send(message: GameMessage): void {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(message));
    } else {
      console.warn('Cannot send message: data channel not open', message.type);
    }
  }

  on(type: string, handler: GameMessageHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);
  }

  private handleMessage(message: GameMessage): void {
    const handlers = this.handlers.get(message.type);
    if (handlers) {
      handlers.forEach(handler => handler(message));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastPongTime = Date.now();
    this.heartbeatInterval = window.setInterval(() => {
      this.send({ type: 'heartbeat-ping', timestamp: Date.now() });
      if (Date.now() - this.lastPongTime > this.heartbeatTimeout) {
        console.warn('Heartbeat timeout - connection may be lost');
      }
    }, 3000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval !== null) {
      window.clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  getDataChannel(): RTCDataChannel | null {
    return this.dataChannel;
  }

  isConnected(): boolean {
    return this.dataChannel?.readyState === 'open';
  }

  close(): void {
    this.stopHeartbeat();
    this.dataChannel?.close();
    this.peerConnection?.close();
    this.dataChannel = null;
    this.peerConnection = null;
  }
}
