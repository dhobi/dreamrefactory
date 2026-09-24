/**
 * The mailbox — `initmailbox`, think function `0x44fe10`, and the second class
 * in the chapter whose machine turns out to be **empty**.
 *
 * ## It owns two scripts, and four states
 *
 * `0x45d090` copies word 4 of a script's header into `obj+0x18`, so the kinds
 * of the scripts a class installs are its state alphabet. A byte search for
 * both of this class's script addresses over the whole executable finds three
 * references and all three are `push` operands of a `call 0x45d090` inside the
 * class:
 *
 * ```
 *   0x478798  kind 0  tpf 1  1 frame    installed at 0x44fd85 and 0x44fe47
 *   0x4787a8  kind 1  tpf 1  5 frames   installed at 0x44fedc
 * ```
 *
 * There is no third script, so no kind past 1 can ever be *installed*. The two
 * higher states are written into `obj+0x18` by hand, or not at all:
 *
 * ```
 *   kind 0            0x478798 tag 0   cel 2410            the mailbox, intact
 *   kind 1 tag 0      0x4787a8 tag 0   cel 2411            the dent that springs back
 *   kind 1 tag 1      0x4787a8 tag 1   2410 2411 2412 2413 the topple
 *   kind 2            no script        holds cel 2413      down for good
 *   kind 3            no script        —                   unreachable, see below
 * ```
 *
 * ## The if-chain is over `obj+0x18` here, NOT over the tag
 *
 * Worth saying plainly because the hydrant next door is the other way round.
 * `0x44fb36`, `inithydrant`'s, reads `movsx eax, word ptr [esi + 0x44]` — the
 * TAG — because that class owns one script and its kind is constant 0. This
 * one opens `0x44fe15  movsx eax, word ptr [ecx + 0x18]` and compares against
 * 1 and 3, and only *inside* the kind-1 arm does it read the tag
 * (`0x44fe2b  movsx eax, word ptr [ecx + 0x44]`, against 0 and 1). So the
 * outer switch below is over `e.script` — the kind — with the tag
 * sub-dispatched under kind 1, which is the shape of the disassembly.
 *
 * ## The whole of `0x44fe10`, which is 100 bytes
 *
 * ```
 *   0x44fe10  ecx = obj                        arg0; the AI struct, arg1, is never read
 *   0x44fe19  si = 0                           the answer, for every path but one
 *   0x44fe15  switch (obj+0x18)
 *   0x44fe2b    case 1: switch (obj+0x44)
 *   0x44fe3d      case 0: if (obj+0x46)        the light dent, when its frame ends
 *   0x44fe4c        0x45d090(this, 0x478798, 0)   and it is the intact cel again
 *   0x44fe59      case 1: if (obj+0x46)        the topple, when its four frames end
 *   0x44fe60        obj+0x18 = 2                  a state with no script of its own
 *   0x44fe38      default: return 0
 *   0x44fe6b    case 3: si = 1                 the only `mov ax, 1` in the class
 *   0x44fe26    default: return 0              kinds 0 and 2 do nothing whatever
 * ```
 *
 * That is the function, all of it. **A mailbox standing on the street runs no
 * code at all**: kind 0 is not named in the if-chain and falls straight through
 * to the shared `mov ax, si; pop esi; ret` at `0x44fe26` having done nothing.
 * It does not even pin itself the way a hydrant does — `0x44fb2e` zeroes the
 * hydrant's `obj+0xa`/`obj+0xc` and `0x44fb43` puts `obj+6` back on the record's
 * point every frame, and `0x44fe10` has no counterpart to either, which is the
 * executable's own reason a kicked mailbox flies and a kicked hydrant does not.
 *
 * So there is no patrol, no fight, no walk, no turn, no attack, no decision and
 * no threshold in this class. Every state it has is either a hit reaction or
 * standing still, and both live elsewhere — see {@link NOT_HERE}. This module
 * implements nothing, and the emptiness is the finding.
 *
 * ## Kind 3 is dead code
 *
 * `0x44fe6b` answers 1, and message 2 of the class proc (`0x44fda9`) turns a
 * non-zero answer into message 4 — the object is freed. Message 3, the draw
 * (`0x44fdb3  cmp word ptr [esi + 0x18], 3; jge`), also refuses to draw it. So
 * kind 3 means "invisible, and gone at the end of the frame".
 *
 * Nothing reaches it. A `66 C7 4x 18 ii ii` search — `mov word ptr [reg+0x18],
 * imm16` — over the whole of `SC.EXE` finds exactly two writes of anything but
 * 0 or 15 in this range, `0x44fe60` (the 2 above) and `0x4365cc`/`0x43b025`
 * (a 2 in other classes), and **no write of 3 anywhere in the file**; the only
 * register-sourced writes to `+0x18` are `0x45d0a7` inside `0x45d090` itself
 * and two in `0x42f56e`/`0x42f62e`, and `0x45d090` can only ever put a 0 or a 1
 * on a mailbox because those are the kinds of the only two scripts it is given.
 * A mailbox therefore cannot be removed by its own machine: once it is on its
 * side it stays on the street for the rest of the level.
 *
 * ## It never looks at the player, so the stack-frame trap cannot be sprung
 *
 * `0x44fe10` contains no `call 0x45efd0` and the creator `0x451110` contains no
 * `call 0x45ef70`: **this class has no tracker buffer and no band list at all.**
 * Nothing here can be read four bytes low.
 *
 * Its frame is a single push anyway. `0x44fe14  push esi` and nothing else — no
 * `sub esp` — so from `0x44fe15` on, `[esp+4]` is the object (taken into `ecx`
 * one instruction *before* the push, at `0x44fe10  mov ecx, dword ptr [esp+4]`)
 * and `[esp+8]` is the AI struct, which is never touched. That is what pins it:
 * the known argument slots are the only two things on the frame.
 *
 * ## Its AI struct is two bytes, and they are never written
 *
 * `0x451115  push 2; call 0x433f20` mallocs two bytes and `0x451128` registers
 * the pair with `0x430d40([0x476a8c], ai, 0)`. The creator then writes the
 * object and never the struct, and `0x44fe10` never reads its second argument.
 * So `AI+0` is one uninitialised word: no nerve, no beat, no decisions, no
 * side, no home, no health, no rect. None of the punk's `AI` slots have a
 * counterpart here, and none of {@link Enemy}'s AI-backed fields mean anything
 * for this kind. Message 4 (`0x44fdea`) frees it with `0x433f40`.
 *
 * `[0x476a8c]` is the list `0x44fd2d` registers the class under, and it is the
 * one another class reads: `0x44e390` walks it and a rat within `0x4b` = 75
 * pixels of a mailbox in x (and 150 in y) will not come out of its hole. That
 * test belongs to `initrat` and is written up in {@link file://./rat.ts}.
 */
