/**
 * BOTH Skull Crackers — because `PLAYER.SBK` carries two of them.
 *
 * `0x402950` reads one word and calls one of two whole player implementations:
 *
 * ```
 *   402950  movsx eax, word ptr [0x46b1a8]
 *   40295c  je 0x40296c  ->  call 0x428080   ; character 0 — the 4xxx cels
 *   402961  je 0x402975  ->  call 0x442ad0   ; character 1 — the 9xxx cels
 * ```
 *
 * and `0x402d22` — input action 11, which the shipped key table leaves unbound —
 * TOGGLES that word. So swapping character mid-level is the original's own
 * feature and not this page's idea; see `walk.ts`'s Shift+C.
 *
 * Everything below `0x402950` doubles: `0x402900` and `0x402990` pair
 * `0x42e560`/`0x448a70` and `0x42e580`/`0x448a90`, each character installs its
 * hit handler on its own player object (`0x42e443` against `0x448c10`), each has
 * its own eight-slot blow-code table ({@link file://./codes.ts}), and each of the
 * twenty-eight animation KINDS is a different script:
 *
 * ```
 *   kind   what                character 0   character 1
 *     0    idle and fidgets    0x471648      0x475c88
 *     1    walk                0x471920      0x475f38
 *     2    run                 0x471988      0x475fa0
 *     3    jump / land         0x471b28      0x476140
 *     3    hard landing        0x471c68      0x476220
 *     4    punch               0x471c90      0x476240
 *     5    kick                0x471d68      0x476300
 *     6    crouch and crawl    0x4717c8      0x475dd8
 *     7    ladder              0x471e78      0x476428
 *     9    -2's judder         0x471fc8      0x476578
 *    10    held                0x4720e8      0x476698
 *    13    the spawn pose      0x471b18      0x476130
 *    16    (walk again)        0x471ab0      0x4760c8
 *    23    stagger             0x472140      0x4766f0
 *    24    knockdown           0x4722a8      0x476890
 *    26    down / dying        0x4721a0      0x476758
 *    26    -8's bowl           0x472248      0x476830
 * ```
 *
 * ## They are not the same person in different clothes
 *
 * Most rows really are character 0's plus five thousand — 1 -> 5001, 400 -> 5400,
 * 4570 -> 9570 — which is exactly why a hybrid page ran for as long as it did.
 * But the two movesets differ wherever it matters, and every difference here was
 * read out of the scripts rather than assumed from the offset:
 *
 * ```
 *   walk       dx  95      dx 105        character 1 is faster on foot
 *   run        dx 180      dx 200        ...and faster running
 *   jump       dy -420     dy -500       ...and jumps higher
 *   run jump   dy -420     dy -480
 *   hop        dy -210     dy -240
 *   flying kick dy -310    dy -370
 *   crawl      47 a frame  315 on the LAST of five
 *   idle       1..8        5001..5008    the same, plus 5000
 *   fidget B   10..13      5050..5057    a different fidget, and there is no
 *                                        third fidget at all (no tag 3)
 *   duck       703         5702          and no duck fidget: tags 1, 2 and 3 of
 *                                        `0x475dd8` are all the one cel
 *   punch      W: rand of  W: one pose   character 0 tosses a coin for each of
 *              two, P: rand P: one pose  its three punches; character 1 only
 *              of two                    for the plain one
 *   P+K        650s, out   9800, with a  a headbutt against a leap
 *              and back    dy of -250
 * ```
 *
 * The frame counts say the same thing from the other side: `0x471648` is 47
 * frames and `0x475c88` is 41, `0x471c90` is 26 and `0x476240` is 23.
 *
 * The two bodies are different sizes as well, which is not a detail: cel 1 is
 * 98x145 with its art reaching 90 below the anchor and cel 5001 is 73x138 reaching
 * 71, so the same `p.y` means two different standing heights. Those
 * numbers are the cels' own and are read from `PLAYER.SBK` rather than written
 * here — {@link PlayerKit.standCel} is the cel to read them from.
 */

/** the cel lists one character wears, by what the page calls each state */
export interface PlayerAnim {
  idle: readonly number[];
  fidgetA: readonly number[];
  fidgetB: readonly number[];
  walk: readonly number[];
  run: readonly number[];
  launch: readonly number[];
  tuck: readonly number[];
  crouch: readonly number[];
  crouchFidget: readonly number[];
  crawl: readonly number[];
  air: readonly number[];
  land: readonly number[];
  climb: readonly (readonly number[])[];
  hang: readonly number[];
  /**
   * The FLAIL — kind 25, one cel. Every frame the state machine's preamble
   * (`0x4284ba`, `0x442f3f`) tests `obj+0x32`, the fall so far, and past 360 it
   * installs this script whatever the player was doing, unless they are already
   * in it, down or dead (kinds 25..27). Its handler (`0x4291e5`, `0x443c2b`)
   * zeroes `obj+0xc` every frame, so a flailing player drops straight down, and
   * it is what lands: past 530 into the dying script, else the hard landing
   * with ten health off.
   */
  flail: readonly number[];
  /**
   * The monkeybar — `0x472048` kind 8, five tags, and the only script in the
   * player's book that had nothing on this page's side. See `MONKEYBAR` in
   * {@link file://./walk.ts}: tag 0 hangs, 1 and 2 swing a hand each way, and
   * 3 and 4 are the chin-up and its way back down.
   */
  bar: readonly (readonly number[])[];
}

