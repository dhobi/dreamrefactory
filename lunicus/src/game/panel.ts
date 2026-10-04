/**
 * The panel under and beside the view (LUNICUS.EXE 0x410258, redrawn by
 * 0x410ce8): the message line, the ENERGY, AMMO, ENEMIES and SHIELDS bars, the
 * score, and the six buttons along the bottom — help, save, navigation and the
 * three weapons, each pressed or not, a weapon greyed out with no ammo
 * (0x410890) — and the radar above the score (0x411500).
 */
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import {
  BAR_AMMO, BAR_ENEMIES, BAR_ENERGY, BAR_FULL, BAR_LOW, BAR_SHIELDS, BUTTON_LEFT, BUTTON_TOP, INK, INK_WARN, MESSAGE_RECT,
  MESSAGE_TICKS, MESSAGES, SCREEN_W, VIEW_H, VIEW_W,
} from "./data";
import { playFilm } from "@dreamfactory/engine/v0/film";
import type { Co, Machine } from "./machine";
import type { Rect } from "@dreamfactory/engine/v0/screen";

/** the HUD's numbers, 0 to 10000 each but the score, and its message */
export interface Hud {
  /** `[0x42b440]` BIO — at 0 the player is dead */
  energy: number;
  /** `[0x42b438]` */
  shields: number;
  /** `[0x42b448]` what is left of a city day's enemies */
  enemies: number;
  /** `[0x42b458]` bullets, `[0x42b450]` grenades, `[0x42b454]` rockets */
  bullets: number;
  grenades: number;
  rockets: number;
  /** `[0x42b3d4]` the button down: 2 navigate, 3 bullets, 4 grenades, 5 rockets */
  mode: number;
  /** `[0x42b3c0]` */
  score: number;
  message: number;
  messageUntil: number;
}

export const newHud = (): Hud => ({ energy: 0, shields: 0, enemies: 0, bullets: 0, grenades: 0, rockets: 0, mode: 2, score: 0, message: -1, messageUntil: 0 });

const SCORE_RECT: Rect = [0xf0, 0x18f, 0xfe, 0x1f1];
/** `[0x42b430]`: the side panel's picture, 0x5a down (0x4102b3) */
const SIDE_PICTURE_TOP = 0x5a;

/** `[0x42b46c]`: the radar's square on the screen, in the side panel */
const RADAR: Rect = [0x17, 0x1a0, 0x57, 0x1e0];
const RADAR_SIZE = 0x40;
/** the player's place on it: `(0x37, 0x40)` of the side panel (0x4115d3) */
const RADAR_CENTRE: [number, number] = [0x37 - RADAR[0], 0x40 - (RADAR[1] - 0x180)];

/** what the radar is told each time it looks: the view's camera, and what it shows */
export interface RadarView {
  cam: { x: number; y: number; cos: number; sin: number };
  /** a vehicle, the wasp or a crew member is a ring; a drone a dot (0x4076ef's flag) */
  blips: { x: number; y: number; dot: boolean }[];
  /** `[0x42b468]` the node is out: the ENEMIES bar blinks (0x410fba) */
  nodeOut: boolean;
}

export class Panel {
  constructor(
    readonly m: Machine,
    readonly hud: Hud,
    /** `shared/panel.`: 0 the bottom, 16 the side, 1 … 15 the buttons' states */
    readonly frames: FrameV0[],
    /** the day, for the pulse gun's button (day 4 on) */
    readonly day: () => number,
  ) {}

  /**
   * `[0x42b3ec]`, 0x410c99: the side panel's picture below the radar (`panel.`
   * 17 … 20, drawn in `[0x42b430]`: rows 0x5a … 0xe0) — 0x11 the city, 0x12
   * indoors, 0x13 the base's upper floor and 0x14 its lower, those two a map
   * with the crew and the player on it (0x40db1e)
   */
  side: { picture: number; marks?: () => { cellX: number; cellY: number; ink: number }[]; key?: () => string } | null = null;
  /** the map's marks as they were when the player last moved (0x410eb4: redrawn only then) */
  private marks: { y: number; x: number; ink: number }[] = [];
  private marksKey = "";

