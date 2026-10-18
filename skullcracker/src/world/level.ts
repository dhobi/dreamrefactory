/**
 * A level from opening to leaving it: {@link loadLevel}, the goal and the craft
 * that carries the player out, running out of time, the next level and the
 * tally, the pause panel, and waking the audio.
 */
import { readSbkFile, SbkEntity, SbkFile, SbkRoom, LEVEL_ORDER, PLANE_Z, PLAY_PLANE_Z, placementRate, readRooms } from "@dreamfactory/engine/df/sbk";
import { paletteToRGBA } from "@dreamfactory/engine/df/image";
import { AudioSink, DeferredAudioSink, WebAudioSink } from "@dreamfactory/engine/runtime/audio";
import { FOES } from "../foes";
import { TICK_SCALE } from "../brains/kit";
import { FIGHTS } from "../fights";
import { CRAFT } from "../effects";
import { SPRINKLER, PIPE, SEWAGE, BUSH, Bush, ROACH, HOLE, HAND, AXE, BRIDGE, FLOOR, SURGE, CAGE, ALARM, BIGGUN, LIGHTFX, FAN, BELT, CHAIR, CLAW, FITTING, Fitting, BOGGS } from "../props";
import { ENDING_FILM, MISSIONS, TIME_OUT_FILMS, allowanceFor } from "../mission";
import { CHAPTER_WEAPON } from "../guns";
import { CEL as HUD_CEL, CLOCK, CLOCK_FULL, dialCel } from "../hud";
import { random, seedRandom } from "../random";
import { ui, files, p, level, scaled, levelIndex, mission, startTicks, sound, aliveNow, CHARACTER, type Level, type Solids, setLevel, setLevelIndex, setStartTicks } from "./state";
import { setInput } from "./keys";
import { playerBox } from "./cels";
import { startCamera, setLevelClock, setBackdropFrames, setFlashColour, setFlypasts, setIface } from "./camera";
import { pickStart, planksIn, spawnIn, elevatorsIn, roll, crowsIn, dropAt, roomAt, solids } from "./rooms";
import { inv, gunsIn, setFlares, setBolts, setStreams } from "./arsenal";
import { stats, bossDown, setGobs, setPops, setSparks } from "./blows";
import { deathRed, advancing, setDeathRed, setAdvancing, setSpawnIndex } from "./death";
import { ibeamsIn, crushesIn, switchesIn, nestsIn, doorsIn, elevsIn, shacksIn, barrelsIn, placed, pickupsIn, wormBounds, boundsAgainst, headAndArm, filedIn } from "./fixtures";
import { clockFor, setDrips, setRoaches, setColumns, setRaised, setFeathers } from "./scenery";
import { setCasts, setSkates, setRollers, setCans, setHeads, setFlames } from "./casts";

export async function loadLevel(index: number): Promise<void> {
  // a level loaded in the middle of the red is a level with its own palette
  // back (`0x402860` reads the CLUTs afresh): the death that was playing is over
  if (deathRed) {
    setDeathRed(null);
    setAdvancing(false);
  }
  const name = LEVEL_ORDER[index];
  ui.status(`loading ${name}…`);
  const bytes = await files.load(`${name}.sbk`);
  if (!bytes) {
    ui.status(`${name}.sbk is not in this rip`);
    return;
  }
  const sbk = readSbkFile(bytes);
  const pal = paletteToRGBA(sbk.paletteRaw!, 256);
  const rooms = readRooms(sbk);
  const solids = rooms.map((r) => solidsIn(sbk, r));
  const start = pickStart(sbk);
  // the record's own point, which `0x42e603` writes into `obj+6` whole
  const anchorX = start ? start.pointX : 0;
  const anchorY = start ? start.pointY : 0;
  // planks before lifts: both OWN a platform record and a record has one owner,
  // so the planks claim theirs first and the lifts are told what is already spoken for
  const planks = rooms.map((r, i) => planksIn(sbk, r, solids[i]));
  emptyTheWorld();
  enterChapter(name);
  // `0x448bc7` — and every level opens on the idle `0x475c88`, kind 0, whatever
  // you carried in from the last one: the gun waits for INV
  inv.drawn = false;
  p.inv15 = p.invLoop = false;
  setLevel({
    sbk,
    pal,
    rooms,
    solids,
    ladders: sbk.entities.filter((e) => e.isEntity && e.name === "ladder"),
    bars: sbk.entities.filter((e) => e.isEntity && e.name === "monkeybar"),
    ...fightsIn(sbk),
    spawned: ((claimed: Set<SbkEntity>) =>
      rooms.map((r) => spawnIn(sbk, r, claimed)))(new Set<SbkEntity>()),
    planks,
    elevators: rooms.map((r, i) => elevatorsIn(sbk, r, solids[i], planks[i])),
    ibeams: rooms.map((r) => ibeamsIn(sbk, r)),
    crushes: rooms.map((r) => crushesIn(sbk, r)),
    switches: rooms.map((r) => switchesIn(sbk, r)),
    nests: rooms.map((r) => nestsIn(sbk, r)),
    doors: rooms.map((r) => doorsIn(sbk, r)),
    elevs: rooms.map((r, i) => elevsIn(sbk, r, solids[i])),
    shacks: rooms.map((r) => shacksIn(sbk, r)),
    barrels: rooms.map((r, i) => barrelsIn(sbk, r, solids[i])),
    ...sceneryIn(sbk, rooms),
    pickups: rooms.map((r) => pickupsIn(sbk, r)),
    guns: rooms.map((r) => gunsIn(sbk, r)),
    ...trapsIn(sbk, rooms),
    ...machinesIn(sbk, rooms),
    ...fittingsIn(sbk, rooms),
    ...bossIn(sbk, rooms),
    ...fansIn(sbk, rooms),
    ...groundIn(sbk, rooms),
    crows: rooms.map((r) => crowsIn(sbk, r)),
    ...drawOrder(sbk),
    anchorX,
    anchorY,
    name,
  });
  setLevelIndex(index);
  ui.levelShown(index);
  takeCensus();
  // `0x448ad8` fills it on the way in, and `0x402760` does the same on a respawn
  stats.health = stats.maxHealth;
  // ?clock= starts the mission clock short, which is the only way to reach the
  // last two minutes of an eight-minute dial from a test. It is spent on the
  // first level it is given to, so a timed-out level does not time out again.
  stats.clockFull = clockFor(sbk);
  stats.ticks = startTicks ?? stats.clockFull;
  setStartTicks(null);
  stats.shown = null;
  goalOpen = false;
  // `0x437020` / `0x43d440`, `0x41fa0c` / `0x421fa0`, `0x412cfb` / `0x4165ac`
  bossDown.hardcore = bossDown.belfry = bossDown.lab = false;
  leftGoal = false;
  craft = null;
  // `0x448a93` / `0x42e583` — the player's set-up opens the keys (`0x402df0`)
  setInput(true);
  setGobs([]);
  setPops([]);
  setSparks([]);
  dropAt(roomAt(anchorX, anchorY), anchorX, anchorY);
  // `0x42e580`: the corner goes on the start point itself, not the arrival's
  startCamera(anchorX, anchorY);
  // `0x4036ff` — and the dice start over, on the constant every level uses,
  // once its things have been made: see {@link file://../random.ts}
  seedRandom();
  // the level's own theme and its chapter's effects bank — LEVEL_BANKS is the
  // table SC.EXE's own opens spell out, keyed by this book's name
  void sound?.open(name);
}

