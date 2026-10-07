/**
 * A Dust sheet played with no page (the engine's headless driver,
 * engine/src/web/speedrun/headless.ts), for the verbs that need the real game
 * under them: `blackjack` (tests/speedrun/blackjack.ts).
 *
 * The page's input handlers (src/main.ts) with the page taken out: a mouse
 * press goes to the viewer, a release ends it where the pointer last was, a
 * move hovers, and a key goes to the director as `keyAction` names it. Keep
 * the two in step — a press routed differently here is a different game.
 *
 * Load points are kept in memory: a test puts the disc's own save in as one
 * and loads it, as `loadSave` would on the page.
 */
import type { GameHost } from "@dreamfactory/engine/web/host";
import { headlessRun as runHeadless, type HeadlessRun, type InputEvent } from "@dreamfactory/engine/web/speedrun/headless";
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import { keyAction } from "../../src/input";
import { dustHost } from "../playthrough/harness";

function deliver(host: GameHost, e: InputEvent): void {
  const session = host.session;
  const x = Math.floor(e.clientX ?? 0);
  const y = Math.floor(e.clientY ?? 0);
  switch (e.type) {
    case "pointerdown": {
      session.setPointer(x, y);
      const v = host.viewer;
      if (!v) return;
      session.pointerDown = true;
      session.shiftDown = !!e.shiftKey;
      void session.track(v.press(x, y), `press ${x},${y}`);
      return;
    }
    case "pointerup":
      if (!host.viewer) return;
      session.pointerDown = false;
      host.viewer.release(session.pointerX, session.pointerY);
      return;
    case "pointermove":
    case "mousemove":
      session.setPointer(x, y);
      if (host.viewer && !session.pointerDown) void host.viewer.hover(x, y);
      return;
    case "keydown": {
      const act = keyAction({ key: e.key ?? "", ctrlKey: false, metaKey: false, altKey: false, repeat: false, target: null });
      if (!act || "log" in act) return;
      session.interp.globals.set("isrepeat", act.repeat ? 1 : 0);
      void session.track(host.director.keyDown(act.key, act.escape));
      return;
    }
    default:
      return;
  }
}

export async function headlessRun(opts: {
  prepare?: (session: GameSession) => void;
  seed: number | null;
  log?: (message: string) => void;
}): Promise<HeadlessRun> {
  const saves = new Map<string, Uint8Array>();
  return runHeadless({
    game: "dust",
    makeHost: async () => dustHost().host,
    prepare: (s) => opts.prepare?.(s),
    deliver,
    putSave: async (name, bytes) => {
      saves.set(name, bytes);
    },
    getSave: async (name) => saves.get(name) ?? null,
    seed: opts.seed,
    log: opts.log,
  });
}
