import { answer, ask, openDoor, room, set, walkTo, type Segment } from "../route";

/**
 * Day 4: the Kid's gang in the street, the insult duel, and the day turning twice.
 *
 * `D4M_002` stands in the saloon at `day = 4`, `clock = 1`, `phase = 1`, and
 * `TOWN.SET/0131 openscene ()` — the cell the saloon's front door lets you out
 * onto — ends
 *
 *     if day = 4 & clock = 1 & phase = 1
 *         sendtostage (advanceday ())
 *
 * So walking out of the saloon is the end of the morning, and `NEW.FLT/0001
 * advanceday ()`'s day-4 `case 2` is two lines: `initall ("town", "town.set")`
 * and `sendtoset (openfight ())`. The rung then runs `advanceday ()` a SECOND
 * time at the far end of the fight, which is the whole of `clock 1 → 3`: the
 * afternoon is not skipped, it is the fight, and the save is taken at the start
 * of the night the fight's own ending calls for.
 *
 * `TOWN.SET/0001 openfight ()`'s day-4 arm sets `fighton = 1`, `playerhits = 0`,
 * `phase = 2`, `clock = 2`, **`fightphase = 1`**, three powder kegs and
 * kidgang1..3, with kidgang4 and kidgang5 posed "dead" and hidden. Before any of
 * that it does
 *
 *     size = countactors ()
 *     for count = 1 to size
 *         sendtoactor (indextoactor (count), initactor ())
 *     endfor
 *
 * and every cast entry's `initactor ()` zeroes that character's phase — which is
 * the whole of the save's `dellphase 1 → 0`, `fearphase 1 → 0`,
 * `jonesphase 2 → 0` and `trotterphase 2 → 0`. Nobody was spoken to on this
 * rung; the fight wiped the board, and `initall ()`'s own `initactors ()` sweep
 * wipes it again at the end.
 *
 *  1. **Out of the saloon.** `SALLOWER.SET/0052` is Scene D1, `pointinrice`
 *     144,7–387,264 facing east, door prop "salout", `uparrow` →
 *     `gototown ("east")`. At `clock = 1` that is `town.set`, landing on
 *     `townscene`, which `D4M_002` holds at Scene G8 — cell (6,7), the front of
 *     the saloon, and the cell whose `openscene ()` is quoted above.
 *  2. **The gun.** `openfight ()`'s `addinven ("gun")` only puts it in the HAND;
 *     raising it is a click on the gun where the panel draws it
 *     (`INVEN.PRP/0406 mousedown`: `propview (me) = "large"` → `sendtoprop
 *     ("gunhand", raise ())`, and `NEW.FLT/0002 openflat ()` puts the held item
 *     at 316,320). Reloading is `HOUSE.PRP/0270 mousedown` on the gunhand: one
 *     press swings the cylinder out, each press inside `clickinchamber (arg)` —
 *     `pointx < 248 & pointy < 255` — is one round while `propowner ("bullets")
 *     = "stranger"`, and a press outside it shuts it. `D4M_002` comes in with
 *     two rounds left, so the first thing this rung does is thumb four more in.
 *  3. **The fight is three fights.** `EXTRA.CST/0450` is one cast entry
 *     instanced five times (`openactor ()`), and `deadexits ()` — which runs when
 *     all five poses are "dead" — is `fightphase = fightphase + 1` and then
 *     either five fresh `setupactor ("fight")` calls or, at 4,
 *     `sendtoset (closefight ())`. So the save's **`fightphase = 4` is "the gang
 *     was killed three times over"**, and nothing else. The three rounds are
 *     different fights:
 *
 *       - **`fightphase = 1` — kidgang1..3 walk to you.** `walkcloser ()` steps
 *         them one cell at a time towards `cameraxyz` and `walkloop ()` case 2
 *         parks them into `attackmode ()` once
 *         `playerisat () & realdist (me) < hotdist (2)` — one row or column
 *         away, inside six cells. kidgang4 and kidgang5 are already "dead", so
 *         this round is three men. `initxyz ()` starts each at one of
 *         `scene a7 / b11 / k7 / k11 / g15` by `random (5)`, so which way they
 *         come is not fixed and the driver goes to look.
 *       - **`fightphase = 2` — five placed men, one street corner each.**
 *         `initxyz ()` puts them at (1990,3340), (150,1150), (1900,2150,150),
 *         (2090,1750,20) and (1670,600,200), and `statloop ()` only breaks cover
 *         when `closenough ()` names the scene the PLAYER is standing on. Those
 *         lists are the route's stations, and they are disjoint enough to fight
 *         the five one at a time: Scene G13 answers only kidgang1, Scene A7 only
 *         kidgang2, Scene G9 only kidgang3, Scene H7 only kidgang4 and Scene G4
 *         only kidgang5.
 *       - **`fightphase = 3` — the same five in the main street.** kidgang1 at
 *         (6,7) and kidgang2 at (6,9); kidgang3, kidgang4 and kidgang5 share
 *         (6,3) and `initxyz ()` refuses to arm any of the three until BOTH of
 *         the first two are dead. `closenough ()` here is `playerisat ()` and a
 *         distance rather than a list, so the stations are cells in column G.
 *
 *     Four landed shots kill any of them: `hit ()` increments `actorvalue` and
 *     `hitwalker ()`/`hitstat ()` check `actorvalue (me) > hotdist (4)`, which
 *     `EXTRA.CST/0450`'s own `hotdist` answers 2 — so hits three and four finish
 *     the job. Where to aim is asked of the game rather than guessed:
 *     `NEW.FLT/0002 bullet ()` resolves a shot with `hittest (thepoint)`, so the
 *     route sweeps `hittest` across the picture and fires at the first pixel
 *     that answers a living gunman.
 *  4. **Three conditions, and they are not the same condition.** The first
 *     draft of the driver ran them together and lost the fight twice.
 *
 *       - **Armed** is `variable (me) = 1`. `initxyz ()` makes the gunman
 *         visible and then hides him again unless `actordist (me) = 32000`, so
 *         a man cannot take up his position while you are looking at his corner.
 *         Until he has it, turning away IS the job — and `variable` with a name
 *         the cast never counted writes a global of that name, so `kidgang1..5`
 *         are readable from outside as exactly this.
 *       - **In the picture** is `actordist () != 32000`, and standing on a cell
 *         his `closenough ()` names does not imply it. Nor does it imply
 *         SHOOTABLE: kidgang5's phase-2 perch is a roof at z = 200, and from
 *         Scene G4 one cell away `actordist ()` answers 297 while no pixel of
 *         him is on the screen at all. So the driver walks the rest of his list
 *         when a cell yields nothing, rather than waiting there.
 *       - **Behind cover** is neither. `popdown ()` puts a man away for
 *         `20 + random (20)` and `statloop ()` brings him back by itself, so a
 *         driver that turns while a placed gunman is up pays for it in the one
 *         currency that matters: `TOWN.SET/0001 hit ()` is `if day = 4 &
 *         playerhits > 30` → `playerdeath = "by gang"`, and turning at
 *         kidgang5's station took twenty-one hits before this was separated out.
 *         With the three apart the fight is won on 22 of the 30.
 *  5. **`closefight ()` does not end the fight flag.** Its day-4 arm is
 *     `phase = 3`, `currentcd ("player", 0, 0)` and the three kegs put down —
 *     and `fighton`, although declared, is never assigned. That is why `fighton`
 *     reads 1 in `D4E_001` with nobody shooting: on day 4 nothing clears it, and
 *     `advanceday ()`'s day-4-night arm then sets it to 1 again on purpose.
 *  6. **The Kid.** `TOWN.SET/0128 openscene ()` — Scene G5, the hotel's own cell
 *     — is `if day = 4 & clock = 2 & phase = 3 & currentview () = "south"` →
 *     `openkid ()`, so `closefight ()`'s `phase = 3` is what arms it. The route
 *     approaches from the NORTH, down Scene G4, because the trigger wants the
 *     southward view and `uparrow` out of Scene G6 walks the wrong way; the last
 *     step is taken by hand because everything below happens inside that one
 *     keypress. `openkid ()` walks the Kid up from Scene G10 to Scene G6
 *     (`EXTRA.CST/0202 setupactor ("walkin")`, whose `stdactor (me)` is what
 *     writes **`theset = "town"`**) and runs `kid.pup`.
 *  7. **The duel is five plaques, and 101 every time.** `KID.PUP/0051` is one
 *     shape repeated five times: one real cut-down, numbered **101**, and four
 *     lame ones all numbered 102. 101 speaks a line, runs `kidbad ()` and does
 *     `cutdowns = cutdowns + 1`; 102 runs `kidwin ()`. Round five's 101 exists
 *     only `if propowner ("matchbox") = "stranger"` — the light for the Kid's
 *     cigar — which it has been since day 2, and `Scene G4`'s own `openscene ()`
 *     is the one thing on this route that could have given it away. Back in
 *     `openkid ()`, `if cutdowns < 4` is `kidinv.mov` and
 *     `playerdeath = "by kid"`.
 *  8. **`kiddie.mov` is a puzzle film, and a fast one.** 89 frames in three
 *     stretches; every frame of a stretch offers a small box that jumps to the
 *     next stretch (10-19 → 20, 21-31 → 32, 38-48 → 49) and the whole picture
 *     behind it, which does not. Frames 19, 31 and 48 are `action 3` and end the
 *     film where it stands, and `actionframe (1)` is frame 80, reachable only
 *     through all three boxes — `if actionframe (1) = false` is
 *     `playerdeath = "by kid"` again, which shows in the log as `kidwin.mov`,
 *     `dies3.mov` and the death flat. Unlike `safebox.mov` its frames do not
 *     WAIT: they run on with the regions live, so the poll is one tick wide.
 *  9. **The night, and the Blade.** `openkid ()` ends `sendtostage
 *     (advanceday ())`. `clock` goes 2 → 3, `phase` back to 0, `townscene` and
 *     `savescene` are rewritten (which is where the save's lower-case
 *     **"scene g5"** comes from — `D4M_002` had the mixed-case "Scene G8" the
 *     saloon's back door wrote), `d4ad4n.mov` plays, and `initall ("town",
 *     "nite.set")` reopens the town as the night set while keeping the scene and
 *     view, because `currentset ()` is already "town". `initall ()`'s
 *     `sendtoshop ("inven", initprops ())` is `INVEN.PRP/0001`, whose day-4 arm
 *     is `if clock > 2 addinven ("blade")` — the save's one TAKE — and the
 *     `handitem` that `addinven ()` sets is cleared four lines later by
 *     `initall ()` itself, which is why the save records the Blade owned and
 *     nothing in hand.
 *
 * **Not claimed**, and why.
 *
 *   - **`playerhits` (14 → 28).** `openfight ()` resets it to 0, so the 28 is
 *     this fight and not the running total. `NEW.FLT/0002 ishit (dist)` looks
 *     like a die roll and is not — its cases fall through to `if dist > 0 return
 *     (true)` — but WHETHER a gunman shoots on a given pass is
 *     `random (100) < 32` in `attackmode ()`, `random (100) < 33` in
 *     `walkloop ()`, `random (100) < 50` in `fire ()` and `random (100) < 40`
 *     or `< 50` inside `closenough ()` itself. It is a race, not a skill check.
 *     This route comes out of the street on 22 of the 30 that would have ended
 *     it.
 *   - **`wincount` (created, 3).** `runyoself ()` opens with
 *     `wincount = random (4) - 1`, and `kidwin ()` — the only thing that
 *     increments it — never runs on a route that answers 101 five times. So the
 *     save's 3 is the die roll and nothing else.
 *
 *     It is also a fifth control for the **`dumpglobal`** question
 *     (`docs/engine/scripting-language.md`), and it reads the same way as the
 *     other four. `runyoself ()` assigns `badcount` and `wincount` on adjacent
 *     lines, unconditionally, and `talk5 ()` ends `dumpglobal badcount,
 *     wincount`; nothing else in the corpus touches either name. `D4E_001`
 *     carries `wincount` and does **not** carry `badcount` — the first name of
 *     the list gone and the second kept. The port destroys the whole list, so
 *     `wincount` cannot be claimed from here either way.
 *   - **`cutdowns` (created, 5).** Five is "all five cut-downs landed", and the
 *     route earns it — it is counted as it goes and asserted, because it cannot
 *     be read at the end. `openkid ()` does `dumpglobal cutdowns` between the
 *     `if cutdowns < 4` test and the film, and that is a ONE-NAME list, so under
 *     the port's reading and under the first-name-only reading alike the global
 *     is destroyed before the save was taken. `D4E_001` has it at 5 regardless.
 *     That is a case neither reading explains, and this is not the rung to
 *     settle it on.
 *   - **`bouncer` and `dirgo`** (`dirgo` 0 → absent). `GANG.CST/0984`'s
 *     `putdownactor ()` is `dumpglobal bouncer, dirgo` and it runs on every one
 *     of the `initactor ()` sweeps above, but the pair is the withdrawn control
 *     in that same table: `isaoidle ()` writes the two names on different
 *     schedules, so which of them exists says more about how long Isao has been
 *     on screen than about what the teardown did.
 *   - **`vitalframe` and `tumx2`/`tumy2`.** The first is `advanceday ()`'s
 *     `frame ()` stamp and the other two are the tumbleweed on its own
 *     `kickme` loop. All three measure elapsed frames.
 *   - **`kidgang1..5` and `playerscene`** are 0 at both ends. The five are
 *     `variable (me)` and `initactors ()` puts them back to 0 on the way into
 *     the night; `playerscene` is only ever assigned on `hitwalker ()`'s branch
 *     for a walker hit from off his row and column, and neither the original nor
 *     this route took that shot.
 *
 * **One engine gap, which makes this fight easier than it was in 1995.**
 * `hit ()`'s guard for a placed gunman is `if currentcd (me, 1) = 0 exitcode` —
 * cover. In Dust's v1 opcode table 16034 is `actorhitbox (actor, index[, value])`
 * and the port answers it with v4's `currentcd`, which is the CD volume label
 * (`engine/src/df/opcodes.ts` says so, and lists it as the one rename not done).
 * So the test reads a string against `0`, is false, and a man behind cover can
 * be shot here. `D3E_004`'s bounty hunters run on the same gap.
 */
