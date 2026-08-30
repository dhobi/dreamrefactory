/**
 * Getting from one standpoint to another in a DreamFactory 1 set.
 *
 * Titanic's planner needs a hand-built ship graph, because a v4 set addresses a
 * standpoint by numbered view and the roads between rooms are not in the file.
 * Dust hands you the graph: a v1 set is a **grid of cells with a flat move
 * table**, and every entry names the cell and facing it leaves and the cell and
 * facing it arrives at ({@link V1Transition}). So a route is a breadth-first
 * search over `(x, z, facing)` and nothing has to be authored by hand.
 *
 * The compass is derived, not assumed. A walk from a standpoint moves the cell,
 * so the facings can be read off the file's own moves — whichever facing walks
 * to `z - 1` is north, whatever number the set gives it — and the turn ring
 * follows from that. A set that numbered its facings differently would still
 * plan correctly, and a set whose moves contradict the ring is a bug this would
 * surface rather than paper over.
 *
 * Pure: it takes a parsed set and returns key presses. No browser, no session,
 * so a route can be checked in the fast suite (`dust/tests/nav.ts`) and only the
 * *taking* of it needs a page.
 */
import type { SetFileV1, V1Transition } from "@dreamfactory/engine/df/set-v1";

/** the three keys a Dust set script answers to, and nothing else */
export type NavKey = "uparrow" | "leftarrow" | "rightarrow";

export interface Stand {
  x: number;
  z: number;
  /** the set's own facing number, 1..4 */
  facing: number;
}

/** where a facing takes you when you walk, read off the set's own moves */
export function compass(set: SetFileV1): Map<number, { dx: number; dz: number }> {
  const out = new Map<number, { dx: number; dz: number }>();
  for (const t of set.transitions) {
    if (t.kind !== "walk" || t.from.facing !== t.to.facing) continue;
    const dx = t.to.x - t.from.x;
    const dz = t.to.z - t.from.z;
    if (dx === 0 && dz === 0) continue;
    const had = out.get(t.from.facing);
    // a facing that walks two different ways is not a facing; say so loudly
    if (had && (had.dx !== dx || had.dz !== dz)) {
      throw new Error(`${set.setName}: facing ${t.from.facing} walks both (${had.dx},${had.dz}) and (${dx},${dz})`);
    }
    if (!had) out.set(t.from.facing, { dx, dz });
  }
  return out;
}

/**
 * The compass, merged over several sets.
 *
 * A facing number is the ENGINE's, not the set's: `4` means west in every
 * DreamFactory 1 set that has anything to say about it. But a small interior may
 * have nothing to say — `MAYHALL` is four cells with one authored walk, so it
 * defines exactly one facing, and asking it which way is west is asking the
 * wrong file. Merging a set that walks all four ways (the town does) with the
 * one being navigated gives the mapping without assuming the numbering, and any
 * set that CONTRADICTS the merge throws rather than being quietly overruled.
 */
export function mergeCompass(sets: SetFileV1[]): Map<number, { dx: number; dz: number }> {
  const all = new Map<number, { dx: number; dz: number }>();
  for (const set of sets) {
    for (const [facing, d] of compass(set)) {
      const had = all.get(facing);
      if (had && (had.dx !== d.dx || had.dz !== d.dz)) {
        throw new Error(
          `${set.setName}: facing ${facing} walks (${d.dx},${d.dz}) where another set walks (${had.dx},${had.dz})`,
        );
      }
      if (!had) all.set(facing, d);
    }
  }
  return all;
}

/** the facing number for a compass name, against a (merged) compass */
export function facingFor(dirs: Map<number, { dx: number; dz: number }>, view: string): number | null {
  const want: Record<string, { dx: number; dz: number }> = {
    north: { dx: 0, dz: -1 }, south: { dx: 0, dz: 1 }, east: { dx: 1, dz: 0 }, west: { dx: -1, dz: 0 },
  };
  const d = want[view.toLowerCase()];
  if (!d) return null;
  for (const [facing, walk] of dirs) if (walk.dx === d.dx && walk.dz === d.dz) return facing;
  return null;
}

