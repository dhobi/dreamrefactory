import type { Pumped } from "../harness";
import {
  answer,
  ask,
  clickActor,
  clickProp,
  excuseUs,
  room,
  set,
  talkOut,
  walkTo,
  type Segment,
} from "../route";

/**
 * A point on the gun in your hand, asked of the engine rather than guessed.
 *
 * The gun has no rectangle written down anywhere — `gunhand` is drawn at
 * `propxy (260, 165)` and its extent is whatever its art happens to be in the
 * view it is wearing, which changes when the cylinder swings out. So the sprite
 * is found with the engine's own hit test, the one `BOOTFILE/0001 mousedown`
 * reaches through `hittest (thepoint)`, and the point picked is the one furthest
 * from an edge — `pointinprop` answers for the whole bounding BOX and the click
 * lands on the mask, and at the top of the box those two disagree by eight
 * pixels of empty sky.
 *
 * `chamber` splits it the way `HOUSE.PRP/0270 clickinchamber ()` does —
 * `pointx (arg) < 248 & pointy (arg) < 255` — because that one rectangle is the
 * difference between loading a round and snapping the cylinder shut.
 */
function onGun(p: Pumped, chamber: boolean): { x: number; y: number } {
  const isGun = (x: number, y: number): boolean => {
    const hit = p.session.hitTestAt(x, y);
    return hit.type === "prop" && hit.name.toLowerCase() === "gunhand";
  };
  let best: { x: number; y: number; room: number } | null = null;
  for (let y = 200; y < 264; y += 2) {
    for (let x = 200; x < 320; x += 2) {
      if (chamber !== (x < 248 && y < 255)) continue;
      if (!isGun(x, y)) continue;
      // how far from an edge: the widest square of the mask this point sits in
      let room = 0;
      while (room < 10 && isGun(x - room - 2, y - room - 2) && isGun(x + room + 2, y - room - 2)
        && isGun(x - room - 2, y + room + 2) && isGun(x + room + 2, y + room + 2)) room += 2;
      if (!best || room > best.room) best = { x, y, room };
    }
  }
  if (!best) {
    throw new Error(
      `no ${chamber ? "chamber" : "frame"} of the gun on screen — view "${ask(p, "propview", ["gunhand"])}"`,
    );
  }
  return { x: best.x, y: best.y };
}

/** the middle of an actor's sprite, by the engine's own hit test */
function sprite(p: Pumped, who: string): { x: number; y: number } {
  let x0 = 512;
  let y0 = 264;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < 264; y += 2) {
    for (let x = 0; x < 512; x += 2) {
      const hit = p.session.hitTestAt(x, y);
      if (hit.type !== "actor" || hit.name.toLowerCase() !== who) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) throw new Error(`${who} is not on screen`);
  return { x: (x0 + x1) >> 1, y: (y0 + y1) >> 1 };
}

