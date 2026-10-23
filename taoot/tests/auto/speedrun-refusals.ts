/**
 * Titanic's own speedrun verbs (`src/speedrun/actions.ts`) where they refuse,
 * give up, or find there is nothing to do: `lift`, `climbStack`, `use`, `stand`'s
 * room guard and `intro`.
 *
 *   npx vitest run taoot/tests/auto/speedrun-refusals.ts
 *
 * What a sheet's author reads when a line stops is the error, so each of these
 * is held to its message: which option was wrong, which room it expected, what
 * it found instead. The lift is also ridden, against a model attendant: `until:`
 * alternates between two stops because the stop you are at is never offered,
 * and a ride that never brings the condition about says why the Joneses (the
 * usual thing waited for there) were never coming.
 *
 * Driven against a model of the page rather than the game. The verbs talk to it
 * through strings over `window.dbg`, and the fake below EVALUATES those strings
 * verbatim, so a verb that asks a question the page cannot answer fails here
 * too. The two gestures a ride is made of that are the core's — walking up to
 * the attendant and answering him — are stood in for, because which deck a
 * reply goes to is what is under test, not the conversation machinery.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { parseSheet } from "@dreamfactory/speedrun/sheet";
import type { ActionContext } from "@dreamfactory/speedrun/action";
import type { Point, SpeedrunDriver } from "@dreamfactory/speedrun/driver";
import { ACTIONS, VERBS, resolve } from "../../src/speedrun/actions";

/** the attendant's replies, by the deck each takes you to */
const REPLY_DECK: Record<number, { set: string; deck: string }> = {
  101: { set: "GSTAIR2.SET", deck: "a" },
  102: { set: "GSTAIR3.SET", deck: "b" },
  103: { set: "GSTAIR3.SET", deck: "c" },
  104: { set: "RECEPT1C.SET", deck: "d" },
};

/** every reply the model attendant was given, in order */
const rides: number[] = [];

vi.mock("@dreamfactory/speedrun/action", async (importOriginal) => {
  const real = await importOriginal<typeof import("@dreamfactory/speedrun/action")>();
  return {
    ...real,
    // the attendant takes the one reply and the lift arrives at its deck
    converse: async (c: ActionContext, bevels: number[]) => {
      const to = REPLY_DECK[bevels[0]];
      rides.push(bevels[0]);
      await c.d.evaluate(
        `(window.dbg.session.currentSetFile = ${JSON.stringify(to.set)}, window.dbg.session.interp.globals.set("savedeck", ${JSON.stringify(to.deck)}))`,
      );
    },
  };
});

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

interface Page {
  window: { dbg: Record<string, unknown> };
  globals: Map<string, unknown>;
  session: Record<string, unknown>;
  viewer: Record<string, unknown> & { viewIdx: number; sceneIdx: number; scene: { sceneName: string; views: { viewName: string }[] } };
  aimAt: Record<string, Point>;
  onKey: (name: string) => void;
  onClick: (x: number, y: number) => void;
  onTick: () => void;
}

let p: Page;
let gestures: string[];
let said: string[];

function page(): Page {
  const globals = new Map<string, unknown>();
  const scene = { sceneName: "Scene10", views: [{ viewName: "View18" }, { viewName: "View19" }] };
  const session: Record<string, unknown> = {
    currentSetFile: "GSTAIR2.SET",
    get currentSetName() {
      return String(this.currentSetFile).replace(/\.set$/i, "");
    },
    currentFlat: "",
    viewShowing: true,
    events: [],
    interp: { globals },
    fade: { level: 0 },
  };
  const viewer = {
    scene,
    viewIdx: 0,
    sceneIdx: 0,
    set: { scenes: [scene], transitions: [] },
    conversing: false,
    quiescent: true,
    inputLocked: false,
    movieFile: "",
  };
  return {
    window: { dbg: { session, viewer } },
    globals,
    session,
    viewer,
    aimAt: {},
    onKey: () => {},
    onClick: () => {},
    onTick: () => {},
  };
}

