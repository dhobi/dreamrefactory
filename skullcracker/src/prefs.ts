/**
 * The preferences panel, which is fourteen controls and not three.
 *
 * `prefs2.mov` is thirty frames of a panel sliding open and then a type-1 exit.
 * It carries no regions at all, because the panel is not the film's: `0x45d5a0`
 * is a modal event loop of the executable's own, `0x45db40` draws the controls
 * over the film's last frame, and `0x45d700` is the hit test. This file is those
 * three functions' data.
 *
 * ## The fourteen rects are one table
 *
 * `0x45d640` walks `0x479188` in eight-byte steps for `bp` = 0…13 and hands the
 * index straight to `0x45d700`, which dispatches it through a byte table at
 * `0x45d7fc` into seven handlers:
 *
 * ```
 *    0…7   0x479188…0x4791c0   0x45d72f   [0x47917c] = the index   a KEY BOX
 *    8     0x4791c8            0x45d73f   xor ax, ax               OK — ends the loop
 *    9     0x4791d0            0x45d743   volume = x / 10          the SLIDER
 *   10     0x4791d8            0x45d788   [0x46b20c] =  1          EASY
 *   11     0x4791e0            0x45d79b   [0x46b20c] =  0          NORMAL
 *   12     0x4791e8            0x45d7ae   [0x46b20c] = -1          HARD
 *   13     0x4791f0            0x45d7c1   [0x46b1fc] ^= 1          MUSIC
 * ```
 *
 * Only control 8 returns zero, and `0x45d6ea` loops while the return is not zero
 * — so the wide rect across the bottom right is the one way out of the panel.
 * This page had `0x4791c8` written down as the slider; it is the OK button, and
 * the slider is the rect after it.
 *
 * ## The eight boxes are the key bindings
 *
 * `[0x47917c]` is not a setting. It is which box is SELECTED, and typing a letter
 * while the panel is open rebinds it: `0x45d6d5` uppercases the character and
 * calls `0x45d810([0x47917c], char)`, which
 *
 *   1. refuses the character outright if any of the eight already has it
 *      (`0x45d824`, the loop over actions 1…8 before the jump table);
 *   2. clears the old character's slot in the 256-byte table at `0x46b210`,
 *      writes the action number into the new character's slot;
 *   3. asks `0x40e870` for the new character's NAME, and if there is none —
 *      the character is not one the panel can draw — puts the old one back.
 *
 * So a binding is a byte in `0x46b210` indexed by the character, and the panel
 * can only ever hold a character it can name.
 *
 * ## What the eight actions are
 *
 * `0x403b90` reads `0x46b210[char]` and `0x403820` turns the action into a bit,
 * which `0x402be0` spends on one global apiece — the table in
 * {@link file://./walk.ts}'s `KEYS`. The shipped defaults are the second half of
 * `0x46b210`'s own contents, and they are the eight letters this port has been
 * using all along.
 */

/** one of the eight things a key can be bound to, in the engine's own order */
export interface PrefsAction {
  /** 1…8, the number `0x46b210` stores and `0x402be0` adds 8 to */
  action: number;
  /** the global `0x402be0` sets, which is what the action MEANS */
  flag: string;
  /** what this page calls it — {@link file://./walk.ts}'s `held` */
  held: "up" | "right" | "down" | "left" | "punch" | "kick" | "inv" | "jump";
  /** the character `0x46b210` ships bound to it */
  fallback: string;
  /** a word for the panel's log line; the engine draws no labels of its own */
  say: string;
}

/**
 * The eight, read off `0x402d54` joined to `0x46b210`'s shipped contents.
 *
 * Actions 2 and 4 are the pair `0x402be0` swaps on the player's mirror
 * (`[0x4ac3d4]`'s `+0x28`), which is why they are one handler each way round:
 * D is toward and A is away, and the engine works out which is which.
 */
export const PREFS_ACTIONS: readonly PrefsAction[] = [
  { action: 1, flag: "0x4ac3fe", held: "up", fallback: "W", say: "run / climb" },
  { action: 2, flag: "toward (0x4ac3d2 / 0x4ac38c by facing)", held: "right", fallback: "D", say: "toward" },
  { action: 3, flag: "0x4ac3fc", held: "down", fallback: "S", say: "down" },
  { action: 4, flag: "away (0x4ac38c / 0x4ac3d2 by facing)", held: "left", fallback: "A", say: "away" },
  { action: 5, flag: "0x4ac394", held: "punch", fallback: "P", say: "punch" },
  { action: 6, flag: "0x4ac404", held: "kick", fallback: "K", say: "kick" },
  { action: 7, flag: "0x4ac386", held: "inv", fallback: "I", say: "inv" },
  { action: 8, flag: "0x4ac3da", held: "jump", fallback: "J", say: "jump" },
];

