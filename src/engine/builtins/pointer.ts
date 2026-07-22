import { toNum, toStr } from "../interp";
import { BuiltinCtx } from "./context";

/**
 * Points + live pointer + persistent text. Points pack as (x<<16)|y with
 * signed 16-bit halves; stage/UI scripts hit-test clicks themselves by reading
 * mouse(), so the engine only exposes the live cursor, the packed-point
 * helpers, hit-testing, drawstring text, and the button/drag primitives.
 */
export function registerPointerBuiltins(ctx: BuiltinCtx): void {
  const { session, r } = ctx;

  const s16 = (v: number): number => ((v & 0xffff) ^ 0x8000) - 0x8000;
  r("makepoint", (_i, [x, y]) => ((toNum(x ?? 0) & 0xffff) << 16) | (toNum(y ?? 0) & 0xffff));
  r("pointx", (_i, [p]) => s16((toNum(p ?? 0) >> 16) & 0xffff));
  r("pointy", (_i, [p]) => s16(toNum(p ?? 0) & 0xffff));
  r("mouse", () => session.pointerPoint());
  // hittest(point): identify what's under a screen point (an actor, a scene
  // hotspot, a flat region…) and stash its kind for result(). The inventory
  // "use an item" flow depends on this: dropping the trunk key on the trunk
  // does `thename = hittest(arg); switch result() case "scene": sendtoscene(
  // thename, offerobject("trunkkey"))` → the trunk object's offerobject fires
  // transtoflat("trunk.stg"). Returns the object name ("" if nothing).
  r("hittest", (_i, [point]) => {
    const pt = toNum(point ?? 0);
    const hit = session.hitTestAt(s16((pt >> 16) & 0xffff), s16(pt & 0xffff));
    session.lastResult = hit.type;
    return hit.name;
  });
  r("result", () => session.lastResult);
  // button(): is the mouse button held? Scripts wait for a click with an
  // empty-body poll `while not (button() & pointinprop(...)) endwhile` (the
  // Enigma result dismissal), which has no other yield — so, like stilldown,
  // the poll gives up a real frame so input can arrive. Headless returns at
  // once (button state is set directly; keeps the runaway guard live).
  r("button", async () => {
    if (session.hasRealFrames) {
      session.realYieldSeq++;
      await session.nextFrame();
    }
    return session.pointerDown ? 1 : 0;
  });
  // flushevents(): discard queued input so the click that ended a drag/poll
  // loop doesn't leak into the next interaction. Our host dispatches clicks one
  // at a time (a mousedown handler runs to completion before the next click),
  // so there is no queue to drain — a no-op that keeps scripts happy.
  r("flushevents", () => {});
  // mousedown(point): synthesise a click at a point. Only reached by scripts
  // that replay a press (wireless rx()'s ok-interrupt); return the point.
  r("mousedown", (_i, [p]) => toNum(p ?? 0));

  // drawstring(text, point, color, size): paint text at a screen point into
  // the persistent text layer (composited after props, cleared per flat).
  r("drawstring", (_i, [text, point, color, size]) => {
    const t = toStr(text ?? "");
    const pt = toNum(point ?? 0);
    const x = s16((pt >> 16) & 0xffff);
    const y = s16(pt & 0xffff);
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
    const t = toStr(text ?? "");
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
    await session.clock.sleep(16);
    if (session.hasRealFrames) session.realYieldSeq++;
    return session.pointerDown ? 1 : 0;
  });
  // a "button" is a prop drawn at (x,y); its screen rect comes from the frame's
  // stored offset (rect = anchor - offset, size = frame w/h)
  const buttonRect = (name: string, x: number, y: number) => {
    const p = session.propRuntime.get(name);
    const st = p?.state();
    if (!p || !st || !st.frames.length) return null;
    const f = p.shop.frame(st.frames[Math.min(p.frameIdx, st.frames.length - 1)]);
    return { p, x0: x - f.posXraw, y0: y - f.posYraw, w: f.width, h: f.height };
  };
  const inButton = (name: string, x: number, y: number) => {
    const r0 = buttonRect(name, x, y);
    return !!r0 && session.pointerX >= r0.x0 && session.pointerX < r0.x0 + r0.w &&
      session.pointerY >= r0.y0 && session.pointerY < r0.y0 + r0.h;
  };
  // pointinbutton(flat, name, point): is `point` inside the flat's named
  // click-region? This is the stage "button" system (drop targets, OK, dials);
  // scripts pass currentflat() and either the click arg or mouse() as the point.
  r("pointinbutton", (_i, [flat, name, point]) => {
    const region = session.flatRegion(toStr(flat ?? ""), toStr(name ?? ""));
    if (!region) return 0;
    const pt = toNum(point ?? 0);
    const x = s16((pt >> 16) & 0xffff), y = s16(pt & 0xffff);
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
    const x = s16((pt >> 16) & 0xffff), y = s16(pt & 0xffff);
    return x >= x0 && x < x0 + f.width && y >= y0 && y < y0 + f.height ? 1 : 0;
  });
  // trackbut(name, x, y): a push-button. Called from a button's mousedown (so
  // the button is already pressed); tracks the hold (showing the prop as the
  // pressed highlight) and returns 1 iff released while still over it.
  r("trackbut", async (_i, [n, x, y]) => {
    const name = toStr(n ?? "");
    const ax = toNum(x ?? 256), ay = toNum(y ?? 192);
    const p = session.propRuntime.get(name);
    if (!p) return 0;
    p.anchorX = ax;
    p.anchorY = ay;
    p.worldSpace = false;
    const wasVisible = p.visible;
    let inside = inButton(name, ax, ay);
    while (session.pointerDown) {
      inside = inButton(name, ax, ay);
      p.visible = inside; // pressed highlight only while held over the button
      await session.clock.sleep(16);
    }
    p.visible = wasVisible;
    return inside ? 1 : 0;
  });
}
