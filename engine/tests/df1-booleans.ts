/**
 * Booleans are a type of their own before DreamFactory 5 — engine/src/runtime/
 * interp.ts (`classic`, `classicBinary`), engine/src/runtime/value-types.ts.
 *
 *   npx vitest run engine/tests/df1-booleans.ts
 *
 * DF.EXE tags every value: 2 boolean, 3 string, 4 integer. `true`/`false` are
 * tag 2 (0x40da5d/0x40da86), so are the answers of `=` `!=` `<` `>` `<=` `>=`
 * `&` `|` `not` (0x40d250's cases), and every operator checks the tags before
 * it looks at a value: error 0xe for the wrong type, 0x37 for `/ 0`, 0x1a for
 * an `@` past 255 characters. `if`/`while` want a boolean (0x40353d, 0x4039ab),
 * `for` integers (0x403739...), and a `switch` case of another type is 0xe
 * (0x40412f). TI.EXE and tl.exe are the same code. The commands say what they
 * answer by the tag they write (sounddone 0x4078b6: 2) and refuse a setter's
 * non-boolean (actorvisible 0x412a48). A save stores the tag (save-vars.ts).
 *
 * DreamFactory 5 (RedJack) keeps 1/0 and lenient operators — checked too.
 */
import { expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { decodeScript, scriptToText } from "@dreamfactory/engine/df/script";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { ScriptError } from "@dreamfactory/engine/runtime/interp";
import { readSaveFile } from "@dreamfactory/engine/df/savegame";
import { parseSave } from "@dreamfactory/engine/df/savegame-read";
import { applyPatch } from "@dreamfactory/engine/df/savegame-patch";
import { applyPatchV1, parseSaveV1 } from "@dreamfactory/engine/df/savegame-v1";
import { restoredNumber, scriptGlobals } from "@dreamfactory/engine/runtime/saveload";

type Opts = { v5?: boolean; v1?: boolean };

function session(opts: Opts = {}): GameSession {
  const s = new GameSession(() => null, new NullAudioSink());
  s.onLog = () => {};
  s.isV5 = !!opts.v5;
  if (opts.v1) s.dfVersion = 1;
  return s;
}

async function run(source: string, opts: Opts = {}, s = session(opts)) {
  const inst = s.instanceFrom(compileScript(source), "t")!;
  return (await s.interp.runHandler(inst, "go", [], { me: "t", target: "" })).value;
}

const value = (expr: string, opts: Opts = {}, s?: GameSession) =>
  run(`code go ()\n\treturn (${expr})\nendcode\n`, opts, s);

/** the code of the error a script raises, or null */
const errorOf = (source: string, opts: Opts = {}) =>
  run(source, opts).then(
    () => null,
    (e: unknown) => (e instanceof ScriptError ? e.code : e),
  );
const exprError = (expr: string) => errorOf(`code go ()\n\treturn (${expr})\nendcode\n`);
const stmtError = (lines: string[]) => errorOf(["code go ()", ...lines.map((l) => `\t${l}`), "endcode", ""].join("\n"));

test("true, false and every comparison are booleans", async () => {
  expect(await value("true")).toBe(true);
  expect(await value("false")).toBe(false);
  expect(await value("3 > 2")).toBe(true);
  expect(await value("3 <= 2")).toBe(false);
  expect(await value(`"a" = "A"`)).toBe(true);
  expect(await value(`"a" != "A"`)).toBe(false);
  expect(await value("not false")).toBe(true);
  expect(await value("true & false | true")).toBe(true);
});

test("a boolean equals only a boolean", async () => {
  expect(await value("1 = true")).toBe(false);
  expect(await value("0 = false")).toBe(false);
  expect(await value("1 != true")).toBe(true);
  expect(await value("true = true")).toBe(true);
  expect(await value("false = false")).toBe(true);
  expect(await value("true = false")).toBe(false);
  expect(await value(`"true" = true`)).toBe(false);
  // a new variable is the INTEGER 0 (DF.EXE 0x408260)...
  const fresh = (test: string) => run(`code go ()\n\tlocal fresh\n\treturn (${test})\nendcode\n`);
  expect(await fresh("fresh = false")).toBe(false);
  expect(await fresh("fresh = 0")).toBe(true);
  // ...and one nobody declared is no value at all: error 9 (DF.EXE 0x40d913)
  expect(await exprError("fresh = 0")).toBe(9);
});

test("booleans travel through variables, routines and globals unchanged", async () => {
  const s = session();
  const v = await run(
    `code flip (b)
\treturn (not b)
endcode

code go ()
\tglobal flag
\tlocal mine
\tmine = 2 > 1
\tflag = flip (mine)
\treturn (flag)
endcode
`,
    {},
    s,
  );
  expect(v).toBe(false);
  expect(s.interp.globals.get("flag")).toBe(false);
});

test("the operators refuse the wrong type with error 0xe", async () => {
  for (const expr of [
    "1 + true", `"a" + 1`, "true - false", "2 * false", "true / 1",
    "true & 1", "0 | false", `"a" & true`,
    `"a" @ 1`, `1 @ "a"`, `"a" @ true`,
    `1 < "2"`, "true < false", `"a" > "b"`, "1 >= true",
    "not 1", `not "x"`, "- true", `- "1"`,
  ]) {
    expect(await exprError(expr), expr).toBe(0xe);
  }
  // the other two codes: a division by zero, and a concatenation past 255
  expect(await exprError("7 / 0")).toBe(0x37);
  const long = "x".repeat(200);
  expect(await exprError(`"${long}" @ "${long}"`)).toBe(0x1a);
  expect(await value(`"ab" @ "cd"`)).toBe("abcd");
  expect(await value("7 / -2")).toBe(-3);
});

test("if and while want a boolean; for wants integers", async () => {
  expect(await stmtError(["if 1", "\treturn (1)", "endif"])).toBe(0xe);
  expect(await stmtError([`if "yes"`, "\treturn (1)", "endif"])).toBe(0xe);
  expect(await stmtError(["global unset", "if unset", "\treturn (1)", "endif"])).toBe(0xe);
  expect(await stmtError(["while 0", "endwhile"])).toBe(0xe);
  expect(await stmtError(["for i = true to 3", "endfor"])).toBe(0xe);
  expect(await stmtError([`for i = 1 to "3"`, "endfor"])).toBe(0xe);
  // the body moving the variable to another type is caught at the next endfor
  expect(await stmtError(["for i = 1 to 3", '\ti = "x"', "endfor"])).toBe(0xe);
  expect(await stmtError(["if true", "\treturn (1)", "endif"])).toBeNull();
  // a routine called for a value that reaches `endcode` is error 6 before `if`
  // sees anything (TI.EXE 0x44478f, DF.EXE 0x403b6f)
  expect(
    await errorOf(`code nothing ()
endcode

code go ()
\tif nothing ()
\t\treturn (1)
\tendif
endcode
`),
  ).toBe(6);
});

test("switch: a case of another type is 0xe, and a boolean case never matches", async () => {
  const sw = (subject: string, cases: string[]) =>
    [
      "code go ()",
      `\tswitch ${subject}`,
      ...cases.flatMap((c, i) => [`\tcase ${c}`, `\t\treturn (${i + 1})`]),
      "\tendswitch",
      "\treturn (0)",
      "endcode",
      "",
    ].join("\n");
  expect(await run(sw(`"b"`, [`"a"`, `"B"`]))).toBe(2);
  expect(await run(sw("2", ["1", "2"]))).toBe(2);
  // the subject is checked case by case: a matching case ahead of the bad one is fine
  expect(await run(sw("1", ["1", `"x"`]))).toBe(1);
  expect(await errorOf(sw("1", [`"x"`, "1"]))).toBe(0xe);
  expect(await errorOf(sw(`"x"`, ["true"]))).toBe(0xe);
  // a boolean SUBJECT is refused before any case is read (DF.EXE 0x403616 ->
  // 0x403bdd, TI.EXE 0x444236, tl.exe 0x40e616)
  expect(await errorOf(sw("true", ["true", "false"]))).toBe(0xe);
});

test("an error unwinds the routine that raised it and every caller", async () => {
  const s = session();
  const err = await run(
    `code inner ()
\tglobal reached
\treached = 1
\treturn (1 + true)
endcode

code go ()
\tglobal after
\tinner ()
\tafter = 1
endcode
`,
    {},
    s,
  ).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ScriptError);
  expect((err as ScriptError).where).toBe("t.inner");
  expect(s.interp.globals.get("reached")).toBe(1);
  expect(s.interp.globals.get("after"), "the caller stopped too").toBe(0);
});

