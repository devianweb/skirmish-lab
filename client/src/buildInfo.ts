/**
 * Build stamp: which build this browser tab is running, and whether a newer
 * one has been deployed. `__BUILD_COMMIT__` / `__BUILD_TIME__` are injected by
 * `client/vite.config.ts` (`define`); `version.json` is written next to
 * index.html by the same config.
 */

export interface BuildInfo {
  /** Short commit hash, or `dev` for a local dev server. */
  commit: string;
  /** ISO-8601 UTC time of the build. */
  builtAt: string;
}

export const DEV_COMMIT = 'dev';

/** This tab's own build. Falls back to `dev` when the constants are not injected. */
export function getBuildInfo(): BuildInfo {
  return {
    commit: typeof __BUILD_COMMIT__ === 'string' && __BUILD_COMMIT__ ? __BUILD_COMMIT__ : DEV_COMMIT,
    builtAt: typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '',
  };
}

export function isDevBuild(info: BuildInfo): boolean {
  return info.commit === DEV_COMMIT;
}

/** `Build a1b2c3d · 2026-11-11 23:00 UTC`, or `Build dev`. */
export function formatBuildStamp(info: BuildInfo): string {
  if (isDevBuild(info)) return 'Build dev';
  const time = new Date(info.builtAt);
  if (Number.isNaN(time.getTime())) return `Build ${info.commit}`;
  const iso = time.toISOString(); // 2026-11-11T23:00:41.123Z
  return `Build ${info.commit} · ${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export interface VersionCheckOptions {
  current: BuildInfo;
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  /** App base path, e.g. `/skirmish-lab/`. */
  baseUrl?: string;
}

/**
 * True when the deployed `version.json` names a different commit than this tab.
 * Never throws: a dev build, a failed fetch, or a malformed body all give false.
 */
export async function checkForNewVersion(options: VersionCheckOptions): Promise<boolean> {
  const { current } = options;
  if (isDevBuild(current)) return false;
  const fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
  const baseUrl = options.baseUrl ?? import.meta.env.BASE_URL ?? '/';
  try {
    const response = await fetchFn(`${baseUrl}version.json`, { cache: 'no-store' });
    if (!response.ok) return false;
    const body = (await response.json()) as unknown;
    if (!body || typeof body !== 'object') return false;
    const commit = (body as { commit?: unknown }).commit;
    if (typeof commit !== 'string' || !commit) return false;
    return commit !== current.commit;
  } catch {
    return false;
  }
}
