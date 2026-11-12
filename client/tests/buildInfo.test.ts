import { describe, it, expect, vi } from 'vitest';
import { formatBuildStamp, isDevBuild, checkForNewVersion, BuildInfo } from '../src/buildInfo';

const prod: BuildInfo = { commit: 'a1b2c3d', builtAt: '2026-11-11T23:00:41.123Z' };
const dev: BuildInfo = { commit: 'dev', builtAt: '2026-11-11T23:00:41.123Z' };

function okResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

describe('formatBuildStamp', () => {
  it('shows the short commit and the UTC build time to the minute', () => {
    expect(formatBuildStamp(prod)).toBe('Build a1b2c3d · 2026-11-11 23:00 UTC');
  });

  it('shows just "Build dev" for a dev build', () => {
    expect(formatBuildStamp(dev)).toBe('Build dev');
  });

  it('falls back to the commit alone when the time is unparseable', () => {
    expect(formatBuildStamp({ commit: 'a1b2c3d', builtAt: 'nope' })).toBe('Build a1b2c3d');
  });
});

describe('isDevBuild', () => {
  it('is true only for the dev commit', () => {
    expect(isDevBuild(dev)).toBe(true);
    expect(isDevBuild(prod)).toBe(false);
  });
});

describe('checkForNewVersion', () => {
  it('is false when the deployed commit matches the tab', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse({ commit: 'a1b2c3d', builtAt: 'x' }));
    expect(await checkForNewVersion({ current: prod, fetchFn, baseUrl: '/skirmish-lab/' })).toBe(false);
  });

  it('is true when the deployed commit differs', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse({ commit: 'ffffff0', builtAt: 'x' }));
    expect(await checkForNewVersion({ current: prod, fetchFn, baseUrl: '/skirmish-lab/' })).toBe(true);
  });

  it('asks for version.json under the base path with the cache bypassed', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse({ commit: 'a1b2c3d' }));
    await checkForNewVersion({ current: prod, fetchFn, baseUrl: '/skirmish-lab/' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/skirmish-lab/version.json');
    expect(init.cache).toBe('no-store');
  });

  it('is false (no throw) when the fetch rejects', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await checkForNewVersion({ current: prod, fetchFn, baseUrl: '/' })).toBe(false);
  });

  it('is false for a non-OK response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ commit: 'zzz' }) });
    expect(await checkForNewVersion({ current: prod, fetchFn, baseUrl: '/' })).toBe(false);
  });

  it('is false for bad JSON or a body without a commit', async () => {
    const badJson = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('bad');
      },
    });
    expect(await checkForNewVersion({ current: prod, fetchFn: badJson, baseUrl: '/' })).toBe(false);
    for (const body of [null, {}, { commit: 5 }, 'str']) {
      const fetchFn = vi.fn().mockResolvedValue(okResponse(body));
      expect(await checkForNewVersion({ current: prod, fetchFn, baseUrl: '/' })).toBe(false);
    }
  });

  it('never fetches for a dev build', async () => {
    const fetchFn = vi.fn();
    expect(await checkForNewVersion({ current: dev, fetchFn, baseUrl: '/' })).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