function driver(): SpeedrunDriver {
  const ev = <T>(expr: string): T => new Function("window", `return (${expr});`)(p.window) as T;
  const tick = async (): Promise<void> => {
    p.onTick();
    await new Promise((r) => setTimeout(r, 0));
  };
  const until = async (expr: string): Promise<boolean> => {
    for (let i = 0; i < 20; i++) {
      if (ev<boolean>(expr)) return true;
      await tick();
    }
    return false;
  };
  return {
    clock: async () => ({ ms: 0, frames: 0, game: 0, loading: 0 }),
    evaluate: async <T>(expr: string) => ev<T>(expr),
    hold: async (expr, what) => {
      if (!(await until(expr))) throw new Error(`stuck waiting for ${what}`);
    },
    tryHold: (expr) => until(expr),
    settle: async () => {},
    sleep: tick,
    pad: async () => {},
    padded: () => 0,
    key: async (name) => {
      gestures.push(`key ${name}`);
      p.onKey(name);
    },
    rawKey: async (name) => {
      gestures.push(`raw ${name}`);
      p.onKey(name);
    },
    clickAt: async (x, y) => {
      gestures.push(`click ${x},${y}`);
      p.onClick(x, y);
    },
    holdAt: async () => ({ armed: true, held: true }),
    hammer: async () => 0,
    aim: async (_kind, name) => p.aimAt[name.toLowerCase()] ?? null,
    drag: async (from, to) => void gestures.push(`drag ${from.x},${from.y} -> ${to.x},${to.y}`),
    dragProp: async () => {},
    dragOnto: async () => ({ armed: true, landed: true }),
    log: () => {},
  };
}

/** run one sheet line, parsed the way a sheet is */
async function play(line: string): Promise<void> {
  const [step] = parseSheet(line, { verbs: VERBS });
  const action = resolve(step.verb)!;
  await action.run({
    d: driver(),
    step,
    wait: action.wait ?? "none",
    budget: 10_000,
    gap: 0,
    say: (m) => said.push(m),
    suggest: () => {},
    verbs: VERBS,
    watches: [],
  });
}

beforeEach(() => {
  p = page();
  gestures = [];
  said = [];
  rides.length = 0;
  // the attendant is walked up to wherever he stands; the stand to his lobby is the core's
  vi.spyOn(ACTIONS.accost, "run").mockImplementation(async () => void gestures.push("accost elev"));
  vi.spyOn(ACTIONS.stand, "run").mockImplementation(async (c) => void gestures.push(`stand ${c.step.args[0]}`));
});
afterEach(() => vi.restoreAllMocks());

/* ------------------------------------------------------------------ *
 * lift
 * ------------------------------------------------------------------ */

test("lift needs a deck it has, and an attendant to ask", async () => {
  await expect(play("lift()")).rejects.toThrow(/^lift needs deck: a, b, c or d$/);
  await expect(play("lift(deck: e)")).rejects.toThrow(/^lift needs deck: a, b, c or d$/);
  p.session.currentSetFile = "BOILER1.SET";
  await expect(play("lift(deck: c)")).rejects.toThrow(/no lift here — the attendant stands at gstair2, gstair3 and recept1c/);
  // deck B and C share a stairwell; the deck global tells them apart, and neither is a lift without it
  p.session.currentSetFile = "GSTAIR3.SET";
  await expect(play("lift(deck: c)")).rejects.toThrow(/no lift here/);
  expect(gestures).toEqual([]);
});

test("lift at the deck asked for does nothing", async () => {
  p.session.currentSetFile = "GSTAIR3.SET";
  p.globals.set("savedeck", "C");
  await play("lift(deck: c)");
  expect(said).toEqual(["already at deck c"]);
  expect(gestures).toEqual([]);
});

test("lift walks to the attendant's lobby first, then rides", async () => {
  p.viewer.scene.sceneName = "Scene11";
  await play("lift(deck: d)");
  expect(gestures).toEqual(["stand view18", "accost elev"]);
  expect(rides).toEqual([104]);
  expect(said).toEqual(["deck d"]);
  expect(p.session.currentSetFile).toBe("RECEPT1C.SET");
});

