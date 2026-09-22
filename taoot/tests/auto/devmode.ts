/**
 * Developer mode: the menu against TI.EXE and BOOTFILE, and the two modifier
 * probes the whole flag depends on.
 *
 *   npx vitest run taoot/tests/auto/devmode.ts
 *
 * The menu is GENERATED out of the executable's `RT_MENU` resource
 * (taoot/tools/devmenu.ts), so the interesting question is not whether the
 * generator agrees with itself. It is whether the thing it emitted can be used:
 * every command on the bar names a case BOOTFILE's `menuselect` actually has, or
 * is one of the few this page knows is a hole and says so. That is the same gate
 * the deck map's jump table carries, and it exists for the same reason — a name
 * that resolves to nothing is a button that does nothing, and a menu of those is
 * indistinguishable from a broken page.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gamefilePath, gamefiles, gamefilesRoot } from "../../tools/gamefiles";
import { parseSave } from "@dreamfactory/engine/df/savegame";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { Value } from "@dreamfactory/engine/runtime/interp";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { readStgFile, readStgRegions } from "@dreamfactory/engine/df/stg";
import { readSetFile } from "@dreamfactory/engine/df/set";
import { sniffScript, scriptToText } from "@dreamfactory/engine/df/script";
import { newHost, drain, root } from "../harness";

const index = gamefiles(gamefilesRoot());
import { MAP_AREAS, areasOn, boxOf, boxesOn } from "../../src/devmode/map-overlay";
import {
  History as ConsoleHistory,
  run as runConsole,
  wrap as wrapConsole,
} from "../../src/devmode/console";
import {
  DEV_MENU,
  EDITOR_COMMANDS,
  NO_HANDLER,
  accelerators,
  commands,
  inertReason,
  parseLabel,
} from "../../src/devmode/menu";

// --- the labels ------------------------------------------------------------

test("a stored label splits into words, an access key and a shortcut hint", () => {
  expect(parseLabel("&Debug On/Off\tCtrl+D")).toEqual({
    text: "Debug On/Off",
    accessKey: "d",
    hint: "Ctrl+D",
  });
  // the mark is not always on the first letter — nine of the labels move it to
  // keep the Scripts menu's accelerators distinct
  expect(parseLabel("S&cene script\tCtrl+C")).toEqual({
    text: "Scene script",
    accessKey: "c",
    hint: "Ctrl+C",
  });
  expect(parseLabel("&File"), "a menu title carries no hint").toEqual({
    text: "File",
    accessKey: "f",
    hint: "",
  });
});

// --- the menu, as a menu ---------------------------------------------------

test("the bar is TI.EXE's four menus, and every command is reachable by a shortcut", () => {
  expect(DEV_MENU.map((m) => parseLabel(m.label).text)).toEqual([
    "File",
    "Options",
    "Sound",
    "Scripts",
  ]);
  const all = commands();
  // every one carries a Ctrl accelerator, and no two carry the same
  const keys = all.map((c) => parseLabel(c.label).hint);
  expect(keys.every((k) => /^Ctrl\+.$/.test(k)), keys.join(" ")).toBe(true);
  expect(new Set(keys).size, "no shortcut is claimed twice").toBe(all.length);
  // ...and the table the page drives them from agrees, lowercased both sides
  expect(accelerators().get("ctrl+d")).toBe("debug on/off");
  expect(accelerators().size).toBe(all.length);
  // the Win32 command ids are the resource's own and unique
  expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
});

// --- the menu, against the script that answers it --------------------------

/** the cases BOOTFILE's `menuselect` actually switches on */
function menuselectCases(): string[] {
  const file = readContainerFile(new Uint8Array(readFileSync(gamefilePath("bootfile"))));
  for (const c of file.containers) {
    if (!c?.data) continue;
    const toks = sniffScript(c.data);
    if (!toks) continue;
    const text = scriptToText(toks);
    const at = text.indexOf("code menuselect");
    if (at < 0) continue;
    const body = text.slice(at, text.indexOf("\nendcode", at));
    return [...body.matchAll(/^\s*case\s+"([^"]*)"/gim)].map((m) => m[1].toLowerCase());
  }
  throw new Error("no menuselect handler in the BOOTFILE");
}

