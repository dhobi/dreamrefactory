/**
 * The Maya's verbs (world M, disc three): the machine suites' route
 * (tests/machine/worlds/maya.ts) a puzzle at a time, the solving shared with it
 * (src/maya.ts) and the playing done through the speedrun driver. Every
 * puzzle is solved from what the game shows NOW — the wheels' pictures, the
 * stones' places, the spiders where they walk — so whatever a seed deals is
 * what the verb plays.
 */
import type { ActionContext, ActionTable } from "@dreamfactory/speedrun/action";
import {
  BEAT, GODS, GROUP_CELLS, HOLES, PODIUM_RISE, STALACTITE_X, beatCost, boardOf, skeleton, skullOrder, slideTo, solvable, turnsTo,
  type Board, type Wheels,
} from "../maya";
import {
  DEG, UNLOCKED, carry, clickThen, g, gNum, global, line, middle, need, num, propIn, settle, truthy, type Point,
} from "./gestures";

/** a prop of the shop on screen, page-side */
const PROP = (name: string): string => `window.dbg.session.propRuntime.get(${JSON.stringify(name)})`;

/** the names of the handlers running outside the idle's chain (the harness's `running()`) */
const RUNNING = `[...window.dbg.session.interp.framesAtWork].map((f) => f.handler)`;

/** nothing running outside the idle's chain */
const NOTHING_RUNNING = `window.dbg.session.interp.handlersAtWork === 0`;

/* ------------------------------------------------------------------ *
 * The spider maze
 * ------------------------------------------------------------------ */

const HOLE_NAMES = Object.keys(HOLES);

/**
 * What `walkto` sees at every point of the screen, as one array: 0 floor, 1 a
 * wall (the maze's `bevel`, drawn or not, or the monkey's `mouth`), 2 the ball
 * (`ballout`), 3 + i the hole {@link HOLE_NAMES}[i]. The machine route answers
 * the same by showing the bevel and hiding the green spider for its hit test;
 * this one asks the bevel's own picture whether a point is in it, and looks
 * under the green spider for the flat's region, so the game is never touched.
 */
const MAZE_GRID = `(() => {
  const s = window.dbg.session, rt = s.propRuntime, W = 640, H = 480;
  const holes = ${JSON.stringify(HOLE_NAMES)};
  const bevel = rt.get("bevel");
  const st = bevel && bevel.state();
  const f = st && bevel.shop.frame(bevel.currentFrame(st));
  const at = f && bevel.screenCorner(f, rt.origin);
  const wall = (x, y) => !!f && rt.screenPointOf(bevel, f, at.x, at.y, x, y);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (wall(x, y)) { out[y * W + x] = 1; continue; }
      let t = s.hitTestAt(x, y);
      if (t.type === "prop" && t.name.toLowerCase() === "green") {
        const r = s.stageCtrl.regionAt(x, y);
        t = r ? { type: "button", name: r.name } : { type: "flat", name: "" };
      }
      const n = (t.name || "").toLowerCase();
      if (t.type === "prop" && (n === "bevel" || n === "mouth")) out[y * W + x] = 1;
      else if (t.type === "prop" && n === "ballout") out[y * W + x] = 2;
      else if (t.type === "button" && holes.includes(n)) out[y * W + x] = 3 + holes.indexOf(n);
    }
  return out;
})()`;

interface Spiders {
  green: [number, number];
  /** each red spider that is out: where, and how near is too near (a walking one 1, a standing one ¼) */
  reds: [number, number, number][];
  /** `walkto` is walking the green spider */
  /** each red spider by its number: where, walking, and whether its patrol loop runs; null when it is not out */
  byRed: ([number, number, boolean, boolean] | null)[];
  walking: boolean;
  /** anything that moves it is running: a walk, a hole's few steps, the walk out of the mouth */
  moving: boolean;
  locked: boolean;
  got: boolean;
}

