/**
 * `visualeffect(turnleft|turnright)` — the sliding turn, and the geometry it
 * slides with.
 *
 *   npx vitest run engine/tests/turn-effect.ts
 *
 * A turn is not a wipe. A wipe uncovers the arriving screen while the leaving one
 * stands still; a turn moves BOTH, at the same rate, so the picture reads as
 * rotating rather than as being replaced. Timelapse is the only game that asks
 * for one — `turnleft`, `turnright` and the two `half` variants, once each, all
 * four inside `lefttoframeMin`/`righttoframeMin`.
 *
 * The numbers below are `tl.exe`'s, not a guess at what looks right:
 *
 *   - `visualeffect` dispatches through a 21-entry jump table at 0x447c18, and
 *     its one caller (0x44a5ab) hands every effect the SCREEN rect at 0x465f30.
 *   - The four turn slots are the only ones that call 0x448cb0, which clips BOTH
 *     its rects against that screen rect — what a copy must do when source and
 *     destination are the same surface. The wipes call the offscreen-to-screen
 *     blit 0x448c20 twice and never touch it.
 *   - `turnhalfleft` halves the width (`sar eax, 1`, 0x448b48) before dividing by
 *     the step count; `turnleft` divides the whole of it.
 *   - A half turn's source cursor starts a quarter of the way in: `P.right -=
 *     width/4` then `P.left = P.right` (0x448b66..0x448b73).
 *
 * That last one is the one worth a test, because it is invisible until it is
 * wrong: a mid-turn flat is 320 columns of art centred in a 640 canvas, and a
 * port that sourced from the edge would slide the blank margin across the screen.
 *
 * No game data — two flats of flat colour, and the assertions are on columns.
 */
import { test, expect } from "vitest";
import { buildStgBytes } from "@dreamfactory/engine/df/stg-build";
import { buildShpBytes } from "@dreamfactory/engine/df/shp-build";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { ScreenDirector } from "@dreamfactory/engine/web/screen-director";

const W = 640;
const H = 480;
/** 0 black, 1 the leaving picture, 2 the arriving one, 3 its right-hand marker */
const PALETTE = new Uint8Array([0, 0, 0, 30, 30, 200, 200, 30, 30, 30, 200, 30]);

/** a flat of one index, with a different index down a named column band */
function art(fill: number, band?: { from: number; to: number; index: number }) {
  const pixels = new Uint8Array(W * H).fill(fill);
  if (band) {
    for (let y = 0; y < H; y++) for (let x = band.from; x < band.to; x++) pixels[y * W + x] = band.index;
  }
  return { pixels, width: W, height: H };
}

/** enough of a 2D context for `blit` — sized up front so a resize is not a repaint */
function stubCtx(): CanvasRenderingContext2D {
  return {
    canvas: { width: W, height: H },
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
  } as unknown as CanvasRenderingContext2D;
}

/** a one-prop shop, so a test can put something on the screen over the flats */
function markerShop(): Uint8Array {
  const F = 24;
  return buildShpBytes({
    palette: PALETTE,
    groups: [
      {
        name: "compass",
        states: [
          {
            identifier: "still",
            frames: [
              {
                art: {
                  width: F,
                  height: F,
                  posXraw: 0,
                  posYraw: 0,
                  // the green marker slot, so it cannot be confused with either flat
                  indexed: new Uint8Array(F * F).fill(3),
                  opaque: new Uint8Array(F * F).fill(1),
                },
              },
            ],
          },
        ],
      },
    ],
  });
}

async function scene(): Promise<{ session: GameSession; dir: ScreenDirector; ctx: CanvasRenderingContext2D }> {
  const stg = buildStgBytes({
    palette: PALETTE,
    flats: [
      { name: "leaving", art: art(1) },
      // the arriving picture, marked in its RIGHT quarter so the tests can say
      // which of its columns reached the screen
      { name: "arriving", art: art(2, { from: 480, to: W, index: 3 }) },
    ],
  });
  const shp = markerShop();
  const session = new GameSession(
    (n) => (n === "t.stg" ? stg : n === "c.shp" ? shp : null),
    new NullAudioSink(),
  );
  const dir = new ScreenDirector(session, { width: W, height: H });
  await session.stageCtrl.openStageFile("t.stg");
  await session.stageCtrl.gotoFlat("leaving");
  return { session, dir, ctx: stubCtx() };
}

