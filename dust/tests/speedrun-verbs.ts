/**
 * Dust's own speedrun verbs (`src/speedrun/actions.ts`), driven against a world
 * that answers the same questions the page does.
 *
 *   npx vitest run dust/tests/speedrun-verbs.ts
 *
 * Every verb here talks to the game through strings — expressions over
 * `window.dbg` that the page driver evaluates — so a verb that compiles can
 * still ask a question the page cannot answer. The fake below EVALUATES those
 * strings, verbatim, against a small town laid out the way a translated set is
 * (`scenes`, `sceneLocation`, `views`, `transitions`), and moves when it is
 * pressed. Each verb is therefore tested from its sheet line inward: parsed by
 * the real parser against Dust's vocabulary, run against the real core `face`,
 * `up` and `right`, and judged by where the world ended up.
 *
 * What each verb is held to is the reason it was written, as its own notes tell
 * it: `goto` plans one way down roads and re-plans when the world moves under
 * it; `give` ends at the release; `takeInHand` reads the panel before hunting
 * the room; `offer` works the picker the 55555 plaque opens; `doorAt` clicks
 * where the SCENE shows through, not the person standing in the doorway;
 * `talkOut` never spends the same reply twice on the same plaque.
 *
 * Two engine verbs are stood in for: `say` and `accost`. Both are the engine's
 * (engine/src/web/speedrun/actions-core.ts), both drive a conversation through
 * a dozen readings this fake has no reason to model, and what is under test
 * here is which reply Dust's verbs ASK for and when — so those two are spies
 * that answer the way a conversation would.
 */
import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSheet } from "@dreamfactory/engine/web/speedrun/sheet";
import { CORE_ACTIONS } from "@dreamfactory/engine/web/speedrun/actions-core";
import type { ActionContext } from "@dreamfactory/engine/web/speedrun/action";
import type { HoldOptions, Point, SpeedrunDriver } from "@dreamfactory/engine/web/speedrun/driver";
import { DUST_ACTIONS, VERBS, resolve } from "../src/speedrun/actions";

/* ------------------------------------------------------------------ *
 * The town
 * ------------------------------------------------------------------ */

const DIRS = ["north", "east", "south", "west"] as const;
const STEP: Record<(typeof DIRS)[number], [number, number]> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
};
/** the game's own spelling — letter for x, number for z, both 1-based */
const sceneName = (x: number, z: number): string => `scene ${"abc"[x]}${z + 1}`;

interface Scene {
  sceneName: string;
  sceneLocation: [number, number, number];
  build: number;
  views: { viewName: string; viewID: number }[];
}

/**
 * A 3x3 town whose middle cell is built on: eight cells of street round a
 * block, every adjacency a road each way, each authored separately — the shape
 * the real town has (110 roads over 52 cells). `oneWay` removes one direction.
 */
function town(oneWay?: { from: [number, number]; dir: (typeof DIRS)[number] }) {
  const scenes: Scene[] = [];
  const id = (x: number, z: number, d: number) => (z * 3 + x) * 10 + d + 1;
  const open = (x: number, z: number) => x >= 0 && z >= 0 && x < 3 && z < 3 && !(x === 1 && z === 1);
  for (let z = 0; z < 3; z++) {
    for (let x = 0; x < 3; x++) {
      scenes.push({
        sceneName: sceneName(x, z).toUpperCase(),
        sceneLocation: [x * 256 + 128, 0, z * 256 + 128],
        build: open(x, z) ? 0 : 1,
        views: open(x, z) ? DIRS.map((d, i) => ({ viewName: d, viewID: id(x, z, i) })) : [],
      });
    }
  }
  const transitions: { viewIDstart: number; viewIDend: number }[] = [];
  for (let z = 0; z < 3; z++) {
    for (let x = 0; x < 3; x++) {
      if (!open(x, z)) continue;
      DIRS.forEach((d, i) => {
        const [dx, dz] = STEP[d];
        if (!open(x + dx, z + dz)) return;
        if (oneWay && oneWay.from[0] === x && oneWay.from[1] === z && oneWay.dir === d) return;
        transitions.push({ viewIDstart: id(x, z, i), viewIDend: id(x + dx, z + dz, i) });
      });
    }
  }
  return { scenes, transitions };
}

/**
 * The page, as far as Dust's verbs can see it: `window.dbg.session` and
 * `window.dbg.viewer`, plus the hooks a test uses to make the world answer.
 */