/** whatever the last level left lying about — the drips, the shots, the flames, the clocks — gone */
function emptyTheWorld(): void {
  setDrips([]);
  setRoaches([]);
  setLevelClock(0);
  setBackdropFrames(0);
  // `0x42e5fa` — the respawn index starts on the level's first `initplayer`
  setSpawnIndex(0);
  setFlashColour(-1);
  setFlypasts([]);
  setColumns(new Map());
  setRaised(new Set());
  setFlares([]);
  setBolts([]);
  setStreams([]);
  setFeathers([]);
  setCasts([]);
  setSkates([]);
  setRollers([]);
  setCans([]);
  setHeads([]);
  setFlames([]);
}

/**
 * the chapter's own entry function: zero every count, name the chapter's
 * weapon, and leave the hands empty (`0x4511f0` and its three siblings). It
 * runs once per CHAPTER, not once per level, and that is the whole reason
 * SEWER places two `statflare` and no gun to fire them with — you are
 * expected to still be holding SERVICE's.
 */
function enterChapter(name: string): void {
  const chapter = CHAPTER_WEAPON[name.toUpperCase()];
  if (chapter !== undefined && chapter !== chapterWeapon) {
    chapterWeapon = chapter;
    inv.weapon = chapter;
    inv.armed = false;
    inv.rounds = {};
  }
}

/** which of each class's fight moves this level's book has the cels for */
function fightsIn(sbk: SbkFile): Pick<Level, "fights"> {
  return {
    fights: Object.fromEntries(
      Object.entries(FIGHTS).map(([kind, f]) => [
        kind,
        {
          ...f,
          close: f.close?.cels.every((id) => sbk.byId.has(id))
            ? f.close
            : undefined,
          attacks: f.attacks.filter((a) =>
            a.cels.every((id) => sbk.byId.has(id)),
          ),
        },
      ]),
    ),
  };
}

/** the scenery that does something: pipes, sewage, bushes, roach motels and sprinklers */
function sceneryIn(sbk: SbkFile, rooms: SbkRoom[]): Pick<Level, "pipes" | "sewage" | "bushes" | "nests2" | "sprinklers"> {
  return {
    pipes: rooms.map((r) =>
      placed(sbk, r, "initpipe", PIPE.mouth.cels, (e) => ({
        x: e.pointX,
        y: e.pointY,
        mirror: e.param < 0,
        clock: 0,
      })),
    ),
    sewage: rooms.map((r) =>
      placed(sbk, r, "initsewage", [], (e) => ({
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        clock: SEWAGE.gulpEvery,
      })),
    ),
    bushes: rooms.map((r) =>
      placed(sbk, r, "initbush", BUSH.idle.cels, (e) => {
        // `0x435ba0`, once for the bush and — `param` 1, `0x435b30` — once more
        // for the partner that sits on it
        const make = (variant: 0 | 1, partner?: Bush): Bush => ({
          x: e.pointX,
          y: e.pointY + BUSH.below,
          restY: e.pointY + BUSH.below,
          top: e.pointY,
          left: e.left,
          right: e.right,
          wait: roll(5) + 10,
          mirror: roll(2) === 2,
          state: "idle",
          phase: 0,
          clock: 0,
          variant,
          partner,
        });
        const bush = make(0);
        return e.param === 1 ? [bush, make(1, bush)] : [bush];
      }).flat(),
    ),
    nests2: rooms.map((r) =>
      placed(sbk, r, "initroachmotel", ROACH.run.cels, (e) => ({
        x: e.pointX,
        y: e.pointY,
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        clock: -17,
        made: 0,
      })),
    ),
    sprinklers: rooms.map((r) =>
      placed(sbk, r, "initsprinkler", SPRINKLER.rise.cels, (e) => ({
        x: e.pointX,
        y: e.pointY,
        slot: e.param,
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
      })),
    ),
  };
}

