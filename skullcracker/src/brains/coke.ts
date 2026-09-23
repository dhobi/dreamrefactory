/**
 * The Coke machine — `initcoke`, creator `0x4365f0`, class proc `0x43b500`,
 * think function `0x43b5d0`, hit handler `0x43b630`.
 *
 * ## It never fights, and the executable says so in one line
 *
 * Every class in the chapter that fights seeds a tracker in its creator: a call
 * to `0x45ef70(out, obj, [0x4ac3d4], <band list>)` whose fourth argument is the
 * class's own descending list of distances, and a `0x45efd0` in the think
 * function that reads the player's band out of it. **`0x4365f0` has neither.**
 * It is fifty-eight instructions long, it calls `0x433f20(8)` for an eight-byte
 * AI struct, `0x430d40` to hang an object off the class list at `[0x474ed0]`,
 * `0x40b940` and `0x40bbd0` to sit the thing on the floor, and it returns. There
 * is no band list anywhere in `initcoke`'s data, no `0x45ef70`, no `0x45efd0`, no
 * read of `[0x4ac3d4]` outside the hit handler's "was that the player?" test at
 * `0x43b660`.
 *
 * So: **a Coke machine has no band table in `fights.ts` because it has none in
 * `SC.EXE`.** It is furniture. It never closes, never swings, never picks a side,
 * never leaves the spot the level put it on. `stepFight` never reaching a brain
 * for a class without a band table costs this class nothing — the only state its
 * think function does any work in is one the page already drives as a flinch.
 * The module exists so the machine's own scripts and its one real behaviour —
 * *pin yourself back down and stop rocking* — are written down where the next
 * reader can find them, and so the wiring is there if the page ever hands
 * furniture its own frame.
 *
 * ## Its two scripts, and therefore its two live states
 *
 * `0x45d090` copies word 4 of a script's header into `obj+0x18`, so the KIND of
 * a script is the state it puts the object in. The whole class owns exactly two
 * scripts — a raw byte search for `0x474e10` finds four references and for
 * `0x474e70` two, and all six are inside `0x43b500`…`0x43b780`:
 *
 * ```
 *   kind  script    tags  what it is
 *   ----  --------  ----  -------------------------------------------------
 *   0     0x474e10  0     cel 8500 — the machine standing there (birth,
 *                          `0x43b54c`, and the rock's own exit, `0x43b607`)
 *   0     0x474e10  1     cel 8505 — EMPTY, all four cans gone (`0x43b723`)
 *   0     0x474e10  2     cels 8550..8558 — burst open (`0x43b73b`)
 *   1     0x474e70  0     8501, 8502 — the light rock (`0x43b6b4`)
 *   1     0x474e70  1     8501, 8502, 8503 — unused: nothing installs tag 1
 *   1     0x474e70  2     8501, 8502, 8504, 8504, 8503 — the hard rock
 *                          (`0x43b6dc`)
 * ```
 *
 * Both are `ticksPerFrame 1`. `0x474e70` is declared with eleven frames and
 * only ten are reachable: its last record is `tag 0, cel 0, dx 0, dy 0`, and
 * `0x45d090`'s tag scan starts at frame 0 and stops at the first record whose
 * tag differs, so tag 0 is frames 0..1 and that eleventh record can never be
 * played. It is padding, not an animation.
 *
 * ## The AI struct is three fields and none of them is a punk's
 *
 * `0x4365f0` allocates **eight** bytes (`0x4365f5`) and fills them at
 * `0x43663d`…`0x43664b`:
 *
 * ```
 *   AI+0  word   cans dispensed so far, 0..4   (`0x43b709`, `0x43b74c`)
 *   AI+2  word   counted blows since the last can, 0..3 (`0x43b6c5`/`0x43b6ed`)
 *   AI+4  dword  the creator's ONE argument — the record's point, y in the low
 *                word and x in the high, the same dword written to `obj+6`
 * ```
 *
 * There is no nerve here, no beat, no decision count, no side, no player
 * pointer and no health word: `initcoke` has no health at all (see `foes.ts` —
 * what stops it is cel 8505 carrying no body box, not a number running out).
 * **AI+4 is a whole point, not the punk's `AI+0x10` x-only home**, and the think
 * function's one job is to write it back over `obj+6` every frame of the rock.
 *
 * ## The stack frame, and why there isn't one to get wrong
 *
 * The trap the other classes set — reading `0x45efd0`'s sixteen bytes four
 * bytes low and turning every band test into a side test — cannot be sprung
 * here, because `0x43b5d0` never calls `0x45efd0` and allocates no locals at
 * all. Its whole prologue is `mov edx, dword ptr [esp+4]` (the object) and
 * `push esi`, so afterwards `[esp+8]` is the object and **`[esp+0xc]` is the AI
 * struct** — which is exactly the slot `0x43b5ed` reads before taking `AI+4` out
 * of it. Two arguments, pinned by the call site: `0x43b55e` loads `[esp+0xc]`
 * and `[esp+0x10]` of the class proc — its own arg1 and arg2, obj and AI —
 * pushes them in that order and does `add esp, 8` after.
 *
 * And `obj+6` is the **Y**, `obj+8` the X: `0x43b7ad` in the can spawner copies
 * `[edi+8]` into `[esi+8]` and `[edi+6]` into `[esi+6]` as two separate words
 * before reading them back as one dword at `0x43b7c2`, and `0x43b7e2` weighs
 * that `+8` word against the player's own `+8` to decide which way the can
 * faces. The think function writes the pair as one dword, which is why both
 * halves come back at once.
 */
