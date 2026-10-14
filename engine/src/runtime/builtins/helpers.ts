import { Builtin, ScriptError, Value, toNum, toStr, truthy } from "../interp";
import { bearingV5, engineBearing } from "../geometry";
import { BuiltinCtx } from "./context";
import { packPoint, pointX, pointY, s16 } from "../point";
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

/**
 * DF.EXE's `findword` with a separator (0x42d430), and its one quirk: the scan
 * ends a word at a separator OR at the last position a separator could start
 * (0x42d50b: no match, but `last` reached), and the word then runs up to that
 * position, not to the end of the string. So a final word with no separator
 * after it loses as many characters as the separator has: `findword ("ab cd",
 * " ", 2)` is "c", `findword ("a b c", " ", 3)` is "". Dust's scripts never
 * trip it — every list they build or spell out ends in its separator
 * (`mainboard`, `"1 2 5 "`, `combo`, decodemove's `"-2 2 "`), and so does the
 * checkers DLL's answer. TI.EXE and tl.exe append the separator first (0x42b446
 * / 0x43ab86), which is what our plain split does. An idx of 0 or less is the
 * first word (it counts down to <= 0 at the first stop); a source shorter than
 * the separator has no word at all.
 */
export function findwordV1(str: string, delim: string, idx: number): string {
  const d = delim.length;
  const last = str.length - d + 1;
  const sep = delim.toLowerCase();
  let start = 0;
  let k = idx;
  for (let pos = 0; pos < last; pos++) {
    if (str.slice(pos, pos + d).toLowerCase() === sep || pos === last - 1) {
      if (--k <= 0) return str.slice(start, pos);
      start = pos + d;
    }
  }
  return "";
}

/** floor(√n) of an unsigned 32-bit n — TI.EXE 0x436100, DF.EXE 0x430650 (exact in doubles) */
export function isqrt32(n: number): number {
  return Math.floor(Math.sqrt(n >>> 0));
}

