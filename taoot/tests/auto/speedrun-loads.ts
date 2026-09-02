/**
 * The load remover: a run's clock stops while the game is downloading
 * ([#251](https://github.com/dhobi/dreamrefactory/issues/251)).
 *
 *   npx vitest run taoot/tests/auto/speedrun-loads.ts
 *
 * A speedrun timer measures a route. This port's route is played in a browser
 * where every room is a fetch, so a plain wall clock measures the route AND the
 * link it arrived over: the same sheet against a cold cache and a warm one is
 * minutes apart with not one gesture changed. PC speedruns answered this long
 * ago with a load remover — the timer reads a value the game sets while it loads
 * and declines to count that time — and the port has the same value to read,
 * because every byte comes through one place and that place already knows when
 * it is waiting (`FileStore.onBusy`).
 *
 * Three pieces, tested at the seams between them rather than through a browser:
 *
 *   1. the fetcher SAYS when the wire is busy, to as many watchers as ask —
 *      the busy mark on the canvas was the first and is not the last;
 *   2. {@link LoadClock} turns those edges into a total, which is the one piece
 *      with arithmetic worth getting wrong: overlapping fetches are one wait,
 *      and the fetch still in the air counts;
 *   3. the run loop subtracts that total from every leg it reports, and says
 *      what it subtracted.
 *
 * The clock is driven by hand throughout — `LoadClock` takes its `now`, and the
 * runner is given a scripted driver. What is being pinned is arithmetic across
 * overlapping intervals, and a test that had to wait for real milliseconds to
 * pass could neither state the case nor tell a wrong answer from a slow machine.
 */
import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { LoadClock } from "../../src/load-clock";
import { FileStore } from "../../src/files";
import { parseSheet } from "../../src/speedrun/sheet";
import { VERBS } from "../../src/speedrun/actions";
import { runSheet } from "../../src/speedrun/runner";
import type { Clock, SpeedrunDriver } from "../../src/speedrun/driver";

/* ------------------------------------------------------------------ *
 * 1. The clock's arithmetic
 * ------------------------------------------------------------------ */

/** a `LoadClock` whose `now` is a variable this test moves */
function stopwatch(): { clock: LoadClock; at: (ms: number) => void } {
  let now = 0;
  return { clock: new LoadClock(() => now), at: (ms) => void (now = ms) };
}

test("a quiet wire costs nothing (#251)", () => {
  const { clock, at } = stopwatch();
  at(5_000);
  expect(clock.ms).toBe(0);
  expect(clock.waiting).toBe(false);
  // told about a change to zero without ever having been busy: not an edge
  clock.busy(0);
  at(9_000);
  expect(clock.ms).toBe(0);
});

test("one fetch costs exactly as long as it was in the air (#251)", () => {
  const { clock, at } = stopwatch();
  at(1_000);
  clock.busy(1);
  at(1_250);
  clock.busy(0);
  at(9_000);
  expect(clock.ms).toBe(250);
  expect(clock.waiting).toBe(false);
});

test("six fetches at once are ONE wait, not six (#251)", () => {
  // A changeset has the room, its siblings and its casts in the air together:
  // the game is blocked until the last of them lands, so the wait is the span
  // the wire was busy. Adding the six durations up would remove more time from
  // the run than the run actually spent, and a route can only be measured
  // against another route if the removal cannot exceed the wall clock.
  const { clock, at } = stopwatch();
  at(0);
  clock.busy(1);
  at(100);
  clock.busy(2);
  at(200);
  clock.busy(3);
  at(900);
  clock.busy(2);
  at(950);
  clock.busy(1);
  at(1_000);
  clock.busy(0);
  expect(clock.ms).toBe(1_000);
});

test("the reading includes the fetch still in the air (#251)", () => {
  // The reason this matters is a clock that would otherwise go BACKWARDS: a
  // reading taken during `leave.mov` that counted only finished fetches would
  // say the run had spent nothing on it, so the timer would tick through the
  // download and then jump back when it landed.
  const { clock, at } = stopwatch();
  at(1_000);
  clock.busy(1);
  at(1_600);
  expect(clock.ms).toBe(600);
  expect(clock.waiting).toBe(true);
  at(2_000);
  expect(clock.ms).toBe(1_000);
  clock.busy(0);
  expect(clock.ms).toBe(1_000);
});

test("the total only ever goes up, so a duration is a difference (#251)", () => {
  // What every reader of this clock does is subtract two readings — the page's
  // stopwatch, and the runner at the top and bottom of every action. So it is
  // never reset and never armed: there is nothing to forget to do before a run,
  // and a second run of the same sheet needs no more setup than the first.
  const { clock, at } = stopwatch();
  const readings: number[] = [];
  for (const [t, n] of [[0, 1], [50, 0], [100, 2], [180, 0], [200, 1]] as const) {
    at(t);
    clock.busy(n);
    readings.push(clock.ms);
  }
  expect(readings).toEqual([0, 50, 50, 130, 130]);
  expect([...readings].sort((a, b) => a - b)).toEqual(readings);
});

