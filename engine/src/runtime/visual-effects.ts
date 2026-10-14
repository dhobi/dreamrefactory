/**
 * `visualeffect`'s reveals as the three engines draw them — the geometry, pass
 * by pass, and the pacing.
 *
 * ## TI.EXE (and tl.exe, and most of RedJack.exe)
 *
 * TI.EXE's `visualeffect` (0x43ded0) runs a pass with its screen copy held back
 * and hands the SCREEN rect (0x489b30) and the step count, clamped 1..1000, to
 * the dispatcher 0x43b480, which jumps through 0x43b618 on `id - 24001`. Every
 * effect function is the same loop:
 *
 *     base = 0x41de90()                       the 60 Hz counter, (ms * 3) / 50
 *     for (i = 0; i < steps; i++) {
 *       copy this pass's rects                 0x43c620 / 0x43c6b0
 *       advance them by one strip
 *       0x43c600(base, i)                       spin until counter >= base + i
 *     }
 *     copy the whole screen rect               (all but the turns' 0x43c040/0x43c120)
 *
 * `0x43c620(src, dst)` is CopyBits from the offscreen (0x489ab0, where the pass
 * drew the arriving picture) to the screen (0x489de4), each rect clipped to the
 * screen first (0x435300 against 0x489b30) and skipped when that leaves nothing;
 * `0x43c6b0` is the same with the screen as both source and destination — the
 * block move a push makes. Rects are top, left, bottom, right words.
 *
 * The strip is always `extent / divisor + 1` (a signed `idiv`, so a floor here),
 * where the divisor is `steps` for an effect that sweeps from one side and
 * `2 * steps` for one that sweeps from both (barn doors, irises) — the `+ 1` is
 * why every effect is over before its last pass, and why the final full copy
 * changes nothing but the venetian's last row per slat.
 *
 * `tl.exe` carries the same functions 0xc600 higher (dispatcher 0x447a80, table
 * 0x447c18), differing only in register allocation, so Timelapse draws these
 * exactly as TAOOT does.
 *
 * RedJack.exe (DreamFactory 5) inlines its dispatcher (0x436500, table 0x436a14,
 * register arguments) and draws the barn doors (0x43652b, 0x4365e9), irises
 * (0x4366bb, 0x4367f8), scrolls (0x436a70, 0x436be0, 0x436d50, 0x436ec0),
 * `venetian` (0x437530) and wipes (0x437030, 0x437170, 0x4372b0, 0x4373f0) with
 * TI.EXE's strips, TI.EXE's pacer (draw pass i, then spin on 0x469f80 until
 * `base + i`) and TI.EXE's final full copy — so they are this module's TI
 * geometry too. Its four turns (0x4376a0, 0x4379a0, 0x437ca0, 0x437fa0) come out
 * the same pass for pass, by another road: they snapshot the leaving screen
 * into a scratch surface (0x483230) and redraw both pictures from scratch each
 * pass rather than block-moving the screen, with no clamp on the strip and a
 * final full copy. 24020 is its own effect, `photodissolve` ({@link composeDissolve}).
 *
 * ## DF.EXE (Dust)
 *
 * DF.EXE has only the first fourteen (24001..24014, named as TI.EXE names them
 * in its own `{name, id}` table) and draws them to a different plan: a FIXED
 * number of passes, each a fixed fraction of the screen, with `steps` only
 * setting how long each pass is held — see {@link dfPlan}.
 *
 * ## Pacing
 *
 * TI.EXE and RedJack.exe: pass `i` is drawn and THEN the pacer waits for tick
 * `base + i`, so passes 0 and 1 land at once, pass `k` lands on the `k-1`th
 * tick, and the full copy (and the script's return) on tick `steps - 1`. The
 * session's ramp counts a step on the first tick it sees
 * (GameSession.tickWipe) and ends at `step === steps`, so the passes on screen
 * at `step` are `step + 1` — two on the first frame, all of them on the frame
 * before the end — see {@link passesAt}.
 *
 * DF.EXE: pass `i` is drawn and then 0x4252b0 waits `n * 50 / 3` ms from THAT
 * moment (timeGetTime, no shared base), so one pass shows per wait — see
 * {@link dfPassesAt}.
 */

