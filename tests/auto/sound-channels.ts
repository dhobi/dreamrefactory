/**
 * currentsound(1|2) — the only way a script can ask "is that sound still
 * playing?", and the thing the bedsit landlady is sequenced by.
 *
 * The engine has two SFX channels; every script that waits on a sound tests
 * both. What makes this worth its own file is that the DEFAULT headless sink
 * reports a non-looping play as finished the instant it starts, so a sink-blind
 * suite cannot see the difference between "the gate held" and "there was no
 * gate". These tests bring their own clock-driven sink, which is the only way
 * the landlady bug was visible outside a browser: her five lines are separate
 * crickets, and crickets were played without ever being recorded on a channel,
 * so `if currentsound(1) = curlady | currentsound(2) = curlady` was permanently
 * false and all five started 1.3 s apart on top of each other.
 */
import { test, expect } from "vitest";
import { AudioChannel, AudioSink, PlayHandle, PlayOpts } from "../../src/engine/audio";
import { DecodedAudio } from "../../src/df/audio";
import { newHost, drain } from "../harness";

/**
 * A sink where a sound takes as long as it is: `done` flips once the test's own
 * clock has passed its duration, the way the browser's `src.onended` does.
 * Deliberately not the default — an instantly-done sound is what keeps the rest
 * of the suite from depending on wall time.
 */
class TimedAudioSink implements AudioSink {
  now = 0;
  /** every play, with the clock reading when it started */
  started: {
    channel: AudioChannel;
    audio: DecodedAudio;
    at: number;
    seconds: number;
    loop: boolean;
    /** an overlapping play shares the channel — the crickets, not the movies */
    overlap: boolean;
    handle: PlayHandle;
  }[] = [];
  channelVolume: Record<AudioChannel, number> = { sound: 1, voice: 1, theme: 0.6 };

  setChannelVolume(channel: AudioChannel, volume: number): void {
    this.channelVolume[channel] = volume;
  }
  play(channel: AudioChannel, audio: DecodedAudio, opts?: PlayOpts): PlayHandle {
    const seconds = audio.samples.length / audio.sampleRate;
    const at = this.now;
    let stopped = false;
    const sink = this;
    const handle: PlayHandle = {
      get done() {
        return stopped || (!opts?.loop && sink.now >= at + seconds * 1000);
      },
      stop: () => (stopped = true),
    };
    this.started.push({ channel, audio, at, seconds, loop: !!opts?.loop, overlap: !!opts?.overlap, handle });
    return handle;
  }
  halt(): void {}
  isDone(): boolean {
    return true;
  }
}

/** run the set's clock forward, keeping the sink's clock in step with it */
async function run(
  viewer: { tick(ms: number): void },
  sink: TimedAudioSink,
  ms: number,
): Promise<void> {
  const STEP = 66;
  for (let t = 0; t < ms; t += STEP) {
    sink.now += STEP;
    viewer.tick(sink.now);
    if (t % (STEP * 10) === 0) await drain();
  }
}

test("a cricket is visible to currentsound while it plays", async () => {
  const sink = new TimedAudioSink();
  const { session, host } = await newHost({ sink });
  await session.openSetFile("bedsit1.set");
  // citycricket is bedsit's positional ambience — the first cricket to fire
  await run(host.viewer!, sink, 5_000);
  const playing = [session.scheduler.currentSound(1), session.scheduler.currentSound(2)].filter(Boolean);
  expect(playing.length, "a fired cricket occupies a sound channel").toBeGreaterThan(0);
});

/**
 * The landlady, end to end.
 *
 * `lady()` re-arms itself on a short loop and starts the next line only when
 * the previous one has stopped; the lines are 1.6–5.2 s long. So the claim is
 * simply that no two of them are ever in the air at once — which is what a
 * listener in the bedsit hears, and what was wrong.
 */
