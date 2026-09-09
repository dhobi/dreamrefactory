/**
 * The painted charts, baked to files.
 *
 *   npx tsx taoot/bedsit/tools/bedsitbake.ts [--quality 0.95] [--check]
 *
 * {@link file://../src/bedsit-paint.ts} writes the room's materials down as
 * functions of a point on a wall and rasterizes them. That is the right way to
 * author plaster and it is the wrong way to SERVE it: the six charts baked here
 * are 11.5 megatexels of per-texel JavaScript, they run at about 1.4 megapixels
 * a second on one thread, and the page did all of it on every single load
 * before drawing a frame. Measured, it was 9.5 seconds of a 17.3 second load —
 * more than half, and more than everything else put together.
 *
 * So the painter stays exactly where it is and stays the source of truth; this
 * runs it once, offline, and writes what it produced. It is the same move
 * {@link file://./bedsitmats.ts} already made for the four materials that used
 * to be cut out of the rip at load.
 *
 * **The rug is deliberately NOT baked.** It is the cheapest chart to paint —
 * 355 ms against the fireplace wall's 1,795 — and the most expensive to
 * compress: it is a woven pattern, which is the one thing a lossy codec handles
 * worst here. Measured at WebP 0.95 it loses 6% of its roughness where every
 * other chart stays within 3%, and its RMS error is three times theirs. Paying
 * two thirds of a second to keep it exact is the right side of that trade, and
 * leaving it out is what lets the quality argument against baking be answered
 * with a number instead of a shrug.
 *
 * **Row 0 is the chart's `v0`, not the top of a picture.** `Painted.rgba` is
 * written that way and {@link file://../src/bedsit-page.ts} uploads it with no
 * flip, so the file is written in the same order and can be uploaded straight
 * from an `Image` — no canvas, no `getImageData`, no 46 MB of readback. That is
 * the whole reason these are not simply run through the picture path.
 *
 * **The name carries a hash of the pixels.** Vite copies `public/` verbatim
 * with no content hash, so a file that changes keeps its URL and a browser that
 * has it may never ask again. The dev server sends `no-cache` and revalidates,
 * so this is invisible while working and only bites a deployed build — which is
 * exactly the kind of fault that gets found late and blamed on something else.
 * A name that changes with the pixels cannot go stale, and lets these be served
 * immutable. Stale hashes of a chart are deleted as it is rewritten.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { paintSurface, useToothPhoto } from "../src/bedsit-paint";
import type { SurfaceId } from "../src/bedsit-room";
import { encodePNG } from "../../../tools/png";

/** the charts that are worth baking — see the note on the rug above */
const BAKE: readonly SurfaceId[] = [
  "window-wall", "counter-wall", "fireplace-wall", "door-wall", "ceiling", "floor",
];

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = join(HERE, "../../public/bedsit");
const MANIFEST = join(HERE, "../src/bedsit-baked.ts");

const ARGS = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const at = ARGS.indexOf(name);
  return at >= 0 && ARGS[at + 1] ? ARGS[at + 1] : fallback;
};
/**
 * 0.95 and not 0.85, which halves the bytes.
 *
 * The number that settled it is not the error but the ROUGHNESS — how far a
 * texel departs from its own neighbourhood, which is what a wall of plaster is
 * made of and what this room has already rejected a texture for losing. At 0.85
 * the ceiling comes back 16% smoother than it was painted. At 0.95 it is within
 * 3%, and so is everything else here.
 */
const QUALITY = Number(arg("--quality", "0.95"));
const CHECK = ARGS.includes("--check");

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<body></body>");

/**
 * PNG in, WebP out, through a browser — because node has no WebP encoder and
 * this repo already reaches for chromium when it needs one (see
 * {@link file://./bedsitmags.ts}). The PNG is only a carrier and never touches
 * the disc.
 */
const WEBP = `async ({ png, quality }) => {
  const img = new Image();
  img.src = "data:image/png;base64," + png;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext("2d").drawImage(img, 0, 0);
  const url = c.toDataURL("image/webp", quality);
  if (!url.startsWith("data:image/webp")) throw new Error("no webp encoder");
  return url.slice(url.indexOf(",") + 1);
}`;

/**
 * THE PLASTER PHOTOGRAPH HAS TO BE IN BEFORE A WALL IS PAINTED, and forgetting
 * it here is the one way this tool can silently produce a worse room than the
 * page it replaces.
 *
 * `bedsit-paint` floats its walls and ceiling with a photographed plaster, fed
 * in by `useToothPhoto`. That call lives in the PAGE, because the page is where
 * an `<img>` can be decoded — and `wall()` guards on it (`if (TOOTH && ...)`)
 * so a painter that never received one does not fail. It paints smooth and says
 * nothing. Bake in that state and the room loses the photograph it was given,
 * with no error anywhere and nothing to notice but the walls looking flatter
 * than they did.
 *
 * So the tool does what the page does: decode the same file, reduce it to one
 * number a texel over its own mean — so flat plaster is exactly 1 — and hand it
 * over before anything is rasterized.
 */
