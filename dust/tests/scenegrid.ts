/**
 * The town as a GRID: `rowcoltoscene` and `scenebuild`, two DreamFactory 1
 * commands whose ids belong to something else in DreamFactory 4.
 *
 *   npx vitest run dust/tests/scenegrid.ts
 *
 * The two engines' command tables diverge on twenty ids and Dust calls eight of
 * them (`engine/src/df/opcodes.ts` has the whole list, read out of both binaries).
 * These two are the pair that were answering nothing at all: as v4's
 * `sendtopostfx`/`sendtoserverfx` they are deferred-call forms, and the v1
 * commands take a grid cell and a scene name, so both logged a complaint and
 * returned 0.
 *
 * What that cost is `extra.cst`'s bounty hunters. Their `isbuild` is
 *
 *     name = rowcoltoscene (y2, x2)
 *     if name = "none"      return true
 *     if scenebuild (name)  return true
 *
 * so with both answering 0 nothing was ever "none" and nothing was ever built:
 * the five hunters treated all 225 cells of the town as open street.
 *
 * Skipped, not failed, without the disc — the same bargain dust/tests/saves.ts
 * makes.
 */
import { test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readSetFileAsV4 } from "@dreamfactory/engine/df/set-v1-to-v4";
import { SetScripts } from "@dreamfactory/engine/runtime/setscripts";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { compileScript } from "@dreamfactory/engine/df/script-asm";

const TOWN = fileURLToPath(new URL("../gamefiles/dustcd/DATA/TOWN.SET", import.meta.url));

/** a session standing on the real town, and a way to ask it a script question */
function town(): ((src: string) => Promise<unknown>) | null {
  if (!existsSync(TOWN)) return null;
  const session = new GameSession(() => null, new NullAudioSink());
  session.onLog = () => {};
  session.dfVersion = 1;
  // the v1 reader and its conversion to the shape the runtime speaks
  const set = readSetFileAsV4(new Uint8Array(readFileSync(TOWN)));
  new SetScripts(set, session);
  return async (src: string) => {
    const inst = session.instanceFrom(compileScript(`code ask ()\n\treturn (${src})\nendcode\n`), "ask");
    return (await session.interp.runHandler(inst!, "ask", [], { me: "ask", target: "" })).value;
  };
}

test("rowcoltoscene names the scene standing on a grid cell", async () => {
  const ask = town();
  if (!ask) return;
  // TOWN is 15x15 and its scenes are named for their cell — column letter, row
  // number, one-based — so cell (row 10, col 1) is "Scene B11". The port reads
  // the pair out of the scene RECORD rather than the name, because not every
  // cell is named for itself: (row 10, col 3) is called "chicken".
  expect(await ask('sendtopostfx (10, 1)')).toBe("Scene B11");
  expect(await ask('sendtopostfx (0, 0)')).toBe("Scene A1");
  expect(await ask('sendtopostfx (14, 14)')).toBe("Scene O15");
  expect(await ask('sendtopostfx (10, 3)'), "a cell named for itself is the norm, not the rule").toBe("chicken");
  // ...and the answer the callers actually test for
  expect(await ask('sendtopostfx (99, 99)')).toBe("none");

  // the inverse is already answered under two other v4 names — `actorexists` is
  // the row and `propexists` the column on a v1 set (BuiltinCtx.sceneCell) — so
  // the two must agree, or the hunters' `isbuild` reads a different cell from the
  // one their `makemove` walks to
  expect(await ask('actorexists ("Scene B11")')).toBe(10);
  expect(await ask('propexists ("Scene B11")')).toBe(1);
  expect(await ask('sendtopostfx (actorexists ("chicken"), propexists ("chicken"))')).toBe("chicken");
});

test("scenebuild says which cells are built on, and the walks agree", async () => {
  const ask = town();
  if (!ask) return;
  // record +12, and what makes it this field rather than a neighbour is that on
  // 28 of the disc's 29 sets "the flag is set" is EXACTLY "no transition touches
  // this cell": TOWN's 173 flagged cells against the 52 its 526 moves reach.
  expect(await ask('sendtoserverfx ("Scene A1")'), "the north-west corner is built on").toBe(1);
  expect(await ask('sendtoserverfx ("Scene G15")'), "the road the player arrives on is street").toBe(0);
  expect(await ask('sendtoserverfx ("Scene B11")'), "...and so is the saloon's own cell").toBe(0);
  // a name that is no scene of this set is not a building: `isbuild` has already
  // dealt with "none" by the time it asks
  expect(await ask('sendtoserverfx ("nowhere")')).toBe(0);
});

test("the hunters' own isbuild now refuses a built cell", async () => {
  const ask = town();
  if (!ask) return;
  // `extra.cst`'s test, in its own words, minus the four-hunter scan: a cell with
  // no scene is blocked, a built cell is blocked, a street cell is not. Before
  // this, all three answered "not blocked" and the hunters walked the buildings.
  const isbuild = (row: number, col: number) =>
    ask(`sendtopostfx (${row}, ${col}) = "none" | sendtoserverfx (sendtopostfx (${row}, ${col}))`);
  expect(await isbuild(99, 99), "off the grid").toBeTruthy();
  expect(await isbuild(0, 0), "a building").toBeTruthy();
  expect(await isbuild(14, 6), "Scene G15, the road in").toBeFalsy();
});
