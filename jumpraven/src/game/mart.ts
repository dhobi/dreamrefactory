/**
 * The Mart — ARMS MART, "Sterling Technology For A Tarnished World" — where the
 * score is cash and the six weapons are bought, sold and read about
 * (RAVEN.EXE 0x410540, before each day's flying).
 *
 * ## The screen (0x410614, 0x410c29)
 *
 * `mart`'s pictures (SHARED\MART, 31 of them): 0 the left panel with the VIDEO
 * box the dealer's head plays in (src/game/comms.ts), 1 to 4 the BUY, SELL,
 * INFO and CONTINUE buttons at their anchors on it, 5 the right panel — drawn
 * 122 in, so its last 18 columns are past the window's edge, as in the EXE —
 * then the 24 weapons' icons, 6 + 6 × tier + kind, and 30 SORRY! OUT OF
 * STOCK. The grid is four tiers of the six kinds, LASERS, SHELLS, ROCKETS,
 * MISSILES, BOMBS and DEFENSIVE, and the row under it the player's own.
 *
 * ## The stock (0x410614)
 *
 * Every weapon is in stock, and then one of the second tier is taken out at
 * random, two of the third and three of the fourth (0x427be7).
 *
 * ## Buying and selling (0x4107ef)
 *
 * A click selects a weapon in stock, or one of the player's own; a double
 * click (or a click with the Macintosh's option key, bit 0x800) is INFO on it,
 * or BUY straight away. BUY trades the weapon of that kind the player has in
 * for what it is worth — its price by the ammunition left, of a full 0x4380 —
 * and pays the rest; the new one comes full. SELL, with one of the player's
 * own selected, takes its worth and empties it. INFO plays its film, `laser1`
 * … `def4` (0x41119a). CONTINUE leaves — and a player who spent nothing gets
 * every first-tier weapon they can afford (0x410f1d).
 */
import { decodeFrameV0, type FrameV0 } from "@dreamfactory/engine/df/image-v0";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { playFilm, trackPress } from "@dreamfactory/engine/v0/film";
import type { Rect } from "@dreamfactory/engine/v0/screen";
import { Comms, DEALER } from "./comms";
import { SCREEN_H, SCREEN_W } from "./data";
import type { Co, Machine } from "./machine";
import { DoubleClick, anchored, inRect } from "./screens";
import { AMMO_FULL, KINDS, type Records } from "./records";

/** the right panel's left edge in the window (0x41067c) */
const PANEL_LEFT = 0x7a;
/** the buttons' pictures, at their anchors on the left panel */
const BUY = 1;
const SELL = 2;
const INFO = 3;
const CONTINUE = 4;
const RIGHT_PANEL = 5;
const FIRST_ICON = 6;
const OUT_OF_STOCK = 30;
/** the player's own weapons are the grid's fifth row (0x4110f1) */
export const OWN = 4;

/** a weapon's price by kind and tier (0x4112da) */
export const PRICES: readonly (readonly number[])[] = [
  [0xb4, 0xd8, 0x118, 0x13c],
  [0x56, 0x81, 0xe5, 0x102],
  [0xa9, 0x10e, 0x172, 0x230],
  [0xa6, 0xf0, 0x190, 0x230],
  [0xb5, 0xe6, 0xe6, 0x122],
  [0x78, 0xc8, 0xc8, 0x136],
];
/** INFO's film for a kind: `<name><tier + 1>.move` (0x41119a) */
const INFO_FILMS = ["laser", "gun", "rock", "miss", "bomb", "def"];

/** the CASH and VALUE fields, on the right panel (0x410731) */
const CASH: Rect = [0x118, 0x4e, 0x127, 0xa1];
const VALUE: Rect = [0x118, 0x10c, 0x127, 0x15f];
const FIELD_PAPER = 0xf5;
const CASH_INK = 0x19;
const VALUE_INK = 0x28;
/** the selection's frame: 2 pixels in 0x28 (0x410eac) */
const SELECTED_INK = 0x28;

/** the dealer's lines (the Mart asks for them by number, 0x4142b9(2, n)) */
const HELLO = 9;
const SOLD = 10;
const THANKS_FIRST = 11;
const NO_CASH = 14;
const GOODBYE = 15;

