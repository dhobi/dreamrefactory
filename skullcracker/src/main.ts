/**
 * Skull Cracker, in a browser — as far as it goes.
 *
 * *Skull Cracker* (1996) is CyberFlix's own, and this page is the first thing in
 * this project to read a **Macintosh** DreamFactory rip: same containers, same
 * frame codec, same MOV header at the same offsets, every integer the other way
 * round (`engine/src/df/byte-order.ts`). Nothing here asks which way round —
 * `readContainerFile` works it out from the file's own size field and every
 * reader downstream inherits the answer.
 *
 * ## Why this page is a film player and not a GameHost
 *
 * The other three pages hand a rip to {@link file://../../engine/src/web/host.ts}
 * and let the real engine boot it. That is not available here, and the reason is
 * the game rather than the port: Skull Cracker is a side-scrolling beat-'em-up
 * whose logic is in a PowerPC executable, and its disc carries no BOOTFILE, no
 * `.SET`, no `.STG` and no script container of any kind. There is nothing for an
 * interpreter to interpret. Its levels are `.sbk` sprite books, and even though
 * every structure in them reads (they are DreamFactory containers of SHP-codec
 * cels — see `tools/dumpsbk.ts`), what they hold is placement, not behaviour:
 * the executable is the game.
 *
 * What the disc DOES carry, and in the format this port already reads
 * completely, is 66 films — and one of them is the game's menu. `menu.mov` is an
 * interactive DreamFactory movie: 175 frames, a looping bed, and seven click
 * regions per frame whose targets are the other frames of the same film. Begin,
 * Open, Help, Prefs, Quit. So "the game starts" means what it can honestly mean
 * here: the menu comes up, animates, plays its music, and answers a click.
 *
 * ## The frame state machine, and why there is a second one
 *
 * {@link MoviePlayer} is the engine's implementation of this and is the tested
 * one — but it takes a `GameSession`, which is the thing this game cannot
 * produce. So {@link Film} below is a small reimplementation of the same rules
 * (`engine/src/df/mov.ts`'s module comment is their source): frame and region
 * action types 1..7, the authored hold, the region wait, the segment chain. It
 * deliberately reuses every ENGINE part that is not the state machine —
 * `readMovFile`, `decodeFrame`, `paletteToRGBA`, `segmentInterval`,
 * `segmentAudio`, `soundtrackFor`, `WebAudioSink` — so what is duplicated is one
 * loop and not one format.
 *
 * If Skull Cracker ever earns a `GameSession` (it would take a synthesised boot,
 * which would be inventing game data), this file is what should go.
 */
import { readMovFile } from "@dreamfactory/engine/df/mov";
import { indexedToRGBA } from "@dreamfactory/engine/df/image";
import { AudioSink, DeferredAudioSink, WebAudioSink } from "@dreamfactory/engine/runtime/audio";
import { SCREEN_H, SCREEN_W } from "@dreamfactory/engine/web/screen";
import { ESCAPE_KEY, focusOwnsKey } from "@dreamfactory/engine/web/keys";
import { GestureKey, PointerEventLike, TouchGestures } from "@dreamfactory/engine/web/touch";
import { installBugReport } from "@dreamfactory/site/bug-report";
import { VERSION, installVersion } from "@dreamfactory/site/version";
import { SkullFiles } from "./files";
import { Film } from "./film";

