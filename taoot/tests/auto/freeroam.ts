/**
 * Free roam: the tour the disc ships, and the doors it keeps shut.
 *
 *   npx vitest run taoot/tests/auto/freeroam.ts
 *
 * The page adds one thing to a mode the game already has, so these are the two
 * questions worth asking of it.
 *
 * The first is about the game: is the tour still a mode, and do the six doors
 * this page exists for still refuse one? That is read out of the corpus rather
 * than written down here, because if CyberFlix's scripts ever said something
 * else the page would have no reason to exist and should fail loudly.
 *
 * The second is about the page: given a door that refused, does
 * {@link openIfRefused} stand the right doorway up — the SAME doorway the
 * hotspot's own script would have used — so that the walk-through handler's
 * `propvisible ("door")` is satisfied and the ↑ that follows is the game's own?
 * That one is driven against a live session with the room really open.
 */
import { describe, test, expect } from "vitest";
import { gamefiles, gamefilesRoot } from "../../tools/gamefiles";
import { readSetFile } from "@dreamfactory/engine/df/set";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { sniffScript, scriptToText } from "@dreamfactory/engine/df/script";
import { newHost, drain, root } from "../harness";
import { DOOR_SPOTS } from "../../src/freeroam/doors.gen";
import {
  doorSpot,
  isDoorHotspot,
  openIfRefused,
  blockedWay,
  openLine,
  openWays,
  pickDoorway,
  satisfiable,
  stepIfRefused,
  stepLine,
  type DoorOutcome,
  type DoorSession,
  type HotspotClick,
} from "../../src/freeroam/doors";
import { run as runConsole } from "../../src/devmode/console";

const index = gamefiles(gamefilesRoot());

/** the editions this game ships, as the trees are named on disk */
const EDITIONS = ["en", "de", "fr", "nl", "ru", "ja", "demo"];

/** every container of a container file's bytes, as text */
function containerTextOf(bytes: Uint8Array): string {
  return readContainerFile(bytes)
    .containers.map((c) => {
      const toks = sniffScript(c.data);
      return toks ? scriptToText(toks) : "";
    })
    .join("\n")
    .replace(/\s+/g, " ");
}

/** every container of a plain container file, as text */
function containerText(name: string, disc: 1 | 2 = 1): string {
  index.setDisc(disc);
  const bytes = index.provider(name);
  if (!bytes) throw new Error(`no ${name} in the gamefiles tree`);
  return readContainerFile(bytes)
    .containers.map((c) => {
      const toks = sniffScript(c.data);
      return toks ? scriptToText(toks) : "";
    })
    .join("\n")
    .replace(/\s+/g, " ");
}

/** BOOTFILE, where the two modes are chosen between */
const bootText = (): string => containerText("bootfile");
/** a stage file — the deck map lives in one */
const stgText = (name: string): string => containerText(name, 2);
/** a shop file — the interface band lives in one */
const shpText = (name: string): string => containerText(name);

/**
 * The text of one set's scripts, joined — for asking the corpus a question.
 *
 * The CD matters and is named: 21 rooms ship on both in their own act's state,
 * and four exist on one only. A question asked of the wrong disc's copy is a
 * question about a different room.
 */
function setText(name: string, disc: 1 | 2 = 1): string {
  index.setDisc(disc);
  const bytes = index.provider(name);
  if (!bytes) throw new Error(`no ${name} in the gamefiles tree`);
  const set = readSetFile(bytes);
  return set.file.containers
    .map((c) => {
      const toks = sniffScript(c.data);
      return toks ? scriptToText(toks) : "";
    })
    .join("\n");
}

/** a globals bag shaped like the interpreter's, for the picker */
const globals = (o: Record<string, unknown>) => ({
  get: (n: string) => (n in o ? o[n] : 0),
});

/** what `advancetour()` leaves behind: no story at all */
const TOUR = { tour: 1, mission: -1, phase: -1, neckphase: -1, letterphase: -1 };

