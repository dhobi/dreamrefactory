/**
 * The speedrun verbs that use the player's hands: `take` and `use` (the
 * inventory band), `closeUp` (the scoring objects that arm the bomb), `intro`
 * (the Nightdive film's question) and `mission` (a load point by number).
 *
 *   npx vitest run taoot/tests/auto/speedrun-hands.ts
 *
 * Each of these carries a rule a run once lost minutes to, and the rules are
 * what is pinned:
 *
 *   - the inventory bag answers a DARK band by lighting it and nothing else, so
 *     a closed inventory after the first click is expected, not a fault;
 *   - a close-up's OK is pressed only while a region of the parked film covers
 *     it — 460,352 is otherwise a point in the room, and a stray click there once
 *     set `xxcards` with nothing scored, one point short of the raid;
 *   - a close-up that scored nothing stops the run, because eleven points is
 *     exactly what there is;
 *   - the intro is answered YES, because NO navigates to a shop;
 *   - `mission(1, phase: 2)` is the load point named `m1p2`.
 *
 * Against scripted models rather than the game: the decisions are these verbs'
 * own, and the gestures they make are recorded and asserted.
 */
import { expect, test } from "vitest";
import { VERBS, resolve } from "../../src/speedrun/actions";
import type { ActionContext } from "@dreamfactory/engine/web/speedrun/action";
import type { SpeedrunDriver } from "@dreamfactory/engine/web/speedrun/driver";

type Point = { x: number; y: number };

/** run one verb against a driver; the error, if it threw, and what it said */
async function run(
  d: SpeedrunDriver,
  verb: string,
  args: string[],
  opts: Record<string, string> = {},
): Promise<{ said: string[]; error?: string }> {
  const said: string[] = [];
  const c: ActionContext = {
    d,
    step: { verb, args, opts, repeat: 1, line: 1, source: `${verb}(${args.join(", ")})` },
    wait: "none",
    budget: 10_000,
    gap: 16,
    say: (m) => said.push(m),
    suggest: () => {},
    verbs: VERBS,
  };
  try {
    await resolve(verb)!.run(c);
  } catch (e) {
    return { said, error: (e as Error).message };
  }
  return { said };
}

/**
 * A driver whose clicks land on names: `aim` hands out one point per name, and
 * a click at that point is recorded as the name and passed to `onClick`.
 */
function byName(
  evaluate: (expr: string) => unknown,
  onClick: (name: string) => void,
  extra: Record<string, unknown> = {},
) {
  const names: string[] = [];
  const clicks: string[] = [];
  const d = {
    evaluate: async (expr: string) => evaluate(expr),
    hold: async () => {},
    tryHold: async (expr: string) => (expr.includes("walks") ? true : !!evaluate(expr)),
    settle: async () => {},
    aim: async (_kind: string, name: string): Promise<Point | null> => {
      let i = names.indexOf(name);
      if (i < 0) i = names.push(name) - 1;
      return { x: 1000 + i, y: 0 };
    },
    clickAt: async (x: number, y: number) => {
      const name = x >= 1000 ? names[x - 1000] : `${x},${y}`;
      clicks.push(name);
      onClick(name);
    },
    ...extra,
  };
  return { d: d as unknown as SpeedrunDriver, clicks, nameAt: (p: Point) => names[p.x - 1000] };
}

// --- take / use ------------------------------------------------------------

/** the inventory band: a bag that may be dark, items in it, and the OK */
function inventory(opts: { held?: string; dark?: boolean; gives?: string } = {}) {
  let held = opts.held ?? "";
  let dark = opts.dark ?? false;
  let open = false;
  const drags: string[] = [];
  const m: ReturnType<typeof byName> = byName(
    (expr) => {
      if (expr.includes('"handitem"')) return held;
      if (expr.includes("viewShowing") && expr.includes("stageScript")) return open;
      return null;
    },
    (name) => {
      if (name === "bag") {
        // house.shp: a dark bag's mousedown only runs activateinterface()
        if (dark) dark = false;
        else open = true;
      } else if (name === "ok") open = false;
      else if (open) held = opts.gives ?? name;
    },
    {
      drag: async (from: Point, to: Point) => {
        drags.push(`${m.nameAt(from)} -> ${m.nameAt(to)}`);
      },
    },
  );
  return { ...m, drags, state: () => ({ held, open }) };
}

