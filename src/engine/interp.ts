import { CallExpr, CodeBlock, Expr, Script, Stmt } from "./ast";

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

export type Builtin = (interp: Interpreter, args: Value[], call: CallExpr, ctx: Frame) => Value | void;

/**
 * Special forms receive their argument expressions unevaluated — needed for
 * the `sendto*` family, whose second argument is a call executed in the
 * TARGET object's script, not the caller's.
 */
export type SpecialForm = (interp: Interpreter, argExprs: Expr[], frame: Frame) => Value | void;

export class Frame {
  locals = new Map<string, Value>();
  constructor(
    readonly script: ScriptInstance,
    readonly ctx: CallCtx,
  ) {}
}

/** a script bound to its owning object */
export class ScriptInstance {
  /**
   * resolution parent for unqualified calls (a prop script's shop main —
   * the bag's mousedown calls watchidle(), defined in house.shp's main),
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
   * (changeset, spotmovie, progress, setupactor, ...).
   */
  fallbackScripts: ScriptInstance[] = [];
  /**
   * Sticky per-event flag: set whenever any handler run during the current
   * dispatch executes `exitcode`. The engine default action (e.g. walking on
   * uparrow) runs only when NO handler exitcoded — a handler merely ending
   * (like boot's keydown after routing) does not consume the event.
   */
  eventConsumed = false;
  private unknownLogged = new Set<string>();

