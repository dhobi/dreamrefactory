/**
 * `blackjack(800)`: Jan's table in the Hard Drive Saloon, played until the cash
 * in hand is at least that much (#490).
 *
 * One verb because the play is a loop a sheet cannot write — "bet, look at the
 * cards, hit or stay, and if the hand went the wrong way go back and play it
 * again" — and a sheet does not branch. What it may look at is what a player
 * at the table sees, and nothing else:
 *
 *   - its own cards, the first face down until SEECARD is held (SALGAMES.FLT's
 *     `seecard` button flips `playerdowncard` while the mouse is down), so it
 *     is pressed once a hand before anything is decided;
 *   - the dealer's face-up card, the fourth card dealt: `dealcards ()` goes
 *     player, dealer, player, dealer, and `take ()` turns only each side's
 *     first card face down.
 *
 * Never `dealerdowncard`, `dealertotal` or `cardstring` (the deck in order).
 * The strategy is #487's (engine/src/web/speedrun/blackjack.ts).
 *
 * WHAT THE GAME DOES ITSELF, from SALGAMES.FLT and JAN.PUP:
 *
 *   - There is no table limit. Jan's bet plaque adds $1, $5 or $10 a press, as
 *     often as the cash allows (`drawbetbevel ()`), so the verb bets what is
 *     still missing — `min(cash, target - cash)` — in tens, then fives, then
 *     ones. The odds of a hand do not depend on the bet, so this takes as many
 *     hands as betting everything, in fewer presses, and never overshoots.
 *   - Each hand ends back at the bet plaque, with the bet already settled
 *     (`checktotals ()`, `dealerdraw ()`): a win pays even money, a blackjack
 *     3:2, a draw returns the bet. So a draw is bet again at the table.
 *   - Broke, Jan ends the game himself (`mainbetbj ()`, `playercash = 0`).
 *   - A lost hand cannot be undone in the game, so the verb saves before it
 *     sits down and loads to try again — and saves again after every hand that
 *     won, so a loss only ever costs the one hand. That means getting up after
 *     a win (Quit blackjack.), because the control panel is not there while
 *     the cards are, and sitting down again, which plays Jan's greeting.
 *   - The deck is shuffled every time you sit down (`initgame ()` sets
 *     `usedcount = 52`, which `newgame ()` takes as "time for a new deck"), and
 *     the load does not re-seed — DF.EXE's never did — so a retry is dealt new
 *     cards.
 */
import { cardValue, hitOrStay } from "@dreamfactory/engine/web/speedrun/blackjack";
import { CORE_ACTIONS } from "@dreamfactory/engine/web/speedrun/actions-core";
import {
  clickThing,
  converse,
  loadPoint,
  TALK_STATE,
  type Action,
  type ActionContext,
} from "@dreamfactory/engine/web/speedrun/action";

/** the load point the verb keeps for itself, written before every sitting */
const RETRY = "blackjack retry";
/** hands the verb plays before it gives up (`max:`) */
const MAX_HANDS = 100;
/** the game's verdict on a hand, as the report says it */
const VERDICT: Record<string, string> = { draw: "a draw", player: "won", dealer: "lost" };
/** Jan's bet plaque */
const ADD = [10, 5, 1] as const;
const PLACE = 111;
const QUIT = 112;

const G = (name: string): string => `window.dbg.session.interp.globals.get(${JSON.stringify(name)})`;
const CASH = `Number(${G("playercash")} ?? 0)`;
/** the cards are on: SALGAMES.FLT is the stage, not the town's NEW.FLT */
const AT_TABLE = `/salgames/i.test(String(window.dbg.session.stageName || ""))`;
const IDLE = `!window.dbg.session.scriptBusy`;
/** Jan is asking something and waiting for the answer */
const CHOOSING = `!!(window.dbg.viewer && window.dbg.viewer.awaitingChoice)`;

/** what the player sees of the hand */
const HAND = `(() => {
  const g = (n) => window.dbg.session.interp.globals.get(n);
  return {
    winner: String(g("winner") ?? ""),
    total: Number(g("playertotal") ?? 0),
    soft: Number(g("playeraceten") ?? 0) > 0,
    count: Number(g("playercount") ?? 0),
    dealt: String(g("usedstring") ?? "").trim().split(" ").pop() || "",
  };
})()`;
type Hand = { winner: string; total: number; soft: boolean; count: number; dealt: string };

interface Plaque {
  choices: { id: number }[];
  rects: { x: number; y: number }[];
}

/** press one of the table's buttons (hit, stay, seecard) */
async function press(c: ActionContext, button: string, budget: number): Promise<void> {
  const at = await c.d.aim("thing", button);
  if (!at) throw new Error(`the table's ${button} button is not there`);
  await c.d.clickAt(at.x, at.y, "none", budget);
}

/**
 * Answer Jan's bet plaque with one bevel, and wait for the script to have taken
 * it. Not `converse`: the plaque is redrawn and asked again on the same pass
 * after each $ press, so "the plaque went away" never happens to be seen.
 */
async function bevel(c: ActionContext, id: number, taken: string, budget: number): Promise<void> {
  const { d } = c;
  await d.hold(CHOOSING, "Jan's bet plaque", budget);
  const p = await d.evaluate<Plaque>(TALK_STATE);
  const i = (p.choices ?? []).findIndex((ch) => ch.id === id);
  const at = (p.rects ?? [])[i];
  if (i < 0 || !at) throw new Error(`Jan's plaque does not offer ${id}`);
  await d.clickAt(at.x, at.y, "none", budget);
  await d.hold(taken, `Jan to take ${id}`, budget);
}

