/**
 * The workbench page, made out of a play page (speedrun/vite.ts).
 *
 *   npx vitest run speedrun/tests/page.ts
 *
 * Against a small play page written here rather than a game's, so what is held
 * is the making and not one game's markup: the row the panel modules lay out,
 * the game's nodes moved into it (never copied — `main.ts` holds them by id),
 * links re-aimed for the page's depth, and a missing node said out loud. Each
 * game's own page is checked in a browser by its workbench suite.
 */
import { test, expect } from "vitest";
import { parseHTML } from "linkedom";
import { workbenchHtml, type WorkbenchPage } from "../vite";

const PLAY = `<!doctype html>
<html><head><title>Game RE</title><meta name="site-root" content="./" /><link rel="stylesheet" href="/src/theme.css" /></head>
<body class="deep">
  <header class="topbar"><a class="brand" href="./"><span class="brand-text"><b>Game</b><span>The tagline</span></span></a>
    <nav class="topnav"><a href="./collection/">Collection</a><a href="../">dreamREfactory</a><a href="https://example.org/">Out</a></nav></header>
  <div id="stage"><div id="title">card</div><canvas id="screen"></canvas><pre id="log" hidden></pre></div>
  <div id="under"><button id="fsBtn">Fullscreen</button></div>
  <script type="module" src="/src/main.ts"></script>
</body></html>`;

const PAGE: WorkbenchPage = {
  play: "index.html",
  game: ["stage"],
  drop: ["title", "under"],
  bodyClass: "nobrand",
  meta: { autostart: "1" },
  details: `<div id="details" hidden><h2>Details</h2><div id="dbgRows"></div></div>`,
  intoDetails: ["log"],
  css: "/src/speedrun.css",
  entry: "/src/speedrun/page.ts",
};

const make = (page: WorkbenchPage = PAGE) => parseHTML(workbenchHtml(PLAY, page)).document;

test("the row is the game, the panel's slot and the Details column, in that order", () => {
  const doc = make();
  const row = doc.getElementById("srlayout")!;
  expect([...row.children].map((c) => c.id)).toEqual(["srgame", "srpanelslot", "details"]);
  expect([...doc.getElementById("srgame")!.children].map((c) => c.id)).toEqual(["stage", "srscale", "srmutebox"]);
  // up from the first paint, with the boot log moved to the top of it
  expect(doc.getElementById("details")!.hasAttribute("hidden")).toBe(false);
  expect(doc.querySelector("#details > h2 + #log")).toBeTruthy();
  expect(doc.getElementById("log")!.hasAttribute("hidden")).toBe(false);
});

test("the game's nodes are moved and what it has no use for is gone", () => {
  const doc = make();
  expect(doc.querySelectorAll("#screen")).toHaveLength(1);
  expect(doc.querySelectorAll("#log")).toHaveLength(1);
  for (const id of ["title", "under", "fsBtn"]) expect(doc.getElementById(id), id).toBeNull();
  expect(doc.body.classList.contains("nobrand")).toBe(true);
  expect(doc.body.classList.contains("deep")).toBe(true);
});

test("one directory down, so every relative link is re-aimed and nothing else is", () => {
  const doc = make();
  const hrefs = [...doc.querySelectorAll(".topbar a")].map((a) => a.getAttribute("href"));
  expect(hrefs).toEqual(["../", "../collection/", "../../", "https://example.org/"]);
  expect(doc.querySelector('meta[name="site-root"]')!.getAttribute("content")).toBe("../");
  // a root-absolute URL is Vite's to resolve, and stays as written
  expect(doc.querySelector('link[href="/src/theme.css"]')).toBeTruthy();
});

test("a play page already one down keeps its links", () => {
  const doc = make({ ...PAGE, play: "play/index.html" });
  expect(doc.querySelector(".topbar .brand")!.getAttribute("href")).toBe("./");
});

test("the head says what this page is, and the game's entry runs after its main", () => {
  const doc = make();
  const meta = (n: string) => doc.querySelector(`meta[name="${n}"]`)?.getAttribute("content");
  expect(meta("robots")).toBe("noindex, nofollow");
  expect(meta("details-always")).toBe("1");
  expect(meta("autostart")).toBe("1");
  expect(doc.title).toBe("Speedrun - Game RE");
  expect(doc.querySelector(".topbar .brand-text > span")!.textContent).toBe("Speedrun workbench");
  expect(doc.querySelector('link[href="/src/speedrun.css"]')).toBeTruthy();
  const scripts = [...doc.querySelectorAll("script[src]")].map((s) => s.getAttribute("src"));
  expect(scripts).toEqual(["/src/main.ts", "/src/speedrun/page.ts"]);
});

test("a node the game names and the play page lacks is an error, not a quiet gap", () => {
  expect(() => make({ ...PAGE, game: ["stage", "nowhere"] })).toThrow(/#nowhere/);
  expect(() => make({ ...PAGE, details: undefined })).toThrow(/no #details/);
});
