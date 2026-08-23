/**
 * What state the game is in, said in a list — the second half of the pane behind X.
 *
 * The plot of this game lives entirely in script globals, so a snapshot of the
 * globals table IS the game state (engine/src/runtime/trace.ts, and docs/taoot/mission-flow.md
 * for what they mean). `snapshotState` already produces exactly that, and it is
 * already what the playthrough goldens hold, so this file renders that snapshot
 * rather than gathering anything of its own: what a reporter can read here and what
 * a golden compares are the same numbers by construction.
 *
 * Asked for in #22 — "knowing some of the variables and what they do, I wish I
 * knew what state the game was in".
 */
import { isHarnessPaced } from "@dreamfactory/engine/runtime/masks";
import type { StateTrace } from "@dreamfactory/engine/runtime/trace";

/**
 * The six variables the game's own debug readout names, in its order.
 *
 * Not a list we chose. TI.EXE has no such dialog — it is a SCRIPT, on the HELP
 * button of the save panel (house.shp, prop "help"), and shift-clicking it in the
 * original answers `Mission=1, Phase=4, Letter=0, Necklace=0`, with `Maze` and
 * `Level` added in the three smokestack sets. So these are the ones the game's own
 * author reached for when he wanted to know where a player was, which is a better
 * answer than picking six ourselves.
 */
export const SPINE: readonly string[] = [
  "mission",
  "phase",
  "letterphase",
  "neckphase",
  "mazenumber",
  "stacklevel",
];

/** what the game's own dialog calls them, so the two readouts can be compared */
const SPINE_LABEL: Record<string, string> = {
  mission: "Mission",
  phase: "Phase",
  letterphase: "Letter",
  neckphase: "Necklace",
  mazenumber: "Maze",
  stacklevel: "Level",
};

export interface StateRow {
  name: string;
  value: string;
  /** it moved recently — the panel lights these */
  changed: boolean;
  /** not a variable: the "156 unchanged" line, drawn dim */
  quiet?: boolean;
}

export interface StateView {
  /** where you are: set, scene, view, and the theme playing — for the clipboard */
  where: string;
  /**
   * What the room is doing, which the pane's own readout above does not say: the
   * theme playing, and the fade when there is one. Not globals at all — they are
   * here because "why is the screen black" and "why is that music playing" are the
   * two questions a state list gets asked that the globals cannot answer.
   */
  head: StateRow[];
  /** the six above, always, in the game's own order and spelling */
  spine: StateRow[];
  /** what else there is to say — see {@link stateView} for which */
  rest: StateRow[];
  /** how many rows `all` would have added but this view left out */
  hidden: number;
}

export interface StateViewOptions {
  /** substring the reader typed, matched against the name */
  filter?: string;
  /** every global, not just the ones that have moved */
  all?: boolean;
  /** names that changed recently, from {@link ChangeWatch} */
  changed?: ReadonlySet<string>;
}

const str = (v: unknown): string => (typeof v === "string" ? v : String(v));

/**
 * The snapshot as rows.
 *
 * The default is NOT the whole table, and the reason is a measurement: a game
 * holds 93 globals at boot and 161 by the credits, of which 121 ever move — but
 * between two story beats the median number that CHANGED is 5, and the most ever
 * is 30. 161 rows is a wall to read; five is a readout. So the default answers
 * "what just happened" and `all` answers "what is there", with the six the game
 * itself names always on top either way.
 *
 * Props and actors join the list only under `all`: 27 props and 8 actors have an
 * owner by the end of the game and the unowned majority is noise, which is why the
 * trace drops them too.
 */
