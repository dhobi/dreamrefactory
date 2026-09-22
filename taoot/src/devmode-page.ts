/**
 * Titanic's developer mode — the 1996 debug build, put back up.
 *
 * `BOOTFILE/0001.txt:14` is `debugging = false`, and it is the only assignment to
 * that global in the whole corpus: 437 containers read it, nothing else writes
 * it, and the menu's own "Debug On/Off" can only turn it OFF again. So a debug
 * build was a build with that line edited, and everything behind the flag has sat
 * in the shipped game files ever since, unreachable.
 *
 * This page is that build. It boots the game exactly as the play page does — the
 * game module is `main.ts`, the same one — and then does the three things the
 * 1996 developer's copy did differently:
 *
 *  1. raises `debugging`,
 *  2. answers `optionkey()` and `commandkey()` for real, which the play page
 *     never does (engine/src/runtime/builtins/scene.ts),
 *  3. puts TI.EXE's own menu bar back on the screen, read out of the executable's
 *     `RT_MENU` resource rather than written down (taoot/tools/devmenu.ts).
 *
 * ## What that opens, and what it does not
 *
 * It is not a free-roam mode and there is no room teleport in it, because the
 * game never had one. What the flag reaches is: the deck map's 15 developer areas
 * (`MAP.STG`'s `if not debugging → exitcode` regions — the gymnasium, the lounge,
 * the smoking room, the café, the fore and poop decks), `pathblocked` answering
 * false on the false smokestack (`SMSTACK2.SET` c1, the one place in the game it
 * is overridable), the bedsit's option-click that hands you bag, map and watch,
 * the position and distance readouts in `idle()`, and `setuptour` forcing the
 * tour actors in whether or not their films are on the disc.
 *
 * ## Why the modifier latches, rather than just holding the key
 *
 * Nearly every debug branch is gated `optionkey () & debugging`, not on the flag
 * alone — so the flag without the keys opens almost nothing. Holding a real Alt
 * works and is wired below, but it is not something to depend on: a window
 * manager or a browser may take Alt-click for itself before the page ever sees
 * it, and on a Mac keyboard there is no Command key to send at all from some
 * layouts. The latches are the reliable way to ask, and they match how
 * `shiftkey()` already behaves — a snapshot of what the last press carried, not
 * live keyboard state.
 */
import { DEV_MENU, accelerators, inertReason, parseLabel } from "./devmode/menu";
import { installMapOverlay } from "./devmode/map-overlay";
import { History, run as runLine, type ConsoleSession } from "./devmode/console";

/** the handle `taoot/src/main.ts` publishes once the game is up */
interface Dbg {
  /** the live SetViewer, or null until the boot has activated a set */
  viewer: unknown;
  session: {
    interp: { globals: { get(k: string): unknown; set(k: string, v: number | string): void } };
    runGlobal(handler: string, args?: (string | number)[]): Promise<unknown>;
    altDown: boolean;
    metaDown: boolean;
    /** which stage is up ("map.stg" when the deck map is open), and which plan */
    stageName: string;
    currentFlat: string;
    /** what the console needs — see {@link file://./devmode/console.ts} */
    instanceFrom(data: Uint8Array | undefined, owner: string): unknown;
  };
}

const slot = document.getElementById("devslot");
if (!slot) throw new Error("devmode: the page has no #devslot");

/**
 * Wait for the game — and specifically for `boot()` to have RUN, which is a
 * later moment than it looks.
 *
 * `window.dbg` is published from main.ts's first lines, so a module that waits
 * for the handle and then raises the flag raises it before the boot does
 * anything, and `boot()`'s `debugging = false` lands on top of it. Measured, not
 * reasoned about: the first version of this page read back 0.
 *
 * A VIEWER is the signal. Not because it means `boot()` has RETURNED — it does
 * not, and that is worth being exact about: the boot opens a set before
 * `logo.mov` and `playmode.mov`, and parks at that menu with a viewer already
 * built (taoot/src/main.ts). What a viewer means is that the boot has got as far
 * as opening a set, and `debugging = false` is its FOURTEENTH line, long before
 * anything that loads one. So the write we are racing is behind us, which is all
 * this needs to be true.
 *
 * The fallback matters as much as the wait. An edition that activates no set —
 * the 1996 demo is all films and a menu stage — would otherwise hang here
 * forever, so after the timeout this gives up waiting and raises the flag
 * anyway, which is the right answer for every case except a boot still in
 * flight.
 */
