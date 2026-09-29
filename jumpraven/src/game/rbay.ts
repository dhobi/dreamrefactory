/**
 * The repair bay (RAVEN.EXE 0x41f990): the craft landed on the bay's beacon,
 * `rbay.move`, then the bay's screen — the six systems a hit can knock out,
 * each lit where it is out, a REPAIR, an INFO and a CONTINUE.
 *
 * ## The screen (0x41fa3e, 0x420318)
 *
 * `rbay`'s pictures (the day's RBAY, 12): 0 the screen, 1 to 3 REPAIR, INFO
 * and CONTINUE at their anchors, 4 the systems' panel — drawn 0x7a to the
 * right of its anchor — 5 a system that works and 6 to 11 each system out:
 * the video, the radar, the shields (under 0x2d00), the direction, the
 * distance and the engines, in rows of three 0x80 apart from (0xe, 0) and
 * (0xad, 0) on the panel. The one chosen is framed 2 pixels in 0x28; the cash
 * is written in 0x19 under the buttons (0x4207bb).
 *
 * ## The choices (0x41fcca)
 *
 * A system that is out is chosen by a click on it; a second click, or INFO,
 * plays its film (`video.move` …); a click with the option key held repairs
 * it at once (not here: a press on the page carries no modifiers). REPAIR mends the one chosen if the cash covers it — the video
 * $95, the radar $310, the shields $155 (full again), the direction $75, the
 * distance $80, the engines $420 — the bay's head saying one of its three
 * thank-yous (0x42077c), or line 0xe if it does not. CONTINUE is the bay's
 * line 0xf and back to the flight (0x414ba9).
 */
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import type { Rect } from "@dreamfactory/engine/v0/screen";
import { trackPress } from "@dreamfactory/engine/v0/film";
import { AMMO_FULL } from "./records";
import type { Co, Machine } from "./machine";
import type { Comms } from "./comms";
import { REPAIR } from "./comms";
import type { HudApi } from "./combat/api";
import { readPictures } from "./combat/world";
import { DoubleClick, anchored, inRect } from "./screens";

const SCREEN = 0;
const BUTTON_REPAIR = 1;
const BUTTON_INFO = 2;
const BUTTON_CONTINUE = 3;
const PANEL = 4;
const WORKS = 5;
/** the panel is drawn this far right of its anchor (0x41faa6) */
const PANEL_RIGHT = 0x7a;
const FRAME_INK = 0x28;
const CASH_INK = 0x19;
const PAPER = 0xf5;
/** `[0x439ea8]`: where the cash is written */
const CASH: Rect = [0x15a, 0x63, 0x169, 0xb1];

interface System {
  name: string;
  film: string;
  cost: number;
  /** its slot on the panel, as 0x420318 draws it */
  v: number;
  h: number;
  out: (hud: HudApi) => boolean;
  mend: (hud: HudApi) => void;
}

/** 0x41fb7f … (the slots), 0x43215c (the repairs), 0x41ff3d (the films) */
const SYSTEMS: System[] = [
  { name: "video", film: "video.move", cost: 0x5f, v: 0xe, h: 0, out: (h) => h.videoOut(), mend: (h) => h.x417c37() },
  { name: "radar", film: "radar.move", cost: 0x136, v: 0xe, h: 0x80, out: (h) => h.radarOut(), mend: (h) => h.x417c2c() },
  { name: "shields", film: "shield.move", cost: 0x9b, v: 0xe, h: 0x100, out: (h) => h.shields() < 0x2d00, mend: (h) => h.addShields(AMMO_FULL) },
  { name: "direction", film: "direct.move", cost: 0x4b, v: 0xad, h: 0, out: (h) => h.directionOut(), mend: (h) => h.x417c4d() },
  { name: "distance", film: "dist.move", cost: 0x50, v: 0xad, h: 0x80, out: (h) => h.distanceOut(), mend: (h) => h.x417c6c() },
  { name: "engines", film: "hover.move", cost: 0x1a4, v: 0xad, h: 0x100, out: (h) => h.enginesHit(), mend: (h) => h.x417c42() },
];

export interface RbayState {
  /** `[0x439e24]`: the system chosen, −1 for none */
  chosen: number;
}

export class Rbay {
  readonly state: RbayState = { chosen: -1 };
  private readonly pics: (FrameV0 | undefined)[];
  private readonly clicks: DoubleClick;
  /** `[0x439e20]`: the thank-you said last */
  private thanked = -1;

