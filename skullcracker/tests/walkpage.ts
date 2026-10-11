/**
 * The level runner (`src/walk.ts`), in node: the real `walk.html` parsed by
 * linkedom, a canvas context that records rather than paints, the frame clock
 * stepped by hand, and the file store reading the rip off this machine's disk.
 *
 *   npx vitest run --project skullcracker skullcracker/tests/walkpage.ts
 *
 * The machine suites drive `game.ts` and never load this page; the browser
 * suites load it but need a dev server and a browser. What is pinned here is the
 * page between the two: which key, tap and pad press reaches which game call,
 * the chooser, the pause panel and its save, a film owning the keyboard and the
 * picture, the status line a probe reads, and that a frame draws the level at
 * all. What the pixels LOOK like is a browser's question.
 *
 * Everything past the boot needs the disc, and is skipped without it — the
 * bargain every Skull Cracker suite makes. The boot's two failures run on a
 * manifest that names nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { buildManifest } from "../../tools/manifest";
import { readSkl } from "../src/savegame";

const PKG = join(import.meta.dirname, "..");
const have = existsSync(join(PKG, "gamefiles/SKULL"));

/* ---------------------------------------------------------------- the fakes */

/** how the next page's file store opens: off the disk, empty, or not at all */
let store: "disk" | "empty" | "throws" = "disk";

/** the rip's manifest, keyed as the page's would be — walked once per run */
let manifest: Record<string, number> | null = null;
function ripManifest(): Record<string, number> {
  if (manifest) return manifest;
  const gamefiles = join(PKG, "gamefiles");
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(buildManifest({ gamefiles, publicDir: join(PKG, "public") }))) {
    const norm = k.replace(/\\/g, "/");
    out[norm.startsWith(gamefiles) ? "gamefiles" + norm.slice(gamefiles.length) : norm] = v;
  }
  return (manifest = out);
}

/** the bytes already read, so each scenario's fresh store does not read them again */
const disk = new Map<string, Uint8Array | null>();
async function readDisk(path: string): Promise<Uint8Array | null> {
  if (disk.has(path)) return disk.get(path)!;
  const at = path.startsWith("gamefiles/") ? join(PKG, path) : join(PKG, "public", path);
  const bytes = await readFile(at).then(
    (b) => new Uint8Array(b),
    () => null,
  );
  disk.set(path, bytes);
  return bytes;
}

// the store the page opens is the headless one, on the disk
vi.mock("../src/files", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/files")>();
  class DiskFiles extends mod.SkullFiles {
    static override async open(): Promise<InstanceType<typeof mod.SkullFiles>> {
      if (store === "throws") throw new Error("no manifest");
      return mod.SkullFiles.fromReader(store === "empty" ? {} : ripManifest(), readDisk);
    }
  }
  return { ...mod, SkullFiles: DiskFiles };
});

// a real sink wants an AudioContext; the films' beds go nowhere here
vi.mock("@dreamfactory/engine/runtime/audio", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@dreamfactory/engine/runtime/audio")>();
  return { ...mod, WebAudioSink: mod.NullAudioSink };
});

/* ----------------------------------------------------------------- the page */

const HTML = readFileSync(join(PKG, "walk.html"), "utf8");
/** one engine frame, in the page's milliseconds */
const FRAME = 1000 / 15;

type Game = typeof import("../src/game");

interface Page {
  document: Document;
  game: Game;
  el: <T extends HTMLElement = HTMLElement>(id: string) => T;
  /** a key going down (or up) on the window — or any other event of the window's */
  key: (key: string, mods?: Record<string, unknown>, type?: string) => Event;
  /** an event of linkedom's own on an element: a change, a pointer */
  point: (target: Element, type: string, props?: Record<string, unknown>) => Event;
  /** step `n` frames of the page's loop, a fifteenth of a second apart */
  frames: (n?: number) => void;
  hud: () => string;
  /** every `drawImage` the screen's context has been asked for */
  drawn: () => number;
  /** every `fillRect` it has been asked for, as its four numbers */
  fills: number[][];
  location: { search: string; href: string; origin: string };
  stored: Map<string, string>;
}

