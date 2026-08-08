/**
 * The canvas fonts the port draws game text with, and how to break a line of it.
 *
 * Both stacks lead with the face this port chose for the look of the thing and
 * then fall through to CJK families, because the same subtitle band has to hold
 * "A women's shawl?" and "女物のショールか？" — see src/df/text.ts for why the
 * Japanese tree exists and how its bytes get here. The fall-through order
 * follows the original: TI.EXE asks for "Arial" in every build except the
 * Japanese one, which is a separate binary asking for "mspgothic".
 */

/** every family after the lead face: a gothic on each platform, then anything */
const CJK_FALLBACK = `"MS PGothic", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans CJK JP", "Noto Sans JP"`;

/**
 * The puppet subtitle strip and the answer rows.
 *
 * Arial because that is literally what the original asks for: TI.EXE realises
 * a puppet's font as `CreateFontA(-size, …, weight 400, "Arial")` and only
 * reaches for "Raven Digital" when the requested font id is 16 (0x41f580) —
 * the puppet default is 888, so every conversation is Arial.
 */
export const subtitleFont = (size: number): string =>
  `${size}px Arial, Helvetica, ${CJK_FALLBACK}, sans-serif`;

/** drawstring()'s persistent text layer — the wireless, CTL's readouts, map labels */
export const overlayFont = (size: number): string =>
  `${size}px "Courier New", ${CJK_FALLBACK}, monospace`;

/**
 * Characters that may start a new line with no space before them.
 *
 * Japanese is written without spaces, so a subtitle is one unbreakable
 * 40-character "word" to any wrapper that splits on " " — it overran both ends
 * of the band instead of wrapping. CJK breaks between almost any two
 * characters, so every one of these is its own break point.
 */
const BREAKS_ANYWHERE =
  /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/**
 * Characters that may not START a line: Japanese closing brackets, the small
 * kana, and the punctuation that hangs off the end of a clause. Breaking before
 * one of these is the one thing that reads as broken rather than merely tight.
 */
const NEVER_STARTS_LINE = /[、。，．・？！ー」』）｝〕】〉》”’ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ]/;

/**
 * Greedily wrap `text` to `maxWidth`, measuring with `measure`.
 *
 * Latin text breaks at spaces and CJK between characters; a string that mixes
 * them (a Japanese line quoting an English ship name) breaks at both. Returns
 * at least one line, so a caller can always index [0].
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const lines: string[] = [""];
  // a piece is a Latin word, a single CJK character, or a run of spaces
  const pieces: string[] = [];
  let word = "";
  for (const ch of text) {
    if (ch === " " || BREAKS_ANYWHERE.test(ch)) {
      if (word) pieces.push(word);
      word = "";
      pieces.push(ch);
    } else {
      word += ch;
    }
  }
  if (word) pieces.push(word);

  for (const piece of pieces) {
    const cur = lines[lines.length - 1];
    // a space at a line break is consumed by the break rather than indenting
    if (piece === " " && !cur) continue;
    const grown = cur + piece;
    if (cur && measure(grown) > maxWidth && !NEVER_STARTS_LINE.test(piece)) {
      lines.push(piece === " " ? "" : piece);
    } else {
      lines[lines.length - 1] = grown;
    }
  }
  // the space a line was measured with but broke after is not part of it
  return lines.map((l) => (l.endsWith(" ") ? l.replace(/ +$/, "") : l));
}
