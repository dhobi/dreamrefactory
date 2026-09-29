/**
 * The panels round the view and the records the flight keeps — RAVEN.EXE
 * 0x415078 … 0x418878. The panels are `panel`'s pictures (SHARED\PANEL):
 *
 *   left   VIDEO (the comms box), COPILOT's three buttons — NAVIGATION,
 *          HOVER CONTROL, ARMS CONTROL — the six menu buttons (SAVE HELP
 *          SOUND / KEYS PAUSE QUIT) and SYSTEM's HOVER and FLY
 *   right  RADAR, DIRECTION (the needle, what the beacon marks and DIST),
 *          the bars AMMO, FUEL, SHLD, PODS and the CASH
 *   above  the status strip: the lives, a dash each
 *   below  the weapons strip, the chosen weapon lit
 *
 * ## The drawing (0x415078, 0x416025)
 *
 * Each strip is a graf (`_portopengraf`) over one scratch of 0xc000 bytes
 * (`[0x437454]`) that all of them share, each at its own width: a part is
 * drawn into its graf — the strip's own picture first, within the rect
 * (`[0x43b254]`, what 0x4091f4 clips to) — and that rect copied to the window
 * (`_portupdategraf`). A frame draws the whole of every strip when asked to
 * (0x41601a: a flight's start, a life lost …) and otherwise only what has
 * changed, each part against the copy of what it last showed (0x417639).
 *
 * ## The systems (0x417dac, 0x417af1 …)
 *
 * A hit of 0x2c or more to the shields may knock something out: the lower the
 * shields the likelier (a roll of 1 to shields + 1 of at most 0x240), and then
 * one of what still works — a weapon, the radar, the video, the direction or
 * the distance, the engines. The radar goes blank; the video shows snow; the
 * direction shows static a few frames at a time; the distance stops; the
 * engines make HOVER's slide 2 a key, not 6. The repair bay mends them
 * (0x417c2c …).
 *
 * ## The beacon (0x417cd1, 0x418097)
 *
 * Every 0xa0 to 0xdc frames without a beacon the flight calls in what it
 * needs: the fuel station when the fuel is under 0x1b00, the weapons ship when
 * three weapons are empty, the repair bay when two systems are out or the
 * shields are under 0x1680 — one of them at a roll, never the one called
 * last. It comes down at a street cell `[0x43cf5a]` cells out on a ring round
 * the city's origin (0x41842c: the city wraps, the world moves with the craft,
 * so the ring is that far off), the beacon marks it and DIRECTION points the
 * way. When the pods are gone (PODS empty) the pods' beacon is set twice as
 * far out, the boss over it (0x417d70); landing there with the boss down ends
 * the level. Landing is at most 0x5a up, at rest, within 0x14 of the cell's
 * centre.
 *
 * The records that outlive a flight are {@link Records} (`w.r`): the score
 * `[0x43788c]`, the tiers `[0x437858]`, the ammunition `[0x437890]`, the bars
 * `[0x4378bc]` SHLD, `[0x4378c0]` PODS and `[0x4378c4]` FUEL, the lives
 * `[0x4378c8]`. The rest is {@link HudState}, which the EXE keeps from flight
 * to flight too: only 0x415f51 (a new game, a life lost) zeroes it.
 */
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import type { BitmapFont } from "@dreamfactory/engine/v0/font";
import { SCREEN_H, SCREEN_W, type Rect } from "@dreamfactory/engine/v0/screen";
import { AMMO_FULL } from "../records";
import { PILOT, REPAIR, type Comms } from "../comms";
import type { HudApi } from "./api";
import { turnToward } from "./lib";
import { World, abs, dist, inside, newObj, setObj, type Obj } from "./world";

/** `panel`'s pictures (0x415094: 0x33 of them), by what each is */
const PIC = {
  left: 0,
  snow: 1,
  /** 2 + k: COPILOT's NAVIGATION, HOVER CONTROL, ARMS CONTROL lit */
  copilot: 2,
  /** 5 + k: SAVE HELP SOUND KEYS PAUSE QUIT lit */
  menu: 5,
  /** 11 + k: HOVER, FLY lit */
  mode: 11,
  status: 13,
  weapons: 14,
  /** 15 + k: the weapon lit */
  weapon: 15,
  right: 21,
  /** 22 + k, k 0 to 2: DIRECTION's static */
  jam: 22,
  /** 25 + k: the needle, 16 ways, 0 up */
  needle: 25,
  compass: 41,
  /** a button's cover, over what cannot be pressed */
  cover: 42,
  /** 42 + n: n lives' dashes */
  lives: 42,
  /** 47 + kind: FUEL AMMO PODS RBAY, what the beacon marks */
  mark: 47,
} as const;
export const PANEL_PICTURES = 0x33;

/** HOVER and FLY, `[0x4378a8]`; −1 when the copilots have both */
export const HOVER = 0;
export const FLY = 1;
/** `[0x4378ac]`, a menu button pressed, for the flight to act on */
export const SAVE = 0;
export const HELP = 1;
export const SOUND = 2;
export const KEYS = 3;
export const PAUSE = 4;
export const QUIT = 5;
/** the beacon's kinds (0x417cd1's third) */
export const MARK_FUEL = 0;
export const MARK_AMMO = 1;
export const MARK_PODS = 2;
export const MARK_BAY = 3;

/** the colours: paper, ink, a low bar's ink (0x418538) and the radar's */
const PAPER = 0xf5;
const INK = 0x19;
const LOW = 0x28;
const HOT = 0xd7;
const OURS = 0xc8;
/** `[0x437460]`: the bars' pen pattern, each row 0xbb */
const BAR_PATTERN = 0xbb;

/** the window's rect, `[0x43b2dc]`: what a stamp is clipped to when nothing narrower is asked */
const WHOLE: Rect = [0, 0, SCREEN_H, SCREEN_W];

