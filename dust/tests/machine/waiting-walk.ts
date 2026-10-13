/**
 * A walk saved WAITING comes back waiting, and lands when its walker's room
 * opens.
 *
 *   npm run test:machine -w dust -- tests/machine/waiting-walk.ts
 *
 * A Dust save's walk record with +44 = 0 is one whose walker was not in the open
 * set. DF.EXE's walk service (0x4396f5) moves nothing for it until the walker's
 * set (actor +0x64) is the open one (0x43970d) and the star is in that set's
 * table (0x410ce0, which keeps it waiting at 0x43974e when it is not); then it
 * puts the actor on the star and sends `endwalk`. The port used to fetch the
 * star from any set's table at load and place them at once. `D2A_003` is saved
 * at the undertaker's with the Mayor waiting for `town.help`.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SAVES, haveRip, newDustHost, pumped } from "../playthrough/harness";
import { parseSaveV1 } from "@dreamfactory/engine/df/savegame-v1";

const run = haveRip() ? test : test.skip;

run("a waiting walk waits for its walker's set, then lands on the star", async () => {
  const { host, logs } = await newDustHost();
  const p = pumped(host, logs);
  const s = p.session;
  const bytes = new Uint8Array(readFileSync(`${SAVES}/D2A_003.RTD`));
  const rec = parseSaveV1(bytes).actors.find((a) => a.name.toLowerCase() === "mayor")!;
  expect(await s.loadGame(bytes)).toBe(true);
  await p.settle("D2A_003");
  expect(s.currentSetName, "saved at the undertaker's").not.toBe("town");
  const mayor = s.actorRuntime.get("mayor")!;
  const at = () => [mayor.worldX, mayor.worldY, mayor.worldZ];
  await p.tick(20);
  expect(s.scheduler.isWalk("mayor"), "still waiting").toBe(true);
  expect(at(), "where the record put him, and nothing moved").toEqual([rec.x, rec.y, rec.z]);

  await s.track(s.openSetFile("town.set"));
  await p.tick(4);
  const star = s.currentBinding!.set.actors.find((a) => a.identifier.toLowerCase() === "town.help")!;
  expect(s.scheduler.isWalk("mayor"), "the town is open: the walk is over").toBe(false);
  expect(at(), "on the star").toEqual([star.positionX, star.positionZ, star.positionY]);
  expect(mayor.starName).toBe("town.help");
});
