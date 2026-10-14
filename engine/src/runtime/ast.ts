/** AST for DreamFactory 4.0 scripts, produced by parser.ts. */

export type Expr =
  | { t: "int"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "me" }
  | { t: "target" }
  | { t: "var"; name: string }
  /** one element of a DreamFactory 5 array — `jrep [ index ]` */
  | { t: "index"; name: string; index: Expr }
  | CallExpr
  | { t: "bin"; op: string; l: Expr; r: Expr }
  | { t: "un"; op: "not" | "-"; e: Expr };

export interface CallExpr {
  t: "call";
  /** command name (engine builtin) or user code-block name */
  name: string;
  /** opcode id when the callee is an engine builtin */
  id?: number;
  args: Expr[];
}

export type Stmt =
  | { t: "decl"; kind: "global" | "permanent" | "local" | "dumpglobal" | "dumplocal"; names: string[] }
  | { t: "assign"; name: string; value: Expr; index?: Expr }
  | { t: "callstmt"; call: CallExpr }
  /**
   * `open`: the `endif` was never written — the block was closed by the end of
   * the handler or by a `case`/`endswitch` (parser.ts expectCloser). The engines
   * count `if`s per frame and answer the count left over at `endcode` with error
   * 0x1d (TI.EXE 0x44473f, DF.EXE 0x403b1f); `noEndif` says what TI.EXE's scan
   * for `else`/`endif` (0x444c10, 0x444a90) runs into when it has to skip a
   * branch: "endcode" is error 0x1d, "beyond" is a later block's closer.
   */
  | { t: "if"; cond: Expr; body: Stmt[]; else_?: Stmt[]; open?: true; noEndif?: "endcode" | "beyond" }
  /** `default_`: DreamFactory 5's `default` arm (keyword 4032), run when no case matches;
   *  `open`: no `endswitch` before the end of the handler (see {@link Interpreter} 0x1f) */
  | { t: "switch"; subject: Expr; cases: { match: Expr; body: Stmt[] }[]; default_?: Stmt[]; open?: true }
  | { t: "while"; cond: Expr; body: Stmt[] }
  | { t: "for"; varName: string; from: Expr; to: Expr; step?: Expr; body: Stmt[] }
  | { t: "exitcode" }
  | { t: "passcode" }
  | { t: "return"; value?: Expr }
  /**
   * A line that is a variable's name and nothing the language can do with it —
   * `reutrn "engaged"`, `endocde`. The engines look the name up as a variable
   * and answer error 9 when there is none, 0x10 ("expected '='") when there is
   * (TI.EXE 0x44401e-0x444060, DF.EXE 0x40340a-0x403440).
   */
  | { t: "bare"; name: string }
  /**
   * A block keyword with no block of its own to close — `endif`, `else`,
   * `endswitch`, `case`, `endwhile`, `endfor` where nothing opened one. The
   * engines' per-frame counters answer it when it is reached (TI.EXE 0x4441cf,
   * 0x4441e8, 0x4442a6, 0x4442bc, 0x44462e, 0x4444c5).
   */
  | { t: "stray"; id: number; name: string }
  /** a statement the engines refuse when it is reached, with their error code —
   *  more on the line after a statement (0x1b, TI.EXE 0x4446e1) */
  | { t: "fault"; code: number; why: string }
  /** comment lines (`//`), other tolerated noise */
  | { t: "noop" };

export interface CodeBlock {
  name: string;
  params: string[];
  body: Stmt[];
}

export interface Script {
  /** named event handlers / procedures, in declaration order */
  codes: Map<string, CodeBlock>;
  /** statements outside any code block (rare; usually empty) */
  topLevel: Stmt[];
}
