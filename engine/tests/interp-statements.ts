/**
 * The interpreter's statements and values off the main road
 * (engine/src/runtime/interp.ts): what DreamFactory 5's untyped reading lets
 * through that the older engines refuse, the recursion and runaway guards,
 * missing arguments, v5 array elements, the unknown-command log, and the
 * boolean tag's payload as a number and a flag.
 *
 *   npx vitest run engine/tests/interp-statements.ts
 *
 * Needs no game data.
 */
import { expect, test, vi } from "vitest";
import { assembleScript, compileScript } from "@dreamfactory/engine/df/script-asm";
import { parseScript } from "@dreamfactory/engine/runtime/parser";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { Logic, ScriptError, ScriptInstance, toNum, truthy, valueEq } from "@dreamfactory/engine/runtime/interp";
import { GameSession } from "@dreamfactory/engine/runtime/session";

function session(v5: boolean): GameSession {
  const s = new GameSession(() => null, new NullAudioSink());
  s.onLog = () => {};
  s.isV5 = v5;
  return s;
}

async function run(source: string, v5: boolean, s = session(v5), args: number[] = []) {
  const inst = s.instanceFrom(compileScript(source), "t")!;
  return (await s.interp.runHandler(inst, "go", args, { me: "t", target: "" })).value;
}
const errorOf = (source: string, v5: boolean) =>
  run(source, v5).then(
    () => null,
    (e: unknown) => (e instanceof ScriptError ? e.code : (e as Error).message),
  );
const body = (...lines: string[]) => ["code go ()", ...lines.map((l) => `\t${l}`), "endcode", ""].join("\n");

test("DreamFactory 5 lets through what the typed engines refuse", async () => {
  // a bare name, stray closers, a `return` with nothing after it
  expect(await run(body("reutrn 1", "return (5)"), true)).toBe(5);
  expect(await errorOf(body("reutrn 1", "return (5)"), false)).toBe(9);
  for (const stray of ["endif", "else", "endwhile", "endfor", "endswitch"]) {
    expect(await run(body(stray, "return (2)"), true)).toBe(2);
  }
  expect(await errorOf(body("endwhile"), false)).toBe(0x25);
  expect(await errorOf(body("endswitch"), false)).toBe(0x1f);
  expect(await errorOf(body("endfor"), false)).toBe(0x1e);
  expect(await errorOf(body("else"), false)).toBe(0x1d);
  expect(await run(["code go ()", "\treturn", "endcode", ""].join("\n"), true)).toBe(0);
  // more on a line than its statement
  expect(await run(body("if true 3", "endif", "return (4)"), true)).toBe(4);
  expect(await errorOf(body("if true 3", "endif", "return (4)"), false)).toBe(0x1b);
});

test("an untyped for with a step of 0 is refused; any other step counts both ways", async () => {
  expect(await errorOf(body("local i", "for i = 1 to 3 step 0", "endfor"), true)).toBe("for loop with step 0");
  expect(await run(body("local i, n", "n = 0", "for i = 5 to 1 step -2", "n = n + i", "endfor", "return (n)"), true)).toBe(9);
  expect(await run(body("local i", "for i = 1 to 3", "return (i * 10)", "endfor"), true)).toBe(10);
});

test("an untyped binary operation: & | @ and arithmetic over mixed values", async () => {
  // without short-circuit RedJack still answers 1/0
  expect(await run(body("return (1 & 0)"), true)).toBe(0);
  expect(await run(body("return (0 | 3)"), true)).toBe(1);
  expect(await run(body(`return ("a" @ 2)`), true)).toBe("a2");
  expect(await run(body(`return ("4" + 3)`), true)).toBe(7);
});

test("handlers nested 64 deep are error 0x2c; a missing argument is 0", async () => {
  const deep = ["code go ()", "\treturn (go ())", "endcode", ""].join("\n");
  expect(await errorOf(deep, true)).toBe(0x2c);
  const s = session(true);
  const inst = s.instanceFrom(compileScript(["code go (a, b)", "\treturn (a + b)", "endcode", ""].join("\n")), "t")!;
  expect((await s.interp.runHandler(inst, "go", [4], { me: "t", target: "" })).value).toBe(4);
});

test("a command that throws something other than a script error is not latched, and goes on up", async () => {
  const s = session(false);
  s.interp.register("explode", () => {
    throw new Error("boom");
  });
  await expect(run(body("explode ()"), false, s)).rejects.toThrow("boom");
  expect(() => s.interp.register("explode", () => 0)).toThrow("builtin registered twice: explode");
});

