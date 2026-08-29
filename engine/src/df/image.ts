import { ByteOrder, PC, little } from "./byte-order";

/**
 * Frame decompression for SET/MOV-style image containers.
 * Port of DFfile::getRawImageData (dfet/libs/DFfile/DFfile.cpp).
 *
 * Frames are delta-encoded: several row modes / run modes copy pixels
 * from "the previous image", i.e. whatever the target buffer already
 * contains. Callers must therefore decode frame sequences in order into
 * the same persistent FrameBuffer.
 */
export interface DecodedFrame {
  width: number;
  height: number;
  hasZ: boolean;
  /**
   * Byte offset where the Z layer's row-offset table begins, or -1 without one.
   * The table's entries are relative to it, so the tail from here on is a
   * self-contained block a re-encode can carry over verbatim (see
   * {@link encodeFrame} — the set editor's PNG import).
   */
  zOffset: number;
}

export class FrameBuffer {
  /** indexed pixels, width*height; reused across frames (delta decoding) */
  pixels: Uint8Array = new Uint8Array(0);
  /** depth values, width*height, valid when the last frame had a Z layer */
  zPixels: Uint8Array = new Uint8Array(0);
  width = 0;
  height = 0;

  ensure(width: number, height: number): void {
    const n = width * height;
    if (this.pixels.length < n) {
      // deliberately keep old content when same size; resize only grows
      const old = this.pixels;
      this.pixels = new Uint8Array(n);
      this.pixels.set(old.subarray(0, Math.min(old.length, n)));
      this.zPixels = new Uint8Array(n);
    }
    this.width = width;
    this.height = height;
  }
}

/**
 * `order` is the containing file's ({@link file://./byte-order.ts}). Only three
 * numbers in a frame are integers at all — the two dimensions in its header and
 * the back-reference offset of run mode 7 — and the run stream itself is bytes,
 * so a Macintosh frame is the same codec reading the same runs. Everything else
 * on this page is byte-addressed and needs no flag.
 */
export function decodeFrame(
  data: Uint8Array,
  fb: FrameBuffer,
  order: ByteOrder = PC,
): DecodedFrame {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const le = little(order);
  const height = view.getInt16(0, le);
  const width = view.getInt16(2, le);
  fb.ensure(width, height);
  const out = fb.pixels;

  let inPos = 4;
  let outPos = 0;
  // How far back (in pixels) the "copy from earlier output" modes reach.
  // Deliberately declared OUTSIDE the row loop: a row whose mode sets no
  // lookback (rowMode 10, and runs inside it) reuses the previous row's.
  let lookback = 0;

  for (let row = 0; row < height; row++) {
    let pixelsWritten = 0;
    const rowMode = data[inPos++] >> 2;

    // NOTE: the first branch is intentionally NOT `else if` — rowMode 1 both
    // copies a full literal row AND (via the `<= 5` branch) sets the lookback
    // for later rows/runs, exactly as the original decoder does.
    if (rowMode === 1) {
      out.set(data.subarray(inPos, inPos + width), outPos);
      pixelsWritten = width;
      outPos += width;
      inPos += width;
    }
    if (rowMode <= 5) {
      // lookback 1..5 rows up (rowMode 1 -> 5 rows, 5 -> 1 row)
      lookback = width * (6 - rowMode);
    } else if (rowMode <= 9) {
      // rowModes 6..9 produce a NEGATIVE lookback (-1..-4 rows), i.e. the
      // copy modes read from rows BELOW the current one (already decoded in
      // a previous frame of the delta sequence)
      lookback = width * (5 - rowMode);
    } else if (rowMode === 10) {
      // keep row from previous image
      pixelsWritten = width;
      outPos += width;
    } else if (rowMode <= 14) {
      lookback = width * (15 - rowMode);
      out.copyWithin(outPos, outPos - lookback, outPos - lookback + width);
      pixelsWritten = width;
      outPos += width;
    } else if (rowMode <= 18) {
      lookback = width * (14 - rowMode);
      out.copyWithin(outPos, outPos - lookback, outPos - lookback + width);
      pixelsWritten = width;
      outPos += width;
    } else if (rowMode > 18) {
      throw new Error(`frame decode: bad row mode ${rowMode} (row ${row})`);
    }

    // the rest of the row is a sequence of runs, each with its own mode
    while (pixelsWritten < width) {
      const runMode = data[inPos] & 7;
      let count = data[inPos] >> 3;
      inPos++;
      if (!count) count = 32 + data[inPos++];

      switch (runMode) {
        case 2:
          // keep pixels from previous image
          break;
        case 3:
          // same tiling rule as mode 7 below; a row lookback is normally at
          // least `width` so this only bites on images narrower than a run
          if (lookback > 0 && lookback < count)
            for (let i = 0; i < count; i++) out[outPos + i] = out[outPos - lookback + i];
          else out.copyWithin(outPos, outPos - lookback, outPos - lookback + count);
          break;
        case 4:
          out.fill(out[outPos - 1], outPos, outPos + count);
          break;
        case 5:
          out.set(data.subarray(inPos, inPos + count), outPos);
          inPos += count;
          break;
        case 6:
          out.fill(data[inPos++], outPos, outPos + count);
          break;
        case 7: {
          const off = view.getUint16(inPos, le);
          inPos += 2;
          // A back-reference SHORTER than the run repeats what it just wrote —
          // LZ77-style, the way `rep movsb` copies. copyWithin is memmove: it
          // reads the source as it was before the write, so it duplicates the
          // block once instead of tiling it. Rare (4 runs in a whole DECKBD
          // walk) but each one poisons every later frame in the delta chain —
          // this was the coloured streaking in the boat deck's sky.
          if (off < count) for (let i = 0; i < count; i++) out[outPos + i] = out[outPos - off + i];
          else out.copyWithin(outPos, outPos - off, outPos - off + count);
          break;
        }
        default:
          // runModes 0/1: bit-packed deltas against a neighbouring pixel
          inPos = decodeBitPackedRun(data, inPos, out, outPos, count, runMode, lookback);
          break;
      }
      pixelsWritten += count;
      outPos += count;
    }
  }

  // Z layer follows if the container is not exhausted
  const hasZ = inPos < data.length;
  if (hasZ) decodeZLayer(data, view, inPos, height, fb.zPixels, le);

  return { width, height, hasZ, zOffset: hasZ ? inPos : -1 };
}