/** a graf over the scratch: `rows` by `cols`, where its (0, 0) is in the window */
interface Graf {
  rows: number;
  cols: number;
  top: number;
  left: number;
}
/** 0x437544 → 0x43756c the left panel, 0x43754c → 0x43758c the right, 0x437554 → 0x4375ac the weapons, 0x43755c → 0x4375cc the status, 0x437564 → 0x4375ec the radar */
const LEFT: Graf = { rows: 0x180, cols: 0x80, top: 0, left: 0 };
const RIGHT: Graf = { rows: 0x180, cols: 0x80, top: 0, left: 0x180 };
const WEAPONS: Graf = { rows: 0x3f, cols: 0x100, top: 0x141, left: 0x80 };
const STATUS: Graf = { rows: 0xb, cols: 0x100, top: 0, left: 0x80 };
const RADAR: Graf = { rows: 0x5c, cols: 0x5c, top: 0x1b, left: 0x193 };

/** the right panel's parts (0x415646 …): the radar, DIST, the bars and CASH */
const R_RADAR: Rect = [0x1b, 0x13, 0x77, 0x6f];
const R_DIST: Rect = [0xd0, 0x2d, 0xdf, 0x53];
const R_AMMO: Rect = [0x11e, 0x2d, 0x128, 0x7b];
const R_FUEL: Rect = [0x131, 0x2d, 0x13b, 0x7b];
const R_SHLD: Rect = [0x144, 0x2d, 0x14e, 0x7b];
const R_PODS: Rect = [0x157, 0x2d, 0x161, 0x7b];
const R_CASH: Rect = [0x169, 0x2d, 0x178, 0x7b];
/** the comms box in the left panel (0x41545c) */
const R_BOX: Rect = [0x1b, 0x12, 0x98, 0x6e];

/** the radar's marks (0x41868b …), as (dv, dh) from the point */
const PLUS = [[-1, 0], [0, -1], [0, 0], [0, 1], [1, 0]];
const TRIANGLE = [[-1, 0], [0, -1], [0, 1], [1, -2], [1, -1], [1, 0], [1, 1], [1, 2]];
const RING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const SQUARE = [-2, -1, 0, 1, 2].flatMap((v) => [-2, -1, 0, 1, 2].map((h) => [v, h]));
const DIAMOND = [[-2, 0], [-1, -1], [-1, 0], [-1, 1], [0, -2], [0, 2], [1, -1], [1, 0], [1, 1], [2, 0]];
const BRACKETS = [[-2, -2], [-2, -1], [-2, 1], [-2, 2], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -2], [2, -1], [2, 1], [2, 2]];
const DOT = [[0, 0]];

/** what the HUD keeps beside the records, `[0x43783c]` … `[0x4378f4]` */
export interface HudState {
  /** `[0x437870]`: the next frame draws every strip whole (0x41601a) */
  redraw: number;
  /** `[0x4378a8]`: {@link HOVER}, {@link FLY}, −1 neither */
  mode: number;
  /** `[0x4378ac]`: the menu button pressed, −1 none */
  menu: number;
  /** `[0x4378b0]`: the weapon chosen, −1 none */
  weapon: number;
  /** `[0x4378b4]`: frames DIRECTION's static has left to show */
  jam: number;
  /** `[0x4378b8]`: the video's snow shown */
  snow: number;
  /** `[0x4378cc]`, `[0x4378d0]`, `[0x4378d4]`: the copilot navigates, controls HOVER, controls the weapons */
  nav: number;
  hover: number;
  arms: number;
  /** `[0x4378d8]`: the beacon is up; `[0x437878]` what it marks, −1 none; `[0x437874]` what the last one marked */
  beaconOn: number;
  beaconKind: number;
  lastKind: number;
  /** `[0x437840]`: the beacon, at its cell's centre */
  beacon: Obj;
  /** `[0x4378dc]`: the needle shown, 0 to 15 round from ahead; `[0x43787c]` the needle's own heading, 0 north */
  needle: number;
  bearing: number;
  /** `[0x4378e0]`: DIST, in cells, at most 9999 */
  distance: number;
  /** `[0x4378f0]` the radar, `[0x4378e4]` the video, `[0x4378ec]` the direction, `[0x4378e8]` the distance, `[0x4378f4]` the engines: knocked out */
  radarOut: number;
  videoOut: number;
  directionOut: number;
  distanceOut: number;
  enginesOut: number;
  /** `[0x437888]`: the radar's frame, one a frame on the move and one every third at rest; `[0x437880]` the count to three */
  radarFrame: number;
  radarPhase: number;
  /** `[0x437884]`: the static picture shown last */
  lastJam: number;
  /** `[0x43783c]`: frames to the next call-in */
  callIn: number;
  /** `[0x437470]`: the repair bay has spoken as the craft came near; `[0x437474]` frames it waits */
  bayGreeted: number;
  bayWait: number;
}

export const newHudState = (): HudState => ({
  redraw: 0, mode: HOVER, menu: -1, weapon: 0, jam: 0, snow: 0, nav: 0, hover: 0, arms: 0,
  beaconOn: 0, beaconKind: -1, lastKind: -1, beacon: newObj(), needle: 0, bearing: 0, distance: 0,
  radarOut: 0, videoOut: 0, directionOut: 0, distanceOut: 0, enginesOut: 0,
  radarFrame: 0, radarPhase: 0, lastJam: 0, callIn: 0, bayGreeted: 0, bayWait: 0,
});

/** what each part last showed (`[0x4378f8]` … `[0x437950]`), set whole by 0x417639 */
interface Shown {
  score: number; radarFrame: number; ammo: number; mode: number; menu: number; weapon: number;
  jam: number; snow: number; shields: number; pods: number; fuel: number; lives: number;
  nav: number; hover: number; arms: number; beaconOn: number; needle: number; distance: number;
  videoOut: number; distanceOut: number; directionOut: number; radarOut: number; enginesOut: number;
}

export class Hud implements HudApi {
  /** `[0x437454]`: the scratch every graf is over */
  private readonly bits = new Uint8Array(0xc000);
  /** `[0x43b254]`: what a stamp is clipped to, in the graf's own pixels */
  private clip: Rect = WHOLE;
  private readonly shown: Shown;
  /** each picture's rect with its anchor at (0, 0) (0x408e77) */
  private readonly rect: Rect[];
  /** 0x4376bc, 0x4376c4, 0x4376cc: the menu buttons', SYSTEM's and the weapons' rects together */
  private readonly menuAll: Rect;
  private readonly modeAll: Rect;
  private readonly weaponsAll: Rect;
  /**
   * 0x41f990 is due: the craft landed at the repair bay. The flight plays the
   * bay's screen and clears this (the beacon is already off, 0x418254).
   */
  bay = false;

