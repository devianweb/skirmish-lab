import { SignalingClient } from '../network/SignalingClient';
import { WebRTCClient } from '../network/WebRTCClient';
import { defaultSessionStore, SessionStore } from '../storage/SessionStore';

/** Fired once the P2P data channel is alive (first heartbeat round-trip). */
export interface PeerReadyContext {
  webrtcClient: WebRTCClient;
  signalingClient: SignalingClient;
  role: 'host' | 'guest';
  roomCode: string;
  initialState?: any;
  hostArmyId?: string;
  guestArmyId?: string;
  useDeploymentPhase?: boolean;
  isCreatedRoom?: boolean;
}

export interface LobbyOptions {
  onPeerReady?: (context: PeerReadyContext) => void;
  onRoleAssigned?: (role: 'host' | 'guest') => void;
  sessionStore?: SessionStore;
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
  private hostArmyId: string = 'frontier-wardens-starter';
  private guestArmyId: string = 'rust-raiders-starter';
  private useDeploymentPhase: boolean = true;
  private sessionStore: SessionStore;
  private initialRoomCode: string | null = null;
  private isCreatedRoom: boolean = false;

  constructor(container: HTMLElement, options: LobbyOptions = {}) {
    this.container = container;
    this.options = options;
    this.sessionStore = options.sessionStore ?? defaultSessionStore;
    this.signalingClient = new SignalingClient();
    this.setupSignalingHandlers();
  }

