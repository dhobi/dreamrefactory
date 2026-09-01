/**
 * The moves a route is written out of.
 *
 * The rungs themselves live in [`segments.ts`](./segments.ts) and in
 * [`rungs/`](./rungs); this is what they are all made of — walk there, open
 * that, click him, answer her, hand this over, walk away. Every one of them is
 * a PREDICATE with a name: it does the thing and then asks the engine whether
 * the thing happened, because a click that misses is silent and an `uparrow`
 * that lands in the wrong room does not fail.
 */
import { readFileSync } from "node:fs";
import { readSetFileV1 } from "@dreamfactory/engine/df/set-v1";
import { facingFor, mergeCompass, planRoute, sceneAt } from "./nav";
import { CD, indexDisc, type Pumped } from "./harness";

export interface Segment {
  /**
   * The shipped save this rung starts at, or `null` for the one rung that
   * starts at a cold boot.
   *
   * Every other rung loads its own beginning off the disc, which is what makes
   * them independent and lets them be written in any order. The opening cannot:
   * `D1E_001` is the earliest save CyberFlix took and the first four thousand
   * frames happen before it, so the only way to check that stretch is to boot
   * the game and play it.
   */
  from: string | null;
  /** the shipped save it ends at */
  to: string;
  /** one line, for the test name */
  what: string;
  /** the globals this rung is about, checked against `to` */
  claims: string[];
  play(p: Pumped): Promise<void>;
}

/**
 * The compass, from the night town plus whatever set is being navigated.
 *
 * The town walks all four ways and an interior may walk one, so the town is what
 * makes "west" answerable inside `MAYHALL` — and `mergeCompass` throws if the
 * two ever disagree, which is the check that the numbering really is the
 * engine's and not each set's.
 */
function facingOf(set: ReturnType<typeof readSetFileV1>, view: string): number {
  const facing = facingFor(mergeCompass([set, set2("NITE")]), view);
  if (facing === null) throw new Error(`no facing for "${view}" in ${set.setName} or the town`);
  return facing;
}

/** where the game says we are standing, as a cell in the set we are in */
function standingIn(p: Pumped, set: ReturnType<typeof readSetFileV1>): { x: number; z: number; facing: number } {
  const scene = p.session.currentSceneName()?.toLowerCase() ?? "";
  const hit = set.scenes.find((s) => s.name.toLowerCase() === scene);
  if (!hit) throw new Error(`"${scene}" is not a cell of ${set.setName}`);
  return { x: hit.x, z: hit.z, facing: facingOf(set, p.session.currentViewName() ?? "") };
}

/**
 * Walk to a cell and face a way, by a route the SET is asked for — and check.
 *
 * Re-planned from where we actually are, up to a few times, because arriving is
 * not the same as having arrived: the world moves while you walk. At the end of
 * the evening at the Mayor's this route reached the dining-room door's own cell
 * and was then turned to face south by something else before the door was
 * clicked, and a click on a wall is silent. Planning once and pressing blindly
 * cannot notice that; planning again from the standpoint the engine reports can.
 */
export async function walkTo(
  p: Pumped,
  set: ReturnType<typeof readSetFileV1>,
  goal: { x: number; z: number; view: string },
  /**
   * Stop early, and do not complain about where we ended up.
   *
   * Some standpoints are a trigger: NITE Scene D7 entered facing south on day 1
   * at `phase = 8` starts the street fight, and the scene's own `openscene`
   * then turns you through west to north before anything can check. Arriving is
   * the point; still facing the way you asked for is not.
   */
  stopWhen?: () => boolean,
  tries = 4,
  /**
   * Which replies a conversation that interrupts the WALK may be answered with.
   *
   * The default gets you out of most of them, and getting out is usually all a
   * route wants of somebody who steps in front of it. But a leaving line is
   * often also the line that sets that character's phase — Marie's night
   * `twonite ()` sets `mariephase = 1` on **202** and `LEAVING` reaches 104
   * first, Buick's on **102** ahead of `luck ()` — so a rung whose whole point
   * is that phase must not let a walk answer it. Those callers pass
   * `stopWhen: () => !!p.session.puppet` and answer it themselves; this is for
   * the ones that only want a different way out.
   */
  replies: number[] = LEAVING,
): Promise<void> {
  const facing = facingOf(set, goal.view);
  for (let i = 0; i < tries; i++) {
    if (stopWhen?.()) return;
    await clearInterruption(p, replies);
    const at = standingIn(p, set);
    if (at.x === goal.x && at.z === goal.z && at.facing === facing) return;
    let route = planRoute(set, at, { x: goal.x, z: goal.z, facing });
    /*
     * No route from the way we happen to be FACING is not the same as no route.
     *
     * A set's move table is authored per (cell, facing), and some standpoints
     * are one-way: TOWN Scene E11 reaches Scene E12 from three of its four
     * facings and from the fourth there is no path at all — while Scene E12
     * itself cannot be stood in facing north. So a walker that arrives wrong
     * way round is stuck, and the one thing a player would obviously do is turn
     * on the spot. This does that: a quarter turn, re-plan, up to a full circle.
     * (Found when the set-main parent fix moved a walker by one facing and this
     * threw "no route to Scene A1 facing north from scene g6 · south".)
     */
    for (let turn = 0; !route && turn < 3; turn++) {
      await p.press("rightarrow", "turning to look for a way round");
      if (stopWhen?.()) return;
      const now = standingIn(p, set);
      if (now.x === goal.x && now.z === goal.z && now.facing === facing) return;
      route = planRoute(set, now, { x: goal.x, z: goal.z, facing });
    }
    if (!route) {
      throw new Error(
        `no route to ${sceneAt(set, goal.x, goal.z)} facing ${goal.view} from ` +
          `${p.session.currentSetFile} ${p.session.currentSceneName()} · ${p.session.currentViewName()}` +
          ` (tried all four facings)`,
      );
    }
    for (const key of route.keys) {
      await p.press(key, `${key} toward ${sceneAt(set, goal.x, goal.z)}`);
      if (stopWhen?.()) return;
      // somebody may have stepped in front of us mid-route
      if (await clearInterruption(p, replies)) break;
    }
  }
  if (stopWhen?.()) return;
  const at = standingIn(p, set);
  if (at.x !== goal.x || at.z !== goal.z || at.facing !== facing) {
    throw new Error(
      `could not stand at ${sceneAt(set, goal.x, goal.z)} facing ${goal.view}: ` +
        `${p.session.currentSceneName()} · ${p.session.currentViewName()} after ${tries} tries`,
    );
  }
}

