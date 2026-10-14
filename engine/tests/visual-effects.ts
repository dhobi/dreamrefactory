/**
 * `visualeffect`'s reveals, drawn pass for pass as each exe draws them: TI.EXE's
 * (which tl.exe and RedJack.exe share), DF.EXE's own plan for Dust, and
 * RedJack.exe's `photodissolve`.
 *
 *   npx vitest run engine/tests/visual-effects.ts
 *
 * No shipped script asks for `venetian`, the irises, the scrolls, wipeup/
 * wipedown or turnup/turndown, so nothing in either corpus would ever show these
 * wrong. The numbers are the exe's (runtime/visual-effects.ts has the
 * addresses): a strip is `extent / steps + 1`, or `extent / (2 * steps) + 1` for
 * the two-sided effects, and pass `i` copies rects a strip further on.
 *
 * The pictures are synthetic and say where each pixel came from: R and G are the
 * source column and row, B which picture (100 the leaving one, 200 the arriving
 * one), so a test can say not only WHICH picture shows at a point but which of
 * its pixels — the difference between a scroll and a wipe.
 */
import { test, expect } from "vitest";
import { buildStgBytes } from "@dreamfactory/engine/df/stg-build";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { RAMP_STEP_MS } from "@dreamfactory/engine/runtime/clock";
import {
  composeDfEffect,
  composeDissolve,
  composeEffect,
  dfPassesAt,
  dfPlan,
  passesAt,
  type DfEffect,
  type ExeEffect,
} from "@dreamfactory/engine/runtime/visual-effects";
import { ScriptError } from "@dreamfactory/engine/runtime/interp";
import { ScreenDirector } from "@dreamfactory/engine/web/screen-director";

const W = 40;
const H = 30;
const STEPS = 4;
// so: a one-sided strip is 40/4+1 = 11 columns or 30/4+1 = 8 rows, a two-sided
// one 40/8+1 = 6 columns or 30/8+1 = 4 rows

const OLD = 100;
const NEW = 200;

function picture(tag: number): Uint8ClampedArray {
  const p = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      p[o] = x;
      p[o + 1] = y;
      p[o + 2] = tag;
      p[o + 3] = 255;
    }
  }
  return p;
}

/** the effect after `passes` passes, read back as "which picture, which pixel of it" */
function after(effect: ExeEffect, passes: number, steps = STEPS) {
  const out = new Uint8ClampedArray(W * H * 4);
  composeEffect(effect, picture(OLD), picture(NEW), out, W, H, steps, passes);
  return (x: number, y: number) => {
    const o = (y * W + x) * 4;
    return { pic: out[o + 2] === NEW ? "new" : "old", x: out[o], y: out[o + 1] };
  };
}
const pic = (at: ReturnType<typeof after>, x: number, y: number) => at(x, y).pic;

test("pacing: two passes on the first frame, all of them on the frame before the end", () => {
  // pass i is drawn BEFORE the pacer waits for tick base+i (0x43c600), so 0 and 1
  // land together, and the session counts its first step on its first tick
  expect(passesAt(1, 30)).toBe(2);
  expect(passesAt(10, 30)).toBe(11);
  expect(passesAt(29, 30)).toBe(30);
  expect(passesAt(1, 1)).toBe(1);
});

test("wiperight / wipeleft: a strip of steps-plus-one width from one edge (0x43be50, 0x43bef0)", () => {
  const r = after("wiperight", 1);
  expect(pic(r, 10, 5)).toBe("new");
  expect(pic(r, 11, 5)).toBe("old");
  const l = after("wipeleft", 2);
  expect(pic(l, 18, 5)).toBe("new");
  expect(pic(l, 17, 5)).toBe("old");
  // the `+ 1` means the last pass already covers the screen: 4 x 11 > 40
  const done = after("wiperight", STEPS);
  expect(pic(done, 39, 29)).toBe("new");
});

test("wipedown / wipeup: the same down the rows (0x43bd30, 0x43bdc0)", () => {
  const d = after("wipedown", 1);
  expect(pic(d, 20, 7)).toBe("new");
  expect(pic(d, 20, 8)).toBe("old");
  const u = after("wipeup", 3);
  expect(pic(u, 20, 6)).toBe("new");
  expect(pic(u, 20, 5)).toBe("old");
  // a wipe uncovers in place: the arriving pixel is its own
  expect(u(20, 6)).toEqual({ pic: "new", x: 20, y: 6 });
});

