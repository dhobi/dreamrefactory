/**
 * Dust's films (engine/src/df/mov-v1.ts) read from built files: a header of
 * another version, a frame table cut short by a record that names no picture,
 * a header too short for its palette or its frames, hotspot runs shared
 * between frames and ended by a record of no known type, the chain name only
 * a type-3 exit reads, the bed playlist, the containers nothing accounts for —
 * and the bridge to v4's MovFile, action by action.
 *
 *   npx vitest run engine/tests/mov-v1-reader.ts
 *
 * No game: the films are built ({@link file://./helpers/film-build.ts}).
 */
import { expect, test } from "vitest";
import { buildMovBytes } from "@dreamfactory/engine/df/mov-build";
import { MOV_V1_HOLD_TICKS, movFileFromV1, readMovFileV1 } from "@dreamfactory/engine/df/mov-v1";
import { artV1, movV1, soundChunk } from "./helpers/film-build";

const ART = artV1([1, 2, 3, 4], 2, 2);
const STUB = new Uint8Array(4);

test("a film whose header is not version 1 is refused", () => {
  const v4 = buildMovBytes({ palette: [0, 0, 0], width: 2, height: 2, frames: [{ name: "a", art: new Uint8Array(4) }] });
  expect(() => readMovFileV1(v4)).toThrow("not a DreamFactory 1 MOV (container 0 says version 4)");
});

test("the frame table ends at the first record whose picture is not one, and says so", () => {
  const read = (picture: number) =>
    readMovFileV1(movV1([{ frames: [{ picture: 1 }, { picture }, { picture: 1 }], containers: [ART, STUB] }]));
  for (const [ref, loc] of [
    [0, 0],
    [2, 2],
    [9, 9],
  ]) {
    const v1 = read(ref);
    expect(v1.frames.map((f) => f.picture)).toEqual([1]);
    expect(v1.warnings).toContain(`segment c0 frame 2/3: c${loc} is not a picture`);
  }
  // and the four-byte container is neither a picture, a header nor a sound
  expect(read(0).warnings).toContain("c2 is neither a picture, a header nor audio");
});

test("an implausible frame count, and a header too short for its palette or its frame records", () => {
  const none = readMovFileV1(movV1([{ frames: [], frameCount: 0, containers: [ART] }]));
  expect(none.warnings).toEqual(["segment c0: implausible frame count 0", "segment c0: no frame table at 0x8c2",
    // the picture no frame names is counted, and is not taken for a sound
    "c1 is neither a picture, a header nor audio",
  ]);
  expect(none.unaccounted).toBe(1);
  expect(readMovFileV1(movV1([{ frames: [{ picture: 1 }], frameCount: 5000, containers: [ART] }])).warnings[0]).toBe(
    "segment c0: implausible frame count 5000",
  );
  // cut before the palette ends: the frame record reads as zeroes, no picture
  const short = readMovFileV1(movV1([{ frames: [{ picture: 1 }], truncate: 0x100, containers: [ART] }]));
  expect(short.warnings.slice(0, 2)).toEqual(["segment c0 is too short to hold a palette", "segment c0 frame 1/1: c0 is not a picture"]);
  expect(short.segments[0].bed).toEqual([]);
  // cut where the chain name's length byte would be: the frame reads, with no name
  const cut = readMovFileV1(movV1([{ frames: [{ picture: 1, action: 3, chain: "next", hold: 7 }], truncate: 0x8c2 + 0x30, containers: [ART] }]));
  expect(cut.frames.map((f) => [f.picture, f.holdTicks, f.chainTo])).toEqual([[1, 7, ""]]);
});

