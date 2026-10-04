/**
 * Lunicus's prototype page: the game machine (`src/game/`) driven at sixty ticks
 * a second, its screen drawn doubled, the mouse and keys handed in.
 *
 * Everything the game does is in the machine, so the page only
 *
 *   - serves the rip: the files the machine asks for, fetched in the
 *     background while it waits (`GameFiles.want`); the opening's and the lower
 *     floor's files are read before Enter, the upper floor's on the way up
 *   - runs the clock: a tick per 1/60 s of wall time, at most a few behind
 *   - draws the screen when its version moves, and plays its sounds
 *   - hands in input: a mouse-down or -up in the 512x384 screen's pixels, a key
 *     and whether it is held (the arrows walk while they are down)
 *
 * The title waits for File ▸ New, which LUNICUS.EXE's menu bar gave; here a
 * click on the title, or Enter, starts the game. The machine tests
 * (`tests/machine/`) drive the same machine with no page at all.
 */
import { focusOwnsKey } from "@dreamfactory/engine/web/keys";
import { $, GESTURE_KEYS, V0Page } from "@dreamfactory/engine/web/v0-page";
import { installBugReport } from "@dreamfactory/site/bug-report";
import { VERSION } from "@dreamfactory/site/version";
import { TICKS_PER_SECOND, VIEW_H, VIEW_W } from "./game/data";
import { TouchGestures } from "@dreamfactory/engine/web/touch";
import { Lunicus } from "./game/game";
import { Input, type Recording } from "./game/input";
import { browseForLoad, savesOpen } from "@dreamfactory/engine/web/save-browser";
import { windowDialogOpen } from "@dreamfactory/engine/web/window-dialog";
import { useSaveKind } from "@dreamfactory/engine/web/save-store";
import { LUNICUS_SAVES, seedLunicusSaves } from "./saves";
import { installMenu } from "./menu";
import { askHighScoreName, editKeys } from "./dialogs";
import { pageUrl } from "@dreamfactory/engine/web/page-url";

const RIP = "gamefiles/LUNICUS/";
/** what the opening and day one's lower floor read, fetched before Enter */
const PRELOAD = [
  "lunicus/lunicus.fon", "lunicus/lunires.dll", "shared/panel.", "shared/moonsoun.",
  "day1/intro.mov", "day1/flip.mov", "shared/first.mov", "shared/lowerbas.",
  "shared/guard.", "shared/molotov.", "shared/sasha.",
];
/** a tab left in the background comes back to this many ticks of catching up, not minutes */
const MAX_CATCH_UP = 6;

/** the log, the disc, the sound and the screen: the shell Jump Raven's page shares (engine/src/web/v0-page.ts) */
const page = new V0Page({ name: "Lunicus", year: 1994, slug: "lunicus", rip: RIP, version: VERSION });
const { canvas, locEl, complain, say, toggleLog, fetchBytes, files, speaker, at } = page;
installBugReport($<HTMLButtonElement>("bugBtn"), page.bugReport);
const url = (path: string): string => pageUrl(path);

/* ------------------------------------------------------------------------- *
 * The machine
 * ------------------------------------------------------------------------- */

/**
 * `?drive` hands the clock to whoever drives the page (tests/browser/playthrough.ts):
 * the page draws and listens as always but ticks only when told, and `?seed=`
 * pins the roll — a machine run's seed and gestures, replayed, are that run.
 */
const params = new URLSearchParams(location.search);
const DRIVE = params.has("drive");
/**
 * `?replay=/replays/playthrough.json&seed=…` plays a recorded machine run on
 * the page's own clock, at `pace` times game speed (`[` and `]` change it):
 * the same seed and the same gestures at the same ticks make the same run, so
 * this is the browser playthrough to watch — with the sound on.
 */
