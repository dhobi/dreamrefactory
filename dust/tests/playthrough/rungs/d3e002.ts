import type { Pumped } from "../harness";
import {
  answer,
  ask,
  clickActor,
  converse,
  openDoor,
  room,
  set,
  walkTo,
  type Segment,
} from "../route";

/**
 * The point that walks away from an interactive film, read off the film itself.
 *
 * `nitebell.mov` is not a cutscene but the church notice board, and it is shaped
 * like `keys.mov`: 65 frames, frame 1 WAITS, and its four regions are three
 * notices — runs of frames that end by jumping back to frame 1 — and one
 * full-screen box that goes to frame 64, the `action 1` that ends the film. So
 * the exit is the region with the highest target, and the point to click is one
 * inside it that no EARLIER region claims, because the hit test takes the first
 * region a point falls in. Clicking the middle of the picture reads the middle
 * notice, and then reads it again, and again.
 */
function wayOutOf(p: Pumped): { x: number; y: number } {
  const regions = p.v().movieRegions;
  if (!regions.length) throw new Error("no film is waiting for a click");
  let out = 0;
  for (let i = 1; i < regions.length; i++) {
    if (Number(regions[i]!.target) > Number(regions[out]!.target)) out = i;
  }
  const box = regions[out]!;
  const earlier = regions.slice(0, out);
  for (let y = box.y0 + 2; y <= box.y1 - 2; y += 4) {
    for (let x = box.x0 + 2; x <= box.x1 - 2; x += 4) {
      if (earlier.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)) continue;
      return { x, y };
    }
  }
  throw new Error("every point of the film's exit is claimed by an earlier region");
}