/**
 * The four characters the panel names but a keyboard cannot send.
 *
 * `0x40e870` can name a bound character three ways: `A`…`Z` and `0`…`9` are
 * themselves, character 32 is the string at `0x46bf0c` — `"Sp"` — and characters
 * 24…27 come out of a four-entry table at `0x40e980` as `"J4"`, `"J3"`, `"J2"`
 * and `"J1"`. **They are joystick buttons**, which is what the shipped table's
 * other four entries are: 24, 25, 26 and 27 arrive bound to punch, kick, jump
 * and inv beside the letters. This page has no joystick and binds none of them;
 * they are here because the panel draws them and because it settles what those
 * four table entries were, which this port had guessed at as arrow keys.
 */
export const STICK_NAMES: Readonly<Record<number, string>> = { 24: "J4", 25: "J3", 26: "J2", 27: "J1" };

/**
 * The shipped key table, `0x46b210` as `SC.EXE` carries it — character code to
 * action number, and every other byte zero.
 */
export const SHIPPED_KEYS: Readonly<Record<number, number>> = {
  24: 5, 25: 6, 26: 8, 27: 7,
  0x41: 4, 0x44: 2, 0x49: 7, 0x4a: 8, 0x4b: 6, 0x50: 5, 0x53: 3, 0x57: 1,
};

/** one rect of the panel, `{top, left, bottom, right}` as every rect in this engine is */
export interface PrefsRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** what a click on one of the fourteen does */
export type PrefsRole =
  | { kind: "key"; action: number }
  | { kind: "ok" }
  | { kind: "volume" }
  | { kind: "difficulty"; value: -1 | 0 | 1 }
  | { kind: "music" };

export interface PrefsControl extends PrefsRect {
  role: PrefsRole;
  /** the `.data` address the rect was read from, and the handler that answers it */
  from: string;
}

/**
 * The fourteen, read out of `.data` rather than measured off the picture.
 *
 * The eight key boxes are two columns of four — `x118…142` and `x242…266`, rows
 * at y71, 96, 121 and 146 — and the table's order is neither reading order nor
 * column order: the engine draws box `i` where the table says and labels it with
 * the KEY, so the order below is the table's and nothing else.
 */
export const PREFS_CONTROLS: readonly PrefsControl[] = [
  { top: 71, left: 242, bottom: 90, right: 266, role: { kind: "key", action: 1 }, from: "0x479188 / 0x45d72f" },
  { top: 146, left: 242, bottom: 165, right: 266, role: { kind: "key", action: 2 }, from: "0x479190 / 0x45d72f" },
  { top: 96, left: 242, bottom: 115, right: 266, role: { kind: "key", action: 3 }, from: "0x479198 / 0x45d72f" },
  { top: 121, left: 242, bottom: 140, right: 266, role: { kind: "key", action: 4 }, from: "0x4791a0 / 0x45d72f" },
  { top: 121, left: 118, bottom: 140, right: 142, role: { kind: "key", action: 5 }, from: "0x4791a8 / 0x45d72f" },
  { top: 96, left: 118, bottom: 115, right: 142, role: { kind: "key", action: 6 }, from: "0x4791b0 / 0x45d72f" },
  { top: 146, left: 118, bottom: 165, right: 142, role: { kind: "key", action: 7 }, from: "0x4791b8 / 0x45d72f" },
  { top: 71, left: 118, bottom: 90, right: 142, role: { kind: "key", action: 8 }, from: "0x4791c0 / 0x45d72f" },
  { top: 207, left: 322, bottom: 241, right: 502, role: { kind: "ok" }, from: "0x4791c8 / 0x45d73f" },
  { top: 200, left: 122, bottom: 215, right: 222, role: { kind: "volume" }, from: "0x4791d0 / 0x45d743" },
  { top: 226, left: 123, bottom: 241, right: 138, role: { kind: "difficulty", value: 1 }, from: "0x4791d8 / 0x45d788" },
  { top: 226, left: 171, bottom: 241, right: 186, role: { kind: "difficulty", value: 0 }, from: "0x4791e0 / 0x45d79b" },
  { top: 226, left: 219, bottom: 241, right: 234, role: { kind: "difficulty", value: -1 }, from: "0x4791e8 / 0x45d7ae" },
  { top: 173, left: 123, bottom: 188, right: 138, role: { kind: "music" }, from: "0x4791f0 / 0x45d7c1" },
];

/**
 * The colours `0x45db40` asks `0x409a00` for, by palette index.
 *
 * A key box is filled `0xe1` when it is the selected one and 0 otherwise, and
 * its label is drawn 0 on the light fill and `0xff` on the dark. The three
 * difficulty boxes and the music box are filled `0xd7` when they are the chosen
 * one and 0 when they are not, each inset by two (`0x434290(rect, 2, 2)`). The
 * slider's ten segments are `0x11` up to the seventh and `0x d7` past it.
 */
export const PREFS_INK = { selected: 0xe1, unselected: 0, labelOnSelected: 0, label: 0xff, lit: 0xd7, low: 0x11 } as const;