class World {
  set = town();
  sceneIdx = 0;
  viewIdx = 0;
  setFile = "TOWN.SET";
  flat = "mainpanel";
  conversing = false;
  speaking = false;
  choices: { id: number; text: string }[] = [];
  globals = new Map<string, unknown>();
  props = new Map<string, { owner: string; visible: boolean; x: number; y: number }>();
  actors = new Map<string, { x: number; z: number }>();
  /** the stage's region table — null where the panel was opened over another stage */
  regions: Record<string, { left: number; top: number; right: number; bottom: number }> = {};
  /** what the engine's hit test says is under a point */
  hitTest: (x: number, y: number) => { type: string } | null = () => ({ type: "scene" });
  aimAt: Record<string, Point> = {};
  loadSave: ((name: string) => Promise<boolean>) | undefined;

  /* the hooks, each defaulting to "nothing happens" */
  onArrive: (name: string) => void = () => {};
  onClick: (x: number, y: number) => void = () => {};
  onHold: (x: number, y: number) => void = () => {};
  onKey: (name: string) => boolean = () => false;
  onTick: () => void = () => {};

  window: { dbg: Record<string, unknown>; __srLoad?: unknown };

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const w = this;
    const propxy = (_i: unknown, [name, axis]: [string, number]) => {
      const p = w.props.get(String(name).toLowerCase());
      if (!p) return NaN;
      return axis === 1 ? p.x : p.y;
    };
    const actorxyz = (_i: unknown, [name, axis]: [string, number]) => {
      const a = w.actors.get(String(name).toLowerCase());
      if (!a) return NaN;
      return (axis === 1 ? a.x : a.z) * 256 + 128;
    };
    const propowner = (_i: unknown, [name]: [string]) => w.props.get(String(name).toLowerCase())?.owner ?? "";
    const session = {
      get currentSetFile() { return w.setFile; },
      get currentFlat() { return w.flat; },
      viewShowing: true,
      events: [] as unknown[],
      interp: {
        globals: w.globals,
        builtins: new Map<string, unknown>([["propxy", propxy], ["actorxyz", actorxyz], ["propowner", propowner]]),
      },
      propRuntime: {
        get props() { return w.props; },
        get: (n: string) => w.props.get(n),
      },
      stageCtrl: {
        flatRegion: (flat: string, name: string) => w.regions[`${flat}/${name}`] ?? null,
        flatButtonNames: () => [],
      },
      pollingInput: () => w.flat === "avatar" || w.globals.get("polling") === 1,
      hitTestAt: (x: number, y: number) => w.hitTest(x, y),
      scheduler: { isWalk: () => false },
    };
    const viewer = {
      get set() { return w.set; },
      get scene() { return w.set.scenes[w.sceneIdx]; },
      get sceneIdx() { return w.sceneIdx; },
      get viewIdx() { return w.viewIdx; },
      get conversing() { return w.conversing; },
      get speaking() { return w.speaking; },
      get choices() { return w.choices; },
      inputLocked: false,
      moviePlaying: false,
      movieRegions: [],
      movieFile: "",
    };
    this.window = {
      dbg: {
        session,
        viewer,
        get loadSave() { return w.loadSave; },
      },
    };
  }

  /** stand on a cell, facing a way */
  standAt(x: number, z: number, facing: (typeof DIRS)[number] = "north"): void {
    this.sceneIdx = this.set.scenes.findIndex((s) => s.sceneName === sceneName(x, z).toUpperCase());
    this.viewIdx = DIRS.indexOf(facing);
  }
  get here(): string {
    const s = this.set.scenes[this.sceneIdx];
    const [x, , z] = s.sceneLocation;
    return `${(x - 128) / 256},${(z - 128) / 256} ${s.views[this.viewIdx]?.viewName}`;
  }

  key(name: string): void {
    if (this.onKey(name)) return;
    // a conversation owns every key while it is open
    if (this.conversing) return;
    const views = this.set.scenes[this.sceneIdx].views;
    if (name === "ArrowRight") this.viewIdx = (this.viewIdx + 1) % views.length;
    if (name === "ArrowLeft") this.viewIdx = (this.viewIdx + views.length - 1) % views.length;
    if (name === "ArrowUp") {
      const from = views[this.viewIdx].viewID;
      const road = this.set.transitions.find((t) => t.viewIDstart === from);
      if (!road) return;
      this.sceneIdx = this.set.scenes.findIndex((s) => s.views.some((v) => v.viewID === road.viewIDend));
      this.viewIdx = this.set.scenes[this.sceneIdx].views.findIndex((v) => v.viewID === road.viewIDend);
      this.onArrive(this.set.scenes[this.sceneIdx].sceneName.toLowerCase());
    }
  }
}