test("barn doors: two-sided strips, from the edges or from the centre (0x43b670, 0x43b750)", () => {
  const close = after("barndoorclose", 2);
  expect(pic(close, 11, 5)).toBe("new");
  expect(pic(close, 12, 5)).toBe("old");
  expect(pic(close, 27, 5)).toBe("old");
  expect(pic(close, 28, 5)).toBe("new");
  const open = after("barndooropen", 1);
  expect([13, 14, 25, 26].map((x) => pic(open, x, 5))).toEqual(["old", "new", "new", "old"]);
});

test("irisclose: four full-length strips in from every edge (0x43b830)", () => {
  const i = after("irisclose", 1);
  expect(pic(i, 20, 3), "top strip").toBe("new");
  expect(pic(i, 20, 26), "bottom strip").toBe("new");
  expect(pic(i, 5, 15), "left strip").toBe("new");
  expect(pic(i, 34, 15), "right strip").toBe("new");
  expect(pic(i, 20, 4)).toBe("old");
  expect(pic(i, 6, 15)).toBe("old");
  expect(pic(i, 33, 25)).toBe("old");
});

test("irisopen: one rect about the centre, a strip bigger on each side a pass (0x43b980)", () => {
  const i = after("irisopen", 1);
  // centre (20, 15), 6 columns and 4 rows either way
  expect(pic(i, 14, 11)).toBe("new");
  expect(pic(i, 25, 18)).toBe("new");
  expect(pic(i, 13, 15)).toBe("old");
  expect(pic(i, 26, 15)).toBe("old");
  expect(pic(i, 20, 10)).toBe("old");
  expect(pic(i, 20, 19)).toBe("old");
  const two = after("irisopen", 2);
  expect(pic(two, 8, 7)).toBe("new");
  expect(pic(two, 7, 7)).toBe("old");
});

test("venetian: slats steps+1 rows apart, one row deeper a pass, the last row left for the final copy (0x43bf90)", () => {
  const v = after("venetian", 2);
  // period 5: rows 0,1 / 5,6 / 10,11 ...
  expect([0, 1, 2, 4, 5, 6, 7].map((y) => pic(v, 3, y))).toEqual(["new", "new", "old", "old", "new", "new", "old"]);
  const all = after("venetian", STEPS);
  // every pass done and still one row per slat standing: the full copy after the
  // loop is what reveals it, i.e. the end of the ramp
  expect([3, 4, 8, 9, 29].map((y) => pic(all, 3, y))).toEqual(["new", "old", "new", "old", "old"]);
});

test("scrolls: the arriving picture slides in, the leaving one stands (0x43ba70, 0x43bb20, 0x43bbd0, 0x43bc80)", () => {
  // scrolldown: its BOTTOM rows at the screen's top
  const d = after("scrolldown", 1);
  expect(d(5, 0)).toEqual({ pic: "new", x: 5, y: 22 });
  expect(d(5, 7)).toEqual({ pic: "new", x: 5, y: 29 });
  expect(d(5, 8), "the leaving picture does not move").toEqual({ pic: "old", x: 5, y: 8 });
  // scrollup: its TOP rows at the screen's bottom
  const u = after("scrollup", 1);
  expect(u(5, 22)).toEqual({ pic: "new", x: 5, y: 0 });
  expect(u(5, 21)).toEqual({ pic: "old", x: 5, y: 21 });
  // scrollright: its RIGHT columns at the screen's left
  const r = after("scrollright", 1);
  expect(r(0, 3)).toEqual({ pic: "new", x: 29, y: 3 });
  expect(r(11, 3)).toEqual({ pic: "old", x: 11, y: 3 });
  // scrolleft: its LEFT columns at the screen's right
  const l = after("scrolleft", 2);
  expect(l(18, 3)).toEqual({ pic: "new", x: 0, y: 3 });
  expect(l(17, 3)).toEqual({ pic: "old", x: 17, y: 3 });
});

