/**
 * The play page (`src/main.ts`), in node: the real `index.html` parsed by
 * linkedom, with the engine's host, the file store, the saved-games dialog and
 * the bug report standing in for the browser's, and `fetch` answered off the
 * disc on this machine.
 *
 *   npx vitest run --project dust dust/tests/page.ts
 *
 * The playthrough drives the GAME; nothing of it runs this file. What is pinned
 * here is the page between the player and the game: the head phase (the panel
 * and a first room, drawn by the set walker before the engine exists), the
 * boot's order (the plan, the prefetch, the Enter button, `play`, then
 * `coldBoot`), what it says when there is no set or the boot throws, the trace,
 * the save and load hooks, the console handle, and which key, click and finger
 * reaches which engine call. How any of it LOOKS is a browser's question.
 *
 * The walker's half needs the disc and is skipped without it — the bargain every
 * Dust suite makes; the rest runs on a manifest that names nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";

const ROOT = join(import.meta.dirname, "..");
const have = existsSync(join(ROOT, "gamefiles/dustcd/DATA/APOTH.SET"));

/* ---------------------------------------------------------------- the fakes */

/** what the page asked the engine (and the dialogs) to do, in order */
const calls: string[] = [];

interface Disc {
  /** what the manifest lists, by site path */
  manifest: Record<string, number>;
  /** answer a site path off the disc, or 404 */
  serveDisc: boolean;
  files: string[];
  open?: () => Promise<never>;
}
let disc: Disc;

class FakeFiles {
  onBusyChange: ((n: number) => void) | null = null;
  onChunk: ((name: string, bytes: number) => void) | null = null;
  onFileLoaded: ((name: string, bytes: number) => void) | null = null;
  loads: string[] = [];
  misses = ["nowhere.snd", "unilib.snd"];
  paths = ["gamefiles/dustcd/save/START.RTD"];
  size = 1234;
  static async open(): Promise<FakeFiles> {
    if (disc.open) return disc.open();
    return (current.files = new FakeFiles());
  }
  partialProgress(): number {
    return 0.5;
  }
  bytesLeft(list: string[]): number {
    return list.filter((n) => !this.loads.includes(n)).length * 1000;
  }
  has(n: string): boolean {
    return disc.files.includes(n);
  }
  async load(n: string): Promise<Uint8Array | null> {
    if (!disc.files.includes(n)) return null;
    this.onBusyChange?.(1);
    this.loads.push(n);
    this.onChunk?.(n, 1000);
    this.onFileLoaded?.(n, 1000);
    this.onBusyChange?.(0);
    return new Uint8Array(8);
  }
}

class FakeHost {
  globals = new Map<string, unknown>([
    ["day", 1],
    ["clock", 2],
    ["phase", 1],
    ["handitem", ""],
    ["keynorth", "w"],
  ]);
  hit = { type: "scene" };
  bootThrows = false;
  plan = { resources: ["unilib.snd", "new.flt"], casts: ["gang.cst"], landingSet: null as string | null };
  viewer: null | {
    moviePlaying: boolean;
    startTheme(): void;
    press(x: number, y: number): Promise<void>;
    release(x: number, y: number): void;
    hover(x: number, y: number): Promise<string>;
  } = {
    moviePlaying: false,
    startTheme: () => void calls.push("startTheme"),
    press: async (x, y) => void calls.push(`press ${x},${y} shift ${this.session.shiftDown}`),
    release: (x, y) => void calls.push(`release ${x},${y}`),
    hover: async () => "touch",
  };
  session = {
    nextFrame: null as unknown,
    hasRealFrames: false,
    dfVersion: 0,
    onSaveGame: null as ((b: Uint8Array) => Promise<void>) | null,
    onLoadGame: null as (() => Promise<unknown>) | null,
    saveTemplate: null as (() => unknown) | null,
    interp: { globals: this.globals },
    stageName: "new.flt",
    currentFlat: "mainpanel",
    currentSetFile: "TOWN.SET",
    currentSceneName: () => "G15",
    currentViewName: () => "north",
    stageCtrl: { stageFile: { flats: [1, 2] }, currentFlatRegions: () => [1, 2, 3] },
    propRuntime: { shops: new Map([["house.prp", 1]]) },
    actorRuntime: {
      casts: new Map([["gang.cst", 1]]),
      actors: new Map([
        ["peck", { visible: true, setName: "town" }],
        ["kid", { visible: false, setName: "town" }],
      ]),
      currentSet: "town",
      onScreen: () => true,
    },
    activeCamera: () => ({}),
    pointerDown: false,
    shiftDown: false,
    pointerX: 0,
    pointerY: 0,
    setPointer: (x: number, y: number) => {
      this.session.pointerX = x;
      this.session.pointerY = y;
    },
    hitTestAt: () => this.hit,
    track: (p: Promise<unknown>) => p,
    loadGame: async (b: Uint8Array) => (calls.push(`loadGame ${b.length}`), true),
  };
  director = {
    onCursor: null as ((n: string) => void) | null,
    currentRoom: "town",
    picture: "view",
    awaitingChoice: false,
    tick: () => {},
    render: () => {},
    keyDown: async (k: string, esc: boolean) => void calls.push(`key ${k}${esc ? " esc" : ""}`),
  };
  constructor() {
    current.host = this;
  }
  async bootPlan() {
    return this.plan;
  }
  async coldBoot(): Promise<void> {
    calls.push("coldBoot");
    if (this.bootThrows) throw new Error("the boot fell over");
  }
}

