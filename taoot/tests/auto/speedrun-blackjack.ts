/**
 * The decisions behind `blackjack` (engine/src/web/speedrun/blackjack.ts):
 * a card read the way a player reads it, and hit or stay from what a player sees.
 */
import { expect, test } from "vitest";
import { cardValue, hitOrStay } from "@dreamfactory/engine/web/speedrun/blackjack";

test("a card is worth what it shows; an ace up is 11", () => {
  expect(["2h", "9s", "10d", "jc", "qh", "ks", "ad"].map(cardValue)).toEqual([2, 9, 10, 10, 10, 10, 11]);
});

test("a hard hand hits to 11, stays from 17, and between them hits only against a 7 or more", () => {
  expect(hitOrStay("win", 11, false, 2)).toBe("hit");
  expect(hitOrStay("win", 17, false, 11)).toBe("stay");
  expect(hitOrStay("win", 14, false, 6)).toBe("stay");
  expect(hitOrStay("win", 14, false, 7)).toBe("hit");
});

test("a soft hand hits to 17, stays from 19, and on 18 hits only against a 9 or more", () => {
  expect(hitOrStay("win", 17, true, 2)).toBe("hit");
  expect(hitOrStay("win", 19, true, 11)).toBe("stay");
  expect(hitOrStay("win", 18, true, 8)).toBe("stay");
  expect(hitOrStay("win", 18, true, 9)).toBe("hit");
});

test("losing hits whatever the cards", () => {
  expect(hitOrStay("lose", 20, false, 2)).toBe("hit");
  expect(hitOrStay("lose", 19, true, 11)).toBe("hit");
});