  async init(): Promise<void> {
    await this.signalingClient.connect();
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        const roomParam = params.get('room');
        if (roomParam) {
          this.initialRoomCode = roomParam.toUpperCase();
        }
      } catch (e) {
        console.warn('[Lobby] Failed to read URL room parameter:', e);
      }
    }
    this.render();
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  show(): void {
    this.container.style.display = '';
  }

  /** Reset back to the initial lobby screen (e.g. after a game ends). */
  reset(): void {
    this.webrtcClient?.close();
    this.webrtcClient = null;
    if (this.roomCode) {
      this.signalingClient.send({ type: 'leave-room' });
    }
    this.updateUrlRoomCode(null);
    this.roomCode = null;
    this.role = null;
    this.peerReadyFired = false;
    this.isCreatedRoom = false;
    this.show();
    this.render();
  }

  private updateUrlRoomCode(code: string | null): void {
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    try {
      const url = new URL(window.location.href);
      if (code) {
        url.searchParams.set('room', code.toUpperCase());
      } else {
        url.searchParams.delete('room');
      }
      window.history.replaceState({}, '', url.toString());
    } catch (e) {
      console.warn('[Lobby] Failed to update URL room code:', e);
    }
  }

  private setupSignalingHandlers(): void {
    this.signalingClient.on('room-created', (msg: any) => {
      this.roomCode = msg.code;
      this.role = 'host';
      this.updateUrlRoomCode(msg.code);
      this.options.onRoleAssigned?.('host');
      this.webrtcClient = new WebRTCClient();
      this.setupWebRTCAsHost();
      this.render();
    });

    this.signalingClient.on('room-joined', async (msg: any) => {
      this.roomCode = msg.code;
      const assignedRole: 'host' | 'guest' = (msg.role as 'host' | 'guest') || 'guest';
      this.role = assignedRole;
      this.updateUrlRoomCode(msg.code);
      this.options.onRoleAssigned?.(assignedRole);
      this.webrtcClient = new WebRTCClient();
      if (assignedRole === 'host') {
        await this.setupWebRTCAsHost();
      } else {
        await this.setupWebRTCAsGuest();
      }
      this.render();
    });

    this.signalingClient.on('peer-joined', async () => {
      if (this.role === 'host') {
        this.peerReadyFired = false;
        this.webrtcClient?.close();
        this.webrtcClient = new WebRTCClient();
        await this.setupWebRTCAsHost();
        await this.createAndSendOffer();
      } else if (this.role === 'guest') {
        this.peerReadyFired = false;
        this.webrtcClient?.close();
        this.webrtcClient = new WebRTCClient();
        await this.setupWebRTCAsGuest();
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
      // Ignore peer disconnect notices once the P2P game has already handed off
      // (full mid-game reconnection is Phase 7).
      if (this.peerReadyFired) {
        console.warn('Signaling notice:', msg.message);
        return;
      }
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
    client.on('state-update', (msg: any) => this.maybeFirePeerReady(msg.state));
    client.on('state-sync', (msg: any) => this.maybeFirePeerReady(msg.state));
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
  private maybeFirePeerReady(rejoiningState?: any): void {
    if (this.peerReadyFired || !this.webrtcClient || !this.role || !this.roomCode) return;
    if (!this.webrtcClient.isConnected()) return;
    this.peerReadyFired = true;
    this.options.onPeerReady?.({
      webrtcClient: this.webrtcClient,
      signalingClient: this.signalingClient,
      role: this.role,
      roomCode: this.roomCode,
      initialState: rejoiningState,
      hostArmyId: this.hostArmyId,
      guestArmyId: this.guestArmyId,
      useDeploymentPhase: this.useDeploymentPhase,
      isCreatedRoom: this.isCreatedRoom,
    });
  }

  private render(): void {
    if (this.roomCode && this.role) {
      this.container.innerHTML = `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 60px auto; padding: 30px; background: rgba(18, 22, 28, 0.95); border: 1px solid #37474f; border-radius: 12px; color: #eee; text-align: center;">
          <h1 style="margin-top: 0; color: #ffd54f;">SkirmishLab</h1>
          <h2 style="font-size: 28px; letter-spacing: 2px; color: #29b6f6; margin: 16px 0;">Room: ${this.roomCode}</h2>
          <p style="font-size: 15px; color: #b0bec5;">Role: <strong style="color: ${this.role === 'host' ? '#29b6f6' : '#ef5350'}">${this.role.toUpperCase()}</strong></p>
          <p id="status" style="font-size: 14px; color: #ffd54f;">Waiting for peer...</p>
        </div>
      `;
    } else {
      const activeSession = this.sessionStore.getActiveSession();
      const hasActiveSession = this.sessionStore.isSessionValid(activeSession);
      const prefillCode = this.initialRoomCode || '';

      const resumeBannerHtml = hasActiveSession && activeSession ? `
        <div id="resumeBanner" style="margin-bottom: 20px; background: rgba(41, 182, 246, 0.15); border: 1px solid #29b6f6; border-radius: 8px; padding: 14px; text-align: left;">
          <div style="font-size: 14px; font-weight: bold; color: #ffd54f; margin-bottom: 6px;">
            ⚠️ Active Game Detected (Room ${activeSession.roomCode})
          </div>
          <div style="font-size: 13px; color: #b0bec5; margin-bottom: 12px;">
            You have an ongoing match as <strong style="color: #29b6f6; text-transform: uppercase;">${activeSession.role.toUpperCase()}</strong>. Reconnect within the 5-minute grace window to resume.
          </div>
          <div style="display: flex; gap: 8px;">
            <button id="resumeBtn" style="padding: 8px 16px; font-size: 13px; font-weight: 600; background: #29b6f6; color: #12161c; border: none; border-radius: 4px; cursor: pointer;">
              Resume Match
            </button>
            <button id="abandonBtn" style="padding: 8px 14px; font-size: 13px; font-weight: 600; background: #37474f; color: #eee; border: none; border-radius: 4px; cursor: pointer;">
              Abandon Game
            </button>
          </div>
        </div>
      ` : '';

      this.container.innerHTML = `
        <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 40px auto; padding: 30px; background: rgba(18, 22, 28, 0.92); border: 1px solid #37474f; border-radius: 12px; color: #eee; text-align: center;">
          <h1 style="margin-top: 0; color: #ffd54f;">SkirmishLab</h1>
          <p style="color: #b0bec5; font-size: 14px; margin-bottom: 24px;">One Page Rules Skirmish Simulator</p>

          ${resumeBannerHtml}

          <div style="margin-bottom: 24px; text-align: left; background: rgba(26, 31, 41, 0.7); padding: 16px; border-radius: 8px; border: 1px solid #2a3442;">
            <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 13px; color: #90caf9; text-transform: uppercase; letter-spacing: 0.5px;">Match Forces (Starter Armies)</h3>
            <div style="margin-bottom: 12px;">
              <label style="display: block; font-size: 12px; color: #29b6f6; margin-bottom: 4px; font-weight: 600;">Host Force (South):</label>
              <select id="hostArmySelect" style="width: 100%; padding: 8px 10px; background: #12161c; border: 1px solid #37474f; color: #eee; border-radius: 4px; font-size: 13px;">
                <option value="frontier-wardens-starter" ${this.hostArmyId === 'frontier-wardens-starter' ? 'selected' : ''}>Frontier Wardens (300 pts) — Outpost Defenders</option>
                <option value="rust-raiders-starter" ${this.hostArmyId === 'rust-raiders-starter' ? 'selected' : ''}>Rust Raiders (300 pts) — Scavenger Incursion</option>
              </select>
            </div>
            <div style="margin-bottom: 14px;">
              <label style="display: block; font-size: 12px; color: #ef5350; margin-bottom: 4px; font-weight: 600;">Guest Force (North):</label>
              <select id="guestArmySelect" style="width: 100%; padding: 8px 10px; background: #12161c; border: 1px solid #37474f; color: #eee; border-radius: 4px; font-size: 13px;">
                <option value="rust-raiders-starter" ${this.guestArmyId === 'rust-raiders-starter' ? 'selected' : ''}>Rust Raiders (300 pts) — Scavenger Incursion</option>
                <option value="frontier-wardens-starter" ${this.guestArmyId === 'frontier-wardens-starter' ? 'selected' : ''}>Frontier Wardens (300 pts) — Outpost Defenders</option>
              </select>
            </div>
            <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #ffd54f; cursor: pointer; user-select: none;">
              <input type="checkbox" id="deployPhaseCheck" ${this.useDeploymentPhase ? 'checked' : ''} />
              <span>Interactive Pre-Match Deployment (12" Zones)</span>
            </label>
          </div>

          <div style="display: flex; flex-direction: column; gap: 16px;">
            <button id="createBtn" style="padding: 12px 24px; font-size: 15px; font-weight: 600; background: #29b6f6; color: #12161c; border: none; border-radius: 6px; cursor: pointer;">Create Room (Host)</button>
            <div style="display: flex; gap: 8px;">
              <input id="codeInput" placeholder="XXX-XXX" value="${prefillCode}" style="flex: 1; padding: 10px; font-size: 14px; text-transform: uppercase; background: #12161c; border: 1px solid #37474f; color: #eee; border-radius: 6px;" />
              <button id="joinBtn" style="padding: 10px 20px; font-size: 14px; font-weight: 600; background: #455a64; color: #eee; border: none; border-radius: 6px; cursor: pointer;">Join Room (Guest)</button>
            </div>
          </div>
        </div>
      `;

      if (hasActiveSession && activeSession) {
        this.container.querySelector('#resumeBtn')?.addEventListener('click', () => {
          this.isCreatedRoom = false;
          this.signalingClient.joinRoom(activeSession.roomCode);
        });

        this.container.querySelector('#abandonBtn')?.addEventListener('click', () => {
          this.sessionStore.clearActiveSession();
          this.sessionStore.clearSnapshot(activeSession.roomCode);
          this.updateUrlRoomCode(null);
          this.initialRoomCode = null;
          this.render();
        });
      }

      const hostSelect = this.container.querySelector<HTMLSelectElement>('#hostArmySelect');
      hostSelect?.addEventListener('change', () => {
        this.hostArmyId = hostSelect.value;
      });

      const guestSelect = this.container.querySelector<HTMLSelectElement>('#guestArmySelect');
      guestSelect?.addEventListener('change', () => {
        this.guestArmyId = guestSelect.value;
      });

      const deployCheck = this.container.querySelector<HTMLInputElement>('#deployPhaseCheck');
      deployCheck?.addEventListener('change', () => {
        this.useDeploymentPhase = deployCheck.checked;
      });

      this.container.querySelector('#createBtn')?.addEventListener('click', () => {
        this.isCreatedRoom = true;
        this.signalingClient.createRoom();
      });

      this.container.querySelector('#joinBtn')?.addEventListener('click', () => {
        this.isCreatedRoom = false;
        const input = this.container.querySelector<HTMLInputElement>('#codeInput');
        if (input && input.value) {
          this.signalingClient.joinRoom(input.value.toUpperCase());
        }
      });
    }
  }
}
