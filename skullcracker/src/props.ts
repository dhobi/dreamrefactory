/**
 * The level's own scenery WITH BEHAVIOUR — the things that are neither a fighter
 * nor a rect, and which CITY is built out of.
 *
 * Chapter four registers eleven classes and {@link file://./foes.ts} covers the
 * five that fight or take a hit. The rest are the level's machinery: `initplank`,
 * `initelevator`, `initibeam`, `initshack`, `initcrow`, `initwerec`. This file is
 * for the ones that carry the player rather than hit them, and it starts with the
 * plank because CITY has twenty of them and a route that needs them.
 *
 * ## An object can OWN a platform
 *
 * This is the mechanism the whole file rests on, and it is the engine's:
 *
 * ```
 *   0x42fb70(obj)                                the creator calls it
 *     for each of [0x46b9ac] records at 0x4aa600, stride 0x30:
 *       if (0x434200(obj's point, record + 2))    the object's POINT is in the rect
 *         if (record + 0xa == 0) record + 0xa = obj      it claims that platform
 *
 *   0x42fcb9  once a frame, per record:
 *     if (record has an owner) offset the rect it publishes by how far that owner
 *     has moved from the record's own point (0x434270)
 * ```
 *
 * So a `platform` record beside an object becomes that object's floor and follows
 * it, which is how an elevator carries a floor and how a plank takes one away. The
 * level says the same thing from its side: every `initplank` in CITY sits inside a
 * `platform` record of its own, the two agreeing to a few pixels.
 *
 * The compact table the mover actually reads is a second one — `0x4a69d0`, twelve
 * bytes a record, `{i16 y0, x0, y1, x1; ptr owner}` — rebuilt from the 48-byte
 * records every frame. `0x42fd80` searches it for the nearest top below the
 * object's feet and remembers the owner as the CARRIER, which is the part of this
 * that this page approximates rather than implements: a plank falls at three times
 * the player's gravity and leaves them behind in one frame either way.
 */

/** one of the three states a plank shows, as its own script */
export interface PlankAnim {
  cels: readonly number[];
  /** engine frames a cel is held — `ticksPerFrame` is 1 in all three */
  hold: number;
  from: string;
}

/**
 * The plank. Creator `0x450d50`, class `0x453110`, frame `0x4531d0`, hit
 * `0x4532d0` — which is `xor ax, ax; ret`, so a plank cannot be hit at all.
 *
 * Its frame function is the whole mechanic and it is worth reading in full:
 *
 * ```
 *   0x4531ef  state 0, and the player must be ON it:
 *   0x4531fc    if (ctx.x1 <= player.x) return          the plank's own rect
 *   0x453206    if (ctx.x0 >= player.x) return
 *   0x453215    if (player+0x2e == 0) return            they must be on the ground
 *   0x453230    if (plank.y - player.y >= 200) return   and within 200px
 *   0x45323f    if (player.y >= plank.y) return         and ABOVE it
 *   0x453245    if (ctx.count <= 5 && player+0x32 <= 100)
 *   0x453260       0x45d090(obj, 0x477cb8, 0)           wobble: 1050 1051 1052 1053
 *   0x45326f    else
 *   0x453275       0x42f850(obj, 3.0f)                  three times the player's gravity
 *   0x453285       0x45d090(obj, 0x477ce0, 0)           fall: 1054 … 1061
 *   0x453298       0x40ef30(bank, 3, point)             "0030 woodplankh"
 *   0x4532a7  state 1 (wobbling), when the animation ends:
 *   0x4532b4    ctx.count++
 *   0x4532be    0x45d090(obj, 0x477ca8, 0)             and back to intact
 * ```
 *
 * So a plank gives you **six crossings** and then goes — or goes at once if you
 * land on it hard, `player+0x32` being the raw downward speed accumulated since
 * the player last touched anything (`0x42fdbc`, zeroed on the ground). 100 raw is
 * 100/12 = 8.3 pixels of falling, so stepping across is safe and dropping onto one
 * is not.
 */
export const PLANK = {
  /** `0x477ca8` — one cel, and the only one that is a plank you can see across */
  intact: { cels: [1050], hold: 1, from: "0x477ca8" },
  /** `0x477cb8` kind 1 — it sags under you and comes back */
  wobble: { cels: [1050, 1051, 1052, 1053], hold: 1, from: "0x477cb8" },
  /** `0x477ce0` kind 2 — eight cels, and the last is the plank seen edge-on */
  fall: { cels: [1054, 1055, 1056, 1057, 1058, 1059, 1060, 1061], hold: 1, from: "0x477ce0" },
  /** `mov word ptr [esi+0xe], 0xa` — the divisor, and so the mass */
  divisor: 10,
  /** `0x42f850(obj, 3.0f)` — raw gravity 300, three times the player's 100 */
  gravity: 300,
  /** `cmp word ptr [edx+0xc], 5` — crossings before it gives way */
  crossings: 5,
  /**
   * `cmp word ptr [eax+0x32], 0x64` — the raw fall speed that breaks it at once,
   * in pixels once divided by the player's own 12.
   */
  hardFallPx: 100 / 12,
  /** `cmp edi, 0xc8` — how far above it the player may be and still be on it */
  reach: 200,
  /** `0x40ef30(bank, 3, point)` — WOODS' "0030 woodplankh" */
  sound: 3,
  from: "0x450d50 / 0x453110 / 0x4531d0",
} as const;

