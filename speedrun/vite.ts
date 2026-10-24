/**
 * A game's speedrun workbench, as Vite sees it: the page, and the sheets beside it.
 *
 *   plugins: [...speedrunPage({ root: HERE, ...WORKBENCH })]
 *
 * ## The page is the play page
 *
 * A workbench drives the real game, not a trimmed copy of it (`page-driver.ts`
 * argues why), so its page is the game's own play page with the panel beside
 * it. Each game used to carry that as a second file, `speedrun/index.html`, and
 * the two copies drifted from their play pages and from each other the way
 * copies do. So there is no second file: {@link workbenchHtml} reads the play
 * page and rearranges it, in dev on every request and in a build as the
 * `speedrun` entry, and what is the GAME's about the result is one small object
 * of facts ({@link WorkbenchPage}) — which of its nodes are the game, which it
 * has no use for, and a few `<meta>`s.
 *
 * ## The sheets
 *
 * The route is a test fixture — `<game>/tests/speedrun/run.sheet.txt`, the route
 * the headless runner drives — and the workbench offers a "Copy the full run"
 * button that starts you from it rather than from an empty sheet. It stays in
 * `tests/` because that is where it is run from, and is copied out at build time
 * rather than moved, which would cost every path that names it. No sheet is a
 * valid state and not an error: the page's fetch fails and the panel offers no
 * button.
 *
 * Node-side, and imported by a game's `vite.config.ts` by its relative path, the
 * way the other Vite plugins in `tools/` are: a config is bundled by Vite before
 * anything resolves a workspace package's TypeScript.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import type { Plugin } from "vite";
// by path, not by package: a Vite config is bundled before workspace packages resolve
import { byCodeUnit } from "../engine/src/runtime/order";

/** where the page asks for the route, relative to the game's own root */
const SHEET_URL = "/speedrun/run.sheet.txt";
/** where the page asks for the contributed sheets, all in one file */
const SHEETS_URL = "/speedrun/sheets.json";
/** where the workbench is served, relative to the game's own root */
const PAGE_DIR = "speedrun";

/** What a game says about its workbench page; everything else is its play page's. */
export interface WorkbenchPage {
  /** the play page, relative to the game's root: `play/index.html`, `index.html` */
  readonly play: string;
  /**
   * The play page's nodes that ARE the game, in order: they become the first
   * column, with the picture-size and mute controls under them. Every element
   * `main.ts` queries has to survive, so these are moved and never copied.
   */
  readonly game: readonly string[];
  /** the play page's elements a workbench has no use for: the settings strip, the title card */
  readonly drop?: readonly string[];
  /** `<meta name>` → content, for the switches `main.ts` reads (`skip-intro`, `autostart`) */
  readonly meta?: Readonly<Record<string, string>>;
  /** classes added to `<body>` */
  readonly bodyClass?: string;
  /**
   * The play page's text before it is rearranged: the game's shared parts
   * filled in (tools/vite-shell.ts), so the top bar and the footer this moves
   * and drops are there to move.
   */
  readonly prepare?: (html: string) => string;
  /** play-page nodes moved to the top of the Details column, under its heading */
  readonly intoDetails?: readonly string[];
  /** the game's speedrun stylesheet, from its root: `/src/speedrun.css` */
  readonly css: string;
  /** the game's workbench entry point, from its root: `/src/speedrun/page.ts` */
  readonly entry: string;
  /** the route, from the game's root: `tests/speedrun/run.sheet.txt` */
  readonly sheet?: string;
  /** where contributed sheets sit, from the game's root, if the game takes contributions */
  readonly sheetsDir?: string;
}

/**
 * How big the picture is drawn, in whole multiples of the game's 512x384
 * framebuffer (`widths.ts`), and the mute (`mute.ts`): the two controls every
 * workbench carries under its picture. The mute multiplies over whatever the
 * game's own volume is (engine/src/runtime/audio.ts), so it leaves no mark on
 * the state a route is timed against.
 */
const UNDER_THE_PICTURE = `
<fieldset class="seg" id="srscale" title="How big the picture is drawn — whole multiples of the game's own 512x384, because a fraction of a pixel is not a pixel">
  <label><input type="radio" name="picture" value="1" /> <span>1x</span></label>
  <label><input type="radio" name="picture" value="2" checked /> <span>2x</span></label>
  <label><input type="radio" name="picture" value="3" /> <span>3x</span></label>
</fieldset>
<label class="srtoggle" id="srmutebox" title="Silence the game — a listener's switch, outside the run: it does not touch the game's own volume settings and does not change how long anything takes">
  <input type="checkbox" id="srmute" />
  <span>Mute</span>
</label>`;

