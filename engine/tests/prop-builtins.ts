/**
 * The prop commands' edges (engine/src/runtime/builtins/props.ts): a prop that
 * is not there, an argument left off, the getter forms, `prophide`'s broadcast,
 * the DreamFactory 5-only setters' ranges, and `starxyz`'s axes.
 *
 *   npx vitest run engine/tests/prop-builtins.ts
 *
 * Needs no game data: the shop is written with the engine's own builder.
 */
import { expect, test } from "vitest";
import { buildShpBytes } from "@dreamfactory/engine/df/shp-build";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { packPoint } from "@dreamfactory/engine/runtime/point";
import { GameSession } from "@dreamfactory/engine/runtime/session";

type Arg = number | string | undefined;

const frame = () => ({
  width: 2, height: 2, posXraw: 0, posYraw: 0, indexed: new Uint8Array(4), opaque: new Uint8Array([1, 1, 1, 1]),
});

async function rig() {
  const shp = buildShpBytes({
    palette: [0, 0, 0],
    groups: [
      { name: "lamp", states: [
        { identifier: "On", frames: [{ art: frame() }, { art: frame() }] },
        { identifier: "off", frames: [{ art: frame() }] },
      ] },
      { name: "chair", states: [{ identifier: "still", frames: [{ art: frame() }] }] },
    ],
  });
  const session = new GameSession((n) => (n === "t.shp" ? shp : null), new NullAudioSink());
  await session.openShop("t.shp");
  const log: string[] = [];
  session.onLog = (m: string) => log.push(m);
  const call = (name: string, ...args: Arg[]) =>
    session.interp.builtins.get(name)!(session.interp, args as never, {} as never, {} as never);
  const fails = (name: string, ...args: Arg[]) => expect((async () => call(name, ...args))()).rejects;
  const prop = (n: string) => session.propRuntime.get(n)!;
  return { session, log, call, fails, prop };
}

test("missing props and missing arguments answer the empty value", async () => {
  const { session, call, prop } = await rig();
  expect(await call("propxy", "nobody", 1, 2)).toBe(0);
  expect(await call("propxy", "lamp")).toBe(0);
  expect(await call("propxyz", "nobody", 1)).toBe(0);
  expect(await call("propxyz", "lamp")).toBe(0);
  await call("propxyz", "lamp", 5, 6);
  expect([prop("lamp").worldX, prop("lamp").worldY, prop("lamp").worldZ]).toEqual([5, 6, 0]);
  expect(await call("propxyz", "lamp", 4)).toBe(packPoint(5, 6));
  expect(await call("propxyz", "lamp", 7)).toBe(0);
  expect(await call("indextoprop")).toBe("");
  expect(session.lastResult).toBe("");
  expect(await call("indextoprop", 2)).toBe("chair");
  expect(session.lastResult).toBe("t.shp");
  // propinstance with nothing named copies nothing
  await call("propinstance");
  expect(session.propRuntime.props.size).toBe(2);
  await call("propdelete");
  expect(session.propRuntime.props.size).toBe(2);
  await call("propdelete", "CHAIR");
  expect(session.propRuntime.props.size).toBe(1);
});

test("prophide: one prop, or all of them; hiding takes only what is shown, showing releases all", async () => {
  const { call, prop } = await rig();
  prop("lamp").visible = true;
  await call("prophide", "all");
  expect([prop("lamp").hidden, prop("chair").hidden]).toEqual([true, false]);
  prop("chair").hidden = true;
  await call("prophide", "all", 0);
  expect([prop("lamp").hidden, prop("chair").hidden]).toEqual([false, false]);
  await call("prophide", "chair");
  expect(prop("chair").hidden).toBe(true);
  await call("prophide", "nobody", 1);
  await call("prophide");
  expect(prop("lamp").hidden).toBe(false);
});

test("propview: the default state's name, an unknown state, a one-frame state", async () => {
  const { call, prop } = await rig();
  expect(await call("propview", "lamp")).toBe("on");
  await call("propview", "lamp", "missing");
  expect(prop("lamp").state()).toBeNull();
  expect(prop("lamp").animating).toBe(false);
  expect(prop("lamp").frameOrder).toBeNull();
  expect(await call("propview", "lamp")).toBe("missing");
  await call("propview", "lamp", "off");
  expect(prop("lamp").animating).toBe(false);
  await call("propview", "lamp", "on");
  expect(prop("lamp").animating).toBe(true);
  // propdeg on a state that is not there pins nothing
  await call("propview", "lamp", "missing");
  await call("propdeg", "lamp", 3);
  expect(prop("lamp").frameLocked).toBe(false);
});

test("scale, distance, speed and flip read a non-number as 0; owner and set", async () => {
  const { session, call, prop } = await rig();
  for (const c of ["propscale", "propdist", "propspeed"]) {
    await call(c, "lamp", "lots");
    expect(await call(c, "lamp")).toBe(0);
  }
  await call("propset", "lamp", "");
  expect(prop("lamp").worldSpace).toBe(false);
  await call("propset", "lamp", "Hall");
  expect([prop("lamp").setName, prop("lamp").worldSpace]).toEqual(["hall", true]);
  await call("propowner", "lamp", "nick");
  expect(await call("propowner", "lamp")).toBe("nick");
  // DreamFactory 5's setters
  session.isV5 = true;
  await call("propink", "lamp", 4);
  await call("propink", "lamp", 12);
  expect(prop("lamp").ink).toBe(4);
  await call("propflip", "lamp", "x");
  expect(prop("lamp").flip).toBe(0);
  await call("propflip", "lamp", 2);
  expect(await call("propflip", "lamp")).toBe(2);
  // propis3d: a word of the record there, 0 everywhere else
  expect(await call("propis3d")).toBe(0);
  expect(await call("propis3d", "lamp")).toBe(1);
  await call("propis3d", "lamp", 0);
  expect(prop("lamp").worldSpace).toBe(false);
  expect(await call("propis3d", "lamp")).toBe(0);
  // propdeg keeps v5's 24 bits
  await call("propdeg", "lamp", 0x1000005);
  expect(prop("lamp").deg).toBe(5);
  session.isV5 = false;
  expect(await call("propis3d", "lamp")).toBe(0);
  await call("propdeg", "lamp", "left");
  expect(prop("lamp").deg).toBe("left");
});

test("error(): 0x2f where calls are strict, a log line in RedJack", async () => {
  const { session, log, call, fails } = await rig();
  await fails("error", "boom").toMatchObject({ code: 0x2f });
  session.isV5 = true;
  await call("error", "boom", 2);
  expect(log.at(-1)).toBe("script error(): boom, 2");
});

test("starxyz: every axis of a star, and no star is logged and 0", async () => {
  const { session, log, call } = await rig();
  session.currentBinding = {
    onLog: (m: string) => log.push(m),
    set: { scenes: [], actors: [{ identifier: "well", positionX: 0x10001, positionY: 7, positionZ: 9, rotation8: 0 }] },
  } as never;
  expect(await call("starxyz", "well")).toBe(0x10001);
  expect(await call("starxyz", "well", 2)).toBe(9);
  expect(await call("starxyz", "well", 3)).toBe(7);
  expect(await call("starxyz", "well", 4)).toBe((1 << 16) | 9);
  expect(await call("starxyz", "well", 5)).toBe(0);
  expect(await call("starxyz")).toBe(0);
  expect(log.at(-1)).toMatch(/^starxyz: no star ""/);
});