test("every command on the bar names a case BOOTFILE has — or is a known hole", () => {
  const cases = new Set(menuselectCases());
  // the switch is real and sizeable; if this ever came back empty the rest of
  // the test would pass by vacuity
  expect(cases.size).toBeGreaterThan(20);
  expect(cases.has("debug on/off"), "the flag's own switch").toBe(true);

  for (const c of commands()) {
    const known = cases.has(c.select);
    if (NO_HANDLER.includes(c.select)) {
      expect(known, `${c.select} is declared a hole, so it must really be one`).toBe(false);
    } else {
      expect(known, `${c.select} ("${c.label}") is a case of menuselect`).toBe(true);
    }
  }
});

test("the script editor commands are the nine the Scripts menu carries", () => {
  const scripts = DEV_MENU.find((m) => parseLabel(m.label).text === "Scripts")!;
  const onMenu = scripts.items.filter((e) => !e.separator).map((e) => (e as { select: string }).select);
  expect([...onMenu].sort()).toEqual([...EDITOR_COMMANDS].sort());
  // ...and every one of them says why it is greyed, while a live one says nothing
  for (const s of EDITOR_COMMANDS) expect(inertReason(s)).not.toBe("");
  expect(inertReason("debug on/off")).toBe("");
  expect(inertReason("volume 7")).toBe("");
});

/**
 * BOOTFILE's `menuselect` has one case the bar does not: `"abort"`.
 *
 * That is not an omission at either end. It is the keyboard abort — `keyaborts
 * (debugging)` on the boot's next line, and "Programmer keyboard abort." in
 * TI.EXE's string table — so the engine raised it from a key, never from the
 * menu, and a bar that offered it would be inventing an item.
 */
test("abort is a case with no menu item, because it was a key", () => {
  expect(menuselectCases()).toContain("abort");
  expect(commands().some((c) => c.select === "abort")).toBe(false);
});

// --- the two probes --------------------------------------------------------

function callBuiltin(session: GameSession, name: string, ...args: Value[]): Value {
  const interp = session.interp;
  return interp.builtins.get(name)!(interp, args, { t: "call", name, args: [] } as never, null as never) as Value;
}

/**
 * The change the whole page rests on, and the one with a blast radius outside it.
 *
 * `optionkey()` and `commandkey()` used to be `() => 0`. They read the session
 * now, and the session leaves them false — so the play page, which sets neither,
 * still gets the 0 it always got. That equivalence is the thing to pin: the
 * regression this could cause is not on the dev page, it is a player suddenly
 * able to option-drag a smokestack prop out of shape.
 */
test("optionkey and commandkey answer 0 until a page says otherwise", () => {
  const session = new GameSession(() => null, new NullAudioSink());
  expect(session.altDown, "a fresh session holds neither").toBe(false);
  expect(session.metaDown).toBe(false);
  expect(callBuiltin(session, "optionkey")).toBe(0);
  expect(callBuiltin(session, "commandkey")).toBe(0);

  session.altDown = true;
  expect(callBuiltin(session, "optionkey")).toBe(1);
  expect(callBuiltin(session, "commandkey"), "one does not raise the other").toBe(0);

  session.metaDown = true;
  expect(callBuiltin(session, "commandkey")).toBe(1);

  session.altDown = false;
  session.metaDown = false;
  expect([callBuiltin(session, "optionkey"), callBuiltin(session, "commandkey")]).toEqual([0, 0]);
});

test("shiftkey is unchanged, and independent of the other two", () => {
  const session = new GameSession(() => null, new NullAudioSink());
  expect(callBuiltin(session, "shiftkey")).toBe(0);
  session.altDown = true;
  expect(callBuiltin(session, "shiftkey"), "option is not shift").toBe(0);
  session.shiftDown = true;
  expect(callBuiltin(session, "shiftkey")).toBe(1);
});

