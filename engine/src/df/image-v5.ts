import { DecodedFrame, FrameBuffer } from "./image";

/**
 * DreamFactory 5's picture: one frame container, carrying its OWN palette.
 *
 * `00 00 05 00 "PETS"` (STEP backwards) at the top, as every v5 container opens,
 * and then — read out of RedJack.exe, whose loader (0x4927b0) copies the palette
 * and whose decoder (0x492850, hand-written assembly) draws the rest:
 *
 *   0x18  u32   the size of the pixel stream (what the decoder consumes)
 *   0x20  i16   height, i16 width
 *   0x28  256 × {u8 blue, green, red, reserved}   the frame's palette
 *   0x428       the pixel stream
 *
 * The stream is v4's codec (engine/src/df/image.ts) with no change a picture
 * can see: the same nineteen row modes on the same byte (`>> 2`), the same eight
 * run modes on the same three bits and the same five-bit count, and the same
 * bit-packed delta runs down to the delta table (`8 8 8 8 8 8 8 7 6 5 4 3 2 1 0`
 * at 0x4c2508). What moved is the PALETTE: a v4 film keeps one in its header for
 * every frame, and a v5 frame brings its own, which is how RedJack's films fade
 * and colour-shift between frames without a palette change anywhere else.
 *
 * Written as its own decoder rather than a flag on v4's because the two differ in
 * a corner that matters to a delta chain: v5's bit-packed run rewinds the unread
 * bits at its end by whole bytes (0x492c2f), and v4's port does not agree with it
 * on RedJack's data — the first frame of the fight help died in row 0.
 */

/** where the pixels start, after the header and the palette */
export const V5_PIXELS_AT = 0x428;
const V5_PALETTE_AT = 0x28;
const V5_SIZE_AT = 0x20;

/** `bp - 1` → the delta a bit-packed code of that length adds (0x4c2508) */
const DELTA = [8, 8, 8, 8, 8, 8, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0];
/** row modes 2..9: how many rows up (positive) or down the reference row is */
const ROW_REF = [0, 0, 4, 3, 2, 1, -1, -2, -3, -4];

/** is this a v5 frame container? */
export function isV5Frame(data: Uint8Array): boolean {
  return data.length > V5_PIXELS_AT && data[2] === 5 && data[3] === 0 && data[4] === 0x50 && data[7] === 0x53;
}

/** a v5 frame's own palette, as RGBA */
export function paletteV5(data: Uint8Array): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const p = V5_PALETTE_AT + i * 4;
    rgba[i * 4] = data[p + 2];
    rgba[i * 4 + 1] = data[p + 1];
    rgba[i * 4 + 2] = data[p];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/** decode a v5 frame into `fb` — which, as in v4, may hold the frame before it */
export function decodeFrameV5(data: Uint8Array, fb: FrameBuffer): DecodedFrame {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const h = view.getInt16(V5_SIZE_AT, true);
  const w = view.getInt16(V5_SIZE_AT + 2, true);
  fb.ensure(w, h);
  decodeStreamV5(data, V5_PIXELS_AT, fb.pixels, w, h);
  return { width: w, height: h, hasZ: false, zOffset: -1 };
}

/**
 * The pixel stream, as 0x492850 runs it. `pitch` is the width here: the
 * original draws into a surface whose pitch it passes in, and a frame buffer of
 * the frame's own width is one whose pitch IS its width.
 *
 * Returns where the stream ended, which on every shipped frame is exactly the
 * size stored at 0x18 — the test that says the decode stayed in step.
 */
export function decodeStreamV5(
  src: Uint8Array,
  start: number,
  out: Uint8Array,
  w: number,
  h: number,
  pitch = w,
): number {
  let s = start;
  let o = 0;
  for (let y = 0; y < h; y++, o = y * pitch) {
    const m = src[s++] >> 2;
    if (m === 1) {
      out.set(src.subarray(s, s + w), o);
      s += w;
      continue;
    }
    if (m === 10) continue; // keep the row the buffer already has
    if (m >= 11) {
      // a whole row copied from 1..4 rows up (11..14) or down (15..18)
      const k = m <= 14 ? 15 - m : 14 - m;
      out.copyWithin(o, o - k * pitch, o - k * pitch + w);
      continue;
    }
    if (m < 2) throw new Error(`v5 frame: bad row mode ${m} (row ${y})`);
    let ref = o - ROW_REF[m] * pitch;
    let left = w;
    while (left > 0) {
      const c = src[s++];
      let n = c >> 3;
      if (!n) n = src[s++] + 32;
      left -= n;
      switch (c & 7) {
        case 2: // keep what is there
          break;
        case 3: // copy from the reference row
          for (let i = 0; i < n; i++) out[o + i] = out[ref + i];
          break;
        case 4: // repeat the pixel to the left
          out.fill(out[o - 1], o, o + n);
          break;
        case 5: // literal
          out.set(src.subarray(s, s + n), o);
          s += n;
          break;
        case 6: // fill with one byte
          out.fill(src[s++], o, o + n);
          break;
        case 7: {
          // copy from `off` pixels back, LZ-style (a short offset tiles)
          const off = src[s] | (src[s + 1] << 8);
          s += 2;
          for (let i = 0; i < n; i++) out[o + i] = out[o - off + i];
          break;
        }
        default:
          s = bitPacked(src, s, out, o, n, (c & 7) === 0 ? -1 : ref);
      }
      o += n;
      ref += n;
    }
    if (left !== 0) throw new Error(`v5 frame: row ${y} overran by ${-left}`);
  }
  return s;
}