test("the bedsit landlady says her lines one after another", async () => {
  const sink = new TimedAudioSink();
  const { session, host } = await newHost({ sink });
  await session.openSetFile("bedsit1.set");
  // Pick her lines out by IDENTITY, not by how long they are: AudioLibrary
  // caches a decoded sound per name, so the object the sink was handed IS the
  // one `lady2` resolves to. Duration would not do — citycricket, the bedsit's
  // traffic ambience, is 5.2013 s and so is lady3, and the traffic legitimately
  // plays over her.
  const lines = new Map<DecodedAudio, string>();
  for (let i = 0; i < 5; i++) {
    const audio = session.audioLib.sound(`lady${i}`);
    expect(audio, `lady${i} missing from the bedsit bank`).not.toBeNull();
    lines.set(audio!, `lady${i}`);
  }

  await run(host.viewer!, sink, 80_000);
  await session.settle();

  const spoken = sink.started
    .filter((s) => lines.has(s.audio))
    .map((s) => ({ name: lines.get(s.audio)!, at: s.at, ends: s.at + s.seconds * 1000 }));
  expect(spoken.length, "the landlady never spoke").toBeGreaterThanOrEqual(3);

  for (let i = 1; i < spoken.length; i++) {
    const prev = spoken[i - 1];
    expect(
      spoken[i].at / 1000,
      `${spoken[i].name} started at ${(spoken[i].at / 1000).toFixed(2)}s, over ${prev.name} which runs to ${(prev.ends / 1000).toFixed(2)}s`,
    ).toBeGreaterThanOrEqual(prev.ends / 1000);
  }
});

/**
 * The pocket watch's monologue, all 27 s of it.
 *
 * A one-shot sound record can name the frame to jump to WHEN THE SOUND ENDS
 * (MovSegment.soundFollows), and that jump comes due out of a region frame's
 * modal wait as readily as out of a hold. `bedcards.mov` is the corpus's only
 * user and needs it for all five chunks of the watch: one still picture, and
 * `01 -> "blah1" -> 02 -> "blah2" -> 03 -> "blah5" -> 06 -> "blah6" -> 07 ->
 * "endwatch"`. Without it the port played the first 6.97 s and sat on the frame
 * for ever — reported as "missing voice line upon picking up watch, plays only
 * first part of it".
 *
 * A clock-driven sink is the whole test: with the default one every chunk is
 * finished the instant it starts, so all five would fire in five ticks and the
 * one claim worth making — each waits for the one before — cannot be made.
 */
test("the watch's line carries the picture on, chunk by chunk", async () => {
  const sink = new TimedAudioSink();
  const { session, host } = await newHost({ sink });
  await session.openSetFile("bedsit1.set");
  const viewer = host.viewer!;
  await run(viewer, sink, 500);

  // the cards close-up, opened the way the room opens it: bedsit1's mousedown
  // switches on `target` and spotmovies the matching film
  const binding = session.currentBinding!;
  void binding.fire(binding.main, "mousedown", ["cards"], "cards");
  await run(viewer, sink, 1_000);
  expect(viewer.movieFile, "the cards close-up is up").toBe("bedcards.mov");

  // the watch, at the centre of its region (114,186-148,219) — the click the
  // report came with, and action frame 2 of the film
  await viewer.click(131, 202);
  await run(viewer, sink, 30_000);

  // the movie's own chunks are the non-overlapping plays; the room's crickets
  // (the landlady, the traffic) overlap and legitimately talk over them
  const spoken = sink.started.filter((p) => p.channel === "sound" && !p.overlap);
  expect(
    spoken.map((p) => Number(p.seconds.toFixed(2))),
    "01, 02, 03, 06, 07 — then endwatch's second of silence, which is how the film cuts itself off",
  ).toEqual([6.97, 6.73, 2.69, 7.2, 3.53, 1.02]);
  for (let i = 1; i < spoken.length; i++) {
    const prev = spoken[i - 1];
    expect(
      spoken[i].at,
      `chunk ${i + 1} started at ${(spoken[i].at / 1000).toFixed(2)}s, over one running to ${((prev.at + prev.seconds * 1000) / 1000).toFixed(2)}s`,
    ).toBeGreaterThanOrEqual(prev.at + prev.seconds * 1000);
  }
  // "endwatch" is a type-2 frame: the film lands back on the spread of cards,
  // still waiting, so the player can pick up something else
  expect(viewer.movieFile, "and the close-up is still open on the cards").toBe("bedcards.mov");
  expect(viewer.movieRegions.length, "parked on frame1, whose ten hotspots are the cards").toBe(10);
});

