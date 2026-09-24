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
import { LEVEL_ORDER } from "@dreamfactory/engine/df/sbk";
import { indexedToRGBA } from "@dreamfactory/engine/df/image";
import { AudioSink, DeferredAudioSink, WebAudioSink } from "@dreamfactory/engine/runtime/audio";
import { installFullscreen } from "@dreamfactory/engine/web/fullscreen";
import { SCREEN_H, SCREEN_W } from "@dreamfactory/engine/web/screen";
import { ESCAPE_KEY, focusOwnsKey } from "@dreamfactory/engine/web/keys";
import { GestureKey, PointerEventLike, TouchGestures } from "@dreamfactory/engine/web/touch";
import { installBugReport } from "@dreamfactory/site/bug-report";
import { VERSION, installVersion } from "@dreamfactory/site/version";
import { SkullFiles } from "./files";
import { SkullSave, readSkl, SKL } from "./savegame";
// puts `mobile` on <html> for the landscape rules in index.html
import "./mobile";
import { Film } from "./film";
import {
  DOSSIER,
  DOSSIERS,
  PREFS_ACTIONS,
  PREFS_CONTROLS,
  PREFS_INK,
  PrefsControl,
  PrefsState,
  VOLUME,
  bindKey,
  clampVolume,
  keyName,
  loadPrefs,
  savePrefs,
  volumeAt,
} from "./prefs";
import { BOARD, ScoreBoards, boardKey, loadBoards } from "./scores";

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
 *   169  "frame 3"     0x45df8d  [0x46b208] = -1  ->  a .SKL file    OPEN
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
const EXIT_ACTIONS: Record<
  string,
  { play?: readonly string[]; say: string; begin?: boolean; prefs?: boolean; open?: boolean }
> = {
  "frame 2": { play: ["char.mov"], begin: true, say: "Begin — which of the two Skull Crackers (0x45df7c)" },
  /**
   * Open, and it IS a save game. This page said otherwise for a long time.
   *
   * `0x45df8d` builds a `GetOpenFileNameA` filter out of the resource string
   * `Saved games (.SKL)|*.skl||` — UTF-16, at `0x4b62f8`, which is why an ASCII
   * search of the executable for "SKL" turns up nothing and why this entry used
   * to name the demo instead. It reads twenty-two bytes (`0x45dfec`), hands them
   * to `0x40d430` and `0x40d400` — the score and the lives — restores
   * `[0x4abdfe]`, `[0x4abdfc]`, the weapon and its rounds, and sets `[0x47913c]`
   * so the chapter's entry function does not zero the inventory it just filled.
   * {@link file://./savegame.ts} lays the record out.
   *
   * The last thing it does is `[0x46b208] = -1`, which is the value BEGIN sets:
   * a loaded game goes through the character chooser like a new one, because the
   * file carries no character.
   *
   * The demo is elsewhere and is two other hotspots — `0x45deff` at frame 167
   * and `0x45e0cf` at 174, the board's own panel — and both play a slot of
   * `skuldemo.dmo` through `0x4034a0`. That is an INPUT RECORDING, and replaying
   * a 1996 input stream against a re-implementation only demonstrates the
   * desync; it is still not built.
   */
  "frame 3": { play: ["char.mov"], begin: true, open: true, say: "Open — 0x45df8d loads a .SKL saved game" },
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
   * Prefs, and there are TWO thirty-frame panels because the panel has to arrive
   * and leave. Which is which is settled by the ORDER in `0x40307c`'s loop:
   *
   * ```
   *   403085  0x4498c0(Menu.Mov)      ; play the menu and wait for it to end
   *   40309d  ax = [0x46b208]         ; what its own exit frame set
   *   4030a6  cmp ax, 2               ; ...2 is this button
   *   4030ac  call 0x45d5a0           ; the MODAL, on a panel that is ALREADY up
   *   4030b1  0x4498c0(prefs2.mov)    ; and only then this film
   *   4030cc  jmp 0x40307c            ; back to the menu
   * ```
   *
   * A film played after the modal has finished can only be the panel going away.
   * So `prefs.mov` — the chain the menu's own frame 5 names — is the panel
   * sliding IN, and `prefs2.mov` is it sliding out. This page had them the wrong
   * way round and suppressed the chain, which played the closing animation to
   * open it: the panel slid off the screen and then answered clicks.
   */
  "frame 5": { play: ["Prefs.Mov", "Prefs2.Mov"], prefs: true, say: "Prefs — the chain to prefs.mov opens it; 0x4030b1's prefs2.mov closes it" },
  // (the pair is PREFS_FILMS; this list is its `open` half)
  "frame 6": { say: "Quit — state 11, and a tab cannot quit itself" },
  "frame 7": { play: ["Credits.Mov"], say: "Credits — 0x45e0be" },
  // The demo is real and is NOT a film: `skuldemo.dmo` is a `DEMO`/`SKLC`
  // container whose version tag is not 4, so `readMovFile` refuses it and is
  // right to. What it holds is settled now — see "frame 3" above: one signed
  // action word per engine frame, which is a recording of somebody playing.
  "demo frame": { say: "the demo — skuldemo.dmo's recorded input, which this port does not replay" },
};

