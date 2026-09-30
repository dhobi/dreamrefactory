/**
 * A film laid out on a clock — which frame is on screen when, and which sounds
 * play under it — so it can be written out as a video file (#435).
 *
 * A movie is not a video: it is a state machine that may stop for a click or
 * loop for as long as the player looks at it. This walks the machine the way the
 * movie editor's "Play the film" does (site/editors/mov-editor.ts), with the
 * same shared rules — {@link frameHoldMs}, {@link segmentInterval},
 * {@link soundtrackFor}, {@link bedRuntimeMs} — on a clock that runs as fast as
 * the walk rather than in real time, and it plays the viewer's part too, so that
 * an interactive film shows what it is FOR rather than its first frame:
 *
 *   * a frame that waits for a click (or a segment with nothing to pace it) is
 *     held {@link HELD_MS}, and then clicked: of its regions, the one that leads
 *     to the nearest frame not yet shown. `camelsee.mov` opens on a still whose
 *     click starts the gallop — ended there, its video was the still;
 *   * a loop — a jump back to a frame already shown — plays {@link LOOP_PASSES}
 *     times, or for {@link LOOP_MS} if it is short, and is then clicked out of
 *     the same way, if its frame has a region
 *     that plays through (the gallop's frames each lead into the horses
 *     stopping);
 *
 * and the video ends where no click leads anywhere new, at a chain to another
 * file (types 3 and 4) or a return (5), or at {@link MAX_MS} as a backstop.
 *
 * Two things the player does that this does not: timed cues (only the demo's
 * tour.mov has any) and a sound that names a frame to jump to when it ends
 * (`soundFollows`). Both move the picture on a sound's clock, and neither shapes
 * a film that plays straight through.
 */
import { decodeAudioContainer, decodeAudioV0, resampleTo } from "./audio";
import { FrameBuffer, decodeFrame, indexedToRGBA, paletteToRGBA } from "./image";
import { decodeFrameV5, isV5Frame, paletteV5 } from "./image-v5";
import { MovFile, MovSegment } from "./mov";
import { bedRuntimeMs, frameHoldMs, frameWaits, segmentInterval } from "./mov-pace";
import { segmentAudio, soundtrackFor } from "./mov-sound";
import { compositeFrameV1 } from "./mov-v1";
import { paletteV0 } from "./mov-v0";

/** how long a frame that waits for a click is held before it is clicked */
export const HELD_MS = 2000;
/** a loop plays at least this many times before the walk clicks out of it... */
export const LOOP_PASSES = 2;
/** ...and a short one for at least this long (the camels' gallop is 0.7 s) */
export const LOOP_MS = 5000;
/** the longest video this will lay out; no shipped film comes near it */
export const MAX_MS = 20 * 60 * 1000;

/** one frame on screen: segment, frame index, and when */
export interface FilmShot {
  segIdx: number;
  frame: number;
  atMs: number;
  ms: number;
}

/** one sound on the film's clock, cut off at `untilMs` */
export interface FilmSound {
  atMs: number;
  untilMs: number;
  sampleRate: number;
  samples: Float32Array;
  /** play round again until `untilMs` (a looping bed) */
  loop: boolean;
}

/** why the video ends where it does */
export type FilmEnding =
  | { kind: "end" }
  /** a frame that waits for a click, and no click on it leads anywhere new */
  | { kind: "click"; segIdx: number; frame: number }
  | { kind: "loop"; segIdx: number; frame: number; to: number }
  | { kind: "chain"; segIdx: number; frame: number; event: string }
  | { kind: "long" };

export interface FilmTimeline {
  shots: FilmShot[];
  sounds: FilmSound[];
  ms: number;
  ending: FilmEnding;
  /** how many clicks the walk took where the film waits or loops */
  clicks: number;
}

/** a named event sound of a segment, decoded, or null if it has none it can read */
function eventSound(mov: MovFile, seg: MovSegment, name: string): { samples: Float32Array; sampleRate: number } | null {
  const loc = seg.sounds.get(name.toLowerCase());
  if (loc === undefined) return null;
  try {
    const data = seg.file.containers[loc].data;
    return mov.dfV0 ? decodeAudioV0(data) : decodeAudioContainer(data, seg.file.order);
  } catch {
    return null; // a sound this build cannot decode is silence, not a stopped film
  }
}

/** where an action code takes the walk: a frame, out of the segment, or to an end */
type Step = { to: number } | { exit: true } | { stop: FilmEnding };