import type { Brain } from "./kit";

/**
 * Everything `0x44fe10`, `0x44fe80` and `0x44fd40` actually do, and where this
 * page already does it. Read, not done — re-driving any of it from a brain
 * would give one animation two owners, and a brain is not called at all while
 * an enemy is in a flinch.
 *
 * - **`0x44fe3d`**, kind 1 tag 0 — the light dent reinstalls `0x478798`, the
 *   intact cel, the frame its own single frame ends. That is an ordinary
 *   non-terminal {@link Foe.flinch} entry: the page returns a foe to its gait
 *   when a flinch runs out, which is the same thing.
 * - **`0x44fe59`**, kind 1 tag 1 — the topple writes `obj+0x18 = 2` when its
 *   four frames end. Cel 2413, the mailbox on its side, is where it stays for
 *   good: the topple's `resume` is `MAILBOX_DOWN`, state 2 on that cel.
 * - **`0x44fe80`**, the hit handler — `0x42f910(striker)` is the blow's speed
 *   (the striking cel's own blow pair at `cel+0x14`/`cel+0x16`, scaled by the
 *   striker's `obj+0x1a` percent, plus its `obj+0xa`/`obj+0xc`, through the
 *   integer `sqrt` at `0x434630`). `0x44febd`: in state 2 nothing is
 *   installed; `0x44fec4`: under 10 nothing is installed; 10..54 installs
 *   `0x4787a8` tag 0, 55 or over tag 1. Every one of those paths then plays
 *   sound 5 and answers 1, so the solver moves the mailbox whatever it showed.
 *   That is {@link FOES.initmailbox}'s `pick`, whose "nothing installed" is
 *   −1: whatever was playing plays on.
 * - **`0x44feea`** — `0x40ef30(0x4a7910, 5, striker->obj+6)`, the same sound
 *   whether it dents or goes over, and played at the STRIKER's point rather
 *   than the mailbox's. That is `FOE_SFX.mailbox`.
 * - **`0x44fe89`**, the branch above all of that — a striker whose `obj+0x1a`
 *   is `0xfff7`, −9, skips the dent entirely: `0x44ff20(mailbox, 1, 0)` makes a
 *   spray object of the class whose list is `[0x4789d0]`, at a random point
 *   inside the mailbox's own cel box, playing `0x478978` tag 2 — cels 9620 to
 *   9629, three engine frames a cel — where the blood every other victim throws
 *   is `0x4788d0` tags 0 and 1, cels 9600 to 9619. Strength −9 is set in two
 *   places, `0x43ac04` (when `[0x4abdfc] == 5`) and `0x453b9b`/`0x453d34`, and
 *   the mailbox is far from the only class that tests for it — `0x44ff20` has
 *   thirteen callers. That is {@link FOES.initmailbox}'s `burns`, `late`: a −9
 *   blow neither dents nor topples a mailbox, and what it leaves is a flame
 *   going out.
 * - **`0x44fd57`**, message 1 — `obj+0 = 0x96a` (cel 2410), `obj+2 = 0x4a8400`
 *   (the bank), `obj+0x12 = 0x44fe80` (the hit handler), `obj+0xe = 7` (the
 *   stride divisor and the mass, already {@link FOES.initmailbox}'s `divisor`),
 *   `0x45d070(obj)` and then `0x45d090(obj, 0x478798, 0)`. Bookkeeping.
 * - **`0x451110`**, the creator — takes one argument, the record's packed point
 *   (`{i16 y, i16 x}`, low word to `obj+6` and high to `obj+8`), and is called
 *   once per record from the loop at `0x450749`. It reads no `param`, so unlike
 *   the hydrant nothing sets `obj+0x28`: a mailbox always faces east.
 */
