/**
 * Cast-editor format layer — the write/edit half of the DF library that
 * casts.html (editors/cst-editor.ts) is built on: the two CST patches (member name,
 * pose name), the shared frame-anchor patch over a cast sprite, and sprite-art
 * replacement.
 *
 * Self-contained: works on a SYNTHESIZED cast built to the layout documented in
 * src/df/cst.ts, so it runs without gamefiles/ — the editor must round-trip
 * user-supplied files, and these are the invariants that make that safe (read →
 * write is structure-preserving, an edit changes exactly its own field, and the
 * steps × 8 directions grouping survives the trip).
 */
import { test, expect } from "vitest";
import { DFContainerFile, readContainerFile, writeContainerFile } from "../../src/df/container";
import {
  MEMBER_NAME_FIELD,
  POSE_NAME_FIELD,
  patchMemberName,
  patchPoseName,
  readCstFile,
} from "../../src/df/cst";
import { ShpFrame, decodeShpFrame, encodeShpFrame, patchFrameAnchor } from "../../src/df/shp";
import { buildCstFile } from "../../src/df/cst-build";

/** a test sprite: a transparent border, flat runs, gradients, and a row that
 *  repeats the one above — one stretch per run mode of the transparent codec */
function testSprite(width: number, height: number, seed: number): ShpFrame {
  const indexed = new Uint8Array(width * height);
  const opaque = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x === 0 || (x + y * 3 + seed) % 12 === 0) continue; // transparent
      opaque[i] = 1;
      indexed[i] = y % 4 === 2 ? indexed[i - width] : (x >> 2) % 2 ? 90 : (x + y * seed) & 0xff;
    }
  }
  // a character's offset is measured from the sprite to their world point: the
  // feet, near the bottom middle
  return { width, height, posYraw: height - 2, posXraw: width >> 1, indexed, opaque };
}

// --- synthetic cast ---------------------------------------------------------

interface TestCast {
  file: DFContainerFile;
  bytes: Uint8Array;
  /** the art each sprite container was built from */
  sprites: Map<number, ShpFrame>;
}

/** the fixture's colour table, as RGB triples */
const TEST_PALETTE = ((): Uint8Array => {
  const p = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    p[i * 3] = i;
    p[i * 3 + 1] = (i * 9) & 0xff;
    p[i * 3 + 2] = 255 - i;
  }
  return p;
})();

/**
 * A miniature but structurally complete CST, built by the library's own writer
 * ({@link buildCstFile}): two members — one with a single standing step and a
 * two-step walk cycle, one with a stand whose 8 directions have a HOLE in them
 * (the shipped casts have those, and the runtime falls back rather than failing) —
 * each with a script, plus a type-0 gap container.
 */
function buildTestCast(): TestCast {
  const dirs = [0, 1, 2, 3, 4, 5, 6, 7];
  const step = (base: number, hole?: number): (ShpFrame | null)[] =>
    dirs.map((d) => (d === hole ? null : testSprite(10 + ((d + base) % 3), 24, d + base)));

  const { file, spriteLocs } = buildCstFile({
    palette: TEST_PALETTE,
    gaps: 1,
    members: [
      {
        name: "morrow",
        poses: [
          { name: "stand", steps: [step(1)] },
          { name: "walk", steps: [step(11), step(21)] },
        ],
      },
      // a stand with a hole: no sprite for direction 4 (the back)
      { name: "sasha", poses: [{ name: "stand", steps: [step(31, 4)] }] },
    ],
  });

  const sprites = new Map<number, ShpFrame>();
  for (const [art, loc] of spriteLocs) sprites.set(loc, art);
  return { file, bytes: writeContainerFile(file), sprites };
}

// --- the reader over written bytes ------------------------------------------

test("cst structure: the synthesized cast reads back as a cast", () => {
  const { bytes, sprites } = buildTestCast();
  const cst = readCstFile(bytes);

  expect(cst.members.map((m) => m.name)).toEqual(["morrow", "sasha"]);
  const morrow = cst.members[0];
  expect(morrow.poses.map((p) => p.name)).toEqual(["stand", "walk"]);
  expect(morrow.poses.map((p) => p.record)).toEqual([0x5e, 0x5e + 32]);
  expect(morrow.scriptLocation).toBeGreaterThan(0);

  // a stand is one step of 8 directions; a walk cycle is several
  const stand = morrow.poses[0];
  const walk = morrow.poses[1];
  expect(stand.steps.length).toBe(1);
  expect(stand.steps[0].length).toBe(8);
  expect(walk.steps.length).toBe(2);
  expect(walk.frameCount).toBe(16);
  // each slot knows its own direction, depicted angle and edit target
  expect(stand.steps[0][3]).toMatchObject({ direction: 3, angle: 96, refScale: 96 });
  expect(stand.steps[0].map((f) => f.record)).toEqual(
    [0, 1, 2, 3, 4, 5, 6, 7].map((i) => 0x76 + i * 44),
  );
  expect(walk.steps[1][0].record).toBe(0x76 + 8 * 44);

  // a hole stays a hole rather than shifting the directions along
  const holed = cst.members[1].poses[0];
  expect(holed.steps[0][4]?.location ?? 0).toBe(0);
  expect(holed.steps[0][5].location).toBeGreaterThan(0);

  // the art decodes to what it was built from
  const loc = stand.steps[0][0].location;
  const got = decodeShpFrame(cst.file.containers[loc].data);
  const built = sprites.get(loc)!;
  expect([got.width, got.height]).toEqual([built.width, built.height]);
  expect(got.opaque).toEqual(built.opaque);
  expect([got.posYraw, got.posXraw]).toEqual([built.posYraw, built.posXraw]);
});

