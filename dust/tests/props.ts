/**
 * A prop that belongs to a SET — the three things Dust needs from that idea, all
 * three of which #290 caught at once.
 *
 * The report: sleep at the Mayor's house from night 1 to morning 2, and the
 * morning opens with a pile of dung, a tumbleweed and a vase of flowers stacked
 * in mid-air at the centre of the view, unchanged by turning or walking between
 * rooms, and clickable. What the engine said while doing it —
 * `sendtoprop("dung2", setupprop(..)) — target not loaded` — is the third of the
 * three.
 *
 *   1. **`propset` is what makes a prop scenery.** `HOUSE.PRP`'s dung is
 *      `propset (me, "town")`, `propvisible`, `propscale (500)`, `propdeg (random
 *      (255))` — and the position arrives later and from elsewhere
 *      (`randomloc ()` when the town opens). The port stored the set name and
 *      left the prop in the SCREEN draw list, pinned at the default anchor
 *      (256, 192) and drawn over every room in the game.
 *   2. **A star of a set that is not open is not a failure.** Dust's star names
 *      are qualified — `town.flower` is the identifier in `TOWN.SET` itself — and
 *      `INVEN.PRP`'s `initprops` places the cemetery flowers on day 2 while the
 *      player is asleep in `mayroom`. The port dropped the placement; the cast
 *      has had the answer since `ActorRuntime.settleStars`, and props now share
 *      it.
 *   3. **`openprop` is a lifecycle handler.** Six prop groups in `HOUSE.PRP`
 *      define one, and it is where the second of every paired prop is made
 *      (`propinstance ("dung1", "dung2")`). Nothing fired it, and nothing in the
 *      corpus calls it, so `dung2` did not exist for `initprops` to set up.
 *
 * Skipped, not failed, without the disc (the bargain dust/tests/saves.ts makes).
 */
import { test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { readSetFileV1 } from "@dreamfactory/engine/df/set-v1";
import { sniffScript } from "@dreamfactory/engine/df/script";
import { parseScript } from "@dreamfactory/engine/runtime/parser";
import { ScriptInstance } from "@dreamfactory/engine/runtime/interp";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";

/* anchored to this file, not the working directory — see dust/tests/movies.ts */
const DATA = fileURLToPath(new URL("../gamefiles/dustcd/DATA", import.meta.url));

const have = (...names: string[]): boolean => names.every((n) => existsSync(`${DATA}/${n}`));

/** a session that serves the boot shops out of the rip, by name */
function newSession(logs: string[] = []): GameSession {
  const session = new GameSession((name) => {
    const path = `${DATA}/${name.toUpperCase()}`;
    return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
  }, new NullAudioSink());
  session.onLog = (m) => logs.push(m);
  return session;
}

/** the code blocks of every script container in a DreamFactory file */
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

// --- 1. the town's scenery is not on the player's screen --------------------

test("a prop assigned to a set is scenery, not a screen overlay", async () => {
  if (!have("HOUSE.PRP")) {
    console.warn(`no ${DATA}/HOUSE.PRP — skipping (needs the Dust rip)`);
    return;
  }
  const logs: string[] = [];
  const session = newSession(logs);
  // what dust/src/main.ts says at boot, and it matters here: a v1 world prop
  // draws at its AUTHORED size until a script says otherwise (becomeWorldProp),
  // and the tumbleweed never propscales itself at all
  session.dfVersion = 1;
  expect(await session.openShop("house.prp"), "house.prp opens").toBe(true);
  const R = session.propRuntime;

  // `openprop` ran: dung1 made its pair, and both carry the zclip it sets
  expect(R.get("dung2"), "dung1's openprop made dung2").toBeTruthy();
  expect(R.get("dung1")!.zclip, "...and set its own zclip").toBe(16);

  // the shop's own initprops(), which is what the boot sends it. clock != 3, so
  // it takes the town-scenery arm rather than the shooting star.
  const main = scripts(`${DATA}/HOUSE.PRP`, "house.prp").find((s) =>
    s.script.codes.has("initprops"),
  )!;
  expect(main, "initprops() is in the shop's main script").toBeTruthy();
  session.interp.globals.set("clock", 1);
  R.currentSet = "mayroom"; // asleep at the Mayor's, which is where this was reported
  await session.interp.runHandler(main, "initprops", [], { me: "house.prp", target: "" });

  expect(
    logs.filter((l) => l.includes("not loaded")),
    "no prop initprops addresses is missing",
  ).toEqual([]);
  expect(R.get("tumbleweed")!.scale, "an unscaled v1 prop keeps its authored size").toBe(1000);

  for (const name of ["tumbleweed", "dung1", "dung2", "townrand"]) {
    const p = R.get(name);
    expect.soft(p, `${name} is a prop of house.prp`).toBeTruthy();
    if (!p) continue;
    expect.soft(p.setName, `${name} belongs to the town`).toBe("town");
    expect.soft(p.worldSpace, `${name} is scenery, not a screen overlay`).toBe(true);
    // ...and it can still be DRAWN there: worldDrawList skips a prop of no size,
    // so becoming scenery must not be a way of disappearing
    expect.soft(p.scale, `${name} has a size to draw at`).toBeGreaterThan(0);
    // ...and the reporter's own test: is it on my screen, and can I click it?
    // propAt with no camera walks the SCREEN props alone, which is exactly the
    // list a set's scenery must not be in.
    const r = p.screenRect();
    const hits: string[] = [];
    if (r) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) if (R.propAt(x, y) === p) hits.push(`${x},${y}`);
      }
    }
    expect.soft(hits.slice(0, 3), `${name} is not clickable over the room`).toEqual([]);
  }
});