/**
 * Click a character until they answer.
 *
 * `GANG.CST`'s `mousedown` is gated on `realdist (me) < hotdist ()`, so clicking
 * someone who is walking towards you does nothing at all until they arrive — and
 * being close enough is not the whole of it either. `walktopuppet ()` opens with
 * `if thex != 0 & they != 0 exitcode`, so a click from a cell that shares
 * NEITHER the character's row nor their column opens nothing at all, however
 * near it is. In the street that is most of the cells within `hotdist ()`. Walk
 * onto their row or their column, not merely towards them. And
 * `D1E_006` is taken with the Mayor's wife mid-stride, three quarters of the way
 * along an authored route to the player's own cell. A player clicks again as
 * they come; so does this. The retry is bounded and the OUTCOME is the
 * predicate, so nothing here is a guess about how long walking takes.
 */
export async function clickActor(
  p: Pumped,
  name: string,
  what: string,
  tries = 40,
  /**
   * What counts as ANSWERED, when "a conversation is open" does not.
   *
   * The default is right for anyone with plaques, and wrong for anyone whose
   * whole exchange is `puppetspeak` — the Mayor's wife's `brushoff ()` and
   * `TODD.PUP/0048` both open and close inside one `settle`, so a click that
   * worked reads as a click that did nothing. Those callers pass the outcome
   * they actually want: a `counter` that moved, an `actorvalue` that rose.
   */
  until: () => boolean = () => !!p.session.puppet,
  /** wait for them to stop walking first — see the note on the wait below */
  settleFirst = true,
): Promise<void> {
  // the script maps are keyed lowercase, and a caller naming the character the
  // way the SAVE spells them ("Cobb", "Mwife") is naming the same person
  const key = name.toLowerCase();
  const script = p.session.castScripts.get(key);
  if (!script) throw new Error(`no cast script for "${name}" — is gang.cst open?`);
  /*
   * Let them arrive first.
   *
   * `GANG.CST`'s mousedown ends in `walktopuppet`, whose four waits are all
   * `while iswalk (who) forceupdate () endwhile` — so clicking someone who is
   * still walking opens their file and closes it again without a word. Marie
   * crossing to the dinner table is exactly that: the puppet opened, the
   * conversation never asked its question, and `mariephase` stayed where it was.
   * Bounded, and not fatal: some characters walk on a loop and never stop, and
   * for those the click still has to be tried.
   */
  const walking = (): boolean =>
    Number((p.session.interp.builtins.get("iswalk") as ((i: unknown, a: unknown[]) => unknown) | undefined)
      ?.(p.session.interp, [key]) ?? 0) === 1;
  // ...unless they never stop. The Mayor on day-3 afternoon walks a seven-cell
  // loop and his `endwalk` turns him round the instant he lands, so a wait for
  // `iswalk` to clear is a wait that cannot end.
  if (settleFirst) for (let i = 0; i < 40 && walking(); i++) await p.tick(60);
  for (let i = 0; i < tries; i++) {
    if (until()) return;
    void p.session.track(
      p.session.interp.runHandler(script, "mousedown", [key], { me: key, target: key }),
    );
    await p.settle(`clicking ${name}`);
    if (until()) return;
    await p.tick(60); // they are nearer now than they were
  }
  throw new Error(`${name} never answered (${tries} clicks) — ${what}`);
}

/**
 * Go to somebody and talk to them, wherever they have wandered to.
 *
 * Five rungs wrote this before it was written here, which is the argument for
 * it being here. Clicking a character in the street has THREE gates, and only
 * the first is obvious:
 *
 *   1. `realdist (me) < hotdist ()` — 384 in the town, 512 indoors.
 *   2. `GANG.CST/0001 walktopuppet ()` opens `if thex != 0 & they != 0
 *      exitcode`, over CELL deltas — so a click from a cell sharing NEITHER
 *      their row nor their column opens nothing at all, however near it is.
 *      Most of the cells inside `hotdist ()` are such cells.
 *   3. They have to still be there when the walk arrives.
 *
 * So this asks the engine where they are, walks onto that cell, and checks they
 * have not moved before clicking — and gives up its turn to a conversation that
 * starts by itself on the way, because being accosted by the person you were
 * walking towards is the same outcome by a different route.
 */