test("turnup / turndown push BOTH pictures (0x43c1f0, 0x43c2f0)", () => {
  // turnup: the screen moves down a strip a pass, the arriving bottom enters at the top
  const u = after("turnup", 1);
  expect(u(5, 0)).toEqual({ pic: "new", x: 5, y: 22 });
  expect(u(5, 8), "the leaving picture moved down").toEqual({ pic: "old", x: 5, y: 0 });
  expect(u(5, 29)).toEqual({ pic: "old", x: 5, y: 21 });
  // turndown: the screen moves up, the arriving top enters at the bottom
  const d = after("turndown", 2);
  expect(d(5, 0)).toEqual({ pic: "old", x: 5, y: 16 });
  expect(d(5, 13)).toEqual({ pic: "old", x: 5, y: 29 });
  expect(d(5, 14)).toEqual({ pic: "new", x: 5, y: 0 });
  // past the screen the move clips to nothing and the arriving picture is whole
  const done = after("turndown", STEPS);
  expect(done(5, 0)).toEqual({ pic: "new", x: 5, y: 0 });
});

/**
 * The whole chain: the script changes the flat, asks for the effect, and the
 * renderer composites the held leaving and arriving pictures at the ramp's step.
 */
test("visualeffect captures both pictures and the renderer draws the exe's geometry", async () => {
  const SW = 64;
  const SH = 48;
  const PALETTE = new Uint8Array([0, 0, 0, 30, 30, 200, 200, 30, 30]);
  const flat = (i: number) => ({ pixels: new Uint8Array(SW * SH).fill(i), width: SW, height: SH });
  const stg = buildStgBytes({ palette: PALETTE, flats: [{ name: "leaving", art: flat(1) }, { name: "arriving", art: flat(2) }] });
  const session = new GameSession((n) => (n === "t.stg" ? stg : null), new NullAudioSink());
  const dir = new ScreenDirector(session, { width: SW, height: SH });
  const ctx = {
    canvas: { width: SW, height: SH },
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
  } as unknown as CanvasRenderingContext2D;
  await session.stageCtrl.openStageFile("t.stg");
  await session.stageCtrl.gotoFlat("leaving");
  dir.render(ctx);
  await session.stageCtrl.gotoFlat("arriving");

  const effect = session.interp.builtins.get("visualeffect") as unknown as (i: unknown, a: (string | number)[]) => Promise<void>;
  void effect(session.interp, ["wipedown", 4]);
  for (let i = 0; i < 50; i++) await Promise.resolve();
  expect(session.wiping).toBe(true);
  expect(session.wipe.dir).toBe("exe");
  expect(session.wipe.effect).toBe("wipedown");

  // the tick it starts on (TI.EXE's timeBase): two passes of 48/4+1 = 13 rows
  const base = session.clock.now;
  session.tickWipe(base);
  dir.render(ctx);
  const blueAt = (y: number) => {
    const o = (y * SW + 10) * 4;
    return dir.screen.frame[o + 2] > dir.screen.frame[o];
  };
  expect(blueAt(25), "rows 0..25 are the arriving (red) flat").toBe(false);
  expect(blueAt(26), "row 26 is still the leaving (blue) one").toBe(true);
  // the ramp ends on its own count, on timeBase + steps - 1
  for (let t = 1; t <= 2; t++) session.tickWipe(base + t * RAMP_STEP_MS);
  expect(session.wiping).toBe(true);
  session.tickWipe(base + 3 * RAMP_STEP_MS);
  expect(session.wiping).toBe(false);
});

test("nodraw draws nothing and leaves the black where it was", async () => {
  const session = new GameSession(() => null, new NullAudioSink());
  session.captureFrame = () => ({ rgba: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 });
  session.fade.level = 1;
  const effect = session.interp.builtins.get("visualeffect") as unknown as (i: unknown, a: (string | number)[]) => Promise<void>;
  void effect(session.interp, ["nodraw", 0]);
  for (let i = 0; i < 50; i++) await Promise.resolve();
  expect(session.wiping).toBe(false);
  expect(session.fade.level, "0x43b615 is a bare ret: nothing lifts the black").toBe(1);
  // ...where a reveal does lift it
  void effect(session.interp, ["venetian", 3]);
  for (let i = 0; i < 50; i++) await Promise.resolve();
  expect(session.fade.level).toBe(0);
  expect(session.wiping).toBe(true);
});

// ---------------------------------------------------------------------------
// DF.EXE (Dust): a fixed number of passes, `steps` only how long each is held
// ---------------------------------------------------------------------------

/** Dust's screen, so the strips are the sizes the game sees */
const DW = 640;
const DH = 480;
// a sixteenth + 1: 41 columns or 31 rows; irisclose a twelfth + 1: 54 / 41;
// irisopen a sixteenth of the centre + 1: 21 / 16; venetian slats 480/8+1 = 61

