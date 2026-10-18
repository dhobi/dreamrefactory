import { ScriptError, Value } from "../interp";
import { BuiltinCtx } from "./context";
import { v5Registrar } from "./df5";

/**
 * RedJack.exe's virtual-key name table, 0x4c1958..0x4c1d58: 256 pointers, one
 * per VK code, each to a length byte (filled in on first use by 0x468db0) and
 * the C string after it. A code with a null pointer has no name; 0xff's points
 * at an empty string, so `key ("")` asks VK 0xff. Extracted from the exe, not
 * typed: engine/tests/df5-ui.ts reads the table out of RedJack.exe again and
 * checks this against it.
 */
export const DF5_VK_NAMES: Readonly<Record<number, string>> = {
  0x01: "button", 0x02: "rbutton", 0x03: "break", 0x04: "mbutton", 0x08: "backspace", 0x09: "tab",
  0x0c: "clear", 0x0d: "return", 0x10: "shift", 0x11: "control", 0x12: "menu", 0x13: "pause",
  0x14: "capslock", 0x1b: "escape", 0x20: "space", 0x21: "pgup", 0x22: "pgdn", 0x23: "end",
  0x24: "home", 0x25: "left", 0x26: "up", 0x27: "right", 0x28: "down", 0x29: "select",
  0x2a: "print", 0x2b: "execute", 0x2c: "snapshot", 0x2d: "insert", 0x2e: "delete", 0x2f: "help",
  0x5b: "lwin", 0x5c: "rwin", 0x5d: "apps",
  0x60: "numpad0", 0x61: "numpad1", 0x62: "numpad2", 0x63: "numpad3", 0x64: "numpad4",
  0x65: "numpad5", 0x66: "numpad6", 0x67: "numpad7", 0x68: "numpad8", 0x69: "numpad9",
  0x6a: "multiply", 0x6b: "add", 0x6c: "separator", 0x6d: "subtract", 0x6e: "decimal", 0x6f: "divide",
  0x70: "f1", 0x71: "f2", 0x72: "f3", 0x73: "f4", 0x74: "f5", 0x75: "f6", 0x76: "f7", 0x77: "f8",
  0x78: "f9", 0x79: "f10", 0x7a: "f11", 0x7b: "f12", 0x7c: "f13", 0x7d: "f14", 0x7e: "f15", 0x7f: "f16",
  0x80: "f17", 0x81: "f18", 0x82: "f19", 0x83: "f20", 0x84: "f21", 0x85: "f22", 0x86: "f23", 0x87: "f24",
  0x90: "numlock", 0x91: "scroll", 0xe5: "processkey",
  0xf6: "attn", 0xf7: "crsel", 0xf8: "exsel", 0xf9: "ereof", 0xfa: "play", 0xfb: "zoom",
  0xfc: "noname", 0xfd: "pa1", 0xfe: "oem_clear", 0xff: "",
};

/** the US layout's `VkKeyScan`: the VK code in the low byte (shift state dropped) */
const US_PUNCT: Record<string, number> = {
  ")": 0x30, "!": 0x31, "@": 0x32, "#": 0x33, $: 0x34, "%": 0x35, "^": 0x36, "&": 0x37, "*": 0x38, "(": 0x39,
  ";": 0xba, ":": 0xba, "=": 0xbb, "+": 0xbb, ",": 0xbc, "<": 0xbc, "-": 0xbd, _: 0xbd, ".": 0xbe, ">": 0xbe,
  "/": 0xbf, "?": 0xbf, "`": 0xc0, "~": 0xc0, "[": 0xdb, "{": 0xdb, "\\": 0xdc, "|": 0xdc, "]": 0xdd, "}": 0xdd,
  "'": 0xde, '"': 0xde, " ": 0x20, "\b": 0x08, "\t": 0x09, "\r": 0x0d, "\n": 0x0d, "\x1b": 0x1b,
};
function vkKeyScan(ch: number): number {
  if (ch >= 0x61 && ch <= 0x7a) return ch - 0x20;
  if ((ch >= 0x41 && ch <= 0x5a) || (ch >= 0x30 && ch <= 0x39)) return ch;
  const p = US_PUNCT[String.fromCharCode(ch)];
  if (p !== undefined) return p;
  // the other control characters are control and a letter
  if (ch >= 1 && ch <= 26) return 0x40 + ch;
  // none: VkKeyScan's -1, of which 0x488c3f keeps the low byte
  return 0xff;
}

/** names as 0x469110 compares them: same length, letters folded through 0x4c0c60 */
const fold = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const same = (a: string, b: string): boolean => a.length === b.length && fold(a) === fold(b);

