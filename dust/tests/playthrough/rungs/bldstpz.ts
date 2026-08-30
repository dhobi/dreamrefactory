import { ask, converse, room, set, walkTo, type Segment } from "../route";
import type { Pumped } from "../harness";

/**
 * Day 4, underground: the last combination, the chest, and Bloodstone-Hayes.
 *
 * Seventy seconds of play by the frame counter, and almost none of it is
 * walking. `ENDPZL` stands in `hub.set` (2,4) with all four puzzles `"done"`,
 * `phase = 1` and the dials still reading the thunderbird's 12/4/8; `BLDSTPZ`
 * is in `tbird.set` (1,1) facing north with `phase = 5`, `smalldial = 12`, the
 * **Gun gone** and the **Tbird stone back in hand**. Four gestures get from one
 * to the other — a dial, an exit, a chest and two answers — and `frame ()` does
 * not advance while a puppet file is open, which is why `phase 1 → 5` fits in
 * seventy seconds.
 *
 *  1. **The sundial, one dial.** `HUB.SET` is a 7x7 grid with the dial at its
 *     centre and four cells looking at it — C4 (2,3) east, D3 (3,2) south, D5
 *     (3,4) north and E4 (4,3) west, scripts `0051`, `0057`, `0059` and `0065`.
 *     Each `mousedown` is `if currentview () = "<its view>" & pointinsundial
 *     (arg) → dosundial ()`, and `pointinsundial` is `phase > 2 → false` then
 *     the rectangle 142,142–372,190. `phase` is 1, so it is still open.
 *     `SUNDIAL.PRP/0001 initprops ()` sets each dial's `propdeg` from the
 *     global of the same name, so the flat comes up on 12/4/8 and only the
 *     small dial has to move — 8 → 12.
 *  2. **A dial is a drag the SHOP MAIN answers.** `SUNDIAL.PRP/0001 mousedown`
 *     is a `while stilldown ()` poll that turns `target` by `limiter (orig,
 *     newd)` — one step per pass, either way — and writes all three `propdeg`s
 *     back into the globals only on release. The three dial groups have no
 *     script of their own, so the gesture is a click DISPATCHED on a point the
 *     engine says is the small dial, with `session.pointerDown` held. Where to
 *     carry the pointer is asked of the engine's own `calcdeg`, because
 *     `propxy (name, 3)` answers `anchorX` rather than the packed screen point
 *     the script wants (`engine/src/runtime/builtins/props.ts` handles axes 1
 *     and 2 only) — the gap `rungs/flutepzl.ts` and `rungs/d3e004.ts` already
 *     work around on this dial and on the bank safe. This rung asks the same
 *     way and steps through the values one at a time, which is the largest step
 *     a pass can turn.
 *  3. **Out is where the combination is read, and this one is not a room.**
 *     `flatprops.ts` gives `sundial.flt` one region, `exit` at 50,311–135,336,
 *     and `SUNDIAL.FLT/0005 mousedown` is `doexit (arg)` → `exitsundial ()`.
 *     Its first four arms are the four puzzle rooms and every one of them is
 *     guarded on `!= "done"`, so with all four done none of them fires. The
 *     fifth is the one this rung is about:
 *
 *         if phase = 1 | phase = 2
 *             if largedial = 12 & meddial = 4 & smalldial = 12
 *                 phase = 3
 *                 sendtoactor ("shaman", putdownactor ())
 *                 sendtoprop ("chest", setupprop ("hub"))
 *                 playmovie ("chestapp.mov")
 *
 *     — and then `nextroom = "hub"`, `gotohub ()`. So 12/4/12 does not take you
 *     anywhere: it puts the shaman away and stands a chest in the middle of the
 *     hub. That is the save's `nextroom "" → "hub"`, its `chest` prop arriving
 *     in set `hub` at 896,896,130, and its shaman going invisible.
 *  4. **The chest is Bloodstone.** `INVEN.PRP/0428 mousedown` is `if phase = 3
 *     & propview (me) = "small" → bloodcode ()`, and `bloodcode ()` is a camera
 *     move: `phase = 4`, `currentscene ("scene e4") / currentview ("west")` —
 *     E4 (4,3), looking back at the chest — then `setupactor ("blood", "hub")`,
 *     which stands him on `HUB.SET`'s `blood` star at 1308,944, just off E4's
 *     east side. Two `currentscene ("right")`s pan west → north → east and
 *     there he is, and `sendtocast ("gang", runpuppet ("blood.pup"))` opens him
 *     with `puppetbase ("blood.156")`.
 *  5. **He takes the gun before he says anything worth answering.**
 *     `BLOOD.PUP/0069 runyoself ()` sends `hub ()` because `actorset ("blood")`
 *     is now "hub", and its third line is `sendtoshop ("inven", dumpinven
 *     ("gun"))`. That is the save's **GIVE Gun** — `Gun` owner `stranger` →
 *     `none` — and it is not a gesture the player makes or can refuse. Then two
 *     plaques, both **101** ("How'd you get in here?" and "You're evil,
 *     Bloodstone."), each wrapped in `puppetparam (8, 1)`, and twelve
 *     `puppetspeak`s between them. Answering by id rather than walking out is
 *     the point: the `case -1` arms are empty, so a dismissal skips his speech
 *     and reaches the same end.
 *  6. **And then he moves the room out from under you.** After the second
 *     answer `hub ()` sets `phase = 5`, closes the set file, opens `tbird.set`
 *     on `scene b2` facing south, speaks twice more, and does `sendtoshop
 *     ("inven", addinven ("tbird"))` and `setupactor ("blood", "tbird")`. That
 *     is the save's `theset "hub" → "tbird"` (written by `GANG.CST/0001
 *     stdactor ()`), its `handitem "Yunnibook" → "tbird"`, its **TAKE Tbird**
 *     — `Tbird` owner `temple` → `stranger`, which `TBIRD.SET/0001 openset ()`
 *     would have done in any case — and Blood standing on `blood.1` at 292,648
 *     in pose `gun`, which is exactly where `BLDSTPZ` has him.
 *  7. **The last press is turning round.** `hub ()` leaves the player on B2
 *     (1,1) facing SOUTH, at Bloodstone; the save is facing NORTH, at the
 *     podium. `TBIRD.SET/0039` is that cell, and its two halves are the two
 *     things B2 can do: `keydown` → `uparrow` facing south at `phase = 5` hands
 *     the press to Blood, and `mousedown` → `pointinpodium` facing north opens
 *     `tumble.flt`. The next rung is the podium, so the original turned to face
 *     it and saved. Two turns, and no press that could be mistaken for either.
 *
 * **Not claimed.** `idlecount` goes 2 → 1 and `curattention` and `seldir` are
 * rewritten with the values they already had — `GANG.CST`'s own bookkeeping,
 * not this rung's. `blackout` is -1 at both ends and stays there: only
 * `HUB.SET/0001 gotoblack ()` moves it and nothing here walks into an edge
 * cell, which is also why the dials survive the trip (`gotoblack ()` re-rolls
 * all three when `nextroom = "hub"`). The Gun and the Tbird stone are props
 * rather than globals so the harness cannot check them; the route asserts both
 * owners itself.
 *
 * **`clickProp ()` cannot open this chest, and the reason is worth writing
 * down.** It dispatches the prop's `mousedown` straight at the interpreter, and
 * `currentscene ()` / `currentview ()` as SETTERS only do anything while a
 * gesture's nav hooks are armed — `SetViewer.armNavHooks ()` puts them on the
 * session for the duration of a keydown or a click and `disarmNavHooks ()`
 * takes them off again, so that arrival scripts calling `currentscene ()` stay
 * inert. Sent by hand, `bloodcode ()`'s `currentscene ("scene e4")` and
 * `currentview ("west")` are no-ops; the camera stays where it was, and the
 * handler then hangs for ever in `while currentview () != "east" forceupdate ()
 * endwhile`. Measured: `phase` reached 4, `actorset ("blood")` reached "hub",
 * and the standpoint never left Scene D5. Two smaller reasons besides —
 * `clickProp` has no `until`, so a second press would find `phase = 4` and fall
 * through to `stdmouse ()`, and it `settle ()`s after each one, which cannot
 * end on a press that opens a conversation (that settle ran out its 40,000
 * steps). None of this is fixed here; the route clicks the sprite instead,
 * which is what a player does.
 *
 * **Calibrated against current behaviour.** `BLDSTPZ` records `blood.pup` as
 * the OPEN puppet and a voice still playing, so the original save was taken
 * with his file still up. This rung waits for the puppet to close before
 * turning, because a key pressed into an open puppet is not a turn; nothing in
 * the harness checks the puppet, and the standpoint is the same either way.
 */
