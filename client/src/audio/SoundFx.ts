/**
 * Procedural sound synthesizer using Web Audio API (zero external assets / zero network latency).
 * Safe to instantiate in headless/Node/test environments where AudioContext is absent.
 */
export class SoundFx {
  private static instance: SoundFx | null = null;
  private ctx: AudioContext | null = null;

  private constructor() {
    this.setupUnlockListeners();
  }

  static getInstance(): SoundFx {
    if (!this.instance) {
      this.instance = new SoundFx();
    }
    return this.instance;
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
}

export const soundFx = SoundFx.getInstance();
