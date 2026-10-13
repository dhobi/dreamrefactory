/**
 * Dust's movie TRANSITIONS — record +0x06 of a v1 frame, DF.EXE's 19-entry
 * table at 0x405c9c — and the voice wait that used to be read out of it.
 *
 *   npx vitest run dust/tests/movie-effects.ts
 *
 * Three layers, each on its own clock and none in a browser:
 *
 *   1. The dispatch: every entry's copies, copy for copy, against traces of the
 *      routines themselves run over DF.EXE's bytes in an x86 emulator (the
 *      numbers below are that emulator's output, not this port's). Needs no rip.
 *   2. The disc: which codes the shipped films use, that the dirty rect is
 *      exact, and that the voice wait is +0x1a bit 0 and nothing else.
 *   3. The player: a film's first frame fades in over its hold and a page of
 *      the newspaper wipes up over it — the MoviePlayer ticked in node.
 *
 * engine/src/df/mov-v1-effects.ts has the disassembly.
 */
import { test, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BLACK_V1,
  EFFECT_V1_ROUTINES,
  EffectScreenV1,
  FULL_V1,
  effectPlanV1,
  fadeLevelV1,
  fadePaletteV1,
  type EffectCopyV1,
  type RectV1,
} from "@dreamfactory/engine/df/mov-v1-effects";
import {
  compositeFrameV1,
  movFileFromV1,
  readMovFileV1,
} from "@dreamfactory/engine/df/mov-v1";
import { decodeFrame, FrameBuffer } from "@dreamfactory/engine/df/image";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { MoviePlayer } from "@dreamfactory/engine/web/movie-player";
import { ScreenDirector, type RoomLayer } from "@dreamfactory/engine/web/screen-director";

const MOVIE_DIR = fileURLToPath(
  new URL("../gamefiles/dustcd/MOVIES", import.meta.url),
);
const movies = (): string[] =>
  existsSync(MOVIE_DIR)
    ? readdirSync(MOVIE_DIR)
        .filter((f) => /\.mov$/i.test(f))
        .sort()
    : [];
const noRip = movies().length === 0;
if (noRip) console.warn(`no ${MOVIE_DIR} — skipping (needs the Dust rip)`);
const read = (name: string) =>
  readMovFileV1(new Uint8Array(readFileSync(join(MOVIE_DIR, name))));
/** every film that reads — ZUNUSED's cut content says version 0 and does not */
function* films() {
  for (const name of movies()) {
    try {
      yield { name, mov: read(name) };
    } catch {
      /* not a v1 film */
    }
  }
}

const r = (s: string): RectV1 => {
  const [top, left, bottom, right] = s.split(",").map(Number);
  return { top, left, bottom, right };
};
const show = (rc: RectV1): string => `${rc.top},${rc.left},${rc.bottom},${rc.right}`;
/** a step's copies the way the traces print them: `src` or `src>dst` */
const step = (copies: EffectCopyV1[]): string =>
  copies
    .map((c) => (show(c.src) === show(c.dst) ? show(c.src) : `${show(c.src)}>${show(c.dst)}`))
    .join(" ");

/** the C runtime's rand() stood in for by the sequence the traces were run with */
const traceRand = () => {
  let n = 0;
  return (k: number) => ((++n * 7919) % k) + 1;
};

/*
 * Emulator traces of each table entry's routine (0x405cf0 .. 0x406a70) over a
 * 512x264 dirty rect in 4 steps: `at[k]` is what was copied after k waits on
 * the tick (0x406ad0). 12 and 13 are summarised — 53 and 422 copies a step.
 */
