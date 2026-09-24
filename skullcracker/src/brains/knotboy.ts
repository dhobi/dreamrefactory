/**
 * The keeper with the knot of hair — `initknotboy`, `0x437b20`, level five's
 * third and level six's first, and one of the four that share a shape.
 *
 * ## Ten scripts, ten states
 *
 * `0x45d090` copies word 4 of a script's header into `obj+0x18`, so the kinds of
 * this class's own scripts ARE its alphabet, and `0x437c22`'s jump table is
 * `jmp [(state - 1)*4 + 0x438190]` — ten entries, states 1 through 10, and a
 * state 0 that falls through the `cmp eax, 9; ja` into the common return.
 *
 * ```
 *   kind  script      ticks  what it is                          handler
 *    1    0x473e40      1    the statue: one cel, no stride      0x437c29
 *    2    0x473f08      1    the stance, the brace, the retreat  0x437c6a
 *    3    —             —    no script carries kind 3            (none)
 *    4    0x473fb0      1    the two poises, the walk in, a step 0x437d3b
 *    5    0x473f58      1    the leap: launch, flight, landing   0x437e93
 *    6    0x473e50      1    walk to the switch, and throw it    0x437eea
 *    7    0x474010      2    two lunges and the two strikes      0x438007
 *    8    0x473ed0      2    the walk it takes while you are down 0x438094
 *    9    0x474068      1    the death                           0x4380b9
 *   10    0x474048      1    the flinch                          0x438169
 * ```
 *
 * Six of them — 1, 2, 4, 5, 7 and 8 — are what the thing is in while it is on
 * its feet, and those are here. Kind 6 is the lever and kinds 9 and 10 are the
 * hit reactions; all three are already owned by the page, and {@link NOT_HERE}
 * says what each does and where.
 *
 * ## Where the tracker's sixteen bytes are, and how that was pinned
 *
 * `0x437b20` takes the buffer's address with `lea eax, [esp]` **before** it
 * pushes anything (`sub esp, 0x10` at `0x437b20`, `lea` at `0x437b23`, then
 * `push esi`, `push edi`, `push eax`), and by the time the body runs, `add esp,
 * 8` at `0x437b37` has left `esp` four bytes below the two saved registers. So
 * `0x45efd0`'s output sits at **`esp+8`**, not at `esp+0xc` like the punk's and
 * not at `esp+0x10` like the dog's:
 *
 * ```
 *   esp+0x08  out+0x00  side          esp+0x10  out+0x08  player.y - self.y
 *   esp+0x0c  out+0x04  band          esp+0x12  out+0x0a  forward distance
 *   esp+0x0e  out+0x06  he is mid-blow
 * ```
 *
 * The two argument slots settle it and nothing else does. `0x437b2a` reads the
 * AI struct as `[esp+0x24]` with three dwords pushed, and `0x437b48` reads the
 * object as `[esp+0x1c]` with one; those are eight and four bytes above the
 * return address, which is exactly `arg2` and `arg1`. Read the buffer four low
 * and `0x437b3a`'s `cmp word ptr [esp+0xc], 1` becomes a test on the SIDE
 * rather than the band, and the whole class still compiles.
 *
 * ## This class's AI struct, which is not the punk's
 *
 * `0x4361e0` lays out thirty-eight bytes and only two of them are named the way
 * the street punk's are:
 *
 * ```
 *   AI+0x00  word   health — 0x40e300(0x32), and ONLY the bar reads it
 *   AI+0x02  dword  the player object, [0x4ac3d4]
 *   AI+0x06  dword  the switch this one is walking to, or 0 — see 0x438200
 *   AI+0x0a  8 bytes  the record's own RECT, the two dwords at [esp+0x48]/[esp+0x4c]
 *   AI+0x12  word   how many frames in a row it has been stuck in an obstacle
 *   AI+0x14  16 bytes  the tracker input 0x45ef70 seeds and 0x45efd0 reads
 *   AI+0x36  word   the corpse countdown, and state 9 is the only thing that spends it
 * ```
 *
 * There is no nerve, no beat, no decision budget and no side: `AI+6` is a
 * POINTER where the punk keeps which side of the player it wants, and reading it
 * as {@link Enemy.side} would be reading half of a switch's address as a facing.
 * `AI+0` is the health the bar claim at `0x437b66` shows and nothing in the
 * machine ever tests it, so it is not carried here either — {@link Foe.panel}
 * already has the fifty.
 *
 * ## Every path returns false
 *
 * `0x438180` is the common return and it is `xor ax, ax` — the "my script has
 * not finished" exits included. The only `mov ax, 1` in the whole function is
 * `0x438112`/`0x43815c`, the frame state 9 hands the corpse to `0x40cba0`, and
 * that state is the page's. So nothing below returns true; a waiting state that
 * did would freeze the thing mid-stride.
 */