import type { Foe } from "../foes";
import { install, type Brain, type Enemy } from "./kit";

/**
 * Everything `0x43b630` and `0x43b780` do that is not this module's, named so
 * the next reader can see what is deliberately elsewhere.
 *
 * - **The whole of the hit handler, `0x43b630`.** It is `obj+0x12`, installed at
 *   `0x43b52e`, and the page drives what it chooses through {@link Foe.flinch}
 *   and {@link Foe.pick} — `foes.ts`'s `initcoke` already carries its three
 *   outcomes. What it does, in order: ignore the blow if the striker belongs to
 *   the class list at `[0x472564]` (`0x43b640`; that list is registered at
 *   `0x43a8b6` for the proc `0x43a8c0`, an object of base cel 1970 spawned once
 *   at a time from `0x43a790` — **I did not identify which chapter-5 prop it
 *   is**); ignore it unless `obj+0x18` is 0 (`0x43b655` — a machine already
 *   rocking takes nothing); ignore it unless the striker is `[0x4ac3d4]`, the
 *   player himself (`0x43b660`), and unless his strength percent `obj+0x1a` is
 *   non-negative (`0x43b66c`). Then `0x42f910(player)` weighs the blow out of
 *   the striking cel's own box, `0x430eb0([0x474ed0], obj, &ai)` fetches this
 *   object's AI struct back out of the class list, and `0x40ef30(0x4a75b0, 0x20,
 *   obj+6)` plays `mall.snd` 32 — "#0120 coke mach[ine]" — where the machine is.
 *   Note the bank: `0x4a75b0`, the mall's, **not** the `0x4a7910` that
 *   {@link BrainCtx.say} is hard-wired to, so this class could not use that
 *   helper even if the sound were the brain's to play.
 * - **`0x43b6ab`, the three sizes of blow.** Under 30: kind 1 tag 0, the light
 *   rock, and `AI+2` counts up. 30 to 74: kind 1 tag 2, the hard rock, `AI+2`
 *   counts up, and when `AI+2` passes 2 (`0x43b6f5`) a can comes out, `AI+0`
 *   counts up and `AI+2` resets — so **every third counted blow is a can** — and
 *   when `AI+0` passes 3 (`0x43b71a`) the machine is put on kind 0 tag 1, cel
 *   8505, the empty one. 75 and over (`0x43b6d3`): kind 0 tag 2, cels
 *   8550..8558, the machine bursting open, and then `0x43b755` loops `4 - AI+0`
 *   times throwing every can it has left at once. A weak hit still counts toward
 *   the next can; nothing ever decrements either counter.
 * - **`0x43b780`, the can.** Not this class at all: it allocates a two-byte AI
 *   struct, hangs an object off the list at `[0x474d88]`, copies the machine's
 *   own y and x onto it, faces it away from the player (`0x43b7e2` —
 *   `obj+0x28 = 1` when the player is at or left of the machine's x), and
 *   installs `0x474ce0` tag 0: seventeen frames, cels 8600..8614, and the first
 *   of them carries `dx 120, dy -70` — the can is thrown up and out and the rest
 *   of the arc is the engine's gravity. Tags 1..3 are its landing and its rest.
 *   It belongs with the pickups.
 */
const NOT_HERE = "0x43b630, 0x43b6ab, 0x43b780" as const;

