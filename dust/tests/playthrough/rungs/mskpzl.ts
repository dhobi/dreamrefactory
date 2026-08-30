import { ask, room, set, walkTo, type Segment } from "../route";
import type { Pumped } from "../harness";

/** the seven rings of the hex lock, in the order `SNAKE.PRP` names them */
const STOPS = ["stop1", "stop2", "stop3", "stop4", "stop5", "stop6", "stop7"];

/**
 * Day 4, underground: the hex lock in the snake room, and back to the sundial.
 *
 * Nine and a half minutes of play and three globals, and one puzzle is all of
 * it. `DAGRPZL` stands in `snake.set` (1,3) — the flute has just been given to
 * the temple and the sundial was dialled 8/12/4 for the snake — and `MSKPZL` is
 * back in `hub.set` (3,4) with `snakepuzzle = "done"`, `blackout = -1` and the
 * **Blade owned by "snake"**. The dials are untouched at both ends, so the
 * return trip stops at the sundial rather than going through it.
 *
 *  1. **The lock is a button on one wall.** `SNAKE.SET` is a 3x4 grid; the save
 *     opens on Scene B4 (1,3), whose script `0041` is the way out — `uparrow`
 *     facing south → `gotohub ()`. One cell north is Scene B3 (1,2), script
 *     `0040`, and its `mousedown` is `if currentview () = "south" &
 *     pointinhexbut (arg) → dohexpuz ()`, with `pointinhexbut` the rectangle
 *     335,150–365,175. So the route walks one cell and turns to face back the
 *     way it came. `dohexpuz ()` pauses every loop, fades the set out, plays
 *     `hexopen.mov` and swaps the stage for `snake.flt` with `snake.prp` behind
 *     it, then sends that shop `initprops ()` and `mangle ()`.
 *  2. **Seven rings, and turning one turns them all.** `SNAKE.PRP/0001` lays
 *     `stop1`..`stop6` out as a hexagon around `stop7`, and each `propdeg` is a
 *     0..35 wheel that only ever sits on a multiple of 6. `mousedown` is a
 *     `while stilldown ()` drag: it takes the bearing of the press about the
 *     ring's centre, follows the pointer, and `limiter ()` clamps the result to
 *     ONE notch either way — `start ± 6` — before snapping it to the six. Then
 *     `spinall (calcspin (start, deg))` turns every OTHER ring by the same sign,
 *     by an amount that depends only on how far away it is:
 *
 *         dist = calcdist (propxy (name, 3), propxy (target, 3))
 *         > 50 & < 100   → one notch      (the six neighbours, and the centre)
 *         > 100 & < 150  → two notches    (two round the hexagon)
 *         > 150          → three notches  (opposite)
 *
 *     Those three bands are the proof that the hexagon is what they describe:
 *     measured on the screen positions `initprops ()` writes, adjacent centres
 *     are 84–87 apart, two-apart are 146–149 and opposite are 170–172. So a
 *     turn is a vector over the seven rings, every move commutes, and the whole
 *     thing is linear in Z6. `solved ()` wants all seven on 0.
 *  3. **It is solvable because it was scrambled by playing it.** `mangle ()` is
 *     twenty rounds of `spizall ("stop" @ random (7), random (3) - 2)`, and
 *     `spizall ()` applies exactly the pattern a player's drag applies. The
 *     scramble is therefore inside the group the moves generate, and a search
 *     over the 6^7 combinations of "how many notches each ring is turned" always
 *     finds one. The route reads the seven `propdeg`s, asks the engine the same
 *     `calcdist` question `spinall ()` asks to build the same coupling, solves,
 *     and turns. It re-reads and re-solves rather than trusting the first
 *     answer, and refuses to press the quit button until all seven read 0.
 *  4. **Out is the quit button, and the gift comes with it.** `flatprops.ts`
 *     gives `snake.flt` one region, `quit` at 389,178–438,226; `SNAKE.FLT/0005
 *     mousedown` shows the `hexbut` prop and calls `gotosnake ()`.
 *     `SNAKE.FLT/0001 gotosnake ()` asks `sendtoshopfx ("puzzle", solved ())`
 *     and, on true, sets `snakepuzzle = "done"`, plays `snake.mov`, and does
 *     `sendtoshop ("inven", giveinven ("blade", "snake"))` — that is the save's
 *     **GIVE Blade (to snake)**, and it is not a gesture the player makes. Then
 *     `sendtoset (gotohub ())` closes the room and opens `hub.set` on its own
 *     default standpoint, Scene D7 (3,6), which is where the hub always opens
 *     from a puzzle room and where the last rung's `FLUTEPZL` left from.
 *  5. **The dark, and the count.** `HUB.SET/0001 openset ()` sets
 *     `blackout = 3 + random (3)`, and Scene D7's script `0061` eats every
 *     press while it is positive: `blackout = blackout - 1`, `stillblack ()`.
 *     When it reaches 0 the next press takes the other branch — `nextroom` is 0
 *     rather than "tbird", so it turns you north, runs `comefromblack ()`, and
 *     that is the save's `blackout = -1`. The count is random, so the route
 *     presses until the global says the lights are on rather than a fixed
 *     number of times.
 *  6. **Then two cells north to the sundial.** Scene D5 (3,4) faces the dial
 *     across the middle of the 7x7 grid — `HUB.SET/0059` is the cell whose
 *     `mousedown` opens it looking north — and `MSKPZL` was taken standing
 *     there with the dials still reading the snake's 8/12/4. Nothing on this
 *     rung touches them: `gotoblack ()` is the only thing that re-rolls the
 *     three, and it is only reached by walking into an edge cell's dark.
 *
 * **Not claimed.** `idlecount` goes 1 → 0 between the two saves, which is
 * `GANG.CST`'s own bookkeeping and not this rung's. The Blade is a prop rather
 * than a global so the harness cannot check it; the route asserts
 * `propowner ("Blade") = "snake"` itself. `phase` stays 0 and is claimed to say
 * so: `gotosnake ()` raises it to 1 only when all four puzzles are done, and
 * here the mine and the thunderbird are still 0.
 *
 * ## Three engine faults this route stands in for
 *
 * All three are in `engine/`, none is this rung's to fix, and each is worked
 * around here in the smallest way that lets the GAME's own scripts run.
 *
 * 1. **A shop is addressed by its stored refName, not by its filename.**
 *    `SNAKE.PRP`'s refName is **"puzzle"**, and all six calls that drive this
 *    puzzle name it that: `shopwarm ("puzzle")`, `sendtoshop ("puzzle",
 *    initprops ())`, `sendtoshop ("puzzle", mangle ())`, `sendtoshopfx
 *    ("puzzle", solved ())`, `sendtoshop ("puzzle", unmangle ())` and
 *    `closeshopfile ("puzzle")`. `GameSession.openShop` keys `shopMains` by
 *    FILE NAME and `findGlobalInstance` will match a stem, so "puzzle" resolves
 *    to nothing: the rings are never positioned, never scrambled, and
 *    `solved ()` answers 0 through a target that is not loaded — the puzzle
 *    cannot be played at all, and cannot be failed either. The saves say the
 *    original resolved it: `MSKPZL`'s prop table has no `stop1`..`stop7` and no
 *    `hexbut` in it, so `closeshopfile ("puzzle")` really did close
 *    `SNAKE.PRP` in 1995. `INVEN.PRP` (refName "inven") and `HOUSE.PRP`
 *    ("house") are addressed by refName too and only look like filenames.
 *    Worked around by {@link openPuzzleShop}.
 * 2. **`propxy (name, 3)` should pack the screen point** and answers `anchorX`
 *    (`builtins/props.ts` handles axes 1 and 2 only, the way `propxyz (…, 4)`
 *    packs a pair). `rungs/d3e004.ts` and `rungs/flutepzl.ts` both work around
 *    the same gap on the bank safe and the sundial, and this route does what
 *    they do: it never draws a circle round the ring, it asks the engine's own
 *    `calcdeg` what value each screen point produces and moves to one that is
 *    worth a notch. The coupling in step 2 is read the same way — through the
 *    engine's own `calcdist` — so scramble and solution agree whatever that
 *    call answers, and the route needs no changing when it is fixed.
 * 3. **Opening a set clears `setvisible`, and here it does not.**
 *    `dohexpuz ()` hides the room with `setvisible (false)`, and
 *    `gotosnake ()`'s SOLVED branch never puts it back — its unsolved branch
 *    does, and so does every other exit in the underground that stays in the
 *    same set (`SUNDIAL.FLT gotohub ()`, `SCORP.FLT hitdesk ()`,
 *    `FLUTE.FLT gotoflute ()`). What the solved branch does instead is
 *    `sendtoset (gotohub ())` → `closesetfile () / opensetfile ("hub.set")`, and
 *    `FLUTE.FLT/0001 evaluate ()`'s solved branch is the same shape — two
 *    scripts on the shipped playthrough's own route relying on a set change to
 *    raise the flag. In this port `session.setVisible` survives it, and
 *    `BOOTFILE/0001 keydown ()` is `if currentset () != "none" & setvisible ()
 *    = true → sendtoscene (…)`, so every key in the hub goes to the panel
 *    instead of the room and the blackout can never be counted down. The route
 *    does not poke the flag: it opens the MAP and shuts it, which is a gesture
 *    a player has, and `NEW.FLT/0020` — the map flat's own click region — is
 *    `setvisible (true) / gotoflat (1)`.
 */
