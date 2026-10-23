/**
 * The plugin bus (engine/src/runtime/builtins/plugins.ts): the xray reveal's
 * three forms, the camera's open, save and display, checkmove with no board,
 * scrollflat's flat changes, and an unknown plugin.
 *
 *   npx vitest run engine/tests/plugin-builtins.ts
 *
 * Needs no game data.
 */
import { expect, test } from "vitest";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import type { Value } from "@dreamfactory/engine/runtime/interp";
import { CAMERA_ID_TAKEN, CAMERA_NO_PHOTO, CAMERA_OK, PHOTO_X, PHOTO_Y } from "@dreamfactory/engine/runtime/photos";
import { packPoint } from "@dreamfactory/engine/runtime/point";
import { GameSession } from "@dreamfactory/engine/runtime/session";

function harness() {
  const session = new GameSession(() => null, new NullAudioSink());
  const logs: string[] = [];
  session.onLog = (l) => logs.push(l);
  const call = (name: string, ...args: Value[]) =>
    session.interp.builtins.get(name)!(session.interp, args, {} as never, undefined as never);
  return { session, logs, call };
}

test("xray: armed by flat names, aimed by a point, torn down by nothing", async () => {
  const { session, logs, call } = harness();
  // aimed with nothing armed: silently nothing
  expect(await call("plugin", "xray", packPoint(1, 2))).toBe(0);
  expect(session.plugins.xray).toBeNull();
  await call("plugin", "xray", "", "base", "mask");
  expect(logs.at(-1)).toContain("armed with no hidden flat");
  await call("plugin", "XRay", "hidden", "base", "");
  expect(logs.at(-1)).toContain("armed with no mask prop");
  expect(session.plugins.xray).toBeNull();
  await call("plugin", "xray", "hidden", "", "mask", "light");
  expect(logs.at(-1)).toBe("xray: hidden through mask over (current flat)");
  await call("pluginfx", "xray", "hidden", "base", "mask", "light");
  expect(logs.at(-1)).toBe("xray: hidden through mask over base");
  await call("plugin", "xray", packPoint(30, 40));
  expect(session.plugins.xray).toMatchObject({ x: 30, y: 40, aimed: true });
  await call("plugin", "xray");
  expect(session.plugins.xray).toBeNull();
});

test("camera: open, a save refused for a taken id, an empty shot, and a display", async () => {
  const { session, logs, call } = harness();
  expect(await call("pluginfx", "camera")).toBe(CAMERA_OK);
  // display of a photo that is not there
  expect(await call("pluginfx", "camera", "path", 4)).toBe(CAMERA_NO_PHOTO);
  // no framebuffer: an empty shot that still succeeds
  expect(await call("pluginfx", "camera", "path", 4, packPoint(100, 100))).toBe(CAMERA_OK);
  expect(logs.at(-1)).toContain("nothing to photograph");
  const photo = { rgba: new Uint8ClampedArray(4), width: 1, height: 1 };
  const grabbed: [number, number][] = [];
  session.grabPhoto = (x, y) => (grabbed.push([x, y]), photo);
  expect(await call("pluginfx", "camera", "path", 4, packPoint(100, 120))).toBe(CAMERA_OK);
  expect(grabbed).toEqual([[100, 120]]);
  expect(await call("pluginfx", "camera", "path", 4, packPoint(1, 1))).toBe(CAMERA_ID_TAKEN);
  expect(grabbed).toHaveLength(1);
  // a save with the point left out is centred on (0, 0)
  expect(await call("pluginfx", "camera", "path", 5, undefined as never)).toBe(CAMERA_OK);
  expect(grabbed.at(-1)).toEqual([0, 0]);
  expect(await call("pluginfx", "camera", "path", 4)).toBe(CAMERA_OK);
  expect(session.photoOverlay).toEqual({ photo, x: PHOTO_X, y: PHOTO_Y });
  // the id left out is photo 0
  expect(await call("pluginfx", "camera", "path", undefined as never)).toBe(CAMERA_NO_PHOTO);
});

test("checkmove with no board says so; an unknown plugin is logged and answers 0", async () => {
  const { logs, call } = harness();
  await call("pluginfx", "checkmove");
  expect(logs.at(-1)).toBe(`pluginfx("checkmove"): called with no board`);
  expect(await call("plugin", "network", 1)).toBe(0);
  expect(logs.at(-1)).toBe(`plugin("network"): unknown plugin`);
  expect(await call("plugin")).toBe(0);
  expect(logs.at(-1)).toBe(`plugin(""): unknown plugin`);
});

test("scrollflat goes to the mid flat and the destination, and only with four arguments", async () => {
  const { session, call } = harness();
  const went: string[] = [];
  const flats = ["one", "mid", "dest"];
  session.stageCtrl.flatToIndex = (n: string) => flats.indexOf(n) + 1;
  session.stageCtrl.gotoFlat = async (n: string) => void went.push(n);
  expect(await call("plugin", "scrollflat", "mid", "dest", 1)).toBe(0);
  expect(await call("plugin", "scrollflat", "mid", "nowhere", 1, 2)).toBe(0);
  expect(went).toEqual([]);
  expect(await call("plugin", "scrollflat", "mid", "dest", 1, 2)).toBe(0);
  expect(went).toEqual(["mid", "dest"]);
  // a mid name that is no flat (an inventory prop's): straight to the destination
  expect(await call("plugin", "scrollflat", "bag", "one", 1, 2)).toBe(0);
  expect(went).toEqual(["mid", "dest", "one"]);
  expect(await call("plugin", "scrollflat")).toBe(0);
});
