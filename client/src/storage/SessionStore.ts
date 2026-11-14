import { GameState } from '@skirmish-lab/shared';

export interface ActiveSession {
  roomCode: string;
  role: 'host' | 'guest';
  playerId: string;
  playerName: string;
  armyId?: string;
  rejoinToken?: string;
  timestamp: number;
}

/**
 * SessionStore manages client-side persistence of active room sessions
 * (per-tab sessionStorage) and authoritative GameState snapshots (localStorage).
 *
 * It provides resilience against browser tab reloads, network flickers,
 * and device restarts during the 5-minute room grace window without
 * overwriting seat/token metadata across multiple tabs in the same browser.
 */
export class SessionStore {
  private snapshotStorage: Storage | null;
  private sessionStorage: Storage | null;
  private memoryFallback: Map<string, string> = new Map();

  static readonly ACTIVE_SESSION_KEY = 'skirmish_lab_active_session';
  static readonly SNAPSHOT_PREFIX = 'skirmish_lab_snapshot_';

  constructor(customStorage?: Storage, customSessionStorage?: Storage) {
    if (customStorage) {
      this.snapshotStorage = customStorage;
      this.sessionStorage = customSessionStorage ?? customStorage;
    } else {
      try {
        this.snapshotStorage =
          typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
      } catch {
        this.snapshotStorage = null;
      }

      if (customSessionStorage) {
        this.sessionStorage = customSessionStorage;
      } else {
        try {
          this.sessionStorage =
            typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
        } catch {
          this.sessionStorage = null;
        }
      }
    }
  }

  private getItem(key: string, storage: Storage | null): string | null {
    try {
      if (storage) {
        return storage.getItem(key);
      }
    } catch (e) {
      console.warn(`[SessionStore] Failed to read key "${key}":`, e);
    }
    return this.memoryFallback.get(key) ?? null;
  }

  private setItem(key: string, value: string, storage: Storage | null): void {
    try {
      if (storage) {
        storage.setItem(key, value);
        return;
      }
    } catch (e) {
      console.warn(`[SessionStore] Failed to write key "${key}":`, e);
    }
    this.memoryFallback.set(key, value);
  }

  private removeItem(key: string, storage: Storage | null): void {
    try {
      if (storage) {
        storage.removeItem(key);
      }
    } catch (e) {
      console.warn(`[SessionStore] Failed to remove key "${key}":`, e);
    }
    this.memoryFallback.delete(key);
  }

  saveActiveSession(session: ActiveSession): void {
    let toSave = session;
    if (toSave.rejoinToken === undefined) {
      const existing = this.getActiveSession();
      if (
        existing?.rejoinToken &&
        existing.roomCode.toUpperCase() === toSave.roomCode.toUpperCase() &&
        existing.role === toSave.role
      ) {
        toSave = { ...toSave, rejoinToken: existing.rejoinToken };
      }
    }
    const payload = JSON.stringify(toSave);
    this.setItem(SessionStore.ACTIVE_SESSION_KEY, payload, this.sessionStorage);
  }

  getActiveSession(): ActiveSession | null {
    const raw = this.getItem(SessionStore.ACTIVE_SESSION_KEY, this.sessionStorage);
    if (!raw) return null;
    try {
      const session = JSON.parse(raw) as ActiveSession;
      if (!session || typeof session.roomCode !== 'string' || typeof session.role !== 'string') {
        this.clearActiveSession();
        return null;
      }
      return session;
    } catch {
      this.clearActiveSession();
      return null;
    }
  }

  clearActiveSession(): void {
    this.removeItem(SessionStore.ACTIVE_SESSION_KEY, this.sessionStorage);
  }

  saveSnapshot(roomCode: string, state: GameState): void {
    if (!roomCode || !state) return;
    try {
      const key = `${SessionStore.SNAPSHOT_PREFIX}${roomCode.toUpperCase()}`;
      const payload = JSON.stringify(state);
      this.setItem(key, payload, this.snapshotStorage);

      // Refresh activity timestamp on active session if room code matches
      const active = this.getActiveSession();
      if (active && active.roomCode.toUpperCase() === roomCode.toUpperCase()) {
        active.timestamp = Date.now();
        this.saveActiveSession(active);
      }
    } catch (e) {
      console.warn(`[SessionStore] Error saving snapshot for room ${roomCode}:`, e);
    }
  }

  getSnapshot(roomCode: string): GameState | null {
    if (!roomCode) return null;
    const key = `${SessionStore.SNAPSHOT_PREFIX}${roomCode.toUpperCase()}`;
    const raw = this.getItem(key, this.snapshotStorage);
    if (!raw) return null;
    try {
      const state = JSON.parse(raw) as GameState;
      if (!state || !state.board || !Array.isArray(state.units) || !Array.isArray(state.terrain)) {
        console.warn(`[SessionStore] Corrupted snapshot structure for room ${roomCode}`);
        this.clearSnapshot(roomCode);
        return null;
      }
      return state;
    } catch (e) {
      console.warn(`[SessionStore] Failed to parse snapshot JSON for room ${roomCode}:`, e);
      this.clearSnapshot(roomCode);
      return null;
    }
  }

  clearSnapshot(roomCode: string): void {
    if (!roomCode) return;
    const key = `${SessionStore.SNAPSHOT_PREFIX}${roomCode.toUpperCase()}`;
    this.removeItem(key, this.snapshotStorage);
  }

  clearAll(): void {
    this.clearActiveSession();
    try {
      if (this.snapshotStorage) {
        const keysToRemove: string[] = [];
        for (let i = 0; i < this.snapshotStorage.length; i++) {
          const key = this.snapshotStorage.key(i);
          if (key && (key === SessionStore.ACTIVE_SESSION_KEY || key.startsWith(SessionStore.SNAPSHOT_PREFIX))) {
            keysToRemove.push(key);
          }
        }
        for (const k of keysToRemove) {
          this.snapshotStorage.removeItem(k);
        }
      }
    } catch (e) {
      console.warn('[SessionStore] Error clearing all storage keys:', e);
    }
    this.memoryFallback.clear();
  }

  /**
   * Checks if an active session is within the valid grace period / timeout.
   * Defaults to 5 minutes (300,000ms).
   */
  isSessionValid(session: ActiveSession | null, maxAgeMs = 5 * 60 * 1000): boolean {
    if (!session) return false;
    return Date.now() - session.timestamp <= maxAgeMs;
  }
}

export const defaultSessionStore = new SessionStore();
