/**
 * The bundler does not get a vote on what anything looks like.
 *
 *   npx vitest run site/tests/cascade.ts
 *
 * Every page here links the shared chrome and then writes its own `<style>` after
 * it, on the understanding that where the two describe the same element the page
 * wins. In dev that is exactly what happens. In a build it is the opposite: Vite
 * resolves the `<link>` into a bundle and re-inserts it at the END of `<head>`,
 * after the inline block, so two declarations of EQUAL specificity swap places and
 * whichever the bundler put last takes effect.
 *
 * That is not a theoretical hazard. Dust's page is a grid; the chrome sets
 * `display: flex; align-items: center` on `body` for the reading pages it was
 * written for. Both said `body`, so dev honoured the page and every build honoured
 * the chrome — and a centred flex child shrink-wraps, so `#stage`, whose children
 * are all absolutely positioned, collapsed from 1280px to its own two pads, 32px.
 * The frame inside it landed 1023px wide at x=640 in a 1280px window. It shipped,
 * because nothing on the way to production ever looked at a build: dev was right,
 * `tsc` was silent, the tests never render CSS, and the deployed HTML was
 * byte-identical to the build it came from.
 *
 * So the rule is not "get the order right". It is: never let the order matter.
 * A page that wants to override the chrome must do it by SPECIFICITY — `html body`
 * rather than `body` — which holds in dev and in a build alike.
 *
 * ## What this checks, and what it cannot
 *
 * It compares the selector TEXT of every top-level rule in the shared chrome
 * against every top-level rule in each page's inline `<style>`, and fails when the
 * same selector sets the same property to a DIFFERENT value in both. Same selector
 * text means same specificity, so which one applies is decided by order.
 *
 * Same property, same value, is not a finding: `html, body { margin: 0 }` here and
 * `body { margin: 0 }` in the chrome are order-decided and identical either way,
 * which is a duplicate rather than a hazard. Flagging those buried the one real
 * result in noise the first time this ran.
 *
 * It does not model the cascade: `.topnav a` in one file and `header a` in the
 * other collide in the same way and are invisible here, and a shorthand in one
 * file quietly overriding a longhand in the other (`background` vs
 * `background-image`) is only caught when the selectors happen to match. It is a
 * cheap check on the case that actually happened, not a CSS engine. The expensive
 * complement is `dust/tests/browser/built-layout.ts`, which renders a real build.
 */
import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** the shared stylesheet every page's own `<style>` is layered on top of */
const CHROME = join(ROOT, "site/src/chrome.css");

/**
 * Top-level rules, as selector text to the properties it sets.
 *
 * Deliberately not a CSS parser. It walks brace-balanced blocks, descends into
 * at-rules rather than treating them as selectors (so a rule inside a media query
 * is compared as itself), and splits selector lists so `html, body` is two
 * entries — which is the granularity the cascade works at.
 */
function rulesIn(css: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open < 0) break;
    // the selector is the last line before the brace: everything earlier belongs
    // to the rule that just closed
    const selector = src.slice(i, open).trim().split("\n").pop()?.trim() ?? "";
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
      j++;
    }
    // an at-rule's braces wrap rules, not declarations, so step INSIDE it
    if (selector.startsWith("@")) {
      i = open + 1;
      continue;
    }
    const declarations = new Map<string, string>();
    for (const declaration of src.slice(open + 1, j - 1).split(";")) {
      const colon = declaration.indexOf(":");
      if (colon > 0 && !declaration.slice(0, colon).includes("{")) {
        declarations.set(
          declaration.slice(0, colon).trim(),
          // whitespace only: `0` and `0px` are left as different, which is a
          // false positive this has not hit and a real one it would catch
          declaration
            .slice(colon + 1)
            .trim()
            .replace(/\s+/g, " ")
            .toLowerCase(),
        );
      }
    }
    for (const one of selector.split(",")) {
      const key = one.trim();
      if (!key) continue;
      const existing = out.get(key) ?? new Map<string, string>();
      for (const [p, v] of declarations) existing.set(p, v);
      out.set(key, existing);
    }
    i = j;
  }
  return out;
}