test("container writer: an untouched cast exports the bytes it read", () => {
  const { bytes } = buildTestCast();
  expect(writeContainerFile(readContainerFile(bytes))).toEqual(bytes);
  expect(writeContainerFile(readCstFile(bytes).file)).toEqual(bytes);
});

// --- edits ------------------------------------------------------------------

test("name edits: member and pose patch one field each, in one container", () => {
  const { bytes } = buildTestCast();
  const cst = readCstFile(bytes);
  const before = readContainerFile(bytes);

  expect(patchMemberName(cst, 0, "morrowjr")).toBe("morrowjr");
  expect(patchPoseName(cst, 0, 1, "stroll")).toBe("stroll");
  expect(patchMemberName(cst, 9, "nope")).toBe(""); // no such member
  expect(patchPoseName(cst, 0, 9, "nope")).toBe("");

  const back = readCstFile(writeContainerFile(cst.file));
  expect(back.members.map((m) => m.name)).toEqual(["morrowjr", "sasha"]);
  expect(back.members[0].poses.map((p) => p.name)).toEqual(["stand", "stroll"]);
  // the pose still points at the same set container, with its frames intact
  expect(back.members[0].poses[1].steps.length).toBe(2);

  // both names live in the ONE logic container, so nothing else moved
  const logic = cst.members[0].logicLocation;
  const after = readContainerFile(writeContainerFile(cst.file));
  for (let i = 0; i < before.containers.length; i++) {
    if (i === logic) continue;
    expect(after.containers[i].data).toEqual(before.containers[i].data);
  }
  // and in it, not the script pointer or the pose count
  const a = after.containers[logic].data;
  const b = before.containers[logic].data;
  expect(a.subarray(0, 0x2a)).toEqual(b.subarray(0, 0x2a));
  expect(a.subarray(0x5a, 0x5e)).toEqual(b.subarray(0x5a, 0x5e));
  // the pose table's container pointer is untouched — only its name field
  expect(a.subarray(0x5e + 32, 0x5e + 32 + 16)).toEqual(b.subarray(0x5e + 32, 0x5e + 32 + 16));

  // the runtime matches poses lowercased, so the parsed name is lowered even
  // though the bytes keep what was typed
  patchPoseName(back, 1, 0, "StandBy");
  expect(back.members[1].poses[0].name).toBe("standby");
  expect(readCstFile(writeContainerFile(back.file)).members[1].poses[0].name).toBe("standby");

  // clamping: each name stores what fits its field
  expect(patchMemberName(back, 1, "s".repeat(60))).toBe("s".repeat(MEMBER_NAME_FIELD));
  expect(patchPoseName(back, 1, 0, "p".repeat(30))).toBe("p".repeat(POSE_NAME_FIELD));
});

test("anchor edit: moves one direction's sprite, not the pose's others", () => {
  const { bytes } = buildTestCast();
  const cst = readCstFile(bytes);
  const before = readContainerFile(bytes);
  const stand = cst.members[0].poses[0];
  const loc = stand.steps[0][2].location;

  // the editor's offset fields go through the shared SHP patch — a cast sprite
  // IS a SHP frame, header and all
  expect(patchFrameAnchor(cst.file, loc, 30, 6)).toBe(true);

  const back = readCstFile(writeContainerFile(cst.file));
  const moved = decodeShpFrame(back.file.containers[loc].data);
  expect([moved.posYraw, moved.posXraw]).toEqual([30, 6]);
  // its pixels, and every other direction of the same step, are untouched
  expect(moved.opaque).toEqual(decodeShpFrame(before.containers[loc].data).opaque);
  for (const f of stand.steps[0]) {
    if (!f.location || f.location === loc) continue;
    expect(back.file.containers[f.location].data).toEqual(before.containers[f.location].data);
  }
  // the pose's own container is untouched: the anchor is in the frame, not the record
  expect(back.file.containers[stand.location].data).toEqual(
    before.containers[stand.location].data,
  );
});

test("sprite replacement: new art (new size) exports and reads back", () => {
  const { bytes } = buildTestCast();
  const cst = readCstFile(bytes);
  const walk = cst.members[0].poses[1];
  const loc = walk.steps[1][5].location;

  // the editor's import path: replace the container, keep the stored anchor
  const old = decodeShpFrame(cst.file.containers[loc].data);
  const art = testSprite(22, 40, 7);
  art.posYraw = old.posYraw;
  art.posXraw = old.posXraw;
  cst.file.containers[loc] = { id: cst.file.containers[loc].id, data: encodeShpFrame(art) };

  const back = readCstFile(writeContainerFile(cst.file));
  // the same slot of the same step still points at it
  expect(back.members[0].poses[1].steps[1][5].location).toBe(loc);
  const got = decodeShpFrame(back.file.containers[loc].data);
  expect([got.width, got.height]).toEqual([22, 40]);
  expect([got.posYraw, got.posXraw]).toEqual([old.posYraw, old.posXraw]);
  expect(got.opaque).toEqual(art.opaque);
  for (let i = 0; i < art.width * art.height; i++) {
    if (art.opaque[i]) expect(got.indexed[i]).toBe(art.indexed[i]);
  }
});