/** which palette slot is on screen at (x, 240) — by which channel wins the gamma */
function slotAt(dir: ScreenDirector, x: number): 1 | 2 | 3 | 0 {
  const o = (240 * W + x) * 4;
  const [r, g, b] = [dir.screen.frame[o], dir.screen.frame[o + 1], dir.screen.frame[o + 2]];
  if (b > r && b > g) return 1; // the leaving picture: blue
  if (r > g && r > b) return 2; // the arriving one: red
  if (g > r && g > b) return 3; // its right-quarter marker: green
  return 0;
}

/**
 * Set a turn up by hand at a chosen step, and render one frame.
 *
 * `visualeffect` is what does this in the game — capture the screen, name the
 * direction, then block the script until the ramp is done — but the ramp is
 * paced on the engine clock, and a test that waited for it would be measuring
 * the pacer rather than the geometry.
 */
async function turnAt(
  s: { session: GameSession; dir: ScreenDirector; ctx: CanvasRenderingContext2D },
  dir: "turnleft" | "turnright",
  span: number,
  step: number,
  steps: number,
): Promise<void> {
  s.dir.render(s.ctx); // the leaving picture, on screen and captured from there
  const from = s.session.captureFrame?.();
  await s.session.stageCtrl.gotoFlat("arriving");
  // ...and the arriving one, painted and held the way visualeffect holds it:
  // one stable picture for the whole ramp (GameSession.wipe.to)
  s.dir.render(s.ctx);
  const to = s.session.captureFrame?.();
  Object.assign(s.session.wipe, { dir, span, step, steps, from, to, settled: false, lastTick: 0 });
  s.dir.render(s.ctx);
}

test("a full turn slides both pictures, and the arriving one enters at an edge", async () => {
  const s = await scene();
  // a quarter of the way through a full turn: 160 columns of the new picture
  await turnAt(s, "turnright", 1, 1, 4);
  // the leaving picture still holds the left three quarters...
  expect(slotAt(s.dir, 10), "the leaving picture is still there").toBe(1);
  expect(slotAt(s.dir, 460)).toBe(1);
  // ...and the arriving one has the right quarter, sourced from its LEFT edge,
  // which is the plain field rather than the marked right quarter
  expect(slotAt(s.dir, 500), "the arriving picture entered at the right").toBe(2);
  expect(slotAt(s.dir, 630)).toBe(2);
});

test("...and the mirror enters at the other edge, from its other end", async () => {
  const s = await scene();
  await turnAt(s, "turnleft", 1, 1, 4);
  // a left turn slides the picture right, so the new one arrives at the LEFT —
  // and is consumed backwards, so what shows is its MARKED right quarter
  expect(slotAt(s.dir, 10), "the arriving picture's far end came in first").toBe(3);
  expect(slotAt(s.dir, 150)).toBe(3);
  expect(slotAt(s.dir, 300), "the leaving picture, pushed right").toBe(1);
  expect(slotAt(s.dir, 630)).toBe(1);
});

/**
 * The half turn's cursor starts a QUARTER in, which is the whole reason the
 * mid-turn art is centred.
 *
 * Sourced from the edge instead, a `turnhalfleft` would pull the arriving
 * picture's columns 640..320 — its marked right quarter first. Sourced correctly
 * it starts at 480, so the marker never appears at all: every column that
 * reaches the screen comes from the middle half, 160..479.
 */
test("a half turn sources from a quarter in, never from the picture's edge", async () => {
  const s = await scene();
  await turnAt(s, "turnleft", 0.5, 2, 4);
  // the arriving columns are the plain field — NOT the marked right quarter,
  // which is what an edge-sourced cursor would have brought in first
  const arriving = [4, 40, 100, 150].map((x) => slotAt(s.dir, x));
  expect(arriving, "sourced from the middle half, so the marker never shows").toEqual([2, 2, 2, 2]);
  // ...and the leaving picture holds the rest
  expect(slotAt(s.dir, 400)).toBe(1);
});

test("a half turn travels half the screen, a full one all of it", async () => {
  const half = await scene();
  await turnAt(half, "turnright", 0.5, 4, 4); // ramp complete
  // half the screen is the arriving picture and half is still the leaving one
  expect(slotAt(half.dir, 200), "the left half is what it was").toBe(1);
  expect(slotAt(half.dir, 500), "the right half arrived").toBe(2);

  const full = await scene();
  await turnAt(full, "turnright", 1, 4, 4);
  // ...where a full turn has replaced the screen outright
  expect(slotAt(full.dir, 10)).toBe(2);
  expect(slotAt(full.dir, 630)).toBe(3);
});

