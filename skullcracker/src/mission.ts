/**
 * What each of the sixteen levels asks of you, read out of `SC.EXE`.
 *
 * A level is not over when you reach its goal. `0x415f50` and its three
 * counterparts — one per chapter, run once an engine frame — are the whole win
 * condition, and it is in two parts:
 *
 * ```
 * 0x415f7f  call 0x42f540              ; how many things are still alive
 * 0x415f84  cmp  ax, [0x46e99c]        ; against this chapter's allowance
 * 0x415f8b  jg   <not yet>             ; still too many: nothing happens
 * 0x415f91  cmp  [0x46b1b0], 0         ; already spawned the goal?
 * 0x415f9b  ...  call 0x410170         ; no: put it at the level's own goal
 * 0x415fc2  call 0x410370              ; yes: has it been touched?
 * 0x415fd0  mov  [0x4abdfc], 7         ; then the stage is over
 * ```
 *
 * So the quota comes first and the goal second, and the goal is not even THERE
 * until the quota is met — `0x410170` spawns it at the level's own `goal` record,
 * 180px above it, and `0x410480`, its frame function, raises `[0x46ba10]` when
 * the player touches it. The kill quota the panel shows is the same subtraction
 * the test makes (`0x415f55`), which is why the two always agree.
 *
 * ## The allowance is a fraction of the level's own population
 *
 * Each chapter's init function counts what it just spawned and takes a share off:
 *
 * ```
 * 415eae  movsx eax, si                ; si = things alive at level start
 * 415eb9  fmul  qword ptr [0x46a068]   ; x 0.35
 * 415ebf  call  0x45f270               ; round
 * 415ec4  sub   si, ax
 * 415ec7  mov   [0x46e99c], si         ; the allowance
 * ```
 *
 * The share is a per-stage `double` in `.data`, and every one of the sixteen is
 * below. Three stages take a different form: the fourth case of chapters 1, 2
 * and 4 stores **0** — kill everything — and the third and fourth of chapter 3
 * store the census itself, which is an allowance nothing has to be killed to
 * meet. Those two are `ravecave` and `tower`, and `tower` is where `BELFRY.MOV`
 * and `belfry.snd` are, so a chapter that ends without a quota is likely a
 * chapter that ends with something else.
 *
 * ## The films
 *
 * Each stage's case in its chapter's sequencer names its own `chp{NN}.mov` — and
 * a `boggs{NN}.mov` beside it, and for the first stage of each chapter one more
 * (`Bomb.Mov`, `Mall.Mov`, `Belfry.Mov`, `Cycle.Mov`). They are queued one after
 * another through `0x40e330` (clear) and `0x40e990` (play and wait), so the
 * order of the pushes is the order they are seen in: Boggs says his piece on the
 * flying screen and the skull that names the next level follows him —
 * `0x44d7b9`/`0x44d7de` for the first stage, `0x436a8b`/`0x436ab0` for a
 * mid-chapter one. The opener goes between those two in three chapters out of
 * four and ahead of both in the first; {@link Mission.opener} has all twelve
 * pushes, and {@link Mission.films} is the order itself.
 *
 * When the clock runs out instead, `0x40e9d0` picks one of `TIME1.MOV`…`TIME4.MOV`
 * with `0x434540(4)` — the same random helper the punch tosses for a variant with
 * — and those four films are 512x232 at origin (0, 42), which is to say they play
 * inside the interface's window with the panel still around them.
 */
import { LEVEL_ORDER } from "@dreamfactory/engine/df/sbk";

