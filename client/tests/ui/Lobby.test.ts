// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionStore } from '../../src/storage/SessionStore';
import { MapStore } from '../../src/storage/MapStore';
import { createBlankMap, createStandardBattlefieldMap, BUILTIN_MAPS } from '@skirmish-lab/shared';
import { Lobby, PeerReadyContext } from '../../src/ui/Lobby';

describe('Lobby UI', () => {
  let container: HTMLElement;

  // Lobbies register a window keydown listener; remove leftovers from every test.
  const keydownHandlers: EventListener[] = [];
  const realAdd = window.addEventListener.bind(window);

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.spyOn(window, 'addEventListener').mockImplementation((type: any, fn: any, opts?: any) => {
      if (type === 'keydown') keydownHandlers.push(fn);
      realAdd(type, fn, opts);
    });
  });

  afterEach(() => {
    keydownHandlers.splice(0).forEach((fn) => window.removeEventListener('keydown', fn));
    vi.restoreAllMocks();
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
    expect(mapSelect.value).toBe('blank');

    (lobby as any).roomCode = 'MAP-123';
    (lobby as any).role = 'host';
    (lobby as any).webrtcClient = { isConnected: () => true, close: vi.fn() };
    (lobby as any).maybeFirePeerReady();

    expect(capturedContext).toBeTruthy();
    expect(capturedContext?.customMap).toBeUndefined();
  });

  it('map dropdown shows each custom map board size, and the blank option shows the default', () => {
    const mapStore = new MapStore(createMockStorage());
    mapStore.saveMap({ ...createBlankMap(), id: 'm1', name: 'Wide One', board: { width: 44, height: 30 } });
    mapStore.saveMap({ ...createBlankMap(), id: 'm2', name: 'Square One', board: { width: 36, height: 36 } });
    const lobby = new Lobby(container, { mapStore });
    (lobby as any).render();
    const labels = Array.from(container.querySelectorAll('option')).map((o) => o.textContent);
    expect(labels).toContain('Wide One (0 pieces, 44"×30")');
    expect(labels).toContain('Square One (0 pieces, 36"×36")');
    expect(labels.some((l) => l?.includes('Empty Battlefield (48"x48")'))).toBe(true);
  });

  it('lists the Standard Battlefield under Built-in maps and keeps Empty selected by default', () => {
    const lobby = new Lobby(container, {});
    (lobby as any).render();
    const mapSelect = container.querySelector('#mapSelect') as HTMLSelectElement;
    expect(mapSelect.value).toBe('blank');
    const group = Array.from(mapSelect.querySelectorAll('optgroup')).find((g) => g.label === 'Built-in maps');
    expect(group).toBeTruthy();
    const opt = group!.querySelector('option') as HTMLOptionElement;
    expect(opt.value).toBe('builtin:standard-battlefield');
    expect(opt.textContent).toBe('Standard Battlefield (48"×48")');
  });

  it('choosing the built-in map sends a fresh copy as customMap and shows its name', () => {
    let capturedContext: PeerReadyContext | null = null;
    const lobby = new Lobby(container, { onPeerReady: (ctx) => { capturedContext = ctx; } });
    (lobby as any).render();
    const mapSelect = container.querySelector('#mapSelect') as HTMLSelectElement;
    mapSelect.value = 'builtin:standard-battlefield';
    mapSelect.dispatchEvent(new Event('change'));

    (lobby as any).roomCode = 'STD-123';
    (lobby as any).role = 'host';
    (lobby as any).webrtcClient = { isConnected: () => true, close: vi.fn() };
    (lobby as any).maybeFirePeerReady();

    expect(capturedContext!.customMap).toEqual(createStandardBattlefieldMap());
    expect(capturedContext!.customMap).not.toBe(BUILTIN_MAPS['standard-battlefield']());
    expect((lobby as any).getMapDisplayName('builtin:standard-battlefield')).toBe('Standard Battlefield');
    (lobby as any).render();
    expect(container.textContent).toContain('Map: Standard Battlefield');
  });

  it('an unknown built-in id sends no customMap', () => {
    let capturedContext: PeerReadyContext | null = null;
    const lobby = new Lobby(container, { onPeerReady: (ctx) => { capturedContext = ctx; } });
    (lobby as any).selectedMapSelection = 'builtin:nope';
    (lobby as any).roomCode = 'X-1';
    (lobby as any).role = 'host';
    (lobby as any).webrtcClient = { isConnected: () => true, close: vi.fn() };
    (lobby as any).maybeFirePeerReady();
    expect(capturedContext!.customMap).toBeUndefined();
  });

  describe('disclaimer and developer mode', () => {
    const f9 = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9' }));
    let lobby: Lobby;

    beforeEach(() => {
      localStorage.clear();
      document.body.querySelectorAll('.sl-lobby-toast').forEach((e) => e.remove());
    });

    afterEach(() => lobby?.destroy());

    it('shows the unofficial disclaimer and the free-rules link in the footer', () => {
      lobby = new Lobby(container);
      (lobby as any).render();
      const footer = container.querySelector('#lobbyFooter') as HTMLElement;
      expect(footer.textContent).toContain(
        'Unofficial fan project for One Page Rules games. Not affiliated with or endorsed by One Page Rules.'
      );
      expect(footer.textContent).toContain('Full rules: onepagerules.com (free)');
    });

    it('hides TEST armies and the DEV badge by default', () => {
      lobby = new Lobby(container);
      (lobby as any).render();
      expect(container.querySelector('option[value="test-army"]')).toBeNull();
      expect(container.querySelector('option[value="test-squad-army"]')).toBeNull();
      expect(container.querySelector('#devBadge')).toBeNull();
    });

    it('falls back to the default army when a TEST army is selected with dev mode off', () => {
      lobby = new Lobby(container);
      (lobby as any).hostArmyId = 'test-army';
      (lobby as any).guestArmyId = 'test-squad-army';
      (lobby as any).render();
      expect((container.querySelector('#hostArmySelect') as HTMLSelectElement).value).toBe('frontier-wardens-starter');
      expect((container.querySelector('#guestArmySelect') as HTMLSelectElement).value).toBe('rust-raiders-starter');
    });

    it('F9 on the lobby turns dev mode on, then off', () => {
      lobby = new Lobby(container);
      (lobby as any).render();
      f9();
      expect(container.querySelector('#devBadge')).toBeTruthy();
      for (const id of ['hostArmySelect', 'guestArmySelect']) {
        expect(container.querySelector(`#${id} option[value="test-army"]`)).toBeTruthy();
        expect(container.querySelector(`#${id} option[value="test-squad-army"]`)).toBeTruthy();
      }
      expect(document.body.querySelector('.sl-lobby-toast')?.textContent).toBe('Developer mode on');

      f9();
      expect(container.querySelector('#devBadge')).toBeNull();
      expect(container.querySelector('option[value="test-army"]')).toBeNull();
      expect(document.body.querySelector('.sl-lobby-toast')?.textContent).toBe('Developer mode off');
    });

    it('persists dev mode into a new Lobby', () => {
      lobby = new Lobby(container);
      (lobby as any).render();
      f9();
      lobby.destroy();
      lobby = new Lobby(container);
      (lobby as any).render();
      expect(container.querySelector('#devBadge')).toBeTruthy();
      expect(container.querySelector('option[value="test-army"]')).toBeTruthy();
    });

    it('turning dev mode off resets a selected TEST army to the default', () => {
      lobby = new Lobby(container);
      (lobby as any).render();
      f9();
      const sel = container.querySelector('#hostArmySelect') as HTMLSelectElement;
      sel.value = 'test-army';
      sel.dispatchEvent(new Event('change'));
      f9();
      expect((lobby as any).hostArmyId).toBe('frontier-wardens-starter');
    });

    it('does not hand a TEST army to the game when dev mode is off', () => {
      let ctx: PeerReadyContext | null = null;
      lobby = new Lobby(container, { onPeerReady: (c) => { ctx = c; } });
      (lobby as any).hostArmyId = 'test-army';
      (lobby as any).roomCode = 'X-1';
      (lobby as any).role = 'host';
      (lobby as any).webrtcClient = { isConnected: () => true, close: vi.fn() };
      (lobby as any).maybeFirePeerReady();
      expect(ctx!.hostArmyId).toBe('frontier-wardens-starter');
    });

    it('ignores F9 while the lobby is hidden (in-game F9 is the LoS debugger)', () => {
      lobby = new Lobby(container);
      (lobby as any).render();
      lobby.hide();
      f9();
      expect(localStorage.getItem('skirmish_lab_dev_mode')).toBeNull();
      lobby.show();
      f9();
      expect(localStorage.getItem('skirmish_lab_dev_mode')).toBe('1');
    });
  });
});
