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
  /**
   * How many of its own {@link Foe.shakes} it has already let go of.
   *
   * `AI+0` on the Coke machine (`0x43b6fc`), and the only class with one. It
   * never goes back down: a machine that has given up four cans is empty for
   * the rest of the level whatever else is done to it.
   */
  shaken?: number;
  /** has the CHOPPER already let out what was inside it — see {@link Foe.hatches} */
  hatched?: boolean;
  /** ...and has its bike already been thrown clear — see {@link Foe.deathThrow} */
  threw?: boolean;
  /**
   * Its walking velocity, in whole pixels an ENGINE frame — `obj+0xc`.
   *
   * Not the script's `dx`: that is an impulse added to this every frame, with
   * the ground taking {@link Foe.drag} of it back. See the stride in `walk.ts`.
   */
  speed?: number;
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
  /**
   * `AI+4` — decisions left before it breaks off and goes home.
   *
   * ## ...and the classes that have no such word
   *
   * This was left open as "wire a budget for the machines whose class never had
   * one", and the audit answers it with a null: there are none to wire. Eight
   * of the thirty classes carry a budget in `AI+4` and spend it here — the dog,
   * the rat, the hardcore, the wraith, the eyeball, the cop, `initwerea` and
   * `initwbooly`. Every one of the rest has its own page saying, with the
   * struct's own offsets, that the slot is not a budget in that class: the arm
   * (`arm.ts`), the batboy (`batboy.ts`), the hydrant (`hydrant.ts`), the
   * mailbox (`mailbox.ts`), the spitter (`puke.ts`), Igor (`igor.ts`),
   * `initwereb` (`wereb.ts`) and `initwered` (`wered.ts`).
   *
   * An AI struct is per class and the word at +4 means whatever that class's
   * creator seeds and its think spends. Giving a budget to a class that never
   * had one would be inventing behaviour, not porting it.
   */
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
   * `obj+0x24` — this one's own gravity, and a brain may turn it off.
   *
   * {@link Foe.floats} is per CLASS and `initkragg` is why that is not enough:
   * its flying form holds its height on a ±1 bob written straight into the
   * velocity (`0x440ce6`), and its grounded second form — the one it stands up
   * as after being shot down, kinds 11 to 16 — falls like everything else.
   * `0x44e878` is the other reader, the punk solving a leap arc against it.
   *
   * A state that wants no weight sets this; the page clears it the moment the
   * thing stops being in a state of its own, so a felled one falls.
   */
  weightless?: boolean;
  /** has it already spent its first health bar — see {@link Foe.rallies} */
  rallied?: boolean;
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
/**
 * Where a summoned creature is let go — the four things `0x426340` is handed.
 *
 * The point is one packed dword in the engine (`obj+6` low is y, `obj+8` high
 * is x) and two numbers here, and the facing is `obj+0x28` with this port's own
 * sign: **+1 east, −1 west**.
 */
