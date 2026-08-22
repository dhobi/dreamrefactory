import { Value, toNum, toStr, truthy } from "../interp";
import { accessorFamily, BuiltinCtx } from "./context";
import { packPoint } from "../point";
import { isqrt, readStarPath } from "../../df/set";
import type { ActorInstance } from "../actors";

/**
 * What `actorstar` reports while a straight-line walk to a named star is running
 * — TI.EXE's walk builder (0x443ac0) stamps it into actor+0x70. It is a KIND,
 * not a place: the destination only appears once the actor lands. No script in
 * the corpus compares it; see {@link WALK_ON_PATH} for the one that is compared.
 */
const WALK_DEFER = "defer";

/**
 * What `actorstar` reports while an AUTHORED ROUTE is being walked — TI.EXE's
 * star-path builder (`0x4437f0`) stamps this into actor+0x70 instead, and it is
 * the one mid-walk sentinel a script does read:
 *
 *     if iswalk (who)
 *         savestar = walkdest (who)
 *         if actorstar (who) = "walkonpath"
 *             saveonpath = true
 *         endif
 *         stopwalk (who)
 *     …
 *     if saveonpath = true
 *         actorstar (who, "resume")
 *         walkonpath (who, "resume", savestar)
 *     else
 *         actorstar (who, "custom")
 *         sendtoactor (who, moveactorstar (savestar))
 *
 * — `walktopuppet` (gang.cst 0001), the single comparison of the word in the
 * whole corpus. It is how a conversation you started mid-route puts the walker
 * back on the ROUTE afterwards rather than sending them at the destination in a
 * straight line, and the port stamping "defer" here left that branch dead: the
 * hacker was interrupted in Scotland Road and resumed as a straight line, and
 * Georgia's curve around the boat deck (the whole of #122) would have gone back
 * through the second-class stairs.
 */
const WALK_ON_PATH = "walkonpath";

/** one point of a route as the walker holds it: a world position and the length
 *  of the leg BEHIND it (0 for the first) */
interface RoutePoint { x: number; y: number; z: number; fromPrev: number }

/**
 * Cut an authored route down to the part of it still ahead of an actor —
 * TI.EXE's `0x40a200`, which the `"resume"` lookup (`0x40a0f0`) calls on the
 * copy it just made, and which the named lookup (`0x409fd0`) does not call at
 * all. It is the whole difference between the two forms, and the whole meaning
 * of the word: `"resume"` walks the route FROM WHERE YOU ARE.
 *
 * Four steps, in the original's order:
 *
 *  1. find the point nearest the actor (its own truncating integer sqrt, first
 *     minimum wins);
 *  2. if that is the LAST point, take the one before it instead — a route has to
 *     keep a leg to walk (`0x40a2c0`);
 *  3. overwrite that point with the ACTOR'S OWN POSITION and drop everything
 *     before it (a `memmove` down over the head, and the count with it);
 *  4. re-measure every remaining leg from the geometry and re-total the header,
 *     because the first one is a new length nobody authored.
 *
 * Without it a resumed route restarts at its own first point, and since the
 * mover reads the position out of the route and not out of the actor, the actor
 * is simply somewhere else on the next pass. Both halves of #230 are that:
 *
 *  - `walktopuppet` stands the hacker in front of the camera for the
 *    conversation, so the `walkonpath (me, "resume", "hack1")` that follows it
 *    (gang.cst 0258 mousedown) threw him back to `hack2` — 4000-odd units up
 *    Scotland Road — before he set off;
 *  - interrupt the walk itself and the same call restarted the route from the
 *    top, so he re-walked the hallway he had already walked.
 *
 * Against an original where "Jack turns and begins walking after the
 * conversation, and resumes where he left off when interrupted".
 */
