/**
 * The load remover: a run's clock stops while the game is DOWNLOADING
 * ([#251](https://github.com/dhobi/dreamrefactory/issues/251),
 * [#369](https://github.com/dhobi/dreamrefactory/issues/369)).
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
 * it is waiting (`FileStore.onWire`).
 *
 * **What counts as loading is the NETWORK and nothing else** (#369). The first
 * version stopped the clock for every fetch, and that removed time the run
 * really did spend: a file already in the browser's memory or disk cache is not
 * a download, it is a read of the kind the original did off a CD every time it
 * opened a room, and the original's clock counted those. So a cache hit costs a
 * route nothing and is removed from nothing.
 *
 * Three pieces, tested at the seams between them rather than through a browser:
 *
 *   1. the fetcher ANNOUNCES each fetch, by URL, as it starts and ends — the
 *      busy mark on the canvas wants the count, the load remover wants the
 *      fetches themselves;
 *   2. {@link LoadClock} turns those into a total, and it is the piece with
 *      arithmetic worth getting wrong: overlapping downloads are one wait, the
 *      download still in the air counts, and a cache hit counts for nothing;
 *   3. the run loop subtracts that total from every leg it reports, and says
 *      what it subtracted.
 *
 * The clock is driven by hand throughout — `LoadClock` takes its `now` and its
 * verdict, and the runner is given a scripted driver. What is being pinned is
 * arithmetic across overlapping intervals, and a test that had to wait for real
 * milliseconds to pass could neither state the case nor tell a wrong answer from
 * a slow machine.
 */
import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { CACHE_GRACE_MS, LoadClock, unionMs, type Served } from "../../src/load-clock";
import { FileStore } from "../../src/files";
import { parseSheet } from "../../src/speedrun/sheet";
import { VERBS } from "../../src/speedrun/actions";
import { runSheet } from "../../src/speedrun/runner";
import type { Clock, SpeedrunDriver } from "../../src/speedrun/driver";

/* ------------------------------------------------------------------ *
 * 1. The clock's arithmetic
 * ------------------------------------------------------------------ */

/**
 * A `LoadClock` whose clock and whose verdicts this test owns.
 *
 * `served` answers per URL, so a case can put a download and a cache hit in the
 * air together — which is the case the union arithmetic exists for.
 */
function stopwatch(verdicts: Record<string, Served | null> = {}) {
  let now = 0;
  const clock = new LoadClock({
    now: () => now,
    served: (url) => verdicts[url] ?? null,
  });
  return {
    clock,
    at: (ms: number) => void (now = ms),
    /** the default: nothing the browser will classify, so duration decides */
    say: (url: string, how: Served | null) => void (verdicts[url] = how),
  };
}

/** a download and a cache hit, named so the verdicts read as English */
const NET = "gamefiles/bedsit1.set";
const HIT = "gamefiles/gstair2.set";

test("overlap is counted once, however many files are in the air (#251)", () => {
  // A changeset has the room, its siblings and its casts in the air together:
  // the game is blocked until the last of them lands, so the wait is the stretch
  // the wire was busy. Adding the spans up would remove more time from the run
  // than the run actually spent.
  expect(unionMs([{ from: 0, to: 100 }, { from: 50, to: 150 }])).toBe(150);
  expect(unionMs([{ from: 0, to: 100 }, { from: 0, to: 40 }])).toBe(100);
  // ...and a gap between two of them is not part of either
  expect(unionMs([{ from: 0, to: 100 }, { from: 200, to: 250 }])).toBe(150);
  expect(unionMs([])).toBe(0);
  // out of order in, right answer out — the store announces fetches as they
  // FINISH, which is not the order they started in
  expect(unionMs([{ from: 200, to: 250 }, { from: 0, to: 100 }])).toBe(150);
});

test("a quiet wire costs nothing (#251)", () => {
  const { clock, at } = stopwatch();
  at(5_000);
  expect(clock.ms).toBe(0);
  expect(clock.waiting).toBe(false);
  // an end for a fetch nobody announced is ignored rather than guessed at
  clock.end(99);
  at(9_000);
  expect(clock.ms).toBe(0);
});

test("a download costs exactly as long as it was in the air (#251)", () => {
  const { clock, at, say } = stopwatch();
  say(NET, "network");
  at(1_000);
  clock.begin(1, NET);
  at(1_250);
  clock.end(1);
  at(9_000);
  expect(clock.ms).toBe(250);
  expect(clock.waiting).toBe(false);
});