export function stateView(trace: StateTrace, opts: StateViewOptions = {}): StateView {
  const changed = opts.changed ?? new Set<string>();
  const want = (opts.filter ?? "").trim().toLowerCase();
  const matches = (name: string): boolean => !want || name.toLowerCase().includes(want);

  const spine = SPINE.filter((n) => n in trace.globals).map((n) => ({
    name: SPINE_LABEL[n] ?? n,
    value: str(trace.globals[n]),
    changed: changed.has(n),
  }));

  // A filter is a question about the whole table, so it searches all of it: typing
  // "phase" to find out what the phases are must not be answered with "none of
  // them moved in the last two seconds".
  const everything = opts.all || !!want;
  const rest: StateRow[] = [];
  let hidden = 0;
  for (const [name, value] of Object.entries(trace.globals)) {
    if (SPINE.includes(name)) continue;
    if (!matches(name)) continue;
    // A counter is not news. `sec` is the pocketwatch's second hand and
    // `clockcount` the call counter it rolls over from, so both move every second
    // the game is up: without this the default list was permanently those two and
    // nothing else, and the reader's actual question went unanswered under them.
    // The list is the trace comparison's own (engine/src/runtime/masks.ts) — they are asking
    // the same thing. Under `all` or a filter they show like anything else, because
    // then the reader has named what they want.
    const news = changed.has(name) && !isHarnessPaced(name);
    if (!everything && !news) {
      hidden++;
      continue;
    }
    rest.push({ name, value: str(value), changed: changed.has(name) });
  }
  if (opts.all) {
    for (const [name, owner] of Object.entries(trace.props)) {
      if (matches(name)) rest.push({ name: `prop ${name}`, value: str(owner), changed: false });
    }
    for (const [name, owner] of Object.entries(trace.actors)) {
      if (matches(name)) rest.push({ name: `actor ${name}`, value: str(owner), changed: false });
    }
  }
  const fading = trace.fade > 0;
  const head: StateRow[] = [{ name: "theme", value: trace.theme, changed: false }];
  // 0 is "fully visible" and the ordinary case, so it is only worth a row while
  // there is something to explain
  if (fading) head.push({ name: "fade", value: trace.fade.toFixed(2), changed: true });
  return {
    where: `${trace.set} — ${trace.scene} / ${trace.view} · ${trace.theme}${
      fading ? `, fade ${trace.fade.toFixed(2)}` : ""
    }`,
    head,
    spine,
    rest,
    hidden,
  };
}

/**
 * Which globals have moved lately.
 *
 * A row is worth lighting for a moment and then not: the panel refreshes several
 * times a second, and a change that only shows in the frame it happened in is a
 * change nobody sees. Held by the time it was last seen at rather than by a
 * countdown, so the caller's refresh rate and the highlight's life are
 * independent of each other.
 */
export class ChangeWatch {
  private last: Record<string, unknown> = {};
  private at = new Map<string, number>();

  /** @param lifeMs how long a change stays lit */
  constructor(readonly lifeMs = 2500) {}

  /** fold in a snapshot, and answer what is still lit at `now` */
  update(globals: Record<string, unknown>, now: number): ReadonlySet<string> {
    for (const [k, v] of Object.entries(globals)) {
      // A name arriving for the first time is a set being opened, not a change:
      // 68 globals appear over the course of a game as rooms declare their own,
      // and lighting all of them on entry would light the panel up at every door.
      if (k in this.last && this.last[k] !== v) this.at.set(k, now);
    }
    this.last = { ...globals };
    const lit = new Set<string>();
    for (const [k, when] of this.at) {
      if (now - when < this.lifeMs) lit.add(k);
      else this.at.delete(k);
    }
    return lit;
  }

  /** a fresh game: nothing has changed yet, and nothing is lit */
  reset(): void {
    this.last = {};
    this.at.clear();
  }
}

/** what a {@link RowView} did — nothing at all, in the case it exists for */
export interface RowPatch {
  added: number;
  removed: number;
  /** a value that moved, or a highlight that came on or went off */
  updated: number;
  /** a row that had to change places */
  moved: number;
}

