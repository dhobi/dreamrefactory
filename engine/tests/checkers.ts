/**
 * Bolivar's checkers opponent — `pluginfx("checkmove", …)` (engine/src/runtime/checkers.ts).
 *
 *   npx vitest run engine/tests/checkers.ts
 *
 * Reported from the chair as "I did my move but the opponent is not making his
 * move… looks like it still thinks it's my move", which is what an unimplemented
 * plugin looks like in this game: `automove ()` asked `CHECKERS.DLL` what
 * Bolivar does, got 0, found no comma-separated hops in it, and handed the turn
 * straight back. Nothing threw and nothing was logged as broken.
 *
 * So the thing under test is a CONTRACT with a 1995 script, and the script is the
 * authority on all of it — the move encoding (`decodemove`), which side owns
 * which sign (`ismine`), which way each side's men go (`makemove`'s promotion
 * rows) and whether a jump may be declined (`goodloc`: no). What makes these
 * tests worth more than the generator they check is the last one: the chain that
 * comes back is replayed through an INDEPENDENT transcription of the script's own
 * `goodmove`/`goodjump`/`makemove`, so a move this engine thinks is legal and the
 * game does not is a failure here rather than a puzzle in a saloon.
 */
import { test, expect } from "vitest";
import { checkMove, parseBoard, legalMoves } from "@dreamfactory/engine/runtime/checkers";

/**
 * A board from a picture, top row first — `row * 8 + col`, as `readboard` reads
 * it. `b`/`B` is Bolivar (positive, men walk DOWN the picture and crown on row
 * 7); `p`/`P` is the player. Capitals are kings.
 */
const board = (...rows: string[]): string => {
  expect(rows).toHaveLength(8);
  const cells: number[] = [];
  for (const row of rows) {
    const squares = row.replace(/\|/g, "").trim().split(/\s+/);
    expect(squares).toHaveLength(8);
    for (const s of squares) {
      cells.push({ ".": 0, b: 1, B: 2, p: -1, P: -2 }[s]!);
    }
  }
  return cells.join(" ");
};

/* ------------------------------------------------------------------ *
 * The script's own rules, transcribed — the referee for the last test
 * ------------------------------------------------------------------ */

const DECODE: Record<string, [number, number]> = {
  "1": [-2, 2], "2": [2, 2], "3": [2, -2], "4": [-2, -2],
  "5": [-1, 1], "6": [1, 1], "7": [1, -1], "8": [-1, -1],
};

/** `goodmove` and `goodjump`, together, for the side named as the script names it */
function legalForScript(cells: number[], move: string, person: "him" | "me"): boolean {
  const srow = Number(move[0]);
  const scol = Number(move[1]);
  const [drow, dcol] = DECODE[move[2]] ?? [NaN, NaN];
  if (!Number.isFinite(drow)) return false;
  const erow = srow + drow;
  const ecol = scol + dcol;
  const read = (r: number, c: number): number => cells[r * 8 + c];
  if (erow < 0 || ecol < 0 || erow > 7 || ecol > 7) return false;
  if (read(erow, ecol) !== 0) return false;
  const piece = read(srow, scol);
  // the piece has to be the mover's own — `ismine`'s sign test
  if (piece === 0 || (person === "him") !== piece > 0) return false;
  const king = Math.abs(piece) === 2;
  const fwd = person === "him" ? 1 : -1;
  if (drow === fwd || drow === -fwd) {
    // a step: forward for a man, either way for a king
    return Math.abs(dcol) === 1 && (drow === fwd || king);
  }
  // a jump: the middle square holds the other side (`> 0` / `< 0` in the script)
  const over = read(srow + drow / 2, scol + dcol / 2);
  if (over === 0 || over > 0 === piece > 0) return false;
  return drow === 2 * fwd || king;
}

/** `makemove` — one hop, promotion and capture included */
function applyForScript(cells: number[], move: string, person: "him" | "me"): number[] {
  const next = [...cells];
  const srow = Number(move[0]);
  const scol = Number(move[1]);
  const [drow, dcol] = DECODE[move[2]]!;
  const king = Math.abs(cells[srow * 8 + scol]) === 2 || srow + drow === (person === "him" ? 7 : 0);
  next[(srow + drow) * 8 + scol + dcol] = (king ? 2 : 1) * (person === "him" ? 1 : -1);
  next[srow * 8 + scol] = 0;
  if (drow === 2 || drow === -2) next[(srow + drow / 2) * 8 + scol + dcol / 2] = 0;
  return next;
}

/* ------------------------------------------------------------------ *
 * The answers
 * ------------------------------------------------------------------ */

test("a plugin may not throw — a board that is not one comes back empty", () => {
  expect(checkMove("", 3, 0)).toBe("");
  expect(checkMove("0 0 0", 3, 0)).toBe("");
  expect(checkMove(new Array(64).fill("x").join(" "), 3, 0)).toBe("");
  expect(parseBoard("1 2 3")).toBeNull();
});

