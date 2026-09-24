/**
 * LAB's ARM — `initarm`, `0x4187a0`, and there are ten of them in the level.
 *
 * ## It is a jump table after all
 *
 * The note this port was written from said `0x4187a0` dispatches with an
 * if-chain. It does not: `0x4187cb` is
 *
 * ```
 *   movsx ecx, word ptr [esi+0x18]
 *   cmp   ecx, 8
 *   ja    0x418802
 *   jmp   dword ptr [ecx*4 + 0x418b1c]
 * ```
 *
 * — the same `jmp [eax*4 + <table>]` over `obj+0x18` every other class in the
 * chapter uses, with nine entries at `0x418b1c`:
 *
 * ```
 *   0  0x4187db   1  0x41883a   2  0x418890   3  0x418802
 *   4  0x418992   5  0x418a6c   6  0x418ab2   7  0x418acd   8  0x418af6
 * ```
 *
 * The if-chain the note meant is one level down, inside state 2: `0x4188a4`
 * reads the band out of the frame and tests it against 0, 1 and 2 with three
 * `cmp`s rather than a second table.
 *
 * Entry 3 is `0x418802`, the common return — the class owns no kind-3 script, so
 * nothing can put an arm in state 3, and the table entry is the compiler filling
 * a hole.
 *
 * ## Its eight scripts, and therefore its eight states
 *
 * Walked out of the data region between `0x46cf10` and `0x46d120`, a script
 * being `{i16 count, i16 ticksPerFrame, i16 kind}` and then `count` eight-byte
 * frames. Every one of the eight is installed somewhere; there is no orphan.
 *
 * ```
 *   0  0x46cf10  the hand still in the wall, reaching — SEVEN CELS, NO STRIDE
 *   1  0x46cf50  it breaks out: the same seven and then 504..510
 *   2  0x46cfc8  two cels on the floor — the stance, and the state that DECIDES
 *   4  0x46d120  the lunge, tag 0 for a standing player and tag 1 for a ducking one
 *   5  0x46d008  the HOLD, tag 0 and tag 1 being the two player characters
 *   6  0x46d0e8  six cels of turning round
 *   7  0x46cfe0  the CRAWL, four cels carrying `dx 60` apiece
 *   8  0x46d0b0  the death, whose first frame throws it 130 up
 * ```
 *
 * ## The crawl, which is the thing this class was thought not to have
 *
 * `walk.ts`'s `stepFight` says of this class that "the class HAS a script with a
 * stride in its data, but the thing the level places does not use it, and giving
 * it one had ten arms crawling across the floor." The first half is right about
 * the wrong script and the second half is right about everything.
 *
 * What was given a stride was `0x46cf10`, kind 0 — the hand still in the wall,
 * and its seven frames really do carry `dx 0` end to end. That is also the
 * script the page took for {@link Foe.gait}, so `travels(foe)` is false and the
 * shared brain correctly refuses to close on anybody.
 *
 * `0x46cfe0`, kind 7, is a different script and it *is* installed — at
 * `0x4188cf`, out of state 2 with the player in front and beyond the first band
 * — and the instruction immediately before the install is
 * `0x40ef30(0x4a56d0, 0x28, y)`. Index 0x28 of `lab.snd` is, by that bank's own
 * name table, **`#2019 arm crawl`**. The disc names the animation it is about to
 * play. So the arm crawls, it crawls only out of state 2 band 0, and it crawls
 * on kind 7's four cels, never on kind 0's seven.
 *
 * The sound names settle the other three the same way, and they are the check
 * that this whole reading is real rather than plausible — `lab.snd`'s table,
 * counted against `sound.ts`'s already-pinned `armHit: 0x25` = `#2013 arm hit`:
 *
 * ```
 *   0x26  #2016 armhits g[round]   every cycle of the reach, still in the wall
 *   0x27  #2017 armbreaks          frame 7 of kind 1, the first cel out
 *   0x28  #2019 arm crawl          as kind 7 goes on
 *   0x2c  #2025 muffled 2[013?]    the held player, character 0
 *   0x2d  #2026 Bones muf[fled]    the held player, character 1
 * ```
 *
 * The page spends the stride of whatever a brain installs, so the crawl
 * travels and the reach in the wall does not.
 *
 * ## What this module owns, and what it does not
 *
 * States 0, 1, 2, 4, 5, 6 and 7 are the ones an arm is in while it is alive, and
 * those are here. State 8 is the death, which the page drives through
 * {@link Foe.death}, and `0x418b40` is the hit handler, which the page drives
 * through {@link Foe.flinch} — a brain is never called during either. They are
 * named at {@link NOT_HERE} together with the object words and engine globals
 * this class leans on that a brain here cannot see.
 */
