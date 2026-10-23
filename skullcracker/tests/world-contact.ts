/**
 * Who hits whom (`src/world/contact.ts`), one hit pass at a time: the player's
 * blow on a crow, a head and Boggs, the creatures' and the furniture's blows on
 * him, a bolt and a flare on whatever stands in their way.
 *
 *   npx vitest run skullcracker/tests/world-contact.ts
 *
 * The machine suites play these inside a level, where who stands where is up
 * to the dice; here the level is stood up from the rip and then the meeting is
 * PLACED — the hitter's cel box laid over the victim's — and the pass called
 * on its own (`landHits`, `takeHits`, `foesStrikeFoes`, `boltHits`,
 * `flareHits`), so each arm of `0x430350`'s dispatcher is taken on purpose and
 * the test asserts what it did to the two of them.
 *
 * Needs the rip; skipped without it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { SbkCelBox } from "@dreamfactory/engine/df/sbk";
import { BOGGS, crowCel, crushCel, ibeamCel, type BoggsWorm, type Head } from "../src/props";
import type { CastKit, Enemy } from "../src/brains/kit";
import { WEREC_SHOT } from "../src/brains/werec";
import { HARDCORE_THROW } from "../src/brains/hardcore";
import { WBOOLY_HIGH } from "../src/brains/wbooly";
import { FLARE } from "../src/guns";
import type { Cast, RollerBody } from "../src/world/casts";
import { haveRip, headless, recordSound, type Game, type Headless } from "./machine/harness";

let h: Headless;
let g: Game;

/** stand a level up, with the switches a probe would put in its URL */
async function boot(query: string): Promise<void> {
  if (!h) h = await headless(query);
  else await h.load(query);
  g = h.game;
  g.struck.clear();
  g.struckCrows.clear();
  g.struckHeads.clear();
  g.struckBoggs.clear();
}

/** the first of the player's cels that is an impact frame: a strike box, a blow pair and a body */
function strikingCel(): number {
  for (let id = 0; id < 10_000; id++) {
    const r = g.celRec(g.player!, id);
    if (r?.strike && r.blow && r.body) return id;
  }
  throw new Error("no impact cel");
}

/** the player mid-punch on {@link strikingCel}, facing east; answers his strike box */
function swinging() {
  g.p.act = "punch";
  g.p.facing = 1;
  g.p.vx = 0;
  g.p.vyRaw = 0;
  g.setLastCel(strikingCel());
  const box = g.strikeBox();
  if (!box) throw new Error("no strike box");
  return box;
}

/** the anchor that centres `rect` (a cel's own box about its anchor) on `on` */
function centre(rect: SbkCelBox, on: { left: number; right: number; top: number; bottom: number }) {
  return {
    x: Math.round((on.left + on.right) / 2 - (rect.x0 + rect.x1) / 2),
    y: Math.round((on.top + on.bottom) / 2 - (rect.y0 + rect.y1) / 2),
  };
}

/** move the player so his strike box is centred on `on`, in whatever room holds that */
function aim(on: { left: number; right: number; top: number; bottom: number }) {
  const mine = swinging();
  g.p.x += Math.round((on.left + on.right) / 2 - (mine.left + mine.right) / 2);
  g.p.y += Math.round((on.top + on.bottom) / 2 - (mine.top + mine.bottom) / 2);
  g.p.room = g.level!.rooms.find((r) => g.p.x >= r.left && g.p.x <= r.right) ?? g.p.room;
  return g.strikeBox()!;
}

/** the player standing, no act, his BODY centred on `on`; answers the body box */
function bodyOn(on: { left: number; right: number; top: number; bottom: number }) {
  g.p.act = null;
  g.p.climbing = false;
  g.p.bar = undefined;
  g.p.facing = 1;
  const mine = g.playerBody();
  if (!mine) throw new Error("the standing cel has no body");
  g.p.x += Math.round((on.left + on.right) / 2 - (mine.left + mine.right) / 2);
  g.p.y += Math.round((on.top + on.bottom) / 2 - (mine.top + mine.bottom) / 2);
  g.p.room = g.level!.rooms.find((r) => g.p.x >= r.left && g.p.x <= r.right) ?? g.p.room;
  return g.playerBody()!;
}

/** `0x40e6a2`'s mirror of a rect about the anchor */
function facingRectOf(r: SbkCelBox, west: boolean): SbkCelBox {
  return west ? { ...r, x0: -r.x1, x1: -r.x0 } : r;
}