/** the reveals ported from TI.EXE, by script name (24001..24018 less `plain`, turnleft/right) */
export const EXE_EFFECTS = [
  "barndoorclose", "barndooropen", "irisclose", "irisopen",
  "scrolldown", "scrollup", "scrollright", "scrolleft", "venetian",
  "wipedown", "wipeup", "wiperight", "wipeleft", "turnup", "turndown",
] as const;
export type ExeEffect = (typeof EXE_EFFECTS)[number];
const EXE_EFFECT_SET: ReadonlySet<string> = new Set(EXE_EFFECTS);
export const isExeEffect = (name: string): name is ExeEffect => EXE_EFFECT_SET.has(name);

/**
 * DF.EXE's reveals: 24001..24013 (24014 is `plain`). Its command table
 * (`{u32 name, u16 id}` records) names them exactly as TI.EXE does, and its
 * `visualeffect` (0x4202fa) refuses any id outside 24001..24014 with error 0xe,
 * so the turns and `nodraw` do not exist there.
 */
export const DF_EFFECTS = [
  "barndoorclose", "barndooropen", "irisclose", "irisopen",
  "scrolldown", "scrollup", "scrollright", "scrolleft", "venetian",
  "wipedown", "wipeup", "wiperight", "wipeleft",
] as const satisfies readonly ExeEffect[];
export type DfEffect = (typeof DF_EFFECTS)[number];
const DF_EFFECT_SET: ReadonlySet<string> = new Set(DF_EFFECTS);
export const isDfEffect = (name: string): name is DfEffect => DF_EFFECT_SET.has(name);

/** passes of a `steps`-pass TI.EXE/RedJack.exe effect on screen at ramp step `step` — see the note on pacing */
export function passesAt(step: number, steps: number): number {
  return Math.max(1, Math.min(steps, step + 1));
}

/**
 * How DF.EXE runs `effect`: `passes` fixed by the effect, and `n`, the 60 Hz
 * ticks each pass is held for, out of the script's `steps` (already clamped
 * 1..1000 by 0x420370..0x42038a) — at least 1.
 *
 *   effect          function  passes        n                 final full copy
 *   barndoorclose   0x434d80  8             steps / 8         no
 *   barndooropen    0x434e50  8             steps / 8         no
 *   irisclose       0x434f20  6             steps / 6         no
 *   irisopen        0x435060  16            steps / 16        no
 *   scroll*         0x435150  15            steps / 15        yes
 *     (scrollup 0x435210, scrollright 0x4352d0, scrolleft 0x435390)
 *   venetian        0x435450  height/8 + 1  steps / bottom    no
 *   wipe*           0x4354f0  15            steps / 15        yes
 *     (wipeup 0x4355b0, wiperight 0x435670, wipeleft 0x435710)
 *
 * The venetian's `steps / bottom` is what the code divides by — the screen
 * rect's bottom, still in `ecx` from the slat arithmetic (0x435470..0x43547a),
 * so at any step count below the screen's height it is held one tick a pass.
 *
 * A pass is held by 0x4252b0(n): `timeGetTime()` now, then spin until it reaches
 * that plus `n * 50 / 3` ms (truncated). So the effect is `passes` holds long:
 * pass `i` at `i` holds, any final copy and the script's return at `passes`
 * holds. As a ramp that is `passes + 1` steps of `passMs` each, the last one
 * the end — {@link dfPassesAt}.
 */
export function dfPlan(effect: DfEffect, steps: number, height: number): { passes: number; n: number; passMs: number } {
  const s = Math.max(1, Math.min(1000, Math.trunc(steps) || 1));
  let passes: number;
  let divisor: number;
  switch (effect) {
    case "barndoorclose":
    case "barndooropen":
      passes = 8;
      divisor = 8;
      break;
    case "irisclose":
      passes = 6;
      divisor = 6;
      break;
    case "irisopen":
      passes = 16;
      divisor = 16;
      break;
    case "venetian":
      passes = (height >> 3) + 1;
      divisor = Math.max(1, height);
      break;
    default:
      passes = 15;
      divisor = 15;
  }
  const n = Math.max(1, Math.trunc(s / divisor));
  return { passes, n, passMs: Math.trunc((n * 50) / 3) };
}

