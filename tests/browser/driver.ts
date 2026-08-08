/**
 * A {@link NavDriver} over a real browser page.
 *
 * The twin of tests/playthrough/driver.ts, and the reason a route can be watched
 * rather than only asserted. Every gesture here is a genuine Playwright mouse or
 * keyboard event delivered to the canvas, so a route replayed through this driver
 * exercises main.ts's event wiring, the canvas coordinate mapping, rAF pacing and
 * the live disc switch — none of which the headless twin has at all.
 *
 * ## The mirror
 *
 * The engine is in the page and this is Node, so every read is a round trip and
 * therefore asynchronous — while the route's questions ("am I carrying the
 * watch?") are synchronous by design (see tests/playthrough/story.ts). So the
 * driver keeps a MIRROR of exactly the state a route may ask about, refreshed in
 * one `page.evaluate` after every gesture and on every turn of every poll loop.
 * A getter is therefore as fresh as the last gesture, which is the only moment a
 * route reads anything.
 *
 * ## Where the plan comes from
 *
 * `set()` has to hand the planner a whole parsed SET — turn rings, roads, view
 * tables — which is far too much to ship over the wire every gesture. It is read
 * from the same `gamefiles/` tree the page is being served from and parsed here
 * instead. The bytes are identical by construction; only the gestures cross into
 * the browser.
 */
import type { Page } from "playwright";
import { readSetFile, type SetFile } from "../../src/df/set";
import { gamefiles, gamefilesRoot } from "../../tools/gamefiles";
import { DEFAULT_LANGUAGE } from "../../src/languages";
import type { NavDriver } from "../playthrough/nav/navigator";
import type { Standpoint } from "../playthrough/nav/setpath";
import { aimSource } from "../playthrough/nav/aim";

/** what a route may ask about, sampled page-side in one round trip */
interface Mirror {
  setFile: string;
  disc: 1 | 2;
  sceneIdx: number;
  viewIdx: number;
  globals: Record<string, string | number>;
  props: Record<string, { visible: boolean; deg: number; value: number; owner: string; state: string }>;
  /** each character's `actorowner` — see Story.actorOwner */
  actors: Record<string, string>;
  /** each character's ground position + visibility — see NavDriver.actorSpot */
  actorSpots: Record<string, { x: number; z: number; visible: boolean }>;
  flat: string | null;
  /** the playing track — a late-landing consequence a route may need to wait on */
  theme: string;
  conversing: boolean;
  awaitingChoice: boolean;
  choices: { text: string; id: number }[];
  movieRegions: { type: number; target: string; event: string; x0: number; y0: number; x1: number; y1: number }[];
  /** a movie owns the screen — animating OR parked on a region frame */
  moviePlaying: boolean;
  /** which clip, so an ESC can tell "gone" from "the next one already started" */
  movieFile: string | null;
  scriptBusy: boolean;
  quiescent: boolean;
}

/**
 * Page-side state sample. Deliberately one evaluate: two would be two different
 * moments, and a route comparing them would be comparing different games.
 */
const SAMPLE = `(() => {
  const dbg = window.dbg;
  const s = dbg.session, v = dbg.viewer;
  const props = {};
  for (const shop of s.propRuntime.shops.keys()) {
    for (const g of s.propRuntime.shops.get(shop).shp.groups) {
      const p = s.propRuntime.get(g.name);
      if (p) props[g.name.toLowerCase()] = {
        visible: !!p.visible, deg: Number(p.deg) || 0, value: Number(p.value) || 0,
        owner: String(p.owner ?? ""), state: String(p.stateName ?? ""),
      };
    }
  }
  const actors = {};
  const actorSpots = {};
  for (const [name, a] of s.actorRuntime.actors) {
    const key = String(name).toLowerCase();
    actors[key] = String(a.owner ?? "");
    actorSpots[key] = { x: Number(a.worldX) || 0, z: Number(a.worldZ) || 0, visible: !!a.visible };
  }
  return {
    actors,
    actorSpots,
    setFile: String(s.currentSetFile || s.currentSetName || "").toLowerCase(),
    // which CD's copy of a both-discs room is in play (host.files.activeDisc,
    // set by BOOTFILE's setpath(disk)) — the planner has to read the same one
    disc: (dbg.host.files && dbg.host.files.activeDisc && dbg.host.files.activeDisc()) || 1,
    sceneIdx: v ? v.sceneIdx : 0,
    viewIdx: v ? v.viewIdx : 0,
    globals: Object.fromEntries(s.interp.globals),
    props,
    flat: v && !s.viewShowing && s.currentFlat ? s.currentFlat : null,
    theme: s.currentThemeName || "",
    conversing: !!(v && v.conversing),
    awaitingChoice: !!(v && v.awaitingChoice),
    choices: v ? v.choices : [],
    movieRegions: v ? v.movieRegions.map((r) => ({
      type: r.type, target: r.target, event: r.event, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1,
    })) : [],
    moviePlaying: !!(v && v.moviePlaying),
    movieFile: (v && v.movieFile) || null,
    scriptBusy: !!s.scriptBusy,
    quiescent: !!(v && v.quiescent),
  };
})()`;

