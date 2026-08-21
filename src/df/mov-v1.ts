import { readAudioHeader } from "./audio";
import { DFContainerFile, readContainerFile } from "./container";
import { versionOf } from "./version";
import type { MovFile, MovFrame, MovSegment } from "./mov";

/**
 * MOV files as *Dust* (DreamFactory 1) writes them.
 *
 * Its own reader rather than a branch in {@link file://./mov.ts}, because v4's
 * container 0 is not this one with the fields moved. But the SHAPE is the same
 * shape: a v1 movie is a chain of SEGMENTS too, each with its own header,
 * palette, frame table and frame rate, each naming the next, and every container
 * location inside one relative to its own header's index.
 *
 * ## What is confirmed, and how
 *
 *     0x02    i32 version, 1
 *     0x18    i16 frame count
 *     0x22    i16 height, i16 width  (264, 512 on a full-frame movie)
 *     0x26    i16 the frame-rate floor, in ticks of 50/3 ms
 *     0x36    i16 container of the NEXT segment's header, 0 = last
 *     0x3e    the palette: 256 * {i16 index, i16 rgb[3]}
 *     0x8da   the frame table: 80 bytes per frame, refs relative to this header
 *               +0    i16 sequence number
 *               +4    i16 container of the picture
 *               +20   i16 height, i16 width
 *               +58   i16 hold, in ticks (0 = take the segment's floor)
 *               +78   i16 action - 1 exit, 2 advance, 3 chain out
 *
 * The frame table's offset and stride were found by looking for a column of
 * ascending container refs rather than by reading a header field, and the
 * ARITHMETIC is what confirms them: on all 247 movies on the disc every ref the
 * count at 0x18 claims lands on a container that opens with the codec's own {i16
 * height, i16 width}. The count and the chain then confirm each other — follow
 * 0x36 through INTRO.MOV and its ten segments claim 136 + 46 + 104 + 20 + 96 + 33
 * + 82 + 30 + 25 + 66 = 638 frames, which is exactly the number of pictures in the
 * file.
 *
 * ## The last record is 56 bytes, and the CLICK REGIONS follow it
 *
 * A v1 segment's container is header · palette · frame table · click regions, and
 * the frame table's final record is short: 56 of the 80 bytes, with no hold, no
 * flags and no action of its own. Then the region table, 16 bytes a record, to the
 * end of the container:
 *
 *     +0    i16 type - the same numbering the frame action uses (2 = advance)
 *     +2    i16 top, i16 left, i16 bottom, i16 right   (Y first, as everywhere)
 *     +10   i16 the frame this click jumps to, 0 = just advance
 *     +14   i16 the frame this region belongs to
 *
 * Both offsets are measured, not chosen. 296 of the 309 segments on the disc have
 * a container that ends an exact multiple of 16 bytes after `frames + count * 80 -
 * 24` with every record in range: 329 regions, every one of them type 2, every
 * frame reference resolving. Move the boundary and it stops dividing.
 *
 * The frame fields are what confirm the 56: `hold`, `flags` and `action` live at
 * +0x3a, +0x3e and +0x4e, they read cleanly on all 12053 records that are not last
 * — and on the last one they read the region table instead, which is why 54
 * segments appeared to end on an action of 264, 383 or -5002. All 54 are a last
 * frame and none is anywhere else.
 *
 * ## What is still NOT decoded, and is therefore not pretended
 *
 * No sounds, no cues and no frame names. A v1 record has 80 bytes and this reads
 * seven fields of them, so the first two are probably in there; until they are
 * found, silence is the honest reading — and it is the reason an authored wait on
 * the VOICE (flags bit 0, set by the last frame of 169 movies) passes instantly.
 */
export interface MovFrameV1 {
  /** 1-based position in the movie */
  sequence: number;
  /** container holding the picture */
  locationFrame: number;
  width: number;
  height: number;
  /** ticks of 50/3 ms this frame is held for, 0 = take the movie's floor */
  holdTicks: number;
  /** per-frame flag bits — see {@link FLAG} */
  flags: number;
  /** what happens when the frame is done — v1's own numbering, see {@link FRAME} */
  action: number;
  /** byte offset of this frame's record in container 0 */
  record: number;
  /** the click boxes authored on this frame — a frame with any WAITS for one */
  regions: MovRegionV1[];
}

