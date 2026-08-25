/**
 * How fast a movie plays — the pacing rule, kept on its own so the player and the
 * movie editor cannot each have their own idea of it.
 *
 * They did: the editor previewed everything at the native rate while the player
 * paced a cutscene off its soundtrack, so what you watched in the editor was not
 * what the game would do. Same shape as `site/editors/cst-editor.ts`'s private copy of
 * the engine heartbeat, which sat at 66 ms for as long as the engine's was 50 —
 * a constant with a second copy is a constant that will drift.
 *
 * The authored pacing is {@link frameHoldMs} (the per-frame hold, recovered from
 * the demo build's movie loop); the constants above it are the port's own rules
 * for the cases the holds don't decide, each with a measurement behind it. See
 * docs/engine/formats/mov.md, and the note there about two earlier models that were built
 * on fields the engine turned out never to read.
 */
import { MovSegment } from "./mov";

/** native movie frame rate: ~15 fps */
export const NATIVE_FRAME_MS = 66;
/** ms/frame measured from FAUCET.MOV: Brook Babbling (3.62 s) spans exactly
 *  its 25 water frames — the rate interactive movies with audio animate at */
export const FAUCET_FRAME_MS = 145;
/** a region-less/soundtrack-less cutscene is spread over this fixed total */
export const CUTSCENE_TOTAL_MS = 3000;
/**
 * Pick the ms-per-frame pacing for a movie (0 = wait for clicks).
 *
 * Pacing: soundtrack duration when present; otherwise animate at a default
 * rate if there are pause frames, else pure click-through.
 *
 * With a soundtrack, audio may be a short one-shot SFX, not a pacing track —
 * bombopen.mov's latch click (~0.4 s) over 22 frames would otherwise play the
 * suitcase opening at ~50 fps. Floor at the native movie rate (~15 fps):
 * audio can only make frames SLOWER (faucet stays 145 ms), never faster than
 * the floor. The soundtrack still plays once from frame 0.
 *
 * Region-less, soundtrack-less cutscenes still self-advance via their frame
 * type-6/7 STEP actions (the intro logos, the date captions — logo.mov,
 * datebed.mov, and 3 others; the ONLY region-less/no-audio movies in the
 * corpus, all of which step). They must pace on the clock, or the boot
 * sequence hangs on frame 0. They carry no authored timing (the MOV format
 * has no per-frame duration), so spread the movie over a fixed ~3 s total —
 * a held publisher logo (logo.mov, 3 frames) reads as a logo rather than a
 * flash, while a longer animation (cratep.mov, 25 frames) still plays at a
 * sane rate. Clamped to [native, 1200 ms] per frame. A region-less movie
 * with no step frames stays pure click-through (interval 0) — a close-up.
 *
 * Interactive movies auto-advance their step frames between the clickable
 * states. 145 ms is the FAUCET rate — but that's specifically to sync the
 * water animation to its babbling audio; it's too slow (~7 fps) for a SILENT
 * animation that merely carries a skip/exit region (bedmem/bedmant, the
 * wash + fire loops). With no audio there's nothing to pace against, so
 * animate at the stable native rate; keep 145 ms only when the movie has
 * audio whose frame-entry sounds were timed to it.
 */
export function chooseFrameInterval(
  mov: MovSegment,
  frameCount: number,
  audioSec: number,
  hasRegions: boolean,
): number {
  // type 6/7 is DF4's "advance one frame"; DF1 says the same thing with a forward
  // goto and has no type 6 anywhere on the disc (see stepsForward)
  const hasStep =
    mov.frames.some((f) => f.type === 6 || f.type === 7) || stepsForward(mov);
  const hasAudio = mov.audioChunks.length > 0 || mov.sounds.size > 0;
  return audioSec > 0
    ? Math.max(NATIVE_FRAME_MS, (audioSec * 1000) / frameCount)
    : hasRegions
      ? hasAudio
        ? FAUCET_FRAME_MS
        : NATIVE_FRAME_MS
      : hasStep
        ? Math.max(
            NATIVE_FRAME_MS,
            Math.min(1200, CUTSCENE_TOTAL_MS / frameCount),
          )
        : 0;
}