function resumeFrom(points: RoutePoint[], x: number, y: number, z: number): RoutePoint[] {
  let best = 0;
  let bestDist = Infinity;
  points.forEach((p, i) => {
    const d = isqrt((x - p.x) ** 2 + (y - p.y) ** 2 + (z - p.z) ** 2);
    if (bestDist > d) {
      bestDist = d;
      best = i;
    }
  });
  if (points.length - best === 1) best = points.length - 2;
  const rest = points.slice(best).map((p) => ({ ...p }));
  rest[0] = { x, y, z, fromPrev: 0 };
  for (let i = 1; i < rest.length; i++) {
    const p = rest[i];
    const q = rest[i - 1];
    p.fromPrev = isqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2);
  }
  return rest;
}

/**
 * Cast-actor (CST) commands: cast file open/close, the actor state
 * getters/setters (position, facing, pose, scale, owner, …), enumeration, and
 * the walking primitives (walktostar / walktoxyz / walkonpath).
 */
export function registerActorBuiltins(ctx: BuiltinCtx): void {
  const { session, r, log, findStar, sceneCell } = ctx;

  const actor = (name: Value) => session.actorRuntime.get(toStr(name));
  /** getter/setter by arity; a missing actor answers the empty value */
  const acc = accessorFamily(r, actor);
  r("opencastfile", async (_i, [n]) => ((await session.openCastFile(toStr(n ?? ""))) ? 1 : 0));
  r("closecastfile", (_i, [n]) => session.closeCastFile(toStr(n ?? "")));
  // ...or, on a v1 set, the scene's grid ROW — see BuiltinCtx.sceneCell
  r("actorexists", (_i, [n]) => sceneCell(n)?.[1] ?? (actor(n) ? 1 : 0));

  /**
   * The accost trace, asked for alongside #180 — "can you log when we get the
   * attention of a puppet, just to trace it?".
   *
   * `hasattention` is the only caller of `actordist` in the shipped corpus and
   * it asks only about the actor `curattention` names, so this is not a distance
   * readout: it is the accost clock starting and stopping. A character in view
   * is counting down towards stopping you; one out of view has just had their
   * count reset. Only CHANGES print — a claim held across a hundred idle passes
   * says nothing until the answer moves — so the pane shows the two moments that
   * matter and nothing between them.
   */
  const inView = new Map<string, boolean>();
  const sight = (n: Value, dist: number): number => {
    const who = toStr(n ?? "");
    const seen = dist !== 32000;
    if (who && inView.get(who) !== seen) {
      inView.set(who, seen);
      log(`sight: ${who} ${seen ? `in view (${dist})` : "out of view — attention clock reset"}`);
    }
    return dist;
  };
  /**
   * actordist(name): ground distance from the actor to the camera; 32000 when
   * the actor isn't present/visible (the sentinel scripts test, `if
   * actordist(target) = 32000`). Mirrors propdist for cast actors.
   *
   * **"Present" means DRAWN, not near** — see {@link ActorRuntime.onScreen} for
   * the gate and for #180, the report that showed the difference. The original
   * does not measure a distance at all: 0x40e790 runs the actor→screen
   * projection and reports the DEPTH it computed, or 32000 where it refused. We
   * keep the ground distance, because the magnitude has no consumer — the only
   * two callers in the whole corpus are `hasattention`, which compares it to
   * 32000 and nothing else, and a `message()` in boot's idle that prints it —
   * and a distance is the number a reader comparing it against `hotdist()`
   * wants. The refusals are what carry the behaviour, and those we follow.
   *
   * **A close-up counts as not present**, and that is the one line of this that
   * isn't geometry. `setVisible` false means the room is not being drawn at all —
   * a stage flat is over it (TAOOT: `cuff.stg`'s chair, `turbine.stg`'s plant,
   * a deck plan) — and the viewer already treats it that way: it passes no camera and no
   * occlusion to the sprite pass while it holds (SetViewer.draw). An actor the
   * camera is not looking at is exactly what the sentinel is for.
   *
   * Which matters because of the ONE caller in the corpus that tests it. gang.cst's
   * `hasattention(seconds)` is how a character accosts you unprompted, and its
   * first branch is `if actordist(target) = 32000 → attentionspan = frame()`:
   * out of sight restarts the clock rather than running it down. Without this,
   * every cast idle keeps counting while you are inside a close-up, and the
   * character walks up and starts a conversation OVER the flat — measured in
   * `recept1c`, where `maxidle` re-arms every 20 ticks and `hasattention(4)` came
   * due while `cuff.stg` was open, leaving the puppet on top of the chair and the
   * flat's own OK unreachable behind it (its script cannot run while the puppet
   * holds the dispatch). Headless the route was simply out of the flat inside
   * four seconds; a browser spends real ones, which is why it only ever showed
   * there — and is what had been read for a while as a dead OK button.
   *
   * A CONVERSATION counts too, and for the same reason — this is where the flat
   * case above was only half the rule. A puppet close-up replaces the world
   * display without touching `setVisible` (only a stage flat clears that), so the
   * cast's idles went on counting down while you were already talking to someone,
   * and `hasattention` came due and accosted you IN the conversation:
   * `sendtoactor(target, mousedown(0))` re-enters the character's mousedown, which
   * runs `walktopuppet` a second time and replays the whole exchange. Reported as
   * every console line arriving twice — `msg: vlad` twice from walktopuppet's own
   * first line, Morrow's ending saying each of its stage directions twice — and it
   * is audible as well as visible, because the second run's `puppetspeak` halts the
   * first's on the shared channel and cuts the line off mid-word.
   *
   * Vlad is the plain case: gang.cst 0960 opens him with `walktopuppet(20, …)`,
   * which unlike the `-1` path never `pauseloop`s the actor, so `vladidle` keeps
   * re-arming every 20 ticks and its `hasattention(4)` fires four seconds in.
   * Morrow's ending is the same shape (0442, `walktopuppet(0, …)`, `hasattention(4)`).
   * FOUR REAL SECONDS is why no headless test has ever seen this and a person
   * always does — the same reason the `cuff.stg` case above only ever showed in a
   * browser.
   *
   * The FLAT half is verified against TI.EXE (2026-08-07). The handler
   * (0x40e790) answers 0x7d00 = 32000 whenever the shared actor→screen
   * projection (0x411180) refuses, and its gates are: actorvisible ≤ 0, no set
   * open (0x489f58), the setvisible global zero (0x489f5a — its only writer in
   * .text is setvisible's own handler, 0x408821), a scene mismatch, or the
   * projection failing. TAOOT's BOOTFILE 0002 calls setvisible(false) for every
   * stage flat it opens over a set, so through a flat the original answers
   * 32000 through exactly this chain — and its accost machinery does run under
   * a flat (boot's idle() calls forceupdate() every pass, which is the loop
   * service), so the sentinel is what shields it there too.
   *
   * The PUPPET branch is ours; the original gets the same observable by
   * starvation. Its loop table is serviced only via forceupdate/visualeffect
   * (jmp 0x43e3ea / call 0x43df8f are the only entries into 0x442550), a
   * conversation holds the script dispatch, and puppetspeak's wait (0x43f840)
   * pumps ticks without servicing loops — so no idle ever runs to ask the
   * question. Our tick loop keeps running through a conversation, so the ask
   * happens here and must get the not-present answer. hasattention is the only
   * caller of actordist in the shipped corpus, so no script can tell the two
   * mechanisms apart.
   */
  r("actordist", (_i, [n]) => {
    const a = actor(n);
    const lis = session.listener();
    if (!a || !a.visible || !lis || !session.setVisible) return sight(n, 32000);
    if (session.puppet?.visible) return sight(n, 32000);
    // OUT OF VIEW IS OUT OF REACH (#180). The original never measures a distance
    // it could not draw: `actordist` answers 32000 whenever the actor→screen
    // projection refuses, and an empty intersection with the view rectangle is
    // one of the ways it refuses. See ActorRuntime.onScreen for the gates and
    // for what leaving this one out cost.
    const cam = session.activeCamera();
    if (cam && !session.actorRuntime.onScreen(a, cam)) return sight(n, 32000);
    // the GROUND pair is (worldX, worldY) — worldZ is the height (see propxyz,
    // and projectPoint, which takes it as the third argument). Measuring across
    // x and the HEIGHT put Cashmore 4101 from a standpoint she stands 4896 from,
    // which is the wrong side of `hotdist("stair1c1")` = 4000.
    return sight(n, Math.round(Math.hypot(a.worldX - lis.x, a.worldY - lis.y)));
  });
  // actorinstance(src, dst): spawn a new actor sharing src's cast sprite;
  // actordelete(name): remove one. TAOOT's gang cast fills its lifeboat crowd with
  // dozens of actorinstance("life1", "lifeN") calls, then places each.
  r("actorinstance", (_i, [src, dst]) => {
    const from = toStr(src ?? "");
    const to = toStr(dst ?? "");
    // no-op when `to` is already someone: the copy must not take over a live
    // actor's script, and actorinstance itself leaves an existing one alone
    if (!to || session.actorRuntime.get(to)) return;
    session.actorRuntime.instance(from, to);
    if (session.actorRuntime.get(to)) session.instanceCastScript(from, to);
  });
  r("actordelete", (_i, [n]) => {
    const name = toStr(n ?? "");
    session.actorRuntime.remove(name);
    // a COPY's script goes with it; a cast member keeps its own, which is what
    // lets TAOOT's stokers put themselves back (see dropInstancedScript)
    session.dropInstancedScript(name);
  });
  /**
   * Take a character off the screen — and with them, any claim they had on your
   * attention.
   *
   * In TAOOT's gang.cst, `curattention` is "who is waiting for you to notice
   * them", and `attentionspan` the frame it started. `hasattention(seconds)` accosts you
   * once `frame() - attentionspan` passes the threshold; the only thing that
   * ever drops the claim is `clearattention()`, which the character's OWN idle
   * loop calls when you step out of `hotdist()`.
   *
   * The boot library's `putdownactor` (bootfile container 2) is three lines:
   *
   *     actorvisible (target, false)
   *     stoploop ("actor", target)
   *     stopwalk (target)
   *
   * so leaving a room stops the very loop that would clear the claim, one line
   * after this one. Nothing can call `clearattention()` for that character
   * again — and `frame()` keeps climbing while you are away, so the moment the
   * room re-opens and their idle re-arms, `hasattention` sees an elapsed of
   * hundreds of frames against a threshold of eighty and they accost you on the
   * doorstep, every single time you come back. Trout on the second-class
   * staircase is the visible case: `hotdist("stair2c")` is 3000 and every
   * standpoint in the room is inside it (1154–2854 measured), so his far branch
   * never runs there and `clearattention()` has no other chance either.
   *
   * Dropping the claim here is not inventing behaviour: it is holding the
   * invariant `clearattention()` exists to hold, at the one moment the data
   * hands the engine responsibility for it. (TI.EXE never bulk-clears the loop
   * table — all nine references to it at 0x48bcd0 are add/remove-by-name/find/
   * count/service — so the stop really is the end of that loop, not a room
   * teardown we could undo.)
   */
  const dropAttention = (name: string): void => {
    const who = name.toLowerCase();
    if (!who) return;
    if (String(session.interp.globals.get("curattention") ?? "").toLowerCase() === who) {
      session.interp.setGlobal("curattention", "");
    }
  };
  // ...and watch it, so the log says who has claimed you and when they let go.
  // The engine knows this name already — everything above is about holding
  // `clearattention()`'s invariant — and #180 is a report about a claim nobody
  // could see being made. Paired with the `sight:` lines, the two questions a
  // reader has ("who wants me?", "can they see me?") are both on the pane.
  session.interp.watchGlobals.add("curattention");
  acc("actorvisible", 0, (a) => (a.visible ? 1 : 0), (a, v, n) => {
    a.visible = truthy(v);
    if (!a.visible) dropAttention(toStr(n));
  });
  r("actorhide", (_i, [n]) => {
    const a = actor(n);
    if (!a) return;
    a.visible = false;
    dropAttention(toStr(n));
  });
  // actorset binds an actor to a set; it only draws there (like propset)
  acc("actorset", "", (a) => a.setName, (a, v) => {
    a.setName = toStr(v).toLowerCase();
  });
  r("actorxyz", (_i, [n, x, y, z]) => {
    const a = actor(n);
    if (!a) return 0;
    if (x === undefined) return 0;
    // getter form actorxyz(name, axis): axis 1..3 like starxyz, 4 = packed
    if (y === undefined) {
      switch (toNum(x)) {
        case 1: return a.worldX;
        case 2: return a.worldY;
        case 3: return a.worldZ;
        case 4: return packPoint(a.worldX, a.worldY);
        default: return 0;
      }
    }
    a.worldX = toNum(x);
    a.worldY = toNum(y);
    a.worldZ = toNum(z ?? 0);
    // an explicit placement settles the question, so a star that never resolved
    // must not be allowed to overrule it later (ActorRuntime.settleStars)
    a.starPending = false;
  });
  // place an actor on a named star point of the current set; the getter
  // form returns the star the actor was last placed on (endwalk checks
  // for "custom" placements)
  acc("actorstar", "", (a) => a.starName, (a, starName) => {
    // placing at a real star teleports the actor there; a value that isn't a
    // star (the "walkonpath"/"custom"/"resume" sentinels, or a packed point)
    // is just stored — the walk-resume logic reads these back
    const star = findStar(starName);
    if (star) {
      a.worldX = star.positionX;
      a.worldY = star.positionZ;
      a.worldZ = star.positionY;
      a.deg = star.rotation8 & 0xff;
    }
    a.starName = toStr(starName).toLowerCase();
    // A star this set has never heard of. Dust's are qualified by set
    // (`town.horse1`) and placed from the stage, so most calls name a room that
    // is not the open one; the position is applied when that room opens
    // (ActorRuntime.settleStars). Titanic never reaches this branch with a real
    // star name — only with the walk sentinels, and those match no star anywhere.
    a.starPending = !star && a.starName.includes(".");
  });
  acc("actordeg", 0, (a) => a.deg, (a, v) => {
    a.deg = toNum(v) & 0xff;
  });
  acc("actorpose", "", (a) => a.poseName, (a, v) => {
    a.poseName = toStr(v).toLowerCase();
    a.step = 0;
  });
  acc("actorscale", 0, (a) => a.scale, (a, v) => {
    a.scale = toNum(v);
  });
  acc("actorzclip", 0, (a) => a.zclip, (a, v) => {
    a.zclip = toNum(v);
  });
  acc("actorspeed", 0, (a) => a.speed, (a, v) => {
    a.speed = toNum(v);
  });
  acc("actorturn", 0, (a) => a.turn, (a, v) => {
    a.turn = toNum(v);
  });
  acc("actorvalue", 0, (a) => a.value, (a, v) => {
    a.value = v;
  });
  acc("actorowner", "", (a) => a.owner, (a, v) => {
    a.owner = v;
  });
  r("countactors", () => session.actorRuntime.actors.size);
  r("indextoactor", (_i, [idx]) => {
    return [...session.actorRuntime.actors.keys()][toNum(idx ?? 0) - 1] ?? "";
  });
  // countcasts()/indextocast(n): open cast files (1-based). TAOOT's CTL.STG lists them.
  r("countcasts", () => session.actorRuntime.casts.size);
  r("indextocast", (_i, [idx]) => [...session.actorRuntime.casts.keys()][toNum(idx ?? 0) - 1] ?? "");
  // walking: straight-line motion at the actor's per-set speed, walk pose
  // cycling, facing the direction of travel (session.startWalk)
  //
  // Every builder stamps TWO strings, and they are not the same one: the walk
  // record's destination (+0x3e, what the actor settles on when it lands, and
  // what walkdest() reports meanwhile) and a mid-walk sentinel in `actorstar`
  // (actor+0x70, saying what KIND of walk is running). A destination name is
  // never visible in `actorstar` while the actor is still moving.
  //
  //   builder     used by                 mid-walk actorstar   record +0x3e
  //   0x443ac0/1  walktostar              "defer"              the star name
  //   0x443ac0/3  walkonpath              "defer"              the "to" star
  //   0x4436d0    walktoxyz               "walktoxyz"          "custom"
  //   0x4435c0    walktostar (track)      "walktostar"         —
  //   0x4437f0    walkonpath (track)      "walkonpath"         —
  //
  // The last two are the track-following walkers, chosen only when the set has
  // a path network to follow. We walk in straight lines and have no track, so
  // 0x443ac0 is the builder we are — hence "defer" for both named walks.
  r("walktostar", (_i, [n, starName]) => {
    const star = findStar(starName);
    const a = actor(n);
    /**
     * A DESTINATION SPELLED OUT, which is how Dust moves anything that wanders.
     *
     * `walktostar` takes a star name — or, in DreamFactory 1, a point written as
     * one: the animals build it out of numbers and hand it over as a string.
     * EXTRA.CST's pig picks a spot in the next cell along, its chickens run at
     * you, its birds scatter:
     *
     *     x = scenexyz (name, 1) + (48 - random (96))
     *     y = scenexyz (name, 2) + (48 - random (96))
     *     moveactor (numtostring (x) @ "," @ numtostring (y) @ ",0")
     *
     * and `moveactor` is `walktostar (me, where)`. Six call sites across three
     * scripts, every one built from `playerxyz`/`scenexyz` axes 1 and 2 — the same
     * triple `actorxyz` and `walktoxyz` take, in the same order. So it IS a
     * walktoxyz, and the port answered "not found" to all of it: the pig never
     * moved, and neither did the birds or the chickens.
     *
     * Only a string of numbers is read this way, so it cannot collide with a star
     * name in either engine (both are identifiers — no commas, no digits alone).
     */
    const point = toStr(starName ?? "").split(",");
    if (!star && a && point.length >= 2 && point.every((c) => /^-?\d+$/.test(c.trim()))) {
      a.starName = "walktoxyz"; // as walktoxyz does: "custom" lands on arrival
      session.scheduler.startWalk(
        toStr(n), Number(point[0]), Number(point[1]), Number(point[2] ?? 0), "custom",
      );
      return 0;
    }
    if (!a || !star) {
      log(`walktostar: ${toStr(n)} -> "${toStr(starName ?? "")}" not found`);
      return 0;
    }
    /**
     * On a v1 set, walk the authored route when the actor is standing on the
     * star this one is paired with — see {@link startPathWalk}.
     *
     * The lookup is the NAMED one, with the actor's own current star as the
     * `from`, so a route only applies between the two stars it was authored
     * between. `"resume"` would match on the destination alone and drag an actor
     * arriving from anywhere else onto the nearest point of a route it was never
     * on, which is a teleport rather than a walk.
     */
    if (
      session.currentBinding?.set.version === 1 &&
      a.starName &&
      startPathWalk(a, toStr(n), a.starName, toStr(starName).toLowerCase())
    ) {
      return 0;
    }
    a.starName = WALK_DEFER; // sentinel while moving; the name lands on arrival
    session.scheduler.startWalk(
      toStr(n), star.positionX, star.positionZ, star.positionY, toStr(starName).toLowerCase(),
    );
  });
  /**
   * walktoxyz(actor, x, y, z): walk to a point that is not a star — and land on
   * the `"custom"` sentinel, which is what tells a cast that the arrival was the
   * ENGINE's and not a scripted move to a named place.
   *
   * TI.EXE's record builder (0x4436d0) stores `"custom"` in the walk record at
   * +0x3e, and the arrival path copies that field into `actorstar` (0x443de3,
   * actor+0x70) immediately before it dispatches `endwalk()`. The star-walk
   * builder (0x443ac0) writes `"custom"` there too and only overwrites it with
   * the destination for its named-star modes — so "arrived somewhere nobody
   * named" is the default, and a name is the exception.
   *
   * The cast reads it constantly: `"custom"` is compared in 29 script files, and
   * every `endwalk` in the corpus opens with the same guard —
   *
   *     code endwalk ()
   *         actorpose (me, "stand")
   *         if actorstar (me) = "custom"
   *             exitcode
   *         endif
   *         … maxidle () / the decka patrol / vladidle ()
   *
   * so an engine-driven arrival is meant to run NO idle at all. Without the
   * sentinel that guard never fired: `walktopuppet` walks a character to you with
   * `moveactorxyz` -> `walktoxyz`, and their arrival re-armed the idle, which
   * called `hasattention`, which accosted you again inside the conversation you
   * were already having (#10/#19/#21).
   *
   * Mid-walk this one says `"walktoxyz"`, not `"defer"` — 0x4436d0 is its own
   * builder and stamps its own name. No script compares either string.
   */
  r("walktoxyz", (_i, [n, x, y, z]) => {
    const a = actor(n);
    if (!a) return 0;
    a.starName = "walktoxyz"; // sentinel while moving; "custom" lands on arrival
    session.scheduler.startWalk(toStr(n), toNum(x ?? 0), toNum(y ?? 0), toNum(z ?? 0), "custom");
  });
  /**
   * walkonpath(actor, fromStar|"resume", toStar): walk the AUTHORED ROUTE
   * between two stars, not the straight line between them.
   *
   * The route is in the SET, on the star record that pairs the two names — an
   * i16 container ref holding the polyline (engine/src/df/set.ts `StarPath`). Both of
   * TI.EXE's lookups walk that table and both skip a record whose ref is 0, so
   * an unpaired star never resolves:
   *
   *  - a named `from` matches the pair (`0x409fd0`), either way round — the
   *    record is reversed when `from` is the secondary;
   *  - `"resume"` matches on the DESTINATION alone (`0x40a0f0`), secondary first
   *    (walk forward) then primary (walk reversed). This is the form the two
   *    reported cases use — `walkonpath (me, "resume", "ga.2")` in gang.cst,
   *    where Georgia has just finished talking and is already at the far end.
   *
   * And `"resume"` is not just a laxer LOOKUP — it TRIMS the route it found to
   * where the actor is standing (`0x40a200`, called on the way out of that
   * lookup and only from it). See {@link resumeFrom}.
   *
   * With no route authored between the two, the straight line IS the answer: the
   * corpus has six paths and three of them are two points.
   */
  /**
   * Start an actor along the AUTHORED route between two stars, if there is one.
   *
   * Lifted out of `walkonpath` so `walktostar` can use it too, which is what a
   * DreamFactory 1 set needs: Dust never calls `walkonpath` — its cast library
   * moves everyone with `moveactor`, which is `walktostar` — and yet its sets
   * carry 34 authored routes, and `gang.cst` tests `actorstar (who) =
   * "walkonpath"` to find out whether the walk it is interrupting was on one. So
   * v1's `walktostar` is the walker that consults the table, and the sentinel it
   * leaves behind is the one that script reads. Reported from the page as actors
   * "walking directly to the destination point" instead of along a path.
   *
   * Answers true when a route was found and the walk started.
   */
  const startPathWalk = (
    a: ActorInstance, name: string, fromName: string, toName: string,
  ): boolean => {
    const set = session.currentBinding?.set;
    const named = fromName !== "resume";
    const rec = set?.starPaths.find((p) => {
      const pa = p.a.toLowerCase();
      const pb = p.b.toLowerCase();
      return named
        ? (pa === fromName && pb === toName) || (pb === fromName && pa === toName)
        : pa === toName || pb === toName;
    });
    if (rec && set) {
      // a star's (X, Z, Y) into the world triple a walk record uses: worldY is the
      // ground plane's second axis and worldZ the height, as walktostar builds it
      let points = readStarPath(set.file.containers, rec.container, set.version)
        .map((p) => ({ x: p.x, y: p.z, z: p.y, fromPrev: p.fromPrev }));
      // the polyline is stored a->b; walk it backwards when the destination is
      // the `a` end (TI.EXE's second match arm in both lookups)
      if (rec.a.toLowerCase() === toName) {
        points.reverse();
        // A point's `fromPrev` is the length of the leg BEHIND it, so reversing
        // the polyline has to carry each length one point along — the leg that
        // used to arrive at a point is the one that now leaves it. Reversing the
        // array alone pairs every leg with the wrong length: SCOT3's nine-point
        // route out of Scotland Road walked its 3983-unit hallway as though it
        // were 856 (4.65x too fast), its corners at 0.29x and 0.45x, and its
        // last leg to the door with a stored length of ZERO — the hacker
        // teleporting the final 752 units. Reported as "first too fast down the
        // hallway, then too slow in the corner, then too fast and too slow
        // reaching the door" (#224); the route's total came out 4678 against
        // the 8661 its own container header declares.
        for (let i = points.length - 1; i > 0; i--) points[i].fromPrev = points[i - 1].fromPrev;
        points[0].fromPrev = 0;
      }
      // "resume" begins where the actor IS, not where the route does
      if (!named && points.length >= 2) points = resumeFrom(points, a.worldX, a.worldY, a.worldZ);
      if (points.length >= 2) {
        a.starName = WALK_ON_PATH; // the kind of walk, until the arrival names the star
        session.scheduler.startWalkPath(name, points, toName);
        return true;
      }
    }
    return false;
  };

  r("walkonpath", (_i, [n, from, to]) => {
    const a = actor(n);
    if (!a) return 0;
    const toName = toStr(to ?? "").toLowerCase();
    const fromName = toStr(from ?? "").toLowerCase();
    const dest = findStar(to);
    if (!dest) {
      log(`walkonpath: star "${toStr(to ?? "")}" not found`);
      return 0;
    }
    if (startPathWalk(a, toStr(n), fromName, toName)) return 0;
    a.starName = WALK_DEFER; // sentinel while moving; the name lands on arrival
    if (fromName !== "resume") {
      const start = findStar(from);
      if (start) {
        a.worldX = start.positionX;
        a.worldY = start.positionZ;
        a.worldZ = start.positionY;
      }
    }
    session.scheduler.startWalk(
      toStr(n), dest.positionX, dest.positionZ, dest.positionY, toName,
    );
  });
  r("iswalk", (_i, [n]) => (n !== undefined && session.scheduler.isWalk(toStr(n)) ? 1 : 0));
  r("stopwalk", (_i, [n]) => {
    if (n !== undefined) session.scheduler.stopWalk(toStr(n));
  });
  r("pausewalk", (_i, [n, flag]) => {
    if (n !== undefined) session.scheduler.pauseWalk(toStr(n), truthy(flag ?? 1));
  });
  r("countwalks", () => session.scheduler.walks.size);
  r("indextowalk", (_i, [idx]) => [...session.scheduler.walks.keys()][toNum(idx ?? 0) - 1] ?? "");
  /**
   * walkdest(actor): where a running walk is HEADED, by name — the walk record's
   * +0x3e, the same field the arrival copies into `actorstar`. Not a position.
   *
   * TI.EXE's handler (0x4428e0) scans the 16-entry walk table at 0x48b150
   * (stride 0x6e) for the record whose +0x2e matches the actor, and returns its
   * +0x3e as a string; with no walk running it returns `"None"`.
   *
   * This is how a character resumes a patrol you interrupted. GANG.CST's
   * `walktopuppet` is the only caller in the corpus:
   *
   *     if iswalk (who)
   *         savestar = walkdest (who)          ← "max.2"
   *         …
   *     sendtoactor (who, moveactorstar (savestar))   → walktostar (me, savestar)
   *
   * so the value has to be something `walktostar` can resolve. We used to return
   * a packed (x<<16)|y point here, which came back as the star name `"529465746"`
   * and resolved to nothing — every walking character on every deck stood still
   * for the rest of the set once you had talked to them (#41).
   */
  r("walkdest", (_i, [n]) => {
    const w = session.scheduler.walks.get(toStr(n ?? "").toLowerCase());
    return w ? (w.arriveStar ?? "custom") : "None";
  });

  // turntodeg(name, deg): turn an actor to face a bearing (0..255) over time,
  // which in this engine is a WALK that goes nowhere — see Scheduler.startTurn for
  // why that matters to every conversation that opens with someone turning round.
  // Grouped with the actor commands though the TAOOT corpus calls it near the
  // geometry helpers.
  r("turntodeg", (_i, [n, deg]) => {
    const a = actor(n);
    if (a) session.scheduler.startTurn(toStr(n), toNum(deg ?? 0));
  });
}