/** the traps: graves, swinging axes, floors that give, surges, cage doors and alarms */
function trapsIn(sbk: SbkFile, rooms: SbkRoom[]): Pick<Level, "holes" | "axes" | "floors" | "surges" | "cages" | "alarms"> {
  return {
    holes: rooms.map((r) =>
      placed(sbk, r, "initgrave", [HOLE.shut], (e) => ({
        x: e.pointX,
        y: e.pointY,
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        state: "shut" as const,
        clock: 0,
      })),
    ),
    axes: rooms.map((r) =>
      placed(sbk, r, "initswingaxe", [AXE.swing[0]], (e) => ({
        x: e.pointX,
        y: e.pointY,
        clock: 0,
      })),
    ),
    floors: rooms.map((r) =>
      placed(sbk, r, "initfloor", [FLOOR.whole], (e) => ({
        x: e.pointX,
        y: e.pointY,
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        state: "whole" as const,
        clock: 0,
      })),
    ),
    surges: rooms.map((r) =>
      placed(sbk, r, "initsurge", SURGE.arc.cels, (e) => ({
        // `0x41ec66` / `0x41ec6a`: the object stands at the rect's top-left
        x: e.left,
        y: e.top,
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        clock: 0,
        on: false,
        mirror: e.param !== 0,
      })),
    ),
    cages: rooms.map((r) =>
      placed(sbk, r, "initcagedoor", [CAGE.shut], (e) => ({
        x: e.pointX,
        y: e.pointY,
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        // a door's own number is the absolute value; SEWER's five are filed the
        // same way and MAZE's seven run 1, 2, -2, 3, 4, -4, 4
        param: Math.abs(e.param),
        state: e.param < 0 ? ("open" as const) : ("shut" as const),
        clock: 0,
      })),
    ),
    alarms: rooms.map((r) =>
      placed(sbk, r, "initalarm", [ALARM.quiet], (e) => ({
        x: e.pointX,
        y: e.pointY,
        param: e.param,
        clock: 0,
      })),
    ),
  };
}

/** the machines: big guns, probes, lightning, belts, chairs and claws */
function machinesIn(
  sbk: SbkFile,
  rooms: SbkRoom[],
): Pick<Level, "bigguns" | "probes" | "lights" | "belts" | "chairs" | "claws"> {
  return {
    // `0x4115b0` — one record, two objects, and the turret starts home ten
    // pixels above the point the hatch sits on
    bigguns: rooms.map((r) =>
      placed(
        sbk,
        r,
        "initbiggun",
        [BIGGUN.hatch.shut, BIGGUN.unfold.cels[0]],
        (e) => ({
          x: e.pointX,
          y: e.pointY,
          top: e.top,
          left: e.left,
          bottom: e.bottom,
          right: e.right,
          state: "wait" as const,
          clock: 0,
          gunY: e.pointY - BIGGUN.turretUp,
          shot: 0,
          hatch: 0,
          hatchClock: 0,
        }),
      ),
    ),
    // `0x40b526` — one buffer for the book, and `0x4280d2` walks the whole of it
    probes: sbk.entities
      .filter((e) => e.isEntity && e.name === "probe")
      .map((e) => ({
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        mode: e.param,
        fired: false,
      })),
    // `0x4268c0` — and these stand up on their own clock, not on anything you do
    lights: rooms.map((r) =>
      placed(sbk, r, "initlightfx", LIGHTFX.bolt.cels, (e) => ({
        x: e.pointX,
        y: e.pointY,
        mirror: e.param < 0,
        clock: -1,
      })),
    ),
    belts: rooms.map((r) => [
      ...placed(sbk, r, "initbeltleft", BELT.roll.cels, (e) => ({
        x: e.pointX,
        y: e.pointY,
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        dir: -1 as const,
        param: e.param,
        clock: 0,
      })),
      ...placed(sbk, r, "initbeltright", BELT.roll.cels, (e) => ({
        x: e.pointX,
        y: e.pointY,
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        dir: 1 as const,
        param: e.param,
        clock: 0,
      })),
    ]),
    chairs: rooms.map((r) =>
      placed(sbk, r, "initchair", CHAIR.runs[0].cels, (e) => ({
        x: e.pointX,
        y: e.pointY,
        run: 0,
        clock: 0,
      })),
    ),
    claws: rooms.map((r) =>
      /**
       * It hangs at the record's POINT, ten pixels to the left of it.
       *
       * ```
       *   411cfd  mov dword ptr [eax+6], ecx    ; the point, Y and X together
       *   411d02  sub word ptr [ebx+8], 0xa     ; ...and ten off the X
       * ```
       *
       * This page hung it at the record's rect BOTTOM instead, and the reason it
       * had to was a bug in {@link strikeOf}: every prop's strike box was being
       * lifted by `height - posY`, so the only way to make a claw reach anybody
       * was to drop the claw by about as much. `bottom - point` is 113, 136, 115
       * and 177 across BARREL's four, and the lift is 76..127 — close enough to
       * work and never the same number, which is what a compensation looks like.
       *
       * With the box translated the way `0x40e680` translates it, the point is
       * enough: BARREL's fourth claw closes 34 pixels into a player standing
       * under it. Its other two hang 450 and 780 above their own floor and
       * reach nobody from either y.
       */
      placed(sbk, r, "initclaw", CLAW.running.cels, (e) => ({
        x: e.pointX - CLAW.leftBy,
        y: e.pointY,
        left: e.left,
        right: e.right,
        state: "idle" as const,
        clock: 0,
      })),
    ),
  };
}