function stepOf(seg: MovSegment, segIdx: number, i: number, type: number, target: string, event: string): Step {
  switch (type) {
    case 6:
      return i + 1 < seg.frames.length ? { to: i + 1 } : { exit: true };
    case 7:
      return { to: Math.max(0, i - 1) };
    case 2: {
      const to = seg.frames.findIndex((g) => g.name.toLowerCase() === target.toLowerCase());
      return to < 0 ? { stop: { kind: "end" } } : { to };
    }
    case 3:
    case 4:
      return { stop: { kind: "chain", segIdx, frame: i, event } };
    case 5:
      return { stop: { kind: "end" } };
    default:
      // 1 = exit the segment
      return { exit: true };
  }
}

export function filmTimeline(mov: MovFile): FilmTimeline {
  const shots: FilmShot[] = [];
  const sounds: FilmSound[] = [];
  let t = 0;
  let bed: FilmSound | null = null;
  let ending: FilmEnding = { kind: "end" };
  let clicks = 0;
  /**
   * The event sound playing, if any. A film's event sounds share ONE channel
   * and each cuts off the one before it — `MoviePlayer.playSound` plays them on
   * "sound" without `overlap` — so a sound fired on every pass of a loop
   * restarts rather than piling up: camelsee.mov's 2.5 s gallop fires on a
   * 0.7 s loop, and mixed on top of each other four of them played at once.
   */
  let playing: FilmSound | null = null;
  /** the click's sound, which the frame it leads to does not fire again */
  let clickSound = "";
  /** an event sound starts, cutting off the one before; answers when it ends */
  const fire = (seg: MovSegment, name: string): number => {
    const a = eventSound(mov, seg, name);
    if (!a) return playing ? playing.untilMs : t;
    if (playing) playing.untilMs = Math.min(playing.untilMs, t);
    playing = { atMs: t, untilMs: t + (a.samples.length / a.sampleRate) * 1000, sampleRate: a.sampleRate, samples: a.samples, loop: false };
    sounds.push(playing);
    return playing.untilMs;
  };
  const hold = (segIdx: number, frame: number, ms: number): void => {
    shots.push({ segIdx, frame, atMs: t, ms });
    t += ms;
  };

  walk: for (let segIdx = 0; segIdx < mov.segments.length; segIdx++) {
    const seg = mov.segments[segIdx];
    const n = seg.frames.length;
    if (!n) continue;
    let audio: ReturnType<typeof segmentAudio> = null;
    try {
      audio = segmentAudio(seg);
    } catch {
      // an undecodable bed leaves the film silent and playing, as in the editor
    }
    const interval = segmentInterval(seg, n, audio?.audioSec ?? 0, segIdx, mov.segments.length);
    if (audio) {
      // a segment that brings a bed replaces the one playing; one that brings
      // none inherits it (MoviePlayer.enterSegment)
      if (bed) bed.untilMs = t;
      const s = soundtrackFor(seg, audio, interval, n, bedRuntimeMs(mov, segIdx));
      bed = { atMs: t, untilMs: Infinity, sampleRate: s.sampleRate, samples: s.samples, loop: s.loop };
      sounds.push(bed);
    }

    /** when the event sound playing ends, for a frame that waits for it */
    let voiceEnds = t;
    /** how many times each frame has been entered */
    const entered = new Map<number, number>();
    /** when each frame was last entered */
    const enteredAt = new Map<number, number>();
    /**
     * The viewer's click on frame `i`: of its regions, the one leading to the
     * nearest frame not yet shown — forward first, then from the top — with its
     * sound. Null if none leads anywhere new.
     */
    const click = (i: number): number | null => {
      let best: { to: number; key: number; sound: string } | null = null;
      for (const r of seg.frames[i].regions) {
        const step = stepOf(seg, segIdx, i, r.type, r.target, r.event);
        if (!("to" in step) || entered.has(step.to)) continue;
        const key = step.to > i ? step.to - i : n + step.to;
        if (!best || key < best.key) best = { to: step.to, key, sound: r.sound };
      }
      if (!best) return null;
      clicks++;
      if (best.sound) voiceEnds = fire(seg, best.sound);
      clickSound = best.sound;
      return best.to;
    };

    let i = 0;
    for (;;) {
      if (t >= MAX_MS) {
        ending = { kind: "long" };
        break walk;
      }
      entered.set(i, (entered.get(i) ?? 0) + 1);
      enteredAt.set(i, t);
      const f = seg.frames[i];
      // the frame a click leads into may name the click's own sound: one
      // authored moment, one playback (MoviePlayer.enterFrame)
      if (f.sound && f.sound.toLowerCase() !== clickSound.toLowerCase()) voiceEnds = fire(seg, f.sound);
      clickSound = "";
      if (frameWaits(seg, i) || !interval) {
        hold(segIdx, i, HELD_MS);
        const to = click(i);
        if (to === null) {
          ending = { kind: "click", segIdx, frame: i };
          break walk;
        }
        i = to;
        continue;
      }
      let ms = frameHoldMs(seg, i);
      // a frame authored to wait for the spoken line waits for it (flags bit 0)
      if (f.waitsForVoice) ms = Math.max(ms, voiceEnds - t);
      hold(segIdx, i, ms);

      const step = stepOf(seg, segIdx, i, f.type, f.target, f.event);
      if ("stop" in step) {
        ending = step.stop;
        break walk;
      }
      if ("exit" in step) continue walk;
      // only a jump BACK closes a loop: stepping on into a frame the loop has
      // shown is going round it, and deciding there clicked out of the gallop
      // one frame after its jump instead of at it
      if (step.to > i) {
        i = step.to;
        continue;
      }
      const passes = entered.get(step.to) ?? 0;
      const loopMs = t - (enteredAt.get(step.to) ?? t);
      if (passes === 0 || passes < Math.max(LOOP_PASSES, Math.ceil(LOOP_MS / Math.max(1, loopMs)))) {
        i = step.to;
        continue;
      }
      // the loop has played: click out of it, or end on it
      const to = click(i);
      if (to === null) {
        ending = { kind: "loop", segIdx, frame: i, to: step.to };
        break walk;
      }
      i = to;
    }
  }
  for (const s of sounds) s.untilMs = Math.min(s.untilMs, t);
  return { shots, sounds, ms: t, ending, clicks };
}