import {
  install,
  type Brain,
  type BrainCtx,
  type Enemy,
  type Gate,
  type Reaction,
  TICK_SCALE,
} from "./kit";

/**
 * The state and the handler the page owns, and everything else the executable
 * asks that nothing here can answer. Read, not done.
 *
 * - **state 8, `0x418af6`, the death.** Three instructions: `mov word ptr
 *   [esi+0x10], 0xff6a`, then `obj+0x2e` and `obj+0x46`, and only then the one
 *   `mov ax, 1` in the whole function — the frame the object is removed.
 *   `obj+0x10` is the floor offset (`rat.ts` reads the same −150 out of
 *   `0x44e33f`), so the corpse is free to travel a hundred and fifty pixels
 *   above whatever it was lying on for the whole of `0x46d0b0`, whose own first
 *   frame carries `dy -130`. {@link Foe.death} plays the script and
 *   {@link Foe.frail} the launch.
 * - **`0x418b40`, the hit handler.** A hitter whose strength is −1 has it
 *   rewritten to 100 on the hitter itself and is taken as that
 *   (`0x418b47`..`0x418b4e`). Then `if (obj+0x18 == 5) return 0` — **an arm
 *   that has hold of you cannot be hit** ({@link armGate}); a strength of
 *   exactly −6 answers 1 and does nothing else (`0x418b6a`), and anything
 *   else under 1 is refused. The −1 is the BLASTER's bolt, whose think writes
 *   it for the blaster's variants (`0x413bf9`), and LAB hands out blaster
 *   packs among its arms — {@link Foe.minusOne}. In state 5 the rewrite has
 *   already happened when the 0 goes back, so the bolt goes on through the
 *   pass at a hundred and strikes whatever is behind the arm (`stepBolts`). It is not a pickup's code:
 *   a pickup is built by `0x45b160` through `0x430dc0`/`0x42f610`, which
 *   leaves `obj+0x1a` at 0 (`0x42f66f`), its code lives in its own six bytes
 *   (`0x45b18c`), and `0x430367` never lets a strength of 0 strike anything.
 *   Nothing writes −6 into a strength, so that arm is read and not spent.
 *   What is left sprays through `0x42f910`/`0x40cba0`, plays `lab.snd`
 *   0x25, installs `0x46d0b0` and pays `0x40d450(0x71)`. Nothing is
 *   subtracted from anything: one blow of any size and the arm is done, which
 *   is what {@link Foe.frail} and `health: 1` say. It tests no class at all,
 *   so arms hurt arms ({@link Foe.hitsOwn}).
 * - **`obj+0x2a`, the "my blow landed" word.** `0x430663`, the elastic
 *   collision solver, sets it to 1 on the HITTER — `esi` there is the object
 *   whose `obj+0x1a` strength the exchange spent (`0x43047a`). `0x418904`
 *   clears it as the lunge goes in and `0x418992` reads it back every frame:
 *   an arm whose lunge CONNECTED then measures itself against the point it
 *   remembered, and if it is within fifty pixels of it in both axes it has
 *   you. Nothing in this port writes that word onto a foe whose blow lands on
 *   the player — `rat.ts` reads the same word out of `0x44e304` — so state 4
 *   here only ever takes its other branch and state 5 is unreachable. Its
 *   tail is ported anyway, so that an arm the page ever does put in state 5
 *   comes out of it correctly.
 * - **`[0x46b1b4]`, the grab claim.** A single engine-wide word, 1 in the file
 *   and therefore free at boot. `0x4189cf` refuses the grab unless it is 1,
 *   `0x418a1b` takes it to 0 as the hold goes on and `0x418aa1` hands it back as
 *   the hold ends. It is what stops two of the ten holding you at once, it is
 *   shared with a dozen other classes (`0x412d9a`, `0x41fa8d`, `0x421247`,
 *   `0x4236cd`…), and a brain here is handed no view of it.
 * - **`[0x4a50f0]`/`[0x4a50f2]`, the remembered point.** The y and x the lunge
 *   aims at, written at `0x418937`/`0x418942` and `0x418969`/`0x418977` as the
 *   attack is installed and read back at `0x4189a1`/`0x4189bc`. Two engine
 *   globals, and {@link Enemy} has no slot for a point. Only the grab uses them,
 *   so they go with it.
 * - **the carry, `0x418a6c`.** Every frame of the hold writes the arm's own
 *   packed `(y, x)` straight over the player's: `mov eax, [esi+6]; mov ecx,
 *   [0x4ac3d4]; mov dword ptr [ecx+6], eax`. **Nothing in this port hits the
 *   player back**, and moving him is hitting him, so the carry is read and
 *   spends nothing.
 * - **`[0x46b1a8]`, which of the two player characters is in play.** `0x402f60`
 *   — the "he is upright" test the whole game asks — branches on it, and
 *   `0x4189d9` uses it to choose between the hold's tag 0 (cels 4500..4503) with
 *   `lab.snd` 0x2c and its tag 1 (cels 5900..5903) with 0x2d. This page has one
 *   player, so {@link ARM.hold} is tag 0 and tag 1 is carried as read.
 * - **the player's own CROUCH.** `0x4188f6` and `0x41890a` both ask
 *   `cmp word ptr [player+0x18], 6`, and player kind 6 is the duck —
 *   `players.ts` reads `0x4717c8`'s kind-6 handler `0x42a9a0` as a whole crouch
 *   state machine. A ducking player gets {@link ARM.lunge} tag 1: the hand lifts
 *   `dy -100` instead of `-200` and aims at his feet rather than seventy pixels
 *   above them. {@link BrainCtx.player} exposes `down`, which is `0x402f60`'s
 *   own `obj+0x18 >= 0x1a`, and nothing finer — so tag 1 is named in the table
 *   below and never installed.
 */
