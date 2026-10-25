/**
 * Opening a room puts its cast back on their stars; loading one does not.
 *
 *   npm run test:machine -w redjack -- tests/machine/set-open-stars.ts
 *
 * RedJack.exe's `opensetfile` reloads the room and then goes through every actor
 * record (0x406700) and every prop record (0x42c5b0): one in the world whose set
 * is the room just opened gets its star's x, y and z. The resume (0x43dd80)
 * rebuilds the room without it (docs/engine/formats/savegame-v5.md), so a load
 * keeps what the file says.
 *
 * day5.save, the original's own, is taken in bb1 with Cross belonging to bb2 on
 * the star `cross` — at (0, 0, 0): his star was given while bb2 was not open.
 * The port used to seat nobody when a RedJack room opened, so he stood there
 * for good.
 */
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readSaveV5 } from "@dreamfactory/engine/df/savegame-v5";
import { fail, headless, ok, pass, haveRip } from "./harness";

test.skipIf(!haveRip())("set-open-stars", async () => {
  const h = await headless();
  await h.until(() => h.room() === "liznite" && h.owner() === "world", "the first room", 60_000);
  await h.settle("the first room");

  const bytes = new Uint8Array(readFileSync(resolve(import.meta.dirname, "../../gamefiles/save/day5.save")));
  const rec = readSaveV5(bytes).actors.find((a) => a.name.toLowerCase() === "cross")!;
  if (rec.set !== "bb2" || rec.star !== "cross" || rec.x || rec.y || rec.z) fail(`day5's Cross is not the case: ${JSON.stringify(rec)}`);
  if (!(await h.session.loadGame(bytes, "2"))) fail("day5.save did not load");
  await h.settle("the load");
  const cross = h.session.actorRuntime.get("cross")!;
  const at = (): number[] => [cross.worldX, cross.worldY, cross.worldZ];
  if (h.room() !== "bb1") fail(`day5 loaded into ${h.room()}`);
  if (at().some((v) => v !== 0)) fail(`the load moved Cross to ${at()}; the resume keeps the saved (0, 0, 0)`);
  ok("loaded in bb1, Cross still where the file has him");

  await h.session.interp.builtins.get("opensetfile")!(h.session.interp, ["bb2"], {} as never, {} as never);
  await h.settle("bb2");
  if (h.room() !== "bb2") fail(`opensetfile went to ${h.room()}`);
  const star = h.session.maze!.star("cross")!;
  if (at().join() !== [star.x, star.y, star.z].join()) fail(`in bb2 Cross is at ${at()}, his star at ${[star.x, star.y, star.z]}`);
  pass(`bb2 opened and Cross stands on his star (${at()})`);
});
