/**
 * A NEGATIVE blow strength is not damage — it is a message, and this is the
 * whole of what the messages say.
 *
 * `obj+0x1a` is what an object hits with. Every ordinary value is a percentage:
 * `0x42f910` scales the striking cel's own `(dy, dx)` by it and the victim
 * subtracts the magnitude. A hundred is a full-strength blow and is what almost
 * everything in the game carries.
 *
 * But the player's hit handler reads the sign FIRST, and a negative never
 * reaches the damage arithmetic at all:
 *
 * ```
 *   448c6e  mov   ax, [esi+0x1a]        ; the striker's own strength
 *   448c72  test  ax, ax
 *   448c75  jge   0x449035              ; >= 0 -> take the damage
 *   448c7b  movsx eax, ax
 *   448c7e  add   eax, 8                ; -8..-1 becomes 0..7
 *   448c81  cmp   eax, 7
 *   448c84  ja    0x449035              ; -9 and below -> take the damage
 *   448c8a  jmp   dword ptr [eax*4 + 0x4492b8]
 * ```
 *
 * Eight slots, and the table at `0x4492b8` is the index into everything below.
 * So the codes are not a scattered convention — they are a dense enumeration the
 * engine dispatches on directly, and there can be exactly eight of them because
 * the range test says so.
 *
 * **Seven of the eight have a sender.** Decoding from function entries rather
 * than a window sweep — a sweep desynchronises and silently loses writes, which
 * cost a first reading of this table two of them — every negative written into
 * an `obj+0x1a` anywhere in `SC.EXE` is:
 *
 * ```
 *   -1  0x413bf9  0x41afd0   the Boggs machinery, and nothing else
 *   -2  0x4201e4  0x43dbda  0x4421cb  0x44236d
 *   -3  0x41745c  0x420da6  0x424c21  0x43ee9d   claw, hand, wraith, bush
 *   -4  0x426a90                                 the surge
 *   -5  0x43eedb  0x43eefa                       the bush, once you are dying
 *   -7  0x420e3b  0x420e4e                       the hand, out of its rect
 *   -8  0x418dce
 *   -9  0x43abf0  0x453b9b  0x453d34             not this table at all
 * ```
 *
 * **Nothing in the game sends -6.** Its slot is real, the reaction is written,
 * and no object anywhere reaches it — so {@link BLOW_CODES}[-6] is ported for
 * completeness and is dead in the shipped game, which is stated here rather than
 * quietly left out.
 *
 * And -9 is a different alphabet: it is below the range test, so it lands as
 * ordinary damage on the player and is read instead by five handlers of their
 * own (`0x44f0aa`, `0x4520d8`, `0x4547b3`, `0x4550d3`, `0x455763`) which accept
 * nothing else. The flare carries it — `0x43abf0` sets its strength to -9 rather
 * than 100 when the global at `0x4abdfc` is 5 — which is why that one is named
 * below but not in this table.
 *
 * ## How a grab actually holds you
 *
 * Three of the seven (-3 above all) put the player in a HELD state, and the
 * mechanism is the neatest thing in the engine. `0x428080`'s kind-10 case reads
 * the GRABBER's current cel record at +4 and +8 — which is {@link SbkCel.strike},
 * the same rect that decides whether a blow connects — translates it by the
 * grabber's own point (`0x434270`, a plain add) and plants the player at its
 * centre:
 *
 * ```
 *   428660  x = x1 + (x0 - x1) / 2
 *   428689  y = y0 + (y1 - y0) / 2
 *   4285b8  cmp [0x4a693a], ax   ; x0 == x1 -> let go
 * ```
 *
 * So the grip is authored per frame, in the art, and the grab ends when the
 * artist drew a frame without one. The books confirm it exactly: of the
 * thirteen cels the hand's three scripts name, only 1556 and 1562 — the two
 * CLOSED ones — carry a strike box, and theirs are `y -27..-1, x -32..31` and `y -34..-4, x -18..20`, the fist itself.
 * Of the fifty-two the claw's six scripts name, only 2456..2459 do — `y 77..111,
 * x -76..0` and three more like it, the jaw hanging below and behind its anchor.
 * Nothing else needed saying anywhere: the hold is the drawing. Nothing else needed saying anywhere:
 * the hold is the drawing.
 */
import type { SbkCel } from "@dreamfactory/engine/df/sbk";

