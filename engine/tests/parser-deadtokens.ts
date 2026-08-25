/**
 * Dead tokens between handlers, and the four rules the parser follows around
 * them (engine/src/runtime/parser.ts, `parseScript`).
 *
 *   npx vitest run engine/tests/parser-deadtokens.ts
 *
 * A compiled container can carry fragments of an earlier compile after a
 * handler's `endcode`. The original engine never saw them — it dispatches to a
 * handler by name and never walks past the one it wants — but this port parses
 * the whole container up front, so it walks into them, and a parser that threw
 * there cost the caller every handler in the file.
 *
 * Timelapse is what found it: its BOOTFILE's first container ends `endcode ( )`,
 * two tokens past the last handler, and those two tokens were the whole reason
 * `boot` could not be called. Written in source form via the assembler rather
 * than as hand-built token arrays, because the shapes below are what the 1996
 * compiler emitted and they should be legible as that.
 */
import { test, expect } from "vitest";
import { assembleScript } from "@dreamfactory/engine/df/script-asm";
import { parseScript } from "@dreamfactory/engine/runtime/parser";

const handlers = (source: string): string[] => [...parseScript(assembleScript(source)).codes.keys()];

/**
 * The Timelapse BOOTFILE's shape exactly: a stray pair of parentheses after the
 * last `endcode`. `(` opens an expression statement that never closes, so this
 * used to throw `expected ), got undefined` and take all of the handlers with it.
 */
test("a stray expression after the last endcode does not cost the handlers", () => {
  expect(
    handlers(`code boot ()
\tenterworld ("I")
endcode

code initglobals ()
\tbaseflat = ""
endcode
()
`),
  ).toEqual(["boot", "initglobals"]);
});

/**
 * ...and the recovery is a RESYNC, not a stop: a live handler after the rubbish
 * is still found. This is the Timelapse stage mains' shape — the `case` limbs of
 * a `getframeaction` switch left behind outside any `code`.
 */
test("a handler after the dead tokens is still found", () => {
  expect(
    handlers(`code getframeaction (num)
\treturn ("X J.105 TL.101 TR.103 L2 R2 ")
endcode
\tcase 100
\t\treturn ("X J.105 TL.101 TR.103 L2 R2 ")
\tcase 101
\t\treturn ("X J.331 TL.102 TR.100 L2 R2 ")

code mousedown ()
\tgotoflat ("i0001.100")
endcode
`),
  ).toEqual(["getframeaction", "mousedown"]);
});

/**
 * The restart is from where the failed statement BEGAN, not from where it gave
 * up. `parseStmt` consumes as it goes, so a resync from the failure point could
 * skip a `code` the doomed statement had already swallowed — and the handler
 * after the rubbish would go missing for a reason nothing in the file explains.
 */
test("a failing statement cannot swallow the handler behind it", () => {
  expect(
    handlers(`code first ()
\treturn (1)
endcode
\t( "unclosed"
code second ()
\treturn (2)
endcode
`),
  ).toEqual(["first", "second"]);
});

/**
 * Dead tokens BEFORE the first handler, too — the same rubbish, on the other
 * side of it.
 *
 * The gate used to be "at least one handler has parsed already", which caught a
 * fragment after a handler and not the identical fragment in front of one. Three
 * of Timelapse's flat scripts open with a stray integer and then a perfectly good
 * `code setcursor (arg)`, and Dust has one: BOLIVAR.PUP's container 34 carries a
 * whole abandoned compile at top level — a closed `switch`, an `if` with an
 * unbalanced paren, and a `case` outside any switch at all — in front of
 * `runyoself`, `dbljump` and `hasjump`, and was losing all three.
 *
 * Nothing is lost by dropping it: the engine dispatches handlers BY NAME and
 * never runs a container's top level, which is why the compiler could leave that
 * there for thirty years without anyone noticing.
 */
test("dead tokens before the first handler cost nothing either", () => {
  expect(
    handlers(`\t355
code setcursor (arg)
\tcursor ("touch")
endcode
`),
  ).toEqual(["setcursor"]);
});