/** what a plank is doing */
export type PlankState = "intact" | "wobble" | "fall";

/** one placed plank, and the platform record it owns */
export interface Plank {
  /** the record's own point — where the cel's anchor goes */
  x: number;
  y: number;
  /** the record's rect: the x span the player has to be inside to be on it */
  left: number;
  right: number;
  state: PlankState;
  /** engine frames into the current script */
  clock: number;
  /** how many times it has been crossed — `ctx+0xc` */
  crossings: number;
  /** pixels per tick, once it is falling */
  vy: number;
  /**
   * The platform record this plank owns, or null where the level gave it none.
   * It is a COPY made per level ({@link file://./walk.ts}'s `solidsIn`), so moving
   * it moves the floor and nothing else.
   */
  floor: { top: number; bottom: number } | null;
}

/** which cel a plank is showing */
export function plankCel(k: Plank): number {
  const a = k.state === "intact" ? PLANK.intact : k.state === "wobble" ? PLANK.wobble : PLANK.fall;
  const i = Math.min(a.cels.length - 1, Math.floor(k.clock / a.hold));
  return a.cels[i];
}

/** how many engine frames the current script runs for */
export function plankFrames(k: Plank): number {
  const a = k.state === "intact" ? PLANK.intact : k.state === "wobble" ? PLANK.wobble : PLANK.fall;
  return a.cels.length * a.hold;
}

/**
 * The crow — `initcrow`, twelve of them in CITY, and the first FLYING thing this
 * page has had. Creator `0x450910`, class `0x4519b0`, frame `0x451aa0`, hit
 * `0x4520d0`.
 *
 * Its constructor says what it is before any of the states do: `obj+0xe = 1` (a
 * divisor of one, so it moves in whole pixels), `obj+0x2e = 0` — NOT on the ground
 * — and `0x42f850(obj, 0)`, which is gravity zero. Nothing else in the game is
 * built that way.
 *
 * ## The nine states, and they are all its own
 *
 * `0x451aa0` dispatches on the script's kind through the table at `0x45207c`, and
 * two of the states dispatch again on the tag. Read out:
 *
 * ```
 *   1  asleep   1854..1859  the player's POINT inside the crow's own rect wakes it
 *                           (0x434200 against ctx+8); otherwise it loops, and each
 *                           loop plays woods 14, "0170 crow sleep"
 *   2  waking   1835..1838  ends into 3
 *   3  rising   1840..1853  ends into 5, and woods 15, "0180 crow flap"
 *   5  flying   1800..1825  four tags in sequence; the third holds while the player
 *                           is within 350px and the fourth, past that, strikes
 *   4  circling 1830..1867  three tags, and inside 160px it strikes (woods 16,
 *                           "0210 crow strik[e]")
 *   8  striking 1870..1887  five tags: a 4-in-10 chance of giving up back to 4, and
 *                           a dive that repeats while the crow is west of the player
 *   6  falling  1884..1887  woods 17, "0220 crow fall", then gravity 1.0 into 10
 *   9  feathers 1890..1899  what a blow throws off; removed on touching the ground
 *  10  tumbling 1830..1834  where a killed crow ends
 * ```
 *
 * ## What moves it, and what does not
 *
 * **Every frame of every one of its scripts carries `dx 0, dy 0`.** A crow's
 * motion is entirely in the code, and the only motion the code contains is
 * vertical: before the dispatch, for any airborne state past 3 (`0x451aeb`),
 *
 * ```
 *   want = (0x434540(50) + 50) * ctx+0x12 + player.y - 100
 *   if (want - crow.y >  5) move (dy +10)
 *   if (want - crow.y < -5) move (dy -10)
 *   else vy = 0
 *   and |vy| over 10 is halved unless the state is 8 — which is what a dive is
 * ```
 *
 * So a crow holds a height about a hundred pixels above the player's own y,
 * jittered, and keeps its x. It does not fly across the level, and this page does
 * not invent a drift for it: what the file says is what it does.
 *
 * ## One blow
 *
 * `0x4520d0` has no health test — a crow cannot be hit by another crow
 * (`0x430ee0`) and cannot be hit while dying (`obj+0x1a < 0`), and any blow that
 * lands throws feathers (`0x4521d0` creates one crow-class object on the feather
 * script, or THREE when the blow beats 50), plays woods 18 — "0225 crow gets [hit]"
 * — turns gravity on and installs the tumble. Its own frame function resets
 * `obj+0x1a` to 100 every frame, so it is always hittable until it is dying.
 */
