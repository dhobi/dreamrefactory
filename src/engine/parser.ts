import { Token } from "../df/script";
import { CallExpr, CodeBlock, Expr, Script, Stmt } from "./ast";

/**
 * Parse a decoded script token stream into an AST.
 *
 * Grammar (validated against the full TAOOT script corpus):
 *   script  := { "code" NAME "(" [params] ")" stmts "endcode" | stmt }
 *   stmt    := decl | assign | callstmt | if | switch | while | for
 *            | "exitcode" | "passcode" | "return" [expr]
 *   if      := "if" expr stmts ["else" stmts] "endif"
 *   switch  := "switch" expr { "case" expr stmts } "endswitch"
 *   while   := "while" expr stmts "endwhile"
 *   for     := "for" VAR "=" expr "to" expr ["step" expr] stmts "endfor"
 *   decl    := ("global"|"local"|"dumpglobal"|"dumplocal") NAME {"," NAME}
 *
 * Precedence (loosest to tightest): | ; & ; = != < > >= <= ; @ ; + - ; * / ;
 * unary not/- ; primary. "=" is assignment only at statement start.
 */

// statement-introducing / structural opcode ids
const OP = {
  LPAREN: 4018,
  RPAREN: 4019,
  COMMA: 4020,
  CODE: 4001,
  ENDCODE: 4004,
  GLOBAL: 4002,
  LOCAL: 4003,
  DUMPLOCAL: 4028,
  DUMPGLOBAL: 4029,
  EXITCODE: 4005,
  IF: 4006,
  ENDIF: 4007,
  ELSE: 4008,
  SWITCH: 4009,
  ENDSWITCH: 4010,
  CASE: 4011,
  FOR: 4012,
  TO: 4013,
  STEP: 4014,
  ENDFOR: 4015,
  WHILE: 4016,
  ENDWHILE: 4017,
  TRUE: 4021,
  FALSE: 4022,
  NOT: 4023,
  RETURN: 4024,
  PASSCODE: 4025,
  ME: 4026,
  TARGET: 4027,
  ASSIGN_EQ: 8008,
  MINUS: 8002,
  SLASH: 8004,
  SPACE: 1,
} as const;

/** operator opcodes occupy the 8000-block (see BIN_PREC below) */
const isOperatorOpcode = (id: number): boolean => id >= 8000 && id < 9000;

const BIN_PREC: Record<number, { op: string; prec: number }> = {
  8006: { op: "|", prec: 1 },
  8005: { op: "&", prec: 2 },
  8008: { op: "=", prec: 3 },
  8009: { op: "!=", prec: 3 },
  8010: { op: ">", prec: 3 },
  8011: { op: "<", prec: 3 },
  8012: { op: ">=", prec: 3 },
  8013: { op: "<=", prec: 3 },
  8007: { op: "@", prec: 4 },
  8001: { op: "+", prec: 5 },
  8002: { op: "-", prec: 5 },
  8003: { op: "*", prec: 6 },
  8004: { op: "/", prec: 6 },
};

export class ParseError extends Error {}

