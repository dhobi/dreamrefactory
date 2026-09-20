/**
 * The cast's AUTHORED ROUTES, and who is allowed to know about them.
 *
 *   npx vitest run dust/tests/patrol.ts
 *
 * Reported as #394: "Loaded save `D1E_003`, exited the saloon, and attempted to
 * talk to Mayor's Wife. She started walking diagonally through the buildings to
 * get to the other end of her walking loop directly, rather than following the
 * streets around."
 *
 * She did, and where the walk is STARTED from is the whole of it. Her patrol is
 * armed by `SALLOWER.SET`'s door `keydown` — inside the saloon, on the press
 * that leaves it:
 *
 *     if day = 1 & phase < 3 & playercash > 5
 *         phase = 3
 *         ...
 *         sendtoactor ("mwife", setupactor ("street"))
 *     endif
 *     sendtostage (gototown ("east"))        <- the set changes only now
 *
 * and `setupactor ("street")` ends in `moveactor ("town.mwife2")`, which is
 * `walktostar`. The destination resolved, because `GameSession.starRegistry`
 * remembers the stars of every set visited; the ROUTE did not, because that
 * lookup asked the set that was OPEN — the saloon, which has never heard of
 * `town.mwife1 <-> town.mwife2`. So she set off across the town in a straight
 * line, and only the legs after her first arrival (`endwalk`, which runs with
 * the town open) followed the streets. Hence "on first walk cycle".
 *
 * Skipped, not failed, without the disc (the bargain dust/tests/saves.ts makes).
 */
