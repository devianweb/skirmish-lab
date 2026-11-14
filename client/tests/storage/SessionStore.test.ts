import { describe, expect, it, beforeEach, vi } from 'vitest';
import { SessionStore, ActiveSession } from '../../src/storage/SessionStore';
import { createInitialGameState, applyDefaultScenario } from '@skirmish-lab/shared';
import { GameManager } from '../../src/core/GameManager';

describe('SessionStore', () => {
  let mockStorageData: Record<string, string>;
  let mockStorage: Storage;
  let store: SessionStore;

  beforeEach(() => {
    mockStorageData = {};
    mockStorage = {
      getItem: vi.fn((key: string) => mockStorageData[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorageData[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorageData[key];
      }),
      clear: vi.fn(() => {
        mockStorageData = {};
      }),
      key: vi.fn((idx: number) => Object.keys(mockStorageData)[idx] ?? null),
      get length() {
        return Object.keys(mockStorageData).length;
      },
    } as unknown as Storage;

    store = new SessionStore(mockStorage);
  });

  describe('Active Session Management', () => {
    const dummySession: ActiveSession = {
      roomCode: 'ABC-123',
      role: 'host',
      playerId: 'host-player',
      playerName: 'Commander',
      armyId: 'hdf',
      timestamp: Date.now(),
    };

    it('saves and retrieves active session metadata', () => {
      store.saveActiveSession(dummySession);
      const retrieved = store.getActiveSession();
      expect(retrieved).toEqual(dummySession);
    });

    it('stores rejoinToken and preserves it across subsequent saves for the same room and role', () => {
      store.saveActiveSession({ ...dummySession, rejoinToken: 'token-uuid-1' });
      expect(store.getActiveSession()?.rejoinToken).toBe('token-uuid-1');

      // Saving again for the same room/role without specifying rejoinToken keeps the existing token
      store.saveActiveSession({ ...dummySession, timestamp: Date.now() + 1000 });
      expect(store.getActiveSession()?.rejoinToken).toBe('token-uuid-1');

      // Explicit new rejoinToken updates it
      store.saveActiveSession({ ...dummySession, rejoinToken: 'token-uuid-2' });
      expect(store.getActiveSession()?.rejoinToken).toBe('token-uuid-2');
    });

    it('clears active session', () => {
      store.saveActiveSession(dummySession);
      store.clearActiveSession();
      expect(store.getActiveSession()).toBeNull();
    });

    it('validates session timestamp against max age threshold', () => {
      const recentSession: ActiveSession = { ...dummySession, timestamp: Date.now() - 60 * 1000 };
      expect(store.isSessionValid(recentSession, 5 * 60 * 1000)).toBe(true);

      const expiredSession: ActiveSession = { ...dummySession, timestamp: Date.now() - 6 * 60 * 1000 };
      expect(store.isSessionValid(expiredSession, 5 * 60 * 1000)).toBe(false);

      expect(store.isSessionValid(null)).toBe(false);
    });

    it('gracefully clears and returns null on corrupted session JSON', () => {
      mockStorageData[SessionStore.ACTIVE_SESSION_KEY] = 'not-valid-json{{{';
      expect(store.getActiveSession()).toBeNull();
      expect(mockStorageData[SessionStore.ACTIVE_SESSION_KEY]).toBeUndefined();
    });
  });

  describe('GameState Snapshot Management', () => {
    function makeState() {
      const state = createInitialGameState('h', 'g');
      applyDefaultScenario(state);
      return state;
    }

    it('saves and retrieves GameState snapshots by room code', () => {
      const state = makeState();
      store.saveSnapshot('XYZ-789', state);

      const retrieved = store.getSnapshot('XYZ-789');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.units.length).toBe(state.units.length);
      expect(retrieved?.terrain.length).toBe(state.terrain.length);
      expect(retrieved?.board.width).toBe(state.board.width);
    });

    it('refreshes active session timestamp when saving a snapshot for the current room', () => {
      const oldTime = Date.now() - 10000;
      store.saveActiveSession({
        roomCode: 'XYZ-789',
        role: 'host',
        playerId: 'h',
        playerName: 'Host',
        timestamp: oldTime,
      });

      const state = makeState();
      store.saveSnapshot('XYZ-789', state);

      const updated = store.getActiveSession();
      expect(updated?.timestamp).toBeGreaterThan(oldTime);
    });

    it('handles corrupted snapshot JSON gracefully without throwing', () => {
      mockStorageData[`${SessionStore.SNAPSHOT_PREFIX}BAD-ROOM`] = '{invalid json';
      expect(store.getSnapshot('BAD-ROOM')).toBeNull();
      expect(mockStorageData[`${SessionStore.SNAPSHOT_PREFIX}BAD-ROOM`]).toBeUndefined();
    });

    it('rejects snapshots with invalid GameState schema', () => {
      mockStorageData[`${SessionStore.SNAPSHOT_PREFIX}INCOMPLETE`] = JSON.stringify({ random: 'data' });
      expect(store.getSnapshot('INCOMPLETE')).toBeNull();
      expect(mockStorageData[`${SessionStore.SNAPSHOT_PREFIX}INCOMPLETE`]).toBeUndefined();
    });

    it('clears snapshot for a specific room', () => {
      const state = makeState();
      store.saveSnapshot('ROOM-1', state);
      store.saveSnapshot('ROOM-2', state);

      store.clearSnapshot('ROOM-1');
      expect(store.getSnapshot('ROOM-1')).toBeNull();
      expect(store.getSnapshot('ROOM-2')).not.toBeNull();
    });

    it('clears all snapshots and active sessions via clearAll()', () => {
      const state = makeState();
      store.saveActiveSession({
        roomCode: 'ROOM-1',
        role: 'host',
        playerId: 'h',
        playerName: 'Host',
        timestamp: Date.now(),
      });
      store.saveSnapshot('ROOM-1', state);
      store.saveSnapshot('ROOM-2', state);

      store.clearAll();
      expect(store.getActiveSession()).toBeNull();
      expect(store.getSnapshot('ROOM-1')).toBeNull();
      expect(store.getSnapshot('ROOM-2')).toBeNull();
    });
  });

  describe('Storage Failure Fallback', () => {
    it('falls back to in-memory storage if storage throws QuotaExceededError', () => {
      const failingStorage = {
        getItem: vi.fn(() => {
          throw new Error('Access denied');
        }),
        setItem: vi.fn(() => {
          throw new Error('QuotaExceededError');
        }),
        removeItem: vi.fn(() => {
          throw new Error('Access denied');
        }),
      } as unknown as Storage;

      const fallbackStore = new SessionStore(failingStorage);
      fallbackStore.saveActiveSession({
        roomCode: 'MEM-001',
        role: 'guest',
        playerId: 'g',
        playerName: 'Guest',
        timestamp: Date.now(),
      });

      const retrieved = fallbackStore.getActiveSession();
      expect(retrieved?.roomCode).toBe('MEM-001');
    });
  });

  describe('GameManager Integration with SessionStore', () => {
    it('auto-saves snapshots on GameManager state updates and cleans up on game-over', () => {
      const fakeWebRTC = {
        on: vi.fn(),
        send: vi.fn(),
        onConnectionState: vi.fn(),
      } as any;

      const gm = new GameManager(fakeWebRTC, true, {
        sessionStore: store,
        roomCode: 'TEST-123',
      });

      store.saveActiveSession({
        roomCode: 'TEST-123',
        role: 'host',
        playerId: 'h',
        playerName: 'Host',
        timestamp: Date.now(),
      });

      gm.startGame('Host', 'Guest');

      // State is saved in sessionStore
      const saved = store.getSnapshot('TEST-123');
      expect(saved).not.toBeNull();
      expect(saved?.status).toBe('in-progress');

      // Now trigger game over
      const endState = gm.getGameState()!;
      endState.status = 'game-over';
      (gm as any).saveSnapshot(endState);

      // Snapshot and active session automatically cleaned up upon game over
      expect(store.getSnapshot('TEST-123')).toBeNull();
      expect(store.getActiveSession()).toBeNull();
    });
  });

  describe('Split Default Storage (per-tab sessionStorage + shared localStorage snapshots)', () => {
    function makeMemoryStorage(): { storage: Storage; data: Record<string, string> } {
      const data: Record<string, string> = {};
      const storage = {
        getItem: vi.fn((key: string) => data[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
          data[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete data[key];
        }),
        clear: vi.fn(() => {
          for (const k of Object.keys(data)) delete data[k];
        }),
        key: vi.fn((idx: number) => Object.keys(data)[idx] ?? null),
        get length() {
          return Object.keys(data).length;
        },
      } as unknown as Storage;
      return { storage, data };
    }

    it('stores active session in window.sessionStorage and snapshots in window.localStorage by default', () => {
      const local = makeMemoryStorage();
      const session = makeMemoryStorage();
      vi.stubGlobal('window', {
        localStorage: local.storage,
        sessionStorage: session.storage,
      });

      try {
        const splitStore = new SessionStore();
        const state = createInitialGameState('h', 'g');
        applyDefaultScenario(state);

        splitStore.saveActiveSession({
          roomCode: 'TAB-101',
          role: 'host',
          playerId: 'h',
          playerName: 'Host',
          rejoinToken: 'host-tab-token',
          timestamp: Date.now(),
        });
        splitStore.saveSnapshot('TAB-101', state);

        // Active session goes only to sessionStorage (per-tab)
        expect(session.data[SessionStore.ACTIVE_SESSION_KEY]).toBeDefined();
        expect(local.data[SessionStore.ACTIVE_SESSION_KEY]).toBeUndefined();
        expect(splitStore.getActiveSession()?.rejoinToken).toBe('host-tab-token');

        // Snapshot goes only to localStorage
        const snapKey = `${SessionStore.SNAPSHOT_PREFIX}TAB-101`;
        expect(local.data[snapKey]).toBeDefined();
        expect(session.data[snapKey]).toBeUndefined();
        expect(splitStore.getSnapshot('TAB-101')?.units.length).toBe(state.units.length);

        // Two tabs share localStorage snapshots without clobbering each other's sessionStorage seat
        const guestSession = makeMemoryStorage();
        vi.stubGlobal('window', {
          localStorage: local.storage,
          sessionStorage: guestSession.storage,
        });
        const guestStore = new SessionStore();
        guestStore.saveActiveSession({
          roomCode: 'TAB-101',
          role: 'guest',
          playerId: 'g',
          playerName: 'Guest',
          rejoinToken: 'guest-tab-token',
          timestamp: Date.now(),
        });

        expect(guestStore.getActiveSession()?.role).toBe('guest');
        expect(guestStore.getActiveSession()?.rejoinToken).toBe('guest-tab-token');
        expect(splitStore.getActiveSession()?.role).toBe('host');
        expect(splitStore.getActiveSession()?.rejoinToken).toBe('host-tab-token');

        // clearAll removes keys from both sessionStorage and localStorage
        splitStore.clearAll();
        expect(session.data[SessionStore.ACTIVE_SESSION_KEY]).toBeUndefined();
        expect(local.data[snapKey]).toBeUndefined();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