const TRACE_264x512_N4: Record<number, string[]> = {
  0: ["0,0,264,52 0,460,264,512", "0,52,264,104 0,408,264,460", "0,104,264,156 0,356,264,408", "0,156,264,208 0,304,264,356", "0,0,264,512"],
  1: ["0,204,264,256 0,256,264,308", "0,152,264,204 0,308,264,360", "0,100,264,152 0,360,264,412", "0,48,264,100 0,412,264,464", "0,0,264,512"],
  2: ["0,0,27,512 237,0,264,512 0,460,264,512 0,0,264,52", "27,0,54,512 210,0,237,512 0,408,264,460 0,52,264,104", "54,0,81,512 183,0,210,512 0,356,264,408 0,104,264,156", "81,0,108,512 156,0,183,512 0,304,264,356 0,156,264,208", "0,0,264,512"],
  3: ["105,204,159,308", "78,152,186,360", "51,100,213,412", "24,48,240,464", "0,0,264,512"],
  4: ["197,0,264,512>0,0,67,512", "130,0,264,512>0,0,134,512", "63,0,264,512>0,0,201,512", "-4,0,264,512>0,0,268,512", "0,0,264,512"],
  5: ["0,0,67,512>197,0,264,512", "0,0,134,512>130,0,264,512", "0,0,201,512>63,0,264,512", "0,0,268,512>-4,0,264,512", "0,0,264,512"],
  6: ["0,383,264,512>0,0,264,129", "0,254,264,512>0,0,264,258", "0,125,264,512>0,0,264,387", "0,-4,264,512>0,0,264,516", "0,0,264,512"],
  7: ["0,0,264,129>0,383,264,512", "0,0,264,258>0,254,264,512", "0,0,264,387>0,125,264,512", "0,0,264,516>0,-4,264,512", "0,0,264,512"],
  8: ["0,0,67,512", "67,0,134,512", "134,0,201,512", "201,0,268,512", "0,0,264,512"],
  9: ["197,0,264,512", "130,0,197,512", "63,0,130,512", "-4,0,63,512", "0,0,264,512"],
  10: ["0,0,264,129", "0,129,264,258", "0,258,264,387", "0,387,264,516", "0,0,264,512"],
  11: ["0,383,264,512", "0,254,264,383", "0,125,264,254", "0,-4,264,125", "0,0,264,512"],
  14: ["211,0,264,512", "105,0,158,512", "0,0,52,512", "52,0,105,512", "0,0,264,512"],
  15: ["0,409,264,512", "0,204,264,307", "0,0,264,102", "0,102,264,204", "0,0,264,512"],
  16: ["0,0,264,512"],
  17: ["0,0,264,512"],
  18: ["0,0,264,512"],
};
/** [copies, first, last] a step, for the two that copy in bulk */
const TRACE_BULK_N4: Record<number, [number, string, string][]> = {
  12: [[53, "0,0,1,512", "260,0,261,512"], [53, "0,0,2,512", "260,0,262,512"], [53, "0,0,3,512", "260,0,263,512"], [53, "0,0,4,512", "260,0,264,512"], [1, "0,0,264,512", "0,0,264,512"]],
  13: [[422, "0,32,8,40", "256,480,264,488"], [422, "0,8,8,16", "256,456,264,464"], [422, "0,16,8,24", "256,464,264,472"], [422, "0,24,8,32", "256,472,264,480"], [1, "0,0,264,512", "0,0,264,512"]],
};
/** the same routines over an off-origin rect, odd sizes, 3 steps */
const TRACE_OFFSET_N3: Record<number, string[]> = {
  0: ["13,37,200,71 13,267,200,301", "13,71,200,105 13,233,200,267", "13,105,200,139 13,199,200,233", "13,37,200,301"],
  1: ["13,135,200,169 13,169,200,203", "13,101,200,135 13,203,200,237", "13,67,200,101 13,237,200,271", "13,37,200,301"],
  2: ["13,37,37,301 176,37,200,301 13,267,200,301 13,37,200,71", "37,37,61,301 152,37,176,301 13,233,200,267 13,71,200,105", "61,37,85,301 128,37,152,301 13,199,200,233 13,105,200,139", "13,37,200,301"],
  3: ["82,135,130,203", "58,101,154,237", "34,67,178,271", "13,37,200,301"],
  4: ["137,37,200,301>13,37,76,301", "74,37,200,301>13,37,139,301", "11,37,200,301>13,37,202,301", "13,37,200,301"],
  5: ["13,37,76,301>137,37,200,301", "13,37,139,301>74,37,200,301", "13,37,202,301>11,37,200,301", "13,37,200,301"],
  6: ["13,212,200,301>13,37,200,126", "13,123,200,301>13,37,200,215", "13,34,200,301>13,37,200,304", "13,37,200,301"],
  7: ["13,37,200,126>13,212,200,301", "13,37,200,215>13,123,200,301", "13,37,200,304>13,34,200,301", "13,37,200,301"],
  8: ["13,37,76,301", "76,37,139,301", "139,37,202,301", "13,37,200,301"],
  9: ["137,37,200,301", "74,37,137,301", "11,37,74,301", "13,37,200,301"],
  10: ["13,37,200,126", "13,126,200,215", "13,215,200,304", "13,37,200,301"],
  11: ["13,212,200,301", "13,123,200,212", "13,34,200,123", "13,37,200,301"],
};

