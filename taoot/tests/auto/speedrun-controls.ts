/**
 * The speedrun verbs that work one of Titanic's machines: `dial` (the coal
 * lever and the turbine and doll dials), `wireless` (Mr. Thayer's telegram) and
 * `mapJump` (the deck plans).
 *
 *   npx vitest run taoot/tests/auto/speedrun-controls.ts
 *
 * `dial` and `wireless` are ADAPTERS: the swing arithmetic lives in nav/dials.ts
 * and nav/wireless.ts, which the playthroughs drive headless, and the verbs only
 * put the speedrun driver underneath them. The one thing the adapter adds is the
 * thing it once got wrong — the reading those modules steer by is a round trip
 * into the page, so it has to be refilled between frames. Filled once before
 * the press, a dial is steered by a photograph: the number never changes, and
 * the swing winds to an end stop and is called stuck. The wireless model below
 * moves its needle two a swing from 200 down to the transmit band, eighty-odd
 * frames, and only arrives if every frame is read fresh.
 *
 * `mapJump` is literal clicks with two waits that must not be the same wait —
 * the first click on a dark band only lights it — and a `deck:` that is a
 * preference rather than a constraint. Both are pinned, along with the
 * refusals that name what a sheet can write instead.
 *
 * All against models of the controls, not the game: what is asserted is the
 * gestures the verbs make and where the models end up, which is the verbs'
 * decision and nothing else's.
 */
import { expect, test } from "vitest";
import { VERBS, resolve } from "../../src/speedrun/actions";
import { COAL_LEVER, TURBINE_DIALS, degtonum } from "../../src/speedrun/nav/dials";
import { RX_BANDS, TX_BAND, WIRELESS_MAIN, WIRELESS_PANELS } from "../../src/speedrun/nav/wireless";
import type { ActionContext } from "@dreamfactory/engine/web/speedrun/action";
import type { SpeedrunDriver } from "@dreamfactory/engine/web/speedrun/driver";

type Point = { x: number; y: number };

/** run one verb against a driver; the error, if it threw, and what it said */
async function run(
  d: SpeedrunDriver,
  verb: string,
  args: string[],
  opts: Record<string, string> = {},
): Promise<{ said: string[]; error?: string }> {
  const said: string[] = [];
  const c: ActionContext = {
    d,
    step: { verb, args, opts, repeat: 1, line: 1, source: `${verb}(${args.join(", ")})` },
    wait: "none",
    budget: 10_000,
    gap: 16,
    say: (m) => said.push(m),
    suggest: () => {},
    verbs: VERBS,
  };
  try {
    await resolve(verb)!.run(c);
  } catch (e) {
    return { said, error: (e as Error).message };
  }
  return { said };
}

/** a driver that only knows how to wait — enough for a verb that refuses up front */
const idle = (): SpeedrunDriver =>
  ({
    evaluate: async () => null,
    hold: async () => {},
    tryHold: async () => true,
    settle: async () => {},
  }) as unknown as SpeedrunDriver;

// --- dial ------------------------------------------------------------------

/**
 * TURBINE's coal lever: dragged on the cursor's Y, clamped to its travel, and —
 * as the held loop runs — publishing `coal = degtonum(20 - deg)` to the plant.
 */
function coalLever(startDeg = 0) {
  let deg = startDeg;
  let coal = degtonum(20 - deg);
  let pushes = 0;
  const d = {
    evaluate: async <T,>(expr: string): Promise<T> => {
      if (expr.includes("propRuntime.shops")) return { degs: { slider: deg }, flow: { coal } } as T;
      return null as T;
    },
    hold: async () => {},
    tryHold: async () => true,
    settle: async () => {},
    aim: async (_kind: string, name: string): Promise<Point | null> =>
      name === "slider" ? { x: 300, y: COAL_LEVER.top + deg * COAL_LEVER.pitch } : null,
    dragProp: async (at: Point, next: (start: Point) => Point | null | Promise<Point | null>) => {
      pushes++;
      for (let frame = 0; frame < 50; frame++) {
        const p = await next(at);
        if (!p) break;
        const y = Math.min(COAL_LEVER.bottom, Math.max(COAL_LEVER.top, p.y));
        deg = Math.floor((y - COAL_LEVER.top) / COAL_LEVER.pitch);
        coal = degtonum(20 - deg);
      }
    },
  };
  return { d: d as unknown as SpeedrunDriver, state: () => ({ deg, coal, pushes }) };
}

