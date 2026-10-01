export type SoundName =
  | "lane"
  | "jump"
  | "crouch"
  | "warning"
  | "slowmo"
  | "resume"
  | "correct"
  | "streak"
  | "wrong"
  | "start"
  | "gameover";

/** One synthesized note: a sweep from `freq` to `endFreq` shaped by a short envelope. */
export interface ToneSpec {
  /** Hz */
  freq: number;
  /** Hz; the note glides here by its end (omit for a steady pitch). */
  endFreq?: number;
  /** Start offset in seconds. */
  at: number;
  /** Length in seconds. */
  duration: number;
  type: "sine" | "square" | "triangle" | "sawtooth";
  /** Peak level before volume, 0..1. */
  gain: number;
}

/** All sound effects are synthesized from these notes, so the game ships no audio files. */
export const SOUNDS: Readonly<Record<SoundName, readonly ToneSpec[]>> = {
  lane: [{ freq: 440, endFreq: 520, at: 0, duration: 0.07, type: "triangle", gain: 0.25 }],
  jump: [{ freq: 330, endFreq: 660, at: 0, duration: 0.16, type: "square", gain: 0.14 }],
  crouch: [{ freq: 330, endFreq: 180, at: 0, duration: 0.14, type: "square", gain: 0.14 }],
  warning: [
    { freq: 880, at: 0, duration: 0.1, type: "sine", gain: 0.3 },
    { freq: 880, at: 0.14, duration: 0.1, type: "sine", gain: 0.3 },
  ],
  slowmo: [{ freq: 500, endFreq: 120, at: 0, duration: 0.5, type: "sawtooth", gain: 0.1 }],
  resume: [{ freq: 150, endFreq: 500, at: 0, duration: 0.35, type: "sawtooth", gain: 0.08 }],
  correct: [
    { freq: 523, at: 0, duration: 0.14, type: "triangle", gain: 0.3 },
    { freq: 659, at: 0.09, duration: 0.14, type: "triangle", gain: 0.3 },
    { freq: 784, at: 0.18, duration: 0.2, type: "triangle", gain: 0.3 },
  ],
  streak: [
    { freq: 523, at: 0, duration: 0.1, type: "triangle", gain: 0.3 },
    { freq: 659, at: 0.07, duration: 0.1, type: "triangle", gain: 0.3 },
    { freq: 784, at: 0.14, duration: 0.1, type: "triangle", gain: 0.3 },
    { freq: 1047, at: 0.21, duration: 0.25, type: "triangle", gain: 0.3 },
  ],
  wrong: [{ freq: 220, endFreq: 110, at: 0, duration: 0.3, type: "sawtooth", gain: 0.2 }],
  start: [
    { freq: 392, at: 0, duration: 0.12, type: "triangle", gain: 0.3 },
    { freq: 523, at: 0.1, duration: 0.2, type: "triangle", gain: 0.3 },
  ],
  gameover: [
    { freq: 392, at: 0, duration: 0.2, type: "sawtooth", gain: 0.18 },
    { freq: 330, at: 0.15, duration: 0.2, type: "sawtooth", gain: 0.18 },
    { freq: 262, at: 0.3, duration: 0.2, type: "sawtooth", gain: 0.18 },
    { freq: 196, at: 0.45, duration: 0.4, type: "sawtooth", gain: 0.18 },
  ],
};

/** The part of the Web Audio API this class uses, so tests can substitute a fake. */
export interface AudioParamLike {
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
}
export interface OscillatorLike {
  type: string;
  frequency: AudioParamLike;
  connect(destination: unknown): unknown;
  start(time: number): void;
  stop(time: number): void;
}
export interface GainLike {
  gain: AudioParamLike;
  connect(destination: unknown): unknown;
}
export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: unknown;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
  resume(): Promise<void>;
}

const ENVELOPE_ATTACK_S = 0.01;
const SILENCE = 0.0001;
const STOP_PADDING_S = 0.02;
/** Overall headroom so several overlapping notes never clip. */
const MASTER_GAIN = 0.8;
/** The same effect is not retriggered inside this window (e.g. a held key repeating). */
const MIN_REPEAT_MS = 60;

function defaultContextFactory(): AudioContextLike | null {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

/**
 * Plays the game's sound effects with Web Audio. Browsers only allow audio after a user
 * gesture, so call unlock() from a click or key press; until then play() is silent.
 * Everything fails soft: with no audio support or a blocked context nothing throws.
 */
export class SoundManager {
  private context: AudioContextLike | null = null;
  private contextFailed = false;
  private enabled = true;
  private volume = 0.6;
  private unlocked = false;
  private readonly lastPlayed = new Map<SoundName, number>();

  constructor(
    private readonly createContext: () => AudioContextLike | null = defaultContextFactory,
    private readonly now: () => number = () => performance.now(),
  ) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
  }

  /** Create and resume the audio context. Call from a user gesture (click, key press). */
  unlock(): void {
    this.unlocked = true;
    const ctx = this.getContext();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => undefined);
  }

  play(name: SoundName): void {
    if (!this.enabled || !this.unlocked || this.volume <= 0) return;

    const now = this.now();
    const last = this.lastPlayed.get(name);
    if (last !== undefined && now - last < MIN_REPEAT_MS) return;
    this.lastPlayed.set(name, now);

    const ctx = this.getContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => undefined);

    const start = ctx.currentTime;
    for (const tone of SOUNDS[name]) this.playTone(ctx, tone, start);
  }

  private playTone(ctx: AudioContextLike, tone: ToneSpec, start: number): void {
    const t0 = start + tone.at;
    const t1 = t0 + tone.duration;

    const osc = ctx.createOscillator();
    osc.type = tone.type;
    osc.frequency.setValueAtTime(tone.freq, t0);
    if (tone.endFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(tone.endFreq, t1);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(SILENCE, t0);
    gain.gain.linearRampToValueAtTime(Math.max(SILENCE, tone.gain * this.volume * MASTER_GAIN), t0 + ENVELOPE_ATTACK_S);
    gain.gain.exponentialRampToValueAtTime(SILENCE, t1);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t1 + STOP_PADDING_S);
  }

  private getContext(): AudioContextLike | null {
    if (this.context || this.contextFailed) return this.context;
    try {
      this.context = this.createContext();
    } catch {
      this.context = null;
    }
    if (!this.context) this.contextFailed = true;
    return this.context;
  }
}
