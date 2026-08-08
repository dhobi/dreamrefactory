import { toNum, toStr } from "../interp";
import { packPoint, pointX, pointY, s16 } from "../point";
import { decodeText } from "../../df/text";
import { BuiltinCtx } from "./context";

/**
 * Points + live pointer + persistent text. Points pack as (x<<16)|y with
 * signed 16-bit halves; stage/UI scripts hit-test clicks themselves by reading
 * mouse(), so the engine only exposes the live cursor, the packed-point
 * helpers, hit-testing, drawstring text, and the button/drag primitives.
 */
export function registerPointerBuiltins(ctx: BuiltinCtx): void {
  const { session, r } = ctx;

  r("makepoint", (_i, [x, y]) => packPoint(toNum(x ?? 0), toNum(y ?? 0)));
  r("pointx", (_i, [p]) => pointX(toNum(p ?? 0)));
  r("pointy", (_i, [p]) => pointY(toNum(p ?? 0)));
  r("mouse", () => session.pointerPoint());
  // hittest(point): identify what's under a screen point (an actor, a scene
  // hotspot, a flat region…) and stash its kind for result(). The inventory
  // "use an item" flow depends on this: TAOOT's trunk key dropped on the trunk
  // does `thename = hittest(arg); switch result() case "scene": sendtoscene(
  // thename, offerobject("trunkkey"))` → the trunk object's offerobject fires
  // transtoflat("trunk.stg"). Returns the object name ("" if nothing).
  r("hittest", (_i, [point]) => {
    const pt = toNum(point ?? 0);
    const hit = session.hitTestAt(pointX(pt), pointY(pt));
    session.lastResult = hit.type;
    return hit.name;
  });
  r("result", () => session.lastResult);
  // button(): is the mouse button held? Scripts wait for a click with an
  // empty-body poll `while not (button() & pointinprop(...)) endwhile` (TAOOT's
  // Enigma result dismissal), which has no other yield — so, like stilldown,
  // the poll gives up a real frame so input can arrive. Headless returns at
  // once (button state is set directly; keeps the runaway guard live).
  r("button", async () => {
    session.inputPolled();
    await ctx.yieldFrame();
    return session.pointerDown ? 1 : 0;
  });
  // flushevents(): discard queued input so the press that ended a drag or a poll
  // loop doesn't leak into the next interaction. 92 TAOOT call sites, and it was a
  // no-op here for as long as there was no queue behind it — harmless then,
  // load-bearing now: the trunk's play loop, the Enigma keys and the inventory
  // all end on a press whose replay they explicitly do not want.
  r("flushevents", () => session.events.flush());
  // mousedown(point): synthesise a click at a point. Only reached by scripts
  // that replay a press (TAOOT's wireless rx() ok-interrupt); return the point.
  r("mousedown", (_i, [p]) => toNum(p ?? 0));

  // drawstring(text, point, color, size): paint text at a screen point into
  // the persistent text layer (composited after props, cleared per flat).
  r("drawstring", (_i, [text, point, color, size]) => {
    // a script string literal, so localised (TAOOT: the wireless, the map labels
    // and CTL's readouts all come through here as raw bytes)
    const t = decodeText(toStr(text ?? ""), session.textEncoding());
    const pt = toNum(point ?? 0);
    const x = pointX(pt);
    const y = pointY(pt);
    const sz = toNum(size ?? 12);
    const col = toNum(color ?? 0);
    const ov = session.textOverlay;
    const i = ov.findIndex((e) => e.x === x && e.y === y && e.size === sz);
    const entry = { text: t, x, y, color: col, size: sz };
    if (i >= 0) ov[i] = entry;
    else ov.push(entry);
    return 0;
  });
  // stringwidth(text, color, size): pixel width for pen advance. Must match
  // what drawstring actually paints, so measure with the render font.
  r("stringwidth", (_i, [text, , size]) => {
    const t = decodeText(toStr(text ?? ""), session.textEncoding());
    const sz = toNum(size ?? 12);
    return session.measureText
      ? Math.round(session.measureText(t, sz))
      : Math.ceil(t.length * sz * 0.6);
  });
  // stilldown(): true while the mouse button is held. Drag loops spin on it
  // (`while stilldown() { propdeg(me, ...); forceupdate() }`), so each check
  // yields one frame — letting the rAF loop advance the clock, deliver the
  // next pointermove/pointerup, and repaint before the next iteration.
  r("stilldown", async () => {
    session.inputPolled();
    await session.clock.sleep(16);
    if (session.hasRealFrames) session.realYieldSeq++;
    return session.pointerDown ? 1 : 0;
  });
  // pointinbutton(flat, name, point): is `point` inside the flat's named
  // click-region? This is the stage "button" system (drop targets, OK, dials);
  // scripts pass currentflat() and either the click arg or mouse() as the point.
  r("pointinbutton", (_i, [flat, name, point]) => {
    const region = session.stageCtrl.flatRegion(toStr(flat ?? ""), toStr(name ?? ""));
    if (!region) return 0;
    const pt = toNum(point ?? 0);
    const x = pointX(pt), y = pointY(pt);
    return x >= region.left && x <= region.right && y >= region.top && y <= region.bottom ? 1 : 0;
  });
  // pointinprop(name, point): is `point` inside the prop's drawn screen rect?
  // (rect = anchor - frame offset, size = frame w/h — the same geometry as a
  // UI button prop.) Used for grabbing draggable props (crank, inventory bags).
  r("pointinprop", (_i, [n, point]) => {
    const p = session.propRuntime.get(toStr(n));
    const st = p?.state();
    if (!p || !st || !st.frames.length) return 0;
    const f = p.shop.frame(st.frames[Math.min(p.frameIdx, st.frames.length - 1)]);
    const x0 = p.anchorX - f.posXraw, y0 = p.anchorY - f.posYraw;
    const pt = toNum(point ?? 0);
    const x = pointX(pt), y = pointY(pt);
    return x >= x0 && x < x0 + f.width && y >= y0 && y < y0 + f.height ? 1 : 0;
  });
  // trackbut(bevel, x, y) is NOT a builtin: it is a BOOTFILE library code
  // TAOOT ships (0002), and every one of its ~50 call sites is a button region's
  // own mousedown doing `if trackbut(<bevel prop>, 256, 192)`. The shipped body
  // places the bevel at (x,y), shows it while the button is held, and answers
  // `pointinbutton(currentflat(), target, mouse())` — the flat's named click
  // REGION, not the bevel prop's sprite rect. That distinction is why the
  // builtin had to go: a bevel is usually smaller than (and offset from) the
  // region it lights, so the transcription answered a different rectangle. It
  // resolves through Interp.fallbackScripts, and needs `target` to be the
  // region being clicked — see StageController.sendToButton/stageClickAt.
}