test("dial coal sets the lever's deg, and the plant is told the inverted value", async () => {
  const lever = coalLever(0);
  const out = await run(lever.d, "dial", ["coal", "3"]);
  expect(out.error).toBeUndefined();
  // deg 3 down the slot burns degtonum(17) — the global runs against the deg
  expect(lever.state()).toEqual({ deg: 3, coal: degtonum(17), pushes: 1 });
  expect(out.said).toEqual(["coal = 3"]);
});

test("the coal lever also answers to its prop name, slider", async () => {
  const lever = coalLever(12);
  const out = await run(lever.d, "dial", ["Slider", "5"]);
  expect(out.error).toBeUndefined();
  expect(lever.state().deg).toBe(5);
});

test("a dial nobody named is refused with the names there are", async () => {
  const out = await run(idle(), "dial", ["boiler", "6"]);
  expect(out.error).toBe(
    'no dial called "boiler" (there is pump2, pump1, valve3, valve1, valve2, dial1, dial2, dial3, dial4, coal)',
  );
});

test("the dial verb's help names only dials there are", () => {
  // it once offered "dial boiler 6", which is the refusal above
  const named = [...VERBS.dial.help.matchAll(/dial (\w+) \d+/g)].map((m) => m[1]);
  expect(named.length).toBeGreaterThan(0);
  for (const name of named) expect(name in TURBINE_DIALS || name === "coal", name).toBe(true);
});

test("a dial setting that is not a number is refused before anything is touched", async () => {
  const out = await run(idle(), "dial", ["coal", "lots"]);
  expect(out.error).toBe('dial needs a number, got "lots"');
});

test("a lever setting off its travel is the lever module's refusal, passed on", async () => {
  const lever = coalLever(0);
  const out = await run(lever.d, "dial", ["coal", "40"]);
  expect(out.error).toBe("deg 40 is off slider's travel");
  expect(lever.state().pushes).toBe(0);
});

/**
 * One of TURBINE's swing dials: a rising bearing round its pivot moves the deg
 * by the dial's signed step, clamped to 0..19, and the held loop publishes the
 * plant's global from the deg on every frame.
 */
function swingDial(name: keyof typeof TURBINE_DIALS, startDeg: number) {
  const dial = TURBINE_DIALS[name];
  let deg = startDeg;
  let driven = dial.value(deg);
  let grabs = 0;
  const visited: number[] = [];
  const d = {
    evaluate: async <T,>(expr: string): Promise<T> => {
      if (expr.includes("propRuntime.shops")) return { degs: { [dial.prop]: deg }, flow: { [dial.global!]: driven } } as T;
      return null as T;
    },
    hold: async () => {},
    tryHold: async () => true,
    settle: async () => {},
    aim: async (_kind: string, n: string): Promise<Point | null> =>
      n === dial.prop ? { x: dial.pivot.x + 10, y: dial.pivot.y } : null,
    dragProp: async (at: Point, next: (start: Point) => Point | null | Promise<Point | null>) => {
      grabs++;
      let bearing = Math.atan2(at.y - dial.pivot.y, at.x - dial.pivot.x);
      for (let frame = 0; frame < 200; frame++) {
        const p = await next(at);
        if (!p) break;
        const b = Math.atan2(p.y - dial.pivot.y, p.x - dial.pivot.x);
        let turn = b - bearing;
        if (turn > Math.PI) turn -= 2 * Math.PI;
        if (turn < -Math.PI) turn += 2 * Math.PI;
        bearing = b;
        if (Math.abs(turn) < 1e-9) continue;
        deg = Math.min(19, Math.max(0, deg + (turn > 0 ? dial.step : -dial.step)));
        visited.push(deg);
        driven = dial.value(deg);
      }
    },
  };
  return { d: d as unknown as SpeedrunDriver, state: () => ({ deg, driven, grabs, visited }) };
}

