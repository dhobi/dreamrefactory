/**
 * What the player pressed, what it hit, and what it did
 * ([#178](https://github.com/dhobi/dreamrefactory/issues/178)).
 *
 * The script log says what the GAME did — `opensetfile("wireless.set", …)`,
 * `movie: leave.mov`, `click wireless` — and until this existed it said nothing
 * about what was done TO it. A report reading "I pressed forward and it went
 * wrong" could not be checked against the log, because the log had no record of
 * a press; and where it did (`click bag`, from the viewer) there was no record of
 * the click that caused it. So this writes the other half of every line, in the
 * same stream:
 *
 *     [+01:14.8] [Space]           hotspot "door" → deckbd2.set — Scene35 / View102
 *     [+01:15.9] [Forward]         → wireless.set — Scene10 / View14
 *     [+01:18.2] [Click 214,180]   region "ok" → wireless — wireless 1
 *     [+01:20.0] [Esc]             — nothing changed
 *
 * ## In the log rather than beside it
 *
 * One stream, interleaved with the engine's own lines, and not a second pane.
 * The question this is for is cause and effect — "which input did that" — and in
 * one stream the answer is the ORDER, which needs no correlating. It also means
 * every bug report carries the trail already: `⧉ Copy details` and the Report
 * bug button both read the same buffer (taoot/src/log-buffer.ts), so a reporter
 * who turns this on does not have to know they should also attach it.
 *
 * The timestamp is for the other direction — a video, or a second recording,
 * lined up against the log. Counted from when the page's session began, since
 * that is the only zero both a log and a screen capture can agree on.
 *
 * ## Every input, including the ones that did nothing
 *
 * A press the engine refused is the single most useful line here, because it is
 * the shape of the report this came from: ESC skipping something it should not
 * have ([#171](https://github.com/dhobi/dreamrefactory/issues/171)), a forward
 * eaten in the gap between `movingCamera` and `inputLocked` where a press is
 * silently discarded (`SetViewer.pressNav`). "The key I pressed is not in the
 * log at all" is indistinguishable from "the log is broken", so a gesture that
 * achieved nothing says so in as many words.
 *
 * ## One line where the game is quick, two where it is not
 *
 * A line can only report a consequence it has waited for, and waiting is exactly
 * what must not be done to the ORDER of the log: a press at a two-minute film
 * would have its line land after the film's, i.e. after everything the reader is
 * trying to explain. So a gesture answered inside {@link SLOW_MS} is one line,
 * complete, which is the ordinary case (a turn settles in a frame or two); a
 * gesture the game is still working on gets its line at once — the cause, in the
 * right place — and a second, indented line when the consequence lands.
 *
 * Nothing here reads a clock, a DOM or an engine: `main.ts` passes in the four
 * questions ({@link InputLogPorts}) and this decides what to say. That is what
 * makes the wording testable without a browser, and it is why the module has no
 * business with `performance.now`.
 */

/** what the engine was doing when the gesture arrived — see {@link InputLogPorts.gate} */
export type Gate =
  /** it will be acted on now */
  | "ready"
  /** filed behind a camera move or a script, and replayed when that ends */
  | "queued"
  /** discarded: the engine is not accepting, and this press is gone */
  | "locked"
  /** there is no room to accept it — a film, a menu, or the boot */
  | "none";

/** what the engine's own hit test says is under a point (`GameSession.hitTestAt`) */
export interface Hit {
  name: string;
  /** the engine's word: "actor", "prop", "painting", "button", "flat", "scene" */
  type: string;
}

export interface Cause {
  /** ms since the session began */
  at: number;
  /** the gesture, as the log spells it: `[Forward]`, `[Click 214,180]` */
  what: string;
  /** for a click: what the engine says was under it */
  hit?: Hit | null;
  gate: Gate;
  /** where the game stood when the gesture arrived */
  where: string;
}

