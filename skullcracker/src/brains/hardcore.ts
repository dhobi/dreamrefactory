/**
 * The thing at the end of SERVICE — `inithardcore`, think function `0x43cc60`, ten
 * states. Creator `0x436460`, class message proc `0x43cbb0`, damage proc
 * `0x43d250` (hung on `obj+0x12` at `0x43cbde`).
 *
 * ## Its nine scripts, and therefore its alphabet
 *
 * `0x45d090` copies word 4 of a script's header into `obj+0x18`, so the kinds of
 * the scripts this class installs ARE its states. The whole data region was
 * walked — `0x474940`…`0x474bb0`, four-byte aligned, `{i16 count, i16
 * ticksPerFrame, i16 kind}` and then `count` eight-byte frames of `{tag, cel,
 * dx, dy}` — and a raw `struct.pack('<I', va)` search over `SC.EXE` proves that
 * every reference to every one of them lies inside `0x43cbb0`, `0x43cc60`,
 * `0x43d190` and `0x43d250`. Nothing else in the game touches them.
 *
 * ```
 *   0  0x474940  one cel, 6070: what it stands as until you walk into the rect
 *   1  0x474950  the same cel again at two frames — the stance, and the state
 *                that DECIDES
 *   2  0x474960  twelve frames of 6050..6055 twice: the roar
 *   3  0x474a38  6070..6073 at dx 100 apiece — the walk, and the ONLY script in
 *                the class that carries a stride
 *   4  0x474ab8  tag 0 and tag 1: the two throws, and what they throw
 *   5  ——        no script, and the jump table's entry 5 is the bare return
 *   6  0x4749c8  tag 0 the swipe (6040..6045), tag 1 a jab (6090..6092) that
 *                NOTHING in the class ever installs
 *   7  0x474a60  6055/6054 five times over at three frames a cel: the breather
 *   8  0x474b88  the flinch, 6030..6033, dx -100 on two of them
 *   9  0x474bb0  the death, 6000..6005, the first frame dx -65 dy -180
 * ```
 *
 * ## The shape of the machine, which is not the punk's
 *
 * `initwerea` patrols a territory it walks; this one does not patrol at all.
 * State 0 is `0x43ccda` and its entire body is `0x434200(player.point, AI+4)` —
 * the player's own point inside the four words the creator copied out of the
 * `init` record — and the one thing it can do is install the stance. Until you
 * step into its patch it is a statue on cel 6070.
 *
 * From there everything happens in state 1, `0x43cd0d`, and it is read in this
 * order every single frame:
 *
 * 1. `0x402f60` — is the player upright. If he is NOT, `0x43cd17` plays sound
 *    0x44, installs the breather, and points `obj+0x28` **away** from him (see
 *    the facing note below). That is the whole frame.
 * 2. `0x43cd5f` — he is behind me, so turn. This one does not return.
 * 3. `0x43cd6b` — unless he is inside the last band, a throw counter at `AI+0xc`
 *    past 2 means it stops and roars: sound 0x46, kind 2, counter back to zero.
 * 4. `0x43cda8` — `0x434540(AI+0 * 2) < 4`, which is a roll against its own
 *    REMAINING HEALTH. At 750 that is three chances in fifteen hundred; at 40 it
 *    is three in eighty. So the nearer this thing is to dead the more often it
 *    stops to breathe, and that is the only place in the class where its health
 *    changes what it does.
 * 5. `0x43cde3` — and only then the band, through a second jump table at
 *    `0x43d17c`, `[0x43cdf8, 0x43cdf8, 0x43cdf8, 0x43ce2f, 0x43ce2f]`: bands 0,
 *    1 and 2 throw on a beat, bands 3 and 4 roll for one of three answers.
 *
 * What comes out of it is a ranged fight. Beyond 220 pixels it waits out `AI+2`
 * and then throws, every time, and the only thing the roll at `0x43ce1e` decides
 * is whether it shouts first. Inside 220 it rolls one in three between walking
 * at you, swiping, and throwing anyway. The throw is the class — `0x43cf97`
 * hands the tag to `0x43d190`, which spawns a **separate object** of class
 * `[0x474938]` sixty pixels in front of it, seventy pixels up for tag 0 and
 * twenty-five DOWN for tag 1, on script `0x474870` — so the two tags are a high
 * throw and a low one, and each is a different thing to duck or jump.
 *
 * And the throw is interruptible in exactly one way. State 4, `0x43cf56`, tests
 * the band FIRST and before `obj+0x46`: get inside the innermost band while it
 * is winding up and `0x43cf5e` aborts the wind-up into the swipe. Nothing else
 * in the class abandons a script it has started.
 *
 * ## Where the stack frame is, and how it was pinned
 *
 * `0x43cc60` opens `sub esp, 0x10` and takes the buffer address at `0x43cc63`,
 * **before** any push — `lea eax, [esp]`, so the sixteen bytes sit at the very
 * top of the frame, the dog's shape and not the punk's. Then `push esi`, `push
 * edi`, `push eax`, `push ecx`, and after `add esp, 8` at `0x43cc77` two
 * registers are still down. So the buffer is at **`esp+8`**:
 *
 * ```
 *   esp+0x08   out+0     side          esp+0x10   out+8    player.y - self.y
 *   esp+0x0c   out+4     BAND          esp+0x12   out+0xa  forward distance
 *   esp+0x0e   out+6     strike box
 * ```
 *
 * The argument slots settle it: `0x43cc6a` reads the AI struct from `[esp+0x24]`
 * with four registers down, which is `entry+8`, and `0x43cc88` reads the object
 * from `[esp+0x1c]` with two down, which is `entry+4`. Both land exactly where
 * `(obj, AI)` has to be, and nothing else places the buffer consistently with
 * them. Read four bytes low and `cmp word ptr [esp+0xc], 4` — the innermost band
 * at `0x43cd6b`, `0x43cde8` and `0x43cf56` — becomes a test on `out+0`, the
 * side, which is 0, 1 or 2 and would make the class throw for ever.
 *
 * ## The AI struct, which is NOT the punk's
 *
 * `0x436460` allocates **0x34 bytes** at `0x433f20(0x34)` and fills them:
 *
 * ```
 *   AI+0      `0x4364b4`  0x40e300(0x2ee) — HEALTH, 750 before difficulty
 *   AI+2      `0x4364ae`  22 — the beat between throws at long range
 *   AI+4..b   `0x4364d4`  the record's rect: top, left, bottom, right
 *   AI+0xc    `0x4364dc`  0 — throws made since the last roar
 *   AI+0xe..  `0x4364f0`  0x45ef70's tracker: obj, player, band count, bands
 *   AI+0x30   `0x4364e4`  0 — corpse frames, seeded by the damage proc
 *   AI+0x32   `0x4364e0`  0 — never read again
 * ```
 *
 * So `AI+0` is **health and not the punk's nerve** — `0x43d2b4` is the damage
 * proc subtracting the blow from it and `0x43d2bf` is the test that kills the
 * thing — and it is carried here as {@link Enemy.hp}, which is the same word:
 * {@link Foe.panel} stands this class up with 750 and the page's own strike path
 * spends it. `AI+2` is the beat and rides {@link Enemy.beat}. `AI+0xc` has no
 * counterpart at all in {@link Enemy}; it is carried on {@link Enemy.decisions},
 * and **it does not mean what `decisions` means for the punk** — for the punk
 * that is `AI+4`, a budget spent down before committing, and here it is a count
 * of throws landed that is counted UP and reset by the roar.
 *
 * The rect is at `AI+4`, not the punk's `AI+8`, which is why state 0 does `add
 * edi, 4` at `0x43ccda` before handing it to `0x434200`. `0x434200` brackets the
 * point's low word (the Y, `obj+6`) with `rect+0`/`rect+4` and its high word
 * (the X, `obj+8`) with `rect+2`/`rect+6`, so `AI+6` is the LEFT edge and
 * `AI+0xa` the RIGHT — which is what state 3 stops its walk against.
 *
 * ## The bands, and the one helper this class does not use
 *
 * `0x4364cf` pushes **`0x474be8`** as the fourth argument to `0x45ef70`, and
 * `0x45ef8f` copies words out of it until one is not positive: `[500, 300, 220,
 * 160]`, four of them, terminated by the zero at `0x474bf0`. That is the list
 * `fights.ts` already carries for this class.
 *
 * It never calls `0x456550` or `0x456590`, the 60-pixel bound helpers every
 * walker in the punk chapter uses. State 3 compares `obj+8` against the record
 * rect's own edges directly, and so does the port.
 *
 * ## The preamble, which belongs to no state and cannot be ported
 *
 * `0x43cc7a`…`0x43ccc0` runs before the jump table and is not behaviour. While
 * the player is inside the outermost band (`[esp+0xc] >= 1`), in front
 * (`[esp+0x12] > 0`), and this one is neither a statue (state 0) nor dying
 * (state 9), it calls `0x40d1c0(AI+0, 0x40e300(0x2ee), 0x3331, self.point)` —
 * the on-screen enemy bar, its own health out of a full 750, under plate 0x3331.
 * {@link Foe.panel} already carries all three numbers. The kit has no bar, so
 * this is read and not done.
 *
 * ## The sounds, and the bank
 *
 * `mall.snd` — the bank is `0x4a75b0`, loaded at `0x43698e`, not the punk
 * chapter's `0x4a7910` that {@link BrainCtx.say}'s doc names. Every id below is
 * this bank's.
 *
 * ## What this module owns, and what it does not
 *
 * Eight of the ten — 0, 1, 2, 3, 4, 6, 7 and the empty 5 — are the ones it is in
 * while it is on its feet, and those are here. Kinds 8 and 9 are the hit
 * reactions and the page already drives them through {@link Foe.flinch} and
 * {@link Foe.death}; a brain is never called during them. They are named at
 * {@link NOT_HERE}.
 */
