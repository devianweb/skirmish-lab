// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { SoundFx } from '../../src/audio/SoundFx';

describe('SoundFx', () => {
  it('instantiates cleanly without throwing in headless environments', () => {
    const sfx = SoundFx.getInstance();
    expect(sfx).toBeDefined();
  });

  it('safely handles playTurnChime without AudioContext', () => {
    const sfx = SoundFx.getInstance();
    expect(() => sfx.playTurnChime()).not.toThrow();
  });

  it('safely handles playReactionAlert without AudioContext', () => {
    const sfx = SoundFx.getInstance();
    expect(() => sfx.playReactionAlert()).not.toThrow();
  });

  it('synthesizes chimes when Web Audio API is available', () => {
    const mockOscillator = {
      type: 'sine',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const mockGain = {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
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

    (window as any).AudioContext = vi.fn(() => mockAudioContext);

    const sfx = SoundFx.getInstance();
    (sfx as any).ctx = mockAudioContext;

    expect(() => sfx.playTurnChime()).not.toThrow();
    expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    expect(mockAudioContext.createGain).toHaveBeenCalled();

    mockAudioContext.createOscillator.mockClear();
    expect(() => sfx.playReactionAlert()).not.toThrow();
    expect(mockAudioContext.createOscillator).toHaveBeenCalled();
  });
});
