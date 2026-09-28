/**
 * The Maya (world M, disc three): from the beach where the crystal leaves you
 * to the Sun temple's gene pod and the crystal on.
 */
import { fail, ok, type Headless } from "../harness";
import { clickProp, clickRegion, drag, extent, goTo, propPoint, regionPoint, regions } from "../nav";
import { travel } from "./easter";

export const need = (h: Headless, name: string, want: string, what: string): void => {
  if (h.g(name) !== want) fail(`${what}: ${name} is ${h.g(name) || "unset"}, not ${want} (${h.here()})`);
};

/**
 * The carving from the green monster head on the beach (frame 7: `Button13`
 * opens the jaw, `Button14` on its last picture takes it, `getamulet`), and
 * the chameleon it becomes on the platform (frame 60, let go at x 265…385,
 * y 300…375, `amuletdrop`). A touch on the chameleon plays its colours
 * (`hitlizard`, written into `lizstring`), and the buttons under it answer
 * them back, colour v on `button{v-1}`: three rounds of four, five and six,
 * and it vanishes (chameleon).
 */
export async function chameleon(h: Headless): Promise<void> {
  await goTo(h, { stage: 2, frame: 7 });
  await clickRegion(h, "Button13", "the monster head");
  await h.until(() => h.session.currentFlat.toLowerCase() === "m0001.007.33", "the jaw open", 3000);
  await clickRegion(h, "Button14", "the carving");
  await h.settle("the carving");
  need(h, "amulet", "2", "the carving in hand");
  await goTo(h, { stage: 5, frame: 60 });
  const [x0, y0, x1, y1] = extent(h, "invamulet");
  await drag(h, { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) }, { x: 325, y: 337 }, 12, "the carving to the platform");
  need(h, "amulet", "0", "the carving on the platform");
  for (let round = 0; h.g("chameleon") !== "1"; round++) {
    if (round > 10) fail(`ten rounds and the chameleon stays (${h.here()})`);
    const empty = (): boolean => !h.g("lizstring") || h.g("lizstring") === "0";
    if (empty()) {
      const l = await propPoint(h, "lizard", [0, 0, 640, 480], 600);
      h.click(l.x, l.y);
      await h.settle("the chameleon's colours");
    }
    if (empty()) continue;
    const colours = h.g("lizstring").split(",").map(Number);
    for (const v of colours) {
      if (h.g("chameleon") === "1") break;
      const b = await propPoint(h, `button${v - 1}`, [0, 0, 640, 480], 120);
      h.click(b.x, b.y);
      await h.settle(`colour ${v}`);
    }
  }
  ok(`the carving, and the chameleon's colours answered back (${h.here()})`);
}

/**
 * The counting stones in the Castillo (stage 8, frame 904): a blue number, a
 * green one added to it, and the yellow sum (m008's `Button10`…`Button22`,
 * lines 5, bars, dots). The blues are 13, 14, 12 and 20, the greens add 2, 8, 9
 * and 1, and the yellows want 21, 13, 22 and 23 — so 13 + 8, 12 + 1, 20 + 2 and
 * 14 + 9, each stone once. All four sums shown, the handle comes down
 * (`lever`, leverpulled) and the skylight opens.
 */
const SUMS: [blue: string, green: string, sum: string][] = [
  ["Button11", "Button16", "Button19"], ["Button13", "Button18", "Button20"],
  ["Button14", "Button15", "Button21"], ["Button12", "Button17", "Button22"],
];

export async function counting(h: Headless): Promise<void> {
  await goTo(h, { stage: 8, frame: 904 });
  for (const trio of SUMS) for (const b of trio) await clickRegion(h, b, `the stone ${b}`);
  const l = await propPoint(h, "lever", [0, 0, 640, 480], 600);
  h.click(l.x, l.y);
  await h.settle("the handle");
  need(h, "leverpulled", "1", "the Castillo's handle");
  ok(`13 + 8, 12 + 1, 20 + 2, 14 + 9, and the handle (${h.here()})`);
}

/**
 * The four gods' dates. The crystal ball above the Castillo (M0003.121, its
 * regions A…E the states 0…4) is dragged to a god's face (morphgod), and the
 * calendar (frame 907) is turned to that god's date, which `checksolved` holds
 * whatever the steles showed: the skull's 12, 6, 12, the monkey's 0 or 3, 9,
 * 24, the jaguar's 6, 0, 6 and the lizard's 12, 30, 45. Its three wheels are
 * geared: a turn of the small one moves the middle one too, the middle one all
 * three, the big one the small one (m.shp `wheels`, `wheelup`/`wheeldown`,
 * three steps of 24, 36 and 48 a turn), so the turns are found by search.
 */
type Wheels = [number, number, number];
const MOD: Wheels = [24, 36, 48];
/** what one turn (+1 = the drag down, `wheelup`) of each wheel does to all three */
const TURN: Record<"a" | "b" | "c", Wheels> = { a: [-3, -3, 0], b: [-3, -3, 3], c: [3, 0, 3] };
const GODS: { god: number; ball: string; date: (w: Wheels) => boolean; flag: string }[] = [
  { god: 1, ball: "B", flag: "skullflag", date: ([a, b, c]) => a === 12 && b === 6 && c === 12 },
  { god: 2, ball: "C", flag: "monkeyflag", date: ([a, b, c]) => (a === 0 || a === 3) && b === 9 && c === 24 },
  { god: 3, ball: "D", flag: "jaguarflag", date: ([a, b, c]) => a === 6 && b === 0 && c === 6 },
  { god: 4, ball: "E", flag: "lizardflag", date: ([a, b, c]) => a === 12 && b === 30 && c === 45 },
];

