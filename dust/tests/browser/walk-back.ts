/**
 * Does a character walk BACK after a conversation, in a real browser?
 *
 *   npm run dev -w dust
 *   npx tsx dust/tests/browser/walk-back.ts
 *
 * The headless test beside this one (dust/tests/conversation.ts) pins the
 * primitive #289 turned on: what `walkdest` answers about an actor who is
 * turning. What it cannot run is the sentence the report is made of — "I spoke
 * with the mayor's wife and she moved to meet me. After the conversation, she
 * didn't move back" — because that is GANG.CST's `walktopuppet`, and every one of
 * its four waits is `while iswalk (who) forceupdate () endwhile`. A headless
 * session has no frame source to forceupdate against, so the whole routine is
 * unreachable there; here it runs the way a player runs it.
 *
 * The shape of the run is the reporter's: stand in the guest-room doorway on
 * night 1, put the wife on her star, START HER TURNING (which is what her idle
 * does whenever you are within `hotdist`, and the state the bug hides in), click
 * her, sit through the conversation, and then ask the two questions a player
 * asks — is she out of my way, and does she still know where she stands?
 */
import { chromium, type Browser, type Page } from "playwright";

/** Dust's own dev port (5175 Titanic, 5176 Dust, 5177 Timelapse) */
const APP_URL = process.env.APP_URL ?? "http://localhost:5176/";
/** written when a check fails, so a failure is something you can look at */
const SHOT = process.env.SHOT ?? "out/walk-back.png";

const fail: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail.push(name);
};

interface Wife {
  star: string;
  x: number;
  y: number;
  deg: number;
  pose: string;
  walking: boolean;
  /** her idle loop, which is what stops when a walk home never arrives */
  looping: boolean;
}

const wife = async (page: Page): Promise<Wife> =>
  page.evaluate(() => {
    const s = (window as unknown as { dbg: { session: {
      actorRuntime: { get: (n: string) => { starName: string; worldX: number; worldY: number;
        deg: number; poseName: string } };
      scheduler: { walks: Map<string, unknown>; loops: { kind: string; name: string }[] };
    } } }).dbg.session;
    const a = s.actorRuntime.get("mwife");
    return {
      star: a.starName,
      x: a.worldX,
      y: a.worldY,
      deg: Number(a.deg),
      pose: a.poseName,
      walking: s.scheduler.walks.has("mwife"),
      looping: s.scheduler.loops.some((l) => l.kind === "actor" && l.name === "mwife"),
    };
  });