export const rung: Segment = {
  from: "DAGRPZL",
  to: "MSKPZL",
  what: "the hex lock in the snake room, and back up to the sundial",
  claims: ["snakepuzzle", "blackout", "phase", "nextroom", "largedial", "meddial", "smalldial"],
  async play(p) {
    const snake = set("SNAKE");
    const hub = set("HUB");
    const num = (name: string): number => Number(p.session.interp.globals.get(name) ?? 0);
    const str = (name: string): string => String(p.session.interp.globals.get(name) ?? "").toLowerCase();
    const flat = (): string => ask(p, "currentflat").toLowerCase();

    // ---- 1. one cell north, and round to face the hex button ---------------
    await walkTo(p, snake, { x: 1, z: 2, view: "south" });

    // ---- 2. the button, with the shop reachable by the name it answers to --
    await openPuzzleShop(p);
    p.fire(350, 162); // SNAKE.SET/0040 pointinhexbut, 335,150-365,175
    await p.pump(() => STOPS.some((n) => notch(p, n) !== 0), "the rings to be scrambled");
    await p.settle("mangle ()");

    // ---- 3. solve it, and check rather than assume -------------------------
    const coupling = bands(p);
    for (let go = 0; go < 4 && !STOPS.every((n) => notch(p, n) === 0); go++) {
      const scramble = STOPS.map((n) => notch(p, n));
      const turns = solve(scramble, coupling);
      if (!turns) throw new Error(`no solution for ${scramble.join(",")}`);
      if (process.env.DUST_TALK) {
        console.log(`[hex] scrambled ${scramble.join(",")} · turns ${turns.join(",")}`);
      }
      for (let i = 0; i < STOPS.length; i++) {
        for (let k = 0; k < turns[i]; k++) await turn(p, STOPS[i]);
      }
    }
    if (!STOPS.every((n) => notch(p, n) === 0)) {
      throw new Error(`the hex lock reads ${STOPS.map((n) => notch(p, n)).join(",")}, not all zero`);
    }

    // ---- 4. quit, which is where the snake takes the Blade -----------------
    p.fire((389 + 438) / 2, (178 + 226) / 2); // snake.flt's only region, "quit"
    await p.pump(() => str("snakepuzzle") === "done", "the lock to open", 80_000);
    await p.pump(() => room(p).startsWith("hub"), "the hub back");
    await p.settle("snake.mov");
    if (ask(p, "propowner", ["Blade"]).toLowerCase() !== "snake") {
      throw new Error(`the snake did not take the Blade — it is "${ask(p, "propowner", ["Blade"])}"`);
    }

    // ---- 5. the map, which is how the room comes back (fault 3 above) ------
    if (ask(p, "setvisible") !== "1") {
      p.fire(82, 324); // mainpanel's "map" region, 39,291-125,357
      await p.pump(() => flat() === "map", "the map");
      p.fire(256, 193); // the map flat's own region — NEW.FLT/0020
      await p.pump(() => flat() === "mainpanel" && ask(p, "setvisible") === "1", "the room back");
      await p.settle("the map shutting");
    }

    // ---- 6. the count in the dark ------------------------------------------
    for (let i = 0; i < 12 && num("blackout") !== -1; i++) await p.press("uparrow", "the dark in the hub");
    if (num("blackout") !== -1) throw new Error(`still in the dark — blackout is ${num("blackout")}`);

    // ---- 7. two cells north, to the cell that looks at the sundial ---------
    await walkTo(p, hub, { x: 3, z: 4, view: "north" }); // HUB.SET/0059, Scene D5
  },
};

