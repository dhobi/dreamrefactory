/**
 * The variables, as a live list — the half of the Details pane that is the same
 * on any DreamFactory game.
 *
 * A DreamFactory game's plot lives entirely in script globals, so a snapshot of
 * the globals table IS the game state (`runtime/trace.ts`). `snapshotState`
 * already produces exactly that and the playthrough goldens already hold it, so
 * this renders that snapshot rather than gathering anything of its own: what a
 * reader sees here and what a golden compares are the same numbers by
 * construction. Asked for in
 * [#22](https://github.com/dhobi/dreamrefactory/issues/22) — "knowing some of
 * the variables and what they do, I wish I knew what state the game was in".
 *
 * ## What is here and what is not
 *
 * Here: the `state` checkbox, the filter, the `all` box, the two lists and the
 * poll that keeps them current. Every one of those is a question about a
 * session, and every session is the same shape.
 *
 * Not here: the LOG above it, the Copy-details button beside it, and the X that
 * opens the pane. Those look shared and are not — Titanic's log is `#scriptlog`
 * and Dust's is `#log` in a different place, the copy dump carries a version and
 * an edition that only one game has, and whether X does anything depends on
 * whether the pane is the page. They stay with the page that owns them
 * (taoot/src/main.ts, dust/src/speedrun-page.ts).
 *
 * ## Why it polls
 *
 * The engine has no "a global changed" event, so there is nothing to subscribe
 * to. {@link REFRESH_MS} is 250 rather than a frame because the list is a
 * hundred rows of DOM and the snapshot walks the globals, the props and the
 * actors — and because a reader is reading, not watching an animation. Nothing
 * runs at all while the pane cannot be seen ({@link StateListOptions.visible}).
 */
import { snapshotState, type StateTrace } from "@dreamfactory/engine/runtime/trace";
import { ChangeWatch, RowView, stateView, type SpineVar } from "./debug-panel";

/**
 * How often the list catches up, in ms.
 *
 * 250, and the two reasons are opposite: faster than this and it is a hundred
 * rows of DOM rewritten for a reader who cannot read that fast; slower and a
 * variable that moved feels like one that did not. {@link RowView} is what makes
 * the number affordable — an update over a quiet game writes nothing at all.
 */
export const REFRESH_MS = 250;

export interface StateListOptions {
  /** the live snapshot — `snapshotState(session, viewer, "live")` */
  state(): StateTrace;
  /**
   * The game's own named variables, shown above the rest — Titanic's six, Dust's
   * two, or none. See {@link SpineVar}.
   */
  spine?: readonly SpineVar[];
  /**
   * Where the checkbox's answer outlives the tab.
   *
   * One namespace per game, because `localStorage` is per origin and the
   * deployed site serves every game from one — the same reason the workbench's
   * own keys carry a game (`web/speedrun/panel-keys.ts`).
   */
  storageKey: string;
  /**
   * Is the list on before anybody has answered?
   *
   * True on a page the pane BELONGS to — a workbench's third column exists to
   * show this, and one that opened on the log alone would answer half the
   * question it is there for. False on a play page, which has players to spare a
   * hundred and sixty variable names from. Only the default either way: a stored
   * answer wins, so a reader who turns it off keeps it off.
   */
  defaultOn?: boolean;
  /**
   * Is there anything to read, and can it be seen?
   *
   * Asked before EVERY read rather than tracked here, because both halves are
   * the page's business: Titanic's X shuts the whole column and its boot shuts
   * it again on a fresh game, and Dust's workbench has no game at all for the
   * first few minutes. A false answer is not an error — it is "not yet", and
   * the next tick will ask again.
   */
  visible(): boolean;
}

export interface StateList {
  /** catch the list up now — after a load, or when the pane is opened */
  refresh(): void;
  /** forget which variables moved lately (a fresh game has no recent past) */
  reset(): void;
}

/**
 * A checkbox whose answer is remembered.
 *
 * Here rather than in a page because both the state box and each game's own
 * boxes want it, and the subtlety is worth having in one place: `fallback` is
 * only the DEFAULT, so a stored answer wins over it in both directions. A reader
 * who turns a box off on a page that starts it on gets it off, and keeps it off.
 */
