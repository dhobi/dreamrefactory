/**
 * Looking at BEDSIT1's own frames, to build the room against.
 *
 *   npx tsx taoot/tools/bedsitlook.ts views
 *   npx tsx taoot/tools/bedsitlook.ts grid <view> <x0> <y0> <x1> <y1> <out.png>
 *   npx tsx taoot/tools/bedsitlook.ts pick <view> <plane> <x,y> [x,y ...]
 *   npx tsx taoot/tools/bedsitlook.ts vs   <view> <x0> <y0> <x1> <y1> <ours.png> <out.png>
 *
 * A `<view>` is the name the game gives it — `Scene3/View23` — which is worth
 * insisting on: the SET's scene order is not the game's, `scenes[0]` is called
 * Scene3, and a session spent measuring the wrong frame is the price of
 * forgetting it. `views` prints the lot with the bearing of each.
 *
 * **grid** writes one frame, or a rectangle of it, blown up with a grid every
 * ten pixels and a red line every fifty, brightened by `GAIN` (default 1.55,
 * since this is a night interior and half of what it records is under the
 * threshold of a screenshot). The grid is there to read pixel coordinates off
 * by eye, which is what **pick** then wants.
 *
 * **pick** turns those pixels into places in the room, two ways at once:
 *
 *   - through a PLANE — `z1400` for the desk's top, `x4150` for its front —
 *     which is exact, and is the measurement to use for anything that stands on
 *     a surface whose height is already known: the ray through the pixel where
 *     a thing meets the wood crosses that plane exactly where it stands.
 *   - through the frame's own DEPTH LEVEL, which needs nothing known but is
 *     quantized to 629 units, so it is ±315 and no better. Good for finding a
 *     plane in the first place; useless for placing a bottle on a desk.
 *
 * **vs** puts the game's frame over a screenshot of ours from the same eye, on
 * the same crop, so the two can be read against each other. Stand where the
 * frame stands first — `window.bedsit.stand(x, y, z, deg)` in the page takes
 * the eye and bearing that `views` prints.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSetFile, RIGHTTURNS, LEFTTURNS, SetFile, FrameInfo } from "@dreamfactory/engine/df/set";
import { indexedToRGBA, paletteToRGBA } from "@dreamfactory/engine/df/image";
import { RingCache } from "@dreamfactory/engine/web/ring-cache";

const HERE = dirname(fileURLToPath(import.meta.url));
const set: SetFile = readSetFile(new Uint8Array(readFileSync(
  process.env.SET_PATH ?? join(HERE, "../../gamefiles/en/titanic1/data/bedsit1.set"),
)));
const W = set.viewPortWidth, H = set.viewPortHeight, FOCAL = Math.max(W, H) / 2;
const UNITS_PER_LEVEL = set.zFarMax / set.zLevelCount;

/** one standpoint frame, found by the name the game gives it */
function findView(name: string): { fi: FrameInfo; rgba: Uint8Array; z: Uint8Array | undefined } {
  const want = name.toLowerCase().replace(/\s/g, "");
  const cache = new RingCache(set);
  for (const scene of set.scenes) {
    for (const view of scene.views) {
      if (`${scene.sceneName}/${view.viewName}`.toLowerCase() !== want) continue;
      const pal = paletteToRGBA(set.paletteRaw, set.colorCount);
      for (const d of [RIGHTTURNS, LEFTTURNS] as const) {
        const frames = scene.turns[d].frames;
        const decoded = cache.ensure(frames);
        for (const fi of frames) {
          if (fi.motionInfo !== 2 || (fi.axisX8 & 0xff) !== (view.rotation8 & 0xff)) continue;
          const cf = decoded.get(fi.frameContainerLoc);
          if (cf) return { fi, rgba: new Uint8Array(indexedToRGBA(cf.pixels, cf.width, cf.height, pal).buffer), z: cf.z };
        }
      }
    }
  }
  console.error(`no view called ${name} — try: npx tsx taoot/tools/bedsitlook.ts views`);
  return process.exit(2);
}

function png(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const T = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer): number => {
    let c = 0xffffffff;
    for (const x of b) c = T[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (t: string, d: Buffer): Buffer => {
    const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
    const body = Buffer.concat([Buffer.from(t, "ascii"), d]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([l, body, c]);
  };
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ih), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const GAIN = +(process.env.GAIN ?? 1.55);
const lift = (v: number): number => Math.min(255, Math.round(255 * Math.pow(v / 255, 1 / GAIN)));

/** a crop of a frame, blown up, with the grid on it unless NOGRID is set */
function blowUp(rgba: Uint8Array, x0: number, y0: number, x1: number, y1: number, grid = true): { w: number; h: number; px: Uint8Array } {
  const cw = x1 - x0, ch = y1 - y0, K = Math.max(2, Math.round(1500 / cw));
  const w = cw * K, h = ch * K, px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x0 + ((x / K) | 0), sy = y0 + ((y / K) | 0);
    const s = (sy * W + sx) * 4, d = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) px[d + c] = lift(rgba[s + c]);
    px[d + 3] = 255;
    if (!grid) continue;
    if (sx % 50 === 0 || sy % 50 === 0) { px[d] = 255; px[d + 1] = 60; px[d + 2] = 60; }
    else if ((sx % 10 === 0 || sy % 10 === 0) && (x % K === 0 || y % K === 0)) {
      px[d] = Math.min(255, px[d] + 70); px[d + 1] = Math.min(255, px[d + 1] + 20);
    }
  }
  return { w, h, px };
}

