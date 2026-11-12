import { BUILTIN_MAPS, CustomMapDefinition, createBlankMap, DEFAULT_BOARD_SIZE } from '@skirmish-lab/shared';
import { SignalingClient } from '../network/SignalingClient';
import { WebRTCClient } from '../network/WebRTCClient';
import { defaultMapStore, MapStore } from '../storage/MapStore';
import { defaultSessionStore, SessionStore } from '../storage/SessionStore';
import { isDevMode, toggleDevMode, isDevOnlyArmy } from './devMode';
import { BuildInfo, checkForNewVersion, formatBuildStamp, getBuildInfo } from '../buildInfo';
import {
  createInitialConnectionState,
  FIRST_CONNECT_GIVE_UP_MS,
  FIRST_CONNECT_RETRY_DELAY_MS,
  getConnectionStatusView,
  LobbyConnectionState,
  ROOM_REQUEST_SLOW_DELAY_MS,
  ROOM_REQUEST_TIMEOUT_MS,
  WAKE_UP_NOTICE_DELAY_MS,
} from './connectionStatus';

const DEFAULT_HOST_ARMY = 'hdf';
const DEFAULT_GUEST_ARMY = 'orc-marauders';
export const LOBBY_DISCLAIMER =
  'Unofficial fan project for One Page Rules games. Not affiliated with or endorsed by One Page Rules.';

let spinnerStyleInjected = false;
function ensureSpinnerStyles(): void {
  if (spinnerStyleInjected || typeof document === 'undefined') return;
  spinnerStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = '@keyframes sl-lobby-spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}

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
  customMap?: CustomMapDefinition;
}

