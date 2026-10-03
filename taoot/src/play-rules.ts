/**
 * The play page's rules that need no page: how a pointer lands on the
 * framebuffer, what a key is called when it reaches the game, the original's
 * gamma keys and the brightness presets they share a value with, which picture
 * mode a stored answer means, what the save dialog offers as a name, and the two
 * phrases the input log (#178) closes every line with.
 *
 * Out of `main.ts`, which runs on import and owns the DOM, so each of these can
 * be held to its answer in node (taoot/tests/auto/play-rules.ts).
 */
import { isPictureMode, type PictureMode } from "@dreamfactory/engine/runtime/session";
import {
  ALL_CHANNELS,
  DEFAULT_SCREEN_GAMMA,
  SCREEN_GAMMA_STEP,
  type GammaChannels,
} from "@dreamfactory/engine/web/screen-gamma";
import type { Gate } from "./input-log";

/** a pointer event mapped to framebuffer pixels: the canvas IS the framebuffer, and CSS stretches it */
export function canvasPoint(
  e: { clientX: number; clientY: number },
  rect: { left: number; top: number; width: number; height: number },
  size: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: Math.floor(((e.clientX - rect.left) / rect.width) * size.width),
    y: Math.floor(((e.clientY - rect.top) / rect.height) * size.height),
  };
}

/**
 * Browser key -> the name the engine sees, the window proc's whole job.
 *
 * TI.EXE names only these four (they are the only key-name strings in the
 * binary); every other key reaches a script as its literal character. ESC is
 * one of those: its window-proc case (0x41ad68) hands it on as `.` with the
 * special-key marker set. Nothing in the scripts tests for it — deciding what
 * `.` means belongs to whoever is modal, and while a movie plays that is the
 * movie (see MoviePlayer.key).
 */
export const DF_KEY: Record<string, string> = {
  ArrowLeft: "leftarrow",
  ArrowRight: "rightarrow",
  ArrowUp: "uparrow",
  ArrowDown: "downarrow",
  Escape: ".",
};

/** what a key is called at a full-screen overlay stage: its DF name, a letter, or nothing */
export const overlayKey = (key: string): string => DF_KEY[key] ?? (key.length === 1 ? key.toLowerCase() : "");

/**
 * TI.EXE's 0x1fa0 marker: the key is ESC, or was held with Ctrl. The movie key
 * filter requires it, so a plain "." typed at a movie is not an abort.
 */
export const isSpecialKey = (e: { key: string; ctrlKey: boolean }): boolean => e.key === "Escape" || e.ctrlKey;

/**
 * The original's display-gamma keys, by virtual key — TI.EXE's WM_KEYDOWN jump
 * table at 0x41b118 (byte index 0x41b158, key = VK - 0x1b), whose F1-F9 arms all
 * call 0x41b210 with a direction and one flag per colour channel.
 *
 * F1 BRIGHTENS and F2 darkens, which is the right way round even though it reads
 * backwards: the value is an exponent, F1 divides it by 1.05, and a smaller
 * exponent lifts a colour. The manual names the pair as Ctrl+F1/Ctrl+F2 — the code
 * dispatches on the virtual key alone, with no Ctrl test on these arms, so Ctrl
 * makes no difference and both work.
 */
export const GAMMA_KEYS: Record<string, { up: boolean; ch: GammaChannels } | "reset"> = {
  F1: { up: false, ch: ALL_CHANNELS },
  F2: { up: true, ch: ALL_CHANNELS },
  F3: { up: false, ch: [true, false, false] },
  F4: { up: true, ch: [true, false, false] },
  F5: { up: false, ch: [false, true, false] },
  F6: { up: true, ch: [false, true, false] },
  F7: { up: false, ch: [false, false, true] },
  F8: { up: true, ch: [false, false, true] },
  F9: "reset",
};

