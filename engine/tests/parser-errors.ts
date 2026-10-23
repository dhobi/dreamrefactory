/**
 * What the script parser refuses (engine/src/runtime/parser.ts): a handler
 * with no name or a parameter that is no name, a declaration or a `for` with no
 * variable, an expression that ends early or breaks its line, a statement that
 * is no command — and how an `if` with no `endif` finds where its skip lands.
 *
 *   npx vitest run engine/tests/parser-errors.ts
 *
 * Needs no game data.
 */
import { expect, test } from "vitest";
import { assembleScript } from "@dreamfactory/engine/df/script-asm";
import { parseScript } from "@dreamfactory/engine/runtime/parser";

const parse = (source: string) => parseScript(assembleScript(source));
const lines = (...l: string[]) => l.join("\n") + "\n";

test("a handler needs a name and names for its parameters", () => {
  expect(() => parse(lines("code 5 ()", "endcode"))).toThrow("expected code block name");
  expect(() => parse(lines("code go (5)", "endcode"))).toThrow("expected parameter name");
});

test("declarations and for loops need a variable", () => {
  expect(() => parse(lines("global 5"))).toThrow("expected name after global");
  expect(() => parse(lines("for 5 = 1 to 2", "endfor"))).toThrow("expected for-loop variable");
});

test("an expression that ends early, or at a line break, is refused", () => {
  expect(() => parse("x = ")).toThrow("unexpected end of expression");
  expect(() => parse(lines("x = ", "y = 1"))).toThrow("unexpected line break in expression");
});

test("a statement must be a command or an assignment, not a value", () => {
  expect(() => parse(lines("true"))).toThrow("expected statement");
  expect(() => parse(lines("x (1) + 2"))).toThrow("bare expression statement");
});

test("an `if` with no `endif` finds the `endif` or `else` a skip would land on", () => {
  const noEndif = (...body: string[]) => {
    const go = parse(lines("code go ()", ...body, "endcode")).codes.get("go")!;
    return JSON.stringify(go.body).match(/"noEndif":"(\w+)"/)?.[1];
  };
  // cut short by the next `case`; an endif after it, past an inner if's own
  const sw = (...arm: string[]) => ["\tswitch 1", "\tcase 1", ...arm, "\tendswitch"];
  expect(noEndif(...sw("\t\tif x", "\t\t\tif y", "\t\t\tendif", "\tcase 2", "\t\tendif"))).toBe("beyond");
  // an else at its own depth is where a false condition's skip lands
  expect(noEndif(...sw("\t\tif x", "\tcase 2", "\t\telse"))).toBe("beyond");
  // nothing after it but the end of the handler
  expect(noEndif(...sw("\t\tif x", "\tcase 2"))).toBe("endcode");
});
