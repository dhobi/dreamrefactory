/**
 * The sundial under the mission: three rings to a combination, and out.
 *
 * `HUB.SET` looks at the sundial from four cells, and a click on it
 * (`pointinsundial`) opens SUNDIAL.FLT over SUNDIAL.PRP. Its three rings —
 * `largedial`, `meddial`, `smalldial`, sixteen values each — are turned by
 * dragging: `SUNDIAL.PRP/0001 mousedown` polls `while stilldown ()`, turns the
 * ring under the press one step per pass towards the pointer's angle, and on
 * release writes all three back to the globals. `exitsundial ()` (the flat's
 * one region, `exit`) reads the combination and names the room the hub's dark
 * edges lead to (0/0/8 the flute, and so on).
 *
 * The angle is the engine's: `fixdeg256 (calcdeg (propxy (target, 3), arg) +
 * 64)` folded to sixteen. What centre that is measured from is left to the
 * engine too — the screen is mapped value by value with its own `calcdeg`, the
 * playthrough's way (`rungs/flutepzl.ts`), which found that one stroke cannot
 * cross more of the ring than the screen holds, so a far value takes more than
 * one press. The press point is one the engine says is the ring being turned,
 * because the shop main's `target` is whatever ring was hit.
 */
import type { Action, ActionContext } from "@dreamfactory/speedrun/action";

const RINGS = ["largedial", "meddial", "smalldial"] as const;
const EXIT = { x: 92, y: 323 };
/** the sundial is up: its rings are drawn */
const OPEN = `(() => { const i = window.dbg.session.interp; return Number(i.builtins.get("propvisible")(i, ["smalldial"])) === 1; })()`;

const DEG = (name: string): string =>
  `(() => { const i = window.dbg.session.interp; return Number(i.builtins.get("propdeg")(i, [${JSON.stringify(name)}])); })()`;

/** every value the screen can point at, with a point for it, and where each ring can be gripped */
const MAP = `(() => {
  const i = window.dbg.session.interp, b = (n, a) => i.builtins.get(n)(i, a), v = window.dbg.viewer;
  const centre = Number(b("propxy", ["smalldial", 3]));
  const valueAt = (x, y) => {
    let d = Number(b("calcdeg", [centre, Number(b("makepoint", [x, y]))])) + 64;
    while (d < 0) d += 256;
    while (d > 255) d -= 256;
    return Math.trunc((d * 16) / 256);
  };
  const ring = {}, grip = { largedial: {}, meddial: {}, smalldial: {} };
  for (let y = 0; y < 384; y += 2) for (let x = 0; x < 512; x += 2) {
    const val = valueAt(x, y);
    if (!(val in ring)) ring[val] = { x, y };
    const under = v.propUnder(x, y);
    const name = under ? String(under.name || under.group.name).toLowerCase() : "";
    if (name in grip && !(val in grip[name])) grip[name][val] = { x, y };
  }
  return { ring, grip };
})()`;

type Pt = { x: number; y: number };
type Map16 = { ring: Record<string, Pt>; grip: Record<string, Record<string, Pt>> };

async function turnTo(c: ActionContext, map: Map16, name: string, target: number): Promise<void> {
  const { d } = c;
  const values = Object.keys(map.ring).map(Number).sort((a, b) => a - b);
  const grips = Object.keys(map.grip[name] ?? {}).map(Number).sort((a, b) => a - b);
  if (!grips.length) throw new Error(`no point on screen is the ${name}`);
  const lo = values[0];
  const hi = values[values.length - 1];
  for (let stroke = 0; stroke < 12; stroke++) {
    const now = await d.evaluate<number>(DEG(name));
    if (now === target) return;
    // the shorter way round, and which end of the screen's arc to grip from
    const up = (target - now + 16) % 16 <= 8;
    const start = up ? grips[0] : grips[grips.length - 1];
    const from = map.grip[name][start];
    let v = start;
    await d.dragProp(
      from,
      async () => {
        if ((await d.evaluate<number>(DEG(name))) === target) return null;
        for (;;) {
          v += up ? 1 : -1;
          if (up ? v > hi : v < lo) return null; // the end of what one stroke can reach
          const at = map.ring[String(v)];
          if (at) return at;
        }
      },
      c.budget,
    );
  }
  const got = await d.evaluate<number>(DEG(name));
  if (got !== target) throw new Error(`${name} stopped on ${got}, not ${target}`);
}

export const SUNDIAL: Action = {
  args: [3, 3],
  once: true,
  wait: "quiet",
  sig: "sundial(0, 0, 8)",
  help: "with the sundial open, set its large, medium and small rings and step out — sundial(0, 0, 8) is the flute room",
  run: async (c) => {
    const { d } = c;
    const want = c.step.args.map(Number);
    if (want.some((n) => !Number.isInteger(n) || n < 0 || n > 15)) {
      throw new Error(`sundial takes three ring values 0..15 — sundial(0, 0, 8)`);
    }
    await d.hold(`${OPEN} && !window.dbg.session.scriptBusy`, "the sundial", Math.max(c.budget, 60_000));
    const map = await d.evaluate<Map16>(MAP);
    for (const [k, name] of RINGS.entries()) await turnTo(c, map, name, want[k]);
    await d.clickAt(EXIT.x, EXIT.y, "none", c.budget);
    const read = await Promise.all(RINGS.map((n) => d.evaluate<number>(DEG(n))));
    c.say(`set to ${read.join("/")}`);
  },
};
