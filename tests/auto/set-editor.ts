/**
 * Set-editor format layer — the write/edit half of the DF library that
 * sets.html (editors/set-editor.ts) is built on: the frame-codec encoder and the
 * seven SET patches (set name, default start, scene name, view name, hotspot
 * identifier, hotspot region, actor mark, road name).
 *
 * Self-contained: works on a SYNTHESIZED set built to the layout documented in
 * src/df/set.ts, so it runs without gamefiles/ — the editor must round-trip
 * user-supplied files, and these are the invariants that make that safe (read →
 * write is structure-preserving, an edit changes exactly its own field, and a
 * re-encoded frame decodes to the pixels it was given no matter what the frame
 * buffer held before it).
 */
import { test, expect } from "vitest";
import { DFContainerFile, readContainerFile, writeContainerFile } from "../../src/df/container";
import { FrameBuffer, decodeFrame, encodeFrame, encodeZLayer } from "../../src/df/image";
import { IN_MOTION, STANDPOINT, buildSetFile } from "../../src/df/set-build";
import { compileScript } from "../../src/df/script-asm";
import { sniffScript } from "../../src/df/script";
import { LEFTTURNS, RIGHTTURNS, SetFile, readSetFile, readStarPath, roadsAt, turnRing } from "../../src/df/set";
import {
  OBJECT_ID_FIELD,
  SET_NAME_FIELD,
  patchActor,
  patchDefaultStart,
  patchObjectIdentifier,
  patchObjectRegion,
  patchSceneName,
  patchSetName,
  patchTransitionName,
  patchViewName,
} from "../../src/df/set-patch";

// --- synthetic set ----------------------------------------------------------

const VIEW_W = 40;
const VIEW_H = 24;

/** a test image: gradients, flat stretches, and rows repeating the one above —
 *  one stretch per run mode of the codec */
function testImage(width: number, height: number, seed: number): Uint8Array {
  const px = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      px[i] =
        y % 4 === 2 && y > 0
          ? px[i - width] // a row that copies its predecessor
          : (x >> 3) % 2
            ? (40 + seed) & 0x7f // a flat stretch
            : (x * 3 + y * seed) & 0x7f; // a gradient
    }
  }
  return px;
}

/** per-pixel depth levels, in bands so the runs are worth encoding */
function testDepth(width: number, height: number, seed: number): Uint8Array {
  const z = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) z[y * width + x] = ((x >> 4) + y + seed) & 0x1f;
  }
  return z;
}

interface TestSet {
  file: DFContainerFile;
  bytes: Uint8Array;
  /** the pixels each frame container was built from, by container index */
  images: Map<number, Uint8Array>;
  /** the depth levels of the frames that got a Z layer */
  depths: Map<number, Uint8Array>;
  frameLocs: number[];
}

/** the fixture's colour table, as RGB triples */
const TEST_PALETTE = ((): Uint8Array => {
  const p = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    p[i * 3] = (i << 1) & 0xff;
    p[i * 3 + 1] = (i * 3) & 0xff;
    p[i * 3 + 2] = 255 - i;
  }
  return p;
})();

/**
 * A miniature but structurally complete SET, built by the library's own writer
 * ({@link buildSetFile}): two scenes (one with two views and hotspots on the
 * first, one with a single view), a road between them with frames both ways, an
 * actor record carrying a nested secondary star, the two deck-plan maps, a main
 * script, and a type-0 gap container like the shipped files have.
 *
 * The nine pictures are passed as objects, and a turn ring's standpoint frame is
 * given THE SAME object as the view it depicts — which is how the builder is told
 * they are one picture, and what the shipped files store.
 */
