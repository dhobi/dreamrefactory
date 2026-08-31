/**
 * Turning a dial you have to DRAG.
 *
 * Most controls in this game are click-to-step: the Enigma's four rotors count
 * down one number per click, so a route sets them by clicking (segment 3). The
 * turbine plant's six are not. TURBINE.SHP's mousedown for each of them holds a
 * `while stilldown()` loop that reads the cursor every frame and nudges the deg
 * according to which way the cursor has SWUNG about the dial's pivot — so a
 * setting is a gesture with a shape, and a route that only knows how to click
 * cannot make it at all.
 *
 * Three facts out of those scripts decide everything here.
 *
 * ## The dial follows the cursor's DIRECTION, not its angle
 *
 * `limiter(orig, newd)` is handed the quantised bearing at the previous frame and
 * at this one, and all it uses is the sign of the difference:
 *
 *     delt = newd - orig
 *     if delt = 0 → the deg does not move
 *     if |delt| > 10 → delt = orig - newd      // the 0/255 seam, sign preserved
 *     the deg moves by a FIXED amount in that direction, clamped to 0..19
 *
 * So the dial is not "point at 8 o'clock to get 8". It is a ratchet: keep
 * swinging one way round the pivot and it keeps counting, one step per frame,
 * until it hits an end stop. Two consequences a driver depends on:
 *
 *   - a cursor that does not move does not move the dial (delt = 0). Extra
 *     frames between our moves are therefore free, which is what makes this
 *     gesture replayable in a browser at whatever rate the page happens to run —
 *     the headless twin and the real one turn the dial by the same amount because
 *     the amount is set by the MOVES, not by the frames. What does NOT come free
 *     is knowing where the dial has got to: a read can arrive before the swing it
 *     describes has been consumed, and the dial then takes one more step after the
 *     sample that said it had arrived. Hence the retry in {@link turnDial}.
 *   - the loop body assigns the plant's global from the deg every iteration, so a
 *     dial that is already where we want it must still be TOUCHED. `initvalue()`
 *     sets every control to 50 while `openstage` scatters the dials at random
 *     degs, so until a dial is held the number the plant is running on has
 *     nothing to do with the one on the dial face. (A run that skipped the dial it
 *     found already on target settled on a different fixed point for exactly
 *     this reason.)
 *
 * ## The step is 1 for the valves and 3 for the pumps, and that costs reach
 *
 * The three valves move 1 deg per frame and reach all twenty positions. The two
 * pumps move 3, so from a given start they can only land on degs of the same
 * residue mod 3 — until they clamp. Winding to an end stop is what changes class:
 * from 19 downward gives 16, 13, 10, 7, 4, 1 (then 0), and from 0 upward gives 3,
 * 6 … 18 (then 19). Between those two chains lies every deg except 2, 5, 8, 11, 14
 * and 17, and a pump can reach one of those six only from a start already on their
 * chain. So {@link dialStops} answers with the route: straight there when the two
 * degs share a chain, otherwise via the end stop the target's chain hangs off, and
 * empty when there is no route at all.
 *
 * ## The coal lever is not a dial at all
 *
 * `calcswitchdeg()` reads the cursor's Y, clamps it to 245..345 and divides by 5.
 * That is absolute: the lever goes where you put it, in one move, and the arc
 * machinery does not apply. Hence {@link setLever} alongside {@link turnDial}.
 */
/**
 * The sliver of a driver a dial actually needs.
 *
 * Declared here rather than imported so this module can live in `src/` and be
 * bundled into the speedrun page, which has no access to the test tree. It is
 * structural, so the playthrough suite's `DialDriver` satisfies it unchanged and
 * nothing on that side had to move.
 */
export interface DialDriver {
  propDeg(name: string): number;
  flow(): Record<string, string | number | undefined>;
  dragProp(name: string, next: (from: { x: number; y: number }) => { x: number; y: number } | null): Promise<boolean>;
}

/**
 * What a control DRIVES, and what the thing it drives should read.
 *
 * The deg is where the dial is pointing; this is what the plant is running on,
 * and they are two different facts. Only the held loop's body joins them
 * (`valve3 = sendtostagefx(degtonum(propdeg(me)))`), so a gesture that moved the
 * dial without that body running leaves a dial that LOOKS right driving a plant
 * that never heard about it — and a route checking only the deg calls that a
 * success. It is not one, and a whole run turned on it: five dials landed, the
 * sixth was already on its number so its drag made no moves, its global stayed at
 * `initvalue`'s 50, and the plant settled on a different equilibrium that the
 * route then waited five minutes for.
 *
 * So every control carries the global it drives and the arithmetic between them,
 * and a setting is not accepted until both agree.
 *
 * Not every dragged dial drives something, though. A combination lock is read at
 * the moment it is TESTED rather than published as it turns — PATTY.STG's doll1
 * region asks `propdeg("dial1") = 6 & …` when you click it, and nothing else ever
 * looks — so those controls leave `global` unset and the deg is the whole fact.
 */
