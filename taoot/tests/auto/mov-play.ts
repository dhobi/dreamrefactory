/**
 * The movie PLAYER over a shipped film — the state machine, not the container.
 *
 * `taoot/tests/auto/mov-format.ts` proves camelsee.mov says what it says; this proves
 * the port acts on it. The two halves were separable, and that is exactly how
 * issue #172 survived: the flag was parsed and then dropped on the floor, so
 * every format assertion could pass while the gym's horses stood still.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { MoviePlayer } from "@dreamfactory/engine/web/movie-player";
import { gamefiles, gamefilesRoot } from "../../tools/gamefiles";
import { readMovFile } from "@dreamfactory/engine/df/mov";
import {
  OVERRUN_MARGIN,
  segmentAudio,
  soundtrackFor,
} from "@dreamfactory/engine/df/mov-sound";
import { segmentInterval } from "@dreamfactory/engine/df/mov-pace";

const root = gamefilesRoot();

/** the named film of the English tree, and a player with nothing else in it */
function open(name: string): { player: MoviePlayer; bytes: Uint8Array } | null {
  const path = gamefiles(root, "en").resolve(name);
  if (!path) return null; // no full-game tree installed
  const bytes = new Uint8Array(readFileSync(path));
  const session = new GameSession(
    (f) => (f.toLowerCase() === name.toLowerCase() ? bytes : null),
    new NullAudioSink(),
  );
  session.onLog = () => {};
  const player = new MoviePlayer(session, () => {});
  player.onLog = () => {};
  return { player, bytes };
}

/**
 * Run the clock until `stop` says so, and report every frame index touched in
 * order. The port advances a self-paced movie from the clock, so a caller ticks
 * it faster than real time — 100 ms a tick clears any authored hold.
 */
function run(player: MoviePlayer, ticks: number, from = 0): number[] {
  const seen: number[] = [];
  let now = from;
  for (let i = 0; i < ticks; i++) {
    now += 100;
    player.tick(now);
    const pos = player.framePos;
    if (seen[seen.length - 1] !== pos) seen.push(pos);
  }
  return seen;
}

test("abandon() releases the script blocked in playmovie()", async () => {
  // #254's third half. A MoviePlayer belongs to a SetViewer, a load builds a new
  // one, and nothing disposes the old — so the film stopped being ticked while
  // the promise `playmovie()` was awaiting stayed pending for ever, and
  // `session.scriptBusy` never came back down.
  const o = open("camelsee.mov");
  if (!o) return;
  const { player } = o;

  let settled = false;
  const film = player.play("camelsee.mov").then(() => (settled = true));
  expect(player.playing).toBe(true);
  await Promise.resolve();
  expect(settled).toBe(false); // still watching

  player.abandon();
  await film;
  expect(settled).toBe(true);
  expect(player.playing).toBe(false);
});

test("abandon() is a no-op when no film is playing", () => {
  const o = open("camelsee.mov");
  if (!o) return;
  // it is called on every load, most of which happen over a room — so the
  // quiet case has to cost nothing rather than throw
  expect(() => o.player.abandon()).not.toThrow();
  expect(o.player.playing).toBe(false);
});

test("camelsee.mov: the horses gallop, and keep galloping", () => {
  const o = open("camelsee.mov");
  if (!o) return;
  const { player, bytes } = o;
  void player.play("camelsee.mov");

  // frame 0 is the still: it has regions and no bit 2, so no amount of clock
  // moves it. This is the half the port already had right.
  expect(player.framePos).toBe(0);
  expect(run(player, 50)).toEqual([0]);
  expect(player.waitingRegions.length).toBe(2);

  // click the horses — frame 0's second region, target "HORSE 2"
  const mov = readMovFile(bytes);
  const start = mov.frames[0].regions.find((r) => r.target === "HORSE 2")!;
  player.click(
    Math.round((start.x0 + start.x1) / 2) + mov.originX,
    Math.round((start.y0 + start.y1) / 2) + mov.originY,
  );
  expect(player.framePos).toBe(2);

  // ...and now it RUNS. Frames 2..41 each carry a skip rect and bit 2, so the
  // clock walks them, and frame 41's backward goto puts playback back on frame
  // 1 — the loop, which the file states nowhere but here.
  const seen = run(player, 400);
  expect(seen[0]).toBe(2);
  expect(seen).toContain(41);
  expect(seen.indexOf(1)).toBeGreaterThan(seen.indexOf(41)); // wrapped
  // it is still going, and it never fell into the stopping tail on its own
  expect(player.playing).toBe(true);
  expect(Math.max(...seen)).toBe(41);
  // more than one lap, to be sure the wrap is a cycle and not a one-off
  expect(seen.filter((p) => p === 41).length).toBeGreaterThan(1);
});