import {
  install,
  type Brain,
  type BrainCtx,
  type CastKit,
  type Enemy,
  type Reaction,
} from "./kit";

/**
 * State 9, `0x43d0c5`, on the frames the page's death is playing: `0x43d13e`
 * writes `obj+0x10 = -35` on every frame the script has not yet ended, and
 * nothing puts it back, so the body lies thirty-five pixels lower than the
 * zero the class init leaves it on.
 */
export const hardcoreReacts: Reaction = (e) => {
  if (e.state === "dead") e.floor = -35;
};

/**
 * The hit reactions, states 8 and 9, and the damage proc that installs them.
 * The page owns those animations; state 8's exit is the brain's, below.
 *
 * - **`0x43d250`**, the damage proc, is the shortest in the chapter and the only
 *   one with no ignore list. It swallows a blow of exactly −6 (`0x43d25c`,
 *   returning 1 with nothing spent), ignores a blow of 0, and otherwise takes
 *   `0x42f910`'s figure off **`AI+0`** at `0x43d2b4`. Over zero it plays sound
 *   0x45 and installs the flinch, `0x474b88`; at or under it clears the bar with
 *   `0x40d1c0(0, 0, 0, player.point)`, installs the death `0x474bb0`, pays
 *   `0x40d450(0x15e)` — 350 — seeds `AI+0x30` from `[0x46b204]` and sets
 *   `[0x472574] = 1`, the level's own flag that this thing is down — which
 *   SERVICE's goal waits for (`0x43b9ec`; `goalReady` in `walk.ts`).
 * - **8**, the flinch's exit, `0x43d062`: when the flinch ends it flips a coin.
 *   Heads is sound 0x48 and the WALK, `0x474a38`; tails is sound 0x47 and the
 *   swipe, `0x4749c8` tag 0. So hitting this thing is what makes it come at you,
 *   and it never returns to the stance off a flinch. The flinch's
 *   {@link FoeAnim.resume} hands the brain kind 8 and `case 8` flips the coin.
 * - **9**, the corpse, `0x43d0c5`: `0x42f7f0(obj, 0.7)` sets the bounce, sound
 *   0x3d plays on the frame `obj+0x2c` says it has landed, `AI+0x30` counts down
 *   and `0x43d131` is the only `mov ax, 1` in the whole of `0x43cc60` — the
 *   frame the object is removed. Every other path, the "my script has not
 *   finished" return at `0x43d144` included, answers `xor ax, ax`, which is why
 *   every path of this brain returns `false`.
 */
