/**
 * World props and actors in a DreamFactory 5 room (engine/src/runtime/props.ts,
 * engine/src/runtime/actors.ts), seen through a real room camera
 * (MazeRuntime.spriteCamera): a turned prop picks its frame by its facing from
 * the camera; a sprite mirrored top to bottom keeps its hot spot with the
 * picture and is hit through the mirror; a true-3D prop or actor is a card,
 * painted with the view's palette when its frame has none and no scenery to
 * hide it; a card seen edge-on shows no pixel, and a mirrored card's half turn
 * keeps a negative heading's sign (RedJack.exe 0x42cc3b); an actor with no
 * picture, or a pose with an empty play script, has no box and tells no end.
 * And the props' boxes with no camera, which are the screen props' alone.
 *
 *   npx vitest run engine/tests/world-sprites-v5.ts
 *
 * Needs no game data.
 */
import { expect, test } from "vitest";
import { buildCstFile } from "@dreamfactory/engine/df/cst-build";
import { readCstFile } from "@dreamfactory/engine/df/cst";
import { writeContainerFile } from "@dreamfactory/engine/df/container";
import type { SettFile } from "@dreamfactory/engine/df/sett";
import { buildShpBytes } from "@dreamfactory/engine/df/shp-build";
import { readShpFile, type ShpFrame } from "@dreamfactory/engine/df/shp";
import { ActorRuntime } from "@dreamfactory/engine/runtime/actors";
import type { WorldCamera } from "@dreamfactory/engine/runtime/geometry";
import { MazeRuntime } from "@dreamfactory/engine/runtime/maze";
import { PropRuntime, cardOf, cardTexel } from "@dreamfactory/engine/runtime/props";

const W = 64;
const H = 48;

/** a room camera at the origin looking along +x, 90° across a 64×48 view */
function camera(): WorldCamera {
  const sett: SettFile = {
    file: { containers: [] } as never, name: "test", mainScript: 0,
    nodes: [{ name: "Scene1", id: 1, node: 1, sphere: 0, script: 0, x: 0, y: 0, z: 0 }],
    scenes: [], roads: [], quads: [], stars: [], routes: [], first: "Scene1", far: 1350000,
  };
  const session = { instanceFrom: () => null, clock: { now: 0 }, currentSetName: "test", frameRate: 2 } as never;
  const m = new MazeRuntime(sett, session);
  m.node = sett.nodes[0];
  const v5 = m.spriteCamera(W, H)!;
  return { x: 0, y: 0, z: 0, deg: 0, f: W / 2, cx: W / 2, cy: H / 2, clipW: W, clipH: H, v5 };
}

/** w×h, all opaque except the top-left pixel; index 1 down the left column, 2 elsewhere */
function sprite(w: number, h: number, posYraw = 0): ShpFrame {
  const indexed = new Uint8Array(w * h).map((_, i) => (i % w === 0 ? 1 : 2));
  const opaque = new Uint8Array(w * h).fill(1);
  opaque[0] = 0;
  return { width: w, height: h, posXraw: 0, posYraw, indexed, opaque };
}

function props() {
  const R = new PropRuntime();
  R.defaultAnchor = { x: 0, y: 0 };
  R.enginePointTests = false; // a v5 session's profile
  R.addShop("t.shp", readShpFile(buildShpBytes({
    palette: [0, 0, 0, 255, 0, 0, 0, 0, 255],
    groups: [
      // two views of a vane: front-on (degree 0) 4 wide, from behind (128) 6 wide
      { name: "vane", states: [{ identifier: "turn", frames: [{ art: sprite(4, 4), degree: 0 }, { art: sprite(6, 4), degree: 128 }] }] },
      { name: "sign", states: [{ identifier: "up", frames: [{ art: sprite(4, 4, 1) }] }] },
    ],
  })));
  return R;
}

const PAL = new Uint8ClampedArray(256 * 4);
PAL.set([255, 0, 0, 255], 4);
PAL.set([0, 0, 255, 255], 8);
const view = () => ({ rgba: new Uint8ClampedArray(W * H * 4), width: W, height: H, palette: PAL });
/** pixels painted red or blue */
const drawn = (rgba: Uint8ClampedArray) => rgba.reduce((n, v, i) => n + (i % 4 !== 3 && v ? 1 : 0), 0);