test("take is three clicks: bag, item, OK", async () => {
  const inv = inventory();
  const out = await run(inv.d, "take", ["Ring"]);
  expect(out.error).toBeUndefined();
  expect(inv.clicks).toEqual(["bag", "ring", "ok"]);
  expect(inv.state()).toEqual({ held: "ring", open: false });
});

test("a dark bag's first click only lights the band, and take clicks again", async () => {
  const inv = inventory({ dark: true });
  const out = await run(inv.d, "take", ["ring"]);
  expect(out.error).toBeUndefined();
  expect(inv.clicks).toEqual(["bag", "bag", "ring", "ok"]);
});

test("take of what is already in hand costs nothing", async () => {
  const inv = inventory({ held: "Ring" });
  const out = await run(inv.d, "take", ["ring"]);
  expect(out.error).toBeUndefined();
  expect(inv.clicks).toEqual([]);
});

test("a click that put the wrong thing in hand stops the run before OK", async () => {
  const inv = inventory({ gives: "watch" });
  const out = await run(inv.d, "take", ["ring"]);
  expect(out.error).toBe('clicked ring but "watch" is in hand');
  expect(inv.clicks).toEqual(["bag", "ring"]);
});

test("use drags the hand item onto its target, taking it first if it is not in hand", async () => {
  const inv = inventory();
  const out = await run(inv.d, "use", ["package", "on", "vlad"]);
  expect(out.error).toBeUndefined();
  expect(inv.clicks).toEqual(["bag", "package", "ok"]);
  // `on` is grammar, not a target
  expect(inv.drags).toEqual(["package -> vlad"]);
});

test("use with the item already in hand only drags", async () => {
  const inv = inventory({ held: "light" });
  const out = await run(inv.d, "use", ["light", "watch"]);
  expect(out.error).toBeUndefined();
  expect(inv.clicks).toEqual([]);
  expect(inv.drags).toEqual(["light -> watch"]);
});

test("use with nothing to use it on is refused", async () => {
  const out = await run(inventory().d, "use", ["light", "on"]);
  expect(out.error).toBe("use needs something to use it ON");
});

// --- closeUp ---------------------------------------------------------------

/**
 * A scoring object: clicking it scores `pays` (at once, as BEDSIT1's mousedown
 * does) and parks a close-up whose OK region stays up for `oks` presses. With
 * `paysOnFrames`, the points come for passing through the film instead — the
 * `cards` case, which an ESC skips.
 */
function scoring(opts: { pays: number; oks?: number; paysOnFrames?: boolean }) {
  let points = 5;
  let oks = 0;
  const m = byName(
    (expr) => {
      if (expr.includes('"bombpoints"')) return points;
      if (expr.includes("movieRegions")) return oks > 0;
      return true;
    },
    (name) => {
      if (name === "460,352") {
        oks--;
        if (oks === 0 && opts.paysOnFrames) points += opts.pays;
        return;
      }
      oks = opts.oks ?? 1;
      if (!opts.paysOnFrames) points += opts.pays;
    },
    {
      hammer: async (key: string) => {
        expect(key).toBe("Escape");
        oks = 0;
        return 1;
      },
    },
  );
  return { ...m, points: () => points };
}

test("closeUp presses OK while the film is parked on it, and no further", async () => {
  const obj = scoring({ pays: 3, oks: 2, paysOnFrames: true });
  const out = await run(obj.d, "closeup", ["cards"]);
  expect(out.error).toBeUndefined();
  // two OKs while a region covered 460,352 — and no third click into the room
  expect(obj.clicks).toEqual(["cards", "460,352", "460,352"]);
  expect(out.said).toEqual(["8 points"]);
});

