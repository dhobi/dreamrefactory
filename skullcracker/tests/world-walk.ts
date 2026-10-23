/**
 * The level runner's status line and its drawing (`src/page/walk.ts`) for the
 * things the playthroughs leave out of a page: what is flying, burning,
 * rolling and lying about, the player's own state, the goal's last words.
 *
 *   npx vitest run skullcracker/tests/world-walk.ts
 *
 * The same page as `tests/walkpage.ts` — `walk.html` parsed by linkedom, a
 * canvas that records, the rip read off the disk — with one difference: the
 * world is SET, not played. Each test puts a thing into the level the way the
 * game would have made it, and runs the page's loop once at the same instant
 * (`redraw`), so the world takes no tick, the frame is drawn with the thing in
 * it and the line a probe reads says what it is.
 *
 * Needs the rip; skipped without it.
 */
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { buildManifest } from "../../tools/manifest";

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

type Game = typeof import("../src/world");

interface Page {
  document: Document;
  game: Game;
  el: <T extends HTMLElement = HTMLElement>(id: string) => T;
  /** a key going down (or up) on the window — or any other event of the window's */
  key: (key: string, mods?: Record<string, unknown>, type?: string) => Event;
  /** an event of linkedom's own on an element: a change, a pointer */
  point: (target: Element, type: string, props?: Record<string, unknown>) => Event;
  /** run the page's loop once at the same instant: the world takes no tick, the frame is drawn and the line written */
  redraw: () => void;
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
  await import("../src/page/walk");
  const game = await import("../src/world");
  return {
    document: document as unknown as Document,
    game,
    el,
    key,
    point,
    redraw: () => frames.splice(0).forEach((cb) => cb(now)),
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

/** redraw and answer the status line, and how many images the frame drew */
function look(p: Page): { hud: string; drew: number } {
  const before = p.drawn();
  p.redraw();
  return { hud: p.hud(), drew: p.drawn() - before };
}

describe.skipIf(!have)("the player on the line", () => {
  it("says the act he is in, and where he hangs from a bar", async () => {
    const p = await openPage("?level=1&foes=0");
    p.frames(2);
    p.game.p.act = "punch";
    expect(look(p).hud).toContain(" · punch · cel");
    p.game.p.act = null;
    p.game.p.bar = p.game.level!.ladders[0];
    p.game.p.barHold = 3;
    p.game.p.barTag = 2;
    expect(look(p).hud).toMatch(/hanging hold 3 tag 2 at x \d+, y \d+/);
    p.game.p.bar = undefined;
  });
});

describe.skipIf(!have)("what is in the air, on the line and in the frame", () => {
  it("MALL: a board lying and one hopping, a can resting and one tumbling, a roller, the roaches", async () => {
    const p = await openPage("?level=5&foes=0");
    p.frames(2);
    const g = p.game;
    const { x, y } = g.p;
    g.setSkates([
      { x, y: y - 20, vx: 0, vy: 0, bornY: y, down: true, life: 40, facing: 1 },
      { x: x + 30, y: y - 20, vx: 3, vy: -10, bornY: y, down: false, life: 40, facing: -1 },
    ]);
    g.setCans([
      { x, y: y - 10, vx: 0, vy: 0, clock: 0, tag: 2, drag: 0, rest: 8510 },
      { x: x - 30, y: y - 30, vx: 24, vy: -14, clock: 1, tag: 0, drag: 1 },
    ]);
    g.setRollers([{ x: x + 60, y: y - 20, vx: -480, wait: -1, clock: 0, vy: 0, launch: 0, still: false }]);
    const roach = { x, y: y - 5, vy: 0, facing: 1, onGround: true, running: true, clock: 0, top: y - 100, left: x - 100, bottom: y + 100, right: x + 100 };
    g.setRoaches([roach as never, { ...roach, running: false } as never]);
    const { hud, drew } = look(p);
    expect(hud).toMatch(/2 board, first cel \d+ at x \d+/);
    expect(hud).toMatch(/2 can, first cel 8510 .* tag 2 vx 0 RESTING/);
    expect(hud).toMatch(/1 roller, first cel \d+ .* wait -1 vx -480 blow \d+/);
    expect(hud).toContain("2 roaches");
    expect(drew).toBeGreaterThan(0);
    // the first board up off the floor names its hop cel instead
    g.skates[0].down = false;
    g.cans.reverse();
    const again = look(p).hud;
    expect(again).toMatch(/2 board, first cel \d+/);
    expect(again).not.toMatch(/RESTING/);
    g.setSkates([]);
    g.setCans([]);
    g.setRollers([]);
    g.setRoaches([]);
  });

  it("the bolts, the flares and INV held, and a gun in the hand", async () => {
    const p = await openPage("?level=13&foes=0");
    p.frames(2);
    const g = p.game;
    g.setBolts([{ x: g.p.x + 50, y: g.p.y - 60, vx: 100, facing: 1, spent: false, code: -1, age: 1 }]);
    g.setFlares([{ x: g.p.x + 50, y: g.p.y - 60, vx: 40, vy: 0, facing: 1, wobble: 0, sign: 1, burn: null, age: 0, grounded: false, spent: false }]);
    g.p.invLoop = true;
    g.inv.armed = true;
    g.inv.drawn = true;
    const { hud } = look(p);
    expect(hud).toMatch(/1 bolts, nearest at x \d+, y \d+ vx 100/);
    expect(hud).toContain("1 flares");
    expect(hud).toContain("INV held");
    expect(hud).toMatch(/ · holding \S+ \d+\/\d+/);
    g.setBolts([]);
    g.setFlares([]);
    g.p.invLoop = false;
  });

  it("a creature alight for ever, and the hold that has him", async () => {
    const p = await openPage("?level=1&foes=0");
    p.frames(2);
    const g = p.game;
    g.setFlames([{ on: g.p, dx: 0, dy: -40, stage: 1, clock: 0, forever: true, mirror: false, x: g.p.x, y: g.p.y - 40 }]);
    g.p.act = "held";
    g.p.heldClock = 3;
    g.p.heldBy = () => ({ x: g.p.x, y: g.p.y - g.p.feet });
    g.p.gravityScale = 0;
    const { hud } = look(p);
    expect(hud).toMatch(/1 alight, first cel \d+ at x \d+, y \d+ stage 1 FOREVER/);
    expect(hud).toContain("<b>held</b> frame 3".replace(/<\/?b>/g, ""));
    expect(hud).toContain("HELD, gravity x0");
    g.setFlames([]);
    g.p.heldBy = null;
    g.p.act = null;
  });

  it("one life, said as one", async () => {
    const p = await openPage("?level=1&foes=0");
    p.frames(2);
    p.game.stats.lives = 1;
    expect(look(p).hud).toContain(" · 1 life · clock");
  });
});

describe.skipIf(!have)("the scenery on the line", () => {
  it("CITY: a lone crow, a plank that has been crossed", async () => {
    const p = await openPage("?level=2&foes=0");
    p.frames(2);
    const g = p.game;
    const i = g.level!.rooms.indexOf(g.p.room!);
    g.level!.crows[i].splice(1);
    const k = g.level!.planks[i][0];
    k.state = "wobble";
    k.crossings = 2;
    const { hud } = look(p);
    expect(hud).toMatch(/ · 1 crow: \w+ cel \d+ at -?\d+,-?\d+/);
    expect(hud).toMatch(/plank wobble cel \d+ x\d+ crossed 2/);
  });

  it("WOODS: a press coming down", async () => {
    const p = await openPage("?level=3&foes=0");
    p.frames(2);
    const g = p.game;
    const i = g.level!.rooms.indexOf(g.p.room!);
    const c = g.level!.crushes[i][0];
    c.state = "slam";
    expect(look(p).hud).toMatch(/press slam cel \d+ at \d+,\d+/);
  });

  it("SERVICE: a gob of goop falling from a nest", async () => {
    const p = await openPage("?level=6&foes=0");
    p.frames(2);
    const g = p.game;
    const i = g.level!.nests.findIndex((r) => r.length);
    g.p.room = g.level!.rooms[i];
    const n = g.level!.nests[i][0];
    g.setDrips([{ kind: "drop", x: n.left + 10, y: n.top + 10, vx: 0, vy: 5, clock: 0 }]);
    expect(look(p).hud).toMatch(/goop \d+ of \d+ on, 1 falling cel \d+ at \d+,\d+/);
    g.setDrips([]);
  });

  it("ARCADE: a sprinkler's column up", async () => {
    const p = await openPage("?level=8&foes=0");
    p.frames(2);
    const g = p.game;
    const q = g.level!.sprinklers[0][0];
    g.setColumns(new Map([[q.slot, 3]]));
    expect(look(p).hud).toMatch(/7 sprinklers, 1 up cel \d+/);
    g.setColumns(new Map());
  });

  it("TOWER: one surge on and one off", async () => {
    const p = await openPage("?level=12&foes=0");
    p.frames(2);
    const g = p.game;
    const i = g.level!.surges.findIndex((r) => r.length);
    g.p.room = g.level!.rooms[i];
    const all = g.level!.surges[i];
    all[0].on = true;
    if (all[1]) all[1].on = false;
    const { hud } = look(p);
    expect(hud).toMatch(/surge on cel \d+ at x\d+ y\d+/);
  });

  it("VAT: Boggs with both halves down is no longer healing", async () => {
    const p = await openPage("?level=16&x=6100&foes=0");
    p.frames(2);
    const b = p.game.level!.boggs[0][0];
    b.flags[0] = false;
    b.flags[1] = false;
    expect(look(p).hud).toMatch(/boggs \w+ cel \d+ .* no longer healing .* flags 00/);
  });
});

describe.skipIf(!have)("more of the player on the line", () => {
  it("climbing, and a gun carried rather than held", async () => {
    const p = await openPage("?level=1&foes=0");
    p.frames(2);
    const g = p.game;
    g.p.climbing = true;
    g.p.rung = 4;
    g.p.climbTag = 1;
    g.inv.armed = true;
    g.inv.drawn = false;
    const { hud } = look(p);
    expect(hud).toContain(" · climbing rung 4 tag 1");
    expect(hud).toMatch(/ · carrying \S+/);
    g.p.climbing = false;
  });

  it("stood on the nearest pickup, the rect test says yes", async () => {
    const p = await openPage("?level=1&foes=0");
    p.frames(2);
    const g = p.game;
    const i = g.level!.rooms.indexOf(g.p.room!);
    const all = g.level!.pickups[i];
    // the second of them, so the nearest is not simply the first in the list
    const q = all[1] ?? all[0];
    g.p.x = q.x;
    g.p.y = q.y;
    const { hud } = look(p);
    expect(hud).toContain(`${q.code} at x ${q.x}, y ${q.y}`);
    expect(hud).toContain("pickup rect yes");
  });
});

describe.skipIf(!have)("the goal's craft", () => {
  it("comes in with the quota met, says the screen is coming down, and the level complete once tallied", async () => {
    const p = await openPage("?level=1&foes=0");
    await until(p, /television is in|at the goal/, 200);
    const g = p.game;
    const c = g.craft!;
    // drawn from either side: the record's param is its facing
    c.facing = -c.facing;
    expect(look(p).drew).toBeGreaterThan(0);
    c.state = "open";
    c.clock = 0;
    expect(look(p).hud).toContain("the screen is coming down");
    c.tallied = true;
    expect(look(p).hud).toContain("THE GOAL — level 1 complete");
  });
});

describe.skipIf(!have)("the creatures on the line", () => {
  it("names the hydrant's water when it bursts", async () => {
    const p = await openPage("?level=1");
    p.frames(2);
    const g = p.game;
    const i = g.level!.spawned.findIndex((r) => r.some((e) => e.kind === "inithydrant"));
    g.p.room = g.level!.rooms[i];
    const e = g.level!.spawned[i].find((q) => q.kind === "inithydrant")!;
    e.state = "burst";
    expect(look(p).hud).toMatch(/ · water cel \d+ at x \d+/);
  });

  it("says where a struck mailbox ended up: the one class that flies when it is hit", async () => {
    const p = await openPage("?level=1");
    p.frames(2);
    const g = p.game;
    const i = g.level!.spawned.findIndex((r) => r.some((e) => e.kind === "initmailbox"));
    g.p.room = g.level!.rooms[i];
    const box = g.level!.spawned[i].find((q) => q.kind === "initmailbox")!;
    box.vx = 12;
    expect(look(p).hud).toContain(` · initmailbox at x ${Math.round(box.x)}`);
  });
});

describe.skipIf(!have)("what the frame draws and what it leaves out", () => {
  it("a flare's muzzle, its flight and its burn-out each draw a cel", async () => {
    // MALL's book carries the flare's cels; STREETS' does not
    const p = await openPage("?level=5&foes=0");
    p.frames(2);
    const g = p.game;
    const base = { x: g.p.x + 40, y: g.p.y - 60, vx: 40, vy: 0, facing: 1, wobble: 0, sign: 1, grounded: false, spent: false };
    const none = look(p).drew;
    g.setFlares([{ ...base, burn: null, age: 0 }, { ...base, burn: null, age: 5 }, { ...base, burn: 2, age: 9 }]);
    expect(look(p).drew).toBe(none + 3);
    g.setFlares([]);
  });

  it("a roach that has dropped, one that has spilled and one that runs", async () => {
    const p = await openPage("?level=5&foes=0");
    p.frames(2);
    const g = p.game;
    const none = look(p).drew;
    const r = { x: g.p.x, y: g.p.y - 5, vy: 0, facing: -1, onGround: true, running: false, clock: 0, top: 0, left: 0, bottom: 0, right: 0 };
    g.setRoaches([r, { ...r, spilled: true }, { ...r, running: true }] as never);
    expect(look(p).drew).toBe(none + 3);
    g.setRoaches([]);
  });

  it("an open door draws nothing, a shut one its cel", async () => {
    const p = await openPage("?level=7&foes=0");
    p.frames(2);
    const g = p.game;
    const i = g.level!.doors.findIndex((r) => r.length);
    g.p.room = g.level!.rooms[i];
    const d = g.level!.doors[i][0];
    g.p.x = d.x;
    g.p.y = d.y;
    p.frames(30);
    d.state = "shut";
    const shut = look(p).drew;
    d.state = "open";
    expect(look(p).drew).toBe(shut - 1);
  });

  it("a can's pickup, code 2, is left to the can lying on it (0x45ae23)", async () => {
    const p = await openPage("?level=5&foes=0");
    p.frames(2);
    const g = p.game;
    const i = g.level!.rooms.indexOf(g.p.room!);
    const guns = g.level!.guns[i];
    const was = guns.splice(0);
    const none = look(p).drew;
    guns.push({ ...(was[0] ?? g.level!.guns.flat()[0]), code: 2, x: g.p.x, y: g.p.y });
    expect(look(p).drew).toBe(none);
    guns.splice(0, guns.length, ...was);
  });

  it("a hand under the ground draws nothing, one up out of it its cel", async () => {
    const p = await openPage("?level=9&foes=0");
    p.frames(2);
    const g = p.game;
    const i = g.level!.hands.findIndex((r) => r.length);
    g.p.room = g.level!.rooms[i];
    const q = g.level!.hands[i][0];
    g.p.x = q.atX;
    q.state = "down";
    const down = look(p).drew;
    q.state = "held";
    expect(look(p).drew).toBe(down + 1);
  });
});

describe.skipIf(!have)("the page's own keys", () => {
  it("Ctrl+P, either case, is the interface and never the fist", async () => {
    const p = await openPage("?level=1&foes=0");
    p.frames(2);
    const was = p.game.iface;
    p.key("P", { ctrlKey: true, shiftKey: true });
    expect(p.game.iface).toBe(!was);
    expect(p.game.held.punch).toBe(false);
    p.key("p", { ctrlKey: true });
    expect(p.game.iface).toBe(was);
  });

  it("a game key while the keys are shut holds nothing, going down or coming up (0x402be0)", async () => {
    const p = await openPage("?level=1&foes=0");
    p.frames(2);
    p.game.setInput(false);
    p.key("ArrowRight");
    expect(p.game.held.right).toBe(false);
    p.game.setInput(true);
    p.key("ArrowRight");
    expect(p.game.held.right).toBe(true);
    // `0x402e30` drops every key as it shuts them, and a release while they
    // are shut is not read at all — the key stays down
    p.game.setInput(false);
    expect(p.game.held.right).toBe(false);
    p.game.held.right = true;
    p.key("ArrowRight", {}, "keyup");
    expect(p.game.held.right).toBe(true);
    p.game.setInput(true);
  });

  it("Shift+C swaps the player and swaps him back (0x402d22)", async () => {
    const p = await openPage("?level=1&foes=0");
    p.frames(2);
    p.key("C", { shiftKey: true });
    expect(p.game.character).toBe(1);
    p.key("C", { shiftKey: true });
    expect(p.game.character).toBe(0);
  });

  it("a game over that makes no row of the board says only game over", async () => {
    const p = await openPage("?level=1&foes=0");
    p.frames(2);
    p.game.ui.gameOver(0, 0, 0);
    expect(p.hud()).toBe("game over");
    expect(p.location.href).toBe("play/");
  });
});

describe.skipIf(!have)("more of what the frame draws", () => {
  it("the craft, from either side, once he is under it", async () => {
    const p = await openPage("?level=1&foes=0");
    await until(p, /television is in|at the goal/, 200);
    const c = p.game.craft!;
    p.game.p.x = c.x + 400;
    p.frames(40);
    c.facing = 1;
    const east = look(p).drew;
    c.facing = -1;
    expect(look(p).drew).toBe(east);
    expect(east).toBeGreaterThan(0);
  });

  it("a stream fired west mirrors about its anchor, and a puddle of goo lies where it fell", async () => {
    const p = await openPage("?level=2&foes=0");
    p.frames(2);
    const g = p.game;
    const none = look(p).drew;
    g.setStreams([{ weapon: 0xa, x: g.p.x - 40, y: g.p.y - 60, facing: -1, state: "loop", clock: 0 }]);
    g.setGobs([{ x: g.p.x + 20, y: g.p.y, vx: 0, vy: 0, age: 0, mirror: false, stage: 1 } as never]);
    expect(look(p).drew).toBe(none + 2);
    g.setStreams([]);
    g.setGobs([]);
  });

  it("ARCADE's boss on the line with its mode", async () => {
    const p = await openPage("?level=8");
    p.frames(2);
    const g = p.game;
    const k = g.level!.spawned[0].find((e) => e.kind === "initkragg")!;
    k.mode = "hover";
    const { hud } = look(p);
    expect(hud).toMatch(/nearest initkragg .* mode hover/);
    expect(hud).toMatch(/boss initkragg .* mode hover/);
  });
});

describe.skipIf(!have)("the last of the line and the frame", () => {
  it("a weapon number the table does not know is said as a number with no magazine", async () => {
    const p = await openPage("?level=1&foes=0");
    p.frames(2);
    p.game.inv.weapon = 99;
    p.game.inv.armed = false;
    p.game.inv.drawn = false;
    expect(look(p).hud).toContain(" · no 99 0/0");
  });

  it("GRAVE: the nearest hand comes up anywhere, and says the anywhere blow", async () => {
    const p = await openPage("?level=9&foes=0");
    p.frames(2);
    const g = p.game;
    const i = g.level!.hands.findIndex((r) => r.length);
    g.p.room = g.level!.rooms[i];
    for (const q of g.level!.hands[i]) q.underfoot = false;
    expect(look(p).hud).toMatch(/nearest hand anywhere \w+ cel \d+ at x \d+ blow -?\d+/);
  });

  it("a flame not lit to last says only its stage, and the pickup nearest is found wherever it is in the list", async () => {
    const p = await openPage("?level=1&foes=0");
    p.frames(2);
    const g = p.game;
    g.setFlames([{ on: g.p, dx: 0, dy: -40, stage: 2, clock: 0, forever: false, mirror: false, x: g.p.x, y: g.p.y - 40 }]);
    const i = g.level!.rooms.indexOf(g.p.room!);
    const last = g.level!.pickups[i].at(-1)!;
    g.p.x = last.x;
    const { hud } = look(p);
    expect(hud).toMatch(/1 alight, first cel \d+ at x \d+, y \d+ stage 2 · /);
    expect(hud).toContain(`${last.code} at x ${last.x}, y ${last.y}`);
    g.setFlames([]);
  });

  it("MAZE's big gun folding and risen draws its turret", async () => {
    const p = await openPage("?level=13&x=2167&y=6905&foes=0");
    await until(p, /biggun \w+\/\d y\d+ cel \d+/, 60);
    const g = p.game;
    const i = g.level!.bigguns.findIndex((r) => r.length);
    const gun = g.level!.bigguns[i][0];
    gun.state = "wait";
    const none = look(p).drew;
    for (const state of ["fold", "rise"] as const) {
      gun.state = state;
      gun.clock = 0;
      const { hud, drew } = look(p);
      expect(hud).toMatch(new RegExp(`biggun ${state}/\\d y\\d+ cel [1-9]\\d*`));
      expect(drew).toBe(none + 1);
    }
  });
});
