/**
 * The Dust CD as the engine sees it — `DustFiles`, the index and the fetches.
 *
 *   npx vitest run dust/tests/files.ts
 *
 * `loads.ts` beside this pins the WIRE (which fetches the load remover may
 * subtract). This pins the rest of the store, and each claim is one a boot
 * depends on without saying so:
 *
 *   - the disc is indexed by BASENAME, and where a name ships twice the copy in
 *     `DATA` wins — the mini-games carry their own `CHECKERS.PRP` and a boot that
 *     picked one of those would run the wrong game's props;
 *   - the BOOTFILE is found although the manifest never lists it, because it
 *     lives under `INSTALL/`, a directory the manifest skips on purpose;
 *   - every manifest path is kept verbatim, because the saves beside the disc
 *     are seeded from that list (`src/saves.ts`), not from the basename index;
 *   - a fetch is STREAMED, chunk by chunk, to the caller that started it and to
 *     the store's own hook, and the bar's two readings (`partialProgress`,
 *     `bytesLeft`) are honest while it is under way.
 *
 * No disc and no network: `fetch` is a stub, and the manifest is a few lines.
 */
import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { DustFiles } from "../src/files";

/** the disc as a manifest describes it, path -> size */
const MANIFEST: Record<string, number> = {
  "gamefiles/dustcd/DATA/town.set": 1000,
  "gamefiles/dustcd/DATA/CHECKERS.PRP": 40,
  // the same basename in a mini-game's own directory, listed FIRST so that a
  // first-come index would keep it
  "gamefiles/dustcd/GAMES/CHECKERS/CHECKERS.PRP": 99,
  "gamefiles/dustcd/MOVIES/intro.mov": 600,
  // not the disc's: the shipped saves, which only `paths` should carry
  "gamefiles/save/D1E_001.RTD": 47_000,
};

/** what the stubbed fetch should answer for a URL, by basename */
let bodies: Record<string, Uint8Array[] | "missing"> = {};
/** a chunk is not handed over until the test releases it — see {@link release} */
let gate: Promise<void> = Promise.resolve();
let release: () => void = () => {};
let fetched: string[] = [];

beforeEach(() => {
  bodies = {};
  fetched = [];
  gate = Promise.resolve();
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith("gamefiles.json")) {
      return { ok: true, json: async () => MANIFEST } as unknown as Response;
    }
    fetched.push(url);
    const base = url.split("/").pop()!.toLowerCase();
    const chunks = bodies[base];
    if (chunks === "missing" || !chunks) return { ok: false, body: null } as unknown as Response;
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(ctl) {
        // the first chunk goes at once; the rest wait for the test to let them
        if (i > 0) await gate;
        if (i < chunks.length) ctl.enqueue(chunks[i++]);
        else ctl.close();
      },
    });
    return { ok: true, body } as unknown as Response;
  });
});
afterEach(() => vi.unstubAllGlobals());

/** hold the second and later chunks of the next fetch until {@link release} */
function holdChunks(): void {
  gate = new Promise((r) => (release = r));
}

test("a name on the disc twice is served from DATA, whatever order the manifest lists it in", async () => {
  const files = await DustFiles.open();
  expect(files.serverUrl("checkers.prp")).toMatch(/dustcd\/DATA\/CHECKERS\.PRP$/);
  // and the size it is weighed at is that copy's, not the one it displaced
  expect(files.sizeOf("CHECKERS.PRP")).toBe(40);
});

test("the BOOTFILE is found although the manifest never lists it", async () => {
  const files = await DustFiles.open();
  expect(files.serverUrl("BOOTFILE")).toMatch(/gamefiles\/dustcd\/INSTALL\/ALT31\/BOOTFILE$/);
  // a name the manifest does not size weighs nothing rather than a guess
  expect(files.sizeOf("bootfile")).toBe(0);
});

test("every manifest path is kept verbatim, though only the disc's are indexed", async () => {
  const files = await DustFiles.open();
  // the saves beside the disc are seeded from this list, by path
  expect(files.paths).toEqual(Object.keys(MANIFEST));
  expect(files.serverUrl("d1e_001.rtd")).toBeNull();
  // four distinct disc basenames, plus the off-manifest BOOTFILE
  expect(files.size).toBe(4);
});

test("a manifest the server will not hand over is an empty disc, not a crash", async () => {
  vi.stubGlobal("fetch", async () => ({ ok: false }) as unknown as Response);
  const files = await DustFiles.open();
  expect(files.paths).toEqual([]);
  // the BOOTFILE alone, which is named rather than listed
  expect(files.size).toBe(1);
  expect(files.serverSetNames()).toEqual([]);
});

