import { readAudioHeader } from "./audio";
import { DFContainerFile, readContainerFile } from "./container";
import { versionOf } from "./version";
import type { MovFile, MovFrame, MovSegment } from "./mov";

/**
 * MOV files as *Dust* (DreamFactory 1) writes them.
 *
 * Its own reader rather than a branch in {@link file://./mov.ts}, because v4's
 * container 0 is not this one with the fields moved. But the SHAPE is the same
 * shape: a v1 movie is a chain of SEGMENTS, each with its own header, palette,
 * frame table and frame rate, each naming the next, and every container location
 * inside one relative to its own header's index. And a frame is the same frame —
 * a state in a little machine, with an action, a target, sounds and click boxes —
 * with everything v4 moves into per-frame LOGIC containers kept inline.
 *
 * ## The record layout is DF.EXE's own, not a statistical guess
 *
 * This reader went through three readings of the frame table, each fitting most
 * of the data and each wrong about who owned which field, before the engine
 * settled it: DF.EXE's movie loop indexes the table at
 *
 *     lea esi, [frame*80 + header + 0x8c2]        (0x40484d)
 *
 * — records of 80 bytes starting at 0x8c2, frame indices 0-based. (The previous
 * reading had the base at 0x8da: every column matched SOMETHING 24 bytes away,
 * which is how it could validate against the whole disc and still hand the wait
 * bit of one frame to the action of another.) The fields, each with the engine
 * read that proves it:
 *
 *     +0x00  i16 how many HOTSPOT records this frame owns, at the offset in
 *            +0x24 (0x404e5a reads it, 0x404e90 skips straight to the action
 *            when it is <= 0). It both BOUNDS the run and decides whether the
 *            frame stops for a click — see {@link MovFrameV1.waitsForClick}.
 *     +0x02  i32 hold, in ticks of 50/3 ms — floored by the header's frame rate
 *            (0x404861: `max(hold, [hdr+0x26])`)
 *     +0x06  i16 NOT read by the movie loop — see below. 16 on 6255 of the
 *            disc's 6717 frames, 18 on 175 first frames and 17 on 163 last
 *            ones, which is a structural marker and not behaviour.
 *     +0x0a  i32 first and +0x0e i32 last container of the range this frame
 *            loads, when +0x1a bit 1 says it loads one (0x406be9). Not read
 *            here: the port has the whole file in hand and has nothing to
 *            stage in.
 *     +0x16  i16 action, dispatched 1..5 through the table at 0x405464:
 *              1 exit · 2 goto `target` · 3 exit + chain to the movie named at
 *              +0x30 · 4/5 unshipped as frame actions
 *     +0x18  i16 target of action 2, a 0-BASED frame index, clamped to the table
 *            (0x405190; a target past the end pins to the last frame)
 *     +0x1a  i16 the flags the loop actually reads, each at its own site:
 *              bit 0  after this frame, BLOCK until the sound is done
 *                     (0x404ab0 and the exit path 0x404ae6, both calling
 *                     0x429bd0 — a spin on the channel-0 "still playing" word
 *                     at 0x45e1c1, servicing audio until it clears)
 *              bit 1  this frame loads the container range at +0x0a..+0x0e,
 *                     bit 3 deciding before or after the blit (0x406bc0)
 *              bit 2  do NOT stop for this frame's hotspots when no click is
 *                     in hand — the count is zeroed and the frame's own action
 *                     runs (0x404e7f, and the loop it picks at 0x405119)
 *              bit 4  plain step-advance to the next frame, ignoring the
 *                     action (0x404e76 -> 0x405134). Never set on this disc:
 *                     +0x1a is 0 on 6564 frames, 1 on 152 and 0xa on one.
 *     +0x1c  i16 picture container, relative to the segment's header
 *     +0x20  i32 sound started when the frame shows: the chunk at
 *            `bias + |ref|`, 0 = none. Positive refs point into the up-front
 *            bank (header +0x1a counts it), negative ones at chunks interleaved
 *            with the pictures — the one-shot player literally adds `|ref|` to
 *            the segment base either way (0x404d77)
 *     +0x24  i16 offset of the frame's HOTSPOT run in container 0 — see below
 *     +0x30  pstr: the movie a type-3 exit chains to (the exit handler at
 *            0x4051d4 posts `record + 0x30` with the abort flag set)
 *
 * Advance is not implicit: an ordinary frame is `action 2, target = next`, a
 * loop is a target pointing BACKWARD (BELL.MOV idles its bell through 2..21 and
 * frame 21's target is 1), and a hold at the end is a target clamped onto
 * itself.
 *
 * ## Hotspots: typed records, walked from a per-frame offset
 *
 * The table after the last frame record is not one list of click boxes owned by
 * frames — it is runs of TYPED records, and each frame's +0x24 says where ITS
 * run starts (frames of one phase share a run). The engine walks records from
 * that offset, first hit wins, and stops at a record whose type is not 1..5
 * (or the end of the container). Types are the ACTION codes again, each with
 * its own record size (the stride table at 0x405450):
 *
 *     type 1 (14 bytes)  {i16 type, i16 box[4] (top,left,bottom,right),
 *                         i16 sound, i16 ?} — exit, with a click sound
 *     type 2 (16 bytes)  {..., i16 sound, i16 ?, i16 target} — goto `target`
 *                        (0-based), playing `sound` (bias-relative, 0 = none)
 *     type 3 (46 bytes)  exit + chain — carries more nobody shipped in the
 *     type 4 (48 bytes)  call, with the five-deep stack check at 0x4050af
 *     type 5 (14 bytes)  return
 *
 * Everything the main game ships is type 2 (BELL.MOV's three bells each carry
 * their own ding in `sound` and their ring animation in `target`; ARMOPEN.MOV's
 * two boxes on its first frame send the doors to the opening and everywhere
 * else to the exit) plus the type-1 "put it down" margins of the four PAPERs.
 * A frame with hotspots but no wait bit still answers clicks — that is how an
 * animation is skippable into its own branches — it just doesn't stop for them.
 *
 * ## What a chain is, and what it is NOT
 *
 * A type-3 exit sets the movie's abort flag and posts the name at its own
 * record +0x30 (0x4051d4). The abort flag makes the segment teardown clear the
 * next-segment pointer (0x404b82), so the film ends outright and the named one
 * plays next — there is NO return. ARMOPEN.MOV is the shipped proof read
 * end-to-end: its first frame waits; the doors send it through the opening
 * animation STRAIGHT into frame 19's chain to Diary.mov (taking the diary is
 * not a choice, it is the scene); and the put-the-diary-back half (frames
 * 20-36) is reachable only by clicking AWAY from the armoire while it is still
 * animating — the hotspot boxes that target frame 20. A port that invented a
 * return played the wardrobe closing between the diary and the page-reading
 * flat, which is exactly what was reported.
 *
 * ## Sounds are per frame and per click, not a bed
 *
 * Record +0x20 and hotspot `sound` above, both verified against every movie on
 * the disc (0 misses across 213 frame refs and 224 click refs: every nonzero ref
 * lands on an audio container). A chunk no frame and no hotspot references is
 * the segment's BED, played once from its start — FINALEND.MOV's credits music
 * is four such chunks; 81 segments reference everything they own and have no
 * bed at all.
 *
 * ## A frame can WAIT for the sound it started, and 152 of them do
 *
 * The picture does not simply run at the frame rate over the top of whatever is
 * playing. Record +0x1a bit 0 makes the movie loop block on the sound channel
 * before it moves on (0x404ab0 -> 0x429bd0), so the frame is held for
 * `max(hold, what is left of the sound)`. Nothing in the file says how long a
 * sound is; this is how a film times itself to one.
 *
 * DOG1.MOV — the dog that stops you leaving town on day one — is the small proof
 * and was the report: six frames, one 0.88 s growl, and the growl is fired
 * TWICE, at frame 1 and again at frame 3. Held only to the frame rate, the two
 * land 100 ms apart, and two copies of one 0.88 s growl 100 ms apart is one
 * growl. Its frames 2 and 4 — each the frame after a firing — carry bit 0: the
 * film waits out the first growl before it snarls again, and takes 2.43 s rather
 * than 0.98 s. That is the difference between a dog that growls twice and a dog
 * that growls once.
 *
 * 69 of the disc's 185 segments are timed this way — 50 of its 160 films — and
 * the four endings are the ones it matters most to: MAYOREND.MOV runs 61 s with the wait and 15 s
 * without it, so three quarters of the mayor's last speech played over a picture
 * that had already finished.
 *
 * The port spends it through {@link MovFrame.waitsForVoice}, which is the same
 * sentence in v4's words — "hold until this movie's own sounds are done".
 *
 * ## +0x06 is not wait flags, and what that cost (#324)
 *
 * The movie loop never reads +0x06: no site in .text tests a bit of it, and the
 * values do not behave like flags either — 16 almost everywhere, 18 on a first
 * frame, 17 on a last one. This reader used to derive BOTH waits from it, and
 * the click half was wrong in a way that showed: "bits 1/3" amounts to "this is
 * the first frame", so frame 0 was the only frame that ever stopped for a click
 * and every frame reached BY a click played straight on. Reported twice from
 * play — the Mayor's letters and the hotel room's blinds both opened for one
 * frame and then ran off the end of the film.
 *
 * A frame stops because it OWNS hotspots and is not told to play through them:
 * the count at +0x00 (0x404e5a, and 0x404e90 skipping to the action when it is
 * <= 0) and +0x1a bit 2 (0x404e7f, which zeroes the count when no click is in
 * hand). Those are the two the loop reads, and they are what `waitsForClick` is
 * now. Across the disc's 8344 frames, 568 own a hotspot and 358 carry bit 2.
 *
 * The count also BOUNDS the run. `hotspotRun` used to walk from +0x24 until a
 * record failed to decode, which sails into the next frame's boxes whenever two
 * runs are adjacent — and they always are, since each run is exactly its own
 * count of records long. That is how a frame owning none came to answer clicks
 * with the following frame's boxes. All 520 counted runs on the disc decode
 * cleanly for exactly their count, and 372 of them are ones the unbounded walk
 * over-read.
 *
 * `waitsForVoice` still comes from +0x06 bit 0, OR-ed with the real +0x1a bit 0
 * — see {@link MovFrameV1.holdsForSound}. That one is still an accident ("this
 * is the last frame") but a load-bearing one, and untangling it is a separate
 * question from this.
 *
 * ## Header fields
 *
 * Shared with the previous readings and unchanged: version @2, frame count
 * @0x18, sound-bank count @0x1a, height/width @0x22, frame-rate floor @0x26,
 * screen origin @0x2a/0x2c (0 on every shipped film), action frames @0x2e/0x30
 * (1-BASED positions, -1 = none — what `actionframe(1)`/`(2)` report, compared
 * against the running position at 0x404a8f; MAYBED.MOV's is 4, the frame its
 * bed-click goto lands on, and DIARY.MOV's is 1, true the moment the film
 * starts), next segment @0x36, palette @0x3e. One rule the
 * teardown adds (0x404b9c): the next-segment pointer is followed only when
 * playback stopped ON the last frame — a mid-film exit ends the whole film.
 */