/** put `amount` on the table and have the cards dealt */
async function bet(c: ActionContext, amount: number, budget: number): Promise<void> {
  let left = amount;
  for (const step of ADD) {
    while (left >= step) {
      const was = await c.d.evaluate<number>(`Number(${G("playerbet")} ?? 0)`);
      await bevel(c, 100 + step, `Number(${G("playerbet")} ?? 0) !== ${was}`, budget);
      left -= step;
    }
  }
  await bevel(c, PLACE, `!(${CHOOSING})`, budget);
}

/**
 * Play the hand in front of the player to its end: SEECARD, then hit or stay
 * until the game names a winner. The game's verdict, "player", "dealer" or
 * "draw".
 */
async function playHand(c: ActionContext, budget: number): Promise<string> {
  const { d } = c;
  await d.hold(`${G("playerphase")} === 1 && ${IDLE}`, "the cards to be dealt", budget);
  let t = await d.evaluate<Hand>(HAND);
  if (t.winner) return t.winner; // a natural on the deal: the game settled it there
  const up = cardValue(t.dealt);
  await press(c, "seecard", budget);
  await d.hold(IDLE, "the face-down card to be looked at", budget);
  for (;;) {
    t = await d.evaluate<Hand>(HAND);
    if (t.winner) return t.winner;
    const move = hitOrStay("win", t.total, t.soft, up);
    await press(c, move, budget);
    if (move === "stay") {
      await d.hold(`${G("winner")} !== "" && ${IDLE}`, "the dealer to play out", budget);
      return d.evaluate<string>(`String(${G("winner")})`);
    }
    await d.hold(`(${G("playercount")} > ${t.count} || ${G("winner")} !== "") && ${IDLE}`, "the card to be dealt", budget);
  }
}

/** after a hand: Jan's bet plaque, or the room if he sent us away broke */
async function backToJan(c: ActionContext, budget: number): Promise<boolean> {
  const { d } = c;
  await d.hold(`!!window.dbg.session.puppet || !(${AT_TABLE})`, "Jan, or the room", budget);
  await converse({ ...c, budget, say: () => {} }, [], "stop", "stop");
  return d.evaluate<boolean>(`${AT_TABLE} && ${CHOOSING}`);
}

/** from Jan's bet plaque back to the saloon */
async function getUp(c: ActionContext, budget: number): Promise<void> {
  await bevel(c, QUIT, `!(${CHOOSING})`, budget);
  await c.d.hold(`!(${AT_TABLE})`, "the saloon after the table", budget);
  await c.d.settle("quiet", "the saloon after the table", budget);
}

/** from the saloon to Jan's bet plaque */
async function sitDown(c: ActionContext, budget: number): Promise<void> {
  await clickThing(c, "blackjack", "none");
  await c.d.hold(`!!window.dbg.session.puppet`, "Jan to greet you", budget);
  await converse({ ...c, budget, say: () => {} }, [101], "stop", "stop"); // "Sure."
  if (!(await backToJan(c, budget))) throw new Error(`Jan did not take a bet`);
}

const save = (c: ActionContext): Promise<void> =>
  CORE_ACTIONS.save.run({ ...c, step: { ...c.step, args: [RETRY], opts: {} }, wait: "quiet", say: () => {} });

export const BLACKJACK: Action = {
  args: [1, 1],
  once: true,
  wait: "none",
  opts: ["max"],
  sig: "blackjack(800)",
  help:
    "play Jan's table in the saloon until the cash in hand is at least that much, from where the table is clickable — " +
    "bets what is still missing, saves after each win and loads to retry a loss; max: hands",
  run: async (c) => {
    const { d } = c;
    const target = Number(c.step.args[0].replace(/^\$/, ""));
    if (!Number.isInteger(target) || target < 1) throw new Error(`blackjack(800) wants a whole number of dollars, not "${c.step.args[0]}"`);
    const max = Number(c.step.opts.max ?? MAX_HANDS);
    if (!Number.isInteger(max) || max < 1) throw new Error(`max: needs a whole number of hands, not "${c.step.opts.max}"`);
    const budget = Math.max(c.budget, 60_000);

    let cash = await d.evaluate<number>(CASH);
    if (cash >= target) {
      c.say(`already $${cash}`);
      return;
    }
    if (cash <= 0) throw new Error(`no cash to bet`);
    if (!(await d.aim("thing", "blackjack"))) throw new Error(`the blackjack table is not clickable from here`);

    await save(c);
    await sitDown(c, budget);
    let loads = 0;
    for (let hand = 1; hand <= max; hand++) {
      const before = cash;
      await bet(c, Math.min(cash, target - cash), budget);
      const winner = await playHand(c, budget);
      const seated = await backToJan(c, budget);
      cash = await d.evaluate<number>(CASH);
      c.say(`hand ${hand}: ${VERDICT[winner] ?? winner}, $${before} → $${cash}`);
      if (cash >= target) {
        if (seated) await getUp(c, budget);
        c.say(`$${cash} on hand ${hand}` + (loads ? `, after ${loads} load(s)` : ""));
        return;
      }
      if (cash === before && seated) continue; // a draw: bet again
      if (seated) await getUp(c, budget);
      if (cash > before) {
        await save(c);
      } else {
        await loadPoint({ ...c, budget, say: () => {} }, RETRY, { reseed: false });
        loads++;
        cash = await d.evaluate<number>(CASH);
      }
      await sitDown(c, budget);
    }
    throw new Error(`${max} hands and still $${cash} of $${target}`);
  },
};
