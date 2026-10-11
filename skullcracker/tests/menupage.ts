/**
 * The front-end page (`src/main.ts`, `index.html`), in node: the real
 * `index.html` parsed by linkedom, a recording 2D context and audio sink
 * standing in for the browser's, the animation frames driven by hand, and
 * `fetch` answered off the disc on this machine.
 *
 *   npx vitest run --project skullcracker skullcracker/tests/menupage.ts
 *
 * The film player itself is `tests/film.ts`'s; no playthrough loads this page.
 * What is pinned here is the page around the film: the boot (the manifest, the
 * one film fetched before the Start button, what it says with no disc), the
 * start sequence the executable's string table names, what each of the menu's
 * exit frames LEADS to (the chooser and the hand-over to the level runner, the
 * `.SKL` picker, the preferences panel and its controls, Help, Quit,
 * Credits, the demo), the high-score board and the dossier drawn over the films,
 * and which key, click and finger reaches which of those. How any of it LOOKS
 * is the browser suite's (`tests/browser/menu.ts`).
 *
 * The page runs at top level, so every scenario loads it afresh. The films need
 * the rip and are skipped without it; the boot's failures run on a manifest
 * that names nothing.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { LEVEL_ORDER } from "@dreamfactory/engine/df/sbk";
import { writeSkl } from "../src/savegame";

const ROOT = join(import.meta.dirname, "..");
const MOVIES = "gamefiles/SKULL/MOVIES";
const have = existsSync(join(ROOT, MOVIES, "MENU.MOV")) && existsSync(join(ROOT, MOVIES, "CYBER.MOV"));

/** every film on the disc, as the manifest the dev server publishes would list it */
const DISC: Record<string, number> = have
  ? Object.fromEntries(readdirSync(join(ROOT, MOVIES)).map((n) => [`${MOVIES}/${n}`, 1]))
  : {};
/** the disc's bytes, read once for every scenario */
const bytesOf = new Map<string, Uint8Array>();

/* ---------------------------------------------------------------- the fakes */

/** what the page asked of the world outside it, in order */
const calls: string[] = [];
/** every string the page wrote on the canvas */
const drawn: string[] = [];

interface Sound {
  channel: string;
  done: boolean;
  stopped: boolean;
  stop(): void;
}
/** every sound started on the real sink, with its handle */
const sounds: Sound[] = [];

/** the sink the Start press builds; its sounds finish when a test says so */
class RecordingSink {
  constructor() {
    calls.push("WebAudioSink");
  }
  play(channel: string): Sound {
    const h: Sound = {
      channel,
      done: false,
      stopped: false,
      stop() {
        this.stopped = this.done = true;
      },
    };
    sounds.push(h);
    return h;
  }
  halt(): void {}
  isDone(): boolean {
    return true;
  }
  setChannelVolume(): void {}
  setSuspended(): void {}
  setMuted(): void {}
}

let bugOpts: Record<string, (...a: never[]) => unknown> | null = null;

vi.mock("@dreamfactory/engine/runtime/audio", async (real) => ({
  ...(await real<typeof import("@dreamfactory/engine/runtime/audio")>()),
  WebAudioSink: RecordingSink,
}));
vi.mock("@dreamfactory/engine/web/fullscreen", () => ({ installFullscreen: () => void calls.push("fullscreen") }));
vi.mock("@dreamfactory/engine/web/stretch", () => ({ installStretch: () => void calls.push("stretch") }));
// the store's URLs, rooted where the fetch stub below can find them
vi.mock("@dreamfactory/engine/web/page-url", () => ({ pageUrl: (p: string) => `/site/${p}` }));
vi.mock("@dreamfactory/site/version", () => ({ VERSION: "test", installVersion: () => {} }));
vi.mock("@dreamfactory/site/bug-report", () => ({
  installBugReport: (_btn: unknown, opts: typeof bugOpts) => void (bugOpts = opts),
}));
// the level runner is walkpage.ts's; here it is only where Begin ends up
vi.mock("../src/walk", () => {
  calls.push("walk");
  return {};
});

interface Disc {
  /** what the manifest lists, by site path */
  manifest: Record<string, number>;
  /** bytes to serve in place of the disc's, by site path */
  junk?: Record<string, Uint8Array>;
  /** the manifest's own fetch fails outright */
  offline?: boolean;
}
let disc: Disc;