/** one thing the player does on a key, as the script's cels and their own dx */
export interface PlayerAction {
  cels: readonly number[];
  dx: readonly number[];
  /**
   * The records' own dy where any is nonzero. `0x45d0f0` hands both halves of a
   * record to `0x42f8b0`, so a record with a dy is a lift into the velocity
   * exactly as its dx is a push.
   */
  dy?: readonly number[];
  hold?: number;
  /**
   * The MOVE this is to `0x4029e0`, the blow-strength function, which the
   * state's handler calls with it on every frame of the striking tag and
   * stores as `obj+0x1a` — see `blowStrength` in {@link file://./walk.ts}.
   * `id` is the number pushed; `held` is the one pushed instead while P is
   * down (`0x42a4a2`: `P ? 5 : 1`); `from` is the first cel index whose tag
   * makes the call, past a tag-0 guard that does not.
   */
  move?: { id: number; held?: number; from: number };
  from: string;
}

export type PlayerActions = Readonly<Record<string, PlayerAction>>;

/** the impulses the scripts carry, in the engine's own hundredths */
export interface PlayerMeasured {
  walk: number;
  run: number;
  jump: number;
  /** the RUN's launch, `kind 3` tag 4 — the same as `jump` for character 0 */
  runJumpDy: number;
  rise: number;
  launchDx: number;
  runJumpDx: number;
  crawl: number;
  flyKickDx: number;
  flyKickDy: number;
  hopDx: number;
  hopDy: number;
  /** `0x472048` tag 1's own `dx` — what one swing along a monkeybar carries */
  barSwing: number;
}

/** one whole player: which cels, which moves, which numbers */
export interface PlayerKit {
  /** what `0x46b1a8` holds for this one */
  index: 0 | 1;
  name: string;
  anim: PlayerAnim;
  actions: PlayerActions;
  measured: PlayerMeasured;
  /** the standing cel, whose own box gives the feet and the eye line */
  standCel: number;
  /** how far the standing feet are below the anchor — that cel's box bottom */
  standFeet: number;
  /** and the tuck's */
  tuckFeet: number;
  /** the cel a ladder rests you on */
  restCel: number;
  /**
   * What the flail plays once the fall passes 630 (`cmp [player+0x32], 0x276`):
   * `0x42921d` pushes 0x17 and `0x443c63` pushes 0x10, each into the
   * character's own bank.
   */
  flailSound: number;
  from: string;
}

// ---------------------------------------------------------------------------
// character 0 — `0x428080`, and what this page has always played
// ---------------------------------------------------------------------------

// launchDx is the WALKING launch (0x471b28 tag 3); a RUNNING jump is tag 4's
// single record `200(dx 180, dy -420)` and keeps the run's own 180 — so
// runJumpDy is 420 here and 480 for character 1, whose tag 4 is its own
const MEASURED_0: PlayerMeasured = { walk: 95, run: 180, jump: 420, runJumpDy: 420, rise: 125, launchDx: 100, runJumpDx: 180, crawl: 47, flyKickDx: 190, flyKickDy: 310, hopDx: 120, hopDy: 210, barSwing: 120 };

/**
 * Which cels are which — `SC.EXE`'s own table, not a guess any more.
 *
 * The engine's animation scripts live in `.data` (see {@link MEASURED} for the
 * format and how they move things). Each is `{count, ticksPerFrame, kind}` and
 * `count` entries of `{tag, celId, dx, dy}`, and the player's are:
 *
 * ```
 *   0x471b18  kind 13   cel 1, held 12 ticks        the state a level starts in
 *   0x471920  kind  1   cels 100..111, dx  95       the walk
 *   0x471988  kind  2   cels 150..161, dx 180       the run
 *   0x471648  kind  0   cels 1..8 punch, 10..25     the attacks and the fidget
 * ```
 *
 * The level's own init settles which of them the player wears: after building
 * the player at `0x42f550`, `0x42e46d` calls `0x42f840(player, 13)`, and kind 13
 * is the single unarmed standing cel. The other cel ranges in `PLAYER.SBK` —
 * 1200s, 2700s, 3200s, 3300s — are the SAME man holding the blaster, the
 * flamer, the soaker and the scepter, each with a complete script of its own;
 * 7700s and 8300s are the second character, whose walk is 105 and run 200.
 *
 * Two things this corrects, both of which had been guessed by looking at cel
 * runs and both of which were wrong:
 *
 * - **the walk was not 650..655.** The engine's script for those cels is
 *   `650 651 652 653(+95) 654(+95) 655(+95) 654(-95) 653(-95) 652 651` — it goes
 *   out and comes back, so it is a lunge or a swing. The walk is 100..111, and
 *   it is twelve frames rather than six.
 * - **the player IS mirrored.** The old table paired 660..665 with 650..655 as
 *   "the disc carries both facings". It does not: there is one set of cels, and
 *   the engine flips them, which is exactly what `0x45d0f0` does to the frame's
 *   own `dx` when `obj+0x28` says the other way.
 */
