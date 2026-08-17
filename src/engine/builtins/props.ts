import { Value, toNum, toStr, truthy } from "../interp";
import {
  degVariantFrames, frameIndexForDegree, isDegreeSelector, playSequence, type PropInstance,
} from "../props";
import { packPoint } from "../point";
import { accessorFamily, BuiltinCtx } from "./context";

/**
 * A prop moving into world space, and dropping the screen-space frame pin on the
 * way, because becoming a world prop changes what a frame MEANS: it stops being a
 * selector index and becomes a choice made at draw time, from the prop's facing
 * against the camera bearing. A pin from an earlier `propdeg` is stale.
 *
 * Reachable only since the boot library's default `initprop` became reachable: it
 * does `propdeg (target, 0)` on every prop at set open, and SMOKE's card table
 * takes its star AFTER that — so the table arrived already pinned to one of its 32
 * views and stopped turning with the camera.
 */
function becomeWorldProp(p: PropInstance): void {
  p.worldSpace = true;
  p.frameLocked = false;
  p.degVariants = false;
  p.frameOrder = null;
}

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
  // The getter answers the state the prop is actually IN, which for one no script
  // has touched is its FIRST state — the same one `PropInstance.state()` resolves
  // to and the engine draws. Answering "" there told scripts something the screen
  // disagreed with, and BOIL.STG's OK button is where that shows: it tidies the
  // boiler panel on the way out with
  //
  //     if propview ("boilgate") != "up"
  //         sendtoprop ("boilgate", up ())
  //     endif
  //
  // and `boilgate`'s first state IS "up" (BOIL.SHP), so the guard exists to do
  // nothing when the big door is already up. Reading "" made it true every time,
  // so leaving the panel played the big door's 13-frame raise for no reason (#15).
  acc("propview", "", (p) => p.stateName || (p.state()?.identifier.toLowerCase() ?? ""), (p, v) => {
    p.stateName = toStr(v).toLowerCase();
    p.lastTick = 0;
    const st = p.state();
    // A prop holds a deg-matched frame instead of animating in two cases, and only
    // one of them is a judgement call:
    //
    //  - the state is a SELECTOR — its frames are alternatives indexed by degree
    //    and there is no sequence to play (isDegreeSelector, which the draw path
    //    asks too). This is what keeps the map/life/navarrow "dark"/"light"
    //    mission(0)/tour(1) pair on its normal frame even on the load path, where
    //    initinterface's owned-item shortcut sets the view WITHOUT a propdeg — the
    //    map used to auto-animate to frame 1, the tour icon.
    //  - the state IS a variant animation (its degrees repeat) and propdeg chose
    //    the variant in THIS same event: TAOOT's `signs` idiom `propdeg(dir);
    //    propview(dest)`, up to 10 directional variants, wants the still frame.
    //
    // Real animations — 3+ frame open/close swings, punch and dial sequences —
    // are untouched and play through the else branch.
    //
    // ...and so is a state that holds ONE ANIMATION PER DEGREE (`variant`): the
    // deg names which sequence plays, so there is a sequence either way and
    // nothing to hold. Nothing that wants the still frame is caught by it —
    // `signs` stores one frame per direction and a 2-frame icon two, while a
    // variant split needs two or more GROUPS of two or more frames — and
    // without it the second card of a blackjack hand froze on its first
    // picture, the deal before it having set degVariants inside the same event
    // (#223).
    const variant = st ? degVariantFrames(st, Number(p.deg) || 0) : null;
    const degPicked = p.degVariants && p.degEvent === session.interp.currentEvent;
    if (st && (isDegreeSelector(st) || (p.degVariants && !variant && (degPicked || st.frames.length <= 2)))) {
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
      p.frameOrder = st ? playSequence(st, variant) : null;
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
    becomeWorldProp(p); // see propstar
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
    // ...unless the state being played is one ANIMATION PER DEGREE, in which
    // case the deg names the animation and not a frame of it. TI.EXE's propdeg
    // is a field write (prop record +0x18) and stops nothing; the frame pin
    // below is this port's way of drawing a selector, and a state that is
    // MID-SEQUENCE is the one case where it is plainly the wrong reading —
    // there is a sequence, the prop is playing it, and the answer to "which
    // frames" is the variant.
    //
    // BLKJACK.STG's `take` is the case that found it. It deals a card with
    //
    //     propview ("buick", "deal")
    //     if playingcards = "dust"  propdeg ("buick", 1)  else  propdeg ("buick", 0)
    //     for count = 1 to 19 / forceupdate () / endfor
    //     propview ("buick", "idle")
    //
    // and `deal` stores the hand-to-table swing twice — a clean deck (degrees
    // 0) and a dusty one (degrees 1), interleaved, with a play script written
    // in terms of the VARIANT (indices 0..4 against five frames each). Pinned
    // by the propdeg, Riveria held the first picture for all nineteen passes
    // and the card simply appeared on the table (#223).
    const variant = st && p.animating ? degVariantFrames(st, Number(v) || 0) : null;
    if (variant) {
      // swap the variant under the animation, mid-flight: every variant of a
      // state is the same length (degVariantFrames requires it) and the play
      // script maps through it, so frameIdx keeps its meaning
      p.frameOrder = playSequence(st!, variant);
      return;
    }
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
  // ONE prop table, whoever asks: `countprops` is `mov ecx, [0x489f18]`
  // (0x418660) and `indextoprop` bounds-checks that same dword before walking the
  // table at [0x489f14] in 158-byte records (0x418710). No calling shop enters
  // into it, and `countactors`/`indextoactor` are the byte-for-byte twins one
  // table over ([0x489f08], 0x410610) — which is why the actor half always worked
  // here and this one did not.
  //
  // Scoped to the CALLER's shop, every caller that is not itself a shop got 0:
  // inven.shp's `initprops` asking for its own 28 worked, and the BOOTFILE asking
  // walked nothing. That is both of `advanceday`'s reset loops — so a new game
  // after a bad ending inherited every ownership the finished one had, from the
  // items still in the bag to the painting still being Zeitel's (#89) — plus the
  // CTL console's `allprops`/`countallprops`.
  //
  // The insertion order of `props` is the order the shops opened, which is the
  // order TI.EXE appends them to its table.
  r("countprops", () => session.propRuntime.props.size);
  r("indextoprop", (_i, [idx]) =>
    [...session.propRuntime.props.values()][toNum(idx ?? 0) - 1]?.group.name ?? "");
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
      becomeWorldProp(p);
      p.worldX = star.positionX;
      p.worldY = star.positionZ;
      p.worldZ = star.positionY;
      p.deg = star.rotation8 & 0xff;
    }
    p.starName = toStr(starName).toLowerCase();
  });
}