export interface Hatch {
  x: number;
  y: number;
  /** +1 east, −1 west — `0x426383` writes the engine's own word */
  facing: number;
  /** `0x42639f` — `obj+0xc`, which the creator writes and the script adds to */
  vx?: number;
}

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
  /**
   * How many of a class are alive in this room — `0x430ee0`'s own walk of a
   * class list, which is how `0x4261f8` knows half its bats are gone.
   */
  count(kind: string): number;
  /**
   * The nearest live one of a class to the PLAYER, inside `within` — the
   * search `0x426450` does to decide where the bishop re-forms.
   */
  nearest(kind: string, within: number): { x: number; y: number } | null;
  /**
   * Kill every one of a class where it stands — `0x4263e0`.
   *
   * The bishop's death calls it once: every bat on the level takes a lift of
   * −40, pays `0x40d450(0x46)` and plays its own two-cel death `0x46f140`.
   * Nothing else in the game clears a class this way.
   */
  slayAll(kind: string): void;
  /** `0x40e300(n)` — `n - (n/2)*difficulty` */
  scaled(n: number): number;
  /** `0x434630` — the integer square root the ballistic leaps solve their arc with */
  root(n: number): number;
  /** `0x40ef30(0x4a7910, id, y)` — a creature sound where this one is */
  say(e: Enemy, id: number): void;
  /**
   * The nearest `initsprinkler` record's own point — `0x40b660` geometry −1.
   *
   * Level eight's only, and it is asked with the boss's point rather than the
   * player's: `0x441519` passes `1, -1`, which is "the record of this name
   * whose `pointX`/`pointY` is closest in Manhattan distance". What the caller
   * then steers for is **120 BELOW** it (`0x44154c`), not the point itself.
   */
  sprinkler(e: Enemy): { x: number; y: number } | null;
  /**
   * ...and send one up — `0x441b20` then `0x441b60`.
   *
   * Which record's RECT holds the boss's own point, and that slot goes up; if
   * it is already up, `0x441b7a` rolls `0x434540(7)` for a free one and tries
   * seven times. Nothing else in the executable raises one.
   */
  raise(e: Enemy): void;
  /**
   * Put one of this class's projectiles in the air, where its machine does.
   *
   * The seam exists because a brain is handed one enemy and can only change
   * that enemy: the spawners build an object of a different class on a
   * different list, which is the page's business. Call it at the instruction
   * the class calls its own spawner at, and quote that address there.
   */
  cast(e: Enemy, kit: CastKit, aim?: Aim): void;
  /**
   * Put one of ANOTHER class's creatures in the level, where its machine does.
   *
   * The sibling of {@link cast}, and the line between them is the engine's own:
   * a cast is an object with a script and no mind, stepped by the page; this is
   * an object with a brain of its own, which the page will then step exactly
   * like one the level placed. `0x426340` is the only creator a think calls —
   * the priest's bats — and what it settles is that a summoned thing is handed
   * the SUMMONER's territory (`AI+4` and `AI+8`, the same two rect corners
   * `0x450fc3` stores for a placed one), so a bat patrols where the priest
   * stands rather than where it happened to be let go.
   *
   * It comes out AWAKE. `0x426340` installs `0x46f060` tag 1 outright, which is
   * the flight, and never the dormant cel a placed bat waits on — so the caller
   * gets a thing already flying and {@link Foe.wake} is not consulted.
   */
  hatch(e: Enemy, kind: string, at: Hatch): void;
  /**
   * `0x43a790` — the keeper's roller, the one HAZARD any class builds.
   *
   * Its own seam rather than a {@link CastKit} because it is neither: it has a
   * think with four states, a hit handler that knocks it into the air, and a
   * latch of its own. `ROLLER` in {@link file://../props.ts} carries the rest.
   */
  roller(e: Enemy, at: { x: number; y: number; vx: number }): void;
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
/**
 * A thing a class throws, as much of it as the page has to know to fly one.
 *
 * Every projectile in this game is an object of ANOTHER class: the thrower's
 * machine calls its spawner, and what comes out runs its own tiny script. A
 * {@link Brain} has no creator and cannot make one, so each module reads its
 * class's spawner and its script into one of these and calls {@link
 * BrainCtx.cast} where the executable calls the spawner. The wiring in
 * `walk.ts` owns the flight, the hit and the drawing; this is the data.
 *
 * ## The three numbers an ARC needs, and where they come from
 *
 * `0x42fd9e`…`0x42fdab` is the mover, and it settles the unit: the velocity
 * words are added to the point **whole**, with nothing divided. `0x42f8b0`
 * divides a SCRIPT's stride by `obj+0xe` on its way into the velocity and is
 * the only thing that divides anything. So a velocity is pixels an engine
 * frame, and so is a `speed` or a `rise` a spawner writes outright.
 *
 * The pull is `0x430327`: `obj+0xa += obj+0x24` every frame it is not landed,
 * and `0x42f850` sets `obj+0x24` to `trunc(weight * 10)` — 10 for the player,
 * 8 for the thing Igor throws (`0x41fc7b` pushes 0.8f), 0 for everything that
 * flies flat. That is the whole of gravity in this engine: one float per class.
 */