export interface MovFrameV1 {
  /** container holding the picture (absolute — bias already added) */
  picture: number;
  /** ticks of 50/3 ms this frame is held for; the segment's rate is the floor */
  holdTicks: number;
  /** bit 0 of +0x06 — hold until the fired one-shot sound has finished */
  waitsForVoice: boolean;
  /**
   * Hold until a hotspot is clicked: this frame owns at least one (+0x00) and
   * +0x1a bit 2 does not say to play through them.
   *
   * NOT +0x06, which is what this used to read and is not a field the movie
   * loop touches — see the module comment. Its bits amount to "first frame" and
   * "last frame", so only a frame 0 ever waited: click the envelope in
   * `maylett.mov` or the hotel blinds in `hwin.mov` and the picture showed for
   * one frame and then ran off the end of the film (#324).
   */
  waitsForClick: boolean;
  /** +0x00 — how many hotspot records this frame owns */
  hotspotCount: number;
  /** 1 exit · 2 goto · 3 exit + chain — see the module comment */
  action: number;
  /** action 2's destination, a 0-based frame index (unclamped, as stored) */
  target: number;
  /** +0x1a — the raw flag word; the bits are in the module comment */
  flags2: number;
  /**
   * +0x1a bit 0 — after this frame, hold until the sound it started is done.
   *
   * The film's own way of timing itself to a line it cannot measure, and read
   * out of the movie loop's `test byte ptr [rec+0x1a], 1` -> `call 0x429bd0`
   * (0x404ab0, and 0x404ae6 on the exit path). 152 frames across 69 segments
   * carry it, DOG1.MOV's two snarls among them.
   */
  holdsForSound: boolean;
  /** container of the sound this frame starts, 0 = none (absolute) */
  sound: number;
  /** offset of this frame's hotspot run in container 0 */
  hotspotOffset: number;
  /** the movie a type-3 exit chains to, "" = none */
  chainTo: string;
  /** byte offset of this frame's record in the segment's header container */
  record: number;
  /** the hotspot run this frame answers clicks with, first hit wins */
  regions: MovHotspotV1[];
}