function turnsTo(from: Wheels, done: (w: Wheels) => boolean): { wheel: "a" | "b" | "c"; dir: 1 | -1 }[] {
  const key = (w: Wheels): string => w.join(",");
  const prev = new Map<string, { at: Wheels; wheel: "a" | "b" | "c"; dir: 1 | -1 } | null>([[key(from), null]]);
  const queue: Wheels[] = [from];
  while (queue.length) {
    const at = queue.shift()!;
    if (done(at)) {
      const path: { wheel: "a" | "b" | "c"; dir: 1 | -1 }[] = [];
      for (let p = prev.get(key(at)); p; p = prev.get(key(p.at))) path.unshift({ wheel: p.wheel, dir: p.dir });
      return path;
    }
    for (const wheel of ["a", "b", "c"] as const)
      for (const dir of [1, -1] as const) {
        const next = at.map((v, i) => (((v + dir * TURN[wheel][i]) % MOD[i]) + MOD[i]) % MOD[i]) as Wheels;
        if (prev.has(key(next))) continue;
        prev.set(key(next), { at, wheel, dir });
        queue.push(next);
      }
  }
  return fail(`no turns of the calendar reach the date from ${from.join(", ")}`);
}

export async function calendar(h: Headless): Promise<void> {
  for (const { god, ball, date, flag } of GODS) {
    // the ball to the god: a drag from the region of its state to the god's
    await goTo(h, { stage: 9, frame: 121 });
    if (Number(h.g("morphgod")) !== god) {
      // the ball's regions are its base flat's: the face it shows is a flat
      // of its own with none (`pointinbutton (baseflat, …)`)
      const mid = (name: string): { x: number; y: number } => {
        const r = h.session.stageCtrl.flatRegion("M0003.121", name);
        if (!r) return fail(`the ball has no region ${name}`);
        return { x: Math.round((r.left + r.right) / 2), y: Math.round((r.top + r.bottom) / 2) };
      };
      const from = mid("ABCDE"[Number(h.g("morphgod"))]);
      const to = mid(ball);
      await drag(h, from, to, 16, `the ball to god ${god}`);
    }
    need(h, "morphgod", String(god), `the ball's face`);
    await goTo(h, { stage: 8, frame: 907 });
    const now = async (): Promise<Wheels> =>
      [Number(await h.eval('return (propdeg ("wheela"))')), Number(await h.eval('return (propdeg ("wheelb"))')), Number(await h.eval('return (propdeg ("wheelc"))'))];
    const path = turnsTo(await now(), date);
    for (const { wheel, dir } of path) {
      const at = await propPoint(h, `wheel${wheel}`, [0, 0, 640, 480], 60);
      const y = dir > 0 ? Math.min(at.y, 430) : Math.max(at.y, 50);
      await drag(h, { x: at.x, y }, { x: at.x, y: y + dir * 42 }, 8, `wheel ${wheel}`);
    }
    need(h, flag, "1", `god ${god}'s date (${(await now()).join(", ")})`);
  }
  ok(`the four gods' dates on the calendar (${h.here()})`);
}

/**
 * The Skull temple's hanging skeleton (m043, frame 802). The bones lie on the
 * floor (`ground0`…`ground17`); one picked up follows the hand, and let go it
 * sets if its joint (`connectinfo`: the first two numbers, from where it
 * hangs) lands on an open joint (`gConnectlist`, the shoulders and hips
 * `wall18`…`wall21` to start with) that takes any bone (100) or that one. It
 * snaps into place, and its own joint opens in turn unless it is an end (-1).
 * With no joint left open the skeleton is checked (`verify`): bones 0…12 each
 * within 10 px of their place (`wallpt`). So the order is found by playing
 * the table: a bone goes where it snaps into its own place.
 */
const BONE: Record<number, { h: number; v: number; oh?: number; ov?: number; z: number }> = {
  0: { h: 1, v: 18, oh: 1, ov: -16, z: 1 }, 1: { h: 2, v: 17, oh: 0, ov: -20, z: 100 },
  2: { h: 10, v: 28, oh: 5, ov: 27, z: 3 }, 3: { h: 6, v: 29, oh: 1, ov: -29, z: 100 },
  4: { h: 15, v: 19, z: -1 }, 5: { h: 1, v: 36, oh: 3, ov: -36, z: 100 },
  6: { h: -11, v: 50, z: -1 }, 7: { h: 6, v: 42, oh: 3, ov: -42, z: 100 },
  8: { h: 10, v: 59, z: -1 }, 9: { h: -4, v: 31, oh: 3, ov: -24, z: 10 },
  10: { h: 4, v: 12, oh: -1, ov: -12, z: 100 }, 11: { h: -1, v: 38, oh: 4, ov: -38, z: 100 },
  12: { h: -10, v: 25, z: -1 },
};
const JOINT: Record<number, { oh: number; ov: number }> = { 18: { oh: -56, ov: 162 }, 19: { oh: 45, ov: 162 }, 20: { oh: -34, ov: 34 }, 21: { oh: 17, ov: 34 } };
const PLACE: Record<number, [number, number]> = {
  0: [257, 93], 1: [256, 127], 2: [247, 179], 3: [245, 181], 4: [235, 229], 5: [369, 113], 6: [382, 199],
  7: [281, 249], 8: [275, 352], 9: [342, 237], 10: [341, 275], 11: [340, 328], 12: [355, 391],
};

