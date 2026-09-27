/**
 * Lunicus, headless: the game machine (`lunicus/src/game/`) on the rip read
 * from disk, with no page, no canvas and no clock. A test steps ticks as fast
 * as the CPU goes and waits on the game's STATE, never on a duration.
 *
 * The shape is RedJack's (`redjack/tests/machine/harness.ts`): one suite per
 * file, one game per process, `ok`/`FAIL`/`PASS` lines that
 * `tools/runmachine.mts` reads.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FORWARD, LEFT, RIGHT } from "../../src/game/data";
import { Lunicus, type LunicusOptions } from "../../src/game/game";
import type { GameFiles } from "../../src/game/machine";
import { drawnAt } from "../../src/game/crew";
import { moved, type Pose } from "../../src/game/maze";
import type { TalkState } from "../../src/game/talk";
import { Input, type Checkpoint, type Gesture, type Recording } from "../../src/game/input";

export type { Checkpoint, Recording };

const RIP = resolve(import.meta.dirname, "../../gamefiles/LUNICUS");
export const haveRip = (): boolean => existsSync(join(RIP, "lunicus/lunicus.exe"));

/** the rip as the machine asks for it: paths under `LUNICUS/`, lowercase as ripped */
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
/** a recording's checkpoints: what the route had asserted, and when */
let checkpointed: ((what: string) => void) | null = null;
export function ok(what: string): void {
  console.log(`ok    ${what}`);
  checkpointed?.(what);
}
export function fail(why: string): never {
  console.log(`FAIL  ${why}`);
  throw new SuiteFailure(why);
}
export function pass(what: string): never {
  console.log(`PASS  ${what}`);
  process.exit(0);
}

export const checkpointOf = (game: Lunicus, what: string): Checkpoint => ({
  t: game.m.ticks,
  what,
  phase: game.phase,
  level: game.progress.level,
  progress: game.progress.day,
  score: game.hud.score,
  won: game.won,
});

export interface Headless {
  game: Lunicus;
  logs: string[];
  /** the player's hands: the page's own door (src/game/input.ts) */
  input: Input;
  /** the run so far as a recording, if the harness was asked to keep one */
  recording(): Recording;
  /** what the save button wrote, in order: the page's dialog stands in for a list */
  saves: { name: string; bytes: Uint8Array }[];
  /** step `n` ticks */
  frame(n?: number): void;
  /** step until `done()`, at most `max` ticks; throws naming `what` when it runs out */
  until(done: () => boolean, what: string, max?: number): number;
  /** the player has the base: no film, no talk, no move pending */
  idle(): boolean;
  /** step until {@link idle}, clicking through any film that waits for a click */
  /** `each` runs every tick: a player's own business while things play */
  settle(what: string, max?: number, each?: () => void): number;
  click(x: number, y: number): void;
  /** a key pressed and let go at once */
  key(name: string): void;
  /** walk the base to a pose by the arrows, the maze's own transitions — answers the moves */
  walkTo(to: Pose): number;
  /** the pose the player stands in */
  pose(): Pose;
  /**
   * Walk into a crew member's cell facing them, click their figure, and talk:
   * the first question of each menu, then out the way the menus go. Answers
   * the talk as it went.
   */
  talkTo(name: string, facing: number): TalkState;
  /** stand at a pose and click the middle of the view: use what is there */
  use(at: Pose): void;
  /** answer the next film that waits for a button with this one (an elevator's 1 is down) */
  press(index: number): void;
}

export const SEED = 1994;

