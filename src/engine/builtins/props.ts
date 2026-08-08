import { Value, toNum, toStr, truthy } from "../interp";
import { degVariantFrames, frameIndexForDegree, playSequence } from "../props";
import { packPoint } from "../point";
import { accessorFamily, BuiltinCtx } from "./context";

/**
 * Prop (SHP "shop") commands: existence/visibility/state/placement getters and
 * setters, plus the set-star lookups (`starxyz`) and world-star placement
 * (`propstar`) that read the current set's named world points.
 */
export function registerPropBuiltins(ctx: BuiltinCtx): void {
  const { session, r, log, findStar } = ctx;

  // prop commands — getter/setter by arity
  const prop = (name: Value) => session.propRuntime.get(toStr(name));
  /** getter/setter by arity; a missing prop answers the empty value */
  const acc = accessorFamily(r, prop);
  r("propexists", (_i, [n]) => (prop(n) ? 1 : 0));
  // propis3d(name): whether a prop is a 3D world object rather than a 2D sprite.
  // The web build draws every prop as a screen-space overlay (see PropRuntime),
  // so none are 3D — return 0. (Kept explicit so it doesn't log as unknown.)
  r("propis3d", () => 0);
  // propdelete(name): permanently remove a prop from the set (e.g. clearing
  // TAOOT's greenhouse plants). Distinct from prophide, which only toggles visibility.
  r("propdelete", (_i, [n]) => session.propRuntime.remove(toStr(n ?? "")));
  acc("propvisible", 0, (p) => (p.visible ? 1 : 0), (p, v, n) => {
    p.visible = truthy(v);
    // TAOOT's clearmessagebox() wipes the drawstring text by flashing an opaque
    // "clean strip" prop over it (visible → forceupdate → invisible). Our
    // props are non-destructive, so instead we drop the text layer when that
    // eraser prop is shown.
    if (p.visible && toStr(n).toLowerCase() === "messageboxclear") session.clearTextOverlay();
  });
  acc("propview", "", (p) => p.stateName, (p, v) => {
    p.stateName = toStr(v).toLowerCase();
    p.lastTick = 0;
    const st = p.state();
    // A deg-selector prop holds its deg-matched frame instead of animating when
    // EITHER (a) propdeg picked a frame in THIS same event (TAOOT's `signs` idiom
    // `propdeg(dir); propview(dest)`, up to 10 directional variants), or (b) the
    // prop already carries the degVariants flag and this is a small (<=2) variant
    // state, or (c) — the fix — it is a 2-frame state that is NOT a real
    // animation (PropState.animated: a play-order permutation, e.g. the wireless
    // sender/breaker handles). Case (c) needs no prior propdeg, so the map/life/
    // navarrow "dark"/"light" mission(0)/tour(1) pair holds its normal (deg-0)
    // frame even on the load path, where initinterface's owned-item shortcut sets
    // the view WITHOUT a propdeg — the map used to auto-animate to frame 1 (the
    // tour icon). Real animations (3+ frame open/close swings, punch/dial
    // sequences) are untouched and still play via the else branch.
    const degPicked = p.degVariants && p.degEvent === session.interp.currentEvent;
    const twoFrameSelector = !!st && st.frames.length === 2 && !st.animated;
    if (st && ((p.degVariants && (degPicked || st.frames.length <= 2)) || twoFrameSelector)) {
      // a raw frame index into st.frames, so no variant map may be in the way
      p.frameOrder = null;
      p.frameIdx = frameIndexForDegree(st, Number(p.deg) || 0);
      p.frameLocked = true;
      p.animating = false;
    } else {
      p.frameIdx = 0;
      p.frameLocked = false;
      // A state can hold one animation PER DEGREE rather than one sequence —
      // TAOOT's map's 12-frame close is six normal frames and six for the guided tour.
      // Play only the variant this prop's deg selects; null for every ordinary
      // state, which then animates across all its frames exactly as before.
      p.frameOrder = st ? playSequence(st, degVariantFrames(st, Number(p.deg) || 0)) : null;
      // entering a state plays its frames once (a door opens and holds open); a
      // single-frame state has nothing to animate. A prop only made visible
      // (never propview'd) keeps animating=false and holds frame 0.
      p.animating = !!st && p.frameCount(st) > 1;
    }
  });
  r("propxy", (_i, [n, x, y]) => {
    const p = prop(n);
    if (!p || x === undefined) return 0;
    // getter: propxy(name, axis) — 1 = screen x, 2 = screen y. TAOOT's wireless
    // tuner reads the needle's y this way (its y position IS the frequency:
    // `propvalue("tunerneedle", propxy("tunerneedle", 2))`).
    if (y === undefined) return toNum(x) === 2 ? p.anchorY : p.anchorX;
    p.anchorX = Number(x) || 0;
    p.anchorY = Number(y) || 0;
    p.worldSpace = false; // screen placement (band/inventory/flat)
    return 0;
  });
  // world-space placement in a set (TAOOT: bag on the C73 bed, turkwater...) —
  // projection is still an open TI.EXE question, values stored for later.
  //
  // Getter/setter by arity, like every other prop command — and the GETTER is the
  // half that carries weight. `inven.shp`'s realdist() is
  // `calcdist(propxyz(propname, 4), playerxyz(4))`, and EVERY object lying in a
  // room is picked up through `if realdist(what) < hotdist()`. While this was
  // setter-only, that one-argument read fell through into the setter and moved the
  // prop it was asking about to (4, 0, 0) — so realdist answered from a corrupted
  // position and nothing in a room could ever be taken. Segment 23 found it on the
  // notebook at the top of the smokestack: the click ran, the phase advanced,
  // Zeitel walked over, and the notebook stayed on the platform.
  //
  // Axes are propstar's: worldX/worldY are the ground pair (star positionX and
  // positionZ) and worldZ the height, so axis 4 packs the same two coordinates
  // actorxyz and playerxyz do.
  r("propxyz", (_i, [n, x, y, z]) => {
    const p = prop(n);
    if (!p) return 0;
    if (x === undefined) return 0;
    if (y === undefined) {
      switch (toNum(x)) {
        case 1: return p.worldX;
        case 2: return p.worldY;
        case 3: return p.worldZ;
        case 4: return packPoint(p.worldX, p.worldY);
        default: return 0;
      }
    }
    p.worldSpace = true;
    p.worldX = toNum(x);
    p.worldY = toNum(y);
    p.worldZ = toNum(z ?? 0);
  });
  acc("propset", "", (p) => p.setName, (p, v) => {
    p.setName = toStr(v).toLowerCase();
  });
  acc("propscale", 0, (p) => p.scale, (p, v) => {
    p.scale = Number(v) || 0;
  });
  acc("propzclip", 0, (p) => p.zclip, (p, v) => {
    p.zclip = Number(v) || 0;
  });
  acc("propowner", "", (p) => p.owner, (p, v, n, frame) => {
    // `session.propTrace` is empty unless a test asked to witness this prop, and
    // the hook compares old against new itself — see GameSession.tracePropOwner
    // on why the formatting lives there and not in the harness.
    session.tracePropOwner(toStr(n ?? ""), toStr(p.owner ?? ""), toStr(v ?? ""), frame);
    p.owner = v;
  });
  // propinstance(src, dst): make dst a second prop drawn with src's sprite
  // group (TAOOT: the bridge's tiling sky, SMOKE's extra plants/flames) — it copies
  // src's current display state, then the script repositions it via propxy.
  r("propinstance", (_i, [src, dst]) => {
    session.propRuntime.instance(toStr(src ?? ""), toStr(dst ?? ""));
  });
  // propdeg selects a discrete frame of a rotational/selector prop (TAOOT's
  // deck map "buttons" highlight: 9 frames, deg 0..7 = deck 1..8, deg 8 = none).
  // The pinned frame overrides auto-animation until propview() changes state.
  acc("propdeg", 0, (p) => p.deg, (p, v) => {
    p.deg = v;
    // A world prop's propdeg is an ORIENTATION (0..255), not a frame index: the
    // frame is chosen at draw time from this facing vs. the camera bearing (a
    // 32-view card table, a 21-view fire). Clamping it as a frame index froze
    // TAOOT's blkjacktable/flames on their last frame. Screen-space props keep the
    // direct selector behaviour (deck-map deck highlight, boiler/turbine sliders).
    if (p.worldSpace) {
      p.directional = true;
      return;
    }
    // A selector prop's frames carry stored degrees (SHP +40) that are usually
    // offset from the frame index — TAOOT's blackjack score readout holds 2,3,…,21,
    // BUST=22, BLACKJACK=23, so propdeg(total) must pick the frame WHOSE DEGREE
    // is `total`, not the total-th frame (which read ~2 high). frameIndexForDegree
    // matches the degree; deck/valve selectors happen to store degree==index.
    p.degVariants = true; // its states are deg-indexed variants (see propview)
    // remember WHICH script event picked this frame, so a propview later in the
    // same event (the signs idiom: propdeg(dir) then propview(dest)) holds it
    // even for >2-frame states, while a stale propdeg from an earlier event does
    // not suppress a real animation. See PropInstance.degEvent.
    p.degEvent = session.interp.currentEvent;
    const st = p.state();
    if (st && st.frames.length) {
      // a raw index again, so drop any variant map the current state installed
      p.frameOrder = null;
      p.frameIdx = frameIndexForDegree(st, Number(v) || 0);
      p.frameLocked = true;
    }
  });
  // z-order: more negative = closer to the viewer (TAOOT: inventory items at
  // -11 draw over the UI band at -3)
  acc("propdist", 0, (p) => p.dist, (p, v) => {
    p.dist = Number(v) || 0;
  });
  // shop-scoped enumeration (me = the shop file inside its main script)
  const myShop = (frame: { ctx: { me: string } }) =>
    session.propRuntime.shops.get(frame.ctx.me.toLowerCase());
  r("countprops", (_i, _a, _c, frame) => myShop(frame)?.shp.groups.length ?? 0);
  r("indextoprop", (_i, [idx], _c, frame) => myShop(frame)?.shp.groups[Number(idx) - 1]?.name ?? "");
  r("error", (_i, args) => log(`script error(): ${args.map(String).join(", ")}`));
  acc("propvalue", 0, (p) => p.value, (p, v) => {
    p.value = v;
  });

  // starxyz(name, axis): named world point from the set's actor/star table.
  // Axes: 1 = x, 2 = y (ground plane, same pair the camera/crickets use),
  // 3 = height, 4 = packed (x << 16 | y).
  r("starxyz", (_i, [name, axis]) => {
    const star = findStar(name);
    if (!star) {
      log(`starxyz: no star "${toStr(name ?? "")}" in ${session.currentSetName}`);
      return 0;
    }
    switch (toNum(axis ?? 1)) {
      case 1: return star.positionX;
      case 2: return star.positionZ;
      case 3: return star.positionY;
      case 4: return ((star.positionX & 0xffff) << 16) | (star.positionZ & 0xffff);
      default: return 0;
    }
  });

  // propstar(name, star): place a prop at a named world point of the current
  // set — the world-space twin of propxyz. Set-decoration props (TAOOT: the
  // smoking-room card table, fireplace flames, cafe/bath tables, potted plants) use
  // it instead of raw coordinates. Without it these stayed screen-space overlays
  // pinned at the anchor centre, floating in the middle of every view. The star
  // table is the SET's actor table (findStar); rotation seeds the facing, which
  // a following propdeg() may override.
  acc("propstar", "", (p) => p.starName, (p, starName) => {
    const star = findStar(starName);
    if (star) {
      p.worldSpace = true;
      p.worldX = star.positionX;
      p.worldY = star.positionZ;
      p.worldZ = star.positionY;
      p.deg = star.rotation8 & 0xff;
    }
    p.starName = toStr(starName).toLowerCase();
  });
}