/**
 * Day 3, evening: four last calls on the way through the night town to the bar.
 *
 * Seventy-four seconds of play, and its diff is four phases, a counter on the
 * saloon door and the room. At `clock = 3` the town is `nite.set` and not
 * `town.set` (`NEW.FLT/0001 gototown ()`), and the standpoint `D3E_001` was
 * taken at — cell (6, 8), Scene G9, facing south — is one cell south of the
 * saloon.
 *
 *   1. **Laurel is already close enough, and comes anyway.** `GANG.CST/0594
 *      laurelidle ()` arms `hasattention (5)` for as long as `day = 3 & clock =
 *      3 & laurelphase = 0` and she is inside `hotdist ()`, and `D3E_001` has
 *      her on `town.jones1` (1624, 1872) — cell (6, 7), 306 units from the
 *      standpoint against the 384 `GANG.CST/0001 hotdist ()` gives the town, and
 *      in the same COLUMN, which is the second gate `walktopuppet ()` opens on.
 *      `LAUREL.PUP/0041 threenite ()` asks one question whose three plaques all
 *      carry id **101**, and then `calm ()`, whose 101, 102 and 103 arms all
 *      fall through to the same `laurelphase = 1`. This answers by id rather
 *      than with `LEAVING` because `calm ()`'s `case -1` — what ESC reaches —
 *      exits ABOVE that assignment, and the assignment is the claim. Which of
 *      the three the original said is not recoverable; 103 is the one that says
 *      goodbye.
 *   2. **The hotel door.** `NITE.SET/0128` is Scene G5's script, cell (6, 4):
 *      `currentview () = "east" & pointinhotel (arg)` over 200,91-305,203 sets
 *      the door prop to "hotel", and `uparrow` behind that owner is
 *      `gotointerior ("hotlower.set")`. `lockhotel ()` refuses only on day 4 or
 *      during a fight. `gotointerior ()` also writes `townscene = currentscene
 *      ()`, which is why stepping back out lands at G5 again.
 *   3. **Fear at the desk, by the desk bell.** `HOTLOWER.SET/0001 openset ()`
 *      puts him out unconditionally on day 3 — `sendtoactor ("fear", setupactor
 *      ("hotel"))` — and `GANG.CST/0755`'s `mousedown` answers only while
 *      `currentscene () = "scene a1"`, so where you stand is the whole gate.
 *      The gesture is the bell rather than the man: `HOTLOWER.SET/0034`'s
 *      `pointinbell`, 353,224-373,244 at view east, rings it twice and then does
 *      `sendtoactor ("fear", mousedown (arg))` itself. `FEAR.PUP/0052 runyoself
 *      ()` at `clock = 3` with `phase = 0` speaks and then loops on plaques
 *      101, 102 and 103, and **103, "Bye.", is the only one of them that sets
 *      `fearphase = 1`** — the others set a flag and come round again. ESC is
 *      not an option here either: that loop's `case -1` arm is `exitode`, a typo
 *      the decompiler shows and the authors evidently never reached.
 *   4. **Buick is not in the lobby — he is behind his door.** `HOTLOWER.SET/0001`
 *      only sets him up `if phase = 1 & clock = 1`, and both saves leave him
 *      invisible on `hotlower.day`, so there is nobody to click. He is knocked
 *      on instead: `HOTUPPER.SET/0042` is Scene C1, cell (2, 0), and
 *      `currentview () = "west" & pointinrice (arg)` over 173,50-336,264 reaches
 *      `dobuick ()` whenever `lockrice ()` says no — which at `day = 3 & clock =
 *      3 & buickphase = 0 & propowner ("tstone") != "stranger"` it does, the
 *      save carrying `Tstone` as "none". `dobuick ()` turns the view west
 *      itself, opens the door prop and does `sendtocast ("gang", runpuppet
 *      ("buick.pup"))`. `BUICK.PUP/0053 runyoself ()`'s `case 3` tests the same
 *      thunderstone and goes straight to `bankhint ()`, which is seven
 *      `puppetspeak` lines and `buickphase = 1` with **no plaque at all** — so
 *      it is driven with `converse (p, null, …)`, which nudges a spoken line
 *      along and never answers anything, and the phase is what it watches.
 *
 *      The stairs are `HOTLOWER.SET/0048` (Scene D3 facing north, `uparrow`,
 *      `hotup.mov`) and `HOTUPPER.SET/0046` (Scene D1 facing south, `uparrow`,
 *      `hotdn.mov`, back to `scene d3` facing south).
 *   5. **Out again.** `HOTLOWER.SET/0034` at Scene A1 facing west, `pointindoor`
 *      128,73-394,262, door "hotout", then `uparrow` → `gototown (currentview
 *      ())`, which at `clock = 3` is `nite.set` at the stored `townscene`.
 *   6. **The church notice board summons Marie.** `NITE.SET/0097` is Scene E4,
 *      cell (4, 3): view north, `pointinsign` 167,3-432,107, `spotmovie
 *      ("nitebell.mov")` — and then, `if day = 3 & clock = 3 & mariephase = 0 &
 *      fighton = 0`, `sendtoactor ("marie", setupactor ("cem"))`. The film waits
 *      for a click it will not end without; see {@link wayOutOf}.
 *   7. **One click sends her, and the STANDPOINT makes her talk.** `GANG.CST/1343`
 *      puts her on `town.cem1` (334, 910), and her `mousedown` at that star is
 *      not a conversation: `if actorstar (me) = "town.cem1" … moveactor
 *      ("town.cem2")`. `town.cem2` is (590, 1156), inside cell (2, 4) — Scene C5
 *      — and her `endwalk` there reads `if currentscene () = "scene c5"
 *      runpuppet ("marie.pup")`. So the route stands in C5 first, clicks once,
 *      and waits: clicking again while she walks would fall through to the
 *      `realdist (me) < hotdist ()` arm below and open the same file by a
 *      different door. The facing is not part of the test — but it is
 *      deliberately not EAST, because `NITE.SET/0068 openscene` puts her
 *      straight back down on that facing once `mariephase != 0`.
 *
 *      `MARIE.PUP/0060 threenite ()` is 101, then 111, then `treasure ()`, and
 *      `treasure ()`'s last question is the one to read the script for: **109,
 *      "Yes, let's join forces.", is `playerdeath = "by marie"`**. 111, "No, I
 *      know your plans.", reaches the same `mariephase = 1` alive, and `D3E_002`
 *      has `playerdeath` empty.
 *   8. **The saloon, which is where `saloonphase` lives.** `NITE.SET/0131` is
 *      Scene G8, cell (6, 7): view west, `pointinsaloon` 241,92-307,201, door
 *      "saloon", and its `uparrow` arm is
 *
 *          saloonphase = saloonphase + 1
 *          if saloonphase > 2 · saloonphase = 0
 *          sendtostage (gotointerior ("sallower.set"))
 *
 *      — 1 → 2, which is the diff, and which of `SALLOWER.SET/0001 openset ()`'s
 *      three `opentrackfile` arms the bar plays tonight. `locksaloon ()` is
 *      false on day 3 with `fighton = 0`. `gotointerior ()` recording the cell
 *      it was entered from is the save's `townscene = "Scene G8"`, and `D3E_002`
 *      is taken four cells further in, at Scene C3 facing west.
 *
 * **What this does not claim.**
 *
 * `bouncer` (absent → 1) and `dirgo` (absent → 0) are not state. Walking into
 * the saloon runs `SALLOWER.SET/0001 openset ()`, which puts Isao back on the
 * floor, and `GANG.CST/0984 isaoidle ()` flips `bouncer` on **every** pass and
 * steps `dirgo` at the ends of Isao's 40° sweep. What a save carries is the
 * parity of how many times that loop has run since the door opened — a stopwatch
 * reading, not a state. `docs/engine/scripting-language.md` withdraws the same
 * pair as a control for the `dumpglobal` question for the same reason. This run
 * ends with `bouncer = 0` and `dirgo = 1`.
 *
 * `countsix` (2 → gone) is not this rung's to move. The only file in the corpus
 * that names it is `MWIFE.PUP`: `0074` (day 2) creates it at the top of
 * `runyoself ()` and `dumpglobal`s it at the bottom, and `0076` (day 3) does
 * both inside `case 2` — the AFTERNOON — and nowhere else. Day 3's `case 3`
 * neither makes it nor destroys it. Nor is the Mayor's wife in the evening to be
 * talked into either: `GANG.CST/0001` sets her up for day 3 as `day3PM` only,
 * both saves have her invisible on `town.mwife4`, and no evening script puts her
 * back. So this run ends with `countsix` still 2, which is what every script
 * that mentions it says should happen. Across the thread it appears and vanishes
 * four times with no conversation of hers at the far edge — `D2A_003` (5) →
 * `D2A_004` (gone) is the shooting range — so whatever ends its life is the
 * engine's business and not the player's, and it is claimed by nobody here.
 */
