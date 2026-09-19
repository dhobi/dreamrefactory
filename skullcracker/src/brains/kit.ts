/**
 * The kit a class's own state machine is written against.
 *
 * ## Why this file exists
 *
 * Every class in `SC.EXE` has a **think function** of its own, and all of them
 * have the same shape: a jump table over `obj+0x18`, the kind of the script the
 * thing is currently playing. `0x44e580` — the street punk's, thirteen states —
 * is the one the rest are variations on, and `src/brains/werea.ts` is the
 * worked example. One module per class, so that reading one out of the
 * executable never means touching a file anybody else is writing.
 *
 * ## The four object fields a machine is built out of
 *
 * | field      | what it is                                                    |
 * |------------|---------------------------------------------------------------|
 * | `obj+0x18` | the kind of the script now playing — the STATE                 |
 * | `obj+0x44` | the tag now playing, which several classes sub-dispatch on     |
 * | `obj+0x46` | set when that script ENDS; most states do nothing until it is  |
 * | `obj+0x1a` | the strength percent a state sets on itself as it commits      |
 *
 * The third is the one that makes the machines work at all. Almost every state
 * opens `cmp word ptr [esi+0x46], 0; je <return>` — *do nothing until my own
 * script has finished, then choose the next one.* A port that re-decides every
 * tick instead burns a class's whole repertoire in three frames and hovers; that
 * was measured, and it is why `stepWerea` sat unwired until this page existed.
 * Here that flag is {@link Brain}'s `run` argument against `e.clock`.
 *
 * `obj+0x1a` scales the blow this thing would land. **Nothing hits the player
 * back**, so it is carried as read and spends nothing.
 */
import type { Foe, FoeAnim } from "../foes";

/**
 * `gait`, `flinch` and `dead` are the kind's own animations; `burst` is the one
 * state an object is SPAWNED in — the hydrant's water, which sprays once and is
 * removed ({@link Foe.burst}).
 */
export type FoeState = "gait" | "lever" | "flinch" | "dead" | "burst";

