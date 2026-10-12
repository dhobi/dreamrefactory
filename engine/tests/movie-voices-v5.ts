import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { encodeAudioContainer, type DecodedAudio } from "../src/df/audio";
import { writeContainerFile } from "../src/df/container";
import { readMovFileV5 } from "../src/df/mov-v5";
import { NullAudioSink, TimedAudio, type AudioChannel, type PlayOpts } from "../src/runtime/audio";
import { MovieVoicesV5, moviePanV5 } from "../src/runtime/movie-voices-v5";
import { GameSession } from "../src/runtime/session";
import { MoviePlayer } from "../src/web/movie-player";

const pcm: DecodedAudio = { sampleRate: 1000, samples: new Float32Array(1000).fill(0.5) };
const sound = (index: number, flags = 8, pan = 128) => ({ index, flags, pan });

class ClockSink extends NullAudioSink {
  now = 0;
  starts: { at: number; opts?: PlayOpts; channel: AudioChannel }[] = [];
  override play(channel: AudioChannel, audio: DecodedAudio, opts?: PlayOpts) {
    super.play(channel, audio, opts);
    const call = this.calls.at(-1)!;
    const end = opts?.loop ? Infinity : this.now + call.seconds * 1000;
    const sink = this;
    this.starts.push({ at: this.now, opts, channel });
    return {
      get done() { return call.stopped || call.displaced || sink.now >= end; },
      stop() { call.stopped = true; },
    };
  }
}

test("V5 speech, two effects and the bed can coexist", () => {
  const sink = new ClockSink(), voices = new MovieVoicesV5();
  const bed = sink.play("voice", pcm, { loop: true });
  const speech = voices.play(sink, pcm, sound(4, 0))!;
  const a = voices.play(sink, pcm, sound(9, 10))!;
  const b = voices.play(sink, pcm, sound(10))!;
  expect([bed.done, speech.done, a.done, b.done]).toEqual([false, false, false, false]);
  expect(sink.starts[2].opts?.loop).toBe(true);
});

test("same-key restarts, lower-key drops, higher-key replaces only the lower slot", () => {
  const sink = new ClockSink(), voices = new MovieVoicesV5();
  const a = voices.play(sink, pcm, sound(5))!;
  const b = voices.play(sink, pcm, sound(7))!;
  expect(voices.play(sink, pcm, sound(4))).toBeNull();
  const restarted = voices.play(sink, pcm, sound(5))!;
  expect(a.done).toBe(true);
  expect(b.done).toBe(false);
  voices.play(sink, pcm, sound(6));
  expect(restarted.done).toBe(true);
  expect(b.done).toBe(false);
});

test("completed effects free a slot even for a lower-priority sound", () => {
  const sink = new ClockSink(), voices = new MovieVoicesV5();
  voices.play(sink, pcm, sound(5));
  const loop = voices.play(sink, pcm, sound(7, 10))!;
  sink.now = 1001;
  expect(voices.play(sink, pcm, sound(0))).not.toBeNull();
  expect(loop.done).toBe(false);
});

test("unflagged sounds replace speech without cutting effects; waits use their own slots", () => {
  const sink = new ClockSink(), voices = new MovieVoicesV5();
  const a = voices.play(sink, pcm, sound(0, 0))!;
  const loop = voices.play(sink, pcm, sound(2, 10))!;
  voices.play(sink, pcm, sound(1, 0));
  expect(a.done).toBe(true);
  sink.now = 1001;
  expect(voices.busy(false)).toBe(false);
  expect(voices.busy(true)).toBe(true);
  voices.stop();
  expect(loop.done).toBe(true);
  expect(voices.busy(true)).toBe(false);
});

test("overlapping handles keep their own lifetime under nominal time", () => {
  let now = 0;
  const sink = new TimedAudio(new NullAudioSink(), () => now, () => true);
  const loop = sink.play("sound", pcm, { overlap: true, loop: true });
  const short = sink.play("sound", pcm, { overlap: true });
  sink.play("sound", { ...pcm, samples: new Float32Array(2000) });
  expect(short.done).toBe(false);
  now = 1001;
  expect(short.done).toBe(true);
  expect(loop.done).toBe(false);
  loop.stop();
  expect(loop.done).toBe(true);
});

test("V5 pan keeps the unattenuated side at full level, including centre", () => {
  expect(moviePanV5(128)).toEqual([1, 1]);
  // -100 dB; 10 ** -5 computed at run time is 9.999...e-6, not the literal 1e-5
  expect(moviePanV5(0)[0]).toBe(1);
  expect(moviePanV5(0)[1]).toBeCloseTo(1e-5, 12);
  expect(moviePanV5(255)[0]).toBeCloseTo(1e-5, 12);
  expect(moviePanV5(255)[1]).toBe(1);
  expect(moviePanV5(64)[1]).toBeCloseTo(10 ** (-693 / 2000), 12);
  expect(moviePanV5(192)[0]).toBeCloseTo(10 ** (-701 / 2000), 12);
});

