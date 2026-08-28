/**
 * The shooting range, which is the game's one room built out of 2D actors.
 *
 * Reported (#292): "Tried the shooting range and the target's didn't appear. I
 * can hear the 'flip' and 'flop' sounds of the round targets coming up and down,
 * but don't see them. Trying to shoot where the props should be results in
 * nothing happening. (They aren't there.)" — and the log said why, twice:
 *
 *     ? actorxy("vanetarg", 92, 160)
 *     ? actoris3d("chicken1targ", 1)
 *
 * A `?` line is the interpreter's own account of a call it has no builtin for:
 * `Interpreter.onUnknown` returns 0 and says so. Two opcodes, and between them
 * the whole 2D half of DreamFactory 1's actor model — which this room is:
 *
 *   - `actoris3d (name, flag)` declares an actor to be IN THE WORLD. `TARGET.CST`
 *     marks the tower, the three water jets and the three birds, and leaves the
 *     rest alone: those are out in the scene, where the camera sees round them.
 *   - `actorxy (name, x, y)` places the others at SCREEN pixels, because they are
 *     a painted fairground booth — three bottles, three cans, a weathervane, a
 *     dummy and seven pop-up targets.
 *
 * With neither, all fourteen were placed nowhere and drawn nowhere, and a shot
 * that should have found one found the scene behind it.
 *
 * The third thing this room needs is the NAME an actor answers to. Two of the
 * three bottles and two of the three birds are `actorinstance` copies of one cast
 * member, and the range's shot handler is
 *
 *     temp = hittest (thepoint)
 *     if clickfire (temp) = true
 *         sendtoactor (temp, hit ())
 *
 * so a hit reports a name and the name is who breaks. Every read went through the
 * cast MEMBER, so all three bottles answered "bottle1targ" — shoot the middle one
 * and the left one shatters.
 *
 * Skipped, not failed, without the disc (the bargain dust/tests/saves.ts makes).
 */
