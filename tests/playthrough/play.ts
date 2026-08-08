/**
 * The playthrough harness: a pumped headless host set up to be PLAYED.
 *
 * Shared by every segment, and by the checkpoint machinery that lets segment
 * N start where segment N-1 finished instead of replaying the whole story.
 *
 * The pieces that make a run reproducible live here, in one place, because
 * getting any of them wrong is silent: a seeded `random()`, TI.EXE's modal
 * `playmovie`, and a frame source for the poll loops that only end when a
 * rendered frame advances an animation.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GameHost } from "../../src/host";
import { ENGINE_STEP_MS } from "../../src/engine/clock";
import { StateTrace, snapshotState } from "../../src/engine/trace";
import { snapshotSave } from "../../src/engine/saveload";
import { Navigator, NavDriver } from "./nav/navigator";
import type { Story } from "./story";
import type { SetViewer } from "../../src/viewer";
import { drain, newHost, root } from "../harness";
import { headlessDriver } from "./driver";

/** the sinking, as a seed — any fixed number would do (src/engine/rng.ts) */
export const SEED = 19120415;
/**
 * Game milliseconds per pump tick — the engine's own heartbeat, so that one
 * tick of the pump is exactly one service pass. Anything else and a tick budget
 * stops meaning what a caller thinks it means: the driver converts `budgetMs`
 * to ticks by dividing by ENGINE_STEP_MS, and while this was 66 against a step
 * of 50 every such budget was a third short.
 */
export const STEP = ENGINE_STEP_MS;

export interface Playthrough extends Story {
  host: GameHost;
  session: GameHost["session"];
  v: () => SetViewer;
  driver: NavDriver;
  nav: Navigator;
  /** tick until `until` holds; throws naming `what` if it never does */
  pump(until: () => boolean, what: string, max?: number): Promise<void>;
  /** wait for the engine to stop moving on its own (SetViewer.quiescent) */
  settle(what: string): Promise<void>;
  /** click without awaiting it — see the note on `fire` below */
  fire(x: number, y: number): () => boolean;
  /** settle, then record a beat in the trace */
  beat(name: string): Promise<void>;
  /**
   * Record a beat WITHOUT settling — for milestones inside a stretch the
   * engine is driving itself through, where "quiescent" never comes. Sampling
   * is still deterministic: the caller pumps to a predicate, not a duration.
   */
  mark(name: string): void;
  trace: StateTrace[];
  logs: string[];
}

/**
 * A shipped save to use as the structural template for `snapshotSave`. The
 * browser seeds these into IndexedDB (src/save-seed.ts); headless we read one
 * off the same tree the game data comes from. Without a template a fresh
 * playthrough cannot produce a save at all, which is what made checkpoints
 * browser-only.
 */
export function shippedSaveTemplate(prefer: "1" | "2"): Uint8Array | null {
  for (const lang of readdirSync(root)) {
    for (const folder of prefer === "2" ? ["2", "ENDGAME2", "1"] : ["1", "ENDGAME1", "2"]) {
      const dir = join(root, lang, "save", folder);
      if (!existsSync(dir)) continue;
      const ti = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".ti")).sort();
      if (ti.length) return new Uint8Array(readFileSync(join(dir, ti[0])));
    }
  }
  return null;
}