/** one typed hotspot record — see the module comment */
export interface MovHotspotV1 {
  /** the action numbering again: 1 exit, 2 goto, 3 chain, 4 call, 5 return */
  type: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** container of the sound a click here plays, 0 = none (absolute) */
  sound: number;
  /** type 2's destination, a 0-based frame index; 0 for other types */
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
   * EVERY audio container the segment owns, in container order.
   *
   * Found by type, not by table: they are the containers between one segment's
   * header and the next that its frame table does not name as pictures. All 588
   * on the disc decode (0 throw, every one at 22050 or 11025 Hz), and every one
   * falls after some segment's header — none before the first — so the run
   * between headers is that segment's, the same bias-relative arrangement
   * everything else in a v1 movie uses. Header +0x1a counts the up-front bank
   * (the chunks right after the header); the rest sit interleaved with the
   * pictures, and frames reference those with a NEGATIVE ref.
   */
  audioChunks: number[];
  /**
   * The chunks nothing references — the segment's soundtrack bed, played once
   * from its start. `audioChunks` minus every frame's and every hotspot's
   * sound; see the module comment. 33 segments have one, 81 reference all
   * their audio and this is empty.
   */
  bed: number[];
  /**
   * 0-BASED index of action frame 1, -1 = none — the same base the goto targets
   * use.
   *
   * This was read as 1-based, inferred from DIARY.MOV on the grounds that its
   * click goto skips frame 2 so a 0-based reading could never fire. That is not
   * what the file says: DIARY's frame 1 is reached by frame 0 falling through it
   * (`action 2, target 1`, no wait), so BOTH readings land on the played path
   * and it cannot decide anything. MAYBED.MOV is ambiguous the same way — its
   * yes-path is [1] → [3] → [4] and the two readings name [3] and [4].
   *
   * What decides it is the four films where only one reading names a frame the
   * play can reach: ABE.MOV, SAFEBOX.MOV, SALGUN.MOV and WELLGUN.MOV, all
   * 0-based. ABE.MOV shows the cost — its frame 15 waits for a click and both
   * hotspots jump PAST the frame a 1-based reading names, so the stagecoach
   * trade could never complete, and `D2A_001` is the original completing it.
   *
   * Swept over the whole disc by `dust/tools/actionframes.ts`: twelve segments
   * name an action frame, twelve are reachable read 0-based, eight read 1-based.
   */
  actionFrame1: number;
  /** 0-based index of action frame 2, -1 = none */
  actionFrame2: number;
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
   * 0 on every movie on the disc, which is what says the frame tables account
   * for the whole film — it was 502 on INTRO.MOV alone when only the first
   * segment was read.
   */
  unaccounted: number;
  /**
   * Everything that did not fit the reading — a picture that is neither a frame
   * nor a header, a frame count no segment could hold, audio before the first
   * segment.
   *
   * This is what makes the two sniffs in this file self-validating rather than
   * hopeful: frames are located by plausible dimensions and a segment's audio by
   * "the last header before it", so anything the shape does not explain has to
   * land here. Measured across the whole disc for #325: **247 of Dust's 258
   * `.mov` read with an empty list**, and the 11 that do not read at all are the
   * whole of `MOVIES/ZUNUSED/` — cut content, container 0 saying version 0, which
   * the game never opens. So the sniffs have no unexplained residue anywhere on
   * the disc.
   */
  warnings: string[];
}

