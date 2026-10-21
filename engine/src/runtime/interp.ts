import { CallExpr, Expr, Script, Stmt } from "./ast";
import { CaselessMap, foldAscii } from "./caseless";
import { answersBoolean, booleanArg, dispatches, integerArgs } from "./value-types";

/**
 * DreamFactory script interpreter core.
 *
 * Execution model (from corpus analysis): each game object (set, scene,
 * prop, puppet, stage, boot...) owns a script — a bag of named `code`
 * handlers. The engine dispatches events (openset, mousedown, setcursor,
 * idle, ...) to handlers; `exitcode` ends handling, `passcode` passes the
 * event to the engine default, `return x` yields a value to callers.
 * `me` = name of the object owning the running script, `target` = name of
 * the object/hotspot the event refers to.
 *
 * Values are integers, strings and — before DreamFactory 5 — booleans. The
 * engines tag every value (DF.EXE: 2 boolean, 3 string, 4 integer; TI.EXE and
 * tl.exe the same), `true`/`false` are boolean literals (tokens 4021/4022 ->
 * 0x40da5d/0x40da86), and comparisons, `&`, `|` and `not` answer booleans.
 * Here a boolean is a JS boolean — or, the rare boolean whose payload is
 * neither 0 nor 1, a {@link Logic}; DreamFactory 5 keeps 1/0 ({@link
 * Interpreter.bool}). Undeclared reads are the integer 0.
 * Builtin semantics live in a registry so they can be filled in command by
 * command as they are recovered from TI.EXE / observed behavior.
 */

export type Value = number | string | boolean | Logic;

/**
 * A boolean-tagged value whose 32-bit payload is neither 0 (`false`) nor 1
 * (`true`). The engines' value record is a tag and a payload, and nothing stops
 * a payload of 2: DF.EXE's `pauseloop`, `pauseball` and `pausewalk` getters
 * answer tag 2 with the pause DEPTH as the payload (0x42cf95, 0x42d074/0x42d079,
 * 0x42d004). The operators then work on the payload as it is (DF.EXE 0x40d250):
 *
 * - `=` / `!=` compare the payloads (0x40d4fd), so depth 2 is not `true`;
 * - `if` / `while` test it against 0 (0x40354d, 0x4039b7), so it is true there;
 * - `not` is `xor 1` (0x40daf2): `not` depth 2 is payload 3 — true as well;
 * - `&` / `|` are `and` / `or` (0x40d3a0, 0x40d3cf): depth 2 `& true` is false.
 *
 * Never made for 0 or 1 — {@link logic} gives those as JS booleans — so every
 * value a shipped script sees is what it was before. TI.EXE and tl.exe answer
 * their pause getters 0 or 1 (TI.EXE 0x42af86, tl.exe 0x43a6c6) and never make
 * one.
 */
export class Logic {
  constructor(readonly payload: number) {}
  toString(): string {
    return `logic(${this.payload})`;
  }
}

/** a boolean-tagged value with this payload: `false`, `true`, or a {@link Logic} */
export function logic(payload: number): boolean | Logic {
  const p = payload | 0;
  if (p === 0) return false;
  if (p === 1) return true;
  return new Logic(p);
}

/** the payload of a boolean-tagged value, or null for an integer or a string */
export function logicPayload(v: Value): number | null {
  if (typeof v === "boolean") return v ? 1 : 0;
  return v instanceof Logic ? v.payload : null;
}

/** does this value carry the boolean tag? */
export function isLogic(v: Value): v is boolean | Logic {
  return typeof v === "boolean" || v instanceof Logic;
}

export type Signal =
  | { s: "normal" }
  | { s: "exitcode" }
  | { s: "passcode" }
  | { s: "return"; value: Value }
  /**
   * The game this script belonged to is GONE — see
   * {@link Interpreter.abandonRunning}. Unwinds like any other non-normal
   * signal, and every `if`/`switch`/`while`/`for` already propagates one, so it
   * reaches the top of the chain from any depth.
   */
  | { s: "abandoned" };

/**
 * A runtime error the original engine would raise — its numbered error codes
 * (2: a `)` was expected, 0xe: wrong type, ...). In DF.EXE every statement and
 * call hands a nonzero code straight back to its caller (`test ax, ax; jne`
 * after each step of 0x403340), a script call included (0x403017-0x403097),
 * and `sendto…` returns its target's code (sendtopuppet: 0x436542 -> 0x436569),
 * so the WHOLE chain unwinds to the event that started it; the first error is
 * latched for the debug window (0x42f300) and the game goes on. A throw does
 * the same here: nothing between a builtin and the dispatch's `track` catches
 * it, and the session logs it as a script error.
 */
export class ScriptError extends Error {
  /** the handler it was raised in, `script.handler` — filled in on the way out */
  where = "";
  /** handed to {@link Interpreter.onScriptError} already — the innermost frame
   *  does it, as the engines latch at every call level and keep the first */
  latched = false;
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(`error ${code}: ${message}`);
  }
}

const NORMAL: Signal = { s: "normal" };
const ABANDONED: Signal = { s: "abandoned" };

export interface CallCtx {
  /** object owning the running script */
  me: string;
  /** event target (hotspot identifier etc.) */
  target: string;
}

/**
 * Builtins may return a Promise — the interpreter awaits it. `delay(n)`
 * suspends the running script this way while the engine keeps ticking.
 */
export type Builtin = (
  interp: Interpreter,
  args: Value[],
  call: CallExpr,
  ctx: Frame,
) => Value | void | Promise<Value | void>;

/**
 * Special forms receive their argument expressions unevaluated — needed for
 * the `sendto*` family, whose second argument is a call executed in the
 * TARGET object's script, not the caller's.
 */
export type SpecialForm = (
  interp: Interpreter,
  argExprs: Expr[],
  frame: Frame,
) => Value | void | Promise<Value | void>;

export class Frame {
  locals: Map<string, Value> = new CaselessMap<Value>();
  constructor(
    readonly script: ScriptInstance,
    readonly ctx: CallCtx,
    /**
     * The handler this frame is running — the name it was dispatched under.
     * Carried so `exitcode` can tell "I am consuming the event I was called
     * for" from "a routine I called ended in exitcode of its own"; see
     * {@link Interpreter.eventConsumed}.
     */
    readonly handler = "",
    /**
     * The event THIS CHAIN was dispatched under — the outermost handler's name,
     * inherited by every frame the chain goes on to run (a routine it calls, a
     * `sendtoscene` it re-routes through). What `exitcode` compares {@link
     * handler} against.
     *
     * On the frame rather than on the interpreter, because the interpreter runs
     * more than one chain at a time and a single field cannot say which. The
     * heartbeat is the one that overlaps by design — `Scheduler.serviceIdle`
     * runs the BOOTFILE `idle ()`, and its `calctime`, untracked precisely so it
     * does NOT read as a busy player script, so a press drained on the same tick begins while
     * calctime is still suspended at an await. A shared field set only at depth 0
     * would never be set for that press at all: it would still say "calctime",
     * every `exitcode` in the press's chain would compare against the wrong name
     * and quietly stop consuming, and the chain would run on into the engine default.
     *
     * That is #232 — SMSTACK2's `keydown` is nothing but
     * `if blocked & arg = "uparrow" exitcode`, so the crate would stop stopping
     * you and a held key walk you through it. Intermittent by construction: it
     * needs the heartbeat to be mid-flight at the instant the press is
     * dispatched, which is most of the time when a key is HELD and the queue is
     * drained on the tick boundary the heartbeat also fires on.
     */
    readonly dispatch = handler,
    /**
     * Which GAME this frame belongs to — {@link Interpreter.epoch} as it stood
     * when the frame was made. A load bumps the epoch, and every frame still
     * carrying the old one stops at its next statement. See
     * {@link Interpreter.abandonRunning}.
     */
    readonly epoch = 0,
    /**
     * Did the caller ask this routine for a VALUE? The engines hand every call a
     * result pointer (TI.EXE 0x443bd0's fifth argument, DF.EXE 0x402fa0's) and
     * the handler answers to it: a call written as a statement passes none
     * (0x444002 `push 0`), and so does every plain `sendto…` — sendtoprop is
     * sendtopropfx with a null pointer (0x442261) — while a call in an
     * expression and a `sendto…fx` pass one. `return` without one is error 5
     * (0x4448c8), reaching `endcode`, `exitcode` or `passcode` WITH one is error
     * 6 (0x44478f, 0x4447a8, 0x444911). Undefined for what the port's engine
     * dispatches itself, where the original's pointer has not been read.
     */
    readonly wants?: boolean,
  ) {}
  /**
   * The `if`s this frame has entered and not yet left by their `endif` — the
   * engines' per-frame counter (TI.EXE [esp+0x16] of 0x443f60, DF.EXE the same
   * slot of 0x403340). An `if` whose `endif` was never written leaves it raised,
   * and `endcode` answers a raised one with error 0x1d (0x44473f).
   */
  ifDepth = 0;
  /**
   * What a `sendto…` being made from this frame asks of its handler — see
   * {@link wants}. Set by the special form for the length of its dispatch, which
   * reaches {@link Interpreter.runHandler} through the session's chain walkers
   * with this frame as the parent; a frame runs one statement at a time, so one
   * field is enough.
   */
  sendWants?: boolean;
}