/** every gesture the verb made, in order, as one line each */
let gestures: string[] = [];
let said: string[] = [];
let w: World;

/** the driver, evaluating every expression for real against {@link World} */
function driver(): SpeedrunDriver {
  const ev = <T>(expr: string): T => new Function("window", `return (${expr});`)(w.window) as T;
  const tick = async () => {
    w.onTick();
    await new Promise((r) => setTimeout(r, 0));
  };
  const until = async (expr: string): Promise<boolean> => {
    for (let i = 0; i < 40; i++) {
      if (ev<boolean>(expr)) return true;
      await tick();
    }
    return false;
  };
  return {
    clock: async () => ({ ms: 0, frames: 0, game: 0, loading: 0 }),
    evaluate: async <T>(expr: string) => ev<T>(expr),
    hold: async (expr, what) => {
      if (!(await until(expr))) throw new Error(`stuck waiting for ${what}`);
    },
    tryHold: (expr) => until(expr),
    settle: async (mode, what) => void gestures.push(`settle ${mode} (${what})`),
    sleep: tick,
    pad: async () => {},
    padded: () => 0,
    key: async (name) => {
      gestures.push(`key ${name}`);
      w.key(name);
    },
    rawKey: async (name) => void w.key(name),
    clickAt: async (x, y) => {
      gestures.push(`click ${x},${y}`);
      w.onClick(x, y);
    },
    holdAt: async (x: number, y: number, opts: HoldOptions) => {
      gestures.push(`hold ${x},${y}`);
      w.onHold(x, y);
      return { armed: true, held: ev<boolean>(opts.until) };
    },
    hammer: async () => 0,
    aim: async (_kind, name) => w.aimAt[name.toLowerCase()] ?? null,
    drag: async () => {},
    dragProp: async () => {},
    dragOnto: async (from, to, opts = {}) => {
      const armed = opts.armed ? await until(opts.armed) : true;
      gestures.push(`drag ${from.x},${from.y} -> ${to.x},${to.y}`);
      if (armed) w.onHold(to.x, to.y);
      const landed = armed && opts.landed ? await until(opts.landed) : false;
      return { armed, landed };
    },
    log: () => {},
  };
}

/** run one sheet line, parsed the way a sheet is, against the world */
async function play(line: string): Promise<void> {
  const [step] = parseSheet(line, { verbs: VERBS });
  const action = resolve(step.verb)!;
  const c: ActionContext = {
    d: driver(),
    step,
    wait: (step.opts.wait as ActionContext["wait"]) ?? action.wait ?? "none",
    budget: 10_000,
    gap: 0,
    say: (m) => said.push(m),
    suggest: () => {},
    verbs: VERBS,
  };
  await action.run(c);
}

/** `say` stood in for: hand each reply asked for to the world */
let answer: (bevel: number) => void = () => {};
const asked: number[] = [];

beforeEach(() => {
  w = new World();
  gestures = [];
  said = [];
  asked.length = 0;
  answer = () => {};
  vi.spyOn(CORE_ACTIONS.say, "run").mockImplementation(async (c) => {
    for (const b of c.step.bevels ?? []) {
      asked.push(b);
      answer(b);
    }
  });
});
afterEach(() => vi.restoreAllMocks());

/* ------------------------------------------------------------------ *
 * The vocabulary
 * ------------------------------------------------------------------ */

test("every Dust verb is reachable by name, whatever its case, and wins over the core's", () => {
  for (const [name, action] of Object.entries(DUST_ACTIONS)) expect(resolve(name.toUpperCase())).toBe(action);
  // and the core is all still there underneath
  for (const name of Object.keys(CORE_ACTIONS)) expect(resolve(name)).toBeTruthy();
});

test("the repository's route parses against Dust's vocabulary, every line of it", () => {
  // the run sheet is the workbench's fixture and its only Dust route; a verb
  // renamed or an option dropped here would leave it unparseable in the page
  const sheet = readFileSync(fileURLToPath(new URL("./speedrun/run.sheet.txt", import.meta.url)), "utf8");
  const steps = parseSheet(sheet, { verbs: VERBS });
  const used = new Set(steps.map((s) => s.verb));
  for (const verb of ["goto", "doorat", "loadsave", "meet", "talkout", "takeinhand", "offer", "give"]) {
    expect(used, verb).toContain(verb);
  }
});