const SPIDERS = `(() => {
  const s = window.dbg.session, pr = (n) => s.propRuntime.get(n), g = pr("green");
  const running = ${RUNNING};
  return {
    green: [g ? g.anchorX : 0, g ? g.anchorY : 0],
    reds: [0, 1, 2, 3, 4].map((r) => pr("red" + r)).filter((p) => p && p.visible).map((p) => [p.anchorX, p.anchorY, p.stateName === "walk" ? 1 : 0.25]),
    byRed: [0, 1, 2, 3, 4].map((r) => { const p = pr("red" + r); return p && p.visible ? [p.anchorX, p.anchorY, p.stateName === "walk", s.scheduler.isLoop("prop", "red" + r)] : null; }),
    walking: running.some((h) => /walkto/i.test(h)),
    moving: running.some((h) => /walkto|easywalk|walkout/i.test(h)),
    locked: window.dbg.host.director.inputLocked,
    got: ${global("curinvprop")} === "invmonkeygem",
  };
})()`;

/** the spider at rest, the hand free: after the walk out of the mouth, or a hole's few steps */
const SPIDER_AT_REST = `((st) => !st.locked && st.green[0] > 0 && !st.moving)(${SPIDERS})`;

/** the cheapest way through the maze from the green spider to the ball, by the grid ({@link MAZE_GRID}) */
async function spiderPath(c: ActionContext, grid: Uint8Array): Promise<[number, number][]> {
  const W = 640, H = 480;
  const snakes = await c.d.evaluate<Record<string, boolean>>(
    `Object.fromEntries(${JSON.stringify(Object.values(HOLES).flatMap((h) => (h.snake ? [h.snake] : [])))}.map((n) => [n, !!window.dbg.session.propRuntime.get(n)?.visible]))`,
  );
  const awake = await c.d.evaluate<number[]>(`[0, 1, 2, 3, 4].filter((r) => window.dbg.session.scheduler.isLoop("prop", "red" + r))`);
  const { green: [sx, sy] } = await c.d.evaluate<Spiders>(SPIDERS);
  // the cheapest way, not the shortest: a step near an awake spider's beat
  // costs forty (a bucket queue, the costs being small whole numbers)
  const cost = beatCost(awake);
  const stepCost = new Uint8Array(W * H);
  const costAt = (x: number, y: number): number => {
    const i = y * W + x;
    if (!stepCost[i]) stepCost[i] = cost(x, y);
    return stepCost[i];
  };
  const prev = new Int32Array(W * H).fill(-2);
  const dist = new Float64Array(W * H).fill(Infinity);
  const start = sy * W + sx;
  prev[start] = -1;
  dist[start] = 0;
  const buckets: number[][] = [[start]];
  let goal = -1;
  for (let d = 0; d < buckets.length && goal < 0; d++) {
    for (const i of buckets[d] ?? []) {
      if (dist[i] !== d) continue;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        let j = ny * W + nx;
        const k = grid[j];
        if (k === 1) continue;
        const nd = d + costAt(nx, ny);
        if (k === 2) {
          if (nd < dist[j]) ((dist[j] = nd), (prev[j] = i), (goal = j));
          continue;
        }
        if (k >= 3) {
          const hole = HOLES[HOLE_NAMES[k - 3]];
          if (hole.snake && !snakes[hole.snake]) continue;
          if (nd >= dist[j]) continue;
          dist[j] = nd;
          prev[j] = i;
          const [tx, ty] = hole.to;
          const out = ty * W + tx;
          if (nd >= dist[out]) continue;
          dist[out] = nd;
          prev[out] = j;
          j = out;
        } else {
          if (nd >= dist[j]) continue;
          dist[j] = nd;
          prev[j] = i;
        }
        buckets[nd] ??= [];
        buckets[nd].push(j);
      }
    }
  }
  if (goal < 0) throw new Error(`no way through the spider maze from ${sx}, ${sy}`);
  const path: [number, number][] = [];
  for (let i = goal; i >= 0; i = prev[i]) path.unshift([i % W, (i / W) | 0]);
  return path;
}

