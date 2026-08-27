/**
 * Skull Cracker's interface panel — every pixel and every coordinate the disc's.
 *
 * `SC.EXE` runs the game in one of two modes, and its own help screen says so:
 * *"Press Ctrl-P to toggle between interface and full-screen mode"*. In
 * interface mode the level plays inside a 512x232 window and two bands of
 * artwork surround it; in full-screen mode the level has all 512x384 and the
 * bands are gone. This module is the first mode.
 *
 * ## The two bands
 *
 * They are two cels in `PLAYER.SBK`, both 512 wide — which is the screen — and
 * both anchored dead centre:
 *
 *   | cel     | size    | anchor  | drawn at        | lands at |
 *   |---------|---------|---------|-----------------|----------|
 *   | `12000` | 512x43  | 256, 21 | (256, 21)       | y0…y43   |
 *   | `12001` | 512x112 | 256, 56 | (256, 54) + 274 | y272…384 |
 *
 * The lower band's `54` is in its own surface's coordinates — `0x40dc10` writes
 * it straight into the plot record, past the conversion — so on screen it is
 * 54 + 274 = 328, and 328 - 56 puts the band's top row at y272.
 *
 * The engine draws them from `0x40dad0` and `0x40dc10`, the two functions that
 * open a HUD region for painting: each blits its band clipped to the region's
 * rect, which is how a changed statistic erases its own old pixels. And
 * `0x40dc10` gives away the geometry: it offsets the rect by **-274** (`mov eax,
 * 0xfffffeee`), and `0x40dcd0`, the plotter every lower-band statistic goes
 * through, subtracts the same 0x112 from the y it is handed. So the lower band's
 * own surface begins at screen y274, which is exactly where the pause films sit
 * — `PAUSEA.MOV` is 512x232 at origin (0, 42) — and the window between the bands
 * is (0, 42) to (512, 274).
 *
 * ## What is live, and where
 *
 * Ten regions, each with a dirty flag and a clip rect in `.data`. The rects are
 * the table at `0x46bd88`, stored `{y0, x0, y1, x1}` like every rect in this
 * engine, and the painter is `0x40d500`, which runs them in this order:
 *
 *   | region        | rect                   | flag       | how it is drawn |
 *   |---------------|------------------------|------------|-----------------|
 *   | lives         | 274,350 – 291,450      | `0x46bd00` | cels `11423+i`, i < lives, at the five points in `0x46bd78` |
 *   | score         | 23,220 – 34,290        | `0x46bd08` | the engine's own text, at (236, 34), colour `0xe1` |
 *   | weapon + ammo | 290,305 – 380,450      | `0x46bd0c` | plate `11450`, the weapon's icon, then four gauge rows |
 *   | enemy health  | 4,300 – 24,512         | `0x46bd18` | fill `11501` slid, cap `11504` |
 *   | enemy name    | 29,362 – 42,472        | `0x46bd1c` | the enemy's own name cel, at (457, 35) |
 *   | player health | 4,0 – 24,200           | `0x46bd10` | fill `11500` slid, cap `11503` |
 *   | player name   | 29,39 – 42,148         | `0x46bd14` | `13400` SKULLCRACKER or `13401` BONEBREAKER, at (53, 35) |
 *   | mission clock | 286,452 – 325,512      | `0x46bd20` | one of `12700…12717`, at (473, 305) |
 *   | kill quota    | 326,452 – 384,512      | `0x46bd24` | two digits at (467, 346) and (479, 346) |
 *   | the buttons   | (each cel's own rect)  | —          | eight lights, cels `11404…11419` |
 *
 * ### The health bars slide; they are not stretched
 *
 * There is no scaling anywhere in this engine, and the bars are the proof. Cel
 * `11500` is a 197x12 slab of red anchored 4 from its left edge, and `0x40d8ea`
 * draws it at
 *
 *     x = 15 + 196 * (health - max) / max,   y = 14
 *
 * so at full health it sits at x15 and as health falls it walks LEFT, out from
 * under the region's own clip rect. The green enemy slab `11501` is 194x12
 * anchored **191** from its left edge — near its right — and `0x40d7ca` draws it
 * at `500 + 196 * (max - health) / max`, walking right. Two identical tricks
 * mirrored, and the fill drains from the inside end of each bar. The 196 is a
 * literal in both.
 *
 * ### The enemy bar shows whoever is nearest
 *
 * `0x40d1c0(health, max, nameCel, position)` is what an enemy calls to claim the
 * right-hand bar, and it is a competition: the caller's Manhattan distance from
 * the player (`[0x4ac3d4]`, +6 and +8) has to beat both the best distance so far
 * (`[0x46bd28]`) and 1024. The painter resets that best to `0x7fff` after every
 * pass, so the bar belongs to the closest thing within 1024px this frame and to
 * the last one seen when nothing is in range.
 *
 * Each class passes its own two numbers, and this port carries the ones for the
 * three it animates — `NALLY` with 25, `LINK` with 200, `PUKE BOY` with 400,
 * from `0x439270`, `0x44f408` and `0x417f10`.
 *
 * ### The mission clock is seventeen cels and a countdown
 *
 * `0x40d250`, once an engine frame: `32000` means no limit and shows the empty
 * dial `12717`; otherwise the remaining count decides the cel by
 *
 *     state = 16 - ticks / 450,  cel = 12700 + state
 *
 * so seventeen 450-frame steps — 30 seconds each at 15fps, eight minutes in all.
 * Past step 12 (under two minutes) it alternates the dial with the empty one
 * every frame, which is the flash, and beeps every `100 - 6*state` frames.
 *
 * ### The four gauge rows are the WEAPON's ammunition, not health
 *
 * `0x40d691` reads them out of the weapon record at `0x4a7f10 + index*12`: `+4`
 * is the magazine, `+6` what is left in it. The value is scaled to 0…64 and laid
 * out as four rows of sixteen at x417 stepping 7 down from y333 — cel `14300` for
 * a full row, `14316 - remainder` for a partial one — and the whole block clips
 * to the special-weapon window at 290,305–380,450. An earlier reading of this
 * file had it as the player's health; the health is the sliding slab above.
 *
 * ### The buttons light up
 *
 * `0x40da41` walks the eight bits of `[0x4a3b48]` against the eight it drew last
 * time and redraws the ones that changed: `11404+i` while the button is down,
 * `11412+i` when it is up. The points are the table at `0x46bd38`, `{y, x}` each,
 * and the cels say what the bits are — `11404…11407` are the four pad arrows and
 * `11408…11411` read PUNCH, KICK, INV., JUMP in yellow, over the green ones the
 * band already carries. So the order is up, right, down, left, punch, kick, inv,
 * jump, and the pad in the corner is a live indicator rather than decoration.
 */
