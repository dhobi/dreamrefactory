/**
 * Dust's two gunfights, each one verb: the bounty hunters on day 3's night and
 * the Kid's gang on day 4.
 *
 * A loop of looking, aiming, walking and reloading is not something a sheet can
 * write, so each fight is a named verb, and the route through it is the
 * playthrough's (`rungs/d3e004.ts`, `rungs/d4e001.ts`), which read it off the
 * scripts. What the two share is here at the top:
 *
 *   - The gun is the player's: raised with a click on it in the panel
 *     (`INVEN.PRP/0406`), reloaded with clicks on the gunhand itself
 *     (`HOUSE.PRP/0270`: one outside the chamber swings the cylinder out, each
 *     inside `pointx < 248 & pointy < 255` is a round, one outside shuts it).
 *   - Where to aim is asked of the engine: `NEW.FLT/0002 bullet ()` resolves a
 *     shot with `hittest`, so the picture is swept with the same hit test and the
 *     first pixel answering a living gunman is fired at. `ishit ()` falls
 *     through to true for any shot that hit-tests an actor, so every one lands;
 *     four kill (`hitwalker`/`hitstat`, `actorvalue > 2`).
 *   - Walkers park on your row or column without checking the line of sight
 *     (`walkloop`), so a walker nowhere in the picture is gone after: one cell
 *     from him, facing him.
 *   - A fight closes only with the bodies out of the picture (`deadexits`), so
 *     it ends by turning away.
 *
 * Damage is a race, not a skill: whether a gunman fires on a pass is a die, and
 * the player dies past 15 hits on day 3 (`NITE.SET/0001 hit`) and past 30 on
 * day 4 (`TOWN.SET/0001 hit`).
 */
import { CORE_ACTIONS } from "@dreamfactory/speedrun/actions-core";
import type { Action, ActionContext } from "@dreamfactory/speedrun/action";

type Cell = { x: number; z: number; view: string };

/** the panel's drawing of the item in hand (INVEN.PRP/0001) */
const HAND = { x: 316, y: 320 };

const ASK = (fn: string, args: string): string =>
  `(() => { const i = window.dbg.session.interp; return i.builtins.get(${JSON.stringify(fn)})(i, [${args}]); })()`;
const NUM = (name: string): string => `Number(window.dbg.session.interp.globals.get(${JSON.stringify(name)}) ?? 0)`;
const POSE = (who: string): string => `String(${ASK("actorpose", JSON.stringify(who))}).toLowerCase()`;
const ALIVE = (who: string): string => `!["dead", "todie"].includes(${POSE(who)})`;
const ON_SCREEN = (who: string): string => `Number(${ASK("actordist", JSON.stringify(who))}) !== 32000`;
const GUN_UP = `Number(${ASK("propvisible", '"gunhand"')}) === 1`;
const GUN_VIEW = `String(${ASK("propview", '"gunhand"')}).toLowerCase()`;
const LOOPSOUND_CLEAR = `String(window.dbg.session.interp.globals.get("loopsound") ?? "") === ""`;

/** a living gunman whose name starts so, under the picture, by the engine's own hit test */
const SIGHT = (prefix: string, step: number): string => `(() => {
  const s = window.dbg.session, i = s.interp, pose = i.builtins.get("actorpose");
  for (let y = 0; y < 264; y += ${step}) for (let x = 0; x < 512; x += ${step}) {
    const h = s.hitTestAt(x, y);
    if (!h || h.type !== "actor" || !h.name.toLowerCase().startsWith(${JSON.stringify(prefix)})) continue;
    if (["dead", "todie"].includes(String(pose(i, [h.name])).toLowerCase())) continue;
    return { x, y };
  }
  return null;
})()`;
const STILL = (prefix: string, at: { x: number; y: number }): string => `(() => {
  const s = window.dbg.session, h = s.hitTestAt(${at.x}, ${at.y});
  return !!h && h.type === "actor" && h.name.toLowerCase().startsWith(${JSON.stringify(prefix)})
    && !["dead", "todie"].includes(String(s.interp.builtins.get("actorpose")(s.interp, [h.name])).toLowerCase());
})()`;

