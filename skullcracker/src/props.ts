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
 * object's feet and remembers the owner as the CARRIER. What a carrier gives its
 * rider is its HORIZONTAL speed (`0x4302b1`: a carrier with a nonzero `obj+0xc`
 * sets the rider's) — the vertical comes from the record moving under the rider's
 * feet. A plank falls at three times the player's gravity: the record drops 30
 * pixels in its first frame, past the mover's 8-pixel snap (`0x42ff56`), and the
 * rider is left to fall on their own.
 *
 * The plank's own fall ends on the room's floor: its `obj+0x34` is the
 * allocator's 0 (`0x42f5a7`), so `0x42fe4a` skips the platform table for it and
 * `0x40bbd0`'s floor is the only one it meets, and its record comes to rest with it.
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
 * land on it hard, `player+0x32` being the distance fallen since the apex:
 * `0x42fdbc` adds `obj+0xa` to it on every airborne frame the velocity is
 * downward, and `0x42fdc2` zeroes it on every frame that ends on the ground.
 *
 * And `obj+0xa` is **whole pixels a frame** — the stepper adds it to the position
 * undivided (`0x42fda7`) — so the 100 this is compared against is 100 PIXELS, not
 * a raw number wanting the player's divisor. This page divided it by 12 and broke
 * a plank after 8.3 pixels of falling, which is any jump at all. Against the jump
 * as the engine actually flies it — 80 pixels plain, 137 with the lift — that is
 * the difference between "hopping across is safe, leaping onto it is not" and
 * "the first plank you land on drops you". See {@link hardFallPx}.
 *
 * A fallen plank does not stay fallen past a death. The class's own pass
 * (`0x453040`), after stepping every plank, watches `0x402f60` — the player is
 * alive while their script's kind is below 26, the dying scripts' — and when it
 * has seen them dead and then alive again it calls `0x453090`, which puts every
 * plank back: crossings 0 (`0x4530a2`), the creator's point (`0x4530b0`), no
 * speed, the intact script and no gravity. So the respawn finds every plank
 * whole, fallen or not, and the platform it owns comes back under it
 * (`0x42fcb9`). The rope bridge's pass does the same (`0x4221e0` → `0x422230`).
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
  /**
   * `0x42f850(obj, 3.0f)` at `0x453275` writes `3.0 × 10.0` (`0x46a110`) into
   * `obj+0x24`: 30 pixels a frame added to `obj+0xa` on every airborne frame
   * (`0x43032b`), three times the player's 10. The divisor plays no part — it
   * scales `0x42f8b0`'s impulses, not the mover's gravity — and nothing caps the
   * speed it builds.
   */
  gravity: 30,
  /** `cmp word ptr [edx+0xc], 5` — crossings before it gives way */
  crossings: 5,
  /**
   * `cmp word ptr [eax+0x32], 0x64` — the fall that breaks it at once, in the
   * pixels `obj+0x32` counts. A plain jump's 80 sags it; the lift's 137 and any
   * drop from a ledge above break it.
   */
  hardFallPx: 100,
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
  /** a fallen plank that the room's floor has caught */
  landed?: boolean;
  /** fallen past the room, drawn and stepped no more until a death puts it back */
  gone?: boolean;
  /** the creator's point, where `0x453090` puts it back — `ctx[0]` */
  homeY: number;
  /** and where its record stood then */
  homeFloor: { top: number; bottom: number } | null;
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
 * — and `0x42f850(obj, 0)`, which is gravity zero. The creator faces every one of
 * them east (`0x45095c`, `obj+0x28 = 0`) and nothing turns one round.
 *
 * ## The states, and they are all its own
 *
 * `0x451aa0` dispatches on the script's kind through the table at `0x45207c`, and
 * three of the states dispatch again on the tag. Read out:
 *
 * ```
 *   1  asleep   1854..1859  the player's POINT inside the crow's own rect wakes it
 *                           (0x434200 against ctx+8); otherwise it loops, and each
 *                           loop plays woods 14, "0170 crow sleep"
 *   2  waking   1835..1838  ends into 3
 *   3  rising   1840..1853  ends into 5 tag 0, and woods 15, "0180 crow flap"
 *   5  flying   tag 0 sheds speed, 1 flaps, 2 backs off from a player within 350
 *               ahead, 3 strikes a player 350 or more east of it
 *   4  hopping  tag 0 (1860..1867, three steps of dx 10) strikes a player less
 *               than 160 east of it — or anywhere west; tags 1 and 2 fold and
 *               unfold (1830..1834)
 *   8  striking tag 0 gives up 3 times in 10 (0x434540(10) < 4) into 4, else the
 *               dive: tag 2 and 3 drop until it is at its height, tag 4 runs east
 *               and repeats while the crow is still west of the player
 *   6  falling  1884..1887 twice, woods 17, then gravity 1.0 into 10
 *   9  feathers 1890..1899  what a blow throws off; gone on touching the ground
 *  10  tumbling 1830..1834  where a killed crow ends — lying on the floor, its
 *                           foot 33 up (0x45205f writes obj+0x10 = -33)
 * ```
 *
 * ## What moves it
 *
 * Velocity, and nothing takes it back in the air — the mover's drag is the
 * ground's (`0x4302c0`). Every push is an impulse into `obj+0xa`/`obj+0xc`:
 * the scripts' own steps (the hop's and the dive's frames carry `dx 10`, the
 * dive's `dy 10..30`), and before the dispatch, for any airborne state from 4
 * up bar 9 and 10 (`0x451aeb`), the height:
 *
 * ```
 *   want = (0x434540(50) + 50) * ctx+0x12 + player.y - 100   ; rolled each frame
 *   if (want - crow.y >  5) push dy +10
 *   if (want - crow.y < -5) push dy -10
 *   else vy = 0
 *   and |vy| over 10 is halved unless the state is 8 — which is what a dive is
 * ```
 *
 * `ctx+0x12` is 0 until a dive starts (`0x451ef4` rolls it 1 or 2) and 0 again
 * once one ends (`0x45202a`), so a crow on the wing holds a hundred above the
 * player's point exactly, and a diving one aims 51..200 lower. Its horizontal
 * speed is halved by the states that want it slower (`0x451d29`, `0x451dbc`,
 * `0x451fc3`) and zeroed at the end of a flight (`0x451dd4`).
 *
 * ## One blow
 *
 * `0x4520d0` has no health test — a crow cannot be hit by another crow
 * (`0x430ee0`) nor by a hitter whose strength is a code (`0x452121`), and any
 * blow that lands throws feathers (`0x4521d0` creates one crow-class object on
 * the feather script, or FOUR when the blow beats 50), plays woods 18 — "0225
 * crow gets [hit]" — turns gravity on and installs the tumble. Its own frame
 * function resets `obj+0x1a` to 100 every frame; the tumble's cels carry no body
 * box, so a dead crow cannot be hit again.
 *
 * ## And one blow that is not one: −9
 *
 * `0x4520d0` opens on `cmp word ptr [esi + 0x1a], -9`, before the class test and
 * before anything else, which makes the crow the **eighth** reader of the burn
 * code — the one this port had read every other owner of and could not put a
 * name to, because the class it hangs off has no name to put. `0x451990`, called
 * from CITY's own entry at `0x451628`, registers it straight off the handler
 * (`0x430cc0(0x4519b0)`) with no `init*` string, since no level places one: the
 * level's creator `0x450910` does, off the `initcrow` records.
 *
 * The fit is the chapter's, and the ART settles it. The flamer is CITY's own
 * weapon — `0x4511f0` names it for `woods.sbk` and `city.sbk`, see
 * `CHAPTER_WEAPON` in {@link file://./guns.ts} — so the one level that perches
 * twelve crows is one of the two that hand you the thing that lights them; and
 * {@link FLAME}'s 9600..9629 are in CITY, PLAYGR, VAT and WOODS, of which CITY
 * has no other class that reads the code. The crow is why CITY carries the fire.
 *
 * See {@link CROW.burns} and {@link burnCrow}.
 */
/** one tag of a crow script: its cels, ticks a cel, and each cel's own push */
export interface CrowTag {
  cels: readonly number[];
  hold: number;
  dx?: readonly number[];
  dy?: readonly number[];
}

export const CROW = {
  sleep: [{ cels: [1854, 1855, 1856, 1857, 1858, 1859], hold: 2 }],
  wake: [{ cels: [1835, 1835, 1835, 1835, 1836, 1837, 1838], hold: 2 }],
  rise: [
    {
      cels: [1840, 1841, 1842, 1843, 1844, 1845, 1846, 1847, 1848, 1849, 1850, 1851, 1852, 1853],
      hold: 1,
    },
  ],
  /** `0x476b98`, kind 5 */
  fly: [
    { cels: [1800], hold: 2 },
    { cels: [1800, 1801, 1802, 1803, 1804, 1805, 1806], hold: 2 },
    { cels: [1807, 1808, 1809, 1810, 1811, 1812, 1813, 1814, 1815, 1816], hold: 2 },
    { cels: [1817, 1818, 1819, 1820, 1821, 1822, 1823, 1824, 1825], hold: 2 },
  ],
  /** `0x476d08`, kind 4 */
  hop: [
    { cels: [1860, 1861, 1862, 1863, 1864, 1865, 1866, 1867], hold: 1, dx: [0, 0, 0, 10, 10, 10, 0, 0] },
    { cels: [1830, 1831, 1832, 1833, 1834], hold: 1 },
    { cels: [1834, 1833, 1832, 1831, 1830], hold: 1 },
  ],
  /** `0x476da0`, kind 8 — the one state whose vertical speed is not damped */
  strike: [
    { cels: [1879], hold: 1, dx: [10] },
    {
      cels: [1884, 1885, 1886, 1887, 1887, 1887, 1887, 1887, 1887, 1887],
      hold: 1,
      dx: [0, 0, 0, 10, 10, 10, 5, 5, 5, 10],
      dy: [0, 0, 0, 0, 20, 20, 20, 20, 20, 30],
    },
    { cels: [1870, 1871, 1872, 1873, 1874], hold: 1, dy: [0, 0, 0, 10, 10] },
    { cels: [1875, 1876], hold: 1, dy: [10, 10] },
    { cels: [1877, 1878, 1878, 1879], hold: 1, dx: [10, 10, 10, 10] },
  ],
  /**
   * kind 6 — the fall, and the one state no ordinary blow can reach. `0x476e58`
   * is 1884..1887 played TWICE, eight frames of the dive's last four cels, and
   * `0x451e5a` plays woods 17 under it and ends it with `0x42f850(obj, 1.0f)`,
   * the tumble and the same award a punched crow pays.
   *
   * The height code at `0x451aeb` still runs while it plays — state 6 is past 3
   * and is neither 9 nor 10 — so a burning crow goes on holding its station for
   * these eight frames and only drops when they are up.
   */
  fall: [{ cels: [1884, 1885, 1886, 1887, 1884, 1885, 1886, 1887], hold: 1 }],
  /** kind 10 — a killed crow, with gravity on */
  tumble: [{ cels: [1830, 1831, 1832, 1833, 1834], hold: 2 }],
  /** kind 9 — the feathers a blow throws off, looping until they touch the ground */
  feathers: { cels: [1890, 1891, 1892, 1893, 1894, 1895, 1896, 1897, 1898, 1899], hold: 1 },
  /** `mov word ptr [esi+0xe], 1` — whole pixels, and the lightest thing in the game */
  divisor: 1,
  /** `sub ax, 0x64` — how far above the player it holds */
  above: 100,
  /** `0x434540(0x32) + 0x32` — the jitter on that, times `ctx+0x12` (0, 1 or 2) */
  jitter: 50,
  /** `mov word ptr [esp+0xc], 0xa` — the push toward its height, each frame */
  climb: 10,
  /** `cmp eax, 5` — the deadband it stops inside */
  band: 5,
  /** `cmp eax, 0xa` / `0x451b77` — over this the climb is halved, bar a dive */
  damp: 10,
  /** `cmp eax, 0xa0` — a player less than this east of a hopping crow is struck */
  strikeAt: 160,
  /** `cmp ecx, 0x15e` — the flight backs off inside this and strikes past it */
  farAt: 350,
  /** `0x451d87`/`0x451d90` — the back-off push, and `0x451db1`'s cap on it */
  backOff: 10,
  backOffCap: 20,
  /** `0x451fb8` — the dive's run east is halved over this */
  runCap: 30,
  /** `0x434540(0xa)` under 4 — the chance a dive is abandoned */
  giveUp: 4,
  /** `0x42f850(obj, 1.0f)` on death — the allocator's own ten a frame² */
  deadGravity: 10,
  /** `0x45205f` — `obj+0x10 = -33`, the tumbling crow's foot */
  deadFoot: -33,
  /** `0x40d450(0x50)` — what a crow is worth */
  award: 80,
  /** woods.snd, and the names are in the table above */
  sound: { sleep: 14, flap: 15, strike: 16, fall: 17, hit: 18 },
  /** `cmp ax, 0x32` — a blow over this throws four feathers instead of one */
  hardBlow: 50,
  /**
   * `0x4521d0` — one feather: at the crow's point, facing `0x434540(2) - 1`,
   * pushed `0x434540(11) - 6` across and `0x434540(11)` down, with gravity
   * `0x42f850(obj, 0.1)` — one pixel a frame².
   */
  feather: { gravity: 1, from: "0x4521d0" },
  /**
   * What a blow of **−9** does to it — the same shape `Foe.burns` records for
   * the seven creature classes that read the code, written out here because a
   * crow is not a `Foe` and has no brain to hang a reaction off.
   */
  burns: {
    /**
     * `0x44ff20(self, 3, 0)` — a NONZERO second argument, so `0x44ffe2` puts the
     * flame straight on `0x478978` tag 2 rather than letting it take hold first.
     */
    late: true,
    /** ...and a zero third, so `0x453f6f` never reinstalls it: this one goes out */
    forever: false,
    /**
     * `0x4520df`..`0x452108` returns 1 out of that arm, above `0x452109`'s class
     * test and above the strength test, so the code never lands as a blow and
     * no feathers come off.
     */
    andHurts: false,
    /** what it plays while it burns is {@link CROW.fall}, and that is the end of it */
    fatal: true,
    from: "0x4520d0 / 0x44ff20 / 0x476e58",
  },
  from: "0x450910 / 0x4519b0 / 0x451aa0 / 0x4520d0",
} as const;

/** what a crow is doing — the engine's own states, by name */
export type CrowState =
  | "sleep"
  | "wake"
  | "rise"
  | "fly"
  /** kind 4 — see {@link CROW.hop} */
  | "hop"
  | "strike"
  /** kind 6 — burning, on its way to the tumble; see {@link burnCrow} */
  | "fall"
  | "tumble";

export interface Crow {
  x: number;
  y: number;
  /** its own rect: walking into it is what wakes it (`0x451ba3`) */
  top: number;
  left: number;
  bottom: number;
  right: number;
  state: CrowState;
  /** `obj+0x44` — which tag of the state's script */
  tag: number;
  /** engine frames into the current tag */
  clock: number;
  /** `obj+0xc` and `obj+0xa`, pixels an engine frame */
  vx: number;
  vy: number;
  /** `obj+0x24` — zero until it dies */
  gravity: number;
  /** `obj+0x2e` — on the ground */
  grounded: boolean;
  /** `obj+0x2a` — its strike box met the player since the dive's run began */
  hit: boolean;
  /** `ctx+0x12` — the altitude factor, `0x434540(2)` when a dive begins */
  factor: number;
}

/** one puff of feathers — a crow-class object on kind 9, and it falls */
export interface Feather {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** `obj+0x28` — `0x434540(2) - 1` */
  mirror: boolean;
  age: number;
  /** `obj+0x2e` — it has landed, and the next think lets it go */
  grounded: boolean;
}

/** the tag a crow is on */
export function crowTag(c: Crow): CrowTag {
  const tags = CROW[c.state] as readonly CrowTag[];
  return tags[Math.min(tags.length - 1, c.tag)];
}

/**
 * which cel a crow is showing — `clock` counts the frames the tag has shown, so
 * the one on screen is the one before it; a script that has ended holds its
 * last cel
 */
export function crowCel(c: Crow): number {
  const a = crowTag(c);
  const k = Math.floor(Math.max(0, c.clock - 1) / a.hold);
  return a.cels[Math.min(a.cels.length - 1, k)];
}

/** how many engine frames the current tag runs for */
export function crowFrames(c: Crow): number {
  const a = crowTag(c);
  return a.cels.length * a.hold;
}

/**
 * The crow's reaction to a **−9** — `0x4520d0`'s first arm, and the whole of it.
 *
 * One `0x44ff20` for the flame ({@link CROW.burns} carries its two arguments)
 * and one `0x45d090` for `0x476e58`, which is the crow's own sixth state. That
 * is all the arm does: it returns 1 before the ordinary handler is reached, so
 * there is no sound of being hit, no feathers, no damage and no award on this
 * frame. The award and the tumble come when the fall ENDS (`0x451e5a`), which is
 * the same pair of calls a punched crow gets at once — so burning a crow kills
 * it, eight frames later than a punch does.
 *
 * The arm carries no state test of its own, so this does not add one; the clock
 * is rewound only on a change of state, the way `install` in
 * {@link file://./brains/kit.ts} does it, which is what keeps a crow held in the
 * flame from being pinned on the fall's first cel for ever.
 */
export function burnCrow(c: Crow): void {
  if (c.state !== "fall") {
    c.clock = 0;
    c.tag = 0;
  }
  c.state = "fall";
}

/**
 * The elevator — `initelevator`, five of them in CITY, and the only vertical
 * transport in the game's second level. Creator `0x450dc0`, class `0x4533a0`,
 * frame `0x453470`, script `0x477db0`.
 *
 * It is what a `ladder` is everywhere else: CITY has no `ladder` records at all,
 * its goal sits at y1802, and the walk east along the rooftops tops out around
 * y3590. Without these five the upper half of the level cannot be entered — 45
 * of its 73 platforms are reachable, and the goal is not one of them.
 *
 * ## Not a physical object
 *
 * The constructor says so outright, in three writes: `obj+0xe = 0xa` — a speed
 * divisor of TEN where the player's is twelve, so this thing is not measured in
 * the player's units; `0x42f850(obj, 0)` — **gravity zero**, which in this
 * engine is how you say "driven, not falling" (a crow gets the same, a plank
 * gets 3.0); and `obj+0x30 = 0`, never on the ground. It is a rect that is moved
 * by its own state machine and by nothing else.
 *
 * ## Two objects, and only one of them is the lift
 *
 * `0x450dc0` builds a PAIR, and reading the wrong one is an easy mistake to make
 * because only the second has an animation script. `0x430d40` makes the car and
 * its constructor sets `obj+0 = 0x47e` — 1150, and `obj+0` is an object's base
 * cel, which is how a crow's constructor says `0x708` for its own 1800. `0x42f610`
 * then makes a SECOND object at `obj+0 = 0x488` — 1160 — and hands it script
 * `0x477db0`.
 *
 * So **1150 is the cage you ride** (106x314, its anchor 308 rows down, which is
 * the foot of it: the art is mostly the cable it hangs from) and **1160..1163 is
 * the winch** that hauls it, four frames of a turning drum. The car carries no
 * script at all — nothing installs one — so it simply shows 1150 while the winch
 * above it animates. Drawing the winch as the car is what this port did first,
 * and it put a motor where the lift should be.
 *
 * ## The five states are the script's five tags
 *
 * `0x453470` dispatches on the object's current animation tag through the table
 * at `0x45366c`, and `0x477db0` carries exactly tags 0..4. So the animation IS
 * the state, and each handler's job is to install the next tag:
 *
 * ```
 *   0  idle      1160 x6       waits on obj+0x46; on it, sound 9 and a DIRECTION:
 *                              tag 1 if the car is above the shaft's bottom, else tag 3
 *   1  starting  1160 x3, 1163 one beat, then tag 2
 *   2  down      1161 1162 1163  pushes +0x28 a frame and re-installs itself until
 *                              the end is reached: then sound 10 and back to tag 0
 *   3  starting  1160 x3, 1161 the mirror of 1, then tag 4
 *   4  up        1163 1162 1161  pushes -0x28 a frame, otherwise as tag 2
 * ```
 *
 * The `0x28` is an IMPULSE, not a speed: `0x42f8b0` adds `40/10 = 4` to the car's
 * `obj+0xa` every frame and the mover carries it. Down is then clamped to 6 a
 * frame (`0x453538`) and up to 13 (`0x4535f2`), so a car accelerates over a frame
 * or two and then runs at **90 pixels a second down and 195 up** at the engine's
 * 15 frames a second. The end test reads the car's y BEFORE the mover moves it
 * (`0x453549`, `0x45360c`), so the last frame's travel carries it a few pixels past
 * the end before `obj+0xa = 0` stops it. The two sounds are
 * `0x40ef30(bank, 9, …)` on departure and `(…, 10, …)` on arrival.
 *
 * ## `obj+0x46` is not a trigger
 *
 * Every state above gates on it, and this port first read it as a call button and
 * then as a boarding latch. It is neither. `obj+0x46` is written by exactly one
 * routine in the executable — the animation stepper `0x45d0f0`, at `0x45d151`
 * (0) and `0x45d15f` (1) — and it means **"my script's last frame completed this
 * frame"**. So a state that "waits on `obj+0x46`" is waiting for its own
 * animation to finish. Tag 0 is eighteen frames of cel 1160; when they run out
 * the car goes, whether or not anyone is standing on it, and pauses another
 * eighteen at the far end. The lift shuttles, and the rider catches it.
 *
 * ## The car OWNS a platform, and the level authored one for each
 *
 * The creator calls `0x42fb70` — the plank's "claim the `platform` record that
 * contains my point" — and it lands, five times out of five, once the point is
 * taken at the shaft's BOTTOM rather than at the record's stored point (which is
 * the shaft's middle and is inside nothing):
 *
 * ```
 *   elevator  #50 (9411,4160) -> platform  #55  129x31
 *             #51 (7796,3300)              #54  126x26
 *             #52 (6775,2965)              #53  126x20
 *             #78 (8611,2561)              #79  126x20
 *            #102 (7160,3994)             #103  129x31
 * ```
 *
 * Those five are **the only platforms in CITY between 120 and 135 pixels wide** —
 * a size class of exactly five in a level of seventy-three, one per lift. They
 * are the LANDINGS: the car at rest is its landing, and riding up carries the
 * record with it exactly as a falling plank carries its floor down. So nothing
 * here is appended and nothing is invented; the shaft says how far the car
 * travels and the landing says where it starts.
 */
export const ELEVATOR = {
  /**
   * The CAR, and it is TWO cels with the rider between them.
   *
   * `0x4533c3` sets the object's base cel to 1150 and nothing installs a script
   * over it, which is why this read "one cel" for a long time. But the base cel
   * is not what gets drawn: the class's own collector `0x453310` ignores
   * `obj+0` and picks by its ARGUMENT, calling `0x40e5f0` with cel `0x47f` when
   * it is 0 (`0x45332e`) and `0x47e` when it is 1 (`0x45334a`, which also
   * queues the winch). CITY's frame function calls it once each way, with the
   * player queued between — see the second pass in `walk.ts`'s painter.
   *
   * The art is the confirmation. 1151 is 113x190 and 73% opaque, a back wall;
   * 1150 is 106x314 and 42%, a frame with a hollow middle, a diamond mesh
   * across its lower front and the cable running up out of it.
   */
  car: {
    /** cel `0x47f`, queued by `0x453310(0)` at `0x45332e` — behind the rider */
    back: 1151,
    /** cel `0x47e`, queued by `0x453310(1)` at `0x45334a` — over the rider */
    front: 1150,
    from: "0x453310 — 0x45332e (0x47f) and 0x45334a (0x47e)",
  },
  /** tag 0 — the winch at rest: six frames of 1160 at three ticks, eighteen frames in all */
  idle: { cels: [1160, 1160, 1160, 1160, 1160, 1160], hold: 3, from: "0x477db0 tag 0" },
  /** tag 1 — one beat of wind-up before going down */
  starting: { cels: [1160, 1160, 1160, 1163], hold: 3, from: "0x477db0 tag 1" },
  /** tag 3 — the same before going up, ending on 1161 */
  startingUp: { cels: [1160, 1160, 1160, 1161], hold: 3, from: "0x477db0 tag 3" },
  /** tag 2 — travelling with `+0x28` a frame */
  down: { cels: [1161, 1162, 1163], hold: 3, from: "0x477db0 tag 2" },
  /** tag 4 — travelling with `-0x28` a frame */
  up: { cels: [1163, 1162, 1161], hold: 3, from: "0x477db0 tag 4" },
  /** `mov word ptr [esi+0xe], 0xa` at `0x4533bd` — and so not the player's 12 */
  divisor: 10,
  /**
   * `mov word ptr [esp+8], 0x28` at `0x45351f` (and `0xffd8` at `0x4535d9`) — an
   * impulse of 40 raw into `obj+0xa` through `0x42f8b0`, four pixels a frame
   * added every frame
   */
  speed: 40,
  /** `cmp word ptr [edi+0xa], 6` at `0x453538` — the fastest a car goes down, px a frame */
  maxDown: 6,
  /** `cmp word ptr [edi+0xa], -0xd` at `0x4535f2` — the fastest a car goes up, px a frame */
  maxUp: 13,
  /**
   * How far below the head of its shaft a car stops — `add ecx, 0xc8` at
   * `0x453606`, where `ecx` is the shaft's top and the comparison is against the
   * car's own y. Travel UP runs while `y >= top + 200`, so the last 200 pixels of
   * the rect are not travel at all: they are the room the winch and its cable
   * need. Down has no such margin (`0x453549` tests the bottom outright), which
   * is why a car at rest sits on its landing — a few pixels under it, by the
   * last frame's travel.
   */
  headroom: 200,
  /** `0x40ef30(bank, 9, pos)` — on departure */
  soundStart: 9,
  /** `0x40ef30(bank, 0xa, pos)` — on arrival */
  soundStop: 10,
  from: "0x450dc0 / 0x4533a0 / 0x453470",
} as const;

/** what an elevator is doing — the script's own five tags, named */
export type ElevatorState = "idle" | "starting" | "up" | "down";

/** one placed elevator, and the platform record its car IS */
export interface Elevator {
  /** the car's anchor, where the cage is drawn from */
  x: number;
  y: number;
  /** where the winch hangs: the head of the shaft, and it does not move */
  winchY: number;
  /** the shaft: the surface travels between these two, inclusive */
  top: number;
  bottom: number;
  state: ElevatorState;
  /** engine frames into the current script */
  clock: number;
  /** which way tag 1/3's wind-up is about to send it: +1 down, -1 up */
  dir: 1 | -1;
  /** the car's `obj+0xa`, pixels an engine frame — the impulses build it and the mover spends it */
  vy: number;
  /**
   * The platform the car is: the landing `0x42fb70` claimed at the shaft's
   * bottom — see the block comment. It is a live record in the room's
   * `platforms`, so moving it moves the floor and the rider with it.
   */
  floor: { top: number; bottom: number; left: number; right: number };
}

/** the cel the WINCH is showing — the car is always {@link ELEVATOR.car} */
export function elevatorCel(e: Elevator): number {
  // tag 3, the wind-up before going UP, ends on 1161 where tag 1 ends on 1163
  const a =
    e.state === "starting" && e.dir < 0 ? ELEVATOR.startingUp : ELEVATOR[e.state];
  const i = Math.floor(e.clock / a.hold);
  // the travelling states cycle; idle and the wind-up hold their last cel
  const loop = e.state === "up" || e.state === "down";
  return a.cels[loop ? i % a.cels.length : Math.min(a.cels.length - 1, i)];
}

/** how many engine frames the current script runs for */
export function elevatorFrames(e: Elevator): number {
  return ELEVATOR[e.state].cels.length * ELEVATOR[e.state].hold;
}

/**
 * The swinging girder — `initibeam`, seven of them in CITY and none anywhere
 * else. Creator `0x450ea0`, class `0x453720`, frame `0x4537d0`, script `0x477e60`.
 *
 * Every other placed thing in this level either carries you or fights you. This
 * one does neither: it is a hazard you time, and the code says so by what it
 * LEAVES OUT. There is no `0x42fb70` in its creator — it claims no `platform`, so
 * unlike a plank or a lift car you cannot stand on it — and its frame function
 * opens by pinning it down:
 *
 * ```
 *   obj+0xc = 0 ; obj+0xa = 0     ; no velocity, ever
 *   obj+6 = ctx+0                 ; and put back on its record's point, every frame
 * ```
 *
 * A thing that rewrites its own position from the file on every tick is not going
 * anywhere. What moves is the ART: twelve cels of one red beam seen through its
 * arc, hung from a cable.
 *
 * ## The three tags are the swing
 *
 * ```
 *   0  out    1551 1540 1541 1542 1543   the beam away from you, small and angled
 *   1  across 1544 1545 1546             face-on and full height (108x361) — the pass
 *   2  back   1547 1548 1549 1550 1551   away again on the other side, with sound 7
 * ```
 *
 * The handlers for tags 0 and 1 install the next tag and flip `ctx+6`'s low bit
 * (`0x453835`, `0x45385b`); tag 2's hands back to tag 0 with sound 6 and no flip.
 * A beam with no delay has no script at all on its first frame, and `obj+0x46`
 * starts at 1 (`0x45d07d`), so it goes straight into tag 1 — the pass. `obj+0x1a` is set to 100
 * at the top of every cycle, which in this engine is "live" — the same field the
 * crow resets to stay hittable.
 *
 * ## The stagger is in the file
 *
 * `ctx+4` is a countdown decremented once a frame, and until it reaches zero the
 * frame function returns without touching the state machine; on the frame it hits
 * zero it installs tag 0 and the swing begins. It is loaded once, by the creator,
 * from a word of the record — which is what the `param` of 4 on CITY's `initibeam`
 * at x7656 is for, and why seven beams on one construction site do not swing in
 * lockstep.
 *
 * ## Nothing is unread here
 *
 * `obj+0x46` at every tag boundary is "my script ended", written only by the
 * animation stepper — so each tag simply hands to the next as it finishes, and
 * the beam swings on its own once its delay has run out. See {@link ELEVATOR}.
 */
export const IBEAM = {
  /** tag 0 — swinging away, and where a beam waits out its delay */
  out: { cels: [1551, 1540, 1541, 1542, 1543], hold: 3, from: "0x477e60 tag 0" },
  /** tag 1 — face-on and full height: the frames that can reach you */
  across: { cels: [1544, 1545, 1546], hold: 3, from: "0x477e60 tag 1" },
  /** tag 2 — away on the other side, with `0x40ef30(bank, 7, pos)` */
  back: { cels: [1547, 1548, 1549, 1550, 1551], hold: 3, from: "0x477e60 tag 2" },
  /** `mov word ptr [esi+0xe], 0x14` at `0x453751` — twenty, and it moves nothing */
  divisor: 20,
  /** `0x40ef30(bank, 7, pos)` on entering tag 2 (`0x453873`) */
  sound: 7,
  /** `0x40ef30(bank, 6, pos)` as tag 2 hands back to tag 0 (`0x4538a8`) */
  soundBack: 6,
  /**
   * `mov word ptr [esi], 0x604` at `0x45373d` — the base cel, shown while the
   * beam waits out its delay: the class init installs no script (`0x45d070`
   * only clears one), so nothing draws over it until `0x453800` installs tag 0
   */
  base: 1540,
  /** `mov word ptr [esi+0x1a], 0x64` — live, the crow's own "hittable" field */
  health: 100,
  /** `obj+0x46` is "my script ended" (written only by `0x45d0f0`): each tag hands to the next as it finishes, so it swings on its own */
  from: "0x450ea0 / 0x453720 / 0x4537d0",
} as const;

/** which part of its arc a beam is in — the script's own three tags, named */
export type IbeamState = "out" | "across" | "back";

/** one placed girder, pinned where its record puts it */
export interface Ibeam {
  /** the record's own point, and the frame function rewrites the beam here every tick */
  x: number;
  y: number;
  state: IbeamState;
  /** engine frames into the current tag */
  clock: number;
  /** frames still to wait before the first swing — the record's own stagger */
  delay: number;
  /** `ctx+6`'s low bit, flipped entering tags 1 and 2 */
  side: 0 | 1;
}

/** which cel a girder is showing */
export function ibeamCel(b: Ibeam): number {
  if (b.delay > 0) return IBEAM.base;
  const a = IBEAM[b.state];
  return a.cels[Math.min(a.cels.length - 1, Math.floor(b.clock / a.hold))];
}

/** how many engine frames the current tag runs for */
export function ibeamFrames(b: Ibeam): number {
  return IBEAM[b.state].cels.length * IBEAM[b.state].hold;
}

/**
 * The hydraulic press — `initcrush`, three of them in WOODS and none anywhere
 * else, standing across the only path the level has.
 *
 * Creator `0x450f00`, class `0x454900`, frame function `0x4549b0`, script
 * `0x477ed8`. `woods.snd` names the sound it makes: index 19 is
 * **"0230 hydraulic "**, so the thing is a press and the file says so.
 *
 * It is the simplest machine in the game and the most dangerous. Its whole state
 * machine is nine instructions of dispatch on the script's current tag:
 *
 * ```
 *   4549bb  obj+0xc = 0 ; obj+0xa = 0      it has no velocity, ever
 *   4549c3  obj+6 = ctx[0]                 and is rewritten onto its record's
 *                                          point every single frame
 *   tag 0   4549df  if the PLAYER'S POINT is inside the record's own RECT
 *           4549ff    0x40ef30(woods.snd, 19, pos)
 *           454a14    install tag 1
 *   tag 1   454a21  when the script ends -> tag 2
 *           454a38  obj+0x1a = 0x64        live, every frame
 *   tag 2   454a43  when the script ends -> tag 0
 *           454a5a  obj+0x1a = 0           inert again
 * ```
 *
 * So there is no timer and no stagger — unlike the girder, whose context has room
 * for one. A press fires when you stand under it and goes on firing for as long
 * as you stay. Nineteen engine frames a cycle: fourteen down, four up, one to
 * look.
 *
 * **It never moves.** Every record of its script carries `dx 0, dy 0`, and the
 * position is rewritten from the record anyway. What travels is the drawn ram,
 * 175 pixels from 59 above the record's point to 116 below it, and it does that
 * in three frames — 38, then **103**, then 34.
 *
 * **What hurts is two cels.** Only 4382 and 4383 carry a strike box (and no cel
 * carries a body box, so the press cannot be stood on and cannot be hit — its own
 * hit handler `0x454a70` is `xor ax,ax; ret`). The blow is `dy 5, dx 64`, which
 * `0x42f910` turns into 64 — over the player's own `cmp di, 0x3c` knockdown
 * threshold at `0x449115`, so it does not stagger you, it puts you down. Two
 * frames of the nineteen, after six frames of the head twitching on 4380/4381,
 * which is the warning.
 *
 * Nothing in this port hits the player back yet ({@link file://./walk.ts}), so
 * what is here is the machine and its sound: a press comes down through you and
 * you walk on. The two cels that carry the blow are named below all the same,
 * ready for when it lands.
 */
export const CRUSH = {
  /** tag 0 — up, and watching for you. One cel, and the script sits on it */
  idle: { cels: [4380], hold: 1, from: "0x477ed8 tag 0" },
  /**
   * tag 1 — the stroke. Three twitches on 4380/4381 and then the head comes down
   * through 4382 and 4383, which are the two that carry a strike box, and settles
   * through its own recoil.
   */
  slam: {
    cels: [4380, 4381, 4380, 4381, 4380, 4381, 4382, 4383, 4384, 4385, 4386, 4387, 4388, 4389],
    hold: 1,
    from: "0x477ed8 tag 1",
  },
  /** tag 2 — and back up the way it came */
  lift: { cels: [4384, 4383, 4382, 4381], hold: 1, from: "0x477ed8 tag 2" },
  /** the two cels of the stroke that carry a strike box — `0x430375` tests for one */
  strikeCels: [4382, 4383] as readonly number[],
  /** `0x42f910` of the blow those two carry: `sqrt(5² + 64²)` */
  damage: 64,
  /** `mov word ptr [esi+0xe], 0x14` at `0x454931` — and it moves nothing, so it is dead weight */
  divisor: 20,
  /** `0x40ef30(0x4a7910, 0x13, pos)` at `0x454a04`, on entering the stroke */
  sound: 19,
  /** `mov word ptr [esi+0x1a], 0x64` at `0x454a38` — live only while the stroke runs */
  health: 100,
  from: "0x450f00 / 0x454900 / 0x4549b0",
} as const;

/** which part of its cycle a press is in — the script's own three tags, named */
export type CrushState = "idle" | "slam" | "lift";

/** one placed press, pinned where its record puts it */
export interface Crush {
  /** the record's own point, which `0x4549c3` rewrites the object onto every frame */
  x: number;
  y: number;
  /** the record's own rect — the volume the player's POINT has to be in to set it off */
  top: number;
  left: number;
  bottom: number;
  right: number;
  state: CrushState;
  /** engine frames into the current tag */
  clock: number;
}

/** which cel a press is showing */
export function crushCel(c: Crush): number {
  const a = CRUSH[c.state];
  return a.cels[Math.min(a.cels.length - 1, Math.floor(c.clock / a.hold))];
}

/** how many engine frames the current tag runs for */
export function crushFrames(c: Crush): number {
  return CRUSH[c.state].cels.length * CRUSH[c.state].hold;
}


/**
 * The wall lever — `switch`, six of them down level six and none anywhere else.
 * Creator `0x436020`, class `0x43c210`, think `0x43c2c0`.
 *
 * It is a two-position lever with a throw in each direction, and its script
 * `0x473548` carries all four as tags: 3 is the idle it is created on, 0 the
 * throw up, 1 the loop it rests in once it is on, 2 the throw back down. The
 * think does nothing but pin the object on its record's point, zero its velocity
 * pair, and — when the current tag's script has ENDED — install the next one and,
 * on the two throws, broadcast.
 *
 * ## What it is wired to
 *
 * `0x43c3d0`, at the end of both throws, walks the goop class's own list and for
 * every goop carrying the same `param` does `tag ^= 1` on script `0x473458`,
 * with sound 0x24 at that goop's position. Six switches and twenty-two goop, and
 * SERVICE's params run 501…506 with both halves of each pair carrying the same
 * number. `0x43c430` is the other side of the same call, for a param under 500 —
 * a different class in a different chapter — and no shipped level takes it.
 *
 * ## Who throws it
 *
 * Both the player and the gang, through the same `0x436820(pos, dir)`.
 *
 * - **dir 0 turns it ON.** Only a lever on tag 3 answers: sound 0x4b and the
 *   throw up.
 * - **dir 1 turns it OFF.** Only a lever on tag 1 answers: sound 0x4a and the
 *   throw back.
 *
 * The player reaches it through `0x436690`, the chapter's "what am I standing
 * at" query, which `0x429870` asks twice a frame from the standing state: once
 * with kind 0 when no direction is held, and once with kind 1 when S is. The
 * same query answers for `ladder`, `exitroom` and `exitfarm`, which is what says
 * a switch is operated the way a door is, not the way a punch is. The gang ask
 * for dir 0 and only dir 0 ({@link file://./foes.ts}), so **everything that is
 * not the player turns the goop on.**
 */
export const SWITCH = {
  /** tag 3 — created here, and it loops on this until someone throws it */
  off: { cels: [3264, 3265, 3266], hold: 1, from: "0x473548 tag 3" },
  /** tag 0 — the throw up. At the end of it the goop toggles */
  turningOn: { cels: [3263, 3262, 3262, 3262, 3261], hold: 1, from: "0x473548 tag 0" },
  /** tag 1 — on, and looping */
  on: { cels: [3260, 3267, 3268], hold: 1, from: "0x473548 tag 1" },
  /** tag 2 — the throw back, and the goop toggles again at the end of it */
  turningOff: { cels: [3261, 3262, 3262, 3262, 3263], hold: 1, from: "0x473548 tag 2" },
  /** `0x436895` — the lever going up */
  throwOn: 0x4b,
  /** `0x4368c9` — and coming back down */
  throwOff: 0x4a,
  /** `0x43c3f1` — played once per goop the broadcast reaches, at the GOOP's position */
  toggle: 0x24,
  /** `mov word ptr [esi+0xe], 0xa` at `0x43c22d`, and it never moves */
  divisor: 10,
  from: "0x436020 / 0x43c210 / 0x43c2c0 / 0x436820",
} as const;

/** the four tags of `0x473548`, named */
export type SwitchState = "off" | "turningOn" | "on" | "turningOff";

/** one placed lever, pinned on its record's point */
export interface Switch {
  x: number;
  y: number;
  /** the record's own rect — what the player has to be standing in */
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** the record's `param`, 501…506 — which goop it is wired to */
  param: number;
  state: SwitchState;
  clock: number;
  /**
   * MAZE's `initswitch`: chapter two's lever (think `0x413340`, throw
   * `0x412550`, broadcast `0x413410` to the cage doors). Its throw plays no
   * sound, where `0x436820`'s plays 0x4b / 0x4a.
   */
  maze?: boolean;
}

/** which cel a lever is showing */
export function switchCel(s: Switch): number {
  const a = SWITCH[s.state];
  return a.cels[Math.min(a.cels.length - 1, Math.floor(s.clock / a.hold))];
}

/** how many engine frames the current tag runs for */
export function switchFrames(s: Switch): number {
  return SWITCH[s.state].cels.length * SWITCH[s.state].hold;
}

/**
 * The thing the levers turn on — `initgoop`, twenty-two of them, and what makes
 * level six a level rather than a corridor. Creator `0x435db0`, class
 * `0x437260`, think `0x437310`.
 *
 * One name covers five different objects, and the creator's first argument picks
 * between them. The level file only ever makes the first of them:
 *
 * ```
 *   0x435987   call 0x435db0(-1, point, rect, param)     from the level's records
 * ```
 *
 * A NEGATIVE kind is the **nest**: it keeps the record's rect and param, is given
 * script `0x473458` — whose two tags are one cel 500 each and whose script kind
 * is **3**, which is over the `cmp word ptr [ecx+0x18], 2` the class's draw case
 * tests, so it is never drawn — and sits at region −1 doing nothing until its tag
 * is 1. That is what the lever toggles.
 *
 * ## What a running nest does
 *
 * `0x437502`, once an engine frame, while its tag is 1:
 *
 * ```
 *   0x43750b  0x434540(0x200) < 0x2b            42 chances in 512
 *   0x437531  x = 0x434540(right - left) + left   anywhere across the rect
 *   0x43755a  kind = 0x434540(2) - 1              one of the two strings
 *   0x437565  0x435db0(kind, (top, x), rect, 0)
 * ```
 *
 * So about one drip every twelve frames, from the top edge of the rect, at a
 * random point along it, and half of each kind.
 *
 * ## The two strings
 *
 * Each is a chain of short-lived objects that make the next one and die. Neither
 * of the first links moves — `0x42f850(obj, 0)` — and the falling links are given
 * gravity 1.0, the player's own, so they come down faster than he jumps.
 *
 * ```
 *   bead   500 501 502 503   still     script ends -> a DROP where it hangs, sound 0x1f
 *   drop   504              gravity 1  lands -> gone
 *
 *   strand 510 … 517        still      at cel 517 -> a GOB 70px BELOW it, sound 0x1e
 *   gob    518              gravity 1  lands -> three SPLASHES, and gone
 *   splash 505 506 504      gravity ½  one random shove, then lands -> gone
 * ```
 *
 * ## What it does when it touches something
 *
 * Every goop object carries `obj+0x1a = 0x64` — a blow of exactly 100, restamped
 * each frame by the think's own epilogue — and its own hit handler `0x4375a0` is
 * `xor ax,ax; ret`, so it cannot be hit back. It is a hazard to the player and to
 * the one thing at the end of the level, whose handler has no ignore list at all.
 *
 * To the gang it is **food**. All four of their hit handlers ask whether the
 * thing that hit them belongs to the goop class before anything else, and if it
 * does they add health instead of losing it, clamp to what they started with,
 * play 11 and return: `0x438339` twenty for the third one, `0x438fd9` twenty for
 * the masked one, `0x439a59` **sixty** for the one with the bat, `0x43a659`
 * twenty for the one with the knife. Which, with the gang being the only thing
 * that ever throws a lever on, is the whole design of level six: they turn the
 * showers on to stand under them, and you turn them off.
 */
export const GOOP = {
  /** `0x43750b` — `0x434540(0x200)` comes back 1…512 and 1…42 fires */
  chance: 42 / 512,
  /** kind 0 — the bead gathering, and it hangs where it is */
  bead: { cels: [500, 501, 502, 503], hold: 3, from: "0x473470 tag 0" },
  /** kind 2 — what the bead becomes, falling at gravity 1.0 */
  drop: { cels: [504], hold: 3, from: "0x473470 tag 1" },
  /** kind 1 — the other string's first link, and it hangs too */
  strand: { cels: [510, 511, 512, 513, 514, 515, 516, 517], hold: 3, from: "0x4734b8 tag 0" },
  /** kind 3 — born 70px below the strand at `0x43743a`, falling at gravity 1.0 */
  gob: { cels: [518], hold: 3, from: "0x4734b8 tag 1" },
  /** kind 4 — three of them where a gob lands, at gravity ½ and with a shove */
  splash: { cels: [505, 506, 504], hold: 3, from: "0x473470 tag 2" },
  /** `0x437427`'s `cmp word ptr [esi], 0x205` — the strand's eighth cel is where the gob comes from */
  gobAtCel: 517,
  /** `0x43743a` — `add ax, 0x46` */
  gobBelow: 70,
  /** `0x4374ae`, `0x4374c9`, `0x4374e4` — three calls, one after another */
  splashes: 3,
  /** `0x4373a9`/`0x4373bf` — `rand(200) - 100` across and `rand(80) - 70` up, through the divisor */
  splashShove: { x: [-99, 100] as const, y: [-69, 10] as const },
  /** `mov word ptr [esi+0xe], 0xa` at `0x43727c`, which is what those two are divided by */
  divisor: 10,
  /** `0x435e6e` when a drop is released, `0x435ea4` when a gob is */
  dropSound: 0x1f,
  gobSound: 0x1e,
  /** `mov word ptr [esi+0x1a], 0x64` at `0x437574` — and its own handler takes nothing back */
  damage: 100,
  /** what it adds to each of the gang, and the ceiling it clamps to — their own starting health */
  feeds: {
    initknotboy: 20,
    initmaskboy: 20,
    initbatboy: 60,
    initknifeboy: 20,
  } as Readonly<Record<string, number>>,
  /** the sound each one's handler plays on being fed — not the same one */
  fedSound: {
    initknotboy: 8, // `0x438379`
    initmaskboy: 8, // `0x439019`
    initbatboy: 3, // `0x439a99`
    initknifeboy: 0xb, // `0x43a699`
  } as Readonly<Record<string, number>>,
  from: "0x435db0 / 0x437260 / 0x437310",
} as const;

/** the five objects `initgoop` makes, named by what they look like */
export type GoopKind = "bead" | "drop" | "strand" | "gob" | "splash";

/** one invisible nest, which is what a level's `initgoop` record actually is */
export interface Nest {
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** the record's `param` — the lever that toggles it */
  param: number;
  /** its tag: created 0, and every broadcast flips it */
  on: boolean;
}

/** one link of one string, wherever it has got to */
export interface Drip {
  kind: GoopKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** engine frames into its own script */
  clock: number;
  /** has it already made whatever it makes — the `user+2` latch every branch tests */
  spent?: boolean;
  /** `obj+0x2a` — a gob's strike box has met something, which bursts it (`0x43746a`) */
  hit?: boolean;
  /** `obj+0x2e` — it is down, and the next think lets it go */
  landed?: boolean;
}

/** which cel a drip is showing */
export function dripCel(d: Drip): number {
  const a = GOOP[d.kind];
  return a.cels[Math.min(a.cels.length - 1, Math.floor(d.clock / a.hold))];
}

/** how many engine frames a drip's own script runs for */
export function dripFrames(d: Drip): number {
  return GOOP[d.kind].cels.length * GOOP[d.kind].hold;
}


/**
 * The lock — `door`, five of them down level seven and none in any level before
 * it. Creator `0x435f70`, class `0x43ff30`, think `0x43ffd0`.
 *
 * A door is a **wall that can be taken away**. `0x435ff0`, called from its own
 * creator, appends the record's rect to the engine's obstacle table — the same
 * `0x4a89e2` array every `obstacle` record lives in, counted by `[0x46b9b0]` —
 * so a closed door is solid in exactly the way a wall is. `0x440060`, at the end
 * of the opening animation, takes that entry back out again, and `0x435ff0` runs
 * a second time at the end of the closing one to put it back.
 *
 * Its script `0x473508` is four tags at four frames a cel:
 *
 * ```
 *   tag 1  3350         shut, and resting
 *   tag 2  3351 3352    opening — at the end, the rect leaves the obstacle table
 *   tag 3  (cel 0)      open, and resting: nothing is drawn
 *   tag 0  3352 3351    closing — at the end, the rect goes back in, and 0x25 sounds
 * ```
 *
 * The creator installs **tag 1**, so every door in the level starts shut.
 *
 * ## What opens it
 *
 * `0x43c430(param)`, which is the OTHER half of the switch broadcast — the half
 * a param under 500 takes, where the goop of level six takes the half over it.
 * It walks the door list and for every door whose stored number equals the
 * switch's `param`: a door on tag 1 is given tag 2, a door on tag 3 is given tag
 * 0. So one lever toggles one door, and throwing the lever back shuts it again.
 *
 * The number a door is matched on is `abs(param)` (`0x435fc2`), and the SIGN is
 * its mirror flag at `obj+0x28` — which is to say which way round the frame is
 * drawn, not which way it opens. SEWER's five pairs are 1, 2, 4, 7 and 8, and
 * the doors carrying -1 and -4 are simply the two hung the other way.
 */
export const DOOR = {
  /** tag 1 — shut, and the rect is in the obstacle table */
  shut: { cels: [3350], hold: 4, from: "0x473508 tag 1" },
  /** tag 2 — and at the end of it the rect comes out */
  opening: { cels: [3351, 3352], hold: 4, from: "0x473508 tag 2" },
  /** tag 3 — cel 0, which is nothing at all */
  open: { cels: [0], hold: 4, from: "0x473508 tag 3" },
  /** tag 0 — and at the end of it the rect goes back in, and this sounds */
  closing: { cels: [3352, 3351], hold: 4, from: "0x473508 tag 0" },
  /** `0x44001b` — played as it finishes shutting, and never as it opens */
  shutSound: 0x25,
  from: "0x435f70 / 0x43ff30 / 0x43ffd0 / 0x43c430",
} as const;

/** the four tags of `0x473508`, named */
export type DoorState = "shut" | "opening" | "open" | "closing";

/** one placed door, with the number its lever has to carry */
export interface Door {
  x: number;
  y: number;
  /** the record's own rect — what is solid while it is shut */
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** `abs(param)` — `0x435fc2`, and what `0x43c430` matches on */
  param: number;
  /** `param < 0` — the frame hung the other way round */
  mirror: boolean;
  state: DoorState;
  clock: number;
}

/** which cel a door is showing, or 0 for the open one, which shows none */
export function doorCel(d: Door): number {
  const a = DOOR[d.state];
  return a.cels[Math.min(a.cels.length - 1, Math.floor(d.clock / a.hold))];
}

/** how many engine frames the current tag runs for */
export function doorFrames(d: Door): number {
  return DOOR[d.state].cels.length * DOOR[d.state].hold;
}

/**
 * Chapter two's lift — `initelev`, six of them across the floor of level seven's
 * last room, and **not** chapter four's `initelevator` ({@link ELEVATOR}), which
 * is a different class with a different creator in a different chapter.
 *
 * Where CITY's lift is a cage on a winch that waits to be ridden, this one never
 * stops: `0x43d810` is a five-tag cycle on a script (`0x472578`) whose every
 * frame is the same cel, 3202, so the animation carries nothing and the state is
 * the tag alone.
 *
 * ```
 *   tag 0   nine frames standing still, and then it decides:
 *             is the rect's BOTTOM below me?  yes -> tag 1    no -> tag 3
 *   tag 1   three frames, then tag 2
 *   tag 2   dy +0x28 a frame through the divisor, capped at 6 — going DOWN,
 *           until the bottom is reached, and then tag 0
 *   tag 3   three frames, then tag 4
 *   tag 4   dy -0x28 a frame, capped by the record's own PARAM — going UP,
 *           until the top is reached, and then tag 0
 * ```
 *
 * So it rises, pauses, sinks, pauses, for ever, between its record's own top and
 * bottom. The cap on the way up is the interesting number: `0x43d95d` switches on
 * the param and allows **10, 20 or 40** pixels a frame for 0, 1 and 2, against a
 * flat 6 on the way down. SEWER's six carry 0, 2, 1, 2, 2 and 0, so its lifts
 * rise at 150, 300 and 600 pixels a second and all sink at 90.
 *
 * Like every carrier in this engine it OWNS a `platform` record — `0x435a19`
 * calls `0x42fb70` from the creator — and the level lays one over each of the
 * six, which is what the rider actually stands on.
 */
export const ELEV = {
  /**
   * Every tag is one cel and the script is a clock rather than an animation —
   * but WHICH cel is the chapter's, not the class's.
   *
   * Two chapters spawn `initelev` and each has its own creator installing its
   * own script, identical but for the cel they name: seven records at three
   * ticks, kind 0.
   *
   * ```
   *   0x4353a6 -> 0x435a19 -> 0x472578   cel 3202   chapter two, SEWER's six
   *   0x41e48f -> 0x41f020 -> 0x4703a8   cel 5210   chapter three, CAVERN's four
   * ```
   *
   * Neither creator writes `[obj+0]`, so the script is the whole of it. This page
   * knew only SEWER's number and required it to be in the book, which threw away
   * all four of CAVERN's lifts — and CAVERN's shafts are the only way up out of
   * its second room, so the level could not be finished on foot.
   *
   * Those two books are the only ones with an `initelev` record between them, and
   * each carries exactly the cel its own chapter names.
   */
  cels: [3202, 5210],
  /** what {@link ELEV.cels} was before chapter three's was found */
  cel: 3202,
  /** `0x472578` tag 0 — three records at three frames each */
  waitFrames: 9,
  /** tags 1 and 3 — one record at three frames */
  startFrames: 3,
  /** `0x43d8b1` — the impulse, before the divisor */
  push: 0x28,
  /** `mov word ptr [esi+0xe], 0xa` at `0x43d77d` */
  divisor: 10,
  /** `0x43d8c6` — the cap on the way down, in whole pixels a frame */
  downCap: 6,
  /** `0x43d95d`'s switch on the record's param, in whole pixels a frame */
  upCap: [10, 20, 40] as readonly number[],
  from: "0x4359a0 / 0x43d760 / 0x43d810",
} as const;

/** where in the cycle a lift is — the script's own five tags, named */
export type ElevState = "atBottom" | "startDown" | "down" | "startUp" | "up";

/** one placed lift, with the platform record it carries */
export interface Elev {
  x: number;
  y: number;
  /** the record's rect: the two heights it travels between */
  top: number;
  bottom: number;
  /** the record's `param` — which of {@link ELEV.upCap} it rises at */
  param: number;
  state: ElevState;
  clock: number;
  /** pixels a frame, positive down — `obj+0xa`, and it persists */
  vy: number;
  /** whichever of {@link ELEV.cels} this book carries */
  cel: number;
  /**
   * The `platform` record it claimed — `0x42fb70` from its own creator, and the
   * level lays one over each of the six. A live record in the room's
   * `platforms`, so moving it moves the floor and the rider with it.
   */
  floor?: { top: number; bottom: number; left: number; right: number };
}


/**
 * The shack front — `initshack`, eleven of them down CITY and none anywhere
 * else. Creator `0x4511b0`, class `0x453980`, think `0x453a60`.
 *
 * It is the smallest state machine in the game and the only piece of furniture
 * that reacts to you without being hit: a shutter that rolls up as you come
 * level with it and rolls down again once you have gone.
 *
 * ```
 *   kind 0  cel 1220           shut. the player's POINT inside the record's
 *                              rect installs the opening
 *   kind 1  1221 … 1226        opening; at the end of it, if the player has
 *                              LEFT the rect, the closing goes on
 *   kind 2  1225 … 1221        closing; at the end, back to shut
 * ```
 *
 * Two details worth keeping. The tag is carried across each install
 * (`0x453a98` pushes `obj+0x44` rather than a constant), so a shack's own tag —
 * which its creator takes from the record's `param` — survives the whole cycle
 * and picks which shack it is. And its region is `0xffff`, meaning none, so it
 * draws wherever it stands rather than belonging to a room.
 */
export const SHACK = {
  /** kind 0 — one cel, and it sits on it */
  shut: { cels: [1220], hold: 1, from: "0x4787d8" },
  /** kind 1 — up it goes */
  opening: { cels: [1221, 1222, 1223, 1224, 1225, 1226], hold: 2, from: "0x4787e8" },
  /** kind 2 — and down, one cel shorter, from 1225 back to 1221 */
  closing: { cels: [1225, 1224, 1223, 1222, 1221], hold: 2, from: "0x478820" },
  from: "0x4511b0 / 0x453980 / 0x453a60",
} as const;

/** the three kinds of `0x453a60`, named */
export type ShackState = "shut" | "opening" | "closing";

/** one placed shack front */
export interface Shack {
  x: number;
  y: number;
  /** the record's own rect — what the player's point has to be inside */
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** the record's `param`, which the creator writes into `obj+0x28` */
  mirror: boolean;
  state: ShackState;
  clock: number;
}

/** which cel a shack is showing */
export function shackCel(k: Shack): number {
  const a = SHACK[k.state];
  return a.cels[Math.min(a.cels.length - 1, Math.floor(k.clock / a.hold))];
}

/** how many engine frames the current kind runs for */
export function shackFrames(k: Shack): number {
  return SHACK[k.state].cels.length * SHACK[k.state].hold;
}

/**
 * The floating barrel — `initbarrel`, five down level seven's sewer and three
 * more in level fourteen. Creator `0x435d20`, class `0x43fb60`, think
 * `0x43fc30`.
 *
 * **It cannot be hit** — `0x43fe70` is `xor ax,ax; ret` — and it OWNS a platform:
 * `0x435d6e` calls `0x42fb70` whenever the record's `param` is not negative, and
 * the level lays a `platform` over each of them. So a barrel is a thing you
 * stand on that will not stay still.
 *
 * Its bob is in the script rather than in the class. `0x473330` is eight frames
 * at two engine frames each carrying `dx 22, dy 20` on the way down and
 * `dx -10, dy -20` on the way back — IMPULSES, through `0x42f8b0`, into a body
 * with no gravity and no drag (`0x43fbaf`, `0x43fbba`). The vertical ones cancel
 * over a cycle; the horizontal ones do not (+3 +3 −1 −1 −1 −1 +3 +3), so a barrel
 * drifts, and the think (`0x43fc30`) holds it:
 *
 * ```
 *   43fc39  a positive param is a delay: count it down with no script at all,
 *           then start the bob with ctx+0xc = -40
 *   43fc71  it bounced off something last frame (obj+0x2c): turn round — which
 *           flips the sign of every dx the script adds
 *   43fc7c  its horizontal speed held within ±7
 *   43fc9a  its y kept inside the record's rect: above the top, top+3; below
 *           the bottom, bottom-3
 * ```
 *
 * So it floats back and forth across its pool at up to seven pixels a frame,
 * turning at whatever wall stops it. And half of them SINK (`0x435d91`: ctx+0xe
 * is a roll of 0 or 1): stood on — the player's x strictly inside the record's
 * rect carried with the barrel, their point above it by less than 150 — the
 * counter climbs; at −10 the barrel wobbles (`0x473378` tag 2), and at −2 it
 * goes under (tag 1: ten down and ten along a frame for eight frames), and comes
 * back up at its own point's height with the counter at −40.
 */
export const BARREL = {
  /** `0x473330` tag 0 — the wallow, and the stride is the animation's own */
  bob: {
    cels: [3180, 3181, 3182, 3183, 3184, 3183, 3182, 3181],
    hold: 2,
    dx: [22, 0, 0, -10, -10, 0, 0, 22],
    dy: [20, 0, 0, -20, -20, 0, 0, 20],
    from: "0x473330 tag 0",
  },
  /** `0x473378` tag 2 — the wobble before it goes under: the bob twice at one frame a cel */
  wobble: {
    cels: [3180, 3181, 3182, 3183, 3184, 3183, 3182, 3181, 3180, 3181, 3182, 3183, 3184, 3183, 3182, 3181],
    hold: 1,
    dx: [22, 0, 0, -10, -10, 0, 0, 22, 22, 0, 0, -10, -10, 0, 0, 22],
    dy: [20, 0, 0, -20, -20, 0, 0, 20, 20, 0, 0, -20, -20, 0, 0, 20],
    from: "0x473378 tag 2",
  },
  /** `0x473378` tag 1 — going under */
  sink: {
    cels: [3185, 3186, 3187, 3188, 3189, 3190, 3191, 3192],
    hold: 1,
    dx: [0, 0, 0, 0, 0, 0, 0, 0],
    dy: [0, 0, 0, 0, 0, 0, 0, 0],
    from: "0x473378 tag 1",
  },
  /** `mov word ptr [esi+0xe], 0xa` at `0x43fb7b` */
  divisor: 10,
  /** `0x43fc80` / `0x43fc8e` — the horizontal velocity is held inside this */
  drift: 7,
  /** `0x43fca6` / `0x43fcb5` — the y it is put back to, this far inside its rect */
  inset: 3,
  /** `0x43fc5b` / `0x43fe1e` — the counter the bob starts on */
  rest: -40,
  /** `0x43fd49` — stood on until the counter passes this, it wobbles */
  wobbleAt: -10,
  /** `0x43fe11` — and past this, it goes under */
  sinkAt: -2,
  /** `0x43fd32` — how far above it the player's point may be and still be on it */
  reach: 150,
  /** `0x43fd99`..`0x43fdab` — going under, pixels a frame down and along */
  sinkStep: 10,
  from: "0x435d20 / 0x43fb60 / 0x43fc30",
} as const;

/** one floating barrel, with the platform it claimed */
export interface Barrel {
  x: number;
  y: number;
  /** the record's own point, which going under brings it back to (`0x43fdba`) */
  homeX: number;
  homeY: number;
  /** the record's rect: it keeps the barrel's y, and — carried with it — says who is on it */
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** engine frames — the tick-level clock the step reads frames from */
  clock: number;
  /** engine frames into the current script */
  aclock: number;
  /** `ctx+0xc`: the delay while positive, then the stood-on counter */
  wait: number;
  /** `ctx+0xe` — whether this one sinks */
  sinker: boolean;
  /** which script it shows; "none" while its delay runs */
  tag: "none" | "bob" | "wobble" | "sink";
  vx: number;
  vy: number;
  /** `obj+0x28` */
  mirror: boolean;
  /** `obj+0x2c` — it hit something last frame */
  bounced: boolean;
  floor?: { top: number; bottom: number; left: number; right: number };
}

/**
 * The outfall — `initpipe`, four of them in level seven. Creator `0x436090`,
 * class `0x440160`, hit `0x440400`.
 *
 * One record makes **two** objects. The first is the pipe's mouth, cel 3400 from
 * the class and the three tags of `0x4735d0` after it; the second is built by
 * hand at `0x4360dc` with `0x42f610`, given cel `0xdca` — 3530 — and the five
 * tags of `0x473608`, which is what pours out of it. The record's `param` sign
 * becomes `obj+0x28`, so a pipe can face either way, and its hit handler is
 * `xor ax,ax; ret`: it is plumbing, and nothing can break it.
 */
export const PIPE = {
  /** `0x4735d0` — the mouth, and its two open states */
  mouth: { cels: [3400], hold: 2, from: "0x4735d0 tag 0" },
  /** `0x473608` tag 1 — what comes out, five cels at three frames each */
  flow: { cels: [3531, 3532, 3533, 3534, 3535], hold: 3, from: "0x473608 tag 1" },
  from: "0x436090 / 0x440160 / 0x440400",
} as const;

/** one placed outfall: a mouth and the thing pouring from it */
export interface Pipe {
  x: number;
  y: number;
  mirror: boolean;
  clock: number;
}

/**
 * The water you should not be standing in — `initsewage`, three of them in level
 * seven. Creator `0x436150`, class `0x440460`, think `0x4404c0`.
 *
 * It has no art at all: its class writes cel **0** and no hit handler, and the
 * creator keeps nothing but the record's rect. What it is, is the only thing in
 * the game that hurts you for being somewhere rather than for touching you:
 *
 * ```
 *   0x4404cf  0x434200(player's point, the rect)     are you in it?
 *   0x4404e1  if the player's vY > 5                  0x27 — the splash
 *   0x4404fb  a counter at user+8 counts DOWN
 *   0x44050b  when it passes zero: 0x26, and reset to 8
 *   0x440529  0x402ac0(0xa)                           and ten health, every frame
 * ```
 *
 * Ten a frame is a hundred and fifty a second, which against the middle
 * difficulty's 1200 is eight seconds of wading. Behind the damage switch like
 * everything else that hits back.
 */
export const SEWAGE = {
  /** `push 0xa` at `0x440529`, spent once per engine frame you are inside */
  perFrame: 10,
  /** `0x4404e1` — `cmp word ptr [eax+0xa], 5`, the velocity that makes a splash */
  splashAbove: 5,
  /** `0x4404ec` going in fast, `0x440514` every ninth frame you stay */
  splash: 0x27,
  gulp: 0x26,
  /** `mov word ptr [esi+8], 8` at `0x440520` */
  gulpEvery: 8,
  from: "0x436150 / 0x440460 / 0x4404c0",
} as const;

/** one pool of it, which is a rect and nothing else */
export interface Sewage {
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** `user+8` — frames until the next gulp */
  clock: number;
}

/**
 * The thing in the water — `initbush`, eight of them along the floor of level
 * seven's last hall. Creator `0x435b00` into `0x435ba0`, class `0x43ebf0`, think
 * `0x43ec80`, hit `0x43f170`.
 *
 * The name is the file's, not a description. It has a 58-byte instance struct
 * and a brain table, five animations, and a hit handler that is `xor ax,ax; ret`
 * — so it cannot be killed, is not in the census, and is not furniture either.
 * What this page draws is the state it is in when nothing has happened to it:
 * `0x472b70`, six cels at one frame each, hanging **eighty pixels below** the
 * record's point (`0x435bf7 add word ptr [edi+6], 0x50`) and facing whichever
 * way `0x434540(2)` came out at creation.
 *
 * The two constants that matter are `0x43ee9d` and `0x43eedb`, which write
 * **-3** and **-5** into `obj+0x1a` — and a negative strength is not damage, it
 * is a code. The one other place a negative shows up is `0x43d25c`, where level
 * seven's big one swallows a blow of exactly -6. So these are grabs, and the
 * handler that reads them is the player's.
 *
 * A record whose `param` is 1 is TWO objects (`0x435b30` calls `0x435ba0`
 * twice): the bush, and a second one of the same class with `user+8 = 1` and
 * the first in `user+0x14`. That one sits on its partner, turns to face you
 * (`0x43eda4`), and from three hundred pixels lashes out — see
 * {@link BUSH.lash}. Three of SEWER's eight carry it.
 */
export const BUSH = {
  /** `0x472b70` tag 0 — what it does while it is waiting */
  idle: { cels: [5060, 5061, 5062, 5063, 5064, 5065], hold: 1, from: "0x472b70 tag 0" },
  /**
   * `0x472c20` tag 0 — the thirteen cels of it coming up, and the last SEVEN
   * are the grab.
   *
   * 5020..5025 carry no strike box at all; 5026..5032 each carry a big one and
   * no blow pair, which is the grip signature the hand and the claw have. So it
   * breaks the water harmlessly and closes on you, and the frame it closes is
   * the frame it has you.
   */
  rise: {
    cels: [5020, 5021, 5022, 5023, 5024, 5025, 5026, 5027, 5028, 5029, 5030, 5031, 5032],
    hold: 1,
    from: "0x472c20 tag 0",
  },
  /**
   * What starts it — `0x43ecf3` and `0x43ed0c`, both absolute differences:
   * within seventy pixels across and three hundred down.
   */
  nearPx: 0x46,
  dropPx: 0x12c,
  /**
   * `0x43ed19` — and `0x43ef17`'s 0x2a is what it plays, every frame, once it
   * has closed on a player who is no longer alive (`0x402f60` answering 0)
   */
  sound: 0x27,
  sinkSound: 0x2a,
  /**
   * `0x43ed41`: waiting with nobody near, it counts `AI+0xa` down, and on the
   * frame it is found already below zero it plays 0x28, reseeds the wait at
   * `roll(40)+10`, puts itself thirty below the top of its travel (`0x43ed8a`:
   * `obj+6`, the Y, is `user+0x10 + 0x1e`) and PEEKS — `0x472c90` tag 1.
   */
  homeSound: 0x28,
  peekDy: 0x1e,
  /**
   * The peek, the same state as the grab (both scripts are kind 1) on its other
   * two tags, two ticks a cel. Tag 1 (`0x43ef7c`) comes up three a frame while
   * the top of its travel is above it; its end installs tag 2 (`0x43efbc`), which
   * goes down three a frame until it is thirty under the top and then drops to
   * the bottom and idles. Both edge six a frame toward the player's x.
   */
  peek: {
    up: { cels: [5040, 5041, 5042, 5043, 5044, 5045, 5046], hold: 2, from: "0x472c90 tag 1" },
    down: { cels: [5046, 5045, 5044, 5043, 5042, 5041, 5040], hold: 2, from: "0x472c90 tag 2" },
    stepPx: 3,
    chasePx: 6,
  },
  /**
   * The partner's attack. Its idle (`0x43ed9b`) sits on the bush's point; with
   * the player within `0x12c` across, the bush idle, the wait run out and the
   * player free and alive (`0x402f00`, `0x402f60`), it reseeds the wait, plays
   * 0x29 and installs `0x472ba8` on itself — the eleven-cel tentacle, 3820..3831,
   * whose last cel carries the grip — and `0x472c08` tag 0 on the bush, which
   * rises ten a frame to the top of its travel on cel 5023 (`0x43f0b0`).
   *
   * While it lashes it holds `obj+0x1a = -3` and rides ten above the bush
   * (`0x43f10e`); at its end it idles and sends the bush `0x472c08` tag 1 (cel
   * 5020), ten a frame back to the bottom (`0x43f0d0`). A player within fifty of
   * a bush on either tag is grabbed the ordinary way (`0x43f04d`).
   */
  lash: {
    cels: [3820, 3821, 3822, 3823, 3824, 3825, 3826, 3827, 3828, 3830, 3831],
    hold: 2,
    nearPx: 0x12c,
    sound: 0x29,
    above: 0xa,
    from: "0x472ba8",
  },
  lift: {
    up: 5023,
    down: 5020,
    stepPx: 0xa,
    grabPx: 0x32,
    from: "0x472c08 tags 0 and 1",
  },
  /**
   * It sends TWO codes, one after the other, and which one is a three-state
   * latch at `user+0xe` rather than anything about the player's health.
   *
   * ```
   *   43ee9d  (0)  [obj+0x1a] = -3           ; the grab
   *   43eea3  (0)  [obj+8] = player.x        ; and it slides under you
   *   43eeb0  (0)  0x402f00 != 0 -> stay     ; the player is still FREE
   *   43eec9  (0)  user+0xe = 1              ; ...it has you
   *   43eedb  (1)  0x402f60 != 0 -> [obj+0x1a] = -5
   *   43eee1  (1)  cel >= 0x13a6 -> user+0xe = 2
   *   43eefa  (2)  0x402f60 != 0 -> [obj+0x1a] = -5
   * ```
   *
   * `0x402f00` returns 0 when the player's kind is 10, 9, 0x18 or 0xd — held,
   * knocked down, or freshly spawned — so the latch moves on **the frame after
   * the grab takes**. And `0x402f60` returns 1 while the player's kind is under
   * 0x1a, which is ALIVE, not dying: this page had that one backwards and
   * recorded -5 as "what it gives a player who is already dying".
   *
   * So the bush grabs you for about a frame and then slumps you: -3 holds, -5 is
   * `0x42e8b3`'s half-gravity drop and holds nothing. The held cels 4570..4572
   * carry a body box — unlike every knockdown cel in the book — which is what
   * lets the second blow land on a player the first one is still holding.
   */
  grab: -3,
  slump: -5,
  /**
   * It moves, and BOTH ways — `0x43ef31` is one test with two arms.
   *
   * ```
   *   43ef31  cmp [obj+0x46], 0        ; has the script ended?
   *   43ef65  (no)  if ([user+0x10] >= y) nothing else y -= 0x28
   *   43ef4a  (yes) if ([user+0x10] + 0x50 >= y) y += 0xa else 0x43f007
   * ```
   *
   * `[user+0x10]` is the TOP of its travel and `+0x50` the bottom, which is
   * where `0x435bf7` put it. So it climbs forty a frame while its thirteen cels
   * play, and once they have run out it goes back down ten a frame — **whether
   * or not it still has hold of you**, which is the whole of how a grab ends: it
   * takes you under with it, and at the bottom `0x43f007` installs `0x472b70`,
   * whose six cels carry no strike box at all.
   *
   * This page had it waiting for the player to be released before it would sink,
   * and the player waiting for the bush's cel to stop gripping before being
   * released. Two things each waiting for the other is a level you cannot walk
   * through: SEWER's entrance bush held you at x1964 for ever.
   */
  risePerFrame: 0x28,
  sinkPerFrame: 0xa,
  sinkBelow: 0x50,
  /**
   * `0x43eee1`'s `cmp word ptr [esi], 0x13a6` — the CEL ID, 5030, and what it
   * ends is the sliding rather than the rise: `0x43eea3` snaps the bush to the
   * player's x, and it is in sub-state 0 only. Reaching 5030 moves the sub-state
   * on and the bush stops following.
   */
  holdsAt: 5030,
  /**
   * `0x435bf7` — the object hangs this far below the record's point.
   *
   * On SEWER's hall bushes that is y 17321 against a floor at 17513, and it read
   * for a while as though the bush stood ~190px too high to reach anybody. It
   * did not: every prop's strike box was being lifted by `height - posY`, which
   * is sixty-four on cel 5030. `0x40e680` translates the rect by `obj+6` and
   * does nothing else — see `strikeOf` in `walk.ts`.
   */
  below: 0x50,
  /** `mov word ptr [esi+0xe], 0xa` at `0x43ec10` */
  divisor: 10,
  from: "0x435b00 / 0x43ebf0 / 0x43ec80 / 0x43f170",
} as const;

/** one of them, hanging where its record put it */
export interface Bush {
  x: number;
  y: number;
  mirror: boolean;
  clock: number;
  /** `user+0xe` — 0 reaching, 1 it has you, 2 it is closed. See {@link BUSH.grab} */
  phase: 0 | 1 | 2;
  /**
   * Where in `0x43ec80` it is — and there are THREE, not four. "hold" was this
   * page's own: the engine has the script running or the script ended, and the
   * moment it ends the thing starts sinking. See {@link BUSH.risePerFrame}.
   */
  state:
    | "idle"
    | "rise"
    | "sink"
    /** kind 1 tags 1 and 2 — see {@link BUSH.peek} */
    | "peekUp"
    | "peekDown"
    /** kind 2 tags 0 and 1, the bush lifted for its partner's lash */
    | "liftUp"
    | "liftDown"
    /** kind 4 — the partner's lash */
    | "lash";
  /** the y it came up from, which is where it goes back to */
  restY: number;
  /** `user+0x10` — the record's point y, the TOP of its travel */
  top: number;
  /**
   * `user+2` and `user+6` — the record rect's x extent, which `0x43f017` holds
   * the object inside after every move of the rise, the sink and the peek
   */
  left: number;
  right: number;
  /** `AI+0xa` — the idle wait, `roll(5)+10` at birth (`0x435c38`) */
  wait: number;
  /** `user+8` — 0 the bush, 1 the partner a `param` 1 record adds */
  variant: 0 | 1;
  /** `user+0x14` — the bush a partner sits on */
  partner?: Bush;
}

/**
 * The roach nest and what comes out of it — `initroachmotel`, two of them in
 * level five. Creator `0x436500`, class `0x43b0b0`, think `0x43b160`.
 *
 * One name and two objects again, and which one you get is the creator's first
 * argument. **The level's spawner hardcodes it**: `0x43578f` pushes `-1` rather
 * than the record's `param`, so every `initroachmotel` record in the game is a
 * NEST — invisible, sitting at the record's point, with `obj+0x18 = 2`.
 *
 * `0x43b3a4` is the whole of a nest, and it only runs while the player's point
 * is inside the record's rect:
 *
 * ```
 *   a counter at user+2 climbs one a frame
 *   past -2 it makes a roach at the nest's own position, and counts it
 *   under four: the next gap is 0x434540(8) - 8, one to eight frames
 *   at four:    the gap is -35, and the count starts again
 * ```
 *
 * So: four roaches in a rush, then a little over two seconds of nothing.
 *
 * A roach is the same class with a `param` of zero. It falls on cel 3300 —
 * `0x43b17f` waits for the ground before doing anything at all — and then runs
 * the six cels of `0x474db0` with a coin-flip facing and a gravity of 0.6. It
 * removes itself the moment its own point leaves the rect it was born in
 * (`0x43b1e8`), which is what keeps them in the room. `0x474de8` is the squash,
 * two cels of 3406, and its own hit handler `0x43b450` is not here.
 */
export const ROACH = {
  /** `mov word ptr [ecx], 0xce4` at `0x43b0e0` — what it falls on */
  drop: { cels: [3300], hold: 1, from: "0x43b0e0" },
  /** `0x474db0` tag 0 — the run, four cels and a stride on every one of them */
  run: { cels: [3400, 3401, 3402, 3405], hold: 1, dx: [65, 65, 65, 65], from: "0x474db0 tag 0" },
  /** tag 1 — the leap, one frame of `dx 65, dy -150`; not driven here */
  leap: { cels: [3400], hold: 1, dx: [65], from: "0x474db0 tag 1" },
  /** `0x474de8` tag 0 — flattened */
  squash: { cels: [3406, 3407, 3407], hold: 2, from: "0x474de8 tag 0" },
  /** `mov word ptr [ecx+0xe], 0xa` at `0x43b0cc` */
  divisor: 10,
  /** `0x43b1be` — `0x42f850(obj, 0.6f)`, six tenths of the player's own */
  gravity: 0.6,
  /** `0x43b3f3` — how many come out in one rush */
  burst: 4,
  /** `0x43b3f9` — `0x434540(8) - 8`, the gap inside a rush */
  gapIn: 8,
  /** `mov word ptr [ebx+2], 0xffdd` at `0x43b417` — and the gap between rushes */
  gapOut: 35,
  /** `0x43b2d4` as one starts running, `0x43b2ff` as one is squashed */
  runSound: 1,
  squashSound: 0,
  from: "0x436500 / 0x43b0b0 / 0x43b160",
} as const;

/** one nest, which is a point and a rect and nothing you can see */
export interface Nest2 {
  x: number;
  y: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** `user+2` — counts up to -2 and then lets one out */
  clock: number;
  /** `user+4` — how many of the four are out */
  made: number;
}

/** one roach, which lives only while it is inside the rect it came from */
export interface Roach {
  x: number;
  y: number;
  vy: number;
  /** `obj+0x28` — set, and it runs west on its cels reflected (`0x43b11c`) */
  facing: number;
  onGround: boolean;
  /** off cel 3300 and onto the run — `0x43b17f` does it on the first landing */
  running: boolean;
  clock: number;
  /** the nest's rect, which is also its leash */
  top: number;
  left: number;
  bottom: number;
  right: number;
}


/**
 * The seven places water comes out of — `initsprinkler`, seven of them in level
 * eight and nowhere else. Reader `0x440800`, class `0x440870`, hit `0x440a80`.
 *
 * **A sprinkler record is not an object.** `0x440800` does not create anything:
 * it walks the seven records and files each one's POINT into a seven-entry table
 * at `0x4a7000`, indexed by the record's own `param` — which is why ARCADE's
 * seven carry 0 through 6 and no two share a number.
 *
 * What comes up out of one is made later, by the boss. `0x441b95` allocates a
 * four-byte context — `{350, index}` — hands it to the class, and marks the slot
 * taken at `0x473728 + index*4`; the class's first message reads the point back
 * out of the table and stands the column there. The column's own script is
 * `0x473748`: seven cels rising, a spray that loops on two, and the same seven
 * to go back down.
 *
 * And the trigger is the neatest part of level eight. `0x441b20` asks
 * `0x40b660("initsprinkler", the boss, ...)` — which record's rect contains the
 * BOSS's own point — and `0x441b60` raises that one, or, if it is already up,
 * rolls `0x434540(7)` for a free one and tries up to seven times. So the thing
 * you are fighting turns on the water it is standing over.
 *
 * ...and what puts the boss there is a FLARE, not a dive. `0x441b60`'s one
 * caller is `0x4415bd`, inside kragg's state 9, and `0x441d30` is what installs
 * that state: a blow whose strength is exactly −9. `0x43ac04` is what makes a
 * flare carry one — and only while `[0x4abdfc]` is **5**, which by
 * `SkullSave.stage`'s own arithmetic is the FOURTH level of a chapter. ARCADE
 * is level 8, so it is stage 5, so the one level with sprinklers in it is one
 * of the four where a flare is a code rather than a hundred.
 *
 * That arm returns at `0x441d94` before any damage is computed, so burning the
 * boss costs it nothing and raises the water instead — `raiseSprinkler` in
 * {@link file://./walk.ts}. Two things are still not done: the thrash itself
 * (five tags, and the drag toward a point 120 below the record), and the
 * general form of the −9, which on stages 5 makes the flare a code against
 * every class and not only against kragg.
 */
export const SPRINKLER = {
  /** `0x473748` tag 0 — up it comes */
  rise: { cels: [150, 151, 152, 153, 154, 155, 156], hold: 2, from: "0x473748 tag 0" },
  /** tag 1 — and this is what it does while it is up, looping (`0x440a0d`) */
  spray: { cels: [157, 158, 157, 158, 156, 157, 158, 157, 158, 156, 157, 156], hold: 2, from: "0x473748 tag 1" },
  /**
   * tags 2 and 3 — going: `0x4409b7` installs tag 2 the frame the count runs
   * out, its end installs tag 3 (`0x440a31`), and tag 3's end frees the object
   * (`0x440a4e`)
   */
  sink: { cels: [150, 151, 152, 153, 154, 155, 154, 155], hold: 2, from: "0x473748 tags 2, 3" },
  /**
   * `mov word ptr [eax], 0x15e` at `0x441ba3` — the context's own first word,
   * counted down one a frame from the column's creation (`0x4409ac`), rise
   * included
   */
  life: 350,
  /**
   * `mov di, 7` at `0x441b68` — how many slots there are, and how many tries.
   * A slot is marked taken at `0x441bb5` and nothing ever clears it: each
   * sprinkler goes up once a level, and the boss is scalded in its rect from
   * then on, water or no water (`0x440bb0`).
   */
  slots: 7,
  from: "0x440800 / 0x440870 / 0x441b20 / 0x441b60",
} as const;

/** one of the seven, as the table keeps it: a point and the index that names it */
export interface Sprinkler {
  x: number;
  y: number;
  /** the record's `param`, which is its slot in `0x4a7000` */
  slot: number;
  /** the record's rect — what the boss has to be standing in to send it up */
  top: number;
  left: number;
  bottom: number;
  right: number;
}


/**
 * The things you walk over — `stat*`, a hundred and forty records across the
 * sixteen levels and every one of them placed by the same creator.
 *
 * Creator `0x45b160`, class `0x45ada0`, collector `0x45b270`, remover
 * `0x45b3a0`, and the effects in the player's own think at `0x42827a`.
 *
 * ## One creator, nine codes
 *
 * Each chapter's init reads its own list of names and hands `0x45b160` a
 * NEGATIVE code for each one. `0x45b19a` dispatches on `code + 9`, so the nine
 * are −9 to −1, and each picks a cel and a script:
 *
 * ```
 *   -1  stathealth     19040 … 19043   four cels, three frames each
 *   -2  statlife       19000 … 19007   eight, two each
 *   -3  statpunch      18000           ...which is in no shipped book
 *   -4  statscoreup 2  20340 … 20354   0x478c60 tag 2
 *   -5  statscoreup 1  20320 … 20334   tag 1
 *   -6  statscoreup 0  19060 … 19074   tag 0
 *   -7  statshield     18062           ...also in no shipped book
 *   -8  stattimer      19080 … 19083   six frames, two each, and it bounces back
 *   -9  (unnamed)      19100 … 19129   thirty cels at one frame
 * ```
 *
 * `statscoreup` is one name and three pickups: `0x451420` switches on the
 * RECORD's own `param` and hands −6, −5 or −4 accordingly, which is why the
 * eleven levels that place one place it with a param.
 *
 * All of it is drawn from `PLAYER.SBK`, not from the level's book — which is
 * what lets one table cover every level. The two that are not there are the two
 * nothing places: no book in the rip has 18000 or 18062, and no level record
 * carries `statpunch` or `statshield`.
 *
 * ## Walking over one is all it takes
 *
 * `0x45b270` is called from the player's own think every frame. It takes the
 * player's current cel, walks the list, and for each pickup whose code is
 * negative does two tests: `0x434140` for a rect overlap, and then `0x40e680`,
 * which is the **pixel-perfect** one — both cels, both positions, both mirror
 * flags. No button, no facing, no range band. The first pickup to pass both is
 * the one taken, and the walk stops there (`0x45b38b`).
 *
 * ## What each one does
 *
 * `0x42827a`'s table, and the sounds all come out of the CHARACTER's bank
 * (`0x4ac3e0`, `skulz.snd`) rather than the level's:
 *
 * ```
 *   -1  0x402b20(0x190)         four hundred health            sound 0xa
 *   -2  0x40d400(lives + 1)     one life, and 0x40d400 caps five  0xb
 *   -3  [0x46b1ac] = 1          a flag, and nothing places it     0xc
 *   -4  0x40d450(0x2710)        ten thousand points               0xd
 *   -5  0x40d450(0x1388)        five thousand                     0xd
 *   -6  0x40d450(0x7d0)         two thousand                      0xd
 *   -7  (nothing at all)                                          0xc
 *   -8  0x40d350(-850)          eight hundred and fifty on the clock  0xa
 *   -9  0x4282c8               walks the level's `initplayer` records for the
 *                              one whose rect holds it and stores that index at
 *                              [0x4ac38a] — a CHECKPOINT                0xe
 * ```
 */
export const PICKUP = {
  /** by code: what it is called, what it shows, and how fast */
  kinds: {
    "-1": { name: "stathealth", cels: [19040, 19041, 19042, 19043], hold: 3, sound: 0xa, from: "0x478c38" },
    "-2": { name: "statlife", cels: [19000, 19001, 19002, 19003, 19004, 19005, 19006, 19007], hold: 2, sound: 0xb, from: "0x478bf0" },
    "-4": { name: "statscoreup", cels: [20340, 20341, 20342, 20343, 20344, 20345, 20346, 20347, 20348, 20349, 20350, 20351, 20352, 20353, 20354], hold: 1, sound: 0xd, from: "0x478c60 tag 2" },
    "-5": { name: "statscoreup", cels: [20320, 20321, 20322, 20323, 20324, 20325, 20326, 20327, 20328, 20329, 20330, 20331, 20332, 20333, 20334], hold: 1, sound: 0xd, from: "0x478c60 tag 1" },
    "-6": { name: "statscoreup", cels: [19060, 19061, 19062, 19063, 19064, 19065, 19066, 19067, 19068, 19069, 19070, 19071, 19072, 19073, 19074], hold: 1, sound: 0xd, from: "0x478c60 tag 0" },
    "-8": { name: "stattimer", cels: [19080, 19081, 19082, 19083, 19082, 19081], hold: 2, sound: 0xa, from: "0x478ef0" },
  } as Readonly<Record<string, { name: string; cels: readonly number[]; hold: number; sound: number; from: string }>>,
  /** `push 0x190` at `0x42844e`, spent through `0x402b20` */
  health: 400,
  /** `0x40d400` clamps to five, which is what the panel's five lamps are */
  maxLives: 5,
  /** `0x40d450`'s three arguments, by code */
  score: { "-4": 10000, "-5": 5000, "-6": 2000 } as Readonly<Record<string, number>>,
  /** `push 0xfffffcae` at `0x42834f` — negative, into a routine that subtracts */
  clock: 850,
  from: "0x45b160 / 0x45ada0 / 0x45b270 / 0x42827a",
} as const;

/** one placed pickup, wherever its record put it */
export interface Pickup {
  /** the code its chapter's init handed the creator, −9 … −1 */
  code: string;
  x: number;
  y: number;
  /**
   * The record's own rect, which is what the reach is measured against:
   * `0x45b2ca` hands `0x434140` the pickup's `user+4`, and `0x45b23b` is where
   * the creator put the record's two corners. The art is drawn from the point
   * and is not what you touch.
   */
  top: number;
  left: number;
  bottom: number;
  right: number;
  clock: number;
}

/**
 * A HOLE IN THE GROUND, and the only thing in the game that kills you without
 * hitting you — `initgrave`, five of them in level nine. Creator `0x41f0e0`,
 * class `0x420f90`, think `0x421040`.
 *
 * It has no health, no hit handler and no blow. What it has is three states and
 * a hundred pixels:
 *
 * ```
 *   shut   0x4704d0 tag 0, cel 3310   the slab. Stand ON it and 0x4210bd
 *                                     shoves you back off by the width of its
 *                                     own rect, with `0136 grave pull`
 *   near   0x4704d0 tag 1             your x has come within 100 of its. If it
 *                                     is still within 100 next frame, 0x4211af
 *                                     halves your horizontal velocity and
 *                                     0x4211c4 adds one to your fall — ONCE —
 *                                     with sound 3 if you are 50 below its point,
 *                                     and it opens; if not, it is shut again
 *   open   0x4704e8 kind 1, 3310..3319 ten frames, and only in these can it
 *                                     take you
 *   held   0x470540 kind 2, cel 3319  the hole, standing open, with a lid laid
 *                                     across it (`0x4212bb`) — and kind 2 has
 *                                     no handler at all (`0x42105c`)
 * ```
 *
 * `0x42120c`, in the ten opening frames: once the player is **86 pixels below the
 * grave's own point**, and not already dying (`0x402f60`: player kind under
 * 0x1a), `0x402fa0(5)` — the same call that ends the player anywhere else — and
 * sound 0x31. There is no health subtraction anywhere in the class. You do not
 * get hurt by a grave, you fall into it while it opens, and once it has opened
 * its lid carries you over.
 */
export const HOLE = {
  /** `0x420fb4` — the slab, before anything has happened to it */
  shut: 3310,
  /** `0x4704e8` tag 0 — ten cels, one engine frame each, and it does not loop */
  opening: { cels: [3310, 3311, 3312, 3313, 3314, 3315, 3316, 3317, 3318, 3319], hold: 1, from: "0x4704e8 tag 0" },
  /** `0x470540` tag 0 — and it stays like that */
  open: 3319,
  /** `0x4210bd`'s test and `0x42115a`'s: the two distances that matter */
  nearPx: 100,
  /** `0x42121b`'s `sub ecx, 0x56` — how far down is far enough */
  deathPx: 86,
  /** `0x4211c4`'s `inc word ptr [eax+0xa]` — one unit of fall, on the frame it opens */
  pullPerFrame: 1,
  /** `0x4211af` — and half your speed along with it */
  dragHalves: true,
  /** `0x4211d7`'s `sub eax, 0x32` — sound 3 as it opens if you are this far below its point */
  soundBelowPx: 50,
  /** `0x4211e2` — `0x40ef30(bank, 3, pos)` */
  openSound: 3,
  /**
   * The ledge an open grave lays across its own mouth.
   *
   * `0x40b3f6`/`0x40b40d` build the engine's platform table at `0x4aa600` out of
   * the book's `platform` records, forty-eight bytes a row, which is the entity
   * stride — the table IS a list of entity records. And a grave appends one of
   * its own: when its opening script ends, `0x4212bb` calls `0x421470`, which
   * takes the next slot at `0x4aa602` (a row's `top`, two bytes in) and writes
   *
   * ```
   *   4212a0  top    = grave.y + 0x4c
   *   421285  left   = grave.x - 0x64
   *   42128a  bottom = grave.y + 0x7e
   *   42129b  right  = grave.x + 0x64
   * ```
   *
   * So an OPEN grave is a two-hundred-wide ledge over its own pit, and the pit
   * is real: GRAVE's rasterised floor drops 320 to 370 pixels at each of its
   * five graves. Without the ledge, anything that walks goes in — and nine of
   * the sixteen zombies' patrol rects span a grave, so the level's own
   * population walks into its own holes and the 14-of-16 quota can never be met.
   */
  lid: { top: 0x4c, bottom: 0x7e, halfWidth: 0x64, from: "0x421285 / 0x42128a / 0x421298 / 0x4212a0" },
  from: "0x41f0e0 / 0x420f90 / 0x421040",
} as const;

export interface Hole {
  x: number;
  y: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  /**
   * `0x4704d0` tag 0 ("shut") and tag 1 ("near"), `0x4704e8` ("opening", kind 1)
   * and `0x470540` ("open", kind 2) — see {@link HOLE}
   */
  state: "shut" | "near" | "opening" | "open";
  /** whether `0x421470` has appended the lid's platform record yet */
  lid?: boolean;
  /** `0x421230`'s `cmp word ptr [edi+0xa], 0` — one grave takes one player */
  taken?: boolean;
  clock: number;
}

/**
 * What comes up out of the ground between them — `inithand`, four of them in
 * level nine. Creator `0x41f090`, class `0x420bb0`, think `0x420c60`.
 *
 * Gravity zero, divisor 10, and the trigger is the player's own point inside the
 * record's rect (`0x434200`) **while they are on the ground** (`0x420ca9`).
 *
 * There are two of them and it is the record's `param` that says which, not a
 * roll — `0x41f0d8` files the param at `user+8` and `0x420cc4` switches on it:
 *
 * - **param 0** takes the PLAYER'S OWN X (`0x420ce7`) and a y of the player's
 *   drawn bottom less two (`0x42f9f0`, then `0x420d1b`). It comes up under your
 *   feet wherever you are standing. Script `0x470400` tag 0 — six wide cels.
 * - **param 1** picks a random x inside its own rect (`0x434540(right - left)
 *   + left`) and keeps the record's y. Script tag 3 — five narrow ones.
 *
 * Each holds on one cel out of `0x4704b8`, whose `ticksPerFrame` is **30**: two
 * seconds a frame. The underfoot one lets go early: `0x420dc6` sinks it once
 * fewer than 20 of those 30 remain (`obj+0x48`) unless its `obj+0x2a` is set —
 * and `obj+0x2a` is only ever set by `0x430663`, the rebound of a POSITIVE blow,
 * which a hand's code never is. So the underfoot hand holds for eleven frames
 * and the other (`0x420e54`, which tests only the script's end and `obj+0x2a`)
 * for the full thirty.
 *
 * Its blow strengths are `0xfffd` and `0xfff9` — **−3 and −7**. Those are codes
 * and not damage, the same kind of number `initbush`'s grab carries and the same
 * kind the flamethrower's flame carries, and this port does carry them:
 * `takeHits` hands each hand's own code to `takeCode` along with a grip read
 * from the cel it is holding (`gripAt`), so a hand that comes up under you
 * takes hold and the two-second pause `0x4704b8` gives it is a hazard rather
 * than a picture of one. `tests/machine/grave.ts` watches one come up on cel
 * 1556 under the player's own feet.
 *
 * This note used to end "cannot yet take hold of anything", which was true when
 * nothing in the port read a code at all.
 */
export const HAND = {
  /** param 0 — `0x470400` tags 0 and 2, `0x4704b8` tag 1. 66px across */
  underfoot: {
    up: { cels: [1550, 1551, 1552, 1553, 1554, 1555], hold: 1, from: "0x470400 tag 0" },
    hold: 1556,
    down: { cels: [1555, 1554, 1553, 1552, 1551, 1550], hold: 1, from: "0x470400 tag 2" },
    blow: -3,
  },
  /** param 1 — tags 3 and 5, `0x4704b8` tag 4. 38px, and it hits harder */
  anywhere: {
    up: { cels: [1557, 1558, 1559, 1560, 1561], hold: 1, from: "0x470400 tag 3" },
    hold: 1562,
    down: { cels: [1561, 1560, 1559, 1558, 1557], hold: 1, from: "0x470400 tag 5" },
    blow: -7,
  },
  /** the cel it waits on, out of sight under the ground — `0x4703f0` */
  hidden: 1550,
  /** `0x4704b8`'s own `ticksPerFrame` */
  holdFrames: 30,
  /**
   * `cmp word ptr [esi+0x48], 0x14` at `0x420dc6`: the underfoot hand sinks on
   * the first frame fewer than twenty of its thirty remain — the eleventh
   */
  underfootLeft: 20,
  /** `0x420bcb` */
  divisor: 10,
  /** `0x420cba` — `belfry.snd` names 3 "0020 hands brea[k]" */
  sound: 3,
  from: "0x41f090 / 0x420bb0 / 0x420c60",
} as const;

export interface Hand {
  /** the record's own point and rect — where it may come up */
  x: number;
  y: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** the record's `param`: 0 comes up under your feet, 1 anywhere in its rect */
  underfoot: boolean;
  /** where THIS rise is happening, which for param 0 is wherever you stood */
  atX: number;
  atY: number;
  state: "down" | "up" | "held" | "sinking";
  clock: number;
}

/**
 * The swinging blade — `initswingaxe`, fifteen in CAVERN and three in RAVECAVE.
 * Creator `0x41ef90`, class `0x423c60`, think `0x423d00`.
 *
 * One script and three tags, and the think does nothing but hand them round in
 * a ring: `0x423d51` waits for tag 0 to end and installs tag 1, `0x423d7b`
 * waits for tag 1 and installs tag 2, `0x423db4` waits for tag 2 and goes back
 * to tag 0 — playing `0070 swiningbla[de]` as it does. Twenty-seven cels, one
 * engine frame each, for ever.
 *
 * Its velocity is written to zero every frame (`0x423d0b`), its gravity is zero
 * and its blow is a hundred at every single tag. So it is a pendulum that does
 * not move and cannot be stopped, and every one of its records is the same
 * 112x287 box hanging over a walkway.
 */
export const AXE = {
  /** `0x4702c8` tags 0, 1 and 2 in the order the think rings them */
  swing: [
    4040, 4041, 4042, 4043, 4044, 4045, 4046, 4047,
    4048, 4049, 4050, 4051, 4052, 4051, 4050, 4049, 4048,
    4047, 4046, 4045, 4044, 4043, 4042, 4041, 4040, 4040, 4040,
  ],
  /** where tag 2 hands back to tag 0 — the frame `0070 swiningbla[de]` plays */
  soundAt: 0,
  sound: 0x20,
  /** `0x423c8d` */
  divisor: 20,
  /** `0x423d29` and the four after it — every tag, the same hundred */
  blow: 100,
  from: "0x41ef90 / 0x423c60 / 0x423d00",
} as const;

export interface Axe {
  x: number;
  y: number;
  /** engine frames into the ring of 27 */
  clock: number;
}

/**
 * The rope bridge — `initbridge`, four of them in CAVERN. Creator `0x41e9c0`,
 * class `0x4222b0`, think `0x422370`.
 *
 * A 220x25 record laid across a gap, and it is the PLANK's think over again
 * (`0x4531d0`), with its own art:
 *
 * ```
 *   whole   0x46ecf8 kind 1, cel 750
 *   rocking 0x46ed08 kind 2, 750 751 750 751   `0124 bridge cru[mbles]` (0x34)
 *   falling 0x46ed30 tag 0, 751..754
 *   gone    tag 1 (755), gravity 1.0 and `0x35`; tag 2 (756); then 0x46ece8 (750)
 * ```
 *
 * Kind 1 tests the player: x strictly inside the record's rect (`0x4223ac`), on
 * the ground, and their point above the bridge's by less than 300 (`0x4223e0`).
 * Then, if the counter at `user+0xc` is 5 or less and the fall onto it
 * (`player+0x32`) 100 or less, it rocks, with 0x34; otherwise it falls, without a
 * sound. Each rock that ends is one more on the counter (`0x422460`) and a whole
 * bridge again — so standing still on one rocks it six times and then it goes.
 *
 * It owns the platform laid over it (`0x41e9ec`, `0x42fb70`), and when the
 * falling cels end `0x4224ad` gives it gravity 1.0: the bridge drops, and the
 * record with it. Its region is −1 (`0x41e9e6`), so no room's floor holds it.
 */
export const BRIDGE = {
  whole: 750,
  /** `0x46ed08` tag 0 — the warning, and it is two cels alternating */
  rocking: { cels: [750, 751, 750, 751], hold: 1, from: "0x46ed08 tag 0" },
  /** `0x46ed30` tag 0 */
  falling: { cels: [751, 752, 753, 754], hold: 2, from: "0x46ed30 tag 0" },
  /** `0x46ed30` tags 1 and 2, then `0x46ece8`'s 750 — the bridge dropping */
  gone: { cels: [755, 755, 756, 756, 750], from: "0x46ed30 tags 1/2, 0x46ece8" },
  /** `0x4223e0`'s `cmp ecx, 0x12c` — how far above it the player's point may be */
  reachPx: 300,
  /** `0x4223f5`'s `cmp word ptr [edx+0xc], 5` — rocks it gives before it goes */
  standFrames: 5,
  /** `0x422401`'s `cmp word ptr [eax+0x32], 0x64` — or one hard landing */
  fallPx: 100,
  /** `0x4224ad`'s `0x42f850(obj, 1.0)` — ten pixels a frame, every frame, once it drops */
  gravity: 10,
  /** `0x4222e1` */
  divisor: 10,
  from: "0x41e9c0 / 0x4222b0 / 0x422370",
} as const;

export interface Bridge {
  x: number;
  y: number;
  /** the creator's point, where `0x422230` puts it back */
  homeY: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  state: "whole" | "rocking" | "falling" | "gone";
  /** `user+0xc` — how many times it has rocked */
  stood: number;
  clock: number;
  /** pixels a frame, once it drops */
  vy?: number;
}

/**
 * The floor that will not hold — `initfloor`, five of them and all five in
 * TOWER. Creator `0x41f140`, class `0x426ea0`, think `0x426f80`.
 *
 * Level twelve's version of level nine's grave, and it works the same way: no
 * health, no blow, and `0x402fa0` at the end of it.
 *
 * ```
 *   whole    0x470558 tag 0, cel 9010            and 0x470568 tag 0, four of it
 *   creaking 0x470568 tag 1, 9011 x3             `0120 floor crea[ks]`
 *   caving   0x4705a8 tag 0, 9012..9017          `0121 floor cave[s in]`
 * ```
 *
 * The player's point in its rect, on the ground, starts `0x470568` tag 0 — four
 * frames of the whole cel. While the player's x is more than 50 from the
 * floor's, a grace counter (`ctx+0x10`, 10 from the creator) runs down, and when
 * it runs out the floor is whole again with a grace of 5 (`0x42703e`). Within
 * 50, the four frames end into `0120 floor crea[ks]` and tag 1; tag 1 ends into
 * `0121 floor cave[s in]` and `0x4705a8` if the player is still within 50 across
 * and 200 down (`0x42709a`, `0x4270b3`), and back to tag 0 if not.
 *
 * On the caving script's third cel `0x427100` gives the floor a divisor of 10 and
 * gravity 3.0, and it falls — with the platform it owns (`0x41f1a9`), and with no
 * room to hold it (region −1, `0x41f170`). From then on, every frame, a player
 * whose point is inside the record's own x span and between 100 and 1000 below
 * its bottom (`0x41f196`, `0x41f1a1`) is ended by `0x402fa0(1)`.
 */
export const FLOOR = {
  whole: 9010,
  /** `0x470568` tag 1 */
  creaking: { cels: [9011, 9011, 9011], hold: 1, from: "0x470568 tag 1" },
  /** `0x4705a8` tag 0 */
  caving: { cels: [9012, 9013, 9014, 9015, 9016, 9017], hold: 1, from: "0x4705a8 tag 0" },
  /** `0x470568` tag 0 — four frames of the whole cel before it starts */
  holdFrames: 4,
  /** `0x427100` — `0x42f850(obj, 3.0)`: 30 pixels a frame, every frame, three times the player's own pull */
  gravity: 30,
  /** `cmp eax, 0x32` at `0x427012` / `0x42709a` — how near the player's x must stay */
  nearPx: 50,
  /** `cmp eax, 0xc8` at `0x4270b3` — and how near their y, for it to cave */
  nearY: 200,
  /** `0x41f17e` — the grace the creator gives, and `0x42703e` — the grace after */
  grace: 10,
  regrace: 5,
  /** `0x41f192` / `0x41f19d` — the death zone, this far below the rect's bottom */
  deathFrom: 0x64,
  deathTo: 0x3e8,
  from: "0x41f140 / 0x426ea0 / 0x426f80",
} as const;

export interface Floor {
  x: number;
  y: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  /**
   * `0x470558` ("whole"), `0x470568` tag 0 ("settling") and tag 1 ("creaking"),
   * `0x4705a8` while it plays ("caving") and after ("gone")
   */
  state: "whole" | "settling" | "creaking" | "caving" | "gone";
  clock: number;
  /** `ctx+0x10` — frames of grace while the player is away, 10 at first and 5 after (`0x41f17e`, `0x42703e`) */
  grace?: number;
  /** pixels a frame, once it falls */
  vy?: number;
}

/**
 * The SURGE — `initsurge`, two of them, both in TOWER, and it is the only
 * hazard in the game that gives you something.
 *
 * `0x426a90` sets its blow to `0xfffc` — **−4**, a code — and `0x426b21` calls
 * `0x45ef30`, the ammunition adder, followed by `0x40d4f0` to redraw the panel.
 * So walking into a live surge fills the weapon in your hands. Its records are
 * two tall thin columns, 63 by 1310 and 60 by 1122, running the height of the
 * tower's wall.
 *
 * What turns it on is the LIGHTNING's counter: `0x426800`, TOWER's own frame
 * function, sets every surge's `ctx+0` as the counter wraps (`0x42682b`). The
 * creator stands the object at its rect's TOP-LEFT corner (`0x41ec66`,
 * `0x41ec6a`), mirrored by the param (`0x41ec6e`). While it is on, `0x426a70`:
 *
 * ```
 *   426a90  obj+0x1a = -4, and 0x38 looping
 *   426ad4  the player armed (0x402ee0) with weapon 16, the scepter (0x426ade),
 *           their point inside the rect widened 100 each side (0x426ac8), and
 *           within 30 of the arc's y (0x426b18): 0x45ef30(13) — thirteen rounds
 *   426b2c  as the six cels end: if the arc is still above its rect's bottom
 *           less 75, again, 75 lower (0x426b5a); if not, off — strength 0, the
 *           loop stopped, and back to the top (0x426b89)
 * ```
 *
 * So the arc runs DOWN its column in hops of 75, six frames a hop, once every
 * lightning period.
 */
export const SURGE = {
  /** `0x46f648` tag 0 */
  arc: { cels: [9060, 9061, 9062, 9063, 9064, 9065], hold: 1, from: "0x46f648 tag 0" },
  /** `0x426a90` — a code, not damage */
  blow: -4,
  /** `0x426aa8` — `0134 surge` */
  sound: 0x38,
  divisor: 1,
  /** `0x426b5a` — how far down the arc hops as each run of its cels ends */
  hop: 0x4b,
  /** `0x426ac8` / `0x426ace` — the rect widened this much each side */
  reachX: 0x64,
  /** `0x426b18` — and this near the arc's y */
  reachY: 0x1e,
  /** `0x426ade` — the weapon it charges, the scepter */
  weapon: 16,
  /** `0x426b1d` — rounds a frame */
  rounds: 0xd,
  from: "0x41ec20 / 0x426990 / 0x426a70",
} as const;

export interface Surge {
  /** the arc — the rect's left, and a y that runs from its top down */
  x: number;
  y: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  clock: number;
  /** `ctx+0` — switched on by the lightning's counter */
  on?: boolean;
  /** `obj+0x28` — the record's param */
  mirror?: boolean;
}

/**
 * MAZE's cage doors — `initcagedoor`, seven of them. Creator `0x4113d0`, class
 * `0x413060`, think `0x413100`.
 *
 * Level thirteen's lock, and it is SEWER's told with different art and one
 * extra move: a shut cage door **adds itself to the engine's obstacle table**.
 * `0x411460` increments `[0x46b9b0]` and appends the door's own rect at
 * `0x4a89e2 + n * 48`, which is the same table the level's `obstacle` records
 * fill — so the door is not a special case to anything that walks, it simply
 * becomes another piece of wall. `0x413190` takes it out again.
 *
 * ```
 *   closing  0x46c010 tag 0, 2012 2011    four frames a cel
 *   shut     tag 1, 2010                  ...and now it is an obstacle, with 0x22
 *   opening  tag 2, 2011 2012
 *   open     tag 3, cel 0                 nothing drawn, nothing solid
 * ```
 *
 * Its creator files cel 0xbc9 — 3017 — and there is no cel 3017 in MAZE.SBK;
 * the think installs `0x46c010` before anything is drawn, the same leftover the
 * wraith's creator carries.
 */
export const CAGE = {
  shut: 2010,
  /** `0x46c010` tag 0 — and `ticksPerFrame` is FOUR */
  closing: { cels: [2012, 2011], hold: 4, from: "0x46c010 tag 0" },
  /** tag 2 */
  opening: { cels: [2011, 2012], hold: 4, from: "0x46c010 tag 2" },
  /** `0x413142` — `lab.snd` 0x22 */
  sound: 0x22,
  /** `0x413440` / `0x413457` — `lab.snd` 0x21, as a lever's broadcast turns it */
  toggle: 0x21,
  from: "0x4113d0 / 0x413060 / 0x413100",
} as const;

export interface Cage {
  x: number;
  y: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** the record's own `param`, which is the number a switch broadcasts */
  param: number;
  state: "shut" | "opening" | "open" | "closing";
  clock: number;
}

/**
 * The alarm — `initalarm`, six of them and all six in MAZE. Creator `0x411370`,
 * class `0x412f40`, think `0x412fc0`.
 *
 * Two tags and a sound. `0x46bfc0` tag 0 is one cel, 3566, and tag 1 is the
 * whole sweep 3560…3566. The think reinstalls whichever tag it is on as it ends,
 * with `lab.snd` 0x24 each time round tag 1 (`0x412fdf`) — and it is created on
 * tag 0 (`0x4113b5`). What moves it between them is the vertical fan whose
 * param is the alarm's own (`0x415dc0`): see {@link FAN}.
 */
export const ALARM = {
  quiet: 3566,
  /** `0x46bfc0` tag 1 — seven cels at two frames each */
  flash: { cels: [3560, 3561, 3562, 3563, 3564, 3565, 3566], hold: 2, from: "0x46bfc0 tag 1" },
  /** `0x412fea` */
  sound: 0x24,
  from: "0x411370 / 0x412f40 / 0x412fc0",
} as const;

export interface Alarm {
  x: number;
  y: number;
  param: number;
  clock: number;
  /** on tag 1, the sweep — set and cleared by its fan */
  on?: boolean;
}

/**
 * The fans — `inithfan` (three) and `initvfan` (five), both in MAZE. Creators
 * `0x411ae0` and `0x411b40`, classes `0x4152b0` and `0x415870`.
 *
 * Four tags, each a loop the think reinstalls as it ends, and a counter in the
 * fan's own user data (`user+0xc`, 40 from the creator) that hands one to the
 * next (`0x4153a0` for the horizontal, `0x415960` for the vertical):
 *
 * ```
 *   0  "suck"  the blades turning (0..4)   60 frames: it DRAWS the player's point
 *                                          in its rect toward it — ±80 across
 *                                          (0x415464) or −200 up (0x415a2c)
 *                                          through 0x42f8b0 every frame — and
 *                                          kills within 140 across (0x4154a3) or
 *                                          100 up (0x415a6e): 0x402fa0(8), sound
 *                                          0x16, and the blades run red
 *   1  "stop"  held on 4                   15 frames, then 0x15
 *   2  "blow"  the blades backwards        60 frames: the same push the other way,
 *                                          ±80 (0x415650) or +100 (0x415bf0)
 *   3  "rest"  held on 0                   15 frames, then 0x15, and back to 0
 * ```
 *
 * The vertical fan also works the ALARMS whose param is its own (`0x415dc0`):
 * they go quiet as it stops sucking (`0x4159e1`) and flash as it starts again
 * (`0x415c5a`). Its think writes `obj+0x1a = 0` every frame (`0x4153bb`,
 * `0x41597b`), so neither fan's blades can hit anything — what kills is the
 * distance test.
 */
export const FAN = {
  h: {
    /** `0x46d478` tag 0 — the blades turning */
    spin: { cels: [10020, 10021, 10022, 10023, 10024], hold: 1, from: "0x46d478 tag 0" },
    held: 10024,
    stopped: 10020,
    /** `0x46d4e0` tag 1 (tag 0 for the second character, `0x41553a`) — the blades run red */
    red: { cels: [1090, 1091, 1092, 1093, 1094, 1095, 10020, 10021, 10022, 10023, 10024], hold: 1, from: "0x46d4e0 tag 1" },
    /** `0x415464` — the push across, raw, toward the fan while it sucks */
    push: 0x50,
    /** `0x4154a3` — within this across, it kills */
    killPx: 0x8c,
  },
  v: {
    /** `0x46d598` tag 0 */
    spin: { cels: [10030, 10031, 10032, 10033, 10034], hold: 1, from: "0x46d598 tag 0" },
    held: 10034,
    stopped: 10030,
    /** `0x46d600` tag 0 */
    red: { cels: [10608, 10607, 10606], hold: 1, from: "0x46d600 tag 0" },
    /** `0x415a2c` — the pull, raw, up into it while it sucks */
    suck: -200,
    /** `0x415bf0` — and the push, raw, back down while it blows */
    blow: 0x64,
    /** `0x415a6e` — within this up or down, it kills */
    killPx: 0x64,
  },
  /** `0x411b38` / `0x411b86` — the counter a fan starts on, in tag 0 */
  first: 0x28,
  /** `0x4155ef` — engine frames sucking or blowing */
  onFrames: 0x3c,
  /** `0x41541d` — engine frames stopped between */
  offFrames: 0xf,
  /** `0x415500` — the blades running red */
  kill: 0x16,
  /** `0x4155cd` — a fan changing over */
  change: 0x15,
  /** `0x4152cb` — the fan's own; the pushes go through the PLAYER's 12 */
  divisor: 10,
  from: "0x411ae0 / 0x4152b0 / 0x4153a0 and 0x411b40 / 0x415870 / 0x415960",
} as const;

export interface Fan {
  x: number;
  y: number;
  /** `inithfan` pulls across, `initvfan` pulls up */
  horizontal: boolean;
  /** the four tags, named — see {@link FAN} */
  state: "suck" | "stop" | "blow" | "rest";
  /** engine frames into the current script */
  clock: number;
  /** `user+0xc` */
  count: number;
  /** the blades running red, until the script ends into tag 1 */
  red?: boolean;
  /** the record's rect — the player's point in it is what it moves */
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** the vertical fan's `user+0xe` — the alarms it works */
  param: number;
}

/**
 * BARREL's conveyors — `initbeltleft` (twenty-six) and `initbeltright`
 * (sixteen), which share one creator (`0x411500`) and one class (`0x4167c0`).
 * Think `0x416840`.
 *
 * Each record is a 278x36 strip. The think measures the player's own drawn box
 * (`0x4025b0` then `0x42f9f0`) and asks three things: that its bottom is above
 * the belt's point by less than 20 (`0x416881`), that the player's point x is
 * strictly inside the rect (`0x416899`, against `user+8` and `user+0xc`, the
 * rect's two x), and that they are on the ground (`0x4168d0`). Then it adds
 * `user+2` — the record's `param`, 4, 6, 8 or 10 (`0x41159d`) — to the player's
 * horizontal velocity, every frame: `initbeltright` adds, `initbeltleft`
 * subtracts. The `0x14` at `0x416965` is not a carry at all; it reloads
 * `user+4`, the countdown a third belt class (creator argument −1, placed by no
 * shipped book) uses to reverse itself every 21 frames.
 *
 * Three scripts and the same five cels in all of them: the param picks — under 5
 * `0x46c188` at three engine frames a cel, under 10 `0x46c130` at two, and
 * `0x46c0d8` at one (`0x411532`).
 */
export const BELT = {
  /** `0x46c0d8` tag 0 — and tag 1 is the same five backwards */
  roll: { cels: [5570, 5571, 5572, 5573, 5574], hold: 1, from: "0x46c0d8 tag 0" },
  /** `0x46c188`, the same five at three frames a cel */
  slowHold: 3,
  /** `0x416881`'s `cmp ax, 0x14` — how far above the belt's point the player's drawn bottom may be */
  bandPx: 0x14,
  from: "0x411500 / 0x4167c0 / 0x416840",
} as const;

export interface Belt {
  x: number;
  y: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** `initbeltleft` is −1 and `initbeltright` is +1 */
  dir: -1 | 1;
  /** the record's own param, which picks `0x46c0d8` over `0x46c188` */
  param: number;
  clock: number;
}

/**
 * The chair — `initchair`, two of them, both in BARREL. Creator `0x411d40`,
 * class `0x417970`, think `0x4179f0`.
 *
 * One script, `0x46dfd8`: three tags of six cels at two frames each (2200s,
 * 2210s, 2220s) and a fourth that is 2226 alone. The think hands 0 → 1 → 2 → 0
 * round as each ends — and on every frame of tag 2, if the player's x is within
 * 150 of the chair's (`0x417a7c`), it installs tag 3 instead, which no handler
 * leaves: the chair is empty from then on. The same frame `0x417ad0` and
 * `0x411660` stand its occupant up — a creature of class `0x46c9e0` with 250
 * health, counted in the census — which this page does not yet make.
 */
export const CHAIR = {
  runs: [
    { cels: [2200, 2201, 2202, 2203, 2204, 2205], hold: 2, from: "0x46dfd8 tag 0" },
    { cels: [2210, 2211, 2212, 2213, 2214, 2215], hold: 2, from: "0x46dfd8 tag 1" },
    { cels: [2220, 2221, 2222, 2223, 2224, 2225], hold: 2, from: "0x46dfd8 tag 2" },
  ],
  /** tag 3 — one cel, and nothing leaves it */
  rest: 2226,
  /** `0x417a7c`'s `cmp eax, 0x96` — how near the player's x empties it */
  nearPx: 0x96,
  from: "0x411d40 / 0x417970 / 0x4179f0",
} as const;

export interface Chair {
  x: number;
  y: number;
  /** which of the three runs is playing, or 3 for the held cel */
  run: number;
  clock: number;
}

/**
 * The claw — `initclaw`, four of them, all in BARREL. Creator `0x411ca0`, class
 * `0x417130`, think `0x4171e0`.
 *
 * A carriage on a rail that follows you. `0x417344` and `0x417376` clamp its
 * horizontal velocity to **±26** and `0x417316` clamps its position to its own
 * record's bounds, so it tracks the player along a 582-to-1410 pixel track and
 * cannot leave it. Then `0x417289` measures the distance:
 *
 * ```
 *   inside 300   0x46dd80   the reach: 2420…2426, and it comes down
 *   over   600   0x46dd18   the idle, with a rolled wait
 *   between      0x46dc78   the carriage, 2460…2469, running
 * ```
 *
 * It plays `#0100 claw wizz` as it travels and `#0101 clawclamp` as it shuts.
 *
 * Its first blow is a hundred and its second is `0xfffd` — **−3**, the same code
 * `initbush`'s grab and `inithand`'s carry. This port does not carry codes, so a
 * claw here travels, drops, holds and lifts, and cannot take hold of you.
 */
export const CLAW = {
  /** `0x46dc78` tag 0 — the carriage running its rail */
  running: { cels: [2460, 2461, 2462, 2463, 2464, 2465, 2466, 2467, 2468, 2469], hold: 2, from: "0x46dc78 tag 0" },
  /** `0x411d02` — `sub word ptr [ebx+8], 0xa`, off the record's own point */
  leftBy: 0xa,
  /** `0x46dd80` tags 1, 2 and 4 — down, worry, up */
  down: { cels: [2420, 2421, 2422, 2423, 2424], hold: 2, from: "0x46dd80 tag 1" },
  shut: { cels: [2424, 2425, 2426, 2425], hold: 2, from: "0x46dd80 tag 2" },
  up: { cels: [2424, 2423, 2422, 2421, 2420], hold: 2, from: "0x46dd80 tag 4" },
  /** `0x46dd18` tag 1 — what it does with nobody near */
  idle: { cels: [2410, 2411, 2412], hold: 1, from: "0x46dd18 tag 1" },
  /**
   * ...and the OTHER claw, which is the same object in a different kind.
   *
   * `0x4171e0` is a seven-kind machine and the 2420s above are kind 4. Kind 1
   * is `0x46de08`, and it is the one that takes hold of you: of the claw's
   * fifty-two cels only tag 2's 2456..2459 carry a strike box, and theirs is
   * `y 77..111, x -76..0` — the jaw hanging below and behind its anchor.
   *
   * ```
   *   41743d  tag 1 ends: hit something -> tag 2 and blow -3
   *                       else          -> tag 3
   *   417485  tag 2: blow -3 every frame; ends -> blow 0, tag 3
   *   4174c7  tag 3 ends -> back to kind 0, the carriage
   * ```
   *
   * What sends it there is a TRACKER rather than a distance: `0x45ef70`
   * registers one against the player at `0x411d23` with the band table at
   * `0x46dfc8` — `180, 140, 100` — and `0x41734a` dispatches kind 0 on the band
   * index. Band 2 is 100 to 140 ahead and installs tag 0; band 3 is 100 or
   * nearer and installs tag 1 outright. So it reaches at 140 and commits at 100.
   */
  dive: { cels: [2450, 2451, 2452, 2453, 2454, 2455, 2456, 2457, 2458, 2459], hold: 1, from: "0x46de08 tag 1" },
  jaws: {
    cels: [2456, 2456, 2459, 2459, 2456, 2456, 2459, 2459, 2456, 2456],
    hold: 1,
    from: "0x46de08 tag 2",
  },
  lift: { cels: [2455, 2454, 2453, 2452, 2451, 2450], hold: 1, from: "0x46de08 tag 3" },
  /** `0x46dfc8`, the tracker's own bands — reaches at the middle one */
  bands: [180, 140, 100],
  reachBand: 140,
  /** `0x417344`'s `0x1a` */
  speed: 0x1a,
  /** `0x417289`'s `cmp ecx, 0x12c` and `0x41729d`'s `cmp ecx, 0x258` */
  reachPx: 0x12c,
  restPx: 0x258,
  /** `0x41725c` and `0x417385` */
  wizz: 0x13,
  clamp: 0x14,
  /** `0x41714d` */
  divisor: 0x14,
  blow: 100,
  /**
   * `0x41745c` — the GRAB code, which this port now carries (see `src/codes.ts`).
   *
   * It belongs to kind 1 (`0x46de08`), not to the kind-4 clamp below. Kind 1 is
   * installed by `0x41734a` off the BAND index `0x45efd0` returns against the
   * table at `0x46dfc8` — `180, 140, 100` — so the claw reaches at 140 pixels
   * and commits at 100, and only there does it show 2456..2459, the only four
   * of its fifty-two cels that carry a grip. The code is carried; kind 1's own
   * tag machine at `0x4173bf` is not built, so nothing here reaches for it yet.
   */
  grab: -3,
  from: "0x411ca0 / 0x417130 / 0x4171e0",
} as const;

export interface Claw {
  /** where the carriage is now, and the rail it may not leave */
  x: number;
  y: number;
  left: number;
  right: number;
  state: "idle" | "running" | "down" | "shut" | "up" | "dive" | "clamp" | "lift";
  clock: number;
  /**
   * `obj+0x2a` — "I hit something", and it is what the dive asks at `0x417448`
   * before it decides whether to clamp or go straight back up.
   *
   * The dive itself carries the ordinary hundred `0x417208` writes at the top of
   * every think; the code -3 only appears once it is already holding you
   * (`0x417485`). So the sequence is: the jaw hits you for a real blow, THAT is
   * what sets this, and the grab is what follows from it.
   */
  caught?: boolean;
}

/**
 * VAT's three pieces of furniture, and all three are one cel apiece.
 *
 * - **`initshower`**, seven of them. Creator `0x4117c0`, class `0x41a1d0`.
 *   `0x46cc68` has two tags of one record: 4060 and 4022. Divisor 20, gravity
 *   zero, and `0x41a20e` writes `0xff9c` — **−100** — into `obj+0x10`, the floor
 *   offset, so it hangs a hundred pixels above whatever it stands on.
 * - **`initball`**, two. Creator `0x4118a0`, class `0x41a720`, cel 4310.
 * - **`initteeth`**, one in LAB and one in VAT. Creator `0x4119d0`, class
 *   `0x418c80`, cel 3516.
 */
export const FITTING = {
  shower: { on: 4060, off: 4022, below: -100, from: "0x4117c0 / 0x41a1d0 / 0x46cc68" },
  ball: { cel: 4310, from: "0x4118a0 / 0x41a720 / 0x46ce38" },
  teeth: { cel: 3516, from: "0x4119d0 / 0x418c80 / 0x46d1b8" },
  divisor: 0x14,
} as const;

export interface Fitting {
  kind: "shower" | "ball" | "teeth";
  x: number;
  y: number;
  clock: number;
}

/**
 * BOGGS — the game's last thing, in VAT, and it is four objects rather than one:
 * `initboggsbody` (`0x412240`), `initboggshead` (`0x412310`), `initbgclawarm`
 * (`0x412130`) and `initbgmachinery` (`0x411da0`), which alone stands up eight
 * more with eight scripts of its own.
 *
 * Two numbers make it the boss, and they are arithmetic rather than a rule:
 *
 * ```
 *   41be84  0x40e300(0xfa0)                 ; FOUR THOUSAND health, and the
 *   41be91  cmp ax, [0x4a50e8]              ; ...cap it is clamped to
 *   41be68  cmp [0x46e080] / [0x46e084]     ; while EITHER flag is set...
 *   41be7c  add word ptr [0x4a50e8], 0x1e   ; ...THIRTY a frame, back on
 * ```
 *
 * A first reading of the hit handler `0x41bc50` had both of its tests wrong and
 * this is the corrected one. `0x41bc57` calls `0x41aad0`, which is a
 * FRIENDLY-FIRE filter and nothing more: it turns a blow away only when the
 * striker is one of Boggs' own four parts, a member of either of its two lists
 * (`0x46e0a8`, `0x46e0ac`), or showing a cel in 5900..5996 — its own range and
 * the player's reaction cels. A fist is none of those, so **a punch does land**.
 * And `0x41bc6a`'s `-1` is not a requirement: `0x41bc71` TRANSLATES it to 100.
 *
 * So what makes it the boss is four thousand health — three times TOWER's
 * bishop — healing thirty a frame against a punch worth about fifty. The flags
 * gate the healing rather than the damage, and they ship SET (`0x46e080` and
 * `0x46e084` are both `01 00` in `.data`). Nothing in `.text` ever sets either
 * one; the only two writes are the clears at `0x41b611` and `0x41b75d`, and
 * both are in the MACHINERY's hit handler. Breaking the machine is the fight.
 *
 * What carries the -1 is the BLASTER's bolt (`0x413af0`, see `src/codes.ts`),
 * which is worth a full hundred here and nothing at all to any ordinary
 * creature. That is what the gun in its room is for.
 *
 * And the four objects are not decoration. `initboggshead` (its own record in
 * `VAT.SBK`) carries the 4000-health pool itself — `0x41c547` writes
 * `0x40e300(0xfa0)` into `0x4a50e8`, which is the same word `0x41bcfe` takes the
 * damage out of and `0x41be7c` heals. `initbgclawarm` stands up an arm and a set
 * of jaws whose shared hit handler is `0x41bb10`, which is `xor ax, ax; ret` and
 * nothing else: they turn EVERY blow away and cannot be hurt.
 *
 * And `initbgmachinery` is what the fight is actually about. See
 * {@link BOGGS.machines}.
 */
export const BOGGS = {
  /** `0x41bbd6` — the cel the object is made on */
  cel: 5980,
  /**
   * ...and it LUNGES, which this page had it standing still through.
   *
   * `0x41be50` rolls once a frame while its kind is 0 — the idle — and one in
   * six takes it:
   *
   * ```
   *   41bffc  0x434540(0x2a)               ; forty-two
   *   41c006  cmp eax, 7 / jge             ; ...and seven of them lunge
   *   41c010  cmp word ptr [eax+0x18], 0   ; only out of the idle
   *   41c047  cmp [player+8], [0x4a50e0+8] ; which way -> which tag
   *   41c055  0x45d090(body, 0x46e6d8, tag)
   * ```
   *
   * `0x46e6d8` carries the stride itself: tag 0 is `5980 5981(-470) 5982(-470)
   * 5983(-470) 5984..5988` and tag 1 the same the other way. Four hundred and
   * seventy through its divisor of a hundred is an impulse of 5 (`0x42f8b0`
   * rounds away from zero), added every one of the nine frames those three cels
   * show; the ground's drag keeps 30% of the speed each frame, so the lunge
   * settles at about eight pixels a frame and carries it some seventy-five.
   */
  lunge: {
    left: { cels: [5980, 5981, 5982, 5983, 5984, 5985, 5986, 5987, 5988], hold: 3, dx: [0, -470, -470, -470, 0, 0, 0, 0, 0], from: "0x46e6d8 tag 0" },
    right: { cels: [5988, 5987, 5986, 5985, 5984, 5983, 5982, 5981, 5980], hold: 3, dx: [0, 0, 0, 0, 0, 470, 470, 470, 0], from: "0x46e6d8 tag 1" },
    /** `0x41bffc` and `0x41c006` — seven in forty-two, once a frame */
    odds: [7, 42] as const,
    /** `0x41c01d` — `0x434540(2) + 0xe` out of the chapter's own bank */
    sound: 0xe,
    from: "0x41be50 / 0x46e6d8",
  },
  /** `0x46e6b0` tag 0 */
  idle: { cels: [5988, 5987, 5986, 5987], hold: 3, from: "0x46e6b0 tag 0" },
  /** `0x41be84` — `0x40e300(0xfa0)` */
  health: 4000,
  /** `0x41be7c` */
  regen: 0x1e,
  /**
   * `0x41bc6a`, and it is a TRANSLATION rather than a requirement: `0x41bc71`
   * rewrites a strength of -1 as 100 and lets everything else through as it is.
   * The blaster's bolt is what carries -1 (see `guns.ts`'s `BOLT`), so the bolt
   * is worth a full blow here and nothing at all anywhere else.
   */
  translates: -1,
  /** `0x41bc71` — what -1 becomes */
  translatesTo: 100,
  /** `0x41bbe0` — the largest divisor in the game */
  divisor: 100,
  /** `0x41bbf0` — and the largest shove weight */
  weight: 0x50,
  /**
   * The right-hand bar is Boggs' own, and it enters the competition for it every
   * frame from its own tick rather than from a census pass:
   *
   * ```
   *   41bead  eax = [0x4a50e0]            ; at the HEAD's point, not the body's
   *   41beb6  push 0x33fa                 ; the name plate, 106x7 in PLAYER.SBK
   *   41bebb  0x40e300(0xfa0)             ; against the four thousand
   *   41bed1  0x40d1c0(0x4a50e8, max, plate, head.pos)
   * ```
   *
   * The MACHINERY does not: `0x41b510` never calls `0x40d1c0`, so the disc shows
   * no health for either half of it anywhere. What is on this page's own debug
   * line is this page's.
   */
  plate: 0x33fa,

  /**
   * The HEAD — `initboggshead` (`0x412310`), its own record in `VAT.SBK`, and
   * three things live on it that live nowhere else.
   *
   * It carries the health. `0x41c547` writes `0x40e300(0xfa0)` into `0x4a50e8`,
   * and that word is what the BODY's handler decrements (`0x41bcfe`) and what
   * the body's tick heals and caps. One pool, on the head.
   *
   * It carries the census. `0x41c591` is `0x42f870(head, 1)` — the head is the
   * entry the level's quota counts, and the body is not registered at all.
   *
   * And it carries the tracker: `0x41c5bb` is
   * `0x45ef70(&0x4a5140, head, player, 0x46e990)`, the same primitive the claw,
   * the wraith and the bishop use, on the bands 250/150/80.
   *
   * What it does with all that is LOOK AT YOU. `0x46e7c0` is eighteen tags of a
   * single cel each, and `0x41c182` installs one of the first nine whenever the
   * head's own script has ended — which, at three ticks a frame and one frame a
   * tag, is every third frame:
   *
   * ```
   *   41bfe3  bx = si > 200 ? 0 : si > 0 ? 1 : 2   ; si = body.X - player.X
   *   41c192  cmp di, 0x64   / jle    ; di = player.Y - body.Y
   *   41c198  add bx, 6               ; ...you are well below it
   *   41c1b2  cmp di, 0xff6a / jle    ; -150
   *   41c1d4  add bx, 3               ; ...you are well above it
   *   41c1a3  0x45d090(head, 0x46e7c0, bx)
   * ```
   *
   * So the nine tags are a 3x3 grid, column by how far left you are and row by
   * how far above. 5900..5908.
   */
  head: {
    /** `0x41c52b` */
    cel: 5900,
    /** `0x46e7c0` tags 0..8 — the look-at grid, column-major in `bx` */
    look: [5900, 5901, 5902, 5903, 5904, 5905, 5906, 5907, 5908],
    /** `0x46e7c0`'s `ticksPerFrame`, which is also how often it re-aims */
    hold: 3,
    /** `0x41bfe3` — beyond this far to your left it is the outer column */
    far: 200,
    /** `0x41c192` — below this and it looks down */
    below: 0x64,
    /** `0x41c1b2` — above this and it looks up */
    above: -0x96,
    /** `0x46e990`, through `0x45ef70` — and nothing in the tick reads the band */
    bands: [250, 150, 80],
    /** `0x46e908`, sixteen frames, the last eight all 5938 */
    dies: { cels: [5930, 5931, 5932, 5933, 5934, 5935, 5936, 5937, 5938], hold: 3 },
    from: "0x41c510 / 0x412310 / 0x46e7c0",
  },

  /**
   * The CLAW ARM — `initbgclawarm` (`0x412130`), two objects, and neither of
   * them can be touched: both take `0x41bb10` as their hit handler, and
   * `0x41bb10` is `xor ax, ax; ret`.
   *
   * Both are installed at tag 3 and neither tag is ever changed, so the arm
   * stands at 5753 for the whole fight. `0x412180` then hangs the jaws off the
   * arm at the CENTRE of the arm cel's own box — the same rule `gripOf` reads
   * for a grab:
   *
   * ```
   *   4121c8  bx = rec[+6]                      ; the box's left
   *   4121cc  eax = (rec[+0xa] - bx) / 2        ; ...plus half its width
   *   4121e5  jaws.X = arm.X + eax + bx
   * ```
   *
   * The one thing it does is snap. `0x41c164` is the 5-in-100 branch of the
   * body's tick and installs `0x46e558` on the jaws at the ARM's current tag —
   * seven frames of 582x / 579x / 580x.
   */
  arm: {
    /** `0x41ba38` — and `0x412137` sets its region to -1, so it is never culled */
    cel: 5750,
    /** `0x46e4e8`, installed at tag 3 and left there */
    poses: [5750, 5751, 5752, 5753, 5754, 5755],
    /** `0x41213d` / `0x412164` — the tag both halves are installed at */
    tag: 3,
    jaws: {
      /** `0x41baab` */
      cel: 5790,
      /** `0x46e520`, also installed at tag 3 */
      poses: [5810, 5811, 5812, 5813, 5814, 5815],
      /** `0x46e558` tag 3 — what `0x41c164` plays, seven frames at two ticks */
      snap: { cels: [5823, 5823, 5823, 5793, 5793, 5803, 5803], hold: 2 },
      /** `0x41c072` — five in a hundred, once a frame */
      snapOdds: [5, 100] as const,
    },
    from: "0x41ba20 / 0x412130 / 0x412180 / 0x41bb10",
  },

  /**
   * The MACHINERY — `initbgmachinery` (`0x411da0`), eight objects, and the only
   * reason Boggs can be killed at all.
   *
   * `0x411ed0` places all eight at fixed offsets from the body, out of the table
   * at `0x46e088`, and it is called twice in the whole program — once from the
   * initialiser and once from VAT's setup — so they are STATIC. They do not
   * follow the body when it lunges.
   *
   * Six of them are scenery. `0x41b510` is the hit handler all eight share, and
   * after the friendly-fire filter and the same `-1`-becomes-100 translation the
   * body uses, it checks which object was struck:
   *
   * ```
   *   41b573  cmp [0x4a56e8], esi / je      ; one of these two...
   *   41b57b  cmp [0x4a516c], esi / jne     ; ...or nothing happens
   *   41b5fc  sub word ptr [0x4a56ec], di   ; three thousand, and
   *   41b748  sub word ptr [0x4a5174], di   ; three thousand
   *   41b611  mov word ptr [0x46e080], 0    ; and THAT is what clears a flag
   *   41b75d  mov word ptr [0x46e084], 0
   * ```
   *
   * So: six thousand health of machine, in two halves of three thousand, and
   * each half you break stops one of the two healing flags. Break both and the
   * thirty a frame stops and the four thousand can be spent.
   *
   * Breaking one also re-scripts its neighbours — the pipes buckle and the
   * gauges die — which is the tag-1 run each entry carries below.
   *
   * Two branches in here never run. Both halves test their own wear stage as
   * `health / 2 < health` (`0x41b6df`) and `health * 2 / 3 < health`
   * (`0x41b719`), which is true for every positive health there is, so tags 1
   * and 2 of `0x46e3b8` and `0x46e428` — the dented cels 5861/5862 and
   * 5871/5872 — are never installed. A machine is intact until it is wrecked.
   * This is the same shape of dead code as the wraith's `-3`.
   */
  machines: [
    /** `0x4a50ec` — `0x46e4d0`, and `0x4a5168` is zero until `0x41bf2c` moves it */
    { dy: 0, dx: 0, cels: [5630], hold: 1 },
    /** `0x4a5170` — `0x46e278`, and tag 1 is what machine A's death installs */
    { dy: 35, dx: 88, cels: [5700], hold: 3, wreck: [5701, 5702, 5703], wreckedBy: 0 },
    /** `0x4a50f4` — `0x46e2a0` */
    { dy: 38, dx: 81, cels: [5720], hold: 3, wreck: [5721, 5722, 5723], wreckedBy: 0 },
    /** `0x4a50e4` — `0x46e2c8`, ten frames that just run, and nothing stops them */
    { dy: 53, dx: 255, cels: [5940, 5941, 5942, 5943, 5944, 5945, 5944, 5943, 5942, 5941], hold: 2 },
    /** `0x4a5164` — `0x46e328`, and machine A sprays thirteen times at its point */
    { dy: -39, dx: 63, cels: [5650], hold: 3, wreck: [5651, 5652, 5653], wreckedBy: 0 },
    /** `0x4a50f8` — `0x46e350`, machine B's neighbour */
    { dy: 46, dx: 230, cels: [5960], hold: 2, wreck: [5950, 5951, 5952, 5953, 5954, 5955], wreckedBy: 1 },
    /** `0x4a56e8` — `0x46e3b8` tag 3, three thousand, and it clears `0x46e080` */
    {
      dy: 55, dx: 218, cels: [5860], hold: 2, health: 3000, clears: 0,
      wreck: [5880, 5881, 5882, 5883, 5880, 5881, 5882, 5883, 5863],
      /** `0x41b653` */ sound: 0xc,
      /** `0x41b6b3` — thirteen of spray `0x14`, at `0x4a5164`'s point */
      sprays: 0xd, sprayAt: 4,
    },
    /** `0x4a516c` — `0x46e428` tag 3, three thousand, and it clears `0x46e084` */
    {
      dy: 55, dx: 373, cels: [5870], hold: 2, health: 3000, clears: 1,
      wreck: [5890, 5891, 5892, 5893, 5880, 5881, 5882, 5883, 5873],
      /** `0x41b7c6` */ sound: 0xd,
      /** `0x41b7d5` — thirteen at `0x4a50f8`'s point */
      sprays: 0xd, sprayAt: 5,
    },
  ],
  /**
   * ...and what the idle does when it does NOT lunge, which this page had as
   * nothing at all.
   *
   * `0x41bffc`'s seven-in-forty-two is only the first roll of the frame. What
   * the other thirty-five take is `0x41c068`, and it is a range test on the
   * body's own gap to the player:
   *
   * ```
   *   41c068  0x434540(0x64) / cmp eax, 5 / jl   ; five in a hundred: nothing
   *   41c07b  cmp si, 0x64                        ; inside a hundred: nothing
   *   41c096  cmp si, 0x12c / jle 0x41c0fd        ; at or under 300: a WORM
   *   41c09d  cmp word ptr [0x46e080], 0          ; ...and beyond it, if the
   *   41c0dc  0x41c330([0x4a5170])                ; first machine still stands,
   * ```                                           ; it THROWS
   *
   * `si` is the same `body.x − player.x` the head aims on, signed: a player to
   * the RIGHT of it is never more than 300 by this measure and is thrown at
   * only from the left. That asymmetry is the executable's.
   */
  reach: {
    /** `0x41c068` — five in a hundred and the frame is spent */
    idle: [5, 0x64] as const,
    /** `0x41c07b` — and this close in front of it, the same */
    close: 0x64,
    /** `0x41c096` — beyond this it throws; at or under it, a worm goes down */
    far: 0x12c,
  },
  /**
   * What it THROWS — `0x41c330`, class `[0x46e0ac]`, script `0x46e0b8`.
   *
   * It does not come out of Boggs. `[0x4a5170]` is the second of
   * {@link BOGGS.machines}, so the throw leaves the machine and stops when that
   * machine does: `0x41c09d` gates the whole branch on `0x46e080`, the flag
   * that same machine's wreck clears.
   *
   * `0x41a92b` builds it on a divisor of seven with `0x42f850(obj, 0)` — no
   * weight, so it flies dead level — and the six frames of tag 0 carry
   * `dx 0 25 25 25 25 50`, which through the seven is three pixels a frame and
   * then seven. `0x41aa30` writes `obj+0x1a = 0x14` every frame it is in the
   * air and `0x41aa60` takes it away at a thousand pixels from the player.
   *
   * And where it lands it is worth FIVE TIMES what it was worth flying:
   * `0x41aa7c` — tag 1, the splat — writes `obj+0x1a = 0x65`, zeroes both
   * velocities and waits for its own script to end. This page flies the throw
   * and draws the splat; a landed cast strikes nothing here, so the 101 is
   * carried and spends nothing.
   */
  throwing: {
    /** `[0x4a5170]` — the second machine, and the flag its wreck clears */
    machine: 1,
    /** `0x41c36d` — eighty along the facing */
    ahead: 0x50,
    /** `0x41c37e`/`0x41c386` — and it alternates between these two heights */
    drop: [0x8c, 0x28] as const,
    /** `0x41c0e4` — `0x434540(0x1e) + 0x1e`, spent whether or not it fires */
    wait: [0x1e, 0x1e] as const,
    /** `0x41c0c6` */
    sound: 0x1f,
    /** `0x46e0b8` tag 0, and `0x41a92b`'s `obj+0xe` */
    cels: [5610, 5611, 5612, 5613, 5614, 5615],
    strides: [0, 25, 25, 25, 25, 50],
    divisor: 7,
    /** `0x41aa30` */
    strength: 0x14,
    /** `0x41aa60` — a thousand from the player, the spitter's gob's own rule */
    reach: 0x3e8,
    /** `0x46e0b8` tag 1, which `0x41aa69` installs where it lands */
    splat: [5530, 5530, 5531, 5532, 5533, 5534, 5535, 5536, 5537],
    /** `0x41aa7c` — and the splat is worth five times the flight */
    splatStrength: 0x65,
    from: "0x41c330 / 0x46e0b8, class 0x41a910",
  },
  /**
   * The WORMS — `0x41c3c0`, class `[0x46e0a8]`, and the third of the three
   * records `levels.md` had nowhere to put.
   *
   * They are not a projectile. `0x41c3c0` drops one at the body's own point
   * plus a random offset, on a single cel, and there it WAITS; what wakes it is
   * you walking past. `0x41ac70` — the class's own setup — is where the record
   * comes in:
   *
   * ```
   *   41ac7f  push 0x46ec98           ; the string is "wormbounds"
   *   41ac8d  0x40b850(rec, 0, 0, buf); ...one record, read into a rect
   *   41aca2  [0x4a50c8] = rect       ; and 0x41ac16/0x41ac26 clamp every worm
   *   41ad02  0x430cc0(0x41ad20)      ; ...then the class is registered
   * ```
   *
   * So `wormbounds` is the box they are confined to, `0x41c3c8`'s
   * `cmp word ptr [eax+4], 0x13` caps them at nineteen alive, and the four
   * kinds of `0x41adf0` are one life: wait, rise, strike, sink.
   *
   * `0x41adf9` writes `obj+0x1a = 0x64` before the dispatch, so a worm is worth
   * a hundred from the frame it is dropped — the same as the bishop's bolt and
   * the boss's fireball, and the hardest thing in the game that never moves.
   */
  worms: {
    /** `0x41c0fd` — seven in fifty-five, once a frame */
    odds: [7, 0x37] as const,
    /** `0x41c3c8` — and never a twentieth */
    cap: 0x13,
    /** `0x41c10c` — `−30 − 0x434540(0x3c)` from the body in x... */
    offX: [-0x1e, 0x3c] as const,
    /** ...and `0x434540(0xa0) + 30` below it in y */
    offY: [0x1e, 0xa0] as const,
    /** `0x41ac7f` — the record every one of them is kept inside */
    bounds: "wormbounds",
    /** `0x41ad3e` — and `0x41ad6e` gives it no weight, which it never uses */
    divisor: 5,
    /** `0x41adf9` — written every frame, before the dispatch */
    strength: 0x64,
    /** `0x46e140` — one cel at twelve ticks, and it sits on it */
    sleep: { cels: [5670], hold: 12 },
    /** `0x41ae2c` — until you are this close in x */
    wake: 0xdc,
    /** `0x46e150` — the rise */
    rise: { cels: [5671, 5672, 5673, 5674, 5675, 5676, 5677, 5678], hold: 2 },
    /** `0x46e198` — the strike */
    strike: { cels: [5660, 5661, 5662, 5663, 5664, 5665, 5666, 5667], hold: 1 },
    /** `0x46e228` — and the sink, which is the rise backwards */
    sink: { cels: [5678, 5677, 5676, 5675, 5674, 5673, 5672, 5671], hold: 1 },
    /** `0x41ae97` — played ONCE a level, the first time one rises to your left */
    warn: 0x25,
    /** `0x41ae87` — and the warning wants you this close in y as well */
    warnBelow: 0xc8,
    /** `0x41aeb8` — every other rise */
    hiss: 0x16,
    /** `0x41aeeb` — over the strike ending */
    strikes: 0x17,
    from: "0x41c3c0 / 0x41ad20 / 0x41ac70",
  },
  /** `0x41b2a5` etc — every machinery object, and both halves of the arm */
  machineDivisor: 0x32,
  /** `0x41b628` / `0x41b774` — the cue that plays when the SECOND half goes */
  bothDownSound: 0x21,
  /** `0x46e770`, nine frames at three, and `0x41bd99` plays 0x22 over it */
  dies: { cels: [5740, 5741, 5742, 5743, 5744, 5745, 5746, 5747, 5748], hold: 3, sound: 0x22 },
  from: "0x411285 / 0x412240 / 0x41bb80 / 0x41bc50",
} as const;

/**
 * The SKATEBOARD — `0x438450`, class `0x437610`, script `0x473de8`.
 *
 * All four of the gang carry one and drop it as they die: `0x4383d9` out of
 * `initknotboy`'s hit handler, `0x43a6f9` out of `initknifeboy`'s, `0x43908e`
 * out of `initmaskboy`'s and `0x439af9` out of `initbatboy`'s. It is the
 * one object in the game whose whole life is physics — it hops, it falls, it
 * bounces, it slides to a stop and then it is swept up.
 *
 * ```
 *   43762d  obj+0xe = 5                 ; divisor
 *   437653  0x42f7a0(obj, 0.05f)        ; obj+0x1e — it barely slows at all
 *   437661  0x42f7f0(obj, 0.3f)         ; obj+0x20 — and it bounces low
 *   437627  ...and no 0x42f850, so the birth weight of ten stands
 *   473de8  tag 0: cel 2311, dx 15 dy -50 ; the hop, over the five
 *   4377c4  tag 0 -> tag 1 the frame a surface is under it (cel 2310)
 *   4377ea  ...and when THAT ends, obj+0x18 = 1: the countdown
 * ```
 *
 * ## Which is what `noskateboards` is for
 *
 * `0x437809` spends one frame of `AI+0xa` per frame and removes the board when
 * it goes negative, and `0x4385af` is where that word is seeded:
 *
 * ```
 *   4385af  push 0x475080              ; the string is "noskateboards"
 *   4385bd  0x40b660(rec, board, 1, 0) ; is the board's own point inside one?
 *   4385c2  mov word ptr [esi+0xa], 0xa    ; ...then it lasts TEN frames
 *   4385d0  mov word ptr [esi+0xa], 0xb4   ; ...and a hundred and eighty if not
 * ```
 *
 * So the record is not a lift and not a spawn table: it is a region where a
 * dropped board is swept away almost at once, and SERVICE places one. An
 * earlier reading of this page had the 10 and the 180 as a lift.
 */
export const SKATEBOARD = {
  /** `0x43762d` — `obj+0xe`, what the hop's own stride is divided by */
  divisor: 5,
  /** `0x473de8` tag 0 — the hop out, in the script's own pre-divisor units */
  hop: { cel: 2311, dx: 15, dy: -50 },
  /** `0x473de8` tag 1 — where it lies once a surface is under it */
  rest: 2310,
  /** `0x437653` — `0x42f7a0(0.05f)`, so it keeps almost none of its slide */
  friction: 0.05,
  /** `0x437661` — `0x42f7f0(0.3f)`, and the scale behind it flips the sign */
  bounce: 0.3,
  /** `0x437627` — no weight setter, so `0x42f5ca`'s ten is what it falls at */
  pull: 0xa,
  /** `0x4384c3` — it is put ten above the surface under the one that dropped it */
  lift: 0xa,
  /** `0x4385d0` / `0x4385c2` — frames it lies there, and the record picks */
  lasts: [0xb4, 0xa] as const,
  /** `0x4385af` — inside one of these it is the ten */
  sweptBy: "noskateboards",
  from: "0x438450 / 0x473de8, class 0x437610",
} as const;

/** one dropped board — {@link SKATEBOARD}, and nothing else makes one */
export interface Board {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** where it started, which only this page's own fall guard reads */
  bornY: number;
  /** true once a surface has been under it — `0x4377c4`, the cel changes */
  down: boolean;
  /** `AI+0xa` — frames left once it is down, and it is gone at −1 */
  life: number;
}

/**
 * The ROLLER — `0x43a790`, class `0x43a8a0`, think `0x43a960`, hit `0x43aa40`.
 *
 * The only hazard in the game a CREATURE builds. Everything else that rolls,
 * swings or falls is a record the level places; this one is made at runtime by
 * `initmaskboy` and by nothing else, which is why it has no `init*` name — it
 * is not in the class table under one, and no level can place it.
 *
 * ```
 *   43a793  cmp word ptr [0x474868], 0   ; the latch, and it bails if set
 *   43a7a5  0x433f20(0xc)                ; a twelve-byte AI struct
 *   43a7c8  0x42f7a0(obj, 0.1f)          ; obj+0x1e — it barely slows
 *   43a8d8  obj+0xe = 7                  ; the divisor
 *   43a8e5  obj+0x0 = 0x7b2              ; cel 1970
 *   43a81b  AI+8 = 0x28, AI+0xa = 0      ; the wait, and the counter
 *   43a841  [0x474868] = 1               ; ...and the latch is set
 * ```
 *
 * ## It waits before it rolls
 *
 * The creator does NOT launch it. `0x43a99b` — state 1, which is the kind of
 * the script the creator installs — counts `AI+8` down from forty and only
 * then installs `0x4747e8` and calls `0x42f8b0(obj, AI+4)`, the packed velocity
 * the spawner stored. So there are forty-one frames of cel 1970 sitting where
 * it was born before it moves at all, which is the warning the room gets.
 *
 * `0x43a9dc` clears the latch on that same frame rather than when the thing
 * dies — so the keeper may start a second one the moment the first rolls, and
 * the latch is a "one WAITING", not a "one alive".
 *
 * ## And it is only worth something while it is fast
 *
 * `0x43a97d` is the think's common tail and it writes `obj+0x1a` every frame:
 * a hundred while `|obj+0xc|` is over ten, and `0x43aa34` writes **zero** once
 * it is not. The same shape as `initwbooly`'s fireball ({@link CastKit.fastBlow}),
 * and the reason a roller that has slid to a stop is scenery.
 */
/**
 * The Coke can — `0x43b780` builds it, `0x43ae00` is its class and `0x43af00`
 * is the whole of its life.
 *
 * It is the third thing on this page that belongs to nobody's hand (the
 * skateboard and {@link ROLLER} are the others) and the only one that turns
 * into something else: what it leaves behind is a PICKUP.
 *
 * ## Out of the machine
 *
 * `0x43b780` copies the machine's own point, then `0x43b7e2` turns it AWAY
 * from you — `obj+0x28` stays 0 when the player is left of the machine and
 * goes to 1 when he is not — and installs `0x474ce0` tag 0, whose first record
 * is the only one in the script that carries a stride: `dx 120, dy -70` over
 * the class's own divisor of five (`0x43ae0e`). So a can leaves at 24 across
 * and 14 up, and everything after that is gravity.
 *
 * `0x43ae34` gives each one its own drag: `1.0 - (0x434540(4) + 5) * 0.1`,
 * which is one of 0.4, 0.3, 0.2 and 0.1. A can keeps a tenth to two fifths of
 * its speed per frame once it is down, so they all stop, and none of them
 * stops in quite the same place.
 *
 * ## ...and into a pickup
 *
 * `0x43af00`'s four tags are one animation and two endings. Tag 0 tumbles
 * 8600..8610, tag 1 rolls 8611..8614, and then `0x43af4e` rolls `0x434540(3)`
 * to pick between going round tag 1 again and settling on tag 2 or tag 3. Both
 * of those wait for `obj+0x30` — the ground — and then do the same two things:
 *
 * ```
 *   43af80  0x45af60(2, point, 0, 0x43aff0)   a code-2 pickup, where it lies
 *   43af90  0x45d090(self, 0x474d70, tag)     ...and the can holds still
 * ```
 *
 * The pickup is INVISIBLE: `0x45afa3` only re-cels codes 6..17, so a 2 keeps
 * the default 14000 and no book in the game carries that cel. The can lying
 * there IS the art, which is why both objects have to exist. `0x43aff0` is the
 * other half of that: taking the pickup walks the can list for one at the same
 * point and sets its state to 2, which is the one case of `0x43af00` that
 * answers 1 and has the can removed.
 *
 * What a code 2 is worth is `0x428868`'s hundred and fifty health — see
 * `GUN_CODES` in {@link file://./guns.ts}, which has carried the case since
 * before there was anything in the game that dropped one.
 */
/**
 * Catching FIRE — `0x44ff20`, and it is what a blow of −9 means.
 *
 * −9 is the one strength that is not a number and not one of the player's own
 * codes either: it falls below `0x448c84`'s range test, so against the PLAYER
 * it lands as ordinary damage, and against a CREATURE it is read by eight
 * handlers of their own that accept nothing else. The flamer's flame carries it
 * (`0x453b9b`), and so does a flare on stage 5 (`0x43ac04`).
 *
 * ## What the code does is stick a flame to you
 *
 * `0x44ff20(victim, late, forever)` is the shared half, and all eight call it
 * before doing anything of their own:
 *
 * ```
 *   44ff42  0x42f9f0(victim)              the victim's own cel BITMAP box
 *   44ff59  bp = |x1 - x0| / 2            ...and half of each side of it
 *   44ff8c  0x430d40([0x4789d0], user)    a flame on the flame class's list
 *   44ff9b  user+8 = victim               which is what it hangs off
 *   44ffa5  user+6 = roll(bp) - bp/2      at a random point inside that box...
 *   44ffc6  user+4 = roll(bh) - bh/2      ...on both axes
 *   44ffe2  late ? 0x478978 tag 2 : 0x4788d0 tag 0
 * ```
 *
 * So a flame is not an effect drawn over a creature — it is an object with its
 * own position, parked at a random point in whatever the victim's current cel
 * happens to cover, and `0x453ea0` moves it with the victim every frame
 * afterwards (mirroring its offset by the victim's own facing).
 *
 * **It carries a hundred.** `0x453dcb` writes `obj+0x1a = 0x64` at birth and
 * `0x453eed` writes it again every single frame, so a burning creature is
 * standing next to a live strike box for as long as it burns.
 *
 * ## Three stages, and one of them can be forever
 *
 * `0x4788d0` tag 0 grows it, tag 1 burns, and `0x478978` tag 2 — three engine
 * frames a cel rather than one — is it going out. `0x453f6f` is the whole of
 * the `forever` argument: at the end of tag 2 a flame whose `user+2` is set
 * installs tag 2 again instead of answering 1, so it never stops. One caller
 * passes it, and it is the one for a boss that is already dead.
 *
 * The art is in CITY, PLAYGR, VAT and WOODS — the four books that need it,
 * which is the check that this reading is the right way round.
 */
export const FLAME = {
  /** `0x4788d0` tag 0 — ten cels of it taking hold */
  grow: {
    cels: [9600, 9601, 9602, 9603, 9604, 9605, 9606, 9607, 9608, 9609],
    hold: 1,
    from: "0x4788d0 tag 0",
  },
  /** tag 1 — and ten of it burning */
  burn: {
    cels: [9610, 9611, 9612, 9613, 9614, 9615, 9616, 9617, 9618, 9619],
    hold: 1,
    from: "0x4788d0 tag 1",
  },
  /** `0x478978` tag 2 — ten of it going out, at THREE frames a cel */
  fade: {
    cels: [9620, 9621, 9622, 9623, 9624, 9625, 9626, 9627, 9628, 9629],
    hold: 3,
    from: "0x478978 tag 2",
  },
  /** `0x453dcb`, and `0x453eed` writes it again every frame */
  blow: 0x64,
  /** `0x453de6` — `obj+0xe`, though nothing ever spends a stride through it */
  divisor: 5,
  from: "0x44ff20 / 0x453db0 / 0x453ea0, class [0x4789d0]",
} as const;

/** one flame, hanging off whatever it was lit on */
export interface Flame {
  /** the thing it burns on — `user+8`, and a flame with none removes itself */
  on: object;
  /** `user+6`, mirrored by the victim's facing — `0x453eb7` */
  dx: number;
  /** `user+4`, which is not mirrored */
  dy: number;
  /** which of the three it is playing */
  stage: 0 | 1 | 2;
  /** engine frames into that */
  clock: number;
  /** `user+2` — `0x453f6f`, and it never goes out */
  forever: boolean;
  /** `obj+0x28`, the victim's facing when it caught — `0x44ffee`, written once */
  mirror: boolean;
  x: number;
  y: number;
}

export const CAN = {
  /** `0x43ae0e` — `obj+0xe`, what the one stride in the script is divided by */
  divisor: 5,
  /** `0x474ce0` tag 0 frame 0, and the only record in the script with a stride */
  launch: { dx: 120, dy: -70, from: "0x474ce0 tag 0 frame 0" },
  /** tag 0 — eleven cels of it turning over, one engine frame each */
  tumble: {
    cels: [8600, 8601, 8602, 8603, 8604, 8605, 8606, 8607, 8608, 8609, 8610],
    hold: 1,
    from: "0x474ce0 tag 0",
  },
  /** tag 1 — and four more, which `0x43af4e` may come back round to */
  settle: { cels: [8611, 8612, 8613, 8614], hold: 1, from: "0x474ce0 tag 1" },
  /** `0x474d70` tags 0 and 1 — the two cels a stopped can is allowed to be */
  rests: [8600, 8611],
  /** `0x43ae3c` — `1.0 - (roll(4) + 5) * 0.1`, spent the way `0x4302c0` spends one */
  drags: [0.4, 0.3, 0.2, 0.1],
  /** `obj+0x24`, which the constructor never writes, so `0x42f5ca`'s own ten */
  pull: 10,
  /** `0x45b004`/`0x45b010` — the pickup's own band, and it is not `GRAB.bandPx` */
  reach: 0x37,
  /** what `0x43af80` asks `0x45af60` for */
  code: 2,
  from: "0x43b780 / 0x43ae00 / 0x43af00 / 0x474ce0 / 0x474d70",
} as const;

/** one can, from the frame the machine lets it go */
export interface Can {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** engine frames into the tag playing */
  clock: number;
  /** which tag of `0x474ce0`: 0 tumbling, 1 rolling, 2 and 3 waiting to land */
  tag: number;
  /** its own share of {@link CAN.drags} */
  drag: number;
  /** the cel it came to rest on, once it has — and the pickup exists from then */
  rest?: number;
}

export const ROLLER = {
  /** `0x43a8d8` — `obj+0xe`, what the launch velocity is divided by */
  divisor: 7,
  /** `0x43a8e5` — the cel it waits on, and the first of the two it rolls on */
  waits: 1970,
  /** `0x4747e8` tag 0 — the roll, two cels at one frame each */
  rolls: { cels: [1970, 1971], hold: 1, from: "0x4747e8 tag 0" },
  /** `0x43a81b` — `AI+8`, counted down before `0x42f8b0` is ever called */
  wait: 0x28,
  /**
   * `0x43a7c8` — `0x42f7a0(0.1f)`, and it is never spent.
   *
   * `0x4302c0` lives in the mover's contact arm and `0x42fdba` skips that arm
   * while `obj+0xa` is zero or less. Nothing gives a roller a weight, so its
   * `vy` never leaves zero, it never stands on anything, and the drag sits in
   * `obj+0x1e` unread for its whole life. Carried because it IS written.
   */
  friction: 0.1,
  /** `0x43a993` — what it is worth while it is moving */
  strength: 0x64,
  /** `0x43a986` — and `0x43aa34` takes that away at ten or under */
  fastBlow: 0xa,
  /** `0x43a9d7` — the cue on the frame it starts to roll */
  sound: 0x21,
  /** `0x43a82c` — and the one when it is built */
  bornSound: 0x46,
  from: "0x43a790 / 0x4747d8 / 0x4747e8, class 0x43a8a0",
} as const;

/** the one roller a level may have — {@link ROLLER}, and only `initmaskboy` makes it */
export interface Roller {
  x: number;
  y: number;
  vx: number;
  /** `AI+8` — frames left before it is launched, and it rolls at −1 */
  wait: number;
  /** its own clock, for the two cels of {@link ROLLER.rolls} */
  clock: number;
}

export interface Boggs {
  x: number;
  y: number;
  clock: number;
  /** what is left of {@link BOGGS.health}, and it climbs back — `0x4a50e8` */
  hp: number;
  /** which way it is lunging, or null while it is on its idle — {@link BOGGS.lunge} */
  lunge: "left" | "right" | null;
  /** `obj+0xc`, pixels a frame — the lunge's impulses, spent by the ground's drag */
  vx?: number;
  /** `[0x4a50d2]`..`[0x4a50d6]` — its record's two x, which `0x41bb40` keeps it between */
  span?: [number, number];
  /** the eight of {@link BOGGS.machines}, in the order that table lists them */
  machines: BoggsMachine[];
  /**
   * `0x46e080` and `0x46e084`, which ship set and are only ever cleared. While
   * either is true Boggs heals {@link BOGGS.regen} a frame.
   */
  flags: [boolean, boolean];
  /** the head's own clock, which re-aims every {@link BOGGS.head.hold} frames */
  headClock: number;
  /** which of {@link BOGGS.head.look} it is showing — `0x41c182`'s `bx` */
  headTag: number;
  /** `0x46e558` on the jaws, counting down while `0x41c164`'s snap plays */
  snap: number;
  /** `0x46bfbc` — set once, by `0x41bdd8`, and the body and head go to their deaths */
  dying: boolean;
  /** where `initboggshead`'s own record put the head, and it stays there */
  headX: number;
  headY: number;
  /** `[0x46e0b0]` — frames to the next throw, spent whether or not it fires */
  throwWait: number;
  /** `[0x46e138]` — which of {@link BOGGS.throwing.drop} the next one leaves at */
  throwDrop: number;
  /** `[0x46e0a8]`'s own list — {@link BOGGS.worms}, capped at nineteen */
  worms: BoggsWorm[];
  /** `[0x46e270]` — the one-time warning, spent the first time one rises */
  warned: boolean;
  /** the `wormbounds` record, which `0x41ac16` keeps every worm inside */
  bounds: { left: number; right: number; top: number; bottom: number } | null;
}

/**
 * One of {@link BOGGS.worms} — dropped, and then it waits for you.
 *
 * `kind` is the script's own, which is the whole of its state machine:
 * `0` waiting on `0x46e140`, `1` rising on `0x46e150`, `2` striking on
 * `0x46e198` and `4` sinking on `0x46e228`. Kind 3 has a handler at `0x41aeff`
 * and nothing anywhere installs it — the same shape of dead arm as the
 * machines' dented cels.
 */
export interface BoggsWorm {
  x: number;
  y: number;
  kind: 0 | 1 | 2 | 4;
  clock: number;
}

/** one of {@link BOGGS.machines}, placed once and then standing still */
export interface BoggsMachine {
  x: number;
  y: number;
  clock: number;
  /** what is left of its `health`, for the two that have one */
  hp: number;
  /** true once its `hp` reached zero and its wreck run was installed */
  wrecked: boolean;
  /** frames into the wreck run, or -1 while it is still whole */
  wreckClock: number;
}

/**
 * TOWER's LIGHTNING — `initlightfx`, and it is the one class in the game that
 * nothing places and nothing triggers. It happens to you.
 *
 * `0x41e450` collects the records at setup and keeps only the COUNT, at
 * `0x46f644`, with the records themselves left in the buffer at `0x4a5888`.
 * Nothing spawns them there. What spawns them is the level's own per-frame
 * function, `0x426800`, which is a metronome:
 *
 * ```
 *   426800  dx = [0x46f680]          ; the counter, before the increment
 *   42680e  [0x46f680]++
 *   426815  if (dx > 0xc8) {
 *   42681c     [0x46f680] = 0        ; ...so the period is 202 engine frames
 *   426829     every object in [0x46ecc8] gets user[0] = 1
 *           }
 *   426837  if ([0x46f680] != 0xc3) return
 *   426842  0x426870()               ; stand up one object per record
 *   426857  0x40f090(0x4a5870, 0x37, player.y)
 *   426861  0x40e4c0(0)              ; and flood the window with palette 0
 * ```
 *
 * `0x4268c0` is what each record becomes: an object at the record's own point,
 * mirrored when the param is NEGATIVE (`0x4268fa` takes the sign into
 * `obj+0x28`), playing tag `|param| - 1` of `0x46f588`. TOWER's two records
 * carry 1 and -1, so both play tag 0 and one of them is flipped — the two
 * halves of a single fork of lightning, 460 pixels apart.
 *
 * The flash is `0x40e4c0(0)`, which queues a colour for `0x40dfd0` to flood the
 * whole view rect with on the next paint and then clears itself (`0x40e0b0`
 * fills 232 rows with the panel up and 342 without). Colour 0 in TOWER's own
 * palette is pure blue.
 *
 * The other two tags of `0x46f588` — cels 620..622 and 5630..5635 — have no
 * record anywhere in the sixteen books, so nothing in the shipped game plays
 * them.
 */
export const LIGHTFX = {
  /** `0x426815`'s `cmp dx, 0xc8` — engine frames from one strike to the next */
  period: 0xc8 + 2,
  /** `0x426837`'s `cmp [0x46f680], 0xc3` — where in the period it strikes */
  strikeAt: 0xc3,
  /** `0x46f588` tag 0 — eleven cels at two frames each, out and back again */
  bolt: {
    cels: [9081, 9082, 9083, 9084, 9085, 9086, 9085, 9084, 9083, 9082, 9081],
    hold: 2,
    from: "0x46f588 tag 0",
  },
  /** `0x426850` — `tower.snd`'s own thunder, played at the PLAYER's y */
  sound: 0x37,
  /** `0x426861` — the colour `0x40e4c0` floods the window with for one frame */
  flash: 0,
  from: "0x41e450 / 0x426800 / 0x426870 / 0x4268c0",
} as const;

/** one `initlightfx` record, standing up every {@link LIGHTFX.period} frames */
export interface LightFx {
  x: number;
  y: number;
  /** `0x4268fa` — the param's SIGN, not a facing the record states */
  mirror: boolean;
  /** frames into {@link LIGHTFX.bolt}, or -1 while there is no bolt */
  clock: number;
}

/**
 * MAZE's BIG GUN — `initbiggun`, a hatch in the ceiling with a turret behind it.
 *
 * `0x410d54` collects the records and `0x4115b0` turns each one into TWO
 * objects at the same point: the turret ten pixels above it (`sub word ptr
 * [edi-4], 0xa` on the copy of the point, and the LOW word of a point is its y)
 * on script `0x46c1e8`, and the hatch on the point itself on `0x46c238`. Both
 * carry the record's rect in their own user block, and `0x413570`'s preamble
 * pins x back to it every frame.
 *
 * One handler serves both, `0x4135b0`, dispatching on the script's KIND through
 * the table at `0x413930` — which is how two objects and seven scripts make one
 * machine:
 *
 * ```
 *   kind 7  0x41387c  the HATCH, and its four tags are its whole life
 *             tag 0   shut; player's point inside the rect -> tag 1
 *             tag 1   opening, 10070..10074 -> tag 2 when it ends
 *             tag 2   held open -> tag 2 again while you stay, else tag 3
 *             tag 3   shutting -> tag 0
 *   kind 0  0x4135f7  the turret, waiting: in the rect -> tag 1 (16 frames)
 *                     ...and when THAT ends, script 0x46c350 -> kind 1
 *   kind 1  0x41365f  descend 8 a frame until 0x6e below the record's point
 *   kind 2  0x413692  unfold, 10080..10086 -> kind 3, or kind 5 if you left
 *   kind 3  0x4136e3  FIRE: tags 0 and 1 each play tower's own 3 and call
 *                     0x412a70 — the blaster's bolt — then tag 2 -> kind 4
 *   kind 4  0x4137b4  blink 10100/10101; still in the rect -> kind 3, else 5
 *   kind 5  0x413830  fold back, 10086..10080 -> kind 6
 *   kind 6  0x413851  rise 8 a frame until it is home again -> kind 0
 * ```
 *
 * Every one of the five that tests the rect tests it the same way and bails to
 * kind 5 the moment the player is outside it, so walking back out of the rect
 * stops the gun wherever it had got to. The two records' rects are 835 pixels
 * wide and the gun is in the middle of each.
 *
 * What it fires is the BLASTER's bolt and not a shot of its own: `0x412a70` is
 * the same function the armed player's state machine calls, so the bolt's speed,
 * its scatter and its own code all come from {@link BLASTER}.
 */
export const BIGGUN = {
  /** `0x4115ec` — the turret sits ten pixels above the record's point */
  turretUp: 0xa,
  /** `0x46c238`, the hatch: tag 0 shut, tag 1 opening, tag 2 held, tag 3 shutting */
  hatch: {
    shut: 10070,
    open: { cels: [10070, 10071, 10070, 10071, 10072, 10073, 10074], hold: 1, from: "0x46c238 tag 1" },
    held: { cels: [10074, 10074, 10074, 10074, 10074, 10074], hold: 1, from: "0x46c238 tag 2" },
    close: {
      cels: [
        10074, 10074, 10074, 10074, 10074, 10074, 10074, 10074, 10074, 10074, 10074, 10074, 10074, 10074,
        10073, 10072, 10071, 10070, 10071, 10070,
      ],
      hold: 1,
      from: "0x46c238 tag 3",
    },
  },
  /** `0x46c1e8` tag 1 — eight frames at two, which is the wait before it drops */
  wait: { cels: [10080], hold: 2, frames: 8, from: "0x46c1e8 tag 1" },
  /** `0x413663` and `0x413855` — pixels a frame, down and back up */
  step: 8,
  /** `0x413671`'s `add ecx, 0x6e` — how far below the point it stops */
  drop: 0x6e,
  /** `0x46c360` tag 0 — unfolding */
  unfold: { cels: [10080, 10081, 10082, 10083, 10084, 10085, 10086], hold: 1, from: "0x46c360 tag 0" },
  /** `0x46c428` tag 0 — and the same run backwards */
  fold: { cels: [10086, 10085, 10084, 10083, 10082, 10081, 10080], hold: 1, from: "0x46c428 tag 0" },
  /** `0x46c3a0` — tag 0 fires, tag 1 fires, tag 2 is the recovery */
  fire: {
    one: { cels: [10090, 10091], hold: 1, from: "0x46c3a0 tag 0" },
    two: { cels: [10092, 10093, 10094], hold: 1, from: "0x46c3a0 tag 1" },
    done: { cels: [10095, 10096], hold: 1, from: "0x46c3a0 tag 2" },
  },
  /** `0x46c3e0` tag 0 — eight frames of blinking between shots */
  blink: { cels: [10100, 10101, 10100, 10101, 10100, 10101, 10100, 10101], hold: 1, from: "0x46c3e0 tag 0" },
  /** `0x41373c` / `0x413770` — `maze.snd`'s own, once a shot */
  sound: 3,
  from: "0x410d54 / 0x4115b0 / 0x4135b0",
} as const;

/** which of {@link BIGGUN}'s eight states a gun is in — the script KINDS, named */
export type BigGunState = "wait" | "arm" | "drop" | "unfold" | "fire" | "blink" | "fold" | "rise";

/** one `initbiggun` record: a hatch and the turret behind it, as one thing */
export interface BigGun {
  x: number;
  /** the record's own point — where the turret is home and the hatch lives */
  y: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  state: BigGunState;
  /** frames into whichever run {@link BigGun.state} names */
  clock: number;
  /** the turret's own y, which only {@link BigGun.state} `drop` and `rise` move */
  gunY: number;
  /** which of `0x46c3a0`'s three tags the fire is on */
  shot: number;
  /** `0x46c238`'s tag, which the hatch keeps whatever the turret is doing */
  hatch: number;
  hatchClock: number;
}

/**
 * A `probe` is a TRIGGER, and what it fires is a flypast.
 *
 * `0x40b526` fills a buffer at `0x4a9ce0` with every `probe` record, 48 bytes
 * apiece, and keeps the count at `0x46b9c0`. `0x4280d2` walks that buffer once a
 * frame, tests the player's point against each record's rect (`0x434200`), and
 * on a hit calls `0x410170` with the record's own `param` as a MODE and then
 * `0x402e80` to shift the rest of the table down over it — so a probe fires once
 * per level load and never again. The seventeen shipped records carry four
 * values between them: 0 eight times, 1 four, 2 three and 3 twice.
 *
 * `0x410170` is the same spawner the goal's television comes out of, switched on
 * `mode + 1`, and every mode builds on `PLAYER.SBK` rather than the level's own
 * book — which is why no level book carries the cels.
 *
 * ```
 *   mode 0/1  0x41023c  script 0x46bdf0 tag 0, cels 20200..20207, dx 15
 *             x += mode ? +0x200 : -0x200, and the mode IS the mirror flag
 *   mode 2    0x41029c  tag 1, cels 20210/20211, y += 0x100 below you, vy = -10
 *   mode 3    0x4102fc  tag 1, y -= 0x100 above you, vy = +10
 * ```
 *
 * ## The divisor was the missing word, and it is one
 *
 * This page could not build any of it for a long time, because `0x45d1a3`'s
 * mover (`0x42f8b0`) does `idiv [obj+0xe]` twice and nothing found wrote that
 * word: `0x42f550` zeroes it, `0x410170` never touches it and `0x45d090` writes
 * only the kind. A shipped game does not divide by zero, so something had to.
 *
 * It is the class's own constructor message. `0x430cc0(0x4103c0)` builds the
 * list these objects live on, and `0x4103c0` case 1 — the message every new
 * object gets — writes **1** into `obj+0xe`, along with the book (`0x4abe10`),
 * the first cel (20200), no gravity (`0x42f850(obj, 0)`) and no bounce. A
 * divisor of one is the fastest there is: the script's own `dx` goes into the
 * velocity undivided.
 *
 * ## ...and what it then does is three comparisons
 *
 * `0x410480` is the think, and it is short:
 *
 * ```
 *   410486  clamp obj+0xc to +-0x1b        ; 27 a frame across, and no more
 *   4104ce  tag 0: 512 past the player by x -> gone
 *   410510         script ended -> tag 0 again
 *   410531  tag 1: face the player, clamp obj+0xa to +-0x17
 *   410567         256 past the player by y -> gone
 * ```
 *
 * None of the ten cels carries a strike box, so a flypast cannot touch you. It
 * is scenery with a trigger: something crossing the sky, or the television
 * arriving from under your feet or down out of it.
 */
export const PROBE = {
  /** `0x4103e2` — the word that was missing, and a divisor of one divides nothing */
  divisor: 1,
  /** `0x46bdf0` tag 0 at three ticks a frame, and every frame of it carries dx 15 */
  cross: { cels: [20200, 20201, 20202, 20203, 20204, 20205, 20206, 20207], hold: 3, dx: 15, from: "0x46bdf0 tag 0" },
  /** tag 1 — the television's own hovering pair */
  hover: { cels: [20210, 20211], hold: 3, from: "0x46bdf0 tag 1" },
  /** `0x41025c` — half a screen to one side of you, and which side is the mode */
  sideX: 0x200,
  /** `0x4102aa` and `0x41030a` — and 256 under or over */
  offsetY: 0x100,
  /** `0x4102b0` / `0x410310` — they set ten, and the think below raises it */
  startVy: 0xa,
  /** `0x410552` / `0x410575` — the vertical ceiling, both ways */
  maxVy: 0x17,
  /** `0x410486` — and the horizontal one */
  maxVx: 0x1b,
  /** `0x4104e4` / `0x410501` — how far past you one lives */
  goneX: 0x200,
  /** `0x410567` / `0x41058a` */
  goneY: 0x100,
  /** `0x410276` and `0x410289` — the player's own bank, one index per character */
  sound: [0x1e, 0x17],
  from: "0x40b526 / 0x4280d2 / 0x410170 / 0x4103c0 / 0x410480",
} as const;

/** one `probe` record, waiting to be walked into — and it fires once, ever */
export interface Probe {
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** the record's own `param`, which is the MODE `0x4101a3` switches on */
  mode: number;
  /** `0x402e80` shifts the record out of the table, so this never fires twice */
  fired: boolean;
}

/** what a probe fires: one object on `PLAYER.SBK`'s own cels, and it touches nothing */
export interface Flypast {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** `0x410190` — the mode, and for the crossing pair it is also the mirror */
  mirror: boolean;
  /** which tag of `0x46bdf0` is playing: 0 crosses, 1 hovers */
  tag: 0 | 1;
  clock: number;
}
