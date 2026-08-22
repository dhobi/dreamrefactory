/**
 * The character set the game's text is stored in — and the fact that nothing
 * in the data says which one it is.
 *
 * Every string in a DF file is a Pascal string of BYTES. {@link latin1} reads
 * them one byte to one character, which is right for identifiers (prop names,
 * idents, file names — all ASCII) and wrong for anything a player reads: a
 * subtitle byte of 0xA7 is `ß` in German and `§` if you assume Latin-1, and a
 * Japanese line is not single-byte at all.
 *
 * WHERE THE ENCODING IS DECLARED: nowhere in the data. The container and
 * dialogue-record headers are byte-identical across all six shipped trees apart
 * from offsets and sizes; there is no charset field and no font name. The
 * original did it the 1996 way — TI.EXE calls `CreateFontA(..., iCharSet = 1
 * /* DEFAULT_CHARSET *\/, ...)` and `TextOutA`, and the runtime imports
 * `GetACP`, so the bytes are simply in whatever ANSI code page the host Windows
 * was running. The one visible trace of a localiser's decision is the font FACE
 * in the executable: every build asks for "Arial" except the Japanese one,
 * which is a separate binary asking for "mspgothic". That is a hint, not a
 * declaration, and it only exists for Japanese.
 *
 * So the encoding has to come from the one thing we do know — which tree the
 * bytes were read from ({@link import("../languages").LANGUAGES}). What the
 * shipped data actually contains, measured over all 52 puppet files per tree:
 *
 *   en de fr nl   Mac OS Roman   (0xA7 `ß`, 0x9F `ü`, 0x89 `â`, 0xD1 en-dash)
 *   ru            Windows-1251
 *   ja            Shift-JIS (CP932)
 *
 * English is on that list deliberately. It has no accents, but its punctuation
 * is Mac curly quotes and dashes, so reading it as Latin-1 puts `Ñ` in the
 * middle of "the end of a world Ñ my world". Mac OS Roman is the DEFAULT
 * because DreamFactory was Mac authoring software: even the Windows-only French
 * disc carries Mac-encoded text, and the hybrid German and Dutch discs have one
 * shared copy of the data that the Windows build renders slightly wrong.
 */

/**
 * The encodings the shipped trees actually use. All three are WHATWG labels, so
 * `TextDecoder` handles them in both the browser and Node; all three agree with
 * ASCII below 0x80, which is why identifiers can keep being read as latin1.
 */
export type DfEncoding = "macintosh" | "windows-1251" | "shift_jis";

/** what a tree is read as until something says otherwise — see the note above */
export const DEFAULT_ENCODING: DfEncoding = "macintosh";

const decoders = new Map<DfEncoding, TextDecoder>();
const decoderFor = (enc: DfEncoding): TextDecoder => {
  let d = decoders.get(enc);
  if (!d) decoders.set(enc, (d = new TextDecoder(enc)));
  return d;
};

/**
 * Re-read a string that {@link latin1} already turned into one character per
 * byte, this time in a real encoding.
 *
 * Taking the latin1 string rather than the raw bytes is deliberate: the format
 * readers hand back strings, the mapping byte -> U+0000..U+00FF is a bijection,
 * so nothing has been lost yet and this stays a pure post-processing step that
 * no caller has to thread buffers through. Pure ASCII returns unchanged, which
 * is every identifier and every English line.
 */
export function decodeText(raw: string, enc: DfEncoding): string {
  let high = false;
  for (let i = 0; i < raw.length; i++) {
    if (raw.charCodeAt(i) >= 0x80) {
      high = true;
      break;
    }
  }
  if (!high) return raw;
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xff;
  return decoderFor(enc).decode(bytes);
}

/**
 * Reverse tables, built on first use.
 *
 * `TextEncoder` only speaks UTF-8, so encoding back is a lookup we build by
 * decoding every byte sequence the encoding can hold: 256 single bytes, plus —
 * for Shift-JIS — every lead/trail pair. That is ~9000 two-byte decodes, paid
 * once and only by a caller that actually writes text back (the puppet editor).
 */
const reverseTables = new Map<DfEncoding, Map<string, number[]>>();

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