/** one 16-byte click-region record — see the module comment */
export interface MovRegionV1 {
  /** v1's action numbering, as {@link FRAME}'s `action` uses it */
  type: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  /**
   * The frame a click here jumps to, as a 1-based position, 0 = just advance.
   *
   * 237 of the 329 regions on the disc leave it 0 and 74 name a frame that
   * exists; the remaining 18 (MUSIPLAT.MOV's six platter slots, SAFEBOX.MOV's
   * -20) name one that does not, and are played as an advance rather than guessed
   * at.
   */
  target: number;
  /** byte offset of this record in the segment's header container */
  record: number;
}

/** one segment: its own header container, palette, frame rate and frames */
export interface MovSegmentV1 {
  /** container index of this segment's header — the bias its refs are relative to */
  bias: number;
  paletteRaw: Uint8Array;
  width: number;
  height: number;
  /** the segment's frame-rate floor in ticks — see {@link C0.framerate} */
  framerate: number;
  frames: MovFrameV1[];
  /**
   * The segment's SOUNDTRACK — container locations in playing order.
   *
   * Named by nothing, which is the finding. A v4 movie keeps a loop table at its
   * header +0x64 and a one-shot table beside it; a v1 movie keeps neither, and
   * this reader answered "no sounds" for it — 588 containers, 34 minutes of
   * audio, sitting in the files unread. They are simply the containers a segment
   * owns that its frame table does not name: audio is what is left.
   *
   * That is measured three ways. All 588 decode (0 throw, every one at 22050 or
   * 11025 Hz). Every one falls AFTER some segment's header — none before the
   * first, on all 247 movies — so the run between one header and the next is that
   * segment's, which is the same bias-relative arrangement everything else in a
   * v1 movie uses. And no frame-record field names them: the only offset that is
   * never junk is +14, and it is 0 on every frame of all 136 movies that carry
   * audio, so there is no per-frame reference to find. INTRO.MOV reads out as ten
   * segments each holding its own chunks directly after its own header.
   */
  audioChunks: number[];
}

export interface MovFileV1 {
  file: DFContainerFile;
  version: 1;
  /** the chain from container 0 onward, in playing order */
  segments: MovSegmentV1[];
  /** the first segment's, kept for callers that only want the opening picture */
  paletteRaw: Uint8Array;
  width: number;
  height: number;
  framerate: number;
  frames: MovFrameV1[];
  /**
   * Pictures in the file that no segment's frame table names.
   *
   * 0 on all 247 movies on the disc, which is what says the frame tables account
   * for the whole film — it was 502 on INTRO.MOV alone when only the first segment
   * was read, and 291 disc-wide for as long as this reader mistook each table's
   * short final record for a terminator and threw its picture away.
   */
  unaccounted: number;
  warnings: string[];
}

const C0 = {
  version: 0x02,
  /**
   * How many frames the movie has.
   *
   * The reader used to have no count at all and walked the table until a record
   * stopped resolving, which cut the LAST FRAME off 194 of the 247 movies on the
   * disc: container 0 is sized to end inside its final record, so the walk's
   * bounds check tripped one frame early. This field equals the number of pictures
   * in the file on 229 of the 247 — and on all 247 every one of the records it
   * claims has a ref that resolves. The 18 that read short are the segmented ones,
   * where the leftover pictures belong to segments this reader does not follow.
   */
  frameCount: 0x18,
  /** i16 height then i16 width, before the palette */
  size: 0x22,
  /**
   * Container of the NEXT segment's header, 0 on the last — v4 keeps the same
   * pointer at its header +0x2c.
   *
   * Nonzero on 18 of the 247 movies, which is exactly the 18 whose frame count
   * came up short of the pictures in the file. Following it accounts for all of
   * them: INTRO.MOV's ten segments sum to the 638 pictures it holds, and its later
   * segments run at their own frame rates (2, 6, 3, 6, 1, 5, 1, 1, 2, 1) rather
   * than the first's.
   */
  nextSegment: 0x36,
  /**
   * The movie's own frame-rate floor, in ticks of 50/3 ms — v4 keeps the same
   * thing at its header +0x1c.
   *
   * 3 on 194 of the 247 movies, which is the engine's shipped `framerate(3)` and
   * what this file used to hard-code for everything; the other 53 ask for 4, 5, 6
   * or 8, i.e. up to 133 ms a frame instead of 50. Honouring it is most of the
   * answer to "the movies play too fast".
   */
  framerate: 0x26,
  palette: 0x3e,
  frames: 0x8da,
} as const;