/**
 * The handler names a script may call without defining — the engines' own
 * events. A routine call that finds no handler anywhere is error 4 (TI.EXE
 * 0x443d9c) unless its name is one of these (0x444f40 over the table at
 * 0x45c790, tl.exe 0x40f320 over 0x45bba0: 27 names), which answers nothing and
 * goes on. DF.EXE's table (0x404320 over 0x445238) has 31: the same plus Dust's
 * ball and loop ends and its floors.
 */
const ENGINE_EVENTS_V4: ReadonlySet<string> = new Set([
  "opencast", "openactor", "closecast", "closeactor", "openflat", "openstage", "closeflat", "closestage",
  "endwalk", "endturn", "openshop", "openprop", "closeshop", "closeprop", "openpuppet", "closepuppet",
  "menustate", "boot", "idle", "menuselect", "keydown", "keyrepeat", "mousedown", "openset", "openscene",
  "closeset", "closescene",
]);
const ENGINE_EVENTS_V1: ReadonlySet<string> = new Set([
  ...ENGINE_EVENTS_V4, "endball", "endloop", "openfloor", "closefloor",
]);

/** a script bound to its owning object */
export class ScriptInstance {
  /**
   * resolution parent for unqualified calls (a prop script's shop main —
   * e.g. TAOOT's bag mousedown calls watchidle(), defined in house.shp's main),
   * consulted after builtins and before the global fallbacks
   */
  parent: ScriptInstance | null = null;

  constructor(
    readonly name: string,
    readonly script: Script,
  ) {}
}

export class Interpreter {
  /** case-insensitive, as the language is — see {@link CaselessMap} */
  readonly globals: Map<string, Value> = new CaselessMap<Value>();
  /**
   * The globals declared `permanent` (DreamFactory 5), lowercased: global to
   * every script, but not the save's to carry. RedJack.exe keeps them in the
   * BOOTFILE and a `.save` holds only the `global`s (savegame-v5.md, "The globals").
   */
  readonly permanents = new Set<string>();
  /**
   * Globals whose every change is announced through {@link onGlobalChange} —
   * a watch list, in the debugger's sense.
   *
   * The plot of this game lives entirely in script globals (see
   * taoot/src/debug-panel.ts), so "why did that happen?" is nearly always "which
   * global moved, and when?". The state pane answers it after the fact; this
   * answers it in order, on the log, interleaved with the `msg:` lines the
   * scripts print themselves. Nothing is watched unless something asks.
   */
  readonly watchGlobals = new Set<string>();
  /**
   * Do `&` and `|` skip their right side once the left has decided? Only in
   * DreamFactory 5. DF.EXE, TI.EXE and Timelapse's tl.exe read every operand
   * before they apply any operator (see the `bin` case of {@link evalExpr});
   * RedJack.exe's shunting yard checks, at 0x410788, for a BOOLEAN left value
   * that is true before `|` (0x1f46) or false before `&` (0x1f45), and then
   * steps over the right operand unevaluated (0x4107af -> 0x410e70). The
   * session sets it with isV5.
   */
  shortCircuit = false;
  /**
   * The rules DF.EXE, TI.EXE and tl.exe agree on and RedJack.exe was never
   * checked against: values are typed — a boolean is not a number and neither
   * is a string, `=`/`!=` answer "unequal" across types ({@link valueEq}) and
   * every other operator, `if`, `while`, `for` and `switch` raise error 0xe
   * ({@link ScriptError}) — a `for` variable is a local the body may move, and
   * `dumplocal` deletes. The session clears it with isV5, so DreamFactory 5
   * keeps what it had: 1/0 for true/false and lenient operators.
   */
  typed = true;
  /**
   * Which engine's command table the running game's IDs mean (1 = DF.EXE, 4 =
   * TI.EXE/tl.exe) — they disagree about what some IDs answer (value-types.ts).
   * The session points it at its own version.
   */
  tableVersion: () => number = () => 4;
  /**
   * Told of every {@link ScriptError} once, where it is raised — the engines'
   * latch (TI.EXE 0x407220 called from the call function at 0x443ca1/0x443cb6,
   * DF.EXE 0x42f300 from 0x403073/0x403088). The session decides what the player
   * sees (GameSession.scriptErrorLatched).
   */
  onScriptError: (e: ScriptError) => void = () => {};
  /**
   * `keyaborts(true)` and the Escape key down — asked after every statement, as
   * the engines do (TI.EXE 0x4446ff: the flag at 0x4608d0, then 0x436440's
   * `GetAsyncKeyState(VK_ESCAPE)`; DF.EXE 0x403adf -> 0x430a20). True stops the
   * chain with error 0x35. The session wires it.
   */
  keyAbort: () => boolean = () => false;
  /**
   * The loops open across EVERY frame — the engines keep `for` and `while`
   * records on two global stacks of 20 (TI.EXE 0x48c1a8 / 0x48c1ac, DF.EXE
   * 0x44900c / 0x449008), and the 20th that would open is error 3 (`for`
   * 0x44449d -> 0x4444b6, `while` 0x4445fc -> 0x44488d).
   */
  private forOpen = 0;
  private whileOpen = 0;
  /** fired when a WATCHED global's value changes; the session routes it to the log */
  onGlobalChange: (name: string, from: Value, to: Value) => void = () => {};
  readonly builtins = new Map<string, Builtin>();
  readonly specialForms = new Map<string, SpecialForm>();
  /**
   * Scripts whose code blocks are callable from anywhere (checked in order
   * after the local script and the builtins): the current stage's main
   * script and the boot script — the game's "standard library"
   * (TAOOT: changeset, spotmovie, progress, setupactor, ...).
   */
  fallbackScripts: ScriptInstance[] = [];
  /**
   * Sticky per-event flag: set when a handler OF THE EVENT BEING DISPATCHED
   * executes `exitcode`. The engine default action (e.g. walking on uparrow)
   * runs only when nothing exitcoded — a handler merely ending (like boot's
   * keydown after routing) does not consume the event.
   *
   * "Of the event being dispatched" is the whole of it, and "any handler run
   * during the current dispatch" is a different and wrong thing. A handler
   * routinely calls routines and fires OTHER events, and
   * those end in `exitcode` for their own reasons — so a flag set from any depth
   * reports the wrong answer for the event the player actually made:
   *
   *  - TAOOT's `recept1c openset` does `sendtoactor("elev", setupactor())` and then
   *    passcodes. setupactor exitcodes, so the openset would look consumed and
   *    boot2's openset (setupsound) be skipped — a silent room on the wrong
   *    theme.
   *  - `STAIR2C.SET`'s keydown rung calls `setupshayhack()` / `setupcsea()`
   *    before its `passcode`, and both end in `exitcode`. The rung passcodes
   *    correctly, but the flag would already be set, so the engine default
   *    move — the walk that carries you up out of View15 — would never run, and
   *    the 2nd-class staircase could not be climbed past C deck
   *    (docs/taoot/verification.md).
   *
   * So the test is by NAME against the event under dispatch, which keeps the
   * one case that must still consume: boot1's keydown routes the same event on
   * with `sendtoscene(currentscene(), keydown(arg))`, and a set keydown that
   * exitcodes there is overriding the default move on purpose. Same name, same
   * event, consumed — while a helper routine or a foreign event is neither.
   */
  eventConsumed = false;
  // Which event a frame is part of lives on the FRAME ({@link Frame.dispatch}),
  // not here: chains overlap, and one field cannot answer for two of them.
  /**
   * A monotonic counter of real rendered-frame yields. The while-loop guard
   * reads it to tell an interactive loop that waits on the user (crank play,
   * drags) from a synchronous runaway: a real yield resets the counter.
   * forceupdate()/stilldown() bump it ONLY when the host renders real frames
   * (session.hasRealFrames — the browser); headless it never advances, so a
   * stuck loop still trips the 100k guard instead of hanging the test run.
   */
  realYieldSeq: () => number = () => 0;
  private readonly unknownLogged = new Set<string>();
  /**
   * The (script, handler) pairs currently on the dispatch stack.
   *
   * "A script already running a handler must not be re-entered with it" is the
   * invariant that keeps event ROUTERS from resolving an event back into
   * themselves. TAOOT's boot is one: its `keydown` re-routes with
   * `sendtoscene(currentscene(), keydown(arg))` and its `mousedown` with
   * `sendtoactor(thename, mousedown(thepoint))`, so a target with no handler of
   * its own would otherwise climb its containment chain into the very handler
   * that dispatched it and go round again — the reported "dispatch cycle:
   * boot1.mousedown at depth 64" and, before that, an out-of-memory in TURK
   * scene134. The depth cap catches those; this is what stops them happening.
   */
  private readonly liveHandlers: { inst: ScriptInstance; handler: string }[] = [];

