/**
 * DreamFactory 0's film reader (engine/src/df/mov-v0.ts) on built films: a
 * frame count the header cannot hold, hotspot runs that point outside it or
 * reach a record of no known type, the step bit on the last frame, and the
 * bridge to v4's MovFile for each action.
 *
 *   npx vitest run engine/tests/mov-v0-reader.ts
 *
 * No game: the films are built ({@link file://./helpers/v0-build.ts});
 * engine/tests/df0-formats.ts reads the rip's.
 */
import { expect, test } from "vitest";
import { FLAG_STEP, movFileFromV0, nextFrameV0, readMovFileV0 } from "@dreamfactory/engine/df/mov-v0";
import { filmV0 } from "./helpers/v0-build";

test("a frame count the header cannot hold is refused", () => {
  expect(() => readMovFileV0(filmV0({ frames: [{}], frameCount: 2 }))).toThrow(/2 frames do not fit a \d+-byte header/);
  expect(() => readMovFileV0(filmV0({ frames: [], frameCount: -1 }))).toThrow(/-1 frames do not fit/);
});

test("a hotspot run stops outside container 0 and at a record of no known type", () => {
  const film = readMovFileV0(
    filmV0({
      frames: [
        { hotspots: [{ type: 1, rect: [0, 0, 1, 1] }], hotspotAt: 0x7fffff },
        { hotspots: [{ type: 1, rect: [0, 0, 1, 1] }], hotspotAt: -4 },
        { hotspots: [{ type: -2, rect: [0, 0, 1, 1], target: 1 }, { type: 7, rect: [0, 0, 1, 1] }, { type: 1, rect: [0, 0, 1, 1] }] },
      ],
    }),
  );
  expect(film.frames.map((f) => [f.hotspotCount, f.hotspots.length])).toEqual([
    [1, 0],
    [1, 0],
    [3, 1],
  ]);
  expect(film.frames[2].hotspots[0]).toMatchObject({ type: -2, target: 1, film: "" });
});

test("the step bit goes on to the next frame, and off the last ends the film", () => {
  const film = readMovFileV0(filmV0({ frames: [{ flags: FLAG_STEP, action: 1 }, { flags: FLAG_STEP, action: 2, target: 0 }] }));
  expect([nextFrameV0(film, 0), nextFrameV0(film, 1)]).toEqual([1, -1]);
});

test("as v4's MovFile: exit, goto, chain and the rest, the step bit, and the hotspots' types", () => {
  const v0 = readMovFileV0(
    filmV0({
      frames: [
        { action: 1 },
        { action: 2, target: 7 },
        { action: 3, chainTo: "flip.move" },
        { action: 5 },
        { action: 1, flags: FLAG_STEP },
        { action: 1, sound: 1, hotspots: [{ type: -1, rect: [0, 0, 1, 1], sound: 1 }, { type: 2, rect: [0, 0, 1, 1], target: 0 }] },
      ],
    }),
  );
  const mov = movFileFromV0(v0);
  expect(mov.frames.map((f) => [f.type, f.target, f.event])).toEqual([
    [3, "", ""],
    [2, "6", ""],
    [3, "", "flip.move"],
    [6, "", ""],
    [6, "", ""],
    [1, "", ""],
  ]);
  expect(mov.frames[5].regions.map((r) => [r.type, r.target, r.sound])).toEqual([
    [1, "", "1"],
    [2, "1", ""],
  ]);
  expect([...mov.sounds]).toEqual([["1", 1]]);
});
