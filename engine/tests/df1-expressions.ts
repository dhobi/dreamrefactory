/**
 * How the engines evaluate an expression: every operand first, then the
 * operators by priority (engine/src/runtime/parser.ts BIN_PREC,
 * engine/src/runtime/interp.ts `bin`).
 *
 *   npx vitest run engine/tests/df1-expressions.ts
 *
 * DF.EXE's evaluator (0x40d040) reads an operand, then operator/operand pairs,
 * onto a stack until the expression ends (0x40d0ba-0x40d160), and only then
 * reduces it, one priority pass at a time (0x40d17e, priorities from 0x40d750).
 * TI.EXE and Timelapse's tl.exe agree. Two things follow, and both are pinned
 * here: `&` and `|` never skip their right side, and comparisons sit one level
 * TIGHTER than `=`/`!=`. RedJack.exe ranks the operators the same way but does
 * skip a decided right side (0x410788), so DreamFactory 5 is checked apart.
 */
import { expect, test } from "vitest";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";

async function run(source: string, handler = "go", v5 = false) {
  const session = new GameSession(() => null, new NullAudioSink());
  session.isV5 = v5;
  session.seedRandom(1234);
  const inst = session.instanceFrom(compileScript(source), "t")!;
  const value = (await session.interp.runHandler(inst, handler, [], { me: "t", target: "" })).value;
  return { session, value };
}

test("& evaluates its right side even when the left is false", async () => {
  const { session, value } = await run(`code bump ()
\tglobal n
\tn = n + 1
\treturn (true)
endcode

code go ()
\tglobal n
\tn = 0
\tif false & bump ()
\t\treturn (99)
\tendif
\treturn (n)
endcode
`);
  expect(value).toBe(1);
  expect(session.interp.globals.get("n")).toBe(1);
});

test("| evaluates its right side even when the left is true", async () => {
  const { value } = await run(`code bump ()
\tglobal n
\tn = n + 1
\treturn (false)
endcode

code go ()
\tglobal n
\tn = 0
\tif true | bump () | bump ()
\t\treturn (n)
\tendif
\treturn (-1)
endcode
`);
  expect(value).toBe(2);
});

test("and still answers what the operators mean", async () => {
  const { value } = await run(`code go ()
\treturn ((1 & 0) * 1000 + (0 | 2) * 100 + (3 & 4) * 10 + (0 | 0))
endcode
`);
  expect(value).toBe(110);
});

test("random() on the right of a false & still draws", async () => {
  // the reason Dust's random streams moved: a draw nobody looks at. Two fresh
  // sessions start on the same stream, so the second draw must agree.
  const a = await run(`code go ()
\tif false & random (100) > 50
\t\treturn (0)
\tendif
\treturn (random (100))
endcode
`);
  const b = await run(`code go ()
\tlocal r
\tr = random (100)
\treturn (random (100))
endcode
`);
  const c = await run(`code go ()
\treturn (random (100))
endcode
`);
  expect(a.value).toBe(b.value);
  expect(a.value, "the stream does move between draws").not.toBe(c.value);
});

test("a comparison binds tighter than = and !=", async () => {
  // DF.EXE priorities: 3 for > < >= <=, 4 for = !=. So `1 = 2 > 1` is
  // `1 = (2 > 1)` = 1; read as one level it was `(1 = 2) > 1` = 0.
  const { value } = await run(`code go ()
\treturn ((1 = 2 > 1) * 10 + (0 != 3 < 2))
endcode
`);
  expect(value).toBe(10);
});

test("the full ladder, tightest first: * / + - @ comparisons = != & |", async () => {
  const { value } = await run(`code go ()
\treturn (2 + 3 * 4 = 14 & 1 < 2 | 0)
endcode
`);
  expect(value).toBe(1);
  const s = await run(`code go ()
\treturn ("a" @ 1 + 2)
endcode
`);
  // + binds tighter than @
  expect(s.value).toBe("a3");
});

test("operators of one level still associate to the left", async () => {
  const { value } = await run(`code go ()
\treturn (100 - 10 - 1 + 20 / 2 / 5)
endcode
`);
  expect(value).toBe(91);
});

test("DreamFactory 5 still skips a decided right side", async () => {
  const src = `code bump ()
\tglobal n
\tn = n + 1
\treturn (true)
endcode

code go ()
\tglobal n
\tn = 0
\tif false & bump ()
\t\treturn (99)
\tendif
\tif true | bump ()
\t\treturn (n)
\tendif
\treturn (-1)
endcode
`;
  expect((await run(src, "go", true)).value).toBe(0);
  expect((await run(src, "go", false)).value).toBe(2);
});

