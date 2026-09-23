/**
 * Walk a Skull Cracker level — the reconstruction, not the game.
 *
 * Everything DRAWN here is the disc's: the backdrop placements at their stored
 * depths, the ground rasterised the way `SC.EXE` rasterises it (per-column
 * heights interpolated between the region polyline's points — its `0x40ba70`,
 * reimplemented in {@link rasterise}), the player's own cels. What the disc does
 * not contain is how it MOVES, and that is read out of `SC.EXE`: every speed,
 * weight, drag and timer here carries the address it came from. The one number
 * that is the port's own is the tick the engine's 15Hz frame is drawn in
 * quarters by ({@link INVENTED}).
 *
 * ## What walking is, in this data
 *
 * A level is a set of ROOMS, and that is the file's own structure rather than
 * this port's: `readRooms` in the engine has the binding and the evidence. Each
 * room owns one region, that region rasterises to a height map — for every x
 * column, the y of the floor — and the player is in exactly one room at a time.
 * They are a point (x, on-the-ground-at-x) with a facing and a gait; arrows move
 * x, their own room's ground supplies y, the camera follows, and each placement
 * scrolls at the ENGINE's own rate — `placementRate`, recovered from SC.EXE's
 * draw path: `(x − centre) · k/6000 + centre`, horizontal only, with most of the
 * art on rate-1 planes so it aligns exactly as stored.
 *
 * Walking into an `exitroom` rect moves you to the room its param names and puts
 * you beside the door back. That replaced an earlier guess — "of the regions
 * under you, take the floor nearest your feet" — which happened to keep STREETS'
 * street and basement apart and had no basis in the file. The rooms were in the
 * file all along.
 *
 * It can leave the floor. `platform` is the commonest object in the game and
 * `SC.EXE` says what one is — a rect that carries whatever stands on it — so
 * every platform's top edge is a ledge here, `obstacle` is solid, and a `ladder`
 * is climbed. How fast anything falls is each object's own `obj+0x24`, which the
 * mover adds once an airborne frame ({@link PLAYER_GRAVITY}), and a ladder is
 * counted in rungs of the record's own 35 pixels ({@link LADDER}).
 *
 * That matters most for CITY, whose ground is a ledge from x271 to x691 and then
 * y = 7250 for the rest of the level, 2900px below anything it draws. CITY has 73
 * platforms, 20 planks and 5 elevators, the most in the game. Its ground is the
 * fall, and the platforms are the level.
 *
 * The elevators are how the top of it is entered at all. CITY places no `ladder`,
 * its goal sits at y1802, and the walk east tops out around y3590: without the
 * five cars 45 of its 73 platforms are reachable and the goal is not one of them,
 * and with them all 73 are. Each owns its landing and carries the record upward,
 * which is the same mechanism a falling plank uses to take its floor down —
 * `0x42fcb9`, and {@link file://./props.ts} has both.
 */
import { readSbkFile, SbkEntity, LEVEL_ORDER, PLAY_PLANE_Z } from "@dreamfactory/engine/df/sbk";
import { decodeShpFrame, ShpFrame } from "@dreamfactory/engine/df/shp";
import { paletteToRGBA } from "@dreamfactory/engine/df/image";
import { readMovFile } from "@dreamfactory/engine/df/mov";
import { indexedToRGBA } from "@dreamfactory/engine/df/image";
import { focusOwnsKey } from "@dreamfactory/engine/web/keys";
import "./pad.css";
import { SkullFiles } from "./files";
import { writeSkl } from "./savegame";
import { Film } from "./film";
import { FOES, loopIndex } from "./foes";
import { type Enemy } from "./brains/kit";
import { CRAFT, SPRAY, VANISH } from "./effects";
import { REACH, Sounds } from "./sound";
import { ELEVATOR, Plank, crowCel, elevatorCel, ibeamCel, crushCel, plankCel, PICKUP, shackCel, PIPE, ROACH, doorCel, switchCel, dripCel, HAND, LIGHTFX, BOGGS, SKATEBOARD } from "./props";
import { MISSIONS } from "./mission";
import { BOLT, FLARE, GUN_CODES, STREAMS, WEAPONS, type Gun } from "./guns";
import { keyName } from "./prefs";
import { NAME_PROMPT, loadBoards, offerScore, saveBoards } from "./scores";
import { CEL, paintHud } from "./hud";
import {
  BLOW_CODES,
  CHARACTER,
  Cast,
  ENGINE_HZ,
  GameUi,
  INVENTED,
  KEYS,
  Level,
  PAUSE,
  PREFS,
  QUERY,
  RollerBody,
  Solids,
  VIEW,
  alarmCel,
  aliveNow,
  axeCel,
  backdropFrames,
  barrelCel,
  beltCel,
  boggsCel,
  boggsHeadCel,
  boggsWormCel,
  bolts,
  bridgeCel,
  bushCel,
  buttonMask,
  cageCel,
  canCel,
  cans,
  castBlow,
  castCel,
  casts,
  celOf,
  celRec,
  chairCel,
  cheats,
  clawCel,
  columnCel,
  columns,
  craft,
  craftOpened,
  crowsHere,
  crushesHere,
  cycleSpawn,
  damageOn,
  doorsHere,
  drips,
  elevatorsHere,
  elevsHere,
  ended,
  enemyPasses,
  enter,
  fanCel,
  featherCel,
  feathers,
  files,
  film,
  fittingCel,
  flameCel,
  flames,
  flares,
  flashColour,
  floorCel,
  flypastCel,
  flypasts,
  foeAnchor,
  frameOf,
  goalReady,
  gobs,
  gunAhead,
  gunCel,
  handCel,
  hatchCel,
  held,
  hereOf,
  holeCel,
  ibeamsHere,
  iface,
  inv,
  jawsAt,
  jawsCel,
  jumpPressed,
  kickPressed,
  lastCel,
  level,
  levelClock,
  levelIndex,
  lightCel,
  loadLevel,
  machineCel,
  mission,
  nestsHere,
  p,
  padLift,
  padLiftAll,
  padPress,
  panelInk,
  planksHere,
  player,
  playerBox,
  playerFrame,
  playerPal,
  playerSprite,
  pops,
  punchPressed,
  ridingElevator,
  roaches,
  rollerBlow,
  rollerCel,
  rollers,
  roomAt,
  roundsIn,
  runCheat,
  scaled,
  setDamageOn,
  setFiles,
  setFilm,
  setFlashColour,
  setIface,
  setJumpPressed,
  setKickPressed,
  setPlayer,
  setPlayerPal,
  setPunchPressed,
  setSound,
  setStartTicks,
  startGame,
  setUpPressed,
  sink,
  skates,
  solids,
  sound,
  spawnedHere,
  spritesTouch,
  startTicks,
  stats,
  streamCel,
  streams,
  surgeCel,
  switchesHere,
  tick,
  ui,
  upPressed,
  useCharacter,
  view,
  viewH,
  waitsForHardcore,
  wakeAudio,
  wormsHere,
} from "./game";
import type { Cheat } from "./cheats";


/**
 * Which button the panel was closed by — `0x45e1e0`'s own argument.
 *
 * 0 is the top one, which reaches no handler at all in the original because it
 * is named by neither actionframe: the film simply ends and `0x404303` finds
 * the state unchanged.
 */
let pauseAnswer = 0;
/** true while a film is the panel rather than something to sit through */
let filmIsPanel = false;

/** the last file a save was written to, for the status line and for a probe */
let saidSave = "";
/** the last word recognised, and when — the HUD says so for a moment */
let cheatSaid: { cheat: Cheat; at: number } | null = null;
let lastTick = 0;


/**
 * What a level spawns, and the one table that says what each kind is.
 *
 * The cels, the strides, the flinches, the deaths, the health, the awards and
 * whether a thing counts towards the quota are all in {@link FOES}, read out of
 * `SC.EXE` a class at a time — {@link file://./foes.ts} has the shape of a
 * creature and the four objects in the executable it takes to describe one.
 *
 * What is NOT there is behaviour. `SC.EXE` gives each spawned enemy a 54-byte AI
 * struct (`0x450a50` allocates it, `0x45ef70` fills it from a per-class table —
 * the punk's is `0x477600`: 330, 200, 150, 80) and what that AI does with those
 * four numbers has not been read. So these patrol their own rect and turn at its
 * edges, which is this port's guess at what a territory is for.
 */

/**
 * Engine frames per tick of this page — 15/60, so a quarter.
 *
 * Every engine number in this file is per engine FRAME, and this is the only
 * thing that converts one. It sets the animation rate, the walk, the enemies'
 * strides and the jump, so none of them is a separate guess.
 */

/**
 * What state a spawned thing is in, which is the same division `SC.EXE` makes:
 * the class's own script `kind` field IS the object's state (`0x45d090` copies
 * `script+4` into `obj+0x18`), so a creature is only ever doing one animation and
 * the animation is the state.
 *
 * `gait` loops; the other three play once. `dead` is followed by
 * {@link CORPSE_LINGER} frames of lying there, then the thing is gone.
 */

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("screen");
const ctx = canvas.getContext("2d")!;
const hud = $("hud");
const levelPick = $<HTMLSelectElement>("level");
// the page's side of {@link GameUi}
ui.status = (text) => {
  hud.textContent = text;
};
ui.levelShown = (index) => {
  levelPick.value = String(index + 1);
};
ui.film = (name) => playFilm(name);
ui.gameOver = (score, level, difficulty) => {
  const boards = loadBoards();
  const rank = offerScore(boards, difficulty, score, level, () => prompt(NAME_PROMPT, ""));
  saveBoards(boards);
  hud.textContent = rank < 0 ? "game over" : `game over — row ${rank + 1} of the board`;
  location.href = "index.html";
};
const W = canvas.width;
const H = canvas.height;

const celCache = new Map<string, HTMLCanvasElement>();
/**
 * A cel as an opaque-masked canvas, optionally dimmed.
 *
 * The dim is baked into the PIXELS, not applied with `ctx.filter` at draw time:
 * canvas filters are silently ignored on some browsers, so the background dim
 * simply did not happen there while it did in a headless probe. Multiplying the
 * RGB here cannot be ignored. Cached per (loc, dim), so the two variants of a
 * cel that appears both dimmed and not are each built once.
 */