test("a valve is swung round its pivot to the deg asked for, and the plant runs at it", async () => {
  const valve = swingDial("valve3", 2);
  const out = await run(valve.d, "dial", ["valve3", "7"]);
  expect(out.error).toBeUndefined();
  // the measured failure: valve3 asked for 7 wound 2->19, 19->0, 0->19 when the
  // deg was read once before the press. Read every frame, it walks 2..7 and stops.
  expect(valve.state()).toEqual({ deg: 7, driven: degtonum(7), grabs: 1, visited: [3, 4, 5, 6, 7] });
});

test("a pump off the target's chain winds to the end stop first, because clamping is what changes chain", async () => {
  // pump2 steps by 3: 1 is not on 0's chain (0, 3, 6 ...) but is on 19's
  const pump = swingDial("pump2", 0);
  const out = await run(pump.d, "dial", ["pump2", "1"]);
  expect(out.error).toBeUndefined();
  const s = pump.state();
  expect(s.deg).toBe(1);
  expect(s.driven).toBe(100 - degtonum(1));
  expect(s.visited).toContain(19);
  expect(s.visited.at(-1)).toBe(1);
});

test("a pump setting no chain reaches is refused, not wound at for ever", async () => {
  const pump = swingDial("pump2", 0);
  const out = await run(pump.d, "dial", ["pump2", "2"]);
  expect(out.error).toBe("pump2 steps by 3, so deg 2 is off every chain it has");
  expect(pump.state().grabs).toBe(0);
});

// --- wireless --------------------------------------------------------------

/** the pivot WIRELESS.SHP's tuner measures bearings from */
const PIVOT = { x: 333, y: 119 };

/**
 * The wireless set, as far as the verb can see it.
 *
 * Flat 1 is the desk; each region opens a close-up and its OK comes back. The
 * breaker snaps on release by X, the sender by Y. The tuner's needle moves two
 * per swing, up for a rising bearing and down for a falling one, from the 200
 * `openshop()` parks it at. The knob is "on" only when the needle is in a band
 * the breaker and sender are set for — `tuned()` branches on those two first —
 * and the tapper flat opens in "tx" only if all three hold.
 */
function wirelessSet(start: { flat?: string | null } = {}) {
  let flat: string | null = start.flat === undefined ? WIRELESS_MAIN : start.flat;
  let breaker = "off";
  let sender = "off";
  let needle = 200;
  let knob = "off";
  let tapper = "";
  const clicks: string[] = [];
  const spots: Record<string, Point> = {
    breaker: { x: 10, y: 10 },
    sender: { x: 20, y: 10 },
    tuner: { x: 30, y: 10 },
    amp: { x: 40, y: 10 },
    tapper: { x: 50, y: 10 },
    ok: { x: 460, y: 352 },
    breakerhandle: { x: 125, y: 200 },
    senderhandle: { x: 200, y: 300 },
    tunerknob: { x: PIVOT.x + 30, y: PIVOT.y },
  };
  const nameAt = (p: Point) => Object.entries(spots).find(([, s]) => s.x === p.x && s.y === p.y)?.[0];
  const inBand = (b: { lo: number; hi: number }) => needle >= b.lo && needle <= b.hi;
  const tuned = () =>
    sender === "on" &&
    ((breaker === "tx" && inBand(TX_BAND)) || (breaker === "rx" && RX_BANDS.some(inBand)));
  const owners = () => ({
    breakerhandle: { owner: breaker, value: 0 },
    senderhandle: { owner: sender, value: 0 },
    tunerknob: { owner: knob, value: 0 },
    tunerneedle: { owner: "", value: needle },
    tapperdown: { owner: tapper, value: 0 },
  });

  const d = {
    evaluate: async <T,>(expr: string): Promise<T> => {
      if (expr.includes("propRuntime.shops")) return { props: owners(), flat } as T;
      if (expr.includes("currentFlat")) return flat as T;
      return null as T;
    },
    hold: async () => {},
    tryHold: async () => true,
    settle: async () => {},
    aim: async (_kind: string, name: string) => spots[name] ?? null,
    clickAt: async (x: number, y: number) => {
      const name = nameAt({ x, y })!;
      clicks.push(name);
      if (flat === WIRELESS_MAIN && name in WIRELESS_PANELS) {
        flat = WIRELESS_PANELS[name as keyof typeof WIRELESS_PANELS];
        // the tapper flat's openflat(): setuptx() only if all three already hold
        if (name === "tapper") tapper = breaker === "tx" && sender === "on" && knob === "on" ? "tx" : "rx";
      } else if (name === "ok" && flat !== WIRELESS_MAIN) {
        flat = WIRELESS_MAIN;
      }
    },
    dragProp: async (at: Point, next: (start: Point) => Point | null | Promise<Point | null>) => {
      const prop = nameAt(at);
      let last = at;
      let bearing = Math.atan2(at.y - PIVOT.y, at.x - PIVOT.x);
      for (let frame = 0; frame < 500; frame++) {
        const p = await next(at);
        if (!p) break;
        if (prop === "tunerknob") {
          const b = Math.atan2(p.y - PIVOT.y, p.x - PIVOT.x);
          let turn = b - bearing;
          if (turn > Math.PI) turn -= 2 * Math.PI;
          if (turn < -Math.PI) turn += 2 * Math.PI;
          if (Math.abs(turn) > 1e-9) needle = Math.min(200, Math.max(14, needle + (turn > 0 ? 2 : -2)));
          bearing = b;
          // the held loop answers tuned() on every iteration
          knob = tuned() ? "on" : "off";
        }
        last = p;
      }
      // the snaps happen on the release
      if (prop === "breakerhandle") breaker = last.x < 80 ? "tx" : last.x < 180 ? "off" : "rx";
      if (prop === "senderhandle") sender = last.y < 150 ? "on" : "off";
    },
  };
  return {
    d: d as unknown as SpeedrunDriver,
    clicks,
    state: () => ({ flat, breaker, sender, needle, knob, tapper }),
  };
}

