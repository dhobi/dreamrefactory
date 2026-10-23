/**
 * The level's own machinery (`src/world/fixtures.ts`) stepped a frame at a
 * time on a level stood up from the rip: TOWER's floors and surges, MAZE's cage
 * doors, SEWER's doors and CAVERN's bridges — the states the playthroughs walk
 * past rather than through.
 *
 *   npx vitest run skullcracker/tests/world-fixtures.ts
 *
 * Each is a small state machine with its addresses in `src/props.ts`; here the
 * player is PUT where a state's test reads him and the step is called on its
 * own, so the test asserts the hand-over the address names.
 *
 * Needs the rip; skipped without it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { BRIDGE, CAGE, FLOOR, HOLE, PLANK, SURGE, type Floor } from "../src/props";
import { haveRip, headless, recordSound, type Game, type Headless } from "./machine/harness";

let h: Headless;
let g: Game;

async function boot(query: string): Promise<void> {
  if (!h) h = await headless(query);
  else await h.load(query);
  g = h.game;
}

describe.skipIf(!haveRip())("TOWER's floors (0x426f80)", () => {
  beforeEach(() => boot("level=12"));

  /** the first floor, the player put in its room and `dx` from it */
  function floor(dx: number): Floor {
    const i = g.level!.floors.findIndex((r) => r.length);
    const f = g.level!.floors[i][0];
    g.p.room = g.level!.rooms[i];
    g.p.x = f.x + dx;
    g.p.y = f.y + g.p.feet;
    return f;
  }

  it("settles under him and runs its grace down while he is away, whole again past it with five (0x427017, 0x42703e)", () => {
    const f = floor(FLOOR.nearPx + 10);
    f.state = "settling";
    f.grace = 1;
    g.stepFloors();
    expect(f.state).toBe("settling");
    expect(f.grace).toBe(0);
    g.stepFloors();
    expect(f.state).toBe("whole");
    expect(f.grace).toBe(FLOOR.regrace);
  });

  it("creaks after four frames of him near it, with the creak (0x4270a0)", () => {
    const f = floor(0);
    f.state = "settling";
    f.clock = 0;
    const heard = recordSound(g);
    for (let i = 0; i < FLOOR.holdFrames - 1; i++) g.stepFloors();
    expect(f.state).toBe("settling");
    g.stepFloors();
    expect(f.state).toBe("creaking");
    expect(heard.filter((c) => c.call === "effect")).toHaveLength(1);
  });

  it("caves in at the end of the creak with him on it, and settles again with him gone (0x4270b3)", () => {
    const f = floor(0);
    f.state = "creaking";
    f.clock = FLOOR.creaking.cels.length * FLOOR.creaking.hold;
    g.stepFloors();
    expect(f.state).toBe("caving");
    const away = floor(FLOOR.nearPx + 1);
    away.state = "creaking";
    away.clock = FLOOR.creaking.cels.length * FLOOR.creaking.hold;
    g.stepFloors();
    expect(away.state).toBe("settling");
  });

  it("falls at thirty a frame from its third cel, carrying the platform it owns, and is gone when the cave ends (0x4270f9)", () => {
    const f = floor(5_000);
    const i = g.level!.floors.findIndex((r) => r.includes(f));
    f.state = "caving";
    f.clock = 2;
    const y = f.y;
    const owned = g.level!.solids[i].platforms.find((q) => f.x >= q.left && f.x < q.right && f.y >= q.top && f.y < q.bottom);
    const top = owned?.top;
    g.stepFloors();
    expect(f.vy).toBe(FLOOR.gravity);
    expect(f.y).toBe(y);
    g.stepFloors();
    expect(f.y).toBe(y + FLOOR.gravity);
    if (owned) expect(owned.top).toBe(top! + FLOOR.gravity);
    f.clock = FLOOR.caving.cels.length;
    g.stepFloors();
    expect(f.state).toBe("gone");
  });

  it("shows the whole cel settling, the creak, the cave by its clock, and its last cel once gone", () => {
    const f = floor(0);
    f.state = "settling";
    expect(g.floorCel(f)).toBe(FLOOR.whole);
    f.state = "creaking";
    f.clock = 1;
    expect(g.floorCel(f)).toBe(FLOOR.creaking.cels[1]);
    f.state = "caving";
    f.clock = 3;
    expect(g.floorCel(f)).toBe(FLOOR.caving.cels[3]);
    f.state = "gone";
    expect(g.floorCel(f)).toBe(FLOOR.caving.cels.at(-1));
  });
});

