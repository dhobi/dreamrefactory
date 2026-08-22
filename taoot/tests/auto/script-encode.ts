/**
 * The script WRITE path: the assembler (engine/src/df/script-asm.ts) and the encoder
 * (`encodeScript`), checked against the decoder and the engine's parser that
 * every shipped script goes through.
 *
 * Self-contained — no gamefiles/ — because the invariant is a round trip:
 * tokens → bytes → tokens is the identity, and source → bytes → AST produces the
 * handlers the source declared. That is what an authored asset (public/lang.stg,
 * built by taoot/tools/mklangstg.ts) rests on: the engine must not be able to tell our
 * containers from CyberFlix's.
 */
import { test, expect } from "vitest";
import {
  OPCODES,
  OPCODE_IDS,
  Token,
  decodeScript,
  encodeScript,
  opcodeId,
  scriptToText,
} from "@dreamfactory/engine/df/script";
import { AssembleError, assembleScript, compileScript } from "@dreamfactory/engine/df/script-asm";
import { parseScript } from "@dreamfactory/engine/runtime/parser";

test("the opcode table is 1:1, so a name resolves to exactly one id", () => {
  expect(OPCODE_IDS.size).toBe(OPCODES.size);
  for (const [id, name] of OPCODES) expect(opcodeId(name)).toBe(id);
  expect(() => opcodeId("nosuchcommand")).toThrow();
});

test("encode → decode is the identity over every token kind", () => {
  const tokens: Token[] = [
    { kind: "break", indent: 0 },
    { kind: "op", id: opcodeId("code"), name: "code" },
    { kind: "var", name: "mousedown" },
    { kind: "op", id: opcodeId("("), name: "(" },
    { kind: "op", id: opcodeId(")"), name: ")" },
    { kind: "break", indent: 1 },
    { kind: "op", id: opcodeId("gotoflat"), name: "gotoflat" },
    { kind: "op", id: opcodeId("("), name: "(" },
    { kind: "str", value: "wait" },
    { kind: "op", id: opcodeId(")"), name: ")" },
    { kind: "break", indent: 1 },
    { kind: "var", name: "n" },
    { kind: "op", id: opcodeId("="), name: "=" },
    { kind: "int", value: 4294967295 },
    { kind: "break", indent: 0 },
    { kind: "op", id: opcodeId("endcode"), name: "endcode" },
  ];
  expect(decodeScript(encodeScript(tokens))).toEqual(tokens);
});

test("the segment stream is 8 bytes a token, zero-terminated, pool behind it", () => {
  const tokens: Token[] = [
    { kind: "var", name: "same" },
    { kind: "str", value: "same" }, // identical text: pooled once
    { kind: "var", name: "same" },
  ];
  const bytes = encodeScript(tokens);
  // 3 segments + terminator, then one pascal string of 4 characters
  expect(bytes.length).toBe(4 * 8 + 5);
  const view = new DataView(bytes.buffer);
  expect(view.getUint16(3 * 8, true)).toBe(0); // the terminator
  // all three point at the same pooled string (info is relative to the segment)
  const target = (i: number): number => i * 8 + view.getUint32(i * 8 + 2, true);
  expect([target(0), target(1), target(2)]).toEqual([32, 32, 32]);
  expect(decodeScript(bytes)).toEqual(tokens);
});

test("what cannot be encoded is refused, not silently mangled", () => {
  expect(() => encodeScript([{ kind: "int", value: -1 }])).toThrow(/integer literal/);
  expect(() => encodeScript([{ kind: "int", value: 1.5 }])).toThrow(/integer literal/);
  expect(() => encodeScript([{ kind: "op", id: 9999, name: "nope" }])).toThrow(/unknown opcode/);
  expect(() => encodeScript([{ kind: "str", value: "x".repeat(256) }])).toThrow(/too long/);
});

// --- the assembler ----------------------------------------------------------

const SOURCE = `code mousedown()
	global taootlang
	taootlang = "de"
	gotoflat("wait")
endcode`;

test("assembled source carries indent, names and commands apart", () => {
  const tokens = assembleScript(SOURCE);
  // rendered back in dfet's style (a command keeps its trailing space before "(")
  expect(scriptToText(tokens).trim()).toBe(
    [
      "code mousedown ()",
      "\tglobal taootlang",
      '\ttaootlang = "de"',
      '\tgotoflat ("wait")',
      "endcode",
    ].join("\n"),
  );
  // `mousedown` is a handler NAME (no such opcode); `gotoflat` is command 12062
  expect(tokens).toContainEqual({ kind: "var", name: "mousedown" });
  expect(tokens).toContainEqual({ kind: "op", id: 12062, name: "gotoflat" });
  // the indented lines carry indent 1, the closer indent 0
  expect(tokens.filter((t) => t.kind === "break").map((t) => (t as { indent: number }).indent))
    .toEqual([0, 1, 1, 1, 0]);
});

test("compiled source parses into the handler it declares", () => {
  const script = parseScript(decodeScript(compileScript(SOURCE)));
  expect([...script.codes.keys()]).toEqual(["mousedown"]);
  const body = script.codes.get("mousedown")!.body;
  expect(body[0]).toEqual({ t: "decl", kind: "global", names: ["taootlang"] });
  expect(body[1]).toEqual({ t: "assign", name: "taootlang", value: { t: "str", v: "de" } });
  expect(body[2]).toMatchObject({ t: "callstmt", call: { name: "gotoflat", id: 12062 } });
});

test("a handler named after a command is still a name", () => {
  // `code delay()` — 12004 is the `delay` command; the header must not become one
  const script = parseScript(decodeScript(compileScript("code delay(n, mode)\n\tdelay(n)\nendcode")));
  const block = script.codes.get("delay")!;
  expect(block.params).toEqual(["n", "mode"]);
  // inside the body, `delay` IS the command again
  expect(block.body[0]).toMatchObject({ t: "callstmt", call: { name: "delay", id: 12004 } });
});

test("declaration lists, operators and comments", () => {
  const tokens = assembleScript('global a, b // the two of them\nif a != b\n\tmessage("x" @ a)\nendif');
  expect(tokens).toContainEqual({ kind: "var", name: "b" });
  expect(tokens.some((t) => t.kind === "op" && t.name === "!=")).toBe(true);
  expect(tokens.some((t) => t.kind === "op" && t.name === "@")).toBe(true);
  expect(tokens.some((t) => t.kind === "var" && t.name === "the")).toBe(false); // comment dropped
  const script = parseScript(tokens);
  expect(script.topLevel[0]).toEqual({ t: "decl", kind: "global", names: ["a", "b"] });
});

test("an unterminated string is an assembler error, with the line", () => {
  expect(() => assembleScript('a = "oops')).toThrow(AssembleError);
  expect(() => assembleScript('x = 1\ny = "oops')).toThrow(/line 2/);
});
