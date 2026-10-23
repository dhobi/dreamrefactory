/**
 * The craft's weapons held down, and HOVER's bounds (RAVEN.EXE 0x4196ad,
 * 0x41a230, 0x419511, 0x40b640) — what `weapons.ts` leaves to the other
 * tiers:
 *
 *   - held, second- and third-tier shells fire every other frame, fourth-tier
 *     every frame and every one a tracer
 *   - rockets, missiles, bombs and the decoy are a press each: held, one
 *   - first-tier chaff held at rest puffs on one frame in eight, on the move one
 *     in two; the decoy and shells fire on the move too
 *   - a weapon with no ammunition left fires nothing
 *   - the Defense key fires to the side the craft has slid toward, either side unslid
 *   - HOVER's rise is held within 0x46 … 0xfa and its slide within ±0x46; a slide
 *     puts the craft across its pose's centre by the way it faces
 *   - flying, the down arrow is nothing, a held arrow waits for the move
 *     under way, and a held Defense or Hover/Fly key does not repeat
 *
 *   npm test -w jumpraven -- arms-held
 */
import { test } from "vitest";
import { AMMO_FULL } from "../../src/game/core/records";
import { BOMBS, DEFENSIVE, MISSILES, ROCKETS, SHELLS } from "../../src/game/combat/arms";
import type { Pyro } from "../../src/game/combat/pyro";
import { VIEW_LEFT, VIEW_TOP } from "../../src/game/flight";
import { fail, haveRip, ok, pass, start } from "./harness";

const NAMES = ["lasers", "shells", "rockets", "missiles", "bombs", "defensive"];
const COST = [0x18, 0x1e, 0xf0, 0x168, 0x120, 0xa0];

