/**
 * The high-score board — ten rows a difficulty, and it lives on the MENU.
 *
 * This was the writing that looked missing from the death screen. It is not on
 * the death screen: `0x45de89` draws it over `menu.mov` while that film's frame
 * index is 0…0xa7, which is its attract loop — the 168 frames before the six
 * button stubs. So the board is what the title screen shows while nobody is
 * touching it, and the kill vignette is only the film that gets you there.
 *
 * ## Three boards of ten, nineteen bytes a row
 *
 * `0x40f650(score, difficulty)` switches on the difficulty and each arm walks
 * its own table:
 *
 * ```
 *   difficulty  1  EASY     0x4a4f10       0x40f889
 *               0  MEDIUM   0x4a4d80       0x40f790
 *              -1  HARD     0x4a4e40       0x40f69b
 * ```
 *
 * A row is `{ Pascal name[13], dword score, word level }` — nineteen bytes, which
 * is the `lea edx, [eax + eax*8]` / `[eax + edx*2]` the three arms index with.
 * The insert is the same in all three:
 *
 * ```
 *   40f6b6  if (row[i].score >= score)  next i        ; ten rows, best first
 *   40f6d6  for (j = 8; j >= i; j--)  row[j+1] = row[j]
 *   40f722  row[i].score = score;  row[i].level = level
 *   40f742  0x40b140("Enter name for high scores:", &name)
 *   40f74f  if (name[0] >= 0xd)  name[0] = 0xc        ; twelve characters
 * ```
 *
 * An empty row's score is zero and `>= 0` is false for nothing, so a score of
 * zero never gets on the board and any score at all displaces an empty row.
 *
 * ## What it is drawn from
 *
 * `0x40f990(point, difficulty, shadow)` is called twice from `0x45dec8` with the
 * same point — `{y 107, x 44}`, written as one dword at `0x45de90` — once with
 * the flag set and once without. The flag is a DROP SHADOW: it offsets the whole
 * thing by (2, 1) and draws it in `0xe8` where the second pass draws in `0xe1`.
 *
 * The one thing the two passes do differently is the difficulty heading. The
 * shadow pass draws all three of `Easy`, `Med` and `Hard`; the second draws only
 * the one `[0x46b20c]` is on. So the board names which difficulty it is showing
 * by lighting one of three labels, and the other two stay in the shadow colour.
 */

/** one row of a board, and every one of the thirty exists whether or not it is filled */
export interface ScoreRow {
  /** up to twelve characters — `0x40f74f` truncates a longer answer */
  name: string;
  /** `row+0x0d`, a dword */
  score: number;
  /** `row+0x11`, and `0x402bd0` is what fills it */
  level: number;
}

/** the three tables, keyed by the difficulty `[0x46b20c]` holds */
export type ScoreBoards = Record<"1" | "0" | "-1", ScoreRow[]>;

/** `0x40f6aa` — ten rows, and the loop counts them */
export const BOARD_ROWS = 10;
/** `0x40f74f` — a name longer than this is cut */
export const NAME_MAX = 12;
/** `0x46bf4d` — the dialog's own words */
export const NAME_PROMPT = "Enter name for high scores:";

/** where each difficulty's ten rows are, which is also how this port names them */
export const BOARD_FROM: Record<"1" | "0" | "-1", { at: string; arm: string; label: string }> = {
  "1": { at: "0x4a4f10", arm: "0x40f889", label: "Easy" },
  "0": { at: "0x4a4d80", arm: "0x40f790", label: "Med" },
  "-1": { at: "0x4a4e40", arm: "0x40f69b", label: "Hard" },
};

/**
 * Where every piece of it goes, on the game's own 512x384 screen.
 *
 * The point is `0x45de90`'s dword, low word first the way every rect in this
 * engine is stored — `{y 0x6b, x 0x2c}`. Everything else is an offset off it.
 */
