/**
 * A finger in a RedJack room (`src/room-touch.ts`): a slow drag looks round, a
 * quick one is the arrow key it always was, a tap on the bare room is not a
 * walk, and two fingers are the right button held — all only at a node.
 *
 *   npx vitest run --project redjack redjack/tests/room-touch.ts
 *
 * The room is a stand-in with the camera's four fields and the session's few
 * the gestures read; the clock is injected, so "quick" is a number and not a
 * race.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { TURN } from "@dreamfactory/engine/df/sett";
import { SWIPE_MIN_PX } from "@dreamfactory/engine/web/touch";
import { bindRoomTouch } from "../src/room-touch";

const SCREEN = { width: 640, height: 480 };
/** the picture shown at 1:1 here, so a client pixel is a screen pixel */
const coords = (e: { clientX: number; clientY: number }) => ({ x: Math.round(e.clientX), y: Math.round(e.clientY) });

let clock = 0;
let calls: string[];
let maze: {
  walk: boolean;
  heading: number;
  pitch: number;
  detail: number;
  fov: number;
  changed: number;
  setHeading(v: number): void;
  setPitch(v: number): void;
  onChange(): void;
};
let session: Record<string, unknown> & { pointerDown: boolean; pointerButton: number; pointer: [number, number]; hit: string };
let owner = "world";
let owned = true;

function room(clockless = false) {
  maze = {
    walk: false,
    heading: 1000,
    pitch: 0,
    detail: 16,
    fov: TURN / 4,
    changed: 0,
    setHeading(v) {
      this.heading = v;
    },
    setPitch(v) {
      this.pitch = v;
    },
    onChange() {
      this.changed++;
    },
  };
  session = {
    maze,
    puppet: null,
    currentViewName: () => "node",
    hitTestAt: () => ({ type: session.hit }),
    setPointer: (x: number, y: number) => void (session.pointer = [x, y]),
    track: (p: Promise<unknown>) => p,
    pointerDown: false,
    pointerButton: 0,
    pointer: [0, 0],
    hit: "scene",
  };
  const director = {
    screenOwner: () => owner,
    press: async (x: number, y: number) => void calls.push(`press ${x},${y}`),
    release: (x: number, y: number) => void calls.push(`release ${x},${y}`),
  };
  const touch = {
    owns: () => owned,
    cancel: (e: { pointerId: number }) => void calls.push(`touch.cancel ${e.pointerId}`),
    up: (e: { pointerId: number }) => (calls.push(`touch.up ${e.pointerId}`), true),
  };
  const deps = { host: { session, director } as never, touch: touch as never, coords, screen: SCREEN };
  return bindRoomTouch(clockless ? deps : { ...deps, now: () => clock });
}

const ev = (pointerId: number, clientX: number, clientY: number) => ({ pointerId, clientX, clientY }) as PointerEvent;

beforeEach(() => {
  clock = 0;
  calls = [];
  owner = "world";
  owned = true;
});

