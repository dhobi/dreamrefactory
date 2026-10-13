/**
 * DreamFactory 1's named jump runs its scene events before the script's next
 * line, and a second conversation cannot open over the first.
 *
 *   npm run test:machine -w dust -- tests/machine/jump.ts
 *
 * `currentscene (name)` is DF.EXE 0x40ee30: closescene to the scene left
 * (0x40f100), the camera moved with the direction kept (0x433960), openscene to
 * the scene arrived in (0x40f050) — all through sendtoscene's runner, at once.
 * `currentview (dir)` (0x410170) does the same for a turn, and neither does
 * anything when you are already there (0x40efaa, 0x410270). The port used to
 * buffer the scene until a `currentview` and then run the events later, so a
 * `currentscene` on its own never moved you and the demo's `randomscene` had
 * its openscene land in the middle of the puppet opened after it.
 *
 * `openpuppetfile` while a puppet is up is error 0x2d in DF.EXE (0x43585d): the
 * one that is up stays.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SAVES, haveRip, newDustHost, pumped } from "../playthrough/harness";
import { parseScript } from "@dreamfactory/engine/runtime/parser";
import { ScriptInstance } from "@dreamfactory/engine/runtime/interp";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { decodeScript } from "@dreamfactory/engine/df/script";

const run = haveRip() ? test : test.skip;

run("currentscene and currentview jump at once, with their scene events, and only when they move", async () => {
  const { host, logs } = await newDustHost();
  const p = pumped(host, logs);
  const s = p.session;
  expect(await s.loadGame(new Uint8Array(readFileSync(`${SAVES}/D2A_009.RTD`)))).toBe(true);
  await p.settle("D2A_009");
  const v = p.v();
  const from = s.currentSceneName();
  const dir = s.currentViewName();
  const views = (i: number) => v.set.scenes[i].views.map((w) => w.viewName.toLowerCase());
  // another scene of the town that can be faced the way we face now, and that
  // has a second direction to turn to
  const to = v.set.scenes.findIndex(
    (sc, i) => sc.sceneName.toLowerCase() !== from && views(i).includes(dir) && views(i).length > 1,
  );
  expect(to, "a scene to jump to").toBeGreaterThanOrEqual(0);
  const toName = v.set.scenes[to].sceneName.toLowerCase();
  const turnTo = views(to).find((w) => w !== dir)!;

  // what the lifecycle sees, and where the script had got to when it did
  const events: string[] = [];
  const close = v.scripts.closeScene.bind(v.scripts);
  const open = v.scripts.openScene.bind(v.scripts);
  v.scripts.closeScene = async (i: number) => {
    events.push(`close ${v.set.scenes[i].sceneName.toLowerCase()} at line ${s.interp.globals.get("line")}`);
    return close(i);
  };
  v.scripts.openScene = async (i: number) => {
    events.push(`open ${v.set.scenes[i].sceneName.toLowerCase()} at line ${s.interp.globals.get("line")}`);
    return open(i);
  };

  const source = [
    "code probe ()",
    "\tglobal line, here, facing",
    "\tline = 1",
    `\tcurrentscene ("${toName}")`,
    "\tline = 2",
    "\there = currentscene ()",
    "\tfacing = currentview ()",
    `\tcurrentscene ("${toName}")`,
    `\tcurrentview ("${dir}")`,
    "\tline = 3",
    `\tcurrentview ("${turnTo}")`,
    "\tline = 4",
    "endcode",
    "",
  ].join("\n");
  const inst = new ScriptInstance("probe", parseScript(decodeScript(compileScript(source))));
  await s.track(s.interp.runHandler(inst, "probe", [], { me: "probe", target: "probe" }));

  expect(String(s.interp.globals.get("here")), "currentscene on its own moved you").toBe(toName);
  expect(String(s.interp.globals.get("facing")), "facing the way you faced").toBe(dir);
  expect(events, "each move's events ran inside its setter; the two non-moves ran none").toEqual([
    `close ${from} at line 1`,
    `open ${toName} at line 1`,
    `close ${toName} at line 3`,
    `open ${toName} at line 3`,
  ]);
  expect(s.currentViewName()).toBe(turnTo);
});

run("a puppet cannot open over another", async () => {
  const { host } = await newDustHost();
  const pc = host.session.puppetCtrl;
  expect(await pc.openPuppetFile("dell1.pup")).toBe(true);
  expect(await pc.openPuppetFile("robber.pup"), "refused, as DF.EXE's error 0x2d").toBe(false);
  expect(pc.puppet?.name, "the first is still up").toBe("dell1.pup");
  pc.closePuppetFile();
  expect(await pc.openPuppetFile("robber.pup"), "and once it is closed, the next opens").toBe(true);
});
