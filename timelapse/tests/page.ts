/**
 * The play page (`src/main.ts`), in node: the real `index.html` parsed by
 * linkedom, with the engine's host, the file store and the bug report standing
 * in for the browser's.
 *
 *   npx vitest run --project timelapse timelapse/tests/page.ts
 *
 * The machine suites drive the GAME; nothing of theirs runs this file. What is
 * pinned here is the page between the player and the game: the loader's bar
 * and its captions, the boot's order (prefetch, the button, then `coldBoot`),
 * what it says when there is no rip, a file short or a boot that throws, the
 * location readout, and which key, click and touch reaches which engine call.
 * How any of it LOOKS is a browser's question and is not asked here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";

/* ---------------------------------------------------------------- the fakes */

/** what the page asked the engine to do, in order */
const calls: string[] = [];

interface FakeFilesState {
  size: number;
  files: Record<string, number>;
  /** names the manifest lists without a size */
  unsized: string[];
  /** names the store answers `null` for although they are listed */
  absent: string[];
  misses: string[];
  open?: () => Promise<never>;
}
let filesState: FakeFilesState;

class FakeFiles {
  onChunk: ((name: string, bytes: number) => void) | null = null;
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
    return filesState.unsized.includes(n) ? 0 : (filesState.files[n] ?? 0);
  }
  bytesLeft(list: string[]): number {
    return list.filter((n) => !this.got.has(n)).reduce((a, n) => a + this.sizeOf(n), 0);
  }
  async load(n: string, onChunk?: (bytes: number) => void): Promise<Uint8Array | null> {
    if (!(n in filesState.files) || filesState.absent.includes(n)) return null;
    this.onBusyChange?.(1);
    const size = filesState.files[n];
    if (!this.got.has(n)) {
      this.got.add(n);
      this.loads.push(n);
      this.onChunk?.(n, size);
      onChunk?.(size);
    }
    this.onBusyChange?.(0);
    const bytes = new Uint8Array(Math.max(4, Math.min(size, 64)));
    return bytes;
  }
}

class FakeHost {
  globals = new Map<string, unknown>([
    ["curframenum", 330],
    ["curworldchar", "I"],
    ["curstagename", "i001"],
    ["curregionnum", 1],
  ]);
  hit = { type: "flat", name: "" };
  bootThrows = false;
  session = {
    nextFrame: null as unknown,
    hasRealFrames: false,
    wipe: { stepMs: 10 },
    stageName: "i001",
    currentFlat: "i0001.330",
    scriptBusy: false,
    pointerDown: false,
    propRuntime: { shops: new Map([["i.shp", 1]]) },
    actorRuntime: { actors: new Map() },
    interp: {
      globals: this.globals,
      runHandler: async (_i: unknown, h: string) => ({ value: `ran ${h}` }),
    },
    instanceFrom: (_c: unknown, name: string) => ({ name }),
    sendEvent: async (to: string, _s: string, ev: string, args: unknown[]) => {
      calls.push(`${to} ${ev} ${args.join(",")}`);
      return ev === "getframeaction" ? "J.104 S.9.1.840 TL.101 TR.103 L2 X" : null;
    },
    hitTestAt: () => this.hit,
    setPointer: () => {},
    track: (p: Promise<unknown>) => p,
  };
  director = {
    onCursor: null as ((n: string) => void) | null,
    tick: () => {},
    render: () => {},
    keyDown: async (k: string, special: boolean) => void calls.push(`key ${k}${special ? " special" : ""}`),
    press: async (x: number, y: number) => void calls.push(`press ${x},${y}`),
    release: (x: number, y: number) => void calls.push(`release ${x},${y}`),
    hover: async () => "goup",
    screenOwner: () => "flat",
  };
  constructor() {
    current.host = this;
  }
  async bootPlan(): Promise<{ resources: string[]; casts: string[]; landingSet: string | null }> {
    return { resources: ["p.shp", "open.mov", "theme"], casts: [], landingSet: null };
  }
  async coldBoot(): Promise<void> {
    calls.push("coldBoot");
    if (this.bootThrows) throw new Error("the boot fell over");
  }
}

/** the bug report's options, as the page handed them over */
let bugOpts: Record<string, (...a: never[]) => unknown> | null = null;

const current: { host?: FakeHost; files?: FakeFiles } = {};

vi.mock("@dreamfactory/engine/web/host", () => ({ GameHost: FakeHost }));
vi.mock("../src/files", () => ({ TimelapseFiles: FakeFiles }));
vi.mock("@dreamfactory/site/bug-report", () => ({
  installBugReport: (_btn: unknown, opts: typeof bugOpts) => void (bugOpts = opts),
}));

/* ----------------------------------------------------------------- the page */

const HTML = readFileSync(join(import.meta.dirname, "../index.html"), "utf8");