/**
 * The game's start sequence, and it is not a guess — it is a string table in the
 * game's own binary.
 *
 * `Install Folder/Skull` is a PowerPC executable, and packed together at offset
 * 490764 are the eleven films the SHELL plays, in this order:
 *
 *     cyber.Mov  imain.Mov  Menu.Mov  prefs2.mov  helpmac.mov  credits.mov
 *     char.mov   kill1.mov … kill7.mov
 *
 * The first three are the startup: the CyberFlix logo, the intro, the menu. The
 * next three are where the menu's own buttons go, which corroborates {@link
 * EXIT_ACTIONS} below from the other side. (The strings around them are the rest
 * of the shell and are worth knowing about because none of it is in any data
 * file: "Enter name for high scores:", `Name`/`Score`/`Level`, `Easy`/`Hard`,
 * "Enter level (1-16):", "Load from which slot?" — and seven cheat words.)
 *
 * Spelled as the BINARY spells them rather than as the disc does — the disc has
 * `Cyber.Mov` and `imain.mov`, the binary `cyber.Mov` and `imain.Mov`, and the
 * per-level entries disagree with the disc's casing too (`Chp01.Mov` against
 * `chp01.Mov`). Nothing has to reconcile them because the store folds case; this
 * table is quoting a source, so it quotes it exactly.
 */
const BOOT_SEQUENCE: readonly string[] = ["cyber.Mov", "imain.Mov", "Menu.Mov"];

/**
 * The film the sequence ends on, and the one everything returns to.
 *
 * `Install Folder/Local/menu.mov`, not the CD's older copy of the same name —
 * see {@link file://./files.ts}, which is where that is decided. The binary
 * sitting in that same `Install Folder` is the reason to prefer it: the shipped
 * game ran from there.
 */
const BOOT_MOVIE = BOOT_SEQUENCE[BOOT_SEQUENCE.length - 1];

/**
 * What the menu's six buttons MEAN — and this is the executable's table, not a
 * reading of the labels.
 *
 * `menu.mov` answers by ending on a named one-frame stub ({@link Film.finish}),
 * and the six regions target `"frame 2"`..`"frame 7"` down the right-hand side
 * and across the bottom. What each of those stubs does was guessed here once,
 * from the labels. It did not have to be: `0x45ddd0` is handed the film's
 * CURRENT FRAME INDEX, and
 *
 * ```
 *   45dee7  movsx eax, si
 *   45deea  sub   eax, 0xa7          ; frame index 167
 *   45deef  cmp   eax, 7
 *   45def8  jmp   dword ptr [eax*4 + 0x45e1ac]
 * ```
 *
 * dispatches eight of them. The film's own frame table puts `"frame 2"` at index
 * **168**, so the jump table reads straight across:
 *
 * ```
 *   167  "Name 169"    the attract branch
 *   168  "frame 2"     0x45df7c  [0x46b208] = -1  ->  char.mov      BEGIN
 *   169  "frame 3"     0x45df8d  [0x46b208] = -2  ->  a save dialog OPEN
 *   170  "frame 4"     0x45e082  [0x46b208] =  3  ->  helpwin.mov   HELP
 *   171  "frame 5"     0x45e093  [0x46b208] =  2  ->  prefs2.mov    PREFS
 *   172  "frame 6"     0x45e0a4  [0x4abdfe] = 11  ->  0x40340f      QUIT
 *   173  "frame 7"     0x45e0be  [0x46b208] =  6  ->  credits.mov   CREDITS
 *   174  "demo frame"  0x45e0cf  the attract branch again
 * ```
 *
 * Two things fall out of that, and both were wrong here before.
 *
 * **Begin does not begin.** It plays `char.mov`, which is the CHARACTER CHOOSER
 * — there are two Skull Crackers and `0x46b1a8` says which (see
 * {@link file://./players.ts}). The game starts after it: `0x403154` finds
 * `[0x46b208] == 3`, drops out of the menu, and the shell's `[0x4abdfe]` is
 * already 3 — `0x4031b2`, the level runner. So Begin -> chooser -> level one,
 * and this page follows that whole chain into `walk.html`.
 *
 * **"frame 6" is Quit, not something to play.** State 11 (`0x40340f`) sets
 * `[0x46b200]` and `0x403433` falls out of the loop into `0x40a4a0`. A browser
 * tab cannot quit itself, so it goes back to the menu and says so.
 */
