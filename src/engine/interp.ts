import { CallExpr, Expr, Script, Stmt } from "./ast";

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
 * Values are ints or strings; true/false are 1/0. Undeclared reads are 0.
 * Builtin semantics live in a registry so they can be filled in command by
 * command as they are recovered from TI.EXE / observed behavior.
 */

export type Value = number | string;

export type Signal =
  | { s: "normal" }
  | { s: "exitcode" }
  | { s: "passcode" }
  | { s: "return"; value: Value };

const NORMAL: Signal = { s: "normal" };

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
  locals = new Map<string, Value>();
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
  ) {}
}

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
  readonly globals = new Map<string, Value>();
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
   * "Of the event being dispatched" is the whole of it, and it used to say
   * "any handler run during the current dispatch", which is a different and
   * wrong thing. A handler routinely calls routines and fires OTHER events, and
   * those end in `exitcode` for their own reasons — so a flag set from any depth
   * reports the wrong answer for the event the player actually made:
   *
   *  - TAOOT's `recept1c openset` does `sendtoactor("elev", setupactor())` and then
   *    passcodes. setupactor exitcodes, so the openset looked consumed and
   *    boot2's openset (setupsound) was skipped — a silent room on the wrong
   *    theme. {@link SetScripts.fireLifecycle} worked around it locally by
   *    ignoring this flag and reading the handler's own signal instead.
   *  - `STAIR2C.SET`'s keydown rung calls `setupshayhack()` / `setupcsea()`
   *    before its `passcode`, and both end in `exitcode`. The rung passcoded
   *    correctly, but this flag was already set, so the engine default move —
   *    the walk that carries you up out of View15 — never ran. The 2nd-class
   *    staircase could not be climbed past C deck, which is what made the
   *    turbine room a one-way trip and the segment that went there a leaf
   *    (docs/verification.md).
   *
   * So the test is by NAME against the event under dispatch, which keeps the
   * one case that must still consume: boot1's keydown routes the same event on
   * with `sendtoscene(currentscene(), keydown(arg))`, and a set keydown that
   * exitcodes there is overriding the default move on purpose. Same name, same
   * event, consumed — while a helper routine or a foreign event is neither.
   */
  eventConsumed = false;
  /**
   * The handler name the outermost in-flight dispatch was made under — what
   * `exitcode` compares its own frame against. Set by {@link runHandler} at
   * depth 0, so the chain runners do not each have to declare it, and restored
   * on the way out.
   */
  private dispatchName: string | null = null;
  /** the outermost in-flight dispatch's handler name, for the chain runners:
   *  an event must not resolve back INTO the boot library when the boot
   *  library is what dispatched it (see session.resolveViaContainment) */
  get outerDispatch(): string | null {
    return this.dispatchName;
  }
  /**
   * A monotonic counter of real rendered-frame yields. The while-loop guard
   * reads it to tell an interactive loop that waits on the user (crank play,
   * drags) from a synchronous runaway: a real yield resets the counter.
   * forceupdate()/stilldown() bump it ONLY when the host renders real frames
   * (session.hasRealFrames — the browser); headless it never advances, so a
   * stuck loop still trips the 100k guard instead of hanging the test run.
   */
  realYieldSeq: () => number = () => 0;
  private unknownLogged = new Set<string>();
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

  /** whether `inst` is already running `handler` further up the dispatch stack */
  isRunning(inst: ScriptInstance, handler: string): boolean {
    return this.liveHandlers.some((h) => h.inst === inst && h.handler === handler);
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
  ): Promise<{ value: Value; passed: boolean; handled: boolean }> {
    const block = inst.script.codes.get(handler);
    if (!block) return { value: 0, passed: true, handled: false };
    if (this.depth >= 64) {
      throw new Error(`dispatch cycle: ${inst.name}.${handler} at depth ${this.depth}`);
    }
    const frame = new Frame(inst, ctx, handler);
    for (let i = 0; i < block.params.length; i++) {
      frame.locals.set(block.params[i], args[i] ?? 0);
    }
    // the outermost handler names the event for everything under it, so a chain
    // runner does not have to declare it and a re-route (sendtoscene(…,
    // keydown(arg))) keeps the name it already had — see eventConsumed
    const prevDispatch = this.dispatchName;
    if (this.depth === 0) this.dispatchName = handler;
    this.depth++;
    const prevEvent = this.currentEvent;
    this.currentEvent = ++this.handlerSeq;
    this.liveHandlers.push({ inst, handler });
    try {
      const sig = await this.execBlock(block.body, frame);
      return {
        value: sig.s === "return" ? sig.value : 0,
        passed: sig.s === "passcode",
        handled: true,
      };
    } finally {
      this.liveHandlers.pop();
      this.depth--;
      this.currentEvent = prevEvent;
      this.dispatchName = prevDispatch;
    }
  }

  async execBlock(stmts: Stmt[], frame: Frame): Promise<Signal> {
    for (const st of stmts) {
      const sig = await this.execStmt(st, frame);
      if (sig.s !== "normal") return sig;
    }
    return NORMAL;
  }

  private async execStmt(st: Stmt, frame: Frame): Promise<Signal> {
    switch (st.t) {
      case "noop":
        return NORMAL;
      case "decl":
        if (st.kind === "global") {
          for (const n of st.names) if (!this.globals.has(n)) this.globals.set(n, 0);
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
          // a record in NONE of the 109, and reading them as declarations left
          // them in the session for the rest of the game. Which is what made a
          // save complain about 37 variables it could not store (#85), and what
          // let a script read last time's value of a puzzle that had been reset.
          for (const n of st.names) this.globals.delete(n);
        } else {
          // local (dumplocal too — no script in the corpus uses it, and a local
          // dies with its frame anyway)
          for (const n of st.names) if (!frame.locals.has(n)) frame.locals.set(n, 0);
        }
        return NORMAL;
      case "assign":
        this.setVar(st.name, await this.evalExpr(st.value, frame), frame);
        return NORMAL;
      case "callstmt":
        await this.evalCall(st.call, frame);
        return NORMAL;
      case "if":
        if (truthy(await this.evalExpr(st.cond, frame))) return this.execBlock(st.then, frame);
        if (st.else_) return this.execBlock(st.else_, frame);
        return NORMAL;
      case "switch": {
        const subject = await this.evalExpr(st.subject, frame);
        for (let i = 0; i < st.cases.length; i++) {
          if (valueEq(subject, await this.evalExpr(st.cases[i].match, frame))) {
            // stacked labels share the next non-empty body, e.g. TAOOT's
            //   case "poop"  /  case "deckbd"  /  case "decka"  -> return 900
            let j = i;
            while (j < st.cases.length - 1 && st.cases[j].body.length === 0) j++;
            return this.execBlock(st.cases[j].body, frame);
          }
        }
        return NORMAL;
      }
      case "while": {
        // The guard catches a synchronous infinite loop (a data bug that would
        // hang the tab). A loop that yields a real frame each turn (forceupdate/
        // stilldown — the crank play loop, drag loops) is NOT that: it can run
        // for minutes waiting on the user, so a real yield resets the counter.
        let guard = 0;
        let lastYield = this.realYieldSeq();
        while (truthy(await this.evalExpr(st.cond, frame))) {
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
        return NORMAL;
      }
      case "for": {
        const from = toNum(await this.evalExpr(st.from, frame));
        const to = toNum(await this.evalExpr(st.to, frame));
        const step = st.step ? toNum(await this.evalExpr(st.step, frame)) : 1;
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
        if (frame.handler === this.dispatchName) this.eventConsumed = true;
        return { s: "exitcode" };
      case "passcode":
        return { s: "passcode" };
      case "return":
        return { s: "return", value: st.value ? await this.evalExpr(st.value, frame) : 0 };
    }
  }

  async evalExpr(e: Expr, frame: Frame): Promise<Value> {
    switch (e.t) {
      case "int":
        return e.v;
      case "str":
        return e.v;
      case "bool":
        return e.v ? 1 : 0;
      case "me":
        return frame.ctx.me;
      case "target":
        return frame.ctx.target;
      case "var":
        return this.getVar(e.name, frame);
      case "call":
        return (await this.evalCall(e, frame)) ?? 0;
      case "un": {
        const v = await this.evalExpr(e.e, frame);
        return e.op === "not" ? (truthy(v) ? 0 : 1) : -toNum(v);
      }
      case "bin": {
        const l = await this.evalExpr(e.l, frame);
        // short-circuit logical ops
        if (e.op === "&") return truthy(l) && truthy(await this.evalExpr(e.r, frame)) ? 1 : 0;
        if (e.op === "|") return truthy(l) || truthy(await this.evalExpr(e.r, frame)) ? 1 : 0;
        const r = await this.evalExpr(e.r, frame);
        switch (e.op) {
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
            return valueEq(l, r) ? 1 : 0;
          case "!=":
            return valueEq(l, r) ? 0 : 1;
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

  async evalCall(call: CallExpr, frame: Frame): Promise<Value | void> {
    // user code block in the same script takes precedence over builtins
    // only for names that aren't engine commands (no opcode id)
    if (call.id === undefined && frame.script.script.codes.has(call.name)) {
      const args = await this.evalArgs(call.args, frame);
      return (await this.runHandler(frame.script, call.name, args, frame.ctx)).value;
    }
    const special = this.specialForms.get(call.name);
    if (special) return special(this, call.args, frame);
    const builtin = this.builtins.get(call.name);
    const args = await this.evalArgs(call.args, frame);
    if (builtin) return builtin(this, args, call, frame);
    if (call.id === undefined) {
      for (let p = frame.script.parent; p; p = p.parent) {
        if (p.script.codes.has(call.name)) {
          return (await this.runHandler(p, call.name, args, frame.ctx)).value;
        }
      }
      for (const inst of this.fallbackScripts) {
        if (inst.script.codes.has(call.name)) {
          return (await this.runHandler(inst, call.name, args, frame.ctx)).value;
        }
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

  setVar(name: string, v: Value, frame: Frame): void {
    if (frame.locals.has(name)) frame.locals.set(name, v);
    else if (this.globals.has(name)) this.globals.set(name, v);
    else frame.locals.set(name, v);
  }
}

export function truthy(v: Value): boolean {
  return typeof v === "number" ? v !== 0 : v.length > 0;
}
export function toNum(v: Value): number {
  if (typeof v === "number") return v;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
}
export function toStr(v: Value): string {
  return typeof v === "string" ? v : String(v);
}
export function valueEq(a: Value, b: Value): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b;
  // mixed / string comparison is by text, case-insensitive (scripts mix case
  // freely); comparing numerically would make "uparrow" = 0 true
  return toStr(a).toLowerCase() === toStr(b).toLowerCase();
}

