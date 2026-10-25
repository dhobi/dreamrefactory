/**
 * The actor runtime's drawing, hit testing and stepping over a cast written by
 * the engine's own builder (engine/src/runtime/actors.ts): mirrored screen
 * actors clipped at the buffer's edge, the point tests both ways, the on-screen
 * gates, and DreamFactory 5's play-once poses.
 *
 *   npx vitest run engine/tests/actor-runtime.ts
 *
 * Needs no game data.
 */
import { expect, test } from "vitest";
import { buildCstFile } from "@dreamfactory/engine/df/cst-build";
import { readCstFile } from "@dreamfactory/engine/df/cst";
import { writeContainerFile } from "@dreamfactory/engine/df/container";
import type { ShpFrame } from "@dreamfactory/engine/df/shp";
import { ActorRuntime } from "@dreamfactory/engine/runtime/actors";
import type { WorldCamera } from "@dreamfactory/engine/runtime/geometry";
import { DrawSignature } from "@dreamfactory/engine/runtime/signature";

/**
 * A 3×2 sprite whose left column is index 1 and right columns index 2, with
 * the top-right pixel transparent: enough to tell a mirror from the original
 * and a transparent pixel from a drawn one.
 */
function sprite(): ShpFrame {
  const indexed = new Uint8Array([1, 2, 2, 1, 2, 2]);
  const opaque = new Uint8Array([1, 1, 0, 1, 1, 1]);
  return { width: 3, height: 2, posXraw: 0, posYraw: 0, indexed, opaque };
}

function runtime() {
  const dirs = (f: ShpFrame | null) => Array.from({ length: 8 }, () => f);
  const bytes = writeContainerFile(buildCstFile({
    palette: [0, 0, 0, 255, 0, 0, 0, 0, 255],
    members: [
      { name: "nick", poses: [{ name: "stand", steps: [dirs(sprite())], refScale: 0 }, { name: "two", steps: [dirs(sprite()), dirs(sprite())] }] },
      { name: "ghost", poses: [{ name: "stand", steps: [] }] },
    ],
  }).file);
  const R = new ActorRuntime();
  R.addCast("t.cst", readCstFile(bytes));
  return { R, bytes };
}

const PAL = new Uint8ClampedArray(256 * 4);
PAL.set([255, 0, 0, 255], 4);
PAL.set([0, 0, 255, 255], 8);

/** the buffer as palette indices: 0 untouched, 1 red, 2 blue */
const read = (rgba: Uint8ClampedArray) =>
  Array.from({ length: rgba.length / 4 }, (_, i) => {
    if (rgba[i * 4]) return 1;
    return rgba[i * 4 + 2] ? 2 : 0;
  });

const cam = (): WorldCamera => ({ x: 0, y: 0, z: 0, deg: 0, f: 310, cx: 2, cy: 2, clipW: 4, clipH: 4 });

test("a second cast with a member already playing leaves that actor as it was", () => {
  const { R, bytes } = runtime();
  const nick = R.actors.get("nick")!;
  nick.worldX = 77;
  R.addCast("u.cst", readCstFile(bytes));
  expect(R.actors.get("nick")).toBe(nick);
  expect(R.casts.size).toBe(2);
});

test("screen actors: drawn mirrored and clipped at every edge of the buffer", () => {
  const { R } = runtime();
  const a = R.actors.get("nick")!;
  Object.assign(a, { visible: true, worldSpace: false, anchorX: 0, anchorY: 0 });
  let out = new Uint8ClampedArray(4 * 4 * 4);
  R.compositeScreen(out, 4, 4, PAL);
  // the stored picture, the transparent pixel left as it was
  expect(read(out).slice(0, 8)).toEqual([1, 2, 0, 0, 1, 2, 2, 0]);
  // mirrored both ways, which moves the anchor to the far corner, and hanging
  // off the top-left of the buffer by one each way
  a.flip = 3;
  a.anchorX = 2;
  a.anchorY = 1;
  out = new Uint8ClampedArray(4 * 4 * 4);
  R.compositeScreen(out, 4, 4, PAL);
  expect(read(out).slice(0, 4)).toEqual([2, 1, 0, 0]);
  // off the bottom-right corner: only the one pixel inside
  a.flip = 0;
  a.anchorX = 3;
  a.anchorY = 3;
  out = new Uint8ClampedArray(4 * 4 * 4);
  R.compositeScreen(out, 4, 4, PAL);
  expect(read(out)).toEqual([...Array(15).fill(0), 1]);
});

test("screen actors: on screen only while some of them is, and hit only on an opaque pixel", () => {
  const { R } = runtime();
  const a = R.actors.get("nick")!;
  Object.assign(a, { worldSpace: false, anchorX: 0, anchorY: 0 });
  expect(R.onScreen(a, cam())).toBe(false); // not visible
  a.visible = true;
  expect(R.onScreen(a, cam())).toBe(true);
  a.anchorX = 4;
  expect(R.onScreen(a, cam())).toBe(false);
  a.anchorX = -3;
  expect(R.onScreen(a, cam())).toBe(false);
  a.anchorX = 0;
  a.setName = "hall";
  expect(R.onScreen(a, cam())).toBe(false); // another set's
  expect(R.screenDrawList()).toEqual([]);
  a.setName = "";
  // the engines' point test samples the column before, so the transparent
  // pixel is never what it reads
  expect(R.actorAt(2, 0)).toBe(a);
  expect(R.actorAt(3, 0)).toBeNull();
  // the port's own test reads the pixel itself
  R.enginePointTests = false;
  expect(R.actorAt(2, 0)).toBeNull();
  a.flip = 3;
  a.anchorX = 3;
  a.anchorY = 2;
  // mirrored, the transparent pixel is bottom-left
  expect(R.actorAt(0, 1)).toBeNull();
  expect(R.actorAt(2, 0)).toBe(a);
  expect(R.covers(a, 2, 0, null)).toBe(true);
  // snapped to the stage origin
  a.snap = true;
  R.origin = { x: 10, y: 10 };
  expect(R.spriteBox(a, null)).toMatchObject({ x: 10, y: 10, w: 3, h: 2 });
  expect(R.spriteBox(a, null)!.covers(12, 10)).toBe(true);
  // an actor not among the drawn: no box, with or without a camera
  const ghost = R.actors.get("ghost")!;
  expect(R.spriteBox(ghost, null)).toBeNull();
  expect(R.spriteBox(ghost, cam())).toBeNull();
  expect(R.covers(ghost, 0, 0, null)).toBe(false);
});