const ANIM_0: PlayerAnim = {
  /**
   * `0x471648` kind 0 tag 0, at its own `ticksPerFrame` of **2** — the idle, and
   * it is an ANIMATION rather than the single cel this used to be. Fourteen
   * frames out and back, `1 2 3 4 5 6 7 8` then `7 6 5 4 3 2`, held two frames
   * each: 1.87s of breathing on a loop. The walk state installs it whenever no
   * direction is held (`0x429acc`), so it is what the player does when the keys
   * are quiet, and standing on cel 1 forever was simply missing it.
   *
   * The same script carries two more idles that this page cannot reach yet, and
   * they are worth writing down because they are gated on HEALTH: `0x429690`
   * compares `[0x4ac3d0]` against `[0x4ac3d8]` and installs tag 4 (`20 21 22 21`)
   * once the player is at or below half, which is a hurt man's idle. Damage is
   * still parked, so nothing here can drop below full.
   */
  idle: [1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2],
  /** kind 1 (`0x471920`) — twelve cels, one engine tick each, dx 95 */
  walk: [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111],
  /**
   * kind 2 (`0x471988`) — twelve cels, dx 180, so 15 a frame into the velocity and 330px a
   * second. This is the game's real travelling speed and it is a HELD key: see
   * {@link KEYS}, where W turns out to be the run rather than "up".
   *
   * The script's later tags are the exits from it — tag 1 is the same twelve
   * cels with dx 0 (running in place, which is what a run against a wall looks
   * like), tag 2 is `106 107 108` at dx 95 (the run decaying back into the
   * walk), and tag 3 is cel 921 three times. Only tag 0 is used here.
   */
  run: [150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161],
  /**
   * `0x471b28` kind 3, tags 2 and 3 — the launch, and where the crouch lives.
   *
   * ```
   *   tag 2   250 251 252 253(dx   0, dy -420)   standing
   *   tag 3   250 251 252 253(dx 100, dy -420)   running
   * ```
   *
   * Four frames at `ticksPerFrame` 1, and **the impulse is on the LAST of them**:
   * the original crouches through 250, 251 and 252 — three frames, 200ms — and
   * only then leaves the ground.
   *
   * The RUN state does not wind up at all: `0x429b80` installs tag 4, a single
   * record `200(dx 180, dy -420)` — an instant leap in the tuck, carrying the
   * run's own 180.
   *
   * This page plays the four cels but keeps its instant impulse, so the crouch is
   * the opening of the flight rather than a commitment before it. The faithful
   * version costs 200ms of standing still before every jump AND takes the
   * horizontal with it — those three frames carry `dx 0`, so the run does not
   * carry through the wind-up — which changes how a gap is crossed, not just how
   * it looks.
   */
  launch: [250, 251, 252, 253],
  /**
   * `0x471b28` tag 0 — the TUCK, cels `200 220` (94x129 and 82x127 against the
   * 145 standing): knees drawn up and forward. The kind-3 handler's dispatch
   * table (`0x42a3d4`) sends the launch tags 2/3/4 to `0x42a1c2`, which installs
   * tag 0 — so the pose held in FLIGHT is this, not the 251/252 flail. The flail
   * is the deep-fall pose: `0x42a109` compares `[player+0x32]` against 0x168 and
   * only a fall past 360 gets `0x471c68`'s slow loop (plus sound 10 through
   * `0x402ac0`). The legs-forward jump is the tuck, and this page used to skip
   * it entirely.
   */
  tuck: [200, 220],
  /**
   * The CROUCH, and it exists — reading only the unarmed handlers said it did
   * not, and that was the misread. `[player+0x18]` is the animation KIND,
   * dispatched through the 28-entry table at `0x429570`, and each kind handler
   * re-dispatches on the running script's current TAG (`[player+0x44]`). The
   * unarmed standing handler (kind 0, `0x429690`) really has no duck. The ARMED
   * ones all do, symmetrically:
   *
   * ```
   *   42b8ae  cmp [0x4ac3fc], 0          ; S held?          (1200s, blaster)
   *           push 5; push 0x471128      ; -> cel 1220, then 1222..1225 settled
   *   42cc03  cmp [0x4ac3fc], 0          ;                  (2700s)
   *           push 4; push 0x470a78      ; -> cel 2730, 2732 settled
   *   42c23f  tag 5 of 0x4713f8          ;                  (3200s) -> cel 3240
   * ```
   *
   * The settled crouch cels are ~116 tall against 145 standing. Jumping OUT of
   * the duck is real too: `0x42b90b`, J while ducked, installs tag 12 — `1260
   * 1261(0,-420)`, a launch from the knees.
   *
   * And the UNARMED duck is real too, one indirection further: the kind-15
   * standing handler's no-weapon branch reads S at `0x4289ea` and installs
   * `0x4717c8` tag 1 — cel **703**, one knee down, fists up, 116 tall against
   * the 145 standing. Installing a script sets the player's kind from the
   * script's own header (`0x4717c8` is kind 6), and kind 6's handler
   * (`0x42a9a0`) is a whole crouch STATE MACHINE:
   *
   * ```
   *   S held            tag 1   703            the duck, held
   *   (13 in 707 roll)  tag 2   704..707       the settle fidget
   *   S + A/D           tag 4   1000..1004     the CRAWL, dx 47 — 59px/s
   *   S + P             tags 5,6/7  710, 711..716   the duck-punch
   *   S + K             tags 8,9    720, 721..724   the duck-kick
   *   S + P + K         0x471d68 tag 6  630..632    the duck combo
   * ```
   *
   * The collision box follows the drawn cel, so ducking genuinely shortens the
   * player.
   */
  crouch: [703],
  /** `0x4717c8` tag 2 — the duck's own fidget, rolled 13 in 707 per frame */
  crouchFidget: [704, 704, 705, 705, 706, 706, 707, 707, 706, 706, 707, 707],
  /** `0x4717c8` tag 4 — the crawl, five cels each carrying dx 47 */
  crawl: [1000, 1001, 1002, 1003, 1004],
  /**
   * The idle FIDGETS — `0x471648` tags 1 and 2, `1 3 4 5 7 6 4 2` and
   * `10 10 11 11 12 11 12 12 13`. At the end of each idle cycle `0x42993c`
   * rolls `0x434540(0x2a) < 13` and, 13 times in 42, plays `0x434540(2) + 1`:
   * one of these two, at the script's own two frames a cel.
   */
  fidgetA: [1, 3, 4, 5, 7, 6, 4, 2],
  fidgetB: [10, 10, 11, 11, 12, 11, 12, 12, 13],
  /**
   * `0x471c68`, the whole script: four records, all tag 5, `251 252 251 250` —
   * and a header whose `ticksPerFrame` is **4**, the only one of the player's
   * that is not 1. So the airborne loop runs at 3.75 cels a second while
   * everything else runs at 15, which is why it reads as a held pose rather than
   * a flutter. Every record's dx and dy is 0: the jump's motion is not in here.
   */
  /**
   * `0x471c68` — tag 5, `251 252 251 250` at FOUR frames a cel, and it is not an
   * airborne loop. `0x42a109` is in the tag-0 handler's GROUNDED branch: the frame
   * after a fall of more than 360 lands, this is installed for sixteen frames, with
   * sound 5 and ten health off through `0x402ac0`. The hard landing. In the air the
   * tuck holds all the way down. This page used to play it as a mid-air flail past
   * 360 pixels fallen, which is the same test read on the wrong side of the ground.
   */
  air: [251, 252, 251, 250],
  /**
   * `0x471b28` tag 1 — the LANDING, `251 252 251 250` at one frame a cel. Every
   * jump ends in it (`0x42a154`, with sound 4): four frames in which `0x42a182`
   * reads no key at all and the ground's drag is what slows the slide.
   */
  land: [251, 252, 251, 250],
  /**
   * kind 7 (`0x471e78`), the ladder — four tags of four cels, and one tag is one
   * RUNG. Tags 0 and 1 run 400…407 upward, tags 2 and 3 run them back down, and
   * the engine alternates between the two of each so the feet keep swapping. See
   * {@link LADDER} for what makes them move.
   */
  climb: [
    [400, 401, 402, 403],
    [404, 405, 406, 407],
    [407, 406, 405, 404],
    [403, 402, 401, 400],
  ],
  /** tags 6 and 7 — one cel, held: hanging on a rung, going nowhere */
  hang: [405],
  /** `0x472350` — one record, cel 941 */
  flail: [941],
  /**
   * `0x472048` kind 8, two ticks a cel — the monkeybar, and its tags are not
   * interchangeable the way the ladder's are. Tag 1 goes out 4400…4405 with
   * `dx 120` on every frame of it and tag 2 comes back the same six mirrored;
   * tags 3 and 4 are 4420…4422 and its reverse, carry no `dx` at all, and are
   * the chin-up W holds you in.
   */
  bar: [
    [4400],
    [4400, 4401, 4402, 4403, 4404, 4405],
    [4405, 4404, 4403, 4402, 4401, 4400],
    [4420, 4421, 4422],
    [4422, 4421, 4420],
  ],
};

