/**
 * DreamFactory 1's two sound-effect channels and the rules that share them.
 *
 *   npx vitest run engine/tests/sound-channels-v1.ts
 *
 * DF.EXE keeps a priority per channel — the +0x39 dword of the sound record it
 * copied, `bank << 16 | record` (0x407e50), zeroed once the clip is over
 * (0x429ba0) — and each play builtin picks the LOWER channel (channel 2 on a
 * tie) by its own rule:
 *
 *   singlesound   0x42a070  only a clip that outranks it, and never one the
 *                           other channel already holds
 *   multiplesound 0x42a160  at least its rank; a clip the other channel holds
 *                           restarts there
 *   dualsound     0x42a250  a call to singlesound
 *   bothsound     0x42a260  always
 *
 * `sounddone()` is both channels idle (0x429c00), and `currentsound()` takes no
 * channel: the busy one, or with both busy the higher priority, channel 2 on a
 * tie (0x429e10). TI.EXE and tl.exe share singlesound's and multiplesound's
 * rules, and play dualsound on every channel the clip outranks and bothsound on
 * both (0x425330, 0x425400).
 */
import { expect, test, vi } from "vitest";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import type { DecodedAudio } from "@dreamfactory/engine/df/audio";
import type { AudioChannel, AudioSink, PlayHandle, PlayOpts } from "@dreamfactory/engine/runtime/audio";
import { pickSoundChannelV1 } from "@dreamfactory/engine/runtime/sound-channels-v1";
import { GameSession } from "@dreamfactory/engine/runtime/session";

test("the rules, as DF.EXE branches them", () => {
  // idle: both 0, the tie goes to channel 2 (index 1)
  expect(pickSoundChannelV1("single", 5, 0, 0)).toBe(1);
  // channel 1 is lower: an outranking clip takes it...
  expect(pickSoundChannelV1("single", 5, 3, 7)).toBe(0);
  // ...an equal or lower one does not, nor the clip channel 2 holds
  expect(pickSoundChannelV1("single", 3, 3, 7)).toBe(-1);
  expect(pickSoundChannelV1("single", 2, 3, 7)).toBe(-1);
  expect(pickSoundChannelV1("single", 7, 3, 7)).toBe(-1);
  // multiplesound takes an equal rank, and restarts the other channel's clip
  expect(pickSoundChannelV1("multiple", 3, 3, 7)).toBe(0);
  expect(pickSoundChannelV1("multiple", 7, 3, 7)).toBe(1);
  expect(pickSoundChannelV1("multiple", 2, 3, 7)).toBe(-1);
  // ...the mirror image with channel 2 lower
  expect(pickSoundChannelV1("multiple", 7, 7, 3)).toBe(0);
  expect(pickSoundChannelV1("multiple", 4, 7, 3)).toBe(1);
  // bothsound always takes the lower channel
  expect(pickSoundChannelV1("both", 1, 3, 7)).toBe(0);
  expect(pickSoundChannelV1("both", 1, 7, 3)).toBe(1);
  expect(pickSoundChannelV1("both", 1, 7, 7)).toBe(1);
});

/** a sink whose clips play until stopped or ended by the test */
class HeldSink implements AudioSink {
  plays: { name: string; ended: boolean; stopped: boolean }[] = [];
  play(_c: AudioChannel, audio: DecodedAudio, _o?: PlayOpts): PlayHandle {
    const p = { name: (audio as DecodedAudio & { name: string }).name, ended: false, stopped: false };
    this.plays.push(p);
    return {
      get done() {
        return p.ended || p.stopped;
      },
      stop: () => (p.stopped = true),
    };
  }
  halt(): void {}
  isDone(): boolean {
    return true;
  }
  setChannelVolume(): void {}
  setSuspended(): void {}
  /** end the latest play of a clip, as its last sample would */
  end(name: string): void {
    const p = this.plays.filter((q) => q.name === name).pop();
    if (p) p.ended = true;
  }
}

/** a session with three clips of rising priority, in the bank order of `ranks` */
function session(v1: boolean) {
  const sink = new HeldSink();
  const s = new GameSession(() => null, sink);
  s.dfVersion = v1 ? 1 : 4;
  const ranks: Record<string, number> = { low: 1, mid: 2, high: 0x10001 };
  vi.spyOn(s.audioLib, "sound").mockImplementation(
    (n: string) => (n in ranks ? ({ name: n, sampleRate: 11025, samples: new Float32Array(11025) } as DecodedAudio) : null),
  );
  vi.spyOn(s.audioLib, "soundPriorityV1").mockImplementation((n: string) => ranks[n] ?? 0);
  vi.spyOn(s.audioLib, "soundPriorityV4").mockImplementation((n: string) => ranks[n] ?? 0);
  return { s, sink };
}