/** a hitter's strike box, from its cel and its point */
function reach(cel: number, x: number, y: number, facing = 1) {
  const art = g.celRec(g.level!.sbk, cel);
  if (!art?.strike) throw new Error(`cel ${cel} carries no strike box`);
  return g.strikeOf(art, x, y, facing)!;
}

describe.skipIf(!haveRip())("the player's blow (landHits, 0x430350)", () => {
  beforeEach(() => boot("level=2"));

  it("takes a sleeping crow on any blow that reaches its body, once per swing (0x45206f)", () => {
    const mine = swinging();
    const c = g.level!.crows[0][0];
    const body = g.celRec(g.level!.sbk, crowCel(c))!.body!;
    Object.assign(c, centre(body, mine));
    const score = g.stats.score;
    g.landHits();
    expect(c.state).toBe("tumble");
    expect(g.stats.score).toBeGreaterThan(score);
    // a second pass of the same swing does not take it again
    c.state = "sleep";
    g.landHits();
    expect(c.state).toBe("sleep");
  });
});

describe.skipIf(!haveRip())("the player's blow on Boggs (landHits, 0x41aad0)", () => {
  beforeEach(() => boot("level=16"));
  const boggs = () => g.level!.boggs[0][0];

  it("lands once a swing on a machine, which answers with its sound (0x41b53f)", () => {
    const b = boggs();
    const heard = recordSound(g);
    aim(g.machineBox(b, 5)!);
    g.landHits();
    const effects = heard.filter((c) => c.call === "effect").map((c) => c.args[0] as number);
    // 5 + roll(3), and the body's own 0x18 + roll(6) when the fist reaches it too
    expect(effects.some((n) => n >= 6 && n <= 8)).toBe(true);
    expect(g.struckBoggs.has("5")).toBe(true);
    const n = heard.length;
    g.landHits();
    expect(heard).toHaveLength(n);
  });

  it("takes the fist off the body's health, and lets a dying Boggs be", () => {
    const b = boggs();
    const art = g.celRec(g.level!.sbk, g.boggsCel(b))!;
    // the body's drawn extent, well clear of the machines on its east side
    const left = b.x - art.posX;
    const top = b.y - art.posY;
    const mine = aim({ left, right: left + 40, top: top + 40, bottom: top + 80 });
    const hp = b.hp;
    g.landHits();
    expect(b.hp).toBe(hp - mine.damage);
    expect(g.struckBoggs.has("body")).toBe(true);
    g.struckBoggs.clear();
    b.dying = true;
    g.landHits();
    expect(b.hp).toBe(hp - mine.damage);
  });
});