test("lift will not ride while somebody is talking", async () => {
  p.viewer.conversing = true;
  await expect(play("lift(deck: b)")).rejects.toThrow(/someone is already talking — answer them before taking the lift/);
  expect(rides).toEqual([]);
});

test("lift until: rides back and forth, and stops where the condition came true", async () => {
  // the third time the attendant is asked, the condition comes true
  const riding = vi.spyOn(ACTIONS.accost, "run").mockImplementation(async () => {
    if (rides.length === 2) p.globals.set("jones", 1);
  });
  await play("lift(deck: c, until: global.jones == 1)");
  // A -> C, then C is never offered at C, so away to B, then back
  expect(rides).toEqual([103, 102, 103]);
  expect(riding).toHaveBeenCalledTimes(3);
  expect(said).toEqual(["global.jones == 1 after 3 rides, deck c"]);
});

test("lift until: already true does not ride; a max that is no number is refused", async () => {
  p.globals.set("jones", 1);
  await play("lift(deck: c, until: global.jones == 1)");
  expect(said).toEqual(["global.jones == 1 already — not moving"]);
  await expect(play("lift(deck: c, until: global.jones == 2, max: 0)")).rejects.toThrow(
    /^max: 0 is not a whole number of rides$/,
  );
  await expect(play("lift(deck: c, until: global.jones == 2, max: two)")).rejects.toThrow(/max: two is not a whole number/);
  expect(rides).toEqual([]);
});

test("lift until: that never comes true says why the Joneses were not coming", async () => {
  const why = async (globals: Record<string, number>): Promise<string> => {
    p = page();
    for (const [k, v] of Object.entries(globals)) p.globals.set(k, v);
    rides.length = 0;
    const err = await play("lift(deck: c, until: global.jones == 1, max: 2)").then(
      () => "",
      (e: Error) => e.message,
    );
    expect(rides).toEqual([103, 102]);
    return err;
  };
  expect(await why({ tour: 1 })).toBe(
    "2 rides and global.jones == 1 never came true — note: the tour has no Joneses (BOOTFILE jonesok)",
  );
  expect(await why({ jonesphase: 1 })).toMatch(/note: jonesphase is already 1, so the Joneses will not come again/);
  expect(await why({ mission: 1, phase: 0 })).toMatch(/note: mission 1, phase 0 has no Joneses/);
  expect(await why({ mission: 2, phase: 1 })).toMatch(/note: mission 2 has the Joneses in phase 2 only, this is phase 1/);
  // and when nothing rules them out, no note at all
  expect(await why({ mission: 2, phase: 2 })).toBe("2 rides and global.jones == 1 never came true");
});

/* ------------------------------------------------------------------ *
 * climbStack
 * ------------------------------------------------------------------ */

/** the smokestack: every key moves the world on, wherever it leads */
function stack(set: string, scene: string, view: string): void {
  p.session.currentSetFile = `${set.toUpperCase()}.SET`;
  p.viewer.scene = { sceneName: scene, views: [{ viewName: view }, { viewName: "elsewhere" }] };
  p.onKey = () => {
    // the world moves (the WORLD string reads sceneIdx), and the view stays put
    p.viewer.sceneIdx++;
  };
}

test("climbStack starts only on the landing or at its ladder, and only on a maze it knows", async () => {
  stack("smstack1", "scene12", "view40");
  await expect(play("climbStack()")).rejects.toThrow(
    /climbStack starts on the smstack1 landing \(scene14 view40\) or at its ladder \(scene10 view42\), not smstack1 scene12 view40/,
  );
  stack("smstack1", "scene14", "view40");
  await expect(play("climbStack()")).rejects.toThrow(/^mazenumber is 0, and there are routes for 1-4$/);
  p.globals.set("mazenumber", 5);
  await expect(play("climbStack()")).rejects.toThrow(/^mazenumber is 5, and there are routes for 1-4$/);
  expect(gestures).toEqual([]);
});