/**
 * A velocity worked out at the moment of the throw, for the one class whose
 * spawner solves an arc instead of reading a constant.
 *
 * `0x452b20` is that spawner. Every other one in the game writes a number the
 * class was born with, which is {@link CastKit.speed} and {@link CastKit.rise};
 * werec's measures the gap to the player and takes a square root of it, so the
 * shot leaves at a different speed every time and no kit can hold it.
 */
export interface Aim {
  /** pixels an ENGINE FRAME along x, signed in WORLD terms and not by a facing */
  vx: number;
  /** ...and the upward half, up-positive like {@link CastKit.rise} */
  rise: number;
}

export interface CastKit {
  /** the flight cels, in order. The last one holds when the script runs out */
  cels: readonly number[];
  /** engine frames each cel is held */
  hold: number;
  /**
   * Pixels an ENGINE FRAME along the facing, which is the unit the executable
   * keeps it in.
   *
   * Every one of these comes out the same way: the launch frame of the thing's
   * own script carries a `dx`, and `0x42f8b0` adds `dx / obj+0xe` to the
   * velocity once — so the speed is that quotient, rounded away from zero, and
   * it persists because no later frame of the script carries a stride. The
   * mover then spends it once a frame, which is why the flight is stepped on
   * the frame rather than on the tick and nothing multiplies by
   * {@link TICK_SCALE}.
   */
  speed: number;
  /** where it starts: this far along the facing from the thrower's point... */
  ahead: number;
  /** ...and this far ABOVE it, up-positive, as the spawner's own subtraction */
  lift: number;
  /**
   * ...and this far along x REGARDLESS of the facing, where a spawner's step is
   * unconditional rather than mirrored.
   *
   * `0x455cc7` and `0x455d05` are the case: both of the boss's muzzles are
   * `sub ax, 0x1e` with no `sbb` in front of them, so the fireball leaves
   * thirty to the left of it whichever way it is turned. Every other spawner
   * here picks its sign off `obj+0x28` and belongs in {@link CastKit.ahead}.
   */
  offX?: number;
  /** `obj+0x1a` — its strength, or a negative CODE the reaction table reads */
  blow: number;
  /**
   * Gone once it is this far from the player in x — the gob's `0x418621`.
   *
   * One of two rules, and which one a class uses is its own business: the other
   * is {@link CastKit.life}. Neither is a default; a kit carries whichever its
   * think function actually tests.
   */
  reach?: number;
  /**
   * ...or gone after this many ENGINE FRAMES, counted down in its own AI.
   *
   * The slug is the case: `0x414768` writes 100 into `AI+2` and `0x413e21`
   * spends one a frame, removing it at −1. A thing with a life and no reach
   * leaves the screen and keeps going until the count runs out, which is what
   * the executable does.
   */
  life?: number;
  /**
   * ...or gone once it is this far from where it STARTED.
   *
   * The glob's, and the third of the three rules: `0x43e862` stores the spawn
   * point in the thing's own four-byte AI and `0x43dc28` removes it at 600 from
   * there. A range is not a reach — it does not care where the player went.
   */
  range?: number;
  /**
   * A stride per cel, in the SCRIPT's own units, spent through
   * {@link CastKit.divisor}.
   *
   * The knife is the one that needs it: `0x473670` tag 1 carries
   * `dx 0 50 0 50 0 0 0` across its seven cels, so the thing accelerates as it
   * goes — `0x42f8b0` adds each one to the velocity as its frame comes round,
   * and the velocity persists. Every other kit so far has a single speed for
   * its whole flight because its script carries no stride at all.
   */
  strides?: readonly number[];
  /**
   * `obj+0xe` — what a script's stride is divided by on its way into the
   * velocity. Only wanted where {@link CastKit.strides} is.
   */
  divisor?: number;
  /**
   * What the launch cels give way to, and it LOOPS.
   *
   * The glob again: every even tag of `0x4725c0` is a launch and `0x43dbf7`
   * installs `tag + 1` when it ends, which is the flight — six cels that play
   * for as long as the thing is in the air. A kit without this holds its last
   * cel instead, which is what a finished script does when nothing reinstalls.
   */
  then?: { cels: readonly number[]; hold: number; strides?: readonly number[] };
  /**
   * Some of them fly HARMLESS until they are close, and this is that rule.
   *
   * The slug again, and it is the whole of its design: `0x413e43` holds
   * `obj+0x1a` at ZERO and measures `|player.x − self.x|` every frame; inside
   * `0x82` = 130 it installs its own tag 1, which is `0x413e79`'s
   * `obj+0x1a = 0x64` and a second cel. So a slug crossing a room cannot hurt
   * anything, and one that reaches you can. Arming is one-way: the tag stays.
   */
  arm?: {
    /** pixels in x between it and the player — `0x413e5d`'s `cmp eax, 0x82` */
    within: number;
    /** what it shows once it is armed */
    cel: number;
  };
  /**
   * The upward half of the velocity a spawner writes, up-positive.
   *
   * Igor's is 26 (`0x425544`'s `0xffe6`), and a kit with a rise almost always
   * has a {@link CastKit.pull} to bring it down again.
   */
  rise?: number;
  /**
   * Pixels a frame² it accelerates downward — `trunc(weight * 10)`.
   *
   * Absent is weightless, which is what `0x42f850(obj, 0)` gives the gob, the
   * slug, the glob and the zombie's cloud: those four fly flat because their
   * own creators say they have no weight.
   */
  pull?: number;
  /**
   * What it plays where it lands, if its class has one.
   *
   * `0x41fd7b` is the case: a collision word set, and the thing installs
   * `0x46f9e0` at `tag + 1` instead of looping its flight — which for Igor's is
   * the same four cels it flew as, played backwards. It is gone when that runs
   * out.
   */
  impact?: { cels: readonly number[]; hold: number };
  /**
   * It STEERS, which is a flight rule and not a script one.
   *
   * Kragg's shot is the only one: `0x4422b2` builds a velocity DELTA every
   * frame and hands it to `0x42f8b0`, so what it adds is divided by the class's
   * own divisor and what it adds stays added.
   *
   * ```
   *   4422c7  imul ax, ax, 0x14          ; +-20 along the facing...
   *   4422d4  eax = player.y - self.y
   *   4422db  sub eax, 0x2d / idiv 10    ; ...and a tenth of the gap to 45
   *   4422ec  0x42f8b0(obj, packed)      ; ...both over obj+0xe = 5
   * ```
   *
   * So it leaves at a standstill, leans into the facing four pixels a frame
   * harder every frame, and climbs or sinks toward a point forty-five above
   * your own. `along` is the twenty, `lead` the forty-five and `drop` the ten.
   */
  home?: { along: number; lead: number; drop: number; divisor: number };
  /**
   * ...and it is gone the frame it is PAST you, whichever way it was going.
   *
   * `0x442302`/`0x442316` — a shot travelling left that is already left of the
   * player, or one travelling right that is right of it, sets the think's own
   * die flag. A homing thing needs this because it has no reach: it would
   * otherwise turn round and come back.
   */
  past?: boolean;
  /**
   * ...or what it plays each time it BOUNCES, after which the flight resumes.
   *
   * The fireball is the one, and it is why the burst and the impact are two
   * different things: `0x45566e` installs `0x478290` the frame a surface is
   * under it, and `0x4556a0` — that script's own kind — installs the flight
   * again the frame it ends. So the four cels are a bounce and not a death,
   * and what finally removes the thing is {@link CastKit.rest}.
   */
  burst?: { cels: readonly number[]; hold: number };
  /**
   * `obj+0x20` — what it keeps of the velocity it meets a surface with, and the
   * sign FLIPS. One class in the game sets one: the boss's fireball.
   *
   * The engine keeps it as a word rather than a float, and the setter's scale
   * is NEGATIVE, which is where the flip lives:
   *
   * ```
   *   42f825  fmul dword ptr [0x46a10c]   ; and that float is -8192.0
   *   42f830  mov word ptr [ecx+0x20], ax ; so 0.8f is stored as -6553
   *   42ff83  movsx eax, word ptr [esi+0x20]
   *   42ff8a  imul eax, ecx               ; ...times the velocity
   *   42ff9b  sar  eax, 0xd               ; ...over 8192, toward zero
   * ```
   *
   * So a restitution of 0.8 turns a fall of 60 into a rise of 47, and the
   * default every other object is born with — `0x42f5c0` writes `0x800` — is
   * `+2048`, a quarter kept the SAME way, which is a stop and not a bounce.
   * Only a class that calls `0x42f7f0` bounces, and this is that number.
   *
   * `0x42ff6f` is the floor underneath it: a vertical velocity inside ±2 is
   * zeroed outright, so a bounce dies rather than ringing forever.
   */
  bounce?: number;
  /**
   * `obj+0x1e` — what a frame spent ON a surface keeps of the horizontal
   * velocity. `0x4302c0`, the same `imul`/`sar 13` over 8192, and the scale
   * here is positive so it only ever slows.
   *
   * Every object is born with `0x1666` (`0x42f5ba`), which is 0.7. The
   * fireball's creator writes 0.25 (`0x42f7a0` on `0x3e800000`), so it stops in
   * a couple of frames once it is down.
   */
  friction?: number;
  /**
   * It is only worth its {@link CastKit.blow} while it is MOVING this fast, in
   * either axis, and worth nothing at all once it is not.
   *
   * `0x4556d3` — `|vx| >= 15 or |vy| >= 15`, with no wall against it — is what
   * decides between `obj+0x1a = 0x64` and `obj+0x1a = 0`. A fireball rolling to
   * a halt at your feet cannot hurt you.
   */
  fastBlow?: number;
  /**
   * ...and gone once it is asleep: on the ground, no horizontal velocity, and
   * a vertical one no bigger than this.
   *
   * `0x4555e9` — `obj+0x2e` set, `obj+0xc == 0` and `|obj+0xa| <= 10` returns 1
   * from the think, which is how an object asks to be removed.
   */
  rest?: number;
  /**
   * `obj+0xa` is pinned inside ±this at the top of the class's own think.
   *
   * `0x452d4d` and `0x452d5b` — werec's shot is the one class that does it,
   * and forty is the figure. It matters because CITY throws down: without the
   * clamp a shot lobbed off one of its walkways arrives carrying whatever a
   * hundred rows of fall is worth, and it is the only thing between the arc
   * and the ground that the executable bothers to bound.
   */
  capFall?: number;
  /**
   * It is worth NOTHING in the air, and the BURST is the whole attack.
   *
   * `0x452c67` never writes `obj+0x1a`, so werec's shot flies at the engine's
   * default strength of zero (`0x42f5af`), and its three flight cels carry a
   * strike box with **no blow pair at all** — so even a direct hit resolves to
   * nothing. `0x452ec0` writes `0x65` the frame the thing's state becomes the
   * burst script's own kind, and `0x452ed1` removes it when that script ends.
   *
   * So the thing in the air is a dud and the flash it makes is the weapon. On
   * this page that means two things: the flight cannot hurt you, and meeting
   * you is what STARTS the burst rather than what ends the cast — which is the
   * engine's own behaviour by a different road, because `0x452e00` bursts on
   * the collision words and this page has no solver to set them.
   */
  onImpact?: boolean;
  /**
   * ...and what a CODE landing on it does — `obj+0x12`, a hit handler of its
   * own. See {@link CastCode}, and one class in the game has one.
   *
   * `0x45554f` is the install and `0x455730` the handler: the fireball's class
   * writes it into the object as it is created, which is the same word every
   * creature's class writes its own into. Nothing else a creature throws has
   * one, so a code that lands on any other cast is read by nobody.
   */
  onCode?: CastCode;
  /** the spawner and the script it installs */
  from: string;
}
export type Brain = (e: Enemy, foe: Foe, run: number, k: BrainCtx) => boolean;

