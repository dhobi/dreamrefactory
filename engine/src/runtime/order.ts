/**
 * Strings in code-unit order: what a bare `.sort()` does, said out loud.
 *
 * For file names, sheet names and set names, which must come out in the same
 * order in every browser and in node. `localeCompare` would not: it orders by
 * the visitor's language, so a German and a Swedish browser could disagree on
 * which disc's copy of a file is first.
 */
export function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
