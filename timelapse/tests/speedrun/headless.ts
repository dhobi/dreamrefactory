/**
 * A Timelapse sheet played with no page (the engine's headless driver,
 * speedrun/src/headless.ts) — what `npm run speedrun -w timelapse` runs.
 *
 * The host is the machine harness's (tests/machine/harness.ts `headless`): the
 * four discs and the installer's data in one flat index, this game's 640x480
 * screen and its prop anchor. What this file adds is the page's input handlers
 * (src/main.ts, through engine/src/web/shell-input.ts) with the page taken out,
 * and they go to the DIRECTOR, because there is no room and so no viewer: a
 * mouse press is `buttonDown` (and the hover the page asks for once it has been
 * dealt with), a release is `buttonUp` where it was let go, a move hovers, and
 * a key goes to `keyDown` as `keyAction` names it. Keep the two in step — a
 * press routed differently here is a different game.
 *
 * Load points are kept in memory unless the caller says where.
 */
import { readFileSync } from "node:fs";
import { GameHost, type HostFiles } from "@dreamfactory/engine/web/host";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import { headlessRun as runHeadless, type HeadlessRun, type InputEvent } from "@dreamfactory/speedrun/headless";
import { TIMELAPSE } from "../../../chrome/src/games";
import { keyAction } from "../../src/input";
import { indexDiscs } from "../machine/harness";

/** a fresh host over the discs, not booted — the harness's, minus its pump */
export function timelapseHost(log: (line: string) => void = () => {}): GameHost {
  const index = indexDiscs();
  const cache = new Map<string, Uint8Array>();
  const read = (name: string): Uint8Array | null => {
    const path = index.get(name.toLowerCase());
    if (!path) return null;
    let bytes = cache.get(path);
    if (!bytes) cache.set(path, (bytes = new Uint8Array(readFileSync(path))));
    return bytes;
  };
  const files: HostFiles = {
    provide: read,
    load: async (name) => read(name),
    has: (name) => index.has(name.toLowerCase()),
    // one flat index over four discs: which disc the game is on does not matter
    setDisc: () => {},
    evict: () => 0,
  };
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
    game: "timelapse",
    makeHost: async () => timelapseHost(process.env.ENGINELOG ? (l) => console.log(`  engine: ${l}`) : undefined),
    prepare: (s) => opts.prepare?.(s),
    deliver,
    putSave: async (name, bytes) => put(name, bytes),
    getSave: async (name) => get(name),
    seed: opts.seed,
    log: opts.log,
    // no .SET on any disc, so never a viewer (speedrun/src/driver.ts ROOMLESS)
    roomless: true,
    // and so no room frame to capture a turn from: composite as the page does
    paints: true,
  });
}
