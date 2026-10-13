/**
 * The world-sprite scaler against the engines' own output.
 *
 *   npx vitest run engine/tests/sprite-scaler.ts
 *
 * engine/tests/golden/sprite-scaler.json holds, for each seeded case in
 * helpers/sprite-scaler-cases.ts, the SHA-1 of the canvas that DF.EXE's (0x415b30),
 * TI.EXE's (0x412280) and tl.exe's (0x43e9f0) world-sprite draw produced, run
 * under an x86 emulator by tools/native-sprite/record.py. Every case has to come
 * out byte for byte the same, for each engine.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { decodeShpFrame } from "@dreamfactory/engine/df/shp";
import {
  drawScaledSprite, scaledBoxCovers, scaledOrigin, spriteCovers, worldSpriteSize,
} from "@dreamfactory/engine/runtime/sprite-scaler";
import { hitPoints, scalerCases, type ScalerCase } from "./helpers/sprite-scaler-cases";

interface Golden {
  seed: number;
  count: number;
  sprites: string;
  results: Record<"df" | "ti" | "tl", string>[];
}
const golden = JSON.parse(
  readFileSync(new URL("./golden/sprite-scaler.json", import.meta.url), "utf8"),
) as Golden;
const cases = scalerCases(golden.seed, golden.count);


/** a depth mask expanded to one value per pixel */
function maskValues(c: ScalerCase): Uint8Array | null {
  if (!c.mask) return null;
  const m = c.mask;
  const out = new Uint8Array(c.canvasW * c.canvasH);
  for (let y = 0; y < c.canvasH; y++) {
    let p = m[y * 2] | (m[y * 2 + 1] << 8);
    const n = m[p++];
    let x = 0;
    for (let i = 0; i < n; i++, p += 2) {
      out.fill(m[p + 1], y * c.canvasW + x, y * c.canvasW + x + m[p]);
      x += m[p];
    }
  }
  return out;
}

function draw(c: ScalerCase): string {
  const canvas = new Uint8Array(c.canvasW * c.canvasH).fill(0xee);
  const mask = maskValues(c);
  drawScaledSprite(decodeShpFrame(c.sprite), c.ax, c.ay, c.dw, c.dh, c.flip, {
    clip: c.clip,
    drawable: mask ? (x, y) => mask[y * c.canvasW + x] >= c.level : undefined,
    plot: (x, y, v) => {
      canvas[y * c.canvasW + x] = v;
    },
  });
  return createHash("sha1").update(canvas).digest("hex");
}

test("the cases are the ones the engines were run on", () => {
  const digest = createHash("sha1");
  for (const c of cases) digest.update(c.sprite);
  expect(digest.digest("hex")).toBe(golden.sprites);
});

const NAMES = { df: "DF.EXE", ti: "TI.EXE", tl: "tl.exe" } as const;

for (const engine of ["df", "ti", "tl"] as const) {
  test(`every case draws as ${NAMES[engine]} draws it`, () => {
    const wrong: number[] = [];
    cases.forEach((c, i) => {
      if (draw(c) !== golden.results[i][engine]) wrong.push(i);
    });
    // where TI.EXE and tl.exe part from DF.EXE (below), the port draws DF.EXE's
    const parted = golden.results.flatMap((r, i) => (r[engine] !== r.df ? [i] : []));
    expect(wrong, `cases that differ, of ${cases.length}`).toEqual(parted);
  });
}

/**
 * The two cases where TI.EXE and tl.exe draw differently from DF.EXE, both a
 * MIRRORED sprite clipped at the top. The engines skip the clipped source rows
 * before drawing, and for a mirrored sprite TI.EXE and tl.exe skip through their
 * own decoder (TI.EXE 0x431400, picked by the flip flag at 0x4856c0), which leaves
 * different colours in the runs that copy the row above. The same path carries
 * colours over from one draw to the next (record.py runs every case on a freshly
 * loaded engine for that reason), so it is a glitch with no stable answer, and the
 * port draws what DF.EXE draws. Nothing in DreamFactory 1 or 4 mirrors a world
 * sprite in this port yet.
 */
