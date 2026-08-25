/**
 * A finger on the glass, and the four things it can turn out to have meant.
 *
 *   npx vitest run engine/tests/touch.ts
 *
 * This is the first test the gesture recogniser has ever had. It existed twice —
 * once in `taoot/src/main.ts` and once in `dust/src/main.ts`, two hundred lines
 * each, near line-for-line — and neither copy was covered by anything: the
 * speedrun page-driver deliberately steers around it (`pointerType: "mouse"`,
 * with a comment saying why), and no other test dispatches a touch pointer at
 * all. Extracting it into `engine/src/web/touch.ts` for a third game is what made
 * it testable, and this is the half of that change that was actually missing.
 *
 * What is under test is the AMBIGUITY, which is the only hard part. A finger going
 * down begins a tap and a swipe at the same moment, so the mousedown has to be
 * held back until the gesture declares itself — and every bug this thing can have
 * is a case where it declares wrongly: a click delivered on a swipe (the camera
 * turns AND the thing under your finger opens), a swipe eaten by a drag loop, a
 * press handed over and never released.
 *
 * No DOM: {@link TouchHooks} is the seam, and `PointerEventLike` is three numbers,
 * so the whole state machine runs on plain objects with the clock injected. That
 * is deliberate — a gesture test that needed a phone would not exist.
 */
import { test, expect, vi } from "vitest";
import { ESCAPE_KEY } from "@dreamfactory/engine/web/keys";
import {
  DOUBLE_TAP_MS,
  DOUBLE_TAP_PX,
  SWIPE_MIN_PX,
  TAP_HOLD_MS,
  TouchGestures,
} from "@dreamfactory/engine/web/touch";

/** what the hooks were asked to do, in order — the assertions are all about this */
type Act =
  | { act: "press"; x: number; y: number }
  | { act: "release"; x: number; y: number }
  | { act: "key"; key: string; special: boolean };

function rig(opts: { control?: boolean; invert?: { turn: boolean; walk: boolean } } = {}) {
  const acts: Act[] = [];
  let clock = 1000;
  const g = new TouchGestures(
    {
      // one CSS px is one framebuffer px here, so a swipe's travel and a tap's
      // landing point are the same numbers and the test reads as what it means
      coords: (e) => ({ x: e.clientX, y: e.clientY }),
      ownedByGame: () => opts.control ?? false,
      press: (x, y) => acts.push({ act: "press", x, y }),
      release: (x, y) => acts.push({ act: "release", x, y }),
      sendKey: (key, special) => acts.push({ act: "key", key, special }),
      invert: opts.invert ? () => opts.invert! : undefined,
    },
    () => clock,
  );
  const at = (x: number, y: number, id = 1) => ({ pointerId: id, clientX: x, clientY: y });
  return { g, acts, at, tick: (ms: number) => (clock += ms) };
}

test("a tap is a click where the finger LANDED, not where it lifted", () => {
  const { g, acts, at } = rig();
  g.down(at(100, 100));
  // nothing yet: the press is withheld until the gesture declares itself, which
  // is the whole design. A press here would mean every swipe also clicked.
  expect(acts, "nothing is delivered on the way down").toEqual([]);

  // lifted promptly, and a few px off — inside the swipe threshold
  g.move(at(104, 103));
  g.up(at(104, 103));
  expect(acts).toEqual([
    { act: "press", x: 100, y: 100 },
    { act: "release", x: 100, y: 100 },
  ]);
});

test("a swipe past the threshold sends an arrow and never a click", () => {
  const { g, acts, at } = rig();
  g.down(at(300, 300));
  g.move(at(300, 300 - SWIPE_MIN_PX - 1));
  g.up(at(300, 300 - SWIPE_MIN_PX - 1));
  // upward: walk on. And no press/release at all — a swipe that also clicked
  // would turn the camera and open whatever was under the finger.
  expect(acts).toEqual([{ act: "key", key: "uparrow", special: false }]);
});

test("all four axes, and the direction is read off the whole journey", () => {
  const far = SWIPE_MIN_PX + 20;
  const swipe = (dx: number, dy: number) => {
    const { g, acts, at } = rig();
    g.down(at(300, 300));
    // a wobble the other way first: it commits the gesture to being a swipe, but
    // must not get to choose the direction
    g.move(at(300 - 6, 300 + 6));
    g.move(at(300 + dx, 300 + dy));
    g.up(at(300 + dx, 300 + dy));
    return acts;
  };
  expect(swipe(0, -far)).toEqual([{ act: "key", key: "uparrow", special: false }]);
  expect(swipe(0, far)).toEqual([{ act: "key", key: "downarrow", special: false }]);
  expect(swipe(-far, 0)).toEqual([{ act: "key", key: "leftarrow", special: false }]);
  expect(swipe(far, 0)).toEqual([{ act: "key", key: "rightarrow", special: false }]);
  // ...and a diagonal decides nothing. Not the nearest axis: a gesture that
  // could be either should not be guessed at, because guessing wrong walks you
  // somewhere you did not ask to go.
  expect(swipe(far, -far)).toEqual([]);
});

