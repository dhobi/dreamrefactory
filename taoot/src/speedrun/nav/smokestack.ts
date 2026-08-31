/**
 * The false smokestack, as a graph you can plan through.
 *
 * `smstack2` is ONE floor of a ring, replayed nine times, and its geometry is
 * fixed while what is SHUT changes level by level. Eight scenes go round the ring,
 * alternating: four you arrive in and four with a ladder.
 *
 *     scene37 -2- scene64 -3- scene42 -4- scene65 -5- scene39 -6- scene66 -7-
 *     scene38 -8- scene63 -1- back to scene37
 *
 * The numbers are the GAPS, and they are the maze: `SMSTACK2.SET pathblocked` is
 * `substring(blocks, "N") >= 0` for the gap a view walks through, and with
 * `blocked` true the scene script's keydown `exitcode`s and the walk never happens.
 * `setupblocks()` sets `blocks` from `mazenumber` and `stacklevel` — four mazes by
 * nine levels, written out in the script and copied into {@link STACK_BLOCKS}.
 *
 * The four ladders (`view78`, `view79`, `view68`, `view72`, each its own view
 * script) are NOT gated on the maze — but they are in the four scenes you never
 * arrive in, so every climb lands you exactly one gap away from the next ladder,
 * with both neighbours ladder scenes. That is the whole puzzle: one of the two gaps
 * beside you has to be open, and which ladder you took decides which two they are.
 *
 * A climb does `stacklevel = stacklevel + 1` and re-enters `smstack2`, except at
 * `stacklevel = stackmax - 1` (10 of 11), where it plays `topup.mov` and changes
 * set to `smstack3`. Coming in from `smstack1` sets `stacklevel = 2`, so the climb
 * is nine ladders and the ring walks between them.
 *
 * Why plan rather than climb greedily: **one of the four mazes has a dead entry**.
 * Maze 4 level 2 shuts gaps 2, 3, 5, 6 and 8, and a player who comes up into
 * scene39 has gap 5 on one side and gap 6 on the other — stuck on the first floor,
 * with nothing to do but go back down. The other fifteen (maze, entry) pairs solve
 * in 18 moves and maze 3 from scene38 in 20. Since `smstack1` is where you choose
 * which scene to come up into, {@link planStack} is handed all four and picks one
 * that works.
 *
 * ## The entry is also what the maze LOOKS like (#339)
 *
 * The published runner rules — climb, turn right, and read the crates: blocked at
 * once is maze 4, crates across the shaft is maze 3, nothing is 1 or 2 — are
 * relative to ONE ladder, `smstack1`'s View42 into scene37. They have to be: the
 * crate list is positions on the ring, so coming up somewhere else on it shows a
 * different part of the same maze, and two of those views are another maze's
 * signature exactly (maze 1 from scene38 reads as maze 3). That is not a bug, and
 * taoot/tests/auto/smokestack.ts pins it alongside the rules themselves so it is
 * not reported as one. (The bug the same report carried was a load leaving the
 * previous climb's crates on the floor — see runtime/saveload.ts.)
 *
 * That ladder is also the one to take: all four mazes solve from scene37 in 18
 * moves, so a route memorised per maze needs no branch on the entry. The order of
 * {@link STACK_ENTRIES} puts it first, which is why {@link pickEntry} answers
 * scene37 for every maze — intent, not luck.
 */

/** the ring, in order; every other one has a ladder */
export const STACK_RING = [
  "scene37",
  "scene64",
  "scene42",
  "scene65",
  "scene39",
  "scene66",
  "scene38",
  "scene63",
] as const;

/** the gap between `STACK_RING[i]` and `STACK_RING[i + 1]` — what `blocks` names */
const STACK_GAP = [2, 3, 4, 5, 6, 7, 8, 1];

/** the ladder out of the four scenes that have one, and where it puts you */
export const STACK_LADDER: Record<string, string> = {
  scene64: "view79",
  scene65: "view68",
  scene66: "view72",
  scene63: "view78",
};

/** the two ring exits of every scene: `fwd` is towards the next scene in
 *  {@link STACK_RING}, `back` towards the previous one */
export const STACK_WALK: Record<string, { fwd: string; back: string }> = {
  scene37: { fwd: "view47", back: "view48" },
  scene64: { fwd: "view81", back: "view82" },
  scene42: { fwd: "view45", back: "view46" },
  scene65: { fwd: "view70", back: "view69" },
  scene39: { fwd: "view58", back: "view57" },
  scene66: { fwd: "view74", back: "view73" },
  scene38: { fwd: "view51", back: "view52" },
  scene63: { fwd: "view75", back: "view76" },
};

/**
 * Which scene each of `smstack1`'s four ways up puts you in, at `stacklevel = 2`.
 * All four are arrival scenes, so none of them has a ladder.
 */
