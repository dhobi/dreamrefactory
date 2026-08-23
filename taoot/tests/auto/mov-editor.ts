/**
 * Movie-editor format layer — the write/edit half of the DF library that
 * movies.html (site/editors/mov-editor.ts) is built on: the frame-name patch, the frame
 * and region logic patches, the region rectangle, the two action-frame slots and
 * the ESC-aborts flag.
 *
 * Self-contained: works on a SYNTHESIZED movie built to the layout documented in
 * engine/src/df/mov.ts, so it runs without gamefiles/ — the editor must round-trip
 * user-supplied files, and these are the invariants that make that safe.
 *
 * The last test is the reason the editor does NOT offer art replacement: it
 * decodes the frame chain and shows that swapping one frame's container leaves
 * the NEXT frame decoding its deltas against a picture that is gone. That is a
 * property of the codec, so it is pinned here rather than asserted as a policy.
 */
import { test, expect } from "vitest";
import { DFContainerFile, readContainerFile, writeContainerFile } from "@dreamfactory/engine/df/container";
import { FrameBuffer, decodeFrame, encodeFrame } from "@dreamfactory/engine/df/image";
import {
  FLAG_KEY_SKIPS,
  MOV_NAME_FIELD,
  patchActionFrames,
  patchFrameLogic,
  patchFrameName,
  patchKeySkips,
  patchRegionLogic,
  patchRegionRect,
  readMovFile,
} from "@dreamfactory/engine/df/mov";
import { buildMovFile } from "@dreamfactory/engine/df/mov-build";

// --- byte writers -----------------------------------------------------------

const W = 64;
const H = 48;

/** a test picture: gradients, flat stretches, and rows repeating the one above */
function testImage(seed: number): Uint8Array {
  const px = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      px[i] =
        y % 4 === 2 && y > 0 ? px[i - W] : (x >> 3) % 2 ? (30 + seed) & 0xff : (x * 3 + y * seed) & 0xff;
    }
  }
  return px;
}

// --- synthetic movie --------------------------------------------------------

interface TestMovie {
  file: DFContainerFile;
  bytes: Uint8Array;
  /** the pixels each frame's art container was built from, in frame order —
   *  one shorter than the frame list, whose last frame carries no picture of
   *  its own (a `hold` frame) */
  images: Uint8Array[];
}

/** the fixture's colour table, as RGB triples */
const TEST_PALETTE = ((): Uint8Array => {
  const p = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    p[i * 3] = i;
    p[i * 3 + 1] = (i * 11) & 0xff;
    p[i * 3 + 2] = 255 - i;
  }
  return p;
})();

/**
 * A miniature but structurally complete MOV, built by the library's own writer
 * ({@link buildMovFile}): five frames — a plain animation frame with no logic
 * container, a frame that advances, a frame that WAITS on two regions (one jumps
 * back, one exits), a frame that chains to another movie, and one that holds the
 * picture before it instead of carrying its own — with both action-frame slots
 * set, the ESC flag set, and a type-0 gap container.
 *
 * The holding frame is the reason this fixture matters: it is row mode 10, "keep
 * the row from the previous image", which our own encoder never emits, and it is
 * what makes replacing a frame under a delta chain unsafe (the negative result at
 * the bottom of this file).
 */
function buildTestMovie(): TestMovie {
  const images = [1, 2, 3, 4].map(testImage);
  const { file } = buildMovFile({
    palette: TEST_PALETTE,
    width: W,
    height: H,
    keySkips: true,
    actionFrames: ["choose", "leave"],
    gaps: 1,
    frames: [
      { name: "open", type: 6, art: images[0], noLogic: true },
      { name: "step", type: 6, art: images[1], sound: "faucet on" },
      {
        name: "choose",
        type: 6,
        art: images[2],
        regions: [
          { type: 2, top: 10, left: 12, bottom: 40, right: 60, sound: "page", target: "step" },
          { type: 1, top: 300, left: 400, bottom: 340, right: 500, sound: "ok" },
        ],
      },
      { name: "leave", type: 3, art: images[3], event: "nextmov" },
      // no picture of its own: it holds the one before it, the way a real
      // movie's unchanged rows do
      { name: "hold", type: 6, hold: true },
    ],
  });
  return { file, bytes: writeContainerFile(file), images };
}

/**
 * A two-segment movie: a film is a CHAIN of them, each with its own header,
 * palette, frame table and action-frame slots, and each storing its locations
 * relative to its own header container (engine/src/df/mov.ts). Deliberately given
 * frames at the SAME record offsets as the first segment's, because that is
 * what made the container-0 bug invisible: an edit aimed at segment 1 landed on
 * segment 0's identically-placed record and renamed the wrong frame.
 */