// --- the deck map's developer areas ----------------------------------------

/**
 * The 15 red areas the deck map keeps behind the flag, read off MAP.STG.
 *
 * `taoot/tools/mapjumps.ts` emits the OTHER 17 — the ones a player can use — and
 * its gate test asserts none of them carries this guard. This is the complement,
 * and it is read here rather than generated because nothing in the port routes
 * through these: they exist to be opened by `/devmode/`, not to be walked by a
 * route.
 */
interface DebugArea {
  to: string;
  /** which deck plan it is on, 1 = boat deck */
  plan: number;
  /** the flat region's own name, as the artists left it */
  region: string;
  /** the script behind it, flattened */
  script: string;
}

function debugAreas(map: Uint8Array): DebugArea[] {
  const stg = readStgFile(map);
  const out: DebugArea[] = [];
  for (let p = 0; p < stg.flats.length; p++) {
    for (const r of readStgRegions(stg.file.containers[stg.flats[p].locationClickLogic].data)) {
      const script = scriptToText(sniffScript(stg.file.containers[r.script].data)!).replace(/\s+/g, " ");
      const jump = /jumpbaby \("([^"]+)"/.exec(script);
      if (jump && /if not debugging/.test(script))
        out.push({ to: jump[1], plan: p + 1, region: r.name, script });
    }
  }
  return out;
}

/** the page button that turns to a plan — the same name on every plan */
function pageButtons(map: Uint8Array): Map<number, string> {
  const stg = readStgFile(map);
  const keys = new Map<number, string>();
  for (const f of stg.flats) {
    for (const r of readStgRegions(stg.file.containers[f.locationClickLogic].data)) {
      const t = scriptToText(sniffScript(stg.file.containers[r.script].data)!).replace(/\s+/g, " ");
      const g = /gotopage \((\d+)\)/.exec(t);
      if (g && !keys.has(Number(g[1]))) keys.set(Number(g[1]), r.name);
    }
  }
  return keys;
}

test("fifteen areas sit behind the flag, and they are the rooms the live ones are not", async () => {
  const { session } = await newHost();
  const areas = debugAreas(session.files("map.stg")!);
  expect(areas.length, "the count the deck-map gate's complement implies").toBe(15);
  // the live 17 are all staircases; these are ROOMS, which is the whole difference
  expect([...new Set(areas.map((a) => a.to))].sort()).toEqual([
    "cafe",
    "decka",
    "deckbd",
    "fore",
    "gym",
    "hallf3c",
    "lounge1c",
    "poop",
    "smoke",
  ]);
});

/**
 * ...and one of them was already dead on the disc.
 *
 * The lounge's region carries a BARE `exitcode` on the line above its jump:
 *
 *   if not debugging
 *     exitcode
 *   endif
 *   exitcode
 *   jumpbaby ("lounge1c", "scene60", "view63")
 *
 * so it returns before the jump however the flag is set. Pinned because the
 * obvious reading of "15 debug areas" is that developer mode opens 15 rooms, and
 * it opens 14.
 *
 * The ROOM is not dead, only the button, and the second half of this test says so
 * — the short version reads as "the lounge was cut" and it was not.
 */
test("the lounge's area is dead in every build — its own exitcode, not the guard", () => {
  const areas = debugAreas(new Uint8Array(readFileSync(gamefilePath("map.stg"))));
  const dead = areas.filter((a) => /endif exitcode jumpbaby/.test(a.script));
  expect(dead.map((a) => a.to)).toEqual(["lounge1c"]);
});