test("DreamFactory 5 keeps 1/0 and lenient operators", async () => {
  const v5 = { v5: true };
  expect(await value("true", v5)).toBe(1);
  expect(await value("3 > 2", v5)).toBe(1);
  expect(await value("1 = true", v5)).toBe(1);
  expect(await value(`"a" @ 1`, v5)).toBe("a1");
  expect(await value("true + 1", v5)).toBe(2);
  expect(await run(`code go ()\n\tif 1\n\t\treturn (5)\n\tendif\nendcode\n`, v5)).toBe(5);
});

test("the commands answer the type their executable writes", async () => {
  // sounddone/voicedone: tag 2 (DF.EXE 0x4078b6, 0x4078e6); countsounds: 4
  expect(await value("sounddone ()")).toBe(true);
  expect(await value("voicedone ()")).toBe(true);
  expect(await value("countsounds ()")).toBe(0);
  expect(await value(`isloop ("actor", "nobody")`)).toBe(false);
  expect(await value(`iswalk ("nobody")`)).toBe(false);
  expect(await value("optionkey ()")).toBe(false);
  expect(await value("shiftkey ()")).toBe(false);
  // 20023: Titanic's `actorexists` is a boolean, Dust's `scenerow` an integer
  expect(typeof (await value(`actorexists ("nobody")`))).toBe("boolean");
  expect(typeof (await value(`actorexists ("nobody")`, { v1: true }))).toBe("number");
  // and DreamFactory 5 is left with its numbers
  expect(await value("sounddone ()", { v5: true })).toBe(1);
});

