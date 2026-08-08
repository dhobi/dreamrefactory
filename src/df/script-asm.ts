/**
 * A DreamFactory script assembler: source text → the tokens
 * {@link encodeScript} writes.
 *
 * The engine reads scripts as a token stream (see script.ts), so "compiling" one
 * is only lexing — there is no tree to build, because the on-disk form *is* the
 * token sequence and the parser in src/engine/parser.ts is what gives it
 * structure. That makes an authored script legible at the point it is written:
 *
 * ```
 * code mousedown()
 *   global taootlang
 *   taootlang = "de"
 *   gotoflat("wait")
 * endcode
 * ```
 *
 * assembles to `break, code, var mousedown, (, ), break, global, var taootlang,
 * …` — exactly what CyberFlix's own compiler put in the file.
 *
 * Scope: the subset an authored asset needs. It knows every command and operator
 * in the opcode table, string/integer literals, variables, comments and indent,
 * and nothing about types or scopes — an assembler, not a type checker. Callers
 * that want to know their script is well-formed run `parseScript` over the
 * result (tools/mklangstg.ts does, before it writes the file).
 *
 * Identifiers are commands when the opcode table names them and variables
 * otherwise, EXCEPT where the grammar can only mean a name: after `code`,
 * `global`/`local`/`dumpglobal`/`dumplocal`, `for`, and inside a `code` header's
 * parameter list. Without those exceptions a handler named after a command
 * (`code delay()`) would assemble to a command token and the parser would reject
 * its own file.
 */
import { OPCODE_IDS, Token, encodeScript, opcodeId } from "./script";

/** symbols, longest first so "!=" wins over "!" and ">=" over ">" */
const SYMBOLS: readonly string[] = [...OPCODE_IDS.keys()]
  .filter((n) => /^[^A-Za-z0-9_ ]+$/.test(n))
  .sort((a, b) => b.length - a.length);

/** opcodes after which the next identifier is always a NAME, never a command */
const NAME_AFTER = new Set(["code", "global", "local", "dumpglobal", "dumplocal", "for"]);

/** opcodes that introduce a comma-separated list of names (`global a, b, c`) */
const NAME_LIST_AFTER = new Set(["global", "local", "dumpglobal", "dumplocal"]);

export class AssembleError extends Error {}

/**
 * Lex script source into tokens. Line breaks become `break` tokens carrying the
 * line's indent (tabs, or two spaces per level) — the format stores indentation
 * as a token because it is what the engine's pretty-printer used, and the parser
 * treats it as the statement separator.
 */
export function assembleScript(source: string): Token[] {
  const tokens: Token[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");

  lines.forEach((raw, lineNo) => {
    const at = (msg: string): AssembleError =>
      new AssembleError(`line ${lineNo + 1}: ${msg}`);
    const indentMatch = /^[\t ]*/.exec(raw)![0];
    const indent =
      (indentMatch.match(/\t/g)?.length ?? 0) +
      Math.floor((indentMatch.match(/ /g)?.length ?? 0) / 2);
    tokens.push({ kind: "break", indent });

    let pos = indentMatch.length;
    // "the next identifier is a name": set by NAME_AFTER, and held across a
    // declaration's comma list / a code header's parameters
    let nameNext = false;
    let nameList = false;
    let headerDepth = 0; // >0 while inside a `code name(...)` parameter list
    let sawCode = false;

    while (pos < raw.length) {
      const ch = raw[pos];
      if (ch === " " || ch === "\t") {
        pos++;
        continue;
      }
      // a `//` comment runs to end of line; the shipped scripts carry them as
      // tokens, but nothing reads them back, so they are dropped here
      if (raw.startsWith("//", pos)) break;

      if (ch === '"') {
        const end = raw.indexOf('"', pos + 1);
        if (end < 0) throw at("unterminated string");
        tokens.push({ kind: "str", value: raw.slice(pos + 1, end) });
        pos = end + 1;
        nameNext = false;
        nameList = false;
        continue;
      }

      const digits = /^\d+/.exec(raw.slice(pos));
      if (digits) {
        tokens.push({ kind: "int", value: Number(digits[0]) });
        pos += digits[0].length;
        nameNext = false;
        nameList = false;
        continue;
      }

      const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(raw.slice(pos));
      if (ident) {
        const name = ident[0];
        const forced = nameNext || headerDepth > 0;
        const id = forced ? undefined : OPCODE_IDS.get(name);
        if (id === undefined) tokens.push({ kind: "var", name });
        else tokens.push({ kind: "op", id, name });
        pos += name.length;
        if (id === undefined) {
          // a name consumed the "next is a name" slot; a declaration list keeps
          // it alive across its commas
          nameNext = nameList;
        } else {
          nameNext = NAME_AFTER.has(name);
          nameList = NAME_LIST_AFTER.has(name);
          if (name === "code") sawCode = true;
        }
        continue;
      }

      const sym = SYMBOLS.find((s) => raw.startsWith(s, pos));
      if (!sym) throw at(`unexpected character ${JSON.stringify(ch)}`);
      tokens.push({ kind: "op", id: opcodeId(sym), name: sym });
      pos += sym.length;
      // the parameter list of a code header: names, not commands
      if (sym === "(" && sawCode) {
        headerDepth++;
        sawCode = false; // only the header's own parameter list, not a later call
      }
      else if (sym === ")" && headerDepth > 0) headerDepth--;
      if (sym !== ",") {
        nameNext = false;
        nameList = false;
      } else {
        nameNext = nameList; // `global a, b` — b is a name too
      }
    }
  });

  return tokens;
}

/** Assemble source and encode it: script text in, container bytes out. */
export function compileScript(source: string): Uint8Array {
  return encodeScript(assembleScript(source));
}
