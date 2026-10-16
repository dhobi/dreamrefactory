/**
 * The state the rest of the world reads: the query string and the character it
 * picks, the player ({@link p}), the loaded {@link Level} and the files, sound
 * and palette it came from, the difficulty, and the mission and census of the
 * level that is up. The module-level `let`s stand in for `SC.EXE`'s globals, as
 * they did when all of this was one file; a module that writes one from outside
 * goes through its `set…` function, because ES imports are read-only.
 */
import { SbkEntity, SbkFile, SbkRoom } from "@dreamfactory/engine/df/sbk";
import { decodeShpFrame, ShpFrame } from "@dreamfactory/engine/df/shp";
import { SkullFiles } from "../files";
import { FOES } from "../foes";
import type { Enemy } from "../brains/kit";
import { FoeFight } from "../fights";
import { Sounds } from "../sound";
import { Crow, Elevator, Ibeam, Crush, Plank, Pickup, Sprinkler, Shack, Barrel, Pipe, Sewage, Bush, Nest2, Door, Elev, Switch, Nest, Hole, Hand, Axe, Bridge, Floor, Surge, Cage, Probe, BigGun, LightFx, Alarm, Fan, Belt, Chair, Claw, Fitting, Boggs } from "../props";
import { MISSIONS, type Mission } from "../mission";
import type { Gun } from "../guns";
import { PLAYER_CODES, PLAYER_HELD } from "../codes";
import { PLAYERS } from "../players";

/**
 * The numbers the disc does not carry. Change them here or nowhere.
 *
 * `walkPx` per tick at `tickMs` gives the stride; `animMs` is how long each
 * walk cel is held; `mirrorLeft` says the right-facing cels are flipped for
 * leftward walking rather than a left-facing set being used. All four are this
 * port's inventions, pending their recovery from SC.EXE.
 */
/**
 * The engine's own motion units, read out of `SC.EXE`.
 *
 * Skull Cracker has no velocity and no gravity constant. Movement is authored
 * PER ANIMATION FRAME: every frame of every animation script in `.data` carries
 * a `(dx, dy)` pair, and `0x42f8b0` applies it each tick as
 * `x += round_away(dx / obj[+0xe])`, `dx` negated when the object faces left.
 * The scripts are `{i16 count, i16 ticksPerFrame, i16 kind}` followed by `count`
 * entries of `{i16 tag, i16 celId, i16 dx, i16 dy}`, installed by `0x45d090`,
 * which seeks to the first frame carrying the tag it is asked for.
 *
 * Four characters' scripts (the player's at `0x470f98`, and `0x470a78`,
 * `0x470c40`, `0x471260`) carry the same three numbers, and one more script pair
 * at `0x471920`/`0x471988` gives the first character's walk and run outright:
 *
 * ```
 *   walk          dx  95        twelve cels, one tick each
 *   run           dx 180        twelve cels
 *   jump      dy -420           ONE frame, dx 0 standing or 95 running
 * ```
 *
 * The scripts themselves are in `.data` and each carries its own header, so
 * the rate is in the file too:
 *
 * ```
 *   0x471920  count 12  ticksPerFrame 1  kind  1   cels 100..111  dx  95   walk
 *   0x471988  count 30  ticksPerFrame 1  kind  2   cels 150..161  dx 180   run
 *   0x471c68  count  4  ticksPerFrame 4  kind  3   251 252 251 250         in the air
 *   0x471e78  count 20  ticksPerFrame 1  kind  7   cels 400..407           the ladder
 *   0x471c90  count 26  ticksPerFrame 1  kind  4   600s punch, 650s kick
 * ```
 *
 * `ticksPerFrame` is the header's second field and `0x45d0f0` counts it down at
 * `obj+0x48`, advancing the cel only when it reaches zero — so the walk changes
 * cel every frame and the airborne loop holds each of its four for four frames.
 * The dx is applied on EVERY call either way, which is what makes speed a
 * property of the frame rate alone and not of the animation's length.
 */
/**
 * The page's switches — `?level=`, `?x=`, `?damage=` and the rest — read once.
 * In a browser they are the address bar's; a headless run hands the same
 * string in as `globalThis.SC_QUERY` before the game is loaded, so a test
 * says exactly what a URL would.
 */
export let QUERY = new URLSearchParams(
  (globalThis as { SC_QUERY?: string }).SC_QUERY ??
    (typeof location === "undefined" ? "" : location.search),
);

