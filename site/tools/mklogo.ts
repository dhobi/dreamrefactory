/**
 * Write the front door's artwork into `site/public/`, derived from the canonical
 * originals rather than copied.
 *
 *   npm run mklogo -w site
 *
 * The project's wordmark and a card-sized piece of each ported
 * game's own identity. A build step and not checked-in resizes, so every one is
 * derivable from its source and no asset on the page is a mystery. See
 * tools/logo-resize.ts for why the trimming and the filtering are what they are.
 *
 * ## Why the game art is copied into this package at all
 *
 * Because a Vite `publicDir` belongs to one package, and the front door is
 * `site/`'s. In the DEPLOYED tree the games' own images do sit one directory
 * away — `/dreamrefactory/dust/dust-logo.png` is right there — but in dev each
 * package is a separate origin, so a front page reaching across would work
 * deployed and 404 locally. A derivative that is 40 KB instead of 500 is the
 * cheaper answer than making the landing page only correct in production.
 *
 * These reads reach into the game packages, which a runtime import must never do
 * (site/tests/layering.ts). A build-time tool may: it is reading a file, not
 * depending on a module, and the alternative is a second copy of the artwork
 * with nothing keeping the two honest.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodePNG, encodePNG } from "../../tools/png";
import { keyCheckerboard } from "../../redjack/tools/mkredjacklogo";
import { keyJumpRaven } from "../../jumpraven/tools/mkjumpravenlogo";
import { ResizeOptions, resizeLogo } from "../../tools/logo-resize";

const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

interface Job {
  what: string;
  src: string;
  out: string;
  opts: ResizeOptions;
  /** a key to run on the decoded source first, for artwork with no alpha of its own */
  key?: (rgba: Uint8Array, width: number, height: number) => void;
}

const JOBS: Job[] = [
  {
    what: "the project's wordmark",
    src: at("../assets/dreamrefactory-logo.png"),
    out: at("../public/dreamrefactory-logo.png"),
    /**
     * 1:1 with the box the page draws it in (`width: min(46rem, 100%)` — 736 CSS
     * px), which is the trade Dust's own title card makes: 2x for hidpi would be
     * sharper and costs four times the file.
     *
     * The artwork is a flat render of light on black with no alpha channel at
     * all. `unblack` reads it as the additive image it is, which removes the
     * black plate AND keeps the swoosh's bloom as a real soft edge; the trim then
     * works on that alpha, above a threshold, because the bloom fades to an alpha
     * of 1 or 2 at the canvas edge and a trim looking for any alpha would find
     * the whole frame.
     */
    opts: { width: 760, unblack: true, trim: "alpha", trimThreshold: 8 },
  },
  {
    what: "Titanic's title card",
    // the full-size original, not taoot/public's 512px derivative: resizing a
    // resize softens edges twice
    src: at("../../taoot/assets/taoot-full.png"),
    out: at("../public/card-taoot.png"),
    /**
     * Shown about 340 CSS px wide, so 480 is a modest oversample on a wordmark
     * whose bevels are the thing to lose — the same trade as Dust's below, which
     * is now the same shape of picture in the same size of band.
     *
     * The threshold is taoot/tools/mktaootlogo.ts's, and for its reason: this
     * artwork's fringe reaches the canvas edge at an alpha no eye can see, so a
     * trim looking for any alpha at all finds the whole frame and leaves 4% of
     * the height as empty margin.
     */
    opts: { width: 480, trim: "alpha", trimThreshold: 8 },
  },
  {
    what: "Dust's title card",
    // the full-size original, not dust/public's 900px derivative: resizing a
    // resize softens edges twice
    src: at("../../dust/assets/dust-full.png"),
    out: at("../public/card-dust.png"),
    // shown about 340 CSS px wide, so 480 is a modest oversample on a wordmark
    // whose bevels are the thing to lose
    opts: { width: 480, trim: "alpha" },
  },
  {
    what: "RedJack's title card",
    src: at("../../redjack/assets/redjack-full.png"),
    out: at("../public/card-redjack.png"),
    // the artwork has a transparency checkerboard painted into it, and
    // redjack/tools/mkredjacklogo.ts says how it comes out
    key: keyCheckerboard,
    opts: { width: 480, trim: "alpha", trimThreshold: 8 },
  },
  {
    what: "Lunicus's title card",
    src: at("../../lunicus/assets/lunicus-full.png"),
    out: at("../public/card-lunicus.png"),
    // its own alpha, nothing to key (lunicus/tools/mklunicuslogo.ts)
    opts: { width: 480, trim: "alpha", trimThreshold: 8 },
  },
  {
    what: "Jump Raven's title card",
    src: at("../../jumpraven/assets/jumpraven-full.png"),
    out: at("../public/card-jumpraven.png"),
    // a flat white ground, keyed as RedJack's checkerboard is, with the patch
    // the band shuts in found as well (jumpraven/tools/mkjumpravenlogo.ts)
    key: keyJumpRaven,
    opts: { width: 480, trim: "alpha", trimThreshold: 8 },
  },
];

for (const job of JOBS) {
  let bytes: Uint8Array = new Uint8Array(readFileSync(job.src));
  if (job.key) {
    const src = decodePNG(bytes);
    job.key(src.rgba, src.width, src.height);
    bytes = encodePNG(src.rgba, src.width, src.height, { compress: true });
  }
  const img = resizeLogo(bytes, job.opts);
  writeFileSync(job.out, encodePNG(img.rgba, img.width, img.height, { compress: true }));
  const before = readFileSync(job.src).length;
  const after = readFileSync(job.out).length;
  console.log(
    `${job.what}: ${img.source.width}x${img.source.height} ${(before / 1024).toFixed(0)} KB` +
      ` -> ${img.width}x${img.height} ${(after / 1024).toFixed(0)} KB` +
      ` (${((after / before) * 100).toFixed(0)}%)`,
  );
}