import type { ShpFrame } from "@dreamfactory/engine/df/shp";

/** where the lower band's own surface begins — `0x40dc10`'s `0xfffffeee` */
export const PANEL_Y = 274;

/** the window the level plays in with the interface up — `PAUSEA.MOV`'s own */
export const WINDOW = { x: 0, y: 42, w: 512, h: 232 } as const;

/** `{y0, x0, y1, x1}`, the way this engine stores a rect */
type Rect = readonly [number, number, number, number];

/** the clip rects, from the table at `0x46bd88` (the score's is built inline) */
const RECT = {
  lives: [274, 350, 291, 450],
  score: [23, 220, 34, 290],
  weapon: [290, 305, 380, 450],
  enemyBar: [4, 300, 24, 512],
  enemyName: [29, 362, 42, 472],
  playerBar: [4, 0, 24, 200],
  playerName: [29, 39, 42, 148],
  dial: [286, 452, 325, 512],
  quota: [326, 452, 384, 512],
} as const satisfies Record<string, Rect>;

/** every cel id this panel draws */
export const CEL = {
  /** the upper band, 512x43 at y0 */
  upper: 12000,
  /** the lower band, 512x112 at y272 */
  lower: 12001,
  /** the sliding fills and their end caps */
  playerFill: 11500,
  playerCap: 11503,
  enemyFill: 11501,
  enemyCap: 11504,
  /** the five life lights, one cel each */
  life: 11423,
  /** the plate behind the special weapon, redrawn before its contents */
  weaponPlate: 11450,
  /** the ammunition gauge: a full row, and `partial - remainder` for the rest */
  gaugeFull: 14300,
  gaugePartial: 14316,
  /** `digit + n` — 8x12 green numerals, the panel's only typeface */
  digit: 14200,
  /** the mission dial: `dial + state` for state 0…16, and `dialOff` empty */
  dial: 12700,
  dialOff: 12717,
  /** the eight button lights: `down + i` while held, `up + i` when not */
  buttonDown: 11404,
  buttonUp: 11412,
  /** the two playable characters' name plates */
  skullcracker: 13400,
  bonebreaker: 13401,
} as const;