/**
 * A turn SETTLES rather than ending, so the second leg starts where the first
 * one stopped.
 *
 * `lefttoframeMin` is two effects back to back — the mid-turn flat and
 * `turnhalfleft`, then the destination and `turnleft` — and this port repaints
 * the current flat every frame where the original only ever moves strips. Without
 * settling, the frame between the legs is the mid-turn flat drawn WHOLE, and
 * those are 320 columns of art in a 640 canvas: the second leg would capture the
 * blank margin and scroll it across the screen. Measured before this: 50% of the
 * middle row white at the start of leg two, against 1% after.
 */
test("a finished turn keeps its composite for the next leg to capture", async () => {
  const s = await scene();
  await turnAt(s, "turnright", 0.5, 4, 4);
  s.session.wipe.settled = true;

  // the script is no longer blocked...
  expect(s.session.wiping, "the effect is over as far as the script is concerned").toBe(false);
  // ...but the renderer still composites, so the screen is the half-and-half view
  expect(s.session.compositing).toBe(true);
  s.dir.render(s.ctx);
  expect(slotAt(s.dir, 200), "not repainted back to the arriving flat alone").toBe(1);
  expect(slotAt(s.dir, 500)).toBe(2);

  // and THAT is what the next leg captures
  const from = s.session.captureFrame?.();
  expect(from).toBeTruthy();
  const at = (x: number) => from!.rgba[(240 * W + x) * 4 + 2] > from!.rgba[(240 * W + x) * 4];
  expect(at(200), "the captured frame carries the leaving picture's half").toBe(true);
  expect(at(500)).toBe(false);
});

/**
 * `visualeffect(plain, 0)` is a REDRAW, not a no-op — and that is what keeps a
 * prop the script just hid out of the next effect's capture.
 *
 * Its whole body in `tl.exe` (effect 24014, 0x448630) pushes the screen rect
 * TWICE and calls the offscreen-to-screen blit: a full-screen redraw with nothing
 * over it. Which is why the scripts pair it with every change they want to see at
 * once — `lefttoframeMin` opens `propvisible ("compass", false)` and then
 * `visualeffect (plain, 0)` before it touches a flat at all.
 *
 * With `plain` doing nothing the compass was still in the framebuffer when the
 * turn captured it, so Timelapse's movement indicator slid off the bottom-left
 * corner with the leaving picture instead of simply not being there. Measured in
 * the browser: that corner reads 1396 lit pixels with the compass and 1407
 * without, and the captured frame read 1396.
 */
test("plain redraws, so a hidden prop is gone from the next capture", async () => {
  const s = await scene();
  await s.session.openShop("c.shp");
  const prop = s.session.propRuntime.get("compass")!;
  prop.visible = true;
  prop.anchorX = 20;
  prop.anchorY = 300;

  /** is the prop's green block on screen where it was parked? */
  const marked = (buf: Uint8ClampedArray): boolean => {
    const o = (310 * W + 30) * 4;
    return buf[o + 1] > buf[o] && buf[o + 1] > buf[o + 2];
  };
  s.dir.render(s.ctx);
  expect(marked(s.dir.screen.frame), "the prop is on screen").toBe(true);

  // the script's idiom: hide it, then ask for the redraw
  prop.visible = false;
  const go = s.session.instanceFrom(
    compileScript("code go ()\n\tvisualeffect (plain, 0)\nendcode\n"),
    "go",
  )!;
  await s.session.interp.runHandler(go, "go", [], { me: "go", target: "" });
  expect(marked(s.dir.screen.frame), "plain repainted, so it is gone").toBe(false);
  // ...and therefore gone from what the next effect captures
  expect(marked(s.session.captureFrame!()!.rgba)).toBe(false);
});