/** VAT's showers, balls and teeth, each room's own */
function fittingsIn(sbk: SbkFile, rooms: SbkRoom[]): Pick<Level, "fittings"> {
  return {
    fittings: rooms.map((r) => {
      /**
       * Filed by the middle of their RECT rather than by their point. VAT's
       * four floor showers stand thirty pixels under the floor, below the
       * bottom of the region they spray into, and the point is only where the
       * grate is drawn; `0x40b940` puts each in a region all the same, and it
       * thinks with the rest (`0x41a2a0`).
       */
      const mine = (e: SbkEntity): boolean => {
        const cx = (e.left + e.right) / 2;
        const cy = (e.top + e.bottom) / 2;
        return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
      };
      const fitted = (e: SbkEntity, kind: Fitting["kind"]): Fitting => ({
        kind,
        // the think writes the record's point into `obj+6` every frame
        // (`0x41a2b6`, `0x41a7ec`); the −100 floor offset only moves the foot
        // the mover measures, and with no weight and no speed that is never
        // near a floor
        x: e.pointX,
        y: e.pointY,
        clock: 0,
        left: e.left,
        right: e.right,
        top: e.top,
        bottom: e.bottom,
        // `0x4117f7`: 1 when the point is nearer the rect's bottom
        tag: e.bottom - e.pointY < e.pointY - e.top ? 1 : 0,
        phase: "idle",
      });
      const art = (a: readonly { cels: readonly number[] }[]): boolean =>
        a.every((x) => x.cels.every((id) => sbk.byId.has(id)));
      const F = FITTING;
      return [
        ...(art([...F.shower.idle, ...F.shower.spray])
          ? sbk.entities.filter((e) => e.isEntity && e.name === "initshower" && mine(e)).map((e) => fitted(e, "shower"))
          : []),
        ...(art([F.ball.idle, F.ball.out, F.ball.back])
          ? sbk.entities.filter((e) => e.isEntity && e.name === "initball" && mine(e)).map((e) => fitted(e, "ball"))
          : []),
        ...placed(sbk, r, "initteeth", [FITTING.teeth.cel], (e) => fitted(e, "teeth")),
      ];
    }),
  };
}

/** Boggs: the body, its eight machines, its head and its arm */
function bossIn(sbk: SbkFile, rooms: SbkRoom[]): Pick<Level, "boggs"> {
  return {
    boggs: rooms.map((r) =>
      placed(sbk, r, "initboggsbody", BOGGS.idle.cels, (e) => ({
        x: e.pointX,
        y: e.pointY,
        clock: 0,
        hp: scaled(BOGGS.health),
        lunge: null,
        vx: 0,
        // `0x4122fa`: the record's rect, whose two x `0x41bb40` clamps the body to
        span: [e.left, e.right] as [number, number],
        // `0x411ed0`: eight objects at eight offsets from the body, and it runs
        // again every frame ({@link placeBoggs})
        machines: BOGGS.machines.map((m) => ({
          x: e.pointX + m.dx,
          y: e.pointY + m.dy,
          clock: 0,
          hp: "health" in m ? scaled(m.health) : 0,
          wrecked: false,
          wreckClock: -1,
        })),
        // `0x46e080` and `0x46e084`, both `01 00` in `.data`
        flags: [true, true] as [boolean, boolean],
        headClock: 0,
        headTag: 0,
        snap: 0,
        dying: false,
        // `[0x46e0b0]` is a `.data` word and `.data` words start at zero, so
        // the first eligible frame throws and the roll only spaces the rest
        throwWait: 0,
        throwDrop: 0,
        worms: [],
        warned: false,
        // `0x41ac7f` — one record, read once, and every worm is kept inside it
        bounds: wormBounds(sbk, r),
        boundsOff: boundsAgainst(wormBounds(sbk, r), e),
        // the head has a record of its own, and `0x412364` stores the offset it
        // lands at; `0x41c4c0` re-places it at body + that offset every frame
        ...headAndArm(sbk, r, e),
        // the first machine on `0x46e4d0`, at the body itself until it sweeps
        zap: { kind: 0 as const, tag: 0, clock: 0, dy: 0, dx: 0, armed: false, taunted: false },
      })),
    ),
  };
}

/** the fans, both ways round */
function fansIn(sbk: SbkFile, rooms: SbkRoom[]): Pick<Level, "fans"> {
  return {
    fans: [
      ...rooms.map((r) => [
        // `0x415304`: created on tag 0 with the counter at 40 (`0x411b38`)
        ...placed(sbk, r, "inithfan", [FAN.h.stopped], (e) => ({
          x: e.pointX,
          y: e.pointY,
          horizontal: true,
          state: "suck" as const,
          clock: 0,
          count: FAN.first,
          top: e.top,
          left: e.left,
          bottom: e.bottom,
          right: e.right,
          param: e.param,
        })),
        // `0x410cdd` makes every `initvfan` in the BOOK — no room test (see
        // {@link filedIn}) — and all five of MAZE's points lie between rooms
        ...filedIn(sbk, rooms, r, "initvfan", [FAN.v.stopped], (e) => ({
          x: e.pointX,
          y: e.pointY,
          horizontal: false,
          state: "suck" as const,
          clock: 0,
          count: FAN.first,
          top: e.top,
          left: e.left,
          bottom: e.bottom,
          right: e.right,
          param: e.param,
        })),
      ]),
    ],
  };
}