/**
 * Make `snake.prp` answer to "puzzle", which is the name its own scripts use.
 *
 * The stand-in for fault 1 above, and the smallest one there is: the shop is
 * opened through the engine's own `openShop` (which `dohexpuz ()`'s
 * `openshopfile ("snake.prp")` a moment later re-enters rather than reloads),
 * and its main is then registered a second time under the refName the file
 * carries. Everything after that is the GAME's — `initprops ()`, `mangle ()`,
 * `solved ()` and `closeshopfile ()` all resolve, and this route never
 * dispatches a handler of its own.
 *
 * `shopMains` is private to `GameSession`, so this reaches it by cast. That is
 * the whole of the ugliness, and it is here rather than in `engine/` because
 * four other rungs are being written against those files at the same time.
 */
async function openPuzzleShop(p: Pumped): Promise<void> {
  await p.session.openShop("snake.prp");
  const inside = p.session as unknown as {
    shopMains: Map<string, unknown>;
    propRuntime: { shops: Map<string, unknown> };
  };
  const main = inside.shopMains.get("snake.prp");
  if (!main) throw new Error("snake.prp did not load — the hex lock cannot be reached");
  inside.shopMains.set("puzzle", main);
  // ...and the prop side too, so `closeshopfile ("puzzle")` on the way out
  // takes the seven rings with it the way the `MSKPZL` save says it did
  const shop = inside.propRuntime.shops.get("snake.prp");
  if (shop) inside.propRuntime.shops.set("puzzle", shop);
}

