import { ask, room, set, walkTo, type Segment } from "../route";

/**
 * Day 4, underground: set the sundial to the flute and walk into the dark.
 *
 * Three minutes of play and two globals, and the two globals are the whole
 * rung: `blackout -1 → 0` and `smalldial 0 → 8`. The dials read 0 / 0 / 8 at
 * the other end, which `SUNDIAL.FLT/0001 exitsundial ()` says is the flute
 * room, and the standpoint agrees — `FLUTEPZL` is `flute.set` (1,3). Nothing is
 * picked up, nobody is spoken to, and the flute is not played until the next
 * rung. This is the combination lock and the lift down.
 *
 *  1. **The sundial is a rectangle in the middle of the hub.** `HUB.SET` is a
 *     7x7 grid with the dial at its centre, and four cells look at it — C4
 *     (2,3) facing east, D3 (3,2) facing south, D5 (3,4) facing north and E4
 *     (4,3) facing west, scripts `0051`, `0057`, `0059` and `0065`. Each is the
 *     same handler: `mousedown` → `if currentview () = "<its view>" / if
 *     pointinsundial (arg) / dosundial ()`, and `pointinsundial (arg)` is
 *     `phase > 2 → false` and then the rectangle 142,142–372,190. `phase` is 0.
 *     `dosundial ()` pauses every loop in the set, fades it out and swaps the
 *     stage for `sundial.flt` with `sundial.prp` behind it. `D4MINES` stands on
 *     Scene D7 (3,6) facing north, which is two cells south of D5.
 *  2. **All three dials start at 0, so only the small one moves.**
 *     `SUNDIAL.PRP/0001 initprops ()` puts `largedial`, `meddial` and
 *     `smalldial` at 256,132 and sets each one's `propdeg` from the global of
 *     the same name. `D4MINES` carries none of the three — the save has no
 *     `largedial`, `meddial` or `smalldial` at all, because nothing had opened
 *     the sundial yet on this descent — so all three come up 0, and `FLUTEPZL`
 *     wants 0, 0, 8.
 *  3. **A dial is a drag, and it is the SHOP MAIN that answers it.**
 *     `SUNDIAL.PRP/0001 mousedown` is a `while stilldown ()` poll: it reads
 *     `mouse ()` every pass, turns `target` by `limiter (orig, newd)`, and on
 *     release writes all three `propdeg`s back into the globals. The three dial
 *     groups have no script of their own — `sundial.prp` names containers 2, 21
 *     and 40 for them and all three are empty 8-byte stubs with no handler in
 *     them, which is why they are absent from `session.propScripts` and
 *     `clickProp` cannot reach them. The director's prop chain is what does:
 *     prop script first, then the owning
 *     shop's main with `target` set to the prop that was hit
 *     (`web/screen-director.ts` `clickProp`). So the gesture is a click
 *     DISPATCHED on a point that really is the small dial, with
 *     `session.pointerDown` held so that `stilldown ()` answers — a fired click
 *     alone spins the poll for ever, and a held pointer alone is never
 *     dispatched.
 *  4. **What one stroke is worth, and why it takes two.** `orig` and `newd` are
 *     `fixdeg256 (calcdeg (propxy (target, 3), arg) + 64)`, an angle about the
 *     dial's centre folded into the 0..15 the dial is numbered in, and
 *     `limiter` moves the prop by ONE step per pass in the direction `newd`
 *     moved — there is no ratchet here, unlike the bank safe's `CRACK.PRP`, so
 *     the dial follows the wrist both ways. But `propxy (name, 3)` answers
 *     `anchorX` rather than the packed screen point the script is asking for
 *     (`engine/src/runtime/builtins/props.ts` handles axes 1 and 2 only, the
 *     way `propxyz (…, 4)` packs a pair) — the same gap `rungs/d3e004.ts` works
 *     around on the safe. Here that centre is 256, which unpacks as (0,256), so
 *     the angles the script computes are taken about the bottom-left corner of
 *     the screen and the whole 512x384 spans only NINE of the sixteen values,
 *     0..8. The route therefore asks the engine's own `calcdeg` what value each
 *     screen point produces and steps the pointer through those values one at a
 *     time — never more than one, which is the largest step a pass can turn —
 *     and since a single stroke cannot cross more of the ring than the screen
 *     holds, it presses, sweeps, releases and presses again: 0 → 6 → 8.
 *     The press point is one the engine says is the SMALL dial, so the shop
 *     main's `target` is the dial being turned and not one of the two rings
 *     around it.
 *  5. **Out, which is where the combination is read.** `flatprops.ts` gives
 *     `sundial.flt` exactly one click region, `exit` at 50,311–135,336, and
 *     `SUNDIAL.FLT/0005 mousedown` is `doexit (arg)` → `exitsundial ()`. That
 *     re-reads the three `propdeg`s into the globals and dispatches on them;
 *     the fourth arm is `largedial = 0 & meddial = 0 & smalldial = 8 &
 *     flutepuzzle != "done"` → `nextroom = "flute"`, `gotohub ()`.
 *     `flutepuzzle` is 0. `gotohub ()` only swaps the stage file back to
 *     `new.flt` and un-pauses the loops, so the hub is still open behind it and
 *     the player is still on Scene D5.
 *  6. **The way down is walking into the dark.** Each of the hub's four edge
 *     cells owns one destination: `HUB.SET/0037` is Scene A4 (0,3) and the
 *     snake's, `0055` is Scene D1 (3,0) and the mine's, `0061` is Scene D7
 *     (3,6) and the thunderbird's, and `0079` is Scene G4 (6,3) and the
 *     flute's. All four are the same handler. `if arg = "uparrow" &
 *     currentview () = "east" → gotoblack ()` is the one that fires here, and
 *     `HUB.SET/0001 gotoblack ()` sets `blackout = 3 + random (3)` — and, only
 *     `if nextroom = "hub"`, gives all three dials a fresh `random (16) - 1`.
 *     That is why the combination cannot be set on the way past: leaving for
 *     anywhere but the hub is the only way it survives.
 *  7. **Then the count.** Every press after that is swallowed by the same
 *     scene: `if blackout > 0 → blackout = blackout - 1, stillblack (),
 *     exitcode`. `stillblack ()` has nothing to say here (it wants
 *     `blackout = 1` and either an unowned shaman — the save already owns him
 *     to "message" — or `nextroom = "hub"`). When the count reaches 0 the next
 *     press takes the other branch: `gossipone ("s.5")`,
 *     `gotointerior ("flute.set")`, `nextroom = 0`. Nothing resets `blackout`
 *     on that path, and the 0 it is left holding is the save's
 *     `blackout -1 → 0`. The count is random, so the route presses until the
 *     room changes rather than a fixed number of times.
 *  8. `FLUTE.SET/0001 openset ()` does no more than swap the music and set
 *     `propowner ("flute", "stranger")`, and the set opens on its own default
 *     standpoint, Scene B4 (1,3) facing north — which is where `FLUTEPZL` was
 *     taken.
 *
 * **Not claimed.** Nothing beyond the four below moves. `flutepuzzle`,
 * `minepuzzle`, `snakepuzzle` and `tbirdpuzzle` are 0 at both ends and no
 * script on this path touches them; `phase` stays 0 because `exitsundial ()`'s
 * `phase = 3` arm wants the 12/4/12 combination.
 */
