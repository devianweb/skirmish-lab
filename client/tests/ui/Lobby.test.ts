// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionStore } from '../../src/storage/SessionStore';
import { Lobby, PeerReadyContext } from '../../src/ui/Lobby';

describe('Lobby UI', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  function createMockStorage(): Storage {
    const memory = new Map<string, string>();
    return {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => memory.set(k, v),
      removeItem: (k: string) => memory.delete(k),
      clear: () => memory.clear(),
      key: (i: number) => Array.from(memory.keys())[i] ?? null,
      get length() {
        return memory.size;
      },
    };
  }

  it('renders starter army selection controls and deployment checkbox', () => {
    const lobby = new Lobby(container);
    (lobby as any).render();

    const hostSelect = container.querySelector('#hostArmySelect') as HTMLSelectElement;
    const guestSelect = container.querySelector('#guestArmySelect') as HTMLSelectElement;
    const deployCheck = container.querySelector('#deployPhaseCheck') as HTMLInputElement;

    expect(hostSelect).toBeTruthy();
    expect(guestSelect).toBeTruthy();
    expect(deployCheck).toBeTruthy();
    expect(deployCheck.checked).toBe(true);

    expect(hostSelect.value).toBe('frontier-wardens-starter');
    expect(guestSelect.value).toBe('rust-raiders-starter');
  });

  it('updates starter force selection and deployment mode on user change', () => {
    const lobby = new Lobby(container);
    (lobby as any).render();

    const hostSelect = container.querySelector('#hostArmySelect') as HTMLSelectElement;
    const deployCheck = container.querySelector('#deployPhaseCheck') as HTMLInputElement;

    hostSelect.value = 'rust-raiders-starter';
    hostSelect.dispatchEvent(new Event('change'));

    deployCheck.checked = false;
    deployCheck.dispatchEvent(new Event('change'));

    expect((lobby as any).hostArmyId).toBe('rust-raiders-starter');
    expect((lobby as any).useDeploymentPhase).toBe(false);
  });

  it('passes selected starter armies and deployment settings to onPeerReady', () => {
    let capturedContext: PeerReadyContext | null = null;
    const lobby = new Lobby(container, {
      onPeerReady: (ctx) => {
        capturedContext = ctx;
      },
    });
    (lobby as any).render();

    const hostSelect = container.querySelector('#hostArmySelect') as HTMLSelectElement;
    hostSelect.value = 'rust-raiders-starter';
    hostSelect.dispatchEvent(new Event('change'));

    (lobby as any).roomCode = 'TEST-123';
    (lobby as any).role = 'host';
    (lobby as any).webrtcClient = {
      isConnected: () => true,
    };

    (lobby as any).maybeFirePeerReady();

    expect(capturedContext).toBeTruthy();
    expect(capturedContext!.hostArmyId).toBe('rust-raiders-starter');
    expect(capturedContext!.guestArmyId).toBe('rust-raiders-starter');
    expect(capturedContext!.useDeploymentPhase).toBe(true);
    expect(capturedContext!.role).toBe('host');
    expect(capturedContext!.roomCode).toBe('TEST-123');
  });

  it('renders active game resume banner when an active session is within the grace window', () => {
    const sessionStore = new SessionStore(createMockStorage());
    sessionStore.saveActiveSession({
      roomCode: 'ABC-123',
      role: 'guest',
      playerId: 'guest1',
      playerName: 'Guest Player',
      timestamp: Date.now(),
    });

    const lobby = new Lobby(container, { sessionStore });
    (lobby as any).render();

    const banner = container.querySelector('#resumeBanner');
    expect(banner).toBeTruthy();
    expect(banner!.textContent).toContain('ABC-123');
    expect(banner!.textContent).toContain('GUEST');

    const resumeBtn = container.querySelector('#resumeBtn');
    const abandonBtn = container.querySelector('#abandonBtn');
    expect(resumeBtn).toBeTruthy();
    expect(abandonBtn).toBeTruthy();
  });

  it('does not render resume banner if active session has expired past 5 minutes', () => {
    const sessionStore = new SessionStore(createMockStorage());
    sessionStore.saveActiveSession({
      roomCode: 'OLD-999',
      role: 'host',
      playerId: 'host1',
      playerName: 'Host Player',
      timestamp: Date.now() - (6 * 60 * 1000), // 6 minutes ago
    });

    const lobby = new Lobby(container, { sessionStore });
    (lobby as any).render();

    const banner = container.querySelector('#resumeBanner');
    expect(banner).toBeNull();
  });

  it('clicking resume button attempts to join the saved room', () => {
    const sessionStore = new SessionStore(createMockStorage());
    sessionStore.saveActiveSession({
      roomCode: 'RES-456',
      role: 'guest',
      playerId: 'guest1',
      playerName: 'Guest Player',
      timestamp: Date.now(),
    });

    const lobby = new Lobby(container, { sessionStore });
    (lobby as any).render();

    const joinRoomSpy = vi.spyOn((lobby as any).signalingClient, 'joinRoom').mockImplementation(() => {});

    const resumeBtn = container.querySelector('#resumeBtn') as HTMLButtonElement;
    resumeBtn.click();

    expect(joinRoomSpy).toHaveBeenCalledWith('RES-456');
    expect((lobby as any).isCreatedRoom).toBe(false);
  });

  it('clicking abandon button clears session, removes snapshot, and re-renders without banner', () => {
    const sessionStore = new SessionStore(createMockStorage());
    sessionStore.saveActiveSession({
      roomCode: 'ABN-789',
      role: 'host',
      playerId: 'host1',
      playerName: 'Host Player',
      timestamp: Date.now(),
    });
    sessionStore.saveSnapshot('ABN-789', {
      board: { width: 44, height: 30 },
      units: [],
      terrain: [],
    } as any);

    const lobby = new Lobby(container, { sessionStore });
    (lobby as any).render();

    expect(container.querySelector('#resumeBanner')).toBeTruthy();

    const abandonBtn = container.querySelector('#abandonBtn') as HTMLButtonElement;
    abandonBtn.click();

    expect(sessionStore.getActiveSession()).toBeNull();
    expect(sessionStore.getSnapshot('ABN-789')).toBeNull();
    expect(container.querySelector('#resumeBanner')).toBeNull();
  });

  it('pre-fills room code input when initialRoomCode is configured', () => {
    const lobby = new Lobby(container);
    (lobby as any).initialRoomCode = 'URL-555';
    (lobby as any).render();

    const input = container.querySelector('#codeInput') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('URL-555');
  });

  it('tracks isCreatedRoom state for create vs join and passes to onPeerReady', () => {
    let capturedContext: PeerReadyContext | null = null;
    const lobby = new Lobby(container, {
      onPeerReady: (ctx) => {
        capturedContext = ctx;
      },
    });
    (lobby as any).render();

    const createBtn = container.querySelector('#createBtn') as HTMLButtonElement;
    createBtn.click();
    expect((lobby as any).isCreatedRoom).toBe(true);

    (lobby as any).roomCode = 'NEW-111';
    (lobby as any).role = 'host';
    (lobby as any).webrtcClient = { isConnected: () => true, close: vi.fn() };
    (lobby as any).maybeFirePeerReady();

    expect(capturedContext!.isCreatedRoom).toBe(true);

    lobby.reset();
    expect((lobby as any).isCreatedRoom).toBe(false);
  });

  it('triggers onOpenMapEditor callback when Map Builder button is clicked', () => {
    const onOpenMapEditorSpy = vi.fn();
    const lobby = new Lobby(container, {
      onOpenMapEditor: onOpenMapEditorSpy,
    });
    (lobby as any).render();

    const openEditorBtn = container.querySelector('#openMapEditorBtn') as HTMLButtonElement;
    expect(openEditorBtn).toBeTruthy();
    openEditorBtn.click();

    expect(onOpenMapEditorSpy).toHaveBeenCalledTimes(1);
  });

  it('renders battlefield map dropdown and passes selected map to onPeerReady', () => {
    let capturedContext: PeerReadyContext | null = null;
    const lobby = new Lobby(container, {
      onPeerReady: (ctx) => {
        capturedContext = ctx;
      },
    });
    (lobby as any).render();

    const mapSelect = container.querySelector('#mapSelect') as HTMLSelectElement;
    expect(mapSelect).toBeTruthy();
    expect(mapSelect.value).toBe('preset:frontier-outpost');

    // Change to Industrial Refinery
    mapSelect.value = 'preset:industrial-refinery';
    mapSelect.dispatchEvent(new Event('change'));

    (lobby as any).roomCode = 'MAP-123';
    (lobby as any).role = 'host';
    (lobby as any).webrtcClient = { isConnected: () => true, close: vi.fn() };
    (lobby as any).maybeFirePeerReady();

    expect(capturedContext).toBeTruthy();
    expect(capturedContext?.mapId).toBe('industrial-refinery');
  });
});