/**
 * How far a soundtrack may stretch a film before it stops being its timing track
 * and is just a BED playing under it — as a multiple of the native rate.
 *
 * 2x, and the corpus draws the line for us rather than taste doing it. Of the 24
 * region-less cutscenes with loop-table audio across all three trees, twenty pace
 * out between 66 and 110 ms a frame (15 down to 9 fps) — their beds were authored
 * to the animation, and every one of them stays exactly as it was. Then there is a
 * gap with nothing in it, and the rest: 183, 207, 241, 289, 663 and 6681 ms. Those
 * are narrated pieces whose picture is far shorter than what is being said over it
 * (the 1996 demo's `trailer.mov` and `tour.mov`, and the Dust teasers `dust`,
 * `debris`, `nuke` and `redjack`), and dividing the narration by the frame count
 * played them at 1.5 fps and worse. Measured, and reported: "trailer.mov plays
 * visually too slow", "tour.mov seems to play very slow".
 */
export const BED_STRETCH_LIMIT = 2;

/**
 * Is this soundtrack far longer than the picture it plays over?
 *
 * REPORTING ONLY — the editor shows it, and nothing paces on it. It was briefly the
 * pacing rule and that was wrong twice over: see the note above, and `debris.mov`,
 * a shipped credits film it misclassified, where repeating the picture displaced a
 * spoken line the previous film had left running.
 */
export function isBed(audioSec: number, frameCount: number): boolean {
  return (audioSec * 1000) / frameCount > NATIVE_FRAME_MS * BED_STRETCH_LIMIT;
}

/**
 * Does this segment jump backwards — a picture authored as a loop?
 *
 * REPORTING ONLY, like {@link isBed}. Both were once read as "the picture
 * repeats until the bed is done", and TI.EXE says otherwise on both counts:
 * a bed that outlives its segment's picture means more SEGMENTS follow
 * (`MovFile.segments` — the demo's trailer.mov is 13 of them, 698 frames, not
 * 139 against 92 s of narration), and an authored backward loop is left by a
 * CUE (`MovSegment.cues` — tour.mov's ship's-logo 5<->6 loop, pulled out at
 * tick 200 by the one cue record in any shipped tree). A backward jump with
 * no cue over it is an interactive movie's toggle, waiting on clicks.
 */
export function framesLoop(mov: MovSegment): boolean {
  const byName = new Map<string, number>();
  mov.frames.forEach((f, i) => f.name && byName.set(f.name.toLowerCase(), i));
  return mov.frames.some((f, i) => {
    if (f.type !== 2 && f.type !== 4) return false;
    const target = byName.get(f.target.toLowerCase());
    return target !== undefined && target <= i;
  });
}

/**
 * Does this segment hand a frame on to a LATER one without waiting for a click —
 * a straight run, however the film happens to spell it?
 *
 * DreamFactory 4 spells it with an action of its own: type 6, "advance one frame"
 * (type 7 steps back). **DreamFactory 1 has no such action.** A DF1 straight run
 * is a type-2 `goto` whose target is the next frame — INTRO.MOV names its frames
 * "1" to "136" and every one of the first 135 gotos to its successor. Same film,
 * same behaviour, different opcode.
 *
 * That difference froze every Dust cutscene. `chooseFrameInterval` asked only for
 * type 6/7, found none in any of the 160 films on the disc, and returned 0 —
 * which means "click-through close-up, do not self-pace". The films WITH click
 * regions took an earlier branch and animated; the 57 region-less ones held frame
 * 0 for ever. The soundtrack is started separately and ran on regardless, so the
 * intro played its narration over a still picture, which is exactly what it looked
 * like: audible, motionless, and no error anywhere.
 *
 * Read the same way {@link framesLoop} reads a backward jump — by resolving the
 * target through the frame names rather than assuming the target is an index —
 * and gated on {@link MovSegment.dfV1}, so no DF4 film's pacing can change. A
 * type-2 goto in a TAOOT close-up is a toggle waiting on a click, and that
 * reading has to stay exactly as it was.
 */
