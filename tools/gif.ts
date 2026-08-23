/**
 * A GIF reader, for the one thing this repository wants a GIF for: turning an
 * animation somebody else authored into a DreamFactory MOV (taoot/tools/mknightdive.ts).
 *
 * It is a decoder and nothing else — no writer, no optimiser. What it hands back
 * is what the MOV builder needs and no more: each frame **already composited**
 * onto the logical screen as RGBA, and the delay the file authored for it.
 *
 * The parts of the format that matter here, and that a naive reader gets wrong:
 *
 *  - **A frame is a patch, not a picture.** Each image descriptor carries its own
 *    left/top/width/height, and most encoders emit only the rectangle that
 *    changed. The canvas is the state; a frame is an edit to it.
 *  - **Disposal decides what the NEXT frame starts from** — keep the canvas (0/1),
 *    clear this frame's rectangle back to transparent (2), or put back whatever
 *    was under it (3). Ignoring it smears an animation into a palimpsest.
 *  - **Palettes are per frame.** A local colour table replaces the global one for
 *    that image only, so "the GIF's palette" is not a thing a caller can rely on
 *    — which is why this returns RGBA and lets the caller decide on colours.
 *  - **Interlaced frames** are stored in four passes; rare now, still legal.
 *
 * No dependencies, no canvas: this runs under `tsx` in a build script, and its
 * output has to be identical on every machine that runs it.
 */

/** one composited frame of an animation */
export interface GifFrame {
  /** the whole logical screen, composited, 4 bytes per pixel */
  rgba: Uint8ClampedArray;
  /** how long the file says to hold it, in centiseconds (0 = unstated) */
  delayCs: number;
}

export interface GifImage {
  width: number;
  height: number;
  frames: GifFrame[];
  /** how many times the file asks to repeat (0 = forever, undefined = unstated) */
  loopCount?: number;
}