export interface LobbyOptions {
  onPeerReady?: (context: PeerReadyContext) => void;
  onRoleAssigned?: (role: 'host' | 'guest') => void;
  onOpenMapEditor?: () => void;
  sessionStore?: SessionStore;
  mapStore?: MapStore;
  signalingClient?: SignalingClient;
  /** This tab's build (defaults to the injected build constants). */
  buildInfo?: BuildInfo;
  /** Resolves true when a newer build is deployed (defaults to fetching version.json). */
  checkForNewVersion?: () => Promise<boolean>;
  /** Reloads the page from the network (defaults to location.reload). */
  reloadPage?: () => void;
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
  private hostArmyId: string = DEFAULT_HOST_ARMY;
  private guestArmyId: string = DEFAULT_GUEST_ARMY;
  private useDeploymentPhase: boolean = true;
  private sessionStore: SessionStore;
  private mapStore: MapStore;
  private selectedMapSelection: string = 'blank';
  private initialRoomCode: string | null = null;
  private isCreatedRoom: boolean = false;
  private keydownHandler: (event: KeyboardEvent) => void;
  private buildInfo: BuildInfo;
  private newVersionAvailable = false;
  private connectionState: LobbyConnectionState = createInitialConnectionState();
  private connectCycleId = 0;
  private wakeUpNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  private connectRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private connectGiveUpTimer: ReturnType<typeof setTimeout> | null = null;
  private roomSlowTimer: ReturnType<typeof setTimeout> | null = null;
  private roomTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement, options: LobbyOptions = {}) {
    this.container = container;
    this.options = options;
    this.buildInfo = options.buildInfo ?? getBuildInfo();
    this.sessionStore = options.sessionStore ?? defaultSessionStore;
    this.mapStore = options.mapStore ?? defaultMapStore;
    this.signalingClient = options.signalingClient ?? new SignalingClient();
    this.setupSignalingHandlers();
    // Developer mode toggle: F9 only while the lobby is showing (in game F9 is the LoS debugger).
    this.keydownHandler = (event: KeyboardEvent) => {
      if (event.key !== 'F9' || this.container.style.display === 'none') return;
      event.preventDefault();
      const on = toggleDevMode();
      this.sanitizeArmySelection();
      this.render();
      this.showToast(on ? 'Developer mode on' : 'Developer mode off');
    };
    if (typeof window !== 'undefined') window.addEventListener('keydown', this.keydownHandler);
  }

  /** Remove the global key listener and pending timers (tests / teardown). */
  destroy(): void {
    this.connectCycleId++;
    this.clearConnectTimers();
    this.clearRoomRequestTimers();
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this.keydownHandler);
  }

  /** TEST armies are only valid in developer mode; otherwise fall back to the defaults. */
  private sanitizeArmySelection(): void {
    if (isDevMode()) return;
    if (isDevOnlyArmy(this.hostArmyId)) this.hostArmyId = DEFAULT_HOST_ARMY;
    if (isDevOnlyArmy(this.guestArmyId)) this.guestArmyId = DEFAULT_GUEST_ARMY;
  }

  private showToast(text: string): void {
    if (typeof document === 'undefined') return;
    document.body.querySelectorAll('.sl-lobby-toast').forEach((e) => e.remove());
    const toast = document.createElement('div');
    toast.className = 'sl-lobby-toast';
    toast.textContent = text;
    toast.style.cssText =
      'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:8px 16px;background:#263238;color:#ffd54f;border:1px solid #37474f;border-radius:6px;font:600 13px Arial,sans-serif;z-index:10000;';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  async init(): Promise<void> {
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
    this.startFirstConnection();
    this.render();
    void this.runVersionCheck();
  }

  private clearConnectTimers(): void {
    if (this.wakeUpNoticeTimer !== null) {
      clearTimeout(this.wakeUpNoticeTimer);
      this.wakeUpNoticeTimer = null;
    }
    if (this.connectRetryTimer !== null) {
      clearTimeout(this.connectRetryTimer);
      this.connectRetryTimer = null;
    }
    if (this.connectGiveUpTimer !== null) {
      clearTimeout(this.connectGiveUpTimer);
      this.connectGiveUpTimer = null;
    }
  }

  private clearRoomRequestTimers(): void {
    if (this.roomSlowTimer !== null) {
      clearTimeout(this.roomSlowTimer);
      this.roomSlowTimer = null;
    }
    if (this.roomTimeoutTimer !== null) {
      clearTimeout(this.roomTimeoutTimer);
      this.roomTimeoutTimer = null;
    }
  }

  private startFirstConnection(): void {
    this.clearConnectTimers();
    this.clearRoomRequest();
    const cycleId = ++this.connectCycleId;
    const startedAt = Date.now();
    this.connectionState.connection = 'connecting-quiet';
    this.applyConnectionStatus();

    this.wakeUpNoticeTimer = setTimeout(() => {
      this.wakeUpNoticeTimer = null;
      if (this.connectCycleId !== cycleId) return;
      if (this.connectionState.connection === 'connecting-quiet') {
        this.connectionState.connection = 'connecting-slow';
        this.applyConnectionStatus();
      }
    }, WAKE_UP_NOTICE_DELAY_MS);

    this.connectGiveUpTimer = setTimeout(() => {
      this.connectGiveUpTimer = null;
      if (this.connectCycleId !== cycleId) return;
      if (this.connectionState.connection === 'connected') return;
      this.connectCycleId++;
      this.clearConnectTimers();
      this.signalingClient.disconnect?.();
      this.connectionState.connection = 'failed';
      this.applyConnectionStatus();
    }, FIRST_CONNECT_GIVE_UP_MS);

    this.attemptFirstConnect(cycleId, startedAt);
  }

  private attemptFirstConnect(cycleId: number, startedAt: number): void {
    if (this.connectCycleId !== cycleId) return;
    this.signalingClient
      .connect()
      .then(() => {
        if (this.connectCycleId !== cycleId) return;
        this.clearConnectTimers();
        this.connectionState.connection = 'connected';
        this.applyConnectionStatus();
      })
      .catch(() => {
        if (this.connectCycleId !== cycleId) return;
        const elapsed = Date.now() - startedAt;
        if (elapsed + FIRST_CONNECT_RETRY_DELAY_MS >= FIRST_CONNECT_GIVE_UP_MS) {
          return;
        }
        this.connectRetryTimer = setTimeout(() => {
          this.connectRetryTimer = null;
          this.attemptFirstConnect(cycleId, startedAt);
        }, FIRST_CONNECT_RETRY_DELAY_MS);
      });
  }

  private beginRoomRequest(kind: 'create' | 'join'): void {
    this.clearRoomRequestTimers();
    this.connectionState.roomRequest = kind === 'create' ? 'creating' : 'joining';
    this.applyConnectionStatus();

    this.roomSlowTimer = setTimeout(() => {
      this.roomSlowTimer = null;
      if (this.connectionState.roomRequest === 'creating') {
        this.connectionState.roomRequest = 'creating-slow';
        this.applyConnectionStatus();
      } else if (this.connectionState.roomRequest === 'joining') {
        this.connectionState.roomRequest = 'joining-slow';
        this.applyConnectionStatus();
      }
    }, ROOM_REQUEST_SLOW_DELAY_MS);

    this.roomTimeoutTimer = setTimeout(() => {
      this.roomTimeoutTimer = null;
      this.clearRoomRequestTimers();
      this.connectionState.roomRequest = 'timed-out';
      this.applyConnectionStatus();
    }, ROOM_REQUEST_TIMEOUT_MS);
  }

  private clearRoomRequest(): void {
    this.clearRoomRequestTimers();
    if (this.connectionState.roomRequest !== 'none') {
      this.connectionState.roomRequest = 'none';
      this.applyConnectionStatus();
    }
  }

  private applyConnectionStatus(): void {
    if (this.roomCode && this.role) return;
    const view = getConnectionStatusView(this.connectionState);

    for (const selector of ['#createBtn', '#joinBtn', '#resumeBtn']) {
      const btn = this.container.querySelector<HTMLButtonElement>(selector);
      if (btn) {
        btn.disabled = view.buttonsDisabled;
        btn.style.opacity = view.buttonsDisabled ? '0.5' : '1';
        btn.style.cursor = view.buttonsDisabled ? 'not-allowed' : 'pointer';
      }
    }

    const statusEl = this.container.querySelector<HTMLElement>('#connectionStatus');
    if (!statusEl) return;

    statusEl.innerHTML = '';
    if (!view.text && !view.spinner && !view.showRetry) {
      statusEl.style.display = 'none';
      return;
    }

    statusEl.style.display = 'flex';
    if (view.spinner) {
      ensureSpinnerStyles();
      const spinner = document.createElement('span');
      spinner.className = 'sl-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      spinner.style.cssText =
        'width: 14px; height: 14px; border: 2px solid #607d8b; border-top-color: #ffd54f; border-radius: 50%; display: inline-block; flex-shrink: 0; animation: sl-lobby-spin 0.8s linear infinite;';
      statusEl.appendChild(spinner);
    }

    if (view.text) {
      const textSpan = document.createElement('span');
      textSpan.className = 'sl-status-text';
      textSpan.textContent = view.text;
      statusEl.appendChild(textSpan);
    }

    if (view.showRetry) {
      const retryBtn = document.createElement('button');
      retryBtn.id = 'retryConnectBtn';
      retryBtn.type = 'button';
      retryBtn.textContent = 'Try again';
      retryBtn.style.cssText =
        'padding: 5px 12px; font-size: 12px; font-weight: 600; background: #29b6f6; color: #12161c; border: none; border-radius: 4px; cursor: pointer; flex-shrink: 0;';
      retryBtn.addEventListener('click', () => this.startFirstConnection());
      statusEl.appendChild(retryBtn);
    }
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  show(): void {
    this.container.style.display = '';
    void this.runVersionCheck();
  }

  /** Lobby only (never during a game): ask whether a newer build is deployed and show the banner if so. */
  private async runVersionCheck(): Promise<void> {
    try {
      const check = this.options.checkForNewVersion ?? (() => checkForNewVersion({ current: this.buildInfo }));
      if (await check()) {
        this.newVersionAvailable = true;
        this.applyNewVersionBanner();
      }
    } catch {
      // A failed check shows nothing.
    }
  }

  private applyNewVersionBanner(): void {
    if (!this.newVersionAvailable || this.container.querySelector('#newVersionBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'newVersionBanner';
    banner.style.cssText =
      'position: fixed; top: 12px; left: 50%; transform: translateX(-50%); width: min(480px, 90vw); box-sizing: border-box; z-index: 10; font-family: Arial, sans-serif; padding: 10px 16px; background: #263238; color: #ffd54f; border: 1px solid #ffd54f; border-radius: 8px; font-size: 13px; display: flex; align-items: center; justify-content: space-between; gap: 12px;';
    const text = document.createElement('span');
    text.textContent = 'A newer version of SkirmishLab is available.';
    const button = document.createElement('button');
    button.id = 'reloadBtn';
    button.textContent = 'Reload';
    button.style.cssText =
      'padding: 6px 14px; font-size: 13px; font-weight: 600; background: #ffd54f; color: #12161c; border: none; border-radius: 6px; cursor: pointer;';
    button.addEventListener('click', () => (this.options.reloadPage ?? (() => window.location.reload()))());
    banner.append(text, button);
    this.container.prepend(banner);
  }

  /** Reset back to the initial lobby screen (e.g. after a game ends). */
  reset(): void {
    this.clearRoomRequest();
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
      this.clearRoomRequest();
      this.roomCode = msg.code;
      this.role = 'host';
      this.updateUrlRoomCode(msg.code);
      this.options.onRoleAssigned?.('host');
      this.webrtcClient = new WebRTCClient();
      if (typeof RTCPeerConnection !== 'undefined') {
        void this.setupWebRTCAsHost();
      }
      this.render();
    });

    this.signalingClient.on('room-joined', async (msg: any) => {
      this.clearRoomRequest();
      this.roomCode = msg.code;
      const assignedRole: 'host' | 'guest' = (msg.role as 'host' | 'guest') || 'guest';
      this.role = assignedRole;
      if (typeof msg.rejoinToken === 'string') {
        const active = this.sessionStore.getActiveSession();
        if (active && active.roomCode.toUpperCase() === String(msg.code).toUpperCase()) {
          this.sessionStore.saveActiveSession({
            ...active,
            role: assignedRole,
            rejoinToken: msg.rejoinToken,
            timestamp: Date.now(),
          });
        }
      }
      this.updateUrlRoomCode(msg.code);
      this.options.onRoleAssigned?.(assignedRole);
      this.webrtcClient = new WebRTCClient();
      if (typeof RTCPeerConnection !== 'undefined') {
        if (assignedRole === 'host') {
          await this.setupWebRTCAsHost();
        } else {
          await this.setupWebRTCAsGuest();
        }
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
      this.clearRoomRequest();
      alert(msg.message);
    });
  }

  private async setupWebRTCAsHost(): Promise<void> {
    if (!this.webrtcClient || typeof RTCPeerConnection === 'undefined') return;
    await this.webrtcClient.createPeerConnection();
    this.webrtcClient.createDataChannel();
    this.webrtcClient.onIceCandidate((candidate) => {
      this.signalingClient.sendIceCandidate(candidate.toJSON());
    });
    this.registerPeerReadyListeners(this.webrtcClient);
  }

  private async setupWebRTCAsGuest(): Promise<void> {
    if (!this.webrtcClient || typeof RTCPeerConnection === 'undefined') return;
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

  private getMapDisplayName(selection: string): string {
    if (selection === 'blank') return 'Empty Battlefield';
    if (selection.startsWith('custom:')) {
      const customId = selection.replace('custom:', '');
      const map = this.mapStore.getMap(customId);
      return map ? `Custom: ${map.name}` : 'Custom Map';
    }
    if (selection.startsWith('builtin:')) {
      const factory = BUILTIN_MAPS[selection.replace('builtin:', '')];
      return factory ? factory().name : 'Built-in Map';
    }
    return selection;
  }

  /**
   * The first heartbeat ping from the peer proves the data channel is open
   * in both directions — hand the connection to the app exactly once.
   */
  private maybeFirePeerReady(rejoiningState?: any): void {
    if (this.peerReadyFired || !this.webrtcClient || !this.role || !this.roomCode) return;
    if (!this.webrtcClient.isConnected()) return;
    this.peerReadyFired = true;

    let customMap: CustomMapDefinition | undefined;

    if (this.selectedMapSelection.startsWith('custom:')) {
      const customId = this.selectedMapSelection.replace('custom:', '');
      customMap = this.mapStore.getMap(customId) ?? undefined;
    } else if (this.selectedMapSelection.startsWith('builtin:')) {
      customMap = BUILTIN_MAPS[this.selectedMapSelection.replace('builtin:', '')]?.();
    }

    this.sanitizeArmySelection();
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
      customMap,
    });
  }

  private render(): void {
    this.renderScreen();
    this.applyConnectionStatus();
    this.applyNewVersionBanner();
  }

  private renderScreen(): void {
    if (this.roomCode && this.role) {
      this.container.innerHTML = `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 60px auto; padding: 30px; background: rgba(18, 22, 28, 0.95); border: 1px solid #37474f; border-radius: 12px; color: #eee; text-align: center;">
          <h1 style="margin-top: 0; color: #ffd54f;">SkirmishLab</h1>
          <h2 style="font-size: 28px; letter-spacing: 2px; color: #29b6f6; margin: 16px 0;">Room: ${this.roomCode}</h2>
          <p style="font-size: 15px; color: #b0bec5;">Role: <strong style="color: ${this.role === 'host' ? '#29b6f6' : '#ef5350'}">${this.role.toUpperCase()}</strong></p>
          <p style="font-size: 13px; color: #90caf9; margin-bottom: 16px;">Map: <strong style="color: #ffd54f;">${this.getMapDisplayName(this.selectedMapSelection)}</strong></p>
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

      const customMaps = this.mapStore.getMaps();
      const customOptionsHtml = customMaps.length > 0
        ? `
          <optgroup label="Custom Maps">
            ${customMaps.map((m) => `<option value="custom:${m.id}" ${this.selectedMapSelection === `custom:${m.id}` ? 'selected' : ''}>${m.name} (${m.terrain?.length ?? 0} pieces, ${m.board?.width ?? DEFAULT_BOARD_SIZE}"×${m.board?.height ?? DEFAULT_BOARD_SIZE}")</option>`).join('')}
          </optgroup>
        `
        : '';

      const builtinOptionsHtml = `
          <optgroup label="Built-in maps">
            ${Object.entries(BUILTIN_MAPS).map(([id, create]) => {
              const m = create();
              return `<option value="builtin:${id}" ${this.selectedMapSelection === `builtin:${id}` ? 'selected' : ''}>${m.name} (${m.board?.width ?? DEFAULT_BOARD_SIZE}"×${m.board?.height ?? DEFAULT_BOARD_SIZE}")</option>`;
            }).join('')}
          </optgroup>
      `;

      this.sanitizeArmySelection();
      const dev = isDevMode();
      const testOptions = (selected: string) => dev
        ? `<option value="test-army" ${selected === 'test-army' ? 'selected' : ''}>TEST: Single Runner (speed 24") — playtesting</option>
                <option value="test-squad-army" ${selected === 'test-squad-army' ? 'selected' : ''}>TEST: Single Squad (4 models, speed 12") — playtesting</option>
                <option value="test-rules-army" ${selected === 'test-rules-army' ? 'selected' : ''}>TEST: Rules Check (Hero, Blast, Indirect, multi-weapon) — playtesting</option>
                <option value="test-jump-army" ${selected === 'test-jump-army' ? 'selected' : ''}>TEST: Jump Check (squad, Strider squad, Flying squad) — playtesting</option>
                <option value="test-hazard-army" ${selected === 'test-hazard-army' ? 'selected' : ''}>TEST: Hazard Check (5-model squad, Tough 3 Hero, Flying squad) — playtesting</option>
                <option value="test-special-rules-army" ${selected === 'test-special-rules-army' ? 'selected' : ''}>TEST: Special Rules Check (Fast, Slow, Impact, Counter, Assault, Shred, Fear) — playtesting</option>
                <option value="test-scout-ambush-army" ${selected === 'test-scout-ambush-army' ? 'selected' : ''}>TEST: Scout & Ambush Check — playtesting</option>
                <option value="test-loadouts-army" ${selected === 'test-loadouts-army' ? 'selected' : ''}>TEST: Loadouts Check (mixed weapons, two-weapon melee) — playtesting</option>`
        : '';
      const devBadgeHtml = dev
        ? '<div id="devBadge" style="position: fixed; top: 12px; right: 12px; padding: 3px 8px; background: #ffd54f; color: #12161c; font: 700 11px Arial, sans-serif; border-radius: 4px; letter-spacing: 1px;">DEV</div>'
        : '';

      this.container.innerHTML = `
        ${devBadgeHtml}
        <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 40px auto; padding: 30px; background: rgba(18, 22, 28, 0.92); border: 1px solid #37474f; border-radius: 12px; color: #eee; text-align: center;">
          <h1 style="margin-top: 0; color: #ffd54f;">SkirmishLab</h1>
          <p style="color: #b0bec5; font-size: 14px; margin-bottom: 24px;">One Page Rules Skirmish Simulator</p>

          ${resumeBannerHtml}

          <div style="margin-bottom: 24px; text-align: left; background: rgba(26, 31, 41, 0.7); padding: 16px; border-radius: 8px; border: 1px solid #2a3442;">
            <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 13px; color: #90caf9; text-transform: uppercase; letter-spacing: 0.5px;">Battlefield & Forces</h3>
            
            <div style="margin-bottom: 14px;">
              <label style="display: block; font-size: 12px; color: #ffd54f; margin-bottom: 4px; font-weight: 600;">Battlefield Map:</label>
              <select id="mapSelect" style="width: 100%; padding: 8px 10px; background: #12161c; border: 1px solid #37474f; color: #eee; border-radius: 4px; font-size: 13px;">
                <option value="blank" ${this.selectedMapSelection === 'blank' ? 'selected' : ''}>Empty Battlefield (${createBlankMap().board?.width}"x${createBlankMap().board?.height}")</option>
                ${builtinOptionsHtml}
                ${customOptionsHtml}
              </select>
            </div>

            <div style="margin-bottom: 12px;">
              <label style="display: block; font-size: 12px; color: #29b6f6; margin-bottom: 4px; font-weight: 600;">Host Force (South):</label>
              <select id="hostArmySelect" style="width: 100%; padding: 8px 10px; background: #12161c; border: 1px solid #37474f; color: #eee; border-radius: 4px; font-size: 13px;">
                <option value="hdf" ${this.hostArmyId === 'hdf' ? 'selected' : ''}>Human Defense Force (400 pts) — Colonial Line Infantry</option>
                <option value="orc-marauders" ${this.hostArmyId === 'orc-marauders' ? 'selected' : ''}>Orc Marauders (400 pts) — Clan Raiders</option>
                ${testOptions(this.hostArmyId)}
              </select>
            </div>
            <div style="margin-bottom: 14px;">
              <label style="display: block; font-size: 12px; color: #ef5350; margin-bottom: 4px; font-weight: 600;">Guest Force (North):</label>
              <select id="guestArmySelect" style="width: 100%; padding: 8px 10px; background: #12161c; border: 1px solid #37474f; color: #eee; border-radius: 4px; font-size: 13px;">
                <option value="hdf" ${this.guestArmyId === 'hdf' ? 'selected' : ''}>Human Defense Force (400 pts) — Colonial Line Infantry</option>
                <option value="orc-marauders" ${this.guestArmyId === 'orc-marauders' ? 'selected' : ''}>Orc Marauders (400 pts) — Clan Raiders</option>
                ${testOptions(this.guestArmyId)}
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
            <div id="connectionStatus" role="status" aria-live="polite" style="display: none; align-items: center; justify-content: center; gap: 8px; font-size: 13px; color: #b0bec5; flex-wrap: wrap;"></div>
            <button id="openMapEditorBtn" style="padding: 10px 18px; font-size: 13px; font-weight: 600; background: #263238; color: #ffd54f; border: 1px solid #37474f; border-radius: 6px; cursor: pointer;">🛠️ Map Builder</button>
          </div>

          <div id="lobbyFooter" style="margin-top: 24px; padding-top: 14px; border-top: 1px solid #2a3442; font-size: 11px; line-height: 1.5; color: #78909c;">
            <div>${LOBBY_DISCLAIMER}</div>
            <div id="buildStamp" style="margin-top: 4px; color: #607d8b;">${formatBuildStamp(this.buildInfo)}</div>
            <div style="margin-top: 4px;">Full rules: <a href="https://onepagerules.com" target="_blank" rel="noopener noreferrer" style="color: #90caf9;">onepagerules.com</a> (free)</div>
          </div>
        </div>
      `;

      if (hasActiveSession && activeSession) {
        this.container.querySelector('#resumeBtn')?.addEventListener('click', () => {
          if (getConnectionStatusView(this.connectionState).buttonsDisabled) return;
          this.isCreatedRoom = false;
          this.beginRoomRequest('join');
          if (activeSession.rejoinToken) {
            this.signalingClient.joinRoom(activeSession.roomCode, activeSession.rejoinToken);
          } else {
            this.signalingClient.joinRoom(activeSession.roomCode);
          }
        });

        this.container.querySelector('#abandonBtn')?.addEventListener('click', () => {
          this.sessionStore.clearActiveSession();
          this.sessionStore.clearSnapshot(activeSession.roomCode);
          this.updateUrlRoomCode(null);
          this.initialRoomCode = null;
          this.render();
        });
      }

      const mapSelect = this.container.querySelector<HTMLSelectElement>('#mapSelect');
      mapSelect?.addEventListener('change', () => {
        this.selectedMapSelection = mapSelect.value;
      });

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
        if (getConnectionStatusView(this.connectionState).buttonsDisabled) return;
        this.isCreatedRoom = true;
        this.beginRoomRequest('create');
        this.signalingClient.createRoom();
      });

      this.container.querySelector('#joinBtn')?.addEventListener('click', () => {
        if (getConnectionStatusView(this.connectionState).buttonsDisabled) return;
        this.isCreatedRoom = false;
        const input = this.container.querySelector<HTMLInputElement>('#codeInput');
        if (input && input.value) {
          this.beginRoomRequest('join');
          this.signalingClient.joinRoom(input.value.toUpperCase());
        }
      });

      this.container.querySelector('#openMapEditorBtn')?.addEventListener('click', () => {
        this.options.onOpenMapEditor?.();
      });
    }
  }
}
