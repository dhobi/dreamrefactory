/**
 * `pluginfx("checkmove", …)` — Bolivar's checkers opponent, off `CHECKERS.DLL`.
 *
 * The saloon's checkers game is `CHECKERS.PRP`, and the script in it is the
 * whole game EXCEPT the one thing a game needs: it draws the board, validates
 * what the player drags, plays the taunts, counts the dead and decides who won —
 * and asks a native plugin what Bolivar does. Two calls, both in `automove ()`:
 *
 *     move       = pluginfx ("checkmove", mainboard, count, 0)
 *     playerjumps = pluginfx ("checkmove", mainboard, 0, 1)
 *
 * Without them the game is silently unplayable rather than broken-looking: the
 * player drags a piece, `makemove` writes it, `automove` gets 0 back, the
 * `while findword (move, ",", count)` loop runs zero times, and `playerturn` is
 * set straight back to true. Nothing errors and nothing happens — reported as
 * "I did my move but the opponent is not making his move… looks like it still
 * thinks it's my move", which is exactly what that reads as from the chair.
 *
 * ## The board
 *
 * `mainboard` is 64 space-separated cells, `row * 8 + col` (`readboard`), and the
 * sign is the side: **positive is Bolivar** (`1` man, `2` king) and **negative
 * is the player** (`-1`, `-2`). `0` is empty. Bolivar's men move toward
 * INCREASING row and promote on row 7; the player's move toward row 0 and
 * promote there (`makemove`).
 *
 * ## A move
 *
 * Three characters — row, column, direction — and `decodemove` is the whole
 * table:
 *
 *     1 = -2 +2    2 = +2 +2    3 = +2 -2    4 = -2 -2     (jumps)
 *     5 = -1 +1    6 = +1 +1    7 = +1 -1    8 = -1 -1     (steps)
 *
 * so `"523"` is "the piece at row 5 column 2, jumping +2 +2". Codes 1-4 being
 * the jumps is load-bearing twice over: `automove` taunts on `<= 4`, and the
 * game learns that a jump is FORCED by testing the player's first move for
 * `>= 5`.
 *
 * ## The two answers
 *
 * **`side = 0` — Bolivar's move**, as a CHAIN: the comma-separated elements are
 * successive hops of one piece, because `automove` plays every one of them
 * through `makemove` and `makemove` removes a jumped piece per hop. An empty
 * string means he cannot move, and the script reads that as the player winning.
 *
 * **`side = 1` — the player's moves**, as ALTERNATIVES, jumps first. Empty means
 * the player has no legal move and the script gives the game to Bolivar. Only
 * the first element and only its third character are ever read (`automove`), so
 * the ordering IS the contract — everything after it is unobservable, and this
 * returns one entry per alternative rather than guessing at what the DLL packed
 * in behind.
 *
 * ## Jumps are compulsory
 *
 * `goodloc` refuses a simple move outright while `playerjumps` is set, so the
 * rule is the game's and not a preference: when a side has a jump, only jumps
 * are legal. Bolivar plays under it too, which is what the generator below does
 * for both sides.
 *
 * ## The quirk that is kept
 *
 * A man that promotes IN THE MIDDLE of a jump chain keeps jumping, as a king,
 * and may jump backwards to do it. That is not standard checkers — a promotion
 * normally ends the move — but it is what this game does, and visibly: after
 * each hop `mousedown` writes the promotion through `makemove` and only THEN
 * asks `goodjump (endrow, endcol, …, "me")`, which consults `isking` on the
 * square the piece has just become a king on. Mirrored here so the opponent
 * plays by the same rules the player is held to.
 *
 * ## The search
 *
 * `lookahead` is 2, 3 or 4 — `win ()` turns exactly those into "wineasy",
 * "winmedium", "winhard" — and `automove` raises it by one once the player has
 * lost nine pieces (`playerdead > 8 & count < 4`), so 5 is the deepest this is
 * ever asked for. Negamax with alpha-beta over a material-and-advancement
 * evaluation, which at those depths is instant and is far more chess than a 1995
 * saloon opponent needs.
 */