describe.skipIf(!haveRip())("the furniture's blows on the player (takeHits)", () => {
  it("a girder swinging through him knocks him down for its pair's length, 77 (0x4537d0, 0x449115)", async () => {
    await boot("level=2&damage=1");
    const b = g.level!.ibeams[0][0];
    b.delay = 0;
    bodyOn(reach(ibeamCel(b), b.x, b.y));
    const health = g.stats.health;
    g.takeHits();
    // 1544's pair is (0, -77): above 0x3c, the knockdown
    expect(g.stats.health).toBe(health - 77);
    expect(g.p.act).toMatch(/^down/);
  });

  it("a girder still waiting out its delay is not there", async () => {
    await boot("level=2&damage=1");
    const b = g.level!.ibeams[0][0];
    b.delay = 0;
    bodyOn(reach(ibeamCel(b), b.x, b.y));
    b.delay = 5;
    const health = g.stats.health;
    g.takeHits();
    expect(g.stats.health).toBe(health);
    expect(g.p.act).toBeNull();
  });

  it("on a bar he only cries and loses the health, and is knocked off where a room holds him (0x42ebb1, 0x42ed84)", async () => {
    await boot("level=2&damage=1");
    const b = g.level!.ibeams[0][0];
    b.delay = 0;
    bodyOn(reach(ibeamCel(b), b.x, b.y));
    g.p.bar = {} as NonNullable<typeof g.p.bar>;
    g.setKnockedOff(false);
    const health = g.stats.health;
    g.takeHits();
    expect(g.stats.health).toBe(health - 77);
    expect(g.p.act).toBeNull();
    expect(g.knockedOff).toBe(true);
    // ...and out past every room, nothing holds him and the blow is not his
    g.setKnockedOff(false);
    // he and the girder both carried 100,000 west, the room left as it was
    g.p.x -= 100_000;
    b.x -= 100_000;
    const before = g.stats.health;
    g.takeHits();
    expect(g.stats.health).toBe(before - 77);
    expect(g.knockedOff).toBe(false);
    g.p.bar = undefined;
  });

  it("an axe's blade lands its hundred on every tag (0x423d29)", async () => {
    await boot("level=10&damage=1");
    const a = g.level!.axes.flat()[0];
    // the ring of 27 swings through cels with and without a box; one that has one
    while (!g.celRec(g.level!.sbk, g.axeCel(a))?.strike) a.clock++;
    const cel = g.axeCel(a);
    bodyOn(reach(cel, a.x, a.y));
    const health = g.stats.health;
    g.takeHits();
    expect(g.stats.health).toBeLessThan(health);
    expect(g.p.act).not.toBeNull();
  });

  it("the big gun's bolt lands where it stood as the frame began, and is spent by it (0x413bed)", async () => {
    await boot("level=13&damage=1");
    const bolt = { x: 0, y: 0, vx: 100, facing: 1, spent: false, code: 100 as const, age: 3, was: { x: 0, y: 0 } };
    const art = g.celRec(g.level!.sbk, g.boltCel(bolt))!;
    const box = g.strikeOf(art, 0, 0, 1)!;
    const body = bodyOn({ left: 0, right: 1, top: 0, bottom: 1 });
    // the bolt's box over the middle of his body
    bolt.was = { x: Math.round((body.left + body.right) / 2 - (box.left + box.right) / 2), y: Math.round((body.top + body.bottom) / 2 - (box.top + box.bottom) / 2) };
    g.setBolts([bolt]);
    const health = g.stats.health;
    g.takeHits();
    expect(bolt.spent).toBe(true);
    expect(g.stats.health).toBeLessThan(health);
    // a spent one, or a blaster's -1, is passed over
    const after = g.stats.health;
    g.p.act = null;
    g.takeHits();
    expect(g.stats.health).toBe(after);
  });

  it("VAT's wrecking ball hits with its cel's own pair at a hundred (0x41a89e)", async () => {
    await boot("level=16&damage=1");
    const f = g.level!.fittings.flat().find((q) => q.kind === "ball")!;
    bodyOn(reach(g.fittingCel(f), f.x, f.y));
    const health = g.stats.health;
    g.takeHits();
    expect(g.stats.health).toBeLessThan(health);
  });

  it("a press in its stroke that does not reach him lands nothing (0x454a38)", async () => {
    await boot("level=3&damage=1");
    const c = g.level!.crushes.flat()[0];
    c.state = "slam";
    c.clock = 0;
    // only two of its cels carry a box; step the stroke's clock to one
    while (!g.celRec(g.level!.sbk, crushCel(c))?.strike) c.clock++;
    const box = reach(crushCel(c), c.x, c.y);
    bodyOn({ left: box.right + 400, right: box.right + 401, top: box.top, bottom: box.top + 1 });
    const health = g.stats.health;
    g.takeHits();
    expect(g.stats.health).toBe(health);
  });
});

/** a cast of `kit` with its strike box laid over the player's body */
function castOnHim(kit: CastKit, over: Partial<Cast> = {}): Cast {
  const c: Cast = { kit, x: 0, y: 0, vx: 0, vy: 0, facing: 1, clock: 0, bornX: 0, bornY: 0, armed: true, fromX: 0, fromY: 0, spent: false, ...over };
  const body = g.playerBody()!;
  const art = g.celRec(g.level!.sbk, g.castCel(c));
  if (!art?.strike) throw new Error(`cast cel ${g.castCel(c)} carries no strike box`);
  Object.assign(c, centre(art.strike, body));
  return c;
}