test("a boolean setter refuses anything else with 0xe", async () => {
  // puppetgrab: DF.EXE 0x4361c0, TI.EXE `cmp word [esp], 2` at 0x416999
  expect(await stmtError(["puppetgrab (1)"])).toBe(0xe);
  expect(await stmtError(["puppetgrab (true)"])).toBeNull();
  expect(await stmtError(['propvisible ("nothing", 0)'])).toBe(0xe);
  expect(await stmtError(['pausewalk ("all", 1)'])).toBe(0xe);
  expect(await stmtError(['pausewalk ("all", false)'])).toBeNull();
  // the getter has no boolean argument to check
  expect(await stmtError(['menuvisible ()'])).toBeNull();
  // v5 never checked
  expect(await errorOf("code go ()\n\tpuppetgrab (1)\nendcode\n", { v5: true })).toBeNull();
});

test("the compiler writes true/false as tokens 4021/4022, and they read back", () => {
  const bytes = compileScript("code go ()\n\tglobal a\n\ta = true & not false\nendcode\n");
  const tokens = decodeScript(bytes);
  const ids = tokens.flatMap((t) => ("id" in t ? [t.id] : []));
  expect(ids).toContain(4021);
  expect(ids).toContain(4022);
  expect(ids).toContain(4023);
  expect(scriptToText(tokens)).toMatch(/a = true & not false/);
});

// ---- saves --------------------------------------------------------------

const TAOOT_SAVES = fileURLToPath(new URL("../../taoot/gamefiles/de/save/ENDGAME1", import.meta.url));
const DUST_SAVE = fileURLToPath(new URL("../../dust/gamefiles/save/D1E_005.RTD", import.meta.url));
const tiSave = existsSync(TAOOT_SAVES) ? readdirSync(TAOOT_SAVES).find((f) => f.endsWith(".ti")) : undefined;

test.skipIf(!tiSave)("a v4 save stores a boolean with tag 2 and gives it back as one", async () => {
  const base = new Uint8Array(readFileSync(`${TAOOT_SAVES}/${tiSave}`));
  const shipped = parseSave(base);
  // the shipped files already say which of their numbers are booleans
  expect(shipped.boolGlobals.has("debugging")).toBe(true);
  expect(shipped.boolGlobals.has("mission")).toBe(false);

  const s = session();
  s.interp.globals.set("debugging", true);
  s.interp.globals.set("mission", 1); // a 0/1 integer stays an integer
  s.interp.globals.set("brandnewflag", false); // no record in the base yet
  s.interp.globals.set("clock", "bedsit");
  const { numGlobals, strGlobals, boolGlobals } = scriptGlobals(s);
  const bytes = applyPatch(readSaveFile(base), {
    numGlobals, strGlobals, boolGlobals, set: shipped.set, scene: shipped.scene, view: shipped.view,
  });
  const back = parseSave(bytes);
  expect(back.numGlobals.get("debugging")).toBe(1);
  expect(back.boolGlobals.has("debugging")).toBe(true);
  expect(back.boolGlobals.has("brandnewflag")).toBe(true);
  expect(back.boolGlobals.has("mission")).toBe(false);
  expect(back.vars.find((v) => v.name === "mission")?.type).toBe(4);

  const restore = (k: string) => restoredNumber(s, back.boolGlobals, k, back.numGlobals.get(k)!);
  expect(restore("debugging")).toBe(true);
  expect(restore("brandnewflag")).toBe(false);
  expect(restore("mission")).toBe(1);
});

test.skipIf(!existsSync(DUST_SAVE))("a v1 save does the same", () => {
  const base = new Uint8Array(readFileSync(DUST_SAVE));
  const shipped = parseSaveV1(base);
  const flag = [...shipped.boolGlobals][0];
  expect(flag, "Dust's saves carry booleans too").toBeTruthy();
  const num = [...shipped.numGlobals.keys()].find((k) => !shipped.boolGlobals.has(k))!;

  const numGlobals = new Map(shipped.numGlobals);
  numGlobals.set(flag, 0);
  numGlobals.set(num, 1);
  // the flag stays a boolean, the number becomes one where the interpreter says so
  const bytes = applyPatchV1(readSaveFile(base), { numGlobals, boolGlobals: new Set([flag, num]) });
  const back = parseSaveV1(bytes);
  expect(back.boolGlobals.has(flag)).toBe(true);
  expect(back.boolGlobals.has(num)).toBe(true);
  const again = parseSaveV1(applyPatchV1(readSaveFile(bytes), { numGlobals, boolGlobals: new Set() }));
  expect(again.boolGlobals.has(flag), "and back to an integer when it is one").toBe(false);
});