const NOT_HERE = "0x418af6, 0x418b40, 0x418992, 0x418a6c, 0x4188f6" as const;

/**
 * Its whole repertoire, by kind and tag, out of `0x46cf10`…`0x46d120`.
 *
 * The class uses two cel sheets and the split is the story: 500..510 is the hand
 * still in the wall, and everything from 3320 up is the hand loose on the floor.
 * Only two scripts move at all — kind 7 travels flat, and kind 4's seventh frame
 * is a single launch.
 */
export const ARM = {
  /**
   * kind 0 tag 0 — the hand in the wall, out and back. **Seven cels and not one
   * of them carries a stride**, and the whole of the note above is about not
   * giving them one.
   */
  reach: {
    cels: [500, 501, 502, 503, 502, 501, 500],
    hold: 3,
    kind: 0,
    tag: 0,
    from: "0x46cf10 tag 0",
  },
  /**
   * kind 1 tag 0 — it comes out. The same seven cels as the reach and then
   * 504..510, which is why `0x41883a` watches for frame **7**: that is the first
   * cel the disc has not shown before.
   */
  emerge: {
    cels: [
      500, 501, 502, 503, 502, 501, 500, 504, 505, 506, 507, 508, 509, 510,
    ],
    hold: 1,
    kind: 1,
    tag: 0,
    from: "0x46cf50 tag 0",
  },
  /** kind 2 tag 0 — two cels on the floor going nowhere: the stance, and state 2 */
  stance: {
    cels: [3360, 3361],
    hold: 3,
    kind: 2,
    tag: 0,
    from: "0x46cfc8 tag 0",
  },
  /**
   * kind 7 tag 0 — the CRAWL, and the only thing this class does that travels:
   * four cels at one tick each, `dx 60` on every one of them.
   */
  crawl: {
    cels: [3380, 3381, 3382, 3383],
    hold: 1,
    dx: [60, 60, 60, 60],
    kind: 7,
    tag: 0,
    from: "0x46cfe0 tag 0",
  },
  /**
   * kind 4 tag 0 — the lunge at a standing player. Three cels of wind-up, 3343
   * held for three frames, and then the seventh frame carries `dx 200, dy -200`
   * — the hand leaves the floor — before 3349 comes down.
   */
  lunge: {
    cels: [3340, 3341, 3342, 3343, 3343, 3343, 3344, 3349],
    hold: 2,
    dx: [0, 0, 0, 0, 0, 0, 200, 0],
    dy: [0, 0, 0, 0, 0, 0, -200, 0],
    kind: 4,
    tag: 0,
    from: "0x46d120 tag 0",
  },
  /**
   * kind 4 tag 1 — the same eight cels at a DUCKING player, and the only
   * difference is that the hop is half as high. `0x418916` picks it and aims the
   * remembered point at his feet rather than seventy pixels up; this page cannot
   * see his crouch, so it is here to be read and not installed
   * ({@link NOT_HERE}).
   */
  lungeLow: {
    cels: [3340, 3341, 3342, 3343, 3343, 3343, 3344, 3349],
    hold: 2,
    dx: [0, 0, 0, 0, 0, 0, 200, 0],
    dy: [0, 0, 0, 0, 0, 0, -100, 0],
    kind: 4,
    tag: 1,
    from: "0x46d120 tag 1",
  },
  /** kind 6 tag 0 — six cels of turning round, and `0x418abd` flips the mirror */
  turn: {
    cels: [3320, 3321, 3322, 3323, 3324, 3325],
    hold: 2,
    kind: 6,
    tag: 0,
    from: "0x46d0e8 tag 0",
  },
  /**
   * kind 5 tag 0 — the HOLD: ten cels of the player being shaken, 4502 and 4503
   * alternating four times. Nothing here travels; the travelling is the carry
   * that writes the arm's position onto the player ({@link NOT_HERE}).
   */
  hold: {
    cels: [4500, 4501, 4502, 4503, 4502, 4503, 4502, 4503, 4502, 4503],
    hold: 2,
    kind: 5,
    tag: 0,
    from: "0x46d008 tag 0",
  },
  /**
   * kind 5 tag 1 — the same ten beats on the other player character's sheet,
   * chosen by `[0x46b1a8]` at `0x4189d9`. One player on this page, so read only.
   */
  holdB: {
    cels: [5900, 5901, 5902, 5903, 5902, 5903, 5902, 5903, 5902, 5903],
    hold: 2,
    kind: 5,
    tag: 1,
    from: "0x46d008 tag 1",
  },
  /**
   * `[0x46d1a8]` — the descending, zero-terminated list the creator hands
   * `0x45ef70` as its fourth argument, and `0x45ef70` copies words until it
   * reads a zero. Three thresholds, so four bands plus −1 behind:
   *
   * ```
   *   band 0   beyond 180     it crawls
   *   band 1   160 .. 180     39 chances in 400, or any frame he is mid-blow
   *   band 2    40 .. 160     it lunges, every time
   *   band 3   inside 40      nothing at all — right on top of it, it cannot grab
   * ```
   *
   * Band 3 really is a hole: `0x4188a4` tests 0, 1 and 2 and lets everything
   * else fall through to `0x41897b`, which does nothing but loop the stance.
   */
  bands: [180, 160, 40],
  /** `lab.snd` through `0x40ef30(0x4a56d0, …)` — and the bank is LAB's, not `0x4a7910` */
  slap: 0x26,
  breaks: 0x27,
  scuttle: 0x28,
  from: "0x4187a0",
} as const;