function cel(level: Level, loc: number, dim = 1): HTMLCanvasElement | null {
  const key = `${level.name}:${loc}:${dim}`;
  const had = celCache.get(key);
  if (had) return had;
  const container = level.sbk.file.containers[loc];
  if (!container) return null;
  let f: ShpFrame;
  try {
    f = decodeShpFrame(container.data);
  } catch {
    return null;
  }
  const c = document.createElement("canvas");
  c.width = f.width;
  c.height = f.height;
  const cc = c.getContext("2d")!;
  const img = cc.createImageData(f.width, f.height);
  for (let i = 0; i < f.width * f.height; i++) {
    if (!f.opaque[i]) continue;
    const p = f.indexed[i] * 4;
    img.data[i * 4] = level.pal[p] * dim;
    img.data[i * 4 + 1] = level.pal[p + 1] * dim;
    img.data[i * 4 + 2] = level.pal[p + 2] * dim;
    img.data[i * 4 + 3] = 255;
  }
  cc.putImageData(img, 0, 0);
  celCache.set(key, c);
  return c;
}

/**
 * Fill the chooser and keep it pointing at the level on screen.
 *
 * `[` and `]` have always stepped through the sixteen and `?level=N` has always
 * opened one; neither is visible on the page. The game itself was no more
 * discoverable and no less direct about it — "Enter level (1-16):" is a string in
 * `SC.EXE` — so this is the same thing with the names filled in.
 *
 * The select gives the keyboard back as soon as it is used: a focused `<select>`
 * eats the arrow keys, and the arrows are how the player walks.
 */
function fillPicker(): void {
  levelPick.innerHTML = MISSIONS.map(
    (m) => `<option value="${m.number}">${m.number}. ${m.book}</option>`,
  ).join("");
  levelPick.addEventListener("change", () => {
    const want = Number(levelPick.value) - 1;
    levelPick.blur();
    if (want !== levelIndex) void loadLevel(want);
  });
}

/** the craft, from the shared player book, on the play plane with everything else */
function drawCraft(camX: number, camY: number): void {
  if (!craft || !player) return;
  const a = craft.state === "open" ? CRAFT.open : CRAFT.hover;
  const i =
    craft.state === "open"
      ? Math.min(a.cels.length - 1, Math.floor(craft.clock / a.hold))
      : Math.floor(craft.clock / a.hold) % a.cels.length;
  const loc = player.byId.get(a.cels[i]);
  if (loc === undefined) return;
  const art = playerCel(loc);
  if (!art) return;
  // by the cel's OWN anchor, the way `0x4026d0` places everything: all sixteen
  // deploy cels put their anchor within a few pixels of the hull's top (4 to 7 of
  // heights from 44 to 117), so the screen unfolds downwards out of a hull that
  // does not move — which is what the anchors are for
  const f = playerFrame(loc);
  if (!f) return;
  const left = craft.x - camX + W / 2 - f.posXraw;
  const top = craft.y - camY + VIEW.y - f.posYraw;
  if (left + art.width < 0 || top + art.height < 0 || left > W || top > H)
    return;
  if (craft.facing > 0) {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(art, -(left + art.width), top);
    ctx.restore();
  } else ctx.drawImage(art, left, top);
}

/** the film's screen, kept across frames: a frame is a PATCH over the last one */
let filmRGBA: ImageData | null = null;

/**
 * Open it. The world is already suspended by there being a film at all.
 */
async function openPause(): Promise<void> {
  if (film || !level) return;
  pauseAnswer = 0;
  const name = PAUSE.films[Math.floor(levelIndex / 4)] ?? PAUSE.films[0];
  filmIsPanel = true;
  await playFilm(name, {
    modal: true,
    onAction: (which) => {
      pauseAnswer = which;
    },
  });
  filmIsPanel = false;
  if (pauseAnswer === 1) await saveGame();
  // `0x404303`: state 5 is the only answer that leaves, and `0x403c89` puts the
  // shell back at its own front door. This page's front door is the menu page.
  else if (pauseAnswer === 2) location.href = "index.html";
  else lastTick = 0;
}

/**
 * Write the twenty-two bytes — and ask where, as `GetSaveFileNameA` does.
 *
 * `showSaveFilePicker` IS that dialog and is what the original asks for, so it
 * is tried first; a browser without it gets an ordinary download, which is the
 * nearest a page can come to choosing a path. The bytes are the same either way
 * and {@link file://./savegame.ts} is where they are laid out.
 *
 * The filename is this page's own and nothing else in it is: the disc's default
 * comes from the Windows dialog, which a browser has no equivalent of.
 */