/**
 * The class's whole repertoire, walked out of `0x474e10` and `0x474e70` with the
 * header `{i16 count, i16 ticksPerFrame, i16 kind}` and eight bytes a frame.
 *
 * Not one record in either script carries a `dx` or a `dy`. A Coke machine has
 * no stride at all — it is `rooted` in `foes.ts` for that reason — and the two
 * scripts differ only in which cels they show.
 */
export const COKE = {
  /** kind 0 tag 0 — cel 8500, the machine standing there. Birth, and the rest */
  idle: {
    cels: [8500],
    hold: 1,
    kind: 0,
    tag: 0,
    from: "0x474e10 tag 0",
  },
  /**
   * kind 0 tag 1 — cel 8505, emptied out, installed at `0x43b723` the moment
   * `AI+0` passes three. 8505 carries no body box, so once it is showing
   * `0x4303b6` stops offering the machine as a victim: this is where it stays.
   */
  empty: {
    cels: [8505],
    hold: 1,
    terminal: true,
    kind: 0,
    tag: 1,
    from: "0x474e10 tag 1",
  },
  /**
   * kind 0 tag 2 — nine cels of the machine bursting open, installed at
   * `0x43b73b` for any blow of 75 or more, and followed immediately by every can
   * it still holds.
   */
  burst: {
    cels: [8550, 8551, 8552, 8553, 8554, 8555, 8556, 8557, 8558],
    hold: 1,
    kind: 0,
    tag: 2,
    from: "0x474e10 tag 2",
  },
  /** kind 1 tag 0 — two cels, the light rock a blow under 30 buys (`0x43b6b4`) */
  rock: {
    cels: [8501, 8502],
    hold: 1,
    kind: 1,
    tag: 0,
    from: "0x474e70 tag 0",
  },
  /**
   * kind 1 tag 1 — three cels, and **nothing in the executable installs it**.
   * The only two `0x45d090` sites that name `0x474e70` push tag 0 (`0x43b6b1`)
   * and tag 2 (`0x43b6d7`). Written down because it is there, not because it
   * runs.
   */
  nudge: {
    cels: [8501, 8502, 8503],
    hold: 1,
    kind: 1,
    tag: 1,
    from: "0x474e70 tag 1",
  },
  /** kind 1 tag 2 — five cels, the hard rock a blow of 30..74 buys (`0x43b6dc`) */
  shake: {
    cels: [8501, 8502, 8504, 8504, 8503],
    hold: 1,
    kind: 1,
    tag: 2,
    from: "0x474e70 tag 2",
  },
  /**
   * There is no band list. `0x4365f0` never calls `0x45ef70`, so there is
   * nothing for `0x45efd0` to measure against and the think function asks
   * nothing about the player at all.
   */
  bands: [] as readonly number[],
  from: "0x43b5d0",
} as const satisfies Record<string, unknown>;

/**
 * `initcoke`'s machine — `0x43b5d0`, and it is an IF-CHAIN, not a jump table.
 *
 * ```
 *   0x43b5d5  movsx eax, word ptr [edx+0x18]
 *   0x43b5d9  xor   si, si
 *   0x43b5dc  cmp   eax, 1 ; je 0x43b5eb
 *   0x43b5e1  cmp   eax, 2 ; je 0x43b619
 *   0x43b5e6  mov   ax, si ; pop esi ; ret        <- state 0 and everything else
 * ```
 *
 * Three states, and the class only ever puts itself in two of them.
 *
 * **Every path returns 0 but one.** `0x43b5e6`, `0x43b611` and `0x43b61d` all
 * answer `si`, which `0x43b5d9` zeroed on the way in; the single exception is
 * `0x43b619`, which sets `si = 1` first. Non-zero here means *remove me* — the
 * class proc turns it into the message-2 answer 4 at `0x43b575` — and it is not
 * the {@link Brain} contract's `true`, which means *the frame is spent, do not
 * play the animation*. So this brain returns `false` from everywhere, waiting
 * included.
 */
