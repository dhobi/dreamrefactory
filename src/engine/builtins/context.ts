import type { Actor } from "../../df/set";
import type { GameSession } from "../session";
import { Builtin, Interpreter, Value, toStr } from "../interp";

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
}

export function createBuiltinCtx(session: GameSession): BuiltinCtx {
  const interp = session.interp;
  return {
    session,
    interp,
    r: interp.register.bind(interp),
    log: (l) => session.currentBinding?.onLog(l) ?? session.onLog(l),
    findStar: (name) => {
      const n = toStr(name ?? "").toLowerCase();
      return session.currentBinding?.set.actors.find((a) => a.identifier.toLowerCase() === n);
    },
  };
}
