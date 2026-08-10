import type { Actor } from "../../df/set";
import type { GameSession } from "../session";
import { Builtin, Frame, Interpreter, Value, toStr } from "../interp";

/**
 * Shared plumbing handed to every `register*Builtins` module. Only the pieces
 * genuinely needed by more than one family live here (the interpreter, the
 * bound `register`, log routing, and the set-star lookup); family-specific
 * accessors (`prop`, `actor`, `s16`, …) stay local to their own module.
 */
export interface BuiltinCtx {
  session: GameSession;
  interp: Interpreter;
  /** `interp.register`, bound — registers a plain builtin */
  r: (name: string, fn: Builtin) => void;
  /** route a log line through the active binding, falling back to the session */
  log: (line: string) => void;
  /** a named world point ("star") from the current set's actor table */
  findStar: (name: Value) => Actor | undefined;
  /**
   * Give up one REAL rendered frame from inside a script poll loop.
   *
   * Several builtins are polled by empty-body script loops (`while not
   * voicedone() endwhile`, `while not button() ... endwhile`) that have no
   * other yield: without this, the loop spins synchronously and the thing it
   * waits on (audio finishing, a click arriving) can never happen. The
   * realYieldSeq bump tells the interpreter's runaway-loop guard that the
   * loop genuinely waits on the outside world. Headless (tests) has no real
   * frames: the poll resolves immediately and the guard stays armed, so a
   * stuck loop still fails fast instead of hanging the run.
   */
  yieldFrame: () => Promise<void>;
}

/**
 * Register getter/setter builtins dispatched by arity — the dominant shape of
 * the actor and prop command families: `cmd(name)` reads a field, `cmd(name,
 * v)` writes it, and a name that resolves to no entity answers `empty` either
 * way (scripts probe freely; a miss must never throw). The setter also
 * receives the raw name argument (actorvisible's dropAttention, propvisible's
 * messageboxclear hook) and the running frame (propowner's trace), for the
 * few accessors whose write has a side effect keyed on who was addressed.
 *
 * Commands whose GETTER is irregular (the axis-multiplexed actorxyz/propxyz,
 * propxy) stay hand-written in their families.
 */
export function accessorFamily<T>(
  r: BuiltinCtx["r"],
  resolve: (name: Value) => T | null | undefined,
): (
  name: string,
  empty: Value,
  get: (e: T) => Value,
  set: (e: T, v: Value, name: Value, frame: Frame) => void,
) => void {
  return (name, empty, get, set) =>
    r(name, (_i, [n, v], _call, frame) => {
      const e = resolve(n);
      if (!e) return empty;
      if (v === undefined) return get(e);
      set(e, v, n, frame);
    });
}

export function createBuiltinCtx(session: GameSession): BuiltinCtx {
  const interp = session.interp;
  return {
    session,
    interp,
    r: interp.register.bind(interp),
    // The open set's own log, else the session's.
    //
    // NOT `session.currentBinding?.onLog(l) ?? session.onLog(l)`, which is what
    // this line was: `?.` guards the CALL, not its result. With a set open the
    // binding logged the line, the call answered undefined (onLog is void), and
    // `??` then logged the same line AGAIN through the session. So every
    // `message()` in the game arrived twice in the details pane (#49) — the
    // reporter's `msg: ACT -- She explains why she's here.` twice, `msg: gaspen`
    // twice — while lines emitted straight through `session.onLog` (`stage
    // loaded:`, `movie:`) came once, which is the pattern in their logs.
    //
    // No headless test could catch it, by luck: the test harness's sink is
    // `(l) => logs.push(l)`, and push answers the new LENGTH — not nullish, so
    // `??` short-circuited and the second call never happened. main.ts's `log()`
    // has a statement body and answers undefined, so a browser always doubled.
    // Measured on one message() call: number-returning sink 1 line, void sink 2.
    log: (l) => {
      if (session.currentBinding) session.currentBinding.onLog(l);
      else session.onLog(l);
    },
    findStar: (name) => {
      const n = toStr(name ?? "").toLowerCase();
      return session.currentBinding?.set.actors.find((a) => a.identifier.toLowerCase() === n);
    },
    yieldFrame: async () => {
      if (session.hasRealFrames) {
        session.realYieldSeq++;
        await session.nextFrame();
      }
    },
  };
}
