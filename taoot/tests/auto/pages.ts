/**
 * The three small pages, in node: the front page's door to the speedrun
 * (`src/home.ts`), the speedrun workbench's own half (`src/speedrun-page.ts`),
 * and the guided tour's doors (`src/freeroam-page.ts`).
 *
 *   npx vitest run --project taoot taoot/tests/auto/pages.ts
 *
 * Each is the glue between a page and something tested on its own — the code
 * (konami.ts), the workbench (engine/src/web/speedrun/), the door table
 * (freeroam/doors.ts) — so what is pinned is the glue: the front page opens the
 * door once the mark has finished its turn; the workbench is handed this game's
 * actions, its sheet, and a warm-up list of one edition and the neutral files;
 * the tour page says what each door did.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";

const calls: string[] = [];
let unlock: (() => void) | null = null;
let workbench: Record<string, unknown> | null = null;

vi.mock("@dreamfactory/site/locales", () => ({ installI18n: async () => void calls.push("i18n") }));
vi.mock("@dreamfactory/site/lang-menu", () => ({ installLanguageMenu: async () => void calls.push("langMenu") }));
vi.mock("@dreamfactory/site/play-menu", () => ({ installPlayMenu: async () => void calls.push("playMenu") }));
vi.mock("@dreamfactory/site/version", () => ({ installVersion: () => void calls.push("version") }));
vi.mock("../../src/konami", () => ({ installKonami: (fn: () => void) => void (unlock = fn) }));
vi.mock("@dreamfactory/engine/web/speedrun/workbench", () => ({
  startWorkbench: (opts: Record<string, unknown>) => void (workbench = opts),
}));
vi.mock("../../src/editions", () => ({
  gamefileSizes: async () => ({
    "gamefiles/en/titanic1/data/bootfile": 10,
    "gamefiles/de/titanic1/data/bootfile": 20,
    "lang.stg": 30,
  }),
}));

/** the door table's answers, set per test */
const doors = {
  spot: { paint: "door" } as { paint: string } | null,
  step: { stepped: "c73.set" } as { stepped?: string },
  open: { opened: "D-12", to: "c73.set" } as { opened?: string; to?: string; skipped?: string },
  fail: "",
};
vi.mock("../../src/freeroam/doors", () => ({
  isDoorHotspot: (paint: string) => paint === "door",
  doorSpot: (set: string, _sc: string, _v: string, paint: string, disc: number) => {
    calls.push(`spot ${set} ${paint} disc ${disc}`);
    return paint === "door" ? doors.spot : null;
  },
  stepIfRefused: async () => {
    if (doors.fail) throw new Error(doors.fail);
    return doors.step;
  },
  openIfRefused: async () => {
    if (doors.fail) throw new Error(doors.fail);
    return doors.open;
  },
  pickDoorway: () => "the doorway",
}));

function page(html: string, extra: Record<string, unknown> = {}) {
  vi.resetModules();
  calls.length = 0;
  const { document } = parseHTML(html);
  const location = { href: "http://localhost/" };
  vi.stubGlobal("document", document);
  vi.stubGlobal("location", location);
  vi.stubGlobal("window", Object.assign(Object.create(globalThis), { location, ...extra }));
  return { document, location };
}

afterEach(() => {
  vi.unstubAllGlobals();
  unlock = null;
  workbench = null;
  doors.fail = "";
});

describe("the front page", () => {
  it("puts up its chrome and opens the speedrun at once with no mark to wait for", async () => {
    const { location } = page("<html><head></head><body><div id=home></div></body></html>");
    await import("../../src/home");
    expect(calls).toEqual(expect.arrayContaining(["i18n", "langMenu", "playMenu", "version"]));
    unlock!();
    expect(location.href).toMatch(/speedrun\/$/);
  });

  it("waits for the mark's own animation, however it ends", async () => {
    const { document, location } = page('<html><head></head><body><div id=home><span class="hero-mark"></span></div></body></html>');
    await import("../../src/home");
    const mark = document.querySelector(".hero-mark") as unknown as { getAnimations: () => { finished: Promise<void> }[]; classList: DOMTokenList };
    let end!: () => void;
    mark.getAnimations = () => [{ finished: new Promise<void>((_, reject) => (end = () => reject(new Error("cancelled")))) }];
    unlock!();
    expect(mark.classList.contains("unlocked")).toBe(true);
    expect(location.href).toBe("http://localhost/");
    end();
    await vi.waitFor(() => expect(location.href).toMatch(/speedrun\/$/));
  });

  it("goes at once when the mark is not moving", async () => {
    const { document, location } = page('<html><head></head><body><div id=home><span class="hero-mark"></span></div></body></html>');
    await import("../../src/home");
    (document.querySelector(".hero-mark") as unknown as { getAnimations: () => [] }).getAnimations = () => [];
    unlock!();
    expect(location.href).toMatch(/speedrun\/$/);
  });
});

