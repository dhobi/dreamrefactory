/**
 * Timelapse, headless — the shared engine stood up on the four discs read from
 * disk, with no page, no canvas and no clock. A test steps engine service
 * passes as fast as the CPU goes and waits on the game's STATE, never on a
 * duration.
 *
 * The shape is RedJack's (`redjack/tests/machine/harness.ts`): one suite per
 * file, one game per process, `ok`/`FAIL`/`PASS` lines that
 * `vitest.machine.config.ts` runs a process each, and a pump that is one `director.tick(now)` a
 * pass. What differs is what this game is:
 *
 *   - **no room at all.** There is no `.SET` on any disc, so there is no
 *     `session.maze` and no node: a place is the BOOTFILE's globals, world
 *     letter, stage, region and frame, and the flat they name
 *     (`framename`, `i0001.100`).
 *   - **one flat index over four discs**, as `src/files.ts` builds it, with the
 *     installer's fourteen files beside them (`TLAPSE1/install/data/`). The
 *     only repeated names are the byte-identical transition films, so the
 *     lowest disc wins.
 *   - **where each way leads is the stage's own table** (`getframeaction`), six
 *     words, one per direction — so a route here is the keys a player presses,
 *     and the table says whether the game offers them.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { encodePNG } from "../../../tools/png";
import { join, resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { GameHost, type HostFiles } from "@dreamfactory/engine/web/host";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { ENGINE_STEP_MS } from "@dreamfactory/engine/runtime/clock";
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { TIMELAPSE } from "../../../site/src/games";

const RIP = resolve(import.meta.dirname, "../../gamefiles");
const INSTALLED = join(RIP, "TLAPSE1/install/data");
export const haveRip = (): boolean => existsSync(join(INSTALLED, "bootfile"));

/** one pass of the pump is one engine service pass */
export const STEP = ENGINE_STEP_MS;
/** any fixed number would do; Timelapse shipped in 1996 */
export const SEED = Number(process.env.SEED ?? 19961031);

/** every file of the four discs by lowercase basename, lowest disc first */
function indexDiscs(): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: string, skipInstall: boolean): void => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        // the installer's tree is not the game, except the data it installs
        if (skipInstall && entry.toLowerCase() === "install") continue;
        walk(path, skipInstall);
      } else {
        const key = entry.toLowerCase();
        if (!found.has(key)) found.set(key, path);
      }
    }
  };
  walk(INSTALLED, false);
  for (const disc of [1, 2, 3, 4]) {
    const root = join(RIP, `TLAPSE${disc}`);
    if (existsSync(root)) walk(root, true);
  }
  return found;
}

/** the six directions a stage's table has a word for, in its order */
export const EXITS = ["forward", "back", "left", "right", "backleft", "backright"] as const;
export type Exit = (typeof EXITS)[number];

export interface Where {
  world: string;
  stage: number;
  region: number;
  frame: number;
  flat: string;
}

export interface Headless {
  host: GameHost;
  session: GameSession;
  /** every line the engine logged, in order */
  logs: string[];
  /** every question the game asked (`questiondialog`), answered no */
  questions: string[];
  /** whether the game has asked to quit (`quit ()`) */
  quit(): boolean;
  /** the handlers still running, outermost first — not counting `idle ()` */
  running(): string[];
  /** step `n` service passes */
  frame(n?: number): Promise<void>;
  /** step until `done()`, at most `max` passes; throws naming `what` */
  until(done: () => boolean, what: string, max?: number): Promise<number>;
  /** step until `done()` or `max` passes, whichever first; answers whether it came */
  wait(done: () => boolean, max: number): Promise<boolean>;
  /** the player has the game: the world on screen and no script running */
  idle(): boolean;
  /** step until the player has the game again */
  settle(what: string, max?: number): Promise<number>;
  /** who owns the screen */
  owner(): ReturnType<GameHost["director"]["screenOwner"]>;
  /** a global, as the game's scripts see it */
  g(name: string): string;
  /** world, stage, region, frame and the flat on screen */
  where(): Where;
  /** `where()` as the page's readout says it */
  here(): string;
  /** the stage's own six words for where each way leads from this frame */
  exits(): Promise<Record<Exit, string>>;
  /** a click as the page makes one, not awaited — a modal film would stall the pump */
  click(x: number, y: number): () => boolean;
  /** the button pressed and held at (x, y), until {@link mouseUp} */
  mouseDown(x: number, y: number): void;
  /** the pointer moved with the button still held: a script's `stilldown ()` loop reads it */
  moveTo(x: number, y: number): void;
  /** the button let go */
  mouseUp(x: number, y: number): void;
  /** a key as the page hands one over */
  key(name: string, special?: boolean): () => boolean;
  /** the screen as a PNG (with PICTURES=1, which decodes the pictures) */
  shot(path: string): void;
  /** a file off the discs, by the name the game asks for */
  file(name: string): Uint8Array | null;
  /** run one line of the game's own language and answer its value */
  eval(src: string): Promise<unknown>;
}

