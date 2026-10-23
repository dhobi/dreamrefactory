/**
 * A Timelapse sheet played with no page (the engine's headless driver,
 * speedrun/src/headless.ts) — what `npm run speedrun -w timelapse` runs.
 *
 * The host is the machine harness's (tests/machine/harness.ts `headless`): the
 * four discs and the installer's data in one flat index. Where an input goes,
 * and the host's settings, are the workbench Calculate's too
 * (src/speedrun/headless.ts).
 *
 * Load points are kept in memory unless the caller says where.
 */
import { readFileSync } from "node:fs";
import type { GameHost, HostFiles } from "@dreamfactory/engine/web/host";
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import { headlessRun as runHeadless, type HeadlessRun } from "@dreamfactory/speedrun/headless";
import { headlessGame, headlessHost } from "../../src/speedrun/headless";
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
  return headlessHost(files, log);
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
    ...headlessGame(async () => timelapseHost(process.env.ENGINELOG ? (l) => console.log(`  engine: ${l}`) : undefined)),
    prepare: (s) => opts.prepare?.(s),
    putSave: async (name, bytes) => put(name, bytes),
    getSave: async (name) => get(name),
    seed: opts.seed,
    log: opts.log,
  });
}