export const rung: Segment = {
  from: "D4MINES",
  to: "FLUTEPZL",
  what: "the sundial set to the flute, and down into the dark",
  claims: ["blackout", "largedial", "meddial", "smalldial", "nextroom"],
  async play(p) {
    const hub = set("HUB");
    const deg = (name: string): number => Number(ask(p, "propdeg", [name]));

    // ---- 1. to the cell that looks at the sundial, and open it -------------
    await walkTo(p, hub, { x: 3, z: 4, view: "north" });
    p.fire((142 + 372) / 2, (142 + 190) / 2); // HUB.SET/0059 pointinsundial
    await p.pump(() => ask(p, "propvisible", ["smalldial"]) === "1", "the sundial");
    await p.settle("the sundial");

    // ---- 2. the ring of pointer positions, in the dial's own numbering -----
    /*
     * Asked of the engine rather than drawn round 256,132, because the centre
     * the script gets is `propxy (target, 3)` and this port answers that with
     * `anchorX` (step 4 above). Whatever it answers, the route has to agree
     * with it — so the same two builtins are asked the same question of every
     * point on a coarse grid, and one point is kept per value.
     */
    const centre = Number(ask(p, "propxy", ["smalldial", 3]));
    const valueAt = (x: number, y: number): number => {
      let deg256 = Number(ask(p, "calcdeg", [centre, Number(ask(p, "makepoint", [x, y]))])) + 64;
      while (deg256 < 0) deg256 += 256;
      while (deg256 > 255) deg256 -= 256;
      return Math.trunc((deg256 * 16) / 256);
    };
    const ring = new Map<number, { x: number; y: number }>();
    /** the points that are the SMALL dial, so the shop main's `target` is it */
    const grip = new Map<number, { x: number; y: number }>();
    for (let y = 0; y < 384; y += 2) {
      for (let x = 0; x < 512; x += 2) {
        const v = valueAt(x, y);
        if (!ring.has(v)) ring.set(v, { x, y });
        if (grip.has(v)) continue;
        const under = p.v().propUnder(x, y);
        if (under && (under.name || under.group.name).toLowerCase() === "smalldial") {
          grip.set(v, { x, y });
        }
      }
    }
    const values = [...ring.keys()].sort((a, b) => a - b);
    const grips = [...grip.keys()].sort((a, b) => a - b);
    if (!grips.length) throw new Error("no point on screen is the small dial");
    const lo = values[0];
    const hi = values[values.length - 1];

    // ---- 3. turn the small dial to 8, one stroke at a time -----------------
    const turnTo = async (name: string, target: number): Promise<void> => {
      for (let stroke = 0; stroke < 12 && deg(name) !== target; stroke++) {
        // the shorter way round the sixteen, and which end of the ring to grip
        const up = (target - deg(name) + 16) % 16 <= 8;
        const from = grip.get(up ? grips[0] : grips[grips.length - 1])!;
        p.session.setPointer(from.x, from.y);
        p.session.pointerDown = true;
        try {
          // dispatched, so `SUNDIAL.PRP`'s mousedown runs; held, so its
          // `while stilldown ()` is answerable
          p.fire(from.x, from.y);
          await p.tick(4);
          const first = up ? grips[0] + 1 : grips[grips.length - 1] - 1;
          for (let v = first; up ? v <= hi : v >= lo; v += up ? 1 : -1) {
            if (deg(name) === target) break;
            const at = ring.get(v);
            if (!at) continue;
            p.session.setPointer(at.x, at.y);
            const was = deg(name);
            for (let w = 0; w < 8 && deg(name) === was; w++) await p.tick(1);
          }
        } finally {
          p.session.pointerDown = false; // the release is what ends the poll
        }
        await p.tick(6);
        await p.settle("the dial");
      }
      if (deg(name) !== target) throw new Error(`${name} stopped on ${deg(name)}, not ${target}`);
    };
    await turnTo("smalldial", 8);
    if (deg("largedial") !== 0 || deg("meddial") !== 0) {
      throw new Error(`the sundial reads ${deg("largedial")}/${deg("meddial")}/${deg("smalldial")}, not 0/0/8`);
    }

    // ---- 4. out, which is where `exitsundial ()` reads the combination -----
    p.fire((50 + 135) / 2, (311 + 336) / 2); // sundial.flt's only region, "exit"
    await p.pump(
      () => String(p.session.interp.globals.get("nextroom") ?? "").toLowerCase() === "flute",
      "the sundial to name the flute room",
    );
    await p.pump(() => ask(p, "currentflat").toLowerCase() === "mainpanel", "the hub back");
    await p.settle("the hub");

    // ---- 5. the flute's own edge cell, and walk into the dark --------------
    await walkTo(p, hub, { x: 6, z: 3, view: "east" }); // HUB.SET/0079, Scene G4
    for (let i = 0; i < 12 && !room(p).startsWith("flute"); i++) {
      await p.press("uparrow", "into the dark");
    }
    if (!room(p).startsWith("flute")) {
      throw new Error(`still in ${room(p)} after the blackout — blackout is ${p.session.interp.globals.get("blackout")}`);
    }
  },
};