/**
 * WHICH Skull Cracker, how hard, and the rest of what the front end settles.
 *
 * `0x46b1a8` is the player and `0x46b20c` the difficulty. Both are read all over
 * the executable and neither is in a film, so they travel to `walk.html` in its
 * query string, which is that page's own way of being told anything. The three
 * the panel settles that have no query string — the eight bindings, the volume
 * and the music switch — travel in {@link file://./prefs.ts}'s store instead.
 *
 * The preferences panel, and all fourteen of its controls are live.
 *
 * The rects, the roles, the colours and the binding rule are
 * {@link file://./prefs.ts}, read out of `.data` and out of `0x45d5a0`'s modal
 * loop rather than measured off the picture. What is left here is the drawing
 * and the clicking, because those are this page's.
 *
 * Which end of the difficulty is which is settled by what the number does rather
 * than by the label: `0x42e59a` and `0x448ac2` compute `trunc(difficulty * 600)
 * + 0x4b0`, so +1 is 1800 health and -1 is 600, and `0x40e300(n)` returns
 * `n - (n/2)*d`, so +1 halves a blow and -1 makes it half again as hard. +1 is
 * EASY.
 */
const prefs: PrefsState = loadPrefs();
/** which of the eight key boxes is selected — `[0x47917c]`, and it starts at 0 */
let prefsBox = 0;

/**
 * The high-score board, and `0x45de89` is what says where it belongs.
 *
 * `0x45ddd0` is the menu's per-frame handler. While `[0x46b208]` is 1 — the menu
 * — and the film's frame index is 0…0xa7, it draws the board over whatever the
 * film is showing. 0xa7 is 167 and `"frame 2"` is index 168, so that range is
 * exactly `menu.mov`'s attract loop and stops where the button stubs begin.
 *
 * The rows are {@link file://./scores.ts}; this is the drawing.
 */
const boards: ScoreBoards = loadBoards();
/** true once the prefs film has finished opening its panel and the panel is live */
let prefsOpen = false;
/** the prefs film is playing and the panel it opens is what follows it */
let prefsPending = false;
/** the film that is ending names a chain the executable overrides */
let suppressChain = false;
/** the closing panel is playing, and the menu is what follows it — `0x4030cc` */
let prefsClosing = false;

/**
 * The two panels, and which way round they go — see EXIT_ACTIONS' "frame 5".
 *
 * Each is a list because a rip may carry either spelling, and the first one the
 * store actually serves is the one played.
 */
const PREFS_FILMS = {
  open: ["Prefs.Mov", "Prefs2.Mov"],
  close: ["Prefs2.Mov", "Prefs.Mov"],
} as const;

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
  compose(palette);
}

/**
 * Which film and frame the overlays were last drawn for.
 *
 * The board and the dossier are drawn AFTER the film's blit, so they only exist
 * on a frame something blitted. Two things break that, and the menu is where
 * both show:
 *
 *   - `paint` is handed to `new Film(...)`, so the first frame of a film is
 *     blitted while the module's own `film` is still the previous one or null —
 *     and {@link drawBoard} asks `film.name`, so it declines to draw;
 *   - `menu.mov`'s frame 1 is a type-2 frame whose target is ITSELF. The menu is
 *     a still. The film is right to blit once and stop, and there is no second
 *     blit to draw the board on.
 *
 * Together those left the high-score board off the menu entirely — the one place
 * `0x45de89` draws it — and flashing up for a frame in the transitions, which is
 * where it was being seen instead. So the overlays are no longer the blit's
 * passengers: {@link frameLoop} re-composes whenever they are stale for the
 * frame that is actually up.
 */
