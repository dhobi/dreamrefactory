/**
 * The craft's weapons in the player's own hands, and the view drawn
 * (RAVEN.EXE 0x4196ad, 0x419fbe, 0x41a230; 0x40e634). The other flights are
 * flown by the copilot with ARMS CONTROL on, and `combat.ts` fires first-tier
 * lasers only, so this one fires each of the six from the view, with the
 * drawing on (`draws: true`):
 *
 *   - a press fires the weapon chosen from the craft and costs its ammunition
 *     (lasers 0x18, shells 0x1e, rockets 0xf0, missiles 0x168, bombs 0x120,
 *     the defensive's decoy 0xa0); the weapons strip chooses which
 *   - held, first-tier shells fire on one frame in three, and every seventh
 *     is a tracer
 *   - a third- or fourth-tier laser pressed on a vehicle locks on to it (the
 *     shot aimed at it); a fourth-tier rocket homes on it
 *   - the Defense key fires the defensive beside the craft and gives the
 *     weapon chosen back; at the first tier it is chaff, which drifts and is
 *     gone 0xc8 frames on
 *   - in HOVER the arrows lift and slide the craft, 6 a key, 2 with the
 *     engines hit (0x419511)
 *   - the view: the city frame with every picture of the frame's list over
 *     it, the craft's own nearest, put in the window at (0x0b, 0x80)
 *
 *   npm test -w jumpraven -- weapons
 */
import { test } from "vitest";
import { SCREEN_W } from "@dreamfactory/engine/v0/screen";
import type { Rect } from "@dreamfactory/engine/v0/screen";
import { AMMO_FULL } from "../../src/game/records";
import { BOMBS, DEFENSIVE, LASERS, MISSILES, ROCKETS, SHELLS, type Pyro } from "../../src/game/combat/pyro";
import { UNMASKED, VIEW_H, VIEW_W, World } from "../../src/game/combat/world";
import { VIEW_LEFT, VIEW_TOP } from "../../src/game/flight";
import { fail, haveRip, ok, pass, start } from "./harness";

const NAMES = ["lasers", "shells", "rockets", "missiles", "bombs", "defensive"];