test("TI.EXE and tl.exe part from DF.EXE only on mirrored sprites clipped at the top", () => {
  const parted = golden.results.flatMap((r, i) => (r.ti !== r.df || r.tl !== r.df ? [i] : []));
  expect(parted).toEqual([75, 372]);
  for (const i of parted) {
    const c = cases[i];
    const f = decodeShpFrame(c.sprite);
    expect(c.flip, `case ${i} is mirrored`).toBe(true);
    expect(c.ay - Math.trunc((f.posYraw * c.dh) / f.height), `case ${i} starts above its clip`).toBeLessThan(c.clip.top);
    expect(golden.results[i].ti, `case ${i}: TI.EXE and tl.exe agree with each other`).toBe(golden.results[i].tl);
  }
});

/**
 * The size and place the scaler is handed (DF.EXE 0x41e864, TI.EXE 0x41129e):
 * integers all the way, truncating at every step, where a float k rounded once
 * comes out a pixel larger.
 */
test("a world sprite is sized and placed in truncating integer steps", () => {
  const f = { width: 43, height: 140, posXraw: 21, posYraw: 133 };
  // scale 1000 x ref 96 / 1000 = 96; 96 * 43 / 59 = 69.96 and 96 * 140 / 59 = 227.8
  expect(worldSpriteSize(1000, 96, f, 59)).toEqual({ dw: 69, dh: 227 });
  // the scale is truncated first: 999 * 96 / 1000 = 95.9 -> 95
  expect(worldSpriteSize(999, 96, f, 59)).toEqual({ dw: 69, dh: 225 });
  // far enough away and it comes to nothing on an axis, which draws nothing
  expect(worldSpriteSize(100, 96, f, 500)).toEqual({ dw: 0, dh: 2 });
  // the hot spot scales the same way, and a mirror measures it from the right
  expect(scaledOrigin({ ...f, indexed: new Uint8Array(), opaque: new Uint8Array() }, 200, 150, 69, 227, false))
    .toEqual({ left: 200 - 33, top: 150 - 215 });
  expect(scaledOrigin({ ...f, indexed: new Uint8Array(), opaque: new Uint8Array() }, 200, 150, 69, 227, true))
    .toEqual({ left: 200 - 35, top: 150 - 215 });
});

/**
 * The point tests, against the engines' own: for every case, 24 points around
 * the scaled box and 24 around the 1:1 box, each answered by DF.EXE (0x419500,
 * 0x415960), TI.EXE (0x413540, 0x4120b0) and tl.exe (0x43fc90, 0x43e820) under the
 * emulator (record.py --hits). The three agree on every one.
 */
test("a point is the sprite's exactly when the engines say so", () => {
  const hits = JSON.parse(readFileSync(new URL("./golden/sprite-hits.json", import.meta.url), "utf8")) as {
    seed: number;
    results: Record<"df" | "ti" | "tl", { scaled: string; plain: string }>[];
  };
  const wrong: string[] = [];
  cases.forEach((c, i) => {
    const f = decodeShpFrame(c.sprite);
    const pts = hitPoints(c, hits.seed * 1000 + i);
    const anchorX = c.flip ? f.width - f.posXraw : f.posXraw;
    const box = scaledOrigin(f, c.ax, c.ay, c.dw, c.dh, c.flip);
    const scaled = pts.scaled.map(([x, y]) => (scaledBoxCovers(f, box.left, box.top, c.dw, c.dh, x, y) ? "1" : "0")).join("");
    const plain = pts.plain.map(([x, y]) => (spriteCovers(f, c.ax - anchorX, c.ay - f.posYraw, x, y) ? "1" : "0")).join("");
    for (const engine of ["df", "ti", "tl"] as const) {
      if (scaled !== hits.results[i][engine].scaled) wrong.push(`${i} scaled vs ${engine}`);
      if (plain !== hits.results[i][engine].plain) wrong.push(`${i} 1:1 vs ${engine}`);
    }
  });
  expect(wrong).toEqual([]);
});
