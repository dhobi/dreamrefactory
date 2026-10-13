/**
 * The transition a *Dust* (DreamFactory 1) movie frame is drawn with — record
 * +0x06 of the v1 frame table (engine/src/df/mov-v1.ts).
 *
 * ## Where DF.EXE reads it
 *
 * The frame-draw function (0x404da0) first asks whether the frame's DIRTY RECT
 * at record +0x28 (i16 top, left, bottom, right) is empty (0x430200). If it is,
 * nothing is decoded or blitted: 0x405780 only spends the hold, fading the
 * palette for codes 17/18. Otherwise the picture is decoded off screen and
 * 0x405870 puts it on the screen:
 *
 *     0x405885  n  = max([hdr+0x26], record +0x02)    ; the frame's hold, ticks
 *     0x405899  [0x449088] = record +0x08             ; block size, code 13
 *     0x40589f  bx = record +0x06                     ; THE EFFECT
 *     0x4058a8  n  = 1 if n <= 0
 *     0x4058ca  cmp eax, 0x12 / ja 0x405c93           ; > 18: draw NOTHING
 *     0x4058d3  jmp [eax*4 + 0x405c9c]                ; 19 entries, 0..18
 *
 * Entries 0..16 first set the movie's palette if the segment's "palette not
 * yet set" word (0x449208, raised when the segment loads, 0x404824) is up, and
 * clear it; 17 and 18 do not touch it. Every effect then copies rectangles of
 * the off-screen picture to the screen through 0x406af0 (source rect, dest
 * rect — each clipped to the movie's bounds at header +0x1e, the copy taking
 * its size from the clipped destination and its origin from the clipped
 * source), and waits ONE tick (0x406ad0: the 50/3 ms clock of 0x425280) after
 * each step. So a transition takes `n` ticks — exactly the frame's hold, which
 * the movie loop's own deadline (0x40482d) is counting at the same time — and
 * every entry but 16 ends on one full copy of the dirty rect.
 *
 * Every one of the nineteen entries is its own routine; there are no aliases.
 * They were traced instruction by instruction in an emulator over the real
 * bytes, and {@link effectPlanV1} reproduces each trace copy for copy (the
 * node test `dust/tests/movie-effects.ts` pins the numbers). With `W`, `H` the
 * rect's size, `n` the step count and `/` C's truncating division:
 *
 *     0  0x405cf0  two columns closing in from the left and right edges, W/(2n+2)+1 wide
 *     1  0x405db0  two columns opening out from the centre (a horizontal barn door)
 *     2  0x405e80  all four edges closing in at once (H/(2n+2)+1 and W/(2n+2)+1)
 *     3  0x405fb0  a rectangle growing from the centre (iris open)
 *     4  0x406090  the picture SLIDES in from the top    (moving down, H/n+1 a step)
 *     5  0x406130  the picture slides in from the bottom (moving up)
 *     6  0x4061d0  the picture slides in from the left   (W/n+1 a step)
 *     7  0x406270  the picture slides in from the right
 *     8  0x406310  wipe down:  bands of H/n+1 rows, top first
 *     9  0x406390  wipe up:    the same, bottom first
 *    10  0x406410  wipe right: columns of W/n+1, left first
 *    11  0x406490  wipe left:  the same, right first
 *    12  0x406510  blinds: every (n+1)th row, each slat one row thicker a step
 *    13  0x4065a0  dissolve in squares of record +0x08 pixels: the grid is cut
 *                  into runs of n+1 cells and each step uncovers one random
 *                  covered cell of every run (0x406670)
 *    14  0x406790  n+1 horizontal bands, one random band a step
 *    15  0x4068d0  n+1 vertical bands, one random band a step
 *    16  0x406a10  plain: one copy, no wait
 *    17  0x406a20  copy, then fade the palette from the movie's to "Black" (the
 *                  CLUT resource loaded into 0x460230 at 0x42ff1e) over n ticks
 *    18  0x406a70  copy, then fade from Black to the movie's palette
 *
 * The fades go through 0x4306a0(from, to, step, total), called with step
 * 0..n-1 and total n-1: it lerps each 16-bit channel `from + (to-from)*s/t`
 * with BOTH numbers clamped to at least 1 and lands on `to` when `s >= t`. So
 * the first step of a fade is already one step in, and the last one is the
 * whole way. A fade does not set the palette back: after a 17 the screen stays
 * black through plain frames (whose palette word is long down) until an 18
 * brings it up — which is how SPANBLD.MOV and the endings hold a black beat
 * between scenes.
 *
 * Effects 13..15 draw from the C runtime's `rand()` (0x430550 =
 * `rand() * k / 0x7fff + 1`), so no two plays of the original matched. The
 * port draws from a fixed-seed generator of the same shape so that a film plays
 * the same way twice; no shipped film uses them.
 */

