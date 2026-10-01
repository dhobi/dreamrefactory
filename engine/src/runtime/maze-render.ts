import { DFContainerFile } from "../df/container";
import { FrameBuffer } from "../df/image";
import { decodeFrameV5, paletteV5 } from "../df/image-v5";
import { SphrPatch, readSphere } from "../df/sett";

/**
 * A node's sphere, drawn through a camera — the picture a DreamFactory 5 room
 * shows while you stand still.
 *
 * The projection is a pinhole camera at the sphere's centre: the pixel (x, y)
 * looks along (x − w/2, y − h/2, f) with f = w / (2 tan(fov / 2)), which is
 * the focal length RedJack.exe's projector uses (0x497160), turned by the
 * pitch and then the heading. That ray's longitude is π − heading + its own
 * bearing, and its latitude π/2 plus its drop below the horizon. See
 * engine/src/df/sett.ts for why π − heading, and for the sphere itself.
 *
 * Tiles decode once per node and stay indexed; each has its own palette, so
 * the frame comes out true-colour.
 */

const TAU = Math.PI * 2;

interface Tile {
  pixels: Uint8Array;
  palette: Uint32Array;
  /** lon/lat of the tile's top-left corner, and radians per tile pixel */
  lon0: number;
  lat0: number;
  scale: number;
}

/** the depth of a pixel no depth map covers: nothing there to hide a sprite */
export const DEPTH_FAR = 0x7fffffff;

export class SphereImage {
  private readonly tiles: Tile[] = [];
  /**
   * For each cell, the deepest tile that covers it. A cell is as wide as the
   * sphere's finest patch, so no tile is ever asked for a pixel outside it:
   * RedJack's finest are 22.5° across, so its grid is the 22.5° one it always
   * was; Villains' Revenge's go down to 11.25° (Wonderland's `v131.sett` is
   * full of them), and on a 22.5° grid one of those stood for a whole cell,
   * its edge pixels smeared across the rest.
   */
  private readonly cells: Tile[] = [];
  private readonly cell: number;
  private readonly cellsX: number;
  private readonly cellsY: number;

  /** what a pixel no tile covers reads: black, or as far as there is */
  private readonly none: number;

  /**
   * `depth` reads the patches' depth maps instead of their pictures: the same
   * STEP container and the same codec, with 256 i32 distances where a picture
   * keeps its palette — the camera's units, how far the scenery under each
   * pixel is. RedJack.exe asks them under a sprite (`0x497510`) to hide it
   * behind what stands in front of it.
   */
  constructor(file: DFContainerFile, container: number, depth = false) {
    this.none = depth ? DEPTH_FAR : 0xff000000;
    const patches = readSphere(file, container);
    // the finest patch's width, kept to a power of two of the root's
    const finest = Math.min(Math.PI / 8, ...patches.filter((p) => p.half > 0).map((p) => 2 * p.half));
    this.cell = Math.PI / 2 ** Math.min(8, Math.round(Math.log2(Math.PI / finest)));
    this.cellsX = Math.round(TAU / this.cell);
    this.cellsY = Math.round(Math.PI / this.cell);
    const { cell, cellsX, cellsY } = this;
    const tileOf = new Map<SphrPatch, Tile>();
    for (const p of patches) {
      const d = file.containers[depth ? p.depth : p.picture]?.data;
      if (!d) continue;
      try {
        const fb = new FrameBuffer();
        const r = decodeFrameV5(d, fb);
        const palette = new Uint32Array(256);
        if (depth) {
          const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
          for (let i = 0; i < 256; i++) palette[i] = Math.max(0, dv.getInt32(0x28 + i * 4, true));
        } else {
          const rgba = paletteV5(d);
          const pv = new DataView(rgba.buffer);
          // little-endian RGBA as one word: what a Uint32 view over ImageData wants
          for (let i = 0; i < 256; i++) palette[i] = pv.getUint32(i * 4, true);
        }
        const t: Tile = {
          pixels: fb.pixels.slice(0, r.width * r.height),
          palette,
          lon0: p.lon - p.half,
          lat0: p.lat - p.half,
          scale: (2 * p.half) / r.width,
        };
        this.tiles.push(t);
        tileOf.set(p, t);
      } catch {
        /* a tile that will not decode leaves its parent showing */
      }
    }
    // walk the tree for each cell, keeping the deepest decoded patch
    for (let cy = 0; cy < cellsY; cy++) {
      for (let cx = 0; cx < cellsX; cx++) {
        const lon = (cx + 0.5) * cell;
        const lat = (cy + 0.5) * cell;
        let p: SphrPatch | undefined = patches[0];
        let best = p ? tileOf.get(p) : undefined;
        while (p) {
          const next: SphrPatch | undefined = p.kids
            .map((k) => patches[k])
            .find((c) => c && Math.abs(c.lon - lon) < c.half && Math.abs(c.lat - lat) < c.half);
          if (!next) break;
          p = next;
          best = tileOf.get(p) ?? best;
        }
        if (best) this.cells[cy * cellsX + cx] = best;
      }
    }
  }