const [MODE, ...rest] = process.argv.slice(2);

if (MODE === "views") {
  for (const scene of set.scenes) {
    console.log(`\n== ${scene.sceneName} ==`);
    for (const v of scene.views) {
      const { fi } = findView(`${scene.sceneName}/${v.viewName}`);
      console.log(
        `  ${scene.sceneName}/${v.viewName}`.padEnd(22),
        `deg ${String(v.rotation8 & 0xff).padStart(3)}`,
        `eye ${fi.posX16}, ${fi.posZ16}, ${fi.posY16}`,
      );
    }
  }
} else if (MODE === "grid") {
  const [name, x0, y0, x1, y1, out] = rest;
  const { rgba } = findView(name);
  const { w, h, px } = blowUp(rgba, +x0, +y0, +x1, +y1, !process.env.NOGRID);
  writeFileSync(out, png(w, h, px));
  console.log(`${out}  ${name} x ${x0}..${x1} y ${y0}..${y1}, red lines every 50 pixels`);
} else if (MODE === "pick") {
  const [name, plane, ...picks] = rest;
  const { fi, z } = findView(name);
  const th = (2 * Math.PI * (fi.axisX8 & 0xff)) / 256, c = Math.cos(th), s = Math.sin(th);
  console.log(`${name}  eye ${fi.posX16}, ${fi.posZ16}, ${fi.posY16}  deg ${fi.axisX8 & 0xff}  ${UNITS_PER_LEVEL.toFixed(1)} units to a depth level`);
  for (const pick of picks) {
    const [px, py] = pick.split(",").map(Number);
    const rr = (px - W / 2) / FOCAL, ru = -(py - H / 2) / FOCAL;
    const dx = c - s * rr, dy = s + c * rr, dz = ru;
    const axis = plane[0], at = +plane.slice(1);
    const t = axis === "z" ? (at - fi.posY16) / dz : axis === "x" ? (at - fi.posX16) / dx : (at - fi.posZ16) / dy;
    const on = [fi.posX16 + dx * t, fi.posZ16 + dy * t, fi.posY16 + dz * t];
    const level = z?.[Math.round(py) * W + Math.round(px)];
    const len = Math.hypot(dx, dy, dz), radial = ((level ?? 0) + 0.5) * UNITS_PER_LEVEL;
    console.log(
      pick.padStart(9),
      `on ${plane}: x ${on[0].toFixed(0)} y ${on[1].toFixed(0)} z ${on[2].toFixed(0)}`,
      level === undefined ? " | no depth" :
        ` | level ${String(level).padStart(2)}: x ${(fi.posX16 + (dx / len) * radial).toFixed(0)}` +
        ` y ${(fi.posZ16 + (dy / len) * radial).toFixed(0)} z ${(fi.posY16 + (dz / len) * radial).toFixed(0)}` +
        ` (±${(UNITS_PER_LEVEL / 2).toFixed(0)})`,
    );
  }
} else if (MODE === "vs") {
  const [name, x0, y0, x1, y1, ours, out] = rest;
  const { rgba } = findView(name);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // ours, resampled to the frame's own size, so the two crop identically
  const mine = await page.evaluate(async ([data, w, h]) => {
    const img = new Image();
    img.src = "data:image/png;base64," + data;
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = w as number; cv.height = h as number;
    const ctx = cv.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    return [...new Uint8Array(ctx.getImageData(0, 0, cv.width, cv.height).data.buffer)];
  }, [readFileSync(ours).toString("base64"), W, H] as [string, number, number]);
  await browser.close();
  const top = blowUp(rgba, +x0, +y0, +x1, +y1, false);
  const bottom = blowUp(Uint8Array.from(mine), +x0, +y0, +x1, +y1, false);
  const gap = 8, h = top.h + gap + bottom.h, px = new Uint8Array(top.w * h * 4);
  px.set(top.px, 0);
  px.set(bottom.px, (top.h + gap) * top.w * 4);
  writeFileSync(out, png(top.w, h, px));
  console.log(`${out}  top: ${name} as the game rendered it, bottom: ours`);
} else {
  console.error("usage: npx tsx taoot/tools/bedsitlook.ts views | grid | pick | vs");
  process.exit(2);
}
