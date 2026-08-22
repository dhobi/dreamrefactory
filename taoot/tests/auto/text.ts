/**
 * The character set game text is stored in (engine/src/df/text.ts), the per-language
 * table that says which one (taoot/src/languages.ts), and the line breaking that has
 * to cope with the result (engine/src/web/fonts.ts).
 *
 * The table is the part worth defending. No DF file declares an encoding — the
 * container and dialogue-record headers are identical across all six shipped
 * trees, and the original just handed the bytes to `TextOutA` under whatever
 * ANSI code page Windows was running — so the table is a claim about the data
 * rather than something read out of it, and a wrong entry does not fail, it
 * mojibakes. The corpus test below re-derives every entry from the shipped
 * puppet files and refuses to let the two drift apart.
 */
import { test, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_ENCODING, decodeText, encodeText, sniffEncoding } from "@dreamfactory/engine/df/text";
import { LANGUAGES, encodingOf } from "../../src/languages";
import { readPupFile } from "@dreamfactory/engine/df/pup";
import { wrapText } from "@dreamfactory/engine/web/fonts";
import { gamefilesRoot } from "../../tools/gamefiles";

// --- decoding ---------------------------------------------------------------

/** a latin1 string of the given bytes — what BinaryReader.pstr hands back */
const raw = (...bytes: number[]): string => String.fromCharCode(...bytes);

test("decodeText reads the three code pages the shipped trees use", () => {
  // Mac OS Roman: German ß/ö/ü, French â/ç, and the en-dash that makes even
  // the English tree wrong when it is read as latin1
  expect(decodeText(raw(0x6d, 0x75, 0xa7), "macintosh")).toBe("muß");
  expect(decodeText(raw(0x73, 0x63, 0x68, 0x9a, 0x6e), "macintosh")).toBe("schön");
  expect(decodeText(raw(0x63, 0x68, 0x89, 0x6c, 0x65), "macintosh")).toBe("châle");
  expect(decodeText(raw(0xd1), "macintosh")).toBe("—"); // "a world Ñ my world" in the credits
  expect(decodeText(raw(0xd5), "macintosh")).toBe("’"); // "fotoÕs" in the Dutch tree
  // Windows-1251
  expect(decodeText(raw(0xc6, 0xe5, 0xed, 0xf1, 0xea, 0xe0, 0xff), "windows-1251")).toBe("Женская");
  // Shift-JIS, including the full-width space and question mark
  expect(decodeText(raw(0x8f, 0x97, 0x95, 0xa8, 0x82, 0xcc), "shift_jis")).toBe("女物の");
  expect(decodeText(raw(0x81, 0x48, 0x81, 0x40), "shift_jis")).toBe("？　");
});

test("decodeText leaves ASCII alone, whatever the encoding", () => {
  // every identifier in the game goes through pstr as well; all three code
  // pages agree with ASCII below 0x80, which is what makes that safe
  const ident = "vlad2.01 boot script";
  for (const enc of ["macintosh", "windows-1251", "shift_jis"] as const) {
    expect(decodeText(ident, enc)).toBe(ident);
  }
});

test("encodeText puts text back as the same bytes it came from", () => {
  const cases: [string, Parameters<typeof decodeText>[1]][] = [
    [raw(0x6d, 0x75, 0xa7, 0x20, 0x9a), "macintosh"],
    [raw(0xc6, 0xe5, 0xed, 0xf1, 0xea, 0xe0, 0xff), "windows-1251"],
    [raw(0x8f, 0x97, 0x95, 0xa8, 0x82, 0xcc, 0x83, 0x56), "shift_jis"],
  ];
  for (const [bytes, enc] of cases) {
    const back = encodeText(decodeText(bytes, enc), enc, 255);
    expect([...back]).toEqual([...bytes].map((c) => c.charCodeAt(0)));
  }
});

test("encodeText clamps by byte and never splits a character", () => {
  const jp = decodeText(raw(0x8f, 0x97, 0x95, 0xa8, 0x82, 0xcc), "shift_jis"); // 3 chars, 6 bytes
  expect(jp).toHaveLength(3);
  // a 5-byte field holds two whole characters, not two and a half
  const clamped = encodeText(jp, "shift_jis", 5);
  expect(clamped).toHaveLength(4);
  expect(decodeText(String.fromCharCode(...clamped), "shift_jis")).toBe("女物");
  // and what the encoding cannot express degrades rather than throwing
  expect([...encodeText("女", "macintosh", 255)]).toEqual([0x3f]);
});

// --- guessing ---------------------------------------------------------------

