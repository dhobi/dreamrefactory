/**
 * A stand-in WebAudio graph for the engine's suites: an `AudioContext` that
 * records the nodes built from it (sources, gains, panners, mergers, and the
 * splitters with the output each connection took from them) and its
 * suspend/resume/close calls in `log`, and whose buffer sources count their
 * starts and stops (a second stop throws, as a real one does). `sink()` makes
 * a `WebAudioSink` playing into it.
 */
import { WebAudioSink } from "@dreamfactory/engine/runtime/audio";

export interface FakeSource {
  buffer: unknown;
  loop: boolean;
  loopStart?: number;
  loopEnd?: number;
  onended: (() => void) | null;
  started: number;
  stopped: number;
  connect: (n: unknown) => void;
  start: () => void;
  stop: () => void;
}

export function fakeContext() {
  const sources: FakeSource[] = [];
  const gains: { gain: { value: number } }[] = [];
  const panners: { pan: { value: number } }[] = [];
  const mergers: unknown[] = [];
  const splitters: { outputs: number[] }[] = [];
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
    createChannelSplitter: () => {
      const sp = { outputs: [] as number[], connect: (_n: unknown, output = 0) => void sp.outputs.push(output) };
      splitters.push(sp);
      return sp;
    },
    createChannelMerger: () => {
      const m = { connect: () => {} };
      mergers.push(m);
      return m;
    },
    createBuffer: (channels: number, length: number, rate: number) => {
      const samples: Float32Array[] = [];
      return { channels, length, rate, samples, duration: length / rate,
        copyToChannel: (data: Float32Array, channel: number) => { samples[channel] = data.slice(); } };
    },
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
  return { ctx, sources, gains, panners, mergers, splitters, log, sink: () => new WebAudioSink(ctx as unknown as AudioContext) };
}