/** the board as the script keeps it: 64 cells of 0, ±1 (man), ±2 (king) */
export type Board = Int8Array;

/** one hop — the square moved from, and where to */
interface Hop {
  row: number;
  col: number;
  dRow: number;
  dCol: number;
}

/** `decodemove`, backwards: the direction code for a delta */
function code(dRow: number, dCol: number): number {
  if (dRow === -2 && dCol === 2) return 1;
  if (dRow === 2 && dCol === 2) return 2;
  if (dRow === 2 && dCol === -2) return 3;
  if (dRow === -2 && dCol === -2) return 4;
  if (dRow === -1 && dCol === 1) return 5;
  if (dRow === 1 && dCol === 1) return 6;
  if (dRow === 1 && dCol === -1) return 7;
  return 8;
}

const hopText = (h: Hop): string => `${h.row}${h.col}${code(h.dRow, h.dCol)}`;

/** the 64 cells, or null if this is not a board — a plugin may not throw */
export function parseBoard(text: string): Board | null {
  const cells = text.trim().split(/\s+/);
  if (cells.length !== 64) return null;
  const board = new Int8Array(64);
  for (let i = 0; i < 64; i++) {
    const n = Number(cells[i]);
    if (!Number.isInteger(n) || n < -2 || n > 2) return null;
    board[i] = n;
  }
  return board;
}

export const boardText = (b: Board): string => [...b].join(" ");

const at = (b: Board, row: number, col: number): number => b[row * 8 + col];
const on = (row: number, col: number): boolean => row >= 0 && row < 8 && col >= 0 && col < 8;
/** +1 for Bolivar, -1 for the player — the sign of their pieces AND their forward */
const dirOf = (side: number): number => (side === 0 ? 1 : -1);

/**
 * One hop applied, promotion included — `makemove`, in the same order.
 *
 * The promotion happens before anything asks whether the chain continues, which
 * is what lets a man crown mid-jump and carry on as a king (see the note above).
 */
function apply(b: Board, h: Hop): Board {
  const next = Int8Array.from(b);
  const piece = at(b, h.row, h.col);
  const row = h.row + h.dRow;
  const col = h.col + h.dCol;
  const king = Math.abs(piece) === 2 || row === (piece > 0 ? 7 : 0);
  next[row * 8 + col] = (king ? 2 : 1) * Math.sign(piece);
  next[h.row * 8 + h.col] = 0;
  if (h.dRow === 2 || h.dRow === -2) next[(h.row + h.dRow / 2) * 8 + (h.col + h.dCol / 2)] = 0;
  return next;
}

/** the diagonals a piece may use — `goodmove`/`goodjump`'s four conditions */
function ways(piece: number): [number, number][] {
  const fwd = Math.sign(piece);
  const out: [number, number][] = [
    [fwd, 1],
    [fwd, -1],
  ];
  if (Math.abs(piece) === 2) out.push([-fwd, 1], [-fwd, -1]);
  return out;
}

/** every jump chain from one square, as complete chains */
function chainsFrom(b: Board, row: number, col: number): Hop[][] {
  const piece = at(b, row, col);
  const out: Hop[][] = [];
  for (const [dr, dc] of ways(piece)) {
    const [jr, jc] = [row + dr * 2, col + dc * 2];
    if (!on(jr, jc) || at(b, jr, jc) !== 0) continue;
    // the piece being jumped has to be the OTHER side's — the script's own
    // `> 0` / `< 0` tests on the middle square
    const over = at(b, row + dr, col + dc);
    if (over === 0 || Math.sign(over) === Math.sign(piece)) continue;
    const hop: Hop = { row, col, dRow: dr * 2, dCol: dc * 2 };
    const after = apply(b, hop);
    const more = chainsFrom(after, jr, jc);
    if (more.length) for (const rest of more) out.push([hop, ...rest]);
    else out.push([hop]);
  }
  return out;
}

