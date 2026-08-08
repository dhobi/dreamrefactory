/**
 * Language-level builtins with obvious semantics that need no reverse
 * engineering and no GameSession — pure functions over values. Everything
 * game-flavoured (even string/math helpers whose exact behaviour had to be
 * recovered from TI.EXE, like calcmod's non-negative modulo) lives in the
 * session-bound families registered by {@link registerGameBuiltins}.
 */
import { Interpreter, toNum, toStr } from "../interp";

export function registerCoreBuiltins(interp: Interpreter, rng: () => number = Math.random): void {
  const r = interp.register.bind(interp);
  r("random", (_i, [n]) => Math.floor(rng() * toNum(n ?? 0)) + 1);
  r("sqrt", (_i, [n]) => Math.floor(Math.sqrt(toNum(n ?? 0))));
  r("stringtonum", (_i, [s]) => toNum(s ?? 0));
  // substring(haystack, needle): 1-based FIND, -1 when absent — not a slice.
  // Every TAOOT corpus call compares the result (`substring(propview(me),"idle")>=0`,
  // `substring(path(1),"titanic1:")=1`), and ENIGMA maps letters to key angles
  // with `substring("abcdefghijklmnopqrstuvwxyz ", arg) - 1`, which only works
  // 1-based. Case-insensitive like every other string comparison in the engine.
  r("substring", (_i, [s, needle]) => {
    const i = toStr(s ?? "").toLowerCase().indexOf(toStr(needle ?? "").toLowerCase());
    return i < 0 ? -1 : i + 1;
  });
  r("true", () => 1);
  r("false", () => 0);
}
