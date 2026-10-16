import { ScriptError } from "../interp";
import { BuiltinCtx } from "./context";
import { v5Registrar } from "./df5";

/**
 * DreamFactory 5's network commands that no earlier engine had — `netcatchup`,
 * `netsync`, `netclientlatency`, `netrandom`, `nettick`, `netidtostring`,
 * `stringtonetid` — each read out of `RedJack.exe`. Every one answers only in a
 * v5 game.
 *
 * The port is one machine with no peer, so the session is never connected:
 * the word at 0x51adbc, which every one of the first five tests before it so
 * much as reads its argument (0x4246c0, 0x424900, 0x424030, 0x424830,
 * 0x4248b0), stays 0, and each is error 0x40. (TI.EXE's offline error was
 * 0x3a; engine-extras.ts has those.) `netidtostring` and `stringtonetid` ask
 * for no connection: they are a net id's four bytes as text and back.
 */
export function registerDf5NetBuiltins(ctx: BuiltinCtx): void {
  const r5 = v5Registrar(ctx);

  for (const cmd of ["netcatchup", "netsync", "netclientlatency", "netrandom", "nettick"]) {
    r5(cmd, () => {
      throw new ScriptError(0x40, `${cmd}: not connected`);
    });
  }

  // netidtostring (id): an integer (0xe otherwise, 0x424a3c), as text (0x492ca0)
  r5("netidtostring", (_i, [id]) => {
    if (typeof id !== "number") throw new ScriptError(0xe, `netidtostring: ${String(id)} is not an integer`);
    return netIdToString(id);
  });

  // stringtonetid (text): a string (0xe otherwise, 0x424a8c), as a net id (0x492cf0)
  r5("stringtonetid", (_i, [s]) => {
    if (typeof s !== "string") throw new ScriptError(0xe, `stringtonetid: ${String(s)} is not a string`);
    return stringToNetId(s);
  });
}

/** 0x492ca0: `sprintf ("%lu.%lu.%lu.%lu")` of the id's bytes, lowest first — an IPv4 address as it sits in memory */
export function netIdToString(id: number): string {
  return [id & 0xff, (id >>> 8) & 0xff, (id >>> 16) & 0xff, id >>> 24].join(".");
}

/** the separators 0x492cf0 splits on (0x4c2558) */
const SEPARATORS = ",.-:";

/**
 * 0x492cf0: four numbers, split on any of ",.-:", each read by the C runtime's
 * `atol` (0x468300: white space, a sign, digits, wrapping) and added in at
 * bits 0, 8, 16 and 24 — added, not or-ed, so "1.256.0.0" is 0x10001. Separators
 * are skipped only before the first number (0x492d41); after it each one ends
 * a number, so "1..2.3.4" reads 1, 0, 2, 3. A fifth number is ignored.
 *
 * Fewer than four numbers crash RedJack.exe: the tokenizer answers a null
 * pointer once the text runs out (0x492e1a) and the next `strlen` reads
 * address 0 (0x492e7a). Text of nothing but separators crashes the same way,
 * after `strchr` has matched the terminator as one and walked off the end of
 * the string (0x492d4e). Both are thrown here as what they are.
 */
export function stringToNetId(text: string): number {
  // the Pascal string as a C one (0x469230): it ends at its first 0
  const raw = Array.from(text.slice(0, 255), (c) => c.charCodeAt(0) & 0xff);
  const s = raw.includes(0) ? raw.slice(0, raw.indexOf(0)) : raw;
  const len = s.length;
  const isSep = (c: number): boolean => SEPARATORS.includes(String.fromCharCode(c));
  // 0x492d41..0x492d7b: leading separators skipped — and the terminator is one to strchr
  let pos = 0;
  while (pos >= len || isSep(s[pos])) {
    if (pos >= len) throw new Error("stringtonetid: RedJack.exe walks off the text and then reads address 0 here (0x492d4e, 0x492e7a)");
    pos++;
  }
  /** 0x492d7d..0x492dd3: on to the next separator, which is cut to a 0; the token is the C string at `from` */
  const next = (from: number): number[] => {
    while (pos < len && !isSep(s[pos])) pos++;
    const token = s.slice(from, pos);
    if (pos < len) pos++;
    return token;
  };
  const tokens = [next(pos)];
  for (let k = 1; k < 4; k++) {
    if (pos >= len) throw new Error("stringtonetid: RedJack.exe reads address 0 here (0x492e1a -> 0x492e7a), with fewer than four numbers");
    tokens.push(next(pos));
  }
  let id = 0;
  tokens.forEach((t, k) => (id = (id + (atol(t) << (8 * k))) | 0));
  return id;
}

/** 0x468300, MSVC's `atol`: leading white space, one sign, decimal digits, 32-bit wrap */
function atol(b: number[]): number {
  let i = 0;
  while (i < b.length && (b[i] === 0x20 || (b[i] >= 0x09 && b[i] <= 0x0d))) i++;
  const sign = b[i];
  if (sign === 0x2d || sign === 0x2b) i++;
  let n = 0;
  while (i < b.length && b[i] >= 0x30 && b[i] <= 0x39) n = (Math.imul(n, 10) + (b[i++] - 0x30)) | 0;
  return sign === 0x2d ? -n | 0 : n;
}

/**
 * RedJack.exe's random-number generator (0x469290), which `netrandom` draws
 * from the connection's copy of (state +0x20, 0x424882) and `random` from the
 * engine's own (0x4f72c8, 0x469340): 55 words and an index. Each draw steps it
 * twice — index on by one mod 55, the word there replaced by the words 23 and
 * 54 on from it, xor-ed, mod 0xffff — and answers the first new word in the
 * high half and the second in the low. 0x469aa0 seeds the engine's: word 0 is
 * `timeGetTime () % 0xffff`, each next one `(w · 31 + 1) % 0xffff`, index 0.
 *
 * Here only for `netrandom (n)`'s connected answer, `draw () % n + 1` for n
 * above 0 (0x424871..0x42489c), which this machine never reaches.
 */
export class Df5Random {
  readonly table = new Array<number>(55).fill(0);
  index = 0;

  /** 0x469b2c..0x469b69 */
  seed(time: number): void {
    // `cdq; idiv` of timeGetTime's unsigned answer, so a clock past 2^31 is negative
    this.table[0] = (time | 0) % 0xffff;
    for (let k = 1; k < 55; k++) this.table[k] = ((Math.imul(this.table[k - 1], 31) + 1) >>> 0) % 0xffff;
    this.index = 0;
  }

  private step(): number {
    const i = (this.index = (this.index + 1) % 55);
    this.table[i] = ((this.table[(i + 23) % 55] ^ this.table[(i + 54) % 55]) >>> 0) % 0xffff;
    return this.table[i];
  }

  /** 0x469290: one 32-bit draw, unsigned */
  draw(): number {
    const hi = this.step();
    const lo = this.step();
    return ((hi << 16) | lo) >>> 0;
  }
}

