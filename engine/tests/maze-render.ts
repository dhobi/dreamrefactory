/**
 * A DreamFactory 5 node's sphere and a road's film, drawn
 * (engine/src/runtime/maze-render.ts), on rooms built here.
 *
 *   npx vitest run engine/tests/maze-render.ts
 *
 * df5-room.ts draws RedJack's own spheres, so it sees only what RedJack has:
 * patches no finer than 22.5°, every picture decodable, every film frame a
 * picture. This builds the rest. The case that matters is a patch HALF the
 * width of RedJack's finest, as Villains' Revenge's Wonderland maze is full of
 * (#444): the sphere is looked up on a grid of cells as wide as its finest
 * patch, and on RedJack's 22.5° grid such a patch was either lost or smeared
 * over the cell around it.
 *
 * Pictures are 256 × 256, a sphere tile's size, every row a literal run; a
 * colour is its palette index's entry, and the index is the colour's name.
 */
import { expect, test } from "vitest";
import type { DFContainerFile } from "@dreamfactory/engine/df/container";
import { DEPTH_FAR, FilmFrames, SphereImage } from "@dreamfactory/engine/runtime/maze-render";

const BLUE = 1;
const GREEN = 2;
const RED = 3;
/** palette index → the RGBA word the renderer writes (little-endian R G B A) */
const RGB: Record<number, [number, number, number]> = { [BLUE]: [0, 0, 200], [GREEN]: [0, 200, 0], [RED]: [200, 0, 0] };
const word = (i: number): number => {
  const [r, g, b] = RGB[i];
  return (r | (g << 8) | (b << 16) | (255 << 24)) >>> 0;
};

/** a v5 frame: header, palette (or depths) at 0x28, then one row mode per row */
function frame(w: number, h: number, rows: (number[] | "keep")[], depths?: Record<number, number>): Uint8Array {
  const body: number[] = [];
  for (const r of rows) body.push(...(r === "keep" ? [10 << 2] : [1 << 2, ...r]));
  const d = new Uint8Array(0x428 + body.length);
  const v = new DataView(d.buffer);
  d.set([0, 0, 5, 0, 0x50, 0x45, 0x54, 0x53]);
  v.setUint32(0x18, body.length, true);
  v.setInt16(0x20, h, true);
  v.setInt16(0x22, w, true);
  for (const [i, [r, g, b]] of Object.entries(RGB)) d.set([b, g, r, 0], 0x28 + Number(i) * 4);
  for (const [i, z] of Object.entries(depths ?? {})) v.setInt32(0x28 + Number(i) * 4, z, true);
  d.set(body, 0x428);
  return d;
}

const tile = (colour: number, depths?: Record<number, number>): Uint8Array =>
  frame(256, 256, Array.from({ length: 256 }, () => new Array(256).fill(colour)), depths);

interface Patch {
  lon: number;
  lat: number;
  half: number;
  picture: number;
  depth: number;
  kids: number[];
}

/** a SPHR container: the patches, root first, 56 bytes each from 0x28 */
function sphr(patches: Patch[]): Uint8Array {
  const d = new Uint8Array(0x28 + patches.length * 56);
  const v = new DataView(d.buffer);
  d.set([0, 0, 5, 0, 0x52, 0x48, 0x50, 0x53]); // "SPHR" backwards
  v.setInt32(0x24, patches.length, true);
  patches.forEach((p, i) => {
    const r = 0x28 + i * 56;
    v.setFloat64(r + 8, p.lon, true);
    v.setFloat64(r + 16, p.lat, true);
    v.setFloat64(r + 24, p.half, true);
    v.setInt32(r + 32, p.picture, true);
    v.setInt32(r + 36, p.depth, true);
    [0, 1, 2, 3].forEach((k) => v.setInt32(r + 40 + k * 4, p.kids[k] ?? -1, true));
  });
  return d;
}

const file = (containers: Uint8Array[]): DFContainerFile =>
  ({ containers: containers.map((data, id) => ({ id, data })) }) as unknown as DFContainerFile;

const P = Math.PI;

/**
 * The whole sphere in blue; inside it a green patch half RedJack's finest
 * (22.5° across → half π/16), and inside that a red one half again, 11.25°
 * across — the width Wonderland's finest patches are. Each in the quadrant of
 * its parent a quadtree puts it in, so the red patch's centre sits on the
 * centre of a cell of the 11.25° grid.
 */