  /** told the name of every handler as it starts; the host's cold boot listens
   *  for the day machine with it (GameHost.coldBoot) */
  onHandler: ((handler: string) => void) | null = null;

  /** whether `inst` is already running `handler` further up the dispatch stack */
  isRunning(inst: ScriptInstance, handler: string): boolean {
    return this.liveHandlers.some((h) => h.inst === inst && h.handler === handler);
  }

  /**
   * The frames running right now that are not part of the BOOTFILE `idle ()`'s
   * own chain — what a harness means by "a script is still running".
   *
   * `scriptBusy` cannot say it: it counts the dispatches the engine TRACKS, and
   * not every handler is one (the idle is deliberately not, see
   * `Scheduler.serviceIdle`, and neither is a `hover`'s `setcursor`). The
   * machine harnesses answer it by wrapping `runHandler` in an
   * AsyncLocalStorage, which a page does not have; a frame knows its chain
   * ({@link Frame.dispatch}), so this asks the frames. A Set of them and not
   * {@link liveHandlers}, which is popped as a stack: two chains interleaved
   * across an await end out of order, and the count has to stay right when
   * they do.
   *
   * Read by the speedrun's settle on a game with no room (Timelapse; the
   * shared predicates in speedrun/src/driver.ts), where there is no viewer to
   * ask. Counted for every game, read by none of the others.
   */
  private readonly framesAtWork = new Set<Frame>();

  /** handlers running outside the idle's chain — see {@link framesAtWork} */
  get handlersAtWork(): number {
    return this.framesAtWork.size;
  }

  /**
   * {@link framesAtWork}, counted the way RedJack's machine harness counts
   * (redjack/tests/machine/harness.ts `running`): a handler the idle's chain
   * starts is the idle's own — its `hittest`, its `setcursor` — unless it
   * starts while a scheduler pass is running ({@link passing}). A pass inside the
   * idle's `forceupdate` is the world moving: a loop, a walk's `endwalk`, the
   * `openscene` a road ends in, and a fight stage's `idle` calling its
   * `endfight`, which runs for seconds and is a script running if anything is.
   * Everything a counted handler starts is counted with it. Read by RedJack's
   * speedrun verbs (redjack/src/speedrun/actions.ts), which play the suites'
   * routes on a page and so need the suites' idea of idle; {@link
   * handlersAtWork} stays what Timelapse's sheets were timed against.
   */
  get handlersInPlay(): number {
    return this.framesInPlay.size;
  }
  private readonly framesInPlay = new Set<Frame>();
  /** the idle's own chain, as {@link handlersInPlay} reads it: frames that are not counted */
  private readonly idleFrames = new WeakSet<Frame>();
  /** whether a scheduler pass is running — the session's scheduler answers (session.ts) */
  passing: () => boolean = () => false;

  /**
   * Which GAME is running. Every {@link Frame} is stamped with it, and
   * {@link execBlock} refuses to run a statement for a frame that does not
   * match — see {@link abandonRunning}.
   */
  private epoch = 0;

  /**
   * Throw away every script now in flight: the game they were running in does
   * not exist any more (a load).
   *
   * Bumping the epoch is all it takes, because a suspended script is suspended
   * INSIDE a builtin — `playmovie`, `delay`, `voicewait` — and the load already
   * releases those (`onAbandonMovie`, the scheduler reset). Released and not
   * stopped, a script goes on to its next statement, in a game that has just
   * been replaced under it. With the bump it unwinds instead, from
   * whatever depth it had reached, and its dispatch promise resolves so
   * `scriptBusy` clears with it.
   *
   * This is a load's only way to do it. `settle()` — what {@link
   * GameSession.prepareRestart} uses — waits for the in-flight dispatches to
   * finish, and the workbench's checkpoint chips call the load from INSIDE
   * `session.track(...)`, so a load that settled would be waiting for itself.
   *
   * Without it the ending sequence survives a checkpoint
   * ([#340](https://github.com/dhobi/dreamrefactory/issues/340)). BOOTFILE's
   * `advanceday()` endgame arm is one straight-line script — leave.mov,
   * debris.mov, the narend.stg slideshow, then `if mission = "good"` — so a load
   * taken during it would resume at the next film and reach that test with the
   * CHECKPOINT's mission in the global. Measured in a browser: narend scored the
   * good ending, the load replaced `mission` with the checkpoint's, and the
   * surviving script played the bad ending's `playmore.mov` over the loaded room
   * and quit to the boot menu.
   *
   * Safe for the load lever the game itself owns. CTL.STG's button is
   * `opengame("Titanic 1.0")` and then only
   * `if currentstage() != "ctl.stg" exitcode`, and a completed load has already
   * reopened main.stg — so the tail this cuts is the `exitcode` it was going to
   * take anyway. The cancel arm never gets here: `opengame` returns before
   * loading when the file is refused.
   */
  abandonRunning(): void {
    this.epoch++;
  }