test("a verb's grammar is checked when the sheet is read, not when the line runs", () => {
  const parse = (line: string) => parseSheet(line, { verbs: VERBS });
  expect(() => parse("goto(10)")).toThrow();
  expect(() => parse("doorAt(1, 2, 3)")).toThrow();
  expect(() => parse("goto(1, 1, north, nowhere: 1)")).toThrow();
  expect(parse("talkOut([301,201,104])")[0].bevels).toEqual([301, 201, 104]);
});

/* ------------------------------------------------------------------ *
 * goto
 * ------------------------------------------------------------------ */

test("goto walks the fewest roads to a cell and then faces the way it was asked", async () => {
  w.standAt(0, 0, "south");
  await play("goto(2, 0, north)");
  expect(w.here).toBe("2,0 north");
  // two roads east, then one turn back round to north
  expect(gestures.filter((g) => g === "key ArrowUp")).toHaveLength(2);
  // one plan, so the report names no count of them
  expect(said.at(-1)).toBe("town scene c1 (2,0), 2 road(s)");
});

test("goto takes a road only the way it was authored", async () => {
  // (0,1) -> (0,0) is gone; (0,0) -> (0,1) is still there, and must not be
  // walked backwards — its far view faces south, the wrong way
  w.set = town({ from: [0, 1], dir: "north" });
  w.standAt(0, 1);
  await play("goto(0, 0)");
  expect(w.here.split(" ")[0]).toBe("0,0");
  // round the whole block instead: seven roads, not one
  expect(gestures.filter((g) => g === "key ArrowUp")).toHaveLength(7);
});

/**
 * A pass that walks all the way to the goal says so and returns, so one try is
 * enough for a walk nothing interrupts. (It used to fall through to the next
 * pass, whose top is where arrival was noticed: with `tries: 1` there was no
 * next pass, and a walk that had arrived threw "1 plans and never reached".)
 */
test("goto with one try that arrives reports arriving", async () => {
  w.standAt(0, 0, "east");
  await play("goto(2, 0, tries: 1)");
  expect(w.here.split(" ")[0]).toBe("2,0");
  expect(said.at(-1)).toBe("town scene c1 (2,0), 2 road(s)");
});

test("goto standing on its goal walks nowhere", async () => {
  w.standAt(2, 2, "west");
  await play("goto(2, 2)");
  expect(gestures.filter((g) => g.startsWith("key"))).toEqual([]);
  expect(said).toEqual(["town scene c3 (2,2), already there"]);
});

test("goto refuses a cell that is built on, and names the ones that can be stood on", async () => {
  await expect(play("goto(1, 1)")).rejects.toThrow(
    /cell 1,1 \(scene b2\) cannot be stood on — it is built on\. The 8 that can: 0,0 1,0 2,0 0,1 2,1 0,2 1,2 2,2/,
  );
  await expect(play("goto(5, 5)")).rejects.toThrow(/town has no cell at 5,5/);
  await expect(play("goto(a, 1)")).rejects.toThrow(/"a, 1" is not one/);
});

test("goto takes town and nite for one place, and waits for a room that is on its way", async () => {
  // the night town is the day town drawn twice; the guard must not tell them apart
  w.standAt(0, 0);
  await play("goto(1, 0, set: nite)");
  expect(w.here.split(" ")[0]).toBe("1,0");

  // an interior entered by consequence arrives a moment after the press
  let ticks = 0;
  w.onTick = () => {
    if (++ticks === 3) w.setFile = "HUB.SET";
  };
  await play("goto(2, 0, set: hub)");
  expect(said).toContain("waited for hub to open");
  expect(w.here.split(" ")[0]).toBe("2,0");
});

test("goto in a room that never becomes the one it was told to expect fails before walking", async () => {
  await expect(play("goto(2, 0, set: hub)")).rejects.toThrow(
    /expects to be in hub and this is town, and it did not become hub/,
  );
  expect(gestures.filter((g) => g.startsWith("key"))).toEqual([]);
});

test("goto answers a conversation that opens on the way, and re-plans from where it stopped", async () => {
  w.standAt(0, 0, "east");
  // somebody hails us the first time we reach (1,0)
  let hailed = false;
  w.onArrive = (name) => {
    if (name === "scene b1" && !hailed) {
      hailed = true;
      w.conversing = true;
      w.choices = [{ id: 102, text: "so long" }];
    }
  };
  answer = (b) => {
    if (b === 102) {
      w.conversing = false;
      w.choices = [];
    }
  };
  await play("goto(2, 2)");
  expect(w.here.split(" ")[0]).toBe("2,2");
  expect(asked).toEqual([102]);
  expect(said).toContain("answered something on the way");
  expect(said.some((s) => /plan 1 stopped after 1 road\(s\); re-planning/.test(s))).toBe(true);
  // one road before the hail and three after it: the fewest from each place
  expect(said.at(-1)).toMatch(/^town scene c3 \(2,2\), 4 road\(s\)/);
});