test("wireless(tx) works the three controls in order and ends on a transmitting morse key", async () => {
  const set = wirelessSet();
  const out = await run(set.d, "wireless", ["tx"]);
  expect(out.error).toBeUndefined();
  const s = set.state();
  expect(s).toMatchObject({ flat: WIRELESS_PANELS.tapper, breaker: "tx", sender: "on", knob: "on", tapper: "tx" });
  expect(s.needle).toBeGreaterThanOrEqual(TX_BAND.lo);
  expect(s.needle).toBeLessThanOrEqual(TX_BAND.hi);
  // breaker, sender and tuner each opened and put back, then the tapper
  expect(set.clicks).toEqual(["breaker", "ok", "sender", "ok", "tuner", "ok", "tapper"]);
  expect(out.said).toEqual([`needle ${s.needle}, tapper tx`]);
});

test("the needle is read fresh every frame — eighty swings from 200 arrive in band and stop there", async () => {
  // The needle is 200 and the band 34..40: a reading cached before the press
  // would say 200 for ever, and the tuner would swing its 120 and give up. That
  // the needle lands IN the band, and not past it, is the proof every frame was
  // steered by the reading it followed.
  const set = wirelessSet();
  await run(set.d, "wireless", ["breaker", "tx"]);
  await run(set.d, "wireless", ["sender", "on"]);
  const out = await run(set.d, "wireless", ["tuner", "tx"]);
  expect(out.error).toBeUndefined();
  expect(set.state().needle).toBe(TX_BAND.hi);
  expect(out.said).toEqual([`needle ${TX_BAND.hi}, knob on`]);
});

test("one control at a time starts and ends at the desk", async () => {
  const set = wirelessSet();
  const out = await run(set.d, "wireless", ["breaker", "rx"]);
  expect(out.error).toBeUndefined();
  expect(set.state()).toMatchObject({ flat: WIRELESS_MAIN, breaker: "rx" });
  expect(set.clicks).toEqual(["breaker", "ok"]);
  expect(out.said).toEqual(["breaker rx"]);
});

