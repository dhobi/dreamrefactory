/**
 * One hand of Mez's poker, and up from the table.
 *
 * One verb for the same reason as {@link BLACKJACK}: the play is a loop a sheet
 * cannot write — answer whichever plaque the table puts up, by what is on it.
 * What the route wants from the table on day 3's night is ONE HAND PLAYED: the
 * three `winner ()` handlers (`MEZ.PUP/0058`, `PETE.PUP/0076`, `ZEB.PUP/0074`)
 * all move `phase` 1 → 2, and `phase` is what the night counts. A win also puts
 * the Thunderbird in the hand; a loss leaves it with Mez, who gives it up after
 * the bounty hunters (`MEZ.PUP/0007 afterbounty`). So the verb plays a hand and
 * says which, and the sheet does not care.
 *
 * Which menu is up is read off the reply IDS, because the numbers overlap and
 * the words do not (the playthrough's rung `d3e003` found this out): only
 * `raisebet ()` offers 105, only `mainbet ()` offers 103 and 104 together, and
 * `wanttoplay ()` and `anteup ()` are the two-reply ones, 101 and 102. The raise
 * goes in on the first betting round only (`playerphase` 1) and is $40 — over
 * every fold threshold Pete and Mez have under a hand of 400 — so the others
 * fold where they can; after that, matching takes the hand to its showdown.
 * Between plaques the table's `continue` button (`SALGAMES.PRP/0694`, drawn at
 * 200,325 by `newgame ()`) deals on.
 */
import {
  clickThing,
  converse,
  menuLoad,
  menuSave,
  TALK_STATE,
  type Action,
  type ActionContext,
} from "@dreamfactory/speedrun/action";
import { PANEL } from "./menu";

const G = (name: string): string => `window.dbg.session.interp.globals.get(${JSON.stringify(name)})`;
const NUM = (name: string): string => `Number(${G(name)} ?? 0)`;
const AT_TABLE = `/salgames/i.test(String(window.dbg.session.stageName || ""))`;
const CHOOSING = `!!(window.dbg.viewer && window.dbg.viewer.awaitingChoice)`;
const CONTINUE = `(() => {
  const i = window.dbg.session.interp, f = i.builtins.get("propvisible");
  return !!f && Number(f(i, ["continue"])) === 1;
})()`;
/**
 * the hand is played (and "I quit." said at the next ante, which is what takes
 * the player up from the table). Not `quitpoker`: SALGAMES.FLT's betting loop
 * leaves by `dumpglobal ... quitpoker` on one of its exits, so once the table
 * is gone it can read 0 whichever way the player got up.
 */
const DONE = `${NUM("phase")} >= 2`;

interface Plaque {
  choices: { id: number; text: string }[];
  rects: { x: number; y: number }[];
}

/** the reply to give to the plaque that is up, by its ids */
function replyTo(ids: number[], phase: number, round: number, raised: number): number {
  const has = (id: number): boolean => ids.includes(id);
  if (has(105)) return raised < 8 && has(103) ? 103 : 105; // raisebet (): $5 at a time, then "Do Raise"
  if (has(103) && has(104)) return round === 1 ? 102 : 101; // mainbet (): "Raise bet" / "Match bet"
  if (ids.length === 2 && has(101) && has(102)) return phase < 2 ? 101 : 102; // "Yes." / "Add $1." — then "I quit."
  throw new Error(`nothing to answer on the poker plaque: ${ids.join(",")}`);
}

async function answer(c: ActionContext, budget: number, raised: number): Promise<number> {
  const { d } = c;
  const p = await d.evaluate<Plaque>(TALK_STATE);
  const ids = (p.choices ?? []).map((ch) => ch.id);
  const phase = await d.evaluate<number>(NUM("phase"));
  const round = await d.evaluate<number>(NUM("playerphase"));
  const id = replyTo(ids, phase, round, raised);
  const at = (p.rects ?? [])[ids.indexOf(id)];
  if (!at) throw new Error(`no rectangle for poker reply ${id}`);
  const shown = JSON.stringify((p.choices ?? []).map((ch) => ch.text));
  await d.clickAt(at.x, at.y, "none", budget);
  // taken: the plaque gone, or redrawn different — the raise menu asks again
  // at once with the new amount in its words
  await d.hold(
    `!(${CHOOSING}) || JSON.stringify(((window.dbg.viewer.choices) || []).map((c) => c.text)) !== ${JSON.stringify(shown)}`,
    `poker reply ${id} to be taken`,
    budget,
  );
  if (id === 103 && ids.includes(105)) return raised + 1;
  return id === 105 ? 0 : raised;
}

const OWNS_TBIRD = `(() => { const i = window.dbg.session.interp; return String(i.builtins.get("propowner")(i, ["tbird"])).toLowerCase() === "stranger"; })()`;

export const POKER: Action = {
  args: [0, 0],
  once: true,
  wait: "none",
  opts: ["max"],
  sig: "poker()",
  help:
    "win a hand at Mez's table in the saloon, from where the gamblers are clickable, and get up again — " +
    "the Thunderbird, and the night's phase 2; saves before and loads to retry a lost hand, through the horn's panel; max: hands",
  run: async (c) => {
    const { d } = c;
    const budget = Math.max(c.budget, 60_000);
    const max = Number(c.step.opts.max ?? 20);
    if ((await d.evaluate<boolean>(DONE)) && (await d.evaluate<boolean>(OWNS_TBIRD))) {
      c.say(`the Thunderbird is already won`);
      return;
    }
    const panel = { ...c, budget };
    const retry = await menuSave(panel, PANEL);
    for (let hand = 1; hand <= max; hand++) {
      await playOne(c, budget);
      if (await d.evaluate<boolean>(OWNS_TBIRD)) {
        c.say(`won the Thunderbird on hand ${hand}`);
        return;
      }
      c.say(`hand ${hand} lost — loading`);
      await menuLoad(panel, PANEL, retry);
    }
    throw new Error(`${max} hands and Mez still has the Thunderbird`);
  },
};

/** sit down, play one hand, and get up */
async function playOne(c: ActionContext, budget: number): Promise<void> {
  const { d } = c;
  {
    await clickThing(c, "gamblers", "none");
    await d.hold(`${AT_TABLE} || !!window.dbg.session.puppet`, "the poker table", budget);
    let raised = 0;
    for (let step = 0; step < 400; step++) {
      if (await d.evaluate<boolean>(`${DONE} && !(${AT_TABLE}) && !window.dbg.session.puppet && !window.dbg.session.scriptBusy`)) break;
      if (await d.evaluate<boolean>(CHOOSING)) {
        raised = await answer(c, budget, raised);
        continue;
      }
      if (await d.evaluate<boolean>(`!!window.dbg.session.puppet`)) {
        // somebody at the table talking: their lines, up to the next plaque
        await converse({ ...c, budget, say: () => {} }, [], "stop", "stop");
        continue;
      }
      if (await d.evaluate<boolean>(`${AT_TABLE} && ${CONTINUE} && !window.dbg.session.scriptBusy`)) {
        await d.clickAt(200, 325, "none", budget);
        continue;
      }
      await d.sleep(50);
    }
    if (!(await d.evaluate<boolean>(DONE))) throw new Error(`the hand was never played — phase is ${await d.evaluate<number>(NUM("phase"))}`);
    await d.settle("quiet", "the saloon after the table", budget);
  }
}