describe.skipIf(!haveRip())("what the creatures throw (takeHits' thrown pass)", () => {
  it("a dud meeting him bursts there, and the burst is the blow: 0x65, the pair unscaled (0x452e00, 0x452ec0)", async () => {
    await boot("level=3&damage=1&foehit=1");
    bodyOn({ left: g.p.x, right: g.p.x + 1, top: g.p.y - 60, bottom: g.p.y - 59 });
    const c = castOnHim(WEREC_SHOT);
    g.setCasts([c]);
    const health = g.stats.health;
    g.takeHits();
    expect(c.landed).toBe(0);
    expect(c.vx).toBe(0);
    // the flight's cel carries no pair, so meeting him is the landing and no more
    expect(g.stats.health).toBe(health);
    Object.assign(c, centre(g.celRec(g.level!.sbk, 7000)!.strike!, g.playerBody()!));
    g.takeHits();
    // 7000's pair, whole and with nothing of the shot's own speed in it
    const pair = g.celRec(g.level!.sbk, 7000)!.blow!;
    expect(health - g.stats.health).toBe(Math.floor(Math.hypot(pair.dx, pair.dy)));
    g.setCasts([]);
  });

  it("a hardcore's throw that hits flies on worth nothing, where any other is spent (0x43c866)", async () => {
    await boot("level=6&damage=1&foehit=1");
    const c = castOnHim(HARDCORE_THROW, { vx: 30 });
    g.setCasts([c]);
    const health = g.stats.health;
    g.takeHits();
    expect(c.struck).toBe(true);
    expect(c.spent).toBe(false);
    expect(g.stats.health).toBeLessThan(health);
    // ...and on the next pass it is worth nothing at all
    g.p.act = null;
    const after = g.stats.health;
    g.takeHits();
    expect(g.stats.health).toBe(after);
    g.setCasts([]);
  });

  it("a cast that has already met something, and is no dud, is passed over", async () => {
    await boot("level=6&damage=1&foehit=1");
    const c = castOnHim(HARDCORE_THROW, { vx: 30 });
    c.landed = 0;
    g.setCasts([c]);
    const health = g.stats.health;
    g.takeHits();
    expect(g.stats.health).toBe(health);
    g.setCasts([]);
  });

  it("a roller hits only once it is rolling fast, with its own speed over its divisor (0x43a993, 0x43aa34)", async () => {
    await boot("level=5&damage=1&foehit=1");
    const r: RollerBody = { x: 0, y: 0, vx: -480, wait: -1, clock: 0, vy: 0, launch: 0, still: false };
    const art = g.celRec(g.level!.sbk, g.rollerCel(r))!;
    Object.assign(r, centre(facingRectOf(art.strike!, true), g.playerBody()!));
    g.setRollers([r]);
    expect(g.rollerBlow(r)).toBeGreaterThan(0);
    const health = g.stats.health;
    g.takeHits();
    expect(g.stats.health).toBeLessThan(health);
    // ...and still waiting to be launched it is nothing
    g.p.act = null;
    r.wait = 5;
    const after = g.stats.health;
    g.takeHits();
    expect(g.stats.health).toBe(after);
    g.setRollers([]);
  });

  it("Boggs' worms lie in wait at a hundred (0x41adf9)", async () => {
    await boot("level=16&damage=1&foehit=1");
    const b = g.level!.boggs[0][0];
    g.p.room = g.level!.rooms[0];
    // the strike: 5661 carries a box and no pair, and a worm does not move, so
    // it touches him for nothing; 5666 is the first with a pair, (-34, 13)
    bodyOn({ left: b.x - 300, right: b.x - 299, top: b.y, bottom: b.y + 1 });
    const m: BoggsWorm = { x: 0, y: 0, kind: 2, clock: 1 };
    Object.assign(m, centre(g.celRec(g.level!.sbk, 5661)!.strike!, g.playerBody()!));
    b.worms.push(m);
    const health = g.stats.health;
    g.takeHits();
    expect(g.stats.health).toBe(health);
    m.clock = 6;
    Object.assign(m, centre(g.celRec(g.level!.sbk, g.boggsWormCel(m))!.strike!, g.playerBody()!));
    g.takeHits();
    expect(health - g.stats.health).toBe(Math.floor(Math.hypot(34, 13)));
    b.worms.length = 0;
  });
});

describe.skipIf(!haveRip())("the codes, with the damage switch off (takeHits' first pass)", () => {
  it("TOWER's surge holds him on -4 while it is on, and is nothing while it is off (0x426a90, 0x426b78)", async () => {
    await boot("level=12");
    const q = g.level!.surges.flat()[0];
    const i = g.level!.surges.findIndex((r) => r.includes(q));
    q.on = true;
    const art = g.celRec(g.level!.sbk, g.surgeCel(q))!;
    g.p.room = g.level!.rooms[i];
    bodyOn(g.strikeOf(art, q.x, q.y, 1)!);
    g.p.room = g.level!.rooms[i];
    q.on = false;
    const health = g.stats.health;
    g.takeHits();
    expect(g.p.act).toBeNull();
    q.on = true;
    g.takeHits();
    // a code: the reaction, and not a point of health
    expect(g.p.act).not.toBeNull();
    expect(g.stats.health).toBe(health);
  });

  it("Boggs' first machine, armed, lands -1 on him and is disarmed by it (0x41b022, 0x43045d)", async () => {
    await boot("level=16");
    const b = g.level!.boggs[0][0];
    g.p.room = g.level!.rooms[0];
    const m = b.machines[0];
    const art = g.celRec(g.level!.sbk, BOGGS.zap.cel)!;
    bodyOn(g.strikeOf(art, m.x, m.y, 1)!);
    g.p.room = g.level!.rooms[0];
    b.zap.armed = true;
    g.takeHits();
    expect(b.zap.armed).toBe(false);
    expect(g.p.act).not.toBeNull();
  });
});

