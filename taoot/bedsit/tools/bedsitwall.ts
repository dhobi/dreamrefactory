/**
 * A picture's own edges, read off a bake of the wall AROUND it.
 *
 *   npx tsx taoot/tools/bedsitwall.ts <out dir> [texel]
 *
 * The way to measure a thing hanging on a wall is not to pick its corners in a
 * frame — a frame is 512 wide and a picture in the corner of the room is forty
 * pixels of it, so a pick is a hundred units out and three views disagree by
 * three hundred. It is to bake a chart DELIBERATELY LARGER than the picture,
 * on the picture's own wall, and find the row and the column where the plaster
 * stops. The bake resolves every view onto one rectified surface, so the answer
 * is in world units and needs no back-projection at all.
 *
 * This writes one PNG per picture — the wall around it, ten-texel grid, with
 * the world coordinate of every fiftieth line printed down the side — and the
 * numbers to read off it are what `PICTURES` in
 * {@link file://../src/bedsit-room.ts} holds.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSetFile } from "@dreamfactory/engine/df/set";
import { bakeChart, looks } from "../src/bedsit-skin";
import { Chart, PICTURES, ROOM } from "../src/bedsit-room";

const [OUT, TEXEL_ARG] = process.argv.slice(2);
if (!OUT) { console.error("usage: npx tsx taoot/tools/bedsitwall.ts <out dir> [texel]"); process.exit(2); }
const TEXEL = +(TEXEL_ARG ?? 4);
const HERE = dirname(fileURLToPath(import.meta.url));
const set = readSetFile(new Uint8Array(readFileSync(join(HERE, "../../gamefiles/en/titanic1/data/bedsit1.set"))));

/** how much wall to take around each picture */
const MARGIN = 260;

/** the four, each on its own wall, each grown by the margin */
const WIDE: { id: string; u0: number; u1: number; v0: number; v1: number; wall: "x0" | "y0" }[] = [
  { id: "portrait", u0: PICTURES.portrait.y0, u1: PICTURES.portrait.y1, v0: PICTURES.portrait.z0, v1: PICTURES.portrait.z1, wall: "x0" },
  { id: "sketch", u0: PICTURES.sketch.x0, u1: PICTURES.sketch.x1, v0: PICTURES.sketch.z0, v1: PICTURES.sketch.z1, wall: "y0" },
  { id: "print", u0: PICTURES.print.x0, u1: PICTURES.print.x1, v0: PICTURES.print.z0, v1: PICTURES.print.z1, wall: "y0" },
  { id: "hidden", u0: PICTURES.hidden.x0, u1: PICTURES.hidden.x1, v0: PICTURES.hidden.z0, v1: PICTURES.hidden.z1, wall: "y0" },
];

function png(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer): number => { let c = 0xffffffff; for (const byte of b) c = table[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const seen = looks(set);
const upl = set.zFarMax / set.zLevelCount;
for (const w of WIDE) {
  const u0 = w.u0 - MARGIN, u1 = w.u1 + MARGIN, v0 = w.v0 - MARGIN, v1 = w.v1 + MARGIN;
  const chart: Chart = w.wall === "x0"
    ? { id: w.id as never, sharp: true, smooth: true, u0, u1, v0, v1,
        at: (u, v) => [ROOM.x0 + PICTURES.proud, u, v], normalAt: () => [1, 0, 0], uvOf: (p) => [p[1], p[2]] }
    : { id: w.id as never, sharp: true, smooth: true, u0, u1, v0, v1,
        at: (u, v) => [u, ROOM.y0 + PICTURES.proud, v], normalAt: () => [0, 1, 0], uvOf: (p) => [p[0], p[2]] };
  const b = bakeChart(chart, seen, TEXEL, set.viewPortWidth, set.viewPortHeight, upl);
  // upright, brightened, with the grid on: ten texels faint, fifty red
  const K = Math.max(2, Math.round(1100 / b.width));
  const W = b.width * K, H = b.height * K, px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = (x / K) | 0, sy = b.height - 1 - ((y / K) | 0);
    const s = (sy * b.width + sx) * 4, d = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) px[d + c] = Math.min(255, Math.round(b.rgba[s + c] * 2.1));
    px[d + 3] = 255;
    if (sx % 50 === 0 || (b.height - 1 - sy) % 50 === 0) { px[d] = 255; px[d + 1] = 60; px[d + 2] = 60; }
    else if (sx % 10 === 0 || (b.height - 1 - sy) % 10 === 0) { px[d] = Math.min(255, px[d] + 70); }
  }
  writeFileSync(join(OUT, `wall-${w.id}.png`), png(W, H, px));
  console.log(`${w.id.padEnd(9)} ${b.width}×${b.height} texels, ${Math.round(b.covered * 100)}% seen, ${TEXEL} units a texel`);
  console.log(`  u ${u0} + texel*${TEXEL}   (the picture was ${w.u0}..${w.u1})`);
  console.log(`  v ${v0} + texel*${TEXEL}   (the picture was ${w.v0}..${w.v1})`);
}
