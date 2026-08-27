/**
 * A movie segment's SOUNDTRACK — the bed, and how much of it to play.
 *
 * Kept on its own, beside {@link file://./mov-pace.ts}, for the same reason that
 * file exists: two players must not each have their own idea of it. The rule
 * used to live inside `MoviePlayer.enterSegment`, welded to a `GameSession`, so
 * the movie editor's preview could only ever be a silent approximation of a film
 * the game plays with music under it. Everything here is a pure function of a
 * segment, so the editor plays the bed the game plays and no second reading of
 * the loop table exists to drift.
 *
 * Only the LOOP table is a soundtrack ({@link MovSegment.audioChunks} — the
 * engine's sole self-started audio): a scored bed, played under the whole
 * segment, INCLUDING an interactive one. The main menu's theme lives here
 * (playmode.mov: one 8 s chunk listed 4x, and no event sounds at all), as does
 * playmore.mov's, the end credits' and the Smethells note's. Without this the
 * menu sat in silence. The one-shot table is the EVENT-sound library — frame
 * entries and region clicks (FAUCET.MOV's "Brook Babbling." + the tap clicks),
 * fired as playback enters a frame or takes a click, and by nothing else.
 */
import { MovSegment } from "./mov";
import { decodeAudioContainer, resampleTo } from "./audio";

/**
 * How much of a cutscene's soundtrack to take beyond its predicted runtime.
 *
 * A film's runtime is `interval x frames` in theory and tick-quantised in
 * practice, so the picture always runs a little long — ~1% on a 60 Hz screen,
 * more with a dropped frame. 10% covers that with room to spare, and costs
 * nothing on a bed whose authored order has no material left to give.
 */
export const OVERRUN_MARGIN = 1.1;

/** join PCM segments end to end, stopping at `cap` samples if one is given */
export function concat(parts: Float32Array[], cap = Infinity): Float32Array {
  const total = Math.min(
    cap,
    parts.reduce((a, s) => a + s.length, 0),
  );
  const out = new Float32Array(total);
  let off = 0;
  for (const s of parts) {
    if (off >= out.length) break;
    out.set(s.subarray(0, out.length - off), off);
    off += s.length;
  }
  return out;
}

/** a segment's loop table, decoded: the authored order, and the content in it */
export interface SegmentAudio {
  /** the rate every chunk has been resampled UP to */
  rate: number;
  /** the authored order, resampled — repeats included */
  resampled: Float32Array[];
  /** the DISTINCT chunks, in first-use order — the content, counted once */
  unique: Float32Array[];
  /** seconds of that distinct content: the only length pacing may be derived from */
  audioSec: number;
}

/**
 * Decode a segment's bed, or null if it brings none.
 *
 * `audioLoops` used to gate this as well (`!hasRegions || seg.audioLoops`), and
 * for a v4 movie that was already a no-op: df/mov.ts sets `audioLoops =
 * audioChunks.length > 0`, so the two conditions were the same condition. It
 * stops being one for DreamFactory 1, whose chunks are a plain run played once
 * rather than a loop order (df/mov-v1.ts) — and 45 of Dust's 136 films with
 * sound are interactive, so the old reading would have kept them silent. What
 * `audioLoops` still decides is whether the bed REPEATS while an interactive
 * frame waits, which is the question it should be asked ({@link soundtrackFor}).
 *
 * The loop table is an `order` sequence over a handful of chunk records, and
 * that sequence usually ends in a REPEATED tail — a bed that loops behind the
 * animation (logo.mov's cybermix loops its 4th segment 20x behind the title).
 * Two facts the pacing must respect:
 *
 *   * Segments can sit at DIFFERENT sample rates — intro stingers at 22050 Hz,
 *     looping beds at 11025 Hz (the per-chunk rate is a field in the audio
 *     header; see docs/engine/formats/audio.md). This is NOT the .11k scheme —
 *     those are shorter songs swapped in on low-RAM machines, not a downsample.
 *     We resample every chunk UP to the highest rate present so the concatenated
 *     buffer is coherent — an 11025 chunk left at 22050 would play at double
 *     speed (chipmunk).
 *   * A looped tail must NOT stretch the video: pacing uses the UNIQUE content
 *     length (each distinct chunk counted once). Otherwise logo.mov spreads 318
 *     frames over the ~86 s expanded loop — ~4 fps, the reported "intro too
 *     slow".
 */
