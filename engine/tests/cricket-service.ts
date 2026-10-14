/**
 * Crickets and the two sound channels as TI.EXE runs them.
 *
 *   npx vitest run engine/tests/cricket-service.ts
 *
 *  - `makecricket` (0x444130): no set open 0x28; no such sound 0xa; radius < 1,
 *    base < 0, jitter < −1 0xe; the 16-slot table full 8;
 *  - the service (0x444430): nothing at all — not even the countdown — outside
 *    the cricket's set or out of earshot (a repeating one); the first pass in
 *    earshot re-arms without playing; it then plays at 0 whether or not its
 *    last shot still sounds; leaving earshot stops its sound; volume
 *    `255 − trunc (dist·255/radius)` and the angle-linear pan of 0x444790 are
 *    written to the sound every pass in earshot;
 *  - the looping ones: only the two loudest play (0x4446d0);
 *  - `pausecricket` nests (0x4448d0);
 *  - the play rules of singlesound / multiplesound / dualsound / bothsound
 *    (0x425150 / 0x425240 / 0x425330 / 0x425400) and the balance pan (0x424b90).
 *
 * No game data: the sound library is stubbed.
 */
import { expect, test } from "vitest";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import type { DecodedAudio } from "@dreamfactory/engine/df/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { ScriptError } from "@dreamfactory/engine/runtime/interp";
import { cricketPan, panFrom255, pickSoundChannelsV4 } from "@dreamfactory/engine/runtime/scheduler";

const SOUNDS = ["steam", "hiss", "motor1", "motor2", "motor3", "knock"];

function bare(): { s: GameSession; sink: NullAudioSink; cam: { x: number; y: number; deg: number } } {
  const sink = new NullAudioSink();
  const s = new GameSession(() => null, sink);
  s.onLog = () => {};
  s.currentSetName = "engine";
  const cam = { x: 0, y: 0, deg: 0 };
  s.listener = () => cam;
  // a second-long clip for every name, the record number its place in SOUNDS
  const clip: DecodedAudio = { samples: new Float32Array(22050), sampleRate: 22050 } as DecodedAudio;
  const lib = s.audioLib as unknown as { sound: (n: string) => DecodedAudio | null; soundPriorityV4: (n: string) => number };
  lib.sound = (n) => (SOUNDS.includes(n.toLowerCase()) ? clip : null);
  lib.soundPriorityV4 = (n) => SOUNDS.indexOf(n.toLowerCase()) + 1;
  return { s, sink, cam };
}

const pass = (s: GameSession) => s.scheduler.pass({ wait: "jump" });
const code = (f: () => void): number | null => {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof ScriptError ? e.code : -1;
  }
};

test("makecricket's errors: 0x28, 0xa, 0xe, and 8 for a full table", () => {
  const { s } = bare();
  const make = (name: string, r: number, b: number, j: number) => () => s.scheduler.makeCricket(name, 0, 0, r, b, j);
  expect(code(make("nosuch", 100, 5, 0))).toBe(0xa);
  expect(code(make("steam", 0, 5, 0)), "radius < 1").toBe(0xe);
  expect(code(make("steam", 100, -1, 0)), "base < 0").toBe(0xe);
  expect(code(make("steam", 100, 5, -2)), "jitter < -1").toBe(0xe);
  expect(code(make("steam", 100, 0, -1)), "a one-shot at once is fine").toBeNull();
  s.currentSetName = "";
  expect(code(make("steam", 100, 5, 0)), "no set open").toBe(0x28);
  s.currentSetName = "engine";
  s.scheduler.stopCricket("all");
  for (let i = 0; i < 16; i++) s.scheduler.makeCricket(SOUNDS[i % SOUNDS.length], 0, 0, 100, 5, 0);
  expect(s.scheduler.crickets.length, "a name made again replaces itself").toBe(SOUNDS.length);
  const sch = s.scheduler as unknown as { crickets: { name: string; slot?: number }[] };
  const one = sch.crickets[0];
  sch.crickets.length = 0;
  for (let i = 0; i < 16; i++) sch.crickets.push({ ...one, name: `x${i}`, slot: i });
  expect(code(make("knock", 100, 5, 0))).toBe(8);
});

test("a repeating cricket: no count out of earshot, a silent re-arm coming in, plays at 0 regardless, stops leaving", async () => {
  const { s, sink, cam } = await bare();
  const plays = () => sink.calls.length;
  s.scheduler.makeCricket("steam", 1000, 0, 200, 3, 0); // base 3, no jitter: count 3
  const c = s.scheduler.crickets[0];
  for (let i = 0; i < 5; i++) await pass(s);
  expect(c.count, "out of earshot: the count stands").toBe(3);
  expect(plays()).toBe(0);
  cam.x = 950; // 50 away
  await pass(s);
  expect(c.armed, "the first pass in earshot arms it").toBe(true);
  expect(plays(), "...and plays nothing").toBe(0);
  expect(s.scheduler.getSoundVol("steam"), "255 − trunc (50·255/200)").toBe(255 - 63);
  await pass(s);
  await pass(s);
  expect(plays()).toBe(0);
  await pass(s);
  expect(plays(), "plays at 0").toBe(1);
  expect(c.count, "and re-arms").toBe(3);
  // a looping play is still sounding when the next comes due: it plays anyway
  s.scheduler.soundLoop("steam", true);
  s.scheduler.soundLoop("steam", false);
  for (let i = 0; i < 3; i++) await pass(s);
  expect(plays(), "no 'previous shot still sounding' test").toBe(2);
  // walk away: its sound stops, the count stands, and it disarms
  s.scheduler.soundLoop("steam", true);
  s.scheduler.makeCricket("steam", 1000, 0, 200, 1, 0);
  await pass(s); // arm
  await pass(s); // play, looping
  const playing = sink.calls.at(-1)!;
  expect(playing.loop).toBe(true);
  cam.x = 0;
  await pass(s);
  expect(playing.stopped, "leaving earshot stops it").toBe(true);
  expect(s.scheduler.crickets[0].armed).toBe(false);
});