test("all 19 entries of 0x405c9c are their own routine", () => {
  expect(EFFECT_V1_ROUTINES).toHaveLength(19);
  expect(new Set(EFFECT_V1_ROUTINES).size).toBe(19);
});

test("each entry copies what DF.EXE's routine copies, step for step", () => {
  const R = r("0,0,264,512");
  for (const [code, want] of Object.entries(TRACE_264x512_N4)) {
    const plan = effectPlanV1({ code: +code, rect: R, block: 8 }, 4, traceRand());
    expect(plan.at.map(step), `effect ${code}`).toEqual(want);
  }
  for (const [code, want] of Object.entries(TRACE_BULK_N4)) {
    const plan = effectPlanV1({ code: +code, rect: R, block: 8 }, 4, traceRand());
    expect(
      plan.at.map((s) => [s.length, show(s[0].dst), show(s[s.length - 1].dst)]),
      `effect ${code}`,
    ).toEqual(want);
  }
  const off = r("13,37,200,301");
  for (const [code, want] of Object.entries(TRACE_OFFSET_N3)) {
    const plan = effectPlanV1({ code: +code, rect: off, block: 8 }, 3, traceRand());
    expect(plan.at.map(step), `effect ${code} off-origin`).toEqual(want);
  }
});

test("a transition spends the frame's hold: one tick a step, 16 none", () => {
  const R = r("0,0,264,512");
  for (let code = 0; code <= 18; code++) {
    const plan = effectPlanV1({ code, rect: R, block: 8 }, 30);
    expect(plan.ticks, `effect ${code}`).toBe(code === 16 ? 0 : 30);
    // the reveals end on one full copy of the dirty rect, after the last wait
    if (code < 16) {
      expect(plan.at).toHaveLength(31);
      expect(step(plan.at[30])).toBe("0,0,264,512");
    } else expect(plan.at).toHaveLength(1);
    expect(plan.fade).toBe(code === 17 ? "out" : code === 18 ? "in" : null);
    // 17/18 leave the "palette not yet set" word alone (0x405c70 / 0x405c85)
    expect(plan.setsPalette).toBe(code < 17);
  }
  // past the table (0x4058cd `ja 0x405c93`) nothing at all is drawn
  expect(effectPlanV1({ code: 19, rect: R, block: 8 }, 30).at).toEqual([]);
  // an empty dirty rect draws nothing (0x404dad -> 0x405780), but still fades
  const empty = r("20000,20000,0,0");
  expect(effectPlanV1({ code: 9, rect: empty, block: 8 }, 30).at).toEqual([]);
  expect(effectPlanV1({ code: 17, rect: empty, block: 8 }, 30).fade).toBe("out");
});

