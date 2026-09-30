/**
 * A film laid out on a clock for a video file (engine/src/df/mov-film.ts, #435).
 *
 *   npx vitest run engine/tests/mov-film.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { test, expect } from "vitest";
import { buildMovBytes, MovBuildFrame } from "@dreamfactory/engine/df/mov-build";
import { readMovFile } from "@dreamfactory/engine/df/mov";
import { readMovFileV5 } from "@dreamfactory/engine/df/mov-v5";
import { FilmPictures, FilmTimeline, HELD_MS, filmTimeline, mixFilmSound } from "@dreamfactory/engine/df/mov-film";
import { TICK_MS } from "@dreamfactory/engine/df/mov-pace";

const W = 8, H = 6;
const art = (colour: number) => new Uint8Array(W * H).fill(colour);

function film(frames: MovBuildFrame[]) {
  return readMovFile(
    buildMovBytes({ palette: [0, 0, 0, 255, 0, 0, 0, 255, 0], width: W, height: H, minHoldTicks: 6, frames }),
  );
}

test("a cutscene plays straight through on its holds", () => {
  const tl = filmTimeline(
    film([
      { name: "a", art: art(1), type: 6 },
      { name: "b", art: art(2), type: 6, holdTicks: 12 },
      { name: "c", art: art(1), type: 1 },
    ]),
  );
  expect(tl.shots.map((s) => [s.frame, s.atMs, s.ms])).toEqual([
    [0, 0, 6 * TICK_MS],
    [1, 6 * TICK_MS, 12 * TICK_MS],
    [2, 18 * TICK_MS, 6 * TICK_MS],
  ]);
  expect(tl.ms).toBeCloseTo(24 * TICK_MS);
  expect(tl.ending).toEqual({ kind: "end" });
});

test("a jump back to a frame already shown ends the video there", () => {
  const tl = filmTimeline(
    film([
      { name: "a", art: art(1), type: 6 },
      { name: "b", art: art(2), type: 6 },
      { name: "c", art: art(1), type: 2, target: "a" },
    ]),
  );
  expect(tl.shots.map((s) => s.frame)).toEqual([0, 1, 2]);
  expect(tl.ending).toEqual({ kind: "loop", segIdx: 0, frame: 2, to: 0 });
});

test("a forward jump skips the frames between", () => {
  const tl = filmTimeline(
    film([
      { name: "a", art: art(1), type: 2, target: "c" },
      { name: "b", art: art(2), type: 6 },
      { name: "c", art: art(1), type: 1 },
    ]),
  );
  expect(tl.shots.map((s) => s.frame)).toEqual([0, 2]);
});

test("a frame that waits for a click is held, and the video ends on it", () => {
  const tl = filmTimeline(
    film([
      { name: "a", art: art(1), type: 6 },
      { name: "b", art: art(2), type: 1, regions: [{ top: 0, left: 0, bottom: H, right: W, type: 1 }] },
    ]),
  );
  expect(tl.shots.at(-1)).toMatchObject({ frame: 1, ms: HELD_MS });
  expect(tl.ending).toEqual({ kind: "click", segIdx: 0, frame: 1 });
});

test("the pictures decode down the chain, and back again", () => {
  const mov = film([
    { name: "a", art: art(1), type: 6 },
    { name: "b", art: art(2), type: 1 },
  ]);
  const pics = new FilmPictures(mov);
  const px = (f: number) => Array.from(pics.picture(0, f)!.rgba.slice(0, 4));
  expect(px(1)).toEqual([0, 255, 0, 255]);
  expect(px(0)).toEqual([255, 0, 0, 255]);
});

test("the mix places each sound on the clock, loops a bed and cuts it off", () => {
  const tl: FilmTimeline = {
    shots: [],
    ms: 1000,
    ending: { kind: "end" },
    sounds: [
      { atMs: 0, untilMs: 1000, sampleRate: 10, samples: new Float32Array([0.5, 0, 0, 0]), loop: true },
      { atMs: 500, untilMs: 1000, sampleRate: 10, samples: new Float32Array([0.25]), loop: false },
    ],
  };
  expect(Array.from(mixFilmSound(tl, 10))).toEqual([0.5, 0, 0, 0, 0.5, 0.25, 0, 0, 0.5, 0]);
});

const ARRIVE = "redjack/gamefiles/RJDisk2/movies/arrive.move";

test.skipIf(!existsSync(ARRIVE))("arrive.move lays out end to end under its soundtrack", () => {
  const mov = readMovFileV5(new Uint8Array(readFileSync(ARRIVE)));
  const tl = filmTimeline(mov);
  expect(tl.ending.kind).not.toBe("long");
  expect(tl.shots.length).toBeGreaterThan(1);
  expect(tl.sounds.length).toBeGreaterThan(0);
  const pic = new FilmPictures(mov).picture(tl.shots[0].segIdx, tl.shots[0].frame)!;
  expect(pic.width * pic.height * 4).toBe(pic.rgba.length);
  const pcm = mixFilmSound(tl, 48000);
  expect(pcm.length).toBe(Math.ceil((tl.ms / 1000) * 48000));
  expect(pcm.some((s) => s !== 0)).toBe(true);
});
