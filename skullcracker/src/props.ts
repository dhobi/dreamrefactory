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
 *   0  idle      1160          waits on obj+0x46; on it, sound 9 and a DIRECTION:
 *                              tag 3 if the far end is below, tag 1 if above
 *   1  starting  1160 x3, 1163 one beat, then tag 2
 *   2  down      1161 1162 1163  moves +0x28 a frame and re-installs itself until
 *                              the end is reached: then sound 10 and back to tag 0
 *   3  starting  1160 x3, 1161 the mirror of 1, then tag 4
 *   4  up        1163 1162 1161  moves -0x28 a frame, otherwise as tag 2
 * ```
 *
 * `0x28` is 40, and 40 over the divisor of 10 is **four pixels an engine frame** —
 * 60 a second, a little over half the player's walk. The two sounds are
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
   * The CAR, and it is one cel: `mov word ptr [esi], 0x47e` at `0x4533c3` sets the
   * object's base cel to 1150 and nothing ever installs a script over it.
   */
  car: { cels: [1150], from: "obj+0 = 0x47e at 0x4533c3" },
  /** tag 0 — the winch at rest */
  idle: { cels: [1160], hold: 3, from: "0x477db0 tag 0" },
  /** tags 1 and 3 — one beat of wind-up before either direction */
  starting: { cels: [1160, 1160, 1160, 1163], hold: 3, from: "0x477db0 tags 1/3" },
  /** tag 2 — travelling with `+0x28` a frame */
  down: { cels: [1161, 1162, 1163], hold: 3, from: "0x477db0 tag 2" },
  /** tag 4 — travelling with `-0x28` a frame */
  up: { cels: [1163, 1162, 1161], hold: 3, from: "0x477db0 tag 4" },
  /** `mov word ptr [esi+0xe], 0xa` at `0x4533bd` — and so not the player's 12 */
  divisor: 10,
  /** `mov word ptr [esp+8], 0x28` at `0x45351f` — 40 raw, four pixels a frame */
  speed: 40,
  /**
   * How far below the head of its shaft a car stops — `add ecx, 0xc8` at
   * `0x453606`, where `ecx` is the shaft's top and the comparison is against the
   * car's own y. Travel UP runs while `y >= top + 200`, so the last 200 pixels of
   * the rect are not travel at all: they are the room the winch and its cable
   * need. Down has no such margin (`0x453549` tests the bottom outright), which
   * is why a car at rest sits exactly on its landing.
   */
  headroom: 200,
  /** `0x40ef30(bank, 9, pos)` — on departure */
  soundStart: 9,
  /** `0x40ef30(bank, 0xa, pos)` — on arrival */
  soundStop: 10,
  /** eighteen frames of rest at each end — tag 0's six cels at three ticks — before it goes again */
  pause: 18,
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
  /**
   * The platform the car is. Created by this port rather than read, because the
   * disc has none for it — see the block comment. It is a live record in the
   * room's `platforms`, so moving it moves the floor and the rider with it.
   */
  floor: { top: number; bottom: number; left: number; right: number };
}

/** the cel the WINCH is showing — the car is always {@link ELEVATOR.car} */
export function elevatorCel(e: Elevator): number {
  const a = ELEVATOR[e.state];
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
 * Each handler installs the next tag and flips `ctx+6`'s low bit, which is the
 * side it swings from, so consecutive passes alternate. `obj+0x1a` is set to 100
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
  /** `0x40ef30(bank, 7, pos)` on entering tag 2 */
  sound: 7,
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
  /** `ctx+6`'s low bit: which side this pass swings from, flipped at every tag */
  side: 0 | 1;
}

/** which cel a girder is showing */
export function ibeamCel(b: Ibeam): number {
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
  /** `0x43a695` and its three counterparts — one sound for being fed */
  fedSound: 11,
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
  /** every tag is this one cel; the script is a clock, not an animation */
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
 *   kind 2  1221 … 1225        closing; at the end, back to shut
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
  /** kind 2 — and down, one cel shorter */
  closing: { cels: [1221, 1222, 1223, 1224, 1225], hold: 2, from: "0x478820" },
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
 * `dx -10, dy -20` on the way back, and the think keeps it honest: it clamps the
 * horizontal velocity to ±7 and walks the barrel three pixels a frame back
 * towards the x its record gave it, so it wallows around its own point instead
 * of drifting off down the sewer.
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
  /** `mov word ptr [esi+0xe], 0xa` at `0x43fb7b` */
  divisor: 10,
  /** `0x43fc80` / `0x43fc8e` — the horizontal velocity is held inside this */
  drift: 7,
  /** `0x43fca6` — and it walks this far back towards its own point each frame */
  home: 3,
  from: "0x435d20 / 0x43fb60 / 0x43fc30",
} as const;

/** one floating barrel, with the platform it claimed */
export interface Barrel {
  x: number;
  y: number;
  /** where its record put it, which it keeps drifting back to */
  homeX: number;
  homeY: number;
  clock: number;
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
 * What it does when you come near is not here, and the reason to say so
 * precisely is the two constants: `0x43ee9d` and `0x43eedb` write **-3** and
 * **-5** into `obj+0x1a`, and a negative strength is not damage — it is a code.
 * The one other place a negative shows up is `0x43d25c`, where level seven's big
 * one swallows a blow of exactly -6. So these are grabs, and the handler that
 * reads them is the player's.
 */
export const BUSH = {
  /** `0x472b70` tag 0 — what it does while it is waiting */
  idle: { cels: [5060, 5061, 5062, 5063, 5064, 5065], hold: 1, from: "0x472b70 tag 0" },
  /** `0x435bf7` — the object hangs this far below the record's point */
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
  facing: number;
  onGround: boolean;
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
 * That last part needs the boss's state machine, three thousand bytes at
 * `0x440ab0`, which this page does not drive. The seven positions and the
 * column's own cels are here; nothing yet sends one up.
 */
export const SPRINKLER = {
  /** `0x473748` tag 0 — up it comes */
  rise: { cels: [150, 151, 152, 153, 154, 155, 156], hold: 2, from: "0x473748 tag 0" },
  /** tag 1 — and this is what it does while it is up */
  spray: { cels: [157, 158, 157, 158, 156, 157, 158, 157, 158, 156, 157, 156], hold: 2, from: "0x473748 tag 1" },
  /** `mov word ptr [eax], 0x15e` at `0x441ba3` — the context's own first word */
  life: 350,
  /** `mov di, 7` at `0x441b68` — how many slots there are, and how many tries */
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
 * flags. No button, no facing, no range band. This page does the first test and
 * not the second, and takes the boxes as drawn.
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
 *   near   0x4704d0 tag 1             the frame your x comes within 100 of its
 *   open   0x4704e8 tag 0, 3310..3319 and now it PULLS: 0x4211af halves your
 *                                     horizontal velocity and 0x4211c4 adds one
 *                                     to your fall every frame
 *   held   0x470540 tag 0, cel 3319   the hole, standing open
 * ```
 *
 * and then `0x42120c`: once the player is **86 pixels below the grave's own
 * point**, `0x402fa0(5)` — the same call that ends the player anywhere else.
 * There is no health subtraction anywhere in the class. You do not get hurt by
 * a grave, you fall into it.
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
  /** `0x4211c4`'s `inc word ptr [eax+0xa]` — one unit of fall a frame */
  pullPerFrame: 1,
  /** `0x4211af` — and half your speed along with it */
  dragHalves: true,
  from: "0x41f0e0 / 0x420f90 / 0x421040",
} as const;