async function openPage(query = "", opts: { mobile?: boolean; picker?: unknown; activation?: boolean } = {}): Promise<Page> {
  vi.resetModules();
  const dom = parseHTML(HTML);
  const { document } = dom;

  let draws = 0;
  const fills: number[][] = [];
  const screen = (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
  const ctx2d = new Proxy(
    {
      createImageData: screen,
      getImageData: (_x: number, _y: number, w: number, h: number) => screen(w, h),
      measureText: (s: string) => ({ width: s.length * 6 }),
      drawImage: () => void draws++,
      fillRect: (...r: number[]) => void fills.push(r),
    } as Record<string, unknown>,
    { get: (t, k) => (k in t ? t[k as string] : () => undefined), set: () => true },
  );
  const proto = Object.getPrototypeOf(document.createElement("canvas"));
  // linkedom's canvas has no context to give
  proto.getContext = () => ctx2d;
  // ...nor its size, which it leaves at a blank canvas's 300x150 whatever the markup says
  for (const [side, blank] of [["width", 300], ["height", 150]] as const) {
    Object.defineProperty(proto, side, {
      configurable: true,
      get(this: Element) {
        return Number(this.getAttribute(side) ?? blank);
      },
      set(this: Element, v: number) {
        this.setAttribute(side, String(v));
      },
    });
  }
  proto.getBoundingClientRect = () => ({ left: 0, top: 0, width: 512, height: 384, right: 512, bottom: 384 });
  // a dispatched pointer is not a live one, and a browser refuses to capture it
  const el0 = Object.getPrototypeOf(proto);
  el0.setPointerCapture = () => {
    throw new Error("not a live pointer");
  };

  // linkedom's select reads its value and cannot be given one
  const select = Object.getPrototypeOf(document.createElement("select"));
  Object.defineProperty(select, "value", {
    configurable: true,
    get(this: HTMLSelectElement) {
      const o = this.querySelector("option[selected]") ?? this.querySelector("option");
      return o?.getAttribute("value") ?? "";
    },
    set(this: HTMLSelectElement, v: string) {
      for (const o of this.querySelectorAll("option")) {
        if (o.getAttribute("value") === String(v)) o.setAttribute("selected", "");
        else o.removeAttribute("selected");
      }
    },
  });
  select.blur ??= () => {};

  const win = new EventTarget();
  const frames: FrameRequestCallback[] = [];
  const stored = new Map<string, string>();
  const location = { search: query, href: `http://localhost/walk.html${query}`, origin: "http://localhost" };
  // one clock for the loop, the films and the cheat words' four seconds
  let now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  (globalThis as { SC_QUERY?: string }).SC_QUERY = query;
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("location", location);
  vi.stubGlobal("addEventListener", win.addEventListener.bind(win));
  vi.stubGlobal("navigator", {
    userAgent: opts.mobile ? "Mozilla/5.0 (iPhone)" : "node",
    maxTouchPoints: 0,
    userActivation: opts.activation === undefined ? undefined : { isActive: opts.activation },
  });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
  });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("prompt", () => "TESTER");
  vi.stubGlobal("showSaveFilePicker", opts.picker);

  const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as unknown as T;
  const key = (k: string, mods: Record<string, unknown> = {}, type = "keydown"): Event => {
    const { target, ...rest } = mods;
    const e = new Event(type, { cancelable: true });
    Object.assign(e, { key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...rest });
    // a key typed into an element, as the browser would say it was
    if (target) Object.defineProperty(e, "target", { value: target });
    win.dispatchEvent(e);
    return e;
  };
  const point = (target: Element, type: string, props: Record<string, unknown> = {}): Event => {
    const e = new dom.Event(type, { cancelable: true });
    Object.assign(e, { pointerId: 1, clientX: 0, clientY: 0, ...props });
    target.dispatchEvent(e);
    return e;
  };
  await import("../src/walk");
  const game = await import("../src/game");
  return {
    document: document as unknown as Document,
    game,
    el,
    key,
    point,
    frames: (n = 1) => {
      for (let i = 0; i < n; i++) {
        now += FRAME;
        frames.splice(0).forEach((cb) => cb(now));
      }
    },
    hud: () => el("hud").textContent ?? "",
    drawn: () => draws,
    fills,
    location,
    stored,
  };
}

