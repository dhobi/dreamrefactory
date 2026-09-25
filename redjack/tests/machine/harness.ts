/**
 * RedJack, headless — the shared engine stood up on the three discs read from
 * disk, with no page, no canvas and no clock. A test steps engine service passes
 * as fast as the CPU goes and waits on the game's STATE, never on a duration.
 *
 * The shape is Skull Cracker's (`skullcracker/tests/machine/harness.ts`): one
 * suite per file, one game per process, `ok`/`FAIL`/`PASS` lines that
 * `tools/runmachine.mts` reads. The pump is Dust's
 * (`dust/tests/playthrough/harness.ts`), because RedJack is not a core of its
 * own but the DreamFactory engine, and a pass of that is `director.tick(now)`.
 *
 * Two things differ from both:
 *
 *   - **a v5 room has no set viewer.** `host.viewer` stays null in a `.sett`
 *     room; the room is `session.maze` and the input goes to the director, the
 *     way `redjack/src/main.ts` hands it the page's pointer.
 *   - **three discs, one repeated name.** `movies/death.move` differs per disc,
 *     and the game says which disc it is on (`setDisc`) — served here as
 *     `redjack/src/files.ts` serves it: from that disc, else the lowest.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { GameHost, type HostFiles } from "@dreamfactory/engine/web/host";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { ENGINE_STEP_MS } from "@dreamfactory/engine/runtime/clock";
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import { REDJACK } from "../../../site/src/games";

const RIP = resolve(import.meta.dirname, "../../gamefiles");
const DISCS = [1, 2, 3];
export const haveRip = (): boolean => existsSync(join(RIP, "RJDisk1/RedJack/bootfile.boot"));

/** one pass of the pump is one engine service pass */
export const STEP = ENGINE_STEP_MS;
/** any fixed number would do; RedJack shipped in 1998 */
export const SEED = 19980101;

/** the name the engine asks for → the name this rip ships it under (files.ts) */
const ALIASES: Record<string, string> = { bootfile: "bootfile.boot" };

/** every file of the three discs by lowercase basename, then by disc */
function indexDiscs(): Map<string, Map<number, string>> {
  const found = new Map<string, Map<number, string>>();
  for (const disc of DISCS) {
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else {
          const key = entry.toLowerCase();
          const byDisc = found.get(key) ?? new Map<number, string>();
          if (!byDisc.has(disc)) byDisc.set(disc, path);
          found.set(key, byDisc);
        }
      }
    };
    const root = join(RIP, `RJDisk${disc}`);
    if (existsSync(root)) walk(root);
  }
  return found;
}

export interface Headless {
  host: GameHost;
  session: GameSession;
  /** every line the engine logged, in order */
  logs: string[];
  /** the handlers still running, outermost first — not counting `idle ()` */
  running(): string[];
  /** the disc the game last said it is on */
  disc(): number;
  /** step `n` service passes */
  frame(n?: number): Promise<void>;
  /**
   * Step until `done()` answers true, at most `max` passes. Answers how many it
   * took; throws naming `what` when it ran out, so a hang says what it hung on.
   */
  until(done: () => boolean, what: string, max?: number): Promise<number>;
  /** the player has the game: the room on screen, nothing walking and no script running */
  idle(): boolean;
  /** step until the player has the game again, or the game asks a question */
  settle(what: string, max?: number): Promise<number>;
  /** who owns the screen: "movie", "puppet", "faded", "world" or "held" */
  owner(): ReturnType<GameHost["director"]["screenOwner"]>;
  /** the room's `.sett` name, without the extension */
  room(): string;
  /** the node the room stands at */
  node(): string;
  /** a click as the page makes one, not awaited — a modal film would stall the pump */
  click(x: number, y: number): () => boolean;
  /** the button pressed and held at (x, y), until {@link mouseUp} */
  mouseDown(x: number, y: number): void;
  /** the button let go */
  mouseUp(x: number, y: number): void;
  /** a key coming up, as the page hands the arrows' releases over */
  keyUp(name: string): void;
  /** a key as the page hands one over */
  key(name: string, special?: boolean): () => boolean;
}