export const CROW = {
  sleep: { cels: [1854, 1855, 1856, 1857, 1858, 1859], hold: 2, from: "0x476aa8 kind 1" },
  wake: { cels: [1835, 1835, 1835, 1835, 1836, 1837, 1838], hold: 2, from: "0x476ae0 kind 2" },
  rise: {
    cels: [1840, 1841, 1842, 1843, 1844, 1845, 1846, 1847, 1848, 1849, 1850, 1851, 1852, 1853],
    hold: 1,
    from: "0x476b20 kind 3",
  },
  /** kind 5's tags 1, 2 and 3 run in sequence — tag 0 is a single beat on 1800 */
  fly: {
    cels: [
      1800, 1801, 1802, 1803, 1804, 1805, 1806, 1807, 1808, 1809, 1810, 1811, 1812, 1813, 1814, 1815, 1816, 1817,
      1818, 1819, 1820, 1821, 1822, 1823, 1824, 1825,
    ],
    hold: 2,
    from: "0x476b98 kind 5 tags 1..3",
  },
  /** kind 8 — the dive, and the one state whose vertical speed is not damped */
  strike: {
    cels: [1870, 1871, 1872, 1873, 1874, 1875, 1876, 1877, 1878, 1879, 1880, 1881, 1882, 1883, 1884, 1885, 1886, 1887],
    hold: 1,
    from: "0x476da0 kind 8",
  },
  /** kind 10 — a killed crow, with gravity on */
  tumble: { cels: [1830, 1831, 1832, 1833, 1834], hold: 2, from: "0x476ef8 kind 10" },
  /** kind 9 — the feathers a blow throws off, gone when they touch the ground */
  feathers: {
    cels: [1890, 1891, 1892, 1893, 1894, 1895, 1896, 1897, 1898, 1899],
    hold: 1,
    from: "0x476ea0 kind 9 / 0x4521d0",
  },
  /** `mov word ptr [esi+0xe], 1` — whole pixels, and the lightest thing in the game */
  divisor: 1,
  /** `sub ax, 0x64` — how far above the player it holds */
  above: 100,
  /** `0x434540(0x32) + 0x32` — the jitter on that, times `ctx+0x12` (1 or 2) */
  jitter: [50, 100] as const,
  /** `mov word ptr [esp+0xc], 0xa` — pixels a frame it closes the gap by */
  climb: 10,
  /** `cmp eax, 5` — the deadband it stops inside */
  band: 5,
  /** `cmp eax, 0xa0` — inside this the circling state strikes */
  strikeAt: 160,
  /** `cmp ecx, 0x15e` — and the flight's last tag strikes past this */
  farAt: 350,
  /** `0x434540(0xa)` under 4 — the chance a dive is abandoned */
  giveUp: 4,
  /** `0x42f850(obj, 1.0f)` on death — the player's own gravity, raw */
  deadGravity: 100,
  /** `0x40d450(0x50)` — what a crow is worth */
  award: 80,
  /** woods.snd, and the names are in the table above */
  sound: { sleep: 14, flap: 15, strike: 16, fall: 17, hit: 18 },
  /** `cmp ax, 0x32` — a blow over this throws three feathers instead of one */
  hardBlow: 50,
  from: "0x450910 / 0x4519b0 / 0x451aa0 / 0x4520d0",
} as const;

/** what a crow is doing — the engine's own states, by name */
export type CrowState = "sleep" | "wake" | "rise" | "fly" | "strike" | "tumble";

export interface Crow {
  x: number;
  y: number;
  /** its own rect: walking into it is what wakes it (`0x451ba3`) */
  top: number;
  left: number;
  bottom: number;
  right: number;
  state: CrowState;
  /** engine frames into the current script */
  clock: number;
  /** pixels per tick, once it is dead and falling */
  vy: number;
  /** `ctx+0x12` — the altitude factor, `0x434540(2)` when a dive begins */
  factor: number;
  /** the jitter drawn for this pass, so the height is steady between them */
  slack: number;
}

/** one puff of feathers — a crow-class object on kind 9, and it falls */
export interface Feather {
  x: number;
  y: number;
  vy: number;
  age: number;
}

/** which cel a crow is showing */
export function crowCel(c: Crow): number {
  const a = CROW[c.state];
  const i = Math.floor(c.clock / a.hold);
  // the looping states cycle; the one-shots hold their last cel
  const loop = c.state === "sleep" || c.state === "fly";
  return a.cels[loop ? i % a.cels.length : Math.min(a.cels.length - 1, i)];
}

/** how many engine frames the current script runs for */
export function crowFrames(c: Crow): number {
  return CROW[c.state].cels.length * CROW[c.state].hold;
}