describe.skipIf(!haveRip())("the crows' dives (takeHits' creature pass)", () => {
  it("a diving crow that touches him is marked, and its own speed is the blow (0x45206f, 0x430663)", async () => {
    await boot("level=2&damage=1&foehit=1");
    const c = g.level!.crows[0][0];
    c.state = "strike";
    c.tag = 1;
    c.clock = 1;
    c.vx = 70;
    c.vy = 20;
    const art = g.celRec(g.level!.sbk, crowCel(c))!;
    bodyOn({ left: c.x, right: c.x + 1, top: c.y, bottom: c.y + 1 });
    Object.assign(c, centre(art.strike!, g.playerBody()!));
    const health = g.stats.health;
    g.takeHits();
    expect(c.hit).toBe(true);
    expect(health - g.stats.health).toBe(Math.floor(Math.hypot(70, 20)));
  });

  it("a dive still clear of him marks nothing", async () => {
    await boot("level=2&damage=1&foehit=1");
    const c = g.level!.crows[0][0];
    c.state = "strike";
    c.tag = 1;
    c.clock = 1;
    bodyOn({ left: c.x + 2000, right: c.x + 2001, top: c.y, bottom: c.y + 1 });
    g.takeHits();
    expect(c.hit ?? false).toBe(false);
  });
});

/**
 * Two of the room's creatures squared up: `e` on the first frame of one of its
 * attacks that carries a strike box, and `v`'s body box laid over that box.
 */
function squareUp(e: Enemy, v: Enemy) {
  const lvl = g.level!;
  const attack = lvl.fights[e.kind].attacks.find((a) => a.cels.some((id) => g.celRec(lvl.sbk, id)?.strike))!;
  e.anim = attack;
  e.state = "gait";
  e.swing = true;
  e.vx = 0;
  e.vy = 0;
  e.speed = 0;
  e.clock = attack.cels.findIndex((id) => g.celRec(lvl.sbk, id)?.strike) * attack.hold;
  const cel = g.celRec(lvl.sbk, g.celOf(e))!;
  const a = g.foeAnchor(e, lvl)!;
  const box = g.strikeOf(cel, a.x, a.y, e.facing)!;
  v.state = "gait";
  v.swing = false;
  const hb = g.hurtBox(v, g.celRec(lvl.sbk, g.celOf(v))!, lvl);
  v.x += Math.round((box.left + box.right) / 2 - (hb.left + hb.right) / 2);
  v.y += Math.round((box.top + box.bottom) / 2 - (hb.top + hb.bottom) / 2);
  return { cel, box };
}

describe.skipIf(!haveRip())("the creatures on each other (foesStrikeFoes, 0x430350)", () => {
  /** STREETS' first room, a punk and one of the other class, and nobody else in it */
  async function pair(strength?: number) {
    await boot("level=1&foehit=1");
    g.p.room = g.level!.rooms[0];
    const pool = g.level!.spawned[0];
    const e = pool.find((q) => q.kind === "initwerea")!;
    const v = pool.find((q) => q.kind === "initwereb")!;
    pool.splice(0, pool.length, e, v);
    e.strength = strength;
    const { cel } = squareUp(e, v);
    return { e, v, cel };
  }

  it("lands a whole blow — the cel's pair at strength 100 — once per animation", async () => {
    const { e, v } = await pair();
    const hp = v.hp;
    g.foesStrikeFoes();
    expect(v.hp).toBeLessThan(hp);
    const after = v.hp;
    g.foesStrikeFoes();
    expect(v.hp).toBe(after);
    expect(e.state).toBe("gait");
  });

  it("scales the pair by any other strength, truncating, and a blow that comes to nothing is not one (0x42f910)", async () => {
    const whole = await pair();
    const hp0 = whole.v.hp;
    g.foesStrikeFoes();
    const full = hp0 - whole.v.hp;
    const half = await pair(50);
    const hp1 = half.v.hp;
    g.foesStrikeFoes();
    const scaled = hp1 - half.v.hp;
    expect(scaled).toBeGreaterThan(0);
    expect(scaled).toBeLessThan(full);
    // one percent of the pair truncates to nothing, and the blow is not landed
    const none = await pair(1);
    const hp2 = none.v.hp;
    g.foesStrikeFoes();
    expect(none.v.hp).toBe(hp2);
  });

  it("0x65 takes the pair as it stands and nothing of the hitter's motion (0x42f9b8)", async () => {
    const still = await pair(0x65);
    const hp0 = still.v.hp;
    g.foesStrikeFoes();
    const blast = hp0 - still.v.hp;
    const moving = await pair(0x65);
    moving.e.vx = 40 * 4;
    const hp1 = moving.v.hp;
    g.foesStrikeFoes();
    expect(hp1 - moving.v.hp).toBe(blast);
  });

  it("passes over a body whose script is a terminal one", async () => {
    const { v } = await pair();
    v.state = "flinch";
    v.anim = { ...v.anim, terminal: true };
    const hp = v.hp;
    g.foesStrikeFoes();
    expect(v.hp).toBe(hp);
  });

  it("a hardcore's throw that lands on a creature flies on, struck (0x43c866)", async () => {
    await boot("level=6&foehit=1");
    const i = g.level!.spawned.findIndex((r) => r.some((q) => q.kind === "initbatboy"));
    g.p.room = g.level!.rooms[i];
    const v = g.level!.spawned[i].find((q) => q.kind === "initbatboy")!;
    g.level!.spawned[i].splice(0, g.level!.spawned[i].length, v);
    v.state = "gait";
    v.swing = false;
    const c: Cast = { kit: HARDCORE_THROW, x: 0, y: 0, vx: 30, vy: 0, facing: 1, clock: 0, bornX: 0, bornY: 0, armed: true, fromX: 0, fromY: 0, spent: false };
    const art = g.celRec(g.level!.sbk, g.castCel(c))!;
    const hb = g.hurtBox(v, g.celRec(g.level!.sbk, g.celOf(v))!, g.level!);
    Object.assign(c, centre(art.strike!, hb));
    g.setCasts([c]);
    const hp = v.hp;
    g.foesStrikeFoes();
    expect(v.hp).toBeLessThan(hp);
    expect(c.struck).toBe(true);
    expect(c.spent).toBe(false);
    g.setCasts([]);
  });
});

