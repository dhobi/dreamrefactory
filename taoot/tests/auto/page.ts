/**
 * The play page (`src/main.ts`), in node: the real `play/index.html` parsed by
 * linkedom, with the engine's host, the file store, the intro, the language
 * chooser, the saves and the site's chrome standing in for the browser's.
 *
 *   npx vitest run --project taoot taoot/tests/auto/page.ts
 *
 * The regression suite and the playthrough drive the GAME through `GameHost`;
 * nothing of theirs runs this file. What is pinned here is the page between the
 * player and the game: the boot's order (the language, the edition — a link, a
 * memory, a pinned page or the chooser — the volumes, the intro and the preload,
 * then `coldBoot`), the pane behind X and what it remembers, the settings rows,
 * the session hooks the page answers (dialogs, quit, save and load), and which
 * key, click and finger reaches which engine call. The other pages that load
 * this file are the same file with a meta tag more, and are asked here by adding
 * that tag. How any of it LOOKS is a browser's question.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { DEFAULT_SCREEN_GAMMA } from "@dreamfactory/engine/web/screen-gamma";

/** the gamma the PAGE's module holds: `vi.resetModules` gives each page its own */
const screenGamma = async (): Promise<number> => (await import("@dreamfactory/engine/web/screen-gamma")).screenGamma();

/* ---------------------------------------------------------------- the fakes */

/** what the page asked of the engine, the intro and the dialogs, in order */
const calls: string[] = [];

/** the next page's answers: what is installed, what the intro and chooser say */
interface World {
  manifest: string[];
  editions: string[];
  sets: string[];
  volumes: string[];
  intro: "owns" | "wants" | "unanswered" | "none";
  chooser: string | null | "unavailable";
  preloadThrows?: boolean;
}
let world: World;

const current: {
  host?: FakeHost;
  files?: FakeStore;
  intro?: FakeIntro;
  chooser?: FakeChooser;
} = {};

class FakeStore {
  wire: ((w: { inFlight: number }) => void) | null = null;
  registered: string[] = [];
  edition = "";
  constructor() {
    current.files = this;
  }
  onWire(fn: (w: { inFlight: number }) => void): void {
    this.wire = fn;
  }
  registerServerFile(name: string): void {
    this.registered.push(name);
  }
  availableEditions(): string[] {
    return world.editions;
  }
  setEdition(code: string): void {
    this.edition = code;
  }
  setVolumes(v: string[]): void {
    calls.push(`volumes ${v.join(",")}`);
  }
  serverSetNames(): string[] {
    return world.sets;
  }
  serverUrl(name: string): string | null {
    return `/gamefiles/en/${name}`;
  }
}

class FakeViewer {
  showMap = false;
  showHotspots = false;
  moviePlaying = false;
  conversing = false;
  inputLocked = false;
  viewIdx = 0;
  scene = { sceneName: "Scene3", views: [{ viewName: "View20" }] };
  startTheme(): void {
    calls.push("startTheme");
  }
  renderMap(): void {
    calls.push("renderMap");
  }
  async keyDown(k: string): Promise<void> {
    calls.push(`viewer key ${k}`);
  }
  async pressNav(k: string): Promise<void> {
    calls.push(`nav ${k}`);
  }
}

class FakeHost {
  viewer: FakeViewer | null = new FakeViewer();
  themeMix = 1;
  hooks: Record<string, (...a: never[]) => unknown>;
  overlay = false;
  hit = { type: "scene" };
  session = {
    everyLineSubtitled: false,
    hasRealFrames: false,
    nextFrame: async () => {},
    onNoteDialog: null as unknown as (m: string) => void,
    onQuestionDialog: null as unknown as (m: string) => boolean,
    onTextDialog: null as unknown as (p: string, i: string) => string,
    onQuit: null as unknown as () => void,
    onSaveGame: null as unknown as (b: Uint8Array) => Promise<void>,
    onLoadGame: null as unknown as () => Promise<unknown>,
    saveTemplate: null as unknown as () => unknown,
    interp: { globals: new Map<string, unknown>() },
    track: (p: unknown) => p,
    setPointer: (x: number, y: number) => {
      this.session.pointerX = x;
      this.session.pointerY = y;
    },
    pointerX: 0,
    pointerY: 0,
    pointerDown: false,
    shiftDown: false,
    hitTestAt: () => this.hit,
    viewShowing: true,
    stageCtrl: { keydownTarget: () => this.overlay },
    stageOpen: false,
    stageName: "none",
    currentFlat: "none",
    currentSetName: "bedsit1",
    currentSetFile: "bedsit1.set",
    currentSceneName: () => "scene3",
    currentViewName: () => "view20",
    pictureMode: "original",
    lowMemory: false,
    moveSpeed: "original",
  };
  director = {
    onCursor: null as ((n: string) => void) | null,
    moviePlaying: false,
    movieFile: "",
    movingCamera: false,
    currentRoom: null,
    picture: "view",
    awaitingChoice: false,
    press: async (x: number, y: number) => void calls.push(`press ${x},${y}`),
    release: (x: number, y: number) => void calls.push(`release ${x},${y}`),
    hover: async () => "touch",
    keyDown: async (k: string, special: boolean) => void calls.push(`key ${k}${special ? " special" : ""}`),
    tick: () => {},
    render: () => {},
  };
  constructor(_files: unknown, _audio: unknown, hooks: Record<string, (...a: never[]) => unknown>) {
    this.hooks = hooks;
    current.host = this;
  }
  async bootPlan() {
    return { volumes: world.volumes };
  }
  async preload(opts: { sizeOf: (n: string) => number; onProgress?: (l: number, t: number) => void }) {
    calls.push(`preload ${opts.sizeOf("bootfile")}`);
    opts.onProgress?.(1024 * 1024, 4 * 1024 * 1024);
    opts.onProgress?.(0, 0);
    if (world.preloadThrows) throw new Error("no");
  }
  async coldBoot(opts: { tour?: boolean }) {
    calls.push(`coldBoot${opts.tour ? " tour" : ""}`);
    this.hooks.showStage();
  }
  async restart(opts: { tour?: boolean }) {
    calls.push(`restart${opts.tour ? " tour" : ""}`);
  }
}