  /**
   * Nested handler dispatch depth. The async interpreter has no natural
   * call-stack limit — a dispatch cycle in game data would allocate
   * promises until the tab dies. Legitimate nesting (TAOOT's double gstair
   * set hops) stays under ~30; anything deeper is a cycle.
   */
  private depth = 0;

  /**
   * Monotonic id of the script event (handler invocation) currently executing,
   * restored to the parent's on return. Lets a builtin tell whether two calls
   * happened in the SAME script event: e.g. `signs` selects a directional frame
   * with `propdeg(dir)` then enters the destination state with `propview(dest)`
   * in one `visdeg()` call — that pair must hold the picked frame, whereas a
   * `propdeg` left over from an earlier event (the watch lid's `run`) must not
   * suppress a later state's animation. See props' `degEvent`.
   */
  private handlerSeq = 0;
  currentEvent = 0;

  /** trace of builtin calls with no registered semantics (for development) */
  onUnknown: (name: string, args: Value[]) => void = (name, args) => {
    if (this.unknownLogged.has(name)) return;
    this.unknownLogged.add(name);
    console.warn(`[interp] no semantics for: ${name}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
  };

  /**
   * A boolean as this engine has it: a real boolean before DreamFactory 5, 1/0
   * in it (RedJack keeps the port's old answers).
   */
  bool(b: boolean): Value {
    if (this.typed) return b;
    return b ? 1 : 0;
  }

  /**
   * The test of an `if`/`while` condition. DF.EXE wants a boolean and answers
   * error 0xe to anything else (`if` 0x40353d, `while` 0x4039ab and its re-test
   * 0x403a5c; TI.EXE 0x44415d/0x4445cb/0x44467c, tl.exe 0x40e53d/0x40e9ab/
   * 0x40ea5c) — `if 1` and `if "x"` are errors, not true.
   */
  condition(v: Value, what: string): boolean {
    if (!this.typed) return truthy(v);
    const p = logicPayload(v);
    if (p === null) throw typeError(`${what} wants a boolean, got ${show(v)}`);
    return p !== 0;
  }

  register(name: string, fn: Builtin): void {
    // every builtin name must be registered exactly once (see builtins/index.ts);
    // a silent overwrite once hid a wrong calcmod for months
    if (this.builtins.has(name)) throw new Error(`builtin registered twice: ${name}`);
    this.builtins.set(name, fn);
  }

  registerSpecial(name: string, fn: SpecialForm): void {
    this.specialForms.set(name, fn);
  }

  /**
   * Dispatch an event/procedure call to a script's handler.
   * Returns the handler's return value, and whether the event was passed on.
   */
  async runHandler(
    inst: ScriptInstance,
    handler: string,
    args: Value[],
    ctx: CallCtx,
    /**
     * The frame this dispatch is being made FROM, when it is being made from
     * inside a running handler — a routine call, or a `sendto*` re-route. The
     * new frame joins that chain and answers to its event ({@link
     * Frame.dispatch}); with no parent this IS a new chain, which is what every
     * entry from outside a script is (a press, a click, a lifecycle, a loop, the
     * heartbeat).
     */
    parent?: Frame,
    /**
     * Whether a SCRIPT's call wants a value back — see {@link Frame.wants}.
     * Absent, a `sendto…` being made from `parent` says ({@link Frame.sendWants});
     * absent both, this is the port's own dispatch and asks nothing.
     */
    wants: boolean | undefined = parent?.sendWants,
  ): Promise<{ value: Value; passed: boolean; handled: boolean }> {
    const block = inst.script.codes.get(handler);
    if (!block) return { value: 0, passed: true, handled: false };
    if (this.depth >= 64) {
      // The engines check their native stack instead (TI.EXE 0x443bd4 and the
      // evaluator's 0x431e97: under 0x800 bytes left is error 0x2c, "Too much
      // recursion"), which no port can count the same way; 64 is the port's.
      throw this.latch(
        new ScriptError(0x2c, `dispatch cycle: ${inst.name}.${handler} at depth ${this.depth}`),
        `${inst.name}.${handler}`,
      );
    }
    // A script's call binds its arguments to the parameters one for one (TI.EXE
    // 0x443db0, DF.EXE 0x4030c0): one too many is error 2, a `)` where the
    // handler expects a `,` 0x1c, and no argument at all where it wants one is
    // the empty argument read as an expression — 0xe (0x431e60).
    if (this.typed && wants !== undefined && args.length !== block.params.length) {
      let code = 0x1c;
      if (args.length > block.params.length) code = 2;
      else if (args.length === 0) code = 0xe;
      throw this.latch(
        new ScriptError(code, `${handler} takes ${block.params.length} argument(s), called with ${args.length}`),
        `${inst.name}.${handler}`,
      );
    }
    // The outermost handler names the event for everything under it, so a chain
    // runner does not have to declare it and a re-route (sendtoscene(…,
    // keydown(arg))) keeps the name it already had — see Frame.dispatch.
    const frame = new Frame(inst, ctx, handler, parent?.dispatch ?? handler, this.epoch, wants);
    for (let i = 0; i < block.params.length; i++) {
      frame.locals.set(block.params[i], args[i] ?? 0);
    }
    this.depth++;
    const prevEvent = this.currentEvent;
    this.currentEvent = ++this.handlerSeq;
    this.liveHandlers.push({ inst, handler });
    if (frame.dispatch !== "idle") this.framesAtWork.add(frame);
    const idleChain = handler === "idle" || (!!parent && this.idleFrames.has(parent) && !this.passing());
    if (idleChain) this.idleFrames.add(frame);
    else this.framesInPlay.add(frame);
    this.onHandler?.(handler);
    try {
      const sig = await this.execBlock(block.body, frame);
      if (this.typed && sig.s !== "return" && sig.s !== "abandoned") this.endOfHandler(sig, frame);
      return {
        value: sig.s === "return" ? sig.value : 0,
        passed: sig.s === "passcode",
        handled: true,
      };
    } catch (e) {
      if (e instanceof ScriptError) this.latch(e, `${inst.name}.${handler}`);
      throw e;
    } finally {
      this.liveHandlers.pop();
      this.framesAtWork.delete(frame);
      this.framesInPlay.delete(frame);
      this.depth--;
      this.currentEvent = prevEvent;
    }
  }

  /**
   * Name the handler an error was raised in — the innermost, once — and hand it
   * to {@link onScriptError}, once.
   */
  private latch(e: ScriptError, where: string): ScriptError {
    if (!e.where) {
      e.where = where;
      e.message += ` (in ${e.where})`;
    }
    if (!e.latched) {
      e.latched = true;
      this.onScriptError(e);
    }
    return e;
  }

  /**
   * A handler leaving by anything but `return`. At `endcode` the engines check
   * their block counters first — an `if` still open is error 0x1d (TI.EXE
   * 0x44473f, DF.EXE 0x403b1f; the `for`, `while` and `switch` counters after it
   * cannot be left raised by a script this parser accepts) — and then the
   * caller: a value asked for and none given is error 6 (0x44478f). `exitcode`
   * and `passcode` check only the caller (0x4447a8, 0x444911).
   */
  private endOfHandler(sig: Signal, frame: Frame): void {
    if (sig.s === "normal" && frame.ifDepth > 0) {
      throw new ScriptError(0x1d, "an `if` without its `endif` reached the end of the handler");
    }
    if (frame.wants === true) {
      const how = sig.s === "normal" ? "the end of the handler" : sig.s;
      throw new ScriptError(6, `${frame.handler} was called for a value and left by ${how}`);
    }
  }

  async execBlock(stmts: Stmt[], frame: Frame): Promise<Signal> {
    for (const st of stmts) {
      if (frame.epoch !== this.epoch) return ABANDONED;
      const sig = await this.execStmt(st, frame);
      if (sig.s !== "normal") return sig;
      // after every statement, the abort key (see keyAbort)
      if (this.typed && this.keyAbort()) throw new ScriptError(0x35, "programmer keyboard abort (Esc under keyaborts)");
    }
    return NORMAL;
  }

  private async execStmt(st: Stmt, frame: Frame): Promise<Signal> {
    switch (st.t) {
      case "noop":
        return NORMAL;
      case "decl":
        if (st.kind === "global" || st.kind === "permanent") {
          for (const n of st.names) if (!this.globals.has(n)) this.globals.set(n, 0);
          if (st.kind === "permanent") for (const n of st.names) this.permanents.add(n.toLowerCase());
        } else if (st.kind === "dumpglobal") {
          // `dumpglobal` DISCARDS the named globals — it is a statement, not a
          // declaration, whatever its shape suggests. All 64 sites in the corpus
          // sit in a teardown: `closeset`, `closestage`, `closeenigma`,
          // `endfight`, or a `dump…globals()` helper called from one, and
          // turbine.stg's exists for nothing else (`dumpturbineglobals` is four
          // dumpglobal lines and no other statement, against `initvalue`'s plain
          // `global` + assignment on the way in).
          //
          // bridge.stg's `monkey()` settles it, because its author worked around
          // it: `arg = drifthappen`, then `dumpglobal drifthappen`, then every
          // test against `arg`. Copying the value first is pointless unless the
          // next line destroys it.
          //
          // The shipped saves agree from the other side: `coal`, `valve1..3`,
          // `pump1`, `pump2` and `savenorth` — all dumped on a stage close — have
          // a record in NONE of the 109, and reading them as declarations would
          // leave them in the session for the rest of the game: a save
          // complaining about 37 variables it cannot store (#85), and a script
          // reading last time's value of a puzzle that has been reset.
          for (const n of st.names) this.globals.delete(n);
        } else if (st.kind === "dumplocal" && this.typed) {
          // the local twin of dumpglobal: DF.EXE's 0x403a87 hands the names to
          // the same deleter (0x403e10 -> 0x4082a0) with the frame's locals
          // where 0x403a9d hands it the globals. TI.EXE 0x4446a7 and tl.exe
          // 0x40ea87 likewise. Nothing in the three corpora uses it.
          for (const n of st.names) frame.locals.delete(n);
        } else {
          // local — a new variable is the integer 0 (DF.EXE 0x408260)
          for (const n of st.names) if (!frame.locals.has(n)) frame.locals.set(n, 0);
        }
        return NORMAL;
      case "assign":
        if (st.index) {
          const key = this.elementKey(st.name, await this.evalExpr(st.index, frame));
          this.setElement(st.name, key, await this.evalExpr(st.value, frame), frame);
          return NORMAL;
        }
        // The name is found before the value is read (TI.EXE 0x44401e locals,
        // 0x444037 globals): an assignment never creates a variable, and one
        // nobody declared is error 9 (DF.EXE 0x403434).
        if (this.typed && !frame.locals.has(st.name) && !this.globals.has(st.name)) {
          throw new ScriptError(9, `no such variable: ${st.name} (assigned)`);
        }
        this.setVar(st.name, await this.evalExpr(st.value, frame), frame);
        return NORMAL;
      case "callstmt":
        await this.evalCall(st.call, frame, false);
        return NORMAL;
      case "if":
        return this.execIf(st, frame);
      case "switch": {
        const subject = await this.evalExpr(st.subject, frame);
        // the subject is an integer or a string, anything else error 0xe
        // (TI.EXE 0x444236/0x44423e, DF.EXE 0x403616)
        if (this.typed && isLogic(subject)) throw typeError(`switch ${show(subject)}`);
        let sig: Signal = NORMAL;
        let matched = false;
        for (let i = 0; i < st.cases.length && !matched; i++) {
          if (this.caseMatches(subject, await this.evalExpr(st.cases[i].match, frame))) {
            // stacked labels share the next non-empty body, e.g. TAOOT's
            //   case "poop"  /  case "deckbd"  /  case "decka"  -> return 900
            let j = i;
            while (j < st.cases.length - 1 && st.cases[j].body.length === 0) j++;
            sig = await this.execBlock(st.cases[j].body, frame);
            matched = true;
          }
        }
        if (!matched && st.default_) sig = await this.execBlock(st.default_, frame);
        // No `endswitch`: a case that runs to its end goes looking for one
        // (the next `case` scans for it, 0x4442bc -> 0x444b50) and so does a
        // subject no case matched, and the scan meets `endcode` — error 0x1f
        // (0x444b90; DF.EXE 0x403f50 the same).
        if (this.typed && st.open && sig.s === "normal") {
          throw new ScriptError(0x1f, "a `switch` without its `endswitch` ran to the end of the handler");
        }
        return sig;
      }
      case "while": {
        // The guard catches a synchronous infinite loop (a data bug that would
        // hang the tab). A loop that yields a real frame each turn (forceupdate/
        // stilldown — the crank play loop, drag loops) is NOT that: it can run
        // for minutes waiting on the user, so a real yield resets the counter.
        let guard = 0;
        let lastYield = this.realYieldSeq();
        let opened = false;
        try {
        while (this.condition(await this.evalExpr(st.cond, frame), "while")) {
          if (!opened && this.typed) {
            // the loop's record goes on the global while stack only once it is
            // entered (0x4445de); the 20th is error 3
            opened = true;
            if (++this.whileOpen >= 20) throw new ScriptError(3, "while loops nested 20 deep");
          }
          // here as well as in execBlock, because a body with no statements
          // never reaches that check and would spin on the condition alone
          if (frame.epoch !== this.epoch) return ABANDONED;
          const sig = await this.execBlock(st.body, frame);
          if (sig.s !== "normal") return sig;
          const y = this.realYieldSeq();
          if (y !== lastYield) {
            lastYield = y;
            guard = 0;
          } else if (++guard > 100_000) {
            throw new Error("while loop runaway (100k iterations)");
          }
        }
        } finally {
          if (opened) this.whileOpen--;
        }
        return NORMAL;
      }
      case "for": {
        // `from`, `to` and `step` are integers or error 0xe (DF.EXE 0x403739,
        // 0x403798, 0x4037e0)
        const from = this.forNum(await this.evalExpr(st.from, frame), "from");
        const to = this.forNum(await this.evalExpr(st.to, frame), "to");
        const step = st.step ? this.forNum(await this.evalExpr(st.step, frame), "step") : 1;
        if (this.typed) return this.typedFor(st.varName, from, to, step, st.body, frame);
        if (step === 0) throw new Error("for loop with step 0");
        for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
          this.setVar(st.varName, i, frame);
          const sig = await this.execBlock(st.body, frame);
          if (sig.s !== "normal") return sig;
        }
        return NORMAL;
      }
      case "exitcode":
        // only for the event this frame IS a handler of — a routine or another
        // event ending in exitcode is not the player's event being consumed
        if (frame.handler === frame.dispatch) this.eventConsumed = true;
        return { s: "exitcode" };
      case "passcode":
        return { s: "passcode" };
      case "return":
        if (this.typed) {
          // a caller that asked for nothing cannot be answered (0x4448c8)
          if (frame.wants === false) throw new ScriptError(5, `\`return\` in ${frame.handler}, called for no value`);
          // ...and a `return` with nothing after it reads the line break as its
          // value, which is no operand: 0xe (0x4448dd -> 0x431e60)
          if (!st.value && frame.wants === true) throw typeError("`return` with no value");
        }
        return { s: "return", value: st.value ? await this.evalExpr(st.value, frame) : 0 };
      case "bare": {
        if (!this.typed) return NORMAL;
        const known = frame.locals.has(st.name) || this.globals.has(st.name);
        throw new ScriptError(known ? 0x10 : 9, known ? `expected '=' after ${st.name}` : `no such variable: ${st.name}`);
      }
      case "stray":
        return this.stray(st, frame);
      case "fault":
        if (!this.typed) return NORMAL;
        throw new ScriptError(st.code, st.why);
    }
  }

  /**
   * `if`, with the engines' per-frame count of open ones ({@link Frame.ifDepth}):
   * entering a branch raises it (TI.EXE 0x444177 true, 0x44419f the `else`) and
   * the `endif` lowers it (0x4441db, DF.EXE 0x4035bb). Without an `endif`
   * ({@link Stmt} `open`) nothing lowers it, and a branch that has to be skipped
   * is skipped by a scan for one — which meets `endcode` (error 0x1d) or a later
   * block's closer, a jump this tree cannot make (logged, and the branch is
   * skipped as before).
   */
  private async execIf(st: Extract<Stmt, { t: "if" }>, frame: Frame): Promise<Signal> {
    const open = this.typed && st.open;
    if (this.condition(await this.evalExpr(st.cond, frame), "if")) {
      frame.ifDepth++;
      const sig = await this.execBlock(st.body, frame);
      if (sig.s !== "normal") return sig;
      if (!open) {
        frame.ifDepth--;
        return sig;
      }
      // the body ran into its `else`: lower the count and skip to the `endif`
      // (0x4441f4 -> 0x444a90)
      if (st.else_) {
        frame.ifDepth--;
        if (st.noEndif === "endcode") throw new ScriptError(0x1d, "skipping an `else` met the end of the handler");
      }
      return sig;
    }
    if (st.else_) {
      frame.ifDepth++;
      const sig = await this.execBlock(st.else_, frame);
      if (sig.s === "normal" && !open) frame.ifDepth--;
      return sig;
    }
    if (open && st.noEndif === "endcode") {
      throw new ScriptError(0x1d, "skipping an `if` met the end of the handler");
    }
    return NORMAL;
  }

  /** a block keyword with no block to close — see the `stray` statement */
  private stray(st: Extract<Stmt, { t: "stray" }>, frame: Frame): Signal {
    if (!this.typed) return NORMAL;
    switch (st.name.toLowerCase()) {
      case "endif":
        // a frame's open count can still take it (an `if` whose own `endif` the
        // parse gave to an outer block), else 0x1d (0x4441cf -> 0x4447e5)
        if (frame.ifDepth > 0) {
          frame.ifDepth--;
          return NORMAL;
        }
        throw new ScriptError(0x1d, "`endif` with no `if` open");
      case "else":
        throw new ScriptError(0x1d, "`else` with no `if` open"); // 0x4441e8 -> 0x4447f1
      case "endswitch":
      case "case":
        throw new ScriptError(0x1f, `\`${st.name}\` with no \`switch\` open`); // 0x444809, 0x444815
      case "endwhile":
        throw new ScriptError(0x25, "`endwhile` with no `while` open"); // 0x444899
      default:
        throw new ScriptError(0x1e, "`endfor` with no `for` open"); // 0x44485d
    }
  }

  /**
   * `for` as DF.EXE runs it (0x4036c9, the `endfor` at 0x4038a2); TI.EXE
   * 0x4442e9/0x4444c2 and tl.exe 0x40e6c9/0x40e944 are the same code.
   *
   * - `to` and `step` are read ONCE, at the `for` line, and kept in the loop
   *   record (0x40384c); only `from` is written to the variable.
   * - The variable is found-or-made in the frame's LOCALS (0x4081a0 on the
   *   locals container), never in the globals, even when a global has that
   *   name — the global is shadowed for the rest of the handler, not counted.
   * - A loop that cannot start is skipped: `from > to` with a positive step,
   *   `from < to` with a negative one (0x4037fb-0x403829). Step 0 enters.
   * - Each `endfor` READS the variable back, adds the step and writes it
   *   (0x4038ff-0x403933), so the body may move it; the loop goes on while it
   *   is `<= to` (step >= 0) or `>= to` (step < 0). It ends one step past `to`.
   */
  private async typedFor(
    name: string,
    from: number,
    to: number,
    step: number,
    body: Stmt[],
    frame: Frame,
  ): Promise<Signal> {
    frame.locals.set(name, from);
    if ((step > 0 && from > to) || (step < 0 && from < to)) return NORMAL;
    // on the global for stack once entered (0x444467); the 20th is error 3
    if (++this.forOpen >= 20) {
      this.forOpen--;
      throw new ScriptError(3, "for loops nested 20 deep");
    }
    try {
      return await this.typedForBody(name, to, step, body, frame);
    } finally {
      this.forOpen--;
    }
  }

  private async typedForBody(name: string, to: number, step: number, body: Stmt[], frame: Frame): Promise<Signal> {
    let guard = 0;
    let lastYield = this.realYieldSeq();
    for (;;) {
      if (frame.epoch !== this.epoch) return ABANDONED;
      const sig = await this.execBlock(body, frame);
      if (sig.s !== "normal") return sig;
      // read back as an integer, or error 0xe (0x403914)
      // a 32-bit add (0x44454d `add`)
      const v = (this.forNum(this.getVar(name, frame), name) + step) | 0;
      frame.locals.set(name, v);
      if (step >= 0 ? v > to : v < to) return NORMAL;
      // a body that holds the variable back (or a step of 0) can spin for ever,
      // as it would in the original; the while loop's runaway guard applies
      const y = this.realYieldSeq();
      if (y !== lastYield) {
        lastYield = y;
        guard = 0;
      } else if (++guard > 100_000) {
        throw new Error("for loop runaway (100k iterations)");
      }
    }
  }

  /** a `for` bound — an integer, or error 0xe in the typed engines */
  private forNum(v: Value, what: string): number {
    if (this.typed && typeof v !== "number") throw typeError(`for: ${what} wants an integer, got ${show(v)}`);
    return toNum(v);
  }

  /**
   * One `case` against the subject. DF.EXE's 0x404070 compares the tags first
   * and a case of another type is error 0xe (0x40412f -> 0x4041d0); integers
   * then match by value (0x404148), strings caselessly (0x40417e), and a
   * boolean case is never a match (0x404151 -> 0x40418f, the next case).
   */
  private caseMatches(subject: Value, match: Value): boolean {
    if (!this.typed) return valueEq(subject, match);
    if (isLogic(subject) || isLogic(match)) {
      if (!isLogic(subject) || !isLogic(match)) throw typeError(`case ${show(match)} against ${show(subject)}`);
      return false;
    }
    if (typeof subject !== typeof match) throw typeError(`case ${show(match)} against ${show(subject)}`);
    return valueEq(subject, match, true);
  }

  async evalExpr(e: Expr, frame: Frame): Promise<Value> {
    switch (e.t) {
      case "int":
        return e.v;
      case "str":
        return e.v;
      case "bool":
        return this.bool(e.v);
      case "me":
        return frame.ctx.me;
      case "target":
        return frame.ctx.target;
      case "var":
        // locals, then globals, then error 9 — never 0 (TI.EXE 0x4327f4/0x432811,
        // DF.EXE 0x40d8f4/0x40d913)
        if (this.typed && !frame.locals.has(e.name) && !this.globals.has(e.name)) {
          throw new ScriptError(9, `no such variable: ${e.name}`);
        }
        return this.getVar(e.name, frame);
      case "index":
        return this.getVar(this.elementKey(e.name, await this.evalExpr(e.index, frame)), frame);
      case "call":
        return (await this.evalCall(e, frame, true)) ?? 0;
      case "un": {
        const v = await this.evalExpr(e.e, frame);
        if (this.typed) {
          // `not` wants a boolean (DF.EXE 0x40dad8), unary `-` an integer
          // (0x40db9a); anything else is error 0xe
          if (e.op === "not") {
            const p = logicPayload(v);
            if (p === null) throw typeError(`not ${show(v)}`);
            return logic(p ^ 1);
          }
          if (typeof v !== "number") throw typeError(`-${show(v)}`);
          return -v | 0;
        }
        if (e.op === "not") return truthy(v) ? 0 : 1;
        return -toNum(v);
      }
      case "bin": {
        // Both sides, always, before any operator applies: `&` and `|` do NOT
        // short-circuit. The engines' evaluator reads an operand, then operator
        // and operand pairs onto a stack until the expression ends, and only
        // then reduces it (DF.EXE 0x40d040: operands 0x40d0ba-0x40d160, reduce
        // 0x40d17e; TI.EXE 0x4059a3/0x405a2a/0x405aee; tl.exe 0x41f8ea).
        // `a & b()` calls b() even when a is false, and draws its random()s.
        // DreamFactory 5 is the exception — see {@link shortCircuit}.
        const l = await this.evalExpr(e.l, frame);
        if (this.shortCircuit) {
          if (e.op === "&" && !truthy(l)) return 0;
          if (e.op === "|" && truthy(l)) return 1;
        }
        const r = await this.evalExpr(e.r, frame);
        if (this.typed) return typedBinary(e.op, l, r);
        switch (e.op) {
          case "&":
            return truthy(l) && truthy(r) ? 1 : 0;
          case "|":
            return truthy(l) || truthy(r) ? 1 : 0;
          case "@":
            return toStr(l) + toStr(r);
          case "+":
            return toNum(l) + toNum(r);
          case "-":
            return toNum(l) - toNum(r);
          case "*":
            return toNum(l) * toNum(r);
          case "/":
            return Math.trunc(toNum(l) / toNum(r));
          case "=":
            return valueEq(l, r, this.typed) ? 1 : 0;
          case "!=":
            return valueEq(l, r, this.typed) ? 0 : 1;
          case ">":
            return toNum(l) > toNum(r) ? 1 : 0;
          case "<":
            return toNum(l) < toNum(r) ? 1 : 0;
          case ">=":
            return toNum(l) >= toNum(r) ? 1 : 0;
          case "<=":
            return toNum(l) <= toNum(r) ? 1 : 0;
          default:
            throw new Error(`unknown operator ${e.op}`);
        }
      }
    }
  }

  /**
   * A call. `wants` is whether it was written for its value (in an expression)
   * or as a statement, which a script routine is told — see {@link Frame.wants}.
   */
  async evalCall(call: CallExpr, frame: Frame, wants = true): Promise<Value | void> {
    // user code block in the same script takes precedence over builtins
    // only for names that aren't engine commands (no opcode id)
    if (call.id === undefined && frame.script.script.codes.has(call.name)) {
      const args = await this.evalArgs(call.args, frame);
      return (await this.runHandler(frame.script, call.name, args, frame.ctx, frame, wants)).value;
    }
    // The registries are keyed by the lowercase name the opcode table uses; a
    // script is free to spell the call any way (Timelapse's journal pickup asks
    // for `Playsound`, the camera two flats away for `playsound`). Without this
    // the capitalised one reached no builtin and no handler and was logged as an
    // unknown command — the pickup that made no sound.
    // a call the engine's dispatcher does not reach in this context is error 1
    // before anything is evaluated (value-types.ts dispatches)
    if (this.typed && call.id !== undefined && !dispatches(this.tableVersion(), call.id, wants)) {
      throw new ScriptError(1, `${call.name}: not a command ${wants ? "with a value" : "statement"}`);
    }
    const folded = call.name.toLowerCase();
    const special = this.specialForms.get(folded);
    if (special) {
      // a `sendto…` tells its handler whether a value is wanted: the fx forms
      // pass a result pointer, the plain ones pass none (see Frame.wants)
      const before = frame.sendWants;
      frame.sendWants = /fx$/i.test(folded);
      let out: Value | void;
      try {
        out = await special(this, call.args, frame);
      } finally {
        frame.sendWants = before;
      }
      // Dust's 20100 `scenebuild` is answered by the `sendtoserverfx` form
      return this.typed && call.id !== undefined && out !== undefined && answersBoolean(this.tableVersion(), call.id)
        ? asLogic(out)
        : out;
    }
    const builtin = this.builtins.get(folded);
    const args = await this.evalArgs(call.args, frame);
    if (builtin) {
      if (!this.typed || call.id === undefined) return builtin(this, args, call, frame);
      // The engine's own commands check and answer typed values — see
      // value-types.ts. A boolean argument that is not one is error 0xe, the
      // setter's `cmp word [arg], 2` (actorvisible: DF.EXE 0x412a48).
      const v = this.tableVersion();
      const b = booleanArg(v, call.id);
      if (b >= 0 && b < args.length && !isLogic(args[b])) {
        throw typeError(`${call.name}: argument ${b + 1} wants a boolean, got ${show(args[b])}`);
      }
      // ...and an integer argument that is not one, the same 0xe (value-types.ts
      // integerArgs: a statement and an expression reach different implementations)
      for (const i of integerArgs(v, call.id, wants)) {
        if (i < args.length && typeof args[i] !== "number") {
          throw typeError(`${call.name}: argument ${i + 1} wants an integer, got ${show(args[i])}`);
        }
      }
      const out = await builtin(this, args, call, frame);
      return out !== undefined && answersBoolean(v, call.id) ? asLogic(out) : out;
    }
    if (call.id === undefined) {
      for (let p = frame.script.parent; p; p = p.parent) {
        if (p.script.codes.has(call.name)) {
          return (await this.runHandler(p, call.name, args, frame.ctx, frame, wants)).value;
        }
      }
      for (const inst of this.fallbackScripts) {
        if (inst.script.codes.has(call.name)) {
          return (await this.runHandler(inst, call.name, args, frame.ctx, frame, wants)).value;
        }
      }
      if (this.typed) {
        // No handler anywhere: error 4, unless the name is one of the engine's
        // own events, which a script may call without defining (ENGINE_EVENTS)
        const events = this.tableVersion() === 1 ? ENGINE_EVENTS_V1 : ENGINE_EVENTS_V4;
        if (events.has(foldAscii(call.name))) return 0;
        throw new ScriptError(4, `no such handler: ${call.name}`);
      }
    }
    this.onUnknown(call.name, args);
    return 0;
  }

  /** evaluate call arguments left to right (each may itself suspend) */
  async evalArgs(exprs: Expr[], frame: Frame): Promise<Value[]> {
    const out: Value[] = [];
    for (const e of exprs) out.push(await this.evalExpr(e, frame));
    return out;
  }

  getVar(name: string, frame: Frame): Value {
    if (frame.locals.has(name)) return frame.locals.get(name)!;
    if (this.globals.has(name)) return this.globals.get(name)!;
    return 0;
  }

  /**
   * A v5 array element's own variable name. `jrep [ 3 ]` is `jrep[3]`, kept in
   * whichever scope `jrep` was declared in (see {@link setElement}) — so an
   * element needs no storage the interpreter does not already have, and a save
   * carries it like any other variable.
   */
  elementKey(name: string, index: Value): string {
    return `${name}[${toStr(index)}]`;
  }

  /** an element lives where its array was declared: a local, else a global */
  setElement(name: string, key: string, v: Value, frame: Frame): void {
    if (frame.locals.has(name) || frame.locals.has(key)) frame.locals.set(key, v);
    else if (this.globals.has(name)) this.setGlobal(key, v);
    else frame.locals.set(key, v);
  }

  setVar(name: string, v: Value, frame: Frame): void {
    if (frame.locals.has(name)) frame.locals.set(name, v);
    else if (this.globals.has(name)) this.setGlobal(name, v);
    else frame.locals.set(name, v);
  }

  /**
   * Write a global, announcing it if it is watched. The engine's own few writes
   * to the game's globals go through here too, so a watch sees the whole story
   * and not just the half the scripts do (`curattention` is written by both —
   * see `dropAttention` in builtins/actors.ts).
   */
  setGlobal(name: string, v: Value): void {
    const from = this.globals.get(name) ?? "";
    this.globals.set(name, v);
    // the watch list is the debugger's, typed by a person — matched caselessly
    // for the same reason the variables themselves are
    const watched = name.toLowerCase();
    if (this.watchGlobals.has(watched) && !valueEq(from, v)) this.onGlobalChange(watched, from, v);
  }
}