/**
 * The brightness presets — the touch half of the original's F1/F2.
 *
 * Three of them, not a slider. This shipped as a slider first and a slider is the
 * wrong control for a thumb: the value it sets is an exponent nobody can reason
 * about, and hitting a 9rem groove on a phone is a drag gesture where a tap would
 * do. Three named choices are one tap each, and the keys stay there for anyone who
 * wants finer control.
 *
 * The offsets are counted in KEYPRESSES — six of the original's own 1.05 steps
 * either side of the default — so the presets and F1/F2 are the same setting rather
 * than two, and pressing the keys lands on a preset every sixth time. Neither end
 * goes past 1.0, i.e. neither is darker than the palette bytes on disc: the darkest
 * thing this offers is still a lift, which is what the original's default is.
 */
export const BRIGHTNESS_PRESETS: Record<string, number> = {
  darker: -6,
  default: 0,
  brighter: 6,
};

/** the gamma `steps` keypresses of F1 away from the default */
export const gammaFor = (steps: number): number => DEFAULT_SCREEN_GAMMA / Math.pow(SCREEN_GAMMA_STEP, steps);

/** the preset a gamma IS, or "" when the keys have put it between two */
export function presetOf(gamma: number): string {
  for (const [name, steps] of Object.entries(BRIGHTNESS_PRESETS)) {
    if (Math.abs(gamma - gammaFor(steps)) < 1e-6) return name;
  }
  return "";
}

/**
 * The picture mode a stored answer means: the dropdown's own key, or the
 * checkbox it used to be — whose `"1"` meant "always sharp", and a player who
 * ticked it keeps that answer — or the original.
 */
export function pictureModeOf(stored: string | null, legacySharp: string | null): PictureMode {
  const value = stored === null && legacySharp === "1" ? "sharp" : stored;
  return isPictureMode(value) ? value : "original";
}

/** the name the save dialog offers: the room, and the minute */
export function defaultSaveName(setFile: string, d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
  return `${setFile || "game"} - ${stamp}`;
}

/** what {@link whereLine} reads, all of it optional the way the page has it */
export interface WhereNow {
  intro: boolean;
  movie: string | null;
  flat: string;
  viewShowing: boolean;
  set: string;
  scene: string;
  view: string;
  stageOpen: boolean;
  stage: string;
}

/** where the game is standing, in one phrase — the tail of every logged input line */
export function whereLine(w: WhereNow): string {
  // the intro is not a room and has none behind it, and it is the one screen
  // where "what did ESC do" is the whole question (#171)
  if (w.intro) return "the Nightdive intro";
  // a film is what is on screen while it plays, whatever is open behind it
  if (w.movie) return w.movie;
  const flat = w.flat !== "none" ? ` · flat "${w.flat}"` : "";
  if (w.viewShowing) return `${w.set} — ${w.scene} / ${w.view}${flat}`;
  // a stage with no room behind it: the demo's menu, the deck map, the Enigma
  if (w.stageOpen) return `${w.stage}${flat}`;
  return "no room open";
}

/**
 * What will happen to a gesture arriving right now — the same question
 * `KEY_SAFE` asks the page in a speedrun, asked in TypeScript.
 *
 * `movingCamera` is a press FILED (`SetViewer.keyDown` posts it coalescing) and
 * `inputLocked` without it is a press GONE, and the difference between those two
 * is exactly the fade gap that eats gestures. The order is KEY_SAFE's, and the
 * order is the whole of it: a film TAKES a key (that is how a cutscene is
 * skipped) and a conversation takes one, so either of those outranks the camera.
 * Measured the other way round first — every gesture through the boot's logos
 * came out "queued behind a camera move", including the Space that skipped one.
 */
export function gateOf(
  viewer: { moviePlaying: boolean; conversing: boolean; inputLocked: boolean } | null | undefined,
  movingCamera: boolean,
): Gate {
  if (!viewer) return "none";
  if (viewer.moviePlaying || viewer.conversing) return "ready";
  if (movingCamera) return "queued";
  return viewer.inputLocked ? "locked" : "ready";
}
