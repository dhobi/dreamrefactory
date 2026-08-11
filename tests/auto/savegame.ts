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
  globalsCapacity,
  type RawSaveFile,
} from "../../src/df/savegame";
import { readShpFile } from "../../src/df/shp";
import { readSetFile } from "../../src/df/set";
import { gamefiles, gamefilesRoot } from "../../tools/gamefiles";
import { bestTemplate, shippedSaves } from "../../src/save-seed";
import type { SaveEntry } from "../../src/save-store";
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
 * states — so {@link HELD_BAND_PROPS}, which restores the band's look by view,
 * could not carry it, and `initprops`' re-run of `initinterface` had just set it
 * to 0.
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
        x: 2359, y: 8106, z: 4143, deg: 2, speed: 30, zclip: 32,
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
