/**
 * DreamFactory 5's picture, turning and sound commands, as RedJack.exe's
 * handlers answer them (engine/src/runtime/builtins/df5-look.ts).
 *
 *   npx vitest run engine/tests/df5-look.ts
 *
 * Needs no game data.
 */
import { test, expect } from "vitest";
import { ActorInstance } from "@dreamfactory/engine/runtime/actors";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { packPoint } from "@dreamfactory/engine/runtime/point";
import { PropInstance } from "@dreamfactory/engine/runtime/props";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { composeGamma, shadedPalette } from "@dreamfactory/engine/runtime/shading";

test("v5's contrast, lighting, turning and sound commands, as RedJack.exe answers them", async () => {
  const session = new GameSession(() => null, new NullAudioSink());
  const unknown: string[] = [];
  session.interp.onUnknown = (name) => unknown.push(name);
  const call = (name: string, ...args: (number | string)[]) =>
    session.interp.builtins.get(name)!(session.interp, args, {} as never, {} as never);
  const fails = (name: string, ...args: (number | string)[]) => expect(async () => call(name, ...args)).rejects;
  expect(await call("propcontrast", "lamp", 1)).toBe(0);
  expect(unknown).toEqual(["propcontrast"]);
  session.isV5 = true;

  const p = new PropInstance({} as never, {} as never);
  p.name = "lamp";
  session.propRuntime.props.set("lamp", p);
  const a = new ActorInstance({ name: "nick", poses: [] } as never, { name: "nick.cast", members: [] } as never);
  a.name = "nick";
  (session.actorRuntime as unknown as { actors: Map<string, ActorInstance> }).actors.set("nick", a);

  // 0x42bf40: a gamma per channel, held to -128..128, read back by channel
  await call("propcontrast", "lamp", 20, -300, 0);
  expect([1, 2, 3].map((k) => p.contrast[k - 1])).toEqual([20, -128, 0]);
  expect(await call("propcontrast", "lamp", 2)).toBe(-128);
  await fails("propcontrast", "lamp", 4).toMatchObject({ code: 0xa });
  await fails("propcontrast", "lamp", "1", 0, 0).toMatchObject({ code: 0xe });
  await fails("propcontrast", "nobody", 1).toMatchObject({ code: 0xa });
  await call("actorcontrast", "nick", 5, 5, 5);
  expect(await call("actorcontrast", "nick", 3)).toBe(5);
  // brightness's value form is a channel too (0x42c210), not a two-argument set
  await call("propbrightness", "lamp", 10, 20, 30);
  expect(await call("propbrightness", "lamp", 2)).toBe(20);
  expect(p.bright).toEqual([10, 20, 30]);
  await call("actorbrightness", "nick", -5, 0, 5);
  expect(await call("actorbrightness", "nick", 3)).toBe(5);
  await call("propbrightness", "lamp", 0, 0, 0);
  await call("actorbrightness", "nick", 0, 0, 0);

  // 0x42c0a0: lit by a group, any case; "default" keeps the group it had
  expect(await call("proplitby", "lamp")).toBe("default");
  await call("proplitby", "lamp", "Stage");
  expect(await call("proplitby", "lamp")).toBe("stage");
  expect(p.lightGroup).toBe(2);
  await call("proplitby", "lamp", "default");
  expect([await call("proplitby", "lamp"), p.lightGroup]).toEqual(["default", 2]);
  await fails("proplitby", "lamp", "moon").toMatchObject({ code: 0xa });
  await call("actorlitby", "nick", "set");
  expect(a.lightGroup).toBe(3);

  // the groups' records; the puppet's value forms read the movie's (0x432034)
  await call("stagebrightness", 10, -400, 300);
  expect(session.lights.stage.bright).toEqual([10, -255, 255]);
  expect(await call("stagebrightness", 2)).toBe(-255);
  await call("setcontrast", 30, 30, 30);
  expect(await call("setcontrast", 1)).toBe(30);
  await call("moviebrightness", 7, 7, 7);
  await call("puppetbrightness", 1, 2, 3);
  expect(session.lights.puppet.bright).toEqual([1, 2, 3]);
  expect(await call("puppetbrightness", 1)).toBe(7);
  await call("puppetcontrast", 9, 9, 9);
  expect(await call("puppetcontrast", 1)).toBe(0);
  await fails("stagebrightness", 0).toMatchObject({ code: 0xa });
  await fails("stagecontrast", 1, "2", 3).toMatchObject({ code: 0xe });

  // the picture: a sprite under the stage's record is drawn through both
  // (0x46f230 adds the brightnesses and multiplies the gammas)
  const pal = new Uint8ClampedArray([100, 100, 100, 255]);
  const plain = new PropInstance({} as never, {} as never);
  expect(shadedPalette(pal, plain, null)).toBe(pal);
  expect(shadedPalette(pal, plain, session.lights.group(plain.lightGroup))).toBe(pal);
  await call("propcontrast", "lamp", 0, 0, 0);
  const lit = shadedPalette(pal, p, session.lights.group(p.lightGroup));
  expect([lit[0], lit[1], lit[2]]).toEqual([110, 0, 255]);
  expect(composeGamma(128, 100)).toBe(100);
  expect(composeGamma(64, 64), "a third times a third").toBe(25);

  // turning: 24 bits of a turn (0x428b1c); no room, no camera to roll
  await call("proproll", "lamp", -1);
  expect(await call("proproll", "lamp")).toBe(0xffffff);
  await call("actorpitch", "nick", 0x1400000);
  expect(await call("actorpitch", "nick")).toBe(0x400000);
  await call("actorroll", "nick", 5);
  expect(a.roll).toBe(5);
  expect(await call("actorisfacer", "nick")).toBe(1);
  await call("actorisfacer", "nick", 0);
  await call("actorsnap", "nick", 1);
  expect([a.facer, await call("actorsnap", "nick")]).toEqual([false, 1]);
  await call("cameraroll", 100);
  expect(await call("cameraroll")).toBe(0);
  await fails("cameraroll", "x").toMatchObject({ code: 0xe });

  // sound: nothing open
  expect(await call("soundexists", "boom")).toBe(0);
  await fails("soundticks", "boom").toMatchObject({ code: 0xa });
  await fails("countpuppetsounds").toMatchObject({ code: 0x2d });
  await fails("indextopuppetsubtitle", 1).toMatchObject({ code: 0x2d });
  // a pose without a sound
  await fails("actorsound", "nick", 255, 128).toMatchObject({ code: 0xa });
  await fails("actorsound", "nick", "loud", 128).toMatchObject({ code: 0xe });

  // seeking checks the name only; no room or stage, no colour or depth
  expect(await call("propseek", "lamp")).toBeUndefined();
  await fails("actorseek", "nobody").toMatchObject({ code: 0xa });
  expect(await call("setcolor", packPoint(10, 10))).toBe(0);
  expect(await call("setdepth", packPoint(10, 10))).toBe(0);
  expect(await call("stagecolor", packPoint(10, 10))).toBe(0);
});