interface MenuItem {
  name: string;
  /** the record's three words (0x41f716): checkitem's, grayitem's, cmdkeyitem's */
  checked: number;
  grayed: number;
  cmdkey: number;
}
interface Menu {
  name: string;
  items: MenuItem[];
}

const int = (cmd: string, v: Value | undefined): number => {
  if (typeof v !== "number") throw new ScriptError(0xe, `${cmd}: ${String(v)} is not an integer`);
  return v | 0;
};
// 0x410560: a string, or 0xe
const str = (cmd: string, v: Value | undefined): string => {
  if (typeof v !== "string") throw new ScriptError(0xe, `${cmd}: ${String(v)} is not a string`);
  return v;
};
// a v5 boolean is 1/0 (Interpreter.bool), so the exe's `cmp word [arg], 2`
// can only turn a string away here
const bool = (cmd: string, v: Value | undefined): number => {
  if (typeof v === "string" || v === undefined) throw new ScriptError(0xe, `${cmd}: ${String(v)} is not a boolean`);
  return v ? 1 : 0;
};

/**
 * DreamFactory 5's menus, keys and scripts, each read out of `RedJack.exe`
 * (`redjack/tools/rjdis.mts cmd NAME`). Every one answers only in a v5 game.
 */
export function registerDf5UiBuiltins(ctx: BuiltinCtx): void {
  registerMenus(ctx);
  registerKey(ctx);
  registerProfile(ctx);
  registerRoomQueries(ctx);
  registerThemeExists(ctx);
}

/**
 * menu.c's model (0x41f410..0x420a70): up to 64 menus (the count at
 * 0x4c7f58, their handles from 0x4c7f60), each a count, its name as a
 * Pascal string of at most 127 and an array of 0x86-byte items — three words
 * (checked, grayed, the command key) and the item's name, also kept to 127.
 * Every lookup is by name, case folded, the first that matches.
 *
 * Only `drawmenus` (0x41f780 → 0x420a70) and `clearmenus` touch Windows,
 * building the menu bar out of these and destroying it. The port has no
 * native menu bar for a v5 game (`menuvisible` round-trips its flag,
 * builtins/helpers.ts), so the model is all there is: what the scripts read
 * back answers as the exe's does, and nothing is drawn. RedJack's `boot ()`
 * builds its debug menus here and `menuvisible (isdebugging ())` keeps the
 * bar hidden, which the port's would be too.
 */