/**
 * The gate that remains, and it is the one that matters: a container that
 * declares NO handler at all is still a parse error.
 *
 * It is what keeps this from quietly reporting data as an empty script. These
 * discs carry 31 one-token containers that `sniffScript` cannot tell from a
 * script — a lone `262144`, three NUL bytes read as a string — and Titanic's
 * carry 273. They are movie and stage payload, not code, and a throw is the
 * right answer for them.
 */
test("a container that declares no handler is still a parse error", () => {
  expect(() => handlers(`\t262144\n`)).toThrow();
  expect(() => handlers(`\t()\n`)).toThrow();
});

/**
 * A `case` closes every block still open inside the case before it.
 *
 * The compiler omits an `endif` where nothing could reach past it — both arms of
 * the `if` return — and the next `case` is what closes it, exactly as the
 * original's jump table does. Five of Timelapse's stage mains are this shape,
 * which was five stages whose whole `getframeaction` navigation table was
 * missing. Taken verbatim from E026.STG's case 140.
 */
test("a case closes an if whose endif was never written", () => {
  const script = handlers(`code getframeaction (num)
\tswitch num
\t\tcase 140
\t\t\tif gateopen = 1
\t\t\t\treturn ("J.136 X TL.141 TR.239 L2 R2 ")
\t\t\telse
\t\t\t\treturn ("J.136 X TL.141 TR.139 L2 R2 ")
\t\tcase 141
\t\t\treturn ("X X TL.142 TR.140 L2 R2 ")
\tendswitch
endcode

code mousedown (arg)
\tgotoflat ("next")
endcode
`);
  expect(script).toEqual(["getframeaction", "mousedown"]);
});

/** ...and `endswitch` does the same where the last case is the unclosed one */
test("endswitch closes an unclosed if in the final case", () => {
  expect(
    handlers(`code getframeaction (num)
\tswitch num
\t\tcase 1
\t\t\tif open
\t\t\t\treturn ("a")
\t\t\telse
\t\t\t\treturn ("b")
\tendswitch
\treturn ("fallthrough")
endcode
`),
  ).toEqual(["getframeaction"]);
});

/**
 * But a well-formed switch is untouched: where the `endif` IS written, the
 * block's own closer is reached first and the tolerance is never consulted. The
 * shape below is what most of the corpus looks like.
 */
test("a switch whose ifs are closed parses to the same handlers", () => {
  expect(
    handlers(`code getframeaction (num)
\tswitch num
\t\tcase 1
\t\t\tif open
\t\t\t\treturn ("a")
\t\t\telse
\t\t\t\treturn ("b")
\t\t\tendif
\t\tcase 2
\t\t\treturn ("c")
\tendswitch
endcode
`),
  ).toEqual(["getframeaction"]);
});

/**
 * `exitcode ()` and `passcode ()` — the same keyword with an empty argument list,
 * which is how Timelapse's compiler writes both.
 *
 * A different shape from the dead tokens above and it needed its own fix: these
 * are INSIDE a handler, so the tolerance between handlers correctly does not
 * apply and a throw here loses the whole container. Three of Timelapse's shop
 * scripts were discarded for it, `i.shp`'s main among them — which is why the
 * intro world's `openshop` and every `sendtoshop` into it did nothing.
 */
test("exitcode and passcode take an empty argument list", () => {
  const src = `code mousedown (arg)
\tif locked
\t\texitcode ()
\tendif
\tif other
\t\tpasscode ()
\tendif
\tgotoflat ("next")
endcode

code setcursor (arg)
\tcursor ("touch")
endcode
`;
  // both handlers survive, which is the part that was being lost
  expect(handlers(src)).toEqual(["mousedown", "setcursor"]);
});

test("...and the bare form still parses, as both other games write it", () => {
  expect(
    handlers(`code mousedown (arg)
\tif locked
\t\texitcode
\tendif
\tpasscode
endcode
`),
  ).toEqual(["mousedown"]);
});

/**
 * Only the EMPTY form. `exitcode (x)` appears nowhere in any of the three corpora
 * and would mean something this grammar has no reading for, so it stays an error
 * rather than a silently dropped expression — the same line the dead-token
 * tolerance draws.
 */
test("but an argument to exitcode is still a parse error", () => {
  expect(() =>
    handlers(`code mousedown (arg)
\texitcode (1)
endcode
`),
  ).toThrow();
});