test.skipIf(!haveRip())("weapons", async () => {
  const tier = [3, 0, 3, 1, 0, 1];
  const { game, m, input, until, click, key } = start({
    draws: true,
    start: { level: 3, records: { ammo: [AMMO_FULL, AMMO_FULL, AMMO_FULL, AMMO_FULL, AMMO_FULL, AMMO_FULL], tier } },
  });
  until("the flight", () => game.world !== null);
  const w = game.world!;
  // the craft's module whole, not the API the others see: its shots, decoys and chaff are what is checked
  const pyro = w.pyro as unknown as Pyro;
  const hud = w.hud;
  const r = game.records;
  /** the craft's frames, counted as the flight draws them */
  let frames = 0;
  const frame = pyro.frame.bind(pyro);
  pyro.frame = () => (frames++, frame());
  const nextFrame = (): void => {
    const f = frames;
    until("a frame", () => frames > f, 100);
  };

  // ---- the view, drawn ----------------------------------------------------------
  nextFrame();
  {
    const items = w.items.filter((d) => d.kind === 2 && d.depth <= UNMASKED);
    const nearest = items.at(-1);
    if (!nearest) fail("nothing near in the view's list");
    // the craft's own picture is the list's nearest, and drawn last: every pixel of it in the view is on the screen
    const [top, left] = World.rectOf(nearest.frame, nearest.y, nearest.x, nearest.mirror);
    let n = 0;
    let same = 0;
    const f = nearest.frame;
    for (let y = 0; y < f.height; y++) {
      for (let x = 0; x < f.width; x++) {
        const i = y * f.width + (nearest.mirror ? f.width - 1 - x : x);
        const vy = top + y;
        const vx = left + x;
        if (!f.opaque[i] || vy < 0 || vy >= VIEW_H || vx < 0 || vx >= VIEW_W) continue;
        n++;
        if (m.screen.pixels[(VIEW_TOP + vy) * SCREEN_W + VIEW_LEFT + vx] === f.indexed[i]) same++;
      }
    }
    if (!n || same !== n) fail(`the craft's picture: ${same} of ${n} pixels in the window`);
    ok(`the view drawn: ${w.items.length} picture(s) over the city frame, the craft's own (${n} pixels) in the window at (0x0b, 0x80)`);
  }

  // ---- a press fires the weapon chosen, at its cost ------------------------------
  /** a point in the view straight ahead of the craft, where no vehicle is */
  const ahead = (): { x: number; y: number } => {
    const c = w.project(w.cam);
    return { x: VIEW_LEFT + c.x, y: VIEW_TOP + Math.max(0, c.y - 0x40) };
  };
  const COST = [0x18, 0x1e, 0xf0, 0x168, 0x120, 0xa0];
  /** the weapons strip's button for a kind, in the window (the HUD's rects, on the strip at (0x141, 0x80)) */
  const strip = (k: number): { x: number; y: number } => {
    const rr = (hud as unknown as { rect: Rect[] }).rect[15 + k];
    return { y: 0x141 + ((rr[0] + rr[2]) >> 1), x: 0x80 + ((rr[1] + rr[3]) >> 1) };
  };
  const fired: string[] = [];
  for (const kind of [LASERS, SHELLS, ROCKETS, MISSILES, BOMBS, DEFENSIVE]) {
    const s = strip(kind);
    click(s.x, s.y);
    until(`${NAMES[kind]} chosen`, () => hud.weapon() === kind, 100);
    const before = r.ammo[kind];
    const decoys = pyro.decoys;
    const a = ahead();
    click(a.x, a.y);
    until(`${NAMES[kind]} fired`, () => r.ammo[kind] < before, 100);
    if (before - r.ammo[kind] !== COST[kind]) fail(`${NAMES[kind]} cost ${before - r.ammo[kind]}, not ${COST[kind]}`);
    if (kind === DEFENSIVE) {
      if (pyro.decoys !== decoys + 1) fail("the second-tier defensive put up no decoy");
    } else if (!pyro.shots.some((x) => x.on && x.kind === kind)) fail(`no ${NAMES[kind]} shot up`);
    fired.push(`${NAMES[kind]} ${COST[kind]}`);
  }
  ok(`each weapon chosen on the strip and fired from the view, at its cost: ${fired.join(", ")}`);

  // ---- held -----------------------------------------------------------------------
  const hold = (kind: number, n: number): { shots: number; frames: number } => {
    hud.choose(kind);
    const before = r.ammo[kind];
    const a = ahead();
    nextFrame();
    input.down(a.x, a.y);
    const f0 = frames;
    until("held", () => frames >= f0 + n, 1_000);
    const held = frames - f0;
    input.up(a.x, a.y);
    nextFrame();
    return { shots: (before - r.ammo[kind]) / COST[kind], frames: held };
  };
  const tracers = pyro.tracers;
  const shells = hold(SHELLS, 21);
  if (shells.shots !== Math.ceil(shells.frames / 3)) fail(`first-tier shells held ${shells.frames} frames fired ${shells.shots}, not one frame in three`);
  if ((tracers + shells.shots) % 7 !== pyro.tracers) fail(`tracers: ${tracers} + ${shells.shots} shells left the count at ${pyro.tracers}`);
  ok(`held: first-tier shells ${shells.shots} in ${shells.frames} frames, a tracer every seventh`);

  // ---- a lock on a vehicle ----------------------------------------------------------
  /** a point of the view a vehicle's picture is under (the modules' own pick, 0x41a2df) */
  const vehicle = (): { y: number; x: number } | null => {
    for (let y = 0; y < VIEW_H; y += 3) {
      for (let x = 0; x < VIEW_W; x += 3) {
        const pt = { y, x };
        if (w.tank.pick(pt) ?? w.copter.pick(pt) ?? w.jeep.pick(pt) ?? w.bike.pick(pt)) return pt;
      }
    }
    return null;
  };
  until("a vehicle in the view", () => vehicle() !== null, 20_000);
  {
    hud.choose(LASERS);
    nextFrame();
    const pt = vehicle()!;
    click(VIEW_LEFT + pt.x, VIEW_TOP + pt.y);
    until("the lock", () => pyro.locked === 1 || pyro.shots.some((s) => s.on && s.kind === LASERS && s.aim === 1), 100);
    if (!pyro.shots.some((s) => s.on && s.kind === LASERS && s.aim === 1)) fail("a fourth-tier laser pressed on a vehicle is not aimed at it");
    ok(`a fourth-tier laser pressed on a vehicle at (${pt.y}, ${pt.x}) of the view locks on to it`);
  }
  until("a vehicle in the view", () => vehicle() !== null, 20_000);
  {
    hud.choose(ROCKETS);
    nextFrame();
    const pt = vehicle()!;
    click(VIEW_LEFT + pt.x, VIEW_TOP + pt.y);
    until("the rocket", () => pyro.shots.some((s) => s.on && s.kind === ROCKETS && s.aim === 2), 100);
    ok("a fourth-tier rocket pressed on a vehicle homes on it");
  }

  // ---- the Defense key ----------------------------------------------------------
  {
    hud.choose(MISSILES);
    const before = r.ammo[DEFENSIVE];
    const decoys = pyro.decoys;
    // the key table's Defense (RAVEN.SCO's sixth action, the space bar by default)
    key(" ");
    until("the defensive fired", () => r.ammo[DEFENSIVE] < before, 100);
    nextFrame();
    if (hud.weapon() !== MISSILES) fail(`the weapon chosen after the Defense key is ${hud.weapon()}, not the missiles`);
    if (pyro.decoys !== decoys + 1 || before - r.ammo[DEFENSIVE] !== 0xa0) fail(`the Defense key: ${pyro.decoys - decoys} decoys for ${before - r.ammo[DEFENSIVE]}`);
    ok("the Defense key: a decoy beside the craft for 0xa0, and the missiles chosen again");

    r.tier[DEFENSIVE] = 0;
    const chaff = r.ammo[DEFENSIVE];
    key(" ");
    until("chaff", () => pyro.chaffs > 0, 100);
    if (chaff - r.ammo[DEFENSIVE] !== 0x28) fail(`first-tier chaff cost ${chaff - r.ammo[DEFENSIVE]}, not 0x28`);
    const f0 = frames;
    until("the chaff gone", () => pyro.chaffs === 0, 5_000);
    const lasted = frames - f0;
    if (lasted > 0xc8 + 1) fail(`the chaff lasted ${lasted} frames, past 0xc8`);
    ok(`the Defense key at the first tier: chaff for 0x28, gone ${lasted} frames on`);
  }

  // ---- HOVER's arrows ----------------------------------------------------------------
  {
    const f = game.flight!;
    if (f.fly) key("t");
    until("HOVER", () => !f.fly, 100);
    const z = w.cam.z;
    const slide = w.slide;
    key("ArrowUp");
    key("ArrowLeft");
    nextFrame();
    const lift = w.cam.z - z;
    const across = w.slide - slide;
    game.hudState.enginesOut = 1;
    key("ArrowDown");
    key("ArrowRight");
    nextFrame();
    const lift2 = w.cam.z - z - lift;
    const across2 = w.slide - slide - across;
    if (lift !== 6 || across !== -6 || lift2 !== -2 || across2 !== 2) fail(`HOVER's arrows: up ${lift}, left ${across}; engines hit, down ${lift2}, right ${across2}`);
    ok("in HOVER the arrows lift and slide the craft 6 a key, 2 with the engines hit");
  }
  pass("weapons");
});