/**
 * The two attacks — and the kick is a SEPARATE SCRIPT, which is the correction.
 *
 * The lower band reads JUMP / KICK / PUNCH / INV. and the keys are the initials,
 * J K P I. What each installs was read wrong here once: both attacks were taken
 * out of `0x471c90`, and K was given that script's tag 8 — `650 651 652 653(+95)
 * 654(+95) 655(+95) 654(-95) 653(-95) 652 651`, which goes out and comes back and
 * is a **headbutt**, not a kick. The walk state settles it in six instructions:
 *
 * ```
 *   429a1e  cmp word ptr [0x4ac394], 0    P -> 0x45d090(player, 0x471c90, 0)
 *   429a1e  cmp word ptr [0x4ac404], 0    K -> 0x45d090(player, 0x471d68, 0)
 * ```
 *
 * Two scripts, one each. Tag 0 of both is the same single cel 600 — the guard the
 * attack opens from — and then each button's own state machine picks what follows,
 * and BOTH of them pick a bigger version when W is held:
 *
 * ```
 *   punch  0x42a400  W held: tag 4 or 5 at random (0x434540(2) + 4)
 *                    P held: tag 2 or 3 at random (0x434540(2) + 2)
 *   kick   0x42a670  W held: tag 2      -> 740 741 742 743 744 745
 *                    K held: tag 1      -> 662 663
 *                    neither: tag 5     -> 663
 * ```
 *
 * So the attacks are randomised in the original — two variants each, chosen per
 * swing — and W is a modifier on them exactly as it is on everything else. This
 * page takes one variant of each and switches on W; the random pick is not
 * modelled, and tag 4 of `0x471d68` is not here either: that one is installed by
 * the RUN state (`0x429b80`) and carries `dx 190, dy -310`, which makes it a
 * flying kick.
 */
