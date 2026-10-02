/**
 * The audio sinks and the bank library (engine/src/runtime/audio.ts), on the
 * paths the games' suites do not take.
 *
 *   npx vitest run engine/tests/audio-sinks.ts
 *
 * Every machine suite plays into `NullAudioSink`, so the two sinks a page uses
 * were measured only by audio-mute.ts's gain arithmetic. What they are FOR went
 * unchecked: `DeferredAudioSink` holding a loop that starts before the first
 * click and handing it on, and `WebAudioSink` giving each play its own nodes,
 * cutting the channel's last play, and staying quiet while the page is hidden
 * or the world is frozen. The WebAudio graph is a stand-in that records what was
 * built and started; the page's lifecycle events are an `EventTarget` put where
 * `document` and `window` would be.
 */
import { afterEach, expect, test } from "vitest";
import { buildBankBytes } from "@dreamfactory/engine/df/banks-build";
import { AudioLibrary, DeferredAudioSink, NullAudioSink, WebAudioSink } from "@dreamfactory/engine/runtime/audio";

const tone = (n: number, sampleRate = 11025) => ({ sampleRate, samples: new Float32Array(n).fill(0.25) });

// ---- DeferredAudioSink ----

test("before the attach, a one-shot is dropped and a loop is held", () => {
  const d = new DeferredAudioSink();
  expect(d.attached).toBe(false);
  expect(d.play("sound", tone(10)).done).toBe(true);
  const theme = d.play("theme", tone(10), { loop: true });
  expect(theme.done).toBe(false);
  expect(d.isDone("theme")).toBe(false);
  expect(d.isDone("sound")).toBe(true);

  const real = new NullAudioSink();
  d.setChannelVolume("theme", 0.3);
  theme.place?.(0.5, -0.25);
  d.setSuspended(true);
  d.attach(real);
  expect(d.attached).toBe(true);
  expect(real.suspended).toBe(true);
  expect(real.channelVolume.theme).toBeCloseTo(0.3);
  // the held loop starts on the real sink, placed where it was told
  expect(real.calls).toMatchObject([{ channel: "theme", loop: true, volume: 0.5, pan: -0.25 }]);

  // the handle handed out before the attach still reaches the real play
  theme.place?.(0.1, 0.2);
  expect(real.calls[0]).toMatchObject({ volume: 0.1, pan: 0.2 });
  theme.stop();
  expect(real.calls[0].stopped).toBe(true);
  expect(theme.done).toBe(true);
});

test("a held loop that is stopped or halted before the attach never starts", () => {
  const d = new DeferredAudioSink();
  d.play("theme", tone(10), { loop: true }).stop();
  d.play("voice", tone(10), { loop: true });
  d.halt("voice");
  expect(d.isDone("voice")).toBe(true);
  const real = new NullAudioSink();
  d.attach(real);
  expect(real.calls).toEqual([]);
});

test("after the attach everything goes straight through", () => {
  const d = new DeferredAudioSink();
  const real = new NullAudioSink();
  d.attach(real);
  d.play("sound", tone(10));
  d.setChannelVolume("sound", 0.4);
  d.setSuspended(true);
  d.halt("sound");
  expect(real.calls).toHaveLength(1);
  expect(real.channelVolume.sound).toBeCloseTo(0.4);
  expect(real.suspended).toBe(true);
  expect(real.halts).toEqual(["sound"]);
  expect(d.isDone("sound")).toBe(true);
});

// ---- WebAudioSink ----

interface FakeSource {
  buffer: unknown;
  loop: boolean;
  onended: (() => void) | null;
  started: number;
  stopped: number;
  connect: (n: unknown) => void;
  start: () => void;
  stop: () => void;
}

function fakeContext() {
  const sources: FakeSource[] = [];
  const gains: { gain: { value: number } }[] = [];
  const panners: { pan: { value: number } }[] = [];
  const log: string[] = [];
  const ctx = {
    destination: {},
    state: "running" as string,
    createGain: () => {
      const g = { gain: { value: 1 }, connect: () => {} };
      gains.push(g);
      return g;
    },
    createStereoPanner: () => {
      const p = { pan: { value: 0 }, connect: () => {} };
      panners.push(p);
      return p;
    },
    createBuffer: (_ch: number, length: number, rate: number) => ({ length, rate, copyToChannel: () => {} }),
    createBufferSource: () => {
      const s: FakeSource = {
        buffer: null,
        loop: false,
        onended: null,
        started: 0,
        stopped: 0,
        connect: () => {},
        start: () => void s.started++,
        stop: () => {
          // a real source throws when stopped twice
          if (s.stopped++) throw new Error("InvalidStateError");
        },
      };
      sources.push(s);
      return s;
    },
    suspend: () => (log.push("suspend"), Promise.resolve()),
    resume: () => (log.push("resume"), Promise.resolve()),
    close: () => (log.push("close"), Promise.resolve()),
  };
  return { ctx, sources, gains, panners, log, sink: () => new WebAudioSink(ctx as unknown as AudioContext) };
}

test("a play takes its channel from the last one, unless it overlaps", () => {
  const f = fakeContext();
  const sink = f.sink();
  const first = sink.play("voice", tone(100));
  expect(f.sources[0].started).toBe(1);
  expect(sink.isDone("voice")).toBe(false);

  sink.play("voice", tone(100));
  expect(f.sources[0].stopped).toBe(1);
  // the cut play's own stop is then a no-op, not a second stop on the node
  first.stop();
  sink.play("voice", tone(100), { overlap: true });
  expect(f.sources[1].stopped).toBe(0);

  f.sources[1].onended?.();
  expect(sink.isDone("voice")).toBe(true);
  expect(sink.isDone("theme")).toBe(true);
});

