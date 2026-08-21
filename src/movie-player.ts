/**
 * MOV playback — full-screen cutscenes and interactive object close-ups.
 *
 * A movie owns the whole screen while it plays: it carries its own palette,
 * its own click regions, its own event sounds and (for cutscenes) its own
 * soundtrack. Playback is MODAL from the script's point of view: playmovie()
 * blocks until the movie — and any sub-movies it chains to — has finished.
 *
 * The host viewer (viewer.ts) forwards clicks/ticks here while {@link playing}
 * and paints {@link frame}; everything else about movies lives in this file.
 */
import {
  FLAG_ANY_INPUT_ABORTS, MovClickRegion, MovFile, MovFrame, MovSegment, readMovFile,
} from "./df/mov";
import { NATIVE_FRAME_MS, TICK_MS, chooseFrameInterval, frameHoldMs } from "./df/mov-pace";
import { Container } from "./df/container";
import { detectVersion } from "./df/version";
import { movFileFromV1, readMovFileV1 } from "./df/mov-v1";
import { decodeAudioContainer, resampleTo } from "./df/audio";
import { FrameBuffer, decodeFrame, paletteToRGBA } from "./df/image";
import { displayPalette, screenGammaGeneration } from "./screen-gamma";
import { GameSession } from "./engine/session";
import { volumeKey } from "./engine/puppet";
import { PlayHandle } from "./engine/audio";

/** one decoded movie frame, as indexed pixels */
interface MovieImage {
  pixels: Uint8Array;
  width: number;
  height: number;
}

/**
 * How much of a cutscene's soundtrack to take beyond its predicted runtime.
 *
 * A film's runtime is `interval x frames` in theory and tick-quantised in
 * practice, so the picture always runs a little long — ~1% on a 60 Hz screen,
 * more with a dropped frame. 10% covers that with room to spare, and costs
 * nothing on a bed whose authored order has no material left to give.
 */
const OVERRUN_MARGIN = 1.1;
/** cross-movie call stack limit, matching TI.EXE */
const MOVIE_CALL_DEPTH = 5;

/** join PCM segments end to end, stopping at `cap` samples if one is given */
function concat(parts: Float32Array[], cap = Infinity): Float32Array {
  const total = Math.min(cap, parts.reduce((a, s) => a + s.length, 0));
  const out = new Float32Array(total);
  let off = 0;
  for (const s of parts) {
    if (off >= out.length) break;
    out.set(s.subarray(0, out.length - off), off);
    off += s.length;
  }
  return out;
}

export class MoviePlayer {
  onLog: (line: string) => void = () => {};

  /**
   * ESC ends the SEGMENT rather than the sequence — off, and no shipped film
   * turns it on.
   *
   * The original's rule is the whole sequence (see {@link key}): state 2 clears
   * the next-segment pointer at `0x4493a9` instead of following it, and that is
   * what every TAOOT film gets. But the Nightdive intro is a screen this port
   * puts up on its own, not a film TI.EXE ever played — two segments, the film
   * and then the ownership question — and there the two halves want different
   * answers: press past the film you have seen before, but the question still
   * has to be answered (issue #171).
   *
   * A per-player opt-in rather than a rule change, because the rule is right for
   * everything the game ships. Combines with {@link MovFile.keySkips}, which is
   * per SEGMENT: the intro's film sets it and its question does not, so ESC
   * carries you from the one to the other and then stops mattering.
   */
  escapeSkipsSegment = false;

  /** active movie playback (cutscene / object close-up). The per-picture
   *  fields (frames, meta, palette, interval…) are the CURRENT SEGMENT's —
   *  a movie is a chain of them (MovFile.segments) and enterSegment() swaps
   *  the lot when one segment's exit leads to the next. */
  private active: {
    fileName: string;
    frames: MovieImage[];
    /** frame types/regions/targets — the movie's own state machine */
    meta: MovFrame[];
    /** frame name (lowercase) -> index, for jump targets */
    frameByName: Map<string, number>;
    /** named event-sound chunks: name (lowercase) -> container location */
    sounds: Map<string, number>;
    /** sound name (lowercase) -> the frame it carries on to when it ends */
    soundFollows: Map<string, string>;
    /** the jump the sound now playing has armed — see {@link MoviePlayer.tick} */
    soundJump: { frame: number; sound: PlayHandle } | null;
    containers: Container[];
    hasRegions: boolean;
    /** ESC may abort this movie (MOV header flag bit 0) — see {@link skip} */
    keySkips: boolean;
    palette: Uint8ClampedArray;
    /** the display gamma `palette` was built at — see the frame getter */
    paletteGen: number;
    pos: number;
    /** ms per frame; 0 = wait for clicks (click-through object movies) */
    interval: number;
    lastTick: number;
    /** frame indices for actionframe(1)/(2) (-1 = none); see recordAction */
    actionFrame1: number;
    actionFrame2: number;
    /** the whole file, for the segment chain */
    mov: MovFile;
    /** the segment on screen (mov.segments[segIdx]) */
    seg: MovSegment;
    segIdx: number;
    /** tick() time the segment started at (0 until the first tick), the
     *  clock the segment's cues are measured against */
    segStartMs: number;
    /** cues already fired this segment (they fire once, TI.EXE 0x44af59) */
    cuesFired: Set<number>;
  } | null = null;
  /** cross-movie return stack (type-4 call / type-5 return, TI.EXE depth 5) */
  private callStack: { movie: string; frame: number }[] = [];
  /**
   * Handles for the event sounds the movie has fired, so the end of the
   * sequence can stop them. They play on the shared "sound" channel next to
   * room ambience and sound loops, so the channel can't just be halted — the
   * movie's own plays are stopped one by one.
   */
  private eventSounds: PlayHandle[] = [];
  /**
   * Resolver for the blocking playmovie() promise. Set by the top-level
   * play() call and held pending across a whole chain of sub-movies
   * (mainc -> pursopen …); only the final exit (finish) resolves it, so
   * the script stays suspended until the entire sequence ends.
   */
  private resolveWhenDone: (() => void) | null = null;

