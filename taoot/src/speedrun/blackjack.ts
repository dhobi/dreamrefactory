/**
 * `blackjack(win, bet: rubaiyat)`: Mission 4's game with Buick for his boat
 * pass, played to the outcome a route needs (#487).
 *
 * One verb because the play is a loop a sheet cannot write: a sheet does not
 * branch, and this is "look at the cards, hit or stay, and if the hand went the
 * wrong way go back and play it again". What it may look at is what a player
 * at the table sees, and nothing else:
 *
 *   - its own two cards, the first face down until SHOW is held
 *     (BLKJACK.STG's show button flips `playerdowncard` while the mouse is
 *     down), so SHOW is pressed once a hand before anything is decided;
 *   - the dealer's face-up card, the fourth card dealt: `dealcards ()` goes
 *     player, dealer, player, dealer, and `take ()` turns only each side's
 *     first card face down.
 *
 * Never `dealerdowncard`, `dealertotal` or `cardstring` (the deck in order).
 *
 * WHAT THE GAME DOES ITSELF, from BLKJACK2.PUP and BLKJACK.STG:
 *
 *   - Each hand ends at Buick's play-again plaque (`playagain ()`), and the bet
 *     is settled BEFORE it: `playerwin ()` hands Frank the item and the pass,
 *     `buickwin ()` gives Buick both, `draw ()` gives the item back and the
 *     pass to Buick.
 *   - So a draw is replayed at the table: "Ja" (101), then the same bet.
 *   - A hand that went the wrong way cannot be undone in the game, so the verb
 *     saves before it walks up to the table and loads to try again. The load
 *     does not re-seed: TI.EXE's never does, and a re-seeded retry would be
 *     dealt the same cards forever.
 *   - Walking up costs two minutes of the sinking clock (`min = min + 2` in
 *     the table's `mousedown`); the load gives them back, as it would a player.
 *
 * The strategy is the one #487 proposed. A soft hand (an ace counted 11,
 * `playeraceten`) hits to 17, stays from 19 and on 18 hits only against a 9,
 * a 10 or an ace. A hard hand hits to 11, stays from 17, and in between hits
 * only against a 7 or more. `lose` hits until it busts.
 */
import { CORE_ACTIONS } from "@dreamfactory/engine/web/speedrun/actions-core";
import {
  clickThing,
  converse,
  loadPoint,
  predicate,
  type Action,
  type ActionContext,
} from "@dreamfactory/engine/web/speedrun/action";

/** what each bet is called in the game, and its bevel on Buick's bet plaque */
const BETS: Record<string, number> = { realneck: 102, rubaiyat: 103 };
/** the load point the verb keeps for itself, written each time the verb starts */
const RETRY = "blackjack retry";
/** hands the verb plays before it gives up (`max:`) */
const MAX_HANDS = 20;
/** the game's verdict on a hand, as the report says it */
const VERDICT: Record<string, string> = { draw: "a draw", player: "Frank won", dealer: "Buick won" };

/** one card's value as a player reads it: an ace is 11, a face card 10 */
export function cardValue(card: string): number {
  const rank = card.slice(0, -1).toLowerCase();
  if (rank === "a") return 11;
  if (rank === "j" || rank === "q" || rank === "k") return 10;
  return Number(rank);
}

/** hit or stay, from what the player can see */
export function hitOrStay(goal: "win" | "lose", total: number, soft: boolean, up: number): "hit" | "stay" {
  if (goal === "lose") return "hit";
  if (soft) {
    if (total <= 17) return "hit";
    if (total >= 19) return "stay";
    return up >= 9 ? "hit" : "stay";
  }
  if (total <= 11) return "hit";
  if (total >= 17) return "stay";
  return up >= 7 ? "hit" : "stay";
}

/** the table's state, all of it read off globals BLKJACK.STG writes */
const TABLE = `(() => {
  const s = window.dbg.session, g = (n) => s.interp.globals.get(n);
  return {
    phase: Number(g("playerphase") ?? 0),
    winner: String(g("winner") ?? ""),
    total: Number(g("playertotal") ?? 0),
    soft: Number(g("playeraceten") ?? 0) > 0,
    count: Number(g("playercount") ?? 0),
    dealt: String(g("usedstring") ?? "").trim().split(" ").pop() || "",
    busy: !!s.scriptBusy,
  };
})()`;
type Table = { phase: number; winner: string; total: number; soft: boolean; count: number; dealt: string; busy: boolean };

const G = (name: string): string => `window.dbg.session.interp.globals.get(${JSON.stringify(name)})`;
const owner = (prop: string): string =>
  `String((window.dbg.session.propRuntime.props.get(${JSON.stringify(prop)}) || {}).owner ?? "")`;

/** press one of the stage's buttons (hit, stay, show) */
async function press(c: ActionContext, button: string, budget: number): Promise<void> {
  const at = await c.d.aim("thing", button);
  if (!at) throw new Error(`the table's ${button} button is not there`);
  await c.d.clickAt(at.x, at.y, "none", budget);
}