let bugOpts: Record<string, (...a: never[]) => unknown> | null = null;
let dialogUp = false;
let nextHost: ((h: FakeHost) => void) | null = null;
const current: { host?: FakeHost; files?: FakeFiles } = {};

vi.mock("@dreamfactory/engine/web/host", () => ({
  GameHost: class extends FakeHost {
    constructor() {
      super();
      nextHost?.(this);
    }
  },
}));
vi.mock("../src/files", () => ({ DustFiles: FakeFiles }));
vi.mock("../src/saves", () => ({
  DUST_SAVES: { name: "dust" },
  dustTemplate: () => "template",
  loadDustTemplate: async () => void calls.push("loadDustTemplate"),
  seedDustSaves: async () => 5,
  shippedDustSaves: () => [{ rel: "save/START.RTD", url: "/site/gamefiles/dustcd/save/START.RTD", name: "START" }],
}));
vi.mock("@dreamfactory/engine/web/save-store", () => ({ useSaveKind: () => void calls.push("useSaveKind") }));
vi.mock("@dreamfactory/engine/web/save-browser", () => ({
  browseForSave: async (_b: Uint8Array, name: string) => void calls.push(`save as ${name}`),
  browseForLoad: async () => (calls.push("load"), null),
  savesOpen: () => dialogUp,
}));
vi.mock("@dreamfactory/site/bug-report", () => ({
  installBugReport: (_btn: unknown, opts: typeof bugOpts) => void (bugOpts = opts),
}));
// the page's URLs, rooted where the fetch stub below can find them
vi.mock("@dreamfactory/site/site", () => ({ siteUrl: (p: string) => `/site/${p}` }));

/* ----------------------------------------------------------------- the page */

const HTML = readFileSync(join(ROOT, "index.html"), "utf8");

/** `fetch`, answered off the disc: the manifest from {@link Disc}, files by path */
async function fakeFetch(url: string): Promise<Response> {
  const path = String(url).replace(/^\/site\//, "");
  if (path === "gamefiles.json") return new Response(JSON.stringify(disc.manifest), { status: 200 });
  calls.push(`fetch ${path}`);
  const onDisc = join(ROOT, path);
  if (!disc.serveDisc || !existsSync(onDisc)) return new Response("missing", { status: 404 });
  const bytes = readFileSync(onDisc);
  return new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } });
}

interface Page {
  document: Document;
  el: (id: string) => HTMLElement;
  fire: (type: string, props?: Record<string, unknown>) => Event;
  point: (type: string, props: Record<string, unknown>) => void;
  click: (id: string) => void;
  frame: (now?: number) => void;
  log: () => string;
}

