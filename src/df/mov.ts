import { BinaryReader, pstrAtChecked, writeNameAt } from "./binary";
import { readLoopChunks, readOneShotChunks } from "./banks";
import { DFContainerFile, patchContainerData, readContainerFile } from "./container";

/**
 * MOV files — cutscenes, item close-ups, clickable multi-frame objects.
 * Frames use the SET delta codec (decode in order with a shared FrameBuffer).
 *
 * Playback semantics recovered from TI.EXE's movie interaction loop
 * (fn at 0x449310): a movie is a frame state machine. Each frame's
 * click-region container carries a TYPE word plus optional event/target
 * strings; the same type codes drive both frames (auto-action when the frame
 * has no regions) and regions (action on click):
 *   1 = exit the movie
 *   2 = go to the frame named `target`
 *   3 = exit + chain to the movie named `event`
 *   4 = push (this movie, `target` frame) on the return stack, chain to `event`
 *   5 = pop the return stack and resume there (max depth 5 in the original)
 *   6 = advance one frame            7 = step back one frame
 * A frame WITH regions waits modally for a click; clicks outside all regions
 * do nothing. The i16 at record+6 (an "action" flag in earlier guesses) is
 * never read by the engine. Region coords are Y-first (top,left,bottom,right).
 *
 * A file is a chain of SEGMENTS, not one film. Header +0x2c is the container
 * index of the NEXT segment's header (0 = last), and everything in a segment
 * — palette, frame table, audio tables, cue table, every stored container
 * location — is its own, with locations relative to its header's index. The
 * demo build's movie loop plays them back to back (0x449bb7: exit reloads
 * `[0x488584] = hdr+0x2c` and re-enters setup; every container fetch adds
 * that bias), halting only the event channel between segments; a segment
 * whose loop table has no records (0x44956f) INHERITS the still-playing bed
 * of the one before it. A type-1 "exit" therefore ends the segment, and only
 * the last segment's exit ends the movie. ESC ends the whole chain (state 2
 * clears the next-segment pointer), as does a type-3 chain-out. The demo's
 * TRAILER.MOV is 13 segments (698 frames — the port played 139 and was
 * reported "cut way too soon"), TOUR.MOV is 20 (a narrated slideshow, one
 * segment per slide), and the full game's SINK1..6, LEAVE, DEBRIS and LOGO
 * are multi-segment too.
 *
 * Each segment also carries a CUE table (header +0x68): records of
 * {i32 tick, i32 flags, i32 adjustedTick, pstr(15) frame} that fire ONCE when
 * the segment-relative clock passes `tick` (units of 50/3 ms), jumping
 * playback to the named frame out of ANY wait — a hold, or even a region
 * frame's modal wait (0x44ae90, polled from both wait loops). The stored
 * adjustedTick is `tick - frameBytes*60/((hdr+0x28 || 300)<<10)` — the
 * authored tick minus a CD-streaming lead computed at load (hdr+0x28 is the
 * drive's KB/s); a port with pre-decoded frames wants the authored tick.
 * TOUR.MOV's first segment is the only cue user in any tree: its frame 6 is
 * an authored backward goto (5<->6, the ship's-logo loop) and the cue
 * `tick 200 -> "Name 12"` is what pulls playback out of it 3.33 s in —
 * without it the film sits on the logo forever ("seems to not advance").
 */

export interface MovClickRegion {
  /** action type 1..7 (see module comment) */
  type: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** event sound played on click (page rustle etc.), "" = none */
  sound: string;
  /** movie chained to by types 3/4, "" = none */
  event: string;
  /** frame name jumped to by types 2/4, "" = none */
  target: string;
  /** byte offset of this 64-byte record in the frame's click-region container
   *  (edit target — see {@link patchRegionRect} / {@link patchRegionLogic}) */
  record: number;
}