test("goto answers with the reply the line names, or refuses to answer at all", async () => {
  w.conversing = true;
  w.choices = [{ id: 101, text: "hello" }, { id: 202, text: "the deal" }];
  answer = (b) => {
    if (b === 202) w.conversing = false;
  };
  await play("goto(1, 0, replies: 202)");
  expect(asked).toEqual([202]);

  w.conversing = true;
  await expect(play("goto(2, 0, replies: none)")).rejects.toThrow(/told not to answer it/);
});

test("goto names a conversation nothing closes, which is what the HELP overlay is", async () => {
  // still speaking, nothing on the plaque, and ESC does not end it
  w.conversing = true;
  w.speaking = true;
  await expect(play("goto(1, 0, tries: 1)")).rejects.toThrow(
    /would not close .* Nothing is on its plaque — it is still speaking/,
  );
  // and it did cut the line short each time it looked, once per look
  expect(gestures.filter((g) => g === "key Escape").length).toBeGreaterThan(0);
});

test("goto that is carried off course re-plans from where the world put it", async () => {
  w.standAt(0, 0, "east");
  // a standpoint's own script moves us the first time we land on it
  let moved = false;
  w.onArrive = (name) => {
    if (name === "scene b1" && !moved) {
      moved = true;
      w.standAt(0, 2, "north");
    }
  };
  await play("goto(2, 0)");
  expect(w.here.split(" ")[0]).toBe("2,0");
  expect(said.some((s) => s.startsWith("plan 1 stopped"))).toBe(true);
});

test("goto that runs out of plans says where the last one was made", async () => {
  w.standAt(0, 0, "east");
  // every arrival at (1,0) throws us back to the start, so no press is seen to move
  w.onArrive = (name) => {
    if (name === "scene b1") w.standAt(0, 0, "east");
  };
  await expect(play("goto(2, 0, tries: 2)")).rejects.toThrow(
    /three ArrowUp presses and the world did not move[\s\S]*\n    planning in town \(from scene a1\) via east -> east$/,
  );
  expect(said).toContain("plan 1 stopped after 0 road(s); re-planning");
});

/* ------------------------------------------------------------------ *
 * give
 * ------------------------------------------------------------------ */

test("give drags the thing in hand from where the panel drew it onto somebody, and ends at the release", async () => {
  w.globals.set("handitem", "bone");
  w.globals.set("polling", 1);
  w.props.set("bone", { owner: "stranger", visible: true, x: 130, y: 264 });
  w.aimAt.dog = { x: 300, y: 150 };
  // the item is its own progress bar: it is drawn wherever the button is
  w.onHold = (x, y) => {
    Object.assign(w.props.get("bone")!, { x, y });
    w.globals.set("handitem", "");
  };
  await play("give(bone, to, dog)");
  expect(gestures).toEqual(["drag 130,264 -> 300,150"]);
  expect(said).toEqual(["bone 130,264 -> dog 300,150, hand empty"]);
});

test("give says the item never arrived rather than calling a drop that missed a success", async () => {
  w.globals.set("handitem", "bone");
  w.globals.set("polling", 1);
  w.props.set("bone", { owner: "stranger", visible: true, x: 130, y: 264 });
  w.aimAt.dog = { x: 300, y: 150 };
  await play("give(bone, dog)");
  expect(said).toEqual(['bone 130,264 -> dog 300,150, but it never arrived under the pointer, still holding "bone"']);
});

test("give tells the wrong thing in hand from nothing in hand", async () => {
  w.aimAt.dog = { x: 300, y: 150 };
  await expect(play("give(bone, to, dog)")).rejects.toThrow(/nothing is in hand/);
  w.globals.set("handitem", "pie");
  await expect(play("give(bone, to, dog)")).rejects.toThrow(/"pie" is in hand, not bone/);
  // `to` is noise, so a line with only noise after the item has nobody to give to
  await expect(play("give(bone, to)")).rejects.toThrow(/needs somebody to give it to/);
});

test("give refuses a drop nothing took the press for, and a target that is not here", async () => {
  w.globals.set("handitem", "bone");
  w.props.set("bone", { owner: "stranger", visible: true, x: 130, y: 264 });
  await expect(play("give(bone, to, dog)")).rejects.toThrow(/no dog here/);
  w.aimAt.dog = { x: 300, y: 150 };
  // nobody is polling: the press is dropped in silence
  await expect(play("give(bone, to, dog)")).rejects.toThrow(/never took the press at 130,264/);
});