import { test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { sniffScript } from "@dreamfactory/engine/df/script";
import { parseScript } from "@dreamfactory/engine/runtime/parser";
import { ScriptInstance } from "@dreamfactory/engine/runtime/interp";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";

/* anchored to this file, not the working directory — see dust/tests/movies.ts */
const TARGET = fileURLToPath(new URL("../gamefiles/dustcd/TARGET", import.meta.url));

/** a session that serves the range's own files, by name */
function newSession(): GameSession {
  const session = new GameSession((n) => {
    const path = `${TARGET}/${n.toUpperCase()}`;
    return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
  }, new NullAudioSink());
  session.onLog = () => {};
  session.dfVersion = 1; // what dust/src/main.ts says at boot
  return session;
}

/** every script container of a DreamFactory file, parsed */
function scripts(path: string, name: string): ScriptInstance[] {
  const container = readContainerFile(new Uint8Array(readFileSync(path)));
  const out: ScriptInstance[] = [];
  for (let i = 0; i < container.containers.length; i++) {
    const tokens = sniffScript(container.containers[i].data);
    if (!tokens) continue;
    try {
      out.push(new ScriptInstance(`${name}:${i}`, parseScript(tokens)));
    } catch {
      /* a picture that sniffed as a script — the parse is the real filter */
    }
  }
  return out;
}

test("the range's targets are placed, drawn and hit where the booth is", async () => {
  if (!existsSync(`${TARGET}/TARGET.CST`)) {
    console.warn(`no ${TARGET} — skipping (needs the Dust rip)`);
    return;
  }
  const session = newSession();
  expect(await session.openCastFile("target.cst"), "target.cst opens").toBe(true);
  const all = scripts(`${TARGET}/TARGET.CST`, "target.cst");
  const main = all.find((s) => s.script.codes.has("initactors"))!;
  expect(main, "initactors() is in the cast").toBeTruthy();
  session.interp.fallbackScripts = all;
  session.interp.globals.set("day", 1); // day 2 and 3 add the pig and the chicken
  const R = session.actorRuntime;
  R.currentSet = "target";

  await session.interp.runHandler(main, "initactors", [], { me: "target.cst", target: "" });

  // 1. the split the room is built on. The 3D ones are the scene's — and note
  // `towertarg` is BOTH declared 3d and given world coordinates, which is the
  // pair of statements that says the flag and the placement agree.
  for (const name of ["towertarg", "water1", "water2", "water3", "birdtarg", "birdtarg2", "birdtarg3"]) {
    const a = R.get(name);
    expect.soft(a?.worldSpace, `${name} is in the world`).toBe(true);
  }
  for (const name of ["bottle1targ", "bottle2targ", "bottle3targ", "can1targ", "can2targ", "can3targ",
    "vanetarg", "dummytarg", "target1", "target7"]) {
    const a = R.get(name);
    expect.soft(a?.worldSpace, `${name} is painted on the screen`).toBe(false);
  }
  // the tower took its coordinates as well as its flag
  expect(
    [R.get("towertarg")!.worldX, R.get("towertarg")!.worldY, R.get("towertarg")!.worldZ],
    "the tower stands where the set puts it",
  ).toEqual([2212, 3500, 232]);

  // 2. placed at the pixels the cast names, and the getter answers them back
  expect([R.get("bottle2targ")!.anchorX, R.get("bottle2targ")!.anchorY], "bottle 2").toEqual([236, 133]);
  const call = (name: string, args: (string | number)[]) =>
    (session.interp.builtins.get(name) as (i: unknown, a: (string | number)[]) => unknown)(
      session.interp,
      args,
    );
  expect(call("actorxy", ["bottle2targ", 1]), "actorxy(name, 1) reads x back").toBe(236);
  expect(call("actorxy", ["bottle2targ", 2]), "actorxy(name, 2) reads y back").toBe(133);
  expect(call("actoris3d", ["towertarg"]), "actoris3d reads back as a getter").toBe(1);
  // `actordist (name, n)` is a WRITE of the screen order, not a distance — the
  // dummy is the corpus's only caller, and -2 is in propdist's number space
  expect(R.get("dummytarg")!.dist, "the dummy's place in the screen order").toBe(-2);

  // 3. drawn: the six bottles and cans, the vane, and nothing that is hidden or
  // in the world. The seven pop-up targets start invisible (the range raises
  // them), which is why they are not in this list.
  const drawn = R.screenDrawList().map((a) => a.name);
  expect([...drawn].sort(), "what the booth shows at day 1").toEqual(
    ["bottle1targ", "bottle2targ", "bottle3targ", "can1targ", "can2targ", "can3targ", "vanetarg"].sort(),
  );
  // ...and each has a rect with pixels in it, at 1:1 — a 2D actor is not scaled
  // by a depth it does not have, which is what lines the bottles up with the
  // shelf they stand on
  for (const a of R.screenDrawList()) {
    const r = R.screenRect(a);
    expect.soft(!!r && r.w > 0 && r.h > 0, `${a.name} has a sprite to draw`).toBe(true);
  }

  // 4. shot. `hittest` is what the range asks, and the answer has to be the
  // INSTANCE — two of these three bottles are copies of the first one's member.
  const hitAt = (x: number, y: number) => R.actorAt(x, y)?.name ?? null;
  const somewhereOn = (name: string) => {
    const a = R.get(name)!;
    const r = R.screenRect(a)!;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (r.f.opaque[(y - r.y) * r.f.width + (x - r.x)]) return [x, y] as const;
      }
    }
    throw new Error(`${name} has no opaque pixel`);
  };
  for (const name of ["bottle1targ", "bottle2targ", "bottle3targ", "can2targ"]) {
    const [x, y] = somewhereOn(name);
    expect.soft(hitAt(x, y), `a shot at ${name} (${x},${y}) hits ${name}`).toBe(name);
  }
  // and a shot into the sky hits nobody, so `clickfire` gets the scene instead
  expect(hitAt(8, 8), "a shot into the sky").toBe(null);

  // 5. a target the range has put away is not hittable, which is the other half
  // of "the targets appear": they come and go, and the pop-up ones start away
  const bottle = R.get("bottle1targ")!;
  const [bx, by] = somewhereOn("bottle1targ");
  bottle.visible = false;
  expect(hitAt(bx, by), "a bottle already broken cannot be hit again").toBe(null);
  expect(R.screenDrawList().map((a) => a.name), "...nor drawn").not.toContain("bottle1targ");
});