class FakeIntro {
  onLog: ((l: string) => void) | null = null;
  done: Promise<void>;
  finish!: () => void;
  skippable = true;
  constructor() {
    current.intro = this;
    this.done = new Promise((r) => (this.finish = r));
  }
  async open(): Promise<boolean> {
    return world.intro !== "none";
  }
  click(x: number, y: number): void {
    calls.push(`intro click ${x},${y}`);
  }
  regions() {
    return [{ x0: 0, y0: 0, x1: 100, y1: 100, target: "yes" }];
  }
  key(k: string, special: boolean): boolean {
    calls.push(`intro key ${k}${special ? " special" : ""}`);
    return this.skippable;
  }
  tick(): void {}
  render(): void {}
  answer() {
    return world.intro;
  }
  close(): void {
    calls.push("intro close");
  }
}

class FakeChooser {
  picked: string | null = null;
  constructor(_s: unknown, readonly available: string[]) {
    current.chooser = this;
  }
  async open(): Promise<boolean> {
    return world.chooser !== "unavailable";
  }
  render(): void {}
  async click(x: number, y: number): Promise<void> {
    calls.push(`chooser click ${x},${y}`);
    if (x > 0) this.picked = world.chooser as string;
  }
  async key(k: string): Promise<void> {
    calls.push(`chooser key ${k}`);
    if (k === "d") this.picked = world.chooser as string;
  }
  chosen(): string | null {
    return this.picked;
  }
  async close(): Promise<void> {
    calls.push("chooser close");
  }
}

let bugOpts: Record<string, (...a: never[]) => unknown> | null = null;
let stateResets = 0;

vi.mock("@dreamfactory/engine/web/host", () => ({ GameHost: FakeHost }));
vi.mock("../../src/files", () => ({ FileStore: FakeStore }));
vi.mock("../../src/editions", () => ({
  editionsIn: (paths: string[]) => [...new Set(paths.map((p) => p.split("/")[1]))],
  gamefileManifest: async () => world.manifest,
  gamefileSizes: async () => ({ "gamefiles/en/bootfile": 98_000 }),
  installEditionPicker: async () => void calls.push("picker"),
  markEdition: (_el: unknown, code: string) => void calls.push(`mark ${code}`),
}));
vi.mock("../../src/nightdive", () => ({
  GOG_URL: "https://gog.example/titanic",
  NIGHTDIVE_MOVIE: "nightdive.mov",
  NightdiveIntro: FakeIntro,
  introPlaysFor: (code: string) => code === "en",
}));
vi.mock("../../src/lang-chooser", async (actual) => ({
  ...(await actual<typeof import("../../src/lang-chooser")>()),
  LangChooser: FakeChooser,
}));
vi.mock("../../src/save-seed", () => ({
  seedSaves: async () => void calls.push("seedSaves"),
  loadTemplates: async () => void calls.push("loadTemplates"),
  saveTemplateFor: (disc: string) => `template ${disc}`,
}));
vi.mock("../../src/captions", () => ({ installCaptions: (_s: unknown, code: string) => void calls.push(`captions ${code}`) }));
vi.mock("@dreamfactory/engine/web/save-browser", () => ({
  browseForSave: async (_b: Uint8Array, name: string) => void calls.push(`save as ${name}`),
  browseForLoad: async () => (calls.push("load"), null),
}));
vi.mock("@dreamfactory/engine/web/save-store", () => ({
  TAOOT_SAVES: { name: "taoot" },
  useSaveKind: (k: { valid: (b: Uint8Array) => boolean }) => void calls.push(`saveKind ${typeof k.valid}`),
}));
vi.mock("@dreamfactory/engine/web/load-clock", () => ({ loadClock: { ms: 12, waiting: false }, watchLoads: () => () => {} }));
vi.mock("@dreamfactory/engine/web/state-list", async (actual) => ({
  ...(await actual<typeof import("@dreamfactory/engine/web/state-list")>()),
  installStateList: () => ({ reset: () => void stateResets++ }),
}));
vi.mock("@dreamfactory/engine/runtime/trace", () => ({ snapshotState: () => ({ live: true }) }));
vi.mock("@dreamfactory/engine/web/debug-panel", () => ({ stateDump: (_s: unknown, lines: string[], head: string[]) => [...head, ...lines].join("\n") }));
vi.mock("@dreamfactory/engine/web/tylerhartman", () => ({
  excludeEachOther: () => {},
  TylerHartman: class {
    on = false;
    onRescale: (() => void) | null = null;
    toggle() {
      calls.push("th toggle");
    }
    touchDown() {
      return false;
    }
    touchUp() {
      return false;
    }
    frame() {}
  },
}));
vi.mock("@dreamfactory/site/locales", () => ({ installI18n: async () => {}, t: (k: string) => k }));
vi.mock("@dreamfactory/site/lang-menu", () => ({ installLanguageMenu: () => {} }));
vi.mock("@dreamfactory/site/play-menu", () => ({ installPlayMenu: async () => {} }));
vi.mock("@dreamfactory/site/version", () => ({ VERSION: "0.0.0-test", installVersion: () => {} }));
vi.mock("@dreamfactory/site/bug-report", () => ({
  installBugReport: (_b: unknown, opts: typeof bugOpts) => void (bugOpts = opts),
}));

