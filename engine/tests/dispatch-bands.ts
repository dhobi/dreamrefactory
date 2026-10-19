/**
 * A command the engine's dispatcher does not reach is error 1 —
 * engine/src/runtime/value-types.ts `dispatches`.
 *
 *   npx vitest run engine/tests/dispatch-bands.ts
 *
 * TI.EXE runs a statement through one dispatcher (0x43c768) and a value
 * through another (0x4258c8), each a pair of jump-table bands; past them both
 * answer `mov ax, 1` (0x43c797, 0x4258f7). DF.EXE's bands are shorter
 * (0x41ee68, 0x42a5b8): its statements stop at 12088 and its values at 20108.
 * DreamFactory 5 is not `typed` and is not asked.
 */
import { expect, test } from "vitest";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { ScriptError } from "@dreamfactory/engine/runtime/interp";

type Opts = { v5?: boolean; v1?: boolean };

const errorOf = async (lines: string[], opts: Opts = {}): Promise<number | null | unknown> => {
  const s = new GameSession(() => null, new NullAudioSink());
  s.onLog = () => {};
  s.isV5 = !!opts.v5;
  if (opts.v1) s.dfVersion = 1;
  const inst = s.instanceFrom(compileScript(["code go ()", "\tlocal x", ...lines.map((l) => `\t${l}`), "endcode", ""].join("\n")), "t")!;
  try {
    await s.interp.runHandler(inst, "go", [], { me: "t", target: "" });
    return null;
  } catch (e) {
    return e instanceof ScriptError ? e.code : e;
  }
};

test("a statement-only command asked for its value is error 1", async () => {
  expect(await errorOf(["x = puppetclear ()"])).toBe(1); // 12041
  expect(await errorOf(["puppetclear ()"])).toBeNull();
});

test("a value-only command written as a statement is error 1", async () => {
  expect(await errorOf(["random (5)"])).toBe(1); // 20001
  expect(await errorOf(["x = random (5)"])).toBeNull();
});

test("a property command is reached both ways", async () => {
  expect(await errorOf(["x = result ()"])).toBeNull(); // 16010
});

test("DF.EXE's bands are shorter than TI.EXE's", async () => {
  // 12089 postscript: past DF.EXE's statement band (cmp eax, 0x57)
  expect(await errorOf(["postscript ()"], { v1: true })).toBe(1);
  expect(await errorOf(["postscript ()"])).toBeNull();
  // 20109 pluginexists: past DF.EXE's value band (cmp eax, 0x6a), inside TI.EXE's
  expect(await errorOf(["x = pluginexists (\"a\")"], { v1: true })).toBe(1);
  expect(await errorOf(["x = pluginexists (\"a\")"])).not.toBe(1);
});

test("DreamFactory 5 is not asked", async () => {
  expect(await errorOf(["x = puppetclear ()"], { v5: true })).not.toBe(1);
});
