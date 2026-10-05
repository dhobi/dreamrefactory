/**
 * Where a pointer or key event goes on Titanic's page, for a sheet played with
 * no page at all (#509, engine/src/web/speedrun/headless.ts).
 *
 * The play page's own handlers (taoot/src/main.ts) with the page taken out: the
 * touch recogniser, the input log, the gamma and pane keys. Keep the two in step
 * — a press routed differently here is a different game.
 */
import type { GameHost } from "@dreamfactory/engine/web/host";
import type { InputEvent } from "@dreamfactory/engine/web/speedrun/headless";
import { overlayKey } from "../play-rules";

/**
 * taoot/src/main.ts's input handlers, minus the page: a press goes to the
 * director, a release ends a drag where the pointer last was, a move tracks the
 * pointer mid-drag and hovers otherwise, and a key is routed as the keydown
 * handler routes it.
 */
export function deliverInput(host: GameHost, e: InputEvent): void {
  const session = host.session;
  const x = Math.floor(e.clientX ?? 0);
  const y = Math.floor(e.clientY ?? 0);
  const toGame = (name: string, special = false): void =>
    void session.track(host.director.keyDown(name, special));
  const arrow = (name: "uparrow" | "leftarrow" | "rightarrow"): void => {
    const v = host.viewer;
    if (!v) return;
    if (!session.viewShowing && session.stageCtrl.keydownTarget()) void session.track(v.keyDown(name, false));
    else void session.track(v.pressNav(name));
  };
  switch (e.type) {
    case "pointerdown":
      session.setPointer(x, y);
      session.pointerDown = true;
      session.shiftDown = !!e.shiftKey;
      void session.track(host.director.press(x, y), `press ${x},${y}`);
      return;
    case "pointerup":
      session.pointerDown = false;
      host.director.release(session.pointerX, session.pointerY);
      return;
    case "mousemove":
      if (session.pointerDown) session.setPointer(x, y);
      else void host.director.hover(x, y);
      return;
    case "keydown": {
      const key = e.key ?? "";
      if (!session.viewShowing && session.stageCtrl.keydownTarget()) {
        const df = overlayKey(key);
        if (df) toGame(df, key === "Escape");
        return;
      }
      if (key === "ArrowRight") arrow("rightarrow");
      else if (key === "ArrowLeft") arrow("leftarrow");
      else if (key === "ArrowUp") arrow("uparrow");
      else if (key === "ArrowDown") toGame("downarrow");
      else if (key === "Escape") toGame(".", true);
      else if (key.length === 1) toGame(key.toLowerCase());
      return;
    }
    default:
      // pointermove is the page's touch recogniser; keyup is nobody's
      return;
  }
}
