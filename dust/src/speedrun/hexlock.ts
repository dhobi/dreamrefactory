/**
 * The snake room's hex lock, solved.
 *
 * `SNAKE.SET/0040 dohexpuz ()` opens SNAKE.FLT over SNAKE.PRP — the shop that
 * calls itself "puzzle" — and `mangle ()` scrambles seven rings, `stop1` to
 * `stop7`, each sitting on one of six notches (`propdeg` in steps of 6).
 * Turning a ring is a drag (`SNAKE.PRP/0001 mousedown`, a `while stilldown ()`
 * poll) that `limiter ()` clamps to one notch either way, and `spinall ()` turns
 * every OTHER ring by an amount set by how far apart they are
 * (`calcdist (propxy (name, 3), propxy (target, 3))`: one notch for a
 * neighbour, two round the hexagon, three opposite). Every move adds the same
 * vector each time and they commute, so the lock is seven unknowns in Z6 — few
 * enough to try all 6^7 — and the scramble was built from the same moves, so a
 * solution always exists. `solved ()` wants every ring on 0; `quit` (the
 * flat's one region) is where it is asked.
 *
 * The coupling is read from the engine (`calcdist` on the rings' own points),
 * and where to carry the pointer for one notch is found with the engine's
 * `calcdeg` — the playthrough's way (`rungs/mskpzl.ts`) — so the solution and
 * the lock agree on the arithmetic whatever it is.
 */
import type { Action, ActionContext } from "@dreamfactory/speedrun/action";

const STOPS = ["stop1", "stop2", "stop3", "stop4", "stop5", "stop6", "stop7"];
const QUIT = { x: 413, y: 202 };

const B = (fn: string, args: string): string =>
  `(() => { const i = window.dbg.session.interp; return i.builtins.get(${JSON.stringify(fn)})(i, [${args}]); })()`;
const DEG = (name: string): string => `Number(${B("propdeg", JSON.stringify(name))})`;
const notchOf = (n: string): string => `Math.round(${DEG(n)} / 6) % 6`;
const NOTCHES = "[" + STOPS.map(notchOf).join(", ") + "]";

/** how far each ring turns when another one is dragged — `spinall ()`'s own question */
const COUPLING = `(() => {
  const i = window.dbg.session.interp, b = (n, a) => i.builtins.get(n)(i, a);
  const names = ${JSON.stringify(STOPS)};
  const at = (n) => Number(b("propxy", [n, 3]));
  return names.map((target) => names.map((name) => {
    if (name === target) return 1;
    const d = Number(b("calcdist", [at(name), at(target)]));
    if (d > 50 && d < 100) return 1;
    if (d > 100 && d < 150) return 2;
    if (d > 150) return 3;
    return 0;
  }));
})()`;

/** where to press a ring, and where to carry the pointer for one notch clockwise */
const NOTCH_GESTURE = (name: string): string => `(() => {
  const i = window.dbg.session.interp, b = (n, a) => i.builtins.get(n)(i, a);
  const centre = Number(b("propxy", [${JSON.stringify(name)}, 3]));
  const valueAt = (x, y) => {
    let d = Number(b("calcdeg", [centre, Number(b("makepoint", [x, y]))])) + 64;
    while (d < 0) d += 256;
    while (d > 255) d -= 256;
    return Math.trunc((d * 36) / 256);
  };
  const grip = { x: Number(b("propxy", [${JSON.stringify(name)}, 1])), y: Number(b("propxy", [${JSON.stringify(name)}, 2])) };
  const orig = valueAt(grip.x, grip.y);
  let best = null;
  for (let y = 0; y < 384; y += 4) for (let x = 0; x < 512; x += 4) {
    const delta = (valueAt(x, y) - orig + 36) % 36;
    if (delta < 6 || delta > 17) continue;
    const miss = Math.abs(delta - 11);
    if (!best || miss < best.miss) best = { x, y, miss };
  }
  return best ? { grip, to: { x: best.x, y: best.y } } : null;
})()`;

/** turns per ring that bring every one to 0, by trying them all */
function solve(state: number[], coupling: number[][]): number[] | null {
  const turns = STOPS.map(() => 0);
  const rec = (i: number): number[] | null => {
    if (i === turns.length) {
      for (let q = 0; q < STOPS.length; q++) {
        let sum = state[q];
        for (let t = 0; t < STOPS.length; t++) sum += turns[t] * coupling[t][q];
        if (sum % 6 !== 0) return null;
      }
      return [...turns];
    }
    for (let k = 0; k < 6; k++) {
      turns[i] = k;
      const found = rec(i + 1);
      if (found) return found;
    }
    turns[i] = 0;
    return null;
  };
  return rec(0);
}

async function notch(c: ActionContext, name: string): Promise<void> {
  const { d } = c;
  const start = await d.evaluate<number>(DEG(name));
  const want = (start + 6) % 36;
  const g = await d.evaluate<{ grip: { x: number; y: number }; to: { x: number; y: number } } | null>(NOTCH_GESTURE(name));
  if (!g) throw new Error(`no point on screen turns ${name} a notch`);
  let carried = false;
  await d.dragProp(
    g.grip,
    async () => {
      if (carried && (await d.evaluate<number>(DEG(name))) === want) return null;
      if (carried) return g.to; // hold it there until the ring has followed
      carried = true;
      return g.to;
    },
    c.budget,
  );
  const got = await d.evaluate<number>(DEG(name));
  if (got !== want) throw new Error(`${name} went to ${got}, not ${want}`);
}

export const HEX_LOCK: Action = {
  args: [0, 0],
  once: true,
  wait: "quiet",
  sig: "hexLock()",
  help: "with the snake room's hex lock open, turn its seven rings to 0 and quit — which is where it is judged",
  run: async (c) => {
    const { d } = c;
    // the lock's own stage up and its script idle — not every ring visible:
    // a scramble can leave one where its art is not drawn
    const drawn = STOPS.map((n) => "!!window.dbg.session.propRuntime.get(" + JSON.stringify(n) + ")").join(" && ");
    // and the film's last frame let go of: the screen is HELD after hexopen.mov
    // until the script falls quiet on a frame (Fade.idle), and a drag on the
    // frame it finishes keeps it busy — every turn then happens behind the film
    const ready = `/snake/i.test(String(window.dbg.session.stageName || "")) && ${drawn} && !window.dbg.session.scriptBusy && !window.dbg.session.fade.pendingReveal`;
    // `mangle ()` spins the rings a random while, and the film before it plays first
    await d.hold(ready, "the hex lock", Math.max(c.budget, 120_000));
    const coupling = await d.evaluate<number[][]>(COUPLING);
    let moves = 0;
    for (let go = 0; go < 4; go++) {
      const state = await d.evaluate<number[]>(NOTCHES);
      if (state.every((n) => n === 0)) break;
      const turns = solve(state, coupling);
      if (!turns) throw new Error(`no solution for ${state.join(",")}`);
      for (const [i, k] of turns.entries()) {
        for (let n = 0; n < k; n++) {
          await notch(c, STOPS[i]);
          moves++;
        }
      }
    }
    const left = await d.evaluate<number[]>(NOTCHES);
    if (!left.every((n) => n === 0)) throw new Error(`the hex lock reads ${left.join(",")}, not all zero`);
    await d.clickAt(QUIT.x, QUIT.y, "none", c.budget);
    c.say(`${moves} notch${moves === 1 ? "" : "es"}`);
  },
};
