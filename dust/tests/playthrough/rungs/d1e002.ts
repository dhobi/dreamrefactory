import { ask, clickActor, openDoor, room, set, walkTo, type Segment } from "../route";

/**
 * Day 1, night: a word with Leroy, and into the Hard Drive.
 *
 * The first rung of the thread. `D1E_001` is the disc's earliest evening save —
 * `day = 1`, `clock = 3`, `phase = 2` — and at `clock = 3` the town is
 * **`nite.set`, not `town.set`**: `NEW.FLT/0001 gototown ()` is
 * `if clock = 3 → gotospecial ("nite.set", townscene, dirname)`. Same grid, its
 * own scene scripts, and every cell cited below is a `NITE.SET` container.
 *
 *   1. The save is taken standing at `NITE` **Scene K11** (10,10) facing south,
 *      and `NITE.SET`'s star table puts `town.leroy2` at (2656,2720) — the same
 *      cell. So the rung opens where Leroy is, and the first thing it does is
 *      click him.
 *
 *      `LEROY.PUP/0088 runyoself ()` on day 1 tests position before it tests
 *      anything the player has said:
 *
 *          if actorxyz ("leroy", 1) > 2432
 *              if leroyphase = 88 → brushoff () ; exitcode
 *              puppetspeak ("leroy.10")
 *              leroyphase = 88
 *
 *      2656 > 2432, so **`leroyphase 1 → 88` is where he has wandered to, not
 *      what he was asked.** He does not wander out of it either:
 *      `GANG.CST/0002 leroyidle ()` only turns him to face the camera and
 *      `walkout ()` is armed solely at `town.leroy1`, so the test holds.
 *
 *      The whole exchange is one `puppetspeak` and no plaques, so
 *      "a conversation is open" is not a usable outcome — `clickActor` is given
 *      the phase itself as its `until`.
 *
 *      **Once, exactly.** Both `LEROY.PUP/0088 brushoff ()` and
 *      `JONES.PUP/0067 brushoff ()` walk the shared `counter` global, and
 *      `counter` is 1 in `D1E_001` and still 1 in `D1E_002`. A second click on
 *      Leroy, or any click on Jones — who is already `jonesphase = 1`, so his
 *      `runyoself ()` goes straight to `brushoff ()` — would move it. So the
 *      route talks to Leroy once and to nobody else. Nothing accosts it on the
 *      way: `GANG.CST/0267 jonesidle ()` arms `hasattention` only at
 *      `jonesphase = 0`, `GANG.CST/0111 helpidle ()` only at `helpphase < 3`
 *      (it is 3), and `GANG.CST/0670 trotteridle ()` only on day 3.
 *
 *   2. Then west along the street to `NITE` **Scene G8** (6,7), the saloon's
 *      standpoint, facing west. That walk is what moves `loopsound`.
 *      `NITE.SET/0001 openset ()` hangs `makeloop ("scene", "scene g14",
 *      "nightfxs", 2)` — the loop is in `D1E_001`'s own loop table — and
 *      `NITE.SET/0137 nightfxs ()` picks the nearest of a handful of sources
 *      within `256 * 2`:
 *
 *          if day != 1 | phase < 7
 *              dist = calcdist (scenexyz ("scene g8", 4), playerxyz (4))
 *              if dist < mindist → fxsound = "outsidesaloon"
 *
 *      `phase` is 2, so the guard passes, and standing on Scene G8 itself makes
 *      the distance 0. **`loopsound "" → "outsidesaloon"` is a place, not an
 *      act** — which is why the rung waits for it rather than asserting it after
 *      a fixed walk. It survives the door: `NITE.SET/0001 closeset ()` does not
 *      clear it and `SALLOWER.SET/0001 openset ()` does not touch it, which is
 *      how a town sound is still named in a save taken inside the saloon.
 *
 *   3. The saloon door is `NITE.SET/0131` — `mousedown` inside `pointinsaloon`
 *      (241,92–307,201) facing west does `sendtoprop ("door", setupprop
 *      ("saloon"))`, and it is not locked: `locksaloon ()` refuses only at
 *      `clock = 1`, at `day = 1 & phase >= 7`, or during the fight. Then
 *      `keydown "uparrow"` gated on `propowner ("door") = "saloon"`:
 *
 *          saloonphase = saloonphase + 1
 *          if saloonphase > 2 → saloonphase = 0
 *          sendtostage (gotointerior ("sallower.set"))
 *
 *      That single handler is the whole of three claims. **`saloonphase 0 → 1`**
 *      is its counter — `SALLOWER.SET/0001 openset ()` reads it back to choose
 *      between `saloon1.snd`, `saloon2.snd` and `saloon3.snd`, so it is which
 *      tune the piano is on. **`townscene "scene g5" → "Scene G8"`** is
 *      `NEW.FLT/0001 gotointerior ()`, which stores `currentscene ()` on the way
 *      out of the town and is the only writer of it here; the capital S is the
 *      set file's own spelling of the cell. And **`theset "town" → "sallower"`**
 *      is the move itself.
 *
 *      Jones is why the door is opened with `openDoor` and not with a bare
 *      click. `GANG.CST/0267 jonesidle ()` drifts him between `town.jones1` at
 *      (1624,1872) — which is Scene G8, the cell the door is opened from — and
 *      `town.jones2`, and `D1E_002`'s walk table catches him mid-stride towards
 *      `town.jones1`. A character standing in the doorway is answered by the hit
 *      test before the scene is, so a click at the middle of the rectangle opens
 *      his file instead of the door, silently. `openDoor` asks the engine which
 *      part of the rectangle is still the SCENE and aims there.
 *
 *   4. Inside, west and south to `SALLOWER` **Scene C4** (2,3) facing west, and
 *      stop. That is where `D1E_002` is saved, and it is not an idle spot:
 *      `HOUSE.PRP/0498 mousedown` on the blackjack table is `if realdist (me) <
 *      500 → sendtoscene ("scene b4", runblackjack ())`, the table's star
 *      `blackjack` is at (384,1152), and the centre of C4 is (640,896) — 362
 *      away. The save is taken sitting down to a hand. `rungs/d2a006.ts` ends on
 *      the same cell facing the same way for the same reason.
 *
 *   5. And wait for Isao's lean. `GANG.CST/0984 isaoidle ()` is a two-tick loop
 *      — it is in `D1E_002`'s own loop table with a period of 2 — that flips
 *      `bouncer` between "stand" and "up" on every call and swings `actordeg`
 *      by ±2 inside a ±20° sweep around 64°, turning at the ends via `dirgo`.
 *      So **`bouncer 0 → 1`** is a phase of a loop that runs whatever the player
 *      does, not an outcome of anything the route did, and the only way to land
 *      on it is to wait for it to come round — which is why this is the one step
 *      of the rung that is a wait rather than a move, the same shape the close of
 *      `rungs/d2a006.ts` has.
 *
 *      It is waited for **one step short**, and the reason is worth writing
 *      down. Everything in the predicate — `bouncer`, `dirgo`, `actordeg` —
 *      changes only when the loop fires, so the pump can only come back on the
 *      tick a fire happened, and the next fire is two ticks later. The runner
 *      then closes with `p.settle`, whose three ticks cover exactly one of them
 *      (`playthrough.ts`, `harness.ts`). So the segment leaves `bouncer` at 0
 *      and that last fire is what makes it the 1 the save holds. `dirgo = 0`
 *      with `actordeg <= 76` is the margin on the other half: the same fire adds
 *      2°, which is nowhere near the 84° where the sweep turns.
 *
 * **The money and the cards are not claimed.** `playercash 5 → 400`,
 * `cardstring`, `playerdowncard`, `dealerdowncard`, `usedcount`, `threecount`,
 * `fourcount` and `fivecount` are all the blackjack table, and they are excluded
 * for exactly the reason `rungs/d2a006.ts` sets out at length for the same set
 * of globals: `cardstring` is one particular 52-card shuffle and
 * `SALGAMES.FLT/0008` deals off it by index, so none of it follows from a route
 * — it follows from a deck this port does not shuffle the same way. The rung
 * plays up to the moment the original sat down and stops there, which is also
 * why it must not walk back OUT of the saloon: `SALLOWER.SET/0052 keydown` is
 * `if day = 1 & phase < 3 & playercash > 5 → phase = 3`, and the winnings are
 * what arms it.
 *
 * `dealerbj`, `dealercount`, `dealerstand`, `dealertotal`, `playerbj`,
 * `playerstand` and `playertotal` are in `D1E_002` at 0 and absent from
 * `D1E_001` altogether. They are not a state anything reached — they are names
 * brought into existence by the `global` lines of the blackjack handlers, and
 * they are 0 because that is what a Dust global is before anything writes it. A
 * rung that does not open the mini-game does not create them, so they are not
 * claimed. `fightphase` is the same thing one cell away: `NITE.SET/0128
 * openscene ()` — Scene G5, the hotel door, and the cell `townscene` still names
 * when the rung starts — opens `global day, phase, lockevents, clock,
 * fightphase`, and the route west to the saloon has no reason to stand on it.
 */
