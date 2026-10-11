/**
 * The play page (`src/main.ts`), in node: the real `index.html` parsed by
 * linkedom, with the shared V0 shell, the game, its input door, the menu bar
 * and the saves standing in for themselves.
 *
 *   npx vitest run --project lunicus lunicus/tests/page.ts
 *
 * The machine suites drive the GAME, and `tests/browser/` drives this page in a
 * real browser; nothing in node ran this file. What is pinned here is the page
 * between the player and the game: the boot (preload, the port's day saves,
 * a boot that throws), the clock (a tick per 1/60 s, a few at most behind, none
 * when driven), the status line in every place the game can be, which gesture
 * reaches which door of `Input`, the saved-games button, `?drive`'s handle and
 * `?replay`'s checkpoints. How any of it LOOKS is a browser's question.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";

/* ---------------------------------------------------------------- the fakes */

/** what the page asked of the game, the shell and the input door, in order */
const calls: string[] = [];
/** the page's log, `!` before a complaint */
const lines: string[] = [];

interface World {
  bootThrows: boolean;
  /** what the saved-games dialog hands back */
  saved: Uint8Array | null;
  /** the dialog itself fails */
  browseFails: boolean;
  savesOpen: boolean;
  /** how many of the port's day saves the seeding listed */
  seeded: number;
  replay: unknown;
}
let world: World;

interface Opts {
  seed: number;
  sco?: unknown;
  keysDialog?: (f: string[], d: string[], done: (f: string[] | null) => void) => void;
  askName?: (done: (n: string | null) => void) => void;
}

class FakeGame {
  phase = "title";
  won = false;
  stopped = "";
  base: Record<string, unknown> | null = null;
  city: Record<string, unknown> | null = null;
  hud = { score: 0, enemies: 4, bullets: 10, grenades: 2, rockets: 1 };
  progress = { level: 1, day: 1 };
  m = {
    ticks: 0,
    seed: 0,
    film: null as string | null,
    where: "",
    screen: {},
    keysHeld: new Set(["ArrowUp"]),
    ambiencePlaying: false,
    playAmbience: () => void calls.push("ambience"),
  };
  tickThrows = false;
  /** the tick after which `tick()` answers false, as a game that has stopped */
  stopAt = Infinity;
  constructor(_files: unknown, readonly opts: Opts) {
    this.m.seed = opts.seed;
    current.game = this;
  }
  tick(): boolean {
    if (this.tickThrows) throw new Error("the machine fell over");
    if (this.m.ticks >= this.stopAt) return false;
    this.m.ticks++;
    return true;
  }
  openGame(bytes: Uint8Array): void {
    calls.push(`openGame ${bytes.length}`);
  }
}

class FakePage {
  canvas = document.getElementById("screen") as HTMLCanvasElement;
  locEl = document.getElementById("loc") as HTMLElement;
  files = {};
  speaker = {};
  saver = {};
  looping = false;
  bugReport = { game: "Lunicus" };
  draws = 0;
  constructor(readonly opts: Record<string, unknown>) {
    current.page = this;
  }
  complain = (l: string): void => void lines.push(`! ${l}`);
  say = (l: string): void => void lines.push(l);
  toggleLog = (): void => void calls.push("toggleLog");
  fetchBytes = async (p: string): Promise<Uint8Array> => (calls.push(`fetch ${p}`), new Uint8Array(1));
  at = (e: { clientX: number; clientY: number }): { x: number; y: number } => ({ x: e.clientX / 2, y: e.clientY / 2 });
  storedSco = (): string => "stored sco";
  keepSco = (): void => {};
  startSound = async (): Promise<void> => void calls.push("startSound");
  draw = (): void => void this.draws++;
  boot = async (o: { preload: readonly string[]; ready: string; manifest?: (m: Record<string, number>) => void }): Promise<void> => {
    calls.push(`boot ${o.preload.length}`);
    if (world.bootThrows) throw new Error("no manifest");
    o.manifest?.({ "gamefiles/save/day2.lun": 1 });
    lines.push(o.ready);
  };
}

/** what TouchGestures was built with, to drive as a finger would */
let touchOpts: {
  coords: (e: unknown) => { x: number; y: number } | null;
  ownedByGame: (x: number, y: number) => boolean;
  press: (x: number, y: number) => void;
  release: (x: number, y: number) => void;
  sendKey: (k: string) => void;
};