/**
 * `0x4188e4` — `cmp ax, 0x28`, and `ax` is still the `0x434540(0x190)` rolled at
 * the top of the function. Thirty-nine chances in four hundred.
 */
const NERVE = 0x28;

/**
 * `0x418a8f`/`0x418a94` — the shove the hold ends with.
 *
 * `cmp word ptr [esi+0x28], 1; sbb eax, eax; and eax, 0xffffff9c; add eax, 0x32`
 * is fifty when the mirror flag is set and minus a hundred plus fifty — so minus
 * fifty — when it is clear. `obj+0x28` set is facing west, so either way the arm
 * pushes itself fifty pixels BACKWARDS as it lets go.
 */
const RELEASE = 50;

/**
 * `initarm`'s own machine, states 0 to 7.
 *
 * ## The stack frame, and how it is pinned
 *
 * `0x4187a0` opens `sub esp, 0xc` and takes the buffer address immediately,
 * `lea eax, [esp]`, *before* the two register pushes — so the tracker's output
 * is the whole of the reserved frame and nothing else, and twelve bytes is
 * exactly what `0x45efd0` writes (`out+0` a dword, then words at `+4`, `+6`,
 * `+8` and `+0xa`). That is the pin: the reservation and the structure are the
 * same size, so there is nowhere else the buffer could be.
 *
 * The argument slots agree. After the prologue and `add esp, 4` the body runs
 * with `esp` fourteen bytes above entry, and `0x4187c4`'s `mov esi, [esp+0x1c]`
 * — taken two pushes earlier — resolves to entry+4, the object. In body terms
 * the object is `[esp+0x18]` and the AI struct `[esp+0x1c]`, and the buffer
 * begins at `[esp+8]`:
 *
 * ```
 *   [esp+0x08]  out+0     side          (this class never reads it)
 *   [esp+0x0c]  out+4     BAND          0x4188a4
 *   [esp+0x0e]  out+6     he is mid-blow 0x4188ea
 *   [esp+0x10]  out+8     dy            (never read either)
 *   [esp+0x12]  out+0xa   FORWARD       0x418890, 0x418ad8
 * ```
 *
 * Read four bytes low and `0x4188a4`'s three-way test on the band becomes a test
 * on the side, which has exactly the same 0/1/2 shape and compiles just as well.
 *
 * ## The AI struct, which is NOT the punk's
 *
 * `0x4118f0` mallocs **`0x2c`** bytes and fills three things:
 *
 * ```
 *   AI+0    dword   creator arg 2   the record's rect, words 0 and 1
 *   AI+4    dword   creator arg 3   the record's rect, words 2 and 3
 *   AI+8            the TRACKER 0x45ef70 builds: self, player, band count, bands
 *   AI+0x2a word    creator arg 4   the record's own word 0
 * ```
 *
 * There is no nerve, no beat, no decision budget and no wanted side anywhere in
 * it — the punk's `AI+0`, `AI+2`, `AI+4` and `AI+6` are this class's RECT. So
 * `0x4187e5`'s `0x434200(player.point, AI+0)` is the rect test, which this page
 * already answers as {@link Enemy.fighting}, and `e.nerve`, `e.beat`,
 * `e.decisions` and `e.side` are left untouched below because this class has no
 * such things.
 *
 * `AI+0x2a` is the record's `param`, and LAB's ten records split on it: four
 * carry 0 and six carry 1. `0x411995` — param zero — starts the arm **already
 * out**, with a divisor of six, a shove weight of two, gravity 1.0 and
 * `0x46cfc8` installed, which is state 2. `0x411967` — param one — starts it in
 * the wall with divisor 0, shove weight 0, no gravity and `0x46cf10`, state 0.
 * {@link Enemy} carries no record param, so every arm here starts in state 0 and
 * has to break out of the wall before it fights. `0x418877` clears `AI+0x2a` on
 * the way out, so an arm that has emerged once is an already-out arm from then
 * on.
 *
 * ## The return value
 *
 * Every path of `0x4187a0` but one ends at `0x418802`, `xor ax, ax` — and that
 * common tail also does `mov word ptr [esi+0x1a], 0x64`, so **this class's
 * strength percent is a flat hundred, rewritten every frame, in every state**.
 * Nothing hits the player back in this port, so it is carried as a comment.
 *
 * The single `mov ax, 1` is `0x418b12`, the corpse. So every path below returns
 * `false`, waiting states included.
 */