/** a path's turns: straight runs end at a corner, a hole or the ball (each aimed a few pixels into it) */
function cornersOf(path: [number, number][]): [number, number][] {
  const corners: [number, number][] = [];
  for (let k = 1; k < path.length; k++) {
    const [a, b, c] = [path[k - 1], path[k], path[k + 1]];
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 1) {
      const p0 = path[k - 2] ?? a;
      corners.push([a[0] + 4 * Math.sign(a[0] - p0[0]), a[1] + 4 * Math.sign(a[1] - p0[1])]);
      break;
    }
    if (!c || c[0] - b[0] !== b[0] - a[0] || c[1] - b[1] !== b[1] - a[1]) corners.push(b);
    if (!c) corners[corners.length - 1] = [b[0] + 4 * Math.sign(b[0] - a[0]), b[1] + 4 * Math.sign(b[1] - a[1])];
  }
  return corners;
}

/**
 * Where red spider r may be over the next turns. A patrolling one walks its
 * beat (src/maya.ts `BEAT`: red1, red2, red3, red2, red1 …) at the speed it was
 * last seen walking; one standing at a turn may set off either way at any
 * moment, so it is every one of those at once; one off its beat (coming at
 * you) stays where it is, and is given room.
 */
function redFutures(r: number, at: [number, number], was: [number, number] | null, speed: number, standing: boolean): ((t: number) => [number, number])[] {
  const [a, b, cc] = BEAT[r];
  const loop: [number, number][] = [a, b, cc, b, a];
  const segs = loop.slice(1).map((q, i) => ({ p: loop[i], q, len: Math.hypot(q[0] - loop[i][0], q[1] - loop[i][1]) }));
  const total = segs.reduce((n, sg) => n + sg.len, 0);
  const pointAt = (d: number): [number, number] => {
    d = ((d % total) + total) % total;
    for (const sg of segs) {
      if (d <= sg.len) return [sg.p[0] + ((sg.q[0] - sg.p[0]) * d) / sg.len, sg.p[1] + ((sg.q[1] - sg.p[1]) * d) / sg.len];
      d -= sg.len;
    }
    return a;
  };
  // where on the loop it is: each place it could be, with the way it is going
  const here: number[] = [];
  let from = 0;
  for (const sg of segs) {
    const dx = sg.q[0] - sg.p[0], dy = sg.q[1] - sg.p[1];
    const u = Math.max(0, Math.min(1, ((at[0] - sg.p[0]) * dx + (at[1] - sg.p[1]) * dy) / (sg.len * sg.len || 1)));
    const near = Math.hypot(sg.p[0] + dx * u - at[0], sg.p[1] + dy * u - at[1]) < 4;
    const ahead = !was || standing || (at[0] - was[0]) * dx + (at[1] - was[1]) * dy > 0;
    if (near && ahead) here.push(from + u * sg.len);
    from += sg.len;
  }
  const still = (): [number, number] => at;
  if (!here.length) return [still];
  const out: ((t: number) => [number, number])[] = here.map((d) => (t: number) => pointAt(d + speed * t));
  if (standing) out.push(still, ...here.map((d) => (t: number) => pointAt(d - speed * t)));
  return out;
}

/** the corners from `k` on, as far as the first that is clear of every patrolling red's beat */
function chainOf(corners: [number, number][], k: number, awake: number[]): number {
  for (let j = k; j < corners.length; j++) {
    const [x, y] = corners[j];
    const nearBeat = awake.some((r) =>
      BEAT[r].slice(1).some((q, i) => {
        const p = BEAT[r][i];
        const dx = q[0] - p[0], dy = q[1] - p[1], len2 = dx * dx + dy * dy || 1;
        const u = Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / len2));
        return Math.hypot(p[0] + dx * u - x, p[1] + dy * u - y) < 24;
      }),
    );
    if (!nearBeat) return j;
  }
  return corners.length - 1;
}

/**
 * Whether the green spider, walked from where it is through corners k…j at
 * its pace, keeps clear of every red spider's every future (more than 18 px;
 * one catches within 8).
 */
