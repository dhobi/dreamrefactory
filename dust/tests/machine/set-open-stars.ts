/**
 * Opening a set puts its cast back on their stars, after a load too.
 *
 *   npm run test:machine -w dust -- tests/machine/set-open-stars.ts
 *
 * DF.EXE's set open (0x40e9b0) calls 0x414e00 right after the load: every actor
 * record in the world (+0x12) whose set (+0x64) is the one just opened is looked
 * up by its star (+0x74, 0x410ce0) and gets the star's position. `D2M_001`, the
 * original's own save in the hotel room on the morning of day 2, has Todd on
 * `town.extra3`, Quist on `town.quist1` and the three chickens on their stars, all
 * at (0, 0): their stars were given while the town was not open. The port only
 * seated an actor whose `actorstar` had missed in this session, so after the
 * load they stood at the town's corner (0, 0) for good. `D2M_002`, saved after
 * the walk into town, has Todd on his star.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SAVES, haveRip, newDustHost, pumped } from "../playthrough/harness";
import { parseSaveV1 } from "@dreamfactory/engine/df/savegame-v1";

const run = haveRip() ? test : test.skip;

run("the town's cast stands on their stars when the town opens after D2M_001", async () => {
  const { host, logs } = await newDustHost();
  const p = pumped(host, logs);
  const s = p.session;
  const bytes = new Uint8Array(readFileSync(`${SAVES}/D2M_001.RTD`));
  const saved = parseSaveV1(bytes).actors;
  const cast = ["todd", "quist", "chicken1", "chicken2", "chicken3"];
  for (const name of cast) {
    const rec = saved.find((a) => a.name.toLowerCase() === name)!;
    expect([rec.set, rec.visible, rec.x, rec.y], `${name} as the original saved them`).toEqual(["town", true, 0, 0]);
  }
  expect(await s.loadGame(bytes)).toBe(true);
  await p.settle("D2M_001");
  expect(s.currentSetName, "saved in the hotel room").toBe("hotroom");

  await s.track(s.openSetFile("town.set"));
  await p.tick(1);
  const stars = s.currentBinding!.set.actors;
  for (const name of cast) {
    const a = s.actorRuntime.get(name)!;
    const star = stars.find((t) => t.identifier.toLowerCase() === a.starName)!;
    expect(star, `${name}'s star ${a.starName} is the town's`).toBeTruthy();
    // the chickens may already be pecking their way off it
    if (name.startsWith("chicken")) {
      expect([a.worldX, a.worldY], `${name} is off the origin`).not.toEqual([0, 0]);
      continue;
    }
    expect([a.worldX, a.worldY, a.worldZ], `${name} on ${a.starName}`).toEqual([star.positionX, star.positionZ, star.positionY]);
  }
  // and where the original had Todd once it was out there
  const d2m002 = parseSaveV1(new Uint8Array(readFileSync(`${SAVES}/D2M_002.RTD`))).actors.find((a) => a.name.toLowerCase() === "todd")!;
  expect([s.actorRuntime.get("todd")!.worldX, s.actorRuntime.get("todd")!.worldY]).toEqual([d2m002.x, d2m002.y]);
});
