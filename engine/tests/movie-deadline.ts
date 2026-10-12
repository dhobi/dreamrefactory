/**
 * MOV frame deadline continuation (logic flag bit 3).
 *
 * The movie loop does not rebase every frame on the host tick. With bit 3 set,
 * the next hold is scheduled from the previous authored deadline, so a late
 * render/service pass does not become permanent drift.
 *
 * No game files: the MOV is built with the engine's own writer and played by
 * the real MoviePlayer.
 */
import { test, expect } from "vitest";
import { buildMovBytes } from "@dreamfactory/engine/df/mov-build";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { MoviePlayer } from "@dreamfactory/engine/web/movie-player";

const FILE = "deadline.mov";
const PALETTE = new Uint8Array([
  0, 0, 0,
  255, 255, 255,
]);

function openMovie(flags: number[], target = "", holds = [0, 0, 0, 0], ticked = false): MoviePlayer {
  const pixels = new Uint8Array(4).fill(1);
  const bytes = buildMovBytes({
    palette: PALETTE,
    width: 2,
    height: 2,
    minHoldTicks: 4, // 4 * 50/3 = 66.666... ms
    frames: [
      { name: "f0", art: pixels.slice(), type: 6, flags: flags[0], holdTicks: holds[0] },
      { name: "f1", art: pixels.slice(), type: target ? 2 : 6, target, flags: flags[1], holdTicks: holds[1] },
      { name: "f2", art: pixels.slice(), type: 6, flags: flags[2] },
      { name: "f3", art: pixels.slice(), type: 1, flags: flags[3] },
    ],
  });
  const session = new GameSession(
    (name) => (name.toLowerCase() === FILE ? bytes : null),
    new NullAudioSink(),
  );
  session.onLog = () => {};
  session.clock.ticked = ticked;
  const player = new MoviePlayer(session, () => {});
  player.onLog = () => {};
  void player.play(FILE);
  return player;
}

test("incoming continuation flag preserves the prior deadline", () => {
  const player = openMovie([0, 8, 0, 0]);
  player.tick(100); player.tick(200); player.tick(250);
  expect(player.framePos).toBe(2);
});
test("incoming clear flag resets the deadline even after a continuation frame", () => {
  const player = openMovie([8, 0, 0, 0]);
  player.tick(100); player.tick(200); player.tick(250);
  expect(player.framePos).toBe(1);
});

test("V4 entry at timestamp zero does not restart the clock", () => {
  const player = openMovie([0, 8, 8, 0]);
  player.tick(0); player.tick(50);
  expect(player.framePos).toBe(0);
  player.tick(70);
  expect(player.framePos).toBe(1);
});
test("same continuation flags preserve the authored clock", () => {
  const player = openMovie([8, 8, 8, 0]);
  player.tick(100); player.tick(200); player.tick(250);
  expect(player.framePos).toBe(2);
});
test("same clear flags rebase on frame entry", () => {
  const player = openMovie([0, 0, 0, 0]);
  player.tick(100); player.tick(200); player.tick(250);
  expect(player.framePos).toBe(1);
  player.tick(270);
  expect(player.framePos).toBe(2);
});

test("a nonsequential goto uses its actual destination flag", () => {
  const player = openMovie([0, 8, 8, 0], "f3");
  player.tick(100); player.tick(200); player.tick(250);
  expect(player.framePos).toBe(3);
  player.tick(310);
  expect(player.framePos).toBe(3);
  player.tick(320);
  expect(player.playing).toBe(false);
});
test("TI frame zero rebases on a backward goto even with bit 3 set", () => {
  const player = openMovie([8, 8, 0, 0], "f0");
  player.tick(100); player.tick(200); player.tick(250);
  expect(player.framePos).toBe(0);
  player.tick(310);
  expect(player.framePos).toBe(0);
});
test("the selected frame uses its own longer authored hold", () => {
  const player = openMovie([0, 8, 0, 0], "", [0, 8, 0, 0]);
  player.tick(100); player.tick(200); player.tick(299);
  expect(player.framePos).toBe(1);
  player.tick(301);
  expect(player.framePos).toBe(2);
});

test("under stepped time the running deadline is kept in ticks (#542)", () => {
  const player = openMovie([0, 8, 8, 0], "", [0, 0, 0, 0], true);
  player.tick(0); // frame 0: deadline tick 4
  player.tick(100); // tick 6, late: frame 1, deadline 4 + 4 = tick 8, not 6 + 4
  expect(player.framePos).toBe(1);
  player.tick(134); // tick 8
  expect(player.framePos).toBe(2);
});