async function call(s: GameSession, line: string): Promise<unknown> {
  const inst = s.instanceFrom(compileScript(`code go ()\n\treturn (${line})\nendcode\n`), "t")!;
  return (await s.interp.runHandler(inst, "go", [], { me: "t", target: "" })).value;
}
const play = async (s: GameSession, builtin: string, name: string) => {
  const inst = s.instanceFrom(compileScript(`code go ()\n\t${builtin} ("${name}")\nendcode\n`), "t")!;
  await s.interp.runHandler(inst, "go", [], { me: "t", target: "" });
};

test("singlesound never restarts a clip and only displaces a lower one", async () => {
  const { s, sink } = session(true);
  await play(s, "singlesound", "mid"); // channel 2
  await play(s, "singlesound", "mid"); // playing: not again
  expect(sink.plays.map((p) => p.name)).toEqual(["mid"]);
  await play(s, "singlesound", "low"); // channel 1 is idle (0): low outranks it
  await play(s, "singlesound", "low"); // now channel 1 holds it: not again
  expect(sink.plays.map((p) => p.name)).toEqual(["mid", "low"]);
  expect(s.scheduler.sounds.onChannel(1)).toBe("low");
  expect(s.scheduler.sounds.onChannel(2)).toBe("mid");
  // high replaces the LOWER channel (1, low) and leaves mid playing
  await play(s, "singlesound", "high");
  expect(sink.plays.find((p) => p.name === "low")!.stopped).toBe(true);
  expect(sink.plays.find((p) => p.name === "mid")!.stopped).toBe(false);
  expect(s.scheduler.sounds.onChannel(1)).toBe("high");
  // both busy: currentsound() answers the higher priority, whatever it is asked
  expect(await call(s, 'currentsound (2)')).toBe("high");
  expect(await call(s, "sounddone ()")).toBe(false);
  // a lower clip finds no room
  await play(s, "singlesound", "low");
  expect(sink.plays.filter((p) => p.name === "low")).toHaveLength(1);
  // dualsound is singlesound
  await play(s, "dualsound", "mid");
  expect(sink.plays.filter((p) => p.name === "mid")).toHaveLength(1);
  sink.end("high");
  expect(await call(s, "currentsound ()")).toBe("mid");
  sink.end("mid");
  expect(await call(s, "currentsound ()")).toBe("none");
  expect(await call(s, "sounddone ()")).toBe(true);
});

test("multiplesound restarts a clip in place; bothsound always plays", async () => {
  const { s, sink } = session(true);
  await play(s, "singlesound", "mid"); // channel 2
  await play(s, "multiplesound", "mid"); // the other channel holds it: restart there
  expect(sink.plays.map((p) => [p.name, p.stopped])).toEqual([
    ["mid", true],
    ["mid", false],
  ]);
  expect(s.scheduler.sounds.onChannel(1)).toBe("none");
  expect(s.scheduler.sounds.onChannel(2)).toBe("mid");
  await play(s, "bothsound", "low"); // channel 1 (idle, lower)
  await play(s, "bothsound", "low"); // and again, over itself
  expect(sink.plays.filter((p) => p.name === "low").map((p) => p.stopped)).toEqual([true, false]);
  // haltsound stops both channels
  await play(s, "haltsound", "");
  expect(await call(s, "sounddone ()")).toBe(true);
});

test("DreamFactory 4: the same single rule; dualsound on every channel it outranks, bothsound on both", async () => {
  const { s, sink } = session(false);
  await play(s, "singlesound", "mid");
  await play(s, "singlesound", "mid"); // 0x425150: playing, not again
  expect(sink.plays.map((p) => p.name)).toEqual(["mid"]);
  await play(s, "dualsound", "high"); // outranks idle channel 1 and mid on 2: both
  expect(sink.plays.map((p) => p.name)).toEqual(["mid", "high", "high"]);
  expect(sink.plays[0].stopped).toBe(true);
  await play(s, "bothsound", "low"); // 0x425400: both, whatever they hold
  expect(sink.plays.filter((p) => !p.stopped).map((p) => p.name)).toEqual(["low", "low"]);
  expect(await call(s, "sounddone ()")).toBe(false);
  // haltsound (1): channel 1 only (0x44d0d0)
  await s.interp.runHandler(s.instanceFrom(compileScript("code go ()\n\thaltsound (1)\nendcode\n"), "t")!, "go", [], { me: "t", target: "" });
  expect(await call(s, "currentsound (1)")).toBe("none");
  expect(await call(s, "currentsound (2)")).toBe("low");
});