/** a rectangle the way DF.EXE stores one: i16 top, left, bottom, right */
export interface RectV1 {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** what a v1 frame says about how it is drawn */
export interface MovEffectV1 {
  /** record +0x06 — the transition, 0..18 (16 = plain) */
  code: number;
  /** record +0x28 — the frame's dirty rect; empty = nothing is drawn */
  rect: RectV1;
  /** record +0x08 — the square size effect 13 dissolves in */
  block: number;
}

/** one 0x406af0 copy: the off-screen picture at `src` onto the screen at `dst` */
export interface EffectCopyV1 {
  src: RectV1;
  dst: RectV1;
}

/** the 19 entries of the table at 0x405c9c, by code */
export const EFFECT_V1 = {
  edgesInH: 0,
  centreOutH: 1,
  edgesIn: 2,
  iris: 3,
  slideDown: 4,
  slideUp: 5,
  slideRight: 6,
  slideLeft: 7,
  wipeDown: 8,
  wipeUp: 9,
  wipeRight: 10,
  wipeLeft: 11,
  blinds: 12,
  dissolve: 13,
  bandsH: 14,
  bandsV: 15,
  plain: 16,
  toBlack: 17,
  fromBlack: 18,
} as const;

/** the routine each table entry calls (0x405c9c), for the record */
export const EFFECT_V1_ROUTINES: readonly number[] = [
  0x405cf0, 0x405db0, 0x405e80, 0x405fb0, 0x406090, 0x406130, 0x4061d0,
  0x406270, 0x406310, 0x406390, 0x406410, 0x406490, 0x406510, 0x4065a0,
  0x406790, 0x4068d0, 0x406a10, 0x406a20, 0x406a70,
];

/**
 * A transition as a timeline: `at[k]` is the copies made once `k` ticks of the
 * frame have passed (`at[0]` at once). After the last entry the screen holds.
 */
export interface EffectPlanV1 {
  at: EffectCopyV1[][];
  /** a palette fade run over `ticks` ticks alongside: 17 out, 18 in */
  fade: "out" | "in" | null;
  /** the "palette not yet set" word is honoured (and cleared) first */
  setsPalette: boolean;
  /** how many ticks the effect spends — the step count */
  ticks: number;
}

/**
 * The palette on screen relative to the movie's: `from` lerped toward the other
 * end by `s/d`. {@link FULL_V1} is the movie's own palette, {@link BLACK_V1}
 * the "Black" CLUT.
 */
export interface PaletteLevelV1 {
  from: "movie" | "black";
  s: number;
  d: number;
}
export const FULL_V1: PaletteLevelV1 = { from: "movie", s: 0, d: 1 };
export const BLACK_V1: PaletteLevelV1 = { from: "movie", s: 1, d: 1 };

const rect = (top: number, left: number, bottom: number, right: number): RectV1 => ({
  top,
  left,
  bottom,
  right,
});
const same = (r: RectV1): EffectCopyV1 => ({ src: r, dst: r });
/** C's truncating division, which is what idiv does */
const div = (a: number, b: number): number => Math.trunc(a / b);
/** the 16-bit registers the routines keep their rects in */
const i16 = (v: number): number => (v << 16) >> 16;

/**
 * MSVC's `rand()` (seeded, so a film plays the same way twice) through
 * 0x430550's scaling: a number in 1..k.
 */
export function randV1(seed = 1): (k: number) => number {
  let state = seed >>> 0;
  return (k) => {
    state = (Math.imul(state, 214013) + 2531011) >>> 0;
    let r = (state >>> 16) & 0x7fff;
    if (r === 0x7fff) r = 0x7ffe;
    return div(r * k, 0x7fff) + 1;
  };
}

/** the random-pick loop 13..15 share: the k-th (1-based) still-covered slot */
function pickCovered(
  covered: Uint8Array,
  base: number,
  count: number,
  rand: (k: number) => number,
): number {
  let free = 0;
  for (let i = 0; i < count; i++) if (!covered[base + i]) free++;
  if (free <= 0) return -1;
  let k = rand(free);
  let c = 0;
  // 0x4066dc: walk forward, counting down on each covered-free slot, and stop
  // on the slot that takes the count to zero
  for (; c < count; c++) {
    if (!covered[base + c]) k--;
    if (k <= 0) break;
  }
  if (c >= count) c = count - 1;
  covered[base + c] = 1;
  return c;
}

/** 0x430250 in one axis: map [a0,a1) of a span onto the rect's */
const mapSpan = (v: number, s0: number, s1: number, d0: number, d1: number): number =>
  s1 - s0 === d1 - d0 ? v + (d0 - s0) : i16(div((v - s0) * (d1 - d0), s1 - s0) + d0);

/**
 * The copies one table entry makes for a frame — DF.EXE's routine for `code`
 * over the dirty rect, in `n` steps (the frame's `max(hold, floor)`, at least 1).
 */
export function effectPlanV1(
  effect: MovEffectV1,
  n: number,
  rand: (k: number) => number = randV1(),
): EffectPlanV1 {
  n = Math.max(1, Math.trunc(n));
  const { code } = effect;
  const R = effect.rect;
  const { top: t, left: l, bottom: b, right: r } = R;
  const W = r - l;
  const H = b - t;
  const empty = l >= r || t >= b;
  // 0x405780: an empty dirty rect draws nothing — only the fades and the wait
  if (empty) {
    if (code === EFFECT_V1.toBlack || code === EFFECT_V1.fromBlack)
      return { at: [], fade: code === EFFECT_V1.toBlack ? "out" : "in", setsPalette: false, ticks: n };
    return { at: [], fade: null, setsPalette: true, ticks: n };
  }
  // 0x4058cd: past the table nothing is drawn, nothing waited, nothing set
  if (code < 0 || code > 18) return { at: [], fade: null, setsPalette: false, ticks: 0 };

  const at: EffectCopyV1[][] = [];
  const steps = (each: (i: number) => EffectCopyV1[]): void => {
    for (let i = 0; i < n; i++) at.push(each(i));
    at.push([same(R)]);
  };
  const half = (span: number): number => div(span, 2 * n + 2) + 1;
  const sy = div(H, n) + 1;
  const sx = div(W, n) + 1;
  switch (code) {
    case EFFECT_V1.edgesInH: {
      const d = half(W);
      steps((i) => [
        same(rect(t, l + i * d, b, l + (i + 1) * d)),
        same(rect(t, r - (i + 1) * d, b, r - i * d)),
      ]);
      break;
    }
    case EFFECT_V1.centreOutH: {
      const d = half(W);
      const c = (l + r) >> 1;
      steps((i) => [
        same(rect(t, c - (i + 1) * d, b, c - i * d)),
        same(rect(t, c + i * d, b, c + (i + 1) * d)),
      ]);
      break;
    }
    case EFFECT_V1.edgesIn: {
      const dy = half(H);
      const dx = half(W);
      steps((i) => [
        same(rect(t + i * dy, l, t + (i + 1) * dy, r)),
        same(rect(b - (i + 1) * dy, l, b - i * dy, r)),
        same(rect(t, r - (i + 1) * dx, b, r - i * dx)),
        same(rect(t, l + i * dx, b, l + (i + 1) * dx)),
      ]);
      break;
    }
    case EFFECT_V1.iris: {
      const dy = half(H);
      const dx = half(W);
      const cy = (t + b) >> 1;
      const cx = (l + r) >> 1;
      steps((i) => [
        same(rect(cy - (i + 1) * dy, cx - (i + 1) * dx, cy + (i + 1) * dy, cx + (i + 1) * dx)),
      ]);
      break;
    }
    case EFFECT_V1.slideDown:
      steps((i) => [{ src: rect(b - (i + 1) * sy, l, b, r), dst: rect(t, l, t + (i + 1) * sy, r) }]);
      break;
    case EFFECT_V1.slideUp:
      steps((i) => [{ src: rect(t, l, t + (i + 1) * sy, r), dst: rect(b - (i + 1) * sy, l, b, r) }]);
      break;
    case EFFECT_V1.slideRight:
      steps((i) => [{ src: rect(t, r - (i + 1) * sx, b, r), dst: rect(t, l, b, l + (i + 1) * sx) }]);
      break;
    case EFFECT_V1.slideLeft:
      steps((i) => [{ src: rect(t, l, b, l + (i + 1) * sx), dst: rect(t, r - (i + 1) * sx, b, r) }]);
      break;
    case EFFECT_V1.wipeDown:
      steps((i) => [same(rect(t + i * sy, l, t + (i + 1) * sy, r))]);
      break;
    case EFFECT_V1.wipeUp:
      steps((i) => [same(rect(b - (i + 1) * sy, l, b - i * sy, r))]);
      break;
    case EFFECT_V1.wipeRight:
      steps((i) => [same(rect(t, l + i * sx, b, l + (i + 1) * sx))]);
      break;
    case EFFECT_V1.wipeLeft:
      steps((i) => [same(rect(t, r - (i + 1) * sx, b, r - i * sx))]);
      break;
    case EFFECT_V1.blinds:
      steps((i) => {
        const out: EffectCopyV1[] = [];
        for (let y = 0; y < H; y += n + 1) out.push(same(rect(t + y, l, t + y + i + 1, r)));
        return out;
      });
      break;
    case EFFECT_V1.dissolve: {
      const B = effect.block;
      if (!B) {
        // a zero block divides by zero at 0x4065c3 in the original; nothing ships one
        at.push([same(R)]);
        break;
      }
      let cols = div(W, B);
      if (cols * B < W) cols++;
      let rows = div(H, B);
      if (rows * B < H) rows++;
      const cells = cols * rows;
      const covered = new Uint8Array(Math.max(1, cells));
      const g = n + 1;
      const groups = div(cells, g);
      steps(() => {
        const out: EffectCopyV1[] = [];
        for (let j = 0; j < groups; j++) {
          const c = pickCovered(covered, j * g, g, rand);
          if (c < 0) continue;
          const idx = j * g + c;
          const row = div(idx, cols);
          const col = idx - row * cols;
          const y = t + row * B;
          const x = l + col * B;
          out.push(same(rect(y, x, y + B, x + B)));
        }
        return out;
      });
      break;
    }
    case EFFECT_V1.bandsH:
    case EFFECT_V1.bandsV: {
      const covered = new Uint8Array(n + 1);
      steps(() => {
        const c = pickCovered(covered, 0, n + 1, rand);
        if (c < 0) return [];
        return [
          same(
            code === EFFECT_V1.bandsH
              ? rect(mapSpan(c, 0, n + 1, t, b), l, mapSpan(c + 1, 0, n + 1, t, b), r)
              : rect(t, mapSpan(c, 0, n + 1, l, r), b, mapSpan(c + 1, 0, n + 1, l, r)),
          ),
        ];
      });
      break;
    }
    case EFFECT_V1.plain:
      return { at: [[same(R)]], fade: null, setsPalette: true, ticks: 0 };
    case EFFECT_V1.toBlack:
    case EFFECT_V1.fromBlack:
      return {
        at: [[same(R)]],
        fade: code === EFFECT_V1.toBlack ? "out" : "in",
        setsPalette: false,
        ticks: n,
      };
  }
  return { at, fade: null, setsPalette: true, ticks: n };
}

/** the palette level a fade has reached after `elapsed` ticks (0x4306a0's clamps) */
export function fadeLevelV1(fade: "out" | "in", ticks: number, elapsed: number): PaletteLevelV1 {
  const step = Math.min(Math.max(0, elapsed), ticks - 1);
  return { from: fade === "out" ? "movie" : "black", s: Math.max(1, step), d: Math.max(1, ticks - 1) };
}

/**
 * The movie's palette (RGBA, 8 bits a channel) at a fade level: 0x4306a0's lerp,
 * done on the 16-bit channels the CLUT keeps (`c * 257`) and read back by the
 * high byte, toward or from the "Black" CLUT. Only entries 1–254 are faded:
 * the palette setter (0x421f30) forces 0 to black and 255 to white, so white
 * text stays white on a screen faded to black.
 */
export function fadePaletteV1(rgba: Uint8ClampedArray, level: PaletteLevelV1): Uint8ClampedArray {
  if (level.from === "movie" && level.s === 0) return rgba;
  const out = new Uint8ClampedArray(rgba.length);
  const whole = level.s >= level.d;
  for (let i = 0; i < rgba.length; i++) {
    if ((i & 3) === 3) {
      out[i] = rgba[i];
      continue;
    }
    if (i < 4 || i >= 255 * 4) {
      out[i] = i < 4 ? 0 : 255;
      continue;
    }
    const movie = rgba[i] * 257;
    let v: number;
    if (level.from === "movie") v = whole ? 0 : movie - div(movie * level.s, level.d);
    else v = whole ? movie : div(movie * level.s, level.d);
    out[i] = v >> 8;
  }
  return out;
}

/** clip one rect to the movie's bounds (0x430040); null when nothing is left */
function clip(rc: RectV1, height: number, width: number): RectV1 | null {
  const out = rect(
    Math.max(rc.top, 0),
    Math.max(rc.left, 0),
    Math.min(rc.bottom, height),
    Math.min(rc.right, width),
  );
  return out.bottom > out.top && out.right > out.left ? out : null;
}

/**
 * One copy onto `screen` from `picture`, both `width` x `height` (0x406af0).
 * With `drawn`, the pixels it writes are marked there (1) and the number newly
 * marked is returned.
 */
export function blitCopyV1(
  screen: Uint8Array,
  picture: Uint8Array,
  width: number,
  height: number,
  c: EffectCopyV1,
  drawn?: Uint8Array | null,
): number {
  const src = clip(c.src, height, width);
  const dst = clip(c.dst, height, width);
  if (!src || !dst) return 0;
  const w = dst.right - dst.left;
  const h = dst.bottom - dst.top;
  let marked = 0;
  for (let y = 0; y < h; y++) {
    const sy = src.top + y;
    if (sy >= height) break;
    const so = sy * width + src.left;
    const doff = (dst.top + y) * width + dst.left;
    const run = Math.min(w, width - src.left);
    screen.set(picture.subarray(so, so + run), doff);
    if (drawn)
      for (let k = doff; k < doff + run; k++)
        if (!drawn[k]) {
          drawn[k] = 1;
          marked++;
        }
  }
  return marked;
}

/**
 * One v1 film's screen, frame after frame: what the transition of the frame
 * on screen has drawn so far, and the palette level the fades have left.
 *
 * Kept outside the movie player so a node test can run it on a clock of its
 * own. `enter` starts a frame; `at(elapsed)` is the picture and palette level
 * after `elapsed` ticks of it.
 *
 * ## What a transition draws OVER
 *
 * Every copy goes straight onto the movie's window (0x406af0 -> 0x426bf0, the
 * destination `[0x4490f8]+0x12`, offset by the header's origin at +0x2a/+0x2c);
 * nothing clears that window when a film starts. So the "old picture" a film's
 * first frame wipes, slides or dissolves over is whatever the screen showed
 * when it was called — the room — and not black. With no frame of the film on
 * screen yet, `enter` therefore starts from an UNDRAWN screen: {@link at}
 * returns, beside the pixels, a mask of the ones the film has drawn, and the
 * compositor shows what was on screen through the rest. The mask goes away as
 * soon as every pixel has been drawn (every first frame on the disc has a
 * whole-picture dirty rect, so that is the end of its transition).
 *
 * ## One fade-out after another
 *
 * Both fade-out paths — 0x406a20 (table entry 17) and 0x4057fa (17 over an
 * empty dirty rect) — call 0x4306a0 with `from` = the movie's palette
 * `[0x44910c]` and `to` = Black `[0x460230]`, never with the palette on the
 * screen: 0x4306a0 lerps from its argument (0x430751..0x430811) into a copy and
 * hands it to AnimatePalette (0x421430 -> 0x4221b0, GDI32!AnimatePalette at
 * [0x462364]). So a 17 drawn straight after another starts again one step in
 * from the movie's FULL palette — half-bright for a three-tick 17 — and DF.EXE
 * shows that. No shipped film can reach it: every 17 that follows a 17 on the
 * disc sits after an exit (action 1), and the loop leaves once that frame's
 * action runs (0x404a79 -> 0x404ac5), before the next frame is drawn
 * (dust/tests/movie-effects.ts checks both).
 */
export class EffectScreenV1 {
  /** the palette level the last COMPLETED frame left on the screen */
  private level: PaletteLevelV1 = FULL_V1;
  /** 0x449208: the segment has not set its palette yet */
  private paletteUnset = true;
  private plan: EffectPlanV1 | null = null;
  private screen: Uint8Array | null = null;
  private picture: Uint8Array | null = null;
  private applied = 0;
  private width = 0;
  private height = 0;
  /** the level the frame started from (after its own palette set, if any) */
  private startLevel: PaletteLevelV1 = FULL_V1;
  /**
   * 1 where the film has drawn; null once it has drawn everywhere (or was
   * never asked to track it). See the class comment's "draws OVER".
   */
  private drawn: Uint8Array | null = null;
  /** how many pixels {@link drawn} still has at 0 */
  private undrawn = 0;

