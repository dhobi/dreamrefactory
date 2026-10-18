/**
 * Screen fade (screentoblack/blacktoscreen around gotospecial): 0 = clear,
 * 1 = black. Lives on the session — the viewer is rebuilt mid-transition.
 * While fading OUT the pre-transition frame stays visible via `snapshot`.
 */
export class Fade {
  level = 0;
  /**
   * The last tick a step was taken on, or null before the ramp has a start.
   * {@link rampTo} sets it to the tick BEFORE the one it was asked on
   * (the fade builtin, builtins/scene.ts), so step 1 is that tick's however late the host's
   * next frame arrives — see SessionTransitions.tickFade.
   */
  lastTick: number | null = null;
  readonly queue: { to: number; steps: number }[] = [];
  snapshot: { rgba: Uint8ClampedArray; width: number; height: number } | null = null;
  /**
   * A movie ended and nothing has said what the screen should look like
   * afterwards — see SessionTransitions.tickFade, which lifts a leftover
   * one-shot black once the script that played the movie has run out of things
   * to say.
   */
  pendingReveal = false;
  /**
   * The black was BLANKED on, not ramped to — `blackscreen()` or
   * `clut("black")` rather than `screentoblack`.
   *
   * The two are different things in TI.EXE and only look alike here. A ramp
   * walks a NAMED palette to black, so it belongs to that palette and dies
   * with it — which is why opening a stage file lifts one (StageController.
   * openStageFile). `blackscreen` is the framebuffer: `0x43e650` clears it and
   * nothing about swapping a stage draws over it again. Set by {@link blankNow}
   * (`blackNow`, builtins/scene.ts), cleared by either ramp and by the reveal in
   * SessionTransitions.tickFade.
   */
  blanked = false;
  /**
   * Scripts blocked inside a fade ramp right now (builtins/scene.ts `fade`).
   * TI.EXE's ramp (0x435b90 / 0x435be0) blends the palette and spins on the
   * tick clock with no pass inside it, so nothing else runs until it is over:
   * no pass, no prop step, no walk, no other script. The deck map's `open`
   * view stands on one frame through the 240-step fade back into the engine
   * room, and only `close()` after it animates (#541).
   */
  ramping = 0;
  /** what waits for the ramp to be over — see SessionTransitions.untilRampEnds */
  readonly afterRamp: (() => void)[] = [];

  /**
   * The screen is at `level` from this instant: no ramp left to run, no frame
   * held, no reveal owed. Whether the black was blanked on is left as it was.
   */
  cut(level: number): void {
    this.settle(level);
    this.pendingReveal = false;
  }

  /**
   * {@link cut} with a reveal already owed left owed: no ramp left to run, no
   * frame held, the screen at `level`. Opening a stage file settles the screen
   * this way (StageController) — a movie's leftover reveal outlives it.
   */
  settle(level: number): void {
    this.queue.length = 0;
    this.snapshot = null;
    this.level = level;
  }

  /**
   * Queue a ramp to `to` (0 clear, 1 black) over `steps` ticks, asked on tick
   * `tick`. A ramp to black freezes the frame showing now (`capture`) unless
   * one is held already. Step 1 is drawn on the tick it is asked on
   * (0x435b90) — see SessionTransitions.tickFade — so a fresh ramp starts its
   * clock on the tick before. A ramp owes no reveal and is a ramp of a named
   * palette, not a blanked black.
   */
  rampTo(to: 0 | 1, steps: number, tick: number, capture: () => Fade["snapshot"]): void {
    if (to === 1 && !this.snapshot) this.snapshot = capture();
    if (!this.queue.length) this.lastTick = tick - 1;
    this.queue.push({ to, steps });
    this.pendingReveal = false;
    this.blanked = false;
  }

  /** the screen is black from this instant — no ramp, nothing left running, BLANKED */
  blankNow(): void {
    this.cut(1);
    this.blanked = true;
  }

  /**
   * Whatever is showing is left to the reveal — SessionTransitions.tickFade
   * lifts the black once the script falls quiet. `dropFrame` also forgets a
   * frame a `screentoblack` froze, which would otherwise hold the black.
   */
  oweReveal(dropFrame = false): void {
    if (dropFrame) this.snapshot = null;
    this.pendingReveal = true;
  }

  /** {@link cut}, and forget a blanked black too: a fresh start at `level` */
  reset(level: number): void {
    this.cut(level);
    this.blanked = false;
  }
}