  constructor(
    private readonly m: Machine,
    private readonly hud: HudApi,
    private readonly comms: Comms,
    file: Uint8Array,
    /** plays a film of the day's (0x411464) */
    private readonly film: (name: string) => Co,
  ) {
    this.pics = readPictures(file);
    this.clicks = new DoubleClick(m);
  }

  private rect(k: number): Rect {
    const f = this.pics[k];
    return f ? anchored(f) : [0, 0, 0, 0];
  }

  /** a system's rect in the window */
  private slot(k: number): Rect {
    const s = SYSTEMS[k];
    return [s.v, s.h + PANEL_RIGHT, s.v + 0x96, s.h + PANEL_RIGHT + 0x78];
  }

  /** 0x41fcca: the screen, until CONTINUE */
  *run(palette: Uint8ClampedArray): Co {
    const m = this.m;
    this.state.chosen = -1;
    this.comms.ask(REPAIR, 9);
    this.draw();
    yield* m.fadeIn(palette);
    for (;;) {
      this.comms.tick();
      const e = m.take();
      if (e?.kind === "down") {
        if (yield* this.click(e.x, e.y)) return;
        this.draw();
      }
      yield;
    }
  }

  /** a press on the screen; true for CONTINUE */
  private *click(x: number, y: number): Co<boolean> {
    const m = this.m;
    const at = (r: Rect): boolean => inRect(r, x, y);
    if (at(this.rect(BUTTON_REPAIR)) && (yield* trackPress(m, this.rect(BUTTON_REPAIR)))) {
      this.repair();
      return false;
    }
    if (at(this.rect(BUTTON_INFO)) && (yield* trackPress(m, this.rect(BUTTON_INFO)))) {
      const s = SYSTEMS[this.state.chosen];
      if (s) yield* this.film(s.film);
      return false;
    }
    if (at(this.rect(BUTTON_CONTINUE)) && (yield* trackPress(m, this.rect(BUTTON_CONTINUE)))) {
      this.comms.ask(REPAIR, 0xf);
      this.comms.leaving = true;
      return true;
    }
    const doubled = this.clicks.click(x, y);
    for (let k = 0; k < SYSTEMS.length; k++) {
      const s = SYSTEMS[k];
      if (!s.out(this.hud) || !at(this.slot(k)) || !(yield* trackPress(m, this.slot(k)))) continue;
      this.state.chosen = k;
      // 0x42004a: with the option key held the EXE repairs it there and then — the page's presses carry no modifiers
      if (doubled) yield* this.film(s.film);
      return false;
    }
    return false;
  }

  /** 0x41fd93: the system chosen mended, if the cash covers it */
  private repair(): void {
    const s = SYSTEMS[this.state.chosen];
    this.state.chosen = -1;
    if (!s) return;
    if (this.hud.score() < s.cost) return this.comms.ask(REPAIR, 0xe);
    s.mend(this.hud);
    this.hud.addScore(-s.cost);
    this.thank();
  }

  /** 0x42077c: one of the bay's thank-yous, 0xb to 0xd, not the last again — unless it is talking */
  private thank(): void {
    if (this.comms.talking() === REPAIR) return;
    let k: number;
    do k = this.m.roll(3) + 0xa;
    while (k === this.thanked);
    this.thanked = k;
    this.comms.ask(REPAIR, k);
  }

  /** 0x420318 */
  draw(): void {
    const m = this.m;
    if (!m.draws) return;
    const s = m.screen;
    const p = this.pics;
    for (const k of [SCREEN, BUTTON_REPAIR, BUTTON_INFO, BUTTON_CONTINUE]) if (p[k]) s.sprite(p[k]!, 0, 0);
    this.comms.redraw();
    if (p[PANEL]) s.sprite(p[PANEL]!, 0, PANEL_RIGHT);
    SYSTEMS.forEach((sys, k) => {
      const f = p[sys.out(this.hud) ? 6 + k : WORKS];
      if (f) s.sprite(f, sys.v, sys.h + PANEL_RIGHT);
    });
    if (this.state.chosen >= 0) s.frame(this.slot(this.state.chosen), 2, FRAME_INK);
    // 0x4207bb: the cash
    s.fill(CASH, PAPER);
    if (m.font) s.text(m.font, CASH[1] + 3, CASH[0] + 0xe, String(this.hud.score()), CASH_INK);
  }
}
