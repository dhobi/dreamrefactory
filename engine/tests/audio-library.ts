/**
 * The sound commands' quieter answers (engine/src/runtime/builtins/audio.ts) and
 * the audio plumbing under them (engine/src/runtime/audio.ts): the per-name
 * volume and pan, banks listed by index, a theme that is not there, closing a
 * bank with no theme playing; the deferred sink's held loop before and after a
 * real sink attaches, and a timed loop switched off and on.
 *
 *   npx vitest run engine/tests/audio-library.ts
 *
 * Needs no game data.
 */
import { expect, test } from "vitest";
import { buildBankBytes } from "@dreamfactory/engine/df/banks-build";
import { DeferredAudioSink, NullAudioSink, TimedAudio } from "@dreamfactory/engine/runtime/audio";
import type { Value } from "@dreamfactory/engine/runtime/interp";
import { GameSession } from "@dreamfactory/engine/runtime/session";

const tone = { sampleRate: 6000, samples: new Float32Array(600).fill(0.25) };

function harness() {
  const session = new GameSession(() => null, new NullAudioSink());
  const logs: string[] = [];
  session.onLog = (l) => logs.push(l);
  const call = (name: string, ...args: Value[]) =>
    session.interp.builtins.get(name)!(session.interp, args, {} as never, undefined as never);
  return { session, logs, call };
}

test("soundvol and soundpan keep a level per name; a missing name is the empty one", async () => {
  const { call } = harness();
  expect(await call("soundvol", "gust", 99)).toBe(99);
  expect(await call("soundvol", "GUST")).toBe(99);
  expect(await call("soundpan", "gust", 10)).toBe(10);
  expect(await call("soundpan", "gust")).toBe(10);
  await call("soundvol", undefined as never, 7);
  expect(await call("soundvol")).toBe(7);
  await call("soundpan", undefined as never, 3);
  expect(await call("soundpan")).toBe(3);
});

test("banks by index: one-shots and tracks, 1-based, and nothing out of range", async () => {
  const { session, call } = harness();
  expect(await call("countsounds")).toBe(0);
  expect(await call("indextosound")).toBe("");
  expect(await call("indextotrack")).toBe("");
  session.audioLib.openBank("fx.sfx", buildBankBytes({ name: "fx.trk", singles: [{ identifier: "creak", audio: tone }] }));
  expect(await call("countsounds", "fx.sfx")).toBe(1);
  expect(await call("indextosound", "fx.sfx", 1)).toBe("creak");
  expect(await call("indextosound", "fx.sfx", 2)).toBe("");
  // only a bank with music is a track
  expect(await call("counttracks")).toBe(0);
  session.audioLib.openBank("music.trk", buildBankBytes({ loops: [{ identifier: "a", audio: tone }] }));
  expect(await call("counttracks")).toBe(1);
  expect(await call("indextotrack", 1)).toBe("music.trk");
  // a sound the bank names whose container is gone: no chunk
  session.audioLib.openBank("broken.sfx", buildBankBytes({ singles: [{ identifier: "gone", audio: tone }] }));
  const entry = (session.audioLib as unknown as { banks: Map<string, { file: { containers: unknown[] } }> }).banks.get("broken.sfx")!;
  entry.file.containers.length = 3;
  expect(session.audioLib.soundChunk("gone")).toBeNull();
  expect(session.audioLib.soundRecordV1("nothing.snd", "x")).toBe(0);
  // a bank with no named loops has no chunk to name
  expect(session.audioLib.themeChunkAt("fx.sfx", 1)).toBeNull();
  expect(session.audioLib.themeChunkAt("none.trk", 1)).toBeNull();
});

test("playtheme with nothing to play says so; closing a bank with no theme playing halts nothing", async () => {
  const { session, logs, call } = harness();
  await call("playtheme");
  expect(logs.at(-1)).toBe("playtheme: no theme available");
  await call("playtheme", "deck.trk");
  expect(logs.at(-1)).toBe("playtheme: no theme available (deck.trk)");
  session.audioLib.openBank("deck.trk", buildBankBytes({ name: "deck.trk", loops: [{ identifier: "a", audio: tone }] }));
  session.currentThemeName = "";
  await call("closetrackfile", "deck.trk");
  expect(session.currentThemeName).toBe("");
  await call("closetrackfile");
});

test("the deferred sink holds a loop until a sink attaches, and the handle follows it", () => {
  const d = new DeferredAudioSink();
  const once = d.play("sound", tone);
  expect(once.done).toBe(true);
  const loop = d.play("theme", tone, { loop: true });
  expect(loop.done).toBe(false);
  const real = new NullAudioSink();
  d.attach(real);
  expect(real.calls).toHaveLength(1);
  expect(loop.done).toBe(false);
  loop.stop();
  expect(loop.done).toBe(true);
  expect(real.calls[0].stopped).toBe(true);
  // a held loop stopped before the attach is never started
  const d2 = new DeferredAudioSink();
  d2.play("theme", tone, { loop: true }).stop();
  const real2 = new NullAudioSink();
  d2.attach(real2);
  expect(real2.calls).toHaveLength(0);
});

test("a timed loop switched off ends with its round; an overlapping one leaves the channel alone", () => {
  let now = 0;
  const t = new TimedAudio(new NullAudioSink(), () => now, () => true);
  const h = t.play("sound", tone, { loop: true });
  expect(h.done).toBe(false);
  now = 150; // 0.15 s into a 0.1 s clip
  h.setLoop!(false);
  expect(h.done).toBe(false);
  now = 200;
  expect(h.done).toBe(true);
  h.setLoop!(true);
  expect(h.done).toBe(false);
  const o = t.play("sound", tone, { loop: true, overlap: true });
  o.setLoop!(false);
  now = 1000;
  expect(o.done).toBe(true);
});