/** the bones in an order that sets each in its place, with where to let each go */
function skeleton(): { bone: number; at: [number, number] }[] {
  const pos = new Map<number, [number, number]>([18, 19, 20, 21].map((j) => [j, [320, 240]]));
  let open = [18, 19, 20, 21];
  const order: { bone: number; at: [number, number] }[] = [];
  const left = new Set(Object.keys(BONE).map(Number));
  while (left.size) {
    let placed = false;
    for (const b of left) {
      for (const [i, j] of open.entries()) {
        const joint = j >= 18 ? { ...JOINT[j], z: 100 } : { oh: BONE[j].oh!, ov: BONE[j].ov!, z: BONE[j].z };
        if (joint.z !== 100 && joint.z !== b) continue;
        const [jx, jy] = pos.get(j)!;
        const at: [number, number] = [jx + joint.oh - BONE[b].h, jy - joint.ov + BONE[b].v];
        if (Math.abs(at[0] - PLACE[b][0]) > 10 || Math.abs(at[1] - PLACE[b][1]) > 10) continue;
        pos.set(b, at);
        order.push({ bone: b, at });
        open = [...open.slice(0, i), ...(BONE[b].z === -1 ? [] : [b]), ...open.slice(i + 1)];
        left.delete(b);
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) return fail(`no bone of ${[...left].join(", ")} sets on the joints ${open.join(", ")}`);
  }
  return order;
}

export async function skull(h: Headless): Promise<void> {
  await goTo(h, { stage: 43, frame: 802 });
  for (const { bone, at } of skeleton()) {
    const from = await propPoint(h, `ground${bone}`, [0, 380, 640, 480], 60);
    await drag(h, from, { x: at[0], y: at[1] }, 16, `bone ${bone}`);
    // set: still up on the wall where it snapped (an end bone closes its joint
    // and is not listed), unless it was the last and the skeleton is whole
    if (h.g("skelsolved") !== "1") {
      const up = Number(await h.eval(`return (propvisible ("wall${bone}"))`));
      const x = Number(await h.eval(`return (propxy ("wall${bone}", 1))`));
      if (!up || Math.abs(x - at[0]) > 2) fail(`bone ${bone} did not set at ${at.join(", ")} (joints ${h.g("gConnectlist")})`);
    }
  }
  need(h, "skelsolved", "1", "the skeleton");
  // its jaw opens (`openskull`) on the green gem (`getgem`), which goes into
  // the hole on the wall behind (frame 800, x 291…356, y 213…273, `gemdrop`)
  await clickRegion(h, "Button10", "the skull's jaw");
  await clickRegion(h, "Button10", "the green gem");
  need(h, "skullgem", "2", "the green gem in hand");
  await setGem(h, 43, 800, "invskullgem", "skullgem", [323, 243]);
  ok(`the skeleton hung, and its green gem in the wall (${h.here()})`);
}

/** a temple's gem let go in the hole it came for, and the temple's film (each temple's `gemdrop`) */
async function setGem(h: Headless, stage: number, frame: number, prop: string, global: string, hole: [number, number]): Promise<void> {
  await goTo(h, { stage, frame });
  const [x0, y0, x1, y1] = extent(h, prop);
  await drag(h, { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) }, { x: hole[0], y: hole[1] }, 14, `${prop} to its hole`, false);
  await h.until(() => h.g(global) === "0", `${prop} in its hole`, 600);
  await h.settle(`${prop}'s film`, 60_000);
}

/**
 * The Monkey temple's spider maze (m020, frame 556; the monkey head on frame
 * 518 wakes it, spideractive). With the button held, the green spider walks a
 * pixel a step toward the hand (`walkto`); the maze's walls (`bevel`) and the
 * monkey's mouth stop it; a hole takes it elsewhere — three always (`button24`,
 * `26`, `28`, then a few steps on by themselves), six only while a snake lies
 * across them, which that use moves on; and a red spider within 8 px sends it
 * back to the start (`walkout`). The blue gem is the ball at the bottom
 * (`ballout`). So the way is searched pixel by pixel over the hit test, and
 * walked a straight run at a time, and searched again if a red spider catches it.
 */
const HOLES: Record<string, { to: [number, number]; snake?: string }> = {
  button24: { to: [181, 351] }, button26: { to: [542, 422] }, button28: { to: [83, 45] },
  button10: { to: [156, 123], snake: "snakes0" }, button15: { to: [102, 421], snake: "snakes2" },
  button13: { to: [409, 287], snake: "snakes4" }, button21: { to: [366, 366], snake: "snakes10" },
  button20: { to: [578, 221], snake: "snakes8" }, button17: { to: [487, 264], snake: "snakes6" },
};

/** each red spider's beat (m.shp `red`: `red1`, `red2`, `red3`, then `red2` again, by its row) */
const BEAT: [number, number][][] = [
  [[56, 167], [60, 73], [179, 71]], [[95, 248], [95, 212], [58, 210]], [[280, 250], [279, 300], [169, 300]],
  [[311, 390], [308, 324], [206, 324]], [[581, 117], [579, 27], [429, 25]],
];

/** the cost of a step onto (x, y): dear within 14 px of an awake red spider's beat */
function beatCost(awake: number[]): (x: number, y: number) => number {
  const lines = awake.flatMap((r) => [[BEAT[r][0], BEAT[r][1]], [BEAT[r][1], BEAT[r][2]]] as [[number, number], [number, number]][]);
  return (x, y) => {
    for (const [[ax, ay], [bx, by]] of lines) {
      const len = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
      for (let t = 0; t <= len; t += 3) {
        const px = ax + ((bx - ax) * t) / len, py = ay + ((by - ay) * t) / len;
        if (Math.abs(px - x) < 14 && Math.abs(py - y) < 14) return 40;
      }
    }
    return 1;
  };
}

