/**
 * The action vocabulary — every verb a sheet may use, and what it does.
 *
 * One table, {@link ACTIONS}, holding both the grammar (so sheet.ts can refuse a
 * bad line at parse time) and the implementation (so there is no way for a verb
 * to be parseable and not runnable). Adding a verb is one entry here.
 *
 * ## The two altitudes
 *
 * Almost everything here is LITERAL: `up` is one ArrowUp, `click(cards)` is one
 * click at the pixel the engine's own hit test says is `cards`. A literal sheet
 * costs nothing at runtime — no planning, no hunting, no round trips beyond the
 * gesture itself — and it is deterministic, which is what makes a time
 * comparable to the last time.
 *
 * The exception is `travel`, and it exists to be temporary. It runs the real
 * {@link Navigator} — the same pathfinder the playthrough suite uses — and then
 * PRINTS THE GESTURES IT MADE as sheet lines you can paste back in. That is the
 * bootstrap loop: write `travel(turb)`, run it, take the eight literal lines it
 * emits, replace the `travel` with them, and shave from there. The planner aims
 * for reachable, not shortest, so a `travel` left in a finished sheet is time
 * being given away — the report flags every one for that reason.
 *
 * ## Nothing here reaches past the player
 *
 * The run is human-legal (`docs/…`, and the header of driver.ts). Every verb
 * bottoms out in a Playwright mouse or key event at the canvas. Where a verb
 * needs to know something — where `cards` is, which plaque is bevel 3 — it asks
 * the engine the same question the browser suite asks, through the same
 * `nav/aim.ts` sweep, and never moves the game by writing to it.
 */
import type { Step, VerbSpec } from "./sheet";
import type { SpeedrunDriver, WaitMode } from "./driver";
import { QUIET, SHOWING } from "./driver";
import { jumpTo, pageButton, jumpableSets } from "./nav/mapjumps";

export interface ActionContext {
  d: SpeedrunDriver;
  step: Step;
  /** `wait:`, resolved against the verb's own default */
  wait: WaitMode;
  /** `budget:`, ms — 10 000 unless the line says otherwise */
  budget: number;
  /** `gap:`, ms between repeated presses */
  gap: number;
  /** note something in the run report — a `travel` transcript, a bevel actually taken */
  say(message: string): void;
  /** a sheet line this action would like to see replace it, for `travel` */
  suggest(line: string): void;
}

export type ActionFn = (c: ActionContext) => Promise<void>;
export type Action = VerbSpec & {
  run: ActionFn;
  wait?: WaitMode;
  /**
   * Safe to abort half-way through and run again from the start.
   *
   * Which is NOT most of them, and the difference decides where a Pause is
   * allowed to land. An aborted action cannot say whether it got as far as
   * delivering its gesture, so re-running one that did means doing it twice —
   * and for a movement key twice is a room too far. Measured: pausing inside the
   * `up()` that leaves c73 aborted the wait but not the walk, and the Resume's
   * press then had nowhere to go (`roads 0`), which is the error "three ArrowUp
   * presses and the world did not move" arriving one room downstream of where it
   * was caused.
   *
   * The three below deliver nothing that can happen twice: `wait` and `settle`
   * only watch, and `skipMovie` presses ESC only while a film is actually on
   * screen and returns at once when its condition already holds. They are also
   * the long ones — a 300 s `skipMovie` covers the whole crossing — so they are
   * exactly the ones a Pause has to be able to interrupt to feel like a button.
   * Everything else is stopped at the next line instead.
   */
  interruptible?: boolean;
};

/** may a Pause abort this verb mid-flight, or must it finish first? */
export function interruptible(verb: string): boolean {
  return !!ACTIONS[verb.toLowerCase()]?.interruptible;
}

/* ------------------------------------------------------------------ *
 * Predicates
 * ------------------------------------------------------------------ */

/**
 * Compile a sheet-level condition into a page-side expression.
 *
 * Sheets should not contain JavaScript. `wait(set == c73)` is the thing a route
 * author actually means and survives a refactor of the engine's internals; a
 * hand-written `dbg.session.currentSetFile.startsWith(...)` does neither. The
 * `js ==` form is kept as the escape hatch for a condition nobody anticipated, and
 * its use is the signal that a shorthand is missing.
 */
/**
 * The conditions `wait` and `until:` accept, for anything that has to SHOW the
 * vocabulary rather than merely accept it — today the workbench's legend.
 *
 * Kept beside {@link predicate} and not in the page, because a list of what the
 * language accepts that lives somewhere else is a list that goes stale the first
 * time a condition is added.
 */
/** the options every verb accepts, for the workbench legend */
export const UNIVERSAL_HELP: [string, string][] = [
  ["wait: ", "how much to wait for after it: none | taken | ready | quiet"],
  ["after: <ms>", "extra pause afterwards; reported as dead time"],
  ["budget: <ms>", "how long its own wait may take before it gives up; default 10000"],
  ["gap: <ms>", "delay between repeated presses in a hammering verb"],
  ["xN", "do it N times"],
];

/**
 * THREE SHAPES, and telling them apart is most of reading a sheet.
 *
 *   bare         `quiet`, `locked`        — a fact about the engine
 *   accessor     `owns.map`               — a fact about a NAMED thing
 *   comparison   `set == c73`             — a reading, against a value
 *
 * Whitespace round an operator is optional throughout, and `!` in front negates
 * any of the three.
 */
export const CONDITIONS: { name: string; help: string }[] = [
  { name: "set == <name>", help: "you are in that room, e.g. set == c73" },
  { name: "scene == <name>", help: "that scene of the current room" },
  { name: "view == <name>", help: "you are facing that view" },
  { name: "flat == <name>", help: "that full-screen overlay is open" },
  { name: "noflat", help: "no overlay is open; the room is showing" },
  { name: "global.<n> == <v>", help: "a script global, also < > <= >= != , e.g. global.phase == 1" },
  { name: "owns.<prop>", help: "Frank is carrying it, e.g. owns.map" },
  { name: "actor.<name>", help: "that character is loaded" },
  { name: "actor.<name> == <owner>", help: "and their actorowner is that, e.g. actor.purs == sentgram" },
  { name: "visible.<name>", help: "that character is on screen and placed" },
  { name: "walking.<name>", help: "that character is mid-walk or mid-turn — the scripts' own iswalk" },
  { name: "quiet", help: "the engine is idle — nothing playing, moving or fading" },
  { name: "talking", help: "a conversation is open" },
  { name: "asking", help: "a movie is parked on clickable regions" },
  { name: "playing", help: "a movie is on screen, asking or not" },
  { name: "nomovie", help: "no movie is on screen" },
  { name: "movie == <file>", help: "that specific clip is up" },
  { name: "theme == <file>", help: "that music track is playing" },
  { name: "faded", help: "no fade is ramping" },
  { name: "locked", help: "`lockevents` is set — the world is frozen and a gesture is DROPPED" },
  { name: "polling", help: "a script is sitting in a `button()`/`stilldown()` loop, waiting for the mouse" },
  { name: "js == <expr>", help: "escape hatch: any JavaScript over window.dbg" },
];

/**
 * One condition, compiled to a JavaScript expression over `window.dbg`.
 *
 * THREE SHAPES, and the grammar is what tells them apart:
 *
 *     bare         quiet · talking · locked · faded · noflat · asking
 *     accessor     owns.map · visible.penny · walking.morrow · actor.purs
 *     comparison   set == c73 · global.mission == 1 · actor.purs == sentgram
 *
 * The accessor is the one worth explaining. `owns.map` used to read as a
 * comparison and it never was one — the question is not "does the thing owned
 * equal map", it is "is map owned", and a dot says so. It also makes the
 * Purser's two forms one idea rather than two spellings: `actor.purs` is
 * loaded, `actor.purs == sentgram` is loaded and on that rung.
 *
 * `==` and not `=`, because the operators this joins were already there — a
 * global has taken `>`, `<`, `>=`, `<=` and `!=` since the beginning and only
 * equality was spelled with one character. Whitespace round any of them is
 * optional.
 */
const SHAPE = /^([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z0-9_.-]+))?\s*(==|!=|>=|<=|>|<)?\s*([\s\S]*)$/;

export function predicate(text: string): string {
  const m = SHAPE.exec(text.trim());
  if (!m) throw new Error(`"${text}" is not a condition`);
  const k = m[1].toLowerCase();
  const of = (m[2] ?? "").toLowerCase();
  const op = m[3] ?? "";
  const value = (m[4] ?? "").trim();
  const q = (v: string) => JSON.stringify(v.toLowerCase());

  // The mistake every sheet written before the grammar changed will make, named
  // rather than left to fall through as "not a condition".
  // `global.mission == 1` — the old accessor, whose colon now means a named argument
  if (!op && !of && value.startsWith(":")) {
    const [name, ...rest] = value.slice(1).split(/[:=]/);
    throw new Error(
      `a named thing is reached with a dot now — ${k}.${name}` +
        (rest.length && rest[rest.length - 1] ? ` == ${rest[rest.length - 1]}` : ""),
    );
  }
  if (!op && value.startsWith("=")) {
    const rest = value.replace(/^=+/, "").trim();
    // The old spelling of an accessor was a comparison, so say the dot rather
    // than doubling the equals — `owns.map` wants `owns.map`, not `owns == map`.
    const DOTTED: Record<string, boolean> = { owns: true, visible: true, walking: true, actor: true, global: true, g: true };
    throw new Error(
      DOTTED[k] && !of
        ? `a named thing is reached with a dot now — ${k}.${rest.split(/[:=]/)[0]}` +
          (k === "global" || k === "g" ? ` == <value>` : rest.includes(":") ? ` == ${rest.split(":")[1]}` : "")
        : `conditions compare with == now — ${k}${of ? `.${of}` : ""} == ${rest}`,
    );
  }
  /** this condition takes no operand at all */
  const bare = (expr: string): string => {
    if (of || op || value) throw new Error(`${k} takes nothing after it — write \`${k}\` on its own`);
    return expr;
  };
  /** `key == value`, the reading of something the engine holds one of */
  const reads = (got: string): string => {
    if (of) throw new Error(`${k} is not a thing you reach with a dot — write \`${k} == ${of}\``);
    if (!op || !value) throw new Error(`${k} needs a comparison — \`${k} == something\``);
    if (op !== "==" && op !== "!=") throw new Error(`${k} compares with == or != , not ${op}`);
    const same = `${got} === ${q(value)}`;
    return op === "==" ? same : `!(${same})`;
  };
  /** `key.name`, a fact about the named thing — with an optional `== value` */
  const about = (): string => {
    if (!of) throw new Error(`${k} needs the thing it is about — \`${k}.something\``);
    return of;
  };

  switch (k) {
    // where we are
    case "set":
      return reads(`String(window.dbg.session.currentSetFile || "").toLowerCase().replace(/\\.set$/, "")`);
    case "scene":
      return reads(`String(window.dbg.viewer.scene.sceneName || "").toLowerCase()`);
    case "view":
      return reads(`String(window.dbg.viewer.scene.views[window.dbg.viewer.viewIdx].viewName || "").toLowerCase()`);
    case "flat":
      return reads(`String(window.dbg.session.currentFlat || "").toLowerCase()`);
    case "noflat":
      return bare(`!window.dbg.session.currentFlat || window.dbg.session.viewShowing`);
    /**
     * A script global, compared. `global.mission == 1` is the common case, but
     * the numeric operators earn their place: the flat's whole exit condition is
     * `bombpoints < 0` (BEDSIT1 slams it to -20000 the moment it passes 10), and
     * spelling that as a `js` expression is both unreadable and a trap — the
     * tokeniser eats the quotes a `globals.get("name")` needs.
     */
    case "global":
    case "g": {
      const name = about();
      if (!op || !value) throw new Error(`global.${name} needs a comparison — \`global.${name} == 1\``);
      const got = `window.dbg.session.interp.globals.get(${q(name)})`;
      if (op === "==") return `String(${got} ?? "") === ${JSON.stringify(value)}`;
      if (op === "!=") return `String(${got} ?? "") !== ${JSON.stringify(value)}`;
      return `Number(${got}) ${op} ${Number(value)}`;
    }
    case "owns": {
      const prop = about();
      if (op) throw new Error(`owns.${prop} is the whole condition — it takes no comparison`);
      return `(() => { const p = window.dbg.session.propRuntime.get(${q(prop)}); return !!p && String(p.owner) === "frank"; })()`;
    }
    /**
     * A character is loaded — and optionally, what their `actorowner` is.
     *
     * The owner is how this game keeps a character's place in a chain of
     * errands, and the Purser is the clearest case: PURS1.PUP offers one topic
     * slot whose text switches entirely on `actorowner("purs")`, walking
     * none -> sendgram -> sentgram -> left1 -> none2 -> findcuff -> foundcuff ->
     * left2 as each errand is done. A route that visits him six times needs to
     * be able to say which rung it expects to find him on, and nothing else in
     * the state says it — the globals do not move, and neither does the room.
     */
    case "actor": {
      const name = about();
      const got = `window.dbg.session.actorRuntime.actors.get(${q(name)})`;
      if (!op) return `(() => { const a = ${got}; return !!a; })()`;
      if (op !== "==" && op !== "!=") throw new Error(`an actorowner compares with == or != , not ${op}`);
      const same = `(() => { const a = ${got}; return !!a && String(a.owner || "").toLowerCase() === ${q(value)}; })()`;
      return op === "==" ? same : `!${same}`;
    }
    /**
     * A character is not merely loaded but ON SCREEN.
     *
     * The distinction matters because a room places its cast from its own
     * `openscene`, which runs after the walk that brought you in has finished.
     * A route that arrives faster than the planner does can therefore be
     * standing in the right view, facing the right way, with the person it came
     * to see not yet put down — and every click aimed at them finds nothing.
     */
    case "visible": {
      const name = about();
      if (op) throw new Error(`visible.${name} is the whole condition — it takes no comparison`);
      return `(() => { const a = window.dbg.session.actorRuntime.actors.get(${q(name)}); return !!a && !!a.visible; })()`;
    }
    /**
     * A character is ON HIS FEET — the scripts' own `iswalk`, which counts a turn
     * as a walk because TI.EXE's never looked at the mode (scheduler.ts,
     * `turning`).
     *
     * Wanted almost always negated, because half a dozen scripts in this corpus
     * refuse a click at someone who is moving and say nothing about why. The
     * clearest is the Turkish bath door, TURKSTRS.SET c7:
     *
     *     if actorvisible ("morrow") & morrowphase = 0
     *         sendtoactor ("morrow", mousedown (0))   <- he answers the knock
     *         exitcode
     *     endif
     *     if iswalk ("morrow")
     *         exitcode                                 <- and so does this
     *     endif
     *     sendtoprop ("door", setupprop ("turkstrs-turk"))
     *
     * and `walktopuppet` walks whoever you just spoke to BACK to the star they
     * came from as the puppet closes — so the instant a conversation ends is the
     * one instant that second guard is certain to refuse. A sheet that opens the
     * door there gets a Space that does nothing and then an `up()` reporting that
     * the world did not move, which is true and unhelpful.
     *
     * `wait(!walking.morrow)` is the whole fix, and it is the leg saying out loud
     * what it was relying on.
     */
    case "walking": {
      const name = about();
      if (op) throw new Error(`walking.${name} is the whole condition — it takes no comparison`);
      return `!!(window.dbg.session.scheduler.isWalk(${q(name)}))`;
    }
    // what is on screen
    case "quiet":
      return bare(`(() => { const v = window.dbg.viewer; return !!v && (v.quiescent || v.conversing); })()`);
    /**
     * The engine is waiting on a CLICK — a movie parked on its regions with the
     * script that opened it suspended. This and not `asking` is what "the boot
     * menu is up" means: `asking` only counts rectangles, and a clip can carry
     * regions for a frame or two on its way past, which is enough for a
     * `skipMovie until: asking` to stop at the logos and call it the menu.
     */
    case "awaiting":
      return bare(`!!(window.dbg.viewer && window.dbg.viewer.awaitingInput)`);
    /**
     * No fade is ramping. Worth having as its own condition because it is
     * exactly the gap in which a key press is DROPPED (viewer.ts's note on
     * `pressNav`), so "the room has finished arriving" is a different claim from
     * "a movie is not playing" and a route needs to be able to make it.
     */
    case "faded":
      return bare(`window.dbg.session.fade.level === 0`);
    /**
     * The world is FROZEN — `lockevents`, which the scripts set while the game is
     * doing something to you and a gesture must not interrupt.
     *
     * The strongest refusal in the engine and the only one that is not a state of
     * the viewer: it is a script global, so `quiet`, `faded` and `ready` all
     * answer true through it. What it does is throw a gesture away — the click
     * dispatch returns before the hit test and the boot's keydown exitcodes on it
     * (viewer.ts's note on both), so the press is not run, not queued and not
     * logged. There is nothing afterwards to notice it went missing.
     *
     * `truthy` and not `Number`, deliberately: this interpreter's booleans can
     * arrive as the STRING "false", which is truthy by its own rule (interp.ts)
     * and which `Number()` would turn into NaN and read as unlocked. The engine
     * asks `truthy(globals.get("lockevents") ?? 0)`; so does this.
     */
    case "locked":
      return bare(`(() => {
        const v = window.dbg.session.interp.globals.get("lockevents") ?? 0;
        return typeof v === "number" ? v !== 0 : String(v).length > 0;
      })()`);
    /**
     * A script is sitting in an input poll loop RIGHT NOW — `while not button()`,
     * `while stilldown()` — waiting for the mouse rather than for the engine.
     *
     * The engine keeps this itself (`GameSession.pollingInput`) because such a
     * press must not also go in the event queue, and it answers the one question
     * a held press needs: has the loop I am holding this down for noticed yet.
     * `!polling` after it was polling is that loop letting go.
     */
    case "polling":
      return bare(`window.dbg.session.pollingInput()`);
    case "talking":
      return bare(`!!(window.dbg.viewer && window.dbg.viewer.conversing)`);
    case "nomovie":
      return bare(`!(window.dbg.viewer && window.dbg.viewer.moviePlaying)`);
    /**
     * A film is on screen, asking or not.
     *
     * Distinct from `asking` (parked on regions) and from `nomovie`, and needed
     * because a close-up is FETCHED OVER HTTP: for a moment after the click there
     * is no movie yet, so "no movie" is true and an ESC sent then hits nothing at
     * all. Measured — four ESCs landed in that gap, the film then loaded and
     * parked, and the next key press sat against it for 2m10s.
     */
    case "playing":
      return bare(`!!(window.dbg.viewer && window.dbg.viewer.moviePlaying)`);
    case "movie":
      return reads(`String((window.dbg.viewer && window.dbg.viewer.movieFile) || "").toLowerCase()`);
    case "asking":
      return bare(`!!(window.dbg.viewer && window.dbg.viewer.movieRegions.length)`);
    case "theme":
      return reads(`String(window.dbg.session.currentThemeName || "").toLowerCase()`);
    /**
     * The escape hatch, and the only condition whose operand is not a name.
     * `js == <expression>` — everything after the operator is handed through.
     */
    case "js":
      if (!value) throw new Error(`js needs an expression — \`js == window.dbg.session.frameCounter > 0\``);
      return `(${op === "!=" ? `!(${value})` : value})`;
    default:
      throw new Error(
        `unknown condition "${text}" — try set == , scene == , view == , flat == , noflat, ` +
          `global.name == v, owns.prop, actor.name, actor.name == owner, visible.name, ` +
          `walking.name, quiet, talking, nomovie, movie == , asking, theme == , faded, locked, ` +
          `or js == <expression>`,
      );
  }
}