describe("one finger at a node", () => {
  it("swallows a tap on the bare room, and only there", () => {
    const r = room();
    expect(r.swallowsPress(10, 10)).toBe(true);
    session.hit = "prop";
    expect(r.swallowsPress(10, 10)).toBe(false);
    session.hit = "scene";
    owner = "movie";
    expect(r.swallowsPress(10, 10)).toBe(false);
  });

  it("turns the camera under a slow drag, and keeps it there", () => {
    const r = room();
    expect(r.down(ev(1, 300, 200))).toBe(false);
    r.afterDown(ev(1, 300, 200));
    // under the swipe threshold nothing turns yet
    r.move(ev(1, 300 + SWIPE_MIN_PX - 1, 200));
    expect(maze.heading).toBe(1000);
    r.move(ev(1, 400, 260));
    const perPx = maze.fov / SCREEN.width;
    expect(maze.heading).toBe(1000 + 100 * perPx);
    expect(maze.pitch).toBe(60 * perPx);
    expect(maze.detail).toBe(8);
    expect(session.pointer).toEqual([320, 240]);
    clock = 600;
    expect(r.up(ev(1, 400, 260))).toBe(true);
    // a look kept: heading stays, the room's detail is back, the gesture is cancelled
    expect(maze.heading).toBe(1000 + 100 * perPx);
    expect(maze.detail).toBe(16);
    expect(calls).toContain("touch.cancel 1");
  });

  it("stops the look at the scroll's own limits", () => {
    const r = room();
    r.down(ev(1, 300, 0));
    r.afterDown(ev(1, 300, 0));
    r.move(ev(1, 300, 5000));
    expect(maze.pitch).toBe((60 * TURN) / 360);
    r.move(ev(1, 300, -5000));
    expect(maze.pitch).toBe((-50 * TURN) / 360);
  });

  it("reads a quick drag as the flick it was, putting the camera back", () => {
    const r = room();
    r.down(ev(1, 300, 400));
    r.afterDown(ev(1, 300, 400));
    clock = 100;
    r.move(ev(1, 300, 100));
    expect(r.up(ev(1, 300, 100))).toBe(true);
    expect(maze.heading).toBe(1000);
    expect(maze.pitch).toBe(0);
    expect(calls).toContain("touch.up 1");
  });

  it("lets a finger on a control, off a node or owned elsewhere go by", () => {
    let r = room();
    session.hit = "button";
    r.down(ev(1, 10, 10));
    r.afterDown(ev(1, 10, 10));
    r.move(ev(1, 200, 10));
    expect(maze.heading).toBe(1000);
    expect(r.up(ev(1, 200, 10))).toBe(false);

    r = room();
    maze.walk = true;
    r.down(ev(1, 10, 10));
    r.afterDown(ev(1, 10, 10));
    r.move(ev(1, 200, 10));
    expect(maze.heading).toBe(1000);

    r = room();
    owned = false;
    r.down(ev(1, 10, 10));
    r.afterDown(ev(1, 10, 10));
    expect(r.move(ev(1, 200, 10))).toBe(false);
    expect(maze.heading).toBe(1000);
    // a finger it never saw is not its to lift or cancel
    expect(r.up(ev(9, 0, 0))).toBe(false);
    expect(r.cancel(ev(9, 0, 0))).toBe(false);
  });

  it("keeps time by the page's own clock when given none", () => {
    // the default once called itself: a finger's first lift in a room overflowed the stack
    const r = room(true);
    r.down(ev(1, 300, 200));
    r.afterDown(ev(1, 300, 200));
    r.move(ev(1, 450, 200));
    expect(r.up(ev(1, 450, 200))).toBe(true);
  });

  it("puts the camera back when the look is cancelled", () => {
    const r = room();
    r.down(ev(1, 300, 200));
    r.afterDown(ev(1, 300, 200));
    r.move(ev(1, 450, 200));
    expect(maze.heading).not.toBe(1000);
    expect(r.cancel(ev(1, 450, 200))).toBe(false);
    expect(maze.heading).toBe(1000);
  });
});

describe("two fingers", () => {
  it("are the right button held, at their middle, until one lifts", async () => {
    const r = room();
    r.down(ev(1, 100, 100));
    r.afterDown(ev(1, 100, 100));
    expect(r.down(ev(2, 300, 300))).toBe(true);
    expect(calls).toContain("touch.cancel 1");
    expect(session.pointerButton).toBe(2);
    expect(session.pointerDown).toBe(true);
    await Promise.resolve();
    expect(calls).toContain("press 200,200");
    // a third finger is the zoom's too, and a move moves the middle
    expect(r.down(ev(3, 200, 200))).toBe(true);
    expect(r.move(ev(2, 400, 400))).toBe(true);
    expect(session.pointer).toEqual([233, 233]);
    expect(r.up(ev(2, 400, 400))).toBe(true);
    expect(calls).toContain("release 233,233");
    expect(session.pointerDown).toBe(false);
    expect(r.up(ev(1, 0, 0))).toBe(true);
    expect(r.up(ev(3, 0, 0))).toBe(true);
    // all lifted: the pointer is parked in the middle again
    expect(session.pointer).toEqual([320, 240]);
  });

  it("let go on a cancel", () => {
    const r = room();
    r.down(ev(1, 100, 100));
    r.down(ev(2, 300, 300));
    expect(r.cancel(ev(1, 0, 0))).toBe(true);
    expect(calls.some((c) => c.startsWith("release"))).toBe(true);
    expect(r.cancel(ev(2, 0, 0))).toBe(true);
    // and a finger after is one finger again
    expect(r.down(ev(4, 10, 10))).toBe(false);
  });

  it("are not a zoom away from a node", () => {
    const r = room();
    owner = "puppet";
    r.down(ev(1, 100, 100));
    expect(r.down(ev(2, 300, 300))).toBe(false);
  });
});
