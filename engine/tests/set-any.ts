/**
 * A SET opened without knowing which engine wrote it (engine/src/df/set-any.ts).
 *
 *   npx vitest run engine/tests/set-any.ts
 *
 * The version is read from container 0, never guessed from the file's name or
 * its game: Dust's rooms come back as v1 grids, Titanic's as v4 scenes, and
 * anything else is refused by number rather than read as whichever it looks
 * most like. Each rip's half skips without it.
 */
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { readContainerFile, writeContainerFile } from "@dreamfactory/engine/df/container";
import { readAnySetFile } from "@dreamfactory/engine/df/set-any";

const DUST = "dust/gamefiles/dustcd/UNDER/MINE.SET";
const TITANIC = "taoot/gamefiles/demo/data/b59.set";
const at = (p: string): string => new URL(`../../${p}`, import.meta.url).pathname;

test.skipIf(!existsSync(at(DUST)))("Dust's room is a v1 set", () => {
  const any = readAnySetFile(new Uint8Array(readFileSync(at(DUST))));
  expect(any.version).toBe(1);
});

test.skipIf(!existsSync(at(TITANIC)))("Titanic's is a v4 set, and one stamped with any other version is refused", () => {
  const bytes = new Uint8Array(readFileSync(at(TITANIC)));
  const any = readAnySetFile(bytes);
  expect(any.version).toBe(4);
  if (any.version === 4) expect(any.set.scenes.length).toBeGreaterThan(0);

  const file = readContainerFile(bytes);
  new DataView(file.containers[0].data.buffer, file.containers[0].data.byteOffset).setInt32(2, 3, true);
  expect(() => readAnySetFile(writeContainerFile(file))).toThrow(/version 3/);
});
