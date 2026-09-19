/**
 * The fire hydrant — `inithydrant`, think function `0x44fb20`, and the one
 * class in the chapter whose machine turns out to be **empty**.
 *
 * ## It has one script, not thirteen
 *
 * Every other class in this folder owns a dozen scripts and dispatches over
 * `obj+0x18`, the kind `0x45d090` copies out of word 4 of the script header.
 * The hydrant owns exactly **one**, `0x477d30`, and its header is
 * `{count 14, ticksPerFrame 1, kind 0}` — read straight out of the file at
 * `0x477d30`. A byte search for `0x477d30` finds six references in the whole
 * executable and all six are `push 0x477d30` operands of a `call 0x45d090`
 * inside this class (`0x44fb9f`, `0x44fc03`, `0x44fc17`, `0x44fc2b`,
 * `0x44fcb1`, `0x44fcc3`). So there is no second script to find, and
 * `obj+0x18` is permanently **0**: it could not discriminate anything.
 *
 * Which is why `0x44fb20` does not read it. Its if-chain is over
 * **`obj+0x44`, the TAG** — `0x44fb36  movsx eax, word ptr [esi + 0x44]`,
 * then `cmp eax, 3` / `cmp eax, 4` — and the third argument to `0x45d090` is
 * what every install in the class varies. The five tags of that one script are
 * the five states, and this file's switch is over `e.tag` for that reason and
 * not over `e.script`, which is 0 for all five.
 *
 * ```
 *   tag 0  0x477d30  cel 9700  the valve shut — what a hydrant stands as
 *   tag 1  0x477d30  cel 9701  a quarter turn on
 *   tag 2  0x477d30  cel 9702  a half turn on
 *   tag 3  0x477d30  cel 9703  wide open, and the only tag with live code
 *   tag 4  0x477d30  9800..9807 9806 9807 — the water, a SEPARATE object
 * ```
 *
 * ## The whole of `0x44fb20`, and why none of it is a behaviour
 *
 * ```
 *   0x44fb2e  obj+0xa = 0; obj+0xc = 0          vy and vx, every frame
 *   0x44fb43  obj+6   = AI+0                    the record's point, every frame
 *   0x44fb3c  switch (obj+0x44)
 *   0x44fb55    case 3: if (obj+0x46)           when the open valve's frame ends
 *   0x44fb77      x += (obj+0x28 == 1 ? 25 : -25)
 *   0x44fb81      0x44fc70(point, obj+0x28, 1)  a second object of this class,
 *                                               born on tag 4
 *   0x44fb94      0x40ef30(0x4a7910, 4, point)  and the sound of it
 *   0x44fba4      0x45d090(this, 0x477d30, 0)   and THIS one is shut again
 *   0x44fbb4    case 4: if (obj+0x46) return 1  the water, once played, goes
 *   0x44fb4d    default: return 0               tags 0, 1 and 2 do nothing
 * ```
 *
 * That is the function. There is no patrol, no fight, no walk, no attack, no
 * turn, no taunt and no decision: tags 0, 1 and 2 fall through the if-chain
 * into the common `xor ax, ax` at `0x44fb4d` having done nothing but pin the
 * thing where the level put it. **A hydrant has no behaviour beyond holding
 * still and being opened.**
 *
 * And the two live cases are already this page's, both of them, which is the
 * reason this module implements nothing — see {@link NOT_HERE}.
 *
 * ## It never looks at the player
 *
 * `0x44fb20` contains no `call 0x45efd0`, and the creator `0x44fc70` contains
 * no `call 0x45ef70`: **this class has no tracker and no band list at all.**
 * The trap the other classes set — reading the sixteen-byte tracker buffer four
 * bytes low so that a band test compiles as a side test — cannot be sprung
 * here, because the buffer does not exist.
 *
 * Its stack frame is a single dword anyway. `0x44fb24  sub esp, 4` and then
 * `0x44fb29  push esi`, so at `0x44fb2a` the arguments sit at `[esp+0xc]` (the
 * object, loaded into `esi`) and `[esp+0x10]` (the AI struct — though it is
 * read one instruction EARLIER, at `0x44fb20  mov ecx, dword ptr [esp+8]`,
 * before the frame is opened at all). That pins the one local to `esp+4`, and
 * `esp+4` is the copy of the record's point that `0x44fb3f` saves and
 * `0x44fb77` then nudges sideways: `add word ptr [esp+0xe], cx` reaches the
 * HIGH word of that dword with three arguments pushed on top of it, and the
 * high word of `obj+6` is the **X**.
 *
 * ## Its AI struct is four bytes
 *
 * `0x44fc71` mallocs `0x433f20(4)` and `0x44fcaa` writes the record's point
 * into it — `AI+0` is the home point, both halves, `{i16 y, i16 x}`, and there
 * is nothing else in the struct. No nerve, no beat, no decisions, no side, no
 * health, no rect: the fields the punk's machine spends have no counterparts
 * here. Message 4 of the class proc (`0x44faf7`) frees it with `0x433f40`.
 */
