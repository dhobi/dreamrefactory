import { ScriptError, Value, toNum, toStr } from "../interp";
import { foldAscii } from "../caseless";
import { BuiltinCtx } from "./context";
import { panFrom255 } from "../scheduler";

/** `type (v)`'s answer for a value's tag. */
function typeName(v: Value | undefined): string {
  if (typeof v === "boolean") return "logic";
  if (typeof v === "string") return "text";
  if (typeof v === "number") return "number";
  return "unknown";
}

/**
 * Commands TI.EXE has and no shipped script calls — registered so that a script
 * which does gets the engine's answer rather than "no semantics" (TI.EXE's
 * implementations, from the action table at 0x414920/0x414ad8 and the value
 * table at 0x429718/0x4297f8; tl.exe's are the same code).
 *
 * `walkonroad` and `walkonframes` are not here: they walk a route TI.EXE builds
 * from a camera road (0x43bba0 -> 0x43c210 -> 0x405140/0x404f90, 0x43bd00 ->
 * 0x43c2f0), and live with the other walks in actors.ts.
 */
export function registerEngineExtraBuiltins(ctx: BuiltinCtx): void {
  const { session, interp, r } = ctx;

  /**
   * actorlock / proplock / castlock / shoplock (name, flag): keep a resource in
   * memory. A browser has no purge for them to stop, so what is left is what the
   * script can see — the flag is a boolean (value-types.ts, 0xe otherwise) and
   * the name must be open: the actor (0x40a7a0 -> 0x40c810), the prop (0x440f60
   * -> 0x442af0), the cast (0x40a850 -> 0x40c960) or the shop (0x441010 ->
   * 0x442c50), error 0xa when it is not.
   */
  const has = (names: Iterable<string>, n: Value): boolean => {
    const want = foldAscii(toStr(n ?? ""));
    for (const k of names) if (foldAscii(k) === want) return true;
    return false;
  };
  const lock = (cmd: string, open: (n: Value) => boolean) =>
    r(cmd, (_i, [n]) => {
      if (!open(n)) throw new ScriptError(0xa, `${cmd}: no such object ${toStr(n ?? "")}`);
    });
  lock("actorlock", (n) => !!session.actorRuntime.get(toStr(n ?? "")));
  lock("proplock", (n) => !!session.propRuntime.get(toStr(n ?? "")));
  lock("castlock", (n) => has(session.actorRuntime.casts.keys(), n));
  lock("shoplock", (n) => has(session.propRuntime.shops.keys(), n));

  /**
   * countglobals() / indextoglobal(n): the global table in declaration order —
   * its count (0x42a730) and the NAME of the n-th (0x42a6a0 -> 0x449c70, a
   * string), n an integer in 1..count or error 0xa.
   */
  r("countglobals", () => interp.globals.size);
  r("indextoglobal", (_i, [n]) => {
    const i = toNum(n ?? 0);
    const names = [...interp.globals.keys()];
    if (i < 1 || i > names.length) throw new ScriptError(0xa, `indextoglobal(${i}): ${names.length} globals`);
    return names[i - 1];
  });

  /**
   * machinespeed(): not a speed — `GetSystemInfo`'s dwProcessorType (0x42a410 ->
   * 0x432b60), 386 when KERNEL32 will not say. Every x86 Windows since reports
   * 586 (PROCESSOR_INTEL_PENTIUM), which is the answer here.
   */
  r("machinespeed", () => 586);

  /**
   * type(v): the tag's name — "logic", "text", "number", else "unknown"
   * (0x42a780, strings at 0x45bfd8/0x45bfe8/0x45bfe0/0x45bfcc).
   */
  r("type", (_i, [v]) => typeName(v));

  /**
   * The network, as TI.EXE runs without one. `netconnect()` asks its plugin
   * table for "network" (0x407ed0 -> 0x438110) and, finding none, answers
   * nothing and stays offline; `networkon()` is that state as a boolean
   * (0x408670, the word at 0x4602e0); and every other net command refuses to run
   * offline with error 0x3a, "Network error" (0x408070, 0x4080c0, 0x408280,
   * 0x408300, 0x4086a0, 0x408740, 0x4087d0, 0x408810, 0x408870).
   */
  r("netconnect", () => {});
  r("networkon", () => false);
  for (const cmd of [
    "netdisconnect", "netbroadcast", "netjoingroup", "netleavegroup",
    "netcountmembers", "netindextomember", "netourid", "netmessagesender", "netmessagegroup",
  ]) {
    r(cmd, () => {
      throw new ScriptError(0x3a, `${cmd}: not connected`);
    });
  }

  /**
   * pluginexists(name): is a plugin of that name loaded — TI.EXE's own table of
   * the plugins it found at start (0x436f70 -> 0x438110), as a boolean. Here the
   * plugins are the ones this port answers for (builtins/plugins.ts).
   */
  const PLUGINS = new Set(["xray", "camera", "checkmove", "scrollflat"]);
  r("pluginexists", (_i, [n]) => {
    if (typeof n !== "string") throw new ScriptError(0xe, "pluginexists wants a name");
    return PLUGINS.has(foldAscii(n));
  });

  /**
   * soundrate(name): the sampling rate of a sound in an open bank (0x427620 ->
   * 0x427d10), error 0xa when no open bank has it (0x427de4).
   */
  r("soundrate", (_i, [n]) => {
    const audio = session.audioLib.sound(toStr(n ?? ""));
    if (!audio) throw new ScriptError(0xa, `soundrate: no sound ${toStr(n ?? "")}`);
    return audio.sampleRate;
  });

  /**
   * themepan(track[, pan]): a track's pan, 0..255 — the word at +6 of its
   * channel records (setter 0x4273a0, getter 0x427710 -> 0x426650, de build).
   * The setter clamps to 0..255 (0x42741c) and pans the chunks of the track
   * now playing (0x426660), so the theme channel moves if it is that track.
   */
  const pans = new Map<string, number>();
  r("themepan", (_i, [track, pan]) => {
    const key = foldAscii(toStr(track ?? ""));
    if (pan === undefined) return pans.get(key) ?? 128;
    const p = Math.max(0, Math.min(255, toNum(pan)));
    pans.set(key, p);
    const playing = session.audioLib.trackNameOf(session.currentThemeName) ?? foldAscii(session.currentThemeName);
    if (playing === (session.audioLib.trackNameOf(key) ?? key)) session.themeHandle?.place?.(1, panFrom255(p));
  });
}