export async function meet(
  p: Pumped,
  set: ReturnType<typeof readSetFileV1>,
  who: string,
  what: string,
  /** what counts as having got through to them; the default is a conversation */
  until: () => boolean = () => !!p.session.puppet,
  rounds = 8,
): Promise<void> {
  const key = who.toLowerCase();
  const call = (name: string, args: unknown[]): number =>
    Number((p.session.interp.builtins.get(name) as
      ((i: unknown, a: unknown[]) => unknown) | undefined)?.(p.session.interp, args) ?? 0);
  const walking = (): boolean => call("iswalk", [key]) === 1;
  const cellOf = (): { x: number; z: number } => ({
    x: Math.round((call("actorxyz", [key, 1]) - 128) / 256),
    z: Math.round((call("actorxyz", [key, 2]) - 128) / 256),
  });
  for (let round = 0; round < rounds && !until(); round++) {
    await p.pump(() => !walking() || until(), `${who} to stand still`);
    if (until()) return;
    const at = cellOf();
    if (!set.scenes.some((sc) => sc.x === at.x && sc.z === at.z)) {
      await p.tick(60); // between standpoints for a moment; ask again
      continue;
    }
    /*
     * Any facing will do — what matters is standing on their cell, because that
     * is what `walktopuppet ()`'s row/column test reads. "North" is not always
     * available: a set's move table is authored per (cell, facing) and some
     * standpoints cannot be stood in every way round, so asking for one of them
     * by name throws where turning up at all would have done.
     */
    let stood = false;
    for (const view of ["north", "east", "south", "west"]) {
      try {
        await walkTo(p, set, { x: at.x, z: at.z, view }, until);
        stood = true;
        break;
      } catch {
        // that facing is not reachable here; try the next
      }
    }
    if (!stood) continue;
    if (until()) return;
    const now = cellOf();
    if (now.x !== at.x || now.z !== at.z) continue; // they moved while we walked
    try {
      await clickActor(p, key, what, 8, until);
    } catch {
      // they set off again between the check and the click
    }
  }
  if (!until()) throw new Error(`could not get to ${who} — ${what}`);
}

/**
 * Fire a gesture, let the film play, and only click if it stalls.
 *
 * With a real frame source `playmovie` is MODAL, as it is in DF.EXE, so the
 * handler that starts a film is suspended inside it — and the globals it sets
 * afterwards do not move until the film is done. Most films finish on their own:
 * `getcards.mov` is 37 frames of `action 2, target = next` ending on an
 * `action 1` exit, and left alone it plays out and returns.
 *
 * **Waiting comes first and clicking second**, because clicking a film that was
 * going to end anyway is not harmless — its frames carry typed click records and
 * a click lands on one of them.
 *
 * And WHERE matters. `getcards.mov` is a little close-up with three interactive
 * frames, and each offers two boxes: on frame 1 the right half goes on and the
 * left half leaves; on frame 10 a narrow box at 311,100-371,223 is **the cards**
 * and the whole rest of the picture is walking away without them; frame 12 is
 * the same shape again. A click at 256,190 — the middle, the obvious place —
 * takes the walk-away branch every time, which is why thirty of them never got
 * the postcards. The point below is inside the right box on all three.
 */
export async function clickThrough(
  p: Pumped,
  gesture: () => void,
  done: () => boolean,
  what: string,
  at: { x: number; y: number } = { x: 256, y: 190 },
  tries = 20,
): Promise<void> {
  gesture();
  await p.settle(what);
  // let it play: a film that ends by itself needs nothing but time
  for (let i = 0; i < 30 && !done(); i++) await p.tick(60);
  if (done()) return;
  // …and only a film that is genuinely waiting for the player gets clicked
  for (let i = 0; i < tries; i++) {
    p.fire(at.x, at.y);
    await p.settle(what);
    await p.tick(30);
    if (done()) return;
  }
  throw new Error(`${what} never finished (waited, then ${tries} clicks)`);
}

/**
 * Drive a character's conversation until something is true of the world.
 *
 * The evening at the Mayor's table is not one conversation but a cascade —
 * Marie's questions, and `momcomment()` swapping her file for the mother's and
 * back between them — and no single wait covers it. What works is a loop that
 * watches in SMALL steps: click whoever we are here to talk to when nothing is
 * open, answer any question that appears, and otherwise let the tick run.
 *
 * Watching across a wait rather than after one is the whole point. `clickActor`
 * settles and then asks "is a puppet open?", and a file that opens and closes
 * inside that settle is invisible to it — which is how nine attempts at this
 * rung watched an evening they were driving and concluded nothing had happened.
 */
export async function converse(
  p: Pumped,
  /** whom to click when nothing is open, or null when the world opened it */
  who: string | null,
  reply: number,
  done: () => boolean,
  what: string,
  rounds = 40,
): Promise<void> {
  const script = who === null ? null : p.session.castScripts.get(who);
  if (who !== null && !script) throw new Error(`no cast script for "${who}"`);
  for (let round = 0; round < rounds && !done(); round++) {
    if (!p.session.puppet && script && who) {
      void p.session.track(
        p.session.interp.runHandler(script, "mousedown", [who], { me: who, target: who }),
      );
    }
    for (let step = 0; step < 60 && !done(); step++) {
      await p.tick(20);
      const bevels = p.session.puppet?.bevels ?? [];
      const i = bevels.findIndex((b) => b.id === reply);
      if (i >= 0) {
        p.session.puppetCtrl.puppetChoose(i);
        await p.tick(20);
        continue;
      }
      /*
       * Nothing to answer — so nudge, because a conversation is not only
       * questions. Fear's hands the hotel key over across a modal
       * `spotmovie ("jacknote.mov")` and only sets `phase = 7` on the far side of
       * it, so a driver that waits for a question waits forever. A note takes any
       * click; the films that DON'T (see `clickThrough`) are clicked by name
       * where they matter.
       */
      if (step % 6 === 5) nudge(p);
    }
  }
  if (!done()) throw new Error(`${what} did not finish (${rounds} rounds)`);
  /*
   * Drain before handing back. `nudge ()` FIRES its click and does not await it,
   * which is right inside the loop and wrong at the edge: a rung that turns the
   * moment `converse` returns inherits the press, and two arrow keys come back
   * as three. Measured on `rungs/bldstpz.ts`, which turned twice to north and
   * read north, then "moving", then west.
   */
  await p.settle(what);
}

