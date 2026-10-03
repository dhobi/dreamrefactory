/**
 * The play page (`src/main.ts`), in node: the real `index.html` parsed by
 * linkedom, with the engine's host, the file store, the saved-games dialog and
 * the bug report standing in for the browser's.
 *
 *   npx vitest run --project redjack redjack/tests/page.ts
 *
 * The machine suites drive the GAME; nothing of theirs runs this file. What is
 * pinned here is the page between the player and the game: the loader's order
 * (the BOOTFILE, the plan, the prefetch, the Enter button, then `coldBoot`),
 * what it says when there is no rip or the boot throws, the readout, the save
 * and load hooks, and which key, click and finger reaches which engine call —
 * the space bar held as well as pressed, the right button for the zoom, and a
 * finger at a node looking round. How any of it LOOKS is a browser's question.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";

/* ---------------------------------------------------------------- the fakes */

/** what the page asked the engine (and the dialogs) to do, in order */
const calls: string[] = [];

interface FakeFilesState {
  size: number;
  files: Record<string, number>;
  misses: string[];
  open?: () => Promise<never>;
}
let filesState: FakeFilesState;

class FakeFiles {
  onBusyChange: ((n: number) => void) | null = null;
  loads: string[] = [];
  misses = filesState.misses;
  size = filesState.size;
  private got = new Set<string>();
  static async open(): Promise<FakeFiles> {
    if (filesState.open) return filesState.open();
    return (current.files = new FakeFiles());
  }
  serverUrl(n: string): string | null {
    return n in filesState.files ? `/discs/${n}` : null;
  }
  sizeOf(n: string): number {
    return filesState.files[n] ?? 0;
  }
  bytesLeft(list: string[]): number {
    return list.filter((n) => !this.got.has(n)).reduce((a, n) => a + this.sizeOf(n), 0);
  }
  async load(n: string, onChunk?: (bytes: number) => void): Promise<Uint8Array | null> {
    if (!(n in filesState.files)) return null;
    this.onBusyChange?.(1);
    if (!this.got.has(n)) {
      this.got.add(n);
      this.loads.push(n);
      onChunk?.(filesState.files[n]);
    }
    this.onBusyChange?.(0);
    return new Uint8Array(Math.max(4, Math.min(filesState.files[n], 64)));
  }
}

