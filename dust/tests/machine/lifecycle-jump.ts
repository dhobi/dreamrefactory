/**
 * A jump made from inside a scene event runs the scene events again, nested,
 * and DF.EXE's own "already there" tests are what end it.
 *
 *   npm run test:machine -w dust -- tests/machine/lifecycle-jump.ts
 *
 * `currentscene (name)` (DF.EXE 0x40ee30) and `currentview (dir)` (0x410170)
 * never ask whether an openscene or closescene is running: each sends
 * closescene, moves, and sends openscene through sendtoscene's runner at once,
 * whoever called it. A setter that finds you there already does nothing
 * (0x40efaa, 0x410270), and one whose closescene changed the set stops
 * (0x40efff). The port used to move a jump made inside the lifecycle without
 * any events at all (SetScripts.inLifecycle, which DreamFactory 4 keeps).
 *
 * The Dust handlers that jump by name from a scene event are openscene in HOTUPPER
 * Scene C4, NITE/TOWN/TARGET Scene G5, SALUPPER Scene A3 and TOWN Scene G14, and
 * DOCTOR2's openset. Each either changes the state its condition reads before
 * the jump (G5's `phase = 8`, G14's `phase = 1`), reads a view the jump leaves
 * (TARGET G5's `currentview () = "west"`), or asks for the view the nested
 * openscene then finds itself in (C4's and A3's `currentview ("north")` /
 * `("south")`); DOCTOR2's runs a scene's events whose own handlers do not jump.
So each nests once. Scene C4's is the one that once hung the
 * tab, and it is the one played here, from its own script.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SAVES, haveRip, newDustHost, pumped } from "../playthrough/harness";
import { parseScript } from "@dreamfactory/engine/runtime/parser";
import { ScriptInstance } from "@dreamfactory/engine/runtime/interp";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { decodeScript } from "@dreamfactory/engine/df/script";
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import { SetScripts } from "@dreamfactory/engine/runtime/setscripts";

const run = haveRip() ? test : test.skip;

async function probe(s: GameSession, lines: string[]): Promise<void> {
  const source = ["code probe ()", ...lines.map((l) => `\t${l}`), "endcode", ""].join("\n");
  const inst = new ScriptInstance("probe", parseScript(decodeScript(compileScript(source))));
  await s.track(s.interp.runHandler(inst, "probe", [], { me: "probe", target: "probe" }));
}

run("Scene C4's openscene turns you north, and the openscene that turn runs finds you there", async () => {
  const { host, logs } = await newDustHost();
  const p = pumped(host, logs);
  const s = p.session;
  expect(await s.loadGame(new Uint8Array(readFileSync(`${SAVES}/D2A_009.RTD`)))).toBe(true);
  await p.settle("D2A_009");

  // into the upper hall at Scene C4, facing south, with its morning arm asleep
  // (`phase` 1 is what the arm's own `trigger` leaves behind)
  s.interp.globals.set("phase", 1);
  const opening = probe(s, ['opensetfile ("hotupper.set")', 'currentscene ("scene c4")', 'currentview ("south")']);
  await p.pump(() => s.currentSetName.toLowerCase().startsWith("hotupper") && !!host.viewer, "the upper hall");
  await opening;
  await p.settle("the upper hall");
  expect([s.currentSceneName(), s.currentViewName()]).toEqual(["scene c4", "south"]);

  // what the lifecycle sees, and how deep it is when it does
  const v = p.v();
  const events: string[] = [];
  let depth = 0;
  for (const kind of ["closeScene", "openScene"] as const) {
    const real = v.scripts[kind].bind(v.scripts);
    v.scripts[kind] = async (i: number) => {
      events.push(`${"  ".repeat(depth)}${kind === "openScene" ? "open" : "close"} ${s.currentViewName()}`);
      depth++;
      try {
        return await real(i);
      } finally {
        depth--;
      }
    };
  }

  // the morning of day 2, the arm awake: `if day = 2 & clock = 1 & phase = 0`
  s.interp.globals.set("day", 2);
  s.interp.globals.set("clock", 1);
  s.interp.globals.set("phase", 0);
  await probe(s, ['currentview ("east")']);

  expect(s.currentViewName(), "the openscene had the last word").toBe("north");
  expect(events, "the turn east, and inside its openscene the turn north, which nests once").toEqual([
    "close south",
    "open east",
    "  close east",
    "  open north",
  ]);
});

/**
 * DF.EXE opens a set as `opensetfile` (0x40e9b0): the camera placed (0x433960,
 * 0x40ea50), then 0x40f1b0's `openset ()`, `openfloor ()` and `openscene ()` in
 * that order, stopping after either of the first two if the set or the camera's
 * cell changed (0x40f21b–0x40f26b, 0x40f2b0–0x40f301) — the bearing is not
 * asked. DOCTOR2.SET's openset turns you south on day 3, so its turn's
 * closescene and openscene run inside openset, and the set's openscene follows.
 */
