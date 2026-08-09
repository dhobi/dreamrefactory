/**
 * Save/load regression — runs headless against the shipped `.ti` saves.
 *
 *   npx vitest run tests/auto/savegame.ts
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
  type RawSaveFile,
} from "../../src/df/savegame";
import { readShpFile } from "../../src/df/shp";
import { gamefiles, gamefilesRoot } from "../../tools/gamefiles";
import { shippedSaves } from "../../src/save-seed";
import { GameSession } from "../../src/engine/session";
import {
  NullAudioSink,
  type AudioChannel,
  type AudioSink,
  type PlayHandle,
  type PlayOpts,
} from "../../src/engine/audio";
import type { DecodedAudio } from "../../src/df/audio";
import { SetViewer } from "../../src/viewer";

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

// The writer zero-fills the ignored pointer/padding regions the original left
// process junk in, so bytes are NOT identical — but everything the loader reads
// (header fields, position table, each container's id/size/data) must survive.
test("every shipped save round-trips everything the loader reads", () => {
  const saves = allSaves();
  expect(saves.length).toBeGreaterThan(0);
  for (const path of saves) {
    const raw = readSaveFile(new Uint8Array(readFileSync(path)));
    const raw2 = readSaveFile(writeSaveFile(raw));
    expect.soft(containersEqual(raw, raw2), path).toBe(true);
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
  expect(re.inventory.find((p) => p.name === "photo1")).toEqual({
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
  expect(re.inventory.find((p) => p.name === "notebook")).toEqual({
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
// missing from exactly the four pre-boarding saves of the 109 shipped, and
// shippedSaveTemplate picks the first file in save/1, which is one of them: with
// that template 12 of the 107 globals the engine holds at the end of mission 2
// phase 0 were silently dropped.
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