test("the fades: 0x4306a0's clamps, and a black that outlives the frame", () => {
  // step 0..n-1 over n-1, both clamped to at least 1: the first step is already
  // one in, the last is the whole way
  const out5 = [0, 1, 2, 3, 4].map((e) => fadeLevelV1("out", 5, e));
  expect(out5.map((l) => `${l.from}:${l.s}/${l.d}`)).toEqual([
    "movie:1/4", "movie:1/4", "movie:2/4", "movie:3/4", "movie:4/4",
  ]);
  // a one-tick fade lands at once
  expect(fadeLevelV1("in", 1, 0)).toEqual({ from: "black", s: 1, d: 1 });

  // entry 1 is faded; 0 and 255 stay black and white (0x421f30 forces them)
  const rgba = new Uint8ClampedArray(256 * 4);
  rgba.set([200, 100, 50, 255], 4);
  rgba.set([255, 255, 255, 255], 255 * 4);
  const one = (l: Parameters<typeof fadePaletteV1>[1]) => [...fadePaletteV1(rgba, l).slice(4, 8)];
  expect(one(FULL_V1)).toEqual([200, 100, 50, 255]);
  expect(one(BLACK_V1)).toEqual([0, 0, 0, 255]);
  expect(one({ from: "movie", s: 1, d: 2 })).toEqual([100, 50, 25, 255]);
  expect(one({ from: "black", s: 4, d: 4 })).toEqual([200, 100, 50, 255]);
  const black = fadePaletteV1(rgba, BLACK_V1);
  expect([...black.slice(0, 4)]).toEqual([0, 0, 0, 0]);
  expect([...black.slice(255 * 4)]).toEqual([255, 255, 255, 255]);

  // On the screen: a 17 leaves it black, a plain frame after it does NOT set
  // the palette back (its "not yet set" word went down with the segment's
  // first frame), and an 18 brings it up again — SPANBLD's black beats.
  const fx = new EffectScreenV1();
  const pic = new Uint8Array(4).fill(7);
  const rect = r("0,0,2,2");
  fx.startSegment();
  fx.enter({ code: 16, rect, block: 8 }, 3, pic, 2, 2);
  expect(fx.at(0).level).toEqual(FULL_V1);
  fx.enter({ code: 17, rect, block: 8 }, 3, pic, 2, 2);
  expect(fx.at(0).level).toEqual({ from: "movie", s: 1, d: 2 });
  expect(fx.at(2).level).toEqual({ from: "movie", s: 2, d: 2 });
  fx.enter({ code: 16, rect, block: 8 }, 3, pic, 2, 2);
  expect(fx.at(5).level).toEqual({ from: "movie", s: 2, d: 2 });
  fx.enter({ code: 18, rect, block: 8 }, 3, pic, 2, 2);
  expect(fx.at(0).level).toEqual({ from: "black", s: 1, d: 2 });
  expect(fx.at(9).level).toEqual({ from: "black", s: 2, d: 2 });
  // ...and a new segment's first plain frame does set it (0x404824 raised the word)
  fx.enter({ code: 17, rect, block: 8 }, 1, pic, 2, 2);
  fx.startSegment();
  fx.enter({ code: 16, rect, block: 8 }, 3, pic, 2, 2);
  expect(fx.at(0).level).toEqual(FULL_V1);
});

test("one fade-out after another starts again from the movie's palette", () => {
  // 0x406a20 and 0x4057fa both call 0x4306a0(from = [0x44910c], the movie's
  // palette, to = Black): the second fade does not start from the black the
  // first left, it starts one step in from FULL — half-bright for three ticks
  const fx = new EffectScreenV1();
  const pic = new Uint8Array(4).fill(7);
  const rect = r("0,0,2,2");
  const empty = r("20000,20000,0,0");
  fx.startSegment();
  fx.enter({ code: 17, rect, block: 8 }, 15, pic, 2, 2);
  expect(fx.at(14).level).toEqual({ from: "movie", s: 14, d: 14 });
  fx.enter({ code: 17, rect: empty, block: 8 }, 3, pic, 2, 2);
  expect(fx.at(0).level).toEqual({ from: "movie", s: 1, d: 2 });
  expect(fx.at(1).level).toEqual({ from: "movie", s: 1, d: 2 });
  expect(fx.at(2).level).toEqual({ from: "movie", s: 2, d: 2 });
});