function reverseTable(enc: DfEncoding): Map<string, number[]> {
  let table = reverseTables.get(enc);
  if (table) return table;
  table = new Map<string, number[]>();
  const dec = decoderFor(enc);
  const one = new Uint8Array(1);
  for (let b = 0; b < 256; b++) {
    one[0] = b;
    const s = dec.decode(one);
    // U+FFFD means the byte is not assigned; the first mapping wins so that
    // ASCII always beats an alias
    if (s.length === 1 && s !== "�" && !table.has(s)) table.set(s, [b]);
  }
  if (enc === "shift_jis") {
    const two = new Uint8Array(2);
    const leads = [...range(0x81, 0x9f), ...range(0xe0, 0xef)];
    for (const lead of leads) {
      for (let trail = 0x40; trail <= 0xfc; trail++) {
        two[0] = lead;
        two[1] = trail;
        const s = dec.decode(two);
        if (s.length === 1 && s !== "�" && !table.has(s)) table.set(s, [lead, trail]);
      }
    }
  }
  reverseTables.set(enc, table);
  return table;
}

/**
 * Turn display text back into the bytes the file stores, clamped to `maxBytes`.
 *
 * Clamping is by BYTE, and never mid-character: a Pascal string's length is one
 * byte and a Shift-JIS character is two, so a naive `slice` on characters can
 * both overflow the field and cut a character in half. Anything the encoding
 * cannot represent becomes `?`, the same substitution {@link writePstrAt} makes.
 */
export function encodeText(s: string, enc: DfEncoding, maxBytes: number): Uint8Array {
  const table = reverseTable(enc);
  const out: number[] = [];
  for (const ch of s) {
    const seq = table.get(ch) ?? [0x3f];
    if (out.length + seq.length > maxBytes) break;
    out.push(...seq);
  }
  return Uint8Array.from(out);
}

// ---- guessing, for callers with no tree to ask ----------------------------

const sjisLead = (b: number): boolean => (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xef);
/** single-byte half-width katakana, the one part of Shift-JIS that is not paired */
const sjisKana = (b: number): boolean => b >= 0xa1 && b <= 0xdf;
const sjisTrail = (b: number): boolean => b >= 0x40 && b <= 0xfc && b !== 0x7f;

/** whether every high byte in a latin1-read string is part of a legal Shift-JIS sequence */
function looksLikeShiftJis(raw: string): boolean {
  for (let i = 0; i < raw.length; i++) {
    const b = raw.charCodeAt(i);
    if (b < 0x80 || sjisKana(b)) continue;
    if (!sjisLead(b) || i + 1 >= raw.length || !sjisTrail(raw.charCodeAt(i + 1))) return false;
    i++;
  }
  return true;
}

/**
 * The share of high bytes above which text stops being "Latin with accents" and
 * starts being a script that is entirely non-ASCII. Measured over every puppet
 * line in each shipped tree, the two groups do not come close to touching:
 * German 1.32%, French 1.85%, Dutch 0.27%, English 0.00% — against Russian
 * 78.48% and Japanese 78.33%.
 */
const NON_LATIN_SHARE = 0.25;

/**
 * Guess an encoding from the text itself, for a caller that has no language to
 * look one up from — a file dropped on an editor, and the test that checks the
 * per-language table still matches the shipped data.
 *
 * Feed it a whole file's worth of DIALOGUE. It is not reliable on script string
 * pools: those are mostly file names and variable names even in the Japanese
 * tree, which drags the high-byte share down to 2.7–9.6% and straight into the
 * range the Latin trees occupy. Undecidable input answers {@link
 * DEFAULT_ENCODING}, which is also the right answer for four of the six trees.
 */
export function sniffEncoding(samples: Iterable<string>): DfEncoding {
  let high = 0;
  let total = 0;
  let sjis = true;
  for (const s of samples) {
    total += s.length;
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) >= 0x80) high++;
    if (sjis && !looksLikeShiftJis(s)) sjis = false;
  }
  if (!high || high / total < NON_LATIN_SHARE) return DEFAULT_ENCODING;
  return sjis ? "shift_jis" : "windows-1251";
}