/**
 * Click a door until the door prop says it is open, then walk through it.
 *
 * Dust's interiors all work the same way: a `mousedown` inside a rectangle does
 * `sendtoprop ("door", setupprop ("<where>"))`, and the `keydown` that actually
 * moves you is gated on `propowner ("door") = "<where>"`. So a click that misses
 * is silent, and the `uparrow` after it does not fail — it WALKS, because the
 * set-level handler turns an ungated `uparrow` into `currentscene ("strait")`.
 * That is how this rung ended up one cell past the dining-room door facing the
 * wrong way, with nothing in the log to say so.
 *
 * Checking the prop is the difference between opening a door and hoping.
 */
export async function openDoor(
  p: Pumped,
  rect: [number, number, number, number],
  owner: string,
  what: string,
  /** where the door is clicked from, re-taken before every try */
  from?: { set: ReturnType<typeof readSetFileV1>; x: number; z: number; view: string },
  tries = 6,
): Promise<void> {
  const [x0, y0, x1, y1] = rect;
  /**
   * Where in the rectangle to click — because somebody may be standing in it.
   *
   * `walktopuppet ()` walks a character onto the PLAYER's own cell, which is
   * the cell a door is opened from, so after any conversation in a doorway the
   * person you were talking to is drawn across it. The hit test answers `actor`
   * before it answers the scene, so the click opens their file instead of the
   * door — silently, six times over. Three rungs hit this independently: Buick
   * across the hotel door, Laurel across the courthouse, the Mayor across the
   * doctor's.
   *
   * Rather than hand-picking a sub-rectangle per door, ask the engine which
   * part of this one is currently the SCENE, and aim there. A rectangle with no
   * such point is one somebody is standing squarely in front of, and the caller
   * simply has to wait for them to move — which the retry loop below does.
   */
  const aim = (): { x: number; y: number } | null => {
    const mid = { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) };
    const scene = (x: number, y: number): boolean => {
      ask(p, "hittest", [Number(ask(p, "makepoint", [x, y]))]);
      return ask(p, "result").toLowerCase() === "scene";
    };
    if (scene(mid.x, mid.y)) return mid;
    for (let y = y0 + 4; y <= y1 - 4; y += 6) {
      for (let x = x0 + 4; x <= x1 - 4; x += 6) if (scene(x, y)) return { x, y };
    }
    return null;
  };
  const opened = (): boolean =>
    String(
      (p.session.interp.builtins.get("propowner") as ((i: unknown, a: unknown[]) => unknown) | undefined)
        ?.(p.session.interp, ["door"]) ?? "",
    ).toLowerCase() === owner;
  /*
   * Which side of the door we started on — because sometimes we are through it
   * before this function gets to press anything.
   *
   * `p.fire` does not await its click, so the `settle` after it is where a press
   * that is still in the queue lands, and at a door standpoint an ungated
   * `uparrow` is `currentscene ("strait")` — straight through the door the click
   * has just opened. The prop is then the ARRIVED set's `door`, which is nobody's,
   * so `opened()` says no and the retry walks... in a set the `from` standpoint
   * does not exist in ("no route to Scene G12 facing west from jail scene a1").
   *
   * Going through is what the caller wanted, so notice it and stop rather than
   * insisting on the ceremony. Found on `rungs/d3e005.ts` at the jail door after
   * #352 shortened every move by a tick and moved which press was outstanding.
   */
  const startedIn = p.session.currentSetFile;
  const wentThrough = (): boolean => p.session.currentSetFile !== startedIn;
  for (let i = 0; i < tries && !opened() && !wentThrough(); i++) {
    // the standpoint is re-taken every try: a click only reaches a door from the
    // cell and facing whose script owns it, and the world turns you around
    if (from) await walkTo(p, from.set, { x: from.x, z: from.z, view: from.view });
    if (wentThrough()) return;
    const at = aim();
    if (!at) {
      // somebody is standing across the whole of it; give them a moment to move
      await p.tick(60);
      continue;
    }
    p.fire(at.x, at.y);
    await p.settle(what);
    if (wentThrough()) return;
  }
  if (wentThrough()) return;
  if (!opened()) {
    throw new Error(
      `${what} did not open — the door prop is not "${owner}", standing at ` +
        `${p.session.currentSetFile} ${p.session.currentSceneName()} · ${p.session.currentViewName()}`,
    );
  }
  await p.press("uparrow", `through ${what}`);
}

/**
 * The nudge that moves a conversation along — and the one place it is not free.
 *
 * A spoken line with no plaques takes any click, so `talkOut` and `converse`
 * click the middle of the screen when there is nothing to answer. That click
 * goes through `BOOTFILE/0001 mousedown`, and its FIRST branch after the puppet
 * is
 *
 *     if handitem = "gun" & pointinset (thepoint) & currentflat () = "mainpanel"
 *         ... sendtoflat ("mainpanel", bullet (thepoint))
 *
 * so with the gun in hand and raised, the nudge is a ROUND FIRED at whatever is
 * under the middle of the screen. In the street outside Chin's at `phase = 2`
 * that is Cobb Belcher, and shooting him there is `playerdeath = "by cobb"`.
 *
 * So a nudge with the gun up is ESC instead, which advances a spoken line
 * (`PuppetController.key` → `skipLine`) and costs no bullet.
 */
function nudge(p: Pumped): void {
  const armed =
    String(p.session.interp.globals.get("handitem") ?? "").toLowerCase() === "gun" &&
    ask(p, "propvisible", ["gunhand"]) === "1";
  if (armed) void p.session.track(p.v().keyDown(".", true));
  else p.fire(256, 190);
}