function nested(): DFContainerFile {
  return file([
    new Uint8Array(8), // 0, as a room's MAZE would be
    sphr([
      { lon: P, lat: P / 2, half: P, picture: 2, depth: 0, kids: [1] },
      { lon: P + P / 16, lat: P / 2 + P / 16, half: P / 16, picture: 3, depth: 0, kids: [2] },
      { lon: P + P / 32, lat: P / 2 + P / 32, half: P / 32, picture: 4, depth: 5, kids: [] },
    ]),
    tile(BLUE),
    tile(GREEN),
    tile(RED),
    tile(RED, { [RED]: 500 }),
  ]);
}

/**
 * One pixel, looking where (lon, lat) is: the centre ray's longitude is
 * π − heading, and its latitude π/2 less the pitch.
 */
function look(img: SphereImage, lon: number, lat: number): number {
  const out = new Uint32Array(1);
  img.render(out, 1, 1, P - lon, P / 2 - lat, P / 3);
  return out[0];
}

test("a patch 11.25° across is drawn where it is, and its parent around it", () => {
  const img = new SphereImage(nested(), 1);
  expect(img.empty).toBe(false);
  expect(look(img, P + P / 32, P / 2 + P / 32)).toBe(word(RED));
  // the other three quarters of the green patch are green: on a 22.5° grid
  // the whole of it was one cell, and the red patch inside it was lost
  expect(look(img, P + (3 * P) / 32, P / 2 + P / 32)).toBe(word(GREEN));
  expect(look(img, P + P / 32, P / 2 + (3 * P) / 32)).toBe(word(GREEN));
  expect(look(img, P + (3 * P) / 32, P / 2 + (3 * P) / 32)).toBe(word(GREEN));
  // and out of both, the root
  expect(look(img, P / 2, P / 2)).toBe(word(BLUE));
  expect(look(img, P + P / 32, P / 2 - P / 32)).toBe(word(BLUE));
});

test("a depth sphere reads the patches' distances, and where none has one, as far as there is", () => {
  const img = new SphereImage(nested(), 1, true);
  expect(look(img, P + P / 32, P / 2 + P / 32)).toBe(500);
  expect(look(img, P / 2, P / 2)).toBe(DEPTH_FAR);
});

test("a patch whose picture will not decode leaves its parent showing", () => {
  const broken = frame(256, 256, [[0]]);
  broken[0x428] = 0; // row mode 0: no such mode
  const f = file([
    new Uint8Array(8),
    sphr([
      { lon: P, lat: P / 2, half: P, picture: 2, depth: 0, kids: [1] },
      { lon: P + P / 16, lat: P / 2 + P / 16, half: P / 16, picture: 3, depth: 0, kids: [] },
    ]),
    tile(BLUE),
    broken,
  ]);
  expect(look(new SphereImage(f, 1), P + P / 16, P / 2 + P / 16)).toBe(word(BLUE));
});

test("a container that is not a sphere draws black", () => {
  const img = new SphereImage(file([new Uint8Array(8), tile(BLUE)]), 1);
  expect(img.empty).toBe(true);
  expect(look(img, P, P / 2)).toBe(0xff000000);
});

test("a coarse render samples every other pixel and doubles it, odd edges included", () => {
  const img = new SphereImage(nested(), 1);
  const fine = new Uint32Array(5 * 3);
  const coarse = new Uint32Array(5 * 3);
  img.render(fine, 5, 3, P / 2, 0, P / 3);
  img.render(coarse, 5, 3, P / 2, 0, P / 3, true);
  // facing away from the small patches: the root's blue either way, and no
  // pixel left unwritten
  expect([...fine].every((p) => p === word(BLUE))).toBe(true);
  expect([...coarse].every((p) => p === word(BLUE))).toBe(true);
});

test("a film decodes its deltas in order, and starts again when sent back", () => {
  const key = frame(2, 2, [
    [BLUE, BLUE],
    [BLUE, BLUE],
  ]);
  // keeps row 0, repaints row 1
  const delta = frame(2, 2, ["keep", [RED, GREEN]]);
  const f = file([new Uint8Array(8), key, delta]);
  const film = new FilmFrames(f, [1, 2, 0]);
  const out = new Uint32Array(4);

  expect(film.render(1, out, 2, 2)).toBe(true);
  expect([...out]).toEqual([word(BLUE), word(BLUE), word(RED), word(GREEN)]);
  expect(film.render(0, out, 2, 2)).toBe(true);
  expect([...out]).toEqual([word(BLUE), word(BLUE), word(BLUE), word(BLUE)]);
  // a frame with no picture (0 is the room's MAZE) draws nothing
  expect(film.render(2, out, 2, 2)).toBe(false);
});