  /** a segment loaded: its palette is "not yet set" (0x404824) */
  startSegment(): void {
    this.paletteUnset = true;
  }

  /** forget the screen — a film that is not following another */
  reset(): void {
    this.level = FULL_V1;
    this.paletteUnset = true;
    this.plan = null;
    this.screen = null;
    this.picture = null;
    this.drawn = null;
    this.undrawn = 0;
  }

  /**
   * Put a frame up: `picture` is its composite, drawn over whatever the screen
   * shows by the frame's transition in `ticks` steps.
   */
  enter(
    effect: MovEffectV1 | undefined,
    ticks: number,
    picture: Uint8Array,
    width: number,
    height: number,
  ): void {
    this.settle();
    const kept = !!this.screen && this.screen.length === picture.length && this.width === width;
    const prev = kept ? this.screen! : new Uint8Array(picture.length);
    if (!kept) {
      // nothing of this film on the screen yet: what is there is the room
      this.drawn = new Uint8Array(picture.length);
      this.undrawn = picture.length;
    }
    this.width = width;
    this.height = height;
    this.picture = picture;
    this.plan = effect ? effectPlanV1(effect, ticks) : null;
    if (!this.plan) {
      // nothing says otherwise: the plain blit
      this.screen = picture;
      this.applied = 0;
      this.drawn = null;
      this.undrawn = 0;
      if (this.paletteUnset) this.level = FULL_V1;
      this.paletteUnset = false;
      this.startLevel = this.level;
      return;
    }
    if (this.plan.setsPalette && this.paletteUnset) {
      this.level = FULL_V1;
      this.paletteUnset = false;
    }
    this.startLevel = this.level;
    this.screen = prev.slice();
    this.applied = 0;
  }