function buildTestSet(): TestSet {
  const art = (seed: number, withZ = false) => ({
    pixels: testImage(VIEW_W, VIEW_H, seed),
    depth: withZ ? testDepth(VIEW_W, VIEW_H, seed) : undefined,
  });
  // scene 0: two standpoints and the motion frames between them; scene 1: one;
  // the road: two frames each way
  const pics = [
    art(1, true), // scene 0 view 0 standpoint
    art(2), // in-motion
    art(3, true), // scene 0 view 1 standpoint
    art(4), // in-motion
    art(5, true), // scene 1 view 0 standpoint
    art(6), // road forwards
    art(7),
    art(8), // road back
    art(9),
  ];
  const maps = { light: art(10), dark: art(11), width: 128, height: 96 };

  const { file, artLocs } = buildSetFile({
    palette: TEST_PALETTE,
    name: "B59",
    viewWidth: VIEW_W,
    viewHeight: VIEW_H,
    dimensions: [4000, 3000],
    gaps: 1,
    maps,
    defaultScene: "bunkside",
    defaultView: "door",
    scenes: [
      {
        name: "bunkside",
        position: [1000, 2000, 300],
        mapPoint: [10, 20, 30],
        views: [
          {
            name: "door",
            rotation: 0,
            rot8: 0,
            id: 0,
            // the rectangles are stored Y-first; one hotspot has a script, one
            // is a bare region
            hotspots: [
              { id: "porthole", rotation8: 32, top: 40, left: 12, bottom: 90, right: 70, script: compileScript("code mousedown()\n\tcursor(\"look\")\nendcode") },
              { id: "bunk", top: 120, left: 200, bottom: 200, right: 380 },
            ],
          },
          { name: "window", rotation: Math.PI / 2, rot8: 64, id: 1 },
        ],
        // the ring alternates standpoint / in-motion, and wraps
        right: {
          destinationScene: 0,
          frames: [
            { art: pics[0], motion: STANDPOINT, viewID: 0, deg: 0 },
            { art: pics[1], motion: IN_MOTION, viewID: -1, deg: 32 },
            { art: pics[2], motion: STANDPOINT, viewID: 1, deg: 64 },
            { art: pics[3], motion: IN_MOTION, viewID: -1, deg: 96 },
          ],
        },
        left: {
          destinationScene: 0,
          frames: [
            { art: pics[2], motion: STANDPOINT, viewID: 1, deg: 64 },
            { art: pics[3], motion: IN_MOTION, viewID: -1, deg: 32 },
            { art: pics[0], motion: STANDPOINT, viewID: 0, deg: 0 },
            { art: pics[1], motion: IN_MOTION, viewID: -1, deg: 224 },
          ],
        },
      },
      {
        name: "corner",
        position: [1400, 2000, 300],
        mapPoint: [14, 20, 30],
        views: [{ name: "corner", rotation: Math.PI, rot8: 128, id: 2, height: 1.5 }],
        right: { destinationScene: 1, frames: [{ art: pics[4], motion: STANDPOINT, viewID: 0, deg: 128 }] },
        left: { destinationScene: 1, frames: [{ art: pics[4], motion: STANDPOINT, viewID: 0, deg: 128 }] },
      },
    ],
    roads: [
      {
        name: "to the corner",
        fromViewID: 1, // global view ids, not per-scene indices
        toViewID: 2,
        from: [1000, 2000, 300],
        to: [1400, 2000, 300],
        waypoints: [[1200, 2000, 300]],
        forward: {
          destinationScene: 1,
          frames: [
            { art: pics[5], motion: IN_MOTION, viewID: -1, deg: 0 },
            { art: pics[6], motion: IN_MOTION, viewID: -1, deg: 0 },
          ],
        },
        back: {
          destinationScene: 0,
          frames: [
            { art: pics[7], motion: IN_MOTION, viewID: -1, deg: 128 },
            { art: pics[8], motion: IN_MOTION, viewID: -1, deg: 128 },
          ],
        },
      },
    ],
    // one record: the primary star plus the nested secondary that scripts walk
    // it to (the tail the GPL reference skipped as junk)
    actors: [
      {
        name: "sasha.1",
        rotation8: 64,
        position: [7212, 10494, 251],
        secondary: { name: "sasha.2", rotation8: 96, position: [7300, 10600, 251] },
        // a route with one bend, so the pair is walked round a corner rather than
        // straight through it (#122)
        path: [[7212, 10494, 251], [7212, 10600, 251], [7300, 10600, 251]],
      },
    ],
  });

  const images = new Map<number, Uint8Array>();
  const depths = new Map<number, Uint8Array>();
  for (const [a, loc] of artLocs) {
    images.set(loc, a.pixels);
    if (a.depth) depths.set(loc, a.depth);
  }
  return { file, bytes: writeContainerFile(file), images, depths, frameLocs: pics.map((p) => artLocs.get(p)!) };
}