test("a CACHE HIT is a read, not a download, and costs the route nothing (#369)", () => {
  // The whole of #369. A file already in the browser's cache is not on the wire
  // — the original read the same bytes off a CD, on its own clock — so a run
  // over a warm cache has nothing removed from it at all.
  const { clock, at, say } = stopwatch();
  say(HIT, "cache");
  at(1_000);
  clock.begin(1, HIT);
  at(1_300); // a slow read off a warm disk, and still not a download
  clock.end(1);
  expect(clock.ms).toBe(0);
});

test("a download and a cache hit together remove only the download (#369)", () => {
  const { clock, at, say } = stopwatch();
  say(NET, "network");
  say(HIT, "cache");
  at(0);
  clock.begin(1, HIT);
  clock.begin(2, NET);
  at(20);
  clock.end(1); // the cache hit lands almost at once
  at(500);
  clock.end(2); // the download takes half a second
  expect(clock.ms).toBe(500);
});

test("six downloads at once are ONE wait, not six (#251)", () => {
  const { clock, at, say } = stopwatch();
  for (let i = 1; i <= 3; i++) say(`f${i}`, "network");
  at(0);
  clock.begin(1, "f1");
  at(100);
  clock.begin(2, "f2");
  at(200);
  clock.begin(3, "f3");
  at(900);
  clock.end(1);
  at(950);
  clock.end(2);
  at(1_000);
  clock.end(3);
  expect(clock.ms).toBe(1_000);
});

test("the download still in the air counts, once it has outlived a cache (#251, #369)", () => {
  // The reason this matters is a clock that would otherwise go BACKWARDS: a
  // reading taken during `leave.mov` that counted only finished fetches would
  // say the run had spent nothing on it, so the timer would tick through the
  // download and then jump back when it landed.
  //
  // It cannot start counting at once, though — whether a fetch went to the
  // network is only known when it ends — so the grace is the floor: nothing
  // pauses the clock before it, and the whole span is credited after.
  const { clock, at, say } = stopwatch();
  say(NET, "network");
  at(1_000);
  clock.begin(1, NET);
  at(1_000 + CACHE_GRACE_MS);
  expect(clock.ms, "a cache could still have answered by now").toBe(0);
  expect(clock.waiting).toBe(true);
  at(2_000);
  expect(clock.ms).toBe(1_000 - CACHE_GRACE_MS);
  clock.end(1);
  expect(clock.ms, "and the whole span is credited when it lands").toBe(1_000);
});

test("a warm changeset never stops the clock at all (#369)", () => {
  // Twelve cache hits, one after another, all inside the grace: the reading
  // never moves and the workbench's stopwatch never says LOADING. This is the
  // state a route should be tuned in.
  const { clock, at, say } = stopwatch();
  let now = 0;
  for (let i = 1; i <= 12; i++) {
    say(`hit${i}`, "cache");
    clock.begin(i, `hit${i}`);
    now += 2;
    at(now);
  }
  expect(clock.waiting).toBe(false);
  for (let i = 1; i <= 12; i++) {
    clock.end(i);
    now += 1;
    at(now);
  }
  expect(clock.ms).toBe(0);
});

test("a read off THIS machine is a disk read, not a download (#369)", () => {
  // A dev-server fetch on loopback transfers bytes as far as the browser is
  // concerned — Vite serves `gamefiles/` with no caching headers, so a reload
  // fetches the same 217 KB again — but nothing crossed a link, and how long a
  // disk takes is a fact about the reader's machine. Counting it made the
  // workbench's times come out faster than the runner's on the same route,
  // which is what #369 reported.
  const { clock, at, say } = stopwatch();
  say("http://localhost:5175/gamefiles/bedsit1.set", "local");
  at(0);
  clock.begin(1, "http://localhost:5175/gamefiles/bedsit1.set");
  at(600);
  clock.end(1);
  expect(clock.ms).toBe(0);
});

test("where the browser will not say, duration decides (#369)", () => {
  // A dropped Resource Timing entry, or a browser too old for the field. Nothing
  // served out of RAM or off a local disk takes CACHE_GRACE_MS; no round trip is
  // quicker.
  const quick = stopwatch();
  quick.at(0);
  quick.clock.begin(1, "unknown");
  quick.at(CACHE_GRACE_MS - 1);
  quick.clock.end(1);
  expect(quick.clock.ms, "quick enough to have been a cache").toBe(0);

  const slow = stopwatch();
  slow.at(0);
  slow.clock.begin(1, "unknown");
  slow.at(CACHE_GRACE_MS + 400);
  slow.clock.end(1);
  expect(slow.clock.ms, "too slow to have been anything else").toBe(CACHE_GRACE_MS + 400);
});