function safeRun(
  st: Spiders,
  corners: [number, number][],
  k: number,
  j: number,
  was: ([number, number] | null)[],
  speeds: number[],
  pace: number,
): boolean {
  const pts: [number, number][] = [st.green, ...corners.slice(k, j + 1)];
  const futures = st.byRed.flatMap((red, r) => {
    if (!red) return [];
    // a patrolling red on its beat; one with no patrol stays where it stands
    if (red[3]) return redFutures(r, [red[0], red[1]], was[r], speeds[r], !red[2]);
    return [() => [red[0], red[1]] as [number, number]];
  });
  let t = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const len = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1);
    for (let d = 0; d <= len; d += 2, t += 2 / pace) {
      const gx = a[0] + ((b[0] - a[0]) * d) / len, gy = a[1] + ((b[1] - a[1]) * d) / len;
      for (const f of futures) {
        const [rx, ry] = f(t);
        if (Math.hypot(rx - gx, ry - gy) < 18) return false;
      }
    }
  }
  return true;
}

/** bare floor near the green spider to press on: not the spider (its own prop takes the click), not a hole */
const FLOOR_NEAR = (x: number, y: number): string => `((sx, sy) => {
  const s = window.dbg.session;
  for (let r = 12; r < 80; r += 4)
    for (let a = 0; a < 16; a++) {
      const px = Math.round(sx + r * Math.cos((a * Math.PI) / 8)), py = Math.round(sy + r * Math.sin((a * Math.PI) / 8));
      if (s.hitTestAt(px, py).type === "flat") return { x: px, y: py };
    }
  return null;
})(${x}, ${y})`;

async function spiders(c: ActionContext): Promise<void> {
  const grid = await c.d.evaluate<Uint8Array>(MAZE_GRID);
  let catches = 0;
  let legs = 0;
  /** each red's walking pace, px a turn, and where it was a turn ago */
  const speeds = [1, 1, 1, 1, 1];
  const seenRed: ([number, number] | null)[] = [null, null, null, null, null];
  /** the green spider's own pace, px a turn */
  const pace = 1;
  while (!(await c.d.evaluate<Spiders>(SPIDERS)).got) {
    if (legs > 40 || catches > 12) throw new Error(`the spider never reached the ball (${catches} times caught)`);
    await c.d.hold(SPIDER_AT_REST, "the green spider at rest", 150_000);
    const corners = cornersOf(await spiderPath(c, grid));
    const startAt = (await c.d.evaluate<Spiders>(SPIDERS)).green;
    const press = (await c.d.evaluate<Point | null>(FLOOR_NEAR(startAt[0], startAt[1]))) ?? { x: corners[0][0], y: corners[0][1] };
    await c.d.hold(UNLOCKED, "a moment between the red spiders' steps", c.budget);
    let k = 0;
    let started = false;
    let waited = 0;
    let going = false;
    let ended = "";
    let turns = 0;
    let atCorner = 0;
    let last: [number, number] | null = null;
    let goUntil = -1;
    // the walk: the button held, the hand moved a turn of `walkto` at a time —
    // on through the corners once the way ahead stays clear of the red
    // spiders' patrols (`safeRun`), and kept over the spider while it does not
    await c.d.dragProp(
      press,
      async () => {
        const st = await c.d.evaluate<Spiders>(SPIDERS);
        turns++;
        if (!started) {
          if (!st.walking && waited++ < 30) return { x: corners[0][0], y: corners[0][1] };
          started = true;
        }
        // a jump is the end of a leg: a hole's far side, or caught and sent back
        // to the mouth, from where `walkto` would walk at the hand into a wall
        const jumped = !!last && Math.abs(st.green[0] - last[0]) + Math.abs(st.green[1] - last[1]) > 12;
        last = st.green;
        if (st.got) ended = "the ball";
        else if (!st.walking) ended = "the walk";
        else if (jumped) ended = "a jump";
        else if (++atCorner > 3000) ended = "a corner never cleared";
        if (ended) return null;
        while (k < corners.length && Math.abs(st.green[0] - corners[k][0]) + Math.abs(st.green[1] - corners[k][1]) <= 1) {
          k++;
          atCorner = 0;
          going = false;
        }
        if (k >= corners.length) return null;
        // the reds' pace, from how far each moved since the last turn
        st.byRed.forEach((red, r) => {
          const w = seenRed[r];
          if (red && w && red[2]) {
            const v = Math.hypot(red[0] - w[0], red[1] - w[1]);
            if (v > 0 && v < 6) speeds[r] = speeds[r] * 0.8 + v * 0.2;
          }
        });
        const before = seenRed.slice();
        st.byRed.forEach((red, r) => (seenRed[r] = red ? [red[0], red[1]] : null));
        if (going && k > goUntil) going = false;
        if (!going) {
          const awake = st.byRed.flatMap((red, r) => (red?.[3] ? [r] : []));
          const j = chainOf(corners, k, awake);
          if (safeRun(st, corners, k, j, before, speeds, pace)) ((going = true), (goUntil = j));
        }
        const [x, y] = corners[k];
        return going ? { x, y } : { x: st.green[0], y: st.green[1] };
      },
      600_000,
    );
    const [gx, gy] = (await c.d.evaluate<Spiders>(SPIDERS)).green;
    const got = (await c.d.evaluate<Spiders>(SPIDERS)).got;
    c.d.log(`spiders: leg ${legs + 1} ended at ${gx},${gy} (${ended || "held"}) after ${turns} turns`);
    if (!got && gx === 310 && gy === 101 && (startAt[0] !== 310 || startAt[1] !== 101 || ended)) catches++;
    legs++;
  }
  c.say(`${legs} leg(s), caught ${catches} time(s)`);
}