test("the invert hook is read at RELEASE, so a setting changed mid-drag applies", () => {
  const invert = { turn: false, walk: false };
  const { g, acts, at } = rig({ invert });
  g.down(at(300, 300));
  g.move(at(300, 300 - SWIPE_MIN_PX - 10));
  invert.walk = true; // the player ticked the box while the finger was down
  g.up(at(300, 300 - SWIPE_MIN_PX - 10));
  expect(acts).toEqual([{ act: "key", key: "downarrow", special: false }]);
});

test("a finger held past TAP_HOLD_MS is a press, handed over while still down", () => {
  vi.useFakeTimers();
  try {
    const { g, acts, at } = rig();
    g.down(at(120, 140));
    expect(acts, "still ambiguous").toEqual([]);
    vi.advanceTimersByTime(TAP_HOLD_MS + 1);
    // the button is genuinely down now, which is what a `while stilldown()` drag
    // loop needs — it cannot be given a press and a release at the end
    expect(acts).toEqual([{ act: "press", x: 120, y: 140 }]);

    // And it DRAGS. The finger now travels far enough to have been a swipe, and
    // the press already handed over is what has to win: a hold that turned into
    // an arrow key at the end would send the camera off mid-drag and never
    // release the button. So the lift is a release, not a key.
    g.move(at(320, 140));
    g.up(at(320, 140));
    expect(acts).toEqual([
      { act: "press", x: 120, y: 140 },
      // released where the finger REACHED, unlike a tap
      { act: "release", x: 320, y: 140 },
    ]);
  } finally {
    vi.useRealTimers();
  }
});

/**
 * The case that forced the `ownedByGame` hook to exist: an inventory item is
 * dragged by a `while stilldown()` loop in the game's own script, and waiting out
 * TAP_HOLD_MS to disambiguate would rule the first 220 ms of that drag a swipe
 * and walk the camera instead of carrying the item.
 */
test("a finger on a control is pressed at once and can never become a swipe", () => {
  const { g, acts, at } = rig({ control: true });
  g.down(at(200, 200));
  expect(acts, "no wait: a control takes its press immediately").toEqual([
    { act: "press", x: 200, y: 200 },
  ]);
  g.move(at(400, 200)); // far enough to be a swipe on any other surface
  g.up(at(400, 200));
  expect(acts).toEqual([
    { act: "press", x: 200, y: 200 },
    { act: "release", x: 400, y: 200 },
  ]);
});

test("two prompt taps in the same place are ESCAPE, and only the second is swallowed", () => {
  const { g, acts, at, tick } = rig();
  g.down(at(100, 100));
  g.up(at(100, 100));
  // the FIRST tap already went out as a click. Holding every tap back to see
  // whether another follows would put 300 ms of lag on every press in the game.
  expect(acts).toEqual([
    { act: "press", x: 100, y: 100 },
    { act: "release", x: 100, y: 100 },
  ]);

  acts.length = 0;
  tick(DOUBLE_TAP_MS - 50);
  g.down(at(102, 103));
  g.up(at(102, 103));
  expect(acts, "no third click: the second tap becomes the key").toEqual([
    { act: "key", key: ESCAPE_KEY, special: true },
  ]);

  // ...and a THIRD tap is a fresh first rather than another escape, so a
  // drumming finger does not send escape on every beat
  acts.length = 0;
  tick(50);
  g.down(at(102, 103));
  g.up(at(102, 103));
  expect(acts).toEqual([
    { act: "press", x: 102, y: 103 },
    { act: "release", x: 102, y: 103 },
  ]);
});

test("a second tap too late, or too far, is just another click", () => {
  for (const [dt, dx, why] of [
    [DOUBLE_TAP_MS + 10, 0, "too late"],
    [10, DOUBLE_TAP_PX + 10, "too far"],
  ] as const) {
    const { g, acts, at, tick } = rig();
    g.down(at(100, 100));
    g.up(at(100, 100));
    acts.length = 0;
    tick(dt);
    g.down(at(100 + dx, 100));
    g.up(at(100 + dx, 100));
    expect(acts, why).toEqual([
      { act: "press", x: 100 + dx, y: 100 },
      { act: "release", x: 100 + dx, y: 100 },
    ]);
  }
});

/**
 * `pointercancel` is the system taking the gesture away mid-flight — an edge
 * swipe, usually. The rule is act on nothing, EXCEPT that a press already handed
 * over has to be let go of, or the game is left with the button held for ever and
 * every `while stilldown()` loop in it spins.
 */
