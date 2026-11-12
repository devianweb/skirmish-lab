/**
 * Procedural sound synthesizer using Web Audio API (zero external assets / zero network latency).
 * Safe to instantiate in headless/Node/test environments where AudioContext is absent.
 */
export const AUDIO_MUTED_STORAGE_KEY = 'skirmish_lab_audio_muted';

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export class SoundFx {
  private static instance: SoundFx | null = null;
  private ctx: AudioContext | null = null;
  private muted = false;

  private constructor() {
    this.muted = getStorage()?.getItem(AUDIO_MUTED_STORAGE_KEY) === '1';
    this.setupUnlockListeners();
  }

  static getInstance(): SoundFx {
    if (!this.instance) {
      this.instance = new SoundFx();
    }
    return this.instance;
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    const storage = getStorage();
    if (storage) {
      if (muted) storage.setItem(AUDIO_MUTED_STORAGE_KEY, '1');
      else storage.removeItem(AUDIO_MUTED_STORAGE_KEY);
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.isMuted());
    return this.isMuted();
  }

  private initContext(): void {
    if (this.ctx || typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      this.ctx = new AudioCtx();
    }
  }

  private setupUnlockListeners(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const unlock = () => {
      this.initContext();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
  }

  /** Pleasant two-tone chime when your turn begins / activation passes to you. */
  playTurnChime(): void {
    if (this.isMuted()) return;
    this.initContext();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    try {
      const now = this.ctx.currentTime;
      // Two-tone bell / bong chime: D5 (587.33 Hz) into A5 (880 Hz)
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);
      gain1.gain.setValueAtTime(0.18, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc1.connect(gain1);
      gain1.connect(this.ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.35);

      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.08);
      gain2.gain.setValueAtTime(0.22, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.65);
    } catch {
      // Audio playback errors are non-fatal
    }
  }

  /** Distinct alert chime when a reaction prompt (e.g. Strike Back) requires your decision. */
  playReactionAlert(): void {
    if (this.isMuted()) return;
    this.initContext();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    try {
      const now = this.ctx.currentTime;
      // Harmonic triad chime: 440 Hz (A4) -> 554.37 Hz (C#5) -> 659.25 Hz (E5)
      const freqs = [440, 554.37, 659.25];
      freqs.forEach((freq, i) => {
        const start = now + i * 0.06;
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.2, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
        osc.connect(gain);
        gain.connect(this.ctx!.destination);
        osc.start(start);
        osc.stop(start + 0.45);
      });
    } catch {
      // Audio playback errors are non-fatal
    }
  }

  /** Rapid micro-taps simulating dice tumbling and settling (under 0.6s, quieter than turn chime). */
  playDiceRattle(): void {
    if (this.isMuted()) return;
    this.initContext();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    try {
      const now = this.ctx.currentTime;
      const taps = [
        { time: 0, freq: 440 },
        { time: 0.05, freq: 580 },
        { time: 0.11, freq: 360 },
        { time: 0.18, freq: 640 },
        { time: 0.26, freq: 480 },
      ];
      for (const tap of taps) {
        const start = now + tap.time;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(tap.freq, start);
        gain.gain.setValueAtTime(0.08, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.03);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(start);
        osc.stop(start + 0.03);
      }
    } catch {
      // Audio playback errors are non-fatal
    }
  }

  /** Crisp weapon shot crack with downward pitch sweep (under 0.6s, quieter than turn chime). */
  playShot(): void {
    if (this.isMuted()) return;
    this.initContext();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    try {
      const now = this.ctx.currentTime;
      // Main shot chirp
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(520, now);
      osc1.frequency.exponentialRampToValueAtTime(70, now + 0.08);
      gain1.gain.setValueAtTime(0.12, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc1.connect(gain1);
      gain1.connect(this.ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.18);

      // Low punch thump
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(95, now);
      gain2.gain.setValueAtTime(0.08, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start(now);
      osc2.stop(now + 0.12);
    } catch {
      // Audio playback errors are non-fatal
    }
  }

  /** Heavy melee impact with metallic clang overtone (under 0.6s, quieter than turn chime). */
  playMeleeImpact(): void {
    if (this.isMuted()) return;
    this.initContext();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    try {
      const now = this.ctx.currentTime;
      // Low impact thump
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(160, now);
      osc1.frequency.exponentialRampToValueAtTime(40, now + 0.14);
      gain1.gain.setValueAtTime(0.14, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc1.connect(gain1);
      gain1.connect(this.ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.22);

      // Metallic blade clang
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1150, now);
      gain2.gain.setValueAtTime(0.08, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start(now);
      osc2.stop(now + 0.09);
    } catch {
      // Audio playback errors are non-fatal
    }
  }

  /** Short rising fanfare for Victory (under 0.6s, quieter than turn chime). */
  playVictory(): void {
    if (this.isMuted()) return;
    this.initContext();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    try {
      const now = this.ctx.currentTime;
      const notes = [
        { freq: 523.25, offset: 0, dur: 0.14, gain: 0.12 },    // C5
        { freq: 659.25, offset: 0.10, dur: 0.14, gain: 0.13 }, // E5
        { freq: 783.99, offset: 0.20, dur: 0.28, gain: 0.15 }, // G5
      ];
      for (const note of notes) {
        const start = now + note.offset;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(note.freq, start);
        gain.gain.setValueAtTime(note.gain, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + note.dur);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(start);
        osc.stop(start + note.dur);
      }
    } catch {
      // Audio playback errors are non-fatal
    }
  }

  /** Short falling motif for Defeat (under 0.6s, quieter than turn chime). */
  playDefeat(): void {
    if (this.isMuted()) return;
    this.initContext();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    try {
      const now = this.ctx.currentTime;
      const notes = [
        { freq: 349.23, offset: 0, dur: 0.16, gain: 0.12 },    // F4
        { freq: 293.66, offset: 0.12, dur: 0.16, gain: 0.12 }, // D4
        { freq: 246.94, offset: 0.24, dur: 0.26, gain: 0.13 }, // B3
      ];
      for (const note of notes) {
        const start = now + note.offset;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(note.freq, start);
        gain.gain.setValueAtTime(note.gain, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + note.dur);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(start);
        osc.stop(start + note.dur);
      }
    } catch {
      // Audio playback errors are non-fatal
    }
  }
}

export const soundFx = SoundFx.getInstance();
