import { Container } from "./container";

/**
 * Frame decompression for SET/MOV-style image containers.
 * Port of DFfile::getRawImageData (dfet/libs/DFfile/DFfile.cpp).
 *
 * Frames are delta-encoded: several row params / run modes copy pixels
 * from "the previous image", i.e. whatever the target buffer already
 * contains. Callers must therefore decode frame sequences in order into
 * the same persistent FrameBuffer.
 */
export interface DecodedFrame {
  width: number;
  height: number;
  hasZ: boolean;
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

export function decodeFrame(container: Container, fb: FrameBuffer): DecodedFrame {
  const data = container.data;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const height = view.getInt16(0, true);
  const width = view.getInt16(2, true);
  fb.ensure(width, height);
  const out = fb.pixels;

  let inPos = 4;
  let outPos = 0;
  let lookUpOffset = 0;

  for (let row = 0; row < height; row++) {
    let currWidth = 0;
    const param = data[inPos++] >> 2;

    if (param === 1) {
      out.set(data.subarray(inPos, inPos + width), outPos);
      currWidth = width;
      outPos += width;
      inPos += width;
    }
    if (param <= 5) {
      lookUpOffset = width * (6 - param);
    } else if (param <= 9) {
      lookUpOffset = width * (5 - param);
    } else if (param === 10) {
      // keep row from previous image
      currWidth = width;
      outPos += width;
    } else if (param <= 14) {
      lookUpOffset = width * (15 - param);
      out.copyWithin(outPos, outPos - lookUpOffset, outPos - lookUpOffset + width);
      currWidth = width;
      outPos += width;
    } else if (param <= 18) {
      lookUpOffset = width * (14 - param);
      out.copyWithin(outPos, outPos - lookUpOffset, outPos - lookUpOffset + width);
      currWidth = width;
      outPos += width;
    } else if (param > 18) {
      throw new Error(`frame decode: bad row param ${param} (row ${row})`);
    }

    while (currWidth < width) {
      const modeSel = data[inPos] & 7;
      let count = data[inPos] >> 3;
      inPos++;
      if (!count) count = 32 + data[inPos++];

      switch (modeSel) {
        case 2:
          // keep pixels from previous image
          break;
        case 3:
          out.copyWithin(outPos, outPos - lookUpOffset, outPos - lookUpOffset + count);
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
          const off = view.getUint16(inPos, true);
          inPos += 2;
          out.copyWithin(outPos, outPos - off, outPos - off + count);
          break;
        }
        default: {
          // modes 0/1: bit-packed deltas against the neighbouring pixel
          let outCounter = 0;
          let lookUpOffsetSingle = 1;
          if (modeSel === 0) out[outPos + outCounter++] = data[inPos++];
          else lookUpOffsetSingle = lookUpOffset;

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
              out[outPos + outCounter] = out[outPos + outCounter - lookUpOffsetSingle];
              flagBitPos--;
              flags = (flags << 1) >>> 0;
            } else if (firstBitPos < 0x8) {
              // literal: byte 2 of flags accumulates with neighbour pixel
              const b = ((flags >>> 16) & 0xff) + out[outPos + outCounter - lookUpOffsetSingle];
              out[outPos + outCounter] = b & 0xff;
              flagBitPos -= 16;
              flags = (flags << 16) >>> 0;
            } else {
              const difference = 15 - firstBitPos;
              if (flags & (1 << (firstBitPos + 15))) {
                out[outPos + outCounter] =
                  (out[outPos + outCounter - lookUpOffsetSingle] + difference) & 0xff;
              } else {
                out[outPos + outCounter] =
                  (out[outPos + outCounter - lookUpOffsetSingle] - difference) & 0xff;
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
          break;
        }
      }
      currWidth += count;
      outPos += count;
    }
  }

  // Z layer follows if the container is not exhausted
  let hasZ = false;
  if (inPos < data.length) {
    hasZ = true;
    const tableStart = inPos;
    const zOut = fb.zPixels;
    let zPos = 0;
    for (let i = 0; i < height; i++) {
      const rowOff = view.getUint16(tableStart + i * 2, true);
      const runCount = data[tableStart + rowOff];
      for (let d = 0; d < runCount; d++) {
        const valCount = data[tableStart + rowOff + 1 + d * 2];
        zOut.fill(data[tableStart + rowOff + 2 + d * 2], zPos, zPos + valCount);
        zPos += valCount;
      }
    }
  }

  return { width, height, hasZ };
}

/**
 * Palette entries are {int16 index, int16 rgb[3]} where the usable 8-bit
 * channel value is the high byte of each int16 (DFfile.h ColorPalette use).
 * Returns a 256*4 RGBA table. Index 0 is forced black and, when all 256
 * colors are used, index 255 is forced white — mirroring dfet's BMP writer.
 */
export function paletteToRGBA(paletteRaw: Uint8Array, colorCount: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < colorCount; i++) {
    const base = i * 8; // int16 index + 3 * int16 rgb
    rgba[i * 4 + 0] = paletteRaw[base + 3]; // high byte of RGB[0]
    rgba[i * 4 + 1] = paletteRaw[base + 5];
    rgba[i * 4 + 2] = paletteRaw[base + 7];
    rgba[i * 4 + 3] = 255;
  }
  rgba[0] = rgba[1] = rgba[2] = 0;
  rgba[3] = 255;
  if (colorCount === 256) {
    rgba[255 * 4] = rgba[255 * 4 + 1] = rgba[255 * 4 + 2] = 255;
  }
  return rgba;
}

/** Colorize an indexed frame into an RGBA pixel buffer (e.g. for ImageData). */
export function indexedToRGBA(
  indexed: Uint8Array,
  width: number,
  height: number,
  paletteRGBA: Uint8ClampedArray,
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const n = width * height;
  const dst = out ?? new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const p = indexed[i] * 4;
    dst[i * 4 + 0] = paletteRGBA[p];
    dst[i * 4 + 1] = paletteRGBA[p + 1];
    dst[i * 4 + 2] = paletteRGBA[p + 2];
    dst[i * 4 + 3] = 255;
  }
  return dst;
}