let composedName = "";
let composedAt = -1;

/** the film's last frame, and then whatever the executable draws on top of it */
function compose(palette: Uint8ClampedArray): void {
  // draw at 1:1 into an offscreen-sized region, then let the 2x canvas scale it.
  // `imageSmoothingEnabled` off is what keeps 1996 art from being blurred by the
  // doubling itself; the browser's own scale down to the window is where any
  // softening is allowed to happen.
  ctx.imageSmoothingEnabled = false;
  const bitmapCanvas = scratch();
  bitmapCanvas.getContext("2d")!.putImageData(image, 0, 0);
  ctx.drawImage(bitmapCanvas, 0, 0, SCREEN_W * PLATE, SCREEN_H * PLATE);
  drawBoard(palette);
  drawDossier(palette);
  composedName = film?.name ?? "";
  composedAt = film?.frameIndex ?? -1;
}

/**
 * The chosen character's dossier, into the hole the pan film leaves.
 *
 * `ltpan.mov` and `rtpan.mov` slide one picture aside and a BLANK panel in, and
 * the blank is the executable's to fill: `0x45e14c` waits for frame 0x2a and
 * calls `0x45e390` or `0x45e520` by `[0x46b1a8]`. This page played the films and
 * left the panel empty, which is what the hole is for.
 *
 * The engine writes it once, into the surface, and the frames after it only
 * touch what changed; this page composes every frame from scratch, so it writes
 * it on frame 42 and on every frame after — which is the same picture.
 *
 * See {@link DOSSIERS}. The font is the browser's, for the reason the board's
 * and the panel's are: `0x40a360` draws through the host and there is no glyph
 * data in the rip.
 */
function drawDossier(pal: Uint8ClampedArray): void {
  const at = film?.frameIndex ?? -1;
  if (!film || !/^(ltpan|rtpan)\.mov$/i.test(film.name)) return;
  if (at < DOSSIER.onFrame) return;
  const who = DOSSIERS[prefs.character === 1 ? 1 : 0];
  const c = DOSSIER.ink * 4;
  ctx.font = `${11 * PLATE}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = `rgb(${pal[c]}, ${pal[c + 1]}, ${pal[c + 2]})`;
  let y = who.y;
  for (const line of who.lines) {
    ctx.fillText(line, who.x * PLATE, y * PLATE);
    y += DOSSIER.lineStep;
  }
  // `0x45e4d5` / `0x45e64b` — the plate is offset from where the seven ended
  ctx.fillText(who.plate.text, (who.x + who.plate.dx) * PLATE, (who.y + who.plate.dy) * PLATE);
}

/**
 * The board over the menu's attract loop — `0x40f990`, twice.
 *
 * Two passes with the same point: the first offset by (2, 1) in `0xe8`, the
 * second square in `0xe1`. The only thing they do differently is the difficulty
 * heading — the shadow draws all three of `Easy`, `Med` and `Hard` and the
 * second draws only the one `[0x46b20c]` is on, which is how the board says
 * which of its three tables you are looking at.
 *
 * The font is the browser's, for the same reason the preferences panel's is:
 * `0x40a360` draws through the host's text routines and there is no glyph data
 * in the rip to read.
 */
function drawBoard(pal: Uint8ClampedArray): void {
  const at = film?.frameIndex ?? -1;
  if (!film || film.name.toLowerCase() !== BOOT_MOVIE.toLowerCase()) return;
  if (at < 0 || at > BOARD.attractUntilFrame) return;
  const rows = boards[boardKey(prefs.difficulty)];
  ctx.font = `${11 * PLATE}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  ctx.textBaseline = "alphabetic";
  for (const pass of [BOARD.shadow, { dx: 0, dy: 0, ink: BOARD.ink }]) {
    const shadow = pass.ink === BOARD.shadow.ink;
    const x = BOARD.x + pass.dx;
    const y = BOARD.y + pass.dy;
    const c = pass.ink * 4;
    ctx.fillStyle = `rgb(${pal[c]}, ${pal[c + 1]}, ${pal[c + 2]})`;
    const write = (text: string, atX: number, atY: number): void =>
      ctx.fillText(text, atX * PLATE, atY * PLATE);
    for (const h of BOARD.headings) write(h.text, x + h.dx, y);
    for (const label of BOARD.labels) {
      if (!shadow && label.key !== boardKey(prefs.difficulty)) continue;
      write(label.text, x + label.dx, y + BOARD.labelDy);
    }
    rows.forEach((row, i) => {
      const rowY = y + BOARD.firstRowDy + i * BOARD.rowHeight;
      write(row.name || BOARD.emptyName, x + BOARD.nameDx, rowY);
      // `0x40fc94` nudges a filled cell ten pixels left; an empty one keeps the column
      write(row.score ? String(row.score) : BOARD.emptyCell, x + BOARD.scoreDx - (row.score ? BOARD.filledNudge : 0), rowY);
      write(row.level ? String(row.level) : BOARD.emptyCell, x + BOARD.levelDx, rowY);
    });
  }
}