async function spiderPath(h: Headless): Promise<[number, number][]> {
  const vis = async (p: string): Promise<boolean> => Number(await h.eval(`return (propvisible ("${p}"))`)) === 1;
  const snakes = new Map<string, boolean>();
  for (const { snake } of Object.values(HOLES)) if (snake) snakes.set(snake, await vis(snake));
  // what `walkto` sees at a point: the maze drawn in (`bevel`), the spider not
  await h.eval('propvisible ("bevel", true)');
  await h.eval('propvisible ("green", false)');
  const W = 640, H = 480;
  const kind = new Array<string | undefined>(W * H);
  const at = (x: number, y: number): string => {
    const i = y * W + x;
    if (kind[i] === undefined) {
      const t = h.session.hitTestAt(x, y);
      kind[i] = t.type === "button" ? t.name.toLowerCase() : t.type === "prop" ? (["bevel", "mouth", "ballout"].includes(t.name) ? t.name : "") : "";
    }
    return kind[i]!;
  };
  const sx = Number(await h.eval('return (propxy ("green", 1))')), sy = Number(await h.eval('return (propxy ("green", 2))'));
  // the cheapest way, not the shortest: a step near an awake spider's beat
  // costs forty (a bucket queue, the costs being small whole numbers)
  const awake = [0, 1, 2, 3, 4].filter((r) => h.session.scheduler.isLoop("prop", `red${r}`));
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
        const k = at(nx, ny);
        if (k === "bevel" || k === "mouth") continue;
        const nd = d + costAt(nx, ny);
        if (k === "ballout") { if (nd < dist[j]) { dist[j] = nd; prev[j] = i; goal = j; } continue; }
        const hole = HOLES[k];
        if (k.startsWith("button") && hole) {
          if (hole.snake && !snakes.get(hole.snake)) continue;
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
        (buckets[nd] ??= []).push(j);
      }
    }
  }
  await h.eval('propvisible ("bevel", false)');
  await h.eval('propvisible ("green", true)');
  if (goal < 0) return fail(`no way through the spider maze from ${sx}, ${sy}`);
  const path: [number, number][] = [];
  for (let i = goal; i >= 0; i = prev[i]) path.unshift([i % W, (i / W) | 0]);
  return path;
}

export async function monkey(h: Headless): Promise<void> {
  await goTo(h, { stage: 20, frame: 518 });
  if (h.g("spideractive") !== "1") await clickRegion(h, "Button10", "the monkey head");
  await h.frame(60);
  await goTo(h, { stage: 20, frame: 556 });
  // read off the props themselves, every pass: a script call a pass each is too slow
  const prop = (n: string) => h.session.propRuntime.get(n);
  const green = async (): Promise<[number, number]> => [prop("green")?.anchorX ?? 0, prop("green")?.anchorY ?? 0];
  // where each red spider is, and how near is too near: a walking one comes
  // at you, a standing one only catches within its 8 px
  const reds = async (): Promise<[number, number, number][]> =>
    [0, 1, 2, 3, 4].map((r) => prop(`red${r}`)).filter((p) => p?.visible).map((p) => [p!.anchorX, p!.anchorY, p!.stateName === "walk" ? 1 : 0.25]);
  const got = (): boolean => h.g("curinvprop") === "invmonkeygem";
  let catches = 0;
  for (let legs = 0; !got(); legs++) {
    if (legs > 60 || catches > 12) fail(`the spider never reached the ball (${catches} times caught, ${h.here()})`);
    // at rest: after the walk out of the mouth, or after a hole's few steps
    for (let n = 0; n < 3000; n++) {
      if (!h.host.director.inputLocked && (await green())[0] > 0 && !h.running().some((r) => /walkto|easywalk|walkout/.test(r))) break;
      await h.frame(1);
    }
    const path = await spiderPath(h);
    const corners: [number, number][] = [];
    for (let k = 1; k < path.length; k++) {
      const [a, b, c] = [path[k - 1], path[k], path[k + 1]];
      // a hole ends the walk, so a leg ends in it (the cell before the jump),
      // and the next is planned from its far side
      if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 1) {
        // aimed a few pixels INTO the hole: the step onto it is the one that jumps
        const p0 = path[k - 2] ?? a;
        corners.push([a[0] + 4 * Math.sign(a[0] - p0[0]), a[1] + 4 * Math.sign(a[1] - p0[1])]);
        break;
      }
      if (!c || c[0] - b[0] !== b[0] - a[0] || c[1] - b[1] !== b[1] - a[1]) corners.push(b);
    }
    // pressed on bare floor near the spider: not on it (its own prop takes the
    // click) and not in a hole (whose region does)
    const [sx0, sy0] = await green();
    let press: [number, number] = corners[0];
    search: for (let r = 12; r < 80; r += 4)
      for (let a = 0; a < 16; a++) {
        const px = Math.round(sx0 + r * Math.cos((a * Math.PI) / 8)), py = Math.round(sy0 + r * Math.sin((a * Math.PI) / 8));
        if (h.session.hitTestAt(px, py).type === "flat") { press = [px, py]; break search; }
      }
    await h.until(() => !h.host.director.inputLocked, "a moment between the red spiders' steps", 600);
    h.mouseDown(press[0], press[1]);
    h.moveTo(corners[0][0], corners[0][1]);
    await h.until(() => h.running().some((r) => r.includes("walkto")), "the spider to walk", 60);
    const startAt = await green();
    let ended = "";
    // a straight run is set out on only when no walking red spider is within
    // 50 px of any of it (a standing one, 12)
    const clear = async (a: [number, number], b: [number, number], margin: number): Promise<boolean> => {
      const rs = await reds();
      const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1);
      for (let t = 0; t <= steps; t += 2) {
        const px = a[0] + ((b[0] - a[0]) * t) / steps, py = a[1] + ((b[1] - a[1]) * t) / steps;
        if (rs.some(([rx, ry, k]) => Math.abs(rx - px) < margin * k && Math.abs(ry - py) < margin * k)) return false;
      }
      return true;
    };
    let back: [number, number] = await green();
    let last = back;
    for (const [x, y] of corners) {
      let going = false;
      for (let n = 0; n < 4000 && !ended; n++) {
        await h.frame(1);
        if (got()) ended = "the ball";
        else if (!h.running().some((r) => r.includes("walkto"))) ended = "the walk";
        if (ended) {
            break;
        }
        const here = await green();
        last = here;
        if (Math.abs(here[0] - x) + Math.abs(here[1] - y) <= 1) break;
        // wait at the corner until the whole run is clear, then commit to it:
        // standing in the middle of a corridor is what gets the spider eaten
        if (!going && (await clear(here, [x, y], 50))) going = true;
        h.moveTo(going ? x : here[0], going ? y : here[1]);
      }
      if (ended) break;
      back = [x, y];
    }
    h.mouseUp(corners.at(-1)![0], corners.at(-1)![1]);
    await h.frame(3);
    const [gx, gy] = await green();
    if (!got() && gx === 310 && gy === 101 && (startAt[0] !== 310 || startAt[1] !== 101 || ended)) catches++;
    if (process.env.DEBUG) console.log(`leg ${legs + 1}: ${startAt} -> ${gx},${gy} (${ended || "held"}), caught ${catches}`);
  }
  await h.settle("the blue gem");
  // and into its hole in the temple (frame 508, x 272…341, y 221…282)
  await setGem(h, 42, 508, "invmonkeygem", "monkeygem", [306, 251]);
  ok(`the spider through the maze, and the blue gem in the wall (${h.here()})`);
}