async function openPage(opts: { touch?: boolean; disc?: Partial<Disc>; html?: (h: string) => string } = {}): Promise<Page> {
  vi.resetModules();
  calls.length = 0;
  bugOpts = null;
  dialogUp = false;
  current.host = undefined;
  current.files = undefined;
  disc = { manifest: {}, serveDisc: false, files: ["unilib.snd", "new.flt", "town.set", "intro3.mov"], ...opts.disc };

  const dom = parseHTML((opts.html ?? ((h) => h))(HTML));
  const { document } = dom;
  const ctx2d = new Proxy(
    {
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    } as Record<string, unknown>,
    { get: (t, k) => (k in t ? t[k as string] : () => undefined), set: () => true },
  );
  const proto = Object.getPrototypeOf(document.createElement("canvas"));
  proto.getContext = () => ctx2d;
  proto.toDataURL = () => "data:image/png;base64,AAAA";
  proto.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1024, height: 768, right: 1024, bottom: 768 });

  const win = new EventTarget();
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("addEventListener", win.addEventListener.bind(win));
  vi.stubGlobal("MutationObserver", dom.MutationObserver ?? class { observe() {} });
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  vi.stubGlobal("navigator", { maxTouchPoints: opts.touch ? 5 : 0 });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {} });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("fetch", fakeFetch);

  const fire = (type: string, props: Record<string, unknown> = {}): Event => {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, { ctrlKey: false, metaKey: false, altKey: false, repeat: false, shiftKey: false, button: 0, clientX: 0, clientY: 0, pointerId: 1, pointerType: "mouse", ...props });
    win.dispatchEvent(e);
    return e;
  };
  const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
  const point = (type: string, props: Record<string, unknown>): void => {
    const e = new dom.Event(type, { cancelable: true });
    Object.assign(e, { pointerId: 1, pointerType: "mouse", button: 0, shiftKey: false, ...props });
    el("screen").dispatchEvent(e);
  };
  await import("../src/main");
  return {
    document: document as unknown as Document,
    el,
    fire,
    point,
    click: (id) => void el(id).dispatchEvent(new dom.Event("click")),
    // a frame is every callback asked for so far, at a time past the trace's throttles
    frame: (now = 10_000) => frames.splice(0).forEach((cb) => cb(now)),
    log: () => el("log").textContent ?? "",
  };
}

/** click the Enter button once the page has offered it, and wait for the boot's account */
async function enter(p: Page): Promise<void> {
  await vi.waitFor(() => expect(p.document.body.querySelector("#boot.ready")).toBeTruthy(), { timeout: 5000 });
  p.click("start");
  await vi.waitFor(() => expect(p.log()).toContain("asked for and never got"));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  nextHost = null;
});

/* ---------------------------------------------------------------- the tests */

