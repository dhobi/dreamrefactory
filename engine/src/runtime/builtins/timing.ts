import { logic, toNum, toStr, truthy } from "../interp";
import { pauseDepthOf } from "../scheduler";
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
  // script delays nothing else moves (Scheduler.pass); RedJack.exe the same (0x469ee0)
  r("delay", async (_i, [n]) => {
    await session.clock.sleep((toNum(n ?? 0) * 50) / 3);
  });
  r("makeloop", (_i, [kind, name, handler, period]) => {
    session.scheduler.makeLoop(toStr(kind ?? ""), toStr(name ?? ""), toStr(handler ?? ""), toNum(period ?? 1));
  });
  r("stoploop", (_i, [kind, name]) => session.scheduler.stopLoop(toStr(kind ?? ""), toStr(name ?? "")));
  /**
   * The pause getters — `pauseloop (kind, name)`, `pausecricket (name)` /
   * `pauseball (name)`, `pausewalk (name)` — answer the boolean tag. DF.EXE puts
   * the pause DEPTH in its payload (0x42cf95, 0x42d074, 0x42d004), which a
   * {@link logic} keeps (interp.ts Logic: depth 2 is not `= true`); TI.EXE and
   * tl.exe answer 0 or 1 (TI.EXE 0x42ae87, 0x42af86, 0x42af06), which the
   * interpreter makes of a plain depth.
   */
  const pauseAnswer = (depth: number) => (session.isV1 ? logic(depth) : depth);
  r("pauseloop", (_i, [kind, name, flag]) => {
    // two arguments: the getter (DF.EXE 0x42cf20 → 0x438fa0, TI.EXE 0x42ae10):
    // the first loop of that kind and name, 0 for none
    if (flag === undefined && name !== undefined && !session.isV5) {
      const k = toStr(kind ?? "").toLowerCase();
      const n = toStr(name).toLowerCase();
      const l = session.scheduler.loops.find((x) => x.kind === k && x.name === n);
      return pauseAnswer(pauseDepthOf(l));
    }
    session.scheduler.pauseLoop(toStr(kind ?? ""), toStr(name ?? ""), truthy(flag ?? 1));
  });
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
      if (flag === undefined) return pauseAnswer(balls.pauseDepth(toStr(name ?? "")));
      balls.pause(toStr(name ?? "all"), truthy(flag));
      return;
    }
    // one argument is the getter: the pause count (TI.EXE 0x444880). RedJack.exe
    // has none — its pausecricket (0x409210) reads a name and a number and nests
    // the count (Scheduler.pauseCricket)
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
      ? session.scheduler.sounds.isLooped(toStr(name ?? ""))
      : session.scheduler.sounds.setLoop(toStr(name ?? ""), truthy(flag)),
  );

  // forceupdate(): advance one engine step, then yield a real frame so the
  // browser renders and delivers pending input. Script poll loops (the crank
  // play loop `while done=0 { forceupdate(); mouse(); button() }`) depend on
  // this yield to ever see the click that ends them — a synchronous tick alone
  // would spin forever. The realYieldSeq bump spares the loop from the guard.
  r("forceupdate", async (_i, _a, _c, frame) => {
    // ONE PASS of the main loop, and nothing else: TI.EXE's forceupdate
    // (0x43e3e0) is a bare `jmp 0x442550`, tl.exe's (0x44a9e0) the same, and
    // RedJack.exe's (0x408ce0) a call of its pass 0x41b360. Walks, crickets and
    // loops are serviced and their handlers run to their end inside it, then
    // the frame waits out `framerate` ticks (Scheduler.pass).
    //
    // A host that moves the clock is waited on; headless nothing moves it
    // while a script runs, so the pass jumps it — except in the BOOTFILE's
    // own idle, which the host started and whose clock the host moves.
    const sched = session.scheduler;
    const wait = sched.passWait(frame);
    if (wait === "jump") await session.transitionCtrl.untilRampEnds();
    await sched.pass({ wait });
    if (session.hasRealFrames) session.realYieldSeq++;
    else if (wait === "jump") await session.nextFrame();
  });
}