function dfPicture(tag: number): Uint8ClampedArray {
  const p = new Uint8ClampedArray(DW * DH * 4);
  for (let y = 0; y < DH; y++) {
    for (let x = 0; x < DW; x++) {
      const o = (y * DW + x) * 4;
      // the column and row, mod 256, are enough to tell a scroll from a wipe
      p[o] = x & 255;
      p[o + 1] = y & 255;
      p[o + 2] = tag;
      p[o + 3] = 255;
    }
  }
  return p;
}
const DF_OLD = dfPicture(OLD);
const DF_NEW = dfPicture(NEW);

function dfAfter(effect: DfEffect, passes: number) {
  const out = new Uint8ClampedArray(DW * DH * 4);
  composeDfEffect(effect, DF_OLD, DF_NEW, out, DW, DH, passes);
  return (x: number, y: number) => {
    const o = (y * DW + x) * 4;
    return { pic: out[o + 2] === NEW ? "new" : "old", x: out[o], y: out[o + 1] };
  };
}

test("DF.EXE's plan: fixed passes, and the steps only set each pass's hold", () => {
  // barn doors: 8 passes held steps/8 ticks (0x434de3), n * 50 / 3 ms (0x4252b0)
  expect(dfPlan("barndooropen", 20, DH)).toEqual({ passes: 8, n: 2, passMs: 33 });
  expect(dfPlan("barndoorclose", 3, DH), "never under one tick").toEqual({ passes: 8, n: 1, passMs: 16 });
  // irisclose 6 (0x434fbd), irisopen 16 (0x4350e2)
  expect(dfPlan("irisclose", 30, DH)).toEqual({ passes: 6, n: 5, passMs: 83 });
  expect(dfPlan("irisopen", 40, DH)).toEqual({ passes: 16, n: 2, passMs: 33 });
  // the wipes and scrolls 15 (0x4356b6, 0x4351b1)
  expect(dfPlan("wipeleft", 30, DH)).toEqual({ passes: 15, n: 2, passMs: 33 });
  expect(dfPlan("scrollup", 14, DH)).toEqual({ passes: 15, n: 1, passMs: 16 });
  // venetian: height/8+1 passes, held steps / the screen's BOTTOM (0x43547a)
  expect(dfPlan("venetian", 400, DH)).toEqual({ passes: 61, n: 1, passMs: 16 });
  expect(dfPlan("venetian", 1000, DH)).toEqual({ passes: 61, n: 2, passMs: 33 });
  // one pass a hold, pass 0 from the call
  expect([0, 1, 2, 8, 9].map((s) => dfPassesAt(s, 8))).toEqual([1, 1, 2, 8, 8]);
});

test("DF.EXE wipes: sixteenths, 15 passes short of the edge, the final copy finishing (0x435670, 0x435710, 0x4354f0, 0x4355b0)", () => {
  const r1 = dfAfter("wiperight", 1);
  expect(r1(40, 5).pic).toBe("new");
  expect(r1(41, 5).pic).toBe("old");
  // 15 x 41 = 615: the last 25 columns wait for the full copy at the ramp's end
  const r15 = dfAfter("wiperight", 15);
  expect(r15(614, 5).pic).toBe("new");
  expect(r15(615, 5).pic).toBe("old");
  const l2 = dfAfter("wipeleft", 2);
  expect(l2(558, 5).pic).toBe("new");
  expect(l2(557, 5).pic).toBe("old");
  const d1 = dfAfter("wipedown", 1);
  expect(d1(5, 30).pic).toBe("new");
  expect(d1(5, 31).pic).toBe("old");
  const u3 = dfAfter("wipeup", 3);
  expect(u3(5, 387).pic).toBe("new");
  expect(u3(5, 386).pic).toBe("old");
  expect(u3(5, 400), "a wipe uncovers in place").toEqual({ pic: "new", x: 5, y: 400 & 255 });
});

test("DF.EXE barn doors: 8 passes of a sixteenth from each edge, or out from the centre (0x434d80, 0x434e50)", () => {
  const c1 = dfAfter("barndoorclose", 1);
  expect([0, 40, 41, 598, 599, 639].map((x) => c1(x, 9).pic)).toEqual(["new", "new", "old", "old", "new", "new"]);
  // 8 x 41 = 328 a side: closed, with no final copy needed (or made)
  const c8 = dfAfter("barndoorclose", 8);
  expect([319, 320].map((x) => c8(x, 9).pic)).toEqual(["new", "new"]);
  const o1 = dfAfter("barndooropen", 1);
  expect([278, 279, 360, 361].map((x) => o1(x, 9).pic)).toEqual(["old", "new", "new", "old"]);
  const o8 = dfAfter("barndooropen", 8);
  expect([0, 639].map((x) => o8(x, 9).pic)).toEqual(["new", "new"]);
});

