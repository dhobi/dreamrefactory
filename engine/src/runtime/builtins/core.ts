/**
 * Language-level builtins with obvious semantics that need no reverse
 * engineering and no GameSession — pure functions over values. Everything
 * game-flavoured (even string/math helpers whose exact behaviour had to be
 * recovered from TI.EXE, like calcmod's non-negative modulo) lives in the
 * session-bound families registered by {@link registerGameBuiltins}.
 */
import { Interpreter, ScriptError, toNum, toStr } from "../interp";
import { foldAscii } from "../caseless";

export function registerCoreBuiltins(interp: Interpreter, rng: () => number = Math.random): void {
  const r = interp.register.bind(interp);
  /**
   * random(n): 1..n. The DISTRIBUTION is the engines'; the draws are this port's
   * seeded stream (GameSession.rng), which a speedrun's seed fixes.
   *
   * TI.EXE (0x42a900) and tl.exe (0x43a040) refuse n <= 0 with error 0xa and
   * answer `gen() % n + 1` (0x435fc0); DF.EXE (0x42ca20 -> 0x430550) has no
   * check and scales a 15-bit draw, `trunc(r * n / 0x7fff) + 1` — random(0) is 1
   * there. The mapping from the stream stays `trunc(r * n) + 1` for both: the
   * engines' generator (TI.EXE's 55-word table at 0x48ac00, seeded from the
   * tick) is not reproduced, so its modulo would buy no fidelity, and it would
   * move every seeded draw a published route was calculated against.
   */
  r("random", (i_, [n]) => {
    const max = toNum(n ?? 0);
    if (i_.classic && i_.tableVersion() !== 1 && max <= 0) throw new ScriptError(0xa, `random(${max})`);
    return Math.trunc(rng() * max) + 1;
  });
  // the integer root of the argument as UNSIGNED, low word (TI.EXE 0x429a80 ->
  // 0x436100, DF.EXE 0x42bc20 -> 0x430650): sqrt(-1) is 65535, not NaN
  r("sqrt", (i_, [n]) =>
    i_.classic ? Math.floor(Math.sqrt(toNum(n ?? 0) >>> 0)) & 0xffff : Math.floor(Math.sqrt(toNum(n ?? 0))),
  );
  r("stringtonum", (_i, [s]) => toNum(s ?? 0));
  // substring(haystack, needle): 1-based FIND, -1 when absent — not a slice.
  // Every TAOOT corpus call compares the result (`substring(propview(me),"idle")>=0`,
  // `substring(path(1),"titanic1:")=1`), and ENIGMA maps letters to key angles
  // with `substring("abcdefghijklmnopqrstuvwxyz ", arg) - 1`, which only works
  // 1-based. Case-insensitive like every other string comparison in the engine.
  // An EMPTY needle finds nothing: DF.EXE starts the answer at -1 and skips the
  // search when the needle's length byte is 0 (0x42d627); TI.EXE 0x42b5a7 and
  // tl.exe 0x43ace7 the same.
  r("substring", (i_, [s, needle]) => {
    if (i_.classic && toStr(needle ?? "") === "") return -1;
    // folded A-Z only before DreamFactory 5 (caseless.ts foldAscii)
    const fold = i_.classic ? foldAscii : (x: string) => x.toLowerCase();
    const i = fold(toStr(s ?? "")).indexOf(fold(toStr(needle ?? "")));
    return i < 0 ? -1 : i + 1;
  });
  r("true", (i_) => i_.bool(true));
  r("false", (i_) => i_.bool(false));
}