/** the menu bar's dependencies, as the page handed them over */
let menuDeps: { open: () => void; live: () => boolean };
/** what the seeding was asked to resolve */
let seededUrls: (string | null)[] = [];

const current: { game?: FakeGame; page?: FakePage } = {};

vi.mock("@dreamfactory/engine/web/v0-page", async (orig) => ({
  ...(await orig<typeof import("@dreamfactory/engine/web/v0-page")>()),
  V0Page: FakePage,
}));
vi.mock("../src/game/game", () => ({ Lunicus: FakeGame }));
vi.mock("../src/game/input", () => ({
  Input: class {
    down = (x: number, y: number): void => void calls.push(`down ${x},${y}`);
    up = (x: number, y: number): void => void calls.push(`up ${x},${y}`);
    move = (x: number, y: number): void => void calls.push(`move ${x},${y}`);
    keyDown = (k: string): boolean => (calls.push(`keyDown ${k}`), k.startsWith("Arrow"));
    keyUp = (k: string): void => void calls.push(`keyUp ${k}`);
    takes = (k: string): boolean => k.startsWith("Arrow");
    menu = (id: number): void => void calls.push(`menu ${id}`);
    press = (k: string): void => void calls.push(`press ${k}`);
  },
}));
vi.mock("@dreamfactory/engine/web/touch", () => ({
  TouchGestures: class {
    constructor(o: typeof touchOpts) {
      touchOpts = o;
    }
    down = (): void => void calls.push("touch down");
    move = (): void => {};
    up = (e: { pointerType?: string }): boolean => e.pointerType === "touch";
    cancel = (): void => void calls.push("touch cancel");
  },
}));
vi.mock("../src/menu", () => ({
  installMenu: (_f: unknown, _g: unknown, _i: unknown, deps: typeof menuDeps) => ((menuDeps = deps), { sync: () => {} }),
}));
vi.mock("../src/dialogs", () => ({
  askHighScoreName: () => void calls.push("askName"),
  editKeys: () => void calls.push("editKeys"),
}));
vi.mock("../src/saves", () => ({
  LUNICUS_SAVES: {},
  seedLunicusSaves: async (urlOf: (p: string) => string | null) => {
    seededUrls = [urlOf("save/day2.lun"), urlOf("save/day9.lun")];
    return world.seeded;
  },
}));
vi.mock("@dreamfactory/engine/web/save-store", () => ({ useSaveKind: () => {} }));
vi.mock("@dreamfactory/engine/web/save-browser", () => ({
  browseForLoad: async () => {
    if (world.browseFails) throw new Error("the saves would not list");
    return world.saved;
  },
  savesOpen: () => world.savesOpen,
}));
vi.mock("@dreamfactory/engine/web/window-dialog", () => ({ windowDialogOpen: () => false }));
vi.mock("@dreamfactory/site/bug-report", () => ({ installBugReport: () => {} }));

/* ----------------------------------------------------------------- the page */

const HTML = readFileSync(join(import.meta.dirname, "../index.html"), "utf8");

interface Page {
  game: FakeGame;
  el: (id: string) => HTMLElement;
  /** a window event (`pointerup`, `blur` …) */
  fire: (type: string, props?: Record<string, unknown>) => void;
  /** a key event, from the page's element `from` (the body by default) */
  key: (type: string, props: Record<string, unknown>, from?: string) => void;
  /** a canvas pointer event */
  point: (type: string, props: Record<string, unknown>) => void;
  /** run the frames the page has asked for, `ms` after it last ran */
  frame: (ms?: number) => void;
  click: (id: string) => void;
  /** the status line */
  loc: () => string;
}