/** one spawned thing: where it is, which way it faces, and how far it may roam */
export interface Enemy {
  kind: string;
  x: number;
  y: number;
  facing: number;
  /** the record's own rect — its territory */
  left: number;
  right: number;
  /** engine frames elapsed in the current animation, fractional */
  clock: number;
  /** which animation is running, and which of the kind's it is */
  state: FoeState;
  anim: FoeAnim;
  /** engine frames a corpse has left before it is removed — `[0x46b204]` */
  linger: number;
  /** how many blows it has taken, for the kinds whose flinches advance in order */
  dents: number;
  /** has the husk already let out what was inside it — see {@link Foe.hatches} */
  hatched?: boolean;
  /** the record's rect, top and bottom — what a sleeper watches ({@link Foe.wake}) */
  top: number;
  bottom: number;
  /** still a statue: the player's point has not been inside that rect yet */
  asleep?: boolean;
  /** which of {@link Foe.drives}' states is running, for the one kind that has them */
  mode?:
    | "hover"
    | "charge"
    | "rush"
    | "combo"
    | "land"
    | "melee"
    | "antiAir"
    // ...and the wraith's own, which are a different machine — see stepWraith
    | "rouse"
    | "rise"
    | "held"
    | "sink"
    | "cast"
    | "lunge"
    | "sweep"
    | "close"
    // ...and the bishop's — see stepBishop
    | "throw"
    | "recoil"
    | "settle";
  /** `AI+4` — decisions left before it breaks off and goes home */
  decisions?: number;
  /**
   * In the fight — `obj+0x18` state 1, which {@link stepFight} drives. Undefined
   * is the patrol, state 0, and the player's own point inside this record's rect
   * is the only thing that turns one into the other.
   */
  fighting?: boolean;
  /** swinging: the attack plays ONCE and hands back, where the walk loops */
  swing?: boolean;
  /** `AI+2` — the class's own beat, a countdown between taunts and squeals */
  beat?: number;
  /**
   * `AI+6` — which side of the player this one wants to be on, as a port facing.
   *
   * The creator seeds it 0 (`0x450ad7`), which is the engine's "facing east", and
   * two things flip it: standing behind the player (`0x44e749`) and finding its
   * own side crowded (`0x44f020`). What spends it is `0x44e806` — side against
   * `obj+0x28`, and a mismatch at the outermost band leaps the thing OVER you.
   */
  side?: number;
  /** `AI+0` — `0x40e300(0xfa)` at the creator, the class's nerve for the frame */
  nerve?: number;
  /** has the reach already made its one call — `obj+0x42` passes the frame once */
  thrown?: boolean;
  /** `[0x473dd0]` — which way the hover is going, +1 down and -1 up */
  hover?: number;
  /**
   * `obj+0x18` — the KIND of the script now playing, and therefore the state.
   *
   * `0x45d090` does not early-out. It stores the script at `obj+0x3e`, copies
   * word 4 of the script's header into `obj+0x18`, and rewinds the frame index:
   * **installing a script IS the state transition**, and a class's think
   * function is a jump table over the kinds of its own scripts. A class that
   * reads this page's {@link FoeAnim.kind} back out of what it installed is
   * therefore doing exactly what the disc does.
   */
  script?: number;
  /** `obj+0x44` — the TAG now playing, which several classes sub-dispatch on */
  tag?: number;
  /**
   * The record's own `param`, as the level laid it down.
   *
   * Several creators read it and it changes what the thing IS, not just how it
   * faces: `0x4116e2` puts it in `initcop`'s `AI+0x32`, and a cop with param 1
   * is the gunner — a different set of states from the slug-gun cop param 0
   * gives you. BARREL places both; MAZE places only param 0.
   */
  param?: number;
  /**
   * `AI+0x10` — the record's own point, kept because a class can be sent back
   * to it. `0x44ec26` is the case: the frame the player is upright again, the
   * punk is put back where the level put it and starts patrolling.
   */
  home?: number;
  /**
   * Pixels per TICK, and it persists — `obj+0xa`/`obj+0xc`, which the collision
   * solver `0x430470` writes and which only the kinds that cancel it stop
   * carrying. Zero for everything but a struck {@link Foe.flies} kind.
   */
  vx: number;
  vy: number;
  /**
   * Health left, in the disc's own units — {@link Foe.panel}'s figure, so a
   * `LINK` really does stand up with 200 of it, and what a blow takes off is the
   * striking cel's own speed ({@link strikeBox}). The furniture gets `Infinity`
   * and cannot be killed. **Nothing hits the player back yet** — no enemy's
   * blow, no hydraulic press, no swinging girder, no fall takes health off — so
   * the classes below carry their attacks as read, the addresses and the cels
   * and the blow each one would land, with none of it wired to a victim. The
   * engine's own health word is `0x4ac3d0` and `0x402ac0` is what spends it;
   * when this page does take damage it will be behind a switch that starts off,
   * so a level under test stays walkable.
   */
  hp: number;
  /** what it stood up with, for the bar's fraction */
  max: number;
}

/**
 * Engine frames per tick — `walk.ts`'s own `TICK_SCALE`, and the number every
 * class module must convert with.
 *
 * The engine thinks at 15Hz and this page ticks at 60Hz, so **one tick is a
 * QUARTER of an engine frame**. A script's `dx` or `dy` is per engine frame, so
 * a brain that writes a velocity multiplies by this; one that reads `e.vx` back
 * in the executable's own units divides by it.
 *
 * It is here rather than in each module because it was got wrong once and then
 * copied: `werea.ts` had it as a half with the comment "a tick is half of one",
 * and eight of the classes written against that file inherited the mistake,
 * steering and bobbing at twice the disc's rate.
 */
export const TICK_SCALE = (15 * (1000 / 60)) / 1000;

