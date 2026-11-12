// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DEV_MODE_STORAGE_KEY, isDevMode, setDevMode, toggleDevMode, DEV_ONLY_ARMY_IDS, isDevOnlyArmy } from '../../src/ui/devMode';

describe('devMode flag', () => {
  beforeEach(() => localStorage.clear());

  it('is off by default', () => {
    expect(isDevMode()).toBe(false);
  });

  it('persists in localStorage under the documented key', () => {
    setDevMode(true);
    expect(DEV_MODE_STORAGE_KEY).toBe('skirmish_lab_dev_mode');
    expect(localStorage.getItem(DEV_MODE_STORAGE_KEY)).toBe('1');
    expect(isDevMode()).toBe(true);
    setDevMode(false);
    expect(isDevMode()).toBe(false);
  });

  it('toggle flips and returns the new value', () => {
    expect(toggleDevMode()).toBe(true);
    expect(toggleDevMode()).toBe(false);
  });

  it('treats unknown stored values as off', () => {
    localStorage.setItem(DEV_MODE_STORAGE_KEY, 'maybe');
    expect(isDevMode()).toBe(false);
  });

  it('flags only the TEST armies as dev-only', () => {
    expect(DEV_ONLY_ARMY_IDS).toEqual(['test-army', 'test-squad-army', 'test-rules-army', 'test-jump-army', 'test-hazard-army', 'test-special-rules-army', 'test-scout-ambush-army', 'test-loadouts-army']);
    expect(isDevOnlyArmy('test-army')).toBe(true);
    expect(isDevOnlyArmy('hdf')).toBe(false);
  });
});