const EXIT_ACTIONS: Record<string, { play?: readonly string[]; say: string; begin?: boolean; prefs?: boolean }> = {
  "frame 2": { play: ["char.mov"], begin: true, say: "Begin — which of the two Skull Crackers (0x45df7c)" },
  "frame 3": { say: "Open — 0x45df8d's dialog is the executable's, not the film's" },
  /**
   * Help, and it is the one entry where the two releases disagree.
   *
   * Both discs carry BOTH films — `helpmac.mov` and `helpwin.mov`, which differ
   * in the keyboard they draw — and each release's binary names its own: the Mac
   * table reads `helpmac.mov` where the Windows one reads `helpwin.mov`, in
   * otherwise identical lists. A browser is neither, so this takes the Windows
   * one and falls back, on the thin but real ground that whoever is reading it
   * has a PC keyboard in front of them.
   */
  "frame 4": { play: ["HelpWin.Mov", "HelpMac.Mov"], say: "Help — 0x45e082" },
  /**
   * Prefs, and it is the one button the film tries to answer by itself: its stub
   * is a type-3 chain naming `prefs.mov`. The executable does not let it —
   * `0x45e093` sets `[0x46b208] = 2` and `0x4030b1` plays **`prefs2.mov`**, the
   * other of the two thirty-frame panels. So the chain is suppressed and the
   * executable's choice played instead.
   */
  "frame 5": { play: ["Prefs2.Mov", "Prefs.Mov"], prefs: true, say: "Prefs — 0x45e093 plays prefs2.mov, not the stub's prefs.mov" },
  "frame 6": { say: "Quit — state 11, and a tab cannot quit itself" },
  "frame 7": { play: ["Credits.Mov"], say: "Credits — 0x45e0be" },
  // The demo is real and is NOT a film: `skuldemo.dmo` is a `DEMO`/`SKLC`
  // container whose version tag is not 4, so `readMovFile` refuses it and is
  // right to. Whatever a `.dmo` is — an attract-mode recording, most likely —
  // it is a format of this game's own and nothing here reads it.
  "demo frame": { say: "the demo — a .dmo, which is not a film and not a format this port knows" },
};

/**
 * WHICH Skull Cracker, and how hard — the two things the front end settles
 * before the game starts.
 *
 * `0x46b1a8` is the player and `0x46b20c` the difficulty. Both are read all over
 * the executable and neither is in a film, so they travel to `walk.html` in its
 * query string, which is that page's own way of being told anything.
 */
let character: 0 | 1 = 0;
let difficulty: -1 | 0 | 1 = 0;

/**
 * The preferences panel's three difficulty boxes, `0x4791d8`, `0x4791e0` and
 * `0x4791e8` — rects stored `{top, left, bottom, right}` like every rect in this
 * engine, and read out of `.data` rather than measured off the picture.
 *
 * `0x45dbfe`..`0x45dcd4` draws them: `0x409a00(0xd7)` for the one that matches
 * `[0x46b20c]` and `0x409a00(0)` for the other two, `0x434290(rect, 2, 2)` insets
 * each by two, `0x40a1d0` fills it. The clicks are `0x45d700`'s controls 10, 11
 * and 12 — `0x45d788`, `0x45d79b`, `0x45d7ae` — which store 1, 0 and -1.
 *
 * Which end is which is settled by what the number does rather than by the
 * label: `0x42e59a` and `0x448ac2` compute `trunc(difficulty * 600) + 0x4b0`, so
 * +1 is 1800 health and -1 is 600, and `0x40e300(n)` returns `n - (n/2)*d`, so
 * +1 halves a blow and -1 makes it half again as hard. +1 is EASY.
 *
 * The panel's other eleven controls are read and not wired, which is said here
 * rather than left looking finished: eight boxes at `0x479188`..`0x4791c7` set
 * `[0x47917c]` (`0x45d72f`), the slider at `0x4791c8` sets the volume 0..9
 * through `0x4274e0` (`0x45d743`), and the box at `0x4791f0` flips `[0x46b1fc]`,
 * which gates the `0x40f190` calls — a sound switch.
 */