export interface MovFrame {
  /** auto-action type 1..7 applied when the frame has no regions */
  type: number;
  height: number;
  width: number;
  locationFrame: number;
  name: string;
  /** event sound fired when playback enters this frame (faucet on/off) */
  sound: string;
  /** movie chained to by frame types 3/4, "" = none */
  event: string;
  /** frame name jumped to by frame types 2/4, "" = none */
  target: string;
  /** click regions — playback waits on frames that have any */
  regions: MovClickRegion[];
  /**
   * How long this frame is HELD, in ticks of 50/3 ms (60 a second), from the
   * logic container's i32 at +2. The engine's deadline is
   * `max(holdTicks, MovFile.minHoldTicks)`, so a movie's floor can only make a
   * frame longer — read out of the demo build's movie loop at 0x44b10f, where
   * `mov edx, [ecx + 2]` is the frame's and `[hdr + 0x1c]` the movie's.
   *
   * Measured against films whose length is known from their soundtrack: berg.mov
   * computes 35.3 s against 40.0 s of audio, leave.mov 5.2 s against 5.6 s. Most
   * frames carry 0 (take the floor) or 20 (333 ms).
   */
  holdTicks: number;
  /**
   * Don't advance until the VOICE channel is idle (flags bit 0).
   *
   * `0x44a8e0` in the demo build: `test byte ptr [eax + 6], 1`, and if set it
   * spins on `voicedone` — interruptibly — before the frame may pass. Rare and
   * deliberate: one frame of `tour.mov` (8) and one of `leave.mov` (68), the
   * latter being exactly the film whose spoken line is known to outlive its last
   * frame.
   */
  waitsForVoice: boolean;
  /**
   * Don't reset the frame deadline to "now" (flags bit 3) — add to the one
   * already running, so a long film does not drift a frame's worth per frame.
   * `ocredits.mov` sets it on 1224 of its 1225 frames.
   */
  holdsDeadline: boolean;
  /**
   * Don't WAIT on this frame's click regions (flags bit 2) — honour them only if
   * a click is already in hand, else run the frame's own action and play on. An
   * animation you may click through, rather than a picture that stops for one.
   *
   * Retail `0x44979f`, right before the region count is read from `+0x442`:
   *
   * ```
   * 0x44979f: test byte ptr [edx + 6], 4  ; bit 2
   * 0x4497a3: mov  ecx, [ecx + 0x442]     ; the region COUNT
   * 0x4497a9: je   0x4497b2               ; clear -> the count stands, wait modally
   * 0x4497ab: test ax, ax                 ; set: has the pump a click?
   * 0x4497ae: jne  0x4497b2               ;   yes -> honour the region
   * 0x4497b0: xor  ecx, ecx               ;   no  -> ZERO it: do not wait
   * 0x4497b4: jg   0x4497da               ; count > 0 ? region path : frame's own action
   * ```
   *
   * 2028 frames across the six editions set it, 2022 of them carrying regions,
   * in seven movies: `camelsee.mov` and `camride.mov` (the Cairo camel ride),
   * `aftwash.mov`, `portwash.mov`, `starwash.mov`, `smfire.mov` and `lofire.mov`.
   * Their loops are authored as a backward `goto` on the last frame of the cycle
   * — `camelsee.mov` frames 41..44 each jump to frame 1, and 41 is the one the
   * gallop reaches — which only runs because falling through the zeroed count
   * lands on the frame's own action.
   */
  playsThroughRegions: boolean;
  /**
   * Container holding this frame's logic — its type, its three names and its
   * region table. 0 (or a missing container) means the frame has none: a plain
   * animation frame, which plays and advances, and which no logic edit can
   * touch until the file gives it a container to write into.
   */
  locationClickRegion: number;
  /** byte offset of this 42-byte record in container 0's frame table (edit
   *  target — see {@link patchFrameName}) */
  record: number;
}

/** one timed jump — see the module comment's cue-table paragraph */
export interface MovCue {
  /** segment-relative deadline in ticks of 50/3 ms (the AUTHORED tick at +0,
   *  not the stream-lead-adjusted one at +8) */
  tick: number;
  /** the frame playback jumps to when the deadline passes */
  target: string;
}

/**
 * One segment of a movie file — a self-contained film with its own header,
 * palette, frames, audio and cues. `MovFile` IS its first segment (the fields
 * below on a MovFile are segment 0's), and `MovFile.segments` the whole chain.
 */