// --- 2. a star belonging to a room that is not open -------------------------

test("a prop placed on another set's star is seated when that set opens", async () => {
  if (!have("INVEN.PRP", "TOWN.SET")) {
    console.warn(`no ${DATA}/INVEN.PRP — skipping (needs the Dust rip)`);
    return;
  }
  const session = newSession();
  expect(await session.openShop("inven.prp"), "inven.prp opens").toBe(true);
  const R = session.propRuntime;
  R.currentSet = "mayroom";

  // the flowers' own setupprop("grave"), which is what INVEN.PRP's initprops
  // sends on the morning of day 2: propset(me, "town") + propstar(me,
  // "town.flower"). No set is open here, so the star cannot be found — which is
  // the state the report was in, asleep two rooms away.
  //
  // Reached through the session's own registry rather than by hunting the
  // container: which script belongs to which prop is the engine's answer to give.
  const flowers = session.propScripts.get("flowers");
  expect(flowers?.script.codes.has("setupprop"), "the flowers' script has a setupprop").toBe(true);
  const prop = R.get("flowers")!;
  expect(prop, "flowers is a prop of inven.prp").toBeTruthy();
  prop.owner = "none"; // setupprop only places what nobody is carrying
  await session.interp.runHandler(flowers!, "setupprop", ["grave"], {
    me: "flowers",
    target: "",
  });

  expect(prop.setName, "the flowers belong to the town").toBe("town");
  expect(prop.starName, "...on the town's flower star").toBe("town.flower");
  expect(prop.starPending, "...which this room's table does not have").toBe(true);
  expect(prop.worldSpace, "and they are scenery either way").toBe(true);

  // now the town opens, and its table is the right one. The identifiers in the
  // SET are qualified too, so the name the script gave matches as it stands.
  const town = readSetFileV1(new Uint8Array(readFileSync(`${DATA}/TOWN.SET`)));
  const star = town.actors.find((a) => a.identifier.toLowerCase() === "town.flower")!;
  expect(star, "TOWN.SET has a town.flower star").toBeTruthy();
  R.currentSet = "town";
  expect(R.settleStars(town.actors, true), "one prop was waiting for this set").toBe(1);
  expect(
    [prop.worldX, prop.worldY, prop.worldZ],
    "the flowers are on their star",
  ).toEqual([star.positionX, star.positionZ, star.positionY]);
  expect(prop.starPending, "and are not waiting for anything").toBe(false);

  // a second entry moves nothing: settling is for a placement that MISSED, and
  // a script is free to nudge a prop with propxyz afterwards
  prop.worldX = star.positionX + 40;
  expect(R.settleStars(town.actors, true), "nothing is re-seated on the next entry").toBe(0);
  expect(prop.worldX, "the nudge stands").toBe(star.positionX + 40);
});

// --- 3. what must NOT start waiting for a set ------------------------------

test("a star name that is not a set reference never waits", async () => {
  if (!have("HOUSE.PRP")) {
    console.warn(`no ${DATA}/HOUSE.PRP — skipping (needs the Dust rip)`);
    return;
  }
  const session = newSession();
  await session.openShop("house.prp");
  const R = session.propRuntime;
  const call = (name: string, args: (string | number)[]) =>
    (session.interp.builtins.get(name) as (i: unknown, a: (string | number)[]) => unknown)(
      session.interp,
      args,
    );

  // Titanic stores placement sentinels through propstar/actorstar — bare words
  // that are stars nowhere. A prop holding one must not be left waiting for a
  // set called "custom".
  call("propstar", ["dung1", "custom"]);
  expect(R.get("dung1")!.starPending, "a bare sentinel is not a set reference").toBe(false);

  // and an explicit placement answers the question outright
  call("propstar", ["dung1", "town.jug"]);
  expect(R.get("dung1")!.starPending, "a qualified miss waits").toBe(true);
  call("propxyz", ["dung1", 100, 200, 0]);
  expect(R.get("dung1")!.starPending, "...until the script says where itself").toBe(false);
});