/**
 * What the game asks of whoever is showing it — the page, or nobody. Films,
 * the status line, the level picker and the end of a game are the page's
 * business; a headless run leaves these as they are and the game goes
 * straight on past each one.
 */
export interface GameUi {
  /** a line of text while something loads or fails */
  status(text: string): void;
  /** the level now running, for a picker to show */
  levelShown(index: number): void;
  /** play a film to its end (or its skip) */
  film(name: string): Promise<void>;
  /** the last life is gone: offer the score, and back to the menu */
  gameOver(score: number, level: number, difficulty: number): void;
}
export const ui: GameUi = {
  status: () => {},
  levelShown: () => {},
  film: async () => {},
  gameOver: () => {},
};

/**
 * WHICH of the two Skull Crackers this page is playing.
 *
 * `0x46b1a8` is the word `0x402950` reads to pick between `0x428080` and
 * `0x442ad0`, and input action 11 (`0x402d22`) toggles it — so the switch is the
 * game's own and so is changing it mid-level. See {@link file://../players.ts}
 * for the two of them and for every place they differ.
 *
 * `?char=1` picks one before the level loads; Shift+C is action 11.
 */
export let CHARACTER: 0 | 1 = QUERY.get("char") === "1" ? 1 : 0;
export let KIT = PLAYERS[CHARACTER];
export let ANIM = KIT.anim;
export let ACTIONS = KIT.actions;
export let MEASURED = KIT.measured;
export let STAND_FEET = KIT.standFeet;
export let TUCK_FEET = KIT.tuckFeet;
export let BLOW_CODES = PLAYER_CODES[CHARACTER];
export let HELD = PLAYER_HELD[CHARACTER];

/** action 11: the other player, and the level again so the pose is theirs */
export function useCharacter(n: 0 | 1): void {
  CHARACTER = n;
  KIT = PLAYERS[CHARACTER];
  ANIM = KIT.anim;
  ACTIONS = KIT.actions;
  MEASURED = KIT.measured;
  STAND_FEET = KIT.standFeet;
  TUCK_FEET = KIT.tuckFeet;
  BLOW_CODES = PLAYER_CODES[CHARACTER];
  HELD = PLAYER_HELD[CHARACTER];
}

/**
 * The things in a room you can stand on, walk into, or climb.
 *
 * All three are entity rects off the disc, sorted into their room by the same
 * containment test `readRooms` uses for doors. What each one MEANS is the
 * engine's, as far as it has been read:
 *
 * - **`platform`** is the commonest object in the game (263 across the sixteen
 *   levels) and `SC.EXE`'s platform path says what it is: a rect that carries
 *   whatever stands on it. Here only its TOP edge is used, as a ledge.
 * - **`obstacle`** is drawn as a tall rect at the ends of levels and against
 *   walls; taken here as solid. The executable has not been read on it.
 * - **`ladder`** is a tall thin rect, and STREETS puts an `initplayer` at the
 *   top of its one ladder — which is the only thing in the data that says a
 *   ladder is for getting up there.
 * - **`goal`** is one rect per level, and every level has exactly one. It is the
 *   end. Its param is 0 or 1 with no relation to any room, so it is not a door.
 */
export interface Solids {
  /**
   * COPIES of the records, not the records — a `platform` can be owned by an
   * object and follow it (`0x42fcb9`, see {@link file://../props.ts}), and a plank
   * that gives way takes its floor with it.
   */
  platforms: SbkEntity[];
  obstacles: readonly SbkEntity[];
  goal: SbkEntity | undefined;
}