test("...but the lounge itself is a real room you can walk into", async () => {
  const { session } = await newHost();
  const set = readSetFile(session.files("lounge1c.set")!);
  expect(set.scenes.length, "a whole room, not a stub").toBeGreaterThan(5);
  // the map's destination is not stale either — it was switched off on purpose
  const scene = set.scenes.find((s) => s.sceneName.toLowerCase() === "scene60");
  expect(scene, "Scene60 exists").toBeTruthy();
  expect(scene!.views.some((v) => v.viewName.toLowerCase() === "view63"), "View63 with it").toBe(true);

  // and LNGHALL's own door walks you in, which is how a player gets there
  const hall = scriptToText(
    sniffScript(readContainerFile(session.files("lnghall.set")!).containers[5].data)!,
  ).replace(/\s+/g, " ");
  expect(hall).toContain('gotospecial ("lounge1c", "scene10", "view16")');
  expect(hall).toContain('gotospecial ("lounge1c", "scene14", "view37")');
});

/**
 * And then the thing itself, driven: press the area and see where the game goes.
 *
 * A fresh host per press, which is not fussiness — a jump that lands LEAVES the
 * map (`jumppapa` ends in `exitmap()`, and BOOTFILE's `restorescreen` performs
 * the `changeset` and clears `jumpset`), so a second press in the same session
 * is a press at a flat that is no longer up. Reading `jumpset` afterwards proves
 * nothing for the same reason: by the time the dust settles it has been cleared
 * again. The set is the answer.
 */
async function pressArea(area: DebugArea, flag: number): Promise<string> {
  const { host, session } = await newHost();
  await host.loadServerSet("c78.set");
  const g = session.interp.globals;
  const i = session.interp as unknown as { builtins: Map<string, (...a: unknown[]) => unknown> };
  const call = (n: string, ...args: unknown[]): unknown =>
    i.builtins.get(n)!(i, args, { t: "call", name: n, args: [] }, null);
  g.set("mission", 2);
  g.set("tour", 0);
  g.set("debugging", flag);
  // the map is dead without the pair, whatever the flag says — `mapdisabled()`
  // checks both owners, and this is real content, not a workaround
  call("propowner", "bag", "frank");
  call("propowner", "watch", "frank");
  await session.track(session.transToFlat("map.stg"));
  await drain();
  const press = async (r: string): Promise<void> => {
    await session.track(
      session.stageCtrl.sendToButton(session.currentFlat, r, "mousedown", [session.pointerPoint()], "test"),
    );
    await drain();
  };
  // `transtoflat` lands on the plan for the deck you are standing on, so turn
  await press(pageButtons(session.files("map.stg")!).get(area.plan)!);
  await press(area.region);
  for (let n = 0; n < 40; n++) await drain();
  return session.currentSetName;
}

test("the gymnasium is refused with the flag down and reached with it up", async () => {
  const areas = debugAreas((await newHost()).session.files("map.stg")!);
  const gym = areas.find((a) => a.to === "gym")!;
  expect(await pressArea(gym, 0), "a player presses it and nothing happens").toBe("c78");
  expect(await pressArea(gym, 1), "developer mode presses it and goes there").toBe("gym");
}, 60_000);

test("...and the lounge is refused either way, by its own dead line", async () => {
  const areas = debugAreas((await newHost()).session.files("map.stg")!);
  const lounge = areas.find((a) => a.to === "lounge1c")!;
  expect(await pressArea(lounge, 0)).toBe("c78");
  expect(await pressArea(lounge, 1), "the flag is not what stops this one").toBe("c78");
}, 60_000);

// --- the overlay's table ----------------------------------------------------

/**
 * The generated table against MAP.STG itself.
 *
 * Not "does the generator agree with itself": the areas are re-derived from the
 * file here, and the emitted table has to name the same regions on the same
 * plans with the same destinations and the same rectangles. A decoder change
 * that shifted a region record would land here, as a box drawn in the wrong
 * place — which on an overlay whose whole job is to say "the button is HERE" is
 * the worst kind of quiet wrong.
 */