test.skipIf(noRip)("no film on the disc reaches a fade-out straight after a fade-out", () => {
  // ...which is why nobody sees that flash in DF.EXE: every 17 that follows a
  // 17 in a frame table sits after an exit, and the loop leaves on the exit
  // frame's action (0x404a79 -> 0x404ac5) before the next frame is drawn
  const all = new Map<string, ReturnType<typeof read>>();
  for (const { name, mov } of films()) all.set(name.toUpperCase(), mov);
  const after: string[] = [];
  let reached = 0;
  for (const [name, mov] of all)
    mov.segments.forEach((sg) =>
      sg.frames.forEach((f, k) => {
        if (f.effect.code !== 17) return;
        // where this frame can go next: its goto, or a chained film's first frame
        const next: (number | undefined)[] = [];
        if (f.action === 2) next.push(sg.frames[f.target]?.effect.code);
        if (f.action === 3 || f.action === 4)
          next.push(all.get(f.chainTo.toUpperCase())?.segments[0].frames[0].effect.code);
        if (next.includes(17)) reached++;
        if (sg.frames[k + 1]?.effect.code === 17) after.push(`${name}:${k}:${f.action}`);
      }),
    );
  expect(reached).toBe(0);
  expect(after.sort()).toEqual([
    "ABE.MOV:49:1", "DIEH2.MOV:98:1", "DIEH3.MOV:17:1", "PINENTER.MOV:47:1",
    "SALGUN.MOV:49:1", "TOWERTOP.MOV:23:1",
  ]);
});

test("a film's first transition draws over the screen it was called on", () => {
  // nothing of the film is on the screen yet, so what a wipe has not reached is
  // UNDRAWN — the room shows through it — and not the colour 0 it used to be
  const fx = new EffectScreenV1();
  const W = 3;
  const H = 6;
  const pic = new Uint8Array(W * H).fill(2);
  fx.startSegment();
  fx.enter({ code: 9, rect: r(`0,0,${H},${W}`), block: 8 }, 3, pic, W, H);
  const rows = (e: number) => {
    const { drawn } = fx.at(e);
    return drawn ? Array.from({ length: H }, (_, y) => drawn[y * W]).join("") : "all";
  };
  expect(rows(0)).toBe("000111");
  expect(rows(1)).toBe("all");
  // a frame after it keeps the film's own screen: no mask at all
  fx.enter({ code: 9, rect: r(`0,0,${H},${W}`), block: 8 }, 3, new Uint8Array(W * H).fill(5), W, H);
  expect(fx.at(0).drawn).toBeNull();
  // and a sequence's end forgets the screen: the next film starts undrawn again
  fx.reset();
  fx.enter({ code: 9, rect: r(`0,0,${H},${W}`), block: 8 }, 3, pic, W, H);
  expect(rows(0)).toBe("000111");
});

test("a wipe draws the new picture over the old one, a step a tick", () => {
  const fx = new EffectScreenV1();
  const W = 3;
  const H = 6;
  const old = new Uint8Array(W * H).fill(1);
  const pic = new Uint8Array(W * H).fill(2);
  fx.enter({ code: 16, rect: r(`0,0,${H},${W}`), block: 8 }, 3, old, W, H);
  // wipe UP (9) in 3 steps of 6/3+1 = 3 rows, bottom first
  fx.enter({ code: 9, rect: r(`0,0,${H},${W}`), block: 8 }, 3, pic, W, H);
  const rows = (e: number) => {
    const { pixels } = fx.at(e);
    return Array.from({ length: H }, (_, y) => pixels[y * W]).join("");
  };
  expect(rows(0)).toBe("111222");
  expect(fx.busy(0)).toBe(true);
  expect(rows(1)).toBe("222222");
  expect(rows(3)).toBe("222222");
  expect(fx.busy(3)).toBe(false);
  // the old picture is not touched — the screen is a copy
  expect(old.every((v) => v === 1)).toBe(true);
});