const C0 = {
  version: 0x02,
  /**
   * How many frames the movie has. On all the disc's movies every record it
   * claims carries a picture ref that resolves, and the 18 files whose count
   * reads short of their pictures are the segmented ones — the rest belongs to
   * the segments the chain at +0x36 reaches.
   */
  frameCount: 0x18,
  /**
   * i16, how many sound chunks sit in the up-front bank — the containers right
   * after this header, before the first picture. ARMOPEN.MOV says 3 and c1..c3
   * are its creaks; HELP.MOV says 0 and its first picture is c1. Not the whole
   * of a segment's audio (see {@link MovSegmentV1.audioChunks}), but the range
   * positive sound refs point into.
   */
  soundBank: 0x1a,
  /** i16 height then i16 width, before the palette */
  size: 0x22,
  /**
   * The movie's own frame-rate floor, in ticks of 50/3 ms — v4 keeps the same
   * thing at its header +0x1c. 3 (the engine's shipped `framerate(3)`) on most
   * of the disc; the rest ask for 4, 5, 6 or 8.
   */
  framerate: 0x26,
  /** i16, 1-based position of action frame 1, -1 = none (v4: a NAME at +0x40) */
  actionFrame1: 0x2e,
  /** i16, 1-based position of action frame 2, -1 = none (v4: +0x50) */
  actionFrame2: 0x30,
  /**
   * Container of the NEXT segment's header, 0 on the last — v4 keeps the same
   * pointer at its header +0x2c. Followed only when playback stopped ON the
   * last frame (0x404b9c); a mid-film exit ends the whole film.
   */
  nextSegment: 0x36,
  palette: 0x3e,
  /** the frame table — DF.EXE's own base (0x40484d), 80 bytes a record */
  frames: 0x8c2,
} as const;

