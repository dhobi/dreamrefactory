/**
 * TI.EXE's developer menu, and what each of its commands can actually do here.
 *
 * `boot()`'s second line is `menuvisible (debugging)`, and in a build where that
 * flag was true the 1996 engine put a menu bar across the top of the window. None
 * of it is in the game data — the corpus has no menu-defining command at all, and
 * a script only hears about the bar when the engine calls `menuselect (name)`
 * afterwards — so the bar itself is read back out of the executable's `RT_MENU`
 * resource by `taoot/tools/devmenu.ts` into {@link DEV_MENU}.
 *
 * What lives HERE is the part that is not in the resource: which of the 24
 * commands still does something when the menu is put back up, and which is a
 * label over a hole. That is not a detail to leave a reader to discover by
 * clicking — nine of the 24 did nothing in the shipping build either, and a bar
 * where a third of the items are silent reads as broken unless it says so.
 */
import { DEV_MENU, type DevMenu, type DevMenuEntry } from "./menu.gen";

export { DEV_MENU };
export type { DevMenu, DevMenuEntry };

/** a label split into the three things it carries */
export interface Label {
  /** the words, with the `&` accelerator marks taken out */
  text: string;
  /** the accelerator letter, lowercased, or "" if the label marks none */
  accessKey: string;
  /** the shortcut hint after the tab — "Ctrl+D" — or "" */
  hint: string;
}

/** split a stored label: `"&Debug On/Off\tCtrl+D"` -> text, access key, hint */
export function parseLabel(label: string): Label {
  const [left, hint = ""] = label.split("\t");
  const amp = left.indexOf("&");
  return {
    text: left.replace(/&/g, ""),
    accessKey: amp >= 0 && amp + 1 < left.length ? left[amp + 1].toLowerCase() : "",
    hint,
  };
}

/**
 * The nine commands that open the in-engine script editor.
 *
 * Every one of them bottoms out in a `*script` builtin that this port registers
 * as a no-op (engine/src/runtime/builtins/scene.ts), and that is not a gap in the
 * port: in TI.EXE each handler first tests an "editor available" flag at
 * `0x489f2c`/`0x489fd8` and returns an error when it is clear, which it is in
 * every shipping build. So these did nothing on the 1996 disc either unless the
 * authoring tool was present, and a rebuild of the menu that quietly dropped them
 * would be a rebuild of a menu that never existed.
 *
 * They stay on the bar, disabled, saying why. The port has a better answer to the
 * question they were asked — `taoot/out/scripts/` holds every script in the game
 * as text — and that is a pane, not a 1996 modal.
 */
export const EDITOR_COMMANDS: readonly string[] = [
  "flat script",
  "scene script",
  "set script",
  "stage script",
  "boot script",
  "post script",
  "server script",
  "painting scripts",
  "button scripts",
];

/**
 * The one command on the bar that BOOTFILE has no case for.
 *
 * `menuselect`'s switch runs out without matching "report", so the script does
 * nothing and returns — whatever Options ▸ Report did in 1996 was the engine's
 * own, and there is nothing in the game data to rebuild it from.
 */
export const NO_HANDLER: readonly string[] = ["report"];

/** why a command is greyed out, or "" if it is live */
export function inertReason(select: string): string {
  if (EDITOR_COMMANDS.includes(select))
    return "the script editor is not in a shipping build — TI.EXE's own editor flag is clear, so this did nothing on the disc either";
  if (NO_HANDLER.includes(select))
    return "BOOTFILE's menuselect has no case for this one — it was the engine's, and the game data does not say what it did";
  return "";
}

/** every command on the bar, flattened, in the order the menus give them */
export function commands(menus: readonly DevMenu[] = DEV_MENU): {
  menu: string;
  label: string;
  id: number;
  select: string;
}[] {
  const out: { menu: string; label: string; id: number; select: string }[] = [];
  for (const m of menus) {
    for (const e of m.items) {
      if (e.separator) continue;
      out.push({ menu: parseLabel(m.label).text, label: e.label, id: e.id, select: e.select });
    }
  }
  return out;
}

/**
 * The accelerator table: `"ctrl+d"` -> the `menuselect` name.
 *
 * Built from the labels rather than written down, so a shortcut can only be one
 * the menu itself advertises. Lowercased on both sides because a browser reports
 * `e.key` as "D" when shift is involved and "d" otherwise, and the 1996 hints are
 * mixed case.
 */
export function accelerators(menus: readonly DevMenu[] = DEV_MENU): Map<string, string> {
  const keys = new Map<string, string>();
  for (const c of commands(menus)) {
    const { hint } = parseLabel(c.label);
    if (hint) keys.set(hint.toLowerCase(), c.select);
  }
  return keys;
}
