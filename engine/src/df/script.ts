/**
 * DreamFactory 4.0 script container decoder.
 * Port of DFscript (dfet/libs/DFfile/DFscript.cpp).
 *
 * A script is a zero-terminated sequence of 8-byte segments:
 *   u16 cmd, u32 info, u16 pad (always 0)
 * cmd 3 = string literal   (info: byte offset from this segment to a pascal string)
 * cmd 4 = integer literal  (info: the value)
 * cmd 5 = variable name    (info: like string)
 * cmd 6 = line break       (info: indent level in tabs)
 * anything else = command/operator ID (see OPCODES)
 */

// segment kinds (`cmd` values with special payloads — everything else is an opcode)
const STRING = 3;
const INTEGER = 4;
const VARIABLE = 5;
const BREAK = 6;

/** every token is one fixed-width record: u16 cmd, u32 info, u16 pad */
const SEGMENT = 8;

import { pstrAt, writePstrAt } from "./binary";
import { OPCODES } from "./opcodes";

export { OPCODES } from "./opcodes";

export type Token =
  | { kind: "str"; value: string }
  | { kind: "int"; value: number }
  | { kind: "var"; name: string }
  | { kind: "break"; indent: number }
  | { kind: "op"; id: number; name: string };


/**
 * Decode a script container into tokens. Throws if the data does not look
 * like a script (unknown opcode / out-of-bounds string) — callers use this
 * to sniff whether an arbitrary container holds a script.
 */
export function decodeScript(data: Uint8Array): Token[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tokens: Token[] = [];
  let pos = 0;
  for (;;) {
    if (pos + 8 > data.length) throw new Error("script: unterminated segment stream");
    const cmd = view.getUint16(pos, true);
    if (cmd === 0) break;
    const info = view.getUint32(pos + 2, true);
    switch (cmd) {
      case STRING: {
        const at = pos + info;
        if (at >= data.length) throw new Error("script: string offset out of bounds");
        tokens.push({ kind: "str", value: pstrAt(data, at) });
        break;
      }
      case VARIABLE: {
        const at = pos + info;
        if (at >= data.length) throw new Error("script: variable offset out of bounds");
        tokens.push({ kind: "var", name: pstrAt(data, at) });
        break;
      }
      case INTEGER:
        tokens.push({ kind: "int", value: info });
        break;
      case BREAK:
        tokens.push({ kind: "break", indent: info });
        break;
      default: {
        const name = OPCODES.get(cmd);
        if (!name) throw new Error(`script: unknown opcode ${cmd}`);
        tokens.push({ kind: "op", id: cmd, name });
      }
    }
    pos += 8;
  }
  return tokens;
}

/**
 * The opcode table by name — the reverse of {@link OPCODES}, which is 1:1 (all
 * 351 names are distinct, asserted in taoot/tests/auto/script-encode.ts). This is what
 * lets a script be *written*: an assembler needs "gotoflat" → 12062.
 */
export const OPCODE_IDS: ReadonlyMap<string, number> = new Map(
  [...OPCODES].map(([id, name]) => [name, id]),
);

/** id of a command/operator by its source-text name; throws on an unknown one */
export function opcodeId(name: string): number {
  const id = OPCODE_IDS.get(name);
  if (id === undefined) throw new Error(`script: no such command or operator: ${name}`);
  return id;
}

/**
 * Encode tokens into a script container — the write half of {@link decodeScript},
 * and what makes an authored stage possible (see engine/src/df/stg-build.ts): a flat's
 * buttons are real compiled handlers, not a host-side special case.
 *
 * Layout is the one the format doc describes: the 8-byte segment stream, a zero
 * segment to terminate it, then the string pool the string/variable segments
 * point into by an offset FROM THEIR OWN SEGMENT. Identical text is pooled once —
 * a variable and a string literal that read the same share a pascal string,
 * since only the segment's `cmd` distinguishes them.
 *
 * The result is not expected to be byte-identical to CyberFlix's own encoding of
 * the same source (they interned and ordered their pool as their compiler
 * happened to walk it); it is expected to *decode* to the tokens it was given,
 * which is the invariant the round-trip test asserts.
 */
export function encodeScript(tokens: Token[]): Uint8Array {
  // the pool first, so every segment knows where its text will land
  const poolAt = new Map<string, number>();
  let poolLen = 0;
  const textOf = (t: Token): string | null =>
    t.kind === "str" ? t.value : t.kind === "var" ? t.name : null;
  for (const t of tokens) {
    const text = textOf(t);
    if (text === null || poolAt.has(text)) continue;
    // the length is one byte, and `latin1` is the character set on disk
    if (text.length > 255) throw new Error(`script: text too long to encode (${text.length})`);
    poolAt.set(text, poolLen);
    poolLen += 1 + text.length;
  }

  const streamLen = (tokens.length + 1) * SEGMENT; // + the zero terminator
  const out = new Uint8Array(streamLen + poolLen);
  const view = new DataView(out.buffer);
  tokens.forEach((t, i) => {
    const pos = i * SEGMENT;
    switch (t.kind) {
      case "str":
      case "var": {
        const text = textOf(t)!;
        const at = streamLen + poolAt.get(text)!;
        view.setUint16(pos, t.kind === "str" ? STRING : VARIABLE, true);
        view.setUint32(pos + 2, at - pos, true); // the decoder reads pos + info
        writePstrAt(out, at, text, text.length);
        break;
      }
      case "int":
        // `info` is unsigned: a negative literal is the unary "-" operator
        // applied to a positive one, which is how the compiler emitted them too
        if (!Number.isInteger(t.value) || t.value < 0 || t.value > 0xffffffff) {
          throw new Error(`script: cannot encode integer literal ${t.value}`);
        }
        view.setUint16(pos, INTEGER, true);
        view.setUint32(pos + 2, t.value, true);
        break;
      case "break":
        view.setUint16(pos, BREAK, true);
        view.setUint32(pos + 2, t.indent, true);
        break;
      case "op":
        if (!OPCODES.has(t.id)) throw new Error(`script: unknown opcode ${t.id}`);
        view.setUint16(pos, t.id, true);
        break;
    }
  });
  return out;
}

// the four opcodes with special spacing in the rendered source
const OP_LPAREN = 4018;
const OP_RPAREN = 4019;
const OP_COMMA = 4020;
const OP_MINUS = 8002;

/** Render tokens as readable source, closely matching dfet's output style. */
export function scriptToText(tokens: Token[]): string {
  let out = "";
  const trimTrailingSpace = () => {
    if (out.endsWith(" ")) out = out.slice(0, -1);
  };
  for (const t of tokens) {
    switch (t.kind) {
      case "str":
        out += `"${t.value}" `;
        break;
      case "int":
        out += `${t.value} `;
        break;
      case "var":
        out += `${t.name} `;
        break;
      case "break":
        trimTrailingSpace();
        out += "\n" + "\t".repeat(t.indent);
        break;
      case "op":
        if (t.id === OP_LPAREN || t.id === OP_MINUS) {
          // "(" and unary-capable "-" bind tightly: no trailing space
          out += t.name;
        } else if (t.id === OP_RPAREN || t.id === OP_COMMA) {
          // ")" and "," attach to the previous token
          trimTrailingSpace();
          out += t.name + " ";
        } else {
          out += t.name + " ";
        }
        break;
    }
  }
  return out;
}

/** true if the container plausibly holds a script */
export function sniffScript(data: Uint8Array): Token[] | null {
  if (data.length < 8) return null;
  try {
    const tokens = decodeScript(data);
    return tokens.length > 0 ? tokens : null;
  } catch {
    return null;
  }
}
