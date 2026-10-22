import { ESCAPE_KEY, focusOwnsKey } from "@dreamfactory/engine/web/keys";

/**
 * The arrows by v5's own key names.
 *
 * RedJack's key router (BOOTFILE container 1, `keydown`/`keyup`) keeps the four
 * directions in `permanent`s — `keynorth = "up"`, `keywest = "left"`… — and
 * rewrites whichever arrived to `uparrow`/`leftarrow` before a scene hears it.
 * Sending the short names lets that remap do its job, the way the original did.
 */
export const ARROWS: Record<string, string> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
/** and a swipe's arrows, which TouchGestures names the way v4 heard them */
export const SWIPE_ARROWS: Record<string, string> = { uparrow: "up", downarrow: "down", leftarrow: "left", rightarrow: "right" };

interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

/** what a key going down on the page is: the log's, the game's, or nobody's */
export type KeyAction = { log: true } | { key: string; special: boolean };

export function keyAction(e: KeyEventLike): KeyAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (focusOwnsKey(e.target, e.key)) return null;
  // Escape is `"."` with the special marker, which is what the film player
  // tests for (see ESCAPE_KEY)
  if (e.key === "Escape") return { key: ESCAPE_KEY, special: true };
  // `b` is the log, and `x` the Details column it sits in — Titanic's key for
  // it — and neither goes on to the game: the BOOTFILE's key router answers to
  // the arrows, space, escape and F1, and they are none of them
  if (e.key === "b" || e.key === "x" || e.key === "X") return { log: true };
  return { key: ARROWS[e.key] ?? e.key.toLowerCase(), special: false };
}

/**
 * The arrow a key coming UP releases, or null: the fight lessons lean on the
 * key held, and stop on its release.
 */
export function arrowUp(e: Pick<KeyEventLike, "key" | "target">): string | null {
  const arrow = ARROWS[e.key];
  return arrow && !focusOwnsKey(e.target, e.key) ? arrow : null;
}

/** the readout under the picture, and the bug report's line: the room, or the stage before there is one */
export function whereLine(s: {
  currentSetName: string;
  currentSceneName: () => string;
  currentViewName: () => string;
  stageName: string;
  currentFlat: string;
}): string {
  const set = s.currentSetName || "none";
  return set !== "none"
    ? `set ${set} · scene ${s.currentSceneName()} · view ${s.currentViewName()}`
    : `stage ${s.stageName} · flat ${s.currentFlat}`;
}

/** what the save dialog offers as a name: the room, and when */
export function defaultSaveName(roomFile: string, d: Date): string {
  const room = roomFile || "redjack";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${room} - ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

/** a key's physical place, `KeyboardEvent.code`, as the Windows virtual keys it holds down */
const CODE_VKS: Record<string, number[]> = {
  Backspace: [0x08], Tab: [0x09], Enter: [0x0d], NumpadEnter: [0x0d], Escape: [0x1b], Space: [0x20],
  ShiftLeft: [0x10, 0xa0], ShiftRight: [0x10, 0xa1], ControlLeft: [0x11, 0xa2], ControlRight: [0x11, 0xa3],
  AltLeft: [0x12, 0xa4], AltRight: [0x12, 0xa5], Pause: [0x13], CapsLock: [0x14],
  PageUp: [0x21], PageDown: [0x22], End: [0x23], Home: [0x24],
  ArrowLeft: [0x25], ArrowUp: [0x26], ArrowRight: [0x27], ArrowDown: [0x28],
  PrintScreen: [0x2c], Insert: [0x2d], Delete: [0x2e], Help: [0x2f],
  MetaLeft: [0x5b], MetaRight: [0x5c], ContextMenu: [0x5d],
  NumpadMultiply: [0x6a], NumpadAdd: [0x6b], NumpadSubtract: [0x6d], NumpadDecimal: [0x6e], NumpadDivide: [0x6f],
  NumLock: [0x90], ScrollLock: [0x91],
  Semicolon: [0xba], Equal: [0xbb], Comma: [0xbc], Minus: [0xbd], Period: [0xbe], Slash: [0xbf], Backquote: [0xc0],
  BracketLeft: [0xdb], Backslash: [0xdc], BracketRight: [0xdd], Quote: [0xde], IntlBackslash: [0xe2],
};

/**
 * The virtual-key codes a key going down holds, for v5's `key (name)`, which
 * asks Windows' `GetAsyncKeyState` (RedJack.exe 0x488be0): letters and digits
 * are their characters, F1 is 0x70, the numeric pad 0x60 up, and a shift key
 * holds VK_SHIFT and its own side's code both.
 */
export function heldKeys(code: string): number[] {
  const m = /^(?:Key([A-Z])|Digit(\d)|Numpad(\d)|F(\d{1,2}))$/.exec(code);
  if (m?.[1]) return [m[1].charCodeAt(0)];
  if (m?.[2]) return [0x30 + Number(m[2])];
  if (m?.[3]) return [0x60 + Number(m[3])];
  if (m?.[4] && Number(m[4]) >= 1 && Number(m[4]) <= 24) return [0x6f + Number(m[4])];
  return CODE_VKS[code] ?? [];
}
