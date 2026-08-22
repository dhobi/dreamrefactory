/**
 * Stage-editor format layer — the write/edit half of the DF library that
 * stages.html (editors/stg-editor.ts) is built on: the three STG patches (flat name,
 * region name, region rectangle) and the flat-art replacement.
 *
 * Self-contained: works on a SYNTHESIZED stage built to the layout documented in
 * engine/src/df/stg.ts, so it runs without gamefiles/ — the editor must round-trip
 * user-supplied files, and these are the invariants that make that safe (read →
 * write is structure-preserving, an edit changes exactly its own field, and a
 * re-encoded flat decodes to the pixels it was given).
 */
import { test, expect } from "vitest";
import { DFContainerFile, readContainerFile, writeContainerFile } from "@dreamfactory/engine/df/container";
import { FrameBuffer, decodeFrame, encodeFrame } from "@dreamfactory/engine/df/image";
import {
  FLAT_NAME_FIELD,
  REGION_NAME_FIELD,
  patchFlatName,
  patchRegionName,
  patchRegionRect,
  readStgFile,
  readStgRegions,
} from "@dreamfactory/engine/df/stg";
import { buildStgFile } from "@dreamfactory/engine/df/stg-build";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { sniffScript } from "@dreamfactory/engine/df/script";

/** a test image: gradients, flat stretches, and rows repeating the one above —
 *  one stretch per run mode of the frame codec */
function testImage(width: number, height: number, seed: number): Uint8Array {
  const px = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      px[i] =
        y % 4 === 2 && y > 0
          ? px[i - width]
          : (x >> 3) % 2
            ? (60 + seed) & 0xff
            : (x * 3 + y * seed) & 0xff;
    }
  }
  return px;
}

// --- synthetic stage --------------------------------------------------------

interface TestStage {
  file: DFContainerFile;
  bytes: Uint8Array;
  /** the pixels each flat's art container was built from */
  images: Map<number, { pixels: Uint8Array; width: number; height: number }>;
}

const FLAT_W = 64;
const FLAT_H = 48;

/** the fixture's colour table: a ramp per channel, as RGB triples */
const TEST_PALETTE = ((): Uint8Array => {
  const p = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    p[i * 3] = i;
    p[i * 3 + 1] = (i * 7) & 0xff;
    p[i * 3 + 2] = 255 - i;
  }
  return p;
})();

/**
 * A miniature but structurally complete STG, built by the library's own writer
 * ({@link buildStgFile}): a main script, two flats — one with art, a script and
 * two clickable regions carrying compiled handlers, one with art and NO click
 * logic — and a type-0 gap container like the shipped files carry.
 *
 * Building the fixture with the shipped builder is deliberate: these tests are
 * the editor's contract, and the editor's job is to round-trip a stage. A
 * hand-written fixture only proved the edits worked on bytes the test itself
 * laid out.
 */
function buildTestStage(): TestStage {
  const art = (seed: number) => ({
    pixels: testImage(FLAT_W, FLAT_H, seed),
    width: FLAT_W,
    height: FLAT_H,
  });
  const art0 = art(1);
  const art1 = art(2);
  const button = (name: string): Uint8Array =>
    compileScript(`code mousedown()\n\tmessage("${name}")\nendcode`);

  const file = buildStgFile({
    palette: TEST_PALETTE,
    gaps: 1,
    flats: [
      {
        name: "mainflat",
        art: art0,
        script: compileScript("code openflat()\nendcode"),
        regions: [
          { name: "watch", top: 300, left: 20, bottom: 360, right: 90, script: button("watch") },
          { name: "menu", top: 300, left: 420, bottom: 360, right: 500, script: button("menu") },
        ],
      },
      // a flat nothing on it is clickable: no click-logic container at all
      { name: "deck1", condition: 3, art: art1 },
    ],
  });

  const bytes = writeContainerFile(file);
  const flats = readStgFile(bytes).flats;
  return {
    file,
    bytes,
    images: new Map([
      [flats[0].locationFrame, art0],
      [flats[1].locationFrame, art1],
    ]),
  };
}

const regionsOf = (stg: ReturnType<typeof readStgFile>, flatIdx: number) =>
  readStgRegions(stg.file.containers[stg.flats[flatIdx].locationClickLogic]?.data ?? new Uint8Array(0));

// --- the reader over written bytes ------------------------------------------

test("stg structure: the synthesized stage reads back as a stage", () => {
  const { bytes, images } = buildTestStage();
  const stg = readStgFile(bytes);

  expect(stg.flats.map((f) => f.name)).toEqual(["mainflat", "deck1"]);
  expect(stg.flats.map((f) => f.record)).toEqual([2124, 2124 + 46]);
  expect(stg.flats[1].condition).toBe(3);
  expect(stg.flats[0].width).toBe(FLAT_W);
  expect(stg.flats[0].height).toBe(FLAT_H);

  const regions = regionsOf(stg, 0);
  expect(regions.map((r) => r.name)).toEqual(["watch", "menu"]);
  expect(regions.map((r) => r.record)).toEqual([1032, 1064]);
  // the rect is stored Y-first, and comes back under the named edges
  expect(regions[0]).toMatchObject({ top: 300, left: 20, bottom: 360, right: 90 });
  // the region's script pointer resolves to a container that really holds one
  expect(sniffScript(stg.file.containers[regions[0].script].data)).toBeTruthy();
  // a flat with no click logic is not clickable, and asking is not an error
  expect(regionsOf(stg, 1)).toEqual([]);

  // the art decodes to the pixels it was built from
  const loc = stg.flats[0].locationFrame;
  const fb = new FrameBuffer();
  const d = decodeFrame(stg.file.containers[loc].data, fb);
  expect([d.width, d.height]).toEqual([FLAT_W, FLAT_H]);
  expect(fb.pixels.subarray(0, FLAT_W * FLAT_H)).toEqual(images.get(loc)!.pixels);
});

