/**
 * A save the ORIGINAL game wrote, loaded by the port — issue #179.
 *
 * Every other save test reads the 109 `.ti` files that ship on the discs
 * (tests/auto/savegame.ts). Those are a corpus with a hidden thing in common:
 * they were all taken by the same build of TI.EXE, in the same session, at the
 * same load address. A player's own save is not, and that turned out to matter —
 * see {@link NODE_VTABLE_OFF} below and `nodeVtable` in src/df/savegame.ts.
 *
 * `M4P0FCL.ti` is Nicholas Mischler's, attached to #179: mission 4 phase 0, in
 * the First Class Lounge, made in DosBox and loaded into the port at 0.9.29. It
 * opened the right room with the WRONG game — the previous game's mission, phase
 * and every other global still in place, which is why Trask showed him the clock
 * and the shawl in his hand raised a script error.
 *
 * **It is tracked, unlike `gamefiles/`.** The rip is a CD and never enters the
 * repository, so the save suite can only run on the machine that has one; this
 * file is 47 KB and is the whole fixture, so this suite runs on a fork's pull
 * request too. That is the point of adding it rather than pointing at a path.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyPatch, parseSave, readSaveFile, writeSaveFile } from "../../src/df/savegame";
import { GameSession } from "../../src/engine/session";
import { NullAudioSink } from "../../src/engine/audio";
import { loadGame } from "../../src/engine/saveload";

const SAVE = new Uint8Array(readFileSync(join("tests", "data", "M4P0FCL.ti")));

/**
 * Where a variable-list node keeps the DFValue vtable pointer, and the value all
 * 109 shipped saves happen to hold.
 *
 * It is a raw code address the engine dumped along with each node, so it is a
 * constant only for as long as the engine is loaded at the same address. The
 * reader used to LOCATE the node grid by matching that byte pattern, which the
 * corpus made look like a format fact. This file is the counter-example.
 */
const NODE_STRIDE = 32;
const NODE_VTABLE_OFF = 20;
const SHIPPED_VTABLE = 0x00431e0f;

/** the globals container, found the way the reader finds it */
function globalsContainer(bytes: Uint8Array): Uint8Array {
  const raw = readSaveFile(bytes);
  const i = parseSave(bytes).globalsIndex;
  expect(i).toBeGreaterThanOrEqual(0);
  return raw.containers[i].data;
}

/** the vtable word of the node list's first node (the list starts at +28) */
function firstNodeVtable(d: Uint8Array): number {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return dv.getUint32(NODE_STRIDE - 4 + NODE_VTABLE_OFF, true);
}

// --- the premise ------------------------------------------------------------

test("the fixture is a foreign save: its nodes carry a different vtable (#179)", () => {
  const vt = firstNodeVtable(globalsContainer(SAVE));
  // 0x87c4596f here against the corpus's 0x00431e0f — the same engine, loaded
  // somewhere else. If this ever equals SHIPPED_VTABLE the fixture has been
  // replaced with one of ours and the rest of this file proves nothing.
  expect(vt).not.toBe(SHIPPED_VTABLE);
});

// --- reading it -------------------------------------------------------------

test("its globals decode at all — the whole bug was that they did not (#179)", () => {
  const save = parseSave(SAVE);
  // 115 records: at 0.9.29 this was 0, and an empty map is what a load applied
  expect(save.vars.length).toBeGreaterThan(100);
  expect(save.numGlobals.get("mission")).toBe(4);
  expect(save.numGlobals.get("phase")).toBe(0);
  // calctime owns `clock` from mission 4 on, so it is hrs*100+min — 13:09
  expect(save.numGlobals.get("clock")).toBe(1309);
  expect(save.numGlobals.get("hrs")).toBe(13);
  expect(save.numGlobals.get("min")).toBe(9);
  // string records decode through the pool, which is the container after it
  expect(save.strGlobals.get("handitem")).toBe("shawl");
  expect(save.strGlobals.get("hallside")).toBe("star");
  expect(save.strGlobals.get("newset")).toBe("lounge1c");
});