/**
 * Answer whatever is being said until nothing more is said.
 *
 * "Is a puppet open?" is a question about an instant, and a character who walks
 * up to you is not open yet when you ask and is open again after you stop
 * looking. Buick on the hotel landing does exactly that: a wait for him to
 * finish returned in the gap before he started, the route walked into a
 * conversation that had reopened behind it, and the keys went nowhere.
 *
 * So this waits for QUIET instead — a whole window with nothing on screen — and
 * answers anything that appears in the meantime.
 *
 * **Which reply matters more than it looks.** Buick's `firstencounter ()` is a
 * `while true` around its plaques: "Huh?", "Where are you from?", "Do you live
 * here?" and "You speak funny." all speak a line and come round again, and the
 * ONLY way out is **104, "I should leave..."** (or walking away, which a driver
 * cannot do). Answering him politely forever is a loop with no exit, which is
 * what five attempts at this rung were doing. So the replies are a list in
 * order of preference, and a leaving line is what to prefer.
 */
export async function talkOut(
  p: Pumped,
  /** replies to look for, in order of preference — the first one offered wins */
  replies: number | number[],
  what: string,
  quietWindows = 3,
): Promise<void> {
  const wanted = Array.isArray(replies) ? replies : [replies];
  /*
   * Wait for the first word before waiting for the last.
   *
   * Someone who has to WALK to you is not talking yet when the route gets here,
   * and a "wait until quiet" that starts before they open their mouth is
   * satisfied by the silence in front of them. Buick crossing the hotel landing
   * took longer than three quiet windows, so five attempts watched an empty
   * screen, declared the conversation over, and then walked into it.
   */
  for (let i = 0; i < 120 && !p.session.puppet; i++) await p.tick(30);
  if (process.env.DUST_TALK) console.log(`[talkOut ${what}] first word: puppet=${!!p.session.puppet}`);
  let quiet = 0;
  let stuck = "";
  for (let round = 0; round < 60 && quiet < quietWindows; round++) {
    let spoke = false;
    for (let step = 0; step < 25; step++) {
      await p.tick(20);
      if (!p.session.puppet) continue;
      spoke = true;
      const bevels = p.session.puppet.bevels ?? [];
      let i = -1;
      for (const id of wanted) {
        i = bevels.findIndex((b) => b.id === id);
        if (i >= 0) break;
      }
      if (i >= 0) {
        if (process.env.DUST_TALK) console.log(`[talkOut ${what}] choosing ${i} of ${bevels.map((b) => b.id).join(",")}`);
        p.session.puppetCtrl.puppetChoose(i);
        stuck = "";
      } else if (bevels.length && question(p) === stuck) {
        /*
         * A question with no answer we are willing to give — so walk out.
         *
         * The Mayor's `shop ()` is the case: `while true` around its plaques,
         * and its only exit is **555**, which is also `mayorphase = 1` and a
         * state the rung may not be entitled to. A player does not have to pick
         * one. `puppetevent (-1)` answers **-1** when the conversation is
         * DISMISSED, and every one of the 516 calls in the corpus is followed
         * by a `case -1` arm the authors wrote for exactly this. ESC is how it
         * is reached (`PuppetController.key`, TI.EXE 0x4418a7).
         */
        if (process.env.DUST_TALK) console.log(`[talkOut ${what}] esc out of ${stuck}`);
        void p.session.track(p.v().keyDown(".", true));
        stuck = "";
      } else if (bevels.length) {
        stuck = question(p);
      } else if (step % 4 === 3) nudge(p);
    }
    quiet = spoke ? 0 : quiet + 1;
  }
  if (p.session.puppet) throw new Error(`${what} never stopped talking`);
}

/**
 * Walk out of a conversation instead of answering it.
 *
 * `puppetevent (-1)` answers **-1** when the player dismisses the exchange, and
 * every one of the corpus's calls is followed by a `case -1` arm the authors
 * wrote for it. ESC is how a player reaches it
 * (`PuppetController.key`, TI.EXE 0x4418a7).
 *
 * Which the day-2 afternoon street needs, because the Mayor comes over
 * uninvited: `GANG.CST/1097 mayoridle ()` arms `hasattention (6)` for as long as
 * `mayorphase = 0`, and his `twopm ()` leads into `shop ()`, a `while true`
 * whose only exit is **555** — and 555 sets `mayorphase = 1`. `D2A_001` and
 * `D2A_005` both still read 0, so the original did not answer him: it walked
 * away, twice, and finished the conversation later at `D2A_006`.
 */
export async function excuseUs(p: Pumped, what: string, tries = 60): Promise<void> {
  for (let i = 0; i < tries && p.session.puppet; i++) {
    void p.session.track(p.v().keyDown(".", true));
    await p.tick(10);
  }
  if (p.session.puppet) throw new Error(`could not walk away from ${what}`);
}

/**
 * Answer whatever has just interrupted us, if anything has.
 *
 * Characters do not wait to be spoken to. Buick steps out onto the hotel landing
 * the moment you MOVE, not when you arrive — so a route that clears its throat
 * first sees an empty screen, and the conversation lands in the middle of the
 * walk instead, where every remaining keypress goes to a puppet. Walking has to
 * be able to answer.
 */
export async function clearInterruption(p: Pumped, replies: number[]): Promise<boolean> {
  if (!p.session.puppet) return false;
  for (let step = 0; step < 200 && p.session.puppet; step++) {
    const bevels = p.session.puppet?.bevels ?? [];
    let i = -1;
    for (const id of replies) {
      i = bevels.findIndex((b) => b.id === id);
      if (i >= 0) break;
    }
    if (i >= 0) p.session.puppetCtrl.puppetChoose(i);
    else if (step % 4 === 3) nudge(p);
    await p.tick(20);
  }
  return true;
}

/**
 * Replies that get a driver OUT of a conversation, in order of preference.
 *
 * Dust's longer conversations are `while true` around their plaques, and each
 * has exactly one leaving line — but not one leaving NUMBER. Buick's
 * `firstencounter ()` exits on 104 ("I should leave..."), Laurel's `breakfast ()`
 * on 301 ("Goodbye, Laurel."). Answering anything else politely forever is a
 * loop with no exit, and it looks from outside exactly like a conversation that
 * will not close.
 *
 * So the high numbers come first: an author reaching for 301 is reaching for a
 * door. The ordinary replies are kept at the end because some conversations have
 * no leaving line at all and simply end when answered.
 */
