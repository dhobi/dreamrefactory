import { Value, toNum, toStr, truthy } from "../interp";
import { accessorFamily, BuiltinCtx } from "./context";
import { packPoint, pointX, pointY } from "../point";

/**
 * Cast-actor (CST) commands: cast file open/close, the actor state
 * getters/setters (position, facing, pose, scale, owner, …), enumeration, and
 * the walking primitives (walktostar / walktoxyz / walkonpath).
 */
export function registerActorBuiltins(ctx: BuiltinCtx): void {
  const { session, r, log, findStar } = ctx;

  const actor = (name: Value) => session.actorRuntime.get(toStr(name));
  /** getter/setter by arity; a missing actor answers the empty value */
  const acc = accessorFamily(r, actor);
  r("opencastfile", async (_i, [n]) => ((await session.openCastFile(toStr(n ?? ""))) ? 1 : 0));
  r("closecastfile", (_i, [n]) => session.closeCastFile(toStr(n ?? "")));
  r("actorexists", (_i, [n]) => (actor(n) ? 1 : 0));
  /**
   * actordist(name): ground distance from the actor to the camera; 32000 when
   * the actor isn't present/visible (the sentinel scripts test, `if
   * actordist(target) = 32000`). Mirrors propdist for cast actors.
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
    if (!a || !a.visible || !lis || !session.setVisible) return 32000;
    if (session.puppet?.visible) return 32000;
    return Math.round(Math.hypot(a.worldX - lis.x, a.worldZ - lis.y));
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
      session.interp.globals.set("curattention", "");
    }
  };
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
  r("walktostar", (_i, [n, starName]) => {
    const star = findStar(starName);
    if (!actor(n) || !star) {
      log(`walktostar: ${toStr(n)} -> "${toStr(starName ?? "")}" not found`);
      return 0;
    }
    session.scheduler.startWalk(toStr(n), star.positionX, star.positionZ, star.positionY);
    const a = actor(n)!;
    a.starName = toStr(starName).toLowerCase();
  });
  r("walktoxyz", (_i, [n, x, y, z]) => {
    if (!actor(n)) return 0;
    session.scheduler.startWalk(toStr(n), toNum(x ?? 0), toNum(y ?? 0), toNum(z ?? 0));
  });
  // walkonpath(actor, fromStar|"resume", toStar|point): walk from one star to
  // another. `from`="resume" keeps the current position; otherwise the actor
  // teleports to `from` first. `to` is a star name, or a packed point (the
  // value walkdest() returns — the talk-interrupt/resume path in TAOOT's GANG.CST
  // saves the destination and resumes toward it). While walking, actorstar()
  // reports the sentinel "walkonpath" (how the resume logic detects a path
  // walk); on arrival it settles on the destination star.
  r("walkonpath", (_i, [n, from, to]) => {
    const a = actor(n);
    if (!a) return 0;
    if (toStr(from ?? "").toLowerCase() !== "resume") {
      const start = findStar(from);
      if (start) {
        a.worldX = start.positionX;
        a.worldY = start.positionZ;
        a.worldZ = start.positionY;
      }
    }
    const dest = findStar(to);
    let tx: number, ty: number, tz: number, arriveStar: string;
    if (dest) {
      tx = dest.positionX; ty = dest.positionZ; tz = dest.positionY;
      arriveStar = toStr(to).toLowerCase();
    } else if (to !== undefined && to !== "" && !isNaN(Number(to))) {
      const pt = toNum(to); // packed (x<<16)|y from walkdest(); z stays current
      tx = pointX(pt);
      ty = pointY(pt);
      tz = a.worldZ;
      arriveStar = "walkonpath"; // no named destination; keep the sentinel
    } else {
      log(`walkonpath: star "${toStr(to ?? "")}" not found`);
      return 0;
    }
    a.starName = "walkonpath"; // sentinel while moving
    session.scheduler.startWalk(toStr(n), tx, ty, tz, arriveStar);
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
  r("walkdest", (_i, [n]) => {
    const w = session.scheduler.walks.get(toStr(n ?? "").toLowerCase());
    if (!w) return 0;
    return packPoint(w.sx + w.dx, w.sy + w.dy);
  });

  // turntodeg(name, deg): set an actor's facing (0..255). Grouped with the
  // actor commands though the TAOOT corpus calls it near the geometry helpers.
  r("turntodeg", (_i, [n, deg]) => {
    const a = actor(n);
    if (a) a.deg = toNum(deg ?? 0) & 0xff;
  });
}