type Bolt = Parameters<Game["setBolts"]>[0][number];

/** a bolt whose box, at the point it stood as the frame began, is centred on `on` */
function boltAt(on: { left: number; right: number; top: number; bottom: number }, over: Partial<Bolt> = {}): Bolt {
  const b: Bolt = { x: 0, y: 0, vx: 100, facing: 1, spent: false, code: -1, age: 3, was: { x: 0, y: 0 }, ...over };
  const art = g.celRec(g.level!.sbk, g.boltCel(b));
  const sb = art?.strike ?? { y0: -4, x0: -4, y1: 2, x1: 2 };
  b.was = centre(facingRectOf(sb, b.facing < 0), on);
  b.x = b.was.x;
  b.y = b.was.y;
  return b;
}

describe.skipIf(!haveRip())("the bolts (boltHits)", () => {
  it("takes the nearer of Boggs' body and a machine along the way it flies, and is spent (0x41bc71, 0x41b510)", async () => {
    for (const vx of [100, -100]) {
      await boot("level=16");
      const g16 = g.level!.boggs[0][0];
      g.p.room = g.level!.rooms[0];
      g.p.x = g16.x;
      const heard = recordSound(g);
      // machine 6's box and machine 7's overlap at x 6648; a bolt there meets both
      const m6 = g.machineBox(g16, 6)!;
      const m7 = g.machineBox(g16, 7)!;
      const b = boltAt({ left: m6.right - 2, right: m7.left + 2, top: m6.top + 50, bottom: m6.top + 52 }, { vx, facing: Math.sign(vx) });
      g.setBolts([b]);
      g.boltHits();
      expect(b.spent).toBe(true);
      expect(g.bolts).toEqual([]);
      // 8 + roll(3): the machinery's own answer to a bolt, once
      const said = heard.filter((c) => c.call === "effect" && (c.args[0] as number) >= 9 && (c.args[0] as number) <= 11);
      expect(said).toHaveLength(1);
    }
  });

  it("goes through a TCop: the big gun's hundred is a bolt class the cop turns away (0x41482a)", async () => {
    await boot("level=13&foehit=1");
    const i = g.level!.spawned.findIndex((r) => r.some((q) => q.kind === "initcop"));
    g.p.room = g.level!.rooms[i];
    const cop = g.level!.spawned[i].find((q) => q.kind === "initcop")!;
    cop.state = "gait";
    cop.swing = false;
    g.p.x = cop.x;
    const hp = cop.hp;
    const b = boltAt(g.hurtBox(cop, g.celRec(g.level!.sbk, g.celOf(cop))!, g.level!), { code: 100 });
    g.setBolts([b]);
    g.boltHits();
    expect(cop.hp).toBe(hp);
    expect(b.spent).toBe(false);
  });

  it("stops on anything else without the creature switch, and takes nothing", async () => {
    await boot("level=13");
    const i = g.level!.spawned.findIndex((r) => r.some((q) => q.kind === "initslurp"));
    g.p.room = g.level!.rooms[i];
    const it = g.level!.spawned[i].find((q) => q.kind === "initslurp")!;
    it.state = "gait";
    it.swing = false;
    g.p.x = it.x;
    const hp = it.hp;
    const b = boltAt(g.hurtBox(it, g.celRec(g.level!.sbk, g.celOf(it))!, g.level!), { code: 100 });
    g.setBolts([b]);
    g.boltHits();
    expect(it.hp).toBe(hp);
    expect(b.spent).toBe(true);
  });

  it("the blaster's -1 goes through what turns it away, and stops on a class that rewrites it to 100 — the TCop's 0x4147e0", async () => {
    await boot("level=13&foehit=1");
    const i = g.level!.spawned.findIndex((r) => r.some((q) => q.kind === "initcop"));
    g.p.room = g.level!.rooms[i];
    const pool = g.level!.spawned[i];
    const arm = pool.find((q) => q.kind === "initcop")!;
    pool.splice(0, pool.length, arm);
    arm.state = "gait";
    arm.swing = false;
    g.p.x = arm.x;
    const b = boltAt(g.hurtBox(arm, g.celRec(g.level!.sbk, g.celOf(arm))!, g.level!));
    g.setBolts([b]);
    const dents = arm.dents;
    g.boltHits();
    expect(arm.dents).toBe(dents + 1);
    expect(b.spent).toBe(true);
  });

  it("the spitter answers the -1 with its own sound on channel 0 and lets it by (0x41825e)", async () => {
    await boot("level=15&foehit=1");
    const i = g.level!.spawned.findIndex((r) => r.some((q) => q.kind === "initpuke"));
    g.p.room = g.level!.rooms[i];
    const pool = g.level!.spawned[i];
    const puke = pool.find((q) => q.kind === "initpuke")!;
    pool.splice(0, pool.length, puke);
    puke.state = "gait";
    puke.swing = false;
    g.p.x = puke.x;
    const heard = recordSound(g);
    const b = boltAt(g.hurtBox(puke, g.celRec(g.level!.sbk, g.celOf(puke))!, g.level!));
    g.setBolts([b]);
    const hp = puke.hp;
    g.boltHits();
    expect(puke.hp).toBe(hp);
    expect(b.spent).toBe(false);
    expect(heard).toContainEqual({ call: "effect", args: [0xb, b.x, b.y, "lead"] });
  });

  it("a -1 meeting a class with no answer to it flies on (0x43042b)", async () => {
    await boot("level=1&foehit=1");
    g.p.room = g.level!.rooms[0];
    const pool = g.level!.spawned[0];
    const punk = pool.find((q) => q.kind === "initwerea")!;
    pool.splice(0, pool.length, punk);
    punk.state = "gait";
    punk.swing = false;
    g.p.x = punk.x;
    const hp = punk.hp;
    const b = boltAt(g.hurtBox(punk, g.celRec(g.level!.sbk, g.celOf(punk))!, g.level!));
    g.setBolts([b]);
    g.boltHits();
    expect(b.spent).toBe(false);
    expect(punk.hp).toBe(hp);
  });
});

