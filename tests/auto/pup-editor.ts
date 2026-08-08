/**
 * Puppet-editor format layer — the write/edit half of the DF library that
 * editors/puppets.html (editors/puppet-editor.ts) is built on: the container-file writer,
 * the transparent-codec frame encoder, and the dialogue-text patch.
 *
 * Self-contained: works on a SYNTHESIZED puppet file built to the layout
 * documented in src/df/pup.ts, so it runs without gamefiles/ — the editor
 * must round-trip user-supplied files, and these are the invariants that
 * make that safe (read → write is structure-preserving, write → read → write
 * is byte-identical, an edit changes exactly its own field).
 */
import { test, expect } from "vitest";
import { DFContainerFile, readContainerFile, writeContainerFile } from "../../src/df/container";
import { decodeShpFrame, encodeShpFrame, patchFrameAnchor, ShpFrame } from "../../src/df/shp";
import { patchDialogueText, readAnimLogic, readPupFile } from "../../src/df/pup";
import { buildPupFile } from "../../src/df/pup-build";

// --- synthetic puppet file --------------------------------------------------

/** a small test image: gradient rows, a transparent hole, flat runs, and a
 *  row identical to its predecessor — one stretch per codec run mode */
function testFrame(width: number, height: number, seed: number): ShpFrame {
  const indexed = new Uint8Array(width * height);
  const opaque = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      // a transparent diagonal band, plus a fully transparent border column
      if (x === 0 || (x + y * 2 + seed) % 11 === 0) continue;
      opaque[i] = 1;
      // flat stretches (repeat runs) alternating with gradients (literals);
      // even rows copy the row above where the pattern coincides
      indexed[i] = y % 4 === 2 ? indexed[i - width] : (x >> 3) % 2 ? 200 : (x + y * seed) & 0xff;
    }
  }
  return { width, height, posYraw: 132 - (seed % 5), posXraw: 256 - seed, indexed, opaque };
}

interface TestPup {
  file: DFContainerFile;
  bytes: Uint8Array;
  frames: ShpFrame[];
  frameLocs: number[];
}

/** the fixture's colour table, as RGB triples */
const TEST_PALETTE = ((): Uint8Array => {
  const p = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    p[i * 3] = i;
    p[i * 3 + 1] = (i * 3) & 0xff;
    p[i * 3 + 2] = 255 - i;
  }
  return p;
})();

/**
 * A miniature but structurally complete PUP, built by the library's own writer
 * ({@link buildPupFile}): 2 dialogue lines, a boot script, one stance with art on
 * 3 of the 11 layers, animLogic moving the jaw for line 1, and one type-0 gap
 * container (shipped puppets carry them).
 *
 * Built rather than hand-laid on purpose: these tests are the editor's contract,
 * and the editor's job is to round-trip a puppet. A fixture the test laid out
 * itself only proved the edits worked on bytes the test chose.
 */
function buildTestPup(): TestPup {
  const frames = [testFrame(48, 40, 1), testFrame(20, 16, 2), testFrame(12, 9, 3), testFrame(12, 9, 4)];
  const [background, head, jaw0, jaw1] = frames;
  const { file, frameLocs } = buildPupFile({
    palette: TEST_PALETTE,
    gaps: 1,
    stances: [{ layers: { background: [background], head: [head], jaw: [jaw0, jaw1] } }],
    dialogue: [
      {
        ident: "test1.001",
        text: "Good evening.",
        // two ticks: the jaw moves between its frames, the rest holds, and the
        // layers this stance has no art for stay hidden
        anim: [0, 1].map((tick) => ({
          layers: { background: { frame: 0 }, head: { frame: 0 }, jaw: { frame: tick } },
        })),
      },
      { ident: "test1.002", text: "A pleasure, as always." },
    ],
  });
  const locs = frameLocs[0];
  return {
    file,
    bytes: writeContainerFile(file),
    frames,
    frameLocs: [locs.background![0], locs.head![0], ...locs.jaw!],
  };
}

// --- the codec --------------------------------------------------------------

test("shp codec: encode→decode round-trips pixels, mask, and anchor", () => {
  // sizes that exercise run-length 63 chunking, single-pixel rows, and the
  // prev-row copy mode; plus the degenerate empty frame
  const cases = [testFrame(48, 40, 1), testFrame(200, 3, 7), testFrame(1, 5, 2), testFrame(130, 130, 5)];
  for (const f of cases) {
    const decoded = decodeShpFrame(encodeShpFrame(f));
    expect(decoded.width).toBe(f.width);
    expect(decoded.height).toBe(f.height);
    expect(decoded.posYraw).toBe(f.posYraw);
    expect(decoded.posXraw).toBe(f.posXraw);
    expect(decoded.opaque).toEqual(f.opaque);
    for (let i = 0; i < f.width * f.height; i++) {
      // transparent pixels carry no colour; compare only where opaque
      if (f.opaque[i]) expect(decoded.indexed[i]).toBe(f.indexed[i]);
    }
  }
  const empty = decodeShpFrame(
    encodeShpFrame({ width: 0, height: 0, posYraw: 0, posXraw: 0, indexed: new Uint8Array(0), opaque: new Uint8Array(0) }),
  );
  expect(empty.width).toBe(0);
});

// --- the container writer ---------------------------------------------------