/** where each statistic is plotted — `SC.EXE`'s own arguments, screen y */
const AT = {
  playerFill: { x: 15, y: 14, span: 196 },
  playerCap: { x: 13, y: 14 },
  enemyFill: { x: 500, y: 14, span: 196 },
  enemyCap: { x: 499, y: 14 },
  playerName: { x: 53, y: 35 },
  enemyName: { x: 457, y: 35 },
  /** the score's glyphs start here — measured off the help film, which bakes a
   *  score of 1100 into its own picture at x238 */
  score: { left: 238, top: 23 },
  quota: { tens: 467, units: 479, y: 346 },
  dial: { x: 473, y: 305 },
  weaponPlate: { x: 409, y: 351 },
  weaponIcon: { x: 365, y: 340 },
  gauge: { x: 417, y: 333, step: 7, rows: 4 },
} as const;

/** the five life lights, from the table at `0x46bd78` */
const LIVES = [
  { y: 281, x: 360 },
  { y: 281, x: 380 },
  { y: 281, x: 400 },
  { y: 281, x: 420 },
  { y: 281, x: 440 },
] as const;

/** the eight button lights, from the table at `0x46bd38`, in the bit order */
export const BUTTONS = [
  { name: "up", y: 297, x: 56 },
  { name: "right", y: 327, x: 91 },
  { name: "down", y: 361, x: 55 },
  { name: "left", y: 325, x: 26 },
  { name: "punch", y: 336, x: 132 },
  { name: "kick", y: 317, x: 129 },
  { name: "inv", y: 357, x: 127 },
  { name: "jump", y: 298, x: 115 },
] as const;

/** the mission clock, all of it from `0x40d250` */
export const CLOCK = {
  /** `[0x4a4d68] == 32000` is the level with no limit */
  noLimit: 32000,
  /** engine frames a dial step lasts (`idiv 0xfe3e`) */
  step: 450,
  /** the last step the dial has a cel for */
  states: 16,
  /** past this step the dial flashes */
  flashPast: 12,
} as const;

/** the full clock: seventeen steps of 450 frames, eight minutes at 15fps */
export const CLOCK_FULL = CLOCK.step * CLOCK.states;

/** the cels the panel needs, resolved by the book's own ids */
export interface HudArt {
  art(id: number): CanvasImageSource | null;
  hdr(id: number): ShpFrame | null;
}

/** one combatant as the bar shows them */
export interface HudFighter {
  health: number;
  max: number;
  /** their name plate, or 0 for none */
  nameCel: number;
}

export interface HudState {
  player: HudFighter;
  /** whoever holds the right-hand bar, or null if nothing ever has */
  enemy: HudFighter | null;
  score: number;
  lives: number;
  /** kills still wanted, 0…99 */
  quota: number;
  /** engine frames left on the mission clock ({@link CLOCK.noLimit} = none) */
  ticks: number;
  /** which buttons are down, one bit each in {@link BUTTONS} order */
  buttons: number;
  /** the special weapon: its icon cel and its magazine, or null for empty hands */
  weapon: { iconCel: number; ammo: number; magazine: number } | null;
}

/**
 * Paint the whole panel over a 512x384 context.
 *
 * The regions run in the painter's own order, each clipped to its own rect, so
 * an element that overflows is cut off exactly where `SC.EXE` cuts it — which
 * the sliding health fills depend on entirely.
 */