const ACTIONS_0: PlayerActions = {
  // 0x471c90 tag 0 then tag 3 — the guard, then the jab
  // (the moves: tags 1..4 of the punch script push `P ? 5 : 1` at `0x42a4a2`,
  // tags 5 and 6 push 5 at `0x42a547`, the headbutt's tag 8 13 at `0x42a60c`;
  // the kick script's tag 1 pushes 6, tag 2 10, tag 4 11, tag 5 7 and tag 6 12,
  // `0x42a6ed`..`0x42a891`)
  punch: { cels: [600, 601, 602], dx: [0, 0, 0], move: { id: 1, held: 5, from: 1 }, from: "0x471c90 tags 0, 3" },
  // ...or tag 2, the other half of the coin `0x434540(2)` tosses
  punch2: { cels: [600, 604], dx: [0, 0], move: { id: 1, held: 5, from: 1 }, from: "0x471c90 tags 0, 2" },
  // ...and tags 4 and 5 with W held, which are the same toss one pair up
  punchRun: { cels: [600, 603, 604], dx: [0, 0, 0], move: { id: 1, held: 5, from: 1 }, from: "0x471c90 tags 0, 4" },
  punchRun2: { cels: [600, 620, 621, 622, 623], dx: [0, 0, 0, 0, 0], move: { id: 5, from: 1 }, from: "0x471c90 tags 0, 5" },
  // 0x471d68 tag 0 then tag 1 — NOT 0x471c90's 650s, which is the headbutt
  /**
   * The step a punch ends in while forward is held: tags 1..6 end at `0x42a513`
   * and `0x42a5aa`, which install tag 7 — `470(dx 95) 472(dx 95)` — when
   * `[0x4ac3d2]` is down and the idle's tag 1 when it is not. So punching on
   * the move carries you after the blow.
   */
  punchStep: { cels: [470, 472], dx: [95, 95], from: "0x471c90 tag 7, from 0x42a51d / 0x42a5b4" },
  kick: { cels: [600, 662, 663], dx: [0, 0, 0], move: { id: 6, from: 1 }, from: "0x471d68 tags 0, 1" },
  // ...and tag 2 with W held: the six-frame kick
  kickRun: {
    cels: [600, 740, 741, 742, 743, 744, 745],
    dx: [0, 0, 0, 0, 0, 0, 0],
    move: { id: 10, from: 1 },
    from: "0x471d68 tags 0, 2",
  },
  /**
   * P and K TOGETHER — the idle handler checks the two flags jointly at
   * `0x429706` (`[0x4ac394] && [0x4ac404]`) before either alone, and installs
   * `0x471c90` tag 8: the 650s, out at 95 a frame and back at −95. So the
   * lunge this page once mistook for a walk and then for the kick is a combo
   * move, and this is its real trigger.
   */
  // `0x4717c8` tags 5 then 6 — S+P: the duck-punch, from the knee
  // (tag 6's handler pushes 3 at `0x42acc9`, tag 9's 8 at `0x42adc3`)
  duckPunch: { cels: [710, 711, 712, 713, 714, 715, 716], dx: [0, 0, 0, 0, 0, 0, 0], move: { id: 3, from: 1 }, from: "0x4717c8 tags 5, 6" },
  // tags 8 then 9 — S+K: the duck-kick, out and back
  duckKick: { cels: [720, 721, 722, 723, 724, 724, 722, 720], dx: [0, 0, 0, 0, 0, 0, 0, 0], move: { id: 8, from: 1 }, from: "0x4717c8 tags 8, 9" },
  // S+P+K — the crouch machine reaches into the kick script for tag 6
  /**
   * S + P + K — and it is a DIVE, not the three cels this page had.
   *
   * `0x42ab4a` installs `0x471d68` tag 6, and that tag is
   * `4100(dx 700, dy -80) 4101 4102 4103` — seven hundred, which is four times
   * the run. 630..632 is tag 6 of the PUNCH script `0x471c90`, a different
   * script with the same tag number, and that is what was written here.
   */
  duckCombo: { cels: [4100, 4101, 4102, 4103], dx: [700, 0, 0, 0], dy: [-80, 0, 0, 0], move: { id: 12, from: 0 }, from: "0x471d68 tag 6, from 0x42ab4a" },
  /**
   * What a blow does TO the player, and which one is which.
   *
   * `0x449115` is the whole of the choice: `cmp di, 0x3c`. Sixty or less is a
   * stagger out of `0x4766f0` and more is a knockdown out of `0x476890`, and each
   * has a front take and a back one picked by which side the hitter is on
   * (`0x44915c` for the knockdown, `0x44919e` for the stagger). Every record of
   * all four carries `dx 0 dy 0` — the throw is not in the script, it is the
   * velocity exchange `0x430470` does afterwards.
   */
  // CHARACTER 0's, out of `0x42ec86` (the stagger) and `0x42ec07` (the
  // knockdown, past 0x3c). These four were character 1's — `0x4766f0` and
  // `0x476890` — for the same reason the blow-code table was: see `src/codes.ts`
  hurtFront: { cels: [921, 921, 921], dx: [0, 0, 0], from: "0x472140 tag 1" },
  hurtBack: { cels: [922, 922, 922], dx: [0, 0, 0], from: "0x472140 tag 2" },
  downFront: { cels: [900, 901, 902, 903, 903, 903, 903, 903, 903], dx: [0, 0, 0, 0, 0, 0, 0, 0, 0], from: "0x4722a8 tag 0" },
  downBack: { cels: [940, 943, 944, 946, 947, 948, 949], dx: [0, 0, 0, 0, 0, 0, 0], from: "0x4722a8 tag 2" },
  /**
   * Dying — `0x4721a0` TAG 0, two frames a cel: `900 901 902 903`, the fall
   * backwards onto the floor.
   *
   * Both ways of dying install tag 0. Health running out is `0x402ac0` ->
   * `0x402fa0(1)` -> `0x42f280(1)`, whose case `0x42f2e5` puts gravity back to 1
   * and installs `0x4721a0` tag 0; a fatal landing out of the flail is
   * `0x429273`, tag 0 again, because the flail script `0x472350` has only a tag
   * 0 to be in. Tag 1 (`902 903 903 903`) is `0x429336`, the flail handler's
   * tag-1 arm, which nothing reaches. The kind goes to 27 and the life is spent
   * when the animation ends.
   */
  dying: { cels: [900, 901, 902, 903], dx: [0, 0, 0, 0], hold: 2, from: "0x4721a0 tag 0, from 0x42f2e5 / 0x429273" },
  /**
   * The hard landing — `0x471c68` tag 5, FOUR frames a cel, after
   * `0x402ac0(0xa)` takes ten health and sound 5 plays (`0x429374`). Character
   * 1's `0x476220` tag 5 was here, which is why the player rolled through three
   * cels of a body they were not wearing.
   */
  landRoll: { cels: [251, 252, 251, 250], dx: [0, 0, 0, 0], hold: 4, from: "0x471c68 tag 5, from 0x429374" },
  /**
   * The FLYING moves, and they are real — a legitimate question answered by
   * three installs:
   *
   * ```
   *   429db9  RUN + K       -> 0x471d68 tag 4: 684(dx 190, dy -310) 685..688
   *   42a036  airborne + K  -> 0x471b28 tag 8: 687 688 688 689
   *   42a082  airborne + P  -> 0x471b28 tag 9: 604 604 689
   * ```
   *
   * The flying kick's first record carries its own LEAP — 190 forward, 310 up,
   * about 74%% of a jump — so kicking out of a run leaves the ground. The two
   * airborne moves are poses struck mid-flight; the air punch holds the big
   * punch cel. (Running + P goes through the punch's own machine, which is the
   * punchRun pair above.)
   */
  flyingKick: { cels: [684, 685, 686, 687, 688], dx: [190, 0, 0, 0, 0], dy: [-310, 0, 0, 0, 0], move: { id: 11, from: 0 }, from: "0x471d68 tag 4, from 0x429db9" },
  // `0x42a1e3`: the jump state's tag 8 pushes 9 and its tag 9 pushes 4
  airKick: { cels: [687, 688, 688, 689], dx: [0, 0, 0, 0], move: { id: 9, from: 0 }, from: "0x471b28 tag 8, from 0x42a036" },
  airPunch: { cels: [604, 604, 689], dx: [0, 0, 0], move: { id: 4, from: 0 }, from: "0x471b28 tag 9, from 0x42a082" },
  headbutt: {
    cels: [650, 651, 652, 653, 654, 655, 654, 653, 652, 651],
    dx: [0, 0, 0, 95, 95, 95, -95, -95, 0, 0],
    move: { id: 13, from: 0 },
    from: "0x471c90 tag 8, on P+K",
  },
};