/* ------------------------------------------------------------------ *
 * takeInHand
 * ------------------------------------------------------------------ */

/** the avatar panel: a click on `self` opens it, a held press on a slot takes,
 *  a held press on OK closes it */
function avatarPanel(slots: Record<string, Point>, ok: Point = { x: 317, y: 333 }): void {
  const prevClick = w.onClick;
  w.onClick = (x, y) => {
    if (w.flat === "mainpanel" && x === 451 && y === 324) {
      w.flat = "avatar";
      // the panel lays out what is carried, where propxy will report it
      for (const [n, at] of Object.entries(slots)) Object.assign(w.props.get(n)!, at, { visible: true });
    } else prevClick(x, y);
  };
  w.onHold = (x, y) => {
    if (w.flat !== "avatar") return;
    if (x === ok.x && y === ok.y) w.flat = "mainpanel";
    for (const [n, at] of Object.entries(slots)) if (at.x === x && at.y === y) w.globals.set("handitem", n);
  };
}

test("takeInHand opens the panel for a thing already carried, without hunting the room for it", async () => {
  w.props.set("jug", { owner: "stranger", visible: false, x: 0, y: 0 });
  w.regions["mainpanel/self"] = { left: 395, top: 268, right: 507, bottom: 379 };
  avatarPanel({ jug: { x: 130, y: 264 } });
  await play("takeInHand(jug)");
  expect(gestures.filter((g) => !g.startsWith("settle"))).toEqual(["click 451,324", "hold 130,264", "hold 317,333"]);
  expect(w.globals.get("handitem")).toBe("jug");
  expect(w.flat).toBe("mainpanel");
  expect(said).toEqual(["jug in hand"]);
});

test("takeInHand picks up a thing lying in the room where the engine drew it", async () => {
  w.props.set("bone", { owner: "", visible: true, x: 140, y: 200 });
  w.onClick = (x, y) => {
    if (x === 140 && y === 200) w.globals.set("handitem", "bone");
  };
  await play("takeInHand(bone)");
  expect(said).toEqual(["bone picked up where it lay, at 140,200"]);
  expect(gestures.some((g) => g.startsWith("key"))).toBe(false);
});

test("takeInHand turns round the cell to find a thing that lies behind it", async () => {
  // drawn only while we face west, three turns to the right of north
  w.props.set("bone", { owner: "", visible: true, x: 140, y: 200 });
  Object.defineProperty(w.props.get("bone")!, "visible", { get: () => w.viewIdx === 3 });
  w.onClick = (x, y) => {
    if (w.viewIdx === 3 && x === 140 && y === 200) w.globals.set("handitem", "bone");
  };
  await play("takeInHand(bone)");
  expect(said).toEqual(["bone picked up where it lay, at 140,200 after 3 turns"]);
});

test("takeInHand that finds a thing in neither the room nor the panel says where it looked", async () => {
  w.props.set("ring", { owner: "", visible: false, x: 600, y: 900 });
  avatarPanel({}); // the panel opens, and nothing in it is the ring
  await expect(play("takeInHand(ring)")).rejects.toThrow(
    /Round the four views of this cell it was at \[nothing nothing nothing nothing\], and the panel would not take it either; the hand holds "nothing" and the player is carrying nothing\. The engine draws it at 600,900, invisible/,
  );
  // and the panel was closed behind it, whatever happened inside
  expect(w.flat).toBe("mainpanel");
});

test("takeInHand with the thing already in hand does nothing at all", async () => {
  w.globals.set("handitem", "Mask");
  await play("takeInHand(mask)");
  expect(gestures).toEqual([]);
  expect(said).toEqual(["already in hand"]);
});

/* ------------------------------------------------------------------ *
 * offer
 * ------------------------------------------------------------------ */