/** passes of a DF.EXE effect of `passes` passes on screen at ramp step `step` — pass 0 from the call */
export function dfPassesAt(step: number, passes: number): number {
  return Math.max(1, Math.min(passes, step));
}

type Rgba = Uint8ClampedArray;

/**
 * Copy a `w`x`h` block from `src` at (sx, sy) into `out` at (dx, dy), both
 * `width`x`height` RGBA. Callers only ever pass blocks the original's own
 * clipping has already sized to the screen, so this clips nothing but empty.
 */
function copy(src: Rgba, out: Rgba, width: number, sx: number, sy: number, dx: number, dy: number, w: number, h: number): void {
  if (w <= 0 || h <= 0) return;
  for (let y = 0; y < h; y++) {
    const s = ((sy + y) * width + sx) * 4;
    out.set(src.subarray(s, s + w * 4), ((dy + y) * width + dx) * 4);
  }
}

/** an in-place reveal of the arriving picture, clipped to the screen as 0x43c620 clips it */
function reveal(to: Rgba, out: Rgba, width: number, height: number, top: number, left: number, bottom: number, right: number): void {
  const t = Math.max(0, top);
  const l = Math.max(0, left);
  const b = Math.min(height, bottom);
  const r = Math.min(width, right);
  copy(to, out, width, l, t, l, t, r - l, b - t);
}

/**
 * The strips one engine's effects step by — the only thing, with the pass
 * count, in which DF.EXE's reveals differ from TI.EXE's.
 */
interface Strips {
  /** a one-sided wipe or scroll, across and down */
  wipeX: number;
  wipeY: number;
  /** a barn door, from either edge or the centre */
  doorX: number;
  /** `irisclose`'s four edge strips */
  closeX: number;
  closeY: number;
  /** `irisopen`'s growth about the centre */
  openX: number;
  openY: number;
  /** `venetian`'s slat spacing, and how many rows of each slat `n` passes have copied */
  slat: number;
  slatRows: (n: number) => number;
}

function tiStrips(W: number, H: number, steps: number): Strips {
  const dx2 = Math.trunc(W / (2 * steps)) + 1;
  const dy2 = Math.trunc(H / (2 * steps)) + 1;
  return {
    // the one-sided strip (`/ steps`) and the two-sided one (`/ (2 * steps)`)
    wipeX: Math.trunc(W / steps) + 1,
    wipeY: Math.trunc(H / steps) + 1,
    doorX: dx2,
    closeX: dx2,
    closeY: dy2,
    openX: dx2,
    openY: dy2,
    // 0x43bf90: slats `steps + 1` rows apart, each copied `i + 1` rows deep on
    // pass i — so the last row of every slat waits for the final full copy
    slat: steps + 1,
    slatRows: (n) => n,
  };
}

function dfStrips(W: number, H: number): Strips {
  return {
    // `(extent + (extent >> 31 & 15)) >> 4` + 1, i.e. a sixteenth, rounded to
    // zero — the barn doors (0x434db4), scrolls (0x435182) and wipes (0x43551f)
    wipeX: Math.trunc(W / 16) + 1,
    wipeY: Math.trunc(H / 16) + 1,
    doorX: Math.trunc(W / 16) + 1,
    // irisclose: `idiv 12` on both extents (0x434f68, 0x434f7a)
    closeX: Math.trunc(W / 12) + 1,
    closeY: Math.trunc(H / 12) + 1,
    // irisopen: a sixteenth of the centre's coordinates, not of the extent
    // (0x435078..0x4350af) — half the step the other effects take
    openX: Math.trunc((W >> 1) / 16) + 1,
    openY: Math.trunc((H >> 1) / 16) + 1,
    // venetian: slats `height / 8 + 1` apart (`sar edi, 3; inc di`, 0x43547c),
    // pass k copying rows `y0 + k` and `y0 + k + 1` (`add ax, 2`, 0x4354b8) —
    // so after n passes n + 1 rows, and the last pass closes every slat
    slat: (H >> 3) + 1,
    slatRows: (n) => (n > 0 ? n + 1 : 0),
  };
}