const PALETTE_SIZE = 256 * 8;
const FRAME_SIZE = 80;
/** the frame record fields — each offset is an engine read, see the module comment */
const FRAME = {
  /** +0x00 — how many hotspot records this frame owns at {@link FRAME.hotspots} */
  count: 0x00,
  hold: 0x02,
  waitFlags: 0x06,
  action: 0x16,
  target: 0x18,
  flags2: 0x1a,
  picture: 0x1c,
  sound: 0x20,
  hotspots: 0x24,
  chain: 0x30,
} as const;
/** the +0x30 pstr runs to the record's end at +0x50 */
const CHAIN_NAME_MAX = 31;

/**
 * Bits of record +0x06. NOT flags the engine reads — see the module comment;
 * they behave as "this is the last frame" and "this is the first frame".
 *
 * Only `voice` is still read, and only as one half of `waitsForVoice`. The
 * click bits are kept named rather than deleted because what they are NOT is
 * the finding: they are what `waitsForClick` used to come from, and #324 is
 * what that cost.
 */
const WAIT = { voice: 1, click: 2, clickAlt: 8 } as const;

/** bits of record +0x1a, each one an engine read (see the module comment) */
const MORE = {
  /** bit 0 — block on the sound channel before advancing (0x429bd0) */
  holdForSound: 1,
  /** bit 1 — load the container range at +0x0a..+0x0e (0x406bc0) */
  preload: 2,
  /** bit 2 — do not stop for this frame's hotspots without a click in hand */
  playsThroughHotspots: 4,
  /** bit 3 — with `preload`, load after the blit rather than before it */
  preloadAfterBlit: 8,
  /** bit 4 — step to the next frame, ignoring the action. Unused on this disc */
  step: 0x10,
} as const;

/** hotspot record sizes by type — DF.EXE's stride table at 0x405450 */
const HOTSPOT_SIZE: Record<number, number> = {
  1: 0xe,
  2: 0x10,
  3: 0x2e,
  4: 0x30,
  5: 0xe,
};
const HOTSPOT = { type: 0, top: 2, sound: 0xa, target: 0xe } as const;

