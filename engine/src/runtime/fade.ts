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
   * next frame arrives — see {@link advanceTo}.
   */
  lastTick: number | null = null;
  readonly queue: { to: number; steps: number }[] = [];
  snapshot: { rgba: Uint8ClampedArray; width: number; height: number } | null = null;
  /**
   * A movie ended and nothing has said what the screen should look like
   * afterwards — see {@link idle}, which lifts a leftover
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
   * (`blackNow`, builtins/scene.ts), cleared by either ramp and by the reveal
   * ({@link idle}).
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
  get ramping(): number {
    return this.rampers;
  }
  private rampers = 0;
  /** what waits for the ramp to be over — see {@link whenRampEnds} */
  private readonly afterRamp: (() => void)[] = [];

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
   * (0x435b90) — see {@link advanceTo} — so a fresh ramp starts its
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

  /** is a ramp queued or running? */
  get fading(): boolean {
    return this.queue.length > 0;
  }

  /** a script enters a blocking ramp (SessionTransitions.ramp) */
  enterRamp(): void {
    this.rampers++;
  }

  /**
   * ...and leaves it. The last one out runs `whenLast` (the clock lets go of
   * what it held) and then everything waiting on {@link whenRampEnds}.
   */
  leaveRamp(whenLast: () => void): void {
    if (--this.rampers !== 0) return;
    whenLast();
    for (const w of this.afterRamp.splice(0)) w();
  }

  /**
   * Resolves once no script is blocked in a ramp — at once when none is. A
   * script waiting on a frame waits on this too: in TI.EXE nothing but the
   * ramp runs until it is done.
   */
  whenRampEnds(): Promise<void> {
    if (!this.ramping) return Promise.resolve();
    return new Promise((resolve) => this.afterRamp.push(resolve));
  }

  /**
   * No ramp queued: the ramp clock starts afresh with the next one, and a
   * reveal owed is made once nothing holds the frame and no script is `busy`.
   * The host's frame asks (SessionTransitions.tickFade).
   */
  idle(busy: boolean): void {
    this.lastTick = null;
    if (this.pendingReveal && !this.snapshot && !busy) this.reset(0);
  }

  /**
   * Take every step due up to `tick`, one tick at a time from the tick before
   * the ramp was asked on (see {@link lastTick}). A ramp running owes no reveal.
   */
  advanceTo(tick: number): void {
    this.pendingReveal = false;
    this.lastTick ??= tick - 1;
    while (this.queue.length && this.lastTick < tick) {
      this.lastTick++;
      this.step();
    }
  }

  /** one tick of the ramp at the front of the queue, which leaves it once it is there */
  private step(): void {
    const ramp = this.queue[0];
    if (ramp.to === 0) this.snapshot = null; // fading back in reveals the live frame
    const delta = 1 / ramp.steps;
    this.level = ramp.to > this.level ? Math.min(ramp.to, this.level + delta) : Math.max(ramp.to, this.level - delta);
    // …and the level is thirds all over again: ten steps of 1/10 off 1 leave
    // 1.4e-16, which is not `to` and cost an eleventh step to walk off
    if (Math.abs(this.level - ramp.to) < delta / 2) {
      this.level = ramp.to;
      this.queue.shift();
    }
  }

  /** the screen is black from this instant — no ramp, nothing left running, BLANKED */
  blankNow(): void {
    this.cut(1);
    this.blanked = true;
  }

  /**
   * Whatever is showing is left to the reveal — {@link idle} lifts the black
   * once the script falls quiet. `dropFrame` also forgets a
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

  /**
   * Stop holding the black: the room is already painted underneath, so there
   * is nothing to ramp from. Whatever ramp or reveal is queued stays queued.
   */
  lift(): void {
    this.level = 0;
  }

  /** hold the screen black until something draws — a ramp or reveal queued stays queued */
  holdBlack(): void {
    this.level = 1;
  }

  /**
   * Black from this instant with no ramp, no frame held and no reveal owed,
   * and hand back what puts the screen as it was (builtins/savegame.ts
   * blackTheScreen). Whether the black was blanked on is left as it was.
   */
  blackUntilRestored(): () => void {
    const was = { level: this.level, queue: [...this.queue], snapshot: this.snapshot, pending: this.pendingReveal };
    this.cut(1);
    return () => {
      this.level = was.level;
      this.queue.push(...was.queue);
      this.snapshot = was.snapshot;
      this.pendingReveal = was.pending;
    };
  }
}