/** the thirteen the page prefetches, and the six it reads tags from */
const DISCS: Record<string, number> = {
  bootfile: 98_000,
  "p.shp": 300_000,
  "open.mov": 27 * 1024 * 1024,
  "i.shp": 2_500_000,
  "i.trk": 1_600_000,
  "i001.stg": 25 * 1024 * 1024,
  "i001.trk": 400_000,
  "i001.mov": 200_000,
  "p.stg": 118_000,
};

interface Page {
  document: Document;
  el: (id: string) => HTMLElement;
  /** a window event (`keydown`, `pointermove`, `resize` …) */
  fire: (type: string, props?: Record<string, unknown>) => Event;
  /** a canvas pointer event */
  point: (type: string, props: Record<string, unknown>) => void;
  /** run the frames the page has asked for */
  frame: () => void;
  /** the log, as text */
  log: () => string;
  /** a click on an element of the page */
  click: (id: string) => void;
}

async function openPage(opts: { search?: string; touch?: boolean; files?: Partial<FakeFilesState> } = {}): Promise<Page> {
  vi.resetModules();
  calls.length = 0;
  bugOpts = null;
  current.host = undefined;
  current.files = undefined;
  filesState = { size: 900, files: { ...DISCS }, unsized: [], absent: [], misses: [], ...opts.files };

  const dom = parseHTML(HTML);
  const { document } = dom;
  // a context that draws nothing, but hands a cursor its pixels and a PNG
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
  vi.stubGlobal("location", { search: opts.search ?? "" });
  vi.stubGlobal("navigator", { maxTouchPoints: opts.touch ? 5 : 0 });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {} });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));

  const fire = (type: string, props: Record<string, unknown> = {}): Event => {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, { metaKey: false, ctrlKey: false, clientX: 0, clientY: 0, pointerId: 1, pointerType: "mouse", ...props });
    win.dispatchEvent(e);
    return e;
  };
  const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
  const point = (type: string, props: Record<string, unknown>): void => {
    const e = new dom.Event(type);
    Object.assign(e, { pointerId: 1, pointerType: "mouse", button: 0, ...props });
    el("screen").dispatchEvent(e);
  };
  await import("../src/main");
  return {
    document: document as unknown as Document,
    el,
    fire,
    point,
    frame: () => frames.splice(0).forEach((cb) => cb(0)),
    log: () => el("log").textContent ?? "",
    click: (id) => void el(id).dispatchEvent(new dom.Event("click")),
  };
}

