/**
 * The collection page (`src/collection.ts`, taoot/collection/) and the booklet
 * on it (`src/booklet.ts`), in node: the real page parsed by linkedom, with the
 * edition picker standing in for the site's.
 *
 *   npx vitest run --project taoot taoot/tests/auto/collection.ts
 *
 * How the box turns and the leaf curls is CSS, and a browser's question. What
 * is pinned is what the page decides: which scan backs each face (EN's two
 * sides, JA's PNG front and back), which face a drag stopped on — asked of the
 * rotation, not of the nearest Euler pair, so a box tipped over the top shows
 * the top — the keys and buttons round the box, one disc or two, the release's
 * own title, a default edition that is shown but NOT written down (the
 * language would lose to it for good), and the booklet: spreads, its readout,
 * the turn landing early when a second click comes, and no animation for a
 * reader who asked for less motion.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDom, type TestPage } from "../page-dom";

let picked: ((code: string) => void) | null = null;
let remembered: string[] = [];
let marked: string[] = [];
let startEdition = "en";
const preloaded: string[] = [];

vi.mock("@dreamfactory/site/lang-menu", () => ({ installLanguageMenu: async () => {} }));
vi.mock("@dreamfactory/site/play-menu", () => ({ installPlayMenu: async () => {} }));
vi.mock("@dreamfactory/site/version", () => ({ installVersion: () => {} }));
vi.mock("@dreamfactory/site/locales", () => ({ installI18n: async () => {} }));
vi.mock("@dreamfactory/site/site", () => ({ siteUrl: (p: string) => `/site/${p}` }));
vi.mock("../../src/editions", () => ({
  chosenEdition: () => startEdition,
  installEditionPicker: async (_el: unknown, o: { onPick: (c: string) => void }) => void (picked = o.onPick),
  markEdition: (_el: unknown, c: string) => void marked.push(c),
  rememberEdition: (c: string) => void remembered.push(c),
}));

async function openCollection(o: { edition?: string; reduceMotion?: boolean } = {}): Promise<TestPage> {
  vi.resetModules();
  picked = null;
  remembered = [];
  marked = [];
  preloaded.length = 0;
  startEdition = o.edition ?? "en";
  const p = openDom("collection/index.html");
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: !!o.reduceMotion && q.includes("reduce"), addEventListener() {} }));
  vi.stubGlobal(
    "Image",
    class {
      set src(v: string) {
        preloaded.push(v);
      }
    },
  );
  const book = p.el("book");
  (book as unknown as { getBoundingClientRect: () => object }).getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 500 });
  await import("../../src/collection");
  return p;
}

const faces = (p: TestPage): Record<string, string> =>
  Object.fromEntries([...p.document.querySelectorAll("#box .face")].map((f) => [f.className.split(" ")[1], f.querySelector("img")!.getAttribute("src")!]));
const inner = (p: TestPage): HTMLElement => p.document.querySelector("#box .boxInner") as HTMLElement;
const shown = (p: TestPage): string => p.document.querySelector(".faceButtons button.here")?.getAttribute("data-face") ?? "";
const drag = (p: TestPage, dx: number, dy: number): void => {
  const box = p.el("box");
  p.on(box, "pointerdown", { clientX: 100, clientY: 100, pointerId: 1 });
  p.on(box, "pointermove", { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1 });
  p.on(box, "pointerup", { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1 });
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the box", () => {
  it("shows the default edition without writing it down", async () => {
    const p = await openCollection({ edition: "de" });
    expect(p.el("caption").textContent).toBe("Titanic: Wettlauf gegen die Zeit");
    expect(marked).toEqual(["de"]);
    expect(remembered).toEqual([]);
    expect(faces(p).front).toBe("/site/collection/cover/de/front.jpg");
    // and a pick IS written down
    picked!("fr");
    expect(remembered).toEqual(["fr"]);
    expect(p.el("caption").textContent).toBe("Titanic: Une aventure hors du temps");
  });

  it("backs each face with its edition's scan", async () => {
    const p = await openCollection();
    expect(faces(p)).toMatchObject({
      left: "/site/collection/cover/en/sideleft.jpg",
      right: "/site/collection/cover/en/sideright.jpg",
      top: "/site/collection/cover/en/top.jpg",
    });
    picked!("ja");
    expect(faces(p)).toMatchObject({
      front: "/site/collection/cover/ja/front.png",
      back: "/site/collection/cover/ja/back.png",
      left: "/site/collection/cover/ja/side.jpg",
      bottom: "/site/collection/cover/ja/bottom.jpg",
    });
  });

  it("turns to a face from its button, and round the four sides with the arrows", async () => {
    const p = await openCollection();
    expect(shown(p)).toBe("front");
    expect(inner(p).style.transition).toBe("none");
    p.on(p.document.querySelector('.faceButtons button[data-face="top"]')!, "click");
    expect(shown(p)).toBe("top");
    expect(inner(p).style.transform).toBe("rotateX(-90deg) rotateY(0deg)");
    expect(inner(p).style.transition).toContain("transform");
    // a click between the buttons does nothing
    p.on(p.document.querySelector(".faceButtons")!, "click");
    expect(shown(p)).toBe("top");
    p.on(p.el("box"), "keydown", { key: "ArrowRight" });
    expect(shown(p)).toBe("bottom");
    p.on(p.el("box"), "keydown", { key: "ArrowRight" });
    expect(shown(p)).toBe("front");
    p.on(p.el("box"), "keydown", { key: "ArrowLeft" });
    expect(shown(p)).toBe("bottom");
    p.on(p.el("box"), "keydown", { key: "Enter" });
    expect(shown(p)).toBe("bottom");
  });

  it("snaps a drag to the face it stopped showing, the top included", async () => {
    const p = await openCollection();
    drag(p, -180, 0); // a quarter turn left: the right side
    expect(shown(p)).toBe("right");
    drag(p, -180, 0);
    expect(shown(p)).toBe("back");
    // tipped over from the back, -90 x and -180 y: the top, not the back
    drag(p, 0, 180);
    expect(shown(p)).toBe("top");
    drag(p, 0, -360);
    expect(shown(p)).toBe("bottom");
    drag(p, 0, 180);
    drag(p, 180, 0);
    expect(shown(p)).toBe("left");
    // a move with no press, and a second release, do nothing
    p.on(p.el("box"), "pointermove", { clientX: 0, clientY: 0 });
    p.on(p.el("box"), "pointercancel", {});
    expect(shown(p)).toBe("left");
  });

  it("offers a second disc where the edition pressed one", async () => {
    const p = await openCollection();
    const disc = (): string => p.el("discs").querySelector("img")!.getAttribute("src")!;
    expect(disc()).toBe("/site/collection/cd/en/cd1.png");
    const [, two] = [...p.el("discs").querySelectorAll(".discTabs button")];
    p.on(two, "click");
    expect(disc()).toBe("/site/collection/cd/en/cd2.png");
    expect(p.el("discs").querySelector(".discTabs button.here")!.textContent).toBe("2");
    picked!("nl");
    expect(disc()).toBe("/site/collection/cd/nl/cd1.png");
    expect(p.el("discs").querySelector(".discTabs")).toBeNull();
  });
});

describe("the booklet", () => {
  it("is only for the edition whose booklet survives", async () => {
    const p = await openCollection();
    expect(p.el("book").hidden).toBe(true);
    expect(p.el("bookletNone").hidden).toBe(false);
    picked!("de");
    expect(p.el("book").hidden).toBe(false);
    expect(p.el("bookControls").hidden).toBe(false);
    expect(p.el("bookletNone").hidden).toBe(true);
    expect(p.el("bookCount").textContent).toBe("1 / 32");
    expect((p.el("bookPrev") as HTMLButtonElement).disabled).toBe(true);
    // the front alone on the right, and the next spread asked for early
    const [left, right] = [...p.el("book").querySelectorAll(".leaf img")];
    expect(left.hasAttribute("src")).toBe(false);
    expect(right.getAttribute("src")).toBe("/site/collection/manual/de/front.jpg");
    expect(preloaded).toEqual(["/site/collection/manual/de/2.jpg", "/site/collection/manual/de/3.jpg"]);
  });

  it("turns a leaf, and lands it early when the next click comes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const p = await openCollection({ edition: "de" });
    p.click("bookNext");
    expect(p.el("bookCount").textContent).toBe("2–3 / 32");
    expect(p.el("book").querySelectorAll(".turning")).toHaveLength(1);
    expect((p.el("book").querySelector(".turning") as HTMLElement).style.transform).toBe("rotateY(-180deg)");
    // a second click lands the first turn and starts its own
    p.on(p.el("book"), "click", { clientX: 700 });
    expect(p.el("bookCount").textContent).toBe("4–5 / 32");
    expect(p.el("book").querySelectorAll(".turning")).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(p.el("book").querySelectorAll(".turning")).toHaveLength(0);
    // back by the left half, and by the key
    p.on(p.el("book"), "click", { clientX: 100 });
    vi.advanceTimersByTime(500);
    p.on(p.el("book"), "keydown", { key: "ArrowLeft" });
    vi.advanceTimersByTime(500);
    expect(p.el("bookCount").textContent).toBe("1 / 32");
    // and not past the front
    p.click("bookPrev");
    expect(p.el("bookCount").textContent).toBe("1 / 32");
    p.on(p.el("book"), "keydown", { key: "x" });
  });

  it("turns without a leaf for a reader who asked for less motion, to the back cover", async () => {
    const p = await openCollection({ edition: "de", reduceMotion: true });
    for (let i = 0; i < 20; i++) p.on(p.el("book"), "keydown", { key: "ArrowRight" });
    expect(p.el("book").querySelectorAll(".turning")).toHaveLength(0);
    expect(p.el("bookCount").textContent).toBe("32 / 32");
    expect((p.el("bookNext") as HTMLButtonElement).disabled).toBe(true);
    const [left, right] = [...p.el("book").querySelectorAll(".leaf img")];
    expect(left.getAttribute("src")).toBe("/site/collection/manual/de/back.jpg");
    expect(right.hasAttribute("src")).toBe(false);
    // and an edition without one, picked mid-book, takes it away
    picked!("en");
    expect(p.el("book").hidden).toBe(true);
    p.click("bookNext");
  });
});