test("the total only ever goes up, so a duration is a difference (#251)", () => {
  // What every reader of this clock does is subtract two readings — the page's
  // stopwatch, and the runner at the top and bottom of every action — and
  // `time + load = wall clock` is what makes the removal checkable. A total that
  // could go DOWN would break both: a leg would come out longer than the wall
  // clock it happened in. So a period that turns out to have been all cache
  // keeps whatever it had already shown, rather than refunding it.
  const { clock, at, say } = stopwatch();
  say(NET, "network");
  say(HIT, "cache");
  const readings: number[] = [];
  at(0);
  clock.begin(1, NET);
  for (const t of [100, 300, 600]) {
    at(t);
    readings.push(clock.ms);
  }
  clock.end(1);
  readings.push(clock.ms);
  // ...and now a long stretch of cache hits, which must not take any of it back
  at(1_000);
  clock.begin(2, HIT);
  at(1_400);
  readings.push(clock.ms);
  clock.end(2);
  readings.push(clock.ms);
  expect([...readings].sort((a, b) => a - b)).toEqual(readings);
  expect(readings.at(-1)).toBeGreaterThanOrEqual(600);
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
  const remover: string[] = [];
  files.onWire((e) => mark.push(e.inFlight));
  files.onWire((e) => remover.push(`${e.done ? "end" : "begin"} ${e.url}`));

  await files.load("bedsit1.set");

  expect(mark).toEqual([1, 0]);
  // ...and the second watcher gets what the count cannot tell it: WHICH file,
  // which is what the browser is asked about to classify it (#369)
  expect(remover).toEqual([
    "begin /gamefiles/TITANIC1/data/bedsit1.set",
    "end /gamefiles/TITANIC1/data/bedsit1.set",
  ]);
});

test("a fetch's end carries the id its start was given (#369)", async () => {
  // The clock keeps one span per fetch, so an end has to name which. Ids rather
  // than URLs, because the same basename can be in the air twice over a reload.
  const files = newStore();
  const seen: { id: number; done: boolean }[] = [];
  files.onWire((e) => seen.push({ id: e.id, done: e.done }));
  await files.load("bedsit1.set");
  files.registerServerFile("gstair2.set", "/gamefiles/TITANIC1/data/gstair2.set");
  await files.load("gstair2.set");
  expect(seen).toEqual([
    { id: 1, done: false },
    { id: 1, done: true },
    { id: 2, done: false },
    { id: 2, done: true },
  ]);
});

test("a watcher can stop watching (#251)", async () => {
  const files = newStore();
  const seen: number[] = [];
  const stop = files.onWire((e) => seen.push(e.inFlight));
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
  files.onWire(() => {
    throw new Error("the readout is broken");
  });
  files.onWire((e) => seen.push(e.inFlight));
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
  files.onWire((e) => seen.push(e.inFlight));
  await files.load("bedsit1.set");
  expect(seen).toEqual([]);
  expect(fetched).toHaveLength(1);
});

test("the store's events drive the clock end to end (#251, #369)", async () => {
  // The two halves wired the way `main.ts` wires them, with time and the verdict
  // by hand: what is being checked is that the shapes fit — the events the store
  // reports are the calls the clock takes — rather than any arithmetic, which is
  // above.
  const files = newStore();
  let now = 0;
  let served: Served = "network";
  const clock = new LoadClock({ now: () => now, served: () => served });
  files.onWire((e) => (e.done ? clock.end(e.id) : clock.begin(e.id, e.url)));

  vi.stubGlobal("fetch", async () => {
    now += 400; // the fetch took 400 ms
    return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer } as unknown as Response;
  });
  await files.load("bedsit1.set");
  now += 1_000; // ...and the game then played for a second

  expect(clock.ms).toBe(400);
  expect(clock.waiting).toBe(false);

  // the same fetch again, this time answered out of the cache: the store has it
  // in memory now, so nothing reaches the wire at all — and were it to, the
  // verdict would keep it out of the total
  served = "cache";
  files.registerServerFile("gstair2.set", "/gamefiles/TITANIC1/data/gstair2.set");
  await files.load("gstair2.set");
  expect(clock.ms, "a cache hit is not a download").toBe(400);
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