/**
 * The Jaguar temple. The mural (m041, frame 359) has four glyph wheels
 * (`icon 1`…`4`, each of 24 pictures, a click one on) and its box opens on 1,
 * 40, 57 and 74 (`checksolved`), whatever the colours and symbols round it
 * say: the golden jaguar head (`getjaghead`). Let go over the fire (m021, frame
 * 353, x 390…540, y 220…315) it melts (`jagheaddrop`); blood from the stone
 * cup (`Button10`) cools it (`bloodspill`, coolcount), and seventy seconds on
 * the gold heart can be lifted from the mould (frame 355, its eighth picture,
 * `grabme`). In the green statue's pot (m014, frame 307, x 280…390, y
 * 240…410, `heartdrop`) it gives up the red gem, which goes into the temple's
 * hole (m046, frame 301).
 */
export async function jaguar(h: Headless): Promise<void> {
  await goTo(h, { stage: 41, frame: 359 });
  const WANT = [1, 40, 57, 74];
  for (let n = 1; n <= 4; n++) {
    const name = `icon ${n}`;
    for (let i = 0; i < 24; i++) {
      if (Number(await h.eval(`return (propdeg ("${name}"))`)) === WANT[n - 1] || h.g("boxopen") === "1") break;
      const at = await propPoint(h, name, [0, 0, 640, 480], 60);
      h.click(at.x, at.y);
      await h.settle(`glyph ${n}`);
    }
  }
  need(h, "boxopen", "1", "the mural's box");
  await clickRegion(h, "Button12", "the golden jaguar head");
  need(h, "jaghead", "2", "the jaguar head in hand");
  await goTo(h, { stage: 21, frame: 353 });
  const [x0, y0, x1, y1] = extent(h, "invjaghead");
  await drag(h, { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) }, { x: 465, y: 267 }, 14, "the head to the fire");
  need(h, "jaghead", "0", "the head in the fire");
  // the gold runs into the mould, and the fire flickers on with the cup in reach
  await h.until(() => regions(h).some((r) => r.name === "Button10"), "the melt to run", 6000);
  await clickRegion(h, "Button10", "the blood");
  await h.until(() => Number(h.g("coolcount")) >= 0, "the blood on the gold", 3000);
  await goTo(h, { stage: 21, frame: 355 });
  await h.until(() => h.session.currentFlat.toLowerCase() === "m0010.355.9", "the gold heart to cool", 20_000);
  await clickRegion(h, "Button11", "the gold heart");
  await h.until(() => h.g("heart") === "2", "the heart in hand", 600);
  await goTo(h, { stage: 14, frame: 307 });
  const [a0, b0, a1, b1] = extent(h, "invheart");
  await drag(h, { x: Math.round((a0 + a1) / 2), y: Math.round((b0 + b1) / 2) }, { x: 335, y: 325 }, 14, "the heart to the pot");
  await h.until(() => h.session.currentFlat.toLowerCase() === "m0010.307.16", "the pot to open", 3000);
  await clickRegion(h, "Button11", "the red gem");
  await setGem(h, 46, 301, "invjaggem", "jaggem", [330, 206]);
  ok(`the jaguar head melted into a heart, and its red gem in the wall (${h.here()})`);
}

/**
 * The Lizard temple's bridge. The statue across the chasm (m016, frame 199)
 * plays frog, spider and scorpion — its three regions, `hitbut (1…3)`, against
 * the game's own `random (3)` — and three games won (gBridgeSolved) raise the
 * bridge as you step back (gBridgeUp).
 */
export async function bridge(h: Headless): Promise<void> {
  await goTo(h, { stage: 16, frame: 199 });
  let rounds = 0;
  while (h.g("gBridgeSolved") !== "1") {
    if (++rounds > 300) fail(`three hundred rounds and the statue still wins (${h.here()})`);
    await clickRegion(h, "Button12", `round ${rounds}`);
  }
  await goTo(h, (s) => s.stage !== 16);
  await h.until(() => h.g("gBridgeUp") === "1", "the bridge to rise", 6000);
  await h.settle("the bridge");
  ok(`the statue beaten in ${rounds} rounds, and the bridge up (${h.here()})`);
}

