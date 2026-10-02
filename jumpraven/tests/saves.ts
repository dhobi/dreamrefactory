/**
 * The page's kind of saved game (src/saves.ts): what the shared saved-games
 * dialog keeps for Jump Raven, and which files it lets through as `.RVN`s
 * (src/game/rvn.ts `isRvn`).
 *
 *   npx vitest run jumpraven/tests/saves.ts
 *
 * The dialog shows a player's own files, which can be anything; one the game
 * cannot hold must be turned away before File ▸ Open hands it in. A file is
 * taken when it is 0x94 bytes and its fields are ones a game could have
 * written: difficulty 1 to 4, level 0 to 8, pilot 0 to 5, each tier 0 to 3.
 */
import { expect, test } from "vitest";
import { JUMPRAVEN_SAVES } from "../src/saves";
import { RVN_SIZE, writeRvn, type SavedGame } from "../src/game/rvn";
import { newRecords, startGame } from "../src/game/records";

/** a game as the HUD's SAVE writes it: day two's flight on Advanced */
const game = (change: (s: SavedGame) => void = () => {}): Uint8Array => {
  const records = newRecords();
  startGame(records);
  const s: SavedGame = { difficulty: 3, level: 5, pilot: 2, band: 1, records };
  change(s);
  return writeRvn(s);
};

test("the dialog keeps Jump Raven's files as .rvn, in one folder of their own", () => {
  expect(JUMPRAVEN_SAVES.game).toBe("Jump Raven");
  expect(JUMPRAVEN_SAVES.ext).toBe(".rvn");
  expect(JUMPRAVEN_SAVES.db).toBe("jumpraven-saves");
  expect(JUMPRAVEN_SAVES.order).toEqual([""]);
  expect(JUMPRAVEN_SAVES.folders[""]).toBe("My Saves");
});

test("a save the game wrote is taken, at every difficulty, level and pilot it can have", () => {
  expect(JUMPRAVEN_SAVES.valid(game())).toBe(true);
  for (const difficulty of [1, 4]) expect(JUMPRAVEN_SAVES.valid(game((s) => (s.difficulty = difficulty)))).toBe(true);
  for (const level of [0, 8]) expect(JUMPRAVEN_SAVES.valid(game((s) => (s.level = level)))).toBe(true);
  for (const pilot of [0, 5]) expect(JUMPRAVEN_SAVES.valid(game((s) => (s.pilot = pilot)))).toBe(true);
  expect(JUMPRAVEN_SAVES.valid(game((s) => (s.records.tier = [3, 3, 3, 3, 3, 3])))).toBe(true);
});

test("a file of another size is turned away", () => {
  const bytes = game();
  expect(JUMPRAVEN_SAVES.valid(bytes.subarray(0, RVN_SIZE - 1))).toBe(false);
  expect(JUMPRAVEN_SAVES.valid(new Uint8Array(RVN_SIZE + 1))).toBe(false);
  expect(JUMPRAVEN_SAVES.valid(new Uint8Array(0))).toBe(false);
});

test("a file of the size with fields no game holds is turned away", () => {
  // all zeroes: difficulty 0
  expect(JUMPRAVEN_SAVES.valid(new Uint8Array(RVN_SIZE))).toBe(false);
  expect(JUMPRAVEN_SAVES.valid(game((s) => (s.difficulty = 5)))).toBe(false);
  expect(JUMPRAVEN_SAVES.valid(game((s) => (s.level = 9)))).toBe(false);
  expect(JUMPRAVEN_SAVES.valid(game((s) => (s.level = -1)))).toBe(false);
  expect(JUMPRAVEN_SAVES.valid(game((s) => (s.pilot = 6)))).toBe(false);
  expect(JUMPRAVEN_SAVES.valid(game((s) => (s.records.tier = [0, 0, 4, 0, 0, 0])))).toBe(false);
  expect(JUMPRAVEN_SAVES.valid(game((s) => (s.records.tier = [0, 0, 0, 0, 0, -1])))).toBe(false);
});