const NOT_HERE = "0x43d062, 0x43d0c5, 0x43d250" as const;

/**
 * Its repertoire, by kind and tag, straight out of `0x474940`…`0x474bb0`.
 *
 * Every cel, hold and stride below is the script's own header and frame list.
 * Only {@link HARDCORE.close} carries a `dx`, 100 on each of its four cels, and
 * with the class's divisor of 13 (`0x43cbcb`) that is a little under eight
 * pixels an engine frame. Nothing in the class carries a `dy`: this thing never
 * leaves the ground, and what travels instead is the object its throw spawns.
 */
/**
 * What it throws — `0x43d190`, class `0x43c770`, script `0x474870`.
 *
 * ```
 *   43d1d0  obj+8 += mirror ? -60 : +60          sixty in front
 *   43d1ea  obj+6 -= 0x46   (tag 0)              ...and seventy UP
 *   43d1f7  obj+6 += 0x19   (tag 1)              ...or twenty-five DOWN
 *   43d220  0x45d090(obj, 0x474870, 0)           its script, tag 0
 * ```
 *
 * So the two tags of the thrower's own state are a high throw and a low one,
 * and each is a different thing to duck or jump. The class (`0x43c787`) gives
 * it a divisor of **1**, the knifeboy's bank, `obj+0x1a = 0x64`, and
 * `0x43c7c3` pushes 0.23f — `obj+0x24` = 2, so it droops like the knife does.
 * Tag 0 is one cel at `dx 80`, undivided: eighty pixels a frame.
 *
 * `0x43c860` is its think and it does one thing this page keeps: `obj+0x2a`
 * set — it has hit something — and the strength goes to **zero** the same
 * frame, so a thing that has already struck cannot strike twice. Landing
 * (`obj+0x2e`) installs `0x474910`, four cels of it coming apart.
 *
 * **Not modelled:** the whoosh `0x43c8af` loops while it flies (sound 0x3e
 * through `0x40ee90`), and `0x43c917`'s fork. When the launch frame ends a HIGH
 * throw (its `AI+8`, the thrower's tag, zero) rolls `0x434540(0x64)` and under
 * 30 takes tag 4 (cels 2114, 2115) rather than the ordinary tag 2 — and tag 4
 * comes BACK: `0x43c9bd` waits until it is more than 700 pixels from the thrower,
 * flips its mirror, zeroes its velocity, drops to the thrower's y + 25 and
 * returns on `0x4748c8`. The page flies the common one. Written down rather
 * than left out.
 */
