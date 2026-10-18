/**
 * Dying and coming back: the fall out of the world, the death and its red
 * fade, the death film, the respawn, and the spawn point a respawn goes to.
 */
import { Film } from "../film";
import { DEATH_FILMS, PIT_DEPTH } from "../mission";
import { random } from "../random";
import { p, ui, levelIndex, difficulty, level } from "./state";
import { nobodyNear, view, setCamVx, setCamVy } from "./camera";
import { dropAt, roomAt } from "./rooms";
import { inv } from "./arsenal";
import { stats, actOf } from "./blows";

/**
 * Has the player left the world? CITY is why this exists.
 *
 * Its ground is a ledge and then y7250 for the rest of the level, {@link
 * PIT_DEPTH}'s comment has the numbers, and landing on it put the player 2900px
 * below anything CITY draws with no way back. A room's rect is the world; more
 * than a shaft's depth below it, you are falling out of the level.
 *
 * This line is the port's: `SC.EXE` has no test like it. The mover clamps
 * nothing at a region's bottom (`0x430030` only hands the object on to a region
 * below), and the CITY fall ends on y7250 with the landing's own fatal-fall test
 * (`0x443c82`). It stays as the backstop for a floor that runs out under a
 * falling player, where the page would otherwise fall for ever.
 */
export function fellOut(): boolean {
  return !!p.room && p.y > p.room.bottom + PIT_DEPTH;
}

/**
 * Fell out: one of the seven KILL films, a life, and — when it was the last one
 * — the high-score board and the front door.
 *
 * `0x403340` is the state the seven vignettes belong to, and what it does after
 * the film is the whole of the game's ending:
 *
 * ```
 *   4033ca  0x40e990(KILLn.MOV)      ; one of seven, 0x434540(7)
 *   4033d9  ax = [0x46b20c]          ; the difficulty
 *   4033e3  0x40d4d0(ax)             ; ...and the score, [0x4a4f00]
 *   4033e9  0x40f650(score, ax)      ; offer it to that difficulty's ten rows
 *   4033ee  cx = 1                   ; and the shell goes back to the menu
 * ```
 *
 * So the board is not a menu button and it is not on the death screen: it is
 * what a finished game writes to, and the title film is where you read it. See
 * {@link file://../scores.ts}.
 *
 * And the film is the LAST life's, not every life's. The life is spent as the
 * dying animation ends, and the test comes after the body has lain there:
 *
 * ```
 *   4293eb  0x40d400(0x40d490() - 1)   ; [0x4a4d64], the lives, spent
 *   429454  state 27, and [0x4ac364] = 25 frames, or 40 with a creature within
 *           256 (0x42fad0(player, 512, 512))
 *   4294a6  0x429490 counts [0x4ac364] down, and once it is below zero:
 *   4294cb  0x40d490() < 0 ?  [0x4abdfe] = 9    ; state 9, 0x403340's vignette
 *   4294fb                 :  0x402760          ; back at the checkpoint
 * ```
 *
 * So a game over is the lives going BELOW zero: three on the panel is four
 * deaths, the last with no skull left to show. And the ordinary death does not
 * restart anything — `0x402760` moves the player and leaves the level exactly as
 * it was: see {@link respawn}.
 */
export function died(): void {
  if (advancing) return;
  advancing = true;
  stats.lives -= 1;
  // what reached here without the dying script lies still in it for the red:
  // `0x402fa0` puts every death through a kind-26 script, and this page plays
  // only the blow's
  if (p.act !== "dying") {
    p.act = "dying";
    p.actClock = Math.max(0, (actOf("dying")?.cels.length ?? 1) - 1) * (actOf("dying")?.hold ?? 1);
    p.vx = 0;
  }
  deathRed = { step: 0, hold: -1 };
}

/**
 * The red — what the screen does between a death and the checkpoint, and all
 * of it is `0x429392`, the dying state's handler, the frame its script ends.
 *
 * ```
 *   4293eb  0x40d400(0x40d490() - 1)            ; the life, spent
 *   429404  for step = 1 .. 50:
 *   429425    0x434680(firstredclut, redclut, step, 50)
 *   42942d    spin until 0x4087c0 has moved on  ; one sixtieth a step
 *   429454  state 27, and [0x4ac364] = 25 frames, or 40 if 0x42fad0 finds a
 *           creature in the 512x512 round the player
 *   4294a6  0x429490 counts it down, and once it is below zero:
 *   4294c3  0x434bf0([0x4a8960])                ; the level's own palette back
 *   4294cb  lives < 0 ? state 9, the vignette  :  0x402760, the checkpoint
 * ```
 *
 * The two CLUTs are `SC.EXE`'s own resources, `RAW/CLUT.FIRSTREDCLUT` and
 * `RAW/CLUT.REDCLUT` (`0x402860` loads them by those names at level start).
 * The first is 256 entries of pure red; the second is the Mac system palette
 * every level draws with, red channel kept and green and blue zeroed. So the
 * fade is: the frozen frame goes solid red, and over fifty sixtieths its red
 * channel comes back up through it — `0x434680` blends each 16-bit component
 * `a + (b - a) * step / 50`, truncated — and the world then runs on in red for
 * the hold. The loop at `0x429404` BLOCKS: nothing moves while it fades.
 */