/** `fetch`, answered off the disc: the manifest from {@link Disc}, files by path */
async function fakeFetch(url: string): Promise<Response> {
  const path = String(url).replace(/^\/site\//, "");
  if (path === "gamefiles.json") {
    if (disc.offline) throw new Error("the network is down");
    return new Response(JSON.stringify(disc.manifest), { status: 200 });
  }
  calls.push(`fetch ${path}`);
  const junk = disc.junk?.[path];
  if (junk) return new Response(junk.slice(), { status: 200 });
  const onDisc = join(ROOT, path);
  if (!existsSync(onDisc)) return new Response("missing", { status: 404 });
  if (!bytesOf.has(path)) bytesOf.set(path, new Uint8Array(readFileSync(onDisc)));
  return new Response(bytesOf.get(path)!.slice(), { status: 200 });
}

/* ----------------------------------------------------------------- the page */

const HTML = readFileSync(join(ROOT, "index.html"), "utf8");

interface Page {
  document: Document;
  el: (id: string) => HTMLElement;
  /** a key on the window */
  key: (key: string, props?: Record<string, unknown>) => Event;
  /** a press on the canvas at a point on the game's own 512x384 screen */
  press: (x: number, y: number, props?: Record<string, unknown>) => void;
  /** a pointer event on the window, at a point on the game's screen */
  win: (type: string, x: number, y: number, props?: Record<string, unknown>) => void;
  /** run the frames asked for so far, each far enough on that any hold is over */
  frames: (n?: number) => Promise<void>;
  /** frames until `pred` holds; with `hush`, every sound finishes before each */
  until: (pred: () => boolean, opts?: { hush?: boolean; max?: number }) => Promise<void>;
  log: () => string;
  loc: () => string;
  /** the file input the Open button raised, once it has */
  picker: () => HTMLInputElement | null;
  Event: typeof Event;
}

/** let the page's promises — a fetch, a stream, a film's load — run on */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 2; i++) await new Promise((r) => setImmediate(r));
};

/**
 * The logo and the intro, as most scenarios get them: the prefs out-film's
 * thirty frames under both names. The real two are most of a second of
 * decoding apiece, and only the start sequence's own test looks at them.
 */
function shortOpening(): Record<string, Uint8Array> {
  if (!have) return {};
  const stand = new Uint8Array(readFileSync(join(ROOT, MOVIES, "PREFS2.MOV")));
  return { [`${MOVIES}/CYBER.MOV`]: stand, [`${MOVIES}/IMAIN.MOV`]: stand };
}

