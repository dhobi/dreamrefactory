/**
 * The two things every level throws that are not in any level's book: the spray
 * a blow makes, and the flying television that ends a mission.
 *
 * Both live in `PLAYER.SBK` — the 1229-cel book the player comes out of, loaded
 * once and shared by all sixteen levels — which is why they work everywhere
 * without a per-level table.
 *
 * ## The spray — `0x40cba0`, and what becomes of it
 *
 * `0x40cba0(victim, damage, hitter)` is a particle fountain every hit handler in
 * the game calls before it subtracts anything:
 *
 * ```
 *   n = clamp(damage / 6, 1, 20)                 0x40ccef..0x40cd15
 *   repeat n times:
 *     obj = new(class [0x4a4f0c])                the shared effect class
 *     (vy, vx) = the HITTER's own (dy, dx)       0x40cd8b, from its cel record +20
 *     if the hitter faces left, negate vx        0x40cda5
 *     each component: v = v - span/2 + rand(span), span = max(|v|, 10)
 *     with no hitter at all: v = rand(0x50) - 0x28, both axes
 *     facing = 0x434540(2) - 1                   a coin toss, so they mirror
 *     lifetime = 60 frames                       [ctx+2] = 0x3c
 *     0x45d090(obj, 0x46bbd8, 0)                 cels 18200, 18201, 18202
 * ```
 *
 * Rendering those cels says what they are: **green gobs of goo**, the same green
 * that runs out of a dead punk's head in `0x477848`'s last eight cels. What
 * happens to them afterwards is under {@link SPRAY} — they arc, land and spread,
 * and they are not fire-and-forget.
 *
 * Two damage values are not damage at all and take their own branch: **−13**
 * spawns one object on cels 19870 down to 19850 (`0x46bb78`), and **−14** one on
 * 19120..19134 (`0x46ba28` tag 6). A dying punk's own state handler passes −13,
 * so that one is a death effect rather than a hit effect.
 *
 * ## The flying television — `0x410170`, `0x410480`
 *
 * A level's `goal` record is not a door and not a trigger: it is where the engine
 * puts an OBJECT once the kill quota is met, and the object is a hovering craft
 * that lowers a television screen when you reach it.
 *
 * `0x450060` reads the record at level load and keeps four things from it:
 * `[0x4a78f0]` its point `(pointY, pointX)`, `[0x4a78d8]` its `param` — which is
 * the craft's FACING, and the only use anything makes of that field —
 * `[0x4a78da]`/`[0x4a78de]` its rect. Then, once per frame, `0x450190`:
 *
 * ```
 *   if (0x42f540() > [0x4789d4]) return          census still above the quota
 *   if ([0x46b1b0] == 0) {                       not spawned yet
 *      0x410170([0x4a78f0], param, -1, &rect)    spawn it, ONCE
 *      [0x46b1b0] = 1
 *   } else if (0x410370()) [0x4abdfc] = 7        reached: this stage is over
 * ```
 *
 * `0x410170` mode −1 puts it at `(pointY − 180, pointX)` — a hundred and eighty
 * pixels ABOVE the record, in the air — and starts it on `0x46be48` tag 0. Its
 * own handler `0x410480` then runs three phases:
 *
 * - **descend**, while `y < pointY`: `obj+0xa = 4`, so it sinks four pixels a
 *   frame until it is level with the record.
 * - **hover**: `[0x46ba0c]` is 2, applied every frame, and negated whenever the
 *   accumulated offset passes 5 — a slow bob through ten pixels. Cels 20210 and
 *   20211, two frames each.
 * - **open**, once `0x434200(player, rect)` says the player is standing in the
 *   goal rect and `0x42fad0(craft, 300, 200)` agrees they are close: cels 20240
 *   to 20255 at two frames each, sixteen of them, and when the last one has
 *   played `[0x46ba10]` is set and the stage ends.
 *
 * Which is exactly what it looks like: the thing flies in, waits for you, and
 * unfolds a screen with a picture on it.
 */