export const rung: Segment = {
  from: "ENDPZL",
  to: "BLDSTPZ",
  what: "the sundial to 12/4/12, the chest, and Bloodstone takes the gun",
  claims: ["phase", "handitem", "theset", "nextroom", "largedial", "meddial", "smalldial"],
  async play(p) {
    const hub = set("HUB");
    const tbird = set("TBIRD");
    const num = (name: string): number => Number(p.session.interp.globals.get(name) ?? 0);
    const str = (name: string): string => String(p.session.interp.globals.get(name) ?? "").toLowerCase();
    const deg = (name: string): number => Number(ask(p, "propdeg", [name]));
    const owner = (name: string): string => ask(p, "propowner", [name]).toLowerCase();

    // ---- 1. the cell that looks at the sundial, and open it ----------------
    await walkTo(p, hub, { x: 3, z: 4, view: "north" }); // HUB.SET/0059, Scene D5
    p.fire((142 + 372) / 2, (142 + 190) / 2); // pointinsundial, 142,142-372,190
    await p.pump(() => ask(p, "propvisible", ["smalldial"]) === "1", "the sundial");
    await p.settle("the sundial");
    if (deg("largedial") !== 12 || deg("meddial") !== 4 || deg("smalldial") !== 8) {
      throw new Error(
        `the sundial came up ${deg("largedial")}/${deg("meddial")}/${deg("smalldial")}, not 12/4/8`,
      );
    }

    // ---- 2. the small dial, 8 -> 12 ----------------------------------------
    await turnTo(p, "smalldial", 12);
    if (deg("largedial") !== 12 || deg("meddial") !== 4 || deg("smalldial") !== 12) {
      throw new Error(
        `the sundial reads ${deg("largedial")}/${deg("meddial")}/${deg("smalldial")}, not 12/4/12`,
      );
    }

    // ---- 3. out, which raises the chest instead of opening a room ----------
    p.fire((50 + 135) / 2, (311 + 336) / 2); // sundial.flt's only region, "exit"
    await p.pump(() => num("phase") === 3, "exitsundial () to put the shaman away", 80_000);
    await p.pump(() => ask(p, "currentflat").toLowerCase() === "mainpanel", "the hub back", 80_000);
    await p.settle("chestapp.mov");
    if (str("nextroom") !== "hub") throw new Error(`nextroom is "${str("nextroom")}", not "hub"`);
    if (ask(p, "propvisible", ["chest"]) !== "1" || ask(p, "propset", ["chest"]).toLowerCase() !== "hub") {
      throw new Error(`no chest in the hub — visible ${ask(p, "propvisible", ["chest"])}, set "${ask(p, "propset", ["chest"])}"`);
    }

    // ---- 4. the chest, on the screen and once only -------------------------
    /*
     * Fired at the sprite rather than sent to the script, and that is not a
     * stylistic choice — see the note on `clickProp ()` above. The point is
     * asked of the engine, the way `dragTo ()` asks where the panel drew a
     * prop: the chest is a 3D prop standing in the middle of the hub and has no
     * rectangle written down anywhere.
     */
    let hit: { x: number; y: number } | null = null;
    for (let y = 0; y < 384 && !hit; y += 2) {
      for (let x = 0; x < 512 && !hit; x += 2) {
        const under = p.v().propUnder(x, y);
        if (under && (under.name || under.group.name).toLowerCase() === "chest") hit = { x, y };
      }
    }
    if (!hit) throw new Error("the chest is in the set but not on the screen");
    p.fire(hit.x, hit.y);
    await p.pump(() => num("phase") >= 4, "the chest to fetch Bloodstone", 80_000);
    await p.pump(
      () => p.session.currentSceneName()?.toLowerCase() === "scene e4",
      "bloodcode () to walk the camera round to E4",
      80_000,
    );

    // ---- 5. his two questions, and the gun he takes without asking ---------
    const held = (): string => String(p.session.interp.globals.get("handitem") ?? "").toLowerCase();
    await converse(p, null, 101, () => held() === "tbird", "Bloodstone under the hub");
    await p.pump(() => !p.session.puppet, "Bloodstone to finish", 80_000);
    /*
     * ...and let the clicks that carried his speech land before turning.
     * `converse ()` nudges with a FIRED click, which is not awaited, so the
     * last of them is still in the director's queue when the puppet closes.
     * Turned on top of that queue, the two presses to north came back as three:
     * the segment returned reading `scene b2 · north`, the next tick read
     * "moving", and the one after that read west — `facing: expected 'west' to
     * be 'north'`. Settling first drains the queue while we are still facing
     * Bloodstone, where a stray click reaches nothing (`TBIRD.SET/0039`'s
     * `mousedown` wants `currentview () = "north"`).
     */
    await p.settle("Bloodstone's last word");
    if (owner("Gun") !== "none") throw new Error(`Bloodstone did not take the gun — it is "${owner("Gun")}"`);
    if (owner("Tbird") !== "stranger") throw new Error(`the Tbird stone is "${owner("Tbird")}", not back in hand`);
    if (num("phase") !== 5) throw new Error(`phase is ${num("phase")}, not 5`);
    if (!room(p).startsWith("tbird")) throw new Error(`still in ${room(p)}, not the thunderbird room`);

    // ---- 6. round to face the podium ---------------------------------------
    await walkTo(p, tbird, { x: 1, z: 1, view: "north" }); // TBIRD.SET/0039, Scene B2
  },
};

