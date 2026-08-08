/**
 * Building a MOV movie from nothing — the write side of [`mov.ts`](mov.ts)'s
 * reader. See [`build.ts`](build.ts) for why these modules exist.
 *
 * A MOV is not a video file, it is a **state machine of frames**: each frame
 * carries a picture, an action code ({@link MOV_ACTIONS}) and up to three names
 * (a sound, a movie to chain to, a frame to jump to), plus click regions that
 * carry their own action and names. The interactive cutscenes — the purser's
 * window, the menu — are that machine, not a linear playback.
 *
 * Two things this builder deliberately does NOT do:
 *
 *  - **Frame art that holds the picture before it.** CyberFlix's encoder emits
 *    row mode 10, "keep this row from the previous image", for the parts of a
 *    frame that did not change; `encodeFrame` never does — every row it writes
 *    stands alone. Pass `hold: true` for a frame that should carry
 *    {@link holdFrameArt} instead of a picture of its own.
 *  - **Sound.** The audio location in container 0 is left 0; a movie's
 *    soundtrack is a bank (see banks-build.ts), which this does not place.
 */
import { ContainerBuilder, i16, i32, paletteBlock, pstr } from "./build";
import { ContainerRef, DFContainerFile, writeContainerFile } from "./container";
import { encodeFrame } from "./image";
import { FLAG_KEY_SKIPS, MOV_NAME_FIELD } from "./mov";

/** a segment's header container (container 0 for the first): the header, the
 *  palette, and the frame table. Locations inside are relative to it. */
const C0 = {
  version: 0x02,
  flags: 0x18,
  /** i32 the segment's frame-rate FLOOR, in ticks — see {@link MovBuildSegment.minHoldTicks} */
  minHold: 0x1c,
  actionFrame1: 0x40,
  actionFrame2: 0x50,
  /** i32 container index of the NEXT segment's header, 0 = last */
  nextSegment: 0x2c,
  palette: 0x6c,
  height: 0x870,
  width: 0x872,
  frameCount: 0x878,
  frames: 0x87c,
  frameSize: 42,
} as const;

/** one 42-byte frame record */
const FRAME = { height: 8, width: 10, art: 12, clickRegion: 16, name: 26 } as const;

/** a frame's logic container */
const LOGIC = { type: 0, hold: 2, flags: 6, sound: 0x12, event: 0x22, target: 0x32, regionCount: 1090, regions: 1094, regionSize: 64 } as const;

/** one 64-byte region record (coordinates Y-first, as everywhere) */
const REGION = { type: 0, top: 8, sound: 16, event: 32, target: 48 } as const;

/** the version tag `readMovFile` insists on */
const VERSION_4 = 4;

/**
 * Frame art that repeats the previous image row for row — `height` rows of row
 * mode 10. The one thing the frame encoder cannot express, and the reason the
 * movie editor offers no art replacement: swapping the frame *under* one of these
 * changes what it decodes to.
 */
export function holdFrameArt(width: number, height: number): Uint8Array {
  const d = new Uint8Array(4 + height);
  i16(d, 0, height);
  i16(d, 2, width);
  d.fill(10 << 2, 4);
  return d;
}

/** the action + names a frame or a region carries */
export interface MovAction {
  /** an action code from {@link MOV_ACTIONS} */
  type: number;
  /** an event sound (page rustles, a faucet) */
  sound?: string;
  /** the movie chained to, for the actions that chain (types 3/4) */
  event?: string;
  /** the frame jumped to, for the actions that jump (types 2/4) */
  target?: string;
}