export const rung: Segment = {
  from: "D3E_001",
  to: "D3E_002",
  what: "Laurel, Fear, Buick and Marie, and in at the saloon door",
  claims: [
    "laurelphase", "fearphase", "buickphase", "mariephase",
    "saloonphase", "theset", "townscene",
  ],
  async play(p) {
    const nite = set("NITE");
    const hotlower = set("HOTLOWER");
    const hotupper = set("HOTUPPER");
    const sallower = set("SALLOWER");
    const num = (name: string): number => Number(p.session.interp.globals.get(name) ?? 0);

    // 1 — Laurel, one cell up the street, on the plaques that close her evening
    await clickActor(p, "laurel", "Laurel in the street outside the saloon");
    await answer(p, 101, "No.");
    await answer(p, 103, "Goodbye, Laurel.");
    await p.pump(() => num("laurelphase") === 1, "Laurel's evening to close");

    // 2 — Scene G5 facing east: the hotel
    await walkTo(p, nite, { x: 6, z: 4, view: "east" });
    await openDoor(p, [200, 91, 305, 203], "hotel", "the hotel door", {
      set: nite, x: 6, z: 4, view: "east",
    });
    await p.pump(() => room(p) === "hotlower", "the hotel lobby");

    // 3 — the desk bell, which rings for Fear
    await walkTo(p, hotlower, { x: 0, z: 0, view: "east" });
    p.fire(363, 234); // pointinbell, 353,224-373,244
    await p.settle("the desk bell");
    await answer(p, 103, "Bye.");
    await p.pump(() => num("fearphase") === 1, "Fear to say goodnight");

    // 4 — up the stairs, and a knock on the rice-paper door
    await walkTo(p, hotlower, { x: 3, z: 2, view: "north" });
    await p.press("uparrow", "up the hotel stairs");
    await p.pump(() => room(p) === "hotupper", "the landing");
    await walkTo(p, hotupper, { x: 2, z: 0, view: "west" }, () => num("buickphase") === 1);
    if (num("buickphase") === 0) {
      p.fire(255, 157); // pointinrice, 173,50-336,264
      await p.settle("knocking on Buick's door");
    }
    await converse(p, null, -1, () => num("buickphase") === 1, "Buick's bank hint through the door");

    // 5 — back down, and out into the street the way we came in
    await walkTo(p, hotupper, { x: 3, z: 0, view: "south" });
    await p.press("uparrow", "down the hotel stairs");
    await p.pump(() => room(p) === "hotlower", "the lobby again");
    await walkTo(p, hotlower, { x: 0, z: 0, view: "west" });
    await openDoor(p, [128, 73, 394, 262], "hotout", "the hotel's street door", {
      set: hotlower, x: 0, z: 0, view: "west",
    });
    await p.pump(() => room(p) === "nite", "the night street");

    // 6 — the notice board outside the church, which is what fetches Marie
    const marieIsOut = (): boolean => ask(p, "actorvisible", ["marie"]) === "1";
    await walkTo(p, nite, { x: 4, z: 3, view: "north" });
    p.fire(300, 55); // pointinsign, 167,3-432,107
    await p.pump(() => p.v().movieRegions.length > 0 || marieIsOut(), "the notice board");
    if (!marieIsOut()) {
      const out = wayOutOf(p);
      p.fire(out.x, out.y);
    }
    await p.pump(marieIsOut, "Marie to come out to the cemetery");

    // 7 — stand on the cell her walk ends in, send her, and let her arrive
    await walkTo(p, nite, { x: 2, z: 4, view: "north" });
    const setOff = (): boolean =>
      ask(p, "actorstar", ["marie"]).toLowerCase() !== "town.cem1" || !!p.session.puppet;
    await clickActor(p, "marie", "Marie at the cemetery gate", 8, setOff, false);
    await p.pump(() => !!p.session.puppet, "Marie to reach the graves and speak");
    await answer(p, 101, "Why did you need to see me?");
    await answer(p, 111, "Perhaps.");
    await answer(p, 111, "No, I know your plans.");
    await p.pump(() => num("mariephase") === 1, "Marie to finish");
    const death = String(p.session.interp.globals.get("playerdeath") ?? "");
    if (death !== "") throw new Error(`Marie was answered the wrong way: playerdeath is "${death}"`);

    // 8 — Scene G8 facing west, and the counter on the door
    await walkTo(p, nite, { x: 6, z: 7, view: "west" });
    await openDoor(p, [241, 92, 307, 201], "saloon", "the saloon door", {
      set: nite, x: 6, z: 7, view: "west",
    });
    await p.pump(() => room(p) === "sallower", "the saloon floor");
    if (num("saloonphase") !== 2) throw new Error(`saloonphase is ${num("saloonphase")}, not 2`);
    await walkTo(p, sallower, { x: 2, z: 2, view: "west" });
  },
};