const load = (): { set: SetFile; built: TestSet } => {
  const built = buildTestSet();
  return { set: readSetFile(built.bytes), built };
};

/** decode a frame the way the editor does — into a buffer with junk in it, so
 *  anything that leans on a predecessor shows up as corruption */
function decodeAlone(data: Uint8Array): { pixels: Uint8Array; z: Uint8Array | null; width: number; height: number } {
  const fb = new FrameBuffer();
  fb.ensure(VIEW_W, VIEW_H);
  fb.pixels.fill(0x5a);
  fb.zPixels.fill(0x17);
  const d = decodeFrame(data, fb);
  const n = d.width * d.height;
  return {
    pixels: fb.pixels.slice(0, n),
    z: d.hasZ ? fb.zPixels.slice(0, n) : null,
    width: d.width,
    height: d.height,
  };
}

// --- the codec --------------------------------------------------------------

test("frame codec: encode→decode round-trips pixels, self-contained, Z and all", () => {
  const cases = [
    { w: VIEW_W, h: VIEW_H, seed: 1 },
    { w: 512, h: 3, seed: 7 }, // rows longer than the codec's 287-pixel run cap
    { w: 1, h: 5, seed: 2 },
    { w: 300, h: 300, seed: 5 },
  ];
  for (const c of cases) {
    const px = testImage(c.w, c.h, c.seed);
    const fb = new FrameBuffer();
    fb.ensure(c.w, c.h);
    fb.pixels.fill(0xa5); // poison: nothing may be inherited from a predecessor
    const encoded = encodeFrame(px, c.w, c.h);
    const d = decodeFrame(encoded, fb);
    expect(d.width).toBe(c.w);
    expect(d.height).toBe(c.h);
    expect(d.hasZ).toBe(false);
    expect(d.zOffset).toBe(-1);
    expect(fb.pixels.slice(0, c.w * c.h)).toEqual(px);
    // and the runs earn their keep: an image with flat stretches and repeated
    // rows must come out smaller than its raw pixels (a 1-pixel-wide frame is
    // all header, so only the real sizes are held to this)
    if (c.w >= 16) expect(encoded.length).toBeLessThan(c.w * c.h);
  }

  // a Z layer appended verbatim comes back as the depth image it was
  const px = testImage(VIEW_W, VIEW_H, 3);
  const z = testDepth(VIEW_W, VIEW_H, 3);
  const withZ = encodeFrame(px, VIEW_W, VIEW_H, encodeZLayer(z, VIEW_W, VIEW_H));
  const got = decodeAlone(withZ);
  expect(got.pixels).toEqual(px);
  expect(got.z).toEqual(z);

  // the degenerate frames of the loop
  expect(decodeFrame(encodeFrame(new Uint8Array(0), 0, 0), new FrameBuffer()).width).toBe(0);
  const one = encodeFrame(new Uint8Array([9]), 1, 1);
  const fb = new FrameBuffer();
  decodeFrame(one, fb);
  expect(fb.pixels[0]).toBe(9);
});

// --- reading the set --------------------------------------------------------