/**
 * Aiming, page-side, using the SAME functions the headless driver uses.
 *
 * nav/aim.ts has no imports and closes over nothing, so its source can be handed
 * to the page and called there — which it must be, since the sweep is tens of
 * thousands of hit tests and one round trip each is not a thing that finishes.
 * Shipping the source instead of writing a second sweep is not tidiness: whether
 * a thing is clickable from a standpoint decides whether `hunt` walks on, so two
 * sweeps on different grids explore a room differently and end up facing
 * different ways. That is a divergence with no cause in the browser at all, and
 * this suite exists to say "the browser did something different" — so it must not
 * be the thing doing something different.
 *
 * The Aim adapter is written here in page terms: the engine's own hittest, the
 * click path's propUnder, the flat check and the current view's hotspot table.
 */
const AIM_ADAPTER = `(() => {
  const dbg = window.dbg, s = dbg.session, v = dbg.viewer;
  return {
    hitTest: (x, y) => s.hitTestAt(x, y),
    propUnder: (x, y) => { const p = v.propUnder(x, y); return p ? p.group.name : null; },
    inFlat: !s.viewShowing && !!s.stageScript,
    hotspot: (name) => {
      const obj = v.scene.views[v.viewIdx].objects.find(
        (o) => (o.identifier || "").toLowerCase() === name.toLowerCase());
      return obj ? { x0: obj.startRegionX, y0: obj.startRegionY, x1: obj.endRegionX, y1: obj.endRegionY } : null;
    },
  };
})()`;

/** call one of nav/aim.ts's functions inside the page, definitions and all */
const aimCall = (fn: "aimAtThing" | "aimAtHotspot", name: string): string =>
  `(() => { ${aimSource()} return ${fn}(${AIM_ADAPTER}, ${JSON.stringify(name)}); })()`;

/**
 * A drag waits on the held script, not on a sleep.
 *
 * `session.realYieldSeq` counts the frames a script has given up, and `stilldown`
 * bumps it once per turn of a `while stilldown()` loop (builtins/pointer.ts) — so
 * it is exactly a tick of the loop that is holding the drag. Waiting for it to
 * advance by two after a cursor move means one whole iteration has begun and
 * finished SINCE the move: the condition check that saw it, and the body that
 * read `mouse()` and acted on it. The mirror sampled next is therefore about a
 * frame that knows where the cursor now is.
 *
 * A fixed sleep instead of this is what a first version did, and 60 ms was not
 * always enough — the pump dials run their loop at `framerate(2)`. The reads then
 * lag the dial by a step, which reads as the dial overshooting its target and is
 * the sort of intermittent nonsense this suite exists to not produce.
 *
 * FOUR rather than two because a loop body gives up more than one frame: the
 * `stilldown()` that begins the turn and the `forceupdate()` that ends it both
 * bump the counter, so +2 can be satisfied without the body in between having run
 * at all. Waiting longer than necessary costs only time — the dial does not move
 * while the cursor is still — so the margin is the cheap side to err on. It does
 * not remove the last one-step miss (nav/dials.ts takes hold again for that);
 * it makes it rare.
 */
const DRAG_TICKS = 4;
/**
 * And a ceiling, so a drag on something that is NOT holding the input still ends.
 *
 * Generous on purpose. It is not a wait, it is the answer to "this prop's script
 * never entered a `while stilldown()` loop" — so the only thing a large value
 * costs is how long that one mistake takes to report, while a small one turns a
 * loaded machine into a wrong answer: the wait gives up, the mirror is sampled
 * anyway, and the stale deg it returns sends the next swing the wrong way.
 */
