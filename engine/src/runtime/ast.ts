/** AST for DreamFactory 4.0 scripts, produced by parser.ts. */

export type Expr =
  | { t: "int"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "me" }
  | { t: "target" }
  | { t: "var"; name: string }
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
  | { t: "decl"; kind: "global" | "local" | "dumpglobal" | "dumplocal"; names: string[] }
  | { t: "assign"; name: string; value: Expr }
  | { t: "callstmt"; call: CallExpr }
  | { t: "if"; cond: Expr; then: Stmt[]; else_?: Stmt[] }
  | { t: "switch"; subject: Expr; cases: { match: Expr; body: Stmt[] }[] }
  | { t: "while"; cond: Expr; body: Stmt[] }
  | { t: "for"; varName: string; from: Expr; to: Expr; step?: Expr; body: Stmt[] }
  | { t: "exitcode" }
  | { t: "passcode" }
  | { t: "return"; value?: Expr }
  /** comment lines (`//`), bare identifiers, other tolerated noise */
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