test("the receive bands are numbered, because which one is tuned decides the message", async () => {
  const set = wirelessSet();
  await run(set.d, "wireless", ["breaker", "rx"]);
  await run(set.d, "wireless", ["sender", "on"]);
  const out = await run(set.d, "wireless", ["tuner", "rx2"]);
  expect(out.error).toBeUndefined();
  // down from 200 two at a time, so it stops at the first even needle inside
  // rx2's band — and not in rx3's, which it passed through on the way
  expect(set.state().needle).toBe(132);
  expect(set.state().needle).toBeGreaterThanOrEqual(RX_BANDS[1].lo);
  expect(set.state().needle).toBeLessThanOrEqual(RX_BANDS[1].hi);
});

test("tuning before the breaker and sender tunes to nothing, and says so", async () => {
  // the order the header insists on: tuned() looks at the breaker and the sender
  // before it looks at the band, so the needle arrives and the knob stays off
  const set = wirelessSet();
  const out = await run(set.d, "wireless", ["tuner", "tx"]);
  expect(out.error).toBe(`the needle is at ${TX_BAND.hi} but the knob is "off", not "on"`);
});

test("the set is worked from the desk, and anywhere else is refused with the line that opens it", async () => {
  const inRoom = await run(wirelessSet({ flat: null }).d, "wireless", ["tx"]);
  expect(inRoom.error).toBe(
    `the wireless set is worked from the "${WIRELESS_MAIN}" flat and we are in the room — click(wireless) opens it`,
  );
  const inPanel = await run(wirelessSet({ flat: WIRELESS_PANELS.amp }).d, "wireless", ["tx"]);
  expect(inPanel.error).toContain(`we are in "${WIRELESS_PANELS.amp}"`);
});

test("a setting a control does not have is refused before its close-up is opened", async () => {
  const cases: [string[], string][] = [
    [["breaker", "up"], 'the breaker settles on tx, rx or off — not "up"'],
    [["sender", "loud"], 'the sender is on or off — not "loud"'],
    [["tuner", "rx4"], 'the tuner takes a band: tx (34..40) or rx1 (81..87), rx2 (127..133), rx3 (174..180) — not "rx4"'],
    [["tx", "now"], "wireless(tx) takes no second argument — did you mean wireless(now, …)?"],
  ];
  for (const [args, error] of cases) {
    const set = wirelessSet();
    const out = await run(set.d, "wireless", args);
    expect(out.error).toBe(error);
    // the setters refuse inside the close-up, so the panel was opened — but
    // nothing was MOVED
    expect(set.state()).toMatchObject({ breaker: "off", sender: "off", needle: 200 });
  }
});

test("the amp panel is not a wireless control, and the refusal says how to reach it", async () => {
  const set = wirelessSet();
  const out = await run(set.d, "wireless", ["amp"]);
  expect(out.error).toBe(
    'wireless does tx (the lot), or one of breaker, sender, tuner — not "amp". ' +
      "The amp panel is reachable with click(amp) and drives nothing.",
  );
  expect(set.clicks).toEqual([]);
});

// --- mapJump ---------------------------------------------------------------

/**
 * The map in the inventory band, and the deck plans behind it.
 *
 * house.shp c609: a click on a DARK band only lights it (activateinterface());
 * a click on a lit one opens the plans, at page 1 here. A page button turns the
 * plan, and a red area jumps.
 */
