/**
 * The keys and the touch pad: the four buttons the game reads as it steps
 * (`upPressed` and the rest), the input gate, the key table built from the
 * preferences, and the pad's fingers.
 */
import { PREFS_ACTIONS, keyName, loadPrefs } from "../prefs";
import { held } from "./state";

/**
 * The two edges: a door is entered by PRESSING up, and a jump by pressing jump.
 * Holding neither repeats.
 */
export let upPressed = false;
export let jumpPressed = false;
/** the attacks fire on the press too: holding K should not machine-gun kicks */
export let punchPressed = false;
export let kickPressed = false;

/**
 * `[0x46b1d4]` — does a key reach the player at all.
 *
 * `0x402be0` is the one place a key becomes an action (the window procedure's
 * two callers, `0x428090` and `0x442ae0`, hand it the action number), and it
 * opens `cmp word ptr [0x46b1d4], 0; je` — ret — so while the word is 0 a key
 * going down sets nothing and a key coming up clears nothing. `0x402e30(n)`
 * writes the word and falls into `0x402db0`, which zeroes all eight action
 * words ({@link dropKeys}). Its only two callers are the craft's think: `(0)`
 * the frame the screen starts down (`0x410702`) and `(1)` once the tally has
 * run (`0x410754`). `0x402df0` — the same eight zeroes with the word set to 1
 * — is what the player's own set-up calls (`0x42e583`, `0x448a93`), so every
 * level starts with the keys open.
 */
export let inputOpen = true;

/**
 * `0x402db0` — the eight action words, `0x4ac3d2` … `0x4ac386`, all zeroed: every
 * key held is let go and every edge not yet spent is thrown away.
 */
export function dropKeys(): void {
  for (const k of Object.keys(held) as (keyof typeof held)[]) held[k] = false;
  upPressed = false;
  jumpPressed = false;
  punchPressed = false;
  kickPressed = false;
}

/** `0x402e30(open)` — the word, then `0x402db0` */
export function setInput(open: boolean): void {
  inputOpen = open;
  dropKeys();
}

// ---- input ---------------------------------------------------------------

/**
 * `SC.EXE`'s own bindings — and **W is the run, not "up"**.
 *
 * Two tables settle this together. The 256-byte one at `0x46b210`, which
 * `0x403b90` indexes with the uppercased character, gives an action code; then
 * `0x402be0` adds 8 and jumps through the 20-entry table at `0x402d54`, where
 * every entry is a one-line handler that sets or clears a single global. Reading
 * both and joining them on the action code:
 *
 * ```
 *   W  action  1  ->  [0x4ac3fe] = 1        S  action 3  ->  [0x4ac3fc] = 1
 *   D  action  2  ->  toward   (by facing)  A  action 4  ->  away  (by facing)
 *   P  action  5  ->  [0x4ac394] = 1        K  action 6  ->  [0x4ac404] = 1
 *   I  action  7  ->  [0x4ac386] = 1        J  action 8  ->  [0x4ac3da] = 1
 *   -               (action 10 spawn cycler, action 11 character switch: unbound)
 * ```
 *
 * `0x4ac3fe` — W — is read by every one of the player's movement states, and
 * what it does is context-dependent, one flag with two jobs:
 *
 * - **on the ground it RUNS.** The walk state `0x429990` tests it first of all
 *   (`cmp word ptr [0x4ac3fe], 0`) and installs `0x471988` tag 0, dx 180, on the
 *   way through. That is 330px a second against the walk's 180, and it is the
 *   speed the game actually travels at.
 * - **on a ladder it CLIMBS.** The ladder state `0x42ae50` tests the same flag
 *   four times over, installing the climb script `0x471e78` and decrementing a
 *   rung counter at `0x4ac406` each time — so a ladder is counted in rungs.
 *
 * So W is not "up": holding it does both jobs, as the original does. The other
 * four are the band's own labels: J jumps, K and P are the two attack sets, I
 * is INV.
 *
 * And the eight letters are only the DEFAULTS. Every one of them is rebindable
 * from the preferences panel — `0x46b210` is what the panel writes and this is
 * what reads it, so see {@link file://../prefs.ts} and `keyTable` below. The four
 * shipped entries beside the letters are characters 24…27, which `0x40e980`
 * names `J4`, `J3`, `J2` and `J1`: a joystick's four buttons, bound to the
 * punch, the kick, the jump and INV, not arrow keys.
 */

/**
 * What the preferences panel settled, read once at load.
 *
 * The panel is `main.html`'s and the level is this page's, so the eight
 * bindings come across in {@link file://../prefs.ts}'s store. Nothing here writes
 * them back: a level has no preferences panel in it, which is also true of the
 * original — `0x45d5a0` is only ever entered from the menu.
 */
export const PREFS = loadPrefs();

/**
 * The eight bindings, plus the four this page adds.
 *
 * `0x46b210` is indexed by the uppercased character, so a binding matches
 * whatever case the key arrives in. The arrows and the space bar are NOT in that
 * table — the shipped entries beside the letters are characters 24…27, which
 * `0x40e980` names `J4`, `J3`, `J2` and `J1`, a joystick's four buttons — so
 * they are this port's, kept because a page is not a 1996 game. A binding wins
 * over them: bind the punch to the space bar and the space bar stops jumping.
 */
export function keyTable(): Record<string, keyof typeof held> {
  const table: Record<string, keyof typeof held> = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
    " ": "jump",
  };
  for (const action of PREFS_ACTIONS) {
    const bound = PREFS.keys[action.action - 1];
    if (!keyName(bound)) continue;
    table[bound.toUpperCase()] = action.held;
    table[bound.toLowerCase()] = action.held;
  }
  return table;
}

export const KEYS: Readonly<Record<string, keyof typeof held>> = keyTable();

/** the key each finger is holding down, so one lifting releases only its own */
export const padFingers = new Map<number, HTMLButtonElement>();

export const padAct = (el: HTMLButtonElement): keyof typeof held =>
  el.dataset.act as keyof typeof held;

export function padPress(el: HTMLButtonElement, id: number): void {
  const act = padAct(el);
  padFingers.set(id, el);
  el.classList.add("on");
  // the same four edges `keydown` takes: a door and a jump fire on the PRESS,
  // and a held fist must not machine-gun
  // `0x402be0` — nothing while the keys are shut ({@link inputOpen})
  if (!inputOpen) return;
  if (act === "up" && !held.up) upPressed = true;
  if (act === "jump" && !held.jump) jumpPressed = true;
  if (act === "punch" && !held.punch) punchPressed = true;
  if (act === "kick" && !held.kick) kickPressed = true;
  held[act] = true;
}

export function padLift(id: number): void {
  const el = padFingers.get(id);
  if (!el) return;
  padFingers.delete(id);
  el.classList.remove("on");
  const act = padAct(el);
  // a key is let go when the LAST finger on it lifts, not the first: a thumb
  // rolling from left to right puts two pointers on the pad for a moment
  for (const still of padFingers.values()) if (padAct(still) === act) return;
  if (inputOpen) held[act] = false;
}

/** every key at once — a film starting, or the page losing the fingers */
export function padLiftAll(): void {
  const fingers = Array.from(padFingers.keys());
  for (const id of fingers) padLift(id);
}
export function setUpPressed(v: typeof upPressed): void {
  upPressed = v;
}
export function setJumpPressed(v: typeof jumpPressed): void {
  jumpPressed = v;
}
export function setPunchPressed(v: typeof punchPressed): void {
  punchPressed = v;
}
export function setKickPressed(v: typeof kickPressed): void {
  kickPressed = v;
}
