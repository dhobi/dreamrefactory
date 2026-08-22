/**
 * The language axis of the browser file source (`taoot/src/files.ts`), and the shipped
 * saves that follow it (`taoot/src/save-seed.ts`).
 *
 * `bedsit1.set` exists once per language and once per disc, so "which bytes does
 * this basename mean" has two selectors, and both have a defined fallback. These
 * tests hold that down with a fake manifest and a fake `fetch` — the question
 * being asked is *which URL* a lookup goes to, which is exactly what silently
 * went wrong when a basename was the whole key: six languages installed, and one
 * arbitrary tree served the game.
 */
import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { FileStore, NEUTRAL, discOfUrl, editionOfUrl } from "../../src/files";
import { shippedSaves } from "../../src/save-seed";

/** a manifest like gamefiles.json carries for a two-edition install */
const MANIFEST = [
  "gamefiles/en/TITANIC1/data/bedsit1.set",
  "gamefiles/en/TITANIC1/data/gstair2.set",
  "gamefiles/en/Titanic2/DATA/GSTAIR2.SET",
  "gamefiles/en/TITANIC1/LOCAL/BOOTFILE",
  "gamefiles/en/save/1/01 - The Bedsit.ti",
  "gamefiles/de/TITANIC1/data/bedsit1.set",
  "gamefiles/de/TITANIC1/data/gstair2.set",
  "gamefiles/de/Titanic2/DATA/GSTAIR2.SET",
  "gamefiles/de/TITANIC1/LOCAL/BOOTFILE",
  "gamefiles/de/save/1/01 - Das Zimmer.ti",
  "lang.stg", // this port's own asset, served from public/ — no language at all
];

/** the store, loaded the way main.ts loads it */
function newStore(): FileStore {
  const files = new FileStore();
  for (const p of MANIFEST) files.registerServerFile(p.split("/").pop()!, "/" + p);
  // What the page does once it has read the game's BOOTFILE: the volumes are named
  // by its own setpath, and this is what tells a both-discs basename apart. Applied
  // AFTER the registrations, as it must be — the names live in a file being
  // registered (FileStore.setVolumes).
  files.setVolumes(["titanic1", "titanic2"]);
  return files;
}

/** every URL the store fetched, in order */
let fetched: string[] = [];

beforeEach(() => {
  fetched = [];
  vi.stubGlobal("fetch", async (url: string) => {
    fetched.push(url);
    return {
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as unknown as Response;
  });
});
afterEach(() => vi.unstubAllGlobals());

test("a manifest path names its disc and its language", () => {
  // the volumes come from the game's own setpath (engine/src/runtime/bootplan.ts), so the
  // caller supplies them — this layer no longer knows any title's CD labels
  const v = ["titanic1", "titanic2"];
  expect(discOfUrl("/gamefiles/de/Titanic2/DATA/GSTAIR2.SET", v)).toBe(2);
  expect(discOfUrl("/gamefiles/de/TITANIC1/data/bedsit1.set", v)).toBe(1);
  expect(discOfUrl("/lang.stg", v)).toBeNull();
  // a single-volume game names none, and then nothing is on a disc
  expect(discOfUrl("/gamefiles/demo/data/c71.set", [])).toBeNull();
  // a volume name must match a whole path SEGMENT, not a folder that contains it
  expect(discOfUrl("/gamefiles/x/data/thing.set", ["data2", "data"])).toBe(2);
  expect(editionOfUrl("/gamefiles/de/TITANIC1/data/bedsit1.set")).toBe("de");
  expect(editionOfUrl("/gamefiles/JA/TITANIC1/data/bedsit1.set")).toBe("ja");
  // a flat single-language dump, and our own assets: neutral
  expect(editionOfUrl("/gamefiles/TITANIC1/data/bedsit1.set")).toBe(NEUTRAL);
  expect(editionOfUrl("/lang.stg")).toBe(NEUTRAL);
});

test("the languages on offer are the ones with a directory", () => {
  expect(newStore().availableEditions().sort()).toEqual(["de", "en"]);
});

test("a basename resolves inside the active language", async () => {
  const files = newStore();
  files.setEdition("de");
  await files.load("bedsit1.set");
  expect(fetched).toEqual(["/gamefiles/de/TITANIC1/data/bedsit1.set"]);

  // and the other language's copy is a different file, not a cache hit
  files.setEdition("en");
  await files.load("bedsit1.set");
  expect(fetched).toEqual([
    "/gamefiles/de/TITANIC1/data/bedsit1.set",
    "/gamefiles/en/TITANIC1/data/bedsit1.set",
  ]);
});

test("both discs of the active language, and the disc swap", async () => {
  const files = newStore();
  files.setEdition("de");
  await files.load("gstair2.set");
  expect(fetched.at(-1)).toBe("/gamefiles/de/TITANIC1/data/gstair2.set");

  // BOOTFILE's setpath(2): the same room, the sinking act, still German
  files.setDisc(2);
  await files.load("gstair2.set");
  expect(fetched.at(-1)).toBe("/gamefiles/de/Titanic2/DATA/GSTAIR2.SET");

  // a file that exists on disc 1 only still resolves with disc 2 active
  await files.load("bootfile");
  expect(fetched.at(-1)).toBe("/gamefiles/de/TITANIC1/LOCAL/BOOTFILE");
});

test("a language-neutral file resolves whatever language is active", async () => {
  const files = newStore();
  for (const lang of ["en", "de"]) {
    files.setEdition(lang);
    await files.load("lang.stg");
  }
  // fetched once: the second setEdition did not drop it, because it is not
  // any language's copy of anything — which is what lets the chooser reopen
  expect(fetched).toEqual(["/lang.stg"]);
});

test("the set list is the active language's", () => {
  const files = newStore();
  files.setEdition("en");
  expect(files.serverSetNames()).toEqual(["bedsit1.set", "gstair2.set"]);
  // registered once per language, listed once — not twice
  files.setEdition("de");
  expect(files.serverSetNames()).toEqual(["bedsit1.set", "gstair2.set"]);
});

test("a language with no tree falls back to the neutral one", async () => {
  const files = new FileStore();
  // the layout the tools were first written against: no language directory
  files.registerServerFile("bedsit1.set", "/gamefiles/TITANIC1/data/bedsit1.set");
  files.setEdition("ja");
  await files.load("bedsit1.set");
  expect(fetched).toEqual(["/gamefiles/TITANIC1/data/bedsit1.set"]);
  expect(files.availableEditions()).toEqual([]);
});

test("shipped saves are picked from one language tree", () => {
  expect(shippedSaves(MANIFEST, "de").map((s) => s.rel)).toEqual(["1/01 - Das Zimmer.ti"]);
  expect(shippedSaves(MANIFEST, "en").map((s) => s.rel)).toEqual(["1/01 - The Bedsit.ti"]);
  // unfiltered (a single-language dump) takes what it finds
  expect(shippedSaves(MANIFEST).length).toBe(2);
  // and the URL is the manifest path, encoded, hung off wherever the site is
  // served from (site/src/site.ts) — which under a test runner, with no document to
  // read a site root from, is the host root this has always asserted
  expect(shippedSaves(MANIFEST, "en")[0].url).toBe("/gamefiles/en/save/1/01%20-%20The%20Bedsit.ti");
});