test("set structure: the synthesized file reads back as a set", () => {
  const { set, built } = load();

  expect(set.setName).toBe("B59");
  expect(set.defaultSceneName).toBe("bunkside");
  expect(set.defaultViewName).toBe("door");
  expect([set.viewPortWidth, set.viewPortHeight]).toEqual([VIEW_W, VIEW_H]);
  expect([set.zLevelCount, set.zFarMax]).toEqual([32, 4096]);
  expect([set.mapWidth, set.mapHeight]).toEqual([128, 96]);
  expect([set.setDimensionsX, set.setDimensionsY]).toEqual([4000, 3000]);
  expect(set.colorCount).toBe(128);

  expect(set.scenes.map((s) => s.sceneName)).toEqual(["bunkside", "corner"]);
  expect(set.scenes[0].views.map((v) => v.viewName)).toEqual(["door", "window"]);
  expect(set.scenes[0].views.map((v) => v.viewID)).toEqual([0, 1]);
  expect(set.scenes[0].views[1].cameraHeight).toBeCloseTo(1.75);
  expect(set.scenes[0].sceneLocation).toEqual([1000, 2000, 300]);

  // hotspot rectangles are stored Y-first and read back x-first
  const spots = set.scenes[0].views[0].objects;
  expect(spots.map((o) => o.identifier)).toEqual(["porthole", "bunk"]);
  expect(spots[0]).toMatchObject({
    startRegionX: 12,
    startRegionY: 40,
    endRegionX: 70,
    endRegionY: 90,
    rotation8: 32,
  });
  expect(spots[1].startRegionX).toBe(200);

  // the turn ring: a turn leaves a standpoint and lands on the next one
  expect(set.scenes[0].turns[RIGHTTURNS].frames.length).toBe(4);
  expect(set.scenes[0].turns[LEFTTURNS].frames.length).toBe(4);
  const turn = turnRing(set.scenes[0], 0, RIGHTTURNS)!;
  expect(turn.target).toBe(1);
  expect(turn.frames.map((f) => f.frameContainerLoc)).toEqual([
    built.frameLocs[1],
    built.frameLocs[2],
  ]);
  expect(turnRing(set.scenes[0], 0, RIGHTTURNS)!.frames[1].motionInfo).toBe(2);

  // the road, by global view id from either end
  expect(set.transitions.length).toBe(1);
  const road = set.transitions[0];
  expect(road.transitionName).toBe("to the corner");
  expect([road.viewIDstart, road.viewIDend]).toEqual([1, 2]);
  expect(road.waypoints).toEqual([[1200, 2000, 300]]);
  expect(roadsAt(set, 1)).toEqual([{ road, register: 0, arriveViewID: 2 }]);
  expect(roadsAt(set, 2)).toEqual([{ road, register: 1, arriveViewID: 1 }]);
  expect(road.frameRegisters[0].frames.length).toBe(2);

  // both stars of the one actor record, the nested secondary included
  expect(set.actors.map((a) => a.identifier)).toEqual(["sasha.1", "sasha.2"]);
  expect(set.actors[0]).toMatchObject({ positionX: 7212, positionZ: 10494, positionY: 251, rotation8: 64 });
  expect(set.actors[1]).toMatchObject({ positionX: 7300, positionZ: 10600, rotation8: 96 });
  // each identifier's field runs up to whatever follows it in the record
  expect([set.actors[0].idLimit, set.actors[1].idLimit]).toEqual([17, 15]);

  // ...and the route between the pair, which is a property of the RECORD rather
  // than of either star (#122). The leg lengths are written with TI.EXE's
  // truncating integer sqrt, so they are the file's own numbers and not a
  // re-measure: 106 and 88 here, and the header total is their sum.
  expect(set.starPaths).toEqual([{ a: "sasha.1", b: "sasha.2", container: set.starPaths[0].container }]);
  const route = readStarPath(set.file.containers, set.starPaths[0].container);
  expect(route).toEqual([
    { x: 7212, y: 251, z: 10494, fromPrev: 0 },
    { x: 7212, y: 251, z: 10600, fromPrev: 106 },
    { x: 7300, y: 251, z: 10600, fromPrev: 88 },
  ]);
  // the ends are the two stars, so only the middle is the detour
  expect([route[0].x, route[0].z]).toEqual([set.actors[0].positionX, set.actors[0].positionZ]);
  expect([route[2].x, route[2].z]).toEqual([set.actors[1].positionX, set.actors[1].positionZ]);

  // every frame decodes to the image it was built from, on its own
  for (const [loc, px] of built.images) {
    const got = decodeAlone(set.file.containers[loc].data);
    expect(got.pixels).toEqual(px);
    expect(got.z).toEqual(built.depths.get(loc) ?? null);
  }

  // stability: exporting an untouched load is the file it read
  expect(writeContainerFile(readContainerFile(built.bytes))).toEqual(built.bytes);
  expect(writeContainerFile(set.file)).toEqual(built.bytes);
});

// --- edits ------------------------------------------------------------------

/** every container but the ones named must come out byte-identical */
function expectOnlyTouched(before: DFContainerFile, after: DFContainerFile, touched: number[]): void {
  for (let i = 0; i < before.containers.length; i++) {
    if (touched.includes(i)) continue;
    expect(after.containers[i].data).toEqual(before.containers[i].data);
  }
}