async function openPage(opts: { search?: string; world?: Partial<World> } = {}): Promise<Page> {
  vi.resetModules();
  calls.length = 0;
  lines.length = 0;
  seededUrls = [];
  world = { bootThrows: false, saved: null, browseFails: false, savesOpen: false, seeded: 0, replay: null, ...opts.world };

  const dom = parseHTML(HTML);
  const { document } = dom;
  Object.defineProperty(document, "baseURI", { value: "http://host/lunicus/" });
  const win = new EventTarget();
  const frames: FrameRequestCallback[] = [];
  let clock = 0;
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("addEventListener", win.addEventListener.bind(win));
  vi.stubGlobal("location", { search: opts.search ?? "", origin: "http://host" });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.stubGlobal("fetch", async (u: string) =>
    world.replay
      ? { ok: true, json: async () => world.replay, text: async () => "" }
      : { ok: false, status: 404, text: async () => `nothing at ${u}` },
  );

  const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
  await import("../src/main");
  return {
    game: current.game!,
    el,
    fire: (type, props = {}) => {
      const e = new Event(type);
      Object.assign(e, { clientX: 0, clientY: 0, pointerType: "mouse", ...props });
      win.dispatchEvent(e);
    },
    key: (type, props, from) => {
      const e = new dom.Event(type, { bubbles: true });
      Object.assign(e, { repeat: false, ...props });
      (from ? el(from) : document).dispatchEvent(e);
    },
    point: (type, props) => {
      const e = new dom.Event(type);
      Object.assign(e, { pointerType: "mouse", ...props });
      el("screen").dispatchEvent(e);
    },
    frame: (ms = 1000 / 60) => {
      clock += ms;
      frames.splice(0).forEach((cb) => cb(clock));
    },
    click: (id) => void el(id).dispatchEvent(new dom.Event("click")),
    loc: () => el("loc").textContent ?? "",
  };
}

