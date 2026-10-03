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
  // `b` is the log, and it does not go on to the game: the BOOTFILE's key
  // router answers to the arrows, space, escape and F1, and `b` is none of them
  if (e.key === "b") return { log: true };
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

/** framebuffer coordinates for a pointer event, against the game's 640x480 */
export function screenPoint(
  e: { clientX: number; clientY: number },
  r: { left: number; top: number; width: number; height: number },
  screen: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: Math.round(((e.clientX - r.left) / r.width) * screen.width),
    y: Math.round(((e.clientY - r.top) / r.height) * screen.height),
  };
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