test("container writer: an untouched stage exports the bytes it read", () => {
  const { bytes } = buildTestStage();
  expect(writeContainerFile(readContainerFile(bytes))).toEqual(bytes);
  expect(writeContainerFile(readStgFile(bytes).file)).toEqual(bytes);
});

// --- edits ------------------------------------------------------------------

test("flat name edit: patches exactly one field and survives a round trip", () => {
  const { bytes } = buildTestStage();
  const stg = readStgFile(bytes);
  const before = readContainerFile(bytes);

  expect(patchFlatName(stg, 1, "deck7")).toBe("deck7");
  expect(patchFlatName(stg, 9, "nope")).toBe(""); // no such flat

  const back = readStgFile(writeContainerFile(stg.file));
  expect(back.flats.map((f) => f.name)).toEqual(["mainflat", "deck7"]);

  // only container 0 changed, and in it only the second flat's name field
  const after = readContainerFile(writeContainerFile(stg.file));
  for (let i = 1; i < before.containers.length; i++) {
    expect(after.containers[i].data).toEqual(before.containers[i].data);
  }
  const nameAt = 2124 + 46 + 30;
  expect(after.containers[0].data.subarray(0, nameAt)).toEqual(
    before.containers[0].data.subarray(0, nameAt),
  );
  // the palette window follows the copy-on-write of container 0
  expect(stg.paletteRaw).toEqual(after.containers[0].data.subarray(56, 56 + 2048));

  // clamping: a name longer than its field stores what fits
  expect(patchFlatName(back, 0, "m".repeat(40))).toBe("m".repeat(FLAT_NAME_FIELD));
});

test("region edits: name and rectangle move only their own record", () => {
  const { bytes } = buildTestStage();
  const stg = readStgFile(bytes);
  const before = readContainerFile(bytes);
  const flat = stg.flats[0];
  const regions = regionsOf(stg, 0);

  expect(patchRegionName(stg, flat, regions[0], "pocketwatch")).toBe("pocketwatch");
  expect(patchRegionRect(stg, flat, regions[1], { top: 8, left: 12, bottom: 40, right: 60 })).toBe(
    true,
  );
  // the parsed region is updated with the bytes — it is what the overlay draws
  expect(regions[1]).toMatchObject({ top: 8, left: 12, bottom: 40, right: 60 });

  const back = readStgFile(writeContainerFile(stg.file));
  const backRegions = regionsOf(back, 0);
  expect(backRegions.map((r) => r.name)).toEqual(["pocketwatch", "menu"]);
  expect(backRegions[1]).toMatchObject({ top: 8, left: 12, bottom: 40, right: 60 });
  // the untouched region kept its rectangle, and both still point at their own
  // handler container (each button's script is its own, as in the shipped stages)
  expect(backRegions[0]).toMatchObject({ top: 300, left: 20, bottom: 360, right: 90 });
  expect(backRegions.map((r) => r.script)).toEqual(regions.map((r) => r.script));
  expect(new Set(backRegions.map((r) => r.script)).size).toBe(2);

  // nothing outside the click-logic container moved
  const after = readContainerFile(writeContainerFile(stg.file));
  for (let i = 0; i < before.containers.length; i++) {
    if (i === flat.locationClickLogic) continue;
    expect(after.containers[i].data).toEqual(before.containers[i].data);
  }
  // and inside it, not the 1028-byte header
  expect(after.containers[flat.locationClickLogic].data.subarray(0, 1032)).toEqual(
    before.containers[flat.locationClickLogic].data.subarray(0, 1032),
  );

  // clamping: the name field, and int16 for the edges
  expect(patchRegionName(back, back.flats[0], backRegions[1], "b".repeat(30))).toBe(
    "b".repeat(REGION_NAME_FIELD),
  );
  patchRegionRect(back, back.flats[0], backRegions[1], {
    top: 40000,
    left: 0.6,
    bottom: 1,
    right: 2,
  });
  expect(backRegions[1]).toMatchObject({ top: 32767, left: 1 });
});

test("flat art replacement: new art exports and reads back", () => {
  const { bytes } = buildTestStage();
  const stg = readStgFile(bytes);
  const before = readContainerFile(bytes);
  const loc = stg.flats[0].locationFrame;

  // the editor's import path: re-encode the picture into the same container
  const px = testImage(FLAT_W, FLAT_H, 5);
  stg.file.containers[loc] = { id: stg.file.containers[loc].id, data: encodeFrame(px, FLAT_W, FLAT_H) };

  const back = readStgFile(writeContainerFile(stg.file));
  expect(back.flats[0].locationFrame).toBe(loc);
  // decoded into a buffer another flat left dirty, a re-encode still stands
  // alone: the codec's rows are all self-contained (see encodeFrame)
  const fb = new FrameBuffer();
  decodeFrame(before.containers[stg.flats[1].locationFrame].data, fb);
  const d = decodeFrame(back.file.containers[loc].data, fb);
  expect([d.width, d.height]).toEqual([FLAT_W, FLAT_H]);
  expect(fb.pixels.subarray(0, FLAT_W * FLAT_H)).toEqual(px);
  // the other flat's art is untouched
  expect(back.file.containers[stg.flats[1].locationFrame].data).toEqual(
    before.containers[stg.flats[1].locationFrame].data,
  );
});