export const rung: Segment = {
  from: "D1E_001",
  to: "D1E_002",
  what: "a word with Leroy, and into the Hard Drive",
  claims: ["leroyphase", "loopsound", "saloonphase", "townscene", "theset", "bouncer"],
  async play(p) {
    const nite = set("NITE");
    const sal = set("SALLOWER");
    const num = (n: string): number => Number(p.session.interp.globals.get(n) ?? 0);
    const str = (n: string): string => String(p.session.interp.globals.get(n) ?? "").toLowerCase();

    // ---- 1. Leroy, who is standing where the save begins -------------------
    await clickActor(
      p, "leroy", "Leroy out by the shooting range", 40,
      () => num("leroyphase") === 88,
    );
    if (num("counter") !== 1) throw new Error(`counter is ${num("counter")} — somebody was brushed off`);

    // ---- 2. west to the saloon's standpoint, which is what names the sound --
    await walkTo(p, nite, { x: 6, z: 7, view: "west" });
    await p.pump(() => str("loopsound") === "outsidesaloon", "the saloon to be the nearest sound");

    // ---- 3. in through the saloon door -------------------------------------
    await openDoor(p, [241, 92, 307, 201], "saloon", "the saloon door", {
      set: nite, x: 6, z: 7, view: "west",
    });
    await p.pump(() => room(p).startsWith("sallower"), "the bar");
    if (num("saloonphase") !== 1) throw new Error(`saloonphase is ${num("saloonphase")}`);
    if (str("townscene") !== "scene g8") throw new Error(`townscene is "${str("townscene")}"`);

    // ---- 4. and sit down to the blackjack table ----------------------------
    await walkTo(p, sal, { x: 2, z: 3, view: "west" });

    // ---- 5. with Isao's lean one step short of where the save caught it ----
    await p.pump(
      () =>
        num("bouncer") === 0 && num("dirgo") === 0 && Number(ask(p, "actordeg", ["isao"])) <= 76,
      "Isao's lean to come round to where the save caught it",
    );
  },
};