export const HARDCORE_THROW: CastKit = {
  /** `0x474870` tag 0 — the launch, one cel */
  cels: [2100],
  hold: 1,
  /** `dx 80` over the class's own divisor of 1 */
  speed: 80,
  /** `0x43c7c3`'s 0.23f through `0x42f850` */
  pull: 2,
  /** `0x43d1d0` */
  ahead: 60,
  /** `0x43d1ea` — the HIGH throw, out of `0x474ab8` tag 0 */
  lift: 0x46,
  blow: 0x64,
  /** `0x474870` tag 2, the ordinary flight */
  then: { cels: [2101, 2102, 2103], hold: 1 },
  /** `0x474910` tag 0 — it coming apart where it lands */
  impact: { cels: [2104, 2105, 2106, 2107], hold: 1 },
  from: "0x43d190, script 0x474870, class 0x43c770",
};

/** ...and the LOW one, out of tag 1: `0x43d1f7` puts it 25 BELOW the point */
export const HARDCORE_THROW_LOW: CastKit = {
  ...HARDCORE_THROW,
  lift: -0x19,
  from: "0x43d190 tag 1, script 0x474870, class 0x43c770",
};

export const HARDCORE = {
  /**
   * kind 0 — one cel at one frame, and the only script the class is ever born
   * in: `0x43cbfc`, from the class message proc's create case.
   *
   * `0x43ccda` never re-installs it, because the engine leaves state 0 once and
   * never comes back.
   */
  wake: { cels: [6070], hold: 1, kind: 0, tag: 0, from: "0x474940 tag 0" },
  /** kind 1 — the same cel at two frames: the stance, and the state that decides */
  stance: { cels: [6070], hold: 2, kind: 1, tag: 0, from: "0x474950 tag 0" },
  /** kind 2 — six cels run twice, going nowhere: the roar, every fourth throw */
  roar: {
    cels: [
      6050, 6051, 6052, 6053, 6054, 6055, 6050, 6051, 6052, 6053, 6054, 6055,
    ],
    hold: 2,
    kind: 2,
    tag: 0,
    from: "0x474960 tag 0",
  },
  /**
   * kind 3 — the walk, and the ONLY script in the class with a stride.
   *
   * `fights.ts` already reads this one as the class's `close`.
   */
  close: {
    cels: [6070, 6071, 6072, 6073],
    hold: 2,
    dx: [100, 100, 100, 100],
    kind: 3,
    tag: 0,
    from: "0x474a38 tag 0",
  },
  /**
   * kind 4 — the two throws, and `obj+0x44` is what `0x43cf91` hands to
   * `0x43d190` to tell them apart.
   *
   * `0x43d1de`: tag 0 spawns the thrown object **`0x46` (70) above** this one's
   * feet and tag 1 **`0x19` (25) below** them, both `0x3c` (60) in front,
   * `0x43d1d0`'s `sbb`/`and 0x78`/`sub 0x3c` being the usual sign trick on
   * `obj+0x28`. The object is class `[0x474938]` on script `0x474870`, cels
   * 2100..2107 and 2114/2115: {@link HARDCORE_THROW} and
   * {@link HARDCORE_THROW_LOW}.
   */
  hurl: [
    {
      cels: [
        6010, 6011, 6012, 6013, 6014, 6015, 6014, 6013, 6014, 6015, 6014, 6061,
        6062,
      ],
      hold: 1,
      kind: 4,
      tag: 0,
      from: "0x474ab8 tag 0",
    },
    {
      cels: [
        6010, 6010, 6011, 6011, 6012, 6012, 6011, 6010, 6011, 6012, 6061, 6062,
      ],
      hold: 1,
      kind: 4,
      tag: 1,
      from: "0x474ab8 tag 1",
    },
  ],
  /** kind 6 tag 0 — the swipe, and the only thing it does in close */
  swipe: {
    cels: [6040, 6041, 6042, 6043, 6044, 6045, 6044, 6043],
    hold: 1,
    kind: 6,
    tag: 0,
    from: "0x4749c8 tag 0",
  },
  /**
   * kind 6 tag 1 — five cels of a jab that NOTHING installs.
   *
   * All three `push 0x4749c8` sites — `0x43ce69`, `0x43cf74`, `0x43d0b3` — push
   * a tag of 0 alongside it, and a raw four-byte search for `0x4749c8` over the
   * whole executable finds no fourth. It is in the class's data and in
   * `fights.ts`'s attack list, and the class's own machine cannot reach it. It
   * is written out here so the next reader does not go looking for the state
   * that picks it; the brain below never installs it either.
   */
  jab: {
    cels: [6090, 6091, 6092, 6091, 6090],
    hold: 1,
    kind: 6,
    tag: 1,
    from: "0x4749c8 tag 1",
  },
  /** kind 7 — two cels alternating five times at three frames each: the breather */
  pant: {
    cels: [6055, 6054, 6055, 6054, 6055, 6054, 6055, 6054, 6055, 6054],
    hold: 3,
    kind: 7,
    tag: 0,
    from: "0x474a60 tag 0",
  },
  /** `0x474be8` via `0x4364cf` — the descending list `0x45efd0` reads the band out of */
  bands: [500, 300, 220, 160],
  /**
   * `mall.snd` ids — the bank is `0x4a75b0`, not the punk chapter's `0x4a7910`.
   *
   * `0x45` is the sound a blow lands on (`0x43d31b`) and `0x3d` the corpse's
   * thud (`0x43d0de`); both belong to the page's own hit path and are not here.
   */
  grunt: 0x43,
  breath: 0x44,
  bellow: 0x46,
  swing: 0x47,
  tread: 0x48,
  /** `0x43ce7a` — `0x434540(2) + 0x40`, so 0x41 or 0x42, shouted before a throw */
  shout: 0x40,
  /** `0x43d038` — `0x434540(2) + 0x3e`, so 0x3f or 0x40, as the breather ends */
  sigh: 0x3e,
  from: "0x43cc60",
} as const;

