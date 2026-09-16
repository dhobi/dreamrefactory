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