test("names: set, scene, view and road renames patch their own field only", () => {
  const { set, built } = load();
  const before = readContainerFile(built.bytes);

  expect(patchSetName(set, "B59-ALT")).toBe("B59-ALT");
  expect(patchSceneName(set, 1, "far corner")).toBe("far corner");
  expect(patchViewName(set, 0, 1, "porthole")).toBe("porthole");
  expect(patchTransitionName(set, 0, "to the far end")).toBe("to the far end");

  const out = writeContainerFile(set.file);
  const back = readSetFile(out);
  expect(back.setName).toBe("B59-ALT");
  expect(back.scenes[1].sceneName).toBe("far corner");
  expect(back.scenes[0].views.map((v) => v.viewName)).toEqual(["door", "porthole"]);
  expect(back.transitions[0].transitionName).toBe("to the far end");
  // and the parsed set the editor keeps on screen agrees with the file
  expect(set.setName).toBe(back.setName);
  expect(set.scenes[1].sceneName).toBe(back.scenes[1].sceneName);
  expect(set.scenes[0].views[1].viewName).toBe(back.scenes[0].views[1].viewName);
  expect(set.transitions[0].transitionName).toBe(back.transitions[0].transitionName);

  // only the four containers that hold those names moved
  expectOnlyTouched(before, readContainerFile(out), [
    0,
    set.mainSceneRegister,
    set.scenes[0].locationViews,
    set.transitions[0].locationTransitionInfo,
  ]);
  // in container 0, only the name field
  const a = readContainerFile(out).containers[0].data;
  const b = before.containers[0].data;
  expect(a.subarray(0, 0x70)).toEqual(b.subarray(0, 0x70));
  expect(a.subarray(0x70 + 1 + SET_NAME_FIELD)).toEqual(b.subarray(0x70 + 1 + SET_NAME_FIELD));

  // clamped to the field, and a shorter name clears the characters it drops
  expect(patchSetName(set, "z".repeat(40))).toBe("z".repeat(SET_NAME_FIELD));
  expect(readSetFile(writeContainerFile(set.file)).setName).toBe("z".repeat(SET_NAME_FIELD));
  expect(patchSetName(set, "X")).toBe("X");
  expect(set.file.containers[0].data.subarray(0x72, 0x70 + 1 + SET_NAME_FIELD).some((x) => x)).toBe(false);
});

test("default start: the scene and facing a fresh load opens on", () => {
  const { set, built } = load();
  const before = readContainerFile(built.bytes);

  expect(patchDefaultStart(set, "corner", "corner")).toEqual({ scene: "corner", view: "corner" });
  const back = readSetFile(writeContainerFile(set.file));
  expect(back.defaultSceneName).toBe("corner");
  expect(back.defaultViewName).toBe("corner");
  // the names resolve to a real standpoint — what the viewer looks them up as
  expect(back.scenes.findIndex((s) => s.sceneName === back.defaultSceneName)).toBe(1);
  expectOnlyTouched(before, readContainerFile(writeContainerFile(set.file)), [0]);
});

test("hotspot: identifier and rectangle, written where the reader looks", () => {
  const { set, built } = load();
  const before = readContainerFile(built.bytes);
  const objectsLoc = set.scenes[0].views[0].locationObjects;

  expect(patchObjectIdentifier(set, 0, 0, 0, "port hole")).toBe("port hole");
  expect(patchObjectIdentifier(set, 0, 0, 1, "b".repeat(30))).toBe("b".repeat(OBJECT_ID_FIELD));
  expect(patchObjectRegion(set, 0, 0, 0, { startX: 5, startY: 6, endX: 105, endY: 66 })).toBe(true);
  // an out-of-range address is a no-op, not a stray write
  expect(patchObjectRegion(set, 0, 1, 0, { startX: 1, startY: 1, endX: 2, endY: 2 })).toBe(false);
  expect(patchObjectIdentifier(set, 9, 0, 0, "nope")).toBe("");

  const back = readSetFile(writeContainerFile(set.file));
  const spots = back.scenes[0].views[0].objects;
  expect(spots.map((o) => o.identifier)).toEqual(["port hole", "b".repeat(OBJECT_ID_FIELD)]);
  expect(spots[0]).toMatchObject({ startRegionX: 5, startRegionY: 6, endRegionX: 105, endRegionY: 66 });
  // the parsed entry the editor draws its overlay from tracks the bytes, under
  // the field names it reads them back as (x-first, not the stored y-first)
  expect(set.scenes[0].views[0].objects[0]).toMatchObject({
    identifier: "port hole",
    startRegionX: 5,
    startRegionY: 6,
    endRegionX: 105,
    endRegionY: 66,
  });
  // the other hotspot's rectangle and both script refs are untouched — the one
  // with a handler still points at its own script container, the bare region at 0
  expect(spots[1]).toMatchObject({ startRegionX: 200, startRegionY: 120, endRegionX: 380, endRegionY: 200 });
  expect(spots.map((o) => o.locationScript)).toEqual(
    set.scenes[0].views[0].objects.map((o) => o.locationScript),
  );
  expect(sniffScript(back.file.containers[spots[0].locationScript].data)).toBeTruthy();
  expect(spots[1].locationScript).toBe(0);
  expectOnlyTouched(before, readContainerFile(writeContainerFile(set.file)), [objectsLoc]);
});