/**
 * Encode a per-pixel depth image into the Z layer {@link decodeZLayer} reads: a
 * u16 row-offset table (relative to the table's own start) followed by each row's
 * {count, level} runs, one byte each — so a run is capped at 255 pixels.
 *
 * The counterpart of the decoder, and the only way to *author* a depth image: the
 * editors replace a frame's art and carry the existing Z layer over verbatim
 * (`encodeFrame`'s `zBlock`), which is right for an edit but leaves a
 * newly-written set with no way to say what occludes an actor.
 */
export function encodeZLayer(levels: Uint8Array, width: number, height: number): Uint8Array {
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) {
    const runs: number[] = [];
    let x = 0;
    while (x < width) {
      let n = 1;
      const level = levels[y * width + x];
      while (n < Math.min(width - x, 255) && levels[y * width + x + n] === level) n++;
      runs.push(n, level);
      x += n;
    }
    rows.push([runs.length / 2, ...runs]);
  }
  const table = height * 2;
  const out = new Uint8Array(table + rows.reduce((n, r) => n + r.length, 0));
  const view = new DataView(out.buffer);
  let at = table;
  rows.forEach((r, y) => {
    view.setUint16(y * 2, at, true);
    out.set(r, at);
    at += r.length;
  });
  return out;
}

/**
 * Encode an indexed image back into the frame codec — the import path of the
 * set editor (editors/sets.html).
 *
 * Every row is written self-contained: the row mode is 5 (no row-level copy,
 * lookback = one row up) and the row's pixels are runs of copy-previous-row
 * (mode 3), fill (mode 6) and literal (mode 5). Nothing references "the
 * previous image", so the result decodes to the same pixels no matter what the
 * frame buffer held — which is what a hand-replaced frame in the middle of a
 * delta chain needs. It is bigger than CyberFlix's own encoding (which leans on
 * the predecessor it was authored against) but any valid run sequence decodes
 * the same.
 *
 * `zBlock` is a Z layer to append verbatim: pass the tail of the frame this one
 * replaces (from its {@link DecodedFrame.zOffset}) to keep the depth image that
 * occludes actors behind scenery. It is only valid at the SAME width/height,
 * since the Z runs are laid out against those.
 */
