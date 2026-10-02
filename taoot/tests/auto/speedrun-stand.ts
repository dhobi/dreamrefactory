/**
 * `stand` — getting to a named view by turning AND walking, inside the room you
 * are in — and the three planner escape hatches it falls through to.
 *
 *   npx vitest run taoot/tests/auto/speedrun-stand.ts
 *
 * `face` only turns, so it can never reach a view in another scene of the same
 * set; the top of the false smokestack (SMSTACK3.SET) is four scenes joined in a
 * ring by four roads, and the notebook is takeable from one view of one of them.
 * `stand` plans over the room the viewer already has in memory — breadth-first
 * over scenes, one `face(leave); up()` per road — so it works in the page,
 * where there is no disk to run the real pathfinder over.
 *
 * What is pinned is the plan and the refusals around it: the fewest roads, not
 * the long way round; the `set:` guard that names "you are in the wrong room"
 * instead of walking a plausible route through it; a room with no road to the
 * goal said as such; and a view this room does not have handed to the planner
 * — which only the Playwright runner can install, and whose absence is an error
 * that says how to get the literal lines instead.
 *
 * Driven against a model room rather than the game. The question is which keys
 * go in, in which order, and a model ring of views answers it exactly; the real
 * smokestack would add a browser, a rip and the maze below it.
 */
import { afterEach, expect, test } from "vitest";
import { VERBS, resolve, setPlanner } from "../../src/speedrun/actions";
import { WORLD, type ActionContext } from "@dreamfactory/engine/web/speedrun/action";
import type { SpeedrunDriver } from "@dreamfactory/engine/web/speedrun/driver";

/** a scene: its name, and its views as `[name, global view id]` in turn order */
type Scene = { name: string; views: [string, number][] };

/**
 * SMSTACK3's shape: four scenes in a ring, each road joining one view of one
 * scene to one view of the next — Scene42/View46 <-> Scene37/View47 and so on
 * round, exactly the table in `stand`'s own header.
 */
const SMSTACK3: { scenes: Scene[]; roads: [number, number][] } = {
  scenes: [
    { name: "scene42", views: [["view45", 45], ["view46", 46], ["view44", 44]] },
    { name: "scene37", views: [["view47", 47], ["view48", 48], ["view49", 49]] },
    { name: "scene38", views: [["view51", 51], ["view52", 52], ["view53", 53]] },
    { name: "scene39", views: [["view55", 55], ["view57", 57], ["view58", 58]] },
  ],
  roads: [
    [46, 47],
    [48, 51],
    [52, 58],
    [57, 45],
  ],
};

/**
 * A room on rails: a ring of views per scene that `ArrowRight` steps round, and
 * roads that `ArrowUp` walks when you are facing one end of them.
 *
 * It answers the four questions `stand`, `face` and `arrow` ask — the room's
 * geometry, the view faced, the WORLD string and the "has the world moved"
 * test — off that state, and every wait returns at once.
 */
function room(opts: {
  set?: string;
  scenes?: Scene[];
  roads?: [number, number][];
  at: [string, string];
  /** the viewer has no set at all — mid-changeset, or a flat */
  noRoom?: boolean;
}) {
  const scenes = opts.scenes ?? SMSTACK3.scenes;
  const roads = opts.roads ?? SMSTACK3.roads;
  const set = opts.set ?? "smstack3";
  let sc = scenes.findIndex((s) => s.name === opts.at[0]);
  let vw = scenes[sc].views.findIndex(([n]) => n === opts.at[1]);
  const keys: string[] = [];
  const world = () => `${set}/${sc}/${vw}|||`;
  const locate = (id: number): [number, number] | null => {
    for (let i = 0; i < scenes.length; i++) {
      const j = scenes[i].views.findIndex(([, v]) => v === id);
      if (j >= 0) return [i, j];
    }
    return null;
  };

  const d = {
    evaluate: async <T,>(expr: string): Promise<T> => {
      if (expr.includes("v.set.transitions")) {
        if (opts.noRoom) return null as T;
        return {
          set,
          here: scenes[sc].name,
          scenes: scenes.map((s) => ({ name: s.name, views: s.views.map(([name, id]) => ({ name, id })) })),
          roads,
        } as T;
      }
      // the "has the world moved, and is nothing of ours still filed" test
      const moved = /!== ("(?:[^"\\]|\\.)*")/.exec(expr);
      if (moved) return (world() !== JSON.parse(moved[1])) as T;
      if (expr === WORLD) return world() as T;
      if (expr.includes("viewIdx].viewName")) return scenes[sc].views[vw][0] as T;
      // the reasons a press did nothing — none, in a model
      return [] as T;
    },
    hold: async () => {},
    tryHold: async () => true,
    settle: async () => {},
    key: async (name: string) => {
      keys.push(name);
      if (name === "ArrowRight") vw = (vw + 1) % scenes[sc].views.length;
      if (name === "ArrowLeft") vw = (vw - 1 + scenes[sc].views.length) % scenes[sc].views.length;
      if (name === "ArrowUp") {
        const here = scenes[sc].views[vw][1];
        for (const [a, b] of roads) {
          const to = a === here ? b : b === here ? a : null;
          if (to === null) continue;
          const next = locate(to);
          if (next) [sc, vw] = next;
          break;
        }
      }
    },
  };
  return {
    d: d as unknown as SpeedrunDriver,
    keys,
    where: () => `${scenes[sc].name}/${scenes[sc].views[vw][0]}`,
  };
}

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