test("offer works the picker the plaque opens, then presses the plaque again to give", async () => {
  w.props.set("ring", { owner: "stranger", visible: false, x: 0, y: 0 });
  w.conversing = true;
  w.choices = [{ id: 101, text: "hello" }, { id: 55555, text: "Would you like something...?" }];
  // no region table: the panel is over a conversation's own stage, so OK is
  // found by the numbers new.flt carries
  avatarPanel({ ring: { x: 200, y: 250 } });
  answer = (b) => {
    if (b !== 55555) return;
    if (w.globals.get("handitem") !== "ring") {
      w.flat = "avatar"; // handflag = 1: which thing?
      for (const p of w.props.values()) Object.assign(p, { x: 200, y: 250 });
    } else {
      w.props.get("ring")!.owner = "ruby";
      w.choices = [{ id: 201, text: "thank you" }];
    }
  };
  await play("offer(ring)");
  expect(asked).toEqual([55555, 55555]);
  expect(gestures).toEqual(["hold 200,250", "hold 317,333"]);
  expect(said).toEqual(['offered ring, and it belongs to "ruby" now']);
});

test("offer is done when the gift ends the conversation", async () => {
  w.props.set("harmonica", { owner: "stranger", visible: false, x: 0, y: 0 });
  w.globals.set("handitem", "harmonica");
  w.conversing = true;
  w.choices = [{ id: 55555, text: "Would you like this harmonica?" }];
  answer = () => {
    w.conversing = false;
    w.props.get("harmonica")!.owner = "trotter";
  };
  await play("offer(harmonica)");
  expect(said).toEqual(['offered harmonica, and it belongs to "trotter" now']);
});

test("offer needs a conversation, the thing, and a plaque that offers it", async () => {
  await expect(play("offer(ring)")).rejects.toThrow(/nobody is talking.*give\(ring, to, them\)/);
  w.conversing = true;
  w.props.set("jug", { owner: "stranger", visible: false, x: 0, y: 0 });
  await expect(play("offer(ring)")).rejects.toThrow(/not carrying ring — the player has jug/);
  w.props.set("ring", { owner: "stranger", visible: false, x: 0, y: 0 });
  w.choices = [{ id: 101, text: "hello" }];
  await expect(play("offer(ring)")).rejects.toThrow(/no offer plaque \(55555\) .* it is asking 101/);
});

/* ------------------------------------------------------------------ *
 * doorAt
 * ------------------------------------------------------------------ */

test("doorAt clicks where the scene shows through, not on whoever stands in the doorway", async () => {
  w.standAt(0, 0);
  // the Mayor across the middle of the door
  w.hitTest = (x) => (x > 250 && x < 300 ? { type: "actor" } : { type: "scene" });
  w.props.set("door", { owner: "", visible: true, x: 0, y: 0 });
  w.onClick = () => void (w.props.get("door")!.owner = "doctor");
  w.onKey = (k) => {
    if (k !== "ArrowUp" || w.props.get("door")!.owner !== "doctor") return false;
    w.setFile = "DOCTOR.SET";
    return true;
  };
  await play("doorAt(241, 92, 307, 201, owner: doctor)");
  // the middle (274,147) is the Mayor; the sweep's first scene point is the corner
  expect(gestures.filter((g) => g.startsWith("click"))).toEqual(["click 245,96"]);
  expect(w.setFile).toBe("DOCTOR.SET");
  expect(said).toEqual(["through"]);
});

test("doorAt that finds itself through already does not walk on", async () => {
  // a press still queued walked straight through the door the click opened
  w.onClick = () => void (w.setFile = "SALOON.SET");
  await play("doorAt(241, 92, 307, 201, owner: saloon)");
  expect(gestures.filter((g) => g.startsWith("key"))).toEqual([]);
  expect(said).toEqual(["already through — the room changed to saloon.set"]);
});

test("doorAt with somebody across the whole rectangle says so when it gives up", async () => {
  w.standAt(0, 0);
  w.hitTest = () => ({ type: "actor" });
  await expect(play("doorAt(241, 92, 307, 201, owner: saloon, tries: 2)")).rejects.toThrow(
    /the door did not open — its prop is not "saloon", standing at TOWN\.SET SCENE A1 north; 2 of 2 tries found somebody across/,
  );
  await expect(play("doorAt(a, 92, 307, 201)")).rejects.toThrow(/doorAt takes four numbers/);
});

/* ------------------------------------------------------------------ *
 * loadSave
 * ------------------------------------------------------------------ */

test("loadSave waits for the page's promise and says where the save put us", async () => {
  w.standAt(2, 1, "west");
  w.globals.set("day", 2);
  w.globals.set("clock", 14);
  const asked: string[] = [];
  w.loadSave = async (name) => {
    asked.push(name);
    return true;
  };
  await play("loadSave(D2A_001)");
  expect(asked).toEqual(["D2A_001"]);
  expect(said).toEqual(["D2A_001: TOWN.SET SCENE C2 west, day 2 clock 14"]);
});