export const arm: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, ARM.bands);
  /**
   * `0x4187bf` — `0x434540(0x190)`, rolled ONCE at the top of the function,
   * before the dispatch, whatever state the arm is in. Only state 2 band 1 ever
   * spends it, and it is rolled here rather than there because that is where the
   * executable rolls it.
   */
  const dice = k.roll(0x190);
  switch (e.script ?? 0) {
    /**
     * ---- 0, `0x4187db`: still in the wall, and the one thing that ends it.
     *
     * `0x434200(player.point, AI+0)` — his own point inside this record's rect,
     * and nothing else: not a radius, not a sight line, not the room. Until then
     * the hand just goes on reaching, and every time the seven cels run out it
     * is put on again and `lab.snd` 0x26, `#2016 armhits ground`, goes with it.
     */
    case 0: {
      /**
       * `0x411962` — a record with param 0 is not in a wall at all. The creator
       * gives it weight 2, divisor 6 and gravity 1.0 and installs the stance,
       * `0x46cfc8`, straight away (`0x411995`..`0x4119b7`), so it is on the
       * floor and fighting from the first frame. LAB places four of these and
       * six of the wall kind (param 1).
       */
      if (!e.param) {
        // `0x41199b` — and its divisor is 6, not the 10 a wall arm comes out
        // with; `0x4119a7` gives it gravity 1.0, where the wall kind has none
        e.divisor = 6;
        e.weightless = false;
        return install(e, ARM.stance);
      }
      // `0x41196d` — a hand in a wall has no shove weight until it is loose
      e.shove = 0;
      if (e.fighting) {
        // `0x4187f2` — out through the wall, and `0x41883a` will sound it
        e.thrown = false;
        return install(e, ARM.emerge);
      }
      if (!done) return false;
      /**
       * `0x418818` re-installs the script it is already playing, and `0x45d090`
       * does not early-out: it rewinds `obj+0x42` and clears `obj+0x46`. That
       * rewind is the point here — it is what makes the slap one a cycle rather
       * than one a tick — and {@link install} deliberately will not do it for an
       * animation already running, so it is done by hand.
       */
      e.clock = 0;
      install(e, ARM.reach);
      // `0x41882c` — and the sound comes after the install, at the new frame 0
      k.say(e, ARM.slap);
      return false;
    }
    /**
     * ---- 1, `0x41883a`: breaking out, and one named frame in the middle of it.
     *
     * `cmp word ptr [esi+0x42], 7` — `obj+0x42` is the frame index `0x45d090`
     * rewound — is cel **504**, the first one the reach never shows, and that is
     * where `lab.snd` 0x27, `#2017 armbreaks`, goes. The script runs at one tick
     * a cel so the executable's test passes exactly once; here {@link
     * Enemy.thrown} holds it to once, which is the field's own stated job.
     */
    case 1: {
      if (!e.thrown && e.clock >= 7 * ARM.emerge.hold) {
        e.thrown = true;
        k.say(e, ARM.breaks);
      }
      if (!done) return false;
      /**
       * `0x418868` — and once it is loose it is a different object: `obj+0xe`
       * goes from 0 to **0xa**, the speed divisor and so its mass; `obj+0x26`
       * from 0 to **2**, the shove weight `0x430680` gates the overlap pass on;
       * and `0x42f850(esi, 1.0f)` puts `obj+0x24`, the gravity multiplier, up
       * from nothing to ten times one. A hand in a wall does not fall and a hand
       * on the floor does. The divisor is {@link Foe.divisor}'s 10 and the
       * gravity is {@link Enemy.weightless} going off; `0x418877` clearing
       * `AI+0x2a` is the record param going away ({@link NOT_HERE}).
       */
      e.weightless = false;
      e.shove = undefined;
      return install(e, ARM.stance);
    }
    /**
     * ---- 2, `0x418890`: the stance, and the only state that decides anything.
     *
     * Behind it first, then the band. Note what is NOT here: no `obj+0x46` gate
     * on the way in. States 1, 4, 5, 6 and 7 all wait for their own script to
     * finish before they do anything; this one re-reads the tracker every single
     * frame and will turn or lunge in the middle of its own two-cel stance.
     */
    case 2: {
      // `0x418890` — `cmp word ptr [esp+0x12], 0`, the forward distance
      if (t.forward < 0) return install(e, ARM.turn);
      switch (t.band) {
        /**
         * `0x4188bc` — beyond a hundred and eighty in front of it, and this is
         * the crawl: `lab.snd` 0x28 is `#2019 arm crawl` and the script that
         * goes on behind it is the one with a stride. See the note at the head
         * of this file for why that is worth being sure about.
         */
        case 0:
          k.say(e, ARM.scuttle);
          return install(e, ARM.crawl);
        /**
         * `0x4188e4` — 160 to 180, the band where it needs a reason. Thirty-nine
         * chances in four hundred off the roll made at the top, or — `0x4188ea`,
         * `cmp word ptr [esp+0xe], 0` — any frame the player's own cel carries a
         * strike box. Otherwise it stands.
         */
        case 1:
          if (dice >= NERVE && !k.player.swinging) {
            return done ? install(e, ARM.stance) : false;
          }
          return reach(e);
        /**
         * `0x418904` — 40 to 160, and it goes every time. It clears `obj+0x2a`
         * first so that `0x418992` can tell a lunge that connected from one that
         * did not ({@link NOT_HERE}); band 1's own route into the same attack
         * does not, which is the executable's asymmetry and not a misreading.
         */
        case 2:
          return reach(e);
        /**
         * Band 3 — inside forty pixels — and band −1, which the forward test
         * above has already taken. `0x4188b7` falls through to `0x41897b`, which
         * loops the stance and nothing else.
         */
        default:
          return done ? install(e, ARM.stance) : false;
      }
    }
    /**
     * ---- 3: `0x418802`, the common return, and the class owns no kind-3
     * script. Nothing can put an arm here — see the default below.
     */
    /**
     * ---- 4, `0x418992`: the lunge, which only ever ends one way here.
     *
     * The executable opens on `obj+0x2a`, then on being within fifty pixels of
     * the point it remembered, then on the engine-wide grab claim — three things
     * this port cannot see ({@link NOT_HERE}). What is left is `0x418a4a`, the
     * tail: the eight cels play out, the hand comes back down, and it stands.
     */
    case 4:
      // `0x418a55` — `obj+0x2e`, back on the ground after the hop
      if (!done || e.vy !== 0) return false;
      return install(e, ARM.stance);
    /**
     * ---- 5, `0x418a6c`: the hold, which nothing here can reach.
     *
     * Its body is the carry and its immunity is in the hit handler; both are at
     * {@link NOT_HERE}. The tail is ported so that the state is complete: when
     * the ten beats have played the arm shoves itself fifty pixels backwards and
     * hands the grab claim back.
     */
    case 5:
      if (!done) return false;
      e.x -= RELEASE * (e.facing > 0 ? 1 : -1);
      return install(e, ARM.stance);
    // ---- 6, `0x418ab2`: the turn, and `xor byte ptr [esi+0x28], 1` is the whole of it
    case 6:
      if (!done) return false;
      e.facing = -e.facing;
      return install(e, ARM.stance);
    /**
     * ---- 7, `0x418acd`: the crawl ends by asking the same question state 2
     * opens with — is he still in front of me — and either stands or turns.
     */
    case 7:
      if (!done) return false;
      return t.forward < 0 ? install(e, ARM.turn) : install(e, ARM.stance);
    /**
     * ---- 8, `0x418af6`, the death, and state 3, which has no script: the page
     * plays the one and nothing reaches the other. See {@link NOT_HERE}.
     */
    default:
      return false;
  }
};

