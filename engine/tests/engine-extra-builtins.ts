/**
 * The TI.EXE commands no shipped script calls (engine/src/runtime/builtins/engine-extras.ts):
 * the locks, the global table by index, type (), the offline network, the
 * plugin table, soundrate and themepan.
 *
 *   npx vitest run engine/tests/engine-extra-builtins.ts
 *
 * Needs no game data.
 */
import { expect, test } from "vitest";
import { buildBankBytes } from "@dreamfactory/engine/df/banks-build";
import { ActorInstance } from "@dreamfactory/engine/runtime/actors";
import { NullAudioSink, type PlayHandle } from "@dreamfactory/engine/runtime/audio";
import type { Value } from "@dreamfactory/engine/runtime/interp";
import { PropInstance } from "@dreamfactory/engine/runtime/props";
import { GameSession } from "@dreamfactory/engine/runtime/session";

function harness() {
  const session = new GameSession(() => null, new NullAudioSink());
  const call = (name: string, ...args: Value[]) =>
    session.interp.builtins.get(name)!(session.interp, args, {} as never, undefined as never);
  const fails = (name: string, ...args: Value[]) => expect(async () => call(name, ...args)).rejects;
  return { session, call, fails };
}

const tone = (rate: number) => ({ sampleRate: rate, samples: new Float32Array(40).fill(0.25) });

test("a lock wants the object open, by any case; anything else is 0xa", async () => {
  const { session, call, fails } = harness();
  for (const cmd of ["actorlock", "proplock", "castlock", "shoplock"]) {
    await fails(cmd).toMatchObject({ code: 0xa });
    await fails(cmd, "x", true).toMatchObject({ code: 0xa });
  }
  const a = new ActorInstance({ name: "rose", poses: [] } as never, { name: "rose.cast", members: [] } as never);
  (session.actorRuntime as unknown as { actors: Map<string, ActorInstance> }).actors.set("rose", a);
  session.propRuntime.props.set("lamp", new PropInstance({} as never, {} as never));
  session.actorRuntime.casts.set("Rose.Cast", {} as never);
  session.propRuntime.shops.set("lamp.shp", {} as never);
  expect(await call("actorlock", "rose", true)).toBeUndefined();
  expect(await call("proplock", "lamp", true)).toBeUndefined();
  expect(await call("castlock", "ROSE.CAST", true)).toBeUndefined();
  expect(await call("shoplock", "Lamp.Shp", false)).toBeUndefined();
  await fails("castlock", "other.cast").toMatchObject({ code: 0xa });
});

test("indextoglobal counts the globals from 1 in declaration order", async () => {
  const { session, call, fails } = harness();
  session.interp.globals.clear();
  session.interp.setGlobal("first", 1);
  session.interp.setGlobal("second", 2);
  expect(await call("countglobals")).toBe(2);
  expect(await call("indextoglobal", 2)).toBe("second");
  await fails("indextoglobal").toMatchObject({ code: 0xa });
  await fails("indextoglobal", 3).toMatchObject({ code: 0xa });
});

test("type names a value's tag; the machine is a Pentium; the network is off", async () => {
  const { call, fails } = harness();
  expect(await call("type", "a")).toBe("text");
  expect(await call("type", 3)).toBe("number");
  expect(await call("type", true)).toBe("logic");
  expect(await call("type")).toBe("unknown");
  expect(await call("machinespeed")).toBe(586);
  expect(await call("netconnect")).toBeUndefined();
  expect(await call("networkon")).toBe(false);
  await fails("netourid").toMatchObject({ code: 0x3a });
});

test("pluginexists knows the port's plugins by any case, and wants a string", async () => {
  const { call, fails } = harness();
  expect(await call("pluginexists", "XRay")).toBe(true);
  expect(await call("pluginexists", "network")).toBe(false);
  await fails("pluginexists", 1).toMatchObject({ code: 0xe });
  await fails("pluginexists").toMatchObject({ code: 0xe });
});

test("soundrate reads an open bank's one-shot; anything else is 0xa", async () => {
  const { session, call, fails } = harness();
  await fails("soundrate").toMatchObject({ code: 0xa });
  session.audioLib.openBank("fx.sfx", buildBankBytes({ singles: [{ identifier: "creak", audio: tone(22050) }] }));
  expect(await call("soundrate", "CREAK")).toBe(22050);
  await fails("soundrate", "bang").toMatchObject({ code: 0xa });
});

test("themepan keeps a pan per track, held to 0..255, and moves the theme playing", async () => {
  const { session, call } = harness();
  expect(await call("themepan")).toBe(128);
  expect(await call("themepan", "deck.trk")).toBe(128);
  const placed: [number, number][] = [];
  session.themeHandle = { stop() {}, place: (k: number, pan: number) => void placed.push([k, pan]) } as unknown as PlayHandle;
  await call("themepan", "Deck.trk", 300);
  expect(await call("themepan", "deck.trk")).toBe(255);
  expect(placed).toEqual([]);
  session.currentThemeName = "DECK.TRK";
  await call("themepan", "deck.trk", -4);
  expect(await call("themepan", "deck.trk")).toBe(0);
  expect(placed).toHaveLength(1);
  expect(placed[0][0]).toBe(1);
  // an open bank is matched by its track name, whatever its file is called
  session.audioLib.openBank("p1.trk", buildBankBytes({ name: "music.trk", loops: [{ identifier: "a", audio: tone(11025) }] }));
  session.currentThemeName = "p1.trk";
  await call("themepan", "p1.trk", 10);
  expect(placed).toHaveLength(2);
  session.themeHandle = null;
  await call("themepan", "p1.trk", 20);
  expect(await call("themepan", "p1.trk")).toBe(20);
});