/** five units ahead at a scale that draws a frame pixel as ~3 screen pixels */
const AHEAD = { worldX: 500000, worldY: 0, worldZ: 0, scale: 50_000_000 };

test("a turned prop in a v5 room picks its frame by its facing from the camera", () => {
  const R = props();
  const cam = camera();
  const vane = R.get("vane")!;
  Object.assign(vane, { visible: true, worldSpace: true, directional: true, ...AHEAD });
  // facing along +x, away from the camera behind it: its back, 6 wide
  const [back] = R.boxesOf("vane", cam);
  vane.deg = 0x800000; // half round: facing the camera
  const [front] = R.boxesOf("vane", cam);
  expect([back.w, front.w]).toEqual([Math.round(6 * 3.2), Math.round(4 * 3.2)]);
  // the hot spot is the frame's top-left, on the projected point (the view's centre)
  expect([front.x, front.y]).toEqual([W / 2, H / 2]);
});

test("a v5 sprite mirrored top to bottom keeps its hot spot with the picture, and is hit through the mirror", () => {
  const R = props();
  const cam = camera();
  const sign = R.get("sign")!;
  Object.assign(sign, { visible: true, worldSpace: true, ...AHEAD });
  const [up] = R.boxesOf("sign", cam);
  // the hot spot one row down: the picture stands a row (3.2 px) above the point
  expect(up.y).toBe(H / 2 - 3);
  expect(R.covers(sign, up.x, up.y, cam), "the top-left pixel is transparent").toBe(false);
  sign.flip = 2;
  const [down] = R.boxesOf("sign", cam);
  // mirrored, the hot spot is three rows from the top: 4 − 1
  expect(down.y).toBe(H / 2 - Math.round(3 * 3.2));
  expect(R.covers(sign, down.x, down.y, cam)).toBe(true);
  expect(R.covers(sign, down.x, down.y + down.h - 1, cam), "the transparent pixel, now bottom-left").toBe(false);
});

test("with no camera a prop's boxes are its screen ones alone", () => {
  const R = props();
  const sign = R.get("sign")!;
  Object.assign(sign, { visible: true, worldSpace: true, ...AHEAD });
  expect(R.boxesOf("sign", null)).toEqual([]);
  Object.assign(sign, { worldSpace: false, anchorX: 5, anchorY: 6 });
  expect(R.boxesOf("sign", null)).toEqual([{ x: 5, y: 5, w: 4, h: 4 }]);
});

test("a true-3D prop is a card, painted in the view's palette with no scenery to hide it; one with no view, nothing", () => {
  const R = props();
  const cam = camera();
  const sign = R.get("sign")!;
  Object.assign(sign, { visible: true, worldSpace: true, true3d: true, facer: false, deg: 0x800000, pitch: 0, roll: 0, ...AHEAD });
  const [entry] = R.worldDrawList(cam);
  const v = view();
  R.compositeWorldOne(entry, v, cam);
  // the card stands square to the camera: the sprite's 4×4 at 3.2, less the transparent pixel
  const n = drawn(v.rgba);
  expect(n).toBeGreaterThan(13 * 13 - 3 * 3 * 2);
  expect(n).toBeLessThan(13 * 13);
  // through the view's palette (the frame has none of its own): index 2 is blue
  const at = (x: number, y: number) => Array.from(v.rgba.slice((y * W + x) * 4, (y * W + x) * 4 + 3));
  expect(at(26, 27)).toEqual([0, 0, 255]);
  // the same prop as a plain sprite, also with no scenery given
  const flat = view();
  sign.true3d = false;
  R.compositeWorldOne(entry, flat, cam);
  expect(drawn(flat.rgba)).toBeGreaterThan(0);
  // a view the shop has not: no card, no paint
  const none = view();
  Object.assign(sign, { true3d: true, stateName: "gone" });
  R.compositeWorldOne(entry, none, cam);
  expect(drawn(none.rgba)).toBe(0);
});

