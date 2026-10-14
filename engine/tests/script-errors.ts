/**
 * The errors the engines raise, and what the player is shown of them
 * (engine/src/runtime/interp.ts ScriptError, runtime/script-errors.ts,
 * GameSession.scriptErrorLatched).
 *
 *   npx vitest run engine/tests/script-errors.ts
 *
 * TI.EXE's statement runner (0x443f60), call binder (0x443db0) and handler
 * search (0x443bd0) are the same code in DF.EXE (0x403340, 0x4030c0, 0x402fa0)
 * and tl.exe (0x40e340…), so every rule here holds for all three; only what the
 * player SEES differs — TI.EXE and tl.exe ask Yes/No (0x407260, 0x43cfc0),
 * DF.EXE says nothing (0x42f340).
 */
import { expect, test } from "vitest";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { ScriptError } from "@dreamfactory/engine/runtime/interp";
import { engineBearing } from "@dreamfactory/engine/runtime/geometry";
import { scriptErrorBoxText } from "@dreamfactory/engine/runtime/script-errors";

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

/** the code of the error a script raises, or null */
const errorOf = (source: string, opts: Opts = {}, s?: GameSession) =>
  run(source, opts, s).then(
    () => null,
    (e: unknown) => (e instanceof ScriptError ? e.code : e),
  );
const body = (...lines: string[]) => ["code go ()", ...lines.map((l) => `\t${l}`), "endcode", ""].join("\n");

test("a variable nobody declared is error 9 to read and to write, never 0", async () => {
  expect(await errorOf(body("return (nothere)"))).toBe(9);
  expect(await errorOf(body("nothere = 1"))).toBe(9);
  // declared, it reads 0 and takes a value
  expect(await run(body("local x", "return (x)"))).toBe(0);
  expect(await run(body("global gx", "gx = 4", "return (gx)"))).toBe(4);
  // DreamFactory 5 keeps reading 0
  expect(await run(body("return (nothere)"), { v5: true })).toBe(0);
});

test("a bare name on a line is 9, or 0x10 when it IS a variable", async () => {
  // TAOOT's zeit2.pup `reutrn 1`, cash1.pup `endocde`
  expect(await errorOf(body("reutrn 1"))).toBe(9);
  expect(await errorOf(body("local reutrn", "reutrn 1"))).toBe(0x10);
});

test("a routine called as a statement cannot return; one called for a value must", async () => {
  const lib = `code answer ()
\treturn (1)
endcode

code nothing ()
endcode

code bail ()
\texitcode
endcode

code pass ()
\tpasscode
endcode
`;
  // 5: Commands can't return a value (TI.EXE 0x4448c8)
  expect(await errorOf(lib + body("answer ()"))).toBe(5);
  expect(await run(lib + body("return (answer ())"))).toBe(1);
  // 6: Functions must return a value (0x44478f endcode, 0x4447a8 exitcode, 0x444911 passcode)
  expect(await errorOf(lib + body("return (nothing ())"))).toBe(6);
  expect(await errorOf(lib + body("return (bail ())"))).toBe(6);
  expect(await errorOf(lib + body("return (pass ())"))).toBe(6);
  // as statements they are fine
  expect(await run(lib + body("nothing ()", "bail ()", "pass ()", "return (2)"))).toBe(2);
  // a `return` with no value is the line break read as one: 0xe
  expect(await errorOf(`code empty ()\n\treturn\nendcode\n` + body("return (empty ())"))).toBe(0xe);
});

test("a plain sendto passes no result pointer; its fx twin does", async () => {
  const s = session();
  s.bootScripts = [s.instanceFrom(compileScript("code ask ()\n\treturn (7)\nendcode\n"), "boot1")!];
  expect(await errorOf(body("sendtoboot (ask ())"), {}, s)).toBe(5);
  expect(await run(body("return (sendtobootfx (ask ()))"), {}, s)).toBe(7);
});

