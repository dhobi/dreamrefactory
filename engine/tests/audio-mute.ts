/**
 * The listener's mute, and the game's volume, kept apart (engine/src/runtime/audio.ts).
 *
 *   npx vitest run engine/tests/audio-mute.ts
 *
 * The workbench's Mute box is a switch for whoever is WATCHING a route, and the
 * thing that makes it hard is that the game has an opinion about volume too:
 * `wavevolume ()` and `themevol ()` write the channel gains whenever a script
 * feels like it — a room change, a movie, the panel's own sliders. A mute
 * implemented by writing zero into that would be undone by the next thing the
 * game said, silently and a few seconds later, which is the worst shape a bug
 * can have in a control somebody flips and then stops thinking about.
 *
 * So the two live in separate fields and the audible gain is their product. What
 * is pinned here is that: a volume written while muted stays inaudible and is
 * what unmuting restores, and neither the mute nor the volume can lose to the
 * other whichever order they arrive in.
 *
 * `DeferredAudioSink` gets its own case because the switch can be flipped before
 * there is anything to flip. An AudioContext may only be built from a user
 * gesture, so the game plays into the deferred sink until the first click — a box
 * ticked from `localStorage` when the page loads has nobody to tell yet, and the
 * flag has to survive the attach the way `suspended` already does.
 */
import { test, expect } from "vitest";
import { DeferredAudioSink, NullAudioSink, WebAudioSink } from "@dreamfactory/engine/runtime/audio";

test("the switch reaches the sink", () => {
  const sink = new NullAudioSink();
  expect(sink.muted).toBe(false);
  sink.setMuted(true);
  expect(sink.muted).toBe(true);
  sink.setMuted(false);
  expect(sink.muted).toBe(false);
});

test("a deferred sink remembers a mute set before it had a real one", () => {
  const deferred = new DeferredAudioSink();
  deferred.setMuted(true);
  const real = new NullAudioSink();
  deferred.attach(real);
  expect(real.muted).toBe(true);
});

test("and forwards one set after", () => {
  const deferred = new DeferredAudioSink();
  const real = new NullAudioSink();
  deferred.attach(real);
  deferred.setMuted(true);
  expect(real.muted).toBe(true);
});

test("unmuting before the attach does not arrive as a mute", () => {
  const deferred = new DeferredAudioSink();
  deferred.setMuted(true);
  deferred.setMuted(false);
  const real = new NullAudioSink();
  deferred.attach(real);
  expect(real.muted).toBe(false);
});

/**
 * The product, on the real sink.
 *
 * `WebAudioSink` builds an AudioContext, so it is handed a stand-in for one:
 * gain nodes whose `.value` can be read back, which is all this needs to see. It
 * is the real `setChannelVolume` and the real `setMuted` doing the arithmetic —
 * a test that re-implemented the two fields here would pass no matter what the
 * sink did with them.
 *
 * `followPageLifecycle` already returns early with no `document`, so nothing
 * else about the browser has to be faked.
 */
function fakeContext(): { ctx: AudioContext; gain: (n: number) => number } {
  const made: { gain: { value: number } }[] = [];
  const ctx = {
    destination: {},
    createGain: () => {
      const node = { gain: { value: 1 }, connect: () => {} };
      made.push(node);
      return node;
    },
    state: "running",
    suspend: () => Promise.resolve(),
    resume: () => Promise.resolve(),
  };
  // built in order: sound, voice, theme
  return { ctx: ctx as unknown as AudioContext, gain: (n) => made[n].gain.value };
}

test("a volume written while muted is inaudible, and is what unmuting restores", () => {
  const { ctx, gain } = fakeContext();
  const sink = new WebAudioSink(ctx);
  const SOUND = 0;
  const THEME = 2;

  // the theme node is built at 0.6, which is the volume the mute has to restore
  expect(gain(THEME)).toBeCloseTo(0.6);

  sink.setMuted(true);
  expect(gain(SOUND)).toBe(0);
  expect(gain(THEME)).toBe(0);

  // the game turns the theme up mid-mute, as a room change does
  sink.setChannelVolume("theme", 0.8);
  expect(gain(THEME)).toBe(0);

  sink.setMuted(false);
  expect(gain(THEME)).toBeCloseTo(0.8);
  expect(gain(SOUND)).toBeCloseTo(1);
});

test("and the other order: a volume, then the mute, then back", () => {
  const { ctx, gain } = fakeContext();
  const sink = new WebAudioSink(ctx);

  sink.setChannelVolume("voice", 0.5);
  expect(gain(1)).toBeCloseTo(0.5);
  sink.setMuted(true);
  expect(gain(1)).toBe(0);
  sink.setMuted(false);
  expect(gain(1)).toBeCloseTo(0.5);
});