test("climbStack names the move that went nowhere, and a route that ends off the notebook", async () => {
  stack("smstack1", "scene10", "view42");
  p.globals.set("mazenumber", 1);
  // the climb runs its whole route, and the room it reaches is not the top
  await expect(play("climbStack()")).rejects.toThrow(
    /^maze 1's route ended at smstack1 scene10 view42, not at the notebook \(smstack3 scene39 view55\)$/,
  );
  // from the ladder: the landing's first move is not pressed
  expect(gestures).toHaveLength(39);

  gestures = [];
  stack("smstack1", "scene14", "view40");
  p.globals.set("mazenumber", 2);
  let presses = 0;
  // the third key lands on a frozen world
  p.onKey = () => {
    if (++presses < 3) p.viewer.sceneIdx++;
  };
  await expect(play("climbStack()")).rejects.toThrow(/^maze 2, move 3 of 41 \(uu\[r\]\): three ArrowRight presses/);
});

/* ------------------------------------------------------------------ *
 * use
 * ------------------------------------------------------------------ */

test("use needs a target, the thing on screen, and the target on screen", async () => {
  p.globals.set("handitem", "light");
  await expect(play("use(light, on)")).rejects.toThrow(/^use needs something to use it ON$/);
  await expect(play("use(light, on, watch)")).rejects.toThrow(/^the light is not on screen to drag$/);
  p.aimAt.light = { x: 100, y: 300 };
  await expect(play("use(light, on, watch)")).rejects.toThrow(/^no watch to put the light on from here$/);
  p.aimAt.watch = { x: 250, y: 120 };
  await play("use(light, on, watch)");
  expect(gestures).toEqual(["drag 100,300 -> 250,120"]);
});

/* ------------------------------------------------------------------ *
 * stand's room guard
 * ------------------------------------------------------------------ */

test("stand in the wrong room names the room, and warns only when this one has the view too", async () => {
  vi.mocked(ACTIONS.stand.run).mockRestore();
  p.session.currentSetFile = "SMSTACK2.SET";
  await expect(play("stand(view77, set: smstack3)")).rejects.toThrow(
    /^stand\(view77\) expects to be in smstack3 and this is smstack2$/,
  );
  await expect(play("stand(view18, set: smstack3)")).rejects.toThrow(
    /this is smstack2 — which has a view18 of its own, so the walk would have gone somewhere plausible and wrong$/,
  );
});

/* ------------------------------------------------------------------ *
 * intro
 * ------------------------------------------------------------------ */

test("intro lets a film that never asks go when it closes on its own, and fails on one that hangs", async () => {
  // the older film: ESC, and it is gone with no question
  p.window.dbg.intro = { regions: () => [] };
  p.onKey = () => void delete p.window.dbg.intro;
  await play("intro()");
  expect(gestures).toEqual(["raw Escape"]);

  // a film that stays up and never puts its question
  gestures = [];
  p.window.dbg.intro = { regions: () => [] };
  p.onKey = () => {};
  await expect(play("intro()")).rejects.toThrow(/^the nightdive intro never reached its question$/);
});

/* ------------------------------------------------------------------ *
 * wireless and dial: the verbs' own readings of the set
 * ------------------------------------------------------------------ */

/** at the wireless desk, with these props in the room's shop and these regions to click */
function desk(props: Record<string, { owner: string; value: number }>, regions: Record<string, Point & { opens?: string }>): void {
  Object.assign(p.session, {
    viewShowing: false,
    currentFlat: "wireless 1",
    propRuntime: {
      shops: new Map([["radio.shp", { shp: { groups: Object.keys(props).map((name) => ({ name })) } }]]),
      get: (n: string) => props[n.toLowerCase()],
    },
  });
  for (const [name, at] of Object.entries(regions)) p.aimAt[name] = at;
  p.onClick = (x, y) => {
    const hit = Object.values(regions).find((r) => r.x === x && r.y === y);
    if (hit?.opens) p.session.currentFlat = hit.opens;
  };
}