describe("the tour is still a mode, and still shuts these doors", () => {
  /**
   * `boot()` picks between two modes from a click region in a movie, and
   * `advancetour()` is the branch this page is. If either goes, the page is
   * built on nothing — so both are read out of the shipped boot library rather
   * than assumed.
   */
  test("boot() reads the mode off playmode.mov, and advancetour is the other branch", () => {
    const boot = bootText();
    expect(boot, "the menu movie is played and its click region read").toMatch(
      /playmovie \("playmode\.mov"\) .*?if actionframe \(1\) tour = true else tour = false endif/,
    );
    expect(boot, "and the flag chooses which advance runs").toMatch(
      /if tour sendtostage \(advancetour \(\)\)/,
    );
    expect(boot, "the tour puts the story back to nothing").toMatch(
      /code advancetour \(\).*?mission = -1 phase = -1/,
    );
    expect(boot, "...and mounts the second CD").toMatch(
      /code advancetour \(\).*?setpath \(2\) initall \("c73"/,
    );
  });

  /**
   * The map is the tour's other half: `mapdisabled()` opens with the flag and
   * answers false before it looks at the bag, the watch, mission 4 or the eight
   * rooms it otherwise refuses.
   */
  test("the deck map works everywhere in a tour", () => {
    const text = stgText("map.stg").replace(/\s+/g, " ");
    expect(text).toMatch(/code mapdisabled \(\) global tour, mission if tour return false endif/);
  });

  /** ...and the interface hands over the map without being asked */
  test("a tour is given the map and the ship outright", () => {
    const text = shpText("house.shp").replace(/\s+/g, " ");
    expect(text).toMatch(
      /if tour sendtoprop \("map", addmap \(\)\) sendtoprop \("ship", addship \(\)\)/,
    );
  });

  /**
   * The six refusals, read out of the rooms they are in.
   *
   * Each is a door hotspot whose `mousedown` opens `if tour` and answers with a
   * sound instead of `setupprop` — the knock at a passenger's cabin, and the
   * lounge saying it is locked. The pairs are `[room, the sound it answers
   * with]`, and what is asserted is that the arm is still there, still first,
   * and still not an opening.
   */
  const REFUSALS: [string, string][] = [
    ["halla.set", "knock1"], // A-14, Sasha's
    ["hallb.set", "knock1"], // B-59 (Conk) and B-70 (Charlotte)
    ["hallc.set", "knock1"], // C-59 and C-78
    ["lnghall.set", "doorlocked"], // the 1st Class Lounge — see below
  ];
  for (const [room, sound] of REFUSALS) {
    test(`${room} still answers a tour with ${sound}`, () => {
      // disc 2, which is the disc `advancetour` mounts (`setpath (2)`)
      const text = setText(room, 2).replace(/\s+/g, " ");
      expect(text, "the tour arm is still in this room's doors").toMatch(
        new RegExp(`if tour ${" "}?voicesound \\("${sound}"\\) exitcode`),
      );
    });
  }

  /** ...and the other direction, so this is not just a search for a string:
   *  rooms where the tour arm OPENS the door are still opening it. */
  test("the rooms the tour lets through still let it through", () => {
    for (const room of ["c73.set", "control.set"]) {
      const text = setText(room, 2).replace(/\s+/g, " ");
      expect(text, `${room} opens for a tour`).toMatch(
        /if tour sendtoprop \("door", setupprop \("[^"]+"\)\) exitcode/,
      );
    }
  });
});

describe("which editions have a tour at all", () => {
  /**
   * The free-roam page offers the trees that ship `opentour.mov`, because that
   * film is the tour's own opening and `advancetour()` is the only thing in the
   * corpus that plays it. That is a PROXY — the page reads a manifest of file
   * paths and cannot parse a BOOTFILE to decide what to put in a picker — so
   * this is what keeps it honest: the marker and the thing it stands for are
   * checked against each other, per tree, in the data.
   */
  test("a tree ships the tour's film exactly when its boot has a tour", () => {
    const rows = EDITIONS.map((edition) => {
      const tree = gamefiles(gamefilesRoot(), edition);
      const boot = tree.provider("bootfile");
      const hasTour = !!boot && /code advancetour/.test(containerTextOf(boot));
      const hasFilm = tree.names(/^opentour\.mov$/i).length > 0;
      return { edition, hasTour, hasFilm };
    });
    // every tree answers the same for both, whichever way round
    expect(
      rows.filter((r) => r.hasTour !== r.hasFilm),
      "a tree where the film and the boot disagree",
    ).toEqual([]);
    // ...and it is not vacuous: some have one and some do not
    expect(rows.some((r) => r.hasTour), "some tree has a tour").toBe(true);
    expect(rows.some((r) => !r.hasTour), "and some tree has none").toBe(true);
  });

  /** the 1996 demo is the one without, and it is a different cut rather than a
   *  translation: nine rooms, and no `tour` in its boot at all */
  test("the demo has no tour, and is not just a smaller ship", () => {
    const demo = gamefiles(gamefilesRoot(), "demo");
    const boot = containerTextOf(demo.provider("bootfile")!);
    expect(boot).not.toMatch(/code advancetour/);
    expect(boot).not.toMatch(/playmode\.mov/);
    expect(boot, "the flag the whole mode turns on is not even declared").not.toMatch(/\btour\b/);
    expect(demo.names(/\.set$/).length).toBeLessThan(
      gamefiles(gamefilesRoot(), "en").names(/\.set$/).length,
    );
  });
});

describe("the doorway table is the corpus", () => {
  test("every doorway id is a string that set's own scripts call setupprop with", () => {
    const seen = new Map<string, string>();
    const missing: string[] = [];
    for (const spot of DOOR_SPOTS) {
      // `disc: 0` is a hotspot both CDs agree about, so either copy answers
      const cd = spot.disc === 0 ? 1 : spot.disc;
      const key = `${spot.set}:${cd}`;
      const text = seen.get(key) ?? setText(`${spot.set}.set`, cd);
      seen.set(key, text);
      for (const way of spot.doorways) {
        if (!text.includes(`setupprop ("${way.id}")`)) {
          missing.push(`${spot.set}/${spot.scene}/${spot.view}: ${way.id}`);
        }
      }
    }
    expect(missing, "a doorway nothing in that room opens").toEqual([]);
  });

  test("every hotspot in it is one boot's SPACE key would send a mousedown to", () => {
    // BOOTFILE's keydown: `if paint = "door" | paint = "locked" | paint = "knock"`
    const odd = DOOR_SPOTS.filter((s) => !/^(door|locked|knock)/i.test(s.paint));
    expect(odd.map((s) => s.paint), "a hotspot the game would not treat as a door").toEqual([]);
  });

  /**
   * Every hotspot resolves SOMEWHERE.
   *
   * Not in every state — a mirrored corridor's door belongs to one side and
   * picks as none on the other, which is the point of it. What would be a fault
   * is a hotspot that resolves nowhere at all: a doorway written under a
   * condition no place can satisfy is a door this page could never open.
   */
  test("every hotspot has a place it opens from", () => {
    const PLACES = [
      { hallside: "star" },
      { hallside: "port" },
      ...["bd", "a", "b", "c", "d", "e", "f", "g", "stair1c1", "gstair2", "boil1", "boil5"].map(
        (savedeck) => ({ savedeck }),
      ),
    ];
    const stuck = DOOR_SPOTS.filter(
      (s) => !PLACES.some((p) => pickDoorway(s, globals({ ...TOUR, ...p }))),
    );
    expect(stuck.map((s) => `${s.set}/${s.view}`), "a doorway no standpoint reaches").toEqual([]);
  });
});

describe("a door is worth opening only where it goes somewhere", () => {
  /**
   * D-19 and its two sisters.
   *
   * `clarisdoor` opens so Claris can stand in it; D deck's own `uparrow`
   * handlers are at `view103` and `view32`, and there is no room behind that
   * cabin number in the game at all. Read from the data rather than listed here:
   * the table carries what the room's `keydown` reaches from each view.
   */
  const NOWHERE: [string, string, string, string][] = [
    ["halld", "scene69", "view79", "knock"], // D-19, Claris's
    ["hallf2c", "scene59", "view76", "knock"], // F deck, Penny's
    ["hallf3c", "scene11", "view15", "knock"], // below, Shay's
  ];
  for (const [set, scene, view, paint] of NOWHERE) {
    test(`${set}/${view} is a doorway, not a way through`, () => {
      const spot = doorSpot(set, scene, view, paint, 2);
      expect(spot, "the table has this hotspot").toBeTruthy();
      expect(spot!.doorways.length, "it has a doorway the script opens").toBeGreaterThan(0);
      expect(spot!.leads, "...and nothing behind it").toEqual([]);
      expect(openWays(spot!, globals(TOUR)), "so there is no way through").toEqual([]);
    });
  }

  /**
   * The 1st Class Lounge is the OTHER way a door leads nowhere, and it does not
   * look like the first: the step exists and reaches `lounge1c`. It is refused
   * above the door —
   *
   *     if currentview () = "view12" & arg = "uparrow" & (tour | mission < 4)
   *         exitcode
   *
   * — so in a tour the ↑ never gets as far as `propvisible ("door")`. A door
   * opened there would swing on a step that cannot be taken, which is why the
   * condition travels with the lead.
   */
  test("the lounge's step is refused in a tour, above the door rather than by it", () => {
    const spot = doorSpot("lnghall", "scene10", "view12", "door", 2);
    // two, one per staircase — the room is entered at a different standpoint
    // depending on which way you came up
    expect([...new Set(spot!.leads.map((l) => l.to))], "the step reaches the lounge").toEqual([
      "lounge1c",
    ]);
    expect(
      spot!.leads.every((l) =>
        l.when.every((arm) =>
          arm.some((c) => c.var === "tour" && c.op === "=" && c.value === false),
        ),
      ),
      "and every way to it is out of a tour",
    ).toBe(true);
    const g = globals({ ...TOUR, savedeck: "gstair2" });
    expect(openWays(spot!, g), "so the game will not take it").toEqual([]);
    // ...and that is exactly what the page stands in for, at the standpoint the
    // script names for the staircase you came up
    expect(blockedWay(spot!, g)).toMatchObject({
      to: "lounge1c",
      scene: "scene14",
      view: "view37",
    });
    expect(stepLine(blockedWay(spot!, g)!)).toBe(
      'sendtostage (gotospecial ("lounge1c", "scene14", "view37"))',
    );
    // off the other staircase it is the other half of the room
    expect(blockedWay(spot!, globals({ ...TOUR, savedeck: "stair1c1" }))).toMatchObject({
      scene: "scene10",
      view: "view16",
    });
    // ...and it IS a way through at mission 4 outside a tour, which is the half
    // that proves the condition is read rather than the door written off
    expect(
      openWays(spot!, globals({ tour: 0, mission: 4, savedeck: "gstair2" })).map((l) => l.to),
    ).toEqual(["lounge1c"]);
  });

  test("the five cabin doors this page opens do go somewhere", () => {
    const CABINS: [string, string, string, string][] = [
      ["halla", "scene51", "view57", "a14"],
      ["hallb", "scene29", "view40", "b59"],
      ["hallb", "scene31", "view48", "b70"],
      ["hallc", "scene31", "view48", "c59"],
      ["hallc", "scene31", "view48", "c78"],
    ];
    for (const [set, scene, view, to] of CABINS) {
      const spot = doorSpot(set, scene, view, "door", 2);
      expect(spot!.leads.map((l) => l.to), `${set}/${view}`).toContain(to);
    }
  });

  test("an ordering test is read as one", () => {
    const g = globals({ mission: -1 });
    expect(satisfiable([[{ var: "mission", op: "<", value: 4 }]], g)).toBe(true);
    expect(satisfiable([[{ var: "mission", op: ">=", value: 4 }]], g)).toBe(false);
    // no arms at all is unconditional; one arm holding entirely is enough
    expect(satisfiable([], g)).toBe(true);
    expect(
      satisfiable(
        [
          [{ var: "mission", op: ">=", value: 4 }],
          [{ var: "mission", op: "=", value: -1 }],
        ],
        g,
      ),
    ).toBe(true);
  });
});

describe("a door belongs to one side of the ship", () => {
  /**
   * B-62 and B-59 are the same wall.
   *
   * Each passenger corridor is one set used for both sides, mirrored, and
   * `hallside` says which — so `Scene29/View40` carries B-59's door to starboard
   * and B-62's to port, with `hallb-b59` behind it either way. The game never
   * lets that matter: the doorknob refuses unless `hallside = "star"`. Free roam
   * violates story state on purpose and must not violate this, or B-62 opens and
   * the player is standing in B-59.
   */
  const SIDED: [string, string, string, string, string | null, string | null][] = [
    // set, scene, view, doorway, starboard, port
    ["hallb", "scene29", "view40", "B-59", "hallb-b59", null],
    ["hallb", "scene31", "view48", "B-70", null, "hallb-b70"],
    ["hallc", "scene31", "view48", "the C-deck cabins", "hallc-c59", "hallc-c78"],
    ["halla", "scene51", "view57", "A-14", null, "sashadoor"],
  ];
  for (const [set, scene, view, what, star, port] of SIDED) {
    test(`${what} opens on its own side and not the other`, () => {
      const spot = doorSpot(set, scene, view, "door", 2)!;
      expect(pickDoorway(spot, globals({ ...TOUR, hallside: "star" }))?.id ?? null).toBe(star);
      expect(pickDoorway(spot, globals({ ...TOUR, hallside: "port" }))?.id ?? null).toBe(port);
    });
  }

  /** ...while story state is violated exactly as before */
  test("a door is still opened whatever the story says", () => {
    const spot = doorSpot("hallb", "scene29", "view40", "door", 2)!;
    // every arm wants `letterphase` somewhere and `tour = false` in all of them
    expect(pickDoorway(spot, globals({ ...TOUR, hallside: "star" }))?.id).toBe("hallb-b59");
  });
});

describe("the picker chooses what the script would have chosen", () => {
  /**
   * Eight hotspots offer more than one doorway. These are the ones where the
   * choice is a condition the script tests, and the expected id is read off
   * that script — `whitelight` picks the lit or the dark C-78 door, `hallside`
   * picks which C-deck cabin is on this side of the corridor.
   */
  const CASES: [string, string, string, Record<string, unknown>, string][] = [
    ["halla", "scene51", "view57", { ...TOUR, hallside: "port" }, "sashadoor"],
    ["hallb", "scene29", "view40", { ...TOUR, hallside: "star" }, "hallb-b59"],
    ["hallb", "scene31", "view48", { ...TOUR, hallside: "port" }, "hallb-b70"],
    ["hallc", "scene31", "view48", { ...TOUR, hallside: "star" }, "hallc-c59"],
    ["hallc", "scene31", "view48", { ...TOUR, hallside: "port" }, "hallc-c78"],
    ["lnghall", "scene10", "view12", { ...TOUR }, "lnghall-lounge"],
    ["c78", "scene14", "view18", { ...TOUR, whitelight: "off" }, "c78-hallc d"],
    ["c78", "scene14", "view18", { ...TOUR, whitelight: "on" }, "c78-hallc l"],
  ];
  for (const [set, scene, view, state, want] of CASES) {
    const which = Object.entries(state).find(([k]) => k === "hallside" || k === "whitelight");
    test(`${set}/${view}${which ? ` with ${which[0]} = ${which[1]}` : ""} opens ${want}`, () => {
      const spot = doorSpot(set, scene, view, "door", 2);
      expect(spot, "the table has this hotspot").toBeTruthy();
      expect(pickDoorway(spot!, globals(state))?.id).toBe(want);
    });
  }

  test("a hotspot that is not a door is not one this page answers", () => {
    // the three BOOTFILE's SPACE key looks for, under whatever the artists spelled
    expect(isDoorHotspot("door")).toBe(true);
    expect(isDoorHotspot("door2")).toBe(true);
    expect(isDoorHotspot("knock1")).toBe(true);
    expect(isDoorHotspot("locked")).toBe(true);
    expect(isDoorHotspot("porthole")).toBe(false);
    expect(isDoorHotspot("")).toBe(false);
  });
});

describe("a refused door, opened", () => {
  /**
   * The whole page in one test, against a live session with B deck's corridor
   * really open — and driven the way the page is driven.
   *
   * The page does not listen for clicks. It listens for `onHotspotClick`, which
   * the engine fires from the bottom of the dispatch chain once every handler in
   * it has run, and that ordering is the thing under test: a page that judged on
   * `pointerdown` was AHEAD of the game on a touch screen (TouchGestures holds a
   * press back to tell a tap from a swipe), opened the door itself, and then
   * watched the game's own `setupprop` arrive and restart the animation from
   * shut.
   *
   * So the hook is installed exactly as `freeroam-page.ts` installs it, a real
   * `mousedown` is sent to the hotspot, and what is asserted afterwards is not
   * "a prop moved" but the thing the player is owed — that `propvisible
   * ("door")`, the condition the walk-through handler tests, now answers true.
   */
  interface Knocker {
    session: DoorSession;
    /** press the hotspot, as a click or SPACE both end up doing */
    knock: () => Promise<void>;
    /** what the page's hook saw, in order */
    seen: HotspotClick[];
    /** what the page's own judgement did, in order */
    done: DoorOutcome[];
  }

  /**
   * A room with the page's hook installed on it.
   *
   * `paint` is looked up in the view rather than assumed, so a hotspot renamed
   * in the data fails here instead of silently never being pressed.
   */
  const room = async (
    file: string,
    sceneName: string,
    viewName: string,
    paint: string,
    state: Record<string, string | number> = {},
  ): Promise<Knocker> => {
    const { host, session, viewer } = await newHost();
    await host.loadServerSet(file);
    const g = session.interp.globals;
    for (const [k, v] of Object.entries({ ...TOUR, ...state })) g.set(k, v as number);
    const v = viewer();
    const sceneIdx = v.set.scenes.findIndex(
      (x) => x.sceneName.toLowerCase() === sceneName,
    );
    const scene = v.set.scenes[sceneIdx];
    expect(scene, `${file} has ${sceneName}`).toBeTruthy();
    const viewIdx = scene.views.findIndex((x) => x.viewName.toLowerCase() === viewName);
    expect(viewIdx, `${sceneName} has ${viewName}`).toBeGreaterThanOrEqual(0);
    const objIdx = scene.views[viewIdx].objects.findIndex(
      (o) => o.identifier.toLowerCase() === paint,
    );
    expect(objIdx, `${viewName} has a ${paint} hotspot`).toBeGreaterThanOrEqual(0);

    const seen: HotspotClick[] = [];
    const done: DoorOutcome[] = [];
    const pending: Promise<unknown>[] = [];
    // ...as taoot/src/freeroam-page.ts installs it
    session.onHotspotClick = (hit): void => {
      seen.push({ paint: hit.paint, set: hit.set, scene: hit.scene, view: hit.view });
      if (!isDoorHotspot(hit.paint)) return;
      pending.push(
        openIfRefused(session as unknown as DoorSession, { ...hit, disc: 2 }).then((o) =>
          done.push(o),
        ),
      );
    };
    return {
      session: session as unknown as DoorSession,
      knock: async () => {
        await session.track(v.scripts.mouseDown(sceneIdx, viewIdx, objIdx, paint));
        await drain();
        await Promise.all(pending);
        await drain();
      },
      seen,
      done,
    };
  };

  const isOpen = async (session: DoorSession): Promise<boolean> => {
    const res = await runConsole(session as never, `return (propvisible ("door"))`);
    return !!res.value;
  };

  test("the game knocks, and the page opens the door it would not", async () => {
    const at = await room("hallb.set", "scene29", "view40", "door", { hallside: "star" });
    expect(await isOpen(at.session), "nothing is open to begin with").toBe(false);
    await at.knock();
    expect(at.seen.length, "the press was reported once, not twice").toBe(1);
    expect(at.seen[0], "and it says where it happened").toEqual({
      paint: "door",
      set: "hallb",
      scene: "Scene29",
      view: "View40",
    });
    expect(at.done, "the doorway the hotspot's own script names, and the room").toEqual([
      { opened: "hallb-b59", to: "b59" },
    ]);
    expect(await isOpen(at.session), 'propvisible("door") — the walk-through\'s condition').toBe(
      true,
    );
  }, 60_000);

  /**
   * ...and it does NOT step in where the game said yes.
   *
   * The C-73 door opens for a tour, so nothing here should touch it. This is the
   * half that keeps the page honest: a page that opened every door would take
   * the knock, the speech and the character who answers away from every scene
   * that has one — and would run a second `setupprop` over the game's, which is
   * exactly the flicker that pointerdown listening caused.
   */
  test("a door the game opens is left entirely alone", async () => {
    const at = await room("c73.set", "scene49", "view55", "door");
    await at.knock();
    expect(at.done, "the game had already opened it").toEqual([{ skipped: "already-open" }]);
    expect(await isOpen(at.session)).toBe(true);
  }, 60_000);

  /**
   * A door with nothing behind it stays shut.
   *
   * B deck's corridor carries a `locked` hotspot in the same view as Conk's
   * door — the cabin across the way, which opens in no build and has no
   * `setupprop` anywhere in its script. It is door-ish by name, so it is judged;
   * there is simply no doorway to stand the prop up in, and free roam cannot
   * invent one.
   */
  test("a door the game never gave a doorway is not opened", async () => {
    const at = await room("hallb.set", "scene29", "view40", "locked", { hallside: "star" });
    await at.knock();
    expect(at.seen.map((h) => h.paint), "the engine reports it").toEqual(["locked"]);
    expect(at.done, "...and there is nothing behind it to open").toEqual([
      { skipped: "no-doorway" },
    ]);
    expect(await isOpen(at.session), "so nothing opened").toBe(false);
  }, 60_000);

  /**
   * D-19, through the page rather than through the table.
   *
   * The knock is the game's and still plays; what this asserts is that nothing
   * opens afterwards, because there is no room on the other side to open onto.
   */
  test("a door with no room behind it is knocked on and left shut", async () => {
    const at = await room("halld.set", "scene69", "view79", "knock");
    await at.knock();
    expect(at.seen.map((h) => h.paint), "the press reached the hotspot").toEqual(["knock"]);
    expect(at.done, "and D-19 is not a place to be let into").toEqual([
      { skipped: "leads-nowhere" },
    ]);
    expect(await isOpen(at.session), "so the door stays shut").toBe(false);
  }, 60_000);

  /**
   * The 1st Class Lounge, which needs both halves of the page.
   *
   * Its door opens like any other — there IS a room behind it — and then the ↑
   * is eaten by the corridor's own guard above the door, so the page takes the
   * step with the `gotospecial` the script below that guard holds. Both are
   * driven here through the hooks the page uses, and what is asserted at the end
   * is the room.
   */
  test("the lounge opens, and the step a tour refuses is taken", async () => {
    const at = await room("lnghall.set", "scene10", "view12", "door", { savedeck: "gstair2" });
    await at.knock();
    expect(at.done, "the door is a door: it opens").toEqual([
      { opened: "lnghall-lounge", to: undefined },
    ]);
    expect(await isOpen(at.session), "and stands open").toBe(true);

    const out = await stepIfRefused(at.session, {
      set: "lnghall",
      scene: "scene10",
      view: "view12",
      paint: "door",
      disc: 2,
    });
    expect(out, "...and the ↑ goes through").toEqual({ stepped: "lounge1c" });
  }, 60_000);

  test("the step is not taken while the door is shut", async () => {
    const at = await room("lnghall.set", "scene10", "view12", "door", { savedeck: "gstair2" });
    const out = await stepIfRefused(at.session, {
      set: "lnghall",
      scene: "scene10",
      view: "view12",
      paint: "door",
      disc: 2,
    });
    expect(out, "a closed door is not a way through").toEqual({ skipped: "shut" });
  }, 60_000);

  test("...and never where the game would take the step itself", async () => {
    const at = await room("hallb.set", "scene29", "view40", "door", { hallside: "star" });
    await at.knock();
    const out = await stepIfRefused(at.session, {
      set: "hallb",
      scene: "scene29",
      view: "view40",
      paint: "door",
      disc: 2,
    });
    expect(out, "B-59's own ↑ works — nothing to stand in for").toEqual({ skipped: "no-block" });
  }, 60_000);

  /**
   * The hook is for a press, not for a hover.
   *
   * `setcursor` runs the same chain over the same hotspot every time the pointer
   * crosses it, so a hook that fired for the whole chain rather than for
   * `mousedown` would open a door you had merely looked at.
   */
  test("moving the pointer over a door is not pressing it", async () => {
    const { host, session, viewer } = await newHost();
    await host.loadServerSet("hallb.set");
    const seen: string[] = [];
    session.onHotspotClick = (hit) => void seen.push(hit.paint);
    const v = viewer();
    const sceneIdx = v.set.scenes.findIndex((x) => x.sceneName.toLowerCase() === "scene29");
    const viewIdx = v.set.scenes[sceneIdx].views.findIndex(
      (x) => x.viewName.toLowerCase() === "view40",
    );
    const objIdx = v.set.scenes[sceneIdx].views[viewIdx].objects.findIndex(
      (o) => o.identifier.toLowerCase() === "door",
    );
    await session.track(v.scripts.setCursor(sceneIdx, viewIdx, objIdx, "door"));
    await drain();
    expect(seen, "a hover is not a press").toEqual([]);
  }, 60_000);

  test("the line it runs is the line the script runs", () => {
    expect(openLine("hallb-b59")).toBe('sendtoprop ("door", setupprop ("hallb-b59"))');
    const text = setText("hallb.set", 2).replace(/\s+/g, " ");
    expect(text, "verbatim, spacing included").toContain(openLine("hallb-b59"));
  });
});