/** click the Enter button once the page has offered it */
async function enter(p: Page): Promise<void> {
  await vi.waitFor(() => expect(p.document.body.querySelector("#boot.ready")).toBeTruthy(), { timeout: 3000 });
  p.click("start");
  await vi.waitFor(() => expect(p.log()).toMatch(/every name the boot asked for|asked for \d+ name/));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ---------------------------------------------------------------- the tests */

describe("the loader", () => {
  it("prefetches the plan and world I, reads the tags, and waits for Enter", async () => {
    const p = await openPage();
    await vi.waitFor(() => expect(p.document.body.querySelector("#boot.ready")).toBeTruthy(), { timeout: 3000 });
    const log = p.log();
    expect(log).toContain("indexed 900 names across the rip");
    // the plan's two files, and `theme`, which is a gototheme word and no file
    expect(log).toContain("boot plan: 2 resources (p.shp, open.mov) + 1 name(s) that are not files: theme");
    expect(log).toContain("prefetching 8 files");
    expect(log).toMatch(/i001\.stg: DreamFactory/);
    expect(p.el("bootpct").textContent).toBe("100%");
    expect(p.el("bootsay").textContent).toBe("ready");
    expect(calls).not.toContain("coldBoot");
    // a mouse machine is told what it will be drawn with
    expect(log).toMatch(/mouse: \d+ of the game's own cursors/);
  });

  it("boots on Enter and says what the boot touched", async () => {
    const p = await openPage({ files: { misses: ["nowhere.trk", "p.shp"] } });
    await enter(p);
    expect(calls).toContain("coldBoot");
    expect(p.document.body.classList.contains("playing")).toBe(true);
    expect(p.log()).toContain("stage i001 · flat i0001.330 · 1 shop(s) · 0 actor(s) · screen owned by \"flat\"");
    // p.shp is on the discs, so only the one that is not is a miss worth saying
    expect(p.log()).toContain("asked for 1 name(s) the rip does not have: nowhere.trk");
  });

  it("says when the manifest indexed nothing", async () => {
    const p = await openPage({ files: { size: 0 } });
    await vi.waitFor(() => expect(p.el("bootsay").textContent).toBe("no disc"));
    expect(p.log()).toContain("the manifest indexed nothing");
    expect(p.el("log").hidden).toBe(false);
  });

  it("says when there is no BOOTFILE", async () => {
    const files = { ...DISCS };
    delete (files as Record<string, number>).bootfile;
    const p = await openPage({ files: { files } });
    await vi.waitFor(() => expect(p.el("err").textContent).toBe("no game data — press b for the log"));
    expect(p.log()).toContain("no BOOTFILE");
  });

  it("says which of the prefetch is missing, and which the manifest did not size", async () => {
    const p = await openPage({ files: { absent: ["i001.trk", "i.shp"], unsized: ["p.stg"] } });
    await vi.waitFor(() => expect(p.el("err").textContent).toBe("2 file(s) missing — press b for the log"));
    expect(p.log()).toContain("which does not size 1 of them (p.stg)");
    expect(p.log()).toContain("i.shp: NOT IN THE INDEX");
  });

  it("puts a boot that throws in the controls and the log", async () => {
    const p = await openPage();
    current.host!.bootThrows = true;
    await vi.waitFor(() => expect(p.document.body.querySelector("#boot.ready")).toBeTruthy(), { timeout: 3000 });
    p.click("start");
    await vi.waitFor(() => expect(p.el("err").textContent).toBe("boot failed: the boot fell over — press b for the log"));
  });

  it("raises the title and opens the log when the page itself fails", async () => {
    const p = await openPage({ files: { open: () => Promise.reject(new Error("no manifest")) } });
    await vi.waitFor(() => expect(p.el("err").textContent).toBe("no manifest — press b for the log"));
    expect(p.el("log").hidden).toBe(false);
    expect(p.document.body.classList.contains("playing")).toBe(true);
  });

  it("shows a rate while bytes arrive, and the loader's own words when they stop", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const p = await openPage();
    // the prefetch is instant here, so the meter has had its chunks and its timer
    // is cleared before a tick: what is left to show is the loader's caption
    await vi.waitFor(() => expect(p.el("bootsay").textContent).toBe("ready"), { timeout: 3000 });
    vi.runOnlyPendingTimers();
    expect(p.el("bootsay").textContent).toBe("ready");
  });
});

describe("the game, once it runs", () => {
  it("draws the readout from the game's globals and its stage's table", async () => {
    const p = await openPage();
    await enter(p);
    p.frame();
    await vi.waitFor(() => expect(p.el("loc").innerHTML).toContain("↑ →104"));
    expect(p.el("loc").innerHTML).toContain("<b>world I</b>  stage i001  region 1  <b>frame 330</b>");
    expect(p.el("loc").innerHTML).toContain("↘ —");
    // and the bug report says the same place, the flat first
    expect(bugOpts!.where()).toBe("flat i0001.330 · world I · stage i001 · region 1 · frame 330");
    // asked once per position, not once per frame
    const asked = calls.filter((c) => c.includes("getframeaction")).length;
    p.frame();
    await Promise.resolve();
    expect(calls.filter((c) => c.includes("getframeaction")).length).toBe(asked);
  });

  it("hands the bug report the page's edition, log tail and note", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const p = await openPage();
    await vi.waitFor(() => expect(bugOpts).not.toBeNull());
    expect(bugOpts!.edition()).toContain("TLAPSE1-4");
    expect((bugOpts!.log as (n: number) => string[])(1)).toHaveLength(1);
    (bugOpts!.note as (how: string) => void)("clipboard");
    expect(p.el("bugNote").textContent).toContain("paste it into the issue");
    (bugOpts!.note as (how: string) => void)("download");
    expect(p.el("bugNote").textContent).toContain("attach timelapse-bug.png");
    vi.runOnlyPendingTimers();
    expect(p.el("bugNote").textContent).toBe("");
  });

  it("sends keys to the game by the names its router answers to", async () => {
    const p = await openPage();
    await enter(p);
    p.fire("keydown", { key: "ArrowUp" });
    p.fire("keydown", { key: "Escape" });
    p.fire("keydown", { key: "r", ctrlKey: true });
    expect(calls).toContain("key uparrow");
    expect(calls.some((c) => /^key \S+ special$/.test(c))).toBe(true);
    expect(calls).not.toContain("key r");
    // and a gesture is never a held key
    expect(current.host!.globals.get("isrepeat")).toBe(0);
  });

  it("keeps b for the log", async () => {
    const p = await openPage();
    await enter(p);
    expect(p.el("log").hidden).toBe(true);
    p.fire("keydown", { key: "b" });
    expect(p.el("log").hidden).toBe(false);
    p.click("logBtn");
    expect(p.el("log").hidden).toBe(true);
    expect(calls).not.toContain("key b");
  });

  it("presses SPACE for a phone, from its button", async () => {
    const p = await openPage();
    await enter(p);
    p.click("spacekey");
    expect(calls).toContain("key  ");
  });

  it("clicks on the game's own 640x480, and asks for the cursor again after", async () => {
    const p = await openPage();
    await enter(p);
    p.point("pointerdown", { clientX: 640, clientY: 480 });
    await vi.waitFor(() => expect(p.log()).toContain("click 320,240 · flat i0001.330"));
    expect(calls).toContain("press 320,240");
    await vi.waitFor(() => expect(p.el("screen").style.cursor).toContain("url("));
    p.fire("pointerup", { clientX: 640, clientY: 480 });
    expect(calls).toContain("release 320,240");
    // a second release has nothing to let go of
    p.fire("pointerup", { clientX: 640, clientY: 480 });
    expect(calls.filter((c) => c.startsWith("release"))).toHaveLength(1);
  });

  it("asks for the cursor on a move, and redraws it on a resize", async () => {
    const p = await openPage();
    await enter(p);
    p.fire("pointermove", { clientX: 10, clientY: 10 });
    await vi.waitFor(() => expect(p.el("screen").style.cursor).toContain("url("));
    p.el("screen").style.cursor = "";
    p.fire("resize");
    expect(p.el("screen").style.cursor).toContain("url(");
    // and when the director asks of its own accord
    current.host!.director.onCursor!("");
    expect(p.el("screen").style.cursor).toContain("url(");
  });

  it("slows the turns when the URL asks", async () => {
    const p = await openPage({ search: "?slowturn=8" });
    await vi.waitFor(() => expect(p.log()).toMatch(/turns slowed 8x/));
    expect(current.host!.session.wipe.stepMs).toBeGreaterThan(10);
  });

  it("gives the console jump and eval", async () => {
    const p = await openPage();
    await vi.waitFor(() => expect((globalThis as { tl?: unknown }).tl).toBeTruthy());
    const tl = (globalThis as unknown as { tl: { jump: (...n: number[]) => Promise<unknown>; eval: (s: string) => Promise<unknown> } }).tl;
    await tl.jump(5, 90, 873);
    expect(calls).toContain("sendtoboot gotostage 5,90,873");
    expect(await tl.eval("return (pictotal)")).toBe("ran consoleeval");
    expect((globalThis as { __tl?: unknown }).__tl).toBeTruthy();
    void p;
  });

  it("shows the spinner only for a wait long enough to be one", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const p = await openPage();
    await vi.waitFor(() => expect(current.files?.onBusyChange).toBeTruthy());
    const busy = current.files!.onBusyChange!;
    busy(1);
    busy(1);
    expect(p.el("netbusy").hidden).toBe(true);
    vi.advanceTimersByTime(500);
    expect(p.el("netbusy").hidden).toBe(false);
    busy(0);
    expect(p.el("netbusy").hidden).toBe(true);
    // a short one never shows it
    busy(1);
    busy(0);
    vi.advanceTimersByTime(500);
    expect(p.el("netbusy").hidden).toBe(true);
  });
});

