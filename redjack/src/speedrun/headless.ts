/**
 * RedJack played with no page: the host and where an input goes, for both
 * headless runs of a sheet — `npm run speedrun -w redjack`
 * (tests/speedrun/headless.ts, over the discs on this machine) and the
 * workbench's Calculate (./calc-worker.ts, over the site's files).
 *
 * The page's input handlers (src/main.ts, through
 * engine/src/web/shell-input.ts) with the page taken out. They go to the
 * DIRECTOR, because a DreamFactory 5 room is no set viewer: a mouse press is
 * `buttonDown`, a release `buttonUp` where it was let go, a move sets the
 * pointer and hovers, a key goes to `keyDown` as `keyAction` names it, and an
 * arrow coming up goes to `keyUp`. Keep the two in step — a press routed
 * differently here is a different game.
 */
import { GameHost, type HostFiles } from "@dreamfactory/engine/web/host";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import type { CalcGame } from "@dreamfactory/speedrun/calc-worker";
import type { InputEvent } from "@dreamfactory/speedrun/headless";
import { REDJACK } from "@dreamfactory/chrome/games";
import { arrowUp, heldKeys, keyAction } from "../input";

/** a fresh host over `files`, not booted, that draws no pictures */
export function headlessHost(files: HostFiles, log: (line: string) => void = () => {}): GameHost {
  const host = new GameHost(files, new NullAudioSink(), { log }, { screen: REDJACK.screen });
  host.session.onLog = log;
  // nobody looks at a film's pixels or the room's, as in the machine suites
  // (session.drawsPictures): a whole run is the same frame for frame
  // without them, and they were half its time
  host.session.drawsPictures = false;
  return host;
}

/** a key event as `keyAction` and `heldKeys` read one: `code` from the driver's own spelling */
const codeOf = (key: string): string => {
  if (key === " ") return "Space";
  if (key.length === 1) return `Key${key.toUpperCase()}`;
  return key; // ArrowLeft, Escape and the rest are their own code
};

function deliver(host: GameHost, e: InputEvent): void {
  const session = host.session;
  const director = host.director;
  const x = Math.floor(e.clientX ?? 0);
  const y = Math.floor(e.clientY ?? 0);
  switch (e.type) {
    case "pointerdown":
      // shell-input's mouse press and main.ts's `click`: the left button
      session.setPointer(x, y);
      void director.buttonDown(x, y, { button: 1 });
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
      const key = e.key ?? "";
      for (const vk of heldKeys(codeOf(key))) session.keysDown.add(vk);
      if (key === " ") session.spaceDown = true;
      const act = keyAction({ key, ctrlKey: false, metaKey: false, altKey: false, target: null });
      if (!act || !("key" in act)) return;
      // shell-input's sendKey: a gesture is never a held key
      session.interp.globals.set("isrepeat", session.interp.bool(false));
      void director.keyDown(act.key, act.special);
      return;
    }
    case "keyup": {
      const key = e.key ?? "";
      if (key === " ") session.spaceDown = false;
      for (const vk of heldKeys(codeOf(key))) session.keysDown.delete(vk);
      const arrow = arrowUp({ key, target: null });
      if (arrow) void director.keyUp(arrow);
      return;
    }
    default:
      return;
  }
}

/** a headless RedJack over the host `makeHost` builds */
export function headlessGame(makeHost: () => Promise<GameHost>): CalcGame {
  return {
    game: "redjack",
    makeHost,
    deliver,
    // a v5 room is no set viewer, so never a viewer (speedrun/src/driver.ts ROOMLESS)
    roomless: true,
    // and the room is the director's to composite, as the page's loop does
    paints: true,
  };
}
