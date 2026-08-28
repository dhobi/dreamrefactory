/**
 * Save/load regression — runs headless against the shipped `.ti` saves.
 *
 *   npx vitest run taoot/tests/auto/savegame.ts
 *   TAOOT_GAMEFILES=/path/to/gamefiles npx vitest run   # override data dir
 */
import { test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  readSaveFile,
  writeSaveFile,
  parseSave,
  applyPatch,
  globalsCapacity,
  type RawSaveFile,
} from "@dreamfactory/engine/df/savegame";
import { readShpFile } from "@dreamfactory/engine/df/shp";
import { readSetFile } from "@dreamfactory/engine/df/set";
import { readBankTables } from "@dreamfactory/engine/df/banks";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { gamefiles, gamefilesRoot } from "../../tools/gamefiles";
import { bestTemplate, shippedSaves } from "../../src/save-seed";
import type { SaveEntry } from "@dreamfactory/engine/web/save-store";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import {
  NullAudioSink,
  type AudioChannel,
  type AudioSink,
  type PlayHandle,
  type PlayOpts,
} from "@dreamfactory/engine/runtime/audio";
import type { DecodedAudio } from "@dreamfactory/engine/df/audio";
import { SetViewer } from "@dreamfactory/engine/web/viewer";
import { newHost, drain } from "../harness";

function check(name: string, ok: boolean, detail = ""): void {
  expect.soft(ok, `${name}${detail ? ` — ${detail}` : ""}`).toBe(true);
}

const root = gamefilesRoot();
const index = gamefiles(root);
const provider = index.provider;

/** names of the inven.shp props (the actual inventory items). */
const invNames = new Set(readShpFile(provider("inven.shp")!).groups.map((g) => g.name.toLowerCase()));

/**
 * Paths of every shipped save. The save folders sit beside the disc volumes
 * (`gamefiles/<lang>/save/{1,2,ENDGAME1,ENDGAME2}`) and are addressed by
 * directory rather than by basename, so they are enumerated rather than
 * resolved — but whichever subfolders a dump actually has, take them all.
 */
function allSaves(): string[] {
  const saves = index.savesDir();
  if (!saves) return [];
  const out: string[] = [];
  for (const sub of readdirSync(saves)) {
    const dir = join(saves, sub);
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue; // a stray file beside the save folders
    }
    for (const f of names) if (/\.ti$/i.test(f)) out.push(join(dir, f));
  }
  return out;
}

/** path of one shipped save, under whatever save folder the dump actually has */
function savePath(sub: string, file: string): string {
  return join(index.savesDir() ?? join(root, "save"), sub, file);
}

/** compare exactly what the loader reads: container id + data + count. */
function containersEqual(a: RawSaveFile, b: RawSaveFile): boolean {
  if (a.containers.length !== b.containers.length) return false;
  for (let i = 0; i < a.containers.length; i++) {
    const x = a.containers[i];
    const y = b.containers[i];
    if (x.id !== y.id || x.data.length !== y.data.length) return false;
    if (Buffer.compare(Buffer.from(x.data), Buffer.from(y.data)) !== 0) return false;
  }
  return true;
}

// BYTE for byte, and that is a promise to another program rather than a tidiness
// rule: a port save is a patched copy of one of these files, and the one reader
// that matters is the original game, which we cannot debug. So the writer puts
// back even the bytes it does not understand — the process junk the original left
// behind the live slots of the position table (RawSaveFile.table), which this
// writer used to zero-fill.
//
// `containersEqual` stays as the diagnostic: it says whether what the LOADER
// reads survived, which is the more useful failure message when the bytes move.
test("every shipped save round-trips byte for byte", () => {
  const saves = allSaves();
  expect(saves.length).toBeGreaterThan(0);
  for (const path of saves) {
    const bytes = new Uint8Array(readFileSync(path));
    const raw = readSaveFile(bytes);
    const out = writeSaveFile(raw);
    expect.soft(containersEqual(raw, readSaveFile(out)), `${path}: what the loader reads`).toBe(true);
    const at = out.length === bytes.length ? out.findIndex((v, i) => v !== bytes[i]) : -2;
    expect.soft(at, `${path}: identical bytes (${bytes.length} in, ${out.length} out)`).toBe(-1);
  }
});

// applyPatch writes each variable's DFValue (numbers inline, strings as pool
// offsets) and container 1's set/scene/view; all must decode back unchanged.
test("applyPatch writes globals + location that parse back", () => {
  const path = savePath("1", "03 - Found the Gymnasium.ti");
  const save = parseSave(new Uint8Array(readFileSync(path)));
  expect(save.numGlobals.has("mission")).toBe(true);
  expect(save.numGlobals.has("neckphase")).toBe(true);
  const numGlobals = new Map(save.numGlobals);
  numGlobals.set("mission", 3);
  numGlobals.set("neckphase", 5);
  numGlobals.set("phase", 42);
  // string globals: an existing-pool value must round-trip as a type-3 ref.
  const strGlobals = new Map<string, string>([["hallside", "star"], ["savedeck", "c"]]);

  const out = applyPatch(save.raw, { numGlobals, strGlobals, set: "turkstrs", scene: "scene9", view: "view3" });
  const re = parseSave(out);
  expect(re.set).toBe("turkstrs");
  expect(re.scene).toBe("scene9");
  expect(re.view).toBe("view3");
  expect(re.numGlobals.get("mission")).toBe(3);
  expect(re.numGlobals.get("neckphase")).toBe(5);
  expect(re.numGlobals.get("phase")).toBe(42);
  expect(re.strGlobals.get("hallside")).toBe("star");
  expect(re.strGlobals.get("savedeck")).toBe("c");

  // ...and a string the base has NEVER held is allocated in the pool rather than
  // dropped. Refusing to was a quiet way to lose story state: a save taken after
  // mission 1's Enigma work came back with zeitclue = 0 instead of "decoder", and
  // PENNY1.PUP m1p4() calls error() when it is neither "decoder" nor "mirror" —
  // the debrief that ends mission 1 could not be held. handitem ("rubaiyat") and
  // savedeck ("boil3") went the same way.
  const fresh = "zzz-never-in-any-pool";
  const grown = applyPatch(save.raw, {
    numGlobals,
    strGlobals: new Map([["coalchute", fresh], ["hallside", "port"]]),
    set: "turkstrs", scene: "scene9", view: "view3",
  });
  const back = parseSave(grown);
  expect(back.strGlobals.get("coalchute"), "a string the pool lacked").toBe(fresh);
  expect(back.strGlobals.get("hallside"), "and one it had, alongside it").toBe("port");
  expect(back.numGlobals.get("neckphase"), "and the numeric records are untouched").toBe(5);
});

// The string is allocated the way the ORIGINAL allocator does: at the pool's own
// watermark (the u32 at globals-blob +8), inside the block whose size the blob
// declares at +12. The first version appended past the container's end instead —
// which this port reads back happily, because it resolves a string by offset, and
// TI.EXE cannot: it allocates +12 bytes and copies the container into them, so an
// over-long pool is either truncated (the string silently lost) or copied past the
// end of its block. A save has to load in the original engine too.
test("a new pool string is allocated inside the pool, at its watermark", () => {
  const path = savePath("1", "01 - April 14th, 1942.ti");
  const save = parseSave(new Uint8Array(readFileSync(path)));
  const poolOf = (s: ReturnType<typeof parseSave>) => {
    const g = s.raw.containers[s.globalsIndex].data;
    const dv = new DataView(g.buffer, g.byteOffset, g.byteLength);
    return {
      len: s.raw.containers[s.globalsIndex + 1].data.length,
      mark: dv.getUint32(8, true),
      size: dv.getUint32(12, true),
    };
  };
  const before = poolOf(save);
  expect(before.size, "the blob declares the pool's size").toBe(before.len);

  const out = applyPatch(save.raw, {
    numGlobals: save.numGlobals,
    strGlobals: new Map([["handitem", "zzz-brand-new-string"]]),
    set: save.set, scene: save.scene, view: save.view,
  });
  const re = parseSave(out);
  const after = poolOf(re);
  expect(re.strGlobals.get("handitem"), "the value round-trips").toBe("zzz-brand-new-string");
  expect(after.len, "the pool container did NOT grow").toBe(before.len);
  expect(after.size, "and still describes itself").toBe(after.len);
  expect(after.mark, "the watermark moved by the entry").toBe(before.mark + 1 + "zzz-brand-new-string".length);
  // the value sits where the watermark was, i.e. inside the block
  expect(re.vars.find((v) => v.name === "handitem")?.num).toBe(before.mark);
});

// Ground truth for the corrected variable decode (name pairs with the PREVIOUS
// node's DFValue; type 3 = string via the pool container). Save 20 is the save
// the original engine provably restores (DosBox: knocking on B59 gets "Come
// in", which needs letterphase 2 or 3 — HALLB.SET/0235).
test("parseSave decodes save 20's story state (letterphase → Conkling knock)", () => {
  const path = savePath("1", "20 - Meeting Conkling in his suite - B59.ti");
  const save = parseSave(new Uint8Array(readFileSync(path)));
  expect(save.numGlobals.get("letterphase")).toBe(3);
  expect(save.numGlobals.get("mission")).toBe(2);
  expect(save.numGlobals.get("neckphase")).toBe(5);
  expect(save.numGlobals.get("hrs")).toBe(10); // 10:50 PM aboard Titanic
  expect(save.numGlobals.get("min")).toBe(50);
  expect(save.strGlobals.get("hallside")).toBe("star"); // B59 is starboard
  expect(save.strGlobals.get("savedeck")).toBe("b");
  expect(save.strGlobals.get("newset")).toBe("hallb");
  expect(save.strGlobals.get("fusebox")).toBe("1,1,1,1,1,");
  expect(save.strGlobals.get("coalchute")).toBe("coal4");
  expect(save.strGlobals.get("savetheme")).toBe("decka.trk");
  expect(save.strGlobals.get("handitem")).toBe("");
});

/** minimal live session that loads sets through a SetViewer (as the app does). */
async function newSession(sink: AudioSink = new NullAudioSink()): Promise<GameSession> {
  // its own view of the data, starting on disc 1 and following setpath(disk)
  const index = gamefiles(root);
  const session = new GameSession(index.provider, sink);
  session.onDiscChange = (disc) => index.setDisc(disc);
  session.onSetChange = async (fileName, sceneName, viewName) => {
    const set = session.loadSet(fileName);
    if (!set) return;
    const viewer = new SetViewer(set, session, sceneName, viewName);
    viewer.onHud = () => {};
    await viewer.start();
  };
  await session.ensureBooted();
  return session;
}

test("loadGame restores globals + clock and travels to the saved room", async () => {
  const session = await newSession();
  const path = savePath("1", "03 - Found the Gymnasium.ti");
  const bytes = new Uint8Array(readFileSync(path));
  const save = parseSave(bytes);

  const ok = await session.loadGame(bytes);
  await session.settle();

  expect(ok).toBe(true);
  expect(session.currentSetFile).toBe(save.set); // travelled into the saved set
  expect(session.interp.globals.get("mission")).toBe(save.numGlobals.get("mission"));
  expect(session.interp.globals.get("neckphase")).toBe(save.numGlobals.get("neckphase"));
  expect(session.interp.globals.get("clock")).toBe(save.clock);
});

/**
 * `clock` is the variable list's HEAD, so its DFValue lives one stride back, in
 * the blob header. Reading it out of the location container's savestate stack
 * instead (the old heuristic: the token after the first "titanicN:" path) picked
 * the FIRST day event ever pushed, which is "startdisk1" on every save in the
 * game — including saves taken hours later. TAOOT's `advanceday` switches on
 * this value, so a save loaded into the London flat replayed the whole intro
 * when the bombs fell instead of sailing (#52).
 *
 * The shape below is the game's own: `advanceday`'s startdisk1 arm sets
 * clock = "bedsit" and nothing overwrites it until the sinking, where calctime's
 * `clock = hrs * 100 + min` takes the variable over as a NUMBER.
 */
