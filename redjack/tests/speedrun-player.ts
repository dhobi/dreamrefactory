/**
 * The player RedJack's speedrun verbs drive (`src/speedrun/player.ts`): the
 * route moves of `src/play/` run through a speedrun driver's hand instead of the
 * machine harness's pump — and `src/speedrun/move.ts`'s two readings of a line.
 *
 *   npx vitest run --project redjack redjack/tests/speedrun-player.ts
 *
 * What is pinned is what the page sees: which DOM key a route's key name
 * becomes (ESC only when the route asks for the special one), where a click
 * leaves the pointer, and what a wait that runs out says about why — the
 * director busy, scripts running, a walk, a room not quiescent, each named only
 * when it is so. And a runner with no hand is refused at once rather than
 * failing somewhere inside the first move.
 */
import { expect, test } from "vitest";
import type { ActionContext } from "@dreamfactory/speedrun/action";
import type { SpeedrunDriver } from "@dreamfactory/speedrun/driver";
import { ESCAPE_KEY } from "@dreamfactory/engine/web/keys";
import { parseSheet } from "@dreamfactory/speedrun/sheet";
import { playerFor } from "../src/speedrun/player";
import { VERBS, resolve } from "../src/speedrun/actions";
import { num, passesOf } from "../src/speedrun/move";

interface World {
  speaking?: boolean;
  globals?: Map<string, unknown>;
  busy: boolean;
  quiescent: boolean;
  handlers: number;
  events: unknown[];
  walk: boolean;
  owner: string;
  setFile: string | undefined;
  maze: { sceneName?: string; walk: boolean } | null;
}

function runner(w: World, withHand = true) {
  const hand: string[] = [];
  const dbg = {
    host: {
      director: {
        screen: { width: 640, height: 480 },
        get busy() {
          return w.busy;
        },
        get quiescent() {
          return w.quiescent;
        },
        awaitingChoice: false,
        get speaking() {
          return !!w.speaking;
        },
        screenOwner: () => w.owner,
      },
    },
    session: {
      get currentSetFile() {
        return w.setFile;
      },
      get maze() {
        return w.maze;
      },
      interp: {
        get handlersInPlay() {
          return w.handlers;
        },
        get globals() {
          return (w.globals ??= new Map());
        },
      },
      hitTestAt: () => ({ name: "", type: "none" }),
      get events() {
        return w.events;
      },
    },
  };
  let sleeps = 0;
  const d = {
    evaluate: async (expr: string) => {
      expect(expr).toBe("window.dbg");
      return dbg;
    },
    sleep: async () => void sleeps++,
    ...(withHand
      ? {
          hand: {
            press: (x: number, y: number) => void hand.push(`press ${x},${y}`),
            release: (x: number, y: number) => void hand.push(`release ${x},${y}`),
            move: (x: number, y: number) => void hand.push(`move ${x},${y}`),
            keyDown: (k: string) => void hand.push(`down ${k}`),
            keyUp: (k: string) => void hand.push(`up ${k}`),
          },
        }
      : {}),
  } as unknown as SpeedrunDriver;
  const c = { d } as ActionContext;
  /** run a sheet line through the verbs, on this runner */
  const line = async (text: string): Promise<void> => {
    const [step] = parseSheet(text, { verbs: VERBS });
    await resolve(step.verb)!.run({ ...c, step } as ActionContext);
  };
  return { c, hand, sleeps: () => sleeps, line };
}

const calm = (): World => ({
  busy: false,
  quiescent: true,
  handlers: 0,
  events: [],
  walk: false,
  owner: "world",
  setFile: "liznite.sett",
  maze: { sceneName: "Node58", walk: false },
});