describe("the loader", () => {
  it("runs the plan and the prefetch, waits for Enter, then plays and boots", async () => {
    // a browser's audio, enough to be attached on the Enter press
    const gain = () => ({ connect() {}, gain: { value: 1, setValueAtTime() {} } });
    vi.stubGlobal("AudioContext", class { destination = {}; currentTime = 0; state = "running"; createGain = gain; resume = async () => {}; });
    const p = await openPage();
    await vi.waitFor(() => expect(p.document.body.querySelector("#boot.ready")).toBeTruthy(), { timeout: 5000 });
    expect(p.log()).toContain("indexed 1234 names off the Dust CD");
    expect(p.log()).toContain("boot plan: unilib.snd, new.flt");
    expect(p.log()).toContain("  casts: gang.cst  first room: (none named)");
    expect(p.el("bootpct").textContent).toBe("100%");
    expect(p.el("bootsay").textContent).toBe("ready");
    expect(calls).not.toContain("coldBoot");
    // the plan, plus the movie host and the film INTRO2 chains to
    expect(current.files!.loads).toEqual(["unilib.snd", "new.flt", "town.set", "intro3.mov"]);
    expect(calls).toContain("useSaveKind");
    p.click("start");
    await vi.waitFor(() => expect(p.log()).toContain("asked for and never got: nowhere.snd"));
    expect(calls).toContain("coldBoot");
    expect(calls).toContain("startTheme");
    expect(p.document.body.classList.contains("playing")).toBe(true);
    const log = p.log();
    expect(log).toContain("globals: day=1 clock=2 phase=1 handitem=\"\"");
    expect(log).toContain('keys: north="w" east=undefined west=undefined');
    expect(log).toContain("stage: new.flt · flat: mainpanel · 2 flats · 3 buttons on it");
    expect(log).toContain("shops open: house.prp");
    expect(log).toContain("casts open: gang.cst · 2 actors");
    expect(log).toContain("room: TOWN.SET · viewer up");
    expect(log).toContain("playing — arrows or W/A/D to move");
    expect(current.host!.session.dfVersion).toBe(1);
    expect(current.host!.session.hasRealFrames).toBe(true);
    expect(current.host!.session.saveTemplate!()).toBe("template");
    expect(log).toContain("seeded 5 saved games from the disc");
    expect(calls).toContain("loadDustTemplate");
  });

  it("says when the manifest names no set, and boots anyway", async () => {
    const p = await openPage();
    await vi.waitFor(() => expect(p.el("err").textContent).toBe("no Dust sets found under gamefiles/dustcd/DATA/"));
    await enter(p);
  });

  it("opens the log when the boot leaves no viewer", async () => {
    nextHost = (h) => (h.viewer = null);
    const p = await openPage();
    await enter(p);
    expect(p.log()).toContain("room: TOWN.SET · viewer DOWN");
    expect(p.el("log").hidden).toBe(false);
  });

  it("puts a boot that throws in the log", async () => {
    nextHost = (h) => (h.bootThrows = true);
    const p = await openPage();
    await enter(p);
    expect(p.log()).toContain("!! coldBoot threw: the boot fell over");
  });

  it("raises the card over the error when the page itself fails", async () => {
    const p = await openPage({ disc: { open: () => Promise.reject(new Error("no index")) } });
    await vi.waitFor(() => expect(p.el("err").textContent).toBe("Error: no index"));
    expect(p.el("log").hidden).toBe(false);
    expect(p.document.body.classList.contains("playing")).toBe(true);
  });

  it("says a first room the disc does not serve, and stops there", async () => {
    const p = await openPage({ disc: { manifest: { "gamefiles/dustcd/DATA/APOTH.SET": 10 } } });
    await vi.waitFor(() => expect(p.el("err").textContent).toBe("Error: APOTH.SET: HTTP 404"));
    expect(calls).toContain("fetch gamefiles/dustcd/DATA/NEW.FLT");
  });

  it("starts at once where the page says so", async () => {
    const p = await openPage({ html: (h) => h.replace("<head>", '<head><meta name="autostart" content="1" />') });
    await vi.waitFor(() => expect(calls).toContain("coldBoot"), { timeout: 5000 });
    void p;
  });

  it("shows the rate while bytes arrive, and its own words when they stop", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
    const p = await openPage();
    await vi.waitFor(() => expect(p.log()).toContain("indexed 1234 names"));
    // the prefetch is instant here, so by now the bar has its chunks
    await vi.waitFor(() => expect(p.el("bootsay").textContent).toBe("ready"), { timeout: 5000 });
    vi.advanceTimersByTime(1000);
    expect(p.el("bootsay").textContent).not.toBe("");
  });

  it("shows the spinner only for a wait long enough to be one", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const p = await openPage();
    await vi.waitFor(() => expect(current.files?.onBusyChange).toBeTruthy());
    const busy = current.files!.onBusyChange!;
    busy(1);
    busy(1);
    vi.advanceTimersByTime(500);
    expect(p.el("netbusy").hidden).toBe(false);
    busy(0);
    expect(p.el("netbusy").hidden).toBe(true);
    busy(1);
    busy(0);
    vi.advanceTimersByTime(500);
    expect(p.el("netbusy").hidden).toBe(true);
  });
});

describe.skipIf(!have)("the set walker, before the game", () => {
  it("draws the panel and APOTH, and walks it by the arrows", async () => {
    const p = await openPage({ disc: { manifest: { "gamefiles/dustcd/DATA/APOTH.SET": 10, "gamefiles/dustcd/DATA/TOWN.SET": 10 }, serveDisc: true } });
    await vi.waitFor(() => expect(p.log()).toMatch(/APOTH\.SET: v1 · \d+x\d+ grid/), { timeout: 10_000 });
    expect(p.log()).toMatch(/· panel mainpanel \(\d+ buttons\)/);
    expect(p.log()).toMatch(/cell \(\d+,\d+\) facing \d · (walkable|wall ahead)/);
    const before = p.log().split("\n").length;
    // a turn plays its frames a few rAF ticks each, then stands
    p.fire("keydown", { key: "ArrowRight" });
    for (let i = 0; i < 40; i++) {
      p.frame();
      await Promise.resolve();
    }
    await vi.waitFor(() => expect(p.log().split("\n").length).toBeGreaterThan(before));
    p.fire("keydown", { key: "c" });
    expect(p.log()).toMatch(/clut 2\/\d/);
    p.fire("keydown", { key: "ArrowLeft" });
    for (let i = 0; i < 40; i++) {
      p.frame();
      await Promise.resolve();
    }
    p.fire("keydown", { key: "ArrowUp" });
    for (let i = 0; i < 40; i++) {
      p.frame();
      await Promise.resolve();
    }
    p.fire("keydown", { key: "x" });
  });
});