/** what comes up out of the ground or gives under it: the bridges and the hands */
function groundIn(sbk: SbkFile, rooms: SbkRoom[]): Pick<Level, "bridges" | "hands"> {
  return {
    bridges: rooms.map((r) =>
      placed(sbk, r, "initbridge", [BRIDGE.whole], (e) => ({
        x: e.pointX,
        y: e.pointY,
        homeY: e.pointY,
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        state: "whole" as const,
        stood: 0,
        clock: 0,
      })),
    ),
    hands: rooms.map((r) =>
      placed(sbk, r, "inithand", HAND.underfoot.up.cels, (e) => ({
        x: e.pointX,
        y: e.pointY,
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        // `0x420cc4` — the record's own param, not a roll
        underfoot: e.param === 0,
        atX: e.pointX,
        atY: e.pointY,
        state: "down" as const,
        clock: 0,
      })),
    ),
  };
}

/** the book's placements, cycled and in the engine's paint order */
function drawOrder(sbk: SbkFile): Pick<Level, "draw"> {
  return {
    // z is the ENGINE's paint order, which is its collection order: the level's
    // frame fn (SC.EXE 0x412c30) collects plane lists p3, p0, then the actors,
    // then p4, p1, p2 into one node array that 0x40e520 paints in order. So the
    // player sits between p0 and p4, and plane 2 — the giant lamp-post and the
    // overhead cables — is painted LAST, in FRONT of everything, and undimmed.
    // (The cables are light grey on purpose, and they belong over the wall, not
    // mixed into it.)
    draw: sbk.placements
      .map((q) => ({
        // the frame cels this placement cycles — [id] for a still one, the glow
        // sequence for the lamp (2360,2361,2362)
        cels: q.frameIds
          .map((id) => sbk.byId.get(id) ?? -1)
          .filter((l) => l >= 0),
        x: q.x,
        y: q.y,
        rate: placementRate(q),
        // `0x40c165`: an animated placement becomes an object whose script
        // header's hold (`script+2`, which `0x45d168` reloads every cel) is the
        // record's word at +0xa — the integer part of what `SbkPlacement` reads
        // as `parallax` (bytes +9..+11 over 256). 1 to 18 frames on the disc.
        hold: Math.max(1, q.hold),
        mirror: q.mirror,
        z: PLANE_Z[q.plane] ?? PLAY_PLANE_Z,
      }))
      .filter((q) => q.cels.length > 0)
      .map((q) => ({ ...q, loc: q.cels[0] }))
      .filter((q) => q.loc >= 0)
      .sort((a, b) => a.z - b.z),
  };
}

/**
 * the quota, the engine's own way round: count what was just spawned, then
 * take this stage's share off it (see src/mission.ts). The census counts only
 * the things that can claim the panel's bar, which is the same set the engine
 * counts — furniture never calls `0x40d1c0` and is not part of anyone's quota.
 */
function takeCensus(): void {
  stats.census =
    level!.spawned.reduce(
      (n, r) => n + r.filter((e) => FOES[e.kind].counts).length,
      0,
    ) +
    // ...and Boggs, whose HEAD is the census entry: `0x41c591` is
    // `0x42f870(head, 1)` and the body is not registered at all. VAT spawns no
    // creatures, so without this its quota is zero of zero and the level can be
    // walked to its goal without touching the thing the chapter is named for.
    level!.boggs.reduce((n, r) => n + r.length, 0);
  stats.allowance = allowanceFor(mission(), stats.census);
}

/**
 * The two-part win, and it is the engine's own order.
 *
 * `0x415f7f` (and `0x450190` for this chapter) tests the census against the
 * allowance FIRST and only then spawns the goal, which latches `0x46b1b0`; the
 * stage ends when `0x410370` reads `0x46ba10`, which the goal object sets for
 * itself once its own animation has finished.
 *
 * So the rect does nothing at all until the quota is met, and then what appears
 * is a THING rather than a live rect — see {@link craft} and
 * {@link file://../effects.ts}. A latch stops a level whose spawn sits in its
 * own goal completing on load, and the craft does not open on the frame it
 * arrives either.
 */
export function goalReady(): boolean {
  // RAVECAVE's and TOWER's cases ask the flag and NOT the count (`0x4219e5`,
  // `0x421a38`): what a split or a summon adds to the room is not counted
  const n = mission().number;
  const counted = n === 11 || n === 12 || aliveNow() <= stats.allowance;
  if (counted && !waitsFor()) goalOpen = true;
  return goalOpen;
}

/**
 * The goal's second condition — a kill the count does not stand for.
 *
 * Three of the four chapter end tests switch on the stage and, for some stages,
 * ask a flag besides (or instead of) the census:
 *
 * - SERVICE, level 6: `0x43b950`'s second case asks `[0x472574]` after the
 *   count (`0x43b9ec`), and only `inithardcore`'s death writes it
 *   (`0x43d309`) — so the goal waits for that one kill however far the count
 *   has gone.
 * - RAVECAVE and TOWER, levels 11 and 12: `0x421900`'s third and fourth cases
 *   (`0x4219e5`, `0x421a38`) ask `[0x46ece0]` and NOTHING else — their
 *   allowance is the census, see {@link MISSIONS}. The named wraith's fatal
 *   blow writes it (`0x4250eb`) and so does the bishop's (`0x426600`).
 * - LAB and VAT, levels 15 and 16: `0x415f50`'s third and fourth cases ask
 *   `[0x46bfbc]` after the count (`0x416047`, `0x4160a8`). The test tube's
 *   fatal blow writes it (`0x419ac9`) and so does Boggs going down
 *   (`0x41bdd8`).
 *
 * Every flag is cleared as its chapter's level begins (`0x437020`, `0x41fa0c`,
 * `0x412cfb` and their siblings). Answers what is still standing, or null.
 */