/** click Enter, and wait until the page runs */
async function enter(p: Page): Promise<void> {
  p.click("start");
  await vi.waitFor(() => expect(calls).toContain("startSound"));
  await vi.waitFor(() => expect(document.body.classList.contains("playing")).toBe(true));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ---------------------------------------------------------------- the tests */

describe("the boot", () => {
  it("preloads the opening, lists the port's day saves, and waits for Enter", async () => {
    const p = await openPage({ world: { seeded: 3 } });
    await vi.waitFor(() => expect(lines).toContain("listed 3 of the port's day saves in the saved games"));
    expect(calls).toContain("boot 11");
    expect(lines.some((l) => l.startsWith("ready — Enter plays the intro"))).toBe(true);
    // a save the manifest has is fetched from the page; one it does not, nowhere
    expect(seededUrls).toEqual(["http://host/lunicus/gamefiles/save/day2.lun", null]);
    // nothing ticks before Enter
    p.frame();
    expect(p.game.m.ticks).toBe(0);
  });

  it("says nothing of saves it did not list", async () => {
    await openPage();
    await vi.waitFor(() => expect(lines.some((l) => l.startsWith("ready"))).toBe(true));
    await Promise.resolve();
    expect(lines.some((l) => l.startsWith("listed"))).toBe(false);
  });

  it("puts a boot that throws in the log", async () => {
    await openPage({ world: { bootThrows: true } });
    expect(lines).toContain("! Error: no manifest");
  });

  it("gives a played game the stored keys and scores, and the dialogs that change them", async () => {
    const p = await openPage({ search: "?seed=77" });
    expect(p.game.m.seed).toBe(77);
    expect(p.game.opts.sco).toBe("stored sco");
    p.game.opts.keysDialog!([], [], () => {});
    p.game.opts.askName!(() => {});
    expect(calls).toEqual(expect.arrayContaining(["editKeys", "askName"]));
  });

  it("gives a driven game the defaults and asks nothing", async () => {
    const p = await openPage({ search: "?drive&seed=5" });
    expect(p.game.opts.sco).toBeUndefined();
    expect(p.game.opts.askName).toBeUndefined();
  });
});

describe("the clock", () => {
  it("ticks sixty a second, and starts the ambience the boot asked for", async () => {
    const p = await openPage();
    p.game.m.ambiencePlaying = true;
    await enter(p);
    expect(calls).toContain("ambience");
    p.frame(1000 / 60 * 3 + 1);
    expect(p.game.m.ticks).toBe(3);
    expect(current.page!.draws).toBe(1);
  });

  it("catches up a few ticks after a tab comes back, not minutes", async () => {
    const p = await openPage();
    await enter(p);
    p.frame(60_000);
    expect(p.game.m.ticks).toBe(6);
  });

  it("stops ticking a game that has stopped, and keeps drawing", async () => {
    const p = await openPage();
    p.game.stopAt = 1;
    await enter(p);
    p.frame(100);
    p.frame(100);
    expect(p.game.m.ticks).toBe(1);
    expect(current.page!.draws).toBe(2);
  });

  it("puts a tick that throws in the log, and stops the clock", async () => {
    const p = await openPage();
    p.game.tickThrows = true;
    await enter(p);
    p.frame(100);
    expect(lines).toContain("! Error: the machine fell over");
    // the frame that threw still draws; none after it runs
    p.frame(100);
    expect(current.page!.draws).toBe(1);
  });

  it("keeps the game running when the status line throws", async () => {
    const p = await openPage();
    await enter(p);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    p.game.base = {};
    p.frame(20);
    expect(error).toHaveBeenCalledWith("status line:", expect.any(TypeError));
    p.frame(20);
    expect(p.game.m.ticks).toBe(2);
  });

  it("a second Enter does not start a second clock", async () => {
    const p = await openPage();
    await enter(p);
    p.click("start");
    await vi.waitFor(() => expect(calls.filter((c) => c === "startSound")).toHaveLength(2));
    p.frame(1000 / 60 + 1);
    expect(p.game.m.ticks).toBe(1);
  });
});

describe("the status line", () => {
  /** the line after one frame, with the game set up by `set` */
  async function statusOf(set: (g: FakeGame) => void): Promise<string> {
    const p = await openPage();
    await enter(p);
    set(p.game);
    p.frame(1);
    return p.loc();
  }

  it("names the phase on the title", async () => {
    expect(await statusOf(() => {})).toBe("title");
    expect(await statusOf((g) => (g.m.where = "the title card"))).toBe("the title card");
  });

  it("says a stopped game is over", async () => {
    const s = await statusOf((g) => ((g.phase = "over"), (g.stopped = "the base fell")));
    expect(s).toBe("the base fell — reload the page for a new game");
    expect(await statusOf((g) => ((g.phase = "not-ported"), (g.stopped = "day 7")))).toContain("day 7 — reload");
  });

  it("says a won game is won, unless the intro is playing again", async () => {
    expect(await statusOf((g) => (g.won = true))).toContain("the queen is dead");
    expect(await statusOf((g) => ((g.won = true), (g.m.film = "intro.mov"), (g.m.where = "film intro.mov")))).toBe("film intro.mov");
  });

  it("names a film, then a talk", async () => {
    expect(await statusOf((g) => ((g.m.film = "flip.mov"), (g.m.where = "film flip.mov · frame 3")))).toBe("film flip.mov · frame 3");
    const talk = await statusOf((g) => ((g.phase = "base"), (g.base = { talkState: { talk: { file: "sasha.1", line: "q hello" } } })));
    expect(talk).toBe("talking: sasha.1 · q hello");
    const city = await statusOf((g) => ((g.phase = "city"), (g.city = { talkState: { talk: { file: "guard.2" } } })));
    expect(city).toBe("talking: guard.2");
  });

  it("names the base's floor, or says it is still loading", async () => {
    const loading = await statusOf((g) => ((g.phase = "base"), (g.base = { talkState: {}, maze: null, day: 1 })));
    expect(loading).toBe("loading the floor…");
    const s = await statusOf((g) => {
      g.phase = "base";
      g.base = { talkState: {}, maze: { name: "lowerbas" }, day: 2, pose: { x: 3, y: 4, dir: 2 } };
      g.progress = { level: 3, day: 5 };
    });
    expect(s).toBe("lowerbas · level 3 (day 2) · 3,4 facing E · progress 5");
  });

  it("names the city, its enemies and ammunition, and a node that is out", async () => {
    const city = (wasp: unknown) => (g: FakeGame) => {
      g.phase = "city";
      g.city = { talkState: {}, day: 4, wasp: { wasp }, world: { maze: { name: "citymaze" }, pose: { x: 1, y: 2, dir: 0 } } };
    };
    expect(await statusOf(city({}))).toBe("citymaze · level 1 (day 4) · 1,2 facing N · enemies 4 · ammo 10/2/1");
    expect(await statusOf(city(null))).toContain("facing N · enemies 4 · the node is out · ammo");
  });
});

describe("input", () => {
  it("hands the mouse to the game in its own pixels", async () => {
    const p = await openPage();
    await enter(p);
    p.point("pointerdown", { clientX: 200, clientY: 100 });
    p.point("pointermove", { clientX: 202, clientY: 102 });
    p.fire("pointerup", { clientX: 204, clientY: 104 });
    expect(calls).toEqual(expect.arrayContaining(["down 100,50", "move 101,51", "up 102,52"]));
  });

  it("takes no click before Enter", async () => {
    const p = await openPage();
    p.point("pointerdown", { clientX: 200, clientY: 100 });
    p.fire("pointerup", { clientX: 200, clientY: 100 });
    expect(calls.some((c) => /^(down|up) /.test(c))).toBe(false);
  });

  it("hands a finger to the gestures, and the gestures to the game", async () => {
    const p = await openPage();
    p.point("pointerdown", { pointerType: "touch" });
    expect(touchOpts.coords({ clientX: 10, clientY: 10 })).toBeNull();
    await enter(p);
    p.point("pointerdown", { pointerType: "touch" });
    p.fire("pointerup", { pointerType: "touch" });
    p.fire("pointercancel");
    expect(calls).toEqual(expect.arrayContaining(["touch down", "touch cancel"]));
    expect(touchOpts.coords({ clientX: 10, clientY: 10 })).toEqual({ x: 5, y: 5 });
    touchOpts.press(1, 2);
    touchOpts.release(3, 4);
    touchOpts.sendKey("uparrow");
    expect(calls).toEqual(expect.arrayContaining(["down 1,2", "up 3,4", "press ArrowUp"]));
    // the panel beside and under the maze view takes a press at once, in a level
    expect(touchOpts.ownedByGame(500, 10)).toBe(false);
    p.game.phase = "base";
    expect(touchOpts.ownedByGame(500, 10)).toBe(true);
    expect(touchOpts.ownedByGame(10, 10)).toBe(false);
  });

  it("hands keys to the game, keeps b for the log, and a held arrow is the game's", async () => {
    const p = await openPage();
    p.key("keydown", { key: "b" });
    p.key("keydown", { key: "ArrowUp" });
    expect(calls).toEqual(["boot 11", "toggleLog"]);
    await enter(p);
    const e = { key: "ArrowLeft", preventDefault: vi.fn() };
    p.key("keydown", e);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    p.key("keydown", { key: "x", preventDefault: e.preventDefault });
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    p.key("keydown", { ...e, repeat: true });
    expect(e.preventDefault).toHaveBeenCalledTimes(2);
    p.key("keydown", { key: "x", repeat: true });
    p.key("keyup", { key: "ArrowLeft" });
    expect(calls.filter((c) => c.startsWith("key"))).toEqual(["keyDown ArrowLeft", "keyDown x", "keyUp ArrowLeft"]);
  });

  it("gives the game no key while a dialog is up, nor one a text field owns", async () => {
    const p = await openPage();
    await enter(p);
    world.savesOpen = true;
    p.key("keydown", { key: "ArrowUp" });
    expect(touchOpts.coords({ clientX: 1, clientY: 1 })).toBeNull();
    world.savesOpen = false;
    p.key("keydown", { key: "ArrowUp" }, "saveNameInput");
    expect(calls.some((c) => c.startsWith("keyDown"))).toBe(false);
  });

  it("lets go of every held key when the window loses focus", async () => {
    const p = await openPage();
    p.fire("blur");
    expect(p.game.m.keysHeld.size).toBe(0);
  });
});

describe("the saved games", () => {
  it("opens a saved game, starting the clock if it was not", async () => {
    const p = await openPage({ world: { saved: new Uint8Array(12) } });
    p.click("loadBtn");
    await vi.waitFor(() => expect(calls).toContain("openGame 12"));
    expect(calls.indexOf("startSound")).toBeLessThan(calls.indexOf("openGame 12"));
    // and File ▸ Open is the same door
    menuDeps.open();
    await vi.waitFor(() => expect(calls.filter((c) => c === "openGame 12")).toHaveLength(2));
    expect(calls.filter((c) => c === "startSound")).toHaveLength(1);
  });

  it("does nothing when the dialog is closed with no game", async () => {
    const p = await openPage();
    p.click("loadBtn");
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.some((c) => c.startsWith("openGame") || c === "startSound")).toBe(false);
  });

  it("puts a dialog that fails in the log", async () => {
    const p = await openPage({ world: { browseFails: true } });
    p.click("loadBtn");
    await vi.waitFor(() => expect(lines).toContain("! Error: the saves would not list"));
  });

  it("gives the menu bar the game only while it runs", async () => {
    const p = await openPage();
    expect(menuDeps.live()).toBe(false);
    await enter(p);
    expect(menuDeps.live()).toBe(true);
  });
});