test("a cancelled gesture acts on nothing, but never leaves the button down", () => {
  vi.useFakeTimers();
  try {
    const undecided = rig();
    undecided.g.down(undecided.at(100, 100));
    undecided.g.cancel(undecided.at(100, 100));
    expect(undecided.acts, "nothing had been delivered, so nothing is undone").toEqual([]);

    const held = rig();
    held.g.down(held.at(100, 100));
    vi.advanceTimersByTime(TAP_HOLD_MS + 1);
    held.acts.length = 0;
    held.g.cancel(held.at(100, 100));
    expect(held.acts).toEqual([{ act: "release", x: 100, y: 100 }]);
  } finally {
    vi.useRealTimers();
  }
});

test("a lift from a finger we are not tracking is left to the caller", () => {
  const { g, acts, at } = rig();
  g.down(at(100, 100));
  // a different pointerId: a mouse release arriving while a finger is down, or a
  // second finger. `up` says false so the shell runs its ordinary mouse release
  // rather than this gesture's, and the gesture in flight is untouched.
  expect(g.up(at(100, 100, 2))).toBe(false);
  expect(g.owns(at(0, 0, 2))).toBe(false);
  expect(g.owns(at(0, 0, 1))).toBe(true);
  expect(acts).toEqual([]);
  // ...and it still ends correctly when its own finger does lift
  expect(g.up(at(100, 100))).toBe(true);
  expect(acts).toEqual([
    { act: "press", x: 100, y: 100 },
    { act: "release", x: 100, y: 100 },
  ]);
});

test("a gesture with no game behind it is dropped before it starts", () => {
  const acts: Act[] = [];
  const g = new TouchGestures({
    // the boot has not finished: there are no framebuffer coordinates to give
    coords: () => null,
    ownedByGame: () => false,
    press: (x, y) => acts.push({ act: "press", x, y }),
    release: (x, y) => acts.push({ act: "release", x, y }),
    sendKey: (key, special) => acts.push({ act: "key", key, special }),
  });
  expect(g.down({ pointerId: 1, clientX: 10, clientY: 10 })).toBe(false);
  expect(g.up({ pointerId: 1, clientX: 10, clientY: 10 })).toBe(false);
  expect(acts).toEqual([]);
});

/**
 * A first tap while the clock still reads ~0 is a CLICK, not an escape.
 *
 * `lastTapAt` doubles as the "no previous tap" sentinel — the escape branch
 * clears it so a drumming finger does not send escape on every beat — and it was
 * `0`, which is also a time. Every test above starts its clock at 1000 and none
 * of them could see it: with `now() - 0 < DOUBLE_TAP_MS` true, the FIRST tap of a
 * page's life was read as the second of a pair and sent the ESCAPE a cutscene is
 * skipped with instead of the click the player meant.
 *
 * Narrow in a browser — `performance.now()` has usually passed 320 ms before a
 * finger arrives — and reachable exactly where it does most harm: a fast reload
 * onto a page whose film is already playing. The sentinel is `-Infinity` now, so
 * "never tapped" is not a moment in time.
 */
test("the first tap of all is a click, however early the clock says it is", () => {
  const acts: Act[] = [];
  let clock = 0; // a page that has only just started
  const g = new TouchGestures(
    {
      coords: (e) => ({ x: e.clientX, y: e.clientY }),
      ownedByGame: () => false,
      press: (x, y) => acts.push({ act: "press", x, y }),
      release: (x, y) => acts.push({ act: "release", x, y }),
      sendKey: (key, special) => acts.push({ act: "key", key, special }),
    },
    () => clock,
  );
  const at = (x: number, y: number) => ({ pointerId: 1, clientX: x, clientY: y });
  g.down(at(50, 60));
  g.up(at(50, 60));
  expect(acts).toEqual([
    { act: "press", x: 50, y: 60 },
    { act: "release", x: 50, y: 60 },
  ]);
  // ...and the pair still works from there, so the sentinel did not cost a feature
  acts.length = 0;
  clock += DOUBLE_TAP_MS - 50;
  g.down(at(50, 60));
  g.up(at(50, 60));
  expect(acts).toEqual([{ act: "key", key: ESCAPE_KEY, special: true }]);
});

/**
 * `owns()` is how a page routes `pointermove`: the shells listen on the window so
 * a drag that ends off-canvas still ends, which means they see moves belonging to
 * pointers that are not the gesture's. Both game pages now ask this question
 * before forwarding, so it is worth pinning that it answers per POINTER.
 */
test("owns() answers for the finger that started the gesture, and no other", () => {
  const { g, at } = rig();
  expect(g.owns(at(0, 0)), "nothing in flight").toBe(false);
  g.down(at(10, 10, 7));
  expect(g.owns(at(11, 11, 7))).toBe(true);
  expect(g.owns(at(11, 11, 8)), "a second finger owns nothing").toBe(false);
  g.up(at(10, 10, 7));
  expect(g.owns(at(10, 10, 7)), "the gesture is over").toBe(false);
});