/** an animation as the reaction scripts state it: cels and frames-per-cel */
export interface CodeAnim {
  cels: readonly number[];
  hold: number;
  from: string;
}

/** one row of the table at `0x4492b8` */
export interface CodeReaction {
  /** the strength that selects it */
  code: number;
  /** what this page calls the act it installs */
  act: string;
  /** the script and tag the original installs, as cels */
  anim: CodeAnim;
  /**
   * The gravity the reaction leaves the player under — `0x42f850`'s float — or
   * null where the reaction does not touch it.
   */
  gravity: number | null;
  /** true where the reaction zeroes `obj+0xa` and `obj+0xc` */
  stops: boolean;
  /** a shove along the striker's facing, in whole pixels a frame */
  shove?: number;
  /** what `0x40c900` is given to shake the screen by */
  shake?: number;
  /** an index into the player's own bank */
  sound?: number;
  /** true where the handler returns 1: the blow is consumed and cannot also hurt */
  consumes: boolean;
  /** true where this is a HELD state rather than a one-shot */
  holds?: boolean;
  /** which classes send it, or the plain truth that none do */
  sender: string;
  from: string;
}

/**
 * The eight reactions, in the order the jump table lists them.
 *
 * `0x4492b8` -> `448c91 448d24 448d72 448dae 448df4 448e90 448f06 448f7c`, which
 * is index 0 = code -8 through index 7 = code -1.
 */
export const BLOW_CODES: Readonly<Record<number, CodeReaction>> = {
  [-8]: {
    code: -8,
    act: "bowled",
    // `0x476830` tag 2, kind 26 — three frames a cel, and it holds the last
    anim: { cels: [9550, 9551, 9552, 9553, 9554, 9555, 9556, 9557, 9558, 9558, 9558], hold: 3, from: "0x476830 tag 2" },
    gravity: null,
    stops: false,
    /**
     * `0x448cf4`: +50 when `obj+0x28` is 1, -50 when it is 0.
     *
     * `obj+0x28` is a MIRROR FLAG, not a sign: `0x45d0f0` flips a frame's own dx
     * when it is set, so 1 is the mirrored drawing — which is this port's facing
     * of **-1**. The blaster settles it independently at `0x412b6e`, where the
     * muzzle goes 120 to the LEFT when the flag is 1. So +50 at flag 1 is +50
     * while facing left: a knock BACKWARDS, which is what being bowled over is,
     * and the sign here is against the port's facing rather than along it.
     */
    shove: 50,
    /** `0x448d00` — `0x40c900(y, 0x78, 0)` */
    shake: 0x78,
    /** `0x448cc9` */
    sound: 0x13,
    consumes: false,
    sender: "0x418dce, in the Boggs sequence and nowhere a level places",
    from: "0x448c91",
  },
  [-7]: {
    code: -7,
    act: "downBack",
    // `0x476890` tag 2 — the same knockdown a hard blow from behind gives
    anim: { cels: [5940, 5941, 5942, 5943, 5944, 5944, 5944], hold: 1, from: "0x476890 tag 2" },
    gravity: null,
    stops: false,
    consumes: true,
    sender: "the HAND, out of its rect rather than under your feet — 0x420e3b",
    from: "0x448d24",
  },
  [-6]: {
    code: -6,
    act: "flattened",
    // `0x476758` tag 0 — which is also the animation of being dead
    anim: { cels: [5910, 5911, 5912, 5913, 5914, 5915], hold: 2, from: "0x476758 tag 0" },
    /** `0x448d7d` — `0x42f850(player, 1.0f)` */
    gravity: 1,
    stops: false,
    consumes: false,
    sender: "NOTHING. No object in SC.EXE writes -6 into its own strength.",
    from: "0x448d72",
  },
  [-5]: {
    code: -5,
    act: "slumped",
    // `0x476758` tag 4
    anim: { cels: [5900, 5901, 5902, 5902], hold: 2, from: "0x476758 tag 4" },
    /** `0x448dc3` — half gravity, and `obj+0x34` goes to 0 with it */
    gravity: 0.5,
    stops: false,
    consumes: false,
    sender: "the BUSH, and only once you are already dying — 0x43eedb",
    from: "0x448dae",
  },
  [-4]: {
    code: -4,
    act: "shocked",
    /**
     * `0x476758` tag 3 — and it is two animations end to end: three cels of
     * 9700..9702 played out and back, which is the arc going through you, and
     * then the six of the knockdown.
     */
    anim: {
      cels: [9700, 9701, 9702, 9701, 9700, 9701, 5910, 5911, 5912, 5913, 5914, 5915],
      hold: 2,
      from: "0x476758 tag 3",
    },
    gravity: 1,
    stops: false,
    consumes: false,
    sender: "the SURGE, BARREL's arcing current — 0x426a90",
    from: "0x448df4",
  },
  [-3]: {
    code: -3,
    act: "grabbed",
    /**
     * `0x476698` tag 0, kind 10. The held state then loops `0x4720e8` tag 0 —
     * the same script in a different set of cels, 4570..4572 for 9570..9572 —
     * which is the original's own inconsistency and is kept.
     */
    anim: { cels: [9570, 9571, 9572, 9571], hold: 2, from: "0x476698 tag 0" },
    /** `0x448ef4` — `0x42f850(player, 0)`: no gravity while something has you */
    gravity: 0,
    stops: true,
    consumes: true,
    holds: true,
    sender: "the CLAW, the HAND underfoot, the WRAITH and the BUSH",
    from: "0x448e90",
  },
  /**
   * -2 is the one row with a condition in front of it.
   *
   * `0x448f0b` reads the player's CURRENT script and only two of them absorb it
   * — `0x476428` (kind 7, the crouch) and `0x4765f8` (kind 8, the one whose
   * records carry dx +-100, which is the board). Either of those consumes the
   * blow, sets the flag at `0x46b1bc` that `0x42ae50` reads and clears, and
   * returns 1. Everything else gets the jolt below and returns 0, which is the
   * branch this row describes.
   *
   * The condition is not modelled, because no class a level places sends -2:
   * all four writers are inside sequences rather than in a class the spawner
   * ever builds. Written down here rather than left out.
   */
  [-2]: {
    code: -2,
    act: "jolt",
    // `0x476578` tag 0, kind 9 — the three cels five times over
    anim: {
      cels: [5460, 5461, 5462, 5460, 5461, 5462, 5460, 5461, 5462, 5460, 5461, 5462, 5460, 5461, 5462],
      hold: 2,
      from: "0x476578 tag 0",
    },
    gravity: null,
    stops: false,
    consumes: false,
    sender: "0x4201e4 and three more, none of them a class a level places",
    from: "0x448f06",
  },
  [-1]: {
    code: -1,
    act: "spun",
    // `0x4766f0` tag 3 — one frame a cel, and the shortest reaction there is
    anim: { cels: [5020, 5021, 5020, 5021], hold: 1, from: "0x4766f0 tag 3" },
    gravity: null,
    stops: true,
    /** `0x448ff3` — `0x40c900(y, -1, striker)` */
    shake: -1,
    consumes: true,
    sender: "the Boggs machinery — 0x413bf9, 0x41b022 — and it is also what Boggs ALONE takes",
    from: "0x448f7c",
  },
};