run("DOCTOR2's openset turns you south inside it, and the set's openscene follows it", async () => {
  const { host, logs } = await newDustHost();
  const p = pumped(host, logs);
  const s = p.session;
  expect(await s.loadGame(new Uint8Array(readFileSync(`${SAVES}/D2A_009.RTD`)))).toBe(true);
  await p.settle("D2A_009");

  const events: string[] = [];
  let depth = 0;
  const proto = SetScripts.prototype as unknown as Record<string, (this: SetScripts, ...a: number[]) => Promise<void>>;
  const real: Record<string, (this: SetScripts, ...a: number[]) => Promise<void>> = {};
  for (const kind of ["openSet", "openScene", "closeScene"]) {
    real[kind] = proto[kind];
    proto[kind] = async function (this: SetScripts, ...a: number[]) {
      if (s.currentSetName.toLowerCase().startsWith("doctor2")) {
        events.push(`${"  ".repeat(depth)}${kind} ${kind === "openSet" ? "" : s.currentSceneName() + " "}${s.currentViewName()}`);
      }
      depth++;
      try {
        return await real[kind].apply(this, a);
      } finally {
        depth--;
      }
    };
  }
  try {
    s.interp.globals.set("day", 3);
    s.interp.globals.set("clock", 2);
    s.interp.globals.set("docphase", 8);
    const opening = probe(s, ['opensetfile ("doctor2.set")']);
    await p.pump(() => s.currentSetName.toLowerCase().startsWith("doctor2") && !!host.viewer, "the doctor's");
    await opening;
    await p.settle("the doctor's");
  } finally {
    for (const kind of Object.keys(real)) proto[kind] = real[kind];
  }
  const at = events[0]?.replace(/^openSet /, "");
  expect(at, "the set opens facing some other way").not.toBe("south");
  const scene = s.currentSceneName();
  expect(s.currentViewName()).toBe("south");
  expect(events, "openset, its turn nested inside it, then the set's own openscene").toEqual([
    `openSet ${at}`,
    `  closeScene ${scene} ${at}`,
    `  openScene ${scene} south`,
    `openScene ${scene} south`,
  ]);
});

/**
 * Leaving a set runs DF.EXE's 0x40f370 outside in: `closeset` (0x40f3bc), then
 * `closefloor` (0x40f444), then the scene's `closescene` (0x40f4f3).
 */
run("leaving the town sends closeset before closescene", async () => {
  const { host, logs } = await newDustHost();
  const p = pumped(host, logs);
  const s = p.session;
  expect(await s.loadGame(new Uint8Array(readFileSync(`${SAVES}/D2A_009.RTD`)))).toBe(true);
  await p.settle("D2A_009");
  expect(s.currentSetName.toLowerCase()).toBe("town");
  const from = s.currentSetName.toLowerCase();

  const events: string[] = [];
  const proto = SetScripts.prototype as unknown as Record<string, (this: SetScripts, ...a: unknown[]) => Promise<void>>;
  const real = proto.fireLifecycle;
  proto.fireLifecycle = async function (this: SetScripts, ...a: unknown[]) {
    if (this.set.setName.toLowerCase() === from && String(a[0]).startsWith("close")) events.push(String(a[0]));
    return real.apply(this, a);
  };
  try {
    await probe(s, ["closesetfile ()"]);
  } finally {
    proto.fireLifecycle = real;
  }
  expect(events).toEqual(["closeset", "closescene"]);
});
