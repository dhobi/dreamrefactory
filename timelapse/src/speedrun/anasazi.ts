/**
 * The Anasazi's verbs (world A, disc two): the machine suites' route
 * (tests/machine/worlds/anasazi.ts) a puzzle at a time, played through the
 * speedrun driver, each solved from what the game shows now.
 */
import type { ActionContext, ActionTable } from "@dreamfactory/speedrun/action";
import {
  DEG, UNLOCKED, anchor, carry, clickThen, g, global, heldPath, hover, line, middle, need, num, propIn, propPoint,
  regionMid, regionWhen, settle, tipPath, type Point,
} from "./gestures";

/** a region of a named flat, its middle — for a flat that is not the one on screen (the lever's `a0001.157`) */
async function flatMid(c: ActionContext, flat: string, name: string): Promise<Point> {
  const at = await c.d.evaluate<Point | null>(
    `((r) => r ? { x: Math.round((r.left + r.right) / 2), y: Math.round((r.top + r.bottom) / 2) } : null)(window.dbg.session.stageCtrl.flatRegion(${JSON.stringify(flat)}, ${JSON.stringify(name)}))`,
  );
  if (!at) throw new Error(`no region ${name} on ${flat}`);
  return at;
}

/**
 * `arrowflight`, flown page-side for every draw and every place along the
 * rail: the first (x, draw) whose arrow, for this wind and this head, passes
 * through the spire's hole before the mask (a002's `arrowflight`; `vnot = (d +
 * 1) * 5 + 20`, `save` the head, looked at once `loch` is past 4200). The
 * engine's own point test of the two pictures (`covers`, which is
 * `pointinprop`'s), never a copy of it.
 */
const AIM_BOW = (wind: number, head: number): string => `((wind, head) => {
  const rt = window.dbg.session.propRuntime, hole = rt.get("hole"), mask = rt.get("mask");
  const inHole = (x, y) => !!hole && rt.covers(hole, x, y, null), inMask = (x, y) => !!mask && rt.covers(mask, x, y, null);
  const through = (bowx, d) => {
    const vnot = (d + 1) * 5 + 20, save = head + 16;
    let x = 6, locv = 470;
    while (locv < 17000) {
      x++;
      const loch = vnot * x;
      locv = 480 - Math.trunc((vnot * x) / 5) + Math.trunc((save * x * x) / 20);
      const ax = Math.trunc((wind * (x - 7)) / 10) + bowx, ay = Math.trunc((locv * 240) / loch) - 300;
      if (ay > 454) return false;
      if (loch > 4200) {
        if (inHole(ax, ay)) return true;
        if (inMask(ax, ay)) return false;
      }
    }
    return false;
  };
  for (const d of [4, 5, 3, 2, 1]) for (let x = 100; x <= 540; x++) if (through(x, d)) return [x, d];
  return null;
})(${wind}, ${head})`;

/** the nine glyphs the flashlight shows in the cave, worth 3722528 to the rock of hand prints (`isfinished`) */
const HAND_GLYPHS = new Set([1, 2, 3, 7, 8, 11, 12, 14, 17]);

/**
 * A point of `name` (a prop not necessarily drawn) that no prop of the list
 * before it covers, on a grid — where a touch picks it: the tablets and the
 * kiva's walls find what was touched by picture, first in number order.
 */
const PICK_POINT = (group: string, n: number, step: number, onlyHidden: boolean, onFlat: boolean): string => `((group, n, step) => {
  const s = window.dbg.session, rt = s.propRuntime, p = rt.get(group + n);
  if (!p) return null;
  const r = p.screenRect();
  if (!r) return null;
  const before = [];
  for (let l = 0; l < n; l++) { const q = rt.get(group + l); if (q && (${onlyHidden} ? !q.visible : true)) before.push(q); }
  for (let y = Math.max(0, r.y) + ${onFlat ? 0 : 2}; y < Math.min(480, r.y + r.h); y += step)
    for (let x = Math.max(0, r.x) + ${onFlat ? 0 : 2}; x < Math.min(640, r.x + r.w); x += step) {
      if (!rt.covers(p, x, y, null)) continue;
      if (before.some((q) => rt.covers(q, x, y, null))) continue;
      if (${onFlat} && s.hitTestAt(x, y).type !== "flat") continue;
      return { x, y };
    }
  return null;
})(${JSON.stringify(group)}, ${n}, ${step})`;