function deckPlans(opts: { savedeck?: string; band?: "dark" | "light"; dead?: boolean } = {}) {
  let band = opts.band ?? "dark";
  let flat: string | null = null;
  let set = "c73";
  const clicks: string[] = [];
  const names: string[] = [];
  const said: string[] = [];
  const d = {
    evaluate: async <T,>(expr: string): Promise<T> => {
      if (expr.includes('"savedeck"')) return (opts.savedeck ?? "") as T;
      if (expr.includes("(no map prop)")) return band as T;
      if (expr.includes('stateName || "") === "light"')) return (band === "light") as T;
      if (expr.includes("/^map (\\d+)$/i.exec")) {
        const m = /^map (\d+)$/.exec(flat ?? "");
        return (m ? Number(m[1]) : null) as T;
      }
      return null as T;
    },
    hold: async () => {},
    settle: async () => {},
    // the "did the click answer" wait: the map is up, or (from dark) the band lit
    tryHold: async (expr: string) => {
      if (!expr.includes("/^map \\d+$/i.test")) return true;
      return /^map \d+$/.test(flat ?? "") || (expr.includes("light") && band === "light");
    },
    aim: async (_kind: string, name: string) => {
      let i = names.indexOf(name);
      if (i < 0) i = names.push(name) - 1;
      return { x: i, y: 0 };
    },
    clickAt: async (x: number) => {
      const name = names[x];
      clicks.push(name);
      if (opts.dead) return;
      if (name === "map") {
        if (band !== "light") band = "light";
        else flat = "map 1";
      } else if (/^Button1[2-9]$/.test(name) && flat) {
        // the page buttons, in page order — mapjumps.gen.ts
        const page = ["Button18", "Button19", "Button12", "Button13", "Button14", "Button15", "Button16", "Button17"]
          .indexOf(name) + 1;
        flat = `map ${page}`;
      } else if (flat) {
        set = `jumped by ${name} on ${flat}`;
        flat = null;
      }
    },
  };
  return { d: d as unknown as SpeedrunDriver, clicks, said, where: () => set };
}

test("a dark band takes two clicks to open, then the page, then the stairwell", async () => {
  const m = deckPlans({ savedeck: "c" });
  const out = await run(m.d, "mapjump", ["STAIR2C"]);
  expect(out.error).toBeUndefined();
  // stair2c on deck c is page 4's Button22 (mapjumps.gen.ts)
  expect(m.clicks).toEqual(["map", "map", "Button13", "Button22"]);
  expect(m.where()).toBe("jumped by Button22 on map 4");
  expect(out.said).toEqual(["deck c"]);
});

test("a lit band opens on the first click, and page 1 needs no page button", async () => {
  const m = deckPlans({ band: "light" });
  const out = await run(m.d, "mapjump", ["stair2c"], { deck: "bd" });
  expect(out.error).toBeUndefined();
  expect(m.clicks).toEqual(["map", "Button46"]);
  expect(out.said).toEqual(["deck bd"]);
});

test("deck: is a preference — a deck the plan does not carry lands on the lowest page that does, and says so", async () => {
  const m = deckPlans({ band: "light" });
  const out = await run(m.d, "mapjump", ["turkstrs"], { deck: "c" });
  expect(out.error).toBeUndefined();
  expect(out.said).toEqual(["no turkstrs on deck c — took deck e instead", "deck e"]);
  expect(m.clicks.at(-1)).toBe("Button43");
});

test("a set no plan reaches is refused with the sets that are reachable", async () => {
  const out = await run(deckPlans().d, "mapjump", ["bedsit1"]);
  expect(out.error).toMatch(/^no red area for bedsit1 on any deck plan — the map reaches .*stair2c.*turkstrs/);
});

test("a map that never answers is retried three times, each miss reported, then refused", async () => {
  const m = deckPlans({ dead: true });
  const out = await run(m.d, "mapjump", ["stair2c"]);
  expect(m.clicks).toEqual(["map", "map", "map"]);
  expect(out.said).toEqual([1, 2, 3].map((n) => `click ${n} on the map did nothing in 4 s — map state "dark", retrying`));
  expect(out.error).toBe("the map would not open here (mapdisabled, or no bag/watch yet)");
});

/**
 * `until:` — jump again until something holds, for the Gorse-Joneses (#474).
 *
 * The plans above with a coin behind them: each red area pressed lands on the
 * next of `coins`, and `talking` reads the last one. `jonesok`'s state is the
 * globals the verb reads before it starts.
 */
function jonesLanding(coins: boolean[], globals: Record<string, number> = { mission: 1, phase: 1 }) {
  const m = deckPlans({ band: "light", savedeck: "c" });
  let talking = false;
  let jumps = 0;
  const inner = m.d.evaluate.bind(m.d);
  const clickAt = m.d.clickAt.bind(m.d);
  Object.assign(m.d, {
    evaluate: async <T,>(expr: string): Promise<T> => {
      if (expr.includes("viewer.conversing")) return talking as T;
      if (expr.includes('"jonesphase"')) return { tour: 0, jonesphase: 0, ...globals } as T;
      return inner(expr) as Promise<T>;
    },
    // gstair3 on deck c is page 4's Button41 (mapjumps.gen.ts): each press is a landing
    clickAt: async (x: number, ...rest: unknown[]) => {
      await (clickAt as (...a: unknown[]) => Promise<void>)(x, ...rest);
      if (m.clicks.at(-1) === "Button41") talking = coins[jumps++] ?? false;
    },
  });
  return { ...m, jumps: () => jumps };
}