const DRAG_TICK_TIMEOUT_MS = 20_000;

/**
 * The page URL a browser suite should open: the play page under `APP_URL`, with
 * the EDITION pinned.
 *
 * `APP_URL` is the SITE root (the front page, which only has a Play button on
 * it) — `play/` is appended here, because what a suite wants is the page that
 * boots a game, not the one that links to it.
 *
 * The page asks the player to choose an edition when the install has more than
 * one and nothing has been chosen yet (src/lang-chooser.ts), and a suite that
 * navigated to the bare URL would sit on that screen forever. Routes are recorded
 * against one edition's data anyway, so pinning it is not a workaround: it is the
 * same statement `TAOOT_LANG` makes to the headless side. `?edition=` and not
 * `?lang=`: the latter is the language the PAGE is in, which no suite cares about
 * (src/editions.ts).
 */
export function appUrl(): string {
  const url = playUrl(process.env.APP_URL);
  url.searchParams.set("edition", process.env.TAOOT_LANG ?? DEFAULT_LANGUAGE);
  return url.toString();
}

/** the play page under a site root, whether or not the root already names it */
export function playUrl(base = process.env.APP_URL): URL {
  const root = base ?? "http://localhost:5173/";
  const url = new URL(root);
  if (!/\/play\/?$/.test(url.pathname)) url.pathname = url.pathname.replace(/\/?$/, "/") + "play/";
  return url;
}

export interface BrowserDriverOptions {
  /** how long a single wait may take before it is called stuck */
  timeout?: number;
  log?(message: string): void;
}

/**
 * What the run spent WAITING, split by whether the wait was answered.
 *
 * The browser's time goes somewhere headless's does not. Headless `pump`
 * manufactures game time by incrementing a variable, so an 8000 ms budget costs
 * single-digit real milliseconds; here every wait is `waitForTimeout(150)` round
 * trips against a real clock. A wait that RESOLVES costs both hosts about the same,
 * so the asymmetry lives entirely in the ones that RUN OUT — and those are invisible
 * in a headless profile. Counted by label so the expensive ones can be named.
 */
export interface WaitCost {
  resolved: number;
  resolvedMs: number;
  timedOut: number;
  timedOutMs: number;
  /** how many times each `what` ran out, worst offenders first when reported */
  byLabel: Record<string, number>;
}

export interface BrowserDriver extends NavDriver {
  /** refresh the mirror — after anything that changed the game behind our back */
  sync(): Promise<void>;
  /** the last sample, for a caller that wants to assert on it */
  state(): Mirror;
  /** where the wall clock went — see {@link WaitCost} */
  waits(): WaitCost;
}