/**
 * How far the standing player's feet are below the engine's own y for them.
 *
 * Cel 1 is 98x145 with its anchor 55 rows down, so its art reaches 90 rows under
 * the anchor — the cel word at +0x26 the body stepper stands on a floor
 * (`0x42fdcf`), not the 88 its collision box stops at. `walk.ts` reads that
 * extent off whichever cel is on screen; these two are its stand-ins for the
 * moments no cel has been drawn yet.
 */
const STAND_FEET_0 = 90;
/** and the tuck's, cel 200's own — the knees are up, so the feet are 20 higher */
const TUCK_FEET_0 = 70;
// ---------------------------------------------------------------------------
// character 1 — `0x442ad0`, 5552 bytes of state machine with the same shape
// ---------------------------------------------------------------------------

/**
 * Character 1's impulses, and five of the eleven differ from character 0's.
 *
 * ```
 *   0x475f38  kind  1  cels 5100..5111  dx 105          the walk
 *   0x475fa0  kind  2  cels 5159..5158  dx 200          the run
 *   0x476140  kind  3  tag 2  5202(dx   0, dy -500)     the standing launch
 *                      tag 3  5202(dx 100, dy -500)     the walking launch
 *                      tag 4  5202(dx 180, dy -480)     the running one
 *                      tag 7  5203(dx 120, dy -240)     the hop
 *   0x476300  kind  5  tag 4  5681(dx 190, dy -370)     the flying kick
 * ```
 *
 * `rise` is the one that is shared outright: `0x444911` builds the same `0xff83`
 * — minus 125 — that `0x429f42` does.
 *
 * `crawl` is the exception that had to be spread. Character 0's `0x4717c8` tag 4
 * carries `dx 47` on each of its five cels; character 1's `0x475dd8` tag 4
 * carries nothing on the first four and **315 on the fifth**. This page applies a
 * gait's impulse every frame, so 315 over the five frames it is authored across
 * is 63 — the file's own number divided by the file's own frame count, and said
 * here rather than left to look like a measurement.
 */
const MEASURED_1: PlayerMeasured = { walk: 105, run: 200, jump: 500, runJumpDy: 480, rise: 125, launchDx: 100, runJumpDx: 180, crawl: 63, flyKickDx: 190, flyKickDy: 370, hopDx: 120, hopDy: 240, barSwing: 100 };

/**
 * Character 1's cels — `0x475c88` and its neighbours, tag for tag against
 * {@link ANIM_0}, and three of them are not a plus-five-thousand of anything.
 */
