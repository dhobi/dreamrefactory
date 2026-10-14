/**
 * The language rules DF.EXE, TI.EXE and tl.exe agree on, and the one string
 * builtin where DF.EXE stands alone (engine/src/runtime/interp.ts `classic`,
 * builtins/core.ts, builtins/helpers.ts).
 *
 *   npx vitest run engine/tests/df1-language.ts
 *
 * - `=` / `!=` never equate a string with a number: the type tags are compared
 *   first (DF.EXE 0x40d461 / 0x40d523, TI.EXE 0x4322e1 / 0x4323e7, tl.exe
 *   0x41fc91), and a new variable is the integer 0 (0x408260).
 * - `for` (0x4036c9, endfor 0x4038a2): a local variable, `to` and `step` read
 *   once, the variable read back every turn, done one step past `to`.
 * - `dumplocal` deletes (0x403a87 -> 0x403e10).
 * - `substring (s, "")` is -1 (0x42d627); `putword` past the last word is ""
 *   (0x42d823); DF.EXE's `findword` drops the tail of an unterminated last
 *   word (0x42d50b), where TI.EXE appends the separator first (0x42b446).
 * - A runtime error unwinds the whole chain (ScriptError).
 *
 * DreamFactory 5 (RedJack) keeps the old answers — each rule is checked there too.
 */
import { expect, test } from "vitest";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { ScriptError } from "@dreamfactory/engine/runtime/interp";

async function run(source: string, opts: { v5?: boolean; v1?: boolean } = {}) {
  const session = new GameSession(() => null, new NullAudioSink());
  session.isV5 = !!opts.v5;
  if (opts.v1) session.dfVersion = 1;
  const inst = session.instanceFrom(compileScript(source), "t")!;
  const value = (await session.interp.runHandler(inst, "go", [], { me: "t", target: "" })).value;
  return { session, value };
}

/** one value, from one expression */
const value = async (expr: string, opts: { v5?: boolean; v1?: boolean } = {}) =>
  (await run(`code go ()\n\treturn (${expr})\nendcode\n`, opts)).value;

test("a string is never equal to a number", async () => {
  expect(await value(`"5" = 5`)).toBe(false);
  expect(await value(`5 = "5"`)).toBe(false);
  expect(await value(`"5" != 5`)).toBe(true);
  expect(await value(`"0" = 0`)).toBe(false);
  // same-type answers are unchanged: numbers by value, strings caselessly
  expect(await value(`5 = 5`)).toBe(true);
  expect(await value(`"Bedsit" = "bEDSIT"`)).toBe(true);
  expect(await value(`"ab" = "abc"`)).toBe(false);
  // RedJack is not touched: there a mixed pair still compares as text
  expect(await value(`"5" = 5`, { v5: true })).toBe(1);
  expect(await value(`"5" != 5`, { v5: true })).toBe(0);
});

test("an unset variable is the integer 0: equal to 0, not to \"0\", \"\" or false", async () => {
  const { value: v } = await run(`code go ()
\tglobal fresh
\treturn ((fresh = 0) & not (fresh = "0") & not (fresh = "") & not (fresh = false))
endcode
`);
  expect(v).toBe(true);
});

test("a switch case of the other type is error 0xe; v5 matches by text", async () => {
  const src = `code go ()
\tlocal s
\ts = "2"
\tswitch s
\tcase 2
\t\treturn (1)
\tcase "2"
\t\treturn (2)
\tendswitch
\treturn (0)
endcode
`;
  // DF.EXE 0x404070: the case's tag against the subject's, 0x40412f -> 0x4041d0
  const err = await run(src).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ScriptError);
  expect((err as ScriptError).code).toBe(0xe);
  expect((await run(src, { v5: true })).value, "v5: the first case still matches by text").toBe(1);
});

test("the for variable is a local, even over a global of that name", async () => {
  const src = `code peek ()
\tglobal count
\treturn (count)
endcode

code go ()
\tglobal count, seen
\tcount = 77
\tseen = 0
\tfor count = 1 to 3
\t\tseen = seen + peek ()
\tendfor
\treturn (count)
endcode
`;
  const { session, value: v } = await run(src);
  expect(v, "the local, one step past `to`").toBe(4);
  expect(session.interp.globals.get("count"), "the global was not counted").toBe(77);
  expect(session.interp.globals.get("seen"), "a routine reading the global sees 77 each pass").toBe(231);
  const v5 = await run(src, { v5: true });
  expect(v5.session.interp.globals.get("count"), "v5 keeps writing the global").toBe(3);
});