test("world actors: no scale or no picture is never on screen", () => {
  const { R } = runtime();
  const a = R.actors.get("nick")!;
  Object.assign(a, { visible: true, worldSpace: true, worldY: 500 });
  const c = { ...cam(), deg: 64 };
  expect(R.onScreen(a, c)).toBe(false); // scale 0
  a.scale = 1000;
  const ghost = R.actors.get("ghost")!;
  Object.assign(ghost, { visible: true, worldSpace: true, worldY: 500, scale: 1000 });
  expect(R.onScreen(ghost, c)).toBe(false); // a pose with no steps draws nothing
  expect(R.screenRect(ghost)).toBeNull();
  // the stand's stored refScale is 0, so the draw falls back to 96
  const pose = a.pose()!;
  expect(pose.steps[0][0].refScale).toBe(0);
  // drawn at the fallback scale (96 at depth 96: life size), seen, hit by the scaled point test, painted
  a.worldY = 96;
  expect(R.onScreen(a, c)).toBe(true);
  const box = R.spriteBox(a, c)!;
  expect([box.w, box.h]).toEqual([3, 2]);
  expect(box.covers(box.x, box.y + box.h - 1)).toBe(true);
  expect(R.actorAt(box.x, box.y + box.h - 1, c)).toBe(a);
  const out = new Uint8ClampedArray(4 * 4 * 4);
  R.composite(out, 4, 4, PAL, c);
  expect(read(out).some((v) => v !== 0)).toBe(true);
  // a pose that is not there is the member's first
  a.poseName = "nothing";
  expect(a.pose()!.name).toBe("stand");
});

test("a set's opening puts its world actors on their stars, and nothing more (DF.EXE 0x414e00, TI.EXE 0x410fa0)", () => {
  const { R } = runtime();
  const nick = R.actors.get("nick")!;
  const ghost = R.actors.get("ghost")!;
  R.currentSet = "town";
  Object.assign(nick, { setName: "town", starName: "town.well", worldSpace: true, deg: 9 });
  Object.assign(ghost, { setName: "town", starName: "town.well", worldSpace: false });
  const stars = [{ identifier: "Town.Well", positionX: 1, positionY: 2, positionZ: 3 }];
  expect(R.settleStars(stars)).toBe(1);
  expect([nick.worldX, nick.worldY, nick.worldZ]).toEqual([1, 3, 2]);
  expect(nick.deg, "the facing at +0x18 is kept").toBe(9);
  expect([ghost.worldX, ghost.worldY], "a screen actor (+0x12 = 0) is not").toEqual([0, 0]);
  nick.starName = "town.gone";
  nick.worldX = 50;
  expect(R.settleStars(stars), "a star the set does not have").toBe(0);
  nick.starName = "town.well";
  R.currentSet = "court";
  expect(R.settleStars(stars), "only the set just opened").toBe(0);
  expect(nick.worldX).toBe(50);
});

test("the draw signature changes with what is drawn, and skips the hidden", () => {
  const { R } = runtime();
  const sig = new DrawSignature();
  R.drawSignature(sig.reset());
  const hidden = [sig.lo, sig.hi];
  R.actors.get("nick")!.worldX = 5; // hidden: not part of the picture
  R.drawSignature(sig.reset());
  expect([sig.lo, sig.hi]).toEqual(hidden);
  R.actors.get("nick")!.visible = true;
  R.drawSignature(sig.reset());
  expect([sig.lo, sig.hi]).not.toEqual(hidden);
});

test("DreamFactory 5 poses: stepped by the clock, a play-once held at its end and told once", () => {
  const { R } = runtime();
  const a = R.actors.get("nick")!;
  a.poseName = "two";
  const pose = a.pose()!;
  // RedJack's own pose flags, set here as its cast reader would
  Object.assign(pose, { playsOnce: false, frameTicks: 0 });
  R.actors.delete("ghost");
  expect(R.advanceAnimation(100)).toEqual([]); // first pass: step 0, clock stamped
  expect(a.step).toBe(0);
  R.advanceAnimation(101); // no step time: one more a pass
  expect(a.step).toBe(1);
  R.advanceAnimation(102);
  expect(a.step).toBe(0); // round again, without a word
  // with a step time, the step is the clock's ticks since the stamp over it
  Object.assign(pose, { frameTicks: 10 });
  a.restartPose();
  R.advanceAnimation(200);
  R.advanceAnimation(215);
  expect(a.step).toBe(1);
  // play once: held on the last step, told once
  Object.assign(pose, { playsOnce: true });
  a.restartPose();
  R.advanceAnimation(300);
  expect(R.advanceAnimation(310)).toEqual(["nick"]);
  expect(R.advanceAnimation(320)).toEqual([]);
  expect(a.step).toBe(1);
  // a play-once pose with no frame time and no steps
  Object.assign(pose, { frameTicks: undefined });
  a.restartPose();
  R.advanceAnimation(400);
  expect(R.advanceAnimation(401)).toEqual(["nick"]);
});