export interface Mission {
  /** the book, and so the level: `LEVEL_ORDER`'s own name */
  book: string;
  /** 1..16 — the number in its films' names as much as its place in the order */
  number: number;
  /**
   * The chapter card — the skull that names where you are going.
   *
   * It is the SECOND of the two: `0x44d7de` pushes `Chp01.Mov` after `0x44d7b9`
   * has pushed `Boggs01.Mov`, and `0x436ab0`/`0x436a8b` are the same way round
   * for a mid-chapter stage. See {@link Mission.boggs}.
   */
  film: string;
  /**
   * Boggs' half of the briefing, and it plays FIRST.
   *
   * Each stage's case queues its films one after another through `0x40e330`
   * (clear) and `0x40e990` (play and wait), so the order of the pushes is the
   * order they are seen in: Boggs on the flying screen, then the card.
   *
   * The first stage of each chapter queues one more — see {@link Mission.opener}.
   */
  boggs: string;
  /**
   * The chapter's own opener, on the first stage of each chapter and nowhere
   * else: `Bomb.Mov`, `Mall.Mov`, `Belfry.Mov`, `Cycle.Mov`.
   *
   * WHERE it sits was read wrong here for as long as it went unplayed. This
   * file said the opener is queued "BEFORE both", on the strength of chapter
   * one — and chapter one is the exception. The four cases, each decoded at its
   * own push:
   *
   * ```
   *   44d794 Bomb.Mov    44d7b9 Boggs01.Mov  44d7de Chp01.Mov
   *   4369f4 Boggs05.Mov 436a19 Mall.Mov     436a3e Chp05.Mov
   *   41f354 Boggs09.Mov 41f379 Belfry.Mov   41f39e Chp09.Mov
   *   4126e4 Boggs13.Mov 412709 Cycle.Mov    41272e Chp13.Mov
   * ```
   *
   * Every one of the twelve is the same four instructions — `0x40e330(0)` to
   * clear the queue, `0x404440` to resolve the name, `0x40e990` to play it and
   * wait — so the order of the cases IS the order they are seen in, and only
   * chapter one leads with its opener. {@link Mission.films} is that order,
   * which is what a caller should walk rather than assembling one of its own.
   */
  opener?: string;
  /** the briefing's films, in the order the stage's own case queues them */
  films: readonly string[];
  /**
   * The share of the level's population the quota wants dead.
   *
   * `1` is the stage whose allowance is stored as zero — everything — and `0` is
   * the two whose allowance is the census, which no killing is needed to meet.
   */
  kill: number;
  /** the `.data` address the share was read from, or what stands in its place */
  from: string;
}

/** the four chapters' shares, in stage order, with where each was read */
const SHARES: readonly (readonly [number, string])[] = [
  // chapter 1 — 0x450040, allowance in [0x4789d4]
  [0.75, "0x46a188"], [0.7, "0x46a190"], [0.55, "0x46a198"], [1, "0x450156 stores 0"],
  // chapter 2 — 0x43b810, allowance in [0x474f0c]
  [0.75, "0x46a148"], [0.75, "0x46a148"], [0.75, "0x46a148"], [1, "0x43b926 stores 0"],
  // chapter 3 — 0x4217e0, allowance in [0x47065c]
  [0.9, "0x46a0a0"], [0.85, "0x46a0a8"], [0, "0x4218ca stores the census"], [0, "0x4218d9 stores the census"],
  // chapter 4 — 0x415e30, allowance in [0x46e99c]
  [0.35, "0x46a068"], [0.55, "0x46a070"], [0.55, "0x46a070"], [1, "0x415f26 stores 0"],
];

/** the sixteen missions, in the order they are played */
/**
 * The opener each chapter's first stage carries, by the level it opens on.
 *
 * Level 1 is chapter one and leads with it; 5, 9 and 13 open their chapters
 * with Boggs and play theirs second. See {@link Mission.opener}.
 */
const OPENERS: Readonly<Record<number, string>> = {
  1: "bomb.mov",
  5: "mall.mov",
  9: "belfry.mov",
  13: "cycle.mov",
};

export const MISSIONS: readonly Mission[] = LEVEL_ORDER.map((book, i) => {
  const nn = String(i + 1).padStart(2, "0");
  const number = i + 1;
  const film = `chp${nn}.mov`;
  const boggs = `boggs${nn}.mov`;
  const opener = OPENERS[number];
  return {
    book,
    number,
    film,
    boggs,
    opener,
    // chapter one leads with its opener and the other three do not — the four
    // cases are quoted in `Mission.opener`
    films: opener === undefined ? [boggs, film] : number === 1 ? [opener, boggs, film] : [boggs, opener, film],
    kill: SHARES[i][0],
    from: SHARES[i][1],
  };
});

/** the four films the engine picks between when the clock runs out */
export const TIME_OUT_FILMS = ["time1.mov", "time2.mov", "time3.mov", "time4.mov"] as const;

