import { Token } from "../df/script";
import { CaselessMap } from "./caseless";
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
    if (this.atEnd() || this.atCodeBoundary()) return;
    // a `case`/`endswitch` standing where this block's own closer should be means
    // the closer was never written — see {@link atSwitchBoundary}. Not for the
    // switch's OWN closer, which is the one thing those two cannot stand in for:
    // `endswitch` is what it is waiting for, and a `case` there is a case it has
    // not read yet.
    if (id !== OP.ENDSWITCH && this.atSwitchBoundary()) return;
    this.expectOp(id, what);
  }
  /**
   * Is the next token the end of the handler, however deep we are inside it?
   *
   * `endcode` and the `code` that starts the NEXT handler bound a block
   * absolutely — an `if`, `switch` or `while` still open when one arrives is
   * closed by it rather than allowed to swallow what follows. The corpus needs
   * this in exactly one place and needs it badly: SMETH1.PUP's `before` script
   * has `stewardwell` opening two `switch`es and closing one, and without this
   * that handler's last case ate the four handlers after it — `soundfx`,
   * `idlespeaks`, `byesmeth` and `smethellslounger`. Which is why Smethells
   * never turned you away from the first class lounge (#177): the `nolounge`
   * branch called a handler that had been eaten.
   *
   * The same tolerance already existed one level up, for a handler ending in a
   * bare `exitcode` with no `endcode` at all (TURBINE's `boilsound`); this is
   * that rule applied at every depth instead of only at the top.
   */
  private atCodeBoundary(): boolean {
    const t = this.peek();
    return t?.kind === "op" && (t.id === OP.ENDCODE || t.id === OP.CODE);
  }
  /**
   * ...and the same for a SWITCH's own structure: `case` and `endswitch` end
   * every block open inside the case they close.
   *
   * The compiler omits an `endif` where nothing could reach past it. Timelapse's
   * navigation tables are full of it — E026.STG's stage main, its `getframeaction`
   * case 140:
   *
   *     case 140
   *         if gateopen = 1
   *             return ("J.136 X TL.141 TR.239 L2 R2 ")
   *         else
   *             return ("J.136 X TL.141 TR.139 L2 R2 ")
   *     case 141
   *
   * Both arms return, so an `endif` would be dead and it is not written. The next
   * `case` is what closes the `if`, exactly as the original's jump table does —
   * and without this the parse died there and took the whole container with it.
   * Five of Timelapse's stage mains are this shape, which is five stages whose
   * navigation table was missing entirely.
   *
   * It cannot change a well-formed script: where an `endif` IS written, the
   * block's own closer is reached first and this is never consulted. A switch's
   * own case bodies already break on these two ({@link parseStmt}'s SWITCH case
   * lists them), so the only blocks this reaches are the ones nested inside.
   */
  private atSwitchBoundary(): boolean {
    const t = this.peek();
    return t?.kind === "op" && (t.id === OP.CASE || t.id === OP.ENDSWITCH);
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
  /**
   * Consume a `()` that carries no arguments, where the grammar wants no argument
   * list at all — see the note on `exitcode`/`passcode` in {@link parseStmt}.
   *
   * Empty only: anything between the parentheses is left for the caller to fail
   * on, because a keyword with a real argument is not a spelling difference.
   */
  private skipEmptyArgs(): void {
    if (this.atOp(OP.LPAREN) && this.toks[this.pos + 1]?.kind === "op" &&
        (this.toks[this.pos + 1] as { id: number }).id === OP.RPAREN) {
      this.pos += 2;
    }
  }

  /** does this container declare a handler at all? — see {@link parseScript} */
  private hasHandlers = false;

  /** advance to the next handler, or to the end — see {@link parseScript} */
  private skipToNextCode(): void {
    while (!this.atEnd() && !this.atOp(OP.CODE)) this.pos++;
  }

  /**
   * The handlers of one script container, and — between them — a tolerance for
   * tokens that are not code at all.
   *
   * A compiled container can carry DEAD TOKENS after a handler's `endcode`:
   * fragments of an earlier compile that the tool left in the stream and the
   * original engine never reached, because it dispatches to handlers by name and
   * never walks past the one it wants. This port parses the whole container up
   * front, so it walks straight into them, and until this was here one stray pair
   * of parentheses cost the caller every handler in the file.
   *
   * Timelapse is where that shows. Its BOOTFILE's first container ends
   * `endcode ( )` — two tokens past the last handler — and `parseStmt` on a bare
   * `(` throws, so `instanceFrom` discarded all fifteen handlers of it, `boot`
   * among them, and the game could not start at all. Its stages have the same
   * shape at scale: most stage mains are followed by the `case`/`return` limbs of
   * a `getframeaction` switch that is no longer inside any `code`. Across the four
   * discs 100 of 100,701 script containers fail this way; the other 99.90% never
   * reach this branch.
   *
   * Recovery is a RESYNC and not a stop, so a live handler after the rubbish is
   * still found, and it restarts from where the failed statement BEGAN rather than
   * from where it gave up — a statement that consumed tokens before throwing must
   * not be able to swallow the `code` that follows it.
   *
   * The tolerance costs nothing where it does not apply: it is gated on having
   * parsed a handler already. A container whose FIRST statement will not parse is
   * still a parse error, which is what keeps a genuine gap in this grammar from
   * being silently absorbed — the corpus is how the grammar was found, and a
   * parser that shrugs at everything cannot tell you it was wrong.
   */
  parseScript(): Script {
    // Handler names fold case, as every other name in this language does: a
    // `sendtoflat (…, openflatx ())` has to find a handler written `openFlatX`.
    // See CaselessMap.
    const codes: Map<string, CodeBlock> = new CaselessMap<CodeBlock>();
    const topLevel: Stmt[] = [];
    this.hasHandlers = this.toks.some((t) => t.kind === "op" && t.id === OP.CODE);
    this.skipBreaks();
    while (!this.atEnd()) {
      if (this.atOp(OP.CODE)) {
        const block = this.parseCode();
        codes.set(block.name, block);
      } else {
        const at = this.pos;
        try {
          topLevel.push(this.parseStmt());
        } catch (e) {
          // Gated on the container HAVING handlers — anywhere in it, not just
          // already-parsed ones. It was "at least one parsed already", which
          // caught dead tokens after a handler and not the same rubbish in front
          // of one: three of Timelapse's flat scripts open with a stray integer
          // and then a perfectly good `code setcursor (arg)` (M038.STG's
          // container 17 is `355` and then the handler), and losing a container
          // for a token before it says as little as losing one for a token after
          // it.
          //
          // A container with NO `code` at all still throws, which is the property
          // that matters: it is what keeps this from quietly reporting the
          // 31 one-token DATA containers on these discs — a lone `262144`, three
          // NUL bytes read as a string — as empty scripts. They are not scripts,
          // and a parse error is the right answer for them.
          if (!this.hasHandlers) throw e;
          this.pos = at;
          this.skipToNextCode();
        }
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
      // see {@link atCodeBoundary} and {@link atSwitchBoundary}
      if (this.atCodeBoundary() || this.atSwitchBoundary()) break;
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
        /**
         * `exitcode` and `passcode` — and an EMPTY ARGUMENT LIST after either, if
         * the compiler that wrote this file put one there.
         *
         * They are keywords and not calls: `exitcode` ends handling of an event and
         * `passcode` passes it to the next link in the chain, neither takes an
         * argument, and Titanic and Dust write both bare in all 22,125 places they
         * appear between them. Timelapse's compiler writes `exitcode ()` — 31 times
         * across its four discs — and without this the keyword was consumed, the
         * `(` then began a fresh statement, and the parse died on the line break
         * inside it (`expected ), got break`).
         *
         * Which cost more than 31 statements: a throw anywhere inside a handler
         * loses the whole CONTAINER, so three of Timelapse's shop scripts were
         * discarded entirely — including `i.shp`'s main, which is why the intro
         * world's `openshop`, `closeshop` and every `sendtoshop` into it did
         * nothing at all.
         *
         * Accepted only in the empty form. `exitcode (x)` appears nowhere in any of
         * the three corpora and would mean something this grammar has no reading
         * for, so it is still a parse error rather than a silently dropped
         * expression.
         */
        case OP.EXITCODE:
          this.pos++;
          this.skipEmptyArgs();
          return { t: "exitcode" };
        case OP.PASSCODE:
          this.pos++;
          this.skipEmptyArgs();
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
