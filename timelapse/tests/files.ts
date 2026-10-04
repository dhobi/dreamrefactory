/**
 * Timelapse's file store on the page (`src/files.ts`): how the four discs and
 * the installer's data become one flat index, and how a file is fetched into it.
 *
 *   npx vitest run --project timelapse timelapse/tests/files.ts
 *
 * The machine suites never reach this file — their harness walks the discs on
 * disk with an index of its own — so what the PAGE serves is pinned here, with
 * `fetch` answered from a made-up manifest rather than a rip:
 *
 *   - the scripts ask for `I001.Stg`, never a path, so the discs are indexed by
 *     lowercase basename, and a repeated name (the transition films every disc
 *     carries) is the lowest disc's;
 *   - half the game is in `TLAPSE1/install/data/`, and a manifest written
 *     without that tree must still reach the BOOTFILE and the shops there;
 *   - there is no `.SET` on any disc, so the store offers no rooms;
 *   - one fetch per name, with the loading bar told chunk by chunk.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimelapseFiles } from "../src/files";

const BASE = "https://example.test/timelapse/";
const at = (path: string): string => BASE + path;
const INSTALL = "gamefiles/TLAPSE1/install/data/";

/** a manifest as the build writes it, with the installed tree listed */
const MANIFEST: Record<string, number> = {
  [`${INSTALL}bootfile`]: 300,
  [`${INSTALL}I.Shp`]: 120,
  "gamefiles/TLAPSE1/I/I001.Stg": 50,
  "gamefiles/TLAPSE1/T/T01.mov": 70,
  "gamefiles/TLAPSE2/T/T01.mov": 70,
  "gamefiles/TLAPSE2/A/A001.Stg": 60,
  "public/brand.png": 9,
};

/** the same rip, but a manifest written without the installed tree */
const BARE: Record<string, number> = Object.fromEntries(
  Object.entries(MANIFEST).filter(([path]) => !path.startsWith(INSTALL)),
);

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

let manifest: Record<string, number>;
let fetches: string[];
let serve: (url: string) => Response;