import { test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { SetScripts } from "@dreamfactory/engine/runtime/setscripts";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { parseSaveV1 } from "@dreamfactory/engine/df/savegame-v1";

/* anchored to this file, not the working directory — see dust/tests/movies.ts */
const CD = fileURLToPath(new URL("../gamefiles/dustcd", import.meta.url));
const SAVES = fileURLToPath(new URL("../gamefiles/save", import.meta.url));
const DIRS = ["DATA", "PUPPETS", "MOVIES", "INVEN", "SALGAMES"];

/** a session that serves the disc, by name, wherever on it the file lives */
function newSession(logs: string[] = []): GameSession {
  const session = new GameSession((name) => {
    for (const d of DIRS) {
      const path = `${CD}/${d}/${name.toUpperCase()}`;
      if (existsSync(path)) return new Uint8Array(readFileSync(path));
    }
    return null;
  }, new NullAudioSink());
  session.onLog = (m) => logs.push(m);
  session.dfVersion = 1; // what dust/src/main.ts says at boot
  return session;
}

/**
 * The player has walked the night town and is now standing in the saloon —
 * which is the state the report is made from, and the only state that matters:
 * two sets have been bound, and the walk is about to be started from the wrong
 * one of them.
 */
async function inTheSaloon(logs: string[] = []): Promise<GameSession> {
  const session = newSession(logs);
  expect(await session.openCastFile("gang.cst"), "gang.cst opens").toBe(true);
  const nite = session.loadSet("nite.set")!;
  expect(nite, "nite.set parses").toBeTruthy();
  new SetScripts(nite, session).onLog = (l) => logs.push(l);
  // what the viewer's bind does on every set open, so a star is findable by
  // name from another room (viewer.ts: `session.starRegistry.set(...)`)
  for (const a of nite.actors) session.starRegistry.set(a.identifier.toLowerCase(), a);
  const sal = session.loadSet("sallower.set")!;
  expect(sal, "sallower.set parses").toBeTruthy();
  new SetScripts(sal, session).onLog = (l) => logs.push(l);
  session.actorRuntime.currentSet = "sallower";
  return session;
}

test("a patrol armed from another room still follows the streets", async () => {
  if (!existsSync(`${CD}/DATA/NITE.SET`)) {
    console.warn(`no ${CD} — skipping (needs the Dust rip)`);
    return;
  }
  const session = await inTheSaloon();
  expect(
    session.starPathRegistry.has("town.mwife1|town.mwife2"),
    "the night town's twelve routes are remembered, hers among them",
  ).toBe(true);

  // the saloon door's own line, run where the saloon runs it
  const mwife = session.actorRuntime.get("mwife")!;
  await session.interp.runHandler(
    session.castScripts.get("mwife")!, "setupactor", ["street"], { me: "mwife", target: "" },
  );

  // she is placed by the registry, as she always was
  expect([mwife.setName, mwife.worldX, mwife.worldY], "she stands on town.mwife1").toEqual([
    "town", 1596, 904,
  ]);

  // ...and she walks the authored route rather than the straight line. The
  // sentinel matters as much as the shape: `gang.cst` reads `actorstar (who) =
  // "walkonpath"` to find out what kind of walk it is interrupting.
  expect(mwife.starName, "the walk is a route walk").toBe("walkonpath");
  const walk = session.scheduler.walks.get("mwife")!;
  expect(walk, "she sets off").toBeTruthy();
  expect(walk.arriveStar, "...for the far end of her loop").toBe("town.mwife2");
  expect(walk.path?.length, "...along the polyline the SET carries").toBe(14);

  /*
   * And the counterfactual, because "she is walking" cannot tell a route from a
   * shortcut: the two stars are 1524 units apart as the crow flies — the walk
   * this used to start measured 1522, the engine's truncating isqrt of the same
   * line — while the street route is 2003. A walk that measures the short one
   * is the bug back.
   */
  const end = walk.path![walk.path!.length - 1];
  const straight = Math.round(Math.hypot(end.x - 1596, end.y - 904));
  expect(straight, "the diagonal through the buildings").toBe(1524);
  expect(walk.dist, "the way round by the street is longer").toBe(2003);
});

test("a pair with no authored route still walks the straight line", async () => {
  if (!existsSync(`${CD}/DATA/NITE.SET`)) return;
  const session = await inTheSaloon();
  const mwife = session.actorRuntime.get("mwife")!;
  const call = (name: string, args: (string | number)[]) =>
    (session.interp.builtins.get(name) as (i: unknown, a: (string | number)[]) => unknown)(
      session.interp, args,
    );

  // town.mwife3 is a star of the same set with no route to town.mwife1 — the
  // corpus pairs only twelve of its forty-eight stars, so the straight line has
  // to remain the answer for the rest of them
  call("actorset", ["mwife", "town"]);
  call("actorstar", ["mwife", "town.mwife1"]);
  call("walktostar", ["mwife", "town.mwife3"]);
  expect(mwife.starName, "no route, so the ordinary walk sentinel").toBe("defer");
  expect(session.scheduler.walks.get("mwife")?.path, "and no polyline").toBeFalsy();
});

test("the disc's own saves say DF.EXE walked this patrol on its route", () => {
  if (!existsSync(`${SAVES}/D1E_005.RTD`)) {
    console.warn(`no ${SAVES} — skipping (needs the shipped saves)`);
    return;
  }
  /*
   * Written by the original engine, during this very patrol on the evening of
   * day 1 — the same stretch of game the report is from. `hasPath` is the walk
   * record's own flag and `walkonpath` the star sentinel DF.EXE leaves while a
   * route walk is in flight, so these two files are the statement that the
   * first leg of a patrol is a route walk there as well.
   */
  for (const name of ["D1E_005", "D1E_006"]) {
    const save = parseSaveV1(new Uint8Array(readFileSync(`${SAVES}/${name}.RTD`)));
    const walk = save.walks.find((w) => w.actor.toLowerCase() === "mwife");
    expect.soft(walk?.star, `${name}: she is walking her loop`).toBe("town.mwife1");
    expect.soft(walk?.hasPath, `${name}: on an authored route`).toBe(true);
    expect
      .soft(save.actors.find((a) => a.name.toLowerCase() === "mwife")?.star, `${name}: and says so`)
      .toBe("walkonpath");
  }
});