/**
 * How long a gesture may take before its line is written without an answer.
 *
 * A fifth of a second, and the number is a compromise between two things the
 * reader wants at once. Longer, and a slow gesture's line drifts down the log
 * past the engine lines it caused, which is the one thing the order in a single
 * stream is for. Shorter, and an ordinary turn — which settles in a frame or two
 * but not always inside one tick of anything — starts producing two lines, and
 * the log doubles in length for no information.
 */
export const SLOW_MS = 200;

/** the log's name for a key, as [#178](https://github.com/dhobi/dreamrefactory/issues/178) spells them */
const KEY_LABEL: Record<string, string> = {
  leftarrow: "Left",
  rightarrow: "Right",
  uparrow: "Forward",
  downarrow: "Back",
  " ": "Space",
  ".": "Esc",
};

/**
 * The label for a key on its way to the game.
 *
 * The engine's own name in, the player's word out — `uparrow` is `[Forward]`
 * because that is what the hand did, and the smokestack's `downarrow` is
 * `[Back]`. Everything else is a character the original also passes through (the
 * rebindable `keynorth`/`keywest`/`keyeast` are A/W/D by default, and the
 * Enigma's keypad is typed at), so it is named as itself rather than dropped:
 * "the game received the letter q" is a fact about an input.
 */
export function inputLabel(engineKey: string): string {
  const known = KEY_LABEL[engineKey];
  if (known) return `[${known}]`;
  return `[Key "${engineKey}"]`;
}

/** the label for a press at a point */
export const clickLabel = (x: number, y: number): string => `[Click ${x},${y}]`;

/**
 * `mm:ss.s` from the start of the session, or `h:mm:ss.s` once there is an hour
 * of it — a tenth of a second, which is as fine as a reading lined up against a
 * video by hand can be used.
 */