const PREFS_BOXES: readonly { top: number; left: number; bottom: number; right: number; value: -1 | 0 | 1; from: string }[] = [
  { top: 226, left: 123, bottom: 241, right: 138, value: 1, from: "0x4791d8 / 0x45d788" },
  { top: 226, left: 171, bottom: 241, right: 186, value: 0, from: "0x4791e0 / 0x45d79b" },
  { top: 226, left: 219, bottom: 241, right: 234, value: -1, from: "0x4791e8 / 0x45d7ae" },
];
/** the colour `0x409a00` is given for the chosen box */
const PREFS_LIT = 0xd7;
/** true once the prefs film has finished opening its panel and the panel is live */
let prefsOpen = false;
/** the prefs film is playing and the panel it opens is what follows it */
let prefsPending = false;
/** the film that is ending names a chain the executable overrides */
let suppressChain = false;

/**
 * The canvas is the game's screen DOUBLED.
 *
 * Skull Cracker's films are 512x384, the same screen Titanic and Dust use and not
 * Timelapse's 640x480 (read off the frame containers themselves, which carry
 * their own dimensions). Drawing at 2x and letting CSS scale the element means
 * the browser resamples a 1024x768 image rather than a 512x384 one, so a window
 * that is not an exact multiple degrades to something soft rather than to
 * something with torn pixel edges. Dust's page does the same thing for the same
 * reason.
 */
const PLATE = 2;

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("screen");
const ctx = canvas.getContext("2d", { alpha: false })!;
const logEl = $<HTMLPreElement>("log");
const errEl = $<HTMLSpanElement>("err");
const nowEl = $<HTMLPreElement>("loc");

const lines: string[] = [];
function log(line: string): void {
  lines.push(line);
  logEl.textContent = lines.join("\n");
  logEl.scrollTop = logEl.scrollHeight;
}

function fail(what: unknown): void {
  const message = what instanceof Error ? what.message : String(what);
  errEl.textContent = message;
  log(`error: ${message}`);
  // an error opens the log by itself: the page's one job is to say what happened
  logEl.hidden = false;
}

/** the picture, painted from an indexed frame and the segment's own palette */
const rgba = new Uint8ClampedArray(SCREEN_W * SCREEN_H * 4);
const image = new ImageData(SCREEN_W, SCREEN_H);
/** the palette of the last frame painted — what the prefs overlay draws in */
let lastPalette: Uint8ClampedArray | null = null;

function paint(
  pixels: Uint8Array,
  width: number,
  height: number,
  palette: Uint8ClampedArray,
  originX: number,
  originY: number,
): void {
  // A frame may be SMALLER than the screen and sit somewhere on it (menu.mov's
  // popups are 382x356 over the 512x384 board), so the screen is composed here
  // and the frame blitted into it rather than the canvas being resized per
  // frame — which would throw the picture away between frames of one film.
  if (width === SCREEN_W && height === SCREEN_H && !originX && !originY) {
    indexedToRGBA(pixels, width, height, palette, rgba);
  } else {
    const small = indexedToRGBA(pixels, width, height, palette);
    for (let y = 0; y < height; y++) {
      const dy = y + originY;
      if (dy < 0 || dy >= SCREEN_H) continue;
      const from = y * width * 4;
      const to = (dy * SCREEN_W + originX) * 4;
      rgba.set(small.subarray(from, from + Math.min(width, SCREEN_W - originX) * 4), to);
    }
  }
  lastPalette = palette;
  image.data.set(rgba);
  // draw at 1:1 into an offscreen-sized region, then let the 2x canvas scale it.
  // `imageSmoothingEnabled` off is what keeps 1996 art from being blurred by the
  // doubling itself; the browser's own scale down to the window is where any
  // softening is allowed to happen.
  ctx.imageSmoothingEnabled = false;
  const bitmapCanvas = scratch();
  bitmapCanvas.getContext("2d")!.putImageData(image, 0, 0);
  ctx.drawImage(bitmapCanvas, 0, 0, SCREEN_W * PLATE, SCREEN_H * PLATE);
}