test("DF.EXE irises: twelfths in from every edge, sixteenths of the centre out (0x434f20, 0x435060)", () => {
  const c1 = dfAfter("irisclose", 1);
  expect(c1(320, 40).pic, "top strip, 41 rows").toBe("new");
  expect(c1(320, 41).pic).toBe("old");
  expect(c1(320, 439).pic, "bottom strip").toBe("new");
  expect(c1(53, 240).pic, "left strip, 54 columns").toBe("new");
  expect(c1(54, 240).pic).toBe("old");
  expect(c1(586, 240).pic, "right strip").toBe("new");
  const c6 = dfAfter("irisclose", 6);
  expect(c6(320, 240).pic, "6 x 41 = 246 rows a side closes it").toBe("new");
  const o1 = dfAfter("irisopen", 1);
  // centre (320, 240), 21 columns and 16 rows either way
  expect([o1(299, 224).pic, o1(340, 255).pic]).toEqual(["new", "new"]);
  expect([o1(298, 240).pic, o1(341, 240).pic, o1(320, 223).pic, o1(320, 256).pic]).toEqual(["old", "old", "old", "old"]);
  const o16 = dfAfter("irisopen", 16);
  expect([o16(0, 0).pic, o16(639, 479).pic]).toEqual(["new", "new"]);
});

test("DF.EXE scrolls: the arriving picture slides in a sixteenth a pass (0x435150, 0x435210, 0x4352d0, 0x435390)", () => {
  const d = dfAfter("scrolldown", 1);
  expect(d(5, 0)).toEqual({ pic: "new", x: 5, y: 449 & 255 });
  expect(d(5, 31)).toEqual({ pic: "old", x: 5, y: 31 });
  const u = dfAfter("scrollup", 1);
  expect(u(5, 449)).toEqual({ pic: "new", x: 5, y: 0 });
  expect(u(5, 448)).toEqual({ pic: "old", x: 5, y: 448 & 255 });
  const r = dfAfter("scrollright", 1);
  expect(r(0, 3)).toEqual({ pic: "new", x: 599 & 255, y: 3 });
  expect(r(41, 3)).toEqual({ pic: "old", x: 41, y: 3 });
  const l = dfAfter("scrolleft", 2);
  expect(l(558, 3)).toEqual({ pic: "new", x: 0, y: 3 });
  expect(l(557, 3)).toEqual({ pic: "old", x: 557 & 255, y: 3 });
});

test("DF.EXE venetian: slats 61 rows apart, two rows on the first pass, one more each pass after (0x435450)", () => {
  const v1 = dfAfter("venetian", 1);
  expect([0, 1, 2, 60, 61, 62, 63].map((y) => v1(3, y).pic)).toEqual(["new", "new", "old", "old", "new", "new", "old"]);
  const v3 = dfAfter("venetian", 3);
  expect([3, 4, 64, 65].map((y) => v3(3, y).pic)).toEqual(["new", "old", "new", "old"]);
  // all 61 passes close every slat — there is no final copy in this one
  const all = dfAfter("venetian", 61);
  expect([60, 121, 479].map((y) => all(3, y).pic)).toEqual(["new", "new", "new"]);
});