/**
 * Day 2, afternoon: the shooting of Cobb Belcher, and the badge that follows.
 *
 * Half a minute of play and the shortest rung of the day, because almost
 * everything in its diff is one event. `clock 2 → 3` is `NEW.FLT/0001
 * advanceday ()`, whose day-2 `case 3` arm is `playmovie ("d2ad2n.mov")`,
 * `initall ("jail", "jail.set")`, `currentscene ("scene a1")`,
 * `currentview ("east")`, `townscene = "scene g12"` — the room, the standpoint
 * and the facing `D2E_001` was taken at — on top of the `phase = 0`,
 * `savedir = "east"` and `savescene = "scene c4"` the routine opens with.
 * `initall ()` clears `handitem` and the phases with it, and the `initprops ()`
 * it sends the inventory has a `day = 2 & clock = 3` arm that reads
 * `giveinven ("hankerchief", "limbo")` — the save's other prop move.
 *
 * So the rung is: get `phase` from 1 to 3, and the afternoon ends itself.
 *
 *   1. **Stand where Cobb is.** `D2A_009` has him on `town.cobb` (1602, 3020)
 *      and Dell on `town.help` (1760, 3034) — both inside cell (6, 11), Scene
 *      G12, whose centre is 98 units from Cobb. Facing south is the view that
 *      has the pair of them in it.
 *   2. **Load the gun first.** `GANG.CST/0419 cobbidle ()` arms
 *      `hasattention (10)` for as long as `day = 2 & clock = 2 & phase = 2`, and
 *      `GANG.CST/0001 hasattention ()` fires `sendtoactor (target, mousedown
 *      (0))` when the span runs out — which at `phase = 2` is `COBB.PUP/0076
 *      runyoself ()`, which is `playerdeath = "by cobb"`. Ten seconds is the
 *      whole standoff, so the reloading happens before Cobb is spoken to and not
 *      after.
 *
 *      And the save says how much. `bulletcount` is 1 at `D2A_009` and 5 at
 *      `D2E_001`, `NEW.FLT/0002 bullet ()` takes one per shot and
 *      `HOUSE.PRP/0270 mousedown` will not put in a sixth — so the original
 *      filled the cylinder and fired exactly once.
 *   3. **Talk to Cobb.** `COBB.PUP/0076 runyoself ()` at `clock = 2` with
 *      `phase = 1` is `shackit ()`: Dell's lines through `dellcomment ()`, a
 *      four-plaque question, and then `phase = 2`, `sendtoactor ("dell",
 *      setupactor ("torch"))`, `sendtoactor ("COBB", setupactor ("gun"))`. Both
 *      101 and 102 reach it — the script's own `switch` differs by one spoken
 *      line and nothing else — so which one was said is not recoverable, and
 *      101, "Get away from that store.", is the one that matches a `score` of
 *      "good".
 *   4. **Shoot him.** `BOOTFILE/0001 mousedown` turns a click into a shot when
 *      `handitem = "gun"`, the point is in the set, the flat is `mainpanel` and
 *      `gunhand` is up and not in `reload` — and `NEW.FLT/0002 bullet ()` then
 *      does `hittest (thepoint)` for the target. So the shot is a real click on
 *      Cobb's sprite, found with the engine's own hit test rather than guessed.
 *      `ishit ()` is a distance roll that returns true unconditionally under 256
 *      units, and G12 is 98 from him, so one round is one hit.
 *      `GANG.CST/0419 hit ()` is `phase = 3`, `setupactor ("dead")`,
 *      `spotmovie ("cobbshot.mov")` and `runpuppet ("dell1.pup")`.
 *   5. **Put the gun away before anything else clicks.** With `gunhand` up every
 *      click on the room is another round, and `bulletcount` is one of the
 *      claims; `INVEN.PRP/0406 mousedown` lowers it, which is also what the
 *      save's `gunhand` view of "lower" says the original did.
 *   6. **Let Dell finish.** `DELL1.PUP/0074 runyoself ()` at `phase = 3` speaks
 *      three lines, puts him in `handsup` and — the part the rung turns on —
 *      does `sendtoactor ("mayor", setupactor ("sherif"))`. In `GANG.CST/1097`
 *      that arm sets `mayorphase = 0` (the save's `mayorphase 1 → 0`, and it
 *      happens here rather than in `advanceday`) and walks him from
 *      `town.leroy1` to `town.speach`, which is the Mayor coming over.
 *   7. **Click the Mayor.** `MAYOR.PUP/0073 runyoself ()` at `clock = 2` with
 *      `phase = 3` is `makesherrif ()`: the plaques (four at 102, then two at
 *      103), `actorowner ("dell", "jail")`, `sendtoshop ("inven", addinven
 *      ("badge"))` — the rung's TAKE — and `opensetfile ("jail.set")`. And
 *      `GANG.CST/1097 mousedown` is what carries the day over: after the puppet
 *      returns, `if day = 2 & clock = 2 & phase = 3`, `delay (100)`,
 *      `sendtostage (advanceday ())`.
 *
 * `TOWN.SET/0135` — Scene G12's own script — has the same pair on `uparrow`
 * facing north (`runpuppet ("mayor.pup")` then `advanceday ()`) for a player who
 * walks off instead, and `phase = 2` on that same key is `playerdeath = "by
 * cobb"`. The route takes the Mayor, because the Mayor is the one who walked
 * over.
 *
 * Everything the save moved is claimed, and the twelve phases are one line
 * between them: `initall ()` sends `sendtocast ("gang", initactors ())`, and
 * `GANG.CST/0001 initactors ()` is `sendtoactor (indextoactor (count),
 * initactor ())` over every actor in the cast — each cast script's own
 * `initactor ()` being `<name>phase = 0` and a `putdownactor ()`
 * (`GANG.CST/0419` for Cobb, `GANG.CST/1097` for the Mayor, and so on down the
 * list). `initall ()` clears `tellerphase`, `rubyphase`, `sophiephase`,
 * `mezphase` and `zebpetephase` itself, and `phase` is the first assignment in
 * `advanceday ()`. Nothing in this rung goes through `dumpglobal`, so the port's
 * open question about it is not in play.
 */