  constructor(
    private readonly session: GameSession,
    /** the movie sequence has fully ended — the host reveals the world */
    private readonly onFinished: () => void,
  ) {}

  get playing(): boolean {
    return this.active !== null;
  }

  /**
   * The clip on screen, lowercase, or null.
   *
   * `playing` alone can't tell "the cutscene I was watching has ended" from
   * "it ended and the script has already started the next one" — and a caller
   * pressing ESC through a sequence of them has to know which, or it reads its
   * own success as a failure.
   */
  get playingFile(): string | null {
    return this.active?.fileName ?? null;
  }

  /**
   * The regions of the frame playback is sitting on — empty unless the movie
   * is a frame WITH regions, i.e. unless it is waiting modally for a click.
   *
   * `playing` can't answer "is the engine waiting for me?": it is just
   * `active !== null`, which stays true for the whole time an interactive
   * movie sits on a region frame. A harness driving a playthrough has to tell
   * "still animating" from "waiting", and then know WHERE the exit is —
   * clickableAt() only answers for a point you already guessed.
   */
  get waitingRegions(): readonly MovClickRegion[] {
    const m = this.active;
    if (!m || !m.hasRegions) return [];
    return m.meta[Math.min(m.pos, m.meta.length - 1)]?.regions ?? [];
  }

  /**
   * Which frame of the active clip is on screen, or -1 when none is.
   *
   * `frame` below mints a fresh object every call, so it cannot answer "the
   * same picture as last time?" by identity — and an interactive movie PARKED
   * on a region frame keeps `playing` true indefinitely while showing one
   * unchanging image, which is exactly the case the renderer wants to stop
   * redrawing (see SetViewer.render).
   */
  get framePos(): number {
    const m = this.active;
    return m ? Math.min(m.pos, m.frames.length - 1) : -1;
  }

  /** the frame to paint right now (with the movie's own palette and where on
   *  the screen the segment says it sits — see MovSegment.originX), or null */
  get frame(): (MovieImage & { palette: Uint8ClampedArray; originX: number; originY: number }) | null {
    const m = this.active;
    if (!m) return null;
    const f = m.frames[Math.min(m.pos, m.frames.length - 1)];
    // A segment bakes its palette once, so a brightness change made DURING a movie
    // has to be picked up here — the original's F-keys are in the window proc and
    // work over a playing movie, and a two-minute cutscene is exactly when someone
    // reaches for them.
    const gen = screenGammaGeneration();
    if (m.paletteGen !== gen) {
      m.palette = displayPalette(paletteToRGBA(m.seg.paletteRaw, 256));
      m.paletteGen = gen;
    }
    return { ...f, palette: m.palette, originX: m.seg.originX, originY: m.seg.originY };
  }

  /**
   * Play a movie MODALLY: resolves when the movie (and any chained sub-movie)
   * finishes, so the calling script blocks. A chained continuation
   * (resolveWhenDone already pending) reuses the outstanding promise rather
   * than minting a new one — the original top-level call owns completion.
   */
  /** every movie this chain has loaded, for release when the chain ends */
  private played = new Set<string>();

