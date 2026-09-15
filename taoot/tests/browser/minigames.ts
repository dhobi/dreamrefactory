/**
 * Do the three minigames boot without the ship?
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
  painted: boolean;
  puppet: boolean;
  errors: string[];
  log: string[];
}

const read = `(() => {
  const s = window.dbgMini && window.dbgMini.session;
  if (!s) return null;
  const g = {};
  for (const k of ["fighting","willieside","playerblock","attacktot","fencelevel",
                   "vladpower","playerpower","fightover",
                   "firsthand","playertotal","dealertotal","cardstring","playerphase"]) {
    const v = s.interp.globals.get(k);
    if (v !== undefined) g[k] = typeof v === "string" ? v.slice(0, 24) : v;
  }
  const d = window.dbgMini.host.director;
  return {
    stage: String(s.stageName || ""),
    flat: String(s.currentFlat || ""),
    globals: g,
    /**
     * Has anything been DRAWN? The check this file was missing, and the one that
     * matters: a run reported both games booting while blackjack's canvas was
     * black, because the frame loop was started after the shim that deals the
     * cards and the two waited for each other. Globals said a hand was dealt and
     * every pixel was still nobody's.
     */
    painted: !!d.screen.frameValid,
    /* the dealer, whose own playagain() is the rematch offer */
    puppet: !!(s.puppetCtrl && s.puppetCtrl.puppet),
  };
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
  return {
    stage: got?.stage ?? "",
    flat: got?.flat ?? "",
    globals: got?.globals ?? {},
    painted: !!got?.painted,
    puppet: !!got?.puppet,
    errors,
    log,
  };
}

/**
 * ...and what happens when the game is OVER, which is the other half of a page
 * with no ship behind it.
 *
 * Both games end by putting their stage down — blackjack's `closecards ()` when
 * the dealer is told no, fencing's post-bout `transfromflat ()` — so that is what
 * is done to them here rather than playing a bout out: the same call their own
 * scripts make. Fencing must then have Willie ask for another (`SQUASH.SET`'s own
 * loop, run by the page), and blackjack must land back on the chooser, which is
 * the only way out of a game that cannot be walked back onto a ship.
 */
async function afterTheGame(path: string): Promise<{ bevels: string[]; url: string }> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  // the fight says who won before it leaves; an undismissed dialog blocks the
  // navigation this function is waiting for
  page.on("dialog", (d) => void d.dismiss());
  await page.goto(`${APP}${path}`);
  await page.waitForFunction(`!!(window.dbgMini && window.dbgMini.ready)`, null, { timeout: BOOT_MS });
  await page.waitForTimeout(800);
  await page.evaluate(`window.dbgMini.session.stageCtrl.closeStageFile()`);
  await page
    .waitForFunction(
      `(() => { const s = window.dbgMini.session;
         return location.pathname.endsWith("/minigames/") ||
                !!(s.puppet && s.puppet.bevels && s.puppet.bevels.length); })()`,
      null,
      { timeout: 90_000 },
    )
    .catch(() => {});
  const bevels = (await page
    .evaluate(`(() => { const s = window.dbgMini && window.dbgMini.session;
      return s && s.puppet ? s.puppet.bevels.map(b => b.text) : []; })()`)
    .catch(() => [])) as string[];
  const url = page.url();
  await browser.close();
  return { bevels, url };
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
      /**
       * `openstage ()` sets four of these itself; `fencelevel` it does NOT, and
       * aboard the conversation always has — so a page that forgets to seed it
       * fences at 0, below the game's own hardest setting of 5.
       */
      played: (g: Record<string, unknown>) =>
        g.willieside === "right" &&
        g.playerblock === "none" &&
        g.attacktot === 0 &&
        typeof g.fencelevel === "number" &&
        (g.fencelevel as number) >= 5,
      puppet: false,
      what: "willie is on guard, at a difficulty somebody chose",
    },
    {
      path: "minigames/fight/",
      stage: "fight.stg",
      flat: "flat 0",
      /**
       * `openfight ()` seeds all of these itself — both fighters on 512 and the
       * bout live. Vlad is already throwing punches by the time this samples, so
       * the powers are asserted as "on the board" rather than as 512 exactly.
       */
      played: (g: Record<string, unknown>) =>
        typeof g.vladpower === "number" &&
        typeof g.playerpower === "number" &&
        (g.vladpower as number) > 0 &&
        (g.playerpower as number) > 0,
      puppet: false,
      what: "both fighters are up, and it has started",
    },
    {
      path: "minigames/blackjack/",
      stage: "blkjack.stg",
      flat: "blkjack",
      /** `dealcards ()` has run: there is a shoe, and the hands are open */
      played: (g: Record<string, unknown>) =>
        typeof g.cardstring === "string" && g.cardstring.length > 4 && g.playertotal !== undefined,
      /** without him `playagain ()` answers nothing and one hand shuts the table */
      puppet: true,
      what: "a hand is dealt, with a dealer to ask for another",
    },
  ] as const;
  for (const game of games) {
    const { path, stage: want } = game;
    const p = await boot(path);
    const ok =
      p.stage === want &&
      p.flat === game.flat &&
      game.played(p.globals) &&
      p.painted &&
      p.puppet === game.puppet &&
      !p.errors.length;
    console.log(`${ok ? "ok  " : "FAIL"} ${path}  (${game.what})`);
    console.log(`       stage="${p.stage}" flat="${p.flat}" painted=${p.painted} dealer=${p.puppet}`);
    console.log(`       globals: ${JSON.stringify(p.globals)}`);
    for (const l of p.log) console.log(`       ${l}`);
    if (p.errors.length) console.log(`       ERRORS: ${p.errors.slice(0, 3).join(" | ")}`);
    if (!ok) bad++;
  }
  // the end of a game, which is where a page with no ship has to say something
  const fenceEnd = await afterTheGame("minigames/fence/");
  const fenceAsks = fenceEnd.bevels.some((b) => /fence/i.test(b));
  console.log(`${fenceAsks ? "ok  " : "FAIL"} fence: willie asks for another (${fenceEnd.bevels.join(" / ") || "nothing"})`);
  if (!fenceAsks) bad++;

  const fightEnd = await afterTheGame("minigames/fight/");
  const fightLeaves = fightEnd.url.endsWith("/minigames/");
  console.log(`${fightLeaves ? "ok  " : "FAIL"} fight: the bout ends and goes back to the chooser (${fightEnd.url})`);
  if (!fightLeaves) bad++;

  const bjEnd = await afterTheGame("minigames/blackjack/");
  const bjLeaves = bjEnd.url.endsWith("/minigames/");
  console.log(`${bjLeaves ? "ok  " : "FAIL"} blackjack: declining goes back to the chooser (${bjEnd.url})`);
  if (!bjLeaves) bad++;

  console.log(bad ? `\n${bad} check(s) failed` : "\nall three boot, and all three know how to end");
  process.exit(bad ? 1 : 0);
};

void main();