const PALETTE_SIZE = 256 * 8;
const FRAME_SIZE = 80;
/**
 * The fields of one frame record.
 *
 * `hold` and `action` are v4's LOGIC block, which v4 factors out into a container
 * of its own and v1 keeps inline — the same split as `.SND` keeping its sound
 * names inline where a `.TRK` puts them in a table.
 *
 *   - `hold`: 0 on 6395 of the 8117 records (take the movie's floor) and 1 on
 *     1131, with 15, 30, 60 for the rest. The same shape as v4's, whose comment
 *     records "most frames carry 0 or 20".
 *   - `action`: 2 on 7784 records, 1 on 258 — of which 180 are the last frame of
 *     their movie — and 3 on 19, 12 of them last. Those are v4's action types read
 *     through v1's numbering: 1 exits, 3 exits and chains to another movie, and 2
 *     is the ordinary advance (it cannot be v4's own 2, "go to the frame named
 *     target", because a v1 record carries no target and 96% of all frames have
 *     it).
 */
const FRAME = { sequence: 0, location: 4, size: 20, hold: 0x3a, flags: 0x3e, action: 0x4e } as const;

/**
 * The last record of a table is this short, and the click regions start where it
 * stops.
 *
 * Which is why the last frame has no hold, no flags and no action: they live past
 * +56 and the file does not write them. Reading them anyway is what made 54
 * segments claim an action of 264 or -5002 (all of them a last frame, none of them
 * anywhere else) and what made every movie look as though it ended on the frame
 * before its last.
 */
const FRAME_LAST_SIZE = 56;
const REGION_SIZE = 16;
const REGION = { type: 0, top: 2, target: 10, frame: 14 } as const;

/**
 * The flag bits, which are v4's — bit 0 waits for the voice channel, bit 2 plays
 * through the frame's click regions, bit 3 adds to the running deadline instead of
 * resetting it. Bit 4 is set on 7718 of the 8117 records and nothing here knows
 * what it means.
 *
 * Bit 0 is authored and real — the frame HELP.MOV stops on sets it, and so does the
 * frame 168 other movies stop on — but it is not the whole of why that film waits.
 * It waits because that frame carries a click region (its OK button), and it holds
 * there until the player uses it. The voice wait is a second, shorter hold on top,
 * and it passes instantly because a v1 movie's audio has not been found yet.
 */
const FLAG = { voice: 1, throughRegions: 4, holdDeadline: 8 } as const;

/** v1 action numbering -> the numbering mov.ts plays (see {@link FRAME}) */
const ACTION: Record<number, number> = { 1: 1, 2: 6, 3: 3 };
/** mov.ts's "go to the frame named target" — v1 names one by number instead */
const V4_GOTO = 2;

/**
 * Which frame a 1-based POSITION names.
 *
 * A region says which frame it belongs to, and a region's `target` says which one
 * a click goes to, both as the number in the record's own `sequence` field. Read
 * that number back where it is written and fall back to counting, because the
 * authoring tool leaves it blank often enough to matter: MATCH.MOV's records are
 * numbered 1..13, 0, 15..24, 0, and its region names frame 14. Both readings
 * together resolve all 329 regions on the disc; the sequence field alone leaves 7.
 *
 * And it is a POSITION, not an index. Read as an index, only 53 of the 329 land on
 * a frame that ends the film and 156 land on the final still, which has no action
 * at all; read as a position, 168 land on the frame whose action is EXIT — the
 * frame the movie stops at, which is the one a click is for.
 */
function frameAt(frames: readonly MovFrameV1[], position: number): number {
  const named = frames.findIndex((f) => f.sequence === position);
  return named >= 0 ? named : position - 1;
}