test("a card seen edge-on shows no pixel; a mirrored card turns half round and keeps a negative heading's sign", () => {
  const cam = camera();
  const pose = { worldX: 500000, worldY: 0, worldZ: 0, pitch: 0, roll: 0, facer: false, flip: 0, scale: 50_000_000 };
  const f = sprite(4, 4);
  // turned a quarter, its face is along the camera's line of sight
  const edge = cardOf(f, { ...pose, deg: 0x400000 }, cam, cam.v5!);
  expect(cardTexel(edge, cam.v5!, W / 2 - 0.5, H / 2 - 0.5)).toBeNull();
  // −0x900000 half round is −0x100000 (RedJack.exe masks the magnitude, not the value)
  const mirrored = cardOf(f, { ...pose, deg: -0x900000, flip: 1 }, cam, cam.v5!);
  const turned = cardOf(f, { ...pose, deg: -0x100000 }, cam, cam.v5!);
  expect(mirrored.n).toEqual(turned.n);
  expect(mirrored.r).toEqual(turned.r);
});

function actors() {
  const dirs = (f: ShpFrame | null) => Array.from({ length: 8 }, () => f);
  const R = new ActorRuntime();
  R.enginePointTests = false;
  R.addCast("t.cst", readCstFile(writeContainerFile(buildCstFile({
    palette: [0, 0, 0, 255, 0, 0, 0, 0, 255],
    members: [
      { name: "nick", poses: [{ name: "stand", steps: [dirs(sprite(4, 4, 1))] }, { name: "blank", steps: [dirs(sprite(4, 4))] }] },
    ],
  }).file)));
  const a = R.actors.get("nick")!;
  Object.assign(a, { visible: true, worldSpace: true, setName: "", ...AHEAD });
  return { R, a };
}

test("a true-3D actor is a card: on screen by its box, hit by its pixels; with no picture, not at all", () => {
  const { R, a } = actors();
  const cam = camera();
  Object.assign(a, { true3d: true, facer: true });
  expect(R.onScreen(a, cam)).toBe(true);
  const box = R.spriteBox(a, cam)!;
  expect(box.w).toBeGreaterThan(10);
  expect(box.covers(box.x + Math.floor(box.w / 2), box.y + Math.floor(box.h / 2))).toBe(true);
  expect(box.covers(box.x, box.y), "the transparent corner").toBe(false);
  // a play script that names a step the pose has not: no picture
  a.poseName = "blank";
  a.pose()!.play = [7];
  expect(R.card(a, cam)).toBeNull();
  expect(R.onScreen(a, cam)).toBe(false);
});

test("a v5 actor mirrored top to bottom hangs from the mirrored hot spot", () => {
  const { R, a } = actors();
  const cam = camera();
  const up = R.spriteBox(a, cam)!;
  expect(up.y).toBe(H / 2 - 3);
  a.flip = 2;
  const down = R.spriteBox(a, cam)!;
  expect(down.y).toBe(H / 2 - Math.round(3 * 3.2));
  expect(down.covers(down.x, down.y + down.h - 1), "the transparent pixel, now bottom-left").toBe(false);
});

test("a v5 pose with an empty play script that goes round stays on step 0 and tells no end", () => {
  const { R, a } = actors();
  const pose = a.pose()!;
  Object.assign(pose, { play: [], playsOnce: false });
  a.step = 3;
  expect(R.advanceAnimation(0)).toEqual([]);
  expect(R.advanceAnimation(10)).toEqual([]);
  expect(a.step).toBe(0);
});

test("a world actor with no picture is in the draw list but has no box and is hit nowhere", () => {
  const { R, a } = actors();
  const cam = camera();
  a.poseName = "blank";
  a.pose()!.play = [7];
  expect(R.drawList(cam).map((e) => e.a)).toEqual([a]);
  expect(R.spriteBox(a, cam)).toBeNull();
  expect(R.actorAt(W / 2 + 1, H / 2, cam)).toBeNull();
});