const ANIM_1: PlayerAnim = {
  /** `0x475c88` tag 0 — the same fourteen frames out and back, two ticks each */
  idle: [5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008, 5007, 5006, 5005, 5004, 5003, 5002],
  /** tag 1 — character 0's tag 1 exactly, plus five thousand */
  fidgetA: [5001, 5003, 5004, 5005, 5007, 5006, 5004, 5002],
  /**
   * tag 2 — and this is a DIFFERENT fidget, not `10..13` shifted. Eleven frames
   * of 5050..5057, where character 0 has nine of 10..13. There is no tag 3 in
   * this script at all, so character 1 has two idle fidgets where character 0
   * has three.
   */
  fidgetB: [5050, 5051, 5052, 5053, 5054, 5055, 5056, 5057, 5056, 5057, 5056],
  /** `0x475f38` tag 0 — twelve cels, one tick each, dx 105 */
  walk: [5100, 5101, 5102, 5103, 5104, 5105, 5106, 5107, 5108, 5109, 5110, 5111],
  /**
   * `0x475fa0` tag 0 — twelve cels at dx 200, and the cycle does not start where
   * the numbering does: the script runs `5159 5160 5161` before `5150`.
   */
  run: [5159, 5160, 5161, 5150, 5151, 5152, 5153, 5154, 5155, 5156, 5157, 5158],
  /** `0x476140` tag 2 — THREE frames of wind-up, not four, and the impulse is on
   *  the last of them: `5202(dx 0, dy -500)` */
  launch: [5200, 5201, 5202],
  /** tag 0 — the pose held in flight */
  tuck: [5203, 5204, 5205],
  /** `0x475dd8` tag 1 — one cel, and tags 2 and 3 are the SAME cel: character 1
   *  has no duck fidget to roll for */
  crouch: [5702],
  crouchFidget: [5702],
  /** tag 4 — five cels, and the 315 is on the last of them alone */
  crawl: [6000, 6001, 6002, 6003, 6004],
  /** `0x476220` tag 5, four ticks a cel — the hard landing */
  air: [5208, 5207, 5206],
  /** `0x476140` tag 1 — three frames, where character 0 lands in four */
  land: [5208, 5207, 5206],
  /** `0x476428` tags 0..3 — one tag is one rung, and the feet swap between them */
  climb: [
    [5400, 5401, 5402, 5403],
    [5404, 5405, 5406, 5407],
    [5407, 5406, 5405, 5404],
    [5403, 5402, 5401, 5400],
  ],
  /** tags 6 and 7 — hanging on a rung */
  hang: [5405],
  /** `0x476938` — one record, cel 5207 */
  flail: [5207],
  /**
   * `0x4765f8` — the same five tags at `dx 100`, and the swing SKIPS two cels
   * the chin-up owns: 9401 and 9402 appear in tags 3 and 4 only, so tag 1 runs
   * `9400 9403 9404 9405 9406 9407`.
   */
  bar: [
    [9400],
    [9400, 9403, 9404, 9405, 9406, 9407],
    [9407, 9406, 9405, 9404, 9403, 9400],
    [9400, 9401, 9402],
    [9402, 9401, 9400],
  ],
};

/**
 * Character 1's moves.
 *
 * The state machines are the same shape as character 0's — `0x444080` against
 * `0x429690`, `0x444da0` against `0x42a400`, `0x444ff0` against `0x42a670`,
 * `0x445320` against `0x42a9a0`, install for install and key for key. What
 * differs is which tags they reach for and what is in them.
 *
 * The punch is the clearest case. Character 0's `0x42a429` tosses `0x434540(2)`
 * and adds 4 for the W punch, tosses again and adds 2 for the held-P punch, and
 * tosses a third time for the plain one — three coins. Character 1's `0x444dd7`
 * pushes **4** outright and `0x444df2` pushes **3** outright; only the plain
 * punch (`0x444e12`) rolls. So there is one big punch rather than two.
 */