import { install, rewind, type Brain, type BrainCtx, type Enemy } from "./kit";
import type { FoeAnim } from "../foes";
import { ahead, turn } from "./batboy";

/**
 * The four things `0x437b20` does that this module deliberately does not.
 *
 * - **Kind 6, the lever** (`0x437eea`, and the prologue's own hijack at
 *   `0x437b84`). Whenever the state is 2 or 4, `0x438200` is asked for the first
 *   object of the switch class whose position is inside this one's record rect
 *   and whose tag is **3** — an unlit one; with one in hand `0x437b9d` turns the
 *   thing to face it and installs `0x473e50` tag 0, which is the same six cels
 *   it walks with. Tag 0 then closes to `0x25` (37) pixels (`0x437f5c`), stops
 *   (`0x437f66` zeroes `obj+0xc`), and either attacks instead because the player
 *   has come within a hundred (`0x437f71`) or installs tag 1, the reach. Frame
 *   **12** of that reach — `cmp word ptr [esi+0x42], 0xc` at `0x437fb0`, and
 *   `obj+0x42` is the frame index `0x45d0f0` walks — calls `0x436820(switch, 0)`
 *   and one time in three plays 5 or 6. The page owns all of it as
 *   {@link Foe.lever}, and `stepFight` hands a keeper with a switch left in its
 *   patch straight to that path before a brain is ever called.
 * - **Kind 10, the flinch** (`0x438169`). Two instructions: wait for `obj+0x2e`,
 *   back on the ground, and then install `0x473fb0` tag 4 — so a struck keeper
 *   comes back walking AT you rather than standing. That script is
 *   {@link Foe.gait}, which the page's flinch path returns it to, and
 *   `gangCorpse` holds the flinch until the landing.
 * - **Kind 9, the death** (`0x4380b9`). Tag 0 writes `obj+0x10 = 0xffec`, −20,
 *   the floor offset a falling body is allowed; both tags then count `AI+0x36`
 *   down and, at −1, rebuild the object through `0x42fa80` and hand it to
 *   `0x40cba0(pos, -0xd, 0)` — the green pop {@link Foe.vanishes} already makes.
 *   This is the one path in the class that answers 1.
 * - **The bar claim** (`0x437b3a`…`0x437b66`). With the player at band 1 or
 *   nearer and in front, `0x40d1c0(AI+0, 0x40e300(0x32), 0x332f, obj.y)` puts
 *   the strip on screen. Bookkeeping, not behaviour — {@link Foe.panel} carries
 *   the 50 and the 13103.
 */
const NOT_HERE = "0x437eea, 0x437b84, 0x438169, 0x4380b9, 0x437b3a" as const;

/**
 * Two flags the engine writes onto an object that this port has no source for,
 * and what each one costs.
 *
 * - **`obj+0x2c`** — set by `0x430146`, the mover's obstacle pass, on the frame
 *   an object's own anchor is found inside one of the level's obstacle rects
 *   (`walk.ts` documents the rule). `0x437c76`, `0x437d3b` and `0x437f00` all
 *   open with it: each counts `AI+0x12` up while it is set and, on the **fourth**
 *   frame in a row (`cmp ax, 3; jle`), installs `0x473f58` tag 0 — the leap. A
 *   keeper that has walked into scenery jumps over it. Foes in this port are not
 *   run through the obstacle solver, so the flag is never set and **nothing
 *   installs kind 5**; the state is written below all the same, because the
 *   moment a foe carries that flag it is the only thing needed to reach it.
 * - **`obj+0x2a`** — the "something collided with me" word `0x430663` writes on
 *   the victim of an elastic collision. `0x43802c` reads it as one of three
 *   reasons to turn a lunge into a strike. Never set here, so that path takes
 *   its other two.
 *
 * And one the port HAS, under another name: **`obj+0x30`** is the settled flag —
 * the one `0x45ae90` asks of a dropped weapon so you cannot catch it mid-bounce.
 * A keeper standing in a level always has it, which collapses `0x437e46`'s first
 * branch to "always". Said out loud below rather than quietly dropped.
 */
