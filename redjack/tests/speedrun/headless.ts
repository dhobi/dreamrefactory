/**
 * A RedJack sheet played with no page (the engine's headless driver,
 * speedrun/src/headless.ts) — what `npm run speedrun -w redjack` runs.
 *
 * The host is the machine harness's file store (tests/machine/harness.ts
 * `discFiles`): the three discs, a name served off the disc the game says it is
 * on. What this file adds is the page's input handlers (src/main.ts, through
 * engine/src/web/shell-input.ts) with the page taken out. They go to the
 * DIRECTOR, because a DreamFactory 5 room is no set viewer: a mouse press is
 * `buttonDown`, a release `buttonUp` where it was let go, a move sets the
 * pointer and hovers, a key goes to `keyDown` as `keyAction` names it, and an
 * arrow coming up goes to `keyUp`. Keep the two in step — a press routed
 * differently here is a different game.
 *
 * Load points are kept in memory unless the caller says where.
 */
import { GameHost } from "@dreamfactory/engine/web/host";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import { headlessRun as runHeadless, type HeadlessRun, type InputEvent } from "@dreamfactory/speedrun/headless";
import { REDJACK } from "../../../chrome/src/games";
import { arrowUp, heldKeys, keyAction } from "../../src/input";
import { discFiles } from "../machine/harness";

/** a fresh host over the discs, not booted — the harness's, minus its pump */
export function redjackHost(log: (line: string) => void = () => {}): GameHost {
  const host = new GameHost(discFiles(), new NullAudioSink(), { log }, { screen: REDJACK.screen });
  host.session.onLog = log;
  return host;
}

/** a key event as `keyAction` and `heldKeys` read one: `code` from the driver's own spelling */
const codeOf = (key: string): string => (key === " " ? "Space" : key.startsWith("Arrow") || key === "Escape" ? key : key.length === 1 ? `Key${key.toUpperCase()}` : key);

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

export async function headlessRun(opts: {
  prepare?: (session: GameSession) => void;
  seed: number | null;
  log?: (message: string) => void;
  /** where `save()` puts a checkpoint and `load()` finds one — in memory unless given */
  putSave?: (name: string, bytes: Uint8Array) => void;
  getSave?: (name: string) => Uint8Array | null;
}): Promise<HeadlessRun> {
  const saves = new Map<string, Uint8Array>();
  const put = opts.putSave ?? ((name: string, bytes: Uint8Array) => void saves.set(name, bytes));
  const get = opts.getSave ?? ((name: string) => saves.get(name) ?? null);
  return runHeadless({
    game: "redjack",
    makeHost: async () => redjackHost(process.env.ENGINELOG ? (l) => console.log(`  engine: ${l}`) : undefined),
    prepare: (s) => opts.prepare?.(s),
    deliver,
    putSave: async (name, bytes) => put(name, bytes),
    getSave: async (name) => get(name),
    seed: opts.seed,
    log: opts.log,
    // a v5 room is no set viewer, so never a viewer (speedrun/src/driver.ts ROOMLESS)
    roomless: true,
    // and the room is the director's to composite, as the page's loop does
    paints: !process.env.NOPAINT,
  });
}