test("loadSave carries the page's refusal into its own error", async () => {
  await expect(play("loadSave(D1E_001)")).rejects.toThrow(/publishes no loadSave/);
  w.loadSave = async () => {
    throw new Error("no such save");
  };
  await expect(play("loadSave(NOPE)")).rejects.toThrow(/loadSave\(NOPE\) would not load: no such save — the names are the disc's own/);
  w.loadSave = async () => false;
  await expect(play("loadSave(NOPE)")).rejects.toThrow(/would not load — the names/);
});

/* ------------------------------------------------------------------ *
 * meet
 * ------------------------------------------------------------------ */

test("meet walks to the cell somebody is standing in, and then gets them talking", async () => {
  w.standAt(0, 0, "east");
  w.actors.set("jones", { x: 2, z: 2 });
  const accost = vi.spyOn(CORE_ACTIONS.accost, "run").mockImplementation(async () => {
    w.conversing = true;
  });
  await play("meet(jones)");
  expect(w.here.split(" ")[0]).toBe("2,2");
  expect(accost).toHaveBeenCalledTimes(1);
  expect(said.at(-1)).toBe("jones from 2,2 with them at 2,2");
});

test("meet presses from where it stands when nobody's cell has a road to it", async () => {
  w.standAt(0, 1, "east");
  w.actors.set("blood", { x: 1, z: 1 }); // the built-on middle
  vi.spyOn(CORE_ACTIONS.accost, "run").mockImplementation(async () => {
    w.conversing = true;
  });
  await play("meet(blood)");
  expect(said.at(-1)).toBe("blood from where we stand — their cell 1,1 has no road to it");
});

test("meet gives up on somebody who never shares a row or a column with us", async () => {
  w.standAt(0, 0, "east");
  // at (2,2) when looked for, and off at (0,0) by the time we arrive there
  w.actors.set("wife", { x: 2, z: 2 });
  w.onArrive = (name) => {
    if (name === "scene c3") w.actors.set("wife", { x: 0, z: 0 });
  };
  const accost = vi.spyOn(CORE_ACTIONS.accost, "run");
  await expect(play("meet(wife, rounds: 1)")).rejects.toThrow(/could not get to wife in 1 rounds — 0,0 off our line;/);
  expect(accost).not.toHaveBeenCalled();
});

test("meet with a conversation already open is already done", async () => {
  w.conversing = true;
  await play("meet(jones)");
  expect(said).toEqual(["already talking"]);
  expect(gestures).toEqual([]);
});

/* ------------------------------------------------------------------ *
 * talkOut
 * ------------------------------------------------------------------ */

test("talkOut answers the first preferred reply the plaque actually offers", async () => {
  w.conversing = true;
  w.choices = [{ id: 101, text: "" }, { id: 104, text: "" }, { id: 102, text: "" }];
  answer = (b) => {
    if (b === 104) w.conversing = false;
  };
  await play("talkOut([301,104,101])");
  // 301 is not on this plaque; 104 is, and it is Buick's way out
  expect(asked).toEqual([104]);
  expect(said).toEqual(["left on 104"]);
});

test("talkOut never spends the same reply twice on a plaque that did not change", async () => {
  // a `while true` round its plaque: 301 speaks a line and comes round again
  w.conversing = true;
  w.choices = [{ id: 301, text: "" }, { id: 103, text: "" }];
  answer = (b) => {
    if (b === 103) w.conversing = false;
  };
  await play("talkOut([301])");
  // and when the list runs out, whatever else is on offer
  expect(asked).toEqual([301, 103]);
});

test("talkOut gives up loudly on a plaque every reply has failed to close", async () => {
  w.conversing = true;
  w.choices = [{ id: 101, text: "" }, { id: 102, text: "" }];
  await expect(play("talkOut([101])")).rejects.toThrow(/every reply on this plaque has been tried .* offered 101,102, answered 101,102/);
});

test("talkOut cuts a spoken line short once, then answers what follows it", async () => {
  w.conversing = true;
  w.speaking = true;
  w.onKey = (k) => {
    if (k !== "Escape") return false;
    w.speaking = false;
    w.choices = [{ id: 201, text: "" }];
    return true;
  };
  answer = () => void (w.conversing = false);
  await play("talkOut([201])");
  expect(gestures.filter((g) => g === "key Escape")).toHaveLength(1);
  expect(asked).toEqual([201]);
});

test("talkOut with nobody talking is fine, and says so", async () => {
  await play("talkOut([301], patience: 10)");
  expect(said).toEqual(["nobody was talking"]);
  expect(asked).toEqual([]);
});