/**
 * Past the bridge, the stone with two eye sockets (m018, frame 100). The
 * orange gem is in the pink flower (frame 103, when it has opened: `lefteye`
 * on its last picture) and the green one the spider lowers (frame 217); each
 * goes into its socket (its own region, `gemdrop` and `gemdrop2`). The orange
 * eye pressed (`righteye` on the stone's second picture), the machete comes
 * down, and four chops of it (`machette`) clear the vines (righteye 0).
 */
export async function eyes(h: Headless): Promise<void> {
  const socket = async (prop: string, region: string, global: string): Promise<void> => {
    await goTo(h, { stage: 18, frame: 100 });
    const [x0, y0, x1, y1] = extent(h, prop);
    const to = regionPoint(h, region);
    await drag(h, { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) }, to, 14, `${prop} to its socket`);
    need(h, global, "1", `the ${region} socket`);
  };
  await goTo(h, { stage: 18, frame: 103 });
  await h.until(() => regions(h).some((r) => r.name === "lefteye"), "the flower to open", 6000);
  await clickRegion(h, "lefteye", "the orange gem");
  await socket("invlefteye", "lefteye", "lefteye");
  await goTo(h, { stage: 18, frame: 217 });
  await h.until(() => regions(h).some((r) => r.name === "righteye"), "the spider to lower the gem", 6000);
  await clickRegion(h, "righteye", "the green gem");
  await socket("invrighteye", "righteye", "righteye");
  await clickRegion(h, "righteye", "the orange eye");
  for (let chops = 0; h.g("righteye") !== "0"; chops++) {
    if (chops > 8) fail(`the vines stand after eight chops (${h.here()})`);
    await clickRegion(h, "machette", `the machete, ${chops ? `chop ${chops}` : "taken"}`);
  }
  ok(`both eyes in the stone, and the vines cut (${h.here()})`);
}

/**
 * The cracked heart (m044, frame 290), let go in the yellow bowl (m031, frame
 * 204, x 216…420, y 380…480, `heartdrop`), wakes the double pyramid (m032,
 * frame 282). Its six skulls walk the lizard round a ring of 22 lights, 4, 5
 * or 8 steps forward or 5, 6 or 8 back (`skulls0`…`5`), each a set number of
 * times (`left`: 3, 5, 4, 4, 3, 3 — 22 in all), and the light it lands on
 * toggles (`popskull`); all 22 lit, the golden salamander is yours
 * (`solveit`). The page on the floor spells an order out in the journal's
 * numbers; the search here finds one from the script's own table. The
 * salamander goes into the hatch (frame 251, x 230…420, y 240…480,
 * `lizarddrop`).
 */
const SKULL_STEPS = [4, 5, 8, -5, -6, -8];
const SKULL_USES = [3, 5, 4, 4, 3, 3];

function skullOrder(): number[] {
  const uses = [...SKULL_USES];
  const lit = new Array<boolean>(22).fill(false);
  const order: number[] = [];
  const dfs = (at: number): boolean => {
    if (order.length === 22) return true;
    for (let s = 0; s < 6; s++) {
      if (!uses[s]) continue;
      const next = (((at + SKULL_STEPS[s]) % 22) + 22) % 22;
      if (lit[next]) continue;
      uses[s]--;
      lit[next] = true;
      order.push(s);
      if (dfs(next)) return true;
      order.pop();
      lit[next] = false;
      uses[s]++;
    }
    return false;
  };
  return dfs(0) ? order : fail("no order of the skulls lights all 22");
}

export async function salamander(h: Headless): Promise<void> {
  await goTo(h, { stage: 44, frame: 290 });
  await clickRegion(h, "Button10", "the cracked heart");
  need(h, "redheart", "2", "the cracked heart in hand");
  await goTo(h, { stage: 31, frame: 204 });
  const [x0, y0, x1, y1] = extent(h, "invredheart");
  await drag(h, { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) }, { x: 318, y: 430 }, 14, "the heart to the bowl", false);
  await h.until(() => h.g("redheart") === "0", "the heart in the bowl", 600);
  await h.settle("the bowl's film", 60_000);
  await goTo(h, { stage: 32, frame: 282 });
  for (const s of skullOrder()) {
    const at = await propPoint(h, `skulls${s}`, [0, 0, 640, 480], 120);
    h.click(at.x, at.y);
    await h.settle(`skull ${s}`);
  }
  await h.until(() => h.g("curinvprop") === "invlizard", "the golden salamander", 600);
  await goTo(h, { stage: 31, frame: 251 });
  if (h.g("draweropen") !== "1") await clickRegion(h, "Button11", "the hatch");
  await h.until(() => h.session.currentFlat.toLowerCase() === "m0011.251.71", "the hatch open", 3000);
  const [a0, b0, a1, b1] = extent(h, "invlizard");
  await drag(h, { x: Math.round((a0 + a1) / 2), y: Math.round((b0 + b1) / 2) }, { x: 325, y: 360 }, 14, "the salamander to the hatch");
  await h.until(() => h.g("goldlizard") === "0", "the salamander in the hatch", 600);
  await h.settle("the hatch");
  ok(`the heart in the bowl, the 22 lights, and the golden salamander in the hatch (${h.here()})`);
}

/**
 * The Maya's gene pod, on the podium in the Lizard temple (m038, frame 229,
 * `PodM`, `TakePod`, haspodM). Taken, the podium rises under the mallet's
 * weight alone and opens a compartment (`OpenPodiumDoor`): the axe
 * (`Button10`, `GetMallet`). Then the podium has to weigh 8 with pieces 2, 4,
 * 5, 6 and 7 of the debris round it and no mallet (`CalcPodium`, gPodiumSolved):
 * each is let go over the podium, x 190…448 and y, less the podium's own rise
 * at its weight then (`PodiumYOffSet`), 170…270.
 */
