/**
 * What the browser file store (`taoot/src/files.ts`) keeps, and what it lets go.
 *
 * Three bounded things in a session: a room is released when you leave it, the
 * decoded frames have a ring budget, and the MOVIES — 275 of them, 328 MB, each
 * played once — have a byte budget here. These tests pin the rules that keep
 * that budget from costing the game anything:
 *
 *   - the movie just asked for is never the one evicted, so the budget can be
 *     overrun by one film but never leave the screen without the film on it;
 *   - nothing that cannot be fetched again is ever dropped — bytes handed over
 *     directly (a build with no server) are all there is;
 *   - least-recently PLAYED goes first, and `provide` (the engine's synchronous
 *     read) counts as playing;
 *   - a disc swap drops only the cached copies of files that exist on both
 *     discs, and an edition switch keeps the neutral files.
 *
 * And the streaming `load` the boot preloader draws its bar from: every chunk is
 * reported as it lands, and the joined bytes are the body in order.
 *
 * A fake `fetch` serves sized bodies; the question is what the store holds, not
 * what the network does.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FileStore } from "../../src/files";

const MB = 1024 * 1024;

/** the sizes the fake server serves, by URL; a missing URL is a 404 */
let served: Record<string, number> = {};
/** every URL fetched, in order */
let fetched: string[] = [];

beforeEach(() => {
  served = {};
  fetched = [];
  vi.stubGlobal("fetch", async (url: string) => {
    fetched.push(url);
    const size = served[url];
    if (size === undefined) return { ok: false, status: 404 } as Response;
    return {
      ok: true,
      body: null,
      arrayBuffer: async () => new Uint8Array(size).fill(size % 251).buffer,
    } as unknown as Response;
  });
});
afterEach(() => vi.unstubAllGlobals());

/** a store whose server offers these movies at these sizes, in MB */
function movies(sizes: Record<string, number>): FileStore {
  const files = new FileStore();
  for (const [name, mb] of Object.entries(sizes)) {
    const url = `/gamefiles/en/TITANIC1/movies/${name}`;
    served[url] = mb * MB;
    files.registerServerFile(name, url);
  }
  files.setEdition("en");
  return files;
}

test("movies past the budget are evicted oldest first, and come back by refetching", async () => {
  const files = movies({ "a.mov": 30, "b.mov": 30, "c.mov": 30 });
  await files.load("a.mov");
  await files.load("b.mov");
  expect(files.cachedMovieBytes).toBe(60 * MB);
  await files.load("c.mov");
  // 90 MB over a 64 MB budget: the oldest goes, and only it
  expect(files.has("a.mov")).toBe(false);
  expect(files.has("b.mov")).toBe(true);
  expect(files.has("c.mov")).toBe(true);
  expect(files.cachedMovieBytes).toBe(60 * MB);
  // gone from the cache is a refetch away, not lost
  expect((await files.load("a.mov"))?.byteLength).toBe(30 * MB);
  expect(fetched.filter((u) => u.endsWith("a.mov"))).toHaveLength(2);
});

test("the movie just loaded is never the one evicted, even when it alone is over budget", async () => {
  // leave.mov is 37.5 MB; the budget clears the largest one — but a film larger
  // than the budget must still play, at the cost of everything else
  const files = movies({ "small.mov": 10, "huge.mov": 70 });
  await files.load("small.mov");
  await files.load("huge.mov");
  expect(files.has("huge.mov")).toBe(true);
  expect(files.has("small.mov")).toBe(false);
  expect(files.cachedMovieBytes).toBe(70 * MB);
});

test("a movie the engine re-read is younger than one it did not", async () => {
  const files = movies({ "a.mov": 30, "b.mov": 30, "c.mov": 30 });
  await files.load("a.mov");
  await files.load("b.mov");
  // the engine's synchronous read of `a` — a close-up dismissed and reopened
  expect(files.provide("a.mov")).not.toBeNull();
  await files.load("c.mov");
  expect(files.has("a.mov")).toBe(true);
  expect(files.has("b.mov")).toBe(false);
});

test("a cached load is a hit — no fetch — and freshens the movie too", async () => {
  const files = movies({ "a.mov": 30, "b.mov": 30, "c.mov": 30 });
  await files.load("a.mov");
  await files.load("b.mov");
  await files.load("A.MOV");
  expect(fetched).toHaveLength(2);
  await files.load("c.mov");
  expect(files.has("a.mov")).toBe(true);
  expect(files.has("b.mov")).toBe(false);
});

test("evict frees a fetched file and reports its size, and refuses one that could not come back", async () => {
  const files = new FileStore();
  served["/gamefiles/en/TITANIC1/data/deckbd.set"] = 1000;
  files.registerServerFile("DECKBD.SET", "/gamefiles/en/TITANIC1/data/deckbd.set");
  files.setEdition("en");
  await files.load("deckbd.set");
  expect(files.evict("DeckBD.set")).toBe(1000);
  expect(files.has("deckbd.set")).toBe(false);
  // nothing cached: nothing to free
  expect(files.evict("deckbd.set")).toBe(0);
  // a name the server never offered resolves nowhere, so there is nothing to evict
  expect(files.evict("bedsit1.set")).toBe(0);
});