export function segmentAudio(seg: MovSegment): SegmentAudio | null {
  if (!seg.audioChunks.length) return null;
  const containers = seg.file.containers;
  const decoded = seg.audioChunks.map((loc) =>
    decodeAudioContainer(containers[loc].data, seg.file.order),
  );
  const rate = Math.max(...decoded.map((p) => p.sampleRate));
  const resampled = decoded.map((p) => resampleTo(p.samples, p.sampleRate, rate));
  const seen = new Set<number>();
  const unique: Float32Array[] = [];
  seg.audioChunks.forEach((loc, i) => {
    if (seen.has(loc)) return;
    seen.add(loc);
    unique.push(resampled[i]);
  });
  const audioSec = unique.reduce((a, s) => a + s.length, 0) / rate;
  return { rate, resampled, unique, audioSec };
}

/** a bed, ready to hand to an audio sink */
export interface Soundtrack {
  sampleRate: number;
  samples: Float32Array;
  /** play it round again if the picture outlives it */
  loop: boolean;
}

/**
 * The bed as it should be PLAYED: which samples, and whether it repeats.
 *
 * `interval` is the segment's frame interval ({@link file://./mov-pace.ts}) and
 * `frameCount` its picture, because how much of an authored loop order to take
 * depends on how long the picture will be on screen.
 *
 * `onScreenMs` is how long the bed really will be up — this segment's picture
 * plus every following segment that inherits it ({@link bedRuntimeMs}). Optional,
 * and 0 means "no more than my own picture", which is what every caller said
 * before it existed.
 */
export function soundtrackFor(
  seg: MovSegment,
  audio: SegmentAudio,
  interval: number,
  frameCount: number,
  onScreenMs = 0,
): Soundtrack {
  const { rate, resampled, unique, audioSec } = audio;
  const hasRegions = seg.frames.some((f) => f.regions.length > 0);
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
    return { sampleRate: rate, samples: concat(unique), loop: true };
  }
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
  const predicted = interval > 0 ? (interval * frameCount) / 1000 : 0;
  // ...and never below how long the bed will actually be ON SCREEN, which is a
  // question about the FILM and not about this segment. A segment that brings no
  // bed of its own inherits this one, so a film may go on for segments after the
  // prediction runs out — and running out is not silence, it is the loop backstop
  // below starting the bed again from its first chunk. See `bedRuntimeMs` in
  // df/mov-pace.ts, where the demo's open.mov is measured: 25.18 s of bed cut
  // from a 156 s loop order, under 27.57 s of film, so 2.4 s into the last
  // segment the CyberFlix fanfare began again under the Titanic title (#299).
  //
  // Passed in rather than derived here because a segment does not know its
  // successors and this file may not learn: `soundtrackFor` is what the game and
  // the movie editor share so that neither can have its own idea of a bed, and
  // that only holds while it is a function of what it is handed. A caller that
  // leaves it out gets exactly the old answer.
  const runtime = Math.max(audioSec, predicted, onScreenMs / 1000);
  const cap = Math.max(1, Math.ceil(runtime * OVERRUN_MARGIN * rate));
  // ...and loop as the backstop, but ONLY once the author's order has actually
  // run out — which is what `samples` being shorter than the cap says.
  //
  // The distinction is the difference between a backstop and a bug. If `concat`
  // stopped at the CAP there is more order behind it, and reaching the end of
  // what we took is our estimate having been short, not the music having ended:
  // rewinding there plays the author's FIRST chunk, which is never what comes
  // next. That is what the demo's opening did — 25.18 s taken out of a 156 s
  // order, and the CyberFlix fanfare back over the Titanic title card (#299).
  // Silence for a moment at the end of a film is a smaller wrong than the wrong
  // music, and with the runtime measured properly above it does not arise.
  //
  // If `concat` stopped because the ORDER ran out, repeating it is the authored
  // answer and the old one. The player halts the bed the moment the film really
  // does end, so neither can outlive the movie.
  const samples = concat(resampled, cap);
  return {
    sampleRate: rate,
    samples,
    loop: seg.audioLoops && samples.length < cap,
  };
}
