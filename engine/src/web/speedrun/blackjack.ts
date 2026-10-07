/**
 * How a speedrun verb plays a hand of blackjack: Titanic's
 * (taoot/src/speedrun/blackjack.ts, #487) and Dust's
 * (dust/src/speedrun/blackjack.ts, #490). Both games deal the same deck the
 * same way, and the strategy is the one #487 proposed.
 *
 * A soft hand (an ace counted 11, `playeraceten`) hits to 17, stays from 19
 * and on 18 hits only against a 9, a 10 or an ace. A hard hand hits to 11,
 * stays from 17, and in between hits only against a 7 or more. `lose` hits
 * until it busts.
 */

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