export const rung: Segment = {
  from: "D4M_002",
  to: "D4E_001",
  what: "the Kid's gang in the street, the insult duel, and the day turning twice",
  claims: [
    "day", "clock", "phase", "fighton", "fightphase",
    "handitem", "theset", "townscene", "bulletcount", "playerdeath",
    "dellphase", "fearphase", "jonesphase", "trotterphase",
  ],
  async play(p) {
    const sallower = set("SALLOWER");
    const town = set("TOWN");
    const global = (name: string): string =>
      String(p.session.interp.globals.get(name) ?? "").toLowerCase();
    const number = (name: string): number => Number(p.session.interp.globals.get(name) ?? 0);
    const owner = (name: string): string => ask(p, "propowner", [name]).toLowerCase();
    const pose = (who: string): string => ask(p, "actorpose", [who]).toLowerCase();
    const point = (x: number, y: number): number => Number(ask(p, "makepoint", [x, y]));
    const scene = (): string => (p.session.currentSceneName() ?? "").toLowerCase();
    /** run a prop's own `mousedown` with a POINT, the way a shop script reads it */
    const pressProp = (name: string, at: number): void => {
      const script = p.session.propScripts.get(name);
      if (!script) throw new Error(`no prop script for "${name}"`);
      void p.session.track(
        p.session.interp.runHandler(script, "mousedown", [at], { me: name, target: name }),
      );
    };

    // ---- 1. out of the saloon, which is the end of the morning ------------
    await walkTo(p, sallower, { x: 3, z: 0, view: "east" });
    await openDoor(p, [144, 7, 387, 264], "salout", "the saloon's front door", {
      set: sallower, x: 3, z: 0, view: "east",
    });
    await p.pump(() => room(p).startsWith("town"), "the street outside the saloon");
    // `TOWN.SET/0131 openscene ()` at day 4, clock 1, phase 1 is
    // `sendtostage (advanceday ())`, and day 4's `case 2` arm is
    // `initall ("town", "town.set")` and then `sendtoset (openfight ())`
    await p.pump(() => number("fighton") === 1, "the gang to open up");
    await p.settle("the ambush");
    if (number("fightphase") !== 1) throw new Error(`openfight () left fightphase at ${number("fightphase")}`);
    if (global("handitem") !== "gun") throw new Error(`openfight () did not arm us — handitem is "${global("handitem")}"`);

    // ---- 2. the gun up, and loaded ----------------------------------------
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

    // ---- 3. the fight -----------------------------------------------------
    const alive = (who: string): boolean => pose(who) !== "dead" && pose(who) !== "todie";
    const gang = [1, 2, 3, 4, 5].map((n) => `kidgang${n}`);
    /** ask `hittest` what `bullet ()` will ask, and take the first living gunman */
    const sight = (step = 8): { name: string; x: number; y: number } | null => {
      for (let y = 0; y < 264; y += step) {
        for (let x = 0; x < 512; x += step) {
          const name = ask(p, "hittest", [point(x, y)]);
          if (ask(p, "result") !== "actor") continue;
          if (!name.toLowerCase().startsWith("kidgang") || !alive(name)) continue;
          return { name, x, y };
        }
      }
      return null;
    };
    /** the cell a gunman is standing on, in the town's grid */
    const cellOf = (who: string): { x: number; z: number } => ({
      x: Math.round((Number(ask(p, "actorxyz", [who, 1])) - 128) / 256),
      z: Math.round((Number(ask(p, "actorxyz", [who, 2])) - 128) / 256),
    });
    /** walk to a cell one step from a walker and face him */
    const closeIn = async (who: string): Promise<void> => {
      const at = cellOf(who);
      const here = town.scenes.find((s) => s.name.toLowerCase() === scene());
      if (!here) return;
      const spots = [
        { x: at.x, z: at.z - 1, view: "south" },
        { x: at.x, z: at.z + 1, view: "north" },
        { x: at.x - 1, z: at.z, view: "east" },
        { x: at.x + 1, z: at.z, view: "west" },
      ]
        .filter((c) => town.scenes.some((s) => s.x === c.x && s.z === c.z && !s.build))
        .sort(
          (a, b) =>
            Math.abs(a.x - here.x) + Math.abs(a.z - here.z) -
            (Math.abs(b.x - here.x) + Math.abs(b.z - here.z)),
        );
      if (!spots.length) return;
      await walkTo(p, town, spots[0], () => !alive(who));
    };

    /** `variable (me)` — a name the cast never counted, so it is a global of that name */
    const armed = (who: string): boolean => number(who) !== 0;
    /** is he in the picture at all? `actordist ()` is 32000 for anything the
     *  camera is not looking at (engine/src/runtime/builtins/actors.ts) */
    const onScreen = (who: string): boolean => Number(ask(p, "actordist", [who])) !== 32000;

    /**
     * Phase one: the three who WALK to you, found by going to look for them.
     *
     * `walkloop ()` steps kidgang1..3 one cell at a time towards `cameraxyz`
     * and parks each into `attackmode ()` the moment
     * `playerisat () & realdist (me) < hotdist (2)` — one row or column away,
     * inside six cells — and it does not check whether anything is in the way.
     * So the corner the saloon lets you out onto is where the waiting is done,
     * and the looking round and the going to find them is the rest of it.
     */
    const walker = async (
      who: string,
      goal: { x: number; z: number; view: string },
      what: string,
    ): Promise<void> => {
      const done = (): boolean => !alive(who) || number("fightphase") > 1;
      const hitsAt = number("playerhits");
      await walkTo(p, town, goal, done);
      let aim: { name: string; x: number; y: number } | null = null;
      let blind = 0;
      for (let round = 0; round < 1200 && !done(); round++) {
        if (number("bulletcount") === 0) {
          await reload();
          continue;
        }
        if (aim) {
          const still = ask(p, "hittest", [point(aim.x, aim.y)]);
          if (ask(p, "result") !== "actor" || !still.toLowerCase().startsWith("kidgang") || !alive(still)) {
            aim = null;
          }
        }
        aim ??= sight();
        if (aim) {
          blind = 0;
          p.fire(aim.x, aim.y);
          await p.tick(3);
          continue;
        }
        blind++;
        if (blind % 12 === 0) await closeIn(who);
        else await p.press("rightarrow", "looking round for them");
        await p.tick(10);
      }
      if (process.env.DUST_TALK) {
        console.log(`[walker ${who}] took ${number("playerhits") - hitsAt} hits (${number("playerhits")} of 30)`);
      }
      if (!done()) throw new Error(`${who} would not go down — ${what}`);
    };

    /**
     * Stand where the script says he can be reached, look until he is in the
     * picture, and shoot until he is down.
     *
     * Three separate conditions, and the first draft ran them all together and
     * lost the fight twice over. **Armed** is `variable (me) = 1`, which
     * `initxyz ()` will only set while the gunman is off the screen — so until
     * he has it, turning away is the whole job. **In the picture** is
     * `actordist () != 32000`, and it is not implied by standing on a cell his
     * `closenough ()` names: kidgang1's phase-2 list is Scene G11, G12 and G13
     * and he is up on (7,13), which is nowhere in the southward view from G13.
     * A driver that cannot tell "he is behind cover" from "he is behind me"
     * turns when it should hold and holds when it should turn; this one asks.
     */
    const station = async (
      who: string,
      cells: { x: number; z: number; view: string }[],
      what: string,
    ): Promise<void> => {
      const done = (): boolean => !alive(who) || number("fightphase") > 3;
      const hitsAt = number("playerhits");
      let at = 0;
      await walkTo(p, town, cells[0], done);
      let aim: { name: string; x: number; y: number } | null = null;
      let blind = 0;
      for (let round = 0; round < 1500 && !done(); round++) {
        if (number("bulletcount") === 0) {
          await reload();
          continue;
        }
        if (aim) {
          const still = ask(p, "hittest", [point(aim.x, aim.y)]);
          if (ask(p, "result") !== "actor" || !still.toLowerCase().startsWith("kidgang") || !alive(still)) {
            aim = null;
          }
        }
        if (!aim && onScreen(who)) aim = sight(blind > 2 ? 4 : 8);
        if (aim) {
          blind = 0;
          p.fire(aim.x, aim.y);
          await p.tick(3);
          continue;
        }
        blind++;
        if (!armed(who)) {
          // he has not taken his position yet, and `initxyz ()` refuses to place
          // him while he is on the screen — so give him the corner
          await p.press("rightarrow", `letting ${who} take his position`);
          continue;
        }
        if (blind % 12 === 11) {
          /*
           * Nothing from here — so try the next cell on his list, whether or
           * not he is in the picture.
           *
           * "In the picture" and "shootable" are still not the same thing.
           * kidgang5 stands on a roof at z = 200, and from Scene G4, one cell
           * away, `actordist ()` answers 297 and no pixel of him is on the
           * screen at all: he is above its top edge. Standing there and waiting
           * cost twenty-one hits before this line existed.
           */
          at++;
          await walkTo(p, town, cells[at % cells.length], done);
          continue;
        }
        if (!onScreen(who)) {
          await p.press("rightarrow", `looking for ${who}`);
          continue;
        }
        // in the picture and behind cover: `popdown ()` puts him away for
        // `20 + random (20)` and `statloop ()` brings him back by itself, so the
        // wait is his. Turning here is what cost twenty hits in the first draft.
        await p.tick(4);
      }
      if (process.env.DUST_TALK) {
        console.log(`[station ${who}] took ${number("playerhits") - hitsAt} hits (${number("playerhits")} of 30)`);
      }
      if (!done()) throw new Error(`${who} would not go down — ${what}`);
    };

    /**
     * The cells each gunman can be reached from, per `fightphase`.
     *
     * `EXTRA.CST/0450 closenough ()` is a list of scene names per gunman and per
     * phase, and one whose list does not name the cell you are standing on never
     * breaks cover. These are those lists, ordered so that the cells only ONE of
     * the five answers to come first.
     */
    const stations: Record<number, Record<string, { x: number; z: number; view: string }[]>> = {
      2: {
        // his roof is (7,13); g13 g12 g11
        kidgang1: [{ x: 6, z: 12, view: "east" }, { x: 6, z: 11, view: "south" }, { x: 6, z: 10, view: "south" }],
        // he is at (0,4); a7 b7 c7 d5 d4 d6 e4
        kidgang2: [{ x: 0, z: 6, view: "north" }, { x: 3, z: 4, view: "west" }, { x: 1, z: 6, view: "north" },
                   { x: 2, z: 6, view: "north" }, { x: 3, z: 3, view: "west" }, { x: 3, z: 5, view: "west" },
                   { x: 4, z: 3, view: "west" }],
        // he is up at (7,8); g9 g10 g11 f11 g8 g7
        kidgang3: [{ x: 6, z: 8, view: "east" }, { x: 6, z: 9, view: "north" }, { x: 6, z: 10, view: "north" },
                   { x: 5, z: 10, view: "east" }, { x: 6, z: 7, view: "south" }, { x: 6, z: 6, view: "south" }],
        // he is at (8,6); h7 j7 k7 j6 i7 f7 g7 g6
        kidgang4: [{ x: 7, z: 6, view: "east" }, { x: 9, z: 6, view: "west" }, { x: 10, z: 6, view: "west" },
                   { x: 9, z: 5, view: "south" }, { x: 8, z: 6, view: "east" }, { x: 5, z: 6, view: "east" },
                   { x: 6, z: 6, view: "east" }, { x: 6, z: 5, view: "east" }],
        // he is up at (6,2); g4 f4 h4 g5 g6 g7
        kidgang5: [{ x: 6, z: 3, view: "north" }, { x: 5, z: 3, view: "north" }, { x: 7, z: 3, view: "north" },
                   { x: 6, z: 4, view: "north" }, { x: 6, z: 5, view: "north" }, { x: 6, z: 6, view: "north" }],
      },
      3: {
        // he is at (6,7): the column, four cells, or f7 / h7
        kidgang1: [{ x: 6, z: 5, view: "south" }, { x: 5, z: 6, view: "east" }, { x: 7, z: 6, view: "west" },
                   { x: 6, z: 6, view: "south" }],
        // he is at (6,9): the column, four cells, or f7 / f11 / h11
        kidgang2: [{ x: 6, z: 7, view: "south" }, { x: 5, z: 10, view: "east" }, { x: 7, z: 10, view: "west" },
                   { x: 6, z: 11, view: "north" }],
        // the three of them share (6,3), and want the row or the column inside six
        kidgang3: [{ x: 6, z: 5, view: "north" }, { x: 5, z: 3, view: "east" }, { x: 7, z: 3, view: "west" },
                   { x: 6, z: 6, view: "north" }],
        kidgang4: [{ x: 6, z: 5, view: "north" }, { x: 5, z: 3, view: "east" }, { x: 7, z: 3, view: "west" },
                   { x: 6, z: 6, view: "north" }],
        kidgang5: [{ x: 6, z: 5, view: "north" }, { x: 5, z: 3, view: "east" }, { x: 7, z: 3, view: "west" },
                   { x: 6, z: 6, view: "north" }],
      },
    };
    /**
     * A cell no `closenough ()` list names, where the five can take up position.
     *
     * Arming and being shot at are the same act of turning away, so it is worth
     * doing all of it somewhere nobody can answer. Scene E7 is in none of the
     * phase-2 lists; Scene D9 shares neither row nor column with any phase-3
     * position and is none of the `f7`/`f11`/`h7`/`h11` names those cases add.
     */
    const cover: Record<number, { x: number; z: number; view: string }> = {
      2: { x: 4, z: 6, view: "north" },
      3: { x: 3, z: 8, view: "north" },
    };
    const takePositions = async (phase: number): Promise<void> => {
      await walkTo(p, town, cover[phase], () => number("fightphase") !== phase);
      for (let i = 0; i < 20 && gang.some((who) => alive(who) && !armed(who)); i++) {
        if (number("fightphase") !== phase) return;
        await p.press("rightarrow", "giving the street back to them");
        await p.tick(20);
      }
    };

    for (let guard = 0; guard < 24 && number("fightphase") <= 3; guard++) {
      const phase = number("fightphase");
      const target = gang.find((who) => alive(who));
      if (!target) {
        /*
         * All five down, and the phase does not turn while you are looking at
         * them. `deadexits ()` will not put the bodies down — and so will not
         * reach its own `fightphase = fightphase + 1` — while
         * `actordist (name) != 32000` for any of them. Turning away finishes it.
         */
        const was = number("fightphase");
        for (let i = 0; i < 40 && number("fightphase") === was; i++) {
          await p.press("rightarrow", "turning away from the bodies");
          await p.tick(30);
        }
        continue;
      }
      if (phase === 1) {
        // `walkloop ()`: kidgang1..3 come to you, and `initxyz ()` starts each at
        // one of five stars by `random (5)`, so which way they come is not fixed.
        // The saloon's own corner is only where the waiting is done.
        await walker(target, { x: 6, z: 7, view: "south" }, "the three who come to you");
        continue;
      }
      if (!armed(target)) await takePositions(phase);
      if (number("fightphase") !== phase) continue;
      const next = gang.find((who) => alive(who)) ?? target;
      await station(next, stations[phase][next], `${next} in fightphase ${phase}`);
    }
    await p.pump(() => number("fightphase") === 4, "the last of the gang to go down");
    await p.pump(() => number("phase") === 3, "closefight () to run");
    if (global("playerdeath") !== "") throw new Error(`the gang won: playerdeath = "${global("playerdeath")}"`);

    // ---- 4. reload, and put the gun away ----------------------------------
    // `D4E_001` records a FULL cylinder, which is not what is left over from a
    // gunfight: it is the reload a player does when the shooting stops.
    await reload();
    await p.pump(() => ask(p, "propview", ["gunhand"]) === "idle", "the gun to settle");
    for (let i = 0; i < 4 && gunUp(); i++) {
      pressProp("gun", point(316, 320));
      await p.settle("holstering the gun");
      await p.tick(30);
    }
    if (gunUp()) throw new Error("the gun would not go down");

    // ---- 5. the Kid, at the hotel's own cell ------------------------------
    // `TOWN.SET/0128 openscene ()` — Scene G5 — is `day = 4 & clock = 2 &
    // phase = 3 & currentview () = "south"` → `openkid ()`. So the approach is
    // from the NORTH, down Scene G4, and the last step south is taken by hand:
    // everything that follows happens inside that one keypress, and a `press`
    // that waits for quiet would answer the Kid's plaques with `LEAVING`.
    await walkTo(p, town, { x: 6, z: 3, view: "south" });
    void p.session.track(p.v().keyDown("uparrow"));
    await p.pump(() => !!p.session.puppet, "the Kid to walk up the street");

    /*
     * Five rounds, and **101 every time**.
     *
     * `KID.PUP/0051` is one shape repeated: five plaques, one of them a real
     * cut-down (101) and four of them lame (102). 101 runs `kidbad ()` and
     * `cutdowns = cutdowns + 1`; 102 runs `kidwin ()`. Back in `openkid ()`,
     * `if cutdowns < 4` is `playerdeath = "by kid"` — so four of the five have
     * to land, and `D4E_001` records five.
     */
    let asked = "";
    let landed = 0;
    for (let round = 0; round < 5; round++) {
      asked = await answer(p, 101, `the Kid, round ${round + 1}`, asked);
      landed = Math.max(landed, number("cutdowns"));
    }

    /*
     * `kiddie.mov` is a PUZZLE film of the `getcards.mov` kind, and it starts
     * the moment the conversation ends — so this loop is also what watches the
     * conversation's last line land.
     *
     * 89 frames in three stretches, and every frame of a stretch offers the same
     * two regions: a small box that jumps to the next stretch (frames 10-19 →
     * 20, 21-31 → 32, 38-48 → 49) and the whole picture behind it, which does
     * not. Frames 19, 31 and 48 are `action 3` and end the film where it stands,
     * and the action frame is 80, reachable only through all three boxes. Miss
     * one and `if actionframe (1) = false` is `playerdeath = "by kid"` — which is
     * `kidwin.mov`, `dies3.mov` and the death flat, measured.
     *
     * Unlike `safebox.mov` its frames do not WAIT: they run on at 89 frames of
     * their own accord with the regions live, so nothing here can pause and
     * think. The poll is one tick wide for that reason.
     */
    for (let i = 0; i < 8000 && number("clock") !== 3; i++) {
      landed = Math.max(landed, number("cutdowns"));
      const regions = p.v().movieRegions;
      if (regions.length) {
        // the small box is the way on; the big one behind it is the whole
        // picture, and taking it is walking into the Kid's bullet
        const box = regions
          .slice()
          .sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0))[0];
        p.fire(Math.round((box.x0 + box.x1) / 2), Math.round((box.y0 + box.y1) / 2));
      }
      await p.tick(1);
    }
    /*
     * Counted as they land, because `openkid ()` destroys the tally the moment
     * the conversation is over: `dumpglobal cutdowns` sits between the test and
     * the film. See the note on `cutdowns` under "not claimed".
     */
    if (landed < 4) throw new Error(`only ${landed} cutdowns landed — the Kid takes four`);
    if (number("clock") !== 3) throw new Error("the day never turned — kiddie.mov was not played out");
    if (global("playerdeath") !== "") throw new Error(`the Kid won: playerdeath = "${global("playerdeath")}"`);

    // ---- 6. night ---------------------------------------------------------
    await p.pump(() => room(p).startsWith("nite"), "the night town");
    await p.settle("the day turning");
    // `INVEN.PRP/0001 initprops ()`, run by `initall ()`, is `if day = 4 ... if
    // clock > 2 addinven ("blade")` — the save's only TAKE
    if (owner("blade") !== "stranger") throw new Error(`the Blade is "${owner("blade")}", not ours`);
  },
};
