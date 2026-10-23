/**
 * Timelapse played with no page: the host and where an input goes, for both
 * headless runs of a sheet — `npm run speedrun -w timelapse`
 * (tests/speedrun/headless.ts, over the discs on this machine) and the
 * workbench's Calculate (./calc-worker.ts, over the site's files).
 *
 * The page's input handlers (src/main.ts, through
 * engine/src/web/shell-input.ts) with the page taken out, and they go to the
 * DIRECTOR, because there is no room and so no viewer: a mouse press is
 * `buttonDown` (and the hover the page asks for once it has been dealt with), a
 * release is `buttonUp` where it was let go, a move hovers, and a key goes to
 * `keyDown` as `keyAction` names it. Keep the two in step — a press routed
 * differently here is a different game.
 */
import { GameHost, type HostFiles } from "@dreamfactory/engine/web/host";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import type { CalcGame } from "@dreamfactory/speedrun/calc-worker";
import type { InputEvent } from "@dreamfactory/speedrun/headless";
import { TIMELAPSE } from "@dreamfactory/chrome/games";
import { keyAction } from "../input";

/** a fresh host over `files`, not booted: this game's 640x480 screen and its prop anchor */
export function headlessHost(files: HostFiles, log: (line: string) => void = () => {}): GameHost {
  const host = new GameHost(files, new NullAudioSink(), { log }, { screen: TIMELAPSE.screen, propAnchor: TIMELAPSE.propAnchor });
  host.session.onLog = log;
  return host;
}

function deliver(host: GameHost, e: InputEvent): void {
  const session = host.session;
  const director = host.director;
  const x = Math.floor(e.clientX ?? 0);
  const y = Math.floor(e.clientY ?? 0);
  switch (e.type) {
    case "pointerdown":
      // shell-input's mouse press, and main.ts's `click`: the press, then the
      // hover it asks for once the click has been dealt with — a step later,
      // where the page's log line sits between the two
      session.setPointer(x, y);
      void director
        .buttonDown(x, y)
        .then(() => {})
        .then(() => director.hover(x, y));
      return;
    case "pointerup":
      if (!session.pointerDown) return;
      director.buttonUp(x, y);
      return;
    case "pointermove":
      session.setPointer(x, y);
      void director.hover(x, y);
      return;
    // the page listens for `pointermove` alone; the driver's `mousemove` twin
    // reaches no handler there, so it reaches none here
    case "keydown": {
      const act = keyAction({ key: e.key ?? "", ctrlKey: false, metaKey: false, target: null });
      if (!act || !("key" in act)) return;
      // shell-input's sendKey: a gesture is never a held key
      session.interp.globals.set("isrepeat", session.interp.bool(false));
      void director.keyDown(act.key, act.special);
      return;
    }
    default:
      return;
  }
}

/** a headless Timelapse over the host `makeHost` builds */
export function headlessGame(makeHost: () => Promise<GameHost>): CalcGame {
  return {
    game: "timelapse",
    makeHost,
    deliver,
    // no .SET on any disc, so never a viewer (speedrun/src/driver.ts ROOMLESS)
    roomless: true,
    // and so no room frame to capture a turn from: composite as the page does
    paints: true,
  };
}
