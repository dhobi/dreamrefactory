/**
 * The play page (`src/main.ts`), in node: the real `index.html` parsed by
 * linkedom, with the shared V0 shell, the game, its input door, the menu bar,
 * the dialogs, the player and the saves standing in for themselves.
 *
 *   npx vitest run jumpraven/tests/page.ts
 *
 * The machine suites drive the GAME, and nothing in node ran this file. What
 * is pinned here is the page between the player and the game: the boot, the
 * clock (a tick per 1/60 s, a few at most behind, `&speed=` times as many in
 * an autoplay), the status line in every place the game can be, which gesture
 * reaches which door of `Input`, the dialogs the game is handed, the Load
 * button and the menu bar's Open, Memory and Exit, and `?autoplay`. How any of
 * it LOOKS is a browser's question.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";

/* ---------------------------------------------------------------- the fakes */

/** what the page asked of the game, the shell, the dialogs and the input door, in order */
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
  dialogOpen: boolean;
  /** what `performance.memory` says, if the browser says anything */
  memory?: { jsHeapSizeLimit: number; usedJSHeapSize: number };
}
let world: World;

type Done<T> = (v: T) => void;
interface Opts {
  seed: number;
  keepSco?: unknown;
  sco: unknown;
  askName: (done: Done<string | null>) => void;
  askQuit: (done: Done<boolean>) => void;
  pause: (done: Done<void>) => void;
  soundDialog: (v: number, theme: boolean, done: Done<unknown>) => void;
  keysDialog: (f: string[], d: string[], done: Done<string[] | null>) => void;
}

