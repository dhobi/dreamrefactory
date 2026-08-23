/**
 * Shop-editor format layer — the write/edit half of the DF library that
 * shops.html (site/editors/shp-editor.ts) is built on: the four SHP patches (shop name,
 * prop name, state identifier, frame degree), the frame-anchor patch, and the
 * transparent-codec art replacement.
 *
 * Self-contained: works on a SYNTHESIZED shop built to the layout documented in
 * engine/src/df/shp.ts, so it runs without gamefiles/ — the editor must round-trip
 * user-supplied files, and these are the invariants that make that safe (read →
 * write is structure-preserving, an edit changes exactly its own field, and an
 * edit to a REORDERED state's frame lands on the record that frame came from).
 */
import { test, expect } from "vitest";
import { DFContainerFile, readContainerFile, writeContainerFile } from "@dreamfactory/engine/df/container";
import {
  GROUP_NAME_FIELD,
  STATE_ID_FIELD,
  ShpFrame,
  decodeShpFrame,
  encodeShpFrame,
  patchFrameAnchor,
  patchFrameDegree,
  patchGroupName,
  patchShopRefName,
  patchStateIdentifier,
  readShpFile,
} from "@dreamfactory/engine/df/shp";
import { buildShpFile } from "@dreamfactory/engine/df/shp-build";
import { compileScript } from "@dreamfactory/engine/df/script-asm";

/** a test cut-out: a transparent border, flat runs, gradients, and a row that
 *  repeats the one above — one stretch per run mode of the transparent codec */
function testFrame(width: number, height: number, seed: number): ShpFrame {
  const indexed = new Uint8Array(width * height);
  const opaque = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x === 0 || (x + y * 2 + seed) % 13 === 0) continue; // transparent
      opaque[i] = 1;
      indexed[i] = y % 4 === 2 ? indexed[i - width] : (x >> 2) % 2 ? 180 : (x + y * seed) & 0xff;
    }
  }
  return { width, height, posYraw: 40 + seed, posXraw: 24 - seed, indexed, opaque };
}

// --- synthetic shop ---------------------------------------------------------

interface TestShop {
  file: DFContainerFile;
  bytes: Uint8Array;
  /** the art each frame container was built from, by container index */
  frames: Map<number, ShpFrame>;
}

/** the fixture's colour table, as RGB triples */
const TEST_PALETTE = ((): Uint8Array => {
  const p = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    p[i * 3] = i;
    p[i * 3 + 1] = (i * 5) & 0xff;
    p[i * 3 + 2] = 255 - i;
  }
  return p;
})();

/**
 * A miniature but structurally complete SHP, built by the library's own writer
 * ({@link buildShpFile}): two prop groups — a door with a settled pose, a forward
 * "open" animation and a "close" whose play-order table runs THE SAME frames
 * backwards, and a two-frame deg-indexed selector — plus a shop main script and a
 * type-0 gap container like the shipped files carry.
 *
 * The shared swing frames are the interesting part: passing the same art objects
 * to both states is how the builder is told they are one set of pictures, which is
 * what the file stores and what the editor has to keep straight.
 */
function buildTestShop(): TestShop {
  const art = (seed: number): ShpFrame => testFrame(12 + seed, 9 + seed, seed);
  const swing = [art(1), art(2), art(3)].map((a) => ({ art: a }));
  const shut = [{ art: art(4) }];
  const dark = [
    { art: art(5), degree: 0 },
    { art: art(6), degree: 1 },
  ];

  const { file, frameLocs } = buildShpFile({
    palette: TEST_PALETTE,
    refName: "house",
    gaps: 1,
    groups: [
      {
        name: "door",
        script: compileScript("code mousedown()\n\tpropstate(me, \"openclosed\")\nendcode"),
        states: [
          // the settled pose, then the swing forwards and the SAME frames backwards
          { identifier: "idleclosed", frames: shut },
          { identifier: "openclosed", frames: swing },
          { identifier: "closeclosed", frames: swing, order: [3, 2, 1] },
        ],
      },
      // a selector: distinct degrees, no usable play order — propdeg picks one
      { name: "life", states: [{ identifier: "dark", frames: dark, order: [0, 0] }] },
    ],
  });

  const frames = new Map<number, ShpFrame>();
  for (const [a, loc] of frameLocs) frames.set(loc, a);
  return { file, bytes: writeContainerFile(file), frames };
}