/* ----------------------------------------------------------------- the page */

const HTML = readFileSync(join(import.meta.dirname, "../../play/index.html"), "utf8");
const EN = ["gamefiles/en/titanic1/data/bootfile", "gamefiles/en/titanic1/data/bedsit1.set", "gamefiles/en/titanic1/movies/opentour.mov"];

interface Page {
  document: Document;
  el: (id: string) => HTMLElement;
  win: Record<string, unknown> & { location: { search: string; assigned: string } };
  store: Map<string, string>;
  fire: (type: string, props?: Record<string, unknown>) => Event;
  point: (type: string, props: Record<string, unknown>) => void;
  click: (id: string) => void;
  change: (el: Element) => void;
  frame: () => void;
  log: () => string;
}

async function openPage(
  opts: { metas?: string; search?: string; world?: Partial<World>; stored?: Record<string, string>; touch?: boolean; denyStorage?: boolean; clipboard?: boolean } = {},
): Promise<Page> {
  vi.resetModules();
  calls.length = 0;
  bugOpts = null;
  stateResets = 0;
  Object.assign(current, { host: undefined, files: undefined, intro: undefined, chooser: undefined });
  world = { manifest: EN, editions: ["en"], sets: ["bedsit1.set"], volumes: ["TITANIC1"], intro: "none", chooser: null, ...opts.world };

  const dom = parseHTML(opts.metas ? HTML.replace("<head>", `<head>${opts.metas}`) : HTML);
  const { document } = dom;
  const ctx2d = new Proxy(
    { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) } as Record<string, unknown>,
    { get: (t, k) => (k in t ? t[k as string] : () => undefined), set: () => true },
  );
  const proto = Object.getPrototypeOf(document.createElement("canvas"));
  proto.getContext = () => ctx2d;
  proto.toDataURL = () => "data:image/png;base64,AAAA";
  proto.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1024, height: 768, right: 1024, bottom: 768 });
  // linkedom's <select> keeps no value of its own to set; the page sets one
  Object.defineProperty(Object.getPrototypeOf(document.createElement("select")), "value", {
    configurable: true,
    get(this: { _value?: string }) {
      return this._value ?? "";
    },
    set(this: { _value?: string }, v: string) {
      this._value = v;
    },
  });
  const screenEl = document.getElementById("screen") as unknown as { width: number; height: number };
  screenEl.width = 512;
  screenEl.height = 384;

  const store = new Map(Object.entries(opts.stored ?? {}));
  const localStorage = {
    getItem: (k: string) => {
      if (opts.denyStorage) throw new Error("denied");
      return store.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (opts.denyStorage) throw new Error("denied");
      store.set(k, v);
    },
  };
  const target = new EventTarget();
  const frames: FrameRequestCallback[] = [];
  const location = { href: "http://localhost/play/", search: opts.search ?? "", assigned: "", assign: (u: string) => void (location.assigned = u) };
  const win = Object.assign(Object.create(globalThis), {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    location,
    localStorage,
    alert: (m: string) => void calls.push(`alert ${m}`),
    confirm: (m: string) => (calls.push(`confirm ${m}`), true),
    prompt: (m: string, i: string) => (calls.push(`prompt ${m} ${i}`), m === "cancel" ? null : "typed"),
  });
  const clipboard = { writeText: async (t: string) => (opts.clipboard === false ? Promise.reject(new Error("no")) : void calls.push(`clipboard ${t.split("\n")[0]}`)) };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", win);
  vi.stubGlobal("addEventListener", target.addEventListener.bind(target));
  vi.stubGlobal("location", location);
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("navigator", { maxTouchPoints: opts.touch ? 5 : 0, userAgent: "node", clipboard });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal("MutationObserver", dom.MutationObserver ?? class { observe() {} });
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));

  const fire = (type: string, props: Record<string, unknown> = {}): Event => {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, clientX: 0, clientY: 0, pointerId: 1, pointerType: "mouse", button: 0, ...props });
    target.dispatchEvent(e);
    return e;
  };
  const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
  const point = (type: string, props: Record<string, unknown>): void => {
    const e = new dom.Event(type, { cancelable: true });
    Object.assign(e, { pointerId: 1, pointerType: "mouse", button: 0, shiftKey: false, ...props });
    el("screen").dispatchEvent(e);
  };
  await import("../../src/main");
  return {
    document: document as unknown as Document,
    el,
    win,
    store,
    fire,
    point,
    click: (id) => void el(id).dispatchEvent(new dom.Event("click")),
    change: (node) => void node.dispatchEvent(new dom.Event("change")),
    frame: () => frames.splice(0).forEach((cb) => cb(0)),
    log: () => el("scriptlog").textContent ?? "",
  };
}

