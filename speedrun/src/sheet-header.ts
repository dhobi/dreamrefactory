/**
 * A contributed sheet's header: who wrote it, and what it is called.
 *
 * Sheets are contributed as plain sheet files (`<game>/speedrun/sheets/`), not
 * as JSON, so that a line number in an error is the line in the file and the
 * file pastes straight into the workbench. What a list of them needs to say
 * about each — its title, its author — is written in the sheet's own leading
 * comments, which the sheet grammar already ignores:
 *
 *     # title: Any% — seed 360
 *     # author: dhobi
 *     reset(seed: 360)
 *
 * The title is required and must be the file's very first line, so a sheet
 * says what it is before anything else. The other keys are optional and are
 * read from the rest of the comment block before the first action; any other
 * comment there is prose and stays prose.
 */
import type { Step } from "./sheet";

export interface SheetHeader {
  title: string;
  author?: string;
  /** a line of its own about the route, shown beside the title */
  notes?: string;
}

/** the keys a header may carry; only `title` is required, on line 1 */
export const HEADER_KEYS = ["title", "author", "notes"] as const;

/** `# key: value` → its key (lowercase) and value, or null for any other line */
function keyOf(raw: string): { key: string; value: string } | null {
  const line = raw.trim();
  if (!line.startsWith("#")) return null;
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const key = line.slice(1, colon).trim().toLowerCase();
  const value = line.slice(colon + 1).trim();
  return /^[a-z]+$/.test(key) && value ? { key, value } : null;
}

/** the header, or what is missing from it */
export function readSheetHeader(text: string): { header: SheetHeader } | { error: string } {
  // an editor may save a byte-order mark in front of line 1
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const first = keyOf(lines[0] ?? "");
  if (first?.key !== "title") return { error: 'line 1 must be the title: "# title: …"' };
  const found: Record<string, string> = { title: first.value };
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.startsWith("#")) break;
    const kv = keyOf(line);
    if (kv && (HEADER_KEYS as readonly string[]).includes(kv.key) && !(kv.key in found)) found[kv.key] = kv.value;
  }
  return {
    header: {
      title: found.title,
      ...(found.author ? { author: found.author } : {}),
      ...(found.notes ? { notes: found.notes } : {}),
    },
  };
}

/** the seed a sheet pins at its boot (`reset(seed: N)`), or null for an unseeded run */
export function sheetSeed(steps: readonly Step[]): number | null {
  const reset = steps.find((s) => s.verb === "reset" && s.opts.seed !== undefined);
  return reset ? Number(reset.opts.seed) : null;
}
