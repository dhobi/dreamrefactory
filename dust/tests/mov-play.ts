/**
 * The movie PLAYER over a Dust film — the state machine on a clock, not the
 * container.
 *
 *   npx vitest run dust/tests/mov-play.ts
 *
 * `dust/tests/movies.ts` proves DOG1.MOV says what it says; this proves the port
 * acts on it, and the split is not academic. The bug this file was written for
 * lived exactly in the gap between the two halves: record +0x1a bit 0 — "hold
 * this frame until the sound it started has finished" — was parsed into
 * `flags2` and then read by nobody, so every format assertion passed while the
 * dog that stops you leaving town on day one growled once instead of twice.
 *
 * ## Why this file brings its own audio sink
 *
 * `NullAudioSink` reports a one-shot DONE the instant it starts (`done` is
 * `!loop || stopped || displaced`), which is the right shape for asserting what
 * was played and useless for asserting how long anything took: a film that
 * waits for a sound and a film that ignores the flag look identical to it. So
 * this sink holds a play until the test's own clock has run past its duration —
 * the same clock the player is ticked with, so nothing here depends on real
 * time — and models the one behaviour that decides what a listener hears: a
 * second play on a channel DISPLACES the first, which is `WebAudioSink.play`
 * halting the channel before it starts, and DF.EXE stopping channel 0 before it
 * rewires it (0x404d3c).
 *
 * That displacement is the bug as heard. Two 0.88 s growls fired 100 ms apart
 * are not two growls: the second cuts the first off a tenth of the way in, and
 * what comes out of the speaker is one growl.
 */
import { test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  AudioChannel,
  AudioSink,
  PlayHandle,
  PlayOpts,
} from "@dreamfactory/engine/runtime/audio";
import type { DecodedAudio } from "@dreamfactory/engine/df/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { MoviePlayer } from "@dreamfactory/engine/web/movie-player";

const MOVIES = fileURLToPath(
  new URL("../gamefiles/dustcd/MOVIES", import.meta.url),
);

/** one play, as the sink saw it */
interface Play {
  channel: AudioChannel;
  seconds: number;
  startedAt: number;
  /** when the next play on this channel cut it off, if one did */
  displacedAt: number | null;
  stopped: boolean;
}

/**
 * A sink on the test's clock: a one-shot is done when the clock says it is.
 *
 * `now` is written by the test between ticks, so "the growl has finished" is a
 * fact about the same timeline the player is being advanced along. Loops never
 * finish, which is what a bed is.
 */
class ClockedSink implements AudioSink {
  now = 0;
  plays: Play[] = [];
  private holding: Partial<Record<AudioChannel, Play>> = {};

  play(channel: AudioChannel, audio: DecodedAudio, opts?: PlayOpts): PlayHandle {
    const play: Play = {
      channel,
      seconds: audio.samples.length / audio.sampleRate,
      startedAt: this.now,
      displacedAt: null,
      stopped: false,
    };
    if (!opts?.overlap) {
      // A play is only DISPLACED if it was still running: one that had already
      // reached its end ended on its own, and calling that displacement would
      // report the fixed film as broken exactly the way the broken one is.
      const held = this.holding[channel];
      if (
        held &&
        !held.stopped &&
        held.displacedAt === null &&
        this.now - held.startedAt < held.seconds * 1000
      )
        held.displacedAt = this.now;
      this.holding[channel] = play;
    }
    this.plays.push(play);
    const sink = this;
    return {
      get done() {
        if (play.stopped || play.displacedAt !== null) return true;
        if (opts?.loop) return false;
        return sink.now - play.startedAt >= play.seconds * 1000;
      },
      stop: () => (play.stopped = true),
    };
  }
  halt(channel: AudioChannel): void {
    const held = this.holding[channel];
    if (held) held.stopped = true;
    delete this.holding[channel];
  }
  isDone(channel: AudioChannel): boolean {
    const held = this.holding[channel];
    if (!held) return true;
    return (
      held.stopped ||
      held.displacedAt !== null ||
      this.now - held.startedAt >= held.seconds * 1000
    );
  }
  setChannelVolume(): void {}
  setSuspended(): void {}
}