export function readMovFileV1(data: Uint8Array): MovFileV1 {
  const file = readContainerFile(data);
  const c0 = file.containers[0].data;
  const version = versionOf(c0);
  if (version !== 1) {
    throw new Error(
      `not a DreamFactory 1 MOV (container 0 says version ${version})`,
    );
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

  /** one segment, read from its own header container */
  const readSegment = (
    bias: number,
  ): { segment: MovSegmentV1; next: number } => {
    const cs = file.containers[bias].data;
    const vs = new DataView(cs.buffer, cs.byteOffset, cs.byteLength);
    const at16 = (o: number): number =>
      o >= 0 && o + 2 <= cs.length ? vs.getInt16(o, true) : 0;
    const at32 = (o: number): number =>
      o >= 0 && o + 4 <= cs.length ? vs.getInt32(o, true) : 0;
    if (cs.length < C0.palette + PALETTE_SIZE) {
      warnings.push(`segment c${bias} is too short to hold a palette`);
    }
    const count = vs.getInt16(C0.frameCount, true);
    if (count < 1 || count > 4096)
      warnings.push(`segment c${bias}: implausible frame count ${count}`);

    /**
     * A hotspot RUN, walked from an offset to the first record whose type is
     * not 1..5 (or the container's end) — the engine's own scan order, first
     * hit wins, which is why a run may sail on into the records of a later
     * frame's run: ARMOPEN's first frame does, and its two boxes tile the whole
     * picture so nothing below them is reachable. Memoised because frames of
     * one phase share a run.
     */
    const runs = new Map<string, MovHotspotV1[]>();
    const hotspotRun = (from: number, want: number): MovHotspotV1[] => {
      const key = `${from}:${want}`;
      const have = runs.get(key);
      if (have) return have;
      const list: MovHotspotV1[] = [];
      let at = from;
      while (list.length < want && at >= 0 && at + 2 <= cs.length) {
        const rawType = vs.getInt16(at, true);
        const type = Math.abs(rawType);
        const size = HOTSPOT_SIZE[type];
        if (!size || at + size > cs.length) break;
        const soundRef = size > HOTSPOT.sound ? at16(at + HOTSPOT.sound) : 0;
        list.push({
          type,
          top: at16(at + HOTSPOT.top),
          left: at16(at + HOTSPOT.top + 2),
          bottom: at16(at + HOTSPOT.top + 4),
          right: at16(at + HOTSPOT.top + 6),
          sound: soundRef > 0 ? bias + soundRef : 0,
          target: type === 2 ? at16(at + HOTSPOT.target) : 0,
          record: at,
        });
        at += size;
      }
      runs.set(key, list);
      return list;
    };

    const frames: MovFrameV1[] = [];
    for (let i = 0; i < count; i++) {
      const o = C0.frames + i * FRAME_SIZE;
      const ref = at16(o + FRAME.picture);
      const picLoc = ref + bias;
      if (ref < 1 || picLoc >= file.containers.length || !picture(picLoc)) {
        warnings.push(
          `segment c${bias} frame ${i + 1}/${count}: c${picLoc} is not a picture`,
        );
        break;
      }
      const waitFlags = at16(o + FRAME.waitFlags);
      const soundRef = at32(o + FRAME.sound);
      const nameLen = cs[o + FRAME.chain] ?? 0;
      let chainTo = "";
      if (
        nameLen >= 1 &&
        nameLen <= CHAIN_NAME_MAX &&
        o + FRAME.chain + 1 + nameLen <= cs.length
      ) {
        const s = String.fromCharCode(
          ...cs.subarray(o + FRAME.chain + 1, o + FRAME.chain + 1 + nameLen),
        );
        // only a type-3 exit reads the field; on other records it is heap garbage
        if (at16(o + FRAME.action) === 3 && /^[\x20-\x7e]+$/.test(s))
          chainTo = s;
      }
      const hotspotOffset = at16(o + FRAME.hotspots);
      const hotspotCount = at16(o + FRAME.count);
      const flags2 = at16(o + FRAME.flags2);
      frames.push({
        picture: picLoc,
        holdTicks: at32(o + FRAME.hold),
        waitsForVoice: (waitFlags & WAIT.voice) !== 0,
        waitsForClick:
          hotspotCount > 0 && (flags2 & MORE.playsThroughHotspots) === 0,
        hotspotCount,
        action: at16(o + FRAME.action),
        target: at16(o + FRAME.target),
        flags2: at16(o + FRAME.flags2),
        holdsForSound: (at16(o + FRAME.flags2) & MORE.holdForSound) !== 0,
        sound: soundRef === 0 ? 0 : bias + Math.abs(soundRef),
        hotspotOffset,
        chainTo,
        record: o,
        regions:
          hotspotCount > 0 && hotspotOffset > 0 && hotspotOffset < cs.length
            ? hotspotRun(hotspotOffset, hotspotCount)
            : [],
      });
    }
    if (!frames.length)
      warnings.push(
        `segment c${bias}: no frame table at 0x${C0.frames.toString(16)}`,
      );

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
        bed: [],
        actionFrame1: vs.getInt16(C0.actionFrame1, true),
        actionFrame2: vs.getInt16(C0.actionFrame2, true),
      },
      next,
    };
  };

  // Follow the chain, guarding against a pointer that loops: the last segment's
  // `next` is 0, and 0 is where we started.
  const segments: MovSegmentV1[] = [];
  const seen = new Set<number>();
  for (let at = 0; at >= 0 && at < file.containers.length && !seen.has(at);) {
    seen.add(at);
    const { segment, next } = readSegment(at);
    segments.push(segment);
    at = next;
  }

  // pictures no segment names — see MovFileV1.unaccounted
  const named = new Set(
    segments.flatMap((sg) => sg.frames.map((f) => f.picture)),
  );
  let unaccounted = 0;
  for (let i = 1; i < file.containers.length; i++)
    if (!named.has(i) && picture(i)) unaccounted++;

  /**
   * The audio: whatever a segment owns and its frame table does not name as a
   * picture. A chunk belongs to the LAST header before it, which is the same
   * bias-relative arrangement the pictures and the sound refs use — see
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

  // the BED: what a segment owns and neither a frame nor a click references
  for (const sg of segments) {
    const referenced = new Set<number>();
    for (const f of sg.frames) {
      if (f.sound) referenced.add(f.sound);
      for (const r of f.regions) if (r.sound) referenced.add(r.sound);
    }
    sg.bed = sg.audioChunks.filter((c) => !referenced.has(c));
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

/** the floor when a segment header names no frame rate — the engine's own
 *  shipped `framerate(3)`, which is what most of the disc asks for anyway */
export const MOV_V1_HOLD_TICKS = 3;