import type { Brain } from "./kit";

/**
 * Everything `0x44fb20` and `0x44fbd0` actually do, and where this page already
 * does it. Read, not done — re-driving any of it here would give one animation
 * two owners.
 *
 * - **`0x44fb2e`/`0x44fb43`** — vy and vx zeroed and `obj+6` overwritten with
 *   `AI+0` on the first three instructions of every frame, before the switch.
 *   That is {@link Foe.rooted}, and it is why a hydrant cannot be shoved: the
 *   overlap pass may push it and the next frame puts it straight back.
 * - **`0x44fbd0`**, the hit handler — a switch on the stage it is ALREADY in
 *   rather than on the damage: tag 0 installs tag 1 (`0x44fc00`), 1 installs 2
 *   (`0x44fc14`), 2 installs 3 (`0x44fc28`), and tags 3 and 4 fall out of the
 *   chain doing nothing. That is {@link Foe.progressive}. It opens with
 *   `0x44fc40`, which walks this class's own object list looking for the
 *   striker and refuses the blow if it finds it — one hydrant's water cannot
 *   open another hydrant — and that guard is the only one of its kind found so
 *   far in the chapter.
 * - **`0x44fb55`**, tag 3 — the burst: a second object of this same class
 *   twenty-five pixels to the side, born on tag 4, `woods.snd` 4 played on the
 *   frame it is created, and this one put back on tag 0. That is
 *   {@link Foe.burst}, dx 25. Note the SIGN: `0x44fb6f  sbb ecx, ecx; and ecx,
 *   0xffffffce; add ecx, 0x19` is `+25` when `obj+0x28` is 1 and `-25` when it
 *   is 0 — the water goes out on the side the mirror flag faces, so STREETS'
 *   hydrant, whose record carries `param 1`, sprays east.
 * - **`0x44fbb4`**, tag 4 — the one `mov ax, 1` in the class (`0x44fbbb`), the
 *   frame the water object is removed. The page removes the burst the same way.
 * - **`0x44fc70`**, the creator — takes the facing as an argument and writes it
 *   straight to `obj+0x28` (`0x44fca6`), which is {@link Foe.facesByParam}, and
 *   branches on its third argument: 0 for a hydrant born on tag 0 out of a
 *   level record (`0x44fcc8`), 1 for the water born on tag 4 out of the burst
 *   (`0x44fcb6`).
 *
 * Two things in the class proc `0x44fa60` are bookkeeping rather than
 * behaviour and are named only so the next reader does not go looking: message
 * 1 sets `obj+0xe = 10` (the stride divisor, already {@link FOES.inithydrant}'s
 * `divisor`), `obj+0 = 0xc6c`, `obj+0x12 = 0x44fbd0` (the hit handler) and
 * `obj+0x2e`/`obj+0x30` to zero at `0x44fa77`.
 */
const NOT_HERE =
  "0x44fb2e, 0x44fb43, 0x44fb55, 0x44fbb4, 0x44fbd0, 0x44fc40, 0x44fc70" as const;