/**
 * The goo, and the whole of its life — `0x40cba0` throws it and `0x40c480`, the
 * effect class's own frame function, is what happens next.
 *
 * The gobs are not fire-and-forget. `0x40c3c0` message 1 gives the class a
 * divisor of **2** and nothing else, and `0x40c480` dispatches on the script kind
 * and then on the TAG through a byte table at `0x40c7e8` — three cases for eight
 * tags:
 *
 * ```
 *   tag 0        while it is still rising          cels 18200..18202
 *      if (obj+0xa > 0) → tag 1                    vy turned positive: it is falling
 *      if (obj+0x2e)    → tag 2                    it landed
 *   tag 1        falling                           cels 18203, 18204
 *      if (obj+0x2e)    → tag 2                    it landed
 *   tags 2..7    on the ground
 *      first frame: obj+0xa = obj+0xc = 0          it stops dead where it fell
 *      0x40c810(obj) finds another gob overlapping it, and if that one's
 *      tag < 7, advances it: 0x45d090(other, script, tag + 1)
 *      every 0x434540(0x28)+0x28 frames, step this one back DOWN one tag,
 *      and at tag 2 it is removed
 * ```
 *
 * So: a gob arcs, splats, and the splat **spreads as more goo lands on it** —
 * cels 18205 through 18210 are 22x9, 37x9, 51x14, 62x21, 80x25 and 106x25, one
 * puddle growing — and then dries back down one stage at a time. Which is why
 * killing something leaves a mess on the pavement rather than a shower.
 *
 * The one thing not in the executable is the fall itself. There is no gravity
 * constant anywhere in `SC.EXE` — that was established for the player and holds
 * here — so a gob falls under {@link INVENTED.gravityPx}, the same number the
 * player falls under, and nothing else about it is this port's.
 */
export const SPRAY = {
  /** `0x46bbd8` tag 0: rising, three cels held three engine frames each */
  rise: { cels: [18200, 18201, 18202] as readonly number[], hold: 3, from: "0x46bbd8 tag 0" },
  /** tag 1: falling */
  fall: { cels: [18203, 18204] as readonly number[], hold: 3, from: "0x46bbd8 tag 1" },
  /** tags 2 to 7: the puddle, one cel per stage, spreading as more goo lands */
  pool: [18205, 18206, 18207, 18208, 18209, 18210] as readonly number[],
  /** the class's own speed divisor, `obj+0xe` in `0x40c3c0` message 1 */
  divisor: 2,
  /** `[ctx+2] = 0x3c` — engine frames a gob may spend in the air */
  life: 60,
  /** `0x434540(0x28) + 0x28` — engine frames a puddle holds a stage before drying */
  dry: [40, 79] as const,
  /** `idiv cx` with `cx = 6` — one gob per six points of damage */
  per: 6,
  /** the clamp either side: at least one, at most twenty */
  least: 1,
  most: 20,
  /** the floor on a component's scatter span — `cmp ax, 0xa` */
  spread: 10,
  from: "0x40cba0 / 0x40c480 / 0x46bbd8",
} as const;

/**
 * The green ball a body leaves behind — `0x40cba0`'s **−13** branch.
 *
 * A corpse's own state handler counts `[0x46b204]`'s fifty frames down and then,
 * on the frame it expires, calls `0x40cba0(pos, -13, 0)` and returns 1 so the
 * object goes. −13 is not a damage value: it takes its own branch at the top of
 * `0x40cba0`, creates ONE object on cel `0x4d9e` = 19870 and installs `0x46bb78`
 * tag 2. Both punk classes do it — `0x44ef7e` and `0x44f848`.
 *
 * The eleven cels are a bright green sphere that swells and then collapses to a
 * point: 19870, 19869, 19868, 19867, 19866, 19865 grow from 61 to 89 pixels
 * across, then 19854, 19853, 19852, 19851, 19850 fall away to 6x7. Eleven frames
 * at one frame each — three quarters of a second, and the body is gone.
 */