const TOOTH_SRC = join(PUBLIC, "plaster.jpg");
const toothed = await (async (): Promise<number> => {
  const jpeg = readFileSync(TOOTH_SRC).toString("base64");
  const got = await page.evaluate(`(async (d) => {
    const i = new Image(); i.src = "data:image/jpeg;base64," + d; await i.decode();
    const n = i.naturalWidth;
    if (!n || i.naturalHeight !== n) return null;          // it tiles both ways
    const c = document.createElement("canvas"); c.width = n; c.height = n;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(i, 0, 0);
    const p = g.getImageData(0, 0, n, n).data;
    const out = new Uint8Array(n * n);
    for (let k = 0; k < out.length; k++)
      out[k] = Math.round(0.2126 * p[k*4] + 0.7152 * p[k*4+1] + 0.0722 * p[k*4+2]);
    let s = "";
    for (let k = 0; k < out.length; k += 8192)
      s += String.fromCharCode.apply(null, out.subarray(k, k + 8192));
    return { n, b64: btoa(s) };
  })(${JSON.stringify(jpeg)})`) as { n: number; b64: string } | null;
  if (!got) throw new Error(`${TOOTH_SRC} is not square — the tooth tiles both ways`);
  const bytes = Buffer.from(got.b64, "base64");
  const k = new Float32Array(got.n * got.n);
  let sum = 0;
  for (let i = 0; i < k.length; i++) { k[i] = bytes[i]; sum += k[i]; }
  const mean = sum / k.length;
  if (!(mean > 0)) throw new Error("the plaster photograph came back black");
  for (let i = 0; i < k.length; i++) k[i] /= mean;
  useToothPhoto(got.n, k);
  return got.n;
})();
console.log(`plaster photograph: ${toothed}x${toothed}, in before the first wall\n`);

const rows: { id: SurfaceId; file: string; px: number; bytes: number; ms: number }[] = [];
const stale: string[] = [];
for (const id of BAKE) {
  const t = process.hrtime.bigint();
  const p = paintSurface(id);
  if (!p) throw new Error(`no chart paints ${id}`);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  const png = encodePNG(p.rgba, p.width, p.height, { compress: true }).toString("base64");
  const webp = Buffer.from(
    await page.evaluate(`(${WEBP})(${JSON.stringify({ png, quality: QUALITY })})`) as string,
    "base64",
  );
  const hash = createHash("sha256").update(webp).digest("hex").slice(0, 8);
  const file = `${id}.${hash}.webp`;
  // whatever else claims this chart's name goes, so a rebake leaves one file.
  // Under --check nothing is removed and nothing is written: a check that
  // deletes the file it is checking is not a check.
  if (!CHECK) {
    for (const old of readdirSync(PUBLIC)) {
      if (old !== file && new RegExp(`^${id}\\.[0-9a-f]{8}\\.webp$`).test(old)) rmSync(join(PUBLIC, old));
    }
    writeFileSync(join(PUBLIC, file), webp);
  } else if (!existsSync(join(PUBLIC, file))) {
    stale.push(`${file} is missing`);
  }
  rows.push({ id, file, px: p.width * p.height, bytes: webp.length, ms });
  console.log(
    `${id.padEnd(15)} ${p.width}x${p.height}` +
    `  painted in ${ms.toFixed(0).padStart(5)} ms` +
    `  ->  ${(webp.length / 1024).toFixed(0).padStart(4)} KB  ${file}`,
  );
}
await browser.close();

const manifest =
`/**
 * WRITTEN BY {@link file://../tools/bedsitbake.ts} — do not edit by hand.
 *
 * The charts that arrive as files instead of being painted at load, and the
 * name each is under. The name carries a hash of its own pixels, so a rebake
 * that changes a texel changes the URL and no cache anywhere can serve the old
 * one. Anything NOT named here is still painted in the browser; the rug is the
 * one that stays that way on purpose, and the tool says why.
 *
 * If a file listed here fails to arrive, {@link file://./bedsit-page.ts} paints
 * that chart instead — this is a saving, not a dependency.
 */
import type { SurfaceId } from "./bedsit-room";

export const BAKED: Readonly<Partial<Record<SurfaceId, string>>> = {
${rows.map((r) => `  "${r.id}": "bedsit/${r.file}",`).join("\n")}
};

/** the charts above, as a list, for the painter's \`skip\` */
export const BAKED_IDS = Object.keys(BAKED) as SurfaceId[];
`;
const was = (() => { try { return readFileSync(MANIFEST, "utf8"); } catch { return ""; } })();
if (CHECK) {
  if (was !== manifest) stale.push("bedsit-baked.ts does not match what the painter produces");
  console.log(stale.length ? `\nSTALE — run without --check:\n  ${stale.join("\n  ")}` : "\nthe baked charts are up to date");
  process.exit(stale.length ? 1 : 0);
}
writeFileSync(MANIFEST, manifest);

const px = rows.reduce((s, r) => s + r.px, 0), by = rows.reduce((s, r) => s + r.bytes, 0);
const ms = rows.reduce((s, r) => s + r.ms, 0);
console.log(
  `\n${rows.length} charts, ${(px / 1e6).toFixed(1)} megatexels, ${(by / 1048576).toFixed(2)} MB` +
  ` — ${(ms / 1000).toFixed(1)} s of painting the page no longer does.`,
);