export function waitsFor(): string | null {
  const n = mission().number;
  if (n === 6 && !bossDown.hardcore) return "HARDCORE";
  if (n === 11 && !bossDown.belfry) return "the wraith";
  if (n === 12 && !bossDown.belfry) return "the bishop";
  if (n === 15 && !bossDown.lab) return "the test tube";
  if (n === 16 && !bossDown.lab) return "Boggs";
  return null;
}

/**
 * The clock ran out: one of the four TIME films, then this level again.
 *
 * `0x40e9d0` is the whole of the original's choice — `0x434540(4)`, the same
 * random helper the punch tosses for its variant, picking `TIME1.MOV` through
 * `TIME4.MOV`. What follows the film in the original is a state this page has not
 * read; it restarts the level and leaves the lives alone, since nothing found so
 * far spends one here.
 */
export async function ranOut(): Promise<void> {
  if (advancing) return;
  setAdvancing(true);
  const pick =
    TIME_OUT_FILMS[Math.floor(random() * TIME_OUT_FILMS.length)];
  stats.ticks = CLOCK_FULL; // so a slow film cannot fire this twice
  await ui.film(pick);
  await loadLevel(levelIndex);
  setAdvancing(false);
}

/**
 * The goal was reached with the quota met: the next mission, briefing first.
 *
 * The score carries and everything else is the new level's own — which is what
 * `loadLevel` already does, the census and the clock included.
 *
 * ...and the sixteenth is the END. `0x41293d` plays `credits.mov` and drops the
 * chapter loop, which hands the game back to its title menu — see
 * {@link ENDING_FILM}. This page has no title menu to hand it to, so it plays
 * the credits and opens level one with the score kept, which is the nearest
 * thing to the front that a single page has.
 */
export async function nextLevel(): Promise<void> {
  setAdvancing(true);
  if (levelIndex === MISSIONS.length - 1) {
    ended = true;
    await ui.film(ENDING_FILM);
    ended = false;
    await loadLevel(0);
    setAdvancing(false);
    return;
  }
  const next = levelIndex + 1;
  const brief = MISSIONS[next];
  // BOGGS FIRST, and then the chapter card. Each stage's case queues its films
  // one after another through `0x40e330` (clear) and `0x40e990` (play and wait),
  // and the order is the order of the pushes:
  //
  // ```
  //   44d7b9  push 0x478a38   ; Boggs01.Mov      44d7de  push 0x478a2c  ; Chp01.Mov
  //   436a8b  push 0x475020   ; Boggs06.Mov      436ab0  push 0x475014  ; Chp06.Mov
  // ```
  //
  // — the same way round in a mid-chapter stage as in a chapter's first, so it
  // is the sequence and not an opening special case. Boggs says his piece on the
  // flying screen and the skull that names where you are going comes after him.
  // the stage's own queue, in its own order — which is not the same order in
  // every chapter, and includes the opener on the four stages that have one
  for (const reel of brief.films) await ui.film(reel);
  await loadLevel(next);
  setAdvancing(false);
}

/** true while the credits are running, so a probe can see the ending happen */
export let ended = false;

/**
 * Has the goal appeared? `0x46b1b0` in the engine, and it latches for the same
 * reason: the goal is spawned once, when the quota is first met, and stays.
 */
export let goalOpen = false;

/**
 * The flying television, once the quota lets it in.
 *
 * `0x410170` mode −1 puts it at `(pointY − 180, pointX)` off the level's own
 * `goal` record — a hundred and eighty pixels up, in the air — facing the way the
 * record's `param` says, and `0x410480` flies it down, hovers it, and opens it
 * when the player is standing in the rect. {@link file://../effects.ts} has the
 * disassembly. `null` until the census falls to the allowance.
 */
export let craft: {
  x: number;
  /** where it is now, and where it is coming down to */
  y: number;
  restY: number;
  facing: number;
  /** hover | open, and how many engine frames into it */
  state: "hover" | "open";
  clock: number;
  /** the bob: `[0x46ba0c]`, reversed each time the offset passes five */
  drift: number;
  bobbed: number;
  /** the stage-end tally while it runs — see {@link startTally} */
  tally?: { dial: number; frames: number };
  /** ...and once it has run: `[0x46ba10]`, the flag the stage end waits for */
  tallied?: boolean;
} | null = null;

/**
 * Bring the craft in, fly it down, bob it, and open it when the player arrives.
 *
 * The order is `0x410480`'s: sink while it is above its rest height, otherwise
 * bob and test. The test is three things — `0x434200(player, rect)` for the goal
 * RECT, `0x42fad0(craft, 300, 200)` for the craft itself, and `0x402f60`, the
 * player not dying — so the rect the disc draws is still what you walk into,
 * and the thing you walk to is over it.
 */
