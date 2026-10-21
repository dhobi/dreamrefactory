/**
 * Egypt's verbs (world E, disc one): the machine suites' route
 * (tests/machine/worlds/egypt.ts) a puzzle at a time, each one gesture-long
 * procedure a verb, driven through the speedrun driver.
 */
import type { ActionTable } from "@dreamfactory/speedrun/action";
import {
  DEG, UNLOCKED, carry, tap, clickThen, extent, g, gNum, global, middle, need, num, propIn, settle,
} from "./gestures";

export const EGYPT_ACTIONS: ActionTable = {
  /**
   * The hanging basket over the cistern (stage 25, frame 111): it dips once a
   * pull (e.shp `e27.111b`, taken below y 290 while it swings) and pours into
   * the cistern (`waterlevel`). `n` pulls, each waited out.
   */
  basket: {
    args: [1, 1],
    wait: "quiet",
    sig: "basket(4)",
    help: "pull the swinging basket n times, each one pouring into the cistern",
    run: async (c) => {
      for (let i = 0; i < num(c, 0, "the pulls"); i++) {
        const was = await gNum(c, "waterlevel");
        await c.d.hold(`${global("animphasenext")} === "swinging"`, "the basket swinging", Math.max(c.budget, 150_000));
        const at = await propIn(c, "e27.111b", [0, 290, 640, 480]);
        // a pull, not a click: its mousedown takes the basket only if a turn of
        // its `while stilldown ()` finds the hand on it below y 280
        await tap(c, at);
        await c.d.hold(`Number(${global("waterlevel")}) === ${was + 1}`, "the basket to fill the cistern", Math.max(c.budget, 150_000));
      }
      await settle(c, "the basket");
    },
  },

  /**
   * The pulley over the well (stage 25, frame 154), swung across or back
   * (`welltopswitch`): its handle is the top bar while it shows picture 0 and
   * the upright on any other (e.shp `e27.154b`).
   */
  pulley: {
    args: [0, 0],
    wait: "quiet",
    sig: "pulley()",
    help: "swing the pulley over the well across, or back",
    run: async (c) => {
      const was = await g(c, "welltopswitch");
      await c.d.hold(`${global("animphase")} === "steady"`, "the bucket to come to rest", c.budget);
      const bar = (await c.d.evaluate<number>(DEG("e27.154b"))) === 0;
      const at = await propIn(c, "e27.154b", bar ? [287, 30, 361, 48] : [255, 48, 273, 131]);
      await clickThen(c, at, "the pulley");
      await need(c, "welltopswitch", was === "1" ? "0" : "1", "the pulley swung");
    },
  },

  /** the dock's lever (stage 26, frame 170, `e27.170g`), taken low on its right and pulled across */
  docklever: {
    args: [0, 0],
    wait: "quiet",
    sig: "dockLever()",
    help: "pull the dock's lever across",
    run: async (c) => {
      const [, , x1, y1] = await extent(c, "e27.170g");
      const from = { x: Math.min(x1 - 4, 600), y: Math.min(y1, 340) };
      await carry(c, from, { x: from.x - 140, y: from.y }, 14, "the dock's lever");
    },
  },

  /**
   * The crocodile at the dock temple (stage 34, frame 104), spear in hand: a
   * jab lands when the hand is on the yellow of its neck (x 478…490, y
   * 419…431) while the beast has turned its head (its picture 1…5, e.shp
   * `e1.104`) and nothing is running; three see it off (`crocdamage`,
   * `crockilled`).
   */
  crocodile: {
    args: [0, 0],
    wait: "quiet",
    sig: "crocodile()",
    help: "jab the crocodile's neck each time it turns its head, until it is gone",
    run: async (c) => {
      const turned = `${global("animphase")} === "seq" && ${UNLOCKED} && ((d) => d >= 1 && d <= 5)(${DEG("e1.104")})`;
      let jabs = 0;
      while ((await gNum(c, "crocdamage")) < 3) {
        if (jabs > 12) throw new Error(`twelve jabs and the crocodile still stands (${await g(c, "crocdamage")} hits)`);
        await c.d.hold(`(${turned}) || Number(${global("crocdamage")}) >= 3`, "the crocodile to turn its head", 600_000);
        if ((await gNum(c, "crocdamage")) >= 3) break;
        await c.d.clickAt(484, 425, "none", c.budget);
        await c.d.hold(
          `${global("animphase")} !== "seq" || ${global("crockilled")} === "1"`,
          "the crocodile to recover",
          c.budget,
        );
        jabs++;
      }
      await c.d.hold(`${global("crockilled")} === "1"`, "the crocodile gone", c.budget);
      await settle(c, "the crocodile gone");
      c.say(`${jabs} jab(s)`);
    },
  },

  /**
   * One of the eight crystals at the statues' feet (frames 21…28): three rows
   * — the god's animal, its number, its symbol (`e10.25a`…`c`) — each a click
   * a step on (y 100…200, 200…300, 300…400), set to what the pool's own
   * script asks (e014 `HotTub`).
   */
  crystal: {
    args: [3, 3],
    wait: "quiet",
    sig: "crystal(8, 19, 29)",
    help: "set the crystal's three rows to animal, number and symbol",
    run: async (c) => {
      for (const [r, prop] of ["e10.25a", "e10.25b", "e10.25c"].entries()) {
        const want = num(c, r, `row ${r + 1}`);
        let i = 0;
        while ((await c.d.evaluate<number>(DEG(prop))) !== want) {
          if (i >= 16) throw new Error(`row ${r + 1} never came to ${want}`);
          await clickThen(c, { x: 335, y: 150 + r * 100 }, `row ${r + 1}`, "quiet");
          i++;
        }
      }
    },
  },

  /**
   * The red gem let go on the swaying cobra on the causeway (stage 15, frame 2),
   * low on its body where every one of its pictures covers, and again if it
   * swayed off (`snakeleave`, `snakekilled`).
   */
  cobra: {
    args: [0, 0],
    wait: "quiet",
    sig: "cobra()",
    help: "drop the red gem on the cobra until it leaves",
    run: async (c) => {
      let tries = 0;
      while ((await g(c, "snakekilled")) !== "1") {
        if (tries > 8) throw new Error("the gem never found the cobra");
        const [x0, y0, x1, y1] = await extent(c, "e10.2");
        await carry(c, await middle(c, "e16.1"), { x: Math.round((x0 + x1) / 2), y: Math.round(y0 + (y1 - y0) * 0.7) }, 12, "the gem to the cobra");
        await c.d.hold(`${global("snakekilled")} === "1" || ${global("animphase")} === "seq"`, "the cobra's answer", c.budget);
        tries++;
      }
      await c.d.hold(`${global("snakekilled")} === "1"`, "the cobra to go", c.budget);
      await settle(c, "the cobra gone");
      c.say(`${tries} drop(s)`);
    },
  },

  /**
   * The game of snakes and jewels (e024): the die (`Dice`) rolled until red
   * lands on the gold pillar (`wonsnakes`). The rolls are the game's own seeded
   * `random`: the same game every run of one seed.
   */
  snakes: {
    args: [0, 0],
    wait: "quiet",
    sig: "snakes()",
    help: "roll the die until red has won the game of snakes and jewels",
    run: async (c) => {
      // the pieces come onto the board on a loop a moment after you do, and the
      // die does nothing until red is there (`Dice` mousedown)
      await c.d.hold(`!!window.dbg.session.propRuntime.get("red")?.visible`, "red on the board", c.budget);
      let rolls = 0;
      while ((await g(c, "wonsnakes")) !== "1") {
        if (rolls > 1000) throw new Error("a thousand rolls and red has not won");
        await clickThen(c, await propIn(c, "Dice"), `roll ${rolls + 1}`, "quiet");
        rolls++;
      }
      c.say(`${rolls} roll(s)`);
    },
  },

  /**
   * The pyramid door's four wheels (stage 30, frame 168, `e32.168a`…`d`),
   * turned by dragging up or down a step each 15 px (curdeg = firstdeg - dy
   * / 15), the shorter way round the 37.
   */
  wheels: {
    args: [4, 4],
    wait: "quiet",
    sig: "wheels(32, 11, 14, 25)",
    help: "turn the pyramid door's four wheels to these numbers",
    run: async (c) => {
      for (const [i, w] of ["a", "b", "c", "d"].entries()) {
        const prop = `e32.168${w}`;
        const want = num(c, i, `wheel ${w}`);
        for (let tries = 0; tries < 4; tries++) {
          const now = await c.d.evaluate<number>(DEG(prop));
          const steps = (((want - now) % 37) + 37) % 37;
          if (!steps) break;
          const up = steps <= 18;
          const n = up ? steps : 37 - steps;
          const [, y0, , y1] = await extent(c, prop);
          const { x } = await middle(c, prop);
          const from = up ? Math.min(470, y1 - 4) : Math.max(10, y0 + 4);
          await carry(c, { x, y: from }, { x, y: from + (up ? -1 : 1) * (n * 15 + 7) }, Math.max(12, n), `wheel ${w}`);
        }
        const got = await c.d.evaluate<number>(DEG(prop));
        if (got !== want) throw new Error(`wheel ${w} shows ${got}, not ${want}`);
      }
    },
  },
};