/**
 * Every legal move for a side, as chains — jumps only when there are jumps.
 *
 * Ordered jumps-first even though a jump excludes a step, because the caller for
 * `side = 1` needs the first element to be a jump when one exists and that is
 * the same ordering.
 */
export function legalMoves(b: Board, side: number): Hop[][] {
  const mine = dirOf(side);
  const jumps: Hop[][] = [];
  const steps: Hop[][] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = at(b, row, col);
      if (piece === 0 || Math.sign(piece) !== mine) continue;
      jumps.push(...chainsFrom(b, row, col));
      for (const [dr, dc] of ways(piece)) {
        if (on(row + dr, col + dc) && at(b, row + dr, col + dc) === 0) {
          steps.push([{ row, col, dRow: dr, dCol: dc }]);
        }
      }
    }
  }
  return jumps.length ? jumps : steps;
}

/**
 * The position, from Bolivar's side.
 *
 * Material with kings worth about a man and three quarters, plus a nudge for
 * advancement so a man with nothing to do walks up the board instead of shuffling
 * — which is the difference between an opponent and a stalled one at depth 2.
 */
function evaluate(b: Board): number {
  let score = 0;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = at(b, row, col);
      if (piece === 0) continue;
      const side = Math.sign(piece);
      score += side * (Math.abs(piece) === 2 ? 175 : 100);
      if (Math.abs(piece) === 1) score += side * (side > 0 ? row : 7 - row);
    }
  }
  return score;
}

/** negamax with alpha-beta, `side` to move, in plies */
function search(b: Board, side: number, depth: number, alpha: number, beta: number): number {
  const moves = legalMoves(b, side);
  // no move is a loss for whoever cannot move — the script's own rule, and
  // scored past any material so a search never prefers being stuck
  if (!moves.length) return side === 0 ? -100_000 : 100_000;
  if (depth <= 0) return evaluate(b);
  let best = side === 0 ? -Infinity : Infinity;
  for (const chain of moves) {
    let after = b;
    for (const hop of chain) after = apply(after, hop);
    const got = search(after, side === 0 ? 1 : 0, depth - 1, alpha, beta);
    if (side === 0) {
      best = Math.max(best, got);
      alpha = Math.max(alpha, got);
    } else {
      best = Math.min(best, got);
      beta = Math.min(beta, got);
    }
    if (beta <= alpha) break;
  }
  return best;
}

/**
 * `pluginfx("checkmove", board, depth, side)`.
 *
 * `pick` decides ties, and it is a parameter so the caller can hand in the
 * engine's own `random` — a deterministic opponent plays the same game against
 * the same play for ever, which is a worse opponent than a 1995 DLL. Defaults to
 * the first, so a test can leave it out and get one answer.
 */
export function checkMove(
  board: string,
  depth: number,
  side: number,
  pick: (n: number) => number = () => 0,
): string {
  const b = parseBoard(board);
  if (!b) return "";
  const moves = legalMoves(b, side);
  if (!moves.length) return "";
  // the PLAYER's moves: alternatives, jumps first, and only the first element's
  // direction is ever read — so one entry each, first hop, in that order
  if (side !== 0) return moves.map((chain) => hopText(chain[0])).join(",");

  const plies = Math.max(1, Math.min(8, Math.floor(depth) || 1));
  let best = -Infinity;
  let bestChains: Hop[][] = [];
  for (const chain of moves) {
    let after = b;
    for (const hop of chain) after = apply(after, hop);
    const got = search(after, 1, plies - 1, -Infinity, Infinity);
    if (got > best) {
      best = got;
      bestChains = [chain];
    } else if (got === best) {
      bestChains.push(chain);
    }
  }
  const chain = bestChains[pick(bestChains.length)] ?? bestChains[0];
  // his move is a CHAIN: `automove` plays every element through `makemove`
  return chain.map(hopText).join(",");
}
