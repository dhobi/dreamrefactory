/**
 * DreamFactory 5's commands outside the room, as RedJack.exe answers them
 * (engine/src/runtime/builtins/df5.ts): calcrgb, norepeat and serial, the
 * sprites' order, card and brightness accessors, the screen's records, the
 * stage's origin and a theme's play order. Each is v5's alone.
 *
 *   npx vitest run engine/tests/df5-builtins.ts
 *
 * Needs no game data.
 */
import { expect, test } from "vitest";
import { buildBankBytes } from "@dreamfactory/engine/df/banks-build";
import { ActorInstance } from "@dreamfactory/engine/runtime/actors";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import type { Value } from "@dreamfactory/engine/runtime/interp";
import { packPoint } from "@dreamfactory/engine/runtime/point";
import { PropInstance } from "@dreamfactory/engine/runtime/props";
import { GameSession } from "@dreamfactory/engine/runtime/session";

function harness() {
  const audio = new NullAudioSink();
  const session = new GameSession(() => null, audio);
  session.isV5 = true;
  session.seedRandom(99);
  const call = (name: string, ...args: Value[]) =>
    session.interp.builtins.get(name)!(session.interp, args, {} as never, undefined as never);
  const fails = (name: string, ...args: Value[]) => expect(async () => call(name, ...args)).rejects;
  const prop = (name: string, states: unknown[]) => {
    const p = new PropInstance({ name, states } as never, {} as never);
    p.name = name;
    session.propRuntime.props.set(name, p);
    return p;
  };
  const actor = (name: string, poses: unknown[]) => {
    const a = new ActorInstance({ name, poses } as never, { name: `${name}.cast`, members: [] } as never);
    a.name = name;
    (session.actorRuntime as unknown as { actors: Map<string, ActorInstance> }).actors.set(name, a);
    return a;
  };
  return { session, audio, call, fails, prop, actor };
}

test("calcrgb packs three bytes, a missing one as 0", async () => {
  const { call } = harness();
  expect(await call("calcrgb", 0x112, 0x34, 0x56)).toBe(0x123456);
  expect(await call("calcrgb")).toBe(0);
});

test("norepeat never repeats its last pick; serial counts round from its first draw", async () => {
  const { call, fails } = harness();
  let last = await call("norepeat", 2);
  for (let k = 0; k < 20; k++) {
    const next = await call("norepeat", 2);
    expect(next).not.toBe(last);
    expect([1, 2]).toContain(next);
    last = next;
  }
  await fails("norepeat", 1).toMatchObject({ code: 0xa });
  const first = (await call("serial", 3)) as number;
  expect(await call("serial", 3)).toBe((first % 3) + 1);
  expect(await call("serial", 1)).toBe(1);
  expect(await call("serial", 1)).toBe(1);
  await fails("serial", 257).toMatchObject({ code: 0xa });
});

test("calcpoint with no room open is behind the camera", async () => {
  const { call } = harness();
  expect(await call("calcpoint")).toBe(packPoint(32000, 32000));
  expect(await call("calcpoint", 1, 2, 3)).toBe(packPoint(32000, 32000));
});

test("proporder and actororder: length, step, picture, count; 0 for anything else", async () => {
  const { call, prop, actor } = harness();
  expect(await call("proporder")).toBe(0);
  prop("empty", []);
  expect(await call("proporder", "empty", 1)).toBe(0);
  const p = prop("door", [{ identifier: "open", frames: [{}, {}, {}] }]);
  p.frameIdx = 1;
  expect(await call("proporder", "door", 1)).toBe(3);
  expect(await call("proporder", "door", 2)).toBe(2);
  expect(await call("proporder", "door", 3)).toBe(1);
  expect(await call("proporder", "door", 7)).toBe(3);
  expect(await call("proporder", "door", 5)).toBe(0);
  expect(await call("proporder", "door")).toBe(0);

  expect(await call("actororder", "nobody", 1)).toBe(0);
  const a = actor("nick", [{ name: "walk", play: [2, 0, 1], steps: [[], [], []] }]);
  a.step = 4;
  expect(await call("actororder", "nick", 1)).toBe(3);
  expect(await call("actororder", "nick", 2)).toBe(2);
  expect(await call("actororder", "nick", 3)).toBe(0);
  expect(await call("actororder", "nick", 7)).toBe(3);
  expect(await call("actororder", "nick")).toBe(0);
  actor("still", [{ name: "x", play: [], steps: [] }]);
  expect(await call("actororder", "still", 2)).toBe(0);
  expect(await call("actororder", "still", 3)).toBe(0);
  actor("noposes", []);
  expect(await call("actororder", "noposes", 1)).toBe(0);
});

