/**
 * The Details column a play page carries: the log, the state list, the input
 * log and "⧉ Copy details", behind X.
 *
 * Titanic's play page grew it (#22, #178) and the speedrun workbench reused it
 * as its third column; Dust's, Timelapse's and RedJack's play pages carry the
 * same markup now, and this is the one place its behaviour lives. What a page
 * keeps is what is its own: the markup (so each can lay it out, and Titanic's
 * can translate it), its spine, its log's lines and the words its notes say.
 *
 * ## Three kinds of page
 *
 * `<meta name="details-always">` — the column is part of the page rather than
 * something to ask for, and the speedrun workbench says it: a route is read off
 * the log and tuned against the state list, and a column that has to be
 * summoned every time is in the way of the thing it belongs to. It starts open,
 * X does not shut it, and the state box defaults to on. `content="log"` asks for
 * the column with its two panes shut on a first visit (Titanic's developer-mode
 * page, where the column is the terminal's scrollback).
 *
 * `<meta name="details-never">` — a page the column is no part of (Titanic's
 * free roam): the markup still carries it, because the log is written on every
 * page and a bug report is copied out of it, but nothing ever shows it — not X,
 * not a logged line, not `?debug=1`.
 *
 * Neither — a play page: X opens and shuts it, and the answer is remembered.
 *
 * ## `?debug=1`
 *
 * The link somebody is SENT when a report needs more than it carried: the
 * column, the state list and the input log all on, and remembered, because
 * what such a report was missing is most often which gesture caused the thing.
 */
import type { StateTrace } from "@dreamfactory/engine/runtime/trace";
import { stateDump, type SpineVar } from "./debug-panel";
import { bindRememberedBox, installStateList, type StateList } from "./state-list";

/** what {@link DetailsColumn.install} wires the column to */
export interface DetailsColumnOptions {
  /** the few variables worth naming before the rest */
  spine: readonly SpineVar[];
  /** the live game state */
  state(): StateTrace;
  /** whether there is a game to snapshot yet — absent, always (a page whose session exists from the start) */
  ready?(): boolean;
  /** every line of the log, for Copy details */
  lines(): readonly string[];
  /** what heads a copy: the game's name and version, its edition, the browser */
  head(): string[];
  /** turns the input log on and off; absent, the `inputs` box is not offered */
  inputs?(on: boolean): void;
  /** what the note beside the button says once the copy is on the clipboard, or saved as a file — asked at the press, so a page that changes language says it in the new one */
  said?(): { copied: string; saved: string };
}

/** how long the note beside Copy details stays */
const NOTE_MS = 15_000;

const meta = (name: string): Element | null => document.querySelector(`meta[name="${name}"]`);

export class DetailsColumn {
  /** the column is part of this page (see the module's header) */
  readonly always = !!meta("details-always");
  /** ...and its two panes start open with it */
  readonly panes = meta("details-always")?.getAttribute("content") !== "log";
  /** the column is no part of this page */
  readonly never = !!meta("details-never");
  readonly el = document.getElementById("details") as HTMLDivElement | null;
  private readonly openKey: string;
  private o: DetailsColumnOptions | null = null;

  /**
   * The column of `game` — which names what it remembers: `<game>.details.open`,
   * `.state` and `.inputs`. Built as early as the page likes, because a boot logs
   * before there is a game; {@link install} wires it to one.
   */
  constructor(private readonly game: string) {
    this.openKey = `${game}.details.open`;
    if (new URLSearchParams(window.location.search).get("debug") === "1" && !this.never && this.el) {
      this.el.hidden = false;
      for (const key of ["open", "state", "inputs"]) remember(`${game}.details.${key}`, true);
    }
  }

  /** the state list, the input log's box and Copy details — once, when the page has a game to read */
  install(o: DetailsColumnOptions): StateList {
    this.o = o;
    const inputsKey = `${this.game}.details.inputs`;
    const stateList = installStateList({
      state: () => o.state(),
      spine: o.spine,
      storageKey: `${this.game}.details.state`,
      defaultOn: this.always && this.panes,
      visible: () => !!this.el && !this.el.hidden && (o.ready?.() ?? true),
    });
    const inputsBox = document.getElementById("dbgInputsOn") as HTMLInputElement | null;
    if (inputsBox && o.inputs) bindRememberedBox(inputsBox, inputsKey, o.inputs, this.always && this.panes);
    else if (inputsBox) (inputsBox.closest("label") ?? inputsBox).setAttribute("hidden", "");
    document.getElementById("dbgCopy")?.addEventListener("click", () => void this.copy());
    return stateList;
  }

  /**
   * Did the reader leave the column open last time? — and yes, always, on a
   * page it belongs to: this is what a boot reads to decide whether to shut it,
   * and the workbench's boot must not.
   */
  wanted(): boolean {
    if (this.never) return false;
    if (this.always) return true;
    try {
      return window.localStorage.getItem(this.openKey) === "1";
    } catch {
      return false;
    }
  }

  /** X: open or shut, and remembered — inert where the column is the page or no part of it */
  toggle(): void {
    if (this.always || this.never || !this.el) return;
    this.show(this.el.hidden);
    remember(this.openKey, !this.el.hidden);
  }

  /** open or shut it for now, without remembering — a boot that failed opens it on the log */
  show(open: boolean): void {
    if (!this.el || this.never) return;
    this.el.hidden = !open;
    const log = document.getElementById("scriptlog");
    if (open && log) log.scrollTop = log.scrollHeight;
  }

  /**
   * The whole state and the whole log, on the clipboard — or as a file where the
   * browser will not take the clipboard. Shaped like a golden trace
   * (debug-panel.ts `stateDump`), so a reporter's paste diffs against a recorded
   * playthrough; an attachment, because a bug report travels as a URL under a
   * 4000-byte ceiling and one snapshot is more than that before its log.
   */
  private async copy(): Promise<void> {
    const o = this.o;
    if (!o) return;
    const text = (o.ready?.() ?? true) ? stateDump(o.state(), o.lines(), o.head()) : [...o.head(), "", ...o.lines()].join("\n");
    const words = o.said?.() ?? { copied: "copied", saved: "saved as a file" };
    let said = words.copied;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${this.game}-details.txt`;
      a.click();
      URL.revokeObjectURL(url);
      said = words.saved;
    }
    const note = document.getElementById("dbgNote");
    if (!note) return;
    note.textContent = said;
    window.setTimeout(() => (note.textContent = ""), NOTE_MS);
  }
}

/** an answer kept past the tab, where storage allows */
function remember(key: string, on: boolean): void {
  try {
    window.localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* not remembering is survivable — the column still holds for this tab */
  }
}
