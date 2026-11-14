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

  it('renders single Your Army selection control and deployment checkbox (no split pickers)', () => {
    const lobby = new Lobby(container);
    (lobby as any).render();

    const armySelect = container.querySelector('#armySelect') as HTMLSelectElement;
    const deployCheck = container.querySelector('#deployPhaseCheck') as HTMLInputElement;

    expect(armySelect).toBeTruthy();
    expect(container.querySelector('#hostArmySelect')).toBeNull();
    expect(container.querySelector('#guestArmySelect')).toBeNull();
    expect(deployCheck).toBeTruthy();
    expect(deployCheck.checked).toBe(true);

    expect(armySelect.value).toBe('hdf');
  });

  it('offers exactly Human Defense Force and Orc Marauders in Your Army without dev mode', () => {
    const lobby = new Lobby(container);
    (lobby as any).render();
    const select = container.querySelector('#armySelect') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['hdf', 'orc-marauders']);
    expect(select.options[0].textContent).toContain('Human Defense Force (400 pts)');
    expect(select.options[1].textContent).toContain('Orc Marauders (400 pts)');
    expect((lobby as any).yourArmyId).toBe('hdf');
    expect((lobby as any).hostArmyId).toBe('hdf');
    expect((lobby as any).guestArmyId).toBe('orc-marauders');
  });

  it('updates Your Army selection and deployment mode on user change', () => {
    const lobby = new Lobby(container);
    (lobby as any).render();

    const armySelect = container.querySelector('#armySelect') as HTMLSelectElement;
    const deployCheck = container.querySelector('#deployPhaseCheck') as HTMLInputElement;

    armySelect.value = 'orc-marauders';
    armySelect.dispatchEvent(new Event('change'));

    deployCheck.checked = false;
    deployCheck.dispatchEvent(new Event('change'));

    expect((lobby as any).yourArmyId).toBe('orc-marauders');
    expect((lobby as any).hostArmyId).toBe('orc-marauders');
    expect((lobby as any).useDeploymentPhase).toBe(false);
  });

  it('passes selected host and guest armies and deployment settings to onPeerReady', () => {
    let capturedContext: PeerReadyContext | null = null;
    const lobby = new Lobby(container, {
      onPeerReady: (ctx) => {
        capturedContext = ctx;
      },
    });
    (lobby as any).render();

    const armySelect = container.querySelector('#armySelect') as HTMLSelectElement;
    armySelect.value = 'orc-marauders';
    armySelect.dispatchEvent(new Event('change'));

    (lobby as any).roomCode = 'TEST-123';
    (lobby as any).role = 'host';
    (lobby as any).webrtcClient = {
      isConnected: () => true,
    };

    (lobby as any).maybeFirePeerReady();

    expect(capturedContext).toBeTruthy();
    expect(capturedContext!.hostArmyId).toBe('orc-marauders');
    expect(capturedContext!.guestArmyId).toBe('orc-marauders');
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

  it('clicking resume button passes the saved rejoinToken to joinRoom and updates it on room-joined', async () => {
    const sessionStore = new SessionStore(createMockStorage());
    sessionStore.saveActiveSession({
      roomCode: 'RES-789',
      role: 'host',
      playerId: 'host1',
      playerName: 'Host Player',
      rejoinToken: 'saved-rejoin-token',
      timestamp: Date.now(),
    });

    const lobby = new Lobby(container, { sessionStore });
    (lobby as any).render();

    const joinRoomSpy = vi.spyOn((lobby as any).signalingClient, 'joinRoom').mockImplementation(() => {});

    const resumeBtn = container.querySelector('#resumeBtn') as HTMLButtonElement;
    resumeBtn.click();

    expect(joinRoomSpy).toHaveBeenCalledWith('RES-789', 'saved-rejoin-token');

    // When room-joined arrives with a rotated rejoinToken, activeSession is updated
    ((lobby as any).signalingClient as any).handleMessage({
      type: 'room-joined',
      code: 'RES-789',
      role: 'host',
      rejoinToken: 'rotated-rejoin-token',
    });
    expect(sessionStore.getActiveSession()?.rejoinToken).toBe('rotated-rejoin-token');
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
      expect(container.querySelector('option[value="test-rules-army"]')).toBeNull();
      expect(container.querySelector('option[value="test-jump-army"]')).toBeNull();
      expect(container.querySelector('#devBadge')).toBeNull();
    });

    it('falls back to the default army when a TEST army is selected with dev mode off', () => {
      lobby = new Lobby(container);
      (lobby as any).yourArmyId = 'test-army';
      (lobby as any).hostArmyId = 'test-army';
      (lobby as any).render();
      expect((container.querySelector('#armySelect') as HTMLSelectElement).value).toBe('hdf');
    });

    it('F9 on the lobby turns dev mode on, then off', () => {
      lobby = new Lobby(container);
      (lobby as any).render();
      f9();
      expect(container.querySelector('#devBadge')).toBeTruthy();
      expect(container.querySelector('#armySelect option[value="test-army"]')).toBeTruthy();
      expect(container.querySelector('#armySelect option[value="test-squad-army"]')).toBeTruthy();
      expect(container.querySelector('#armySelect option[value="test-rules-army"]')).toBeTruthy();
      expect(container.querySelector('#armySelect option[value="test-jump-army"]')).toBeTruthy();
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
      const sel = container.querySelector('#armySelect') as HTMLSelectElement;
      sel.value = 'test-army';
      sel.dispatchEvent(new Event('change'));
      f9();
      expect((lobby as any).yourArmyId).toBe('hdf');
      expect((lobby as any).hostArmyId).toBe('hdf');
    });

    it('does not hand a TEST army to the game when dev mode is off', () => {
      let ctx: PeerReadyContext | null = null;
      lobby = new Lobby(container, { onPeerReady: (c) => { ctx = c; } });
      (lobby as any).hostArmyId = 'test-army';
      (lobby as any).roomCode = 'X-1';
      (lobby as any).role = 'host';
      (lobby as any).webrtcClient = { isConnected: () => true, close: vi.fn() };
      (lobby as any).maybeFirePeerReady();
      expect(ctx!.hostArmyId).toBe('hdf');
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

  describe('HTML escaping and URL sanitization (G-06)', () => {
    it('limits ?room= URL parameter to /^[A-Z0-9-]{0,7}$/ and ignores malicious or invalid input', async () => {
      const origLocation = window.location;
      try {
        // Test malicious script/HTML injection
        delete (window as any).location;
        (window as any).location = { search: '?room=%22%3E%3Cimg%20src=x%20onerror=%22alert(1)%22%3E' };
        const lobby1 = new Lobby(container);
        await lobby1.init();
        expect((lobby1 as any).initialRoomCode).toBeNull();

        // Test overlong string
        (window as any).location = { search: '?room=ROOM-12345' };
        const lobby2 = new Lobby(container);
        await lobby2.init();
        expect((lobby2 as any).initialRoomCode).toBeNull();

        // Test invalid characters
        (window as any).location = { search: '?room=ABC$123' };
        const lobby3 = new Lobby(container);
        await lobby3.init();
        expect((lobby3 as any).initialRoomCode).toBeNull();

        // Test valid format (short code up to 7 chars)
        (window as any).location = { search: '?room=abc-123' };
        const lobby4 = new Lobby(container);
        await lobby4.init();
        expect((lobby4 as any).initialRoomCode).toBe('ABC-123');
      } finally {
        (window as any).location = origLocation;
      }
    });

    it('renders a map name and a room code containing <img src=x onerror=…> as text, not as an element', () => {
      const mapStore = new MapStore(createMockStorage());
      mapStore.saveMap({
        id: 'xss-map',
        name: '<img src=x onerror=alert(1)>',
        board: { width: 48, height: 48 },
        terrain: [],
      });

      const lobby = new Lobby(container, { mapStore });
      (lobby as any).initialRoomCode = '<img src=x onerror=alert(2)>';
      (lobby as any).render();

      // No <img> element should exist in the container
      expect(container.querySelectorAll('img').length).toBe(0);

      // Map name rendered in select option as text
      const mapSelect = container.querySelector('#mapSelect') as HTMLSelectElement;
      expect(mapSelect.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(container.textContent).toContain('<img src=x onerror=alert(1)>');

      // Now test room waiting screen with malicious room code and map name
      (lobby as any).roomCode = '<img src=x onerror=alert(3)>';
      (lobby as any).role = 'host';
      (lobby as any).selectedMapSelection = 'custom:xss-map';
      (lobby as any).render();

      expect(container.querySelectorAll('img').length).toBe(0);
      expect(container.innerHTML).toContain('&lt;img src=x onerror=alert(3)&gt;');
      expect(container.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });
  });

  describe('Reconnect & Reset (G-09, G-24)', () => {
    it('creates and sends an SDP offer when room-joined assigns host role (G-09)', async () => {
      vi.stubGlobal('RTCPeerConnection', class {} as any);
      try {
        const lobby = new Lobby(container, { sessionStore: new SessionStore(createMockStorage()) });
        const setupHostSpy = vi.spyOn(lobby as any, 'setupWebRTCAsHost').mockResolvedValue(undefined);
        const sendOfferSpy = vi.spyOn(lobby as any, 'createAndSendOffer').mockResolvedValue(undefined);

        await (lobby as any).signalingClient.handleMessage({
          type: 'room-joined',
          code: 'RES-100',
          role: 'host',
        });

        await Promise.resolve();
        expect(setupHostSpy).toHaveBeenCalledTimes(1);
        expect(sendOfferSpy).toHaveBeenCalledTimes(1);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('does not send a duplicate offer if peer-joined supersedes room-joined mid-setup (G-09)', async () => {
      vi.stubGlobal('RTCPeerConnection', class {} as any);
      try {
        const lobby = new Lobby(container, { sessionStore: new SessionStore(createMockStorage()) });
        let resolveFirstSetup!: () => void;
        const firstSetupPromise = new Promise<void>((resolve) => {
          resolveFirstSetup = resolve;
        });

        const setupHostSpy = vi
          .spyOn(lobby as any, 'setupWebRTCAsHost')
          .mockImplementationOnce(() => firstSetupPromise)
          .mockResolvedValueOnce(undefined);
        const sendOfferSpy = vi.spyOn(lobby as any, 'createAndSendOffer').mockResolvedValue(undefined);

        const roomJoinedPromise = (lobby as any).signalingClient.handleMessage({
          type: 'room-joined',
          code: 'RES-101',
          role: 'host',
        });

        // Concurrent peer-joined arrives before room-joined's setup resolves
        const peerJoinedPromise = (lobby as any).signalingClient.handleMessage({
          type: 'peer-joined',
        });

        await peerJoinedPromise;
        resolveFirstSetup();
        await roomJoinedPromise;
        await Promise.resolve();
        await Promise.resolve();

        expect(setupHostSpy).toHaveBeenCalledTimes(2);
        // Only the winning peer-joined setup sends an offer
        expect(sendOfferSpy).toHaveBeenCalledTimes(1);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('calls signalingClient.leaveRoom() on Lobby.reset() so room state and rejoinToken clear (G-24)', () => {
      const lobby = new Lobby(container, { sessionStore: new SessionStore(createMockStorage()) });
      const signaling = (lobby as any).signalingClient;
      vi.spyOn(signaling, 'send').mockImplementation(() => {});

      signaling.handleMessage({
        type: 'room-created',
        code: 'RST-123',
        rejoinToken: 'tok-reset-1',
      });
      (lobby as any).roomCode = 'RST-123';
      const leaveSpy = vi.spyOn(signaling, 'leaveRoom');

      lobby.reset();

      expect(leaveSpy).toHaveBeenCalledTimes(1);
      expect((signaling as any).currentRoomCode).toBeNull();
      expect((signaling as any).currentRole).toBeNull();
      expect(signaling.getRejoinToken()).toBeNull();
    });
  });

  describe('14G: Per-player army selection and waiting room sync', () => {
    function makeFakePeerClient() {
      const handlers = new Map<string, Array<(msg: any) => void>>();
      const sent: any[] = [];
      return {
        sent,
        isConnected: () => true,
        close: vi.fn(),
        on: (type: string, fn: (msg: any) => void) => {
          if (!handlers.has(type)) handlers.set(type, []);
          handlers.get(type)!.push(fn);
        },
        send: (msg: any) => sent.push(msg),
        emit: (type: string, msg: any) => {
          (handlers.get(type) ?? []).forEach((fn) => fn(msg));
        },
      };
    }

    it('defaults untouched guest army to orc-marauders on ?room= and Join, while preserving explicit HDF picks', async () => {
      const origLocation = window.location;
      try {
        delete (window as any).location;
        (window as any).location = { search: '?room=GUE-111' };
        const inviteLobby = new Lobby(container);
        await inviteLobby.init();
        expect((container.querySelector('#armySelect') as HTMLSelectElement).value).toBe('orc-marauders');
        inviteLobby.destroy();
      } finally {
        (window as any).location = origLocation;
      }

      // Fresh page without ?room=: untouched click on Join defaults Guest to orc-marauders
      const joinLobby = new Lobby(container);
      (joinLobby as any).connectionState.connection = 'connected';
      (joinLobby as any).render();
      vi.spyOn((joinLobby as any).signalingClient, 'joinRoom').mockImplementation(() => {});
      (container.querySelector('#codeInput') as HTMLInputElement).value = 'ABC-222';
      (container.querySelector('#joinBtn') as HTMLButtonElement).click();
      expect((joinLobby as any).yourArmyId).toBe('orc-marauders');
      expect((joinLobby as any).guestArmyId).toBe('orc-marauders');
      joinLobby.destroy();

      // Explicit HDF pick before Join stays HDF for mirror match
      const mirrorLobby = new Lobby(container);
      (mirrorLobby as any).connectionState.connection = 'connected';
      (mirrorLobby as any).render();
      vi.spyOn((mirrorLobby as any).signalingClient, 'joinRoom').mockImplementation(() => {});
      const sel = container.querySelector('#armySelect') as HTMLSelectElement;
      sel.value = 'hdf';
      sel.dispatchEvent(new Event('change'));
      (container.querySelector('#codeInput') as HTMLInputElement).value = 'ABC-333';
      (container.querySelector('#joinBtn') as HTMLButtonElement).click();
      expect((mirrorLobby as any).yourArmyId).toBe('hdf');
      expect((mirrorLobby as any).guestArmyId).toBe('hdf');
      mirrorLobby.destroy();
    });

    it('keeps Host in waiting room until Guest sends select-army and Host clicks Start Match, syncing edits live', () => {
      let captured: PeerReadyContext | null = null;
      const lobby = new Lobby(container, {
        onPeerReady: (ctx) => {
          captured = ctx;
        },
      });
      (lobby as any).connectionState.connection = 'connected';
      (lobby as any).render();
      vi.spyOn((lobby as any).signalingClient, 'createRoom').mockImplementation(() => {});
      (container.querySelector('#createBtn') as HTMLButtonElement).click();

      const fakeClient = makeFakePeerClient();
      ((lobby as any).signalingClient as any).handleMessage({ type: 'room-created', code: 'HUB-100' });
      (lobby as any).webrtcClient = fakeClient;
      (lobby as any).registerPeerReadyListeners(fakeClient);

      expect(container.querySelector('#hostPickDisplay')!.textContent).toContain('Human Defense Force');
      expect(container.querySelector('#guestPickDisplay')!.textContent).toContain('Waiting for guest');
      const btnBefore = container.querySelector('#startMatchBtn') as HTMLButtonElement;
      expect(btnBefore.disabled).toBe(true);

      // First heartbeat connects peer and sends lobby-state, without auto-starting the match
      fakeClient.emit('heartbeat-ping', { type: 'heartbeat-ping', timestamp: 1 });
      expect(captured).toBeNull();
      expect(fakeClient.sent[0]).toMatchObject({
        type: 'lobby-state',
        hostArmyId: 'hdf',
        guestArmyId: undefined,
      });
      expect((container.querySelector('#startMatchBtn') as HTMLButtonElement).disabled).toBe(true);

      // Guest sends select-army -> Host validates, updates display, broadcasts lobby-state, enables Start Match
      fakeClient.emit('select-army', { type: 'select-army', armyId: 'hdf', playerId: 'player-guest' });
      expect(container.querySelector('#guestPickDisplay')!.textContent).toContain('Human Defense Force');
      expect(fakeClient.sent[fakeClient.sent.length - 1]).toMatchObject({
        type: 'lobby-state',
        hostArmyId: 'hdf',
        guestArmyId: 'hdf',
      });
      const startBtn = container.querySelector('#startMatchBtn') as HTMLButtonElement;
      expect(startBtn.disabled).toBe(false);
      expect(startBtn.textContent).toBe('Start Match');

      // Host changes army in waiting room -> broadcasts updated lobby-state
      const waitSelect = container.querySelector('#armySelect') as HTMLSelectElement;
      waitSelect.value = 'orc-marauders';
      waitSelect.dispatchEvent(new Event('change'));
      expect(container.querySelector('#hostPickDisplay')!.textContent).toContain('Orc Marauders');
      expect(fakeClient.sent[fakeClient.sent.length - 1]).toMatchObject({
        type: 'lobby-state',
        hostArmyId: 'orc-marauders',
        guestArmyId: 'hdf',
      });

      // Host clicks Start Match -> fires onPeerReady with both picks
      (container.querySelector('#startMatchBtn') as HTMLButtonElement).click();
      expect(captured).toBeTruthy();
      expect(captured!.hostArmyId).toBe('orc-marauders');
      expect(captured!.guestArmyId).toBe('hdf');
      lobby.destroy();
    });

    it('guest sends select-army on heartbeat, updates from lobby-state, changes army in waiting room, and launches on state-update', () => {
      let captured: PeerReadyContext | null = null;
      const lobby = new Lobby(container, {
        onPeerReady: (ctx) => {
          captured = ctx;
        },
      });
      const fakeClient = makeFakePeerClient();
      (lobby as any).connectionState.connection = 'connected';
      (lobby as any).render();
      vi.spyOn((lobby as any).signalingClient, 'joinRoom').mockImplementation(() => {});
      (container.querySelector('#codeInput') as HTMLInputElement).value = 'GUE-200';
      (container.querySelector('#joinBtn') as HTMLButtonElement).click();

      ((lobby as any).signalingClient as any).handleMessage({
        type: 'room-joined',
        code: 'GUE-200',
        role: 'guest',
      });
      (lobby as any).webrtcClient = fakeClient;
      (lobby as any).registerPeerReadyListeners(fakeClient);

      expect(container.querySelector('#startMatchBtn')).toBeNull();

      fakeClient.emit('heartbeat-ping', { type: 'heartbeat-ping', timestamp: 1 });
      expect(captured).toBeNull();
      expect(fakeClient.sent[0]).toEqual({
        type: 'select-army',
        armyId: 'orc-marauders',
        playerId: 'player-guest',
      });

      fakeClient.emit('lobby-state', {
        type: 'lobby-state',
        hostArmyId: 'hdf',
        guestArmyId: 'orc-marauders',
        mapName: 'Standard Battlefield',
        useDeploymentPhase: true,
      });
      expect(container.textContent).toContain('Map: Standard Battlefield');
      expect(container.querySelector('#hostPickDisplay')!.textContent).toContain('Human Defense Force');
      expect(container.querySelector('#guestPickDisplay')!.textContent).toContain('Orc Marauders');

      // Guest changes pick in waiting room
      const waitSelect = container.querySelector('#armySelect') as HTMLSelectElement;
      waitSelect.value = 'hdf';
      waitSelect.dispatchEvent(new Event('change'));
      expect(fakeClient.sent[fakeClient.sent.length - 1]).toEqual({
        type: 'select-army',
        armyId: 'hdf',
        playerId: 'player-guest',
      });

      // Host starts game and broadcasts initial state-update -> guest launches into match
      const fakeInitialState = { gameId: 'g1', units: [] };
      fakeClient.emit('state-update', { type: 'state-update', state: fakeInitialState, actionId: 'a1' });
      expect(captured).toBeTruthy();
      expect(captured!.initialState).toEqual(fakeInitialState);
      lobby.destroy();
    });

    it('accepts Guest TEST armies even when Host dev mode is off, rejects unknown IDs, and keeps F9 reset local', () => {
      localStorage.clear();
      let captured: PeerReadyContext | null = null;
      const lobby = new Lobby(container, {
        onPeerReady: (ctx) => {
          captured = ctx;
        },
      });
      const fakeClient = makeFakePeerClient();
      (lobby as any).isCreatedRoom = true;
      (lobby as any).connectionState.connection = 'connected';
      ((lobby as any).signalingClient as any).handleMessage({ type: 'room-created', code: 'VAL-100' });
      (lobby as any).webrtcClient = fakeClient;
      (lobby as any).registerPeerReadyListeners(fakeClient);

      // Unknown / malicious ID falls back to DEFAULT_GUEST_ARMY
      fakeClient.emit('select-army', { type: 'select-army', armyId: 'constructor', playerId: 'player-guest' });
      expect(fakeClient.sent[fakeClient.sent.length - 1]).toMatchObject({
        type: 'lobby-state',
        guestArmyId: 'orc-marauders',
      });

      // Guest TEST army passes even though Host dev mode is OFF
      fakeClient.emit('select-army', { type: 'select-army', armyId: 'test-squad-army', playerId: 'player-guest' });
      expect(container.querySelector('#guestPickDisplay')!.textContent).toContain('TEST: Single Squad');

      // Host turns F9 on, picks a TEST army, then turns F9 off: Host resets to hdf, Guest TEST pick stays intact
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9' }));
      const sel = container.querySelector('#armySelect') as HTMLSelectElement;
      sel.value = 'test-army';
      sel.dispatchEvent(new Event('change'));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9' }));

      expect((container.querySelector('#armySelect') as HTMLSelectElement).value).toBe('hdf');
      expect(container.querySelector('#guestPickDisplay')!.textContent).toContain('TEST: Single Squad');

      (container.querySelector('#startMatchBtn') as HTMLButtonElement).click();
      expect(captured!.hostArmyId).toBe('hdf');
      expect(captured!.guestArmyId).toBe('test-squad-army');
      lobby.destroy();
    });

    it('skips the waiting room on mid-game reconnects via hasActiveMatch or saved resume state', () => {
      let onReadyCount = 0;
      const lobby = new Lobby(container, {
        hasActiveMatch: () => true,
        onPeerReady: () => {
          onReadyCount++;
        },
      });
      const fakeClient = makeFakePeerClient();
      (lobby as any).isCreatedRoom = true;
      (lobby as any).roomCode = 'REC-123';
      (lobby as any).role = 'host';
      (lobby as any).webrtcClient = fakeClient;
      (lobby as any).registerPeerReadyListeners(fakeClient);

      fakeClient.emit('heartbeat-ping', { type: 'heartbeat-ping', timestamp: 1 });
      expect(onReadyCount).toBe(1);
      lobby.destroy();

      // Host resuming an existing room (isCreatedRoom === false) skips waiting room even before GameManager loads snapshot
      let hostResumeCount = 0;
      const hostResumeLobby = new Lobby(container, {
        hasActiveMatch: () => false,
        onPeerReady: () => {
          hostResumeCount++;
        },
      });
      const hostResumeClient = makeFakePeerClient();
      (hostResumeLobby as any).isCreatedRoom = false;
      (hostResumeLobby as any).roomCode = 'REC-124';
      (hostResumeLobby as any).role = 'host';
      (hostResumeLobby as any).webrtcClient = hostResumeClient;
      (hostResumeLobby as any).registerPeerReadyListeners(hostResumeClient);
      hostResumeClient.emit('heartbeat-ping', { type: 'heartbeat-ping', timestamp: 2 });
      expect(hostResumeCount).toBe(1);
      hostResumeLobby.destroy();

      // Guest with a saved local snapshot skips the waiting room on reconnect
      const guestStore = new SessionStore(createMockStorage());
      guestStore.saveSnapshot('REC-125', { gameId: 'saved', board: { width: 48, height: 48 }, units: [], terrain: [] } as any);
      let guestResumeCount = 0;
      const guestResumeLobby = new Lobby(container, {
        sessionStore: guestStore,
        onPeerReady: () => {
          guestResumeCount++;
        },
      });
      const guestResumeClient = makeFakePeerClient();
      (guestResumeLobby as any).isCreatedRoom = false;
      (guestResumeLobby as any).roomCode = 'REC-125';
      (guestResumeLobby as any).role = 'guest';
      (guestResumeLobby as any).webrtcClient = guestResumeClient;
      (guestResumeLobby as any).registerPeerReadyListeners(guestResumeClient);
      guestResumeClient.emit('heartbeat-ping', { type: 'heartbeat-ping', timestamp: 3 });
      expect(guestResumeCount).toBe(1);
      guestResumeLobby.destroy();
    });
  });
});