/**
 * The bit-packed delta run (0x492b75): each pixel is its reference pixel,
 * adjusted by a code read off a big-endian bit stream. `ref` -1 is run mode 0 —
 * the first pixel literal and each one after measured against its left
 * neighbour; otherwise the reference row.
 */
function bitPacked(src: Uint8Array, s: number, out: Uint8Array, o: number, n: number, ref: number): number {
  let p = o;
  let r = ref;
  let todo = n;
  if (ref < 0) {
    r = o;
    out[p++] = src[s++];
    todo--;
  }
  let ax = (src[s] << 8) | src[s + 1];
  let dx = (src[s + 2] << 8) | src[s + 3];
  s += 4;
  let bits = 16;
  const take = (k: number): void => {
    while (k > 0) {
      if (bits === 0) {
        dx = (src[s] << 8) | src[s + 1];
        s += 2;
        bits = 16;
      }
      const t = Math.min(k, bits);
      ax = ((ax << t) | (dx >>> (16 - t))) & 0xffff;
      dx = (dx << t) & 0xffff;
      bits -= t;
      k -= t;
    }
  };
  while (todo-- > 0) {
    const bp = ax ? 31 - Math.clz32(ax) : -1;
    if (bp === 15) {
      out[p++] = out[r++];
      take(1);
    } else if (bp >= 8) {
      const d = DELTA[bp - 1];
      out[p++] = (out[r++] + ((ax >> (bp - 1)) & 1 ? d : -d)) & 0xff;
      take(d + 2);
    } else {
      out[p++] = ((ax & 0xff) + out[r++]) & 0xff;
      take(16);
    }
  }
  // hand back the bytes the window and the next word were still holding
  s -= 2;
  if (bits >= 8) s--;
  if (bits >= 16) s--;
  return s;
}

/**
 * How far away the scenery is under each pixel of a film's picture — what hides
 * a sprite while a road or a turn plays, as a sphere's depth maps do at a node.
 *
 * It rides behind the picture in the same container. RedJack.exe's projector
 * (0x435490) hands high.c the bytes from `[0x18]` on (0x44bca0), and they are
 *
 *   `[0x26]` × i32   the distances, near to far; the last is 0x7fffffff, nothing
 *   height × u16     each row's offset, from the start of this table
 *   per row          a run count, then (length, level) pairs across the row
 *
 * and a pixel's distance is its level's (0x44c7f0), the level held below the
 * count. A picture with no distances (a count of 0) is measured in steps of a
 * room-wide size instead, which this does not read; it answers null, and nothing
 * hides a sprite on it.
 */
export function depthV5(data: Uint8Array): { z: Uint32Array; w: number; h: number } | null {
  if (!isV5Frame(data) || data.length < V5_PIXELS_AT) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const at = v.getUint32(0x18, true);
  const n = v.getUint16(0x26, true);
  const h = v.getInt16(V5_SIZE_AT, true);
  const w = v.getInt16(V5_SIZE_AT + 2, true);
  const rows = at + n * 4;
  if (!n || w <= 0 || h <= 0 || rows + h * 2 > data.length) return null;
  const table = new Uint32Array(n);
  for (let i = 0; i < n; i++) table[i] = Math.max(0, v.getInt32(at + i * 4, true));
  const z = new Uint32Array(w * h).fill(0x7fffffff);
  for (let y = 0; y < h; y++) {
    let p = rows + v.getUint16(rows + y * 2, true);
    if (p >= data.length) continue;
    let runs = data[p++];
    let x = 0;
    while (runs-- > 0 && p + 1 < data.length && x < w) {
      const len = data[p];
      const d = table[Math.min(data[p + 1], n - 1)];
      p += 2;
      z.fill(d, y * w + x, y * w + Math.min(w, x + len));
      x += len;
    }
  }
  return { z, w, h };
}
