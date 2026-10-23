/**
 * A film laid out on a clock (engine/src/df/mov-film.ts) for the films the
 * first suite (engine/tests/mov-film.ts) builds no examples of: Dust's v1
 * segments, each bringing a bed that cuts off the one before, with an empty
 * segment between and frame sounds the film does not hold; a v0 film's
 * sounds and palette; the frame actions that stop the walk; a click that
 * leads back to a frame not yet shown; the twenty-minute backstop; and the
 * pictures walked forward, back, past the end and across segments.
 *
 *   npx vitest run engine/tests/mov-film-edges.ts
 *
 * No game: the films are built (helpers/film-build.ts, helpers/v0-build.ts,
 * and the engine's own df/mov-build.ts).
 */
import { expect, test } from "vitest";
import { readMovFile } from "@dreamfactory/engine/df/mov";
import { buildMovBytes, type MovBuildFrame } from "@dreamfactory/engine/df/mov-build";
import { FilmPictures, MAX_MS, filmTimeline, mixFilmSound } from "@dreamfactory/engine/df/mov-film";
import { TICK_MS } from "@dreamfactory/engine/df/mov-pace";
import { movFileFromV0, readMovFileV0 } from "@dreamfactory/engine/df/mov-v0";
import { movFileFromV1, readMovFileV1 } from "@dreamfactory/engine/df/mov-v1";
import { artV1, movV1, soundChunk } from "./helpers/film-build";
import { filmV0, soundV0 } from "./helpers/v0-build";

/** a v1 palette where entry k is red k × 10 */
const palette = new Uint8Array(256 * 8);
for (let k = 0; k < 256; k++) palette[k * 8 + 3] = (k * 10) & 0xff;

/** three segments: a bed and two event sounds, none, and a bed of its own */
function dust() {
  return movFileFromV1(
    readMovFileV1(
      movV1([
        {
          framerate: 6,
          soundBank: 2,
          bedBank: 1,
          playlist: [1],
          palette,
          frames: [
            { picture: 4, sound: 1 },
            // a container that is not one of the film's sounds: the one playing goes on
            { picture: 5, sound: 9, flags2: 1 },
            // an empty sound
            { picture: 5, sound: 2, action: 1 },
          ],
          containers: [soundChunk(500), soundChunk(0), soundChunk(3000), artV1([1, 2, 3, 4], 2, 2), artV1([0, 9, 255, 9], 2, 2)],
        },
        { frames: [], frameCount: 0, containers: [] },
        {
          framerate: 6,
          soundBank: 0,
          bedBank: 1,
          playlist: [1],
          palette,
          frames: [{ picture: 2, action: 9 }],
          containers: [soundChunk(1000), artV1([7, 7, 7, 7], 2, 2)],
        },
      ]),
    ),
  );
}

test("v1 segments: each bed cuts off the one before, an empty segment is passed over, a sound the film lacks is silence", () => {
  const tl = filmTimeline(dust());
  const hold = 6 * TICK_MS;
  expect(tl.shots.map((s) => [s.segIdx, s.frame])).toEqual([
    [0, 0],
    [0, 1],
    [0, 2],
    [2, 0],
  ]);
  // frame 2 waits for frame 1's half-second sound, which frame 2's own (absent) does not cut
  expect(tl.shots[1].ms).toBeCloseTo(500 - hold);
  expect(tl.ending).toEqual({ kind: "end" });
  const [bed0, voice, empty, bed2] = tl.sounds;
  expect(tl.sounds).toHaveLength(4);
  expect([bed0.atMs, bed0.untilMs]).toEqual([0, tl.shots[3].atMs]);
  // the empty sound cut the voice where it began, and lasts nothing
  expect(voice.untilMs).toBeCloseTo(500);
  expect(empty.atMs).toBe(empty.untilMs);
  expect([bed2.atMs, bed2.untilMs]).toEqual([tl.shots[3].atMs, tl.ms]);
  // the mix: the empty sound adds nothing, and the beds and the voice are all heard
  const mix = mixFilmSound(tl, 1000);
  expect(mix).toHaveLength(Math.ceil(tl.ms));
  expect(mix[10]).toBeCloseTo(0.5, 1);
});