const booted = (p: Page) => vi.waitFor(() => expect(calls.some((c) => c.startsWith("coldBoot"))).toBe(true));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ---------------------------------------------------------------- the tests */

describe("the boot", () => {
  it("settles the edition, reads the volumes, preloads and boots", async () => {
    const p = await openPage();
    await booted(p);
    expect(calls).toContain("captions en");
    expect(calls).toContain("mark en");
    expect(calls).toContain("volumes TITANIC1");
    expect(calls).toContain("preload 98000");
    expect(calls).toContain("saveKind function");
    expect(current.files!.edition).toBe("en");
    expect(current.files!.registered).toEqual(expect.arrayContaining(["bootfile", "nightdive.mov"]));
    expect(p.el("preloadNum").textContent).toBe("1.0 / 4.0 MB");
    expect(p.el("preload").hidden).toBe(true);
    expect(p.el("booting").style.display).toBe("none");
    expect(p.el("help").style.display).toBe("block");
    expect(p.document.body.classList.contains("spoken")).toBe(true);
    // the stage came up from a boot: the pane is reset, and stays shut unasked
    expect(stateResets).toBe(1);
    expect(p.el("details").hidden).toBe(true);
    await vi.waitFor(() => expect(calls).toContain("loadTemplates"));
  });

  it("stays on the boot text with no manifest, and with no sets", async () => {
    let p = await openPage({ world: { manifest: [] } });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.some((c) => c.startsWith("coldBoot"))).toBe(false);
    expect(current.files!.registered).toEqual([]);
    p = await openPage({ world: { sets: [] } });
    await vi.waitFor(() => expect(calls).toContain("volumes TITANIC1"));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.some((c) => c.startsWith("coldBoot"))).toBe(false);
    void p;
  });

  it("takes ?edition=, then a remembered one, before asking", async () => {
    await openPage({ search: "?edition=de", world: { editions: ["en", "de"], manifest: [...EN, "gamefiles/de/x"] } });
    await vi.waitFor(() => expect(calls).toContain("captions de"));
    await openPage({ stored: { "taoot.edition": "de" }, world: { editions: ["en", "de"] } });
    await vi.waitFor(() => expect(current.files!.edition).not.toBe(""));
    expect(current.chooser).toBeUndefined();
  });

  it("asks the chooser when more than one edition could be meant, and remembers", async () => {
    const p = await openPage({ world: { editions: ["en", "de", "fr"], chooser: "fr" } });
    await vi.waitFor(() => expect(current.chooser).toBeDefined());
    await vi.waitFor(() => expect(p.document.body.classList.contains("playing")).toBe(true));
    // a click on nothing picks nothing; a letter the stage's buttons know picks
    p.point("pointerdown", { clientX: 0, clientY: 0 });
    p.fire("keydown", { key: "Shift" });
    p.fire("keydown", { key: "d" });
    await vi.waitFor(() => expect(calls).toContain("chooser close"));
    await booted(p);
    expect(current.files!.edition).toBe("fr");
    expect([...p.store.values()]).toContain("fr");
    // the chooser's own "loading" flat is up, so the bar is not drawn over it
    expect(p.el("preloadNum").textContent).toBe("");
  });

  it("boots the first edition when the chooser cannot open", async () => {
    const p = await openPage({ world: { editions: ["en", "de"], chooser: "unavailable" } });
    await booted(p);
    expect(p.log()).not.toContain("language chooser:"); // the boot's chatter is cleared by the stage
    expect(current.files!.edition).toBe("en");
  });

  it("plays the intro, and leaves for GOG on its 'no'", async () => {
    const p = await openPage({ world: { intro: "wants" } });
    await vi.waitFor(() => expect(current.intro).toBeDefined());
    await vi.waitFor(() => expect(p.document.body.classList.contains("playing")).toBe(true));
    p.point("pointerdown", { clientX: 100, clientY: 100 });
    p.point("pointerdown", { clientX: 900, clientY: 700 });
    p.fire("keydown", { key: "Escape" });
    current.intro!.skippable = false;
    p.fire("keydown", { key: "Escape" });
    p.fire("keydown", { key: "7" });
    p.fire("keydown", { key: "7", ctrlKey: true });
    p.frame();
    expect(calls).toContain("intro click 50,50");
    expect(calls).toContain("intro key . special");
    expect(calls).toContain("intro key 7");
    expect((p.win.dbg as { intro: unknown }).intro).toBe(current.intro);
    current.intro!.finish();
    await vi.waitFor(() => expect(p.win.location.assigned).toBe("https://gog.example/titanic"));
    expect(calls).toContain("intro close");
    expect(calls.some((c) => c.startsWith("coldBoot"))).toBe(false);
  });

  it("boots after the intro's 'yes'", async () => {
    const p = await openPage({ world: { intro: "owns" } });
    await vi.waitFor(() => expect(current.intro).toBeDefined());
    current.intro!.finish();
    await booted(p);
  });

  it("a speedrun page: pinned to its edition, no film, the pane always up", async () => {
    const metas = '<meta name="edition" content="EN"><meta name="skip-intro" content="1"><meta name="details-always" content="1"><meta name="mute-theme" content="1">';
    const p = await openPage({ metas, world: { editions: ["en", "de"], intro: "owns" } });
    await booted(p);
    expect(current.intro).toBeUndefined();
    expect(current.host!.themeMix).toBe(0);
    expect(p.el("details").hidden).toBe(false);
    // X does not shut a pane that is the page
    p.fire("keydown", { key: "x" });
    expect(p.el("details").hidden).toBe(false);
  });

  it("says when a page's pinned edition is not installed", async () => {
    const p = await openPage({ metas: '<meta name="edition" content="ja"><meta name="details-always" content="log">' });
    await vi.waitFor(() => expect(p.log()).toContain("this page asks for the ja edition, which is not installed"));
  });

  it("a tour page: only the editions with a tour, and the tour on boot and on quit", async () => {
    const metas = '<meta name="start-mode" content="tour"><meta name="details-never" content="1">';
    const p = await openPage({
      metas,
      search: "?debug=1",
      world: { editions: ["en", "demo"], manifest: [...EN, "gamefiles/demo/data/bootfile"] },
    });
    await vi.waitFor(() => expect(calls).toContain("coldBoot tour"));
    expect(current.files!.edition).toBe("en");
    // ?debug=1 does not raise a pane this page has no business showing
    expect(p.el("details").hidden).toBe(true);
    current.host!.session.onQuit();
    // the restart waits for the frame the quit was asked on to finish
    p.frame();
    await vi.waitFor(() => expect(calls).toContain("restart tour"));
  });

  it("boots the default when nothing playable is installed", async () => {
    const p = await openPage({ world: { editions: [] } });
    await booted(p);
    expect(current.files!.edition).toBe("en");
  });
});