export function stepCraft(): void {
  const g = solids().goal;
  if (!g || !level) return;
  if (!craft && goalReady()) {
    craft = {
      x: g.pointX,
      y: g.pointY - CRAFT.above,
      restY: g.pointY,
      // the record's `param` is 0 or 1 and this is the only thing in the engine
      // that reads it: `0x450060` keeps it and `0x410170` stores it as the
      // object's facing
      facing: g.param ? 1 : -1,
      state: "hover",
      clock: 0,
      drift: CRAFT.bob,
      bobbed: 0,
    };
    // `0x41020a`..`0x410230` — the hum's record armed to loop as it is made
    sound?.loop(CRAFT.hum[CHARACTER], true, true);
  }
  if (!craft) return;
  craft.clock += TICK_SCALE;
  // `0x4105d7`..`0x4105ef` — its hum, asked for every frame of kind 1, which
  // is all of the craft's life at a goal: through `0x40ef30`, so the mixer
  // turns the ask away while the hum still sounds — the loop armed above keeps
  // it sounding — and each ask moves it to where the craft now is
  const onFrame = Math.floor(craft.clock) !== Math.floor(craft.clock - TICK_SCALE);
  if (onFrame) sound?.own(CRAFT.hum[CHARACTER], craft.x, craft.y);
  if (craft.state === "open") {
    // `0x41073c`..`0x41074d` — the screen's last cel has run out and the flag
    // is not yet up: the tally, before anything else
    if (!craft.tallied && !craft.tally && craft.clock >= CRAFT.open.cels.length * CRAFT.open.hold)
      startTally(craft);
    return;
  }
  if (craft.y < craft.restY) {
    craft.y = Math.min(craft.restY, craft.y + CRAFT.sink * TICK_SCALE);
    return;
  }
  // the hover: two pixels a frame, turned round whenever it has drifted five
  if (Math.abs(craft.bobbed) > CRAFT.bobSpan) craft.drift = -craft.drift;
  craft.bobbed += craft.drift * TICK_SCALE;
  craft.y += craft.drift * TICK_SCALE;
  const box = playerBox();
  const inRect =
    box.right > g.left &&
    box.left < g.right &&
    box.bottom > g.top &&
    box.top < g.bottom;
  const close =
    Math.abs(p.x - craft.x) <= CRAFT.near.x &&
    Math.abs(p.y - craft.y) <= CRAFT.near.y;
  // ...and `0x4106a3` asks `0x402f60` last: the player's kind under 0x1a, both
  // characters alike (`0x402f79`, `0x402f8a`) — which is every state but the
  // two dying ones, a jump or a knockdown included. A dying player does not
  // open it
  if (inRect && close && leftGoal && p.act !== "dying") {
    craft.state = "open";
    craft.clock = 0;
    // `0x4106c1`..`0x4106d9` — the screen's own sound as it starts down, and
    // `0x4106f8` takes the hum's loop flag off again
    sound?.own(CRAFT.opens[CHARACTER], craft.x, craft.y);
    sound?.loop(CRAFT.hum[CHARACTER], false, true);
    // `0x410702` — `0x402e30(0)`: the keys are dropped and shut out until the
    // tally has run, so the player stands at the goal while the screen comes down
    setInput(false);
  }
}

/**
 * Has the screen finished coming down — `[0x46ba10]`, and the stage is over.
 * The tally ({@link startTally}) runs first, and the flag goes up after it.
 */
export function craftOpened(): boolean {
  return craft?.state === "open" && !!craft.tallied;
}

/**
 * The stage-end tally — `0x40ffe0`, which the craft's think calls the frame the
 * screen's last cel runs out (`0x41074d`) and before it raises `[0x46ba10]`.
 * It is called from `0x410480` alone, and every chapter's goal (`0x415f50`,
 * `0x421900`, `0x43b950`, `0x450190`) makes its craft through `0x410170`, so
 * every stage ends through it.
 *
 * It is a loop of its own that the rest of the game waits on. `0x40e120(1)`
 * puts the panel up if it was down. Then, from the dial's cel as `0x40d250`
 * last left it (`[0x4a4d60]`, `0x410026`) up to the empty 12717 (`0x410030`,
 * `0x41011e`): the dial is drawn on that cel (`0x410061`), and ten times
 * (`0x41004b`) a hundred goes on the score (`0x410072`), the score is drawn
 * again (`0x4100b0`), the character's own 0x1f — 0x18 for the second — plays
 * through `0x40f110` (`0x410109`), and `0x40e4f0` spins until four sixtieths
 * have passed: one engine frame (`0x40e50f`). So a thousand a step and ten
 * frames a step, with nothing else moving and no key read. Then the empty dial
 * (`0x41014f`), and the clock is set to 32000 (`0x410154`).
 *
 * The dial it counts from is the one on show, and past step 12 that flashes:
 * `0x40d2b3` puts the empty 12717 in `[0x4a4d60]` every other frame, and a
 * stage finished on one of those frames tallies nothing.
 *
 * Back in the think, `0x402e30(1)` opens the keys the opening shut
 * ({@link inputOpen}) and clears them (`0x402db0`), and the flag goes up
 * (`0x410759`); `0x410370` sees it the next frame and the stage ends.
 */
function startTally(c: NonNullable<typeof craft>): void {
  setIface(true);
  const dial = dialCel(stats.ticks);
  if (dial >= HUD_CEL.dialOff) endTally(c);
  else c.tally = { dial, frames: 0 };
}

/** one frame of the tally — see {@link startTally} */
export function stepTally(c: NonNullable<typeof craft>): void {
  const t = c.tally!;
  stats.score += CRAFT.tally.points;
  sound?.own(CRAFT.tally.sound[CHARACTER], p.x, p.y, "renew");
  t.frames += 1;
  if (t.frames >= (HUD_CEL.dialOff - t.dial) * CRAFT.tally.perStep) endTally(c);
}

function endTally(c: NonNullable<typeof craft>): void {
  c.tally = undefined;
  // `0x410154` — no limit, and the dial shows it empty
  stats.ticks = CLOCK.noLimit;
  // `0x410754` — `0x402e30(1)`: the keys open again, dropped as they open
  setInput(true);
  c.tallied = true;
}

/** the dial while the tally drives it, or undefined — `0x410061` */
export function tallyDial(): number | undefined {
  const t = craft?.tally;
  return t ? t.dial + Math.floor(Math.max(0, t.frames - 1) / CRAFT.tally.perStep) : undefined;
}

