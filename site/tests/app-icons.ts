/**
 * The home-screen apps: four manifests, their icons, and the colour they are
 * all supposed to be.
 *
 *   npx vitest run site/tests/app-icons.ts
 *
 * Adding a game to a phone's home screen is the only way to be rid of Safari's
 * address bar — an iPhone has no element fullscreen at all, so the Fullscreen
 * button there fills the page and stops at the browser's own chrome
 * (engine/src/web/fullscreen.ts). An installed app has no such chrome to stop
 * at. That is the whole of what the manifests below buy, and it is worth a test
 * because every way they can fail is silent:
 *
 *   - **An absolute URL.** This site is deployed under a PATH, not at a root
 *     (`…/dreamrefactory/taoot/`), so a `start_url` of `/` sends an installed
 *     app to somebody else's front page and a `src` of `/taoot-icon-192.png`
 *     fetches nothing. Relative URLs in a manifest resolve against the
 *     MANIFEST, which sits at the game's own root, and are correct at any
 *     depth. Nothing warns about this: the install succeeds and the icon is
 *     blank.
 *   - **A `sizes` that is not the size.** A browser trusts the declaration when
 *     it picks, and finds out afterwards.
 *   - **No maskable icon.** Android crops an icon to a circle or a squircle and
 *     will not crop one that has not said it may be cropped — it shrinks it onto
 *     a WHITE disc instead, which on four games this dark is the most visible
 *     way to get this wrong and the one no desktop ever shows you.
 *   - **A colour that has drifted from the sheet.** `theme_color` paints the
 *     status bar and `background_color` the splash screen, both before a line of
 *     CSS has loaded. When they match `--bg` the launch is seamless; when they
 *     do not, the app flashes a colour the game never uses.
 *
 * So the manifests are held to `site/src/games.ts` for their names and to each
 * game's own `theme.css` for their colours, and the pages that link them are
 * held to the manifests. The icons themselves are built by
 * `tools/mkappicons.ts`; what is checked here is that what shipped is what was
 * declared.
 */
import { test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parseHTML } from "linkedom";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** the games that ship a home-screen app, and the pages you can install from */
const APPS = [
  { dir: "taoot", short: "Titanic", pages: ["taoot/index.html", "taoot/play/index.html"] },
  { dir: "dust", short: "Dust", pages: ["dust/index.html"] },
  { dir: "timelapse", short: "Timelapse", pages: ["timelapse/index.html"] },
  { dir: "skullcracker", short: "Skull Cracker", pages: ["skullcracker/index.html"] },
] as const;

interface Icon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}
interface Manifest {
  name: string;
  short_name: string;
  id: string;
  start_url: string;
  scope: string;
  display: string;
  display_override?: string[];
  theme_color: string;
  background_color: string;
  icons: Icon[];
}

const manifest = (dir: string): Manifest =>
  JSON.parse(readFileSync(join(ROOT, dir, "public/app.webmanifest"), "utf8")) as Manifest;