function buildChainMovie(): { bytes: Uint8Array; segmentLocs: number[] } {
  const images = [5, 6, 7].map(testImage);
  const { file, segmentLocs } = buildMovFile({
    palette: TEST_PALETTE,
    width: W,
    height: H,
    keySkips: true,
    actionFrames: ["one", ""],
    frames: [
      { name: "one", type: 6, art: images[0] },
      { name: "two", type: 1, art: images[1] },
    ],
    segments: [
      {
        palette: TEST_PALETTE,
        width: W,
        height: H,
        keySkips: false,
        actionFrames: ["", "far"],
        frames: [
          { name: "far", type: 6, art: images[2], sound: "gull" },
          {
            name: "wait",
            type: 6,
            art: images[0],
            regions: [{ type: 1, top: 4, left: 5, bottom: 6, right: 7, sound: "click" }],
          },
        ],
      },
    ],
  });
  return { bytes: writeContainerFile(file), segmentLocs };
}

// --- the reader over written bytes ------------------------------------------

test("mov structure: the synthesized movie reads back as a state machine", () => {
  const { bytes, images } = buildTestMovie();
  const mov = readMovFile(bytes);

  expect([mov.width, mov.height]).toEqual([W, H]);
  expect(mov.keySkips).toBe(true);
  expect([mov.actionFrame1, mov.actionFrame2]).toEqual(["choose", "leave"]);
  expect(mov.frames.map((f) => f.name)).toEqual(["open", "step", "choose", "leave", "hold"]);
  expect(mov.frames.map((f) => f.record)).toEqual([0, 1, 2, 3, 4].map((i) => 0x87c + i * 42));

  // a frame with no logic container falls back to "advance" and carries no names
  const open = mov.frames[0];
  expect(open.locationClickRegion).toBe(0);
  expect([open.type, open.sound, open.event, open.target]).toEqual([6, "", "", ""]);

  // a frame's own action and its entry sound
  expect(mov.frames[1].sound).toBe("faucet on");
  expect(mov.frames[3]).toMatchObject({ type: 3, event: "nextmov" });

  // the waiting frame: two regions, Y-first coordinates read back by edge
  const choose = mov.frames[2];
  expect(choose.regions.length).toBe(2);
  expect(choose.regions[0]).toMatchObject({
    type: 2,
    y0: 10,
    x0: 12,
    y1: 40,
    x1: 60,
    sound: "page",
    target: "step",
    record: 1094,
  });
  expect(choose.regions[1]).toMatchObject({ type: 1, record: 1094 + 64 });

  // the art decodes, in order, to the pictures it was built from
  const fb = new FrameBuffer();
  mov.frames.forEach((f, i) => {
    const d = decodeFrame(mov.file.containers[f.locationFrame].data, fb);
    expect([d.width, d.height]).toEqual([W, H]);
    // the last frame holds the picture before it rather than carrying one
    expect(fb.pixels.subarray(0, W * H)).toEqual(images[Math.min(i, images.length - 1)]);
  });
});

test("container writer: an untouched movie exports the bytes it read", () => {
  const { bytes } = buildTestMovie();
  expect(writeContainerFile(readContainerFile(bytes))).toEqual(bytes);
  expect(writeContainerFile(readMovFile(bytes).file)).toEqual(bytes);
});

// --- edits ------------------------------------------------------------------

test("header edits: action-frame slots and the ESC flag, in container 0 only", () => {
  const { bytes } = buildTestMovie();
  const mov = readMovFile(bytes);
  const before = readContainerFile(bytes);

  expect(patchActionFrames(mov, "step", "")).toEqual({ actionFrame1: "step", actionFrame2: "" });
  expect(patchKeySkips(mov, false)).toBe(true);

  const back = readMovFile(writeContainerFile(mov.file));
  expect([back.actionFrame1, back.actionFrame2]).toEqual(["step", ""]);
  expect(back.keySkips).toBe(false);
  // clearing bit 0 leaves the rest of the flag word alone
  expect(back.flags).toBe(before.containers[0].data[0x18] & ~FLAG_KEY_SKIPS);
  expect(patchKeySkips(back, true)).toBe(true);
  expect(readMovFile(writeContainerFile(back.file)).keySkips).toBe(true);

  // nothing outside container 0 moved, and in it nothing but those two fields
  const after = readContainerFile(writeContainerFile(mov.file));
  for (let i = 1; i < before.containers.length; i++) {
    expect(after.containers[i].data).toEqual(before.containers[i].data);
  }
  expect(after.containers[0].data.subarray(0x1c, 0x40)).toEqual(
    before.containers[0].data.subarray(0x1c, 0x40),
  );
  expect(after.containers[0].data.subarray(0x60)).toEqual(before.containers[0].data.subarray(0x60));
  // the palette window follows the copy-on-write of container 0
  expect(mov.paletteRaw).toEqual(after.containers[0].data.subarray(0x6c, 0x6c + 2048));

  // clamping
  expect(patchActionFrames(back, "a".repeat(30), "").actionFrame1).toBe("a".repeat(MOV_NAME_FIELD));
});

