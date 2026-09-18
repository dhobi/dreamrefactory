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
 * (`Bomb.Mov`, `Mall.Mov`, `Belfry.Mov`, `Cycle.Mov`). The pair is queued through
 * `0x40e330` / `0x40e990`; the chapter film is the mission briefing and the
 * `boggs` one is Boggs, who is the reason for all this.
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
  /** the mission briefing, played before the level */
  film: string;
  /** Boggs' half of the briefing, played after it */
  boggs: string;
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
export const MISSIONS: readonly Mission[] = LEVEL_ORDER.map((book, i) => {
  const nn = String(i + 1).padStart(2, "0");
  return {
    book,
    number: i + 1,
    film: `chp${nn}.mov`,
    boggs: `boggs${nn}.mov`,
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
 * And the trigger is the LAST life. `0x4294a6` reads the count, `0x4294ad`
 * spends one, and `0x4294b7` takes the ordinary path while the count BEFORE the
 * spend was not negative — so state 9 is reached only once there is nothing
 * left. An ordinary death gets no film at all.
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