/**
 * The class's whole repertoire: one script, `0x477d30`, five tags, fourteen
 * frames, one engine frame a cel.
 *
 * Not one frame of it travels — every `dx` and `dy` word in all fourteen is
 * zero, which is read straight out of the file and is what a bolted-down thing
 * and a jet of water that grows in place both look like. So there is no `dx`
 * or `dy` array below: {@link FoeAnim} leaves them absent for an animation that
 * does not travel, and this is one.
 *
 * All five carry `kind: 0`, because they are five tags of a single script and
 * the kind is the script header's, not the tag's.
 */
export const HYDRANT = {
  /** tag 0 — the valve shut, and what the creator installs out of a record */
  shut: { cels: [9700], hold: 1, kind: 0, tag: 0, from: "0x477d30 tag 0" },
  /** tag 1 — one blow in, the bar across the cap a quarter turn round */
  quarter: { cels: [9701], hold: 1, kind: 0, tag: 1, from: "0x477d30 tag 1" },
  /** tag 2 — two blows in */
  half: { cels: [9702], hold: 1, kind: 0, tag: 2, from: "0x477d30 tag 2" },
  /** tag 3 — wide open, and the only tag `0x44fb20` has code for */
  open: { cels: [9703], hold: 1, kind: 0, tag: 3, from: "0x477d30 tag 3" },
  /**
   * tag 4 — the water, and it is never worn by the hydrant itself: `0x44fcb6`
   * installs it only on the object `0x44fb81` has just created. Ten frames
   * ending 9806, 9807 rather than stopping at 9807.
   */
  water: {
    cels: [9800, 9801, 9802, 9803, 9804, 9805, 9806, 9807, 9806, 9807],
    hold: 1,
    kind: 0,
    tag: 4,
    from: "0x477d30 tag 4",
  },
  /** `0x44fb8f` — `0x40ef30(0x4a7910, 4, point)`, played as the water is made */
  burst: 4,
  /**
   * `0x44fb77` — how far to the side the water is put, and it is the mirror
   * flag that picks the sign, not the record.
   */
  dx: 25,
  from: "0x44fb20",
} as const;

/**
 * `inithydrant`'s machine, and it is a machine with nothing in it.
 *
 * Five tags, and `0x44fb20` answers `xor ax, ax` without touching one of them.
 * Tags 0, 1 and 2 reach `0x44fb4d` through the if-chain having done nothing;
 * tags 3 and 4 have code, and both pieces of it are the page's already
 * ({@link NOT_HERE}) — the burst is {@link Foe.burst} and the water's removal
 * is the page's removal of a burst. So every case here returns `false`, which
 * is what the disassembly says and also what the rule says: **a think function
 * never suppresses the animation.** Returning `true` from a tag-0 hydrant would
 * freeze cel 9700 and leave the thing unable to be opened at all.
 *
 * The switch is over `e.tag`, not `e.script`. `e.script` is {@link Enemy}'s
 * `obj+0x18` and for this class it is 0 in all five states, because all five
 * are tags of one kind-0 script; `0x44fb36` reads `obj+0x44` for exactly that
 * reason. The cases are written out in full rather than collapsed to a bare
 * `return false` so that the next reader can see that the emptiness was read
 * out of the executable and is not an omission.
 */
export const hydrant: Brain = (e) => {
  switch (e.tag ?? 0) {
    // ---- 0, 1, 2 — `0x44fb4d`: the if-chain does not name them. Nothing.
    case 0:
    case 1:
    case 2:
      return false;
    /**
     * ---- 3, `0x44fb55`: the burst, when the open valve's frame ends.
     *
     * The page owns it — {@link Foe.burst} spawns the water {@link HYDRANT.dx}
     * to the side, plays {@link HYDRANT.burst} and puts this one back on tag 0
     * — so there is nothing for the brain to do but let the frame run.
     */
    case 3:
      return false;
    /**
     * ---- 4, `0x44fbb4`: the water, and the class's single `mov ax, 1`.
     *
     * The one frame in `SC.EXE` where this class suppresses anything is the
     * frame the spray object is removed, and removal is not a state the brain
     * can express: `Brain` returns "has a script been chosen", not "am I
     * finished". The page removes the burst when its animation ends.
     */
    case 4:
      return false;
    default:
      return false;
  }
};

export { NOT_HERE as HYDRANT_NOT_HERE };