test("actor mark: the star's name and where it stands", () => {
  const { set, built } = load();
  const before = readContainerFile(built.bytes);

  expect(patchActor(set, 0, { identifier: "sasha.a", positionX: 7000 })).toBe(true);
  // the nested secondary is a record of its own, with a shorter name field
  expect(patchActor(set, 1, { identifier: "s".repeat(20), positionY: 999, rotation8: 128 })).toBe(true);
  expect(patchActor(set, 9, { positionX: 1 })).toBe(false);

  const back = readSetFile(writeContainerFile(set.file));
  expect(set.actors[0]).toMatchObject({ identifier: "sasha.a", positionX: 7000 });
  expect(back.actors[0]).toMatchObject({ identifier: "sasha.a", positionX: 7000, positionZ: 10494 });
  expect(back.actors[1]).toMatchObject({
    identifier: "s".repeat(15),
    positionY: 999,
    rotation8: 128,
    positionX: 7300,
  });
  expectOnlyTouched(before, readContainerFile(writeContainerFile(set.file)), [set.actorRegister]);
});

test("frame replacement: new art in one frame, the rest of the set as it was", () => {
  const { set, built } = load();
  const before = readContainerFile(built.bytes);
  const loc = built.frameLocs[0];

  // the editor's import path: re-encode over the container, carrying the Z
  // layer of the frame being replaced (same size, so its runs still line up)
  const old = decodeAlone(before.containers[loc].data);
  const zBlock = before.containers[loc].data.subarray(
    decodeFrame(before.containers[loc].data, new FrameBuffer()).zOffset,
  );
  const art = testImage(VIEW_W, VIEW_H, 42);
  set.file.containers[loc] = { id: set.file.containers[loc].id, data: encodeFrame(art, VIEW_W, VIEW_H, zBlock) };

  const back = readSetFile(writeContainerFile(set.file));
  const got = decodeAlone(back.file.containers[loc].data);
  expect(got.pixels).toEqual(art);
  expect(got.pixels).not.toEqual(old.pixels);
  expect(got.z).toEqual(built.depths.get(loc)!); // the depth image came along
  // the frame is still the standpoint of view 0, and its ring still decodes
  expect(back.scenes[0].turns[RIGHTTURNS].frames[0].frameContainerLoc).toBe(loc);
  for (const fi of back.scenes[0].turns[RIGHTTURNS].frames) {
    const px = built.images.get(fi.frameContainerLoc);
    if (fi.frameContainerLoc === loc || !px) continue;
    expect(decodeAlone(back.file.containers[fi.frameContainerLoc].data).pixels).toEqual(px);
  }
  expectOnlyTouched(before, readContainerFile(writeContainerFile(set.file)), [loc]);

  // dropping the Z layer is what a differently-sized replacement does
  set.file.containers[loc] = {
    id: set.file.containers[loc].id,
    data: encodeFrame(testImage(20, 12, 3), 20, 12),
  };
  const noZ = decodeAlone(readSetFile(writeContainerFile(set.file)).file.containers[loc].data);
  expect([noZ.width, noZ.height]).toEqual([20, 12]);
  expect(noZ.z).toBe(null);
});