test("he takes the jump, because the script will not let a jump be declined", () => {
  const b = board(
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . b . . . .",
    ". . . . p . . .",
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . . . . . .",
  );
  // (3,3) over (4,4) to (5,5) is +2 +2, which `decodemove` calls 2
  expect(checkMove(b, 3, 0)).toBe("332");
});

test("a double jump comes back as a CHAIN, which is what automove plays", () => {
  const b = board(
    ". . . . . . . .",
    ". . . . . . . .",
    ". . b . . . . .",
    ". . . p . . . .",
    ". . . . . . . .",
    ". . . . . p . .",
    ". . . . . . . .",
    ". . . . . . . .",
  );
  // (2,2)->(4,4) over (3,3), then (4,4)->(6,6) over (5,5): two hops, one piece
  expect(checkMove(b, 3, 0)).toBe("222,442");
});

test("a man that crowns mid-chain keeps jumping, and may jump backwards", () => {
  const b = board(
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . b . . . .",
    ". . . . p . p .",
    ". . . . . . . .",
  );
  // (5,3) crowns landing on row 7, then the new king jumps -2 +2 back over (6,6)
  expect(checkMove(b, 3, 0)).toBe("532,751");
});

test("no move at all is the empty string — the script reads it as the player winning", () => {
  const b = board(
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . . . . . b",
  );
  // a man in the far corner, facing off the board: nowhere to go
  expect(checkMove(b, 3, 0)).toBe("");
});

test("the player's answer is ALTERNATIVES with jumps first — the forced-jump signal", () => {
  const b = board(
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . b . . . .",
    ". . . . p . . .",
    ". . . . . . . .",
    ". p . . . . . .",
    ". . . . . . . .",
  );
  const answer = checkMove(b, 0, 1);
  const first = answer.split(",")[0];
  // (4,4) over (3,3) to (2,2) is -2 -2, code 4 — and `automove` clears
  // `playerjumps` only when the FIRST entry's code is 5 or more
  expect(first).toBe("444");
  expect(Number(first[2])).toBeLessThanOrEqual(4);
});

test("...and when the player has only steps, the first entry says so", () => {
  const b = board(
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . . . . . .",
    ". p . . . . . .",
    ". . . . . . . .",
  );
  const first = checkMove(b, 0, 1).split(",")[0];
  expect(Number(first[2])).toBeGreaterThanOrEqual(5);
});

test("the player with nothing left is empty, which gives Bolivar the game", () => {
  const b = board(
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . b . . . .",
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . . . . . .",
    ". . . . . . . .",
  );
  expect(checkMove(b, 0, 1)).toBe("");
});

test("deeper lookahead does not make him play an illegal move", () => {
  const b = board(
    ". b . b . b . b",
    "b . b . b . b .",
    ". b . b . b . b",
    ". . . . . . . .",
    ". . . . . . . .",
    "p . p . p . p .",
    ". p . p . p . p",
    "p . p . p . p .",
  );
  for (const depth of [2, 3, 4, 5]) {
    const answer = checkMove(b, depth, 0);
    expect(answer).not.toBe("");
    let cells = parseBoard(b)!;
    for (const hop of answer.split(",")) {
      expect(hop).toHaveLength(3);
      expect(legalForScript([...cells], hop, "him")).toBe(true);
      cells = Int8Array.from(applyForScript([...cells], hop, "him"));
    }
  }
});

/**
 * The referee, over every legal move of a real-ish position and both sides.
 *
 * Not a spot check: the generator's whole output is put to the script's rules,
 * because the failure this file exists to prevent is a move the plugin offers and
 * `goodloc` refuses — which in the game is a piece that will not go where the
 * opponent just put it.
 */
test("every move the generator offers is one the script would allow", () => {
  const b = board(
    ". b . . . B . b",
    "b . b . . . b .",
    ". . . p . b . .",
    ". . p . . . . .",
    ". . . . . p . .",
    "p . . . P . p .",
    ". p . . . . . p",
    "p . . . p . . .",
  );
  const cells = parseBoard(b)!;
  for (const [side, person] of [[0, "him"], [1, "me"]] as const) {
    const chains = legalMoves(cells, side);
    expect(chains.length).toBeGreaterThan(0);
    for (const chain of chains) {
      let now = [...cells];
      for (const hop of chain) {
        const text = `${hop.row}${hop.col}${
          Object.entries(DECODE).find(([, [r, c]]) => r === hop.dRow && c === hop.dCol)![0]
        }`;
        expect(legalForScript(now, text, person), `${person} ${text} in ${chain.length} hop(s)`).toBe(true);
        now = applyForScript(now, text, person);
      }
    }
  }
});