/**
 * What `0x45efd0` fills in — sixteen bytes about where the player is, and the
 * only thing any class looks at him through.
 */
export interface Track {
  /** `out+0x0a` — `player.x - self.x`, negated when this one faces west */
  forward: number;
  /** `out+0x08` — `player.y - self.y` */
  dy: number;
  /**
   * `out+0x04` — which band of the class's own descending list he is in.
   *
   * 0 is beyond the first threshold, `bands.length` is the innermost, and −1 is
   * behind this one altogether.
   */
  band: number;
  /** `out+0x00` — 1 in front, 0 behind, 2 when he is standing still */
  side: number;
}

/**
 * Everything a brain is allowed to know, handed in rather than reached for.
 *
 * A class module imports no part of the page it runs on: it gets the tracker,
 * the three helpers the classes actually call, and the two random generators,
 * and nothing else. That is what makes one class one file.
 */
export interface BrainCtx {
  /** the player, as much of him as `0x45efd0` and the band tests see */
  player: {
    x: number;
    /** the top of him — his y less his standing cel's height */
    top: number;
    /** his feet: the y the bands are measured against */
    y: number;
    /** pixels per tick, negative going up — `0x44e77f` reads it for the anti-air */
    vy: number;
    /** is he mid-blow: his current cel carries a strike box (`out+0x06`) */
    swinging: boolean;
    /** is he down — `0x402f60`, the gate every fight state opens with */
    down: boolean;
    /**
     * His `obj+0x28` as a port facing, +1 east and −1 west.
     *
     * Three classes want it and the tracker cannot give it to them: `0x45f014`
     * folds the two mirror flags into `out+0` and then throws the answer away
     * whenever the player carries no `vx` at all, which answers 2. So the dog's
     * back-lunge (`0x454cea`), the zombie's whole route into its melee
     * (`0x4204c3`) and anything else that asks "is his back turned" reads it
     * from here instead of guessing it out of the side.
     */
    facing: number;
  };
  /** `0x45efd0` against this class's own band list */
  track(e: Enemy, bands: readonly number[]): Track;
  /** `0x456550`/`0x456590` — within 60px of the bound it is walking towards */
  atBound(e: Enemy): boolean;
  /** `0x44f020` — more than three of its own class within 200px of the player */
  crowded(e: Enemy): boolean;
  /** `0x434540(n)` — 1..n */
  roll(n: number): number;
  /** `0x40e300(n)` — `n - (n/2)*difficulty` */
  scaled(n: number): number;
  /** `0x434630` — the integer square root the ballistic leaps solve their arc with */
  root(n: number): number;
  /** `0x40ef30(0x4a7910, id, y)` — a creature sound where this one is */
  say(e: Enemy, id: number): void;
  /** what a leap is pulled down by, per tick */
  gravity: number;
}

/**
 * One class's think function.
 *
 * `run` is the length of the script now playing, in the same fractional frames
 * as `e.clock` — so `e.clock >= run` is `obj+0x46`, the script-finished flag
 * nearly every state gates on.
 *
 * Returning **true** means the frame is spent: the page will neither advance
 * the animation nor move the thing. Returning **false** means a script has been
 * chosen and the page should now play it and spend its stride — which is what
 * {@link install} leaves behind, and what all but the turn-and-stop states do.
 */
export type Brain = (e: Enemy, foe: Foe, run: number, k: BrainCtx) => boolean;

/**
 * `0x45d090` — put a script on, and with it the state.
 *
 * Rewinds the frame index, copies the script's own kind into `obj+0x18` and its
 * tag into `obj+0x44`. `once` marks the ones that play through and hand back
 * instead of looping, which is every attack.
 */
export function install(e: Enemy, a: FoeAnim, once = false): false {
  if (e.anim !== a) {
    e.anim = a;
    e.clock = 0;
  }
  e.script = a.kind;
  e.tag = a.tag;
  e.swing = once;
  return false;
}