export function readMovFileV1(data: Uint8Array): MovFileV1 {
  const file = readContainerFile(data);
  const c0 = file.containers[0].data;
  const version = versionOf(c0);
  if (version !== 1) {
    throw new Error(`not a DreamFactory 1 MOV (container 0 says version ${version})`);
  }
  const warnings: string[] = [];

  const picture = (loc: number): boolean => {
    const c = file.containers[loc];
    if (!c || c.gap || c.data.length < 8) return false;
    const d = new DataView(c.data.buffer, c.data.byteOffset, c.data.byteLength);
    const h = d.getInt16(0, true);
    const w = d.getInt16(2, true);
    return h > 0 && h <= 480 && w > 0 && w <= 640;
  };

  /**
   * One segment, read from its own header container.
   *
   * Its frames come out exactly as many as the header counts, and FIELD BY FIELD.
   * Not "walk until a record stops resolving", which is what this used to do and
   * what cost every movie its last frame: the header container is sized to end
   * INSIDE its final record on 194 of the 247 movies (8 to 24 bytes short of it),
   * so a whole-record bounds check refuses the frame the count asks for. Only 53
   * tables fit entirely inside their container. So a field past the end reads as
   * absent rather than ending the table; the ref is the one that must be there,
   * and on all 247 movies every ref the count claims resolves.
   */
  const readSegment = (bias: number): { segment: MovSegmentV1; next: number } => {
    const cs = file.containers[bias].data;
    const vs = new DataView(cs.buffer, cs.byteOffset, cs.byteLength);
    const at16 = (o: number): number | null => (o + 2 <= cs.length ? vs.getInt16(o, true) : null);
    if (cs.length < C0.palette + PALETTE_SIZE) {
      warnings.push(`segment c${bias} is too short to hold a palette`);
    }
    const count = vs.getInt16(C0.frameCount, true);
    if (count < 1 || count > 4096) warnings.push(`segment c${bias}: implausible frame count ${count}`);
    const frames: MovFrameV1[] = [];
    for (let i = 0; i < count; i++) {
      const o = C0.frames + i * FRAME_SIZE;
      const ref = at16(o + FRAME.location);
      // refs are relative to this segment's own header, exactly as v4's are
      const locationFrame = ref === null ? null : ref + bias;
      if (locationFrame === null || ref! < 1 || locationFrame >= file.containers.length) {
        warnings.push(`segment c${bias} frame ${i + 1}/${count}: no picture ref at 0x${o.toString(16)}`);
        break;
      }
      if (!picture(locationFrame)) {
        warnings.push(`segment c${bias} frame ${i + 1}/${count}: c${locationFrame} is not a picture`);
        break;
      }
      // The last record stops at +56, so its hold, flags and action are not in
      // the file — the region table is what those bytes hold. EXIT is the
      // reading, not a guess to fill the hole: a movie that reaches its final
      // picture has nothing after it to advance to, and the frame BEFORE it
      // already carries an explicit exit on 168 of the 309 segments (the ones
      // that stop there rather than at the final still).
      const last = i === count - 1;
      frames.push({
        sequence: at16(o + FRAME.sequence) ?? i + 1,
        locationFrame,
        height: at16(o + FRAME.size) ?? 0,
        width: at16(o + FRAME.size + 2) ?? 0,
        holdTicks: last ? 0 : at16(o + FRAME.hold) ?? 0,
        flags: last ? 0 : at16(o + FRAME.flags) ?? 0,
        action: last ? 1 : at16(o + FRAME.action) ?? 2,
        record: o,
        regions: [],
      });
    }
    if (!frames.length) warnings.push(`segment c${bias}: no frame table at 0x${C0.frames.toString(16)}`);
    /**
     * The click regions, from where the short last record stops to the end of the
     * container.
     *
     * The final record's `sequence` is 0 on 280 of the 309 segments, and this
     * reader used to read that as a table terminator and DROP the frame — which
     * cost every one of those movies its final picture, and is the reason HELP.MOV
     * ended on itself with its OK button never shown. It is not a terminator: all
     * 309 last records name a real picture container, and one distinct from the
     * frame before it. The 0 is the authoring tool leaving the number blank, which
     * it also does mid-table (MATCH.MOV numbers its records 1..13, 0, 15..24, 0)
     * — so `sequence` is not to be trusted for anything.
     *
     * TAKEN WHOLE OR NOT AT ALL. 296 segments divide exactly and read clean; the
     * other 13 (MAIN, KEYS, the four PAPERs, STEPS…) carry something else in the
     * space and are left with no regions rather than with the 603 nonsense boxes a
     * longest-valid-suffix scan finds in MAIN.MOV alone.
     */
    const regionBase = C0.frames + count * FRAME_SIZE - (FRAME_SIZE - FRAME_LAST_SIZE);
    const span = cs.length - regionBase;
    if (frames.length === count && span > 0 && span % REGION_SIZE === 0) {
      const rs: (MovRegionV1 & { frame: number })[] = [];
      for (let g = 0; g < span / REGION_SIZE; g++) {
        const o = regionBase + g * REGION_SIZE;
        const v = (at: number): number => vs.getInt16(o + at, true);
        const top = v(REGION.top), left = v(REGION.top + 2);
        const bottom = v(REGION.top + 4), right = v(REGION.top + 6);
        const frame = v(REGION.frame);
        if (v(REGION.type) < 1 || v(REGION.type) > 7) break;
        if (top < 0 || left < 0 || top >= bottom || left >= right) break;
        if (bottom > (vs.getInt16(C0.size, true) || 264)) break;
        if (right > (vs.getInt16(C0.size + 2, true) || 512)) break;
        if (frame < 0 || frame >= count) break;
        rs.push({ type: v(REGION.type), top, left, bottom, right, target: v(REGION.target), frame, record: o });
      }
      if (rs.length === span / REGION_SIZE) {
        for (const r of rs) frames[frameAt(frames, r.frame)]?.regions.push(r);
      } else {
        warnings.push(`segment c${bias}: ${span} bytes of click regions do not read`);
      }
    } else if (span > 0) {
      warnings.push(`segment c${bias}: ${span} bytes past the frame table are not click regions`);
    }
    const next = vs.getInt16(C0.nextSegment, true);
    return {
      segment: {
        bias,
        paletteRaw: cs.subarray(C0.palette, C0.palette + PALETTE_SIZE),
        height: vs.getInt16(C0.size, true),
        width: vs.getInt16(C0.size + 2, true),
        framerate: vs.getInt16(C0.framerate, true) || MOV_V1_HOLD_TICKS,
        frames,
        audioChunks: [],
      },
      next,
    };
  };

  // Follow the chain, guarding against a pointer that loops: the last segment's
  // `next` is 0, and 0 is where we started.
  const segments: MovSegmentV1[] = [];
  const seen = new Set<number>();
  for (let at = 0; at >= 0 && at < file.containers.length && !seen.has(at); ) {
    seen.add(at);
    const { segment, next } = readSegment(at);
    segments.push(segment);
    at = next;
  }

  // pictures no segment names — see MovFileV1.unaccounted
  const named = new Set(segments.flatMap((sg) => sg.frames.map((f) => f.locationFrame)));
  let unaccounted = 0;
  for (let i = 1; i < file.containers.length; i++) if (!named.has(i) && picture(i)) unaccounted++;

  /**
   * The soundtrack: whatever a segment owns and its frame table does not name.
   * A chunk belongs to the LAST header before it, which is the same
   * bias-relative arrangement the pictures and the frame refs use — see
   * {@link MovSegmentV1.audioChunks} for why this is the whole of the rule.
   */
  const headers = segments.map((sg) => sg.bias).sort((a, b) => a - b);
  for (let i = 1; i < file.containers.length; i++) {
    if (named.has(i) || headers.includes(i) || file.containers[i].gap) continue;
    if (!readAudioHeader(file.containers[i].data)) {
      warnings.push(`c${i} is neither a picture, a header nor audio`);
      continue;
    }
    let owner = -1;
    for (const h of headers) if (h < i && h > owner) owner = h;
    const seg = segments.find((sg) => sg.bias === owner);
    if (seg) seg.audioChunks.push(i);
    else warnings.push(`c${i} is audio before the first segment header`);
  }

  const first = segments[0];
  return {
    file,
    version: 1,
    segments,
    paletteRaw: first.paletteRaw,
    height: first.height,
    width: first.width,
    framerate: first.framerate,
    frames: first.frames,
    unaccounted,
    warnings,
  };
}