async function saveGame(): Promise<void> {
  const bytes = writeSkl({
    level: levelIndex,
    score: stats.score,
    lives: stats.lives,
    weapon: inv.weapon,
    rounds: inv.rounds[inv.weapon] ?? 0,
  });
  const name = `skullcracker-${LEVEL_ORDER[levelIndex] ?? "save"}.skl`;
  const blob = new Blob([bytes.buffer as ArrayBuffer], {
    type: "application/octet-stream",
  });
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;
  /**
   * ...and only while the click that asked for it still counts.
   *
   * A file picker needs transient activation, and without one Chromium rejects
   * with `AbortError` — the SAME error it reports when a reader closes the
   * dialog. The two are indistinguishable from the rejection, so the answer has
   * to be asked for beforehand: no activation means no dialog was ever possible,
   * and the download below is the save. With one, an `AbortError` really is a
   * reader saying no, and `0x45e23d` writes nothing.
   */
  const live = (
    navigator as unknown as { userActivation?: { isActive: boolean } }
  ).userActivation;
  if (picker && (live?.isActive ?? true)) {
    try {
      const handle = await picker({
        suggestedName: name,
        types: [
          {
            description: "Saved games (.SKL)",
            accept: { "application/octet-stream": [".skl"] },
          },
        ],
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      saidSave = handle.name;
      return;
    } catch (e) {
      // The reader cancelled, and that is the original's own answer to a dialog
      // that comes back empty: `0x45e23d` tests the return before it opens
      // anything, and writes nothing.
      if (e instanceof DOMException && e.name === "AbortError") {
        saidSave = "";
        return;
      }
      // ...anything else is the API not being usable here rather than a choice —
      // no user activation left, no permission, a browser with only the read
      // half — and the download below is still a save.
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  saidSave = name;
}

/**
 * Play one film and resolve when it ends — or when it is skipped, which is the
 * same thing to the caller.
 *
 * Every film named here sets its own ESC-skips header bit, so `Film.skip()` is
 * the film's own permission and not this page overriding it.
 */
async function playFilm(
  name: string,
  opts: { modal?: boolean; onAction?: (which: 1 | 2) => void } = {},
): Promise<void> {
  const bytes = files.has(name) ? files.provide(name) : await files.load(name);
  if (!bytes) return; // a rip without this film simply goes straight on
  let mov;
  try {
    mov = readMovFile(bytes);
  } catch {
    return;
  }
  filmRGBA = ctx.getImageData(0, 0, W, H);
  await new Promise<void>((done) => {
    setFilm(new Film(name, mov, {
      audio: sink,
      paint: (pixels, width, height, palette, originX, originY) => {
        const screen = filmRGBA;
        if (!screen) return;
        const small = indexedToRGBA(pixels, width, height, palette);
        for (let y = 0; y < height; y++) {
          const dy = y + originY;
          if (dy < 0 || dy >= H) continue;
          const from = y * width * 4;
          const wide = Math.min(width, W - originX) * 4;
          screen.data.set(
            small.subarray(from, from + wide),
            (dy * W + originX) * 4,
          );
        }
        ctx.putImageData(
          screen,
          0,
          0,
          originX,
          originY,
          Math.min(width, W - originX),
          Math.min(height, H - originY),
        );
      },
      log: () => {},
      // a film that chains plays the next one in its place, and the promise
      // waits for the end of the chain
      onChain: (next) => void playFilm(next).then(done),
      onAction: opts.onAction,
      onEnd: () => {
        setFilm(null);
        done();
      },
    }));
  });
}

addEventListener("keydown", (e) => {
  wakeAudio();
  // the chooser is a real form control: while it has the focus, its own keys are
  // its own (the engine's `focusOwnsKey` is the same test the films page makes)
  if (focusOwnsKey(e.target, e.key)) return;
  // a film owns the keyboard while it runs, and ESC is what the films' own
  // header bit permits — see Film.skip
  if (film) {
    // ...except the pause panel, which is not something to sit through: its
    // frames loop for ever and ESC is the top button, the one `0x45e1e0` never
    // hears about. `Film.finish` is what the film's own type-1 answer frames do
    if (filmIsPanel) {
      if (e.key === "Escape") {
        pauseAnswer = 0;
        film.finish();
      }
      e.preventDefault();
      return;
    }
    if (e.key === "Escape") film.skip();
    e.preventDefault();
    return;
  }
  // Ctrl+Q and Ctrl+. are the disc's own (`0x403ea4`, and `0x4057a5` is why
  // they want Ctrl); ESC is this page's, because it is what a reader presses
  if (
    e.key === "Escape" ||
    ((e.ctrlKey || e.metaKey) && PAUSE.keys.includes(e.key.toLowerCase()))
  ) {
    e.preventDefault();
    void openPause();
    return;
  }
  // every lowercase letter goes to the cheat accumulator first, exactly where
  // `0x403c1b` puts it: before the action lookup, and so without taking the key
  if (!e.ctrlKey && !e.altKey && !e.metaKey) {
    const said = cheats.press(e.key, performance.now());
    if (said) {
      cheatSaid = { cheat: said, at: performance.now() };
      runCheat(said);
    }
  }
  // the interface toggle goes first, because P is also the punch: Ctrl+P is the
  // original's own chord and it must not land on the fist
  if (e.ctrlKey && (e.key === "p" || e.key === "P")) {
    setIface(!iface);
    e.preventDefault();
    return;
  }
  const k = KEYS[e.key];
  if (k === "up" && !held.up) setUpPressed(true);
  if (k === "jump" && !held.jump) setJumpPressed(true);
  if (k === "punch" && !held.punch) setPunchPressed(true);
  if (k === "kick" && !held.kick) setKickPressed(true);
  if (k) held[k] = true;
  /*
   * ...and the rest of this page's own keys are held with SHIFT, which they were
   * not until the cheat words went in.
   *
   * `0x403c1b` feeds every LOWERCASE letter to the accumulator, so `h`, `n`, `c`
   * and `m` are the first letters of `harakari`, nothing, `cthia` and
   * `marsupial` — and a page that toggled the damage switch on the `h` of
   * harakari could never take the word. None of these four is the original's
   * key: the game's own designer set is behind a modifier too (`0x403c40` tests
   * the event's modifiers against 0x1fa0 before it will read one), so this is
   * the shape the executable already has. `[` and `]` stay bare: no cheat word
   * has a bracket in it.
   */
  else if (e.shiftKey && e.key === "H") {
    // the damage switch — see {@link HURT}. It starts off, and `?damage=1` is the
    // same switch thrown before the level loads
    setDamageOn(!damageOn);
    if (!damageOn) stats.health = stats.maxHealth;
  } else if (e.key === "[") void loadLevel((levelIndex + 15) % 16);
  else if (e.key === "]") void loadLevel((levelIndex + 1) % 16);
  else if (e.shiftKey && e.key === "N") cycleSpawn();
  // ...and action 11, the other unbound designer's key: `0x402d22` toggles
  // `0x46b1a8`, which is WHICH PLAYER — see {@link file://./players.ts}. The
  // level is reloaded under it because the two of them are different sizes and
  // the pose on screen belongs to the one who is leaving
  else if (e.shiftKey && e.key === "C") {
    useCharacter(CHARACTER === 0 ? 1 : 0);
    void loadLevel(levelIndex);
  }
  // Shift+M is this page's own, and it is the only key here that is: the
  // original's table has no mute in it — see {@link Sounds.toggle}
  else if (e.shiftKey && e.key === "M") sound?.toggle();
  else return;
  e.preventDefault();
});
addEventListener("keyup", (e) => {
  const k = KEYS[e.key];
  if (k) held[k] = false;
});
/**
 * A tap on the picture belongs to the film, and to nothing else.
 *
 * It used to be the walk as well: the left half of the canvas held LEFT, the
 * right half RIGHT, the top third UP — which was also the jump — and the bottom
 * third DOWN. Three things were wrong with it, and none of them is fixable
 * without leaving it behind:
 *
 *   - the regions are INVISIBLE. The only way to find out where the game thought
 *     your thumb was is to press and watch what the man does, and a press that
 *     means "walk right" in a fight is a press that does not punch.
 *   - the top third held UP and JUMP TOGETHER, because one finger had to reach
 *     eight actions. They are two of the original's own actions (1 is
 *     run/climb/open a door, 8 is the jump) and a ladder cannot be climbed by
 *     something that also jumps at it.
 *   - three of the eight were simply unreachable. PUNCH, KICK and INV have no
 *     region, so a touchscreen could walk the whole game and never hit anything —
 *     which is the one thing this game is.
 *
 * So the walk moved to the pad below, which is drawn where it can be seen, and
 * this keeps what a tap on the picture was always good at: skipping a film, and
 * answering the pause panel's three buttons.
 */
canvas.addEventListener("pointerdown", (e) => {
  wakeAudio();
  if (!film) return;
  // the panel is three buttons and a tap on one of them is the answer
  if (filmIsPanel) {
    const r = canvas.getBoundingClientRect();
    film.click(
      Math.round(((e.clientX - r.left) / r.width) * W),
      Math.round(((e.clientY - r.top) / r.height) * H),
      performance.now(),
    );
    return;
  }
  film.skip();
});

// ---- the pad --------------------------------------------------------------

/**
 * The on-screen controls: the four directions at the left of the picture, the
 * three strikes at the right.
 *
 * Seven `<button>`s over the canvas rather than seven rectangles painted into
 * the 512x384 screen. That screen is the disc's picture and nothing this port
 * invents belongs inside it; a DOM button is a thumb's size at every window
 * width, where a framebuffer pixel is a thumb's size at exactly one.
 *
 * All the wiring does is set the same `held` flags the keyboard sets, so
 * everything downstream of a key is downstream of a thumb for free: the run,
 * the climb, the door, the crouch-crawl, the duck-kick, the headbutt (PUNCH and
 * KICK together, which is why they are two keys a finger apart and not one
 * combined "attack"), and the interface band's own eight button lights, which
 * the engine draws from those same flags (`buttonMask`).
 *
 * All eight actions are here, INV included. INV is the odd one — a HOLD rather
 * than a blow: every state answers it with state 15 (`0x428975`), which stands
 * you on the plain unarmed idle while it is down and, when it comes up, puts
 * you back on the idle of the gun you carry (`0x4289ca`). It is not a fist mode
 * — state 15 reads no other key. It went in because the keyboard has `I` and
 * the glass had nothing.
 *
 * ## Built here rather than written into a page
 *
 * Because the runner has two pages. `walk.html` is the bench, and the front
 * door hands this module its canvas when the chooser starts the game
 * (`main.ts`'s `handOver`, which is why a level plays on `index.html` at all).
 * Markup in the bench's page would leave the front door's players — the ones
 * who came to the game rather than to the bench — with no controls at all, and
 * the same seven buttons in both files is the copy that eventually disagrees
 * with itself. So the runner builds its own pad, into whatever element holds
 * the canvas, and `pad.css` insets it by that page's moulding.
 *
 * `tabindex="-1"` on every key, and it is not an oversight. A focused
 * `<button>` OWNS the space bar (`focusOwnsKey`, and the space bar is the
 * jump), so a pad in the tab order would take the jump away from the keyboard
 * that already has it, along with the seven bound in the game's own preferences
 * panel. The pad is for the machines with no keyboard; it is not a second,
 * worse way to press a key that works.
 */
const pad = ((): HTMLDivElement => {
  const el = document.createElement("div");
  el.id = "pad";
  el.hidden = true;
  const group = (id: string, kind: "act" | "dir", keys: [keyof typeof held, string, string][]): HTMLDivElement => {
    const box = document.createElement("div");
    box.id = id;
    box.className = "keys";
    for (const [act, label, says] of keys) {
      const key = document.createElement("button");
      key.type = "button";
      key.tabIndex = -1;
      key.className = `${kind} ${act}`;
      key.dataset.act = act;
      key.textContent = label;
      key.setAttribute("aria-label", says);
      box.append(key);
    }
    return box;
  };
  // directions first and so at the LEFT, the strikes at the right: the order
  // they are appended in is the order the row lays them out
  el.append(
    group("padDirs", "dir", [
      ["up", "\u25b2", "up — run, climb, open a door"],
      ["left", "\u25c0", "left"],
      ["right", "\u25b6", "right"],
      ["down", "\u25bc", "down — crouch"],
    ]),
    group("padActs", "act", [
      ["inv", "INV", "inv — hold to holster the gun"],
      ["jump", "JUMP", "jump"],
      ["punch", "PUNCH", "punch"],
      ["kick", "KICK", "kick"],
    ]),
  );
  // the element the canvas sits in — `#stage` on the bench, the front door's
  // bevelled `#frame` on the game. Both are positioned; `pad.css` insets the
  // pad by the moulding so it lands on the PICTURE either way.
  (canvas.parentElement ?? document.body).append(el);
  return el;
})();

/**
 * Whether this machine gets the pad at all.
 *
 * `?pad=1` forces it on and `?pad=0` off — this page is told everything else
 * through its query string (`?level=`, `?damage=`, `?clock=`), a desktop needs
 * some way to look at the thing, and a phone that would rather use a paired
 * keyboard needs some way to be rid of it.
 *
 * `maxTouchPoints` AS WELL as the media query, for the reason
 * `engine/web/touch.ts` gives: a laptop with a touchscreen reports a FINE
 * pointer and still delivers fingers.
 */
const PAD_ON = ((): boolean => {
  const want = new URLSearchParams(location.search).get("pad");
  if (want === "1") return true;
  if (want === "0") return false;
  return navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches;
})();

if (PAD_ON) {
  for (const el of pad.querySelectorAll<HTMLButtonElement>("button[data-act]")) {
    el.addEventListener("pointerdown", (e) => {
      wakeAudio();
      // none of the browser's own answers to a press is wanted on a key: no
      // scroll, no selection, no synthesised mouse click, no focus left behind
      // for the next keystroke to land in
      e.preventDefault();
      // captured, so a thumb that slides off the key still ENDS on it — without
      // this a finger that drifts during a long hold never sends its `pointerup`
      // here and the direction stays held for ever. It throws when the pointer
      // is not a live one, which is what a synthesised event is: a probe that
      // dispatches its own `pointerdown` should press the key, not break here.
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* uncaptured: the key still presses, and `pointerup` still arrives */
      }
      padPress(el, e.pointerId);
    });
    const lift = (e: PointerEvent): void => padLift(e.pointerId);
    el.addEventListener("pointerup", lift);
    el.addEventListener("pointercancel", lift);
    // a long press IS a long press here, and both platforms would rather it
    // were a context menu — which arrives mid-fight, over the key
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  // the window losing the fingers altogether: a call, a notification, a tab
  addEventListener("blur", padLiftAll);
}

/**
 * Show the pad, or take it away for a film.
 *
 * A film is played over the whole canvas and the pause panel's three buttons are
 * underneath the pad's bottom corners, so the pad cannot stay: a tap meant for
 * "quit" would land on PUNCH. Called every frame, and does nothing on the frames
 * where nothing changed.
 */
function padShown(on: boolean): void {
  if (!PAD_ON || pad.hidden === !on) return;
  pad.hidden = !on;
  if (!on) padLiftAll();
}

/** each one cel of the level's own book, mirrored the way it flies */
function drawCasts(camX: number, camY: number): void {
  const lvl = level;
  if (!lvl) return;
  for (const c of casts) drawLevelCel(castCel(c), c.x, c.y, camX, camY, c.facing < 0);
}

/**
 * One cel of the level's own book, placed by its anchor — which is what
 * `0x4026d0` does for everything the engine draws.
 */
function drawLevelCel(
  id: number,
  x: number,
  y: number,
  camX: number,
  camY: number,
  mirror = false,
): void {
  const lvl = level;
  if (!lvl) return;
  const loc = lvl.sbk.byId.get(id);
  if (loc === undefined) return;
  const art = cel(lvl, loc);
  const rec = celRec(lvl.sbk, id);
  if (!art || !rec) return;
  // `0x45d0f0` reflects a mirrored cel about its own ANCHOR, not its centre —
  // the same rule the backdrop's placements follow
  const sx = x - camX + W / 2;
  const left = mirror ? sx - (art.width - rec.posX) : sx - rec.posX;
  const top = y - camY + VIEW.y - rec.posY;
  if (left + art.width < 0 || top + art.height < 0 || left > W || top > H)
    return;
  if (!mirror) {
    ctx.drawImage(art, left, top);
    return;
  }
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(art, -(left + art.width), top);
  ctx.restore();
}

/**
 * One cel of the PLAYER's book, placed by its anchor — the same rule
 * {@link drawLevelCel} follows, against the other of the two books a level has
 * open. The pickups and the craft already needed it; the flypasts are the third.
 */
function drawPlayerCel(
  id: number,
  x: number,
  y: number,
  camX: number,
  camY: number,
  mirror: boolean,
): void {
  const loc = player?.byId.get(id);
  if (loc === undefined) return;
  const art = playerCel(loc);
  const f = playerFrame(loc);
  if (!art || !f) return;
  const sx = x - camX + W / 2;
  const left = mirror ? sx - (art.width - f.posXraw) : sx - f.posXraw;
  const top = y - camY + VIEW.y - f.posYraw;
  if (left + art.width < 0 || top + art.height < 0 || left > W || top > H)
    return;
  if (!mirror) {
    ctx.drawImage(art, left, top);
    return;
  }
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(art, -(left + art.width), top);
  ctx.restore();
}

/**
 * One plank, by its own anchor at the record's point.
 *
 * Its cels are 204 wide with the anchor near the middle and at the bottom (cel
 * 1050 is 204x17 anchored at (94, 13)), which puts the board's top surface right
 * on the platform record laid under it — the two agreeing is how the plank was
 * matched to its floor in the first place ({@link planksIn}).
 */
function drawPlank(k: Plank, camX: number, camY: number): void {
  drawLevelCel(plankCel(k), k.x, k.y, camX, camY);
}

function drawEnemy(e: Enemy, camX: number, camY: number): void {
  const lvl = level;
  if (!lvl) return;
  // `0x4247c0` — the wraith's DRAW message skips the blit while it is in kind
  // 4 tag 1, the gap between fading out and arriving behind you
  if (e.kind === "initwraith" && e.state === "gait" && e.script === 4 && e.tag === 1)
    return;
  const id = celOf(e);
  const loc = lvl.sbk.byId.get(id);
  if (loc === undefined) return;
  const art = cel(lvl, loc);
  const c = celRec(lvl.sbk, id);
  const a = foeAnchor(e, lvl);
  if (!art || !c || !a) return;
  // by this cel's own anchor about the kind's fixed point — see foeAnchor. On
  // mirror the cel reflects about the anchor and not about its own centre, which
  // is what `0x4026d0` does and what keeps a mirrored looming rat in place.
  const left =
    e.facing < 0
      ? a.x - camX + W / 2 - (art.width - c.posX)
      : a.x - camX + W / 2 - c.posX;
  const top = a.y - camY + VIEW.y - c.posY;
  if (left + art.width < 0 || top + art.height < 0 || left > W || top > H)
    return;
  if (e.facing < 0) {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(art, -(left + art.width), top);
    ctx.restore();
  } else ctx.drawImage(art, left, top);
}

/** the `stat*` records, from the shared player book, on their record's own point */
function drawPickups(camX: number, camY: number): void {
  for (const q of hereOf((l) => l.pickups)) {
    const kind = PICKUP.kinds[q.code];
    const loc = player?.byId.get(kind.cels[loopIndex(kind, q.clock)]);
    if (loc === undefined) continue;
    const art = playerCel(loc);
    const f = playerFrame(loc);
    if (!art || !f) continue;
    const left = q.x - camX + W / 2 - f.posXraw;
    const top = q.y - camY + VIEW.y - f.posYraw;
    if (left + art.width < 0 || top + art.height < 0 || left > W || top > H)
      continue;
    ctx.drawImage(art, left, top);
  }
}

/**
 * The weapons on the floor, out of `PLAYER.SBK` like every other pickup —
 * `0x45adc0`'s create sets `obj+2` to `0x4abe10`, the shared character book,
 * whatever level you are standing in.
 */
function drawGuns(camX: number, camY: number): void {
  for (const g of hereOf((l) => l.guns)) {
    const loc = player?.byId.get(GUN_CODES[g.code]?.cel ?? -1);
    if (loc === undefined) continue;
    const art = playerCel(loc);
    const f = playerFrame(loc);
    if (!art || !f) continue;
    const left = g.x - camX + W / 2 - f.posXraw;
    const top = g.y - camY + VIEW.y - f.posYraw;
    if (left + art.width < 0 || top + art.height < 0 || left > W || top > H)
      continue;
    ctx.drawImage(art, left, top);
  }
}

/**
 * The flares — one frame of the muzzle, then `7207` all the way out, then the
 * four-cel burn-out where it stopped. The art is the LEVEL's, not the player's:
 * `0x43ab33` files book `0x4a7020`, and 7200..7211 are in MALL, SERVICE, SEWER
 * and ARCADE and in no other book in the rip — which is the same four levels
 * that place a `statflare`.
 */
function drawFlares(camX: number, camY: number): void {
  if (!level) return;
  for (const f of flares) {
    // tag 0 is one frame of the muzzle cel (`0x43ac8c` installs tag 3 at its
    // end); tag 4's burn-out, then tag 5 holding its last cel
    const id =
      f.burn !== null && f.burn >= 0
        ? FLARE.burn[Math.min(FLARE.burn.length - 1, f.burn)]
        : f.age <= 1
          ? FLARE.muzzle
          : FLARE.flight;
    drawLevelCel(id, f.x, f.y, camX, camY);
  }
}

/**
 * The flame, the water and the beam — and they MIRROR, about their anchor.
 *
 * `drawLevelCel` never flips, which is right for a grave or a blade and wrong
 * for anything that comes out of a person: a stream fired west was drawn
 * pointing east, over the player's own shoulder.
 */
function drawStreams(camX: number, camY: number): void {
  const lvl = level;
  if (!lvl) return;
  for (const q of streams) {
    const id = streamCel(q);
    const loc = lvl.sbk.byId.get(id);
    const rec = celRec(lvl.sbk, id);
    if (loc === undefined || !rec) continue;
    const art = cel(lvl, loc);
    if (!art) continue;
    const top = q.y - camY + VIEW.y - rec.posY;
    if (q.facing < 0) {
      const left = q.x - camX + W / 2 - (art.width - rec.posX);
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(art, -(left + art.width), top);
      ctx.restore();
    } else ctx.drawImage(art, q.x - camX + W / 2 - rec.posX, top);
  }
}

/** the bolts, one cel each — `0x46c588` tag 2 holds 4000 the whole way out */
function drawBolts(camX: number, camY: number): void {
  if (!level) return;
  for (const b of bolts) drawLevelCel(BOLT.cel, b.x, b.y, camX, camY);
}

/** the green balls, from the shared player book, centred on their own anchors */
function drawPops(camX: number, camY: number): void {
  for (const q of pops) {
    const id =
      VANISH.cels[
        Math.min(VANISH.cels.length - 1, Math.floor(q.age / VANISH.hold))
      ];
    const loc = player?.byId.get(id);
    if (loc === undefined) continue;
    const art = playerCel(loc);
    const f = playerFrame(loc);
    if (!art || !f) continue;
    const left = q.x - camX + W / 2 - f.posXraw;
    const top = q.y - camY + VIEW.y - f.posYraw;
    if (left + art.width < 0 || top + art.height < 0 || left > W || top > H)
      continue;
    ctx.drawImage(art, left, top);
  }
}

/**
 * The goo, drawn from the shared player book so it works in every level.
 *
 * A gob is one of three cels held three frames each and then the last one held
 * for the rest of its sixty; the coin toss `0x40cea1` makes flips half of them,
 * which is the only reason twenty of them do not look like one.
 */
function drawGobs(camX: number, camY: number): void {
  for (const g of gobs) {
    // rising, falling, or a puddle — `0x40c480`'s three cases, and the switch to
    // the falling cels is the sign of vy exactly as it tests `obj+0xa > 0`
    const id =
      g.stage >= 0
        ? SPRAY.pool[g.stage]
        : g.vy > 0
          ? SPRAY.fall.cels[
              Math.min(
                SPRAY.fall.cels.length - 1,
                Math.floor(g.age / SPRAY.fall.hold),
              )
            ]
          : SPRAY.rise.cels[
              Math.min(
                SPRAY.rise.cels.length - 1,
                Math.floor(g.age / SPRAY.rise.hold),
              )
            ];
    const loc = player?.byId.get(id);
    if (loc === undefined) continue;
    const art = playerCel(loc);
    if (!art) continue;
    const f = playerFrame(loc);
    if (!f) continue;
    const left = g.x - camX + W / 2 - f.posXraw;
    const top = g.y - camY + VIEW.y - f.posYraw;
    if (left + art.width < 0 || top + art.height < 0 || left > W || top > H)
      continue;
    if (g.mirror) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(art, -(left + art.width), top);
      ctx.restore();
    } else ctx.drawImage(art, left, top);
  }
}

function loop(now: number): void {
  requestAnimationFrame(loop);
  // the pad is the only control a phone has, so it is up whenever the level is
  padShown(film === null);
  if (film) {
    // hold it in a local: `tick` is what ends a film, and the ending clears
    // `film` from under this frame
    const reel = film;
    reel.tick(now);
    hud.textContent = filmIsPanel
      ? `${reel.where} — resume · save · quit (0x404280), ESC resumes`
      : `${reel.where} — press ESC to skip`;
    lastTick = 0; // the world resumes from now, not from before the film
    return;
  }
  if (!level || !player) return;
  // fixed-step movement so the stride does not depend on the display's Hz
  if (!lastTick) lastTick = now;
  while (now - lastTick >= INVENTED.tickMs) {
    lastTick += INVENTED.tickMs;
    tick();
  }
  // ---- draw: the engine's own transform — screenX = (x − camX)·rate + W/2,
  // horizontal only, y plain — camera centred on the player
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  // the level is confined to its window in BOTH modes, which is what makes it a
  // window: without the clip the parallax and the player run under the two bands
  // and reappear at the screen's edges. Full-screen mode is the same window 110
  // rows taller — see VIEW.
  ctx.save();
  ctx.beginPath();
  ctx.rect(VIEW.x, VIEW.y, VIEW.w, viewH());
  ctx.clip();
  const lvl = level;
  // ...and the camera is `0x4309f0`'s, stepped once an engine frame and clamped
  // to the room's own rect by its own flag bits. This draws from its corner, so
  // the centre the transform below wants is half a view to the right of it.
  // whole pixels at the display's rate: the corner carries the tick's fraction so
  // the scroll is smooth, and the blit wants an integer or it resamples the
  // whole backdrop
  const camX = Math.round(view.x) + VIEW.w / 2;
  const camY = Math.round(view.y);
  // where the sounds are heard from: `0x40efb0` takes the camera rect and adds
  // (256, 192) to its corner, which is the middle of a 512-wide view
  sound?.listen(camX, camY + REACH.centreY);
  sound?.pump();
  const drawOne = (q: (typeof lvl.draw)[number]): void => {
    // cycle the disc's frame cels; still placements have one and never move
    const loc =
      q.cels.length > 1
        ? q.cels[Math.floor(backdropFrames / q.hold) % q.cels.length]
        : q.loc;
    const art = cel(lvl, loc);
    const f = frameOf(lvl, loc);
    if (!art || !f) return;
    // the ANCHOR's screen position: SC.EXE's rect builder (0x4026d0) places the
    // cel so its stored anchor lands here, and on mirror it reflects the cel
    // about that anchor — NOT the cel's centre. That distinction is invisible
    // for a near-centred anchor and glaring for an off-centre one: the lamp's
    // tiny glow cels (anchor 31 of 73) landed in the wrong place, the full lamp
    // (anchor 144 of 186) barely moved.
    const sx = (q.x - camX) * q.rate + W / 2;
    const y = q.y - camY + VIEW.y - f.posYraw;
    // left edge: anchor at sx normally, or reflected about sx when mirrored
    const left = q.mirror ? sx - (art.width - f.posXraw) : sx - f.posXraw;
    if (left + art.width < 0 || y + art.height < 0 || left > W || y > H) return;
    if (q.mirror) {
      ctx.save();
      ctx.scale(-1, 1);
      // scale(-1,1) maps x→−x, so drawing at −(left+width) lands the reversed
      // cel spanning [left, left+width], anchor back at sx
      ctx.drawImage(art, -(left + art.width), y);
      ctx.restore();
    } else {
      ctx.drawImage(art, left, y);
    }
  };
  // everything the engine paints before the player (planes 3 and 0)
  for (const q of lvl.draw) if (q.z < PLAY_PLANE_Z) drawOne(q);

  // the level's own spawned things, on the play plane with the player
  for (const k of planksHere()) drawPlank(k, camX, camY);
  // the BACK of the cage. Its front half and its winch come after the player —
  // see the second pass below, and {@link ELEVATOR.car}.
  for (const e of elevatorsHere())
    drawLevelCel(ELEVATOR.car.back, e.x, e.y, camX, camY);
  for (const b of ibeamsHere()) drawLevelCel(ibeamCel(b), b.x, b.y, camX, camY);
  for (const c of crushesHere())
    drawLevelCel(crushCel(c), c.x, c.y, camX, camY);
  // the lever is on the wall behind whatever is standing at it, and the goop is
  // in front: its class is collected with the actors, the switch's is not
  for (const w of switchesHere())
    drawLevelCel(switchCel(w), w.x, w.y, camX, camY);
  // an open door shows cel 0, which is nothing; a lift is one cel for ever
  for (const d of doorsHere())
    if (d.state !== "open") drawLevelCel(doorCel(d), d.x, d.y, camX, camY);
  for (const e of elevsHere()) drawLevelCel(e.cel, e.x, e.y, camX, camY);
  // the scenery that does something, each on its own class's cels
  for (const k of hereOf((l) => l.shacks))
    drawLevelCel(shackCel(k), k.x, k.y, camX, camY);
  for (const b of hereOf((l) => l.barrels)) {
    drawLevelCel(barrelCel(b), b.x, b.y, camX, camY, b.mirror);
  }
  for (const q of hereOf((l) => l.pipes)) {
    drawLevelCel(PIPE.mouth.cels[0], q.x, q.y, camX, camY);
    drawLevelCel(
      PIPE.flow.cels[loopIndex(PIPE.flow, q.clock)],
      q.x,
      q.y,
      camX,
      camY,
    );
  }
  for (const q of hereOf((l) => l.bushes))
    drawLevelCel(bushCel(q), q.x, q.y, camX, camY, q.mirror);
  for (const r of roaches) {
    drawLevelCel(
      r.onGround
        ? ROACH.run.cels[loopIndex(ROACH.run, r.clock)]
        : ROACH.drop.cels[0],
      r.x,
      r.y,
      camX,
      camY,
    );
  }
  for (const [slot, clock] of columns) {
    const q = hereOf((l) => l.sprinklers).find((w) => w.slot === slot);
    if (q) drawLevelCel(columnCel(clock), q.x, q.y, camX, camY);
  }
  for (const d of drips) drawLevelCel(dripCel(d), d.x, d.y, camX, camY);
  for (const c of crowsHere()) drawLevelCel(crowCel(c), c.x, c.y, camX, camY);
  for (const f of feathers) {
    drawLevelCel(featherCel(f), f.x, f.y, camX, camY, f.mirror);
  }
  /**
   * ...in the engine's own order, which is by CLASS, not by record, and with
   * the player's own call among them: the ones his level draws before him
   * here, the rest after him ({@link ENEMY_PASSES}). Drawn in record order, a
   * rat's hole placed after a punk was painted over him.
   */
  const creatures = enemyPasses();
  for (const e of creatures.before) drawEnemy(e, camX, camY);
  // the goal's craft and the goo share the play plane with the player: the
  // engine's own effect class is collected with the actors, not the backdrop
  drawCraft(camX, camY);
  for (const c of hereOf((l) => l.cages)) {
    const id = cageCel(c);
    if (id) drawLevelCel(id, c.x, c.y, camX, camY);
  }
  for (const a of hereOf((l) => l.alarms))
    drawLevelCel(alarmCel(a), a.x, a.y, camX, camY);
  // the big guns: the turret first, then the hatch over it, because the hatch is
  // what the turret comes out THROUGH
  for (const g of hereOf((l) => l.bigguns)) {
    const barrel = gunCel(g);
    // `0x4135cc` — the gun's own mirror flag is which side of it you are on
    if (barrel) drawLevelCel(barrel, g.x, g.gunY, camX, camY, p.x > g.x);
    drawLevelCel(hatchCel(g), g.x, g.y, camX, camY);
  }
  for (const q of hereOf((l) => l.lights)) {
    const id = lightCel(q);
    if (id) drawLevelCel(id, q.x, q.y, camX, camY, q.mirror);
  }
  // ...and whatever a probe fired, on the PLAYER's book rather than the level's,
  // which is why no level book carries 20200..20211
  for (const f of flypasts)
    drawPlayerCel(flypastCel(f), f.x, f.y, camX, camY, f.mirror);
  for (const b of hereOf((l) => l.belts))
    drawLevelCel(beltCel(b), b.x, b.y, camX, camY);
  for (const c of hereOf((l) => l.chairs))
    drawLevelCel(chairCel(c), c.x, c.y, camX, camY);
  for (const c of hereOf((l) => l.claws))
    drawLevelCel(clawCel(c), c.x, c.y, camX, camY);
  for (const f of hereOf((l) => l.fittings))
    drawLevelCel(fittingCel(f), f.x, f.y, camX, camY);
  for (const b of hereOf((l) => l.boggs)) {
    // the machinery behind it, then the body, then the arm it hangs in front of,
    // then the head. The disassembly settles where each of these STANDS but not
    // what order they are painted in, and this is the order that reads.
    for (let i = 0; i < b.machines.length; i++)
      drawLevelCel(
        machineCel(b, i),
        b.machines[i].x,
        b.machines[i].y,
        camX,
        camY,
      );
    for (const m of b.worms) drawLevelCel(boggsWormCel(m), m.x, m.y, camX, camY);
    drawLevelCel(boggsCel(b), b.x, b.y, camX, camY);
    drawLevelCel(BOGGS.arm.poses[BOGGS.arm.tag], b.x, b.y, camX, camY);
    const j = jawsAt(b);
    drawLevelCel(jawsCel(b), j.x, j.y, camX, camY);
    drawLevelCel(boggsHeadCel(b), b.headX, b.headY, camX, camY);
  }
  for (const q of hereOf((l) => l.fans))
    drawLevelCel(fanCel(q), q.x, q.y, camX, camY);
  for (const f of hereOf((l) => l.floors))
    drawLevelCel(floorCel(f), f.x, f.y, camX, camY);
  for (const q of hereOf((l) => l.surges))
    drawLevelCel(surgeCel(q), q.x, q.y, camX, camY, q.mirror);
  for (const b of hereOf((l) => l.bridges))
    drawLevelCel(bridgeCel(b), b.x, b.y, camX, camY);
  for (const a of hereOf((l) => l.axes))
    drawLevelCel(axeCel(a), a.x, a.y, camX, camY);
  for (const h of hereOf((l) => l.holes))
    drawLevelCel(holeCel(h), h.x, h.y, camX, camY);
  for (const q of hereOf((l) => l.hands)) {
    const id = handCel(q);
    if (id) drawLevelCel(id, q.atX, q.atY, camX, camY);
  }
  drawPickups(camX, camY);
  drawGuns(camX, camY);
  drawFlares(camX, camY);
  drawBolts(camX, camY);
  // a dropped board lies under everything that is still standing up
  for (const d of skates)
    drawLevelCel(d.down ? SKATEBOARD.rest : SKATEBOARD.hop.cel, d.x, d.y, camX, camY, d.vx < 0);
  // ...and a roller rolls along the same ground
  for (const r of rollers)
    // `0x43a7d7` — its facing is the sign of the launch it was handed
    drawLevelCel(rollerCel(r), r.x, r.y, camX, camY, r.launch < 0);
  // ...and the cans, which outlive their flight: a landed one is the ART of
  // the pickup underneath it, because code 2 keeps cel 14000 and no book in
  // the game carries that. See {@link CAN}.
  for (const c of cans) drawLevelCel(canCel(c), c.x, c.y, camX, camY, c.vx < 0);
  // ...and the flames LAST, because a flame is an object standing on top of
  // whatever it is burning and not a wash over its cel
  for (const f of flames) drawLevelCel(flameCel(f), f.x, f.y, camX, camY, false);
  drawCasts(camX, camY);
  drawStreams(camX, camY);
  drawGobs(camX, camY);
  drawPops(camX, camY);

  // the player, feet on the ground, between the rate-1 planes and the
  // foreground — the disc's own cels for both facings, so nothing is mirrored
  const id = lastCel;
  const loc = player.byId.get(id);
  if (loc !== undefined) {
    const art = playerCel(loc);
    if (art) {
      // one set of cels, flipped by facing, and placed the way `0x4026d0`
      // places every cel in the game: its anchor on the object's point and,
      // mirrored, reflected about that anchor. `p.x` is the anchor's x, which
      // is what the body box, the strike box, the ladder's bitmap test and the
      // streams all hang off, so the art has to hang off it too — cels 661..665
      // put their anchor 12 pixels outside their own art, and the dying cels
      // 901..903 over a hundred pixels in, and both are the artist's.
      //
      // Vertically the art stands on `p.y`: the mover puts the current cel's
      // own extent below its anchor (`height - posY`, `0x42fdcf`) on the floor.
      // A ladder holds the anchor on the rung instead.
      const rec = celRec(player, id);
      const sx = p.x - camX + W / 2;
      const left = rec
        ? p.facing < 0
          ? sx - (art.width - rec.posX)
          : sx - rec.posX
        : sx - art.width / 2;
      const top =
        rec && p.climbing
          ? p.climbY - camY + VIEW.y - rec.posY
          : p.y - camY + VIEW.y - art.height;
      if (p.facing < 0) {
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(art, -(left + art.width), top);
        ctx.restore();
      } else ctx.drawImage(art, left, top);
    }
  }
  /**
   * ...and the FRONT of every lift car, over the player standing in it.
   *
   * `0x453310` is the elevator class's collector and CITY's frame function
   * (`0x4515d0`) calls it TWICE, with the player queued between the two:
   *
   * ```
   *   4517ac  push edi (0)      ; 45332e: cel 0x47f = 1151, the BACK
   *   4517ad  call 0x453310
   *   4517d7  call 0x402980     ; 42fbd0([0x4ac3d4]) — THE PLAYER
   *   4517eb  push 1            ; 45334a: cel 0x47e = 1150, the FRONT,
   *   4517ed  call 0x453310     ;         and 42fbd0(winch) with it
   *   4517fc  call 0x40c8b0(1)  ; the foreground planes, last
   * ```
   *
   * `0x4515db` zeroes edi for the whole function, so the first pass really is
   * the 0 case. The art agrees: 1151 is 113x190 and 73% opaque — a back wall —
   * while 1150 is 106x314 and only 42%, a frame with a hollow middle, a mesh
   * across its lower front and the cable above. Drawing 1150 alone, and before
   * the player, put the rider's boots over the mesh he should be standing
   * behind and left the back of the cage off the screen entirely.
   */
  for (const e of elevatorsHere()) {
    drawLevelCel(ELEVATOR.car.front, e.x, e.y, camX, camY);
    drawLevelCel(elevatorCel(e), e.x, e.winchY, camX, camY);
  }
  // ...and the creatures this level draws after `0x402980` ({@link ENEMY_PASSES})
  for (const e of creatures.after) drawEnemy(e, camX, camY);

  // and everything after (planes 4, 1, 2 — the lamp-post and cables in front)
  for (const q of lvl.draw) if (q.z > PLAY_PLANE_Z) drawOne(q);

  ctx.restore();

  // `0x40dfd0` — whatever queued a colour gets one frame of the whole view rect
  // in it, and then the queue is empty again. It is drawn over the level and
  // under the panel, because `0x40e0b0` fills the view rect and nothing else.
  if (flashColour >= 0) {
    const pal = level?.pal;
    const i = flashColour * 4;
    ctx.save();
    ctx.fillStyle = pal
      ? `rgb(${pal[i]}, ${pal[i + 1]}, ${pal[i + 2]})`
      : "#fff";
    ctx.fillRect(VIEW.x, VIEW.y, VIEW.w, viewH());
    ctx.restore();
    setFlashColour(-1);
  }

  if (iface) {
    paintHud(ctx, HUD_ART, {
      // nothing here can hurt the player, so the left-hand bar reads full: 1024
      // is the engine's own default max (`0x40d3a0`'s `mov dx, 0x400`)
      player: {
        health: stats.health,
        max: stats.maxHealth,
        nameCel: CEL.skullcracker,
      },
      enemy: stats.shown,
      score: stats.score,
      lives: stats.lives,
      // the engine's own expression: what is alive, less what may remain
      // (`0x415f55` computes it with the same subtraction the win test makes)
      quota: Math.max(0, aliveNow() - stats.allowance),
      ticks: stats.ticks,
      buttons: buttonMask(),
      // `0x40d663` — the icon is drawn only while `[0x479438]` is set, but the
      // four gauge rows are drawn whatever, out of the weapon record's own
      // `max` and `rounds`. So an empty hand still shows the rounds you are
      // carrying for the gun you are looking for.
      weapon: {
        iconCel: inv.armed ? (WEAPONS[inv.weapon]?.icon ?? 0) : 0,
        ammo: roundsIn(inv.weapon),
        magazine: WEAPONS[inv.weapon]?.max ?? 0,
      },
      // `0x40cf00`'s closing loop: the eight names are read out of the key map
      // itself, so the band says whatever the preferences panel last bound.
      keys: PREFS.keys.map((k) => keyName(k)),
      labelInk: panelInk(),
    });
  }

  const room = p.room;
  const which = room ? `${room.name}/p${room.param}` : "nowhere";
  const doors = room?.exits.length
    ? ` · doors to ${room.exits.map((e) => `p${e.to}`).join(", ")}`
    : "";
  const celNow = ` · cel ${lastCel}`;
  // which of the two players `0x46b1a8` is on — Shift+C is action 11
  const who = ` · char ${CHARACTER}`;
  // the view's own corner — `[0x4a8970]`, which is what a probe has to read to
  // say anything about what is on screen
  const cam = ` · view ${Math.round(view.x)},${Math.round(view.y)}`;
  // MAZE's big guns and TOWER's lightning, so a probe can watch either run
  const guns = hereOf((l) => l.bigguns);
  const gunSay = guns.length
    ? ` · ${guns.map((g) => `biggun ${g.state}/${g.hatch} y${Math.round(g.gunY)} cel ${gunCel(g)}`).join(" ")}`
    : "";
  const lit = level?.lights.flat() ?? [];
  const flySay = flypasts.length
    ? ` · ${flypasts.length} flypast ${flypasts.map((f) => `tag${f.tag}@${Math.round(f.x)},${Math.round(f.y)} cel ${flypastCel(f)}`).join(" ")}`
    : "";
  const litSay = lit.length
    ? ` · lightfx ${levelClock}/${LIGHTFX.period - 1} ${lit.map((q) => lightCel(q)).join(",")}`
    : "";
  // the word for four seconds after it is typed, so a probe can see one land
  const cheated =
    cheatSaid && performance.now() - cheatSaid.at < 4000
      ? ` · <b>${cheatSaid.cheat.word}</b> — ${cheatSaid.cheat.say}`
      : "";
  const state = p.act
    ? ` · ${p.act}`
    : p.bar
      ? ` · hanging hold ${p.barHold} tag ${p.barTag}` +
        ` at x ${Math.round(p.x)}, y ${Math.round(p.y)}`
      : p.climbing
        ? ` · climbing rung ${p.rung} tag ${p.climbTag}`
        : !p.onGround
        ? " · in the air"
        : p.crouching
          ? " · crouching"
          : p.moving
            ? ` · ${p.running ? "RUNNING" : "walking"} ${Math.abs(p.vx) * ENGINE_HZ}px/s`
            : "";
  const here = solids();
  const box = playerBox();
  const inside = (e: SbkEntity): boolean =>
    box.right > e.left &&
    box.left < e.right &&
    box.bottom > e.top &&
    box.top < e.bottom;
  const atDoor =
    room?.exits.some((e) => inside(e as unknown as SbkEntity)) ?? false;
  const alive = aliveNow();
  const ready = goalReady();
  // SERVICE's second condition, {@link waitsForHardcore}
  const bossSay = waitsForHardcore() ? " and HARDCORE still standing" : "";
  const inGoal = here.goal !== undefined && inside(here.goal);
  const won = craftOpened();
  // the level is thousands of pixels wide and its end is one rect in it, so say
  // where that rect is rather than leaving it to be found by walking
  const g = here.goal;
  const away = g ? (g.left + g.right) / 2 - p.x : 0;
  const toGoal = won
    ? ` · <b>THE GOAL — level ${levelIndex + 1} complete</b>`
    : !g
      ? ""
      : craft?.state === "open"
        ? ` · <b>the screen is coming down</b>`
        : craft
          ? inGoal
            ? ` · <b>at the goal</b> — the television is overhead`
            : ` · <b>the television is in</b> ${Math.abs(Math.round(away))}px ${away < 0 ? "west" : "east"}, y ${g.top}`
          : inGoal
            ? ` · <b>at the goal</b> — ${Math.max(0, alive - stats.allowance)} still to kill${bossSay}`
            : ready
              ? ` · <b>the television is coming</b>`
              : ` · goal ${Math.abs(Math.round(away))}px ${away < 0 ? "west" : "east"}, y ${g.top} — ` +
                `<b>${Math.max(0, alive - stats.allowance)} still to kill</b>${bossSay}`;
  // the quota the same way the panel says it: alive minus what may remain
  const quotaSay =
    ` · quota ${Math.max(0, alive - stats.allowance)} of ${Math.max(0, stats.census - stats.allowance)}` +
    ` (kill ${Math.round(mission().kill * 100)}% of ${stats.census})`;
  const prompt = atDoor && !won ? " · <b>press ↑ for the door</b>" : "";
  const mob = spawnedHere().length ? ` · ${spawnedHere().length} spawned` : "";
  // how many of them have noticed you — the one number that says the shared AI
  // is running at all ({@link stepFight})
  const onto = spawnedHere().filter((e) => e.fighting).length;
  const fighting = onto ? ` · ${onto} fighting` : "";
  // the nearest thing that can be fought, and what it is doing — without this the
  // only window into a fight is the panel's bar, which is sticky and cannot say
  // whose it is or why a blow is missing
  const near = spawnedHere()
    .filter((e) => FOES[e.kind].panel)
    .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
  const foe = near
    ? ` · nearest ${near.kind} ${Math.round(near.hp)}/${near.max}hp ${near.state}` +
      ` at x ${Math.round(near.x)}, y ${Math.round(near.y)} cel ${celOf(near)}` +
      ` facing ${near.facing > 0 ? "east" : "west"}` +
      // the state of the one class that has states, so a probe can see it decide
      (near.mode ? ` mode ${near.mode}` : "") +
      // ...and, for every class with a machine of its own, the state IS the kind
      // of the script it is playing — `obj+0x18` and `obj+0x44`, straight out of
      // {@link file://./brains/kit.ts}. A probe that used to read `mode` reads
      // this instead, and it is the disc's own numbering rather than a name
      // this page invented
      (near.script !== undefined
        ? ` kind ${near.script} tag ${near.tag ?? 0}`
        : "") +
      // ...and of the twenty-six that share one — {@link stepFight}
      (near.fighting ? (near.swing ? " SWINGING" : " closing") : "")
    : "";
  // ...and the nearest thing that can be fought and claims no PLATE, which the
  // line above cannot show. The dog is the case — `0x40d1c0` is never called from
  // any of its functions, so it has no bar and no name on the panel — and so is
  // the rat. Without this a probe cannot see either of them at all.
  const plain = spawnedHere()
    .filter(
      (e) => !FOES[e.kind].panel && (FOES[e.kind].death || FOES[e.kind].flinch),
    )
    .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
  const unplated = plain
    ? ` · unplated ${plain.kind} ${Math.round(plain.hp)}/${plain.max}hp ${plain.state}` +
      ` at x ${Math.round(plain.x)}, y ${Math.round(plain.y)} cel ${celOf(plain)}` +
      (plain.script !== undefined
        ? ` kind ${plain.script} tag ${plain.tag ?? 0}`
        : "")
    : "";
  // the hydrant and its water: neither has a health bar, and the whole point of
  // the burst is that one object turns into two and back into one
  // the crows, which are the only thing on this page that flies
  const birds = crowsHere();
  // whichever is nearest, plus anything that is not asleep — the two things worth
  // knowing, and a probe can read either
  const shown = [
    ...birds.filter((c) => c.state !== "sleep"),
    ...[...birds]
      .sort((a, c) => Math.abs(a.x - p.x) - Math.abs(c.x - p.x))
      .slice(0, 1),
  ].filter((c, i, all) => all.indexOf(c) === i);
  const bird = birds.length
    ? ` · ${birds.length} crow${birds.length === 1 ? "" : "s"}: ` +
      shown
        .slice(0, 3)
        .map(
          (c) =>
            `${c.state} cel ${crowCel(c)} at ${Math.round(c.x)},${Math.round(c.y)}`,
        )
        .join(" · ")
    : "";
  // the planks: a probe cannot otherwise tell a sound board from one about to go
  const boards = planksHere().filter(
    (k) => k.state !== "intact" || k.crossings > 0,
  );
  const board = boards.length
    ? ` · ${boards.map((k) => `plank ${k.state} cel ${plankCel(k)} x${Math.round(k.x)} crossed ${k.crossings}`).join(" · ")}`
    : "";
  // the elevators: a probe cannot otherwise tell a car that is waiting from one
  // it never boarded, and the deck's y is the only way to see a ride happen
  const cars = elevatorsHere();
  const car = cars.length
    ? ` · ${cars
        .map(
          (e) =>
            `lift ${e.state} car ${ELEVATOR.car.back}/${ELEVATOR.car.front} winch ${elevatorCel(e)} deck y${Math.round(e.floor.top)} of ${e.top}..${e.bottom}` +
            `${ridingElevator(e) ? " RIDDEN" : ""}`,
        )
        .join(" · ")}`
    : "";
  // the girders, so a probe can see a swing happen at all: nothing else moves them
  const swung = ibeamsHere().filter((b) => b.delay <= 0);
  const beam = swung.length
    ? ` · ${swung
        .slice(0, 3)
        .map((b) => `beam ${b.state} cel ${ibeamCel(b)} at ${b.x},${b.y}`)
        .join(" · ")}`
    : "";
  // the presses: a probe cannot otherwise tell one that is up and watching from
  // one that is coming down, and the two cels that hurt are named in CRUSH
  const presses = crushesHere().filter((c) => c.state !== "idle");
  const press = presses.length
    ? ` · ${presses
        .slice(0, 3)
        .map((c) => `press ${c.state} cel ${crushCel(c)} at ${c.x},${c.y}`)
        .join(" · ")}`
    : "";
  // level six's levers and what they are pouring, so a probe can see both
  const levers = switchesHere();
  const lever = levers.length
    ? ` · ${levers.map((w) => `switch ${w.param} ${w.state} cel ${switchCel(w)} at x ${w.x}`).join(" · ")}`
    : "";
  // the level's doors, not the room's: one lever in one region opens a door in
  // another, and the engine holds one list for the stage ({@link broadcast})
  const gates = level?.doors.flat() ?? [];
  const gate = gates.length
    ? ` · ${gates.map((d) => `door ${d.param} ${d.state}`).join(" · ")}`
    : "";
  const sumps = elevsHere();
  const sump = sumps.length
    ? ` · ${sumps.map((e) => `lift x${e.x} ${e.state} y${Math.round(e.y)}`).join(" · ")}`
    : "";
  // the scenery, so a probe can see the two of it that move on their own
  const props = [
    ...hereOf((l) => l.shacks)
      .filter((k) => k.state !== "shut")
      .map((k) => `shack ${k.state} cel ${shackCel(k)}`),
    ...hereOf((l) => l.barrels).map(
      (b) => `barrel at ${Math.round(b.x)},${Math.round(b.y)}`,
    ),
    ...hereOf((l) => l.pipes).map((q) => `pipe at x${q.x}`),
    ...hereOf((l) => l.holes).map(
      (h) => `grave ${h.state} cel ${holeCel(h)} at x${h.x}`,
    ),
    ...hereOf((l) => l.axes).map((a) => `axe cel ${axeCel(a)} at x${a.x}`),
    ...hereOf((l) => l.floors).map(
      (f) => `floor ${f.state} cel ${floorCel(f)} at x${f.x}`,
    ),
    ...hereOf((l) => l.cages).map(
      (c) => `cage ${c.param} ${c.state} cel ${cageCel(c)} at x${c.x}`,
    ),
    ...hereOf((l) => l.fans).map(
      (q) =>
        `fan ${q.horizontal ? "h" : "v"} ${q.state} cel ${fanCel(q)} at x${q.x}`,
    ),
    hereOf((l) => l.belts).length
      ? `${hereOf((l) => l.belts).length} belts`
      : "",
    ...hereOf((l) => l.chairs).map(
      (c) => `chair ${c.run} cel ${chairCel(c)} at x${c.x}`,
    ),
    ...hereOf((l) => l.claws).map(
      (c) =>
        `claw ${c.state} cel ${clawCel(c)} at x${Math.round(c.x)} gap ${Math.round(Math.abs(c.x - p.x))}`,
    ),
    ...hereOf((l) => l.fittings).map(
      (f) => `${f.kind} cel ${fittingCel(f)} at x${f.x}`,
    ),
    ...hereOf((l) => l.boggs).map((b) => {
      const heals = b.flags[0] || b.flags[1];
      const halves = BOGGS.machines
        .map((m, k) =>
          "health" in m
            ? `${Math.round(b.machines[k].hp)}/${scaled(m.health)}@x${Math.round(b.machines[k].x)}`
            : null,
        )
        .filter((t) => t !== null)
        .join(" ");
      return (
        `boggs ${b.dying ? "dying" : (b.lunge ?? "idle")} cel ${boggsCel(b)} at x${Math.round(b.x)}, y${b.y}, ` +
        `${Math.round(b.hp)}/${scaled(BOGGS.health)}hp, ${heals ? `+${BOGGS.regen} a frame` : "no longer healing"}` +
        ` · head ${boggsHeadCel(b)} tag ${b.headTag} · machine ${halves}` +
        ` flags ${b.flags[0] ? 1 : 0}${b.flags[1] ? 1 : 0}`
      );
    }),
    ...hereOf((l) => l.surges).map(
      (q) => `surge ${q.on ? "on" : "off"} cel ${surgeCel(q)} at x${q.x} y${Math.round(q.y)}`,
    ),
    ...hereOf((l) => l.bridges).map(
      (b) => `bridge ${b.state} cel ${bridgeCel(b)} at x${b.x}`,
    ),
    ...hereOf((l) => l.hands).map(
      (q) =>
        `hand ${q.state}${q.underfoot ? " underfoot" : ""} cel ${handCel(q)} at x${Math.round(q.atX)}`,
    ),
    ...hereOf((l) => l.bushes).map(
      (q) =>
        `bush ${q.state} cel ${bushCel(q)} at x${Math.round(q.x)}, y${Math.round(q.y)}`,
    ),
    roaches.length ? `${roaches.length} roaches` : "",
    hereOf((l) => l.sprinklers).length
      ? `${hereOf((l) => l.sprinklers).length} sprinklers, ${columns.size} up${columns.size ? ` cel ${columnCel([...columns.values()][0])}` : ""}`
      : "",
  ].filter(Boolean);
  const prop = props.length ? ` · ${props.join(" · ")}` : "";
  // what the two tests say about the nearest pickup, which is the only way to
  // see the second one doing anything — see {@link spritesTouch}
  const nearPick = hereOf((l) => l.pickups).sort(
    (a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x),
  )[0];
  const touch = (() => {
    if (!nearPick || !player) return "";
    const box = playerBox();
    const rect =
      box.right > nearPick.left &&
      box.left < nearPick.right &&
      box.bottom > nearPick.top &&
      box.top < nearPick.bottom;
    const kind = PICKUP.kinds[nearPick.code];
    const loc = player.byId.get(kind.cels[loopIndex(kind, nearPick.clock)]);
    const pf = loc === undefined ? null : playerFrame(loc);
    const me = playerSprite();
    const px =
      pf && me
        ? spritesTouch(me, {
            f: pf,
            left: nearPick.x - pf.posXraw,
            top: nearPick.y - pf.posYraw,
            mirror: false,
          })
        : false;
    return ` · pickup rect ${rect ? "yes" : "no"} pixels ${px ? "yes" : "no"}`;
  })();
  const got = hereOf((l) => l.pickups);
  const gots = got.length
    ? (() => {
        const q = got.reduce((a, b) =>
          Math.abs(b.x - p.x) < Math.abs(a.x - p.x) ? b : a,
        );
        return ` · ${got.length} pickups · nearest ${PICKUP.kinds[q.code].name} ${q.code} at x ${q.x}, y ${q.y}`;
      })()
    : "";
  const arms = hereOf((l) => l.guns);
  const gun = WEAPONS[inv.weapon];
  const far = (g: Gun): number => Math.hypot(g.x - p.x, g.y - p.y);
  const lying = arms.length
    ? arms.reduce((a, b) => (far(b) < far(a) ? b : a))
    : null;
  const armed =
    ` · ${inv.armed ? "holding" : "no"} ${gun ? gun.name : inv.weapon} ${roundsIn(inv.weapon)}/${gun ? gun.max : 0}` +
    (arms.length
      ? ` · ${arms.length} guns · nearest ${GUN_CODES[lying!.code]?.name ?? lying!.code} at x ${Math.round(lying!.x)}, y ${Math.round(lying!.y)}${gunAhead() ? " IN REACH" : ""}`
      : "") +
    (flares.length ? ` · ${flares.length} flares` : "");
  const pools = hereOf((l) => l.sewage);
  const pool = pools.length ? ` · ${pools.length} sewage` : "";
  const nests = nestsHere();
  const goop = nests.length
    ? ` · goop ${nests.filter((n) => n.on).length} of ${nests.length} on, ${drips.length} falling${drips.length ? ` cel ${dripCel(drips[0])} at ${Math.round(drips[0].x)},${Math.round(drips[0].y)}` : ""}`
    : "";
  const valves = spawnedHere()
    .filter((e) => FOES[e.kind].burst)
    .map(
      (e) =>
        `${e.state === "burst" ? "water" : e.kind} cel ${celOf(e)} at x ${Math.round(e.x)}`,
    );
  const valve = valves.length ? ` · ${valves.join(" · ")}` : "";
  // where a struck thing ends up, which is the only way to see a slide from a
  // probe: the flying kinds have no health bar to read
  const flew = spawnedHere().find(
    (e) => FOES[e.kind].flies && (e.vx !== 0 || e.dents > 0),
  );
  const slid = flew ? ` · ${flew.kind} at x ${Math.round(flew.x)}` : "";
  // the blow CODES — the reaction playing, what has hold of you, and the state
  // of the nearest hand, none of which the panel shows and all of which a probe
  // needs to see the system at all
  const reacting = Object.values(BLOW_CODES).find((r) => r.act === p.act);
  const code =
    (reacting
      ? ` · <b>code ${reacting.code}</b> ${reacting.act} frame ${Math.floor(p.actClock)}`
      : "") +
    (p.act === "held" || p.act === "struggle"
      ? ` · <b>${p.act}</b> frame ${p.heldClock}`
      : "") +
    (p.heldBy ? ` · HELD, gravity x${p.gravityScale}` : "");
  const air =
    (held.inv ? " · <b>INV held</b> — holstered, standing" : "") +
    (bolts.length
      ? ` · ${bolts.length} bolts, nearest at x ${Math.round(bolts[0].x)}, y ${Math.round(bolts[0].y)} vx ${Math.round(bolts[0].vx)}`
      : "") +
    (streams.length
      ? ` · stream ${streams[0].state} cel ${streamCel(streams[0])} at x ${Math.round(streams[0].x)}` +
        `, y ${Math.round(streams[0].y)} blow ${STREAMS[streams[0].weapon]?.blow}`
      : "") +
    // what a CREATURE has thrown: the one thing in a fight that is neither the
    // player's nor standing in front of him, so a probe has no other way to see it
    (casts.length
      ? ` · ${casts.length} cast, nearest cel ${castCel(casts[0])} at x ${Math.round(casts[0].x)}` +
        `, y ${Math.round(casts[0].y)} blow ${castBlow(casts[0])}` +
        ` vx ${Math.round(casts[0].vx)} vy ${Math.round(casts[0].vy)}` +
        // ...and how many are playing their impact, and how many are on fire
        `, ${casts.filter((c) => c.landed !== undefined).length} bursting` +
        `, ${casts.filter((c) => flames.some((f) => f.on === c)).length} lit` +
        `, ${casts.filter((c) => c.setOff).length} set off`
      : "") +
    // ...and the two things this page makes that belong to nobody's hand
    (skates.length
      ? ` · ${skates.length} board, first cel ${skates[0].down ? SKATEBOARD.rest : SKATEBOARD.hop.cel}` +
        ` at x ${Math.round(skates[0].x)}, y ${Math.round(skates[0].y)} life ${skates[0].life}`
      : "") +
    (wormsHere().length
      ? ` · ${wormsHere().length} worm, first kind ${wormsHere()[0].kind}` +
        ` cel ${boggsWormCel(wormsHere()[0])} at x ${Math.round(wormsHere()[0].x)}` +
        `, y ${Math.round(wormsHere()[0].y)}`
      : "") +
    // ...and the roller, whose whole first second is standing still, so a probe
    // needs the countdown as much as it needs the position
    (flames.length
      ? ` · ${flames.length} alight, first cel ${flameCel(flames[0])}` +
        ` at x ${Math.round(flames[0].x)}, y ${Math.round(flames[0].y)}` +
        ` stage ${flames[0].stage}${flames[0].forever ? " FOREVER" : ""}`
      : "") +
    (cans.length
      ? ` · ${cans.length} can, first cel ${canCel(cans[0])}` +
        ` at x ${Math.round(cans[0].x)}, y ${Math.round(cans[0].y)}` +
        ` tag ${cans[0].tag} vx ${Math.round(cans[0].vx)}` +
        `${cans[0].rest !== undefined ? " RESTING" : ""}`
      : "") +
    (rollers.length
      ? ` · ${rollers.length} roller, first cel ${rollerCel(rollers[0])}` +
        ` at x ${Math.round(rollers[0].x)}, y ${Math.round(rollers[0].y)}` +
        ` wait ${rollers[0].wait} vx ${rollers[0].vx} blow ${rollerBlow(rollers[0])}`
      : "");
  // ...and a BOSS always, whichever of the three it is: the "nearest" line goes
  // to whatever is closest in x, and TOWER's bats chase, so one of them is
  // always nearer than the thing the room is about
  const bossHere = spawnedHere().find(
    (e) => FOES[e.kind].haunts || FOES[e.kind].preaches || FOES[e.kind].drives,
  );
  const boss = bossHere
    ? ` · boss ${bossHere.kind} ${Math.round(bossHere.hp)}/${bossHere.max}hp ${bossHere.state}` +
      ` at x ${Math.round(bossHere.x)}, y ${Math.round(bossHere.y)} cel ${celOf(bossHere)}` +
      `${bossHere.asleep ? " asleep" : ""}${bossHere.mode ? ` mode ${bossHere.mode}` : ""}${bossHere.script !== undefined ? ` kind ${bossHere.script} tag ${bossHere.tag ?? 0}` : ""}`
    : "";
  // what the RIGHT-HAND BAR is showing, which is a competition every frame and
  // not a property of the room — `0x40d1c0`, and Boggs enters it from its own
  // tick rather than from the census. See {@link claimBar}.
  const bar = stats.shown
    ? ` · bar ${stats.shown.health}/${stats.shown.max} plate ${stats.shown.nameCel}`
    : " · bar empty";
  const nearHand = hereOf((l) => l.hands).sort(
    (a, b) => Math.abs(a.atX - p.x) - Math.abs(b.atX - p.x),
  )[0];
  const hand = nearHand
    ? ` · nearest hand ${nearHand.underfoot ? "underfoot" : "anywhere"} ${nearHand.state}` +
      ` cel ${handCel(nearHand)} at x ${Math.round(nearHand.atX)}` +
      ` blow ${(nearHand.underfoot ? HAND.underfoot : HAND.anywhere).blow}`
    : "";
  const lives =
    (ended ? " · <b>THE END</b> — credits.mov, and then the front again" : "") +
    ` · ${stats.lives} ${stats.lives === 1 ? "life" : "lives"} · clock ${Math.round(stats.ticks)}`;
  // the switch, and what it is spending — a probe has no other way to see either
  const hurt = damageOn
    ? ` · <b>damage ON</b> ${Math.round(stats.health)}/${stats.maxHealth}hp`
    : " · damage off";
  // the panel already shows it in the disc's own digits; this is for the probes,
  // which can read a number out of text and can only count pixels off a canvas
  const points = ` · ${stats.score} points`;
  // what the panel's middle button wrote, so a probe can see the save happen
  const saved = saidSave ? ` · saved ${saidSave}` : "";
  hud.innerHTML =
    `<b>level ${levelIndex + 1} · ${lvl.name}</b> · room ${lvl.rooms.indexOf(room!) + 1} of ` +
    `${lvl.rooms.length} (${which})${doors}` +
    `${room && !room.ground ? ` · flat floor at y ${room.top + room.floorDrop} (no region)` : ""}` +
    ` · x ${Math.round(p.x)}, y ${Math.round(p.y)}${state}${celNow}${who}${cam}${gunSay}${litSay}${flySay}${mob}${fighting}${foe}${unplated}${valve}${board}${car}${beam}${press}${lever}${goop}${gate}${sump}${prop}${pool}${gots}${armed}${bird}${slid}${boss}${bar}${touch}${code}${hand}${air}${lives}${hurt}${points}${saved}${quotaSay}${prompt}${toGoal}${cheated}` +
    ` · every pixel is the disc's, both facings included, and the motion is SC.EXE's`;
}

/**
 * The panel's cels, by the book's own ids.
 *
 * `src/hud.ts` knows every id and every coordinate and nothing about where the
 * pixels come from; this is the join. The player's book holds all of them — the
 * two bands, the sliding bars, the name plates, the numerals, the dial and the
 * eight button lights are all in `PLAYER.SBK`.
 */
const HUD_ART = {
  art: (id: number): CanvasImageSource | null => {
    const loc = player?.byId.get(id);
    return loc === undefined ? null : playerCel(loc);
  },
  hdr: (id: number): ShpFrame | null => {
    const loc = player?.byId.get(id);
    return loc === undefined ? null : playerFrame(loc);
  },
};

const playerCelCache = new Map<number, HTMLCanvasElement>();
function playerCel(loc: number): HTMLCanvasElement | null {
  const had = playerCelCache.get(loc);
  if (had) return had;
  if (!player || !playerPal) return null;
  let f: ShpFrame;
  try {
    f = decodeShpFrame(player.file.containers[loc].data);
  } catch {
    return null;
  }
  const c = document.createElement("canvas");
  c.width = f.width;
  c.height = f.height;
  const cc = c.getContext("2d")!;
  const img = cc.createImageData(f.width, f.height);
  for (let i = 0; i < f.width * f.height; i++) {
    if (!f.opaque[i]) continue;
    const q = f.indexed[i] * 4;
    img.data[i * 4] = playerPal[q];
    img.data[i * 4 + 1] = playerPal[q + 1];
    img.data[i * 4 + 2] = playerPal[q + 2];
    img.data[i * 4 + 3] = 255;
  }
  cc.putImageData(img, 0, 0);
  playerCelCache.set(loc, c);
  return c;
}

async function boot(): Promise<void> {
  setFiles(await SkullFiles.open());
  const sounds = new Sounds(files);
  setSound(sounds);
  // the two the front end settled that have no query string of their own
  sounds.setVolume(PREFS.volume);
  sounds.setMusic(PREFS.music);
  fillPicker();
  if (!(await startGame())) return;
  requestAnimationFrame(loop);
}

void boot().catch((e) => {
  hud.textContent = String(e);
});