/**
 * A closed bank goes quiet — the ending's own bug, one channel over.
 *
 * The boat deck's crowd murmurs (`party1`..`party5` in cricket.sfx) are
 * positional crickets, and nothing in the scripts stops them; leaving the ship
 * closes the bank they come out of, which is what stops the NEXT one starting.
 * Our decode cache was keyed by NAME alone, so it went on answering for banks
 * the game had unloaded and fresh murmurs kept starting over debris.mov and the
 * whole closing narration. Keyed by bank, an unloaded bank has nothing to say.
 * (Stopping the ones already sounding is the other half, below.)
 *
 * Both directions are asserted, because the cheap fix (never cache) would pass
 * half of it: reopening the bank must find the sound again.
 */
test("a closed track bank stops answering for its sounds", async () => {
  const { session } = await newHost();
  const call = (n: string, a: (string | number)[]) =>
    (session.interp.builtins.get(n) as (i: unknown, args: (string | number)[]) => unknown)(session.interp, a);

  await call("opentrackfile", ["cricket.sfx"]);
  const first = session.audioLib.sound("party1");
  expect(first, "party1 is one of the boat deck's crowd murmurs").not.toBeNull();
  // decoded and cached now — which is the state the bug needed
  expect(session.audioLib.sound("party1"), "the same decode comes back").toBe(first);

  call("closetrackfile", ["cricket.sfx"]);
  expect(session.audioLib.bankNames, "the bank is unloaded").not.toContain("cricket.sfx");
  expect(session.audioLib.sound("party1"), "and it has nothing to play any more").toBeNull();

  await call("opentrackfile", ["cricket.sfx"]);
  expect(session.audioLib.sound("party1"), "reopened, it answers again").not.toBeNull();
});

/**
 * ...and the other half: a set's looping ambience stops when the set does.
 *
 * A `soundloop`-flagged cricket starts once and loops in place forever — that is
 * how every set runs positional ambience. Nothing in the corpus stops one:
 * `stopcricket("all")` appears exactly once in the whole script corpus, in
 * BOOTFILE's `initall`. So leaving a set by any other path left its ambience
 * sounding, positioned in a room that was no longer on screen, and closing its
 * bank did not help — an unloaded bank cannot stop a play that already started.
 *
 * `advanceday`'s endgame arm is that path: `closesetfile()` and straight into the
 * flats. The boat deck's five crowd loops talked all the way through leave.mov,
 * debris.mov, the closing narration and prozac.mov.
 *
 * Asserted here on the bedsit's traffic loop, which is the same shape and does
 * not need mission 4 dealt out: fire it, leave the set the way the endgame does,
 * and it must be stopped — not merely skipped by the re-fire guard, which is all
 * it ever was.
 */
test("a set's looping ambience stops when the set closes", async () => {
  const sink = new TimedAudioSink();
  const { session, host } = await newHost({ sink });
  await session.openSetFile("bedsit1.set");
  await run(host.viewer!, sink, 5_000);

  // citycricket: soundloop("citycricket", true) + makecricket(..., 4000, 45, 0).
  // The SOUND channel only — the set's theme is a looping play too, and a theme
  // outliving its set is a different question with a different answer (boot's
  // `keeptheme` deliberately carries one from room to room).
  const ambience = sink.started.filter((p) => p.loop && p.channel === "sound");
  expect(ambience.length, "the bedsit's traffic is a looping cricket").toBeGreaterThan(0);
  expect(
    ambience.filter((p) => !p.handle.done).length,
    "a looping cricket is still sounding — that is the point of one",
  ).toBeGreaterThan(0);

  // leave the way the endgame arm does: closesetfile(), no initall to stopcricket
  await (session.interp.builtins.get("closesetfile") as (i: unknown, a: unknown[]) => unknown)(
    session.interp,
    [],
  );
  await run(host.viewer!, sink, 1_000);
  for (const p of ambience) {
    expect(p.handle.done, "the ambience of a set that is gone must be silent").toBe(true);
  }
});