export const LEAVING = [301, 201, 104, 102, 101, 103];

/**
 * Click a prop, the way the viewer does when you hit its sprite.
 *
 * The counterpart to {@link clickActor}: a prop's `mousedown` lives in the shop
 * file it came from and is reached by name (`session.propScripts`), so a route
 * can take the mask off the dining-room wall without knowing where on the screen
 * the wall is. Which matters, because a prop has no rectangle written down
 * anywhere — `flatprops.ts` can find a REGION on a flat, but a thing standing in
 * a room is found by hit-testing its art.
 *
 * **It cannot open a prop whose handler NAVIGATES, and the failure is a hang
 * rather than an error.** Reaching the script by name is the whole trick here,
 * and it is also the whole limitation: dispatching `mousedown` straight at the
 * interpreter means `SetViewer.armNavHooks ()` never runs, and `currentscene ()`
 * and `currentview ()` as SETTERS go through `session.onSceneJump` /
 * `onViewJump`, which are no-ops outside a gesture. So the handler's own idea of
 * where the player is standing never changes. `INVEN.PRP/0428 mousedown` → the
 * chest's `bloodcode ()` is the case that showed it: `phase` reached 4 and
 * `actorset ("blood")` reached "hub", the standpoint never left the cell the
 * click came from, and the script then sat in
 * `while currentview () != "east" forceupdate () endwhile` for ever. A prop like
 * that has to be hit-tested and clicked with `p.fire` — `rungs/bldstpz.ts`
 * writes that out.
 *
 * `until` is what stops the pressing: without it the loop fires `tries` times
 * whatever happens, and a second press lands on a world the first one already
 * changed. It is also checked BEFORE each settle, because a press that opens a
 * conversation leaves nothing for `settle ()` to end on and it runs to its cap.
 */
export async function clickProp(
  p: Pumped,
  name: string,
  what: string,
  opts: { until?: () => boolean; tries?: number } = {},
): Promise<void> {
  const { until, tries = 6 } = opts;
  const script = p.session.propScripts.get(name.toLowerCase());
  if (!script) throw new Error(`no prop script for "${name}"`);
  for (let i = 0; i < tries; i++) {
    if (until?.()) return;
    void p.session.track(
      p.session.interp.runHandler(script, "mousedown", [name], { me: name, target: name }),
    );
    if (until) {
      await p.pump(until, what);
      return;
    }
    await p.settle(what);
    await p.tick(40);
  }
  if (until && !until()) throw new Error(`${what} did not answer (${tries} clicks)`);
}

/** what a builtin answers right now, as a string */
export function ask(p: Pumped, name: string, args: unknown[] = []): string {
  const fn = p.session.interp.builtins.get(name) as
    ((i: unknown, a: unknown[]) => unknown) | undefined;
  return String(fn?.(p.session.interp, args) ?? "");
}

/**
 * Press, hold, release — a click for a script that is POLLING the mouse.
 *
 * `p.fire` goes through the director, which is right for everything that is
 * dispatched: a hotspot, a puppet plaque, a movie's frame. It is wrong for a
 * script sitting in its own input loop, because `button ()` and `stilldown ()`
 * read `session.pointerDown` and the director never sets it — the browser's own
 * pointerdown handler does (`dust/src/main.ts`). `INVEN.PRP/0001 handleselect ()`
 * is such a loop: `while true / sendtoboot (idle ()) / if button () …`, and it
 * is the whole inventory picker. Fired at, it spins forever; pressed and
 * released, it answers.
 *
 * The release is what carries the meaning, twice over: `handleselect ()` ends
 * its pass on `while button () endwhile`, and the OK button's `trackbut ()`
 * returns `not theres` only once `while stilldown ()` has let go.
 */
export async function hold(p: Pumped, x: number, y: number, what: string, frames = 10): Promise<void> {
  p.session.setPointer(x, y);
  p.session.pointerDown = true;
  try {
    await p.tick(frames);
  } finally {
    p.session.pointerDown = false;
  }
  await p.tick(frames);
  if (process.env.DUST_TALK) console.log(`[hold] ${what} at ${x},${y} — flat ${ask(p, "currentflat")}`);
}

/**
 * Drag something out of the panel and drop it on the world.
 *
 * Written out three times in the rungs before it was written here — the
 * matchbox into the schoolroom's desk drawer, and twice more — because it is
 * neither of the two gestures this file already had. `p.fire` is a dispatched
 * click and `hold ()` feeds a loop that is already polling; this is the one
 * `INVEN.PRP/0001 stdmouse ()` reads, and it reads the RELEASE:
 *
 *     while stilldown () … arg = mouse () … endwhile
 *     for count = 1 to countactors ()      → offerobject on an actor
 *     if pointinset (arg)                  → the room
 *     if pointy (arg) < 264 & pointinstage (arg)
 *         sendtoflat (currentflat (), offerobject (what))
 *
 * So the item's own `mousedown` has to run with the button HELD, the pointer
 * has to travel, and where it comes up is the answer. Anything less lands the
 * drop back where it started.
 *
 * **This is the drop onto a FLAT.** {@link dropOn} is the drop onto the ROOM,
 * and they cannot be one helper — see its comment for the measurement that
 * says so.
 */
