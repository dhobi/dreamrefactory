import { toNum, toStr, truthy } from "../interp";
import { ENGINE_STEP_MS, ticksAt } from "../clock";
import { BuiltinCtx } from "./context";

/**
 * TI.EXE timing model: delay (script suspension), makeloop/makecricket
 * scheduling, soundloop flags, and `forceupdate` — one pass of the main loop.
 *
 * 1 script tick = 1/60 s; loops, crickets and walks are serviced once a pass,
 * and a pass is `framerate` ticks (Scheduler.pass).
 */
export function registerTimingBuiltins(ctx: BuiltinCtx): void {
  const { session, r } = ctx;

  // delay(n): suspend this script n/60 s. TI.EXE's (0x41deb0) spins on
  // timeGetTime calling only the message pump (0x41ea20) — no pass, so while a
  // script delays nothing else moves (Scheduler.scriptPaced)
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

  // DreamFactory 1 gave these six ids to its BALLS — makeball, stopball,
  // pauseball, isball, countballs, indextoball — a projectile that moves a prop
  // and ends in its `endball` (runtime/balls.ts). Nothing like a cricket, so a
  // v1 game takes the other branch of every one (engine/src/df/opcodes.ts).
  const balls = session.balls;
  r("makecricket", (_i, [name, x, y, radius, base, jitter, frames]) => {
    if (session.isV1) {
      balls.make(toStr(name ?? ""), [x, y, radius, base, jitter, frames].map((v) => toNum(v ?? 0)));
      return;
    }
    session.scheduler.makeCricket(
      toStr(name ?? ""), toNum(x ?? 0), toNum(y ?? 0),
      toNum(radius ?? 1), toNum(base ?? 0), toNum(jitter ?? -1),
    );
  });
  r("stopcricket", (_i, [name]) =>
    session.isV1 ? balls.stop(toStr(name ?? "all")) : session.scheduler.stopCricket(toStr(name ?? "all")),
  );
  r("pausecricket", (_i, [name, flag]) => {
    if (session.isV1) {
      if (flag === undefined) return balls.pauseDepth(toStr(name ?? ""));
      balls.pause(toStr(name ?? "all"), truthy(flag));
      return;
    }
    // one argument is the getter: the pause count (TI.EXE 0x444880)
    if (flag === undefined && name !== undefined && !session.isV5) return session.scheduler.cricketPauseDepth(toStr(name));
    session.scheduler.pauseCricket(toStr(name ?? "all"), truthy(flag ?? 1));
  });
  r("iscricket", (_i, [name]) => {
    const n = toStr(name ?? "");
    const live = session.isV1 ? balls.isBall(n) : session.scheduler.isCricket(n);
    return live ? 1 : 0;
  });
  r("countcrickets", () => (session.isV1 ? balls.count() : session.scheduler.crickets.length));
  r("indextocricket", (_i, [idx]) =>
    session.isV1
      ? balls.indexToBall(toNum(idx ?? 0))
      : (session.scheduler.crickets[toNum(idx ?? 0) - 1]?.name ?? ""),
  );

  // one argument is the GETTER (DF.EXE 0x407840, TI/tl the same tag): Dust's
  // dayfxs asks `if soundloop (fxsound)` before it flips the saw on or off, and
  // Timelapse's ambience the same — a reading that switched the loop on
  r("soundloop", (_i, [name, flag]) =>
    flag === undefined
      ? session.scheduler.isSoundLooped(toStr(name ?? ""))
      : session.scheduler.soundLoop(toStr(name ?? ""), truthy(flag)),
  );

  // forceupdate(): advance one engine step, then yield a real frame so the
  // browser renders and delivers pending input. Script poll loops (the crank
  // play loop `while done=0 { forceupdate(); mouse(); button() }`) depend on
  // this yield to ever see the click that ends them — a synchronous tick alone
  // would spin forever. The realYieldSeq bump spares the loop from the guard.
  r("forceupdate", async (_i, _a, _c, frame) => {
    const sched = session.scheduler;
    if (sched.scriptPaced) {
      // ONE PASS of the main loop, and nothing else: TI.EXE's forceupdate
      // (0x43e3e0) is a bare `jmp 0x442550`, tl.exe's (0x44a9e0) the same.
      // Walks, crickets and loops are serviced and their handlers run to their
      // end inside it, then the frame waits out `framerate` ticks (Scheduler.pass).
      //
      // A host that moves the clock is waited on; headless nothing moves it
      // while a script runs, so the pass jumps it — except in the BOOTFILE's
      // own idle, which the host started and whose clock the host moves.
      const wait = sched.passWait(frame);
      if (wait === "jump") await session.transitionCtrl.untilRampEnds();
      await sched.pass({ wait });
      if (session.hasRealFrames) session.realYieldSeq++;
      else if (wait === "jump") await session.nextFrame();
      return;
    }
    // With real frames, the rAF loop advances the clock with REAL time each
    // frame — self-advancing +66 here on top of that races the sim clock
    // ahead of real time (4x at 60fps), and every later clock.sleep (trackbut
    // after a long crank play) stalls until real time catches back up. So in
    // the browser forceupdate only waits real frames; the tick does the rest.
    // Headless has no frame source, so it self-advances one 50 ms step —
    // which also keeps tests deterministic (one call = one service step).
    if (!session.hasRealFrames) {
      // not while another script is blocked in a fade ramp (#541)
      await session.transitionCtrl.untilRampEnds();
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
      await session.frameWait();
      // this handler owns the CPU (scriptBusy), so the normal per-frame loop
      // service is skipped; pump the OTHER per-frame loops here so e.g. the sky
      // keeps drifting while the wheel is being turned (not the caller's own).
      session.scheduler.pumpFrameLoops(frame?.ctx?.me ?? "");
    } while (ticksAt(session.clock.now) < deadline);
  });
}
