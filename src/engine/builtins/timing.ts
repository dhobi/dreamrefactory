import { toNum, toStr, truthy } from "../interp";
import { ENGINE_STEP_MS, ticksAt } from "../clock";
import { BuiltinCtx } from "./context";

/**
 * TI.EXE timing model: delay (script suspension), makeloop/makecricket
 * scheduling, soundloop flags, and the forceupdate cooperative yield that
 * drives interactive poll loops.
 *
 * 1 script tick = 1/60 s; loops + crickets are serviced every 50 ms.
 */
export function registerTimingBuiltins(ctx: BuiltinCtx): void {
  const { session, r } = ctx;

  // delay(n): suspend this script n/60 s while the engine keeps ticking
  r("delay", async (_i, [n]) => {
    await session.clock.sleep((toNum(n ?? 0) * 50) / 3);
  });
  r("makeloop", (_i, [kind, name, handler, period]) => {
    session.scheduler.makeLoop(toStr(kind ?? ""), toStr(name ?? ""), toStr(handler ?? ""), toNum(period ?? 1));
  });
  r("stoploop", (_i, [kind, name]) => session.scheduler.stopLoop(toStr(kind ?? ""), toStr(name ?? "")));
  r("pauseloop", (_i, [kind, name, flag]) =>
    session.scheduler.pauseLoop(toStr(kind ?? ""), toStr(name ?? ""), truthy(flag ?? 1)),
  );
  r("isloop", (_i, [kind, name]) => (session.scheduler.isLoop(toStr(kind ?? ""), toStr(name ?? "")) ? 1 : 0));
  r("countloops", () => session.scheduler.loops.length);
  r("indextoloop", (_i, [idx]) => session.scheduler.loops[toNum(idx ?? 0) - 1]?.name ?? "");

  r("makecricket", (_i, [name, x, y, radius, base, jitter]) => {
    session.scheduler.makeCricket(
      toStr(name ?? ""), toNum(x ?? 0), toNum(y ?? 0),
      toNum(radius ?? 1), toNum(base ?? 0), toNum(jitter ?? -1),
    );
  });
  r("stopcricket", (_i, [name]) => session.scheduler.stopCricket(toStr(name ?? "all")));
  r("pausecricket", (_i, [name, flag]) =>
    session.scheduler.pauseCricket(toStr(name ?? "all"), truthy(flag ?? 1)),
  );
  r("iscricket", (_i, [name]) => (session.scheduler.isCricket(toStr(name ?? "")) ? 1 : 0));
  r("countcrickets", () => session.scheduler.crickets.length);
  r("indextocricket", (_i, [idx]) => session.scheduler.crickets[toNum(idx ?? 0) - 1]?.name ?? "");

  r("soundloop", (_i, [name, flag]) => session.scheduler.soundLoop(toStr(name ?? ""), truthy(flag ?? 1)));

  // forceupdate(): advance one engine step, then yield a real frame so the
  // browser renders and delivers pending input. Script poll loops (the crank
  // play loop `while done=0 { forceupdate(); mouse(); button() }`) depend on
  // this yield to ever see the click that ends them — a synchronous tick alone
  // would spin forever. The realYieldSeq bump spares the loop from the guard.
  r("forceupdate", async (_i, _a, _c, frame) => {
    // With real frames, the rAF loop advances the clock with REAL time each
    // frame — self-advancing +66 here on top of that races the sim clock
    // ahead of real time (4x at 60fps), and every later clock.sleep (trackbut
    // after a long crank play) stalls until real time catches back up. So in
    // the browser forceupdate only waits real frames; the tick does the rest.
    // Headless has no frame source, so it self-advances one 50 ms step —
    // which also keeps tests deterministic (one call = one service step).
    if (!session.hasRealFrames) {
      session.tickTime(session.clock.now + ENGINE_STEP_MS);
      await session.nextFrame();
      return;
    }
    session.realYieldSeq++;
    // Honour framerate(n): the stage/animation asks for n ticks per displayed
    // frame, so a `for … forceupdate()` animation loop (the fencing lunge/parry,
    // gramophone crank) should hold each frame that long. Locking every
    // forceupdate to a single 60 Hz rAF made those loops run ~n× too fast (the
    // fencing attack blurred past in ~100 ms).
    //
    // Hold for n TICKS OF REAL TIME rather than n rAF callbacks — TI.EXE's own
    // frame throttle (0x43a940) spins on `timeGetTime` until
    // `now >= lastFrame + framerate`, so the hold is a duration, not a count of
    // draws. Counting draws ties every animation in the game to the display:
    // identical at exactly 60 Hz, half as long on a 120 Hz panel, and stretched
    // on a machine that cannot keep up. `nextFrame` is still what we wait ON —
    // it is the only thing that renders and delivers input — but the clock
    // decides when we have waited enough.
    const deadline = ticksAt(session.clock.now) + Math.max(1, Math.round(session.frameRate));
    do {
      await session.nextFrame();
      // this handler owns the CPU (scriptBusy), so the normal per-frame loop
      // service is skipped; pump the OTHER per-frame loops here so e.g. the sky
      // keeps drifting while the wheel is being turned (not the caller's own).
      session.scheduler.pumpFrameLoops(frame?.ctx?.me ?? "");
    } while (ticksAt(session.clock.now) < deadline);
  });
}
