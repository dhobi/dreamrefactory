/**
 * Dust played with no page: the host and where an input goes, for both
 * headless runs of a sheet — `npm run speedrun -w dust`
 * (tests/speedrun/headless.ts, over the disc on this machine) and the
 * workbench's Calculate (./calc-worker.ts, over the site's files).
 *
 * The page's input handlers (src/main.ts) with the page taken out: a mouse
 * press goes to the viewer, a release ends it where the pointer last was, a
 * move hovers, and a key goes to the director as `keyAction` names it. Keep
 * the two in step — a press routed differently here is a different game.
 */
import { GameHost, type HostFiles } from "@dreamfactory/engine/web/host";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import type { CalcGame } from "@dreamfactory/speedrun/calc-worker";
import type { InputEvent } from "@dreamfactory/speedrun/headless";
import { keyAction } from "../input";

/** a fresh host over `files`, not booted */
export function headlessHost(files: HostFiles, log: (line: string) => void = () => {}): GameHost {
  const host = new GameHost(files, new NullAudioSink(), { log });
  // a save is a dump of the engine's own tables, and those are v1's here
  host.session.dfVersion = 1;
  return host;
}

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
      session.interp.globals.set("isrepeat", act.repeat);
      void session.track(host.director.keyDown(act.key, act.escape));
      return;
    }
    default:
      return;
  }
}

/** a headless Dust over the host `makeHost` builds */
export function headlessGame(makeHost: () => Promise<GameHost>): CalcGame {
  return { game: "dust", makeHost, deliver };
}