export interface DrivenControl {
  /** the prop to take hold of */
  prop: string;
  /**
   * The global the held loop assigns from the deg, if there is one. Absent for a
   * control whose deg is only ever read on demand (a combination lock), where
   * there is no second fact to agree with and the deg alone settles it.
   */
  global?: string;
  /** what that global should read once the dial is at `deg` */
  value(deg: number): number;
}

/** a dial turned by swinging the cursor about a pivot */
export interface DragDial extends DrivenControl {
  /** the point TURBINE.SHP measures the cursor's bearing from */
  pivot: { x: number; y: number };
  /** degs per frame, signed: what a RISING bearing does to the deg */
  step: number;
}

/** a lever positioned directly by the cursor's Y */
export interface DragLever extends DrivenControl {
  /** the Y the cursor is clamped to at deg 0 */
  top: number;
  /** and at the bottom of its travel */
  bottom: number;
  /** pixels per deg */
  pitch: number;
}

/** TURBINE.STG's own deg -> control-value conversion, integer division and all */
export function degtonum(deg: number): number {
  return Math.min(100, Math.max(0, Math.trunc((deg * 100) / 19)));
}

/**
 * The turbine plant's controls, read out of TURBINE.SHP.
 *
 * The pivots are the literal `makepoint(x, y)` each dial's mousedown passes to
 * `calcdeg`, and the steps are the `delt` its `limiter` settles on. The valves
 * count DOWN as the bearing rises (`if delt < 0 → delt = 1`) and the pumps count
 * up by three (`if delt < 0 → delt = -3`), which is the sign here.
 */
export const TURBINE_DIALS: Record<string, DragDial> = {
  // the two pumps read INVERTED — `pump1 = 100 - degtonum(propdeg(me))`
  pump2: { prop: "pump2", global: "pump2", value: (d) => 100 - degtonum(d), pivot: { x: 472, y: 273 }, step: 3 },
  pump1: { prop: "pump1", global: "pump1", value: (d) => 100 - degtonum(d), pivot: { x: 372, y: 309 }, step: 3 },
  valve3: { prop: "valve3", global: "valve3", value: degtonum, pivot: { x: 140, y: 297 }, step: -1 },
  valve1: { prop: "valve1", global: "valve1", value: degtonum, pivot: { x: 197, y: 95 }, step: -1 },
  valve2: { prop: "valve2", global: "valve2", value: degtonum, pivot: { x: 372, y: 72 }, step: -1 },
};

/**
 * The coal lever, from TURBINE.SHP's `calcswitchdeg`. Its global runs backwards
 * against its deg — `coal = degtonum(20 - propdeg(me))` — because the lever is
 * pushed DOWN the screen to burn less.
 */
export const COAL_LEVER: DragLever = {
  prop: "slider",
  global: "coal",
  value: (d) => degtonum(20 - d),
  top: 245,
  bottom: 345,
  pitch: 5,
};

/**
 * The combination lock on the matryoshka in Sasha's cabin, from PATTY.SHP's main.
 *
 * All four share one handler and one pivot — `calcdeg(makepoint(256, 192), arg)`,
 * the middle of the screen, because the dials are concentric rings — and its
 * `limiter` is the valves' shape (`if delt < 0 → delt = 1`), so a rising bearing
 * counts DOWN. Two differences from the turbine's, and both matter:
 *
 *   - the ring has 24 positions, not 20, and `fixdeg24` WRAPS rather than clamps
 *     (below 0 becomes 23, above 23 becomes 0). So every deg is reachable from
 *     every other and there are no end stops to route via.
 *   - the drag ends in `snapdials(target)`, which rounds to the nearest multiple
 *     of 3 — 5, 6 and 7 all become 6; 23, 0 and 1 all become 0. The combination
 *     is on those multiples, so a setting that lands is a setting that stays.
 *
 * The combination is the game's own debug cheat, `PATTY.STG solvedoll()`:
 * dial1 = 6 and the other three 0. Nothing reads the degs until `doll1`'s region
 * is clicked, hence no `global`.
 */
export const PATTY_DIALS: Record<string, DragDial> = {
  dial1: { prop: "dial1", value: (d) => d, pivot: { x: 256, y: 192 }, step: -1 },
  dial2: { prop: "dial2", value: (d) => d, pivot: { x: 256, y: 192 }, step: -1 },
  dial3: { prop: "dial3", value: (d) => d, pivot: { x: 256, y: 192 }, step: -1 },
  dial4: { prop: "dial4", value: (d) => d, pivot: { x: 256, y: 192 }, step: -1 },
};