/**
 * What a class does DURING a reaction — the states the PAGE owns.
 *
 * A {@link Brain} is never called while an enemy is flinching or dying, and
 * for good reason: the animation belongs to the page's own hit path and giving
 * it two owners is how a flinch ends up playing twice. But three classes do
 * something in one of those states that no animation can express —
 * `initwerec`'s death throw fires a shot a frame, `initvpriest`'s vanish lets
 * twelve bats go, and `initkragg`'s state 9 drags itself towards a sprinkler —
 * and all three were unreachable for exactly that reason.
 *
 * So a reaction gets a think of its own. It is deliberately NOT a brain: it
 * returns nothing, it may not install a state, and the page goes on owning the
 * animation and the frame count. It runs once an ENGINE FRAME, like a brain,
 * and `run` is how many frames the reaction's own animation lasts, so a class
 * can tell the last frame of it from the first.
 */
export type Reaction = (
  e: Enemy,
  foe: Foe,
  run: number,
  k: BrainCtx,
) => void;

/**
 * A CAST as its own hit handler sees it — the object's own words, and nothing
 * the page keeps beside them.
 *
 * The point and the two velocities are `obj+6`…`obj+0xc`, and the order is the
 * executable's: `0x4562c7` adds `obj+0xc` to `obj+8` and `obj+0xa` to `obj+6`,
 * so the point is packed y then x and the vertical velocity comes FIRST.
 * {@link alight} is the one thing here that is not a word of the object — it is
 * word 0 of the six bytes `0x456240` allocates beside it.
 *
 * {@link bounced} and {@link landed} are this page's `obj+0x18`, which is the
 * word a handler's second test reads, and {@link spent} is the removal a
 * class's think asks for by answering 1.
 */