  /** the save button's dialog and write (the game's: it knows what a save holds) */
  save: (() => Co) | null = null;

  /** the level's radar, set as each level opens (0x410c99 names which one) */
  radar: (() => RadarView | null) | null = null;
  /** `[0x42b3dc]` redraws: the radar and the blink go every other one */
  private redraws = 0;
  private readonly radarPixels = new Uint8Array(RADAR_SIZE * RADAR_SIZE).fill(0x80);
  private blink = false;

  draw(): void {
    const s = this.m.screen;
    if (!this.m.draws || this.frames.length < 17) return;
    s.spriteAt(this.frames[0], VIEW_H, 0);
    s.spriteAt(this.frames[16], 0, VIEW_W);
    for (let i = 0; i < 6; i++) s.spriteAt(this.frames[this.button(i)], BUTTON_TOP, BUTTON_LEFT[i]);
    this.sidePicture();
    const view = this.radar?.() ?? null;
    if (++this.redraws & 1) this.look(view);
    s.put(this.radarPixels, RADAR_SIZE, RADAR_SIZE, RADAR[0], RADAR[1]);
    this.bar(BAR_ENERGY, this.hud.energy);
    this.bar(BAR_SHIELDS, this.hud.shields);
    if (view?.nodeOut) {
      // 0x410fba: the bar blinks blue two redraws in four, else it is black
      if (this.redraws & 1) this.blink = (this.redraws & 2) !== 0;
      this.fillRect(BAR_ENEMIES, this.blink ? 0x71 : 0xff);
    } else this.bar(BAR_ENEMIES, this.hud.enemies);
    this.bar(BAR_AMMO, this.ammo());
    if (this.m.font) s.text(this.m.font, SCORE_RECT[1] + 6, SCORE_RECT[2] - 3, String(this.hud.score), INK, SCORE_RECT);
    this.message();
  }

  /** 0x410c99 and 0x410ea1: the side panel's picture, and on the base the map's marks */
  private sidePicture(): void {
    const side = this.side;
    if (!side || !this.frames[side.picture]) return;
    const s = this.m.screen;
    s.spriteAt(this.frames[side.picture], SIDE_PICTURE_TOP, VIEW_W);
    if (!side.marks) return;
    const key = side.key?.() ?? "";
    if (key !== this.marksKey) {
      this.marksKey = key;
      // 0x40dbe7: a cell five pixels square from (0x13, 0x67), the lower floor's twelve higher
      const up = side.picture === 0x14 ? 12 : 0;
      this.marks = side.marks().filter((k) => k.cellX >= 0 && k.cellY >= 0).map((k) => ({ y: k.cellY * 5 + 0x67 - up, x: k.cellX * 5 + 0x13, ink: k.ink }));
    }
    // 0x4116d0: two by two, the pixel and the one to its left
    for (const k of this.marks)
      for (const [dy, dx] of [[0, -1], [0, 0], [1, -1], [1, 0]]) s.pixels[(k.y + dy) * SCREEN_W + VIEW_W + k.x + dx] = k.ink;
    s.version++;
  }

  private fillRect(r: Rect, ink: number): void {
    const s = this.m.screen;
    for (let y = r[0]; y < r[2]; y++) s.pixels.fill(ink, y * SCREEN_W + r[1], y * SCREEN_W + r[3]);
    s.version++;
  }

  /**
   * 0x411500: the radar painted black, a green ring for each vehicle, the
   * wasp or crew member and a green dot for each drone, at 1/0x3c of their
   * distance, turned with the view (0x4116ff) and kept a pixel inside the
   * square; the player a red ring in the middle.
   */
  private look(view: RadarView | null): void {
    const px = this.radarPixels;
    px.fill(0xff);
    const put = (y: number, x: number, ink: number): void => {
      if (y >= 0 && y < RADAR_SIZE && x >= 0 && x < RADAR_SIZE) px[y * RADAR_SIZE + x] = ink;
    };
    const ring = (y: number, x: number, ink: number): void => {
      for (const [dy, dx] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) put(y + dy, x + dx, ink);
    };
    const [cy, cx] = RADAR_CENTRE;
    for (const b of view?.blips ?? []) {
      const { cam } = view!;
      const dx = b.x - cam.x;
      const dy = b.y - cam.y;
      const ahead = Math.trunc(Math.trunc((dx * cam.cos + dy * cam.sin) / 0x4000) / 0x3c);
      const across = Math.trunc(Math.trunc((dy * cam.cos - dx * cam.sin) / 0x4000) / 0x3c);
      const y = cy - ahead;
      const x = cx + across;
      // 0x41cf45, 0x41ce1d: inside the square less its edge
      if (y < 1 || y >= RADAR_SIZE - 1 || x < 1 || x >= RADAR_SIZE - 1) continue;
      if (b.dot) put(y, x, INK);
      else ring(y, x, INK);
    }
    ring(cy, cx, INK_WARN);
  }