test("the card accessors read with one argument and set with two; no sprite is 0", async () => {
  const { call, prop, actor } = harness();
  const p = prop("plank", []);
  const a = actor("nick", []);
  expect(await call("propistrue3d")).toBe(0);
  expect(await call("actoristrue3d", "nobody")).toBe(0);
  for (const [cmd, field] of [["propistrue3d", "true3d"], ["propisfacer", "facer"], ["propsnap", "snap"]] as const) {
    await call(cmd, "plank", 1);
    expect([p[field], await call(cmd, "plank")]).toEqual([true, 1]);
    await call(cmd, "plank", 0);
    expect([p[field], await call(cmd, "plank")]).toEqual([false, 0]);
  }
  await call("actoristrue3d", "nick", 1);
  expect(await call("actoristrue3d", "nick")).toBe(1);
  await call("actoristrue3d", "nick", 0);
  expect(await call("actoristrue3d", "nick")).toBe(0);
  await call("actorflip", "nick", "x");
  expect(a.flip).toBe(0);
  await call("actorflip", "nick", 2);
  expect(await call("actorflip", "nick")).toBe(2);
});

test("brightness: sprites and the screen, held to -255..255, channels 1..3", async () => {
  const { session, call, fails, prop, actor } = harness();
  expect(await call("propbrightness")).toBe(0);
  expect(await call("actorbrightness", "nobody", 1, 1, 1)).toBe(0);
  const p = prop("bottle", []);
  const a = actor("nick", []);
  await call("propbrightness", "bottle", 300, undefined as never, -300);
  expect(p.bright).toEqual([255, 0, -255]);
  expect(await call("propbrightness", "bottle", 3)).toBe(-255);
  await fails("propbrightness", "bottle", 0).toMatchObject({ code: 0xa });
  await call("actorbrightness", "nick", 1, 2, 3);
  expect(await call("actorbrightness", "nick", 2)).toBe(2);
  expect(a.bright).toEqual([1, 2, 3]);

  await call("screenbrightness", 10, 20, 30);
  expect(session.screenBright).toEqual([10, 20, 30]);
  expect(await call("screenbrightness", 9)).toBe(30);
  expect(await call("screenbrightness", -1)).toBe(10);
  await call("screencontrast", 200, undefined as never, -5);
  expect(session.screenContrast).toEqual([128, 0, -5]);
  expect(await call("screencontrast", 1)).toBe(128);
});

test("stageorigin: nothing with no stage, then the origin by axis", async () => {
  const { session, call } = harness();
  expect(await call("stageorigin", 5, 6)).toBe(0);
  expect(session.stageOrigin).toEqual({ x: 0, y: 0 });
  session.stageName = "fight";
  await call("stageorigin", 5.7, -6.2);
  expect(session.stageOrigin).toEqual({ x: 5, y: -6 });
  expect(await call("stageorigin", 2)).toBe(-6);
  expect(await call("stageorigin", 1)).toBe(5);
  expect(await call("stageorigin")).toBe(5);
});

test("themeorder reorders an open theme's loops, and restarts it when it is the one playing", async () => {
  const { session, audio, call } = harness();
  // no bank of that name, no order
  await call("themeorder");
  expect(audio.calls).toEqual([]);
  const tone = { sampleRate: 11025, samples: new Float32Array(40).fill(0.25) };
  session.audioLib.openBank("fight.trk", buildBankBytes({
    name: "fight.trk",
    loops: [{ identifier: "a", audio: tone }, { identifier: "b", audio: tone }],
    singles: [],
  }));
  // an order with no loops in it is refused
  await call("themeorder", "fight.trk", "9,0,x");
  expect(audio.calls).toEqual([]);
  // not playing: reordered, nothing started
  await call("themeorder", "fight.trk", "2,1");
  expect(audio.calls).toEqual([]);
  session.currentThemeName = "FIGHT.TRK";
  await call("themeorder", "fight.trk", "2,2,1");
  expect(audio.calls).toHaveLength(1);
  expect(audio.calls[0]).toMatchObject({ channel: "theme", loop: true });
});

test("doublebuffer answers 1 and keeps the depth asked for; elsewhere these are unknown", async () => {
  const { session, call } = harness();
  expect(await call("doublebuffer", 640, 480, 16)).toBe(1);
  expect(session.screenDepth).toBe(16);
  expect(await call("singlebuffer", 640, 480, 24)).toBe(1);
  expect(session.screenDepth).toBe(32);
  expect(await call("singlebuffer")).toBe(1);
  expect(await call("isdebugging")).toBe(0);
  session.isV5 = false;
  const unknown: string[] = [];
  session.interp.onUnknown = (n) => unknown.push(n);
  expect(await call("calcrgb", 1, 2, 3)).toBe(0);
  expect(unknown).toEqual(["calcrgb"]);
});