export const rung: Segment = {
  from: "D2A_009",
  to: "D2E_001",
  what: "Cobb Belcher is shot and the Mayor pins on the badge",
  claims: [
    "clock", "phase", "bulletcount", "handitem", "savedir", "savescene", "townscene",
    "cobbphase", "flippophase", "helpphase", "jonesphase", "mayorphase", "mwifephase",
    "oonaphase", "rubyphase", "sidephase", "sophiephase", "trotterphase",
  ],
  async play(p) {
    const num = (name: string): number => Number(p.session.interp.globals.get(name) ?? 0);
    const view = (name: string): string => ask(p, "propview", [name]);

    // 1 — Scene G12, facing the shack: Cobb and Dell are both in this cell
    await walkTo(p, set("TOWN"), { x: 6, z: 11, view: "south" });

    // 2 — six rounds, before Cobb has anything to be impatient about
    await clickProp(p, "gun", "the gun out of the panel", { tries: 1 });
    await p.pump(() => view("gunhand") === "idle", "the gun to come up");
    const frame = onGun(p, false);
    p.fire(frame.x, frame.y);
    await p.pump(() => view("gunhand") === "reload", "the cylinder to swing out");
    const chamber = onGun(p, true);
    for (let round = 0; round < 8 && num("bulletcount") < 6; round++) {
      p.fire(chamber.x, chamber.y);
      await p.settle("a round going in");
    }
    if (num("bulletcount") !== 6) throw new Error(`the gun holds ${num("bulletcount")}, not six`);
    p.fire(frame.x, frame.y);
    await p.pump(() => view("gunhand") === "idle", "the cylinder to shut");

    // 3 — `shackit ()`, and Cobb draws
    await clickActor(p, "cobb", "Cobb outside the store");
    await answer(p, 101, "Get away from that store.");
    await p.pump(() => num("phase") === 2 && !p.session.puppet, "Cobb to draw");

    // 4 — one round, at the sprite the engine says is his
    const at = sprite(p, "cobb");
    p.fire(at.x, at.y);
    await p.pump(() => num("phase") === 3, "the shot to land");

    // 5 — holster it: from here on a click on the room would be another round
    await p.pump(() => view("gunhand") === "idle", "the gun to come back down to level");
    await clickProp(p, "gun", "the gun back into the panel", { tries: 1 });
    await p.pump(() => ask(p, "propvisible", ["gunhand"]) === "0", "the gun to go away");
    if (num("bulletcount") !== 5) throw new Error(`${6 - num("bulletcount")} rounds fired, not one`);

    // 6 — `dell1.pup`: hands up, and the Mayor sent for
    await p.pump(
      () => ask(p, "actorpose", ["dell"]) === "handsup" && ask(p, "actorvisible", ["mayor"]) === "1",
      "Dell's hands up and the Mayor on his way",
    );
    await excuseUs(p, "Dell over the body");

    // 7 — the badge, and the day with it
    await clickActor(p, "mayor", "the Mayor coming over to swear us in");
    await talkOut(p, [102, 103], "the Mayor swearing us in", 3);
    await p.pump(
      () => num("clock") === 3 && room(p).startsWith("jail"),
      "the evening, in the jail",
    );
    if (ask(p, "propowner", ["badge"]).toLowerCase() !== "stranger") {
      throw new Error(`the badge belongs to "${ask(p, "propowner", ["badge"])}"`);
    }
  },
};