test.skipIf(!haveRip())("arms-held", async () => {
  const { game, input, until, key } = start({
    start: { level: 3, records: { ammo: Array(6).fill(AMMO_FULL), tier: [0, 1, 0, 0, 0, 1] } },
  });
  until("the flight", () => game.world !== null);
  const w = game.world!;
  const pyro = w.pyro as unknown as Pyro;
  const hud = w.hud;
  const r = game.records;
  let frames = 0;
  const frame = pyro.frame.bind(pyro);
  pyro.frame = () => (frames++, frame());
  const nextFrame = (): void => {
    const f = frames;
    until("a frame", () => frames > f, 100);
  };
  const f = game.flight!;
  // HOVER and at rest, so that the speed is 0 throughout
  if (f.fly) key("t");
  until("HOVER", () => !f.fly && !f.move, 2_000);
  /** a point in the view, `up` above the craft's own */
  const at = (up: number): { x: number; y: number } => {
    const c = w.project(w.cam);
    return { x: VIEW_LEFT + c.x, y: VIEW_TOP + Math.max(0, c.y - up) };
  };
  const hold = (kind: number, n: number, where = at(0x40)): { shots: number; frames: number } => {
    hud.choose(kind);
    const before = r.ammo[kind];
    nextFrame();
    input.down(where.x, where.y);
    const f0 = frames;
    until("held", () => frames >= f0 + n, 1_000);
    const held = frames - f0;
    input.up(where.x, where.y);
    nextFrame();
    return { shots: (before - r.ammo[kind]) / COST[kind], frames: held };
  };

  // ---- shells by tier -------------------------------------------------------------
  for (const [tier, every] of [[1, 2], [2, 2], [3, 1]] as const) {
    r.tier[SHELLS] = tier;
    const s = hold(SHELLS, 12);
    if (s.shots !== Math.ceil(s.frames / every)) fail(`tier-${tier + 1} shells held ${s.frames} frames fired ${s.shots}`);
    if (tier === 3 && !pyro.shots.filter((x) => x.on && x.kind === SHELLS && x.tier === 3).every((x) => x.flag === 1)) fail("a fourth-tier shell that is no tracer");
  }
  ok("held: second- and third-tier shells every other frame, fourth-tier every frame, every one a tracer");

  // ---- a press each ---------------------------------------------------------------
  for (const kind of [ROCKETS, MISSILES, BOMBS, DEFENSIVE]) {
    const s = hold(kind, 10, at(kind === BOMBS ? -0x20 : 0x40));
    if (s.shots !== 1) fail(`${NAMES[kind]} held 10 frames fired ${s.shots}`);
  }
  // a bomb dropped high in the view goes ahead of the craft, one low behind it — both a press each
  if (hold(BOMBS, 4, at(0x60)).shots !== 1) fail("a bomb high in the view was not one");
  ok("held: rockets, missiles, bombs (low and high in the view) and the decoy fire once a press");

  // ---- first-tier chaff at rest ---------------------------------------------------
  {
    r.tier[DEFENSIVE] = 0;
    until("no puffs up", () => pyro.puffs.every((p) => !p.on), 5_000);
    hud.choose(DEFENSIVE);
    nextFrame();
    const a = at(0x40);
    input.down(a.x, a.y);
    const f0 = frames;
    until("held", () => frames >= f0 + 24, 1_000);
    input.up(a.x, a.y);
    const puffs = pyro.puffs.filter((p) => p.on && p.kind === 0).length;
    if (w.speed !== 0 || puffs !== 3) fail(`chaff held 24 frames at rest (speed ${w.speed}) puffed ${puffs} times, not 3`);
    ok("held at rest: first-tier chaff puffs on one frame in eight");
  }

  // ---- empty -------------------------------------------------------------------------
  {
    r.ammo[ROCKETS] = 0;
    hud.choose(ROCKETS);
    const up = pyro.shots.filter((s) => s.on && s.kind === ROCKETS).length;
    const a = at(0x40);
    // chosen with nothing in it: the press is a click of the empty magazine
    pyro.aim({ y: a.y - VIEW_TOP, x: a.x - VIEW_LEFT }, true);
    nextFrame();
    if (pyro.shots.filter((s) => s.on && s.kind === ROCKETS).length > up || r.ammo[ROCKETS] !== 0) fail("an empty weapon fired");
    ok("an empty weapon fires nothing");
  }

  // ---- HOVER's bounds -----------------------------------------------------------------
  const holdKey = (k: string, n: number): void => {
    input.keyDown(k);
    const f0 = frames;
    until(`${k} held`, () => frames >= f0 + n, 2_000);
    input.keyUp(k);
    nextFrame();
  };
  // read through functions: the machine changes these under TypeScript's narrowing
  const rise = (): number => w.cam.z;
  const slid = (): number => w.slide;
  holdKey("ArrowUp", 40);
  if (rise() !== 0xfa) fail(`ArrowUp held: the craft at ${rise()}, not 0xfa`);
  holdKey("ArrowDown", 50);
  if (rise() !== 0x46) fail(`ArrowDown held: the craft at ${rise()}, not 0x46`);
  holdKey("ArrowLeft", 20);
  if (slid() !== -0x46) fail(`ArrowLeft held: the slide ${slid()}, not -0x46`);
  ok("HOVER: the rise held within 0x46 … 0xfa, the slide down to -0x46");
  // the Defense key fires toward the side the craft has slid to (0x41a230): left of the view's middle
  r.tier[DEFENSIVE] = 1;
  key(" ");
  nextFrame();
  if (pyro.mouse.x <= 0x80) fail(`slid left, the Defense key aimed at x ${pyro.mouse.x}`);
  nextFrame();
  holdKey("ArrowRight", 30);
  if (slid() !== 0x46) fail(`ArrowRight held: the slide ${slid()}, not 0x46`);
  key(" ");
  nextFrame();
  if (pyro.mouse.x >= 0x80) fail(`slid right, the Defense key aimed at x ${pyro.mouse.x}`);
  nextFrame();
  ok("the slide up to 0x46, and the Defense key aimed to the side slid toward");
  // slid less than 0x11 either way, the side is a roll: either way, 0x15 … 0x28 in from the edge
  {
    const sides = new Set<boolean>();
    pyro.slide(-w.slide, 0);
    for (let i = 0; i < 12; i++) {
      key(" ");
      nextFrame();
      const x = pyro.mouse.x;
      const fromEdge = x > 0x80 ? 0x100 - x : x;
      if (fromEdge < 0x15 || fromEdge > 0x28) fail(`unslid, the Defense key aimed at x ${x}`);
      sides.add(x > 0x80);
      nextFrame();
    }
    if (sides.size !== 2) fail("unslid, the Defense key aimed to one side only in twelve");
    ok("unslid, the Defense key aims to either side, 0x15 … 0x28 in from the edge");
  }
  // an empty weapon held down: nothing fired, and no click of the empty magazine past the press
  {
    r.ammo[MISSILES] = 0;
    const up = pyro.shots.filter((s) => s.on && s.kind === MISSILES).length;
    const s = hold(MISSILES, 6);
    if (s.shots !== 0 || pyro.shots.filter((x) => x.on && x.kind === MISSILES).length > up) fail("an empty weapon held fired");
    r.ammo[MISSILES] = AMMO_FULL;
  }

  // ---- held keys that do not repeat, and flying's arrows ------------------------------
  {
    const decoys = pyro.decoys;
    holdKey(" ", 12);
    if (pyro.decoys !== decoys + 1) fail(`the Defense key held 12 frames fired ${pyro.decoys - decoys} decoys`);
    const fly = f.fly;
    holdKey("t", 12);
    if (f.fly === fly) fail("the Hover/Fly key held did not toggle");
    if (!f.fly) fail("the Hover/Fly key held toggled more than once");
    ok("held, the Defense key fires once and Hover/Fly toggles once");
    const pose = { ...f.pose };
    holdKey("ArrowDown", 6);
    if (f.move || f.queue.length || JSON.stringify(f.pose) !== JSON.stringify(pose)) fail("flying, the down arrow moved the craft");
    // a held arrow puts one move in, and waits for it
    input.keyDown("ArrowLeft");
    const f0 = frames;
    until("turning", () => f.move !== null, 100);
    const queued = f.queue.length;
    until("held", () => frames >= f0 + 4, 100);
    if (f.queue.length !== queued) fail(`a held arrow queued ${f.queue.length - queued} more under the move`);
    input.keyUp("ArrowLeft");
    until("the turn done", () => !f.move && !f.queue.length, 2_000);
    // pressed, not held, the queue takes them, eight at most: the oldest dropped
    for (let i = 0; i < 10; i++) key("ArrowLeft");
    until("the first of them under way", () => f.move !== null, 100);
    if (f.queue.length !== 7) fail(`ten presses left ${f.queue.length} queued behind the move, not 7`);
    ok(`flying: the down arrow is nothing, a held arrow waits for its move, ten presses queue eight`);
  }

  // ---- on the move: chaff every other frame, and the decoy and shells carried along ----
  {
    until("the turns done", () => !f.move && !f.queue.length, 5_000);
    /** forward until the craft is on the move, turning where it is blocked */
    const onTheMove = (): void => {
      for (let tries = 0; tries < 8; tries++) {
        key("ArrowUp");
        until("a move or none", () => f.move !== null || !f.queue.length, 200);
        for (let i = 0; i < 3 && w.speed === 0; i++) nextFrame();
        if (w.speed) return;
        key("ArrowLeft");
        until("the turn", () => !f.move && !f.queue.length, 2_000);
      }
      fail("the craft would not move forward anywhere");
    };
    r.tier[DEFENSIVE] = 0;
    until("no puffs up", () => pyro.puffs.every((p) => !p.on), 5_000);
    hud.choose(DEFENSIVE);
    let moving = 0;
    let shells = 0;
    const a = at(0x40);
    for (let k = 0; k < 6; k++) {
      onTheMove();
      input.down(a.x, a.y);
      const f0 = frames;
      let seen = frames;
      until("held on the move", () => {
        if (frames !== seen && w.speed) moving++;
        seen = frames;
        return frames >= f0 + 4;
      }, 200);
      input.up(a.x, a.y);
      if (k === 4) {
        // the decoy, and a burst of shells, fired on the move
        r.tier[DEFENSIVE] = 1;
        const decoys = pyro.decoys;
        onTheMove();
        pyro.aim({ y: a.y - VIEW_TOP, x: a.x - VIEW_LEFT }, true);
        nextFrame();
        if (pyro.decoys !== decoys + 1) fail("no decoy fired on the move");
        hud.choose(SHELLS);
        r.tier[SHELLS] = 3;
        const before = r.ammo[SHELLS];
        onTheMove();
        pyro.aim({ y: a.y - VIEW_TOP, x: a.x - VIEW_LEFT }, true);
        nextFrame();
        shells = (before - r.ammo[SHELLS]) / COST[SHELLS];
        hud.choose(DEFENSIVE);
        r.tier[DEFENSIVE] = 0;
      }
      until("the move done", () => !f.move && !f.queue.length, 2_000);
    }
    const puffs = pyro.puffs.filter((p) => p.on && p.kind === 0).length;
    if (!moving || Math.abs(puffs - moving / 2) > 1) fail(`chaff held ${moving} frames on the move puffed ${puffs} times`);
    if (shells !== 1) fail(`a shell on the move: ${shells}`);
    ok(`on the move: chaff held ${moving} frames puffed ${puffs} times (one in two); a decoy and a shell fired`);
  }
  // ---- a slide in each facing: the craft at its pose's centre, across by the slide ----
  {
    until("at rest", () => !f.move && !f.queue.length, 5_000);
    const seen = new Set<number>();
    for (let turn = 0; turn < 4; turn++) {
      if (!f.fly) key("t");
      until("FLY", () => f.fly, 100);
      key("ArrowLeft");
      until("the turn", () => f.move !== null, 200);
      until("the turn done", () => !f.move && !f.queue.length, 2_000);
      key("t");
      until("HOVER", () => !f.fly, 100);
      pyro.slide(0x10 - w.slide, 0);
      const cx = (w.poseX << 8) + 0x80;
      const cy = (w.poseY << 8) + 0x80;
      const want = [[cx + 0x10, cy], [cx - 0x10, cy], [cx, cy + 0x10], [cx, cy - 0x10]][w.poseDir];
      if (w.cam.x !== want[0] || w.cam.y !== want[1]) fail(`facing ${w.poseDir}, a slide of 0x10 put the craft at ${w.cam.x},${w.cam.y}, not ${want.join(",")}`);
      seen.add(w.poseDir);
    }
    if (seen.size !== 4) fail(`four left turns faced ${[...seen].join(",")}`);
    ok("a slide in each facing: north +x, south −x, east +y, west −y from the pose's centre");
  }
  pass("arms-held");
});