/** a session with a 2-flat stage on screen, the leaving flat captured: `v` picks the engine */
async function stageSession(v: "v1" | "v5") {
  const SW = 64;
  const SH = 48;
  const PALETTE = new Uint8Array([0, 0, 0, 30, 30, 200, 200, 30, 30]);
  const flat = (i: number) => ({ pixels: new Uint8Array(SW * SH).fill(i), width: SW, height: SH });
  const stg = buildStgBytes({ palette: PALETTE, flats: [{ name: "leaving", art: flat(1) }, { name: "arriving", art: flat(2) }] });
  const session = new GameSession((n) => (n === "t.stg" ? stg : null), new NullAudioSink());
  if (v === "v1") session.dfVersion = 1;
  else session.isV5 = true;
  const dir = new ScreenDirector(session, { width: SW, height: SH });
  const ctx = {
    canvas: { width: SW, height: SH },
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
  } as unknown as CanvasRenderingContext2D;
  await session.stageCtrl.openStageFile("t.stg");
  await session.stageCtrl.gotoFlat("leaving");
  dir.render(ctx);
  await session.stageCtrl.gotoFlat("arriving");
  const effect = session.interp.builtins.get("visualeffect") as unknown as (i: unknown, a: (string | number)[]) => Promise<void>;
  const start = async (args: (string | number)[]) => {
    void effect(session.interp, args);
    for (let i = 0; i < 50; i++) await Promise.resolve();
  };
  /** is the screen at (x, y) the leaving (blue) flat? */
  const blueAt = (x: number, y: number) => {
    const o = (y * SW + x) * 4;
    return dir.screen.frame[o + 2] > dir.screen.frame[o];
  };
  return { session, dir, ctx, effect, start, blueAt, SW, SH };
}

test("a Dust reveal is DF.EXE's: its passes, its holds, the script waiting them out", async () => {
  const { session, dir, ctx, start, blueAt } = await stageSession("v1");
  // barndooropen 20: 8 passes of 64/16+1 = 5 columns a side, held 2 ticks
  await start(["barndooropen", 20]);
  expect(session.wiping).toBe(true);
  expect(session.wipe.dir).toBe("exe");
  expect(session.wipe.draws).toBe("df");
  expect(session.wipe.steps, "8 passes and the hold after the last").toBe(9);
  expect(session.wipe.passMs).toBe(33);
  // the first tick shows pass 0 alone: columns 27..36 about the centre (32)
  let now = 1000;
  session.tickWipe(now);
  expect(session.wipe.step).toBe(1);
  dir.render(ctx);
  expect([26, 27, 36, 37].map((x) => blueAt(x, 10))).toEqual([true, false, false, true]);
  // the second pass 33 ms later, not one 60 Hz tick
  session.tickWipe((now += 17));
  expect(session.wipe.step).toBe(1);
  session.tickWipe((now += 16));
  expect(session.wipe.step).toBe(2);
  dir.render(ctx);
  expect([21, 22, 41, 42].map((x) => blueAt(x, 10))).toEqual([true, false, false, true]);
  // pass 7 is the last, and the script returns one hold after it
  for (let i = 0; i < 6; i++) session.tickWipe((now += 33));
  expect(session.wipe.step).toBe(8);
  expect(session.wiping).toBe(true);
  session.tickWipe((now += 33));
  expect(session.wiping).toBe(false);
});

test("DF.EXE refuses what it has no id for: the turns and nodraw are error 0xe (0x4202fa)", async () => {
  const { session, effect } = await stageSession("v1");
  for (const name of ["turnleft", "turnright", "turnup", "turndown", "nodraw", "turnhalfleft", "turnhalfright"]) {
    let err: unknown = null;
    try {
      void effect(session.interp, [name, 4]);
    } catch (e) {
      err = e;
    }
    expect(err instanceof ScriptError && err.code, name).toBe(0xe);
  }
  expect(session.wiping).toBe(false);
});

// ---------------------------------------------------------------------------
// RedJack.exe: TI.EXE's reveals, and its own photodissolve
// ---------------------------------------------------------------------------

test("photodissolve's blend: old - old*i/steps + new*i/steps, truncated, a channel at a time (0x489050)", () => {
  const from = new Uint8ClampedArray([200, 7, 0, 255]);
  const to = new Uint8ClampedArray([100, 3, 255, 255]);
  const out = new Uint8ClampedArray(4);
  composeDissolve(from, to, out, 0, 4);
  expect([...out], "pass 0 is the leaving picture exactly").toEqual([200, 7, 0, 255]);
  composeDissolve(from, to, out, 1, 4);
  // 200 - 50 + 25; 7 - 1 + 0; 0 - 0 + 63
  expect([...out]).toEqual([175, 6, 63, 255]);
  composeDissolve(from, to, out, 3, 4);
  // the last pass is still a step short: 200 - 150 + 75; 7 - 5 + 2; 0 + 191
  expect([...out]).toEqual([125, 4, 191, 255]);
});