function registerMenus(ctx: BuiltinCtx): void {
  const r5 = v5Registrar(ctx);
  const menus: Menu[] = [];
  const menuNamed = (name: string): Menu => {
    const m = menus.find((x) => same(x.name, name));
    if (!m) throw new ScriptError(0xa, `no menu ${JSON.stringify(name)}`);
    return m;
  };
  const itemNamed = (m: Menu, name: string): MenuItem => {
    const it = m.items.find((x) => same(x.name, name));
    if (!it) throw new ScriptError(0xa, `no item ${JSON.stringify(name)} in menu ${JSON.stringify(m.name)}`);
    return it;
  };

  // createmenu (name): a new, empty menu (0x41f420); a name already made, or a
  // 65th menu, is 0xa
  r5("createmenu", (_i, [name]) => {
    const n = str("createmenu", name);
    if (menus.some((x) => same(x.name, n))) throw new ScriptError(0xa, `createmenu: ${JSON.stringify(n)} already made`);
    if (menus.length >= 64) throw new ScriptError(0xa, "createmenu: 64 menus");
    menus.push({ name: n.slice(0, 127), items: [] });
    return 0;
  });
  // appenditem (menu, item): an item at the menu's end, unchecked, not grayed
  // and with no command key (0x41f580); an item the menu already has is 0xa
  r5("appenditem", (_i, [menu, item]) => {
    const mn = str("appenditem", menu);
    const n = str("appenditem", item);
    const m = menuNamed(mn);
    if (m.items.some((x) => same(x.name, n))) throw new ScriptError(0xa, `appenditem: ${JSON.stringify(n)} already in ${mn}`);
    m.items.push({ name: n.slice(0, 127), checked: 0, grayed: 0, cmdkey: 0 });
    return 0;
  });
  // drawmenus (): the menu bar built from the model (0x41f780 → 0x420a70);
  // there is none to build here
  r5("drawmenus", () => 0);
  // clearmenus (): the bar destroyed and every menu freed (0x41f7a0)
  r5("clearmenus", () => {
    menus.length = 0;
    return 0;
  });
  // changeitem (menu, item, newname): renamed, kept to 127 (0x41ff10); nothing
  // checks the new name against the others
  r5("changeitem", (_i, [menu, item, to]) => {
    const mn = str("changeitem", menu);
    const n = str("changeitem", item);
    const m = menuNamed(mn);
    const name = str("changeitem", to);
    itemNamed(m, n).name = name.slice(0, 127);
    return 0;
  });
  /**
   * checkitem and grayitem: with three arguments (menu, item, flag) a
   * statement that sets the item's first or second word (0x41f830,
   * 0x41fa70 — the flag must be a boolean, 0xe), with two a value that answers
   * it as a boolean (0x420170, 0x420360).
   */
  const flagItem = (cmd: string, field: "checked" | "grayed") =>
    r5(cmd, (i, args) => {
      const mn = str(cmd, args[0]);
      const n = str(cmd, args[1]);
      if (args.length >= 3) {
        const v = bool(cmd, args[2]);
        itemNamed(menuNamed(mn), n)[field] = v;
        return 0;
      }
      return i.bool(itemNamed(menuNamed(mn), n)[field] !== 0);
    });
  flagItem("checkitem", "checked");
  flagItem("grayitem", "grayed");
  /**
   * cmdkeyitem (menu, item, key): the item's command key, the one character of
   * `key` — any other length is 0xe, wrong type, not out of range (0x41fdab).
   * With two arguments the value (0x420550): the key as a one-character
   * string, which for an item never given one is the character 0.
   */
  r5("cmdkeyitem", (_i, args) => {
    const mn = str("cmdkeyitem", args[0]);
    const n = str("cmdkeyitem", args[1]);
    if (args.length >= 3) {
      const m = menuNamed(mn);
      const k = str("cmdkeyitem", args[2]);
      if (k.length !== 1) throw new ScriptError(0xe, `cmdkeyitem: ${JSON.stringify(k)} is not one character`);
      itemNamed(m, n).cmdkey = k.charCodeAt(0) & 0xff;
      return 0;
    }
    return String.fromCharCode(itemNamed(menuNamed(mn), n).cmdkey);
  });
  // countmenus (), countitems (menu): how many (0x420740, 0x420770)
  r5("countmenus", () => menus.length);
  r5("countitems", (_i, [menu]) => menuNamed(str("countitems", menu)).items.length);
  // indextomenu (n), indextoitem (menu, n): the n-th's name, n from 1, out of
  // range 0xa (0x4209e0, 0x420860)
  r5("indextomenu", (_i, [n]) => {
    const k = int("indextomenu", n);
    if (k < 1 || k > menus.length) throw new ScriptError(0xa, `indextomenu (${k}): ${menus.length} menus`);
    return menus[k - 1].name;
  });
  r5("indextoitem", (_i, [menu, n]) => {
    const mn = str("indextoitem", menu);
    const k = int("indextoitem", n);
    const m = menuNamed(mn);
    if (k < 1 || k > m.items.length) throw new ScriptError(0xa, `indextoitem (${mn}, ${k}): ${m.items.length} items`);
    return m.items[k - 1].name;
  });
}

/**
 * key (name): is that key held NOW (0x419520 → 0x488be0). The name is looked
 * up in the VK name table ({@link DF5_VK_NAMES}), its index the VK code;
 * failing that a one-character name goes through `VkKeyScan`, and any other
 * answers false. Then `GetAsyncKeyState (vk) < 0`: the page keeps the held
 * keys ({@link GameSession.keysDown}), the space bar its own way as well
 * (the phone's SPACE button), and the mouse buttons are the pointer's.
 */
function registerKey(ctx: BuiltinCtx): void {
  const { session } = ctx;
  const r5 = v5Registrar(ctx);
  r5("key", (i, [name]) => {
    const n = str("key", name);
    let vk = -1;
    for (let k = 0; k < 256; k++) {
      const known = DF5_VK_NAMES[k];
      if (known !== undefined && same(known, n)) {
        vk = k;
        break;
      }
    }
    if (vk < 0) {
      if (n.length !== 1) return i.bool(false);
      vk = vkKeyScan(n.charCodeAt(0) & 0xff);
    }
    const held =
      session.keysDown.has(vk) ||
      (vk === 0x20 && session.spaceDown) ||
      (vk === 0x01 && session.pointerDown && session.pointerButton === 1) ||
      (vk === 0x02 && session.pointerDown && session.pointerButton === 2);
    return i.bool(held);
  });
}

/**
 * profilestart (n) and profilestop (n): ten stopwatches, n in 1..10 (0xa
 * outside, 0xe for a non-integer). profilestart notes the engine clock
 * (0x4086e0 → 0x469f30, milliseconds) in slot n; profilestop answers the
 * milliseconds since, and since the clock's start for a slot never started
 * (0x417770). It stops nothing.
 */