/**
 * A list of rows kept in step with an element, by touching only what differs.
 *
 * The panel polls, because the engine has no "a global changed" event to listen
 * for — so the list is rebuilt four times a second whether or not the game did
 * anything. Written the obvious way (`replaceChildren` with a fresh row per
 * variable) that discards and re-creates every one of 131 rows every 250 ms for a screen
 * that has not changed: the browser repaints the whole rail, a text selection in it
 * cannot survive one tick, and a reader watching one row watches it flicker.
 *
 * So this holds the row it made for each name and patches it. When nothing has
 * moved, an update is a few string comparisons and NO writes at all, which is the
 * ordinary case — the game spends most of its time being looked at.
 *
 * Measured in the browser with a MutationObserver over the list, 4 s a sample:
 *
 *  * a room standing still, 16 refresh ticks: **0 mutations**
 *  * one global moved: **2** — its number, and its highlight coming on
 *  * all 30 of that room's rows on screen: **20**, and every one of them the
 *    pocketwatch. Filter the list to two rows with no clock in them and it is 0
 *    again; filter it to `sec` and `secframe` and it is 4, one a second each.
 *
 * That last pair is the point: what is left is exactly the writes that a changed
 * value asks for, and nothing else.
 */
export class RowView {
  private rows = new Map<string, { row: HTMLElement; name: HTMLElement; value: HTMLElement }>();

  /**
   * @param host the element the rows live in — it owns nothing else
   * @param tag what a row is, and what its two halves are: `div`/`b`/`span` for the
   *   list, `span`/`span`/`span` for the one-line strip above it
   */
  constructor(
    private readonly host: HTMLElement,
    private readonly tag: { row: string; name: string; value: string } = {
      row: "div",
      name: "b",
      value: "span",
    },
    private readonly rowClass = "row",
  ) {}

  apply(rows: readonly StateRow[]): RowPatch {
    const patch: RowPatch = { added: 0, removed: 0, updated: 0, moved: 0 };
    const doc = this.host.ownerDocument;
    const wanted = new Set(rows.map((r) => r.name));
    for (const [name, cell] of this.rows) {
      if (wanted.has(name)) continue;
      cell.row.remove();
      this.rows.delete(name);
      patch.removed++;
    }
    let i = 0;
    for (const r of rows) {
      let cell = this.rows.get(r.name);
      if (!cell) {
        const row = doc.createElement(this.tag.row);
        const name = doc.createElement(this.tag.name);
        const value = doc.createElement(this.tag.value);
        name.textContent = r.name;
        row.append(name, value);
        cell = { row, name, value };
        this.rows.set(r.name, cell);
        patch.added++;
      }
      // The two writes worth guarding: a value is a string compare away from
      // knowing it is the same string, and a class is a boolean.
      const text = r.value ? ` ${r.value}` : "";
      if (cell.value.textContent !== text) {
        cell.value.textContent = text;
        patch.updated++;
      }
      const want = [this.rowClass, r.changed ? "lit" : "", r.quiet ? "none" : ""]
        .filter(Boolean)
        .join(" ");
      if (cell.row.className !== want) {
        cell.row.className = want;
        patch.updated++;
      }
      // …and the one that only matters when the list itself is reordered, which a
      // filter does and a quiet game does not.
      if (this.host.children[i] !== cell.row) {
        this.host.insertBefore(cell.row, this.host.children[i] ?? null);
        patch.moved++;
      }
      i++;
    }
    return patch;
  }
}

/**
 * The whole state, as text for the clipboard.
 *
 * Its shape is the goldens' (`formatTrace`), with the room and the log wrapped
 * around it, because that makes a reporter's paste directly comparable with a
 * recorded playthrough instead of merely readable. It is an ATTACHMENT rather than
 * something the Report button could carry: the issue body travels as a URL under a
 * 4000-byte ceiling, and one snapshot is 3234 bytes of state on its own (3333 at the
 * fullest beat of the recorded route) — before the log it is pasted with, which runs
 * to 1141 lines and 40 kB over a whole game (site/src/bug-report.ts).
 */
export function stateDump(trace: StateTrace, log: readonly string[], head: string[] = []): string {
  return [
    ...head,
    `where: ${trace.set} — ${trace.scene} / ${trace.view}`,
    `theme: ${trace.theme}  fade: ${trace.fade}`,
    "",
    "state:",
    JSON.stringify({ globals: trace.globals, props: trace.props, actors: trace.actors }, null, 2),
    "",
    "log:",
    ...log,
    "",
  ].join("\n");
}
