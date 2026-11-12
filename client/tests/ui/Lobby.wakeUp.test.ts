// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Lobby } from '../../src/ui/Lobby';
import {
  WAKE_UP_NOTICE_DELAY_MS,
  FIRST_CONNECT_RETRY_DELAY_MS,
  FIRST_CONNECT_GIVE_UP_MS,
  ROOM_REQUEST_SLOW_DELAY_MS,
  ROOM_REQUEST_TIMEOUT_MS,
} from '../../src/ui/connectionStatus';
import { SessionStore } from '../../src/storage/SessionStore';
import { MapStore } from '../../src/storage/MapStore';
import { BuildInfo } from '../../src/buildInfo';

const testBuild: BuildInfo = { commit: 'a1b2c3d', builtAt: '2026-11-12T00:00:00.000Z' };

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => Array.from(m.keys())[i] ?? null,
    get length() {
      return m.size;
    },
  };
}

interface PendingAttempt {
  resolve: () => void;
  reject: (err?: unknown) => void;
}

class FakeSignalingClient {
  private handlers = new Map<string, Array<(msg: any) => void>>();
  public attempts: PendingAttempt[] = [];
  public connectBehavior: 'pending' | 'resolve' | 'reject' = 'pending';

  public connect = vi.fn(() => {
    if (this.connectBehavior === 'resolve') {
      return Promise.resolve();
    }
    if (this.connectBehavior === 'reject') {
      return Promise.reject(new Error('WebSocket failed'));
    }
    return new Promise<void>((resolve, reject) => {
      this.attempts.push({ resolve, reject });
    });
  });

  public send = vi.fn();
  public createRoom = vi.fn();
  public joinRoom = vi.fn();
  public disconnect = vi.fn();

