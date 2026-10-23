/**
 * Where a headless speedrun's input goes in Dust (`src/speedrun/headless.ts`):
 * the workbench's Calculate and `npm run speedrun -w dust` hand the engine the
 * events the page would, routed the way the page routes them — a press to the
 * set viewer, a key to the director, the log's own keys to nobody.
 *
 *   npx vitest run --project dust dust/tests/speedrun-input.ts
 *
 * Against a stand-in host that records what it is told: what is pinned is the
 * routing, including what happens with no viewer up (a flat, or the boot),
 * where a press or release has nothing to land on and is dropped.
 */
import { expect, test } from "vitest";
import type { GameHost, HostFiles } from "@dreamfactory/engine/web/host";
import { ESCAPE_KEY } from "@dreamfactory/engine/web/keys";
import { headlessGame, headlessHost } from "../src/speedrun/headless";

function host(withViewer: boolean) {
  const told: string[] = [];
  const globals = new Map<string, unknown>();
  const session = {
    pointerDown: false,
    shiftDown: false,
    pointerX: 0,
    pointerY: 0,
    setPointer(x: number, y: number) {
      this.pointerX = x;
      this.pointerY = y;
    },
    track: (p: Promise<unknown>) => p,
    interp: { globals },
  };
  const viewer = {
    press: async (x: number, y: number) => void told.push(`press ${x},${y}`),
    release: (x: number, y: number) => void told.push(`release ${x},${y}`),
    hover: async (x: number, y: number) => void told.push(`hover ${x},${y}`),
  };
  const director = {
    keyDown: async (k: string, escape: boolean) => void told.push(`key ${k}${escape ? " (escape)" : ""}`),
  };
  return { h: { session, director, viewer: withViewer ? viewer : null } as unknown as GameHost, told, session, globals };
}

const { deliver } = headlessGame(async () => null as unknown as GameHost);

test("with no viewer up a press and a release have nothing to land on", () => {
  const { h, told, session } = host(false);
  deliver(h, { type: "pointerdown", clientX: 10, clientY: 20 });
  expect(session.pointerDown).toBe(false);
  expect([session.pointerX, session.pointerY]).toEqual([10, 20]);
  deliver(h, { type: "pointerup", clientX: 10, clientY: 20 });
  deliver(h, { type: "mousemove", clientX: 11, clientY: 21 });
  expect(told).toEqual([]);
});

test("a press, a shifted press and a release go to the viewer where the pointer is", () => {
  const { h, told, session } = host(true);
  deliver(h, { type: "pointerdown", clientX: 10.9, clientY: 20.2, shiftKey: true });
  expect(session.shiftDown).toBe(true);
  // a move while held is the drag's, not a hover
  deliver(h, { type: "pointermove", clientX: 12, clientY: 22 });
  deliver(h, { type: "pointerup" });
  expect(told).toEqual(["press 10,20", "release 12,22"]);
  expect(session.pointerDown).toBe(false);
});

test("a key goes to the director with its repeat, and the log's keys and nameless keys go nowhere", () => {
  const { h, told, globals } = host(true);
  deliver(h, { type: "keydown", key: "Escape" });
  deliver(h, { type: "keydown", key: "b" });
  deliver(h, { type: "keydown", key: "Shift" });
  deliver(h, { type: "keydown" });
  deliver(h, { type: "keyup", key: "a" });
  expect(told).toEqual([`key ${ESCAPE_KEY} (escape)`]);
  expect(globals.get("isrepeat")).toBe(false);
});

test("a headless host keeps v1's save tables, and logs nowhere unless told", () => {
  const files = { load: async () => null } as unknown as HostFiles;
  expect(headlessHost(files).session.dfVersion).toBe(1);
  expect(headlessHost(files, () => {}).session.dfVersion).toBe(1);
});