const PODIUM_RISE: Record<number, number> = { 0: 180, 1: 110, 2: 70, 3: 34, 4: -4, 5: -30, 6: -48, 7: -70, 8: -92, 9: -116 };

export async function mayaPod(h: Headless): Promise<void> {
  await goTo(h, { stage: 38, frame: 229 });
  await clickRegion(h, "PodM", "the gene pod");
  await h.until(() => h.g("haspodM") === "1", "the Maya's gene pod", 20_000);
  await h.settle("the pod's film", 60_000);
  await h.until(() => regions(h).some((r) => r.name === "Button10"), "the podium's compartment", 6000);
  await clickRegion(h, "Button10", "the axe");
  await h.until(() => h.g("gMallet") === "2", "the axe in hand", 600);
  await h.settle("the compartment");
  for (const piece of [2, 4, 5, 6, 7]) {
    const weight = Number(h.g("podiumWeight"));
    const from = await propPoint(h, `debris${piece}`, [0, 0, 640, 480], 120);
    await drag(h, from, { x: 320, y: 220 - PODIUM_RISE[weight] }, 14, `debris ${piece} to the podium`);
    if (h.g("gPodiumDebris").split(",")[piece] !== "1") fail(`debris ${piece} did not stay on the podium (${h.g("gPodiumDebris")})`);
  }
  need(h, "gPodiumSolved", "1", "the podium's weight");
  ok(`the Maya's gene pod, the axe, and the podium at 8 (${h.here()})`);
}

/**
 * The five stalactites (m039, frame 226). The axe symbol (`Button15`) plays
 * the drops' tune, and the axe, let go with a point 72 px above it on a
 * stalactite (`button10`…`14`, `DoHit`), rings that one; the tune rung back —
 * "5 3 4 2 2 5 5 1", no more than five seconds apart (`dingone`) — opens the
 * way on (gMallet 0).
 */
const STALACTITE_X = [155, 246, 324, 399, 469];

export async function stalactites(h: Headless): Promise<void> {
  await goTo(h, { stage: 39, frame: 226 });
  await clickRegion(h, "Button15", "the tune");
  for (const n of [5, 3, 4, 2, 2, 5, 5, 1]) {
    const axe = h.session.propRuntime.get("invmallet")!;
    const [x0, y0, x1, y1] = extent(h, "invmallet");
    const grab = { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) };
    // the axe's own place lands where the hand lets go, less where it was held
    const to = { x: STALACTITE_X[n - 1] + grab.x - axe.anchorX, y: 272 + grab.y - axe.anchorY };
    await drag(h, grab, to, 10, `the axe to stalactite ${n}`);
    await h.until(() => !h.running().length, "the drop to ring", 600);
  }
  await h.until(() => h.g("gMallet") === "0", "the tune rung back", 600);
  await h.settle("the way on");
  ok(`5 3 4 2 2 5 5 1 on the stalactites (${h.here()})`);
}

/**
 * The yellow gem in the skeleton's hand (m040, frame 400, `shake` at 405,
 * 412): held and tugged left and right past 10 px of it, inside x 370…436, y
 * 385…435, twenty times, and it comes away (`invlizardgem`); it goes into the
 * Lizard temple's hole (m030, frame 208, x 296…346, y 172…220).
 */
export async function yellowGem(h: Headless): Promise<void> {
  await goTo(h, { stage: 40, frame: 400 });
  const at = await propPoint(h, "shake", [370, 385, 436, 435], 120);
  await h.until(() => !h.host.director.inputLocked, "a moment to take hold", 600);
  h.mouseDown(at.x, at.y);
  for (let i = 0; i < 60 && h.g("curinvprop") !== "invlizardgem"; i++) {
    h.moveTo(i % 2 ? 390 : 422, 410);
    await h.frame(2);
  }
  h.mouseUp(405, 410);
  await h.settle("the yellow gem");
  need(h, "curinvprop", "invlizardgem", "the yellow gem");
  await setGem(h, 30, 208, "invlizardgem", "lizardgem", [321, 196]);
  ok(`the yellow gem tugged free, and in the Lizard temple's wall (${h.here()})`);
}

/**
 * The way into the Sun temple. The orange eye pressed back on the stone (m018,
 * `leftjungle`, lefteye 0) opens the path to the purple gem (m022, frame 423,
 * `jewel`, with the four temples' gems set), which goes into the Sun temple's
 * door (m023, frame 444, its `button10`, `gemdrop`, doorcenter 0).
 */
export async function sunDoor(h: Headless): Promise<void> {
  await goTo(h, { stage: 18, frame: 100 });
  if (h.g("lefteye") !== "0") {
    const eye = await propPoint(h, "leftjungle", [0, 0, 640, 480], 120);
    h.click(eye.x, eye.y);
    await h.settle("the orange eye");
  }
  need(h, "lefteye", "0", "the orange eye pressed back");
  await goTo(h, { stage: 22, frame: 423 });
  await clickRegion(h, "jewel", "the purple gem");
  need(h, "doorcenter", "2", "the purple gem in hand");
  await goTo(h, { stage: 23, frame: 444 });
  const [x0, y0, x1, y1] = extent(h, "invdoorcenter");
  await drag(h, { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) }, regionPoint(h, "Button10"), 14, "the purple gem to the door", false);
  await h.until(() => h.g("doorcenter") === "0", "the purple gem in the door", 600);
  await h.settle("the Sun temple's door", 60_000);
  ok(`the purple gem in the Sun temple's door (${h.here()})`);
}

