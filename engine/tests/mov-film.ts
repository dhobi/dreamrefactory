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
import { FilmPictures, FilmTimeline, HELD_MS, LOOP_MS, filmTimeline, mixFilmSound } from "@dreamfactory/engine/df/mov-film";
import { BED_STRETCH_LIMIT, NATIVE_FRAME_MS, TICK_MS, framesLoop, isBed } from "@dreamfactory/engine/df/mov-pace";

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

test("a loop plays for a while, and ends the video if nothing clicks out of it", () => {
  const tl = filmTimeline(
    film([
      { name: "a", art: art(1), type: 6 },
      { name: "b", art: art(2), type: 6 },
      { name: "c", art: art(1), type: 2, target: "a" },
    ]),
  );
  const loopMs = 18 * TICK_MS;
  const passes = Math.ceil(LOOP_MS / loopMs);
  expect(tl.shots.map((s) => s.frame)).toEqual(Array.from({ length: passes }, () => [0, 1, 2]).flat());
  expect(tl.ending).toEqual({ kind: "loop", segIdx: 0, frame: 2, to: 0 });
});

test("a film that waits for a click is clicked through, the way camelsee.mov's gallop starts and stops", () => {
  const all = { top: 0, left: 0, bottom: H, right: W };
  const through = 1 << 2;
  const tl = filmTimeline(
    film([
      // a still: one region to the end, one to the gallop — the nearer is taken
      { name: "still", art: art(1), type: 6, regions: [{ ...all, type: 2, target: "halt" }, { ...all, type: 2, target: "run1" }] },
      // the gallop loops, and a click on it leads into the horses stopping
      { name: "run1", art: art(2), type: 6, flags: through, regions: [{ ...all, type: 2, target: "slow" }] },
      { name: "run2", art: art(1), type: 2, target: "run1", flags: through, regions: [{ ...all, type: 2, target: "slow" }] },
      { name: "slow", art: art(2), type: 6 },
      { name: "halt", art: art(1), type: 1 },
    ]),
  );
  const frames = tl.shots.map((s) => s.frame);
  expect(frames[0]).toBe(0);
  expect(tl.shots[0].ms).toBe(HELD_MS);
  expect(frames.slice(-2)).toEqual([3, 4]);
  // the gallop ran for the loop's minimum before the click
  const gallop = tl.shots.filter((s) => s.frame === 1 || s.frame === 2).reduce((a, s) => a + s.ms, 0);
  expect(gallop).toBeGreaterThanOrEqual(LOOP_MS);
  expect(tl.clicks).toBe(2);
  expect(tl.ending).toEqual({ kind: "end" });
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

test("a frame that waits for a click no region leads on from is held, and the video ends on it", () => {
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
    clicks: 0,
    sounds: [
      { atMs: 0, untilMs: 1000, sampleRate: 10, samples: new Float32Array([0.5, 0, 0, 0]), loop: true },
      { atMs: 500, untilMs: 1000, sampleRate: 10, samples: new Float32Array([0.25]), loop: false },
    ],
  };
  expect(Array.from(mixFilmSound(tl, 10))).toEqual([0.5, 0, 0, 0, 0.5, 0.25, 0, 0, 0.5, 0]);
});

test("the movie editor's two notes: a soundtrack far past its picture, and a picture that jumps back", () => {
  // a bed is more than BED_STRETCH_LIMIT native frames of sound for each picture
  const limit = (NATIVE_FRAME_MS * BED_STRETCH_LIMIT * 10) / 1000;
  expect(isBed(limit * 1.01, 10)).toBe(true);
  expect(isBed(limit, 10)).toBe(false);

  // a goto (2) or a hotspot jump (4) back to itself or an earlier frame loops;
  // forward does not, nor a target no frame is called
  const loop = (type: number, target: string) =>
    framesLoop(film([{ name: "a", art: art(1), type: 6 }, { name: "B", art: art(2), type, target }, { name: "c", art: art(1), type: 1 }]));
  expect(loop(2, "a")).toBe(true);
  expect(loop(4, "b")).toBe(true);
  expect(loop(2, "c")).toBe(false);
  expect(loop(2, "nowhere")).toBe(false);
  expect(loop(6, "a")).toBe(false);
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
  expect(pcm).toHaveLength(Math.ceil((tl.ms / 1000) * 48000));
  expect(pcm.some((s) => s !== 0)).toBe(true);
});

const CAMELSEE = "taoot/gamefiles/en/titanic1/movies/camelsee.mov";

test.skipIf(!existsSync(CAMELSEE))("camelsee.mov gallops, and its sounds take turns the way the game plays them", () => {
  const mov = readMovFile(new Uint8Array(readFileSync(CAMELSEE)));
  const tl = filmTimeline(mov);
  // the still, then the gallop, then the click at the gallop's jump back leads
  // into the horses stopping (HORSE 85…88), not straight to the last frame
  expect(tl.shots[0]).toMatchObject({ frame: 0, ms: HELD_MS });
  expect(tl.shots.slice(-5).map((s) => s.frame)).toEqual([85, 86, 87, 88, 89]);
  expect(tl.clicks).toBe(2);
  // one event sound at a time: each cuts off the one before, as the game's
  // "sound" channel does, so the 2.5 s gallop sound never plays over itself
  const events = tl.sounds.filter((s) => !s.loop);
  for (let k = 1; k < events.length; k++) expect(events[k - 1].untilMs).toBeLessThanOrEqual(events[k].atMs);
  // ...and the last is the click's own, camelend, heard out to its end
  const last = events.at(-1)!;
  expect(last.atMs).toBe(tl.shots.at(-5)!.atMs);
  expect(last.untilMs - last.atMs).toBeCloseTo((last.samples.length / last.sampleRate) * 1000);
});
