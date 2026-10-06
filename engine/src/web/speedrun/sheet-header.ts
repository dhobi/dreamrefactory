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

/** the header, or what is missing from it */
export function readSheetHeader(text: string): { header: SheetHeader } | { error: string } {
  // an editor may save a byte-order mark in front of line 1
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const first = /^#\s*title\s*:\s*(.+)$/i.exec(lines[0]?.trim() ?? "");
  if (!first) return { error: 'line 1 must be the title: "# title: …"' };
  const found: Record<string, string> = { title: first[1].trim() };
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.startsWith("#")) break;
    const m = /^#\s*([a-z]+)\s*:\s*(.+)$/i.exec(line);
    const key = m?.[1].toLowerCase();
    if (m && key && (HEADER_KEYS as readonly string[]).includes(key) && !(key in found)) found[key] = m[2].trim();
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
