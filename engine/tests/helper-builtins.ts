/**
 * The scalar helpers outside any object script (engine/src/runtime/builtins/helpers.ts):
 * words and characters, computed variable names, the stage and set scratch
 * parameters, the packed-point geometry in each engine's form, DF.EXE's
 * actorhitbox under currentcd's id, and the flags that only round-trip.
 *
 *   npx vitest run engine/tests/helper-builtins.ts
 *
 * Needs no game data.
 */
import { expect, test } from "vitest";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { ActorInstance } from "@dreamfactory/engine/runtime/actors";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import type { Value } from "@dreamfactory/engine/runtime/interp";
import { packPoint } from "@dreamfactory/engine/runtime/point";
import { GameSession } from "@dreamfactory/engine/runtime/session";

function harness(engine: 1 | 4 | 5 = 4) {
  const session = new GameSession(() => null, new NullAudioSink());
  if (engine === 1) session.dfVersion = 1;
  if (engine === 5) session.isV5 = true;
  const call = (name: string, ...args: Value[]) =>
    session.interp.builtins.get(name)!(session.interp, args, {} as never, undefined as never);
  return { session, call };
}

async function run(source: string, v5: boolean) {
  const session = new GameSession(() => null, new NullAudioSink());
  session.isV5 = v5;
  const inst = session.instanceFrom(compileScript(source), "t")!;
  return (await session.interp.runHandler(inst, "go", [], { me: "t", target: "" })).value;
}

test("findword, putword and stringlength take a missing string as empty", async () => {
  const { call } = harness();
  expect(await call("findword")).toBe("");
  expect(await call("findword", "abc", "", 2)).toBe("b");
  expect(await call("findword", "a,b,c", ",", 2)).toBe("b");
  expect(await call("findword", "a,b,c", ",", 9)).toBe("");
  // character-wise putword: inserted inside, appended one past the end, "" further out
  expect(await call("putword", "abc", "", 2, "X")).toBe("aXbc");
  expect(await call("putword", "abc", "", 4, "X")).toBe("abcX");
  expect(await call("putword", "abc", "", 9, "X")).toBe("");
  expect(await call("putword")).toBe("");
  expect(await call("putword", "a,b", ",", 2)).toBe("a,");
  expect(await call("stringlength")).toBe(0);
  expect(await call("stringlength", "four")).toBe(4);
  expect(await call("numtostring")).toBe("0");
  expect(await call("numtostring", 42)).toBe("42");
});

test("putword in DreamFactory 5 grows the list, and an empty source has no words", async () => {
  const { call } = harness(5);
  expect(await call("putword", "", ",", 3, "c")).toBe(",,c");
  expect(await call("putword", "a,b", ",", 1, "z")).toBe("z,b");
});

test("DreamFactory 5's variable: a local first, a miss is 0, and a setter makes a global", async () => {
  expect(await run(`code go ()
\tlocal here
\there = 7
\tvariable ("here", 9)
\treturn (variable ("here"))
endcode
`, true)).toBe(9);
  expect(await run(`code go ()
\tglobal made
\tvariable ("made", 5)
\treturn (made + variable ("nothing"))
endcode
`, true)).toBe(5);
  // without a frame, the globals alone
  const { session, call } = harness(5);
  expect(await call("variable", "free")).toBe(0);
  await call("variable", "free", 3);
  expect(session.interp.globals.get("free")).toBe(3);
  expect(await call("variable", "free")).toBe(3);
  expect(await call("variable")).toBe(0);
});

test("stageparam and setparam keep a value per index; a missing index is 0", async () => {
  const { call } = harness();
  expect(await call("stageparam")).toBe(0);
  expect(await call("stageparam", 3)).toBe(0);
  await call("stageparam", 3, "x");
  expect(await call("stageparam", 3)).toBe("x");
  await call("stageparam", undefined as never, 8);
  expect(await call("stageparam", 0)).toBe(8);
  expect(await call("setparam")).toBe(0);
  await call("setparam", 2, 11);
  expect(await call("setparam", 2)).toBe(11);
});

