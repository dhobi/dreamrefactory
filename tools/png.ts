import { deflateSync, inflateSync } from "node:zlib";

/** Minimal PNG encoder (RGBA, 8-bit) for the verification tooling. */
export function encodePNG(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const chunks = [
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ];
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

let table: Uint32Array | undefined;
function crc32(buf: Buffer): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface DecodedPNG {
  rgba: Uint8Array;
  width: number;
  height: number;
}

/**
 * Minimal PNG decoder — the read half of {@link encodePNG}, and enough of the
 * format for the assets this repo actually keeps: 8 bits a channel, colour
 * types 0/2/4/6 (grey, RGB, and either with alpha). Interlaced files and 16-bit
 * samples are refused rather than half-read, and a palette image (type 3) is
 * not needed here — the only PNG a tool reads is public/globe.png.
 *
 * The filters are the whole of it. Each scanline is prefixed by one of five
 * predictors over the byte to its left (`a`) and the byte above (`b`), so the
 * pass has to run in order and in place.
 */
export function decodePNG(bytes: Uint8Array): DecodedPNG {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, depth = 0, colorType = 0;
  const idat: Uint8Array[] = [];
  for (let o = 8; o + 8 <= bytes.length; ) {
    const len = v.getUint32(o);
    const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
    const data = bytes.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      width = v.getUint32(o + 8);
      height = v.getUint32(o + 12);
      depth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  if (depth !== 8) throw new Error(`PNG bit depth ${depth}, expected 8`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType as 0 | 2 | 4 | 6];
  if (!channels) throw new Error(`PNG colour type ${colorType} not supported`);

  const raw = new Uint8Array(inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c)))));
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      let x = line[i];
      switch (filter) {
        case 1: x += a; break;
        case 2: x += b; break;
        case 3: x += (a + b) >> 1; break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          x += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
      }
      cur[i] = x & 0xff;
    }
  }
  // widen whatever came out to RGBA, so callers see one shape
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const s = i * channels;
    const grey = channels <= 2;
    rgba[i * 4] = grey ? out[s] : out[s];
    rgba[i * 4 + 1] = grey ? out[s] : out[s + 1];
    rgba[i * 4 + 2] = grey ? out[s] : out[s + 2];
    rgba[i * 4 + 3] = channels === 2 ? out[s + 1] : channels === 4 ? out[s + 3] : 255;
  }
  return { rgba, width, height };
}
