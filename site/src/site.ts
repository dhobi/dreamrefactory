/**
 * Where the site's root is, from a page that may be sitting anywhere.
 *
 * The build uses a relative base, so `dist/` can be dropped in a subdirectory of
 * some other host and still find itself. Vite covers everything it emits — the
 * module scripts, the stylesheets, the `public/` images the HTML names — because
 * it rewrites those per page depth. It never sees the URLs built below:
 * `gamefiles.json`, the game data beside it and the collection artwork are plain
 * strings in TypeScript, and a leading "/" in one of them is a path off the
 * HOST's root rather than off the site's.
 *
 * So each page declares where its root is, in one `<meta name="site-root">` next
 * to the nav links that already spell the same depth out (`"./"` on the front
 * page, `"../"` under play/, editors/ and collection/). A page that forgets it
 * falls back to its own directory, which is right for a page at the root.
 *
 * ## Why the page says it rather than this module working it out
 *
 * The obvious version is `new URL("../", import.meta.url)` — one line, no per-page
 * upkeep, correct in a build because every chunk lands in `assets/`. It cannot be
 * used: Vite's asset-import-meta-url plugin rewrites `new URL(<literal>,
 * import.meta.url)` at DEV time, and this one became
 * `new URL("/@fs/…/dreamrefactory", import.meta.url)` — so the manifest was fetched
 * from `/@fs/…/dreamrefactorygamefiles.json`, the dev server answered the SPA fallback
 * with 200 text/html, `r.json()` threw, and {@link gamefileManifest}'s catch
 * turned it into an empty manifest. The page then boots forever with no error and
 * no 404 to find it by. A declaration in the markup is not clever enough to be
 * rewritten by anything.
 */
let root: string | null = null;

function siteRoot(): string {
  if (root !== null) return root;
  // Node — the tests and the tools — has no document and no site, and the
  // root-absolute form is what those callers have always compared against.
  if (typeof document === "undefined") return (root = "/");
  const declared = document.querySelector('meta[name="site-root"]')?.getAttribute("content");
  return (root = new URL(declared ?? "./", document.baseURI).href);
}

/** a path as the manifest names it (no leading slash), as a URL this page can fetch */
export function siteUrl(path: string): string {
  return siteRoot() + path;
}

/** the inverse: the manifest key a {@link siteUrl} was built from */
export function sitePath(url: string): string {
  const at = siteRoot();
  return url.startsWith(at) ? url.slice(at.length) : url.replace(/^\//, "");
}
