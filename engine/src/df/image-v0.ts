/**
 * DreamFactory 0's pictures — *Lunicus* (1994), the generation before Dust.
 *
 * "v0" is this port's name, not Cyberflix's: the file envelope still says 1.0
 * (see {@link file://./version.ts}), and it is the per-container version tag v1
 * introduced that Lunicus does not have. Nothing here is detected from the
 * bytes; a caller knows it has a Lunicus file because it is loading Lunicus.
 *
 * ## The frame
 *
 * Every picture that is not a film or a maze view — the vehicles, the hand, the
 * control panel, a talking head's frames and the backdrop they are drawn over —
 * is one container in the same layout, drawn by LUNICUS.EXE 0x404ab8:
 *
 *   0x00  i16  height, i16 width
 *   0x04  i16  anchor y, i16 anchor x — the point of the picture that lands on
 *              the position it is drawn at (top = y − anchorY, left = x − anchorX;
 *              drawn mirrored, the anchor is taken from the right, width − anchorX)
 *   0x08       one row after another, each an i16 byte length and its runs
 *
 * The runs are read at 0x404c88, a flag byte each, the kind in the low two bits
 * and the count in the other six:
 *
 *   x1  skip `count` pixels (transparent)
 *   11  `count` literal pixels follow
 *   10  one byte follows, repeated `count` times
 *   00  one byte follows, an OFFSET: copy `count` bytes from that far back in the
 *       compressed stream (from the position after the offset byte)
 *
 * The first three are Dust's transparent codec exactly
 * ({@link file://./shp.ts}'s `decodeShpFrame`). The fourth is where the two part:
 * Dust's kind 00 copies from the row above, and reads no offset. A frame that
 * never uses kind 00 — the vehicle sprites, as it happens — decodes the same
 * through either, which is how Dust's reader first appeared to fit them.
 *
 * 0x404d2b is the same loop drawing right to left, for a mirrored picture.
 * Mirroring is a matter of drawing; this reader returns the stored orientation.
 */

/** a decoded v0 picture: palette indexes and which of them are drawn */
export interface FrameV0 {
  width: number;
  height: number;
  anchorY: number;
  anchorX: number;
  /** palette indexes, width*height */
  indexed: Uint8Array;
  /** 1 = drawn, 0 = transparent, width*height */
  opaque: Uint8Array;
}

const HEADER = 8;

/**
 * One run of a row: its pixel count from the flag byte, and what it draws at
 * `at` from the bytes at `p` — returning where the next flag is.
 */
interface RunCodec {
  count(flag: number): number;
  draw(data: Uint8Array, flag: number, p: number, at: number, count: number, f: FrameV0): number;
}

/**
 * The container both v0 codecs share: an eight-byte header (height, width, the
 * anchor), then each row as its byte length and its runs, which must come to
 * the width exactly and end on the row's last byte.
 */
function decodeV0(data: Uint8Array, what: string, codec: RunCodec): FrameV0 {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < HEADER) throw new Error(`${what}: ${data.length} bytes is no header`);
  const height = view.getInt16(0, true);
  const width = view.getInt16(2, true);
  const anchorY = view.getInt16(4, true);
  const anchorX = view.getInt16(6, true);
  if (height <= 0 || width <= 0) throw new Error(`${what}: ${width}x${height}`);

  const f: FrameV0 = {
    width,
    height,
    anchorY,
    anchorX,
    indexed: new Uint8Array(width * height),
    opaque: new Uint8Array(width * height),
  };
  let p = HEADER;
  for (let row = 0; row < height; row++) {
    if (p + 2 > data.length) throw new Error(`${what}: ends before row ${row}`);
    const end = p + 2 + view.getInt16(p, true);
    p += 2;
    if (end > data.length) throw new Error(`${what}: row ${row} runs past the container`);
    const base = row * width;
    let x = 0;
    while (p < end) {
      const flag = data[p++];
      const count = codec.count(flag);
      if (x + count > width) throw new Error(`${what}: row ${row} overruns its width`);
      p = codec.draw(data, flag, p, base + x, count, f);
      x += count;
    }
    if (p !== end || x !== width) throw new Error(`${what}: row ${row} is ${x} of ${width} pixels`);
  }
  if (p !== data.length) throw new Error(`${what}: ${data.length - p} bytes after the last row`);
  return f;
}

/** two kind bits and a six-bit count: skip, literal, repeat, or a copy from earlier in the stream */
const FRAME_RUNS: RunCodec = {
  count: (flag) => flag >> 2,
  draw(data, flag, p, at, count, { indexed, opaque }) {
    switch (flag & 3) {
      case 1: // skip
        return p;
      case 3: // literal
        indexed.set(data.subarray(p, p + count), at);
        opaque.fill(1, at, at + count);
        return p + count;
      case 2: // repeat
        indexed.fill(data[p], at, at + count);
        opaque.fill(1, at, at + count);
        return p + 1;
      default: {
        // back-reference into the compressed stream
        const from = p + 1 - data[p];
        indexed.set(data.subarray(from, from + count), at);
        opaque.fill(1, at, at + count);
        return p + 1;
      }
    }
  },
};

/** one kind bit and a seven-bit count: literal pixels, or a skip */
const FIGURE_RUNS: RunCodec = {
  count: (flag) => flag >> 1,
  draw(data, flag, p, at, count, { indexed, opaque }) {
    if (!(flag & 1)) return p;
    indexed.set(data.subarray(p, p + count), at);
    opaque.fill(1, at, at + count);
    return p + count;
  },
};

/**
 * Decode one v0 picture container.
 *
 * Strict where the original is forgiving: LUNICUS.EXE clips every run against
 * the screen and would draw a malformed row without complaint, so a row whose
 * runs do not come to exactly the width — or a container with bytes left over —
 * throws here, because that is a misread and not a picture.
 */
export function decodeFrameV0(data: Uint8Array): FrameV0 {
  return decodeV0(data, "v0 frame", FRAME_RUNS);
}

/**
 * The second v0 run codec: the sixteen-frame figure files in `shared/`
 * (`raife.`, `sasha.`, `guard.` …, one per character).
 *
 * Same header and row lengths as {@link decodeFrameV0}, but ONE kind bit and a
 * seven-bit count: an odd flag is `flag >> 1` literal pixels, an even one skips
 * `flag >> 1`. Fitted to the data (every row of every frame lands on its width
 * and every container ends on its last row), NOT yet read out of the engine —
 * its decoder is not the 0x404c88 loop, and where it is has not been found; the
 * 16-bit LUNIFX.DLL is the next place to look. The figures are the crew as the
 * maze view draws them: sixteen headings of a character, frame 0 from behind
 * and 8 from the front (LUNICUS.EXE 0x416514; `lunicus/src/game/crew.ts`).
 */
export function decodeFigureV0(data: Uint8Array): FrameV0 {
  return decodeV0(data, "v0 figure", FIGURE_RUNS);
}
