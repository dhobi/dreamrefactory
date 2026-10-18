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
 * **`side = 1` — the player's move**, by the same search with the player
 * minimising; empty means the player cannot move, and the script gives the
 * game to Bolivar. The script only ever reads the first element's third character
 * (`automove`: a jump is forced when it is `<= 4`), and since jumps are
 * compulsory in the generator below, any move the DLL picks answers that the
 * same way. What is returned is what the DLL returns, chain and all.
 *
 * Every element ends in a comma, the last one included (`"216,"`,
 * `"212,432,"`): the DLL `sprintf`s each hop and appends `","` after it
 * (0x100010e4–0x10001183, and 0x100015d0 for the hops after the first).
 *
 * ## Jumps are compulsory
 *
 * `goodloc` refuses a simple move outright while `playerjumps` is set, and the
 * DLL's generator agrees: it scans the board row by row for capture codes 1–4
 * and only when there are none at all does it scan again for steps 5–8. That
 * scan order is also the tie-break, because the search keeps the first move
 * that strictly beats the score so far.
 *
 * ## A multi-jump is not searched
 *
 * After a capture the DLL (0x100015d0) takes the FIRST direction 1–4 in which
 * the piece can capture again and carries on; it never searches the
 * alternatives. A man that crowns mid-jump (row 7 for Bolivar, row 0 for the
 * player) is a king before that question is asked, so it may carry on
 * capturing backwards — the script's own `mousedown` does the same for the
 * player (it writes the promotion through `makemove` before `goodjump`).
 *
 * ## The search — 0x100011b0, verified move for move
 *
 * `lookahead` is 2, 3 or 4 — `win ()` turns exactly those into "wineasy",
 * "winmedium", "winhard" — and `automove` passes it straight through (and 0
 * for the player's question). Plain minimax, no pruning
 * (0x100013fd–0x100015a5):
 *
 * - no legal move, or depth 0: the position scores its evaluation, and the
 *   "best" is the first generated move;
 * - otherwise the score starts at −999 for Bolivar (0xfc19) and +999 for the
 *   player (0x3e7), each child is searched at depth − 1 for the other side,
 *   and a child replaces the best only if it is strictly `>` (Bolivar) or
 *   strictly `<` (player).
 *
 * The evaluation (0x100011ff–0x10001390) is 100 × the piece value (a king is
 * 2, so 200) with Bolivar positive, plus, for each piece and each of its four
 * diagonal neighbours on the board: the neighbour's |value| if it is an enemy,
 * and −1 if the square is empty and the piece is Bolivar's, +1 if it is the
 * player's.
 *
 * **The one thing the DLL leaves undefined.** If at the top level no move
 * scores strictly better than ±999 — only possible when one side is about ten
 * men behind — the DLL never writes its best-move buffer and prints whatever
 * that stack slot held. This returns the first legal move instead, which is
 * deterministic and is also what the DLL itself answers at depth 0.
 *
 * The answer is deterministic: the DLL calls no random number generator, so
 * the same position always gets the same move. The vectors in
 * `engine/tests/golden/checkers-dll.json` are the DLL's own answers, run under
 * an x86 emulator, and the test checks every one.
 */

/** the board as the script keeps it: 64 cells of 0, ±1 (man), ±2 (king) */
export type Board = Int8Array;

/** one hop — the square moved from, and the DLL's direction code 1–8 */
export interface Hop {
  row: number;
  col: number;
  code: number;
}

/** `decodemove`: row and column deltas by code, index 0 unused */
const DROW = [0, -2, 2, 2, -2, -1, 1, 1, -1];
const DCOL = [0, 2, 2, -2, -2, 1, 1, -1, -1];

const hopText = (h: Hop): string => `${h.row}${h.col}${h.code}`;

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

const on = (row: number, col: number): boolean => row >= 0 && row < 8 && col >= 0 && col < 8;

/** one move legal for `side` (0 Bolivar, otherwise the player) — the DLL's test */
function legal(b: Board, row: number, col: number, code: number, side: number): boolean {
  const piece = b[row * 8 + col];
  if (piece === 0 || piece < 0 !== (side !== 0)) return false;
  const dr = DROW[code];
  const r = row + dr;
  const c = col + DCOL[code];
  if (!on(r, c) || b[r * 8 + c] !== 0) return false;
  // a man goes forward only: Bolivar's down the rows, the player's up
  if (Math.abs(piece) !== 2 && (side === 0 ? dr < 0 : dr > 0)) return false;
  if (code <= 4) return piece * b[(row + dr / 2) * 8 + (col + DCOL[code] / 2)] < 0;
  return true;
}

/** the candidates in the DLL's order: every capture by scan order, else every step */
function generate(b: Board, side: number): Hop[] {
  for (const first of [1, 5]) {
    const out: Hop[] = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        for (let code = first; code < first + 4; code++) {
          if (legal(b, row, col, code, side)) out.push({ row, col, code });
        }
      }
    }
    if (out.length) return out;
  }
  return [];
}

