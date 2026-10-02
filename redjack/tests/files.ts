/**
 * RedJack's file store on the page (`src/files.ts`): how the three discs become
 * one flat index, and how a file is fetched into it.
 *
 *   npx vitest run --project redjack redjack/tests/files.ts
 *
 * The machine suites never reach this file — their harness reads the discs off
 * disk with an index of its own — so what the PAGE serves is pinned here, with
 * `fetch` answered from a made-up manifest rather than a rip:
 *
 *   - the scripts ask for `control.stag`, never a path, so every disc is indexed
 *     by lowercase basename, and the engine's own `bootfile` is this rip's
 *     `bootfile.boot`;
 *   - `movies/death.move` is on all three discs and is a different film on each,
 *     so a repeated name follows the disc the game says it is on, and a copy
 *     fetched from another disc is not served after the change — nor one that
 *     was still arriving when the disc changed;
 *   - one fetch per name, however many callers ask, with the loading bar told
 *     chunk by chunk.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RedJackFiles } from "../src/files";

const BASE = "https://example.test/redjack/";
const at = (path: string): string => BASE + path;

/** the shape of the published manifest: served path → size */
const MANIFEST: Record<string, number> = {
  "gamefiles/RJDisk1/RedJack/bootfile.boot": 100,
  "gamefiles/RJDisk1/RedJack/Control.stag": 40,
  "gamefiles/RJDisk1/RedJack/liznite.sett": 500,
  "gamefiles/RJDisk2/RedJack/ship.sett": 600,
  "gamefiles/RJDisk1/movies/death.move": 11,
  "gamefiles/RJDisk2/movies/death.move": 22,
  "gamefiles/RJDisk3/movies/death.move": 33,
  "gamefiles/save/day1.save": 7,
  // outside the store's root: a page asset, not game data
  "public/logo.png": 9,
};

/** a body that arrives in these chunks */
function streamed(...chunks: number[][]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const chunk of chunks) c.enqueue(new Uint8Array(chunk));
        c.close();
      },
    }),
  );
}

let fetches: string[];
let serve: (url: string) => Response | Promise<Response>;