/**
 * Draw `effect` after `passes` of its `steps` passes into `out`: `from` is the
 * screen the effect started on, `to` the picture it is revealing (the
 * offscreen), all three `width`x`height` RGBA. TI.EXE's geometry, which is
 * also tl.exe's and RedJack.exe's.
 *
 * Each effect is written as the union of the rects its passes have copied so
 * far, which is what the screen holds — a pass's rects never overlap an earlier
 * pass's differently, so the order they land in does not matter except for the
 * pushes, whose last pass says everything.
 */
export function composeEffect(
  effect: ExeEffect,
  from: Rgba,
  to: Rgba,
  out: Rgba,
  width: number,
  height: number,
  steps: number,
  passes: number,
): void {
  const n = Math.max(0, Math.min(steps, passes));
  draw(effect, from, to, out, width, height, n, tiStrips(width, height, steps));
}

/**
 * The same for DF.EXE: `effect` after `passes` of the fixed number {@link dfPlan}
 * gives it. The step count does not enter into the geometry at all.
 */
export function composeDfEffect(
  effect: DfEffect,
  from: Rgba,
  to: Rgba,
  out: Rgba,
  width: number,
  height: number,
  passes: number,
): void {
  const n = Math.max(0, Math.min(dfPlan(effect, 1, height).passes, passes));
  draw(effect, from, to, out, width, height, n, dfStrips(width, height));
}

function draw(effect: ExeEffect, from: Rgba, to: Rgba, out: Rgba, W: number, H: number, n: number, g: Strips): void {
  out.set(from.subarray(0, W * H * 4));
  if (n === 0) return;
  switch (effect) {
    // TI 0x43be50, DF 0x435670: A = [left, left + d) stepped right by d a pass
    case "wiperight":
      return reveal(to, out, W, H, 0, 0, H, n * g.wipeX);
    // TI 0x43bef0, DF 0x435710: A = [right - d, right) stepped left
    case "wipeleft":
      return reveal(to, out, W, H, 0, W - n * g.wipeX, H, W);
    // TI 0x43bd30, DF 0x4354f0: A = [top, top + d) stepped down
    case "wipedown":
      return reveal(to, out, W, H, 0, 0, n * g.wipeY, W);
    // TI 0x43bdc0, DF 0x4355b0: A = [bottom - d, bottom) stepped up
    case "wipeup":
      return reveal(to, out, W, H, H - n * g.wipeY, 0, H, W);
    // TI 0x43b670, DF 0x434d80: two strips walking in from the left and right edges
    case "barndoorclose":
      reveal(to, out, W, H, 0, 0, H, n * g.doorX);
      return reveal(to, out, W, H, 0, W - n * g.doorX, H, W);
    // TI 0x43b750, DF 0x434e50: two strips walking out from `(left + right) >> 1`
    case "barndooropen": {
      const mid = W >> 1;
      return reveal(to, out, W, H, 0, mid - n * g.doorX, H, mid + n * g.doorX);
    }
    // TI 0x43b830, DF 0x434f20: four full-length strips walking in from every
    // edge — the top and bottom ones the screen's width, the side ones its height
    case "irisclose":
      reveal(to, out, W, H, 0, 0, n * g.closeY, W);
      reveal(to, out, W, H, H - n * g.closeY, 0, H, W);
      reveal(to, out, W, H, 0, 0, H, n * g.closeX);
      return reveal(to, out, W, H, 0, W - n * g.closeX, H, W);
    // TI 0x43b980, DF 0x435060: ONE rect about the centre, grown by a strip on
    // every side a pass (DF.EXE clips it to the screen in place each pass,
    // 0x435103, which grows it no differently)
    case "irisopen": {
      const cy = H >> 1;
      const cx = W >> 1;
      return reveal(to, out, W, H, cy - n * g.openY, cx - n * g.openX, cy + n * g.openY, cx + n * g.openX);
    }
    // TI 0x43bf90, DF 0x435450: slats `g.slat` rows apart, `g.slatRows(n)` deep
    case "venetian": {
      const rows = g.slatRows(n);
      for (let y0 = 0; y0 < H; y0 += g.slat) reveal(to, out, W, H, y0, 0, y0 + rows, W);
      return;
    }
    // The SCROLLS copy a growing edge of the arriving picture to the OPPOSITE
    // edge of the screen, so it slides in over a leaving picture that does not
    // move: 0x43c620(A, B) with A the source strip and B the destination.
    // (DF.EXE's 0x4357c0 clips the two independently and copies the
    // destination's size from the source's corner, which past the screen is
    // the same `min`.)
    //
    // TI 0x43ba70, DF 0x435150: the arriving picture's bottom rows to the screen's top
    case "scrolldown": {
      const off = Math.min(H, n * g.wipeY);
      return copy(to, out, W, 0, H - off, 0, 0, W, off);
    }
    // TI 0x43bb20, DF 0x435210: its top rows to the screen's bottom
    case "scrollup": {
      const off = Math.min(H, n * g.wipeY);
      return copy(to, out, W, 0, 0, 0, H - off, W, off);
    }
    // TI 0x43bbd0, DF 0x4352d0: its right columns to the screen's left
    case "scrollright": {
      const off = Math.min(W, n * g.wipeX);
      return copy(to, out, W, W - off, 0, 0, 0, off, H);
    }
    // TI 0x43bc80, DF 0x435390: its left columns to the screen's right
    case "scrolleft": {
      const off = Math.min(W, n * g.wipeX);
      return copy(to, out, W, 0, 0, W - off, 0, off, H);
    }
    // The vertical TURNS push: each pass block-moves the screen a strip
    // (0x43c6b0, screen to screen) and copies the arriving strip into the edge
    // that vacated (0x43c620), so both pictures travel. Unlike turnleft/right
    // there is no clamp on the strip — the move's rect clips to nothing once the
    // offset passes the screen — and there IS a final full copy. (Not DF.EXE's.)
    //
    // 0x43c1f0 `turnup`: the screen moves DOWN, the arriving picture's bottom
    // comes in at the top
    case "turnup": {
      const off = Math.min(H, n * g.wipeY);
      copy(from, out, W, 0, 0, 0, off, W, H - off);
      return copy(to, out, W, 0, H - off, 0, 0, W, off);
    }
    // 0x43c2f0 `turndown`: the screen moves UP, the arriving picture's top
    // comes in at the bottom
    case "turndown": {
      const off = Math.min(H, n * g.wipeY);
      copy(from, out, W, 0, off, 0, 0, W, H - off);
      return copy(to, out, W, 0, 0, 0, H - off, W, off);
    }
  }
}

