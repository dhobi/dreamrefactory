/**
 * RedJack's file store (`src/files.ts`) on a disc layout the shipped manifest
 * does not have: a name repeated on one disc, a name on only some discs, a
 * disc named twice, and the site root a page declares.
 *
 *   npx vitest run --project redjack redjack/tests/files-discs.ts
 *
 * `files.ts` holds the store to the three discs as they ship. What is pinned
 * here is the indexing rule under the cases it also has to survive: the first
 * copy a disc carries is that disc's (sorted, as the manifest is), a name a
 * newly mounted disc does not carry stays where it was, and mounting the disc
 * already mounted drops nothing it has fetched. And a page one directory down
 * (play/, speedrun/) finds the manifest at the root its `site-root` meta names.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RedJackFiles } from "../src/files";

const BASE = "https://example.test/redjack/";
const at = (path: string): string => BASE + path;

const MANIFEST: Record<string, number> = {
  // two copies on disc 1, in two folders: the first in order is disc 1's
  "gamefiles/RJDisk1/a/theme.trak": 1,
  "gamefiles/RJDisk1/b/theme.trak": 2,
  "gamefiles/RJDisk2/a/theme.trak": 3,
  // on discs 1 and 3 only
  "gamefiles/RJDisk1/RedJack/ship.sett": 10,
  "gamefiles/RJDisk3/RedJack/ship.sett": 30,
};

let asked: string[];
beforeEach(() => {
  asked = [];
  vi.stubGlobal("location", { origin: new URL(BASE).origin });
  vi.stubGlobal("fetch", async (input: string) => {
    const url = String(input);
    asked.push(url);
    if (url.endsWith("gamefiles.json")) return Response.json(MANIFEST);
    return new Response(new Uint8Array([7]));
  });
});
afterEach(() => vi.unstubAllGlobals());

test("of two copies on one disc the first in order is that disc's, and the other disc's is kept apart", async () => {
  vi.stubGlobal("document", { baseURI: BASE });
  const files = await RedJackFiles.open();
  expect(files.serverUrl("theme.trak")).toBe(at("gamefiles/RJDisk1/a/theme.trak"));
  files.setDisc(2);
  expect(files.serverUrl("theme.trak")).toBe(at("gamefiles/RJDisk2/a/theme.trak"));
  files.setDisc(1);
  expect(files.serverUrl("theme.trak")).toBe(at("gamefiles/RJDisk1/a/theme.trak"));
});

test("a name the new disc does not carry stays where it was, and remounting a disc drops nothing", async () => {
  vi.stubGlobal("document", { baseURI: BASE });
  const files = await RedJackFiles.open();
  await files.load("ship.sett");
  files.setDisc(2);
  // disc 2 has no ship.sett: disc 1's copy is still the one served, and still held
  expect(files.serverUrl("ship.sett")).toBe(at("gamefiles/RJDisk1/RedJack/ship.sett"));
  expect(files.has("ship.sett")).toBe(true);
  files.setDisc(3);
  expect(files.has("ship.sett")).toBe(false);
  await files.load("ship.sett");
  files.setDisc(3);
  expect(files.has("ship.sett")).toBe(true);
  expect(files.sizeOf("ship.sett")).toBe(30);
});

test("a page one directory down reads the manifest from the root its meta names", async () => {
  const page = BASE + "play/";
  vi.stubGlobal("document", {
    baseURI: page,
    querySelector: (sel: string) => (sel === 'meta[name="site-root"]' ? { getAttribute: () => "../" } : null),
  });
  await RedJackFiles.open();
  expect(asked[0]).toBe(at("gamefiles.json"));
});