export function registerHelperBuiltins(ctx: BuiltinCtx): void {
  const { session, interp, r } = ctx;

  // findword("a,b,c", ",", 2) -> "b": a word list is a string split on a
  // separator, and the idx is 1-based.
  //
  // An EMPTY delimiter is a mode of its own — the idx-th CHARACTER — and not a
  // default separator of space. TI.EXE says so
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
    if (session.isV1) return findwordV1(str, toStr(delim), i);
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
    if (interp.classic) {
      // DF.EXE 0x42d710 appends the separator before it counts (0x42d7bb), so
      // "" is one empty word and "a,b," three; a word past the last one is no
      // replacement at all and the answer is "" (0x42d823 -> 0x42d96e). TI.EXE
      // 0x42b7a3 and tl.exe the same. The appended separator is taken off
      // again (0x42d839) — a replaced last word keeps none.
      const parts = str.split(sep);
      if (at >= parts.length) return "";
      parts[at] = w;
      return parts.join(sep);
    }
    const parts = str === "" ? [] : str.split(sep);
    while (parts.length <= at) parts.push("");
    parts[at] = w;
    return parts.join(sep);
  });
  r("stringlength", (_i, [s]) => toStr(s ?? "").length);
  /**
   * variable(name[, val]): access a variable by COMPUTED name — getter with one
   * argument, setter with two. TAOOT's blackjack tracks per-side state this way
   * (`variable (who @ "count")` -> playercount/dealercount, `variable (who @
   * "downcard", card)`), and Dust's crowd stores an actor's walk phase under its
   * own instance name (`variable (me, 1)`, extra.cst).
   *
   * The name resolves the way a name written out in full does — the running
   * block's LOCALS first, then the globals ({@link Interpreter.getVar}) — and not
   * against the global table alone, which is what this read. Dust's poker is
   * where the difference is the whole game: `hasxkind` classifies a hand by
   * counting faces into thirteen locals and reading them back by name,
   *
   *     local card2, card3, … card14
   *     …
   *     for count = 2 to 14
   *         if variable ("card" @ numtostring (count)) = num
   *
   * so a globals-only lookup answered 0 for all thirteen and the classifier never
   * found a pair. Every hand at the showdown scored as its high card — four aces
   * came out a "straight", the hand-name prop under most hands read "nopair" —
   * while the winner still looked right, because all four hands were mis-scored
   * the same way and the comparison is between them.
   *
   * Neither half creates anything before DreamFactory 5: a name that is neither
   * a local nor a global is error 9 both ways (see the classic arm below).
   * Dust's `variable (me, 1)` reaches the bounty globals `extra.cst`'s
   * setupactor declares (`global bounty1, … bounty5`), and Titanic's computed
   * names are `who @ "…"` pairs in blkjack.stg, which the stage declares (its
   * second container: `global playertotal, playercount, …`).
   * DreamFactory 5 keeps the port's old answers: 0 for a miss, and a setter that
   * makes a global.
   */
  r("variable", (i_, [name, val], _call, frame) => {
    // Before DreamFactory 5 the name is a string or error 0xe, and a name that is
    // neither a local nor a global is error 9 both ways — the setter creates
    // nothing (TI.EXE getter 0x42b2d0, setter 0x415b20: 0x431de0, then 0x449fe0 on
    // the locals and on the globals; DF.EXE 0x42d350 / 0x420eb0 the same). Dust's
    // crowd counter is safe: extra.cst declares its five bounty globals first.
    if (i_.classic) {
      if (typeof name !== "string") throw new ScriptError(0xe, `variable: the name must be a string, got ${String(name)}`);
      const local = frame?.locals.has(name);
      if (!local && !interp.globals.has(name)) throw new ScriptError(9, `variable: no such variable ${name}`);
      if (val === undefined) return local ? frame!.locals.get(name)! : interp.globals.get(name)!;
      if (local) frame!.locals.set(name, val);
      else interp.setGlobal(name, val);
      return 0;
    }
    const key = toStr(name ?? "");
    if (val === undefined) return frame ? interp.getVar(key, frame) : interp.globals.get(key) ?? 0;
    if (frame?.locals.has(key)) frame.locals.set(key, val);
    else interp.setGlobal(key, val);
    return 0;
  });

  r("numtostring", (_i, [n]) => String(toNum(n ?? 0)));
  // No `lowmemory` here: it is no engine command (TI.EXE's table has none), and a
  // builtin of that name answered 0 to MAP.STG's and EXTRA.CST's
  // `if lowmemory ()` ahead of BOOTFILE's routine — an integer where the routine
  // returns a boolean, and never the small game.
  // heapsize(): free memory in bytes. BOOTFILE defines its own lowmemory()
  // as `heapsize() < 6144000` — and every
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
  r("currentdeg", (_i, [deg]) => {
    // DreamFactory 5 (RedJack's rooms): a heading in 2^24ths of a turn, and a
    // setter too — `gotonode` points the camera with `currentdeg (simpletodeg (head))`
    const maze = session.maze;
    if (maze) {
      if (deg === undefined) return maze.heading;
      maze.setHeading(toNum(deg));
      return;
    }
    const moving = session.movingDeg();
    if (moving !== null) return moving;
    const lis = session.listener();
    return lis ? lis.deg & 0xff : -1;
  });
  // calcdeg(fromPacked, toPacked): bearing between two packed (x<<16|y)
  // points in the engine's 0..255 angle space (turntodeg targets)
  r("calcdeg", (_i, [from, to, x2, y2]) => {
    // DreamFactory 5: four coordinates, not two packed points, and a heading in
    // 2^24ths of a turn — RedJack.exe 0x4184f0 → 0x41df00:
    // `ftol(atan2 (y2 - y1, x2 - x1) * 16777216 / 2π) & 0xffffff`
    if (session.isV5) {
      return bearingV5(toNum(x2 ?? 0) - toNum(from ?? 0), toNum(y2 ?? 0) - toNum(to ?? 0));
    }
    // signed halves, for the reason spelled out on calcdist below
    const fx = pointX(toNum(from ?? 0));
    const fy = pointY(toNum(from ?? 0));
    const tx = pointX(toNum(to ?? 0));
    const ty = pointY(toNum(to ?? 0));
    // the engines' table, not atan2 (TI.EXE 0x429e70 -> 0x43d450 -> 0x43d480)
    return engineBearing(tx - fx, ty - fy);
  });
  // calcmod(a, b): the remainder of `idiv` — the sign of `a` (TI.EXE 0x429af0,
  // tl.exe 0x439230; DF.EXE has no calcmod, its 20082 is `cacheinfo`). TAOOT's
  // one use, the bridge wheel's getpropdeg, passes 0..255, where the sign never
  // shows. By 0 the engines divide anyway (TI.EXE 0x429b4d, tl.exe 0x43928d):
  // the CPU faults and Windows ends the game — session.engineFault.
  // DreamFactory 5 keeps the non-negative modulo it had.
  r("calcmod", (i_, [a, b]) => {
    const m = toNum(b ?? 0);
    if (m === 0) {
      if (!i_.classic) return 0;
      return session.engineFault({ kind: "divide error", where: `calcmod(${toNum(a ?? 0)}, 0)` }).then(() => 0);
    }
    if (i_.classic) return toNum(a ?? 0) % m | 0;
    return ((toNum(a ?? 0) % m) + m) % m;
  });
  // primitives behind the cast library's distance/facing helpers (TAOOT's
  // realdist()):
  // playerxyz(4) = the camera's packed ground position, calcdist between
  // two packed (x<<16|y) points
  r("playerxyz", (_i, [axis]) => listenerAxis(axis));
  /**
   * The halves are SIGNED, as {@link packPoint} says and as everything else that
   * reads a packed point already assumes.
   *
   * They were decoded unsigned here, on the grounds that world coordinates run
   * 0..65535 and the TAOOT corpus never passes a negative point. The first half
   * is not true of Dust and the second was only ever a statement about TAOOT.
   * `INVEN.PRP/0294 setupprop ()` puts the Yunni book on Oona's bed at
   *
   *     propxyz (me, -28, 138, 60)
   *
   * so `realdist ("yunnibook")` — `calcdist (propxyz (me, 4), playerxyz (4))` —
   * read −28 as 65508 and answered **65124** against a `hotdist ()` of 640. The
   * book could not be picked up from anywhere in the room: `stdmouse ()` fell
   * through its distance gate and the click did nothing at all, silently.
   *
   * `calcdeg` above decodes the same pair and had the same bug; a bearing
   * computed from 65508 instead of −28 points the wrong way round.
   */
  r("calcdist", (_i, [a, b, c, d]) => {
    // DreamFactory 5: `calcdist (x1, y1, x2, y2)`, in floating point and
    // truncated — RedJack.exe 0x4185c0 → 0x41df70
    if (session.isV5) {
      return Math.trunc(Math.hypot(toNum(a ?? 0) - toNum(c ?? 0), toNum(b ?? 0) - toNum(d ?? 0)));
    }
    const ax = pointX(toNum(a ?? 0));
    const ay = pointY(toNum(a ?? 0));
    const bx = pointX(toNum(b ?? 0));
    const by = pointY(toNum(b ?? 0));
    // TI.EXE 0x429f20 (DF.EXE 0x42c070 the same): the halves' differences
    // squared and summed in 32-bit registers, then 0x436100's integer square root
    // of that as UNSIGNED — floor, never rounded — and the low word of it
    const dx = bx - ax;
    const dy = by - ay;
    return isqrt32((Math.imul(dx, dx) + Math.imul(dy, dy)) >>> 0) & 0xffff;
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
  /**
   * DreamFactory 5's are floating point over the whole 32 bits: RedJack.exe's
   * cores (0x4356e0 for x, 0x435710 for y) are `ftol (mag * cos (angle * 2π *
   * 2^-24))` — a heading in 2^24ths of a turn, as `currentdeg` answers there, and
   * no table and no 16-bit magnitude. The v4 form masked RedJack's headings to
   * their low byte, so every `calcvectx (currentdeg (), …)` pointed anywhere:
   * walkandtalk's meeting point, the cannon's ball.
   */
  const vecComponentV5 =
    (trig: (rad: number) => number) =>
    (_i: unknown, [angle, mag]: Value[]) =>
      Math.trunc(toNum(mag ?? 0) * trig(toNum(angle ?? 0) * 2 * Math.PI * 5.960464477539063e-8));
  const byEngine = (v4: Builtin, v5: Builtin): Builtin => (i, args, call, frame) =>
    (session.isV5 ? v5 : v4)(i, args, call, frame);
  r("calcvectx", byEngine(vecComponent(Math.cos), vecComponentV5(Math.cos)));
  r("calcvecty", byEngine(vecComponent(Math.sin), vecComponentV5(Math.sin)));

  // currentcd([name]): the mounted CD volume. The original verified the named
  // disc (TAOOT: "Titanic1"/"Titanic2") was in the drive and returned "" if absent;
  // BOOTFILE's setpath() does `currentcd("Titanic1"); if currentcd()="" error`.
  // The web build ships all data locally, so any requested disc is always
  // "mounted": remember the last name and report it (never "") so boot proceeds.
  //
  // Remembered on the SESSION (not in this closure) because a save carries the
  // answer — see GameSession.mountedCd.
  //
  // ...except in DreamFactory 1, where id 16034 is `actorhitbox (actor, index)`
  // and `actorhitbox (actor, rz, rxy)` — the box a ball hits (runtime/balls.ts).
  // Dust's 32 calls all have that shape, and answering them as the disc wrote
  // the actor's name into mountedCd, which a save carries.
  r("currentcd", (_i, [name, a, b]) => {
    if (session.isV1) return actorHitbox(toStr(name ?? ""), a, b);
    if (name !== undefined) session.mountedCd = toStr(name);
    return session.mountedCd;
  });
  /**
   * DF.EXE 0x4131b0 (getter) and 0x4130a0 (setter). `"player"` is the player's
   * own box (0x460b68/0x460b6a), any other name an actor's (record +0x50/+0x52).
   * The getter takes 1 or 2 and answers that WORD sign-extended; any other index
   * is error 0xe, answered 0 here. The setter stores both words.
   */
  const actorHitbox = (name: string, a: Value, b: Value): Value => {
    const box = name.toLowerCase() === "player"
      ? session.balls.playerHitbox
      : session.actorRuntime.get(name)?.hitbox;
    if (!box) {
      session.onLog(`actorhitbox: no actor ${name}`);
      return 0;
    }
    if (b === undefined) {
      const i = toNum(a ?? 0);
      return i === 1 || i === 2 ? box[i - 1] : 0;
    }
    box[0] = s16(toNum(a ?? 0));
    box[1] = s16(toNum(b ?? 0));
    return 0;
  };

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
  /**
   * freemem() / sysmem() — bytes free to the application, and bytes the machine
   * has. Timelapse's alone: its BOOTFILE asks both, once, on the way into `boot`.
   *
   *     minMemory = false
   *     if freemem () / 1024 < 3595
   *         minMemory = true
   *     endif
   *     if sysmem () / 1024 < 10000
   *         minMemory = true
   *     endif
   *
   * A browser tab has no honest answer to either question, so the number is a
   * CHOICE, and the numbers below choose `minMemory = true` on purpose.
   *
   * That flag is not a quality setting. It picks between two implementations of
   * the same handler, and only one of them is built out of opcodes this port has:
   * `lefttoframe` pans between flats through `plugin("scrollflat", …)`, and
   * `lefttoframeMin` does the identical turn with `gotoflat` and
   * `visualeffect(turnhalfleft, …)`. Report a 1996-generous machine and Timelapse
   * takes the plugin path, where nothing is implemented and turning left or right
   * stops changing the picture at all. Report a tight one and it takes the path
   * that works. (`stageparam(1, 0)`/`stageparam(2, 0)` come with it, which the
   * port already round-trips.)
   *
   * So: 3 MB free of an 8 MB machine, which is under both thresholds and is a
   * configuration the game shipped support for and was tested on. This is the
   * only place to change if `scrollflat` is ever written — and see
   * engine/src/runtime/plugins.ts, where that call logs loudly for the same
   * reason.
   */
  r("freemem", () => 3 * 1024 * 1024);
  r("sysmem", () => 8 * 1024 * 1024);
  /**
   * tick(): the engine's 60 Hz counter — NOT milliseconds.
   *
   * It was milliseconds here, and the scripts say otherwise in three independent
   * places. Timelapse writes a five-second wait as `tick () - tonaltick > 60 * 5`,
   * which nobody spells that way for a millisecond clock. Its stage animator
   * paces itself with `flatstarttick + flatticknum * 60 / flatframerate - tick ()`
   * — sixty per second over frames per second is ticks per frame, and only if a
   * tick is a sixtieth. And TI.EXE's own counter (0x41de90) returns
   * `timeGetTime() * 3 / 50`, i.e. ms/16.67, which this port already relies on for
   * the wipe pacer (see GameSession.tickWipe).
   *
   * What it looked like was every paced animation running ten times too fast: the
   * sea and the grass off the opening cliffs are `flatstartanim(2, 10, "FlatAnim",
   * 6)`, six frames a second, and the delay came out negative on every pass — so
   * the loop was armed with a period of 0 and ran at the display rate instead.
   *
   * Titanic's one use gets more sensible rather than less. `blkjack.shp`'s barman
   * fidgets `if tick () - bjtime > 1200`, which is twenty seconds of the player
   * sitting still — a reasonable cue for a bigger idle animation, where 1.2
   * seconds had him tilting almost continuously. Dust asks for the value nowhere.
   */
  r("tick", () => Math.floor((session.clock.now * 3) / 50));
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
  // keyaborts — on the session, because the interpreter asks it after every
  // statement (GameSession.keyAborts, interp.ts keyAbort)
  r("keyaborts", (_i, [v]) => {
    if (v !== undefined) session.keyAborts = truthy(v);
    return session.keyAborts ? 1 : 0;
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
  const pathSlots = session.pathSlots;
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
      //
      // RedJack's `resetpaths` does the same with `"RJ" @ disk`, one disc per
      // day (`advanceday`): `path (5, "RJDisk2:movies:")`. Its three discs each
      // carry a different `death.move`, so the film you die to is the day's.
      const vol = (session.isV5 ? /^rjdisk([1-3]):/i : /^titanic([12]):/i).exec(value);
      if (vol) session.onDiscChange?.(Number(vol[1]));
    }
    return 0;
  });
}
