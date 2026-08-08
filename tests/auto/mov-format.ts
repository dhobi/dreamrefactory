/**
 * The MOV container format against the shipped corpus — the facts recovered
 * from the demo build's movie loop (TI.EXE in gamefiles/demo/install/bin/,
 * fn 0x449310 and callees; docs/formats/mov.md has the full account):
 *
 *   1. A file is a chain of SEGMENTS (header +0x2c names the next one), each
 *      a film of its own. The port played segment 0 and called it the movie,
 *      which is what "trailer.mov ends too soon" and the 70-frame, 37.5 MB
 *      leave.mov both were.
 *   2. A segment carries a CUE table (+0x68): timed jumps to named frames.
 *      tour.mov's single cue is what leaves its authored ship's-logo loop —
 *      without it playback ping-pongs frames 5<->6 forever ("does not
 *      advance").
 *   3. The picture sits at the header's screen origin (+0x24/+0x26) — the
 *      demo's letterboxed 512x264 films centre themselves at (0,60).
 *
 * Skipped wholesale when the tree in question is not installed.
 */
import { test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gamefilesRoot } from "../../tools/gamefiles";
import { readMovFile } from "../../src/df/mov";

const root = gamefilesRoot();
const demoMovies = join(root, "demo", "movies");
const noDemo = !existsSync(join(demoMovies, "tour.mov"));

const mov = (...p: string[]) => readMovFile(new Uint8Array(readFileSync(join(...p))));

test.skipIf(noDemo)("a movie is a chain of segments, and a segment can carry cues", () => {
  const tour = mov(demoMovies, "tour.mov");
  // one segment per narrated slide, plus the ship's-logo intro and outro
  expect(tour.segments.length).toBe(20);
  // MovFile IS its first segment, so single-segment reads are unchanged
  expect(tour.segments[0]).toBe(tour);

  // the cue: tick 200 (3.33 s), out of the authored 5<->6 logo loop to frame 7
  expect(tour.cues).toEqual([{ tick: 200, target: "Name 12" }]);
  expect(tour.frames[6].type).toBe(2); // the backward goto the cue escapes
  expect(tour.frames[6].target.toLowerCase()).toBe("shiplogo 5");
  expect(tour.frames.findIndex((f) => f.name === "Name 12")).toBe(7);

  // a later segment: its own frame table, no audio of its own (it inherits
  // the narration bed segment 0 started), and locations resolved past its
  // own bias — the frame art must decode, i.e. point at real containers
  const slide = tour.segments[1];
  expect(slide.bias).toBe(46);
  expect(slide.frames.length).toBe(3);
  expect(slide.audioChunks.length).toBe(0);
  expect(slide.cues.length).toBe(0);
  for (const f of slide.frames) {
    expect(f.locationFrame).toBeGreaterThan(slide.bias);
    expect(tour.file.containers[f.locationFrame].data.length).toBeGreaterThan(0);
  }

  // trailer.mov: 13 segments, 698 frames — not 139 against 92 s of narration
  const trailer = mov(demoMovies, "trailer.mov");
  expect(trailer.segments.length).toBe(13);
  expect(trailer.segments.reduce((a, s) => a + s.frames.length, 0)).toBe(698);
  expect(trailer.cues.length).toBe(0);
});

test.skipIf(noDemo)("the letterboxed films name their own screen origin", () => {
  // 512x264 on a 512x384 screen, centred: 60 px of black above AND below
  const trailer = mov(demoMovies, "trailer.mov");
  expect([trailer.width, trailer.height]).toEqual([512, 264]);
  expect([trailer.originX, trailer.originY]).toEqual([0, 60]);
  // tour.mov is authored top-aligned — the field is data, not a derived centring
  const tour = mov(demoMovies, "tour.mov");
  expect([tour.originX, tour.originY]).toEqual([0, 0]);
});

// the full game ships multi-segment films too — the sinking montage above all
const enMovies = join(root, "en", "TITANIC1", "movies");
test.skipIf(!existsSync(join(enMovies, "leave.mov")))("leave.mov is the whole sinking montage", () => {
  const leave = mov(enMovies, "leave.mov");
  expect(leave.segments.length).toBe(10);
  expect(leave.segments.reduce((a, s) => a + s.frames.length, 0)).toBe(1628);
  // every segment ends in an authored exit — the chain, not a truncation
  for (const s of leave.segments) expect(s.frames[s.frames.length - 1].type).toBe(1);
  // full-screen, no letterbox
  expect([leave.width, leave.height, leave.originX, leave.originY]).toEqual([512, 384, 0, 0]);
});