export function headless(opts: LunicusOptions = {}): Headless {
  if (!haveRip()) fail(`no rip: ${RIP}/lunicus/lunicus.exe`);
  const logs: string[] = [];
  const disk = diskFiles();
  const read = new Set<string>();
  const files: GameFiles = { ...disk, get: (p) => (read.add(p), disk.get(p)) };
  const saves: { name: string; bytes: Uint8Array }[] = [];
  const saver = (bytes: Uint8Array, name: string, done: () => void): void => (saves.push({ name, bytes }), done());
  const game = new Lunicus(files, { draws: false, seed: process.env.SEED ? +process.env.SEED : SEED, saver, ...opts, log: (l) => (logs.push(l), process.env.TRACE && console.log(`  ${l}`)) });
  const m = game.m;
  const gestures: Gesture[] = [];
  const checkpoints: Checkpoint[] = [];
  const input = new Input(game, (g) => gestures.push(g));
  checkpointed = (what) => checkpoints.push(checkpointOf(game, what));
  const recording = (): Recording => ({ seed: game.m.seed, files: [...read].sort(), gestures, checkpoints, ticks: m.ticks });
  const step = (): void => {
    if (!game.tick()) fail(`the machine ended: ${game.stopped || logs.at(-1)}`);
    if (game.deaths) fail("the player died: back to the title");
  };
  const frame = (n = 1): void => {
    for (let i = 0; i < n; i++) step();
  };
  /** the talk under way, the base's or the queen's */
  const talking = (): TalkState | null => game.base?.talkState.talk ?? game.city?.talkState.talk ?? null;
  const where = (): string =>
    `${game.phase} level ${game.progress.level} progress ${game.progress.day}` +
    (game.base ? ` at ${JSON.stringify(game.base.pose)}` : "") +
    (m.film ? ` film ${m.film}${m.filmWaiting ? " (waiting)" : ""}` : "") +
    (talking() ? ` talk ${talking()!.file} menu [${talking()!.menu.join(" / ")}] line ${talking()!.line} played ${talking()!.played.join(",")} events ${m.events.length}` : "") +
    (game.stopped ? ` — ${game.stopped}` : "");
  const until = (done: () => boolean, what: string, max = 200_000): number => {
    for (let i = 0; i < max; i++) {
      if (done()) return i;
      step();
    }
    if (done()) return max;
    fail(`stuck waiting for ${what} (${max} ticks, ${where()})`);
  };
  const idle = (): boolean =>
    // the game won: the machine has stopped at the title
    game.won ||
    (game.phase === "base" && !m.film && !game.base?.talkState.talk && m.events.length === 0 && baseIdle()) ||
    (game.phase === "city" && !!game.city?.world && !game.city.busy && game.city.next === null && !m.film && m.events.length === 0);
  const baseIdle = (): boolean => {
    const b = game.base;
    return !!b && !b.busy && b.next === null && b.cam.frame === 0 && b.crew.every((c) => c.state === 0);
  };
  /** the menus seen in the talk under way: the first question once in each, then the way out */
  let seen = new Set<string>();
  const asked = new Map<string, Set<string>>();
  let lastTalk: TalkState | null = null;
  const driveTalk = (): void => {
    const ts = talking();
    if (!ts) return;
    if (ts !== lastTalk) (lastTalk = ts), (seen = new Set());
    if (ts.line || !ts.menu.length || m.events.length) return;
    const key = ts.menu.join("|");
    let row: number;
    if (ts.file.includes("queen")) {
      // the queen's talk ends only down one of its ways: ask everything, each menu's way out last
      const tried = (asked.get(key) ?? asked.set(key, new Set()).get(key))!;
      row = ts.menu.findIndex((_, i) => i < ts.menu.length - 1 && !tried.has(ts.menu[i]));
      if (row < 0) row = ts.menu.length - 1;
      tried.add(ts.menu[row]);
    } else {
      row = seen.has(key) ? ts.menu.length - 1 : 0;
      seen.add(key);
    }
    input.click(20, 264 + row * 24 + 12);
  };
  /** the button the next film that waits should be answered with, by its index */
  let pressNext: number | null = null;
  const settle = (what: string, max = 200_000, each?: () => void): number =>
    until(() => {
      driveTalk();
      each?.();
      if (m.filmWaiting && !m.events.length) {
        // out of a film that waits: the button asked for, else its first exit (an elevator's top button,
        // up), else its lowest button (the EXIT of the info screens)
        const hs = m.filmHotspots;
        const asked = pressNext !== null ? hs[pressNext] : undefined;
        pressNext = null;
        const out = asked ?? hs.find((s) => [1, 3].includes(Math.abs(s.type))) ?? [...hs].sort((a, b) => b.top - a.top)[0];
        if (out) input.click((out.left + out.right) >> 1, (out.top + out.bottom) >> 1);
      }
      return idle();
    }, what, max);
  const click = (x: number, y: number): void => {
    input.click(x, y);
  };
  const key = (name: string): void => input.press(name);
  const pose = (): Pose => ({ ...game.base!.pose });

  const walkTo = (to: Pose): number => {
    const b = game.base!;
    const id = (p: Pose): string => `${p.x},${p.y},${p.dir}`;
    const from = pose();
    const prev = new Map<string, { p: Pose; move: number } | null>([[id(from), null]]);
    const queue = [from];
    while (queue.length && !prev.has(id(to))) {
      const p = queue.shift()!;
      for (const move of [FORWARD, LEFT, RIGHT]) {
        const q = moved(p, move);
        if (prev.has(id(q)) || !b.maze.transition(p, q)) continue;
        prev.set(id(q), { p, move });
        queue.push(q);
      }
    }
    if (!prev.has(id(to))) fail(`no way from ${id(from)} to ${id(to)} in ${b.maze.name}`);
    const moves: number[] = [];
    for (let at = prev.get(id(to)); at; at = prev.get(id(at.p))) moves.unshift(at.move);
    for (const move of moves) {
      const before = id(pose());
      key(move === FORWARD ? "ArrowUp" : move === LEFT ? "ArrowLeft" : "ArrowRight");
      until(() => id(pose()) !== before || !!b.talkState.talk, `a move from ${before}`);
      if (b.talkState.talk) fail(`a talk (${b.talkState.talk.file}) stopped the walk at ${before}`);
    }
    settle(`standing at ${id(to)}`);
    return moves.length;
  };

  const talkTo = (name: string, facing: number): TalkState => {
    const b = game.base!;
    const f = b.crew.find((c) => c.name === name);
    if (!f) fail(`${name} is not on ${b.maze.name}`);
    walkTo({ x: f.home.cellX, y: f.home.cellY, dir: facing });
    const d = drawnAt(f, b.cam, b.maze.has);
    if (!d) fail(`${name} is not in view from ${JSON.stringify(pose())}`);
    const [t, l, bt, r] = d.rect;
    click(Math.trunc((Math.max(l, d.clip[1]) + Math.min(r, d.clip[3])) / 2), Math.trunc((Math.max(t, d.clip[0]) + Math.min(bt, d.clip[2])) / 2));
    until(() => f.state === 1, `${name} to answer the click`, 10);
    until(() => !!b.talkState.talk, `${name} to walk up and talk`, 2000);
    const ts = b.talkState.talk!;
    settle(`the talk with ${name} to end and ${name} to walk home`);
    return ts;
  };
  const use = (at: Pose): void => {
    walkTo(at);
    click(192, 132);
    frame();
    settle(`what is at ${at.x},${at.y},${at.dir} to be done`);
    // a figure standing in front of the thing took the click: now it has gone home, click again
    if (lastTalk && h0 !== lastTalk) {
      h0 = lastTalk;
      if (game.base!.crew.some((c) => c.home.cellX === at.x && c.home.cellY === at.y)) {
        click(192, 132);
        frame();
        settle(`what is at ${at.x},${at.y},${at.dir} to be done, the second time`);
      }
    }
  };
  let h0: TalkState | null = null;

  const press = (index: number): void => void (pressNext = index);
  return { game, logs, input, recording, saves, frame, until, idle, settle, click, key, walkTo, pose, talkTo, use, press };
}

/** every pose of the floor on screen whose facing byte is `byte` */
export function posesWith(h: Headless, byte: number, where: (p: Pose) => boolean = () => true): Pose[] {
  const b = h.game.base!;
  return b.maze.poses().filter((p) => b.maze.byte(p) === byte && where(p));
}