  get empty(): boolean {
    return this.cells.length === 0;
  }

  private rays: { key: string; lon: Float32Array; lat: Float32Array } | null = null;

  /**
   * Draw the view into `out` (one RGBA word per pixel), looking along
   * `heading` with `pitch` up and a horizontal field of view of `fov`.
   *
   * Everything but the heading is per-pixel trigonometry, so it is kept
   * between frames; turning — the common case — only adds to a longitude.
   * `coarse` samples every other pixel of every other row and doubles them,
   * which is what the scripts ask for while the view scrolls (`nodequality (24,
   * 8, 0)`, against `(24, 16, 2)` at rest): a pitch change costs a new set of
   * rays, and a quarter of them keep a scroll smooth.
   */
  render(
    out: Uint32Array,
    width: number,
    height: number,
    heading: number,
    pitch: number,
    fov: number,
    coarse = false,
  ): void {
    const step = coarse ? 2 : 1;
    const gw = Math.ceil(width / step);
    const gh = Math.ceil(height / step);
    const key = `${width}x${height}/${step}:${pitch}:${fov}`;
    if (this.rays?.key !== key) {
      const n = gw * gh;
      const lon = new Float32Array(n);
      const lat = new Float32Array(n);
      const f = width / (2 * Math.tan(fov / 2));
      const c = Math.cos(pitch);
      const s = Math.sin(pitch);
      for (let gy = 0, i = 0; gy < gh; gy++) {
        const dy = gy * step + step / 2 - height / 2;
        for (let gx = 0; gx < gw; gx++, i++) {
          const dx = gx * step + step / 2 - width / 2;
          // undo the camera's pitch (0x4a9210 with −pitch)
          const ry = dy * c - f * s;
          const rz = f * c + dy * s;
          lon[i] = Math.atan2(dx, rz);
          lat[i] = Math.PI / 2 + Math.atan2(ry, Math.hypot(dx, rz));
        }
      }
      this.rays = { key, lon, lat };
    }
    const { lon: rl, lat: rt } = this.rays;
    const base = Math.PI - heading;
    const { cells, cell, cellsX, cellsY } = this;
    for (let gy = 0, i = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++, i++) {
        let lon = (base + rl[i]) % TAU;
        if (lon < 0) lon += TAU;
        const lat = rt[i];
        const cx = Math.min(cellsX - 1, (lon / cell) | 0);
        const cy = Math.min(cellsY - 1, Math.max(0, (lat / cell) | 0));
        const t = cells[cy * cellsX + cx];
        let px = this.none;
        if (t) {
          const tx = Math.min(255, ((lon - t.lon0) / t.scale) | 0);
          const ty = Math.min(255, Math.max(0, ((lat - t.lat0) / t.scale) | 0));
          px = t.palette[t.pixels[ty * 256 + tx]];
        }
        if (step === 1) {
          out[i] = px;
          continue;
        }
        const o = gy * 2 * width + gx * 2;
        out[o] = px;
        if (gx * 2 + 1 < width) out[o + 1] = px;
        if (gy * 2 + 1 < height) {
          out[o + width] = px;
          if (gx * 2 + 1 < width) out[o + width + 1] = px;
        }
      }
    }
  }
}

/**
 * A road film, one frame at a time: the pictures are deltas of the one
 * before, as a v5 `.move`'s are, so they decode in order into one buffer.
 */
export class FilmFrames {
  private fb = new FrameBuffer();
  private shown = -1;

  constructor(
    private readonly file: DFContainerFile,
    private readonly pictures: number[],
  ) {}

  /** decode up to frame `i` and draw it into `out` */
  render(i: number, out: Uint32Array, width: number, height: number): boolean {
    if (i < this.shown) this.shown = -1;
    let d: Uint8Array | undefined;
    for (let k = this.shown + 1; k <= i; k++) {
      // 0 is no picture: container 0 is the room's MAZE
      d = this.pictures[k] > 0 ? this.file.containers[this.pictures[k]]?.data : undefined;
      if (!d) return false;
      decodeFrameV5(d, this.fb);
      this.shown = k;
    }
    d = this.pictures[i] > 0 ? this.file.containers[this.pictures[i]]?.data : undefined;
    if (!d) return false;
    const pal = paletteV5(d);
    const pv = new DataView(pal.buffer);
    const words = new Uint32Array(256);
    for (let k = 0; k < 256; k++) words[k] = pv.getUint32(k * 4, true);
    const w = this.fb.width;
    const h = Math.min(this.fb.height, height);
    const px = this.fb.pixels;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < Math.min(w, width); x++) out[y * width + x] = words[px[y * w + x]];
    }
    return true;
  }
}