test.skipIf(noRip)("the codes the disc's films are drawn with", () => {
  const codes = new Map<number, number>();
  const where = new Map<number, Set<string>>();
  let empty = 0;
  for (const { name, mov } of films()) {
    for (const sg of mov.segments) {
      const c0 = mov.file.containers[sg.bias].data;
      const v = new DataView(c0.buffer, c0.byteOffset, c0.byteLength);
      // the bounds every copy is clipped to (header +0x1e) are the picture
      expect([0x1e, 0x20, 0x22, 0x24].map((o) => v.getInt16(o, true))).toEqual([
        0, 0, sg.height, sg.width,
      ]);
      for (const f of sg.frames) {
        const code = f.effect.code;
        codes.set(code, (codes.get(code) ?? 0) + 1);
        if (code !== 16 && code !== 17 && code !== 18) {
          if (!where.has(code)) where.set(code, new Set());
          where.get(code)!.add(name);
        }
        const rc = f.effect.rect;
        if (rc.left >= rc.right || rc.top >= rc.bottom) empty++;
      }
    }
  }
  expect(Object.fromEntries([...codes].sort((a, b) => a[0] - b[0]))).toEqual({
    1: 1, 2: 1, 3: 2, 8: 8, 9: 8, 10: 9, 11: 8, 12: 3, 16: 6255, 17: 217, 18: 205,
  });
  expect(Object.fromEntries([...where].map(([c, s]) => [c, [...s].sort()]))).toEqual({
    1: ["FINALEND.MOV"],
    2: ["HIDEPLAT.MOV"],
    3: ["HIDEPLAT.MOV", "JAILMAP.MOV"],
    8: ["PAPER1.MOV", "PAPER2.MOV", "PAPER3.MOV", "PAPER4.MOV"],
    9: ["PAPER1.MOV", "PAPER2.MOV", "PAPER3.MOV", "PAPER4.MOV"],
    10: ["PAPER1.MOV", "PAPER2.MOV", "PAPER3.MOV", "PAPER4.MOV", "SPANMAR.MOV"],
    11: ["PAPER1.MOV", "PAPER2.MOV", "PAPER3.MOV", "PAPER4.MOV"],
    12: ["SPANBLD.MOV", "SPANMAR.MOV"],
  });
  expect(empty).toBe(674);
});

test.skipIf(noRip)("the dirty rect is exact: nothing changes outside it", () => {
  // which is what lets the port draw a transition's copies from the frame's
  // whole composite: an empty rect is a repeated picture, and no frame touches
  // a pixel outside its rect. True of the whole disc (all 674 empty rects
  // included); checked here on the films that wipe, slide or fade mid-film,
  // because decoding all 6717 frames is a quarter of a minute.
  const sample = [
    "ABE.MOV", "DOG1.MOV", "FINALEND.MOV", "HIDEPLAT.MOV", "JAILMAP.MOV",
    "MAYOREND.MOV", "PAPER1.MOV", "PAPER4.MOV", "SPANBLD.MOV", "SPANMAR.MOV",
  ];
  let checked = 0;
  let expected = 0;
  for (const name of sample) {
    const mov = read(name);
    for (const sg of mov.segments) {
      expected += sg.frames.length - 1;
      const fb = new FrameBuffer();
      let prev: Uint8Array | null = null;
      for (const f of sg.frames) {
        const d = decodeFrame(mov.file.containers[f.picture].data, fb, mov.file.order);
        const px = fb.pixels.slice(0, d.width * d.height);
        compositeFrameV1(px, prev);
        if (prev) {
          const rc = f.effect.rect;
          const emptyRect = rc.left >= rc.right || rc.top >= rc.bottom;
          const p = prev;
          const differs = (from: number, to: number): boolean => {
            for (let k = from; k < to; k++) if (px[k] !== p[k]) return true;
            return false;
          };
          let outside = false;
          for (let y = 0; y < d.height && !outside; y++) {
            const row = y * d.width;
            if (emptyRect || y < rc.top || y >= rc.bottom)
              outside = differs(row, row + d.width);
            else
              outside =
                differs(row, row + Math.max(0, rc.left)) ||
                differs(row + Math.min(d.width, rc.right), row + d.width);
          }
          expect(outside, `${name} frame record @${f.record}`).toBe(false);
          checked++;
        }
        prev = px;
      }
    }
  }
  expect(checked).toBe(expected);
});