test("a 404 or a network error loads nothing, and the wire is told the fetch ended", async () => {
  const files = new FileStore();
  files.registerServerFile("gone.set", "/gamefiles/en/TITANIC1/data/gone.set");
  files.setEdition("en");
  const ends: number[] = [];
  files.onWire((e) => {
    if (e.done) ends.push(e.inFlight);
  });
  expect(await files.load("gone.set")).toBeNull();
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline");
  });
  expect(await files.load("gone.set")).toBeNull();
  expect(ends).toEqual([0, 0]);
  expect(files.busyCount).toBe(0);
  // and an unregistered name is not even a fetch
  expect(await files.load("nowhere.set")).toBeNull();
  expect(ends).toHaveLength(2);
});

test("busyCount is the fetches in the air right now", async () => {
  const files = movies({ "a.mov": 1 });
  let release!: () => void;
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise((resolve) => {
        release = () => resolve({ ok: true, body: null, arrayBuffer: async () => new ArrayBuffer(4) });
      }),
  );
  const pending = files.load("a.mov");
  expect(files.busyCount).toBe(1);
  release();
  await pending;
  expect(files.busyCount).toBe(0);
});

test("a streaming load reports every chunk and joins them in order", async () => {
  const files = new FileStore();
  files.registerServerFile("cast.trk", "/gamefiles/en/TITANIC1/data/cast.trk");
  files.setEdition("en");
  const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4]), new Uint8Array([5, 6])];
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    body: new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(ch);
        c.close();
      },
    }),
    arrayBuffer: async () => {
      throw new Error("a streaming load must not buffer the whole body");
    },
  }));
  const seen: number[] = [];
  const data = await files.load("cast.trk", (n) => seen.push(n));
  expect(seen).toEqual([3, 1, 2]);
  expect([...data!]).toEqual([1, 2, 3, 4, 5, 6]);
  expect(files.has("cast.trk")).toBe(true);
});

test("serverUrl says where a basename resolves, which follows the disc", () => {
  const files = new FileStore();
  files.registerServerFile("gstair2.set", "/gamefiles/en/TITANIC1/data/gstair2.set");
  files.registerServerFile("GSTAIR2.SET", "/gamefiles/en/Titanic2/DATA/GSTAIR2.SET");
  files.setVolumes(["titanic1", "titanic2"]);
  files.setEdition("en");
  expect(files.serverUrl("GStair2.set")).toBe("/gamefiles/en/TITANIC1/data/gstair2.set");
  files.setDisc(2);
  expect(files.activeDisc()).toBe(2);
  expect(files.serverUrl("gstair2.set")).toBe("/gamefiles/en/Titanic2/DATA/GSTAIR2.SET");
  expect(files.serverUrl("bedsit1.set")).toBeNull();
});

test("two copies on the same disc: the shallower path wins, then the more upper-case, then the lower name", () => {
  const pick = (a: string, b: string): string | null => {
    const files = new FileStore();
    files.registerServerFile("x.set", a);
    files.registerServerFile("x.set", b);
    return files.serverUrl("x.set");
  };
  expect(pick("/g/a/b/x.set", "/g/a/x.set")).toBe("/g/a/x.set");
  expect(pick("/g/data/x.set", "/g/DATA/x.set")).toBe("/g/DATA/x.set");
  expect(pick("/g/b/x.set", "/g/a/x.set")).toBe("/g/a/x.set");
  // order of registration does not matter
  expect(pick("/g/a/x.set", "/g/b/x.set")).toBe("/g/a/x.set");
});

test("a disc swap drops the both-discs files it has cached, and keeps the rest", async () => {
  const files = new FileStore();
  for (const url of [
    "/gamefiles/en/TITANIC1/data/gstair2.set",
    "/gamefiles/en/Titanic2/DATA/GSTAIR2.SET",
    "/gamefiles/en/TITANIC1/data/bedsit1.set",
  ]) {
    served[url] = 8;
    files.registerServerFile(url.split("/").pop()!, url);
  }
  files.setVolumes(["titanic1", "titanic2"]);
  files.setEdition("en");
  await files.load("gstair2.set");
  await files.load("bedsit1.set");
  files.setDisc(1); // the disc already in: nothing changes
  expect(files.has("gstair2.set")).toBe(true);
  files.setDisc(2);
  expect(files.has("gstair2.set")).toBe(false);
  expect(files.has("bedsit1.set")).toBe(true);
});

test("an edition switch drops that edition's files, keeps the neutral ones, and changes the code page", async () => {
  const files = new FileStore();
  for (const url of ["/gamefiles/en/TITANIC1/data/bedsit1.set", "/gamefiles/ja/TITANIC1/data/bedsit1.set", "/lang.stg"]) {
    served[url] = 8;
    files.registerServerFile(url.split("/").pop()!, url);
  }
  files.setEdition("EN");
  expect(files.activeEdition()).toBe("en");
  await files.load("bedsit1.set");
  await files.load("lang.stg");
  files.setEdition("ja");
  expect(files.has("bedsit1.set")).toBe(false);
  expect(files.has("lang.stg")).toBe(true);
  // Japanese text is Shift-JIS; English is Mac Roman — whatever the names, they differ
  const ja = files.textEncoding();
  files.setEdition("en");
  expect(files.textEncoding()).not.toBe(ja);
});
