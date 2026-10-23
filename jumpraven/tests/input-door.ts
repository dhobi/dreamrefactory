/**
 * The player's door into the machine (`src/game/input.ts`), on a stand-in
 * game: what reaches the machine's events and what does not.
 *
 *   npx vitest run jumpraven/tests/input-door.ts
 *
 *   - a release with no press of the game's before it is not the game's
 *   - Esc, and the site's escape key (`.`) as Esc, are always taken; in flight
 *     a key the key table gives an action is taken too, and any other is not
 *   - Ctrl (⌘) keys go to the game's key filter, not the events
 *
 * No rip: nothing here reads a game file.
 */
import { expect, test } from "vitest";
import { ESCAPE_KEY } from "@dreamfactory/engine/web/keys";
import { ESCAPE } from "@dreamfactory/engine/v0/film";
import { Input } from "../src/game/input";
import type { JumpRaven } from "../src/game/game";

function door(phase = "flying") {
  const m = { mouseHeld: false, pointer: { x: 0, y: 0 }, events: [] as unknown[], keysHeld: new Set<string>() };
  const filtered: string[] = [];
  const game = {
    m,
    phase,
    keyAction: (k: string) => ({ w: 1, " ": 6 })[k] ?? 0,
    controlKey: (k: string) => (filtered.push(k), k === "q"),
  };
  return { input: new Input(game as unknown as JumpRaven), m, filtered };
}

test("a release is the game's only after its own press", () => {
  const { input, m } = door();
  input.up(5, 6);
  expect(m.events).toEqual([]);
  input.down(1, 2);
  input.move(3, 4);
  expect(m.pointer).toEqual({ x: 3, y: 4 });
  input.up(5, 6);
  expect(m.events).toEqual([{ kind: "down", x: 1, y: 2 }, { kind: "up", x: 5, y: 6 }]);
  expect(m.mouseHeld).toBe(false);
  input.up(7, 8);
  expect(m.events).toHaveLength(2);
});

test("the keys the game takes, in flight and out of it", () => {
  const flying = door();
  expect(flying.input.keyDown("w")).toBe(true);
  expect(flying.input.keyDown(" ")).toBe(true);
  expect(flying.input.keyDown("z")).toBe(false);
  expect(flying.input.keyDown(ESCAPE_KEY)).toBe(true);
  expect(flying.m.events).toEqual([{ kind: "key", key: "w" }, { kind: "key", key: " " }, { kind: "key", key: ESCAPE }]);
  expect([...flying.m.keysHeld]).toEqual(["w", " ", ESCAPE_KEY]);
  flying.input.keyUp("w");
  expect(flying.m.keysHeld.has("w")).toBe(false);

  const story = door("story");
  expect(story.input.keyDown("w")).toBe(false);
  expect(story.input.keyDown("Escape")).toBe(true);
  expect(story.m.events).toEqual([{ kind: "key", key: "Escape" }]);
});

test("Ctrl keys go to the key filter", () => {
  const { input, m, filtered } = door("story");
  expect(input.keyDown("q", true)).toBe(true);
  expect(input.keyDown("x", true)).toBe(false);
  expect(filtered).toEqual(["q", "x"]);
  expect(m.events).toEqual([]);
});