/* ------------------------------------------------------------------ *
 * 2. The fetcher's watchers
 * ------------------------------------------------------------------ */

let fetched: string[] = [];

beforeEach(() => {
  fetched = [];
  vi.stubGlobal("fetch", async (url: string) => {
    fetched.push(url);
    return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as unknown as Response;
  });
});
afterEach(() => vi.unstubAllGlobals());

/**
 * A store with one file the dev server could serve.
 *
 * Registered outside any edition tree (no `en/` in the path), which resolves
 * under the store's default edition — the language axis is somebody else's test
 * (taoot/tests/auto/files-lang.ts) and all this one needs is a basename that
 * fetches.
 */
function newStore(): FileStore {
  const files = new FileStore();
  files.registerServerFile("bedsit1.set", "/gamefiles/TITANIC1/data/bedsit1.set");
  return files;
}

test("the wire is reported to every watcher, not just the last one to ask (#251)", async () => {
  // The point of the change: `onBusyChange` was one assignable slot, and the
  // busy mark on the canvas had it. A load remover under that shape could only
  // have got the edges by taking them away from the mark and forwarding them by
  // hand — two features in one closure, neither able to be read on its own.
  const files = newStore();
  const mark: number[] = [];
  const remover: number[] = [];
  files.onBusy((n) => mark.push(n));
  files.onBusy((n) => remover.push(n));

  await files.load("bedsit1.set");

  expect(mark).toEqual([1, 0]);
  expect(remover).toEqual([1, 0]);
});

test("a watcher can stop watching (#251)", async () => {
  const files = newStore();
  const seen: number[] = [];
  const stop = files.onBusy((n) => seen.push(n));
  await files.load("bedsit1.set");
  stop();
  // a second file, so there is a fetch to miss (the first is cached now)
  files.registerServerFile("gstair2.set", "/gamefiles/TITANIC1/data/gstair2.set");
  await files.load("gstair2.set");
  expect(seen).toEqual([1, 0]);
  expect(fetched).toHaveLength(2);
});

test("a watcher that throws does not take the fetch down with it (#251)", async () => {
  // A watcher is somebody's readout. A `load` that failed because a progress bar
  // threw would be the tail wagging the dog — and the game would be missing a
  // room over it.
  const files = newStore();
  const seen: number[] = [];
  files.onBusy(() => {
    throw new Error("the readout is broken");
  });
  files.onBusy((n) => seen.push(n));
  await expect(files.load("bedsit1.set")).resolves.toEqual(new Uint8Array([1, 2, 3]));
  expect(seen).toEqual([1, 0]);
});

test("a cache hit is not a load, and is not reported as one (#251)", async () => {
  // The whole feature turns on this: what is removed is time on the WIRE. A
  // store that reported a busy edge for a file it already had would remove time
  // the run never spent waiting, and a warmed run would come out faster than it
  // was rather than merely honest.
  const files = newStore();
  await files.load("bedsit1.set");
  const seen: number[] = [];
  files.onBusy((n) => seen.push(n));
  await files.load("bedsit1.set");
  expect(seen).toEqual([]);
  expect(fetched).toHaveLength(1);
});

test("the store's edges drive the clock end to end (#251)", async () => {
  // The two halves wired the way `main.ts` wires them, with time by hand: what
  // is being checked is that the shapes fit — the count the store reports is the
  // argument the clock takes — rather than any arithmetic, which is above.
  const files = newStore();
  let now = 0;
  const clock = new LoadClock(() => now);
  files.onBusy((n) => clock.busy(n));

  vi.stubGlobal("fetch", async () => {
    now += 400; // the fetch took 400 ms
    return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer } as unknown as Response;
  });
  await files.load("bedsit1.set");
  now += 1_000; // ...and the game then played for a second

  expect(clock.ms).toBe(400);
  expect(clock.waiting).toBe(false);
});

/* ------------------------------------------------------------------ *
 * 3. The run loop
 * ------------------------------------------------------------------ */

/** what one scripted press costs: wall ms, and how much of it was the wire */
interface Press {
  ms: number;
  loading?: number;
}

/**
 * A driver that presses nothing and only moves the clock.
 *
 * The run loop's whole part in the load remover is arithmetic over the readings
 * a driver hands it, so the readings are scripted: press N costs `ms` of wall
 * time of which `loading` was spent on the network. A real browser cannot state
 * that case — you would have to arrange for a room to be slow to fetch — and
 * could not assert the answer to the millisecond if it did.
 */