export function encodeFrame(
  pixels: Uint8Array,
  width: number,
  height: number,
  zBlock?: Uint8Array,
): Uint8Array {
  /** the count field is 5 bits, escaping to a second byte for 32..287 */
  const MAXRUN = 287;
  const out: number[] = [];
  const run = (mode: number, count: number): void => {
    if (count < 32) out.push((count << 3) | mode);
    else out.push(mode, count - 32);
  };

  for (let row = 0; row < height; row++) {
    const base = row * width;
    out.push(5 << 2); // row mode 5: write nothing, set the lookback one row up
    let x = 0;
    while (x < width) {
      const room = Math.min(width - x, MAXRUN);
      // how far the row above repeats here (unavailable on the first row)
      let copy = 0;
      if (row > 0) {
        while (copy < room && pixels[base + x + copy] === pixels[base - width + x + copy]) copy++;
      }
      let fill = 1;
      while (fill < room && pixels[base + x + fill] === pixels[base + x]) fill++;

      if (copy >= 2 && copy >= fill) {
        run(3, copy);
        x += copy;
      } else if (fill >= 3) {
        run(6, fill);
        out.push(pixels[base + x]);
        x += fill;
      } else {
        // literal: extend until one of the cheaper modes would pay off
        let n = 1;
        while (n < room) {
          const p = base + x + n;
          let c = 0;
          if (row > 0) {
            while (c < room - n && pixels[p + c] === pixels[p - width + c]) c++;
          }
          let f = 1;
          while (f < room - n && pixels[p + f] === pixels[p]) f++;
          if (c >= 2 || f >= 3) break;
          n++;
        }
        run(5, n);
        for (let i = 0; i < n; i++) out.push(pixels[base + x + i]);
        x += n;
      }
    }
  }

  const z = zBlock?.length ? zBlock : new Uint8Array(0);
  const bytes = new Uint8Array(4 + out.length + z.length);
  const view = new DataView(bytes.buffer);
  view.setInt16(0, height, true);
  view.setInt16(2, width, true);
  bytes.set(out, 4);
  bytes.set(z, 4 + out.length);
  return bytes;
}

/**
 * Run modes 0/1 — the trickiest part of the codec: each output pixel is a
 * delta against a neighbour, with the delta encoded in a variable number of
 * bits read from a 32-bit sliding window (top 16 bits "live").
 *
 * Mode 0 starts with one literal pixel and predicts from the pixel to the
 * LEFT (lookback 1); mode 1 predicts from `rowLookback` pixels back — the
 * row above/below per the row mode. Per pixel, the position of the highest
 * set bit selects: 0xf = plain copy of the predictor; < 0x8 = 8-bit literal
 * delta; otherwise a small ±delta whose magnitude is the bit position
 * distance and whose sign is the following bit.
 *
 * Returns the input position after the run (mutates `out` in place).
 */
function decodeBitPackedRun(
  data: Uint8Array,
  inPos: number,
  out: Uint8Array,
  outPos: number,
  count: number,
  runMode: number,
  rowLookback: number,
): number {
  let outCounter = 0;
  let lookback = 1;
  if (runMode === 0) out[outPos + outCounter++] = data[inPos++];
  else lookback = rowLookback;

  // 32-bit sliding bit window, top 16 bits are "live"
  let flags =
    ((data[inPos] << 24) |
      (data[inPos + 1] << 16) |
      (data[inPos + 2] << 8) |
      data[inPos + 3]) >>>
    0;
  inPos += 2;
  let flagBitPos = 16;
  for (; outCounter < count; outCounter++) {
    // position of the highest set bit within the top 16 bits
    let firstBitPos = 0;
    let bitCheck = 0x80000000;
    for (let i = 15; i >= 0; i--) {
      if (flags & bitCheck) {
        firstBitPos = i;
        break;
      }
      bitCheck >>>= 1;
    }

    if (firstBitPos === 0xf) {
      out[outPos + outCounter] = out[outPos + outCounter - lookback];
      flagBitPos--;
      flags = (flags << 1) >>> 0;
    } else if (firstBitPos < 0x8) {
      // literal: byte 2 of flags accumulates with neighbour pixel
      const b = ((flags >>> 16) & 0xff) + out[outPos + outCounter - lookback];
      out[outPos + outCounter] = b & 0xff;
      flagBitPos -= 16;
      flags = (flags << 16) >>> 0;
    } else {
      const difference = 15 - firstBitPos;
      if (flags & (1 << (firstBitPos + 15))) {
        out[outPos + outCounter] = (out[outPos + outCounter - lookback] + difference) & 0xff;
      } else {
        out[outPos + outCounter] = (out[outPos + outCounter - lookback] - difference) & 0xff;
      }
      flagBitPos -= difference + 2;
      flags = (flags << (difference + 2)) >>> 0;
    }

    if (flagBitPos < 0) {
      flags = flags >>> -flagBitPos;
      inPos += 2;
      flags = (flags | (data[inPos] << 8) | data[inPos + 1]) >>> 0;
      flags = (flags << -flagBitPos) >>> 0;
      flagBitPos += 16;
    }
  }
  if (flagBitPos >= 8) inPos--;
  return inPos;
}