test("RedJack: photodissolve holds both pictures and is paced like the rest; its reveals are TI.EXE's", async () => {
  const { session, dir, ctx, start } = await stageSession("v5");
  // 24020 decodes as `turnhalfleft`; in v5 it is photodissolve
  await start(["turnhalfleft", 4]);
  expect(session.wipe.dir).toBe("dissolve");
  expect(session.wipe.to, "the offscreen it blends from is held").not.toBeNull();
  session.tickWipe(session.clock.now);
  dir.render(ctx);
  // the tick it starts on: passes 0 and 1 drawn, so pass 1 shows — a quarter of the way
  const o = (10 * 64 + 10) * 4;
  const from = session.wipe.from!.rgba;
  const to = session.wipe.to!.rgba;
  const want = (c: number) => from[o + c] - Math.trunc(from[o + c] / 4) + Math.trunc(to[o + c] / 4);
  expect([0, 1, 2].map((c) => dir.screen.frame[o + c])).toEqual([0, 1, 2].map(want));
  session.endWipe();
  // the wipes and the rest are TI.EXE's geometry and pacing (0x437030 ...)
  await start(["wipedown", 4]);
  expect(session.wipe.dir).toBe("exe");
  expect(session.wipe.draws).toBe("ti");
  expect(session.wipe.steps).toBe(4);
  session.endWipe();
  await start(["turnup", 4]);
  expect(session.wipe.effect, "turnup 0x437ca0 pushes as 0x43c1f0 does").toBe("turnup");
});

test("RedJack: nodraw draws nothing (0x436a09), and 24021 is error 0xe (0x408bb1)", async () => {
  const { session, effect, start } = await stageSession("v5");
  session.fade.level = 1;
  await start(["nodraw", 0]);
  expect(session.wiping).toBe(false);
  expect(session.fade.level, "nothing lifts the black").toBe(1);
  let err: unknown = null;
  try {
    void effect(session.interp, ["turnhalfright", 4]);
  } catch (e) {
    err = e;
  }
  expect(err instanceof ScriptError && err.code).toBe(0xe);
});

test("frames presented during the effect's pass keep the old picture (0x489ef6)", async () => {
  // A browser host: the pass before the effect waits on real frames, and the
  // page presents every one of them. TI.EXE holds the screen copy back for that
  // pass, so the effect still finds the screen it is leaving. Presented anyway,
  // the new flat was captured as the LEAVING picture and the wipe ran new→new.
  const SW = 64;
  const SH = 48;
  const PALETTE = new Uint8Array([0, 0, 0, 30, 30, 200, 200, 30, 30]);
  const flat = (i: number) => ({ pixels: new Uint8Array(SW * SH).fill(i), width: SW, height: SH });
  const stg = buildStgBytes({ palette: PALETTE, flats: [{ name: "leaving", art: flat(1) }, { name: "arriving", art: flat(2) }] });
  const session = new GameSession((n) => (n === "t.stg" ? stg : null), new NullAudioSink());
  session.hasRealFrames = true;
  const dir = new ScreenDirector(session, { width: SW, height: SH });
  const ctx = {
    canvas: { width: SW, height: SH },
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
  } as unknown as CanvasRenderingContext2D;
  let raf = 123456.7;
  const frame = async () => {
    dir.tick((raf += 16.7));
    dir.render(ctx);
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  for (let i = 0; i < 30; i++) await frame();
  await session.stageCtrl.openStageFile("t.stg");
  await session.stageCtrl.gotoFlat("leaving");
  for (let i = 0; i < 5; i++) await frame();
  await session.stageCtrl.gotoFlat("arriving");
  const effect = session.interp.builtins.get("visualeffect") as unknown as (i: unknown, a: (string | number)[]) => Promise<void>;
  let done = false;
  void effect(session.interp, ["wipeleft", 30]).then(() => (done = true));
  let frames = 0;
  while (!done && frames < 120) {
    await frame();
    frames++;
    if (session.wiping && session.wipe.to) break;
  }
  expect(session.wiping, "the wipe started").toBe(true);
  const blue = (px: Uint8ClampedArray) => px[2] > px[0];
  expect(blue(session.wipe.from!.rgba), "it leaves the leaving (blue) flat").toBe(true);
  expect(blue(session.wipe.to!.rgba), "it arrives at the arriving (red) one").toBe(false);
  expect(session.effectPassHeld, "the hold ends as the effect begins").toBe(false);
  while (!done && frames < 120) {
    await frame();
    frames++;
  }
  // ~30 ticks of 60 Hz at a 60 fps host: half a second, not one frame
  expect(frames).toBeGreaterThan(25);
});
