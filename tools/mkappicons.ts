/**
 * The home-screen icons, from each game's own mark.
 *
 *   npm run mkappicons
 *
 * A web app installed to a phone's home screen needs raster icons at sizes no
 * favicon ever wanted, in shapes a favicon never has to be: Android masks the
 * icon into a circle or a squircle and will shrink a square one into a white
 * disc rather than crop it, and iOS takes a single opaque PNG and rounds the
 * corners itself. Neither can be served by the marks as they stand — three of
 * the four are SVG, and Titanic's is a 128px PNG.
 *
 * So this renders them, and renders them in a BROWSER. That is not laziness
 * about pulling in a rasteriser: the marks are the artwork the tab already
 * shows, three of them are vector and one is a photograph of a porthole, and the
 * thing that has to agree about how they scale is the same engine that will draw
 * them on the phone. Playwright is already here for the browser suites.
 *
 * ## The four files each game gets, and why it is four
 *
 * - **192 and 512, transparent.** What the manifest offers as `purpose: any`.
 *   Two sizes because 192 is what Android installs with and 512 is what it draws
 *   the splash screen from.
 * - **512 maskable.** The same mark at {@link MASKABLE_SCALE} on the game's own
 *   background, because a maskable icon is cropped to an unknown shape and
 *   anything outside the middle 80% may not survive. Without one of these
 *   Android does not crop the plain icon — it shrinks it onto a white circle,
 *   which is how a dark game ends up with a white blob on the home screen.
 * - **180 for Apple.** Opaque, because iOS composites a transparent
 *   `apple-touch-icon` onto black and these marks are drawn for dark ground
 *   anyway; 180 is what a 3x phone asks for.
 *
 * The background is the game's own `--bg`, quoted here rather than read from the
 * sheet — an offline tool that parses CSS to find a colour is a worse bargain
 * than a table a test can check, and `site/tests/app-icons.ts` holds each of
 * these against the `theme.css` it came from.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** how much of a maskable icon's box the mark may use — the safe zone is 80% */
const MASKABLE_SCALE = 0.62;
/** how much of Apple's box to use: it rounds the corners and crops very little */
const APPLE_SCALE = 0.84;

interface Source {
  /** the game's directory, which is also its deployed path and its file prefix */
  dir: string;
  /** the mark, relative to the package — the same file the tab shows */
  mark: string;
  /** the game's `--bg`, for the two icons that may not be transparent */
  bg: string;
}

const GAMES: readonly Source[] = [
  // Titanic's mark is a PNG and the only raster source here: the porthole cut
  // out of assets/globe.png by taoot/tools/mktaootlogo.ts, 128px on disk. The
  // 512 is therefore an upscale — of a photograph, by a browser, which is the
  // softest of the ways to be wrong about it, and it is the size a splash
  // screen samples rather than one a home screen shows.
  { dir: "taoot", mark: "public/taoot-mark.png", bg: "#00060f" },
  { dir: "dust", mark: "public/dust-mark.svg", bg: "#0a0705" },
  { dir: "timelapse", mark: "public/timelapse-mark.svg", bg: "#04050e" },
  { dir: "skullcracker", mark: "public/skullcracker-mark.svg", bg: "#080202" },
];

/** every icon a game gets, as the manifest and the Apple tags name them */
function outputs(dir: string): { file: string; size: number; scale: number; bg: boolean }[] {
  return [
    { file: `${dir}-icon-192.png`, size: 192, scale: 1, bg: false },
    { file: `${dir}-icon-512.png`, size: 512, scale: 1, bg: false },
    { file: `${dir}-icon-maskable-512.png`, size: 512, scale: MASKABLE_SCALE, bg: true },
    { file: `${dir}-apple-touch-180.png`, size: 180, scale: APPLE_SCALE, bg: true },
  ];
}

const browser = await chromium.launch();
try {
  for (const game of GAMES) {
    const path = join(ROOT, game.dir, game.mark);
    const bytes = readFileSync(path);
    const mime = game.mark.endsWith(".svg") ? "image/svg+xml" : "image/png";
    const src = `data:${mime};base64,${bytes.toString("base64")}`;

    for (const out of outputs(game.dir)) {
      const page = await browser.newPage({
        viewport: { width: out.size, height: out.size },
        deviceScaleFactor: 1,
      });
      const inner = Math.round(out.size * out.scale);
      await page.setContent(
        `<style>
           html, body { margin: 0; width: ${out.size}px; height: ${out.size}px; }
           body { display: flex; align-items: center; justify-content: center;
                  background: ${out.bg ? game.bg : "transparent"}; }
           /* contain, so a mark that is not square keeps its shape and pays for
              it in empty box rather than in a stretched skull */
           img { width: ${inner}px; height: ${inner}px; object-fit: contain; }
         </style>
         <img src="${src}">`,
      );
      // the <img> has to have decoded before the shot, and setContent does not
      // wait for one that is a data URI any more than for one that is a request
      await page.waitForFunction(() => {
        const el = document.querySelector("img");
        return !!el && el.complete && el.naturalWidth > 0;
      });
      const png = await page.screenshot({ type: "png", omitBackground: !out.bg });
      writeFileSync(join(ROOT, game.dir, "public", out.file), png);
      await page.close();
      console.log(`${game.dir}/public/${out.file}  ${out.size}x${out.size}  ${(png.length / 1024).toFixed(1)} KB`);
    }
  }
} finally {
  await browser.close();
}
