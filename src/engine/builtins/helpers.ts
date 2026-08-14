import { Value, toNum, toStr, truthy } from "../interp";
import { bearing } from "../geometry";
import { BuiltinCtx } from "./context";
import { packPoint, s16 } from "../point";
import { decodeText, encodeText } from "../../df/text";
import { latin1 } from "../../df/binary";

/**
 * Assorted scalar helpers that live outside any object script: string/word
 * utilities (findword/putword/variable), number formatting + modulo, the
 * memory/heap stubs, per-stage scratch params, and the packed-point geometry
 * primitives (cameraxyz/playerxyz/calcdeg/calcdist) the cast library builds on.
 */

/** what `heapsize()` answers for a player who asked for the small game: under
 *  BOOTFILE's own 6144000 threshold, and not by a hair (GameSession.lowMemory) */
const SMALL_1996_HEAP = 4 * 1024 * 1024;

export function registerHelperBuiltins(ctx: BuiltinCtx): void {
  const { session, interp, r } = ctx;

  // findword("a,b,c", ",", 2) -> "b": a word list is a string split on a
  // separator, and the idx is 1-based.
  //
  // An EMPTY delimiter is a mode of its own — the idx-th CHARACTER — and not,
  // as this used to have it, a default separator of space. TI.EXE says so
  // outright: `findword`'s implementation (0x428b20 → the body at 0x428b6d)
  // branches on the delimiter's length byte, and the empty arm at 0x428c5f is
  //
  //     cmp dword [esp+0x12], 1        ; idx < 1?
  //     mov al, byte [0x489928]        ; length of the source
  //     cmp eax, dword [esp+0x12]      ; length < idx?
  //     mov byte [0x489c38], 1         ; result is ONE character long
  //     mov al, byte [eax + 0x489928]  ; source[idx]  (Pascal string: [0] is the length)
  //
  // — one character, or "" when the idx falls outside the string. Three of
  // TAOOT's own uses are unambiguous without the disassembly: the wireless
  // Morse tapper walks `for count = 1 to stringlength (sound)` and treats " "
  // as a legal value, the keypad matches one typed letter against
  // `findword ("thayer", "", stringlength (thayermess) + 1)` in a literal with
  // no spaces at all, and `extra.cst`'s `setupactor` takes a crowd star apart
  // by position — `letter = findword (where, "", 4)`, `number = findword
  // (where, "", 6)` over "ex.a.1" — to name the instance `brown1a1` (#199).
  const charMode = (delim: Value) => delim === undefined || toStr(delim) === "";
  r("findword", (_i, [s, delim, idx]) => {
    const str = toStr(s ?? "");
    const i = Number(idx) || 0;
    if (charMode(delim)) return i >= 1 && i <= str.length ? str[i - 1] : "";
    return str.split(toStr(delim))[(i || 1) - 1] ?? "";
  });
  // putword(str, delim, idx, word): replace the idx-th (1-based) word. With an
  // empty delimiter it is the character-wise counterpart, and TI.EXE's arm
  // (0x428fc0, and the out-of-range tail at 0x429045) has three cases: inside
  // the string it INSERTS the word before character idx (memmove the tail right
  // by the word's length, then write it — nothing is deleted); one past the end
  // it appends (`0x4356e0`, which appends its first argument to its second);
  // anywhere further out it yields "".
  //
  // Only the append arm is ever taken here. Every `saveprops` in the game is
  // built the same way — `saveprops = ""` and then `for count = 1 to N`, one
  // slot per pass (photo.shp, wireless.shp, and the trunk/enigma pair) — which
  // is why the strings the original wrote are dense: the shipped saves carry
  // `saveprops2 = "11111101100111110"`, 17 characters for the 17 indices the
  // scripts read back. The old space-joined form ("1 0 1 …") round-tripped
  // through our own findword and matched nothing in a save the original wrote.
  r("putword", (_i, [s, delim, idx, word]) => {
    const str = toStr(s ?? "");
    const w = toStr(word ?? "");
    const i = Number(idx) || 0;
    if (charMode(delim)) {
      if (i >= 1 && i <= str.length) return str.slice(0, i - 1) + w + str.slice(i - 1);
      return i === str.length + 1 ? str + w : "";
    }
    const sep = toStr(delim);
    const at = Math.max(1, i || 1) - 1;
    const parts = str === "" ? [] : str.split(sep);
    while (parts.length <= at) parts.push("");
    parts[at] = w;
    return parts.join(sep);
  });
  r("stringlength", (_i, [s]) => toStr(s ?? "").length);
  // variable(name[, val]): dynamic global access by computed name — getter with
  // one arg, setter with two. TAOOT's blackjack tracks per-side state this way
  // (variable(who @ "count") -> playercount/dealercount, variable(who @
  // "downcard", card)). Reads/writes the same global table as named globals.
  r("variable", (_i, [name, val]) => {
    const key = toStr(name ?? "");
    if (val === undefined) return interp.globals.get(key) ?? 0;
    interp.globals.set(key, val);
    return 0;
  });

  r("numtostring", (_i, [n]) => String(toNum(n ?? 0)));
  r("lowmemory", () => 0); // the engine's own probe; BOOTFILE shadows it (below)
  // heapsize(): free memory in bytes. BOOTFILE defines its own lowmemory()
  // (which shadows the builtin above) as `heapsize() < 6144000` — and every
  // TAOOT setupsound() case for a memory-heavy deck (decka/deckb/decke/deckf/cargo)
  // then loads the 11 kHz `.11k` bank instead of the full `.trk`, while still
  // calling playnewtheme("<deck>.trk"). Left at 0, heapsize() reported "low
  // memory", the .trk bank was never opened, and those rooms were silent.
  //
  // We run in a browser with ample memory, so the honest answer is plenty and
  // the full path runs. The player can ask for the other one — the short themes
  // and the crowdless boat deck a 1996 machine got — and then the number has to
  // be the LIE that produces it, because the branch belongs to the game's
  // scripts and not to us (GameSession.lowMemory).
  r("heapsize", () => (session.lowMemory ? SMALL_1996_HEAP : 64 * 1024 * 1024));
  // stageparam(idx[, val]): per-stage scratch parameters, getter/setter by arity
  const stageParams = new Map<number, Value>();
  r("stageparam", (_i, [idx, val]) => {
    const k = toNum(idx ?? 0);
    if (val === undefined) return stageParams.get(k) ?? 0;
    stageParams.set(k, val);
    return 0;
  });

  // helpers used around conversations that live outside any script.
  // cameraxyz and playerxyz are the SAME primitive here: the original engine
  // distinguished the player entity from the camera, but in a first-person
  // game both read the camera/listener position. Registered under both names.
  const listenerAxis = (axis: Value): Value => {
    const lis = session.listener();
    if (!lis) return 0;
    switch (toNum(axis ?? 1)) {
      case 1: return lis.x;
      case 2: return lis.y;
      case 4: return packPoint(lis.x, lis.y);
      default: return 0;
    }
  };
  r("cameraxyz", (_i, [axis]) => listenerAxis(axis));
  // currentdeg(): the camera's current heading in the engine's 0..255 bearing
  // space, or -1 when no set is loaded. It's the active view's rotation8 — the
  // very value the world→screen projection turns with — so it composes with
  // calcvectx/calcvecty: scripts place things relative to the player's facing,
  // e.g. `calcvectx(currentdeg()+64, dist)`, `if currentdeg() > 128`. TI.EXE
  // (0x408c50) returns the camera degree, or -1 if no scene is active.
  r("currentdeg", () => {
    const lis = session.listener();
    return lis ? lis.deg & 0xff : -1;
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
  // calcmod(a, b): non-negative modulo (TAOOT's bridge wheel getpropdeg maps
  // the 0..255 wheel angle into the sprite's 0..4 rotation frames)
  r("calcmod", (_i, [a, b]) => {
    const m = toNum(b ?? 0);
    if (m === 0) return 0;
    return ((toNum(a ?? 0) % m) + m) % m;
  });
  // primitives behind the cast library's distance/facing helpers (TAOOT's
  // realdist()):
  // playerxyz(4) = the camera's packed ground position, calcdist between
  // two packed (x<<16|y) points
  r("playerxyz", (_i, [axis]) => listenerAxis(axis));
  r("calcdist", (_i, [a, b]) => {
    // halves decoded UNSIGNED here (not pointX/pointY): world coordinates are
    // 0..65535 in this context and the TAOOT corpus never passes negative points
    const ax = (toNum(a ?? 0) >> 16) & 0xffff;
    const ay = toNum(a ?? 0) & 0xffff;
    const bx = (toNum(b ?? 0) >> 16) & 0xffff;
    const by = toNum(b ?? 0) & 0xffff;
    return Math.round(Math.hypot(bx - ax, by - ay));
  });

  // calcvectx(angle, mag) / calcvecty(angle, mag): the (dx, dy) components of a
  // vector of length `mag` pointing along the engine's 0..255 bearing `angle` —
  // the inverse of calcdeg/bearing (so dx uses cos, dy uses sin). Scripts build
  // world points with them, e.g. `playerxyz(1) + calcvectx(currentdeg(), dist)`
  // / `playerxyz(2) + calcvecty(currentdeg(), dist)`, and add 64 (=90°) to the
  // angle for the perpendicular.
  //
  // Recovered from TI.EXE (handlers 0x42670c/0x42672b → cores 0x43ad90/0x43adc0):
  // the component is a signed fixed-point trig lookup, `table[angle & 0xff] *
  // mag >> 14`, where the 256-entry tables (scale 2^14 = 16384) are loaded from
  // the exe's "TRIG" resources — cos for x, sin for y. The core sign-extends the
  // magnitude to 16 bits (movsx) before multiplying, and the caller sign-extends
  // the 16-bit result (movsx ax); we reproduce both. The `>> 14` is a
  // round-toward-zero divide, i.e. Math.trunc. The shipped tables equal
  // round(16384·cos/sin) to within ±1 LSB, so we compute the entry directly.
  const vecComponent =
    (trig: (rad: number) => number) =>
    (_i: unknown, [angle, mag]: Value[]) => {
      const step = ((toNum(angle ?? 0) & 0xff) * 2 * Math.PI) / 256;
      const entry = Math.round(16384 * trig(step)); // signed fixed-point table value
      return s16(Math.trunc((entry * s16(toNum(mag ?? 0))) / 16384));
    };
  r("calcvectx", vecComponent(Math.cos));
  r("calcvecty", vecComponent(Math.sin));

  // currentcd([name]): the mounted CD volume. The original verified the named
  // disc (TAOOT: "Titanic1"/"Titanic2") was in the drive and returned "" if absent;
  // BOOTFILE's setpath() does `currentcd("Titanic1"); if currentcd()="" error`.
  // The web build ships all data locally, so any requested disc is always
  // "mounted": remember the last name and report it (never "") so boot proceeds.
  let mountedCd = "";
  r("currentcd", (_i, [name]) => {
    if (name !== undefined) mountedCd = toStr(name);
    return mountedCd;
  });

  // UI dialogs + quit — delegated to host hooks (browser wires alert/confirm/
  // prompt; headless defaults are safe). notedialog: modal note (OK).
  // questiondialog: yes/no, returns 1/0 (scripts do `if questiondialog(..)=false`).
  // textdialog(prompt, initial): text entry, returns the string (debug tools).
  //
  // Every one of these is a LOCALISED script literal, so it has to be decoded
  // out of the tree's bytes on the way to the host — the same step drawstring
  // and puppetbevel take (builtins/pointer.ts). Without it the bytes reach
  // `confirm()` one character each and the player is asked a question in
  // mojibake: reported for Japanese (#105), and measured over the six shipped
  // trees as 11 strings that carry high bytes — ja 6, ru 4, fr 1 — while en, de
  // and nl happen to keep all 25 of theirs in ASCII.
  const forHost = (v: Value): string => decodeText(toStr(v ?? ""), session.textEncoding());
  r("notedialog", async (_i, [message]) => {
    await session.onNoteDialog(forHost(message));
    return 0;
  });
  r("questiondialog", async (_i, [message]) =>
    (await session.onQuestionDialog(forHost(message))) ? 1 : 0,
  );
  // ...and back the other way for what the player TYPES, because the answer
  // re-enters the game as script bytes: TAOOT's `propowner(me, textdialog(...))`
  // names the cricket, and a name left in display characters would be decoded a
  // second time when something drew it. 255 is a Pascal string's own ceiling,
  // which is where the answer ends up once a save is written.
  r("textdialog", async (_i, [prompt, initial]) => {
    const typed = await session.onTextDialog(forHost(prompt), forHost(initial));
    return latin1(encodeText(typed, session.textEncoding(), 255));
  });
  r("quit", async () => {
    await session.onQuit();
    return 0;
  });

  // machinetype(): host platform. Scripts branch `if machinetype() = "win"`; the
  // web build is the Windows engine's descendant, so report "win".
  r("machinetype", () => "win");
  // tick(): milliseconds since start (TI.EXE timeGetTime). TAOOT's blackjack
  // times the deal with `bjtime = tick(); if tick() - bjtime > 1200`. frame(): the
  // monotonic rendered-frame counter (a conversation's attentionspan = frame()).
  r("tick", () => session.clock.now);
  r("frame", () => session.frameCounter);
  // setparam(idx[, val]): per-set scratch parameters, getter/setter by arity —
  // the set-level twin of stageparam.
  const setParams = new Map<number, Value>();
  r("setparam", (_i, [idx, val]) => {
    const k = toNum(idx ?? 0);
    if (val === undefined) return setParams.get(k) ?? 0;
    setParams.set(k, val);
    return 0;
  });
  // menuvisible([v]) / keyaborts([v]): the menu-bar visibility and the
  // "keypresses abort the current action" flags. Boot sets both to `debugging`
  // (0 in normal play). The web build has no native menu bar and its own input
  // routing, so these just round-trip the flag for any getter.
  let menuVisible = 0;
  r("menuvisible", (_i, [v]) => {
    if (v !== undefined) menuVisible = truthy(v) ? 1 : 0;
    return menuVisible;
  });
  let keyAborts = 0;
  r("keyaborts", (_i, [v]) => {
    if (v !== undefined) keyAborts = truthy(v) ? 1 : 0;
    return keyAborts;
  });
  // countbevels(): number of choice bevels on the active puppet screen (a
  // conversation gates on `if countbevels() > 3`).
  r("countbevels", () => session.puppet?.bevels.length ?? 0);

  // path(n) / path(n, str): the engine's resource search-path table — 9 string
  // slots (0..8). Slot 0 is the install root (engine-set); scripts fill 1..8 via
  // BOOTFILE's setpath(), e.g. TAOOT's `path(1, path(0) @ "tour:")`, `path(3, mainpath @
  // "data:")`, `path(7, mainpath @ "<room>:")`, and the original resolved game
  // files against these Mac-style volume prefixes.
  //
  // Recovered from TI.EXE — getter 0x427fb0 (accepts n=0..8), setter 0x43dd70
  // (accepts n=1..8 only; slot 0 is not script-writable), both over a 9 x
  // 256-byte table at [0x4898b8]. The web build resolves files by basename and
  // ignores these prefixes, so the table only needs to store and return what
  // scripts set. The one logic consumer is BOOTFILE's CD-copy check
  // `if substring(path(1), "titanic1:") = 1` (refuse to run off the CD): slot 0
  // stays "", so path(1) is never the CD volume and the check passes, as on a
  // hard-drive install.
  const pathSlots: string[] = Array(9).fill("");
  r("path", (_i, [n, str]) => {
    const idx = toNum(n ?? 0);
    if (str === undefined) return idx >= 0 && idx <= 8 ? pathSlots[idx] : "";
    if (idx >= 1 && idx <= 8) {
      const value = toStr(str);
      pathSlots[idx] = value;
      // The prefixes are not resolved literally (files are found by basename),
      // but the VOLUME in them is the game telling us which CD is now mounted:
      // TAOOT's setpath(1) writes "titanic1:data:" into slot 3, setpath(2) writes
      // "titanic2:data:". 93 basenames ship on both discs — the public rooms in
      // their pre- and post-sinking state — so the host has to follow the swap
      // or half the game draws the wrong act's scenery.
      const vol = /^titanic([12]):/i.exec(value);
      if (vol) session.onDiscChange?.(Number(vol[1]) as 1 | 2);
    }
    return 0;
  });
}