/**
 * A v1 movie in the shape {@link file://./mov.ts} defines, so the movie player
 * plays it without knowing.
 *
 * Everything the player needs and v1 stores is carried over — every segment, its
 * own frame rate, each frame's hold and action, and the click boxes that make a
 * frame WAIT. Everything v1 does not store is left at the value that means "not
 * authored" rather than at a plausible-looking invention: no sounds and no cues,
 * so a v1 movie here plays in silence.
 *
 * Frames are NAMED here, with their own 1-based position as the name. v4 sends a
 * click to another frame by name and v1 by number, and this is the whole of the
 * difference — naming a v1 frame "7" lets the player's `case 2` resolve a v1
 * target through the same `frameByName` it uses for a v4 one, with nothing in the
 * player knowing which engine wrote the film.
 */

/** the floor when a segment header names no frame rate — the engine's own
 *  shipped `framerate(3)`, which is what 194 of the 247 movies ask for anyway */
export const MOV_V1_HOLD_TICKS = 3;

export function movFileFromV1(v1: MovFileV1): MovFile {
  const segments: MovSegment[] = v1.segments.map((sg) => ({
    file: v1.file,
    bias: sg.bias,
    width: sg.width,
    height: sg.height,
    originX: 0,
    originY: 0,
    paletteRaw: sg.paletteRaw,
    frames: sg.frames.map((f, i): MovFrame => ({
      // v1's action numbering through v4's — 6 (advance) for anything
      // unrecognised, which is what mov.ts uses for a v4 frame with no logic
      type: ACTION[f.action] ?? 6,
      height: f.height || sg.height,
      width: f.width || sg.width,
      locationFrame: f.locationFrame,
      // no logic container: a v1 frame keeps its logic inline (see FRAME), and 0
      // is what mov.ts reads as "there is none" (container 0 is always a header)
      locationClickRegion: 0,
      record: f.record,
      name: String(i + 1),
      sound: "",
      event: "",
      target: "",
      regions: f.regions.map((r) => {
        // A target that names no frame is an ADVANCE, not a jump into nothing:
        // the player's `case 2` finishes the movie outright when a name misses,
        // and 18 of the 329 regions carry a number no frame answers to
        // (MUSIPLAT.MOV's six platter slots on a three-frame segment).
        const to = r.target > 0 ? frameAt(sg.frames, r.target) : -1;
        const jump = to >= 0 && to < sg.frames.length;
        return {
          type: jump ? V4_GOTO : ACTION[r.type] ?? 6,
          target: jump ? String(to + 1) : "",
          // stored top/left/bottom/right, Y first — mov.ts keeps the same order
          y0: r.top,
          x0: r.left,
          y1: r.bottom,
          x1: r.right,
          sound: "",
          event: "",
          record: r.record,
        };
      }),
      holdTicks: f.holdTicks,
      waitsForVoice: (f.flags & FLAG.voice) !== 0,
      holdsDeadline: (f.flags & FLAG.holdDeadline) !== 0,
      playsThroughRegions: (f.flags & FLAG.throughRegions) !== 0,
    })),
    actionFrame1: "",
    actionFrame2: "",
    flags: 0,
    keySkips: true,
    minHoldTicks: sg.framerate,
    audioChunks: sg.audioChunks,
    // NOT a loop. v4's chunks come out of a loop-ORDER table whose tail usually
    // repeats, so `audioLoops` is true there whenever there are chunks at all; a
    // v1 segment's chunks are a plain run of containers, played once under the
    // picture. Which is what the frame flag says too: the frame a film stops on
    // sets "wait for the voice" (169 of them do), and waiting for a line to end
    // only means anything if the line ends.
    audioLoops: false,
    sounds: new Map(),
    soundFollows: new Map(),
    cues: [],
  }));
  return Object.assign(segments[0], { segments }) as MovFile;
}
