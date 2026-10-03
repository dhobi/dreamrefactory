/**
 * The speedrun's way up the false smokestack (`src/speedrun/nav/smokestack.ts`):
 * a shortest climb planned over `setupblocks()`'s own table, with no rip.
 *
 *   npx vitest run --project taoot taoot/tests/auto/stack-plan.ts
 *
 * The playthrough climbs it against the game (tests/playthrough/nav/
 * smokestack.ts) and `tests/auto/smokestack.ts` pins the mazes themselves; this
 * is the planner's own arithmetic. The claims are the module's: every maze
 * climbs from scene37 in 18 moves, so the route needs no branch on the maze's
 * entry; maze 4 has no way up from scene39; and a plan is a chain — each move
 * starts where the last one landed, a walk keeps its level and goes round the
 * ring by that scene's own exit, and a climb is a ladder scene's, one level up,
 * the last of them into `smstack3` from the top.
 */
import { describe, expect, it } from "vitest";
import {
  STACK_ENTRIES,
  STACK_LADDER,
  STACK_RING,
  STACK_TOP,
  STACK_WALK,
  type StackMove,
  pickEntry,
  planStack,
} from "../../src/speedrun/nav/smokestack";

/** the plan is a chain the game would let a player walk */
function walkable(plan: StackMove[], entry: string): void {
  let at = entry;
  let level = 2;
  plan.forEach((m, n) => {
    expect(m.from, `move ${n} starts where the last landed`).toBe(at);
    const i = STACK_RING.indexOf(m.from as (typeof STACK_RING)[number]);
    if (m.kind === "climb") {
      expect(m.view).toBe(STACK_LADDER[m.from]);
      if (n === plan.length - 1) {
        expect(m.to).toBe("smstack3");
        expect(m.level).toBe(STACK_TOP);
      } else {
        expect(m.to).toBe(STACK_RING[(i + 1) % 8]);
        expect(m.level).toBe(level + 1);
      }
      level = m.level;
    } else {
      expect(m.level).toBe(level);
      const fwd = m.to === STACK_RING[(i + 1) % 8];
      expect(fwd || m.to === STACK_RING[(i + 7) % 8]).toBe(true);
      expect(m.view).toBe(fwd ? STACK_WALK[m.from].fwd : STACK_WALK[m.from].back);
    }
    at = m.to;
  });
  expect(at).toBe("smstack3");
}

describe("the smokestack's planner", () => {
  it("climbs every maze from scene37, in 18 moves", () => {
    for (const maze of [1, 2, 3, 4]) {
      const got = pickEntry(maze)!;
      expect(got.entry).toEqual({ stand: "view42", scene: "scene37" });
      expect(got.plan).toHaveLength(18);
      walkable(got.plan, "scene37");
    }
  });

  it("plans a walkable climb from every other entry that has one", () => {
    const dead: string[] = [];
    for (const maze of [1, 2, 3, 4]) {
      for (const { scene } of STACK_ENTRIES) {
        const plan = planStack(maze, scene);
        if (plan) walkable(plan, scene);
        else dead.push(`${maze} ${scene}`);
      }
    }
    expect(dead).toEqual(["4 scene39"]);
  });

  it("answers nothing for a maze or an entry that is not one", () => {
    expect(planStack(5, "scene37")).toBeNull();
    expect(planStack(1, "scene64x")).toBeNull();
    expect(pickEntry(0)).toBeNull();
  });
});