const REPLAY = params.get("replay");
let pace = Number(params.get("pace") ?? 1) || 1;
/* ------------------------------------------------------------------------- *
 * Saved games: the panel's save button writes through the shared dialog, and
 * the Load button is File ▸ Open (0x4184cc)
 * ------------------------------------------------------------------------- */

useSaveKind(LUNICUS_SAVES);

/* ------------------------------------------------------------------------- *
 * LUNICUS.SCO — the key table and the high scores (game/sco.ts) — kept in the
 * browser, and the two dialogs that change it. A driven or replayed run plays a
 * machine run's gestures, so it has the defaults and asks nothing: a player's
 * own keys or a name dialog would part it from the run.
 * ------------------------------------------------------------------------- */

const OWN_SCO = !DRIVE && !REPLAY;

const game = new Lunicus(files, {
  speaker,
  saver: page.saver,
  seed: params.has("seed") ? Number(params.get("seed")) : Date.now() & 0xffff,
  log: say,
  ...(OWN_SCO && {
    sco: page.storedSco(),
    keepSco: page.keepSco,
    keysDialog: (fields, defaults, done) => editKeys($("frame"), fields, defaults, done),
    askName: (done) => askHighScoreName($("frame"), done),
  }),
});
const m = game.m;

function status(): string {
  return (replay ? `replay ×${pace} · checkpoint ${replay.cp} of ${replay.rec.checkpoints.length} · ` : "") + where();
}

function where(): string {
  const b = game.base;
  if (game.phase === "not-ported" || game.phase === "over") return `${game.stopped} — reload the page for a new game`;
  if (game.phase === "title" && game.won && !m.film?.startsWith("intro")) return "the queen is dead, the game is won — the title again: click it for a new game";
  if (m.film) return `${m.where}`;
  const t = b?.talkState.talk ?? game.city?.talkState.talk;
  if (t) return `talking: ${t.file}${t.line ? " · " + t.line : ""}`;
  // a floor's maze is fetched after the floor is up (Base.enter): in a browser
  // that is a frame or more with no maze to name
  if (b && !b.maze) return "loading the floor…";
  if (b) return `${b.maze.name} · level ${game.progress.level} (day ${b.day}) · ${b.pose.x},${b.pose.y} facing ${"NSEW"[b.pose.dir]} · progress ${game.progress.day}`;
  const c = game.city;
  if (c?.world) {
    const w = c.world;
    return `${w.maze.name} · level ${game.progress.level} (day ${c.day}) · ${w.pose.x},${w.pose.y} facing ${"NSEW"[w.pose.dir]} · enemies ${game.hud.enemies} · ${c.wasp.wasp ? "" : "the node is out · "}ammo ${game.hud.bullets}/${game.hud.grenades}/${game.hud.rockets}`;
  }
  return m.where || game.phase;
}