export const VANISH = {
  cels: [19870, 19869, 19868, 19867, 19866, 19865, 19854, 19853, 19852, 19851, 19850] as readonly number[],
  hold: 1,
  from: "0x40cba0 −13 / 0x46bb78 tag 2",
} as const;

/** one green ball, mid-swell */
export interface Pop {
  x: number;
  y: number;
  /** engine frames since it appeared */
  age: number;
}

/** the flying television — `0x410170` mode −1 and `0x410480` */
export const CRAFT = {
  /** `sub word ptr [esi+6], 0xb4` — how far above the record it appears */
  above: 180,
  /** `mov word ptr [esi+0xa], 4` — pixels a frame it sinks while too high */
  sink: 4,
  /** `[0x46ba0c]` — the hover drift, reversed past {@link CRAFT.bobSpan} */
  bob: 2,
  bobSpan: 5,
  /** `0x46be48` tag 0 — waiting, two cels held two frames each */
  hover: { cels: [20210, 20210, 20211, 20211] as readonly number[], hold: 2, from: "0x46be48 tag 0" },
  /** `0x46be48` tag 1 — the screen coming down, and the end of the stage */
  open: {
    cels: [
      20240, 20241, 20242, 20243, 20244, 20245, 20246, 20247,
      20248, 20249, 20250, 20251, 20252, 20253, 20254, 20255,
    ] as readonly number[],
    hold: 2,
    from: "0x46be48 tag 1",
  },
  /** `0x42fad0(craft, 0x12c, 0xc8)` — how close is close enough, on top of the rect */
  near: { x: 300, y: 200 },
  from: "0x410170 / 0x410480 / 0x450060",
} as const;

/** one gob of goo, in the air or on the ground */
export interface Gob {
  x: number;
  y: number;
  /**
   * Pixels per TICK — the blow's own component through the class's divisor of 2
   * and then through {@link TICK_SCALE}, so it is in the same units the player's
   * `vy` is in and falls under the same gravity per tick.
   */
  vx: number;
  vy: number;
  /** engine frames it has been alive */
  age: number;
  /** the coin toss `0x434540(2) - 1` makes, so the gobs are not all identical */
  mirror: boolean;
  /**
   * Which of {@link SPRAY.pool} it has spread to, or −1 while it is still in the
   * air. A gob that lands on another does not become a puddle of its own: it
   * advances the one already there, the way `0x40c810` and the `tag + 1` install
   * do.
   */
  stage: number;
  /** engine frames until this stage dries back to the one below it */
  holds: number;
}

/** `0x434540(0x28) + 0x28` — how long a puddle holds its stage */
export function dryTime(): number {
  return SPRAY.dry[0] + Math.floor(Math.random() * (SPRAY.dry[1] - SPRAY.dry[0] + 1));
}

/**
 * The engine's own scatter: keep the sign and magnitude of the blow, and jitter
 * by up to half of it either way, with a floor of ten so a straight blow still
 * throws the goo about.
 *
 * `0x40cdb9..0x40ce77`, once per axis. The engine's `0x434540(n)` returns 1..n,
 * so the spread is `v - span/2 + (1..span)`; `Math.random()` stands in for the
 * generator and nothing else here does.
 */
export function scatter(v: number): number {
  const span = Math.max(Math.abs(v), SPRAY.spread);
  return v - Math.trunc(span / 2) + 1 + Math.floor(Math.random() * span);
}

/** how many gobs a blow of this strength throws — `clamp(damage/6, 1, 20)` */
export function gobCount(damage: number): number {
  const n = Math.trunc(damage / SPRAY.per);
  return Math.min(SPRAY.most, Math.max(SPRAY.least, n));
}