export function stamp(ms: number): string {
  const whole = Math.max(0, ms) / 1000;
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole - h * 3600) / 60);
  const s = whole - h * 3600 - m * 60;
  const mm = `${h ? String(m).padStart(2, "0") : String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
  return `[+${h ? `${h}:` : ""}${mm}]`;
}

/** the engine's hit-test word, in the log's own vocabulary */
const HIT_WORD: Record<string, string> = {
  painting: "hotspot",
  button: "region",
  actor: "actor",
  prop: "prop",
  flat: "flat",
  scene: "scene",
};

/**
 * What the gesture landed on, named — or nothing at all.
 *
 * `painting` is the engine's word for a view's clickable and `button` for a
 * stage region, and neither is what a reader of this log calls them: #178 asks
 * for `hotspot "door"` and `region "tapper"`, so those are the words. A type the
 * table does not know is printed as the engine spells it rather than swallowed —
 * a new kind of zone should show up in the log the day it exists, not the day
 * somebody remembers this table.
 *
 * The SCENE is not a hit worth naming. It is what the engine answers when a
 * click is inside the room and on nothing in particular, which is the same
 * information as "no hotspot" — and printing `scene "bedsit1"` beside a location
 * that already says `bedsit1` is a line saying one thing twice.
 */
export function hitPhrase(hit: Hit | null | undefined): string {
  if (!hit || !hit.name || !hit.type) return "";
  if (hit.type === "scene") return "";
  return `${HIT_WORD[hit.type] ?? hit.type} "${hit.name}"`;
}

/** what a gate is worth saying about, if anything */
const GATE_NOTE: Record<Gate, string> = {
  ready: "",
  queued: "queued behind a camera move",
  locked: "DROPPED — the engine was not accepting (mid-fade)",
  none: "",
};

/** the widest label that still aligns the tails of ordinary lines */
const LABEL_WIDTH = 16;

/**
 * One gesture as one line — complete when `to` is known, and the cause alone
 * when it is not (see {@link SLOW_MS}).
 *
 * `to` is where the game stood once the gesture was answered. Unchanged and with
 * nothing hit, the gesture did nothing and the line says so: that is the whole
 * reason a reader can trust the ones that DO say something.
 */
export function inputLine(c: Cause, to: string | null): string {
  const bits = [hitPhrase(c.hit), GATE_NOTE[c.gate]].filter(Boolean);
  const head = `${stamp(c.at)} ${c.what.padEnd(LABEL_WIDTH)}`;
  const said = bits.join(", ");
  if (to === null) {
    // still working: the cause, in its right place, and where it started from
    return `${head}${said ? `${said} ` : ""}· ${c.where}…`;
  }
  if (to !== c.where) return `${head}${said ? `${said} ` : ""}→ ${to}`;
  if (said) return `${head}${said} → ${to}`;
  return `${head}— nothing changed`;
}

/** the second line of a slow gesture: what it turned out to do */
export const effectLine = (at: number, from: string, to: string): string =>
  `${stamp(at)} ${" ".repeat(LABEL_WIDTH)}${to === from ? "— nothing changed" : `→ ${to}`}`;

/** the four questions this asks of the page, and the one thing it tells it */
export interface InputLogPorts {
  /** ms since the session began */
  now(): number;
  /** put a line in the script log */
  say(line: string): void;
  /** where the game is standing, in one phrase */
  where(): string;
  /** what will happen to a gesture arriving right now */
  gate(): Gate;
  /** run `fn` in `ms`, and give back the way to call it off */
  after(ms: number, fn: () => void): () => void;
}

/**
 * The recorder: one call per gesture, wrapped around the dispatch.
 *
 * Wrapped rather than notified, because the two halves of a line are on either
 * side of it — the gate and the location before, the consequence after — and a
 * notification would have to be given both, from the page, at every call site.
 *
 * It never awaits on the caller's behalf. `note` returns nothing and the page's
 * handlers carry on exactly as they did: what the promise is for is the second
 * half of a line, and a handler that waited for it would be a handler that
 * blocked the browser's event loop on a two-minute film.
 */
export class InputLog {
  /** off unless the reader asked (or the page is a workbench) — see main.ts */
  on = false;

  constructor(private readonly ports: InputLogPorts) {}

  /**
   * Record one gesture and dispatch it.
   *
   * The dispatch is a thunk so that NOTHING is started when the log is off: a
   * recorder that built the promise before checking would make the log's switch
   * a thing that changes what the game does, which is the one property a
   * debugging aid must not have.
   */
  note(what: string, dispatch: () => Promise<unknown> | unknown, hit?: () => Hit | null): void {
    if (!this.on) {
      void dispatch();
      return;
    }
    const cause: Cause = {
      at: this.ports.now(),
      what,
      // asked here and not by the caller, so a log that is off costs the engine
      // no hit test: `hitTestAt` walks the sprites, the view's hotspots and the
      // stage's regions, and a click is not the moment to do that for nothing
      hit: hit?.() ?? null,
      gate: this.ports.gate(),
      where: this.ports.where(),
    };
    let said = false;
    const cancel = this.ports.after(SLOW_MS, () => {
      said = true;
      this.ports.say(inputLine(cause, null));
    });
    const done = (): void => {
      cancel();
      const to = this.ports.where();
      if (said) this.ports.say(effectLine(this.ports.now(), cause.where, to));
      else this.ports.say(inputLine(cause, to));
    };
    // `Promise.resolve` because a dispatch need not be one: a gesture that
    // returns nothing still ends.
    void Promise.resolve(dispatch()).then(done, done);
  }

  /**
   * A gesture that is answered the moment it is made, with the answer in hand.
   *
   * The Nightdive intro's keys are the case this exists for, and
   * [#171](https://github.com/dhobi/dreamrefactory/issues/171) is why it is
   * worth a method: `NightdiveIntro.key` returns whether the film took the
   * press, synchronously, and NOTHING about where the page is changes either
   * way — so {@link note} would print "nothing changed" over a press that had
   * just skipped a film. The answer is the only observation there is, so the
   * caller passes it in.
   */
  noteAnswered(what: string, where: string, answer: string): void {
    if (!this.on) return;
    const head = `${stamp(this.ports.now())} ${what.padEnd(LABEL_WIDTH)}`;
    this.ports.say(`${head}${answer} · ${where}`);
  }
}
