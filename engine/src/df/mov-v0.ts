import { DFContainerFile, readContainerFile } from "./container";

/**
 * DreamFactory 0's films — *Lunicus* (1994), the generation before Dust
 * ({@link file://./version.ts} says why "v0" and why it is never detected).
 *
 * A v0 film is Dust's film ({@link file://./mov-v1.ts}) with less in front of
 * it: the same header fields in the same order, the same 8-byte palette
 * entries, the same 80-byte frame records and the same typed hotspot records —
 * but container 0 opens straight on the frame count, where v1 has 0x18 bytes
 * (the version tag among them) before it. The palette and the frame table sit
 * earlier again, 0x1c and 0x20 bytes ahead of v1's:
 *
 *   0x00  i16  frame count                    (v1 0x18)
 *   0x02  i16  sound-bank count               (v1 0x1a)
 *   0x06  i16 ×4  the film's rect on the 512x384 screen: top, left, bottom,
 *               right (v1 0x1e). The film player (LUNICUS.EXE 0x40e26a) draws
 *               the film there; every film in the rip has its top-left at 0,0,
 *               so the bottom and right are its height and width
 *   0x0e  i16  frame-rate floor, in ticks of 50/3 ms   (v1 0x26)
 *   0x22  256 × {i16 index, u16 red, green, blue}      (v1 0x3e)
 *   0x8a2 the frame records, 80 bytes each    (v1 0x8c2)
 *
 * Measured, not yet read out of LUNICUS.EXE's movie loop: all 12,759 frames of
 * the rip's films decode through `decodeFrame` at their header's size, and every
 * frame sound outside `previews/` (which holds other games' demos) lands on a
 * {@link file://./audio.ts} `decodeAudioV0` sound.
 *
 * ## The palette is the Macintosh way round
 *
 * Entry 0 is white and entry 255 black. The PC games' {@link paletteToRGBA}
 * forces the opposite (Windows reserves 0 as black and 255 as white), so it must
 * not be used here: {@link paletteV0} reads every entry as stored.
 *
 * ## A frame
 *
 *   +0x00  i16  hotspot count, at +0x24
 *   +0x02  i32  hold, in ticks; the header's rate is the floor
 *   +0x16  i16  action: 1 exit · 2 goto `target` · 3 exit and chain to the film
 *               named at +0x30 · 6 seen on five frames, all with +0x1a bit 4
 *   +0x18  i16  target, a 0-BASED frame
 *   +0x1a  i16  flags: bit 2 play through the hotspots rather than wait for a
 *               click · bit 4 step to the next frame whatever the action says
 *               (never set in Dust; set here on exactly the action-6 frames)
 *   +0x1c  i16  picture container
 *   +0x20  i32  sound started with the frame, container |ref|, 0 = none
 *   +0x24  i32  where the frame's hotspots start in container 0 (Dust reads an
 *               i16 here; the long briefings' headers pass 64 KB, and read as
 *               16 bits their offsets wrap)
 *   +0x30  pstr the film a chain goes to (`flip.move` — the game's own names end
 *               in `.move`, the files in `.mov`)
 *
 * A hotspot is Dust's typed record: {i16 type, i16 top, left, bottom, right,
 * i16 sound, …}, 14 bytes for types 1 and 5, 16 for 2 (with a 0-based target at
 * +0x0e), 46 for 3 and 48 for 4 — and a type Dust never has, -1, in the 14-byte
 * shape: LUNICUS.EXE's player negates a negative type (0x40eb01) and tracks the
 * press before it acts, so −1 is an exit drawn as a button — the elevators'
 * floor buttons, whose index the player hands the level. The intro's frames each carry one full-screen
 * type-1 box and play through it: a click anywhere skips the film.
 */

export interface MovHotspotV0 {
  type: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  sound: number;
  /** a type-2 hotspot's frame, 0-based; -1 otherwise */
  target: number;
}

export interface MovFrameV0 {
  picture: number;
  holdTicks: number;
  action: number;
  target: number;
  flags: number;
  /** a container, 0 = none */
  sound: number;
  chainTo: string;
  /** how many hotspots the record says it owns; {@link hotspots} reads them all */
  hotspotCount: number;
  hotspots: MovHotspotV0[];
}

