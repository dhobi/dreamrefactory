/**
 * Timelapse's verbs, over the engine's ({@link CORE_ACTIONS}).
 *
 * A place in this game is a stage and a frame, not a room, and the way between
 * two of them is the stage's own table (src/nav.ts) — so the one verb that
 * moves you is `goto(stage, frame)`, the machine suites' walk (tests/machine/
 * nav.ts `goTo`) driven through the speedrun driver instead of the harness.
 * The rest are what a player does once there: click a region or a prop by
 * name, carry a prop somewhere, and the island's drawn-out gestures (the
 * lantern's pump and match, the stone face's eyes, the time gate's crystal),
 * each one verb because each is one procedure.
 *
 * Every verb drives the page only through `c.d`: keys and clicks and held
 * drags, and questions asked of `window.dbg` — where you stand, which regions
 * and props are on screen, what the hit test says, a global the route waits
 * on. None writes to the game. The stage files the walk plans over are read
 * through the page's own file store (`dbg.host.files`), and the game stands
 * still while they come (no hold is open), so a plan costs no game time.
 */
import type { VerbSpec } from "@dreamfactory/speedrun/sheet";
import { CORE_ACTIONS } from "@dreamfactory/speedrun/actions-core";
import { composeActions, condition, resolveIn, verbsOf, type Action, type ActionTable } from "@dreamfactory/speedrun/action";
import { scriptToText, sniffScript } from "@dreamfactory/engine/df/script";
import { PAGE_KEY, dropSpotsIn, spotId, walkTo, type Spot } from "../nav";
import {
  OFF, REGIONS, SETTLED, UNLOCKED, WHERE, boxOf, carry, clickThen, extent, global, heldPath, middle, num, propIn, propPoint, regionPoint,
  regionWhen, settle, type Point,
} from "./gestures";
import { EGYPT_ACTIONS } from "./egypt";
import { MAYA_ACTIONS } from "./maya";
import { ANASAZI_ACTIONS } from "./anasazi";
import { ATLANTIS_ACTIONS } from "./atlantis";

/* ------------------------------------------------------------------ *
 * The walk
 * ------------------------------------------------------------------ */

/** the stage files the walks have read, by name — the discs do not change */
const discs = new Map<string, Uint8Array | null>();

/**
 * Walk to a frame of a stage on this world, by the stages' own tables
 * (src/nav.ts `walkTo`, which the machine suites walk by too): the shortest
 * path in keys, pressed one at a time and each let settle, a hotspot clicked
 * where the way is a region (the stone face on frame 51), and a way the game
 * refused struck out and the rest planned again from where it left you.
 *
 * The one difference from the suites' walk is that this one does not ask the
 * game which words a frame answers today (that would run the stage's script
 * beside the player): it plans on every word the table might answer, and a
 * table that answered otherwise is a strike and a re-plan, which costs the
 * press it took.
 */
const GOTO: Action = {
  args: [2, 2],
  wait: "quiet",
  sig: "goto(7, 514)",
  help: "walk to frame 514 of stage 7 of this world, by the stage tables — keys and the hotspots that move you",
  run: async (c) => {
    const want = { stage: num(c, 0, "the stage"), frame: num(c, 1, "the frame") };
    const { world } = await c.d.evaluate<{ world: string }>(WHERE);
    const missing = new Set<string>();
    let strikes = 0;
    const presses = await walkTo(
      {
        world,
        file: (name) => {
          const bytes = discs.get(name);
          if (bytes === undefined) missing.add(name);
          return bytes ?? null;
        },
        fetch: async () => {
          if (!missing.size) return false;
          for (const name of missing) {
            discs.set(name, await c.d.evaluate<Uint8Array | null>(`window.dbg.host.files.load(${JSON.stringify(name)})`));
          }
          missing.clear();
          return true;
        },
        spot: () => c.d.evaluate<Spot>(WHERE),
        globals: (names) =>
          c.d.evaluate<Record<string, string>>(
            `Object.fromEntries(${JSON.stringify(names)}.map((n) => [n, String(window.dbg.session.interp.globals.get(n) ?? "")]))`,
          ),
        exits: async () => null,
        press: async (way) => {
          await c.d.hold(SETTLED, `the game to take ${way}`, c.budget);
          await c.d.key(PAGE_KEY[way], "none", c.budget);
          await settle(c, way, "quiet");
          c.d.log(`goto: ${way} to ${spotId(await c.d.evaluate<Spot>(WHERE))}`);
        },
        regions: () => c.d.evaluate<string[]>(REGIONS),
        click: async (region) => {
          await clickThen(c, await regionPoint(c, region), region, "quiet");
        },
        moved: (from, passes) => c.d.tryHold(OFF(from), passes * 50),
        log: (l) => {
          strikes++;
          c.d.log(l);
          c.say(l);
        },
        fail: (why) => {
          throw new Error(why);
        },
      },
      (s) => s.stage === want.stage && s.frame === want.frame,
      spotId(want),
    );
    c.say(`${presses} step(s)${strikes ? `, ${strikes} refused` : ""}`);
    await settle(c, `arriving at ${spotId(want)}`);
  },
};