/**
 * `0x45db40` — put the panel's fourteen controls back over the film's last frame.
 *
 * The film has ended by the time this runs — `prefs2.mov` is thirty frames of a
 * panel sliding open and then a type-1 exit — so the last frame is still in
 * {@link rgba} and this composes over it. That is what the original does too: the
 * film opens the panel and the executable owns it from there, which is why the
 * panel has no regions and why ESC is not what leaves it.
 *
 * Three shapes, in the order `0x45db40` draws them:
 *
 *   - **the eight key boxes**, filled whole (`0x40a0c0`, no inset) in `0xe1` when
 *     selected and 0 when not, with the bound key's name drawn at
 *     `(left + 9, bottom - 5)` — and four pixels left of that when the name is
 *     two characters wide, which `Sp` and the four joystick buttons are.
 *   - **the three difficulty boxes and the music box**, each inset by two and
 *     filled `0xd7` or 0.
 *   - **the slider's ten segments**, each eight wide and ten apart.
 *
 * The one thing here that is not the executable's is the FONT. `0x40a360` draws
 * through the host's own text routines — there is no glyph data in the rip to
 * read — so the browser's monospace face stands in, at the size the 19-pixel box
 * leaves room for.
 */
function inkOf(pal: Uint8ClampedArray, index: number): string {
  const c = index * 4;
  return `rgb(${pal[c]}, ${pal[c + 1]}, ${pal[c + 2]})`;
}

function fillRect(pal: Uint8ClampedArray, index: number, box: { top: number; left: number; bottom: number; right: number }): void {
  const c = index * 4;
  const [r, g, b] = [pal[c], pal[c + 1], pal[c + 2]];
  for (let y = Math.max(0, box.top); y < Math.min(SCREEN_H, box.bottom); y++) {
    for (let x = Math.max(0, box.left); x < Math.min(SCREEN_W, box.right); x++) {
      const at = (y * SCREEN_W + x) * 4;
      image.data[at] = r;
      image.data[at + 1] = g;
      image.data[at + 2] = b;
      image.data[at + 3] = 255;
    }
  }
}

