/**
 * The game, headless — `src/game.ts` stood up on the rip read from disk, with
 * no page, no canvas and no clock. A test names what a URL would (`?level=3&x=…`)
 * and then steps engine frames as fast as the CPU goes.
 *
 * One game per process: `game.ts` keeps its world in module state, as the page
 * does, so a suite that wants a fresh level calls {@link Headless.load} again.
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildManifest } from "../../../tools/manifest";

const PKG = resolve(import.meta.dirname, "../..");

export type Game = typeof import("../../src/game");

export interface Headless {
  game: Game;
  /** one engine frame: four of the game's ticks */
  frame(n?: number): void;
  /**
   * Step engine frames until `done()` answers true, at most `max` of them.
   * Answers how many it took, or -1 when it ran out — a test waits on STATE,
   * never on a clock.
   */
  until(done: () => boolean, max: number): number;
  /**
   * Hold or release a key the way the page's handler does — the keys are
   * {@link Game.held}'s: `right`/`left` walk, `up` is W (run, climb, door),
   * `down` is S (duck), `jump`, `punch` (P), `kick` (K), `inv` (the holster).
   */
  hold(key: keyof Game["held"], down: boolean): void;
  /** press-and-release: the edge a tick reads once */
  press(key: "up" | "jump" | "punch" | "kick"): void;
  /** stand the game up again on another query */
  load(query: string): Promise<void>;
}

let booted: Game | null = null;

/** start the game on `query` — the same string a browser test put in its URL */
export async function headless(query = ""): Promise<Headless> {
  (globalThis as { SC_QUERY?: string }).SC_QUERY = query.startsWith("?") ? query : `?${query}`;
  const fresh = !booted;
  const game = booted ?? (booted = await import("../../src/game"));
  if (!fresh) game.setQuery(query.startsWith("?") ? query : `?${query}`);
  const { SkullFiles } = await import("../../src/files");
  const gamefiles = join(PKG, "gamefiles");
  const full = buildManifest({ gamefiles, publicDir: join(PKG, "public") });
  const manifest: Record<string, number> = {};
  for (const [k, v] of Object.entries(full)) {
    const norm = k.replace(/\\/g, "/");
    manifest[norm.startsWith(gamefiles) ? "gamefiles" + norm.slice(gamefiles.length) : norm] = v;
  }
  game.setFiles(
    SkullFiles.fromReader(manifest, async (path) => {
      const at = path.startsWith("gamefiles/") ? join(PKG, path) : join(PKG, "public", path);
      try {
        return new Uint8Array(await readFile(at));
      } catch {
        return null;
      }
    }),
  );
  if (!(await game.startGame())) throw new Error("player.sbk is not in the rip");
  const h: Headless = {
    game,
    frame(n = 1) {
      for (let i = 0; i < n * 4; i++) game.tick();
    },
    until(done, max) {
      for (let f = 0; f < max; f++) {
        if (done()) return f;
        h.frame();
      }
      return done() ? max : -1;
    },
    hold(key, down) {
      // the page's keydown (walk.ts): nothing at all while the keys are shut
      // (`0x402be0`, `game.inputOpen`), and a key going down lights its edge
      if (!game.inputOpen) return;
      if (down && !game.held[key]) {
        if (key === "up") game.setUpPressed(true);
        if (key === "jump") game.setJumpPressed(true);
        if (key === "punch") game.setPunchPressed(true);
        if (key === "kick") game.setKickPressed(true);
      }
      (game.held as Record<string, boolean>)[key as string] = down;
    },
    press(key) {
      if (!game.inputOpen) return;
      if (key === "up") game.setUpPressed(true);
      if (key === "jump") game.setJumpPressed(true);
      if (key === "punch") game.setPunchPressed(true);
      if (key === "kick") game.setKickPressed(true);
    },
    async load(q: string) {
      game.setQuery(q.startsWith("?") ? q : `?${q}`);
      for (const k of Object.keys(game.held)) (game.held as Record<string, boolean>)[k] = false;
      if (!(await game.startGame())) throw new Error("player.sbk is not in the rip");
    },
  };
  return h;
}

/** the suites' own voice, the same three words the browser suites print */
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

/** engine frames in a second — `0x40e4f0` waits four sixtieths a frame */
export const FPS = 15;

/** one call the game made on its `Sounds`, in the order it made them */
export interface SoundCall {
  /** the method: `open`, `effect`, `own`, `resume`… */
  call: string;
  args: unknown[];
}

/**
 * Put a recording stand-in where `game.sound` is (null in node) and answer the
 * list it writes to: every method the game calls on its `Sounds` is recorded,
 * name and arguments, and nothing plays. It takes effect from the next call, so
 * a suite that wants the level's own `open` records first and then `load`s.
 */
export function recordSound(game: Game): SoundCall[] {
  const calls: SoundCall[] = [];
  const stand = new Proxy(
    {},
    {
      get: (_t, k) =>
        typeof k === "string" && k !== "then"
          ? (...args: unknown[]) => {
              calls.push({ call: k, args });
            }
          : undefined,
    },
  );
  game.setSound(stand as Parameters<Game["setSound"]>[0]);
  return calls;
}

/**
 * A `localStorage` for node, kept in a Map — what the page's own stores (the
 * preferences, the high-score board) read and write. Install it BEFORE
 * {@link headless}: `PREFS` is read once, as `game.ts` is imported. Calling it
 * again hands back the same store.
 */
export function memoryStorage(): Map<string, string> {
  const g = globalThis as { localStorage?: Storage & { __map?: Map<string, string> } };
  if (g.localStorage?.__map) return g.localStorage.__map;
  const map = new Map<string, string>();
  g.localStorage = {
    __map: map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage & { __map: Map<string, string> };
  return map;
}