describe("the pane behind X", () => {
  it("opens and shuts on X, and remembers", async () => {
    const p = await openPage();
    await booted(p);
    p.fire("keydown", { key: "x" });
    expect(p.el("details").hidden).toBe(false);
    expect(p.store.get("taoot.details.open")).toBe("1");
    p.fire("keydown", { key: "X" });
    expect(p.el("details").hidden).toBe(true);
    expect(p.store.get("taoot.details.open")).toBe("0");
  });

  it("comes up on ?debug=1 with the state and the inputs, and copies the details", async () => {
    const p = await openPage({ search: "?debug=1" });
    await booted(p);
    expect(p.store.get("taoot.details.state")).toBe("1");
    expect(p.store.get("taoot.details.inputs")).toBe("1");
    expect(p.el("details").hidden).toBe(false);
    p.click("dbgCopy");
    await vi.waitFor(() => expect(calls).toContain("clipboard taoot 0.0.0-test"));
    expect(p.el("dbgNote").textContent).toBe("play.debugCopied");
  });

  it("saves the details as a file when the clipboard says no", async () => {
    const p = await openPage({ clipboard: false });
    await booted(p);
    p.click("dbgCopy");
    await vi.waitFor(() => expect(p.el("dbgNote").textContent).toBe("play.debugSaved"));
  });

  it("survives storage that refuses", async () => {
    const p = await openPage({ denyStorage: true, search: "?debug=1" });
    await booted(p);
    // nothing remembered, so the boot shut it; X still opens it for this tab
    expect(p.el("details").hidden).toBe(true);
    p.fire("keydown", { key: "x" });
    expect(p.el("details").hidden).toBe(false);
  });

  it("logs the boot's lines, and a quit's", async () => {
    const p = await openPage({ world: { editions: ["en", "de"], manifest: [...EN] }, metas: '<meta name="start-mode" content="tour">' });
    await vi.waitFor(() => expect(p.log()).toContain("has no guided tour"));
    await booted(p);
    current.host!.session.onQuit();
    expect(p.log()).toContain("quit() — back to the main menu");
  });
});