export interface Level {
  sbk: SbkFile;
  pal: Uint8ClampedArray;
  /** the level's own rooms, floors rasterised and doors attached */
  rooms: SbkRoom[];
  /** what stands in each room, by its index in `rooms` */
  solids: Solids[];
  /**
   * The level's ladders, ALL of them, and deliberately not filed by room.
   *
   * `0x40b940` is the engine's only entity query and it is a linear scan of the
   * whole table — `[0x46b9a8]+0x1c`, stride 48, `[+0x18]` records — with no
   * reference to a region anywhere in it. The ladder lookup is that scan with
   * kind 2, the rect-contains-point test at `0x434200`.
   *
   * Filing a ladder into the room its CENTRE falls in, which is what this page
   * did, is wrong for the thing a ladder IS. Nine ladders ship and only two of
   * them stand inside one room:
   *
   * ```
   *   STREETS   1 ladder    room 0                     works
   *   RAVECAVE  1 ladder    room 1                     works
   *   SEWER     3 ladders   two of them span 2 rooms
   *   TOWER     3 ladders   span 2, 3 and 4 rooms
   *   MAZE      4 ladders   ALL FOUR centre in NO room at all
   * ```
   *
   * MAZE's four sit in the gaps between its seven regions, so `solidsIn` filed
   * them nowhere and the level had no ladders whatever; TOWER's answered only
   * while you were already in the one room that happened to own the middle of
   * them, which for two of the three is not the room you climb from.
   */
  ladders: readonly SbkEntity[];
  /**
   * The level's monkeybars, and there is exactly one in the game — VAT's.
   *
   * Filed whole rather than by room for the same reason the ladders are: the
   * record is found by `0x40b660`, which scans the entity table and consults no
   * room at all (its region argument is 0 at `0x41243b`). See {@link MONKEYBAR}.
   */
  bars: readonly SbkEntity[];
  /**
   * The shared AI's table, narrowed to what THIS book can draw.
   *
   * A class ships one repertoire and appears in several levels, and a level
   * carries only the cels it needs: `initwerea` has ten attacks in CITY and
   * STREETS holds the art for seven of them. An attack whose cels are not in the
   * book would play as nothing at all, so it is dropped here rather than swung.
   * See {@link file://../fights.ts}.
   */
  fights: Readonly<Record<string, FoeFight>>;
  /** what each room spawns — the `init*` records this page knows how to draw */
  spawned: Enemy[][];
  /** the room's planks, each holding the platform record it owns */
  planks: Plank[][];
  /** the room's elevators, each holding the platform record its car IS */
  elevators: Elevator[][];
  /** the room's swinging girders, pinned where their records put them */
  ibeams: Ibeam[][];
  crushes: Crush[][];
  /** the room's wall levers, each holding the `param` it broadcasts on */
  switches: Switch[][];
  /** the room's goop nests — invisible, and off until a lever says otherwise */
  nests: Nest[][];
  /** the room's doors, shut and solid until a lever on their number is thrown */
  doors: Door[][];
  /** the room's sump lifts, each carrying the platform record laid over it */
  elevs: Elev[][];
  /** the room's shack fronts, which open as you come level with them */
  shacks: Shack[][];
  /** the room's floating barrels, each with the platform it claimed */
  barrels: Barrel[][];
  /** the room's outfalls, and the pools they have made */
  pipes: Pipe[][];
  sewage: Sewage[][];
  /** the room's `initbush`, hanging where its record put it */
  bushes: Bush[][];
  /** the room's roach nests — invisible, and only busy while you are in them */
  nests2: Nest2[][];
  /** the seven places level eight's water can come from, by their own slot */
  sprinklers: Sprinkler[][];
  /** the `stat*` records, as the codes their chapter's init hands the creator */
  pickups: Pickup[][];
  /** the positive-code records — the guns, and the ammunition for them */
  guns: Gun[][];
  /** level nine's five graves, shut until you come near one */
  holes: Hole[][];
  /** and its four hands, up out of the ground while you stand in their rect */
  hands: Hand[][];
  /** the swinging blades of levels ten and eleven */
  axes: Axe[][];
  /** and level ten's four rope bridges */
  bridges: Bridge[][];
  /** level twelve's five floors, which will not hold either */
  floors: Floor[][];
  /** ...and its two surges, the only hazard in the game that gives you something */
  surges: Surge[][];
  /** level thirteen's seven cage doors, which become obstacles when they shut */
  cages: Cage[][];
  /** its six alarms and its eight fans */
  alarms: Alarm[][];
  fans: Fan[][];
  /** ...and its two big guns, hatch and turret in one record */
  bigguns: BigGun[][];
  /** TOWER's two halves of one fork of lightning */
  lights: LightFx[][];
  /**
   * ...and the level's `probe` records, which are the LEVEL's and not any room's.
   * `0x40b526` fills one buffer for the whole book and `0x4280d2` walks all of
   * it, so filing these by room would be filing them by the wrong thing.
   */
  probes: Probe[];
  /** level fourteen's forty-two conveyors, its two chairs and its four claws */
  belts: Belt[][];
  chairs: Chair[][];
  claws: Claw[][];
  /** LAB's and VAT's one-cel furniture, and the last thing in the game */
  fittings: Fitting[][];
  boggs: Boggs[][];
  /** the room's crows, asleep until something walks into their rect */
  crows: Crow[][];
  /** placements back-to-front with their cel container and engine rate resolved */
  draw: {
    loc: number;
    cels: number[];
    x: number;
    y: number;
    rate: number;
    /** engine frames each of `cels` is held — see {@link backdropFrames} */
    hold: number;
    mirror: boolean;
    z: number;
  }[];
  anchorX: number;
  anchorY: number;
  name: string;
}
/** the decoded frame too, for anchors */
export const frameCache = new Map<string, ShpFrame>();
export function frameOf(level: Level, loc: number): ShpFrame | null {
  const key = `${level.name}:${loc}`;
  let f = frameCache.get(key) ?? null;
  if (!f) {
    try {
      f = decodeShpFrame(level.sbk.file.containers[loc].data);
      frameCache.set(key, f);
    } catch {
      return null;
    }
  }
  return f;
}

