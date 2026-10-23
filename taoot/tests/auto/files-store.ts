/**
 * The browser file store (`src/files.ts`) choosing between copies of one file,
 * and its background reads that fail.
 *
 *   npx vitest run taoot/tests/auto/files-store.ts
 *
 * The CDs spell the same basename more than one way on the same disc, and the
 * page has to read the same bytes the node tools do: the shallowest path wins,
 * then the one with more capitals, then the first in order — whichever was
 * registered first. The engine's synchronous read on a miss fetches in the
 * background and answers "not yet"; asked again while that fetch is in flight
 * it does not start a second one, and a fetch the server refuses leaves the
 * file missing and the store free to try again. Telling the store what it
 * already knows (the same edition, the same volumes) changes nothing.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FileStore } from "../../src/files";

let fetched: string[] = [];
let ok = true;
/** each fetch, held until the test lets it go */
let release: () => void = () => {};

beforeEach(() => {
  fetched = [];
  ok = true;
  vi.stubGlobal("fetch", (url: string) => {
    fetched.push(url);
    return new Promise((resolve) => {
      release = () =>
        resolve(ok ? { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } : { ok: false, status: 404 });
    });
  });
});
afterEach(() => vi.unstubAllGlobals());

const store = (...urls: string[]): FileStore => {
  const files = new FileStore();
  for (const url of urls) files.registerServerFile(url.split("/").pop()!, url);
  files.setEdition("en");
  return files;
};

test("of two copies on one disc, the shallower path wins, whichever came first", () => {
  const deep = "/gamefiles/en/TITANIC1/data/extra/zgossip1.sfx";
  const shallow = "/gamefiles/en/TITANIC1/data/zgossip1.sfx";
  expect(store(deep, shallow).serverUrl("zgossip1.sfx")).toBe(shallow);
  expect(store(shallow, deep).serverUrl("zgossip1.sfx")).toBe(shallow);
});

test("at the same depth the copy spelled with more capitals wins, then the first in order", () => {
  const lower = "/gamefiles/en/TITANIC1/data/bedsit1.set";
  const upper = "/gamefiles/en/TITANIC1/DATA/BEDSIT1.SET";
  expect(store(lower, upper).serverUrl("bedsit1.set")).toBe(upper);
  expect(store(upper, lower).serverUrl("bedsit1.set")).toBe(upper);
  const a = "/gamefiles/en/TITANIC1/aaa/x.set";
  const b = "/gamefiles/en/TITANIC1/bbb/x.set";
  expect(store(b, a).serverUrl("x.set")).toBe(a);
});

test("a miss is fetched once in the background, and a refused fetch leaves it to be tried again", async () => {
  const url = "/gamefiles/en/TITANIC1/data/bedsit1.set";
  const files = store(url);
  const arrived: string[] = [];
  files.onBackgroundLoad = (key) => void arrived.push(key);
  ok = false;
  expect(files.provide("BEDSIT1.SET")).toBeNull();
  // asked again while in flight: no second fetch
  expect(files.provide("bedsit1.set")).toBeNull();
  expect(fetched).toEqual([url]);
  release();
  await vi.waitFor(() => expect(files.busyCount).toBe(0));
  expect(arrived).toEqual([]);
  expect(files.has("bedsit1.set")).toBe(false);

  // the next ask starts a fetch of its own, and this one lands
  ok = true;
  expect(files.provide("bedsit1.set")).toBeNull();
  release();
  await vi.waitFor(() => expect(arrived).toEqual(["bedsit1.set"]));
  expect(fetched).toEqual([url, url]);
  expect([...files.provide("bedsit1.set")!]).toEqual([1, 2, 3]);
});

test("the same edition or the same volumes again change nothing that is cached", async () => {
  const url = "/gamefiles/en/TITANIC1/data/bedsit1.set";
  const files = store(url);
  files.setVolumes(["TITANIC1", "Titanic2"]);
  const load = files.load("bedsit1.set");
  release();
  await load;
  files.setEdition("EN");
  files.setVolumes(["TITANIC1", "Titanic2"]);
  expect(files.has("bedsit1.set")).toBe(true);
  expect(files.serverUrl("bedsit1.set")).toBe(url);
});