describe("the session hooks", () => {
  it("answers the dialogs, the save and load, and lends a template by disc", async () => {
    const p = await openPage();
    await booted(p);
    const s = current.host!.session;
    s.onNoteDialog("hello");
    expect(s.onQuestionDialog("sure?")).toBe(true);
    expect(s.onTextDialog("name?", "x")).toBe("typed");
    expect(s.onTextDialog("cancel", "x")).toBe("");
    expect(calls).toEqual(expect.arrayContaining(["alert hello", "confirm sure?"]));
    await s.onSaveGame(new Uint8Array(1));
    expect(calls.find((c) => c.startsWith("save as"))).toMatch(/^save as bedsit1\.set - \d{4}-/);
    await s.onLoadGame();
    expect(calls).toContain("load");
    expect(s.saveTemplate()).toBe("template 1");
    s.interp.globals.set("mission", 4);
    expect(s.saveTemplate()).toBe("template 2");
    // the page's yield is a real frame
    const yielded = s.nextFrame();
    p.frame();
    await yielded;
  });

  it("restarts in place on quit, and says when that fails", async () => {
    const p = await openPage();
    await booted(p);
    current.host!.restart = async () => {
      throw new Error("broke");
    };
    current.host!.session.onQuit();
    p.frame();
    await vi.waitFor(() => expect(p.log()).toContain("restart failed: broke"));
  });

  it("hands the bug report the room, the edition, the log tail and a note", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const p = await openPage();
    await vi.waitFor(() => expect(bugOpts).not.toBeNull());
    (current.host!.hooks.hud as (t: string) => void)("bedsit1 — Scene3");
    expect(bugOpts!.where()).toBe("bedsit1 — Scene3");
    expect(bugOpts!.edition()).toContain("(gamefiles/en/)");
    expect((bugOpts!.log as (n: number) => string[])(5)).toBeInstanceOf(Array);
    (bugOpts!.note as (h: string) => void)("clipboard");
    expect(p.el("bugNote").textContent).toBe("play.bugShotClipboard");
    (bugOpts!.note as (h: string) => void)("file");
    expect(p.el("bugNote").textContent).toBe("play.bugShotFile");
    vi.runOnlyPendingTimers();
    expect(p.el("bugNote").textContent).toBe("");
  });

  it("draws the map when the viewer shows one, and hides it when not", async () => {
    const p = await openPage();
    await booted(p);
    p.fire("keydown", { key: "m" });
    expect(calls).toContain("renderMap");
    expect(p.el("minimap").style.display).toBe("block");
    p.fire("keydown", { key: "M" });
    expect(p.el("minimap").style.display).toBe("none");
    current.host!.hooks.mapChanged();
  });

  it("hands the console and the browser suite their handle", async () => {
    const p = await openPage();
    await booted(p);
    const dbg = p.win.dbg as { session: unknown; log: () => { lines: string[] }; loading: () => { ms: number } };
    expect(dbg.session).toBe(current.host!.session);
    expect(dbg.log().lines).toBeInstanceOf(Array);
    expect(dbg.loading().ms).toBe(12);
  });

  it("attaches audio on the first gesture and restarts the theme", async () => {
    vi.stubGlobal("AudioContext", class {
      createGain() {
        return { gain: { value: 1 }, connect() {} };
      }
      destination = {};
    });
    const p = await openPage();
    await booted(p);
    p.fire("pointerdown");
  });
});