test("every area the overlay draws is a real region of the plan it claims", async () => {
  const { session } = await newHost();
  const map = session.files("map.stg")!;
  const stg = readStgFile(map);
  expect(MAP_AREAS.length, "the deck map's 32 red areas").toBe(32);

  for (const a of MAP_AREAS) {
    const flat = stg.flats[a.page - 1];
    expect(flat.name, `${a.region} is on plan ${a.page}`).toBe(a.flat);
    const region = readStgRegions(stg.file.containers[flat.locationClickLogic].data).find(
      (r) => r.name === a.region,
    );
    expect(region, `${a.region} is a region of ${a.flat}`).toBeTruthy();
    expect(
      [region!.left, region!.top, region!.right, region!.bottom],
      `${a.region}'s rectangle`,
    ).toEqual([a.left, a.top, a.right, a.bottom]);
    const script = scriptToText(sniffScript(stg.file.containers[region!.script].data)!).replace(/\s+/g, " ");
    expect(script, `${a.region} jumps to ${a.to}`).toContain(`jumpbaby ("${a.to}"`);
    const kind = /endif exitcode jumpbaby/.test(script)
      ? "dead"
      : /if not debugging/.test(script)
        ? "debug"
        : "live";
    expect(a.kind, `${a.region} is ${kind}`).toBe(kind);
  }
});

test("seventeen a player can press, fourteen the flag opens, and one that never worked", () => {
  const by = (k: string): number => MAP_AREAS.filter((a) => a.kind === k).length;
  expect([by("live"), by("debug"), by("dead")]).toEqual([17, 14, 1]);
  expect(MAP_AREAS.filter((a) => a.kind === "dead").map((a) => a.to)).toEqual(["lounge1c"]);
  // the live ones are all stairwells and the debug ones are all rooms — the
  // difference the overlay's two colours exist to show
  expect(
    MAP_AREAS.filter((a) => a.kind === "live").every((a) => /^(g?stair|recept1c|turkstrs)/.test(a.to)),
  ).toBe(true);
  expect(
    MAP_AREAS.filter((a) => a.kind === "debug").some((a) => /^(g?stair|recept1c|turkstrs)/.test(a.to)),
  ).toBe(false);
});

test("a box is the region's own rectangle, in percentages of the game's screen", () => {
  const boat = areasOn("Map 1");
  expect(boat.length, "the boat deck's seven").toBe(7);
  const gym = boat.find((a) => a.to === "gym")!;
  expect([gym.left, gym.top, gym.right, gym.bottom]).toEqual([300, 174, 348, 196]);
  const box = boxOf(gym);
  // INCLUSIVE at both ends, as `pointinbutton` treats it: 300..348 is 49 wide
  expect(box.left).toBe(`${(300 / 512) * 100}%`);
  expect(box.width).toBe(`${(49 / 512) * 100}%`);
  expect(box.height).toBe(`${(23 / 384) * 100}%`);
  // an unknown flat draws nothing rather than throwing — the overlay asks about
  // whatever flat is up, and most of them are not the deck map at all
  expect(areasOn("ctl.stg")).toEqual([]);
  expect(boxesOn("nothing")).toEqual([]);
});

test("live boxes are laid down first, so a debug box wins an overlap", () => {
  const kinds = boxesOn("Map 2").map((b) => b.area.kind);
  expect(kinds).toEqual([...kinds].sort((a, b) => ({ live: 0, debug: 1, dead: 2 })[a] - ({ live: 0, debug: 1, dead: 2 })[b]));
  expect(kinds[0]).toBe("live");
  expect(kinds[kinds.length - 1]).toBe("dead");
});

// --- the flag against a saved game -----------------------------------------

/**
 * Every saved game carries `debugging`, and carries it as 0.
 *
 * This is the one thing besides `boot()` that writes the global, and it is why
 * the page keeps its own switch rather than raising the flag once and trusting
 * it: nobody ever saved a game from a debug build, so every `.ti` on the disc
 * stores a 0, and opening one turned developer mode off with the menu still on
 * the screen.
 *
 * Asserted against a SHIPPED save rather than one this test writes, because what
 * is being pinned is a fact about the files a person will actually open.
 */
