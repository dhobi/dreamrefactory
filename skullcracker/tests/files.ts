/**
 * Skull Cracker's file store on the page (`src/files.ts`): how the CD becomes
 * one flat index, and how a film is fetched into it.
 *
 *   npx vitest run skullcracker/tests/files.ts
 *
 * The machine suites never reach the page's half of this file — their harness
 * builds the store with `SkullFiles.fromReader` over the disk — so what the PAGE
 * serves is pinned here, with `fetch` answered from a made-up manifest rather
 * than a rip:
 *
 *   - nothing in this game names a path (a film's `event` is a bare
 *     `chp01.Mov`), so the store is keyed by lowercase basename, and only what
 *     sits under `gamefiles/` is in it;
 *   - three names are on the Macintosh disc twice, and for `menu.mov` the copy in
 *     `Install Folder` wins, because it is the newer, longer film the shipped game
 *     runs (the table in the module comment); for the identical pair the first
 *     path does;
 *   - a film arrives as a stream and the loading bar is told chunk by chunk;
 *   - one fetch per name, and a miss is remembered so a failed boot can say what
 *     it wanted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkullFiles } from "../src/files";

const BASE = "https://example.test/skullcracker/";
const at = (path: string): string => BASE + path;

/** a manifest as the build writes it for the Macintosh disc, sorted or not */
const MANIFEST: Record<string, number> = {
  "gamefiles/SKULL/Movies/menu.mov": 174,
  "gamefiles/SKULL/Install Folder/Local/menu.mov": 175,
  "gamefiles/SKULL/Data/player.sbk": 900,
  "gamefiles/SKULL/Install Folder/Local/player.sbk": 900,
  "gamefiles/SKULL/Movies/CHP01.Mov": 60,
  "gamefiles/SKULL/Data/THEME01.SND": 40,
  "public/brand.png": 9,
};

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

let manifest: Record<string, number> | null;
let fetches: string[];
let serve: (url: string) => Response;

beforeEach(() => {
  manifest = MANIFEST;
  fetches = [];
  serve = () => new Response(null, { status: 404 });
  vi.stubGlobal("document", { baseURI: BASE });
  vi.stubGlobal("fetch", async (input: string) => {
    const url = String(input);
    fetches.push(url);
    if (url === at("gamefiles.json")) return manifest ? Response.json(manifest) : new Response(null, { status: 404 });
    return serve(url);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Skull Cracker's index of the disc", () => {
  it("indexes the disc by lowercase basename, and only what is under gamefiles/", async () => {
    const files = await SkullFiles.open();
    expect(files.size).toBe(4);
    expect(files.serves("CHP01.MOV")).toBe(true);
    expect(files.serves("theme01.snd")).toBe(true);
    expect(files.serves("brand.png")).toBe(false);
    expect(files.movies()).toEqual(["chp01.mov", "menu.mov"]);
  });

  it("takes the installed menu.mov over the CD's, and the first path for an identical pair", async () => {
    serve = (url) => streamed([url.includes("Install%20Folder") ? 1 : 0]);
    const files = await SkullFiles.open();
    expect(files.sizeOf("MENU.MOV")).toBe(175);
    expect(await files.load("menu.mov")).toEqual(new Uint8Array([1]));
    expect(fetches).toContain(at("gamefiles/SKULL/Install%20Folder/Local/menu.mov"));
    // player.sbk is the same bytes in both places, and Data/ sorts first
    expect(await files.load("player.sbk")).toEqual(new Uint8Array([0]));
    expect(fetches).toContain(at("gamefiles/SKULL/Data/player.sbk"));
  });

  it("answers a size of nothing for a file the manifest does not list", async () => {
    const files = await SkullFiles.open();
    expect(files.sizeOf("chp99.mov")).toBe(0);
  });

  it("is an empty store, not a failure, when the manifest does not arrive", async () => {
    manifest = null;
    const files = await SkullFiles.open();
    expect(files.size).toBe(0);
    expect(files.movies()).toEqual([]);
  });
});

describe("fetching a file", () => {
  it("answers the synchronous ask with null and a noted miss until the file is in hand", async () => {
    serve = () => streamed([7, 7, 7]);
    const files = await SkullFiles.open();
    expect(files.provide("CHP01.Mov")).toBeNull();
    expect(files.misses).toEqual(["chp01.mov"]);
    // the synchronous ask does not fetch; a load does
    expect(fetches).toEqual([at("gamefiles.json")]);
    await files.load("chp01.mov");
    expect(files.has("CHP01.MOV")).toBe(true);
    expect(files.provide("chp01.mov")).toEqual(new Uint8Array([7, 7, 7]));
    expect(files.loads).toEqual(["chp01.mov"]);
  });

  it("notes a miss for a name the disc does not have, and fetches nothing", async () => {
    const files = await SkullFiles.open();
    expect(await files.load("chp99.mov")).toBeNull();
    expect(files.misses).toEqual(["chp99.mov"]);
    expect(fetches).toEqual([at("gamefiles.json")]);
  });

  it("fetches a name once however many ask, and reports each chunk and the busy count", async () => {
    serve = () => streamed([1], [2, 3]);
    const files = await SkullFiles.open();
    const chunks: [string, number][] = [];
    const busy: number[] = [];
    files.onChunk = (name, n) => chunks.push([name, n]);
    files.onBusyChange = (n) => busy.push(n);
    const [a, b] = await Promise.all([files.load("theme01.snd"), files.load("THEME01.SND")]);
    expect(a).toEqual(new Uint8Array([1, 2, 3]));
    expect(b).toBe(a);
    expect(fetches.filter((u) => u.endsWith("THEME01.SND"))).toHaveLength(1);
    expect(chunks).toEqual([["theme01.snd", 1], ["theme01.snd", 2]]);
    expect(busy).toEqual([1, 0]);
    // and once it is here, asking again does not go back to the server
    expect(await files.load("theme01.snd")).toBe(a);
    expect(fetches.filter((u) => u.endsWith("THEME01.SND"))).toHaveLength(1);
  });

  it("reads a body the browser does not stream in one piece", async () => {
    serve = () => ({ ok: true, body: null, arrayBuffer: async () => new Uint8Array([9, 8]).buffer }) as unknown as Response;
    const files = await SkullFiles.open();
    expect(await files.load("chp01.mov")).toEqual(new Uint8Array([9, 8]));
  });

  it("answers null for a file the server will not give, and tries again next time", async () => {
    const files = await SkullFiles.open();
    expect(await files.load("chp01.mov")).toBeNull();
    expect(files.has("chp01.mov")).toBe(false);
    serve = () => streamed([4]);
    expect(await files.load("chp01.mov")).toEqual(new Uint8Array([4]));
  });
});