/**
 * `0x4188f6` and `0x41890a` — the two ways into the lunge, which are the same
 * four instructions twice.
 *
 * Both ask `cmp word ptr [player+0x18], 6`, the player's crouch, and both then
 * write the point the hand is aimed at into `[0x4a50f0]`/`[0x4a50f2]`: his own
 * position when he is ducking, and his position less `0x46` — seventy pixels, so
 * chest height — when he is standing. The crouch is not a question this page can
 * put ({@link NOT_HERE}), so what goes on is always tag 0, the standing reach.
 *
 * `once` because it is an attack: it plays through and hands back, where the
 * stance and the reach loop.
 */
function reach(e: Enemy): false {
  return install(e, ARM.lunge, true);
}

/**
 * State 8, `0x418af6`, while the page plays `0x46d0b0`.
 *
 * The death's first frame carries `dy -130`, which `0x42f8b0` adds to
 * `obj+0xa` through the divisor — ten for an arm that came out of the wall
 * (`0x418868`), six for one that started on the floor (`0x41199b`) — rounded
 * away from zero; gravity 1.0 brings the hand back down, and
 * `0x418afc` removes it once it has landed and the six cels are done. The page
 * does not spend a death script's lift, so it is spent here on the first call.
 */
export const armReacts: Reaction = (e, foe, _run, _k) => {
  if (e.state !== "dead" || e.anim !== foe.death || e.threw) return;
  e.threw = true;
  // `0x418af6` — `obj+0x10 = -150` on every frame of state 8: the foot goes a
  // hundred and fifty up the cel, so the body falls that far through the floor
  // before `obj+0x2e` calls it landed
  e.floor = -150;
  // ...and the first record's lift is ADDED to what the exchange left it
  // with: `0x45d090` only puts the script on, and it is `0x45d1a3`, on the
  // next step, that hands the record's `dy / divisor` to `0x42f8b0`
  const lift = foe.death.dy?.[0] ?? 0;
  const q = lift / (e.divisor ?? foe.divisor);
  e.vy += (q < 0 ? -Math.ceil(-q) : Math.ceil(q)) * TICK_SCALE;
};

/**
 * `0x418b58` — `cmp word ptr [esi+0x18], 5; jne; xor ax, ax`: an arm holding
 * the player turns every blow away.
 */
export const armGate: Gate = (e, _foe, blow) => (e.script === 5 ? null : blow);

export { NOT_HERE as ARM_NOT_HERE };
