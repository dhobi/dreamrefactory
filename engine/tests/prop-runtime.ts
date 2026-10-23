/**
 * The prop runtime over a shop written by the engine's own builder
 * (engine/src/runtime/props.ts): play orders composed with degree variants, the
 * shop table's bookkeeping, the frame stepper's play-once and held cases,
 * mirrored drawing and hit tests on the screen and in the world.
 *
 *   npx vitest run engine/tests/prop-runtime.ts
 *
 * Needs no game data.
 */
import { expect, test } from "vitest";
import { buildShpBytes } from "@dreamfactory/engine/df/shp-build";
import { readShpFile, type ShpFrame } from "@dreamfactory/engine/df/shp";
import type { WorldCamera } from "@dreamfactory/engine/runtime/geometry";
import { PropRuntime, frameIndexForDegree, playSequence } from "@dreamfactory/engine/runtime/props";
import { DrawSignature } from "@dreamfactory/engine/runtime/signature";

/** 3×2: index 1 on the left column, 2 on the others, the top-right pixel transparent */
const sprite = (): ShpFrame => ({
  width: 3, height: 2, posXraw: 0, posYraw: 0,
  indexed: new Uint8Array([1, 2, 2, 1, 2, 2]),
  opaque: new Uint8Array([1, 1, 0, 1, 1, 1]),
});

function shop() {
  const R = new PropRuntime();
  R.defaultAnchor = { x: 0, y: 0 };
  R.addShop("t.shp", readShpFile(buildShpBytes({
    palette: [0, 0, 0, 255, 0, 0, 0, 0, 255],
    groups: [
      { name: "lamp", states: [
        { identifier: "two", frames: [{ art: sprite() }, { art: sprite() }] },
        { identifier: "one", frames: [{ art: sprite() }] },
      ] },
      { name: "chair", states: [{ identifier: "still", frames: [{ art: sprite() }] }] },
    ],
  })));
  return R;
}

const PAL = new Uint8ClampedArray(256 * 4);
PAL.set([255, 0, 0, 255], 4);
PAL.set([0, 0, 255, 255], 8);
const read = (rgba: Uint8ClampedArray) =>
  Array.from({ length: rgba.length / 4 }, (_, i) => {
    if (rgba[i * 4]) return 1;
    return rgba[i * 4 + 2] ? 2 : 0;
  });
const cam = (): WorldCamera => ({ x: 0, y: 0, z: 0, deg: 64, f: 310, cx: 2, cy: 2, clipW: 4, clipH: 4 });

test("a play order is read by group, then by position in the variant, then as it stands", () => {
  const st = (playOrder: number[] | undefined, groups?: number[]) => ({ playOrder, groups }) as never;
  // no script: the variant; no variant: the script
  expect(playSequence(st(undefined), [3, 4])).toEqual([3, 4]);
  expect(playSequence(st([1, 0]), null)).toEqual([1, 0]);
  // by group: the variant's frame whose group is the step
  expect(playSequence(st([6, 5], [0, 0, 0, 5, 6]), [3, 4])).toEqual([4, 3]);
  // no groups: a step is a position in the variant
  expect(playSequence(st([1, 0]), [3, 4])).toEqual([4, 3]);
  // past the variant but naming its frames: used as it stands
  expect(playSequence(st([4, 3]), [3, 4])).toEqual([4, 3]);
  // neither: the variant
  expect(playSequence(st([9]), [3, 4])).toEqual([3, 4]);
  // a state with no stored degrees selects its first frame
  expect(frameIndexForDegree({ degrees: [] } as never, 100)).toBe(0);
  expect(frameIndexForDegree({} as never, 100)).toBe(0);
});

test("the shop table: removing a shop that is not open, reordering with repeats and strangers, instancing nothing", () => {
  const R = shop();
  R.removeShop("other.shp");
  expect(R.shops.size).toBe(1);
  R.reorder(["chair", "nobody", "CHAIR"]);
  expect([...R.props.keys()]).toEqual(["chair", "lamp"]);
  R.instance("nobody", "copy");
  expect(R.get("copy")).toBeNull();
  R.instance("lamp", "chair"); // the destination is a prop already
  expect(R.get("chair")!.group.name).toBe("chair");
  // a star that is not in the set leaves the prop waiting
  const lamp = R.get("lamp")!;
  Object.assign(lamp, { starPending: true, starName: "town.well", setName: "" });
  expect(R.settleStars([])).toBe(0);
  expect(lamp.starPending).toBe(true);
  R.removeShop("T.SHP");
  expect(R.props.size).toBe(0);
});

test("a state that is not there draws nothing and is hit nowhere", () => {
  const R = shop();
  const lamp = R.get("lamp")!;
  lamp.visible = true;
  lamp.stateName = "gone";
  expect(lamp.state()).toBeNull();
  expect(lamp.screenRect()).toBeNull();
  expect(R.covers(lamp, 0, 0, null)).toBe(false);
});

