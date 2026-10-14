/**
 * DreamFactory 1's camera moves one step a pass, as DF.EXE's frame steps it.
 *
 *   npm run test:machine -w dust -- tests/machine/camera-move.ts
 *
 * `currentscene (dir)` (0x40ee30) sends `closescene ()` and runs it to its end
 * (0x40ef5b), then asks the move routine (0x4338b0), which drops the move while
 * one runs and otherwise arms it — drawing nothing. Each pass's frame
 * (0x4334c7 -> 0x433d20) draws step `k` of five, the camera `k / 4` of the way
 * (a quarter turn is 16 a step, a walk 64 units of the 256-unit cell), and the
 * fifth lands: the camera moves, `openscene ()` runs inside that pass
 * (0x434067 -> 0x40f050). A move from the hi-res picture starts at step 0, from
 * the low-res one at step 1 (0x433935). `currentview ()` names the step's
 * bearing (0x410500): "moving" on one of the four, "turning" between them.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SAVES, haveRip, newDustHost, pumped } from "../playthrough/harness";
import { parseScript } from "@dreamfactory/engine/runtime/parser";
import { ScriptInstance } from "@dreamfactory/engine/runtime/interp";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { decodeScript } from "@dreamfactory/engine/df/script";

const run = haveRip() ? test : test.skip;

run("a turn and a walk: five steps, one a pass, the arrival inside the last", async () => {
  const { host, logs } = await newDustHost();
  const p = pumped(host, logs);
  const s = p.session;
  expect(await s.loadGame(new Uint8Array(readFileSync(`${SAVES}/D2A_009.RTD`)))).toBe(true);
  await p.settle("D2A_009");
  const v = p.v();

  // the lifecycle, stamped with the pass it ran in
  let passes = 0;
  const events: string[] = [];
  const close = v.scripts.closeScene.bind(v.scripts);
  const open = v.scripts.openScene.bind(v.scripts);
  v.scripts.closeScene = async (i: number) => {
    events.push(`close@${passes}`);
    return close(i);
  };
  v.scripts.openScene = async (i: number) => {
    events.push(`open@${passes}`);
    return open(i);
  };
  const motion = s.onPassMotion;
  s.onPassMotion = async () => {
    passes++;
    await motion();
  };

  // every answer `currentdeg ()` gives the probe, in order
  const degs: number[] = [];
  const currentdeg = s.interp.builtins.get("currentdeg")!;
  s.interp.builtins.set("currentdeg", async (...a) => {
    const d = await currentdeg(...a);
    degs.push(Number(d));
    return d;
  });

  const probe = async (dir: string): Promise<string> => {
    events.length = 0;
    degs.length = 0;
    passes = 0;
    const source = [
      "code probe ()",
      "\tglobal seen, cells, deg",
      `\tcurrentscene ("${dir}")`,
      `\tseen = currentview ()`,
      `\tcells = currentscene ()`,
      `\tdeg = currentdeg ()`,
      `\twhile currentview () = "moving" | currentview () = "turning"`,
      "\t\tforceupdate ()",
      `\t\tseen = seen @ "," @ currentview ()`,
      `\t\tcells = cells @ "," @ currentscene ()`,
      `\t\tdeg = currentdeg ()`,
      "\tendwhile",
      "endcode",
      "",
    ].join("\n");
    const inst = new ScriptInstance("probe", parseScript(decodeScript(compileScript(source))));
    const hooks = v.armRoomNav();
    let done = false;
    // the script's forceupdate waits on the host's frames: pump them
    const ran = s.track(s.interp.runHandler(inst, "probe", [], { me: "probe", target: "probe" })).finally(() => {
      done = true;
    });
    try {
      await p.pump(() => done, "the probe", 200);
      await ran;
    } finally {
      v.disarmRoomNav(hooks);
    }
    const g = (n: string): string => String(s.interp.globals.get(n));
    return `${g("seen")};${g("cells")};${degs.join()}`;
  };

  // a set opens through the jump (0x41b3e1 -> 0x433960): its LOW-res picture
  // is up after the load, so the first turn starts at step 1 — four passes
  const from = s.currentViewName();
  const first = (await probe("right")).split(";")[0];
  expect(events, "closescene before anything, openscene in the fourth pass").toEqual(["close@0", "open@4"]);
  expect(first.split(",")).toEqual(["moving", "turning", "turning", "turning", s.currentViewName()]);
  expect(s.currentViewName()).not.toBe(from);

  // held input keeps the low-res picture up: every event the main loop takes
  // puts event 8 off for 20 ticks (0x411698, 0x411a97), so the idle machine
  // never turns and the next move starts at step 1 too
  for (let i = 0; i < 40; i++) {
    s.noteEvent();
    await p.tick(1);
  }
  const held = (await probe("left")).split(";")[0];
  expect(events).toEqual(["close@0", "open@4"]);
  expect(held.split(",")).toEqual(["moving", "turning", "turning", "turning", from]);

  // left alone, the hi-res picture comes on the sixth quiet idle turn
  // (0x433831), and the next move starts at step 0, the departure's own
  // bearing — "moving" — then three between, and the fifth lands
  await p.tick(60);
  const turned = (await probe("right")).split(";")[0];
  expect(events, "closescene before anything, openscene in the fifth pass").toEqual(["close@0", "open@5"]);
  expect(turned.split(",")).toEqual(["moving", "moving", "turning", "turning", "turning", s.currentViewName()]);

  // ...and right after it, the low-res arrival still up, the next move starts
  // at step 1: four passes
  const again = (await probe("left")).split(";")[0];
  expect(events).toEqual(["close@0", "open@4"]);
  expect(again.split(",")).toEqual(["moving", "turning", "turning", "turning", from]);
  expect(s.currentViewName()).toBe(from);

  // `currentdeg ()` mid-move is the step's bearing (0x410740 reads [0x460baa],
  // which the step's camera builder writes, 0x433f8b): a quarter turn, 16 a step
  const bearings = (await probe("right")).split(";")[2].split(",").map(Number);
  const steps = bearings.slice(1).map((d, i) => (d - bearings[i] + 256) & 0xff);
  expect(new Set(steps), bearings.join()).toEqual(new Set([steps[0]]));
  expect([16, 240], bearings.join()).toContain(steps[0]);
  expect(bearings.length, bearings.join()).toBe(5);

  // "backwards" (direction 4, 0x434b7a) is a direction: its closescene is sent
  // (0x40ef5b), and no set has a transition behind a standpoint, so nothing moves
  const where = `${s.currentSceneName()}/${s.currentViewName()}`;
  expect((await probe("backwards")).split(";")[0]).toBe(s.currentViewName());
  expect(events).toEqual(["close@0"]);
  expect(`${s.currentSceneName()}/${s.currentViewName()}`).toBe(where);

  // a walk: the camera slides 64 units of the 256-unit cell a step, and
  // `currentscene ()` names the cell it is in (0x410870) — so the scene changes
  // in the middle of the move, not at its end
  for (let i = 0; i < 4 && !v.availableRoads().length; i++) await probe("right");
  const start = s.currentSceneName();
  const [views, cells] = (await probe("strait")).split(";").map((x) => x.split(","));
  const arrived = s.currentSceneName();
  expect(arrived, "the walk went somewhere").not.toBe(start);
  expect(views.slice(0, -1).every((w) => w === "moving"), views.join()).toBe(true);
  expect(cells[0]).toBe(start);
  expect(cells.at(-1)).toBe(arrived);
  // the cell changes once, at step 2 or 3 (`pos >> 8` with +128 or -128)
  const changed = cells.findIndex((c) => c !== start);
  expect(cells.slice(changed).every((c) => c === arrived), cells.join()).toBe(true);
  expect(changed, cells.join()).toBeLessThan(cells.length - 1);
});