// ---- state -------------------------------------------------------------------

export let files: SkullFiles;
/**
 * The disc's own sound — the level's theme and the banks the handlers play from,
 * see {@link file://../sound.ts}. Null until the rip is indexed, and silent
 * whenever a browser will not start an AudioContext, so nothing here has to check
 * twice.
 *
 * ...which is why a sound's index is never rolled INSIDE `sound?.effect(...)`:
 * an optional call does not evaluate its arguments when there is no sound, so
 * the `0x434540` roll would be made in a browser and skipped headless, and the
 * two would play different games from there on. SC.EXE rolls before it calls.
 */
export let sound: Sounds | null = null;
export let level: Level | null = null;
/** the player book, shared across levels */
export let player: SbkFile | null = null;
export let levelIndex = 0;
/** ?clock=, in engine frames, for the first level only */
export let startTicks: number | null = null;

export const p = {
  x: 0,
  y: 0,
  facing: 1,
  moving: false,
  /** W held and not on a ladder — `[0x4ac3fe]`, the engine's own run flag */
  running: false,
  /** ground covered since the level opened — what drives the walk cycle */
  travelled: 0,
  /** which room they are standing in — the level's own division of itself */
  room: null as SbkRoom | null,
  /** downward speed in px per tick; 0 while standing */
  vy: 0,
  /** the engine's vertical velocity, in RAW units and advanced once an ENGINE frame */
  vyRaw: 0,
  /**
   * The horizontal velocity, `obj+0xc`: whole pixels a frame, on the ground and
   * off it. The gait's dx is an impulse into it and the ground's drag takes it
   * back ({@link dragged}); in the air the tag-0 handler steers it and nothing
   * slows it. Ticks move by a quarter of it.
   */
  vx: 0,
  /** this engine frame's whole-pixel vertical step, spread across its four ticks */
  stepPx: 0,
  /** ticks into the current engine frame: TICK_SCALE each, so one frame per four */
  frameAcc: 0,
  /** `player+0x18` is 15, INV's state (`0x428975`) — see {@link stepInv} */
  inv15: false,
  /** ...or the idle it hands you to while INV is down, which goes straight back */
  invLoop: false,
  onGround: true,
  climbing: false,
  /**
   * Where on a ladder they are, and it is a RUNG rather than a height — see
   * {@link LADDER}. Rung 0 is the ladder record's own top; the anchor is
   * `top + rung * 35` and `climbTag` is which of the climb script's four tags is
   * playing, clocked in engine frames by `climbClock`.
   */
  rung: 0,
  climbTag: 0,
  climbClock: 0,
  /** the record you are on — `0x4ac3a0`, copied once by the grab and never re-asked */
  ladder: undefined as SbkEntity | undefined,
  /** the world y of the anchor the climb cels hang from, while on a ladder */
  climbY: 0,
  /**
   * The monkeybar being hung from, and where along it — see {@link MONKEYBAR}.
   *
   * `barHold` is a handhold counted from the record's `left` in its own `param`
   * exactly as a rung is counted from a ladder's `top`, `barTag` is which of
   * `0x472048`'s five tags is playing, and `barClock` counts engine frames into
   * it. The record itself is `0x4ac3a0`, copied once by the grab.
   */
  bar: undefined as SbkEntity | undefined,
  barHold: 0,
  barTag: 0,
  barClock: 0,
  /**
   * How far the feet are below the ANCHOR in the pose showing now — see
   * {@link poseFeet}. `p.y` is the feet, the engine's `y` is the anchor, and this
   * is the difference; it changes when the pose does, and `p.y` is converted with
   * it so the anchor never jumps.
   */
  feet: 90,
  /** the one-shot action playing, and how far into it, in engine frames */
  act: null as string | null,
  actClock: 0,
  /**
   * Which tag of the dying script `0x4721a0` is playing: 0, which every death
   * but one installs, or 3 — the lightning's (`0x42f3d4`), which jerks
   * through two shock cels before the fall. See {@link actOf}.
   */
  dyingTag: 0 as 0 | 3,
  /**
   * `obj+0x24`, the float `0x42f850` sets — what the constant gravity is
   * multiplied by before it is added.
   *
   * It is 1 for the whole of ordinary play and the reaction table is the only
   * thing that moves it: a grab sets it to 0 (`0x448ef4`), the surge and the
   * unreachable -6 set it to 1, and the bush's -5 sets it to a half. Which is
   * how being held stops you falling without any state anywhere saying so.
   */
  gravityScale: 1,
  /**
   * What has hold of the player, as a function returning the world point its
   * current cel's grip is at — or null the frame that grip goes away, which is
   * how a grab ends. See {@link gripOf}.
   */
  heldBy: null as (() => { x: number; y: number } | null) | null,
  /**
   * WHICH thing that is — `0x4ac408`, the engine's own one-slot memory of it.
   *
   * It is here for the same reason the engine keeps it: a grabber asks whether
   * it still has hold of anything (`obj+0x2a`, tested at `0x420dd1`) and that
   * answer has to come from somewhere.
   */
  heldWhat: null as object | null,
  /**
   * `[0x46b1b4]` clear — something is carrying him and its own cels draw him,
   * so `0x402980` is skipped (`0x419d25`): kragg's fist, the eyeball, the
   * skeleton's grip. Collision does not ask.
   */
  hidden: false,
  /** engine frames into the held loop, once the reaction's own script has run */
  heldClock: 0,
  /** whether the fire act has already let its round go — `0x42cd53` fires once */
  fired: false,
  /**
   * Engine frames completed since leaving the ground. The tag-0 handler — the
   * lift and the steering — first runs on the second: the launch frame ends the
   * launch tag, the frame after installs tag 0 (`0x42a1c2`), and only then does
   * `0x429f1f` read a key.
   */
  airFrames: 0,
  /**
   * Frames of the launch tag still to play, the last of which is the launch:
   * four for a standing or walking jump (`250 251 252 253`), one for the run's
   * (`200`). While it counts the player is on the ground and the keys do nothing.
   */
  windup: 0,
  /** the dx the launch record carries — 0 standing, 100 walking, 180 running */
  launchDx: 0,
  /** in the air by a JUMP — the kind-3 state, which steers, lifts and lands in tag 1 */
  launched: false,
  /** frames of the landing tag still to play; the keys do nothing until it ends */
  landLeft: 0,
  /** and whether that landing is `0x471c68`'s — the fall was more than 360 */
  hardLand: false,
  /** engine frames spent standing still — the idle fidget's clock */
  idleClock: 0,
  /** S held on the ground — the duck (see {@link ANIM.crouch}) */
  crouching: false,
  /** pixels fallen this flight — past 360 the tuck becomes the flail (0x4284ba) */
  fallPx: 0,
  /**
   * In the flail — kind 25, `0x472350`, which the state machine's preamble
   * forces on a fall past 360 ({@link PlayerAnim.flail}).
   */
  flail: false,
  /** a running jump is tag 4's instant leap: no wind-up, straight to the tuck */
  leap: false,
  /** the fidget playing over the idle, if the end-of-cycle roll picked one */
  fidget: null as readonly number[] | null,
  fidgetClock: 0,
  /**
   * What is left of the jump's lift allowance, in engine frames — `0x4723f0`,
   * which the engine only ever sets to 2.
   */
  hold: 0,
  /**
   * Off a ledge WITHOUT a jump, and so still in a ground state: `0x42999e` has
   * the walk state install the idle's tag 1 the frame there is no floor, and
   * `0x429bf0` the run its own tag 1. Neither the idle (`0x429690`) nor the run
   * (`0x429b80`) asks for a floor before it reads J, P or K, so a fall off an
   * edge can still jump — the launch's -35 on top of the fall — and still
   * punch and kick, with the ground's moves rather than the flight's. The
   * flail ends it at a fall of 360, as it ends everything.
   */
  fallState: null as "idle" | "run" | null,
};
/** `mov word ptr [0x4723f0], 2` — the allowance, and it is 2 in all eight places */
export const HOLD_FRAMES = 2;