  constructor(
    private readonly w: World,
    private readonly pics: (FrameV0 | undefined)[],
    /** the comms box, 0x4142b9's lines and 0x413c6d's ticks; null for none */
    private readonly comms: Comms | null,
    /** kept by the game from flight to flight, as the EXE's globals are */
    readonly s: HudState = newHudState(),
  ) {
    this.rect = pics.map((f) => (f ? World.rectOf(f, 0, 0, false) : ([0, 0, 0, 0] as Rect)));
    const union = (ks: number[]): Rect => ks.map((k) => this.rect[k]).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
    this.menuAll = union([5, 10, 7, 9, 6, 8]);
    this.modeAll = union([11, 12]);
    this.weaponsAll = union([15, 16, 17, 18, 19, 20]);
    this.shown = {} as Shown;
    this.sync();
  }

  // ---- the drawing's primitives -------------------------------------------------

  /** 0x4091f4: a picture with its anchor at (y, x) into a graf, within the clip */
  private stamp(k: number, g: Graf, y = 0, x = 0): void {
    const f = this.pics[k];
    if (!f || !this.w.m.draws) return;
    const [top, left] = World.rectOf(f, y, x, false);
    const [ct, cl, cb, cr] = this.clip;
    for (let r = 0; r < f.height; r++) {
      const v = top + r;
      if (v < ct || v >= cb || v < 0 || v >= g.rows) continue;
      for (let c = 0; c < f.width; c++) {
        const h = left + c;
        if (h < cl || h >= cr || h < 0 || h >= g.cols) continue;
        const i = r * f.width + c;
        if (f.opaque[i]) this.bits[v * g.cols + h] = f.indexed[i];
      }
    }
  }

  /** a picture at another picture's rect's top-left (the cover over a button) */
  private stampAt(k: number, g: Graf, at: Rect): void {
    this.stamp(k, g, at[0], at[1]);
  }

  /** `_portpaintrect` in one colour, or in {@link BAR_PATTERN} of `ink` on `paper` */
  private paint(g: Graf, r: Rect, ink: number, paper = -1): void {
    if (!this.w.m.draws) return;
    for (let v = Math.max(r[0], 0); v < Math.min(r[2], g.rows); v++)
      for (let h = Math.max(r[1], 0); h < Math.min(r[3], g.cols); h++)
        this.bits[v * g.cols + h] = paper < 0 || (BAR_PATTERN >> (7 - (h & 7))) & 1 ? ink : paper;
  }

  /** `_portdrawstring` at (x, baseline) in the graf */
  private text(g: Graf, x: number, baseline: number, s: string, ink: number): void {
    const font: BitmapFont | null = this.w.m.font;
    if (!font || !this.w.m.draws) return;
    const top = baseline - font.ascent;
    for (const ch of s) {
      const gl = font.glyphs.get(ch.charCodeAt(0));
      if (!gl) continue;
      for (let r = 0; r < font.height; r++) {
        const v = top + r;
        if (v < 0 || v >= g.rows) continue;
        for (let c = 0; c < gl.width; c++) {
          const h = x + c;
          if (h >= 0 && h < g.cols && gl.rows[r][c]) this.bits[v * g.cols + h] = ink;
        }
      }
      x += gl.width;
    }
  }

  /** `_portupdategraf`: a rect of the graf to the same place in the window */
  private copy(g: Graf, r: Rect): void {
    const m = this.w.m;
    if (!m.draws) return;
    const px = m.screen.pixels;
    for (let v = Math.max(r[0], 0); v < Math.min(r[2], g.rows); v++) {
      const y = g.top + v;
      if (y < 0 || y >= SCREEN_H) continue;
      for (let h = Math.max(r[1], 0); h < Math.min(r[3], g.cols); h++) {
        const x = g.left + h;
        if (x >= 0 && x < SCREEN_W) px[y * SCREEN_W + x] = this.bits[v * g.cols + h];
      }
    }
    m.screen.version++;
  }

  private whole(g: Graf): void {
    this.copy(g, [0, 0, g.rows, g.cols]);
  }

  /** 0x4142b9 */
  private say(who: number, line: number): void {
    this.comms?.ask(who, line);
  }

  // ---- the frame ----------------------------------------------------------------

  /** 0x41601a at a flight's start (0x40b3ad) */
  reset(): void {
    this.redraw();
  }

  /** 0x41601a: every strip drawn whole on the next frame */
  redraw(): void {
    this.s.redraw = 1;
  }

  /** 0x417639: what each part shows is what there is (the fuel's excepted, as in the EXE) */
  private sync(): void {
    const s = this.s;
    Object.assign(this.shown, {
      ammo: this.ammo(this.weapon()), shields: this.shields(), pods: this.pods(), lives: this.lives(), score: this.score(),
      radarFrame: s.radarFrame, mode: s.mode, menu: s.menu, weapon: s.weapon, jam: s.jam, snow: s.snow,
      nav: s.nav, hover: s.hover, arms: s.arms, beaconOn: s.beaconOn, needle: s.needle, distance: s.distance,
      videoOut: s.videoOut, distanceOut: s.distanceOut, directionOut: s.directionOut, radarOut: s.radarOut, enginesOut: s.enginesOut,
    });
    this.shown.fuel ??= this.fuel();
  }

