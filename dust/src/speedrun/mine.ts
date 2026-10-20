/**
 * The mine under the north arm: bring the skeleton home, and give it the Mask.
 *
 * MINE.SET is a small cross of tunnels that wraps: walking off the end of an
 * arm is `changeall (±4, 0)` or `(0, ±4)` (MINE.CST), which moves everything in
 * the mine — the skeleton's `standx`/`standy` among it — by a whole arm. With
 * the Mask in hand when the mine opens, `initxyz ()` throws the skeleton
 * somewhere off in the maze rather than letting it wander; the puzzle is to
 * wrap the arms until it stands at the centre, 640,640, and then stand with it
 * and hand the Mask over (`MINE.CST/0002 offerobject`: `minepuzzle = "done"`,
 * skeleton.mov, and back to the hub).
 *
 * Which arm to take is read off where the skeleton is — the playthrough's way
 * (`rungs/mesapzl.ts`) — and a wrap is taken only once the skeleton's turn has
 * landed: a turn's record puts its actor back on the spot the turn began from
 * on the pass it lands, so a wrap taken mid-turn is undone for the skeleton
 * though its globals keep it.
 */
import type { Action, ActionContext } from "@dreamfactory/speedrun/action";
import { CORE_ACTIONS } from "@dreamfactory/speedrun/actions-core";

const G = (name: string): string => `Number(window.dbg.session.interp.globals.get(${JSON.stringify(name)}))`;
const B = (fn: string, args: string): string =>
  `(() => { const i = window.dbg.session.interp; return i.builtins.get(${JSON.stringify(fn)})(i, [${args}]); })()`;
const HOME = `${G("standx")} === 640 && ${G("standy")} === 640`;
/** the arm to take, by where the skeleton is */
const ENDS: Record<string, { x: number; z: number; view: string }> = {
  xup: { x: 0, z: 2, view: "west" }, // scene a3 west: changeall (0, 4)
  xdown: { x: 4, z: 2, view: "east" }, // scene e3 east: changeall (0, -4)
  yup: { x: 2, z: 0, view: "north" }, // scene c1 north: changeall (4, 0)
  ydown: { x: 2, z: 4, view: "south" }, // scene c5 south: changeall (-4, 0)
};

export function mineMaze(goto: Action): Action {
  const walk = (c: ActionContext, to: { x: number; z: number; view: string }): Promise<void> =>
    goto.run({ ...c, step: { ...c.step, verb: "goto", args: [String(to.x), String(to.z), to.view], opts: { set: "mine" } } });

  return {
    args: [0, 0],
    once: true,
    wait: "none",
    sig: "mineMaze()",
    help: "in the mine with the Mask in hand: wrap the arms until the skeleton is at the centre, and give it the Mask",
    run: async (c) => {
      const { d } = c;
      await d.hold(`window.dbg.session.interp.globals.get("standx") !== undefined && !window.dbg.session.scriptBusy`, "the skeleton to be thrown", Math.max(c.budget, 60_000));
      let wraps = 0;
      for (; wraps < 40 && !(await d.evaluate<boolean>(HOME)); wraps++) {
        const [x, y] = await Promise.all([d.evaluate<number>(G("standx")), d.evaluate<number>(G("standy"))]);
        let which = x > 640 ? "xdown" : "xup";
        if (y > 640) which = "ydown";
        else if (y < 640) which = "yup";
        await walk(c, ENDS[which]);
        await d.hold(`Number(${B("iswalk", '"skeleton"')}) === 0`, "the skeleton's turn to land", c.budget);
        await CORE_ACTIONS.up.run({ ...c, step: { ...c.step, args: [] }, wait: "none" });
        await d.settle("quiet", "the wrap", c.budget);
      }
      if (!(await d.evaluate<boolean>(HOME))) throw new Error(`the skeleton never came home`);
      const [x, y] = await Promise.all([d.evaluate<number>(G("standx")), d.evaluate<number>(G("standy"))]);
      const cell = { x: (x - 128) / 256, z: (y - 128) / 256 };
      /*
       * Within reach (`actordist <= 320`) AND on the screen to be dropped on:
       * standing on its own cell is distance 0 and no sprite at all, so stand
       * one cell off and face it — 256 away.
       */
      const NEAR = `Number(${B("actordist", '"skeleton"')}) <= 320`;
      const SEEN = `(() => { const s = window.dbg.session;
        for (let y = 0; y < 264; y += 6) for (let x = 0; x < 512; x += 6) {
          const h = s.hitTestAt(x, y); if (h && h.type === "actor" && /^skeleton$/i.test(h.name)) return true; }
        return false; })()`;
      const spots = [
        { x: cell.x, z: cell.z + 1, view: "north" },
        { x: cell.x, z: cell.z - 1, view: "south" },
        { x: cell.x - 1, z: cell.z, view: "east" },
        { x: cell.x + 1, z: cell.z, view: "west" },
      ];
      let ready = false;
      for (const spot of spots) {
        try {
          await walk(c, spot);
        } catch {
          continue; // not a tunnel
        }
        if ((await d.evaluate<boolean>(NEAR)) && (await d.evaluate<boolean>(SEEN))) {
          ready = true;
          break;
        }
      }
      if (!ready) throw new Error(`the skeleton is not in reach and in sight from any side`);
      // the Mask onto it: GIVE is the drag, and it is the next line's
      c.say(`home in ${wraps} wrap${wraps === 1 ? "" : "s"}`);
    },
  };
}
