/**
 * A cast pose's PLAY SCRIPT — the thing that says a walker's legs move at half
 * the service rate, and the sibling of tests/auto/shp-play-order.ts.
 *
 * User-reported (#181), with a side-by-side video: "the time needed to reach the
 * player is closely accurate to the original game, but the animation cycle they
 * use while walking is too quick… they appear to be trying to moon walk". Both
 * halves of that were true and they are not in tension. The MOVER was already
 * right — one `actorspeed` of ground per 50 ms pass — while the pictures were
 * being cycled one per pass, and every walk in the game stores ten of them under
 * a twenty-step script: `1,1,2,2,…,10,10`. Repeating a step is how the format
 * HOLDS a picture, exactly as a prop state's does.
 *
 * Reading the script meant grouping a pose's pictures the way the file groups
 * them — by the step number each record carries — instead of eight at a time,
 * and that is the other half of this file: three poses in the corpus store nine
 * or seventeen views rather than eight, so the runtime has to pick one by its
 * depicted ANGLE and not by a slot.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readCstFile, CastPose, CstFile } from "../../src/df/cst";
import { gamefilePath } from "../../tools/gamefiles";
import { ActorRuntime } from "../../src/engine/actors";
import { WorldCamera, bearing } from "../../src/engine/geometry";
import { GameSession } from "../../src/engine/session";
import { NullAudioSink } from "../../src/engine/audio";

const files = new Map<string, CstFile>();
function cast(name: string): CstFile {
  if (!files.has(name)) {
    files.set(name, readCstFile(new Uint8Array(readFileSync(gamefilePath(name)))));
  }
  return files.get(name)!;
}
function pose(file: string, member: string, name: string): CastPose {
  const m = cast(file).members.find((x) => x.name === member);
  const p = m?.poses.find((x) => x.name === name);
  expect(p, `${member}/${name} in ${file}`).toBeTruthy();
  return p!;
}

// --- what the files say -----------------------------------------------------

test("every walk holds each of its ten pictures for two steps (#181)", () => {
  const held = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9];
  let walks = 0;
  for (const file of ["gang.cst", "extra.cst"]) {
    for (const m of cast(file).members) {
      for (const p of m.poses) {
        if (!p.name.startsWith("walk")) continue;
        walks++;
        expect(p.steps.length, `${m.name}/${p.name} pictures`).toBe(10);
        expect(p.play, `${m.name}/${p.name} script`).toEqual(held);
      }
    }
  }
  // 12 in gang.cst (eleven `walk` and cash's `walklj`), 2 in extra.cst
  expect(walks).toBe(14);
});

test("a still pose has a one-step script, so nothing cycles", () => {
  for (const file of ["gang.cst", "extra.cst"]) {
    for (const m of cast(file).members) {
      for (const p of m.poses) {
        if (!p.name.startsWith("stand")) continue;
        expect(p.play, `${m.name}/${p.name}`).toEqual([0]);
      }
    }
  }
  // ...and these two are ONE picture each, not the two and three that reading
  // eight records at a time made of them: they store nine and seventeen views
  expect(pose("gang.cst", "stok1", "stand").steps.length).toBe(1);
  expect(pose("extra.cst", "life1", "stand").steps.length).toBe(1);
});

test("the stoker's shovel is the other authored script", () => {
  // 14 steps over 7 pictures. Read eight at a time these were 8 groups of 8 with
  // a ragged tail, because stok1 stores NINE views of every picture.
  for (const name of ["dig", "throw"]) {
    const p = pose("gang.cst", "stok1", name);
    expect(p.steps.length, name).toBe(7);
    expect(p.play, name).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
    for (const step of p.steps) expect(step.map((f) => f.angle)).toEqual([0, 16, 32, 48, 64, 80, 96, 112, 128]);
  }
});

test("a pose need not store eight views, and two do not", () => {
  // the half circle at four times the resolution: the lifeboat crowd is only
  // ever seen from one side. `direction & 7` folded 8..16 on top of 0..7, so
  // this actor drew the back of the boat for the front of it.
  const life = pose("extra.cst", "life1", "stand");
  expect(life.steps[0].map((f) => f.angle)).toEqual([
    0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120, 128,
  ]);
  // and one that stores a single view, facing 192
  const dead = pose("gang.cst", "willie", "dead");
  expect(dead.steps.length).toBe(1);
  expect(dead.steps[0].map((f) => f.angle)).toEqual([192]);
});

// --- what the runtime does with them ----------------------------------------

/** a camera looking down +y from the origin, so an actor at (0, D) is dead ahead */
const CAM: WorldCamera = { x: 0, y: 0, z: 0, deg: 0, f: 320, cx: 320, cy: 240, clipW: 640, clipH: 480 };
const PROJ = { x: 320, y: 240, depth: 1000 };

