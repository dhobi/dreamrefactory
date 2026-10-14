/**
 * DF.EXE behaviour the language tests cannot reach without the disc
 * (engine/tests/df1-language.ts has the rest).
 *
 *   npm run test:machine -w dust -- tests/machine/df1-rules.ts
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { SAVES, STEP, haveRip, newDustHost, pumped } from "../playthrough/harness";
import { parseScript } from "@dreamfactory/engine/runtime/parser";
import { ScriptError, ScriptInstance } from "@dreamfactory/engine/runtime/interp";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { decodeScript } from "@dreamfactory/engine/df/script";
import type { GameSession } from "@dreamfactory/engine/runtime/session";

const run = haveRip() ? test : test.skip;

/** run a few lines as a script; the promise settles with the error, if any */
function probe(s: GameSession, lines: string[]): Promise<unknown> {
  const source = ["code probe ()", ...lines.map((l) => `\t${l}`), "endcode", ""].join("\n");
  const inst = new ScriptInstance("probe", parseScript(decodeScript(compileScript(source))));
  return s.interp.runHandler(inst, "probe", [], { me: "probe", target: "probe" }).then(
    () => null,
    (e: unknown) => e,
  );
}

async function inTown() {
  const { host, logs } = await newDustHost();
  const p = pumped(host, logs);
  expect(await p.session.loadGame(new Uint8Array(readFileSync(`${SAVES}/D2A_009.RTD`)))).toBe(true);
  await p.settle("D2A_009");
  expect(p.session.currentSetName.toLowerCase()).toBe("town");
  return p;
}

/**
 * Every Dust move is `currentscene (dir)` (DF.EXE 0x40ee30), and it sends
 * closescene (0x40ef5b) BEFORE the move routine 0x4338b0 looks for somewhere to
 * go. Facing a wall, nothing moves and nothing opens again.
 */
run("walking into a wall still closes the scene, and opens nothing", async () => {
  const p = await inTown();
  const s = p.session;
  await probe(s, ['currentscene ("scene a7")', 'currentview ("south")']);
  await p.settle("Scene A7, facing south");
  expect([s.currentSceneName(), s.currentViewName()]).toEqual(["scene a7", "south"]);
  const v = p.v();
  expect(v.availableRoads(), "no road from here").toHaveLength(0);

  const events: string[] = [];
  for (const kind of ["closeScene", "openScene"] as const) {
    const real = v.scripts[kind].bind(v.scripts);
    v.scripts[kind] = (i: number) => {
      events.push(kind);
      return real(i);
    };
  }
  await p.press("uparrow", "the walk into the wall");
  expect([s.currentSceneName(), s.currentViewName()], "stood still").toEqual(["scene a7", "south"]);
  expect(events).toEqual(["closeScene"]);
});

/**
 * A line the puppet does not have is printed as it was written and held
 * `length / 2 + 60` ticks (DF.EXE 0x436104-0x436133).
 */
run("a line Jones does not have is shown as written, and held length/2 + 60 ticks", async () => {
  const p = await inTown();
  const s = p.session;
  expect(await probe(s, ['openpuppetfile ("jones.pup")'])).toBeNull();
  expect(s.puppet).toBeTruthy();

  let done = false;
  const t0 = s.clock.now;
  void probe(s, ['puppetspeak ("jones.99 nil")']).then(() => (done = true));
  await p.pump(() => s.puppet?.subtitle === "jones.99 nil", "the subtitle", 50);
  await p.pump(() => done, "the hold");
  const held = s.clock.now - t0;
  const ticks = (12 >> 1) + 60;
  expect(held).toBeGreaterThanOrEqual((ticks * 1000) / 60);
  expect(held).toBeLessThan((ticks * 1000) / 60 + 3 * STEP);
  expect(s.puppet?.subtitle, "and cleared after").toBe("");
});

/**
 * JONES's `scamgirl`, Laurel met: `puppetspeak ("jones.33", 101)`. The command
 * reads its one argument and runs, and the `)` it then wants is a `,` — error 2
 * at DF.EXE 0x41fced, which every caller hands back up (sendtopuppet included,
 * 0x436569). So jones.33 is said and the conversation ends there: no plaques,
 * and `postpuppet` never runs.
 */
run("jones.33 with a second argument is said, then error 2 ends the chain", async () => {
  const p = await inTown();
  const s = p.session;
  expect(await probe(s, ['openpuppetfile ("jones.pup")'])).toBeNull();
  const said: string[] = [];
  const speak = s.puppetCtrl.puppetSpeak.bind(s.puppetCtrl);
  s.puppetCtrl.puppetSpeak = (ident: string) => {
    said.push(ident);
    return speak(ident);
  };
  let result: unknown = "pending";
  void probe(s, ['puppetspeak ("jones.33", 101)', 'puppetbevel ("never", 1)']).then((r) => (result = r));
  await p.pump(() => result !== "pending", "the line and the error");
  expect(said).toEqual(["jones.33"]);
  expect(result).toBeInstanceOf(ScriptError);
  expect((result as ScriptError).code).toBe(2);
  expect(s.puppet?.bevels ?? [], "the next line never ran").toHaveLength(0);
});

/**
 * CHECKERS.PRP's `setcursor` asks `if playerturn = false` and shows the watch,
 * and before `newgame` has run nothing has assigned `playerturn` — a global
 * nobody set is the INTEGER 0 (0x408260), and `=` across two types is false
 * without a look at the values (0x40d461). So the board offers the arrow until
 * the first game is dealt, where a port that called false 0 showed the watch.
 */
run("checkers shows the arrow before newgame: an unset playerturn is not false", async () => {
  const file = readContainerFile(
    new Uint8Array(readFileSync(fileURLToPath(new URL("../../gamefiles/dustcd/CHECKERS/CHECKERS.PRP", import.meta.url)))),
  );
  const script = file.containers
    .map((c) => {
      try {
        return parseScript(decodeScript(c.data));
      } catch {
        return null;
      }
    })
    .find((sc) => {
      const body = sc?.codes.get("setcursor")?.body;
      return !!body && JSON.stringify(body).includes('"watch"');
    });
  expect(script, "the board's setcursor").toBeTruthy();
  const { host } = await newDustHost();
  const s = host.session;
  const inst = new ScriptInstance("checkers", script!);
  const cursor = async () => {
    await s.interp.runHandler(inst, "setcursor", [0], { me: "checkers", target: "checkers" });
    return s.cursorName;
  };
  s.interp.globals.delete("playerturn");
  expect(await cursor(), "never assigned").toBe("arrow");
  s.interp.globals.set("playerturn", false);
  expect(await cursor(), "the computer's move").toBe("watch");
  s.interp.globals.set("playerturn", true);
  expect(await cursor(), "the player's").toBe("arrow");
});
