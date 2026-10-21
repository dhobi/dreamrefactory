/**
 * The Maya's puzzles, solved — the pure half, with no game attached: the
 * tables the scripts hold (the calendar's gears, the skeleton's joints, the
 * maze's holes and patrols, the skulls' steps, the podium's rise, the
 * stalactites' places, the sliding stones' groups) and the searches over them.
 *
 * Two players share it: the machine suites' route (tests/machine/worlds/
 * maya.ts), which reads the game through the harness, and the speedrun's verbs
 * (src/speedrun/maya.ts), which read it through the page. Where each table
 * came from is said where the machine route uses it.
 */

/* ---- the calendar (m008, frame 907) ---- */
export type Wheels = [number, number, number];
export const MOD: Wheels = [24, 36, 48];
/** what one turn (+1 = the drag down, `wheelup`) of each wheel does to all three */
export const TURN: Record<"a" | "b" | "c", Wheels> = { a: [-3, -3, 0], b: [-3, -3, 3], c: [3, 0, 3] };
export const GODS: { god: number; ball: string; date: (w: Wheels) => boolean; flag: string }[] = [
  { god: 1, ball: "B", flag: "skullflag", date: ([a, b, c]) => a === 12 && b === 6 && c === 12 },
  { god: 2, ball: "C", flag: "monkeyflag", date: ([a, b, c]) => (a === 0 || a === 3) && b === 9 && c === 24 },
  { god: 3, ball: "D", flag: "jaguarflag", date: ([a, b, c]) => a === 6 && b === 0 && c === 6 },
  { god: 4, ball: "E", flag: "lizardflag", date: ([a, b, c]) => a === 12 && b === 30 && c === 45 },
];

export function turnsTo(from: Wheels, done: (w: Wheels) => boolean): { wheel: "a" | "b" | "c"; dir: 1 | -1 }[] {
  const key = (w: Wheels): string => w.join(",");
  const prev = new Map<string, { at: Wheels; wheel: "a" | "b" | "c"; dir: 1 | -1 } | null>([[key(from), null]]);
  const queue: Wheels[] = [from];
  while (queue.length) {
    const at = queue.shift()!;
    if (done(at)) {
      const path: { wheel: "a" | "b" | "c"; dir: 1 | -1 }[] = [];
      for (let p = prev.get(key(at)); p; p = prev.get(key(p.at))) path.unshift({ wheel: p.wheel, dir: p.dir });
      return path;
    }
    for (const wheel of ["a", "b", "c"] as const)
      for (const dir of [1, -1] as const) {
        const next = at.map((v, i) => (((v + dir * TURN[wheel][i]) % MOD[i]) + MOD[i]) % MOD[i]) as Wheels;
        if (prev.has(key(next))) continue;
        prev.set(key(next), { at, wheel, dir });
        queue.push(next);
      }
  }
  throw new Error(`no turns of the calendar reach the date from ${from.join(", ")}`);
}


/* ---- the skeleton (m043, frame 802) ---- */
export const BONE: Record<number, { h: number; v: number; oh?: number; ov?: number; z: number }> = {
  0: { h: 1, v: 18, oh: 1, ov: -16, z: 1 }, 1: { h: 2, v: 17, oh: 0, ov: -20, z: 100 },
  2: { h: 10, v: 28, oh: 5, ov: 27, z: 3 }, 3: { h: 6, v: 29, oh: 1, ov: -29, z: 100 },
  4: { h: 15, v: 19, z: -1 }, 5: { h: 1, v: 36, oh: 3, ov: -36, z: 100 },
  6: { h: -11, v: 50, z: -1 }, 7: { h: 6, v: 42, oh: 3, ov: -42, z: 100 },
  8: { h: 10, v: 59, z: -1 }, 9: { h: -4, v: 31, oh: 3, ov: -24, z: 10 },
  10: { h: 4, v: 12, oh: -1, ov: -12, z: 100 }, 11: { h: -1, v: 38, oh: 4, ov: -38, z: 100 },
  12: { h: -10, v: 25, z: -1 },
};
export const JOINT: Record<number, { oh: number; ov: number }> = { 18: { oh: -56, ov: 162 }, 19: { oh: 45, ov: 162 }, 20: { oh: -34, ov: 34 }, 21: { oh: 17, ov: 34 } };
export const PLACE: Record<number, [number, number]> = {
  0: [257, 93], 1: [256, 127], 2: [247, 179], 3: [245, 181], 4: [235, 229], 5: [369, 113], 6: [382, 199],
  7: [281, 249], 8: [275, 352], 9: [342, 237], 10: [341, 275], 11: [340, 328], 12: [355, 391],
};