test.skipIf(noRip)("the voice wait is +0x1a bit 0, and +0x06 no longer adds one", () => {
  let odd = 0;
  let oddWithout = 0;
  for (const { mov } of films()) {
    const played = movFileFromV1(mov);
    mov.segments.forEach((sg, i) =>
      sg.frames.forEach((f, k) => {
        // 0x404ab0 / 0x404ae6: `test byte [rec+0x1a], 1` -> 0x429bd0, nothing else
        expect(played.segments[i].frames[k].waitsForVoice).toBe(f.holdsForSound);
        if (f.effect.code & 1) {
          odd++;
          if (!f.holdsForSound) oddWithout++;
        }
      }),
    );
  }
  // what the old "+0x06 bit 0" reading held: every odd code, i.e. every
  // fade-out, and 204 of them for a sound DF.EXE never waits on
  expect([odd, oddWithout]).toEqual([236, 204]);
});

/** a player with one film in it, ticked every 10 ms from 0 */
function open(name: string) {
  const path = join(MOVIE_DIR, name);
  if (!existsSync(path)) return null;
  const bytes = new Uint8Array(readFileSync(path));
  const session = new GameSession(
    (f) => (f.toLowerCase() === name.toLowerCase() ? bytes : null),
    new NullAudioSink(),
  );
  session.onLog = () => {};
  const player = new MoviePlayer(session, () => {});
  player.onLog = () => {};
  let now = 0;
  return {
    player,
    runTo(t: number) {
      for (now += 10; now <= t; now += 10) player.tick(now);
      now -= 10;
    },
  };
}

test.skipIf(noRip)("the player: DOG1.MOV fades in from black over its first frame's hold", () => {
  const o = open("DOG1.MOV")!;
  void o.player.play("DOG1.MOV");
  // frame 0 is an 18 over a 20-tick hold: the palette starts one step up from
  // black and is the film's own by the end of the hold
  o.runTo(10);
  const lum = () => {
    const p = o.player.frame!.palette;
    let sum = 0;
    // entries 1-254: 0 and 255 are never faded (0x421f30)
    for (let i = 4; i < 255 * 4; i += 4) sum += p[i] + p[i + 1] + p[i + 2];
    return sum;
  };
  const start = lum();
  const step0 = o.player.effectStep;
  o.runTo(160);
  const mid = lum();
  expect(o.player.effectStep).toBeGreaterThan(step0);
  o.runTo(320);
  const full = lum();
  expect(o.player.framePos).toBe(0);
  expect(start).toBeLessThan(full / 10);
  expect(mid).toBeGreaterThan(start);
  expect(mid).toBeLessThan(full);
});