  /**
   * 0x416025: a frame of the panels, after the view is up (0x40c08a, 0x40c34b)
   * — the beacon's arrivals, then the strips, whole or what changed
   */
  frame(): void {
    const s = this.s;
    const sh = this.shown;
    this.arrivals();
    if (s.redraw) return this.drawAll();

    if (s.directionOut && this.w.roll(0x78) === 1) s.jam = this.w.roll(6) + 2;
    if (s.videoOut && this.w.roll(0x28) === 1) s.snow ^= 1;
    if (!s.distanceOut && s.beaconOn) s.distance = this.x417935();
    if (!s.directionOut && s.beaconOn) s.needle = this.x417969();
    if (!s.radarOut) {
      if (!s.radarPhase || this.w.moveFrame >= 0) s.radarFrame++;
      if (++s.radarPhase >= 3) s.radarPhase = 0;
    }
    if (s.jam) s.jam--;

    if (s.videoOut !== sh.videoOut) {
      sh.videoOut = s.videoOut;
      if (s.videoOut) {
        this.clip = R_BOX;
        this.stamp(PIC.left, LEFT);
        this.copy(LEFT, R_BOX);
      }
    }
    if (s.snow !== sh.snow) {
      sh.snow = s.snow;
      this.clip = this.rect[PIC.snow];
      this.stamp(s.snow ? PIC.snow : PIC.left, LEFT);
      this.copy(LEFT, this.rect[PIC.snow]);
    }
    if (!s.videoOut) {
      // 0x413c6d(1): the comms box's tick in flight (its flight branch is comms.ts's to port)
      this.comms?.tick();
      this.clip = WHOLE;
    }
    if (s.nav !== sh.nav) {
      sh.nav = s.nav;
      this.button(0, s.nav);
      this.modes("nav");
    }
    if (s.hover !== sh.hover) {
      sh.hover = s.hover;
      this.button(1, s.hover);
      this.modes("hover");
    }
    if (s.arms !== sh.arms) {
      sh.arms = s.arms;
      this.button(2, s.arms);
      this.clip = this.weaponsAll;
      this.weaponStrip();
      this.copy(WEAPONS, this.weaponsAll);
    }
    if (s.menu !== sh.menu) {
      sh.menu = s.menu;
      this.clip = this.menuAll;
      this.stamp(PIC.left, LEFT);
      if (s.menu > -1) this.stamp(PIC.menu + s.menu, LEFT);
      this.copy(LEFT, this.menuAll);
    }
    if (s.mode !== sh.mode) {
      sh.mode = s.mode;
      this.clip = this.modeAll;
      this.stamp(PIC.left, LEFT);
      if (s.mode > -1) this.stamp(PIC.mode + s.mode, LEFT);
      this.copy(LEFT, this.modeAll);
    }
    if (s.weapon !== sh.weapon) {
      sh.weapon = s.weapon;
      this.clip = this.weaponsAll;
      this.stamp(PIC.weapons, WEAPONS);
      this.x417380();
      if (this.ammo(this.weapon()) > 0) this.stamp(PIC.weapon + s.weapon, WEAPONS);
      this.copy(WEAPONS, this.weaponsAll);
    }
    if (s.radarOut !== sh.radarOut) {
      sh.radarOut = s.radarOut;
      if (s.radarOut) {
        this.clip = R_RADAR;
        this.stamp(PIC.right, RIGHT);
      } else this.paint(RIGHT, R_RADAR, PAPER);
      this.copy(RIGHT, R_RADAR);
    }
    if (s.directionOut !== sh.directionOut || s.distanceOut !== sh.distanceOut || s.beaconOn !== sh.beaconOn) {
      sh.directionOut = s.directionOut;
      sh.distanceOut = s.distanceOut;
      sh.beaconOn = s.beaconOn;
      this.clip = this.rect[PIC.compass];
      this.stamp(PIC.right, RIGHT);
      this.direction();
      this.copy(RIGHT, this.rect[PIC.compass]);
    }
    if (s.jam !== sh.jam) {
      sh.jam = s.jam;
      this.clip = this.rect[PIC.jam];
      if (s.jam) {
        this.stamp(PIC.jam + this.x417aa3(), RIGHT);
        this.w.sound(2);
      } else this.stamp(PIC.right, RIGHT);
      if (s.beaconOn) this.stamp(PIC.mark + s.beaconKind, RIGHT);
      this.x41727e();
      this.copy(RIGHT, this.rect[PIC.jam]);
    }
    if (s.needle !== sh.needle) {
      sh.needle = s.needle;
      this.clip = this.rect[PIC.compass];
      this.stamp(PIC.compass, RIGHT);
      this.stamp(PIC.needle + s.needle, RIGHT);
      if (s.beaconOn) this.stamp(PIC.mark + s.beaconKind, RIGHT);
      this.x41727e();
      this.copy(RIGHT, this.rect[PIC.compass]);
    }
    if (s.distance !== sh.distance) {
      this.x41727e();
      this.copy(RIGHT, R_DIST);
    }
    if (s.radarFrame !== sh.radarFrame) {
      sh.radarFrame = s.radarFrame;
      this.x41771f();
      this.whole(RADAR);
    }
    const bar = (key: "ammo" | "shields" | "fuel" | "pods", value: number, r: Rect): void => {
      if (value === sh[key]) return;
      sh[key] = value;
      this.x418538(r, value);
      this.copy(RIGHT, r);
    };
    bar("ammo", this.ammo(this.weapon()), R_AMMO);
    bar("shields", this.shields(), R_SHLD);
    bar("fuel", this.fuel(), R_FUEL);
    bar("pods", this.pods(), R_PODS);
    if (this.score() !== sh.score) {
      sh.score = this.score();
      this.x4171df();
      this.copy(RIGHT, R_CASH);
    }
    if (this.lives() !== sh.lives) {
      sh.lives = this.lives();
      // the clip is whatever the last part left it (0x417181)
      this.stamp(PIC.status, STATUS);
      if (this.w.r.lives > 0) this.stamp(PIC.lives + this.w.r.lives, STATUS);
      this.whole(STATUS);
    }
  }

