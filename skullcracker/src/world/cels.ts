/**
 * Cels and anchors: the memo of every decoded cel's record, the base and foot
 * of a pose, a foe's anchor, the player's box, and the player cel drawn last.
 */
import { SbkCel, SbkFile } from "@dreamfactory/engine/df/sbk";
import { decodeShpFrame, ShpFrame } from "@dreamfactory/engine/df/shp";
import { FOES, celAt, loopIndex, type Foe } from "../foes";
import type { Enemy } from "../brains/kit";
import { player, anim, p, type Level } from "./state";

/**
 * The player's collision box: the drawn cel's own size, standing on the ground.
 *
 * The disc's, by way of the art — the sprite is as wide as it is drawn. (The
 * `initplayer` records are no help: STREETS has three and only one is
 * player-sized, the other two being 20px markers like every `stat` pickup.)
 * A door's rect sits at BODY height, not foot height — STREETS' street door ends
 * at y1348 and the pavement under it is at y1362 — so the test has to be an
 * overlap of boxes and not "is the point in the rect".
 */
export function playerBox(): {
  top: number;
  left: number;
  bottom: number;
  right: number;
} {
  const art = celRec(player, anim.idle[0]);
  const w = art?.width ?? 100;
  const h = art?.height ?? 148;
  return { top: p.y - h, left: p.x - w / 2, bottom: p.y, right: p.x + w / 2 };
}

export function foeAnchor(e: Enemy, lvl: Level): { x: number; y: number } | null {
  const g = celRec(lvl.sbk, FOES[e.kind].gait.cels[0]);
  if (!g) return null;
  return { x: e.x - g.width / 2 + g.posX, y: e.y - g.height + g.posY };
}

/**
 * The world y of what actually touches the floor: the bottom of the CURRENT cel's
 * collision box.
 *
 * Every cel carries its own, and for a thing that changes shape they are not the
 * same box. The mailbox is the case: upright, cel 2410's box reaches 93 pixels
 * below the anchor; on its side, cel 2413's reaches 56. Landing a fallen mailbox
 * where the upright one's base would go leaves it floating 37 pixels up.
 *
 * For a gait cel the box bottom and the cel's own extent agree to within a pixel,
 * which is why the standing placement never needed this.
 */
/**
 * One book's cels by id, remembered.
 *
 * `SbkFile.byId` maps an id to a LOCATION — the container the art lives in — so
 * the record itself would be a scan of the array: a linear walk of 1229 entries
 * in the player's book and a few hundred in a level's, on the fight's hot path.
 * `strikeBox` alone does one per enemy per tick, twenty enemies at sixty ticks a
 * second; scanning, MAZE takes 216 seconds against 160.
 */
export const celMemo = new WeakMap<SbkFile, Map<number, SbkCel | undefined>>();
export function celRec(
  book: SbkFile | null | undefined,
  id: number,
): SbkCel | undefined {
  if (!book) return undefined;
  let m = celMemo.get(book);
  if (!m) {
    m = new Map();
    celMemo.set(book, m);
  }
  if (!m.has(id))
    m.set(
      id,
      book.cels.find((c) => c.id === id),
    );
  return m.get(id);
}

/**
 * Where a foe meets the floor, the way `0x42fd80` measures it: the anchor, plus
 * the CURRENT cel's word at +0x26, plus the object's floor offset `obj+0x10`.
 *
 * +0x26 is the cel's own drawn extent below its anchor — `height - posY` in
 * every record read (the punk's 1900: 63, the rat's 3000: 23, its hole 3010:
 * 27, the mailbox's 2410: 93) — and it is NOT the collision box. `0x42fdcf`
 * adds `obj+0x10` to it and `0x42fdf0` takes the pair off the floor under the
 * point, so the offset sinks a class's art into the ground by that much (the
 * rat's −13, `0x44dfa0`) or holds it up. The platforms are measured against the
 * same foot (`0x42fe8c`).
 *
 * Not the bottom of the collision BOX, which is authored and not the art: the
 * dog's pounce cels end their boxes 14 to 20 pixels above their art where its
 * stand does not, so on the box its feet leap about in the air; the CHOPPER's
 * 4884 box ends 34 ABOVE its anchor where the art ends 25 below; and the rat's
 * hole cels carry no box at all. The art's extent moves by a few pixels between
 * poses, as the engine's does.
 */
export function baseOf(e: Enemy, lvl: Level, cel = celOf(e)): number {
  const a = foeAnchor(e, lvl);
  const c = celRec(lvl.sbk, cel);
  if (!a || !c) return e.y;
  return a.y + c.height - c.posY + floorOffset(e);
}

/**
 * `obj+0x10` — the instance's own where a state has written one
 * ({@link Enemy.floor}), else its class init's ({@link Foe.floor}), else the
 * allocator's zero.
 */
export function floorOffset(e: Enemy): number {
  return e.floor ?? FOES[e.kind]?.floor ?? 0;
}

/** {@link baseOf} on the cel it is showing — `0x42fd80` knows no other */
export function footOf(e: Enemy, lvl: Level, _foe: Foe): number {
  return baseOf(e, lvl);
}

/**
 * Which cel a spawned thing is showing.
 *
 * The gait loops; a flinch and a death play once and hold their last cel, which
 * is what leaves a body on the ground for {@link CORPSE_LINGER} frames. Both go
 * through the script's own `ticksPerFrame`, so the punk's eight-cel walk takes
 * sixteen engine frames and its twelve-cel death takes thirty-six.
 */
export function celOf(e: Enemy): number {
  // ...and a script a brain installed to play ONCE holds its last cel when it
  // ends, as `0x45d0f0` does with a script that has no loop — kragg's held 7042
  return e.state === "gait" && !e.swing
    ? e.anim.cels[loopIndex(e.anim, e.clock)]
    : celAt(e.anim, e.clock);
}

/** the player cel drawn on the last frame — reported in the status line */
export let lastCel = 0;

export const playerFrameCache = new Map<number, ShpFrame>();
export function playerFrame(loc: number): ShpFrame | null {
  const had = playerFrameCache.get(loc);
  if (had) return had;
  if (!player) return null;
  try {
    const f = decodeShpFrame(player.file.containers[loc].data);
    playerFrameCache.set(loc, f);
    return f;
  } catch {
    return null;
  }
}

/** the other modules' writes into this one's state — ES imports are read-only */
export function setLastCel(v: typeof lastCel): void {
  lastCel = v;
}