test("a cricket in another set does nothing at all; a one-shot counts anywhere and plays only in earshot", async () => {
  const { s, sink, cam } = await bare();
  s.scheduler.makeCricket("knock", 0, 0, 100, 2, -1);
  s.currentSetName = "deck";
  for (let i = 0; i < 4; i++) await pass(s);
  expect(s.scheduler.crickets[0].count, "another set: not even the countdown").toBe(2);
  s.currentSetName = "engine";
  cam.x = 500; // out of earshot
  await pass(s);
  await pass(s);
  expect(s.scheduler.crickets.length, "spent out of earshot, and gone").toBe(0);
  expect(sink.calls.length).toBe(0);
});

test("only the two loudest looping crickets sound", async () => {
  const { s, sink, cam } = await bare();
  for (const n of ["motor1", "motor2", "motor3"]) s.scheduler.soundLoop(n, true);
  s.scheduler.makeCricket("motor1", 100, 0, 1000, 0, 0); // loudest
  s.scheduler.makeCricket("motor2", 300, 0, 1000, 0, 0);
  s.scheduler.makeCricket("motor3", 200, 0, 1000, 0, 0); // second
  cam.x = 0;
  await pass(s);
  const live = sink.calls.filter((c) => !c.stopped).length;
  expect(live).toBe(2);
  expect(s.scheduler.currentSound(1) === "motor1" || s.scheduler.currentSound(2) === "motor1").toBe(true);
  expect(s.scheduler.currentSound(1) === "motor3" || s.scheduler.currentSound(2) === "motor3").toBe(true);
  await pass(s);
  expect(sink.calls.length, "a sound already sounding is not started again").toBe(2);
});

test("pausecricket nests", async () => {
  const { s } = await bare();
  s.scheduler.makeCricket("steam", 0, 0, 200, 3, 0);
  s.scheduler.pauseCricket("steam", true);
  s.scheduler.pauseCricket("all", true);
  s.scheduler.pauseCricket("steam", false);
  expect(s.scheduler.crickets[0].paused).toBe(true);
  expect(s.scheduler.cricketPauseDepth("steam")).toBe(1);
  s.scheduler.pauseCricket("all", false);
  expect(s.scheduler.crickets[0].paused).toBe(false);
});

test("the pan: linear in the angle, folded front to back; the balance law", () => {
  // camera facing 0: dead ahead 128, a quarter turn either side 0 and 255
  expect(cricketPan(0, 0)).toBe(128);
  expect(cricketPan(0, 0x40)).toBe(255);
  expect(cricketPan(0, 0xc0)).toBe(0);
  expect(cricketPan(0, 0x20)).toBe(192);
  expect(cricketPan(0, 0x80), "behind folds onto ahead").toBe(128);
  expect(cricketPan(0, 0x60), "behind-left as front-left").toBe(cricketPan(0, 0x20));
  expect(cricketPan(0x40, 0x40), "turned with the camera").toBe(128);
  // 0x424b90: below 128 the right ear p/128, above it the left (255 − p)/127
  expect(panFrom255(128)).toBe(0);
  expect(panFrom255(0)).toBe(-1);
  expect(panFrom255(255)).toBe(1);
  expect(1 + panFrom255(64), "right ear at 64").toBe(64 / 128);
  expect(1 - panFrom255(192), "left ear at 192").toBe(63 / 127);
});

test("the play rules: single and multiple take the lower channel, dual every one it outranks, both both", () => {
  // channel 1 idle (0), channel 2 holding priority 5
  expect(pickSoundChannelsV4("single", 3, 0, 5)).toEqual([0]);
  expect(pickSoundChannelsV4("single", 5, 0, 5), "the clip already playing is not started again").toEqual([]);
  expect(pickSoundChannelsV4("multiple", 5, 0, 5), "...but multiple restarts it there").toEqual([1]);
  expect(pickSoundChannelsV4("dual", 4, 2, 5)).toEqual([0]);
  expect(pickSoundChannelsV4("dual", 9, 2, 5)).toEqual([0, 1]);
  expect(pickSoundChannelsV4("dual", 1, 2, 5)).toEqual([]);
  expect(pickSoundChannelsV4("both", 1, 2, 5)).toEqual([0, 1]);
});