/** a cell of the grid in the window (0x4110f1): tier 0–3 or {@link OWN}, kind 0–5, 64 square */
export function cell(tier: number, kind: number): Rect {
  const top = [0x12, 0x51, 0x90, 0xcf, 0x12e][tier];
  const left = [0x7b, 0xba, 0xf9, 0x138, 0x177, 0x1b6][kind];
  return [top, left, top + 0x40, left + 0x40];
}

/** what a weapon of the player's own is worth: its price by what is left of it (0x4112da with tier 4) */
export function worth(r: Records, kind: number): number {
  return Math.trunc((PRICES[kind][r.tier[kind]] * r.ammo[kind]) / AMMO_FULL);
}

/** what the Mart's machine test sees */
export interface MartState {
  stock: boolean[][];
  selected: { tier: number; kind: number } | null;
}

export class Mart {
  readonly state: MartState;
  private readonly pictures: FrameV0[];
  private readonly clicks: DoubleClick;
  private lastThanks = -1;

  constructor(
    private readonly m: Machine,
    private readonly r: Records,
    private readonly comms: Comms,
    mart: Uint8Array,
  ) {
    const containers = readContainerFile(mart).containers;
    this.pictures = containers.map((c) => decodeFrameV0(c.data));
    this.clicks = new DoubleClick(m);
    // 0x410781: all in stock, then 1, 2 and 3 out of the tiers below the first
    const stock = [0, 1, 2, 3].map(() => KINDS.map(() => true));
    for (let tier = 1; tier < 4; tier++) {
      for (let n = 0; n < tier; n++) {
        const left = stock[tier].map((s, k) => (s ? k : -1)).filter((k) => k >= 0);
        if (!left.length) break;
        stock[tier][left[m.roll(left.length) - 1]] = false;
      }
    }
    this.state = { stock, selected: null };
  }

  /** where a machine test presses BUY and CONTINUE */
  targets(): { buy: Rect; cont: Rect } {
    return { buy: this.rect(BUY), cont: this.rect(CONTINUE) };
  }

  /** 0x4107ef: the screen, until CONTINUE, faded in to the game's palette */
  *run(day: number, palette: Uint8ClampedArray): Co {
    const m = this.m;
    this.comms.ask(DEALER, HELLO);
    this.draw();
    yield* m.fadeIn(palette);
    for (;;) {
      this.comms.tick();
      const e = m.take();
      if (e?.kind === "down") {
        const done = yield* this.click(e.x, e.y, day);
        if (done) return;
      }
      yield;
    }
  }

  /** a mouse-down; true when it was CONTINUE */
  private *click(x: number, y: number, day: number): Co<boolean> {
    const m = this.m;
    const s = this.state;
    const inside = (r: Rect) => inRect(r, x, y);
    const doubled = this.clicks.click(x, y);
    if (s.selected) {
      const buy = this.rect(BUY);
      if (inside(buy) && (yield* trackPress(m, buy))) {
        this.buyOrSell();
        this.draw();
        return false;
      }
      const info = this.rect(INFO);
      if (inside(info) && (yield* trackPress(m, info))) {
        yield* this.info(day);
        return false;
      }
    }
    const cont = this.rect(CONTINUE);
    if (inside(cont) && (yield* trackPress(m, cont))) {
      this.comms.ask(DEALER, GOODBYE);
      this.comms.leaving = true;
      return true;
    }
    for (let tier = 0; tier <= OWN; tier++) {
      for (let kind = 0; kind < 6; kind++) {
        const here = tier === OWN ? this.r.ammo[kind] > 0 : s.stock[tier][kind];
        const c = cell(tier, kind);
        if (!here || !inside(c) || !(yield* trackPress(m, c))) continue;
        s.selected = { tier, kind };
        if (doubled) yield* this.info(day);
        else this.draw();
        return false;
      }
    }
    return false;
  }