type Flare = Parameters<Game["setFlares"]>[0][number];

/** a flare in flight, armed, its box where it stood as the frame began centred on `on` */
function flareAt(on: { left: number; right: number; top: number; bottom: number }, facing = 1): Flare {
  const art = g.celRec(g.level!.sbk, FLARE.flight);
  const sb = art?.strike ?? { y0: -12, x0: -12, y1: 12, x1: 12 };
  const at = centre(facingRectOf(sb, facing < 0), on);
  return {
    ...at, vx: 40 * facing, vy: 0, facing, wobble: 0, sign: 1, burn: null, age: 3, grounded: false, spent: false,
    was: { ...at, vx: 40, vy: 0, armed: true, cel: FLARE.flight },
  };
}

describe.skipIf(!haveRip())("the flares (flareHits)", () => {
  it("fired west, its box mirrored about the anchor, lands its pair plus its flight on a creature (0x42f910)", async () => {
    await boot("level=1&foehit=1");
    g.p.room = g.level!.rooms[0];
    const pool = g.level!.spawned[0];
    const punk = pool.find((q) => q.kind === "initwerea")!;
    pool.splice(0, pool.length, punk);
    punk.state = "gait";
    punk.swing = false;
    const f = flareAt(g.hurtBox(punk, g.celRec(g.level!.sbk, g.celOf(punk))!, g.level!), -1);
    g.setFlares([f]);
    const hp = punk.hp;
    g.flareHits();
    expect(punk.hp).toBeLessThan(hp);
    expect(f.burn).toBe(-1);
  });

  it("on a fourth level it is a -9 and sets the boss's fireball off where it meets one (0x43abfa, 0x43acae)", async () => {
    await boot("level=4&foehit=1");
    g.p.room = g.level!.rooms[0];
    g.level!.spawned[0].length = 0;
    const c: Cast = { kit: WBOOLY_HIGH, x: 0, y: 0, vx: 20, vy: 0, facing: 1, clock: 0, bornX: 0, bornY: 0, armed: true, fromX: 0, fromY: 0, spent: false };
    c.x = g.p.x;
    c.y = g.p.y - 100;
    const art = g.celRec(g.level!.sbk, g.castCel(c))!;
    const f = flareAt(g.castHurtBox(c, art));
    g.setCasts([c]);
    g.setFlares([f]);
    g.flareHits();
    expect(f.burn).toBe(-1);
    expect(c.alight).toBe(true);
    g.setCasts([]);
    // ...and one that misses every cast flies on
    const far = flareAt({ left: c.x + 5000, right: c.x + 5001, top: c.y, bottom: c.y + 1 });
    g.setCasts([c]);
    g.setFlares([far]);
    g.flareHits();
    expect(far.burn).toBeNull();
    g.setCasts([]);
  });
});

