import { focusOwnsKey } from "@dreamfactory/engine/web/keys";

/** the arrows by the names Dust's boot maps (its own keydown turns W/A/D into these) */
const ARROWS: Record<string, string> = {
  ArrowUp: "uparrow",
  ArrowDown: "downarrow",
  ArrowLeft: "leftarrow",
  ArrowRight: "rightarrow",
};

/** the two other keys that go to the game under a name of their own */
const SPECIAL_KEYS: Record<string, string> = {
  " ": " ",
  Escape: ".",
};

interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
  target: EventTarget | null;
}

/** what a key going down means on the play page: the log's, the game's, or nobody's */
export type KeyAction = { log: true } | { key: string; escape: boolean; repeat: boolean };

/**
 * Keys, routed exactly as the play page routes them.
 *
 * Which matters most for the letters: Dust's boot maps `keynorth`/`keywest`/
 * `keyeast` — W, A and D — onto the arrow names itself, in its own keydown
 * handler, and then forwards to the scene. So the letters have to ARRIVE for the
 * game's own bindings to work, and dropping anything unrecognised here would
 * silently disable half of Dust's controls. Escape is `"."` with the special
 * marker, which is what the movie player tests for.
 *
 * A key typed into something on the PAGE is not the game's (engine/src/web/
 * keys.ts): this listens on `window` and takes every letter, so the speedrun
 * workbench's sheet — a `<textarea>` — could take none until it asked.
 */
export function keyAction(e: KeyEventLike): KeyAction | null {
  if (focusOwnsKey(e.target, e.key)) return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === "b" || e.key === "B") return { log: true };
  const name = ARROWS[e.key] ?? SPECIAL_KEYS[e.key] ?? null;
  const ch = name ?? (e.key.length === 1 ? e.key.toLowerCase() : "");
  if (!ch) return null;
  return { key: ch, escape: e.key === "Escape", repeat: e.repeat };
}

/** the pointer, in the engine's own 512x384 — floored, as the original's mouse is */
export function screenPoint(
  e: { clientX: number; clientY: number },
  r: { left: number; top: number; width: number; height: number },
  screen: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: Math.floor(((e.clientX - r.left) / r.width) * screen.width),
    y: Math.floor(((e.clientY - r.top) / r.height) * screen.height),
  };
}

/**
 * The name the save dialog offers: where you are, and when.
 *
 * The room rather than the day or the clock, because that is what a player
 * recognises a save by in a list of them — and the disc's own five are named the
 * same way by hand (START, DOG, GOTBONE).
 */
export function defaultSaveName(setFile: string | undefined, d: Date): string {
  const room = setFile?.replace(/\.set$/i, "") || "dust";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${room} - ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
}