export interface MovSegment {
  /**
   * The container file this segment lives in. Every segment carries it so a
   * patch can be addressed to a SEGMENT rather than to the file plus an index:
   * `patchKeySkips(mov.segments[2], false)` writes segment 2's header, and
   * `patchKeySkips(mov, false)` writes the first segment's, because a MovFile
   * IS its first segment.
   */
  file: DFContainerFile;
  /** container index of this segment's header — the bias every location in
   *  the segment is stored relative to (0 for the first segment), and the
   *  container every header-level patch below writes into. The parsed
   *  locations elsewhere in this record are already absolute. */
  bias: number;
  width: number;
  height: number;
  /**
   * Where the picture sits on the 512×384 screen (header +0x24/+0x26, x then
   * y) — the engine draws the frame there and subtracts it from the mouse
   * before region hit-testing (0x44ad08). The full game's movies are
   * full-screen at (0,0); the demo's 512×264 letterboxed cutscenes are the
   * users: trailer.mov and open.mov centre themselves with (0,60), 60 px of
   * black above and below.
   */
  originX: number;
  originY: number;
  paletteRaw: Uint8Array;
  frames: MovFrame[];
  /**
   * Names of the movie's two "action frames" (container-0 header +0x40 / +0x50,
   * each a pstr(15); "" = none). The engine's `actionframe(n)` opcode reports
   * whether playback passed through the frame named here for n: +0x40 -> n=1,
   * +0x50 -> n=2. Resolved to frame indices and tracked during playback.
   * (Recovered from TI.EXE: impl 0x4277e0 reads the sticky flag word at
   * 0x48a722 that the movie loop OR-sets at 0x448d95/0x448daa when the current
   * frame index matches findFrameByName(base+0x40)/(base+0x50).)
   */
  actionFrame1: string;
  actionFrame2: string;
  /**
   * Header flag word (container-0 +0x18) — per-movie playback options.
   *
   * Bit 0 ({@link keySkips}) is the one that matters: it lets ESC abort the
   * movie. Bit 2 selects an alternate frame blit (TI.EXE 0x438900 instead of
   * 0x438850); only bombhelp/aftwash/portwash/starwash set it and we don't
   * distinguish the two paths. Bit 3 ({@link FLAG_ANY_INPUT_ABORTS}) lets any
   * key or click abort the movie (tested at TI.EXE 0x44a13f, which peeks the
   * event queue for a keydown or a mousedown and breaks the frame wait), and it
   * is also what spares a movie the flush it otherwise does on its way out
   * (0x449330). No movie in the corpus sets it: read across the whole tree, all
   * 314 distinct (movie, segment flags) pairs are 0x01, 0x03 or 0x05. So in
   * TAOOT both of the movie player's queue flushes always run, and a key pressed
   * BEFORE a movie began cannot skip it.
   */
  flags: number;
  /**
   * ESC aborts this movie (flags bit 0).
   *
   * All 218 distinct movies in the corpus set it, so in practice every movie
   * is skippable — but it is authored per movie, so we read it rather than
   * assume it. See {@link MoviePlayer.skip} for what aborting does.
   */
  keySkips: boolean;
  /**
   * The fewest ticks any frame of this movie is held for (container-0 header
   * +0x1c) — the film's own frame rate, and a FLOOR rather than a cap:
   * `max(frame.holdTicks, this.minHoldTicks)`. Measured across the corpus it is
   * 2, 3 or 4 ticks — 33, 50 or 67 ms, i.e. 30, 20 or 15 fps.
   */
  minHoldTicks: number;
  /**
   * The scored BED: the loop table's chunk container locations in playback
   * order, empty when the segment carries none. This is the only audio the
   * engine starts by itself (0x426170, at segment start); everything in the
   * one-shot table ({@link sounds}) fires from a frame or a region and from
   * nowhere else. A segment with an empty bed INHERITS the playing one.
   */
  audioChunks: number[];
  /** the segment has a bed of its own — `audioChunks.length > 0`, kept for
   *  the call sites that read as prose */
  audioLoops: boolean;
  /** named one-shot chunks (frame-entry and region-click event sounds,
   *  FAUCET.MOV's "Brook Babbling." among them), lowercase */
  sounds: Map<string, number>;
  /**
   * A one-shot sound may name the frame to jump to WHEN IT FINISHES: sound name
   * (lowercase) -> frame name, from the second name field of its table record.
   * That jump comes due out of any wait, a region frame's modal one included, so
   * a spoken line can carry the picture on by itself (see {@link
   * MoviePlayer.tick}).
   *
   * TI.EXE 0x44ad39: the frame's sound player ends by storing
   * `findFrameByName(record + 0x1a)` in the pending-jump global and copying the
   * sound's own name beside it; the poll every wait loop runs (0x44a7f5) compares
   * that name against what the sound channel is playing and, once it no longer
   * matches, makes the stored frame current. A sound with no follow-on clears the
   * pending jump — which is what a movie interrupts its own chain with.
   *
   * TAOOT's `bedcards.mov` is the only user in the corpus, in all six editions:
   * the pocket watch's monologue is five chunks over one still
   * (01 -> "blah1" -> 02 … 07 -> "endwatch"), and without this the port played
   * the first 7 s and sat there.
   */
  soundFollows: Map<string, string>;
  /** timed jumps, in file order — fired once each as the segment clock passes
   *  them (empty for every shipped movie but the demo's TOUR.MOV) */
  cues: MovCue[];
  /**
   * A DreamFactory 1 film, which draws by DF.EXE's blit rules: palette index
   * 255 is entry 0 and indices 0/255 are transparent over the previous frame
   * (mov-v1.ts's compositeFrameV1 has the disassembly). Set by
   * {@link file://./mov-v1.ts}; the player keys and aliases only when it is.
   */
  dfV1?: boolean;
}