const main = async (): Promise<void> => {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", (e) => console.log("[pageerror]", e.message));
    await page.goto(APP_URL);
    await page.locator("#start").waitFor({ state: "visible", timeout: 120000 });
    await page.locator("#start").click();
    await page.waitForFunction(() => !!(window as unknown as { dbg?: { viewer?: unknown } }).dbg?.viewer, null, {
      timeout: 300000,
    });

    // NIGHT 1, upstairs at the Mayor's, with the wife where the puppet leaves her
    // (`setupactor("upstairs")` is `actorstar (me, "mayupper.mwife")`). Nothing
    // here places her by hand: the cast does it, through its own handler.
    await page.evaluate(async () => {
      const d = (window as unknown as { dbg: { host: { loadServerSet: (s: string) => Promise<void> };
        session: { interp: { globals: Map<string, unknown> };
          openSetFile: (f: string, scene?: string, view?: string) => Promise<void>;
          sendEvent: (c: string, t: string, h: string, a: unknown[], w: string) => Promise<unknown> } } }).dbg;
      for (const [k, v] of [["day", 1], ["clock", 3], ["phase", 6], ["mwifephase", 12]] as [string, number][]) {
        d.session.interp.globals.set(k, v);
      }
      await d.host.loadServerSet("mayupper.set");
      // the doorway the report is written from, and it has to be THIS standpoint:
      // `walktopuppet` refuses a conversation across a diagonal (`if thex != 0 &
      // they != 0 exitcode`), so the player must share a row or a column of the
      // grid with whoever they are talking to. Scene B1 is the cell directly
      // north of her star, facing her.
      await d.session.openSetFile("mayupper.set", "scene b1", "south");
      await d.session.sendEvent("sendtoactor", "mwife", "setupactor", ["upstairs"], "walk-back");
    });
    await page.waitForTimeout(2500);
    const placed = await wife(page);
    const room = await page.evaluate(() => {
      const s = (window as unknown as { dbg: { session: { currentSetFile: string;
        currentSceneName: () => string; currentViewName: () => string } } }).dbg.session;
      return `${s.currentSetFile} ${s.currentSceneName()} · ${s.currentViewName()}`;
    });
    console.log(`  ${room}; she is on "${placed.star}" at ${placed.x},${placed.y}`);
    check("she starts on her own star", placed.star === "mayupper.mwife", `star=${placed.star}`);
    const home = { x: placed.x, y: placed.y };

    // THE STATE THE BUG HIDES IN: mid-turn. Her idle faces the camera every 21
    // service steps while the player is close, so this is where a click lands
    // whenever you have just walked up to her.
    const talk = await page.evaluate((deg: number) => {
      const s = (window as unknown as { dbg: { session: {
        interp: { builtins: Map<string, (i: unknown, a: unknown[]) => unknown>;
          runHandler: (inst: unknown, h: string, a: unknown[], f: unknown) => Promise<unknown> };
        castScripts: Map<string, unknown>;
      } } }).dbg.session;
      s.interp.builtins.get("turntodeg")!(s.interp, ["mwife", deg]);
      const turning = s.interp.builtins.get("iswalk")!(s.interp, ["mwife"]);
      const dest = s.interp.builtins.get("walkdest")!(s.interp, ["mwife"]);
      // the click, exactly as SetViewer.clickActor dispatches it — not awaited,
      // because the conversation is what happens next
      (window as unknown as { __talk: Promise<string> }).__talk = s.interp
        .runHandler(s.castScripts.get("mwife"), "mousedown", ["mwife"], {
          me: "mwife", target: "mwife",
        })
        .then(() => "returned")
        .catch((e: Error) => `threw: ${e.message}`);
      return {
        turning, dest,
        near: {
          player: [
            s.interp.builtins.get("playerxyz")!(s.interp, [1]),
            s.interp.builtins.get("playerxyz")!(s.interp, [2]),
          ],
          her: [
            s.interp.builtins.get("actorxyz")!(s.interp, ["mwife", 1]),
            s.interp.builtins.get("actorxyz")!(s.interp, ["mwife", 2]),
          ],
          cast: !!s.castScripts.get("mwife"),
        },
      };
    }, (placed.deg + 96) & 0xff);
    console.log(`  ${JSON.stringify(talk.near)}`);
    check("a turn is a walk", talk.turning === 1, `iswalk=${talk.turning}`);
    check(
      "and mid-turn she is still bound for her own star (#289)",
      talk.dest === "mayupper.mwife",
      `walkdest=${JSON.stringify(talk.dest)}`,
    );

    // she walks over, the conversation opens, one line is spoken, it closes
    const opened = await (async () => {
      for (let i = 0; i < 120; i++) {
        if (await page.evaluate(
          () => !!(window as unknown as { dbg: { session: { puppet?: unknown } } }).dbg.session.puppet,
        )) return true;
        await page.waitForTimeout(500);
      }
      return false;
    })();
    if (!opened) {
      const w = await wife(page);
      const said = await page.evaluate(() => (window as unknown as {
        dbg: { log: () => { lines: string[] } } }).dbg.log().lines.slice(-25));
      console.log(`  she is at ${w.x},${w.y} on "${w.star}" walking=${w.walking}`);
      console.log(`  mousedown: ${await page.evaluate(
        () => (window as unknown as { __talk: Promise<string> }).__talk)}`);
      console.log(`  the engine said:\n    ${said.join("\n    ")}`);
    }
    check("the conversation opens", opened);
    if (!opened) return;
    const met = await wife(page);
    console.log(`  the conversation opens with her at ${met.x},${met.y} on "${met.star}"`);
    check("she came to meet the player", met.x !== home.x || met.y !== home.y, `${met.x},${met.y}`);
    // and get out of it: a click on the art region skips the line the way a
    // player does (the wife's night-1 line is a single puppetspeak)
    for (let i = 0; i < 40; i++) {
      const open = await page.evaluate(
        () => !!(window as unknown as { dbg: { session: { puppet?: unknown } } }).dbg.session.puppet,
      );
      if (!open) break;
      await page.locator("#screen").click({ position: { x: 400, y: 200 } });
      await page.waitForTimeout(500);
    }
    check(
      "the conversation ends",
      !(await page.evaluate(
        () => !!(window as unknown as { dbg: { session: { puppet?: unknown } } }).dbg.session.puppet,
      )),
    );

    // THE REPORT: does she go back?
    for (let i = 0; i < 60; i++) {
      const w = await wife(page);
      if (!w.walking && w.x === home.x && w.y === home.y) break;
      await page.waitForTimeout(500);
    }
    const after = await wife(page);
    console.log(`  afterwards: "${after.star}" at ${after.x},${after.y} pose=${after.pose}` +
      ` walking=${after.walking} idle=${after.looping}`);
    check(
      "she walks back to where she was standing",
      after.x === home.x && after.y === home.y,
      `${after.x},${after.y} (home ${home.x},${home.y})`,
    );
    check(
      "...and lands knowing her own star, so her idle can re-arm",
      after.star === "mayupper.mwife",
      `star=${after.star}`,
    );
    check("...which it does", after.looping, `loops=${after.looping}`);
  } finally {
    if (fail.length && browser) {
      const page = browser.contexts()[0]?.pages()[0];
      if (page) await page.locator("#screen").screenshot({ path: SHOT }).catch(() => undefined);
      console.log(`  a picture of the failure: ${SHOT}`);
    }
    await browser?.close();
  }
  console.log(fail.length ? `\n${fail.length} check(s) failed` : "\nall checks passed");
  if (fail.length) process.exitCode = 1;
};

void main();