/**
 * RedJack.exe's `photodissolve` (24020, 0x4382a0) after its pass `i` of `steps`.
 *
 * It snapshots the leaving screen (0x483230 + 0x4828c0, screen to scratch) and
 * each pass hands the snapshot, the offscreen and `i, steps` to 0x489050, which
 * builds per-channel tables (0x489127..0x48917e) — for every byte value v,
 * `v * i / steps` (an `idiv`, so truncated) for the arriving picture and
 * `v - v * i / steps` for the leaving one — and writes their sum, channel by
 * channel. So pass 0 is the leaving picture exactly, and the last pass
 * (`steps - 1`) is still a step short of the arriving one, which the final full
 * copy (0x43845b) puts up. Paced as every other effect: draw, then wait for
 * `base + i`.
 *
 * Those are its 32-bit tables; at 16 bits it builds 32-entry ones per 5- or
 * 6-bit field (0x489249). The port's screen is 8 bits a channel, so it is the
 * 32-bit arithmetic here.
 */
export function composeDissolve(from: Rgba, to: Rgba, out: Rgba, pass: number, steps: number): void {
  const i = Math.max(0, Math.min(steps, pass));
  for (let o = 0, end = Math.min(out.length, from.length, to.length); o < end; o += 4) {
    for (let c = 0; c < 3; c++) {
      const old = from[o + c];
      out[o + c] = old - Math.trunc((old * i) / steps) + Math.trunc((to[o + c] * i) / steps);
    }
    out[o + 3] = 255;
  }
}