  /** the pressed weapon's ammo (0x410aa4) */
  ammo(): number {
    const h = this.hud;
    if (h.mode === 3) return h.bullets;
    if (h.mode === 4) return h.grenades;
    return h.mode === 5 ? h.rockets : 0;
  }

  /** 0x410671: the button a press on the panel is on, or −1 */
  static buttonAt(y: number, x: number): number {
    if (y < BUTTON_TOP) return -1;
    return BUTTON_LEFT.findIndex((l) => x >= l && x < l + 64);
  }

  /**
   * 0x4175c3, the help button's half: the effects and the ambience
   * silenced, a fade, `help.move`, and the level's view again in navigation.
   * (The save button's half is the save dialog.)
   */
  *help(day: number, again: () => void, clut: Uint8ClampedArray): Co {
    const m = this.m;
    this.draw();
    m.stopSound();
    m.stopAmbience();
    yield* m.fadeOut();
    yield* playFilm(m, "help.move", day);
    m.clear();
    this.hud.mode = 2;
    m.screen.setPalette(clut.map(() => 0));
    again();
    this.draw();
    yield* m.fadeIn(clut);
    m.playAmbience();
  }

  /** 0x410890 */
  button(i: number): number {
    const h = this.hud;
    if (i < 3) return h.mode === i ? i + 1 : i + 8;
    if (i === 3) {
      if (h.bullets <= 0) return 15;
      if (this.day() >= 4) return h.mode === 3 ? 7 : 14;
      return h.mode === 3 ? 4 : 11;
    }
    if (i === 4) {
      if (h.grenades <= 0) return 15;
      return h.mode === 4 ? 5 : 12;
    }
    if (h.rockets <= 0) return 15;
    return h.mode === 5 ? 6 : 13;
  }

  /** 0x4115f1: a bar, 177 px at full, in whole fours, dotted 0x77 */
  private bar(r: Rect, value: number): void {
    const s = this.m.screen;
    const w = Math.trunc((value * 0xb1) / BAR_FULL) & 0xfffc;
    const ink = value <= BAR_LOW ? INK_WARN : INK;
    for (let y = r[0]; y < r[2]; y++)
      for (let x = r[1]; x < r[1] + w && x < r[3]; x++) if (0x77 & (0x80 >> (x & 7))) s.pixels[y * SCREEN_W + x] = ink;
    s.version++;
  }

  private message(): void {
    const s = this.m.screen;
    const r = MESSAGE_RECT;
    if (this.frames[0]) s.spriteAt(this.frames[0], VIEW_H, 0, r);
    if (this.hud.message >= 0 && this.m.font) {
      const warn = this.hud.message >= 1 && this.hud.message <= 12;
      s.text(this.m.font, r[1] + 6, r[2] - 3, MESSAGES[this.hud.message] ?? "", warn ? INK_WARN : INK, r);
    }
  }

  /** 0x4106cf: a message on the HUD's line for 0x168 ticks */
  say(n: number): void {
    this.hud.message = n;
    this.hud.messageUntil = this.m.ticks + MESSAGE_TICKS;
    this.m.log(`HUD: ${MESSAGES[n]}`);
    if (this.m.draws) this.message();
  }

  /** once a frame: the message runs out */
  tick(): void {
    if (this.hud.message >= 0 && this.m.ticks > this.hud.messageUntil) {
      this.hud.message = -1;
      if (this.m.draws) this.message();
    }
  }
}