export function truthy(v: Value): boolean {
  if (typeof v === "boolean") return v;
  // a builtin reading a flag reads the payload's word (DF.EXE pauseball's
  // `test ax, ax`, 0x43a521)
  if (v instanceof Logic) return (v.payload & 0xffff) !== 0;
  return typeof v === "number" ? v !== 0 : v.length > 0;
}

/** what a command answering the boolean tag hands back: a boolean-tagged value
 *  stays as it is, anything else is true or false */
function asLogic(v: Value): boolean | Logic {
  return isLogic(v) ? v : truthy(v);
}
/** a value as a number; a boolean is 1/0 (the port's own reads — the engines
 *  would refuse it, see {@link typedBinary}) */
export function toNum(v: Value): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Logic) return v.payload;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
}
export function toStr(v: Value): string {
  return typeof v === "string" ? v : String(v);
}

/** the wrong-type error, 0xe, every check above raises */
function typeError(message: string): ScriptError {
  return new ScriptError(0xe, `wrong type: ${message}`);
}

/** a value for an error message, its type showing */
function show(v: Value): string {
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}

/**
 * A binary operator as DF.EXE's reducer 0x40d250 applies it (table 0x40d71c,
 * one case per operator id 8001-8013); TI.EXE 0x4320d0 and tl.exe 0x41fa90 are
 * the same code. Every case checks the two type tags before it looks at a value:
 *
 * - `+ - * /` want two integers (0x40d29a...0x40d358), and `/` by zero is error
 *   0x37 (0x40d35f) rather than infinity.
 * - `&` `|` want two booleans (0x40d37a, 0x40d3a9).
 * - `@` wants two strings (both through 0x40cf60, which refuses any other tag)
 *   and a result of at most 255 characters, else error 0x1a (0x40d426).
 * - `=` `!=` answer "unequal" when the tags differ (0x40d461, 0x40d523), and
 *   otherwise compare integers and booleans by value, strings caselessly.
 * - `< > <= >=` want the same tag (0x40d5ea...) and that tag an integer.
 *
 * Anything refused is error 0xe. Every answer of a comparison is a boolean.
 */
