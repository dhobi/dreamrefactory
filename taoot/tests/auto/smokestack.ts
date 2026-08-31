/**
 * The false smokestack's four mazes, and what each one LOOKS like.
 *
 * Reported as non-deterministic (#339): a runner who knows the disc's four fixed
 * patterns climbed the port's stack, read the pattern off the crates, and got a
 * different maze than the debug readout named — "the entry pattern and maze seem
 * independently random".
 *
 * The maze itself is not. `mazenumber = random(4)` is drawn once at the door
 * (ENGINE.SET c1's keydown at View120) and everything after it is the disc's own
 * table: `SMSTACK2.SET` c1's `setupblocks()` maps (maze, level) to a comma-list of
 * shut gaps, `pathblocked` reads that list to refuse a walk, and `openscene` places
 * the eight crate props on the eight stars the SET carries (`2.1`…`2.8`). The first
 * four tests here pin all of that, including the four signatures runners read the
 * maze by.
 *
 * ## What the report was: crates from the last climb (the load)
 *
 * The screenshot on the issue is Scene37/View47, Maze 1, Level 2 — with a crate
 * across the shaft, where maze 1 has none. Above the climb its log reads
 * `loadgame: …`, `opensetfile("engine.set", …)`, `left smstack2: freed 10.5 MB`:
 * a checkpoint loaded OUT of the smokestack, and then a walk back in. The crate is
 * the previous climb's, and the load is what let it through — see the note in
 * runtime/saveload.ts. `setupblocks()` only ever makes gaps visible, so leftovers
 * accumulate on top of whatever the new maze draws, which is a floor wearing two
 * mazes at once.
 *
 * ## The other half: the entry is not the same for every ladder
 *
 * A second thing, real but not a bug, and worth pinning because it will be read
 * as one. The runners' rules hold for ONE of the four ladders. `smstack1` has four
 * (View42, View58, View59, View57), they land on four standpoints of the
 * eight-scene ring (Scene37, Scene38, Scene39, Scene42), and the crate list is
 * positions on that ring — so the same maze presents four different first
 * impressions, and two of them are another maze's signature exactly: maze 1 up the
 * View58 ladder shows one distant crate that does not block, which is the rule for
 * maze 3. Going back DOWN always lands at `smstack1` Scene10/View42 (SMSTACK2.SET
 * c5), the Scene37 ladder, so a down-and-up always returns you to the entry the
 * rules assume.
 *
 * Levels 3 and up have no such freedom: every climb arrives at Scene37/View50
 * (c54), so only the first floor's entry is the player's to choose.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newHost, root } from "../harness";
import { snapshotSave, loadGame } from "@dreamfactory/engine/runtime/saveload";
import { sceneryOccludes } from "@dreamfactory/engine/runtime/geometry";
import type { GameSession } from "@dreamfactory/engine/runtime/session";

/** `blocks` per (maze, level) — transcribed from SMSTACK2.SET c1 `setupblocks()` */
const SETUPBLOCKS: Record<number, Record<number, string>> = {
  1: { 2: "1,5,", 3: "2,6,", 4: "3,6,", 5: "5,", 6: "2,7,", 7: "2,5,7,", 8: "2,4,6,8,", 9: "1,3,6,7,", 10: "1,3,5," },
  2: { 2: "1,", 3: "3,8,", 4: "8,", 5: "3,", 6: "6,7,", 7: "5,8,", 8: "1,6,8,", 9: "3,7,", 10: "1,4,5,6,7,8," },
  3: { 2: "3,8,", 3: "1,", 4: "1,2,3,7,8,", 5: "5,6,8,", 6: "1,4,6,", 7: "3,5,7,8,", 8: "4,6,8,", 9: "3,4,6,8,", 10: "1,2,4,5,7," },
  4: { 2: "2,3,5,6,8,", 3: "1,3,4,6,7,", 4: "3,6,", 5: "2,4,7,8,", 6: "1,5,", 7: "1,3,6,", 8: "2,4,7,", 9: "2,3,5,6,8,", 10: "1,6," },
};

/**
 * `smstack1`'s four ways up: the ladder view, the standpoint it lands on, the
 * view it lands facing, and the view ONE RIGHT TURN reaches — which is where the
 * runners read the maze. All four from the files: the ladders are SMSTACK1.SET
 * c46/c101/c156/c211, the turn is SMSTACK2.SET's own turn ring.
 */
const LADDERS = [
  { ladder: "view42", scene: "scene37", land: "view50", right: "view47" },
  { ladder: "view58", scene: "scene38", land: "view54", right: "view51" },
  { ladder: "view59", scene: "scene39", land: "view56", right: "view58" },
  { ladder: "view57", scene: "scene42", land: "view43", right: "view45" },
];

/** the four rules runners use, as the port's own terms: is the way ahead shut,
 *  and is the nearest crate you can see in your face or across the shaft? */
type Sight = "clear" | "distant" | "blocked";