const NO_FLAG = "0x437c76, 0x437d3b, 0x437f00, 0x43802c, 0x437e46" as const;

/**
 * The whole repertoire, straight out of `0x473e40`…`0x474068`.
 *
 * Every cel, hold and stride is the script's own. A frame is eight bytes —
 * `{i16 tag, i16 cel, i16 dx, i16 dy}` at `script + 6 + i*8` — and the header's
 * third word is the kind `0x45d090` writes into `obj+0x18`. The strides are the
 * raw script words; the class's divisor is **7** (`mov word ptr [esi+0xe], 7` at
 * `0x437a6b`), which is {@link FOES.initknotboy}'s `divisor`, and `0x42f8b0` is
 * what turns one into the other.
 *
 * The cels are 1940…1965 out of chapter two's own bank (`obj+2 = 0x4a7020` and
 * `obj+0 = 0x794` at `0x437a71`/`0x437a7f`) and have nothing to do with the
 * street punk's 1900s, which happen to overlap.
 */
export const KNOTBOY = {
  /** kind 1 — one cel and no stride: what it is before you walk into its rect */
  stand: { cels: [1940], hold: 1, kind: 1, tag: 0, from: "0x473e40 tag 0" },
  /** kind 2 tag 0 — one cel, so it LOOPS: the stance, and the state that decides */
  stance: { cels: [1941], hold: 1, kind: 2, tag: 0, from: "0x473f08 tag 0" },
  /** kind 2 tag 1 — the other single cel the stance flips between */
  guard: { cels: [1944], hold: 1, kind: 2, tag: 1, from: "0x473f08 tag 1" },
  /** kind 2 tag 2 — three frames of 1943: what it holds while you are swinging */
  brace: {
    cels: [1943, 1943, 1943],
    hold: 1,
    kind: 2,
    tag: 2,
    from: "0x473f08 tag 2",
  },
  /** kind 2 tag 5 — giving ground, and only the last three frames travel */
  giveGround: {
    cels: [1943, 1943, 1942, 1941],
    hold: 1,
    dx: [0, -70, -80, -70],
    kind: 2,
    tag: 5,
    from: "0x473f08 tag 5",
  },
  /** kind 4 tag 0 — a single cel it comes to rest on */
  poise: { cels: [1945], hold: 1, kind: 4, tag: 0, from: "0x473fb0 tag 0" },
  /** kind 4 tag 1 — and the other one, which `0x437e17` flips a coin between */
  poiseAlt: { cels: [1940], hold: 1, kind: 4, tag: 1, from: "0x473fb0 tag 1" },
  /** kind 4 tag 4 — the walk in, and the only script in the class that closes */
  approach: {
    cels: [1940, 1941, 1942, 1943, 1944, 1945],
    hold: 1,
    dx: [0, 60, 70, 80, 120, 0],
    kind: 4,
    tag: 4,
    from: "0x473fb0 tag 4",
  },
  /** kind 4 tag 5 — one frame, ten pixels backwards: what every attack ends on */
  back: {
    cels: [1944],
    hold: 1,
    dx: [-10],
    kind: 4,
    tag: 5,
    from: "0x473fb0 tag 5",
  },
  /** kind 5 tag 0 — three frames of winding back and then 325 of lift */
  launch: {
    cels: [1945, 1945, 1945, 1950],
    hold: 1,
    dx: [-10, -50, -50, 80],
    dy: [0, 0, 0, -325],
    kind: 5,
    tag: 0,
    from: "0x473f58 tag 0",
  },
  /** kind 5 tag 1 — the arc over, one cel held three frames */
  flight: {
    cels: [1951, 1951, 1951],
    hold: 1,
    dx: [40, 80, 40],
    dy: [-5, 10, 10],
    kind: 5,
    tag: 1,
    from: "0x473f58 tag 1",
  },
  /** kind 5 tag 2 — and coming down out of it */
  landing: {
    cels: [1952, 1951, 1950],
    hold: 1,
    kind: 5,
    tag: 2,
    from: "0x473f58 tag 2",
  },
  /** kind 7 tag 0 — the lunge: sixty pixels on the first cel, nothing on the second */
  lunge: {
    cels: [1950, 1951],
    hold: 2,
    dx: [60, 0],
    kind: 7,
    tag: 0,
    from: "0x474010 tag 0",
  },
  /** kind 7 tag 1 — the other lunge, same shape on 1953/1954 */
  lungeAlt: {
    cels: [1953, 1954],
    hold: 2,
    dx: [60, 0],
    kind: 7,
    tag: 1,
    from: "0x474010 tag 1",
  },
  /** kind 7 tag 2 — what tag 0 turns into: the frame that carries the blow */
  strike: { cels: [1952], hold: 2, kind: 7, tag: 2, from: "0x474010 tag 2" },
  /** kind 7 tag 3 — and what tag 1 turns into */
  strikeAlt: { cels: [1955], hold: 2, kind: 7, tag: 3, from: "0x474010 tag 3" },
  /** kind 8 — the SAME six cels as the walk in, at half the rate, going the other way */
  saunter: {
    cels: [1940, 1941, 1942, 1943, 1944, 1945],
    hold: 2,
    dx: [0, 60, 70, 80, 120, 0],
    kind: 8,
    tag: 0,
    from: "0x473ed0 tag 0",
  },
  /**
   * `0x4740a0` — the descending list the creator hands `0x45ef70` at `0x436252`,
   * three thresholds where the punk has four. Band 0 is beyond four hundred, 1 is
   * 150…400, 2 is 85…150, 3 is inside 85, and −1 is behind it altogether.
   */
  bands: [400, 150, 85],
  /** `0x437c58` — `mall.snd` 8, the one sound a keeper makes coming off the wall */
  wake: 8,
  /** `0x438051` — and 10, on the frame a lunge becomes a strike */
  swing: 10,
  from: "0x437b20",
} as const;