/**
 * What a blow does to the PLAYER — read out of `SC.EXE`, and **off by default**.
 *
 * Everything in this block is the engine's, and none of it runs unless the switch
 * below is thrown. The reason is the levels: with damage on, a probe walking east
 * through WOODS meets three hydraulic presses and every route test in this repo
 * becomes a fight. So it ships ready and dark, and `?damage=1` or Shift+H
 * turns it on.
 *
 * The numbers:
 *
 * ```
 *   448ac2  max = trunc(difficulty * 600.0) + 0x4b0    ; 1200 at difficulty 0
 *   4490d5  di = 0x42f910(hitter)                      ; sqrt(blowX² + blowY²)
 *   449115  cmp di, 0x3c                               ; 60: stagger or knockdown
 *   44911b  0x448bf0()                                 ; ...and a knockdown disarms you
 *   449146  0x45b060(weapon, point, facing, cel)        ; the gun goes on the floor
 *   44914b  [0x479438] = 0                             ; and your hands are empty
 *   449209  0x402ac0(di)                               ; and the damage IS di
 *   402ad8  health floors at 0, and 0x402fa0(1) starts the dying script
 * ```
 *
 * And the fall, which is its own path (`0x443c2b`) and takes no blow at all:
 * past 360 of accumulated drop the player is cut into the flail, and on landing
 * past 530 it is simply death, under that a flat ten and a roll.
 */
