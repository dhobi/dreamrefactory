import { answer, ask, clickActor, meet, openDoor, room, set, talkOut, walkTo, type Segment } from "../route";

/**
 * Day 3, night: five bounty hunters in the street, the bank safe, and bed.
 *
 * The busiest rung on the route — 7020 frames, and three separate things
 * strung together by one global. `D3E_003` is saved at the poker table with
 * `phase = 2`, and `NITE.SET/0131 openscene ()` — the cell outside the saloon —
 * is three `if`s, and one of them is
 *
 *     if day = 3 & clock = 3 & phase = 2
 *         openfight ()
 *
 * So stepping out of the saloon IS the ambush. `NITE.SET/0001 openfight ()` is
 * where half this rung's globals come from at once: `fighton = 1`,
 * `playerhits = 0`, `addinven ("gun")`, then **`phase = 3`** and
 * **`mezphase = 3`**, and five `setupactor ("fight")` calls. And before any of
 * that, one line that explains five more:
 *
 *     size = countactors ()
 *     for count = 1 to size
 *         sendtoactor (indextoactor (count), initactor ())
 *     endfor
 *
 * Every cast member's `initactor ()` sets that character's phase to zero
 * (`GANG.CST/0468` `buickphase = 0`, `/0446` `flippophase`, `/0267`
 * `jonesphase`, `/0594` `laurelphase`, `/1343` `mariephase`, `/0670`
 * `trotterphase`, `/0755` `fearphase`). That is the whole of the save's
 * `buickphase 1 → 0`, `flippophase 1 → 0`, `jonesphase 1 → 0`,
 * `laurelphase 2 → 0` and `mariephase 1 → 0`: nobody was spoken to, the fight
 * wiped the board. It also means `trotterphase` and `fearphase` are BACK TO
 * ZERO when the fight ends, and the 1 each of them carries in `D3E_004` had to
 * be earned again afterwards — which is what pins the two conversations at the
 * end of this rung down to the reply that sets them.
 *
 *  1. **Out of the saloon.** `SALLOWER.SET/0052` is Scene D1, `pointinrice`
 *     144,7–387,264 facing east, door prop "salout", `uparrow` →
 *     `gototown ("east")`. At `clock = 3` that is `nite.set`
 *     (`NEW.FLT/0001 gototown ()`), landing on `townscene`, which `D3E_003`
 *     holds at Scene G8 — cell (6,7), the front of the saloon.
 *  2. **The five.** `EXTRA.CST/0287` is one cast member instanced five times
 *     (`openactor ()`: `actorinstance ("bounty1", "bounty2")` and so on), and
 *     the save's `bounty1..5` are not a score — they are each actor's own
 *     `variable (me, n)` state, because `variable` with a name the cast has
 *     never counted writes a GLOBAL of that name
 *     (`engine/src/runtime/builtins/helpers.ts`). 4 is the last state of
 *     `walkloop ()` and 2 the last state of `statloop ()`, so
 *     **`bounty1 = bounty2 = 4` and `bounty3 = bounty4 = bounty5 = 2` is
 *     precisely "all five are dead"**, and nothing else. They divide in two:
 *
 *       - `bounty1`/`bounty2` **walk to you**. `walkcloser ()` steps them one
 *         cell at a time towards `cameraxyz` and `walkloop ()` case 2 parks
 *         them into `attackmode ()` the moment
 *         `playerisat () & realdist (me) < hotdist (2)` — one row or column
 *         away, inside six cells. So this half of the fight is waited for at
 *         Scene G8, the cell the saloon lets you out onto.
 *       - `bounty3`/`bounty4`/`bounty5` **are placed and do not move**:
 *         `initxyz ()` puts them at (-230,1775), (1160,3110) and (1470,1830),
 *         and `statloop ()` only breaks cover when `closenough ()` names the
 *         scene the player is standing in. Those lists are the route's
 *         stations: Scene D7 for `bounty3`, Scene G13 for `bounty4`, and for
 *         `bounty5` one of `g5 g6 g7 g8 g9 h7 i7`. `bounty5` also waits for
 *         `actorpose ("bounty4") = "dead"` before it arms at all, so it is
 *         necessarily last.
 *
 *     Their `hit ()` has a second gate the walkers' does not — a shot only
 *     counts from a scene the case names, or while `currentcd (me, 1)` says
 *     they are out of cover (`rollout ()`/`popup ()` set it, `rollback ()` and
 *     `popdown ()` clear it). Scene G13 is in `bounty4`'s list and Scene D7 is
 *     not in `bounty3`'s, which is why the one at the west end has to be shot
 *     in the moment he is rolled out and the one down the south road does not.
 *
 *     Four landed shots kill any of them: `hit ()` increments `actorvalue` and
 *     `hitwalker ()`/`hitstat ()` check `actorvalue (me) > hotdist (4)`, which
 *     is 2 — so hits three and four are what finish the job.
 *  3. **Shooting.** `BOOTFILE/0001 mousedown`'s first branch is
 *     `handitem = "gun" & pointinset (thepoint) & currentflat () = "mainpanel"`
 *     with `propvisible ("gunhand")`, and `openfight ()`'s `addinven ("gun")`
 *     only puts the gun in the HAND — raising it is a click on the gun where
 *     the panel draws it (`INVEN.PRP/0406 mousedown`: `propview (me) = "large"`
 *     → `sendtoprop ("gunhand", raise ())`). Reloading is
 *     `HOUSE.PRP/0270 mousedown` on the gunhand itself: one press swings the
 *     cylinder out, each press inside `clickinchamber (arg)` — `pointx < 248 &
 *     pointy < 255` — is one round while `propowner ("bullets") = "stranger"`,
 *     and a press outside it shuts the cylinder. Where to AIM is asked of the
 *     game rather than guessed: `NEW.FLT/0002 bullet ()` resolves a shot with
 *     `hittest (thepoint)`, so the route sweeps `hittest` across the picture
 *     and fires at the first pixel that answers a living bounty hunter — the
 *     same "ask the engine what is under this point" that `openDoor` aims with.
 *  4. **`ishit` is not a die roll.** `NEW.FLT/0002 ishit (dist)` looks like one —
 *     `random (4)`, `random (3)`, `random (2)`, `random (30) < 20` — but the
 *     cases fall through to `if dist > 0 return (true)`, so every shot that
 *     hit-tests an actor lands, and so does every shot the hunters take at you
 *     (`makebull ()` asks the same function). That is why `playerhits` is a
 *     race and not a skill check: `NITE.SET/0001 hit ()` is
 *     `if day = 3 & playerhits > 15` → `playerdeath = "by bounty"`, and the
 *     original came out of this street on 14. See the exclusions below.
 *  5. **Trotter, and the end of the fight.** `EXTRA.CST/0287 deadexits ()` runs
 *     when all five poses are "dead" and calls `closefight ()`, whose day-3 arm
 *     is `sendtoactor ("trotter", setupactor ("delayed"))` and `loopsound = ""`
 *     — the second is the save's `loopsound "outsidesaloon" → ""`.
 *     `GANG.CST/0670 delayloop ()` puts Trotter in the town at `town.jones1`,
 *     cell (6,7), and hides him until the player is looking elsewhere. He is
 *     the ONLY thing in the corpus that clears `fighton` on this path:
 *     `TROTTER.PUP/0075 threenite ()`'s **"That all?" (103)** is
 *     `trotterphase = 1` **and** `fighton = 0` (and `actordeg ("horse1", 0)`,
 *     which `D3E_004` also records). Until it runs, `NITE.SET/0129 lockbank ()`
 *     answers `if fighton = 1 return true` and the bank cannot be entered — so
 *     this conversation is not a detour, it is the door key.
 *  6. **The bank.** `NITE.SET/0129` is Scene G6, `pointinbank` 200,81–306,232
 *     facing west. `lockbank ()` returns false at `clock = 3 & day = 3` only
 *     while `propowner ("hairpin") = "stranger"`, which it has been since the
 *     hairpin was picked up, and then the `mousedown` skips the door prop
 *     entirely: `addinven ("hairpin")`, `spotmovie ("pinenter.mov")`,
 *     `gotointerior ("bank.set")`. `gotointerior ()` writes
 *     `townscene = currentscene ()`, so the street is remembered as Scene G6
 *     here and rewritten to Scene G5 at the hotel in step 11 — which is the
 *     value the save keeps.
 *  7. **The safe.** `BANK.SET/0043` is Scene D1 facing west, `pointinsign`
 *     80,0–442,261, and its `mousedown` at `day = 3 & clock = 3` with the
 *     Tstone not yet taken is `docrack ()`: `crack.prp`, `crack.flt`,
 *     `crack.snd`, and the set faded out under them. `CRACK.FLT/0001
 *     openstage ()` — the handler an `openstagefile` fires — is the reset:
 *     `combo = "-1,-1,-1,"`, `turnright = 1`, `curtwist = 1`, and the dial
 *     (`spin`) placed at 256,128.
 *  8. **The dial is a drag, not a click.** `CRACK.PRP/0002 mousedown` is a
 *     `while stilldown ()` poll — it reads `mouse ()` every pass, turns the
 *     `spin` prop by `limiter (orig, newd)`, and only on RELEASE sends
 *     `newposition (propdeg (me))` to the flat. `limiter` is the ratchet:
 *     with `turnright = 1` a pass is refused unless the new position is BELOW
 *     the current one, with `turnright = 0` unless it is above, and
 *     `newposition ()` flips `turnright` and advances `curtwist` after each
 *     number — 1 → 2 → 3 → 4, and at 4 `turnright = 2`, which is the
 *     `exitcode` at the top of `mousedown` that locks the dial for good. So the
 *     save's **`curtwist = 4` and `turnright = 2`** are simply "three numbers
 *     have been dialled", and `combo` is the three the walkthrough already
 *     records from `CRACK.FLT/0001 tryopen ()`'s own
 *     `if combo != "08,23,41,"`.
 *
 *     The route drives it the way the script reads it. `newd` is
 *     `fixdeg256 (calcdeg (propxy (me, 3), mouse ()) + 64)` — an angle about
 *     the dial's centre, folded into the 0..49 the dial is numbered in — so the
 *     route asks the same two builtins what value each screen point would
 *     produce, and steps the pointer through those values ONE at a time,
 *     waiting for the dial to follow before taking the next step. Stepping in
 *     the ratchet's own direction turns it; stepping back is refused and the
 *     dial holds, which is what lets a sweep that runs out of screen turn round
 *     and come again. Then it stops the instant `propdeg ("spin")` reads the
 *     number wanted, and releases — because it is the release that writes the
 *     digit.
 *  9. **The handle, and the film that has to be played properly.**
 *     `flatprops.ts` gives `crack.flt` four regions, and `tryopen` (352,96 and
 *     257,297) is the handle. With the combination right it runs
 *     `domovies ()` — `vault.mov`, then `safebox.mov` — and then
 *
 *         if actionframe (1) = true
 *             sendtoshop ("inven", addinven ("tstone"))
 *
 *     `safebox.mov` is a PUZZLE film of the `getcards.mov` kind. It waits at
 *     frame 1 and again at frame 15, and each of those frames offers two
 *     regions: a small box over the strongbox, and the whole picture behind it.
 *     The small ones go 1 → 2 and 15 → 17; the big ones go 1 → 49 and 15 → 35,
 *     and 49 is an `action 1` exit while 35 runs back round to frame 1. The
 *     action frame is 17, reachable only through the small box at frame 15 —
 *     so a click in the middle of the picture is walking away from the safe
 *     twice over. The route reads `p.v().movieRegions` and clicks the SMALLER
 *     of what is on offer, which is the box both times.
 * 10. **Out of the bank.** `BANK.SET/0044`, Scene D2 facing east:
 *     `pointinrice` 177,30–339,263, door prop "dollar", `uparrow` →
 *     `gototown (currentview ())`, back onto Scene G6.
 * 11. **The hotel.** `NITE.SET/0128` is Scene G5, `pointinhotel`
 *     200,91–305,203 facing east, door prop "hotel", `uparrow` →
 *     `gotointerior ("hotlower.set")` — and that call is what finally sets
 *     `townscene = "Scene G5"`. `HOTLOWER.SET/0001 openset ()` at `day = 3`
 *     runs `sendtoactor ("fear", setupactor ("hotel"))`, whose `stdactor ()`
 *     (`GANG.CST/0001`) opens `theset = actorset (who)` — so **`theset`
 *     becomes "hotlower"** on arrival, and nothing later on this route sets an
 *     actor up anywhere else.
 * 12. **Fear at the desk.** `GANG.CST/0755 mousedown` only answers from
 *     `currentscene () = "scene a1"`, cell (0,0), so the route stands there
 *     first. `FEAR.PUP/0052` is his day 3: the fight put `fearphase` back to 0,
 *     so this is not the brush-off but the whole `clock = 3` exchange —
 *     `fear.99`, `fear.7`, and because `actorowner ("jones") = "friend"` also
 *     `fear.105` and `fear.106` — ending in a `while true` whose only exit is
 *     **"Bye." (103)**, and 103 is `fearphase = 1`. That is the save's
 *     `fearphase`, which reads unchanged at 1 and is nothing of the kind.
 * 13. **Upstairs, and bed.** `HOTLOWER.SET/0048` is Scene D3 facing north and
 *     its whole script is `uparrow` → `hotup.mov` →
 *     `gotointerior ("hotupper.set")`. Then `HOTUPPER.SET/0045`, Scene C4
 *     facing west: `pointinrice` 168,50–329,263, `lockrice ()` false because
 *     `propowner ("hrkey") = "stranger"`, and the `mousedown` does
 *     `sendtoshop ("inven", addinven ("hrkey"))` BEFORE it sets the door prop —
 *     the room key comes up in the hand to be used, which is the save's
 *     **`handitem "tbird" → "hrkey"`** (by way of "gun", "hairpin" and
 *     "tstone", each of which `addinven ()` put there in turn). Its `keydown`
 *     then writes `savescene = currentscene ()` — **"Scene C4"** — and
 *     `savedir = "east"` before `gotointerior ("hotroom.set")`.
 *
 *     The same script's `openscene ()` has a day-3-night arm that starts
 *     Blood's overheard conversation and sets `bloodphase = 1`, but it is
 *     gated on `sendtostagefx (day3bedtime ())`, and `NEW.FLT/0001
 *     day3bedtime ()` wants `phase > 3`. `phase` is 3. `D3E_005` is the save
 *     where that fires; here it cannot, and `bloodphase` is claimed as 0 to say
 *     so.
 *
 * **This rung is why scene scripts have a parent.** Written against an engine in
 * which `NITE.SET/0131 openscene ()`'s bare `openfight ()` resolved to nothing —
 * `SetScripts` gave a scene script no `parent`, so the call skipped its own set
 * and went to the stage and boot fallbacks, where the name is not — it had to
 * run `openfight` itself and said so. The ambush now opens by being walked into,
 * as it always should have, and the workaround is gone.
 *
 * A second, smaller one, which the route works around rather than relies on:
 * `propxy (name, 3)` answers `anchorX` rather than the packed screen point the
 * dial's `calcdeg (propxy (me, 3), …)` is asking for
 * (`engine/src/runtime/builtins/props.ts` handles axes 1 and 2 only, the way
 * `propxyz (…, 4)` packs a pair). The dial still turns, because it is driven by
 * the DELTA between two `calcdeg` readings and the ratchet only cares about
 * sign — but the ring of screen points that turns it is centred on the wrong
 * place, so the route derives its pointer path from the engine's own answer
 * instead of drawing a circle around 256,128.
 *
 * **Not claimed**, and why.
 *
 *   - **`playerhits` (0 → 14) and `bulletcount` (3 → 2).** Both are the shape
 *     of one particular gunfight. `playerhits` counts the rounds that reached
 *     the player, and while `ishit ()` always says yes, WHETHER a hunter fires
 *     on a given pass is `random (100) < 32` in `attackmode ()`,
 *     `random (100) < 33` in `walkloop ()` and `random (30) < 20` in
 *     `standfire ()`; `bulletcount` is whatever is left in the cylinder when
 *     the shooting stops, and when to break it open and thumb six more in is a
 *     click the player makes whenever they feel like it. Neither is
 *     reconstructible. This rung's fight is won with room to spare on the 15
 *     that would have ended it.
 *   - **`playerscene`** (created, value 0). `EXTRA.CST/0287 hitwalker ()`
 *     declares it and only assigns it — `playerscene = currentscene ()` — on
 *     the branch where a walker is hit while the player is NOT on its row or
 *     column. The save's 0 is the global existing and never having been
 *     written, which is a fact about which shots happened to land where.
 *   - **`bouncer` and `dirgo`**, which `D3E_003` has at 0 and `D3E_004` does
 *     not have at all. `GANG.CST/0984`'s `putdownactor ()` is
 *     `dumpglobal bouncer, dirgo`, and it runs twice on this rung —
 *     `SALLOWER.SET/0001 closeset ()` on the way out of the saloon, and again
 *     inside `openfight ()`'s `initactor ()` sweep. Under the reading eight
 *     shipped teardowns support (`docs/engine/scripting-language.md` — only the
 *     FIRST name of the list is destroyed) two runs destroy both names, and
 *     under this port's reading one run does; the two agree here by accident,
 *     which is exactly why this is not the rung to claim them from.
 *   - `idlecount` (0 → 2) is `BOOTFILE/0001 idle ()`'s mod-4 counter and
 *     `vitalframe` (170227 → 176405) is `INVEN.PRP/0001 addinven ()`'s
 *     `frame ()` stamp on the Tstone. Both measure elapsed frames.
 *   - **`fear.pup` is open in the save**, and `counter` is 0 at both ends.
 *     `FEAR.PUP/0052`'s day-3 conversation never touches `counter`, so the two
 *     agree; the brush-off it would have run at `fearphase = 1` DOES cycle it,
 *     which is one more piece of evidence that the fight had reset the phase
 *     and step 12 is the long version.
 */