/** a point on the gunhand sprite, in the chamber or out of it (HOUSE.PRP/0270 clickinchamber) */
const ON_GUN = (chamber: boolean): string => `(() => {
  const s = window.dbg.session;
  const gun = (x, y) => { const h = s.hitTestAt(x, y); return !!h && h.type === "prop" && /^gunhand$/i.test(h.name); };
  let best = null;
  for (let y = 150; y < 264; y += 2) for (let x = 150; x < 360; x += 2) {
    if (${chamber} !== (x < 248 && y < 255)) continue;
    if (!gun(x, y)) continue;
    let room = 0;
    while (room < 10 && gun(x - room - 2, y - room - 2) && gun(x + room + 2, y - room - 2)
      && gun(x - room - 2, y + room + 2) && gun(x + room + 2, y + room + 2)) room += 2;
    if (!best || room > best.room) best = { x, y, room };
  }
  return best;
})()`;

/** the cell a gunman stands on in the town's grid */
const CELL_OF = (who: string): string => `(() => {
  const i = window.dbg.session.interp, xyz = i.builtins.get("actorxyz");
  return { x: Math.round((Number(xyz(i, [${JSON.stringify(who)}, 1])) - 128) / 256),
           z: Math.round((Number(xyz(i, [${JSON.stringify(who)}, 2])) - 128) / 256) };
})()`;

async function gunToggle(c: ActionContext, up: boolean, budget: number): Promise<void> {
  for (let i = 0; i < 6; i++) {
    if ((await c.d.evaluate<boolean>(GUN_UP)) === up) return;
    await c.d.clickAt(HAND.x, HAND.y, "none", budget);
    await c.d.tryHold(up ? GUN_UP : `!(${GUN_UP})`, 3000);
  }
  if ((await c.d.evaluate<boolean>(GUN_UP)) !== up) throw new Error(`the gun would not go ${up ? "up" : "down"}`);
}

async function reload(c: ActionContext, budget: number): Promise<void> {
  const { d } = c;
  await d.hold(`${GUN_VIEW} === "idle"`, "the gun to come back to level", budget);
  const frame = await d.evaluate<{ x: number; y: number } | null>(ON_GUN(false));
  if (!frame) throw new Error(`no frame of the gun on screen to swing the cylinder out with`);
  await d.clickAt(frame.x, frame.y, "none", budget);
  await d.hold(`${GUN_VIEW} === "reload"`, "the cylinder to swing out", budget);
  for (let i = 0; i < 10 && (await d.evaluate<number>(NUM("bulletcount"))) < 6; i++) {
    const chamber = await d.evaluate<{ x: number; y: number } | null>(ON_GUN(true));
    if (!chamber) throw new Error(`no chamber of the gun on screen`);
    await d.clickAt(chamber.x, chamber.y, "none", budget);
    await d.tryHold(`${NUM("bulletcount")} > 0`, 500);
  }
  const shut = await d.evaluate<{ x: number; y: number } | null>(ON_GUN(false));
  if (shut) await d.clickAt(shut.x, shut.y, "none", budget);
  await d.hold(`${GUN_VIEW} === "idle"`, "the cylinder to shut", budget);
}

const turn = (c: ActionContext): Promise<void> =>
  CORE_ACTIONS.right.run({ ...c, step: { ...c.step, args: [] }, wait: "none" });