class Parser {
  private toks: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    // line breaks delimit statements; keep them, drop the "space" opcode
    this.toks = tokens.filter((t) => !(t.kind === "op" && t.id === OP.SPACE));
  }

  private peek(): Token | undefined {
    return this.toks[this.pos];
  }
  private next(): Token | undefined {
    return this.toks[this.pos++];
  }
  private isOp(t: Token | undefined, id: number): boolean {
    return !!t && t.kind === "op" && t.id === id;
  }
  private atOp(id: number): boolean {
    return this.isOp(this.peek(), id);
  }
  private expectOp(id: number, what: string): void {
    if (!this.atOp(id)) throw new ParseError(`expected ${what}, got ${JSON.stringify(this.peek())}`);
    this.pos++;
  }
  /** consume a block closer; tolerate EOF (original scripts are sloppy) */
  private expectCloser(id: number, what: string): void {
    if (this.atEnd()) return;
    this.expectOp(id, what);
  }
  /** skip the rest of the line (comments, unparseable noise) */
  private skipLine(): void {
    while (!this.atEnd() && this.peek()?.kind !== "break") this.pos++;
  }
  private skipBreaks(): void {
    while (this.peek()?.kind === "break") this.pos++;
  }
  private atEnd(): boolean {
    return this.pos >= this.toks.length;
  }

  parseScript(): Script {
    const codes = new Map<string, CodeBlock>();
    const topLevel: Stmt[] = [];
    this.skipBreaks();
    while (!this.atEnd()) {
      if (this.atOp(OP.CODE)) {
        const block = this.parseCode();
        codes.set(block.name, block);
      } else {
        topLevel.push(this.parseStmt());
      }
      this.skipBreaks();
    }
    return { codes, topLevel };
  }

  private parseCode(): CodeBlock {
    this.expectOp(OP.CODE, "code");
    const nameTok = this.next();
    if (nameTok?.kind !== "var") throw new ParseError("expected code block name");
    const params: string[] = [];
    this.expectOp(OP.LPAREN, "(");
    while (!this.atOp(OP.RPAREN)) {
      const p = this.next();
      if (p?.kind !== "var") throw new ParseError("expected parameter name");
      params.push(p.name);
      if (this.atOp(OP.COMMA)) this.pos++;
    }
    this.pos++; // )
    // A handler ends at `endcode` OR at the next `code` (start of the following
    // handler). Some compiled scripts end a handler with a bare `exitcode` and
    // NO `endcode` — e.g. TAOOT's TURBINE slider boilsound — and stopping only at
    // `endcode` made this block swallow the entire next handler (calcswitchdeg
    // vanished, so the slider's `calcswitchdeg()` resolved to 0 and pinned it).
    const body = this.parseBlock([OP.ENDCODE, OP.CODE]);
    if (this.atOp(OP.ENDCODE)) this.pos++; // consume endcode when present
    return { name: nameTok.name, params, body };
  }

  /** parse statements until one of the given closing opcodes (not consumed) */
  private parseBlock(closers: number[]): Stmt[] {
    const stmts: Stmt[] = [];
    this.skipBreaks();
    while (!this.atEnd()) {
      const t = this.peek();
      if (t?.kind === "op" && closers.includes(t.id)) break;
      stmts.push(this.parseStmt());
      this.skipBreaks();
    }
    return stmts;
  }

  private parseStmt(): Stmt {
    const t = this.peek();
    if (!t) throw new ParseError("unexpected end of script");

    if (t.kind === "op") {
      switch (t.id) {
        case OP.GLOBAL:
        case OP.LOCAL:
        case OP.DUMPGLOBAL:
        case OP.DUMPLOCAL: {
          this.pos++;
          const kind =
            t.id === OP.GLOBAL ? "global"
            : t.id === OP.LOCAL ? "local"
            : t.id === OP.DUMPGLOBAL ? "dumpglobal"
            : "dumplocal";
          const names: string[] = [];
          for (;;) {
            const n = this.next();
            if (n?.kind !== "var") throw new ParseError(`expected name after ${kind}`);
            names.push(n.name);
            if (this.atOp(OP.COMMA)) this.pos++;
            else break;
          }
          return { t: "decl", kind, names };
        }
        case OP.EXITCODE:
          this.pos++;
          return { t: "exitcode" };
        case OP.PASSCODE:
          this.pos++;
          return { t: "passcode" };
        case OP.RETURN: {
          this.pos++;
          if (this.peek()?.kind === "break" || this.atEnd()) return { t: "return" };
          return { t: "return", value: this.parseExpr() };
        }
        case OP.IF: {
          this.pos++;
          const cond = this.parseExpr();
          const then = this.parseBlock([OP.ELSE, OP.ENDIF]);
          let else_: Stmt[] | undefined;
          if (this.atOp(OP.ELSE)) {
            this.pos++;
            else_ = this.parseBlock([OP.ENDIF]);
          }
          this.expectCloser(OP.ENDIF, "endif");
          return { t: "if", cond, then, else_ };
        }
        case OP.SWITCH: {
          this.pos++;
          const subject = this.parseExpr();
          // dead statements before the first case exist in the corpus; the
          // engine jumps straight to the matching case, so parse and drop them
          this.parseBlock([OP.CASE, OP.ENDSWITCH]);
          const cases: { match: Expr; body: Stmt[] }[] = [];
          while (this.atOp(OP.CASE)) {
            this.pos++;
            const match = this.parseExpr();
            const body = this.parseBlock([OP.CASE, OP.ENDSWITCH]);
            cases.push({ match, body });
          }
          this.expectCloser(OP.ENDSWITCH, "endswitch");
          return { t: "switch", subject, cases };
        }
        case OP.WHILE: {
          this.pos++;
          const cond = this.parseExpr();
          const body = this.parseBlock([OP.ENDWHILE]);
          this.expectOp(OP.ENDWHILE, "endwhile");
          return { t: "while", cond, body };
        }
        case OP.FOR: {
          this.pos++;
          const v = this.next();
          if (v?.kind !== "var") throw new ParseError("expected for-loop variable");
          this.expectOp(OP.ASSIGN_EQ, "=");
          const from = this.parseExpr();
          this.expectOp(OP.TO, "to");
          const to = this.parseExpr();
          let step: Expr | undefined;
          if (this.atOp(OP.STEP)) {
            this.pos++;
            step = this.parseExpr();
          }
          const body = this.parseBlock([OP.ENDFOR]);
          this.expectOp(OP.ENDFOR, "endfor");
          return { t: "for", varName: v.name, from, to, step, body };
        }
      }
      if (t.id === OP.SLASH) {
        // "/" at statement start: a `//` comment line — skip it
        this.skipLine();
        return { t: "noop" };
      }
      // engine command as statement, e.g. cursor ("touch")
      const call = this.parseExpr();
      if (call.t !== "call")
        throw new ParseError(`expected statement, got expression ${JSON.stringify(call)}`);
      return { t: "callstmt", call };
    }

    if (t.kind === "var") {
      // assignment or user-code call
      const after = this.toks[this.pos + 1];
      if (this.isOp(after, OP.ASSIGN_EQ)) {
        this.pos += 2;
        return { t: "assign", name: t.name, value: this.parseExpr() };
      }
      if (this.isOp(after, OP.LPAREN)) {
        const call = this.parseExpr();
        if (call.t !== "call")
          throw new ParseError(`bare expression statement: ${JSON.stringify(call)}`);
        return { t: "callstmt", call };
      }
      // bare identifier line (labels/typos like `reutrn "engaged"` exist in
      // the shipped TAOOT scripts); the engine ignored them — skip the line
      this.skipLine();
      return { t: "noop" };
    }

    throw new ParseError(`unexpected token at statement start: ${JSON.stringify(t)}`);
  }

  private parseExpr(minPrec = 1): Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t?.kind !== "op") break;
      const bin = BIN_PREC[t.id];
      if (!bin || bin.prec < minPrec) break;
      this.pos++;
      const right = this.parseExpr(bin.prec + 1);
      left = { t: "bin", op: bin.op, l: left, r: right };
    }
    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (this.isOp(t, OP.NOT)) {
      this.pos++;
      return { t: "un", op: "not", e: this.parseUnary() };
    }
    if (this.isOp(t, OP.MINUS)) {
      this.pos++;
      return { t: "un", op: "-", e: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.next();
    if (!t) throw new ParseError("unexpected end of expression");
    switch (t.kind) {
      case "int":
        return { t: "int", v: t.value };
      case "str":
        return { t: "str", v: t.value };
      case "var":
        if (this.atOp(OP.LPAREN)) return this.parseCallArgs({ name: t.name });
        return { t: "var", name: t.name };
      case "op":
        switch (t.id) {
          case OP.TRUE:
            return { t: "bool", v: true };
          case OP.FALSE:
            return { t: "bool", v: false };
          case OP.ME:
            return { t: "me" };
          case OP.TARGET:
            return { t: "target" };
          case OP.LPAREN: {
            const inner = this.parseExpr();
            this.expectOp(OP.RPAREN, ")");
            return inner;
          }
          default:
            // engine command used as a function (anything but an operator opcode)
            if (!isOperatorOpcode(t.id)) {
              if (this.atOp(OP.LPAREN)) return this.parseCallArgs({ name: t.name, id: t.id });
              // some commands appear without parens (e.g. debugger)
              return { t: "call", name: t.name, id: t.id, args: [] };
            }
        }
        throw new ParseError(`unexpected operator in expression: ${t.name} (${t.id})`);
      case "break":
        throw new ParseError("unexpected line break in expression");
    }
  }

  private parseCallArgs(callee: { name: string; id?: number }): CallExpr {
    this.expectOp(OP.LPAREN, "(");
    const args: Expr[] = [];
    while (!this.atOp(OP.RPAREN)) {
      args.push(this.parseExpr());
      if (this.atOp(OP.COMMA)) this.pos++;
    }
    this.pos++; // )
    return { t: "call", name: callee.name, id: callee.id, args };
  }
}

export function parseScript(tokens: Token[]): Script {
  return new Parser(tokens).parseScript();
}
