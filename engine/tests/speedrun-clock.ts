/**
 * The speedrun clock (#508): the engine's game time, and what stands it still.
 *
 *   npx vitest run engine/tests/speedrun-clock.ts
 *
 * A run is compared by how far the game's clock moved, so the clock must not
 * depend on the machine or the link: a load the engine waits on costs no game
 * time, speedrun time counts passes rather than milliseconds, speech ends by
 * its own length, and under a sheet's clock the game runs only while the
 * runner waits on it — stopping on the very pass the runner's condition holds.
 */
import { expect, test } from "vitest";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";

const session = (): GameSession => new GameSession(() => null, new NullAudioSink());

test("a load the engine waits on costs no game time, and time goes on afterwards", async () => {
  const s = session();
  expect(s.gameTime(1000)).toBe(1000);
  let land!: () => void;
  const loading = s.whileLoading(new Promise<void>((r) => (land = r)));
  expect(s.gameTime(1100)).toBe(1000);
  expect(s.gameTime(3000)).toBe(1000); // two seconds on the wire
  land();
  await loading;
  expect(s.gameTime(3050)).toBe(1050); // and on again from where it stood
});

test("speedrun time is one 50 ms pass per due pass, however late the host is", () => {
  const s = session();
  s.nominalTime = true;
  s.gameTime(1000); // anchor
  const at0 = s.gameNow;
  for (let ms = 1050; ms <= 2000; ms += 50) s.gameTime(ms); // a host keeping up
  expect(s.gameNow - at0).toBe(1000);
  s.gameTime(4000); // a two-second stall is ONE pass, not forty
  expect(s.gameNow - at0).toBe(1050);
  for (let ms = 4010; ms <= 4200; ms += 10) s.gameTime(ms); // a 100 Hz host gains nothing
  expect(s.gameNow - at0).toBe(1050 + 4 * 50);
});

test("under speedrun time a line of speech is over when its length of game time has gone by", () => {
  const s = session();
  s.nominalTime = true;
  s.gameTime(0);
  s.gameTime(50);
  const line = { sampleRate: 1000, samples: new Float32Array(300) }; // 300 ms
  const handle = s.audio.play("voice", line);
  expect(s.audio.isDone("voice")).toBe(false);
  for (let ms = 100; ms <= 300; ms += 50) s.gameTime(ms);
  expect(s.audio.isDone("voice")).toBe(false); // 250 ms in
  s.gameTime(350);
  expect(s.audio.isDone("voice")).toBe(true);
  expect(handle.done).toBe(true); // currentsound() asks the handle: same answer
});

test("under a sheet's clock the game stands still until the runner waits, and stops on the pass the wait is met", () => {
  const s = session();
  s.sheetClock = true;
  s.gameTime(0);
  for (let ms = 50; ms <= 500; ms += 50) s.gameTime(ms);
  expect(s.gameNow).toBe(0); // nobody waiting: nothing moves

  s.sheetHolds.set(1, () => s.gameNow >= 200);
  for (let ms = 550; ms <= 2000; ms += 50) s.gameTime(ms);
  expect(s.gameNow).toBe(200); // exactly where the condition came true, not a pass more
  expect(s.sheetHolds.has(1)).toBe(false);

  s.sheetPasses = 3; // a pause between presses: three passes, then still again
  for (let ms = 2050; ms <= 3000; ms += 50) s.gameTime(ms);
  expect(s.gameNow).toBe(350);
});

test("a person's waiting counts in real time on any machine, the game's busy time in passes, a sheet's waiting not at all", () => {
  const busyThenWait = (hostStep: number): number => {
    const s = session();
    s.nominalTime = true;
    s.gameTime(0);
    s.countRun(false);
    const from = s.runMs;
    // one second of the game busy, then two seconds of the player thinking
    for (let ms = hostStep; ms <= 1000; ms += hostStep) {
      s.gameTime(ms);
      s.countRun(false);
    }
    for (let ms = 1000 + hostStep; ms <= 3000; ms += hostStep) {
      s.gameTime(ms);
      s.countRun(true);
    }
    return s.runMs - from;
  };
  // a machine keeping up (a call every 50 ms) and one managing every 100 ms:
  // the slow one runs half the passes while busy, but the waiting is the
  // player's, so it counts all of it
  expect(busyThenWait(50)).toBe(1000 + 2000);
  expect(busyThenWait(100)).toBe(500 + 2000);

  const sheet = session();
  sheet.sheetClock = true;
  sheet.gameTime(0);
  sheet.countRun(true);
  for (let ms = 50; ms <= 2000; ms += 50) {
    sheet.gameTime(ms);
    sheet.countRun(true); // waiting, but for a sheet
  }
  expect(sheet.runMs).toBe(0);
});