  play(fileName: string, startFrame = 0): Promise<void> {
    const chained = this.resolveWhenDone !== null;
    // fresh top-level play: reset the action-frame set the script will query
    if (!chained) this.session.movieActions.clear();
    if (!this.load(fileName, startFrame)) {
      // nothing to play — end the sequence (resolves any pending chain promise)
      this.finish();
      return Promise.resolve();
    }
    if (chained) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.resolveWhenDone = resolve;
    });
  }

  /** parse + install a movie as the active one; false if unavailable/empty */
  private load(fileName: string, startFrame = 0): boolean {
    this.played.add(fileName.toLowerCase());
    const data = this.session.files(fileName.toLowerCase());
    if (!data) {
      this.onLog(`playmovie: "${fileName}" not available`);
      return false;
    }
    let mov;
    try {
      // Dust's movies are DreamFactory 1 and its container 0 is not v4's with the
      // fields moved (src/df/mov-v1.ts). Routed here rather than inside
      // readMovFile because the two produce the same MovFile and nothing below
      // this line has to care which engine wrote the film.
      mov = detectVersion(data) === 1 ? movFileFromV1(readMovFileV1(data)) : readMovFile(data);
    } catch (e) {
      this.onLog(`playmovie: ${fileName}: ${(e as Error).message}`);
      return false;
    }
    if (!mov.frames.length) return false;
    return this.enterSegment(mov, fileName.toLowerCase(), 0, startFrame);
  }

  /**
   * Install one segment of a movie as what is on screen. Segment 0 is how a
   * movie starts; a later one is where a segment's type-1 exit leads
   * (endSegment) — same picture pipeline, fresh palette/frames/cues, and the
   * soundtrack rule from TI.EXE's segment reload (0x44956f): a segment that
   * brings audio of its own replaces the bed, one that brings none INHERITS
   * the playing one (tour.mov's 18 slide segments carry no audio — the
   * narration bed from segment 0 plays across them all).
   */
  private enterSegment(mov: MovFile, fileName: string, segIdx: number, startFrame = 0): boolean {
    const seg = mov.segments[segIdx];
    // frames are delta-encoded per segment: decode all in order
    const fb = new FrameBuffer();
    const frames: MovieImage[] = [];
    for (const f of seg.frames) {
      const d = decodeFrame(mov.file.containers[f.locationFrame].data, fb);
      frames.push({
        pixels: fb.pixels.slice(0, d.width * d.height),
        width: d.width,
        height: d.height,
      });
    }
    if (!frames.length) return false;

    const hasRegions = seg.frames.some((f) => f.regions.length > 0);

    // Movie soundtrack. Only the LOOP table is one (MovSegment.audioChunks —
    // the engine's sole self-started audio): a scored bed, played under the
    // whole segment, INCLUDING an interactive one. The main menu's theme
    // lives here (playmode.mov: one 8 s chunk listed 4x, and no event sounds
    // at all), as does playmore.mov's, the end credits' and the Smethells
    // note's. Without this the menu sat in silence. The one-shot table is the
    // EVENT-sound library — frame entries and region clicks (FAUCET.MOV's
    // "Brook Babbling." + the tap clicks), fired by enter()/click() and by
    // nothing else.
    //
    // The loop table is an `order` sequence
    // over a handful of chunk records, and that sequence usually ends in a
    // REPEATED tail — a bed that loops behind the animation (logo.mov's cybermix
    // loops its 4th segment 20x behind the title). Two facts the pacing must
    // respect:
    //   * Segments can sit at DIFFERENT sample rates — intro stingers at
    //     22050 Hz, looping beds at 11025 Hz (the per-chunk rate is a field in
    //     the audio header; see docs/formats/audio.md). This is NOT the .11k
    //     scheme — those are shorter songs swapped in on low-RAM machines, not a
    //     downsample. We resample every segment UP to the highest rate present
    //     so the concatenated buffer is coherent — an 11025 chunk left at 22050
    //     would play at double speed (chipmunk).
    //   * A looped tail must NOT stretch the video: pacing uses the UNIQUE
    //     content length (each distinct chunk counted once). Otherwise logo.mov
    //     spreads 318 frames over the ~86 s expanded loop — ~4 fps, the reported
    //     "intro too slow".
    let audioSec = 0;
    let soundtrack: { rate: number; resampled: Float32Array[]; unique: Float32Array[] } | null = null;
    // `audioLoops` used to gate this as well (`!hasRegions || seg.audioLoops`), and
    // for a v4 movie that was already a no-op: df/mov.ts sets `audioLoops =
    // audioChunks.length > 0`, so the two conditions were the same condition. It
    // stops being one for DreamFactory 1, whose chunks are a plain run played once
    // rather than a loop order (df/mov-v1.ts) — and 45 of Dust's 136 films with
    // sound are interactive, so the old reading would have kept them silent. What
    // `audioLoops` still decides is whether the bed REPEATS while an interactive
    // frame waits, which is the question it should be asked (see below).
    if (seg.audioChunks.length) {
      const decoded = seg.audioChunks.map((loc) => decodeAudioContainer(mov.file.containers[loc].data));
      const rate = Math.max(...decoded.map((p) => p.sampleRate));
      const resampled = decoded.map((p) => resampleTo(p.samples, p.sampleRate, rate));
      const seen = new Set<number>();
      const unique: Float32Array[] = [];
      seg.audioChunks.forEach((loc, i) => {
        if (seen.has(loc)) return;
        seen.add(loc);
        unique.push(resampled[i]);
      });
      audioSec = unique.reduce((a, s) => a + s.length, 0) / rate;
      soundtrack = { rate, resampled, unique };
    }

    // an interactive movie paces on its own clock (or on clicks); only a
    // cutscene's soundtrack sets the frame rate — and not even that when the
    // frames loop, because then the soundtrack says how LONG rather than how fast
    let interval = chooseFrameInterval(seg, frames.length, hasRegions ? 0 : audioSec, hasRegions);
    // A later segment always plays itself out: its picture is mid-film, so
    // "no step frames -> wait for clicks" (a close-up's shape) cannot apply.
    // No shipped TAOOT segment needs this — they all step — it just refuses to hang.
    if (!interval && segIdx > 0 && !hasRegions) interval = NATIVE_FRAME_MS;

    // now that the frame interval is known, play the soundtrack (finish() stops
    // the "voice" channel, so it can never outlive the movie). A segment that
    // brings audio REPLACES whatever bed is playing (TI.EXE halts the bed
    // channel before rewiring it, 0x449593); one that brings none fell through
    // above and inherits the previous segment's, still running.
    if (soundtrack) {
      this.session.audio.halt("voice");
      const { rate, resampled, unique } = soundtrack;
      if (hasRegions && seg.audioLoops) {
        // Interactive AND a loop bed: the movie sits on a frame for as long as
        // the player takes to click — there is no runtime to cut the bed to. Play
        // the DISTINCT chunks once and loop, the same way a theme bank's loop
        // chunks are played (see AudioLibrary.theme), so the menu keeps its
        // music however long the player leaves it up.
        //
        // A v1 close-up is interactive too and is NOT a loop: it says a line over
        // a held picture and the line is meant to finish. It takes the branch
        // below, which plays the run once.
        this.session.audio.play("voice", { sampleRate: rate, samples: concat(unique) }, { loop: true });
      } else {
        // Cutscene: concatenate the (resampled) chunks only up to the movie's
        // own runtime, so a 20x loop tail doesn't allocate ~150 s of audio we
        // halt at movie end anyway.
        //
        // ...but that runtime is a PREDICTION, and the film is not held to it.
        // `interval x frames` assumes every frame arrives the instant it is due,
        // while frames actually advance on ticks: the step is
        // `now - lastTick >= interval`, so on a 60 Hz screen a 66 ms interval
        // really costs ceil(66/16.7) x 16.7 = 66.7 ms, and a dropped frame costs
        // a whole refresh more. Over TAOOT ocredits.mov's 1225 frames that is ~0.8 s of
        // picture past the end of a bed cut to the prediction — reported as the
        // fly-in to C73 losing its audio and carrying on silent for a second or
        // two before the next scene's horn.
        //
        // So take a margin of the authored sequence beyond the prediction. It is
        // free material for exactly the movies that need it (the bed comes from a
        // LOOP table, whose repeats are there to be drawn on: ocredits' 53 entries
        // hold 213.62 s over a 80.85 s film), and it continues the music the
        // author wrote rather than jumping. `concat` stops at whatever the order
        // actually holds, so a bed with nothing spare is simply unchanged.
        // ...and never below the material there actually is. The prediction is
        // `interval x frames`, which assumes the film runs itself out — and a film
        // that STOPS to wait for a click does not: a v1 close-up is three frames
        // and a two-second line, so the prediction would have cut the line to a
        // fifth of a second. For a v4 bed this floor is unreachable by
        // construction (a paced segment's interval is derived FROM audioSec, so
        // the product is already >= it, and an interactive v4 bed loops in the
        // branch above and never arrives here).
        const predicted = interval > 0 ? (interval * frames.length) / 1000 : 0;
        const runtime = Math.max(audioSec, predicted);
        const cap = Math.max(1, Math.ceil(runtime * OVERRUN_MARGIN * rate));
        // ...and loop as the backstop, for a host slow enough to outrun even that.
        // A loop-table bed is authored to repeat, and repeating a second of it
        // beats a second of silence. finish() halts "voice" the moment the film
        // really does end, so this can never outlive the movie.
        this.session.audio.play(
          "voice",
          { sampleRate: rate, samples: concat(resampled, cap) },
          seg.audioLoops ? { loop: true } : undefined,
        );
      }
    }
    const frameByName = new Map<string, number>();
    seg.frames.forEach((f, i) => f.name && frameByName.set(f.name.toLowerCase(), i));
    // Everything the player pressed while this was loading is DISCARDED, and the
    // original is unambiguous about it: `playmovie` is one function that reads
    // the .MOV containers and then calls flushevents unconditionally (TI.EXE
    // 0x449104) immediately before the playback loop at 0x449200 — no ret or
    // padding anywhere between the three. A multi-segment film gets it per
    // segment, because the chain jumps back from 0x4494ba to 0x448bd8, upstream
    // of the flush.
    //
    // This is the whole of issue #5. A close-up is slow to fetch, the player
    // clicks the sofa three more times while it loads, those clicks queue (the
    // ordinary rule — see EventQueue), and the drain in SetViewer.tick then
    // replayed them into the room the moment the close-up closed, re-opening it
    // once per banked click.
    this.session.events.flush();
    this.active = {
      fileName,
      frames,
      meta: seg.frames,
      frameByName,
      sounds: seg.sounds,
      soundFollows: seg.soundFollows,
      soundJump: null,
      containers: mov.file.containers,
      hasRegions,
      keySkips: seg.keySkips,
      palette: displayPalette(paletteToRGBA(seg.paletteRaw, 256)),
      paletteGen: screenGammaGeneration(),
      pos: Math.min(Math.max(startFrame, 0), frames.length - 1),
      interval,
      lastTick: 0,
      actionFrame1: seg.actionFrame1 ? frameByName.get(seg.actionFrame1.toLowerCase()) ?? -1 : -1,
      actionFrame2: seg.actionFrame2 ? frameByName.get(seg.actionFrame2.toLowerCase()) ?? -1 : -1,
      mov,
      seg,
      segIdx,
      segStartMs: 0,
      cuesFired: new Set(),
    };
    this.recordAction(this.active.pos);
    this.onLog(
      `movie: ${fileName}${segIdx ? ` segment ${segIdx + 1}/${mov.segments.length}` : mov.segments.length > 1 ? ` (1/${mov.segments.length} segments)` : ""} (${frames.length} frames${audioSec ? `, ${audioSec.toFixed(1)}s audio` : ""}${hasRegions ? ", interactive" : ""})`,
    );
    // The frame a segment OPENS on is a frame entered, so its entry sound fires
    // like any other — {@link enter} does both halves for every later frame and
    // this used to do only the actionframe one, so the first frame's sound was
    // the one sound in a film that never played.
    //
    // 55 start frames in 29 of the English tree's 275 movies carry one, and they
    // are the ones that could hardly be anything else: `crowd1` on the bomb
    // blast, `seagwaves` over the debris, `cave drips.SE` down the Red Jack
    // shaft, `final.01` on all four endings, room tone opening each of
    // leave.mov's and sink*.mov's ten segments, and the credits' `newtick` — the
    // stopwatch tick the player hears over the opening titles, which is #51.
    //
    // The films are authored around it firing, which is the other half of the
    // evidence. A `waitsForVoice` frame holds until the movie's own sounds are
    // done, and where a segment has both, the two line up:
    //
    //     SAIL1-4.MOV   "sail1snd" 6.08s   holds at 6.67s
    //     STACKDN/UP    "lstep1.SE" 0.19s  holds at 0.23s
    //     TOPUP.MOV     "lstep3.SE" 0.14s  holds at 0.70s
    //     leave.mov s3  "shipup"    6.13s  holds at 5.98s
    //
    // and the tour narration clips are the reason to be sure: tour2/tour8 open
    // on a SPOKEN LINE (`burns_t.02`, `trask1.091a`) with 8 of their 9 frames
    // waiting for voice. Without this they ran mute and 1.3 s long against a
    // line of 8.5 s.
    const startSound = this.active.meta[this.active.pos].sound;
    if (startSound) this.playSound(startSound);
    return true;
  }

  /**
   * A segment's exit: the next segment of the chain if one follows, the end
   * of the movie if not. This is what a type-1 "exit" action really is — only
   * the LAST segment's exit ends the film (module comment in df/mov.ts).
   */
  private endSegment(): void {
    const m = this.active;
    if (m && m.segIdx + 1 < m.mov.segments.length) {
      this.enterSegment(m.mov, m.fileName, m.segIdx + 1);
    } else {
      this.finish();
    }
  }

  /**
   * Sticky-record the actionframe() bits as playback enters a frame: the
   * script's `actionframe(1)`/`(2)` (session.movieActions) report whether this
   * play passed through the movie's action-frame-1 / action-frame-2 (named in
   * the movie header). TAOOT: turning the car light on lands on "lightson" -> 1;
   * knocking at the purser window lands on "openit"/"endit" -> 1/2.
   */
  private recordAction(idx: number): void {
    const m = this.active;
    if (!m) return;
    if (idx === m.actionFrame1) this.session.movieActions.add(1);
    if (idx === m.actionFrame2) this.session.movieActions.add(2);
  }

  /**
   * The current frame's click region under a point, or null. Shared by
   * {@link click} and {@link clickableAt} so the hover cursor can never promise
   * a click the movie wouldn't act on.
   */
  private regionAt(x: number, y: number): MovClickRegion | null {
    const m = this.active;
    if (!m || !m.hasRegions) return null;
    const regions = m.meta[m.pos].regions;
    if (!regions.length) return null; // animation in flight
    // regions are picture-relative; the mouse is screen-relative, and the
    // engine subtracts the segment's screen origin before testing (0x44ad08).
    // (0,0) — i.e. a no-op — for every interactive movie in the corpus.
    x -= m.seg.originX;
    y -= m.seg.originY;
    return (
      regions.find(
        (r) =>
          x >= Math.min(r.x0, r.x1) && x <= Math.max(r.x0, r.x1) &&
          y >= Math.min(r.y0, r.y1) && y <= Math.max(r.y0, r.y1),
      ) ?? null
    );
  }

  /**
   * Would a click at this point do anything? Read-only counterpart of
   * {@link click}, for the host's hover cursor.
   *
   * A click-through movie (no regions anywhere) advances on ANY click, but only
   * while it is actually waiting for one — a timed movie (interval > 0) plays
   * itself out and ignores clicks entirely.
   */
  clickableAt(x: number, y: number): boolean {
    const m = this.active;
    if (!m) return false;
    if (!m.hasRegions) return m.interval === 0;
    return !!this.regionAt(x, y);
  }

  /** click during a movie: only region frames react (modal wait) */
  click(x: number, y: number): void {
    const m = this.active;
    if (!m) return;
    // pure click-through movies (no regions anywhere): any click steps
    if (!m.hasRegions) {
      if (m.interval === 0) {
        m.pos++;
        if (m.pos >= m.frames.length) this.finish(true);
      }
      return;
    }
    const regions = m.meta[m.pos].regions;
    if (!regions.length) return; // animation in flight
    const region = this.regionAt(x, y);
    this.onLog(
      `movie click (${x},${y}) frame ${m.pos}${region ? ` -> type ${region.type} "${region.target || region.event}"` : " (no region hit)"}`,
    );
    if (!region) return;
    if (region.sound) this.playSound(region.sound);
    m.lastTick = 0;
    this.action(region.type, region.target, region.event);
  }

  /**
   * A key while the movie owns the screen. Returns true if it aborted it.
   *
   * A key during a movie is the movie's to interpret, not the host's and not
   * the script's: the original has ONE event queue, and whichever modal loop
   * is running pops from it (the main interactive loop takes anything, TI.EXE
   * 0x431c43; a text prompt takes keys only, 0x440756; the movie loop takes
   * keys and its own kinds, 0x44a16b). So while a movie plays, the key never
   * reaches the script chain — the movie consumed it — and the abort rule
   * lives here rather than at whatever routed the keystroke in.
   *
   * The rule (TI.EXE 0x44a460, the movie's key filter): the event must be a
   * FRESH keydown carrying the 0x1fa0 marker — set for ESC and for any key
   * held with Ctrl, which is {@link special} — and its character must be
   * `.` (what the window proc translates ESC to) or `q`. Both land on the
   * same instruction: `return movieHeader[0x18] & 1`, i.e. {@link
   * MovFile.keySkips}. Ctrl+0..9 and Ctrl+T are the only other keys with
   * cases and neither aborts; an auto-repeat is a different event kind and is
   * ignored, so holding ESC down skips one movie, not the next as well.
   *
   * Aborting ends the whole SEQUENCE, not the clip: the original records
   * state 2, and state 2 is what makes it clear the movie's next-segment
   * pointer (0x4493a9) instead of following it. So this drops the return
   * stack — a type-5 region has nothing to come back to once the sequence is
   * over — and finishes, resolving the blocked playmovie() exactly as a
   * natural end would. The frame's own action is NOT run: an abort is not the
   * exit region being clicked, which matters for the close-ups whose exit
   * chains to another movie.
   *
   * What the movie already did stands: the action-frame bits are recorded on
   * ENTERING a frame (recordAction), so a movie skipped after passing its
   * action frame still reports it to actionframe(), and one skipped before
   * still doesn't — the same as pressing ESC at that moment in the original.
   *
   * {@link escapeSkipsSegment} is the one way out, and no shipped film takes it.
   */
  key(keyName: string, special = false): boolean {
    const m = this.active;
    if (!m) return false;
    // The movie filter's table (0x44a584/0x44a544) is byte-identical to the
    // spoken line's, so the volume digits work over a clip too — which is where
    // a player most wants them. They do not abort it: the arm answers 0.
    if (volumeKey(this.session, keyName)) return true;
    if (!special || (keyName !== "." && keyName !== "q")) return false;
    if (!m.keySkips) return false;
    if (this.escapeSkipsSegment && m.segIdx + 1 < m.mov.segments.length) {
      this.onLog(`movie: ${m.fileName} segment ${m.segIdx + 1} skipped at frame ${m.pos}`);
      this.endSegment();
      return true;
    }
    this.onLog(`movie: ${m.fileName} skipped at frame ${m.pos}`);
    this.finish(true);
    return true;
  }

  /** event sounds live in the movie's own chunk table, banks as fallback */
  private playSound(name: string): void {
    const m = this.active;
    if (!m) return;
    const loc = m.sounds.get(name.toLowerCase());
    const snd = loc !== undefined
      ? decodeAudioContainer(m.containers[loc].data)
      : this.session.audioLib.sound(name);
    if (!snd) return;
    // keep the handle: an event sound belongs to the movie that fired it and
    // must die with it (see finish). Drop finished handles as we go so a long
    // interactive movie doesn't accumulate them.
    this.eventSounds = this.eventSounds.filter((h) => !h.done);
    const handle = this.session.audio.play("sound", snd);
    this.eventSounds.push(handle);
    // ...and the sound may carry the picture on when it ends
    // (MovSegment.soundFollows). Armed here and cleared by any sound that names
    // no frame, exactly as the original stores the lookup unconditionally: that
    // is how bedcards.mov's "sil" both cuts the watch's monologue and stops the
    // chain when the player clicks away from it.
    const follow = m.soundFollows.get(name.toLowerCase());
    const frame = follow !== undefined ? m.frameByName.get(follow.toLowerCase()) : undefined;
    m.soundJump = frame === undefined ? null : { frame, sound: handle };
  }

  /** move playback to a frame, firing its entry sound (faucet on/off…) */
  private enter(idx: number): void {
    const m = this.active!;
    m.pos = idx;
    this.recordAction(idx);
    const sound = m.meta[idx].sound;
    if (sound) this.playSound(sound);
  }

  /**
   * Apply a type-code action (region click or region-less frame). Codes from
   * TI.EXE's movie loop: 1 exit · 2 goto target · 3 chain to event movie ·
   * 4 call event movie (resume at target on return) · 5 return · 6/7 step.
   */
  private action(type: number, target: string, event: string): void {
    const m = this.active!;
    switch (type) {
      case 2: {
        const idx = m.frameByName.get(target.toLowerCase());
        if (idx === undefined) {
          this.onLog(`movie: no frame named "${target}"`);
          this.finish();
        } else {
          this.enter(idx);
        }
        return;
      }
      case 3:
      case 4: {
        if (type === 4) {
          const idx = m.frameByName.get(target.toLowerCase());
          if (idx !== undefined && this.callStack.length < MOVIE_CALL_DEPTH) {
            this.callStack.push({ movie: m.fileName, frame: idx });
          }
        }
        this.chainTo(event);
        return;
      }
      case 5: {
        const ret = this.callStack.pop();
        if (ret) this.chainTo(ret.movie, ret.frame);
        else this.finish();
        return;
      }
      case 6:
        // stepping past the last frame is an authored error in TI.EXE ("Can't
        // go to next frame."); treating it as the segment's exit is the
        // lenient stand-in
        if (m.pos + 1 < m.frames.length) this.enter(m.pos + 1);
        else this.endSegment();
        return;
      case 7:
        if (m.pos > 0) this.enter(m.pos - 1);
        return;
      default:
        this.endSegment(); // 1 = exit (the SEGMENT — the movie only if it is the last)
    }
  }

  /**
   * Chain to the next movie in a sequence, keeping the blocking playmovie
   * promise (resolveWhenDone) pending so the script stays suspended across the
   * whole chain. Drop the current movie first so its region-less frame can't
   * auto-advance again during the (possibly async) load of the next one. An
   * empty target means there's nothing to chain to — end the sequence.
   */
  private chainTo(next: string, startFrame = 0): void {
    this.active = null;
    if (!next) {
      this.finish();
      return;
    }
    // reuses the pending resolveWhenDone (play() sees a chained continuation)
    void this.session.onPlayMovie(next, startFrame);
  }

  /**
   * Clock tick: self-paced movies advance region-less frames by running the
   * frame's own auto-action. Returns the frame to draw, or null once the
   * movie has ended (an advance may finish the sequence mid-tick).
   */
  tick(now: number): MovieImage | null {
    const m = this.active;
    if (!m) return null;
    if (!m.segStartMs) m.segStartMs = now;
    // Cues first, and OUTSIDE the self-pacing gate: a timed jump fires out of
    // ANY wait — a hold, or a region frame's modal one (TI.EXE polls 0x44ae90
    // from both wait loops). Each fires once, on the segment's own clock.
    // TAOOT's tour.mov is the shipped case: its authored ship's-logo loop (frame 6,
    // a backward goto) is left at tick 200 by the jump to "Name 12".
    for (let c = 0; c < m.seg.cues.length; c++) {
      const cue = m.seg.cues[c];
      if (m.cuesFired.has(c) || now - m.segStartMs < cue.tick * TICK_MS) continue;
      m.cuesFired.add(c);
      const idx = m.frameByName.get(cue.target.toLowerCase());
      this.onLog(`movie cue: tick ${cue.tick} -> "${cue.target}"${idx === undefined ? " (no such frame)" : ""}`);
      if (idx !== undefined) {
        m.lastTick = now;
        this.enter(idx);
      }
    }
    // A spoken line that names a follow-on frame comes due the same way, and for
    // the same reason: the poll that fires it (TI.EXE 0x44a7f5) runs in both wait
    // loops, so the jump leaves a region frame's modal wait as readily as a hold.
    // The original asks whether the sound channel still carries the armed sound's
    // NAME, which is why a line the player cut short jumps too — a stopped handle
    // reads done here exactly as a finished one does.
    if (m.soundJump && m.soundJump.sound.done) {
      const { frame } = m.soundJump;
      m.soundJump = null;
      m.lastTick = now;
      this.enter(frame);
    }
    // A frame waits for a click only if it HAS regions and does not carry flags
    // bit 2 — the original zeroes the region count on a bit-2 frame unless a
    // click is already in hand (0x44979f), so playback falls through to the
    // frame's own action and plays on. That is what makes the camel ride, the
    // deck washes and the fires loop: the last frame of the cycle carries a
    // backward `goto` nothing would ever reach if the frame stopped for its own
    // click rect. See MovFrame.playsThroughRegions.
    const waits = m.meta[m.pos].regions.length > 0 && !m.meta[m.pos].playsThroughRegions;
    if (m.interval > 0 && !waits) {
      if (!m.lastTick) m.lastTick = now;
      // The FILM's own hold, not a rate we invented: max(frame, movie floor) —
      // see mov-pace.frameHoldMs. `interval` still decides whether this movie is
      // self-paced at all (0 = a click-through close-up).
      const hold = frameHoldMs(m.seg, m.pos);
      if (now - m.lastTick >= hold) {
        // ...and a frame may be authored to wait for the SPOKEN LINE as well
        // (flags bit 0). What it waits on is the original's VOICE channel, which
        // is where `voicesound()` puts a line — in this port that is the movie's
        // own event sounds, not the `"voice"` channel our soundtrack happens to be
        // named after. Waiting on the soundtrack instead hangs the film outright:
        // a loop-table bed is played looping and never reports done.
        //
        // TAOOT leave.mov's frame 68 is the case, and it is why that film's last line
        // outlives its picture: frame 41 fires Morrow's "morrow2.83" (3.34 s) and
        // the second-to-last frame holds until he has finished saying it.
        if (m.meta[m.pos].waitsForVoice && this.eventSounds.some((h) => !h.done)) {
          return m.frames[m.pos];
        }
        m.lastTick = now;
        // run the region-less frame's own auto-action (step/chain/exit)
        const f = m.meta[m.pos];
        this.action(f.type, f.target, f.event);
      }
    }
    return this.active ? this.active.frames[this.active.pos] : null;
  }

  /**
   * The movie sequence has fully ended: reveal the world and unblock the script.
   *
   * `dismissed` = the player ended it outright (ESC, or clicking past the last
   * frame of a click-through close-up). Together with whether the clip was
   * INTERACTIVE at all, it decides whether the movie's spoken lines are cut —
   * see below.
   */
  /**
   * Give up the film because the GAME is being replaced.
   *
   * A load is a film's ESC as far as the film is concerned: nobody is going to
   * watch the rest of it, and the one thing that must not happen is the thing
   * that used to. A `MoviePlayer` belongs to a `SetViewer`, a load builds a new
   * viewer, and nothing disposes the old one — so the film stopped being ticked
   * (the viewer forwards those) while `resolveWhenDone` stayed pending for ever.
   * The script that called `playmovie()` was awaiting that promise inside a
   * tracked dispatch, so `session.scriptBusy` never came back down: the game
   * looked locked and the workbench's own `load()` — which waits for `quiet` —
   * could never finish. Measured with a real load over `logo.mov`: the promise
   * was still unsettled six seconds later.
   *
   * `finish(true)` and not a teardown of its own, because the dismissal path is
   * already the right one and already thought through — it flushes the event
   * queue the way TI.EXE does, hands the chain's bytes back (a cutscene is tens
   * of megabytes), halts the bed and, for a film somebody cut short, its event
   * sounds. `dismissed` is exactly true here: nobody let this one finish.
   */
  abandon(): void {
    if (!this.active && !this.resolveWhenDone) return;
    this.onLog(`movie: ${this.active?.fileName ?? "sequence"} abandoned — the game was replaced`);
    this.finish(true);
  }

  private finish(dismissed = false): void {
    // read before dropping it: an interactive clip's lines are the player's to
    // cut short, a cutscene's are not
    const interactive = this.active?.hasRegions ?? false;
    // ...and the other half of the movie's event-queue rule (TI.EXE 0x449330):
    // on the way out it flushes again UNLESS the film wanted any input to abort
    // it. So the click that dismissed a close-up dies with the close-up instead
    // of reaching the room behind it. No TAOOT movie sets the bit, but read it
    // rather than assume it — the same as keySkips (MovFile.flags).
    if (this.active && !(this.active.seg.flags & FLAG_ANY_INPUT_ABORTS)) {
      this.session.events.flush();
    }
    this.active = null;
    this.callStack = [];
    // Hand the chain's movies back. This is the safe moment and the only one: a
    // type-5 region RETURNS to a movie played earlier in the chain (callStack),
    // so nothing may be released until the whole sequence is over — which is
    // exactly what being here means. The host drops their bytes; a movie the
    // player opens again is a refetch away, and the big ones are cutscenes that
    // are never opened again at all.
    if (this.played.size) {
      const names = [...this.played];
      this.played.clear();
      this.session.onMoviesDone?.(names);
    }
    // The soundtrack bed — halted with the film, which is TI.EXE's own teardown
    // (0x449d40, the no-next-segment path: it stops the bed channel). This
    // BRIEFLY worked the other way — the bed was left to outlive a film shorter
    // than it, because the TAOOT demo's trailer.mov "looked good but was cut way too
    // soon" at 9.8 s against 92 s of narration. That film was never 9.8 s: the
    // port was playing 1 of its 13 SEGMENTS (MovFile.segments), and with the
    // rest of the picture back the bed and the film end together, the way the
    // engine says they do.
    this.session.audio.halt("voice");
    // ...and the event sounds, but only for a clip the PLAYER was driving. A
    // frame-entry sound is often a full spoken line — TAOOT's LENIN.MOV fires Penny's
    // "penny2.29" (3.5 s) on entering its middle frame — and an interactive clip
    // is dismissed by a click that can land long before the line ends. The script
    // then runs straight on to the next puppetspeak, so an unstopped line talks
    // over Penny's next sentence. That is why this stop exists, and the OK button
    // is the reason it cannot key off the click itself: clicking OK steps to a
    // frame whose own auto-action exits a tick later, so the finish arrives from
    // the clock. What is true of every such clip is that it HAS regions.
    //
    // A cutscene is the opposite case: nobody dismissed it, the film simply ran
    // out, and the line was timed to play there — cutting it is the bug.
    // leave.mov fires Morrow's "Tell them we did our best" (`morrow2.83`, 3.34 s)
    // on entering frame 41 of 70, and the frame interval comes from the 5.57 s
    // `cloop3` bed: frame 41 arrives at 3.26 s, the film ends at 5.57 s, and the
    // line was cut with 1.03 s to run. Measured across the corpus, 16 of the 52
    // region-less movies with audio fire a sound they leave no room for — and
    // pacing the film to fit instead is no fix: conkdead.mov's 2.32 s splash
    // lands 4 frames from the end, which would stretch a 4.55 s clip to 37.7 s.
    // A splash fired on the last frame is MEANT to ring out past the picture.
    if (dismissed || interactive) for (const h of this.eventSounds) h.stop();
    this.eventSounds.length = 0;
    // Reveal whatever the movie transitioned to. blackscreen() paints the
    // screen black one-shot before an intro movie (TAOOT's bomb openstage:
    // blackscreen -> playmovie("bombopen.mov") -> setvisible(false) with no
    // blacktoscreen to follow); in our retained renderer that leaves fade.level
    // pinned at 1, so the flat would stay black after the movie. Only ARM the
    // reveal here: the script resumes from its playmovie() the moment we
    // resolve below, and it usually has more to say about the screen (boot()
    // opens the flat and plays the date caption under the black before
    // advanceday fades in). session.tickFade lifts the black once the script
    // has gone quiet without establishing a fade of its own.
    //
    // ...and the frozen frame a fade-out was holding is VOID. A movie owns the
    // screen outright while it plays (SetViewer.screenOwner ranks it above a
    // held fade, because it carries its own palette and its own pixels), so
    // whatever picture a `screentoblack` froze before it is not what should
    // come back afterwards. Leaving it deadlocks the reveal armed above:
    // tickFade will not lift a black while a snapshot is held, and the only
    // things that clear one are a `blacktoscreen` ramp, `blackscreen()` and
    // `visualeffect` — none of which a script that ended on a movie need ever
    // issue. TAOOT's demo trunk is the case: `transtoflat("trunk.stg")`
    // screentoblacks (snapshot taken), opens the stage, plays `trnkopen.mov`
    // and stops. The trunk was open, composited and 172k lit pixels in the
    // framebuffer, behind a screen that stayed black for ever.
    this.session.fade.snapshot = null;
    this.session.fade.pendingReveal = true;
    this.onFinished();
    // release the script blocked in playmovie() (whole chain done)
    const resolve = this.resolveWhenDone;
    this.resolveWhenDone = null;
    if (resolve) resolve();
  }
}