/** the combination those dials have to spell, in dial order */
export const PATTY_COMBINATION = [6, 0, 0, 0];

/** the screen a gesture has to stay on */
const SCREEN = { w: 512, h: 384 };

/**
 * How far round the pivot to swing per frame, in the engine's 0..255 bearing.
 *
 * It has to clear a quantisation bucket, or `delt` comes out 0 and the frame is
 * wasted: `fixdeg256` puts the valves in buckets of 256/20 ≈ 12.8 and the pumps
 * in buckets of 120/20 = 6. 16 clears both with room for the rounding a whole
 * number of pixels imposes, and stays well inside the |delt| > 10 seam test.
 */
const ARC = 16;

/** a dial needing more frames than this is not being turned by us */
const MAX_FRAMES = 90;

/**
 * How many times to take hold of a dial before calling it stuck.
 *
 * More than one because a single grab can end a step out through no fault of
 * anyone's — see the note in {@link turnDial}. Three, because a grab that starts
 * on the target's own chain lands on it, so a second is the fix and a third is
 * only there to make "stuck" mean stuck.
 */
const GRABS = 3;

const BEARING = (2 * Math.PI) / 256;

/**
 * The radius to swing at: as wide as fits on the screen, with a margin.
 *
 * Wide is better — the bearing of a point rounded to whole pixels is more exact
 * the further out it is — but it must stay ON the canvas. A browser only sees a
 * mousemove while the cursor is over the canvas element, so an arc that swings
 * off the edge silently stops moving the dial while the loop happily reports the
 * cursor parked at the last point it saw. pump2's pivot sits 39px from the right
 * edge, which is what sets the tightest arc in the plant.
 */
export function arcRadius(pivot: { x: number; y: number }): number {
  const margin = 3;
  return Math.min(pivot.x, pivot.y, SCREEN.w - 1 - pivot.x, SCREEN.h - 1 - pivot.y) - margin;
}

/**
 * Which end stops a dial has to visit to get from `now` to `want`.
 *
 * A dial that steps by 1 can simply count there. One that steps by 3 can too,
 * but only when the two degs are on the same chain — and when they are not, it
 * has to wind to the end stop whose chain holds `want` first, because clamping
 * is the only thing that changes chain. Empty means there is no route at all: a
 * pump asked for 2, 5, 8, 11, 14 or 17 from anywhere but those degs themselves.
 */
export function dialStops(step: number, want: number, now: number): number[] {
  const size = Math.abs(step);
  if (size === 1) return [want];
  if (((want - now) % size + size) % size === 0) return [want];
  if (((want - 19) % size + size) % size === 0) return [19, want];
  if (want % size === 0) return [0, want];
  return [];
}

export interface DialResult {
  ok: boolean;
  reason?: string;
  /** where the dial actually ended up */
  deg: number;
}

/**
 * Swing a dial round to `want`.
 *
 * Takes hold of it, then walks the cursor round its pivot a bearing step at a
 * time, reading the deg back after every move: heading first for the end stop the
 * target's chain hangs off if it needs one, then for the target, and reversing
 * whenever it has gone past. The deg is the engine's own answer rather than a
 * count of our moves, so a frame the page dropped costs a step and not the
 * setting — and if a grab still ends a step out, it takes hold again.
 */
export async function turnDial(d: DialDriver, dial: DragDial, want: number): Promise<DialResult> {
  const deg = (): number => d.propDeg(dial.prop);
  const r = arcRadius(dial.pivot);
  if (r < 12) return { ok: false, deg: deg(), reason: `no room on screen to swing ${dial.prop}` };
  const trail: string[] = [];
  for (let grab = 1; grab <= GRABS; grab++) {
    const from = deg();
    if (from === want && driving(d, dial, want)) return { ok: true, deg: from };
    // No shortcut for a dial that already READS right: it still has to be taken
    // hold of, because holding it is what publishes the plant's global from the
    // deg (see the header). Heading for a deg we are already on costs one turn of
    // the held loop and no moves at all, which is exactly the gesture wanted.
    const stops = dialStops(dial.step, want, from);
    if (!stops.length) {
      return {
        ok: false,
        deg: from,
        reason: `${dial.prop} steps by ${Math.abs(dial.step)}, so deg ${want} is off every chain it has`,
      };
    }
    if (!(await turnOnce(d, dial, want, stops, r))) {
      return { ok: false, deg: deg(), reason: `no ${dial.prop} to take hold of` };
    }
    trail.push(`${from}->${deg()} (${dial.global}=${driven(d, dial)})`);
    if (deg() === want && driving(d, dial, want)) return { ok: true, deg: deg() };
    // Take hold again, which is both the fix and what a player does. Two things
    // land here and a retry answers both:
    //
    //   - a miss by one step, from a read that arrived before the swing it
    //     describes had finished being consumed — the held loop can still have one
    //     of our moves in flight when we sample, so the dial takes a last step
    //     after the sample that said it had arrived. Harmless to retry from: the
    //     second grab is on the target's own chain and heads straight there.
    //   - the dial on its number but the plant not told, which is the case
    //     {@link DrivenControl} exists for. Another grab runs the body that
    //     publishes it, and makes no moves doing so.
  }
  return {
    ok: false,
    deg: deg(),
    reason: `${dial.prop} would not settle on ${want} in ${GRABS} grabs (${trail.join(", ")})`,
  };
}