async function openPage(
  opts: { disc?: Partial<Disc>; store?: Record<string, string>; realOpening?: boolean } = {},
): Promise<Page> {
  vi.resetModules();
  vi.unstubAllGlobals();
  calls.length = 0;
  drawn.length = 0;
  sounds.length = 0;
  bugOpts = null;
  disc = { manifest: DISC, junk: opts.realOpening ? {} : shortOpening(), ...opts.disc };

  const dom = parseHTML(HTML);
  const { document } = dom;
  const ctx2d = new Proxy({ fillText: (t: string) => void drawn.push(t) } as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : () => undefined),
    set: () => true,
  });
  const canvasProto = Object.getPrototypeOf(document.createElement("canvas"));
  canvasProto.getContext = () => ctx2d;
  canvasProto.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1024, height: 768, right: 1024, bottom: 768 });
  // the Open button's picker: the test answers it, as the reader would
  Object.getPrototypeOf(document.createElement("input")).click = () => void calls.push("picker");

  const store = new Map<string, string>(Object.entries(opts.store ?? {}));
  const win = new EventTarget();
  const rafs: FrameRequestCallback[] = [];
  // ahead of every `performance.now()` a film is built at, so a tick is always due
  let clock = performance.now() + 1e7;
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("addEventListener", win.addEventListener.bind(win));
  vi.stubGlobal("navigator", { userAgent: "node", maxTouchPoints: 0 });
  vi.stubGlobal("location", { pathname: "/skullcracker/", origin: "http://localhost", search: "" });
  vi.stubGlobal("history", { replaceState: (_s: unknown, _t: string, u: string) => void calls.push(`replaceState ${u}`) });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  vi.stubGlobal(
    "ImageData",
    class {
      data: Uint8ClampedArray;
      constructor(w: number, h: number) {
        this.data = new Uint8ClampedArray(w * h * 4);
      }
    },
  );
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => rafs.push(cb));
  vi.stubGlobal("fetch", fakeFetch);

  const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
  const pointer = (props: Record<string, unknown>): Record<string, unknown> => ({
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    ...props,
  });
  const page: Page = {
    document: document as unknown as Document,
    el,
    key: (key, props = {}) => {
      const e = new Event("keydown", { cancelable: true });
      Object.assign(e, { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...props });
      win.dispatchEvent(e);
      return e;
    },
    press: (x, y, props = {}) => {
      const e = new dom.Event("pointerdown", { cancelable: true });
      Object.assign(e, pointer({ clientX: x * 2, clientY: y * 2, ...props }));
      el("screen").dispatchEvent(e);
    },
    win: (type, x, y, props = {}) => {
      const e = new Event(type, { cancelable: true });
      Object.assign(e, pointer({ clientX: x * 2, clientY: y * 2, ...props }));
      win.dispatchEvent(e);
    },
    frames: async (n = 1) => {
      for (let i = 0; i < n; i++) {
        clock += 10_000;
        rafs.splice(0).forEach((cb) => cb(clock));
        await settle();
      }
    },
    until: async (pred, { hush = false, max = 500 } = {}) => {
      for (let i = 0; i < max; i++) {
        if (pred()) return;
        if (hush) for (const s of sounds) s.done = true;
        await page.frames();
      }
      throw new Error(`never got there — #loc "${page.loc()}", log:\n${page.log().split("\n").slice(-8).join("\n")}`);
    },
    log: () => el("log").textContent ?? "",
    loc: () => el("loc").textContent ?? "",
    picker: () => document.querySelector('input[type="file"]') as HTMLInputElement | null,
    Event: dom.Event as unknown as typeof Event,
  };
  await import("../src/main");
  await settle();
  return page;
}

/** press Start, and Escape through the logo and the intro to the menu's still */
async function toMenu(p: Page): Promise<void> {
  await p.until(() => !(p.el("start") as HTMLButtonElement).disabled);
  p.el("start").dispatchEvent(new p.Event("click"));
  await p.until(() => p.loc().startsWith("cyber.Mov"));
  p.key("Escape");
  await p.until(() => p.loc().startsWith("imain.Mov"));
  p.key("Escape");
  await atMenu(p);
}

const atMenu = (p: Page): Promise<void> => p.until(() => p.loc().startsWith("Menu.Mov · segment 1/1 · frame 1/175"));

/** the middle of each of `menu.mov`'s seven regions on its first frame (see tests/film.ts) */
const MENU = {
  begin: { x: 400, y: 93 },
  open: { x: 400, y: 128 },
  help: { x: 400, y: 160 },
  prefs: { x: 410, y: 194 },
  quit: { x: 400, y: 226 },
  credits: { x: 400, y: 330 },
  demo: { x: 150, y: 150 },
};
/** `char.mov`'s two figures from its frame 20 on, and the pans' one region (tests/browser/menu.ts) */
const LEFT_FIGURE = { x: 110, y: 150 };
const RIGHT_FIGURE = { x: 400, y: 150 };
const ACCEPT = { x: 255, y: 244 };

/** click a menu button, let its voice finish, and wait for what the exit frame leads to */
async function choose(p: Page, at: { x: number; y: number }, then: () => boolean): Promise<void> {
  p.press(at.x, at.y);
  await p.until(then, { hush: true });
}