test("sniffEncoding tells the three apart, and defaults when it cannot", () => {
  expect(sniffEncoding([])).toBe(DEFAULT_ENCODING);
  expect(sniffEncoding(["No, I need a way off the ship."])).toBe(DEFAULT_ENCODING);
  // Latin-with-accents stays Latin: a couple of high bytes in a line of ASCII
  // is nothing like a script that is entirely non-ASCII
  expect(sniffEncoding([raw(0x4e, 0x65, 0x69, 0x6e, 0x2c, 0x20, 0x6d, 0x75, 0xa7)])).toBe(
    "macintosh",
  );
  expect(sniffEncoding([raw(0xc6, 0xe5, 0xed, 0xf1, 0xea, 0xe0, 0xff)])).toBe("windows-1251");
  expect(sniffEncoding([raw(0x8f, 0x97, 0x95, 0xa8, 0x82, 0xcc, 0x83, 0x56)])).toBe("shift_jis");
});

// --- the table, against the shipped data ------------------------------------

/** every .pup under a language tree, or [] if that language is not installed */
function pupsIn(code: string, limit: number): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    if (found.length >= limit) return;
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const e of entries) {
      if (found.length >= limit) return;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.toLowerCase().endsWith(".pup")) found.push(p);
    }
  };
  walk(join(gamefilesRoot(), code));
  return found;
}

/**
 * The encoding claimed for each language must be the one its own puppet files
 * are actually in.
 *
 * Sniffing is deliberately not what the runtime does — it needs a whole file of
 * dialogue to be reliable, and the engine has to decode the bootfile before it
 * has read a single line — but it is a completely independent reading of the
 * same question, which is exactly what a table of hand-entered claims needs
 * standing behind it. Languages that are not installed are skipped rather than
 * failed: a checkout with only `gamefiles/en/` is normal.
 */
test("every language's declared encoding matches its shipped puppet files", () => {
  const checked: string[] = [];
  for (const { code } of LANGUAGES) {
    const pups = pupsIn(code, 6);
    if (!pups.length) continue;
    const lines: string[] = [];
    for (const p of pups) {
      try {
        for (const line of readPupFile(readFileSync(p)).dialogue.values()) lines.push(line.raw);
      } catch {
        // one shipped puppet in the German tree is not a readable container;
        // the other five in the sample carry the answer
      }
    }
    if (!lines.length) continue;
    expect(sniffEncoding(lines), `gamefiles/${code}/ reads as`).toBe(encodingOf(code));
    checked.push(code);
  }
  // the whole point is comparing against real data; silently checking nothing
  // would let the table rot behind a green test
  expect(checked.length, "no language trees found under gamefiles/").toBeGreaterThan(0);
});

test("an unknown language, and the neutral tree, fall back to Mac OS Roman", () => {
  expect(encodingOf("")).toBe(DEFAULT_ENCODING);
  expect(encodingOf("zz")).toBe(DEFAULT_ENCODING);
  expect(encodingOf("EN")).toBe("macintosh");
  expect(encodingOf("ja")).toBe("shift_jis");
});

// --- line breaking ----------------------------------------------------------

/** a stand-in for canvas measureText: one unit per character */
const monospace = (s: string): number => s.length;

test("wrapText breaks Latin at spaces", () => {
  expect(wrapText("the quick brown fox jumps", 10, monospace)).toEqual([
    "the quick",
    "brown fox",
    "jumps",
  ]);
});

test("wrapText breaks Japanese between characters", () => {
  // the reported bug: no spaces, so a space-splitting wrapper saw one word it
  // could never fit and ran the whole line off both edges of the band
  const jp = "女物のショールか？これなら誰も気づかない";
  const lines = wrapText(jp, 8, monospace);
  expect(lines.length).toBeGreaterThan(1);
  for (const ln of lines) expect(ln.length).toBeLessThanOrEqual(9); // 8, +1 for hanging punctuation
  expect(lines.join("")).toBe(jp);
});

test("wrapText does not start a line with Japanese closing punctuation", () => {
  // breaking before 。or ？ is the one break that reads as broken; it hangs
  // past the measured width instead
  const lines = wrapText("ショール？ですか", 5, monospace);
  for (const ln of lines) expect(ln.startsWith("？")).toBe(false);
  expect(lines.join("")).toBe("ショール？ですか");
});

test("wrapText always returns a line, and drops the space it broke at", () => {
  expect(wrapText("", 10, monospace)).toEqual([""]);
  expect(wrapText("aaaa bbbb", 4, monospace)).toEqual(["aaaa", "bbbb"]);
});