export const HURT = {
  /** `0x448ad1` at difficulty 0 — the middle of 1800 / 1200 / 600 */
  max: 1200,
  /** `0x448ac2`'s own arithmetic: `trunc(d * 600) + 0x4b0` */
  maxAt: (d: number): number => Math.trunc(d * 600) + 0x4b0,
  /** `0x449115`'s `cmp di, 0x3c` */
  knockdown: 60,
  /** `0x442f3f`'s `cmp [player+0x32], 0x168` — the drop that forces the flail */
  flailFall: 360,
  /** `0x443c82`'s `cmp [player+0x32], 0x212` — past this a landing is fatal */
  fatalFall: 530,
  /** `0x443ce7`'s `push 0xa` — what an ordinary bad landing costs */
  fallDamage: 10,
  from: "0x448a90 / 0x448c60 / 0x402ac0 / 0x443c2b",
} as const;

/**
 * Is the damage above switched on? `?damage=1` at load, `h` at any time.
 *
 * It starts off. See {@link HURT} for why, and for everything it turns on.
 */
export let damageOn = QUERY.get("damage") === "1";

/**
 * ...and whether a CREATURE's blow is one of the things it may spend — `?foehit=1`,
 * and off even when {@link damageOn} is on.
 *
 * The enemy strike boxes have been read and wired the whole time (the loop in
 * {@link takeHits} that walks `spawnedHere()`), but until {@link stepFight} no
 * creature in the game ever came close enough to use one, so the switch above
 * only ever let the presses, the girders and the current through. Bringing the
 * shared AI in makes that loop live, and the brief for it was the behaviour and
 * NOT the damage — so the creature half gets a switch of its own and it starts
 * off. Everything else the switch above arms is unchanged.
 */
export let foesHurt = QUERY.get("foehit") === "1";

/**
 * `?foes=0` — the level with its creatures left out, and it is the page's, not
 * the game's: a suite that measures a lift or a press wants the machine alone,
 * and a punk put down on the same landing shoves the player off it
 * ({@link bodyPush}), exactly as the original would.
 */
export let foesOff = QUERY.get("foes") === "0";

