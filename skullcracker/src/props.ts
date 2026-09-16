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