const ACTIONS_1: PlayerActions = {
  // `0x476240` tag 0 is the guard the standing handler opens on (`0x44416d`),
  // and `0x444e12`'s roll picks tag 0 or tag 1 after it
  // (the moves: punch tags 1 and 2 push 2 at `0x444e31`, tags 3 and 4 push 1
  // at `0x444ec8`, tag 6 13 at `0x444f97`; the kick script's tags push what
  // character 0's do, `0x44506d`..`0x445204`; the duck's 3 and 8)
  punch: { cels: [5600, 5602], dx: [0, 0], move: { id: 2, from: 1 }, from: "0x476240 tags 0, 1" },
  punch2: { cels: [5600, 5600], dx: [0, 0], from: "0x476240 tag 0, and 0 again" },
  // W held: `0x444dd7` -> tag 4, and there is no second variant to toss for
  punchRun: { cels: [5600, 5801, 5802, 5806, 5807, 5808, 5809], dx: [0, 0, 0, 0, 0, 0, 0], move: { id: 1, from: 1 }, from: "0x476240 tags 0, 4" },
  punchRun2: { cels: [5600, 5801, 5802, 5806, 5807, 5808, 5809], dx: [0, 0, 0, 0, 0, 0, 0], move: { id: 1, from: 1 }, from: "0x476240 tags 0, 4 — the same one" },
  // `0x476300` tag 0 opens (`0x4441b2`), then `0x444ff0` picks: tag 5 plain,
  // tag 1 with K held, tag 2 with W held — the same three the other one has
  // forward still down as a punch tag ends: tag 5, `5470 5471` at dx 105
  // (`0x444e9e`, `0x444f3f`), character 0's tag 7 in its own cels
  punchStep: { cels: [5470, 5471], dx: [105, 105], from: "0x476240 tag 5, from 0x444e9e / 0x444f3f" },
  kick: { cels: [5600, 5663, 5664], dx: [0, 0, 0], move: { id: 7, from: 1 }, from: "0x476300 tags 0, 5" },
  kickRun: {
    cels: [5600, 5740, 5741, 5742, 5743, 5744, 5745, 5746],
    dx: [0, 0, 0, 0, 0, 0, 0, 0],
    move: { id: 10, from: 1 },
    from: "0x476300 tags 0, 2",
  },
  // `0x475dd8` tags 5 then 6 — S+P
  duckPunch: { cels: [5710, 5711, 5712, 5713, 5714, 5715, 5716], dx: [0, 0, 0, 0, 0, 0, 0], move: { id: 3, from: 1 }, from: "0x475dd8 tags 5, 6" },
  // tags 8 then 9 — S+K
  duckKick: { cels: [5720, 5721, 5722, 5723, 5724, 5724, 5722, 5720], dx: [0, 0, 0, 0, 0, 0, 0, 0], move: { id: 8, from: 1 }, from: "0x475dd8 tags 8, 9" },
  // S+P+K — `0x4454c9` installs `0x476300` tag 6, whose first record carries
  // dx 700 and dy -80, the same dive character 0 has out of its own kick script
  duckCombo: { cels: [5940, 5483, 5484, 5485], dx: [700, 0, 0, 0], dy: [-80, 0, 0, 0], move: { id: 12, from: 0 }, from: "0x476300 tag 6, from 0x4454c9" },
  /** `0x4766f0` tags 1 and 2 — the stagger, `0x449115`'s sixty or less */
  hurtFront: { cels: [5901, 5901, 5901], dx: [0, 0, 0], from: "0x4766f0 tag 1" },
  hurtBack: { cels: [5902, 5902, 5902], dx: [0, 0, 0], from: "0x4766f0 tag 2" },
  /** `0x476890` tags 0 and 2 — the knockdown, past sixty */
  downFront: {
    cels: [5910, 5911, 5912, 5913, 5914, 5915, 5915, 5915, 5915],
    dx: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    from: "0x476890 tag 0",
  },
  downBack: { cels: [5940, 5941, 5942, 5943, 5944, 5944, 5944], dx: [0, 0, 0, 0, 0, 0, 0], from: "0x476890 tag 2" },
  /**
   * `0x476758` tag 0, two frames a cel — `0x449765` (`0x402fa0(1)` on empty
   * health) and `0x443ca3` (the flail's fatal landing) both install tag 0, as
   * character 0's do; tag 1 is the flail's unreachable tag-1 arm
   */
  dying: { cels: [5910, 5911, 5912, 5913, 5914, 5915], dx: [0, 0, 0, 0, 0, 0], hold: 2, from: "0x476758 tag 0, from 0x449765 / 0x443ca3" },
  /** `0x476220` tag 5, four ticks a cel — `0x443d88`, after ten health and sound 5 */
  landRoll: { cels: [5208, 5207, 5206], dx: [0, 0, 0], hold: 4, from: "0x476220 tag 5, from 0x443d88" },
  /** `0x476300` tag 4 — `5681(dx 190, dy -370)`, a higher leap than character 0's */
  flyingKick: { cels: [5681, 5682, 5683, 5684, 5685], dx: [190, 0, 0, 0, 0], dy: [-370, 0, 0, 0, 0], move: { id: 11, from: 0 }, from: "0x476300 tag 4" },
  /** `0x476140` tags 8 and 9 — the two poses struck in mid-air (9 and 4, `0x444b9f`) */
  airKick: { cels: [5663, 5664, 5664, 5205], dx: [0, 0, 0, 0], move: { id: 9, from: 0 }, from: "0x476140 tag 8" },
  airPunch: { cels: [5605, 5605, 5605, 5205], dx: [0, 0, 0, 0], move: { id: 4, from: 0 }, from: "0x476140 tag 9" },
  /**
   * P and K together — and character 1 does not headbutt.
   *
   * `0x444126` installs `0x476240` tag 6, whose first record is
   * `9800(dx 150, dy -250)`: it leaves the ground. Character 0's `0x429736`
   * installs `0x471c90` tag 8, the 650s, which go out at 95 and come back at
   * -95 without leaving it. Same key, same place in the same handler, two
   * different moves.
   */
  headbutt: {
    cels: [9800, 9802, 9803, 9804, 9805, 9806, 9806],
    dx: [150, 0, 0, 0, 0, 0, 0],
    dy: [-250, 0, 0, 0, 0, 0, 0],
    move: { id: 13, from: 0 },
    from: "0x476240 tag 6, on P+K",
  },
};

/** `0x476428`'s resting rung cel, character 1's own */
const REST_CEL_1 = 5405;
/**
 * Cel 5001 is 73x138 with its anchor 67 rows down, so its art reaches 71 below
 * the anchor against character 0's 90 — nineteen pixels shorter, and the same
 * `p.y` is a different height.
 */
const STAND_FEET_1 = 71;
/**
 * cel 5203's own extent, the tuck: 71. Its collision box stops at 38, and
 * standing the tuck on that box landed character 1 33 pixels above the floor
 * it should have reached.
 */
const TUCK_FEET_1 = 71;

/**
 * The two of them, indexed by what `0x46b1a8` holds.
 *
 * `0x402d22` — input action 11 — toggles that word, so this array is indexed
 * live and not once at boot.
 */
export const PLAYERS: readonly [PlayerKit, PlayerKit] = [
  {
    index: 0,
    name: "Skull Cracker",
    anim: ANIM_0,
    actions: ACTIONS_0,
    measured: MEASURED_0,
    standCel: 1,
    standFeet: STAND_FEET_0,
    tuckFeet: TUCK_FEET_0,
    restCel: 405,
    flailSound: 0x17,
    from: "0x428080, and the 0x470a78..0x472350 scripts",
  },
  {
    index: 1,
    name: "the other Skull Cracker",
    anim: ANIM_1,
    actions: ACTIONS_1,
    measured: MEASURED_1,
    standCel: 5001,
    standFeet: STAND_FEET_1,
    tuckFeet: TUCK_FEET_1,
    restCel: REST_CEL_1,
    flailSound: 0x10,
    from: "0x442ad0, and the 0x475130..0x476938 scripts",
  },
];