/** how many directories below the game's root a page sits */
const depthOf = (page: string): number => page.split("/").length - 1;

/** a link the browser resolves against the page, and so one a move to another depth breaks */
const isRelative = (url: string): boolean => !/^(?:[a-z][a-z0-9+.-]*:|\/|#|\?)/i.test(url) && url !== "";

type Doc = ReturnType<typeof parseHTML>["document"];

/** an element the game named, or an error that says which and where */
function find(document: Doc, page: WorkbenchPage, id: string): Element {
  const el = document.getElementById(id);
  if (!el) throw new Error(`speedrun page: #${id} is not on ${page.play}`);
  return el;
}

/**
 * The workbench sits one directory down from the game's root, wherever the play
 * page does, so every relative link is re-aimed by the difference.
 */
function reaimLinks(document: Doc, page: WorkbenchPage): void {
  const up = depthOf(`${PAGE_DIR}/index.html`) - depthOf(page.play);
  if (up < 0) throw new Error(`speedrun page: ${page.play} is deeper than the workbench`);
  if (up === 0) return;
  for (const attr of ["href", "src"]) {
    for (const el of document.querySelectorAll(`[${attr}]`)) {
      const url = el.getAttribute(attr)!;
      if (isRelative(url)) el.setAttribute(attr, "../".repeat(up) + url.replace(/^\.\//, ""));
    }
  }
}

/** the head and the top bar: what this page is, and the switches main.ts reads */
function sayWhatThisIs(document: Doc, page: WorkbenchPage): void {
  const meta = (name: string, content: string) => {
    let el = document.head.querySelector(`meta[name="${name}"]`);
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("name", name);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  };
  // unlisted: a route workbench is not a page a search engine should offer
  meta("robots", "noindex, nofollow");
  meta("site-root", "../".repeat(depthOf(`${PAGE_DIR}/index.html`)));
  // the Details column is part of this page and X does not take it away
  meta("details-always", "1");
  for (const [name, content] of Object.entries(page.meta ?? {})) meta(name, content);
  document.title = `Speedrun - ${document.title}`;

  // the top bar names the PAGE here: which of the game's pages this is
  // a fresh span rather than new words in the old one, so no catalogue key the
  // play page's tagline carried puts its words back over these
  const tagline = document.querySelector(".topbar .brand-text > span");
  if (tagline) {
    const span = document.createElement("span");
    span.textContent = "Speedrun workbench";
    tagline.replaceWith(span);
  }
  for (const cls of (page.bodyClass ?? "").split(/\s+/).filter(Boolean)) document.body.classList.add(cls);
}

/** the Details column, opened, with the nodes the game moves into it under its heading */
function detailsColumn(document: Doc, page: WorkbenchPage, layout: Element): void {
  const details = document.getElementById("details");
  if (!details) throw new Error(`speedrun page: ${page.play} has no #details (engine/src/web/details-column.ts)`);
  details.removeAttribute("hidden");
  layout.appendChild(details);
  const heading = details.querySelector("h2");
  for (const id of [...(page.intoDetails ?? [])].reverse()) {
    const node = find(document, page, id);
    node.removeAttribute("hidden");
    if (heading) heading.after(node);
    else details.prepend(node);
  }
}

/**
 * The row: `#srlayout`, holding the game column `#srgame`, the slot the panel is
 * built into (`#srpanelslot`, panel.ts) and the Details column. It is what
 * `panel.css`, `columns.ts` and `widths.ts` lay out, so it is built here once
 * rather than written into each game's page. Put in the document first, where
 * the play page's own row began, so every lookup after it still finds what it
 * moved.
 */
function buildRow(document: Doc, page: WorkbenchPage): void {
  const nodes = page.game.map((id) => find(document, page, id));
  let anchor: Element = nodes[0];
  while (anchor.parentElement && anchor.parentElement !== document.body) anchor = anchor.parentElement;

  const layout = document.createElement("div");
  layout.id = "srlayout";
  document.body.insertBefore(layout, anchor);
  const gameCol = document.createElement("div");
  gameCol.id = "srgame";
  layout.appendChild(gameCol);
  for (const node of nodes) gameCol.appendChild(node);
  gameCol.insertAdjacentHTML("beforeend", UNDER_THE_PICTURE);
  const slot = document.createElement("div");
  slot.id = "srpanelslot";
  layout.appendChild(slot);
  detailsColumn(document, page, layout);
}

/** The workbench page, made from the play page's HTML. */
export function workbenchHtml(playHtml: string, page: WorkbenchPage): string {
  const { document } = parseHTML(playHtml);
  reaimLinks(document, page);
  sayWhatThisIs(document, page);
  buildRow(document, page);
  for (const id of page.drop ?? []) find(document, page, id).remove();

  const css = document.createElement("link");
  css.setAttribute("rel", "stylesheet");
  css.setAttribute("href", page.css);
  document.head.appendChild(css);
  // LAST: the game's main.ts boots the game and publishes `window.dbg`, and
  // this opens the workbench over it, reading the panel's elements at import
  const entry = document.createElement("script");
  entry.setAttribute("type", "module");
  entry.setAttribute("src", page.entry);
  document.body.appendChild(entry);
  // linkedom's toString is its serializer, which its types (the DOM's Document) leave out
  return (document as { toString(): string }).toString();
}

/**
 * The contributed sheets (`<game>/speedrun/sheets/*.sheet.txt`), as
 * `[{ file, text }]` in file order. The text whole: a sheet is a few dozen KB,
 * and the page reads each one's header (its first line is its title) itself,
 * with the same code the CI check uses — speedrun/src/sheet-header.ts.
 */
function contributed(dir: string): string {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".sheet.txt")).sort(byCodeUnit) : [];
  return JSON.stringify(files.map((file) => ({ file, text: readFileSync(join(dir, file), "utf8") })));
}

/** the route and the contributed sheets, served in dev and emitted into a build */
function sheets(src: string | undefined, sheetsDir: string | undefined): Plugin {
  return {
    name: "speedrun-sheets",
    configureServer(server) {
      server.middlewares.use(SHEET_URL, (_req, res, next) => {
        if (!src || !existsSync(src)) return next();
        res.setHeader("content-type", "text/plain; charset=utf-8");
        // it is edited constantly; a cached copy is worse than a fetch
        res.setHeader("cache-control", "no-store");
        res.end(readFileSync(src));
      });
      if (sheetsDir) {
        server.middlewares.use(SHEETS_URL, (_req, res) => {
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.setHeader("cache-control", "no-store");
          res.end(contributed(sheetsDir));
        });
      }
    },
    /**
     * Emitted rather than written, so it lands under the build output wherever
     * that is. `fileName` and not `name`, because these must NOT be
     * content-hashed: the page asks for them by the paths above.
     */
    generateBundle() {
      if (sheetsDir) this.emitFile({ type: "asset", fileName: "speedrun/sheets.json", source: contributed(sheetsDir) });
      if (!src || !existsSync(src)) return; // no sheet, no button — a valid build
      this.emitFile({ type: "asset", fileName: "speedrun/run.sheet.txt", source: readFileSync(src, "utf8") });
    },
  };
}

/**
 * The page: served at `/speedrun/` in dev, and the `speedrun` entry of a build,
 * where it is a module Vite's HTML pipeline reads like any page on disk.
 */
function workbench(root: string, page: WorkbenchPage): Plugin {
  const id = join(root, PAGE_DIR, "index.html");
  const html = (): string => workbenchHtml((page.prepare ?? ((h) => h))(readFileSync(join(root, page.play), "utf8")), page);
  return {
    name: "speedrun-page",
    config(config) {
      const input = config.build?.rollupOptions?.input ?? {};
      if (typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("speedrun page: give rollupOptions.input as an object of named entries");
      }
      return { build: { rollupOptions: { input: { ...input, speedrun: id } } } };
    },
    resolveId: (source) => (source === id ? id : null),
    load: (source) => (source === id ? html() : null),
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        if (path !== `/${PAGE_DIR}/` && path !== `/${PAGE_DIR}/index.html`) return next();
        try {
          const out = await server.transformIndexHtml(req.url!, html(), req.originalUrl);
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.setHeader("cache-control", "no-store");
          res.end(out);
        } catch (e) {
          next(e);
        }
      });
    },
  };
}

/** Everything a game's `vite.config.ts` needs for its workbench: the page and its sheets. */
export function speedrunPage(options: WorkbenchPage & { readonly root: string }): Plugin[] {
  const { root, sheet, sheetsDir } = options;
  return [
    sheets(sheet && join(root, sheet), sheetsDir && join(root, sheetsDir)),
    workbench(root, options),
  ];
}