class FakeHost {
  globals = new Map<string, unknown>();
  hit = { type: "scene", name: "" };
  bootThrows = false;
  plan = nextPlan ?? { resources: ["hub.sett", "rjtheme"], casts: ["nick.cast"], landingSet: "hub.sett" as string | null };
  maze = {
    walk: false,
    heading: 0,
    pitch: 0,
    detail: 16,
    fov: 1 << 22,
    setHeading(v: number) {
      this.heading = v;
    },
    setPitch(v: number) {
      this.pitch = v;
    },
    onChange() {},
  };
  session = {
    nextFrame: null as unknown,
    hasRealFrames: false,
    currentSetName: "hub",
    currentSetFile: "hub.sett",
    currentSceneName: () => "scene12",
    currentViewName: () => "node",
    stageName: "none",
    currentFlat: "",
    cursorHidden: false,
    cursorName: "hand",
    puppet: null as { visible: boolean } | null,
    maze: this.maze as unknown,
    pointerDown: false,
    pointerButton: 0,
    spaceDown: false,
    onSaveGame: null as ((b: Uint8Array) => Promise<void>) | null,
    onLoadGame: null as (() => Promise<unknown>) | null,
    propRuntime: { shops: new Map() },
    actorRuntime: { actors: new Map([["nick", 1]]) },
    interp: {
      globals: this.globals,
      runHandler: async (_i: unknown, h: string) => ({ value: `ran ${h}` }),
    },
    instanceFrom: (_c: unknown, name: string) => ({ name }),
    hitTestAt: () => this.hit,
    setPointer: () => {},
    track: (p: Promise<unknown>) => p,
  };
  director = {
    tick: () => {},
    render: () => {},
    keyDown: async (k: string, special: boolean) => void calls.push(`key ${k}${special ? " special" : ""}`),
    keyUp: async (k: string) => void calls.push(`keyup ${k}`),
    press: async (x: number, y: number) => void calls.push(`press ${x},${y} button ${this.session.pointerButton}`),
    release: (x: number, y: number) => void calls.push(`release ${x},${y}`),
    hover: async (x: number, y: number) => void calls.push(`hover ${x},${y}`),
    screenOwner: () => "world",
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

/** the boot plan the next page's host answers */
let nextPlan: { resources: string[]; casts: string[]; landingSet: string | null } | null = null;
let bugOpts: Record<string, (...a: never[]) => unknown> | null = null;
let dialogUp = false;
const current: { host?: FakeHost; files?: FakeFiles } = {};

vi.mock("@dreamfactory/engine/web/host", () => ({ GameHost: FakeHost }));
vi.mock("../src/files", () => ({ RedJackFiles: FakeFiles }));
vi.mock("../src/saves", () => ({ REDJACK_SAVES: { name: "redjack" }, seedRedJackSaves: async () => 7 }));
vi.mock("@dreamfactory/engine/web/save-store", () => ({ useSaveKind: () => void calls.push("useSaveKind") }));
vi.mock("@dreamfactory/engine/web/save-browser", () => ({
  browseForSave: async (_b: Uint8Array, name: string) => void calls.push(`save as ${name}`),
  browseForLoad: async () => (calls.push("load"), null),
  savesOpen: () => dialogUp,
}));
vi.mock("@dreamfactory/site/bug-report", () => ({
  installBugReport: (_btn: unknown, opts: typeof bugOpts) => void (bugOpts = opts),
}));

/* ----------------------------------------------------------------- the page */

const HTML = readFileSync(join(import.meta.dirname, "../index.html"), "utf8");
const DISCS: Record<string, number> = { bootfile: 300_000, "hub.sett": 9 * 1024 * 1024 };

interface Page {
  document: Document;
  el: (id: string) => HTMLElement;
  fire: (type: string, props?: Record<string, unknown>) => Event;
  point: (type: string, props: Record<string, unknown>) => Event;
  click: (id: string) => void;
  frame: () => void;
  log: () => string;
}

async function openPage(opts: { touch?: boolean; files?: Partial<FakeFilesState> } = {}): Promise<Page> {
  vi.resetModules();
  calls.length = 0;
  bugOpts = null;
  dialogUp = false;
  current.host = undefined;
  current.files = undefined;
  filesState = { size: 600, files: { ...DISCS }, misses: [], ...opts.files };

  const dom = parseHTML(HTML);
  const { document } = dom;
  const ctx2d = new Proxy(
    { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) } as Record<string, unknown>,
    { get: (t, k) => (k in t ? t[k as string] : () => undefined), set: () => true },
  );
  const proto = Object.getPrototypeOf(document.createElement("canvas"));
  proto.getContext = () => ctx2d;
  proto.toDataURL = () => "data:image/png;base64,AAAA";
  proto.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 960, right: 1280, bottom: 960 });

  const win = new EventTarget();
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("addEventListener", win.addEventListener.bind(win));
  vi.stubGlobal("MutationObserver", dom.MutationObserver ?? class { observe() {} });
  vi.stubGlobal("navigator", { maxTouchPoints: opts.touch ? 5 : 0 });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {} });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));

  const fire = (type: string, props: Record<string, unknown> = {}): Event => {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, { metaKey: false, ctrlKey: false, altKey: false, clientX: 0, clientY: 0, pointerId: 1, pointerType: "mouse", ...props });
    win.dispatchEvent(e);
    return e;
  };
  const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
  const point = (type: string, props: Record<string, unknown>): Event => {
    const e = new dom.Event(type, { cancelable: true });
    Object.assign(e, { pointerId: 1, pointerType: "mouse", button: 0, ...props });
    el("screen").dispatchEvent(e);
    return e as unknown as Event;
  };
  await import("../src/main");
  return {
    document: document as unknown as Document,
    el,
    fire,
    point,
    click: (id) => void el(id).dispatchEvent(new dom.Event("click")),
    frame: () => frames.splice(0).forEach((cb) => cb(0)),
    log: () => el("log").textContent ?? "",
  };
}