test("to and step are read once; the body may move the variable", async () => {
  const { session, value: v } = await run(`code go ()
\tglobal limit, passes
\tlimit = 3
\tpasses = 0
\tfor i = 1 to limit
\t\tlimit = 10
\t\tpasses = passes + 1
\tendfor
\tfor j = 1 to 10
\t\tpasses = passes + 100
\t\tj = j + 4
\tendfor
\treturn (j)
endcode
`);
  // 3 passes of the first loop (limit read once), then j = 1, 6, 11 -> two passes
  expect(session.interp.globals.get("passes")).toBe(203);
  expect(v, "j: 6 + 4 + 1 = 11, past 10").toBe(11);
});

test("a loop that cannot start does not run, and a downward one ends one past", async () => {
  const { value: v } = await run(`code go ()
\tlocal n
\tfor i = 5 to 1
\t\tn = n + 1
\tendfor
\tfor k = 3 to 1 step -1
\t\tn = n + 10
\tendfor
\treturn (n * 100 + i * 10 + (k + 5))
endcode
`);
  // first loop never runs (i is set to 5 anyway), second runs 3, 2, 1 and leaves k at 0
  expect(v).toBe(30 * 100 + 50 + 5);
});

test("dumplocal deletes the local, uncovering a global of the same name", async () => {
  const src = `code go ()
\tglobal x
\tlocal y
\tx = 7
\ty = 3
\tdumplocal y
\treturn (y)
endcode
`;
  // nothing left to read: error 9 (DF.EXE 0x40d913), not 0
  await expect(run(src)).rejects.toMatchObject({ code: 9 });
  const shadow = await run(`code go ()
\tglobal x
\tx = 7
\tfor x = 1 to 1
\tendfor
\tdumplocal x
\treturn (x)
endcode
`);
  expect(shadow.value, "the for's local is gone, the global is read").toBe(7);
});

test("substring with an empty needle finds nothing", async () => {
  expect(await value(`substring ("abc", "")`)).toBe(-1);
  expect(await value(`substring ("abc", "BC")`)).toBe(2);
  expect(await value(`substring ("abc", "")`, { v5: true })).toBe(1);
});

test("putword past the last word gives \"\"", async () => {
  expect(await value(`putword ("a,b,", ",", 2, "x")`)).toBe("a,x,");
  expect(await value(`putword ("a,b,", ",", 3, "x")`), "the empty word after the last ','").toBe("a,b,x");
  expect(await value(`putword ("a,b,", ",", 4, "x")`)).toBe("");
  expect(await value(`putword ("", ",", 1, "x")`)).toBe("x");
  expect(await value(`putword ("", ",", 2, "x")`)).toBe("");
  expect(await value(`putword ("a,b,", ",", 4, "x")`, { v5: true }), "v5 pads").toBe("a,b,,x");
});

test("DF.EXE's findword loses the tail of a last word with no separator after it", async () => {
  const v1 = { v1: true };
  expect(await value(`findword ("ab cd", " ", 2)`, v1)).toBe("c");
  expect(await value(`findword ("a b c", " ", 3)`, v1)).toBe("");
  expect(await value(`findword ("a b c ", " ", 3)`, v1), "a terminated list is whole").toBe("c");
  expect(await value(`findword ("ab cd", " ", 1)`, v1)).toBe("ab");
  expect(await value(`findword ("ab cd", " ", 0)`, v1), "0 counts down to the first word").toBe("ab");
  expect(await value(`findword ("ab cd", " ", 3)`, v1)).toBe("");
  expect(await value(`findword ("212,432,", ",", 2)`, v1), "the checkers DLL's chain").toBe("432");
  expect(await value(`findword ("212,432,", ",", 3)`, v1)).toBe("");
  expect(await value(`findword ("a", ",", 1)`, v1)).toBe("");
  // TI.EXE and tl.exe append the separator first, so the word is whole there
  expect(await value(`findword ("ab cd", " ", 2)`)).toBe("cd");
  expect(await value(`findword ("a b c", " ", 3)`)).toBe("c");
});

test("a runtime error unwinds the whole chain, callers included", async () => {
  // puppetspeak takes one argument (DF.EXE 0x41fced, TI.EXE 0x4148f7): a
  // second is error 2, raised after the command ran
  const src = `code inner ()
\tglobal trail
\ttrail = trail @ "a"
\tpuppetspeak ("nobody.1", 101)
\ttrail = trail @ "b"
endcode

code go ()
\tglobal trail
\ttrail = ""
\tinner ()
\ttrail = trail @ "c"
endcode
`;
  const session = new GameSession(() => null, new NullAudioSink());
  const inst = session.instanceFrom(compileScript(src), "t")!;
  const err = await session.interp.runHandler(inst, "go", [], { me: "t", target: "" }).catch((e) => e);
  expect(err).toBeInstanceOf(ScriptError);
  expect((err as ScriptError).code).toBe(2);
  expect(session.interp.globals.get("trail")).toBe("a");
});
