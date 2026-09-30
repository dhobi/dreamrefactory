/**
 * A film laid out on a clock — which frame is on screen when, and which sounds
 * play under it — so it can be written out as a video file (#435).
 *
 * A movie is not a video: it is a state machine that may stop for a click or
 * loop for as long as the player looks at it. What a video can hold is the part
 * that plays by itself, so this walks the machine the way the movie editor's
 * "Play the film" does (site/editors/mov-editor.ts), with the same shared rules
 * — {@link frameHoldMs}, {@link segmentInterval}, {@link soundtrackFor},
 * {@link bedRuntimeMs} — on a clock that runs as fast as the walk rather than in
 * real time, and stops where the film would stop playing by itself:
 *
 *   * a frame that waits for a click, or a film with no pacing at all (a
 *     close-up held until clicked away): the frame is held {@link HELD_MS} and
 *     the video ends there;
 *   * a jump BACK to a frame already shown (the camel ride, the fires): the game
 *     would loop there for ever, and the video ends at the jump;
 *   * a chain to another file (types 3 and 4) or a return (5): the film's own
 *     part is over;
 *   * {@link MAX_MS}, as a backstop.
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

/** how long a frame the film stops on is held before the video ends */
export const HELD_MS = 2000;
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
  | { kind: "click"; segIdx: number; frame: number }
  | { kind: "loop"; segIdx: number; frame: number; to: number }
  | { kind: "chain"; segIdx: number; frame: number; event: string }
  | { kind: "long" };

export interface FilmTimeline {
  shots: FilmShot[];
  sounds: FilmSound[];
  ms: number;
  ending: FilmEnding;
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

export function filmTimeline(mov: MovFile): FilmTimeline {
  const shots: FilmShot[] = [];
  const sounds: FilmSound[] = [];
  let t = 0;
  let bed: FilmSound | null = null;
  let ending: FilmEnding = { kind: "end" };
  /** an event sound starts and plays out, unless the film ends first */
  const fire = (seg: MovSegment, name: string): number => {
    const a = eventSound(mov, seg, name);
    if (!a) return t;
    const until = t + (a.samples.length / a.sampleRate) * 1000;
    sounds.push({ atMs: t, untilMs: until, sampleRate: a.sampleRate, samples: a.samples, loop: false });
    return until;
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

    let i = 0;
    let voiceEnds = t;
    const shown = new Set<number>();
    for (;;) {
      if (t >= MAX_MS) {
        ending = { kind: "long" };
        break walk;
      }
      shown.add(i);
      const f = seg.frames[i];
      if (f.sound) voiceEnds = Math.max(voiceEnds, fire(seg, f.sound));
      if (frameWaits(seg, i) || !interval) {
        hold(segIdx, i, HELD_MS);
        ending = { kind: "click", segIdx, frame: i };
        break walk;
      }
      let ms = frameHoldMs(seg, i);
      // a frame authored to wait for the spoken line waits for it (flags bit 0)
      if (f.waitsForVoice) ms = Math.max(ms, voiceEnds - t);
      hold(segIdx, i, ms);

      let next: number;
      switch (f.type) {
        case 6:
          next = i + 1;
          break;
        case 7:
          next = i - 1;
          break;
        case 2:
          next = seg.frames.findIndex((g) => g.name.toLowerCase() === f.target.toLowerCase());
          if (next < 0) break walk;
          break;
        case 3:
        case 4:
          ending = { kind: "chain", segIdx, frame: i, event: f.event };
          break walk;
        case 5:
          break walk;
        default:
          // 1 = exit the segment
          next = n;
      }
      if (next >= n) continue walk;
      if (next < 0 || shown.has(next)) {
        ending = { kind: "loop", segIdx, frame: i, to: Math.max(0, next) };
        break walk;
      }
      i = next;
    }
  }
  for (const s of sounds) s.untilMs = Math.min(s.untilMs, t);
  return { shots, sounds, ms: t, ending };
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