/** a cursor over the byte stream, since every field here is little-endian */
class Reader {
  pos = 0;
  constructor(readonly d: Uint8Array) {}
  u8(): number {
    return this.d[this.pos++];
  }
  u16(): number {
    const v = this.d[this.pos] | (this.d[this.pos + 1] << 8);
    this.pos += 2;
    return v;
  }
  bytes(n: number): Uint8Array {
    const v = this.d.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  /**
   * A GIF payload is a chain of sub-blocks, each a length byte then that many
   * bytes, ended by a zero length. Joined here because LZW codes run straight
   * across the boundaries — a decoder that treats sub-blocks as separate streams
   * desynchronises on the first frame big enough to need two.
   */
  subBlocks(): Uint8Array {
    const parts: Uint8Array[] = [];
    let total = 0;
    for (let n = this.u8(); n; n = this.u8()) {
      parts.push(this.bytes(n));
      total += n;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }
  /** skip a chain of sub-blocks without keeping it (comments, applications) */
  skipSubBlocks(): void {
    for (let n = this.u8(); n; n = this.u8()) this.pos += n;
  }
}

/**
 * LZW as GIF uses it: codes are variable width, the code table starts as the
 * `1 << minCodeSize` literals plus CLEAR and END, and it grows one entry per code
 * decoded until 4095 — at which point it simply stops growing rather than
 * clearing itself (only an explicit CLEAR resets it).
 *
 * The table is kept as prefix/suffix arrays rather than as byte arrays per entry:
 * an entry is "another entry, plus one byte", so expanding one is a walk back
 * through the prefixes, written into the output tail-first.
 */
function lzwDecode(data: Uint8Array, minCodeSize: number, pixelCount: number): Uint8Array {
  const out = new Uint8Array(pixelCount);
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);

  let codeSize = minCodeSize + 1;
  let next = end + 1;
  let bitBuf = 0;
  let bitCount = 0;
  let at = 0;
  let outPos = 0;
  let prev = -1;
  /** the first byte of the previous expansion — what a not-yet-known code ends in */
  let first = 0;

  while (outPos < pixelCount) {
    while (bitCount < codeSize) {
      if (at >= data.length) return out; // truncated stream: keep what decoded
      bitBuf |= data[at++] << bitCount;
      bitCount += 8;
    }
    const code = bitBuf & ((1 << codeSize) - 1);
    bitBuf >>= codeSize;
    bitCount -= codeSize;

    if (code === end) break;
    if (code === clear) {
      codeSize = minCodeSize + 1;
      next = end + 1;
      prev = -1;
      continue;
    }

    // The one self-referential case: a code the table does not hold YET can only
    // be "the previous entry plus its own first byte" — the encoder emitted it in
    // the same step that defines it.
    let cur = code;
    let top = 0;
    if (code >= next) {
      if (prev < 0) break; // a damaged stream, not a legal one
      stack[top++] = first;
      cur = prev;
    }
    // an entry is a prefix entry plus one byte, so expanding it walks backwards
    while (cur >= clear) {
      stack[top++] = suffix[cur];
      cur = prefix[cur];
    }
    first = cur;
    stack[top++] = cur;
    while (top > 0 && outPos < pixelCount) out[outPos++] = stack[--top];

    if (prev >= 0 && next < 4096) {
      prefix[next] = prev;
      suffix[next] = first;
      next++;
      // the table just outgrew the current width (256, 512, 1024, 2048)
      if (next < 4096 && (next & (next - 1)) === 0) codeSize++;
    }
    prev = code;
  }
  return out;
}

/** the row order of an interlaced frame: four passes, coarse to fine */
function deinterlaceRow(row: number, height: number): number {
  const p1 = Math.ceil(height / 8);
  const p2 = Math.ceil((height - 4) / 8);
  const p3 = Math.ceil((height - 2) / 4);
  if (row < p1) return row * 8;
  if (row < p1 + p2) return (row - p1) * 8 + 4;
  if (row < p1 + p2 + p3) return (row - p1 - p2) * 4 + 2;
  return (row - p1 - p2 - p3) * 2 + 1;
}

/** Decode every frame of a GIF, composited onto the logical screen. */
export function decodeGif(data: Uint8Array): GifImage {
  const r = new Reader(data);
  const sig = String.fromCharCode(...r.bytes(6));
  if (sig !== "GIF87a" && sig !== "GIF89a") throw new Error(`not a GIF (${sig})`);

  const width = r.u16();
  const height = r.u16();
  const packed = r.u8();
  r.u8(); // background colour index — unused: frame 0 starts from transparent
  r.u8(); // pixel aspect ratio
  const globalTable = packed & 0x80 ? r.bytes(3 * (2 << (packed & 7))) : null;

  const frames: GifFrame[] = [];
  let loopCount: number | undefined;
  // the canvas frames composite onto, and the graphic control that applies to
  // the NEXT image descriptor (a GCE precedes the image it describes)
  const canvas = new Uint8ClampedArray(width * height * 4);
  let delayCs = 0;
  let transparent = -1;
  let disposal = 0;

  for (;;) {
    const block = r.u8();
    if (block === 0x3b || r.pos > data.length) break; // trailer, or a truncated file

    if (block === 0x21) {
      const label = r.u8();
      if (label === 0xf9) {
        r.u8(); // block size, always 4
        const flags = r.u8();
        delayCs = r.u16();
        const t = r.u8();
        r.u8(); // block terminator
        disposal = (flags >> 2) & 7;
        transparent = flags & 1 ? t : -1;
      } else if (label === 0xff) {
        const size = r.u8();
        const name = String.fromCharCode(...r.bytes(size));
        const body = r.subBlocks();
        // NETSCAPE2.0: sub-block 1, then a u16 repeat count
        if (name.startsWith("NETSCAPE") && body.length >= 3 && body[0] === 1) {
          loopCount = body[1] | (body[2] << 8);
        }
      } else {
        r.skipSubBlocks();
      }
      continue;
    }

    if (block !== 0x2c) continue; // anything else is padding or damage

    const left = r.u16();
    const top = r.u16();
    const fw = r.u16();
    const fh = r.u16();
    const ipacked = r.u8();
    const table = ipacked & 0x80 ? r.bytes(3 * (2 << (ipacked & 7))) : globalTable;
    const interlaced = !!(ipacked & 0x40);
    const minCodeSize = r.u8();
    const indices = lzwDecode(r.subBlocks(), minCodeSize, fw * fh);
    if (!table) throw new Error("GIF frame has no colour table");

    // disposal 3 wants what was under this rectangle before the frame drew, so
    // it has to be taken now rather than reconstructed after
    const under = disposal === 3 ? canvas.slice() : null;

    for (let y = 0; y < fh; y++) {
      const sy = interlaced ? deinterlaceRow(y, fh) : y;
      const cy = top + sy;
      if (cy >= height) continue;
      for (let x = 0; x < fw; x++) {
        const cx = left + x;
        if (cx >= width) continue;
        const idx = indices[y * fw + x];
        if (idx === transparent) continue; // transparent pixels show the canvas
        const o = (cy * width + cx) * 4;
        canvas[o] = table[idx * 3];
        canvas[o + 1] = table[idx * 3 + 1];
        canvas[o + 2] = table[idx * 3 + 2];
        canvas[o + 3] = 255;
      }
    }

    frames.push({ rgba: canvas.slice(), delayCs });

    if (disposal === 2) {
      // back to transparent, this frame's rectangle only
      for (let y = top; y < Math.min(top + fh, height); y++) {
        canvas.fill(0, (y * width + left) * 4, (y * width + Math.min(left + fw, width)) * 4);
      }
    } else if (disposal === 3 && under) {
      canvas.set(under);
    }
    delayCs = 0;
    transparent = -1;
    disposal = 0;
  }

  if (!frames.length) throw new Error("GIF has no frames");
  return { width, height, frames, loopCount };
}