function drawPrefs(): void {
  const pal = lastPalette;
  if (!pal) return;
  image.data.set(rgba);
  const labels: { text: string; x: number; y: number; ink: string }[] = [];
  for (const [i, control] of PREFS_CONTROLS.entries()) {
    const role = control.role;
    if (role.kind === "key") {
      const chosen = i === prefsBox;
      fillRect(pal, chosen ? PREFS_INK.selected : PREFS_INK.unselected, control);
      const name = keyName(prefs.keys[role.action - 1]);
      labels.push({
        text: name,
        x: control.left + 9 - (name.length === 2 ? 4 : 0),
        y: control.bottom - 5,
        ink: inkOf(pal, chosen ? PREFS_INK.labelOnSelected : PREFS_INK.label),
      });
      continue;
    }
    if (role.kind === "difficulty" || role.kind === "music") {
      const chosen = role.kind === "music" ? prefs.music : role.value === prefs.difficulty;
      fillRect(pal, chosen ? PREFS_INK.lit : PREFS_INK.unselected, {
        top: control.top + 2,
        left: control.left + 2,
        bottom: control.bottom - 2,
        right: control.right - 2,
      });
      continue;
    }
    if (role.kind !== "volume") continue;
    for (let seg = 0; seg < VOLUME.steps; seg++) {
      const ink = seg > prefs.volume ? PREFS_INK.unselected : seg <= VOLUME.loudFrom - 1 ? PREFS_INK.low : PREFS_INK.lit;
      const left = control.left + seg * VOLUME.stride;
      fillRect(pal, ink, {
        top: control.top + VOLUME.inset,
        left: left + VOLUME.inset,
        bottom: control.bottom - VOLUME.inset,
        right: left + VOLUME.width - VOLUME.inset,
      });
    }
  }
  ctx.imageSmoothingEnabled = false;
  const bitmapCanvas = scratch();
  bitmapCanvas.getContext("2d")!.putImageData(image, 0, 0);
  ctx.drawImage(bitmapCanvas, 0, 0, SCREEN_W * PLATE, SCREEN_H * PLATE);
  ctx.font = `${11 * PLATE}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  ctx.textBaseline = "alphabetic";
  for (const label of labels) {
    if (!label.text) continue;
    ctx.fillStyle = label.ink;
    ctx.fillText(label.text, label.x * PLATE, label.y * PLATE);
  }
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
  savePrefs(prefs);
  /**
   * ...and the game is PLAYED, which the bench is not.
   *
   * `damage` and `foehit` are the level runner's two switches and both start
   * off there, for a reason that is about testing and not about the game: the
   * thirty-six browser suites walk routes through sixteen levels, and with the
   * presses, the girders, TOWER's current and every fist live, a route test
   * becomes a fight and stops measuring what it was written to measure. That is
   * a fact about `walk.html?level=N`, which is the bench.
   *
   * It was never a fact about the GAME. A player who came through the front
   * door — logo, intro, menu, the chooser — is playing Skull Cracker, and Skull
   * Cracker can kill you: the health, the knockdown, the seven KILL films and
   * the lives are all here and were all unreachable from this door. So the two
   * switches are thrown HERE, where the game begins, and nowhere else. The
   * bench keeps its defaults and every suite is untouched.
   */
  let to = `?char=${prefs.character}&difficulty=${prefs.difficulty}&damage=1&foehit=1`;
  // ...and a loaded game brings four more numbers with it and nothing else. The
  // file has no character and no difficulty in it, which is exactly why
  // `0x45e071` sets `[0x46b208]` to the same -1 Begin does: the chooser runs
  // either way and the front end's own answers stand.
  if (loaded) {
    to +=
      `&level=${loaded.level + 1}&score=${loaded.score}&lives=${loaded.lives}` +
      `&weapon=${loaded.weapon}&rounds=${loaded.rounds}`;
    log(`begin: loaded ${LEVEL_ORDER[loaded.level]} — ${loaded.score} points, ${loaded.lives} lives`);
  }
  log(`begin: character ${prefs.character}, difficulty ${prefs.difficulty} — ${to}`);
  void handOver(to);
}

/**
 * Hand the screen to the level runner, in this page, without leaving it.
 *
 * This used to be `location.href = "walk.html?..."`, and the split it made was
 * the wrong way round: the game went to the page that says in its own header
 * that it is an experiment, and the page that claims to BE Skull Cracker stopped
 * at the menu. Now the front end plays the whole thing — logo, intro, menu,
 * chooser, levels — and `walk.html` is what it always should have been, the
 * level bench a developer opens on one level at a time.
 *
 * The two words the chooser settled still travel in the query string, because
 * that is what the level runner reads them out of; `replaceState` puts them
 * there without a navigation. What follows is the swap: stop this page's loop,
 * clear its chrome off the stage, give the canvas the level runner's own
 * 512x384 (the front end's films are twice that), put the two elements it looks
 * up by id on the page, and only then import it — `src/walk.ts` reads the DOM
 * and the search string as it loads, so both have to be true first.
 */
async function handOver(query: string): Promise<void> {
  history.replaceState(null, "", `${location.pathname}${query}`);
  handedOver = true;
  film = null;
  for (const id of ["curtain", "under", "log", "loc", "netbusy"])
    document.getElementById(id)?.setAttribute("hidden", "");
  const canvas = $<HTMLCanvasElement>("screen");
  canvas.width = 512;
  canvas.height = 384;
  const frame = canvas.parentElement ?? document.body;
  // the level runner looks these two up by id as it loads. The chooser is the
  // bench's, not the game's — `[` and `]` still step through the sixteen — so
  // it is here to be found and not to be seen
  const pick = document.createElement("select");
  pick.id = "level";
  pick.hidden = true;
  const hud = document.createElement("div");
  hud.id = "hud";
  // Present and WRITTEN, but not shown. It is the level bench's status line —
  // the player's x and y, the cel on screen, the room, the camera, every prop
  // in reach — and `walk.html` is where a bench belongs. On THIS page it was a
  // paragraph of numbers under the picture of a game somebody is playing.
  // `walk.ts` fills it either way, so the suites that read `#hud` read it off
  // walk.html exactly as they did.
  hud.hidden = true;
  hud.style.cssText =
    "font-size:0.8rem;color:var(--text-mute,#7a9a7a);text-align:center;" +
    "max-width:60rem;padding:0.4rem 1rem;margin:0 auto";
  frame.append(pick, hud);
  await import("./walk");
}

