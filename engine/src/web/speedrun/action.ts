/**
 * What a verb IS, and the pieces every verb is built out of.
 *
 * The vocabulary itself is two tables — the engine's ({@link CORE_ACTIONS},
 * beside this file) and each game's (`taoot/src/speedrun/actions.ts`) — and
 * this is what they are both written in: the shape of an action, the condition
 * compiler, the gestures that more than one verb needs, and the standing-watch
 * register.
 *
 * ## Why it is a table and not a switch
 *
 * A verb carries its GRAMMAR and its IMPLEMENTATION in one entry, so `sheet.ts`
 * can refuse a bad line at parse time and there is no way for a verb to be
 * parseable and not runnable. Adding a verb is one entry in one of the two
 * tables.
 *
 * ## Which table a verb goes in
 *
 * The question is not "is it useful to Titanic" but "could another game's route
 * mean it". `click(name)` asks the engine's own hit test where a named thing is,
 * and every DreamFactory game has one; `dial(slider, 7)` is twenty-one stops of
 * a coal lever on a ship. So the first is here and the second is Titanic's, and
 * the seam is not a matter of taste — a verb in the wrong table is either a game
 * fact the engine asserts about every disc, or a gesture Dust has to reimplement
 * to say the same thing.
 *
 * The bar for moving one across later is low: the tables are composed at the
 * call site ({@link composeActions}), so a verb migrates by moving its entry.
 *
 * ## Nothing here reaches past the player
 *
 * Every verb bottoms out in a mouse or key event at the canvas. Where a verb
 * needs to know something — where `cards` is, which plaque is bevel 3 — it asks
 * the engine the same question the browser suites ask, through the same
 * {@link aim} sweep, and never moves the game by writing to it.
 */
import { SheetError, type Step, type VerbSpec } from "./sheet";
import type { SpeedrunDriver, WaitMode } from "./driver";
import { SHOWING } from "./driver";

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
  /**
   * The vocabulary this run was started with — the core plus the game's.
   *
   * Here rather than imported, and that is the whole seam: `watchFor` PARSES its
   * action as a sheet line (which is what lets it take every verb rather than a
   * list of the ones somebody remembered to allow), so it needs to know what the
   * verbs are — and the answer is a fact about the run, not about the engine. A
   * module-level table is what this replaced, and under it a Dust sheet's
   * `watchFor` would have been parsed against Titanic's vocabulary.
   */
  verbs: Record<string, VerbSpec>;
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
   * Three verbs set it, and all three deliver nothing that can happen twice:
   * `wait` and `settle` only watch, and `skipMovie` presses ESC only while a
   * film is actually on screen and returns at once when its condition already
   * holds. They are also the long ones — a 300 s `skipMovie` covers Titanic's
   * whole crossing — so they are exactly the ones a Pause has to be able to
   * interrupt to feel like a button.
   * Everything else is stopped at the next line instead.
   */
  interruptible?: boolean;
};

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
  { name: "owns.<prop>", help: "the player is carrying it, e.g. owns.map" },
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
export const condition = (text: string): string => {
  const negated = text.trim().startsWith("!");
  const body = negated ? text.trim().slice(1) : text;
  return negated ? `!(${predicate(body)})` : predicate(body);
};

/* ------------------------------------------------------------------ *
 * Conversation
 * ------------------------------------------------------------------ */

