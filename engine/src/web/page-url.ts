/**
 * A path the page fetches — its game files, its manifest, its seed saves —
 * as an absolute URL on the page's own site, or an error.
 *
 * Every caller passes a relative path built from constants and from the
 * game's own `gamefiles.json`, so the result is always same-origin today. The
 * check is what keeps it so: an absolute or protocol-relative path (`//host/…`)
 * in a manifest, or a `<base>` that pointed elsewhere, would otherwise send
 * the request, and whatever came back would be read as game data.
 */
export function pageUrl(path: string, base: string = document.baseURI, origin: string = location.origin): string {
  const u = new URL(path, base);
  if (u.origin !== origin) throw new Error(`refusing to fetch ${u.href}: not on ${origin}`);
  return u.href;
}

/**
 * The game's root, as a page states it: `<meta name="site-root">`, resolved
 * against the page — "./" on a game's home page, "../" on its play page one
 * folder down. Where a game's files are (`gamefiles/`, `gamefiles.json`) is
 * relative to this, not to whichever page asks. A page without the meta is its
 * own root.
 */
export function siteBase(): string {
  // a test's stand-in document may have no query at all: it is then its own root
  const declared = typeof document.querySelector === "function" ? document.querySelector('meta[name="site-root"]')?.getAttribute("content") : null;
  return new URL(declared ?? "./", document.baseURI).href;
}
