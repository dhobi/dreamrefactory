/**
 * The site as it is PUBLISHED: a static build served from a subdirectory.
 *
 *   npm run test:built -w site
 *
 * Everything here is deployed under `https://www.danielhobi.ch/dreamrefactory/`,
 * never at a host's root, and that is a difference no other test could see. `npm
 * run dev` serves at `/`, `vite preview` serves at `/`, and the whole build uses a
 * relative base so that it works at either — which means a URL that is wrong for a
 * subdirectory is RIGHT everywhere a test used to look.
 *
 * That is how the games menu shipped four broken images. Vite rebases every URL it
 * can see — the module scripts, the stylesheets, the `public/` files the HTML names
 * — and it cannot see one assembled in TypeScript at runtime:
 *
 *     icon.src = `/${mark}`;      // → https://www.danielhobi.ch/mark-taoot.png
 *     icon.src = siteUrl(mark);   // → …/dreamrefactory/mark-taoot.png
 *
 * `site/src/site.ts` exists for exactly this and says so at length; the fix was to
 * use it. This probe is the check that the class of mistake cannot come back: it
 * serves `dist/site` under a `/dreamrefactory/` prefix, the way the host does, and
 * fails on any request the page makes that does not answer 200 — not just the
 * marks, and not just the front page, because the editors sit one level further
 * down and resolve their own depth from `<meta name="site-root">`.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DIST = join(ROOT, "dist/site");
/** the prefix the deployment sits under, and the whole point of this file */
const PREFIX = "/dreamrefactory";
const PORT = 5199;

const fail = (why: string): never => {
  console.error(`FAIL  ${why}`);
  process.exit(1);
};

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

/** build it, because a stale dist/ would test the last fix rather than this one */
function build(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "build:site"], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr?.on("data", (b: Buffer) => (err += b.toString()));
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`build:site exited ${code}\n${err}`))));
  });
}

/**
 * The host, in twenty lines: static files under a PREFIX, and a 404 that is a real
 * 404. No SPA fallback and no directory listing — the deployment has neither, and
 * a fallback would turn every one of these mistakes into a 200 of HTML.
 */
function serve(): Promise<() => void> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith(`${PREFIX}/`) && url.pathname !== PREFIX) {
      res.writeHead(404).end("outside the deployment");
      return;
    }
    let rel = url.pathname.slice(PREFIX.length) || "/";
    if (rel.endsWith("/")) rel += "index.html";
    const file = join(DIST, normalize(rel));
    if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end("not here");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(() => server.close())));
}

const main = async (): Promise<void> => {
  console.log("building the site…");
  await build();
  const stop = await serve();
  const browser = await chromium.launch();

  try {
    for (const [what, path] of [
      ["the front page", `${PREFIX}/`],
      ["an editor page", `${PREFIX}/editors/tracks.html`],
    ] as const) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const missing: string[] = [];
      page.on("response", (r) => {
        // A 404 on a game's `gamefiles.json` is not a mistake: the editors ask
        // every game in the registry for its manifest to find out which rips this
        // deployment carries, and `sources.ts` reads a failure as "not this one".
        // Nothing else is allowed to be missing.
        if (r.status() >= 400 && !r.url().endsWith("/gamefiles.json")) missing.push(`${r.status()} ${r.url()}`);
      });
      page.on("pageerror", (e) => fail(`${what}: page threw ${e.message}`));

      await page.goto(`http://127.0.0.1:${PORT}${path}`);
      await page.waitForTimeout(1200);

      // the games menu is built in TypeScript, so its contents only exist here
      const trigger = page.locator(".gamemenu summary");
      if (!(await trigger.count())) fail(`${what}: no games menu was installed`);
      await trigger.click();
      await page.waitForTimeout(400);

      // The FAILED REQUESTS first, because they are the diagnosis: a mark whose
      // URL 404s is removed from the menu by its own error handler, so counting
      // the icons afterwards reports "0 of 4" and not the URL that was wrong.
      if (missing.length) fail(`${what}: ${missing.length} request(s) failed — ${missing.slice(0, 4).join(" · ")}`);

      const icons = page.locator(".gamemenu .navmenu-list img");
      const drawn = await icons.count();
      if (drawn !== 4) fail(`${what}: the menu drew ${drawn} marks, wanted 4`);
      const broken = await icons.evaluateAll(
        (all) => all.filter((i) => !(i as HTMLImageElement).complete || (i as HTMLImageElement).naturalWidth === 0).length,
      );
      if (broken) {
        const urls = await icons.evaluateAll((all) => all.map((i) => (i as HTMLImageElement).currentSrc));
        fail(`${what}: ${broken} of ${drawn} marks did not load — ${urls.join(" ")}`);
      }
      const names = await page.locator(".gamemenu .navmenu-list a").allInnerTexts();
      console.log(`ok    ${what}: ${drawn} marks loaded under ${PREFIX} — ${names.join(", ")}`);
      await page.close();
    }
  } finally {
    await browser.close();
    stop();
  }

  console.log("PASS  the published build works from a subdirectory, marks and all");
};

void main().catch((e) => fail(String(e)));