export const DEATH_RED = {
  /** `mov esi, 0x32` at `0x4293e6`, one step per sixtieth */
  steps: 50,
  /** `0x429476` and `0x429485`: engine frames of state 27 */
  holdClear: 25,
  holdNear: 40,
  /** `0x42fad0(player, 0x200, 0x200)` at `0x429465` */
  box: 0x200,
} as const;

/** the red in progress: `step` counts the fade's sixtieths, `hold` state 27's frames */
export let deathRed: { step: number; hold: number } | null = null;

/**
 * One pixel under the red, at fade step `step` (50 and over is the finished
 * `REDCLUT`). Entries 0 and 255 are black and white in every level palette and
 * `0x434bf0` writes them so again, so those two stay as they are; everything
 * else is its own red channel, blended up from pure red. Only the red comes
 * back because in both CLUTs green and blue are nought.
 */
export function reddened(r: number, g: number, b: number, step: number): [number, number, number] {
  if ((r | g | b) === 0 || (r & g & b) === 255) return [r, g, b];
  if (step >= DEATH_RED.steps) return [r, 0, 0];
  const from = 0xffff;
  const to = r * 257;
  return [(from + Math.trunc(((to - from) * step) / DEATH_RED.steps)) >> 8, 0, 0];
}

/** the red, a frame at a time — frozen through the fade, then state 27's hold */
export function stepDeathRed(frame: boolean): boolean {
  if (!deathRed) return false;
  if (deathRed.step < DEATH_RED.steps) {
    deathRed.step += 1;
    if (deathRed.step === DEATH_RED.steps)
      deathRed.hold = nobodyNear(p.x, p.y - p.feet, DEATH_RED.box, DEATH_RED.box)
        ? DEATH_RED.holdClear
        : DEATH_RED.holdNear;
    return true;
  }
  // `0x4294a6`: the count before the decrement, so 25 is 26 frames of it
  if (frame && deathRed.hold-- < 0) void deathOver();
  return false;
}

/** `0x4294c3` on: the palette back, and the vignette or the checkpoint */
async function deathOver(): Promise<void> {
  deathRed = null;
  if (stats.lives < 0) {
    await ui.film(DEATH_FILMS[Math.floor(random() * DEATH_FILMS.length)]);
    ui.gameOver(stats.score, levelIndex + 1, difficulty);
    return;
  }
  respawn();
  restoreBoards();
  advancing = false;
}

/**
 * `0x402760` — back at the checkpoint, with the level as it was left.
 *
 * ```
 *   402769  health = [0x4ac3d8]                 ; the whole bar again
 *   402784  0x42f850(player, 1.0)               ; gravity back on
 *   4027a8  point = initplayer[[0x4ac38a]].point
 *   4027b8  obj+0x16 = -1, then 0x4308a0(point) ; the corner on the point, unclamped
 *   4027eb  obj+0x16 = 0x40b940(2, point)       ; and the region found again
 *   402803  vx = vy = 0, facing right (obj+0x28 = 0), obj+0x32 = 0
 * ```
 *
 * `[0x4ac38a]` is {@link spawnIndex}: zero as the level begins (`0x42e5fa`), and
 * the debug key's cycle is the same respawn with it stepped (`0x402cfe`).
 * Nothing else is touched — the creatures, the pickups and the clock carry on.
 */
export function respawn(): void {
  if (!level) return;
  const starts = level.sbk.entities.filter((e) => e.name === "initplayer");
  const e = starts[spawnIndex] ?? starts[0];
  const x = e ? e.pointX : level.anchorX;
  const y = e ? e.pointY : level.anchorY;
  stats.health = stats.maxHealth;
  dropAt(roomAt(x, y), x, y);
  p.vx = 0;
  p.facing = 1;
  p.fallPx = 0;
  // `0x42950f` — and the idle script goes in, which ends any flail or duck, and
  // puts the gun away: it is kind 0, and `0x479438` is left as it was
  p.flail = false;
  inv.drawn = false;
  p.inv15 = p.invLoop = false;
  p.crouching = false;
  p.act = null;
  p.actClock = 0;
  p.dyingTag = 0;
  setCamVx(0);
  setCamVy(0);
  view.x = x;
  view.y = y;
}