test.skipIf(noRip)("the player: PAPER1.MOV's page wipes up from the bottom", () => {
  const o = open("PAPER1.MOV")!;
  void o.player.play("PAPER1.MOV");
  // frame 0 is a 9 (wipe up) over 30 ticks, and then it waits for a click: a
  // band of 384/30+1 = 13 rows a tick, bottom first, over the screen before it
  o.runTo(10);
  const W = 512;
  const early = o.player.frame!.pixels.slice();
  const earlyDrawn = o.player.frame!.drawn?.slice();
  o.runTo(800);
  expect(o.player.framePos).toBe(0);
  const done = o.player.frame!.pixels;
  const rowsEqual = (y0: number, y1: number) => {
    for (let k = y0 * W; k < y1 * W; k++) if (early[k] !== done[k]) return false;
    return true;
  };
  expect(rowsEqual(371, 384)).toBe(true);
  expect(rowsEqual(0, 371)).toBe(false);
  // the uncovered part is not the film's to paint: it is marked undrawn, and
  // the compositor shows the screen the film was called on through it
  const drawn = earlyDrawn!;
  expect(drawn.subarray(371 * W).every((v) => v === 1)).toBe(true);
  expect(drawn.subarray(0, 371 * W).every((v) => v === 0)).toBe(true);
  // ...and once the page is all there, there is no mask left
  expect(o.player.frame!.drawn).toBeUndefined();
});

/** a room that is one grey picture, enough for the director to put up a screen */
function greyRoom(): RoomLayer {
  const frame = { pixels: new Uint8Array(512 * 264).fill(1), width: 512, height: 264 };
  const pal = new Uint8ClampedArray(256 * 3);
  pal.set([0, 0, 0, 200, 200, 200]);
  const nothing = () => {};
  return {
    roomVersion: 1,
    roomAnimating: false,
    roomFrame: () => frame,
    roomPalette: () => pal,
    roomPropPalette: () => pal,
    bandPropPalette: () => pal,
    roomCamera: () => null,
    roomOcclusion: () => null,
    applyRoomClut: nothing,
    refreshRoomGamma: nothing,
    advanceRoom: () => frame,
    drawRoomHotspots: nothing,
    roomSignature: nothing,
    pointInRoomImage: () => true,
    roomClickAt: async () => false,
    roomHitTest: () => null,
    sendRoomPainting: async () => {},
    roomKeyDown: async () => false,
    armRoomNav: () => null,
    disarmRoomNav: nothing,
  } as unknown as RoomLayer;
}

test.skipIf(noRip)("the director: PAPER1.MOV's page wipes up over the room, not over black", async () => {
  const name = "PAPER1.MOV";
  const bytes = new Uint8Array(readFileSync(join(MOVIE_DIR, name)));
  const session = new GameSession(
    (f) => (f.toLowerCase() === name.toLowerCase() ? bytes : null),
    new NullAudioSink(),
  );
  session.onLog = () => {};
  session.setVisible = true;
  const W = 512;
  const H = 384;
  const dir = new ScreenDirector(session, { width: W, height: H });
  dir.setRoom(greyRoom());
  dir.onRoomReveal = () => {};
  const ctx = {
    canvas: { width: W, height: H },
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
    save: () => {},
    restore: () => {},
    fillRect: () => {},
    fillText: () => {},
    measureText: () => ({ width: 0 }),
  } as unknown as CanvasRenderingContext2D;
  let now = 0;
  dir.tick((now += 16));
  dir.render(ctx);
  const px = (x: number, y: number) => [...dir.screen.frame.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)];
  const room = px(256, 50);
  expect(room.some((v) => v > 0), "the room is up before the film").toBe(true);
  void session.onPlayMovie?.(name);
  await Promise.resolve();
  await Promise.resolve();
  dir.tick((now += 16));
  dir.render(ctx);
  expect(dir.movies.playing).toBe(true);
  // one step of a 30-step wipe up: the top of the screen is still the room
  expect(px(256, 50)).toEqual(room);
  for (let i = 0; i < 60; i++) {
    dir.tick((now += 16));
    dir.render(ctx);
  }
  // the page is all there: the room is gone from under it
  expect(dir.movies.framePos).toBe(0);
  expect(px(256, 50)).not.toEqual(room);
});
