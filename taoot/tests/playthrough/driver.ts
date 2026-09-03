/**
 * The playthrough's {@link NavDriver}: a pumped headless host, driven.
 *
 * The driver is the seam between a route and a host. This is the headless
 * implementation; taoot/tests/browser/playthrough.ts is the same route
 * against real DOM events, which is what makes a divergence between them a
 * browser-layer fact rather than a route difference.
 */
import { LEFTTURNS } from "@dreamfactory/engine/df/set";
import { ENGINE_STEP_MS } from "@dreamfactory/engine/runtime/clock";
import { GameHost } from "@dreamfactory/engine/web/host";
import type { SetViewer } from "@dreamfactory/engine/web/viewer";
import type { NavDriver } from "./nav/navigator";
import { type Aim, aimAtHotspot, aimAtThing } from "@dreamfactory/engine/web/speedrun/aim";

/**
 * The pumping half of the harness (play.ts), which this driver needs for the
 * gestures that aren't one click: a drag needs frames BETWEEN press and release,
 * and a held button needs frames while it is held.
 */
export interface Pumped {
  settle(what: string): Promise<void>;
  pump(until: () => boolean, what: string, max?: number): Promise<void>;
  /** click without awaiting it — see play.ts */
  fire(x: number, y: number): () => boolean;
}

/**
 * A {@link NavDriver} over a pumped headless host.
 *
 * Gestures are fired, not awaited. With modal movies a gesture that opens a
 * close-up doesn't resolve until the movie is dismissed, and the movie only
 * advances while the pump runs — awaiting here would deadlock the pump against
 * the gesture. main.ts has the same shape: it fires clicks into session.track
 * and lets rAF carry them.
 */
/**
 * Frames to leave the cursor at each point of a drag.
 *
 * Enough for the held script's `while stilldown()` to come round once and see
 * where the cursor now is. More is harmless for a dial (a still cursor moves
 * nothing — see nav/dials.ts), which is what lets the browser twin sit on each
 * point for a wall-clock delay instead and still turn it by the same amount.
 */
const DRAG_FRAMES = 2;