test("an unknown command is warned of once, by name", async () => {
  const s = session(true);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await run(body("nosuchthing (1)", "nosuchthing (2)", "return (1)"), true, s);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("nosuchthing(1)");
  } finally {
    warn.mockRestore();
  }
});

test("a while loop that never gives up a frame is a runaway after 100k passes", async () => {
  expect(await errorOf(body("while true", "endwhile"), true)).toBe("while loop runaway (100k iterations)");
});

/** v5 source with `lbrk` / `rbrk` standing for the brackets the assembler has no spelling for */
const bracketed = (source: string) =>
  parseScript(assembleScript(source).map((t) => {
    if (t.kind === "var" && t.name === "lbrk") return { kind: "op", id: 4033, name: "[" } as const;
    if (t.kind === "var" && t.name === "rbrk") return { kind: "op", id: 4034, name: "]" } as const;
    return t;
  }));
async function runBracketed(source: string, s: GameSession) {
  const inst = new ScriptInstance("t", bracketed(source));
  return (await s.interp.runHandler(inst, "go", [], { me: "t", target: "" })).value;
}

test("v5 array elements live where their array was declared", async () => {
  expect(await runBracketed(body("local jrep", "jrep lbrk 3 rbrk = 7", "return (jrep lbrk 3 rbrk)"), session(true))).toBe(7);
  const s = session(true);
  expect(await runBracketed(body("global g", "g lbrk 1 rbrk = 2", "free lbrk 2 rbrk = 5", "return (free lbrk 2 rbrk)"), s)).toBe(5);
  expect(s.interp.globals.get("g[1]")).toBe(2);
  expect(s.interp.globals.has("free[2]")).toBe(false);
});

test("the boolean tag: its payload's word is the flag, its payload the number", () => {
  const t = new Logic(0x10000);
  expect(truthy(t)).toBe(false);
  expect(truthy(new Logic(2))).toBe(true);
  expect(toNum(new Logic(7))).toBe(7);
  expect(toNum(true)).toBe(1);
  expect(toNum(false)).toBe(0);
  expect(toNum("12x")).toBe(12);
  expect(toNum("x")).toBe(0);
  expect(truthy("")).toBe(false);
  expect(truthy("a")).toBe(true);
  // untyped, a boolean against text compares as text; typed, never equal
  expect(valueEq(true, "TRUE")).toBe(true);
  expect(valueEq(true, "true", true)).toBe(false);
  expect(valueEq(new Logic(1), true)).toBe(true);
});

test("an `if` with no `endif` in the typed engines: the open count and the skips that meet endcode", async () => {
  // the body runs to the end of the handler with the `if` still open
  expect(await errorOf(body("if true", "local a"), false)).toBe(0x1d);
  // a false `if`'s skip meets endcode
  expect(await errorOf(body("if false", "local a"), false)).toBe(0x1d);
  // the true body runs into its `else`, whose skip meets endcode
  expect(await errorOf(body("if true", "local a", "else", "local b"), false)).toBe(0x1d);
  // the `else` taken: still open at the end
  expect(await errorOf(body("if false", "local a", "else", "local b"), false)).toBe(0x1d);
  // a return inside leaves before any of that
  expect(await run(body("if true", "return (3)"), false)).toBe(3);
  expect(await run(body("if false", "local a", "else", "return (4)"), false)).toBe(4);
});

test("typed for: nested 20 deep is error 3; a step of 0 that never moves is a runaway", async () => {
  const deep = ["code go (n)", "\tlocal i", "\tfor i = 1 to 1", "\t\tgo (n + 1)", "\tendfor", "endcode", ""].join("\n");
  const s = session(false);
  const inst = s.instanceFrom(compileScript(deep), "t")!;
  await expect(s.interp.runHandler(inst, "go", [0], { me: "t", target: "" })).rejects.toMatchObject({ code: 3 });
  expect(await errorOf(body("local i", "for i = 1 to 2 step 0", "endfor"), false)).toBe("for loop runaway (100k iterations)");
});

test("typed for stops at once when the running scripts are abandoned", async () => {
  const s = session(false);
  let n = 0;
  s.interp.register("bail", () => {
    n++;
    s.interp.abandonRunning();
    return 0;
  });
  expect(await run(body("local i", "for i = 1 to 5", "bail ()", "endfor", "return (9)"), false, s)).toBe(0);
  expect(n).toBe(1);
});

test("a boolean case against an integer subject is error 0xe; a boolean subject is refused first", async () => {
  expect(await errorOf(body("switch 1", "case true", "return (1)", "endswitch"), false)).toBe(0xe);
  expect(await errorOf(body("switch true", "case 1", "return (1)", "endswitch"), false)).toBe(0xe);
});