/**
 * The ENDING, and it is one line of the game's own shell.
 *
 * `0x402fe0` is the outer loop: eleven states through the table at `0x403448`,
 * of which 1 is the menu, 3..6 are the four chapters, 9 is the death vignette,
 * 10 goes back to the menu and 11 quits. Chapter four is state 6 and its runner
 * is `0x412670`, which walks its own scenes in `[0x4abdfc]` — and the last of
 * them, once the outer state is still 6, is this:
 *
 * ```
 *   41293d  cmp word ptr [0x4abdfe], 6   ; nothing else has taken the game away
 *   41294c  push 0x46b388                ; "credits.mov"
 *   41295a  call 0x40e990                ; ...play it
 *   412962  mov si, 1                    ; and that is the chapter loop over
 * ```
 *
 * `si` ending the loop returns to `0x4032a2`, which finds `[0x4abdfe]` is not
 * one of the five states that would claim the game, so it sets the scene to 0
 * and goes to state 1: **the title menu**. So finishing the sixteenth level
 * plays the credits and puts you back at the front.
 *
 * It is worth saying that `credits.mov` is also a menu item — `0x4030f7` plays
 * the same file for option 6 — so the file being in the rip was never evidence
 * of an ending on its own. What makes it one is `0x41293d`.
 */
export const ENDING_FILM = "credits.mov";

/**
 * The seven films for the other way a level ends.
 *
 * `0x403340` is the same shape as the time-out handler, one state along in the
 * game's own shell (`0x402fe0` — the switch that also plays `cyber.Mov`,
 * `imain.Mov`, `Menu.Mov`, `prefs2`, `helpwin`, `credits` and `char.mov`):
 * `0x434540(7)` picks one of `KILL1.MOV`…`KILL7.MOV`. Like the four TIME films
 * they are 512x232 at origin (0, 42), so they play inside the interface's window
 * with the panel around them — which is what says they belong to a level in
 * progress rather than to the shell's own screens.
 *
 * What triggers it has been read now, and so has what follows it. `0x4294e7`
 * sets the state only after `0x40d490` finds the lives below zero, so these are
 * the GAME OVER films and not the per-death ones; and the state does not end on
 * the film:
 *
 * ```
 *   4033ca  0x40e990(KILLn.MOV)
 *   4033d9  ax = [0x46b20c]          ; the difficulty
 *   4033e3  0x40d4d0(ax)             ; the score, [0x4a4f00]
 *   4033e9  0x40f650(score, ax)      ; offer it to that difficulty's ten rows
 *   4033ee  cx = 1                   ; and the shell goes back to the title
 * ```
 *
 * So a finished game writes to the high-score board and the title screen is
 * where it is read — see {@link file://./scores.ts}.
 *
 * And the trigger is the death after the LAST life. `0x4293f3` spends one as
 * the dying animation ends, and once the body has lain its 25 or 40 frames
 * `0x4294cb` asks `0x40d490()`: below zero is state 9, anything else is
 * `0x402760`'s respawn. An ordinary death gets no film at all.
 */
export const DEATH_FILMS = [
  "kill1.mov",
  "kill2.mov",
  "kill3.mov",
  "kill4.mov",
  "kill5.mov",
  "kill6.mov",
  "kill7.mov",
] as const;

/**
 * How far below a room's own rect the world ends.
 *
 * There has to be a line, because one level has no floor: CITY's ground is a
 * ledge from x271 to x691 and then **y7250 for the rest of the level**, 2919
 * below the bottom of its own room rect and 2900 below anything it draws (see
 * `rasteriseGround` in `engine/src/df/sbk.ts` — "CITY has no floor. It has 73
 * platforms and 20 planks, and the ground is the fall"). Walking east off that
 * ledge, this page used to land the player on y7250 and let them walk in the
 * void for ever.
 *
 * The line is drawn where the data leaves room for it. Measured over all 48
 * shipped regions, the deepest a room's floor goes below its own rect is
 * RAVECAVE's 1025, then CAVERN's 983 and TOWER's 872 — the shafts, which are
 * real places you land in. CITY's 2919 is nearly three times the deepest of
 * them, so 1200 separates the shafts from the void with the whole gap to spare.
 */
export const PIT_DEPTH = 1200;

/**
 * How many of a level's population may still be standing when it ends.
 *
 * `census - round(census * share)`, which is the engine's own arithmetic — the
 * multiply, the round through `0x45f270`, and the subtract. A share of 0 leaves
 * the whole census, which is the two stages that ask for no kills at all.
 */
export function allowanceFor(mission: Mission, census: number): number {
  return census - Math.round(census * mission.kill);
}