test("calcdeg, calcdist, calcvectx in Titanic's packed form and RedJack's four numbers", async () => {
  const t = harness();
  expect(await t.call("calcdeg")).toBe(await t.call("calcdeg", 0, 0));
  expect(await t.call("calcdist")).toBe(0);
  expect(await t.call("calcdist", packPoint(0, 0), packPoint(3, 4))).toBe(5);
  expect(await t.call("calcdist", packPoint(-3, 0), packPoint(0, 4))).toBe(5);
  expect(await t.call("calcvectx")).toBe(0);
  expect(await t.call("calcvectx", 0, 100)).toBe(100);
  expect(await t.call("calcvecty", 64, 100)).toBe(100);
  // the magnitude is sign-extended from 16 bits
  expect(await t.call("calcvectx", 0, 0x1ffff)).toBe(-1);

  const r = harness(5);
  expect(await r.call("calcdeg")).toBe(0);
  expect(await r.call("calcdeg", 0, 0, 0, 10)).toBe(0x400000);
  expect(await r.call("calcdist")).toBe(0);
  expect(await r.call("calcdist", 0, 0, 3, 4)).toBe(5);
  expect(await r.call("calcvectx")).toBe(0);
  expect(await r.call("calcvectx", 0, 50)).toBe(50);
  expect(await r.call("calcvecty", 0x400000, 50)).toBe(50);
});

test("calcmod: idiv's sign before v5, a CPU fault by 0; v5's is non-negative and 0 by 0", async () => {
  const t = harness();
  expect(await t.call("calcmod", -7, 3)).toBe(-1);
  expect(await t.call("calcmod", 7, 3)).toBe(1);
  let quit = 0;
  t.session.onQuit = async () => void quit++;
  expect(await t.call("calcmod")).toBe(0);
  expect(t.session.fault).toMatchObject({ kind: "divide error", where: "calcmod(0, 0)" });
  expect(quit).toBe(1);

  const r = harness(5);
  expect(await r.call("calcmod", -7, 3)).toBe(2);
  expect(await r.call("calcmod", 5, 0)).toBe(0);
  expect(await r.call("calcmod")).toBe(0);
});

test("currentcd remembers the disc in Titanic; in Dust it is actorhitbox", async () => {
  const t = harness();
  expect(await t.call("currentcd", "Titanic2")).toBe("Titanic2");
  expect(t.session.mountedCd).toBe("Titanic2");

  const d = harness(1);
  const logs: string[] = [];
  d.session.onLog = (l) => logs.push(l);
  expect(await d.call("currentcd")).toBe(0);
  expect(logs.some((l) => l.includes("actorhitbox: no actor"))).toBe(true);
  // the player's own box, then an actor's
  await d.call("currentcd", "Player", 0x18000, -5);
  expect(d.session.balls.playerHitbox).toEqual([-0x8000, -5]);
  expect(await d.call("currentcd", "player", 1)).toBe(-0x8000);
  expect(await d.call("currentcd", "player", 2)).toBe(-5);
  expect(await d.call("currentcd", "player", 3)).toBe(0);
  expect(await d.call("currentcd", "player")).toBe(0);
  const a = new ActorInstance({ name: "pig", poses: [] } as never, { name: "pig.cast", members: [] } as never);
  a.name = "pig";
  (d.session.actorRuntime as unknown as { actors: Map<string, ActorInstance> }).actors.set("pig", a);
  await d.call("currentcd", "pig", undefined as never, 6);
  expect(a.hitbox).toEqual([0, 6]);
  expect(await d.call("currentcd", "pig", 2)).toBe(6);
  expect(d.session.mountedCd).not.toBe("pig");
});

test("dialogs send decoded text to the host; keyaborts and menuvisible round-trip", async () => {
  const { session, call } = harness();
  const notes: string[] = [];
  session.onNoteDialog = async (m) => void notes.push(m);
  await call("notedialog");
  await call("notedialog", "hello");
  expect(notes).toEqual(["", "hello"]);
  session.onQuestionDialog = async (m) => m === "yes?";
  expect(await call("questiondialog", "yes?")).toBe(1);
  expect(await call("questiondialog")).toBe(0);
  expect(await call("keyaborts")).toBe(0);
  expect(await call("keyaborts", 1)).toBe(1);
  expect(session.keyAborts).toBe(true);
  expect(await call("keyaborts")).toBe(1);
  expect(await call("menuvisible", 1)).toBe(1);
  expect(await call("menuvisible")).toBe(1);
  expect(await call("countbevels")).toBe(0);
});

test("path slots: 0..8 read, 1..8 written, a missing index is slot 0", async () => {
  const { call } = harness();
  expect(await call("path")).toBe("");
  expect(await call("path", 9)).toBe("");
  await call("path", 4, "data:");
  expect(await call("path", 4)).toBe("data:");
});