/** what the plant is actually running this control at */
function driven(d: DialDriver, c: DrivenControl): number | "nothing" {
  return c.global ? Number(d.flow()[c.global] ?? NaN) : "nothing";
}

/**
 * Has the held loop published this deg to the plant yet?
 *
 * A control that drives nothing has nothing to disagree with, so the deg on its
 * face is the whole answer and this is vacuously true — otherwise a combination
 * lock would be retried three times and then called stuck while sitting on the
 * number asked for.
 */
function driving(d: DialDriver, c: DrivenControl, deg: number): boolean {
  return !c.global || driven(d, c) === c.value(deg);
}

/** one grab: swing round the pivot until the deg reads `want` or we run out of frames */
async function turnOnce(
  d: DialDriver,
  dial: DragDial,
  want: number,
  stops: number[],
  r: number,
): Promise<boolean> {
  let bearing = 0;
  let stage = 0;
  let frames = 0;
  return d.dragProp(dial.prop, (from) => {
    if (frames === 0) {
      // the point we grabbed sets the arc's phase; moving straight out to the
      // radius changes no bearing at all, so it costs no step
      bearing = Math.atan2(from.y - dial.pivot.y, from.x - dial.pivot.x) / BEARING;
    }
    const now = d.propDeg(dial.prop);
    // reaching the end stop is what lets us head for the target; before that
    // there is no point aiming at a deg this dial's step cannot land on
    if (stage < stops.length - 1 && now === stops[stage]) stage++;
    // The only finish is reading the number asked for. Stopping because we passed
    // THROUGH the stop instead let one coarse read end the drag three degs out.
    // Overshooting is recoverable here: the next move simply turns round.
    if (now === want || ++frames > MAX_FRAMES) return null;
    // which way round the pivot counts the deg toward what we are heading for
    bearing += ARC * (now < stops[stage] ? Math.sign(dial.step) : -Math.sign(dial.step));
    return {
      x: Math.round(dial.pivot.x + r * Math.cos(bearing * BEARING)),
      y: Math.round(dial.pivot.y + r * Math.sin(bearing * BEARING)),
    };
  });
}

/** Push a lever to `want` — one move, since it goes where the cursor is. */
export async function setLever(d: DialDriver, lever: DragLever, want: number): Promise<DialResult> {
  // The MIDDLE of the band, not its first pixel. `calcswitchdeg` divides the
  // clamped cursor Y by the pitch, so every Y in `[top + want*pitch, +pitch)`
  // gives the same deg — and the first of them is the one pixel of the band that
  // a rounding error can fall out of. Aiming at the centre spends the tolerance
  // the control already has (#277); the driver's own aim is exact again
  // (clientPointFor), so this is belt and braces rather than the fix.
  const band = lever.top + want * lever.pitch;
  const y = band + Math.floor((lever.pitch - 1) / 2);
  if (band < lever.top || band > lever.bottom) {
    return { ok: false, deg: d.propDeg(lever.prop), reason: `deg ${want} is off ${lever.prop}'s travel` };
  }
  const trail: string[] = [];
  for (let grab = 1; grab <= GRABS; grab++) {
    let moved = false;
    const held = await d.dragProp(lever.prop, (from) => {
      if (moved) return null;
      moved = true;
      return { x: from.x, y };
    });
    if (!held) return { ok: false, deg: d.propDeg(lever.prop), reason: `no ${lever.prop} to take hold of` };
    const got = d.propDeg(lever.prop);
    trail.push(`${got} (${lever.global}=${driven(d, lever)})`);
    // the same pair of conditions as a dial: where it points AND what it drives
    if (got === want && driving(d, lever, want)) return { ok: true, deg: got };
  }
  return {
    ok: false,
    deg: d.propDeg(lever.prop),
    reason: `${lever.prop} would not settle on ${want} at y=${y} (band ${band}..${band + lever.pitch - 1}) in ${GRABS} pushes (${trail.join(", ")})`,
  };
}