describe("the game, once it runs", () => {
  it("traces the room and the canvas once each, as they change", async () => {
    const p = await openPage();
    await enter(p);
    p.frame(10_000);
    expect(p.log()).toContain("TOWN.SET G15 · north · 1 here, 1 in view");
    expect(p.log()).toContain("canvas ");
    expect(bugOpts!.where()).toBe("TOWN.SET G15 · north · 1 here, 1 in view");
    const lines = p.log().split("\n").length;
    p.frame(20_000);
    expect(p.log().split("\n").length).toBe(lines);
  });

  it("hands the bug report the page's edition, log tail and note", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const p = await openPage();
    await vi.waitFor(() => expect(bugOpts).not.toBeNull());
    expect(bugOpts!.edition()).toContain("dustcd");
    expect((bugOpts!.log as (n: number) => string[])(1)).toHaveLength(1);
    (bugOpts!.note as (how: string) => void)("clipboard");
    expect(p.el("bugNote").textContent).toContain("paste it into the issue");
    (bugOpts!.note as (how: string) => void)("download");
    expect(p.el("bugNote").textContent).toContain("attach dust-bug.png");
    vi.runOnlyPendingTimers();
    expect(p.el("bugNote").textContent).toBe("");
  });

  it("answers the game's save and load through the dialog, named by the room", async () => {
    const p = await openPage();
    await enter(p);
    await current.host!.session.onSaveGame!(new Uint8Array(4));
    expect(calls.find((c) => c.startsWith("save as"))).toMatch(/^save as TOWN - \d{4}-\d\d-\d\d \d\d-\d\d$/);
    await current.host!.session.onLoadGame!();
    expect(calls).toContain("load");
  });

  it("gives the console its handle: the trace, the load clock, a shipped save", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    const p = await openPage();
    await enter(p);
    const dbg = (globalThis as unknown as { dbg: Record<string, (...a: never[]) => unknown> & { viewer: unknown } }).dbg;
    expect((globalThis as { dust?: unknown }).dust).toBe(dbg);
    expect(dbg.viewer).toBe(current.host!.viewer);
    expect((dbg.log() as { lines: string[] }).lines.length).toBeGreaterThan(5);
    expect(dbg.loading()).toHaveProperty("ms");
    expect(await (dbg.loadSave as (n: string) => Promise<boolean>)("nope")).toBe(false);
    expect(p.log()).toContain('dbg.loadSave: no shipped save called "nope"');
    // START is listed, and this disc stub serves nothing
    expect(await (dbg.loadSave as (n: string) => Promise<boolean>)("start.rtd")).toBe(false);
    expect(p.log()).toMatch(/dbg\.loadSave: .*START\.RTD — 404/);
  });

  it("sends keys to the director by the names the boot maps, and says when they are held", async () => {
    const p = await openPage();
    await enter(p);
    p.fire("keydown", { key: "ArrowUp", repeat: true });
    expect(calls).toContain("key uparrow");
    expect(current.host!.globals.get("isrepeat")).toBe(1);
    p.fire("keydown", { key: "Escape" });
    expect(calls).toContain("key . esc");
    p.fire("keydown", { key: "W" });
    expect(calls).toContain("key w");
    p.fire("keydown", { key: "r", ctrlKey: true });
    p.fire("keydown", { key: "Shift" });
    expect(calls).not.toContain("key r");
  });

  it("keeps b for the log, and every key for an open saves dialog", async () => {
    const p = await openPage();
    await enter(p);
    expect(p.el("log").hidden).toBe(true);
    p.fire("keydown", { key: "b" });
    expect(p.el("log").hidden).toBe(false);
    dialogUp = true;
    p.fire("keydown", { key: "ArrowUp" });
    p.fire("keydown", { key: "b" });
    expect(p.el("log").hidden).toBe(false);
    expect(calls.filter((c) => c.startsWith("key "))).toEqual([]);
  });

  it("keeps the log a column where the page says it is one", async () => {
    const p = await openPage({ html: (h) => h.replace("<head>", '<head><meta name="details-always" content="1" />') });
    await enter(p);
    p.el("log").hidden = false;
    p.fire("keydown", { key: "b" });
    expect(p.el("log").hidden).toBe(false);
  });

  it("presses, drags and releases a room, with shift as it was held", async () => {
    const p = await openPage();
    await enter(p);
    p.point("pointerdown", { clientX: 512, clientY: 384, shiftKey: true });
    expect(calls).toContain("press 256,192 shift true");
    expect(current.host!.session.pointerDown).toBe(true);
    p.fire("pointermove", { clientX: 600, clientY: 400 });
    expect(current.host!.session.pointerX).toBe(300);
    p.fire("pointerup", { clientX: 600, clientY: 400 });
    expect(calls).toContain("release 300,200");
    expect(current.host!.session.pointerDown).toBe(false);
    // hovering asks for the cursor the room wants
    p.fire("pointermove", { clientX: 10, clientY: 10 });
    await vi.waitFor(() => expect(p.el("screen").style.cursor).toContain("url("));
    p.el("screen").style.cursor = "";
    p.fire("resize");
    expect(p.el("screen").style.cursor).toContain("url(");
    current.host!.director.onCursor!("arrow");
    // the dialog owns the screen while it is up
    dialogUp = true;
    p.point("pointerdown", { clientX: 10, clientY: 10 });
    expect(calls.filter((c) => c.startsWith("press"))).toHaveLength(1);
  });

  it("drops a mouse press with no room to press, and every pointer before the game", async () => {
    nextHost = (h) => (h.viewer = null);
    const p = await openPage();
    p.point("pointerdown", { clientX: 10, clientY: 10 });
    p.fire("pointermove", { clientX: 10, clientY: 10 });
    await enter(p);
    p.point("pointerdown", { clientX: 10, clientY: 10 });
    p.fire("pointerup", { clientX: 10, clientY: 10 });
    expect(calls.some((c) => c.startsWith("press") || c.startsWith("release"))).toBe(false);
  });
});