/**
 * Turn one of the sundial's three dials to a value, a stroke at a time.
 *
 * `SUNDIAL.PRP/0001 mousedown` is a poll — `while stilldown () … arg = mouse ()`
 * — so the press has to be DISPATCHED (which is what puts the dial's name in
 * `target`, since the three groups have no script of their own and the shop
 * main dispatches on it) and the button genuinely held, or the loop spins for
 * ever. `limiter ()` moves the prop ONE step per pass in the direction the
 * pointer's angle moved, so the pointer is stepped through the ring one value
 * at a time and never more.
 *
 * The ring is asked of the engine rather than drawn round 256,132: the centre
 * the script gets is `propxy (target, 3)`, which this port answers with
 * `anchorX`, so the angles are taken about a point that is not the dial and the
 * whole screen spans only part of the sixteen. Asking `calcdeg` what each
 * screen point is worth agrees with the script whatever it answers — the same
 * stand-in `rungs/flutepzl.ts` uses on this flat.
 */
async function turnTo(p: Pumped, name: string, target: number): Promise<void> {
  const deg = (): number => Number(ask(p, "propdeg", [name]));
  const centre = Number(ask(p, "propxy", [name, 3]));
  /** the handler's own `fixdeg256 (calcdeg (propxy (target, 3), arg) + 64)` */
  const valueAt = (x: number, y: number): number => {
    let deg256 = Number(ask(p, "calcdeg", [centre, Number(ask(p, "makepoint", [x, y]))])) + 64;
    while (deg256 < 0) deg256 += 256;
    while (deg256 > 255) deg256 -= 256;
    return Math.trunc((deg256 * 16) / 256);
  };
  /** one screen point per value of the ring, and one that is really this dial */
  const ring = new Map<number, { x: number; y: number }>();
  const grip = new Map<number, { x: number; y: number }>();
  for (let y = 0; y < 384; y += 2) {
    for (let x = 0; x < 512; x += 2) {
      const v = valueAt(x, y);
      if (!ring.has(v)) ring.set(v, { x, y });
      if (grip.has(v)) continue;
      const under = p.v().propUnder(x, y);
      if (under && (under.name || under.group.name).toLowerCase() === name) grip.set(v, { x, y });
    }
  }
  const values = [...ring.keys()].sort((a, b) => a - b);
  const grips = [...grip.keys()].sort((a, b) => a - b);
  if (!grips.length) throw new Error(`no point on screen is the ${name}`);
  const lo = values[0];
  const hi = values[values.length - 1];

  for (let stroke = 0; stroke < 12 && deg() !== target; stroke++) {
    // the shorter way round the sixteen, and which end of the ring to grip
    const up = (target - deg() + 16) % 16 <= 8;
    const from = grip.get(up ? grips[0] : grips[grips.length - 1])!;
    p.session.setPointer(from.x, from.y);
    p.session.pointerDown = true;
    try {
      p.fire(from.x, from.y); // dispatched, so the shop main's `target` is this dial
      await p.tick(4);
      const first = up ? grips[0] + 1 : grips[grips.length - 1] - 1;
      for (let v = first; up ? v <= hi : v >= lo; v += up ? 1 : -1) {
        if (deg() === target) break;
        const at = ring.get(v);
        if (!at) continue;
        p.session.setPointer(at.x, at.y);
        const was = deg();
        for (let w = 0; w < 8 && deg() === was; w++) await p.tick(1);
      }
    } finally {
      p.session.pointerDown = false; // the release is what ends the poll
    }
    await p.tick(6);
    await p.settle("the dial");
  }
  if (deg() !== target) throw new Error(`${name} stopped on ${deg()}, not ${target}`);
}