test("container writer: read(write(file)) preserves ids, data, and gaps", () => {
  const { file, bytes } = buildTestPup();
  const back = readContainerFile(bytes);
  expect(back.header.containerCount).toBe(file.containers.length);
  expect(back.header.fileSize).toBe(bytes.length);
  expect(back.header.type).toBe(0);
  expect(back.containers.length).toBe(file.containers.length);
  for (let i = 0; i < file.containers.length; i++) {
    expect(back.containers[i].gap ?? false).toBe(file.containers[i].gap ?? false);
    if (!file.containers[i].gap) {
      expect(back.containers[i].id).toBe(file.containers[i].id);
      expect(back.containers[i].data).toEqual(file.containers[i].data);
    }
  }
  // stability: a second write of the re-read file is byte-identical — the
  // editor's export of an UNTOUCHED upload is the same file it would write
  // after a no-op edit session
  expect(writeContainerFile(back)).toEqual(bytes);
});

// --- the pup reader over written bytes ---------------------------------------

test("pup structure: the synthesized file reads back as a puppet", () => {
  const { bytes, frames, frameLocs } = buildTestPup();
  const pup = readPupFile(bytes);

  expect([...pup.dialogue.keys()]).toEqual(["test1.001", "test1.002"]);
  expect(pup.dialogue.get("test1.001")!.text).toBe("Good evening.");
  expect(pup.scripts).toEqual([{ name: "boot script", location: 1 }]);

  expect(pup.stances.length).toBe(1);
  const layers = pup.stances[0].layers;
  expect(layers[0].frames).toEqual([frameLocs[0]]);
  expect(layers[2].frames).toEqual([frameLocs[1]]);
  expect(layers[6].frames).toEqual([frameLocs[2], frameLocs[3]]);
  expect(layers[1].frames).toEqual([]);

  const anim = readAnimLogic(pup, pup.dialogue.get("test1.001")!.animLogicLocation);
  expect(anim.length).toBe(2);
  expect(anim[0].layers[6]).toEqual({ frame: 0, y: 132, x: 256 });
  expect(anim[1].layers[6].frame).toBe(1);
  expect(anim[0].layers[3].frame).toBe(-1);

  const head = decodeShpFrame(pup.file.containers[layers[2].frames[0]].data);
  expect(head.width).toBe(frames[1].width);
  expect(head.opaque).toEqual(frames[1].opaque);
});

// --- edits ------------------------------------------------------------------

test("dialogue edit: patches exactly one field and survives a round trip", () => {
  const { bytes } = buildTestPup();
  const pup = readPupFile(bytes);
  const before = readContainerFile(bytes);

  expect(patchDialogueText(pup, "nosuch.999", "x")).toBe(false);
  expect(patchDialogueText(pup, "TEST1.002", "Actually, the evening is dreadful.")).toBe(true);
  expect(pup.dialogue.get("test1.002")!.text).toBe("Actually, the evening is dreadful.");

  const out = writeContainerFile(pup.file);
  const back = readPupFile(out);
  expect(back.dialogue.get("test1.002")!.text).toBe("Actually, the evening is dreadful.");
  expect(back.dialogue.get("test1.001")!.text).toBe("Good evening.");

  // nothing else moved: every container but 0 is byte-identical, and in
  // container 0 only the one text field differs
  const after = readContainerFile(out);
  for (let i = 1; i < before.containers.length; i++) {
    expect(after.containers[i].data).toEqual(before.containers[i].data);
  }
  const rec = back.dialogue.get("test1.002")!.record;
  const a = after.containers[0].data;
  const b = before.containers[0].data;
  expect(a.subarray(0, rec + 24)).toEqual(b.subarray(0, rec + 24));
  expect(a.subarray(rec + 280)).toEqual(b.subarray(rec + 280));

  // clamping: a 300-char text stores its first 255 characters
  const long = "y".repeat(300);
  patchDialogueText(back, "test1.001", long);
  const clamped = readPupFile(writeContainerFile(back.file));
  expect(clamped.dialogue.get("test1.001")!.text).toBe("y".repeat(255));
});

test("frame replacement: new art (new size) exports and reads back", () => {
  const { bytes } = buildTestPup();
  const pup = readPupFile(bytes);
  const loc = pup.stances[0].layers[2].frames[0];

  // the editor's import path: replace the container, keep the stored anchor
  const old = decodeShpFrame(pup.file.containers[loc].data);
  const art = testFrame(30, 24, 9);
  art.posYraw = old.posYraw;
  art.posXraw = old.posXraw;
  pup.file.containers[loc] = { id: pup.file.containers[loc].id, data: encodeShpFrame(art) };

  const back = readPupFile(writeContainerFile(pup.file));
  const got = decodeShpFrame(back.file.containers[back.stances[0].layers[2].frames[0]].data);
  expect(got.width).toBe(30);
  expect(got.height).toBe(24);
  expect(got.posYraw).toBe(old.posYraw);
  expect(got.opaque).toEqual(art.opaque);
});

test("anchor edit: moves a stance frame without touching its pixels", () => {
  const { bytes } = buildTestPup();
  const pup = readPupFile(bytes);
  const before = readContainerFile(bytes);
  // the jaw's two frames — the layer an animLogic record moves per tick
  const [first, second] = pup.stances[0].layers[6].frames;

  // the editor's offset fields (editors/puppets.html) go through the shared SHP patch
  expect(patchFrameAnchor(pup.file, first, 140, 250)).toBe(true);
  expect(patchFrameAnchor(pup.file, before.containers.findIndex((c) => c.gap), 1, 1)).toBe(false);

  const back = readPupFile(writeContainerFile(pup.file));
  const moved = decodeShpFrame(back.file.containers[first].data);
  const old = decodeShpFrame(before.containers[first].data);
  expect([moved.posYraw, moved.posXraw]).toEqual([140, 250]);
  expect(moved.opaque).toEqual(old.opaque);
  // only that container's two header shorts moved
  expect(back.file.containers[first].data.subarray(8)).toEqual(
    before.containers[first].data.subarray(8),
  );
  expect(back.file.containers[second].data).toEqual(before.containers[second].data);
});