/**
 * Both legs, script-driven, with a frame yielded between them — the sequence
 * `lefttoframeMin` actually runs, and the one that was broken.
 *
 * The handler is `gotoflat(namemid)`, `visualeffect(turnhalfleft, …)`,
 * `gotoflat(namedest)`, `visualeffect(turnleft, …)`. Two things about the middle
 * of it had to be true and were not, and each shows up as the picture changing
 * to a different one part-way through the turn rather than the turn finishing:
 *
 *  1. The settled composite has to survive `visualeffect`'s RETURN. Its wait
 *     loop called `endWipe` unconditionally on the way out — correct when only
 *     TAOOT's wipes existed, since those are simply over — so the moment
 *     anything between the legs yielded a frame (a flat's open script, a sound,
 *     a decode) the live world came back on screen, and leg two captured the
 *     destination flat drawn WHOLE and glued its own middle to its right edge.
 *     Intermittent for exactly the reason a yield is.
 *  2. The arriving picture has to be ONE picture for the whole ramp. The
 *     original's is: `gotoflat` draws the offscreen surface and the modal effect
 *     consumes it unchanged. This port repainted the world every frame, so a
 *     destination flat that animates — i0001.103 is water, and it reached its
 *     third frame mid-turn — handed different passes different art.
 *
 * Measured over the shipped discs, the left turn's second leg joined a fixed
 * pair of columns at 66 against a median of 13 for every other column in the
 * frame; it now tracks the median.
 */
test("two legs: the settled composite survives the gap, and the arriving picture is held", async () => {
  const s = await scene();
  s.dir.render(s.ctx);

  const go = s.session.instanceFrom(
    compileScript(
      "code go ()\n" +
        '\tgotoflat ("arriving")\n' +
        "\tvisualeffect (turnhalfleft, 4)\n" +
        // the yield the real handler gets for free between its legs
        "\tforceupdate ()\n" +
        '\tgotoflat ("leaving")\n' +
        "\tvisualeffect (turnleft, 16)\n" +
        "endcode\n",
    ),
    "go",
  )!;

  /**
   * The destination flat ANIMATES from part-way through leg two — which is the
   * second half of this: i0001.103 is water, and it reached its third frame
   * before the turn was over. Injected at `flatImage` because that is the one
   * thing `paintWorldInto` reads, so this is what a flat animating under a ramp
   * looks like to the renderer, with no clock or scheduler in the way.
   */
  const realFlatImage = s.session.stageCtrl.flatImage.bind(s.session.stageCtrl);
  let animating = false;
  (s.session.stageCtrl as { flatImage: () => unknown }).flatImage = () => {
    const f = realFlatImage();
    if (!f || !animating) return f;
    return { ...f, pixels: new Uint8Array(f.pixels.length).fill(3) };
  };

  let gap: { left: number; right: number } | null = null;
  const strips: number[] = [];
  const leaving: number[] = [];
  let now = 0;
  s.session.hasRealFrames = true;
  // the shells' loop, exactly: advance the clock, tick, render. `tick` is what
  // paces the ramp, and forceupdate's hold is on the clock, so a callback that
  // only stepped the wipe would spin in it forever.
  s.session.nextFrame = async () => {
    now += 20;
    s.dir.tick(now);
    const w = s.session.wipe;
    s.dir.render(s.ctx);
    // between the legs: the ramp is done, the script is free, the composite is
    // still the screen
    if (w.settled && !s.session.wiping && !gap) {
      gap = { left: slotAt(s.dir, 100), right: slotAt(s.dir, 540) };
    }
    if (w.dir === "turnleft" && w.span === 1 && w.step > 0 && w.step < w.steps) {
      strips.push(slotAt(s.dir, 4));
      leaving.push(slotAt(s.dir, 630));
      if (w.step > 1) animating = true;
    }
  };
  await s.session.interp.runHandler(go, "go", [], { me: "go", target: "" });

  expect(gap, "a settled composite was on screen after leg one returned").not.toBeNull();
  expect(gap!.left, "its left half is what leg one brought in").toBe(2);
  expect(gap!.right, "its right half is what leg one was leaving").toBe(1);

  expect(strips.length, "leg two ramped").toBeGreaterThan(1);
  expect(animating, "the destination flat animated mid-ramp").toBe(true);
  // Leg two's destination is the OTHER flat, so every strip entering at the
  // left edge is its field — and it stays that for the whole ramp. A port that
  // re-read the world each frame instead would be sourcing from whatever the
  // flat had become; a port that had let the settled composite go would be
  // sliding the destination's own middle in against its right edge.
  expect(new Set(strips), `entering strips: ${strips.join(",")}`).toEqual(new Set([1]));

  // ...and the side being pushed off is the COMPOSITE leg one left, whose two
  // halves are the mid picture's field and the plain leaving flat. The arriving
  // flat's marked quarter is in neither: leg one consumed only its columns
  // 160..479. So a 3 here is the destination flat drawn whole on the leaving
  // side — the mid-turn jump — and it is what showed when the settled composite
  // was released before leg two could capture it.
  expect(leaving, `leaving side: ${leaving.join(",")}`).not.toContain(3);
});