/**
 * The loop the held state runs once the reaction's own script has played out,
 * and the one thing you can do about it.
 *
 * `0x4286bb` reads the punch flag every frame and `0x4286cf` installs tag 1 on
 * it, but only from tag 0 — so mashing P does not stack, it restarts. Nothing in
 * the state shortens the hold: the grab ends when the GRABBER's cel stops
 * carrying a grip, and struggling is animation.
 */
export const HELD = {
  /** `0x4720e8` tag 0 */
  loop: { cels: [4570, 4571, 4572, 4571], hold: 2, from: "0x4720e8 tag 0" },
  /** `0x4720e8` tag 1 — P, and only from tag 0 */
  struggle: { cels: [4575, 4576, 4577, 4575, 4578, 4579], hold: 2, from: "0x4720e8 tag 1" },
  from: "0x428080's kind-10 case, 0x42857d..0x428704",
} as const;

/**
 * Where a grabber is holding you: the centre of its current cel's strike box,
 * in world space, or null when that box is degenerate and the grab is over.
 *
 * `0x4285b8` tests `x0 == x1` and nothing else — a box with no width is how the
 * art says "not gripping this frame" — and {@link SbkCel.strike} is already null
 * rather than a zeroed rect when the record carries none, so both readings of
 * "no grip" land here.
 */
export function gripOf(
  cel: SbkCel | undefined,
  box: { top: number; left: number; bottom: number; right: number } | null,
): { x: number; y: number } | null {
  if (!cel?.strike || !box) return null;
  if (cel.strike.x0 === cel.strike.x1) return null;
  return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
}