afterEach(() => setPlanner(null));

test("stand in the same scene only turns", async () => {
  const r = room({ at: ["scene39", "view57"] });
  const out = await run(r.d, "stand", ["View55"]);
  expect(out.error).toBeUndefined();
  expect(r.where()).toBe("scene39/view55");
  // two right turns round a ring of three, and not one step forward
  expect(r.keys).toEqual(["ArrowRight", "ArrowRight"]);
  expect(out.said.at(-1)).toBe("smstack3 (from scene39): view55");
});

test("stand takes the one road to a neighbouring scene, not the long way round the ring", async () => {
  // scene42 -> scene39 is one road (View45 <-> View57); the other way round the
  // ring is three, and every road costs the same one walk
  const r = room({ at: ["scene42", "view46"] });
  const out = await run(r.d, "stand", ["view55"]);
  expect(out.error).toBeUndefined();
  expect(r.where()).toBe("scene39/view55");
  expect(r.keys.filter((k) => k === "ArrowUp")).toHaveLength(1);
  expect(out.said.at(-1)).toBe("smstack3 (from scene42), 1 road(s): view45 -> view55");
});

test("stand crosses two scenes when the goal is opposite on the ring", async () => {
  const r = room({ at: ["scene37", "view47"] });
  const out = await run(r.d, "stand", ["view55"]);
  expect(out.error).toBeUndefined();
  expect(r.where()).toBe("scene39/view55");
  expect(r.keys.filter((k) => k === "ArrowUp")).toHaveLength(2);
  expect(out.said.at(-1)).toMatch(/2 road\(s\): view\d+ -> view\d+ -> view55$/);
});

test("set: refuses the right view name in the wrong room, and says why that matters", async () => {
  // smstack2 has a scene39/view55 too — the walk would have gone somewhere
  // plausible and wrong, which is the fact the guard exists to report
  const r = room({ set: "smstack2", at: ["scene42", "view45"] });
  const out = await run(r.d, "stand", ["view55"], { set: "smstack3" });
  expect(out.error).toBe(
    "stand(view55) expects to be in smstack3 and this is smstack2 — which has a view55 of its own, " +
      "so the walk would have gone somewhere plausible and wrong",
  );
  expect(r.keys).toEqual([]);
});

test("a goal no road reaches is named, with the scenes the room does have", async () => {
  const r = room({
    at: ["scene42", "view45"],
    // scene39 cut off: no road reaches it
    roads: [
      [46, 47],
      [48, 51],
    ],
  });
  const out = await run(r.d, "stand", ["view55"]);
  expect(out.error).toBe(
    "no way through this room from scene42 to scene39 (where view55 is) — " +
      "its scenes are scene42, scene37, scene38, scene39",
  );
  expect(r.keys).toEqual([]);
});

test("a view this room does not have goes to the planner, which a page does not have", async () => {
  const r = room({ at: ["scene42", "view45"] });
  const out = await run(r.d, "stand", ["view99"]);
  expect(out.error).toMatch(/^`stand` needs the pathfinder, which only the Playwright runner has/);
  expect(out.error).toContain("npm run speedrun -w taoot");
});

test("with no room in memory at all, stand asks the planner rather than guessing", async () => {
  const asked: string[] = [];
  setPlanner(async (_c, method, target) => {
    asked.push(`${method} ${target}`);
  });
  const r = room({ at: ["scene42", "view45"], noRoom: true });
  const out = await run(r.d, "stand", ["View55"]);
  expect(out.error).toBeUndefined();
  expect(asked).toEqual(["stand view55"]);
  expect(r.keys).toEqual([]);
});

test("travel and hunt are the planner's, and hand it the target lowercased", async () => {
  const asked: string[] = [];
  setPlanner(async (_c, method, target) => {
    asked.push(`${method} ${target}`);
  });
  const r = room({ at: ["scene42", "view45"] });
  expect((await run(r.d, "travel", ["TURB"])).error).toBeUndefined();
  expect((await run(r.d, "hunt", ["Bag"])).error).toBeUndefined();
  expect(asked).toEqual(["travel turb", "hunt bag"]);
});

test("travel without a planner says how to get the literal lines it would have used", async () => {
  const r = room({ at: ["scene42", "view45"] });
  const out = await run(r.d, "travel", ["gym"]);
  expect(out.error).toMatch(/^`travel` needs the pathfinder/);
  expect(out.error).toContain("paste those in");
});

test("a failure on the walk names the room it was planned in and the route", async () => {
  // the road out of scene42 is drawn, but ArrowUp at View45 goes nowhere: the
  // far end's view id is not in any scene, so the model cannot arrive
  const r = room({
    at: ["scene42", "view46"],
    roads: [[45, 57]],
    scenes: [
      SMSTACK3.scenes[0],
      { name: "scene39", views: [["view55", 55], ["view57", 57]] },
    ],
  });
  // break the arrival: ArrowUp from View45 is swallowed
  const key = (r.d as unknown as { key: (n: string) => Promise<void> }).key;
  (r.d as unknown as { key: (n: string) => Promise<void> }).key = async (n: string) => {
    if (n === "ArrowUp") {
      r.keys.push(n);
      return;
    }
    return key(n);
  };
  const out = await run(r.d, "stand", ["view55"]);
  expect(out.error).toMatch(/^three ArrowUp presses and the world did not move/);
  expect(out.error).toContain("planning in smstack3 (from scene42) via view45 -> view55");
});