/** true while the films between two levels are running */
export let advancing = false;

// ---- the films ------------------------------------------------------------

/**
 * The film on screen, if any — the same player the films page uses.
 *
 * A film owns the screen while it runs: the world stops stepping and nothing
 * repaints under it, which is what lets a window-sized film keep the interface
 * around itself. The chapter films are 512x384 and cover everything; the four
 * TIME films are 512x232 at origin (0, 42), so the panel stays exactly where the
 * engine leaves it.
 *
 * There is no sound on this page until something is pressed — the browser will
 * not start an audio context before a gesture — so the sink starts deferred and
 * the first key or finger attaches a real one. The films' beds then play, and so
 * does the level's own theme ({@link file://../sound.ts}).
 */
export let film: Film | null = null;

/**
 * The engine's own level-testing tool, which the shipped key table leaves out.
 *
 * `SC.EXE`'s input dispatcher (`0x402be0`) has twenty handlers for actions −8…11,
 * and the 256-byte key table at `0x46b210` binds only eight of them. Two are
 * unbound, and both are a designer's:
 *
 * - **action 10** (`0x402cfe`) increments a counter, wraps it at the level's
 *   `initplayer` count (`0x46b9b4`) and jumps to `0x402760` — it walks the level's
 *   spawn points and teleports the player to each. That is this function.
 * - **action 11** (`0x402d22`) toggles `0x46b1a8`, and that word selects between
 *   two whole player implementations. The pairing is `0x402950`'s:
 *
 *   ```
 *     402950  movsx eax, word ptr [0x46b1a8]
 *     40295c  je 0x40296c  ->  call 0x428080   ; character 0 — the 4xxx cels
 *     402961  je 0x402975  ->  call 0x442ad0   ; character 1 — the 9xxx cels
 *   ```
 *
 *   `0x402900` and `0x402990` pair the rest the same way (`0x42e560`/`0x448a70`,
 *   `0x42e580`/`0x448a90`), and each character has its own hit handler and its
 *   own eight-slot blow-code table — see `src/codes.ts`. Character 1 is not
 *   wired here; the page plays character 0 throughout.
 *
 * The rest of the debug set needs a modifier held (the event's modifier word
 * against `0x1fa0`), which routes through a second table at `0x403ea4`:
 * **mod+0…9** jumps to a level, **mod+Q** and **mod+.** abort it, **mod+P** and
 * **mod+T** toggle two more things. So the game shipped with a level warp in it.
 */
export let spawnIndex = 0;
export function cycleSpawn(): void {
  if (!level) return;
  const starts = level.sbk.entities.filter((e) => e.name === "initplayer");
  if (!starts.length) return;
  spawnIndex = (spawnIndex + 1) % starts.length;
  const e = starts[spawnIndex];
  const y = e.pointY;
  const x = e.pointX;
  dropAt(roomAt(x, y), x, y);
}

/**
 * `0x453090` and `0x422230` — every plank and every rope bridge in the level
 * whole again, where its creator put it. Their class passes (`0x453040`,
 * `0x4221e0`) call them on the first frame the player is alive after being
 * dead, which is the respawn after a death's red — and only that: `zip` and
 * the debug key move a living player, and {@link PLANK} has the listing.
 */
export function restoreBoards(): void {
  if (!level) return;
  for (const k of level.planks.flat()) {
    k.state = "intact";
    k.clock = 0;
    k.crossings = 0;
    k.vy = 0;
    k.y = k.homeY;
    k.landed = false;
    k.gone = false;
    if (k.floor && k.homeFloor) {
      k.floor.top = k.homeFloor.top;
      k.floor.bottom = k.homeFloor.bottom;
    }
  }
  level.bridges.forEach((room, r) => {
    for (const b of room) {
      const d = b.y - b.homeY;
      // the platform it owns follows it home, as it followed it down
      if (d !== 0)
        for (const q of level!.solids[r].platforms)
          if (b.x >= q.left && b.x < q.right && b.y >= q.top && b.y < q.bottom) {
            q.top -= d;
            q.bottom -= d;
          }
      b.y = b.homeY;
      b.top -= d;
      b.bottom -= d;
      b.state = "whole";
      b.stood = 0;
      b.clock = 0;
      b.vy = 0;
    }
  });
}

/** the page's writes into the game's own state — ES imports are read-only */
export function setFilm(v: typeof film): void {
  film = v;
}

/** the other modules' writes into this one's state — ES imports are read-only */
export function setDeathRed(v: typeof deathRed): void {
  deathRed = v;
}
export function setAdvancing(v: typeof advancing): void {
  advancing = v;
}
export function setSpawnIndex(v: typeof spawnIndex): void {
  spawnIndex = v;
}