/** the game on the discs, booted, with a seeded `random()` */
export async function headless(): Promise<Headless> {
  if (!haveRip()) fail(`no rip: ${INSTALLED}/bootfile`);
  const index = indexDiscs();
  const cache = new Map<string, Uint8Array>();
  const read = (name: string): Uint8Array | null => {
    const path = index.get(name.toLowerCase());
    if (!path) return null;
    let bytes = cache.get(path);
    if (!bytes) cache.set(path, (bytes = new Uint8Array(readFileSync(path))));
    return bytes;
  };
  const logs: string[] = [];
  const files: HostFiles = {
    provide: read,
    load: async (name) => read(name),
    has: (name) => index.has(name.toLowerCase()),
    // one flat index over four discs: which disc the game is on does not matter
    setDisc: () => {},
    evict: () => 0,
  };
  const host = new GameHost(files, new NullAudioSink(), { log: (l) => logs.push(l) }, { screen: TIMELAPSE.screen, propAnchor: TIMELAPSE.propAnchor });
  const session = host.session;
  session.onLog = (l) => logs.push(l);
  session.seedRandom(SEED);
  // a question is answered as a player at the end would: no ("Would you like to
  // open a saved game?"), and the quit it leads to is recorded, not obeyed
  const questions: string[] = [];
  let quitting = false;
  session.onQuestionDialog = async (q: string) => (questions.push(q), false);
  session.onQuit = async () => void (quitting = true);
  session.drawsPictures = !!process.env.PICTURES;
  session.hasRealFrames = true;

  // every handler counted, as RedJack's harness explains, except `idle ()`
  const running = new Map<number, string>();
  const inIdle = new AsyncLocalStorage<boolean>();
  let serial = 0;
  const interp = session.interp;
  const runHandler = interp.runHandler.bind(interp);
  interp.runHandler = ((inst, handler, ...rest) => {
    const idle = inIdle.getStore() || handler === "idle" || handler === "flattick";
    return inIdle.run(idle, async () => {
      const id = ++serial;
      if (!idle) running.set(id, `${inst?.name ?? "?"}.${handler}`);
      if (!idle && process.env.TRACE) console.log(`  > ${inst?.name ?? "?"}.${handler}`);
      try {
        return await runHandler(inst, handler, ...rest);
      } finally {
        running.delete(id);
      }
    });
  }) as typeof interp.runHandler;

  let clock = 0;
  const drain = (): Promise<void> => new Promise<void>((r) => setImmediate(r));
  const pass = async (): Promise<void> => {
    if (letGo && --letGo.passes <= 0) {
      session.pointerDown = false;
      host.director.release(letGo.x, letGo.y);
      letGo = null;
    }
    clock = Math.max(clock + STEP, session.clock.now);
    host.director.tick(clock);
    await drain();
  };
  const frame = async (n = 1): Promise<void> => {
    for (let i = 0; i < n; i++) await pass();
  };
  const owner = (): ReturnType<GameHost["director"]["screenOwner"]> => host.director.screenOwner();
  const g = (name: string): string => String(session.interp.globals.get(name.toLowerCase()) ?? "");
  const where = (): Where => ({
    world: g("curworldchar"),
    stage: Number(g("curstagenum")),
    region: Number(g("curregionnum")),
    frame: Number(g("curframenum")),
    flat: session.currentFlat ?? "",
  });
  const here = (): string => {
    const w = where();
    return `${w.world} stage ${w.stage} region ${w.region} frame ${w.frame} (${w.flat})`;
  };
  const until = async (done: () => boolean, what: string, max = 40_000): Promise<number> => {
    for (let i = 0; i < max; i++) {
      if (done()) return i;
      await pass();
    }
    if (done()) return max;
    const held = session.pending();
    fail(
      `stuck waiting for ${what} (${max} passes, t=${Math.round(clock / 1000)}s, ${owner()} at ${here()}` +
        `${host.director.busy ? ", director busy" : ""}${held.length ? `, held by ${held.join(", ")}` : ""}` +
        `${running.size ? `, running ${[...running.values()].join(" > ")}` : ""}` +
        `${host.director.quiescent ? "" : ", not quiescent"})`,
    );
  };
  const { width: W, height: H } = host.director.screen;
  const park = (): void => session.setPointer(W / 2, H / 2);
  const idle = (): boolean => !letGo && owner() === "world" && host.director.quiescent && running.size === 0;
  const settle = async (what: string, max?: number): Promise<number> => {
    await frame(3);
    return until(() => idle() || host.director.awaitingChoice, `${what} to settle`, max);
  };
  // a click is pressed, held for six passes (a tenth of a second) and let go,
  // whatever the press is still doing: most of this game's mousedowns poll `stilldown ()` until the
  // button comes up, so letting go only once the handler returned would hang
  let letGo: { x: number; y: number; passes: number } | null = null;
  const click = (x: number, y: number): (() => boolean) => {
    let done = false;
    session.setPointer(x, y);
    session.pointerDown = true;
    letGo = { x, y, passes: 6 };
    void session.track(
      host.director.press(x, y).then(() => {
        // the hand moves off once the click is dealt with: a script reads
        // `mouse ()` in its mousedown (the stone face's eyes, left or right)
        if (!session.pointerDown) park();
        done = true;
      }),
      `click ${x},${y}`,
    );
    return () => done;
  };
  const mouseDown = (x: number, y: number): void => {
    letGo = null;
    session.setPointer(x, y);
    session.pointerDown = true;
    void session.track(host.director.press(x, y), `press ${x},${y}`);
  };
  const moveTo = (x: number, y: number): void => session.setPointer(x, y);
  const mouseUp = (x: number, y: number): void => {
    session.setPointer(x, y);
    session.pointerDown = false;
    host.director.release(x, y);
  };
  const key = (name: string, special = false): (() => boolean) => {
    let done = false;
    session.interp.globals.set("isrepeat", 0);
    void host.director.keyDown(name, special).then(() => (done = true));
    return () => done;
  };
  const evalLine = async (src: string): Promise<unknown> => {
    const inst = session.instanceFrom(compileScript(`code machineeval ()\n\t${src}\nendcode\n`), "machineeval");
    return inst ? (await session.interp.runHandler(inst, "machineeval", [], { me: "machineeval", target: "" })).value : null;
  };
  const exits = async (): Promise<Record<Exit, string>> => {
    const words = String(
      (await session.sendEvent("sendtostagefx", session.stageName, "getframeaction", [where().frame], session.stageName)) ?? "",
    ).split(/\s+/);
    return Object.fromEntries(EXITS.map((e, i) => [e, words[i] ?? "X"])) as Record<Exit, string>;
  };

  // the boot ends in `enterworld("I")`, whose `open.mov` is modal on a real
  // frame source: the pump runs it, and the boot returns once it is over
  let booted = false;
  void host.coldBoot().then(() => (booted = true));
  await until(() => booted, "the boot", 200_000);
  return {
    host, session, logs, running: () => [...running.values()], frame, until, idle, settle, owner, g, where, here, exits, click, key,
    wait: async (done, max) => {
      for (let i = 0; i < max; i++) {
        if (done()) return true;
        await pass();
      }
      return done();
    },
    questions, quit: () => quitting,
    eval: evalLine, file: read,
    shot: (path) => {
      const f = host.screen.frame;
      writeFileSync(path, encodePNG(f, host.screen.width, host.screen.height));
    }, mouseDown, moveTo, mouseUp,
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
/** the suite's last word — and its end, since a film or a loop still armed would keep node up */
export function pass(what: string): void {
  console.log(`PASS  ${what}`);
}