export interface MovFile extends MovSegment {
  /**
   * The whole film: segments played back to back (header +0x2c chains them —
   * see the module comment). `segments[0]` is this object itself, so a
   * single-segment movie reads exactly as it always did.
   */
  segments: MovSegment[];
}

/** a segment's header container (container 0 = the first segment's): the
 *  header, the palette, and the frame table. All stored container locations
 *  are relative to this container's own index. */
const C0 = {
  version: 0x02,
  flags: 0x18,
  actionFrame1: 0x40,
  actionFrame2: 0x50,
  /** i32 minimum ticks a frame is held — the movie's own frame rate floor */
  minHold: 0x1c,
  /** i32 container index of the NEXT segment's header, 0 = last */
  nextSegment: 0x2c,
  /** i16 x, i16 y: where the picture sits on screen (see MovSegment.originX) */
  origin: 0x24,
  /** i32 location of the one-shot (event/voice) chunk table */
  audioLocation: 0x60,
  /** i32 location of the loop-chunk table — the scored bed. Container 1 in
   *  every shipped first segment, but the engine reads it from here
   *  (0x449477 in the demo build), and later segments point elsewhere. */
  loopLocation: 0x64,
  /** i32 location of the cue table (timed jumps; see module comment) */
  cueLocation: 0x68,
  palette: 0x6c,
  size: 0x870,
  frameCount: 0x878,
  frames: 0x87c,
  frameSize: 42,
} as const;

/** the cue table: {i32 count} then `count` 28-byte records */
const CUE = {
  records: 4,
  recordSize: 28,
  /** i32 authored deadline, in ticks of 50/3 ms from segment start */
  tick: 0,
  /** pstr(15) target frame name (+4 is a fired flag, +8 the load-time
   *  stream-lead-adjusted tick — both runtime state, not authoring) */
  name: 12,
} as const;

/** one 42-byte frame record in that table */
const FRAME = {
  height: 8,
  width: 10,
  locationFrame: 12,
  locationClickRegion: 16,
  name: 26,
} as const;

/** a frame's logic container: its own action, its three names, its regions */
const LOGIC = {
  type: 0,
  /**
   * i32 ticks this frame is HELD for — the movie's own authored pacing, and the
   * thing the port spent years without (it derived a frame rate from the
   * soundtrack instead). One tick is 50/3 ms; see MovFrame.holdTicks.
   */
  hold: 2,
  /** per-frame flag bits — see MovFrame.waitsForVoice / holdsDeadline */
  flags: 6,
  sound: 0x12,
  event: 0x22,
  target: 0x32,
  /** the shortest logic container the reader will trust */
  minSize: 0x42,
  regionCount: 1090,
  regions: 1094,
  regionSize: 64,
} as const;

/** one 64-byte region record (coordinates Y-first, as everywhere) */
const REGION = {
  type: 0,
  top: 8,
  sound: 16,
  event: 32,
  target: 48,
} as const;

/** characters that fit the name fields (the length byte is not counted) */
export const MOV_NAME_FIELD = 15;

/** header flag bit 0: ESC (and Ctrl+Q) aborts this movie */
export const FLAG_KEY_SKIPS = 1;

/** header flag bit 3: any key or click aborts, and the exit flush is skipped */
export const FLAG_ANY_INPUT_ABORTS = 8;