export async function dragTo(
  p: Pumped,
  item: string,
  to: { x: number; y: number },
  what: string,
  frames = 10,
): Promise<void> {
  const script = p.session.propScripts.get(item.toLowerCase());
  if (!script) throw new Error(`no prop script for "${item}" — cannot drag ${what}`);
  const from = {
    x: Number(ask(p, "propxy", [item, 1])),
    y: Number(ask(p, "propxy", [item, 2])),
  };
  p.session.setPointer(from.x, from.y);
  p.session.pointerDown = true;
  try {
    void p.session.track(
      p.session.interp.runHandler(script, "mousedown", [Number(ask(p, "makepoint", [from.x, from.y]))], {
        me: item.toLowerCase(),
        target: item.toLowerCase(),
      }),
    );
    await p.tick(frames);
    p.session.setPointer(to.x, to.y);
    await p.tick(frames);
  } finally {
    p.session.pointerDown = false;
  }
  await p.tick(frames);
}

/**
 * Drop the thing in your hand onto somebody standing in the room.
 *
 * The sibling of {@link dragTo}, and the difference between them is not style:
 * it was measured, twice, in opposite directions.
 *
 * `dragTo` dispatches the item's `mousedown` straight at the interpreter. That
 * is what a drop onto a FLAT needs — on a flat the director does not hit-test
 * the panel's items, so a press at the item's own coordinates never reaches it
 * and the drag never starts. (Route this one through `p.fire` and `d4mines`'
 * yunni stone waits 40,000 steps for a poll loop that was never entered.)
 *
 * A drop onto the ROOM is the other way round. Some `offerobject ()` handlers
 * turn the camera themselves and then WAIT on it — the dog's is
 *
 *     currentscene ("right")
 *     while currentview () != "east" forceupdate () endwhile
 *
 * — and `currentscene`/`currentview` as SETTERS go through
 * `session.onSceneJump` / `onNavigate`, which are no-ops until a gesture has
 * armed them (`ScreenDirector.press` → `RoomLayer.armRoomNav`). Dispatched at
 * the interpreter that `while` never ends: the same failure {@link clickProp}
 * records for the chest's `bloodcode ()`.
 *
 * So this one presses through the director, with `pointerDown` already true so
 * that `stdmouse ()`'s `while stilldown () … arg = mouse () … endwhile` sees the
 * button held. It does not await the press, because the chain a drop starts is
 * often modal — at the dog it is two films and a conversation — and awaiting it
 * would deadlock the pump; the predicate it returns is how a caller waits for
 * the far end.
 *
 * Both waits are predicates. The first is the item's own loop admitting it has
 * the press; the second is the item REDRAWN at the pointer, because
 * `stdmouse ()` moves it with `propxy (what, pointx (arg), pointy (arg))` — the
 * thing being dragged is its own progress bar.
 */
export async function dropOn(
  p: Pumped,
  item: string,
  to: { x: number; y: number },
  what: string,
): Promise<() => boolean> {
  if (!p.session.propScripts.get(item.toLowerCase()))
    throw new Error(`no prop script for "${item}" — cannot drop ${what}`);
  const at = (axis: number): number => Number(ask(p, "propxy", [item, axis]));
  const from = { x: at(1), y: at(2) };
  p.session.setPointer(from.x, from.y);
  p.session.pointerDown = true;
  const done = p.fire(from.x, from.y);
  try {
    await p.pump(() => p.session.pollingInput(), `${what} to be picked up`);
    p.session.setPointer(to.x, to.y);
    await p.pump(() => at(1) === to.x, `${what} to be dragged to ${to.x},${to.y}`);
  } finally {
    p.session.pointerDown = false;
  }
  return done;
}

/**
 * Give the thing in your hand to whoever you are talking to.
 *
 * A gift in Dust is a PLAQUE. `INVEN.PRP/0001 addhandbevel ()` adds one to
 * whatever conversation is open — reply **55555** — and `selhandbevel ()`
 * answers it by calling `gift (handitem)` on that character's boot script. But
 * only sometimes: with `handflag = 1` it opens the inventory picker instead, and
 * `handflag` is set by every `addinven ()`, so it is 1 for most of the game.
 * Then the plaque reads "Would you like something...?" rather than "Would you
 * like this jug?", and the first press is the panel asking WHICH.
 *
 * So this presses it, and if the picker comes up, works the picker: click the
 * item where the panel has drawn it, click OK, and press the plaque again — now
 * naming the thing — which is the press that gifts.
 *
 * Three of the rungs found the same two edges independently, which is why the
 * body below is longer than the idea: the panel is not listening the moment it
 * appears, and the gift does not always leave a conversation behind it.
 */