/**
 * The Sun temple's sliding stones (m024, frame 556): sixteen small tiles
 * (`small0`…`15`) in a 4×4, shuffled on arrival by the game's own `random`,
 * and one of them taken away to leave the hole. Each 2×2 corner is one pair of
 * figures (`grouper`): tiles 0…3 top left, 8…11 top right, 4…7 bottom left,
 * 12…15 bottom right, and the moment a group is whole it is fixed. So the
 * route does what a player does, a group at a time — each found by a search
 * over that group's tiles and the hole in the cells still free — with the
 * group missing a tile last. When that last group cannot be finished (half
 * the shuffles, by parity), it steps out and back for a new shuffle.
 */
const GROUP_CELLS = [[0, 1, 4, 5], [8, 9, 12, 13], [2, 3, 6, 7], [10, 11, 14, 15]];

type Board = { cell: Map<number, number>; hole: number; locked: Set<number> };

function readBoard(h: Headless): Board {
  const cell = new Map<number, number>();
  for (let t = 0; t < 16; t++) {
    const p = h.session.propRuntime.get(`small${t}`);
    if (!p?.visible) continue;
    const col = Math.floor((p.anchorX - 221) / 56), row = Math.floor((p.anchorY - 231) / 44);
    cell.set(t, row * 4 + col);
  }
  const locked = new Set<number>();
  for (let g = 0; g < 4; g++) if (h.session.propRuntime.get(`large${g}`)?.visible) for (const c of GROUP_CELLS[g]) locked.add(c);
  return { cell, hole: Number(h.g("hole")), locked };
}

/** the cells to click, in turn, to bring `tiles` onto `cells` */
function slideTo(board: Board, tiles: number[], cells: number[]): number[] | null {
  const adj = (c: number): number[] =>
    [c - 4, c + 4, c % 4 ? c - 1 : -1, c % 4 < 3 ? c + 1 : -1].filter((n) => n >= 0 && n < 16 && !board.locked.has(n));
  const key = (hole: number, pos: number[]): string => `${hole}|${pos.join(",")}`;
  const start = tiles.map((t) => board.cell.get(t)!);
  const done = (pos: number[]): boolean => pos.every((p, i) => p === cells[i]);
  const prev = new Map<string, { k: string; click: number } | null>([[key(board.hole, start), null]]);
  const queue: [number, number[]][] = [[board.hole, start]];
  for (let q = 0; q < queue.length; q++) {
    const [hole, pos] = queue[q];
    if (done(pos)) {
      const clicks: number[] = [];
      for (let p = prev.get(key(hole, pos)); p; p = prev.get(p.k)) clicks.unshift(p.click);
      return clicks;
    }
    for (const c of adj(hole)) {
      const next = pos.map((p) => (p === c ? hole : p));
      const k = key(c, next);
      if (prev.has(k)) continue;
      prev.set(k, { k: key(hole, pos), click: c });
      queue.push([c, next]);
    }
  }
  return null;
}

export async function slider(h: Headless): Promise<void> {
  for (let shuffle = 0; h.g("slidersolved") !== "1"; shuffle++) {
    if (shuffle > 8) fail(`eight shuffles and the Sun temple's stones never came out (${h.here()})`);
    if (shuffle) {
      await goTo(h, (s) => s.stage !== 24 || s.frame !== 556);
    }
    await goTo(h, { stage: 24, frame: 556 });
    const missing = [...Array(16).keys()].find((t) => !h.session.propRuntime.get(`small${t}`)?.visible)!;
    const last = Math.floor(missing / 4);
    const order = [0, 1, 2, 3].filter((g) => g !== last).concat(last);
    // the groups by the tile number: 0…3, 4…7, 8…11, 12…15 → their corners
    const CORNER = [GROUP_CELLS[0], GROUP_CELLS[1], GROUP_CELLS[2], GROUP_CELLS[3]];
    let stuck = false;
    for (const g of order) {
      const board = readBoard(h);
      const tiles = [0, 1, 2, 3].map((i) => g * 4 + i).filter((t) => t !== missing);
      const cells = tiles.map((t) => CORNER[g][t - g * 4]);
      if (tiles.every((t) => !board.cell.has(t))) continue; // already whole and fixed
      const clicks = slideTo(board, tiles, cells);
      if (!clicks) { stuck = true; break; }
      for (const c of clicks) {
        const t = [...readBoard(h).cell].find(([, at]) => at === c)?.[0];
        if (t === undefined) { stuck = true; break; }
        const at = await propPoint(h, `small${t}`, [0, 0, 640, 480], 60);
        h.click(at.x, at.y);
        await h.settle(`tile ${t}`);
      }
      if (stuck) break;
    }
    if (process.env.DEBUG) console.log(`shuffle ${shuffle + 1}: ${h.g("slidersolved") === "1" ? "solved" : "stuck"}`);
  }
  ok(`the Sun temple's stones in their four pairs (${h.here()})`);
}

/** through the Sun temple to the professor's third console (m047, frame 101), and its second button: the Anasazi */
export async function toAnasazi(h: Headless): Promise<void> {
  await goTo(h, { stage: 47, frame: 101 });
  ok(`through the Sun temple to the console (${h.here()})`);
  await travel(h, "Button11", "A");
}

/** the Maya from the beach to the Anasazi */
export async function playMaya(h: Headless): Promise<void> {
  await chameleon(h);
  await counting(h);
  await calendar(h);
  await skull(h);
  await monkey(h);
  await jaguar(h);
  await bridge(h);
  await eyes(h);
  await salamander(h);
  await mayaPod(h);
  await stalactites(h);
  await yellowGem(h);
  await sunDoor(h);
  await slider(h);
  await toAnasazi(h);
}