/**
 * Composite one decoded v1 frame over the one on screen: indices 0 and 255 are
 * TRANSPARENT — the previous picture shows through them.
 *
 * That is DF.EXE's own movie blit (fn 0x421b40), read to its end. Per 16-row
 * band it (1) saves the band and rewrites every 0xff byte to 0 IN the decode
 * buffer, (2) paints the band to a work surface, (3) builds a monochrome mask
 * of it with `SetBkColor(PALETTEINDEX(0))` — 1 exactly where the band is
 * palette-index-0, which is now "was 0 or 0xff" — (4) restores the decode
 * buffer's 0xff bytes (the buffer doubles as the delta-codec's previous-image
 * state, which is the whole reason for the save/restore), and (5) composites
 * through the mask with a `0x660046` SRCINVERT BitBlt — the classic GDI
 * transparent blit. The WinG path ([0x45c7c0], installed when WING32.DLL
 * loads) replaces the GDI choreography, not the keying.
 *
 * The films are authored against it: ARMOPEN.MOV's wait frames are solid 0xff
 * (hold the open armoire while the player decides), BELL.MOV's redraw the bell
 * and flood the other 60% of the picture with 0xff (hold the scene around it).
 * Rendered opaque they were "completely white" (the port's palette put white at
 * 255, Windows' own reserved entry), and rendered as palette entry 0 they were
 * completely black; both reports were this composite missing.
 *
 * The first frame of a segment has no previous picture here; its key pixels
 * keep their raw index and the palette alias in {@link movFileFromV1} paints
 * them as entry 0 — the original composed them over a screen the scripts had
 * already `blackscreen()`ed.
 */
export function compositeFrameV1(
  pixels: Uint8Array,
  prev: Uint8Array | null,
): void {
  if (!prev || prev.length !== pixels.length) return;
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i];
    if (p === 0 || p === 255) pixels[i] = prev[i];
  }
}

/** v1 action/hotspot numbering -> mov.ts's (which is TI.EXE's): the codes are
 *  the same codes — 1 exit, 2 goto, 3 exit+chain, 4 call, 5 return — v4 just
 *  names its goto/chain destinations where v1 numbers or inlines them */
const ACTION_FALLBACK = 6;

/**
 * A v1 movie in the shape {@link file://./mov.ts} defines, so the movie player
 * plays it without knowing.
 *
 * Everything carries over onto v4's own machinery, because it IS the same
 * machine: frames are named their 1-based position, so a v1 goto target of
 * `n` (0-based) becomes v4's "go to the frame named" `String(n + 1)`, the
 * action frames become names the same way, frame and click sounds become event
 * sounds keyed by container number, and a type-3 chain is v4's own type 3 —
 * exit and chain, no return (the module comment has the engine's word on it).
 * A frame that answers clicks without stopping for them — every v1 animation
 * frame with a live hotspot run — is v4's `playsThroughRegions`, and a frame
 * that stops is a plain region wait.
 */