/** the action codes a frame or a region can carry, and what each does */
export const MOV_ACTIONS: Record<number, string> = {
  1: "exit the movie",
  2: "go to the target frame",
  3: "exit and chain to the event movie",
  4: "push (this movie, target) and chain to the event movie",
  5: "pop the return stack and resume",
  6: "advance one frame",
  7: "step back one frame",
};

export function readMovFile(data: Uint8Array): MovFile {
  const file = readContainerFile(data);
  const segments: MovSegment[] = [];
  const seen = new Set<number>();
  let bias = 0;
  // walk the segment chain; the seen-set guards a malformed self-referencing
  // +0x2c from looping the reader (the engine would loop the PLAYER instead)
  while (!seen.has(bias) && bias >= 0 && bias < file.containers.length) {
    seen.add(bias);
    const { segment, next } = readSegment(file, bias);
    segments.push(segment);
    bias = next;
    if (!next) break;
  }
  // MovFile IS its first segment, so segments[0] and the file share identity
  // (edits through either view stay coherent)
  return Object.assign(segments[0], { segments }) as MovFile;
}

/** parse the segment whose header sits at container `bias` */
function readSegment(file: DFContainerFile, bias: number): { segment: MovSegment; next: number } {
  const c0 = file.containers[bias].data;
  const r = new BinaryReader(c0);

  r.seek(C0.version);
  if (r.i32() !== 4) throw new Error("unsupported DreamFactory MOV version (need 4.0)");

  r.seek(C0.flags);
  const flags = r.i32();
  r.seek(C0.minHold);
  const minHoldTicks = r.i32();
  r.seek(C0.nextSegment);
  const next = r.i32();
  r.seek(C0.origin);
  const originX = r.i16();
  const originY = r.i16();

  // action-frame names for the actionframe() opcode (see MovFile.actionFrame1)
  r.seek(C0.actionFrame1);
  const actionFrame1 = r.pstr(MOV_NAME_FIELD);
  r.seek(C0.actionFrame2);
  const actionFrame2 = r.pstr(MOV_NAME_FIELD);

  r.seek(C0.audioLocation);
  const audioLocation = r.i32();
  r.seek(C0.loopLocation);
  const loopLocation = r.i32();
  r.seek(C0.cueLocation);
  const cueLocation = r.i32();
  const paletteRaw = c0.subarray(C0.palette, C0.palette + 256 * 8);

  r.seek(C0.size);
  const height = r.i16();
  const width = r.i16();
  r.skip(4);
  const frameCount = r.i32();

  const frames: MovFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    const record = C0.frames + i * C0.frameSize;
    r.seek(record);
    r.skip(4); // frame-table kind — authoring metadata, the engine ignores it
    r.skip(4); // 2 unknown words
    const h = r.i16();
    const w = r.i16();
    // stored relative to the segment's own header container; keep them
    // absolute so nothing downstream needs to know which segment it is in
    const locationFrame = r.i32() + bias;
    const rawClickRegion = r.i32();
    const locationClickRegion = rawClickRegion ? rawClickRegion + bias : 0;
    r.skip(2);
    r.skip(4); // frame container size
    const name = r.pstr(MOV_NAME_FIELD);

    // the click-region container drives playback: type word at +0, frame
    // event sound at +0x12, event movie at +0x22, target frame name at
    // +0x32, region table at +1090
    let type = 6;
    let holdTicks = 0;
    let frameFlags = 0;
    let sound = "";
    let event = "";
    let target = "";
    const regions: MovClickRegion[] = [];
    // A stored 0 means "no logic container", not "container 0": container 0 is
    // the file header in every DF format, so a frame pointing there has none and
    // keeps the default action (advance). Without this guard such a frame read
    // its type out of the header's first word — the fourCC's low half.
    const rd = locationClickRegion ? file.containers[locationClickRegion]?.data : undefined;
    if (rd && rd.length >= LOGIC.minSize) {
      const rv = new DataView(rd.buffer, rd.byteOffset, rd.byteLength);
      const pascal = (off: number, max: number): string => pstrAtChecked(rd, off, 1, max) ?? "";
      type = rv.getInt16(LOGIC.type, true);
      holdTicks = rv.getInt32(LOGIC.hold, true);
      frameFlags = rd[LOGIC.flags];
      sound = pascal(LOGIC.sound, MOV_NAME_FIELD);
      event = pascal(LOGIC.event, MOV_NAME_FIELD);
      target = pascal(LOGIC.target, MOV_NAME_FIELD);
      if (rd.length >= LOGIC.regions) {
        const count = rv.getInt32(LOGIC.regionCount, true);
        for (let g = 0; g < count; g++) {
          const off = LOGIC.regions + g * LOGIC.regionSize;
          if (off + LOGIC.regionSize > rd.length) break;
          regions.push({
            type: rv.getInt16(off + REGION.type, true),
            y0: rv.getInt16(off + REGION.top, true),
            x0: rv.getInt16(off + REGION.top + 2, true),
            y1: rv.getInt16(off + REGION.top + 4, true),
            x1: rv.getInt16(off + REGION.top + 6, true),
            sound: pascal(off + REGION.sound, MOV_NAME_FIELD), // event sound (page rustles etc.)
            event: pascal(off + REGION.event, MOV_NAME_FIELD), // movie chained to (types 3/4)
            target: pascal(off + REGION.target, MOV_NAME_FIELD), // frame jumped to (types 2/4)
            record: off,
          });
        }
      }
    }
    frames.push({
      type, height: h, width: w, locationFrame, name, sound, event, target, regions,
      locationClickRegion, record,
      holdTicks,
      waitsForVoice: (frameFlags & 1) !== 0,
      holdsDeadline: (frameFlags & 8) !== 0,
      playsThroughRegions: (frameFlags & 4) !== 0,
    });
  }

  // soundtrack: loop-chunk table at header +0x64 (container 1 on every
  // shipped FIRST segment; later segments point past their own bias) — same
  // layout as TRK banks. Chunk container locations are bias-relative too.
  const audioChunks: number[] = [];
  const loopLoc = loopLocation > 0 ? loopLocation + bias : 0;
  if (loopLoc > 0 && loopLoc < file.containers.length && file.containers[loopLoc].data.length >= 266) {
    audioChunks.push(...readLoopChunks(file.containers[loopLoc].data).map((c) => c.containerLoc + bias));
  }
  const audioLoops = audioChunks.length > 0;
  // One-shot chunks in the NON-looping block: named EVENT sounds, fired by
  // entering a frame or clicking a region and by nothing else — the engine has
  // no other path to them (its only auto-started audio is the loop chain,
  // 0x426170). This used to also serve as a play-once soundtrack when the
  // loop table was empty, which was a model, not a measurement: for the
  // single-chunk cutscenes it was built on, the chunk is ALSO frame 0's entry
  // sound, so the two are indistinguishable — until leave.mov's segment 2,
  // where the same rule played the smokestack falling at segment START and
  // again at its authored frame 57.
  //
  // A record is 42 bytes and holds TWO 15-char name fields, not one 31-char
  // one: the sound's own name, then the frame to jump to when it ends
  // ({@link MovSegment.soundFollows} — TI.EXE reads the second at record +0x1a).
  // Measured across all six editions: 2848 records, not one name longer than 15,
  // and 212 exactly 15 — BRNCL.MOV's "Burns Correctio" is the field's own
  // evidence, cut a character short of the word.
  const sounds = new Map<string, number>();
  const soundFollows = new Map<string, string>();
  const oneShotLoc = audioLocation > 0 ? audioLocation + bias : 0;
  if (oneShotLoc > 0 && oneShotLoc < file.containers.length) {
    const table = file.containers[oneShotLoc].data;
    for (const c of readOneShotChunks(table, MOV_NAME_FIELD, MOV_NAME_FIELD)) {
      if (!c.identifier) continue;
      const key = c.identifier.toLowerCase();
      sounds.set(key, c.containerLoc + bias);
      if (c.follow) soundFollows.set(key, c.follow);
    }
  }

  // the cue table: timed jumps out of whatever the segment is doing
  const cues: MovCue[] = [];
  const cueLoc = cueLocation > 0 ? cueLocation + bias : 0;
  if (cueLoc > 0 && cueLoc < file.containers.length) {
    const t = file.containers[cueLoc].data;
    if (t.length >= CUE.records) {
      const tv = new DataView(t.buffer, t.byteOffset, t.byteLength);
      const count = tv.getInt32(0, true);
      for (let i = 0; i < count; i++) {
        const off = CUE.records + i * CUE.recordSize;
        if (off + CUE.recordSize > t.length) break;
        cues.push({
          tick: tv.getInt32(off + CUE.tick, true),
          target: pstrAtChecked(t, off + CUE.name, 1, MOV_NAME_FIELD) ?? "",
        });
      }
    }
  }

  return {
    segment: {
      file, bias, width, height, originX, originY, paletteRaw, frames, actionFrame1, actionFrame2,
      flags, keySkips: (flags & 1) !== 0,
      minHoldTicks,
      audioChunks, audioLoops, sounds, soundFollows, cues,
    },
    next,
  };
}

