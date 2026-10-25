/**
 * Opening a set puts its cast back on their stars; loading one does not.
 *
 *   npx vitest run taoot/tests/auto/set-open-stars.ts
 *
 * TI.EXE's `opensetfile` (0x43cad6 -> 0x407590) reads the set and then goes
 * through every actor record (0x410fa0) and every prop record (0x418b20): one
 * in the world whose set is the one just opened gets its star's x, y and z. The
 * load (`opengame`, 0x414080) rebuilds the room without 0x407590, so it keeps
 * what the file says.
 *
 * The shipped endgame saves are the case: the endgame moves Max to the boat
 * deck (`deckbd`) still standing where the smoking room's `max` star put him.
 * In the original he is put on the boat deck's own `max` the next time a script
 * opens it; the port left him where he was.
 */
import { test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { newHost, root } from "../harness";
import { parseSave } from "@dreamfactory/engine/df/savegame-read";

const SAVE = join(root, "en/save/ENDGAME2/08 - Boat Deck.ti");

test.skipIf(!existsSync(SAVE))("Max goes on the boat deck's star when a script opens it, and not on a load", async () => {
  const { session } = await newHost();
  const bytes = new Uint8Array(readFileSync(SAVE));
  const rec = parseSave(bytes).actors.find((a) => a.name.toLowerCase() === "max")!;
  expect([rec.placement.set, rec.placement.star], "the save's Max").toEqual(["deckbd", "max"]);

  expect(await session.loadGame(bytes)).toBe(true);
  await session.settle();
  const max = session.actorRuntime.get("max")!;
  const at = (): number[] => [max.worldX, max.worldY, max.worldZ];
  expect(at(), "the load keeps the saved position").toEqual([rec.placement.x, rec.placement.y, rec.placement.z]);

  await (session.interp.builtins.get("opensetfile") as (i: unknown, a: unknown[]) => Promise<void>)(session.interp, ["deckbd.set"]);
  await session.settle();
  const star = session.currentBinding!.set.actors.find((a) => a.identifier.toLowerCase() === "max")!;
  expect(at(), "on deckbd's own max").toEqual([star.positionX, star.positionZ, star.positionY]);
  expect(at()).not.toEqual([rec.placement.x, rec.placement.y, rec.placement.z]);
});
