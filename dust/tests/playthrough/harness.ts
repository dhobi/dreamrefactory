/**
 * A pumped headless Dust, set up to be PLAYED.
 *
 * The same arrangement Titanic's playthrough runs on
 * (`taoot/tests/playthrough/play.ts`), rebuilt for Dust because the layering
 * forbids the import — `dust ← engine, site`, and `site/tests/layering.ts` is
 * the test that says so. What is borrowed is the SHAPE, and the two ideas in it
 * that are worth more than any code:
 *
 *   1. **Pump to a predicate, never to a duration.** A browser driver that waits
 *      1.2 s for a walk and gets nothing has learned only that 1.2 s was not
 *      enough; the same driver on a slower machine learns something else. Here a
 *      wait ends when the engine says it has ended, and a wait that never ends
 *      throws with the name of what it was waiting for.
 *   2. **The engine's own clock is the heartbeat.** One tick of the pump is one
 *      service pass ({@link ENGINE_STEP_MS}), so a tick budget means the same
 *      thing to every caller.
 *
 * And it is FAST. The page takes about three minutes of wall clock to reach a
 * playable state because it is fetching a CD over HTTP and drawing every frame;
 * here the files come off the disk and the clock is a number, so a segment runs
 * in seconds. That is the difference between a route you can iterate on and one
 * you cannot.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GameHost, type HostFiles } from "@dreamfactory/engine/web/host";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { ENGINE_STEP_MS } from "@dreamfactory/engine/runtime/clock";
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import type { SetViewer } from "@dreamfactory/engine/web/viewer";

/** the rip, anchored to this file rather than the working directory */
export const CD = fileURLToPath(new URL("../../gamefiles/dustcd", import.meta.url));
export const SAVES = fileURLToPath(new URL("../../gamefiles/save", import.meta.url));
export const haveRip = (): boolean => existsSync(`${CD}/DATA`);

/** one tick of the pump is one service pass */
export const STEP = ENGINE_STEP_MS;
/** any fixed number would do; Dust shipped in 1995 */
export const SEED = 19950101;

/** where a basename is looked for first when the disc carries it twice —
 *  the same order the page's index uses (`dust/src/files.ts`) */
const PREFERRED = ["/data/", "/movies/", "/puppets/", "/install/"];
/** the BOOTFILE is not in DATA: it ships beside the installer's own DF.EXE */
const PINNED: Record<string, string> = { bootfile: "INSTALL/ALT31/BOOTFILE" };

const rank = (p: string): number => {
  const at = PREFERRED.findIndex((d) => p.toLowerCase().replace(/\\/g, "/").includes(d));
  return at < 0 ? PREFERRED.length : at;
};

/**
 * The disc, indexed by lowercase basename.
 *
 * By basename and not by directory because that is how the scripts ask: `boot()`
 * sets DATA as the search path and everything else is asked for bare. Where two
 * directories carry one name — each mini-game ships its own `CHECKERS.PRP` —
 * {@link PREFERRED} decides, and DATA wins.
 */
export function indexDisc(root = CD): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      const key = entry.toLowerCase();
      const had = found.get(key);
      if (!had || rank(path) < rank(had)) found.set(key, path);
    }
  };
  walk(root);
  for (const [name, rel] of Object.entries(PINNED)) {
    if (existsSync(join(root, rel))) found.set(name, join(root, rel));
  }
  return found;
}