// ---------------------------------------------------------------------------
// Edits — the write path of the movie editor (editors/movies.html)
// ---------------------------------------------------------------------------
// Only the LOGIC is editable, and every edit is a copy-on-write patch on one
// container: the frame names and the header fields in the SEGMENT's header
// container, a frame's action and its regions in that frame's own logic
// container.
//
// Every patch below is addressed to a MovSegment, not to the file: a movie is a
// chain of segments and each carries its own header, frame table, palette and
// action-frame slots (see the module comment). These used to hardcode container
// 0, which is only the FIRST segment's header — so an edit made while looking at
// a later segment wrote its frame name into segment 0's table, at the same
// record offset, silently renaming an unrelated frame. `seg.bias` is that
// segment's own header container, and 0 for the first, so a single-segment movie
// patches exactly where it always did.
//
// Frame ART is deliberately NOT editable, and that is a property of the codec
// rather than a missing feature. MOV frames are delta-encoded in ONE chain for
// the whole movie (decodeFrame against a shared FrameBuffer, run in order), so
// replacing frame N leaves frames N+1… decoding their deltas against a picture
// that is no longer there. A SET can do it because its chain unit is a single
// turn ring, self-contained by construction; a movie has no such unit, so a safe
// replacement would mean re-encoding the whole tail self-contained — on a corpus
// where LEAVE.MOV is already 37.5 MB. See tests/auto/mov-editor.ts, which pins
// the smear rather than just asserting the absence.