/** the `.SKL` the Open button read, carried to {@link begin} */
let loaded: SkullSave | null = null;

/**
 * Ask for a saved game — `GetOpenFileNameA`, as near as a page gets to one.
 *
 * The input is made here rather than put in the markup because it is the only
 * thing on this page that is not the film. Resolves to false when the reader
 * chose nothing or chose something that is not twenty-two bytes, and the caller
 * then goes back to the menu — which is what `0x45dfc7` does when the dialog
 * comes back empty.
 */
function askForSave(): Promise<boolean> {
  return new Promise((done) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".skl,application/octet-stream";
    input.style.display = "none";
    document.body.appendChild(input);
    let answered = false;
    const finish = (ok: boolean): void => {
      if (answered) return;
      answered = true;
      input.remove();
      done(ok);
    };
    input.addEventListener("cancel", () => finish(false));
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return finish(false);
      void file.arrayBuffer().then((buf) => {
        const save = readSkl(new Uint8Array(buf));
        if (!save) {
          log(`open: ${file.name} is ${buf.byteLength} bytes; a saved game is ${SKL.bytes}`);
          return finish(false);
        }
        if (save.level < 0) {
          log(`open: ${file.name} names scene ${save.scene} stage ${save.stage}, which is not one of the sixteen`);
          return finish(false);
        }
        loaded = save;
        log(
          `open: ${file.name} — ${LEVEL_ORDER[save.level]} (scene ${save.scene}, stage ${save.stage}), ` +
            `${save.score} points, ${save.lives} lives, weapon ${save.weapon} with ${save.rounds}`,
        );
        finish(true);
      });
    });
    input.click();
  });
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
        prefs.character = which === 1 ? 0 : 1;
        log(`${name}: actionframe ${which} — character ${prefs.character} (0x45e369)`);
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
        // ...the panel LEAVING ends at the menu, which is `0x4030cc`'s jump back
        // to the top of the loop
        if (prefsClosing) {
          prefsClosing = false;
          log(`${name}: the panel is away — back to the menu`);
          void playMovie(home, true);
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
          // Open asks for the file BEFORE the chooser, exactly as `0x45df8d`
          // does: the dialog comes first and `0x45dfc7` goes back to the menu
          // when it comes back empty. The click that ended the film is still the
          // gesture the picker needs.
          // ...and any other way out of the menu forgets a file that was read
          // and then walked away from: the chooser can be abandoned back to the
          // menu, and the next Begin is a NEW game
          if (!chose.open) loaded = null;
          if (chose.open) {
            loaded = null;
            void askForSave().then((got) => void playMovie(got && target ? target : home, !(got && target)));
            return;
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

/** what the board is showing, for the status line and for a probe */
function boardSay(): string {
  const at = film?.frameIndex ?? -1;
  if (!film || film.name.toLowerCase() !== BOOT_MOVIE.toLowerCase()) return "";
  if (at < 0 || at > BOARD.attractUntilFrame) return "";
  const key = boardKey(prefs.difficulty);
  const rows = boards[key];
  const label = BOARD.labels.find((l) => l.key === key)?.text ?? "";
  const three = rows
    .slice(0, 3)
    .map((r, i) => `${i + 1} ${r.name || BOARD.emptyName} ${r.score || BOARD.emptyCell} ${r.level || BOARD.emptyCell}`)
    .join(" · ");
  return ` · board ${label} · ${three}`;
}

/**
 * Once the level page has the screen, the front end stops drawing on it.
 *
 * See {@link begin}: the menu does not navigate away any more, so its own loop
 * has to let go or it would keep blitting a film over a level.
 */
let handedOver = false;

function frameLoop(now: number): void {
  if (handedOver) return;
  film?.tick(now);
  // ...and if the overlays are stale for the frame that is up, draw them. See
  // {@link composedAt}: a still film never asks for a second blit, and the
  // board belongs on the stillest screen in the game.
  if (film && lastPalette && (film.name !== composedName || film.frameIndex !== composedAt)) {
    compose(lastPalette);
  }
  nowEl.textContent = film
    ? film.where + boardSay()
    : prefsOpen
      ? `prefs panel · difficulty ${prefs.difficulty} · volume ${prefs.volume} · music ${prefs.music ? "on" : "off"} · ` +
        PREFS_ACTIONS.map((a) => `${a.say} ${keyName(prefs.keys[a.action - 1]) || "--"}`).join(" ")
      : "";
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

// The STAGE, not the frame — this page was the odd one out. #frame is the
// picture plus two mouldings, so handing THAT to the UA stretched the moulding
// to the height of a monitor; the other three ports all fill with #stage and
// take the moulding off in `#stage.fs`. A class and not the `:fullscreen`
// pseudo because an iPhone has no element fullscreen to match, and the page
// fills itself there instead — engine/src/web/fullscreen.ts.
installFullscreen($<HTMLButtonElement>("fsBtn"), $<HTMLDivElement>("stage"), { report: log });

/**
 * Whether this page offers to file a bug. It does now.
 *
 * It did not, and the reason it did not has expired. This used to be a film
 * player over a menu, with the walking kept on another page that says in its own
 * header that it is an experiment — and "the port gets this wrong" is not a
 * useful thing to say about a page whose gaps are all "not read yet". What this
 * page is now is the game: logo, intro, menu, the chooser, sixteen levels and
 * the credits, all of it in this document. A player who meets a wall they cannot
 * pass or a foe that will not die has something worth reporting, and until this
 * flag turned over they had nowhere to report it from.
 */
const BUG_REPORTS = true;

const bugBtn = $<HTMLButtonElement>("bugBtn");
if (BUG_REPORTS) {
  installBugReport(bugBtn, {
    canvas,
    // ...and WHERE is not always a film any more. Once the chooser has handed
    // the canvas to the level runner this page stops drawing, `film` is null for
    // good, and the level's own status line is what knows where the player is —
    // its first fields are the level, the room and the position, which is
    // exactly what a bug report means by "where".
    where: () => {
      if (film) return film.where;
      const line = document.getElementById("hud")?.textContent ?? "";
      return line.split(" · ").slice(0, 4).join(" · ");
    },
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

/** the control under a point, `0x45d640`'s loop over the fourteen rects */
function prefsHit(x: number, y: number): PrefsControl | undefined {
  return PREFS_CONTROLS.find((c) => x >= c.left && x <= c.right && y >= c.top && y <= c.bottom);
}

/** leave the panel the way control 8 does: `0x45d73f` returns 0 and the loop ends */
function closePrefs(why: string): void {
  prefsOpen = false;
  savePrefs(prefs);
  log(`prefs: ${why}`);
  // `0x4030b1` — the modal has returned, so this is the panel leaving. The menu
  // comes back after it, which is `0x4030cc`'s jump.
  const out = PREFS_FILMS.close.find((n) => files?.serves(n));
  if (!out) {
    void playMovie(home, true);
    return;
  }
  prefsClosing = true;
  void playMovie(out, false);
}

/** a click on the 512x384 screen, from whichever pointer sent it */
function clickAt(x: number, y: number): void {
  // the open preferences panel owns the screen: it has no regions of its own
  // because the film has none — `0x45d700` is the executable's own hit test
  if (prefsOpen) {
    const control = prefsHit(x, y);
    if (!control) {
      log(`prefs: nothing at ${x},${y} — the button at the bottom right closes the panel`);
      return;
    }
    const role = control.role;
    if (role.kind === "ok") {
      closePrefs(`done (${control.from})`);
      return;
    }
    if (role.kind === "key") {
      prefsBox = PREFS_CONTROLS.indexOf(control);
      log(`prefs: ${PREFS_ACTIONS[role.action - 1].say} selected — type a letter to bind it (${control.from})`);
    } else if (role.kind === "difficulty") {
      prefs.difficulty = role.value;
      log(`prefs: difficulty ${prefs.difficulty} (${control.from})`);
    } else if (role.kind === "volume") {
      prefs.volume = volumeAt(x, control);
      log(`prefs: volume ${prefs.volume} (${control.from})`);
    } else {
      prefs.music = !prefs.music;
      log(`prefs: music ${prefs.music ? "on" : "off"} (${control.from})`);
    }
    savePrefs(prefs);
    drawPrefs();
    return;
  }
  if (!film?.click(x, y, performance.now())) log(`click at ${x},${y} — no region there`);
}

/**
 * A key while the panel is open — `0x45d67d`, the event loop's third case.
 *
 * The modifier word decides which of two things a key means (`test ..., 0x1fa0`):
 * held, `T` toggles the music and a digit sets the volume outright; not held,
 * the character is uppercased and offered to the selected box. Returns true when
 * the panel took the key.
 */
function prefsKey(e: KeyboardEvent): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey) {
    if (e.key === "t" || e.key === "T") {
      prefs.music = !prefs.music;
      log(`prefs: music ${prefs.music ? "on" : "off"} (0x45d6a0)`);
    } else if (/^[0-9]$/.test(e.key)) {
      prefs.volume = clampVolume(Number(e.key));
      log(`prefs: volume ${prefs.volume} (0x45d6b8)`);
    } else return false;
    savePrefs(prefs);
    drawPrefs();
    return true;
  }
  if (e.key.length !== 1) return false;
  const action = (PREFS_CONTROLS[prefsBox].role as { kind: "key"; action: number }).action;
  const refused = bindKey(prefs, action, e.key);
  log(
    refused
      ? `prefs: ${PREFS_ACTIONS[action - 1].say} keeps ${keyName(prefs.keys[action - 1])} — ${refused}`
      : `prefs: ${PREFS_ACTIONS[action - 1].say} is now ${keyName(prefs.keys[action - 1])} (0x45d810)`,
  );
  savePrefs(prefs);
  drawPrefs();
  return true;
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
  ownedByGame: (x, y) => (prefsOpen ? prefsHit(x, y) !== undefined : (film?.owns(x, y) ?? false)),
  press: (x, y) => clickAt(x, y),
  // nothing is held: see the note above
  release: () => {},
  sendKey: (key: GestureKey) => {
    if (key === ESCAPE_KEY) {
      if (prefsOpen) {
        // the original has no way out but the button; a page with no keyboard
        // needs one, and double-tap is the gesture this page already spends on
        // "get me out of here"
        closePrefs("closed by a double tap, which is this page's own way out");
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
      closePrefs("closed by ESC, which is this page's own way out");
      e.preventDefault();
      return;
    }
    if (film?.skip()) e.preventDefault();
  } else if (prefsOpen) {
    if (prefsKey(e)) e.preventDefault();
  } else if (e.key === "b") {
    // the page's own account of itself — the log and the film line together.
    // There is no button for it any more: neither was ever addressed to a
    // reader, and a film position under the picture is the page talking to
    // itself. `b` is what a developer presses; the bug reporter is what a
    // player presses, and it sends the log without showing it.
    const show = logEl.hidden;
    logEl.hidden = !show;
    nowEl.hidden = !show;
  }
});

requestAnimationFrame(frameLoop);
void boot().catch(fail);