/**
 * Play the hand in front of the player to its end: SHOW, then hit or stay until
 * the game names a winner. The game's verdict, "player", "dealer" or "draw".
 */
async function playHand(c: ActionContext, goal: "win" | "lose", budget: number): Promise<string> {
  const { d } = c;
  await d.hold(`${G("playerphase")} === 1 && !window.dbg.session.scriptBusy`, "the cards to be dealt", budget);
  let t = await d.evaluate<Table>(TABLE);
  if (t.winner) return t.winner; // a natural on the deal: the game settled it there
  const up = cardValue(t.dealt);
  await press(c, "show", budget);
  await d.hold(`!window.dbg.session.scriptBusy`, "the face-down card to be looked at", budget);
  for (;;) {
    t = await d.evaluate<Table>(TABLE);
    if (t.winner) return t.winner;
    const move = hitOrStay(goal, t.total, t.soft, up);
    await press(c, move, budget);
    if (move === "stay") {
      await d.hold(`${G("winner")} !== "" && !window.dbg.session.scriptBusy`, "the dealer to play out", budget);
      return d.evaluate<string>(`String(${G("winner")})`);
    }
    await d.hold(
      `(${G("playercount")} > ${t.count} || ${G("winner")} !== "") && !window.dbg.session.scriptBusy`,
      "the card to be dealt",
      budget,
    );
  }
}

export const BLACKJACK: Action = {
  args: [1, 1],
  once: true,
  wait: "none",
  opts: ["bet", "max"],
  sig: "blackjack(win, bet: rubaiyat)",
  help:
    "Mission 4: play Buick for the boat pass until you win it (win) or lose the bet (lose), from where the table is clickable — " +
    "bet: rubaiyat or realneck; it loads its own save to try again",
  run: async (c) => {
    const { d } = c;
    const goal = c.step.args[0].toLowerCase();
    if (goal !== "win" && goal !== "lose") throw new Error(`blackjack(win) or blackjack(lose), not "${c.step.args[0]}"`);
    const max = Number(c.step.opts.max ?? MAX_HANDS);
    if (!Number.isInteger(max) || max < 1) throw new Error(`max: needs a whole number of hands, not "${c.step.opts.max}"`);
    const budget = Math.max(c.budget, 60_000);

    if ((await d.evaluate<number>(`Number(${G("mission")})`)) !== 4) {
      throw new Error(`blackjack is Mission 4's game for the boat pass`);
    }
    if ((await d.evaluate<string>(owner("boatpass"))) !== "buick") throw new Error(`Buick does not have the boat pass to play for`);
    const owned = Object.keys(BETS);
    const ours: string[] = [];
    for (const p of owned) if ((await d.evaluate<string>(owner(p))) === "frank") ours.push(p);
    const bet = (c.step.opts.bet ?? (ours.length === 1 ? ours[0] : "")).toLowerCase();
    if (!bet) throw new Error(ours.length ? `bet: ${ours.join(" or ")}?` : `Frank has nothing Buick will play for (${owned.join(", ")})`);
    if (!(bet in BETS)) throw new Error(`bet: ${owned.join(" or ")}, not "${bet}"`);
    if (!ours.includes(bet)) throw new Error(`Frank does not have the ${bet}`);
    if (!(await d.aim("thing", "blkjacktable"))) throw new Error(`the blackjack table is not clickable from here`);

    await CORE_ACTIONS.save.run({ ...c, step: { ...c.step, args: [RETRY], opts: {} }, wait: "quiet", say: () => {} });
    const done = goal === "win" ? `${owner("boatpass")} === "frank" && ${owner(bet)} === "frank"` : `${owner(bet)} === "buick"`;
    const plaque = { ...c, budget };
    const goalDone = goal === "win" ? "won the boat pass" : `lost the ${bet}`;
    const goalMissed = goal === "win" ? "lost the boat pass" : `took the ${bet}`;
    let loads = 0;
    let atTable = false;
    for (let hand = 1; hand <= max; hand++) {
      if (!atTable) {
        await clickThing(c, "blkjacktable", "none");
        await d.hold(predicate("talking"), "Buick to answer", budget);
        await converse(plaque, [101, BETS[bet]], "stop");
        atTable = true;
      }
      const winner = await playHand(c, goal, budget);
      c.say(`hand ${hand}: ${VERDICT[winner] ?? "Buick won"}`);
      await d.hold(predicate("choosing"), "Buick's play-again plaque", budget);
      if (await d.evaluate<boolean>(done)) {
        await converse(plaque, [102], "stop");
        await d.settle("quiet", "the room after the table", budget);
        c.say(`${goalDone} on hand ${hand}` + (loads ? `, after ${loads} load(s)` : ""));
        return;
      }
      if (winner === "draw") {
        await converse(plaque, [101, BETS[bet]], "stop");
        continue;
      }
      // the wrong way: leave the table and go back to before it
      await converse(plaque, [102], "stop");
      await d.settle("quiet", "the room after the table", budget);
      await loadPoint(plaque, RETRY, { reseed: false });
      loads++;
      atTable = false;
    }
    throw new Error(`${max} hands and Buick never ${goalMissed}`);
  },
};