export async function newPlaythrough(): Promise<Playthrough> {
  const { host, session, logs } = await newHost();
  const v = (): SetViewer => host.viewer!;

  session.seedRandom(SEED);
  // PROPTRACE=light[,other] PROPTRACE_FILE=<path> witnesses every write to those
  // props' owners. The engine formats the line (GameSession.tracePropOwner) so
  // that this file and tests/browser/playthrough.ts emit the SAME text and a diff
  // of the two answers "where do the hosts part company" directly.
  //
  // It replaced a wrapper around `session.sendEvent`, and that must not come back:
  // sendEvent is the dispatch hot path. A browser twin doing sessionStorage +
  // JSON.stringify inside it hung segment 1 outright, and merely making the
  // wrapper `async` took THIS host from 30/30 to 10 failures — `async f { return
  // p }` settles one microtask later than `p`, and the engine is built on exactly
  // that margin (`track()` joins `inflight` synchronously while its promise
  // settles a tick later, which is why `serviceGameClock` must run last; see
  // scheduler.ts). The probe was changing the thing it measured. A hook on the
  // one builtin that writes the value adds nothing to any dispatch.
  //
  // Appends to a file rather than console.log: vitest buffers a passing test's
  // console output and only surfaces it on failure, so a probe that logs is
  // silent exactly when the run is healthy.
  if (process.env.PROPTRACE) {
    for (const name of process.env.PROPTRACE.split(",")) {
      if (name.trim()) session.propTrace.add(name.trim().toLowerCase());
    }
    const out = process.env.PROPTRACE_FILE;
    session.onPropTrace = out
      ? (line) => appendFileSync(out, `${line}\n`)
      : (line) => console.log(`    ${line}`);
  }
  // This harness pumps frames, so movies may be modal — which is the point:
  // the menu waits for GAME, each close-up waits for OK.
  session.modalMovies = true;
  session.saveTemplate = () => shippedSaveTemplate("1");

  let clock = 0;
  // One monotonic time source. forceupdate() self-advances the session clock
  // headless, so the pump must never hand the viewer a `now` behind it — the
  // turn animation steps on `now - lastTick >= FRAME_MS` and would stall.
  const advance = (): number => (clock = Math.max(clock + STEP, session.clock.now));

  // (No nextFrame wiring: forceupdate()'s frame is the host's job now — see
  // GameHost's constructor. This used to be a second copy of it, which is how
  // the same starved-loop bug stayed live everywhere the playthrough isn't.)

  /**
   * TAOOT_WAITCOST=<file> writes one line per wait: how many engine steps it
   * actually took, and whether it ran out.
   *
   * The browser suite counts its waits (see WaitCost there) because a wait that
   * quietly times out costs 8 real seconds. Headless the same timeout is nearly
   * free, which is exactly why an unsatisfiable condition can sit in a route for
   * weeks: `EXHAUSTED` here is the cheap oracle for a wait that is burning
   * minutes over there. Steps, not seconds — see the wall-clock note in
   * docs/, and TODO §4's "62 gestures, 661 ticks".
   *
   * A file rather than console.log because vitest only shows a passing test's
   * output on failure, same reason PROPTRACE_FILE exists.
   */
  const waitCostFile = process.env.TAOOT_WAITCOST;
  const pump = async (until: () => boolean, what: string, max = 40_000): Promise<void> => {
    let i = 0;
    for (; i < max && !until(); i++) {
      host.viewer?.tick(advance());
      await drain();
    }
    if (waitCostFile) {
      appendFileSync(waitCostFile, `${until() ? String(i).padStart(6) : "EXHAUSTED"}\t${what}\n`);
    }
    if (!until()) throw new Error(`stuck waiting for ${what} (${max} steps, t=${clock}ms)`);
  };

  const settle = async (what: string): Promise<void> => {
    // a gesture needs a moment to register before "quiescent" means anything:
    // right after firing, the engine hasn't picked it up yet and still looks idle
    for (let i = 0; i < 3; i++) {
      host.viewer?.tick(advance());
      await drain();
    }
    await pump(() => v().quiescent, `${what} to settle`);
  };

  /**
   * Click and DON'T await it. With modal movies a gesture that opens a close-up
   * doesn't resolve until the movie is dismissed, and the movie only advances
   * while something pumps frames — awaiting deadlocks the pump against the
   * click. main.ts has the same shape: it fires clicks into session.track().
   */
  const fire = (x: number, y: number): (() => boolean) => {
    let done = false;
    void session.track(v().click(x, y).then(() => (done = true)));
    return () => done;
  };

  const trace: StateTrace[] = [];
  const beat = async (name: string): Promise<void> => {
    await settle(name);
    trace.push(snapshotState(session, v(), name));
  };

  const mark = (name: string): void => {
    trace.push(snapshotState(session, v(), name));
  };

  const driver = headlessDriver(host, { settle, pump, fire });
  // the Story getters read live state — there is nothing to mirror in-process
  const global = (name: string) => session.interp.globals.get(name);
  return {
    host,
    session,
    v,
    driver,
    d: driver,
    nav: new Navigator(driver),
    pump,
    settle,
    fire,
    beat,
    mark,
    trace,
    logs,
    /**
     * ROUTELOG=1 prints what the route is doing — the planned hops above all.
     *
     * Off by default and unset before now, which meant `s.log?.(…)` was a no-op in
     * the headless suite while the browser suite printed the same lines. So the
     * oracle was the quieter of the two hosts, and a route question you could answer
     * by eye in a browser ("which way did travel() actually go?") had no answer at
     * all here. `Navigator.travel` logs its plan through this.
     */
    log: process.env.TAOOT_ROUTELOG ? (m: string) => console.log(`    ${m}`) : undefined,
    num: (name) => Number(global(name) ?? NaN),
    str: (name) => String(global(name) ?? ""),
    owns: (prop) => session.propRuntime.get(prop)?.owner === "frank",
    deg: (prop) => Number(session.propRuntime.get(prop)?.deg ?? NaN),
    actorOwner: (name) => String(session.actorRuntime.actors.get(name.toLowerCase())?.owner ?? ""),
    waitFor: (until, what) => pump(until, what),
  };
}