describe("the speedrun workbench", () => {
  it("hands over this game's actions and sheet, and warms one edition with the neutral files", async () => {
    page('<html><head><meta name="edition" content="DE"></head><body></body></html>');
    await import("../../src/speedrun-page");
    expect(workbench!.game).toBe("taoot");
    expect(workbench!.warmWhat).toBe("every file of the DE edition");
    expect(String(workbench!.fixtureSheet)).toMatch(/speedrun\/run\.sheet\.txt$/);
    expect(Object.keys(workbench!.actions as object).length).toBeGreaterThan(5);
    const list = await (workbench!.warmup as () => Promise<{ url: string }[]>)();
    const urls = list.map((f) => f.url).join(" ");
    expect(urls).toContain("gamefiles/de/");
    expect(urls).not.toContain("gamefiles/en/");
    expect(urls).toContain("lang.stg");
  });

  it("warms English on a page that names no edition", async () => {
    page("<html><head></head><body></body></html>");
    await import("../../src/speedrun-page");
    expect(workbench!.warmWhat).toBe("every file of the EN edition");
  });
});

describe("the guided tour's doors", () => {
  function tour(mountedCd = "TITANIC2") {
    const session = {
      currentSetName: "b59",
      currentSceneName: () => "scene14",
      currentViewName: () => "view21",
      mountedCd,
      interp: { globals: new Map<string, unknown>([["keynorth", "w"]]) },
      onHotspotClick: null as null | ((h: { paint: string; consumed: boolean }) => void),
      onSetKey: null as null | ((p: { key: string; set: string; scene: string; view: string; consumed: boolean }) => void),
    };
    const { document } = page('<html><body><span id="roamnote">guided tour</span></body></html>', { dbg: { session, viewer: {} } });
    return { session, note: () => document.getElementById("roamnote")!.textContent };
  }
  const press = (key: string) => ({ key, set: "b59", scene: "scene14", view: "view21", consumed: false });

  it("steps through a refused door on a forward key, and says where", async () => {
    const { session, note } = tour();
    await import("../../src/freeroam-page");
    await vi.waitFor(() => expect(session.onSetKey).not.toBeNull());
    expect(note()).toBe("guided tour — every door opens");
    session.onSetKey!(press("leftarrow"));
    session.onSetKey!(press("W"));
    expect(calls).toContain("spot b59 door disc 2");
    await vi.waitFor(() => expect(note()).toBe("through to c73.set"));
    // a view with no door or knock to step through is left alone
    doors.spot = null;
    session.onSetKey!(press("uparrow"));
    expect(calls).toContain("spot b59 knock disc 2");
    doors.spot = { paint: "door" };
    doors.fail = "jammed";
    session.onSetKey!(press("uparrow"));
    await vi.waitFor(() => expect(note()).toBe("step: jammed"));
  });

  it("says what a door click opened, or that it leads nowhere", async () => {
    const { session, note } = tour("TITANIC1");
    await import("../../src/freeroam-page");
    await vi.waitFor(() => expect(session.onHotspotClick).not.toBeNull());
    session.onHotspotClick!({ paint: "radio", consumed: false });
    session.onHotspotClick!({ paint: "door", consumed: false });
    await vi.waitFor(() => expect(note()).toBe("opened D-12 — c73.set"));
    doors.open = { opened: "D-14" };
    session.onHotspotClick!({ paint: "door", consumed: false });
    await vi.waitFor(() => expect(note()).toBe("opened D-14"));
    doors.open = { skipped: "leads-nowhere" };
    session.onHotspotClick!({ paint: "door", consumed: false });
    await vi.waitFor(() => expect(note()).toBe("there is no way through this one"));
    doors.open = { skipped: "open-already" };
    session.onHotspotClick!({ paint: "door", consumed: false });
    await vi.waitFor(() => expect(note()).toBe("guided tour — every door opens"));
    doors.fail = "stuck";
    session.onHotspotClick!({ paint: "door", consumed: false });
    await vi.waitFor(() => expect(note()).toBe("door: stuck"));
  });

  it("publishes the two decisions for the browser suite", async () => {
    const { session } = tour();
    await import("../../src/freeroam-page");
    await vi.waitFor(() => expect(session.onSetKey).not.toBeNull());
    const roam = (globalThis.window as unknown as { roam: { spot: () => unknown; pick: () => unknown } }).roam;
    expect(roam.spot()).toEqual({ paint: "door" });
    expect(roam.pick()).toBe("the doorway");
    doors.spot = null;
    expect(roam.pick()).toBeNull();
    doors.spot = { paint: "door" };
  });
});
