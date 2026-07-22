import { toNum, toStr, truthy } from "../interp";
import { BuiltinCtx } from "./context";

/**
 * TI.EXE timing model: delay (script suspension), makeloop/makecricket
 * scheduling, soundloop flags, and the forceupdate cooperative yield that
 * drives interactive poll loops.
 *
 * 1 script tick = 1/60 s; loops + crickets are serviced every 66 ms.
 */
export function registerTimingBuiltins(ctx: BuiltinCtx): void {
  const { session, r } = ctx;

  // delay(n): suspend this script n/60 s while the engine keeps ticking
  r("delay", async (_i, [n]) => {
    await session.clock.sleep((toNum(n ?? 0) * 50) / 3);
  });
  r("makeloop", (_i, [kind, name, handler, period]) => {
    session.makeLoop(toStr(kind ?? ""), toStr(name ?? ""), toStr(handler ?? ""), toNum(period ?? 1));
  });
  r("stoploop", (_i, [kind, name]) => session.stopLoop(toStr(kind ?? ""), toStr(name ?? "")));
  r("pauseloop", (_i, [kind, name, flag]) =>
    session.pauseLoop(toStr(kind ?? ""), toStr(name ?? ""), truthy(flag ?? 1)),
  );
  r("isloop", (_i, [kind, name]) => (session.isLoop(toStr(kind ?? ""), toStr(name ?? "")) ? 1 : 0));
  r("countloops", () => session.loops.length);
  r("indextoloop", (_i, [idx]) => session.loops[toNum(idx ?? 0) - 1]?.name ?? "");

  r("makecricket", (_i, [name, x, y, radius, base, jitter]) => {
    session.makeCricket(
      toStr(name ?? ""), toNum(x ?? 0), toNum(y ?? 0),
      toNum(radius ?? 1), toNum(base ?? 0), toNum(jitter ?? -1),
    );
  });
  r("stopcricket", (_i, [name]) => session.stopCricket(toStr(name ?? "all")));
  r("pausecricket", (_i, [name, flag]) =>
    session.pauseCricket(toStr(name ?? "all"), truthy(flag ?? 1)),
  );
  r("iscricket", (_i, [name]) => (session.isCricket(toStr(name ?? "")) ? 1 : 0));
  r("countcrickets", () => session.crickets.length);
  r("indextocricket", (_i, [idx]) => session.crickets[toNum(idx ?? 0) - 1]?.name ?? "");

  r("soundloop", (_i, [name, flag]) => session.soundLoop(toStr(name ?? ""), truthy(flag ?? 1)));

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
    // Headless has no frame source, so it self-advances one 66 ms step —
    // which also keeps tests deterministic (one call = one service step).
    if (!session.hasRealFrames) {
      session.tickTime(session.clock.now + 66);
      await session.nextFrame();
      return;
    }
    session.realYieldSeq++;
    // Honour framerate(n): the stage/animation asks for n ticks per displayed
    // frame, so a `for … forceupdate()` animation loop (the fencing lunge/parry,
    // gramophone crank) should hold each frame that long. Locking every
    // forceupdate to a single 60 Hz rAF made those loops run ~n× too fast (the
    // fencing attack blurred past in ~100 ms). Wait n frames instead.
    const frames = Math.max(1, Math.round(session.frameRate));
    for (let i = 0; i < frames; i++) {
      await session.nextFrame();
      // this handler owns the CPU (scriptBusy), so the normal per-frame loop
      // service is skipped; pump the OTHER per-frame loops here so e.g. the sky
      // keeps drifting while the wheel is being turned (not the caller's own).
      session.pumpFrameLoops(frame?.ctx?.me ?? "");
    }
  });
}