  /** 0x416047 …: every strip whole */
  private drawAll(): void {
    const s = this.s;
    const r = this.w.r;
    s.redraw = 0;
    this.sync();
    this.clip = WHOLE;
    this.stamp(PIC.left, LEFT);
    if (s.videoOut) {
      if (s.snow) this.stamp(PIC.snow, LEFT);
    }
    if (s.nav) {
      this.stamp(PIC.copilot, LEFT);
      this.stampAt(PIC.cover, LEFT, this.rect[PIC.mode + FLY]);
      s.mode = HOVER;
    }
    if (s.hover) {
      this.stamp(PIC.copilot + 1, LEFT);
      this.stampAt(PIC.cover, LEFT, this.rect[PIC.mode + HOVER]);
      s.mode = FLY;
    }
    if (s.nav && s.hover) s.mode = -1;
    if (s.arms) this.stamp(PIC.copilot + 2, LEFT);
    if (s.menu > -1) this.stamp(PIC.menu + s.menu, LEFT);
    if (s.mode > -1) this.stamp(PIC.mode + s.mode, LEFT);
    this.whole(LEFT);
    // 0x413b7e: the head drawn over the panel (comms.ts draws it in the window)
    if (!s.videoOut) this.comms?.redraw();

    this.stamp(PIC.right, RIGHT);
    this.compass();
    this.x41727e();
    if (!s.radarOut) this.paint(RIGHT, R_RADAR, PAPER);
    this.x418538(R_AMMO, this.ammo(this.weapon()));
    this.x418538(R_FUEL, this.fuel());
    this.x418538(R_SHLD, this.shields());
    this.x418538(R_PODS, this.pods());
    this.x4171df();
    this.whole(RIGHT);

    this.weaponStrip();
    this.whole(WEAPONS);

    this.stamp(PIC.status, STATUS);
    if (r.lives > 0) this.stamp(PIC.lives + r.lives, STATUS);
    this.whole(STATUS);
  }

  /** a COPILOT button lit or not, and copied (0x416664, 0x4167f7, 0x41698a) */
  private button(k: number, on: number): void {
    const at = this.rect[PIC.copilot + k];
    this.clip = at;
    this.stamp(on ? PIC.copilot + k : PIC.left, LEFT);
    this.copy(LEFT, at);
  }

  /**
   * SYSTEM redrawn after a copilot button (0x4166c6 NAVIGATION, 0x416859
   * HOVER CONTROL): a cover over each mode a copilot has, and the mode left —
   * the button's own copilot off gives FLY after NAVIGATION, HOVER after
   * HOVER CONTROL
   */
  private modes(after: "nav" | "hover"): void {
    const s = this.s;
    this.clip = this.modeAll;
    this.stamp(PIC.left, LEFT);
    if (s.nav) {
      this.stampAt(PIC.cover, LEFT, this.rect[PIC.mode + FLY]);
      s.mode = HOVER;
    } else if (after === "nav") s.mode = FLY;
    if (s.hover) {
      this.stampAt(PIC.cover, LEFT, this.rect[PIC.mode + HOVER]);
      s.mode = FLY;
    } else if (after === "hover") s.mode = HOVER;
    if (s.nav && s.hover) s.mode = -1;
    if (s.mode > -1) this.stamp(PIC.mode + s.mode, LEFT);
    this.copy(LEFT, this.modeAll);
    this.shown.mode = s.mode;
  }

  /** the weapons strip's own picture and the weapons on it (0x4163ab, 0x4169fc) */
  private weaponStrip(): void {
    const s = this.s;
    this.stamp(PIC.weapons, WEAPONS);
    if (s.arms) {
      this.x4174d0();
      s.weapon = -1;
      this.shown.weapon = -1;
    } else {
      this.x417380();
      if (this.ammo(this.weapon()) > 0) this.stamp(PIC.weapon + s.weapon, WEAPONS);
    }
  }

  /** DIRECTION, the whole redraw's (0x416246 …) */
  private compass(): void {
    const s = this.s;
    if (s.directionOut) {
      if (s.jam) this.stamp(PIC.jam + this.x417aa3(), RIGHT);
    } else {
      this.stamp(PIC.compass, RIGHT);
      if (s.beaconOn) this.stamp(PIC.needle + s.needle, RIGHT);
    }
    if (s.beaconOn) this.stamp(PIC.mark + s.beaconKind, RIGHT);
  }

  /** DIRECTION after the direction, the distance or the beacon changed (0x416cdb): as the whole redraw's */
  private direction(): void {
    this.compass();
    this.x41727e();
  }

  /** 0x4171df: CASH, the score on paper */
  private x4171df(): void {
    this.paint(RIGHT, R_CASH, PAPER);
    this.text(RIGHT, R_CASH[1] + 3, R_CASH[0] + 0xe, String(this.score()), INK);
  }

  /** 0x41727e: DIST, four digits, when the beacon is up and the distance works */
  private x41727e(): void {
    const s = this.s;
    this.shown.distance = s.distance;
    this.paint(RIGHT, R_DIST, PAPER);
    if (s.distanceOut || !s.beaconOn) return;
    this.text(RIGHT, R_DIST[1] + 2, R_DIST[0] + 0xe, String(s.distance).padStart(4, "0"), INK);
  }

  /** 0x417380: a cover over every weapon with no ammunition */
  private x417380(): void {
    for (let k = 0; k < 6; k++) if (this.w.r.ammo[k] <= 0) this.stampAt(PIC.cover, WEAPONS, this.rect[PIC.weapon + k]);
  }

  /** 0x4174d0: a cover over every weapon — the copilot has them */
  private x4174d0(): void {
    for (let k = 0; k < 6; k++) this.stampAt(PIC.cover, WEAPONS, this.rect[PIC.weapon + k]);
  }

  /**
   * 0x418538: a bar, `value` of {@link AMMO_FULL} across its 0x4e pixels (to
   * a multiple of 4) in the pattern — ink 0x28 at a quarter or less — and the
   * rest paper
   */
  private x418538(r: Rect, value: number): void {
    const across = Math.trunc((value * 0x4e) / AMMO_FULL) & 0xfffc;
    this.paint(RIGHT, [r[0], r[1], r[2], r[1] + across], value <= 0x10e0 ? LOW : INK, PAPER);
    this.paint(RIGHT, [r[0], r[1] + across, r[2], r[3]], PAPER);
  }