  /** BUY, or SELL with one of the player's own selected (0x4108d6) */
  private buyOrSell(): void {
    const r = this.r;
    const { tier, kind } = this.state.selected!;
    if (tier === OWN) {
      r.score += worth(r, kind);
      r.ammo[kind] = 0;
      this.state.selected = null;
      this.comms.ask(DEALER, SOLD);
      return;
    }
    const tradeIn = r.ammo[kind] > 0 ? worth(r, kind) : 0;
    const price = PRICES[kind][tier];
    if (r.score + tradeIn < price) return void this.comms.ask(DEALER, NO_CASH);
    r.ammo[kind] = AMMO_FULL;
    r.tier[kind] = tier;
    r.score += tradeIn - price;
    // 0x4110ba: a thank-you, not the same one twice running
    let n: number;
    do n = THANKS_FIRST - 1 + this.m.roll(3);
    while (n === this.lastThanks);
    this.lastThanks = n;
    this.comms.ask(DEALER, n);
  }

  /** INFO (0x41119a): the weapon's film, then the screen again */
  private *info(day: number): Co {
    const { tier, kind } = this.state.selected!;
    const t = tier === OWN ? this.r.tier[kind] : tier;
    yield* playFilm(this.m, `${INFO_FILMS[kind]}${t + 1}.move`, day);
    this.draw();
    this.comms.redraw();
  }

  /** a button's rect: its picture at its anchor, on the left panel */
  private rect(k: number): Rect {
    return anchored(this.pictures[k]);
  }

  /** 0x410c29: both panels, the grid, the selection, CASH and VALUE */
  draw(): void {
    const m = this.m;
    if (!m.draws) return;
    const s = m.screen;
    const p = this.pictures;
    const sel = this.state.selected;
    s.spriteAt(p[0], 0, 0);
    if (sel) s.sprite(p[sel.tier === OWN ? SELL : BUY], 0, 0);
    s.sprite(p[INFO], 0, 0);
    s.sprite(p[CONTINUE], 0, 0);
    this.comms.redraw();
    const panel: Rect = [0, PANEL_LEFT, SCREEN_H, SCREEN_W];
    s.spriteAt(p[RIGHT_PANEL], 0, PANEL_LEFT, panel);
    for (let tier = 0; tier < 4; tier++) {
      for (let kind = 0; kind < 6; kind++) {
        const [t, l] = cell(tier, kind);
        s.spriteAt(p[this.state.stock[tier][kind] ? FIRST_ICON + 6 * tier + kind : OUT_OF_STOCK], t, l, panel);
      }
    }
    for (let kind = 0; kind < 6; kind++) {
      if (!this.r.ammo[kind]) continue;
      const [t, l] = cell(OWN, kind);
      s.spriteAt(p[FIRST_ICON + 6 * this.r.tier[kind] + kind], t, l, panel);
    }
    if (sel) s.frame(cell(sel.tier, sel.kind), 2, SELECTED_INK);
    const font = m.font;
    const field = (r: Rect, value: number, ink: number) => {
      const at: Rect = [r[0], r[1] + PANEL_LEFT, r[2], r[3] + PANEL_LEFT];
      s.fill(at, FIELD_PAPER);
      if (font) s.text(font, at[1] + 3, at[0] + 14, String(value), ink, at);
    };
    field(CASH, this.r.score, CASH_INK);
    field(VALUE, sel ? (sel.tier === OWN ? worth(this.r, sel.kind) : PRICES[sel.kind][sel.tier]) : 0, VALUE_INK);
  }

  /**
   * 0x410f1d: a player who leaves with exactly 1000 (0x410f40) gets every
   * first-tier weapon they can afford — each kind, in order, full (0x417c81),
   * its tier set to 0 (0x417cc1) and its price taken off (0x41802a). As in
   * the EXE, a kind already owned is not passed over: it too is put back to
   * the first tier and paid for again.
   */
  close(): void {
    const r = this.r;
    if (r.score !== 1000) return;
    for (let kind = 0; kind < 6; kind++) {
      // 0x410f5c: never fails — the six first-tier prices come to 902 — but the EXE checks it, so it is kept
      if (r.score < PRICES[kind][0]) continue;
      r.ammo[kind] = AMMO_FULL;
      r.tier[kind] = 0;
      r.score -= PRICES[kind][0];
    }
  }
}