export const ANASAZI_ACTIONS: ActionTable = {
  /**
   * The calendar lever (a003, frame 157): five places, left to right West,
   * East, Off, North and South (`POS1`…`POS5`, `leverpos`), dragged from where
   * it stands and held there until it has ground its way across.
   */
  lever: {
    args: [1, 1],
    wait: "quiet",
    sig: "lever(5)",
    help: "drag the calendar lever to place n (1 West, 2 East, 3 Off, 4 North, 5 South)",
    run: async (c) => {
      const to = num(c, 0, "the place");
      const now = Number(await g(c, "leverpos"));
      if (now === to) return;
      const from = await flatMid(c, "a0001.157", `POS${now}`);
      const end = await flatMid(c, "a0001.157", `POS${to}`);
      await c.d.hold(UNLOCKED, "a moment to take the lever", c.budget);
      await heldPath(c, from, [...line(from, end, 12), end, end, end, end], {
        expr: `Number(${global("leverpos")}) === ${to}`,
        what: `the lever to reach ${to}`,
      });
      await settle(c, "the lever");
      await need(c, "leverpos", String(to), "the lever");
    },
  },

  /**
   * A first region of the flat that is not one of the four edges — what there
   * is to take on a close-up (a log, a feather).
   */
  take: {
    args: [0, 0],
    wait: "quiet",
    sig: "take()",
    help: "click the one thing on this close-up that is not a way out: the region that is not up, down, left or right",
    run: async (c) => {
      const name = await c.d.evaluate<string | null>(
        `window.dbg.session.stageCtrl.currentFlatRegions().map((r) => r.name).find((n) => !/^(up|down|left|right)$/i.test(n)) ?? null`,
      );
      if (!name) throw new Error("nothing to take here");
      await clickThen(c, await regionWhen(c, name), name);
      c.say(name);
    },
  },

  /**
   * A carried thing moved so that a point of it, `tx, ty` up and left of its
   * own place, goes to each named region of the flat in turn — the honey
   * stick to the acorn, the drum stick to a drum, a leaf to its place.
   */
  tipto: {
    args: [4, Infinity],
    wait: "quiet",
    sig: "tipTo(invdrumstick, 45, 25, Drum1)",
    help: "carry a prop so that its point tx, ty up and left of it goes to these regions in turn",
    run: async (c) => {
      const [prop, , , ...regions] = c.step.args;
      const points: Point[] = [];
      for (const r of regions) points.push(await regionMid(c, r));
      await tipPath(c, prop, [num(c, 1, "tx"), num(c, 2, "ty")], points, `${prop} to ${regions.join(", ")}`);
    },
  },

  /** the honey stick dipped in the hive (a010, frame 632): its tip (86, 63) into it, out below and back */
  honey: {
    args: [0, 0],
    wait: "quiet",
    sig: "honey()",
    help: "dip the stick in the hive, out and back in one drag",
    run: async (c) => {
      const hive = await regionMid(c, "hive");
      await tipPath(c, "invhoneystick", [86, 63], [hive, { x: hive.x, y: hive.y + 120 }, hive], "the stick in the hive");
    },
  },

  /**
   * The match struck along the rock (a038, frame 101): its `while stilldown
   * ()` wants 50 px between two looks, 50 px above the hand, so the hand swings
   * to and fro a new place a turn until it catches, and is then held over the
   * twigs until it has burnt far enough (`matchburn`) to light them.
   */
  strikerock: {
    args: [0, 0],
    wait: "quiet",
    sig: "strikeRock()",
    help: "strike the match along the rock and hold it to the twigs until the fire lights",
    run: async (c) => {
      const fire = await regionMid(c, "Fire");
      const rock = await c.d.evaluate<{ left: number; top: number; bottom: number }>(`window.dbg.session.stageCtrl.flatRegion("a0007.101", "Rock")`);
      const ry = Math.round((rock.top + rock.bottom) / 2) + 50;
      const grab = await middle(c, "invmatch");
      await c.d.hold(UNLOCKED, "a moment to take the match", c.budget);
      let i = 0;
      let lit = false;
      await c.d.dragProp(
        grab,
        async () => {
          if (!lit && i < 12 && Number(await g(c, "gAnimIndex")) < 40) return { x: i++ % 2 ? rock.left + 84 : rock.left + 8, y: ry };
          if (!lit) {
            lit = true;
            return { x: fire.x - 20, y: fire.y };
          }
          await c.d.hold(`${global("gAcornFire")} === "1" || ${global("gMatchDropped")} === "1"`, "the match to burn down to the twigs", 60_000);
          return null;
        },
        c.budget,
      );
      await settle(c, "the fire");
      await need(c, "gEastRock", "1", "the fire lit");
    },
  },

  /**
   * The bow at the spire (a008, frame 839): an arrow notched, the next head
   * put on it, and the bow drawn and moved until the flight for the wind as it
   * is goes through the hole — let go on a turn whose wind it was flown for.
   * Shot after shot, until one is through (`wonarrow`): the wind drifts a step
   * at random, so how many it takes is the seed's.
   */
  archery: {
    args: [0, 0],
    wait: "quiet",
    sig: "archery()",
    help: "shoot the arrowheads at the spire's hole, each flown first for the wind, until one goes through",
    run: async (c) => {
      const heads = async (): Promise<string | null> => {
        const h = await g(c, "curinvprop");
        return /^inv(small|med|large)head$/.test(h) ? h : null;
      };
      let shot = 0;
      while ((await g(c, "wonarrow")) !== "true") {
        const head = await heads();
        if (!head) throw new Error(`${shot} arrows and none through the spire`);
        if (!(await c.d.evaluate<boolean>(`!!window.dbg.session.propRuntime.get("arrow")?.visible`))) {
          await clickThen(c, await propIn(c, "bow"), "the arrow notched", "quiet");
        }
        await carry(c, await middle(c, head), { x: 320, y: 300 }, 12, `the ${head} on the arrow`);
        const arrowDeg = await c.d.evaluate<number>(DEG("arrow"));
        const flights = new Map<number, [number, number] | null>();
        const bow = await propIn(c, "bow");
        await c.d.hold(UNLOCKED, "a moment to take the bow", c.budget);
        let aimedAt: [number, number] | null = null;
        let turns = 0;
        await c.d.dragProp(
          bow,
          async () => {
            const wind = Number(await g(c, "windlevel"));
            // released on a turn whose wind the flight was flown for, with the bow there
            if (aimedAt) {
              const bx = (await anchor(c, "bow")).x;
              if (Number(await g(c, "windlevel")) === aimedAt[1] && bx === aimedAt[0]) return null;
            }
            if (++turns > 4000) return null;
            if (!flights.has(wind)) flights.set(wind, await c.d.evaluate<[number, number] | null>(AIM_BOW(wind, arrowDeg)));
            const best = flights.get(wind);
            if (!best) {
              aimedAt = null;
              return bow;
            }
            aimedAt = [best[0], wind];
            // …the draw a player makes: all the way down, and back up a step
            return { x: best[0], y: 375 + best[1] * 20 + 8 };
          },
          600_000,
        );
        await settle(c, `shot ${shot + 1}`);
        shot++;
      }
      c.say(`${shot} shot(s)`);
    },
  },

  /**
   * The rock of hand prints (a017, frame 252): nineteen glyphs a touch turns on
   * or off, set to the nine the flashlight shows — a glyph that is off is not
   * drawn, so it is touched where it would be.
   */
  handprints: {
    args: [0, 0],
    wait: "quiet",
    sig: "handprints()",
    help: "touch the rock's glyphs on and off until the nine of the cave are lit",
    run: async (c) => {
      for (let n = 0; n <= 18 && (await g(c, "gHandPrint")) !== "1"; n++) {
        const p = await c.d.evaluate<{ visible: boolean; x: number; y: number } | null>(
          `((p) => { if (!p) return null; const r = p.screenRect(); return { visible: !!p.visible, x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) }; })(window.dbg.session.propRuntime.get("newglyph${n}"))`,
        );
        if (!p) throw new Error(`no glyph ${n} on the rock`);
        if (p.visible === HAND_GLYPHS.has(n)) continue;
        await clickThen(c, p, `glyph ${n}`, "quiet");
      }
      await c.d.hold(`${global("gHandPrint")} === "1"`, "the coyote", c.budget);
      await settle(c, "the coyote");
    },
  },

  /**
   * The four tablets (a007, frame 834): the animal and the sound of each way
   * touched — glyphs 0 and 7, 12 and 18, 26 and 32, 39 and 44 — each at a
   * pixel of it no lower-numbered glyph's picture covers (`pointinglyph`
   * takes the first in number order).
   */
  tablets: {
    args: [0, 0],
    wait: "quiet",
    sig: "tablets()",
    help: "touch each tablet's animal and sound, glyphs 0 7 12 18 26 32 39 44",
    run: async (c) => {
      for (const n of [0, 7, 12, 18, 26, 32, 39, 44]) {
        const at = await c.d.evaluate<Point | null>(PICK_POINT("glyph", n, 4, false, false));
        if (!at) throw new Error(`glyph ${n} is under the glyphs before it everywhere`);
        await clickThen(c, at, `glyph ${n}`, "quiet");
      }
    },
  },

  /**
   * The corn (a019, frame 313): the long arrow taken up as a spear, then
   * carried to each of the five pieces of cactus that hold water and pushed
   * in (a touch stabs the piece 10 and 20 px up and left of the hand).
   */
  cactus: {
    args: [0, 0],
    wait: "quiet",
    sig: "cactus()",
    help: "take up the spear and stab the five cactus pieces that hold water",
    run: async (c) => {
      await clickThen(c, await propPoint(c, "invarrow"), "the spear taken up", "quiet");
      for (const piece of ["cactusmed21", "cactussmall11", "cactussmall12", "cactuslarge70", "cactuslarge20"]) {
        const at = await propIn(c, piece);
        const hand = { x: at.x + 10, y: at.y + 20 };
        await hover(c, hand);
        await c.d.hold(`window.dbg.session.hitTestAt(${hand.x}, ${hand.y}).name === "invarrow"`, "the spear at the hand", c.budget);
        const before = Number(await g(c, "cornlevel"));
        await clickThen(c, hand, `the spear into ${piece}`, "quiet");
        if (Number(await g(c, "cornlevel")) <= before) throw new Error(`${piece} did not leak (corn ${await g(c, "cornlevel")})`);
      }
      await c.d.hold(`${global("cornsolved")} === "true"`, "the corn to grow", c.budget);
    },
  },

  /**
   * The rattle shaken at the rattlesnake (a022, frame 328): brought over
   * slowly, then four quick moves of 80 px — left, right, left, left — each
   * a shake (`phaser`), held still between so the next counts as new.
   */
  rattle: {
    args: [0, 0],
    wait: "quiet",
    sig: "rattle()",
    help: "shake the rattle at the snake: left, right, left, left",
    run: async (c) => {
      const grab = await propPoint(c, "invrattle");
      let x = 320;
      const path: Point[] = [...line(grab, { x, y: 300 }, 24)];
      for (let i = 0; i < 6; i++) path.push({ x, y: 300 });
      for (const dx of [-80, 80, -80, -80]) {
        x += dx;
        for (let i = 0; i < 9; i++) path.push({ x, y: 300 });
      }
      await c.d.hold(UNLOCKED, "a moment to take the rattle", c.budget);
      await heldPath(c, grab, path);
      await c.d.hold(`${global("rattlersolved")} === "true"`, "the snake to go", c.budget);
      await settle(c, "the ladder");
    },
  },

  /**
   * The loom (a024, frame 345): three rows, each ball into the basket (the
   * shuttle with the first), a touch on the ball and one on the shuttle, the
   * white threads, and the bar.
   */
  loom: {
    args: [0, 0],
    wait: "quiet",
    sig: "loom()",
    help: "weave the blanket's three rows",
    run: async (c) => {
      const basket = await regionMid(c, "basketarea");
      const tap = async (name: string): Promise<void> => clickThen(c, await propIn(c, name), name, "quiet");
      for (const [row, ball] of ["yarn", "yarn2", "yarn3"].entries()) {
        await carry(c, await propIn(c, ball), basket, 14, `${ball} to the basket`);
        if (row === 0) await carry(c, await propIn(c, "shuttle"), basket, 14, "the shuttle to the basket");
        await tap("dragyarn");
        await tap("shuttle");
        await clickThen(c, await regionWhen(c, "weaveit"), "the white threads", "quiet");
        await tap("loommove");
        await c.d.hold(`Number(${global("loomup")}) === ${row + 1}`, `row ${row + 1}`, c.budget);
        await settle(c, `row ${row + 1}`);
      }
      await c.d.hold(`${global("gLoomSolved")} === "1"`, "the blanket", c.budget);
    },
  },

  /**
   * The leaves in the kiva's sand pit (a021, frame 932): once the wind has
   * blown them in, the third, second and first go to the spiral's three empty
   * places.
   */
  leaves: {
    args: [0, 0],
    wait: "quiet",
    sig: "leaves()",
    help: "lay the three blown-in leaves on the spiral's empty places",
    run: async (c) => {
      await c.d.hold(`!!window.dbg.session.propRuntime.get("leaf2")?.visible && ${UNLOCKED}`, "the leaves to settle", 150_000);
      for (const [leaf, spot] of [["leaf2", "spot1"], ["leaf1", "spot2"], ["leaf0", "spot3"]]) {
        await propIn(c, leaf);
        await tipPath(c, leaf, [0, 0], [await regionMid(c, spot)], `${leaf} to ${spot}`);
      }
      await c.d.hold(`${global("kivaentry")} === "true"`, "the spiral whole", c.budget);
    },
  },

  /**
   * One wall of the kiva (a039, frames 105…107): its pictures touched where
   * each would be — one not yet touched is not drawn — on a pixel no earlier
   * hidden picture covers, on the wall itself.
   */
  pictures: {
    args: [2, Infinity],
    wait: "quiet",
    sig: "pictures(glyphs106, 0, 1, 5)",
    help: "touch these pictures of the kiva's wall",
    run: async (c) => {
      const group = c.step.args[0];
      for (let i = 1; i < c.step.args.length; i++) {
        const n = num(c, i, "a picture");
        if (await c.d.evaluate<boolean>(`!!window.dbg.session.propRuntime.get("${group}${n}")?.visible`)) continue;
        const at = await c.d.evaluate<Point | null>(PICK_POINT(group, n, 3, true, true));
        if (!at) throw new Error(`picture ${group}${n} has no pixel to touch`);
        await clickThen(c, at, `picture ${n}`, "quiet");
        if (!(await c.d.evaluate<boolean>(`!!window.dbg.session.propRuntime.get("${group}${n}")?.visible`))) {
          throw new Error(`picture ${group}${n} did not show`);
        }
      }
    },
  },
};