const i16clamp = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v)));

/** the strings a frame or a region carries: an event sound, a chained movie,
 *  a target frame. Undefined leaves a field as it is. */
export interface MovLogicFields {
  /** action code 1..7 ({@link MOV_ACTIONS}) */
  type?: number;
  /** event sound played on entry (a frame) or on click (a region) */
  sound?: string;
  /** movie chained to by types 3/4 */
  event?: string;
  /** frame name jumped to by types 2/4 */
  target?: string;
}

/** write a {type, sound, event, target} group at one base offset */
function writeLogic(
  d: Uint8Array,
  base: number,
  offsets: { type: number; sound: number; event: number; target: number },
  fields: MovLogicFields,
): MovLogicFields {
  const stored: MovLogicFields = {};
  if (fields.type !== undefined) {
    const value = i16clamp(fields.type);
    new DataView(d.buffer, d.byteOffset, d.byteLength).setInt16(base + offsets.type, value, true);
    stored.type = value;
  }
  for (const key of ["sound", "event", "target"] as const) {
    const value = fields[key];
    if (value === undefined) continue;
    stored[key] = writeNameAt(d, base + offsets[key], value, MOV_NAME_FIELD);
  }
  return stored;
}

/**
 * A frame's name — what another frame's (or region's) `target` jumps to, and
 * what the two action-frame slots name. Renaming one does NOT retarget the
 * references to it: they are stored as strings, so a rename silently breaks
 * every jump that used the old name, and `actionframe(n)` stops reporting.
 * The editor spells that out; here it is just bytes.
 */
export function patchFrameName(seg: MovSegment, frameIdx: number, name: string): string {
  const frame = seg.frames[frameIdx];
  if (!frame) return "";
  let stored = frame.name;
  patchContainerData(seg.file, seg.bias, (d) => {
    stored = writeNameAt(d, frame.record + FRAME.name, name, MOV_NAME_FIELD);
    // the palette is a window into the header container, which the copy just replaced
    seg.paletteRaw = d.subarray(C0.palette, C0.palette + 256 * 8);
  });
  frame.name = stored;
  return stored;
}

/**
 * A frame's own action and names — what a REGIONLESS frame does when playback
 * enters it (a frame WITH regions waits for a click instead), plus the sound it
 * fires on entry. Lives in the frame's logic container, so a frame without one
 * cannot carry any of this: false.
 */