async function booted(): Promise<Dbg | null> {
  let dbg: Dbg | undefined;
  for (let i = 0; i < 1200; i++) {
    dbg = (window as unknown as { dbg?: Dbg }).dbg;
    if (dbg?.session && dbg.viewer) return dbg;
    await new Promise((r) => setTimeout(r, 50));
  }
  return dbg ?? null;
}

/** whether a script would take the `if debugging` branch right now */
const debugging = (s: Dbg["session"]): boolean => {
  const v = s.interp.globals.get("debugging");
  return typeof v === "number" ? v !== 0 : !!v && v !== "0";
};

void (async () => {
  const dbg = await booted();
  if (!dbg?.session) throw new Error("devmode: the game never came up");
  const session = dbg.session;

  // ---- the flag ----
  // After the boot, necessarily — see {@link booted}. Nothing reassigns it
  // afterwards, not `advanceday` and not a set change, so once is enough for the
  // session; a reload puts it back the way the disc has it, and Options ▸ Debug
  // On/Off takes it down from inside the game, which is the one path that is
  // supposed to.
  session.interp.globals.set("debugging", 1);

  // ---- the menu bar ----
  const bar = document.createElement("div");
  bar.id = "devbar";
  bar.setAttribute("role", "menubar");

  let openMenu: HTMLDetailsElement | null = null;

  /**
   * The page's own switch, which is not the same thing as the global.
   *
   * `debugging` is one of the 68 numeric globals every saved game carries, and
   * it is stored as 0 in all of them — the shipped `.ti` files included, since
   * nobody saved a game from a debug build. So `loadGame` restores it, and
   * opening a save silently turned developer mode off: the menu stayed on the
   * screen, the flag was down, and every branch behind it quietly stopped
   * working. Reported from the page, and it is exactly the right question to
   * have asked — a save load is the one thing that writes this global besides
   * `boot()`.
   *
   * So the page remembers what was ASKED for and puts the flag back whenever the
   * game clears it behind us. The one case that must not be fought is the menu's
   * own Options ▸ Debug On/Off, which is supposed to turn it off — and that is
   * why this is intent rather than a plain "keep it at 1": after a menu command
   * the intent is re-read from whatever the script left.
   */
  let wanted = true;

  const status = document.createElement("button");
  status.id = "devstatus";
  status.type = "button";
  // ...and the page needs a way back ON, because the game has none: `menuselect`
  // can only ever set `debugging = false`, so in 1996 the way to turn it back on
  // was to relaunch. Here the switch that raised it in the first place is a
  // switch, which is the honest shape for something the page owns.
  status.title =
    "Developer mode — the `debugging` global. Click to switch it, or use Options \u25b8 Debug On/Off (Ctrl+D).";
  status.addEventListener("click", () => {
    wanted = !wanted;
    session.interp.globals.set("debugging", wanted ? 1 : 0);
    sayState();
  });

  function sayState(): void {
    const on = debugging(session);
    // A dot and a word, not a word: reported from the page as "once I switch
    // debug off, I can't enable it", and the mechanism was working the whole
    // time — the control was styled down until it read as a readout, so nobody
    // tried pressing it. An indicator that changes state is a thing people press.
    status.textContent = `${on ? "\u25cf" : "\u25cb"} debugging ${on ? "on" : "off"}`;
    status.classList.toggle("off", !on);
    bar.classList.toggle("dim", !on);
  }

  /**
   * Put the flag back when something else takes it down.
   *
   * On the frame loop the page already runs on, and cheap: a map lookup and a
   * comparison. A load is the case this exists for, and there is no hook to hang
   * it on — `session.onLoadGame` is the callback that HANDS the engine the
   * bytes, not a notification that one landed.
   */
  const holdFlag = (): void => {
    requestAnimationFrame(holdFlag);
    if (!wanted || debugging(session)) return;
    session.interp.globals.set("debugging", 1);
    sayState();
  };
  requestAnimationFrame(holdFlag);

  /**
   * Run a menu command.
   *
   * Through the game's own `menuselect`, which is the whole point: the bar is a
   * bar, and every behaviour behind it is BOOTFILE's. `runGlobal` is how a
   * handler on the boot is reached (engine/src/runtime/session.ts) — the same
   * path `transtoflat` and the rest of the boot library take.
   */
  const select = async (name: string): Promise<void> => {
    /*
     * "Debug On/Off" is named for two things and the script implements one.
     * `menuselect`'s case is `if debugging → debugging = false`, so on the disc
     * the command only ever turned developer mode OFF and the way back was to
     * relaunch. A command labelled On/Off that does nothing every second press
     * is a command that looks broken, so the page supplies the missing half:
     * with the flag already down, this raises it instead of running a case that
     * cannot.
     */
    if (name === "debug on/off" && !debugging(session)) {
      wanted = true;
      session.interp.globals.set("debugging", 1);
      sayState();
      return;
    }
    await session.runGlobal("menuselect", [name]);
    // "debug on/off" turns the flag off from inside the script, and the 1996
    // build's bar went with it (`menuvisible (debugging)`). So does this one —
    // and the page takes the script's answer as the new intent, which is what
    // stops {@link holdFlag} immediately undoing it.
    wanted = debugging(session);
    sayState();
  };

  for (const menu of DEV_MENU) {
    const title = parseLabel(menu.label);
    const det = document.createElement("details");
    det.className = "devmenu";
    const sum = document.createElement("summary");
    sum.textContent = title.text;
    det.append(sum);
    const list = document.createElement("div");
    list.className = "devitems";
    for (const entry of menu.items) {
      if (entry.separator) {
        list.append(document.createElement("hr"));
        continue;
      }
      const { text, hint } = parseLabel(entry.label);
      const why = inertReason(entry.select);
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.select = entry.select;
      b.disabled = !!why;
      b.title = why || `menuselect ("${entry.select}") — command ${entry.id}`;
      const name = document.createElement("span");
      name.textContent = text;
      const key = document.createElement("kbd");
      key.textContent = hint;
      b.append(name, key);
      b.addEventListener("click", () => {
        det.open = false;
        void select(entry.select);
      });
      list.append(b);
    }
    det.append(list);
    // one menu down at a time, the way a menu bar behaves
    det.addEventListener("toggle", () => {
      if (!det.open) return;
      if (openMenu && openMenu !== det) openMenu.open = false;
      openMenu = det;
    });
    bar.append(det);
  }

  // ---- the modifier latches ----
  // These write the session fields the two probes read. Nothing else in the port
  // writes them, so what is latched here is what `optionkey()` answers.
  const latch = (label: string, hint: string, set: (on: boolean) => void): HTMLElement => {
    const l = document.createElement("label");
    l.className = "devlatch";
    l.title = hint;
    const box = document.createElement("input");
    box.type = "checkbox";
    box.addEventListener("change", () => set(box.checked));
    const s = document.createElement("span");
    s.textContent = label;
    l.append(box, s);
    return l;
  };

  const latches = document.createElement("span");
  latches.id = "devlatches";
  let altLatch = false;
  let metaLatch = false;

  /**
   * ...and the deck map's hidden areas, drawn on the plan while it is open.
   *
   * On by default, because it is the one thing on this page that shows you
   * something you could not otherwise find: the 14 debug areas carry no
   * highlight and not even a cursor change, so without this they have to be
   * hunted for. See {@link file://./devmode/map-overlay.ts} — it is a picture,
   * and the engine's own hittest still decides what a click does.
   */
  const screen = document.getElementById("screen") as HTMLCanvasElement | null;
  const overlay = screen
    ? installMapOverlay({
        screen,
        where: () => ({ stage: session.stageName, flat: session.currentFlat }),
      })
    : null;

  latches.append(
    latch("⌥ option", "Hold OPTION for every click — `optionkey()`, which nearly every debug branch is gated on", (on) => {
      altLatch = on;
      session.altDown = on;
    }),
    latch("⌘ command", "Hold COMMAND for every click — `commandkey()`, read by HOUSE.SHP's `visdeg`", (on) => {
      metaLatch = on;
      session.metaDown = on;
    }),
  );
  /**
   * The placement mode's own switch.
   *
   * `setloc` is `boot()`'s thirteenth line, one above `debugging`, and its only
   * assignment — the disc had two switches and so does this. Off by default, and
   * meant to be flipped for a moment rather than left up: while it is on,
   * BOOTFILE's global mousedown sends a click on an actor to `move3dactor` and
   * on a prop to `move3dprop`/`move2dprop` INSTEAD of the object's own
   * `mousedown`, so nobody can be spoken to and nothing can be picked up. A
   * plain click on an actor does nothing at all — `move3dactor` leaves at once
   * unless option or shift is held.
   *
   * Nothing it changes is written anywhere: positions live in the session, so a
   * reload puts the room back the way the disc has it.
   */
  latches.append(
    latch(
      "place",
      "Raise `setloc`: clicking an actor or prop MOVES it instead of using it — option-drag to slide, option+shift to raise, shift to turn. Nobody can be talked to while this is on, and nothing is saved.",
      (on) => session.interp.globals.set("setloc", on ? 1 : 0),
    ),
  );

  if (overlay) {
    const box = latch(
      "map areas",
      "Outline the deck map's jump areas while it is open — amber is developer-only, green is any player's, and dashed red is the one BUTTON that does nothing in any build (its room is reachable on foot)",
      (v) => overlay.enabled(v),
    );
    (box.querySelector("input") as HTMLInputElement).checked = true;
    latches.append(box);
  }

  /**
   * ...and a real held key, for whoever would rather hold one.
   *
   * CAPTURE phase on the window, which is what makes this work at all: main.ts
   * takes its own press on the canvas in the bubble phase and sets `shiftDown`
   * there, so a listener that ran after it would be writing the modifiers for the
   * press that had already been dispatched. This runs first, and main.ts never
   * touches these two fields — so the latch survives a click that holds neither.
   */
  window.addEventListener(
    "pointerdown",
    (e) => {
      session.altDown = altLatch || e.altKey;
      session.metaDown = metaLatch || e.metaKey;
    },
    { capture: true },
  );

  // ---- the accelerators ----
  // The menu's own, from its own labels: Ctrl+D is on the bar because TI.EXE's
  // resource says "&Debug On/Off\tCtrl+D", and nothing here decides otherwise.
  const keys = accelerators();
  window.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || e.altKey || e.metaKey) return;
    const name = keys.get(`ctrl+${e.key.toLowerCase()}`);
    if (!name || inertReason(name)) return;
    e.preventDefault();
    if (openMenu) openMenu.open = false;
    void select(name);
  });

  // clicking away shuts the open menu
  document.addEventListener("click", (e) => {
    if (openMenu && !openMenu.contains(e.target as Node)) openMenu.open = false;
  });

  /**
   * The console.
   *
   * A line of the game's own script, compiled and run against the live session
   * ({@link file://./devmode/console.ts}). It is what the nine greyed Scripts
   * commands would otherwise leave missing, and it is how the four handlers with
   * no caller are reached — `sendtoshop ("inven.shp", addallinven ())`.
   *
   * Anything the line LOGS lands in the Details pane, because that is where the
   * engine routes a builtin's output; what shows here is the handler's return
   * value, which is what `return (…)` is for, and any fault.
   */
  const consoleRow = document.createElement("form");
  consoleRow.id = "devconsole";
  const prompt = document.createElement("input");
  prompt.type = "text";
  prompt.spellcheck = false;
  prompt.autocomplete = "off";
  prompt.placeholder = "return (currentset ())";
  prompt.setAttribute("aria-label", "DreamFactory script console");
  const answer = document.createElement("output");
  answer.id = "devanswer";
  const history = new History();

  consoleRow.addEventListener("submit", (e) => {
    e.preventDefault();
    const line = prompt.value;
    if (!line.trim()) return;
    history.add(line);
    prompt.value = "";
    answer.textContent = "…";
    answer.className = "";
    void runLine(session as unknown as ConsoleSession, line).then((r) => {
      if (!r.ok) {
        answer.textContent = r.error ?? "failed";
        answer.className = "bad";
        return;
      }
      // `undefined` is a handler that ran and returned nothing, which is most of
      // them — saying so beats an empty box that looks like nothing happened
      answer.textContent = r.value === undefined ? "ok" : JSON.stringify(r.value);
      answer.className = "";
    });
  });
  prompt.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const line = e.key === "ArrowUp" ? history.older() : history.newer();
    if (line === null) return;
    e.preventDefault();
    prompt.value = line;
    prompt.setSelectionRange(line.length, line.length);
  });
  consoleRow.append(prompt, answer);

  // No explanatory line in the strip: it took two of the four rows the bar has
  // and said what the greyed commands' own tooltips already say. The menu is
  // TI.EXE's, and the page that explains it is docs/taoot/devmode.md, linked
  // from the title strip.

  slot.append(bar, latches, status);
  // The prompt belongs at the foot of the scrollback, not in the menu strip —
  // the page gives it its own slot, and falls back to the strip for a shell that
  // does not carry one.
  (document.getElementById("devpromptslot") ?? slot).append(consoleRow);
  sayState();
})();