test("wireless passes on the set's reason when a control's region or handle is not there", async () => {
  desk({}, {});
  await expect(play("wireless(tx)")).rejects.toThrow(/^no breaker region on wireless 1$/);
  await expect(play("wireless(tuner, rx2)")).rejects.toThrow(/^no tuner region on wireless 1$/);

  desk({}, { breaker: { x: 60, y: 60, opens: "wireless 2" } });
  await expect(play("wireless(breaker, tx)")).rejects.toThrow(/^no breakerhandle to take hold of$/);
});

test("wireless reads a handle the room does not carry as no setting at all", async () => {
  // the handle is on screen to drag, but no prop of the shop answers for it
  desk({}, { sender: { x: 90, y: 60, opens: "wireless 4" }, senderhandle: { x: 120, y: 200 } });
  await expect(play("wireless(sender, on)")).rejects.toThrow(/^the sender went to "" at y=40, not "on"$/);

  desk({}, { tuner: { x: 150, y: 60, opens: "wireless 5" }, tunerknob: { x: 333, y: 219 } });
  await expect(play("wireless(tuner, tx)")).rejects.toThrow(/would not come to 34\.\.40 in 120 swings \(started , ended NaN\)$/);
});

test("wireless that sets a control and cannot get back to the desk says so", async () => {
  desk({ senderhandle: { owner: "on", value: 0 } }, {
    sender: { x: 90, y: 60, opens: "wireless 4" },
    senderhandle: { x: 120, y: 200 },
  });
  await expect(play("wireless(sender, on)")).rejects.toThrow(/^no ok on wireless 4$/);
});

test("dial with no valve on screen to take hold of passes on why", async () => {
  desk({}, {});
  await expect(play("dial(valve1, 10)")).rejects.toThrow(/^no valve1 to take hold of$/);
  console.log("SAID", said);
  expect(gestures).toEqual([]);
});

/* ------------------------------------------------------------------ *
 * blackjack, before the table
 * ------------------------------------------------------------------ */

/** Mission 4 at Buick's table, with these owners for the three things played for */
function stakes(owners: Record<string, string>, mission = 4): void {
  p.globals.set("mission", mission);
  p.session.propRuntime = { props: new Map(Object.entries(owners).map(([k, owner]) => [k, { owner }])) };
}

test("blackjack refuses a goal, a hand count, a mission and a stake it cannot play for", async () => {
  await expect(play("blackjack(draw)")).rejects.toThrow(/^blackjack\(win\) or blackjack\(lose\), not "draw"$/);
  await expect(play("blackjack(win, max: 0)")).rejects.toThrow(/^max: needs a whole number of hands, not "0"$/);

  stakes({ boatpass: "buick", rubaiyat: "frank" }, 3);
  await expect(play("blackjack(win)")).rejects.toThrow(/^blackjack is Mission 4's game for the boat pass$/);
  stakes({ boatpass: "frank", rubaiyat: "frank" });
  await expect(play("blackjack(win)")).rejects.toThrow(/^Buick does not have the boat pass to play for$/);
  stakes({ boatpass: "buick" });
  await expect(play("blackjack(win)")).rejects.toThrow(/^Frank has nothing Buick will play for \(realneck, rubaiyat\)$/);
  stakes({ boatpass: "buick", rubaiyat: "frank", realneck: "frank" });
  await expect(play("blackjack(win)")).rejects.toThrow(/^bet: realneck or rubaiyat\?$/);
  await expect(play("blackjack(win, bet: watch)")).rejects.toThrow(/^bet: realneck or rubaiyat, not "watch"$/);
  stakes({ boatpass: "buick", rubaiyat: "frank" });
  await expect(play("blackjack(win, bet: realneck)")).rejects.toThrow(/^Frank does not have the realneck$/);
  // the one thing Frank has is the bet when none is named, and the table must be in reach
  await expect(play("blackjack(lose)")).rejects.toThrow(/^the blackjack table is not clickable from here$/);
  expect(gestures).toEqual([]);
});