// --- the reader over written bytes ------------------------------------------

test("shp structure: the synthesized shop reads back as a shop", () => {
  const { bytes, frames } = buildTestShop();
  const shp = readShpFile(bytes);

  expect(shp.refName).toBe("house");
  expect(shp.groups.map((g) => g.name)).toEqual(["door", "life"]);

  const door = shp.groups[0];
  expect(door.states.map((s) => s.identifier)).toEqual([
    "idleclosed",
    "openclosed",
    "closeclosed",
  ]);
  // Both states hold the SAME three pictures in the same stored order — the file
  // shares the art — and "close" is told apart by its play SCRIPT, which steps
  // them backwards. Frames and records stay in stored order so an edit target
  // still names the slot it came from; direction lives in playOrder alone.
  const open = door.states[1];
  const close = door.states[2];
  expect(open.animated).toBe(true);
  expect(close.animated).toBe(true);
  expect(close.frames).toEqual(open.frames);
  expect(open.playOrder).toEqual([0, 1, 2]);
  expect(close.playOrder).toEqual([2, 1, 0]);
  expect(close.records).toEqual(open.records);
  expect(open.records).toEqual([118, 118 + 44, 118 + 88]);

  // distinct degrees and no usable order: a selector, left in stored order
  const dark = shp.groups[1].states[0];
  expect(dark.animated).toBe(false);
  expect(dark.playOrder, "a table naming frame 0 is not a play script").toBeNull();
  expect(dark.degrees).toEqual([0, 1]);
  expect(dark.refScales).toEqual([96, 96]);

  // the art decodes to what it was built from
  const art = decodeShpFrame(shp.file.containers[open.frames[0]].data);
  const built = frames.get(open.frames[0])!;
  expect(art.width).toBe(built.width);
  expect(art.opaque).toEqual(built.opaque);
  expect(art.posYraw).toBe(built.posYraw);
});

test("container writer: an untouched shop exports the bytes it read", () => {
  const { bytes } = buildTestShop();
  expect(writeContainerFile(readContainerFile(bytes))).toEqual(bytes);
  // and through the shop reader, which is the editor's export path
  expect(writeContainerFile(readShpFile(bytes).file)).toEqual(bytes);
});

// --- name edits -------------------------------------------------------------

test("name edits: each patches exactly one field and survives a round trip", () => {
  const { bytes } = buildTestShop();
  const shp = readShpFile(bytes);
  const before = readContainerFile(bytes);

  expect(patchShopRefName(shp, "housework")).toBe("housework");
  expect(patchGroupName(shp, 0, "hatch")).toBe("hatch");
  expect(patchStateIdentifier(shp, 0, 1, "openwide")).toBe("openwide");
  // a group that isn't there answers with the empty string rather than throwing
  expect(patchGroupName(shp, 99, "nope")).toBe("");
  expect(patchStateIdentifier(shp, 0, 99, "nope")).toBe("");

  const back = readShpFile(writeContainerFile(shp.file));
  expect(back.refName).toBe("housework");
  expect(back.groups[0].name).toBe("hatch");
  expect(back.groups[0].states.map((s) => s.identifier)).toEqual([
    "idleclosed",
    "openwide",
    "closeclosed",
  ]);
  expect(back.groups[1].name).toBe("life");

  // nothing else moved: only container 0 (the shop name) and the door's group
  // container (its name and one state identifier) differ
  const after = readContainerFile(writeContainerFile(shp.file));
  const groupLoc = shp.groups[0].location;
  for (let i = 1; i < before.containers.length; i++) {
    if (i === groupLoc) continue;
    expect(after.containers[i].data).toEqual(before.containers[i].data);
  }
  // in container 0, only the refName field changed
  expect(after.containers[0].data.subarray(0, 2344)).toEqual(
    before.containers[0].data.subarray(0, 2344),
  );
  expect(after.containers[0].data.subarray(2360)).toEqual(
    before.containers[0].data.subarray(2360),
  );
  // the palette window follows the copy-on-write of container 0
  expect(shp.paletteRaw).toEqual(after.containers[0].data.subarray(36, 36 + 2048));

  // clamping: a name longer than its field stores what fits, and says so
  const long = patchGroupName(back, 1, "l".repeat(60));
  expect(long).toBe("l".repeat(GROUP_NAME_FIELD));
  expect(readShpFile(writeContainerFile(back.file)).groups[1].name).toBe(long);
  expect(patchStateIdentifier(back, 1, 0, "d".repeat(30))).toBe("d".repeat(STATE_ID_FIELD));
});

