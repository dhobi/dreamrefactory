/**
 * The node side of a headless sheet (#509): Titanic's game files off disk
 * (tests/harness.ts) under the engine's headless driver
 * (engine/src/web/speedrun/headless.ts).
 *
 *   npm run speedrun -w taoot -- --headless
 *
 * Saves on disk where the Playwright runner keeps them (driver.ts), so a load
 * point written by either runner is there for the other.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import { headlessRun as runHeadless, type HeadlessRun } from "@dreamfactory/engine/web/speedrun/headless";
import { deliverInput } from "../../src/speedrun/input";
import { newHost } from "../harness";
import { shippedSaveTemplate } from "../playthrough/play";

export async function headlessRun(opts: {
  prepare: (session: GameSession) => void;
  seed: number | null;
  log?: (message: string) => void;
}): Promise<HeadlessRun> {
  const saves = join(process.cwd(), "out", "speedrun");
  return runHeadless({
    game: "taoot",
    makeHost: async () => (await newHost({ cold: true })).host,
    prepare: (s) => {
      // what main.ts sets: a fresh game borrows a shipped save to write its own over
      s.saveTemplate = () => {
        const mission = s.interp.globals.get("mission");
        return shippedSaveTemplate(typeof mission === "number" && mission >= 4 ? "2" : "1");
      };
      opts.prepare(s);
    },
    deliver: deliverInput,
    putSave: async (name, bytes) => {
      mkdirSync(saves, { recursive: true });
      writeFileSync(join(saves, `${name}.ti`), bytes);
    },
    getSave: async (name) => {
      const file = join(saves, `${name}.ti`);
      return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
    },
    seed: opts.seed,
    log: opts.log,
  });
}