/** `0x43cd6b`/`0x43cde8`/`0x43cf56` — `cmp word ptr [esp+0xc], 4`, the innermost band */
const CLOSE_BAND = 4;

/** `0x43cd73` — more than two throws since the last roar and it stops to roar */
const THROWS_BEFORE_ROAR = 2;

/**
 * `obj+0x42`, the script's frame index, as this page can see it.
 *
 * `0x45d0ab` puts `obj+0x42` to zero on every install and the engine steps it
 * once every `ticksPerFrame` engine frames, so it is `floor(clock / hold)`. Two
 * states watch it and both do it to play a sound: `0x43cf1c` wants frame 2 of
 * the walk and `0x43cffa` wants every even frame of the breather. Both test it
 * on every engine frame, and the brain is called once an engine frame, so a
 * frame index held for two or three engine frames plays its sound on each.
 */
function frameIndex(e: Enemy, hold: number): number {
  return Math.floor(e.clock / hold);
}

/**
 * `inithardcore`'s own machine, states 0 to 8.
 *
 * Every path returns `false`. `0x43d144` — the tail every state in `0x43cc60`
 * jumps to, the "my script has not finished" return included — is `xor ax, ax`,
 * and the single `mov ax, 1` in the function is `0x43d131`, the frame the corpse
 * is removed. A brain that answered `true` anywhere would freeze this thing
 * mid-throw with its stride unspent.
 *
 * `0x43d148` also writes `obj+0x1a = 0x64` on that tail — the strength percent
 * it would hit with, set unconditionally on every frame of every state — 100,
 * which is what {@link Enemy.strength} reads when nothing sets it.
 */