test("a runner with no hand cannot play RedJack's moves", async () => {
  await expect(playerFor(runner(calm(), false).c)).rejects.toThrow(/^this runner has no hand to play RedJack's moves with$/);
});

test("a route's key names become the page's keys, and ESC only when asked for specially", async () => {
  const r = runner(calm());
  const h = await playerFor(r.c);
  h.tap("up");
  h.tap(ESCAPE_KEY, true);
  h.tap(ESCAPE_KEY);
  h.key("space");
  h.keyUp("space");
  h.tap("x");
  expect(r.hand).toEqual([
    "down ArrowUp",
    "up ArrowUp",
    "down Escape",
    "up Escape",
    `down ${ESCAPE_KEY}`,
    `up ${ESCAPE_KEY}`,
    "down Space",
    "up Space",
    "down x",
    "up x",
  ]);
});

test("a click goes back to the middle unless told to stay; a held press moves there first", async () => {
  const r = runner(calm());
  const h = await playerFor(r.c);
  h.click(10, 20);
  h.click(30, 40, true);
  h.mouseDown(50, 60);
  h.mouseUp(50, 60);
  expect(r.hand).toEqual([
    "press 10,20",
    "release 10,20",
    "move 320,240",
    "press 30,40",
    "release 30,40",
    "move 50,60",
    "press 50,60",
    "release 50,60",
  ]);
});

test("the room and the node read as nothing where the session has neither", async () => {
  const w = calm();
  const h = await playerFor(runner(w).c);
  expect([h.room(), h.node()]).toEqual(["liznite.sett", "Node58"]);
  w.setFile = undefined;
  w.maze = null;
  expect([h.room(), h.node()]).toEqual(["", ""]);
  expect(h.running()).toEqual([]);
});

test("a wait that runs out names what was still going on, and only that", async () => {
  const w = calm();
  const h = await playerFor(runner(w).c);
  await expect(h.until(() => false, "the door", 3)).rejects.toThrow(
    /^stuck waiting for the door \(3 passes, world at liznite\.sett\/Node58\)$/,
  );
  Object.assign(w, { busy: true, quiescent: false, handlers: 2, events: [1], owner: "puppet" });
  w.maze!.walk = true;
  await expect(h.until(() => false, "the door", 3)).rejects.toThrow(
    "stuck waiting for the door (3 passes, puppet at liznite.sett/Node58, director busy, running a script, a script, 1 queued, walking, not quiescent)",
  );
});

test("a wait that comes true on its last pass is not stuck", async () => {
  const r = runner(calm());
  const h = await playerFor(r.c);
  let asked = 0;
  // false for each of the three passes, true when asked once more
  expect(await h.until(() => ++asked > 3, "the door", 3)).toBe(3);
  expect(r.sleeps()).toBe(3);
});

test("a line's budget is counted in passes of fifty, and its numbers must be numbers", () => {
  const line = (args: string[], opts: Record<string, string> = {}) =>
    ({ step: { verb: "rattle", args, opts } }) as unknown as ActionContext;
  expect(passesOf(line([]))).toBeUndefined();
  expect(passesOf(line([], { budget: "1000" }))).toBe(20);
  expect(passesOf(line([], { budget: "10" }))).toBe(1);
  expect(num(line(["bottle", "320"]), 1, "x")).toBe(320);
  expect(() => num(line(["bottle", "east"]), 1, "x")).toThrow(/^rattle: x is a number, not "east"$/);
  expect(() => num(line(["bottle"]), 2, "y")).toThrow(/^rattle: y is a number, not ""$/);
});

test("hush presses ESC only while a line is being spoken", async () => {
  const w = calm();
  const r = runner(w);
  await r.line("hush()");
  expect(r.hand).toEqual([]);
  w.speaking = true;
  await r.line("hush()");
  expect(r.hand).toEqual(["down Escape", "up Escape"]);
});

test("day waits for the BOOTFILE's day, within the line's budget", async () => {
  const w = calm();
  const r = runner(w);
  await expect(r.line("day(2, budget: 100)")).rejects.toThrow(/^stuck waiting for day 2 \(2 passes, world at liznite\.sett\/Node58\)$/);
  w.globals = new Map([["day", 2]]);
  await r.line("day(2, budget: 100)");
});

test("rattle's strokes may be left out, and must be a number when given", async () => {
  const r = runner(calm());
  await expect(r.line("rattle(cup, 320, 200, many)")).rejects.toThrow(/^rattle: the strokes is a number, not "many"$/);
  // left out, the rattle goes ahead — and finds no cup in this room
  await expect(r.line("rattle(cup, 320, 200)")).rejects.toThrow(/^Node58: "cup" is not on screen to pick up$/);
  expect(r.hand).toEqual([]);
});