/**
 * The volume slider: ten segments, eight wide, ten apart.
 *
 * `0x45dd2e` builds one rect out of the slider's own — `{top, left, bottom,
 * left + 8}` inset by one — and `0x434270(rect, 0xa, 0)` walks it across. A
 * segment is lit while its index is at or below `[0x479180]`, so volume 0 lights
 * the first of them and there is no silent end of the slider. The value is set
 * from the click's own x: `0x45d743` takes `(x - rect.left) / 10`, clamps it to
 * 0…9 and hands it to `0x4274e0`.
 */
export const VOLUME = { steps: 10, width: 8, stride: 10, inset: 1, loudFrom: 7, max: 9 } as const;

/** the panel's state, which is the four words the executable keeps between screens */
export interface PrefsState {
  /** the character bound to each of the eight, indexed by `action - 1` */
  keys: string[];
  /** `[0x479180]`, 0…9 */
  volume: number;
  /** `[0x46b1fc]` — the level theme, and only the theme */
  music: boolean;
  /** `[0x46b20c]`, +1 EASY through -1 HARD */
  difficulty: -1 | 0 | 1;
  /** `[0x46b1a8]` — which of the two Skull Crackers */
  character: 0 | 1;
}

export function defaultPrefs(): PrefsState {
  return {
    keys: PREFS_ACTIONS.map((a) => a.fallback),
    // `0x45d5b8` fills the slider from `0x4274b0`, the mixer's own level, rather
    // than from a stored word — so the panel opens on whatever the machine is at
    // and there is no shipped default to read. Full is this page's choice.
    volume: VOLUME.max,
    music: true,
    difficulty: 0,
    character: 0,
  };
}

/**
 * How a preference survives the walk from one page to the next.
 *
 * The original keeps all five in `.data` and never writes them to disc — the
 * shell and the level runner are one process, so there is nothing to carry them
 * across. Two HTML pages are not one process, so they are kept here. The
 * character and the difficulty ALSO travel in `walk.html`'s query string, which
 * is that page's own way of being told anything and which wins when it is there;
 * the other three have no query string of their own and this is the whole of it.
 */
const STORE = "skullcracker.prefs";

export function loadPrefs(): PrefsState {
  const fresh = defaultPrefs();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORE);
  } catch {
    // a browser with storage switched off plays the shipped bindings, which is
    // what the original does every time it starts anyway
    return fresh;
  }
  if (!raw) return fresh;
  try {
    const got = JSON.parse(raw) as Partial<PrefsState>;
    const keys = Array.isArray(got.keys) && got.keys.length === 8 ? got.keys.map(String) : fresh.keys;
    return {
      keys,
      volume: clampVolume(typeof got.volume === "number" ? got.volume : fresh.volume),
      music: typeof got.music === "boolean" ? got.music : fresh.music,
      difficulty: got.difficulty === 1 || got.difficulty === -1 ? got.difficulty : 0,
      character: got.character === 1 ? 1 : 0,
    };
  } catch {
    return fresh;
  }
}

export function savePrefs(state: PrefsState): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    /* storage off, or full: the panel still works for this session */
  }
}

export function clampVolume(n: number): number {
  if (!Number.isFinite(n)) return VOLUME.max;
  return Math.max(0, Math.min(VOLUME.max, Math.trunc(n)));
}

/**
 * `0x45d743`: the click's x inside the slider, over ten, clamped.
 *
 * The divide comes first and the clamp second, which is the order the two
 * `cmp`s are written in and the reason a click on the slider's last two pixels
 * still means 9 rather than 10.
 */
export function volumeAt(x: number, control: PrefsRect): number {
  return clampVolume(Math.trunc((x - control.left) / VOLUME.stride));
}

/**
 * What `0x40e870` would draw for a character — and the empty string is the
 * answer that makes `0x45d810` refuse a binding.
 */
export function keyName(ch: string): string {
  if (!ch) return "";
  if (ch.length > 1) return Object.values(STICK_NAMES).includes(ch) ? ch : "";
  const c = ch.toUpperCase();
  if (c === " ") return "Sp";
  if (/^[A-Z0-9]$/.test(c)) return c;
  return "";
}

/**
 * `0x45d810` — bind a character to one of the eight, or refuse.
 *
 * Returns the reason it refused, or null when the binding took. Both refusals
 * are the executable's: a character already spoken for is dropped by the loop
 * at `0x45d824` before the jump table is even reached, and a character the
 * panel cannot name is bound and then unbound again at `0x45d89e`.
 */
export function bindKey(state: PrefsState, action: number, ch: string): string | null {
  const name = keyName(ch);
  if (!name) return `${JSON.stringify(ch)} is not a character 0x40e870 can name`;
  const want = name === "Sp" ? " " : name;
  const taken = state.keys.findIndex((k) => k.toUpperCase() === want.toUpperCase());
  if (taken >= 0) return taken === action - 1 ? `${name} is already ${PREFS_ACTIONS[taken].say}` : `${name} is ${PREFS_ACTIONS[taken].say} (0x45d824)`;
  state.keys[action - 1] = want;
  return null;
}