describe("a finger", () => {
  it("skips a film by a double tap, with no room open", async () => {
    nextHost = (h) => (h.viewer = null);
    const p = await openPage({ touch: true });
    await enter(p);
    for (let i = 0; i < 2; i++) {
      p.point("pointerdown", { pointerType: "touch", clientX: 500, clientY: 300 });
      p.fire("pointerup", { pointerType: "touch", clientX: 500, clientY: 300 });
    }
    expect(calls).toContain("key . esc");
  });

  it("taps a prop as a press, and walks by a swipe", async () => {
    const p = await openPage({ touch: true });
    await enter(p);
    current.host!.hit = { type: "prop" };
    p.point("pointerdown", { pointerType: "touch", clientX: 512, clientY: 384 });
    expect(calls).toContain("press 256,192 shift false");
    p.fire("pointerup", { pointerType: "touch", clientX: 512, clientY: 384 });
    expect(calls).toContain("release 256,192");
    current.host!.hit = { type: "scene" };
    p.point("pointerdown", { pointerType: "touch", pointerId: 2, clientX: 500, clientY: 700 });
    p.fire("pointermove", { pointerType: "touch", pointerId: 2, clientX: 500, clientY: 400 });
    p.fire("pointermove", { pointerType: "touch", pointerId: 2, clientX: 500, clientY: 200 });
    p.fire("pointerup", { pointerType: "touch", pointerId: 2, clientX: 500, clientY: 200 });
    expect(calls.some((c) => /^key (uparrow|downarrow)$/.test(c))).toBe(true);
    expect(current.host!.globals.get("isrepeat")).toBe(0);
    p.point("pointerdown", { pointerType: "touch", pointerId: 3, clientX: 500, clientY: 700 });
    p.fire("pointercancel", { pointerType: "touch", pointerId: 3 });
  });
});