export function patchFrameLogic(
  seg: MovSegment,
  frameIdx: number,
  fields: MovLogicFields,
): boolean {
  const frame = seg.frames[frameIdx];
  if (!frame?.locationClickRegion) return false;
  const data = seg.file.containers[frame.locationClickRegion]?.data;
  if (!data || data.length < LOGIC.minSize) return false;
  let stored: MovLogicFields = {};
  const ok = patchContainerData(seg.file, frame.locationClickRegion, (d) => {
    stored = writeLogic(d, 0, LOGIC, fields);
  });
  if (ok) Object.assign(frame, stored);
  return ok;
}

/**
 * A region's action and names — the click that exits, jumps, or chains to
 * another movie. Same fields as a frame's, one record further in.
 */
export function patchRegionLogic(
  seg: MovSegment,
  frame: MovFrame,
  region: MovClickRegion,
  fields: MovLogicFields,
): boolean {
  if (!frame.locationClickRegion) return false;
  let stored: MovLogicFields = {};
  const ok = patchContainerData(seg.file, frame.locationClickRegion, (d) => {
    stored = writeLogic(d, region.record, REGION, fields);
  });
  if (ok) Object.assign(region, stored);
  return ok;
}

/**
 * A region's clickable rectangle, in screen pixels (a movie frame decodes to the
 * full 512×384 screen). Stored Y-first — top, left, bottom, right — and callers
 * pass the edges by name so the axis order stays in one place. The parsed region
 * is updated with the bytes, since it is what the editor's overlay draws from.
 */
export function patchRegionRect(
  seg: MovSegment,
  frame: MovFrame,
  region: MovClickRegion,
  rect: { top: number; left: number; bottom: number; right: number },
): boolean {
  if (!frame.locationClickRegion) return false;
  const next = {
    y0: i16clamp(rect.top),
    x0: i16clamp(rect.left),
    y1: i16clamp(rect.bottom),
    x1: i16clamp(rect.right),
  };
  const ok = patchContainerData(seg.file, frame.locationClickRegion, (d) => {
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const at = region.record + REGION.top;
    v.setInt16(at, next.y0, true);
    v.setInt16(at + 2, next.x0, true);
    v.setInt16(at + 4, next.y1, true);
    v.setInt16(at + 6, next.x1, true);
  });
  if (ok) Object.assign(region, next);
  return ok;
}

/**
 * The two action-frame names — the frames whose entry `actionframe(1)` and
 * `actionframe(2)` report having passed through. This is the field a script
 * hangs a consequence off (TAOOT: PLAYMODE.MOV's is what decides `tour`, and
 * GSTAIR3.SET's `domanifest()` advances the Purser's errand on `actionframe(2)`).
 * An empty name means the slot is unused. Per SEGMENT — each header carries its
 * own pair, and the engine reads the playing segment's.
 */
export function patchActionFrames(seg: MovSegment, name1: string, name2: string): {
  actionFrame1: string;
  actionFrame2: string;
} {
  const stored = { actionFrame1: seg.actionFrame1, actionFrame2: seg.actionFrame2 };
  patchContainerData(seg.file, seg.bias, (d) => {
    stored.actionFrame1 = writeNameAt(d, C0.actionFrame1, name1, MOV_NAME_FIELD);
    stored.actionFrame2 = writeNameAt(d, C0.actionFrame2, name2, MOV_NAME_FIELD);
    seg.paletteRaw = d.subarray(C0.palette, C0.palette + 256 * 8);
  });
  Object.assign(seg, stored);
  return stored;
}

/**
 * Header flag bit 0: whether ESC (and Ctrl+Q) aborts this movie. All 218 movies
 * in the TAOOT corpus set it, and clearing it makes a clip unskippable — which is
 * a real thing to be able to try, since an abort does NOT run the frame's action
 * and that is exactly what some scripts test. The other bits are left alone.
 * Per SEGMENT, like the flags word it writes.
 */
export function patchKeySkips(seg: MovSegment, keySkips: boolean): boolean {
  const flags = keySkips ? seg.flags | FLAG_KEY_SKIPS : seg.flags & ~FLAG_KEY_SKIPS;
  const ok = patchContainerData(seg.file, seg.bias, (d) => {
    new DataView(d.buffer, d.byteOffset, d.byteLength).setInt32(C0.flags, flags, true);
    seg.paletteRaw = d.subarray(C0.palette, C0.palette + 256 * 8);
  });
  if (ok) {
    seg.flags = flags;
    seg.keySkips = keySkips;
  }
  return ok;
}