const NOT_HERE =
  "0x44fe3d, 0x44fe59, 0x44fe80, 0x44fe89, 0x44fd57, 0x451110" as const;

/**
 * The class's whole repertoire: two scripts, five frames between them, one
 * engine frame a cel.
 *
 * Every `dx` and `dy` word in all five is zero, read straight out of the file,
 * so there is no `dx` or `dy` array below — {@link FoeAnim} leaves them absent
 * for an animation that does not travel. Which means nothing in this class's
 * own scripts moves a mailbox an inch: the topple is entirely in the art, and
 * the flight of a kicked one is entirely the collision solver's.
 */
export const MAILBOX = {
  /**
   * kind 0 — the mailbox standing. One cel, and the state the creator's class
   * message installs (`0x44fd85`) and the light dent goes back to
   * (`0x44fe4c`). `0x44fe10` has no case for it.
   */
  intact: { cels: [2410], hold: 1, kind: 0, tag: 0, from: "0x478798 tag 0" },
  /** kind 1 tag 0 — one cel of dent, and `0x44fe3d` undoes it when it ends */
  dent: { cels: [2411], hold: 1, kind: 1, tag: 0, from: "0x4787a8 tag 0" },
  /**
   * kind 1 tag 1 — the topple, and the end of it is `obj+0x18 = 2` at
   * `0x44fe60`: no further script, so cel 2413 holds.
   */
  topple: {
    cels: [2410, 2411, 2412, 2413],
    hold: 1,
    kind: 1,
    tag: 1,
    from: "0x4787a8 tag 1",
  },
  /** `0x44feea` — `woods.snd` 5, whether it dents or goes over */
  hit: 5,
  /** `0x44fec4`/`0x44feca` — the two speed thresholds the handler picks on */
  dents: 0xa,
  topples: 0x37,
  from: "0x44fe10",
} as const;

/**
 * `initmailbox`'s machine, and it is a machine with nothing in it.
 *
 * Four states, and the two `0x44fe10` has code for are both hit reactions the
 * page already owns ({@link NOT_HERE}). The state a mailbox spends a whole
 * level in — kind 0, standing — is not even named in the if-chain. So every
 * case here returns `false`, which is what the disassembly says and also what
 * the rule says: **a think function never suppresses the animation.** Every
 * path of `0x44fe10` ends `mov ax, si` with `si` zeroed at `0x44fe19`, and the
 * single exception is `0x44fe6b`, the unreachable kind 3, which is a removal
 * rather than a behaviour and is not something a {@link Brain} can express —
 * `Brain` answers "has a script been chosen", not "am I finished".
 *
 * The cases are written out in full rather than collapsed to a bare
 * `return false` so the next reader can see that the emptiness was read out of
 * the executable and is not an omission.
 */
export const mailbox: Brain = (e) => {
  switch (e.script ?? 0) {
    /**
     * ---- 0, `0x44fe26`: intact, and the if-chain does not name it.
     *
     * No pinning, no velocity zeroing, no tracker, no decision. A mailbox
     * standing on the street is the one thing this class does, and it does it
     * by running no code.
     */
    case 0:
      return false;
    /**
     * ---- 1, `0x44fe2b`: the two dents, sub-dispatched on `obj+0x44`.
     *
     * Tag 0 reinstalls the intact cel when its frame ends (`0x44fe4c`) and tag
     * 1 writes state 2 when its four end (`0x44fe60`). Both are the page's
     * flinch path — the topple's `resume` for the second — and a brain is
     * never called while a foe is flinching, so neither is here.
     */
    case 1:
      return false;
    /**
     * ---- 2, `0x44fe26`: on its side for good, and also not in the if-chain.
     *
     * `0x45d090` never wrote this one — `0x44fe60` did, by hand — so there is
     * no script to end and nothing to decide. Cel 2413 holds; the hit
     * handler's first test (`0x44febd`) installs nothing, but it still plays
     * its sound and hands the blow's momentum over.
     */
    case 2:
      return false;
    /**
     * ---- 3, `0x44fe6b`: the removal, and it is unreachable.
     *
     * The class's only `mov ax, 1`, and no script of this class carries kind 3
     * and no instruction in `SC.EXE` writes a 3 into `obj+0x18`. Kept as a case
     * so the search that proved it is not repeated.
     */
    case 3:
      return false;
    default:
      return false;
  }
};

export { NOT_HERE as MAILBOX_NOT_HERE };