/** a condition, optionally negated — `!walking.morrow`, `!locked` */
const condition = (text: string): string => {
  const negated = text.trim().startsWith("!");
  const body = negated ? text.trim().slice(1) : text;
  return negated ? `!(${predicate(body)})` : predicate(body);
};

/* ------------------------------------------------------------------ *
 * Conversation
 * ------------------------------------------------------------------ */

/** everything a conversation turn needs, in one round trip */
const TALK_STATE = `(() => {
  const v = window.dbg.viewer;
  if (!v) return { conversing: false };
  return {
    conversing: !!v.conversing,
    with: v.conversingWith || "",
    awaiting: !!v.awaitingChoice,
    speaking: !!v.speaking,
    choices: (v.choices || []).map((c) => ({ id: c.id, text: c.text })),
    rects: (v.choiceRects || []).map((r) => ({ x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) })),
    regions: (v.movieRegions || []).length,
    playing: !!v.moviePlaying,
  };
})()`;

interface TalkState {
  conversing: boolean;
  with?: string;
  awaiting?: boolean;
  speaking?: boolean;
  choices?: { id: number; text: string }[];
  rects?: { x: number; y: number }[];
  regions?: number;
  playing?: boolean;
}

/**
 * Hold up your end of a conversation as fast as the puppet will let you.
 *
 * Same shape as `nav/converse.ts` and deliberately so — the bevel ids are the
 * script's own numbers, so a sheet reads against the decompiled PUP the same way
 * a route does. What differs is the pacing: the route's `skipLine` waits a flat
 * 120 ms per press, this presses on the {@link ActionContext.gap} and re-reads
 * cheaply.
 *
 * The one rule that is not about speed: ESC is pressed ONLY while a line is
 * actually being spoken. At a plaque the same key answers -1 and walks the
 * player out of the conversation (#131), so a blind ESC hammer through a
 * conversation does not skip it fast — it abandons it, and the story quietly
 * does not happen. `arm` on the hammer is that rule.
 */
async function converse(
  c: ActionContext,
  bevels: number[],
  otherwise: "stop" | "first" | "last",
): Promise<void> {
  const { d } = c;
  const wanted = [...bevels];
  const picked: number[] = [];
  const maxTurns = Number(c.step.opts.maxturns ?? 60);
  const deadline = Date.now() + c.budget;

  const left = () => Math.max(1000, deadline - Date.now());

  for (let turn = 0; turn < maxTurns; ) {
    if (Date.now() > deadline) {
      throw new Error(
        `conversation ran past its ${c.budget} ms budget (picked ${picked.join(",") || "nothing"})`,
      );
    }
    const s = await d.evaluate<TalkState>(TALK_STATE);
    /**
     * A FILM FIRST, and before asking whether the conversation is still going.
     *
     * `conversing` is `puppet.visible`, and a `spotmovie` is a film played over a
     * suspended puppet — so during one the answer to "are we talking" is neither
     * reliably yes nor meaningfully no. The playthrough says as much at this very
     * beat: it waits on `d.conversing() || d.moviePlaying()`, the two as
     * ALTERNATIVES (segments.ts, segment 24, Zeitel at the top of the stack).
     *
     * Behind the `conversing` test, the skip below never ran. In front of it, it
     * does not matter which way that flag falls — and "the conversation ended"
     * stops being a conclusion this loop can reach while there is still a film on
     * the screen, which it never should have been.
     */
    if (s.regions) {
      // a movie over the conversation owns the clicks; get rid of it first
      await dismissMovie(c);
      continue;
    }
    /**
     * An INLINE CLIP — `spotmovie`, which suspends the puppet and plays a film.
     *
     * Waited out in full until now, and that is minutes: ZEIT1.PUP's `willie`
     * runs `spotmovie("berg.mov")` between the second plaque and the notebook,
     * and the loop had no branch for it — not `speaking`, not `awaiting`, not
     * parked on regions — so it sat there until the iceberg had finished.
     *
     * ESC is safe here in a way it is nowhere else in this function, and the
     * engine is what makes it safe rather than our timing: `SetViewer.keyDown`
     * tests `movies.playing` FIRST and hands the key to the clip, ahead of the
     * puppet branch, so while a film is up a press cannot reach a plaque however
     * late it lands. That is the whole hazard the one-ESC-per-line rule below
     * exists to dodge, and it does not exist while this is true.
     *
     * Hammered through the same gate `skipMovie` uses: `arm` is SHOWING, so it
     * presses only while a clip is up AND not asking. A `spotmovie` that carries
     * regions is a question — the Smethells briefing's penote.mov — and that is
     * the branch above, answered with a click and not with an abort.
     */
    if (s.playing) {
      const n = await d.hammer("Escape", {
        until: `!(${SHOWING})`,
        arm: SHOWING,
        gap: c.gap,
        budget: left(),
        what: "the inline clip to end",
      });
      c.say(`skipped an inline clip (${n} ESC)`);
      continue;
    }
    if (!s.conversing) {
      if (wanted.length) {
        throw new Error(
          `conversation ended before saying ${wanted.join(",")} (picked ${picked.join(",") || "nothing"})`,
        );
      }
      c.say(`said ${picked.join(",") || "nothing"}`);
      return;
    }
    if (!s.awaiting) {
      /*
       * ONE Escape per spoken line — never a hammer.
       *
       * ESC means two different things inside a conversation and they are one
       * frame apart: while a line is being spoken it cuts the line short, and at
       * a plaque it answers -1 and LEAVES (#131). So a press that arrives a beat
       * late does not skip anything, it walks out of the conversation.
       *
       * Hammering made that likely rather than rare. At a 16 ms gap a two-second
       * line took ~125 presses, of which the first did all the work: `speakSkip`
       * resolves on it and the line ends. The rest were fired against a puppet
       * that was already moving on, and `p.speakSkip` is only nulled a tick after
       * the race resolves (puppet.ts) — so `speaking` reads true for a moment
       * after the line is over, the guard passes, and the extra ESC lands on the
       * plaques that just appeared.
       *
       * Reported as a conversation that "is not correctly skipped on the very
       * first run, and works fine afterwards", which is exactly the shape of a
       * race: a cold run fetches, allocates and compiles, and stretches that
       * moment past the gap far more often than a warm one does.
       *
       * So: press once, then WAIT for the line to be over before considering
       * another. It is also strictly less work — the other 124 presses never did
       * anything but risk this.
       */
      /**
       * The line is over — or something else has taken the screen.
       *
       * `moviePlaying` belongs in here and its absence is why the skip above
       * never ran. Between two spoken lines this loop parks in the second of the
       * holds below, waiting for the next line to start, with the whole remaining
       * budget to do it in. A `spotmovie` starting is not a line starting and was
       * not any of the other three conditions either, so the wait simply held —
       * for the length of the film — and the loop never came round to notice
       * there was one. berg.mov is 648 frames and 40 s of audio, all of it spent
       * inside a `tryHold` that could not see it.
       *
       * So: anything that takes the screen ends the wait, and the top of the loop
       * decides what it was. That is the rule the other three already followed.
       */
      const done = `(() => { const v = window.dbg.viewer; return !v || !v.conversing || v.awaitingChoice || (v.movieRegions || []).length > 0 || !!v.moviePlaying; })()`;
      const speaking = `!!(window.dbg.viewer && window.dbg.viewer.speaking)`;
      if (await d.evaluate<boolean>(speaking)) {
        await d.key("Escape", "none", left());
        // this line, and only this line: wait for it to have ended
        await d.tryHold(`(${done}) || !(${speaking})`, left());
      } else {
        // between lines, or before the first: nothing to skip yet, so wait for
        // the next line to start rather than pressing into the gap
        await d.tryHold(`(${done}) || (${speaking})`, left());
      }
      continue;
    }
    turn++;
    const choices = s.choices ?? [];
    let idx = wanted.length ? choices.findIndex((ch) => ch.id === wanted[0]) : -1;
    if (idx >= 0) {
      picked.push(wanted.shift()!);
    } else if (otherwise === "last") {
      idx = choices.length - 1;
    } else if (otherwise === "first") {
      idx = 0;
    } else {
      throw new Error(
        wanted.length
          ? `bevel ${wanted[0]} not offered by ${s.with || "them"}; got ${choices.map((ch) => `${ch.id}:${ch.text}`).join(" | ")}`
          : `unplanned choice from ${s.with || "them"}: ${choices.map((ch) => ch.text).join(" | ")}`,
      );
    }
    const at = (s.rects ?? [])[idx];
    if (!at) throw new Error(`no plaque rectangle for choice ${idx}`);
    await d.clickAt(at.x, at.y, "none");
    // only until the answer is TAKEN; the reply's lines get skipped above
    await d.hold(
      `!(window.dbg.viewer && window.dbg.viewer.awaitingChoice)`,
      `bevel ${idx} to be taken`,
      Math.max(1000, deadline - Date.now()),
    );
  }
  throw new Error(`conversation did not close in ${maxTurns} turns (picked ${picked.join(",") || "nothing"})`);
}

/* ------------------------------------------------------------------ *
 * Small shared gestures
 * ------------------------------------------------------------------ */

/** click a named thing, through the engine's own hit test */
async function clickThing(c: ActionContext, name: string, wait = c.wait): Promise<void> {
  const at = await c.d.aim("thing", name);
  if (!at) throw new Error(`nothing called "${name}" is clickable from here`);
  await c.d.clickAt(at.x, at.y, wait, c.budget);
}

/** the OK/exit plaque of a parked movie — the bottom-right button the artists drew */
async function dismissMovie(c: ActionContext): Promise<void> {
  const at = await c.d.evaluate<{ x: number; y: number } | null>(`(() => {
    const rs = (window.dbg.viewer && window.dbg.viewer.movieRegions) || [];
    if (!rs.length) return null;
    const ok = rs.find((r) => 460 >= r.x0 && 460 <= r.x1 && 352 >= r.y0 && 352 <= r.y1);
    const r = ok || rs[rs.length - 1];
    return { x: Math.floor((r.x0 + r.x1) / 2), y: Math.floor((r.y0 + r.y1) / 2) };
  })()`);
  if (!at) throw new Error("no movie is parked on a region to dismiss");
  await c.d.clickAt(at.x, at.y, c.wait, c.budget);
}