/**
 * A move played out in place, with its forced continuation — 0x100015d0.
 *
 * Promotion first, then the question whether the piece can capture again, so a
 * man crowned mid-jump carries on as a king. Returns the hops played.
 */
function play(b: Board, first: Hop, side: number): Hop[] {
  const hops: Hop[] = [];
  let hop: Hop | undefined = first;
  while (hop) {
    hops.push(hop);
    const row: number = hop.row;
    const col: number = hop.col;
    const code: number = hop.code;
    const r: number = row + DROW[code];
    const c: number = col + DCOL[code];
    let piece = b[row * 8 + col];
    b[row * 8 + col] = 0;
    if (side === 0 ? r === 7 : r === 0) piece = side === 0 ? 2 : -2;
    b[r * 8 + c] = piece;
    if (code > 4) break;
    b[((row + r) / 2) * 8 + (col + c) / 2] = 0;
    hop = undefined;
    for (let k = 1; k <= 4; k++) {
      if (legal(b, r, c, k, side)) {
        hop = { row: r, col: c, code: k };
        break;
      }
    }
  }
  return hops;
}

/** 0x100011ff–0x10001390, from Bolivar's side */
function evaluate(b: Board): number {
  let score = 0;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = b[row * 8 + col];
      if (piece === 0) continue;
      score += 100 * piece;
      for (let k = 5; k <= 8; k++) {
        const r = row + DROW[k];
        const c = col + DCOL[k];
        if (!on(r, c)) continue;
        const n = b[r * 8 + c];
        if (n * piece < 0) score += Math.abs(n);
        else if (n === 0) score += piece > 0 ? -1 : 1;
      }
    }
  }
  return score;
}

/** minimax, no pruning — the best move (null: none beat ±999) and its score */
function search(b: Board, depth: number, side: number): { best: Hop | null; score: number } {
  const moves = generate(b, side);
  if (!moves.length || depth <= 0) return { best: moves[0] ?? null, score: evaluate(b) };
  let score = side === 0 ? -999 : 999;
  let best: Hop | null = null;
  for (const move of moves) {
    const child = Int8Array.from(b);
    play(child, move, side);
    const got = search(child, depth - 1, side === 0 ? 1 : 0).score;
    if (side === 0 ? got > score : got < score) {
      score = got;
      best = move;
    }
  }
  return { best, score };
}

/**
 * Every legal move for a side in the DLL's order, each with its forced
 * continuation — what the search chooses between.
 */
export function legalMoves(b: Board, side: number): Hop[][] {
  return generate(b, side).map((move) => play(Int8Array.from(b), move, side));
}

/**
 * `pluginfx("checkmove", board, depth, side)` — `CHECKERS.DLL`'s answer.
 *
 * `depth` is a 16-bit word in the DLL; anything below 1 is depth 0, which
 * answers with the first legal move.
 */
export function checkMove(
  board: string,
  depth: number,
  side: number,
): string {
  const b = parseBoard(board);
  if (!b) return "";
  const s = side === 0 ? 0 : 1;
  const moves = generate(b, s);
  if (!moves.length) return "";
  // the undefined case (see above) is the first legal move, as at depth 0
  const best = search(b, Math.max(0, Math.floor(depth) || 0), s).best ?? moves[0];
  return play(b, best, s)
    .map((h) => `${hopText(h)},`)
    .join("");
}
