/**
 * The core value commands (engine/src/runtime/builtins/core.ts) and DF.EXE's
 * grid answers (engine/src/runtime/builtins/context.ts sceneCell / sceneAt /
 * sceneBuild, reached through propexists, actorexists, sendtopost and
 * sendtoserver on a DreamFactory 1 set).
 *
 *   npx vitest run engine/tests/core-builtins.ts
 *
 * Needs no game data.
 */
import { expect, test } from "vitest";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { CELL_UNITS } from "@dreamfactory/engine/df/set-v1-to-v4";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import type { Value } from "@dreamfactory/engine/runtime/interp";
import { GameSession } from "@dreamfactory/engine/runtime/session";

function harness(engine: 1 | 4 | 5 = 4) {
  const session = new GameSession(() => null, new NullAudioSink());
  session.onLog = () => {};
  if (engine === 1) session.dfVersion = 1;
  if (engine === 5) session.isV5 = true;
  session.seedRandom(5);
  const call = (name: string, ...args: Value[]) =>
    session.interp.builtins.get(name)!(session.interp, args, {} as never, undefined as never);
  const fails = (name: string, ...args: Value[]) => expect(async () => call(name, ...args)).rejects;
  return { session, call, fails };
}

test("random: Titanic refuses n <= 0, Dust answers 1", async () => {
  const t = harness();
  await t.fails("random").toMatchObject({ code: 0xa });
  const v = (await t.call("random", 3)) as number;
  expect(v >= 1 && v <= 3).toBe(true);
  const d = harness(1);
  expect(await d.call("random")).toBe(1);
});

test("sqrt: the low word of the unsigned root before v5, a plain root in it", async () => {
  const t = harness();
  expect(await t.call("sqrt", 17)).toBe(4);
  expect(await t.call("sqrt", -1)).toBe(65535);
  expect(await t.call("sqrt")).toBe(0);
  const r = harness(5);
  expect(await r.call("sqrt", 17)).toBe(4);
  expect(await r.call("sqrt")).toBe(0);
  expect(await r.call("sqrt", -1)).toBeNaN();
});

test("stringtonum and substring, with missing arguments", async () => {
  const t = harness();
  expect(await t.call("stringtonum", "42abc")).toBe(42);
  expect(await t.call("stringtonum")).toBe(0);
  expect(await t.call("substring", "Titanic1:data", "TITANIC1:")).toBe(1);
  expect(await t.call("substring", "abc", "")).toBe(-1);
  expect(await t.call("substring")).toBe(-1);
  expect(await t.call("substring", "abc")).toBe(-1);
  expect(await t.call("substring", undefined as never, "a")).toBe(-1);
  const r = harness(5);
  expect(await r.call("substring", "Hello", "LL")).toBe(3);
  expect(await r.call("substring", "abc")).toBe(1);
  expect(await r.call("substring")).toBe(1);
});

/** a DreamFactory 1 set of three scenes on its grid */
function town(session: GameSession, version = 1) {
  const cell = (c: number) => c * CELL_UNITS + CELL_UNITS / 2;
  session.currentBinding = {
    set: {
      version,
      actors: [],
      scenes: [
        { sceneName: "Scene B11", xAxisMap: cell(1), zAxisMap: cell(10), build: false },
        { sceneName: "chicken", xAxisMap: cell(3), zAxisMap: cell(10), build: true },
      ],
    },
    onLog: () => {},
  } as never;
}

test("on a v1 set propexists and actorexists answer a scene's column and row", async () => {
  const { session, call } = harness(1);
  town(session);
  expect(await call("propexists", "chicken")).toBe(3);
  expect(await call("actorexists", "CHICKEN")).toBe(10);
  expect(await call("propexists", "Scene B11")).toBe(1);
  // no such scene, no such prop
  expect(await call("propexists", "nowhere")).toBe(0);
  expect(await call("propexists")).toBe(0);
  // off a v1 set they are the props' and actors' own questions
  const t = harness();
  town(t.session, 4);
  expect(await t.call("propexists", "chicken")).toBe(0);
});

async function runGo(session: GameSession, source: string) {
  const inst = session.instanceFrom(compileScript(source), "t")!;
  return (await session.interp.runHandler(inst, "go", [], { me: "t", target: "" })).value;
}

test("sendtopostfx and sendtoserverfx on a v1 set are rowcoltoscene and scenebuild (a boolean)", async () => {
  const { session } = harness(1);
  town(session);
  const go = (expr: string) => runGo(session, `code go ()\n\treturn (${expr})\nendcode\n`);
  expect(await go("sendtopostfx (10, 3)")).toBe("chicken");
  expect(await go("sendtopostfx (2, 2)")).toBe("none");
  expect(await go(`sendtoserverfx ("Chicken")`)).toBe(true);
  expect(await go(`sendtoserverfx ("scene b11")`)).toBe(false);
  expect(await go(`sendtoserverfx ("nowhere")`)).toBe(false);
  // Dust's engine, but no v1 set open: no grid to answer from
  session.currentBinding = null;
  expect(await go("sendtopostfx (10, 3)")).toBe(0);
  expect(await go(`sendtoserverfx ("chicken")`)).toBe(false);
});

test("an accessor asked about nothing counts the miss, and before v5 it is error 0xa", async () => {
  const t = harness();
  await t.fails("actorspeed").toMatchObject({ code: 0xa });
  expect(t.session.accessorMisses.get("actorspeed()")).toBe(1);
  const r = harness(5);
  expect(await r.call("actorspeed")).toBe(0);
  expect(r.session.accessorMisses.get("actorspeed()")).toBe(1);
});