export const coke: Brain = (e, _foe, run, _k) => {
  const done = e.clock >= run;
  switch (e.script ?? 0) {
    /**
     * ---- 0, the fall-through at `0x43b5e6`: standing there, and nothing else.
     *
     * The chain tests 1 and 2 and drops everything else into `mov ax, si`. So
     * the state a Coke machine spends its whole life in has no code: cel 8500
     * (or 8505, or the burst) plays, the object is drawn, and the think function
     * does not so much as look at the player. This is the honest shape of a
     * class with no band list.
     *
     * And it stays empty here, where `rat.ts`'s `case 0` reinstalls the hide:
     * the rat has no kind-0 script at all, so state 0 there can only mean *the
     * page cleared me*. State 0 is this class's **normal** state — the idle
     * `0x43b551` installs at birth, the emptied machine `0x43b723` installs, and
     * the burst `0x43b73b` installs are all kind 0 — so anything reinstalled
     * here would undo the other two. The disc does nothing; so does this.
     */
    case 0:
      return false;
    /**
     * ---- 1, `0x43b5eb`: rocking — and what it is FOR is undoing the shove.
     *
     * Four writes happen every single frame of the rock, before the
     * script-finished test and regardless of it:
     *
     * ```
     *   0x43b5f1  mov word ptr [edx+0xa], cx    ; vy = 0
     *   0x43b5f5  mov word ptr [edx+0xc], cx    ; vx = 0
     *   0x43b5fd  mov eax, dword ptr [eax+4]    ; AI+4, the record's point
     *   0x43b600  mov dword ptr [edx+6], eax    ; obj+6 = it, y and x at once
     * ```
     *
     * The punch that started the rock went through the elastic solver
     * `0x430470`, which writes a velocity pair onto whatever it pushed; a
     * machine bolted to the arcade floor must not take it. So the class spends
     * every frame of the rock putting itself back exactly where the level put
     * it. Nothing else in the chapter pins a point this hard.
     *
     * `0x43b5f9` is the ordinary `cmp word ptr [edx+0x46], 0` — *do nothing
     * until my own script has finished* — and when it has, `0x43b605` installs
     * `0x474e10` tag 0 with no test of any kind. A rock always ends in the idle,
     * whichever of the two rocks it was.
     *
     * The port pins only the x half: {@link Enemy} carries `home` as the
     * record's x (`AI+0x10` in the classes that have one) and has no field for
     * the y, where this class's `AI+4` is the whole packed point. It costs
     * nothing here — `foes.ts` marks `initcoke` `rooted`, so no y is ever
     * spent on it — but it is a slot short of the disc and worth saying so.
     */
    case 1:
      e.vx = 0;
      e.vy = 0;
      e.x = e.home ?? e.x;
      return done ? install(e, COKE.idle) : false;
    /**
     * ---- 2, `0x43b619`: the removal, and **this class never reaches it**.
     *
     * Two instructions — `mov si, 1` and the shared return — so the class proc
     * answers 4 at `0x43b575` and `0x430...` drops the object. The draw case
     * agrees: `0x43b57f` refuses to draw at all once `obj+0x18` is 2.
     *
     * But nothing gives a Coke machine that state. `0x45d090` is the only thing
     * that writes `obj+0x18` here and both of the scripts it is ever handed are
     * kind 0 or kind 1; `0x436634` seeds `obj+0x18 = 0` at birth; there is no
     * `mov word ptr [reg+0x18], 2` anywhere in `0x4365f0`…`0x43668a` or
     * `0x43b4e0`…`0x43b80a`. It is the shared shape of the chapter's furniture
     * class — the mailbox at `0x44fe10` really does drive itself into state 2,
     * as `FoeAnim.terminal` records — left in and never used. The machine's own
     * terminal pose is kind 0 tag 1, cel 8505, which is state **0**.
     *
     * Answered `false` rather than `true`: the two meanings differ (see the doc
     * above), and an unreachable path is no place to introduce the one return
     * that freezes an animation.
     */
    case 2:
      return false;
    default:
      return false;
  }
};

/**
 * `0x43b655` and `0x43b66c` — the two things `0x43b630` asks before it weighs
 * a blow at all.
 *
 * `cmp word ptr [esi+0x18], 0; jne` — a machine in any state but kind 0 takes
 * nothing, and the only other kind it has is the rock, `0x474e70` kind 1. So
 * a second punch landing before the first rock has finished is not counted,
 * not heard and shakes nothing loose. And `cmp word ptr [edi+0x1a], 0; jl`: a
 * negative strength — the flare's −9 — is no blow either.
 *
 * The third, `0x43b660`'s `cmp edi, [0x4ac3d4]` — only the player's own
 * object — is not carried: a gate is handed the blow and not what threw it, so
 * a flare or a stream that reaches a machine still counts here.
 */
export function cokeGate(
  e: Enemy,
  _foe: Foe,
  blow: { damage: number; code: number },
): { damage: number; code: number } | null {
  if (e.state === "flinch" && e.anim.kind === COKE.rock.kind) return null;
  if (blow.code < 0) return null;
  return blow;
}

export { NOT_HERE as COKE_NOT_HERE };