/** step frames until the hud says `what`, letting the page's awaits run between them */
async function until(p: Page, what: RegExp, max = 400): Promise<void> {
  for (let i = 0; i < max && !what.test(p.hud()); i++) {
    p.frames();
    await new Promise((r) => setTimeout(r, 0));
  }
  expect(p.hud()).toMatch(what);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (globalThis as { SC_QUERY?: string }).SC_QUERY;
  store = "disk";
});

/* ---------------------------------------------------------------- the tests */

describe("the boot", () => {
  it("says a rip with no player book, and never starts the loop", async () => {
    store = "empty";
    const p = await openPage("?level=1");
    expect(p.hud()).toBe("player.sbk is not in this rip");
    // the chooser is filled before the game is asked to stand up
    expect(p.el<HTMLSelectElement>("level").querySelectorAll("option")).toHaveLength(16);
    p.frames(3);
    expect(p.drawn()).toBe(0);
  });

  it("puts a boot that throws on the status line", async () => {
    store = "throws";
    const p = await openPage();
    expect(p.hud()).toBe("Error: no manifest");
  });
});

describe.skipIf(!have)("a level", () => {
  it("draws STREETS, and walks it by the arrows", async () => {
    const p = await openPage("?level=1&foes=0");
    p.frames(2);
    expect(p.hud()).toMatch(/^level 1 · streets · room \d+ of \d+ \(newroom\/p3\)/);
    expect(p.hud()).toContain("damage off");
    expect(p.hud()).toContain("every pixel is the disc's");
    expect(p.el<HTMLSelectElement>("level").value).toBe("1");
    expect(p.drawn()).toBeGreaterThan(10);
    const x0 = p.game.p.x;
    p.key("ArrowRight");
    p.frames(6);
    expect(p.hud()).toMatch(/walking \d+px\/s/);
    expect(p.game.p.x).toBeGreaterThan(x0 + 20);
    // the status line's view is the camera's own corner, and it follows
    expect(p.hud()).toContain(`view ${Math.round(p.game.view.x)},${Math.round(p.game.view.y)}`);
    const cam = p.game.view.x;
    // W held is the run
    p.key("w");
    p.frames(6);
    expect(p.hud()).toMatch(/RUNNING \d+px\/s/);
    expect(p.game.view.x).toBeGreaterThan(cam);
    p.key("w", {}, "keyup");
    p.key("ArrowRight", {}, "keyup");
    expect(p.game.held.right).toBe(false);
    p.frames(10);
    expect(p.hud()).not.toMatch(/walking|RUNNING/);
    // the jump leaves the floor
    p.key(" ");
    await until(p, /in the air/, 20);
    p.key(" ", {}, "keyup");
    p.frames(40);
    p.key("s");
    p.frames(4);
    expect(p.hud()).toContain("crouching");
    p.key("s", {}, "keyup");
  });

  it("takes a door by ↑, and only from inside it", async () => {
    const p = await openPage("?level=1&x=4650&foes=0");
    p.frames(2);
    expect(p.hud()).toContain("(newroom/p3) · doors to p1");
    expect(p.hud()).toContain("press ↑ for the door");
    p.key("ArrowUp");
    p.frames(1);
    p.key("ArrowUp", {}, "keyup");
    p.frames(4);
    expect(p.hud()).toContain("(newroom/p1)");
  });

  it("changes level by the chooser, and by [ and ]", async () => {
    const p = await openPage("?level=1&foes=0");
    p.frames(1);
    const pick = p.el<HTMLSelectElement>("level");
    pick.value = "3";
    p.point(pick, "change");
    await until(p, /^level 3 · /);
    expect(pick.value).toBe("3");
    p.key("]");
    await until(p, /^level 4 · /);
    p.key("[");
    await until(p, /^level 3 · /);
    p.key("[");
    await until(p, /^level 2 · city/);
    // the chooser's own keys are its own while it has the focus
    expect(p.key("]", { target: pick }).defaultPrevented).toBe(false);
    p.frames(1);
    expect(p.hud()).toMatch(/^level 2 · /);
    // ...and choosing the level already up loads nothing
    pick.value = "2";
    p.point(pick, "change");
    expect(p.game.levelIndex).toBe(1);
  });

  it("answers the page's own keys: damage, the interface, the spawn, the player, the mute", async () => {
    const p = await openPage("?level=1&foes=0");
    p.frames(1);
    p.key("H", { shiftKey: true });
    p.frames(1);
    expect(p.hud()).toMatch(/damage ON \d+\/\d+hp/);
    p.key("H", { shiftKey: true });
    p.frames(1);
    expect(p.hud()).toContain("damage off");
    const iface = p.game.iface;
    p.key("p", { ctrlKey: true });
    expect(p.game.iface).toBe(!iface);
    p.frames(1);
    p.key("p", { ctrlKey: true });
    const x = p.game.p.x;
    p.key("N", { shiftKey: true });
    p.frames(1);
    expect(p.game.p.x).not.toBe(x);
    p.key("M", { shiftKey: true });
    expect(p.hud()).toContain("char 0");
    p.key("C", { shiftKey: true });
    await until(p, /char 1/);
    // a key the page does not know is left alone
    expect(p.key("F5").defaultPrevented).toBe(false);
    expect(p.key("[").defaultPrevented).toBe(true);
  });

  it("takes a cheat word as it is typed, and says so", async () => {
    const p = await openPage("?level=1&foes=0");
    p.frames(1);
    for (const k of "bewitch") p.key(k);
    p.frames(1);
    expect(p.hud()).toContain("bewitch — five lives");
    expect(p.game.stats.lives).toBe(5);
    expect(p.hud()).toContain("5 lives");
  });
});