describe("the settings rows", () => {
  it("reads the picture mode, the old checkbox, and keeps a change", async () => {
    let p = await openPage({ stored: { "taoot.picture.sharplanding": "1" } });
    expect(current.host!.session.pictureMode).toBe("sharp");
    const sel = p.el("pictureMode") as unknown as HTMLSelectElement;
    sel.value = "soft";
    p.change(sel);
    expect(current.host!.session.pictureMode).toBe("soft");
    expect(p.store.get("taoot.picture.landing")).toBe("soft");
    sel.value = "nonsense";
    p.change(sel);
    expect(current.host!.session.pictureMode).toBe("soft");
    p = await openPage({ denyStorage: true });
    expect(current.host!.session.pictureMode).toBe("original");
    p.change(p.el("pictureMode"));
  });

  it("sets brightness by preset, and follows the F-keys between them", async () => {
    const p = await openPage({ stored: { "taoot.picture.brightness": "brighter" } });
    expect(await screenGamma()).toBeLessThan(DEFAULT_SCREEN_GAMMA);
    const radios = [...p.el("brightnessSeg").querySelectorAll("input")] as unknown as HTMLInputElement[];
    expect(radios.find((r) => r.checked)?.value).toBe("brighter");
    const darker = radios.find((r) => r.value === "darker")!;
    darker.checked = true;
    p.change(darker);
    expect(p.store.get("taoot.picture.brightness")).toBe("darker");
    expect(await screenGamma()).toBeGreaterThan(DEFAULT_SCREEN_GAMMA);
    // F1 lifts it a step, off every preset; F9 puts it back on the default
    p.fire("keydown", { key: "F1" });
    expect(radios.some((r) => r.checked)).toBe(false);
    p.fire("keydown", { key: "F9" });
    expect(await screenGamma()).toBe(DEFAULT_SCREEN_GAMMA);
    expect(radios.find((r) => r.checked)?.value).toBe("default");
    // an unchecked radio's change is nobody's
    darker.checked = false;
    p.change(darker);
  });

  it("sets the movement speed and shows its number", async () => {
    const p = await openPage({ stored: { "taoot.move.speed": "fast" } });
    expect(current.host!.session.moveSpeed).toBe("fast");
    expect(p.el("movementValue").textContent).toMatch(/ ms$/);
    const radios = [...p.el("movementSeg").querySelectorAll("input")] as unknown as HTMLInputElement[];
    const slow = radios.find((r) => r.value === "slow")!;
    slow.checked = true;
    p.change(slow);
    expect(current.host!.session.moveSpeed).toBe("slow");
    expect(p.store.get("taoot.move.speed")).toBe("slow");
    slow.checked = false;
    p.change(slow);
  });

  it("keeps the low-memory box and the every-line box", async () => {
    const p = await openPage({ stored: { "taoot.sound.lowmemory": "1", "taoot.subtitles.everyLine": "1" } });
    expect(current.host!.session.lowMemory).toBe(true);
    expect(current.host!.session.everyLineSubtitled).toBe(true);
    void p;
  });
});