/* ------------------------------------------------------------------ *
 * The table
 * ------------------------------------------------------------------ */

const TIMELAPSE_ACTIONS: ActionTable = {
  goto: GOTO,

  /**
   * A region of the flat, once the flat has it (a melt that has to run, a
   * flower that has to open, before there is anything to click). `until:`
   * clicks it again, each let settle, until that holds: a game played round
   * after round against the statue on the Maya's bridge.
   */
  region: {
    args: [1, 1],
    wait: "quiet",
    opts: ["until"],
    sig: "region(camera)",
    help: "click a region of the flat by name, nearest its middle, once it is there; until: clicks again until it holds",
    run: async (c) => {
      const name = c.step.args[0];
      const until = c.step.opts.until ? condition(c.step.opts.until) : null;
      for (let n = 0; n < 1000; n++) {
        if (until && (await c.d.evaluate<boolean>(`!!(${until})`))) {
          c.say(`${n} click(s)`);
          return;
        }
        await clickThen(c, await regionWhen(c, name), name);
        if (!until) return;
      }
      throw new Error(`a thousand clicks on ${name} and never ${c.step.opts.until}`);
    },
  },

  /**
   * A prop, once it is drawn where a hand can reach it: at the point of it
   * nearest its middle, or with `box:` the first point of it inside that box
   * (a basket that swings, a button below a line).
   */
  prop: {
    args: [1, 1],
    wait: "quiet",
    opts: ["box"],
    sig: "prop(TableMatchBox)",
    help: "click a prop by name once it is on screen, nearest its middle — box: x0 y0 x1 y1 for the first point of it in a box",
    run: async (c) => {
      const name = c.step.args[0];
      const box = c.step.opts.box ? boxOf(c.step.opts.box) : null;
      const at = box
        ? await propIn(c, name, box)
        : (await propIn(c, name), await propPoint(c, name));
      await clickThen(c, at, name);
    },
  },

  /**
   * A prop taken hold of at the middle of its box and let go at a point, or at
   * a region of the flat — where the hand lets go is what the prop's script
   * reads (the masks' slots on frame 514 are bands of x, i.shp `HeadInSlot`).
   */
  drag: {
    args: [2, 3],
    wait: "quiet",
    sig: "drag(Heads, 80, 300)",
    help: "carry a prop to a point of the screen, or to a region by name — drag(invlefteye, lefteye) — and let it go there",
    run: async (c) => {
      const name = c.step.args[0];
      const to = c.step.args.length === 3 ? { x: num(c, 1, "x"), y: num(c, 2, "y") } : await regionWhen(c, c.step.args[1]);
      await carry(c, await middle(c, name), to, 12, `${name} to ${c.step.args.slice(1).join(",")}`);
    },
  },

  /**
   * The thing in hand let go where it goes on this frame, read off its own
   * mousedown (src/nav.ts `dropSpotsIn`): a region of the flat, a box, or
   * anywhere. `goto` the frame first.
   */
  useon: {
    args: [1, 1],
    wait: "quiet",
    sig: "useOn(invlog)",
    help: "carry the prop in hand to where its own script takes it on this frame, and let it go",
    run: async (c) => {
      const name = c.step.args[0];
      const src = await c.d.evaluate<Uint8Array | null>(`((p) => p ? p.shop.shp.file.containers[p.group.scriptContainerLocation]?.data ?? null : null)(window.dbg.session.propRuntime.get(${JSON.stringify(name)}))`);
      const tokens = src ? sniffScript(src) : null;
      const spots = dropSpotsIn(tokens ? scriptToText(tokens) : "");
      const { frame } = await c.d.evaluate<Spot>(WHERE);
      const spot = spots.find((s) => s.frame === frame);
      if (!spot) {
        throw new Error(`${name} cannot be let go on frame ${frame}; its script takes it on ${spots.map((s) => s.frame).join(", ") || "no frame"}`);
      }
      const to = spot.region
        ? await regionPoint(c, spot.region)
        : spot.box
          ? { x: Math.round((spot.box[0] + spot.box[2]) / 2), y: Math.round((spot.box[1] + spot.box[3]) / 2) }
          : { x: 320, y: 240 };
      await carry(c, await propPoint(c, name), to, 14, `${name} to frame ${frame}`);
    },
  },

  /**
   * The Collins lantern's pump (Easter Island, stage 5 frame 867, after
   * `region(Lantern)`): its handle held and pulled up past y 300 and pushed
   * down past 317 (i.shp `PumpHandle`), a stroke a time, `n` strokes.
   */
  pump: {
    args: [1, 1],
    wait: "quiet",
    sig: "pump(10)",
    help: "work the lantern's pump handle up and down n strokes",
    run: async (c) => {
      const n = num(c, 0, "the strokes");
      const [x0, y0, x1] = await extent(c, "PumpHandle");
      const x = Math.round((x0 + x1) / 2);
      const path: Point[] = [];
      for (let i = 0; i < n; i++) path.push({ x, y: 290 }, { x, y: 325 });
      await c.d.hold(UNLOCKED, "the pump to be free", c.budget);
      await heldPath(c, { x, y: y0 + 12 }, path);
      await settle(c, "the pump");
    },
  },

  /**
   * A match out of the box and lit, and held over the lantern's mantle until it
   * catches: the match comes out under the hand (`MatchBox` mousedown), strikes
   * when it crosses 60 px of the box inside 30 ticks (`HandleMatch`), and is
   * carried to the mantle before it burns down.
   */
  strikematch: {
    args: [0, 0],
    wait: "quiet",
    sig: "strikeMatch()",
    help: "take a match from the box, strike it along the box and hold it to the lantern's mantle until it lights",
    run: async (c) => {
      const [bx0, by0, bx1, by1] = await extent(c, "MatchBox");
      const y = Math.round((by0 + by1) / 2) + 30;
      const path: Point[] = [];
      for (let x = bx0 - 4; x <= bx1 - 8; x += 20) path.push({ x, y });
      for (let i = 1; i <= 10; i++) {
        path.push({ x: Math.round(bx1 + ((300 - bx1) * i) / 10), y: Math.round(y + ((320 - y) * i) / 10) });
      }
      await c.d.hold(UNLOCKED, "the match box to be free", c.budget);
      await heldPath(c, { x: bx0 + 4, y: Math.round((by0 + by1) / 2) }, path, {
        expr: `${global("gLanternLit")} === "1"`,
        what: "the lantern to light",
      });
      await settle(c, "the lit lantern");
    },
  },

  /**
   * The stone face's eyes (Easter Island, stage 7 frame 299) turned to mask `n`
   * of six: they open on mask 4, and each click on an eye's right (left) side
   * makes it the next (previous). Waits for them to open first.
   */
  eyes: {
    args: [1, 1],
    wait: "quiet",
    sig: "eyes(5)",
    help: "turn the stone face's eyes to mask n (1–6), a click at a time",
    run: async (c) => {
      const want = num(c, 0, "the mask");
      const head = `Number(${global("gCurrHead")})`;
      const eye = global("gEyePosition");
      const rest = `[1, 6, 11, 16, 21, 26].includes(Number(${eye}))`;
      await c.d.hold(`${global("headSolid")} === "0" && ${global("gEyePosition")} !== "0"`, "the eyes to open", c.budget);
      for (let guard = 0; guard < 12; guard++) {
        const now = await c.d.evaluate<number>(head);
        if (now === want) return;
        // the face is a film waiting on the eyes, never quiet: what says a
        // click was taken is the eyes leaving where they rested, and coming
        // to rest again
        const was = await c.d.evaluate<string>(eye);
        await c.d.clickAt(now < want ? 370 : 310, 75, "taken", c.budget);
        await c.d.hold(`${eye} !== ${JSON.stringify(was)} && ${rest}`, "the eyes to turn", c.budget);
      }
      throw new Error(`twelve clicks and the eyes never came to mask ${want}`);
    },
  },

  /**
   * From the professor's console, one world's button and a touch of the
   * crystal ball: the button's film waits on the crystal, a touch on it ends
   * the film with the hand still there, which is what `dotransport` asks
   * (x 230…440, y 50…260), and `enterworld` takes you in.
   */
  travel: {
    args: [1, 1],
    wait: "quiet",
    sig: "travel(Button10)",
    help: "press a world's button on the time machine's console and touch the crystal: into that world",
    run: async (c) => {
      const { world } = await c.d.evaluate<{ world: string }>(WHERE);
      const b = await regionPoint(c, c.step.args[0]);
      await c.d.clickAt(b.x, b.y, "none", c.budget);
      await c.d.hold(`window.dbg.host.director.screenOwner() === "movie"`, "the gate's film", c.budget);
      await c.d.clickAt(335, 155, "none", c.budget);
      await c.d.hold(`${global("curworldchar")} !== ${JSON.stringify(world)}`, "another world", 120_000);
      await c.d.settle(c.wait, "arriving", 120_000);
    },
  },
};

/**
 * The engine's verbs and this game's over the top. Composed once and exported,
 * because the workbench and the parser must be handed the SAME table
 * (`speedrun/src/runner.ts`, `runSheet`).
 */
export const ACTIONS: ActionTable = composeActions(CORE_ACTIONS, TIMELAPSE_ACTIONS, EGYPT_ACTIONS, MAYA_ACTIONS, ANASAZI_ACTIONS, ATLANTIS_ACTIONS);

/** the grammar half of {@link ACTIONS}, for the parser */
export const VERBS: Record<string, VerbSpec> = verbsOf(ACTIONS);

/** a verb by name, case-insensitively */
export const resolve = (verb: string): Action | undefined => resolveIn(ACTIONS, verb);