/**
 * A page's own CSS: its inline `<style>` blocks, and the stylesheets it links
 * out of its own package.
 *
 * The linked half was added when Dust's page stopped having an inline block at
 * all — a game with two pages moved its chrome into `dust/src/game.css` so both
 * could link it, and this test, which looked for `<style>`, quietly stopped
 * covering the page the whole file was written about. A `<link>` collides with
 * the shared chrome exactly the way an inline block does, and for the same
 * reason: the build resolves both into bundles and their relative order is the
 * bundler's to decide.
 *
 * `/src/…` only. A page also links `theme.css`, which IS the shared chrome's
 * carrier (it `@import`s it), so comparing it against the chrome would report
 * the chrome against itself; the sheets that matter are the ones a page brings
 * of its own. Resolved against the package the page is in — `/src/game.css` on
 * `dust/index.html` means `dust/src/game.css`, because that is what the page's
 * own Vite root makes it mean.
 *
 * One level of `@import` is followed, because a page's sheet may be nothing but
 * one: `taoot/src/speedrun.css` is a single import of the workbench panel from
 * the engine, and without this the eleven hundred rules it pulls in would be
 * read as nothing at all. `chrome.css` is never followed for the reason above.
 */
function ownCss(page: string, html: string): string {
  const pkg = page.split("/")[0];
  const read = (path: string): string => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return ""; // a link to something that is not there is somebody else's test
    }
  };
  /** `@dreamfactory/engine/web/speedrun/panel.css` → `engine/src/web/speedrun/panel.css` */
  const imported = (css: string): string[] =>
    [...css.matchAll(/@import\s+["']@dreamfactory\/([a-z]+)\/([A-Za-z0-9_./-]+\.css)["']/g)]
      .filter(([, , rest]) => !rest.endsWith("chrome.css"))
      .map(([, other, rest]) => read(join(ROOT, other, "src", rest)));

  const linked = [...html.matchAll(/<link[^>]+href="\/src\/([A-Za-z0-9_.-]+\.css)"/g)]
    .map((m) => m[1])
    .filter((name) => name !== "theme.css")
    .flatMap((name) => {
      const css = read(join(ROOT, pkg, "src", name));
      return [css, ...imported(css)];
    });
  const inline = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  return [...inline, ...linked].join("\n");
}

/** the pages that layer CSS of their own over the shared chrome */
function pagesLayeringChrome(): string[] {
  // `--others --exclude-standard` as well as the index, because a page that has
  // just been written is exactly the one worth checking and `ls-files` alone does
  // not see it. This test passed locally on a new page and failed in CI on the
  // same page one `git add` later, which is the wrong way round for a gate.
  const tracked = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "*.html"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  return tracked.filter((f) => {
    const html = readFileSync(join(ROOT, f), "utf8");
    // a page with no shared stylesheet has nothing to collide with, and a page
    // with no CSS of its own has nothing to collide
    return /<link[^>]+theme\.css/.test(html) && !!ownCss(f, html).trim();
  });
}

test("the shared chrome is in the tree the pages layer on", () => {
  expect(rulesIn(readFileSync(CHROME, "utf8")).size).toBeGreaterThan(20);
  expect(pagesLayeringChrome().length).toBeGreaterThan(5);
});

test("no page and the chrome set the same property on the same selector", () => {
  const chrome = rulesIn(readFileSync(CHROME, "utf8"));
  const decided: string[] = [];

  for (const page of pagesLayeringChrome()) {
    const html = readFileSync(join(ROOT, page), "utf8");
    for (const [selector, declarations] of rulesIn(ownCss(page, html))) {
      const shared = chrome.get(selector);
      if (!shared) continue;
      const conflicting = [...declarations]
        // a property the chrome does not set cannot be overridden by it, and one
        // it sets to the same value is a duplicate rather than a hazard
        .filter(([p, v]) => shared.has(p) && shared.get(p) !== v)
        .map(([p, v]) => `${p}: ${v} over ${shared.get(p)}`)
        .sort();
      if (conflicting.length) {
        decided.push(`${page}: ${selector} { ${conflicting.join("; ")} }`);
      }
    }
  }

  // The failure message has to say what to DO, because the obvious reading of it
  // — "move the link" — is the one thing that cannot work.
  expect(
    decided,
    decided.length
      ? `Equal specificity on both sides, so the BUILD decides which applies and ` +
          `dev shows the other one:\n  ${decided.join("\n  ")}\n\n` +
          `Fix by specificity, not by order: give the page's selector one more ` +
          `element or class than the chrome's (\`html body\` over \`body\`). ` +
          `Reordering the <link> cannot help — the build moves it to the end of ` +
          `<head> regardless of where it is authored.`
      : undefined,
  ).toEqual([]);
});

/**
 * A page's own CSS is BALANCED — as many `}` as `{`.
 *
 * A trivial check for a mistake that is not: a stylesheet with one brace too few
 * is not a stylesheet with one broken rule, it is a stylesheet PostCSS refuses
 * whole. Everything after the cut stops applying, and in dev the page comes up
 * unstyled behind a Vite overlay that names a line hundreds of lines away from
 * the cause — `panel.css:1301: Unexpected }` for a rule that was truncated at
 * its other end.
 *
 * It is here because it happened twice in one afternoon, both times the same
 * way: CSS was moved out of a page into a shared sheet by line range, and the
 * range started or ended inside a rule rather than between two. `tsc` has no
 * opinion on CSS, no unit suite lays out a page, and the browser suites need a
 * dev server — so nothing in the gate had anything to say about it.
 *
 * Comments are stripped first, because a brace inside one is prose: this file's
 * own header quotes rules, and `panel.ts` carries a hundred lines of markup in a
 * template literal.
 */
test("no page's CSS is missing a brace", () => {
  const unbalanced: string[] = [];
  const check = (name: string, css: string): void => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const open = (bare.match(/\{/g) ?? []).length;
    const close = (bare.match(/\}/g) ?? []).length;
    if (open !== close) unbalanced.push(`${name}: ${open} { against ${close} }`);
  };
  for (const page of pagesLayeringChrome()) {
    const html = readFileSync(join(ROOT, page), "utf8");
    check(page, ownCss(page, html));
  }
  check("site/src/chrome.css", readFileSync(CHROME, "utf8"));
  expect(
    unbalanced,
    unbalanced.length
      ? `A stylesheet PostCSS will refuse whole, so the page comes up unstyled:\n  ` +
          `${unbalanced.join("\n  ")}\n\nUsually a range moved out of a page that ` +
          `started or ended INSIDE a rule rather than between two.`
      : undefined,
  ).toEqual([]);
});

/**
 * The SHARED sheets name no game's palette.
 *
 * `site/src/chrome.css` has always said this about itself — "a `var(--abyss-700)`
 * or a raw `#hex` appearing below is a leak, and means a role is missing rather
 * than that an exception was needed" — and it is now true of a second shared
 * sheet: the speedrun panel, which both games' workbenches link.
 *
 * It is a test because the failure is invisible on the page it was written for.
 * The panel was authored inside Titanic's page against `--ice-500` and
 * `--hull-400`, and those tokens are Titanic's alone: Dust's theme implements the
 * same forty ROLES and none of that palette, so an undefined custom property is
 * invalid at computed-value time and twenty-five declarations on its workbench
 * drew nothing at all. Titanic's page looked perfect throughout.
 *
 * The allowed exception is a sheet's own syntax colouring, which belongs to no
 * game: a run sheet is a program and it is the same program on either disc.
 */
test("a shared stylesheet names roles, never a game's palette", () => {
  /** every palette a game's theme declares, by prefix */
  const PALETTES = /var\(--(abyss|hull|ice|brass|frost|dusk|ember|bone|leather|wood)[a-z0-9-]*/g;
  const SHARED = [
    "site/src/chrome.css",
    "engine/src/web/speedrun/panel.css",
    "engine/src/web/save-browser.css",
  ];
  const leaks: string[] = [];
  for (const sheet of SHARED) {
    // comments are prose: both files quote the very tokens they forbid
    const css = readFileSync(join(ROOT, sheet), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [hit] of css.matchAll(PALETTES)) leaks.push(`${sheet}: ${hit})`);
  }
  expect(
    [...new Set(leaks)],
    leaks.length
      ? `A shared sheet cannot name one game's palette — the OTHER game defines ` +
          `none of it, and an undefined custom property draws nothing at all:\n  ` +
          `${[...new Set(leaks)].join("\n  ")}\n\nUse the role both themes ` +
          `implement (--accent, --border-strong, --mark, --rule-mid, --state-border, ` +
          `--text, --panel), picking it from what the game's own theme maps that ` +
          `palette entry to.`
      : undefined,
  ).toEqual([]);
});