class FakeGame {
  phase = "title";
  stopped = "";
  level = 1;
  canOpen = true;
  talkState: { talk: { file: string; line?: string } | null } = { talk: null };
  flight: { fly: boolean; pose: { x: number; y: number; dir: number } } | null = null;
  mart: { selected: { tier: number; kind: number } | null } | null = null;
  records = { score: 500, lives: 3, tally: { kills: { jeep: 1, tank: 2, bike: 3, copter: 4 } } };
  m = {
    ticks: 0,
    film: null as string | null,
    where: "",
    screen: {},
    ambiencePlaying: false,
    playAmbience: () => void calls.push("ambience"),
  };
  tickThrows = false;
  /** the tick after which `tick()` answers false, as a game that has stopped */
  stopAt = Infinity;
  constructor(_files: unknown, readonly opts: Opts) {
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
  bugReport = { game: "Jump Raven" };
  draws = 0;
  constructor(readonly opts: Record<string, unknown>) {
    current.page = this;
  }
  complain = (l: string): void => void lines.push(`! ${l}`);
  say = (l: string): void => void lines.push(l);
  toggleLog = (): void => void calls.push("toggleLog");
  at = (e: { clientX: number; clientY: number }): { x: number; y: number } => ({ x: e.clientX / 2, y: e.clientY / 2 });
  storedSco = (): string => "stored sco";
  keepSco = (): void => {};
  startSound = async (): Promise<void> => void calls.push("startSound");
  draw = (): void => void this.draws++;
  boot = async (o: { preload: readonly string[]; ready: string }): Promise<void> => {
    calls.push(`boot ${o.preload.length}`);
    if (world.bootThrows) throw new Error("no manifest");
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
let menuDeps: { open: () => void; memory: () => void; exit: () => void; live: () => boolean };
/** the dialog Help ▸ Memory put up, and what its buttons do */
let memoryDialog: {
  spec: { controls: { text: string }[] };
  hooks: { onCommand: (id: number, d: { close: () => void }) => unknown };
} | null;

const current: { game?: FakeGame; page?: FakePage } = {};

vi.mock("@dreamfactory/engine/web/v0-page", async (orig) => ({
  ...(await orig<typeof import("@dreamfactory/engine/web/v0-page")>()),
  V0Page: FakePage,
}));
vi.mock("../src/game/game", () => ({ JumpRaven: FakeGame }));
vi.mock("../src/game/input", () => ({
  Input: class {
    down = (x: number, y: number): void => void calls.push(`down ${x},${y}`);
    up = (x: number, y: number): void => void calls.push(`up ${x},${y}`);
    move = (x: number, y: number): void => void calls.push(`move ${x},${y}`);
    keyDown = (k: string, ctrl = false): boolean => (calls.push(`keyDown ${k}${ctrl ? " ctrl" : ""}`), k.startsWith("Arrow"));
    keyUp = (k: string): void => void calls.push(`keyUp ${k}`);
  },
}));
vi.mock("../src/player", () => ({
  Player: class {
    step = (): void => void calls.push("step");
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
  askQuit: () => void calls.push("askQuit"),
  pause: () => void calls.push("pause"),
  soundDialog: () => void calls.push("soundDialog"),
  editKeys: () => void calls.push("editKeys"),
}));
vi.mock("../src/saves", () => ({ JUMPRAVEN_SAVES: {} }));
vi.mock("@dreamfactory/engine/web/save-store", () => ({ useSaveKind: () => {} }));
vi.mock("@dreamfactory/engine/web/save-browser", () => ({
  browseForLoad: async () => {
    if (world.browseFails) throw new Error("the saves would not list");
    return world.saved;
  },
  savesOpen: () => world.savesOpen,
}));
vi.mock("@dreamfactory/engine/web/window-dialog", () => ({
  windowDialogOpen: () => world.dialogOpen,
  openWindowDialog: (_f: unknown, spec: NonNullable<typeof memoryDialog>["spec"], hooks: NonNullable<typeof memoryDialog>["hooks"]) =>
    void (memoryDialog = { spec, hooks }),
}));
vi.mock("@dreamfactory/site/bug-report", () => ({ installBugReport: () => {} }));

/* ----------------------------------------------------------------- the page */

const HTML = readFileSync(join(import.meta.dirname, "../index.html"), "utf8");
const HREF = "http://host/jumpraven/index.html";

interface Page {
  game: FakeGame;
  el: (id: string) => HTMLElement;
  /** a window event (`pointerup`, `pointermove` …) */
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
  /** where the page sent the tab, if anywhere */
  href: () => string;
}

async function openPage(opts: { search?: string; world?: Partial<World> } = {}): Promise<Page> {
  vi.resetModules();
  calls.length = 0;
  lines.length = 0;
  memoryDialog = null;
  world = { bootThrows: false, saved: null, browseFails: false, savesOpen: false, dialogOpen: false, ...opts.world };

  const dom = parseHTML(HTML);
  const { document } = dom;
  const win = new EventTarget();
  const frames: FrameRequestCallback[] = [];
  let clock = 0;
  const loc = { search: opts.search ?? "", href: HREF + (opts.search ?? "") };
  vi.stubGlobal("document", document);
  vi.stubGlobal("addEventListener", win.addEventListener.bind(win));
  vi.stubGlobal("location", loc);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  if (world.memory) vi.stubGlobal("performance", Object.assign(Object.create(performance), { now: () => clock, memory: world.memory }));

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
      Object.assign(e, { repeat: false, ctrlKey: false, metaKey: false, ...props });
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
    href: () => loc.href,
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
  it("preloads the opening and waits for Enter", async () => {
    const p = await openPage();
    expect(calls).toContain("boot 5");
    expect(lines).toContain("ready — Enter plays the intro; Esc skips a film or ends a briefing");
    p.frame();
    expect(p.game.m.ticks).toBe(0);
  });

  it("puts a boot that throws in the log", async () => {
    await openPage({ world: { bootThrows: true } });
    expect(lines).toContain("! Error: no manifest");
  });

  it("hands the game the stored keys and scores, and every dialog of the EXE's", async () => {
    const p = await openPage();
    const o = p.game.opts;
    expect(o.sco).toBe("stored sco");
    expect(o.keepSco).toBeTypeOf("function");
    o.askName(() => {});
    o.askQuit(() => {});
    o.pause(() => {});
    o.soundDialog(3, true, () => {});
    o.keysDialog([], [], () => {});
    expect(calls.slice(-5)).toEqual(["askName", "askQuit", "pause", "soundDialog", "editKeys"]);
  });
});

describe("the clock", () => {
  it("ticks sixty a second, and starts the theme the game asked for", async () => {
    const p = await openPage();
    p.game.m.ambiencePlaying = true;
    await enter(p);
    expect(calls).toContain("ambience");
    p.frame((1000 / 60) * 3 + 1);
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

  it("a second Enter does not start a second clock", async () => {
    const p = await openPage();
    await enter(p);
    p.click("start");
    await vi.waitFor(() => expect(calls.filter((c) => c === "startSound")).toHaveLength(2));
    p.frame(1000 / 60 + 1);
    expect(p.game.m.ticks).toBe(1);
  });

  it("greys the Load button where the game cannot open one", async () => {
    const p = await openPage();
    await enter(p);
    p.game.canOpen = false;
    p.frame(1);
    expect((p.el("loadBtn") as HTMLButtonElement).disabled).toBe(true);
    p.game.canOpen = true;
    p.frame(1);
    expect((p.el("loadBtn") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("the status line", () => {
  /** the line after one frame, with the game set up by `set` */
  async function statusOf(set: (g: FakeGame) => void, search?: string): Promise<string> {
    const p = await openPage({ search });
    await enter(p);
    set(p.game);
    p.frame(1);
    return p.loc();
  }

  it("names the phase, or what the machine says it is showing", async () => {
    expect(await statusOf(() => {})).toBe("title");
    expect(await statusOf((g) => (g.m.where = "the title card"))).toBe("the title card");
  });

  it("says why a game stopped", async () => {
    expect(await statusOf((g) => ((g.phase = "quit"), (g.stopped = "you quit")))).toBe("you quit");
    expect(await statusOf((g) => ((g.phase = "not-ported"), (g.stopped = "day 9")))).toBe("day 9");
  });

  it("names a briefing, then a film", async () => {
    expect(await statusOf((g) => (g.talkState.talk = { file: "PUPPET.1", line: "hello" }))).toBe("briefing: PUPPET.1 · hello");
    expect(await statusOf((g) => (g.talkState.talk = { file: "PUPPET.2" }))).toBe("briefing: PUPPET.2");
    expect(await statusOf((g) => ((g.m.film = "INTRO.MOV"), (g.m.where = "film INTRO.MOV")))).toBe("film INTRO.MOV");
  });

  it("names a flight: its day, its mode, where, and the tally", async () => {
    const s = await statusOf((g) => {
      g.level = 4;
      g.flight = { fly: true, pose: { x: 5, y: 6, dir: 3 } };
    });
    expect(s).toBe("flying, day 2 · FLY (T switches) · 5,6 facing W · kills: 1 jeeps, 2 tanks, 3 bikes, 4 copters · cash 500 · lives 3");
    const hover = await statusOf((g) => (g.flight = { fly: false, pose: { x: 0, y: 0, dir: 0 } }));
    expect(hover).toContain("day 1 · HOVER (T switches) · 0,0 facing N");
  });

  it("names the Mart, and the tier picked in it", async () => {
    expect(await statusOf((g) => (g.mart = { selected: null }))).toBe("the Mart · cash 500");
    expect(await statusOf((g) => (g.mart = { selected: { tier: 1, kind: 4 } }))).toBe("the Mart · cash 500 · selected tier 2 of kind 4");
  });

  it("names the high scores screen", async () => {
    expect(await statusOf((g) => (g.phase = "scores"))).toBe("the high scores screen — PLAY starts a game");
  });
});

describe("input", () => {
  it("hands the mouse to the game in its own pixels", async () => {
    const p = await openPage();
    await enter(p);
    p.point("pointerdown", { clientX: 200, clientY: 100 });
    p.fire("pointermove", { clientX: 202, clientY: 102 });
    p.fire("pointerup", { clientX: 204, clientY: 104 });
    expect(calls).toEqual(expect.arrayContaining(["down 100,50", "move 101,51", "up 102,52"]));
  });

  it("takes no click before Enter, nor under a dialog", async () => {
    const p = await openPage();
    p.point("pointerdown", { clientX: 200, clientY: 100 });
    p.fire("pointerup", { clientX: 200, clientY: 100 });
    await enter(p);
    world.dialogOpen = true;
    p.point("pointerdown", { clientX: 200, clientY: 100 });
    world.dialogOpen = false;
    world.savesOpen = true;
    p.point("pointerdown", { clientX: 200, clientY: 100 });
    expect(calls.some((c) => c.startsWith("down "))).toBe(false);
  });

  it("hands a finger to the gestures, and the gestures to the game", async () => {
    const p = await openPage();
    expect(touchOpts.coords({ clientX: 10, clientY: 10 })).toBeNull();
    await enter(p);
    p.point("pointerdown", { pointerType: "touch" });
    p.fire("pointerup", { pointerType: "touch" });
    p.fire("pointercancel");
    expect(calls).toEqual(expect.arrayContaining(["touch down", "touch cancel"]));
    expect(calls.some((c) => c.startsWith("up "))).toBe(false);
    expect(touchOpts.coords({ clientX: 10, clientY: 10 })).toEqual({ x: 5, y: 5 });
    world.savesOpen = true;
    expect(touchOpts.coords({ clientX: 10, clientY: 10 })).toBeNull();
    touchOpts.press(1, 2);
    touchOpts.release(3, 4);
    touchOpts.sendKey("uparrow");
    expect(calls).toEqual(expect.arrayContaining(["down 1,2", "up 3,4", "keyDown ArrowUp", "keyUp ArrowUp"]));
    // in a flight the panels around the view take a press at once; the view waits
    expect(touchOpts.ownedByGame(10, 10)).toBe(false);
    p.game.phase = "flying";
    expect(touchOpts.ownedByGame(10, 10)).toBe(true);
    expect(touchOpts.ownedByGame(200, 100)).toBe(false);
    p.game.m.film = "CRASH.MOV";
    expect(touchOpts.ownedByGame(10, 10)).toBe(false);
  });

  it("hands keys to the game, with Ctrl, and keeps a plain b for the log", async () => {
    const p = await openPage();
    p.key("keydown", { key: "b" });
    p.key("keydown", { key: "ArrowUp" });
    expect(calls.filter((c) => c.startsWith("key"))).toEqual([]);
    expect(calls).toContain("toggleLog");
    await enter(p);
    const e = { key: "ArrowLeft", preventDefault: vi.fn() };
    p.key("keydown", e);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    p.key("keydown", { key: "x", preventDefault: e.preventDefault });
    p.key("keydown", { key: "b", ctrlKey: true });
    p.key("keydown", { key: "o", metaKey: true });
    p.key("keydown", { ...e, repeat: true });
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    p.key("keyup", { key: "ArrowLeft" });
    expect(calls.filter((c) => c.startsWith("key"))).toEqual(["keyDown ArrowLeft", "keyDown x", "keyDown b ctrl", "keyDown o ctrl", "keyUp ArrowLeft"]);
  });

  it("gives the game no key under a dialog, nor one a text field owns", async () => {
    const p = await openPage();
    await enter(p);
    world.dialogOpen = true;
    p.key("keydown", { key: "ArrowUp" });
    world.dialogOpen = false;
    world.savesOpen = true;
    p.key("keydown", { key: "b" });
    world.savesOpen = false;
    p.key("keydown", { key: "ArrowUp" }, "saveNameInput");
    expect(calls.some((c) => c.startsWith("keyDown") || c === "toggleLog")).toBe(false);
  });
});

describe("the saved games", () => {
  it("opens a saved game, then starts the clock", async () => {
    const p = await openPage({ world: { saved: new Uint8Array(12) } });
    p.click("loadBtn");
    await vi.waitFor(() => expect(calls).toContain("startSound"));
    expect(calls.indexOf("openGame 12")).toBeLessThan(calls.indexOf("startSound"));
    // and File ▸ Open is the same door
    menuDeps.open();
    await vi.waitFor(() => expect(calls.filter((c) => c === "openGame 12")).toHaveLength(2));
  });

  it("opens nothing where the game cannot, and says where it can", async () => {
    const p = await openPage({ world: { saved: new Uint8Array(12) } });
    p.game.canOpen = false;
    p.click("loadBtn");
    await vi.waitFor(() => expect(lines).toContain("File ▸ Open: only on the high scores screen, where the game's menu bar is"));
    expect(calls.some((c) => c.startsWith("openGame"))).toBe(false);
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
});

describe("the menu bar", () => {
  it("gives the bar the game only while it runs and no dialog is up", async () => {
    const p = await openPage();
    expect(menuDeps.live()).toBe(false);
    await enter(p);
    expect(menuDeps.live()).toBe(true);
    world.dialogOpen = true;
    expect(menuDeps.live()).toBe(false);
    world.dialogOpen = false;
    world.savesOpen = true;
    expect(menuDeps.live()).toBe(false);
  });

  it("says the browser does not say how much memory there is, and OK closes it", async () => {
    await openPage();
    menuDeps.memory();
    expect(memoryDialog!.spec.controls[0].text).toBe("Available Memory: the browser does not say");
    const close = vi.fn();
    memoryDialog!.hooks.onCommand(103, { close });
    expect(close).not.toHaveBeenCalled();
    memoryDialog!.hooks.onCommand(101, { close });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("says what the browser says of its heap", async () => {
    await openPage({ world: { memory: { jsHeapSizeLimit: 1000, usedJSHeapSize: 400 } } });
    menuDeps.memory();
    expect(memoryDialog!.spec.controls[0].text).toBe("Available Memory: 600");
  });

  it("leaves for the front door on File ▸ Exit", async () => {
    const p = await openPage();
    menuDeps.exit();
    expect(p.href()).toBe("http://host/");
  });
});

describe("?autoplay", () => {
  it("plays the game itself, at the speed asked, signing its own scores", async () => {
    const p = await openPage({ search: "?autoplay=42&speed=4" });
    expect(p.game.opts.keepSco).toBeUndefined();
    const named = vi.fn();
    p.game.opts.askName(named);
    expect(named).toHaveBeenCalledWith("Autoplay");
    expect(p.el("autoBtn").textContent).toBe("⏹ Stop autoplay");
    await enter(p);
    // the player's hands, not yours
    p.point("pointerdown", { clientX: 200, clientY: 100 });
    p.key("keydown", { key: "ArrowUp" });
    expect(calls.some((c) => c.startsWith("down ") || c.startsWith("keyDown"))).toBe(false);
    // four ticks a 1/60 s, a step before each
    p.frame(1000 / 60 + 1);
    expect(p.game.m.ticks).toBe(4);
    expect(calls.filter((c) => c === "step")).toHaveLength(4);
    expect(p.loc()).toBe("autoplay ×4, seed 42 · title");
    // no step while a dialog is up; the clock still runs
    world.dialogOpen = true;
    p.frame(1000 / 60);
    expect(calls.filter((c) => c === "step")).toHaveLength(4);
    expect(p.game.m.ticks).toBe(8);
  });

  it("plays at game speed on a random seed when not told", async () => {
    const p = await openPage({ search: "?autoplay&speed=99" });
    await enter(p);
    p.frame(1000 / 60 + 1);
    expect(p.loc()).toBe("autoplay ×32, seed random · title");
    const slow = await openPage({ search: "?autoplay" });
    await enter(slow);
    slow.frame(1000 / 60 + 1);
    expect(slow.loc()).toBe("autoplay, seed random · title");
  });

  it("the button starts an autoplay at four times, and stops one", async () => {
    const p = await openPage({ search: "?seed=1" });
    p.click("autoBtn");
    expect(p.href()).toBe(`${HREF}?seed=1&autoplay=&speed=4`);
    const auto = await openPage({ search: "?seed=1&autoplay=7&speed=8" });
    auto.click("autoBtn");
    expect(auto.href()).toBe(`${HREF}?seed=1`);
  });
});