/** a player with one film in it, and the clock that sink and player share */
function open(name: string): {
  player: MoviePlayer;
  sink: ClockedSink;
  /** advance to `now`, ticking every 10 ms so no hold is stepped over */
  runTo(now: number): void;
} | null {
  const path = `${MOVIES}/${name}`;
  if (!existsSync(path)) return null;
  const bytes = new Uint8Array(readFileSync(path));
  const sink = new ClockedSink();
  const session = new GameSession(
    (f) => (f.toLowerCase() === name.toLowerCase() ? bytes : null),
    sink,
  );
  session.onLog = () => {};
  const player = new MoviePlayer(session, () => {});
  player.onLog = () => {};
  return {
    player,
    sink,
    runTo(now: number) {
      // 10 ms a step: the film's shortest hold is a 3-tick 50 ms one, and a
      // coarser step would clear several frames at once and make "which frame
      // was on screen when" unanswerable.
      for (let t = sink.now + 10; t <= now; t += 10) {
        sink.now = t;
        player.tick(t);
      }
    },
  };
}

test("DOG1.MOV: the second growl starts after the first has finished", () => {
  const o = open("DOG1.MOV");
  if (!o) {
    console.warn(`no ${MOVIES} — skipping (needs the Dust rip)`);
    return;
  }
  const { player, sink, runTo } = o;
  void player.play("DOG1.MOV");
  runTo(20);
  expect(player.playing).toBe(true);

  // Frame 1 fires the growl and frame 2 is the frame that holds for it. Held to
  // the frame rate alone it would be 50 ms and the next growl would land at
  // 100 ms; the film is authored to wait the growl out.
  runTo(600);
  expect(sink.plays.length).toBe(1);
  const growl = sink.plays[0];
  expect(growl.channel).toBe("sound");
  expect(growl.seconds).toBeGreaterThan(0.8);
  expect(player.framePos).toBe(2);

  // still on frame 2 most of a second later, because the growl is still running
  runTo(1_000);
  expect(player.framePos).toBe(2);
  expect(sink.plays.length).toBe(1);

  // and the second growl arrives only once the first is out of the way, whole
  runTo(2_000);
  expect(sink.plays.length).toBe(2);
  expect(growl.displacedAt).toBe(null);
  expect(sink.plays[1].startedAt).toBeGreaterThanOrEqual(
    growl.startedAt + growl.seconds * 1000,
  );

  // the film is a two-growl film: ~2.4 s, not the ~1.0 s its holds add up to
  runTo(4_000);
  expect(player.playing).toBe(false);
});

test("DOG2.MOV: the bone is eaten to the end of the sound, not the pictures", () => {
  const o = open("DOG2.MOV");
  if (!o) return;
  const { player, sink, runTo } = o;
  void player.play("DOG2.MOV");
  runTo(20);

  // One 2.69 s sound fired on the opening frame, over seven frames whose holds
  // come to 0.92 s. Frame 5 is the one that carries the flag, so that is where
  // the film sits and waits — not the last frame, which then plays its own hold
  // out afterwards.
  expect(sink.plays.length).toBe(1);
  expect(sink.plays[0].seconds).toBeGreaterThan(2.5);
  runTo(1_500);
  expect(player.playing).toBe(true);
  expect(player.framePos).toBe(5);
  runTo(2_500);
  expect(player.framePos).toBe(5);
  runTo(2_900);
  expect(player.framePos).toBe(6);
  expect(player.playing).toBe(true);
  runTo(3_400);
  expect(player.playing).toBe(false);
  expect(sink.plays[0].stopped).toBe(false);
});