test("camelsee.mov: a click during the gallop takes the phase-matched exit", () => {
  const o = open("camelsee.mov");
  if (!o) return;
  const { player, bytes } = o;
  const mov = readMovFile(bytes);
  void player.play("camelsee.mov");

  const start = mov.frames[0].regions.find((r) => r.target === "HORSE 2")!;
  player.click(
    Math.round((start.x0 + start.x1) / 2) + mov.originX,
    Math.round((start.y0 + start.y1) / 2) + mov.originY,
  );
  run(player, 7); // a little way into the gallop
  const at = player.framePos;
  expect(at).toBeGreaterThan(1);
  expect(at).toBeLessThanOrEqual(43);

  // the running frames' regions are LIVE even though they do not stop for one:
  // the click is honoured, and it lands on the stop frame that matches the legs
  const rect = mov.frames[at].regions[0];
  player.click(
    Math.round((rect.x0 + rect.x1) / 2) + mov.originX,
    Math.round((rect.y0 + rect.y1) / 2) + mov.originY,
  );
  expect(player.framePos).toBe(at + 44);

  // and the tail is regionless, so it plays itself out and ends the movie
  run(player, 400);
  expect(player.playing).toBe(false);
});

// --- the bed, as a rule two players share -----------------------------------

/**
 * The soundtrack used to be computed inside `enterSegment`, against a
 * `GameSession`, which is why the movie editor's preview could only ever be
 * silent: nothing outside a running game could ask what a film sounds like. It
 * moved to `df/mov-sound.ts` when that editor grew a "Play the film" button, and
 * these two assertions are what stops the move from being a rewrite — they are
 * the numbers the comments in that file cite, read off the shipped discs.
 *
 * `seg.file.containers` is how the functions reach the bytes, so a segment is all
 * they need; the player passes the same segments it always did.
 */
function bedOf(name: string, segIdx = 0) {
  const path = gamefiles(gamefilesRoot(), "en").resolve(name);
  if (!path) return null; // no full-game tree installed
  const mov = readMovFile(new Uint8Array(readFileSync(path)));
  const seg = mov.segments[segIdx];
  const audio = segmentAudio(seg);
  if (!audio) throw new Error(`${name} segment ${segIdx} has no bed`);
  const interval = segmentInterval(seg, seg.frames.length, audio.audioSec, segIdx);
  const bed = soundtrackFor(seg, audio, interval, seg.frames.length);
  const order = audio.resampled.reduce((n, c) => n + c.length, 0) / audio.rate;
  return {
    seg,
    audio,
    interval,
    bed,
    order,
    played: bed.samples.length / bed.sampleRate,
  };
}

test("a cutscene's bed is cut from its authored order, with the overrun margin", () => {
  const logo = bedOf("logo.mov", 1);
  if (!logo) return;
  // logo.mov's second segment: 23 loop entries over 4 distinct chunks, so the
  // order holds 156 s of music behind a 318-frame picture worth 22.9 s of them.
  expect(logo.seg.frames.length).toBe(318);
  expect(logo.seg.audioChunks.length).toBe(23);
  expect(logo.audio.unique.length).toBe(4);
  expect(logo.audio.audioSec).toBeCloseTo(22.89, 1);
  expect(logo.order).toBeGreaterThan(150);
  // ...and the film is paced BY that 22.9 s, so what plays is the content plus
  // the margin — not the whole order (which would be 6x the film) and not the
  // bare prediction (which the tick quantisation always overruns).
  expect(logo.interval).toBeCloseTo(72, 0);
  expect(logo.played).toBeCloseTo(logo.audio.audioSec * OVERRUN_MARGIN, 1);
  expect(logo.bed.loop).toBe(true);

  // ocredits.mov is the other side of the same rule: 12 distinct chunks, 72.0 s
  // of content under an 80.9 s picture, so the PREDICTION is the longer of the
  // two and the margin is taken on it. This is the film whose last second went
  // silent when the bed was cut to the prediction exactly.
  const credits = bedOf("ocredits.mov");
  if (!credits) return;
  expect(credits.seg.frames.length).toBe(1225);
  expect(credits.audio.audioSec).toBeCloseTo(71.98, 1);
  const predicted = (credits.interval * credits.seg.frames.length) / 1000;
  expect(predicted).toBeCloseTo(80.85, 1);
  expect(credits.played).toBeCloseTo(predicted * OVERRUN_MARGIN, 1);
  expect(credits.played).toBeGreaterThan(credits.audio.audioSec);
});

test("an interactive film's bed loops, because there is no runtime to cut it to", () => {
  const menu = bedOf("playmode.mov");
  if (!menu) return;
  // the main menu: four frames that wait for a click, and one 8 s chunk listed
  // four times. There is no telling how long the player leaves it up, so the
  // DISTINCT content plays and repeats — the menu sat in silence before it did.
  expect(menu.seg.frames.some((f) => f.regions.length > 0)).toBe(true);
  expect(menu.seg.audioChunks.length).toBe(4);
  expect(menu.audio.unique.length).toBe(1);
  expect(menu.played).toBeCloseTo(menu.audio.audioSec, 3);
  expect(menu.played).toBeCloseTo(7.99, 1);
  expect(menu.bed.loop).toBe(true);
});