test("a placed play gets its own gain and panner, clamped, and moves with place()", () => {
  const f = fakeContext();
  const sink = f.sink();
  const channelGains = f.gains.length;
  const h = sink.play("sound", tone(10), { volume: 2, pan: -3, loop: true });
  expect(f.sources[0].loop).toBe(true);
  const gain = f.gains[channelGains];
  expect(gain.gain.value).toBe(1);
  expect(f.panners[0].pan.value).toBe(-1);
  h.place?.(-1, 0.5);
  expect(gain.gain.value).toBe(0);
  expect(f.panners[0].pan.value).toBe(0.5);

  // an unplaced play builds neither
  sink.play("voice", tone(10));
  expect(f.gains.length).toBe(channelGains + 1);
  expect(f.panners.length).toBe(1);
});

test("a stopped handle is done, and a stop on a source already stopped is swallowed", () => {
  const f = fakeContext();
  const sink = f.sink();
  const h = sink.play("sound", tone(10));
  f.sources[0].stop();
  h.stop();
  expect(h.done).toBe(true);
  sink.play("voice", tone(10));
  f.sources[1].stop();
  expect(() => sink.halt("voice")).not.toThrow();
});

test("a parked context wakes on a play, but not while the world is frozen", () => {
  const f = fakeContext();
  const sink = f.sink();
  f.ctx.state = "suspended";
  sink.setSuspended(true);
  sink.play("sound", tone(10));
  expect(f.log).toEqual(["suspend"]);
  sink.setSuspended(false);
  expect(f.log).toEqual(["suspend", "resume"]);
  sink.play("sound", tone(10));
  expect(f.log).toEqual(["suspend", "resume", "resume"]);
});

// The page lifecycle, with `document` and `window` stood in for.
const g = globalThis as Record<string, unknown>;
afterEach(() => {
  delete g.document;
  delete g.window;
});

test("a hidden page suspends the sound, and coming back resumes it unless the game is frozen", async () => {
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const win = new EventTarget();
  g.document = doc;
  g.window = win;
  const f = fakeContext();
  const sink = f.sink();

  doc.hidden = true;
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(f.log).toEqual(["suspend"]);
  // a play while hidden does not wake a context that is parked
  f.ctx.state = "suspended";
  sink.play("theme", tone(10), { loop: true });
  // nor does thawing the game while the page is away
  sink.setSuspended(true);
  sink.setSuspended(false);
  expect(f.log).toEqual(["suspend", "suspend"]);

  win.dispatchEvent(new Event("pageshow"));
  expect(f.log.at(-1)).toBe("resume");

  sink.setSuspended(true);
  win.dispatchEvent(new Event("pagehide"));
  doc.hidden = false;
  doc.dispatchEvent(new Event("visibilitychange"));
  // still frozen: back on the tab is not a reason to start the music
  expect(f.log.at(-1)).toBe("suspend");

  await sink.dispose();
  expect(f.log.at(-1)).toBe("close");
  expect(f.sources[0].stopped).toBe(1);
  // the listeners went with it
  const before = f.log.length;
  win.dispatchEvent(new Event("pagehide"));
  expect(f.log.length).toBe(before);
});

// ---- AudioLibrary ----

test("a bank that will not parse is not opened", () => {
  const lib = new AudioLibrary();
  expect(lib.openBank("junk.trk", new Uint8Array([1, 2, 3]))).toBe(false);
  expect(lib.bankNames).toEqual([]);
});

test("a bank is found by file name or by the track name it calls itself", () => {
  const lib = new AudioLibrary();
  const bytes = buildBankBytes({
    name: "narend.trk",
    loops: [
      { identifier: "a", audio: tone(40) },
      { identifier: "b", audio: tone(20, 22050) },
    ],
    singles: [{ identifier: "door", audio: tone(30) }],
  });
  expect(lib.openBank("PNAREND.TRK", bytes)).toBe(true);
  // a second open of the same file is the same bank
  expect(lib.openBank("pnarend.trk", bytes)).toBe(true);
  expect(lib.bankNames).toEqual(["pnarend.trk"]);
  expect(lib.trackNameOf("narend.trk")).toBe("narend.trk");
  expect(lib.trackNameOf("nothing")).toBeNull();
  expect(lib.soundNames("narend.trk")).toEqual(["door"]);
  expect(lib.trackNames()).toEqual(["pnarend.trk"]);
  expect(lib.sound("DOOR.WAV")).toBe(lib.sound("door"));
  expect(lib.sound("window")).toBeNull();

  // the theme is both chunks brought up to the faster rate
  const theme = lib.theme("narend.trk")!;
  expect(theme.sampleRate).toBe(22050);
  expect(theme.samples.length).toBe(80 + 20);
  expect(lib.theme()).toBe(theme);
  expect(lib.loopTable("narend.trk")?.order).toEqual([1, 2]);
  expect(lib.loopTable("nothing")).toBeNull();

  // themeorder: unknown banks and lists that name no loop change nothing
  expect(lib.setThemeOrder("nothing", [1])).toBe(false);
  expect(lib.setThemeOrder("narend.trk", [7])).toBe(false);
  expect(lib.setThemeOrder("narend.trk", [2])).toBe(true);
  expect(lib.theme("narend.trk")!.samples.length).toBe(20);

  // closing by the track name drops the file, and what was decoded from it
  const closed: string[][] = [];
  lib.onSoundsClosed = (names) => void closed.push(names);
  expect(lib.closeBank("narend.trk")).toEqual(["pnarend.trk"]);
  expect(closed).toEqual([["door"]]);
  expect(lib.sound("door")).toBeNull();
  expect(lib.theme()).toBeNull();
  expect(lib.closeBank("narend.trk")).toEqual([]);
});