test("screen props: drawn mirrored and clipped, hit through the mirror", () => {
  const R = shop();
  const lamp = R.get("lamp")!;
  Object.assign(lamp, { visible: true, flip: 3, anchorX: 2, anchorY: 1 });
  // the hot spot mirrors with the picture: the corner is one off the top-left
  expect(lamp.screenRect()).toEqual({ x: -1, y: -1, w: 3, h: 2 });
  const out = new Uint8ClampedArray(4 * 4 * 4);
  R.composite(out, 4, 4, PAL);
  expect(read(out).slice(0, 4)).toEqual([2, 1, 0, 0]);
  // the port's own point test reads the mirrored pixel
  R.enginePointTests = false;
  Object.assign(lamp, { anchorX: 3, anchorY: 2 });
  expect(R.covers(lamp, 0, 1, null)).toBe(false); // the transparent one, mirrored
  expect(R.covers(lamp, 2, 0, null)).toBe(true);
  expect(R.covers(lamp, 5, 5, null)).toBe(false);
});

test("world props: hit only with a camera that draws them, by the scaled point test", () => {
  const R = shop();
  const chair = R.get("chair")!;
  Object.assign(chair, { visible: true, worldSpace: true, worldY: 96, scale: 1000 });
  expect(R.covers(chair, 2, 2, null)).toBe(false);
  const c = cam();
  const [box] = R.boxesOf("chair", c);
  expect([box.w, box.h]).toEqual([3, 2]);
  expect(R.covers(chair, box.x, box.y + 1, c)).toBe(true);
  chair.setName = "elsewhere";
  expect(R.covers(chair, box.x, box.y + 1, c)).toBe(false);
});

test("the draw signature follows a play order, and leaves a screen prop's world fields out", () => {
  const R = shop();
  const lamp = R.get("lamp")!;
  lamp.visible = true;
  const sig = new DrawSignature();
  R.drawSignature(sig.reset());
  const plain = [sig.lo, sig.hi];
  lamp.worldX = 50; // a screen prop: not part of its picture
  R.drawSignature(sig.reset());
  expect([sig.lo, sig.hi]).toEqual(plain);
  lamp.frameOrder = [1, 0];
  R.drawSignature(sig.reset());
  const ordered = [sig.lo, sig.hi];
  expect(ordered).not.toEqual(plain);
  // in the world, its place is
  lamp.worldSpace = true;
  R.drawSignature(sig.reset());
  const world = [sig.lo, sig.hi];
  lamp.worldX = 51;
  R.drawSignature(sig.reset());
  expect([sig.lo, sig.hi]).not.toEqual(world);
});

test("stepping: a held last frame, a single frame, and DreamFactory 5's play-once views", () => {
  const R = shop();
  const lamp = R.get("lamp")!;
  // a state that is not there stops the animation
  Object.assign(lamp, { visible: true, animating: true, stateName: "gone" });
  R.tick(0, 10);
  expect(lamp.animating).toBe(false);
  Object.assign(lamp, { visible: true, animating: true, stateName: "one" });
  // one frame: nothing to step, so it stops
  expect(R.tick(0, 10)).toEqual([]);
  expect(lamp.animating).toBe(false);

  // DreamFactory 5: one frame and play-once ends at once, and says so
  const one = lamp.state()!;
  Object.assign(one, { playsOnce: true });
  Object.assign(lamp, { animating: true, lastTick: 0 });
  expect(R.tick(5, 10)).toEqual(["lamp"]);
  expect(lamp.animating).toBe(false);
  // ...and without play-once it stops quietly
  Object.assign(one, { playsOnce: false });
  Object.assign(lamp, { animating: true, lastTick: 0 });
  expect(R.tick(5, 10)).toEqual([]);

  // two frames, no step time: a frame a step once the frame time is up
  Object.assign(lamp, { stateName: "two", animating: true, lastTick: 0, frameIdx: 0 });
  const two = lamp.state()!;
  Object.assign(two, { playsOnce: false });
  R.tick(100, 10);
  R.tick(105, 10); // too soon
  expect(lamp.frameIdx).toBe(0);
  R.tick(110, 10);
  expect(lamp.frameIdx).toBe(1);
  R.tick(120, 10);
  expect(lamp.frameIdx).toBe(0); // round again
  // with a step time, the clock's ticks over it; play-once holds the last frame
  Object.assign(two, { playsOnce: true, frameTicks: 6 });
  Object.assign(lamp, { animating: true, lastTick: 0, frameIdx: 0 });
  R.tick(200, 10, false, false, null, 0);
  expect(R.tick(210, 10, false, false, null, 6)).toEqual(["lamp"]);
  expect([lamp.frameIdx, lamp.animating]).toEqual([1, false]);
});