/**
 * `0x437d82` and `0x437e46` — is the mirror flag pointing away from the stride?
 *
 * Both read `obj+0x28` against the sign of `obj+0xc` and answer the same
 * question in opposite directions: facing east with a negative speed, or west
 * with a positive one. `obj+0xc` is the velocity word `0x42f8b0` accumulates out
 * of the script's own `dx` (divided by `obj+0xe`, the seven), which is why it
 * can disagree with the flag at all — a walk that has been turned round mid
 * stride still carries the speed it had.
 *
 * {@link ahead} is that word read along the facing, so "pointing away" is a
 * negative answer; a zero points nowhere and answers no.
 */
function adrift(e: Enemy): boolean {
  return ahead(e) < 0;
}

/**
 * `0x437e46`'s first test — `cmp word ptr [esi+0x30], 0`.
 *
 * `obj+0x30` is the mover's at-rest word: `0x43031c` writes 1 when `obj+0xa`
 * and `obj+0xc` are both zero and `0x430314` writes 0 while either is not.
 */
function settled(e: Enemy): boolean {
  return ahead(e) === 0 && e.vy === 0;
}

/**
 * The preamble's walk-away, `0x437be9`: `0x473ed0` tag 0 with the mirror
 * turned AWAY from him (`0x437bf6`) — the mirror is written, the slide under
 * it (`obj+0xc`) is not. The brain installs it over any state but 1, 5, 8 and
 * 9; `gangReacts` over the flinch, state 10.
 */
export function knotboyDown(e: Enemy, k: BrainCtx): FoeAnim {
  const away = k.player.x > k.anchorX(e) ? -1 : 1;
  if (away !== e.facing) turn(e);
  return KNOTBOY.saunter;
}

/**
 * `initknotboy`'s machine, states 1, 2, 4, 5, 7 and 8.
 *
 * Read `e.script` as `obj+0x18`, `e.tag` as `obj+0x44` and `e.clock >= run` as
 * `obj+0x46`. State 0 is the port's own: `stepFight` writes it the frame the
 * player leaves the record's rect, and the statue at state 1 is what the disc
 * has there, so the two share a case.
 */
