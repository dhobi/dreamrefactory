/**
 * The thunderbird temple's five tumblers, to a combination.
 *
 * TUMBLE.FLT's `tumble2` is five rings, `tumbler1` to `tumbler5`, each turned
 * four notches of twenty-four by a click on it — above its middle (y < 100)
 * one way, below it the other (TUMBLE.PRP). `nametodeg ()` wants
 * 8 / 8 / 4 / 20 / 12, and `quit` is where `gototbird ()` asks. Where a ring
 * can be clicked above and below is asked of the engine (which prop is under a
 * point), and each click waits for the ring to have moved before the next.
 */
import type { Action } from "@dreamfactory/speedrun/action";

const DEG = (name: string): string =>
  `(() => { const i = window.dbg.session.interp; return Number(i.builtins.get("propdeg")(i, [${JSON.stringify(name)}])); })()`;
const GRIP = (name: string): string => `(() => {
  const i = window.dbg.session.interp, v = window.dbg.viewer;
  const x = Number(i.builtins.get("propxy")(i, [${JSON.stringify(name)}, 1]));
  const ys = [];
  for (let y = 0; y < 384; y++) {
    const u = v.propUnder(x, y);
    if (u && String(u.name || u.group.name).toLowerCase() === ${JSON.stringify(name)}) ys.push(y);
  }
  const up = ys.find((y) => y < 100), down = [...ys].reverse().find((y) => y >= 100);
  return up === undefined || down === undefined ? null : { x, up, down };
})()`;

export const TUMBLERS: Action = {
  args: [5, 5],
  once: true,
  wait: "quiet",
  sig: "tumblers(8, 8, 4, 20, 12)",
  help: "with the temple's tumblers up, turn the five to those notches (0..23, four to a click)",
  run: async (c) => {
    const { d } = c;
    const want = c.step.args.map(Number);
    for (const [k, target] of want.entries()) {
      const name = `tumbler${k + 1}`;
      const g = await d.evaluate<{ x: number; up: number; down: number } | null>(GRIP(name));
      if (!g) throw new Error(`${name} has no click both above and below its middle`);
      for (let click = 0; click < 6; click++) {
        const was = await d.evaluate<number>(DEG(name));
        if (was === target) break;
        const forward = (((target - was) % 24) + 24) % 24 <= 12;
        const then = (((forward ? was + 4 : was - 4) % 24) + 24) % 24;
        await d.clickAt(g.x, forward ? g.down : g.up, "none", c.budget);
        await d.hold(`${DEG(name)} === ${then} && !window.dbg.session.scriptBusy`, `${name} to turn to ${then}`, c.budget);
      }
      const got = await d.evaluate<number>(DEG(name));
      if (got !== target) throw new Error(`${name} stopped on ${got}, not ${target}`);
    }
  },
};