  /** 0x417aa3: one of DIRECTION's three statics, never the last twice */
  private x417aa3(): number {
    let k = this.w.roll(3) - 1;
    if (k === this.s.lastJam && ++k >= 3) k = 0;
    this.s.lastJam = k;
    return k;
  }

  /** 0x417935: DIST, the cells to the beacon, at most 9999 */
  private x417935(): number {
    const b = this.s.beacon;
    return Math.min(dist(b.cellY - this.w.cam.cellY, b.cellX - this.w.cam.cellX, 0), 0x270f);
  }

  /** 0x417969: the needle turned a sixteenth toward the beacon, and where that is from ahead */
  private x417969(): number {
    const ahead = (((this.w.cam.angle + 0x40) & 0xff) + 8) >> 4;
    this.s.bearing = turnToward(this.s.bearing, this.x4179a2(), 1, 0x10);
    return (this.s.bearing - ahead) & 0xf;
  }

  /**
   * 0x4179a2: which of sixteen ways the beacon's cell is, 0 north, 4 east —
   * by the cells' signs and which is farther, not by angle; on the beacon's
   * own cell the needle spins
   */
  private x4179a2(): number {
    const dy = this.s.beacon.cellY - this.w.cam.cellY;
    const dx = this.s.beacon.cellX - this.w.cam.cellX;
    if (dx === 0) {
      if (dy === 0) return this.s.bearing + 1 < 0x10 ? this.s.bearing + 1 : 0;
      return dy < 0 ? 0 : 8;
    }
    if (dy === 0) return dx < 0 ? 0xc : 4;
    if (abs(dx) === abs(dy)) return dx > 0 ? (dy > 0 ? 6 : 2) : dy > 0 ? 0xa : 0xe;
    if (abs(dx) > abs(dy)) return dx > 0 ? (dy > 0 ? 5 : 3) : dy > 0 ? 0xb : 0xd;
    return dy > 0 ? (dx > 0 ? 7 : 9) : dx > 0 ? 1 : 0xf;
  }

  /** 0x41771f: the radar — every target's mark round the craft, ahead up, 0x24 to a pixel */
  private x41771f(): void {
    const bits = this.bits;
    bits.fill(0, 0, 0x5c * 0x5c); // 0x41885f
    const within: Rect = [2, 2, 0x5a, 0x5a];
    const n = this.w.targetCount();
    for (let k = 0; k < n; k++) {
      const t = this.w.target(k);
      const pt = this.x4185f7(t.obj);
      if (!inside(pt.y, pt.x, within)) continue;
      const hot = t.flag ? HOT : LOW;
      const mark = (shape: number[][], ink: number): void => {
        if (!this.w.m.draws) return;
        for (const [dv, dh] of shape) bits[(pt.y + dv) * 0x5c + pt.x + dh] = ink;
      };
      switch (t.kind) {
        case 0: mark(PLUS, hot); break;
        case 1: mark(RING, OURS); break;
        case 2: mark(DIAMOND, OURS); break;
        case 3: mark(TRIANGLE, HOT); break;
        case 4: mark(RING, hot); break;
        case 5: mark(DIAMOND, hot); break;
        case 6: mark(BRACKETS, hot); break;
        case 7: mark(SQUARE, LOW); break;
        case 8: mark(DOT, HOT); break;
      }
    }
  }

  /** 0x4185f7: where a thing is on the radar, the craft at (0x2e, 0x2e) */
  private x4185f7(o: Obj): { y: number; x: number } {
    const w = this.w;
    const dx = o.x - w.cam.x;
    const dy = o.y - w.cam.y;
    const ahead = Math.trunc((w.cos * dx + w.sin * dy) / 0x4000);
    const across = Math.trunc((w.cos * dy - w.sin * dx) / 0x4000);
    return { y: 0x2e - Math.trunc(ahead / 0x24), x: 0x2e + Math.trunc(across / 0x24) };
  }

  // ---- the beacon -------------------------------------------------------------

  /** the craft is down at the beacon: 0x5a up at most, at rest, within 0x14 of its centre (0x4180be) */
  private landed(): boolean {
    const c = this.w.cam;
    const b = this.s.beacon;
    return c.z <= 0x5a && this.w.speed === 0 && abs(c.x - b.x) <= 0x14 && abs(c.y - b.y) <= 0x14;
  }

  /** 0x418097: the frame's arrivals — at the pods, at the repair bay — and the call-ins */
  private arrivals(): void {
    const s = this.s;
    const w = this.w;
    const b = s.beacon;
    if (s.beaconKind === MARK_PODS) {
      if (w.state === 2 && w.boss.up() <= 0 && this.landed()) w.state++;
      return;
    }
    if (s.beaconKind === MARK_BAY) {
      if (!s.bayGreeted && abs(w.cam.cellX - b.cellX) <= 2 && abs(w.cam.cellY - b.cellY) <= 2) {
        this.say(REPAIR, w.pyro.x41d396(b) ? 5 : 8);
        s.bayGreeted = 1;
      }
      if (s.bayWait && --s.bayWait <= 0) {
        this.say(REPAIR, 7);
        this.x417d33();
        return;
      }
      if (!this.landed()) return;
      this.bay = true; // 0x41f990
      this.x417d33();
      return;
    }
    if (s.beaconKind > -1) return;
    if (--s.callIn > 0) return;
    s.callIn = w.roll(0x3c) + 0xa0;
    let n = 0;
    const fuel = this.fuel() < 0x1b00 && s.lastKind !== MARK_FUEL;
    if (fuel) n = 1;
    const empty = this.w.r.ammo.filter((a) => a <= 0).length;
    const ammo = empty >= 3 && s.lastKind !== MARK_AMMO;
    if (ammo) n++;
    let damage = (s.radarOut ? 1 : 0) + (s.videoOut ? 1 : 0) + (s.directionOut || s.distanceOut ? 1 : 0) + (s.enginesOut ? 1 : 0);
    if (this.shields() < 0x1680) damage += 0xa;
    const bay = damage >= 2 && s.lastKind !== MARK_BAY;
    if (bay) n++;
    if (n <= 0) return;
    let k = w.roll(n);
    const at = this.x41842c(w.params.x43cf5a);
    if (fuel && --k <= 0) {
      w.fuel.callIn();
      return this.beacon(at.x, at.y, MARK_FUEL);
    }
    if (ammo && --k <= 0) {
      w.weap.callIn();
      return this.beacon(at.x, at.y, MARK_AMMO);
    }
    if (bay && --k <= 0) {
      s.bayGreeted = 0;
      s.bayWait = 0x1f4;
      this.say(REPAIR, 4);
      return this.beacon(at.x, at.y, MARK_BAY);
    }
  }