describe.skipIf(!haveRip())("TOWER's surges (0x426a70)", () => {
  beforeEach(() => boot("level=12"));

  it("loads thirteen rounds into the scepter held out near the arc, and nothing into fists (0x426ad4)", () => {
    const q = g.level!.surges.flat()[0];
    q.on = true;
    q.clock = 0;
    q.y = q.top + 50;
    g.p.x = q.left;
    g.p.y = q.y + g.p.feet;
    g.inv.weapon = SURGE.weapon;
    g.inv.rounds[SURGE.weapon] = 0;
    g.inv.drawn = false;
    g.stepSurges();
    expect(g.inv.rounds[SURGE.weapon]).toBe(0);
    g.inv.drawn = true;
    q.clock = 0;
    g.stepSurges();
    expect(g.inv.rounds[SURGE.weapon]).toBe(SURGE.rounds);
  });

  it("hops seventy-five down its column at the end of the arc, and goes off at the bottom, letting the loop go (0x426b2c, 0x426b66)", () => {
    const q = g.level!.surges.flat()[0];
    q.on = true;
    q.y = q.top;
    q.clock = SURGE.arc.cels.length * SURGE.arc.hold;
    g.stepSurges();
    expect(q.y).toBe(q.top + SURGE.hop);
    expect(q.clock).toBe(0);
    q.y = q.bottom;
    q.clock = SURGE.arc.cels.length * SURGE.arc.hold;
    const heard = recordSound(g);
    g.stepSurges();
    expect(q.on).toBe(false);
    expect(q.y).toBe(q.top);
    expect(heard).toContainEqual({ call: "loop", args: [SURGE.sound, false] });
  });
});

describe.skipIf(!haveRip())("MAZE's cage doors (0x413100, 0x413410)", () => {
  beforeEach(() => boot("level=13"));

  it("opens a shut cage and shuts an open one on its number, with 0x21, and leaves a moving one alone (0x413440)", () => {
    const c = g.level!.cages.flat()[0];
    const heard = recordSound(g);
    c.state = "shut";
    g.broadcast(c.param);
    expect(c.state).toBe("opening");
    g.broadcast(c.param);
    expect(c.state).toBe("opening");
    c.state = "open";
    g.broadcast(c.param);
    expect(c.state).toBe("closing");
    expect(heard.filter((x) => x.call === "effect" && x.args[0] === CAGE.toggle && x.args[1] === c.x)).toHaveLength(2);
  });

  it("hands its moving tags over as they end, sounding 0x22 only as it shuts (0x413100)", () => {
    const c = g.level!.cages.flat()[0];
    const heard = recordSound(g);
    c.state = "opening";
    c.clock = CAGE.opening.cels.length * CAGE.opening.hold - 1;
    g.stepCages();
    expect(c.state).toBe("open");
    expect(heard).toEqual([]);
    c.state = "closing";
    c.clock = 0;
    for (let i = 0; i < CAGE.closing.cels.length * CAGE.closing.hold; i++) g.stepCages();
    expect(c.state).toBe("shut");
    expect(heard.map((x) => x.args[0])).toEqual([CAGE.sound]);
  });

  it("draws the shut cel, nothing open, and each moving tag by its clock", () => {
    const c = g.level!.cages.flat()[0];
    c.state = "shut";
    expect(g.cageCel(c)).toBe(CAGE.shut);
    c.state = "open";
    expect(g.cageCel(c)).toBe(0);
    c.state = "opening";
    c.clock = CAGE.opening.hold;
    expect(g.cageCel(c)).toBe(CAGE.opening.cels[1]);
    c.state = "closing";
    c.clock = 0;
    expect(g.cageCel(c)).toBe(CAGE.closing.cels[0]);
  });
});

describe.skipIf(!haveRip())("SEWER's doors (0x43c430)", () => {
  it("shuts an open door on its number, and leaves one already moving alone", async () => {
    await boot("level=7");
    const d = g.level!.doors.flat()[0];
    d.state = "open";
    g.broadcast(d.param);
    expect(d.state).toBe("closing");
    g.broadcast(d.param);
    expect(d.state).toBe("closing");
  });
});

describe.skipIf(!haveRip())("CAVERN's bridges (0x422370)", () => {
  beforeEach(() => boot("level=10"));

  it("shows the rock and the fall by their clocks, and the gone tags frame by frame", () => {
    const b = g.level!.bridges.flat()[0];
    b.state = "rocking";
    b.clock = 1;
    expect(g.bridgeCel(b)).toBe(BRIDGE.rocking.cels[1]);
    b.state = "falling";
    b.clock = 3;
    expect(g.bridgeCel(b)).toBe(BRIDGE.falling.cels[1]);
    b.state = "gone";
    b.clock = 2;
    expect(g.bridgeCel(b)).toBe(BRIDGE.gone.cels[2]);
    b.clock = 50;
    expect(g.bridgeCel(b)).toBe(BRIDGE.gone.cels.at(-1));
  });

  it("once gone it drops at ten a frame more each frame, carrying its rect (0x42249c, 0x43032b)", () => {
    const i = g.level!.bridges.findIndex((r) => r.length);
    const b = g.level!.bridges[i][0];
    g.p.room = g.level!.rooms[i];
    g.p.x = b.x;
    g.p.y = b.y - 1000;
    b.state = "gone";
    b.clock = 0;
    b.vy = 0;
    const y = b.y;
    const top = b.top;
    g.stepBridges();
    expect(b.y).toBe(y);
    g.stepBridges();
    expect(b.y).toBe(y + BRIDGE.gravity);
    expect(b.top).toBe(top + BRIDGE.gravity);
  });
});

