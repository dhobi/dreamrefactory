/**
 * Where a headless speedrun's input goes in RedJack (`src/speedrun/headless.ts`):
 * the workbench's Calculate and `npm run speedrun -w redjack` hand the engine
 * the same events the page would, and this is the page's routing of them —
 * which keys are held (the fights read held keys, `keysdown`), which reach the
 * director, and which go nowhere.
 *
 *   npx vitest run --project redjack redjack/tests/speedrun-input.ts
 *
 * Against a stand-in host that records what it is told: what is pinned is the
 * routing, not what the game makes of it. And `heldKeys` (`src/input.ts`) for
 * the codes a page's own keyboard sends that the headless runner never does —
 * digits, the keypad, the function keys.
 */
import { expect, test } from "vitest";
import type { GameHost, HostFiles } from "@dreamfactory/engine/web/host";
import { ESCAPE_KEY } from "@dreamfactory/engine/web/keys";
import { headlessGame, headlessHost } from "../src/speedrun/headless";
import { heldKeys } from "../src/input";

function host() {
  const told: string[] = [];
  const globals = new Map<string, unknown>();
  const session = {
    keysDown: new Set<number>(),
    spaceDown: false,
    pointerDown: false,
    setPointer: (x: number, y: number) => void told.push(`pointer ${x},${y}`),
    interp: { globals, bool: (b: boolean) => (b ? 1 : 0) },
  };
  const director = {
    buttonDown: async (x: number, y: number) => void told.push(`down ${x},${y}`),
    buttonUp: (x: number, y: number) => void told.push(`up ${x},${y}`),
    hover: async (x: number, y: number) => void told.push(`hover ${x},${y}`),
    keyDown: async (k: string, special: boolean) => void told.push(`key ${k}${special ? " (special)" : ""}`),
    keyUp: async (k: string) => void told.push(`keyup ${k}`),
  };
  return { h: { session, director } as unknown as GameHost, told, session, globals };
}

const { deliver } = headlessGame(async () => null as unknown as GameHost);

test("the space bar is held and pressed, and let go", () => {
  const { h, told, session, globals } = host();
  deliver(h, { type: "keydown", key: " " });
  expect(session.spaceDown).toBe(true);
  expect([...session.keysDown]).toEqual([0x20]);
  expect(told).toEqual(["key  "]);
  expect(globals.get("isrepeat")).toBe(0);
  deliver(h, { type: "keyup", key: " " });
  expect(session.spaceDown).toBe(false);
  expect([...session.keysDown]).toEqual([]);
});

test("a letter is held by its virtual key, ESC is the special key, and the log keys reach no game", () => {
  const { h, told, session } = host();
  deliver(h, { type: "keydown", key: "q" });
  expect([...session.keysDown]).toEqual(["Q".charCodeAt(0)]);
  deliver(h, { type: "keydown", key: "Escape" });
  deliver(h, { type: "keydown", key: "b" });
  deliver(h, { type: "keydown" });
  expect(told).toEqual(["key q", `key ${ESCAPE_KEY} (special)`, "key "]);
  // only an arrow's release is the game's business
  deliver(h, { type: "keyup", key: "q" });
  deliver(h, { type: "keyup", key: "ArrowLeft" });
  deliver(h, { type: "keyup" });
  expect(told.slice(3)).toEqual(["keyup left"]);
});

test("a release with no press is dropped, and an event the page has no listener for reaches nothing", () => {
  const { h, told, session } = host();
  deliver(h, { type: "pointerup", clientX: 5, clientY: 5 });
  deliver(h, { type: "mousemove", clientX: 5, clientY: 5 });
  expect(told).toEqual([]);
  session.pointerDown = true;
  deliver(h, { type: "pointerup", clientX: 5.7, clientY: 6.2 });
  expect(told).toEqual(["up 5,6"]);
});

test("the keys the page's keyboard holds that a runner never sends: digits, the keypad, F1 to F24", () => {
  expect(heldKeys("Digit3")).toEqual([0x33]);
  expect(heldKeys("Numpad7")).toEqual([0x67]);
  expect(heldKeys("F1")).toEqual([0x70]);
  expect(heldKeys("F24")).toEqual([0x87]);
  expect(heldKeys("F25")).toEqual([]);
  expect(heldKeys("F0")).toEqual([]);
});

test("a headless host draws no pictures, and logs nowhere unless told", () => {
  const files = { load: async () => null } as unknown as HostFiles;
  expect(headlessHost(files).session.drawsPictures).toBe(false);
  const lines: string[] = [];
  const told = headlessHost(files, (l) => lines.push(l));
  told.session.onLog?.("hello");
  expect(lines).toEqual(["hello"]);
});