/**
 * How hard — `0x46b20c`, and the preferences panel is what sets it.
 *
 * It was written down here once that nothing writes this word and that the
 * difficulty is therefore always zero. Three instructions say otherwise:
 * `0x45d788`, `0x45d79b` and `0x45d7ae` store **1, 0 and -1**, and they are the
 * three little boxes the prefs panel draws at `0x4791d8`, `0x4791e0` and
 * `0x4791e8` (see `src/main.ts`). What the number does:
 *
 * ```
 *   448ac2  max health = trunc(d * 600) + 0x4b0      1800 / 1200 / 600
 *   40e300  scale(n)   = n - (n / 2) * d             half a blow / n / half again
 * ```
 *
 * so **+1 is EASY**: more health and softer blows. Zero unless the front end
 * says otherwise, which is what it was before — the default and not the only
 * value.
 */
const difficultyOf = (q: URLSearchParams): -1 | 0 | 1 => {
  const n = Number(q.get("difficulty") ?? 0);
  return n === 1 || n === -1 ? n : 0;
};
export let DIFFICULTY = difficultyOf(QUERY);

/**
 * A new set of switches, for a headless run that stands the game up again in
 * the same process — every switch read at load is read again. The page never
 * calls it: its switches are its address bar's, once.
 */
export function setQuery(query: string): void {
  QUERY = new URLSearchParams(query);
  useCharacter(QUERY.get("char") === "1" ? 1 : 0);
  damageOn = QUERY.get("damage") === "1";
  foesHurt = QUERY.get("foehit") === "1";
  foesOff = QUERY.get("foes") === "0";
  DIFFICULTY = difficultyOf(QUERY);
}

/**
 * `0x40e300(n)` — `n - (n/2) * [0x46b20c]`, and what it scales is what the
 * LEVELS BUILD rather than what the player takes.
 *
 * It is called from the class constructors — Boggs' own four thousand
 * (`0x41be84`, `0x40e300(0xfa0)`) and his two machines' three (`0x41b474`,
 * `0x40e300(0xbb8)`) among them — and from nowhere in either player's hit
 * handler. The player's end of the difficulty is the max health at `0x448ac2`
 * instead. At zero this is the identity, which is why it can be applied
 * everywhere without moving a single number that was already measured.
 */
export function scaled(n: number): number {
  return n - Math.trunc(n / 2) * DIFFICULTY;
}
export const held = {
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  punch: false,
  kick: false,
  inv: false,
};

/** the mission this level is — its films, and the share of it that must die */
export function mission(): Mission {
  return MISSIONS[levelIndex] ?? MISSIONS[0];
}

/** how many of this level's population are still standing */
/**
 * Does this one still hold `obj+0x1c`, the census flag — enrolled by its
 * creator (`0x42f870(obj, 1)`, {@link Foe.counts}) and not yet let go.
 *
 * Most classes let go the first frame they are dead (`0x42f870(obj, 0)` in
 * their death state or handler). A class that never does is let go only as
 * the object is freed: `0x430fd0` → `0x42f6e0` → `0x42f750`, whose `0x42f778`
 * takes one off `[0x4a6e88]` for an object whose flag is still set — see
 * {@link Foe.countsDead}. A removal that is not a death (the ox's pit, igor's
 * fall, `BrainCtx.remove`) takes the thing out of the pool, and so out of
 * here, the frame the think answers 1.
 */
export function inCensus(e: Enemy): boolean {
  const foe = FOES[e.kind];
  return foe.counts && (e.state !== "dead" || !!foe.countsDead);
}

export function aliveNow(): number {
  // a body has already left: its state handler calls `0x42f870(obj, 0)` on the
  // first frame it is dead, fifty frames before the object itself goes
  if (!level) return 0;
  return (
    level.spawned.reduce(
      (n, r) =>
        n + r.filter(inCensus).length,
      0,
    ) +
    // and Boggs leaves the census the frame it starts dying, for the same reason
    level.boggs.reduce((n, r) => n + r.filter((b) => !b.dying).length, 0)
  );
}
export function setDamageOn(v: typeof damageOn): void {
  damageOn = v;
}
export function setFiles(v: typeof files): void {
  files = v;
}
export function setSound(v: typeof sound): void {
  sound = v;
}
export function setPlayer(v: typeof player): void {
  player = v;
}
export function setStartTicks(v: typeof startTicks): void {
  startTicks = v;
}

/** the other modules' writes into this one's state — ES imports are read-only */
export function setLevel(v: typeof level): void {
  level = v;
}
export function setLevelIndex(v: typeof levelIndex): void {
  levelIndex = v;
}