export const knotboy: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, KNOTBOY.bands);
  const tag = e.tag ?? 0;
  const state = e.script ?? 0;

  /**
   * `0x437bc3` — the player is off his feet, and this runs BEFORE the dispatch.
   *
   * Four states are exempt (`0x437bd1`…`0x437be7`): 8, because it is already
   * this one; 1, so a keeper you have never woken stays a statue; 5, so a leap
   * in the air is not cut off; and 9, the death. Everything else is put on
   * `0x473ed0` tag 0 — and then `0x437bf6` turns it **away**: `cmp word ptr
   * [eax+8], cx; jg` leaves `obj+0x28` at 1, facing WEST, when the player is to
   * the EAST, which is the opposite of what `0x437b9d` does for the switch and
   * the opposite of what the punk's own kind 6 does at `0x44ec0a`. The six cels
   * of kind 8 carry it off in the direction it has just been turned, so a
   * downed player is walked away from, not circled. Read twice; it is the disc.
   */
  if (
    k.player.down &&
    state !== 0 &&
    state !== 1 &&
    state !== 5 &&
    state !== 8 &&
    state !== 9
  ) {
    return install(e, knotboyDown(e, k));
  }

  switch (state) {
    /**
     * ---- 1, `0x437c29`: the statue, and the one thing that ends it.
     *
     * It zeroes both halves of `obj+0xa` every frame — a keeper waiting is
     * nailed down — and then asks `0x434200(player.point, AI+0xa)`, the player's
     * own point inside the four words the creator copied off the record. Not a
     * radius and not the room. {@link Enemy.fighting} is exactly that test.
     * State 0 is a page-spawned one that has not been installed into anything.
     *
     * `0x437c58` sounds 8 as it goes, which is the page's {@link Foe.wake}
     * sound, played already on the frame it woke — so it is not said twice.
     */
    case 0:
    case 1: {
      e.vx = 0;
      e.vy = 0;
      e.speed = 0;
      if (!e.fighting) return install(e, KNOTBOY.stand);
      // `0x437c65` — and then it is walking at you on the very same frame
      return install(e, KNOTBOY.approach);
    }
    /**
     * ---- 2, `0x437c6a`: the stance, and the state that reads the band.
     *
     * Three of its four tags are a single cel or three, so this state re-decides
     * nearly every frame — the `obj+0x46` gate is on tag 5 alone.
     */
    case 2: {
      // `0x437c72` — and it does not return: it turns and carries on
      if (t.forward < 0) turn(e);
      // `0x437c76` — the stuck-in-an-obstacle leap, which this port cannot reach
      switch (tag) {
        case 0:
        case 1:
          /**
           * `0x437cbd` — the band, in the order the exe asks it.
           *
           * Innermost first: inside 85 it gives ground rather than swinging, and
           * the swing comes from state 4 instead. Beyond 150 it walks in. In
           * between — and behind, because band −1 falls through the same three
           * `cmp`s — it answers only the player's own blow, holding 1943 while
           * he is mid-swing (`0x437ce9`, `out+6`) and standing there otherwise.
           */
          if (t.band === 3) return install(e, KNOTBOY.giveGround);
          if (t.band === 0 || t.band === 1) return install(e, KNOTBOY.approach);
          if (!k.player.swinging) return false;
          return install(e, KNOTBOY.brace);
        /**
         * `0x437d01` — and the brace breaks the moment he swings again.
         *
         * The sense is the one to read twice: `je` on `out+6` returns, so a
         * player standing still leaves the three frames of 1943 to play out, and
         * a player mid-blow drops it back onto one of the two stance cels.
         */
        case 2:
          if (!k.player.swinging) return false;
          return install(
            e,
            k.roll(2) - 1 === 0 ? KNOTBOY.stance : KNOTBOY.guard,
          );
        // `0x437d24` — the retreat runs to its end and hands back to the stance
        case 5:
          return done ? install(e, KNOTBOY.stance) : false;
        default:
          return false;
      }
    }
    /**
     * ---- 4, `0x437d3b`: the walk in, the two cels it rests on, and the step back.
     *
     * The state a woken keeper starts in and the one every attack comes back to.
     */
    case 4: {
      // `0x437d3b` — the obstacle leap again, and unreachable for the same reason
      switch (tag) {
        case 0:
        case 1: {
          // `0x437d82` — a facing that disagrees with the stride is turned round
          // (`0x437d9e`: `xor al, 1` on the mirror, the slide left as it is)
          if (adrift(e)) {
            turn(e);
            return install(e, KNOTBOY.approach);
          }
          // `0x437db2` — and below twenty of speed it simply walks again
          if (Math.abs(ahead(e)) < 20) return install(e, KNOTBOY.approach);
          // `0x437dc3` — still moving and he is behind: one step back
          if (t.forward < 0) return install(e, KNOTBOY.back);
          // `0x437dca` — still moving, and only the 150…400 band commits
          if (t.band !== 1) return false;
          return install(
            e,
            k.roll(2) - 1 === 0 ? KNOTBOY.lunge : KNOTBOY.lungeAlt,
            true,
          );
        }
        /**
         * `0x437ded` — the walk ends, and what follows is a coin either way.
         *
         * `0x437e07` installs tag 4 again when he is behind this one
         * (`out+0` zero, read as a dword) or still beyond four hundred — and
         * then **falls through** to `0x437e17` without a jump, so the install
         * below always replaces it. It is written out here rather than ported
         * because `0x45d090` leaves nothing behind that the second install does
         * not immediately overwrite.
         *
         * So: at 150…400 it settles onto one of the two poise cels, and at every
         * other distance — inside 150, beyond 400, or behind — it lunges.
         */
        case 4: {
          if (!done) return false;
          if (t.band === 1) {
            return install(
              e,
              k.roll(2) - 1 === 0 ? KNOTBOY.poise : KNOTBOY.poiseAlt,
            );
          }
          return install(
            e,
            k.roll(2) - 1 === 0 ? KNOTBOY.lunge : KNOTBOY.lungeAlt,
            true,
          );
        }
        /**
         * `0x437e46` — the single backward frame, and it ends facing him.
         *
         * Two ways out and they land in the same place: `obj+0x30` set — at
         * rest ({@link settled}) — or a slide disagreeing with the facing. Both
         * turn towards the player and install the stance. Still sliding the way
         * it faces, `0x437e74` puts the step on again, rewinding it, each time
         * it ends.
         */
        case 5: {
          if (settled(e) || adrift(e)) {
            if (t.forward < 0) turn(e);
            return install(e, KNOTBOY.stance);
          }
          return done ? rewind(e, KNOTBOY.back) : false;
        }
        default:
          return false;
      }
    }
    /**
     * ---- 5, `0x437e93`: the leap, which is three scripts in a row and no choice.
     *
     * Launch hands to flight hands to landing hands to the step back, each on
     * its own `obj+0x46`. Nothing in this port installs the launch — only the
     * obstacle counter does, and {@link NO_FLAG} says why that never fires — so
     * this case is here for the day a foe carries `obj+0x2c`.
     */
    case 5: {
      if (!done) return false;
      if (tag === 0) return install(e, KNOTBOY.flight, true);
      if (tag === 1) return install(e, KNOTBOY.landing, true);
      if (tag === 2) return install(e, KNOTBOY.back);
      return false;
    }
    /**
     * ---- 7, `0x438007`: the lunge becomes the strike, and the strike steps back.
     *
     * The lunge tags carry the sixty pixels and the strike tags carry the cel
     * that hits; `0x438064` is the whole of the pairing — `obj+0x44 + 2`, so tag
     * 0 becomes tag 2 and tag 1 becomes tag 3.
     */
    case 7: {
      /**
       * `0x438011` — and this is dead in the executable as well as here: the
       * prologue at `0x437be9` does not exempt state 7, so a player going down
       * has already moved this object to kind 8 before the dispatch reads it.
       */
      if (k.player.down) return install(e, KNOTBOY.back);
      switch (tag) {
        case 0:
        case 1: {
          /**
           * `0x43802c` — three reasons to let the blow go, and they are asked in
           * this order: something collided with it (`obj+0x2a`, never set in
           * this port), the player is behind it, or it has slowed below ten.
           *
           * That last one is the real rule. `obj+0xc` is the speed `0x42f8b0`
           * has been adding the script's own strides to — the walk in puts
           * forty-odd on it across its six frames and the 0.05 friction bleeds
           * it off slowly — so the strike lands on the frame the lunge runs out
           * of momentum.
           */
          if (t.forward >= 0 && Math.abs(ahead(e)) >= 10) return false;
          // `0x438051` — 10, on the frame it commits
          k.say(e, KNOTBOY.swing);
          return install(
            e,
            tag === 0 ? KNOTBOY.strike : KNOTBOY.strikeAlt,
            true,
          );
        }
        // `0x438082` — and the blow ends on the one backward frame
        case 2:
        case 3:
          return done ? install(e, KNOTBOY.back) : false;
        default:
          return false;
      }
    }
    /**
     * ---- 8, `0x438094`: what it walks while the player is down.
     *
     * Six cels at half the rate of the walk in, looping until he stands, and the
     * frame he does it goes straight back to `0x473fb0` tag 4 — walking at him
     * again, from wherever the sauntering left it.
     */
    case 8: {
      if (!done) return false;
      if (!k.player.down) return install(e, KNOTBOY.approach);
      // `0x4380ad` — the same script again, from its first cel
      return rewind(e, KNOTBOY.saunter);
    }
    default:
      return false;
  }
};

export { NOT_HERE as KNOTBOY_NOT_HERE, NO_FLAG as KNOTBOY_NO_FLAG };