/** a ring's position on its wheel, in notches of 6 — `solved ()` wants 0 */
const notch = (p: Pumped, name: string): number => Math.round(Number(ask(p, "propdeg", [name])) / 6) % 6;

/**
 * How far each ring turns when another one does — `spinall ()`'s own question.
 *
 * Asked of the engine rather than computed from the hexagon, because the
 * question the script asks is `calcdist (propxy (name, 3), propxy (target, 3))`
 * and fault 2 above changes what that answers. Whatever it answers, the
 * scramble used it too, so the route and the puzzle agree either way.
 */
function bands(p: Pumped): number[][] {
  const at = (name: string): number => Number(ask(p, "propxy", [name, 3]));
  return STOPS.map((target) =>
    STOPS.map((name) => {
      if (name === target) return 1; // the ring the drag itself turns
      const d = Number(ask(p, "calcdist", [at(name), at(target)]));
      if (d > 50 && d < 100) return 1;
      if (d > 100 && d < 150) return 2;
      if (d > 150) return 3;
      return 0;
    }),
  );
}

/**
 * How many notches to turn each ring, so that all seven come to rest on 0.
 *
 * Every move is `state += turns * coupling` in Z6 and they all commute, so this
 * is a linear system over seven unknowns each worth 0..5 — small enough to try
 * all 6^7 of them. A solution always exists, because `mangle ()` built the
 * scramble out of the same moves (step 3 of the note above).
 */