/** the bones in an order that sets each in its place, with where to let each go */
export function skeleton(): { bone: number; at: [number, number] }[] {
  const pos = new Map<number, [number, number]>([18, 19, 20, 21].map((j) => [j, [320, 240]]));
  let open = [18, 19, 20, 21];
  const order: { bone: number; at: [number, number] }[] = [];
  const left = new Set(Object.keys(BONE).map(Number));
  while (left.size) {
    let placed = false;
    for (const b of left) {
      for (const [i, j] of open.entries()) {
        const joint = j >= 18 ? { ...JOINT[j], z: 100 } : { oh: BONE[j].oh!, ov: BONE[j].ov!, z: BONE[j].z };
        if (joint.z !== 100 && joint.z !== b) continue;
        const [jx, jy] = pos.get(j)!;
        const at: [number, number] = [jx + joint.oh - BONE[b].h, jy - joint.ov + BONE[b].v];
        if (Math.abs(at[0] - PLACE[b][0]) > 10 || Math.abs(at[1] - PLACE[b][1]) > 10) continue;
        pos.set(b, at);
        order.push({ bone: b, at });
        open = [...open.slice(0, i), ...(BONE[b].z === -1 ? [] : [b]), ...open.slice(i + 1)];
        left.delete(b);
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) throw new Error(`no bone of ${[...left].join(", ")} sets on the joints ${open.join(", ")}`);
  }
  return order;
}


/* ---- the spider maze (m020, frame 556) ---- */
export const HOLES: Record<string, { to: [number, number]; snake?: string }> = {
  button24: { to: [181, 351] }, button26: { to: [542, 422] }, button28: { to: [83, 45] },
  button10: { to: [156, 123], snake: "snakes0" }, button15: { to: [102, 421], snake: "snakes2" },
  button13: { to: [409, 287], snake: "snakes4" }, button21: { to: [366, 366], snake: "snakes10" },
  button20: { to: [578, 221], snake: "snakes8" }, button17: { to: [487, 264], snake: "snakes6" },
};

/** each red spider's beat (m.shp `red`: `red1`, `red2`, `red3`, then `red2` again, by its row) */
export const BEAT: [number, number][][] = [
  [[56, 167], [60, 73], [179, 71]], [[95, 248], [95, 212], [58, 210]], [[280, 250], [279, 300], [169, 300]],
  [[311, 390], [308, 324], [206, 324]], [[581, 117], [579, 27], [429, 25]],
];

/** the cost of a step onto (x, y): dear within 14 px of an awake red spider's beat */
export function beatCost(awake: number[]): (x: number, y: number) => number {
  const lines = awake.flatMap((r) => [[BEAT[r][0], BEAT[r][1]], [BEAT[r][1], BEAT[r][2]]] as [[number, number], [number, number]][]);
  return (x, y) => {
    for (const [[ax, ay], [bx, by]] of lines) {
      const len = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
      for (let t = 0; t <= len; t += 3) {
        const px = ax + ((bx - ax) * t) / len, py = ay + ((by - ay) * t) / len;
        if (Math.abs(px - x) < 14 && Math.abs(py - y) < 14) return 40;
      }
    }
    return 1;
  };
}


/* ---- the double pyramid's skulls (m032, frame 282) ---- */
export const SKULL_STEPS = [4, 5, 8, -5, -6, -8];
export const SKULL_USES = [3, 5, 4, 4, 3, 3];

export function skullOrder(): number[] {
  const uses = [...SKULL_USES];
  const lit = new Array<boolean>(22).fill(false);
  const order: number[] = [];
  const dfs = (at: number): boolean => {
    if (order.length === 22) return true;
    for (let s = 0; s < 6; s++) {
      if (!uses[s]) continue;
      const next = (((at + SKULL_STEPS[s]) % 22) + 22) % 22;
      if (lit[next]) continue;
      uses[s]--;
      lit[next] = true;
      order.push(s);
      if (dfs(next)) return true;
      order.pop();
      lit[next] = false;
      uses[s]++;
    }
    return false;
  };
  if (!dfs(0)) throw new Error("no order of the skulls lights all 22");
  return order;
}


/* ---- the podium (m038, frame 229) ---- */
export const PODIUM_RISE: Record<number, number> = { 0: 180, 1: 110, 2: 70, 3: 34, 4: -4, 5: -30, 6: -48, 7: -70, 8: -92, 9: -116 };


/* ---- the stalactites (m039, frame 226) ---- */
export const STALACTITE_X = [155, 246, 324, 399, 469];


/* ---- the Sun temple's sliding stones (m024, frame 556) ---- */
export const GROUP_CELLS = [[0, 1, 4, 5], [8, 9, 12, 13], [2, 3, 6, 7], [10, 11, 14, 15]];

export type Board = { cell: Map<number, number>; hole: number; locked: Set<number> };

/**
 * The board as the props show it: each small tile's cell from where it stands
 * (its anchor), the cells of each group already whole and fixed (its large
 * picture up), and the hole (`hole`).
 */
export function boardOf(tiles: { t: number; x: number; y: number }[], whole: boolean[], hole: number): Board {
  const cell = new Map<number, number>();
  for (const { t, x, y } of tiles) cell.set(t, Math.floor((y - 231) / 44) * 4 + Math.floor((x - 221) / 56));
  const locked = new Set<number>();
  for (let g = 0; g < 4; g++) if (whole[g]) for (const c of GROUP_CELLS[g]) locked.add(c);
  return { cell, hole, locked };
}

/** the cells to click, in turn, to bring `tiles` onto `cells` */
export function slideTo(board: Board, tiles: number[], cells: number[]): number[] | null {
  const adj = (c: number): number[] =>
    [c - 4, c + 4, c % 4 ? c - 1 : -1, c % 4 < 3 ? c + 1 : -1].filter((n) => n >= 0 && n < 16 && !board.locked.has(n));
  const key = (hole: number, pos: number[]): string => `${hole}|${pos.join(",")}`;
  const start = tiles.map((t) => board.cell.get(t)!);
  const done = (pos: number[]): boolean => pos.every((p, i) => p === cells[i]);
  const prev = new Map<string, { k: string; click: number } | null>([[key(board.hole, start), null]]);
  const queue: [number, number[]][] = [[board.hole, start]];
  for (let q = 0; q < queue.length; q++) {
    const [hole, pos] = queue[q];
    if (done(pos)) {
      const clicks: number[] = [];
      for (let p = prev.get(key(hole, pos)); p; p = prev.get(p.k)) clicks.unshift(p.click);
      return clicks;
    }
    for (const c of adj(hole)) {
      const next = pos.map((p) => (p === c ? hole : p));
      const k = key(c, next);
      if (prev.has(k)) continue;
      prev.set(k, { k: key(hole, pos), click: c });
      queue.push([c, next]);
    }
  }
  return null;
}


/**
 * Whether a shuffle can be slid out at all: every stone onto its own cell of
 * its group (`GROUP_CELLS`), the taken one's cell left as the hole. A slide is
 * a swap of the hole with a stone, so — as in any fifteen puzzle — the
 * arrangement's parity has to match the hole's distance from where it ends.
 */
export function solvable(board: Board, missing: number): boolean {
  const home = (t: number): number => GROUP_CELLS[Math.floor(t / 4)][t % 4];
  // cell -> the cell its occupant belongs on (the hole belongs on the missing tile's)
  const want = new Array<number>(16);
  for (const [t, cell] of board.cell) want[cell] = home(t);
  want[board.hole] = home(missing);
  let swaps = 0;
  const seen = new Array<boolean>(16).fill(false);
  for (let i = 0; i < 16; i++) {
    if (seen[i]) continue;
    let len = 0;
    for (let j = i; !seen[j]; j = want[j]) ((seen[j] = true), len++);
    swaps += len - 1;
  }
  const h = board.hole, g = home(missing);
  const dist = Math.abs((h % 4) - (g % 4)) + Math.abs(Math.floor(h / 4) - Math.floor(g / 4));
  return swaps % 2 === dist % 2;
}