/**
 * The per-pixel depth image trailing the colour data: a per-row offset table
 * into RLE runs of {count, depth-level} pairs. Fills `zOut` (width*height).
 */
function decodeZLayer(
  data: Uint8Array,
  view: DataView,
  tableStart: number,
  height: number,
  zOut: Uint8Array,
  le = true,
): void {
  let zPos = 0;
  for (let i = 0; i < height; i++) {
    const rowOff = view.getUint16(tableStart + i * 2, le);
    const runCount = data[tableStart + rowOff];
    for (let d = 0; d < runCount; d++) {
      const valCount = data[tableStart + rowOff + 1 + d * 2];
      zOut.fill(data[tableStart + rowOff + 2 + d * 2], zPos, zPos + valCount);
      zPos += valCount;
    }
  }
}

/**
 * Palette entries are {int16 index, int16 rgb[3]} where the usable 8-bit
 * channel value is the high byte of each int16 (DFfile.h ColorPalette use).
 * Returns a 256*4 RGBA table.
 *
 * "The high byte" is one of this function's two endianness questions: it sits at
 * +1 of each component on a PC rip and at +0 on a Macintosh one, which is 16
 * bits of precision nobody ever had a use for landing on the other side of the
 * pair. Read the wrong way a palette does not look subtly off — it comes out as
 * 256 near-black entries, because the low byte of a component whose high byte is
 * anything at all is noise.
 *
 * ## The other question: the two RESERVED entries, and whose they are
 *
 * On a PC rip index 0 is forced black and index 255 white — mirroring dfet's BMP
 * writer, and right for Titanic and Dust. It is worth knowing WHY it is right,
 * because the answer is a fact about Windows rather than about DreamFactory: a
 * palettised Windows display reserves the two ends of the system palette, black
 * at 0 and white at 255, and no application gets to use them. So the port has to
 * put them back whatever the file stores — and what the file stores is the other
 * way round. Every DF palette in every rip, PC and Mac alike, carries WHITE at
 * entry 0 and BLACK at entry 255, because DreamFactory was authored on a Mac and
 * that is the Macintosh system palette's reserved pair.
 *
 * Which means the Mac pressing of Skull Cracker needed no remap at all: its
 * reserved entries were the ones already in the file, and overriding them would
 * have been the PC's correction applied to a picture that never needed
 * correcting. The Windows pressing that replaced it is a PC release like the
 * rest, and does want the correction.
 *
 * The switch below is on the byte ORDER, which is a proxy for "whose build is
 * this" and not the thing itself — worth saying, because `byte-order.ts` is at
 * pains to point out that the order is a fact about the title rather than the
 * platform. It was sound for every disc this port has read: the little-endian
 * ones are the PC releases it renders, and the Macintosh Skull Cracker pressing
 * was not. Now that pressing is gone, every disc in the corpus takes the same
 * side of the switch — which makes the proxy right by default and exercised by
 * nothing, so treat it as untested rather than as confirmed. What it could not
 * distinguish either way is a MACINTOSH release shipping converted data —
 * Titanic's Dutch disc ships exactly such a build — where the data would want the
 * PC correction and the display would not. Nothing here renders one, and the day
 * something does, this wants a flag of its own rather than a cleverer proxy.
 *
 * ## Both Skull Cracker releases were read, and they prove the model
 *
 * The reasoning above was worked out from the Macintosh disc alone, one frame of
 * it load-bearing. The Windows release — the one that stayed, and the only Skull
 * Cracker disc this port reads now — settles it from outside, and the way it does
 * is better than agreement: **the conversion swapped the two indices in the PIXEL
 * DATA.** Over every film on each disc —
 *
 *   | disc    | index 0 | index 255 |
 *   |---------|---------|-----------|
 *   | Mac     |  0.14%  |  27.34%   |
 *   | Windows | 27.52%  |   0.14%   |
 *
 * — a mirror, because the authoring pipeline remapped 0 and 255 to land on
 * whichever end the target platform reserves. `Belfry.mov`'s flat frame is 100%
 * index 0 on the Mac disc and 100% index 255 on the Windows one, and under the
 * rules below both render WHITE: the lightning flash that a single frame's worth
 * of inference had called, confirmed by a disc that was not consulted to make the
 * call. The menu's first frame decodes pixel-for-pixel identically from the two
 * files — 0 differences over 196608 pixels, from files of 1.74 MB and 1.08 MB
 * whose every integer runs the other way.
 *
 * Measured on the MAC pressing's 66 films — 18,725 frames, 1.83 billion pixels.
 * Read the two indices exchanged for the Windows disc, per the table above: what
 * is said of 255 here is true of 0 there, and the palette correction on that side
 * lands each of them on the same colour anyway, which is the point of the table.
 *
 *   - index 255 is **27.34%** of every pixel in the game and appears in 15,879
 *     of those frames. It is the ground the whole game is drawn on: forcing it
 *     to white turns a black chapter card into a white one and puts a white
 *     halo around every object in the menu.
 *   - index 0 is **0.14%**, and one frame in the entire rip is substantially
 *     made of it — `Belfry.mov` frame 100, which is 100% index 0 and sits
 *     between two frames of night sky. A single full-screen frame in the middle
 *     of a storm is a lightning flash, so that entry is white, which is what the
 *     file says it is.
 */