/**
 * Put the panel back on screen with its three boxes filled the way `0x45db40`
 * fills them: the chosen one in `0xd7`, the other two in 0, each inset by two.
 *
 * The film has ended by the time this runs — `prefs2.mov` is thirty frames of a
 * panel sliding open and then a type-1 exit — so the last frame is still in
 * {@link rgba} and this composes over it. That is what the original does too: the
 * film opens the panel and the executable owns it from there.
 */
function drawPrefs(): void {
  const pal = lastPalette;
  if (!pal) return;
  image.data.set(rgba);
  for (const box of PREFS_BOXES) {
    const lit = box.value === difficulty;
    const c = lit ? PREFS_LIT * 4 : 0;
    const [r, g, b] = [pal[c], pal[c + 1], pal[c + 2]];
    for (let y = box.top + 2; y < box.bottom - 2; y++) {
      for (let x = box.left + 2; x < box.right - 2; x++) {
        const at = (y * SCREEN_W + x) * 4;
        image.data[at] = r;
        image.data[at + 1] = g;
        image.data[at + 2] = b;
        image.data[at + 3] = 255;
      }
    }
  }
  ctx.imageSmoothingEnabled = false;
  const bitmapCanvas = scratch();
  bitmapCanvas.getContext("2d")!.putImageData(image, 0, 0);
  ctx.drawImage(bitmapCanvas, 0, 0, SCREEN_W * PLATE, SCREEN_H * PLATE);
}

/**
 * Begin is finished asking: hand the whole front end's answer to the level page.
 *
 * `0x403154` is where the original does it — `[0x46b208]` comes back 3 from the
 * chooser, the menu state drops out, and `[0x4abdfe]` is already 3, which is
 * `0x4031b2`, the level runner. There is no level runner in this file, so the
 * two words the front end settled travel to the page that has one.
 */
function begin(): void {
  const to = `walk.html?char=${character}&difficulty=${difficulty}`;
  log(`begin: character ${character}, difficulty ${difficulty} — ${to}`);
  location.href = to;
}

let scratchCanvas: HTMLCanvasElement | null = null;
/** a 1:1 canvas to putImageData into, since putImageData ignores transforms */
function scratch(): HTMLCanvasElement {
  if (!scratchCanvas) {
    scratchCanvas = document.createElement("canvas");
    scratchCanvas.width = SCREEN_W;
    scratchCanvas.height = SCREEN_H;
  }
  return scratchCanvas;
}

// ---------------------------------------------------------------------------
// the film
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// the session
// ---------------------------------------------------------------------------

let files: SkullFiles | null = null;
let sink: AudioSink = new DeferredAudioSink();
let film: Film | null = null;
/** the film we came from, so an exit has somewhere to go back to */
let home = BOOT_MOVIE;
/**
 * What is left of the start sequence.
 *
 * A film ending pops the next one off here before anything else is considered,
 * which is what makes ESC work the way it did in 1996: all three of these set the
 * ESC-skips header bit, so escape ends the logo and the intro begins, escape
 * again and the menu is up. Empty once the menu is reached, and it stays empty.
 */
let queue: string[] = [];