/**
 * What the player SEES: the crates that reach the screen through this view, after
 * the SET's own Z image has hidden the ones behind the stack wall. Counted in
 * pixels rather than taken from the draw list, because a crate at the far side of
 * the ring is in the draw list and behind a wall — which is the whole difference
 * between "boxes in the distance" and nothing at all.
 */
function sight(host: { viewer: unknown }, session: GameSession): { kind: Sight; detail: string } {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const viewer = (host as any).viewer;
  const props = session.propRuntime as any;
  const cam = viewer.worldCamera();
  const occ = viewer.roomOcclusion();
  let nearest = Infinity;
  const shown: string[] = [];
  for (const { p, proj } of props.worldDrawList(cam)) {
    const r = props.worldRect(p, proj, cam);
    let px = 0;
    for (let ty = Math.max(0, r.y); ty < Math.min(cam.clipH, r.y + r.h); ty++) {
      const sy = Math.min(r.f.height - 1, Math.floor((ty - r.y) / r.k));
      for (let tx = Math.max(0, r.x); tx < Math.min(cam.clipW, r.x + r.w); tx++) {
        const sx = Math.min(r.f.width - 1, Math.floor((tx - r.x) / r.k));
        if (!r.f.opaque[sy * r.f.width + sx]) continue;
        if (occ && sceneryOccludes(occ, tx, ty, props.occludeAt(p, proj.depth, occ))) continue;
        px++;
      }
    }
    if (!px) continue;
    shown.push(`${p.name}@${Math.round(proj.depth)}`);
    nearest = Math.min(nearest, proj.depth);
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const blocked = !!Number(session.interp.globals.get("blocked"));
  const kind: Sight = blocked ? "blocked" : shown.length ? "distant" : "clear";
  return { kind, detail: `${shown.join(" ") || "nothing"}${blocked ? " BLOCKED" : ""}` };
}

/** climb from the door to `stacklevel` 2 by the named ladder, as the scripts do */
async function climbTo(session: GameSession, maze: number, ladder: (typeof LADDERS)[number]) {
  const g = session.interp.globals;
  g.set("tour", 0);
  g.set("mazenumber", maze);
  // ENGINE.SET c1: mazenumber, then changeset into smstack1 — SMSTACK1's openset
  // sets stacklevel to 1, and the ladder's own keydown sets it to 2 before the move
  await session.runGlobal("changeset", ["smstack1", "scene14", "view40"]);
  g.set("stacklevel", 2);
  await session.runGlobal("changeset", ["smstack2", ladder.scene, ladder.land]);
  await session.settle();
}

test("smokestack: every (maze, level) shuts exactly the gaps the disc's table names", async () => {
  const { session } = await newHost();
  await session.ensureBooted();
  const g = session.interp.globals;
  const got: Record<string, string> = {};
  const want: Record<string, string> = {};
  for (const maze of [1, 2, 3, 4]) {
    for (let level = 2; level <= 10; level++) {
      g.set("tour", 0);
      g.set("mazenumber", maze);
      g.set("stacklevel", level);
      g.set("blocks", "not run");
      await session.runGlobal("changeset", ["smstack2", "scene37", "view50"]);
      await session.settle();
      got[`${maze}.${level}`] = String(g.get("blocks") ?? "");
      want[`${maze}.${level}`] = SETUPBLOCKS[maze][level];
    }
  }
  expect(got).toEqual(want);
  // ...and the eleventh floor is the top: `stackmax` is what sends you to smstack3
  expect(Number(g.get("stackmax"))).toBe(11);
});

test("smokestack: the crates a floor shows do not depend on how you got to it", async () => {
  const { session } = await newHost();
  await session.ensureBooted();
  const g = session.interp.globals;
  const snap = (): string =>
    [1, 2, 3, 4, 5, 6, 7, 8]
      .map((i) => {
        const p = session.propRuntime.get(`block${i}`);
        return p ? `${i}:${p.visible ? "v" : "-"}${p.starName}@${p.worldX},${p.worldY}/z=${p.zclip}` : `${i}:none`;
      })
      .join(" ");

  await climbTo(session, 1, LADDERS[0]);
  const first = snap();
  // down (SMSTACK2 c5 — always to smstack1 Scene10/View42) and straight back up
  g.set("stacklevel", 1);
  await session.runGlobal("changeset", ["smstack1", "scene10", "view42"]);
  g.set("stacklevel", 2);
  await session.runGlobal("changeset", ["smstack2", "scene37", "view50"]);
  await session.settle();
  expect(snap()).toBe(first);
  // and the crates are the ones `blocks` names, at the stars the SET carries
  expect(g.get("blocks")).toBe("1,5,");
  expect(first).toContain("1:v2.1");
  expect(first).toContain("5:v2.5");
  expect(first).toContain("2:-");
});

test("smokestack: a shut gap refuses the walk and an open one takes it", async () => {
  const { host, session } = await newHost();
  await session.ensureBooted();
  const verdict: Record<string, string> = {};
  for (const maze of [1, 4]) {
    for (const view of ["view47", "view48"]) {
      await climbTo(session, maze, LADDERS[0]);
      session.viewJumpDriver?.(view);
      await session.settle();
      const blocked = !!Number(session.interp.globals.get("blocked"));
      await host.viewer!.pressNav("uparrow");
      await session.settle();
      for (let i = 0; i < 200; i++) {
        host.viewer!.tick(i * 16);
        await session.settle();
      }
      const moved = session.currentSceneName?.() !== "scene37" || session.currentViewName?.() !== view;
      verdict[`maze${maze} ${view}`] = `${blocked ? "shut" : "open"}/${moved ? "walked" : "stayed"}`;
    }
  }
  // gap 2 is the View47 doorway and gap 1 the View48 doorway (SMSTACK2 c1
  // `pathblocked`); maze 1 shuts 1 and 5, maze 4 shuts 2, 3, 5, 6 and 8
  expect(verdict).toEqual({
    "maze1 view47": "open/walked",
    "maze1 view48": "shut/stayed",
    "maze4 view47": "shut/stayed",
    "maze4 view48": "open/walked",
  });
});

test("smokestack: the four mazes read as the four rules — from the Scene37 ladder", async () => {
  const { host, session } = await newHost();
  await session.ensureBooted();
  const read: Record<number, string> = {};
  for (const maze of [1, 2, 3, 4]) {
    await climbTo(session, maze, LADDERS[0]);
    session.viewJumpDriver?.(LADDERS[0].right);
    await session.settle();
    read[maze] = sight(host, session).kind;
  }
  // Thundertala's rules, quoted in #339: maze 4 is blocked at once, maze 3 shows
  // crates across the shaft that do not block, and 1 and 2 show nothing at all
  // (they are told apart a floor higher).
  expect(read).toEqual({ 1: "clear", 2: "clear", 3: "distant", 4: "blocked" });
});

test("smokestack: ...and read as a DIFFERENT maze from any other ladder (#339)", async () => {
  const { host, session } = await newHost();
  await session.ensureBooted();
  const grid: Record<string, string> = {};
  for (const maze of [1, 2, 3, 4]) {
    for (const l of LADDERS) {
      await climbTo(session, maze, l);
      session.viewJumpDriver?.(l.right);
      await session.settle();
      grid[`maze${maze} ${l.scene}`] = sight(host, session).kind;
    }
  }
  expect(grid).toEqual({
    "maze1 scene37": "clear",   "maze1 scene38": "distant", "maze1 scene39": "clear",   "maze1 scene42": "distant",
    "maze2 scene37": "clear",   "maze2 scene38": "distant", "maze2 scene39": "clear",   "maze2 scene42": "clear",
    "maze3 scene37": "distant", "maze3 scene38": "blocked", "maze3 scene39": "clear",   "maze3 scene42": "clear",
    "maze4 scene37": "blocked", "maze4 scene38": "blocked", "maze4 scene39": "blocked", "maze4 scene42": "distant",
  });
  // the report, in one line: maze 1 up the View58 ladder is maze 3's signature
  expect(grid["maze1 scene38"]).toBe(grid["maze3 scene37"]);
});

test("smokestack: a checkpoint loaded out of the stack leaves no crates behind (#339)", async () => {
  const { session } = await newHost();
  await session.ensureBooted();
  const g = session.interp.globals;
  g.set("tour", 0);
  g.set("mission", 3);
  g.set("phase", 2);
  const visible = (): string =>
    [1, 2, 3, 4, 5, 6, 7, 8]
      .filter((i) => session.propRuntime.get(`block${i}`)?.visible)
      .join(",") || "none";

  // the checkpoint the report was taken against: standing at the smokestack door,
  // in engine.set, where `smstack.shp` is not open and so no crate is in the file
  await session.runGlobal("changeset", ["engine", "scene110", "view120"]);
  await session.settle();
  session.saveTemplate = () =>
    new Uint8Array(readFileSync(join(root, "en/save/1/03 - Found the Gymnasium.ti")));
  const checkpoint = snapshotSave(session)!;

  const seen: Record<string, string> = {};
  const want: Record<string, string> = {};
  for (const before of [1, 2, 3, 4]) {
    for (const after of [1, 2, 3, 4]) {
      await climbTo(session, before, LADDERS[0]);
      // ...load it from inside the stack, which is the reporter's log exactly
      await loadGame(session, checkpoint);
      await session.settle();
      expect(visible(), `crates survived the load itself (${before} -> ${after})`).toBe("none");
      await climbTo(session, after, LADDERS[0]);
      seen[`${before}->${after}`] = visible();
      want[`${before}->${after}`] = String(g.get("blocks") ?? "").replace(/,$/, "");
    }
  }
  // every floor wears its own maze and only its own
  expect(seen).toEqual(want);
});
