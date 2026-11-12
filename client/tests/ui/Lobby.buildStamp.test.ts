// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Lobby, LOBBY_DISCLAIMER } from '../../src/ui/Lobby';
import { SessionStore } from '../../src/storage/SessionStore';
import { MapStore } from '../../src/storage/MapStore';
import { BuildInfo } from '../../src/buildInfo';

const prod: BuildInfo = { commit: 'a1b2c3d', builtAt: '2026-11-11T23:00:00.000Z' };
const dev: BuildInfo = { commit: 'dev', builtAt: '2026-11-11T23:00:00.000Z' };

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

describe('Lobby build stamp and new-version banner', () => {
  let container: HTMLElement;
  let lobbies: Lobby[];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    lobbies = [];
  });
  afterEach(() => {
    lobbies.forEach((l) => l.destroy());
    container.remove();
  });

  function make(opts: { build?: BuildInfo; check?: () => Promise<boolean>; reload?: () => void }): Lobby {
    const lobby = new Lobby(container, {
      sessionStore: new SessionStore(memoryStorage()),
      mapStore: new MapStore(memoryStorage()),
      buildInfo: opts.build ?? prod,
      checkForNewVersion: opts.check ?? (async () => false),
      reloadPage: opts.reload ?? (() => {}),
    });
    lobbies.push(lobby);
    return lobby;
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('shows the stamp in the footer and keeps the disclaimer', () => {
    const lobby = make({});
    (lobby as any).render();
    const footer = container.querySelector('#lobbyFooter')!;
    expect(footer.textContent).toContain(LOBBY_DISCLAIMER);
    expect(footer.querySelector('#buildStamp')!.textContent).toBe('Build a1b2c3d · 2026-11-11 23:00 UTC');
  });

  it('shows "Build dev" for a dev build', () => {
    const lobby = make({ build: dev });
    (lobby as any).render();
    expect(container.querySelector('#buildStamp')!.textContent).toBe('Build dev');
  });

  it('shows no banner when the deployed build is the same', async () => {
    const lobby = make({ check: async () => false });
    (lobby as any).render();
    await (lobby as any).runVersionCheck();
    expect(container.querySelector('#newVersionBanner')).toBeNull();
  });

  it('shows a banner with Reload when a newer build is deployed, and Reload calls the reload function', async () => {
    const reload = vi.fn();
    const lobby = make({ check: async () => true, reload });
    (lobby as any).render();
    await (lobby as any).runVersionCheck();
    const banner = container.querySelector('#newVersionBanner')!;
    expect(banner.textContent).toContain('A newer version of SkirmishLab is available.');
    (banner.querySelector('#reloadBtn') as HTMLButtonElement).click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps the banner across re-renders without duplicating it', async () => {
    const lobby = make({ check: async () => true });
    (lobby as any).render();
    await (lobby as any).runVersionCheck();
    (lobby as any).render();
    (lobby as any).render();
    expect(container.querySelectorAll('#newVersionBanner').length).toBe(1);
  });

  it('checks again when the lobby is shown, and not while it is hidden in a game', async () => {
    const check = vi.fn().mockResolvedValue(false);
    const lobby = make({ check });
    (lobby as any).render();
    lobby.hide();
    await flush();
    expect(check).not.toHaveBeenCalled();
    lobby.show();
    await flush();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('shows no banner and throws nothing when the check rejects', async () => {
    const lobby = make({ check: async () => Promise.reject(new Error('boom')) });
    (lobby as any).render();
    await expect((lobby as any).runVersionCheck()).resolves.toBeUndefined();
    expect(container.querySelector('#newVersionBanner')).toBeNull();
  });
});
