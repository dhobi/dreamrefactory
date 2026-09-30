/**
 * Jump Raven, headless: the game machine (`jumpraven/src/game/`) on the rip
 * read from disk, with no page, no canvas and no clock. A test steps ticks as
 * fast as the CPU goes and waits on the game's STATE, never on a duration.
 *
 * The shape is Lunicus's (`lunicus/tests/machine/harness.ts`): one suite per
 * file, one game per process (vitest's forks, `vitest.machine.config.ts`), and
 * `ok`/`FAIL`/`PASS` lines in the log.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { JumpRaven, type JumpRavenOptions } from "../../src/game/game";
import { Input } from "../../src/game/input";
import type { GameFiles } from "../../src/game/machine";

export const RIP = resolve(import.meta.dirname, "../../gamefiles/RAVEN");
export const haveRip = (): boolean => existsSync(join(RIP, "RAVEN/RAVEN.EXE"));

/** the rip as the machine asks for it: paths under `RAVEN/`, upper case as ripped */
export function diskFiles(): GameFiles {
  const cache = new Map<string, Uint8Array>();
  return {
    has: (p) => existsSync(join(RIP, p)),
    get: (p) => {
      let b = cache.get(p);
      if (!b && existsSync(join(RIP, p))) cache.set(p, (b = new Uint8Array(readFileSync(join(RIP, p)))));
      return b ?? null;
    },
    want: () => {},
  };
}

export class SuiteFailure extends Error {}
export function ok(what: string): void {
  console.log(`ok    ${what}`);
}
export function fail(why: string): never {
  console.log(`FAIL  ${why}`);
  throw new SuiteFailure(why);
}
export function pass(what: string): void {
  console.log(`PASS  ${what}`);
}

/** a game on the rip, and the hands to play it with */
export function start(opts: JumpRavenOptions = {}) {
  // a suite skips without the rip before it gets here (test.skipIf)
  if (!haveRip()) fail(`no Jump Raven rip at ${RIP}`);
  const game = new JumpRaven(diskFiles(), { draws: false, ...opts });
  const m = game.m;
  /** tick until `done` holds; fails after `limit` ticks, naming what it waited for */
  const until = (what: string, done: () => boolean, limit = 200_000): void => {
    for (let i = 0; i < limit; i++) {
      if (done()) return;
      if (!game.tick()) {
        if (done()) return;
        fail(`${what}: the machine stopped (${game.stopped || game.phase}) at ${m.where}`);
      }
    }
    fail(`${what}: not after ${limit} ticks — ${game.phase} at ${m.where}`);
  };
  // every gesture through the page's own door (src/game/input.ts)
  const input = new Input(game);
  const click = (x: number, y: number): void => input.click(x, y);
  const key = (k: string): void => void (input.keyDown(k), input.keyUp(k));
  /** a film playing now is skipped, as Esc skips one */
  const skipFilm = (): void => key("Escape");
  return { game, m, input, until, click, key, skipFilm };
}
