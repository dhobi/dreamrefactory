import { Value, toNum, toStr, truthy } from "../interp";
import { BuiltinCtx } from "./context";

/**
 * Cast-actor (CST) commands: cast file open/close, the actor state
 * getters/setters (position, facing, pose, scale, owner, …), enumeration, and
 * the walking primitives (walktostar / walktoxyz / walkonpath).
 */
export function registerActorBuiltins(ctx: BuiltinCtx): void {
  const { session, r, log, findStar } = ctx;

  const actor = (name: Value) => session.actorRuntime.get(toStr(name));
  r("opencastfile", async (_i, [n]) => ((await session.openCastFile(toStr(n ?? ""))) ? 1 : 0));
  r("closecastfile", (_i, [n]) => session.closeCastFile(toStr(n ?? "")));
  r("actorexists", (_i, [n]) => (actor(n) ? 1 : 0));
  r("actorvisible", (_i, [n, v]) => {
    const a = actor(n);
    if (!a) return 0;
    if (v === undefined) return a.visible ? 1 : 0;
    a.visible = truthy(v);
  });
  r("actorhide", (_i, [n]) => {
    const a = actor(n);
    if (a) a.visible = false;
  });
  // actorset binds an actor to a set; it only draws there (like propset)
  r("actorset", (_i, [n, v]) => {
    const a = actor(n);
    if (!a) return "";
    if (v === undefined) return a.setName;
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
        case 4: return ((a.worldX & 0xffff) << 16) | (a.worldY & 0xffff);
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
  r("actorstar", (_i, [n, starName]) => {
    const a = actor(n);
    if (!a) return "";
    if (starName === undefined) return a.starName;
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
  r("actordeg", (_i, [n, v]) => {
    const a = actor(n);
    if (!a) return 0;
    if (v === undefined) return a.deg;
    a.deg = toNum(v) & 0xff;
  });
  r("actorpose", (_i, [n, v]) => {
    const a = actor(n);
    if (!a) return "";
    if (v === undefined) return a.poseName;
    a.poseName = toStr(v).toLowerCase();
    a.step = 0;
  });
  r("actorscale", (_i, [n, v]) => {
    const a = actor(n);
    if (!a) return 0;
    if (v === undefined) return a.scale;
    a.scale = toNum(v);
  });
  r("actorzclip", (_i, [n, v]) => {
    const a = actor(n);
    if (!a) return 0;
    if (v === undefined) return a.zclip;
    a.zclip = toNum(v);
  });
  r("actorspeed", (_i, [n, v]) => {
    const a = actor(n);
    if (!a) return 0;
    if (v === undefined) return a.speed;
    a.speed = toNum(v);
  });
  r("actorturn", (_i, [n, v]) => {
    const a = actor(n);
    if (!a) return 0;
    if (v === undefined) return a.turn;
    a.turn = toNum(v);
  });
  r("actorvalue", (_i, [n, v]) => {
    const a = actor(n);
    if (!a) return 0;
    if (v === undefined) return a.value;
    a.value = v;
  });
  r("actorowner", (_i, [n, v]) => {
    const a = actor(n);
    if (!a) return "";
    if (v === undefined) return a.owner;
    a.owner = v;
  });
  r("countactors", () => session.actorRuntime.actors.size);
  r("indextoactor", (_i, [idx]) => {
    return [...session.actorRuntime.actors.keys()][toNum(idx ?? 0) - 1] ?? "";
  });
  // walking: straight-line motion at the actor's per-set speed, walk pose
  // cycling, facing the direction of travel (session.startWalk)
  r("walktostar", (_i, [n, starName]) => {
    const star = findStar(starName);
    if (!actor(n) || !star) {
      log(`walktostar: ${toStr(n)} -> "${toStr(starName ?? "")}" not found`);
      return 0;
    }
    session.startWalk(toStr(n), star.positionX, star.positionZ, star.positionY);
    const a = actor(n)!;
    a.starName = toStr(starName).toLowerCase();
  });
  r("walktoxyz", (_i, [n, x, y, z]) => {
    if (!actor(n)) return 0;
    session.startWalk(toStr(n), toNum(x ?? 0), toNum(y ?? 0), toNum(z ?? 0));
  });
  // walkonpath(actor, fromStar|"resume", toStar|point): walk from one star to
  // another. `from`="resume" keeps the current position; otherwise the actor
  // teleports to `from` first. `to` is a star name, or a packed point (the
  // value walkdest() returns — the talk-interrupt/resume path in GANG.CST
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
      tx = (((pt >> 16) & 0xffff) ^ 0x8000) - 0x8000;
      ty = ((pt & 0xffff) ^ 0x8000) - 0x8000;
      tz = a.worldZ;
      arriveStar = "walkonpath"; // no named destination; keep the sentinel
    } else {
      log(`walkonpath: star "${toStr(to ?? "")}" not found`);
      return 0;
    }
    a.starName = "walkonpath"; // sentinel while moving
    session.startWalk(toStr(n), tx, ty, tz, arriveStar);
  });
  r("iswalk", (_i, [n]) => (n !== undefined && session.isWalk(toStr(n)) ? 1 : 0));
  r("stopwalk", (_i, [n]) => {
    if (n !== undefined) session.stopWalk(toStr(n));
  });
  r("pausewalk", (_i, [n, flag]) => {
    if (n !== undefined) session.pauseWalk(toStr(n), truthy(flag ?? 1));
  });
  r("countwalks", () => session.walks.size);
  r("indextowalk", (_i, [idx]) => [...session.walks.keys()][toNum(idx ?? 0) - 1] ?? "");
  r("walkdest", (_i, [n]) => {
    const w = session.walks.get(toStr(n ?? "").toLowerCase());
    if (!w) return 0;
    return (((w.sx + w.dx) & 0xffff) << 16) | ((w.sy + w.dy) & 0xffff);
  });

  // turntodeg(name, deg): set an actor's facing (0..255). Grouped with the
  // actor commands though the corpus calls it near the geometry helpers.
  r("turntodeg", (_i, [n, deg]) => {
    const a = actor(n);
    if (a) a.deg = toNum(deg ?? 0) & 0xff;
  });
}
