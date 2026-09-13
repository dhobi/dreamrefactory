/**
 * The pictures on the bedsit's walls, read out of BEDSIT1.SET.
 *
 *   npx tsx taoot/tools/bedsitpics.ts sheet <out.png> [texel] [path/to/bedsit1.set]
 *   npx tsx taoot/tools/bedsitpics.ts draw  <out dir> [texel] [path/to/bedsit1.set]
 *
 * There are three: the LONDON — HE'S WATCHING YOU poster by the door, the
 * framed photograph further along the same wall, and the painting over the
 * mantel. None of them is painted by {@link file://../src/bedsit-paint.ts} —
 * a picture is a picture — so each is projected off the frames onto its own
 * flat chart, which rectifies what the frames only ever show at an angle.
 *
 * `sheet` writes all three side by side on one image, each inside a magenta
 * rule that sits OUTSIDE its pixels, with the geometry beside it as JSON: a
 * sheet to send somewhere to be upscaled and cut up again on the way back.
 *
 * `draw` REBUILDS them. A poster is type and flat colour, and forty texels of
 * type is a smear no enlargement recovers; so the three bakes are opened in a
 * browser on {@link file://./bedsitpics.page.html}, which separates the
 * poster's inks and sets its lettering again, takes the photograph's palette
 * dither off and tones it as the monochrome print it is, and repaints the
 * marine picture from its own composition — the horizon, the swell and the
 * lifebuoy where the frames put them — inside a frame drawn round each. What
 * comes out is written to taoot/public as the JPEGs the page hangs on the
 * walls, at four times the resolution the frames hold, as ALBEDO: the room's
 * own lamp lights them there, so they are drawn as ink and paint rather than
 * as the dim pixels of a 1996 night interior.
 *
 * The texel is the world units per pixel, as {@link bake} means it: the page
 * bakes at 18, 6 is about where the frames stop having anything more to give,
 * and `draw` wants 5 or so — fine enough to hold every frame pixel, coarse
 * enough that the dither is still one texel wide and can be averaged away.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSetFile } from "@dreamfactory/engine/df/set";
import { bake } from "../src/bedsit-skin";
import type { SurfaceId } from "../src/bedsit-room";

const PICTURES: readonly SurfaceId[] = ["poster", "photo", "painting"];
const [MODE, OUT, TEXEL_ARG, SET_ARG] = process.argv.slice(2);
if ((MODE !== "sheet" && MODE !== "draw") || !OUT) {
  console.error("usage: npx tsx taoot/tools/bedsitpics.ts sheet|draw <out> [texel] [path/to/bedsit1.set]");
  process.exit(2);
}
const TEXEL = +(TEXEL_ARG ?? (MODE === "draw" ? 5 : 6));
const HERE = dirname(fileURLToPath(import.meta.url));
const set = readSetFile(new Uint8Array(readFileSync(SET_ARG ?? join(HERE, "../../gamefiles/en/titanic1/data/bedsit1.set"))));
// --- PNG ---------------------------------------------------------------------
function png(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const baked = await bake(set, TEXEL, undefined, (id) => PICTURES.includes(id));

async function sheet(): Promise<void> {
  for (const b of baked) console.log(b.id.padEnd(9), `${b.width}×${b.height}`, `${Math.round(b.covered * 100)}% seen`);

  // --- the sheet ---------------------------------------------------------------
  const GUTTER = 16, RULE = 2;
  const order = PICTURES.map((id) => baked.find((b) => b.id === id)!);
  const H = Math.max(...order.map((b) => b.height)) + 2 * (GUTTER + RULE);
  let W = GUTTER;
  const boxes = order.map((b) => {
    const x = W + RULE, y = GUTTER + RULE;
    W += b.width + 2 * RULE + GUTTER;
    return { id: b.id, x, y, w: b.width, h: b.height };
  });
  const sheet = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { sheet[i * 4] = 18; sheet[i * 4 + 1] = 18; sheet[i * 4 + 2] = 22; sheet[i * 4 + 3] = 255; }
  const put = (x: number, y: number, r: number, g: number, bl: number): void => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const k = (y * W + x) * 4;
    sheet[k] = r; sheet[k + 1] = g; sheet[k + 2] = bl; sheet[k + 3] = 255;
  };
  for (const [i, box] of boxes.entries()) {
    const b = order[i];
    // a magenta rule around each picture, outside it, so a crop stays clean
    for (let d = 1; d <= RULE; d++) {
      for (let x = box.x - d; x < box.x + box.w + d; x++) { put(x, box.y - d, 255, 0, 255); put(x, box.y + box.h + d - 1, 255, 0, 255); }
      for (let y = box.y - d; y < box.y + box.h + d; y++) { put(box.x - d, y, 255, 0, 255); put(box.x + box.w + d - 1, y, 255, 0, 255); }
    }
    // the bake's row 0 is the chart's bottom edge: flip it upright
    for (let j = 0; j < b.height; j++) for (let x = 0; x < b.width; x++) {
      const k = ((b.height - 1 - j) * b.width + x) * 4;
      put(box.x + x, box.y + j, b.rgba[k], b.rgba[k + 1], b.rgba[k + 2]);
    }
  }

  const out = OUT;
  writeFileSync(out, png(W, H, sheet));
  writeFileSync(out.replace(/\.png$/, ".json"), JSON.stringify({ texel: TEXEL, sheet: { w: W, h: H }, boxes }, null, 2));
  console.log(`sheet ${W}×${H} → ${out}`);
}

/**
 * The drawing board: the three bakes go to a browser, which redraws them, and
 * the three plates come back as the JPEGs the page hangs.
 */
async function draw(): Promise<void> {
  const { chromium } = await import("playwright");
  const src: Record<string, unknown> = {};
  for (const b of baked) {
    // upright, since everything on the board is top-down like a picture
    const up = new Uint8Array(b.width * b.height * 4);
    for (let y = 0; y < b.height; y++) up.set(b.rgba.subarray((b.height - 1 - y) * b.width * 4, (b.height - y) * b.width * 4), y * b.width * 4);
    src[b.id] = { w: b.width, h: b.height, png: png(b.width, b.height, up).toString("base64") };
  }
  // the photograph is not rebuilt off its bake — see the board — but hung as
  // the press photograph itself, cropped to the window the game's close-up shows
  src.churchill = readFileSync(join(HERE, "bedsitpics-churchill.jpg")).toString("base64");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1500 } });
  page.on("pageerror", (e) => console.error("board:", e.message));
  await page.addInitScript(`window.__SRC__ = ${JSON.stringify(src)};`);
  await page.goto(`file://${join(HERE, "bedsitpics.page.html")}`);
  await page.waitForFunction("window.__ready === true", null, { timeout: 180000 });
  for (const id of PICTURES) {
    const plate = await page.locator(`#${id}`).screenshot();
    // JPEG, because a megapixel of painted grain is three times the size as PNG
    const jpeg = await page.evaluate(async (data) => {
      const img = new Image();
      img.src = "data:image/png;base64," + data;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext("2d")!.drawImage(img, 0, 0);
      return c.toDataURL("image/jpeg", 0.9).split(",")[1];
    }, plate.toString("base64"));
    const file = join(OUT, `${id}.jpg`);
    writeFileSync(file, Buffer.from(jpeg, "base64"));
    console.log(`${file}  ${Math.round(Buffer.from(jpeg, "base64").length / 1024)} KB`);
  }
  await browser.close();
}

void (MODE === "draw" ? draw() : sheet());