  on(type: string, handler: (msg: any) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  emit(type: string, msg: any = { type }): void {
    for (const h of this.handlers.get(type) ?? []) {
      h(msg);
    }
  }

  resolveLatest(): void {
    const attempt = this.attempts[this.attempts.length - 1];
    if (!attempt) throw new Error('No pending connect attempt');
    attempt.resolve();
  }

  rejectLatest(err: unknown = new Error('WebSocket error')): void {
    const attempt = this.attempts[this.attempts.length - 1];
    if (!attempt) throw new Error('No pending connect attempt');
    attempt.reject(err);
  }
}

describe('Lobby wake-up loading indicator (14G)', () => {
  let container: HTMLElement;
  let lobbies: Lobby[];
  let signaling: FakeSignalingClient;
  let sessionStore: SessionStore;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    lobbies = [];
    signaling = new FakeSignalingClient();
    sessionStore = new SessionStore(memoryStorage());
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    lobbies.forEach((l) => l.destroy());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function makeLobby(extra: { onOpenMapEditor?: () => void } = {}): Lobby {
    const lobby = new Lobby(container, {
      signalingClient: signaling as any,
      sessionStore,
      mapStore: new MapStore(memoryStorage()),
      buildInfo: testBuild,
      checkForNewVersion: async () => false,
      reloadPage: () => {},
      ...extra,
    });
    lobbies.push(lobby);
    return lobby;
  }

  async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it('defines the agreed named timing constants (1.5 s, 3 s, 10 s, 60 s)', () => {
    expect(WAKE_UP_NOTICE_DELAY_MS).toBe(1500);
    expect(FIRST_CONNECT_RETRY_DELAY_MS).toBe(3000);
    expect(FIRST_CONNECT_GIVE_UP_MS).toBe(60000);
    expect(ROOM_REQUEST_SLOW_DELAY_MS).toBe(10000);
    expect(ROOM_REQUEST_TIMEOUT_MS).toBe(60000);
  });

  it('renders the lobby card and footer immediately while connect() is still pending', () => {
    const lobby = makeLobby();
    void lobby.init();

    expect(signaling.connect).toHaveBeenCalledTimes(1);
    expect(container.querySelector('#createBtn')).toBeTruthy();
    expect(container.querySelector('#joinBtn')).toBeTruthy();
    expect(container.querySelector('#codeInput')).toBeTruthy();
    expect(container.querySelector('#openMapEditorBtn')).toBeTruthy();
    expect(container.querySelector('#lobbyFooter')).toBeTruthy();
  });

  it('shows no status text at 1.4 s, shows spinner and waking-up text at 1.5 s, and clears once connected', async () => {
    const lobby = makeLobby();
    void lobby.init();

    const status = () => container.querySelector('#connectionStatus') as HTMLElement;
    expect(status().textContent).toBe('');
    expect(status().querySelector('.sl-spinner')).toBeNull();

    vi.advanceTimersByTime(1400);
    expect(status().textContent).toBe('');
    expect(status().querySelector('.sl-spinner')).toBeNull();

    vi.advanceTimersByTime(100);
    expect(status().textContent).toBe('Waking up the server, this can take up to a minute…');
    expect(status().querySelector('.sl-spinner')).toBeTruthy();

    signaling.resolveLatest();
    await flushMicrotasks();

    expect(status().textContent).toBe('');
    expect(status().querySelector('.sl-spinner')).toBeNull();
  });

  it('disables Create, Join, and Resume until connected while keeping Map Builder and pickers usable throughout', async () => {
    sessionStore.saveActiveSession({
      roomCode: 'RES-123',
      role: 'guest',
      playerId: 'player-guest',
      playerName: 'Guest',
      timestamp: Date.now(),
    });
    const onOpenMapEditor = vi.fn();
    const lobby = makeLobby({ onOpenMapEditor });
    void lobby.init();

    const createBtn = () => container.querySelector('#createBtn') as HTMLButtonElement;
    const joinBtn = () => container.querySelector('#joinBtn') as HTMLButtonElement;
    const resumeBtn = () => container.querySelector('#resumeBtn') as HTMLButtonElement;
    const mapEditorBtn = () => container.querySelector('#openMapEditorBtn') as HTMLButtonElement;
    const mapSelect = () => container.querySelector('#mapSelect') as HTMLSelectElement;
    const hostSelect = () => container.querySelector('#hostArmySelect') as HTMLSelectElement;
    const guestSelect = () => container.querySelector('#guestArmySelect') as HTMLSelectElement;

    expect(createBtn().disabled).toBe(true);
    expect(joinBtn().disabled).toBe(true);
    expect(resumeBtn().disabled).toBe(true);
    expect(mapEditorBtn().disabled).toBe(false);
    expect(mapSelect().disabled).toBe(false);
    expect(hostSelect().disabled).toBe(false);
    expect(guestSelect().disabled).toBe(false);

    // Map Builder works while connecting
    mapEditorBtn().click();
    expect(onOpenMapEditor).toHaveBeenCalledTimes(1);

    // Clicking disabled Create / Join / Resume does nothing while connecting
    createBtn().click();
    joinBtn().click();
    resumeBtn().click();
    expect(signaling.createRoom).not.toHaveBeenCalled();
    expect(signaling.joinRoom).not.toHaveBeenCalled();

    // Once connected, Create / Join / Resume are enabled
    signaling.resolveLatest();
    await flushMicrotasks();

    expect(createBtn().disabled).toBe(false);
    expect(joinBtn().disabled).toBe(false);
    expect(resumeBtn().disabled).toBe(false);
    expect(mapEditorBtn().disabled).toBe(false);
  });

  it('retries a failed first connection every 3 s, gives up at 60 s with error and Try again, and Try again restarts the cycle', async () => {
    signaling.connectBehavior = 'reject';
    const lobby = makeLobby();
    void lobby.init();
    await flushMicrotasks();

    expect(signaling.connect).toHaveBeenCalledTimes(1);

    // At 1.5 s, shows waking-up spinner and text
    vi.advanceTimersByTime(1500);
    await flushMicrotasks();
    const status = () => container.querySelector('#connectionStatus') as HTMLElement;
    expect(status().textContent).toBe('Waking up the server, this can take up to a minute…');
    expect(status().querySelector('.sl-spinner')).toBeTruthy();
    expect(signaling.connect).toHaveBeenCalledTimes(1);

    // At 3.0 s, first retry fires
    vi.advanceTimersByTime(1500);
    await flushMicrotasks();
    expect(signaling.connect).toHaveBeenCalledTimes(2);

    // At 6.0 s, second retry fires
    vi.advanceTimersByTime(3000);
    await flushMicrotasks();
    expect(signaling.connect).toHaveBeenCalledTimes(3);

    // Advance up to 59.9 s (total elapsed 59,900 ms => retries at 3s, 6s, ..., 57s = 20 attempts total)
    await vi.advanceTimersByTimeAsync(53900);
    expect(signaling.connect).toHaveBeenCalledTimes(20);
    expect(container.querySelector('#retryConnectBtn')).toBeNull();

    // At 60.0 s, gives up: shows error message and Try again button, no spinner
    await vi.advanceTimersByTimeAsync(100);
    expect(status().textContent).toContain(
      "Couldn't reach the game server. Check your connection, then try again."
    );
    expect(status().querySelector('.sl-spinner')).toBeNull();
    const retryBtn = container.querySelector('#retryConnectBtn') as HTMLButtonElement;
    expect(retryBtn).toBeTruthy();
    expect(retryBtn.textContent).toBe('Try again');
    expect((container.querySelector('#createBtn') as HTMLButtonElement).disabled).toBe(true);

    // Retries stop after 60 s
    const callsAtGiveUp = signaling.connect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(15000);
    expect(signaling.connect).toHaveBeenCalledTimes(callsAtGiveUp);

    // Clicking Try again starts a fresh 60 s cycle
    signaling.connectBehavior = 'pending';
    retryBtn.click();
    expect(signaling.connect).toHaveBeenCalledTimes(callsAtGiveUp + 1);
    expect(container.querySelector('#retryConnectBtn')).toBeNull();
    expect(status().textContent).toBe('');

    // At 1.5 s into the new cycle, waking up notice appears again
    vi.advanceTimersByTime(1500);
    expect(status().textContent).toBe('Waking up the server, this can take up to a minute…');

    // A later success clears the error and enables buttons
    signaling.resolveLatest();
    await flushMicrotasks();
    expect(status().textContent).toBe('');
    expect(status().querySelector('.sl-spinner')).toBeNull();
    expect((container.querySelector('#createBtn') as HTMLButtonElement).disabled).toBe(false);
    expect((container.querySelector('#joinBtn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Create Room shows progress, adds "still waking up" at 10 s, and clears on room-created', async () => {
    signaling.connectBehavior = 'resolve';
    const lobby = makeLobby();
    await lobby.init();
    await flushMicrotasks();

    const createBtn = () => container.querySelector('#createBtn') as HTMLButtonElement;
    const joinBtn = () => container.querySelector('#joinBtn') as HTMLButtonElement;
    const status = () => container.querySelector('#connectionStatus') as HTMLElement;

    createBtn().click();
    expect(signaling.createRoom).toHaveBeenCalledTimes(1);
    expect(createBtn().disabled).toBe(true);
    expect(joinBtn().disabled).toBe(true);
    expect(status().textContent).toBe('Creating room…');
    expect(status().querySelector('.sl-spinner')).toBeTruthy();

    // At 9.9 s, still "Creating room…"
    vi.advanceTimersByTime(9900);
    expect(status().textContent).toBe('Creating room…');

    // At 10 s, adds "the server is still waking up"
    vi.advanceTimersByTime(100);
    expect(status().textContent).toContain('Creating room…');
    expect(status().textContent).toContain('the server is still waking up');
    expect(status().querySelector('.sl-spinner')).toBeTruthy();

    // Reply clears the pending state and transitions to the waiting room
    signaling.emit('room-created', { type: 'room-created', code: 'ABC-123' });
    expect(container.textContent).toContain('Room: ABC-123');
    expect(container.querySelector('#connectionStatus')).toBeNull();
  });

  it('Create Room with no reply by 60 s shows timeout message and re-enables buttons', async () => {
    signaling.connectBehavior = 'resolve';
    const lobby = makeLobby();
    await lobby.init();
    await flushMicrotasks();

    const createBtn = () => container.querySelector('#createBtn') as HTMLButtonElement;
    const joinBtn = () => container.querySelector('#joinBtn') as HTMLButtonElement;
    const status = () => container.querySelector('#connectionStatus') as HTMLElement;

    createBtn().click();
    expect(createBtn().disabled).toBe(true);

    vi.advanceTimersByTime(60000);
    expect(status().textContent).toBe("The server didn't answer. Try again.");
    expect(status().querySelector('.sl-spinner')).toBeNull();
    expect(createBtn().disabled).toBe(false);
    expect(joinBtn().disabled).toBe(false);
  });

  it('clears the pending room request and re-enables buttons when a server error message arrives', async () => {
    signaling.connectBehavior = 'resolve';
    const lobby = makeLobby();
    await lobby.init();
    await flushMicrotasks();

    const createBtn = () => container.querySelector('#createBtn') as HTMLButtonElement;
    const joinBtn = () => container.querySelector('#joinBtn') as HTMLButtonElement;
    const status = () => container.querySelector('#connectionStatus') as HTMLElement;

    createBtn().click();
    expect(status().textContent).toBe('Creating room…');
    expect(createBtn().disabled).toBe(true);

    signaling.emit('error', { type: 'error', message: 'Room not found' });
    expect(window.alert).toHaveBeenCalledWith('Room not found');
    expect(status().textContent).toBe('');
    expect(status().querySelector('.sl-spinner')).toBeNull();
    expect(createBtn().disabled).toBe(false);
    expect(joinBtn().disabled).toBe(false);
  });

  it('Join Room and active-session Resume use the same "Joining room…" pending state', async () => {
    sessionStore.saveActiveSession({
      roomCode: 'RES-999',
      role: 'guest',
      playerId: 'player-guest',
      playerName: 'Guest',
      timestamp: Date.now(),
    });
    signaling.connectBehavior = 'resolve';
    const lobby = makeLobby();
    await lobby.init();
    await flushMicrotasks();

    const status = () => container.querySelector('#connectionStatus') as HTMLElement;
    const resumeBtn = () => container.querySelector('#resumeBtn') as HTMLButtonElement;
    const joinBtn = () => container.querySelector('#joinBtn') as HTMLButtonElement;
    const codeInput = () => container.querySelector('#codeInput') as HTMLInputElement;

    // Click Resume
    resumeBtn().click();
    expect(signaling.joinRoom).toHaveBeenCalledWith('RES-999');
    expect(status().textContent).toBe('Joining room…');
    expect(status().querySelector('.sl-spinner')).toBeTruthy();
    expect(resumeBtn().disabled).toBe(true);
    expect(joinBtn().disabled).toBe(true);

    vi.advanceTimersByTime(10000);
    expect(status().textContent).toContain('Joining room…');
    expect(status().textContent).toContain('the server is still waking up');

    // Clear via error, then test Join button with room code
    signaling.emit('error', { type: 'error', message: 'Room expired' });
    expect(status().textContent).toBe('');
    expect(joinBtn().disabled).toBe(false);

    codeInput().value = 'xyz-789';
    joinBtn().click();
    expect(signaling.joinRoom).toHaveBeenCalledWith('XYZ-789');
    expect(status().textContent).toBe('Joining room…');
    expect(joinBtn().disabled).toBe(true);

    signaling.emit('room-joined', { type: 'room-joined', code: 'XYZ-789', role: 'guest' });
    await flushMicrotasks();
    expect(container.textContent).toContain('Room: XYZ-789');
  });

  it('preserves the status line and disabled button state across lobby re-renders', () => {
    const lobby = makeLobby();
    void lobby.init();

    vi.advanceTimersByTime(1500);
    const status = () => container.querySelector('#connectionStatus') as HTMLElement;
    expect(status().textContent).toBe('Waking up the server, this can take up to a minute…');

    // Trigger re-renders (both direct render() and F9 dev-mode toggle)
    (lobby as any).render();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9' }));

    expect(status().textContent).toBe('Waking up the server, this can take up to a minute…');
    expect(status().querySelector('.sl-spinner')).toBeTruthy();
    expect((container.querySelector('#createBtn') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('#joinBtn') as HTMLButtonElement).disabled).toBe(true);
  });
});