test("frame edits: the name in the table, the logic in the frame's own container", () => {
  const { bytes } = buildTestMovie();
  const mov = readMovFile(bytes);
  const before = readContainerFile(bytes);

  expect(patchFrameName(mov, 1, "walkon")).toBe("walkon");
  expect(patchFrameName(mov, 9, "nope")).toBe(""); // no such frame
  expect(patchFrameLogic(mov, 1, { type: 2, target: "choose", sound: "faucet off" })).toBe(true);
  // a frame with no logic container has nowhere to put any of it
  expect(patchFrameLogic(mov, 0, { type: 1 })).toBe(false);

  const back = readMovFile(writeContainerFile(mov.file));
  expect(back.frames[1].name).toBe("walkon");
  expect(back.frames[1]).toMatchObject({ type: 2, target: "choose", sound: "faucet off" });
  // its event name, which was not passed, is untouched
  expect(back.frames[1].event).toBe("");
  // and frame 0 is exactly as it was
  expect(back.frames[0]).toMatchObject({ name: "open", type: 6, locationClickRegion: 0 });

  // two containers changed: container 0 (the name) and frame 1's logic
  const logic = mov.frames[1].locationClickRegion;
  const after = readContainerFile(writeContainerFile(mov.file));
  for (let i = 1; i < before.containers.length; i++) {
    if (i === logic) continue;
    expect(after.containers[i].data).toEqual(before.containers[i].data);
  }
  // in container 0, only frame 1's 42-byte record's name field
  const nameAt = 0x87c + 42 + 26;
  expect(after.containers[0].data.subarray(0, nameAt)).toEqual(
    before.containers[0].data.subarray(0, nameAt),
  );
  expect(after.containers[0].data.subarray(nameAt + 1 + MOV_NAME_FIELD)).toEqual(
    before.containers[0].data.subarray(nameAt + 1 + MOV_NAME_FIELD),
  );
});

test("region edits: action, names and rectangle, one record at a time", () => {
  const { bytes } = buildTestMovie();
  const mov = readMovFile(bytes);
  const before = readContainerFile(bytes);
  const frame = mov.frames[2];
  const [jump, exit] = frame.regions;

  expect(patchRegionLogic(mov, frame, jump, { type: 4, event: "sidemov", target: "leave" })).toBe(
    true,
  );
  expect(patchRegionRect(mov, frame, exit, { top: 8, left: 9, bottom: 20, right: 30 })).toBe(true);
  // the parsed region is updated with the bytes — it is what the overlay draws
  expect(exit).toMatchObject({ y0: 8, x0: 9, y1: 20, x1: 30 });
  expect(jump).toMatchObject({ type: 4, event: "sidemov", target: "leave" });

  const back = readMovFile(writeContainerFile(mov.file));
  const backRegions = back.frames[2].regions;
  expect(backRegions[0]).toMatchObject({
    type: 4,
    event: "sidemov",
    target: "leave",
    sound: "page", // not passed, so not touched
    y0: 10, // the other record's rectangle is untouched
    x0: 12,
  });
  expect(backRegions[1]).toMatchObject({ type: 1, y0: 8, x0: 9, y1: 20, x1: 30, sound: "ok" });

  // only that frame's logic container changed, and not its 1090-byte header
  const logic = frame.locationClickRegion;
  const after = readContainerFile(writeContainerFile(mov.file));
  for (let i = 0; i < before.containers.length; i++) {
    if (i === logic) continue;
    expect(after.containers[i].data).toEqual(before.containers[i].data);
  }
  expect(after.containers[logic].data.subarray(0, 1094)).toEqual(
    before.containers[logic].data.subarray(0, 1094),
  );

  // clamping: int16 edges, rounded; and the name fields
  patchRegionRect(back, back.frames[2], backRegions[1], {
    top: 40000,
    left: 0.6,
    bottom: 1,
    right: 2,
  });
  expect(backRegions[1]).toMatchObject({ y0: 32767, x0: 1 });
  patchRegionLogic(back, back.frames[2], backRegions[1], { target: "t".repeat(30) });
  expect(backRegions[1].target).toBe("t".repeat(MOV_NAME_FIELD));
});

// --- the segment chain ------------------------------------------------------

