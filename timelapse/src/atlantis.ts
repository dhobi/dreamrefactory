/**
 * Atlantis's puzzles, solved — the pure half: the stasis tube's pattern, the
 * six wheels' triangles and the search over them, and the robot gun's ball
 * flight. Shared by the machine suites' route (tests/machine/worlds/
 * atlantis.ts), which says where each came from, and the speedrun's verbs
 * (src/speedrun/atlantis.ts).
 */

/** the stasis tube's 36 lights, as the tubes along the corridor show them (z010 `gStasisState`) */
export const STASIS = "0 1 1 0 0 1 1 0 1 0 1 0 1 0 1 0 0 1 0 0 0 1 1 1 1 1 1 0 0 0 0 0 0 0 1 1".split(" ");

export const TRIANGLES: [region: string, wheels: [number, number, number], dirs: [number, number, number]][] = [
  ["Button2", [1, 2, 3], [1, 1, -1]], ["Button3", [2, 3, 4], [-1, -1, 1]], ["Button4", [3, 4, 5], [-1, 1, 1]],
  ["Button5", [4, 5, 6], [-1, 1, -1]], ["Button1", [1, 2, 6], [1, 1, -1]], ["Button6", [1, 5, 6], [1, -1, 1]],
];

export function wheelPresses(from: number[], to: number[]): string[] {
  const key = (w: number[]): string => w.join("");
  const prev = new Map<string, { k: string; press: string } | null>([[key(from), null]]);
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const w = queue[q];
    if (key(w) === key(to)) {
      const out: string[] = [];
      for (let p = prev.get(key(w)); p; p = prev.get(p.k)) out.unshift(p.press);
      return out;
    }
    for (const [region, wheels, dirs] of TRIANGLES) {
      const n = [...w];
      wheels.forEach((wh, i) => (n[wh - 1] = (((n[wh - 1] + 2 * dirs[i]) % 6) + 6) % 6));
      if (prev.has(key(n))) continue;
      prev.set(key(n), { k: key(w), press: region });
      queue.push(n);
    }
  }
  throw new Error("no presses turn the wheels home");
}

export function ballAt(mx: number, my: number): [number, number] {
  const gun = Math.max(0, Math.min(6, Math.trunc(((mx - 220) * 7) / 201)));
  const cx = Math.max(220, Math.min(420, mx)), cy = Math.max(144, Math.min(300, my));
  const dx = Math.trunc((cx - 320) / 16), dy = -Math.trunc((330 - cy) / 10);
  // `RunFire` moves it while its picture is below 10 and looks on the 9th:
  // ten steps
  return [320 + (gun - 3) * 14 + 10 * dx, 328 + 10 * dy];
}

