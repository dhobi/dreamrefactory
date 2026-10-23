/**
 * The timing commands (engine/src/runtime/builtins/timing.ts) and the cricket
 * table's opcodes behind them (engine/src/runtime/crickets.ts): loops made,
 * paused, asked about and listed; crickets made with their defaults, paused,
 * counted and listed; soundloop's getter and setter.
 *
 *   npx vitest run engine/tests/timing-builtins.ts
 *
 * Needs no game data.
 */
import { expect, test } from "vitest";
import { buildBankBytes } from "@dreamfactory/engine/df/banks-build";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import type { Value } from "@dreamfactory/engine/runtime/interp";
import { GameSession } from "@dreamfactory/engine/runtime/session";

function harness(v5 = false) {
  const session = new GameSession(() => null, new NullAudioSink());
  session.isV5 = v5;
  const call = (name: string, ...args: Value[]) =>
    session.interp.builtins.get(name)!(session.interp, args, {} as never, undefined as never);
  const fails = (name: string, ...args: Value[]) => expect(async () => call(name, ...args)).rejects;
  return { session, call, fails };
}

const tone = { sampleRate: 11025, samples: new Float32Array(40).fill(0.25) };

test("delay sleeps n sixtieths; none is no time at all", async () => {
  const { session, call } = harness();
  const slept: number[] = [];
  session.clock.sleep = async (ms: number) => void slept.push(ms);
  await call("delay", 6);
  await call("delay");
  expect(slept).toEqual([100, 0]);
});

test("loops: made, asked about, listed, paused and stopped, a missing name as empty", async () => {
  const { session, call } = harness();
  await call("makeloop", "Prop", "Lamp", "flicker", 3);
  await call("makeloop", "prop", "fan");
  await call("makeloop");
  expect(await call("countloops")).toBe(3);
  expect(await call("isloop", "prop", "LAMP")).toBe(1);
  expect(await call("isloop")).toBe(1);
  expect(await call("isloop", "actor", "lamp")).toBe(0);
  expect(await call("indextoloop", 1)).toBe("lamp");
  expect(await call("indextoloop", 9)).toBe("");
  expect(await call("indextoloop")).toBe("");
  const fan = session.scheduler.loops.find((l) => l.name === "fan")!;
  expect(fan.handler).toBe("");
  // the getter, before v5: the pause as the engine answers it
  expect(await call("pauseloop", "prop", "lamp")).toBeFalsy();
  await call("pauseloop", "prop", "lamp", 1);
  expect(await call("pauseloop", "prop", "lamp")).toBeTruthy();
  expect(await call("pauseloop", "prop", "nothing")).toBeFalsy();
  // no flag pauses; no name at all is the setter too
  await call("pauseloop", "prop", "fan");
  await call("pauseloop");
  await call("stoploop", "prop", "lamp");
  await call("stoploop");
  expect(await call("countloops")).toBe(1);
  expect(await call("indextoloop", 1)).toBe("fan");
});

test("RedJack has no loop getter: two arguments pause it", async () => {
  const { session, call } = harness(true);
  await call("makeloop", "prop", "lamp", "flicker", 1);
  expect(await call("pauseloop", "prop", "lamp")).toBeUndefined();
  expect(session.scheduler.loops[0].paused).toBe(true);
});

test("crickets: made with the defaults, counted, listed, paused by name and all, stopped", async () => {
  const { session, call, fails } = harness(true);
  session.audioLib.openBank("fx.sfx", buildBankBytes({
    singles: [{ identifier: "chirp", audio: tone }, { identifier: "drip", audio: tone }],
  }));
  await fails("makecricket").toMatchObject({ code: 0xa });
  await call("makecricket", "chirp");
  const c = session.scheduler.crickets.table[0];
  expect([c.radius, c.base, c.jitter, c.count]).toEqual([1, 0, -1, 0]);
  await call("makecricket", "drip", 10, 20, 300, 2, 4);
  expect(await call("countcrickets")).toBe(2);
  expect(await call("iscricket", "DRIP")).toBe(1);
  expect(await call("iscricket")).toBe(0);
  expect(await call("indextocricket", 2)).toBe("drip");
  expect(await call("indextocricket")).toBe("");
  await fails("makecricket", "drip", 0, 0, 0).toMatchObject({ code: 0xe });
  // RedJack has no pause getter: one argument pauses
  await call("pausecricket", "drip");
  expect(session.scheduler.crickets.table[1].paused).toBe(true);
  await call("pausecricket");
  expect(session.scheduler.crickets.table[0].paused).toBe(true);
  await call("pausecricket", "all", 0);
  expect(session.scheduler.crickets.table.map((x) => x.pauseDepth)).toEqual([0, 1]);
  await call("stopcricket", "chirp");
  expect(await call("countcrickets")).toBe(1);
  await call("stopcricket");
  expect(await call("countcrickets")).toBe(0);
});

test("Titanic's pausecricket with one argument reads the pause count", async () => {
  const { session, call } = harness();
  session.currentSetName = "deck";
  session.audioLib.openBank("fx.sfx", buildBankBytes({ singles: [{ identifier: "chirp", audio: tone }] }));
  await call("makecricket", "chirp", 0, 0, 5, 1, 2);
  expect(await call("pausecricket", "chirp")).toBe(0);
  expect(await call("pausecricket", "nobody")).toBe(0);
  await call("pausecricket", "chirp", 1);
  await call("pausecricket", "chirp", 1);
  expect(await call("pausecricket", "CHIRP")).toBe(2);
  // an old record with a flag and no count
  const c = session.scheduler.crickets.table[0];
  c.pauseDepth = undefined;
  c.paused = true;
  expect(await call("pausecricket", "chirp")).toBe(1);
  c.paused = false;
  expect(await call("pausecricket", "chirp")).toBe(0);
});

test("soundloop: one argument reads the flag, two set it", async () => {
  const { call } = harness();
  expect(await call("soundloop", "saw")).toBe(false);
  await call("soundloop", "SAW", 1);
  expect(await call("soundloop", "saw")).toBe(true);
  await call("soundloop", "saw", 0);
  expect(await call("soundloop", "saw")).toBe(false);
  await call("soundloop", undefined as never, 1);
  expect(await call("soundloop")).toBe(true);
});
