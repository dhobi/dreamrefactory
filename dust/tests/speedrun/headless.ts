/**
 * A Dust sheet played with no page (the engine's headless driver,
 * speedrun/src/headless.ts), for the verbs that need the real game
 * under them: `blackjack` (tests/speedrun/blackjack.ts).
 *
 * Where an input goes is the workbench Calculate's too
 * (src/speedrun/headless.ts).
 *
 * Load points are kept in memory: a test puts the disc's own save in as one
 * and loads it, as `loadSave` would on the page.
 */
import { headlessRun as runHeadless, type HeadlessRun } from "@dreamfactory/speedrun/headless";
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import { headlessGame } from "../../src/speedrun/headless";
import { dustHost } from "../playthrough/harness";

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
    ...headlessGame(async () => dustHost().host),
    prepare: (s) => opts.prepare?.(s),
    putSave: async (name, bytes) => put(name, bytes),
    getSave: async (name) => get(name),
    seed: opts.seed,
    log: opts.log,
  });
}