describe("?drive", () => {
  interface Drive {
    running(): boolean;
    preload(paths: string[]): Promise<void>;
    to(t: number): { t: number; phase: string; screen: unknown };
    state(): { t: number };
  }
  const drive = (): Drive => (globalThis as unknown as { lunicusDrive: Drive }).lunicusDrive;

  it("ticks only when told, to the tick it is told", async () => {
    const p = await openPage({ search: "?drive&seed=9" });
    expect(drive().running()).toBe(false);
    await drive().preload(["day1/intro.mov"]);
    expect(calls).toContain("fetch day1/intro.mov");
    await enter(p);
    expect(drive().running()).toBe(true);
    p.frame(1000);
    expect(p.game.m.ticks).toBe(0);
    const s = drive().to(40);
    expect(s).toMatchObject({ t: 40, phase: "title" });
    expect(s.screen).toBeTruthy();
    p.game.stopAt = 45;
    expect(drive().to(100).t).toBe(45);
    expect(drive().state().t).toBe(45);
  });
});

describe("?replay", () => {
  const rec = {
    seed: 3,
    ticks: 4,
    files: ["shared/panel."],
    gestures: [
      { t: 0, g: "keydown", key: "ArrowUp" },
      { t: 0, g: "keyup", key: "ArrowUp" },
      { t: 1, g: "menu", id: 7 },
      { t: 1, g: "down", x: 1, y: 2 },
      { t: 2, g: "up", x: 1, y: 2 },
      { t: 2, g: "move", x: 3, y: 4 },
    ],
    checkpoints: [
      { t: 1, what: "the title", phase: "title", level: 1, progress: 1, score: 0, won: false },
      { t: 2, what: "the base", phase: "base", level: 1, progress: 1, score: 0, won: false },
    ],
  };

  it("plays the recorded gestures, compares its checkpoints, and takes no other input", async () => {
    const p = await openPage({ search: "?replay=/replays/x.json&seed=3&pace=2", world: { replay: rec } });
    expect(menuDeps.live()).toBe(false);
    await enter(p);
    expect(lines).toContain("replay: 6 gestures over 4 ticks; fetching 1 files…");
    expect(calls).toContain("fetch shared/panel.");
    p.point("pointerdown", { clientX: 50, clientY: 50 });
    p.point("pointermove", { clientX: 50, clientY: 50 });
    p.fire("pointerup", { clientX: 50, clientY: 50 });
    p.key("keydown", { key: "ArrowDown" });
    p.key("keyup", { key: "ArrowDown" });
    // at pace 2, a frame of 1/60 s is two ticks
    p.frame(1000 / 60 + 1);
    p.frame(1000 / 60);
    expect(calls.filter((c) => /^(keyDown|keyUp|menu|down|up|move) /.test(c))).toEqual([
      "keyDown ArrowUp",
      "keyUp ArrowUp",
      "menu 7",
      "down 1,2",
      "up 1,2",
      "move 3,4",
    ]);
    expect(lines).toContain("✓ the title");
    expect(lines).toContain("! the replay parted from the run at tick 2 (the base)");
    expect(p.loc()).toMatch(/^replay ×2 · checkpoint 2 of 2 · title$/);
    // the viewer sets the pace, and only the pace
    p.key("keydown", { key: "]" });
    p.key("keydown", { key: "[" });
    p.key("keydown", { key: "[" });
    p.frame(1);
    expect(p.loc()).toMatch(/^replay ×1 · /);
  });

  it("opens no saved game over a replay", async () => {
    const p = await openPage({ search: "?replay=/replays/x.json&seed=3", world: { replay: rec, saved: new Uint8Array(4) } });
    p.click("loadBtn");
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.some((c) => c.startsWith("openGame"))).toBe(false);
    void p;
  });

  it("says a recording played on another seed needs that seed", async () => {
    const p = await openPage({ search: "?replay=/replays/x.json&seed=4", world: { replay: rec } });
    p.click("start");
    await vi.waitFor(() => expect(lines.some((l) => l.includes("open the page with &seed=3"))).toBe(true));
  });

  it("says a recording that is not there is not there", async () => {
    const p = await openPage({ search: "?replay=/replays/gone.json&seed=3" });
    p.click("start");
    await vi.waitFor(() => expect(lines.some((l) => l.includes("/replays/gone.json: 404"))).toBe(true));
  });
});