export async function browserDriver(page: Page, opts: BrowserDriverOptions = {}): Promise<BrowserDriver> {
  const timeout = opts.timeout ?? 300_000;
  const waitCost: WaitCost = { resolved: 0, resolvedMs: 0, timedOut: 0, timedOutMs: 0, byLabel: {} };
  const root = gamefilesRoot();
  const index = gamefiles(root);
  const sets = new Map<string, SetFile>();
  let m: Mirror = (await page.evaluate(SAMPLE)) as Mirror;

  const sync = async (): Promise<void> => {
    m = (await page.evaluate(SAMPLE)) as Mirror;
  };

  /** canvas pixel (512x384) -> page point, so the click is a real mouse event */
  const pagePoint = (x: number, y: number) =>
    page.evaluate(
      ([px, py]: number[]) => {
        const c = document.getElementById("screen") as HTMLCanvasElement;
        const r = c.getBoundingClientRect();
        return { x: r.left + ((px + 0.5) / c.width) * r.width, y: r.top + ((py + 0.5) / c.height) * r.height };
      },
      [x, y],
    );

  /**
   * A click, and then the one thing a real mouse event does not tell you: whether
   * the engine TOOK it.
   *
   * A press made while a script is in flight is not dispatched — it is queued and
   * replayed when the engine comes free (`GameSession.events`, TI.EXE's own
   * behaviour: the shipped premovie/playmovie/postmovie call no `flushevents()`).
   * Dispatched and queued look identical from here for a moment, so a caller that
   * carries on reads a queued press as "nothing happened", and the replay then
   * arrives later as an effect nobody asked for — the London flat spent an
   * afternoon stalling on exactly that, a queued press opening a close-up behind
   * the route's back while it waited for the engine to go idle.
   *
   * So wait for the queue to be EMPTY, which is true both when the press went
   * straight through and once a queued one has been taken. Deliberately NOT
   * "the engine is idle": a click that opens a conversation leaves it busy for the
   * length of the conversation, and the caller has bevels to press.
   */
  const clickAt = async (x: number, y: number): Promise<void> => {
    const pt = await pagePoint(x, y);
    await page.mouse.click(pt.x, pt.y);
    await waitInPage("dbg.session.events.length === 0", "the press to be taken", 30_000);
  };

  /**
   * Wait on an expression evaluated IN the page.
   *
   * Waiting must not be done by polling from here. A settle can be minutes long
   * — a conversation waits for every spoken line, and in a browser those play in
   * real time — and sampling the whole mirror across the wire every few
   * milliseconds for minutes on end is enough traffic to take the page down with
   * it, which is exactly how the first version of this driver died. So the
   * predicate runs page-side and the mirror is sampled ONCE, when the wait ends.
   */
  const waitInPage = (expr: string, what: string, budget = timeout): Promise<void> =>
    page
      .waitForFunction(`(() => { const dbg = window.dbg; return ${expr}; })()`, null, { timeout: budget })
      .then(() => undefined)
      .catch((e) => {
        throw new Error(`stuck waiting for ${what}: ${(e as Error).message}`);
      });

  /**
   * Poll until a predicate over the MIRROR holds — for the few waits whose
   * condition is a route's own question rather than an engine flag. Deliberately
   * unhurried for the same reason as above; nothing here is latency-sensitive.
   */
  const poll = async (until: () => boolean, what: string, budget = timeout): Promise<boolean> => {
    const deadline = Date.now() + budget;
    const began = Date.now();
    for (;;) {
      await sync();
      if (until()) {
        waitCost.resolved++;
        waitCost.resolvedMs += Date.now() - began;
        return true;
      }
      if (Date.now() > deadline) {
        // A wait that RAN OUT is the browser's most expensive kind of nothing, and
        // the only kind headless does not pay for. There, `pump` manufactures game
        // time by incrementing a variable, so a budget of 8000 costs single-digit
        // real milliseconds; here it is eight real seconds of `waitForTimeout(150)`
        // round trips. So a timeout that is invisible in the headless profile is
        // minutes across a 27-segment browser run — which is why these are counted
        // by label rather than merely returned as false.
        waitCost.timedOut++;
        waitCost.timedOutMs += Date.now() - began;
        waitCost.byLabel[what] = (waitCost.byLabel[what] ?? 0) + 1;
        opts.log?.(`    wait TIMED OUT after ${((Date.now() - began) / 1000).toFixed(1)}s: ${what}`);
        return false;
      }
      await page.waitForTimeout(150);
    }
  };

  /**
   * Wait until the engine can actually ACT on a key, before sending one.
   *
   * `settle` covers the other end of a gesture, and covering only that end is not
   * enough: a press can arrive while the engine is in a state that refuses it, and
   * `SetViewer.pressNav` DROPS such a press when the thing in the way is a fade —
   * it queues on `movingCamera` (a camera move or a script in flight) but keyDown
   * refuses on `inputLocked`, and the two differ by exactly `session.fading`. No
   * handler runs and nothing is logged.
   *
   * Measured, this is not hypothetical and not rare. Segment 22 leaves the fight's
   * closing fade ramping — ~1.5 s of real time in a browser — and segment 23 opens
   * with a `beat`, a `travel` to the room it is already in and a `faceStandpoint`
   * at the view it is already on. Not one of those has anything to do, so not one
   * of them settles, and the first real gesture (`pressUp` at ENGINE.SET's
   * View120, the only way into the smokestack) went into the live fade and
   * vanished. The suite reported "pressing up at View120 did not take us into the
   * stack" 120 s later, with no other symptom.
   *
   * Keys only, deliberately. Clicks are left alone because the fight's combo loop
   * clicks deliberately fast (`FIGHT_COMBO`, and segments.ts on why clicking too
   * slowly is not the failure mode there), and the dropped-press hole is a keydown
   * one. Same predicate as `settle`, minus its 60 ms grace: there is no
   * just-fired gesture to let register yet.
   */
  const ready = (what: string): Promise<void> =>
    waitInPage(
      "dbg.viewer && (dbg.viewer.quiescent || dbg.viewer.conversing)",
      `the engine to be ready for ${what}`,
    );

  const settle = async (what: string): Promise<void> => {
    // the same shape as the headless settle: a gesture needs a moment to
    // register before "quiescent" means anything, so never trust the first look
    await page.waitForTimeout(60);
    // "someone is talking to you" is a place to stop, plaques included — see the
    // headless twin for why the `!awaitingChoice` half had to go: settling to the
    // first plaque plays every opening line (and here they play in real time),
    // while waiting for a puppet parked on a QUESTION to go quiet waits for
    // something only another gesture can cause.
    await waitInPage(
      "dbg.viewer && (dbg.viewer.quiescent || dbg.viewer.conversing)",
      `${what} to settle`,
    );
    await sync();
    opts.log?.(what);
  };

  const setOf = (fileName: string, disc: 1 | 2): SetFile => {
    const key = `${disc}:${fileName}`;
    const cached = sets.get(key);
    if (cached) return cached;
    index.setDisc(disc);
    const name = fileName.endsWith(".set") ? fileName : `${fileName}.set`;
    const bytes = index.provider(name);
    if (!bytes) throw new Error(`no ${name} on disc ${disc} under ${root}`);
    const parsed = readSetFile(bytes);
    sets.set(key, parsed);
    return parsed;
  };

  type Point = { x: number; y: number } | null;
  const aimThing = (name: string) => page.evaluate(aimCall("aimAtThing", name)) as Promise<Point>;
  const aimHotspot = (name: string) => page.evaluate(aimCall("aimAtHotspot", name)) as Promise<Point>;

  const driver: BrowserDriver = {
    sync,
    state: () => m,
    set: () => setOf(m.setFile, m.disc),
    setName: () => m.setFile.replace(/\.set$/, ""),
    at: (): Standpoint => ({ sceneIdx: m.sceneIdx, viewIdx: m.viewIdx }),
    flow: () => m.globals,
    propVisible: (name) => !!m.props[name.toLowerCase()]?.visible,
    propOwner: (name) => String(m.props[name.toLowerCase()]?.owner ?? ""),
    actorSpot: (name) => m.actorSpots[name.toLowerCase()] ?? null,
    propState: (name) => String(m.props[name.toLowerCase()]?.state ?? ""),
    propDeg: (name) => Number(m.props[name.toLowerCase()]?.deg ?? NaN),
    propValue: (name) => Number(m.props[name.toLowerCase()]?.value ?? NaN),
    inFlat: () => m.flat,
    handItem: () => String(m.globals.handitem ?? ""),

    turn: async (dir) => {
      // main.ts binds the arrows to viewer.pressNav, so this is the player's
      // turn — script chain included (see SetViewer.pressNav)
      await ready("a turn");
      await page.keyboard.press(dir === 0 ? "ArrowRight" : "ArrowLeft");
      await settle("turn");
    },
    pressUp: async () => {
      await ready("up");
      await page.keyboard.press("ArrowUp");
      await settle("up");
    },
    pressSpace: async () => {
      await ready("space");
      await page.keyboard.press(" ");
      await settle("space");
    },
    typeKey: async (key) => {
      await ready(`key ${key}`);
      await page.keyboard.press(key === " " ? " " : key);
      await settle(`key ${key}`);
    },

    clickHotspot: async (id) => {
      const at = await aimHotspot(id);
      if (!at) return false;
      await clickAt(at.x, at.y);
      await settle(`click ${id}`);
      return true;
    },
    clickThing: async (name) => {
      const at = await aimThing(name);
      if (!at) return false;
      await clickAt(at.x, at.y);
      await settle(`click ${name}`);
      return true;
    },

    theme: () => m.theme,
    conversing: () => m.conversing,
    awaitingChoice: () => m.awaitingChoice,
    choices: () => m.choices,
    chooseBevel: async (index) => {
      const r = (await page.evaluate(
        (i: number) => {
          const rect = (window as any).dbg.viewer.choiceRects[i];
          return rect ? { x: Math.floor(rect.x + rect.w / 2), y: Math.floor(rect.y + rect.h / 2) } : null;
        },
        index,
      )) as { x: number; y: number } | null;
      if (!r) return;
      await clickAt(r.x, r.y);
      // only until the answer is taken; the reply's lines get clicked past
      await waitInPage("dbg.viewer && !dbg.viewer.awaitingChoice", `bevel ${index} to be taken`, 30_000);
      await sync();
    },
    skipLine: async () => {
      await clickAt(4, 4);
      // long enough for the click to reach the puppet, short enough that the
      // next line is skipped too rather than played out
      await page.waitForTimeout(120);
      await sync();
    },

    movieWaiting: () => m.movieRegions.length > 0,
    moviePlaying: () => m.moviePlaying,
    movieRegions: () => m.movieRegions.map((r) => ({ type: r.type, target: r.target, event: r.event })),
    clickAt: async (x, y) => {
      await clickAt(x, y);
      await settle(`click ${x},${y}`);
    },
    clickMovieRegion: async (index) => {
      const r = m.movieRegions[index];
      if (!r) return;
      await clickAt(Math.floor((r.x0 + r.x1) / 2), Math.floor((r.y0 + r.y1) / 2));
      await settle(`movie region ${index}`);
    },
    skipMovie: async () => {
      const clip = m.movieFile;
      if (!clip) return false;
      // a real Escape at the window, the way a player skips a cutscene
      await page.keyboard.press("Escape");
      // only until THIS clip is off the screen — not settle(), which would wait
      // out the rest of the sequence we are skipping (see the headless twin)
      await waitInPage(
        `!dbg.viewer || dbg.viewer.movieFile !== ${JSON.stringify(clip)}`,
        `${clip} to be let go`,
        10_000,
      ).catch(() => {});
      await sync();
      opts.log?.(`skipped ${clip}`);
      return true;
    },
    dismissMovie: async () => {
      const regions = m.movieRegions;
      const ok = regions.find((r) => 460 >= r.x0 && 460 <= r.x1 && 352 >= r.y0 && 352 <= r.y1);
      const r = ok ?? regions[regions.length - 1];
      if (!r) return;
      await clickAt(Math.floor((r.x0 + r.x1) / 2), Math.floor((r.y0 + r.y1) / 2));
      await settle("movie ok");
    },

    dragHandItemOnto: async (target) => {
      const item = String(m.globals.handitem ?? "");
      if (!item) return false;
      const from = await aimThing(item);
      const to = await aimThing(target);
      if (!from || !to) return false;
      const a = await pagePoint(from.x, from.y);
      const b = await pagePoint(to.x, to.y);
      // press, carry, release. The steps matter: main.ts publishes the pointer on
      // mousemove and inven.shp's `while stilldown()` loop reads it every frame,
      // so a jump from press to release would drop the item where it was picked up
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 12 });
      await page.mouse.up();
      await settle(`${item} on ${target}`);
      return true;
    },

    dragProp: async (name, next) => {
      const at = await aimThing(name);
      if (!at) return false;
      const from = await pagePoint(at.x, at.y);
      /** let the loop holding the drag run a whole iteration, then re-sample */
      const settleHold = async (): Promise<void> => {
        const seq = (await page.evaluate(() => (window as any).dbg.session.realYieldSeq)) as number;
        await waitInPage(
          `dbg.session.realYieldSeq >= ${seq + DRAG_TICKS}`,
          "the held script to take the cursor",
          DRAG_TICK_TIMEOUT_MS,
        ).catch(() => {});
        await sync();
      };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      try {
        // a turn of the loop before the first move, cursor unmoved: the dial does
        // not move but the body publishes its global — see the headless twin
        await settleHold();
        for (let to = next(at); to; to = next(at)) {
          const pt = await pagePoint(to.x, to.y);
          await page.mouse.move(pt.x, pt.y);
          await settleHold();
        }
      } finally {
        await page.mouse.up();
      }
      await settle(`drag ${name}`);
      return true;
    },
    startClick: async (name) => {
      const at = await aimThing(name);
      if (!at) return null;
      const pt = await pagePoint(at.x, at.y);
      // down+up but NOT settled: this gesture cannot finish until the route does
      // something else, so "wait for quiet" would wait for a quiet it prevents
      await page.mouse.move(pt.x, pt.y);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(60);
      await sync();
      return () => !m.scriptBusy;
    },
    waitFor: (until, what, budgetMs) => poll(until, what, budgetMs),
    settled: (what) => settle(what),
    holdUntil: async (x, y, until, what) => {
      const pt = await pagePoint(x, y);
      await page.mouse.move(pt.x, pt.y);
      await page.mouse.down();
      try {
        return await poll(until, what);
      } finally {
        await page.mouse.up();
        await sync();
      }
    },

    log: opts.log,
    waits: () => waitCost,
  };
  return driver;
}