/**
 * Checkpoints — a segment's end state as a real savegame.
 *
 * Cached under out/ and never committed: a `.ti` is patched from a shipped
 * save, so it carries original game bytes, and this repo ships none. Delete the
 * directory and the next run replays the producing segment to rebuild it.
 */
const CHECKPOINTS = join(dirname(new URL(import.meta.url).pathname), "..", "..", "out", "checkpoints");

export async function checkpoint(name: string, produce: () => Promise<Uint8Array>): Promise<Uint8Array> {
  const path = join(CHECKPOINTS, `${name}.ti`);
  if (existsSync(path) && !process.env.TAOOT_RECHECKPOINT) return new Uint8Array(readFileSync(path));
  const bytes = await produce();
  mkdirSync(CHECKPOINTS, { recursive: true });
  writeFileSync(path, bytes);
  return bytes;
}

/** the current state as savegame bytes, or throw saying why it couldn't */
export function saveOf(p: Playthrough): Uint8Array {
  const bytes = snapshotSave(p.session);
  if (!bytes) throw new Error("snapshotSave returned null — no save template loaded");
  return bytes;
}

/**
 * Start a fresh playthrough sitting where a checkpoint left off.
 *
 * The load is FIRED and pumped, never awaited first — the same shape as segment
 * 1's cold boot, and for the same reason. `loadGame` runs the room's own
 * `openset`/`openscene` scripts through `initall`, and a room is allowed to
 * `delay()` in there: the first-class lounge in mission 4 does (its cast places
 * Zeitel and Trask and the extras walk in). A `delay` suspends on the session
 * clock, and the session clock only advances while something pumps, so awaiting
 * the load before pumping deadlocks it — the load never finishes, the pump never
 * starts, and the test dies on its own timeout with nothing to say. The endgame's
 * lounge checkpoint is the first save that made this happen; it was luck that no
 * earlier room needed a frame to open.
 *
 * A restored room is also allowed to ASK (TODO 7a). The same lounge's own
 * `openscene` (LOUNGE1C.SET c320) ambushes the view the m4anti save records, so
 * the load itself opens Zeitel's conversation and its dispatch then waits inside
 * `puppetevent(-1)` for an answer nobody else can give — while the game sits
 * there playable. A game that is up and asking the player something IS settled;
 * requiring `loaded` first is what used to spin here for 40000 steps. WHICH
 * answer is story, so the caller supplies it (segments.ts `refuseZeitelAgain`
 * for m4anti), and the load's own tail — the second restoreProps/restoreActors
 * pass — only runs once the answer lands, which is why the pump goes back to
 * waiting for `loaded` before anyone reads an owner.
 */
export async function resume(bytes: Uint8Array, answer?: (p: Playthrough) => Promise<void>): Promise<Playthrough> {
  const p = await newPlaythrough();
  let loaded = false;
  const load = p.session.track(p.host.loadSavedGame(bytes).then(() => (loaded = true)));
  await p.pump(
    () => !!p.host.viewer && (loaded ? p.v().quiescent : p.v().conversing),
    "the restored game to settle",
  );
  if (!loaded) {
    if (!answer) {
      throw new Error("the restored room asked a question mid-load and this resume has no answer for it");
    }
    await answer(p);
    await p.pump(() => loaded && p.v().quiescent, "the answered load to finish");
  }
  await load;
  return p;
}