export function typedBinary(op: string, l: Value, r: Value): Value {
  const ints = (): [number, number] => {
    if (typeof l !== "number" || typeof r !== "number") throw typeError(`${show(l)} ${op} ${show(r)}`);
    return [l, r];
  };
  switch (op) {
    // 32-bit registers: `add`, `sub` and `imul` wrap (TI.EXE 0x432140, 0x43217f,
    // 0x4321ab; DF.EXE 0x40d29a...)
    case "+": {
      const [a, b] = ints();
      return (a + b) | 0;
    }
    case "-": {
      const [a, b] = ints();
      return (a - b) | 0;
    }
    case "*": {
      const [a, b] = ints();
      return Math.imul(a, b);
    }
    case "/": {
      const [a, b] = ints();
      if (b === 0) throw new ScriptError(0x37, `division by zero: ${a} / 0`);
      return Math.trunc(a / b) | 0;
    }
    case "&":
    case "|": {
      // `and` / `or` on the payloads (0x40d3a0, 0x40d3cf)
      const a = logicPayload(l);
      const b = logicPayload(r);
      if (a === null || b === null) throw typeError(`${show(l)} ${op} ${show(r)}`);
      return logic(op === "&" ? a & b : a | b);
    }
    case "@": {
      if (typeof l !== "string" || typeof r !== "string") throw typeError(`${show(l)} @ ${show(r)}`);
      if (l.length + r.length > 255) throw new ScriptError(0x1a, "string longer than 255 characters");
      return l + r;
    }
    case "=":
      return valueEq(l, r, true);
    case "!=":
      return !valueEq(l, r, true);
    case ">": {
      const [a, b] = ints();
      return a > b;
    }
    case "<": {
      const [a, b] = ints();
      return a < b;
    }
    case ">=": {
      const [a, b] = ints();
      return a >= b;
    }
    case "<=": {
      const [a, b] = ints();
      return a <= b;
    }
    default:
      throw new Error(`unknown operator ${op}`);
  }
}
/**
 * `=` (and `!=`, and a `switch` case). Strings compare case-insensitively —
 * DF.EXE's 0x4303c0 checks the length byte, then folds both sides through the
 * table at 0x447478.
 *
 * `typed` is the engines before DreamFactory 5, and there a string is never
 * equal to a number: DF.EXE's `=` (0x40d461) answers false when the two type
 * tags differ, before it looks at either value, and `!=` (0x40d523) true; TI.EXE
 * 0x4322e1/0x4323e7 and tl.exe 0x41fc91 do the same. So `"5" = 5` is false, and
 * an unset variable — the integer 0 — equals 0 but not "0" or "" or `false`.
 * A boolean is a third type: `1 = true` is false. `switch` (0x404070) raises a
 * type error instead — see {@link Interpreter.caseMatches}.
 *
 * Off `typed` (RedJack) a mixed comparison is by text, as before.
 */
export function valueEq(a: Value, b: Value, typed = false): boolean {
  // two booleans compare their payloads (DF.EXE 0x40d4fd)
  const la = logicPayload(a);
  const lb = logicPayload(b);
  if (la !== null || lb !== null) {
    if (la !== null && lb !== null) return la === lb;
    if (typed) return false;
    return toStr(a).toLowerCase() === toStr(b).toLowerCase();
  }
  // the engines fold A-Z and nothing else (TI.EXE's table at 0x45c068, DF.EXE's
  // at 0x447478): "É" and "é" are two letters to them
  if (typeof a === "string" && typeof b === "string") {
    return typed ? foldAscii(a) === foldAscii(b) : a.toLowerCase() === b.toLowerCase();
  }
  if (typeof a === typeof b) return a === b;
  if (typed) return false;
  // mixed: by text; comparing numerically would make "uparrow" = 0 true
  return toStr(a).toLowerCase() === toStr(b).toLowerCase();
}