export function stepsForward(mov: MovSegment): boolean {
  if (mov.dfV1 !== true) return false;
  const byName = new Map<string, number>();
  mov.frames.forEach((f, i) => f.name && byName.set(f.name.toLowerCase(), i));
  return mov.frames.some((f, i) => {
    if (f.type !== 2) return false;
    const target = byName.get(f.target.toLowerCase());
    return target !== undefined && target > i;
  });
}

/** one engine tick, the unit the MOV frame holds are counted in (60 a second) */
export const TICK_MS = 50 / 3;

/**
 * How long THIS frame is held, in ms — the movie's own authored pacing.
 *
 * `max(frame.holdTicks, mov.minHoldTicks)`, read out of the demo build's movie
 * loop (`0x44b10f`: `mov edx, [ecx+2]` against `[hdr+0x1c]`, and the branch takes
 * the LARGER). So the per-movie value is a floor — its frame rate — and a frame
 * may hold longer than it but never shorter.
 *
 * This replaces deriving a rate from the soundtrack, which is what made the demo's
 * `trailer.mov` play at 1.5 fps (139 frames spread over 92 s of narration) when its
 * first segment is authored at 9.8 s — the narration covers the file's THIRTEEN
 * segments, not one. Checked the other way on films whose length is known independently:
 * `berg.mov` computes 35.3 s against 40.0 s of audio and `leave.mov` 5.2 s against
 * 5.6 s.
 */
export function frameHoldMs(mov: MovSegment, frameIdx: number): number {
  const f = mov.frames[frameIdx];
  if (!f) return NATIVE_FRAME_MS;
  return Math.max(f.holdTicks, mov.minHoldTicks) * TICK_MS;
}

/**
 * Does playback STOP on this frame and wait for a click?
 *
 * Regions alone do not decide it: flags bit 2 says "honour them only if a click
 * is already in hand, else run the frame's own action and play on"
 * ({@link MovFrame.playsThroughRegions} carries the disassembly). That is what
 * makes the camel ride, the deck washes and the fires loop — the last frame of
 * each cycle carries a backward `goto` that nothing would ever reach if the
 * frame stopped for its own click rect.
 *
 * Here rather than in either player because both need it and they must agree: a
 * frame the editor calls a wait and the game plays through is a frame the editor
 * shows you stopping where the game does not.
 */
export function frameWaits(mov: MovSegment, frameIdx: number): boolean {
  const f = mov.frames[frameIdx];
  return !!f && f.regions.length > 0 && !f.playsThroughRegions;
}

/**
 * The frame interval a SEGMENT of a film plays at — {@link chooseFrameInterval}
 * plus the two things that are true of a segment rather than of a movie.
 *
 * `audioSec` is the segment's UNIQUE bed content in seconds (0 if it brings
 * none) — see `df/mov-sound.ts`, which is where that number comes from.
 */
export function segmentInterval(
  mov: MovSegment,
  frameCount: number,
  audioSec: number,
  segIdx: number,
): number {
  const hasRegions = mov.frames.some((f) => f.regions.length > 0);
  // an interactive movie paces on its own clock (or on clicks); only a
  // cutscene's soundtrack sets the frame rate — and not even that when the
  // frames loop, because then the soundtrack says how LONG rather than how fast.
  // A v1 bed (audioLoops false, the only bed that doesn't loop) paces nothing:
  // DreamFactory 1 films run at their header's frame rate and hold for their
  // narration with per-frame voice waits (D1ND2M.MOV: sounds fired at frames 1
  // and 21, flags bit 0 + hold 20 on the last frame). Stretching 45 frames over
  // the audio played them as a slideshow.
  const interval = chooseFrameInterval(
    mov,
    frameCount,
    hasRegions || !mov.audioLoops ? 0 : audioSec,
    hasRegions,
  );
  // A later segment always plays itself out: its picture is mid-film, so
  // "no step frames -> wait for clicks" (a close-up's shape) cannot apply.
  // No shipped TAOOT segment needs this — they all step — it just refuses to hang.
  if (!interval && segIdx > 0 && !hasRegions) return NATIVE_FRAME_MS;
  return interval;
}