/* ------------------------------------------------------------------ *
 * The planner escape hatch
 * ------------------------------------------------------------------ */

/** what `travel`/`hunt`/`stand` need, when a host can provide it */
export type PlannerFn = (
  c: ActionContext,
  method: "travel" | "hunt" | "stand",
  target: string,
) => Promise<void>;

let plannerImpl: PlannerFn | null = null;

/**
 * Install the pathfinder. Only the Playwright runner can.
 *
 * `travel`, `hunt` and `stand` run the real {@link Navigator}, which needs the
 * Node-side browser driver — and that parses `.SET` files off disk to plan with.
 * A page has no disk, so these three verbs simply do not exist there, and saying
 * so plainly is better than shipping a half-planner that explores differently.
 *
 * Which is not the loss it sounds like: all three are ESCAPE HATCHES that print
 * the literal gestures they used precisely so a sheet can stop needing them. A
 * sheet that still contains one is a sheet that has not been finished, and the
 * page is where you finish it.
 */
export function setPlanner(fn: PlannerFn | null): void {
  plannerImpl = fn;
}

async function planner(c: ActionContext, method: "travel" | "hunt" | "stand", target: string): Promise<void> {
  if (!plannerImpl) {
    throw new Error(
      `\`${method}\` needs the pathfinder, which only the Playwright runner has. ` +
        `Run this sheet with \`npm run speedrun\` to get the literal gestures it would use, ` +
        `then paste those in and the line will work here too.`,
    );
  }
  return plannerImpl(c, method, target);
}

/* ------------------------------------------------------------------ *
 * Load points
 * ------------------------------------------------------------------ */

/**
 * Start from a savegame instead of playing up to it.
 *
 * Iteration, not measurement — and the difference matters enough to say plainly.
 * A `.ti` is NOT a snapshot of the running game: its variable table is
 * fixed-size, so globals that do not fit are dropped; its skeleton is a SHIPPED
 * save, so slots nothing overwrites still hold that save's values; `actorvalue`
 * has no record at all; and the load rebuilds loops, crickets, music and actor
 * positions by re-running the room's own openset/openscene at the restored
 * progress. All faithful — the original reloads the same way — but it means a
 * game reached by loading is not the game a player would be standing in, so a
 * time measured from a load point is not a time. Route with it, time without it.
 *
 * The load is FIRED and then polled rather than awaited, which is not fussiness:
 * a restored room may `delay()`, and a restored lounge can open a conversation
 * from its own openscene and sit inside it waiting for an answer — so the
 * dispatch does not resolve until the story moves, and awaiting it hangs.
 *
 * The flags live on `window` and not on `dbg`, because `window.dbg` is a getter
 * that builds a fresh object per read: a property set on one read is gone by the
 * next.
 */
async function loadPoint(c: ActionContext, name: string): Promise<void> {
  if (!c.d.getSave) throw new Error(`this runner has no load points`);
  const bytes = await c.d.getSave(name);
  if (!bytes) {
    throw new Error(
      `no load point called "${name}" — reach it once and put save(${name}) there first`,
    );
  }

  // THE GAME HAS TO HAVE STARTED, and this is a guard rather than a courtesy.
  //
  // `restoreProps` applies a record only to a prop that already exists — the
  // shops are the game's, not the file's — and a record with nowhere to go is
  // dropped without a word. Load before the boot has run `openshop`, as the
  // workbench invites you to by putting a checkpoint chip on screen the moment
  // the canvas lights up, and all 72 records go nowhere: the game arrives in the
  // right room, at the right standpoint, carrying nothing, with an empty
  // inventory band and no way to tell why.
  //
  // A boot in flight is given a moment first, because a page a second old is
  // mid-logo rather than wrong. What it cannot wait out is the title menu, which
  // is parked on its own regions waiting for a click that a wait will never
  // supply — so that case is named, with the gesture that answers it.
  const READY = `window.dbg.session.propRuntime.props.size > 0`;
  if (!(await c.d.evaluate<boolean>(READY)) && !(await c.d.tryHold(READY, 8000))) {
    const parked = await c.d.evaluate<boolean>(predicate("asking"));
    throw new Error(
      parked
        ? `the title menu is still up, so the boot has not opened its prop shops — ` +
          `a game loaded here would carry nothing. Start a game first: ` +
          `intro(); skipMovie(until: awaiting); clickAt(266, 254)`
        : `the boot has not opened its prop shops yet — a game loaded here would ` +
          `carry nothing, with an empty inventory band`,
    );
  }
  await c.d.evaluate<boolean>(`(() => {
    const w = window;
    w.__srLoadDone = false;
    w.__srLoadError = "";
    w.dbg.session.track(w.dbg.host.loadSavedGame(new Uint8Array([${Array.from(bytes).join(",")}])))
      .then(() => { w.__srLoadDone = true; }, (e) => { w.__srLoadError = String(e); });
    return true;
  })()`);
  await c.d.hold(`window.__srLoadDone || window.__srLoadError`, `${name} to load`, c.budget);
  const err = await c.d.evaluate<string>(`window.__srLoadError || ""`);
  if (err) throw new Error(`loading ${name}: ${err}`);
  const at = await c.d.evaluate<string>(
    `String(window.dbg.session.interp.globals.get("mission") ?? "?") + "/" +
     String(window.dbg.session.interp.globals.get("phase") ?? "?")`,
  );
  c.say(`mission/phase ${at}`);
}

/* ------------------------------------------------------------------ *
 * The table
 * ------------------------------------------------------------------ */

const key = (name: string): ActionFn => async (c) => {
  await c.d.key(name, c.wait, c.budget);
};

/**
 * Where a movement key has left us, as one string — the standpoint, or the thing
 * that took the standpoint's place.
 *
 * Set, scene and view are the standpoint, and for almost every press they are the
 * whole answer.
 *
 * {@link move} confirms a press by the world moving, and for almost every press
 * "the world moved" is "I am standing somewhere else". Not for all of them. Walk
 * into the Purser's office and GSTAIR3's `dopuppet()` answers the ArrowUp by
 * playing `mainc.mov`, which PARKS on its regions — the set, the scene and the
 * view are all exactly where they were, and the run is now inside a film with a
 * suspended script behind it. The press landed perfectly and the proxy for it
 * cannot say so, so `up()` spent its budget waiting, pressed again into a parked
 * movie, and failed reporting that the world had not moved. It had; it had moved
 * somewhere the standpoint does not describe.
 *
 * The three additions are the three things a press can hand you to instead of a
 * room, and each is a state the engine will not leave on its own: a flat, a
 * movie, a conversation. `movieFile` rather than `moviePlaying` because a walk
 * that ends in a DIFFERENT clip is also a change; the boolean would read the same
 * through a cut from one to the next.
 *
 * This is only ever asked twice a press, either side of it, so it costs one
 * string compare and buys the whole class of doors that open onto a script.
 */
const WORLD = `(() => {
  const s = window.dbg.session, v = window.dbg.viewer;
  if (!v) return "?";
  return String(s.currentSetFile || "") + "/" + v.sceneIdx + "/" + v.viewIdx +
    "|" + String(s.currentFlat || "") +
    "|" + String(v.movieFile || "") +
    "|" + (v.conversing ? "talking" : "");
})()`;

/**
 * A movement key, confirmed by the world actually moving.
 *
 * `wait: ready` is not enough for these and cannot be made enough. The turn
 * animation does not start until the next rAF, so `quiescent` is still true from
 * BEFORE the press for a frame or two — a driver that waits on it reads the old
 * state, calls the gesture done, and walks on. Measured here at the very first
 * turn in the London flat: the arrow went in, the report said 0.0s, and the run
 * was still standing in View14 three actions later.
 *
 * Underneath that is the drop this whole harness is careful about: a press made
 * while a fade is ramping — and nothing else is — is silently discarded
 * (`SetViewer.pressNav`'s note; the queue asks `movingCamera` and the refusal
 * asks `inputLocked`, and the two differ by exactly `session.fading`). A
 * speedrun presses earlier than anything else ever has, so it meets that gap
 * constantly.
 *
 * So: press, then wait for the {@link WORLD} to change, and press again if it
 * does not — which is what a player who saw nothing happen does. `confirm: no`
 * opts out for the rare press that is deliberately expected to change nothing.
 */
/**
 * The engine is IDLE: it will act on the next gesture itself rather than filing
 * it, and there is nothing already filed.
 *
 * Shared by the verbs that need a gesture to LAND rather than merely survive.
 * `viewer.clickDispatch` diverts a click made while the engine is busy into the
 * event queue and returns — and a queued click is not a delayed click, it is a
 * click whose fate now belongs to whatever runs next. Scripts call
 * `flushevents()` in 92 places in this corpus and each one empties the queue;
 * measured on a single run, 74 events were dropped that way.
 *
 * That is how a click on Vlad went missing. `accost` aimed correctly — the hit
 * test named him, his cast script has a mousedown — and the dispatch never
 * reached him: the camera was still finishing the turn from the line before, so
 * `busyOnEntry` was true, the press was filed, and something flushed it. The
 * conversation opened five seconds later anyway, because he notices you on his
 * own, which is what made it look like a slow click rather than no click.
 */
const IDLE = `(() => {
  const s = window.dbg.session, v = window.dbg.viewer;
  if (!v) return false;
  return !v.inputLocked && s.events.length === 0;
})()`;

const move = (name: string): ActionFn => async (c) => {
  if (c.step.opts.confirm === "no") {
    await c.d.key(name, c.wait, c.budget);
    return;
  }
  /**
   * The engine is IDLE: it will act on the next press itself rather than filing
   * it, and there is nothing already filed.
   *
   * Used twice — as the precondition for pressing and as the proof that a press
   * is spent — because both questions are the same question.
   *
   * **Before pressing**, because a press made while the engine is mid-anything is
   * QUEUED rather than acted on (`keyDown` posts it coalescing when
   * `movingCamera`), and a queued press is a gesture with no owner. It is
   * replayed whenever the engine next gets round to it, which can be three lines
   * later in the middle of something else. That is not a theory; it is what this
   * traced:
   *
   *     L276 face(View47)              gym/0/6  q1 p3 t2   <- a press left filed
   *     L285 settle()                  gym/0/6  q1
   *     L288 wait(visible.penny)       gym/0/6  q1
   *     L289 accost(penny)             gym/0/6  q0 p4 t4   <- taken HERE, mid-hunt
   *
   * `face` turned, saw the view change and returned — but the change was the
   * PREVIOUS line's queued press being replayed, and its own press was still in
   * the queue. Two runs of one sheet came out 796 and 1014 frames apart on that
   * alone, and the same shape on an `up()` is the run walking a room further than
   * the sheet says.
   *
   * `KEY_SAFE` is not this and must not be confused with it: that gate asks
   * whether a press will SURVIVE, and queueing counts as surviving. For a
   * confirmed move, surviving is not enough — it has to be acted on now, so that
   * the movement we then wait for is unambiguously the one we asked for.
   *
   * **After pressing**, because a press that has produced nothing while the
   * engine is idle and its queue empty is gone for good, and pressing again
   * cannot double it. That is what replaced a pair of timers (wait 400 ms, guess
   * from a hand-picked part of the state, then allow 8 s): a fade is inside
   * `inputLocked` and was not inside the guess, so a door's `changeset` — which
   * queues a fade and lets the keydown chain end — read as "dead" while the room
   * was still arriving.
   *
   * Waiting costs nothing that was not already owed: a press made while a fade
   * ramps is dropped anyway (the note on `pressNav`), so the earliest a press can
   * work is the moment this goes true.
   */
  let before = "?";
  for (let press = 1; press <= 3; press++) {
    // Press only into an idle engine — see IDLE. This is also what makes the
    // WORLD reading below a fair "before": a reading taken while a move is still
    // in flight is a reading of somewhere we are about to leave.
    await c.d.hold(IDLE, `the engine to be ready for ${name}`, c.budget);
    before = await c.d.evaluate<string>(WORLD);
    const moved = `(${WORLD}) !== ${JSON.stringify(before)}`;
    // The move is DONE when the world has moved and nothing of ours is still
    // filed. Both halves, because either one alone is a bug that has happened:
    // the world moving is not proof the press was ours, and an empty queue is not
    // proof anything happened.
    const done = `(${moved}) && window.dbg.session.events.length === 0`;

    await c.d.key(name, "none", c.budget);
    // one wait, not three: whichever comes first, the move finishing or the press
    // running out of ways to make one
    await c.d.tryHold(`(${done}) || (${IDLE})`, c.budget);
    if (await c.d.evaluate<boolean>(done)) {
      if (press > 1) c.say(`${press} presses — ${press - 1} dropped`);
      if (c.wait !== "none") await c.d.settle(c.wait, `the ${name} move`, c.budget);
      return;
    }
  }
  /**
   * WHY it did not move, as far as the engine will say.
   *
   * "three presses and the world did not move" is true and useless: it names the
   * symptom of every refusal in the game at once. Each of these is a gate that
   * silently swallows a key, and the whole cost of naming them is one round trip
   * on a line that has already spent three presses and is about to fail.
   *
   * `lockevents` is first because it is the one nothing else reveals — `quiet`,
   * `faded` and `ready` all answer true straight through it (see the `locked`
   * condition), so a route can be waiting on exactly the right things and still
   * be pressing at a world that is not listening.
   */
  const why = await c.d.evaluate<string[]>(`(() => {
    const s = window.dbg.session, v = window.dbg.viewer, out = [];
    const l = s.interp.globals.get("lockevents") ?? 0;
    if (typeof l === "number" ? l !== 0 : String(l).length > 0) out.push("the world is FROZEN (lockevents)");
    // An OVERLAY STAGE is up, and an arrow key in one goes to the stage rather
    // than to the room. It is the most ordinary reason a walk does nothing and
    // it used to read as no reason at all, because a room has a flat too — the
    // HUD band, "main 1" — so the name alone cannot tell the two apart. Only
    // viewShowing can.
    if (!s.viewShowing && s.currentFlat && s.currentFlat !== "none") {
      out.push('the overlay stage "' + s.currentFlat + '" is up, so the room is not showing');
    }
    if (!v) out.push("there is no viewer");
    else {
      if (v.moviePlaying) out.push("a movie is on screen" + (v.movieRegions.length ? " and parked on regions" : ""));
      if (v.conversing) out.push("a conversation is open");
    }
    if (s.fading) out.push("a fade is ramping");
    if (s.scriptBusy) out.push("a script is running");
    if (s.events.length) out.push(s.events.length + " event(s) still queued");
    return out;
  })()`).catch(() => []);
  throw new Error(
    `three ${name} presses and the world did not move (still at ${before})` +
      (why.length ? ` — ${why.join(", ")}` : ` — and nothing is refusing it, so the press landed and there is simply nowhere to go`),
  );
};