test("a streamed fetch reports each chunk to its caller and to the store, then joins them", async () => {
  bodies["intro.mov"] = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])];
  const files = await DustFiles.open();
  const toCaller: number[] = [];
  const toStore: [string, number][] = [];
  const done: [string, number][] = [];
  files.onChunk = (name, n) => toStore.push([name, n]);
  files.onFileLoaded = (name, n) => done.push([name, n]);

  const bytes = await files.load("INTRO.MOV", (n) => toCaller.push(n));
  expect([...bytes!]).toEqual([1, 2, 3, 4, 5]);
  expect(toCaller).toEqual([2, 3]);
  expect(toStore).toEqual([["intro.mov", 2], ["intro.mov", 3]]);
  expect(done).toEqual([["intro.mov", 5]]);
  expect(files.loads).toEqual(["intro.mov"]);
  expect(files.has("intro.mov")).toBe(true);

  // and a second load is the cache: no fetch, and the one total it always got
  const again: number[] = [];
  expect(await files.load("intro.mov", (n) => again.push(n))).toBe(bytes);
  expect(again).toEqual([5]);
  expect(fetched).toHaveLength(1);
});

test("a caller who joins a flight is told the total once, not the chunks it did not start", async () => {
  bodies["intro.mov"] = [new Uint8Array(100), new Uint8Array(200)];
  const files = await DustFiles.open();
  const owner: number[] = [];
  const joiner: number[] = [];
  const a = files.load("intro.mov", (n) => owner.push(n));
  const b = files.load("intro.mov", (n) => joiner.push(n));
  await Promise.all([a, b]);
  expect(owner).toEqual([100, 200]);
  expect(joiner).toEqual([300]);
  expect(fetched).toHaveLength(1);
});

test("the bar's readings are honest while a film is half way down the wire", async () => {
  bodies["intro.mov"] = [new Uint8Array(150), new Uint8Array(450)];
  const files = await DustFiles.open();
  holdChunks();
  const firstChunk = new Promise<void>((r) => (files.onChunk = () => r()));
  const flight = files.load("intro.mov");
  await firstChunk;

  // a quarter of the film has landed: a quarter of a file in progress, and
  // three quarters of it plus the whole of town.set still to come
  expect(files.partialProgress()).toBeCloseTo(0.25);
  expect(files.bytesLeft(["intro.mov", "town.set"])).toBe(450 + 1000);
  // a name the manifest does not size contributes nothing, not a guess
  expect(files.bytesLeft(["bootfile"])).toBe(0);

  release();
  await flight;
  // landed: nothing in progress and nothing of it left to come
  expect(files.partialProgress()).toBe(0);
  expect(files.bytesLeft(["intro.mov"])).toBe(0);
});

test("the engine's synchronous ask records the miss and starts the fetch it will ask again for", async () => {
  bodies["town.set"] = [new Uint8Array([7])];
  const files = await DustFiles.open();
  const arrived = new Promise<[string, Uint8Array]>((r) => (files.onBackgroundLoad = (k, d) => r([k, d])));

  expect(files.provide("Town.SET")).toBeNull();
  expect(files.provide("nothere.prp")).toBeNull();
  // both misses are the boot's own account of what it wanted, in order —
  // including the one the disc does not have, which is the diagnosable one
  expect(files.misses).toEqual(["town.set", "nothere.prp"]);

  const [key, data] = await arrived;
  expect(key).toBe("town.set");
  expect([...data]).toEqual([7]);
  expect([...files.provide("town.set")!]).toEqual([7]);
  // only the name the disc carries went to the network
  expect(fetched).toHaveLength(1);
});

test("a file the server refuses is null, and is not cached as if it had arrived", async () => {
  bodies["town.set"] = "missing";
  const files = await DustFiles.open();
  expect(await files.load("town.set")).toBeNull();
  expect(files.has("town.set")).toBe(false);
  expect(files.loads).toEqual([]);
  // and a name the disc never had does not reach the network at all
  expect(await files.load("nowhere.set")).toBeNull();
  expect(fetched).toHaveLength(1);
});

test("the busy hook counts flights up and back down to nothing", async () => {
  bodies["town.set"] = [new Uint8Array(1)];
  bodies["intro.mov"] = [new Uint8Array(1)];
  const files = await DustFiles.open();
  const busy: number[] = [];
  files.onBusyChange = (n) => busy.push(n);
  await Promise.all([files.load("town.set"), files.load("intro.mov"), files.load("town.set")]);
  // two flights, however many callers; the third load joined the first
  expect(busy.slice(0, 2)).toEqual([1, 2]);
  expect(busy.at(-1)).toBe(0);
  expect(busy).toHaveLength(4);
});

test("a watcher that throws does not take the fetch down, and one that left hears nothing", async () => {
  bodies["town.set"] = [new Uint8Array([1])];
  bodies["intro.mov"] = [new Uint8Array([2])];
  const files = await DustFiles.open();
  files.onWire(() => {
    throw new Error("a readout's bug");
  });
  const heard: string[] = [];
  const stop = files.onWire((e) => heard.push(`${e.url.split("/").pop()} ${e.done ? "end" : "start"}`));
  expect(await files.load("town.set")).not.toBeNull();
  stop();
  await files.load("intro.mov");
  expect(heard).toEqual(["town.set start", "town.set end"]);
});

test("there is one set to offer, once the disc is known to carry it", async () => {
  const files = await DustFiles.open();
  expect(files.serverSetNames()).toEqual(["town.set"]);
  // one volume and nothing to swap or evict: these are answers, not stubs
  files.setDisc();
  expect(files.activeEdition()).toBe("dust");
  expect(files.evict()).toBe(0);
});