/** a host over the real disc, booted, with a seeded `random()` */
export async function newDustHost(): Promise<{
  host: GameHost;
  session: GameSession;
  logs: string[];
}> {
  const index = indexDisc();
  const read = (name: string): Uint8Array | null => {
    const path = index.get(name.toLowerCase());
    return path ? new Uint8Array(readFileSync(path)) : null;
  };
  const logs: string[] = [];
  const files: HostFiles = {
    provide: (name) => read(name),
    load: async (name) => read(name),
    // one CD: nothing ever follows a setpath(disk) here
    setDisc: () => {},
    has: (name) => index.has(name.toLowerCase()),
    serverSetNames: () => [...index.keys()].filter((n) => n.endsWith(".set")),
    evict: () => 0,
  };
  const host = new GameHost(files, new NullAudioSink(), { log: (l) => logs.push(l) });
  // a save is a dump of the engine's own tables, and those are v1's here
  host.session.dfVersion = 1;
  await host.coldBoot();
  /*
   * There IS a frame source here, and saying so is what makes a walk finishable.
   *
   * `forceupdate()` is `yieldFrame`, and it is a NO-OP while `hasRealFrames` is
   * false (engine/src/runtime/builtins/context.ts) — so `GANG.CST`'s
   * `walktopuppet`, whose four waits are each
   *
   *     while iswalk (who) forceupdate () endwhile
   *
   * never yields, the pump never gets a tick, the walk never advances and the
   * loop dies on the interpreter's runaway guard. That is why
   * `dust/tests/browser/walk-back.ts` had to be a browser test: not because the
   * routine needs a browser, but because it needs a frame.
   *
   * **After the cold boot, never before.** `hasRealFrames` is also what makes
   * `playmovie` modal, and the boot plays films — set it first and `coldBoot()`
   * waits on an intro with nothing pumping it, which hangs before the harness
   * that would have pumped it exists.
   */
  host.session.hasRealFrames = true;
  host.session.seedRandom(SEED);
  return { host, session: host.session, logs };
}

/** let the microtask queue run — the engine is built on awaited promises */
export const drain = (): Promise<void> => new Promise<void>((r) => setImmediate(r));

export interface Pumped {
  host: GameHost;
  session: GameSession;
  v: () => SetViewer;
  /** tick until `until` holds; throws naming `what` if it never does */
  pump(until: () => boolean, what: string, max?: number): Promise<void>;
  /** tick until the engine stops moving on its own */
  settle(what: string): Promise<void>;
  /** press one of the three keys Dust's set scripts answer to */
  press(key: string, what?: string): Promise<void>;
  /** click without awaiting it — a modal film would deadlock the pump */
  fire(x: number, y: number): () => boolean;
  /**
   * Let the world run for `n` service passes.
   *
   * NOT a wait — a wait is {@link Pumped.pump}, which ends on a predicate. This
   * is for the gap between two tries at the same gesture, where the thing that
   * has to change is the world's, not the engine's: a character walking towards
   * you is nearer after it and the same click means something different.
   */
  tick(n: number): Promise<void>;
  logs: string[];
}

export function pumped(host: GameHost, logs: string[]): Pumped {
  const session = host.session;
  const v = (): SetViewer => host.viewer!;
  // one monotonic time source: forceupdate() self-advances the session clock
  // headless, so the pump must never hand the viewer a `now` behind it
  let clock = 0;
  const advance = (): number => (clock = Math.max(clock + STEP, session.clock.now));

  const pump = async (until: () => boolean, what: string, max = 40_000): Promise<void> => {
    for (let i = 0; i < max && !until(); i++) {
      host.viewer?.tick(advance());
      await drain();
    }
    if (!until()) throw new Error(`stuck waiting for ${what} (${max} steps, t=${clock}ms)`);
  };

  const settle = async (what: string): Promise<void> => {
    // a gesture needs a moment to register before "quiescent" means anything:
    // right after firing, the engine has not picked it up yet and still looks idle
    for (let i = 0; i < 3; i++) {
      host.viewer?.tick(advance());
      await drain();
    }
    await pump(() => v().quiescent, `${what} to settle`);
  };

  const press = async (key: string, what = key): Promise<void> => {
    void session.track(v().keyDown(key));
    await settle(what);
  };

  const fire = (x: number, y: number): (() => boolean) => {
    let done = false;
    void session.track(v().click(x, y).then(() => (done = true)));
    return () => done;
  };

  const tick = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) {
      host.viewer?.tick(advance());
      await drain();
    }
  };

  return { host, session, v, pump, settle, press, fire, tick, logs };
}
