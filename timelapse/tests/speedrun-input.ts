/**
 * Where a headless speedrun's input goes in Timelapse
 * (`src/speedrun/headless.ts`): the workbench's Calculate and
 * `npm run speedrun -w timelapse` hand the engine the events the page would,
 * routed the way the page routes them — no set viewer anywhere, so everything
 * goes to the director.
 *
 *   npx vitest run --project timelapse timelapse/tests/speedrun-input.ts
 *
 * Against a stand-in host that records what it is told: a press is followed by
 * the hover the page asks for once the click is dealt with, a release with no
 * press is dropped, and keys the game has no use for go nowhere.
 */
import { expect, test } from "vitest";
import type { GameHost, HostFiles } from "@dreamfactory/engine/web/host";
import { headlessGame, headlessHost } from "../src/speedrun/headless";

function host() {
  const told: string[] = [];
  const globals = new Map<string, unknown>();
  const session = {
    pointerDown: false,
    setPointer: (x: number, y: number) => void told.push(`pointer ${x},${y}`),
    interp: { globals, bool: (b: boolean) => (b ? "true" : "false") },
  };
  const director = {
    buttonDown: async (x: number, y: number) => void told.push(`down ${x},${y}`),
    buttonUp: (x: number, y: number) => void told.push(`up ${x},${y}`),
    hover: async (x: number, y: number) => void told.push(`hover ${x},${y}`),
    keyDown: async (k: string, special: boolean) => void told.push(`key ${k}${special ? " (special)" : ""}`),
  };
  return { h: { session, director } as unknown as GameHost, told, session, globals };
}

const { deliver, roomless } = headlessGame(async () => null as unknown as GameHost);

test("a press goes to the director and is followed by a hover there; a release only after a press", async () => {
  expect(roomless).toBe(true);
  const { h, told, session } = host();
  deliver(h, { type: "pointerup", clientX: 1, clientY: 1 });
  expect(told).toEqual([]);
  deliver(h, { type: "pointerdown", clientX: 100.6, clientY: 50.1 });
  await new Promise((r) => setTimeout(r, 0));
  session.pointerDown = true;
  deliver(h, { type: "pointerup", clientX: 100, clientY: 50 });
  expect(told).toEqual(["pointer 100,50", "down 100,50", "hover 100,50", "up 100,50"]);
});

test("a key reaches the director by the script's name for it, as a gesture and never a held key", () => {
  const { h, told, globals } = host();
  deliver(h, { type: "keydown", key: "ArrowLeft" });
  expect(globals.get("isrepeat")).toBe("false");
  // the log's key is the page's, not the game's
  deliver(h, { type: "keydown", key: "b" });
  // an event with no key name is the empty key, as the page's would be
  deliver(h, { type: "keydown" });
  // and a release is nobody's: the director takes no key-up
  deliver(h, { type: "keyup", key: "ArrowLeft" });
  expect(told).toEqual(["key leftarrow", "key "]);
});

test("a headless host logs nowhere unless told", () => {
  const files = { load: async () => null } as unknown as HostFiles;
  expect(headlessHost(files).session.onLog).toBeTypeOf("function");
  const lines: string[] = [];
  headlessHost(files, (l) => lines.push(l)).session.onLog!("hello");
  expect(lines).toEqual(["hello"]);
});