beforeEach(() => {
  manifest = MANIFEST;
  fetches = [];
  serve = () => new Response(null, { status: 404 });
  vi.stubGlobal("document", { baseURI: BASE });
  vi.stubGlobal("location", { origin: new URL(BASE).origin });
  vi.stubGlobal("fetch", async (input: string) => {
    const url = String(input);
    fetches.push(url);
    if (url === at("gamefiles.json")) return Response.json(manifest);
    return serve(url);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Timelapse's index of the discs", () => {
  it("indexes every disc by lowercase basename, and only what is under gamefiles/", async () => {
    const files = await TimelapseFiles.open();
    expect(files.serverUrl("I001.STG")).toBe(at("gamefiles/TLAPSE1/I/I001.Stg"));
    expect(files.serverUrl("a001.stg")).toBe(at("gamefiles/TLAPSE2/A/A001.Stg"));
    expect(files.serverUrl("brand.png")).toBeNull();
    expect(files.sizeOf("I001.stg")).toBe(50);
  });

  it("serves a transition film from the lowest disc that carries it", async () => {
    const files = await TimelapseFiles.open();
    expect(files.serverUrl("t01.mov")).toBe(at("gamefiles/TLAPSE1/T/T01.mov"));
  });

  it("takes the installed data from the manifest when it lists it", async () => {
    const files = await TimelapseFiles.open();
    expect(files.serverUrl("BOOTFILE")).toBe(at(`${INSTALL}bootfile`));
    expect(files.serverUrl("i.shp")).toBe(at(`${INSTALL}I.Shp`));
    expect(files.sizeOf("bootfile")).toBe(300);
  });

  it("still reaches the fourteen installed files when the manifest leaves them out", async () => {
    manifest = BARE;
    const files = await TimelapseFiles.open();
    // what the boot cannot start without, and one of each other kind
    for (const name of ["bootfile", "p.shp", "z.shp", "a.trk", "p.stg", "camera.fil"]) {
      expect(files.serverUrl(name), name).toBe(at(INSTALL + name));
    }
    // four disc names (the two films are one) and the fourteen
    expect(files.size).toBe(3 + 14);
    // with no size: the loading bar counts them as nothing rather than guessing
    expect(files.sizeOf("bootfile")).toBe(0);
  });

  it("offers no rooms: there is no .SET on any disc", async () => {
    const files = await TimelapseFiles.open();
    expect(files.serverSetNames()).toEqual([]);
    expect(files.activeEdition()).toBe("timelapse");
  });

  it("still knows the installed files when the manifest does not arrive", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
    const files = await TimelapseFiles.open();
    expect(files.size).toBe(14);
    expect(files.serverUrl("bootfile")).toBe(at(`${INSTALL}bootfile`));
  });
});

describe("fetching a file", () => {
  it("answers the engine's synchronous ask with null, notes the miss and starts the fetch", async () => {
    serve = () => streamed([7, 7, 7]);
    const files = await TimelapseFiles.open();
    const landed: [string, number][] = [];
    files.onFileLoaded = (name, n) => landed.push([name, n]);
    expect(files.provide("I001.Stg")).toBeNull();
    expect(files.misses).toEqual(["i001.stg"]);
    await vi.waitFor(() => expect(files.has("I001.STG")).toBe(true));
    expect(files.provide("i001.stg")).toEqual(new Uint8Array([7, 7, 7]));
    expect(files.loads).toEqual(["i001.stg"]);
    expect(landed).toEqual([["i001.stg", 3]]);
  });

  it("notes a miss for a name no disc has, and fetches nothing", async () => {
    const files = await TimelapseFiles.open();
    const before = fetches.length;
    expect(files.provide("q001.stg")).toBeNull();
    expect(files.misses).toEqual(["q001.stg"]);
    expect(await files.load("q001.stg")).toBeNull();
    expect(fetches).toHaveLength(before);
  });

  it("fetches a name once however many ask, and reports each chunk to its owner", async () => {
    serve = () => streamed([1], [2, 3]);
    const files = await TimelapseFiles.open();
    const chunks: [string, number][] = [];
    const busy: number[] = [];
    files.onChunk = (name, n) => chunks.push([name, n]);
    files.onBusyChange = (n) => busy.push(n);
    const owner: number[] = [];
    const joiner: number[] = [];
    const [a, b] = await Promise.all([
      files.load("bootfile", (n) => owner.push(n)),
      files.load("BOOTFILE", (n) => joiner.push(n)),
    ]);
    expect(a).toEqual(new Uint8Array([1, 2, 3]));
    expect(b).toBe(a);
    expect(fetches.filter((u) => u.endsWith("/bootfile"))).toHaveLength(1);
    expect(owner).toEqual([1, 2]);
    expect(joiner).toEqual([3]);
    expect(chunks).toEqual([["bootfile", 1], ["bootfile", 2]]);
    expect(busy).toEqual([1, 0]);
  });

  it("answers null for a file the server will not give, and tries again next time", async () => {
    serve = () => new Response(null, { status: 404 });
    const files = await TimelapseFiles.open();
    expect(await files.load("a001.stg")).toBeNull();
    expect(files.has("a001.stg")).toBe(false);
    serve = () => streamed([4]);
    expect(await files.load("a001.stg")).toEqual(new Uint8Array([4]));
  });

  it("counts the bytes still to come: nothing for what is here, the remainder of what is arriving", async () => {
    let push!: (bytes: number[]) => void;
    let end!: () => void;
    serve = (url) =>
      url.endsWith("bootfile")
        ? new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                push = (bytes) => c.enqueue(new Uint8Array(bytes));
                end = () => c.close();
              },
            }),
          )
        : streamed(new Array(50).fill(0));
    const files = await TimelapseFiles.open();
    expect(files.bytesLeft(["I001.Stg", "bootfile", "nothing.stg"])).toBe(350);
    await files.load("i001.stg");
    expect(files.bytesLeft(["i001.stg", "bootfile"])).toBe(300);
    const boot = files.load("bootfile");
    await vi.waitFor(() => expect(push).toBeTypeOf("function"));
    push(new Array(120).fill(1));
    await vi.waitFor(() => expect(files.bytesLeft(["bootfile"])).toBe(180));
    end();
    expect((await boot)!.byteLength).toBe(120);
    expect(files.bytesLeft(["bootfile"])).toBe(0);
  });
});