export function movFileFromV1(v1: MovFileV1): MovFile {
  const segments: MovSegment[] = v1.segments.map((sg) => {
    // every sound the segment owns, named by its container number — what frame
    // and hotspot refs (already absolute) resolve through the player's own map
    const sounds = new Map<string, number>();
    for (const c of sg.audioChunks) sounds.set(String(c), c);
    /*
     * Entry 255 is the film's own colour, and it is usually WHITE.
     *
     * This used to alias entry 255 onto entry 0 — "DF.EXE's blit rewrites every
     * 0xff pixel to 0" — reasoning that 0xff is transparent and a segment's first
     * frame has nothing under it to show through. The first half is right, and it
     * is handled where it belongs: {@link compositeFrameV1} keys 0xff at decode,
     * so a DELTA frame holds the picture before it.
     *
     * The second half was wrong. A segment's first frame is a KEYFRAME: nothing is
     * being held, so 0xff there is not transparency but a colour, and the palette
     * says which — 255,255,255. Aliasing it to entry 0 painted every one of those
     * pixels black. Six segments on the disc carry enough of them to see it at a
     * glance: INTRO3's sun (9.2% of the frame) became a black hole in a purple
     * sky, DOCTCHES's and DOCTBONE's anatomy charts lost their paper, and PAPER1-3
     * are newspapers. Rendered both ways side by side, all six are right as white
     * and wrong as black.
     *
     * It went unseen because those films were also frozen on frame 0 for an
     * unrelated reason (mov-pace.stepsForward), so the only picture anyone saw of
     * them was the keyframe this broke.
     *
     * So: passed through untouched. `paletteToRGBA`'s reserve — 0 black, 255 white
     * — already says the same thing.
     */
    const paletteRaw = sg.paletteRaw.slice();
    const count = sg.frames.length;
    const frameName = (idx0: number): string =>
      String(Math.max(0, Math.min(count - 1, idx0)) + 1);
    return {
      file: v1.file,
      bias: sg.bias,
      width: sg.width,
      height: sg.height,
      originX: 0,
      originY: 0,
      paletteRaw,
      frames: sg.frames.map((f, i): MovFrame => {
        const last = i === count - 1;
        // 1 exit: from the last frame that is the segment's exit (v4 type 1 —
        // the chain at header +0x36 continues); anywhere else the whole film
        // ends (0x404b9c clears the pointer), which is v4's type 3 with no
        // movie to chain to. 2 goto: the target by name. 3: exit + chain.
        // 5: return — the BELL day-variants end on one, and v4's case 5 pops
        // the call stack or finishes, both right for a film a script started.
        let type: number;
        let target = "";
        let event = "";
        switch (f.action) {
          case 1:
            type = last ? 1 : 3;
            break;
          case 2:
            type = 2;
            target = frameName(f.target);
            break;
          case 3:
            type = 3;
            event = f.chainTo;
            break;
          case 4:
          case 5:
            type = f.action;
            break;
          default:
            type = ACTION_FALLBACK;
        }
        return {
          type,
          height: sg.height,
          width: sg.width,
          locationFrame: f.picture,
          // no logic container: a v1 frame keeps its logic inline (see FRAME), and 0
          // is what mov.ts reads as "there is none" (container 0 is always a header)
          locationClickRegion: 0,
          record: f.record,
          name: String(i + 1),
          sound: f.sound ? String(f.sound) : "",
          event,
          target,
          regions: f.regions.map((r) => ({
            // the same codes again; a type-2 hotspot is v4's "goto the frame
            // named target", sound and all
            type:
              r.type === 2
                ? 2
                : r.type >= 1 && r.type <= 5
                  ? r.type
                  : ACTION_FALLBACK,
            target: r.type === 2 ? frameName(r.target) : "",
            // stored top/left/bottom/right, Y first — mov.ts keeps the same order
            y0: r.top,
            x0: r.left,
            y1: r.bottom,
            x1: r.right,
            sound: r.sound ? String(r.sound) : "",
            event: "",
            record: r.record,
          })),
          holdTicks: f.holdTicks,
          /*
           * v4's "hold until this movie's own sounds are done" is DF1's +0x1a
           * bit 0, which is the flag the engine really tests (0x404ab0 ->
           * 0x429bd0) and the one 69 segments are timed by — DOG1.MOV waits out
           * each growl before the next snarl, MAYOREND.MOV waits out the
           * mayor's speech instead of ending 46 s early.
           *
           * OR-ed with the +0x06 reading rather than replacing it. That one is
           * not a flag the engine reads at all (module comment), but what it
           * amounts to — "this is the last frame" — still keeps a final line
           * from being cut on ten films, DIEH3 and WELLGUN among them, and
           * dropping it would trade one class of clipped sound for another.
           */
          waitsForVoice: f.waitsForVoice || f.holdsForSound,
          holdsDeadline: false,
          // a hotspot run is live on every frame that carries one; only the
          // wait bit stops the picture for it (the module comment's skippable
          // animations) — v4's flag is the same idea from the other side
          playsThroughRegions: !f.waitsForClick,
        };
      }),
      // a v1 frame is NAMED its 1-based position and the header's action frame
      // is a 0-BASED index, so the name the player resolves is one more
      actionFrame1: sg.actionFrame1 >= 0 ? String(sg.actionFrame1 + 1) : "",
      actionFrame2: sg.actionFrame2 >= 0 ? String(sg.actionFrame2 + 1) : "",
      flags: 0,
      keySkips: true,
      minHoldTicks: sg.framerate,
      // only the BED plays from the segment's start — the chunks frames and
      // clicks reference fire as event sounds through `sounds` above
      audioChunks: sg.bed,
      // NOT a loop. v4's chunks come out of a loop-ORDER table whose tail usually
      // repeats, so `audioLoops` is true there whenever there are chunks at all; a
      // v1 segment's bed is a plain run of containers, played once under the
      // picture.
      audioLoops: false,
      sounds,
      soundFollows: new Map(),
      cues: [],
      // the blit rules of {@link compositeFrameV1} and the palette alias above
      dfV1: true,
    };
  });
  return Object.assign(segments[0], { segments }) as MovFile;
}
