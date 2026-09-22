/**
 * Developer mode in a real browser: the flag, the menu and the modifier probes.
 *
 * Run against a live dev server (`npm run dev -w taoot`):
 *
 *   npx tsx taoot/tests/browser/devmode.ts
 *   APP_URL=http://localhost:5303/ npx tsx taoot/tests/browser/devmode.ts
 *   HEADED=1 …                                  # watch it
 *
 * What only a browser can answer here is the wiring, which is most of this page:
 * that the flag survives the boot that writes `false` over it, that a click on a
 * menu item reaches BOOTFILE's own `menuselect`, that the latches reach the
 * builtins through the session, and — the one with a blast radius outside this
 * page — that the PLAY page still answers `optionkey()` with 0.
 */
import { chromium, type Page } from "playwright";
import { clickIntroYes } from "./driver";

const ROOT = process.env.APP_URL ?? "http://localhost:5175/";
const HEADED = !!process.env.HEADED;
const page_ = (p: string): string => new URL(p, ROOT).toString();

let failures = 0;
const check = (what: string, ok: boolean, detail = ""): void => {
  console.log(`${ok ? "ok   " : "FAIL "} ${what}${ok || !detail ? "" : `: ${detail}`}`);
  if (!ok) failures++;
};

/** wait for the game to be up and a room on screen — the devmode page, which
 *  skips the intro and so reaches one on its own */
async function booted(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as any).dbg?.session?.interp, null, { timeout: 90_000 });
  // A viewer, not just the handle: `boot()` is what writes `debugging = false`,
  // and there is no viewer until it has run (see taoot/src/devmode-page.ts). Asking
  // before that reads `undefined` and proves nothing — which is exactly how the
  // play-page check first failed.
  await page.waitForFunction(() => !!(window as any).dbg?.viewer, null, { timeout: 120_000 });
}

const readFlag = (page: Page): Promise<unknown> =>
  page.evaluate(() => (window as any).dbg.session.interp.globals.get("debugging"));