/**
 * The clockwise successor of each facing — north → east → south → west.
 *
 * Built from {@link compass}, so "clockwise" means the direction the set's own
 * walks point rather than a number order. Facings the set never walks from are
 * left out, and a turn onto one of them is planned as a left turn only when the
 * right-hand ring cannot explain it.
 */
export function rightRing(set: SetFileV1): Map<number, number> {
  const dirs = compass(set);
  const bearing = (d: { dx: number; dz: number }): number =>
    d.dz < 0 ? 0 : d.dx > 0 ? 1 : d.dz > 0 ? 2 : 3; // N, E, S, W
  const byBearing = new Map<number, number>();
  for (const [facing, d] of dirs) byBearing.set(bearing(d), facing);
  const ring = new Map<number, number>();
  for (const [b, facing] of byBearing) {
    const next = byBearing.get((b + 1) % 4);
    if (next !== undefined) ring.set(facing, next);
  }
  return ring;
}

interface Edge {
  key: NavKey;
  to: Stand;
}

/** every move leaving a standpoint, as a key press and where it lands */
function edgesFrom(set: SetFileV1, ring: Map<number, number>): Map<string, Edge[]> {
  const byFrom = new Map<string, Edge[]>();
  const push = (s: Stand, e: Edge): void => {
    const k = key(s);
    const list = byFrom.get(k);
    if (list) list.push(e);
    else byFrom.set(k, [e]);
  };
  for (const t of set.transitions as V1Transition[]) {
    const from = { x: t.from.x, z: t.from.z, facing: t.from.facing };
    const to = { x: t.to.x, z: t.to.z, facing: t.to.facing };
    if (t.kind === "walk") {
      push(from, { key: "uparrow", to });
      continue;
    }
    // a turn: right if it lands on the clockwise successor, else left
    push(from, { key: ring.get(from.facing) === to.facing ? "rightarrow" : "leftarrow", to });
  }
  return byFrom;
}

const key = (s: Stand): string => `${s.x},${s.z},${s.facing}`;

export interface Route {
  keys: NavKey[];
  /** the standpoint each press lands on, same length as `keys` */
  path: Stand[];
}

/**
 * The shortest sequence of presses from `from` to `goal`.
 *
 * `goal.facing` is optional: leave it out to arrive at a cell facing whatever
 * gets you there soonest, which is what a route wants when the next thing it
 * does is turn to look at something anyway. Returns null when no sequence of
 * authored moves connects the two — which is a real answer about the set, not a
 * failure of the search.
 */
export function planRoute(
  set: SetFileV1,
  from: Stand,
  goal: { x: number; z: number; facing?: number },
  limit = 4096,
): Route | null {
  const ring = rightRing(set);
  const edges = edgesFrom(set, ring);
  const arrived = (s: Stand): boolean =>
    s.x === goal.x && s.z === goal.z && (goal.facing === undefined || s.facing === goal.facing);
  if (arrived(from)) return { keys: [], path: [] };

  const seen = new Set<string>([key(from)]);
  const queue: { at: Stand; keys: NavKey[]; path: Stand[] }[] = [{ at: from, keys: [], path: [] }];
  let visited = 0;
  while (queue.length) {
    const node = queue.shift()!;
    if (++visited > limit) break;
    for (const e of edges.get(key(node.at)) ?? []) {
      const k = key(e.to);
      if (seen.has(k)) continue;
      seen.add(k);
      const next = { at: e.to, keys: [...node.keys, e.key], path: [...node.path, e.to] };
      if (arrived(e.to)) return { keys: next.keys, path: next.path };
      queue.push(next);
    }
  }
  return null;
}

/** the scene name a cell carries, for saying where a route goes */
export const sceneAt = (set: SetFileV1, x: number, z: number): string =>
  set.scenes.find((s) => s.x === x && s.z === z)?.name ?? `(${x},${z})`;