/** the film's sound mixed down to one mono track at `rate` */
export function mixFilmSound(tl: FilmTimeline, rate: number): Float32Array {
  const out = new Float32Array(Math.ceil((tl.ms / 1000) * rate));
  for (const s of tl.sounds) {
    const pcm = resampleTo(s.samples, s.sampleRate, rate);
    if (!pcm.length) continue;
    const from = Math.round((s.atMs / 1000) * rate);
    const to = Math.min(out.length, Math.round((s.untilMs / 1000) * rate));
    for (let o = from, k = 0; o < to; o++, k++) {
      if (k >= pcm.length) {
        if (!s.loop) break;
        k = 0;
      }
      out[o] += pcm[k];
    }
  }
  for (let o = 0; o < out.length; o++) out[o] = Math.max(-1, Math.min(1, out[o]));
  return out;
}

/** a decoded frame, as RGBA */
export interface FilmPicture {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

/**
 * The film's pictures, decoded in order the way the player decodes them: one
 * delta chain per segment, restarted to go back, a v1 frame composited over the
 * one before it, a v5 frame on its own palette.
 */
export class FilmPictures {
  private segIdx = -1;
  private cursor = -1;
  private fb = new FrameBuffer();
  private shown: Uint8Array | null = null;
  private last: FilmPicture | null = null;
  private palette: Uint8ClampedArray = new Uint8ClampedArray(1024);

  constructor(private readonly mov: MovFile) {}

  picture(segIdx: number, frame: number): FilmPicture | null {
    if (segIdx !== this.segIdx || frame < this.cursor) this.restart(segIdx);
    const seg = this.mov.segments[segIdx];
    for (let i = this.cursor + 1; i <= frame; i++) {
      this.cursor = i;
      const loc = seg.frames[i]?.locationFrame;
      const data = loc ? seg.file.containers[loc]?.data : undefined;
      if (!data) continue;
      try {
        if (isV5Frame(data)) {
          const d = decodeFrameV5(data, this.fb);
          this.last = this.paint(this.fb.pixels.slice(0, d.width * d.height), d.width, d.height, paletteV5(data));
          continue;
        }
        const d = decodeFrame(data, this.fb, seg.file.order);
        const pixels = this.fb.pixels.slice(0, d.width * d.height);
        if (seg.dfV1) {
          compositeFrameV1(pixels, this.shown);
          this.shown = pixels;
        }
        this.last = this.paint(pixels, d.width, d.height, this.palette);
      } catch {
        // a frame that doesn't decode leaves the picture as it was
      }
    }
    return this.last;
  }

  private restart(segIdx: number): void {
    const seg = this.mov.segments[segIdx];
    this.segIdx = segIdx;
    this.cursor = -1;
    this.fb = new FrameBuffer();
    this.shown = null;
    this.palette = seg.dfV0 ? paletteV0(seg.paletteRaw) : paletteToRGBA(seg.paletteRaw, 256, seg.file.order);
  }

  private paint(pixels: Uint8Array, width: number, height: number, palette: Uint8ClampedArray): FilmPicture {
    return { width, height, rgba: indexedToRGBA(pixels, width, height, palette) };
  }
}
