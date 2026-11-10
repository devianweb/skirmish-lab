/**
 * Developer mode: a localStorage flag that reveals playtesting extras (the TEST armies).
 * Toggled with F9 while the lobby / main menu is showing (see Lobby).
 */
export const DEV_MODE_STORAGE_KEY = 'skirmish_lab_dev_mode';

/** Army IDs only offered while developer mode is on. */
export const DEV_ONLY_ARMY_IDS = ['test-army', 'test-squad-army', 'test-rules-army', 'test-jump-army'];

export function isDevOnlyArmy(armyId: string): boolean {
  return DEV_ONLY_ARMY_IDS.includes(armyId);
}

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function isDevMode(): boolean {
  return getStorage()?.getItem(DEV_MODE_STORAGE_KEY) === '1';
}

export function setDevMode(on: boolean): void {
  const storage = getStorage();
  if (!storage) return;
  if (on) storage.setItem(DEV_MODE_STORAGE_KEY, '1');
  else storage.removeItem(DEV_MODE_STORAGE_KEY);
}

/** Flip the flag; returns the new value. */
export function toggleDevMode(): boolean {
  const next = !isDevMode();
  setDevMode(next);
  return next;
}
