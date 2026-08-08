/**
 * What version of this port is running, and where a reader can see it.
 *
 * One source of truth: `version` in package.json. Vite substitutes it for
 * `__APP_VERSION__` at build time (vite.config.ts), so no page fetches a
 * manifest to find out what it is. Node — the tests and the tools — does no
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
 * them names the build it came from (src/bug-report.ts). Drawn here rather than
 * written into eleven documents so the number is bumped once. Nothing is drawn
 * on a page with no top bar.
 */
export function installVersion(): void {
  const brand = document.querySelector(".topbar .brand");
  if (!brand) return;
  const tag = document.createElement("span");
  tag.className = "version";
  tag.textContent = `v${VERSION}`;
  // hard-coded English, like every string this repo builds in TypeScript
  tag.title = `This port, version ${VERSION} — the game itself is CyberFlix's 1996 release`;
  brand.insertAdjacentElement("afterend", tag);
}
