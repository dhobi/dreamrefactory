/**
 * The speedrun clock (#508): the engine's game time, and what stands it still.
 *
 *   npx vitest run engine/tests/speedrun-clock.ts
 *
 * A run is compared by how far the game's clock moved, so the clock must not
 * depend on the machine or the link: a load the engine waits on costs no game
 * time, speedrun time counts ticks rather than milliseconds, speech ends by
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

/** a host on a 60 Hz display: `n` calls, one each 1/60 s after `from` */
const at60 = (s: GameSession, from: number, n: number): number => {
  for (let k = 1; k <= n; k++) s.gameTime(from + (k * 50) / 3);
  return from + (n * 50) / 3;
};

test("speedrun time is one tick (1/60 s) per due tick, however late the host is (#542)", () => {
  const s = session();
  s.gameTime(1000);
  s.nominalTime = true; // stepping starts here, on a whole pass
  const at0 = s.gameNow;
  at60(s, 1000, 60); // a host keeping up: sixty ticks are one second, exactly
  expect(s.gameNow - at0).toBe(1000);
  s.gameTime(4000); // a two-second stall is ONE tick, not 120
  expect(s.gameNow - at0).toBe(1017);
  for (let ms = 4005; ms <= 4100; ms += 5) s.gameTime(ms); // a 200 Hz host gains nothing
  expect(s.gameNow - at0).toBeLessThanOrEqual(1017 + 100);
  expect(s.gameNow - at0).toBeGreaterThanOrEqual(1017 + 83);
  for (let ms = 4125; ms <= 5100; ms += 25) s.gameTime(ms); // a 40 Hz host runs the game slower
  expect(s.gameNow - at0).toBeLessThan(1117 + 700);
});

test("stepped game time is whole milliseconds, and every third tick is a 50 ms pass", () => {
  const s = session();
  s.nominalTime = true;
  s.gameTime(10); // anchored between ticks: it starts on the next one
  const seen = [s.gameNow];
  let t = 10;
  for (let k = 0; k < 9; k++) seen.push(s.gameTime((t += 50 / 3)));
  expect(seen.every(Number.isInteger)).toBe(true);
  expect(seen[3] - seen[0]).toBe(50);
  expect(seen[9] - seen[0]).toBe(150);
});

test("under speedrun time a line of speech is over when its length of game time has gone by", () => {
  const s = session();
  s.nominalTime = true;
  s.gameTime(0);
  const line = { sampleRate: 1000, samples: new Float32Array(300) }; // 300 ms
  const handle = s.audio.play("voice", line);
  expect(s.audio.isDone("voice")).toBe(false);
  const t = at60(s, 0, 15);
  expect(s.audio.isDone("voice")).toBe(false); // 250 ms in
  at60(s, t, 3);
  expect(s.audio.isDone("voice")).toBe(true);
  expect(handle.done).toBe(true); // currentsound() asks the handle: same answer
});

test("under a sheet's clock the game stands still until the runner waits, and stops on the pass the wait is met", () => {
  const s = session();
  s.sheetClock = true;
  s.gameTime(0);
  // before the boot, nothing is the game's yet — the page's own intro is not
  s.sheetHolds.set(9, () => false);
  for (let ms = 50; ms <= 500; ms += 50) s.gameTime(ms);
  expect(s.gameNow).toBe(0);
  s.sheetHolds.delete(9);
  (s as unknown as { coreLoaded: boolean }).coreLoaded = true; // what ensureBooted sets
  for (let ms = 550; ms <= 1000; ms += 50) s.gameTime(ms);
  expect(s.gameNow).toBe(0); // booted, but nobody waiting: nothing moves

  s.sheetHolds.set(1, () => s.gameNow >= 200);
  for (let ms = 1050; ms <= 2000; ms += 50) s.gameTime(ms);
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
    for (let k = 1; k * hostStep <= 1000 + 1e-6; k++) {
      s.gameTime(k * hostStep);
      s.countRun(false);
    }
    for (let k = 1; 1000 + k * hostStep <= 3000 + 1e-6; k++) {
      s.gameTime(1000 + k * hostStep);
      s.countRun(true);
    }
    return s.runMs - from;
  };
  // a machine keeping up (a call every tick) and one managing every other:
  // the slow one runs half the ticks while busy, but the waiting is the
  // player's, so it counts all of it
  expect(busyThenWait(50 / 3)).toBe(1000 + 2000);
  expect(busyThenWait(100 / 3)).toBe(500 + 2000);

  const sheet = session();
  sheet.sheetClock = true;
  (sheet as unknown as { coreLoaded: boolean }).coreLoaded = true;
  sheet.gameTime(0);
  sheet.countRun(true);
  for (let ms = 50; ms <= 2000; ms += 50) {
    sheet.gameTime(ms);
    sheet.countRun(true); // waiting, but for a sheet
  }
  expect(sheet.runMs).toBe(0);
});

