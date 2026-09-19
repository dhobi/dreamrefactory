/**
 * Every documentation page is reachable, and every link in the nav goes
 * somewhere.
 *
 *   npx vitest run site/tests/docs-nav.ts
 *
 * The doc set's navigation is a hand-written list in `docs/.vitepress/config.ts`
 * and the pages are files on disk, and nothing but this holds the two together.
 * Both ways of parting are silent:
 *
 *   - **A page nobody linked** still builds, still deploys, and is reachable
 *     only by typing its URL. Splitting one long page into seven is exactly when
 *     this happens — six new files, six sidebar lines, and the build is just as
 *     green if you write five.
 *   - **A link to a page that is not there** renders as an ordinary sidebar
 *     entry and 404s when clicked. VitePress does not fail the build for it.
 *
 * And one that is worse than either, because it breaks a page that exists: a
 * folder's `README.md` needs an entry in the `rewrites` map or the directory
 * URL has no index to serve. That map is the reason `/skullcracker/` answers at
 * all.
 *
 * Read as TEXT rather than by importing the config, for `deploy-lanes.ts`'s
 * reason: what is being checked is that a path appears in a particular list, and
 * importing a VitePress config drags in the whole toolchain to learn it.
 */
import { test, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DOCS = join(ROOT, "docs");
const config = readFileSync(join(DOCS, ".vitepress/config.ts"), "utf8");

/** every `link:` in the nav and the sidebar, minus the ones that leave the site */
const linked = new Set(
  [...config.matchAll(/link:\s*"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((l) => l.startsWith("/"))
    .map((l) => l.split("#")[0]),
);

/** every page the doc set actually holds */
function pages(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "public") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...pages(path));
    else if (entry.endsWith(".md")) out.push(relative(DOCS, path));
  }
  return out;
}

/** the URL a page is served at: a folder's README is that folder's index */
const urlOf = (page: string): string =>
  page.endsWith("README.md") ? `/${page.slice(0, -"README.md".length)}` : `/${page.slice(0, -".md".length)}`;

test("every page is reachable from the nav", () => {
  const orphans = pages(DOCS)
    .filter((p) => p !== "README.md") // the root index, which IS the nav's home
    .filter((p) => !linked.has(urlOf(p)));
  expect(
    orphans,
    orphans.length
      ? `docs pages nothing links to — add them to docs/.vitepress/config.ts:\n  ${orphans.join("\n  ")}`
      : undefined,
  ).toEqual([]);
});

test("every nav link goes to a page that exists", () => {
  const dangling = [...linked].filter((l) => {
    const base = l.endsWith("/") ? `${l.slice(1)}README.md` : `${l.slice(1)}.md`;
    return !existsSync(join(DOCS, base));
  });
  expect(dangling, dangling.length ? `nav links with no page:\n  ${dangling.join("\n  ")}` : undefined).toEqual([]);
});

test("every folder index has a rewrite, or its directory URL has nothing to serve", () => {
  // VitePress serves a directory from `index.md`; this doc set writes `README.md`
  // for GitHub's sake, and the `rewrites` map is what bridges the two
  const missing = pages(DOCS)
    .filter((p) => p.endsWith("README.md") && p !== "README.md")
    .filter((p) => !config.includes(`"${p}":`));
  expect(
    missing,
    missing.length ? `folder indexes with no rewrite entry:\n  ${missing.join("\n  ")}` : undefined,
  ).toEqual([]);
});

test("Skull Cracker's pages are each listed, not folded into one overview", () => {
  // the split this test was written for: one 3286-line page became seven, and
  // six of them are only findable if the sidebar names them
  for (const page of ["levels", "combat", "weapons", "menu", "systems", "verification"]) {
    expect(linked.has(`/skullcracker/${page}`), `/skullcracker/${page} is not in the sidebar`).toBe(true);
  }
});