test("closeUp by: esc lets the film go with ESC, since the score came with the click", async () => {
  const obj = scoring({ pays: 1, oks: 3 });
  const out = await run(obj.d, "closeup", ["memory"], { by: "esc" });
  expect(out.error).toBeUndefined();
  expect(obj.clicks).toEqual(["memory"]);
  expect(out.said).toEqual(["6 points, 1 ESC"]);
});

test("by: esc on an object that pays for its frames scores nothing, and stops the run", async () => {
  // which is why esc is not the default: `cards` pays for passing through frames
  const obj = scoring({ pays: 3, oks: 2, paysOnFrames: true });
  const out = await run(obj.d, "closeup", ["cards"], { by: "esc" });
  expect(out.error).toBe("cards scored nothing — the raid needs all eleven points");
});

test("a close-up that scores nothing stops the run", async () => {
  const obj = scoring({ pays: 0 });
  const out = await run(obj.d, "closeup", ["memory"]);
  expect(out.error).toBe("memory scored nothing — the raid needs all eleven points");
});

// --- intro -----------------------------------------------------------------

/** the Nightdive film: up or not, and its question's buttons once it is asked */
function nightdive(opts: { up: boolean; buttons?: { target: string; x0: number; y0: number; x1: number; y1: number }[] }) {
  const keys: string[] = [];
  const m = byName(
    (expr) => {
      if (expr.includes("b.target === \"yes\"")) {
        const r = (opts.buttons ?? []).find((b) => b.target === "yes");
        return r ? { x: Math.round((r.x0 + r.x1) / 2), y: Math.round((r.y0 + r.y1) / 2) } : null;
      }
      if (expr.includes("regions().length")) return opts.up;
      if (expr === "!!window.dbg.intro") return opts.up;
      return true;
    },
    () => {},
    {
      rawKey: async (k: string) => {
        keys.push(k);
      },
    },
  );
  return { ...m, keys };
}

test("an edition with no intro walks straight past it", async () => {
  const nd = nightdive({ up: false });
  const out = await run(nd.d, "intro", []);
  expect(out.error).toBeUndefined();
  expect(nd.keys).toEqual([]);
  expect(nd.clicks).toEqual([]);
});

test("the intro is pressed past with ESC and answered YES, in the middle of its button", async () => {
  const nd = nightdive({
    up: true,
    buttons: [
      { target: "no", x0: 300, y0: 300, x1: 400, y1: 340 },
      { target: "yes", x0: 100, y0: 300, x1: 201, y1: 340 },
    ],
  });
  const out = await run(nd.d, "intro", []);
  expect(out.error).toBeUndefined();
  expect(nd.keys).toEqual(["Escape"]);
  expect(nd.clicks).toEqual(["151,320"]);
});

test("a question with no YES on it is an error, not a click on NO", async () => {
  const nd = nightdive({ up: true, buttons: [{ target: "no", x0: 300, y0: 300, x1: 400, y1: 340 }] });
  const out = await run(nd.d, "intro", []);
  expect(out.error).toBe('the ownership question has no "yes" button');
  expect(nd.clicks).toEqual([]);
});

// --- mission ---------------------------------------------------------------

test("mission(1, phase: 2) is the load point m1p2, and phase defaults to 0", async () => {
  const asked: string[] = [];
  const d = {
    evaluate: async () => true,
    tryHold: async () => true,
    getSave: async (name: string) => {
      asked.push(name);
      return null;
    },
  } as unknown as SpeedrunDriver;
  const out = await run(d, "mission", ["1"], { phase: "2" });
  expect(out.error).toBe('no load point called "m1p2" — reach it once and put save(m1p2) there first');
  await run(d, "mission", ["3"]);
  expect(asked).toEqual(["m1p2", "m3p0"]);
});

test("mission refuses words where numbers go", async () => {
  const out = await run({} as SpeedrunDriver, "mission", ["one"]);
  expect(out.error).toBe("mission takes numbers — mission(1, phase: 2)");
});