/** the sprite an actor is drawing right now, as its container location */
function drawn(rt: ActorRuntime, name: string): number {
  const a = rt.get(name)!;
  const r = rt.rect(a, PROJ, CAM);
  expect(r, `${name} has a frame`).toBeTruthy();
  // rect() hands back the decoded frame; the cast caches one per container, so
  // identity is the container — which is what we want to compare pictures by
  const pose = a.pose()!;
  for (const step of pose.steps) {
    for (const f of step) if (a.cast.frame(f.location) === r!.f) return f.location;
  }
  throw new Error(`${name}'s frame is in no step of ${pose.name}`);
}

function walker(): { rt: ActorRuntime; name: string } {
  const rt = new ActorRuntime();
  rt.addCast("gang.cst", cast("gang.cst"));
  const a = rt.get("morrow")!;
  a.visible = true;
  a.scale = 1000;
  a.poseName = "walk";
  a.worldY = 2000; // straight ahead of CAM, facing it
  a.deg = 128;
  return { rt, name: "morrow" };
}

test("a walk cycle takes twenty passes, two per picture (#181)", () => {
  const { rt } = walker();
  const shown: number[] = [];
  for (let pass = 0; pass < 40; pass++) {
    shown.push(drawn(rt, "morrow"));
    rt.advanceAnimation();
  }
  // ten pictures, each held for two passes, twice round
  const cycle = shown.slice(0, 20);
  expect(shown.slice(20)).toEqual(cycle);
  expect(new Set(cycle).size).toBe(10);
  for (let i = 0; i < 20; i += 2) expect(cycle[i], `pass ${i}`).toBe(cycle[i + 1]);
  // and the ten are distinct and in order — this is the assertion that fails at
  // 0.9.29, where twenty passes ran the cycle twice
  for (let i = 2; i < 20; i += 2) expect(cycle[i]).not.toBe(cycle[i - 2]);
});

test("a still actor never changes picture, however long it stands", () => {
  const rt = new ActorRuntime();
  rt.addCast("gang.cst", cast("gang.cst"));
  const a = rt.get("morrow")!;
  a.visible = true;
  a.scale = 1000;
  a.worldY = 2000;
  const first = drawn(rt, "morrow");
  for (let pass = 0; pass < 100; pass++) rt.advanceAnimation();
  expect(a.step).toBe(0);
  expect(drawn(rt, "morrow")).toBe(first);
});

test("the picture is picked by depicted angle, not by slot", () => {
  const rt = new ActorRuntime();
  rt.addCast("extra.cst", cast("extra.cst"));
  const a = rt.get("life1")!;
  a.visible = true;
  a.scale = 1000;
  a.worldY = 2000;
  const views = pose("extra.cst", "life1", "stand").steps[0];
  // the actor→camera bearing is 192 from where CAM stands, so a facing of
  // 192 + N shows the view depicted at N. Every one of the seventeen must be
  // reachable; under `direction & 7` nine were unreachable and the rest wrong.
  const FACING = bearing(CAM.x - a.worldX, CAM.y - a.worldY);
  expect(FACING).toBe(192);
  for (const view of views) {
    a.deg = (FACING + view.angle) & 0xff;
    expect(drawn(rt, "life1"), `angle ${view.angle}`).toBe(view.location);
  }
  // ...and a bearing between two stored views rounds to the nearer one
  a.deg = (FACING + 4) & 0xff;
  expect([views[0].location, views[1].location]).toContain(drawn(rt, "life1"));
});

// --- and where the advance comes from ---------------------------------------

test("the animation advances once per 50 ms service pass, not per frame", () => {
  const session = new GameSession(() => null, new NullAudioSink());
  session.onLog = () => {};
  session.actorRuntime.addCast("gang.cst", cast("gang.cst"));
  const a = session.actorRuntime.get("morrow")!;
  a.poseName = "walk";
  session.tickTime(0); // the first tick only sets the anchor
  session.tickTime(1000);
  // twenty passes in a second: one whole cycle, back where it started
  expect(a.step).toBe(0);
  session.tickTime(1500);
  expect(a.step).toBe(10);
});