export const BOARD = {
  x: 0x2c,
  y: 0x6b,
  /** `0x40f9da` / `0x40f9e3` — the shadow pass, and its two colours */
  shadow: { dx: 2, dy: 1, ink: 0xe8 },
  ink: 0xe1,
  /** the three column headings, `0x40fa45` onward */
  headings: [
    { text: "Name", dx: 0 },
    { text: "Score", dx: 0x5a },
    { text: "Level", dx: 0xb4 },
  ],
  /** the difficulty labels, `0x40fac2` — twenty-two pixels above the headings */
  labels: [
    { key: "1" as const, text: "Easy", dx: 0x34 },
    { key: "0" as const, text: "Med", dx: 0x5d },
    { key: "-1" as const, text: "Hard", dx: 0x84 },
  ],
  labelDy: -0x16,
  /** the rows: `0x40fbe2` starts at +0x87 and `0x40fd16` walks back up by 13 */
  firstRowDy: 0x87 - (BOARD_ROWS - 1) * 0xd,
  rowHeight: 0xd,
  /** the three columns of a row, `0x40fc6e`, `0x40fc82` and `0x40fd0d` */
  nameDx: 0,
  scoreDx: 0x69,
  levelDx: 0xc3,
  /** `0x40fc94` — a row with a real score is nudged ten pixels left */
  filledNudge: 0xa,
  /** `0x46bf71` and `0x46bf6d` — what an empty row shows */
  emptyName: "-----",
  emptyCell: "-",
  /** `0x45de89` — the board is only up while the menu film is in its attract loop */
  attractUntilFrame: 0xa7,
} as const;

export function emptyBoards(): ScoreBoards {
  const ten = (): ScoreRow[] => Array.from({ length: BOARD_ROWS }, () => ({ name: "", score: 0, level: 0 }));
  return { "1": ten(), "0": ten(), "-1": ten() };
}

/**
 * `Skull.sco`, which a browser has nowhere to put.
 *
 * `0x40f210` opens the file named at `0x46bf41` and reads the three tables back
 * whole. There is no file here, so the same thirty rows live beside the
 * preferences — see {@link file://./prefs.ts}, which says why anything at all
 * has to be stored on this side.
 */
const STORE = "skullcracker.scores";

export function loadBoards(): ScoreBoards {
  const fresh = emptyBoards();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORE);
  } catch {
    return fresh;
  }
  if (!raw) return fresh;
  try {
    const got = JSON.parse(raw) as Partial<ScoreBoards>;
    for (const key of ["1", "0", "-1"] as const) {
      const rows = got[key];
      if (!Array.isArray(rows)) continue;
      for (let i = 0; i < BOARD_ROWS; i++) {
        const row = rows[i] as Partial<ScoreRow> | undefined;
        if (!row) continue;
        fresh[key][i] = {
          name: String(row.name ?? "").slice(0, NAME_MAX),
          score: Number(row.score) || 0,
          level: Number(row.level) || 0,
        };
      }
    }
  } catch {
    /* a board that will not parse is an empty board, which is what a missing
       `Skull.sco` gives the original too */
  }
  return fresh;
}

export function saveBoards(boards: ScoreBoards): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(boards));
  } catch {
    /* storage off: the board is this session's */
  }
}

/** which of the three a difficulty reads, as a key */
export function boardKey(difficulty: number): "1" | "0" | "-1" {
  return difficulty > 0 ? "1" : difficulty < 0 ? "-1" : "0";
}

/**
 * `0x40f650` — offer a score to its difficulty's board.
 *
 * Returns the row it took, or -1. The name is asked for only when there is a row
 * to put it in, which is the order `0x40f722` does it in: the score and the
 * level are written first and the dialog comes after, so a cancelled dialog
 * leaves a nameless row on the board rather than no row at all.
 */
export function offerScore(
  boards: ScoreBoards,
  difficulty: number,
  score: number,
  level: number,
  askName: () => string | null,
): number {
  const rows = boards[boardKey(difficulty)];
  for (let i = 0; i < BOARD_ROWS; i++) {
    if (rows[i].score >= score) continue;
    for (let j = BOARD_ROWS - 2; j >= i; j--) rows[j + 1] = rows[j];
    rows[i] = { name: "", score, level };
    const said = askName();
    if (said !== null) rows[i].name = said.slice(0, NAME_MAX);
    return i;
  }
  return -1;
}