export function paletteToRGBA(
  paletteRaw: Uint8Array,
  colorCount: number,
  order: ByteOrder = PC,
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(256 * 4);
  const pc = little(order);
  /** where the high byte of a component sits, relative to the component */
  const hi = pc ? 1 : 0;
  for (let i = 0; i < colorCount; i++) {
    const base = i * 8; // int16 index + 3 * int16 rgb
    rgba[i * 4 + 0] = paletteRaw[base + 2 + hi]; // high byte of RGB[0]
    rgba[i * 4 + 1] = paletteRaw[base + 4 + hi];
    rgba[i * 4 + 2] = paletteRaw[base + 6 + hi];
    rgba[i * 4 + 3] = 255;
  }
  rgba[3] = 255;
  if (pc) {
    rgba[0] = rgba[1] = rgba[2] = 0;
    if (colorCount === 256) {
      rgba[255 * 4] = rgba[255 * 4 + 1] = rgba[255 * 4 + 2] = 255;
    }
  }
  return rgba;
}

/**
 * A palette packed as 256 machine-order RGBA words, so colorizing is one store
 * per pixel instead of four. The bytes are written through a byte view of the
 * same buffer, which is what makes the word order right on either endianness:
 * whatever order this machine reads a u32 in is the order it wrote it in.
 */
const PALETTE_WORDS = new Uint32Array(256);
const PALETTE_BYTES = new Uint8Array(PALETTE_WORDS.buffer);

/**
 * Colorize an indexed frame into an RGBA pixel buffer (e.g. for ImageData).
 *
 * This is the single hottest function in the client — every frame expands the
 * stage flat, the set view, or the movie image through it, which at 512×384 is
 * ~200k pixels, 60 times a second. So it writes one 32-bit word per pixel
 * rather than four clamped bytes (~2.7x, measured), which costs a 256-entry
 * palette table per call — a rounding error against the pixels.
 *
 * `out`, when given, must start at the beginning of its buffer: it is viewed as
 * u32, so a byte-misaligned subarray would throw. Every caller passes an
 * ImageData's `data` or a whole freshly allocated array, both of which do.
 */
export function indexedToRGBA(
  indexed: Uint8Array,
  width: number,
  height: number,
  paletteRGBA: Uint8ClampedArray,
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const n = width * height;
  const dst = out ?? new Uint8ClampedArray(n * 4);
  for (let i = 0; i < 256 * 4; i += 4) {
    PALETTE_BYTES[i] = paletteRGBA[i];
    PALETTE_BYTES[i + 1] = paletteRGBA[i + 1];
    PALETTE_BYTES[i + 2] = paletteRGBA[i + 2];
    PALETTE_BYTES[i + 3] = 255;
  }
  const words = new Uint32Array(dst.buffer, dst.byteOffset, n);
  for (let i = 0; i < n; i++) words[i] = PALETTE_WORDS[indexed[i]];
  return dst;
}