/** everything a conversation turn needs, in one round trip */
export const TALK_STATE = `(() => {
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
 *
 * ## Two different questions, two different options (#265)
 *
 * `otherwise:` answers "the plaque offered is not the one I named". `then:`
 * answers "I have said everything I came to say". They used to be the same
 * `else` branch, which is why a bevel list had to run to the end of the
 * conversation or throw: a run that only needs a beat — Sasha hands over Vlad's
 * package on the third answer and the last two turns are pleasantries — could
 * not say so.
 *
 * They are kept apart because folding them together would make a MIS-TYPED bevel
 * walk out of a conversation instead of failing, which is the story quietly not
 * happening again, one letter at a time. A wrong bevel still hits `otherwise:`
 * and still stops the run.
 *
 * `then: leave` is one ESC AT THE PLAQUE, which is not a different mechanism
 * from answering -1 — it is the same one. `PuppetCtrl.key` (puppet.ts, quoting
 * 0x4418a7) calls `p.eventWaiter?.(-1)` for an ESC that arrives while the
 * choices are up, so the key IS the answer and there is nothing faster to send.
 * What it saves is the turns not taken: a click, the hold for the answer to be
 * taken, and every line the reply would have spoken.
 *
 * It is one press rather than {@link bailout}'s hammer because this loop already
 * knows the plaque is up — `awaiting` was read a line ago — and that is the one
 * moment ESC is unambiguous. Reach for `bailOut()` when nothing is holding up
 * that end of the conversation; reach for this when something is.
 *
 * What it is NOT is a conversation that did not happen: every one of the tree's
 * 516 `puppetevent` calls has an authored `case -1` arm, and the engine
 * deliberately does not set the skip flag on this key "because the script's own
 * -1 arm may have a parting line to say". So a bail runs script, and the loop
 * below carries on skipping lines until the puppet actually closes.
 */
/**
 * `otherwise:` — what to answer when the plaque offered is not the one named.
 *
 * Read through a function rather than cast at each call site so the two verbs
 * that take it cannot drift, and so a typo is a named refusal rather than a
 * silent `stop`: `otherwise: lsat` used to parse (the parser checks option KEYS,
 * not their values) and then quietly meant "throw on anything unplanned".
 */
export function otherwiseOf(step: Step): "stop" | "first" | "last" {
  const asked = step.opts.otherwise;
  if (asked === undefined) return "stop";
  const v = asked.trim().toLowerCase();
  if (v !== "stop" && v !== "first" && v !== "last") {
    throw new Error(`sheet line ${step.line}: otherwise: ${asked} is not stop|first|last`);
  }
  return v;
}

/**
 * `then:` — what to do once the bevel list has run out (#265).
 *
 * `leave` answers the next plaque -1 and walks out; `stop` hands back with the
 * plaque still standing, which is what lets a sheet put a `split()` inside a
 * conversation and close it on its own line. Absent is the answer this language
 * gave before there was an option: fall through to `otherwise:`.
 */
export function thenOf(step: Step): "leave" | "stop" | undefined {
  const asked = step.opts.then;
  if (asked === undefined) return undefined;
  const v = asked.trim().toLowerCase();
  if (v !== "leave" && v !== "stop") {
    throw new Error(`sheet line ${step.line}: then: ${asked} is not leave|stop`);
  }
  return v;
}

export async function converse(
  c: ActionContext,
  bevels: number[],
  otherwise: "stop" | "first" | "last",
  then?: "leave" | "stop",
): Promise<void> {
  const { d } = c;
  const wanted = [...bevels];
  const picked: number[] = [];
  /** how many plaques were answered -1 on the way out — `then: leave` */
  let bailed = 0;
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
      c.say(
        `said ${picked.join(",") || "nothing"}` +
          (bailed ? `, then left (-1${bailed > 1 ? ` x${bailed}` : ""})` : ""),
      );
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
    } else if (!wanted.length && then) {
      /*
       * Everything on the line has been said, and the line said what to do next.
       *
       * Before `otherwise:` and not after, so `then:` decides the exhausted case
       * on its own — but only when it is written. Left out, this falls through
       * exactly as it always did, which is what keeps `say([101,102],
       * otherwise: last)` answering to the end of the conversation in the sheets
       * that already say it.
       */
      if (then === "stop") {
        c.say(`said ${picked.join(",") || "nothing"} — left them waiting`);
        return;
      }
      // `leave`: the plaque is up, so this ESC is the -1 answer and nothing else
      // (see the note above). Then round the loop, which skips whatever the -1
      // arm has to say and returns when the puppet closes.
      await d.key("Escape", "none", left());
      bailed++;
      continue;
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
/**
 * A named actor is STANDING STILL — nothing in the scheduler's walk table is
 * moving them ([#338](https://github.com/dhobi/dreamrefactory/issues/338)).
 *
 * An aim is a PIXEL, found by sweeping the engine's own hit test, and a hit test
 * is per-pixel against the actor's current pose frame
 * (`ActorRuntime.actorAt`). Aim at somebody who is turning and the pixel is
 * where they WERE: by the time the click is dispatched the sprite has stepped to
 * the next facing and the point that named them names the scenery behind them.
 * The click is not lost — it lands, on nothing — so nothing runs, and the run
 * then waits out its budget for a conversation that was never opened.
 *
 * Distinct from the queued-and-flushed click {@link IDLE} guards against, and
 * measured to be so: at the moment both clicks on Vlad went missing the gate was
 * OPEN and `session.events` was empty, while `scheduler.walks` had him and his
 * `deg` was running 108 -> 128 -> 158 -> 171. Waiting for that to finish is what
 * makes the click land.
 *
 * A turn is what a character does when you walk up to them, which is why this is
 * the shape the report describes from three different beats — Vlad first
 * approached, Vlad with his back turned waiting for his package, and Murdoch
 * caught mid-stride outside the wireless room. The route's own workaround for
 * the same thing is the double `click(vlad)` at the top of the stairs.
 *
 * Bounded, and false is not an error: somebody on a walk loop that never ends
 * has to be clicked at anyway, and that is what a player does too.
 */
export const STANDING = (name: string): string =>
  `(() => {
  const w = window.dbg.session.scheduler.walks;
  return !w || !w.has(${JSON.stringify(name.toLowerCase())});
})()`;

/** how long to let a target settle before aiming at it — see {@link STANDING} */
const SETTLE_MS = 3000;

/** aim at a thing, having first let it stop moving (see {@link STANDING}) */
export async function aimAtSettled(
  c: ActionContext,
  name: string,
): Promise<{ x: number; y: number } | null> {
  await c.d.tryHold(STANDING(name), Math.min(c.budget, SETTLE_MS));
  return c.d.aim("thing", name);
}

export async function clickThing(c: ActionContext, name: string, wait = c.wait): Promise<void> {
  const at = await aimAtSettled(c, name);
  if (!at) throw new Error(`nothing called "${name}" is clickable from here`);
  await c.d.clickAt(at.x, at.y, wait, c.budget);
}

/** the OK/exit plaque of a parked movie — the bottom-right button the artists drew */
export async function dismissMovie(c: ActionContext): Promise<void> {
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
export async function loadPoint(c: ActionContext, name: string): Promise<void> {
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

export const key = (name: string): ActionFn => async (c) => {
  await c.d.key(name, c.wait, c.budget);
};

/**
 * Where a movement key has left us, as one string — the standpoint, or the thing
 * that took the standpoint's place.
 *
 * Set, scene and view are the standpoint, and for almost every press they are the
 * whole answer.
 *
 * {@link arrow} confirms a press by the world moving, and for almost every press
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
export const WORLD = `(() => {
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
export const IDLE = `(() => {
  const s = window.dbg.session, v = window.dbg.viewer;
  if (!v) return false;
  return !v.inputLocked && s.events.length === 0;
})()`;

export const arrow = (name: string): ActionFn => async (c) => {
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


/* ------------------------------------------------------------------ *
 * Standing watches — `watchFor` (#255)
 * ------------------------------------------------------------------ */

/**
 * A rule that is not part of the route: "whenever this becomes true, do that".
 *
 * The route is a LINE and the sinking is not. During mission 4 the phase
 * advances on a mix of real time, how far the player has walked and how many
 * conversations they have had, so `sink1.mov` arrives at a moment no sheet can
 * name — it interrupts whatever command is running, blocks input, and the line
 * waiting on the world times out through no fault of its own. Writing an `esc()`
 * after every movement, which is the only linear answer, is both unreadable and
 * wrong: the film is not after any particular move.
 *
 * So a watch is polled ALONGSIDE the running step rather than between steps (see
 * the watchdog in runner.ts). Between steps would be too late — the step that
 * needs rescuing is the one already waiting.
 *
 * EDGE-TRIGGERED. A watch fires when its condition goes from false to true and
 * not again until it has gone false in between, so a film that is playing for
 * two hundred frames is one firing and not two hundred. A watch whose condition
 * is already true when it is registered fires at its first poll.
 */
export interface Watch {
  /** the condition as written, for the report */
  readonly source: string;
  /** the compiled JavaScript predicate */
  readonly expr: string;
  /** what to do when it fires */
  readonly action: Step;
  /** was it true at the last poll? — the edge */
  armed: boolean;
  /** how many times it has fired, for the report */
  fired: number;
}

/**
 * The letters a path is written in, and the action each one is.
 *
 * Five, and no more: these are the gestures that get you from one room to
 * another and nothing else belongs in a line whose whole point is that it can be
 * read at a glance. `o` is a whole `door()` — space, walk through, and wait for
 * the room beyond — because that is what a door is in this language.
 */
export const MOVES: Record<string, string> = { l: "left", r: "right", u: "up", d: "down", o: "door" };

/** `move(u,r,u)` → `up()`, `right()`, `up()` — see the verb below and #250 */
export function path(step: Step): Step[] {
  const moves: string[] = [];
  for (const arg of step.args) {
    for (const letter of arg.toLowerCase()) {
      const verb = MOVES[letter];
      if (!verb) {
        throw new SheetError(
          step.line,
          `move has no "${letter}"${arg.length > 1 ? ` (in "${arg}")` : ""} — a path is written in ` +
            `l(eft), r(ight), u(p), d(own) and o(pen a door)`,
          step.source,
        );
      }
      moves.push(verb);
    }
  }
  const out: Step[] = [];
  // `xN` repeats the PATH. Repeating each move in turn would be `move(uu,rr)`,
  // which is a different route and one the writer can still ask for.
  for (let again = 0; again < step.repeat; again++) {
    for (const verb of moves) {
      out.push({
        verb,
        args: [],
        // the line's options belong to every move on it — a `move` line is the
        // lines it stands for, written together
        opts: step.opts,
        repeat: 1,
        line: step.line,
        source: `${verb}()`,
        // ...but its comment is the LINE's, and the report should echo it once
        note: out.length === 0 ? step.note : undefined,
      });
    }
  }
  return out;
}

export const WATCHES: Watch[] = [];

/** the standing watches, in the order they were registered */
export function watches(): Watch[] {
  return WATCHES;
}

/** forget every watch — the runner calls this so one run cannot leak into the next */
export function clearWatches(): void {
  WATCHES.length = 0;
}


/* ------------------------------------------------------------------ *
 * The table, and the three questions asked of it
 * ------------------------------------------------------------------ */

/**
 * A vocabulary: every verb a sheet may use, by its lowercase name.
 *
 * Passed around rather than reached for, because there is no single answer —
 * `CORE_ACTIONS` is what any DreamFactory game can be driven with, and each game
 * adds its own on top ({@link composeActions}). A module-level table would have
 * made "which verbs exist" a fact about the engine, which is the one thing it
 * must not be.
 */
export type ActionTable = Record<string, Action>;

/**
 * One game's vocabulary: the core, with its own verbs over the top.
 *
 * Later wins, deliberately. A game may REPLACE a core verb — the gesture is the
 * same idea and the disc needs it done differently — and does so by naming it,
 * which is a thing a reader of that table can see. Nothing here checks for
 * collisions for that reason.
 */
export const composeActions = (...tables: ActionTable[]): ActionTable =>
  Object.assign({}, ...tables) as ActionTable;

/**
 * The grammar half of a table, for the parser.
 *
 * By SUBTRACTION, not by listing. This used to name the grammar fields one by
 * one, and a field added to {@link VerbSpec} then reached the parser only if
 * somebody remembered to add it here as well — which is how `move`'s `expand`
 * came to be declared, tested and silently ignored (#250). Dropping the three
 * fields that are about EXECUTION leaves the grammar whatever it is, so the next
 * one arrives on its own.
 */
export const verbsOf = (actions: ActionTable): Record<string, VerbSpec> =>
  Object.fromEntries(
    Object.entries(actions).map(([name, { run, wait, interruptible, ...grammar }]) => [name, grammar]),
  );

/**
 * Sheet spelling is camelCase and lookup is lowercase, so `skipMovie` and
 * `skipmovie` are the same verb. Sheets read better in camel; a table keyed on
 * case is a class of typo nobody should have to debug.
 */
export const resolveIn = (actions: ActionTable, verb: string): Action | undefined =>
  actions[verb.toLowerCase()];

/** may a Pause abort this verb mid-flight, or must it finish first? */
export const interruptibleIn = (actions: ActionTable, verb: string): boolean =>
  !!resolveIn(actions, verb)?.interruptible;