/** Small V5 container fixture: a speech, a looping effect, then a voice wait. */
function fixture(waitFlags = 1): Uint8Array {
  const head = new Uint8Array(0x7c + 3 * 46);
  const hv = new DataView(head.buffer);
  hv.setUint32(0, 0x50000, true); hv.setUint32(4, 0x4d484544, true);
  hv.setInt32(0x1c, 3, true); hv.setInt32(0x60, 5, true);
  hv.setInt16(0x70, 1, true); hv.setInt16(0x72, 1, true); hv.setInt32(0x78, 3, true);
  const picture = new Uint8Array(0x429);
  new DataView(picture.buffer).setInt16(0x20, 1, true);
  new DataView(picture.buffer).setInt16(0x22, 1, true);
  const pstr = (d: Uint8Array, at: number, s: string) => {
    d[at] = s.length; d.set(new TextEncoder().encode(s), at + 1);
  };
  const logic = ["speech", "effect", ""].map((name, i) => {
    const rec = 0x7c + i * 46;
    hv.setInt32(rec + 16, 1, true); hv.setInt32(rec + 20, 2 + i, true);
    const d = new Uint8Array(0x5e), v = new DataView(d.buffer);
    v.setInt16(0x18, i === 2 ? 1 : 6, true);
    d[0x1e] = i === 2 ? waitFlags : 0; pstr(d, 0x2a, name);
    return d;
  });
  const table = new Uint8Array(0x20 + 2 * 48), tv = new DataView(table.buffer);
  tv.setInt32(0x1c, 2, true);
  for (const [i, name] of ["speech", "effect"].entries()) {
    const at = 0x20 + i * 48;
    tv.setInt16(at + 4, i ? 255 : 128, true);
    tv.setInt16(at + 6, i ? 10 : 0, true);
    tv.setInt32(at + 10, 6, true); pstr(table, at + 16, name);
  }
  const data = [head, picture, ...logic, table, encodeAudioContainer(pcm)];
  return writeContainerFile({
    order: "le", headerRaw: new Uint8Array(1024),
    header: { fourCC: 0, fileSize: 0, containerCount: data.length, type: 0, gapWhere: 0 },
    containers: data.map((d, id) => ({ id, data: d })),
  });
}

test("V5 parser retains catalog index, pan, repeat/routing and effects-wait flag", () => {
  const mov = readMovFileV5(fixture(0x10));
  expect(mov.soundOptionsV5?.get("effect")).toEqual(sound(1, 10, 255));
  expect(mov.frames[2].waitsForEffects).toBe(true);
});

test("MoviePlayer keeps the line through the effect and does not wait on its loop", async () => {
  const data = fixture(), sink = new ClockSink();
  const session = new GameSession(() => data, sink);
  session.drawsPictures = false;
  const player = new MoviePlayer(session, () => {});
  const done = player.play("test.move");
  for (sink.now = 1; sink.now <= 1100 && player.playing; sink.now++) player.tick(sink.now);
  expect(player.playing).toBe(false);
  expect(sink.calls).toHaveLength(2);
  expect(sink.calls[0].displaced).toBe(false);
  expect(sink.now).toBeGreaterThanOrEqual(1000);
  expect(sink.calls[1].loop).toBe(true);
  expect(sink.calls[1].stopped).toBe(true);
  await done;
});

test("MoviePlayer waits on the effects pool when MFRM bit 4 is set", () => {
  const data = fixture(0x10), sink = new ClockSink();
  const session = new GameSession(() => data, sink);
  session.drawsPictures = false;
  const player = new MoviePlayer(session, () => {});
  void player.play("test.move");
  for (sink.now = 1; sink.now <= 1100; sink.now++) player.tick(sink.now);
  expect(player.playing).toBe(true);
  player.abandon();
  expect(sink.calls[1].stopped).toBe(true);
});

/** RedJack's own intro (#545, #546); skips loudly without redjack/gamefiles */
const INTRO = fileURLToPath(new URL("../../redjack/gamefiles/RJDisk1/movies/intro.move", import.meta.url));
const noIntro = !existsSync(INTRO);
if (noIntro) console.warn(`no RedJack intro at ${INTRO} — skipping`);

test.skipIf(noIntro)("original intro: boatwash does not displace 20w; all scenes finish", async () => {
  const data = readFileSync(INTRO);
  const sink = new ClockSink(), session = new GameSession(() => data, sink);
  session.drawsPictures = false;
  const names: { name: string; call: number }[] = [];
  session.captionMovieSound = (_file, name) => { names.push({ name, call: sink.calls.length - 1 }); };
  const player = new MoviePlayer(session, () => {});
  const done = player.play("intro.move");
  let checked = false;
  for (sink.now = 1; sink.now < 180000 && player.playing; sink.now++) {
    player.tick(sink.now);
    if (!checked && names.at(-1)?.name.toLowerCase() === "boatwash") {
      const speech = names.find((s) => s.name === "20w")!;
      expect(sink.calls[speech.call].displaced).toBe(false);
      expect(sink.calls[speech.call].stopped).toBe(false);
      expect(sink.starts.at(-1)?.opts?.loop).toBe(true);
      checked = true;
    }
  }
  expect(checked).toBe(true);
  expect(player.playing).toBe(false);
  expect(names.some((s) => s.name === "180")).toBe(true);
  const cannon = names.find((s) => s.name === "Cannon")!;
  const gains = sink.starts[cannon.call].opts?.stereoGains;
  expect(gains?.[0]).toBeCloseTo(1e-5, 12);
  expect(gains?.[1]).toBe(1);
  await done;
});
