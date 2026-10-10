import { RAMP_STEP_MS, ticksAt } from "./clock";
import type { GameSession } from "./session";

/**
 * The screen's fade to and from black and its wipes, turns and dissolves,
 * stepped on the game clock. Held by the session rather than the viewer because
 * a transition outlives the viewer that started it. Owned by GameSession, which
 * forwards all of it here.
 */
export class SessionTransitions {
  constructor(private readonly session: GameSession) {}

  /**
   * Screen fade (screentoblack/blacktoscreen around gotospecial): 0 = clear,
   * 1 = black. Lives on the session — the viewer is rebuilt mid-transition.
   * While fading OUT the pre-transition frame stays visible via `snapshot`.
   */
  fade = {
    level: 0,
    lastTick: 0,
    queue: [] as { to: number; steps: number }[],
    snapshot: null as { rgba: Uint8ClampedArray; width: number; height: number } | null,
    /**
     * A movie ended and nothing has said what the screen should look like
     * afterwards — see {@link tickFade}, which lifts a leftover one-shot black
     * once the script that played the movie has run out of things to say.
     */
    pendingReveal: false,
    /**
     * The black was BLANKED on, not ramped to — `blackscreen()` or
     * `clut("black")` rather than `screentoblack`.
     *
     * The two are different things in TI.EXE and only look alike here. A ramp
     * walks a NAMED palette to black, so it belongs to that palette and dies
     * with it — which is why opening a stage file lifts one (StageController.
     * openStageFile). `blackscreen` is the framebuffer: `0x43e650` clears it and
     * nothing about swapping a stage draws over it again. Set by `blackNow`
     * (builtins/scene.ts), cleared by either ramp and by the reveal in
     * {@link tickFade}.
     */
    blanked: false,
  };
  /**
   * A reveal in progress: the screen the game is LEAVING, uncovered a step at a
   * time by the screen it is arriving at (`visualeffect(wipeleft|wiperight, n)`).
   *
   * Held on the session for the same reason the fade is — a transition outlives
   * the viewer that started it — and stepped on the game clock by
   * {@link tickWipe}, so a slow host takes the same number of passes as a fast
   * one rather than the same number of milliseconds.
   *
   * `from` is the old screen. The new one is whatever the viewer paints this
   * frame, so nothing has to be captured twice or held in sync.
   */
  wipe = {
    /**
     * `left`/`right` are WIPES — the arriving screen is uncovered and the leaving
     * one stands still — and `open`/`close` the barn doors. `turnleft`/
     * `turnright` are a PUSH: both pictures move, and they are a different effect
     * in the original too rather than a variation on the wipes (see
     * ScreenDirector.pushTurn for the evidence).
     */
    dir: "" as "" | "left" | "right" | "open" | "close" | "turnleft" | "turnright" | "dissolve",
    /**
     * How far a turn travels, as a fraction of the screen: 1, or 0.5 for the
     * `half` pair. That is what "half" names, and it is in the binary rather than
     * inferred — `turnhalfleft` (tl.exe 0x448b48) halves the rect's width with
     * `sar eax, 1` before dividing by the step count, where `turnleft` (0x44875b)
     * divides the whole of it. Both are handed the same rect: the screen.
     */
    span: 1,
    /**
     * The ramp has finished but the COMPOSITE is still the screen.
     *
     * A turn comes in two legs — Timelapse's `lefttoframeMin` shows the mid-turn
     * flat and asks for `turnhalfleft`, then shows the destination and asks for
     * `turnleft` — and the second leg has to start from where the first one
     * stopped. In the original that is automatic: it never blits a whole flat, it
     * only ever moves strips, so the screen simply IS the composite. This port
     * repaints the current flat every frame, so without this the frame between
     * the legs is the mid-turn flat drawn whole — and those are not whole
     * pictures. They are 320 columns of art centred in a 640 canvas with the
     * rest left blank, so the second leg would capture that blank and scroll it
     * across the screen.
     *
     * So a HALF turn's ramp ends by settling rather than clearing: `wiping` goes
     * false (the script waiting on the effect proceeds) while the composite keeps
     * being drawn, which is what the next `visualeffect` then captures. And it
     * keeps being drawn until that next effect replaces it — the settled state
     * must outlive the `visualeffect` call itself, because `gotoflat(namedest)`
     * runs between the legs and is free to yield frames (a flat's open script, a
     * sound, a decode). Ending the wipe when the script's wait was over — which
     * is what the wait loop's unconditional endWipe did — put the live world
     * back on screen for exactly those frames, and leg two then captured the
     * destination flat drawn whole and glued its own middle to its right edge.
     * A right turn survived that (both halves the same picture, near enough); a
     * left turn showed the join, at 66 against the art's own 9, whenever — and
     * only whenever — something between the legs happened to yield. A FULL turn
     * does not settle: at `off === width` the leaving picture contributes no
     * columns, the composite IS the current flat, and ending it is what lets the
     * flat's animation run again after the turn.
     */
    settled: false,
    /**
     * Milliseconds per ramp step. {@link RAMP_STEP_MS} — one 60 Hz tick, the
     * original's own pacing — unless a shell has slowed it down to look at one.
     *
     * A turn is over in about a third of a second, which is right and is also too
     * quick to describe: "there is a seam somewhere on the left" is as much as
     * anyone can say at full speed. Raising this stretches the ramp without
     * changing a single number in the geometry, so what you see slowly is exactly
     * what happens quickly.
     */
    stepMs: RAMP_STEP_MS,
    /**
     * The picture a turn is ARRIVING at, captured once when the effect starts.
     *
     * The original has this for free: `gotoflat` draws the new flat to the
     * OFFSCREEN surface, `visualeffect` is modal, and nothing can redraw that
     * surface until the effect returns — so every strip 0x448c20 lifts comes
     * from one stable picture. This port repaints the world every frame, and
     * the world moves under a ramp: the destination flat ANIMATES (i0001.103
     * is water, and it was reaching frames .2 and .3 mid-turn), so strips
     * consumed on different passes came from different pictures, and the join
     * a settle captured was not the join the ramp had shown. Held here, the
     * arriving side is one picture for the whole ramp, exactly as the
     * original's offscreen is.
     *
     * Only turns carry it. A wipe's arriving side really is the live world —
     * that is what "the new screen is whatever the viewer paints" means — and
     * changing that would be inventing behaviour, not porting it.
     */
    to: null as { rgba: Uint8ClampedArray; width: number; height: number } | null,
    /** steps already revealed, of `steps` */
    step: 0,
    steps: 0,
    lastTick: 0,
    from: null as { rgba: Uint8ClampedArray; width: number; height: number } | null,
  };