  /** 0x41842c: a street cell at random on the ring r cells round the origin */
  private x41842c(r: number): { x: number; y: number } {
    const ring = (x: number, y: number): boolean => (abs(x) === r || abs(y) === r) && !this.w.solid(x, y);
    let n = 0;
    for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) if (ring(x, y)) n++;
    let k = this.w.roll(n);
    for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) if (ring(x, y) && --k <= 0) return { x, y };
    throw new Error("0x41842c: no street on the ring");
  }

  /** 0x417cd1: the beacon up over cell (x, y), marking `kind` */
  beacon(x: number, y: number, kind: number): void {
    const s = this.s;
    s.beaconKind = kind;
    s.lastKind = kind;
    s.beacon.cellX = x;
    s.beacon.cellY = y;
    s.beacon.x = (x << 8) + 0x80;
    s.beacon.y = (y << 8) + 0x80;
    s.beaconOn = 1;
    this.shown.beaconOn = -1;
    this.w.soundOver(0x3a);
    // 0x414b65: with the copilot navigating, the pilot says so (comms' [0x4373dc]; its flight branch is not ported)
  }

  /** 0x417d33: the beacon off */
  x417d33(): void {
    this.s.beaconKind = -1;
    this.s.beaconOn = 0;
    this.shown.beaconOn = -1;
  }

  /** 0x417d4d: what the beacon marks (−1 none) into out.n, and the beacon into obj */
  x417d4d(out: { n: number }, obj: Obj): void {
    out.n = this.s.beaconKind;
    setObj(obj, this.s.beacon);
  }

  /** 0x417d70: the pods are down — their beacon twice as far out, and the boss over it */
  x417d70(): void {
    const at = this.x41842c(this.w.params.x43cf5a << 1);
    this.beacon(at.x, at.y, MARK_PODS);
    this.w.boss.callIn(at.x, at.y);
  }

  /** 0x418511: the world moved (dx, dy) — the beacon with it */
  shift(dx: number, dy: number): void {
    const b = this.s.beacon;
    b.x += dx;
    b.y += dy;
    b.cellX += dx >> 8;
    b.cellY += dy >> 8;
  }

  // ---- the clicks -------------------------------------------------------------

  /** 0x415c7b: a click on the panels, in the window's pixels */
  click(y: number, x: number): void {
    const s = this.s;
    const rect = this.rect;
    const at = (r: Rect, g: Graf): boolean => inside(y, x, [r[0] + g.top, r[1] + g.left, r[2] + g.top, r[3] + g.left]);
    if (at([0, 0, LEFT.rows, LEFT.cols], LEFT)) {
      const toggles = ["nav", "hover", "arms"] as const;
      for (let k = 0; k < 3; k++) {
        if (!at(rect[PIC.copilot + k], LEFT)) continue;
        s[toggles[k]] ^= 1;
        if (s[toggles[k]]) this.say(PILOT, 0x1f);
        return;
      }
      for (const k of [SAVE, QUIT, SOUND, PAUSE, HELP, KEYS]) {
        if (!at(rect[PIC.menu + k], LEFT)) continue;
        s.menu = k;
        return;
      }
      if (at(rect[PIC.mode + HOVER], LEFT) && !s.hover) {
        s.mode = HOVER;
        return;
      }
      if (at(rect[PIC.mode + FLY], LEFT) && !s.nav) {
        s.mode = FLY;
        return;
      }
    }
    if (!at([0, 0, WEAPONS.rows, WEAPONS.cols], WEAPONS) || s.arms) return;
    for (let k = 0; k < 6; k++) {
      if (!at(rect[PIC.weapon + k], WEAPONS)) continue;
      if (this.w.r.ammo[k] > 0) s.weapon = k;
      return;
    }
  }

  // ---- the records and the accessors -------------------------------------------

  /** 0x415f51 (a new game, a life lost): every record zeroed but the pilot and the tally, and the HUD's with them */
  zero(): void {
    const r = this.w.r;
    r.tier.fill(0);
    r.ammo.fill(0);
    r.bars = [0, 0, 0];
    r.lives = 0;
    r.score = 0;
    // the beacon's object and the repair bay's two (0x437470, 0x437474) are not among them
    const { beacon, bayGreeted, bayWait } = this.s;
    Object.assign(this.s, newHudState(), { beacon, bayGreeted, bayWait });
    this.sync();
  }

  /** 0x4175ea: the HOVER/FLY key — the other mode, unless a copilot has either */
  toggleMode(): void {
    const s = this.s;
    if (s.hover || s.nav) return;
    s.mode = s.mode === FLY ? HOVER : FLY;
  }

  /** 0x417617: the three COPILOT buttons */
  x417617(): [number, number, number] {
    return [this.s.nav, this.s.hover, this.s.arms];
  }

  /** 0x4178c5 */
  radarOut(): boolean {
    return this.s.radarOut !== 0;
  }
  /** 0x4178cb */
  videoOut(): boolean {
    return this.s.videoOut !== 0;
  }
  /** 0x4178d1 */
  enginesHit(): boolean {
    return this.s.enginesOut !== 0;
  }
  /** 0x4178d7 */
  directionOut(): boolean {
    return this.s.directionOut !== 0;
  }
  /** 0x4178dd */
  distanceOut(): boolean {
    return this.s.distanceOut !== 0;
  }
  /** 0x4178e3 */
  mode(): number {
    return this.s.mode;
  }
  /** 0x4178e9 */
  weapon(): number {
    return this.s.weapon;
  }
  /** 0x4178ef */
  menu(): number {
    return this.s.menu;
  }
  /** 0x417ae7 */
  setMenu(k: number): void {
    this.s.menu = k;
  }
  /** 0x417acf */
  choose(k: number): void {
    this.s.weapon = k;
    if (this.s.arms) this.shown.weapon = k;
  }
  /** 0x4178f5 */
  tier(k: number): number {
    return this.w.r.tier[k];
  }
  /** 0x417cc1 */
  setTier(k: number, t: number): void {
    this.w.r.tier[k] = t;
  }
  /** 0x417901 */
  ammo(k: number): number {
    return k > -1 ? this.w.r.ammo[k] : 0;
  }

  /** the weapons strip redrawn on the next frame (0x417be9 …: `[0x43790c]` −1, or −2 when no weapon is chosen) */
  private weaponsChanged(): void {
    const s = this.s;
    this.shown.weapon = -1;
    if (s.weapon === -1) this.shown.weapon--;
    if (s.arms) this.shown.weapon = s.weapon;
  }

  /** 0x418044: kind k's ammunition by n, held within 0 and full; empty, it is no longer chosen */
  setAmmo(k: number, n: number): void {
    if (k <= -1) return;
    const r = this.w.r;
    r.ammo[k] = Math.min(AMMO_FULL, Math.max(0, r.ammo[k] + n));
    if (r.ammo[k] <= 0 && k === this.s.weapon) this.s.weapon = -1;
  }
  /** 0x417c81: kind k full */
  fill(k: number): void {
    if (k <= -1) return;
    this.w.r.ammo[k] = AMMO_FULL;
    this.weaponsChanged();
  }
  /** 0x417bd0: kind k lost to a hit (it stays chosen, empty) */
  lose(k: number): void {
    if (k <= -1) return;
    this.w.r.ammo[k] = 0;
    this.weaponsChanged();
    this.w.soundOver(0x38);
    this.say(PILOT, 0x15);
  }

  /** 0x417917 */
  shields(): number {
    return this.w.r.bars[0];
  }
  /** 0x41791d */
  fuel(): number {
    return this.w.r.bars[2];
  }
  /** 0x417923 */
  pods(): number {
    return this.w.r.bars[1];
  }
  /** 0x417929 */
  lives(): number {
    return this.w.r.lives;
  }
  /** 0x41792f */
  score(): number {
    return this.w.r.score;
  }

  /** 0x417dac */
  addShields(n: number): void {
    const r = this.w.r;
    r.bars[0] = Math.min(AMMO_FULL, Math.max(0, r.bars[0] + n));
    if (n > -0x2c || this.w.roll(r.bars[0] + 1) > 0x240) return;
    const s = this.s;
    let out = r.ammo.filter((a) => a <= 0).length;
    if (s.radarOut) out++;
    if (s.videoOut) out++;
    if (s.directionOut || s.distanceOut) out++;
    if (s.enginesOut) out++;
    if (out >= 0xa) return;
    let k = this.w.roll(0xa - out);
    for (let kind = 0; kind < 6; kind++) if (r.ammo[kind] > 0 && --k <= 0) return this.lose(kind);
    if (!s.radarOut && --k <= 0) return this.x417af1();
    if (!s.videoOut && --k <= 0) return this.x417b1c();
    if (!s.directionOut && !s.distanceOut && --k <= 0) return this.w.roll(2) === 1 ? this.x417b5e() : this.x417ba5();
    if (!s.enginesOut && --k <= 0) return this.x417b3d();
  }
  /** 0x417fa9 */
  addFuel(n: number): void {
    const r = this.w.r;
    r.bars[2] = Math.min(AMMO_FULL, Math.max(0, r.bars[2] + n));
  }
  /** 0x417fd5: PODS by n */
  x417fd5(n: number): void {
    const r = this.w.r;
    r.bars[1] = Math.min(AMMO_FULL, Math.max(0, r.bars[1] + n));
  }
  /** 0x418001: lives, 0 to 4 */
  addLives(n: number): void {
    const r = this.w.r;
    r.lives = Math.min(4, Math.max(0, r.lives + n));
  }
  /** 0x41802a */
  addScore(n: number): void {
    const r = this.w.r;
    r.score = Math.max(0, r.score + n);
  }

  /** 0x417af1: the radar knocked out — it goes blank */
  x417af1(): void {
    this.s.radarOut = 1;
    this.shown.radarFrame = this.s.radarFrame;
    this.w.soundOver(0x34);
    this.say(PILOT, 0x16);
  }
  /** 0x417b1c: the video knocked out — snow in the comms box */
  x417b1c(): void {
    this.s.videoOut = 1;
    this.w.soundOver(0x36);
    this.say(PILOT, 0x14);
  }
  /** 0x417b3d: the engines hit */
  x417b3d(): void {
    this.s.enginesOut = 1;
    this.w.soundOver(0x39);
    this.say(PILOT, 0x13);
  }
  /** 0x417b5e: the direction knocked out — static on DIRECTION */
  x417b5e(): void {
    const s = this.s;
    s.directionOut = 1;
    this.shown.jam = -1;
    this.shown.needle = s.needle;
    s.jam = this.w.roll(6) + 2;
    this.w.soundOver(0x35);
    this.say(PILOT, 0x17);
  }
  /** 0x417ba5: the distance knocked out — DIST stops */
  x417ba5(): void {
    this.s.distanceOut = 1;
    this.shown.distance = this.s.distance;
    this.w.soundOver(0x35);
    this.say(PILOT, 0x18);
  }
  /** 0x417c2c: the radar mended */
  x417c2c(): void {
    this.s.radarOut = 0;
  }
  /** 0x417c37: the video mended */
  x417c37(): void {
    this.s.videoOut = 0;
  }
  /** 0x417c42: the engines mended */
  x417c42(): void {
    this.s.enginesOut = 0;
  }
  /** 0x417c4d: the direction mended */
  x417c4d(): void {
    this.s.directionOut = 0;
    this.shown.jam = this.s.jam;
    this.shown.needle = this.s.needle;
  }
  /** 0x417c6c: the distance mended */
  x417c6c(): void {
    this.s.distanceOut = 0;
    this.shown.distance = this.s.distance;
  }
}