/** the fight's own movement and shooting, over one room and one gang */
function fighter(goto: Action, set: string, prefix: string) {
  /** walk to a cell, giving up the walk the moment `done` holds */
  const walk = (c: ActionContext, to: Cell, done: string): Promise<void> =>
    goto.run({
      ...c,
      step: { ...c.step, verb: "goto", args: [String(to.x), String(to.z), to.view], opts: { set, until: `js == (${done})` } },
    });

  /** stand one cell from a gunman who has parked out of sight, facing him */
  const closeIn = async (c: ActionContext, who: string, done: string): Promise<void> => {
    const at = await c.d.evaluate<{ x: number; z: number }>(CELL_OF(who));
    const spots: Cell[] = [
      { x: at.x, z: at.z - 1, view: "south" },
      { x: at.x, z: at.z + 1, view: "north" },
      { x: at.x - 1, z: at.z, view: "east" },
      { x: at.x + 1, z: at.z, view: "west" },
    ];
    for (const s of spots) {
      try {
        await walk(c, s, done);
        return;
      } catch {
        // not a cell that can be stood on, or not reachable from here
      }
    }
  };

  /**
   * Shoot until `done`. `lost` is what to do with nobody in the picture: a
   * walker is looked round for and gone after, a placed man is waited for (he
   * is up only for the length of a pop) or looked for in the next of his cells.
   */
  const shootOut = async (
    c: ActionContext,
    done: string,
    lost: (blind: number) => Promise<void>,
    budget: number,
    onlyWhen = "true",
  ): Promise<number> => {
    const { d } = c;
    let aim: { x: number; y: number } | null = null;
    let blind = 0;
    let shots = 0;
    for (let round = 0; round < 1500 && !(await d.evaluate<boolean>(done)); round++) {
      if ((await d.evaluate<number>(NUM("bulletcount"))) === 0) {
        await reload(c, budget);
        continue;
      }
      if (aim && !(await d.evaluate<boolean>(STILL(prefix, aim)))) aim = null;
      if (!aim && (await d.evaluate<boolean>(onlyWhen))) {
        aim = await d.evaluate<{ x: number; y: number } | null>(SIGHT(prefix, blind > 2 ? 4 : 8));
      }
      if (aim) {
        blind = 0;
        await d.clickAt(aim.x, aim.y, "none", budget);
        shots++;
        await d.sleep(50);
        continue;
      }
      blind++;
      await lost(blind);
    }
    if (!(await d.evaluate<boolean>(done))) throw new Error(`the fight did not end — ${done}`);
    return shots;
  };

  /** a walker: wait at `goal`, look round, go after him */
  const walker = async (c: ActionContext, who: string, goal: Cell, done: string, budget: number): Promise<number> => {
    await walk(c, goal, done);
    return shootOut(c, done, async (blind) => {
      if (blind % 12 === 0) await closeIn(c, who, done);
      else await turn(c);
      await c.d.sleep(150);
    }, budget);
  };

  /** turn away until `changed` — the bodies out of the picture, or men taking their places */
  const lookAway = async (c: ActionContext, changed: string, tries = 40): Promise<void> => {
    for (let i = 0; i < tries && !(await c.d.evaluate<boolean>(changed)); i++) {
      await turn(c);
      await c.d.tryHold(changed, 500);
    }
  };

  return { walk, walker, shootOut, lookAway };
}

/**
 * The bounty hunters, day 3's night. Stepping out of the saloon at `phase = 2`
 * is the ambush (`NITE.SET/0131` → `NITE.SET/0001 openfight`: `phase = 3`, the
 * gun in hand, five set up). `bounty1`/`bounty2` walk to you from one of five
 * stars; `bounty3..5` are placed and break cover only for a player in a scene
 * their `closenough ()` names — D7 (3,6) west, G13 (6,12) west, G6 (6,5) south
 * — and `bounty5` arms only once `bounty4` is dead.
 */
export function bountyHunters(goto: Action): Action {
  const f = fighter(goto, "nite", "bounty");
  const STATION: Record<string, Cell & { walks: boolean }> = {
    bounty1: { x: 6, z: 7, view: "south", walks: true },
    bounty2: { x: 6, z: 7, view: "south", walks: true },
    bounty3: { x: 3, z: 6, view: "west", walks: false },
    bounty4: { x: 6, z: 12, view: "west", walks: false },
    bounty5: { x: 6, z: 5, view: "south", walks: false },
  };
  return {
    args: [0, 0],
    once: true,
    wait: "none",
    sig: "bountyHunters()",
    help: "fight the five bounty hunters of day 3's night from outside the saloon to the end, and put the gun away",
    run: async (c) => {
      const { d } = c;
      const budget = Math.max(c.budget, 60_000);
      await d.hold(`${NUM("fighton")} === 1`, "the ambush", budget);
      await d.settle("quiet", "the ambush", budget);
      await gunToggle(c, true, budget);
      await reload(c, budget);
      let shots = 0;
      for (const [who, st] of Object.entries(STATION)) {
        const done = `!(${ALIVE(who)})`;
        if (await d.evaluate<boolean>(done)) continue;
        if (st.walks) {
          shots += await f.walker(c, who, st, done, budget);
          continue;
        }
        await f.walk(c, st, done);
        shots += await f.shootOut(c, done, async (blind) => {
          if (blind % 20 === 0) await f.walk(c, st, done);
          await d.sleep(150);
        }, budget);
      }
      await f.lookAway(c, LOOPSOUND_CLEAR, 30);
      await d.hold(LOOPSOUND_CLEAR, "closefight () to run", budget);
      await d.tryHold(`${GUN_VIEW} === "idle"`, 5000);
      await gunToggle(c, false, budget);
      c.say(`five down in ${shots} shots, ${await d.evaluate<number>(NUM("playerhits"))} hits taken`);
    },
  };
}