test("a standing watch stops the game on the pass it rises, and only its own action runs it until answered", () => {
  const s = session();
  s.sheetClock = true;
  (s as unknown as { coreLoaded: boolean }).coreLoaded = true;
  s.gameTime(0);
  // a line waiting on something far off, and a watch for a film at 300 ms
  s.sheetHolds.set(1, () => s.gameNow >= 5000);
  s.sheetWatches.set(1, { met: () => s.gameNow >= 300, was: false, rose: false });
  for (let ms = 50; ms <= 1000; ms += 50) s.gameTime(ms);
  expect(s.gameNow).toBe(300); // halted on the very pass, however long the runner takes
  expect(s.sheetWatches.get(1)!.rose).toBe(true);

  // the interrupted line's holds neither run the game nor close, even when met
  s.sheetHolds.set(2, () => true);
  s.sheetPasses = 5;
  for (let ms = 1050; ms <= 1500; ms += 50) s.gameTime(ms);
  expect(s.gameNow).toBe(300);
  expect(s.sheetHolds.has(2)).toBe(true);

  // the watch's action does: its own hold, then its own pause
  s.sheetHolds.set(3, () => s.gameNow >= 400);
  s.sheetWatchHolds.add(3);
  for (let ms = 1550; ms <= 2000; ms += 50) s.gameTime(ms);
  expect(s.gameNow).toBe(400);
  s.sheetWatchPasses = 2;
  for (let ms = 2050; ms <= 2500; ms += 50) s.gameTime(ms);
  expect(s.gameNow).toBe(500);

  // answered: the line goes on from where it stood
  s.sheetHalted = false;
  s.sheetWatchHolds.clear();
  s.gameTime(2550);
  expect(s.sheetHolds.has(2)).toBe(false);
  for (let ms = 2600; ms <= 3000; ms += 50) s.gameTime(ms);
  expect(s.gameNow).toBeGreaterThan(500);
});

test("under a sheet's clock a hold does not close while a file is coming, and the runner can tell", async () => {
  const s = session();
  s.sheetClock = true;
  (s as unknown as { coreLoaded: boolean }).coreLoaded = true;
  s.gameTime(0);
  let land!: () => void;
  const loading = s.whileLoading(new Promise<void>((r) => (land = r)));
  s.sheetHolds.set(1, () => true); // met already, but the screen is half-loaded
  for (let ms = 50; ms <= 500; ms += 50) s.gameTime(ms);
  expect(s.loadingFiles).toBe(true);
  expect(s.sheetHolds.has(1)).toBe(true);
  expect(s.gameNow).toBe(0);
  land();
  await loading;
  expect(s.loadingFiles).toBe(false);
  s.gameTime(550);
  expect(s.sheetHolds.has(1)).toBe(false); // closed before any pass ran
  expect(s.gameNow).toBe(0);
});

test("a sleep counts ticks, so it lasts the same wherever the ticks fall (#542)", async () => {
  // ten ticks of fade (166.67 ms) span 166 or 167 whole ms by where they start
  const lengths: number[] = [];
  for (let offset = 0; offset < 3; offset++) {
    const s = session();
    s.nominalTime = true;
    let t = at60(s, 0, 0);
    s.gameTime(t);
    t = at60(s, t, offset); // start none, one or two ticks in
    s.tickTime(s.gameNow);
    const from = s.gameNow;
    let woke = -1;
    void s.clock.sleep((10 * 50) / 3).then(() => (woke = s.gameNow));
    for (let k = 0; k < 12 && woke < 0; k++) {
      t = at60(s, t, 1);
      s.tickTime(s.gameNow);
      await Promise.resolve();
    }
    lengths.push(Math.round(((woke - from) * 3) / 50));
  }
  expect(lengths).toEqual([10, 10, 10]);
});

test("the first frame after the game stood still runs no tick (#542)", () => {
  const s = session();
  s.sheetClock = true;
  (s as unknown as { coreLoaded: boolean }).coreLoaded = true;
  s.gameTime(0);
  for (let ms = 0; ms <= 500; ms += 50) s.gameTime(ms); // standing still
  s.sheetPasses = 1;
  s.gameTime(550); // the frame the runner's input lands in
  expect(s.gameNow).toBe(0);
  at60(s, 550, 3);
  expect(s.gameNow).toBe(50);
});

test("a poll under speedrun time goes on after the next tick, not the next refresh (#542)", async () => {
  const s = session();
  s.sheetClock = true;
  (s as unknown as { coreLoaded: boolean }).coreLoaded = true;
  s.gameTime(0);
  let woke = false;
  void s.frameWait().then(() => (woke = true));
  for (let ms = 50; ms <= 200; ms += 50) s.gameTime(ms); // refreshes, the game standing still
  await Promise.resolve();
  expect(woke).toBe(false);
  s.sheetPasses = 1;
  s.gameTime(250); // resumes: no tick yet
  await Promise.resolve();
  expect(woke).toBe(false);
  s.gameTime(250 + 50 / 3);
  await Promise.resolve();
  expect(woke).toBe(true);
});

test("two loops on one channel do not replace each other under speedrun time (#542)", () => {
  // compared by which play it was, each loop read the other as its replacement,
  // called itself done, and was started again every tick — the sinking's deck
  // loop stacked 270 copies deep
  const s = session();
  s.nominalTime = true;
  s.gameTime(0);
  const clip = { sampleRate: 1000, samples: new Float32Array(500) };
  const first = s.audio.play("sound", clip, { loop: true });
  const second = s.audio.play("sound", clip, { loop: true });
  at60(s, 0, 120);
  expect(first.done).toBe(false);
  expect(second.done).toBe(false);
});