async function playMovie(name: string, isHome = false): Promise<void> {
  const store = files;
  if (!store) return;
  errEl.textContent = "";
  const bytes = store.has(name) ? store.provide(name) : await store.load(name);
  if (!bytes) {
    fail(`${name}: not in this rip`);
    return;
  }
  film?.finish();
  prefsOpen = false;
  if (isHome) home = name;
  try {
    const mov = readMovFile(bytes);
    log(
      `${name}: ${mov.segments.length} segment(s), ${mov.frames.length} frames, ` +
        `${mov.audioChunks.length} bed chunk(s), ${mov.sounds.size} event sound(s)`,
    );
    film = new Film(name, mov, {
      audio: sink,
      paint,
      log,
      onChain: (next) => {
        // ...unless the executable overrode it — see EXIT_ACTIONS' "frame 5"
        if (suppressChain) {
          suppressChain = false;
          log(`${name}: its own chain to ${next} is overridden by 0x45e093`);
          return;
        }
        void playMovie(next);
      },
      // `ltpan.mov` names its first frame as actionframe 1 and `rtpan.mov` names
      // its first as actionframe 2; `0x45e1e0` turns that into `0x46b1a8`
      onAction: (which) => {
        character = which === 1 ? 0 : 1;
        log(`${name}: actionframe ${which} — character ${character} (0x45e369)`);
      },
      onEnd: (lastFrame) => {
        film = null;
        // still starting up: the next film of the sequence, whether this one ran
        // itself out or was skipped
        const next = queue.shift();
        if (next) {
          void playMovie(next, queue.length === 0);
          return;
        }
        // the chooser's own pan has run out: the front end is finished asking
        if (/^(ltpan|rtpan)\.mov$/i.test(name)) {
          begin();
          return;
        }
        // ...and the panel films stop on an open panel, which is the panel
        if (prefsPending) {
          prefsPending = false;
          prefsOpen = true;
          log(`${name}: the panel is open — 0x45db40 owns it from here`);
          drawPrefs();
          return;
        }
        const chose = EXIT_ACTIONS[lastFrame.toLowerCase()] ?? EXIT_ACTIONS[lastFrame];
        if (name === home && chose) {
          log(`${name}: ended on "${lastFrame}" — ${chose.say}`);
          // the first candidate this disc actually carries; back to the menu when
          // the choice leads nowhere this port can follow
          const target = chose.play?.find((n) => store.serves(n));
          if (target && chose.prefs) {
            prefsPending = true;
            suppressChain = true;
          }
          void playMovie(target ?? home, !target);
          return;
        }
        // Any other film that ends goes back to the menu, the MENU included —
        // which is the case that looks redundant and is not. Its header sets the
        // ESC-skips bit, so escape ends it on whatever frame it was animating,
        // and there is nothing behind it: the original handed a skipped menu back
        // to its executable, and here the menu is all there is. Without this the
        // page simply went black and stayed there.
        if (name === home) log(`${name}: ended on "${lastFrame}" — back to the menu`);
        void playMovie(home, true);
      },
    });
  } catch (e) {
    fail(e);
  }
}

/** the point on the game's own 512x384 screen a pointer event landed on */
function screenPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.round(((e.clientX - r.left) / r.width) * SCREEN_W),
    y: Math.round(((e.clientY - r.top) / r.height) * SCREEN_H),
  };
}