describe.skipIf(!haveRip())("CITY's planks (0x4531d0)", () => {
  beforeEach(() => boot("level=2"));

  /** the first plank, falling `vy` raw units a tick, its foot `gap` above the floor under it */
  function falling(vy: number, gap: number) {
    g.p.room = g.level!.rooms[0];
    const k = g.level!.planks[0].find((q) => g.groundAt(q.x) !== null)!;
    const rec = g.celRec(g.level!.sbk, 1054)!;
    const ground = g.groundAt(k.x)!;
    k.state = "fall";
    k.clock = 0;
    k.landed = false;
    k.vy = vy;
    k.y = ground - (rec.height - rec.posY) - gap;
    return { k, ground, rec };
  }

  it("lands on the floor under it, keeping a quarter of a landing faster than two a frame (0x42ff5d)", () => {
    const { k, ground, rec } = falling(40, 1);
    g.stepPlanks();
    expect(k.landed).toBe(true);
    expect(k.y + rec.height - rec.posY).toBe(ground);
    expect(k.vy).toBeGreaterThan(0);
  });

  it("stops dead on a landing slower than that, and then lies there (0x42ff5d)", () => {
    // the frame's pull (30 over sixteen) brings -1.5 to 0.375 a tick: 1.5 a frame
    const { k } = falling(-1.5, 0);
    g.stepPlanks();
    expect(k.landed).toBe(true);
    expect(k.vy).toBe(0);
    const y = k.y;
    g.stepPlanks();
    expect(k.y).toBe(y);
  });

  it("drops a rider's crossing count by one each sag, and falls with 0x3 on the sixth (0x4532a7, 0x45323f)", () => {
    g.p.room = g.level!.rooms[0];
    const k = g.level!.planks[0][0];
    k.state = "intact";
    k.crossings = PLANK.crossings + 1;
    g.p.x = (k.left + k.right) / 2;
    g.p.y = k.y - 10 + g.p.feet;
    g.p.onGround = true;
    g.p.fallPx = 0;
    const heard = recordSound(g);
    g.stepPlanks();
    expect(k.state).toBe("fall");
    expect(heard).toContainEqual({ call: "effect", args: [PLANK.sound, k.x, k.y] });
  });
});

describe.skipIf(!haveRip())("GRAVE's holes (0x421083)", () => {
  beforeEach(() => boot("level=9"));

  function hole() {
    const i = g.level!.holes.findIndex((r) => r.length);
    g.p.room = g.level!.rooms[i];
    return g.level!.holes[i][0];
  }

  it("shuts again if he is out past a hundred before it opens (0x421189)", () => {
    const h = hole();
    h.state = "near";
    g.p.x = h.x + HOLE.nearPx + 1;
    g.stepHoles();
    expect(h.state).toBe("shut");
  });

  it("opens under one more than fifty below its point with its sound, halving his speed (0x4211af, 0x4211c4)", () => {
    const h = hole();
    h.state = "near";
    g.p.x = h.x;
    g.p.y = h.y + HOLE.soundBelowPx + 1 + g.p.feet;
    g.p.vx = 8;
    const heard = recordSound(g);
    g.stepHoles();
    expect(h.state).toBe("opening");
    expect(g.p.vx).toBe(4);
    expect(heard).toContainEqual({ call: "effect", args: [HOLE.openSound, h.x, h.y] });
  });

  it("lays its lid once, however often it is asked (0x421470)", () => {
    const h = hole();
    h.lid = false;
    const i = g.level!.rooms.indexOf(g.p.room!);
    const n = g.level!.solids[i].platforms.length;
    g.layGraveLid(h);
    g.layGraveLid(h);
    expect(g.level!.solids[i].platforms).toHaveLength(n + 1);
  });
});

describe.skipIf(!haveRip())("held (0x428570)", () => {
  it("P turns the hold's loop into the struggle, and does nothing more once he is struggling (0x4286bb)", async () => {
    await boot("level=9");
    g.p.heldBy = () => ({ x: g.p.x, y: g.p.y - g.p.feet });
    g.p.act = "held";
    g.setPunchPressed(true);
    g.stepHeld();
    expect(g.p.act).toBe("struggle");
    g.p.actClock = 5;
    g.stepHeld();
    expect(g.p.actClock).toBe(5);
    g.setPunchPressed(false);
    g.p.heldBy = null;
    g.p.act = null;
  });
});

describe.skipIf(!haveRip())("MAZE's levers (0x412550)", () => {
  it("throws one off without a sound of its own", async () => {
    await boot("level=13");
    const s = g.level!.switches.flat()[0];
    expect(s.maze).toBe(true);
    s.state = "on";
    const heard = recordSound(g);
    expect(g.throwSwitch(s, 1)).toBe(true);
    expect(s.state).toBe("turningOff");
    expect(heard).toEqual([]);
  });
});