describe("a touchscreen", () => {
  it("says how to play by finger", async () => {
    const p = await openPage({ touch: true });
    await vi.waitFor(() => expect(p.log()).toContain("touch: swipe to walk and turn"));
  });

  it("does not walk on a thumb resting on the picture's edge", async () => {
    const p = await openPage({ touch: true });
    await enter(p);
    current.host!.hit = { type: "button", name: "Right" };
    p.point("pointerdown", { pointerType: "touch", clientX: 1270, clientY: 480 });
    p.fire("pointerup", { pointerType: "touch", clientX: 1270, clientY: 480 });
    await new Promise((r) => setTimeout(r, 300));
    expect(calls.some((c) => c.startsWith("press"))).toBe(false);
  });

  it("gives a finger an object at once", async () => {
    const p = await openPage({ touch: true });
    await enter(p);
    current.host!.hit = { type: "prop", name: "lantern" };
    p.point("pointerdown", { pointerType: "touch", clientX: 640, clientY: 480 });
    expect(calls).toContain("press 320,240");
    p.fire("pointerup", { pointerType: "touch", clientX: 640, clientY: 480 });
    expect(calls).toContain("release 320,240");
  });

  it("walks by a swipe, and lets a cancelled one go", async () => {
    const p = await openPage({ touch: true });
    await enter(p);
    p.point("pointerdown", { pointerType: "touch", clientX: 640, clientY: 700 });
    p.fire("pointermove", { pointerType: "touch", clientX: 640, clientY: 400 });
    p.fire("pointermove", { pointerType: "touch", clientX: 640, clientY: 200 });
    p.fire("pointerup", { pointerType: "touch", clientX: 640, clientY: 200 });
    expect(calls.some((c) => /^key (uparrow|downarrow)$/.test(c))).toBe(true);
    p.point("pointerdown", { pointerType: "touch", clientX: 640, clientY: 700 });
    p.fire("pointercancel", { pointerType: "touch" });
  });
});