beforeEach(() => {
  fetches = [];
  serve = () => new Response(null, { status: 404 });
  vi.stubGlobal("document", { baseURI: BASE });
  vi.stubGlobal("fetch", async (input: string) => {
    const url = String(input);
    fetches.push(url);
    if (url === at("gamefiles.json")) return Response.json(MANIFEST);
    return serve(url);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RedJack's index of the discs", () => {
  it("indexes every disc by lowercase basename, and only what is under gamefiles/", async () => {
    const files = await RedJackFiles.open();
    // bootfile.boot, control.stag, liznite.sett, ship.sett, death.move, day1.save
    expect(files.size).toBe(6);
    expect(files.serverUrl("CONTROL.STAG")).toBe(at("gamefiles/RJDisk1/RedJack/Control.stag"));
    expect(files.serverUrl("ship.sett")).toBe(at("gamefiles/RJDisk2/RedJack/ship.sett"));
    expect(files.serverUrl("logo.png")).toBeNull();
    expect(files.sizeOf("Control.Stag")).toBe(40);
    expect(files.sizeOf("nothing.stag")).toBe(0);
  });

  it("serves the engine's bootfile as this rip's bootfile.boot", async () => {
    const files = await RedJackFiles.open();
    expect(files.serverUrl("bootfile")).toBe(at("gamefiles/RJDisk1/RedJack/bootfile.boot"));
    expect(files.serverUrl("BOOTFILE")).toBe(files.serverUrl("bootfile.boot"));
    expect(files.sizeOf("bootfile")).toBe(100);
  });

  it("lists the rooms under v5's own extension", async () => {
    const files = await RedJackFiles.open();
    expect(files.serverSetNames().sort()).toEqual(["liznite.sett", "ship.sett"]);
  });

  it("indexes nothing when the manifest does not arrive", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
    const files = await RedJackFiles.open();
    expect(files.size).toBe(0);
  });
});

describe("a name on more than one disc", () => {
  it("is served from the lowest disc until the game names one", async () => {
    const files = await RedJackFiles.open();
    expect(files.activeDisc()).toBe(1);
    expect(files.serverUrl("death.move")).toBe(at("gamefiles/RJDisk1/movies/death.move"));
    expect(files.sizeOf("death.move")).toBe(11);
  });

  it("follows the disc the game says it is on, size and all", async () => {
    const files = await RedJackFiles.open();
    files.setDisc(2);
    expect(files.activeDisc()).toBe(2);
    expect(files.serverUrl("death.move")).toBe(at("gamefiles/RJDisk2/movies/death.move"));
    expect(files.sizeOf("death.move")).toBe(22);
    files.setDisc(3);
    expect(files.serverUrl("death.move")).toBe(at("gamefiles/RJDisk3/movies/death.move"));
    // and back: disc 1's copy was kept, not overwritten by the later ones
    files.setDisc(1);
    expect(files.serverUrl("death.move")).toBe(at("gamefiles/RJDisk1/movies/death.move"));
  });

  it("drops a copy fetched from another disc, so the next load is the new disc's", async () => {
    serve = (url) => streamed(url.includes("RJDisk1") ? [1] : [2, 2]);
    const files = await RedJackFiles.open();
    expect(await files.load("death.move")).toEqual(new Uint8Array([1]));
    expect(files.has("death.move")).toBe(true);
    files.setDisc(2);
    expect(files.has("death.move")).toBe(false);
    expect(files.provide("death.move")).toBeNull();
    expect(await files.load("death.move")).toEqual(new Uint8Array([2, 2]));
  });

  it("does not keep a copy from the old disc that arrives after the change", async () => {
    // disc 1's film is still downloading when the game moves to disc 2
    let finishOld: (r: Response) => void = () => {};
    serve = (url) =>
      url.includes("RJDisk1") ? new Promise<Response>((done) => (finishOld = done)) : streamed([2, 2]);
    const files = await RedJackFiles.open();
    const busy: number[] = [];
    files.onBusyChange = (n) => busy.push(n);
    const old = files.load("death.move");
    await vi.waitFor(() => expect(fetches.some((u) => u.includes("RJDisk1/movies"))).toBe(true));
    files.setDisc(2);
    // a new ask is disc 2's own download, not a share of disc 1's
    expect(await files.load("death.move")).toEqual(new Uint8Array([2, 2]));
    finishOld(streamed([1]));
    // whoever asked before the change still gets what they asked for...
    expect(await old).toEqual(new Uint8Array([1]));
    // ...and the store keeps disc 2's
    expect(files.provide("death.move")).toEqual(new Uint8Array([2, 2]));
    expect(busy.at(-1)).toBe(0);
  });

  it("leaves a name only one disc carries where it is", async () => {
    serve = () => streamed([5]);
    const files = await RedJackFiles.open();
    await files.load("control.stag");
    files.setDisc(3);
    expect(files.serverUrl("control.stag")).toBe(at("gamefiles/RJDisk1/RedJack/Control.stag"));
    expect(files.has("control.stag")).toBe(true);
  });
});

describe("fetching a file", () => {
  it("answers the engine's synchronous ask with null, notes the miss and starts the fetch", async () => {
    serve = () => streamed([9, 9]);
    const files = await RedJackFiles.open();
    const arrived: string[] = [];
    files.onBackgroundLoad = (key) => arrived.push(key);
    expect(files.provide("Control.stag")).toBeNull();
    expect(files.misses).toEqual(["control.stag"]);
    await vi.waitFor(() => expect(files.has("control.stag")).toBe(true));
    expect(files.provide("control.stag")).toEqual(new Uint8Array([9, 9]));
    expect(files.loads).toEqual(["control.stag"]);
    expect(arrived).toEqual(["control.stag"]);
  });

  it("notes a miss for a name no disc has, and fetches nothing", async () => {
    const files = await RedJackFiles.open();
    const before = fetches.length;
    expect(files.provide("nowhere.stag")).toBeNull();
    expect(files.misses).toEqual(["nowhere.stag"]);
    expect(await files.load("nowhere.stag")).toBeNull();
    expect(fetches.length).toBe(before);
  });

  it("fetches a name once however many ask, and reports each chunk to its owner", async () => {
    serve = () => streamed([1, 2], [3]);
    const files = await RedJackFiles.open();
    const chunks: [string, number][] = [];
    const busy: number[] = [];
    files.onChunk = (name, n) => chunks.push([name, n]);
    files.onBusyChange = (n) => busy.push(n);
    const owner: number[] = [];
    const joiner: number[] = [];
    const [a, b] = await Promise.all([
      files.load("liznite.sett", (n) => owner.push(n)),
      files.load("LIZNITE.SETT", (n) => joiner.push(n)),
    ]);
    expect(a).toEqual(new Uint8Array([1, 2, 3]));
    expect(b).toBe(a);
    expect(fetches.filter((u) => u.endsWith("liznite.sett"))).toHaveLength(1);
    // the owner is told as it arrives; the joiner once, the whole
    expect(owner).toEqual([2, 1]);
    expect(joiner).toEqual([3]);
    expect(chunks).toEqual([["liznite.sett", 2], ["liznite.sett", 1]]);
    expect(busy).toEqual([1, 0]);
    // and a load of what is in hand reports its size without a fetch
    const again: number[] = [];
    expect(await files.load("liznite.sett", (n) => again.push(n))).toBe(a);
    expect(again).toEqual([3]);
  });

  it("answers null for a file the server will not give, and tries again next time", async () => {
    serve = () => new Response(null, { status: 500 });
    const files = await RedJackFiles.open();
    expect(await files.load("ship.sett")).toBeNull();
    expect(files.has("ship.sett")).toBe(false);
    serve = () => streamed([4]);
    expect(await files.load("ship.sett")).toEqual(new Uint8Array([4]));
  });

  it("counts the bytes still to come: nothing for what is here, the remainder of what is arriving", async () => {
    let push!: (bytes: number[]) => void;
    let end!: () => void;
    serve = (url) =>
      url.endsWith("ship.sett")
        ? new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                push = (bytes) => c.enqueue(new Uint8Array(bytes));
                end = () => c.close();
              },
            }),
          )
        : streamed(new Array(40).fill(0));
    const files = await RedJackFiles.open();
    expect(files.bytesLeft(["control.stag", "ship.sett", "nothing.stag"])).toBe(640);
    await files.load("control.stag");
    expect(files.bytesLeft(["control.stag", "ship.sett"])).toBe(600);
    const ship = files.load("ship.sett");
    await vi.waitFor(() => expect(push).toBeTypeOf("function"));
    push(new Array(250).fill(1));
    await vi.waitFor(() => expect(files.bytesLeft(["ship.sett"])).toBe(350));
    end();
    expect((await ship)!.byteLength).toBe(250);
    expect(files.bytesLeft(["ship.sett"])).toBe(0);
  });
});
