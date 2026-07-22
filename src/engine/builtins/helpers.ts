import { Value, toNum, toStr } from "../interp";
import { bearing } from "../geometry";
import { BuiltinCtx } from "./context";

/**
 * Assorted scalar helpers that live outside any object script: string/word
 * utilities (findword/putword/variable), number formatting + modulo, the
 * memory/heap stubs, per-stage scratch params, and the packed-point geometry
 * primitives (cameraxyz/playerxyz/calcdeg/calcdist) the cast library builds on.
 */
export function registerHelperBuiltins(ctx: BuiltinCtx): void {
  const { session, interp, r } = ctx;

  // string helper used by boot logic: findword("a,b,c", ",", 2) -> "b"
  // word list = a string split on a separator; an EMPTY (or omitted) delimiter
  // means the default separator, a space (CyberFlix convention). saveprops
  // strings ("1 0 1 …", built by putword) round-trip through this.
  const wordSep = (delim: Value) => {
    const d = delim === undefined ? "" : toStr(delim);
    return d === "" ? " " : d;
  };
  r("findword", (_i, [s, delim, idx]) => {
    const parts = toStr(s ?? "").split(wordSep(delim));
    return parts[(Number(idx) || 1) - 1] ?? "";
  });
  // putword(str, delim, idx, word): replace the idx-th (1-based) word, padding
  // with empty words when idx is past the end so an empty string grows into a
  // fixed-slot list (hideenigma/hidetrunk save each prop's visibility by slot).
  r("putword", (_i, [s, delim, idx, word]) => {
    const sep = wordSep(delim);
    const i = Math.max(1, Number(idx) || 1) - 1;
    const parts = toStr(s ?? "") === "" ? [] : toStr(s ?? "").split(sep);
    while (parts.length <= i) parts.push("");
    parts[i] = toStr(word ?? "");
    return parts.join(sep);
  });
  r("stringlength", (_i, [s]) => toStr(s ?? "").length);
  // variable(name[, val]): dynamic global access by computed name — getter with
  // one arg, setter with two. Blackjack tracks per-side state this way
  // (variable(who @ "count") -> playercount/dealercount, variable(who @
  // "downcard", card)). Reads/writes the same global table as named globals.
  r("variable", (_i, [name, val]) => {
    const key = toStr(name ?? "");
    if (val === undefined) return interp.globals.get(key) ?? 0;
    interp.globals.set(key, val);
    return 0;
  });

  r("numtostring", (_i, [n]) => String(toNum(n ?? 0)));
  r("lowmemory", () => 0); // we never simulate the CD-era low-memory path
  // heapsize(): free memory in bytes. BOOTFILE defines its own lowmemory()
  // (which shadows the builtin above) as `heapsize() < 6144000` — and every
  // setupsound() case for a memory-heavy deck (decka/deckb/decke/deckf/cargo)
  // then loads the 11 kHz `.11k` bank instead of the full `.trk`, while still
  // calling playnewtheme("<deck>.trk"). Left at 0, heapsize() reported "low
  // memory", the .trk bank was never opened, and those rooms were silent.
  // We run in a browser with ample memory: report plenty so the full path runs.
  r("heapsize", () => 64 * 1024 * 1024);
  // stageparam(idx[, val]): per-stage scratch parameters, getter/setter by arity
  const stageParams = new Map<number, Value>();
  r("stageparam", (_i, [idx, val]) => {
    const k = toNum(idx ?? 0);
    if (val === undefined) return stageParams.get(k) ?? 0;
    stageParams.set(k, val);
    return 0;
  });

  // helpers used around conversations that live outside any script
  r("cameraxyz", (_i, [axis]) => {
    const lis = session.listener();
    if (!lis) return 0;
    switch (toNum(axis ?? 1)) {
      case 1: return lis.x;
      case 2: return lis.y;
      case 4: return ((lis.x & 0xffff) << 16) | (lis.y & 0xffff);
      default: return 0;
    }
  });
  // calcdeg(fromPacked, toPacked): bearing between two packed (x<<16|y)
  // points in the engine's 0..255 angle space (turntodeg targets)
  r("calcdeg", (_i, [from, to]) => {
    const fx = (toNum(from ?? 0) >> 16) & 0xffff;
    const fy = toNum(from ?? 0) & 0xffff;
    const tx = (toNum(to ?? 0) >> 16) & 0xffff;
    const ty = toNum(to ?? 0) & 0xffff;
    return bearing(tx - fx, ty - fy);
  });
  // calcmod(a, b): non-negative modulo (bridge wheel's getpropdeg maps the
  // 0..255 wheel angle into the sprite's 0..4 rotation frames)
  r("calcmod", (_i, [a, b]) => {
    const m = toNum(b ?? 0);
    if (m === 0) return 0;
    return ((toNum(a ?? 0) % m) + m) % m;
  });
  // primitives behind the cast library's realdist()/facing helpers:
  // playerxyz(4) = the camera's packed ground position, calcdist between
  // two packed (x<<16|y) points
  r("playerxyz", (_i, [axis]) => {
    const lis = session.listener();
    if (!lis) return 0;
    switch (toNum(axis ?? 1)) {
      case 1: return lis.x;
      case 2: return lis.y;
      case 4: return ((lis.x & 0xffff) << 16) | (lis.y & 0xffff);
      default: return 0;
    }
  });
  r("calcdist", (_i, [a, b]) => {
    const ax = (toNum(a ?? 0) >> 16) & 0xffff;
    const ay = toNum(a ?? 0) & 0xffff;
    const bx = (toNum(b ?? 0) >> 16) & 0xffff;
    const by = toNum(b ?? 0) & 0xffff;
    return Math.round(Math.hypot(bx - ax, by - ay));
  });
}