export interface Hole {
  x: number;
  y: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** "shut" until the player is inside 100, then it opens and stays open */
  state: "shut" | "opening" | "open";
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
 * seconds a frame, and that pause is the whole of the hazard. `0x420dc6` lets it
 * go early — after 20 frames, but only if it has hold of something.
 *
 * Its blow strengths are `0xfffd` and `0xfff9` — **−3 and −7**. Those are codes
 * and not damage, the same kind of number `initbush`'s grab carries and the same
 * kind the flamethrower's flame carries; what they mean is the receiving
 * handler's business, and this port does not carry them. So a hand rises, holds
 * and sinks, and cannot yet take hold of anything.
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
 * A 220x25 record laid across a gap, and three states:
 *
 * ```
 *   whole   0x46ecf8 tag 0, cel 750
 *   rocking 0x46ed08 tag 0, 750 751 750 751   `0124 bridge cru[mbles]`
 *   gone    0x46ed30 tag 0, 751..754          then tag 1 (755) and tag 2 (756)
 * ```
 *
 * and the test that starts it (`0x4223c5`) is the player on the ground, within
 * 300 of it, and EITHER a counter at `user+0xc` past five — how long you have
 * been on it — or a fall of more than a hundred onto it. So you can cross one
 * if you keep moving, and you cannot stand on one.
 */
export const BRIDGE = {
  whole: 750,
  /** `0x46ed08` tag 0 — the warning, and it is two cels alternating */
  rocking: { cels: [750, 751, 750, 751], hold: 1, from: "0x46ed08 tag 0" },
  /** `0x46ed30` tag 0 then 1 then 2 */
  falling: { cels: [751, 752, 753, 754], hold: 2, from: "0x46ed30 tag 0" },
  gone: 756,
  /** `0x4223e0`'s `cmp ecx, 0x12c` */
  reachPx: 300,
  /** `0x4223f5`'s `cmp word ptr [edx+0xc], 5` — engine frames of standing */
  standFrames: 5,
  /** `0x422401`'s `cmp word ptr [eax+0x32], 0x64` — or one hard landing */
  fallPx: 100,
  /** `0x4222e1` */
  divisor: 10,
  from: "0x41e9c0 / 0x4222b0 / 0x422370",
} as const;

export interface Bridge {
  x: number;
  y: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  state: "whole" | "rocking" | "falling" | "gone";
  /** how many engine frames the player has been standing on it */
  stood: number;
  clock: number;
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
 * `0x42703e` writes 5 into `obj+0x10` — the floor offset — on the way through,
 * and `0x427100` gives what is left a divisor of 10 and gravity 3.0. Then the
 * rect test again, and the player goes with it.
 */
export const FLOOR = {
  whole: 9010,
  /** `0x470568` tag 1 */
  creaking: { cels: [9011, 9011, 9011], hold: 1, from: "0x470568 tag 1" },
  /** `0x4705a8` tag 0 */
  caving: { cels: [9012, 9013, 9014, 9015, 9016, 9017], hold: 1, from: "0x4705a8 tag 0" },
  /** `0x470568` tag 0 — four frames of the whole cel before it starts */
  holdFrames: 4,
  /** `0x427100` — `0x42f850(obj, 3.0)`, three times the player's own pull */
  gravity: 3,
  from: "0x41f140 / 0x426ea0 / 0x426f80",
} as const;

export interface Floor {
  x: number;
  y: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  state: "whole" | "creaking" | "caving" | "gone";
  clock: number;
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
 * Its divisor is 1 and its script is six cels; what turns it on and off has not
 * been read, so this page runs it on its own loop.
 */
export const SURGE = {
  /** `0x46f648` tag 0 */
  arc: { cels: [9060, 9061, 9062, 9063, 9064, 9065], hold: 1, from: "0x46f648 tag 0" },
  /** `0x426a90` — a code, not damage */
  blow: -4,
  /** `0x426aa8` — `0134 surge` */
  sound: 0x38,
  divisor: 1,
  from: "0x41ec20 / 0x426990 / 0x426a70",
} as const;

export interface Surge {
  x: number;
  y: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  clock: number;
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
 * whole sweep 3560…3566; the think hands one to the other as each ends and
 * plays `lab.snd` 0x24 on the way round.
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
}

/**
 * The fans — `inithfan` (three) and `initvfan` (five), both in MAZE. Creators
 * `0x411ae0` and `0x411b40`, classes `0x4152b0` and `0x415870`.
 *
 * One script shape between them, four tags: spin up, hold, spin down, stopped.
 * What turns the wheel is a counter in the fan's OWN user data — `0x41541d`
 * writes 15 into `user+0xc` and `0x4155ef` writes 60 — so a fan is off for
 * fifteen frames and on for sixty, for ever, and nothing in the level starts it.
 *
 * The horizontal one's blades carry a strike box (10020's runs the full 217
 * pixels of its own height, 80 wide on the left of its anchor) and the vertical
 * one's do not, which is the difference between the two.
 */
export const FAN = {
  h: {
    /** `0x46d478` — tag 0 up, tag 1 held, tag 2 down, tag 3 stopped */
    spin: { cels: [10020, 10021, 10022, 10023, 10024], hold: 1, from: "0x46d478 tag 0" },
    held: 10024,
    stopped: 10020,
  },
  v: {
    spin: { cels: [10030, 10031, 10032, 10033, 10034], hold: 1, from: "0x46d598 tag 0" },
    held: 10034,
    stopped: 10030,
  },
  /** `0x4155ef` and `0x41541d` — engine frames turning, and engine frames still */
  onFrames: 0x3c,
  offFrames: 0xf,
  /** `0x415430` and `0x415590` */
  spinUp: 0x16,
  spinDown: 0x15,
  divisor: 10,
  from: "0x411ae0 / 0x4152b0 / 0x4153a0 and 0x411b40 / 0x415870",
} as const;

export interface Fan {
  x: number;
  y: number;
  /** `inithfan`'s blades have a strike box and `initvfan`'s have none */
  horizontal: boolean;
  state: "up" | "on" | "down" | "off";
  clock: number;
}

/**
 * BARREL's conveyors — `initbeltleft` (twenty-six) and `initbeltright`
 * (sixteen), which share one creator (`0x411500`) and one class (`0x4167c0`).
 * Think `0x416840`.
 *
 * Each record is a 278x36 strip. The think measures the player's own drawn box
 * (`0x4025b0` then `0x42f9f0`), asks whether their bottom sits inside the
 * belt's own band (`0x416899` against `user+8` and `user+0xc`) and whether they
 * are on the ground (`0x4168d0`), and if so writes **0x14 — twenty** into
 * `user+4`. That is the carry, and it is the same twenty whichever way the belt
 * runs; the class is what says which way.
 *
 * Two scripts and the same five cels in both: `0x46c0d8` runs them at one
 * engine frame each and `0x46c188` at three. The record's own `param` — 4, 6, 8
 * or 10 across BARREL's forty-two — is what picks between them.
 */
export const BELT = {
  /** `0x46c0d8` tag 0 — and tag 1 is the same five backwards */
  roll: { cels: [5570, 5571, 5572, 5573, 5574], hold: 1, from: "0x46c0d8 tag 0" },
  /** `0x46c188`, the same five at three frames a cel */
  slowHold: 3,
  /** `0x416965`'s `mov word ptr [edx+4], 0x14` */
  carry: 0x14,
  /** how far below the strip's own point the player's feet may be and still ride */
  bandPx: 36,
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
 * One script, `0x46dfd8`, four tags of six cels at two frames each: 2200s,
 * 2210s, 2220s and then 2226 held. The think hands them round in order and
 * there is nothing else in the class — no health, no blow, no rect test. It is
 * a piece of the factory that moves.
 */
export const CHAIR = {
  runs: [
    { cels: [2200, 2201, 2202, 2203, 2204, 2205], hold: 2, from: "0x46dfd8 tag 0" },
    { cels: [2210, 2211, 2212, 2213, 2214, 2215], hold: 2, from: "0x46dfd8 tag 1" },
    { cels: [2220, 2221, 2222, 2223, 2224, 2225], hold: 2, from: "0x46dfd8 tag 2" },
  ],
  /** tag 3 — one cel, and the think comes back round to tag 0 from it */
  rest: 2226,
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
  /** `0x46dd80` tags 1, 2 and 4 — down, worry, up */
  down: { cels: [2420, 2421, 2422, 2423, 2424], hold: 2, from: "0x46dd80 tag 1" },
  shut: { cels: [2424, 2425, 2426, 2425], hold: 2, from: "0x46dd80 tag 2" },
  up: { cels: [2424, 2423, 2422, 2421, 2420], hold: 2, from: "0x46dd80 tag 4" },
  /** `0x46dd18` tag 1 — what it does with nobody near */
  idle: { cels: [2410, 2411, 2412], hold: 1, from: "0x46dd18 tag 1" },
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
  /** `0x41745c` — a code, and not one this port carries */
  grab: -3,
  from: "0x411ca0 / 0x417130 / 0x4171e0",
} as const;

export interface Claw {
  /** where the carriage is now, and the rail it may not leave */
  x: number;
  y: number;
  left: number;
  right: number;
  state: "idle" | "running" | "down" | "shut" | "up";
  clock: number;
}