test("arguments bind one for one", async () => {
  const two = "code two (a, b)\n\treturn (a + b)\nendcode\n";
  expect(await run(two + body("return (two (1, 2))"))).toBe(3);
  expect(await errorOf(two + body("return (two (1, 2, 3))"))).toBe(2); // 0x443f26
  expect(await errorOf(two + body("return (two (1))"))).toBe(0x1c); // 0x443f4a
  expect(await errorOf(two + body("return (two ())"))).toBe(0xe); // `)` read as an operand
});

test("a routine no script has is error 4, except the engine's own events", async () => {
  expect(await errorOf(body("nosuchthing ()"))).toBe(4);
  expect(await run(body("openscene ()", "idle ()", "return (1)"))).toBe(1);
  // Dust's table has four more (DF.EXE 0x445238)
  expect(await run(body("endloop ()", "return (1)"), { v1: true })).toBe(1);
  expect(await errorOf(body("endloop ()"))).toBe(4);
});

test("blocks the engines count: a stray endif, a switch with no endswitch", async () => {
  // jones2.pup's brushoff ends `endif` (0x4441cf -> 0x4447e5)
  expect(await errorOf(body("local x", "x = 1", "endif"))).toBe(0x1d);
  // asea1/bsea1/bsea2/wilzeit1 brushoff: a switch the handler's end closes
  const open = (subject: string) =>
    ["code go ()", `\tswitch ${subject}`, "\tcase 1", "\t\treturn (10)", "\tcase 2", "\t\tlocal y", "endcode", ""].join("\n");
  expect(await run(open("1"))).toBe(10); // a case that returns never looks for the end
  expect(await errorOf(open("2"))).toBe(0x1f); // one that runs on does (0x444b50 -> 0x444b90)
  expect(await errorOf(open("3"))).toBe(0x1f); // and so does no match
  // a boolean subject is refused before any case (0x444236)
  expect(await errorOf(body("switch true", "case 1", "endswitch"))).toBe(0xe);
});

test("error(), variable() and random() as the engines answer them", async () => {
  expect(await errorOf(body("error ()"))).toBe(0x2f);
  expect(await errorOf(body("return (variable (\"nobody\"))"))).toBe(9);
  expect(await errorOf(body("variable (\"nobody\", 3)"))).toBe(9); // the setter creates nothing
  expect(await errorOf(body("return (variable (3))"))).toBe(0xe);
  expect(await run(body("local who", "variable (\"who\", 5)", "return (variable (\"WHO\"))"))).toBe(5);
  expect(await errorOf(body("return (random (0))"))).toBe(0xa); // TI.EXE 0x42a942
  expect(await run(body("return (random (0))"), { v1: true })).toBe(1); // DF.EXE has no check
});

test("integers are 32-bit registers", async () => {
  expect(await run(body("return (2147483647 + 1)"))).toBe(-2147483648);
  expect(await run(body("return (65536 * 65536)"))).toBe(0);
  expect(await run(body("return (0 - 2147483647 - 2)"))).toBe(2147483647);
});

test("strings fold A-Z and nothing else", async () => {
  expect(await run(body(`return ("ABC" = "abc")`))).toBe(true);
  expect(await run(body(`return ("É" = "é")`))).toBe(false);
});

test("calcdeg is the octant table, calcdist a floor root, calcmod idiv's remainder", async () => {
  // the axes and diagonals are constants (TI.EXE 0x43d480)
  expect([engineBearing(1, 0), engineBearing(0, 1), engineBearing(-1, 0), engineBearing(0, -1)]).toEqual([0, 0x40, 0x80, 0xc0]);
  expect([engineBearing(1, 1), engineBearing(-1, 1), engineBearing(-1, -1), engineBearing(1, -1)]).toEqual([0x20, 0x60, 0xa0, 0xe0]);
  // (297 << 9) / 300 = 506, table[506] = 31 — atan2 rounds to 32
  expect(engineBearing(300, 297)).toBe(31);
  expect(await run(body("return (calcdeg (makepoint (0, 0), makepoint (300, 297)))"))).toBe(31);
  // √13 = 3.6 is 3 (0x436100), not 4
  expect(await run(body("return (calcdist (makepoint (0, 0), makepoint (2, 3)))"))).toBe(3);
  expect(await run(body("return (calcmod (0 - 7, 3))"))).toBe(-1);
  expect(await run(body("return (sqrt (0 - 1))"))).toBe(65535);
});

