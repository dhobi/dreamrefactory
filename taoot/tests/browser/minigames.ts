/**
 * Do the two minigames boot without the ship?
 *
 *   npx tsx taoot/tests/browser/minigames.ts        (needs a dev server; APP_URL to move it)
 *
 * The one thing reading the scripts could not settle. Both stages LOOK
 * self-contained — `FENCE.STG`'s `openstage ()` seeds every global it reads and
 * `BLKJACK.STG` needs only `firsthand` and a call to `initgame ()` — but whether
 * their props, their `.trk` audio and the dealer's close-up behave with no room
 * behind them is a thing the first boot decides, not the source.
 *
 * Asserts the INTENDED OUTCOME rather than mere difference: the stage is open, it
 * has landed on a flat, its shop is loaded, and the game's own globals have been
 * written by its own scripts. A page that merely stopped erroring passes none of
 * those.
 */
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5299/";
const BOOT_MS = 120_000;

interface Probe {
  stage: string;
  flat: string;
  globals: Record<string, unknown>;
  errors: string[];
  log: string[];
}

const read = `(() => {
  const s = window.dbgMini && window.dbgMini.session;
  if (!s) return null;
  const g = {};
  for (const k of ["fighting","willieside","playerblock","attacktot",
                   "firsthand","playertotal","dealertotal","cardstring","playerphase"]) {
    const v = s.interp.globals.get(k);
    if (v !== undefined) g[k] = typeof v === "string" ? v.slice(0, 24) : v;
  }
  return { stage: String(s.stageName || ""), flat: String(s.currentFlat || ""), globals: g };
})()`;

async function boot(path: string): Promise<Probe> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors: string[] = [];
  const log: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
    else log.push(m.text());
  });
  console.log(`opening ${APP}${path}`);
  await page.goto(`${APP}${path}`);
  await page.waitForSelector("#screen", { timeout: 30_000 });
  // the boot is async (manifest, then the stage file); wait for the stage to be open
  await page
    .waitForFunction(
      `!!(window.dbgMini && window.dbgMini.ready)`,
      null,
      { timeout: BOOT_MS },
    )
    .catch(() => {});
  const got = (await page.evaluate(read)) as Omit<Probe, "errors" | "log"> | null;
  const status = (await page.textContent("#status")) ?? "";
  log.push(`status: ${status.trim()}`);
  await browser.close();
  return { stage: got?.stage ?? "", flat: got?.flat ?? "", globals: got?.globals ?? {}, errors, log };
}

const main = async (): Promise<void> => {
  let bad = 0;
  /**
   * What each one has to be true of, and it is the GAME rather than the page.
   *
   * "A stage opened" passes on a table that deals nothing — the first run of this
   * file reported blackjack booting while its globals were `{}`, because
   * `initgame` had been fired at the stage main instead of the flat that owns it.
   * So each row names something only its own scripts could have written: the
   * fencing bout's opening stance, and a hand of cards.
   */
  const games = [
    {
      path: "minigames/fence/",
      stage: "fence.stg",
      flat: "fence 8",
      /** `openstage ()` sets these five before it draws anything */
      played: (g: Record<string, unknown>) =>
        g.willieside === "right" && g.playerblock === "none" && g.attacktot === 0,
      what: "willie is on guard",
    },
    {
      path: "minigames/blackjack/",
      stage: "blkjack.stg",
      flat: "blkjack",
      /** `dealcards ()` has run: there is a shoe, and the hands are open */
      played: (g: Record<string, unknown>) =>
        typeof g.cardstring === "string" && g.cardstring.length > 4 && g.playertotal !== undefined,
      what: "a hand is dealt",
    },
  ] as const;
  for (const game of games) {
    const { path, stage: want } = game;
    const p = await boot(path);
    const ok = p.stage === want && p.flat === game.flat && game.played(p.globals) && !p.errors.length;
    console.log(`${ok ? "ok  " : "FAIL"} ${path}  (${game.what})`);
    console.log(`       stage="${p.stage}" flat="${p.flat}"`);
    console.log(`       globals: ${JSON.stringify(p.globals)}`);
    for (const l of p.log) console.log(`       ${l}`);
    if (p.errors.length) console.log(`       ERRORS: ${p.errors.slice(0, 3).join(" | ")}`);
    if (!ok) bad++;
  }
  console.log(bad ? `\n${bad} did not boot` : "\nboth booted");
  process.exit(bad ? 1 : 0);
};

void main();