/* ------------------------------------------------------------------ *
 * The table
 * ------------------------------------------------------------------ */

const wheels = async (c: ActionContext): Promise<Wheels> =>
  [await c.d.evaluate<number>(DEG("wheela")), await c.d.evaluate<number>(DEG("wheelb")), await c.d.evaluate<number>(DEG("wheelc"))];

export const MAYA_ACTIONS: ActionTable = {
  /**
   * The chameleon on the platform (m005, frame 60): a touch plays its colours
   * (`lizstring`), and the buttons under it answer them back, colour v on
   * `button{v-1}` — three rounds, and it vanishes (`chameleon`).
   */
  chameleon: {
    args: [0, 0],
    wait: "quiet",
    sig: "chameleon()",
    help: "touch the chameleon and answer its colours back on the buttons, round after round, until it vanishes",
    run: async (c) => {
      let rounds = 0;
      while (!truthy(await g(c, "chameleon"))) {
        if (rounds > 10) throw new Error("ten rounds and the chameleon stays");
        const empty = async (): Promise<boolean> => ["", "0"].includes(await g(c, "lizstring"));
        if (await empty()) await clickThen(c, await propIn(c, "lizard", undefined, 3, 30_000), "the chameleon's colours", "quiet");
        if (!(await empty())) {
          for (const v of (await g(c, "lizstring")).split(",").map(Number)) {
            if (truthy(await g(c, "chameleon"))) break;
            await clickThen(c, await propIn(c, `button${v - 1}`), `colour ${v}`, "quiet");
          }
        }
        rounds++;
      }
      c.say(`${rounds} round(s)`);
    },
  },

  /**
   * The crystal ball above the Castillo (m009, frame 121), dragged from the
   * region of the face it shows to god n's (its base flat `M0003.121`'s regions
   * A…E are the faces 0…4, `morphgod`).
   */
  ball: {
    args: [1, 1],
    wait: "quiet",
    sig: "ball(2)",
    help: "turn the crystal ball to god n's face (1 skull, 2 monkey, 3 jaguar, 4 lizard)",
    run: async (c) => {
      const god = num(c, 0, "the god");
      const now = await gNum(c, "morphgod");
      if (now === god) return;
      const mid = (name: string): Promise<Point | null> =>
        c.d.evaluate<Point | null>(`((r) => r ? { x: Math.round((r.left + r.right) / 2), y: Math.round((r.top + r.bottom) / 2) } : null)(window.dbg.session.stageCtrl.flatRegion("M0003.121", ${JSON.stringify(name)}))`);
      const from = await mid("ABCDE"[now]);
      const to = await mid(GODS[god - 1].ball);
      if (!from || !to) throw new Error("the crystal ball's regions are not to hand here");
      await carry(c, from, to, 16, `the ball to god ${god}`);
      await need(c, "morphgod", String(god), "the ball's face");
    },
  },

  /**
   * The calendar (m008, frame 907) turned to god n's date: three geared wheels
   * (a turn of one moves others, src/maya.ts `TURN`), the fewest turns found by
   * search from the pictures they show, each a drag of 42 px on the wheel.
   */
  calendar: {
    args: [1, 1],
    wait: "quiet",
    sig: "calendar(2)",
    help: "turn the calendar's wheels to god n's date",
    run: async (c) => {
      const { date, flag } = GODS[num(c, 0, "the god") - 1];
      const path = turnsTo(await wheels(c), date);
      for (const { wheel, dir } of path) {
        const at = await propIn(c, `wheel${wheel}`);
        const y = dir > 0 ? Math.min(at.y, 430) : Math.max(at.y, 50);
        await carry(c, { x: at.x, y }, { x: at.x, y: y + dir * 42 }, 8, `wheel ${wheel}`);
      }
      await need(c, flag, "1", `the date (${(await wheels(c)).join(", ")})`);
      c.say(`${path.length} turn(s)`);
    },
  },

  /**
   * The Skull temple's hanging skeleton (m043, frame 802): each bone off the
   * floor (`ground0`…`12`) let go where its joint snaps it into its place, in
   * an order the joints' table allows (src/maya.ts `skeleton`).
   */
  skeleton: {
    args: [0, 0],
    wait: "quiet",
    sig: "skeleton()",
    help: "hang the thirteen bones of the skeleton, each where it snaps into its place",
    run: async (c) => {
      for (const { bone, at } of skeleton()) {
        const from = await propIn(c, `ground${bone}`, [0, 380, 640, 480]);
        // the bone's own place, turn by turn, for the report when it does not set
        const seen: string[] = [];
        const wallProp = PROP(`wall${bone}`);
        const WALL = `((p) => p ? (p.visible ? "" : "hidden ") + p.anchorX + "," + p.anchorY : "none")(${wallProp})`;
        const path = line(from, { x: at[0], y: at[1] }, 16);
        let i = 0;
        await c.d.hold(UNLOCKED, `a moment to start bone ${bone}`, c.budget);
        await c.d.dragProp(
          from,
          async () => {
            seen.push(await c.d.evaluate<string>(WALL));
            return i < path.length ? path[i++] : null;
          },
          c.budget,
        );
        await settle(c, `bone ${bone}`);
        if (truthy(await g(c, "skelsolved"))) continue;
        const wall = await c.d.evaluate<{ up: boolean; x: number }>(`((p) => ({ up: !!p?.visible, x: p ? p.anchorX : -1 }))(${wallProp})`);
        if (!wall.up || Math.abs(wall.x - at[0]) > 2) {
          throw new Error(
            `bone ${bone} did not set at ${at.join(", ")} (joints ${await g(c, "gConnectlist")}; pressed at ${from.x},${from.y}; ` +
              `the bone turn by turn ${seen.join(" ")})`,
          );
        }
      }
      await need(c, "skelsolved", "true", "the skeleton");
    },
  },

  /**
   * The Monkey temple's spider maze (m020, frame 556): the green spider walked
   * to the ball (the blue gem), the button held and the hand leading it a
   * straight run at a time along the cheapest way (src/maya.ts `beatCost`),
   * held at a corner until the runs ahead, as far as a corner off every
   * patrol, stay clear of where each red spider will be walking its beat
   * (`redFutures`), and planned again from wherever a leg ends — a hole, or
   * caught and sent back.
   */
  spiders: {
    args: [0, 0],
    wait: "quiet",
    sig: "spiders()",
    help: "walk the green spider through the maze to the blue gem, clear of the red ones",
    run: async (c) => {
      await spiders(c);
      await settle(c, "the blue gem");
    },
  },

  /** the Jaguar temple's mural (m041, frame 359): its four glyph wheels (`icon 1`…`4`), a click a step on */
  glyphs: {
    args: [4, 4],
    wait: "quiet",
    sig: "glyphs(1, 40, 57, 74)",
    help: "click the mural's four glyph wheels round to these pictures",
    run: async (c) => {
      for (let n = 1; n <= 4; n++) {
        const want = num(c, n - 1, `glyph ${n}`);
        for (let i = 0; i < 24; i++) {
          if ((await c.d.evaluate<number>(DEG(`icon ${n}`))) === want || truthy(await g(c, "boxopen"))) break;
          await clickThen(c, await propIn(c, `icon ${n}`), `glyph ${n}`, "quiet");
        }
      }
      await need(c, "boxopen", "true", "the mural's box");
    },
  },

  /**
   * The double pyramid's six skulls (m032, frame 282): the lizard walked round
   * the ring of 22 lights in an order that lights them all (src/maya.ts
   * `skullOrder`).
   */
  skulls: {
    args: [0, 0],
    wait: "quiet",
    sig: "skulls()",
    help: "press the six skulls in an order that lights all 22 lights",
    run: async (c) => {
      for (const s of skullOrder()) await clickThen(c, await propIn(c, `skulls${s}`), `skull ${s}`, "quiet");
    },
  },

  /**
   * The podium (m038, frame 229) weighed to 8 with debris 2, 4, 5, 6 and 7,
   * each let go over it at the height it has risen to by then
   * (`PodiumYOffSet`, src/maya.ts `PODIUM_RISE`).
   */
  podium: {
    args: [0, 0],
    wait: "quiet",
    sig: "podium()",
    help: "weigh the podium down to 8 with the debris round it",
    run: async (c) => {
      for (const piece of [2, 4, 5, 6, 7]) {
        const weight = await gNum(c, "podiumWeight");
        const from = await propIn(c, `debris${piece}`);
        await carry(c, from, { x: 320, y: 220 - PODIUM_RISE[weight] }, 14, `debris ${piece} to the podium`);
        const on = (await g(c, "gPodiumDebris")).split(",")[piece];
        if (on !== "1") throw new Error(`debris ${piece} did not stay on the podium (${await g(c, "gPodiumDebris")})`);
      }
      await need(c, "gPodiumSolved", "1", "the podium's weight");
    },
  },

  /**
   * The five stalactites (m039, frame 226): the tune rung back with the axe, a
   * drop at a time — the axe let go with its point 72 px above the
   * stalactite's (`DoHit`), and the ring let finish.
   */
  chime: {
    args: [1, Infinity],
    wait: "quiet",
    sig: "chime(5, 3, 4, 2, 2, 5, 5, 1)",
    help: "ring the stalactites in this order with the axe",
    run: async (c) => {
      for (let i = 0; i < c.step.args.length; i++) {
        const n = num(c, i, "a stalactite");
        const grab = await middle(c, "invmallet");
        const axe = await c.d.evaluate<{ x: number; y: number }>(`((p) => ({ x: p.anchorX, y: p.anchorY }))(${PROP("invmallet")})`);
        // the axe's own place lands where the hand lets go, less where it was held
        await carry(c, grab, { x: STALACTITE_X[n - 1] + grab.x - axe.x, y: 272 + grab.y - axe.y }, 10, `the axe to stalactite ${n}`);
        await c.d.hold(NOTHING_RUNNING, "the drop to ring", c.budget);
      }
      await c.d.hold(`${global("gMallet")} === "0"`, "the tune rung back", c.budget);
    },
  },

  /**
   * The yellow gem in the skeleton's hand (m040, frame 400, `shake`): held,
   * and tugged left and right past 10 px of it until it comes away.
   */
  tug: {
    args: [0, 0],
    wait: "quiet",
    sig: "tug()",
    help: "take hold of the yellow gem and tug it left and right until it comes away",
    run: async (c) => {
      const at = await propIn(c, "shake", [370, 385, 436, 435]);
      await c.d.hold(UNLOCKED, "a moment to take hold", c.budget);
      let i = 0;
      await c.d.dragProp(
        at,
        async () => {
          if (i >= 60 || (await g(c, "curinvprop")) === "invlizardgem") return null;
          return { x: i++ % 2 ? 390 : 422, y: 410 };
        },
        c.budget,
      );
      await settle(c, "the yellow gem");
      await need(c, "curinvprop", "invlizardgem", "the yellow gem");
    },
  },

  /**
   * The Sun temple's sliding stones (m024, frame 556), as shuffled by the
   * game's `random` on arrival: a 2×2 group at a time, each found by search
   * over its tiles and the hole in the cells still free (src/maya.ts
   * `slideTo`), the group missing a tile last. A shuffle whose last group
   * cannot be finished (half of them, by parity) is said so, and fails: the
   * remedy, stepping out and back for another, is the sheet's.
   */
  slider: {
    args: [0, 0],
    wait: "quiet",
    sig: "slider()",
    help: "slide the Sun temple's stones into their four pairs, as this shuffle allows",
    run: async (c) => {
      const board = async (): Promise<Board> => {
        const s = await c.d.evaluate<{ tiles: { t: number; x: number; y: number }[]; whole: boolean[]; hole: number }>(`(() => {
          const pr = (n) => window.dbg.session.propRuntime.get(n);
          const tiles = [];
          for (let t = 0; t < 16; t++) { const p = pr("small" + t); if (p && p.visible) tiles.push({ t, x: p.anchorX, y: p.anchorY }); }
          return { tiles, whole: [0, 1, 2, 3].map((g) => !!pr("large" + g)?.visible), hole: Number(${global("hole")}) };
        })()`);
        return boardOf(s.tiles, s.whole, s.hole);
      };
      const first = await board();
      const missing = [...new Array(16).keys()].find((t) => !first.cell.has(t))!;
      const last = Math.floor(missing / 4);
      // a player who counts the stones' parity sees it at a glance: half the
      // shuffles cannot be finished, and the remedy is another shuffle
      if (first.locked.size === 0 && !solvable(first, missing)) {
        throw new Error(`this shuffle cannot be slid out (tile ${missing} is the one taken away): step out and back for another`);
      }
      let clicks = 0;
      for (const grp of [0, 1, 2, 3].filter((x) => x !== last).concat(last)) {
        const b = await board();
        const tiles = [0, 1, 2, 3].map((i) => grp * 4 + i).filter((t) => t !== missing);
        const cells = tiles.map((t) => GROUP_CELLS[grp][t - grp * 4]);
        if (tiles.every((t) => !b.cell.has(t))) continue; // already whole and fixed
        const path = slideTo(b, tiles, cells);
        if (!path) throw new Error(`this shuffle cannot finish group ${grp} (tile ${missing} is the one taken away): step out and back for another`);
        for (const cell of path) {
          const t = [...(await board()).cell].find(([, at]) => at === cell)?.[0];
          if (t === undefined) throw new Error(`no stone on cell ${cell} to slide`);
          await clickThen(c, await propIn(c, `small${t}`), `tile ${t}`, "quiet");
          clicks++;
        }
      }
      // the stones are only judged as one is clicked (`grouper`): a last group
      // that the others' sliding already put in place wants one stone slid
      // into the hole and back
      if ((await g(c, "slidersolved")) !== "true") {
        const b = await board();
        const nextTo = new Set([b.hole - 4, b.hole + 4, b.hole % 4 ? b.hole - 1 : -1, b.hole % 4 < 3 ? b.hole + 1 : -1]);
        const t = [...b.cell].find(([, at]) => nextTo.has(at))?.[0];
        if (t !== undefined) {
          await clickThen(c, await propIn(c, `small${t}`), `tile ${t}`, "quiet");
          await clickThen(c, await propIn(c, `small${t}`), `tile ${t} back`, "quiet");
          clicks += 2;
        }
      }
      if (!(await c.d.tryHold(`${global("slidersolved")} === "true"`, c.budget))) {
        const b = await board();
        const large = await c.d.evaluate(`[0,1,2,3].map((g) => !!window.dbg.session.propRuntime.get("large" + g)?.visible)`);
        throw new Error(`the stones are slid and not solved (slidersolved ${await g(c, "slidersolved")}, large ${large}): ${JSON.stringify([...b.cell])}, hole ${b.hole}, fixed ${[...b.locked].join(",")}`);
      }
      c.say(`${clicks} slide(s)`);
    },
  },
};