describe.skipIf(!haveRip())("the player's blow, the rest of what it meets (landHits)", () => {
  it("lands nothing with no act playing, or with him in no room of the level", async () => {
    await boot("level=2");
    const mine = swinging();
    const c = g.level!.crows[0][0];
    Object.assign(c, centre(g.celRec(g.level!.sbk, crowCel(c))!.body!, mine));
    g.p.act = null;
    g.landHits();
    expect(c.state).toBe("sleep");
    g.p.act = "punch";
    const room = g.p.room;
    g.p.room = { ...room! };
    g.landHits();
    expect(c.state).toBe("sleep");
    g.p.room = room;
  });

  it("cannot take a crow that is already tumbling: those cels carry no body (0x430350)", async () => {
    await boot("level=2");
    const mine = swinging();
    const c = g.level!.crows[0][0];
    Object.assign(c, centre(g.celRec(g.level!.sbk, crowCel(c))!.body!, mine));
    c.state = "tumble";
    c.tag = 0;
    c.clock = 1;
    expect(g.celRec(g.level!.sbk, crowCel(c))?.body).toBeFalsy();
    const score = g.stats.score;
    g.landHits();
    expect(g.stats.score).toBe(score);
  });

  it("kicks a head once a swing, for its award and a shove along the blow (0x420090)", async () => {
    await boot("level=9");
    const mine = swinging();
    const h: Head = { x: 0, y: 0, vx: 0, vy: 0, west: false, mode: 0, clock: 0, down: true };
    const body = g.celRec(g.level!.sbk, g.headCel(h))!.body!;
    Object.assign(h, centre(body, mine));
    g.setHeads([h]);
    const score = g.stats.score;
    g.landHits();
    expect(g.stats.score).toBeGreaterThan(score);
    expect(h.vx).toBeGreaterThan(0);
    const again = g.stats.score;
    g.landHits();
    expect(g.stats.score).toBe(again);
    g.setHeads([]);
  });

  it("passes over a creature whose script is terminal", async () => {
    await boot("level=1");
    g.p.room = g.level!.rooms[0];
    const pool = g.level!.spawned[0];
    const punk = pool.find((q) => q.kind === "initwerea")!;
    pool.splice(0, pool.length, punk);
    punk.state = "gait";
    punk.swing = false;
    const mine = swinging();
    const hb = g.hurtBox(punk, g.celRec(g.level!.sbk, g.celOf(punk))!, g.level!);
    punk.x += Math.round((mine.left + mine.right) / 2 - (hb.left + hb.right) / 2);
    punk.y += Math.round((mine.top + mine.bottom) / 2 - (hb.top + hb.bottom) / 2);
    punk.state = "flinch";
    punk.anim = { ...punk.anim, cels: [g.celOf({ ...punk, state: "gait" })], terminal: true };
    const hp = punk.hp;
    g.landHits();
    expect(punk.hp).toBe(hp);
    // ...and the same blow, the script not terminal, lands
    punk.anim = { ...punk.anim, terminal: false };
    g.landHits();
    expect(punk.hp).toBeLessThan(hp);
  });
});
