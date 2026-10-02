/**
 * LUNICUS.SCO's key table at its edges (`src/game/sco.ts`), and a broken
 * file met as the EXE met none: with the defaults.
 *
 *   npx vitest run lunicus/tests/sco.ts
 *
 * The machine suite `tests/machine/scores.ts` plays the Keys dialog with
 * letters; what it never types:
 *
 *   - **a digit**: the dialog shows an action's first letter, else its first
 *     digit (0x417ead), else nothing — so a table that binds only "5" to
 *     Bullets shows "5", and one that binds Rockets to nothing shows "";
 *   - **a lowercase field**: OK binds the letter in both cases (0x418db1);
 *   - **a file of the wrong size**: the page hands in whatever it kept; the
 *     game says so in its log and plays on the defaults rather than not
 *     starting.
 *
 * No rip: nothing here ticks a game.
 */
import { test, expect } from "vitest";
import { Lunicus } from "../src/game/game";
import { ACTIONS, SCO_SIZE, actionOf, bindKeys, defaultSco, keyFor, writeSco } from "../src/game/sco";

test("the Keys dialog shows a digit when an action has no letter, and nothing when it has no key", () => {
  const t = bindKeys(["W", "A", "D", "H", "5", "G", ""]);
  expect(keyFor(t, 5)).toBe("5");
  expect(actionOf(t, "5")).toBe(5);
  // the empty field bound character 0 — no key the dialog shows
  expect(keyFor(t, 7)).toBe("");
  expect(ACTIONS.map((_, i) => keyFor(t, i + 1)).join(",")).toBe("W,A,D,H,5,G,");
});

test("OK binds a lowercase field in both cases, and the arrows stay forward, left and right", () => {
  const t = bindKeys(["i", "j", "l", "n", "b", "g", "r"]);
  expect([actionOf(t, "i"), actionOf(t, "I"), actionOf(t, "w")]).toEqual([1, 1, 0]);
  expect(keyFor(t, 1)).toBe("I");
  expect([actionOf(t, "ArrowUp"), actionOf(t, "ArrowLeft"), actionOf(t, "ArrowRight"), actionOf(t, "ArrowDown")]).toEqual([1, 2, 3, 0]);
});

test("a kept LUNICUS.SCO of the wrong size is logged and the game plays on the defaults", () => {
  const logs: string[] = [];
  const g = new Lunicus({ has: () => false, get: () => null, want: () => {} }, { draws: false, sco: new Uint8Array(SCO_SIZE - 1), log: (l) => logs.push(l) });
  expect(logs).toEqual([`lunicus.sco: Error: lunicus.sco is ${SCO_SIZE - 1} bytes, not ${SCO_SIZE}; the defaults instead`]);
  expect(writeSco(g.m.sco)).toEqual(writeSco(defaultSco()));
  expect(g.m.action("w")).toBe(1);
});

test("a kept LUNICUS.SCO of the right size is the game's key table", () => {
  const sco = defaultSco();
  sco.keys = bindKeys(["I", "J", "L", "N", "B", "G", "R"]);
  sco.scores[1][0] = { score: 4321, name: "Tester" };
  const g = new Lunicus({ has: () => false, get: () => null, want: () => {} }, { draws: false, sco: writeSco(sco) });
  expect([g.m.action("i"), g.m.action("w")]).toEqual([1, 0]);
  expect(g.m.sco.scores[1][0]).toEqual({ score: 4321, name: "Tester" });
});
