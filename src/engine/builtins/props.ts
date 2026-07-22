import { Value, toNum, toStr, truthy } from "../interp";
import { frameIndexForDegree } from "../props";
import { BuiltinCtx } from "./context";

/**
 * Prop (SHP "shop") commands: existence/visibility/state/placement getters and
 * setters, plus the set-star lookups (`starxyz`) and world-star placement
 * (`propstar`) that read the current set's named world points.
 */
export function registerPropBuiltins(ctx: BuiltinCtx): void {
  const { session, r, log, findStar } = ctx;

  // prop commands — getter/setter by arity
  const prop = (name: Value) => session.propRuntime.get(toStr(name));
  r("propexists", (_i, [n]) => (prop(n) ? 1 : 0));
  r("propvisible", (_i, [n, v]) => {
    const p = prop(n);
    if (!p) return 0;
    if (v === undefined) return p.visible ? 1 : 0;
    p.visible = truthy(v);
    // clearmessagebox() wipes the drawstring text by flashing an opaque
    // "clean strip" prop over it (visible → forceupdate → invisible). Our
    // props are non-destructive, so instead we drop the text layer when that
    // eraser prop is shown.
    if (p.visible && toStr(n).toLowerCase() === "messageboxclear") session.clearTextOverlay();
  });
  r("propview", (_i, [n, v]) => {
    const p = prop(n);
    if (!p) return "";
    if (v === undefined) return p.stateName;
    p.stateName = toStr(v).toLowerCase();
    p.lastTick = 0;
    const st = p.state();
    // A deg-locked prop entering a small (<=2 frame) VARIANT state keeps its
    // selected variant instead of animating through the alternatives: the life
    // preserver / map / watch-lid "run" hold a mission (deg 0) + tour (deg 1)
    // pair, so auto-animating them ended every click on the last frame (tour).
    // Multi-frame states (open/close swings, 6-12 frames with repeating rotation
    // degrees) are real ANIMATIONS and still play — clearing frameLocked so the
    // tick advances them (this is what un-froze the watch/bag/map close).
    if (p.degVariants && st && st.frames.length <= 2) {
      p.frameIdx = frameIndexForDegree(st, Number(p.deg) || 0);
      p.frameLocked = true;
      p.animating = false;
    } else {
      p.frameIdx = 0;
      p.frameLocked = false;
      // entering a state plays its frames once (a door opens and holds open); a
      // single-frame state has nothing to animate. A prop only made visible
      // (never propview'd) keeps animating=false and holds frame 0.
      p.animating = !!st && st.frames.length > 1;
    }
  });
  r("propxy", (_i, [n, x, y]) => {
    const p = prop(n);
    if (!p || x === undefined) return 0;
    // getter: propxy(name, axis) — 1 = screen x, 2 = screen y. The wireless
    // tuner reads the needle's y this way (its y position IS the frequency:
    // `propvalue("tunerneedle", propxy("tunerneedle", 2))`).
    if (y === undefined) return toNum(x) === 2 ? p.anchorY : p.anchorX;
    p.anchorX = Number(x) || 0;
    p.anchorY = Number(y) || 0;
    p.worldSpace = false; // screen placement (band/inventory/flat)
    return 0;
  });
  // world-space placement in a set (bag on the C73 bed, turkwater...) —
  // projection is still an open TI.EXE question, values stored for later
  r("propxyz", (_i, [n, x, y, z]) => {
    const p = prop(n);
    if (!p) return 0;
    p.worldSpace = true;
    p.worldX = Number(x) || 0;
    p.worldY = Number(y) || 0;
    p.worldZ = Number(z) || 0;
  });
  r("propset", (_i, [n, v]) => {
    const p = prop(n);
    if (!p) return "";
    if (v === undefined) return p.setName;
    p.setName = toStr(v).toLowerCase();
  });
  r("propscale", (_i, [n, v]) => {
    const p = prop(n);
    if (!p) return 0;
    if (v === undefined) return p.scale;
    p.scale = Number(v) || 0;
  });
  r("propzclip", (_i, [n, v]) => {
    const p = prop(n);
    if (!p) return 0;
    if (v === undefined) return p.zclip;
    p.zclip = Number(v) || 0;
  });
  r("propowner", (_i, [n, v]) => {
    const p = prop(n);
    if (!p) return "";
    if (v === undefined) return p.owner;
    p.owner = v;
  });
  // propinstance(src, dst): make dst a second prop drawn with src's sprite
  // group (the bridge's tiling sky, SMOKE's extra plants/flames) — it copies
  // src's current display state, then the script repositions it via propxy.
  r("propinstance", (_i, [src, dst]) => {
    session.propRuntime.instance(toStr(src ?? ""), toStr(dst ?? ""));
  });
  // propdeg selects a discrete frame of a rotational/selector prop (the deck
  // map's "buttons" highlight: 9 frames, deg 0..7 = deck 1..8, deg 8 = none).
  // The pinned frame overrides auto-animation until propview() changes state.
  r("propdeg", (_i, [n, v]) => {
    const p = prop(n);
    if (!p) return 0;
    if (v === undefined) return p.deg;
    p.deg = v;
    // A world prop's propdeg is an ORIENTATION (0..255), not a frame index: the
    // frame is chosen at draw time from this facing vs. the camera bearing (a
    // 32-view card table, a 21-view fire). Clamping it as a frame index froze
    // blkjacktable/flames on their last frame. Screen-space props keep the
    // direct selector behaviour (deck-map deck highlight, boiler/turbine sliders).
    if (p.worldSpace) {
      p.directional = true;
      return;
    }
    // A selector prop's frames carry stored degrees (SHP +40) that are usually
    // offset from the frame index — the blackjack score readout holds 2,3,…,21,
    // BUST=22, BLACKJACK=23, so propdeg(total) must pick the frame WHOSE DEGREE
    // is `total`, not the total-th frame (which read ~2 high). frameIndexForDegree
    // matches the degree; deck/valve selectors happen to store degree==index.
    p.degVariants = true; // its states are deg-indexed variants (see propview)
    const st = p.state();
    if (st && st.frames.length) {
      p.frameIdx = frameIndexForDegree(st, Number(v) || 0);
      p.frameLocked = true;
    }
  });
  // z-order: more negative = closer to the viewer (inventory items at -11
  // draw over the UI band at -3)
  r("propdist", (_i, [n, v]) => {
    const p = prop(n);
    if (!p) return 0;
    if (v === undefined) return p.dist;
    p.dist = Number(v) || 0;
  });
  // shop-scoped enumeration (me = the shop file inside its main script)
  const myShop = (frame: { ctx: { me: string } }) =>
    session.propRuntime.shops.get(frame.ctx.me.toLowerCase());
  r("countprops", (_i, _a, _c, frame) => myShop(frame)?.shp.groups.length ?? 0);
  r("indextoprop", (_i, [idx], _c, frame) => myShop(frame)?.shp.groups[Number(idx) - 1]?.name ?? "");
  r("error", (_i, args) => log(`script error(): ${args.map(String).join(", ")}`));
  r("propvalue", (_i, [n, v]) => {
    const p = prop(n);
    if (!p) return 0;
    if (v === undefined) return p.value;
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
  // set — the world-space twin of propxyz. Set-decoration props (the smoking-
  // room card table, the fireplace flames, cafe/bath tables, potted plants) use
  // it instead of raw coordinates. Without it these stayed screen-space overlays
  // pinned at the anchor centre, floating in the middle of every view. The star
  // table is the SET's actor table (findStar); rotation seeds the facing, which
  // a following propdeg() may override.
  r("propstar", (_i, [n, starName]) => {
    const p = prop(n);
    if (!p) return "";
    if (starName === undefined) return p.starName;
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