/** the game on the discs, booted, with a seeded `random()` */
export async function headless(): Promise<Headless> {
  if (!haveRip()) fail(`no rip: ${RIP}/RJDisk1/RedJack/bootfile.boot`);
  const index = indexDiscs();
  let disc = 1;
  const pathOf = (name: string): string | undefined => {
    const n = name.toLowerCase();
    const byDisc = index.get(ALIASES[n] ?? n);
    if (!byDisc) return undefined;
    return byDisc.get(disc) ?? byDisc.get(Math.min(...byDisc.keys()));
  };
  // each file off the disk once: the engine asks for a room's files again at
  // every visit, and a suite that walks back and forth would pay for each
  const cache = new Map<string, Uint8Array>();
  const read = (name: string): Uint8Array | null => {
    const path = pathOf(name);
    if (!path) return null;
    let bytes = cache.get(path);
    if (!bytes) cache.set(path, (bytes = new Uint8Array(readFileSync(path))));
    return bytes;
  };
  const logs: string[] = [];
  const files: HostFiles = {
    provide: read,
    load: async (name) => read(name),
    setDisc: (n) => void (disc = n),
    has: (name) => pathOf(name) !== undefined,
    serverSetNames: () => [...index.keys()].filter((n) => n.endsWith(".sett")),
    evict: () => 0,
  };
  const host = new GameHost(files, new NullAudioSink(), { log: (l) => logs.push(l) }, { screen: REDJACK.screen });
  const session = host.session;
  session.onLog = (l) => logs.push(l);
  session.seedRandom(SEED);
  // nothing here looks at a film's pixels, and decoding them is most of the time
  session.drawsPictures = false;
  await host.coldBoot();
  // a frame source AFTER the cold boot, as Dust's harness explains: it is what
  // makes a film modal and a `forceupdate` loop yield, and the pump below is it
  session.hasRealFrames = true;

  /*
   * Which scripts are still running. The engine's own `scriptBusy` counts the
   * dispatches it TRACKS, and a node's `openscene` after a walk is not one of
   * them — so the engine looks idle while liznite's Node58 is still turning you
   * to face Lyle, and a route that clicks then starts the conversation a second
   * time over the first. Every handler is counted here instead, except the
   * `idle ()` heartbeat the room runs each frame and whatever it calls.
   */
  const running = new Map<number, string>();
  const inIdle = new AsyncLocalStorage<boolean>();
  let serial = 0;
  // TRACE=1 prints every handler as it starts: where a route went, script by script
  const tracing = (): boolean => !!process.env.TRACE;
  const interp = session.interp;
  const runHandler = interp.runHandler.bind(interp);
  interp.runHandler = ((inst, handler, ...rest) => {
    const idle = inIdle.getStore() || handler === "idle";
    return inIdle.run(idle, async () => {
      const id = ++serial;
      if (!idle) running.set(id, `${inst?.name ?? "?"}.${handler}`);
      if (!idle && tracing()) console.log(`  > ${inst?.name ?? "?"}.${handler}`);
      try {
        return await runHandler(inst, handler, ...rest);
      } finally {
        running.delete(id);
      }
    });
  }) as typeof interp.runHandler;

  // one monotonic time: forceupdate() advances the session clock headless, so
  // the pump must never hand the director a `now` behind it
  let clock = 0;
  const drain = (): Promise<void> => new Promise<void>((r) => setImmediate(r));
  const pass = async (): Promise<void> => {
    clock = Math.max(clock + STEP, session.clock.now);
    host.director.tick(clock);
    await drain();
  };
  const frame = async (n = 1): Promise<void> => {
    for (let i = 0; i < n; i++) await pass();
  };
  const until = async (done: () => boolean, what: string, max = 40_000): Promise<number> => {
    for (let i = 0; i < max; i++) {
      if (done()) return i;
      await pass();
    }
    if (done()) return max;
    const held = session.pending();
    fail(
      `stuck waiting for ${what} (${max} passes, t=${Math.round(clock / 1000)}s, ${owner()} at ${room()}/${node()}` +
        `${host.director.busy ? ", director busy" : ""}${held.length ? `, held by ${held.join(", ")}` : ""}` +
        `${running.size ? `, running ${[...running.values()].join(" > ")}` : ""})`,
    );
  };
  const owner = (): ReturnType<GameHost["director"]["screenOwner"]> => host.director.screenOwner();
  const room = (): string => session.currentSetFile ?? "";
  const node = (): string => session.maze?.sceneName ?? "";
  // `idle ()` scrolls the view while the pointer rests within `margin` of an
  // edge (boot tracknodescroll, `tnscrolling`), and a click on a plaque leaves it
  // at the bottom — a player would move the mouse; the harness parks it in the
  // middle after every click, as the page does between touches, and the game
  // is not idle until the scroll has run down
  const { width: W, height: H } = host.director.screen;
  const park = (): void => session.setPointer(W / 2, H / 2);
  const idle = (): boolean =>
    owner() === "world" && !session.maze?.walk && host.director.quiescent && running.size === 0 &&
    String(session.interp.globals.get("tnscrolling") ?? 0) !== "1";
  const settle = async (what: string, max?: number): Promise<number> => {
    // a gesture needs a pass or two to register before "idle" means anything
    await frame(3);
    return until(() => idle() || host.director.awaitingChoice, `${what} to settle`, max);
  };
  const click = (x: number, y: number): (() => boolean) => {
    let done = false;
    session.setPointer(x, y);
    void session.track(host.director.press(x, y).then(() => {
      host.director.release(x, y);
      done = true;
    }), `click ${x},${y}`);
    // the press has read the pointer; now the mouse moves off, before `idle` sees it
    queueMicrotask(park);
    return () => done;
  };
  const keyUp = (name: string): void => void host.director.keyUp(name);
  // the button held, as the page's pointerdown holds it: `stilldown ()` reads it,
  // and the fight on the dock strikes only while it is down (combat.shop think)
  const mouseDown = (x: number, y: number): void => {
    session.setPointer(x, y);
    session.pointerDown = true;
    void session.track(host.director.press(x, y), `press ${x},${y}`);
  };
  const mouseUp = (x: number, y: number): void => {
    session.pointerDown = false;
    host.director.release(x, y);
  };
  const key = (name: string, special = false): (() => boolean) => {
    let done = false;
    void host.director.keyDown(name, special).then(() => (done = true));
    return () => done;
  };
  return { host, session, logs, idle, keyUp, mouseDown, mouseUp, running: () => [...running.values()], disc: () => disc, frame, until, settle, owner, room, node, click, key };
}

export class SuiteFailure extends Error {}
export function ok(what: string): void {
  console.log(`ok    ${what}`);
}
export function fail(why: string): never {
  console.log(`FAIL  ${why}`);
  throw new SuiteFailure(why);
}
/** the suite's last word — and its end, since a film or a loop still armed would keep node up */
export function pass(what: string): never {
  console.log(`PASS  ${what}`);
  process.exit(0);
}
