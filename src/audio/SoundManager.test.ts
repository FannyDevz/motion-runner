import { describe, expect, it } from "vitest";
import { SOUNDS, SoundManager, type AudioContextLike, type SoundName } from "./SoundManager";

interface Recorded {
  oscillators: Array<{ type: string; start: number; stop: number; freqs: Array<[string, number, number]> }>;
  peakGains: number[];
}

function fakeContext(state = "running"): { ctx: AudioContextLike & { state: string; resumed: number }; rec: Recorded } {
  const rec: Recorded = { oscillators: [], peakGains: [] };
  const param = (log?: Array<[string, number, number]>, onLinear?: (v: number) => void) => ({
    setValueAtTime: (v: number, t: number) => void log?.push(["set", v, t]),
    linearRampToValueAtTime: (v: number, t: number) => {
      onLinear?.(v);
      log?.push(["linear", v, t]);
    },
    exponentialRampToValueAtTime: (v: number, t: number) => void log?.push(["exp", v, t]),
  });
  const ctx = {
    currentTime: 10,
    state,
    resumed: 0,
    destination: {},
    resume() {
      this.resumed++;
      return Promise.resolve();
    },
    createOscillator() {
      const entry = { type: "", start: 0, stop: 0, freqs: [] as Array<[string, number, number]> };
      rec.oscillators.push(entry);
      return {
        set type(v: string) {
          entry.type = v;
        },
        get type() {
          return entry.type;
        },
        frequency: param(entry.freqs),
        connect: () => undefined,
        start: (t: number) => void (entry.start = t),
        stop: (t: number) => void (entry.stop = t),
      };
    },
    createGain: () => ({ gain: param(undefined, (v) => rec.peakGains.push(v)), connect: () => undefined }),
  };
  return { ctx, rec };
}

function setup(state = "running") {
  const { ctx, rec } = fakeContext(state);
  let clock = 0;
  const sound = new SoundManager(() => ctx, () => clock);
  sound.unlock();
  return { sound, ctx, rec, advance: (ms: number) => void (clock += ms) };
}

describe("sound definitions", () => {
  const names = Object.keys(SOUNDS) as SoundName[];

  it("defines every effect the game uses", () => {
    expect(names.sort()).toEqual(["correct", "crouch", "gameover", "jump", "lane", "resume", "slowmo", "start", "streak", "warning", "wrong"]);
  });

  it("uses sensible notes", () => {
    for (const name of names) {
      expect(SOUNDS[name].length).toBeGreaterThan(0);
      for (const tone of SOUNDS[name]) {
        expect(tone.freq).toBeGreaterThan(20);
        expect(tone.freq).toBeLessThan(5000);
        expect(tone.endFreq === undefined || (tone.endFreq > 20 && tone.endFreq < 5000)).toBe(true);
        expect(tone.duration).toBeGreaterThan(0.03);
        expect(tone.at).toBeGreaterThanOrEqual(0);
        expect(tone.gain).toBeGreaterThan(0);
        expect(tone.gain).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it("keeps each effect short", () => {
    for (const name of names) {
      const end = Math.max(...SOUNDS[name].map((t) => t.at + t.duration));
      expect(end).toBeLessThan(1);
    }
  });
});

describe("SoundManager", () => {
  it("plays one oscillator per note, scheduled from the context clock", () => {
    const { sound, rec } = setup();
    sound.play("correct");
    expect(rec.oscillators).toHaveLength(SOUNDS.correct.length);
    SOUNDS.correct.forEach((tone, i) => {
      expect(rec.oscillators[i].type).toBe(tone.type);
      expect(rec.oscillators[i].start).toBeCloseTo(10 + tone.at);
      expect(rec.oscillators[i].stop).toBeGreaterThan(10 + tone.at + tone.duration);
    });
  });

  it("glides pitch only for notes that have an end frequency", () => {
    const { sound, rec } = setup();
    sound.play("jump");
    sound.play("warning");
    const jump = rec.oscillators[0].freqs.map((f) => f[0]);
    const beep = rec.oscillators[1].freqs.map((f) => f[0]);
    expect(jump).toEqual(["set", "exp"]);
    expect(beep).toEqual(["set"]);
  });

  it("is silent until unlocked by a user gesture", () => {
    const { ctx, rec } = fakeContext();
    const sound = new SoundManager(() => ctx, () => 0);
    sound.play("jump");
    expect(rec.oscillators).toHaveLength(0);
    sound.unlock();
    sound.play("jump");
    expect(rec.oscillators).toHaveLength(1);
  });

  it("is silent when disabled, and plays again when re-enabled", () => {
    const { sound, rec } = setup();
    sound.setEnabled(false);
    sound.play("jump");
    expect(rec.oscillators).toHaveLength(0);
    sound.setEnabled(true);
    sound.play("jump");
    expect(rec.oscillators).toHaveLength(1);
  });

  it("is silent at zero volume", () => {
    const { sound, rec } = setup();
    sound.setVolume(0);
    sound.play("jump");
    expect(rec.oscillators).toHaveLength(0);
  });

  it("scales loudness with volume", () => {
    const { sound, rec, advance } = setup();
    sound.setVolume(1);
    sound.play("lane");
    const loud = rec.peakGains.at(-1) as number;

    advance(200); // past the repeat guard
    sound.setVolume(0.25);
    sound.play("lane");
    const quiet = rec.peakGains.at(-1) as number;

    expect(loud).toBeGreaterThan(0);
    expect(quiet).toBeCloseTo(loud * 0.25, 5);
  });

  it("clamps volume to 0..1", () => {
    const { sound, rec } = setup();
    sound.setVolume(5);
    sound.play("lane");
    const gain = rec.peakGains.at(-1) as number;
    expect(gain).toBeLessThanOrEqual(1);
    sound.setVolume(-3);
    sound.play("jump");
    expect(rec.oscillators).toHaveLength(1); // still just the first
  });

  it("does not retrigger the same effect within the repeat window", () => {
    const { sound, rec, advance } = setup();
    sound.play("lane");
    advance(20);
    sound.play("lane");
    expect(rec.oscillators).toHaveLength(1);
    advance(100);
    sound.play("lane");
    expect(rec.oscillators).toHaveLength(2);
  });

  it("lets different effects play together", () => {
    const { sound, rec } = setup();
    sound.play("lane");
    sound.play("jump");
    expect(rec.oscillators).toHaveLength(2);
  });

  it("resumes a suspended context", () => {
    const { ctx, sound } = setup("suspended");
    expect(ctx.resumed).toBeGreaterThan(0); // from unlock()
    const before = ctx.resumed;
    sound.play("jump");
    expect(ctx.resumed).toBeGreaterThan(before);
  });

  it("does not throw without audio support", () => {
    const none = new SoundManager(() => null, () => 0);
    none.unlock();
    expect(() => none.play("jump")).not.toThrow();
    const broken = new SoundManager(() => {
      throw new Error("no audio");
    }, () => 0);
    broken.unlock();
    expect(() => broken.play("jump")).not.toThrow();
  });

  it("creates the context only once", () => {
    let created = 0;
    const { ctx } = fakeContext();
    const sound = new SoundManager(() => (created++, ctx), () => 0);
    sound.unlock();
    sound.play("jump");
    sound.play("crouch");
    expect(created).toBe(1);
  });
});