describe.skipIf(!have)("the pause panel", () => {
  it("is ESC's, owns the keys while it is up, and ESC puts the level back", async () => {
    const p = await openPage("?level=1&foes=0");
    p.frames(1);
    p.key("Escape");
    await until(p, /^pausea\.mov.* — resume · save · quit/i);
    expect(p.game.film).not.toBeNull();
    const x = p.game.p.x;
    p.key("ArrowRight");
    p.frames(5);
    expect(p.game.p.x).toBe(x);
    p.key("Escape");
    await until(p, /^level 1 · streets/);
    expect(p.game.film).toBeNull();
  });

  it("saves by its middle button, as a download where there is no dialog", async () => {
    const p = await openPage("?level=2&foes=0");
    p.frames(1);
    p.key("q", { ctrlKey: true });
    await until(p, /frame ([6-9]|\d\d+)\//);
    const clicked: string[] = [];
    const proto = Object.getPrototypeOf(p.document.createElement("a"));
    proto.click = function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    };
    p.point(p.el("screen"), "pointerdown", { clientX: 400, clientY: 196 });
    await until(p, /saved skullcracker-CITY\.skl/i);
    expect(clicked).toEqual([expect.stringMatching(/^skullcracker-city\.skl$/i)]);
  });

  it("saves through the file dialog where the browser has one, and writes nothing when it is cancelled", async () => {
    let written: Blob | null = null;
    const picker = async () => ({
      name: "mine.skl",
      createWritable: async () => ({ write: async (b: Blob) => void (written = b), close: async () => {} }),
    });
    const p = await openPage("?level=2&foes=0", { picker, activation: true });
    p.frames(1);
    p.key("Escape");
    await until(p, /frame ([6-9]|\d\d+)\//);
    p.point(p.el("screen"), "pointerdown", { clientX: 400, clientY: 196 });
    await until(p, /saved mine\.skl/);
    const bytes = new Uint8Array(await written!.arrayBuffer());
    expect(readSkl(bytes)).toMatchObject({ scene: 3, stage: 3 });

    // ...and a reader closing the dialog is the original's empty answer
    vi.stubGlobal("showSaveFilePicker", async () => {
      throw new DOMException("closed", "AbortError");
    });
    p.key("Escape");
    await until(p, /frame ([6-9]|\d\d+)\//);
    p.point(p.el("screen"), "pointerdown", { clientX: 400, clientY: 196 });
    await until(p, /^level 2 · /);
    expect(p.hud()).not.toContain("saved");
  });

  it("leaves for the front door by its bottom button", async () => {
    const p = await openPage("?level=2&foes=0");
    p.frames(1);
    p.key("Escape");
    await until(p, /frame ([6-9]|\d\d+)\//);
    p.point(p.el("screen"), "pointerdown", { clientX: 400, clientY: 227 });
    for (let i = 0; i < 40 && p.location.href !== "index.html"; i++) {
      p.frames();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(p.location.href).toBe("index.html");
  });
});

describe.skipIf(!have)("a film", () => {
  it("owns the picture and the keyboard, and ESC or a tap skips it", async () => {
    const p = await openPage("?level=1&foes=0");
    p.frames(1);
    const played = p.game.ui.film("kill1.mov");
    await until(p, /^kill1\.mov.* — press ESC to skip/i);
    p.key("ArrowRight");
    expect(p.game.held.right).toBe(false);
    p.key("Escape");
    await played;
    expect(p.game.film).toBeNull();
    const again = p.game.ui.film("kill1.mov");
    await until(p, /press ESC to skip/);
    p.point(p.el("screen"), "pointerdown");
    await again;
    expect(p.game.film).toBeNull();
    // a film the rip does not have is simply gone past
    await p.game.ui.film("nowhere.mov");
  });

  it("ends a game on the board, and goes back to the front door", async () => {
    const p = await openPage("?level=1&foes=0");
    p.game.ui.gameOver(5000, 3, 1);
    expect(p.location.href).toBe("index.html");
    expect(p.hud()).toMatch(/^game over — row 1 of the board$/);
    expect([...p.stored.values()].join()).toContain("TESTER");
  });
});

describe.skipIf(!have)("the pad", () => {
  it("is up with ?pad=1, presses what it says, and goes for a film", async () => {
    const p = await openPage("?level=1&foes=0&pad=1");
    const pad = p.el("pad");
    expect(pad.hidden).toBe(true);
    p.frames(1);
    expect(pad.hidden).toBe(false);
    expect(pad.querySelectorAll("button[data-act]")).toHaveLength(8);
    const right = pad.querySelector("button.right")!;
    const down = p.point(right, "pointerdown", { pointerId: 7 });
    expect(down.defaultPrevented).toBe(true);
    expect(p.game.held.right).toBe(true);
    p.point(right, "pointerup", { pointerId: 7 });
    expect(p.game.held.right).toBe(false);
    p.point(right, "pointerdown", { pointerId: 8 });
    p.point(right, "pointercancel", { pointerId: 8 });
    expect(p.game.held.right).toBe(false);
    expect(p.point(right, "contextmenu").defaultPrevented).toBe(true);
    const left = pad.querySelector("button.left")!;
    p.point(left, "pointerdown", { pointerId: 9 });
    expect(p.game.held.left).toBe(true);
    // the window losing its fingers lets go of every key
    p.key("", {}, "blur");
    expect(p.game.held.left).toBe(false);
    p.point(left, "pointerdown", { pointerId: 10 });
    p.key("Escape");
    await until(p, /resume · save · quit/);
    expect(pad.hidden).toBe(true);
    expect(p.game.held.left).toBe(false);
  });

  it("comes up by itself on a phone, and not with ?pad=0", async () => {
    const phone = await openPage("?level=1&foes=0", { mobile: true });
    phone.frames(1);
    expect(phone.el("pad").hidden).toBe(false);
    const off = await openPage("?level=1&foes=0&pad=0", { mobile: true });
    off.frames(1);
    expect(off.el("pad").hidden).toBe(true);
  });
});

describe.skipIf(!have)("a fight", () => {
  it("names whoever has noticed, and a blow sprays what it lands on", async () => {
    // standing in a werewolf's own rect, which wakes it
    const p = await openPage("?level=1&x=10050&damage=1&foehit=1");
    p.frames(20);
    expect(p.hud()).toMatch(/\d+ fighting · nearest \w+ \d+\/\d+hp/);
    let gobs = 0;
    for (let i = 0; i < 80 && !gobs; i++) {
      // face the nearest, then the fist
      const near = p.game.spawnedHere().sort((a, b) => Math.abs(a.x - p.game.p.x) - Math.abs(b.x - p.game.p.x))[0];
      const arrow = near.x < p.game.p.x ? "ArrowLeft" : "ArrowRight";
      p.key(arrow);
      p.frames(1);
      p.key(arrow, {}, "keyup");
      p.key("p");
      p.frames(2);
      p.key("p", {}, "keyup");
      p.frames(2);
      gobs = p.game.gobs.length;
    }
    expect(gobs).toBeGreaterThan(0);
    p.frames(2);
    expect(p.hud()).toMatch(/bar \d+\/\d+ plate \d+/);
  });

  it("turns a soaker on GRAVE's zombies, drawn the way it faces", async () => {
    const p = await openPage("?level=9&x=2058");
    p.frames(12);
    // the soaker lies underfoot, and a crouch takes it
    p.key("s");
    p.frames(14);
    p.key("s", {}, "keyup");
    p.frames(8);
    expect(p.hud()).toMatch(/holding soaker \d+/);
    p.key("ArrowLeft");
    p.frames(17);
    p.key("ArrowLeft", {}, "keyup");
    p.frames(3);
    p.key("p");
    p.frames(8);
    expect(p.hud()).toMatch(/stream \w+ cel 98\d\d at x \d+/);
    expect(p.game.p.facing).toBeLessThan(0);
    p.key("p", {}, "keyup");
  });

  it("goes red when the health runs out, and it costs a life", async () => {
    const p = await openPage("?level=1&foes=0&damage=1");
    p.frames(2);
    for (let i = 0; i < 3; i++) for (const k of "harakari") p.key(k);
    let red = false;
    for (let i = 0; i < 20 && !red; i++) {
      p.frames();
      red = p.game.deathRed !== null;
    }
    expect(red).toBe(true);
    for (let i = 0; i < 200 && p.game.deathRed; i++) p.frames();
    await until(p, /· 2 lives ·/);
  });

  it("plays a TIME film when the clock runs out, and starts the level again", async () => {
    const p = await openPage("?level=1&foes=0&clock=1");
    await until(p, /^time\d\.mov.* — press ESC to skip/i, 100);
    p.key("Escape");
    await until(p, /^level 1 · streets/);
  });
});

describe.skipIf(!have)("every level", () => {
  it("draws each of the sixteen and names it on the status line", async () => {
    const p = await openPage("?level=1&damage=1");
    p.frames(2);
    for (let n = 1; n <= 16; n++) {
      if (n > 1) {
        p.key("]");
        await until(p, new RegExp(`^level ${n} · `));
      }
      const before = p.drawn();
      p.frames(3);
      expect(p.drawn()).toBeGreaterThan(before);
      expect(p.hud()).toMatch(/quota \d+ of \d+/);
    }
  });
});

describe.skipIf(!have)("Boggs", () => {
  it("draws VAT's boss whole, and names him and his machinery on the status line", async () => {
    // beside the body, in chamber2, where tests/machine/vat.ts stands
    const p = await openPage("?level=16&x=6100&damage=1");
    await until(p, /· boggs \w+ cel \d+ at x\d+/);
    const before = p.drawn();
    p.frames(4);
    // the machinery, the body, the arm, the jaws and the head: five at the least
    expect(p.drawn() - before).toBeGreaterThanOrEqual(4 * 5);
    expect(p.hud()).toMatch(/boggs \w+ cel \d+ at x\d+, y\d+, 4000\/4000hp, \+30 a frame · head \d+ tag \d+ · machine 3000\/3000@x\d+ 3000\/3000@x\d+ flags 11/);
    expect(p.hud()).toContain("1 still to kill and Boggs still standing");
  });

  it("drops worms in front of him, and draws them", async () => {
    const p = await openPage("?level=16&x=5950&damage=1");
    for (let i = 0; i < 240 && !p.game.wormsHere().length; i++) p.frames();
    expect(p.game.wormsHere().length).toBeGreaterThan(0);
    const before = p.drawn();
    p.frames(2);
    expect(p.drawn()).toBeGreaterThan(before);
  });

  it("sweeps his first machine out at a player right of the body", async () => {
    const p = await openPage("?level=16&x=6400&damage=1");
    p.frames(2);
    const b = p.game.hereOf((l) => l.boggs)[0];
    // once the player has landed
    for (let i = 0; i < 60 && b.zap.kind !== 1; i++) p.frames();
    expect(b.zap.kind).toBe(1);
    const before = p.drawn();
    p.frames(4);
    // the sweeping machine is drawn on top of the five that always are
    expect(p.drawn() - before).toBeGreaterThan(4 * 5);
  });

  it("throws the wreck's balls, and is drawn dying", async () => {
    const { BOGGS } = await import("../src/props");
    const p = await openPage("?level=16&x=6100&damage=1");
    p.frames(2);
    const b = p.game.hereOf((l) => l.boggs)[0];
    // the sixth machine wrecked, as tests/machine/vat.ts wrecks it
    b.machines[BOGGS.drain.machine].hp = 1;
    p.game.strikeMachine(b, BOGGS.drain.machine, 100);
    let pops = 0;
    for (let i = 0; i < 40; i++) {
      p.frames();
      pops = Math.max(pops, p.game.pops.length);
    }
    expect(pops).toBeGreaterThan(0);
    b.hp = 0;
    await until(p, /boggs dying cel \d+/, 10);
  });
});

describe.skipIf(!have)("the scenery that moves", () => {
  /**
   * Where each level keeps its machinery, and what the status line calls it
   * there: the opening of a level shows little of it, so "every level" above
   * draws hardly any. Each spot is the first of its kind in the level's own
   * lists, stood on with nothing to fight.
   */
  it.each([
    ["MAZE's big guns", "?level=13&x=2167&y=6905", /biggun \w+\/\d y\d+ cel \d+/],
    ["MAZE's fan", "?level=13&x=2062&y=7521", /fan v \w+ cel \d+ at x2200/],
    ["BARREL's belts, chair and claws", "?level=14&x=4936&y=7828", /\d+ belts · chair \d+ cel \d+ at x3851 · claw \w+ cel \d+/],
    ["CAVERN's bridge", "?level=10&x=5976&y=2391", /bridge \w+ cel \d+ at x5976/],
    ["SEWER's barrels and pipe", "?level=7&x=3703&y=16603", /barrel at \d+,\d+ .*pipe at x4113/],
    ["SEWER's lifts", "?level=7&x=7494&y=17244", /lift x7494 \w+ y\d+/],
    ["ARCADE's sprinklers", "?level=8&x=462&y=8284", /7 sprinklers, \d+ up/],
    ["TOWER's floors", "?level=12&x=16604&y=16420", /floor \w+ cel \d+ at x16604/],
  ])("draws %s and names it", async (_what, query, says) => {
    const p = await openPage(`${query}&foes=0`);
    await until(p, says, 60);
    const before = p.drawn();
    p.frames(3);
    expect(p.drawn()).toBeGreaterThan(before);
  });
});

describe.skipIf(!have)("what a level does by itself", () => {
  it("fires CITY's probe as the player walks into it, and draws the flypast off the player's own book", async () => {
    // the mode-0 record, rect 2240,7930,2600,8000 — tests/machine/city.ts
    const p = await openPage("?level=2&x=7960&y=2400&foes=0");
    await until(p, /tag0@-?\d+,\d+ cel 2020[0-7]/, 40);
    const before = p.drawn();
    p.frames(2);
    expect(p.drawn()).toBeGreaterThan(before);
  });

  it("flashes TOWER's lightning over the view, once a period", async () => {
    const p = await openPage("?level=12&x=17814&y=14755&foes=0");
    await until(p, /lightfx \d+\/201/, 20);
    // the screen is cleared whole every frame; anything else filled is the flash
    const flashes = (): number => p.fills.filter((r) => r[0] !== 0 || r[1] !== 0).length;
    expect(flashes()).toBe(0);
    for (let i = 0; i < 202 * 2 && !flashes(); i++) p.frames();
    expect(flashes()).toBe(1);
    // ...and the next frame is not flashed again
    p.frames(3);
    expect(flashes()).toBe(1);
  });
});