// --- the frame records ------------------------------------------------------

test("degree edit: lands on the record the frame came from", () => {
  const { bytes } = buildTestShop();
  const shp = readShpFile(bytes);
  const close = shp.groups[0].states[2];
  const open = shp.groups[0].states[1];
  // Slot 0 of "close" is slot 0 of "open" — the two share the art and neither is
  // reordered; "close" only PLAYS it backwards (playOrder [2,1,0]). So an edit to
  // slot 0 reaches the first stored frame, and a degree belongs to the slot.
  expect(close.frames[0]).toBe(open.frames[0]);

  expect(patchFrameDegree(shp, 0, 2, 0, 200)).toBe(true);
  expect(close.degrees[0]).toBe(200);
  expect(patchFrameDegree(shp, 0, 2, 9, 1)).toBe(false); // no such frame

  const back = readShpFile(writeContainerFile(shp.file));
  const backClose = back.groups[0].states[2];
  const backOpen = back.groups[0].states[1];
  expect(backClose.degrees).toEqual([200, 0, 0]);
  // a degree belongs to a state's SLOT, not to the art: the same frame
  // container seen through the forward state keeps the degree it had there
  expect(backOpen.degrees).toEqual([0, 0, 0]);
  // clamped to an int16, and rounded
  patchFrameDegree(back, 1, 0, 1, 40000.6);
  expect(back.groups[1].states[0].degrees[1]).toBe(32767);
});

test("anchor edit: rewrites the frame header and nothing else", () => {
  const { bytes } = buildTestShop();
  const shp = readShpFile(bytes);
  const before = readContainerFile(bytes);
  const loc = shp.groups[0].states[0].frames[0];

  expect(patchFrameAnchor(shp.file, loc, 70, -12)).toBe(true);
  // the gap container has no frame header to rewrite
  const gap = shp.file.containers.findIndex((c) => c.gap);
  expect(patchFrameAnchor(shp.file, gap, 1, 1)).toBe(false);

  const back = readShpFile(writeContainerFile(shp.file));
  const f = decodeShpFrame(back.file.containers[loc].data);
  expect(f.posYraw).toBe(70);
  expect(f.posXraw).toBe(-12);
  // the pixels are the ones that were there: only the header's two shorts moved
  const old = decodeShpFrame(before.containers[loc].data);
  expect(f.opaque).toEqual(old.opaque);
  expect(back.file.containers[loc].data.subarray(8)).toEqual(
    before.containers[loc].data.subarray(8),
  );
  for (let i = 0; i < before.containers.length; i++) {
    if (i === loc) continue;
    expect(back.file.containers[i].data).toEqual(before.containers[i].data);
  }
});

test("art replacement: new art (new size) exports and reads back", () => {
  const { bytes } = buildTestShop();
  const shp = readShpFile(bytes);
  const state = shp.groups[1].states[0];
  const loc = state.frames[1];

  // the editor's import path: replace the container, keep the stored anchor
  const old = decodeShpFrame(shp.file.containers[loc].data);
  const art = testFrame(40, 30, 9);
  art.posYraw = old.posYraw;
  art.posXraw = old.posXraw;
  shp.file.containers[loc] = { id: shp.file.containers[loc].id, data: encodeShpFrame(art) };

  const back = readShpFile(writeContainerFile(shp.file));
  // the state table still points at the same container, with the new art in it
  expect(back.groups[1].states[0].frames[1]).toBe(loc);
  const got = decodeShpFrame(back.file.containers[loc].data);
  expect([got.width, got.height]).toEqual([40, 30]);
  expect(got.posYraw).toBe(old.posYraw);
  expect(got.opaque).toEqual(art.opaque);
  for (let i = 0; i < art.width * art.height; i++) {
    if (art.opaque[i]) expect(got.indexed[i]).toBe(art.indexed[i]);
  }
});