export const hardcore: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, HARDCORE.bands);
  // `0x4364ae` — the creator seeds the beat at 22, and nothing else does
  e.beat ??= 22;
  // `0x4364dc` — and `AI+0xc`, the throws-since-the-last-roar counter, at zero.
  // This is NOT the punk's `AI+4` decision budget; see the header.
  e.decisions ??= 0;
  switch (e.script ?? 0) {
    /**
     * ---- 0, `0x43ccda`: the statue, and the one thing that ends it.
     *
     * `0x434200(player.point, AI+4)` and nothing else — no walk, no sight line,
     * no radius. {@link Enemy.fighting} is that test, already made for us.
     */
    case 0:
      return e.fighting
        ? install(e, HARDCORE.stance)
        : install(e, HARDCORE.wake);
    // ---- 1, `0x43cd0d`: the stance, and the only state that thinks every frame
    case 1:
      return decide(e, k, t, done);
    /**
     * ---- 2, `0x43ceca`: the roar ends in the walk, not in the stance.
     *
     * So the roar is not a pause — it is the wind-up to closing the distance,
     * and the only way out of the ranged fight the class has of its own accord.
     */
    case 2:
      return done ? install(e, HARDCORE.close) : false;
    /**
     * ---- 3, `0x43ceea`: the walk, which stops at the record rect's own edge.
     *
     * `0x43ceee` reads `obj+0x28` and then weighs `obj+8` against `AI+6` going
     * west or `AI+0xa` going east — the rect's left and right, the same four
     * words state 0 tests the player's point against. No `0x456550`, no 60-pixel
     * slack: the bound is the bound. Either way the walk hands to the stance
     * when its four cels run out.
     */
    case 3: {
      const east = e.facing > 0;
      if (east ? e.x >= e.right : e.x <= e.left) {
        return install(e, HARDCORE.stance);
      }
      // `0x43cf1c` — the tread, on frame 2 of the four
      if (frameIndex(e, HARDCORE.close.hold) === 2) k.say(e, HARDCORE.tread);
      return done ? install(e, HARDCORE.stance) : false;
    }
    /**
     * ---- 4, `0x43cf56`: the throw, and the only script in the class that can
     * be abandoned part-way through.
     *
     * The band test comes BEFORE `obj+0x46`, so the frame you get inside 160 the
     * wind-up is dropped for the swipe. Otherwise it plays out and `0x43cf97`
     * hands `obj+0x44` — which tag it was, and therefore how high the thing
     * comes at you — to `0x43d190`, which spawns it. That object is another
     * class and is not this module's; `AI+0xc` goes up by one and the stance
     * comes back.
     */
    case 4: {
      if (t.band === CLOSE_BAND) {
        k.say(e, HARDCORE.swing);
        return install(e, HARDCORE.swipe, true);
      }
      if (!done) return false;
      // `0x43cf97` — the thing leaves here, on the frame the wind-up ends, high
      // off tag 0 and low off tag 1 (`0x43d1de`)
      k.cast(e, (e.tag ?? 0) === 0 ? HARDCORE_THROW : HARDCORE_THROW_LOW);
      e.decisions = (e.decisions ?? 0) + 1; // `0x43cf9c`
      return install(e, HARDCORE.stance);
    }
    // ---- 5: the jump table's own entry is `0x43d144`, and the class has no
    // kind-5 script for it to belong to. Nothing can ever be in this state.
    case 5:
      return false;
    /**
     * ---- 6, `0x43cfb8`: the swipe grunts about a fifth of the time.
     *
     * `0x434540(0xa) < 3` at `0x43cfcd` — two in ten — and then the stance,
     * whether it grunted or not.
     */
    case 6:
      if (!done) return false;
      if (k.roll(10) < 3) k.say(e, HARDCORE.grunt);
      return install(e, HARDCORE.stance);
    /**
     * ---- 7, `0x43cffa`: the breather, which is also what it does while the
     * player is down.
     *
     * `0x43cffe` is the compiler's signed `obj+0x42 % 2` — every even frame
     * index of the ten plays sound 0x44 — and when the script ends `0x43d030`
     * plays `0x434540(2) + 0x3e` through **`0x40f090`**, which is not
     * `0x40ef30`: a different entry point in the same sound module, taking the
     * same `(bank, id, point)`. The kit has one primitive, so both go through
     * {@link BrainCtx.say}.
     */
    case 7: {
      if (!done && frameIndex(e, HARDCORE.pant.hold) % 2 === 0)
        k.say(e, HARDCORE.breath);
      if (!done) return false;
      k.say(e, HARDCORE.sigh + k.roll(2));
      return install(e, HARDCORE.stance);
    }
    /**
     * ---- 8, `0x43d062`: the flinch's exit, and a coin.
     *
     * The page plays the flinch (`0x474b88`) and its {@link FoeAnim.resume}
     * puts this state on the frame it ends — which is the frame `obj+0x46`
     * lets `0x43d06d` roll. Heads: sound 0x48 and the walk. Tails: sound 0x47
     * and the swipe.
     */
    case 8:
      if (k.roll(2) === 1) {
        k.say(e, HARDCORE.tread);
        return install(e, HARDCORE.close);
      }
      k.say(e, HARDCORE.swing);
      return install(e, HARDCORE.swipe, true);
    default:
      return false;
  }
};