export function bindRememberedBox(
  box: HTMLInputElement,
  key: string,
  apply: (on: boolean) => void,
  fallback = false,
): void {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(key);
  } catch {
    /* storage can be denied; the box then starts at the default every launch */
  }
  box.checked = stored === null ? fallback : stored === "1";
  apply(box.checked);
  box.addEventListener("change", () => {
    apply(box.checked);
    try {
      window.localStorage.setItem(key, box.checked ? "1" : "0");
    } catch {
      /* not remembering is survivable — the setting still holds for this tab */
    }
  });
}

/**
 * Wire the list into the pane's elements and start its poll.
 *
 * Finds them by id — `#dbgStateOn`, `#dbgState`, `#dbgSpine`, `#dbgTools`'s two
 * controls and `#dbgRows` — which is how every module in this layer finds its
 * elements, and means a page opts in by carrying that markup. A page missing any
 * of them gets a list that does nothing rather than a thrown module, because a
 * game whose pane is half-built should still boot.
 */
export function installStateList(o: StateListOptions): StateList {
  const $ = <T extends HTMLElement>(id: string): T | null =>
    document.getElementById(id) as T | null;
  const box = $<HTMLInputElement>("dbgStateOn");
  const panel = $<HTMLDivElement>("dbgState");
  const spineEl = $<HTMLDivElement>("dbgSpine");
  const rowsEl = $<HTMLDivElement>("dbgRows");
  const filter = $<HTMLInputElement>("dbgFilter");
  const all = $<HTMLInputElement>("dbgAll");
  if (!box || !panel || !spineEl || !rowsEl) {
    return { refresh: () => {}, reset: () => {} };
  }

  /** which globals moved lately, so the list can light them for a moment */
  const changeWatch = new ChangeWatch();
  /**
   * The two lists, each keeping its element in step by touching only what
   * differs. Rebuilt lists were the first version and the wrong one: this polls,
   * so `replaceChildren` threw away and re-made every row four times a second
   * whether or not the game had done anything.
   */
  const spineView = new RowView(spineEl, { row: "span", name: "span", value: "span" }, "");
  const rowsView = new RowView(rowsEl);

  /**
   * Catch the list up — and do NOTHING when there is nothing to read.
   *
   * The guard is here rather than only in the poll below, and that is the whole
   * of a real bug: binding the checkbox applies its stored answer immediately,
   * which on a page whose list starts ON means one refresh before a game
   * exists. Dust's workbench is such a page, its `state()` reads
   * `window.dbg.host`, and the boot takes minutes — so the very first thing
   * that happened on it was `Cannot read properties of undefined (reading
   * 'session')`, thrown out of a module the page then carried on without.
   *
   * So {@link StateListOptions.visible} means what it says: asked before every
   * read, not before some of them.
   */
  const refresh = (): void => {
    if (!o.visible()) return;
    const trace = o.state();
    const changed = changeWatch.update(trace.globals, performance.now());
    const view = stateView(trace, {
      filter: filter?.value,
      all: !!all?.checked,
      changed,
      spine: o.spine,
    });
    // `#hud` is left alone: the viewer owns it (it names the hotspot count too,
    // and a bug report's title is read off it). This strip says what the hud
    // cannot — the game's own named variables, the theme, and the fade while
    // there is one.
    spineView.apply([...view.spine, ...view.head]);
    // Said as a count rather than as a sentence: it is the answer to "is
    // anything happening", and a hundred and fifty-six variables sitting still
    // IS the answer.
    rowsView.apply(
      view.rest.length
        ? view.rest
        : [
            {
              name: view.hidden ? `${view.hidden} unchanged` : "—",
              value: "",
              changed: false,
              quiet: true,
            },
          ],
    );
  };

  bindRememberedBox(
    box,
    o.storageKey,
    (on) => {
      panel.hidden = !on;
      if (on) refresh();
    },
    !!o.defaultOn,
  );
  for (const el of [filter, all]) el?.addEventListener("input", () => refresh());
  // `panel.hidden` as well as `visible()`: the first is the reader's own answer
  // to the checkbox and the second is whether the pane is on screen at all, and
  // a snapshot behind either is work for nobody.
  window.setInterval(() => {
    if (panel.hidden) return;
    refresh();
  }, REFRESH_MS);

  return { refresh, reset: () => changeWatch.reset() };
}

/** the snapshot both the list and a page's clipboard dump read — the goldens' own */
export const liveState = (
  session: Parameters<typeof snapshotState>[0],
  viewer: Parameters<typeof snapshotState>[1],
): StateTrace => snapshotState(session, viewer, "live");