export function headlessDriver(host: GameHost, p: Pumped, log?: (m: string) => void): NavDriver {
  const session = host.session;
  const v = (): SetViewer => host.viewer!;
  /**
   * Settle, but treat "someone is talking to you" as a place to stop.
   *
   * A gesture that starts a conversation would otherwise settle all the way to
   * the first plaque, playing every opening line — and in a browser those play in
   * real time. Stopping while the puppet speaks lets the caller click past them,
   * which is what the original's players did and what the engine supports
   * (PuppetCtrl.puppetSpeak races each line against a click).
   *
   * A conversation PARKED ON A QUESTION is a place to stop as well, and used not
   * to be. The condition was `conversing && !awaitingChoice`, which excluded the
   * one state a puppet spends most of its life in: `quiescent` is
   * `awaitingInput || !inputLocked` and a visible puppet makes the viewer busy, so
   * when a gesture's CONSEQUENCE was a puppet showing plaques neither half held
   * and the settle pumped until its budget died. Segment 18 hit it — dismissing
   * the rope clip lets SCOT3.SET fetch the Hacker, whose puppet asks something
   * immediately — and the route worked around it with ESC. A conversation waiting
   * for the player is as settled as this game gets, so waiting on it is waiting
   * for something that will never happen without another gesture.
   */
  const settle = async (what: string): Promise<void> => {
    await p.pump(() => v().quiescent || v().conversing, `${what} to settle`);
    log?.(what);
  };
  /** exactly `n` frames, for the middle of a gesture that has no end to wait on */
  const ticks = async (n: number, what: string): Promise<void> => {
    let i = 0;
    await p.pump(() => i++ >= n, what, n + 2);
  };
  /**
   * Wait, briefly, for the cast to be still before clicking at something.
   *
   * A character in motion refuses a click — `if iswalk (me) exitcode` (gang.cst
   * 0442, turkstrs.set's bath door), and `iswalk` counts a TURN as motion
   * (TI.EXE 0x4427e0 reads the slot's occupied flag and name, never the mode). A
   * player clicks again; a driver clicks once, and segment 17's knock landed in
   * that window and waited 40000 steps for a Morrow who had declined.
   *
   * Bounded and NEVER fatal: it moves when the click goes in, not whether it is
   * retried, so a dead hotspot still fails the beat after it. Non-fatal matters —
   * clicking the map while someone walks is perfectly legal, and an unbounded
   * version stopped the route dead on exactly that.
   */
  const beStill = async (what: string): Promise<void> => {
    for (let i = 0; i < 60 && session.scheduler.anyoneMoving(); i++) {
      await ticks(1, `${what}: waiting for the cast to be still`);
    }
  };
  /** the engine's answers to the aiming questions (engine/src/web/speedrun/aim.ts) */
  const aim = (): Aim => ({
    width: host.screen.width,
    height: host.screen.height,
    hitTest: (x, y) => session.hitTestAt(x, y),
    propUnder: (x, y) => v().propUnder(x, y)?.group.name ?? null,
    inFlat: !session.viewShowing && !!session.stageScript,
    hotspot: (name) => {
      const obj = v().scene.views[v().viewIdx].objects.find(
        (o) => (o.identifier ?? "").toLowerCase() === name.toLowerCase(),
      );
      return obj
        ? { x0: obj.startRegionX, y0: obj.startRegionY, x1: obj.endRegionX, y1: obj.endRegionY }
        : null;
    },
  });
  return {
    set: () => v().set,
    setName: () => (session.currentSetFile || session.currentSetName).toLowerCase(),
    at: () => ({ sceneIdx: v().sceneIdx, viewIdx: v().viewIdx }),
    flow: () => Object.fromEntries(session.interp.globals),
    propVisible: (name) => !!session.propRuntime.get(name)?.visible,
    propOwner: (name) => String(session.propRuntime.get(name)?.owner ?? ""),
    actorSpot: (name) => {
      const a = session.actorRuntime.get(name);
      return a ? { x: a.worldX, z: a.worldZ, visible: !!a.visible } : null;
    },
    walking: (name) => session.scheduler.isWalk(name),
    propState: (name) => String(session.propRuntime.get(name)?.stateName ?? ""),
    propDeg: (name) => Number(session.propRuntime.get(name)?.deg ?? NaN),
    propValue: (name) => Number(session.propRuntime.get(name)?.value ?? NaN),
    inFlat: () => (!session.viewShowing && session.currentFlat ? session.currentFlat : null),
    // the arrows, exactly as main.ts binds them: through the script chain, which
    // may consume the key to leave the set (a door) or to turn twice (the 2nd
    // class staircase's landings), and the engine default when none does
    turn: async (dir) => {
      void session.track(v().pressNav(dir === LEFTTURNS ? "leftarrow" : "rightarrow"));
      await settle("turn");
    },
    pressUp: async () => {
      void session.track(v().pressNav("uparrow"));
      await settle("up");
    },
    pressSpace: async () => {
      void session.track(v().keyDown(" "));
      await settle("space");
    },
    theme: () => session.currentThemeName,
    conversing: () => v().conversing,
    conversingWith: () => v().conversingWith,
    awaitingChoice: () => v().awaitingChoice,
    choices: () => v().choices,
    chooseBevel: async (index) => {
      const r = v().choiceRects[index];
      if (!r) return;
      void session.track(v().click(Math.floor(r.x + r.w / 2), Math.floor(r.y + r.h / 2)));
      // wait only for the answer to be TAKEN (the puppet drops its eventWaiter),
      // then hand back so the reply's lines can be clicked past
      await p.pump(() => !v().awaitingChoice, `bevel ${index} to be taken`, 4000);
      await ticks(2, "the reply to start");
    },
    clickThing: async (name) => {
      // the same pre-click wait clickHotspot takes, and for the same reason — a
      // character in motion refuses the click, and the browser twin must click at
      // the same moment or the two hosts diverge on the recovery rather than on
      // anything real (the C-deck seaman, browser View17 against golden View13)
      //
      // AIM AFTER IT, not before. The wait exists so the click lands on a settled
      // cast, and aiming first threw that away: the pixel was picked while people
      // were still moving, and a character who so much as TURNS in the meantime
      // (every gang.cst idle does, every 20 passes) leaves the aimed pixel on the
      // room behind them. Segment 14 is where it showed — Smethells in recept1c,
      // aimed at and then clicked past, the click landing on the painting hotspot
      // instead and `spotmovie("recpaint.mov")` eating the gesture. It only ever
      // depended on which pass the click fell on, which is why the 90 ms frame
      // pace hid it and the original's 50 ms did not.
      await beStill(name);
      const at = aimAtThing(aim(), name);
      if (!at) return false;
      void session.track(v().click(at.x, at.y));
      await settle(`click ${name}`);
      return true;
    },
    handItem: () => String(session.interp.globals.get("handitem") ?? ""),
    typeKey: async (key) => {
      void session.track(v().keyDown(key));
      await settle(`key ${key}`);
    },
    dragHandItemOnto: async (target) => {
      const item = String(session.interp.globals.get("handitem") ?? "");
      if (!item) return false;
      const from = aimAtThing(aim(), item);
      const to = aimAtThing(aim(), target);
      if (!from || !to) return false;
      // press, carry, release — the shop's drag loop reads mouse() every frame
      // and hit-tests wherever the button came up, so the frames in the middle
      // are the gesture, not padding
      session.pointerDown = true;
      session.setPointer(from.x, from.y);
      const done = p.fire(from.x, from.y);
      await ticks(8, `picking up the ${item}`);
      session.setPointer(to.x, to.y);
      await ticks(8, `carrying the ${item} to ${target}`);
      session.pointerDown = false;
      await p.pump(() => done(), `the ${item} to land on ${target}`, 8000);
      await settle(`${item} on ${target}`);
      return true;
    },
    dragProp: async (name, next) => {
      const at = aimAtThing(aim(), name);
      if (!at) return false;
      session.pointerDown = true;
      session.setPointer(at.x, at.y);
      const done = p.fire(at.x, at.y);
      try {
        // A batch BEFORE the first move, with the cursor exactly where it was
        // pressed. The dial does not turn (its limiter sees no swing), but the
        // held loop's body runs — and that body is what publishes the plant's
        // global from the deg. Skip it and a control that was already on target
        // keeps running on initvalue()'s 50 (see nav/dials.ts).
        await ticks(DRAG_FRAMES, `taking hold of ${name}`);
        for (let to = next(at); to; to = next(at)) {
          session.setPointer(to.x, to.y);
          await ticks(DRAG_FRAMES, `moving on ${name}`);
        }
      } finally {
        session.pointerDown = false;
      }
      // the loop's own exit, then whatever the release set in motion
      await p.pump(done, `the ${name} drag to end`, 4000).catch(() => {});
      await settle(`drag ${name}`);
      return true;
    },
    startClick: async (name) => {
      const at = aimAtThing(aim(), name);
      if (!at) return null;
      const done = p.fire(at.x, at.y);
      await ticks(3, `clicking ${name}`);
      return done;
    },
    waitFor: async (until, what, budgetMs) => {
      // ticks, not wall clock: a headless step IS an engine step
      const steps = budgetMs === undefined ? 8000 : Math.max(1, Math.ceil(budgetMs / ENGINE_STEP_MS));
      await p.pump(until, what, steps).catch(() => {});
      return until();
    },
    settled: async (what) => {
      await settle(what);
    },
    holdUntil: async (x, y, until, what) => {
      session.pointerDown = true;
      session.setPointer(x, y);
      try {
        await p.pump(until, what, 8000).catch(() => {});
      } finally {
        session.pointerDown = false;
      }
      await settle(what);
      return until();
    },
    // ?. rather than v(): the cold boot plays its logos before there is a viewer
    // to ask, and rushing them is the first thing a route does
    movieWaiting: () => (host.viewer?.movieRegions.length ?? 0) > 0,
    moviePlaying: () => host.viewer?.moviePlaying ?? false,
    movieRegions: () => v().movieRegions.map((r) => ({ type: r.type, target: r.target, event: r.event })),
    clickAt: async (x, y) => {
      void session.track(v().click(x, y));
      await settle(`click ${x},${y}`);
    },
    clickMovieRegion: async (index) => {
      const r = v().movieRegions[index];
      if (!r) return;
      void session.track(v().click(Math.floor((r.x0 + r.x1) / 2), Math.floor((r.y0 + r.y1) / 2)));
      await settle(`movie region ${index} (type ${r.type}${r.target ? ` -> ${r.target}` : ""})`);
    },
    dismissMovie: async () => {
      // the OK plaque the artists put bottom-right — the exit in every one of
      // these; fall back to the last region if a movie breaks the convention
      const regions = v().movieRegions;
      const ok = regions.find((r) => 460 >= r.x0 && 460 <= r.x1 && 352 >= r.y0 && 352 <= r.y1);
      const r = ok ?? regions[regions.length - 1];
      if (!r) return;
      void session.track(v().click(Math.floor((r.x0 + r.x1) / 2), Math.floor((r.y0 + r.y1) / 2)));
      await settle("movie ok");
    },
    skipMovie: async () => {
      const clip = host.viewer?.movieFile;
      if (!clip) return false;
      // ESC as the engine sees it: the character "." with the special-key
      // marker (see MoviePlayer.key) — the same call main.ts makes, so the
      // route exercises the routing and not a back door
      void session.track(v().keyDown(".", true));
      // only until THIS clip is off the screen. Not settle(): the script
      // normally answers with the next playmovie, and waiting for quiet would
      // wait out the very sequence we are skipping
      await p.pump(() => host.viewer?.movieFile !== clip, `${clip} to be let go`, 200).catch(() => {});
      log?.(`skipped ${clip}`);
      return true;
    },
    skipLine: async () => {
      // Nothing to skip while a movie owns the screen, and ESC there is not a
      // skip but an ABORT (MoviePlayer.key). The old click was harmlessly eaten
      // by the movie; the key is not, and a conversation that plays one in the
      // middle of its lines (Penny's lenin.mov) would lose it. Let it run.
      if (host.viewer?.movieFile) {
        await ticks(3, "the movie to run on");
        return;
      }
      // Only while a line is actually being spoken. ESC is no longer harmless
      // elsewhere in a conversation: at a plaque it answers with -1 and walks the
      // player out (#131), and this loop is called between exchanges as much as
      // during them — so an unaimed press would abandon conversations the route is
      // in the middle of. Checked as late as possible, right at the dispatch.
      if (!v().speaking) {
        await ticks(3, "a line to start");
        return;
      }
      // ESC, and only ESC — the same call main.ts makes, routed through the
      // viewer so the route exercises the routing (PuppetCtrl.key). A click on
      // the picture is the REPEAT now (#3), so the old `click(4, 4)` would ask
      // the character to say it all again instead of getting past it.
      void session.track(v().keyDown(".", true));
      await ticks(3, "the skip to register");
    },
    clickHotspot: async (id) => {
      const at = aimAtHotspot(aim(), id);
      if (!at) return false;
      // Let any turn finish first. A character mid-turn reads as WALKING to every
      // script (see Scheduler.turning), and the handlers that put someone in front
      // of you refuse the click while it does — `if iswalk (me) exitcode` in
      // gang.cst 0442, and the same guard on turkstrs.set's bath door. The window
      // is sub-second and a player just clicks again; this driver clicks once, so
      // segment 17's knock landed in one and waited 40000 steps for a Morrow who
      // had already declined.
      //
      // This changes WHEN the click goes in, never whether it is retried, so a
      // hotspot that is genuinely dead still fails here rather than being papered
      // over. Bounded, because an idle that turns forever must not hang the route —
      // if the window never opens, click anyway and let the assertion speak.
      await beStill(id);
      void session.track(v().click(at.x, at.y));
      await settle(`click ${id}`);
      return true;
    },
    log,
  };
}