function frameLoop(now: number): void {
  film?.tick(now);
  nowEl.textContent = film ? film.where : prefsOpen ? `prefs panel · difficulty ${difficulty}` : "";
  requestAnimationFrame(frameLoop);
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  installVersion();
  const say = $<HTMLSpanElement>("bootsay");
  const pct = $<HTMLSpanElement>("bootpct");
  const charge = $<HTMLDivElement>("charge");
  const conduit = $<HTMLDivElement>("conduit");

  const progress = (fraction: number, what: string): void => {
    const n = Math.max(0, Math.min(100, Math.round(fraction * 100)));
    charge.style.width = `${n}%`;
    conduit.setAttribute("aria-valuenow", String(n));
    pct.textContent = `${n}%`;
    say.textContent = what;
  };

  progress(0, "reading the disc…");
  files = await SkullFiles.open();
  if (!files.size) {
    fail("no game data: gamefiles/ is empty (see taoot/README.md#game-data)");
    progress(0, "no disc");
    return;
  }
  log(`indexed ${files.size} files, ${files.movies().length} of them films`);

  // Fetch only the FIRST film of the sequence before offering the button, and
  // let the sequence pay for the rest of itself.
  //
  // The three films are 4.1, 10.0 and 1.7 MB, and waiting for all 15.8 before
  // anything moves would be a minute of bar on a slow line for a logo that plays
  // in 23 seconds. The logo and the intro run 44 seconds between them, which is
  // time enough to fetch 11.7 MB while the player is watching something — so the
  // gauge measures the film it is actually waiting for, and the other two come
  // down behind it. `SkullFiles.load` dedupes by name, so the prefetch and the
  // sequence's own demand are one fetch however they race.
  const first = BOOT_SEQUENCE[0];
  const want = files.sizeOf(first);
  let got = 0;
  files.onChunk = (name, bytes) => {
    if (name !== first.toLowerCase()) return;
    got += bytes;
    progress(want ? got / want : 0, "loading the opening…");
  };
  const bytes = await files.load(first);
  files.onChunk = null;
  if (!bytes) {
    fail(`${first} is not in this rip — the opening is the one file this page needs`);
    return;
  }
  progress(1, "ready");

  const start = $<HTMLButtonElement>("start");
  start.disabled = false;
  /*
   * The fracture has finished spreading, so it gets out of the way and the one
   * button takes its place — the same handover Dust and Timelapse do, and for the
   * same reason: a full progress bar is a statement about the past, and the only
   * thing the page wants said now is "press this". `.ready` on #boot is what the
   * styles cross-fade on; the two elements share one box, so nothing moves.
   */
  $<HTMLDivElement>("boot").classList.add("ready");
  /*
   * ...and the button takes focus, which those two also do and this did not. Two
   * things came of the omission: a keyboard had no way to start the game without
   * tabbing to find the only control on the page, and the button was missing the
   * `:focus-visible` ring the other two wear — which is why it still looked
   * flatter than theirs after the geometry already matched.
   */
  start.focus();

  start.addEventListener("click", () => {
    // an AudioContext may only be built from a gesture, and this is the gesture
    const real = new WebAudioSink();
    (sink as DeferredAudioSink).attach?.(real);
    sink = real;
    document.body.classList.remove("booting");
    document.body.classList.add("playing");
    // behind the opening, while it plays
    for (const later of BOOT_SEQUENCE.slice(1)) void files!.load(later);
    queue = BOOT_SEQUENCE.slice(1);
    void playMovie(first, queue.length === 0);
  });
}

// ---- the controls, which are the ones every page in the project has ----------

$<HTMLButtonElement>("logBtn").addEventListener("click", () => {
  logEl.hidden = !logEl.hidden;
});

$<HTMLButtonElement>("fsBtn").addEventListener("click", () => {
  const stage = $<HTMLDivElement>("frame");
  if (document.fullscreenElement) void document.exitFullscreen();
  else void stage.requestFullscreen().catch((e) => fail(e));
});

/**
 * Whether this page offers to file a bug, and it does not yet.
 *
 * The other three pages are ports of adventures the engine actually runs, so "the
 * port gets this wrong" is a reportable thing there. This one is a film player and
 * a walkable experiment over a game whose logic is a PowerPC binary, and most of
 * what it gets wrong is what it has not read yet — so the button is off until the
 * port is worth reporting against. One flag: turn it true and everything below
 * wakes up, markup included.
 */
const BUG_REPORTS = false;

const bugBtn = $<HTMLButtonElement>("bugBtn");
if (BUG_REPORTS) {
  installBugReport(bugBtn, {
    canvas,
    where: () => film?.where ?? "",
    edition: () => "Skull Cracker (gamefiles/SKULL/)",
    log: (n) => lines.slice(-n),
    shotName: "skullcracker.png",
    version: VERSION,
    // bracketed into the issue title, so one repository's issue list stays
    // scannable across four games (site/src/bug-report.ts says why the page
    // supplies it rather than this being derived)
    game: "Skull Cracker",
    note: (how) => {
      $<HTMLSpanElement>("bugNote").textContent =
        how === "clipboard" ? "screenshot copied" : "screenshot downloaded";
    },
  });
} else {
  bugBtn.hidden = true;
  $<HTMLSpanElement>("bugNote").hidden = true;
}

