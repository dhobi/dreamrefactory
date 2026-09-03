/**
 * Dust's fetches reach the load remover — the wire this disc reports on
 * ([#251](https://github.com/dhobi/dreamrefactory/issues/251),
 * [#369](https://github.com/dhobi/dreamrefactory/issues/369)).
 *
 *   npx vitest run dust/tests/loads.ts
 *
 * The load remover is the engine's now (`engine/src/web/load-clock.ts`) rather
 * than Titanic's, because a speedrun page for this game needs the same clock and
 * a second copy of that arithmetic would be a second set of times nobody could
 * compare with the first. What is Dust's is the half below: this store has to
 * ANNOUNCE its fetches, one at a time and by URL, and it has to get one flag
 * right while doing it.
 *
 * ## The flag, and why it needs a test here rather than in Titanic's
 *
 * Only the fetches the game is STOPPED for may be removed (#369). Titanic's
 * store gets that for free: `load` and `provide` are two different fetch paths
 * there, so the flag is a constant at each of the two places that announce.
 * Dust's `provide` starts the SAME `load` an awaiting caller would — one flight
 * per name, however many callers — so "is anybody waiting for this?" is a fact
 * about who got there first, and the only way to be sure is to pin it.
 *
 * Nothing here waits for a real millisecond or asks a real browser: the clock's
 * `now` and its cache verdicts are injected, and the fetch is a stub that moves
 * that clock itself. A dev server could not answer this question anyway — a
 * `localhost` fetch is classed `local` and removed from nothing, deliberately,
 * so the honest reading of this wiring on a dev server is zero either way.
 */
import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { LoadClock, watchLoads, type Served } from "@dreamfactory/engine/web/load-clock";
import { DustFiles } from "../src/files";

/** the disc as the manifest describes it — two rooms and a film */
const MANIFEST = {
  "gamefiles/dustcd/DATA/town.set": 217_000,
  "gamefiles/dustcd/DATA/cached.set": 217_000,
  "gamefiles/dustcd/MOVIES/intro.mov": 13_000_000,
};

/** ms the stubbed fetch adds to {@link now} before it answers */
let takes = 0;
let now = 0;
let fetched: string[] = [];

beforeEach(() => {
  takes = 0;
  now = 0;
  fetched = [];
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith("gamefiles.json")) {
      return { ok: true, json: async () => MANIFEST } as unknown as Response;
    }
    fetched.push(url);
    now += takes;
    // no `body`, so the store takes its non-streaming path and this stub does
    // not have to be a ReadableStream — what is under test is the wire, and
    // chunks are somebody else's readout
    return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as unknown as Response;
  });
});
afterEach(() => vi.unstubAllGlobals());

test("every fetch is announced by URL, as it starts and as it ends", async () => {
  const files = await DustFiles.open();
  const wire: string[] = [];
  const inFlight: number[] = [];
  files.onWire((e) => wire.push(`${e.done ? "end" : "begin"} ${e.url}`));
  files.onWire((e) => inFlight.push(e.inFlight));

  await files.load("town.set");

  // BY URL, which is the part a count cannot tell: it is what the browser is
  // asked about to decide whether the bytes came over a link (#369)
  expect(wire).toEqual([
    "begin /gamefiles/dustcd/DATA/town.set",
    "end /gamefiles/dustcd/DATA/town.set",
  ]);
  // ...and to every watcher, not just the last one to ask — the canvas-corner
  // busy mark and the remover are two readouts of one wire
  expect(inFlight).toEqual([1, 0]);
});

test("one flight, one pair of events, however many callers join it", async () => {
  // The store already de-duplicates by name (the boot's `preload` fetches the
  // plan while the scripts are asking for the same files). A second pair of
  // events for a fetch that never happened would have the clock removing a
  // download twice over.
  const files = await DustFiles.open();
  const wire: boolean[] = [];
  files.onWire((e) => wire.push(e.done));

  await Promise.all([files.load("town.set"), files.load("town.set"), files.load("town.set")]);

  expect(wire).toEqual([false, true]);
  expect(fetched).toEqual(["/gamefiles/dustcd/DATA/town.set"]);
});

test("a background fetch says nobody is waiting for it (#369)", async () => {
  // `provide` is the engine's synchronous contract: it asked, got null, and
  // carried on. The run is progressing while that file lands, so removing the
  // time would credit a route for playing the game.
  const files = await DustFiles.open();
  const waited: boolean[] = [];
  files.onWire((e) => waited.push(e.waited));

  expect(files.provide("town.set")).toBeNull();
  await vi.waitFor(() => expect(waited).toHaveLength(2));
  expect(waited).toEqual([false, false]);

  // ...where an awaited load says the opposite, and the game is stopped for it
  const other = await DustFiles.open();
  const stopped: boolean[] = [];
  other.onWire((e) => stopped.push(e.waited));
  await other.load("town.set");
  expect(stopped).toEqual([true, true]);
});

test("a fetch that fails still closes its span", async () => {
  // A period the clock never sees the end of is a clock that reads `waiting`
  // for the rest of the page's life and stops counting altogether — so the
  // announcement is in a `finally` rather than after the await.
  const files = await DustFiles.open();
  vi.stubGlobal("fetch", async () => {
    throw new Error("the wire went away");
  });
  const wire: boolean[] = [];
  files.onWire((e) => wire.push(e.done));

  await expect(files.load("town.set")).rejects.toThrow("the wire went away");

  expect(wire).toEqual([false, true]);
});

/**
 * The whole seam, end to end: a download the game waited for is removed from
 * the wall clock, and one it did not wait for is not.
 *
 * This is what `watchLoads(files)` in `dust/src/main.ts` does, with the clock's
 * two ports answered by hand — real milliseconds could not state the case and
 * could not tell a wrong answer from a slow machine.
 */
test("the clock removes what the game waited for, and only that", async () => {
  const verdicts: Record<string, Served | null> = {};
  const clock = new LoadClock({
    now: () => now,
    served: (url) => verdicts[url] ?? "network",
  });

  const files = await DustFiles.open();
  watchLoads(files, clock);

  // a room the game is stopped for, four seconds down a link
  takes = 4_000;
  await files.load("town.set");
  expect(clock.ms).toBe(4_000);

  // ...and a film the engine asked for, was told "not yet" about, and carried
  // on without: the run kept playing, so the clock keeps counting
  takes = 9_000;
  expect(files.provide("intro.mov")).toBeNull();
  await vi.waitFor(() => expect(fetched).toHaveLength(2));
  expect(clock.ms).toBe(4_000);

  // a cache hit is not a load either, however long the page has been open: it
  // is the read the original did off its CD every time it opened a room
  verdicts["/gamefiles/dustcd/DATA/cached.set"] = "cache";
  takes = 400;
  await files.load("cached.set");
  expect(clock.ms).toBe(4_000);
});