/**
 * The Kid's gang, day 4. Stepping out of the saloon at `phase = 1` turns the
 * morning (`TOWN.SET/0131`), and the afternoon IS the fight (`NEW.FLT/0001
 * advanceday` → `TOWN.SET/0001 openfight`: `fightphase = 1`). Three rounds,
 * each ended by `deadexits ()` with `fightphase + 1`, and 4 is the fight over
 * (`closefight`: `phase = 3`):
 *
 *   1. kidgang1..3 walk to you; waited for outside the saloon.
 *   2. five placed men, one corner each, and `closenough ()` lists disjoint
 *      enough to fight them one at a time from the stations below.
 *   3. the same five in the main street; 3..5 arm only once 1 and 2 are down.
 *
 * A placed man takes his position only while you are NOT looking at his corner
 * (`initxyz`: hidden again unless `actordist = 32000`), and `variable (me)` —
 * readable as the global `kidgangN` — says he has it; so before each round the
 * player stands in cover and looks away until they are all armed.
 */
export function kidGang(goto: Action): Action {
  const f = fighter(goto, "town", "kidgang");
  const GANG = [1, 2, 3, 4, 5].map((n) => `kidgang${n}`);
  const STATIONS: Record<number, Record<string, Cell[]>> = {
    2: {
      kidgang1: [{ x: 6, z: 12, view: "east" }, { x: 6, z: 11, view: "south" }, { x: 6, z: 10, view: "south" }],
      kidgang2: [{ x: 0, z: 6, view: "north" }, { x: 3, z: 4, view: "west" }, { x: 1, z: 6, view: "north" },
                 { x: 2, z: 6, view: "north" }, { x: 3, z: 3, view: "west" }, { x: 3, z: 5, view: "west" },
                 { x: 4, z: 3, view: "west" }],
      kidgang3: [{ x: 6, z: 8, view: "east" }, { x: 6, z: 9, view: "north" }, { x: 6, z: 10, view: "north" },
                 { x: 5, z: 10, view: "east" }, { x: 6, z: 7, view: "south" }, { x: 6, z: 6, view: "south" }],
      kidgang4: [{ x: 7, z: 6, view: "east" }, { x: 9, z: 6, view: "west" }, { x: 10, z: 6, view: "west" },
                 { x: 9, z: 5, view: "south" }, { x: 8, z: 6, view: "east" }, { x: 5, z: 6, view: "east" },
                 { x: 6, z: 6, view: "east" }, { x: 6, z: 5, view: "east" }],
      kidgang5: [{ x: 6, z: 3, view: "north" }, { x: 5, z: 3, view: "north" }, { x: 7, z: 3, view: "north" },
                 { x: 6, z: 4, view: "north" }, { x: 6, z: 5, view: "north" }, { x: 6, z: 6, view: "north" }],
    },
    3: {
      kidgang1: [{ x: 6, z: 5, view: "south" }, { x: 5, z: 6, view: "east" }, { x: 7, z: 6, view: "west" },
                 { x: 6, z: 6, view: "south" }],
      kidgang2: [{ x: 6, z: 7, view: "south" }, { x: 5, z: 10, view: "east" }, { x: 7, z: 10, view: "west" },
                 { x: 6, z: 11, view: "north" }],
      kidgang3: [{ x: 6, z: 5, view: "north" }, { x: 5, z: 3, view: "east" }, { x: 7, z: 3, view: "west" },
                 { x: 6, z: 6, view: "north" }],
      kidgang4: [{ x: 6, z: 5, view: "north" }, { x: 5, z: 3, view: "east" }, { x: 7, z: 3, view: "west" },
                 { x: 6, z: 6, view: "north" }],
      kidgang5: [{ x: 6, z: 5, view: "north" }, { x: 5, z: 3, view: "east" }, { x: 7, z: 3, view: "west" },
                 { x: 6, z: 6, view: "north" }],
    },
  };
  /** where to stand while the round's men take their places */
  const COVER: Record<number, Cell> = { 2: { x: 4, z: 6, view: "north" }, 3: { x: 3, z: 8, view: "north" } };

  return {
    args: [0, 0],
    once: true,
    wait: "none",
    sig: "kidGang()",
    help: "fight the Kid's gang on day 4 from outside the saloon through all three rounds, and put the gun away",
    run: async (c) => {
      const { d } = c;
      const budget = Math.max(c.budget, 60_000);
      const phaseNow = (): Promise<number> => d.evaluate<number>(NUM("fightphase"));
      const alive = (who: string): Promise<boolean> => d.evaluate<boolean>(ALIVE(who));
      const armed = (who: string): string => `${NUM(who)} !== 0`;
      await d.hold(`${NUM("fighton")} === 1 && ${NUM("fightphase")} === 1`, "the gang to open up", budget);
      await d.settle("quiet", "the ambush", budget);
      await gunToggle(c, true, budget);
      await reload(c, budget);
      let shots = 0;
      for (let guard = 0; guard < 30 && (await phaseNow()) <= 3; guard++) {
        const phase = await phaseNow();
        let target: string | undefined;
        for (const who of GANG) if (await alive(who)) { target = who; break; }
        if (!target) {
          await f.lookAway(c, `${NUM("fightphase")} !== ${phase}`);
          continue;
        }
        if (phase === 1) {
          shots += await f.walker(c, target, { x: 6, z: 7, view: "south" }, `!(${ALIVE(target)}) || ${NUM("fightphase")} > 1`, budget);
          continue;
        }
        if (!(await d.evaluate<boolean>(armed(target)))) {
          // stand in cover and give the street back to them until every living man has his corner
          const changed = `${NUM("fightphase")} !== ${phase}`;
          await f.walk(c, COVER[phase], changed);
          const allArmed = GANG.map((who) => `(!(${ALIVE(who)}) || ${armed(who)})`).join(" && ");
          await f.lookAway(c, `(${allArmed}) || ${changed}`, 20);
          if ((await phaseNow()) !== phase) continue;
        }
        const cells = STATIONS[phase][target];
        const done = `!(${ALIVE(target)}) || ${NUM("fightphase")} > 3`;
        let at = 0;
        await f.walk(c, cells[0], done);
        shots += await f.shootOut(c, done, async (blind) => {
          if (!(await d.evaluate<boolean>(armed(target)))) {
            await turn(c); // letting him take his position
            return;
          }
          if (blind % 12 === 11) {
            at++;
            await f.walk(c, cells[at % cells.length], done);
            return;
          }
          if (!(await d.evaluate<boolean>(ON_SCREEN(target)))) {
            await turn(c);
            return;
          }
          await d.sleep(70);
        }, budget, ON_SCREEN(target));
      }
      await d.hold(`${NUM("fightphase")} === 4 && ${NUM("phase")} === 3`, "the last of the gang and closefight ()", budget);
      const death = await d.evaluate<string>(`String(window.dbg.session.interp.globals.get("playerdeath") ?? "")`);
      if (death) throw new Error(`the gang won: playerdeath = "${death}"`);
      await reload(c, budget);
      await gunToggle(c, false, budget);
      c.say(`the gang down three times in ${shots} shots, ${await d.evaluate<number>(NUM("playerhits"))} hits taken of 30`);
    },
  };
}