test("a shipped save carries the flag as 0, so opening one takes developer mode down", async () => {
  const path = join(index.savesDir() ?? join(root, "save"), "1", "03 - Found the Gymnasium.ti");
  const bytes = new Uint8Array(readFileSync(path));
  const save = parseSave(bytes);
  expect(save.numGlobals.has("debugging"), "the flag is in the file").toBe(true);
  expect(save.numGlobals.get("debugging"), "and every disc save stores it down").toBe(0);

  const { host, session } = await newHost();
  await host.loadServerSet("c78.set");
  const g = session.interp.globals;
  g.set("debugging", 1);
  expect(await session.loadGame(bytes)).toBe(true);
  await drain();
  expect(g.get("debugging"), "the load puts it back the way the file has it").toBe(0);
}, 60_000);

// --- the console -----------------------------------------------------------

/**
 * A line of script, compiled and run against a live session.
 *
 * The point of the console is that a line is not a special case: it resolves
 * builtins, boot-library routines and globals by the rules a script in the game
 * follows. So the tests that matter are the ones that reach past the line itself
 * — a global that moves, a shop handler that answers, a value read out of the
 * room it is standing in.
 */
test("a console line runs against the session, and reaches what a script reaches", async () => {
  const { host, session } = await newHost();
  await host.loadServerSet("c78.set");
  const g = session.interp.globals;
  const line = (src: string) => runConsole(session as never, src);

  // an expression, evaluated by the engine's own arithmetic
  expect((await line("return (2 + 3 * 4)")).value).toBe(14);

  // the room it is standing in — not a constant this test could have supplied
  expect((await line("return (currentset ())")).value).toBe("c78");

  // a global it writes is the global the game reads
  expect((await line("mission = 7")).ok).toBe(true);
  expect(g.get("mission")).toBe(7);

  // a builtin with state behind it
  await line('propowner ("bag", "frank")');
  expect((await line('return (propowner ("bag"))')).value).toBe("frank");

  // ...and the thing the console exists for: a handler with no caller anywhere
  // in the corpus, reached by addressing its shop the way a script would
  expect((await line('sendtoshop ("inven.shp", addallinven ())')).ok).toBe(true);
});

test("a console never throws — a bad line comes back as a fault", async () => {
  const { host, session } = await newHost();
  await host.loadServerSet("c78.set");
  // unbalanced: the assembler refuses it
  const bad = await runConsole(session as never, "code code code");
  expect(bad.ok).toBe(false);
  expect(bad.error, "and says why").toBeTruthy();
  // an empty line is not a fault, it is nothing
  expect(await runConsole(session as never, "   ")).toEqual({ ok: true, value: undefined });
});

test("the line is wrapped in a handler and nothing else is done to it", () => {
  expect(wrapConsole('return (1)')).toBe("code console ()\n\treturn (1)\nendcode");
});

describe("the console's history", () => {
  test("↑ walks back and ↓ walks down to the empty prompt", () => {
    const h = new ConsoleHistory();
    h.add("one");
    h.add("two");
    expect(h.older()).toBe("two");
    expect(h.older()).toBe("one");
    expect(h.older(), "the top").toBe(null);
    expect(h.newer()).toBe("two");
    expect(h.newer(), "back at the prompt").toBe("");
    expect(h.newer(), "and no further").toBe(null);
  });

  test("the same line twice is one entry", () => {
    const h = new ConsoleHistory();
    h.add("same");
    h.add("same");
    h.add("  same  ");
    expect(h.all).toEqual(["same"]);
  });

  test("a new line puts the cursor back at the prompt", () => {
    const h = new ConsoleHistory();
    h.add("one");
    h.add("two");
    h.older();
    h.add("three");
    expect(h.older(), "from the bottom again").toBe("three");
  });

  test("nothing blank is kept", () => {
    const h = new ConsoleHistory();
    h.add("");
    h.add("   ");
    expect(h.all).toEqual([]);
    expect(h.older()).toBe(null);
  });
});