export function paintHud(ctx: CanvasRenderingContext2D, art: HudArt, s: HudState): void {
  /** draw a cel so its stored anchor lands on (x, y) — the engine's placement */
  const put = (id: number, x: number, y: number): void => {
    const a = art.art(id);
    const f = art.hdr(id);
    if (a && f) ctx.drawImage(a, x - f.posXraw, y - f.posYraw);
  };
  /** the same, by top-left corner, for the one thing the engine typesets */
  const blit = (id: number, left: number, top: number): number => {
    const a = art.art(id);
    const f = art.hdr(id);
    if (a && f) ctx.drawImage(a, left, top);
    return f ? f.width : 0;
  };
  const within = (r: Rect, body: () => void): void => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(r[1], r[0], r[3] - r[1], r[2] - r[0]);
    ctx.clip();
    body();
    ctx.restore();
  };

  // the two bands, which every region would otherwise blit for itself
  put(CEL.upper, 256, 21);
  put(CEL.lower, 256, 54 + PANEL_Y);

  // ---- the lives, one cel each, as many as are left ------------------------
  within(RECT.lives, () => {
    for (let i = 0; i < Math.min(s.lives, LIVES.length); i++) {
      put(CEL.life + i, LIVES[i].x, LIVES[i].y);
    }
  });

  // ---- the score. The original typesets it with the engine's own font at
  //      (236, 34); this page has no font here, so it lays out the panel's own
  //      numerals — the ones the kill quota uses — from the same left edge. They
  //      are 12 rows tall against the film's 9, which is the whole difference.
  within(RECT.score, () => {
    let left = AT.score.left;
    for (const ch of String(Math.max(0, Math.floor(s.score)))) {
      left += blit(CEL.digit + Number(ch), left, AT.score.top) + 1;
    }
  });

  // ---- the special weapon: its plate, its icon, and four rows of gauge -----
  within(RECT.weapon, () => {
    put(CEL.weaponPlate, AT.weaponPlate.x, AT.weaponPlate.y);
    if (s.weapon) put(s.weapon.iconCel, AT.weaponIcon.x, AT.weaponIcon.y);
    // `0x40d6a2`: the magazine scaled to 0…64, then sixteen units a row
    let left = s.weapon && s.weapon.magazine > 0
      ? Math.min(64, Math.max(0, Math.round((s.weapon.ammo * 64) / s.weapon.magazine)))
      : 0;
    for (let row = 0; row < AT.gauge.rows; row++) {
      const id = left > 15 ? CEL.gaugeFull : CEL.gaugePartial - left;
      left = left > 15 ? left - 16 : 0;
      put(id, AT.gauge.x, AT.gauge.y + row * AT.gauge.step);
    }
  });

  // ---- the enemy's bar and name, if anything has ever claimed them ---------
  if (s.enemy && s.enemy.max > 0) {
    const e = s.enemy;
    const health = Math.max(0, Math.min(e.max, e.health));
    within(RECT.enemyBar, () => {
      put(CEL.enemyFill, AT.enemyFill.x + Math.round((AT.enemyFill.span * (e.max - health)) / e.max), AT.enemyFill.y);
      put(CEL.enemyCap, AT.enemyCap.x, AT.enemyCap.y);
    });
    // a dead one keeps its bar and loses its name: `0x40d837` wants both the
    // name cel and the clamped health to be non-zero
    if (e.nameCel && health > 0) {
      within(RECT.enemyName, () => put(e.nameCel, AT.enemyName.x, AT.enemyName.y));
    }
  } else {
    within(RECT.enemyBar, () => put(CEL.enemyCap, AT.enemyCap.x, AT.enemyCap.y));
  }

  // ---- and the player's, the same two tricks mirrored ---------------------
  {
    const health = Math.max(0, Math.min(s.player.max, s.player.health));
    const max = Math.max(1, s.player.max);
    within(RECT.playerBar, () => {
      put(CEL.playerFill, AT.playerFill.x + Math.round((AT.playerFill.span * (health - max)) / max), AT.playerFill.y);
      put(CEL.playerCap, AT.playerCap.x, AT.playerCap.y);
    });
    if (s.player.nameCel) {
      within(RECT.playerName, () => put(s.player.nameCel, AT.playerName.x, AT.playerName.y));
    }
  }

  // ---- the mission dial ---------------------------------------------------
  within(RECT.dial, () => {
    const cel = dialCel(s.ticks);
    put(cel, AT.dial.x, AT.dial.y);
  });

  // ---- the kill quota, always two digits ----------------------------------
  within(RECT.quota, () => {
    const n = Math.max(0, Math.min(99, Math.floor(s.quota)));
    put(CEL.digit + Math.floor(n / 10), AT.quota.tens, AT.quota.y);
    put(CEL.digit + (n % 10), AT.quota.units, AT.quota.y);
  });

  // ---- the eight buttons, lit or not --------------------------------------
  BUTTONS.forEach((b, i) => {
    const down = (s.buttons & (1 << i)) !== 0;
    put((down ? CEL.buttonDown : CEL.buttonUp) + i, b.x, b.y);
  });
}

/**
 * Which dial cel a remaining count shows — `0x40d250`'s own arithmetic.
 *
 * The flash past step 12 alternates once an engine frame, which is what the
 * original's `xor byte ptr [0x4a4f04], 1` amounts to, so the parity of the count
 * itself stands in for the flag.
 */
export function dialCel(ticks: number): number {
  if (ticks >= CLOCK.noLimit) return CEL.dialOff;
  const left = Math.max(0, ticks);
  const state = Math.max(0, Math.min(CLOCK.states, CLOCK.states - Math.floor(left / CLOCK.step)));
  if (state > CLOCK.flashPast && Math.floor(left) % 2 === 0) return CEL.dialOff;
  return CEL.dial + state;
}

/** the bit for one button, by the name `BUTTONS` gives it */
export function buttonBit(name: (typeof BUTTONS)[number]["name"]): number {
  return 1 << BUTTONS.findIndex((b) => b.name === name);
}