describe("input", () => {
  it("sends the arrows through the script chain and the rest as keys", async () => {
    const p = await openPage();
    await booted(p);
    for (const key of ["ArrowUp", "ArrowLeft", "ArrowRight", "ArrowDown", " ", "Escape", "w", "Shift"]) p.fire("keydown", { key });
    p.fire("keydown", { key: "r", ctrlKey: true });
    expect(calls).toEqual(expect.arrayContaining(["nav uparrow", "nav leftarrow", "nav rightarrow", "key downarrow", "key  ", "key . special", "key w"]));
    expect(calls).not.toContain("key r");
    expect(calls).not.toContain("key shift");
  });

  it("gives an overlay stage every key, X included", async () => {
    const p = await openPage();
    await booted(p);
    current.host!.overlay = true;
    current.host!.session.viewShowing = false;
    p.fire("keydown", { key: "x" });
    p.fire("keydown", { key: "Escape" });
    p.fire("keydown", { key: "Shift" });
    p.fire("keydown", { key: "ArrowUp" });
    expect(calls).toEqual(expect.arrayContaining(["key x", "key . special", "key uparrow"]));
    expect(p.el("details").hidden).toBe(true);
  });

  it("toggles the hotspots on O, and leaves M and O alone with no room", async () => {
    const p = await openPage();
    await booted(p);
    p.fire("keydown", { key: "o" });
    expect(current.host!.viewer!.showHotspots).toBe(true);
    p.fire("keydown", { key: "O" });
    expect(current.host!.viewer!.showHotspots).toBe(false);
    current.host!.viewer = null;
    p.fire("keydown", { key: "o" });
    p.fire("keydown", { key: "m" });
    // and with no room an arrow has nowhere to go, but a key still reaches the game
    p.fire("keydown", { key: "ArrowUp" });
    p.fire("keydown", { key: "Escape" });
    expect(calls.filter((c) => c.startsWith("nav"))).toEqual([]);
    expect(calls).toContain("key . special");
  });

  it("clicks on the framebuffer, carries Shift, and releases where the pointer is", async () => {
    const p = await openPage();
    await booted(p);
    p.point("pointerdown", { clientX: 200, clientY: 100, shiftKey: true });
    expect(calls).toContain("press 100,50");
    expect(current.host!.session.shiftDown).toBe(true);
    p.point("mousemove", { clientX: 400, clientY: 300 });
    p.fire("pointerup");
    // where the drag left the pointer, which a move while held only tracks
    expect(calls).toContain("release 200,150");
    p.point("mousemove", { clientX: 400, clientY: 300 });
    await vi.waitFor(() => expect(p.el("screen").style.cursor).toContain("url("));
    current.host!.director.onCursor!("");
  });

  it("names where a logged input landed: a film, a stage, no room", async () => {
    const p = await openPage({ search: "?debug=1" });
    await booted(p);
    const h = current.host!;
    // each key moves the game somewhere, as the director would, and the line names it
    const moves: (() => void)[] = [
      () => {
        h.director.moviePlaying = true;
        h.director.movieFile = "logo.mov";
      },
      () => {
        h.director.moviePlaying = false;
        h.session.viewShowing = false;
        h.session.stageOpen = true;
        h.session.stageName = "demo.stg";
        h.session.currentFlat = "demo.1";
      },
      () => {
        h.session.stageOpen = false;
      },
    ];
    h.director.keyDown = async () => void moves.shift()?.();
    p.fire("keydown", { key: "Escape" });
    await vi.waitFor(() => expect(p.log()).toContain("→ logo.mov"));
    p.fire("keydown", { key: "z" });
    await vi.waitFor(() => expect(p.log()).toContain('→ demo.stg · flat "demo.1"'));
    p.fire("keydown", { key: "q" });
    await vi.waitFor(() => expect(p.log()).toContain("→ no room open"));
    // and a press behind a moving camera is filed, not lost
    h.session.viewShowing = true;
    h.director.movingCamera = true;
    p.fire("keydown", { key: "ArrowUp" });
    await vi.waitFor(() => expect(p.log()).toMatch(/\[Forward\]/));
  });

  it("swipes to walk, taps a prop, and double-taps for ESC", async () => {
    const p = await openPage({ touch: true });
    await booted(p);
    // a swipe up the room walks on
    p.point("pointerdown", { pointerType: "touch", clientX: 500, clientY: 600 });
    p.point("pointermove", { pointerType: "touch", clientX: 500, clientY: 400 });
    p.point("pointermove", { pointerType: "touch", clientX: 500, clientY: 200 });
    p.fire("pointerup", { pointerType: "touch", clientX: 500, clientY: 200 });
    // a swipe down backs away as a key
    p.point("pointerdown", { pointerType: "touch", pointerId: 2, clientX: 500, clientY: 200 });
    p.point("pointermove", { pointerType: "touch", pointerId: 2, clientX: 500, clientY: 600 });
    p.fire("pointerup", { pointerType: "touch", pointerId: 2, clientX: 500, clientY: 600 });
    expect(calls.some((c) => /^nav (uparrow|downarrow)|viewer key downarrow/.test(c))).toBe(true);
    // a prop takes the finger at once
    current.host!.hit = { type: "prop" };
    p.point("pointerdown", { pointerType: "touch", pointerId: 3, clientX: 100, clientY: 100 });
    expect(calls).toContain("press 50,50");
    p.fire("pointerup", { pointerType: "touch", pointerId: 3, clientX: 100, clientY: 100 });
    expect(calls).toContain("release 50,50");
    // two taps on the room, quick and close, are the phone's ESC
    current.host!.hit = { type: "scene" };
    for (const id of [4, 5]) {
      p.point("pointerdown", { pointerType: "touch", pointerId: id, clientX: 300, clientY: 300 });
      p.fire("pointerup", { pointerType: "touch", pointerId: id, clientX: 300, clientY: 300 });
    }
    expect(calls).toContain("key . special");
    p.point("pointerdown", { pointerType: "touch", pointerId: 6, clientX: 300, clientY: 300 });
    p.fire("pointercancel", { pointerType: "touch", pointerId: 6 });
  });

  it("double-taps the intro with the intro's own key", async () => {
    const p = await openPage({ touch: true, world: { intro: "owns" } });
    await vi.waitFor(() => expect(current.intro).toBeDefined());
    for (const id of [1, 2]) {
      p.point("pointerdown", { pointerType: "touch", pointerId: id, clientX: 300, clientY: 300 });
      p.fire("pointerup", { pointerType: "touch", pointerId: id, clientX: 300, clientY: 300 });
    }
    expect(calls).toContain("intro key . special");
    current.intro!.skippable = false;
    for (const id of [3, 4]) {
      p.point("pointerdown", { pointerType: "touch", pointerId: id, clientX: 300, clientY: 300 });
      p.fire("pointerup", { pointerType: "touch", pointerId: id, clientX: 300, clientY: 300 });
    }
    current.intro!.finish();
    await booted(p);
  });

  it("runs the frame loop on the director", async () => {
    const p = await openPage();
    p.frame();
    p.frame();
  });

  it("shows the network mark only for a wait long enough to be one", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const p = await openPage();
    const wire = current.files!.wire!;
    wire({ inFlight: 1 });
    wire({ inFlight: 2 });
    vi.advanceTimersByTime(500);
    expect(p.el("netbusy").hidden).toBe(false);
    wire({ inFlight: 0 });
    expect(p.el("netbusy").hidden).toBe(true);
    wire({ inFlight: 1 });
    wire({ inFlight: 0 });
    vi.advanceTimersByTime(500);
    expect(p.el("netbusy").hidden).toBe(true);
  });
});
