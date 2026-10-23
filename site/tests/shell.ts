/**
 * The shell slots (tools/vite-shell.ts) give a page exactly one <title>.
 *
 *   npx vitest run site/tests/shell.ts
 *
 * A play page carries a <title> of its own, so the file is a page as it stands,
 * and the slot writes the one from the facts in its place. The workbench is
 * filled once when it is made from the play page and then served through the
 * same plugin again; the second pass stripped the title the first one wrote and
 * left the workbench with none.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HOME_PAGES } from "../../tools/home-pages";
import { expandShell, pageTitle } from "../../tools/vite-shell";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const titles = (html: string): string[] => [...html.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]);

test.each(HOME_PAGES.map((p) => [p.dir, p] as const))("%s: one title on the play page, filled once or twice", (dir, facts) => {
  const once = expandShell(readFileSync(`${ROOT}/${dir}/play/index.html`, "utf8"), facts);
  expect(titles(once)).toEqual([pageTitle(facts).replace(/&/g, "&amp;")]);
  expect(titles(expandShell(once, facts))).toEqual(titles(once));
});