export interface MovFileV0 {
  file: DFContainerFile;
  /** where on the screen the film sits (its rect's top-left) */
  top: number;
  left: number;
  width: number;
  height: number;
  framerate: number;
  /** the stored 256 × 8 bytes */
  paletteRaw: Uint8Array;
  frames: MovFrameV0[];
}

const PALETTE_AT = 0x22;
const PALETTE_BYTES = 256 * 8;
const FRAMES_AT = 0x8a2;
const FRAME_BYTES = 80;
const HOTSPOT_BYTES: Record<number, number> = { [-1]: 14, 1: 14, 2: 16, 3: 46, 4: 48, 5: 14 };

/** frame flags */
export const FLAG_PLAY_THROUGH = 4;
export const FLAG_STEP = 0x10;
/** one tick of a hold, in milliseconds */
export const TICK_MS = 50 / 3;

export function readMovFileV0(data: Uint8Array): MovFileV0 {
  const file = readContainerFile(data);
  const c0 = file.containers[0].data;
  const v = new DataView(c0.buffer, c0.byteOffset, c0.byteLength);
  const count = v.getInt16(0, true);
  if (count < 0 || FRAMES_AT + count * FRAME_BYTES > c0.length) {
    throw new Error(`v0 film: ${count} frames do not fit a ${c0.length}-byte header`);
  }
  const frames = Array.from({ length: count }, (_, i): MovFrameV0 => {
    const r = FRAMES_AT + i * FRAME_BYTES;
    const hotspots: MovHotspotV0[] = [];
    for (let k = 0, p = v.getInt32(r + 0x24, true); k < v.getInt16(r, true); k++) {
      if (p < 0 || p + 2 > c0.length) break;
      const type = v.getInt16(p, true);
      const size = HOTSPOT_BYTES[type];
      if (!size || p + size > c0.length) break;
      hotspots.push({
        type,
        top: v.getInt16(p + 2, true),
        left: v.getInt16(p + 4, true),
        bottom: v.getInt16(p + 6, true),
        right: v.getInt16(p + 8, true),
        sound: v.getInt16(p + 0xa, true),
        target: type === 2 ? v.getInt16(p + 0xe, true) : -1,
      });
      p += size;
    }
    const chainLen = Math.min(c0[r + 0x30], FRAME_BYTES - 0x31);
    return {
      picture: v.getInt16(r + 0x1c, true),
      holdTicks: v.getInt32(r + 2, true),
      action: v.getInt16(r + 0x16, true),
      target: v.getInt16(r + 0x18, true),
      flags: v.getInt16(r + 0x1a, true),
      sound: Math.abs(v.getInt32(r + 0x20, true)),
      chainTo: String.fromCharCode(...c0.subarray(r + 0x31, r + 0x31 + chainLen)),
      hotspotCount: Math.max(v.getInt16(r, true), 0),
      hotspots,
    };
  });
  return {
    file,
    top: v.getInt16(6, true),
    left: v.getInt16(8, true),
    height: v.getInt16(0xa, true) - v.getInt16(6, true),
    width: v.getInt16(0xc, true) - v.getInt16(8, true),
    framerate: v.getInt16(0xe, true),
    paletteRaw: c0.slice(PALETTE_AT, PALETTE_AT + PALETTE_BYTES),
    frames,
  };
}

/** the palette as RGBA, every entry as stored (see the module comment) */
export function paletteV0(paletteRaw: Uint8Array): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    rgba[i * 4] = paletteRaw[i * 8 + 3];
    rgba[i * 4 + 1] = paletteRaw[i * 8 + 5];
    rgba[i * 4 + 2] = paletteRaw[i * 8 + 7];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/**
 * Which frame follows `index` when it has run its course with no click: the
 * step bit, then the action. -1 when the film ends here (an exit, or a chain —
 * the caller reads {@link MovFrameV0.chainTo}).
 */
export function nextFrameV0(film: MovFileV0, index: number): number {
  const f = film.frames[index];
  if (f.flags & FLAG_STEP) return index + 1 < film.frames.length ? index + 1 : -1;
  if (f.action === 2) return Math.min(Math.max(f.target, 0), film.frames.length - 1);
  return -1;
}
