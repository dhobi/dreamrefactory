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
  /*
   * Press the hold, where the page has one. Blackjack and the fight wait for a
   * trusted gesture before they open their stage, so a probe that never clicks
   * waits out its whole boot timeout on a page that is working perfectly.
   */
  const begin = await page.$("#begin");
  if (begin) await begin.click();
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
 *
 * It is also where all three of #391's faults live, because all three are about
 * the conversation that ends a game rather than the game — so what that screen
 * LOOKS LIKE is measured here as well: whether there is a picture behind the
 * character, where his answers are drawn, and whether ESC gets past them.
 */
async function afterTheGame(path: string): Promise<{
  bevels: string[];
  url: string;
  /** puppetparam slot 10, the answer rows' left margin: 25 booted, 8 not */
  margin: number;
  /** how much of the 512×264 close-up region is black — 100 is nothing behind him */
  blackPct: number;
  /** the same count with the backdrop taken away, which is what the fault looked like */
  blackBare: number;
  /** did ESC end the plaque, as `puppetevent (-1)` in the original does? */
  escTaken: boolean;
}> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  // the fight says who won before it leaves; an undismissed dialog blocks the
  // navigation this function is waiting for
  page.on("dialog", (d) => void d.dismiss());
  await page.goto(`${APP}${path}`);
  await page.waitForSelector("#screen", { timeout: 30_000 });
  const gate = await page.$("#begin");
  if (gate) await gate.click();
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
  const margin = (await page
    .evaluate(`(() => { const s = window.dbgMini && window.dbgMini.session;
      return s ? s.puppetParams.get(10) : -1; })()`)
    .catch(() => -1)) as number;
  /*
   * COUNTED OFF THE CANVAS, not read back off the backdrop field, because the
   * field being set is not the claim — the claim is that there is a picture on
   * screen behind him. The region is the close-up's own 512×264 (PUPPET_ART_H).
   *
   * Measured BOTH WAYS in the one page rather than against a threshold. A
   * stance is a cutout, so a working screen is never near 0% black, and how far
   * from it depends on which of the bout's fifteen flats the last hit left up —
   * 34% on one run and 49% on the next, with the broken build at 73%. A fixed
   * bar between those is a coin toss. So the backdrop is taken away and the same
   * count repeated: the difference between the two IS the backdrop, whichever
   * flat it was, and the picture is put back afterwards.
   */
  const count = `(() => {
      const c = document.getElementById("screen");
      const d = c.getContext("2d").getImageData(0, 0, 512, 264).data;
      let black = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 12 && d[i+1] < 12 && d[i+2] < 12) black++;
      return (black / (d.length / 4)) * 100;
    })()`;
  const blackPct = (await page.evaluate(count).catch(() => 100)) as number;
  await page
    .evaluate(`(() => { const d = window.dbgMini.host.director;
      window.__held = d.puppetBackdrop; d.puppetBackdrop = null; })()`)
    .catch(() => {});
  // two frames, so the composite is rebuilt: PuppetView keys its cache on the
  // backdrop's own pixels/palette references, and null is a new key
  await page.waitForTimeout(200);
  const blackBare = (await page.evaluate(count).catch(() => 100)) as number;
  await page
    .evaluate(`(() => { const d = window.dbgMini.host.director;
      d.puppetBackdrop = window.__held; })()`)
    .catch(() => {});
  await page.waitForTimeout(200);
  /*
   * And the key, pressed as a PLAYER presses it — on the page, not handed to
   * `director.keyDown` — because the fault was never in the engine: it takes ESC
   * and always did (`PuppetCtrl.key`), and the page simply never delivered one.
   * A probe that called the director would have passed on the broken build.
   */
  const before = bevels.length;
  const url = page.url();
  if (before) await page.keyboard.press("Escape");
  await page.waitForTimeout(900);
  /*
   * Taken looks like one of two things, and BOTH have to count. ESC at a plaque
   * is `puppetevent (-1)`, so what happens next is the script's own `case -1`
   * arm: Willie's leaves `willphase` at 202, which is "no", which on a page with
   * no ship to be walked back onto is the chooser — the run that first proved
   * this navigated away mid-probe and read as a crash. Buick's says a parting
   * line first. So: the rows went, or the page did.
   */
  const gone = page.url() !== url;
  const after = (await page
    .evaluate(`(() => { const s = window.dbgMini && window.dbgMini.session;
      return s && s.puppet && s.puppet.bevels ? s.puppet.bevels.length : 0; })()`)
    .catch(() => 0)) as number;
  const escTaken = !!before && (gone || after !== before);
  await browser.close();
  return { bevels, url, margin, blackPct, blackBare, escTaken };
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
  /**
   * ...and the hold HOLDS, which is the whole reason it exists.
   *
   * A start button that does not actually stop the game starting is worse than
   * none: it looks like it is doing the job while blackjack deals behind it and
   * the audio sink is still waiting for its gesture. So this asks the question
   * the other way round — after four seconds, with no click, has anything begun?
   */
  for (const path of ["minigames/blackjack/", "minigames/fight/"]) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.goto(`${APP}${path}`);
    await page.waitForSelector("#begin", { timeout: 30_000 });
    await page.waitForTimeout(4_000);
    const started = await page.evaluate(`!!(window.dbgMini && window.dbgMini.ready)`);
    console.log(`${started ? "FAIL" : "ok  "} ${path} waits for its start button`);
    if (started) bad++;
    await browser.close();
  }

  /**
   * THE PICTURE DOES NOT BREATHE.
   *
   * The status line carries whatever the engine last said, and the column it sits
   * in centres its children — so a long log line widened the column, and the
   * canvas, sized against that column, grew with it. Reported from play at the
   * end of a fencing bout: Willie's first spoken line took the picture from
   * 514 px to 668 and the next, shorter one put it back.
   *
   * So this watches the canvas across a conversation and fails if it ever moves.
   * Asserted on the BOX rather than on the CSS, because the rule that broke it
   * was a `width: min(100%, …)` resolving against a container somebody else had
   * stretched — which reads as correct in the stylesheet and is wrong on screen.
   */
  {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${APP}minigames/fence/`);
    await page.waitForFunction(`!!(window.dbgMini && window.dbgMini.ready)`, null, { timeout: BOOT_MS });
    await page.waitForTimeout(600);
    await page.evaluate(`window.__seen = new Set();
      window.__t = setInterval(() => {
        const r = document.getElementById("screen").getBoundingClientRect();
        window.__seen.add(Math.round(r.width) + "x" + Math.round(r.height));
      }, 100);`);
    // the bout ending is what puts Willie on screen talking
    await page.evaluate(`window.dbgMini.session.stageCtrl.closeStageFile()`);
    await page.waitForTimeout(9_000);
    const sizes = (await page.evaluate(`(clearInterval(window.__t), [...window.__seen])`)) as string[];
    const steady = sizes.length === 1;
    console.log(`${steady ? "ok  " : "FAIL"} fence: the picture holds its size while he talks (${sizes.join(", ")})`);
    if (!steady) bad++;
    await browser.close();
  }

  // the end of a game, which is where a page with no ship has to say something
  const fenceEnd = await afterTheGame("minigames/fence/");
  const fenceAsks = fenceEnd.bevels.some((b) => /fence/i.test(b));
  console.log(`${fenceAsks ? "ok  " : "FAIL"} fence: willie asks for another (${fenceEnd.bevels.join(" / ") || "nothing"})`);
  if (!fenceAsks) bad++;

  /**
   * ...and what that conversation LOOKS like, which is all of #391.
   *
   * Fencing is where all three faults showed, because it is the one game whose
   * closing conversation happens after its stage has gone: no picture behind
   * him (the close-up region measured 72.7% black — a cutout character in a
   * void), his answers drawn at margin 8 and therefore over the screw at the
   * left end of each plaque, and no way past any of it, because the page bound
   * no keys at all.
   *
   * The margin is asserted as the BOOT's 25 rather than as "not 8": it is
   * TAOOT's own number, read out of the BOOTFILE the page holds without running
   * (BootPlan.puppetParams), so a page that stopped reading it would fail here
   * even if something else happened to indent the text.
   */
  /*
   * Fifteen points of picture. Both counts are of the SAME frame with one thing
   * changed, so the gap is deterministic for a given flat and only the flat
   * moves it: measured at 38 points on `fence 8` and 23 on the flat a finished
   * bout usually leaves up (49.2% against 72.7%). Fifteen sits clear of the
   * narrower of those and nowhere near a build with no backdrop at all, where
   * the two counts are the same number.
   */
  const bd = fenceEnd.blackBare - fenceEnd.blackPct > 15;
  console.log(
    `${bd ? "ok  " : "FAIL"} fence: the piste is still behind him ` +
      `(${fenceEnd.blackPct.toFixed(1)}% black, ${fenceEnd.blackBare.toFixed(1)}% with it taken away)`,
  );
  if (!bd) bad++;
  const indented = fenceEnd.margin === 25;
  console.log(`${indented ? "ok  " : "FAIL"} fence: his answers clear the screws (puppetparam 10 = ${fenceEnd.margin})`);
  if (!indented) bad++;
  console.log(`${fenceEnd.escTaken ? "ok  " : "FAIL"} fence: ESC gets past the conversation`);
  if (!fenceEnd.escTaken) bad++;

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