test("v1 pictures composite over the one before; walked back, past the end, and into another segment", () => {
  const pics = new FilmPictures(dust());
  const red = (p: ReturnType<FilmPictures["picture"]>) => [0, 1, 2, 3].map((i) => p!.rgba[i * 4]);
  expect(red(pics.picture(0, 0))).toEqual([10, 20, 30, 40]);
  // 0 and 255 are see-through: frame 1 shows through them
  expect(red(pics.picture(0, 1))).toEqual([10, 90, 30, 90]);
  // back to the first: the chain restarts
  expect(red(pics.picture(0, 0))).toEqual([10, 20, 30, 40]);
  // past the last frame there is nothing more to decode: the picture stays
  expect(red(pics.picture(0, 9))).toEqual([10, 90, 30, 90]);
  expect(red(pics.picture(2, 0))).toEqual([70, 70, 70, 70]);
});

test("a v0 film: its sounds are v0 sounds, and its palette is read as stored (255 is not made white)", () => {
  const mov = movFileFromV0(
    readMovFileV0(
      filmV0({
        frames: [{ picture: 1, sound: 2, hold: 3 }, { picture: 3, action: 1 }],
        framerate: 1,
        containers: [artV1([255, 255, 255, 255], 2, 2), soundV0(3)],
      }),
    ),
  );
  const tl = filmTimeline(mov);
  expect(tl.sounds.map((s) => [s.sampleRate, s.samples.length])).toEqual([[22050, 3 * 370]]);
  const pics = new FilmPictures(mov);
  const first = pics.picture(0, 0);
  expect([...first!.rgba.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
  // frame 2 names container 3, which the film does not have: the picture stays
  expect(pics.picture(0, 1)).toBe(first);
});

const W = 2;
const H = 2;
function film(frames: MovBuildFrame[]) {
  return readMovFile(buildMovBytes({ palette: [0, 0, 0], width: W, height: H, minHoldTicks: 1, frames }));
}
const art = new Uint8Array(W * H).fill(1);

test("frame actions that stop the walk: a goto to no frame and a return end it, a step back loops", () => {
  expect(filmTimeline(film([{ name: "a", art, type: 6 }, { name: "b", art, type: 2, target: "nowhere" }])).ending).toEqual({ kind: "end" });
  expect(filmTimeline(film([{ name: "a", art, type: 6 }, { name: "b", art, type: 5 }])).ending).toEqual({ kind: "end" });
  // 3 and 4 hand the film on: the walk ends with the chain
  for (const type of [3, 4]) {
    expect(filmTimeline(film([{ name: "a", art, type: 6 }, { name: "b", art, type, event: "next.move" }])).ending).toEqual({
      kind: "chain",
      segIdx: 0,
      frame: 1,
      event: "next.move",
    });
  }
  const back = filmTimeline(film([{ name: "a", art, type: 6 }, { name: "b", art, type: 7 }]));
  expect(back.ending).toEqual({ kind: "loop", segIdx: 0, frame: 1, to: 0 });
});

test("a click may lead back to a frame not yet shown; a sound the film has no table for is silence", () => {
  const tl = filmTimeline(
    film([
      { name: "a", art, type: 2, target: "c", sound: "ghost" },
      { name: "b", art, type: 1 },
      { name: "c", art, type: 6, regions: [{ type: 2, target: "b", top: 0, left: 0, bottom: 1, right: 1 }] },
    ]),
  );
  expect(tl.shots.map((s) => s.frame)).toEqual([0, 2, 1]);
  expect(tl.clicks).toBe(1);
  expect(tl.ending).toEqual({ kind: "end" });
  expect(tl.sounds).toEqual([]);
});

test("a film is cut off at twenty minutes", () => {
  const tl = filmTimeline(film([{ name: "a", art, type: 6, holdTicks: 80_000 }, { name: "b", art, type: 1 }]));
  expect(tl.ending).toEqual({ kind: "long" });
  expect(tl.shots).toHaveLength(1);
  expect(tl.ms).toBeGreaterThanOrEqual(MAX_MS);
});