export const STACK_ENTRIES: { stand: string; scene: string }[] = [
  { stand: "view42", scene: "scene37" },
  { stand: "view58", scene: "scene38" },
  { stand: "view59", scene: "scene39" },
  { stand: "view57", scene: "scene42" },
];

/** `blocks` per maze and level, verbatim from `setupblocks()` (level 1 errors) */
const STACK_BLOCKS: Record<number, Record<number, string>> = {
  1: { 2: "1,5", 3: "2,6", 4: "3,6", 5: "5", 6: "2,7", 7: "2,5,7", 8: "2,4,6,8", 9: "1,3,6,7", 10: "1,3,5" },
  2: { 2: "1", 3: "3,8", 4: "8", 5: "3", 6: "6,7", 7: "5,8", 8: "1,6,8", 9: "3,7", 10: "1,4,5,6,7,8" },
  3: { 2: "3,8", 3: "1", 4: "1,2,3,7,8", 5: "5,6,8", 6: "1,4,6", 7: "3,5,7,8", 8: "4,6,8", 9: "3,4,6,8", 10: "1,2,4,5,7" },
  4: { 2: "2,3,5,6,8", 3: "1,3,4,6,7", 4: "3,6", 5: "2,4,7,8", 6: "1,5", 7: "1,3,6", 8: "2,4,7", 9: "2,3,5,6,8", 10: "1,6" },
};

/** the top of the climb: `stackmax - 1`, the level whose ladder reaches smstack3 */
export const STACK_TOP = 10;

/** is this gap shut at this level? the engine's own `substring(blocks, "N") >= 0` */
const shut = (maze: number, level: number, gap: number): boolean =>
  (STACK_BLOCKS[maze]?.[level] ?? "").split(",").includes(String(gap));

/** one gesture of a climb: stand in `view` (of `from`) and press up */
export interface StackMove {
  kind: "walk" | "climb";
  /** the scene the move is made from */
  from: string;
  /** the standpoint to press up at */
  view: string;
  /** the scene it lands in — "smstack3" for the last climb */
  to: string;
  /** the level it lands on */
  level: number;
}

/**
 * The shortest way from `stacklevel = 2` in `entry` to the top, or null when there
 * isn't one (maze 4 from scene39).
 *
 * Breadth-first over (level, position). Descending is not modelled: it only ever
 * helps from a dead entry, and the caller chooses the entry instead.
 */
export function planStack(maze: number, entry: string): StackMove[] | null {
  const start = STACK_RING.indexOf(entry as (typeof STACK_RING)[number]);
  if (start < 0 || !STACK_BLOCKS[maze]) return null;
  const key = (level: number, i: number): string => `${level}:${i}`;
  const seen = new Set([key(2, start)]);
  const queue: { level: number; i: number; path: StackMove[] }[] = [{ level: 2, i: start, path: [] }];
  while (queue.length) {
    const cur = queue.shift()!;
    const here = STACK_RING[cur.i];
    const ladder = STACK_LADDER[here];
    if (ladder) {
      const to = STACK_RING[(cur.i + 1) % 8];
      const move: StackMove = { kind: "climb", from: here, view: ladder, to, level: cur.level + 1 };
      if (cur.level === STACK_TOP) return [...cur.path, { ...move, to: "smstack3", level: STACK_TOP }];
      const k = key(cur.level + 1, (cur.i + 1) % 8);
      if (!seen.has(k)) {
        seen.add(k);
        queue.push({ level: cur.level + 1, i: (cur.i + 1) % 8, path: [...cur.path, move] });
      }
    }
    const sides: [string, number, number][] = [
      ["fwd", STACK_GAP[cur.i], (cur.i + 1) % 8],
      ["back", STACK_GAP[(cur.i + 7) % 8], (cur.i + 7) % 8],
    ];
    for (const [side, gap, next] of sides) {
      if (shut(maze, cur.level, gap)) continue;
      const k = key(cur.level, next);
      if (seen.has(k)) continue;
      seen.add(k);
      const view = side === "fwd" ? STACK_WALK[here].fwd : STACK_WALK[here].back;
      queue.push({
        level: cur.level,
        i: next,
        path: [...cur.path, { kind: "walk", from: here, view, to: STACK_RING[next], level: cur.level }],
      });
    }
  }
  return null;
}

/** The first of `smstack1`'s four ways up that this maze can be climbed from —
 *  scene37 for all four, and see the note at the top of this file for why that is
 *  the one to want rather than merely the one that comes first. */
export function pickEntry(maze: number): { entry: { stand: string; scene: string }; plan: StackMove[] } | null {
  for (const entry of STACK_ENTRIES) {
    const plan = planStack(maze, entry.scene);
    if (plan) return { entry, plan };
  }
  return null;
}
