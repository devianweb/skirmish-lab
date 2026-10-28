import { SignalingClient } from '../network/SignalingClient';
import { WebRTCClient } from '../network/WebRTCClient';

/** Fired once the P2P data channel is alive (first heartbeat round-trip). */
export interface PeerReadyContext {
  webrtcClient: WebRTCClient;
  signalingClient: SignalingClient;
  role: 'host' | 'guest';
  roomCode: string;
}

export interface LobbyOptions {
  onPeerReady?: (context: PeerReadyContext) => void;
}

/**
 * Lobby UI: room creation/joining via invite codes and the WebRTC handshake.
 * Once the data channel is alive it hands the connection pieces to the app
 * (onPeerReady) — main.ts wires them into GameManager/GameView/GameHUD.
 */
export class Lobby {
  private container: HTMLElement;
  private signalingClient: SignalingClient;
  private webrtcClient: WebRTCClient | null = null;
  private roomCode: string | null = null;
  private role: 'host' | 'guest' | null = null;
  private options: LobbyOptions;
  private peerReadyFired = false;

  constructor(container: HTMLElement, options: LobbyOptions = {}) {
    this.container = container;
    this.options = options;
    this.signalingClient = new SignalingClient();
    this.setupSignalingHandlers();
  }

  async init(): Promise<void> {
    await this.signalingClient.connect();
    this.render();
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  show(): void {
    this.container.style.display = '';
  }

  private setupSignalingHandlers(): void {
    this.signalingClient.on('room-created', (msg: any) => {
      this.roomCode = msg.code;
      this.role = 'host';
      this.webrtcClient = new WebRTCClient();
      this.setupWebRTCAsHost();
      this.render();
    });

    this.signalingClient.on('room-joined', (msg: any) => {
      this.roomCode = msg.code;
      this.role = 'guest';
      this.webrtcClient = new WebRTCClient();
      this.setupWebRTCAsGuest();
      this.render();
    });

    this.signalingClient.on('peer-joined', async () => {
      if (this.role === 'host' && this.webrtcClient) {
        await this.createAndSendOffer();
      }
    });

    this.signalingClient.on('offer', async (msg: any) => {
      if (this.role === 'guest' && this.webrtcClient) {
        await this.handleOffer(msg.sdp);
      }
    });

    this.signalingClient.on('answer', async (msg: any) => {
      if (this.role === 'host' && this.webrtcClient) {
        await this.webrtcClient.setRemoteDescription(msg.sdp);
      }
    });

    this.signalingClient.on('ice-candidate', async (msg: any) => {
      if (this.webrtcClient) {
        await this.webrtcClient.addIceCandidate(msg.candidate);
      }
    });

    this.signalingClient.on('error', (msg: any) => {
      alert(msg.message);
    });
  }

  private async setupWebRTCAsHost(): Promise<void> {
    if (!this.webrtcClient) return;
    await this.webrtcClient.createPeerConnection();
    this.webrtcClient.createDataChannel();
    this.webrtcClient.onIceCandidate((candidate) => {
      this.signalingClient.sendIceCandidate(candidate.toJSON());
    });
    this.registerPeerReadyListeners(this.webrtcClient);
  }

  private async setupWebRTCAsGuest(): Promise<void> {
    if (!this.webrtcClient) return;
    const client = this.webrtcClient;
    await client.createPeerConnection();
    client.onDataChannel((event) => {
      client.setupDataChannelFromEvent(event);
    });
    client.onIceCandidate((candidate) => {
      this.signalingClient.sendIceCandidate(candidate.toJSON());
    });
    this.registerPeerReadyListeners(client);
  }

  private registerPeerReadyListeners(client: WebRTCClient): void {
    client.on('heartbeat-ping', () => {
      const status = document.getElementById('status');
      if (status) status.textContent = 'Connected!';
      this.maybeFirePeerReady();
    });
    client.on('state-update', () => this.maybeFirePeerReady());
  }

  private async createAndSendOffer(): Promise<void> {
    if (!this.webrtcClient) return;
    const offer = await this.webrtcClient.createOffer();
    this.signalingClient.sendOffer(offer);
  }

  private async handleOffer(sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!this.webrtcClient) return;
    await this.webrtcClient.setRemoteDescription(sdp);
    const answer = await this.webrtcClient.createAnswer();
    this.signalingClient.sendAnswer(answer);
  }

  /**
   * The first heartbeat ping from the peer proves the data channel is open
   * in both directions — hand the connection to the app exactly once.
   */
  private maybeFirePeerReady(): void {
    if (this.peerReadyFired || !this.webrtcClient || !this.role || !this.roomCode) return;
    if (!this.webrtcClient.isConnected()) return;
    this.peerReadyFired = true;
    this.options.onPeerReady?.({
      webrtcClient: this.webrtcClient,
      signalingClient: this.signalingClient,
      role: this.role,
      roomCode: this.roomCode,
    });
  }

  private render(): void {
    if (this.roomCode && this.role) {
      this.container.innerHTML = `
        <div style="font-family: Arial; padding: 40px; text-align: center;">
          <h1>SkirmishLab</h1>
          <h2>Room: ${this.roomCode}</h2>
          <p>Role: ${this.role}</p>
          <p id="status">Waiting for peer...</p>
        </div>
      `;
    } else {
      this.container.innerHTML = `
        <div style="font-family: Arial; padding: 40px; text-align: center;">
          <h1>SkirmishLab</h1>
          <button id="createBtn" style="padding: 10px 20px; margin: 10px;">Create Room</button>
          <div style="margin: 20px;">
            <input id="codeInput" placeholder="XXX-XXX" style="padding: 10px;" />
            <button id="joinBtn" style="padding: 10px 20px;">Join Room</button>
          </div>
        </div>
      `;

      document.getElementById('createBtn')?.addEventListener('click', () => {
        this.signalingClient.createRoom();
      });

      document.getElementById('joinBtn')?.addEventListener('click', () => {
        const input = document.getElementById('codeInput') as HTMLInputElement;
        if (input.value) {
          this.signalingClient.joinRoom(input.value.toUpperCase());
        }
      });
    }
  }
}
