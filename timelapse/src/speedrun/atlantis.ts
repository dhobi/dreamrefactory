/**
 * Atlantis's verbs (world Z, disc four): the machine suites' route
 * (tests/machine/worlds/atlantis.ts) to the end of the game, played through
 * the speedrun driver, the solving shared with it (src/atlantis.ts).
 */
import type { ActionTable } from "@dreamfactory/speedrun/action";
import { STASIS, ballAt, wheelPresses } from "../atlantis";
import { UNLOCKED, clickThen, g, global, hover, need, num, propIn, regionWhen, settle, type Point } from "./gestures";

export const ATLANTIS_ACTIONS: ActionTable = {
  /**
   * The elevator's panel (z007, frame 744): four symbol buttons, each a touch a
   * picture on (`gElevEntButton1`…`4`), set to the four buildings' symbols.
   */
  panel: {
    args: [4, 4],
    wait: "quiet",
    sig: "panel(17, 6, 28, 11)",
    help: "step the elevator panel's four symbol buttons to these pictures",
    run: async (c) => {
      for (let b = 1; b <= 4; b++) {
        const want = num(c, b - 1, `button ${b}`);
        let i = 0;
        while (Number(await g(c, `gElevEntButton${b}`)) !== want) {
          if (i >= 40) throw new Error(`button ${b} never came to ${want}`);
          await clickThen(c, await propIn(c, `Button${b}`), `button ${b}`, "quiet");
          i++;
        }
      }
    },
  },

  /** the stasis tube's 36 lights (z010, frame 419) set to the corridor's pattern, a touch each */
  stasis: {
    args: [0, 0],
    wait: "quiet",
    sig: "stasis()",
    help: "set the stasis tube's lights to the pattern the corridor's tubes show",
    run: async (c) => {
      for (let i = 0; i < 36; i++) {
        if ((await g(c, "gStasisState")).split(" ")[i] === STASIS[i]) continue;
        const on = await c.d.evaluate<boolean>(`!!window.dbg.session.propRuntime.get("StasisOn ${i}")?.visible`);
        await clickThen(c, await propIn(c, on ? `StasisOn ${i}` : `StasisOf ${i}`), `light ${i}`, "quiet");
      }
      await need(c, "gStasisSolved", "1", "the stasis lights");
    },
  },

  /**
   * The six wheels of red and green (z010, frame 363): the fewest presses of
   * the yellow triangles that turn them home from where they stand (src/
   * atlantis.ts `wheelPresses`).
   */
  rgb: {
    args: [0, 0],
    wait: "quiet",
    sig: "rgb()",
    help: "turn the six red and green wheels home with the yellow triangles",
    run: async (c) => {
      const now: number[] = [];
      for (let i = 1; i <= 6; i++) now.push(Number(await g(c, `gWheel${i}`)));
      const presses = wheelPresses(now, [0, 1, 2, 3, 4, 5]);
      for (const p of presses) await clickThen(c, await regionWhen(c, p), `the triangle ${p}`, "quiet");
      c.say(`${presses.length} press(es)`);
    },
  },

  /**
   * The robot (z020, frame 196): shot in the chest each time it stands, which
   * drives it back a place, and at the back of the room a shot at the dark
   * target in the ceiling closes the tube on it. Each ball's flight worked out
   * first (src/atlantis.ts `ballAt`): the hand moved there, and pressed.
   */
  robot: {
    args: [0, 0],
    wait: "quiet",
    sig: "robot()",
    help: "shoot the robot back to the tube, and the tube's trigger shut on it",
    run: async (c) => {
      await c.d.hold(`Number(${global("curstagenum")}) === 20 && ${global("gBaSolved")} === "2"`, "the robot to come for the crystal", 120_000);
      const trap = await c.d.evaluate<{ left: number; top: number; right: number; bottom: number }>(
        `window.dbg.session.stageCtrl.flatRegion("Z0001.196", "StasisActivate")`,
      );
      const ball = `!!window.dbg.session.propRuntime.get("EnergyBall")?.visible`;
      let shots = 0;
      while ((await g(c, "gBaSolved")) !== "1") {
        if (shots > 40) throw new Error(`forty shots and the robot is not in the tube (state ${await g(c, "baState")})`);
        if ((await g(c, "gGameEnding")) === "9") throw new Error("the robot got you");
        await c.d.hold(`["0", "1", "2"].includes(${global("baState")}) && !${ball} && ${UNLOCKED}`, "the robot to stand", 150_000);
        const state = Number(await g(c, "baState"));
        const robot = ["BaAway", "BaMid", "BaClose"][state];
        const chest = [210, 240, 248][state];
        // every aim's landing, asked of the robot's picture in one go
        const cands: { m: Point; b: Point }[] = [];
        for (let my = 144; my <= 300; my += 2)
          for (let mx = 220; mx <= 420; mx += 2) {
            const [bx, by] = ballAt(mx, my);
            const inTrap = bx >= trap.left && bx <= trap.right && by >= trap.top && by <= trap.bottom;
            if (state === 0 ? inTrap : by >= chest + 4) cands.push({ m: { x: mx, y: my }, b: { x: bx, y: by } });
          }
        const hits = await c.d.evaluate<boolean[]>(
          `((rt, p) => ${JSON.stringify(cands.map((k) => [k.b.x, k.b.y]))}.map(([x, y]) => !!p && !!p.visible && rt.covers(p, x, y, null)))(window.dbg.session.propRuntime, window.dbg.session.propRuntime.get(${JSON.stringify(robot)}))`,
        );
        const pick = cands.find((_, i) => (state === 0 ? !hits[i] : hits[i]));
        if (!pick) throw new Error(`no shot at the robot in state ${state}`);
        await hover(c, pick.m);
        await c.d.sleep(100);
        await c.d.clickAt(pick.m.x, pick.m.y, "none", c.budget);
        await c.d.tryHold(ball, 3000);
        await c.d.hold(`!${ball}`, "the ball to land", c.budget);
        shots++;
      }
      await c.d.hold(
        `String(window.dbg.session.currentFlat || "").toLowerCase() === "z0001.196.1" && ${global("lockevents")} !== "true"`,
        "the tube to close",
        c.budget,
      );
      await settle(c, "the robot in the tube");
      c.say(`${shots} shot(s)`);
    },
  },

};