function solve(state: number[], coupling: number[][]): number[] | null {
  const turns = [0, 0, 0, 0, 0, 0, 0];
  const rec = (i: number): number[] | null => {
    if (i === turns.length) {
      for (let q = 0; q < STOPS.length; q++) {
        let sum = state[q];
        for (let t = 0; t < STOPS.length; t++) sum += turns[t] * coupling[t][q];
        if (sum % 6 !== 0) return null;
      }
      return [...turns];
    }
    for (let k = 0; k < 6; k++) {
      turns[i] = k;
      const found = rec(i + 1);
      if (found) return found;
    }
    turns[i] = 0;
    return null;
  };
  return rec(0);
}

/**
 * Turn one ring one notch clockwise: press it, carry the pointer, let go.
 *
 * `SNAKE.PRP/0001 mousedown` is a poll — `while stilldown () … arg = mouse ()`
 * — so the press has to be DISPATCHED (which is what puts the ring's name in
 * `target`, since the seven groups have no script of their own and the shop
 * main dispatches on it) and the button has to be genuinely held, or the loop
 * spins for ever. `p.fire` with `session.pointerDown` raised is both.
 *
 * Where to carry it to is asked of the engine. The handler's arithmetic is
 *
 *     orig = fixdeg256 (calcdeg (propxy (target, 3), arg) + 64)
 *     newd = … the same, of wherever the pointer is now
 *     deg  = limiter (start, start + (newd - orig))
 *
 * and `limiter ()` clamps to `start ± 6` — so ONE pointer position anywhere
 * worth between 6 and 17 more than the press is a whole notch, and there is no
 * need to sweep. The route scans the screen with the engine's own `calcdeg`,
 * takes the point nearest the middle of that window, and only lets go once
 * `propdeg` reads the notch it asked for.
 */
async function turn(p: Pumped, name: string): Promise<void> {
  const start = Number(ask(p, "propdeg", [name]));
  const want = (start + 6) % 36;
  const centre = Number(ask(p, "propxy", [name, 3]));
  /** the handler's `fixdeg256 (calcdeg (centre, point) + 64)`, in the engine's own arithmetic */
  const valueAt = (x: number, y: number): number => {
    let deg = Number(ask(p, "calcdeg", [centre, Number(ask(p, "makepoint", [x, y]))])) + 64;
    while (deg < 0) deg += 256;
    while (deg > 255) deg -= 256;
    return Math.trunc((deg * 36) / 256);
  };
  const grip = { x: Number(ask(p, "propxy", [name, 1])), y: Number(ask(p, "propxy", [name, 2])) };
  const orig = valueAt(grip.x, grip.y);
  // the pointer position worth a notch: 6 is the least that clamps, 18 is where
  // `limiter ()` reads the turn as the other way round, so aim for the middle
  let best: { x: number; y: number; miss: number } | null = null;
  for (let y = 0; y < 384; y += 4) {
    for (let x = 0; x < 512; x += 4) {
      const delta = (valueAt(x, y) - orig + 36) % 36;
      if (delta < 6 || delta > 17) continue;
      const miss = Math.abs(delta - 11);
      if (!best || miss < best.miss) best = { x, y, miss };
    }
  }
  if (!best) throw new Error(`no point on screen turns ${name} a notch from ${orig}`);
  p.session.setPointer(grip.x, grip.y);
  p.session.pointerDown = true;
  try {
    p.fire(grip.x, grip.y); // dispatched, so the shop main's `target` is this ring
    await p.tick(6);
    p.session.setPointer(best.x, best.y);
    await p.pump(() => Number(ask(p, "propdeg", [name])) === want, `${name} to come round a notch`, 400);
  } finally {
    p.session.pointerDown = false; // the release is what ends the poll
  }
  await p.settle(`${name} turning`);
  if (Number(ask(p, "propdeg", [name])) !== want) {
    throw new Error(`${name} stopped on ${ask(p, "propdeg", [name])}, not ${want}`);
  }
}