let running = false;
let last = 0;
let owed = 0;
let lastStatus = "";
function frame(now: number): void {
  if (!running) return;
  owed = Math.min(owed + ((now - last) * TICKS_PER_SECOND * (replay ? pace : 1)) / 1000, MAX_CATCH_UP * (replay ? pace : 1));
  last = now;
  try {
    if (DRIVE || (REPLAY && !replay)) owed = 0;
    for (; owed >= 1; owed--) {
      if (replay) replayTick(replay);
      if (!game.tick()) break;
    }
  } catch (e) {
    complain(String(e));
    running = false;
  }
  page.draw(m.screen);
  // the status line is a readout: if it ever throws, say so and keep the game
  // running rather than dropping out of the frame loop for good
  try {
    const s = status();
    if (s !== lastStatus) locEl.textContent = lastStatus = s;
  } catch (e) {
    console.error("status line:", e);
  }
  menu.sync();
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------------- *
 * Input
 * ------------------------------------------------------------------------- */

/** the one door the page's hands and the machine tests' share (game/input.ts) */
const input = new Input(game);
/**
 * A finger (engine/src/web/touch.ts): a double tap is Esc — on a phone the
 * only way to skip a film, whose taps go to its hotspots — and a swipe an
 * arrow, which walks and turns. In a level the panel beside and under the
 * maze view takes a press at once; the view waits to see whether the finger
 * swipes, and a tap there is a click on lift.
 */
const touch = new TouchGestures({
  coords: (e) => (running && !REPLAY && !savesOpen() && !windowDialogOpen() ? at(e as PointerEvent) : null),
  ownedByGame: (x, y) => (game.phase === "base" || game.phase === "city") && !m.film && (x >= VIEW_W || y >= VIEW_H),
  press: (x, y) => input.down(x, y),
  release: (x, y) => input.up(x, y),
  sendKey: (key) => input.press(GESTURE_KEYS[key]),
});
canvas.addEventListener("pointerdown", (e) => {
  if (!running || REPLAY) return;
  if (e.pointerType === "touch") return void touch.down(e);
  const p = at(e);
  input.down(p.x, p.y);
});
canvas.addEventListener("pointermove", (e) => {
  if (REPLAY) return;
  const p = at(e);
  input.move(p.x, p.y);
});
addEventListener("pointermove", (e) => touch.move(e));
addEventListener("pointerup", (e) => {
  if (touch.up(e) || !running || REPLAY) return;
  const p = at(e);
  input.up(p.x, p.y);
});
addEventListener("pointercancel", (e) => touch.cancel(e));
document.addEventListener("keydown", (e) => {
  if (focusOwnsKey(e.target, e.key)) return;
  // the saved-games dialog is modal, as the EXE's was: the game gets no key while it is up
  if (savesOpen() || windowDialogOpen()) return;
  if (e.key === "b") return toggleLog();
  if (!running) return;
  if (REPLAY) {
    // the recording plays the game; the viewer only sets the pace
    if (e.key === "]") pace = Math.min(64, pace * 2);
    if (e.key === "[") pace = Math.max(0.25, pace / 2);
    return;
  }
  if (e.repeat) return (input.takes(e.key) && e.preventDefault(), undefined); // a held arrow is the machine's to repeat
  if (input.keyDown(e.key)) e.preventDefault();
});
document.addEventListener("keyup", (e) => void (REPLAY || input.keyUp(e.key)));

/* ------------------------------------------------------------------------- *
 * A replay
 * ------------------------------------------------------------------------- */

interface Replay {
  rec: Recording;
  /** the next gesture and the next checkpoint */
  g: number;
  cp: number;
}
let replay: Replay | null = null;

async function loadReplay(path: string): Promise<void> {
  const res = await fetch(url(path));
  if (!res.ok) throw new Error(`${path}: ${res.status} — ${await res.text()}`);
  const rec = (await res.json()) as Recording;
  if (rec.seed !== m.seed) throw new Error(`the recording was played on seed ${rec.seed}: open the page with &seed=${rec.seed}`);
  say(`replay: ${rec.gestures.length} gestures over ${rec.ticks} ticks; fetching ${rec.files.length} files…`);
  await Promise.all(rec.files.map((p) => fetchBytes(p)));
  replay = { rec, g: 0, cp: 0 };
  say("replay: playing — [ and ] halve and double the pace");
}

/** before a tick: its checkpoint compared, then its gestures, in the order they were kept */
function replayTick(r: Replay): void {
  const { rec } = r;
  for (; r.cp < rec.checkpoints.length && rec.checkpoints[r.cp].t <= m.ticks; r.cp++) {
    const cp = rec.checkpoints[r.cp];
    const same = cp.phase === game.phase && cp.level === game.progress.level && cp.progress === game.progress.day && cp.score === game.hud.score && cp.won === game.won;
    if (same) say(`✓ ${cp.what}`);
    else complain(`the replay parted from the run at tick ${cp.t} (${cp.what})`);
  }
  for (; r.g < rec.gestures.length && rec.gestures[r.g].t <= m.ticks; r.g++) {
    const g = rec.gestures[r.g];
    if ("key" in g) {
      if (g.g === "keydown") input.keyDown(g.key);
      else input.keyUp(g.key);
    } else if (g.g === "menu") input.menu(g.id);
    else if (g.g === "down") input.down(g.x, g.y);
    else if (g.g === "up") input.up(g.x, g.y);
    else input.move(g.x, g.y);
  }
}

/** the driver's handle, in drive mode only */
interface Drive {
  /** Enter has been pressed: the page takes input */
  running(): boolean;
  /** fetch these before the first tick, so no tick waits on the network */
  preload(paths: string[]): Promise<void>;
  /** tick until the machine's clock reads `t`; answers the state there */
  to(t: number): DriveState;
  state(): DriveState;
}
interface DriveState {
  t: number;
  phase: string;
  level: number;
  progress: number;
  score: number;
  won: boolean;
  stopped: string;
  /** where the canvas is on the page now, which the menu bar and the frame's
   *  arrival move: what a driver aims its mouse by */
  screen: { x: number; y: number; width: number; height: number };
}
/** a box's place and size, as a plain object */
const boxOf = ({ x, y, width, height }: DOMRect): DriveState["screen"] => ({ x, y, width, height });
if (DRIVE) {
  const state = (): DriveState => ({
    t: m.ticks,
    phase: game.phase,
    level: game.progress.level,
    progress: game.progress.day,
    score: game.hud.score,
    won: game.won,
    stopped: game.stopped,
    screen: boxOf(canvas.getBoundingClientRect()),
  });
  const drive: Drive = {
    running: () => running,
    preload: async (paths) => void (await Promise.all(paths.map((p) => fetchBytes(p)))),
    to: (t) => {
      while (m.ticks < t) if (!game.tick()) break;
      // the bar as the machine now has it, not as the last animation frame left
      // it: it moves the canvas, and the driver aims by where the canvas is
      menu.sync();
      return state();
    },
    state,
  };
  (window as unknown as { lunicusDrive: Drive }).lunicusDrive = drive;
}
addEventListener("blur", () => m.keysHeld.clear());

/* ------------------------------------------------------------------------- *
 * The boot
 * ------------------------------------------------------------------------- */

async function enter(): Promise<void> {
  await page.startSound();
  if (REPLAY && !replay && !running) await loadReplay(REPLAY);
  // an ambience asked for before there was sound to play it on
  if (m.ambiencePlaying && !page.looping) m.playAmbience();
  document.body.classList.add("playing");
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}

$("start").addEventListener("click", () => void enter().catch((e) => complain(String(e))));
/** File ▸ Open (0x4184cc): the saved-games dialog, then the file's game */
const openSaved = (): void =>
  void (async () => {
    // a replay plays a recorded game: no other game goes in
    if (REPLAY) return;
    const bytes = await browseForLoad({ log: (l) => say(`  ${l}`) });
    if (!bytes) return;
    if (!running) await enter();
    game.openGame(bytes);
  })().catch((e) => complain(String(e)));
$("loadBtn").addEventListener("click", openSaved);
/** the game window's menu bar, on the frame over the picture (src/menu.ts) */
const menu = installMenu($("frame"), game, input, { open: openSaved, live: () => running && !REPLAY && !savesOpen() && !windowDialogOpen() });
try {
  await page.boot({
    preload: PRELOAD,
    ready: "ready — Enter plays the intro; click the title to start a new game",
    // the port's day saves (gamefiles/save/), into the saved games once
    manifest: (manifest) =>
      void seedLunicusSaves((path) => (`gamefiles/${path}` in manifest ? url(`gamefiles/${path}`) : null)).then((n) => {
        if (n) say(`listed ${n} of the port's day saves in the saved games`);
      }),
  });
} catch (e) {
  complain(String(e));
}