/** a click on the 512x384 screen, from whichever pointer sent it */
function clickAt(x: number, y: number): void {
  // the open preferences panel owns the screen: it has no regions of its own
  // because the film has none — `0x45d700` is the executable's own hit test
  if (prefsOpen) {
    const box = PREFS_BOXES.find((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom);
    if (box) {
      difficulty = box.value;
      log(`prefs: difficulty ${difficulty} (${box.from})`);
      drawPrefs();
      return;
    }
    log(`prefs: nothing at ${x},${y} — ESC closes the panel`);
    return;
  }
  if (!film?.click(x, y, performance.now())) log(`click at ${x},${y} — no region there`);
}

/**
 * A finger on the glass, on the shared recogniser.
 *
 * This page uses TWO of the four gestures the recogniser knows, and the two it
 * drops are dropped because the GAME has nothing for them, not because a film
 * player is a lesser thing to touch:
 *
 * - **tap** is the click, which is the whole of the menu.
 * - **double-tap** is `ESCAPE`, and here that is the only way to skip a film on a
 *   machine with no keyboard. It was reachable by keyboard alone before this.
 * - **swipe** would be an arrow key, and nothing in this page reads one: there is
 *   no interpreter to send it to, no `keyrepeat`, no navigation. A swipe is
 *   logged and dropped, which is at least sayable in the log when someone
 *   wonders why the picture did not move.
 * - **hold-to-drag** has nothing to drag. A click here is atomic — `Film.click`
 *   acts on the region and returns — so there is no `stilldown()` loop and no
 *   `pointerDown` for a script to poll. {@link TouchHooks.release} is a no-op,
 *   which is the honest implementation and not a stub.
 *
 * And so there is no {@link bindSwipeInvert} and no pair of checkboxes: the two
 * axes it inverts are the two this page does not read, and a setting that
 * controls nothing is worse than an absent one.
 */
const touch = new TouchGestures({
  coords: (e: PointerEventLike) => (film || prefsOpen ? screenPoint(e) : null),
  // a region takes its press at once, so the menu answers a thumb the moment it
  // lands rather than 220 ms later — and the PICTURE keeps the wait, which is
  // what leaves double-tap-to-skip available exactly where a film is playing
  ownedByGame: (x, y) =>
    prefsOpen
      ? PREFS_BOXES.some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom)
      : (film?.owns(x, y) ?? false),
  press: (x, y) => clickAt(x, y),
  // nothing is held: see the note above
  release: () => {},
  sendKey: (key: GestureKey) => {
    if (key === ESCAPE_KEY) {
      if (prefsOpen) {
        prefsOpen = false;
        void playMovie(home, true);
        return;
      }
      if (!film?.skip()) log("double-tap: this film does not allow skipping");
      return;
    }
    log(`swipe: ${key} — this page reads no arrows`);
  },
});

canvas.addEventListener("pointerdown", (e) => {
  // a finger is ambiguous until it moves or stays put — see TouchGestures
  if (e.pointerType === "touch") {
    touch.down(e);
    return;
  }
  if (!film && !prefsOpen) return;
  const { x, y } = screenPoint(e);
  clickAt(x, y);
});

// on the window, not the canvas: a gesture that ends off-canvas still has to end
addEventListener("pointermove", (e) => {
  if (touch.owns(e)) touch.move(e);
});
addEventListener("pointerup", (e) => {
  touch.up(e);
});
/** a gesture the browser took away (a system edge-swipe) */
addEventListener("pointercancel", (e) => touch.cancel(e));

window.addEventListener("keydown", (e) => {
  if (focusOwnsKey(e.target, e.key)) return;
  if (e.key === "Escape" || e.key === ESCAPE_KEY) {
    if (prefsOpen) {
      prefsOpen = false;
      void playMovie(home, true);
      e.preventDefault();
      return;
    }
    if (film?.skip()) e.preventDefault();
  } else if (e.key === "b") {
    logEl.hidden = !logEl.hidden;
  }
});

requestAnimationFrame(frameLoop);
void boot().catch(fail);