  /** a reveal the SCRIPT is still waiting on */
  get wiping(): boolean {
    return this.wipe.dir !== "" && this.wipe.from !== null && !this.wipe.settled;
  }

  /** a reveal the RENDERER still has to composite — see {@link wipe.settled} */
  get compositing(): boolean {
    return this.wipe.dir !== "" && this.wipe.from !== null;
  }

  /**
   * Advance a reveal. One step per RAMP_STEP_MS, which is NOT the engine pass.
   *
   * TI.EXE paces the strips against its own 60 Hz counter rather than the 50 ms
   * service clock: `0x41de90` reads the OS millisecond timer and returns
   * `(ms * 3) / 50`, i.e. ms/16.67, and the wipe's pacer (0x43c600) spins until
   * that counter reaches `timeBase + i` for strip i. So a step is one 60 Hz tick
   * and the scrapbook's `visualeffect(wipeleft, 30)` takes half a second, not the
   * 1.5 s a 50 ms step would give it.
   *
   * Left on the accumulator below rather than moved to {@link ticksAt} with the
   * fade: driven from whole-ms clock readings a 30-strip wipe lands in 501 ms
   * against the counter's own 484, so the rounding {@link tickFade} had to escape
   * costs this one about a third of one strip. Not worth a re-record.
   */
  tickWipe(now: number): void {
    const w = this.wipe;
    if (!this.wiping) return;
    const stepMs = w.stepMs || RAMP_STEP_MS;
    if (!w.lastTick) w.lastTick = now - stepMs;
    while (this.wiping && now - w.lastTick >= stepMs) {
      w.lastTick += stepMs;
      // A HALF turn SETTLES: the composite stays on screen — half arriving
      // picture, half leaving one — for the second leg to capture, and it can,
      // because both halves are held pictures (`to`/`from`) that no world
      // repaint can move. A FULL turn is over: at `off === width` the leaving
      // picture contributes no columns and the composite IS the current flat,
      // so ending it hands the screen back to the live world — which is where
      // the destination's animation resumes, exactly as the original's does by
      // drawing over whatever the effect left.
      if (++w.step >= w.steps) {
        if ((w.dir === "turnleft" || w.dir === "turnright") && w.span < 1) {
          w.settled = true;
        } else this.session.endWipe();
      }
    }
  }

  endWipe(): void {
    this.wipe.dir = "";
    this.wipe.from = null;
    this.wipe.step = 0;
    this.wipe.steps = 0;
    this.wipe.lastTick = 0;
    this.wipe.span = 1;
    this.wipe.settled = false;
    this.wipe.to = null;
  }

  get fading(): boolean {
    return this.fade.queue.length > 0;
  }

  /** advance the fade one script tick at a time — the ramp's own clock in the
   *  original, not the service pass ({@link RAMP_STEP_MS}) */
  tickFade(now: number): void {
    const f = this.fade;
    if (!f.queue.length) {
      f.lastTick = 0;
      // A movie has ended and the script that played it has finished talking
      // (no dispatch left in flight): whatever black it left behind is nobody's
      // any more, so lift it. Deferring to here — rather than revealing the
      // instant the movie ends — is what keeps a boot sequence black (TAOOT:
      // boot() ends the main-menu movie and then spends many frames opening
      // bedsit1 and playing the date caption before advanceday's blacktoscreen
      // fades the flat in; revealing at movie end would flash the room, fully lit,
      // in between). A stage that never fades still gets its reveal (TAOOT's
      // bomb: blackscreen -> bombopen.mov -> setvisible(false), no fade follows).
      if (f.pendingReveal && !f.snapshot && !this.session.scriptBusy) {
        f.pendingReveal = false;
        f.blanked = false;
        f.level = 0;
      }
      return;
    }
    f.pendingReveal = false;
    // Counted in the original's own tick numbers rather than by accumulating a
    // 16.666… ms step: a step is 1/60 s exactly and the sum of thirds is not, so
    // `now - lastTick >= step` fell a hair short about one call in five and lost
    // that step — a 10-step fade took 12 ticks.
    const tick = ticksAt(now);
    if (!f.lastTick) f.lastTick = tick - 1;
    while (f.queue.length && f.lastTick < tick) {
      f.lastTick++;
      const ramp = f.queue[0];
      if (ramp.to === 0) f.snapshot = null; // fading back in reveals the live frame
      const delta = 1 / ramp.steps;
      f.level =
        ramp.to > f.level
          ? Math.min(ramp.to, f.level + delta)
          : Math.max(ramp.to, f.level - delta);
      // …and the level is thirds all over again: ten steps of 1/10 off 1 leave
      // 1.4e-16, which is not `to` and cost an eleventh step to walk off
      if (Math.abs(f.level - ramp.to) < delta / 2) {
        f.level = ramp.to;
        f.queue.shift();
      }
    }
  }
}