test("until: jumps to the same landing again until someone talks, and says how many it took", async () => {
  const m = jonesLanding([false, false, true]);
  const out = await run(m.d, "mapjump", ["gstair3"], { deck: "c", until: "talking" });
  expect(out.error).toBeUndefined();
  expect(m.jumps()).toBe(3);
  expect(m.clicks.filter((n) => n === "Button41")).toHaveLength(3);
  expect(out.said.at(-1)).toBe("talking after 3 rides, deck c");
});

test("until: gives up after max: rides, saying so", async () => {
  const m = jonesLanding([]);
  const out = await run(m.d, "mapjump", ["gstair3"], { deck: "c", until: "talking", max: "4" });
  expect(m.jumps()).toBe(4);
  expect(out.error).toBe("4 rides and talking never came true");
});

test("until: never refuses on a guess — when max: runs out where jonesok is shut, the error says why", async () => {
  for (const [globals, why] of [
    [{ mission: 1, phase: 1, jonesphase: 1 }, /— note: jonesphase is already 1, so the Joneses will not come again/],
    [{ mission: 1, phase: 0 }, /— note: mission 1, phase 0 has no Joneses/],
    [{ mission: 2, phase: 1 }, /— note: mission 2 has the Joneses in phase 2 only, this is phase 1/],
  ] as const) {
    const m = jonesLanding([], globals);
    const out = await run(m.d, "mapjump", ["gstair3"], { deck: "c", until: "talking", max: "2" });
    expect(m.jumps()).toBe(2);
    expect(out.error).toMatch(/^2 rides and talking never came true/);
    expect(out.error).toMatch(why);
  }
});

test("someone else talking counts too: until: talking is anyone, whatever jonesok says", async () => {
  const m = jonesLanding([true], { mission: 1, phase: 1, jonesphase: 1 });
  const out = await run(m.d, "mapjump", ["gstair3"], { deck: "c", until: "talking" });
  expect(out.error).toBeUndefined();
  expect(out.said.at(-1)).toBe("talking after 1 ride, deck c");
});

// --- reset(seed:) ------------------------------------------------------------

/** a game that has or has not left its title menu, and what reset(seed:) did to it */
function seedable(started: boolean) {
  const log: string[] = [];
  const d = {
    evaluate: async (expr: string) => {
      if (expr.includes("props.size > 0")) return started;
      const seeded = /seedRandom\((\d+)\)/.exec(expr);
      if (seeded) log.push(`seeded ${seeded[1]} in place`);
      return null;
    },
    hold: async () => {},
    settle: async () => {},
    pinSeed: (seed: number) => log.push(`pinned ${seed}`),
    restart: async () => void log.push("restarted"),
  } as unknown as SpeedrunDriver;
  return { d, log };
}

test("reset(seed:) on a fresh game pins the seed and seeds it where it stands", async () => {
  const { d, log } = seedable(false);
  const r = await run(d, "reset", [], { seed: "360" });
  expect(r.error).toBeUndefined();
  expect(log).toEqual(["pinned 360", "seeded 360 in place"]);
});

test("reset(seed:) on a played game pins the seed and boots afresh", async () => {
  const { d, log } = seedable(true);
  const r = await run(d, "reset", [], { seed: "360" });
  expect(r.error).toBeUndefined();
  expect(log).toEqual(["pinned 360", "restarted"]);
});

test("reset(seed:) refuses a seed that is not a whole number, before touching the game", async () => {
  const { d, log } = seedable(true);
  const r = await run(d, "reset", [], { seed: "3.5" });
  expect(r.error).toMatch(/whole number/);
  expect(log).toEqual([]);
});