test("hotspot runs: shared by frames that name the same one, and ended by a record of no known type", () => {
  const v1 = readMovFileV1(
    movV1([
      {
        frames: [
          {
            picture: 1,
            hotspots: [
              { type: 2, rect: [0, 0, 1, 1], target: 1, sound: 2 },
              { type: -5, rect: [1, 1, 2, 2], sound: -3 },
            ],
          },
          { picture: 1, hotspotAt: 0x8c2 + 3 * 80, hotspotCount: 2, flags2: 4 },
          { picture: 1, hotspots: [{ type: 1 }, { type: 9 }, { type: 1 }] },
        ],
        containers: [ART, soundChunk(10)],
      },
    ]),
  );
  const [a, b, c] = v1.frames;
  expect(a.regions.map((r) => [r.type, r.target, r.sound])).toEqual([
    [2, 1, 2],
    [5, 0, 0],
  ]);
  // the same run, the same records
  expect(b.regions).toBe(a.regions);
  expect([a.waitsForClick, b.waitsForClick]).toEqual([true, false]);
  expect(c.regions.map((r) => r.type)).toEqual([1]);
  expect(c.hotspotCount).toBe(3);
});

test("only a type-3 exit reads its chain name, and only a printable one", () => {
  const chainOf = (action: number, chain: string) =>
    readMovFileV1(movV1([{ frames: [{ picture: 1, action, chain }], containers: [ART] }])).frames[0].chainTo;
  expect(chainOf(3, "BELL2.MOV")).toBe("BELL2.MOV");
  expect(chainOf(3, "\x01\x02")).toBe("");
  expect(chainOf(1, "junk")).toBe("");
  expect(chainOf(3, "x".repeat(40))).toBe("");
});

test("the bed: playlist entries into the bed bank, one outside it skipped, and where it goes round to", () => {
  const seg = (playlistLoop: number) =>
    readMovFileV1(
      movV1([
        {
          frames: [{ picture: 4 }],
          soundBank: 1,
          bedBank: 2,
          playlist: [1, 3, 2],
          playlistLoop,
          containers: [soundChunk(10), soundChunk(20), soundChunk(30), ART, ART],
        },
      ]),
    );
  const v1 = seg(1);
  const s = v1.segments[0];
  expect(s.bed).toEqual([2, 3]);
  expect(s.bedLoopFrom).toBe(1);
  expect(v1.warnings).toContain("segment c0: bed entry 1 names chunk 3 of 2");
  expect(s.audioChunks).toEqual([1, 2, 3]);
  // no frame rate in the header: the engine's own
  expect(s.framerate).toBe(MOV_V1_HOLD_TICKS);
  // c5 is a picture no frame names
  expect(v1.unaccounted).toBe(1);
  expect(seg(5).segments[0].bedLoopFrom).toBe(0);
});

test("as v4's MovFile: each action's code, the goto targets and action frames by name, the segments chained", () => {
  const v1 = readMovFileV1(
    movV1([
      {
        framerate: 4,
        actionFrames: [-1, 1],
        frames: [
          { picture: 1, action: 1 },
          { picture: 1, action: 2, target: 9 },
          { picture: 1, action: 3, chain: "OUT.MOV" },
          { picture: 1, action: 4 },
          { picture: 1, action: 5 },
          { picture: 1, action: 0, sound: -2, hotspots: [{ type: 2, target: 0, sound: 2 }] },
          { picture: 1, action: 1 },
        ],
        containers: [ART, soundChunk(10)],
      },
      { frames: [{ picture: 1 }], containers: [ART] },
    ]),
  );
  const mov = movFileFromV1(v1);
  expect(mov.frames.map((f) => [f.name, f.type, f.target, f.event])).toEqual([
    ["1", 3, "", ""],
    ["2", 2, "7", ""],
    ["3", 3, "", "OUT.MOV"],
    ["4", 4, "", ""],
    ["5", 5, "", ""],
    ["6", 6, "", ""],
    ["7", 1, "", ""],
  ]);
  expect([mov.actionFrame1, mov.actionFrame2]).toEqual(["", "2"]);
  expect(mov.frames[5].sound).toBe("2");
  expect(mov.frames[5].regions.map((r) => [r.type, r.target, r.sound])).toEqual([[2, "1", "2"]]);
  expect(mov.minHoldTicks).toBe(4);
  expect(mov.segments.map((s) => [s.bias, s.frames.length])).toEqual([
    [0, 7],
    [3, 1],
  ]);
});
