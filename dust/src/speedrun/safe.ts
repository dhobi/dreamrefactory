/**
 * The bank's safe on day 3's night: three numbers on the dial, and the handle.
 *
 * CRACK.FLT is the safe door, and `CRACK.PRP`'s `spin` is its dial: a prop you
 * press and swing round its centre, fifty numbers to the turn
 * (`fixdeg256 ()`), each let-go writing the number it stopped on into `combo`
 * (`CRACK.FLT newposition`). The turns alternate — right, left, right, by
 * `turnright` — and `limiter ()` refuses to move the dial the other way, so a
 * swing in the wrong direction simply does nothing. `tryopen ()` (the handle)
 * opens it only for "08,23,41,", which is written in the script rather than
 * dealt, and the yunni stone comes out of the box only if `safebox.mov` reaches
 * its action frame — so nothing after the handle is skipped.
 *
 * The swing is `dragProp`: the pointer stepped round the dial a few degrees at
 * a time, each step held for one turn of the dial's own `while stilldown ()`,
 * and let go when the dial reads the number. Which way round is "right" is not
 * assumed: the first steps are tried one way, and if the dial has not moved
 * they go the other.
 */
import type { Action, ActionContext } from "@dreamfactory/speedrun/action";

const DIAL = "spin";
/** the dial's own number, 0..49 */
const DEG = `(() => { const i = window.dbg.session.interp; return Number(i.builtins.get("propdeg")(i, [${JSON.stringify(DIAL)}])); })()`;
const CENTRE = `(() => { const i = window.dbg.session.interp, f = i.builtins.get("propxy");
  return { x: Number(f(i, [${JSON.stringify(DIAL)}, 1])), y: Number(f(i, [${JSON.stringify(DIAL)}, 2])) }; })()`;
/** the handle (CRACK.FLT tryopen) */
const HANDLE = { x: 385, y: 176 };
const RADIUS = 70;
/** pointer step round the dial, in radians — about half a number */
const STEP = (Math.PI * 2) / 100;

async function turnTo(c: ActionContext, want: number): Promise<void> {
  const { d } = c;
  const centre = await d.evaluate<{ x: number; y: number }>(CENTRE);
  let angle = -Math.PI / 2; // start the grip at the top of the dial
  const at = (a: number) => ({
    x: Math.round(centre.x + RADIUS * Math.cos(a)),
    y: Math.round(centre.y + RADIUS * Math.sin(a)),
  });
  const start = await d.evaluate<number>(DEG);
  let dir = 1;
  let steps = 0;
  let moved = false;
  await d.dragProp(
    at(angle),
    async () => {
      const deg = await d.evaluate<number>(DEG);
      if (deg === want && moved) return null;
      if (deg !== start) moved = true;
      steps++;
      // nothing after a quarter turn: this is the way the dial will not go
      if (!moved && steps === 25) dir = -dir;
      if (steps > 400) return null;
      angle += dir * STEP;
      return at(angle);
    },
    c.budget,
  );
  const got = await d.evaluate<number>(DEG);
  if (got !== want) throw new Error(`the dial stopped on ${got}, not ${want}`);
}

export const SAFE: Action = {
  args: [3, 3],
  once: true,
  wait: "none",
  sig: "safe(8, 23, 41)",
  help: "open the bank safe (CRACK.FLT is up): turn the dial to the three numbers and pull the handle",
  run: async (c) => {
    const { d } = c;
    const nums = c.step.args.map(Number);
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 49)) {
      throw new Error(`safe takes three dial numbers 0..49 — safe(8, 23, 41)`);
    }
    await d.hold(`!!window.dbg.session.propRuntime.get(${JSON.stringify(DIAL)}) && !window.dbg.session.scriptBusy`, "the safe's dial", Math.max(c.budget, 60_000));
    for (const n of nums) await turnTo(c, n);
    await d.clickAt(HANDLE.x, HANDLE.y, "none", c.budget);
    const combo = await d.evaluate<string>(`String(window.dbg.session.interp.globals.get("combo") ?? "")`);
    c.say(`combo ${combo}`);
  },
};