test("chain: each segment reads its own header, frames and slots", () => {
  const { bytes, segmentLocs } = buildChainMovie();
  const mov = readMovFile(bytes);

  expect(mov.segments.length).toBe(2);
  expect(mov.segments.map((s) => s.bias)).toEqual(segmentLocs);
  // a MovFile IS its first segment
  expect(mov.segments[0]).toBe(mov);

  expect(mov.frames.map((f) => f.name)).toEqual(["one", "two"]);
  expect([mov.actionFrame1, mov.keySkips]).toEqual(["one", true]);

  const two = mov.segments[1];
  expect(two.frames.map((f) => f.name)).toEqual(["far", "wait"]);
  expect([two.actionFrame2, two.keySkips]).toEqual(["far", false]);
  expect(two.frames[0].sound).toBe("gull");
  expect(two.frames[1].regions).toHaveLength(1);
  // its locations were stored bias-relative and come back absolute — so they
  // point past its own header rather than into the first segment's frames
  expect(two.frames[0].locationFrame).toBeGreaterThan(two.bias);
  expect(two.frames[1].regions[0]).toMatchObject({ type: 1, y0: 4, x0: 5, sound: "click" });
});

test("chain: an edit lands in the segment it was aimed at, not in container 0", () => {
  const { bytes } = buildChainMovie();
  const mov = readMovFile(bytes);
  const before = readContainerFile(bytes);
  const two = mov.segments[1];

  // every one of these used to write container 0 — the FIRST segment's header
  expect(patchFrameName(two, 0, "arrived")).toBe("arrived");
  expect(patchActionFrames(two, "arrived", "")).toEqual({
    actionFrame1: "arrived",
    actionFrame2: "",
  });
  expect(patchKeySkips(two, true)).toBe(true);
  expect(patchFrameLogic(two, 1, { type: 2, target: "arrived" })).toBe(true);

  const back = readMovFile(writeContainerFile(mov.file));
  const backTwo = back.segments[1];
  expect(backTwo.frames[0].name).toBe("arrived");
  expect([backTwo.actionFrame1, backTwo.actionFrame2]).toEqual(["arrived", ""]);
  expect(backTwo.keySkips).toBe(true);
  expect(backTwo.frames[1]).toMatchObject({ type: 2, target: "arrived" });

  // ...and the first segment is untouched: same frame names, same slots, same
  // flag, and its header container byte-for-byte what it was
  expect(back.frames.map((f) => f.name)).toEqual(["one", "two"]);
  expect([back.actionFrame1, back.actionFrame2]).toEqual(["one", ""]);
  expect(back.keySkips).toBe(true);
  const after = readContainerFile(writeContainerFile(mov.file));
  expect(after.containers[0].data).toEqual(before.containers[0].data);
  // the palette window follows the copy-on-write of the SEGMENT's header
  expect(two.paletteRaw).toEqual(
    after.containers[two.bias].data.subarray(0x6c, 0x6c + 2048),
  );
});

// --- why art is read-only ---------------------------------------------------

test("art replacement smears the rest of the chain — which is why it is not offered", () => {
  const { bytes, images } = buildTestMovie();
  const mov = readMovFile(bytes);
  const last = mov.frames.length - 1; // "hold": it shows whatever came before it

  const decodeAll = (m: ReturnType<typeof readMovFile>): Uint8Array[] => {
    const fb = new FrameBuffer();
    return m.frames.map((f) => {
      decodeFrame(m.file.containers[f.locationFrame].data, fb);
      return fb.pixels.slice(0, W * H);
    });
  };

  // as shipped, the holding frame shows the picture of the frame before it
  expect(decodeAll(mov)[last]).toEqual(images[images.length - 1]);

  // replace the frame BEFORE it with a valid, self-contained encode
  const fresh = testImage(9);
  const loc = mov.frames[last - 1].locationFrame;
  mov.file.containers[loc] = { id: mov.file.containers[loc].id, data: encodeFrame(fresh, W, H) };

  const back = readMovFile(writeContainerFile(mov.file));
  const seen = decodeAll(back);
  // the replaced frame is fine, and the frames before it are untouched
  expect(seen[last - 1]).toEqual(fresh);
  expect(seen[0]).toEqual(images[0]);
  // but the holding frame now shows the NEW picture, though its own container was
  // never touched: its rows are deltas against a frame that is gone. THIS is the
  // smear, and on a real movie it runs to the end of the chain — which is why the
  // movie editor exports logic edits only.
  expect(seen[last]).toEqual(fresh);
  expect(seen[last]).not.toEqual(images[images.length - 1]);
  expect(back.file.containers[back.frames[last].locationFrame].data).toEqual(
    readContainerFile(bytes).containers[mov.frames[last].locationFrame].data,
  );
});
