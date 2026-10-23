/**
 * A RedJack sheet played with no page (the engine's headless driver,
 * speedrun/src/headless.ts) — what `npm run speedrun -w redjack` runs.
 *
 * The host is over the machine harness's file store (tests/machine/harness.ts
 * `discFiles`): the three discs, a name served off the disc the game says it is
 * on. Where an input goes, and the host's settings, are the workbench
 * Calculate's too (src/speedrun/headless.ts).
 *
 * Load points are kept in memory unless the caller says where.
 */
import type { GameHost } from "@dreamfactory/engine/web/host";
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import { headlessRun as runHeadless, type HeadlessRun } from "@dreamfactory/speedrun/headless";
import { headlessGame, headlessHost } from "../../src/speedrun/headless";
import { discFiles } from "../machine/harness";

/** a fresh host over the discs, not booted — the harness's, minus its pump */
export function redjackHost(log: (line: string) => void = () => {}): GameHost {
  return headlessHost(discFiles(), log);
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
  const game = headlessGame(async () => redjackHost(process.env.ENGINELOG ? (l) => console.log(`  engine: ${l}`) : undefined));
  return runHeadless({
    ...game,
    prepare: (s) => opts.prepare?.(s),
    putSave: async (name, bytes) => put(name, bytes),
    getSave: async (name) => get(name),
    seed: opts.seed,
    log: opts.log,
    paints: !process.env.NOPAINT,
  });
}
