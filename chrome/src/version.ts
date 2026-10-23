/**
 * What version of this port is running, and where a reader can see it.
 *
 * One source of truth: `version` in the package that OWNS the page — Titanic's,
 * Dust's, or this one's. Each package's Vite config substitutes its own for
 * `__APP_VERSION__` at build time, so no page fetches a manifest to find out
 * what it is, and no manifest speaks for a game it does not hold. Node — the tests and the tools — does no
 * such substitution, hence the `typeof` guard and the `-dev` fallback; an
 * undeclared identifier is safe to `typeof` but throws when read.
 */
declare const __APP_VERSION__: string;

/** semver, as package.json spells it */
export const VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0-dev";

/**
 * Put it in the top bar, beside the wordmark.
 *
 * The bar is what the eleven pages share, so this is the one place a version
 * can go and be true everywhere — and it means a bug report opened from any of
 * them names the build it came from (chrome/src/bug-report.ts). Drawn here rather than
 * written into eleven documents so the number is bumped once. Nothing is drawn
 * on a page with no top bar.
 */
export function installVersion(): void {
  // the bar's own box where the page has one (tools/vite-shell.ts writes it into
  // every game's bar), else a box made beside the wordmark
  let tag = document.getElementById("ver");
  if (!tag) {
    const brand = document.querySelector(".topbar .brand");
    if (!brand) return;
    tag = document.createElement("span");
    tag.className = "version";
    brand.after(tag);
  }
  tag.textContent = `v${VERSION}`;
  // hard-coded English, like every string this repo builds in TypeScript
  tag.title = `This port, version ${VERSION}`;
}