function registerProfile(ctx: BuiltinCtx): void {
  const { session } = ctx;
  const r5 = v5Registrar(ctx);
  const started = new Array<number>(11).fill(0);
  const slot = (cmd: string, n: Value | undefined): number => {
    const k = int(cmd, n);
    if (k < 1 || k > 10) throw new ScriptError(0xa, `${cmd} (${k})`);
    return k;
  };
  r5("profilestart", (_i, [n]) => {
    started[slot("profilestart", n)] = session.clock.now;
    return 0;
  });
  r5("profilestop", (_i, [n]) => Math.trunc(session.clock.now - started[slot("profilestop", n)]));
}

/** the open room's scenes, roads and quads */
function registerRoomQueries(ctx: BuiltinCtx): void {
  const { session } = ctx;
  const r5 = v5Registrar(ctx);
  // the room commands: with no room open each is 0x28 before it reads an
  // argument (0x4c78d8 is clear)
  const room = (cmd: string) => {
    const m = session.maze;
    if (!m) throw new ScriptError(0x28, `${cmd}: no room open`);
    return m;
  };
  /**
   * scenewarm (name) and roadwarm (road): load a node's or a scene's pictures
   * (0x4437e0, the name looked up among the scenes and nodes, 0x444420 kind
   * 3), or every film of a road (0x443f80, kind 0), into memory and let them
   * go again — the room's cache warmed ahead of the walk. A name the room does
   * not have is 0xa. The browser decodes a picture when it is first drawn, so
   * past the checks there is nothing to do.
   */
  r5("scenewarm", (_i, [name]) => {
    const m = room("scenewarm");
    const n = str("scenewarm", name);
    if (!m.sett.nodes.some((x) => same(x.name, n)) && !m.sett.scenes.some((x) => same(x.name, n)))
      throw new ScriptError(0xa, `scenewarm: no scene or node ${JSON.stringify(n)}`);
    return 0;
  });
  const roadNamed = (cmd: string, m: NonNullable<typeof session.maze>, n: string) => {
    const road = m.sett.roads.find((x) => same(x.name, n));
    if (!road) throw new ScriptError(0xa, `${cmd}: no road ${JSON.stringify(n)}`);
    return road;
  };
  r5("roadwarm", (_i, [name]) => {
    const m = room("roadwarm");
    roadNamed("roadwarm", m, str("roadwarm", name));
    return 0;
  });
  /**
   * launchroad (road, forward, n) (0x441af0): the road by name (kind 0, else
   * 0xa), a boolean (0xe), an integer above 0 (0xe, 0xa); it warms every
   * road's films as roadwarm does (0x441bd2 .. 0x441cbb) and hands the road's
   * film one way or the other — `forward` picks the record's +20, else its +24
   * (0x441cce) — and n to 0x439620, which plays it in the frame loop's road mode
   * (MazeRuntime.launchRoad, roadStep). A road record with no film that way
   * round would hand 0x439620 nothing to play; the port logs it and plays
   * nothing. No RedJack script calls it.
   */
  r5("launchroad", (_i, [name, forward, n]) => {
    const m = room("launchroad");
    const road = roadNamed("launchroad", m, str("launchroad", name));
    const fwd = bool("launchroad", forward);
    const ahead = int("launchroad", n);
    if (ahead <= 0) throw new ScriptError(0xa, `launchroad: ${String(n)}`);
    const film = road.ends[fwd ? 0 : 1];
    if (!film?.frames.length) session.onLog(`launchroad ${road.name}: no film ${fwd ? "forward" : "back"}`);
    else m.launchRoad(film, ahead);
    return 0;
  });
  /**
   * countquads () and indextoquad (n): the room's quads (the BLI3 block whose
   * handle is at 0x4c7968; its count at +0x18, 80-byte records with the name
   * at +0x1c) — the count (0x4462a0), and the n-th's name, n from 1, 0xa
   * outside (0x446370).
   */
  r5("countquads", () => room("countquads").sett.quads.length);
  r5("indextoquad", (_i, [n]) => {
    const m = room("indextoquad");
    const k = int("indextoquad", n);
    const q = m.sett.quads;
    if (k < 1 || k > q.length) throw new ScriptError(0xa, `indextoquad (${k}): ${q.length} quads`);
    return q[k - 1].name;
  });
}

/**
 * themeexists (name) (0x448810): whether an open track file calls itself
 * that — the table at 0x4c7884 holds one 0x234-byte record per
 * `opentrackfile`, its track name at +0x1c copied from the file's header
 * (0x446cbd). By the track's name alone, not the file's.
 */
function registerThemeExists(ctx: BuiltinCtx): void {
  const { session } = ctx;
  const r5 = v5Registrar(ctx);
  r5("themeexists", (i, [name]) => i.bool(session.audioLib.hasTrackName(str("themeexists", name))));
}
