/**
 * DreamFactory 0's machine (engine/src/v0/machine.ts): the seeded roll, a file
 * that is not here yet or not in the rip at all, a sound's length in ticks, the
 * ambience's channel and Sound ▸ Theme, and what ends a held-button walk.
 *
 *   npx vitest run engine/tests/df0-machine.ts
 *
 * No game: the files are built ({@link file://./helpers/v0-build.ts}).
 */
import { expect, test } from "vitest";
import { i16 } from "@dreamfactory/engine/df/build";
import { rng, type Speaker } from "@dreamfactory/engine/v0/machine";
import { MapMachine, soundV0 } from "./helpers/v0-build";

/** a speaker that keeps what it is told */
function recorder(): Speaker & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    play: (s) => calls.push(`play ${s.length}`),
    stop: () => calls.push("stop"),
    loop: (s, rate) => calls.push(s ? `loop ${s.length}@${rate}` : `loop off`),
  };
}

/** a v0 bank: `sounds` sounds, then the pieces, strung in `order` */
function bank(sounds: number, pieces: Uint8Array[], order: number[]): Uint8Array[] {
  const c0 = new Uint8Array(6 + 2 * order.length);
  i16(c0, 0, sounds);
  i16(c0, 2, pieces.length);
  i16(c0, 4, order.length);
  order.forEach((k, i) => i16(c0, 6 + 2 * i, k));
  return [c0, ...Array.from({ length: sounds }, () => soundV0(1)), ...pieces];
}

test("a seed of 0 rolls as a seed of 1 does — xorshift has no zero state", () => {
  const a = rng(0);
  const b = rng(1);
  const seq = [a(), a(), a()];
  expect(seq).toEqual([b(), b(), b()]);
  expect(seq.every((x) => x > 0 && x < 1)).toBe(true);
  const m = new MapMachine(new Map(), { seed: 7 });
  const rolls = Array.from({ length: 200 }, () => m.roll(6));
  expect(Math.min(...rolls)).toBe(1);
  expect(Math.max(...rolls)).toBe(6);
});

test("a file the rip lacks throws the EXE's 'not found'; one still on its way waits a tick", () => {
  const data = new Uint8Array([1, 2, 3]);
  const m = new MapMachine(new Map([["late.mov", data]]), { pending: ["late.mov"] });
  expect(() => m.file("gone.mov", 3).next()).toThrow("gone.mov is not in the rip (day 3 or shared)");
  const co = m.file("late.mov", 1);
  expect(co.next().done).toBe(false);
  expect(m.wanted).toEqual(["late.mov"]);
  const r = co.next();
  expect(r.done && r.value).toEqual({ path: "late.mov", data });
});

test("a sound's length: a block is 370 samples at 22050 Hz, rounded up to whole ticks; a stub is none", () => {
  const m = new MapMachine(new Map());
  expect(m.soundTicks(new Uint8Array(1))).toBe(0);
  expect(m.soundTicks(soundV0(1))).toBe(2);
  expect(m.soundTicks(soundV0(60))).toBe(61);
  m.sound(soundV0(2));
  expect(m.soundBusy()).toBe(true);
  m.ticks = 3;
  expect(m.soundBusy()).toBe(false);
});

test("the ambience: strung from the bank's order, looped only while Theme is on and it plays", () => {
  const sp = recorder();
  const m = new MapMachine(new Map(), { speaker: sp });
  expect(() => m.setAmbience("hush", bank(1, [soundV0(1)], []))).toThrow("hush: no ambience");
  // nothing set: neither starting it nor toggling Theme reaches the channel
  m.playAmbience();
  m.setTheme(false);
  expect(sp.calls).toEqual([]);
  // pieces 2, 1, 2 strung: 1 + 3 + 1 blocks; piece 9 is not in the bank and is skipped
  m.setAmbience("city", bank(2, [soundV0(3), soundV0(1)], [2, 1, 9, 2]));
  expect(m.ambience?.samples).toHaveLength(5 * 370);
  m.setTheme(true); // set, but not playing yet: still nothing
  expect(sp.calls).toEqual([]);
  m.theme = false;
  m.playAmbience();
  m.setTheme(true);
  m.setTheme(false);
  m.stopAmbience();
  m.setTheme(true); // stopped: the channel stays silent
  expect(sp.calls).toEqual(["loop off", "loop 1850@22050", "loop off", "loop off"]);
  // a speaker with no ambience channel is fine
  const bare = new MapMachine(new Map());
  bare.setAmbience("city", bank(0, [soundV0(1)], [1]));
  bare.playAmbience();
  bare.setTheme(false);
  bare.stopAmbience();
  expect(bare.ambiencePlaying).toBe(false);
});

test("a held-button walk ends on a mouse-up or a key, or once the button is not held", () => {
  const m = new MapMachine(new Map());
  expect(m.releasedOrKey()).toBe(true);
  m.mouseHeld = true;
  expect(m.releasedOrKey()).toBe(false);
  m.events.push({ kind: "down", x: 0, y: 0 });
  expect(m.releasedOrKey()).toBe(false);
  m.events.push({ kind: "key", key: "a" });
  expect(m.releasedOrKey()).toBe(true);
  m.events.splice(0);
  m.events.push({ kind: "up", x: 0, y: 0 });
  expect(m.releasedOrKey()).toBe(true);
});