/**
 * Has the player been anywhere but inside the goal since the level loaded?
 *
 * Without this latch a level whose quota is already met and whose spawn point
 * falls inside its own goal rect opens the television on the frame it loads —
 * `arcade` does exactly that, because none of the classes this page can draw
 * stand in it, so its census is zero. Standing where the craft is about to
 * arrive is not walking up to it.
 */
export let leftGoal = false;
export let sink: AudioSink = new DeferredAudioSink();
export let audioLive = false;

export function wakeAudio(): void {
  // the level's own sound wants the same gesture the films' bed does, and it can
  // be asked more than once: the context may not exist yet the first time
  sound?.resume();
  if (audioLive) return;
  audioLive = true;
  const real = new WebAudioSink();
  (sink as DeferredAudioSink).attach?.(real);
  sink = real;
}

/**
 * The PAUSE PANEL — one film a chapter, three buttons, and the game's own save.
 *
 * `0x403c7b` is the only caller of `0x404280`, and two keys reach it. The key
 * dispatcher uppercases a letter and then splits on the event record's modifier
 * word (`0x403c40`, `test ..., 0x1fa0`): zero goes to the ordinary game binding
 * through `0x46b210`, and nonzero goes to a second table at `0x403ea4`, where
 * only five characters are bound at all —
 *
 * ```
 *   '.'  0x2e  -> 0x403c7b   the panel        'P'  0x50 -> 0x403ce8
 *   'Q'  0x51  -> 0x403c7b   the panel        'T'  0x54 -> 0x403cfb
 *   '0'..'9'   -> 0x403cd2
 * ```
 *
 * — and on the PC the modifier word is not the Macintosh one it looks like.
 * `0x405787` asks `GetKeyState(VK_CONTROL)` and `0x4057a5` sets the word to
 * `0x1fa0` entire when the answer is down, leaving it zero otherwise. So the
 * mask is one bit of information and the panel's keys are **Ctrl+Q** and
 * **Ctrl+.** — not ESC, which is below the first table's range and does nothing
 * in a level. ESC is bound here as well because it is what a browser reader will
 * press, and because nothing else in this page wants it.
 *
 * ## Which film, and what is in it
 *
 * `0x4042af` picks by chapter, `[0x4abdfe] - 3`, and all four are one shape:
 * frames "X 3".."X 59" loop (the last is a type-2 frame targeting "X 3") with
 * three regions live the whole way, and the last three frames of the file are
 * the answers. Which answer is which is in the segment header, not in the
 * picture: `actionFrame1` names the MIDDLE button and `actionFrame2` the BOTTOM
 * one, and the top button is named by neither.
 *
 * ```
 *   pauseA   loop 3..59    actionframes "pauseA 61" "pauseA 62"
 *   pauseB   loop 3..120   actionframes "PauseB 122" "PauseB 123"
 *   pauseC   loop 3..59    actionframes "PauseC 61" "PauseC 62"
 *   pauseD   loop 3..89    actionframes "PauseD 91" "PauseD 92"
 * ```
 *
 * `0x449fbb` compares the playing frame against each name and calls
 * `0x45e1e0(1)` or `(2)`; that handler, while the shell state is 4 — which
 * `0x404280` sets on the way in — takes argument 2 to `[0x46b208] = 5` and
 * anything else to `GetSaveFileNameA`. So:
 *
 * ```
 *   top     no actionframe   the film just ends    ->  RESUME
 *   middle  actionframe 1    0x45e1e0(1)           ->  SAVE
 *   bottom  actionframe 2    0x45e1e0(2)           ->  QUIT the level
 * ```
 *
 * and `0x404303` closes it: state 5 leaves the level, anything else redraws
 * (`0x40cf00`) and plays on. There is no Load here — Load is the TITLE screen's
 * own button, `0x45df8d`.
 */
export const PAUSE = {
  /** `0x4042af`'s jump table, in chapter order */
  films: ["pauseA.mov", "pauseB.mov", "pauseC.mov", "pauseD.mov"],
  /** the second key table at `0x403ea4`, and both of these want Ctrl */
  keys: ["q", "."] as readonly string[],
  from: "0x403c7b -> 0x404280, films by [0x4abdfe] - 3",
} as const;

/** the standable, solid and climbable things standing inside one room */
export function solidsIn(sbk: SbkFile, room: SbkRoom): Solids {
  const mine = sbk.entities.filter((e) => {
    if (!e.isEntity) return false;
    const y = (e.top + e.bottom) >> 1;
    const x = (e.left + e.right) >> 1;
    return (
      y >= room.top && y <= room.bottom && x >= room.left && x <= room.right
    );
  });
  return {
    platforms: mine.filter((e) => e.name === "platform").map((e) => ({ ...e })),
    obstacles: mine.filter((e) => e.name === "obstacle"),
    goal: mine.find((e) => e.name === "goal"),
  };
}

/** which chapter's entry function has already run — see {@link CHAPTER_WEAPON} */
export let chapterWeapon: number | null = null;


/**
 * The goal, once a tick: a player who has stepped out of its rect since the
 * level began may be let in by it ({@link leftGoal}), and a craft that has
 * opened for them ends the level.
 */
export function stepGoal(): void {
  const goal = solids().goal;
  const box = playerBox();
  const inGoal =
    goal !== undefined &&
    box.right > goal.left &&
    box.left < goal.right &&
    box.bottom > goal.top &&
    box.top < goal.bottom;
  if (!inGoal) leftGoal = true;
  if (craftOpened() && !advancing) void nextLevel();
}