export const rung: Segment = {
  from: "D3E_003",
  to: "D3E_004",
  what: "five bounty hunters in the street, the bank safe, and bed",
  claims: [
    "phase", "mezphase", "fighton", "loopsound",
    "buickphase", "flippophase", "jonesphase", "laurelphase", "mariephase",
    "trotterphase", "fearphase", "bloodphase",
    "bounty1", "bounty2", "bounty3", "bounty4", "bounty5",
    "combo", "curtwist", "turnright",
    "handitem", "theset", "townscene", "savescene",
  ],
  async play(p) {
    const sallower = set("SALLOWER");
    const nite = set("NITE");
    const bank = set("BANK");
    const hotlower = set("HOTLOWER");
    const hotupper = set("HOTUPPER");
    const hotroom = set("HOTROOM");
    const global = (name: string): string =>
      String(p.session.interp.globals.get(name) ?? "").toLowerCase();
    const number = (name: string): number => Number(p.session.interp.globals.get(name) ?? 0);
    const owner = (name: string): string => ask(p, "propowner", [name]).toLowerCase();
    const pose = (who: string): string => ask(p, "actorpose", [who]).toLowerCase();
    const point = (x: number, y: number): number => Number(ask(p, "makepoint", [x, y]));
    /** run a prop's own `mousedown` with a POINT, the way a shop script reads it */
    const pressProp = (name: string, at: number): void => {
      const script = p.session.propScripts.get(name);
      if (!script) throw new Error(`no prop script for "${name}"`);
      void p.session.track(
        p.session.interp.runHandler(script, "mousedown", [at], { me: name, target: name }),
      );
    };

    // ---- 1. out of the saloon, into the ambush ----------------------------
    await walkTo(p, sallower, { x: 3, z: 0, view: "east" });
    await openDoor(p, [144, 7, 387, 264], "salout", "the saloon's front door", {
      set: sallower, x: 3, z: 0, view: "east",
    });
    await p.pump(() => room(p).startsWith("nite"), "the street outside the saloon");

    // `NITE.SET/0131 openscene ()` does this itself: stepping out of the saloon
    // IS the ambush. (It did not, until scene scripts were given their set main
    // as a resolution parent — see the note above, now history.)
    await p.pump(() => number("fighton") === 1, "the ambush to open");
    await p.settle("the ambush");
    if (global("handitem") !== "gun") throw new Error(`openfight() did not arm us — handitem is "${global("handitem")}"`);

    // ---- 2-3. the gun up, and loaded --------------------------------------
    const gunUp = (): boolean => ask(p, "propvisible", ["gunhand"]) === "1";
    for (let i = 0; i < 4 && !gunUp(); i++) {
      pressProp("gun", point(316, 320)); // where new.flt draws the item in hand
      await p.settle("raising the gun");
    }
    if (!gunUp()) throw new Error("the gun would not come up");
    const inChamber = point(200, 200); // HOUSE.PRP/0270 clickinchamber: x < 248 & y < 255
    const outside = point(300, 300);
    const reload = async (): Promise<void> => {
      await p.pump(() => ask(p, "propview", ["gunhand"]) === "idle", "the gun to come back down");
      pressProp("gunhand", outside);
      await p.pump(() => ask(p, "propview", ["gunhand"]) === "reload", "the cylinder to swing out");
      for (let i = 0; i < 8 && number("bulletcount") < 6; i++) {
        pressProp("gunhand", inChamber);
        await p.tick(2);
      }
      pressProp("gunhand", outside);
      await p.pump(() => ask(p, "propview", ["gunhand"]) === "idle", "the cylinder to shut");
    };
    await reload();

    /*
     * Where to shoot: ask `hittest`, which is what `bullet ()` will ask.
     *
     * Eight pixels is a coarse sweep and deliberately so — a hunter at the
     * scale `setupactor ("fight")` gives them (1500) is wider than that at any
     * range he can shoot from, and the sweep runs once per lost target rather
     * than once per shot. The answer is checked against the game's own idea of
     * who is standing, so a corpse is never fired at again.
     */
    const alive = (who: string): boolean => pose(who) !== "dead" && pose(who) !== "todie";
    const sight = (step = 8): { name: string; x: number; y: number } | null => {
      for (let y = 0; y < 264; y += step) {
        for (let x = 0; x < 512; x += step) {
          const name = ask(p, "hittest", [point(x, y)]);
          if (ask(p, "result") !== "actor") continue;
          if (!name.toLowerCase().startsWith("bounty") || !alive(name)) continue;
          return { name, x, y };
        }
      }
      return null;
    };

    /** the cell a bounty hunter is standing on, in the town's grid */
    const cellOf = (who: string): { x: number; z: number } => ({
      x: Math.round((Number(ask(p, "actorxyz", [who, 1])) - 128) / 256),
      z: Math.round((Number(ask(p, "actorxyz", [who, 2])) - 128) / 256),
    });
    /**
     * Walk to a cell one step from a hunter and face him.
     *
     * `walkcloser ()` brings the two walkers to the player's ROW or COLUMN and
     * `walkloop ()` case 2 parks them there as soon as
     * `playerisat () & realdist (me) < hotdist (2)` — and it does not check
     * whether anything is in the way. One of them parked three cells along row
     * 7 with `Scene H8` and `Scene I8` between us: `playerahead ()` walks the
     * cells and finds `isbuild`, so he never fired, and no pixel of him was on
     * the screen to fire back at. That is a stalemate the player breaks by
     * walking, and so does this. Stepping off his row also un-parks him — case
     * 2 falls through to `walkcloser ()` again the moment `playerisat ()` is
     * false.
     */
    const closeIn = async (who: string): Promise<void> => {
      const at = cellOf(who);
      const here = nite.scenes.find(
        (s) => s.name.toLowerCase() === (p.session.currentSceneName()?.toLowerCase() ?? ""),
      );
      if (!here) return;
      const spots = [
        { x: at.x, z: at.z - 1, view: "south" },
        { x: at.x, z: at.z + 1, view: "north" },
        { x: at.x - 1, z: at.z, view: "east" },
        { x: at.x + 1, z: at.z, view: "west" },
      ]
        .filter((c) => nite.scenes.some((s) => s.x === c.x && s.z === c.z && !s.build))
        .sort(
          (a, b) =>
            Math.abs(a.x - here.x) + Math.abs(a.z - here.z) -
            (Math.abs(b.x - here.x) + Math.abs(b.z - here.z)),
        );
      /*
       * Try them in order, because "not built on" is not "the move table
       * reaches it". `build` says a cell carries no scenery; whether a walk can
       * get there from HERE is a question only the transitions answer, and some
       * standpoints are one-way. So take the nearest spot that can actually be
       * walked to rather than insisting on the nearest spot.
       */
      for (const spot of spots) {
        try {
          await walkTo(p, nite, spot, () => !alive(who));
          return;
        } catch {
          // no route to that side of him; try the next
        }
      }
    };

    /**
     * Stand where the script says they can be reached, and shoot until one is
     * down.
     *
     * The aim is kept between shots — `hittest` is re-asked at the same point,
     * and only a point that has stopped answering a living hunter costs a fresh
     * sweep. That is also what a player does: you do not re-find a man you are
     * already pointing at.
     */
    const station = async (
      who: string,
      goal: { x: number; z: number; view: string },
      what: string,
      /** he walks: if he is nowhere to be seen, go and find him */
      chase = false,
    ): Promise<void> => {
      await walkTo(p, nite, goal, () => !alive(who));
      let aim: { name: string; x: number; y: number } | null = null;
      let blind = 0;
      for (let round = 0; round < 900 && alive(who); round++) {
        if (number("bulletcount") === 0) {
          await reload();
          continue;
        }
        if (aim) {
          const still = ask(p, "hittest", [point(aim.x, aim.y)]);
          if (ask(p, "result") !== "actor" || !still.toLowerCase().startsWith("bounty") || !alive(still)) {
            aim = null;
          }
        }
        aim ??= sight();
        if (!aim) {
          /*
           * Nobody in the picture — so LOOK ROUND, rather than wait.
           *
           * `initxyz ()` starts `bounty1`/`bounty2` at one of five stars picked
           * by `random (5)`, so which way they come is not fixed. Standing
           * still facing south was enough for the one that came up the south
           * road and left the one that came along the row unseen behind us.
           */
          blind++;
          if (!chase) {
            // a placed hunter is only up for the length of `standfire ()` and
            // `relax ()`, and `popdown ()` puts him away for another
            // `20 + random (50)`: the station is right, so WAIT there rather
            // than turning off him between pops
            if (blind % 20 === 0) await walkTo(p, nite, goal, () => !alive(who));
          } else if (blind % 12 === 0) {
            await closeIn(who);
          } else {
            await p.press("rightarrow", "looking round for them");
          }
          await p.tick(10);
          continue;
        }
        blind = 0;
        p.fire(aim.x, aim.y);
        await p.tick(3);
      }
      if (alive(who)) throw new Error(`${who} would not go down — ${what}`);
    };

    // `bounty1` and `bounty2` walk to the player, and `initxyz ()` starts each
    // of them at one of five stars by `random (5)` — so the saloon corner is
    // only where the waiting is done, and the looking round and the going to
    // find them is the rest of it
    await station("bounty1", { x: 6, z: 7, view: "south" }, "the two who come to you", true);
    await station("bounty2", { x: 6, z: 7, view: "south" }, "the two who come to you", true);
    // the three who are placed, at the scenes their own `closenough ()` names
    await station("bounty3", { x: 3, z: 6, view: "west" }, "the one at the west end");
    await station("bounty4", { x: 6, z: 12, view: "west" }, "the one down the south road");
    await station("bounty5", { x: 6, z: 5, view: "south" }, "the one on the roof");

    // ---- 4-5. the street quiets down, and Trotter comes out ---------------
    /*
     * The fight is not over while you are still looking at the bodies.
     *
     * `EXTRA.CST/0287 deadexits ()` runs on the last one to die, and its second
     * loop is `if actordist (name) != 32000 & actorvisible (me) = true` →
     * `makeloop ("actor", me, "deadexits", 6)` — it will not put the corpses
     * down, and so will not reach `sendtoset (closefight ())`, while any of
     * them is in the picture. Turning away is what finishes it.
     */
    for (let i = 0; i < 30 && global("loopsound") !== ""; i++) {
      await p.press("rightarrow", "turning away from the bodies");
      await p.tick(30);
    }
    await p.pump(() => global("loopsound") === "", "closefight () to run");
    // the gun goes back in its holster: with `gunhand` visible every click at
    // the set is a round fired (`BOOTFILE/0001 mousedown`), doors included
    await p.pump(() => ask(p, "propview", ["gunhand"]) === "idle", "the gun to settle");
    for (let i = 0; i < 4 && gunUp(); i++) {
      pressProp("gun", point(316, 320));
      await p.settle("holstering the gun");
      await p.tick(30);
    }
    if (gunUp()) throw new Error("the gun would not go down");

    await meet(p, nite, "trotter", "Trotter after the fight");
    await answer(p, 103, "That all?");
    /*
     * ...and then out, WITHOUT answering anything else. The 103 arm speaks
     * `trotter.92` and `trotter.93` and exits, but the plaque list it was
     * chosen from stays framed until something clears it (rule 3), so a
     * `talkOut` told to prefer 103 would find it a second time. An empty list
     * means "nothing here is worth answering": the spoken lines get their
     * click, and a question with no reply we want gets ESC.
     */
    await talkOut(p, [], "Trotter after the fight");
    await p.pump(() => number("trotterphase") === 1 && number("fighton") === 0, "Trotter to call it off");

    // ---- 6. into the bank, through the door the hairpin opens -------------
    await walkTo(p, nite, { x: 6, z: 5, view: "west" });
    if (owner("hairpin") !== "stranger") throw new Error("no hairpin — the bank cannot be opened");
    p.fire((200 + 306) / 2, (81 + 232) / 2);
    await p.pump(() => room(p).startsWith("bank"), "the bank");
    await p.settle("the bank");

    // ---- 7. the safe ------------------------------------------------------
    await walkTo(p, bank, { x: 3, z: 0, view: "west" });
    p.fire((80 + 442) / 2, (0 + 261) / 2);
    await p.pump(() => ask(p, "propvisible", ["spin"]) === "1", "the safe's dial");
    await p.settle("the safe");

    // ---- 8. the combination ----------------------------------------------
    /*
     * The pointer positions that turn the dial, in the dial's own numbering.
     *
     * `CRACK.PRP/0002` reads `fixdeg256 (calcdeg (propxy (me, 3), mouse ()) +
     * 64)`, so this asks those builtins the same question of every point on a
     * coarse grid and keeps one point per value. Walking the list one entry at
     * a time steps `newd` by one, which is the largest step the ratchet can
     * turn in a pass — so the dial can never jump past the number wanted.
     */
    const centre = Number(ask(p, "propxy", ["spin", 3]));
    const dialValueAt = (x: number, y: number): number => {
      let deg = Number(ask(p, "calcdeg", [centre, point(x, y)])) + 64;
      while (deg < 0) deg += 256;
      while (deg > 255) deg -= 256;
      return Math.trunc((deg * 50) / 256);
    };
    const byValue = new Map<number, { x: number; y: number }>();
    for (let y = 0; y < 384; y += 3) {
      for (let x = 0; x < 512; x += 3) {
        const v = dialValueAt(x, y);
        if (!byValue.has(v)) byValue.set(v, { x, y });
      }
    }
    const ring = [...byValue.entries()].sort((a, b) => a[0] - b[0]).map(([, at]) => at);
    if (ring.length < 3) throw new Error(`the dial's ring is ${ring.length} points wide`);
    const dial = (): number => Number(ask(p, "propdeg", ["spin"]));

    const dialTo = async (target: number): Promise<void> => {
      // `turnright` says which way the ratchet will move THIS number: 1 lets
      // the dial fall, 0 lets it rise, and a rising `newd` is what makes it fall
      const down = number("turnright") === 1;
      let i = down ? 0 : ring.length - 1;
      let step = down ? 1 : -1;
      p.session.setPointer(ring[i].x, ring[i].y);
      p.session.pointerDown = true;
      try {
        pressProp("spin", point(ring[i].x, ring[i].y));
        await p.tick(2);
        for (let n = 0; n < 4000 && dial() !== target; n++) {
          i += step;
          if (i >= ring.length || i < 0) {
            // out of screen: turn the wrist back, which the ratchet refuses,
            // and come round again
            i = Math.max(0, Math.min(ring.length - 1, i));
            step = -step;
            continue;
          }
          p.session.setPointer(ring[i].x, ring[i].y);
          const was = dial();
          for (let w = 0; w < 6 && dial() === was; w++) await p.tick(1);
        }
      } finally {
        p.session.pointerDown = false;
      }
      await p.tick(4);
      await p.settle("the dial");
      if (dial() !== target) throw new Error(`the dial stopped on ${dial()}, not ${target}`);
    };
    await dialTo(8);
    await dialTo(23);
    await dialTo(41);
    if (global("combo") !== "08,23,41,") throw new Error(`the combination reads "${global("combo")}"`);

    // ---- 9. the handle, and the film -------------------------------------
    p.fire((352 + 417) / 2, (96 + 256) / 2); // crack.flt's "tryopen" region
    for (let i = 0; i < 400 && owner("tstone") !== "stranger"; i++) {
      await p.tick(10);
      const regions = p.v().movieRegions;
      if (!regions.length) continue;
      // the small box is the strongbox; the big one behind it walks away
      const box = regions
        .slice()
        .sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0))[0];
      p.fire(Math.round((box.x0 + box.x1) / 2), Math.round((box.y0 + box.y1) / 2));
      await p.tick(10);
    }
    if (owner("tstone") !== "stranger") throw new Error("the strongbox was never opened");
    await p.pump(() => room(p).startsWith("bank"), "the bank to come back");
    await p.settle("the safe closing");

    // ---- 10-11. out of the bank and into the hotel ------------------------
    await openDoor(p, [177, 30, 339, 263], "dollar", "the bank's door", {
      set: bank, x: 3, z: 1, view: "east",
    });
    await p.pump(() => room(p).startsWith("nite"), "the street outside the bank");
    await openDoor(p, [200, 91, 305, 203], "hotel", "the hotel door", {
      set: nite, x: 6, z: 4, view: "east",
    });
    await p.pump(() => room(p).startsWith("hotlower"), "the hotel lobby");
    await p.pump(() => global("theset") === "hotlower", "Fear to be set up at the desk");

    // ---- 12. Fear at the desk --------------------------------------------
    await walkTo(p, hotlower, { x: 0, z: 0, view: "east" });
    await clickActor(p, "fear", "Fear at the hotel desk");
    await answer(p, 103, "Bye.");
    await talkOut(p, [], "Fear at the hotel desk");
    await p.pump(() => number("fearphase") === 1, "Fear to say goodnight");

    // ---- 13. upstairs, and the key to the room ----------------------------
    await walkTo(p, hotlower, { x: 3, z: 2, view: "north" });
    await p.press("uparrow", "up the hotel stairs");
    await p.pump(() => room(p).startsWith("hotupper"), "the hotel landing");
    await openDoor(p, [168, 50, 329, 263], "playroom", "the door of the player's room", {
      set: hotupper, x: 2, z: 3, view: "west",
    });
    await p.pump(() => room(p).startsWith("hotroom"), "the player's room");
    await p.pump(() => global("handitem") === "hrkey", "the room key in hand");
    await walkTo(p, hotroom, { x: 0, z: 0, view: "west" });
  },
};