/** a PNG's real size, off the IHDR the first bytes of the file are */
function pngSize(path: string): { width: number; height: number } {
  const b = readFileSync(path);
  expect(b.subarray(1, 4).toString("ascii"), `${path} is a PNG`).toBe("PNG");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/**
 * What a game's `--bg` actually is, chased through the one indirection the
 * sheets use: `--bg: var(--abyss-900)` and `--abyss-900: #00060f` two hundred
 * lines apart. Naive on purpose — it is reading four files whose shape is known,
 * and a CSS parser here would be a second implementation of the cascade.
 */
function backgroundColour(dir: string): string {
  const css = readFileSync(join(ROOT, dir, "src/theme.css"), "utf8");
  const bg = /^\s*--bg:\s*([^;]+);/m.exec(css);
  expect(bg, `${dir}/src/theme.css declares --bg`).not.toBeNull();
  const value = bg![1].trim();
  const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
  if (!ref) return value.toLowerCase();
  const resolved = new RegExp(`^\\s*${ref[1]}:\\s*([^;]+);`, "m").exec(css);
  expect(resolved, `${dir}/src/theme.css declares ${ref[1]}`).not.toBeNull();
  return resolved![1].trim().toLowerCase();
}

test.each(APPS)("$dir: the manifest is installable under a deployed subpath", ({ dir, short }) => {
  const m = manifest(dir);

  expect(m.short_name).toBe(short);
  expect(m.name.startsWith(short)).toBe(true);
  // the port, said once where the install dialog shows the long name
  expect(m.name.endsWith(" RE")).toBe(true);

  // the whole point: nothing here may assume the site owns the origin's root
  for (const url of [m.id, m.start_url, m.scope, ...m.icons.map((i) => i.src)]) {
    expect(url.startsWith("/"), `${url} is relative, not origin-absolute`).toBe(false);
    expect(/^[a-z]+:/i.test(url), `${url} has no scheme`).toBe(false);
    expect(url.startsWith("./"), `${url} is written relative to the manifest`).toBe(true);
  }
  // ...and the app's scope is the game's own directory, not a parent of it
  expect(m.scope).toBe("./");
  expect(m.start_url).toBe("./");

  // Android takes the status bar with this; iOS ignores it and reads the page's
  // apple- tags, which is why both routes are asserted (below, per page)
  expect(m.display).toBe("fullscreen");
  expect(m.display_override).toEqual(["fullscreen", "standalone"]);
});

test.each(APPS)("$dir: the launch colours are the game's own --bg", ({ dir }) => {
  const m = manifest(dir);
  const bg = backgroundColour(dir);
  // both, and both the same: one paints the status bar, the other the splash
  // screen, and both are shown before any of this game's CSS has been parsed
  expect(m.theme_color.toLowerCase()).toBe(bg);
  expect(m.background_color.toLowerCase()).toBe(bg);
});

test.each(APPS)("$dir: every icon exists and is the size it claims", ({ dir }) => {
  const m = manifest(dir);

  for (const icon of m.icons) {
    const path = join(ROOT, dir, "public", icon.src.replace(/^\.\//, ""));
    expect(existsSync(path), `${icon.src} exists in ${dir}/public`).toBe(true);
    const [w, h] = icon.sizes.split("x").map(Number);
    expect(pngSize(path)).toEqual({ width: w, height: h });
    expect(icon.type).toBe("image/png");
  }

  // 192 is what Android installs with, 512 what it draws the splash from
  const any = m.icons.filter((i) => i.purpose === "any").map((i) => i.sizes);
  expect(any).toContain("192x192");
  expect(any).toContain("512x512");

  // and the one that keeps a dark mark off a white circle — see the header
  const maskable = m.icons.filter((i) => i.purpose === "maskable");
  expect(maskable.length, `${dir} ships a maskable icon`).toBeGreaterThan(0);
});

test.each(APPS)("$dir: the pages say on iOS what the manifest says on Android", ({ dir, short, pages }) => {
  const m = manifest(dir);

  for (const page of pages) {
    const { document } = parseHTML(readFileSync(join(ROOT, page), "utf8"));
    const where = `${page}:`;

    const link = document.querySelector('link[rel="manifest"]');
    expect(link, `${where} links the manifest`).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/app.webmanifest");

    // iOS reads none of the manifest's display: these two tags are the whole of
    // what makes an installed page open without an address bar there
    const meta = (name: string): string | null =>
      document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ?? null;
    expect(meta("apple-mobile-web-app-capable"), `${where} apple capable`).toBe("yes");
    expect(meta("mobile-web-app-capable"), `${where} the standard spelling too`).toBe("yes");
    expect(meta("apple-mobile-web-app-status-bar-style"), `${where} status bar`).toBe("black");
    // what iOS writes under the icon, which is the manifest's short name
    expect(meta("apple-mobile-web-app-title"), `${where} app title`).toBe(short);
    // and the colour agrees with the manifest, so the two platforms launch alike
    expect(meta("theme-color")?.toLowerCase(), `${where} theme colour`).toBe(
      m.theme_color.toLowerCase(),
    );

    // iOS will not take an icon out of the manifest; it takes this one
    const touch = document.querySelector('link[rel="apple-touch-icon"]');
    expect(touch, `${where} carries an apple-touch-icon`).not.toBeNull();
    const href = touch!.getAttribute("href")!;
    const path = join(ROOT, dir, "public", href.replace(/^\//, ""));
    expect(existsSync(path), `${where} ${href} exists`).toBe(true);
    // opaque, because iOS composites a transparent one onto black rather than
    // onto the ground the mark was drawn for
    expect(pngSize(path)).toEqual({ width: 180, height: 180 });
  }
});