async function enter(p: Page): Promise<void> {
  await vi.waitFor(() => expect(p.document.body.querySelector("#boot.ready")).toBeTruthy());
  p.click("start");
  await vi.waitFor(() => expect(p.log()).toMatch(/every name the boot asked for|asked for \d+ name/));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ---------------------------------------------------------------- the tests */

describe("the loader", () => {
  it("reads the BOOTFILE and the plan, prefetches the first room, and waits for Enter", async () => {
    const p = await openPage();
    await vi.waitFor(() => expect(p.document.body.querySelector("#boot.ready")).toBeTruthy());
    const log = p.log();
    expect(log).toContain("indexed 600 names across the rip");
    expect(log).toMatch(/BOOTFILE: DreamFactory /);
    expect(log).toContain("boot plan: 1 resource(s) (hub.sett) + 1 name(s) not on the discs: rjtheme, 1 cast(s), first room hub.sett");
    // the first room is in the plan already, so it is fetched once
    expect(log).toContain("prefetching 1 file(s), 9.0 MB");
    expect(log).toMatch(/hub\.sett: DreamFactory/);
    expect(log).toContain("listed 7 of the port's day saves");
    expect(p.el("bootpct").textContent).toBe("100%");
    expect(p.el("bar").getAttribute("aria-valuenow")).toBe("100");
    expect(calls).toContain("useSaveKind");
    expect(calls).not.toContain("coldBoot");
  });

  it("boots on Enter and says what the boot touched", async () => {
    const p = await openPage({ files: { misses: ["gone.move", "hub.sett"] } });
    await enter(p);
    expect(calls).toContain("coldBoot");
    expect(p.document.body.classList.contains("playing")).toBe(true);
    expect(p.log()).toContain('set hub · stage none · flat  · 0 shop(s) · 1 actor(s) · screen owned by "world"');
    expect(p.log()).toContain("asked for 1 name(s) the rip does not have: gone.move");
  });

  it("names a first room that is not in the plan, and a plan with nothing", async () => {
    nextPlan = { resources: [], casts: [], landingSet: null };
    const p = await openPage();
    nextPlan = null;
    await vi.waitFor(() => expect(p.log()).toContain("boot plan: 0 resource(s) (none), 0 cast(s), first room (none named)"));
  });

  it("says when the manifest indexed nothing", async () => {
    const p = await openPage({ files: { size: 0 } });
    await vi.waitFor(() => expect(p.el("bootsay").textContent).toBe("no disc"));
    expect(p.log()).toContain("the manifest indexed nothing");
    expect(p.el("err").textContent).toBe("no game data — press b for the log");
  });

  it("says when there is no BOOTFILE", async () => {
    const p = await openPage({ files: { files: { "hub.sett": 10 } } });
    await vi.waitFor(() => expect(p.log()).toContain("no BOOTFILE"));
    expect(p.el("log").hidden).toBe(false);
  });

  it("puts a boot that throws in the controls and the log", async () => {
    const p = await openPage();
    current.host!.bootThrows = true;
    await vi.waitFor(() => expect(p.document.body.querySelector("#boot.ready")).toBeTruthy());
    p.click("start");
    await vi.waitFor(() => expect(p.el("err").textContent).toBe("boot failed: the boot fell over — press b for the log"));
    expect(p.el("log").hidden).toBe(false);
  });

  it("opens the log and the picture when the page itself fails", async () => {
    const p = await openPage({ files: { open: () => Promise.reject(new Error("no manifest")) } });
    await vi.waitFor(() => expect(p.el("err").textContent).toBe("no manifest — press b for the log"));
    expect(p.document.body.classList.contains("playing")).toBe(true);
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

describe("the game, once it runs", () => {
  it("draws the readout and the cursor the game asks for, each frame", async () => {
    const p = await openPage();
    await enter(p);
    p.frame();
    expect(p.el("loc").textContent).toBe("set hub · scene scene12 · view node");
    expect(bugOpts!.where()).toBe("set hub · scene scene12 · view node");
    expect(p.el("screen").style.cursor).toContain("url(");
    // hidden is `none`; a conversation keeps the arrow whatever its scripts set
    current.host!.session.cursorHidden = true;
    p.frame();
    expect(p.el("screen").style.cursor).toBe("none");
    current.host!.session.cursorHidden = false;
    current.host!.session.puppet = { visible: true };
    p.frame();
    expect(p.el("screen").style.cursor).toContain("url(");
    p.el("screen").style.cursor = "";
    p.fire("resize");
    expect(p.el("screen").style.cursor).toContain("url(");
  });

  it("hands the bug report the page's edition, log tail and note", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const p = await openPage();
    await vi.waitFor(() => expect(bugOpts).not.toBeNull());
    expect(bugOpts!.edition()).toContain("RJDisk1-3");
    expect((bugOpts!.log as (n: number) => string[])(1)).toHaveLength(1);
    (bugOpts!.note as (how: string) => void)("clipboard");
    expect(p.el("bugNote").textContent).toContain("paste it into the issue");
    (bugOpts!.note as (how: string) => void)("download");
    expect(p.el("bugNote").textContent).toContain("attach redjack-bug.png");
    vi.runOnlyPendingTimers();
    expect(p.el("bugNote").textContent).toBe("");
  });

  it("answers the game's save and load through the dialog, named by the room", async () => {
    const p = await openPage();
    await enter(p);
    await current.host!.session.onSaveGame!(new Uint8Array(4));
    expect(calls.find((c) => c.startsWith("save as"))).toMatch(/^save as hub\.sett - \d{4}-\d\d-\d\d \d\d-\d\d$/);
    await current.host!.session.onLoadGame!();
    expect(calls).toContain("load");
  });

  it("sends keys by v5's names, lets the arrows come up, and holds the space bar", async () => {
    const p = await openPage();
    await enter(p);
    p.fire("keydown", { key: "ArrowLeft" });
    p.fire("keyup", { key: "ArrowLeft" });
    p.fire("keydown", { key: "Escape" });
    expect(calls).toContain("key left");
    expect(calls).toContain("keyup left");
    expect(calls.some((c) => /^key \S+ special$/.test(c))).toBe(true);
    p.fire("keydown", { key: " " });
    expect(current.host!.session.spaceDown).toBe(true);
    p.fire("keyup", { key: " " });
    expect(current.host!.session.spaceDown).toBe(false);
    p.fire("keydown", { key: " " });
    p.fire("blur");
    expect(current.host!.session.spaceDown).toBe(false);
    expect(current.host!.globals.get("isrepeat")).toBe(0);
  });

  it("keeps b for the log, and every key for an open saves dialog", async () => {
    const p = await openPage();
    await enter(p);
    p.fire("keydown", { key: "b" });
    expect(p.el("log").hidden).toBe(false);
    p.click("logBtn");
    expect(p.el("log").hidden).toBe(true);
    dialogUp = true;
    p.fire("keydown", { key: "ArrowUp" });
    p.fire("keydown", { key: "r", ctrlKey: true });
    expect(calls.filter((c) => c.startsWith("key "))).toEqual([]);
  });

  it("presses and holds SPACE for a phone, from its button", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const p = await openPage();
    await vi.waitFor(() => expect(p.document.body.querySelector("#boot.ready")).toBeTruthy());
    p.click("spacekey");
    expect(current.host!.session.spaceDown).toBe(true);
    expect(calls).toContain("key  ");
    vi.advanceTimersByTime(300);
    expect(current.host!.session.spaceDown).toBe(false);
  });

  it("clicks on the game's 640x480, by the button pressed, and keeps the menu off", async () => {
    const p = await openPage();
    await enter(p);
    p.point("pointerdown", { clientX: 640, clientY: 480 });
    await vi.waitFor(() => expect(p.log()).toContain("click 320,240"));
    expect(calls).toContain("press 320,240 button 1");
    p.fire("pointerup", { clientX: 640, clientY: 480 });
    expect(calls).toContain("release 320,240");
    p.fire("pointerup", { clientX: 640, clientY: 480 });
    expect(calls.filter((c) => c.startsWith("release"))).toHaveLength(1);
    p.point("pointerdown", { clientX: 100, clientY: 100, button: 2 });
    expect(calls).toContain("press 50,50 button 2");
    expect(p.point("contextmenu", {}).defaultPrevented).toBe(true);
    p.fire("pointermove", { clientX: 20, clientY: 20 });
    expect(calls).toContain("hover 10,10");
  });

  it("gives the console an eval", async () => {
    await openPage();
    await vi.waitFor(() => expect((globalThis as { rj?: unknown }).rj).toBeTruthy());
    const rj = (globalThis as unknown as { rj: { eval: (s: string) => Promise<unknown> } }).rj;
    expect(await rj.eval("return (currentset ())")).toBe("ran consoleeval");
  });
});

describe("a finger", () => {
  it("does not walk on a tap on the bare room", async () => {
    const p = await openPage({ touch: true });
    await enter(p);
    p.point("pointerdown", { pointerType: "touch", clientX: 640, clientY: 480 });
    p.fire("pointerup", { pointerType: "touch", clientX: 640, clientY: 480 });
    await new Promise((r) => setTimeout(r, 300));
    expect(calls.some((c) => c.startsWith("press"))).toBe(false);
  });

  it("taps a prop, as a click", async () => {
    const p = await openPage({ touch: true });
    await enter(p);
    current.host!.hit = { type: "prop", name: "chest" };
    p.point("pointerdown", { pointerType: "touch", clientX: 640, clientY: 480 });
    expect(calls).toContain("press 320,240 button 1");
    p.fire("pointerup", { pointerType: "touch", clientX: 640, clientY: 480 });
    expect(calls).toContain("release 320,240");
  });

  it("looks round at a node by a slow drag", async () => {
    const p = await openPage({ touch: true });
    await enter(p);
    p.point("pointerdown", { pointerType: "touch", clientX: 600, clientY: 480 });
    p.fire("pointermove", { pointerType: "touch", clientX: 800, clientY: 480 });
    expect(current.host!.maze.heading).not.toBe(0);
    await new Promise((r) => setTimeout(r, 300));
    p.fire("pointerup", { pointerType: "touch", clientX: 800, clientY: 480 });
    expect(current.host!.maze.heading).not.toBe(0);
  });

  it("zooms with two, and lets a cancelled finger go", async () => {
    const p = await openPage({ touch: true });
    await enter(p);
    p.point("pointerdown", { pointerType: "touch", pointerId: 1, clientX: 400, clientY: 400 });
    p.point("pointerdown", { pointerType: "touch", pointerId: 2, clientX: 800, clientY: 400 });
    expect(calls).toContain("press 300,200 button 2");
    p.fire("pointercancel", { pointerType: "touch", pointerId: 1 });
    p.fire("pointercancel", { pointerType: "touch", pointerId: 2 });
    expect(calls).toContain("release 300,200");
    // a finger off a node goes to the gestures, and a cancel there lets it go
    current.host!.session.maze = null;
    p.point("pointerdown", { pointerType: "touch", pointerId: 3, clientX: 400, clientY: 400 });
    p.fire("pointermove", { pointerType: "touch", pointerId: 3, clientX: 400, clientY: 100 });
    p.fire("pointercancel", { pointerType: "touch", pointerId: 3 });
  });

  it("walks by a flick off a node", async () => {
    const p = await openPage({ touch: true });
    await enter(p);
    current.host!.session.maze = null;
    p.point("pointerdown", { pointerType: "touch", clientX: 640, clientY: 700 });
    p.fire("pointermove", { pointerType: "touch", clientX: 640, clientY: 400 });
    p.fire("pointermove", { pointerType: "touch", clientX: 640, clientY: 200 });
    p.fire("pointerup", { pointerType: "touch", clientX: 640, clientY: 200 });
    expect(calls.some((c) => /^key (up|down)$/.test(c))).toBe(true);
  });
});