  /** trace of builtin calls with no registered semantics (for development) */
  onUnknown: (name: string, args: Value[]) => void = (name, args) => {
    if (this.unknownLogged.has(name)) return;
    this.unknownLogged.add(name);
    console.warn(`[interp] no semantics for: ${name}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
  };

  register(name: string, fn: Builtin): void {
    this.builtins.set(name, fn);
  }

  registerSpecial(name: string, fn: SpecialForm): void {
    this.specialForms.set(name, fn);
  }

  /**
   * Dispatch an event/procedure call to a script's handler.
   * Returns the handler's return value, and whether the event was passed on.
   */
  runHandler(
    inst: ScriptInstance,
    handler: string,
    args: Value[],
    ctx: CallCtx,
  ): { value: Value; passed: boolean; handled: boolean } {
    const block = inst.script.codes.get(handler);
    if (!block) return { value: 0, passed: true, handled: false };
    const frame = new Frame(inst, ctx);
    for (let i = 0; i < block.params.length; i++) {
      frame.locals.set(block.params[i], args[i] ?? 0);
    }
    const sig = this.execBlock(block.body, frame);
    return {
      value: sig.s === "return" ? sig.value : 0,
      passed: sig.s === "passcode",
      handled: true,
    };
  }

  execBlock(stmts: Stmt[], frame: Frame): Signal {
    for (const st of stmts) {
      const sig = this.execStmt(st, frame);
      if (sig.s !== "normal") return sig;
    }
    return NORMAL;
  }

  private execStmt(st: Stmt, frame: Frame): Signal {
    switch (st.t) {
      case "noop":
        return NORMAL;
      case "decl":
        if (st.kind === "global") {
          for (const n of st.names) if (!this.globals.has(n)) this.globals.set(n, 0);
        } else if (st.kind === "local") {
          for (const n of st.names) if (!frame.locals.has(n)) frame.locals.set(n, 0);
        }
        // dumpglobal/dumplocal: mark for save-game persistence — TODO
        return NORMAL;
      case "assign":
        this.setVar(st.name, this.evalExpr(st.value, frame), frame);
        return NORMAL;
      case "callstmt":
        this.evalCall(st.call, frame);
        return NORMAL;
      case "if":
        if (truthy(this.evalExpr(st.cond, frame))) return this.execBlock(st.then, frame);
        if (st.else_) return this.execBlock(st.else_, frame);
        return NORMAL;
      case "switch": {
        const subject = this.evalExpr(st.subject, frame);
        for (const c of st.cases) {
          if (valueEq(subject, this.evalExpr(c.match, frame))) {
            return this.execBlock(c.body, frame);
          }
        }
        return NORMAL;
      }
      case "while": {
        let guard = 0;
        while (truthy(this.evalExpr(st.cond, frame))) {
          const sig = this.execBlock(st.body, frame);
          if (sig.s !== "normal") return sig;
          if (++guard > 100_000) throw new Error("while loop runaway (100k iterations)");
        }
        return NORMAL;
      }
      case "for": {
        const from = toNum(this.evalExpr(st.from, frame));
        const to = toNum(this.evalExpr(st.to, frame));
        const step = st.step ? toNum(this.evalExpr(st.step, frame)) : 1;
        if (step === 0) throw new Error("for loop with step 0");
        for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
          this.setVar(st.varName, i, frame);
          const sig = this.execBlock(st.body, frame);
          if (sig.s !== "normal") return sig;
        }
        return NORMAL;
      }
      case "exitcode":
        this.eventConsumed = true;
        return { s: "exitcode" };
      case "passcode":
        return { s: "passcode" };
      case "return":
        return { s: "return", value: st.value ? this.evalExpr(st.value, frame) : 0 };
    }
  }

  evalExpr(e: Expr, frame: Frame): Value {
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
        return this.evalCall(e, frame) ?? 0;
      case "un": {
        const v = this.evalExpr(e.e, frame);
        return e.op === "not" ? (truthy(v) ? 0 : 1) : -toNum(v);
      }
      case "bin": {
        const l = this.evalExpr(e.l, frame);
        // short-circuit logical ops
        if (e.op === "&") return truthy(l) && truthy(this.evalExpr(e.r, frame)) ? 1 : 0;
        if (e.op === "|") return truthy(l) || truthy(this.evalExpr(e.r, frame)) ? 1 : 0;
        const r = this.evalExpr(e.r, frame);
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

  evalCall(call: CallExpr, frame: Frame): Value | void {
    // user code block in the same script takes precedence over builtins
    // only for names that aren't engine commands (no opcode id)
    if (call.id === undefined && frame.script.script.codes.has(call.name)) {
      const args = call.args.map((a) => this.evalExpr(a, frame));
      return this.runHandler(frame.script, call.name, args, frame.ctx).value;
    }
    const special = this.specialForms.get(call.name);
    if (special) return special(this, call.args, frame);
    const builtin = this.builtins.get(call.name);
    const args = call.args.map((a) => this.evalExpr(a, frame));
    if (builtin) return builtin(this, args, call, frame);
    if (call.id === undefined) {
      for (let p = frame.script.parent; p; p = p.parent) {
        if (p.script.codes.has(call.name)) {
          return this.runHandler(p, call.name, args, frame.ctx).value;
        }
      }
      for (const inst of this.fallbackScripts) {
        if (inst.script.codes.has(call.name)) {
          return this.runHandler(inst, call.name, args, frame.ctx).value;
        }
      }
    }
    this.onUnknown(call.name, args);
    return 0;
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

/** obviously-semantic builtins that need no reverse engineering */
export function registerCoreBuiltins(interp: Interpreter, rng: () => number = Math.random): void {
  const r = interp.register.bind(interp);
  r("random", (_i, [n]) => Math.floor(rng() * toNum(n ?? 0)) + 1);
  r("sqrt", (_i, [n]) => Math.floor(Math.sqrt(toNum(n ?? 0))));
  r("calcmod", (_i, [a, b]) => toNum(a ?? 0) % (toNum(b ?? 1) || 1));
  r("numtostring", (_i, [n]) => toStr(n ?? 0));
  r("stringtonum", (_i, [s]) => toNum(s ?? 0));
  r("stringlength", (_i, [s]) => toStr(s ?? "").length);
  r("substring", (_i, [s, from, len]) =>
    toStr(s ?? "").substr(Math.max(0, toNum(from ?? 0) - 1), toNum(len ?? 0)),
  );
  r("message", (_i, args) => {
    console.log(`[script] ${args.map(toStr).join(" ")}`);
  });
  r("true", () => 1);
  r("false", () => 0);
}