const main = async (): Promise<void> => {
  const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 200 : 0 });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  // --- the page comes up and raises the flag the boot wrote false ---------
  await page.goto(page_("devmode/"));
  await booted(page);

  const flag = await readFlag(page);
  check("`debugging` is raised after the boot that writes it false", Number(flag) === 1, String(flag));

  // --- the menu is TI.EXE's ----------------------------------------------
  const titles = await page.$$eval("#devbar .devmenu > summary", (n) => n.map((e) => e.textContent));
  check("the bar is the executable's four menus", JSON.stringify(titles) === JSON.stringify(["File", "Options", "Sound", "Scripts"]), String(titles));

  const items = await page.$$eval("#devbar .devitems button", (n) =>
    n.map((e) => ({ select: (e as HTMLButtonElement).dataset.select, off: (e as HTMLButtonElement).disabled })),
  );
  check("twenty-four commands", items.length === 24, String(items.length));
  const greyed = items.filter((i) => i.off).map((i) => i.select).sort();
  check(
    "the nine script-editor commands are greyed, and Report with them",
    JSON.stringify(greyed) ===
      JSON.stringify(
        // the nine that open an editor no shipping build has, plus the one
        // BOOTFILE's menuselect has no case for at all
        ["boot script", "button scripts", "flat script", "painting scripts", "post script", "report", "scene script", "server script", "set script", "stage script"].sort(),
      ),
    String(greyed),
  );

  /*
   * --- the canvas keeps its own gestures ---------------------------------
   *
   * Reported from the page: swiping up and down scrolled the page instead of
   * walking. `touch-action: none` on the canvas is what stops the browser
   * claiming a vertical drag (engine/src/web/touch.ts), and this page's
   * stylesheet was written fresh rather than taken from the play page's, so it
   * went missing. Asserted as the COMPUTED value, which is the thing the browser
   * actually acts on — a rule can be present and still be overridden.
   */
  const swipeable = await page.evaluate(
    () => getComputedStyle(document.getElementById("screen")!).touchAction,
  );
  check("the canvas keeps its own vertical drag, so a swipe walks", swipeable === "none", swipeable);

  // --- the latches reach the builtins ------------------------------------
  const probe = (name: string): Promise<number> =>
    page.evaluate((n) => {
      const i = (window as any).dbg.session.interp;
      return Number(i.builtins.get(n)(i, [], { t: "call", name: n, args: [] }, null));
    }, name);

  check("option is not held to begin with", (await probe("optionkey")) === 0);
  await page.click("#devlatches label:nth-of-type(1) input");
  check("the ⌥ latch makes optionkey() answer 1", (await probe("optionkey")) === 1);
  check("...and commandkey() is still 0", (await probe("commandkey")) === 0);
  await page.click("#devlatches label:nth-of-type(2) input");
  check("the ⌘ latch makes commandkey() answer 1", (await probe("commandkey")) === 1);
  await page.click("#devlatches label:nth-of-type(1) input");
  check("unlatching ⌥ puts it back", (await probe("optionkey")) === 0);
  await page.click("#devlatches label:nth-of-type(2) input");

  // ...and a real held key, through the capture-phase listener
  await page.keyboard.down("Alt");
  await page.mouse.click(600, 400);
  check("a real Alt-click raises optionkey() too", (await probe("optionkey")) === 1);
  await page.keyboard.up("Alt");
  await page.mouse.click(600, 400);
  check("...and a plain click lowers it again", (await probe("optionkey")) === 0);

  /*
   * --- the deck map's areas, outlined on the plan ------------------------
   *
   * Driven by opening the map flat directly, which is what the headless twin
   * does: getting there by hand means a save, a walk and a band click, and none
   * of that is what this is about. What only a browser can answer is whether the
   * overlay tracks the canvas and the plan — the rectangles themselves are
   * checked against MAP.STG in taoot/tests/auto/devmode.ts.
   */
  const boxes = async (): Promise<{ kind: string; to: string }[]> =>
    page.$$eval("#devmap .devarea", (n) =>
      n.map((e) => ({
        kind: [...e.classList].filter((c) => c !== "devarea").join(""),
        to: e.querySelector("span")?.textContent ?? "",
      })),
    );

  check("nothing is outlined while the map is shut", (await boxes()).length === 0);
  await page.evaluate(() => (window as any).dbg.session.interp.globals.set("debugging", 1));
  await page.evaluate(() => (window as any).dbg.session.transToFlat("map.stg"));
  await page.waitForFunction(() => document.querySelectorAll("#devmap .devarea").length > 0, null, { timeout: 30_000 });
  const plan = await boxes();
  check("the plan that opens is outlined", plan.length > 0, String(plan.length));
  check(
    "...in the two kinds, debug ones among them",
    plan.some((b) => b.kind === "debug") && plan.some((b) => b.kind === "live"),
    JSON.stringify(plan),
  );
  // the box follows the canvas rather than the document: same viewport rect
  const aligned = await page.evaluate(() => {
    const c = document.getElementById("screen")!.getBoundingClientRect();
    const o = document.getElementById("devmap")!.getBoundingClientRect();
    return Math.abs(c.left - o.left) < 1 && Math.abs(c.top - o.top) < 1 && Math.abs(c.width - o.width) < 1;
  });
  check("the overlay sits exactly on the picture", aligned);
  // ...and the toggle takes it away without touching the game
  await page.click('#devlatches label:nth-of-type(4) input');
  await page.waitForTimeout(200);
  const hidden = await page.evaluate(() => getComputedStyle(document.getElementById("devmap")!).display);
  check("the toggle takes it off", hidden === "none", hidden);
  await page.click('#devlatches label:nth-of-type(4) input');
  await page.waitForTimeout(200);
  // and it never takes a click — the engine's hittest still owns the canvas
  const inert = await page.evaluate(() => getComputedStyle(document.getElementById("devmap")!).pointerEvents);
  check("it takes no clicks, so the engine's hittest still owns the canvas", inert === "none", inert);
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/devmode-map.png` });

  // --- a menu item reaches BOOTFILE's own menuselect ----------------------
  // "Debug On/Off" is the one command whose effect is visible in a global: the
  // script sets `debugging = false` and the bar follows it down.
  await page.click("#devbar .devmenu:nth-of-type(2) > summary");
  await page.click('#devbar button[data-select="debug on/off"]');
  await page.waitForTimeout(400);
  check("Options ▸ Debug On/Off runs the script that turns the flag off", Number(await readFlag(page)) === 0, String(await readFlag(page)));
  const off = (await page.textContent("#devstatus"))?.trim() ?? "";
  // the readout carries a ○ / ● indicator, so match the words rather than the
  // whole string — the glyph is the affordance and is free to change
  check("...and the bar says so", /^\u25cb .*debugging off$/.test(off), off);

  /*
   * ...and it goes back ON from the same command, which the script cannot do.
   *
   * `menuselect`'s case is `if debugging → debugging = false`: the disc's
   * command only ever turned developer mode off, and the way back was to
   * relaunch. Reported from the page as "once I switch debug off, I can't enable
   * it" — a command labelled On/Off that does nothing every second press. The
   * page supplies the missing half, so the item and its accelerator both toggle.
   */
  await page.click("#devbar .devmenu:nth-of-type(2) > summary");
  await page.click('#devbar button[data-select="debug on/off"]');
  await page.waitForTimeout(600);
  check("Options ▸ Debug On/Off turns it back on as well", Number(await readFlag(page)) === 1, String(await readFlag(page)));

  // the accelerator is the same path: Ctrl+D, from the label's own hint
  await page.keyboard.press("Control+d");
  await page.waitForTimeout(500);
  check("Ctrl+D turns it off", Number(await readFlag(page)) === 0, String(await readFlag(page)));
  await page.keyboard.press("Control+d");
  await page.waitForTimeout(500);
  check("...and Ctrl+D turns it back on", Number(await readFlag(page)) === 1, String(await readFlag(page)));
  // leave it down for the load check below, which needs something to restore
  await page.keyboard.press("Control+d");
  await page.waitForTimeout(500);

  /*
   * --- the scrollback stays inside its column ------------------------------
   *
   * Reported from the page: "scriptlog does not seem to scroll and makes the
   * page higher and higher". The shell had `min-height` where it needed
   * `height`, so it was free to grow and the log's own `overflow: auto` never
   * had a definite height to scroll within — every line the game printed made
   * the document taller and walked the prompt off the bottom of the window.
   *
   * Measured rather than asserted about the CSS: what matters is that the
   * DOCUMENT does not grow, which is the thing a reader sees.
   */
  const pageHeight = (): Promise<number> =>
    page.evaluate(() => document.documentElement.scrollHeight);
  const wasTall = await pageHeight();
  await page.evaluate(() => {
    for (let i = 0; i < 400; i++) (window as any).dbg.session.onLog("probe line " + i);
  });
  await page.waitForTimeout(600);
  const nowTall = await pageHeight();
  check("400 log lines do not make the page taller", nowTall === wasTall, `${wasTall} -> ${nowTall}`);
  const log = await page.evaluate(() => {
    const el = document.getElementById("scriptlog")!;
    const prompt = document.getElementById("devconsole")!.getBoundingClientRect();
    return {
      scrolls: el.scrollHeight > el.clientHeight + 2,
      fromBottom: el.scrollHeight - el.clientHeight - el.scrollTop,
      promptVisible: prompt.bottom <= window.innerHeight + 1,
    };
  });
  check("...the scrollback scrolls inside its column", log.scrolls);
  check("...it follows the newest line", log.fromBottom < 4, String(log.fromBottom));
  check("...and the prompt stays on screen", log.promptVisible);

  /*
   * --- the console -------------------------------------------------------
   *
   * The runner is covered headlessly (taoot/tests/auto/devmode.ts). What only a
   * browser answers is the wiring: that the row submits, that a fault is shown
   * rather than thrown away, and that the history recalls.
   */
  const typeLine = async (line: string): Promise<string> => {
    await page.fill("#devconsole input", line);
    await page.press("#devconsole input", "Enter");
    await page.waitForFunction(
      () => (document.getElementById("devanswer")?.textContent ?? "\u2026") !== "\u2026",
      null,
      { timeout: 15_000 },
    );
    return (await page.textContent("#devanswer"))?.trim() ?? "";
  };

  const arith = await typeLine("return (2 + 3 * 4)");
  check("a console line runs and its value comes back", arith === "14", arith);
  const setName = await typeLine("return (currentset ())");
  check("...reading the live session, not a constant", /^"[a-z0-9]+"$/.test(setName), setName);
  await typeLine("mission = 7");
  const mission = await page.evaluate(() => (window as any).dbg.session.interp.globals.get("mission"));
  check("a global it writes is the global the game reads", Number(mission) === 7, String(mission));
  const faulted = await typeLine("code code code");
  const faultClass = await page.getAttribute("#devanswer", "class");
  check("a bad line is shown, not thrown", faulted.length > 0 && faultClass === "bad", `${faulted} [${faultClass}]`);
  check("the prompt clears on submit", (await page.inputValue("#devconsole input")) === "");
  await page.press("#devconsole input", "ArrowUp");
  const recalled = await page.inputValue("#devconsole input");
  check("\u2191 recalls the last line", recalled === "code code code", recalled);
  await page.fill("#devconsole input", "");

  /*
   * --- the placement latch -----------------------------------------------
   *
   * `setloc` is the second global and the page's third latch. Only that it is
   * raised and lowered is checked here: what it DOES is BOOTFILE's global
   * mousedown handing a click to `move3dactor`, which is the game's behaviour.
   */
  const setloc = (): Promise<unknown> =>
    page.evaluate(() => (window as any).dbg.session.interp.globals.get("setloc"));
  check("the placement mode is down to begin with", Number(await setloc()) === 0, String(await setloc()));
  await page.click("#devlatches label:nth-of-type(3) input");
  check("the place latch raises `setloc`", Number(await setloc()) === 1, String(await setloc()));
  await page.click("#devlatches label:nth-of-type(3) input");
  check("...and unlatching puts it down", Number(await setloc()) === 0, String(await setloc()));

  /*
   * --- and it survives a saved game --------------------------------------
   *
   * `debugging` is one of the 68 numeric globals every `.ti` carries, stored as
   * 0 in all of them, so `loadGame` puts it straight back down. Reported from
   * the page. The headless twin pins that the load really does lower it
   * (taoot/tests/auto/devmode.ts); what this pins is that the PAGE notices and
   * puts it back, which is the whole of the fix.
   */
  await page.evaluate(() => (window as any).dbg.session.transFromFlat());
  await page.waitForTimeout(300);
  // Intent first, and it has to be through the PAGE's switch rather than by
  // writing the global: the Ctrl+D check above turned developer mode off through
  // the menu, so the page's intent is off too, and it will rightly decline to put
  // a flag back that it was asked to take down. Writing the global directly here
  // left the page still intending "off" and the check failed for the wrong reason.
  await page.click("#devstatus");
  await page.waitForTimeout(300);
  check("...and back on again", Number(await readFlag(page)) === 1, String(await readFlag(page)));
  // a load, faked at the one line that matters: the loader writes the file's own
  // value over the global, and nothing else about a load is this page's business
  await page.evaluate(() => (window as any).dbg.session.interp.globals.set("debugging", 0));
  await page.waitForFunction(
    () => Number((window as any).dbg.session.interp.globals.get("debugging")) === 1,
    null,
    { timeout: 5_000 },
  ).catch(() => {});
  check("the page puts the flag back when a load takes it down", Number(await readFlag(page)) === 1, String(await readFlag(page)));

  // ...but it must not fight the menu, which is SUPPOSED to turn it off. This is
  // the whole reason the page holds INTENT rather than just pinning the flag at 1.
  await page.click("#devbar .devmenu:nth-of-type(2) > summary");
  await page.click('#devbar button[data-select="debug on/off"]');
  await page.waitForTimeout(700);
  check("...and does not fight Options ▸ Debug On/Off", Number(await readFlag(page)) === 0, String(await readFlag(page)));
  // and the readout is a switch too — the indicator people actually press
  await page.click("#devstatus");
  await page.waitForTimeout(300);
  check("the readout is a switch as well", Number(await readFlag(page)) === 1, String(await readFlag(page)));
  const shown = (await page.textContent("#devstatus"))?.trim() ?? "";
  check("...and shows its state as an indicator", shown.startsWith("\u25cf"), shown);

  // --- the play page is untouched -----------------------------------------
  // The whole point of the two-line engine change is that it costs the play page
  // nothing, and "nothing" is only provable on the play page itself.
  // 1400x1300, which is the size the playthrough and endgame suites use and not
  // a taste: `clickIntroYes` works out a VIEWPORT coordinate from the canvas's
  // bounding box, and on a 900x700 window the play page's canvas hangs below the
  // fold — so the click was computed correctly, landed outside the visible area,
  // and the intro simply never cleared.
  const play = await browser.newPage({ viewport: { width: 1400, height: 1300 } });
  play.on("pageerror", (e) => console.log("[play pageerror]", e.message));
  await play.goto(page_("play/?edition=en"));
  // ...which, unlike this page, carries no `skip-intro`: the Nightdive film runs
  // with NO VIEWER AT ALL — the one film in the game that does — and parks on its
  // ownership question, and `coldBoot` does not start until that is answered. So
  // this has to be driven, exactly as the playthrough suite drives it: Escape
  // past the film so the run does not pay for it, then the real click on YES.
  // (Waiting for a viewer without answering it is a 120 s timeout, which is how
  // this check first failed.)
  await play.waitForFunction("!!window.dbg && (!!window.dbg.intro || !!window.dbg.viewer)", null, { timeout: 60_000 });
  if (await play.evaluate(() => !!(window as any).dbg.intro)) {
    await play.keyboard.press("Escape");
    await play.waitForFunction("!!window.dbg.intro && window.dbg.intro.regions().length > 0", null, { timeout: 60_000 });
    await clickIntroYes(play);
    await play.waitForFunction("!window.dbg.intro", null, { timeout: 60_000 });
  }
  // and then the flag, which `boot()` writes on its fourteenth line — its being
  // DEFINED is the signal that the boot has run, and it needs no viewer, which
  // the play page does not reach until someone presses GAME at the boot menu
  await play.waitForFunction(
    () => (window as any).dbg?.session?.interp?.globals?.get("debugging") !== undefined,
    null,
    { timeout: 90_000 },
  );
  const playFlag = await play.evaluate(() => (window as any).dbg.session.interp.globals.get("debugging"));
  check("the play page leaves `debugging` as the disc has it", Number(playFlag) === 0, String(playFlag));
  const playOpt = await play.evaluate(() => {
    const i = (window as any).dbg.session.interp;
    return Number(i.builtins.get("optionkey")(i, [], { t: "call", name: "optionkey", args: [] }, null));
  });
  check("...and optionkey() answers 0 there, as it always did", playOpt === 0, String(playOpt));
  // including with the key actually held, which is the regression that matters
  await play.keyboard.down("Alt");
  await play.mouse.click(400, 300);
  const playHeld = await play.evaluate(() => {
    const i = (window as any).dbg.session.interp;
    return Number(i.builtins.get("optionkey")(i, [], { t: "call", name: "optionkey", args: [] }, null));
  });
  await play.keyboard.up("Alt");
  check("...even with Alt held over the canvas", playHeld === 0, String(playHeld));

  await browser.close();
  console.log(failures ? `\nFAIL  ${failures} check(s)` : "\nPASS  the debug build is back: the flag, TI.EXE's menu, and two probes the play page still answers 0");
  process.exit(failures ? 1 : 0);
};

void main();