test("keyaborts: Escape held stops the script after its statement with 0x35", async () => {
  const s = session();
  s.keyAborts = true;
  s.escapeDown = true;
  expect(await errorOf(body("local x", "x = 1", "return (x)"), {}, s)).toBe(0x35);
  s.escapeDown = false;
  expect(await run(body("local x", "x = 1", "return (x)"), {}, s)).toBe(1);
});

test("twenty nested whiles is error 3 (TI.EXE 0x4445fc)", async () => {
  const deep = (n: number) =>
    body(
      "local i",
      ...Array.from({ length: n }, () => "while i = 0"),
      "i = 1",
      ...Array.from({ length: n }, () => "endwhile"),
      "return (1)",
    );
  expect(await run(deep(19))).toBe(1);
  expect(await errorOf(deep(20))).toBe(3);
});

test("TI.EXE's commands this port lacked", async () => {
  expect(await run(body(`return (type (true) @ type ("x") @ type (1))`))).toBe("logictextnumber");
  expect(await run(body("return (networkon ())"))).toBe(false);
  expect(await errorOf(body("netourid ()"))).toBe(0x3a);
  expect(await run(body(`return (pluginexists ("xray"))`))).toBe(true);
  expect(await run(body(`global zz`, `return (indextoglobal (countglobals ()))`))).toBe("zz");
  expect(await errorOf(body("return (indextoglobal (0))"))).toBe(0xa);
  expect(await errorOf(body(`actorlock ("nobody", true)`))).toBe(0xa);
  expect(await run(body("return (machinespeed ())"))).toBe(586);
});

test("the first error is the one the player is asked about, in TI.EXE's words", async () => {
  const s = session();
  const asked: number[] = [];
  let quits = 0;
  s.onScriptErrorBox = (code) => {
    asked.push(code);
    return false; // "No"
  };
  s.onQuit = () => {
    quits++;
  };
  await errorOf(body("error ()"), {}, s);
  await new Promise((r) => setTimeout(r, 0));
  expect(asked).toEqual([0x2f]);
  expect(quits).toBe(1);
  // a second error raised before the box is up waits behind the first and is
  // dropped (0x40722d: the latch keeps the first)
  s.scriptErrorLatched(new ScriptError(9, "one"));
  s.scriptErrorLatched(new ScriptError(4, "two"));
  await new Promise((r) => setTimeout(r, 0));
  expect(asked).toEqual([0x2f, 9]);
  expect(s.scriptErrors.map((e) => e.code)).toEqual([0x2f, 9, 4]);
  expect(scriptErrorBoxText(0x2f)).toBe(
    'A scripting error has occured.  Choose "Yes" to try ignoring the error, or "No" to quit.  [Runtime user error.]',
  );
  expect(scriptErrorBoxText(9, "fr")).toBe(
    'Erreur de script. Cliquez sur "Oui" pour que le programme tente d\'ignorer l\'erreur, ou sur "Non" pour quitter.  [Variable inexistante.]',
  );
});

test("DF.EXE shows nothing, and a headless session goes on", async () => {
  const dust = session({ v1: true });
  let asked = 0;
  dust.onScriptErrorBox = () => {
    asked++;
    return true;
  };
  await errorOf(body("error ()"), { v1: true }, dust);
  await new Promise((r) => setTimeout(r, 0));
  expect(asked).toBe(0);
  expect(dust.scriptErrors).toHaveLength(1);
  // no host hook: nothing is asked and nothing quits
  const headless = session();
  let quits = 0;
  headless.onQuit = () => {
    quits++;
  };
  await errorOf(body("error ()"), {}, headless);
  await new Promise((r) => setTimeout(r, 0));
  expect(quits).toBe(0);
});