export interface MovBuildRegion extends MovAction {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface MovBuildFrame extends Partial<MovAction> {
  /** the frame's name — what a jump's `target` says (≤15 chars) */
  name: string;
  /**
   * How long to hold this frame, in ticks of 50/3 ms. The segment's
   * {@link MovBuildSegment.minHoldTicks} is a FLOOR under it, so a frame can be
   * authored longer than the film's rate but never shorter — which is why a film
   * whose frames are all the same length wants the floor and no holds at all.
   *
   * Needs a logic container to live in, so it cannot be combined with
   * {@link noLogic}.
   */
  holdTicks?: number;
  /** per-frame flag bits (0 wait for the spoken line · 3 don't reset the frame
   *  deadline) — see MovFrame.waitsForVoice / holdsDeadline */
  flags?: number;
  /** the picture, unless `hold` */
  art?: Uint8Array;
  /** carry no picture: hold the previous frame's (see {@link holdFrameArt}) */
  hold?: boolean;
  regions?: MovBuildRegion[];
  /**
   * A plain animation frame — no logic container at all, which is what most
   * frames of a linear cutscene are. The reader reports the frame with no action.
   */
  noLogic?: boolean;
}

/** one segment of a movie — its own header, palette, frames and slots */
export interface MovBuildSegment {
  /** the colour table, as RGB triples (up to 256 entries) */
  palette: ArrayLike<number>;
  /** every frame is this size, and the header says so once */
  width: number;
  height: number;
  frames: MovBuildFrame[];
  /** the two action-frame slots the boot's `actionframe(n)` reads back */
  actionFrames?: [string, string];
  /**
   * The segment's frame-rate FLOOR, in ticks of 50/3 ms (60 a second) — 2, 3 or
   * 4 across the shipped corpus (30, 20 and 15 fps). Left 0 and with no per-frame
   * {@link MovBuildFrame.hold} either, every frame's deadline is zero and the film
   * plays as fast as the host ticks, which is never what an author means.
   */
  minHoldTicks?: number;
  /** ESC (and Ctrl+Q) aborts this movie */
  keySkips?: boolean;
}

export interface MovBuildOptions extends MovBuildSegment {
  /** dummy gap containers, as the shipped movies carry */
  gaps?: number;
  /**
   * Segments AFTER the first — a movie is a chain of them, played back to back
   * (see src/df/mov.ts). Each gets its own header container, and the previous
   * header's +0x2c points at it; every location a segment stores is relative to
   * its own header, which is what a reader (and a patch) has to get right.
   */
  segments?: MovBuildSegment[];
}

export interface MovBuildResult {
  file: DFContainerFile;
  /** where each frame's art landed, in frame order — the FIRST segment's */
  artLocs: ContainerRef[];
  /** each segment's header container index, in play order (`[0, …]`) */
  segmentLocs: number[];
}

/** a frame's logic container: its action, its three names, its region table */
function logicBlock(frame: MovBuildFrame): Uint8Array {
  const regions = frame.regions ?? [];
  const d = new Uint8Array(LOGIC.regions + regions.length * LOGIC.regionSize);
  i16(d, LOGIC.type, frame.type ?? 0);
  i32(d, LOGIC.hold, frame.holdTicks ?? 0);
  d[LOGIC.flags] = frame.flags ?? 0;
  pstr(d, LOGIC.sound, frame.sound ?? "", MOV_NAME_FIELD);
  pstr(d, LOGIC.event, frame.event ?? "", MOV_NAME_FIELD);
  pstr(d, LOGIC.target, frame.target ?? "", MOV_NAME_FIELD);
  i32(d, LOGIC.regionCount, regions.length);
  regions.forEach((r, i) => {
    const at = LOGIC.regions + i * LOGIC.regionSize;
    i16(d, at + REGION.type, r.type);
    i16(d, at + REGION.top, r.top);
    i16(d, at + REGION.top + 2, r.left);
    i16(d, at + REGION.top + 4, r.bottom);
    i16(d, at + REGION.top + 6, r.right);
    pstr(d, at + REGION.sound, r.sound ?? "", MOV_NAME_FIELD);
    pstr(d, at + REGION.event, r.event ?? "", MOV_NAME_FIELD);
    pstr(d, at + REGION.target, r.target ?? "", MOV_NAME_FIELD);
  });
  return d;
}

/** Reserve a segment's header container and write everything in it that does
 *  not depend on where its frames land. */
function reserveHeader(b: ContainerBuilder, seg: MovBuildSegment): Uint8Array {
  if (!seg.frames.length) throw new Error("mov: a segment needs at least one frame");
  const { data: header } = b.reserve(C0.frames + seg.frames.length * C0.frameSize);
  i32(header, C0.version, VERSION_4);
  if (seg.keySkips) i32(header, C0.flags, FLAG_KEY_SKIPS);
  i32(header, C0.minHold, seg.minHoldTicks ?? 0);
  const [action1, action2] = seg.actionFrames ?? ["", ""];
  pstr(header, C0.actionFrame1, action1, MOV_NAME_FIELD);
  pstr(header, C0.actionFrame2, action2, MOV_NAME_FIELD);
  header.set(paletteBlock(seg.palette), C0.palette);
  i16(header, C0.height, seg.height);
  i16(header, C0.width, seg.width);
  i32(header, C0.frameCount, seg.frames.length);
  return header;
}

/**
 * Add a segment's frame containers (art, then logic) and fill in its frame
 * table. Locations are stored RELATIVE to the segment's own header container
 * (`bias`) — that is what makes a segment relocatable, and what a reader adds
 * back to get an absolute index.
 */
function writeFrames(
  b: ContainerBuilder,
  seg: MovBuildSegment,
  header: Uint8Array,
  bias: number,
): ContainerRef[] {
  const { width, height } = seg;
  return seg.frames.map((frame, i) => {
    if (!frame.hold && !frame.art) throw new Error(`mov: frame "${frame.name}" has no art`);
    // the hold lives in the logic container, so asking for both is asking for a
    // frame whose authored duration is written nowhere
    if (frame.noLogic && (frame.holdTicks || frame.flags)) {
      throw new Error(`mov: frame "${frame.name}" wants a hold but no logic container`);
    }
    const artLoc = b.add(
      frame.hold ? holdFrameArt(width, height) : encodeFrame(frame.art!, width, height),
    );
    const logicLoc = frame.noLogic ? 0 : b.add(logicBlock(frame));
    const rec = C0.frames + i * C0.frameSize;
    i16(header, rec + FRAME.height, height);
    i16(header, rec + FRAME.width, width);
    i32(header, rec + FRAME.art, artLoc - bias);
    // a stored 0 means "the frame has no logic container", so it stays 0 rather
    // than becoming a bias-relative pointer to the header itself
    i32(header, rec + FRAME.clickRegion, logicLoc ? logicLoc - bias : 0);
    pstr(header, rec + FRAME.name, frame.name, MOV_NAME_FIELD);
    return artLoc;
  });
}

/** Assemble a movie — one segment, or a chain of them played back to back. */
export function buildMovFile(opts: MovBuildOptions): MovBuildResult {
  const b = new ContainerBuilder();
  const header0 = reserveHeader(b, opts);

  // container 1 is where a soundtrack's loop table goes. This builder writes no
  // sound, but the slot is kept occupied so frame art never lands there.
  b.add(new Uint8Array(8));
  for (let g = 0; g < (opts.gaps ?? 0); g++) b.gap();

  const artLocs = writeFrames(b, opts, header0, 0);

  // the rest of the chain: each segment's header names the next (+0x2c), and
  // each stores its own locations relative to itself
  const segmentLocs = [0];
  let prev = header0;
  for (const seg of opts.segments ?? []) {
    const bias = b.count;
    const header = reserveHeader(b, seg);
    writeFrames(b, seg, header, bias);
    i32(prev, C0.nextSegment, bias);
    prev = header;
    segmentLocs.push(bias);
  }

  return { file: b.finish(), artLocs, segmentLocs };
}

/** {@link buildMovFile}, serialized */
export function buildMovBytes(opts: MovBuildOptions): Uint8Array {
  return writeContainerFile(buildMovFile(opts).file);
}
