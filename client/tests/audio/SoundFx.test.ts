// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SoundFx, AUDIO_MUTED_STORAGE_KEY } from '../../src/audio/SoundFx';

describe('SoundFx', () => {
  beforeEach(() => {
    localStorage.clear();
    const sfx = SoundFx.getInstance();
    sfx.setMuted(false);
  });

  it('instantiates cleanly without throwing in headless environments', () => {
    const sfx = SoundFx.getInstance();
    expect(sfx).toBeDefined();
  });

  it('safely handles playTurnChime and playReactionAlert without AudioContext', () => {
    const sfx = SoundFx.getInstance();
    (sfx as any).ctx = null;
    expect(() => sfx.playTurnChime()).not.toThrow();
    expect(() => sfx.playReactionAlert()).not.toThrow();
  });

  it('safely handles all 4 new cues without AudioContext', () => {
    const sfx = SoundFx.getInstance();
    (sfx as any).ctx = null;
    expect(() => sfx.playDiceRattle()).not.toThrow();
    expect(() => sfx.playShot()).not.toThrow();
    expect(() => sfx.playMeleeImpact()).not.toThrow();
    expect(() => sfx.playVictory()).not.toThrow();
    expect(() => sfx.playDefeat()).not.toThrow();
  });

  it('safely handles suspended AudioContext without throwing', () => {
    const mockAudioContext = {
      state: 'suspended',
      currentTime: 10,
      destination: {},
      createOscillator: vi.fn(() => ({
        type: 'sine',
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      })),
      createGain: vi.fn(() => ({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      })),
      resume: vi.fn().mockRejectedValue(new Error('Autoplay blocked')),
    };

    const sfx = SoundFx.getInstance();
    (sfx as any).ctx = mockAudioContext;

    expect(() => sfx.playDiceRattle()).not.toThrow();
    expect(() => sfx.playShot()).not.toThrow();
    expect(() => sfx.playMeleeImpact()).not.toThrow();
    expect(() => sfx.playVictory()).not.toThrow();
    expect(() => sfx.playDefeat()).not.toThrow();
    expect(() => sfx.playTurnChime()).not.toThrow();
    expect(() => sfx.playReactionAlert()).not.toThrow();
  });

  it('synthesizes new cues with duration < 0.6s and quieter than turn chime', () => {
    const oscillators: any[] = [];
    const gains: any[] = [];

    const mockAudioContext = {
      state: 'running',
      currentTime: 10,
      destination: {},
      createOscillator: vi.fn(() => {
        const osc = {
          type: 'sine',
          frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        };
        oscillators.push(osc);
        return osc;
      }),
      createGain: vi.fn(() => {
        const g = {
          gain: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        };
        gains.push(g);
        return g;
      }),
      resume: vi.fn().mockResolvedValue(undefined),
    };

    const sfx = SoundFx.getInstance();
    (sfx as any).ctx = mockAudioContext;

    // Helper to check duration and max gain
    const verifyCue = (playFn: () => void) => {
      oscillators.length = 0;
      gains.length = 0;
      playFn();
      expect(oscillators.length).toBeGreaterThan(0);
      expect(gains.length).toBeGreaterThan(0);

      // Check all stop times: must be <= currentTime + 0.6s
      for (const osc of oscillators) {
        expect(osc.stop).toHaveBeenCalled();
        const stopTime = osc.stop.mock.calls[0][0];
        expect(stopTime - 10).toBeLessThanOrEqual(0.6);
      }

      // Check all peak gain values: must be strictly less than turn chime peak (0.22)
      for (const g of gains) {
        for (const call of g.gain.setValueAtTime.mock.calls) {
          const gainVal = call[0];
          expect(gainVal).toBeLessThan(0.22);
        }
      }
    };

    verifyCue(() => sfx.playDiceRattle());
    verifyCue(() => sfx.playShot());
    verifyCue(() => sfx.playMeleeImpact());
    verifyCue(() => sfx.playVictory());
    verifyCue(() => sfx.playDefeat());
  });

  describe('mute functionality', () => {
    it('defaults to unmuted (on)', () => {
      const sfx = SoundFx.getInstance();
      expect(sfx.isMuted()).toBe(false);
    });

    it('mutes all cues, old and new', () => {
      const mockOscillator = {
        type: 'sine',
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      const mockGain = {
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      };
      const mockAudioContext = {
        state: 'running',
        currentTime: 10,
        destination: {},
        createOscillator: vi.fn(() => mockOscillator),
        createGain: vi.fn(() => mockGain),
        resume: vi.fn().mockResolvedValue(undefined),
      };

      const sfx = SoundFx.getInstance();
      (sfx as any).ctx = mockAudioContext;

      sfx.setMuted(true);
      expect(sfx.isMuted()).toBe(true);

      sfx.playTurnChime();
      sfx.playReactionAlert();
      sfx.playDiceRattle();
      sfx.playShot();
      sfx.playMeleeImpact();
      sfx.playVictory();
      sfx.playDefeat();

      expect(mockAudioContext.createOscillator).not.toHaveBeenCalled();
      expect(mockAudioContext.createGain).not.toHaveBeenCalled();
    });

    it('persists mute setting in localStorage and survives reload', () => {
      const sfx = SoundFx.getInstance();
      sfx.setMuted(true);
      expect(localStorage.getItem(AUDIO_MUTED_STORAGE_KEY)).toBe('1');

      // Toggle mute back to unmuted
      const next = sfx.toggleMute();
      expect(next).toBe(false);
      expect(sfx.isMuted()).toBe(false);
      expect(localStorage.getItem(AUDIO_MUTED_STORAGE_KEY)).toBeNull();

      // Set mute in localStorage and simulate page reload / new instance
      localStorage.setItem(AUDIO_MUTED_STORAGE_KEY, '1');
      (SoundFx as any).instance = null;
      const reloadedSfx = SoundFx.getInstance();
      expect(reloadedSfx.isMuted()).toBe(true);
    });
  });
});