test("the room the reporter saved in", () => {
  const save = parseSave(SAVE);
  expect(save.title).toBe("Titanic 1.0");
  expect([save.set, save.scene, save.view]).toEqual(["lounge1c", "scene14", "view37"]);
  // the rest of the file always parsed — this is what made the bug look like a
  // room problem rather than a globals one: the right set opened every time
  expect(save.inventory.length).toBe(72);
  expect(save.actors.length).toBe(39);
  expect(save.theme?.track).toBe("sink0.trk");
});

// --- loading it -------------------------------------------------------------

/**
 * The reported sequence, headless: load the port's system save 12 (mission 2),
 * then load the original game's file over it. #179's state dump is the "before"
 * half of this test — every value it showed was still mission 2's.
 *
 * A session with no file provider, so this runs without the rip: `loadGame`
 * restores the globals before it touches a set, and logs what it cannot open.
 */
test("loading it over a mission-2 game replaces the mission-2 state (#179)", async () => {
  const session = new GameSession(() => null, new NullAudioSink());
  session.onLog = () => {};
  // where the reporter was: "12 – Sending Telegram for Jack Thayer"
  session.interp.globals.set("mission", 2);
  session.interp.globals.set("phase", 0);
  session.interp.globals.set("handitem", "");
  session.interp.globals.set("traskphase", 1);
  session.interp.globals.set("metzeitel", 0);
  session.interp.globals.set("clock", "bedsit");

  expect(await loadGame(session, SAVE)).toBe(true);

  const g = session.interp.globals;
  expect(g.get("mission")).toBe(4);
  expect(g.get("phase")).toBe(0);
  // ...and the three the reporter could see from inside the room: the shawl he
  // was holding (a script error in mission 2, where it does not exist), Trask
  // still on the staircase with the clock, and Zeitel still expecting to be
  // interrupted with Sasha on the boat deck
  expect(g.get("handitem")).toBe("shawl");
  expect(g.get("traskphase")).toBe(0);
  expect(g.get("metzeitel")).toBe(1);
  expect(g.get("clock")).toBe(1309);
  // a load hands control back whatever the file said (every save is taken from
  // the CTL menu, which froze input)
  expect(g.get("lockevents")).toBe(0);
});

// --- writing it back --------------------------------------------------------

test("it round-trips everything the loader reads", () => {
  const raw = readSaveFile(SAVE);
  const again = readSaveFile(writeSaveFile(raw));
  expect(again.containers.length).toBe(raw.containers.length);
  for (let i = 0; i < raw.containers.length; i++) {
    expect(again.containers[i].id).toBe(raw.containers[i].id);
    expect(Buffer.from(again.containers[i].data)).toEqual(Buffer.from(raw.containers[i].data));
  }
});

/**
 * Saving over a foreign base — the other half of the pointer being a pointer.
 *
 * A save the port writes patches the file that was LOADED, so a global this file
 * has no record for gets a node made for it in a container whose grid is stamped
 * 0x87c4596f. Stamped with our own corpus's constant instead, the node is one
 * neither reader ever finds again: it decodes here and vanishes on the next load.
 */
test("a global added to a foreign base is readable again (#179)", () => {
  const base = parseSave(SAVE);
  expect(base.numGlobals.has("bombmebaby")).toBe(false); // no record yet — one gets made
  const numGlobals = new Map(base.numGlobals);
  numGlobals.set("bombmebaby", 7);
  numGlobals.set("mission", 5);

  const out = applyPatch(base.raw, {
    numGlobals,
    strGlobals: base.strGlobals,
    set: base.set,
    scene: base.scene,
    view: base.view,
  });
  const re = parseSave(out);
  expect(re.numGlobals.get("bombmebaby")).toBe(7);
  expect(re.numGlobals.get("mission")).toBe(5);
  expect(re.strGlobals.get("handitem")).toBe("shawl");
  // and the file is still the foreign one — patching did not relocate its grid
  expect(firstNodeVtable(globalsContainer(out))).toBe(firstNodeVtable(globalsContainer(SAVE)));
});