export interface CastSelf {
  x: number;
  y: number;
  /** `obj+0xc` — pixels an engine frame along x, signed in world terms */
  vx: number;
  /** `obj+0xa` — ...and downward, which is the axis a pull spends */
  vy: number;
  facing: number;
  /** frames into the burst a BOUNCE plays, and undefined while it flies */
  bounced?: number;
  /** ...and frames into its impact, once something has stopped it */
  landed?: number;
  /**
   * Word 0 of the class's own per-object record — it is on FIRE.
   *
   * `0x455751` reads it back through `0x430eb0` before anything else the
   * handler does and answers 0 if it is set, so a burning cast is deaf to
   * every blow that follows, the player's included. `0x4557a1` is the only
   * write on this path; `0x4562e7` is the other, and that one is at birth.
   */
  alight?: boolean;
  spent: boolean;
}

/**
 * ...and the one thing such a handler may ask the page for.
 *
 * Bound to the cast it was built for, which is the difference between this and
 * {@link BrainCtx}: a brain is handed one shared context and names the enemy in
 * every call, and a hit handler is called once, about one thing.
 */
export interface CastCtx {
  /**
   * `0x44ff20` — stick a FLAME on it, the half of a −9 every handler shares.
   *
   * `late` is its second argument and `forever` its third, exactly as
   * {@link Foe.burns} carries them: the first starts the fire at the stage it
   * goes out on, the second means it never does.
   */
  burn(how?: { late?: boolean; forever?: boolean }): void;
}

/**
 * What a CODE does to a cast — the cast half of {@link Reaction}.
 *
 * `0x455763` is the only −9 handler in the game on a thing that is not a
 * creature. A {@link Foe} carries its own as DATA because all eight creature
 * handlers do the same three things with different arguments; this one is a
 * function because the fireball's is not one of the three — it reads its own
 * state, stops itself dead and latches a word of its own.
 *
 * `code` is the hitter's `obj+0x1a` and is always negative: a positive strength
 * is damage and never comes here. Returning **true** is the handler's `ax = 1`,
 * which spends the blow on this cast; false is its `ax = 0` — read, and
 * declined.
 */
export type CastCode = (
  self: CastSelf,
  code: number,
  k: CastCtx,
) => boolean;

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