  /** run the frame's transition to its end (the next frame is coming up) */
  private settle(): void {
    if (!this.plan) return;
    this.advance(Number.MAX_SAFE_INTEGER);
    if (this.plan.fade) this.level = fadeLevelV1(this.plan.fade, this.plan.ticks, this.plan.ticks);
    this.plan = null;
  }

  private advance(elapsed: number): void {
    const plan = this.plan;
    if (!plan || !this.screen || !this.picture) return;
    const upTo = Math.min(plan.at.length, Math.max(0, Math.floor(elapsed)) + 1);
    for (; this.applied < upTo; this.applied++)
      for (const c of plan.at[this.applied]) {
        this.undrawn -= blitCopyV1(this.screen, this.picture, this.width, this.height, c, this.drawn);
        if (this.drawn && this.undrawn <= 0) this.drawn = null;
      }
  }

  /** is a transition still drawing or fading after `elapsed` ticks? */
  busy(elapsed: number): boolean {
    const plan = this.plan;
    if (!plan) return false;
    return elapsed < plan.at.length - 1 || (!!plan.fade && elapsed < plan.ticks - 1);
  }

  /** a number that changes whenever {@link at} would draw something different */
  step(elapsed: number): number {
    const plan = this.plan;
    if (!plan) return 0;
    return Math.min(Math.max(0, Math.floor(elapsed)), Math.max(plan.at.length, plan.ticks));
  }

  /**
   * The screen after `elapsed` ticks of the frame: its pixels, palette level,
   * and — while the film has not yet drawn everywhere — the mask of where it
   * has (1); the rest is still what was on screen before the film.
   */
  at(elapsed: number): { pixels: Uint8Array; level: PaletteLevelV1; drawn: Uint8Array | null } {
    this.advance(elapsed);
    const plan = this.plan;
    const level = plan?.fade
      ? fadeLevelV1(plan.fade, plan.ticks, Math.floor(elapsed))
      : this.startLevel;
    return { pixels: this.screen ?? new Uint8Array(0), level, drawn: this.drawn };
  }
}