function scripted(presses: Press[]): { d: SpeedrunDriver; wall: () => number } {
  let wall = 10_000; // not zero, so a bare reading cannot pass for a difference
  let loading = 3_000; // nor is the wire's total ever zero at the start of a run
  let pressed = 0;
  const d = {
    clock: async (): Promise<Clock> => ({ ms: wall, frames: 0, loading }),
    key: async (): Promise<void> => {
      const p = presses[pressed++] ?? { ms: 0 };
      wall += p.ms;
      loading += p.loading ?? 0;
    },
    padded: () => 0,
    sleep: async (): Promise<void> => {},
    evaluate: async (): Promise<never> => {
      throw new Error("the scripted driver evaluates nothing");
    },
  };
  return { d: d as unknown as SpeedrunDriver, wall: () => wall };
}

const sheet = (text: string) => parseSheet(text, { verbs: VERBS });

/** three presses with a split after the first, and every press confirmed by
 *  nothing — `confirm: no` is what makes `left()` a bare `d.key` */
const THREE = sheet(
  "left(confirm: no)\nsplit(first leg)\nleft(confirm: no)\nleft(confirm: no)",
);

test("a run's time is the wall clock less the downloading (#251)", async () => {
  const { d } = scripted([{ ms: 1_000 }, { ms: 5_000, loading: 4_500 }, { ms: 500 }]);
  const r = await runSheet(d, THREE);

  // 6.5 s of wall clock, 4.5 s of it on the wire
  expect(r.total.ms).toBe(2_000);
  expect(r.total.loading).toBe(4_500);
  // ...and the wall clock is still recoverable, exactly, from the two of them
  expect(r.total.ms + r.total.loading).toBe(6_500);
});

test("the removal is charged to the leg that did the waiting (#251)", async () => {
  const { d } = scripted([{ ms: 1_000 }, { ms: 5_000, loading: 4_500 }, { ms: 500 }]);
  const r = await runSheet(d, THREE);

  expect(r.splits.map((s) => s.name)).toEqual(["first leg", "(final)"]);
  // the first leg downloaded nothing; the second is two presses, one of which
  // was mostly a download
  expect(r.splits.map((s) => [s.ms, s.loading])).toEqual([
    [1_000, 0],
    [1_000, 4_500],
  ]);
  // and the legs still add up to the total, which is the property the page's
  // `elapsed` column is printed from
  expect(r.splits.reduce((n, s) => n + s.ms, 0)).toBe(r.total.ms);
  expect(r.splits.reduce((n, s) => n + s.loading, 0)).toBe(r.total.loading);
});

test("every action says what it removed, so the tuning list is honest (#251)", async () => {
  // The slowest-actions list is sorted on the load-removed time, which is the
  // right sort — a step that is slow because it fetches a 37 MB film is not a
  // step to tune — and that is only readable if the row can still say where the
  // film went.
  const { d } = scripted([{ ms: 1_000 }, { ms: 5_000, loading: 4_500 }, { ms: 500 }]);
  const r = await runSheet(d, THREE);

  expect(r.timings.map((t) => [t.ms, t.loading])).toEqual([
    [1_000, 0],
    [500, 4_500],
    [500, 0],
  ]);
});

test("a fetch spanning two actions is split between them, not double-counted (#251)", async () => {
  // The engine's background fetches (`FileStore.provide` on a miss) do not
  // respect a sheet's lines: one can begin under `up()` and land under the
  // `wait` after it. Because the clock is a monotonic TOTAL and each leg takes a
  // difference of two readings, each leg is charged the part of the wait that
  // happened inside it — and the sum is still the whole wait, once.
  const { d } = scripted([
    { ms: 1_000, loading: 600 }, // a fetch began 600 ms before this press ended
    { ms: 1_000, loading: 400 }, // ...and landed 400 ms into the next one
  ]);
  const r = await runSheet(d, sheet("left(confirm: no)\nsplit(a)\nleft(confirm: no)"));

  expect(r.timings.map((t) => t.loading)).toEqual([600, 400]);
  expect(r.total.loading).toBe(1_000);
  expect(r.total.ms).toBe(1_000);
});

test("a clock that jumps cannot produce a negative leg (#251)", async () => {
  // Not reachable from the arithmetic — the wire's total is a subset of the wall
  // clock either way — but reachable from the wall clock itself: the Playwright
  // driver reads `Date.now`, which a system clock stepping backwards can move by
  // anything. A negative leg would be read as a measurement rather than as the
  // artefact it is, and it would make the splits stop adding up to the total.
  const { d } = scripted([{ ms: -5_000 }, { ms: 1_000 }]);
  const r = await runSheet(d, sheet("left(confirm: no)\nleft(confirm: no)"));

  expect(r.timings.map((t) => t.ms)).toEqual([0, 1_000]);
  expect(r.total.ms).toBe(0);
});