/**
 * State 1, `0x43cd0d` — the whole of the fight, decided fresh every frame.
 *
 * Five tests in order, and the first four all outrank the distance.
 */
function decide(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
  done: boolean,
): boolean {
  /**
   * `0x43cd0d` — the player is down, and that is the whole frame.
   *
   * `0x43cd3a` then points `obj+0x28` by the plain comparison `self.x >=
   * player.x ? 0 : 1`, and `0x45efec` fixes what those mean: the tracker negates
   * the forward distance when `obj+0x28` is set, so 1 is WEST. Which makes this
   * line turn the thing's back on the man it has just floored — the same two
   * instructions the punk has at `0x44e704`, read the same way. It is written
   * out literally here because it is what the executable does.
   */
  if (k.player.down) {
    k.say(e, HARDCORE.breath);
    e.facing = k.anchorX(e) >= k.player.x ? 1 : -1;
    return install(e, HARDCORE.pant);
  }
  // `0x43cd5f` — he is behind me, so turn; and this one does NOT return
  if (t.forward < 0) e.facing = -e.facing;
  /**
   * `0x43cd6b` — three throws is enough, unless he is already on top of me.
   *
   * `AI+0xc` is counted up by state 4 on every throw that actually lands its
   * spawn, and the fourth time round the stance sees it past 2 the thing stops
   * shooting, bellows, and the roar hands to the walk. Inside the last band the
   * test is skipped outright, so it never roars in your face.
   */
  if (t.band !== CLOSE_BAND && (e.decisions ?? 0) > THROWS_BEFORE_ROAR) {
    e.decisions = 0;
    k.say(e, HARDCORE.bellow);
    return install(e, HARDCORE.roar);
  }
  /**
   * `0x43cda8` — `0x434540(AI+0 * 2) < 4`, a roll against its own health.
   *
   * `AI+0` is the health word the damage proc spends, so this is the class's one
   * concession to being hurt: three chances in twice whatever is left. Full at
   * 750 that is one frame in five hundred; at fifty health left it is one in
   * thirty-three. The `max(1, …)` is the port's, not the disc's — `0x434540`
   * is never reached with a dead object, because state 9 owns a corpse.
   */
  if (k.roll(Math.max(1, e.hp * 2)) < 4) {
    k.say(e, HARDCORE.breath);
    return install(e, HARDCORE.pant);
  }
  /**
   * `0x43cde3` — and only now the band, through `0x43d17c`.
   *
   * `movsx eax, word ptr [esp+0xc]; cmp eax, 4; ja` — so −1, the player behind
   * this one, falls straight through the unsigned compare to the tail.
   */
  switch (t.band) {
    /**
     * Beyond 220 — `0x43cdf8`, and it throws on a beat of its own.
     *
     * `AI+2` counts down every frame of the stance and only when it goes past
     * zero does anything happen; then it is reseeded `0x434540(6) + 8`, nine to
     * fourteen frames, and a throw goes out. `0x43ce1e`'s one-in-three does not
     * choose the throw — the throw happens either way — it chooses whether the
     * thing shouts first.
     */
    case 0:
    case 1:
    case 2: {
      const beat = e.beat ?? 22;
      e.beat = beat - 1;
      if (beat >= 0) break; // `0x43ce06` — still counting, fall to the tail
      e.beat = k.roll(6) + 8; // `0x43ce13`
      if (k.roll(3) === 1) k.say(e, HARDCORE.shout + k.roll(2)); // `0x43ce28`
      return throwOne(e, k);
    }
    /**
     * 220 and in — `0x43ce2f`, one roll of three and no beat at all.
     *
     * Walk at him, swipe, or throw anyway; and the two bands share the roll, so
     * stepping from 220 to inside 160 changes nothing about what it picks. What
     * 160 changes is state 4: from there a throw already in the air gets
     * abandoned for the swipe.
     */
    case 3:
    case 4: {
      const pick = k.roll(3);
      if (pick === 1) return install(e, HARDCORE.close); // `0x43ce4a`
      if (pick === 2) {
        k.say(e, HARDCORE.swing); // `0x43ce53`
        return install(e, HARDCORE.swipe, true);
      }
      k.say(e, HARDCORE.shout + k.roll(2)); // `0x43ce6f`
      return throwOne(e, k);
    }
    default:
      break;
  }
  /**
   * `0x43ceaa` — the tail, and every install above falls into it.
   *
   * `0x45d0db` clears `obj+0x46` as part of installing, so a state that has just
   * chosen a script always fails this test and returns; what actually reaches it
   * is the player standing behind this one, and the beat still counting down.
   * Either way it puts the stance back on — one cel, so `install`'s own guard
   * leaves the clock alone and the thing simply keeps standing.
   */
  return done ? install(e, HARDCORE.stance) : false;
}

/**
 * `0x43ce8f` — `0x434540(2) - 1`, so tag 0 or tag 1, and that is the whole of
 * the choice between the high throw and the low one.
 */
function throwOne(e: Enemy, k: BrainCtx): boolean {
  return install(e, HARDCORE.hurl[k.roll(2) - 1], true);
}

export { NOT_HERE as HARDCORE_NOT_HERE };