export const ACTIONS: Record<string, Action> = {
  // -- raw input ------------------------------------------------------------
  left: {
    args: [0, 0], wait: "none", opts: ["confirm"],
    sig: "left()",
    help: "turn left (ArrowLeft), confirmed by the view changing",
    run: move("ArrowLeft"),
  },
  right: {
    args: [0, 0], wait: "none", opts: ["confirm"],
    sig: "right()",
    help: "turn right (ArrowRight), confirmed by the view changing",
    run: move("ArrowRight"),
  },
  up: {
    args: [0, 0], wait: "none", opts: ["confirm"],
    sig: "up()",
    help: "walk forward (ArrowUp), confirmed by the standpoint changing",
    run: move("ArrowUp"),
  },
  space: {
    args: [0, 0], wait: "ready", opts: ["confirm"],
    sig: "space()",
    help: "open the door you are facing (Space) — add wait(set == x) to confirm it",
    run: key(" "),
  },
  /**
   * A door, which is always the same three gestures — so it is one verb.
   *
   * Space opens what you are facing, ArrowUp walks through it, and the room
   * beyond has to have ARRIVED before the next line reads the world. Every door
   * in a sheet was those three lines, and writing them out invited two mistakes
   * that this spelling cannot make.
   *
   * The waits are the reason it is worth wrapping rather than aliasing, because
   * they are not the same for all three:
   *
   *   - the space waits `ready`, the fade gate. A door opening is exactly the
   *     ramp in which the NEXT key press is silently discarded (the note on
   *     `pressNav`), so walking without that gate is how an ArrowUp goes missing.
   *   - the walk waits for nothing, because {@link move} already confirms it by
   *     the standpoint changing and presses again if it did not. A settle here
   *     would be paid twice over, once in the middle and once at the end.
   *   - the settle at the end is `wait:`, so `door(wait: ready)` is available to a
   *     leg that is going straight on to another gesture and does not need the
   *     room to be finished.
   *
   * `confirm: no` passes through to the walk, for the rare door you expect to
   * stand still in.
   */
  door: {
    args: [0, 0],
    wait: "quiet",
    opts: ["confirm"],
    sig: "door()",
    help: "open the door you are facing and walk through it — space(), up(), settle()",
    run: async (c) => {
      await key(" ")({ ...c, wait: "ready" });
      await move("ArrowUp")({ ...c, wait: "none" });
      await c.d.settle(c.wait, "the room through the door", c.budget);
    },
  },
  esc: {
    args: [0, 0],
    wait: "none",
    sig: "esc()",
    help: "a single Escape keypress (skipMovie is the repeating version)",
    run: key("Escape"),
  },
  key: {
    args: [1, 1],
    wait: "ready",
    sig: "key(e)",
    help: "press any key by Playwright name (M, O, X, Escape)",
    run: async (c) => c.d.key(c.step.args[0], c.wait, c.budget),
  },

  // -- clicking -------------------------------------------------------------
  click: {
    args: [1, 1],
    wait: "taken",
    sig: "click(cards)",
    help: "click a named thing — hotspot, character, prop or flat region",
    run: async (c) => clickThing(c, c.step.args[0]),
  },
  clickspot: {
    args: [1, 1],
    wait: "taken",
    sig: "clickSpot(door)",
    help: "click a view HOTSPOT by name, never a prop that happens to share it",
    run: async (c) => {
      const at = await c.d.aim("hotspot", c.step.args[0]);
      if (!at) throw new Error(`no hotspot "${c.step.args[0]}" in this view`);
      await c.d.clickAt(at.x, at.y, c.wait, c.budget);
    },
  },
  clickat: {
    args: [2, 2],
    wait: "taken",
    sig: "clickAt(169, 311)",
    help: "click a raw canvas pixel, 512x384 — for movie buttons with no name",
    run: async (c) => {
      const [x, y] = c.step.args.map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`clickAt needs two numbers`);
      await c.d.clickAt(x, y, c.wait, c.budget);
    },
  },

  /**
   * A press that is HELD — for the scripts that wait for a button by polling for
   * one instead of being handed one.
   *
   * `while not button()` is the shape, and INVEN1.STG's `dobook()` is the case
   * that named this verb. Putting the Rubaiyat down in a coal bunker goes: click
   * the inventory's OK, which runs `transfromflat()` and only THEN parks in
   *
   *     while not button ()
   *         propxy ("boilrubaiyat", pointx (mouse ()), pointy (mouse ()))
   *     endwhile
   *     if pointinprop ("boilbag", mouse ()) …    <- the drop, decided by WHERE
   *
   * — and `transfromflat`'s two fade ramps block the script for their ten ticks
   * each first. A click is milliseconds; by the time anything asks, the button
   * has been up for a third of a second and the loop parks for good. A player
   * never meets this because a player holds the button while they aim.
   *
   * `until` says what the press is being held FOR, and the default is `quiet` —
   * the engine going idle — because that is true of every one of these without
   * having to know the puzzle. It also covers the fade: the engine is busy for
   * the whole of `transfromflat`, so the hold outlasts it and is still down when
   * `dobook` finally asks.
   *
   * Naming a condition instead is worth it when you know one, but pick one that
   * can actually arrive. `until: !owns.rubaiyat` looks exactly right and hangs
   * whenever the drop lands back in the bag — `pointinprop("boilbag", mouse())`
   * hides the book again without changing its owner, so the condition is waiting
   * for something the gesture it describes has already decided against.
   *
   *     holdAt(150, 250)                    # until the game has finished reacting
   *     holdAt(150, 250, until: !polling)    # until the loop that wanted it lets go
   */
  holdat: {
    args: [2, 2],
    wait: "quiet",
    opts: ["until"],
    sig: "holdAt(150, 250)",
    help:
      "press a pixel and HOLD the button until a condition holds (default quiet) — for " +
      "the scripts that poll `button()`, like putting the Rubaiyat down",
    run: async (c) => {
      const [x, y] = c.step.args.map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`holdAt needs two numbers`);
      const goal = c.step.opts.until;
      const polling = predicate("polling");
      const idle = `!(${polling})`;
      /**
       * The default is a handshake in three parts, and each part is a bug that
       * happened.
       *
       * 1. WAIT FOR THE LAST GESTURE'S LOOP TO END. `polling` is true of any
       *    input loop, including the one the PREVIOUS click was still running:
       *    a click holds the button for three frames, `trackbut` spins
       *    `while stilldown()` for those frames, and the poll stays warm for
       *    four engine steps after. Arming on that pressed while the OK's own
       *    handler was mid-flight.
       * 2. WAIT FOR A NEW ONE TO START. That is the fade — `transfromflat` and
       *    its two ramps — after which `dobook` finally asks. Press before it
       *    and the press lands on the panel that has not gone away yet, takes
       *    hold of the item drawn under the cursor, and starts a
       *    `while stilldown()` loop that cannot end while the button is down:
       *    measured, the whole 120 s budget with `flat "inven 1"` still up.
       * 3. HOLD UNTIL IT LETS GO. Which is the press being taken.
       */
      let r;
      if (goal) {
        r = await c.d.holdAt(x, y, { until: condition(goal) }, c.budget);
      } else {
        await c.d.tryHold(idle, Math.min(c.budget, 5_000));
        r = await c.d.holdAt(x, y, { arm: polling, until: idle }, c.budget);
      }
      // A hold that gave up is a FAILURE, and saying so is most of what this verb
      // is for. It used to read as a success, so a condition that could never
      // arrive spent the whole budget looking like a working gesture and then
      // broke the next line instead — which is exactly how `!owns.rubaiyat` hides
      // a drop that landed back in the bag.
      if (!r.armed) {
        throw new Error(
          `nothing was waiting for a press at ${x},${y} — no script polled ` +
            `button() while it was held, so the hold did nothing. Is the gesture ` +
            `before this one the one that parks?`,
        );
      }
      if (!r.held) {
        throw new Error(
          `held the button at ${x},${y} for ${c.budget} ms and ` +
            `${goal ?? "the poll loop letting go"} never came true` +
            (goal ? ` — is it something this gesture can actually cause?` : ""),
        );
      }
      await c.d.settle(c.wait, `the hold at ${x},${y}`, c.budget);
    },
  },

  // -- movies ---------------------------------------------------------------
  skipmovie: {
    args: [0, 0],
    wait: "none",
    opts: ["until"],
    interruptible: true,
    sig: "skipMovie(until: quiet)",
    help: "hammer ESC through every playing cutscene, never one that is asking something",
    run: async (c) => {
      // the rule, one line: skip a movie that is PLAYING AND NOT WAITING. A movie
      // parked on its regions is the engine asking a question and its answer is
      // story — the boot menu's GAME/TOUR, a wireless telegram, a London close-up's
      // OK plaque. `arm` is that test; `until` is where the sheet wants to get to.
      const until = c.step.opts.until
        ? `(${condition(c.step.opts.until)})`
        : `!(${SHOWING})`;
      const n = await c.d.hammer("Escape", {
        until,
        arm: SHOWING,
        gap: c.gap,
        budget: c.budget,
        what: c.step.opts.until ? `${c.step.opts.until} (skipping clips)` : "the cutscene to end",
      });
      c.say(`${n} ESC`);
    },
  },
  movieok: {
    args: [0, 0],
    wait: "taken",
    sig: "movieOk()",
    help: "click the OK/exit region of a movie parked on its regions",
    run: dismissMovie,
  },
  /**
   * Answer a parked movie, by the name of the region rather than its place in the
   * list.
   *
   * A parked film is the engine asking a question, and its regions are the
   * answers — but only two of the three things a region carries are worth naming
   * it by. `target` is where a type-2 jumps to and `event` is the clip a type-3/4
   * chains into (SetViewer.movieRegions), and between them they say what the
   * answer DOES; the rectangle says only where it is drawn. So both are matched,
   * `target` first.
   *
   * The Purser is the case that asked for this. Walk into his office and
   * `dopuppet()` parks `mainc.mov` on five regions, one of them a type-2 named
   * "openit" — his window, and the only one that runs the clip on to the frame
   * that opens `purs1.pup`. By index that is `movieRegion(1)` and there is nothing
   * in the sheet to say why 1; by name it is the gesture the game's own author
   * wrote down.
   *
   * An index still works, and has to: plenty of parked films name nothing.
   *
   * The wait in front is the other half. A press that starts a clip returns as
   * soon as the clip starts, so the film is usually still PLAYING when the next
   * line runs and there is nothing parked to click yet — clicking there is a
   * click into a cutscene, which the engine takes as "skip" or ignores outright.
   * Waiting for the park is waiting for the question to be asked.
   */
  movieregion: {
    args: [1, 1],
    wait: "taken",
    sig: "movieRegion(openit)",
    help: "answer a parked movie by region name or 0-based index — movieRegion(openit)",
    run: async (c) => {
      const want = c.step.args[0];
      const parked = predicate("asking");
      if (!(await c.d.evaluate<boolean>(parked))) await c.d.tryHold(parked, c.budget);
      const found = await c.d.evaluate<{ x: number; y: number } | null>(`(() => {
        const rs = (window.dbg.viewer && window.dbg.viewer.movieRegions) || [];
        const want = ${JSON.stringify(want.toLowerCase())};
        const i = Number(want);
        const r = /^[0-9]+$/.test(want)
          ? rs[i]
          : rs.find((x) => String(x.target || "").toLowerCase() === want) ||
            rs.find((x) => String(x.event || "").toLowerCase().replace(/\.mov$/, "") === want.replace(/\.mov$/, ""));
        return r ? { x: Math.floor((r.x0 + r.x1) / 2), y: Math.floor((r.y0 + r.y1) / 2) } : null;
      })()`);
      // What IS parked, because "no region called openit" is half an answer and
      // the other half is one round trip away — and it is the half that gets the
      // line written.
      if (!found) {
        const rs = await c.d.evaluate<{ type: number; target: string; event: string }[]>(`(() => {
          return ((window.dbg.viewer && window.dbg.viewer.movieRegions) || [])
            .map((r) => ({ type: r.type, target: String(r.target || ""), event: String(r.event || "") }));
        })()`);
        const list = rs.length
          ? rs.map((r, i) => `${i}: type ${r.type}${r.target ? ` -> ${r.target}` : ""}${r.event ? ` (${r.event})` : ""}`).join(", ")
          : "nothing is parked — the movie is still playing, or there is no movie";
        throw new Error(`no movie region "${want}" here. Parked: ${list}`);
      }
      await c.d.clickAt(found.x, found.y, c.wait, c.budget);
    },
  },

  closeup: {
    args: [1, 1],
    wait: "none",
    opts: ["ok", "by"],
    sig: "closeUp(memory, by: esc)",
    help: "click a scoring object and close its film — by: ok walks the plaque, by: esc aborts it",
    run: async (c) => {
      const id = c.step.args[0];
      const okAt = (c.step.opts.ok ?? "460,352").split(",").map(Number);
      const before = await c.d.evaluate<number>(
        `Number(window.dbg.session.interp.globals.get("bombpoints") ?? 0)`,
      );
      // Deliberately NOT skipMovie, and this is the whole scoring rule rather
      // than caution: bedcards.mov pays +3 on each of its two action frames —
      // six of the eleven points that arm the bomb — and BEDSIT1 reads
      // actionframe(1) only AFTER spotmovie returns. An ESC before those frames
      // is simply a lower score, and eleven points is exactly what there is, so
      // one lost point is a raid that never comes and a run that waits forever.
      await clickThing(c, id, "taken");

      // by: esc — abort the film instead of walking it off the end.
      //
      // Worth the option because the SCORE does not depend on the film at all:
      // BEDSIT1 0001 adds the points inside the `case` of its mousedown, before
      // `spotmovie` is ever called, so the picture afterwards is just a picture.
      // Measured on `memory`: 2.9 s and ~58 engine frames to press the OK plaque,
      // 0.3 s and 6 frames to ESC it.
      //
      // NOT the default, and `cards` is why: its +3/+3 are paid for PASSING
      // THROUGH the frames named in the movie's header, which an abort skips. Any
      // object whose film you have to watch has to keep by: ok.
      //
      // The wait is the whole technique. A close-up is fetched over HTTP, so for
      // a moment after the click there is no film yet and an ESC sent then lands
      // on nothing — see the `playing` condition.
      if ((c.step.opts.by ?? "ok") === "esc") {
        await c.d.hold(predicate("playing"), `${id}'s close-up to start`, c.budget);
        const n = await c.d.hammer("Escape", {
          until: predicate("nomovie"),
          arm: predicate("playing"),
          gap: c.gap,
          budget: c.budget,
          what: `${id}'s close-up to be let go`,
        });
        const after = await c.d.evaluate<number>(
          `Number(window.dbg.session.interp.globals.get("bombpoints") ?? 0)`,
        );
        if (after === before) throw new Error(`${id} scored nothing — the raid needs all eleven points`);
        c.say(`${after} points, ${n} ESC`);
        return;
      }

      for (let ok = 0; ok < 12; ok++) {
        await c.d.hold(
          `(() => { const d = window.dbg; return d.viewer.awaitingInput || !d.session.scriptBusy; })()`,
          `${id}'s close-up`,
          c.budget,
        );
        // press OK only if OK is THERE — if a region of the parked film actually
        // covers that point. Otherwise 460,352 is a point in the ROOM, and a
        // stray click there once landed on `cards`, setting xxcards with no
        // close-up to score from: one point short at 10 of 11, no raid, no run.
        const onOK = await c.d.evaluate<boolean>(`(() => {
          const rs = window.dbg.viewer.movieRegions || [];
          return rs.some((r) => ${okAt[0]} >= r.x0 && ${okAt[0]} <= r.x1 && ${okAt[1]} >= r.y0 && ${okAt[1]} <= r.y1);
        })()`);
        if (!onOK) break;
        await c.d.clickAt(okAt[0], okAt[1], "taken", c.budget);
      }
      const after = await c.d.evaluate<number>(
        `Number(window.dbg.session.interp.globals.get("bombpoints") ?? 0)`,
      );
      // a click that leaves bombpoints where it was is a click that did not land
      if (after === before) throw new Error(`${id} scored nothing — the raid needs all eleven points`);
      c.say(`${after} points`);
    },
  },

  // -- conversation ---------------------------------------------------------
  talk: {
    args: [1, 1],
    bevels: true,
    wait: "none",
    opts: ["otherwise", "maxturns"],
    sig: "talk(purser[102,101])",
    help: "click someone and answer them — talk(purser[1,3,5])",
    run: async (c) => {
      await clickThing(c, c.step.args[0], "none");
      await c.d.hold(
        `!!(window.dbg.viewer && window.dbg.viewer.conversing)`,
        `${c.step.args[0]} to start talking`,
        c.budget,
      );
      await converse(c, c.step.bevels ?? [], (c.step.opts.otherwise as "stop" | "first" | "last") ?? "stop");
    },
  },
  /**
   * Answer a conversation — one that is open, or one that is about to be.
   *
   * `patience:` is the whole difference between answering a person you walked
   * up to and answering a person who walks up to YOU, and a literal route
   * through a populated ship needs the second.
   *
   * A puppet does not open on the frame the gesture lands. `STAIR2C.SET
   * runcsea()` dispatches `sendtoactor("csea", mousedown(0))` and the officer
   * becomes visible some frames later; a `say` placed immediately after the
   * move samples `conversing`, sees false, reports "said nothing" and returns —
   * and the NEXT move then cannot be pressed at all, because by then he is
   * talking and the engine refuses the key. Measured three times on the
   * second-class stair, each time one gesture past where the answer was put.
   *
   * So `patience` is "wait this long for someone to start, then answer them",
   * and its absence is "answer whoever is talking NOW". It is not a default:
   * waiting costs its full budget wherever nobody speaks, so it belongs on the
   * one line that expects an interruption and nowhere else.
   */
  say: {
    args: [0, 0],
    bevels: true,
    wait: "none",
    opts: ["otherwise", "maxturns", "patience"],
    sig: "say([102,101])",
    help: "answer a conversation — say([1,3,5]), or say(patience: 3000) for one that is still arriving",
    run: async (c) => {
      const patience = Number(c.step.opts.patience ?? 0);
      if (patience > 0 && !(await c.d.evaluate<boolean>(predicate("talking")))) {
        if (await c.d.tryHold(predicate("talking"), patience)) c.say("waited for them to start");
      }
      return converse(c, c.step.bevels ?? [], (c.step.opts.otherwise as "stop" | "first" | "last") ?? "stop");
    },
  },
  skiplines: {
    args: [0, 0],
    wait: "none",
    opts: ["until"],
    sig: "skipLines()",
    help: "ESC through spoken lines only — stops dead at a plaque rather than answering it",
    run: async (c) => {
      const until = c.step.opts.until
        ? `(${condition(c.step.opts.until)})`
        : `(() => { const v = window.dbg.viewer; return !v || !v.conversing || v.awaitingChoice; })()`;
      const n = await c.d.hammer("Escape", {
        until,
        arm: `!!(window.dbg.viewer && window.dbg.viewer.speaking)`,
        gap: c.gap,
        budget: c.budget,
        what: "the lines to run out",
      });
      c.say(`${n} ESC`);
    },
  },

  combo: {
    args: [1, Infinity],
    groups: true,
    wait: "none",
    opts: ["until", "max"],
    sig: "combo([256,300], [256,100], until: global.vladpower < -50)",
    help: "click a cycle of bracketed x,y points until a condition holds — combo([256,300], [256,210], until: …)",
    run: async (c) => {
      // The fight and the fencing are LIGHT GUNS: FIGHT.STG's stage mousedown
      // forwards the click to the `fists` prop, and `playerpunch(x, y, side)`
      // reads the blow out of the POINT. There is no button bar, so a punch is a
      // coordinate and a combo is a cycle of them — which is exactly what a sheet
      // should be able to say in one line and reorder in one edit.
      //
      // Cycling three DIFFERENT blows is not stylistic: FIGHT.SHP c76 `punch`
      // hands the turn back to Vlad and refuses him a counter for four
      // repetitions — three jabs, four crosses, a cross straight after a kick,
      // and a cross or uppercut on the same side twice running. A varied cycle
      // trips none of them, so he never swings back and the fight is
      // deterministic; only Vlad's blows roll dice.
      if (!c.step.opts.until) throw new Error(`combo needs an until: condition, or it would never stop`);
      const until = condition(c.step.opts.until);
      /**
       * ONE BRACKETED PAIR PER BLOW — `combo([256,300], [256,210])`.
       *
       * The brackets are the point. A sheet splits on every top-level comma, so
       * an unbracketed `combo(256,300, 256,210)` arrives as four arguments and
       * the pairing is left to the spacing — which is not something a reader can
       * check and not something a typo announces. (That spelling was this verb's
       * printed signature for a while and never once worked; it rejected its own
       * example with `"256" is not an x,y point`.)
       */
      const points = c.step.args.map((a) => {
        const m = /^\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]$/.exec(a);
        if (!m) {
          throw new Error(
            `"${a}" is not a point — combo takes bracketed pairs, combo([256,300], [256,210], until: …)`,
          );
        }
        return { x: Number(m[1]), y: Number(m[2]) };
      });
      const max = Number(c.step.opts.max ?? 400);
      const deadline = Date.now() + c.budget;
      let thrown = 0;
      for (; thrown < max; thrown++) {
        if (await c.d.evaluate<boolean>(`(() => !!(${until}))()`)) break;
        if (Date.now() > deadline) throw new Error(`combo ran past its ${c.budget} ms budget after ${thrown}`);
        /**
         * ONE BLOW PER IDLE ENGINE, and both halves of that are load-bearing.
         *
         * A click made while the engine is mid-anything is FILED rather than
         * acted on (see IDLE), and a filed click is one `flushevents()` away
         * from never having happened. That is not a lost click in isolation: the
         * step advances on every attempt, so a cycle whose blows are being
         * dropped comes apart — the same point lands three times running while
         * the ones between it are swallowed, which is exactly the shape reported
         * here ("low and uppercut are good but the jab is almost never
         * executed"). A varied combo that is not actually varied is the one
         * thing this verb exists to guarantee.
         *
         * And the pause is the other half. FIGHT.STG's fists mousedown opens
         * with `stoploop("prop", "vlad")` so that a blow interrupts whatever he
         * was about to do — and what he was about to do is the idle handler that
         * ENDS the fight (`if vladpower < -50` -> `sendtoflat(currentflat(),
         * endfight())`), armed on a loop of 2 to 40 ticks. A driver clicking as
         * fast as it can pump cancels that loop every time and starves its own
         * win condition: measured in the playthrough at 400 blows and
         * `vladpower` -520 with the flat still open. Waiting for idle is what
         * gives the loop its window, so raising `max` is the wrong lever — a
         * fight that needs more than a few hundred blows is not a slow fight, it
         * is one whose ending is being postponed by the clicking.
         */
        await c.d.tryHold(IDLE, Math.min(c.budget, 5_000));
        const p = points[thrown % points.length];
        await c.d.clickAt(p.x, p.y, "none", c.budget);
        if (c.gap) await c.d.sleep(c.gap);
      }
      if (thrown >= max) {
        throw new Error(
          `${max} clicks and ${c.step.opts.until} never came true — either the blows are ` +
            `not landing (a cycle the script REFUSES throws nothing) or the ending is on a ` +
            `timer the clicking keeps cancelling. Raising max: fixes neither.`,
        );
      }
      c.say(`${thrown} clicks`);
    },
  },

  /**
   * Click a named thing every time it comes back, until a condition holds.
   *
   * For the plaque a minigame puts between its rounds — the thing that has to be
   * pressed again and again for the game to keep going, and that a sheet cannot
   * count in advance because how many times it appears is the score.
   *
   * The fencing bout is the case. FENCE.STG walks the piste back to the middle
   * after every point and puts "en garde" (`startfence`) back up, and `fighting`
   * stays false until it is clicked — so a bout left alone stops dead after the
   * first point, whoever won it. Losing 0-5 on purpose therefore costs five
   * presses of a plaque whose appearances are exactly the thing being waited for,
   * and `wait(global.fencecount == 1)` on its own waits for something that will
   * never happen.
   *
   * Nothing else, deliberately. It clicks the ONE thing it was named and only
   * when the engine's own hit test offers it, so between presses it throws no
   * attacks — which is the whole technique for losing (`playeridle` reads the
   * block off the cursor's X, and after a click the cursor is where it clicked).
   * A verb that also lunged would win points by accident.
   */
  hammer: {
    args: [1, 1],
    wait: "none",
    opts: ["until", "max"],
    interruptible: true,
    sig: "hammer(startfence, until: global.fencecount == 1)",
    help: "click a named thing every time it reappears, until a condition holds — a minigame's between-rounds plaque",
    run: async (c) => {
      const name = c.step.args[0];
      if (!c.step.opts.until) throw new Error(`hammer needs an until: condition, or it would never stop`);
      const until = condition(c.step.opts.until);
      const max = Number(c.step.opts.max ?? 400);
      const deadline = Date.now() + c.budget;
      let taps = 0;
      for (;;) {
        if (await c.d.evaluate<boolean>(`!!(${until})`)) break;
        if (Date.now() > deadline) {
          throw new Error(
            `hammered ${name} ${taps} time(s) in ${c.budget} ms and ${c.step.opts.until} never came true`,
          );
        }
        if (taps >= max) throw new Error(`${max} clicks on ${name} and ${c.step.opts.until} never came true`);
        // Only when it is actually offered. `aim` is the engine's own hit test,
        // so "not there" and "there but under something" are the same answer and
        // both mean wait — a click sent into the gap is a click on whatever the
        // round is doing.
        const at = await c.d.aim("thing", name);
        if (at) {
          await c.d.clickAt(at.x, at.y, "none", c.budget);
          taps++;
        }
        await c.d.sleep(c.gap);
      }
      c.say(`${taps} clicks on ${name}`);
    },
  },
  accost: {
    args: [1, 1],
    wait: "none",
    opts: ["turns", "patience"],
    sig: "accost(penny)",
    help: "click someone until they actually start talking, turning if they are not in reach",
    run: async (c) => {
      // The browser-capable half of `hunt`. The pathfinder is Node-only because
      // it plans over `.SET` files read off disk, but the two things this needs —
      // the engine's own hit test (`aim`) and a turn — both exist in a page, so a
      // route does not have to give up the workbench to accost someone.
      //
      // It exists because a single `click` is genuinely not enough, and the
      // reason is worth stating: clicking a character starts a WALK to them and
      // the puppet only opens once they have been reached, so a click can be
      // taken, be aimed correctly, and still produce no conversation — the run
      // then waits ninety seconds for a line nobody is going to speak. Measured
      // on Penny in the gym, from the very standpoint the planner clicks her
      // from. Turning and trying again is what a player does.
      const who = c.step.args[0];
      const turns = Number(c.step.opts.turns ?? 8);
      const patience = Number(c.step.opts.patience ?? 8000);
      // Somebody talking to you already IS the accost, and checking costs one
      // round trip per turn.
      //
      // Half this game's characters open the conversation themselves. Morrow
      // heads you off on the boat deck the moment you arrive, and a run that
      // walks up and accosts him is a run standing inside an open puppet: the
      // engine is busy for as long as the conversation lasts, so the hit test
      // finds nothing clickable, and the turn this verb makes to look again
      // waits on an engine that will not be idle until the thing it is waiting
      // to cause has finished. Measured: 2m08s on one `accost(morrow)`, all of
      // it a single ArrowRight's hold, and the readout said "talking to
      // morrow1.pup" the whole time.
      //
      // WHO it is is reported rather than checked. The puppet's name is the
      // file's ("morrow1.pup") and the sheet's is the hotspot's, and inventing a
      // match between the two would turn a working line into a broken one for
      // every character whose two names differ. If the wrong person opened the
      // conversation, the bevel numbers on the next line will not be there and
      // `say` will say so — with this note directly above it in the report.
      const opened = `(() => {
        const v = window.dbg.viewer;
        return v && v.conversing ? String(v.conversingWith || "someone") : "";
      })()`;
      for (let turn = 0; turn <= turns; turn++) {
        const already = await c.d.evaluate<string>(opened);
        if (already) {
          c.say(turn ? `${turn} turns, then ${already} spoke first` : `already talking to ${already}`);
          return;
        }
        // Wait for the engine to be able to TAKE the click before making it: one
        // sent while the camera is still animating is filed rather than
        // dispatched, and a filed click is one `flushevents()` away from never
        // having happened (see IDLE).
        //
        // ONE press per standpoint, and that is measured rather than assumed.
        // Clicking Vlad in the boiler room takes 5.2 s to produce a conversation,
        // which reads exactly like a lost click — but pressing three times took
        // 10.7 s and still opened at the same moment. The delay is his: the click
        // lands, he stops shovelling and crosses the room, and the puppet opens
        // when he arrives. `patience` is what covers that walk, not a retry.
        await c.d.tryHold(IDLE, Math.min(patience, 8000));
        const at = await c.d.aim("thing", who);
        if (at) {
          // wait: none, deliberately. A click that OPENS a conversation is not
          // consumed in the ordinary way: the puppet suspends holding the
          // engine, and the press can sit in `GameSession.events` for as long
          // as the conversation lasts. Waiting for the queue to drain therefore
          // waits for the very thing the click just caused to finish — measured
          // in the page as "stuck waiting for click 242,106 to settle" while the
          // readout said, in the same breath, "talking to penny1.pup".
          //
          // The conversation opening IS the acknowledgement, so wait for that.
          await c.d.clickAt(at.x, at.y, "none", c.budget);
          if (await c.d.tryHold(predicate("talking"), patience)) {
            c.say(turn ? `${turn} turns` : "first look");
            return;
          }
        }
        if (turn === turns) break;
        await move("ArrowRight")({ ...c, wait: "none" });
      }
      throw new Error(`turned the whole ring and ${who} never started talking`);
    },
  },
  bailout: {
    args: [0, 0],
    wait: "none",
    sig: "bailOut()",
    help: "ESC out of a conversation entirely — answers the plaque -1 and walks away",
    run: async (c) => {
      // The deliberate use of the thing `skipLines` exists to avoid. ESC at a
      // plaque does not skip it, it ANSWERS it with -1 and ends the conversation
      // (#131) — which is a bug to a route that wanted the story and a technique
      // to a run that already has what it came for. Its own verb precisely so it
      // can never happen by accident: `skipLines` stops dead at a plaque, and
      // only this one presses through one.
      //
      // Whatever the puppet would have said after the plaque is forfeit, so a
      // bail is only correct where the beat is already banked.
      const n = await c.d.hammer("Escape", {
        until: `!(window.dbg.viewer && window.dbg.viewer.conversing)`,
        arm: `!!(window.dbg.viewer && window.dbg.viewer.conversing)`,
        gap: c.gap,
        budget: c.budget,
        what: "the conversation to be walked out of",
      });
      c.say(`${n} ESC`);
    },
  },
  face: {
    args: [1, 1],
    wait: "none",
    opts: ["dir"],
    sig: "face(View55)",
    help: "turn until you are facing a named view — face view78",
    run: async (c) => {
      const want = c.step.args[0].toLowerCase();
      const dir = (c.step.opts.dir ?? "right") === "left" ? "ArrowLeft" : "ArrowRight";
      const viewNow = `String(window.dbg.viewer.scene.views[window.dbg.viewer.viewIdx].viewName || "").toLowerCase()`;
      for (let turn = 0; turn <= 8; turn++) {
        if ((await c.d.evaluate<string>(viewNow)) === want) {
          if (turn) c.say(`${turn} turns`);
          return;
        }
        await move(dir)({ ...c, wait: "none" });
      }
      throw new Error(
        `turned the whole ring and never faced ${want} — it is not a view of this ` +
          `scene. \`face\` only turns; \`stand(${want})\` turns AND walks between ` +
          `the scenes of this room.`,
      );
    },
  },
  climbstack: {
    args: [0, 0],
    wait: "none",
    sig: "climbStack()",
    help: "climb the false smokestack, solving whichever maze was drawn",
    run: async (c) => {
      // The one place the sheet cannot be literal, because the course is drawn
      // rather than authored: ENGINE.SET's keydown at View120 does
      // `mazenumber = random(4)`, and one of the sixteen (maze, entry) pairs is a
      // DEAD END — maze 4 into scene39 has both its neighbouring gaps shut on the
      // first floor, so a run that walked in there could only go back down.
      //
      // So the maze is read and solved. `planStack` breadth-firsts over
      // (level, position) using SMSTACK2's own `setupblocks()` table, and
      // `pickEntry` tries all four of smstack1's ways up and takes one that
      // solves — which is the choice smstack1 exists to offer.
      const { pickEntry } = await import("./nav/smokestack");
      const maze = await c.d.evaluate<number>(
        `Number(window.dbg.session.interp.globals.get("mazenumber") ?? 0)`,
      );
      const chosen = pickEntry(maze);
      if (!chosen) throw new Error(`maze ${maze} has no way up from any of the four entries`);
      c.say(`maze ${maze}, in at ${chosen.entry.scene}, ${chosen.plan.length} moves`);

      const sceneNow = `String(window.dbg.viewer.scene.sceneName || "").toLowerCase()`;
      const setNow = `String(window.dbg.session.currentSetFile || "").toLowerCase().replace(/\\.set$/, "")`;

      // in at the entry smstack1 offers
      await ACTIONS.face.run({ ...c, step: { ...c.step, args: [chosen.entry.stand], opts: {} } });
      await c.d.key("ArrowUp", "none", c.budget);
      await c.d.hold(`(${setNow}) === "smstack2"`, "the first floor of the stack", c.budget);

      for (const m of chosen.plan) {
        await ACTIONS.face.run({ ...c, step: { ...c.step, args: [m.view], opts: {} } });
        await c.d.key("ArrowUp", "none", c.budget);
        const arrived =
          m.to === "smstack3"
            ? `(${setNow}) === "smstack3"`
            : `(${setNow}) === "smstack2" && (${sceneNow}) === ${JSON.stringify(m.to)} ` +
              `&& Number(window.dbg.session.interp.globals.get("stacklevel")) === ${m.level}`;
        await c.d.hold(arrived, `${m.kind} to ${m.to} (level ${m.level})`, c.budget);
      }
      // The top is a CHANGESET, and the set name flips before the viewer that
      // serves it exists (see the note in `stand`). Returning on the name alone
      // hands the next line the departing room to read, so the climb is not over
      // until the arriving one is quiet.
      await c.d.settle("quiet", "the top of the stack to arrive", c.budget);
      const ended = await c.d.evaluate<string>(
        `String(window.dbg.session.currentSetFile || "") + " " + String(window.dbg.viewer.scene.sceneName || "")`,
      );
      c.say(`up in ${ended}`);
    },
  },

  // -- inventory ------------------------------------------------------------
  take: {
    args: [1, 1],
    wait: "quiet",
    sig: "take(ring)",
    help: "bag → item → OK, the three clicks that put something in your hand",
    run: async (c) => {
      const item = c.step.args[0].toLowerCase();
      const held = () => c.d.evaluate<string>(`String(window.dbg.session.interp.globals.get("handitem") ?? "")`);
      if ((await held()).toLowerCase() === item) return;
      // The band is a two-state thing and that costs a click: house.shp's bag
      // mousedown answers a `darkclosed` bag with activateinterface() and nothing
      // else, so the first click often only turns the lights on. A closed inventory
      // is an EXPECTED answer to it, not a fault — hence the retry.
      for (let i = 0; i < 3; i++) {
        if (await c.d.evaluate<boolean>(`!window.dbg.session.viewShowing && !!window.dbg.session.stageScript`)) break;
        await clickThing(c, "bag", "taken");
        await c.d.tryHold(`!window.dbg.session.viewShowing && !!window.dbg.session.stageScript`, 4000);
      }
      await c.d.settle("quiet", "the inventory", c.budget);
      await clickThing(c, item, "taken");
      if ((await held()).toLowerCase() !== item) {
        throw new Error(`clicked ${item} but "${await held()}" is in hand`);
      }
      await clickThing(c, "ok", "quiet");
    },
  },
  use: {
    args: [2, 3],
    wait: "quiet",
    sig: "use(package, on, vlad)",
    help: "drag the hand item onto something — use light on watch",
    run: async (c) => {
      const [item, ...rest] = c.step.args;
      const target = rest.filter((w) => w.toLowerCase() !== "on")[0];
      if (!target) throw new Error(`use needs something to use it ON`);
      const held = await c.d.evaluate<string>(`String(window.dbg.session.interp.globals.get("handitem") ?? "")`);
      if (held.toLowerCase() !== item.toLowerCase()) {
        await ACTIONS.take.run({ ...c, step: { ...c.step, args: [item] } });
      }
      const from = await c.d.aim("thing", item);
      const to = await c.d.aim("thing", target);
      if (!from) throw new Error(`the ${item} is not on screen to drag`);
      if (!to) throw new Error(`no ${target} to put the ${item} on from here`);
      await c.d.drag(from, to);
      await c.d.settle(c.wait, `${item} on ${target}`, c.budget);
    },
  },

  // -- dials ----------------------------------------------------------------
  dial: {
    args: [2, 2],
    wait: "quiet",
    sig: "dial(valve1, 10)",
    help: "set a named dial or lever to a number — dial boiler 6, dial coal 3",
    run: async (c) => {
      const [name, value] = c.step.args;
      const want = Number(value);
      if (!Number.isFinite(want)) throw new Error(`dial needs a number, got "${value}"`);
      const { TURBINE_DIALS, PATTY_DIALS, COAL_LEVER, turnDial, setLever } = await import("./nav/dials");
      const key = name.toLowerCase();
      // the coal lever slides and the rest turn, which is two different swings —
      // dials.ts keeps them apart and so must the lookup
      // the coal lever SLIDES and the rest turn, which is two different swings —
      // dials.ts keeps them apart and so must the lookup. It answers to both its
      // prop name (`slider`, which is what the goldens and TURBINE.SHP call it)
      // and to `coal`, which is the global it drives and what a route calls it.
      const isLever = key === "coal" || key === COAL_LEVER.prop;
      const control = TURBINE_DIALS[key] ?? PATTY_DIALS[key] ?? (isLever ? COAL_LEVER : undefined);
      if (!control) {
        const known = [...Object.keys(TURBINE_DIALS), ...Object.keys(PATTY_DIALS), "coal"];
        throw new Error(`no dial called "${name}" (there is ${known.join(", ")})`);
      }
      // dials.ts is written against a NavDriver, and the four members it actually
      // touches are the four below — so it gets those over the speedrun driver
      // rather than a second copy of the swing arithmetic. That arithmetic is the
      // part worth not duplicating: it knows the arc radius, the stop spacing and
      // which way round a dial reads, and a speedrun that got any of it wrong
      // would take an extra lap of the dial and call it a route problem.
      const adapter = {
        propDeg: (p: string) => degCache[p.toLowerCase()] ?? NaN,
        flow: () => flowCache,
        dragProp: async (p: string, next: (start: { x: number; y: number }) => { x: number; y: number } | null) => {
          const at = await c.d.aim("thing", p);
          if (!at) return false;
          // A cache REFILLED BETWEEN FRAMES, which is the whole trick. dials.ts
          // steers by reading the deg back after every move, and it asks for that
          // reading synchronously — it was written against the headless driver,
          // where a prop is a field on the live session and there is nothing to
          // wait for. Out here it is a round trip into the page, so the read has
          // to be done just BEFORE the question is asked rather than in answer to
          // it. Refilling here, right after the driver has waited out the frame
          // that consumed the last move, is that moment: `next` then reads a deg
          // the engine has actually settled on.
          //
          // Filling it only once before the press is what the first version did,
          // and it steers a dial by a photograph: the number never changes, so
          // the swing never turns round and never stops. valve3 asked for 7 wound
          // 2->19, 19->0, 0->19 across its three grabs and was called stuck.
          await c.d.dragProp(at, async () => (await refresh(), next(at)), c.budget);
          await refresh();
          return true;
        },
        log: (m: string) => c.say(m),
      };
      let degCache: Record<string, number> = {};
      let flowCache: Record<string, string | number> = {};
      const refresh = async () => {
        const s = await c.d.evaluate<{ degs: Record<string, number>; flow: Record<string, string | number> }>(`(() => {
          const s = window.dbg.session, degs = {};
          for (const shop of s.propRuntime.shops.keys())
            for (const g of s.propRuntime.shops.get(shop).shp.groups) {
              const p = s.propRuntime.get(g.name);
              if (p) degs[g.name.toLowerCase()] = Number(p.deg) || 0;
            }
          return { degs, flow: Object.fromEntries(s.interp.globals) };
        })()`);
        degCache = s.degs;
        flowCache = s.flow;
      };
      await refresh();
      const result = isLever
        ? await setLever(adapter as never, COAL_LEVER, want)
        : await turnDial(adapter as never, control as never, want);
      if (!result.ok) throw new Error(result.reason ?? `${name} would not reach ${want}`);
      c.say(`${name} = ${want}`);
      await c.d.settle(c.wait, `the ${name} dial`, c.budget);
    },
  },

  /**
   * Switch the wireless apparatus to transmit, and open the morse key.
   *
   * One verb rather than a run of lines, because the set cannot be worked by
   * lines. Sending Mr. Thayer's telegram costs four gestures in a fixed order and
   * the last of them is a loop:
   *
   *   - the BREAKER and the SENDER are one-move drags — `while stilldown()` loops
   *     that read the cursor's X (resp. Y) absolutely and snap on release, like
   *     the coal lever. Those two a `drag(from, to)` verb could just about say.
   *   - the TUNER cannot be said at all. It is the same swing-about-a-pivot
   *     ratchet as the turbine dials, two of the needle's 14..200 per step, and
   *     `openshop()` parks it at 200 while the transmit band is 34..40 — so it is
   *     roughly eighty swings, each aimed from the needle read back after the
   *     last one, and the drag has to be RELEASED in band because the held loop
   *     answers `tuned()` on its final iteration and that is what sets
   *     `propowner("tunerknob")`.
   *
   * And the order is not tidiness: `tuned()` branches on the breaker and the
   * sender before it looks at the band, so tuning first tunes to nothing, and the
   * tapper flat's `openflat()` only runs `setuptx()` if all three owners already
   * hold when it opens. Open the morse key first and it is a key that does
   * nothing and says nothing about why.
   *
   * All of that is nav/wireless.ts, which the playthrough suite drives too — so
   * this verb is an adapter and not a second copy, exactly as `dial` is over
   * nav/dials.ts. The cache underneath it is the same trick and for the same
   * reason: the module was written against the headless driver, where a prop is a
   * field on the live session, and out here every reading is a round trip. It is
   * refilled immediately before `next` is asked, which is the moment the driver
   * has just waited out the frame that consumed the last move.
   *
   * Every form starts at the desk (`wireless 1`). `wireless(tx)` ends on the
   * morse key, so the errand reads:
   *
   *     click(wireless); wireless(tx); key(e); click(ok); click(ok)
   *
   * and the per-control forms — `wireless(breaker, tx)`, `wireless(sender, on)`,
   * `wireless(tuner, tx)` — each open their close-up, work the one control and
   * come back to the desk, so the same errand spelled out is:
   *
   *     click(wireless)
   *     wireless(breaker, tx); wireless(sender, on); wireless(tuner, tx)
   *     click(tapper); key(e); click(ok); click(ok)
   */
  wireless: {
    args: [1, 2],
    wait: "quiet",
    sig: "wireless(tx)",
    help:
      "work the wireless set from the apparatus desk — wireless(tx) does the lot, or one " +
      "control at a time: wireless(breaker, tx|rx|off), wireless(sender, on|off), " +
      "wireless(tuner, tx|rx1|rx2|rx3)",
    run: async (c) => {
      const what = c.step.args[0].toLowerCase();
      const value = (c.step.args[1] ?? "").toLowerCase();
      const w = await import("./nav/wireless");
      const { switchToTransmit, setBreaker, setSender, tuneTo, openPanel, closePanel } = w;
      const { WIRELESS_MAIN, TX_BAND, RX_BANDS } = w;
      const at = await c.d.evaluate<string | null>(
        `(() => { const s = window.dbg.session; return !s.viewShowing && s.currentFlat ? String(s.currentFlat) : null; })()`,
      );
      if (at !== WIRELESS_MAIN) {
        throw new Error(
          `the wireless set is worked from the "${WIRELESS_MAIN}" flat and we are ` +
            `${at ? `in "${at}"` : "in the room"} — click(wireless) opens it`,
        );
      }
      let props: Record<string, { owner: string; value: number }> = {};
      let flat: string | null = null;
      const refresh = async (): Promise<void> => {
        const got = await c.d.evaluate<{
          props: Record<string, { owner: string; value: number }>;
          flat: string | null;
        }>(`(() => {
          const s = window.dbg.session, props = {};
          for (const shop of s.propRuntime.shops.keys())
            for (const g of s.propRuntime.shops.get(shop).shp.groups) {
              const p = s.propRuntime.get(g.name);
              if (p) props[g.name.toLowerCase()] = { owner: String(p.owner ?? ""), value: Number(p.value) };
            }
          return { props, flat: !s.viewShowing && s.currentFlat ? String(s.currentFlat) : null };
        })()`);
        props = got.props;
        flat = got.flat;
      };
      const adapter = {
        inFlat: () => flat,
        propOwner: (n: string) => props[n.toLowerCase()]?.owner ?? "",
        propValue: (n: string) => props[n.toLowerCase()]?.value ?? NaN,
        clickThing: async (n: string) => {
          const spot = await c.d.aim("thing", n);
          if (!spot) return false;
          // quiet, because every one of these clicks is a flat change with a fade
          // in it, and the module asks `inFlat()` the instant this returns
          await c.d.clickAt(spot.x, spot.y, "quiet", c.budget);
          await refresh();
          return true;
        },
        dragProp: async (n: string, next: (from: { x: number; y: number }) => { x: number; y: number } | null) => {
          const spot = await c.d.aim("thing", n);
          if (!spot) return false;
          await c.d.dragProp(spot, async () => (await refresh(), next(spot)), c.budget);
          await refresh();
          return true;
        },
      };
      await refresh();

      // The whole errand, which is what a route wants: three controls in the one
      // order that works, then the morse key.
      if (what === "tx") {
        if (value) throw new Error(`wireless(tx) takes no second argument — did you mean wireless(${value}, …)?`);
        const result = await switchToTransmit(adapter);
        if (!result.ok) throw new Error(result.reason ?? "the set would not switch to transmit");
        c.say(`needle ${adapter.propValue("tunerneedle")}, tapper ${adapter.propOwner("tapperdown")}`);
        await c.d.settle(c.wait, "the morse key flat", c.budget);
        return;
      }

      /**
       * One control, opened and put back.
       *
       * The three setters in nav/wireless.ts work the control and nothing else —
       * `switchToTransmit` is what wraps each in its panel. So each of these does
       * the same wrapping, which is what makes them sheet lines: every one starts
       * and ends at the desk, and a sheet can put them in any order it likes and
       * see where the set gets to.
       *
       * Which is the point of having them at all. `wireless(tx)` is the errand
       * and cannot show its working: when the needle will not come to band there
       * is no way to try the tuner twice, or to power the set and stop, or to
       * throw the breaker to rx and read the message stack. These are that.
       */
      const control =
        what === "breaker"
          ? {
              region: "breaker" as const,
              run: () => {
                if (!["tx", "rx", "off"].includes(value)) {
                  throw new Error(`the breaker settles on tx, rx or off — not "${value}"`);
                }
                return setBreaker(adapter, value as "tx" | "rx" | "off");
              },
            }
          : what === "sender"
            ? {
                region: "sender" as const,
                run: () => {
                  if (!["on", "off"].includes(value)) throw new Error(`the sender is on or off — not "${value}"`);
                  return setSender(adapter, value as "on" | "off");
                },
              }
            : what === "tuner"
              ? {
                  region: "tuner" as const,
                  run: () => {
                    // The transmit band, or one of the three receive bands. Which
                    // receive band is tuned decides which message `rx()` spells
                    // out, so they are numbered rather than lumped together.
                    const band =
                      value === "tx"
                        ? TX_BAND
                        : /^rx[123]$/.test(value)
                          ? RX_BANDS[Number(value[2]) - 1]
                          : null;
                    if (!band) {
                      throw new Error(
                        `the tuner takes a band: tx (${TX_BAND.lo}..${TX_BAND.hi}) or ` +
                          RX_BANDS.map((b, i) => `rx${i + 1} (${b.lo}..${b.hi})`).join(", ") +
                          ` — not "${value}"`,
                      );
                    }
                    return tuneTo(adapter, band);
                  },
                }
              : null;
      if (!control) {
        throw new Error(
          `wireless does tx (the lot), or one of breaker, sender, tuner — not "${what}". ` +
            `The amp panel is reachable with click(amp) and drives nothing.`,
        );
      }

      const open = await openPanel(adapter, control.region);
      if (!open.ok) throw new Error(open.reason ?? `the ${control.region} close-up would not open`);
      const set = await control.run();
      if (!set.ok) throw new Error(set.reason ?? `the ${control.region} would not go to "${value}"`);
      const back = await closePanel(adapter);
      if (!back.ok) throw new Error(back.reason ?? `the ${control.region} close-up would not close`);
      c.say(
        what === "tuner"
          ? `needle ${adapter.propValue("tunerneedle")}, knob ${adapter.propOwner("tunerknob")}`
          : `${what} ${adapter.propOwner(`${what}handle`)}`,
      );
      await c.d.settle(c.wait, `the ${control.region}`, c.budget);
    },
  },

  // -- travel ---------------------------------------------------------------
  mapjump: {
    args: [1, 1],
    wait: "none",
    opts: ["deck"],
    sig: "mapJump(gstair1, deck: bd)",
    // The reachable sets are read off MAP.STG's own red areas rather than typed
    // out here, so this list cannot go stale against the table that decides
    // whether a jump actually works.
    help:
      "the deck plan, as literal clicks: open, turn to the page, press the stairwell. Reaches " +
      [...jumpableSets()].sort().join(", "),
    run: async (c) => {
      const goal = c.step.args[0].toLowerCase();
      const deck = c.step.opts.deck ?? (await c.d.evaluate<string>(
        `String(window.dbg.session.interp.globals.get("savedeck") ?? "")`,
      ));
      const red = jumpTo(goal, deck);
      if (!red) {
        throw new Error(
          `no red area for ${goal} on any deck plan — the map reaches ${[...jumpableSets()].sort().join(", ")}`,
        );
      }
      // `deck:` is a PREFERENCE, not a constraint: `jumpTo` falls back to the
      // lowest page that has the set at all, so a deck the plan does not carry
      // lands somewhere else without failing. Silent, and it need not be — the
      // set a route wanted is reached either way, but which stairwell it came
      // out of decides the walk after it.
      if (deck && red.deck !== deck.toLowerCase()) {
        c.say(`no ${goal} on deck ${deck} — took deck ${red.deck} instead`);
      }
      const page = () =>
        c.d.evaluate<number | null>(
          `(() => { const m = /^map (\\d+)$/i.exec(String(window.dbg.session.currentFlat || "")); return m ? Number(m[1]) : null; })()`,
        );
      // TWO clicks, doing DIFFERENT things — so they must not be waited on the
      // same way. house.shp c609's mousedown switches on the map's own view:
      // "dark" runs activateinterface(), which lights the band and returns with
      // nothing to animate and nothing to load, and only "light" runs open().
      //
      // So waiting for the map PAGE after the first click waits for something
      // that click was never going to produce, and it always ran out: measured
      // here at a flat 4 s of the 5.3 s a map jump cost, and measured at 4.8 s
      // in the browser gate before nav/navigator.ts fixed the same bug. Wait for
      // "the band is lit OR the map is up" and it ends the moment either click
      // lands.
      const lit = `String((window.dbg.session.propRuntime.get("map") || {}).stateName || "") === "light"`;

      // WAIT FOR THE WORLD TO BE ABLE TO TAKE THE CLICK, before sending one.
      //
      // The same gate `key()` puts in front of a press (see SpeedrunDriver.key),
      // and missing here for the same reason it was missing there: the click is
      // sent, it is swallowed, and the only evidence is the four seconds spent
      // afterwards waiting for a map that was never going to open. Then the loop
      // below clicks again, it works, and the line costs 4 s more than it looks
      // like it should — reported as "it takes way too long until the map is
      // clicked; it's clickable, I don't know what we are waiting for".
      //
      // What makes a route hit it is a `changeset` in the line before. A
      // conversation whose last bevel changes the set — SASHA1.PUP's `want` 102,
      // handing over Vlad's package — ends when the puppet closes, which is
      // BEFORE the room it asked for has loaded and faded in. A click into that
      // gap reaches an engine that is not taking any.
      //
      // Bounded, and it does not fail if it runs out: a state that never goes
      // quiet leaves the loop below exactly as it was, retry and all.
      await c.d.tryHold(QUIET, Math.min(c.budget, 10_000));

      for (let i = 0; i < 3 && (await page()) === null; i++) {
        // `!wasLight` rather than `wasDark`, which is the same test for the two
        // states the map is normally in and a better one for every other: the
        // map only opens from `light`, so from ANY other state the first click
        // is the one that lights the band and "the band lit" is the outcome to
        // wait for. Asking `wasDark` gave a map caught in some third state — mid
        // animation, or not yet built — no early exit at all, and it spent the
        // whole 4 s. Waiting for the page alone is right when it was ALREADY
        // light, and only then, because that click opens it and a second one
        // would shut it again.
        const wasLight = await c.d.evaluate<boolean>(lit);
        await clickThing(c, "map", "taken");
        const answered = await c.d.tryHold(
          `/^map \\d+$/i.test(String(window.dbg.session.currentFlat || ""))${wasLight ? "" : ` || (${lit})`}`,
          4000,
        );
        // A click that did nothing costs the whole backstop, and until now it did
        // so in silence — the line simply took four seconds longer than it looks
        // like it should, with nothing in the report to point at. Say so, with
        // what the map was doing at the time, so the next one of these arrives
        // already diagnosed instead of as "it feels slow sometimes".
        if (!answered) {
          const now = await c.d.evaluate<string>(
            `String((window.dbg.session.propRuntime.get("map") || {}).stateName || "(no map prop)")`,
          );
          c.say(`click ${i + 1} on the map did nothing in 4 s — map state "${now}", retrying`);
        }
      }
      const on = await page();
      if (on === null) throw new Error(`the map would not open here (mapdisabled, or no bag/watch yet)`);
      if (on !== red.page) {
        const button = pageButton(red.page);
        if (!button) throw new Error(`no page button for deck plan ${red.page}`);
        await clickThing(c, button.region, "taken");
      }
      await clickThing(c, red.region, "none");
      // exitmap() runs the close animation and transfromflat() before the engine
      // consumes jumpset, so arriving takes a moment longer than the click.
      //
      // `quiet` and not merely "the right set, no flat": the arrival is still
      // FADING when those two become true, and a movement key pressed into a
      // fade is silently discarded (viewer.ts on `pressNav`). Handing over early
      // does not save the wait, it moves it — measured, the first `left()` after
      // a jump cost 2.0 s in three presses, two of them dropped, while every
      // later move in the same room cost 0.2 s. Waiting for the room to settle
      // here pays the fade once instead of guessing at it twice.
      await c.d.hold(
        `(${predicate(`set == ${goal}`)}) && (${predicate("noflat")}) && (${predicate("quiet")})`,
        `the jump to ${goal}`,
        c.budget,
      );
      c.say(`deck ${red.deck}`);
    },
  },
  travel: {
    args: [1, 1],
    wait: "none",
    sig: "travel(gym)",
    help: "PLANNER ESCAPE HATCH — pathfind to a set and print the literal lines it used",
    run: async (c) => planner(c, "travel", c.step.args[0].toLowerCase()),
  },
  hunt: {
    args: [1, 1],
    wait: "none",
    sig: "hunt(bag)",
    help: "PLANNER ESCAPE HATCH — turn/walk around a room until a thing is clickable",
    run: async (c) => planner(c, "hunt", c.step.args[0].toLowerCase()),
  },
  /**
   * Get to a named view, TURNING AND WALKING, without a pathfinder.
   *
   * `face` turns and only turns, so it can reach a view in the scene you are
   * standing in and no other. That is most rooms and it is not the top of the
   * smokestack: SMSTACK3.SET is four scenes of four views joined by four roads,
   *
   *     Scene42/View46 <-> Scene37/View47      Scene37/View48 <-> Scene38/View51
   *     Scene38/View52 <-> Scene39/View58      Scene39/View57 <-> Scene42/View45
   *
   * and the notebook is only takeable from Scene39/View55. Which of the four you
   * come up into depends on which ladder the maze route ended on, so a sheet
   * cannot write the turns down — `face(view55)` turned the whole ring and never
   * found it, because view55 was two rooms away.
   *
   * THE ROOM IS ALREADY PARSED, which is the whole trick. `travel` and `hunt`
   * need the pathfinder because a route between SETS is planned over `.SET` files
   * read off disk, and a page has no disk. But the set you are STANDING IN is in
   * memory — `viewer.set.scenes` and `viewer.set.transitions` — so a walk inside
   * one room needs nothing a page does not already have. Hence this plans here
   * and works in both hosts, and only falls through to the planner when the
   * target is somewhere else entirely.
   *
   * The plan is over SCENES, not views, and the gestures are `face` then `up`:
   * face already turns by real presses and confirms by the view NAME, so nothing
   * here has to know which way a turn ring runs — a fact that lives in the
   * scene's frame registers and would be one more thing to get wrong.
   */
  stand: {
    args: [1, 1],
    wait: "none",
    opts: ["set"],
    sig: "stand(view55, set: smstack3)",
    help: "get to a named view — turning, and walking between the scenes of this room if need be",
    run: async (c) => {
      const want = c.step.args[0].toLowerCase();
      /**
       * READ THE ROOM ONLY WHEN THERE IS ONE.
       *
       * `session.currentSetFile` is assigned BEFORE the new `SetViewer` is built
       * (host.ts: the name, then an `await ensureBooted()`, then the viewer), so
       * a changeset has a window in which the session names the arriving room and
       * `window.dbg.viewer` is still the departing one. A plan made in that window
       * is made from the old room's scenes and roads, and it is not obviously
       * wrong — it is a correct route through a room nobody is in.
       *
       * That is what it looked like: `planning in smstack3 (from scene65)`,
       * smstack3's name against smstack2's geometry, routed through a `view70`
       * that only exists downstairs. The room, sampled a moment later when the
       * step failed, was `smstack3 Scene39/View58` — one right turn from the
       * target and no roads at all.
       *
       * A settle closes the window, because a changeset is not quiet while it is
       * happening. This is exactly what `settle()`'s own help means by "needed
       * before anything that reads the world".
       */
      await c.d.settle("quiet", `the room before planning to ${want}`, c.budget);
      const room = await c.d.evaluate<{
        set: string;
        here: string;
        scenes: { name: string; views: { name: string; id: number }[] }[];
        roads: [number, number][];
      } | null>(`(() => {
        const v = window.dbg.viewer, s = window.dbg.session;
        if (!v || !v.set) return null;
        return {
          set: String(s.currentSetFile || "").toLowerCase().replace(/\.set$/, ""),
          here: String(v.scene.sceneName || "").toLowerCase(),
          scenes: v.set.scenes.map((sc) => ({
            name: String(sc.sceneName || "").toLowerCase(),
            views: sc.views.map((w) => ({ name: String(w.viewName || "").toLowerCase(), id: w.viewID })),
          })),
          roads: v.set.transitions.map((t) => [t.viewIDstart, t.viewIDend]),
        };
      })()`);
      /**
       * A VIEW NAME IS NOT UNIQUE ACROSS SETS, and this room is the reason to
       * say so out loud.
       *
       * The false smokestack has `scene39/view55` in BOTH `smstack2` (the nine
       * floors you climb) and `smstack3` (the top, where the notebook is). So
       * `stand(view55)` reached for one room and planned a correct route through
       * the other — through `view70`, a standpoint that exists only in smstack2 —
       * and reported turning a ring that was never going to contain it.
       *
       * `set:` is the guard. It costs a word and it turns "the walk went
       * somewhere strange" into "you are not where you think you are", which is
       * the fact that actually needed reporting: something before this line did
       * not finish.
       */
      const mustBe = (c.step.opts.set ?? "").toLowerCase();
      if (room && mustBe && room.set !== mustBe) {
        throw new Error(
          `stand(${want}) expects to be in ${mustBe} and this is ${room.set}` +
            (room.scenes.some((sc) => sc.views.some((w) => w.name === want))
              ? ` — which has a ${want} of its own, so the walk would have gone somewhere plausible and wrong`
              : ""),
        );
      }
      // No set in memory means no room to plan in — the planner's problem, if
      // this host has one.
      if (!room || !room.scenes.some((s) => s.views.some((w) => w.name === want))) {
        return planner(c, "stand", want);
      }

      // where every global view id lives, so a road can say which scene it joins
      const at = new Map<number, { scene: string; view: string }>();
      for (const sc of room.scenes) for (const w of sc.views) at.set(w.id, { scene: sc.name, view: w.name });
      const goal = room.scenes.find((s) => s.views.some((w) => w.name === want))!.name;

      // Breadth-first over scenes: each road is one `face(leave); up()`, and the
      // shortest chain of them is the fewest gestures, because every road costs
      // the same one walk however far apart the scenes are drawn.
      const steps: { face: string }[] = [];
      if (room.here !== goal) {
        const prev = new Map<string, { from: string; leave: string }>();
        const seen = new Set([room.here]);
        const queue = [room.here];
        while (queue.length) {
          const now = queue.shift()!;
          if (now === goal) break;
          for (const [a, b] of room.roads) {
            for (const [from, to] of [[a, b], [b, a]] as [number, number][]) {
              const side = at.get(from), other = at.get(to);
              if (!side || !other || side.scene !== now || seen.has(other.scene)) continue;
              seen.add(other.scene);
              prev.set(other.scene, { from: now, leave: side.view });
              queue.push(other.scene);
            }
          }
        }
        if (!prev.has(goal)) {
          throw new Error(
            `no way through this room from ${room.here} to ${goal} (where ${want} is) — ` +
              `its scenes are ${room.scenes.map((s) => s.name).join(", ")}`,
          );
        }
        for (let sc = goal; sc !== room.here; sc = prev.get(sc)!.from) steps.unshift({ face: prev.get(sc)!.leave });
      }

      // The room in every failure, because the plan is only ever as right as the
      // room it was made in — and which room that is has now been the answer
      // twice.
      const where = `${room.set} (from ${room.here})`;
      try {
        for (const step of steps) {
          await ACTIONS.face.run({ ...c, step: { ...c.step, args: [step.face] }, wait: "none" });
          await move("ArrowUp")({ ...c, wait: "none" });
        }
        await ACTIONS.face.run({ ...c, step: { ...c.step, args: [want] }, wait: "none" });
      } catch (e) {
        throw new Error(
          `${(e as Error).message}\n    planning in ${where} via ` +
            `${[...steps.map((s2) => s2.face), want].join(" -> ")}`,
        );
      }
      c.say(`${where}${steps.length ? `, ${steps.length} road(s): ` : ": "}${[...steps.map((s2) => s2.face), want].join(" -> ")}`);
      await c.d.settle(c.wait, `the walk to ${want}`, c.budget);
    },
  },

  // -- control --------------------------------------------------------------
  wait: {
    args: [1, Infinity],
    wait: "none",
    interruptible: true,
    sig: "wait(set == c73)",
    help: "wait for a condition — wait(set == c73), wait(global.phase == 2), wait(quiet)",
    run: async (c) => {
      const expr = c.step.args.map(condition).map((e) => `(${e})`).join(" && ");
      await c.d.hold(expr, c.step.args.join(" "), c.budget);
    },
  },
  /**
   * Stop here, and be resumable — a breakpoint in a sheet.
   *
   * The pointer is left on the line AFTER this one, which is the only choice
   * that works: leaving it on the `pause()` would make Resume pause again
   * immediately, and a breakpoint you cannot get past is a deadlock rather than
   * a tool.
   *
   * Ignored where there is nobody to resume it. An unattended CLI run steps over
   * it with a note, so a sheet can be left with breakpoints in it while a leg is
   * being worked on and still time end to end under `npm run speedrun`.
   */
  pause: {
    args: [0, 0],
    once: true,
    wait: "none",
    sig: "pause()",
    help: "stop here and wait for Play — a breakpoint. Ignored by the CLI runner",
    run: async (c) => {
      if (!c.d.pause) {
        c.say("nothing to pause in this runner — carrying on");
        return;
      }
      c.d.pause();
    },
  },
  settle: {
    args: [0, 0],
    wait: "quiet",
    interruptible: true,
    sig: "settle()",
    help: "wait until the engine is completely idle. Needed before anything that reads the world",
    run: async (c) => c.d.settle("quiet", "the world", c.budget),
  },
  intro: {
    args: [0, 0],
    wait: "none",
    sig: "intro()",
    help: "press past the Nightdive film and answer YES (English edition only)",
    run: async (c) => {
      const showed = await c.d.tryHold(`!!window.dbg && (!!window.dbg.intro || !!window.dbg.viewer)`, 20_000);
      if (!showed || !(await c.d.evaluate<boolean>(`!!window.dbg.intro`))) return;
      await c.d.rawKey("Escape");
      const asked = await c.d.tryHold(`!!window.dbg.intro && window.dbg.intro.regions().length > 0`, 30_000);
      if (!asked) {
        if (await c.d.evaluate<boolean>(`!window.dbg.intro`)) return; // pre-#171 film
        throw new Error("the nightdive intro never reached its question");
      }
      // YES rather than NO: "wants" navigates the page to gog.com, which is not
      // somewhere a run comes back from
      const at = await c.d.evaluate<{ x: number; y: number } | null>(`(() => {
        const r = window.dbg.intro.regions().find((b) => b.target === "yes");
        return r ? { x: Math.round((r.x0 + r.x1) / 2), y: Math.round((r.y0 + r.y1) / 2) } : null;
      })()`);
      if (!at) throw new Error('the ownership question has no "yes" button');
      await c.d.clickAt(at.x, at.y, "none");
      await c.d.hold(`!window.dbg.intro`, "the intro to let go", 30_000);
    },
  },
  /**
   * Write a checkpoint — AFTER the world has stopped moving.
   *
   * The settle is the whole correctness of this verb, and leaving it out was a
   * real bug rather than a missing nicety. `snapshotSave` reads the live engine
   * at the instant it is called, and a speedrun calls it one action after a
   * click whose script is still running — so the file recorded a game that had
   * taken the bag but not yet been given it. Measured, saving at the same point
   * with and without the settle and reloading each:
   *
   *     mid-flight   carried held=[trunkkey,bag,map]  ->  loaded held=[map]
   *                  bag frank/darkclosed/2d          ->  none/small/3d
   *     settled      carried held=[trunkkey,bag,map]  ->  loaded held=[trunkkey,bag,map]
   *
   * `none/small/3d` is not a lost record, which is what made this read as a
   * savegame-format limit: it is the SHIPPED TEMPLATE's own bag — the skeleton a
   * snapshot patches, whose slots keep the base's values wherever the live game
   * had nothing to say. So the band came back empty and the file looked fine.
   *
   * `wait: none` opts out, for a sheet that means to catch a moving game.
   */
  save: {
    args: [1, 1],
    rest: true,
    once: true,
    wait: "quiet",
    sig: "save(m1p2)",
    help: "write a load point here — save(m1p2), then load(m1p2) to start from it",
    run: async (c) => {
      const name = c.step.args[0];
      if (!c.d.putSave) throw new Error(`this runner cannot keep save files`);
      if (c.wait !== "none") await c.d.settle(c.wait, `the world before save(${name})`, c.budget);
      // snapshotSave reports what would not fit through `onLog` — a dropped
      // theme, a global with no free slot. That is the one moment anybody wants
      // to hear it, and the game log is not where a sheet author is looking, so
      // it is captured here and put in the run report.
      const got = await c.d.evaluate<{ bytes: number[] | null; notes: string[] }>(`(() => {
        const s = window.dbg.session;
        const notes = [];
        const prev = s.onLog;
        s.onLog = (m) => { notes.push(String(m)); if (prev) prev(m); };
        let b = null;
        try { b = s.snapshotSave(); } finally { s.onLog = prev; }
        return { bytes: b ? Array.from(b) : null, notes: notes.filter((n) => /^savegame:/.test(n)) };
      })()`);
      if (!got.bytes) throw new Error(`the engine would not produce a save here`);
      await c.d.putSave(name, new Uint8Array(got.bytes));
      c.say(`${(got.bytes.length / 1024).toFixed(1)} kB`);
      for (const note of got.notes) c.say(note.replace(/^savegame: /, ""));
    },
  },
  /**
   * Put the game back to the very beginning — a checkpoint whose state is the
   * boot.
   *
   * IDEMPOTENT, and that is what makes it usable as the first line of a sheet.
   * If the game has not been started yet it does nothing at all, so a sheet
   * opening `reset()` costs nothing on a fresh page and costs a reload on the
   * second attempt — which is exactly the difference between the two, and
   * exactly what a runner starting over does by hand.
   *
   * "Not started yet" is asked as "has the boot opened its prop shops", because
   * that is the thing a beginning actually lacks: `openshop` runs when the title
   * menu's GAME region is clicked, so an empty prop table means the logos or the
   * menu are still up and nothing has happened. It is the same question `load()`
   * asks before it will restore into a session, for the same reason.
   *
   * A reload rather than a second `coldBoot`, because only a reload is honestly
   * the beginning: `coldBoot` assumes a fresh session, and re-running it over a
   * played game would leave that game's globals, cast, open shops and scheduler
   * tables underneath — a state no player can be in.
   */
  reset: {
    args: [0, 0],
    once: true,
    wait: "quiet",
    sig: "reset()",
    help: "boot the game from the beginning — does nothing if it is already there",
    run: async (c) => {
      const started = await c.d.evaluate<boolean>(
        `!!(window.dbg && window.dbg.session) && window.dbg.session.propRuntime.props.size > 0`,
      );
      if (!started) {
        c.say("already at the beginning");
        return;
      }
      if (!c.d.restart) throw new Error(`this runner cannot restart the game`);
      c.say("reloading");
      // In the workbench this never returns — the reload takes the run with it,
      // and the page resumes itself on the other side. Under Playwright the run
      // is outside the page and simply carries on, so the waits below are real.
      await c.d.restart();
      await c.d.hold(`!!(window.dbg && window.dbg.viewer)`, "the game to come back up", c.budget);
      await c.d.settle("quiet", "the fresh boot", c.budget);
    },
  },
  load: {
    args: [1, 1],
    rest: true,
    once: true,
    wait: "quiet",
    sig: "load(m1p2)",
    help: "start from a load point written by save() — load(m1p2)",
    run: async (c) => loadPoint(c, c.step.args[0]),
  },
  mission: {
    args: [1, 1],
    once: true,
    wait: "quiet",
    opts: ["phase"],
    sig: "mission(1, phase: 2)",
    help: "jump to a mission and phase — mission(1, phase: 2) loads the point named m1p2",
    run: async (c) => {
      const n = Number(c.step.args[0]);
      const phase = Number(c.step.opts.phase ?? 0);
      if (!Number.isFinite(n) || !Number.isFinite(phase)) {
        throw new Error(`mission takes numbers — mission(1, phase: 2)`);
      }
      await loadPoint(c, `m${n}p${phase}`);
    },
  },
  split: {
    args: [1, 1],
    rest: true,
    once: true,
    wait: "none",
    sig: "split(flat scored)",
    help: "a stopwatch split: close this segment, name it, print its time. Does nothing to the game",
    run: async () => {
      /* the runner handles splits; this exists so the verb parses and reports */
    },
  },
  note: {
    args: [1, 1],
    rest: true,
    once: true,
    wait: "none",
    sig: "note(anything at all)",
    help: "a note in the report; does nothing to the game",
    run: async (c) => c.say(c.step.args[0]),
  },
};

/** the grammar half of the table, for the parser */
export const VERBS: Record<string, VerbSpec> = Object.fromEntries(
  Object.entries(ACTIONS).map(([name, a]) => [
    name,
    {
      args: a.args, bevels: a.bevels, groups: a.groups, opts: a.opts, rest: a.rest,
      once: a.once, sig: a.sig, help: a.help,
    },
  ]),
);

/**
 * Sheet spelling is camelCase and lookup is lowercase, so `skipMovie` and
 * `skipmovie` are the same verb. Sheets read better in camel; a table keyed on
 * case is a class of typo nobody should have to debug.
 */
export const resolve = (verb: string): Action | undefined => ACTIONS[verb.toLowerCase()];