export async function offerInTalk(p: Pumped, item: string, why: string): Promise<void> {
  const flat = (): string => ask(p, "currentflat").toLowerCase();
  const held = (): string => String(p.session.interp.globals.get("handitem") ?? "").toLowerCase();
  const plaque = (): number => (p.session.puppet?.bevels ?? []).findIndex((b) => b.id === 55555);
  for (let go = 0; go < 3; go++) {
    const at = plaque();
    if (at < 0) throw new Error(`no offer plaque in "${question(p)}" — ${why}`);
    const before = question(p);
    p.session.puppetCtrl.puppetChoose(at);
    /*
     * The picker never settles, so this cannot wait for quiet — and there are
     * THREE things `selhandbevel ()` can do, not two. It can open the panel; it
     * can gift and leave the conversation running, which shows as a new
     * question; or it can gift and END the conversation, which is
     * `TROTTER.PUP/0076 hesdrunk ()` (`if propowner ("sugarcubes") = "TROTTER"
     * exitcode`) and `RUBY.PUP/0007 gift ()` (which sets `rubyphase = 2`, and
     * `twopm ()` sees the 2 and exits). Waiting only for the first two hangs on
     * the third, with the answered plaque still framed.
     */
    await p.pump(
      () =>
        flat() === "avatar" ||
        !p.session.puppet ||
        (question(p) !== "" && question(p) !== before),
      `${why} to be taken, or the panel to open`,
    );
    if (flat() !== "avatar") return;
    /*
     * ...and the panel is not listening the moment it is on screen.
     * `INVEN.PRP/0001 selhandbevel ()` fades to it — `blacktoscreen ("stage",
     * 30)` — and only THEN enters `handleselect ()`, whose `if button ()` is
     * what a press has to arrive at. A press that beats the loop is dropped
     * silently, the OK a moment later closes the panel with `handitem`
     * unchanged, and the next plaque press gifts whatever WAS in hand: measured
     * as the harmonica going to Trotter with `trotterphase` still 3.
     *
     * `pollingInput ()` is the engine's own answer to "is a script sitting in an
     * input poll right now", which is exactly the question.
     */
    await p.pump(() => p.session.pollingInput(), "the panel's own input loop");
    // the picker draws every carried prop; ask the engine where it put this one
    const x = Number(ask(p, "propxy", [item, 1]));
    const y = Number(ask(p, "propxy", [item, 2]));
    for (let i = 0; i < 4 && held() !== item.toLowerCase(); i++) {
      await hold(p, x, y, `the ${item} in the panel`, 20);
    }
    if (held() !== item.toLowerCase()) {
      throw new Error(`the panel would not pick up ${why} — handitem is "${held()}"`);
    }
    // OK — new.flt's `avatar` click region, 266,321-367,345
    await hold(p, (266 + 367) / 2, (321 + 345) / 2, "the panel's OK", 20);
    await p.pump(() => flat() !== "avatar", "the panel to close");
    await p.settle("the panel");
  }
  throw new Error(`${why} was never taken`);
}

/**
 * Put something in the player's hand, the way the panel does.
 *
 * `INVEN.PRP/0001 stdmouse ()` is the whole of it: a click on an inventory prop
 * whose view is "panel" or "hilite" sets `handitem` to that prop and highlights
 * it. Which matters because `handitem` is not decoration — `addhandbevel ()`
 * reads it to decide what a conversation can be OFFERED, and `FLIPPO.PUP`'s
 * `twopm ()` greets a jug in your hand with a line it has for nothing else.
 */
export async function takeInHand(p: Pumped, name: string, why: string): Promise<void> {
  const held = (): string => String(p.session.interp.globals.get("handitem") ?? "").toLowerCase();
  if (held() === name.toLowerCase()) return;
  await clickProp(p, name, why, { until: () => held() === name.toLowerCase(), tries: 2 });
  if (held() !== name.toLowerCase()) throw new Error(`${why} would not go in hand — handitem is "${held()}"`);
}

/**
 * Offer something to somebody — the inventory gesture, not the click.
 *
 * `offerobject (what)` is its own handler on a cast script, and it is how Dust
 * gives things away: the birdcage's takes a seed or an apple
 * (`EXTRA.CST/0198`), Marie's takes the sugarcubes, Dell's takes a pie. There is
 * no clicking involved — the player picks the item up in the panel and drops it
 * on the character — so a route reaches it by name, the way it reaches a
 * mousedown.
 */
export async function offerTo(p: Pumped, who: string, what: string, why: string): Promise<void> {
  const script = p.session.castScripts.get(who.toLowerCase());
  if (!script) throw new Error(`no cast script for "${who}" — cannot offer ${what}`);
  void p.session.track(
    p.session.interp.runHandler(script, "offerobject", [what], { me: who, target: who }),
  );
  await p.settle(why);
  await p.tick(60);
}

/** the room the game is in, lower-cased and without its extension */
export const room = (p: Pumped): string => (p.session.currentSetFile ?? "").toLowerCase();

/** the question on screen, or "" — an ANSWERED list stays framed until the
 *  script clears it, so "are there bevels?" is not "is there a question?" */
export const question = (p: Pumped): string =>
  (p.session.puppet?.bevels ?? []).map((b) => `${b.id}:${b.text}`).join("|");

/**
 * Answer the next question with the reply the PUP script gave that id.
 *
 * Waits for a question that is not the one just answered, clicking through the
 * lines in between the way a player does. Answering by ID rather than by
 * position is what makes the route legible: `101` is the reply the script names,
 * whatever order the engine happens to shuffle the plaques into.
 */
export async function answer(p: Pumped, id: number, label: string, answered = ""): Promise<string> {
  await p.pump(
    () => !p.session.puppet || (question(p) !== "" && question(p) !== answered),
    `a question after ${answered || "the conversation opens"}`,
  );
  const asked = question(p);
  const i = (p.session.puppet?.bevels ?? []).findIndex((b) => b.id === id);
  if (i < 0) throw new Error(`no reply ${id} ("${label}") in: ${asked || "(no question)"}`);
  p.session.puppetCtrl.puppetChoose(i);
  await p.settle(`the reply "${label}"`);
  return asked;
}

/**
 * Where a set file actually is, which is not always `DATA/`.
 *
 * The four underground rooms and their hub ship in `UNDER/` — `HUB.SET`,
 * `FLUTE.SET`, `SNAKE.SET`, `TBIRD.SET` — and the mini-games have directories
 * of their own besides. `indexDisc ()` already indexes the whole rip by
 * lowercase basename, which is how the game itself asks for a file: `boot ()`
 * sets a search path and everything after it is named bare.
 */
const disc = indexDisc();
const setPath = (name: string): string => {
  const at = disc.get(`${name.toLowerCase()}.set`);
  if (!at) throw new Error(`no ${name}.SET anywhere on the disc`);
  return at;
};

const cache = new Map<string, ReturnType<typeof readSetFileV1>>();
const set2 = (name: string): ReturnType<typeof readSetFileV1> => {
  const had = cache.get(name);
  if (had) return had;
  const read = readSetFileV1(new Uint8Array(readFileSync(setPath(name))));
  cache.set(name, read);
  return read;
};
export const set = set2;