test("parseSave reads clock from the variable-list head, not the savestate stack", () => {
  let strings = 0;
  let numbers = 0;
  for (const path of allSaves()) {
    const save = parseSave(new Uint8Array(readFileSync(path)));
    const name = path.replace(/.*\//, "");
    const mission = save.numGlobals.get("mission") ?? -1;
    if (mission === 4) {
      // the sinking: calctime owns the variable, and it reads back as the time
      const clock = save.numGlobals.get("clock");
      const hrs = save.numGlobals.get("hrs") ?? 0;
      const min = save.numGlobals.get("min") ?? 0;
      check(`${name} clock is numeric`, typeof clock === "number", `got ${clock}`);
      // calctime rewrites it once a game-second, so it can trail `min` a little
      check(`${name} clock ~ hrs*100+min`, Math.abs((clock ?? 0) - (hrs * 100 + min)) <= 5,
        `clock=${clock} time=${hrs}:${min}`);
      numbers++;
    } else {
      check(`${name} clock = "bedsit"`, save.clock === "bedsit", `got "${save.clock}"`);
      strings++;
    }
  }
  // guard the guard: both arms have to have actually run
  expect(strings).toBeGreaterThan(60);
  expect(numbers).toBeGreaterThan(20);
});

test("a save the port writes carries the clock it was taken at", async () => {
  const session = await newSession();
  const path = savePath("1", "01 - April 14th, 1942.ti");
  await session.loadGame(new Uint8Array(readFileSync(path)));
  await session.settle();
  expect(session.interp.globals.get("clock")).toBe("bedsit");

  // the head node's DFValue is writable too, so the value survives a snapshot —
  // without it every save the port took would restore the pending day event of
  // whatever base save it was patched from.
  expect(parseSave(session.snapshotSave()!).clock).toBe("bedsit");

  // and a numeric clock (the sinking) round-trips as a number, not as text
  session.interp.globals.set("clock", 1337);
  const re = parseSave(session.snapshotSave()!);
  expect(re.numGlobals.get("clock")).toBe(1337);
  expect(re.strGlobals.has("clock")).toBe(false);
});

test("parseSave recovers hallside from the location savestate stack", () => {
  // hallside is the last "port"/"star" token in the location container; verified
  // against each set's entry script. Cross-checked hall/deck saves:
  const cases: [string, string, string][] = [
    ["09 - Got package for Vlad.ti", "halla", "port"],
    ["21 - Hacker Cabin - 3rd class - F59.ti", "hallf3c", "star"],
    ["20 - Meeting Conkling in his suite - B59.ti", "hallb", "star"],
    ["16 - Meeting Georgia in her cabin - B70.ti", "hallb", "port"],
  ];
  for (const [file, set, hallside] of cases) {
    const save = parseSave(new Uint8Array(readFileSync(savePath("1", file))));
    expect(save.set).toBe(set);
    expect(save.hallside).toBe(hallside);
  }
});

test("loadGame restores a valid hallside so hall navigation isn't guarded off", async () => {
  const session = await newSession();
  const bytes = new Uint8Array(readFileSync(savePath("1", "09 - Got package for Vlad.ti")));
  const ok = await session.loadGame(bytes);
  await session.settle();

  expect(ok).toBe(true);
  expect(session.currentSetFile).toBe("halla");
  // must be a valid side ("port"), not the record's stale number — halla's
  // keydown guard error()s (swallowing every key) on anything else.
  expect(session.interp.globals.get("hallside")).toBe("port");
  expect(typeof session.interp.globals.get("hallside")).toBe("string");
});

test("loadGame closes a conversation that was open when it was pressed", async () => {
  // #254, reported off the workbench: mid-conversation with the Gorse-Joneses,
  // load a Turbine Room checkpoint, and they come along for the ride. A
  // conversation is SESSION state — SetViewer.conversing is
  // `session.puppet?.visible` — so the room it was opened in has nothing to do
  // with it and rebuilding the viewer does not close it.
  //
  // Unreachable through the engine's own load lever, which is why it survived
  // this long: `opengame` is the CTL panel's and the panel does not open with a
  // conversation up. The workbench's checkpoint chips call the host's load
  // directly, at any moment, so they can.
  const session = await newSession();
  await session.loadGame(new Uint8Array(readFileSync(savePath("1", "03 - Found the Gymnasium.ti"))));
  await session.settle();

  expect(await session.puppetCtrl.openPuppetFile("ga2.pup")).toBe(true);
  expect(session.puppet?.visible).toBe(true);

  await session.loadGame(new Uint8Array(readFileSync(savePath("1", "06 - Boiler Room.ti"))));
  await session.settle();

  expect(session.currentSetFile).toBe("boil"); // the load itself still happened
  expect(session.puppet).toBe(null); // and took the close-up with it
});

test("loadGame gives up a film that was playing", async () => {
  // The hook, at the choke point both load paths share: the in-game `opengame`
  // builtin calls session.loadGame directly, the workbench's checkpoint chips
  // reach it through GameHost.loadSavedGame.
  const session = await newSession();
  await session.loadGame(new Uint8Array(readFileSync(savePath("1", "03 - Found the Gymnasium.ti"))));
  await session.settle();

  let asked = 0;
  session.onAbandonMovie = () => void asked++;
  await session.loadGame(new Uint8Array(readFileSync(savePath("1", "06 - Boiler Room.ti"))));
  await session.settle();
  expect(asked).toBe(1);
});

test("loadSavedGame gives up the film BEFORE it throws the viewer away", async () => {
  // The ordering is the whole test. GameHost.loadSavedGame replaces the viewer
  // before it calls session.loadGame, so a film abandoned from inside the load
  // reaches a fresh player with nothing playing — and the real one keeps its
  // promise for ever. Measured against a live page before this was right: the
  // promise was still unsettled six seconds after the load.
  const { host, session, viewer } = await newHost();
  await host.loadSavedGame(new Uint8Array(readFileSync(savePath("1", "03 - Found the Gymnasium.ti"))));
  await session.settle();

  let settled = false;
  const film = Promise.resolve(session.onPlayMovie("logo.mov", 0)).then(() => (settled = true));
  await drain();
  await drain();
  if (!viewer().moviePlaying) return; // no full tree installed, or nothing to play

  await host.loadSavedGame(new Uint8Array(readFileSync(savePath("1", "06 - Boiler Room.ti"))));
  await session.settle();
  // a race, because the failure mode is a promise that never settles: awaiting
  // it outright would hang the run instead of failing it
  await Promise.race([film, new Promise((r) => setTimeout(r, 2000))]);
  expect(settled).toBe(true);
});

test("loadGame from the control panel re-shows the room (no white screen)", async () => {
  const session = await newSession();
  // reach a normal room first so there's an in-game stage under the overlay.
  await session.loadGame(new Uint8Array(readFileSync(savePath("1", "03 - Found the Gymnasium.ti"))));
  await session.settle();

  // open the control panel exactly like the in-game Settings prop: this hides
  // the room (setVisible=false) and pushes the current stage onto the overlay
  // stack — the state a load is actually launched from.
  await session.transToFlat("ctl.stg");
  await session.settle();
  expect(session.setVisible).toBe(false);

  // loading from here must bring the room back, not leave the empty band showing.
  await session.loadGame(new Uint8Array(readFileSync(savePath("1", "06 - Boiler Room.ti"))));
  await session.settle();
  expect(session.setVisible).toBe(true);
  expect(session.stageName).toBe("main.stg");
  // a stale ctl.stg overlay frame must not linger to be popped later.
  await session.transFromFlat();
  expect(session.setVisible).toBe(true); // still in the room, nothing stale restored
});

/**
 * #162. TI.EXE puts the *Open* dialog up over nothing: the wrapper that calls
 * `GetOpenFileNameA` (`0x420e40`) hides every one of the game's own windows
 * first (`0x420500`) and shows them again after (`0x4205e0`), so what is behind
 * the dialog is not a frame the game drew — it is no window at all. The restore
 * then blacks the screen itself, in code (`0x41420e` runs `blackscreen`'s exact
 * five calls), and lets the room be drawn over it.
 *
 * Driven through the panel's real "open" lever, which is the only caller of
 * `opengame` in the game, so the cancel arm is the script's own.
 */
test("the load dialog holds a black screen, and the panel comes back on cancel (#162)", async () => {
  const session = await newSession();
  await session.loadGame(new Uint8Array(readFileSync(savePath("1", "03 - Found the Gymnasium.ti"))));
  await session.settle();
  await session.transToFlat("ctl.stg");
  await session.settle();
  // the panel's own fade-in, drained the way the render loop drains it — a
  // headless session never ticks the ramp, and this test is about what is
  // holding the screen AFTER it is up.
  session.fade.queue.length = 0;
  session.fade.level = 0;

  // the panel's own lever, reached the way HOUSE.SHP reaches it: the brass
  // button is a prop, its script is a ctl.stg container, and the click travels
  // `sendtobutton (currentflat (), name, fakemousedown (0))`. Arg 0 skips the
  // eight-frame spark animation, which wants real frames.
  const pull = () =>
    session.stageCtrl.sendToButton(session.currentFlat, "open", "fakemousedown", [0], "open");

  // cancelled: black while the dialog is up, and the panel back afterwards
  // with no ramp left behind — the original never repainted it, it uncovered it.
  let whileOpen = -1;
  let frozen = false;
  session.onLoadGame = async () => {
    whileOpen = session.fade.level;
    frozen = session.frozen;
    return null;
  };
  await pull();
  expect(whileOpen).toBe(1);
  expect(frozen).toBe(true); // the world stops while the dialog owns the screen
  expect(session.frozen).toBe(false);
  expect(session.fade.level).toBe(0);
  expect(session.fade.queue.length).toBe(0);
  expect(session.stageName).toBe("ctl.stg"); // the lever's own cancel check

  // a file we cannot read is a cancel too: the panel is still standing.
  session.onLoadGame = async () => new Uint8Array([1, 2, 3, 4]);
  await pull();
  expect(session.fade.level).toBe(0);
  expect(session.stageName).toBe("ctl.stg");

  // and a real load ends on the loaded room, drawn — not on the black it was
  // rebuilt behind.
  whileOpen = -1;
  session.onLoadGame = async () => {
    whileOpen = session.fade.level;
    return new Uint8Array(readFileSync(savePath("1", "06 - Boiler Room.ti")));
  };
  await pull();
  await session.settle();
  expect(whileOpen).toBe(1);
  expect(session.stageName).toBe("main.stg");
  expect(session.setVisible).toBe(true);
  expect(session.fade.level).toBe(0);
  expect(session.fade.queue.length).toBe(0);
});

/**
 * The SAME black, on the other way in.
 *
 * The test above drives `opengame`, the panel's own lever, which clears the
 * level itself when `loadGame` returns. `GameHost.loadSavedGame` is the host's
 * entry point for a `.ti` — what the saves modal calls, and what a page that
 * restores a game without going through the CTL panel calls — and it did not.
 * So a game loaded that way restored correctly and then sat behind a
 * full-screen black: the right room, the right standpoint, nothing on screen.
 *
 * Asserted on the host rather than the session because the missing line is the
 * host's: `loadGame` blacking the screen is faithful (TI.EXE's restore runs
 * `blackscreen`'s five calls before rebuilding the palette), and every caller
 * owes the room the reveal afterwards.
 */
test("a save loaded through the host lifts whatever fade was holding the screen", async () => {
  const { host, session } = await newHost();
  // whatever the page was showing when it decided to restore — here, held black
  session.fade.level = 1;
  await host.loadSavedGame(new Uint8Array(readFileSync(savePath("1", "06 - Boiler Room.ti"))));
  await session.settle();
  expect(session.setVisible).toBe(true);
  expect(session.fade.level).toBe(0);
});

/**
 * The freeze itself. Every timed thing in the engine — the service pass,
 * `delay`, the fade and wipe ramps, prop animation, movies — reads one clock,
 * and the viewer hands it this. So holding it is the whole pause: nothing
 * advances while the dialog is up, and what follows continues from where it
 * stopped rather than replaying the gap.
 */
test("a frozen world does not live through the time the dialog took (#162)", () => {
  const session = new GameSession(gamefiles(root).provider, new NullAudioSink());
  expect(session.gameTime(1_000)).toBe(1_000);
  session.freezeTime();
  expect(session.frozen).toBe(true);
  expect(session.gameTime(4_000)).toBe(1_000); // three seconds of dialog, no game time
  expect(session.gameTime(9_000)).toBe(1_000);
  session.thawTime();
  expect(session.frozen).toBe(false);
  expect(session.gameTime(9_000)).toBe(1_000); // picks up where it stopped...
  expect(session.gameTime(9_500)).toBe(1_500); // ...and runs on unbroken
});

/**
 * #52, the whole of it. The London flat's air raid ends in
 * `bombit() -> sendtostage (advanceday ())`, and `advanceday` is a switch on
 * `clock`: "startdisk1" replays the intro in the flat, "bedsit" sails for the
 * Titanic. A load that put back the wrong value therefore didn't misplay a
 * detail — it sent the bombing back to the beginning, into a restarted flat
 * with the sirens up and only the door alive (#36 again, one entry point over).
 *
 * Asserted on the branch rather than on the movies: what the arm does first is
 * set `mission`, and the two arms disagree about it (0 in the flat, 1 at sea).
 */
test("the flat's air raid sails for the Titanic after a load, not back to the flat", async () => {
  const session = await newSession();
  await session.loadGame(new Uint8Array(readFileSync(savePath("1", "01 - April 14th, 1942.ti"))));
  await session.settle();
  expect(session.currentSetName).toBe("bedsit1");

  // the last thing bombit() does, verbatim.
  await session.sendEvent("sendtostage", session.stageName, "advanceday", [], "test");
  await session.settle();

  expect(session.interp.globals.get("mission")).toBe(1);
  expect(session.currentSetName).not.toBe("bedsit1");
});

/**
 * A sink that records WHEN each play and each halt happened relative to the
 * others. {@link NullAudioSink} keeps plays and halts in two separate lists, so
 * it can say a channel was halted at some point but not whether the halt came
 * before or after the room's own music — which is the whole question below.
 */
class OrderedAudioSink implements AudioSink {
  events: { kind: "play" | "halt"; channel: AudioChannel }[] = [];
  channelVolume: Record<AudioChannel, number> = { sound: 1, voice: 1, theme: 0.6 };
  setChannelVolume(channel: AudioChannel, volume: number): void {
    this.channelVolume[channel] = volume;
  }
  /** nothing here is paced, so a freeze changes nothing to record */
  setSuspended(): void {}
  play(channel: AudioChannel, _audio: DecodedAudio, opts?: PlayOpts): PlayHandle {
    this.events.push({ kind: "play", channel });
    let stopped = false;
    return {
      get done() {
        return stopped || !opts?.loop;
      },
      stop: () => (stopped = true),
    };
  }
  halt(channel: AudioChannel): void {
    this.events.push({ kind: "halt", channel });
  }
  isDone(): boolean {
    return true;
  }
  /** the first thing that happened on a channel since {@link since} */
  firstOn(channel: AudioChannel, since: number): "play" | "halt" | "nothing" {
    return this.events.slice(since).find((e) => e.channel === channel)?.kind ?? "nothing";
  }
}

test("loadGame silences the room you left before the loaded room scores itself", async () => {
  // The London flat's radio following you into the loaded room. `advanceday()`
  // halts the theme before opening the next day's room (BOOTFILE 0002:148) and a
  // load has to do the same, because the ARRIVING room cannot be relied on to
  // cover for it: setupsound sometimes deliberately scores nothing (C73 at
  // mission 1 phase 0 is scored by the Smethells knock), and then bedrad1.trk —
  // whose loop chunks are the announcer — reads the news over the loaded room.
  //
  // So the assertion is about ORDER, not merely that a halt happened somewhere:
  // the first thing to reach the theme channel after the load begins must be the
  // silence, whatever the destination goes on to play. Leave it to the
  // destination and this reads "play" (a room that scores) or "nothing" (a room
  // that doesn't) — the two shapes of the bug.
  const sink = new OrderedAudioSink();
  const session = await newSession(sink);
  await session.loadGame(new Uint8Array(readFileSync(savePath("1", "03 - Found the Gymnasium.ti"))));
  await session.settle();

  // the radio, exactly as playtheme leaves it (audio.ts): a looping play on the
  // theme channel plus the session's record of which track is up.
  const radio: DecodedAudio = { sampleRate: 22050, samples: new Float32Array(22050) };
  session.audio.play("theme", radio, { loop: true });
  session.currentThemeName = "bedrad1.trk";
  // and a line in flight on the voice channel — the scheduler doesn't own this
  // one either, and puppet.ts only halts it on skip/stop, which a load is not.
  session.audio.play("voice", radio, { loop: true });

  const mark = sink.events.length;
  await session.loadGame(new Uint8Array(readFileSync(savePath("1", "06 - Boiler Room.ti"))));
  await session.settle();

  expect(sink.firstOn("theme", mark), "the theme channel is silenced first").toBe("halt");
  expect(sink.firstOn("voice", mark), "the voice channel is silenced first").toBe("halt");
  // and the session must stop claiming the flat's radio is up: transfromflat's
  // overlay restore keys off currentThemeName, so a stale reading is how closing
  // a later overlay would put the radio BACK.
  expect(session.currentThemeName).not.toBe("bedrad1.trk");
});

test("snapshotSave after a load reproduces the restored progress", async () => {
  const session = await newSession();
  const path = savePath("1", "03 - Found the Gymnasium.ti");
  const save = parseSave(new Uint8Array(readFileSync(path)));
  await session.loadGame(new Uint8Array(readFileSync(path)));
  await session.settle();

  const out = session.snapshotSave();
  expect(out).not.toBeNull();
  const re = parseSave(out!);
  // the numeric globals we round-trip must survive a snapshot.
  expect(re.numGlobals.get("mission")).toBe(save.numGlobals.get("mission"));
  expect(re.numGlobals.get("neckphase")).toBe(save.numGlobals.get("neckphase"));
});

// ---------------------------------------------------------------------------
// The frame counter and the stamps that measure against it (#221)
// ---------------------------------------------------------------------------

/**
 * A handful of globals hold an ABSOLUTE `frame()` reading — `paintframe` (the
 * ten minutes you have to reach the cargo-hold painting), `lastsail`,
 * `jonesframe`, `secframe` — and the game only ever reads them back as
 * `frame() - stamp`. Both halves therefore have to survive a save: the stamp,
 * which needs the node's full 32-bit value field, and the counter itself, which
 * container 1 carries at @442.
 */
test("a shipped save's frame stamps sit just under its own frame counter", () => {
  const stampNames = ["paintframe", "lastsail", "jonesframe", "secframe"];
  let wide = 0;
  for (const path of allSaves()) {
    const save = parseSave(new Uint8Array(readFileSync(path)));
    const name = path.replace(/.*\//, "");
    for (const stamp of stampNames) {
      const v = save.numGlobals.get(stamp);
      if (v === undefined || v === 0) continue; // never stamped in this game
      check(`${name} ${stamp} <= frame`, v <= save.frame, `${stamp}=${v} frame=${save.frame}`);
      if (v > 32767) wide++;
    }
  }
  // guard the guard: the point of the 32-bit read is the stamps a word cannot
  // hold, and the corpus has to actually contain some
  expect(wide).toBeGreaterThan(20);
});

test("a number too wide for a word round-trips through a patch", () => {
  const path = savePath("1", "13 - Recovering the Painting from Cargo Hold.ti");
  const save = parseSave(new Uint8Array(readFileSync(path)));
  // the save's own value, read at full width rather than clamped to 32767
  expect(save.numGlobals.get("paintframe")).toBe(165697);
  expect(save.frame).toBe(171071);

  const numGlobals = new Map(save.numGlobals);
  numGlobals.set("paintframe", 200000);
  const re = parseSave(applyPatch(save.raw, {
    numGlobals, set: save.set, scene: save.scene, view: save.view, frame: 210000,
  }));
  expect(re.numGlobals.get("paintframe")).toBe(200000);
  expect(re.frame).toBe(210000);
  // a boolean beside it keeps its tag and its value
  expect(re.numGlobals.get("mission")).toBe(save.numGlobals.get("mission"));
});

/**
 * The report (#221): save in front of the crate with the painting still there,
 * come back to that save later in the same session, and the painting is gone —
 * BINL.SET's `frame() - paintframe > 10000` was measuring from the browser tab's
 * start rather than from the saved game's.
 */
test("loadGame puts the frame counter back where the save left it", async () => {
  const session = await newSession();
  const path = savePath("1", "13 - Recovering the Painting from Cargo Hold.ti");
  await session.loadGame(new Uint8Array(readFileSync(path)));
  await session.settle();
  const stamp = session.interp.globals.get("paintframe") as number;
  // the saved game is 5374 frames past the stamp — four and a half minutes of
  // the ten, not the eternity a session-long counter reports
  expect(session.frameCounter - stamp).toBe(171071 - 165697);

  // and a save the port takes carries both halves on, unchanged by the trip
  session.frameCounter += 4000;
  session.interp.globals.set("paintframe", 169000);
  const re = parseSave(session.snapshotSave()!);
  expect(re.frame).toBe(175071);
  expect(re.numGlobals.get("paintframe")).toBe(169000);
});

test("loadGame rejects a non-save / foreign file", async () => {
  const session = await newSession();
  expect(await session.loadGame(new Uint8Array([1, 2, 3, 4]))).toBe(false);
});

// ---- inventory (held items) ----------------------------------------------

test("parseSave decodes inventory possession", () => {
  const path = savePath("2", "28 - Willy Murdered!.ti");
  const save = parseSave(new Uint8Array(readFileSync(path)));
  const owned = save.inventory.filter((p) => invNames.has(p.name) && p.owner === "frank");
  // this save has Frank carrying several items (ring, gaspen, pipe, ...).
  expect(owned.length).toBeGreaterThan(3);
  const ring = save.inventory.find((p) => p.name === "ring");
  expect(ring?.owner).toBe("frank");
});

test("loadGame restores every inventory item's owner + view", async () => {
  const session = await newSession();
  const path = savePath("2", "28 - Willy Murdered!.ti");
  const save = parseSave(new Uint8Array(readFileSync(path)));
  await session.loadGame(new Uint8Array(readFileSync(path)));
  await session.settle();

  let checked = 0;
  for (const sp of save.inventory) {
    if (!invNames.has(sp.name)) continue; // only inven.shp props are restored
    const p = session.propRuntime.get(sp.name);
    if (!p) continue;
    checked++;
    expect.soft((String(p.owner) || "none").toLowerCase(), sp.name).toBe(sp.owner);
    expect.soft((String(p.stateName) || "large").toLowerCase(), sp.name).toBe(sp.view);
  }
  expect(checked).toBeGreaterThan(20); // all ~28 inventory props present
  // no shipped save holds an in-hand item.
  expect(session.interp.globals.get("handitem")).toBe("");
});

test("snapshotSave captures a newly-collected item", async () => {
  const session = await newSession();
  const path = savePath("2", "28 - Willy Murdered!.ti");
  await session.loadGame(new Uint8Array(readFileSync(path)));
  await session.settle();

  // Frank picks up photo1 (not owned in this save) and stows it.
  const photo = session.propRuntime.get("photo1")!;
  expect(String(photo.owner)).not.toBe("frank");
  photo.owner = "frank";
  photo.stateName = "panel1";

  const re = parseSave(session.snapshotSave()!);
  expect(re.inventory.find((p) => p.name === "photo1")).toMatchObject({
    name: "photo1",
    view: "panel1",
    owner: "frank",
  });
  // an already-owned item is preserved.
  expect(re.inventory.find((p) => p.name === "ring")?.owner).toBe("frank");
});

/**
 * The bag is the one item you cannot do without, and it is not an inven.shp
 * prop — it lives in the house.shp interface band. A snapshot that walked only
 * the inventory shop wrote no bag record, so loading your own save came back
 * with `propowner("bag") = "none"`; house.shp's initinterface() then puts the
 * bag back on the C73 bed, and `addbag()` is the only thing that ever grants the
 * trunk key. That made the trunk — and the Enigma machine inside it —
 * permanently unopenable from a mid-game save, which is what the mission 1
 * playthrough walked into.
 */
test("snapshotSave records the band's held items (bag/watch/map), not just the inventory", async () => {
  const session = await newSession();
  const path = savePath("1", "03 - Found the Gymnasium.ti");
  await session.loadGame(new Uint8Array(readFileSync(path)));
  await session.settle();

  // as if the player had just picked the bag up off the bed: addbag() sets
  // possession, closes it into the band, and hands over the trunk key
  for (const name of ["bag", "watch", "map"]) {
    const p = session.propRuntime.get(name);
    expect(p, `${name} is a loaded prop`).toBeTruthy();
    p!.owner = "frank";
  }
  session.propRuntime.get("trunkkey")!.owner = "frank";

  const re = parseSave(session.snapshotSave()!);
  for (const name of ["bag", "watch", "map"]) {
    expect(re.inventory.find((p) => p.name === name)?.owner, `${name} survives a snapshot`).toBe("frank");
  }
  expect(re.inventory.find((p) => p.name === "trunkkey")?.owner).toBe("frank");
});

/**
 * The saves that record an open pocketwatch, and what they all agree on. The
 * watch is left open for the endgame — the sinking is on a clock — and every one
 * of the 17 is an ENDGAME save, recording the same assembly: dial "run", lid
 * "run", the three wheels in their single "idle" state.
 */
function openWatchSaves(): string[] {
  return allSaves().filter((p) => {
    const w = parseSave(new Uint8Array(readFileSync(p))).inventory.find((q) => q.name === "watch");
    return w?.view === "run";
  });
}

// `propis3d` is the record's world-vs-screen flag, and the loader restores it:
// the LIVE flag is whatever the running game last did with the prop, and the
// London flat — the boot's landing room — places the watch and bag as world
// props, so a stale flag left a loaded band with its watch and bag restored but
// never drawn (drawList skips world props). The corpus fixes the field's
// meaning: 1 exactly while they still lie on the cabin furniture (unowned,
// view "small" — the 4 pre-boarding saves), 0 once they sit in the band.
test("propis3d is 1 exactly while the watch/bag still lie in the world", () => {
  const saves = allSaves();
  expect(saves.length).toBeGreaterThan(0);
  let world = 0;
  for (const path of saves) {
    const inv = parseSave(new Uint8Array(readFileSync(path))).inventory;
    for (const n of ["watch", "bag"]) {
      const p = inv.find((q) => q.name === n);
      if (!p) continue;
      const onFurniture = p.owner === "none" && p.view === "small";
      if (p.is3d) world++;
      check(`${path}: ${n} is3d matches its place`, p.is3d === onFurniture,
        `is3d=${p.is3d} view=${p.view} owner=${p.owner}`);
    }
  }
  check("the pre-boarding saves are represented", world === 8, `${world} world records`);
});

test("17 shipped saves record the watch left open, and agree on the assembly", () => {
  const open = openWatchSaves();
  expect(open.length).toBe(17);
  for (const p of open) {
    const inv = parseSave(new Uint8Array(readFileSync(p))).inventory;
    const view = (n: string) => inv.find((q) => q.name === n)?.view;
    check(`${p}: lid "run"`, view("lid") === "run", `got "${view("lid")}"`);
    for (const n of ["hrs", "min", "sec"]) {
      check(`${p}: ${n} "idle"`, view(n) === "idle", `got "${view(n)}"`);
    }
  }
});

/**
 * An open watch comes back OPEN, PLACED and TICKING — and, above all, clickable.
 *
 * `showinterface()` brings the lid and the three wheels back visible when the
 * dial's view is "run", but it neither places them nor gives the lid a state:
 * in normal play only the watch's own `open()` ever makes the lid visible, and it
 * does both. A load reaches the same screen without going through `open()`, so
 * the four came back at the default anchor in mid-screen at dist 0 — and with a
 * lid that is visible and not "run", `watchidle()` is false forever, which is
 * every band handler's first line (`if not watchidle() exitcode`). The bag, the
 * map and the lifebuoy stopped answering, and the lifebuoy is the way to the CTL
 * panel: a game that could not be saved, loaded out of, or opened.
 */
test("loadGame reassembles an open pocketwatch: placed, lid running, band alive", async () => {
  const session = await newSession();
  const path = savePath("ENDGAME1", "06 - Gave Antidote to Georgia.ti");
  const save = parseSave(new Uint8Array(readFileSync(path)));
  expect(save.inventory.find((p) => p.name === "watch")?.view).toBe("run");
  expect(save.numGlobals.get("mission")).toBe(4);

  await session.loadGame(new Uint8Array(readFileSync(path)));
  await session.settle();

  const p = (n: string) => session.propRuntime.get(n)!;
  // the dial itself: the half cfc8f74 fixed, and the gate for everything below
  expect(String(p("watch").stateName)).toBe("run");
  // the lid at rest over the running dial, on mission 4's face (run() picks the
  // deg: 0 below mission 4, 1 from it) — a 2-frame deg selector, so it HOLDS
  expect(String(p("lid").stateName)).toBe("run");
  expect(p("lid").deg).toBe(1);
  expect(p("lid").animating).toBe(false);
  // ...and the whole assembly stacked in the band, not adrift in mid-screen
  for (const [name, dist] of [
    ["lid", -6],
    ["hrs", -5],
    ["min", -5],
    ["sec", -4],
  ] as const) {
    expect.soft(p(name).visible, `${name} is up`).toBe(true);
    expect.soft([p(name).anchorX, p(name).anchorY], `${name} at the band anchor`).toEqual([256, 324]);
    expect.soft(p(name).dist, `${name} dist`).toBe(dist);
  }

  // the band answers again — this is what a dead lid took away
  expect(await session.sendEvent("sendtoshop", "house.shp", "watchidle", [], "test")).toBeTruthy();

  // and the dial RUNS: calctime advances `sec` and points the wheel by propdeg,
  // one game-second per 20 calls. The frame follows the deg (deg-selector state).
  const before = Number(session.interp.globals.get("sec"));
  for (let i = 0; i < 60; i++) await session.runGlobal("calctime");
  const after = Number(session.interp.globals.get("sec"));
  expect(after).not.toBe(before);
  expect(p("sec").deg).toBe(after);
  expect(p("sec").frameIdx).toBe(after);
});

test("applyPatch inventory edits parse back", () => {
  const path = savePath("1", "03 - Found the Gymnasium.ti");
  const save = parseSave(new Uint8Array(readFileSync(path)));
  const inventory = save.inventory.map((p) =>
    p.name === "notebook" ? { name: "notebook", view: "panel2", owner: "frank" } : p,
  );
  const out = applyPatch(save.raw, {
    numGlobals: save.numGlobals,
    set: save.set,
    scene: save.scene,
    view: save.view,
    inventory,
  });
  const re = parseSave(out);
  expect(re.inventory.find((p) => p.name === "notebook")).toMatchObject({
    name: "notebook",
    view: "panel2",
    owner: "frank",
  });
});

// ---- actors (the crew's memory of the player) -----------------------------

// `actorowner` is a story gate — the Purser's whole mission-2 errand is a ladder
// of his — and the port was not saving it at all: a checkpoint taken with him at
// "sendgram" came back at "none", the telegram unexplained and the ladder reset.
// It IS in the format, on its own 160-byte grid. Ground truth is the shipped save
// of exactly that moment.
test("parseSave decodes the crew's actorowner state", () => {
  const save = parseSave(
    new Uint8Array(readFileSync(savePath("1", "12 - Sending Telegram for Jack Thayer.ti"))),
  );
  const owner = (name: string) => save.actors.find((a) => a.name === name)?.owner;
  expect(owner("purs"), "the errand this save is named after").toBe("sendgram");
  expect(owner("morrow"), "and the permission that made it possible").toBe("enterwireless");
  expect(owner("csea"), "the engineer, thanked back in mission 1").toBe("thanks1");
  expect(owner("vlad"), "the stoker, bought off with his brother's supper").toBe("help");
  expect(owner("penny"), "and one who wants nothing").toBe("none");
});

// The grid must be found in every shipped save, and must not be confused with a
// container that merely looks like it. The globals container is the trap: it is a
// grid of 32-byte variable nodes and 32 divides 160, so every fifth node sits one
// actor stride from the last and a pair of variable names 64 bytes apart decodes
// as a name/owner record. Three ENDGAME2 saves prefer it on record count alone,
// and a patch would then write actor owners over variable names.
test("every shipped save yields a real actor grid, not a look-alike", () => {
  const saves = allSaves();
  expect(saves.length).toBeGreaterThan(0);
  for (const path of saves) {
    const save = parseSave(new Uint8Array(readFileSync(path)));
    check(`${path}: actor container found`, save.actorsIndex >= 0, `index ${save.actorsIndex}`);
    check(`${path}: not the globals container`, save.actorsIndex !== save.globalsIndex);
    check(`${path}: not the string pool`, save.actorsIndex !== save.globalsIndex + 1);
    check(`${path}: not the prop container`, save.actorsIndex !== save.inventoryIndex);
    // the cast is the ship's company, and the Purser is in all of it
    check(`${path}: the cast is there`, save.actors.length >= 10, `${save.actors.length} actors`);
    check(`${path}: purs is in it`, save.actors.some((a) => a.name === "purs"));
  }
});

test("applyPatch writes actor owners that parse back", () => {
  const save = parseSave(new Uint8Array(readFileSync(savePath("1", "03 - Found the Gymnasium.ti"))));
  const out = applyPatch(save.raw, {
    numGlobals: save.numGlobals,
    set: save.set,
    scene: save.scene,
    view: save.view,
    actors: [
      { name: "purs", owner: "foundcuff", value: 4 },
      { name: "morrow", owner: "enterwireless", value: 0 },
    ],
  });
  const re = parseSave(out);
  expect(re.actors.find((a) => a.name === "purs")?.owner).toBe("foundcuff");
  expect(re.actors.find((a) => a.name === "morrow")?.owner).toBe("enterwireless");
  // actorvalue rides the same record, and zero is a value like any other — it is
  // what a save taken before you met someone has to put back (issue #27)
  expect(re.actors.find((a) => a.name === "purs")?.value).toBe(4);
  expect(re.actors.find((a) => a.name === "morrow")?.value).toBe(0);
  // and the rest of the cast is left as the base had it
  expect(re.actors.length).toBe(save.actors.length);
  expect(re.actors.find((a) => a.name === "penny")?.owner).toBe(
    save.actors.find((a) => a.name === "penny")?.owner,
  );
});

// The round trip that the playthrough's segment 7/8 split depends on: set an
// owner in a live session, snapshot, load it back into a fresh one.
test("snapshotSave and loadGame carry actorowner through a save", async () => {
  const session = await newSession();
  await session.loadGame(new Uint8Array(readFileSync(savePath("1", "03 - Found the Gymnasium.ti"))));
  await session.settle();
  const purs = session.actorRuntime.get("purs");
  expect(purs, "the Purser's cast is loaded for the whole voyage").not.toBeNull();
  purs!.owner = "sendgram";
  const bytes = session.snapshotSave();
  expect(bytes).not.toBeNull();

  const next = await newSession();
  expect(await next.loadGame(bytes!)).toBe(true);
  await next.settle();
  expect(next.actorRuntime.get("purs")?.owner, "his errand survived the save").toBe("sendgram");
});

// The counterpart, and the one that shipped broken: a load has to UNDO a
// conversation, not just carry one forward.
//
// TAOOT's `runpuppet` ends every exchange with `actorvalue(target,
// actorvalue(target) + 1)`, and each character's idle gates the approach on it:
// `if actorvalue(me) <= 0 → hasattention(4)`, else `clearattention()`. The count
// lived only in the running session, so talking to someone and then loading a
// save from BEFORE you met them left the count standing — they never walked up
// again for the rest of the session, and clicking them opened the "we have met"
// branch of their puppet instead of the introduction. Reported against both the
// Vlad and the Max softlocks (#19, #21) and split out as #27.
//
// Both directions are asserted here: a raised count survives its own save, and a
// save taken with a lower one puts it back.
test("snapshotSave and loadGame carry actorvalue, in both directions", async () => {
  const session = await newSession();
  await session.loadGame(new Uint8Array(readFileSync(savePath("1", "03 - Found the Gymnasium.ti"))));
  await session.settle();
  const vlad = session.actorRuntime.get("vlad");
  expect(vlad, "the whole ship's company is loaded for the voyage").not.toBeNull();
  expect(vlad!.value, "nobody has spoken to him this early").toBe(0);

  // the save you take before meeting him, then the conversation
  const before = session.snapshotSave();
  vlad!.value = 3;
  const after = session.snapshotSave();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();

  const met = await newSession();
  expect(await met.loadGame(after!)).toBe(true);
  await met.settle();
  expect(met.actorRuntime.get("vlad")?.value, "the conversations survived the save").toBe(3);

  // and the load that has to undo it: the same session, having met him, loading
  // the earlier file — which is exactly what the reporters did
  met.actorRuntime.get("vlad")!.value = 9;
  expect(await met.loadGame(before!)).toBe(true);
  await met.settle();
  expect(met.actorRuntime.get("vlad")?.value, "and a load before the meeting undoes it").toBe(0);
});

// ---- globals with no record in the base ----------------------------------

// A `.ti` carries the variable list that existed when it was taken, and the engine
// creates a global on first assignment — so an early save has no record for a
// later one, and a patch had nothing to write into. `savedeck` and `hallside` are
// missing from exactly the four pre-boarding saves of the 109 shipped, and the
// template picker used to take the first file in save/1, which is one of them: with
// that template 12 of the 107 globals the engine holds at the end of mission 2
// phase 0 were silently dropped. (Which base is lent is now ranked by capacity —
// see the two tests below.)
test("applyPatch makes a record for a global the base has never held", () => {
  const path = savePath("1", "01 - April 14th, 1942.ti");
  const save = parseSave(new Uint8Array(readFileSync(path)));
  expect(save.vars.some((v) => v.name === "savedeck"), "the template really lacks it").toBe(false);
  expect(save.vars.some((v) => v.name === "hallside"), "and this one").toBe(false);

  const out = applyPatch(save.raw, {
    numGlobals: save.numGlobals,
    strGlobals: new Map([["savedeck", "c"], ["hallside", "star"], ["handitem", "rubaiyat"]]),
    set: save.set, scene: save.scene, view: save.view,
  });
  const re = parseSave(out);
  expect(re.strGlobals.get("savedeck"), "the deck the staircase shows").toBe("c");
  expect(re.strGlobals.get("hallside"), "and which side of the hall you are on").toBe("star");
  // a record the base DID have still works, and nothing else moved
  expect(re.strGlobals.get("handitem")).toBe("rubaiyat");
  expect(re.numGlobals.get("mission")).toBe(save.numGlobals.get("mission"));
  expect(re.vars.length, "two records were made").toBe(save.vars.length + 2);
});

// ---- which base save gets lent to a fresh playthrough --------------------

// The corpus's whole vocabulary: every global any shipped save holds, with the
// type the first one to hold it used. This is the yardstick for "how much can a
// base carry" — a session late in the game holds most of it.
function corpusGlobals(): { num: Map<string, number>; str: Map<string, string> } {
  const num = new Map<string, number>();
  const str = new Map<string, string>();
  for (const path of allSaves()) {
    const s = parseSave(new Uint8Array(readFileSync(path)));
    for (const [k, v] of s.numGlobals) if (!num.has(k) && !str.has(k)) num.set(k, (v || 0) + 1);
    for (const [k, v] of s.strGlobals) if (!num.has(k) && !str.has(k)) str.set(k, v || "x");
  }
  return { num, str };
}

/** how many of `wanted` a patch of this base would have to leave behind */
function dropCount(path: string, wanted: ReturnType<typeof corpusGlobals>): number {
  const save = parseSave(new Uint8Array(readFileSync(path)));
  const dropped: string[] = [];
  applyPatch(save.raw, {
    numGlobals: wanted.num, strGlobals: wanted.str,
    set: save.set, scene: save.scene, view: save.view,
    onDrop: (n) => dropped.push(n),
  });
  return dropped.length;
}

// `globalsCapacity` COUNTS the free slots rather than making the records, because
// ranking 109 saves the other way costs 200 ms of a page load instead of 15. This
// is what stops the count and the maker drifting apart: every shipped save, both
// ways, same answer.
test("the free-slot count agrees with actually making the records", () => {
  for (const path of allSaves()) {
    const save = parseSave(new Uint8Array(readFileSync(path)));
    const counted = globalsCapacity(save.raw).free;
    // make them, one at a time, until a patch reports the next one dropped
    let made = 0;
    let raw = save.raw;
    for (let i = 0; i < counted + 3; i++) {
      const names = new Map<string, number>();
      for (let j = 0; j <= i; j++) names.set(`zzfree${j}`, j + 1);
      let dropped = 0;
      const out = applyPatch(raw, {
        numGlobals: names, set: save.set, scene: save.scene, view: save.view,
        onDrop: () => dropped++,
      });
      if (dropped) break;
      made = i + 1;
      void out;
    }
    check(`${path.split("/").slice(-2).join("/")}: ${counted} counted`, made === counted, `made ${made}`);
  }
});

// The measurement behind ranking the templates (#85). What a base can hold is the
// records it has plus the free slots a record can still be made in, and the spread
// across the shipped 109 decides whether a puzzle survives a save.
test("a late shipped save can carry far more globals than an early one", () => {
  const wanted = corpusGlobals();
  check(
    "the corpus knows 163 globals between its saves",
    wanted.num.size + wanted.str.size === 163,
    `${wanted.num.size} numeric + ${wanted.str.size} string`,
  );
  const first = savePath("1", "01 - April 14th, 1942.ti");
  const cap = globalsCapacity(new Uint8Array(readFileSync(first)));
  check(
    "the London flat save — the old pick — has 96 records and 3 free slots",
    cap.records === 96 && cap.free === 3,
    `${cap.records} records, ${cap.free} free`,
  );
  const worst = dropCount(first, wanted);
  check("...so a patch of it drops 64 of the 163", worst === 64, `${worst} dropped`);
  // and what it drops is not bookkeeping
  const save = parseSave(new Uint8Array(readFileSync(first)));
  for (const name of ["boiler", "turbine", "condensor", "mazenumber", "stacklevel", "picone"]) {
    check(`...including ${name}`, !save.numGlobals.has(name) && !save.strGlobals.has(name));
  }
});

// The picker itself: same folders, ranked rather than first-listed. Kept per disk
// family because the `disk` field is not one a patch overwrites and the original
// engine reads it to know which CD to ask for.
test("the template picker lends the base that can hold the most", () => {
  const entries: SaveEntry[] = allSaves().map((path) => {
    const parts = path.split("/");
    return {
      path: `${parts[parts.length - 2]}/${parts[parts.length - 1]}`,
      folder: parts[parts.length - 2],
      name: parts[parts.length - 1].replace(/\.ti$/i, ""),
      bytes: new Uint8Array(readFileSync(path)),
      builtin: true,
      mtime: 0,
    };
  });
  check("the shipped saves are all there", entries.length === 109, `${entries.length} saves`);
  const wanted = corpusGlobals();
  const room = (b: Uint8Array) => {
    const c = globalsCapacity(b);
    return c.records + c.free;
  };
  for (const [disk, folders, want] of [
    ["1", ["1", "ENDGAME1"], 44],
    ["2", ["2", "ENDGAME2"], 24],
  ] as [string, string[], number][]) {
    const picked = bestTemplate(entries, folders);
    check(`disk ${disk} gets a template`, !!picked);
    if (!picked) continue;
    // it is the roomiest of its family...
    const best = Math.max(...entries.filter((e) => folders.includes(e.folder)).map((e) => room(e.bytes)));
    check(
      `disk ${disk}'s pick is the roomiest of its family`,
      room(picked.bytes) === best,
      `${picked.path} holds ${room(picked.bytes)}, best is ${best}`,
    );
    // ...and this is what a patch of it would have to leave behind
    const [sub, file] = [picked.path.slice(0, picked.path.indexOf("/")), picked.path.slice(picked.path.indexOf("/") + 1)];
    const drops = dropCount(savePath(sub, file), wanted);
    check(`disk ${disk} drops ${want} of the 163`, drops === want, `${drops} dropped from ${picked.path}`);
  }
});


// The whole point of the no-growth rule: a `.ti` describes its own storage — the
// globals container is `20 + 32 × capacity` bytes (the u16 at +2) and the pool is
// the size the blob declares at +12 — and TI.EXE allocates from those and copies
// the containers in. A container that has outgrown its own header is truncated on
// load or copied past the end of its block, so a patch fills FREE slots (every
// shipped save has some) and never lengthens anything. What doesn't fit is
// reported through `onDrop` instead of vanishing.
test("a patch never changes a container's length, however much is thrown at it", () => {
  const saves = allSaves();
  const shape = (s: ReturnType<typeof parseSave>) => {
    const g = s.raw.containers[s.globalsIndex].data;
    const dv = new DataView(g.buffer, g.byteOffset, g.byteLength);
    return {
      lens: s.raw.containers.map((c) => c.data.length),
      cap: dv.getUint16(2, true),
      globals: g.length,
      poolSize: dv.getUint32(12, true),
      pool: s.raw.containers[s.globalsIndex + 1].data.length,
    };
  };
  for (const path of saves) {
    const s = parseSave(new Uint8Array(readFileSync(path)));
    const sh = shape(s);
    check(`${path}: globals length = 20 + 32*capacity`, sh.globals === 20 + 32 * sh.cap, `${sh.globals}/${sh.cap}`);
    check(`${path}: pool length = the size the blob declares`, sh.pool === sh.poolSize, `${sh.pool}/${sh.poolSize}`);
  }

  // ask for far more than the base can hold: 40 new names, each with a new string
  const save = parseSave(new Uint8Array(readFileSync(savePath("1", "01 - April 14th, 1942.ti"))));
  const before = shape(save);
  const strGlobals = new Map<string, string>([["savedeck", "c"], ["hallside", "star"]]);
  for (let i = 0; i < 40; i++) strGlobals.set(`zznew${i}`, `zzvalue${i}`);
  const dropped: string[] = [];
  const re = parseSave(applyPatch(save.raw, {
    numGlobals: save.numGlobals, strGlobals, set: save.set, scene: save.scene, view: save.view,
    onDrop: (name) => dropped.push(name),
  }));
  const after = shape(re);
  expect(after.lens, "every container is exactly as long as it was").toEqual(before.lens);
  expect(after.cap, "and the node capacity is untouched").toBe(before.cap);
  expect(after.poolSize, "and so is the declared pool size").toBe(before.poolSize);
  // the two that decide where you come back standing won the free slots...
  expect(re.strGlobals.get("savedeck"), "savedeck goes first").toBe("c");
  expect(re.strGlobals.get("hallside"), "then hallside").toBe("star");
  // ...and the overflow is REPORTED rather than silently lost
  expect(dropped.length, "the rest were reported").toBeGreaterThan(30);
  expect(dropped, "and neither of the two that matter is among them").not.toContain("savedeck");
  expect(dropped).not.toContain("hallside");
  expect(re.numGlobals.get("mission"), "existing records still work").toBe(save.numGlobals.get("mission"));
});

// A new record has to have the byte shape the original writes, and the name field
// is where that bites: it holds a length byte + 11 characters before it runs into
// the DFValue vtable, and a longer name overflows INTO it — which is why
// `attentionspan` and `curattention` sit on clobbered vtables in the shipped saves.
// So the vtable is written first and the name over the top of it; the other order
// truncates the name, which no real save does.
test("a made record with a name longer than the field still reads back", () => {
  const save = parseSave(new Uint8Array(readFileSync(savePath("1", "01 - April 14th, 1942.ti"))));
  expect(save.vars.some((v) => v.name === "attentionspan"), "13 chars, and absent here").toBe(false);
  const numGlobals = new Map(save.numGlobals);
  numGlobals.set("attentionspan", 117);
  const re = parseSave(applyPatch(save.raw, {
    numGlobals, set: save.set, scene: save.scene, view: save.view,
  }));
  expect(re.numGlobals.get("attentionspan"), "the whole 13-character name decoded").toBe(117);
  // and the shipped saves that do this are still read the same way
  const busy = parseSave(new Uint8Array(readFileSync(savePath("1", "12 - Sending Telegram for Jack Thayer.ti"))));
  expect(busy.vars.some((v) => v.name === "attentionspan"), "as the original writes it").toBe(true);
});

// The invariant that keeps a patch honest: writing one global must not change the
// value of any OTHER. It is not free — in 28 of the 109 shipped saves a record
// holds a stale pool offset ABOVE the allocator's watermark, pointing at zeroed
// space that decodes as "" (the blackjack down-cards, `saveeast`), so allocating at
// the watermark alone would eventually write real bytes under one of them. Both a
// save where the two agree and one where they don't are checked.
test("patching one global leaves every other global's value alone", () => {
  for (const [dir, file] of [["1", "01 - April 14th, 1942.ti"], ["2", "09 - Exploring Turkish Bath.ti"]]) {
    const save = parseSave(new Uint8Array(readFileSync(savePath(dir, file))));
    // ask for one new string only; everything else is written back as it was
    const strGlobals = new Map(save.strGlobals);
    strGlobals.set("savedeck", "zzz-a-value-never-in-this-pool");
    const re = parseSave(applyPatch(save.raw, {
      numGlobals: save.numGlobals, strGlobals, set: save.set, scene: save.scene, view: save.view,
    }));
    expect(re.strGlobals.get("savedeck"), `${file}: the value we asked for`).toBe("zzz-a-value-never-in-this-pool");
    for (const [name, was] of save.strGlobals) {
      if (name === "savedeck") continue;
      check(`${file}: ${name} is untouched`, re.strGlobals.get(name) === was, `${JSON.stringify(was)} -> ${JSON.stringify(re.strGlobals.get(name))}`);
    }
    for (const [name, was] of save.numGlobals) {
      check(`${file}: ${name} is untouched`, re.numGlobals.get(name) === was, `${was} -> ${re.numGlobals.get(name)}`);
    }
  }
});

// Whatever a patch touches, the result must still be a well-formed container file:
// the position table is recomputed from the container lengths, so a patched save
// has to read back with the same container layout as the base it came from.
test("a patched save is still a well-formed container file", () => {
  const save = parseSave(new Uint8Array(readFileSync(savePath("1", "01 - April 14th, 1942.ti"))));
  const out = applyPatch(save.raw, {
    numGlobals: save.numGlobals,
    strGlobals: new Map([["savedeck", "boil3"], ["hallside", "port"], ["handitem", "rubaiyat"]]),
    set: "boil", scene: "scene40", view: "view45",
    inventory: save.inventory.map((p) => (p.name === "rubaiyat" ? { ...p, owner: "frank" } : p)),
    actors: [
      { name: "purs", owner: "sendgram", value: 1 },
      { name: "vlad", owner: "help", value: 2 },
    ],
  });
  const raw = readSaveFile(out);
  expect(containersEqual(raw, readSaveFile(writeSaveFile(raw))), "re-emits identically").toBe(true);
  expect(raw.containers.length, "same container count as the base").toBe(save.raw.containers.length);
  expect(raw.containers.map((c) => c.data.length), "and the same lengths").toEqual(
    save.raw.containers.map((c) => c.data.length),
  );
  // and everything asked for is in there
  const re = parseSave(out);
  expect(re.set).toBe("boil");
  expect(re.strGlobals.get("savedeck")).toBe("boil3");
  expect(re.actors.find((a) => a.name === "purs")?.owner).toBe("sendgram");
  expect(re.inventory.find((p) => p.name === "rubaiyat")?.owner).toBe("frank");
});

// The browser seeds its save store from the gamefiles.json manifest, matching
// the shipped-save paths by pattern. When the save folder moved from a flat
// `gamefiles/SAVE/` to `gamefiles/<lang>/save/` beside the disc volumes, that
// pattern silently matched nothing and the save browser came up empty — invisible
// here, because every other test reaches the saves through the filesystem index.
// Feed it the real manifest listing (what vite.config.ts's walk produces) and
// require it to find them all.
test("the dev-server manifest's shipped saves are all recognised for seeding", () => {
  const saves = allSaves();
  expect(saves.length).toBeGreaterThan(0);
  // the manifest is project-relative, forward-slashed, and lists ALL game files
  const manifest = saves.map((p) => p.replace(/\\/g, "/"));
  const found = shippedSaves(manifest);
  check(
    "every shipped .ti is picked up by the seeder",
    found.length === saves.length,
    `manifest=${saves.length} matched=${found.length}`,
  );
  // `rel` is the store key: "<folder>/<file>", folder being the save subdirectory
  for (const f of found) {
    check(`rel is folder-relative, not absolute: ${f.rel}`, /^[^/]+\/[^/]+\.ti$/i.test(f.rel), f.rel);
  }
  // and the historical flat layout must keep working
  const legacy = shippedSaves(["gamefiles/SAVE/1/03 - Found the Gymnasium.ti"]);
  check("a legacy flat gamefiles/SAVE/ dump still seeds", legacy.length === 1, JSON.stringify(legacy));
  check(
    "legacy rel strips the save folder",
    legacy[0]?.rel === "1/03 - Found the Gymnasium.ti",
    legacy[0]?.rel,
  );
  // a non-save .ti elsewhere in the tree must NOT be seeded
  check(
    "only files under a save/ folder are seeded",
    shippedSaves(["gamefiles/en/TITANIC1/data/notasave.ti"]).length === 0,
  );
});

/**
 * #4 — a load left the band lit and its arrow dark.
 *
 * The band has two looks and a click switches them: house.shp's
 * `activateinterface` puts the lifebuoy, watch and map on their "light" view,
 * shows the lamp, and sets `propdeg("navarrow", 1)`; `deactivateinterface`
 * darkens all four. The arrow is the only piece whose lit state is a DEGREE
 * rather than a view — the SHP says so, `navarrow` carrying green/red/yellow of
 * two frames each where `life`, `watch` and `map` have separate dark/light
 * states — so the old view-only band restore (`HELD_BAND_PROPS`, retired by
 * #143) could not carry it, and `initprops`' re-run of `initinterface` had just
 * set it to 0. It now rides the record's own `propdeg` like everything else.
 *
 * All 109 shipped saves record `life` as "light" (a save is taken from the CTL
 * panel, and the way in is a click on the lit lifebuoy), so this fired on every
 * load there is.
 */
test("a load brings the nav arrow back as lit as the rest of the band", async () => {
  const session = await newSession();
  const deg = (n: string): number => Number(session.propRuntime.get(n)?.deg ?? -1);
  const view = (n: string): string => String(session.propRuntime.get(n)?.stateName ?? "").toLowerCase();

  for (const file of ["11 - Giving Book to purser.ti", "06 - Boiler Room.ti"]) {
    await session.loadGame(new Uint8Array(readFileSync(savePath("1", file))));
    await session.settle();
    // the band came back lit — that is what the save records
    check(`${file}: the band is lit`, view("life") === "light", `life=${view("life")}`);
    check(`${file}: so is the arrow`, deg("navarrow") === 1, `navarrow deg=${deg("navarrow")}`);
  }

  // and the other way, so a rule that just wrote 1 would not pass: darken the
  // band the way a click on it does, save, and the load must bring back a DARK
  // arrow rather than a lit one.
  await session.sendEvent("sendtoshop", "house.shp", "deactivateinterface", [], "test");
  expect(view("life")).toBe("dark");
  const dark = session.snapshotSave();
  expect(dark).not.toBeNull();
  await session.loadGame(dark!);
  await session.settle();
  check("a save taken with the band dark loads dark", view("life") === "dark" && deg("navarrow") === 0,
    `life=${view("life")} navarrow deg=${deg("navarrow")}`);
});

/**
 * The actor record, decoded from TI.EXE's own accessors rather than guessed at.
 *
 * The frame is the thing this pins: `0x410d00` string-compares the name at
 * record+0x50, so the five string fields are the record's SECOND half and every
 * numeric field sits BEFORE the name. Reading the frame the other way is what put
 * `actorvalue` at name+152 — the same field one record along, so every character
 * was restored with their neighbour's conversation count, and #86's "the record
 * doesn't reliably hold a position" was really a read 80 bytes into the next
 * record's heap pointers.
 *
 * Each assertion below is a range the whole corpus has to satisfy, because a range
 * is what catches a re-based frame: shift these offsets by a record and `visible`
 * stops being a boolean, `deg` leaves 0..255, and `speed`/`zclip` stop being the
 * round numbers the scripts pass to them.
 */
test("the saved actor record decodes as TI.EXE's own accessors read it", () => {
  const records = allSaves().flatMap((p) =>
    parseSave(new Uint8Array(readFileSync(p))).actors.map((a) => ({ save: p, a })),
  );
  check(`the corpus has actor records (${records.length})`, records.length > 3000, `${records.length}`);

  // actorvisible (0x40eec0 reads word[record+0] and tests > 0) — a flag, not a number
  const vis = new Set(records.map((r) => (r.a.placement.visible ? 1 : 0)));
  const noSet = records.filter((r) => r.a.placement.visible && !r.a.placement.set);
  check("visible is a boolean, and nobody is visible without a set",
    vis.size === 2 && noSet.length === 0, `${noSet.length} visible with no set`);

  // actordeg (0x40e850) is a 0..255 facing; actorspeed (0x40ead0) and actorzclip
  // (0x410c70) only ever hold values a script passed them
  const degs = records.map((r) => r.a.placement.deg);
  check("deg is a facing", Math.min(...degs) >= 0 && Math.max(...degs) <= 255,
    `[${Math.min(...degs)}..${Math.max(...degs)}]`);
  const speeds = [...new Set(records.map((r) => r.a.placement.speed))].sort((x, y) => x - y);
  check("speed is one of the scripted actorspeed values",
    speeds.every((s) => s >= 4 && s <= 45), `${speeds.join(",")}`);

  // actorxyz 1/2/3 (0x40f285/97/a9): the acid test. Where a record names a star
  // that really is a star of the set it also names, the position IS that star's —
  // which no other framing of this record produces.
  //
  // The star tables are cached per set: there are 3465 records over 30 sets, and
  // parsing a SET for each one is a minute of work for the same thirty answers.
  const setStars = new Map<string, Map<string, { x: number; y: number; z: number }> | null>();
  const starsOf = (name: string) => {
    if (!setStars.has(name)) {
      const bytes = name ? provider(`${name}.set`) : null;
      setStars.set(name, bytes
        ? new Map(readSetFile(bytes).actors.map((s) => [s.identifier.toLowerCase(),
            { x: s.positionX, y: s.positionZ, z: s.positionY }]))
        : null);
    }
    return setStars.get(name)!;
  };
  let tested = 0, matched = 0;
  const off: string[] = [];
  for (const { a } of records) {
    const star = starsOf(a.placement.set)?.get(a.placement.star);
    if (!star) continue;
    tested++;
    const p = a.placement;
    if (p.x === star.x && p.y === star.y && p.z === star.z) matched++;
    else if (off.length < 4) off.push(`${a.name} on ${p.star}`);
  }
  check(`positions were checkable (${tested})`, tested > 2000, `${tested}`);
  // 2105/2122 measured. The rest are Max mid-patrol on the boat deck and one
  // record parked on the `walktostar` sentinel — an actor genuinely off his star.
  check("a record's xyz is its star's position, in the SET's own X,Z,Y order",
    matched / tested > 0.98, `${matched}/${tested} exact; misses e.g. ${off.join(", ")}`);
});

/**
 * `actorvalue` belongs to the record it sits in, 8 bytes before the name.
 *
 * The old offset produced a plausible-looking series and attributed it to the
 * wrong character: 0→1→3→5→8→13→21 over disk 1 is Penny, who you report to after
 * every errand, and it was being restored onto Morrow. Both series are asserted
 * here, so getting the attribution backwards again fails rather than looking fine.
 */
test("actorvalue is attributed to the character whose record holds it", () => {
  const series = (who: string): number[] =>
    allSaves()
      .filter((p) => /\/1\//.test(p) || /\\1\\/.test(p))
      .sort()
      .map((p) => parseSave(new Uint8Array(readFileSync(p))).actors.find((a) => a.name === who)?.value ?? -1)
      .filter((v) => v >= 0);
  const penny = series("penny");
  const morrow = series("morrow");
  check("Penny is the one talked to twenty-odd times",
    Math.max(...penny) >= 20, `penny max ${Math.max(...penny)}`);
  check("and Morrow is not", Math.max(...morrow) <= 5, `morrow max ${Math.max(...morrow)}`);
  // neither may ever go backwards: the count only rises within one game
  for (const [who, s] of [["penny", penny], ["morrow", morrow]] as const) {
    const drops = s.filter((v, i) => i > 0 && v < s[i - 1]).length;
    check(`${who}'s count never decreases along the disk`, drops === 0, `${drops} drops in ${s.join(",")}`);
  }
});

// ---- the cast comes back where you left them (#86) -------------------------

/**
 * A save taken on the engine-room catwalk reloads with Vlad still on it — and the
 * fistfight still happens.
 *
 * Reported by a player who saved at `engine — Scene109 / View116`, walked on and
 * "found nothing because I'm in the wrong phase". The engine room hands Vlad round
 * three scenes and only one of them places him:
 *
 *   Scene108 openscene   at M3P1, `sendtoactor("vlad", setupactor("fight"))`
 *   Scene108 keydown     walking on from view112 does `putdownactor()` — the game
 *                        hides the distant sprite ON PURPOSE as you approach
 *   Scene110 openscene   at M3P1, `sendtoactor("vlad", mousedown(0))` — the fight
 *
 * So the thing a load has to keep is not really his visibility, it is his POSITION:
 * gang.cst's mousedown opens with `if realdist(me) < hotdist()`, and a load used to
 * leave him at (0,0,0) with no set at all, from which Scene110's gesture reaches
 * nobody and the phase never advances. Measured both ways at the moment of arriving
 * at Scene110 — with the placement restored his `vlad1.pup` opens; without it he is
 * at (0,0,0) and no puppet opens at all.
 */
test("a save on the catwalk reloads with Vlad where he was standing", async () => {
  const { host, session } = await newHost();
  let clock = 0;
  const settle = async (n = 40): Promise<void> => {
    for (let i = 0; i < n; i++) { host.viewer?.tick((clock += 50)); await drain(); }
  };
  // a shipped save purely to give the writer a base to patch, as in a browser
  await session.loadGame(new Uint8Array(readFileSync(savePath("1", "03 - Found the Gymnasium.ti"))));
  await settle();
  session.interp.globals.set("tour", 0);
  session.interp.globals.set("mission", 3);
  session.interp.globals.set("phase", 1);

  // stand him up the one way the game does, then walk on — which is what hides him
  await session.runGlobal("changeset", ["engine", "Scene108", "View112"]);
  await settle();
  const vlad = session.actorRuntime.get("vlad");
  check("the catwalk's openscene stands him up", !!vlad?.visible && vlad.starName === "vlad1",
    `visible=${vlad?.visible} star=${vlad?.starName}`);
  void session.track(host.viewer!.pressNav("uparrow"));
  await settle(60);
  const at = {
    set: vlad!.setName, star: vlad!.starName,
    x: vlad!.worldX, y: vlad!.worldY, z: vlad!.worldZ, visible: vlad!.visible,
  };
  check("and walking on puts him down while keeping where he stood",
    !at.visible && at.set === "engine" && at.x !== 0,
    JSON.stringify(at));

  const bytes = session.snapshotSave();
  expect(bytes, "a save was written").not.toBeNull();

  const two = await newHost();
  let c2 = 0;
  const settle2 = async (n = 40): Promise<void> => {
    for (let i = 0; i < n; i++) { two.host.viewer?.tick((c2 += 50)); await drain(); }
  };
  expect(await two.session.loadGame(bytes!)).toBe(true);
  await settle2();
  const re = two.session.actorRuntime.get("vlad")!;
  check("the load puts him back where the save had him",
    re.setName === at.set && re.starName === at.star &&
      re.worldX === at.x && re.worldY === at.y && re.worldZ === at.z,
    `${re.setName}/${re.starName} (${re.worldX},${re.worldY},${re.worldZ}) vs ${JSON.stringify(at)}`);
  check("and leaves him down, because that is how the save was taken",
    re.visible === false, `visible=${re.visible}`);

  // the consequence the report is actually about: walk on to where he is waiting
  await two.session.runGlobal("changeset", ["engine", "Scene110", "View119"]);
  await settle2(120);
  check("arriving at Scene110 still starts the fight",
    two.session.puppet?.visible === true && /vlad/.test(String(two.session.puppet?.name ?? "")),
    `puppet=${two.session.puppet?.name ?? "(none)"}`);
});

/**
 * …and restoring placement must not resurrect anyone.
 *
 * This is the half that needed `actorvisible`. `putdownactor` hides a character
 * WITHOUT touching `actorset`, so "place anyone whose recorded set is the set being
 * loaded" — the rule that suggests itself when you cannot read visibility — would
 * put back everybody who had ever walked through the room; Smethells would be
 * standing in C73 again after walking out of it. The flag is restored verbatim
 * instead, which the test above also checks from the hidden side.
 */
test("the visible flag is what a load restores, not a guess from the set", () => {
  const records = allSaves().flatMap((p) => parseSave(new Uint8Array(readFileSync(p))).actors);
  const placed = records.filter((a) => a.placement.set);
  const hidden = placed.filter((a) => !a.placement.visible);
  // 1698 hidden against 560 visible, measured: three quarters of the records with a
  // set in them are of somebody NOT on screen, which is the size of the mistake
  // "recorded set means present" would have been.
  check("most records with a set are of somebody who is not on screen",
    hidden.length > placed.length / 2,
    `${hidden.length} hidden of ${placed.length} placed`);
});

/**
 * The reported standpoint: a save at `engine — Scene109 / View116` with Vlad on his
 * feet reloads with him STILL ON HIS FEET AND DRAWN.
 *
 * The first pass at #86 restored the placement in the wrong place and left out the
 * one field that decides whether a sprite reaches the screen, so the reporter got
 * "the state of the game is correct, I just don't see Vlad standing there" — the
 * fight triggered, the man was invisible. Two distinct faults, one per load path:
 *
 *   loading INSIDE the engine room   the restore ran before `closeSet()`, and
 *                                    ENGINE.SET's closeset is
 *                                    `sendtoactor("vlad", putdownactor())` — so the
 *                                    departing room undid it, and Scene109 has no
 *                                    script of its own to put him back
 *   loading from anywhere else       `actorvisible` survived but `actorscale` did
 *                                    not, and `ActorRuntime.drawList` skips anything
 *                                    whose scale is 0
 *
 * So this checks the DRAW LIST, not the flag: every gating condition in drawList has
 * to pass, which is the only statement equivalent to "you can see him".
 */
test("a save at Scene109 reloads with Vlad standing there, and drawn", async () => {
  // the player's file, built the way their save is: standing at Scene109/View116
  // with Vlad placed on vlad1
  const basePath = savePath("1", "03 - Found the Gymnasium.ti");
  const baseBytes = new Uint8Array(readFileSync(basePath));
  const parsed = parseSave(baseBytes);
  const nums = new Map(parsed.numGlobals);
  nums.set("mission", 3);
  nums.set("phase", 1);
  nums.set("tour", 0);
  const file = applyPatch(readSaveFile(baseBytes), {
    numGlobals: nums,
    strGlobals: parsed.strGlobals,
    set: "engine", scene: "scene109", view: "view116",
    actors: [{
      name: "vlad", owner: "none", value: 0,
      placement: {
        visible: true, set: "engine", star: "vlad1", pose: "stand",
        x: 2359, y: 8106, z: 4143, deg: 2, speed: 30, turn: 10, scale: 5500, zclip: 32,
      },
    }],
  });
  expect(parseSave(file).actors.find((a) => a.name === "vlad")?.placement.visible,
    "the file records him standing").toBe(true);

  /** load `file` after first standing in `from`, and answer "is Vlad drawn?" */
  const loadFrom = async (from: "engine" | "gym"): Promise<{ visible: boolean; scale: number; drawn: boolean }> => {
    const { host, session } = await newHost();
    let clock = 0;
    const settle = async (n = 40): Promise<void> => {
      for (let i = 0; i < n; i++) { host.viewer?.tick((clock += 50)); await drain(); }
    };
    await session.loadGame(baseBytes);
    await settle();
    if (from === "engine") {
      // the case the reporter was in: loading while standing in the room whose
      // `closeset` puts Vlad down
      session.interp.globals.set("tour", 0);
      session.interp.globals.set("mission", 3);
      session.interp.globals.set("phase", 1);
      await session.runGlobal("changeset", ["engine", "Scene108", "View112"]);
      await settle();
    }
    expect(await session.loadGame(file)).toBe(true);
    await settle();
    const a = session.actorRuntime.get("vlad")!;
    const cam = host.viewer?.worldCamera() ?? null;
    const drawn = !!cam && session.actorRuntime.drawList(cam).some((e) => e.a.member.name === "vlad");
    return { visible: a.visible, scale: a.scale, drawn };
  };

  for (const from of ["engine", "gym"] as const) {
    const got = await loadFrom(from);
    check(`loading from the ${from}: he is visible`, got.visible, JSON.stringify(got));
    // 5000 is the engine room's own stdscale, which is where this now comes from
    check(`loading from the ${from}: he has a scale`, got.scale > 0, JSON.stringify(got));
    check(`loading from the ${from}: and he is in the draw list`, got.drawn, JSON.stringify(got));
  }
});

/**
 * The writer enumerates props the way the original does: all of them.
 *
 * TI.EXE's save writer (0x413910) walks its live prop list and copies one record
 * per node, no filtering — so all 109 shipped saves hold exactly 72 prop records,
 * the two boot shops' props in creation order, none missing and no extras. This
 * pins our side to the same rule, because the two times it has been a hand-kept
 * list the list was short (the bag/watch/map, then the baby — see
 * {@link inventorySnapshot} and the test below).
 */
test("a save offers every loaded prop, as the original enumerates them", async () => {
  const { host, session } = await newHost();
  let clock = 0;
  const settle = async (n = 40): Promise<void> => {
    for (let i = 0; i < n; i++) { host.viewer?.tick((clock += 50)); await drain(); }
  };
  const path = savePath("ENDGAME2", "08 - Boat Deck.ti");
  const baseBytes = new Uint8Array(readFileSync(path));
  await session.loadGame(baseBytes);
  await settle();

  const loaded = [...session.propRuntime.props.keys()];
  const filed = parseSave(baseBytes).inventory.map((p) => p.name);
  check("the engine holds the same props the original serialised", loaded.length === filed.length,
    `ours ${loaded.length} vs the file's ${filed.length}`);
  check("in the same order", loaded.join(",") === filed.join(","),
    `first divergence at ${loaded.findIndex((n, i) => n !== filed[i])}`);

  // and the round trip keeps every one of them, not a chosen few
  const bytes = session.snapshotSave();
  expect(bytes, "a save was written").not.toBeNull();
  const back = parseSave(bytes!);
  check("the written file still has a record per prop", back.inventory.length === filed.length,
    `${back.inventory.length} of ${filed.length}`);
  const wrong = back.inventory.filter((p) => {
    const live = session.propRuntime.get(p.name);
    return (String(live?.owner) || "none").toLowerCase() !== p.owner;
  });
  check("every owner in it is the live one", wrong.length === 0,
    wrong.map((p) => `${p.name}=${p.owner}`).join(" "));
});

/**
 * Beatrix trades the child for Conkling's letter after a save and a load (#107).
 *
 * `BX2.PUP` c6 opens on `if propowner("baby") = "bx"`, and `baby` lives in
 * house.shp rather than inven.shp — it is drawn centre-screen, not in a bag slot —
 * so the writer's old inven.shp-plus-three-band-items list never wrote it. A
 * reload therefore took the value from the PATCH BASE, and for `mission >= 4`
 * main.ts lends the disk-2 template, where the child belongs to nobody. Beatrix
 * then ran `findconk()` — "where's Andrew?" — with the letter in your hand.
 *
 * Two details worth keeping, because both are why this read as a `deckbd2` bug:
 *
 *  - she still LOOKS like she is holding it. `gang.cst` c3's `endwalk()` chooses
 *    the pose from `propowner("baby")` before the save, and the actor record
 *    carries the pose (#86) — so the screen said one thing and the prop table
 *    another.
 *  - nothing needs her VISIBILITY of the child restored. house.shp's
 *    `showinterface()` ends with `if propowner("baby") = "frank" →
 *    propvisible("baby", true)`, so possession is the whole mechanism: the owner
 *    is the one field that has to survive, and the rest follows from it.
 */
test("a mission-4 save reloads with the child still Beatrix's", async () => {
  const template = new Uint8Array(readFileSync(
    savePath("ENDGAME2", "01 - Found Notebook in False Smokestack.ti")));

  const one = await newHost();
  let c1 = 0;
  const settle1 = async (n = 40): Promise<void> => {
    for (let i = 0; i < n; i++) { one.host.viewer?.tick((c1 += 50)); await drain(); }
  };
  await one.session.loadGame(new Uint8Array(readFileSync(savePath("ENDGAME2", "08 - Boat Deck.ti"))));
  await settle1();
  // A CARRIED game is the case that broke: with no `lastSave` the writer patches
  // the lent template, whose own value for the child is "none". Reaching the state
  // by loading and then clearing lastSave is the same writer input as playing here.
  one.session.lastSave = null;
  one.session.saveTemplate = () => template;
  check("Beatrix has the child before the save",
    String(one.session.propRuntime.get("baby")?.owner) === "bx");

  const bytes = one.session.snapshotSave();
  expect(bytes, "a save was written").not.toBeNull();
  check("and the save records that, rather than the template's owner",
    parseSave(bytes!).inventory.find((p) => p.name === "baby")?.owner === "bx",
    `template says ${parseSave(template).inventory.find((p) => p.name === "baby")?.owner}`);

  const two = await newHost();
  let c2 = 0;
  const settle2 = async (n = 40): Promise<void> => {
    for (let i = 0; i < n; i++) { two.host.viewer?.tick((c2 += 50)); await drain(); }
  };
  expect(await two.session.loadGame(bytes!), "the save loads").toBe(true);
  await settle2();
  check("the load gives the child back to Beatrix",
    String(two.session.propRuntime.get("baby")?.owner) === "bx",
    `owner=${two.session.propRuntime.get("baby")?.owner}`);

  // the consequence, which is what was actually reported: hold the letter (what
  // SHAHACK2.PUP's getbaby() hands over) and talk to her
  await two.session.sendEvent("sendtoshop", "inven.shp", "addinven", ["conkletter"], "test");
  await settle2(10);
  two.logs.length = 0;
  void two.session.track(
    two.session.sendEvent("sendtoactor", "bx", "runpuppet", ["bx2.pup", ""], "test"));
  await settle2(80);
  // getbaby() opens with a stage direction and three plaques; findconk() — the
  // branch the report saw — has no plaques at all
  const said = two.logs.filter((l) => /^msg: ACT/.test(l));
  check("she opens the trade rather than asking where Andrew is",
    /gripping the baby/i.test(said.join(" ")), said.join(" | ") || "(she said nothing)");
  check("and offers the answers getbaby() parks on",
    (two.session.puppet?.bevels ?? []).length === 3,
    JSON.stringify((two.session.puppet?.bevels ?? []).map((b) => b.id)));
});

/**
 * #125: a load is a RESTORE, not an arrival, and must not fire the arriving
 * scene's entry event — which for one room is a trigger.
 *
 * Traced rather than guessed. `openscene` is dispatched from exactly one site
 * (`0x407ea0`, which builds `sendtoscene("SceneNN", openscene())`); that site has
 * exactly one caller (`0x4076d4`, inside `opensetfile`); and `opensetfile`'s
 * implementation (`0x407590`) has exactly one caller — its own command stub at
 * `0x43cad6`. So only a SCRIPT calling `opensetfile` can fire it, and the original's
 * load never does: `ctl.stg`'s button is `opengame ("Titanic 1.0")` followed by
 * nothing but a stage check, and `opengame`'s restore (`0x414080`) rebuilds the room
 * through the engine's own set machinery without reaching the script runners.
 *
 * Ours arrives by running the game's own `changeset`, which fires both events. The
 * scene half is what bites, because LOUNGE1C Scene45's is
 *
 *     if mission = 4 & actorvisible ("zeit") & currentview () = "view49"
 *         sendtoactor ("zeit", mousedown (0))
 *
 * and `openset` has just made Zeitel visible. So the shipped save taken in front of
 * him opened his conversation INSIDE the load — headless, that never returns,
 * because it parks on his plaques. The reporter's own account of the original is
 * that nothing happens until you move off the spot and back, which is this.
 */
test("loading in front of Zeitel does not start his conversation (#125)", async () => {
  const one = await newHost();
  const session = one.session;
  let c = 0;
  // Ticks rather than settle(): a conversation parked on plaques never settles, so
  // settling is what turned the bug into a hang instead of a report.
  const run = async (n = 60): Promise<void> => {
    for (let i = 0; i < n; i++) { one.host.viewer?.tick((c += 50)); await drain(); }
  };
  const path = savePath("ENDGAME1", "05 - Traded Painting for Antidote with Zeitel.ti");
  // The load has to RETURN. Before the fix it did not: the accost fired inside it.
  await session.loadGame(new Uint8Array(readFileSync(path)));
  await run();

  expect(session.currentSetName).toBe("lounge1c");
  const zeit = session.actorRuntime.get("zeit");
  check("Zeitel is in the room, placed by the arriving room's openset",
    !!zeit?.visible, `zeit=${zeit ? `visible=${zeit.visible}` : "(absent)"}`);
  check("...and is not talking to us", !session.puppet?.visible,
    `subtitle=${JSON.stringify(session.puppet?.subtitle ?? "")}`);
  check("...so nothing is waiting for an answer", (session.puppet?.bevels ?? []).length === 0);

  // and the trigger is not BROKEN, only unfired: the scene is still current, so
  // the next real arrival at it runs openscene the ordinary way
  void session.track(session.sendEvent("sendtoscene", "Scene45", "openscene", [], "test"));
  await run(120);
  check("a real arrival at the scene still fetches him",
    !!session.puppet?.visible, `subtitle=${JSON.stringify(session.puppet?.subtitle ?? "")}`);
});

// ---- the scheduler tables and the music (#143) -----------------------------

// The loops/crickets/walks tables are TI.EXE's own service tables dumped
// verbatim (32×42 / 16×74 / 16×110, always the last fixed-size triple), and the
// playing theme is the one track whose playing/looping arrays are non-empty.
// Ground truth is the boat-deck save taken mid-stroll: Lady Georgia walking
// (the walk has a payload container), the party crickets armed, deckbd.trk
// sounding.
test("parseSave decodes the loop/cricket tables, the active walk and the theme", () => {
  const save = parseSave(new Uint8Array(readFileSync(savePath("2", "05 - Talking with Max.ti"))));
  expect(save.loops.length).toBeGreaterThan(0);
  const max = save.loops.find((l) => l.name === "max");
  expect(max, "Max's idle is armed").toBeTruthy();
  expect(max!.kind).toBe("actor");
  expect(max!.handler).toBe("maxidle");
  const motor = save.crickets.find((c) => c.name === "motor");
  expect(motor, "the deck's motor ambience is armed").toBeTruthy();
  expect(motor!.set).toBe("deckbd");
  expect(motor!.radius).toBe(3000);
  expect(save.walks.length).toBe(1);
  expect(save.walks[0]).toMatchObject({ actor: "ga", type: 3, hasPayload: true, star: "ga.2" });
  expect(save.theme).toMatchObject({ track: "deckbd.trk" });
});

test("applyPatch writes the scheduler tables and theme, and they parse back", () => {
  const bytes = new Uint8Array(readFileSync(savePath("2", "05 - Talking with Max.ti")));
  const save = parseSave(bytes);
  const out = applyPatch(save.raw, {
    numGlobals: save.numGlobals,
    set: save.set, scene: save.scene, view: save.view,
    scheduler: {
      loops: [{ kind: "actor", name: "max", handler: "maxidle", period: 7 }],
      crickets: [{ name: "motor", set: "deckbd", x: 100, y: 200, radius: 3000, base: 5, jitter: -1, next: 5 }],
    },
    theme: {
      track: "deckbd.trk",
      chunks: [{ index: 2, name: "01 main" }, { index: 3, name: "02 main" }],
      order: [1, 2],
    },
  });
  const re = parseSave(out);
  expect(re.loops).toEqual([{ kind: "actor", name: "max", handler: "maxidle", period: 7 }]);
  expect(re.crickets).toEqual([
    { name: "motor", set: "deckbd", x: 100, y: 200, radius: 3000, base: 5, jitter: -1, next: 5 },
  ]);
  // the walks table is zeroed — the base's mid-walk slot (and its payload) must
  // not survive into a new save's moment
  expect(re.walks).toEqual([]);
  expect(re.theme).toMatchObject({ track: "deckbd.trk", extras: 0 });
});

// The playing/looping lists are TI.EXE's contract, not a notepad: its post-load
// resume pairs playing record n with the BANK's loop-table record n and rebuilds
// the looping list from the bank's play order over the playing array, bounded by
// the bank's tables — so the lists must be one record per chunk or the original
// engine reads and writes past both heap blocks ("Memory error at line 301
// (code 2): Unknown compression format" in DosBox, the codec lookup at 0x401539
// choking on a clobbered header). The shipped cargo-hold save is the ground
// truth: rewrite its own theme from the bank and every decoded field of every
// record must come back exactly as TI.EXE's writer left it (measured across all
// 109 shipped saves: idx = the chunk's container location, +2 = 0, pan = 128,
// name = the chunk identifier, playing = table order, looping = play order).
test("the theme is written as TI.EXE writes it: one record per loop chunk", () => {
  const bytes = new Uint8Array(readFileSync(savePath("2", "20- Cargo Hold - looking for painting.ti")));
  const save = parseSave(bytes);
  const bank = readBankTables(readContainerFile(provider("cargo.trk")!));
  const out = applyPatch(save.raw, {
    numGlobals: save.numGlobals,
    set: save.set, scene: save.scene, view: save.view,
    theme: {
      track: "cargo.trk",
      chunks: bank.loopRecords.map((r) => ({ index: r.containerLoc, name: r.identifier })),
      order: bank.loopOrder,
    },
  });
  const re = readSaveFile(out);
  const orig = readSaveFile(bytes);
  // container 6 is the open-tracks list in this save; cargo.trk is track 2 and
  // its playing/looping arrays are containers 14/15 (6 + 1 + 3·2 + {1,2})
  const field = (d: Uint8Array, r: number, off: number) =>
    new DataView(d.buffer, d.byteOffset + r * 104 + off, 2).getUint16(0, true);
  const name = (d: Uint8Array, r: number) =>
    Buffer.from(d.subarray(r * 104 + 9, r * 104 + 9 + d[r * 104 + 8])).toString("latin1");
  for (const ci of [14, 15]) {
    const a = re.containers[ci].data;
    const b = orig.containers[ci].data;
    expect(a.length, `container ${ci} record count`).toBe(b.length);
    for (let r = 0; r * 104 < a.length; r++) {
      for (const off of [0, 2, 4, 6]) {
        expect(field(a, r, off), `c${ci} rec${r} field +${off}`).toBe(field(b, r, off));
      }
      expect(name(a, r), `c${ci} rec${r} name`).toBe(name(b, r));
    }
  }
  // and the descriptor counts match the shipped save's (0 registered, 11, 11)
  const dA = re.containers[6].data, dB = orig.containers[6].data;
  for (const off of [4, 6, 8]) {
    expect(field(dA, 0, 2 * 40 + off)).toBe(field(dB, 0, 2 * 40 + off));
  }
});

// A save taken in a DIFFERENT room than its base must rewrite the set file's
// identity, because TI.EXE's loader ignores the set NAME: it resolves the set
// id at C1 @544 through the container-0 manifest to a PATH (0x41514a), opens
// that file, and looks the saved scene up in the register containers named at
// C1 @644/@652 (0x43a0b0) — a scene the register lacks is "Fatal error at line
// 4248 (code 2)" in DosBox. The model is measured: in all 109 shipped saves the
// id matches exactly one manifest record, its path names a set file holding the
// saved scene, and @644/@652 are that file's own register refs. Here: the
// crew-hallway save re-targeted to the cargo hold, then walked back exactly the
// way the original loader walks it.
test("a cross-room save re-paths the manifest's set record and register refs", () => {
  const bytes = new Uint8Array(readFileSync(savePath("2", "20- Cargo Hold - looking for painting.ti")));
  const save = parseSave(bytes);
  expect(save.set).toBe("crew"); // the base really is another room
  const cargoSet = readSetFile(provider("cargo.set")!);
  const out = applyPatch(save.raw, {
    numGlobals: save.numGlobals,
    set: "cargo", scene: "scene4", view: "view33",
    setFile: {
      file: "cargo.set",
      actorRegister: cargoSet.actorRegister,
      sceneRegister: cargoSet.mainSceneRegister,
      sceneCount: cargoSet.scenes.length,
      clut: cargoSet.paletteRaw,
    },
  });
  const re = readSaveFile(out);
  const c0 = re.containers[0].data, c1 = re.containers[1].data;
  const v0 = new DataView(c0.buffer, c0.byteOffset, c0.byteLength);
  const v1 = new DataView(c1.buffer, c1.byteOffset, c1.byteLength);
  // resolve the set id the way 0x4153f0 does: manifest record with that id
  const setId = v1.getUint32(544, true);
  const count = v0.getUint32(0x130c, true);
  let path = "";
  for (let r = 0; r < count; r++) {
    const off = 0x1310 + r * 0x104;
    if (v0.getUint32(off, true) !== setId) continue;
    path = Buffer.from(c0.subarray(off + 5, off + 5 + c0[off + 4])).toString("latin1");
    break;
  }
  expect(path.split(":").pop()).toBe("cargo.set");
  // the register refs and the register's record count are the cargo set's own —
  // the count at @656 bounds the loader's scene lookup and is restored verbatim,
  // so the base's smaller count (crew: 2 scenes) would hide cargo's Scene4-6
  expect(v1.getUint32(644, true)).toBe(cargoSet.actorRegister);
  expect(v1.getUint32(652, true)).toBe(cargoSet.mainSceneRegister);
  expect(v1.getUint32(656, true)).toBe(cargoSet.scenes.length);
  const scene = cargoSet.scenes.find((sc) => sc.sceneName.toLowerCase() === "scene4");
  expect(scene, "the saved scene is in the re-opened set's register").toBeTruthy();
  // the CLUT's set-owned half is the new room's palette (the loader restores
  // the screen palette from c0+0xb0c — without this the cargo hold came back
  // in the crew hallway's colours), and the stage's upper half is the base's
  expect(c0.subarray(0xb0c, 0xb0c + 1024)).toEqual(cargoSet.paletteRaw.subarray(0, 1024));
  // and no other manifest record was touched
  const b0 = readSaveFile(bytes).containers[0].data;
  for (let r = 0; r < count; r++) {
    const off = 0x1310 + r * 0x104;
    if (v0.getUint32(off, true) === setId) continue;
    expect(c0.subarray(off, off + 0x104), `record ${r} untouched`).toEqual(b0.subarray(off, off + 0x104));
  }
});

// Type tag 2 is BOOLEAN, not a second number spelling — TI.EXE's boolean-taking
// commands check for exactly 2 (propvisible's argument fetch, cmp word [esp],2)
// and flipping a boolean global's tag to 4 is the endless DosBox dialog
// "[Bad argument type.]", found by bisecting a port save down to exactly ten
// 02->04 tag bytes. The port's interpreter carries booleans as 0/1 numbers, so
// the writer must keep a tag-2 record's tag while the value stays 0/1 — and let
// a real number retype it, the way an assignment in the original would.
test("a boolean global keeps its tag; a real number retypes it", () => {
  const bytes = new Uint8Array(readFileSync(savePath("2", "20- Cargo Hold - looking for painting.ti")));
  const save = parseSave(bytes);
  expect(save.vars.find((v) => v.name === "tour")!.type, "the base holds tour as a boolean").toBe(2);
  const tagOf = (out: Uint8Array, name: string) => parseSave(out).vars.find((v) => v.name === name)!.type;
  const patch = (num: Map<string, number>) => applyPatch(parseSave(bytes).raw, {
    numGlobals: num, set: save.set, scene: save.scene, view: save.view,
  });
  expect(tagOf(patch(new Map([["tour", 0]])), "tour"), "0 keeps the boolean tag").toBe(2);
  expect(tagOf(patch(new Map([["tour", 1]])), "tour"), "1 keeps the boolean tag").toBe(2);
  expect(tagOf(patch(new Map([["tour", 5]])), "tour"), "a real number retypes").toBe(4);
  expect(tagOf(patch(new Map([["mission", 2]])), "mission"), "numbers stay numbers").toBe(4);
});

// A theme track the base never opened cannot be written (the container-0
// manifest names the open files and the patcher does not rewrite it): the save
// is written, the drop is REPORTED, and the room loads silent rather than with
// somebody else's music.
test("a theme the base save has no track for is dropped, and said", () => {
  const bytes = new Uint8Array(readFileSync(savePath("2", "05 - Talking with Max.ti")));
  const save = parseSave(bytes);
  const dropped: string[] = [];
  const out = applyPatch(save.raw, {
    numGlobals: save.numGlobals,
    set: save.set, scene: save.scene, view: save.view,
    scheduler: { loops: [], crickets: [] },
    theme: { track: "sink4.trk", chunks: [{ index: 2, name: "01 main" }], order: [1] },
    onDrop: (name) => dropped.push(name),
  });
  expect(dropped).toContain("theme(sink4.trk)");
  expect(parseSave(out).theme).toBeNull();
});

// The full circle: load a shipped save, snapshot it, and the scheduler + music
// state survive — which is what makes our own checkpoints restore their rooms
// without re-running openset.
test("snapshotSave carries the restored loops, crickets and theme", async () => {
  const session = await newSession();
  await session.loadGame(new Uint8Array(readFileSync(savePath("2", "05 - Talking with Max.ti"))));
  await session.settle();
  const re = parseSave(session.snapshotSave()!);
  expect(re.theme).toMatchObject({ track: "deckbd.trk" });
  const names = re.loops.map((l) => `${l.kind}/${l.name}:${l.handler}`);
  expect(names).toContain("actor/max:maxidle");
  expect(re.crickets.map((c) => c.name)).toContain("motor");
  // the crowd extras now ride the actor container (appended when the base
  // lacks a record), so a loaded crowd survives its own save
  const extras = re.actors.filter((a) => !session.actorRuntime.casts.get("gang.cst")?.cst.members.some((m) => m.name.toLowerCase() === a.name));
  expect(extras.length).toBeGreaterThan(0);
});

/**
 * The crowd, over the whole corpus — issue #186.
 *
 * A room's extras are not in the boot cast: `lounge1c`, `smoke` and `deckbd2`
 * each `opencastfile("extra.cst")` from their `openset`, and a load runs no
 * openset (#143). The save records what was open (`SaveGame.castFiles`), and a
 * load that ignored it dropped every crowd record it could not find a source
 * for — 714 log lines and 344 characters that should have been standing there,
 * across the 109 shipped saves.
 *
 * The assertion is the one that would have caught it: `restoreActors` LOGS a
 * drop rather than failing, so a suite that only checks the load returns true
 * sees nothing wrong.
 */
test("every shipped save's placed, visible characters are actually there (#186)", async () => {
  const saves = allSaves();
  expect(saves.length).toBeGreaterThan(0);
  let checked = 0;
  // ONE session for all 109, loaded one after another. Cheaper than a boot per
  // save, and a stronger claim than a fresh one would make: a load has to leave
  // the previous game's cast behind it, which is the half of #186 that a single
  // load cannot show.
  const { session, logs } = await newHost();
  await drain();
  for (const path of saves) {
    const bytes = new Uint8Array(readFileSync(path));
    const save = parseSave(bytes);
    logs.length = 0;
    expect.soft(await session.loadGame(bytes), path).toBe(true);
    // a record with no set was never placed, and an invisible one is putdown —
    // neither is a character the room owes you
    for (const a of save.actors) {
      if (!a.placement.set || !a.placement.visible) continue;
      checked++;
      check(`${path}: ${a.name}`, session.actorRuntime.get(a.name) !== undefined, "not restored");
    }
    check(path, !logs.some((l) => /no cast member to re-instance/.test(l)), "dropped a crowd record");
  }
  // the corpus really does place a crowd — an assertion over nothing would pass
  expect(checked).toBeGreaterThan(300);
}, 300_000);

/**
 * The room's ambience, over the whole corpus — issue #199.
 *
 * A save records every audio bank it had open, and only one of them is playing.
 * The loader used to open that one — the theme — and the restored
 * `makecricket`/`makeloop` tables then reached into banks that were not there:
 * over the 18 shipped saves with a live cricket table, **49 of 50** cricket
 * records could not resolve their sound from the theme's bank alone, and every
 * one of them resolves from the banks the save names (measured both ways below,
 * which is what keeps the second number from being a tautology).
 *
 * The sinking is where a player meets it (`insddest.sfx` is open, and silent, in
 * every mission-4 save — a `.sfx` bank is NEVER the theme in any of the 109),
 * and it does not heal: BOOTFILE's `setupsound` only re-opens the bank when
 * `crickettype` changes, and lnghall, lounge1c and smoke are all "insd".
 */
test("a load reopens every bank the save had open, not just the theme's (#199)", async () => {
  // one session, loads back to back — the same claim shape as #186 above
  const { session } = await newHost();
  await drain();
  let checked = 0;
  let themeOnly = 0;
  for (const path of allSaves()) {
    const bytes = new Uint8Array(readFileSync(path));
    const save = parseSave(bytes);
    if (!save.crickets.length) continue;
    // a `.sfx` bank is open and NOT playing — the shape the old loader missed
    expect.soft(save.trackFiles, path).toContain(save.theme?.track ?? "");
    for (const t of save.trackFiles) if (t.endsWith(".sfx")) expect.soft(t, path).not.toBe(save.theme?.track);
    expect.soft(await session.loadGame(bytes), path).toBe(true);
    for (const c of session.scheduler.crickets) {
      checked++;
      if (!session.audioLib.sound(c.name)) themeOnly++;
      check(`${path}: cricket "${c.name}"`, !!session.audioLib.sound(c.name), "no bank holds it");
    }
  }
  expect(checked).toBeGreaterThan(40); // the corpus really does restore ambience
  expect(themeOnly).toBe(0);
});

/**
 * The sinking, from the report: load into lounge1c and the groaning metal is
 * still there.
 *
 * `playcrickets` (BOOTFILE 0002) is a `makeloop` that picks a random one-shot
 * out of `insddest.sfx` every few seconds — a live loop over a bank with nothing
 * playing. With the bank missing, `countsounds` answers 0, `indextosound`
 * answers "", and the log fills with `sound not found: ` — the EMPTY name is the
 * signature, and it is what the report showed.
 */
test("the sinking's ambience survives a load into lounge1c (#199)", async () => {
  const sink = new OrderedAudioSink();
  const { session, logs } = await newHost({ sink });
  await drain();
  const bytes = new Uint8Array(readFileSync(savePath("ENDGAME2", "06 - 1st Class Lounge.ti")));
  const save = parseSave(bytes);
  expect(save.set).toBe("lounge1c");
  expect(save.trackFiles).toContain("insddest.sfx");
  expect(save.theme?.track).toBe("sink0.trk"); // the theme is the OTHER bank
  expect(save.loops.some((l) => l.handler === "playcrickets")).toBe(true);

  expect(await session.loadGame(bytes)).toBe(true);
  expect(session.audioLib.bankNames).toContain("insddest.sfx");
  expect(session.audioLib.soundNames("insddest.sfx").length).toBeGreaterThan(0);

  // and the restored loop plays out of it: run the clock past its saved count
  // (`300 / (phase + 1) + random (120)` ticks at most) and listen
  logs.length = 0;
  const before = sink.events.length;
  let clock = 0;
  for (let i = 0; i < 600; i++) {
    session.tickTime((clock += 50));
    await drain();
  }
  expect(logs.filter((l) => /sound not found/.test(l))).toEqual([]);
  expect(sink.events.slice(before).some((e) => e.kind === "play" && e.channel === "sound")).toBe(true);
});

/**
 * A walk in flight comes back mid-stride.
 *
 * User-reported against the #181 branch, in the room #181 came from: "we are
 * placed in the Grand Staircase with Daisy walking on the same spot", and then,
 * against the build that stood her still: "in the original, she walks back to
 * the centre of the room".
 *
 * Save 17 catches `cash` mid-`walktostar` — a type-1 straight line, no payload —
 * and the record carries everything the mover needs: start (6561, 5095, 4985),
 * deltas the mover SUBTRACTS, distance 2203, progress 270, and `cash1` as the
 * arrival star. Reconstructing the saved position from those lands on the actor
 * record's own to within the integer division, which is what says the offsets
 * are read right.
 *
 * The three shapes are not one thing: type 0 is a `turntodeg` whose movement
 * words were never written, type 1 is the straight line, and type 3 is an
 * authored route that keeps its waypoints AND its length in a payload container
 * of its own. A walker that cannot be put back is stood up instead (an actor
 * steps through its play script whether a walk is running or not, #181, so a
 * drop that left the walk pose alone left them treadmilling).
 */
test("a walk saved in flight resumes and finishes, and its walker arrives", async () => {
  const { session, logs } = await newHost();
  await drain();
  const path = savePath("1", "17 - Looking up GQC for Daisy.ti");
  const bytes = new Uint8Array(readFileSync(path));
  const save = parseSave(bytes);

  // the premise, and the offsets: the record's own arithmetic has to reproduce
  // the position the actor record was saved at
  const w = save.walks[0];
  expect(save.walks.length).toBe(1);
  expect(w).toMatchObject({ actor: "cash", type: 1, hasPayload: false, star: "cash1", turnTo: -1 });
  expect([w.startX, w.startY, w.startZ]).toEqual([6561, 5095, 4985]);
  expect([w.destX, w.destY, w.destZ]).toEqual([5795, 7161, 4985]);
  expect(w.dist).toBe(2203);
  const record = save.actors.find((a) => a.name === "cash")!.placement;
  expect(record.pose).toBe("walk");
  const at = (s: number, d: number) => s + Math.trunc(((d - s) * w.progress) / w.dist);
  expect(Math.abs(at(w.startX, w.destX) - record.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(at(w.startY, w.destY) - record.y)).toBeLessThanOrEqual(1);

  expect(await session.loadGame(bytes)).toBe(true);
  const cash = session.actorRuntime.get("cash")!;
  // she is walking, from where she was saved and not from the start of the walk
  expect(session.scheduler.isWalk("cash")).toBe(true);
  expect(cash.poseName).toBe("walk");
  expect([cash.worldX, cash.worldY]).toEqual([record.x, record.y]);
  expect(logs.some((l) => /cash was saved walking to "cash1" — resuming it/.test(l))).toBe(true);

  // ...and she gets there: 2203 units left at actorspeed 30 is under 4 s, so 8
  // is room to spare without being a timeout dressed up as an assertion
  let clock = 0;
  for (let i = 0; i < 160; i++) session.tickTime((clock += 50));
  expect(session.scheduler.isWalk("cash")).toBe(false);
  expect([cash.worldX, cash.worldY, cash.worldZ]).toEqual([w.destX, w.destY, w.destZ]);
  expect(cash.starName).toBe("cash1"); // the arrival star, which endwalk keys off
  expect(cash.poseName).toBe("stand");
});

/**
 * The corpus's own census of the walks table, which is what says the three
 * shapes above are the only ones and how much of the table a load now covers.
 */
test("every live walk slot in the corpus is a turn, a line, or a route", () => {
  const byType = new Map<number, number>();
  let saves = 0;
  for (const path of allSaves()) {
    const walks = parseSave(new Uint8Array(readFileSync(path))).walks;
    if (!walks.length) continue;
    saves++;
    for (const w of walks) {
      byType.set(w.type, (byType.get(w.type) ?? 0) + 1);
      // an authored route is the one shape that carries a payload, and the only
      // one a load still drops
      expect.soft(w.hasPayload, `${path}: ${w.actor}`).toBe(w.type === 3);
      expect.soft(w.star, `${path}: ${w.actor}`).not.toBe("");
      // a turn's movement words are garbage in the file; the decoder must not
      // pass them on
      // only the straight-line mover writes a real distance IN THE RECORD; a
      // turn has none and a route's is in its payload, so the decoder must not
      // pass the slot's stale value on
      if (w.type === 0) expect.soft(w.dist, `${path}: ${w.actor}`).toBe(0);
      else expect.soft(w.dist, `${path}: ${w.actor}`).toBeGreaterThan(0);
      // a route's waypoints decode, and its progress is somewhere along them
      expect.soft(!!w.path, `${path}: ${w.actor} path`).toBe(w.type === 3);
      if (w.path) {
        expect.soft(w.path.length, `${path}: ${w.actor}`).toBeGreaterThan(1);
        expect.soft(w.path[w.path.length - 1].cum).toBe(w.dist);
        expect.soft(w.progress).toBeGreaterThan(0);
        expect.soft(w.progress).toBeLessThan(w.dist);
      }
    }
  }
  expect(saves).toBe(12);
  expect([...byType].sort()).toEqual([[0, 12], [1, 1], [3, 3]]);
});

/**
 * The three authored routes, put back on their own waypoints.
 *
 * A route is the shape that cannot be reconstructed from the record alone — its
 * length is not even in it — so this is the assertion that says the payload was
 * read and read right: rebuilding the position from the waypoints and the saved
 * progress has to land on the actor record's own, and the walker has to arrive
 * at the route's LAST point rather than cut the corner to it. `ga`'s ten-point
 * curve around the boat deck's structures is the one that would show a straight
 * line most plainly (#122).
 */
test("an authored route resumes on its waypoints, not on the straight line", async () => {
  const { session } = await newHost();
  await drain();
  let clock = 0;
  const routes = [
    { file: ["2", "05 - Talking with Max.ti"], actor: "ga", points: 10, star: "ga.2" },
    { file: ["1", "20 - Meeting Conkling in his suite - B59.ti"], actor: "jay1", points: 2, star: "ex2" },
    { file: ["2", "33 - Got clue from Jack Hacker.ti"], actor: "hack", points: 9, star: "hack1" },
  ] as const;
  for (const r of routes) {
    const bytes = new Uint8Array(readFileSync(savePath(r.file[0], r.file[1])));
    const save = parseSave(bytes);
    const w = save.walks.find((x) => x.actor === r.actor)!;
    expect(w.type, r.actor).toBe(3);
    expect(w.path!.length, r.actor).toBe(r.points);
    expect(w.star, r.actor).toBe(r.star);

    // the payload's own arithmetic, against the actor record it was saved beside
    const at = w.path!.findIndex((p) => p.cum >= w.progress);
    const from = w.path![Math.max(0, at - 1)];
    const to = w.path![at];
    const leg = to.cum - from.cum;
    const u = leg > 0 ? (w.progress - from.cum) / leg : 1;
    const rec = save.actors.find((a) => a.name === r.actor)!.placement;
    expect(Math.abs(from.x + (to.x - from.x) * u - rec.x), `${r.actor} x`).toBeLessThanOrEqual(1);
    expect(Math.abs(from.y + (to.y - from.y) * u - rec.y), `${r.actor} y`).toBeLessThanOrEqual(1);

    expect(await session.loadGame(bytes)).toBe(true);
    const a = session.actorRuntime.get(r.actor)!;
    expect(session.scheduler.isWalk(r.actor), `${r.actor} resumed`).toBe(true);
    expect([a.worldX, a.worldY], `${r.actor} starts where saved`).toEqual([rec.x, rec.y]);

    // pumped until it lands, with a bound rather than a duration: `hack` has
    // 8089 units left at `actorspeed` 11, which is 735 passes — a route is as
    // long as the author drew it and no round number covers all three
    for (let i = 0; i < 2000 && session.scheduler.isWalk(r.actor); i++) session.tickTime((clock += 50));
    const end = w.path![w.path!.length - 1];
    expect([a.worldX, a.worldY, a.worldZ], `${r.actor} arrives`).toEqual([end.x, end.y, end.z]);
    expect(a.starName, `${r.actor} lands on its star`).toBe(r.star);
  }
});

/**
 * `actorturn` is in the record, and a load has to carry it.
 *
 * Nothing but a script ever sets it — it is an accessor, and every room passes
 * `stdturn` from its own `openset` — and a load runs no `openset` (#143). So a
 * restored character kept the runtime's `0` and turned at `stepDeg`'s floor of 1
 * instead of 10: a half-circle went from 13 service passes to 128. It is most
 * visible in `walktopuppet`, which waits on `iswalk` before anyone speaks, so the
 * approach became seconds of a character rotating on the spot.
 *
 * Found while writing the walks table (#191) and fixed with it, being the same
 * family as the crowd (#186) and the open banks (#199): state that `openset` used
 * to re-derive, in the file all along, in a field nobody had carried across.
 *
 * The census is what says +32 is this field and not something else: over the 3465
 * shipped records it takes exactly TWO values, and they separate on whether the
 * record was ever placed.
 */
test("a load restores actorturn, and a restored character turns at speed", async () => {
  // the corpus census — two values, splitting on placement
  const hist = new Map<string, number>();
  for (const path of allSaves()) {
    for (const a of parseSave(new Uint8Array(readFileSync(path))).actors) {
      hist.set(`${a.placement.turn}/${a.placement.set ? "placed" : "unplaced"}`,
        (hist.get(`${a.placement.turn}/${a.placement.set ? "placed" : "unplaced"}`) ?? 0) + 1);
    }
  }
  // 16 is the engine's default at creation, 10 is `stdturn` — and NOTHING else
  expect([...hist].sort()).toEqual([["10/placed", 2207], ["16/placed", 51], ["16/unplaced", 1207]]);

  const { session } = await newHost();
  await drain();
  expect(await session.loadGame(new Uint8Array(readFileSync(savePath("2", "05 - Talking with Max.ti"))))).toBe(true);
  const max = session.actorRuntime.get("max")!;
  expect(max.turn, "restored from the record, not left at 0").toBe(10);

  // and it is the rate the turn actually runs at: measured, the facing steps
  // exactly 10 a tick and a half-circle lands on the 14th (the documented 128/10
  // = 13 turning passes, after a first tick that arms rather than steps). At the
  // old floor of 1 it took 128 of them, so 20 is a bound that passes now and
  // could not have before — his idle silenced meanwhile, since `maxidle` re-aims
  // him at the camera on its own period.
  session.scheduler.pauseLoop("actor", "max", true);
  const target = (max.deg + 128) & 0xff;
  session.scheduler.startTurn("max", target);
  let clock = 0;
  let ticks = 0;
  for (; ticks < 20 && session.scheduler.turning("max"); ticks++) session.tickTime((clock += 50));
  expect(session.scheduler.turning("max"), "the half-circle lands").toBe(false);
  expect(ticks, "in 13 turning passes, not 128").toBe(14);
  expect(max.deg).toBe(target);

  // and our own writer carries it back out
  expect(parseSave(session.snapshotSave()!).actors.find((a) => a.name === "max")!.placement.turn).toBe(10);
});

// ---- the writer's half of the walks table (#191) ---------------------------

/**
 * The round trip was ASYMMETRIC, and this is the census that says it no longer
 * is.
 *
 * #189 taught the loader to resume a walk; the writer still zeroed the table, so
 * a walk taken in one of OUR saves was lost — load save 17 and Daisy finishes
 * crossing the Grand Staircase, save that same moment through our own writer and
 * reload, and she is standing still. It shows the moment a player saves
 * mid-conversation-approach, because `walktopuppet` is a walk and it is how most
 * characters reach you.
 *
 * Every live slot in the corpus is written back and read again: 16 of them
 * across 12 saves, all three shapes (12 turns, one line, three routes), which is
 * the same census the decoder's own test above pins. Re-writing the file's own
 * walks is the strongest claim available without running TI.EXE — the expected
 * bytes are the ones the original wrote.
 */
test("applyPatch writes every walk shape back, and the whole corpus round-trips", () => {
  let saves = 0;
  const byType = new Map<number, number>();
  for (const path of allSaves()) {
    const save = parseSave(new Uint8Array(readFileSync(path)));
    if (!save.walks.length) continue;
    saves++;
    for (const w of save.walks) byType.set(w.type, (byType.get(w.type) ?? 0) + 1);
    const out = applyPatch(save.raw, {
      numGlobals: save.numGlobals,
      set: save.set, scene: save.scene, view: save.view,
      scheduler: { loops: save.loops, crickets: save.crickets, walks: save.walks },
    });
    expect.soft(parseSave(out).walks, path).toEqual(save.walks);
  }
  expect(saves).toBe(12);
  expect([...byType].sort()).toEqual([[0, 12], [1, 1], [3, 3]]);
});

/**
 * The structural half: a route's waypoints are a CONTAINER, and appending one is
 * the thing `applyPatch` had never had to do for the scheduler tables.
 *
 * Everything else a patch writes fits a slot the base already has. A live walk
 * does not — so the payloads are appended past the walks table, one per type-3
 * slot IN SLOT ORDER, which is the only thing that matches a payload to its
 * slot (the loader at 0x4149bd reads them in sequence and stores each new handle
 * back over `+0x12`). Measured over the corpus, the walks table is the last
 * container in all 109 shipped saves bar the 3 carrying a payload, so this only
 * ever appends past the end.
 *
 * The base here is 2/05, which HAS a payload — `ga`'s ten-point curve — and it
 * must not survive into a new save's moment. That is what the zeroing was
 * protecting against and what the writer now has to handle itself.
 */
test("applyPatch appends one waypoint container per route, in slot order (#191)", () => {
  const save = parseSave(new Uint8Array(readFileSync(savePath("2", "05 - Talking with Max.ti"))));
  const base = save.raw.containers.length;
  const route = (actor: string, star: string, pts: { x: number; y: number; z: number; cum: number }[]) => ({
    actor, star, type: 3, hasPayload: true, paused: false, turnTo: -1, deg: 0,
    startX: pts[0].x, startY: pts[0].y, startZ: pts[0].z,
    destX: pts[0].x, destY: pts[0].y, destZ: pts[0].z,
    progress: 10, dist: pts[pts.length - 1].cum, path: pts,
  });
  const two = [
    route("max", "max1", [{ x: 10, y: 20, z: 30, cum: 0 }, { x: 110, y: 20, z: 30, cum: 100 }]),
    route("ga", "ga.2", [{ x: 1, y: 2, z: 3, cum: 0 }, { x: 4, y: 5, z: 6, cum: 7 }, { x: 8, y: 9, z: 10, cum: 20 }]),
  ];
  const raw = readSaveFile(applyPatch(save.raw, {
    numGlobals: save.numGlobals, set: save.set, scene: save.scene, view: save.view,
    scheduler: { loops: save.loops, crickets: save.crickets, walks: two },
  }));
  // the base's own payload is GONE — one appended per route, not three
  expect(raw.containers.length).toBe(base + 1);
  // exact sizes: 20 bytes of header, then 8 per waypoint
  expect(raw.containers.slice(-2).map((c) => c.data.length)).toEqual([20 + 2 * 8, 20 + 3 * 8]);
  // the header past the count is the authored path structure's: +4 zero, and
  // +12 the bounding box — (Zmin, Xmin, Zmax, Xmax) in the set file's naming,
  // (min y, min x, max y, max x) in the decoder's — computed over the points.
  // TI.EXE copies an authored box verbatim and never updates it, which is how
  // the field went unidentified: the shipped payloads' boxes fit their authored
  // polylines, not their snapped runtime ones (see encodeWalkPath).
  const box = (c: { data: Uint8Array }) => {
    const dv = new DataView(c.data.buffer, c.data.byteOffset);
    return [dv.getUint32(4, true), dv.getInt16(12, true), dv.getInt16(14, true), dv.getInt16(16, true), dv.getInt16(18, true)];
  };
  expect(box(raw.containers[base - 1])).toEqual([0, 20, 10, 20, 110]);
  expect(box(raw.containers[base])).toEqual([0, 2, 1, 9, 8]);
  // ids stay the index, which is what every one of the 109 shipped saves holds
  raw.containers.forEach((c, i) => expect.soft(c.id, `container ${i}`).toBe(i));
  // and they come back paired with the slots that own them, in order
  const re = parseSave(writeSaveFile(raw));
  expect(re.walks.map((w) => w.actor)).toEqual(["max", "ga"]);
  expect(re.walks.map((w) => w.path?.length)).toEqual([2, 3]);
  expect(re.walks[1].path).toEqual(two[1].path);

  // a patch with NO walks still zeroes, and drops the base's stale payload the
  // same way a patch WITH walks does — one behaviour, so `walks: []` and an
  // omitted `walks` cannot produce different bytes for the same meaning
  const quietRaw = readSaveFile(applyPatch(save.raw, {
    numGlobals: save.numGlobals, set: save.set, scene: save.scene, view: save.view,
    scheduler: { loops: save.loops, crickets: save.crickets },
  }));
  expect(parseSave(writeSaveFile(quietRaw)).walks).toEqual([]);
  expect(quietRaw.containers.length).toBe(base - 1); // ga's stale payload is gone

  // a lost walk is SAID, whatever loses it: the 17th of a 16-slot table, and a
  // route claiming the path mover with no waypoints behind it (a shape no
  // shipped save has — the census pins hasPayload ⇔ type 3) — both drop through
  // onDrop the way every other unwritable item does (#191 review)
  const dropped: string[] = [];
  const turn = (i: number) => ({
    actor: `t${i}`, star: "spot", type: 0, hasPayload: false, paused: false,
    turnTo: 1, deg: 0, startX: 0, startY: 0, startZ: 0, destX: 0, destY: 0, destZ: 0,
    progress: 0, dist: 0,
  });
  const over = parseSave(applyPatch(save.raw, {
    numGlobals: save.numGlobals, set: save.set, scene: save.scene, view: save.view,
    scheduler: {
      loops: [], crickets: [],
      walks: [...Array.from({ length: 17 }, (_, i) => turn(i)), { ...turn(99), type: 3, path: undefined }],
    },
    onDrop: (n, why) => dropped.push(`${n}: ${why}`),
  }));
  expect(over.walks.length).toBe(16);
  expect(dropped).toContain("walk(t16): the walks table holds 16 slots");
  expect(dropped).toContain("walk(t99): the walks table holds 16 slots");
  const malformed = parseSave(applyPatch(save.raw, {
    numGlobals: save.numGlobals, set: save.set, scene: save.scene, view: save.view,
    scheduler: { loops: [], crickets: [], walks: [{ ...turn(0), type: 3, path: undefined }] },
    onDrop: (n, why) => dropped.push(`${n}: ${why}`),
  }));
  expect(malformed.walks).toEqual([]);
  expect(dropped).toContain("walk(t0): a route with no waypoints");
});

/**
 * The full circle, which is the bug as a player meets it: save mid-walk in the
 * port, reload, and the walker is still walking.
 *
 * Both shapes that move, because they fail differently — a straight line lives
 * entirely in the 110-byte record, and a route's length is not even in it. The
 * position after the reload has to be the position before it (not the start of
 * the walk, which is what a re-issued `walktostar` would give), and the walker
 * has to still arrive.
 *
 * NOT verified here: that TI.EXE reads what we write. Our own suite passing
 * proves only that we agree with ourselves, and a slot with a payload handle is
 * exactly the shape that took five DosBox fatals to get right for the shipped
 * saves — see the issue.
 */
test("a walk saved by our own writer resumes — the round trip is symmetric (#191)", async () => {
  const { session, logs } = await newHost();
  await drain();
  let clock = 0;
  const cases = [
    { file: ["1", "17 - Looking up GQC for Daisy.ti"], actor: "cash", star: "cash1", type: 1, points: undefined },
    { file: ["2", "05 - Talking with Max.ti"], actor: "ga", star: "ga.2", type: 3, points: 10 },
  ] as const;
  for (const c of cases) {
    const shipped = new Uint8Array(readFileSync(savePath(c.file[0], c.file[1])));
    expect(await session.loadGame(shipped)).toBe(true);
    // WALK ON FIRST, so the moment being saved is not the base's own.
    //
    // The base a snapshot patches is the save that was loaded, and these two
    // both carry the walk already — so a writer that did nothing at all would
    // leak the base's slot through and pass every assertion below. Twenty
    // passes puts the walker somewhere the base does not know about, which is
    // what makes the position check bite.
    for (let i = 0; i < 20; i++) session.tickTime((clock += 50));
    const before = session.actorRuntime.get(c.actor)!;
    const at = [before.worldX, before.worldY, before.worldZ];
    expect(session.scheduler.isWalk(c.actor), `${c.actor} is still under way`).toBe(true);
    const wasAt = parseSave(shipped).walks.find((x) => x.actor === c.actor)!.progress;

    // the save OUR writer takes of that moment
    const mine = session.snapshotSave();
    expect(mine, `${c.actor}: a save was written`).toBeTruthy();
    const w = parseSave(mine!).walks.find((x) => x.actor === c.actor);
    expect(w, `${c.actor}: the walk is in the file`).toBeTruthy();
    expect(w!.type, `${c.actor} type`).toBe(c.type);
    expect(w!.star, `${c.actor} star`).toBe(c.star);
    expect(w!.path?.length, `${c.actor} waypoints`).toBe(c.points);
    // OUR moment, not the base's
    expect(w!.progress, `${c.actor} progress moved on`).toBeGreaterThan(wasAt);

    logs.length = 0;
    expect(await session.loadGame(mine!)).toBe(true);
    const after = session.actorRuntime.get(c.actor)!;
    expect(session.scheduler.isWalk(c.actor), `${c.actor} is still walking`).toBe(true);
    expect([after.worldX, after.worldY, after.worldZ], `${c.actor} from where saved`).toEqual(at);
    expect(logs.some((l) => new RegExp(`${c.actor} was saved walking to "${c.star}" — resuming it`).test(l))).toBe(true);

    // and she still gets there — the bound is `hack`'s worst case from the
    // route test above, a route being as long as the author drew it
    for (let i = 0; i < 2000 && session.scheduler.isWalk(c.actor); i++) session.tickTime((clock += 50));
    expect(session.scheduler.isWalk(c.actor), `${c.actor} arrives`).toBe(false);
    expect(after.starName, `${c.actor} lands on its star`).toBe(c.star);
  }
});

/**
 * A TURN in flight survives too, which is the shape the issue is actually about.
 *
 * 12 of the 16 live slots in the corpus are type 0, because `walktopuppet`
 * (gang.cst 0001) opens with one and it is how most characters reach you:
 *
 *     turntodeg (who, calcdeg (actorxyz (who, 4), cameraxyz (4)))
 *     while iswalk (who)  forceupdate ()  endwhile
 *     runpuppet (pupname, pupmessage)
 *
 * A turn is a walk to `iswalk` (it tests the slot's occupied flag and its actor
 * name, never the mode — see `Scheduler.turning`), so a save taken inside that
 * `while` used to reload with the record gone and the conversation's own wait
 * already over.
 *
 * Started here rather than loaded from a shipped save, which makes it the one
 * case that cannot be vacuous: no base save carries a turn for this actor, so
 * every byte read back is one this writer put there. A turn is also sub-second —
 * `stdturn` is 10 for every set in TAOOT — so the window is a few passes wide and
 * the save has to catch it mid-flight.
 */
test("a turn in flight survives our own save, and still lands (#191)", async () => {
  const { session } = await newHost();
  await drain();
  // 2/05, where `max` is standing idle — `startTurn` refuses to record over a
  // walk already in flight (one slot per actor is all there is, so a turn taken
  // over a journey would discard its destination), so a base whose own table
  // already holds one for him would quietly keep ITS turn and test nothing
  expect(await session.loadGame(new Uint8Array(readFileSync(savePath("2", "05 - Talking with Max.ti"))))).toBe(true);
  expect(session.scheduler.isWalk("max"), "max is standing to begin with").toBe(false);
  const max = session.actorRuntime.get("max")!;
  // silence his idle for the moment being saved, exactly as `walktopuppet` does:
  // `maxidle` re-aims him at the camera on its own period, and a turn issued over
  // one already in flight sets the facing outright rather than recording it (see
  // `startTurn`), so an unpaused idle makes the pre-save state a race
  session.scheduler.pauseLoop("actor", "max", true);
  // half a circle from where he stands, which is 128/10 = 13 passes of turning
  const target = (max.deg + 128) & 0xff;
  session.scheduler.startTurn("max", target);
  let clock = 0;
  for (let i = 0; i < 3; i++) session.tickTime((clock += 50));
  expect(session.scheduler.turning("max"), "caught mid-turn").toBe(true);
  const facing = max.deg;
  expect(facing, "and it has turned some of the way").not.toBe(target);

  const w = parseSave(session.snapshotSave()!).walks.find((x) => x.actor === "max");
  expect(w, "the turn is in the file").toBeTruthy();
  // type 0 is the turn, and the target is the field a turn is FOR
  expect(w!.type).toBe(0);
  expect(w!.turnTo).toBe(target);
  expect(w!.hasPayload, "a turn has no waypoints").toBe(false);
  // the CURRENT star, not "": TI.EXE's turn builder copies the actor's own star
  // into +0x3e ("a turn does not change where anyone is going"), all 12 shipped
  // type-0 slots carry one, and its arrival sets `actorstar` from the field —
  // an empty one would be a shape no save TI.EXE ever wrote (#191 review)
  expect(w!.star).toBe(max.starName);
  expect(w!.star).not.toBe("");

  expect(await session.loadGame(session.snapshotSave()!)).toBe(true);
  const re = session.actorRuntime.get("max")!;
  expect(session.scheduler.turning("max"), "still turning after the reload").toBe(true);
  expect(re.deg, "from the facing it had reached").toBe(facing);

  // ...and it finishes the turn it was saved in the middle of. His idle has to be
  // silenced again to see that, and for a reason worth stating: a load restores
  // the loop table with every loop RUNNING, because a paused one is not a field
  // the record has — so `maxidle` comes back armed and re-aims him at the camera
  // on its own period, which is the room working and not the turn failing. Pause
  // it and what is left is the restored record, which lands where it was going.
  session.scheduler.pauseLoop("actor", "max", true);
  // 20 ticks, DELIBERATELY tight: the record's `actorturn` is 10, so the
  // half-circle lands inside 14 — while a load that dropped the field back to
  // the runtime default would take ~13 at 16, and one that zeroed it would
  // treadmill at `stepDeg`'s floor of 1 for 128. The tight bound is what makes
  // this fail if the actorturn restore (the sibling test below) ever regresses.
  for (let i = 0; i < 20 && session.scheduler.turning("max"); i++) session.tickTime((clock += 50));
  expect(session.scheduler.turning("max"), "the turn ends").toBe(false);
  expect(re.deg, "on the target it was saved heading for").toBe(target);
});

test("the open-cast-file list decodes, and it is what the rooms with a crowd need", () => {
  const seen = new Map<string, number>();
  for (const path of allSaves()) {
    const save = parseSave(new Uint8Array(readFileSync(path)));
    // container 3 in every shipped save, and every record names a .cst
    expect.soft(save.castIndex, path).toBe(3);
    expect.soft(save.castFiles[0], path).toBe("gang.cst"); // the boot cast, always
    seen.set(save.castFiles.join(","), (seen.get(save.castFiles.join(",")) ?? 0) + 1);
  }
  // exactly two lists exist: the boot cast, and the boot cast plus the crowd
  expect([...seen.keys()].sort()).toEqual(["gang.cst", "gang.cst,extra.cst"]);
  expect(seen.get("gang.cst,extra.cst")).toBeGreaterThan(0);
});

// --- a load mounts the disc the save was taken on (#231) --------------------
//
// 93 basenames ship on both CDs — the public rooms, once per act — and 70 of
// them differ byte for byte, 19 of those being `.set` rooms. Which copy the
// engine reads is `setpath(disk)`'s to say, and BOOTFILE only ever calls it on a
// story transition (`advanceday`) or when the tour starts. A LOAD is neither, so
// nothing re-stated it and the file store stayed on whatever disc the session was
// already on — disc 1 after a cold boot, which is 78 of the 109 shipped saves
// opening the wrong act's rooms.
//
// The save says which disc itself: `setpath` mounts its volume by label
// (`currentcd("Titanic2")`), and that label is container 0 @256 — the original's
// loader restores the whole resource path table with it, `titanic2:data:` and
// all, which is in the bytes of every shipped save.
//
// Reported as the vestibule door (#231): disc 2's `veststbd` sends you to
// `deckbd scene36/view110`, the promenade outside the door, and disc 1's older
// copy still names `scene379`, a scene deckbd does not have — so the fallback to
// the set's first scene took over, and deckbd's first scene is a stub whose whole
// openscene is `gotospecial ("decka", "scene354", "view357")`. The player was
// handed through the boat deck and out onto A deck without stopping.
test("a load mounts the disc the save was taken on, and the doors lead where they should (#231)", async () => {
  const { session, viewer, logs } = await newHost();
  // Mission 1 — aboard, so `setpath(2)` has run in any real playthrough. A cold
  // boot has not run it: the session is on disc 1, where bedsit1 and the boot
  // library live.
  const ok = await session.loadGame(
    new Uint8Array(readFileSync(savePath("1", "03 - Found the Gymnasium.ti"))),
  );
  await session.settle();
  check("the save loads, in mission 1", ok && session.interp.globals.get("mission") === 1,
    `ok=${ok} mission=${session.interp.globals.get("mission")}`);
  check("...and loading it mounted disc 2",
    logs.some((l) => /disc 2 .* mounted/.test(l)),
    `disc lines: ${JSON.stringify(logs.filter((l) => /disc/.test(l)))}`);

  // The room the report is about, and the door out of it. `propvisible("door")`
  // gates the whole branch, so the door is opened the way a player opens it.
  await session.openSetFile("veststbd.set", "scene17", "view18");
  await session.settle();
  let v = viewer();
  check("standing at the starboard vestibule's outer door",
    session.currentSetName === "veststbd" &&
      v.scene.sceneName.toLowerCase() === "scene17" &&
      v.scene.views[v.viewIdx].viewName.toLowerCase() === "view18",
    `${session.currentSetName} ${v.scene.sceneName}/${v.scene.views[v.viewIdx].viewName}`);
  const obj = v.scene.views[v.viewIdx].objects.find((o) => /door/i.test(o.identifier))!;
  await v.click(
    Math.floor((obj.startRegionX + obj.endRegionX) / 2),
    Math.floor((obj.startRegionY + obj.endRegionY) / 2),
  );
  await session.settle();
  check("the door opens", session.propRuntime.get("door")?.visible === true);

  await v.keyDown("uparrow");
  await session.settle();
  v = viewer();
  const where = `${session.currentSetName} ${v.scene.sceneName}/${v.scene.views[v.viewIdx].viewName}`;
  check("through it is the boat deck, outside that very door",
    session.currentSetName === "deckbd" &&
      v.scene.sceneName.toLowerCase() === "scene36" &&
      v.scene.views[v.viewIdx].viewName.toLowerCase() === "view110",
    `landed in ${where} (decka means the disc-1 room's dead scene name sent us on)`);
  // and it is the reciprocal of the way back: deckbd Scene36's own keydown sends
  // view111 to veststbd scene17/view19
  check("...and not merely passing through it",
    logs.filter((l) => /opensetfile/.test(l)).at(-1) ===
      'opensetfile("deckbd.set", "scene36", "view110")',
    `last opens: ${JSON.stringify(logs.filter((l) => /opensetfile/.test(l)).slice(-3))}`);
});

test("every shipped save names a disc its own setpath mounts", async () => {
  const { session } = await newHost();
  const volumes = session.discVolumes;
  check("the boot names two volumes", volumes.length === 2, volumes.join(","));
  for (const path of allSaves()) {
    const save = parseSave(new Uint8Array(readFileSync(path)));
    const disc = volumes.indexOf(save.disk.trim().toLowerCase()) + 1;
    // setpath's own rule, which is the only place the mapping is stated: disc 1
    // for the 1942 prologue (mission 0) and for mission 4, disc 2 from the moment
    // you board until the iceberg, and disc 2 for the tour.
    const mission = save.numGlobals.get("mission") ?? -1;
    const tour = save.numGlobals.get("tour") ?? 0;
    const want = tour ? 2 : mission === 0 || mission === 4 ? 1 : 2;
    expect.soft(disc, `${path} (disk="${save.disk}" mission=${mission} tour=${tour})`).toBe(want);
  }
});

// --- a save says which disc it was taken on (#231) --------------------------
//
// The other half of the disc a load mounts: the field it reads has to be true.
// A save is written by patching a skeleton — a shipped save, or the last one
// loaded — and `disk` (container 0 @256) was one of the few fields the patch left
// alone, so a save inherited whichever disc that skeleton came off. The reachable
// way to write a wrong one is the story's own: load a mission-3 save, play on into
// mission 4, and save. `advanceday` crosses back to disc 1 there (`setpath(1)`)
// and the skeleton still said disc 2.
test("a save names the disc it was taken on, across the mission-4 crossing (#231)", async () => {
  const { session, logs } = await newHost();
  await session.loadGame(new Uint8Array(readFileSync(savePath("1", "25 - In Squash Court.ti"))));
  await session.settle();
  check("loaded on disc 2, where the middle of the story is",
    session.mountedCd === "Titanic2", `currentcd() = "${session.mountedCd}"`);
  const before = parseSave(session.snapshotSave()!);
  check("a save taken there says so", before.disk === "Titanic2", `disk="${before.disk}"`);

  // the crossing, through the boot's own setpath rather than a stand-in for it
  session.interp.globals.set("mission", 4);
  await session.sendEvent("sendtostage", "", "setpath", [1], "test");
  await session.settle();
  check("setpath(1) mounts disc 1", session.mountedCd === "Titanic1",
    `currentcd() = "${session.mountedCd}" | ${JSON.stringify(logs.filter((l) => /disc/.test(l)))}`);
  const after = parseSave(session.snapshotSave()!);
  check("...and a save taken after it says disc 1, not the skeleton's disc 2",
    after.disk === "Titanic1", `disk="${after.disk}" mission=${after.numGlobals.get("mission")}`);
  check("...while everything else about it still round-trips",
    after.numGlobals.get("mission") === 4 && after.set === before.set,
    `mission=${after.numGlobals.get("mission")} set=${after.set}`);

  // and loading it leaves disc 1 in play. A fresh session is already there (the
  // cold boot's own setpath(1)), so the assertion is that nothing moved it OFF —
  // which is exactly what the mission-3 skeleton's stale label used to do.
  const bytes = session.snapshotSave()!;
  const { session: reloaded, logs: reloadLogs } = await newHost();
  check("reloading it leaves disc 1 in play",
    (await reloaded.loadGame(bytes)) &&
      reloaded.mountedCd === "Titanic1" &&
      !reloadLogs.some((l) => /disc 2 .* mounted/.test(l)),
    `currentcd() = "${reloaded.mountedCd}" | ${JSON.stringify(reloadLogs.filter((l) => /disc/.test(l)))}`);
});