/** from the menu: Begin or Open's chooser, a figure, the accept button, and the hand-over */
async function chooseAndAccept(p: Page, figure: { x: number; y: number }, pan: string): Promise<void> {
  await p.until(() => /^char\.mov · .* frame (2\d|[3-6]\d)\/63/.test(p.loc()), { hush: true });
  p.press(figure.x, figure.y);
  await p.until(() => p.loc().startsWith(`${pan} · segment 1/1 · frame 58/59`), { hush: true });
  p.press(ACCEPT.x, ACCEPT.y);
  await p.until(() => calls.some((c) => c.startsWith("replaceState")), { hush: true });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ---------------------------------------------------------------- the tests */

describe("the boot", () => {
  it("says there is no game data when the manifest names nothing, and opens the log", async () => {
    const p = await openPage({ disc: { manifest: {} } });
    expect(p.el("err").textContent).toBe("no game data: gamefiles/ is empty (see taoot/README.md#game-data)");
    expect(p.el("bootsay").textContent).toBe("no disc");
    expect(p.el("bootpct").textContent).toBe("0%");
    expect(p.el("log").hidden).toBe(false);
    expect((p.el("start") as HTMLButtonElement).disabled).toBe(true);
  });

  it("names the opening when the rip has no logo film, since it is the one file the page needs", async () => {
    const p = await openPage({ disc: { manifest: { [`${MOVIES}/MENU.MOV`]: 10 } } });
    expect(p.log()).toContain("indexed 1 files, 1 of them films");
    expect(p.el("err").textContent).toBe("cyber.Mov is not in this rip — the opening is the one file this page needs");
    expect(p.document.querySelector("#boot.ready")).toBeNull();
  });

  it("puts a boot that throws in the error line", async () => {
    const p = await openPage({ disc: { manifest: {}, offline: true } });
    expect(p.el("err").textContent).toBe("the network is down");
    expect(p.log()).toContain("error: the network is down");
  });

  it("says so when a film will not read, rather than going black", async () => {
    const cyber = `${MOVIES}/CYBER.MOV`;
    const p = await openPage({ disc: { manifest: { [cyber]: 4 }, junk: { [cyber]: new Uint8Array(4) } } });
    await p.until(() => p.el("bootsay").textContent === "ready");
    p.el("start").dispatchEvent(new p.Event("click"));
    await p.until(() => p.el("err").textContent !== "");
    expect(p.log()).toContain("error: ");
    expect(p.loc()).toBe("");
  });

  it("installs the page's controls, and the bug report with the page's edition and note", async () => {
    const p = await openPage({ disc: { manifest: {} } });
    expect(calls).toEqual(expect.arrayContaining(["fullscreen", "stretch"]));
    expect(bugOpts!.edition()).toBe("Skull Cracker (gamefiles/SKULL/)");
    expect((bugOpts!.log as (n: number) => string[])(1)).toEqual([expect.stringContaining("error: no game data")]);
    (bugOpts!.note as (how: string) => void)("clipboard");
    expect(p.el("bugNote").textContent).toBe("screenshot copied");
    (bugOpts!.note as (how: string) => void)("download");
    expect(p.el("bugNote").textContent).toBe("screenshot downloaded");
    // no film and no level yet: nowhere
    expect(bugOpts!.where()).toBe("");
  });

  it("keeps b for the log and the film line, and drops a click with no film to take it", async () => {
    const p = await openPage({ disc: { manifest: {} } });
    p.press(400, 93);
    expect(p.log()).not.toContain("click at");
    p.el("log").hidden = true;
    p.key("b");
    expect(p.el("log").hidden).toBe(false);
    expect(p.el("loc").hidden).toBe(false);
    p.key("b");
    expect(p.el("log").hidden).toBe(true);
    expect(p.el("loc").hidden).toBe(true);
  });
});

describe.skipIf(!have)("the start sequence", () => {
  it("fetches the logo before offering Start, then plays logo, intro and menu, and Escape skips each", async () => {
    const p = await openPage({ realOpening: true });
    await p.until(() => p.el("bootsay").textContent === "ready");
    expect(p.log()).toMatch(/^indexed \d+ files, \d+ of them films/);
    expect(p.el("bootpct").textContent).toBe("100%");
    expect(p.document.querySelector("#boot.ready")).toBeTruthy();
    expect(calls.filter((c) => c.startsWith("fetch"))).toEqual([`fetch ${MOVIES}/CYBER.MOV`]);
    // nothing plays, and no audio is made, before the gesture
    expect(p.loc()).toBe("");
    expect(calls).not.toContain("WebAudioSink");

    p.el("start").dispatchEvent(new p.Event("click"));
    expect(calls).toContain("WebAudioSink");
    expect(p.document.body.classList.contains("playing")).toBe(true);
    // the other two come down behind the logo
    await p.until(() => calls.includes(`fetch ${MOVIES}/IMAIN.MOV`) && calls.includes(`fetch ${MOVIES}/MENU.MOV`));
    await p.until(() => p.loc().startsWith("cyber.Mov · segment 1/1 · frame"));
    // the logo animates: each frame the page runs is one film frame on
    await p.frames(3);
    expect(p.loc()).toMatch(/^cyber\.Mov · segment 1\/1 · frame [3-6]\/318/);
    expect(p.key("Escape").defaultPrevented).toBe(true);
    await p.until(() => p.loc().startsWith("imain.Mov · segment 1/5"));
    p.key("Escape");
    await atMenu(p);
    expect(p.log()).toMatch(/Menu\.Mov: 1 segment\(s\), 175 frames/);
  });

  it("says which film of the sequence the rip is missing", async () => {
    const manifest = { [`${MOVIES}/CYBER.MOV`]: 1, [`${MOVIES}/MENU.MOV`]: 1 };
    const p = await openPage({ disc: { manifest } });
    await p.until(() => !(p.el("start") as HTMLButtonElement).disabled);
    p.el("start").dispatchEvent(new p.Event("click"));
    await p.until(() => p.loc().startsWith("cyber.Mov"));
    p.key("Escape");
    await p.until(() => p.el("err").textContent !== "");
    expect(p.el("err").textContent).toBe("imain.Mov: not in this rip");
  });
});

describe.skipIf(!have)("the menu", () => {
  it("waits on its still with the high-score board over it, and says when a click misses", async () => {
    const p = await openPage();
    await toMenu(p);
    await p.frames(5);
    expect(p.loc()).toMatch(/^Menu\.Mov · segment 1\/1 · frame 1\/175 "frame 1" · board Med · 1 ----- - - · 2 ----- - - · 3 ----- - -$/);
    // drawn on the still even though the film never blits a second time
    expect(drawn).toEqual(expect.arrayContaining(["Name", "Score", "Level", "Easy", "Med", "Hard", "-----"]));
    expect(bugOpts!.where()).toMatch(/^Menu\.Mov · segment 1\/1 · frame 1\/175/);
    p.press(10, 10);
    expect(p.log()).toContain("click at 10,10 — no region there");
  });

  it("shows the board's filled rows, for the difficulty the prefs are on", async () => {
    const rows = [{ name: "ACE", score: 900, level: 3 }];
    const p = await openPage({
      store: {
        "skullcracker.scores": JSON.stringify({ "-1": rows }),
        "skullcracker.prefs": JSON.stringify({ difficulty: -1 }),
      },
    });
    await toMenu(p);
    expect(p.loc()).toContain(" · board Hard · 1 ACE 900 3 · 2 ----- - -");
    expect(drawn).toEqual(expect.arrayContaining(["ACE", "900", "3"]));
  });

  it("holds Begin's exit frame until its click has been heard, then plays the chooser", async () => {
    const p = await openPage();
    await toMenu(p);
    const before = sounds.length;
    p.press(MENU.begin.x, MENU.begin.y);
    await p.frames();
    expect(p.loc()).toMatch(/^Menu\.Mov · segment 1\/1 · frame 169\/175 "frame 2"/);
    // the region's own sound, and "frame 2" is authored to wait for it
    const click = sounds.slice(before).filter((s) => s.channel === "sound");
    expect(click).toHaveLength(1);
    await p.frames(4);
    expect(p.loc()).toContain('"frame 2"');
    click[0].done = true;
    await p.until(() => p.loc().startsWith("char.mov"));
    expect(p.log()).toContain('Menu.Mov: ended on "frame 2" — Begin — which of the two Skull Crackers (0x45df7c)');
  });

  it("follows Begin through the right-hand figure's pan, its dossier, and into the level runner", async () => {
    const p = await openPage();
    await toMenu(p);
    p.press(MENU.begin.x, MENU.begin.y);
    await chooseAndAccept(p, RIGHT_FIGURE, "rtpan.mov");
    expect(p.log()).toContain("rtpan.mov: actionframe 2 — character 1 (0x45e369)");
    // the dossier the pan leaves a hole for, and the plate under it
    expect(drawn).toEqual(expect.arrayContaining(["Name: Penelope Jones", "Bonebreaker Jones"]));
    expect(drawn).not.toContain("Name: Mortis Rigor");
    expect(calls).toContain("replaceState /skullcracker/?char=1&difficulty=0&damage=1&foehit=1");
    expect(p.log()).toContain("begin: character 1, difficulty 0 — ?char=1&difficulty=0&damage=1&foehit=1");
    // the chooser's answer is kept for the level runner
    expect(JSON.parse(localStorageGet("skullcracker.prefs")!).character).toBe(1);
    // the stage is the level runner's now: its two elements, its screen, no film
    expect(p.el("level")).toBeTruthy();
    expect(p.el("hud").hidden).toBe(true);
    expect((p.el("screen") as HTMLCanvasElement).width).toBe(512);
    expect(p.el("curtain").hidden).toBe(true);
    p.el("hud").textContent = "level 1 · room 2 · x 3 · y 4 · cel 5";
    expect(bugOpts!.where()).toBe("level 1 · room 2 · x 3 · y 4");
    // and the front end's loop has let go
    await p.frames(2);
    expect(p.loc()).not.toContain("rtpan");
    // ...and its music with it: the figure's click ends the chooser AND chains
    // to the pan, and the menu that ending used to put up went on looping
    // under the level
    expect(sounds.filter((s) => s.channel === "theme" && !s.stopped)).toEqual([]);
    expect(p.log()).not.toContain('ended on "frame 1" — back to the menu');
  });

  it("opens a saved game before the chooser, and carries its numbers to the level runner", async () => {
    const p = await openPage();
    await toMenu(p);
    await choose(p, MENU.open, () => calls.includes("picker"));
    expect(p.log()).toContain('Menu.Mov: ended on "frame 3" — Open — 0x45df8d loads a .SKL saved game');
    const save = writeSkl({ level: 5, score: 1234, lives: 3, weapon: 2, rounds: 7 });
    answer(p, { name: "game.skl", bytes: save });
    await p.until(() => p.loc().startsWith("char.mov"));
    expect(p.picker()).toBeNull();
    expect(p.log()).toContain(`open: game.skl — ${LEVEL_ORDER[5]} (scene 4, stage 3), 1234 points, 3 lives, weapon 2 with 7`);
    await chooseAndAccept(p, LEFT_FIGURE, "ltpan.mov");
    expect(p.log()).toContain("ltpan.mov: actionframe 1 — character 0 (0x45e369)");
    expect(drawn).toContain("Name: Mortis Rigor");
    expect(p.log()).toContain(`begin: loaded ${LEVEL_ORDER[5]} — 1234 points, 3 lives`);
    expect(calls).toContain(
      "replaceState /skullcracker/?char=0&difficulty=0&damage=1&foehit=1&level=6&score=1234&lives=3&weapon=2&rounds=7",
    );
  });

  it("goes back to the menu when the picker is cancelled, empty, or handed something that is not a save", async () => {
    const p = await openPage();
    await toMenu(p);
    const reopen = async (): Promise<HTMLInputElement> => {
      calls.length = 0;
      await choose(p, MENU.open, () => calls.includes("picker"));
      return p.picker()!;
    };

    (await reopen()).dispatchEvent(new p.Event("cancel"));
    await atMenu(p);
    expect(p.picker()).toBeNull();

    answer(p, null, await reopen());
    await atMenu(p);

    answer(p, { name: "short.skl", bytes: new Uint8Array(10) }, await reopen());
    await atMenu(p);
    expect(p.log()).toContain("open: short.skl is 10 bytes; a saved game is 22");

    const elsewhere = writeSkl({ level: 0, score: 0, lives: 1, weapon: 1, rounds: 0 });
    new DataView(elsewhere.buffer).setUint16(0x04, 9, true);
    answer(p, { name: "odd.skl", bytes: elsewhere }, await reopen());
    await atMenu(p);
    expect(p.log()).toContain("open: odd.skl names scene 9 stage 2, which is not one of the sixteen");
  });

  it("plays Help, the Windows film first, and comes back to the menu after it", async () => {
    const p = await openPage();
    await toMenu(p);
    await choose(p, MENU.help, () => p.loc().startsWith("HelpWin.Mov"));
    expect(p.log()).toContain('Menu.Mov: ended on "frame 4" — Help — 0x45e082');
    // its pages turn on a click anywhere
    await p.until(() => p.loc().includes('"Help 3"'));
    p.press(250, 200);
    await p.frames();
    expect(p.loc()).toMatch(/"Help [45]"/);
    p.key("Escape");
    await atMenu(p);
  });

  it("falls back to the Mac help film on a rip without the Windows one", async () => {
    const manifest = { ...DISC };
    delete manifest[`${MOVIES}/HELPWIN.MOV`];
    const p = await openPage({ disc: { manifest } });
    await toMenu(p);
    await choose(p, MENU.help, () => p.loc().startsWith("HelpMac.Mov"));
    expect(p.log()).not.toContain("HelpWin.Mov");
  });

  it("answers Quit with the menu, since a tab cannot quit itself", async () => {
    const p = await openPage();
    await toMenu(p);
    p.press(MENU.quit.x, MENU.quit.y);
    await p.until(() => p.log().includes("Quit — state 11"), { hush: true });
    await atMenu(p);
    expect(p.loc()).toMatch(/^Menu\.Mov/);
  });

  it("plays the credits through, and the menu after them", async () => {
    const p = await openPage();
    await toMenu(p);
    await choose(p, MENU.credits, () => p.loc().startsWith("Credits.Mov"));
    expect(p.log()).toContain("Credits — 0x45e0be");
    await p.until(() => p.loc().startsWith("Menu.Mov"), { hush: true });
  });

  it("says the demo is a recording it does not replay, and stays on the menu", async () => {
    const p = await openPage();
    await toMenu(p);
    p.press(MENU.demo.x, MENU.demo.y);
    await p.until(() => p.log().includes("the demo — skuldemo.dmo's recorded input"), { hush: true });
    await atMenu(p);
    expect(p.loc()).toMatch(/^Menu\.Mov/);
  });

  it("comes back to itself when Escape ends the menu, rather than going black", async () => {
    const p = await openPage();
    await toMenu(p);
    p.key("Escape");
    expect(p.log()).toContain('Menu.Mov: ended on "frame 1" — back to the menu');
    await atMenu(p);
  });
});

describe.skipIf(!have)("the preferences panel", () => {
  async function openPanel(p: Page): Promise<void> {
    await choose(p, MENU.prefs, () => p.log().includes("the panel is open"));
  }

  it("opens on the in-film, overriding the chain, and every control answers a click or a key", async () => {
    const p = await openPage();
    await toMenu(p);
    await openPanel(p);
    expect(p.log()).toContain('Menu.Mov: ended on "frame 5" — Prefs');
    expect(p.log()).toContain("Menu.Mov: its own chain to prefs.mov is overridden by 0x45e093");
    expect(p.log()).toContain("Prefs.Mov: the panel is open — 0x45db40 owns it from here");
    await p.frames();
    expect(p.loc()).toBe(
      "prefs panel · difficulty 0 · volume 9 · music on · run / climb W toward D down S away A punch P kick K inv I jump J",
    );
    // the shipped bindings, labelled in their boxes
    expect(drawn).toEqual(expect.arrayContaining(["W", "D", "J"]));

    p.press(226, 233);
    expect(p.log()).toContain("prefs: difficulty -1 (0x4791e8 / 0x45d7ae)");
    p.press(130, 180);
    expect(p.log()).toContain("prefs: music off (0x4791f0 / 0x45d7c1)");
    p.press(150, 207);
    expect(p.log()).toContain("prefs: volume 2 (0x4791d0 / 0x45d743)");
    p.press(254, 155);
    expect(p.log()).toContain("prefs: toward selected — type a letter to bind it (0x479190 / 0x45d72f)");
    drawn.length = 0;
    expect(p.key("q").defaultPrevented).toBe(true);
    expect(p.log()).toContain("prefs: toward is now Q (0x45d810)");
    expect(drawn).toContain("Q");
    p.key("w");
    expect(p.log()).toContain("prefs: toward keeps Q — W is run / climb (0x45d824)");
    // held, T is the music and a digit the volume
    p.key("t", { ctrlKey: true });
    expect(p.log()).toContain("prefs: music on (0x45d6a0)");
    p.key("5", { altKey: true });
    expect(p.log()).toContain("prefs: volume 5 (0x45d6b8)");
    // ...and anything else held, or a key with no character, is not the panel's
    const lines = p.log().split("\n").length;
    expect(p.key("x", { metaKey: true }).defaultPrevented).toBe(false);
    expect(p.key("ArrowLeft").defaultPrevented).toBe(false);
    expect(p.log().split("\n")).toHaveLength(lines);
    p.press(5, 5);
    expect(p.log()).toContain("prefs: nothing at 5,5 — the button at the bottom right closes the panel");
    await p.frames();
    expect(p.loc()).toBe(
      "prefs panel · difficulty -1 · volume 5 · music on · run / climb W toward Q down S away A punch P kick K inv I jump J",
    );
    const kept = JSON.parse(localStorageGet("skullcracker.prefs")!);
    expect(kept).toMatchObject({ difficulty: -1, volume: 5, music: true });
    expect(kept.keys[1]).toBe("Q");

    // the button at the bottom right: the out-film, then the menu, on the new board
    p.press(412, 224);
    expect(p.log()).toContain("prefs: done (0x4791c8 / 0x45d73f)");
    await p.until(() => p.loc().startsWith("Prefs2.Mov"));
    await p.until(() => p.log().includes("Prefs2.Mov: the panel is away — back to the menu"), { hush: true });
    await atMenu(p);
    expect(p.loc()).toContain(" · board Hard · ");
  });

  it("leaves by Escape too, which is the page's own way out", async () => {
    const p = await openPage();
    await toMenu(p);
    await openPanel(p);
    expect(p.key("Escape").defaultPrevented).toBe(true);
    expect(p.log()).toContain("prefs: closed by ESC, which is this page's own way out");
    await p.until(() => p.loc().startsWith("Prefs2.Mov"));
  });
});

describe.skipIf(!have)("a finger", () => {
  const touch = { pointerType: "touch" };
  const tap = (p: Page, x: number, y: number, id = 1): void => {
    p.press(x, y, { ...touch, pointerId: id });
    p.win("pointerup", x, y, { ...touch, pointerId: id });
  };

  it("presses a menu button the moment it lands", async () => {
    const p = await openPage();
    await toMenu(p);
    p.press(MENU.begin.x, MENU.begin.y, touch);
    await p.frames();
    expect(p.loc()).toContain('"frame 2"');
    p.win("pointerup", MENU.begin.x, MENU.begin.y, touch);
  });

  it("skips a film by a double tap, closes the panel by one, and logs a swipe it has no use for", async () => {
    const p = await openPage();
    await toMenu(p);
    // the menu's own still is a picture with no region at its top left
    tap(p, 10, 10);
    tap(p, 10, 10);
    expect(p.log()).toContain('Menu.Mov: ended on "frame 1" — back to the menu');
    await atMenu(p);

    p.press(100, 300, { ...touch, pointerId: 2 });
    p.win("pointermove", 100, 200, { ...touch, pointerId: 2 });
    p.win("pointermove", 100, 100, { ...touch, pointerId: 2 });
    p.win("pointerup", 100, 100, { ...touch, pointerId: 2 });
    expect(p.log()).toMatch(/swipe: \S+ — this page reads no arrows/);
    p.press(100, 300, { ...touch, pointerId: 3 });
    p.win("pointercancel", 100, 300, { ...touch, pointerId: 3 });

    await openPanel(p);
    // a tap on a control is a click on it
    tap(p, 226, 233, 4);
    expect(p.log()).toContain("prefs: difficulty -1");
    tap(p, 5, 5, 5);
    tap(p, 5, 5, 5);
    expect(p.log()).toContain("prefs: closed by a double tap, which is this page's own way out");
    await p.until(() => p.loc().startsWith("Prefs2.Mov"));
  });

  async function openPanel(p: Page): Promise<void> {
    await choose(p, MENU.prefs, () => p.log().includes("the panel is open"));
  }
});

/* ------------------------------------------------------------------ helpers */

/** what the page left in its store */
function localStorageGet(key: string): string | null {
  return (globalThis.localStorage as Storage).getItem(key);
}

/** answer the Open button's picker with a file, or with none */
function answer(p: Page, file: { name: string; bytes: Uint8Array } | null, input = p.picker()!): void {
  const list = file ? [{ name: file.name, arrayBuffer: async () => file.bytes.slice().buffer }] : [];
  Object.defineProperty(input, "files", { value: list });
  input.dispatchEvent(new p.Event("change"));
}
