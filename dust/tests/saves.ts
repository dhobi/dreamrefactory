/**
 * Dust's saved games (`.rtd`) — the container layer and the store's discovery.
 *
 *   npx vitest run dust/tests/saves.ts
 *
 * Two claims, and the first is the one the whole Dust save story rests on: a
 * `.rtd` is the SAME save container a `.ti` is, so `df/savegame.ts`'s framing
 * reader and writer take Dust's files unchanged. That is not a guess about the
 * format — the five files here came off a real DOS installation, and the reader
 * has to reproduce every byte of each one.
 *
 * Skipped, not failed, without the disc: `gamefiles/save/` is a rip, and CI
 * has no rip (the same bargain `taoot/tests/auto/savegame.ts` makes for TAOOT).
 */
import { test, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSaveFile, writeSaveFile } from "@dreamfactory/engine/df/savegame";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { applyPatchV1, parseSaveV1, v1Index } from "@dreamfactory/engine/df/savegame-v1";
import { snapshotSaveV1 } from "@dreamfactory/engine/runtime/saveload-v1";
import { parseScript } from "@dreamfactory/engine/runtime/parser";
import { ScriptInstance } from "@dreamfactory/engine/runtime/interp";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { decodeScript } from "@dreamfactory/engine/df/script";
import { readSetFileV1 } from "@dreamfactory/engine/df/set-v1";

/** `7 + 5` — the containers every v1 save has, whatever it had open (v1Index) */
const FIXED_V1_CONTAINERS = 12;
import { shippedDustSaves } from "../src/saves";

/* anchored to this file: the pre-monorepo `<cwd>/gamefiles/dust/save` made these
   skip silently rather than fail (see dust/tests/movies.ts) */
const SAVE_DIR = fileURLToPath(new URL("../gamefiles/save", import.meta.url));
const DATA_DIR = fileURLToPath(new URL("../gamefiles/dustcd/DATA", import.meta.url));

/**
 * The earliest save in the directory — the start of whatever session it holds.
 *
 * `frame` is the service-pass counter and orders the collection by when each
 * save was taken, so this is the beginning of the game without any file having
 * to be called `START`.
 */
function earliest(files: string[]): { name: string; bytes: Uint8Array } {
  const read = (f: string) => new Uint8Array(readFileSync(join(SAVE_DIR, f)));
  let best: { name: string; bytes: Uint8Array; frame: number } | null = null;
  for (const f of files) {
    const bytes = read(f);
    const frame = parseSaveV1(bytes).frame;
    if (!best || frame < best.frame) best = { name: f, bytes, frame };
  }
  return best!;
}

function dustSaves(): string[] {
  if (!existsSync(SAVE_DIR)) return [];
  return readdirSync(SAVE_DIR)
    .filter((f) => /\.rtd$/i.test(f))
    .sort();
}

test("a Dust save is the same container a Titanic save is", () => {
  const files = dustSaves();
  if (!files.length) {
    console.warn(`no ${SAVE_DIR} — skipping (needs the Dust rip)`);
    return;
  }
  for (const f of files) {
    const bytes = new Uint8Array(readFileSync(join(SAVE_DIR, f)));
    const raw = readSaveFile(bytes);
    // the signature gate inside readSaveFile already passed, so what is left to
    // say is that the file HAS containers and the table was believed
    expect.soft(raw.containers.length, `${f}: containers`).toBeGreaterThan(0);
    /*
     * ...and that the count is one the positional map can account for. NOT a
     * fixed 18: that was true of the saves this was written against and is
     * not a property of the format — `count = 7 + 3·banks + 5 + payloads`
     * (v1Index), so a save with one open sound bank is 15 and one carrying an
     * active walk's waypoints is 19. A larger collection has both: `D2E_001`
     * with one bank, `D1E_005` with a walk payload. What IS a property is that
     * the map the count implies lands on the file's own structures, and
     * `v1Index` throws when it does not — so parsing is the assertion, and the
     * arithmetic is checked here rather than a magic number.
     *
     * Three things it now throws on rather than one (#325): container 6 having
     * no room for the banks (the original, one-sided check), the three service
     * tables not being at the tail the count puts them at, and the leftover
     * container count disagreeing with how many walk slots declare waypoints.
     */
    const index = v1Index(raw);
    const payloads = raw.containers.length - (FIXED_V1_CONTAINERS + 3 * index.banks);
    expect
      .soft(payloads, `${f}: ${raw.containers.length} containers, ${index.banks} bank(s), so payloads`)
      .toBeGreaterThanOrEqual(0);
    expect.soft(index.banks, `${f}: at least the boot's own bank is open`).toBeGreaterThan(0);
  }
});

/**
 * The case the container count alone cannot answer.
 *
 * `count = 7 + 3·banks + 5 + payloads`, so THREE waypoint payloads cost exactly
 * what one more sound bank costs, and the count proposes a `banks` one too high.
 * No shipped save reaches three (the most any carries is one), but a save this
 * port writes can, and the reader has to survive its own output. Built here by
 * appending three payload containers to a real save and arming three walk slots
 * to declare them, which is the shape the original writer would have emitted.
 */
test("v1Index recovers the map when three walk payloads look like a bank", () => {
  const files = dustSaves();
  if (!files.length) return;
  const bytes = new Uint8Array(readFileSync(join(SAVE_DIR, files[0])));
  const raw = readSaveFile(bytes);
  const before = v1Index(raw);
  const walks = raw.containers[before.walks].data;
  const dv = new DataView(walks.buffer, walks.byteOffset, walks.byteLength);
  // three active slots, each claiming a waypoint container (82-byte records;
  // +0 active, +0x24 the payload handle — any non-zero value is "I have one")
  for (let s = 0; s < 3; s++) {
    dv.setUint16(s * 82, 1, true);
    dv.setUint32(s * 82 + 36, 0xa6b4b0, true);
  }
  // and the containers they name, replacing whatever the base's own tail held
  raw.containers.length = before.walks + 1;
  for (let s = 0; s < 3; s++) raw.containers.push({ id: raw.containers.length, data: new Uint8Array(8) });

  const naive = Math.floor((raw.containers.length - FIXED_V1_CONTAINERS) / 3);
  expect(naive, "the count alone proposes one bank too many").toBe(before.banks + 1);
  expect(v1Index(raw).banks, "the fixed service tables say which it really was").toBe(before.banks);
  expect(v1Index(raw).globals).toBe(before.globals);
});

/** ...and the same validation refuses a file whose tail is not the map's. */
test("v1Index refuses a save whose service tables are not where the count puts them", () => {
  const files = dustSaves();
  if (!files.length) return;
  const raw = readSaveFile(new Uint8Array(readFileSync(join(SAVE_DIR, files[0]))));
  const index = v1Index(raw);
  // one container too few: nothing puts the loops/crickets/walks triple at a tail
  raw.containers.splice(index.globals, 1);
  expect(() => v1Index(raw)).toThrow(/loops\/crickets\/walks/);
});

/**
 * Where the position table stops being a table.
 *
 * The table has 128 slots and a Dust save fills 18 of them, so 440 bytes of it
 * are slack — and the original left process memory there rather than zeros. In
 * four of the five that memory is legible: a stale Pascal string
 * `appl:bootfile` and the tail of `unilib.snd`, which is the boot's own file
 * list still lying in the heap the writer dumped. The loader never reads past
 * the count at offset 20, so this is junk in the exact sense the `.ti` format
 * doc means it (and we write zeros, as we do there).
 *
 * Derived per save, because where the live table ends is where the CONTAINERS
 * end: `1024 + 4 × count`. It was `1024 + 18 × 4`, which is right only for a
 * save with two open sound banks and no walk payload — the count is
 * `7 + 3·banks + 5 + payloads` (see the note in the first test) — so on a save
 * with one bank the three entries the fixed figure covered are live table, and
 * a rewrite that zeroes the slack was reported as corrupting them.
 *
 * It is the ONE region a rewrite is allowed to differ in: everything before it
 * is header and live table, everything after it is container data, and both have
 * to come back exactly.
 */
const tableSlackStart = (containers: number): number => 1024 + containers * 4;
const DATA_START = 1536;

test("rewriting a Dust save reproduces every byte the loader reads", () => {
  const files = dustSaves();
  if (!files.length) return;
  for (const f of files) {
    const bytes = new Uint8Array(readFileSync(join(SAVE_DIR, f)));
    const raw = readSaveFile(bytes);
    const out = writeSaveFile(raw);
    const slack = tableSlackStart(raw.containers.length);
    expect.soft(out.length, `${f}: length`).toBe(bytes.length);
    const stray: number[] = [];
    for (let i = 0; i < Math.min(out.length, bytes.length); i++) {
      if (out[i] === bytes[i]) continue;
      if (i >= slack && i < DATA_START) continue; // the heap junk, above
      stray.push(i);
    }
    // Every byte of the header, of the 18 live table entries, and of all 18
    // containers — reproduced. A regression here means the framing moved.
    expect
      .soft(stray.slice(0, 8), `${f}: bytes changed outside the table slack`)
      .toEqual([]);
  }
});

test("the store finds the shipped saves in a manifest listing", () => {
  const found = shippedDustSaves([
    "gamefiles/dustcd/DATA/G15.SET",
    "gamefiles/save/START.RTD",
    "gamefiles/save/DOG.RTD",
    // not ours: the disc's own files, and the play page's saves
    "gamefiles/dustcd/INSTALL/ALT31/DF.EXE",
    "gamefiles/en/save/1/01 - April 14th, 1942.ti",
  ]);
  expect(found.map((f) => f.name)).toEqual(["DOG", "START"]);
  // grouped under the disc folder, keyed by a path of their own so a user save
  // called START cannot collide with the disc's
  expect(found[0].rel).toBe("disc/DOG.RTD");
});

test("every shipped save is discoverable by the pattern the page uses", () => {
  const files = dustSaves();
  if (!files.length) return;
  const paths = files.map((f) => `gamefiles/save/${f}`);
  expect(shippedDustSaves(paths).length).toBe(files.length);
});

// ---------------------------------------------------------------------------
// The writer: a patch over a base save
// ---------------------------------------------------------------------------

/**
 * Reading is half of it. A save is a dump of a live C++ object graph and cannot
 * be built from nothing, so writing one means patching a real file — and the
 * test that matters is that the patch survives a round trip through the same
 * reader the original engine's loader agrees with.
 *
 * The values below are deliberately awkward: a global the base has never heard
 * of (which has to make a node in the free tail of the array), a string long
 * enough to need real pool space, a negative coordinate, and a loop table
 * shorter than the base's (which has to clear the slots it does not fill).
 */
test("a patched Dust save reads back what was written into it", () => {
  const files = dustSaves();
  if (!files.length) return;
  /*
   * The base is the EARLIEST save in the directory, found by frame rather than
   * named: whatever collection is installed, the beginning of its session is the
   * honest lender for the fields a patch does not understand. It used to be
   * `START.RTD` by name, and naming a file made this the one test in here that
   * could not survive a different set of saves.
   */
  const base = readSaveFile(earliest(files).bytes);
  const before = parseSaveV1(writeSaveFile(base));

  const out = applyPatchV1(base, {
    numGlobals: new Map([
      ["day", 3],
      ["playercash", 42],
      ["phase", 7],
    ]),
    strGlobals: new Map([
      ["handitem", "Bone"],
      ["theset", "apoth"],
    ]),
    standpoint: {
      set: "apoth",
      setFile: "apoth.set",
      cellX: 2,
      cellZ: 5,
      facing: 3,
      deg: 0,
      camX: 2 * 256 + 128,
      camY: 5 * 256 + 128,
    },
    frame: 4242,
    props: [
      {
        name: "Bone",
        owner: "stranger",
        view: "large",
        visible: true,
        scale: 1200,
        dist: -1,
      },
    ],
    actors: [
      {
        name: "Leroy",
        owner: "stranger",
        pose: "grunt",
        deg: 64,
        star: "town.leroy1",
        set: "town",
        is3d: true,
      },
    ],
    loops: [{ kind: "scene", name: "scene a2", handler: "apothfx", period: 5 }],
  });

  const after = parseSaveV1(out);
  // the globals, including one the base had no record for
  expect.soft(after.numGlobals.get("day"), "day").toBe(3);
  expect.soft(after.numGlobals.get("playercash"), "playercash").toBe(42);
  expect.soft(after.numGlobals.get("phase"), "phase").toBe(7);
  expect.soft(after.strGlobals.get("handitem"), "handitem").toBe("Bone");
  expect.soft(after.strGlobals.get("theset"), "theset").toBe("apoth");
  // the standpoint and the frame counter
  expect.soft(after.standpoint.set, "set").toBe("apoth");
  // ...and the room a load would actually reopen, which comes from the manifest
  // rather than from the name beside it
  expect.soft(after.standpoint.setFile, "set file").toBe("apoth.set");
  expect
    .soft([after.standpoint.cellX, after.standpoint.cellZ], "cell")
    .toEqual([2, 5]);
  expect.soft(after.standpoint.view, "view from deg 0").toBe("east");
  expect.soft(after.frame, "frame").toBe(4242);
  // the records, found by name in the base's own grids
  const bone = after.props.find((p) => p.name === "Bone");
  expect.soft(bone?.owner, "Bone owner").toBe("stranger");
  expect.soft(bone?.visible, "Bone visible").toBe(true);
  expect.soft(bone?.scale, "Bone scale").toBe(1200);
  expect.soft(bone?.dist, "Bone dist").toBe(-1);
  const leroy = after.actors.find((a) => a.name === "Leroy");
  expect.soft(leroy?.pose, "Leroy pose").toBe("grunt");
  expect.soft(leroy?.owner, "Leroy owner").toBe("stranger");
  expect.soft(leroy?.deg, "Leroy deg").toBe(64);
  expect.soft(leroy?.is3d, "Leroy is3d").toBe(true);
  // the loop table is rewritten whole, so the base's nine are gone
  expect.soft(after.loops.length, "loops").toBe(1);
  expect.soft(after.loops[0], "the one loop").toEqual({
    kind: "scene",
    name: "scene a2",
    handler: "apothfx",
    period: 5,
  });
  // and nothing else moved: the file is still the same shape it was
  expect
    .soft(after.raw.containers.length, "containers")
    .toBe(before.raw.containers.length);
  expect.soft(after.actors.length, "cast size").toBe(before.actors.length);
  expect.soft(after.props.length, "prop count").toBe(before.props.length);
  expect.soft(after.castFiles, "cast files").toEqual(before.castFiles);
});

/** the shipped saves, read for the story they tell — a canary on every offset in
 *  the record at once, because these are the values the game itself produced */
test("the shipped saves decode to the game they came from", () => {
  const files = dustSaves();
  if (!files.length) return;
  const read = (f: string) =>
    parseSaveV1(new Uint8Array(readFileSync(join(SAVE_DIR, f))));

  const named = (f: string) => (existsSync(join(SAVE_DIR, f)) ? read(f) : null);

  /*
   * The first night, `D1E_001`: day 1, the five dollars you arrive with, and the
   * NIGHT town, a conversation with Jones open. The camera stands at the centre
   * of the cell the standpoint names, which is the arithmetic that makes a cell
   * a place.
   */
  const first = named("D1E_001.RTD");
  if (first) {
    expect.soft(first.title, "title").toBe("dust 0.3");
    expect.soft(first.numGlobals.get("day"), "day").toBe(1);
    expect.soft(first.numGlobals.get("playercash"), "cash").toBe(5);
    expect.soft(first.standpoint.set, "set").toBe("town");
    expect.soft(first.standpoint.setFile, "set file").toBe("nite.set");
    expect
      .soft([first.standpoint.cellX, first.standpoint.cellZ], "cell")
      .toEqual([10, 10]);
    expect.soft(first.standpoint.view, "view").toBe("south");
    expect.soft(first.standpoint.camX, "camX").toBe(10 * 256 + 128);
    expect.soft(first.standpoint.camY, "camY").toBe(10 * 256 + 128);
    // taken with a conversation open, which is why it carries an extra file
    expect.soft(first.puppet, "the open puppet").toBe("jones.pup");
  }

  /*
   * `D1E_005` is the save taken one gesture after a trade, and it records BOTH
   * halves of it: the Cigar is in the player's hands and the Ring has passed to
   * Ruby. The player's own owner string is `stranger` — Dust's hero has no name
   * and the data agrees — and that one field is what makes an inventory legible.
   */
  const trade = named("D1E_005.RTD");
  if (trade) {
    expect.soft(trade.strGlobals.get("handitem"), "handitem").toBe("cigar");
    expect.soft(trade.numGlobals.get("phase"), "phase").toBe(5);
    const cigar = trade.props.find((p) => p.name === "Cigar");
    expect.soft(cigar?.owner, "who owns the cigar").toBe("stranger");
    expect.soft(cigar?.visible, "and it is on screen").toBe(true);
    expect
      .soft(trade.props.find((p) => p.name === "Ring")?.owner, "the ring")
      .toBe("ruby");
    expect.soft(trade.puppet, "the open puppet").toBe("fear.pup");
  }

  // and the far end of the same session: day 5, holding the chest
  const end = named("ENDING.RTD");
  if (end) {
    expect.soft(end.numGlobals.get("day"), "the last day").toBe(5);
    expect.soft(end.strGlobals.get("handitem"), "handitem").toBe("chest");
    expect
      .soft(end.props.find((p) => p.name === "chest")?.owner, "the chest")
      .toBe("stranger");
  }

  /*
   * The room these reopen is the NIGHT town, not the day one.
   *
   * Both files call themselves "town" inside, so the name field cannot tell them
   * apart — and the name is what a load used to trust, which brought a midnight
   * save back at noon with the day palette over it.
   *
   * The collection demonstrates it BOTH ways, which is the strongest form this
   * claim has: saves calling themselves "town" and holding `nite.set`, and saves
   * calling themselves "town" and holding `town.set`. Neither list is named here
   * — a directory may hold any collection — so the assertion is that the
   * ambiguity is real and the file resolves it, not that any one save is night.
   */
  const towns = files.map(read).filter((s) => s.standpoint.set === "town");
  if (towns.length) {
    const bySet = new Set(towns.map((s) => s.standpoint.setFile.toLowerCase()));
    expect
      .soft([...bySet].sort(), 'every save named "town" names one of the two town files')
      .toEqual([...bySet].filter((f) => f === "nite.set" || f === "town.set").sort());
  }
  for (const f of files) {
    const save = read(f);
    // the FILE is what a load has to trust, so every save has to name one...
    expect.soft(save.standpoint.setFile, `${f}: names a set file`).toMatch(/\.set$/i);
    // ...and where the inside name is the ambiguous one, the file resolves it
    if (save.standpoint.set === "town") {
      expect
        .soft(["town.set", "nite.set"], `${f}: "town" is one of the two town files`)
        .toContain(save.standpoint.setFile);
    }
    /*
     * No visible actor without `is3d` — the invariant the original's draw gate
     * (0x414fd0) makes load-bearing. A record that breaks it is drawn in EVERY
     * room, screen-anchored at the top-left, at raw scale (#319, #320); the
     * original never writes one, so neither may this port.
     */
    for (const a of save.actors) {
      if (a.visible) expect.soft(a.is3d, `${f}: ${a.name} is visible, so it is in the world`).toBe(true);
    }
  }

  /*
   * The cast's world position is x, y INTO THE SCREEN, z up — the engine's own
   * axis names, and the one mapping in this format that is invisible when wrong.
   * Relabelled with y as height, every restored character lands at depth 0 (the
   * camera's own eye), the projection refuses them, and the town comes back
   * deserted with every other field of every record perfectly restored.
   *
   * The dog is the witness: the port's script-driven boot stands it at
   * (1620, 2748, 0) — worldX, worldY, worldZ — and the record has to read the
   * same three numbers in the same order.
   */
  const NIGHT = "D1E_001.RTD"; // any save taken in the night town carries it
  const dog = read(NIGHT).actors.find((a) => a.name === "dog");
  expect
    .soft([dog?.x, dog?.y, dog?.z], "the dog's world position")
    .toEqual([1620, 2748, 0]);
  // and its scale, without which the draw list skips it entirely
  expect.soft(dog?.scale, "the dog's scale").toBe(880);
  /*
   * `actorturn` and `actorspeed`, on the scale the LIVE game runs at: the port's
   * script-driven boot puts Leroy, the dog and the horse at speed 3 / turn 7 and
   * the pig's group at turn 16, and these are the fields that agree with it. The
   * pair at +78/+80 does not — 32, 64, 100 and a uniform 100 — which is an order
   * of magnitude out and had every restored walker sprinting.
   */
  expect
    .soft([dog?.speed, dog?.turn], "the dog's speed and turn")
    .toEqual([3, 7]);
  const pig = read(NIGHT).actors.find((a) => a.name === "pig");
  expect.soft(pig?.turn, "the pig turns at its own rate").toBe(16);

  /*
   * A character caught mid-stride is caught in TWO tables, and the walk table is
   * mapped by RECONSTRUCTION: its numbers have to predict the position the CAST
   * record — a different table, written by the same engine at the same instant —
   * independently reports.
   *
   * Restoring only one of the two is worse than restoring neither: the cast
   * record hands over the `walk` pose, and an actor plays its pose whether or not
   * anything is moving it, so Jones came back marching on the spot in the middle
   * of the street.
   */
  const WALKING = "D2A_002.RTD"; // eight walks in flight, Jones among them
  const afterWalks = read(WALKING).walks;
  expect
    .soft(afterWalks.map((w) => w.actor)).toContain("Jones");
  const jones = afterWalks.find((w) => w.actor === "Jones")!;
  expect.soft(jones.star, "where to").toBe("town.jones2");
  expect.soft([jones.startX, jones.startY], "from").toEqual([1736, 2488]);
  expect.soft([jones.dx, jones.dy], "delta").toEqual([-112, -616]);
  expect.soft(jones.dist, "distance").toBe(626);
  // the field holds what is LEFT, the port wants what is done
  expect.soft(jones.progress, "covered").toBe(587);
  // and now the reconstruction: start + delta x (covered/dist) has to be where
  // the cast record says he is standing, to the pixel
  // TRUNCATED, not rounded — rounding puts him at x=1644 where the cast record
  // says 1643, which is the same fix-point truncation the projection uses
  const at = (s: number, d: number) =>
    Math.floor(s + d * (jones.progress / jones.dist));
  const jonesActor = read(WALKING).actors.find((a) => a.name === "Jones")!;
  expect
    .soft(
      [at(jones.startX, jones.dx), at(jones.startY, jones.dy)],
      "predicted position",
    )
    .toEqual([jonesActor.x, jonesActor.y]);

  // a save taken with nobody walking says so — a slot whose active word is clear
  // holds the LAST walk it ran, not a live one, and must not come back as one
  expect.soft(read(NIGHT).walks.length, `${NIGHT}: walks in flight`).toBe(0);
});

/**
 * The collection is a SESSION, and the frame counter is what says so.
 *
 * `gamefiles/save/` reads like a folder of examples and is not: ordered by the
 * service-pass counter, the saves that ship beside the disc are one continuous
 * playthrough, and `day` never goes backwards along it. That is the claim the
 * walkthrough and the thread page are built on
 * (`docs/dust/thread.md`), so it is worth a test rather than a paragraph.
 *
 * Stated as "at most one lineage break" rather than "none", because a directory
 * is a directory: a second sitting saved into it is a legitimate thing to find,
 * and the disc's own collection has exactly one such file. What would falsify
 * the claim is the saves being unordered — many breaks, not one.
 */
test("the shipped saves are one session, ordered by the frame counter", () => {
  const files = dustSaves();
  if (files.length < 2) return;
  const byFrame = files
    .map((f) => ({ f, save: parseSaveV1(new Uint8Array(readFileSync(join(SAVE_DIR, f)))) }))
    .sort((a, b) => a.save.frame - b.save.frame);

  // no two saves were taken at the same instant
  const frames = byFrame.map((r) => r.save.frame);
  expect.soft(new Set(frames).size, "distinct frame counters").toBe(frames.length);

  // and the story runs forwards with them
  let maxDay = 0;
  const breaks: string[] = [];
  for (const { f, save } of byFrame) {
    const day = save.numGlobals.get("day") ?? 0;
    if (day < maxDay) breaks.push(`${f} (day ${day} after day ${maxDay})`);
    else maxDay = day;
  }
  expect
    .soft(breaks.length, `lineage breaks: ${breaks.join(", ") || "none"}`)
    .toBeLessThanOrEqual(1);
});

// --- the sound a load brings back ------------------------------------------

/**
 * Loading a Dust save restored no audio at all: `save.theme` and
 * `save.bankFiles` were parsed and then unused. Reported from play — "loading a
 * game does not restore the playing theme" — and confirmed against DUST.EXE,
 * where `D1E_002` comes back with the saloon's ragtime already going.
 *
 * Two halves, and the banks are the bigger one. A load runs no `openset` (see
 * GameSession.restoringSave), so a room's ambience comes back as a restored LOOP
 * — `D1E_001` carries NITE.SET's `nightfxs`, which fires the owl and the distant
 * dog — and every one of those names a sound in a bank. With no bank open there
 * was nothing to find, which is why the night was silent rather than merely
 * music-less.
 *
 * The sharp part is WHICH bank. `NIGHT.SND` calls itself `town.snd`, exactly as
 * `TOWN.SND` does, and the save's bank list holds those inside names — so
 * opening the list by name fetches the daylight bank for a midnight save. The
 * theme record's words are manifest HANDLES, so they name the file; open that
 * first and the listed name is already answered.
 */
test("a load brings back the sound banks, and the theme if one was playing", async () => {
  if (!existsSync(`${DATA_DIR}/NIGHT.SND`) || !existsSync(join(SAVE_DIR, "D1E_001.RTD"))) {
    console.warn(`no ${DATA_DIR} — skipping (needs the Dust rip)`);
    return;
  }
  const load = async (file: string) => {
    const sink = new NullAudioSink();
    const logs: string[] = [];
    const session = new GameSession((n) => {
      const path = `${DATA_DIR}/${n.toUpperCase()}`;
      return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
    }, sink);
    session.onLog = (m) => logs.push(m);
    session.dfVersion = 1; // what dust/src/main.ts says at boot
    expect(await session.loadGame(new Uint8Array(readFileSync(join(SAVE_DIR, file)))), `${file} loads`).toBe(true);
    return { session, sink, logs };
  };

  // 1. the saloon, saved with its theme going: saloon2.snd is not even in the
  // save's bank list — the theme record's handle is what names it — and the
  // track it answers to is the name a script would hand back to playtheme.
  const saloon = await load("D1E_002.RTD");
  expect(saloon.session.audioLib.bankNames, "the saloon's banks").toContain("saloon2.snd");
  expect(saloon.session.currentThemeName, "the theme, by the name the bank calls itself").toBe("saloonsep.snd");
  const themePlays = saloon.sink.calls.filter((c) => c.channel === "theme" && c.loop);
  expect(themePlays.length, "one looping play on the theme channel").toBe(1);
  expect(themePlays[0].seconds, "and it is the bank's whole loop").toBeGreaterThan(1);

  // 2. the night town, saved with the theme stopped: no theme, but the right
  // TWO banks — and night.snd rather than the day bank whose name the list gives.
  const night = await load("D1E_001.RTD");
  expect([...night.session.audioLib.bankNames].sort(), "the night's banks").toEqual([
    "night.snd",
    "unilib.snd",
  ]);
  expect(night.session.audioLib.trackNameOf("night.snd"), "which is the bank calling itself town.snd").toBe("town.snd");
  expect(night.session.currentThemeName, "nothing was playing, so nothing plays").toBe("none");
  expect(night.sink.calls.filter((c) => c.channel === "theme").length, "no theme play").toBe(0);
  expect(
    night.logs.some((l) => l.includes("no theme playing")),
    "and the load says why it is quiet",
  ).toBe(true);
  // the room's own ambience is a restored LOOP, and it is what needs the banks
  expect(
    night.session.scheduler.loops.some((l) => l.handler === "nightfxs"),
    "NITE.SET's night chorus is running",
  ).toBe(true);
});

// --- the standpoint, on a game that has not been anywhere yet ---------------

/**
 * A load has to fetch the room before it can ask the room a question.
 *
 * The saved standpoint is a GRID CELL, and turning it into a scene name means
 * reading the set's own grid — `sceneAtCell`, through `GameSession.loadSet`,
 * which is synchronous and answers null for a file the provider has not been
 * given yet. In a browser that is the ordinary state of every room the player
 * has not visited, so on a freshly booted game the cell resolved to nothing and
 * the loader fell back to opening the room at its OWN standpoint: the right
 * room, the wrong place.
 *
 * Reported from play, and as narrow as it sounds — load `D1E_002` after visiting
 * the saloon and the standpoint is right; load it as the first thing a boot does
 * and it is `sallower.set`'s opening view (Scene D1) rather than the saved Scene
 * C4. Both arms are here, because a test that only proves the fetched case
 * passes on the bug.
 *
 * The provider is the point: it answers for nothing until `ensureFile` has asked
 * for it, which is what `FileStore` does in the page and what a test reading
 * straight off the disk cannot model.
 */
test("a load fetches the saved room before reading its grid", async () => {
  if (!existsSync(`${DATA_DIR}/SALLOWER.SET`) || !existsSync(join(SAVE_DIR, "D1E_002.RTD"))) {
    console.warn(`no ${DATA_DIR} — skipping (needs the Dust rip)`);
    return;
  }
  /** a session over a LAZY provider: nothing is readable until it is fetched */
  const lazy = (prefetched: string[]) => {
    const fetched = new Set(prefetched.map((n) => n.toLowerCase()));
    const bytes = (n: string) => {
      const path = `${DATA_DIR}/${n.toUpperCase()}`;
      return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
    };
    const session = new GameSession(
      (n) => (fetched.has(n.toLowerCase()) ? bytes(n) : null),
      new NullAudioSink(),
    );
    session.ensureFile = async (n) => {
      fetched.add(n.toLowerCase());
    };
    session.onLog = () => {};
    session.dfVersion = 1;
    // what the loader asks the host to open, which is the whole question here
    const opened: { file: string; scene: string; view: string }[] = [];
    session.onSetChange = async (file, scene, view) => {
      opened.push({ file, scene, view });
    };
    return { session, opened };
  };

  const bytes = new Uint8Array(readFileSync(join(SAVE_DIR, "D1E_002.RTD")));

  // 1. a freshly booted game: the saloon has never been fetched
  const cold = lazy([]);
  expect(await cold.session.loadGame(bytes), "the save loads").toBe(true);
  expect(cold.opened, "the room is opened at the SAVED standpoint").toEqual([
    { file: "sallower.set", scene: "scene c4", view: "west" },
  ]);

  // 2. and the case that always worked — the player has been in the saloon
  const warm = lazy(["sallower.set"]);
  expect(await warm.session.loadGame(bytes), "the save loads").toBe(true);
  expect(warm.opened, "...which is what the fetched case already did").toEqual(cold.opened);

  // the cell in the file, and the scene the set puts on it — so a change to
  // either shows up here as a disagreement rather than as a silent pass
  const save = parseSaveV1(bytes);
  expect([save.standpoint.cellX, save.standpoint.cellZ], "the saved cell").toEqual([2, 3]);
  expect([save.standpoint.camX, save.standpoint.camY], "the camera at that cell's centre").toEqual([
    2 * 256 + 128,
    3 * 256 + 128,
  ]);
});

// --- the room's own two packs, and its colours ------------------------------

/**
 * A save carries container indices out of the SET FILE it was taken in, and the
 * port used to leave them pointing at the wrong room.
 *
 * Reported from the original: a port-written save would not load at all —
 * "Dust cannot find a file. Be sure the Dust CD is in your computer's CD-ROM
 * drive (Error line 5361, code 2)". Line 5361 is a `__LINE__`, so it can be
 * found as `push 0x14f1`.
 *
 * ADDRESSES ARE `SUPPORT/BETA43/DFPENT.EXE`, which is on the disc, so every one
 * of them can be checked from a rip. They were first read in the DF.EXE an
 * INSTALL unpacks from `INSTALL/DATAPENT.Z`, which is NOT on the disc unpacked —
 * this comment used to quote that build (`push 0x14f1 at 0x42ef2a`, acquire at
 * `0x42d160`, globals at `0x4609xx`) and so pointed at nothing a reader could
 * open. The two are the same code: every data global below sits exactly 0x5F00
 * lower here, and the shipped build puts `push 0x14f1` at 0x424921.
 *
 *     0x4248cc  call 0x424a00            ; reopen the set file by path
 *     0x4248e1  call 0x401500            ; acquire pack 0             -> 5360
 *     0x424907  mov eax, [0x45aa40]      ; an index READ FROM THE SAVE
 *     0x424914  call 0x401500            ; acquire it                 -> 5361
 *     0x424941  call 0x401500            ; and [0x45aa34]             -> 5362
 *
 * The loader copies container 1 verbatim into its globals at `0x45a8a0` — which
 * is checkable, and checks out: every offset this port already knew lands on a
 * global the disassembly uses the same way (`C1_SET_FILE` 396 -> `0x45aa2c`, the
 * flat's file 356 -> `0x45aa04`, cell/facing 446/448/450 -> `0x45aa5e/60/62`).
 * So `[0x45aa40]` and `[0x45aa34]` are container 1 at +416 and +404: the set's
 * ACTOR and TRANSITION registers.
 *
 * The same binary is what `set-v1.ts` reads the set header out of, and the same
 * acquire routine — `0x401500` here — is how set-open was found to take only
 * three containers, which is what put the main script at 0x1b78 (#291).
 *
 * Leaving them stale is invisible until the room changes SIZE. `town.set` and
 * `nite.set` are the same 3111-container file twice, so a save moved between the
 * day and night town loads; `mayupper.set` has 205 containers, and a save moved
 * there asked the original for pack 259 of 205.
 *
 * Both halves below are measurements against the disc, not assertions about it.
 */
const setFilePath = (name: string): string | null => {
  const cd = fileURLToPath(new URL("../gamefiles/dustcd", import.meta.url));
  if (!existsSync(cd)) return null;
  for (const folder of readdirSync(cd)) {
    const p = join(cd, folder, name.toUpperCase());
    if (existsSync(p)) return p;
  }
  return null;
};

test("every shipped save carries its own room's registers and palette", () => {
  const files = dustSaves();
  if (!files.length || !setFilePath("NITE.SET")) {
    console.warn(`no ${SAVE_DIR} — skipping (needs the Dust rip)`);
    return;
  }
  let checked = 0;
  for (const f of files) {
    const bytes = new Uint8Array(readFileSync(join(SAVE_DIR, f)));
    const save = parseSaveV1(bytes);
    const path = save?.standpoint.setFile ? setFilePath(save.standpoint.setFile) : null;
    if (!save || !path) continue;
    checked++;
    const raw = readSaveFile(bytes);
    const c1 = new DataView(raw.containers[1].data.buffer, raw.containers[1].data.byteOffset);
    const set = readSetFileV1(new Uint8Array(readFileSync(path)));
    expect.soft([c1.getUint32(404, true), c1.getUint32(416, true)], `${f}: the registers of ${save.standpoint.setFile}`)
      .toEqual([set.transitionRegister, set.actorRegister]);
    // ...and the live CLUT is palette 0 of that same room, except black and
    // white — the two slots Windows reserves, which the engine always holds
    const clut = raw.containers[0].data.subarray(0xa0c, 0xa0c + 2048);
    const want = new Uint8Array(set.paletteRaw.subarray(0, 2048));
    const dvW = new DataView(want.buffer);
    dvW.setInt16(0, 0, true); dvW.setInt16(2, 0, true); dvW.setInt16(4, 0, true); dvW.setInt16(6, 0, true);
    dvW.setInt16(255 * 8, 255, true);
    for (let o = 2; o < 8; o += 2) dvW.setInt16(255 * 8 + o, -1, true);
    const first = [...clut].findIndex((v, i) => v !== want[i]);
    expect.soft(first, `${f}: the CLUT is ${save.standpoint.setFile}'s palette`).toBe(-1);
    // ...and the camera the actor projection looks through is that room's too:
    // its eye height and setback (c1+430/+428), and the eye trio the formula
    // the writer uses — cell centre pushed back 64 along the facing (see the
    // room-move test below). Held by all 61 shipped saves before it was code.
    expect
      .soft([c1.getInt16(428, true), c1.getInt16(430, true)], `${f}: the camera of ${save.standpoint.setFile}`)
      .toEqual([set.cameraSetback, set.eyeHeight]);
    const sp = save.standpoint;
    let ex = sp.cellX * 256 + 128;
    let ey = sp.cellZ * 256 + 128;
    if (sp.facing === 1) ey += set.cameraSetback;
    else if (sp.facing === 2) ey -= set.cameraSetback;
    else if (sp.facing === 3) ex -= set.cameraSetback;
    else if (sp.facing === 4) ex += set.cameraSetback;
    expect
      .soft(
        [c1.getInt16(472, true), c1.getInt16(474, true), c1.getInt16(476, true)],
        `${f}: the projection's eye`,
      )
      .toEqual([ex, ey, set.eyeHeight]);
  }
  expect(checked, "saves whose room is on the disc").toBeGreaterThan(20);
});

test("moving a save to another room takes that room's registers and palette with it", () => {
  const base = join(SAVE_DIR, "D1E_006.RTD");
  const room = setFilePath("MAYUPPER.SET");
  if (!existsSync(base) || !room) {
    console.warn(`no ${base} — skipping (needs the Dust rip)`);
    return;
  }
  const raw = readSaveFile(new Uint8Array(readFileSync(base)));
  const set = readSetFileV1(new Uint8Array(readFileSync(room)));
  const standpoint = {
    set: "mayupper", setFile: "mayupper.set",
    cellX: 1, cellZ: 1, facing: 1, deg: 192, camX: 384, camY: 384,
  };
  const patch = {
    numGlobals: new Map<string, number>(), strGlobals: new Map<string, string>(), standpoint,
  };

  // WITHOUT the room's own values, which is what shipped: the night town's
  // registers survive into a 205-container file, and 259 is not one of them
  const stale = readSaveFile(applyPatchV1(raw, patch));
  const dvStale = new DataView(stale.containers[1].data.buffer, stale.containers[1].data.byteOffset);
  expect([dvStale.getUint32(404, true), dvStale.getUint32(416, true)], "nite.set's registers, left behind")
    .toEqual([272, 259]);

  // ...and with them
  const bytes = applyPatchV1(raw, {
    ...patch,
    openSet: {
      transitionRegister: set.transitionRegister,
      actorRegister: set.actorRegister,
      eyeHeight: set.eyeHeight,
      cameraSetback: set.cameraSetback,
      clut: set.paletteRaw,
    },
  });
  const out = readSaveFile(bytes);
  const dv1 = new DataView(out.containers[1].data.buffer, out.containers[1].data.byteOffset);
  expect([dv1.getUint32(404, true), dv1.getUint32(416, true)], "mayupper.set's own registers")
    .toEqual([set.transitionRegister, set.actorRegister]);
  /*
   * The camera the actor projection looks through (c1+428/430 and the eye trio
   * at +472/474/476). mayupper's eye stands 130 above the floor where the night
   * town's stood 62; left stale, every restored character in the room hangs the
   * difference up the wall (#320). The eye pair is the cell centre pushed back
   * along the facing — facing 1 looks north, so the eye is 64 south of centre.
   */
  expect([dv1.getInt16(428, true), dv1.getInt16(430, true)], "mayupper's camera setback and eye height")
    .toEqual([set.cameraSetback, set.eyeHeight]);
  expect(
    [dv1.getInt16(472, true), dv1.getInt16(474, true), dv1.getInt16(476, true)],
    "the projection's eye: cell (1,1) centre, set back 64 along facing 1, at mayupper's height",
  ).toEqual([384, 384 + set.cameraSetback, set.eyeHeight]);
  expect(set.actorRegister, "which are inside a 205-container file").toBeLessThan(set.file.containers.length);

  // the palette came too, with the two reserved slots the engine keeps
  const clut = out.containers[0].data.subarray(0xa0c, 0xa0c + 2048);
  expect([...clut.subarray(8, 2040)], "the room's colours")
    .toEqual([...set.paletteRaw.subarray(8, 2040)]);
  const dv0 = new DataView(clut.buffer, clut.byteOffset);
  expect([dv0.getInt16(0, true), dv0.getInt16(2, true)], "entry 0 is black").toEqual([0, 0]);
  expect([dv0.getInt16(255 * 8, true), dv0.getInt16(255 * 8 + 2, true)], "entry 255 is white").toEqual([255, -1]);
  // and the standpoint still says what it said
  expect(parseSaveV1(bytes)!.standpoint.setFile, "the room").toBe("mayupper.set");
});

/** one turn of the microtask queue, for a dispatch that is not awaited */
const drain = (): Promise<void> => new Promise<void>((r) => setImmediate(r));

/** a session with the disc behind it, at the version Dust boots at */
function bareSession(): GameSession {
  const session = new GameSession((n) => {
    const path = `${DATA_DIR}/${n.toUpperCase()}`;
    return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
  }, new NullAudioSink());
  session.onLog = () => {};
  session.dfVersion = 1;
  return session;
}

/**
 * Every global a session holds survives being written and read back (#357).
 *
 * The oracle this fix was built against, kept as a test because it is the only
 * thing that says when the writer is honest. Counting the writer's own `onDrop`
 * reports is not enough: on master those named 31 rungs of the playthrough, and
 * the round trip below found 22 rungs losing 164 globals — the difference being
 * everything that was written to a slot no reader would look at.
 *
 * Three separate faults were in that gap, and each one is invisible without the
 * comparison:
 *
 *  - `newVarRecord` never fixed the PREVIOUS node's vtable, which is what
 *    validates the new name, so on a base whose list ends on a junk one every
 *    new record was written to the same invisible slot. Five calls in a row
 *    answered 3132 on `D1E_001.RTD` and the record count never moved.
 *  - the writer patched the FIRST slot a duplicated name decodes at and
 *    `parseSaveV1` keeps the LAST, so `mwifelike` came back as the other copy.
 *  - `poolIntern` refuses to allocate unless the pool header and container agree
 *    on the size, and `BLDSTPZ.RTD`'s disagree by its own alignment padding.
 *
 * Loading and immediately writing back is the weakest form of this — the
 * playthrough exercises sessions that have grown well past their base — but it
 * is the form that needs no route, and it catches all three.
 */
test("a save carries every global the session holds", async () => {
  if (!existsSync(DATA_DIR) || !existsSync(SAVE_DIR)) {
    console.warn(`no ${DATA_DIR} — skipping (needs the Dust rip)`);
    return;
  }
  const files = readdirSync(SAVE_DIR).filter((n) => /\.rtd$/i.test(n)).sort();
  expect(files.length, "shipped saves to round trip").toBeGreaterThan(20);

  const bad: string[] = [];
  for (const file of files) {
    const session = bareSession();
    const bytes = new Uint8Array(readFileSync(join(SAVE_DIR, file)));
    expect(await session.loadGame(bytes), `${file} loads`).toBe(true);

    /*
     * Grow the session past its base before writing, because otherwise this
     * proves nothing.
     *
     * Since #344 a load PRUNES the globals to exactly what the file carries, so
     * a session that has only just loaded holds nothing the base has no record
     * for — every name round trips by construction and a broken writer sails
     * through. Real play is the opposite: rooms and puzzles declare as they go,
     * and by the middle of the game a session holds 150-odd against a base built
     * for 92 to 142.
     *
     * So stand in for that. Forty numbers and ten strings is past every shipped
     * base's ceiling (94 to 160 over the 56 files, 2 to 18 free nodes each), which
     * is what makes the recycling, the node growth and the pool all run. The names
     * are short enough to sit in the 12-byte field and long enough not to collide
     * with the game's own.
     */
    for (let i = 0; i < 40; i++) session.interp.globals.set(`zzprobe${i}`, 1000 + i);
    for (let i = 0; i < 10; i++) session.interp.globals.set(`zzstr${i}`, `probe-${i}`);

    const live = new Map<string, string | number>();
    for (const [k, v] of session.interp.globals) {
      // `__` names are the port's own bookkeeping and no save's to carry
      if (!k.startsWith("__") && (typeof v === "number" || typeof v === "string")) live.set(k, v);
    }
    session.saveTemplate = () => bytes;
    const written = await snapshotSaveV1(session);
    if (!written) {
      bad.push(`${file}: nothing written`);
      continue;
    }
    /*
     * Compared through an actual LOAD, not through the parsed maps.
     *
     * A save can hold one name twice with different tags — `parseSaveV1` files
     * those in `numGlobals` AND `strGlobals`, and picking one map over the other
     * answers a question the game never asks. `loadGameV1` restores the numbers
     * and then the strings, so the string wins; a checker that reads `numGlobals`
     * first disagrees with the engine and reports losses that are not there.
     * Titanic's `coalchute` is exactly that shape — `num=0` and `str="coal4"` in
     * the shipped file — and an earlier version of this comparison called it a
     * bug (#361, closed as not one) before the reload settled it.
     *
     * So the oracle is the session: write the file, load it into a fresh one, and
     * ask what it is holding. That is the only resolution that matters.
     */
    const reloaded = bareSession();
    expect(await reloaded.loadGame(written), `${file} reloads`).toBe(true);
    for (const [name, want] of live) {
      const got = reloaded.interp.globals.get(name);
      if (got !== want) bad.push(`${file}: ${name} ${JSON.stringify(want)} -> ${JSON.stringify(got)}`);
    }
  }
  expect(bad, `${bad.length} global(s) did not survive the round trip`).toEqual([]);
});

/**
 * A load drops the globals the file does not carry (#344).
 *
 * The variable records are the engine's WHOLE list, not a patch over the live
 * session, so a global with no record did not exist when the save was taken. A
 * room normally clears its own with `dumpglobal` from a teardown; a load runs no
 * scripts, so without this the abandoned game's value stands under a file that
 * never mentioned it.
 *
 * The name below is chosen from the measurement rather than invented: of the 170
 * globals across the 56 shipped saves, 79 are carried by some and not others, and
 * `juglevel` is one of the puzzle counters in that set.
 */
test("a load drops the globals the file does not carry (#344)", async () => {
  if (!existsSync(DATA_DIR) || !existsSync(join(SAVE_DIR, "D1E_001.RTD"))) {
    console.warn(`no ${DATA_DIR} — skipping (needs the Dust rip)`);
    return;
  }
  const bytes = new Uint8Array(readFileSync(join(SAVE_DIR, "D1E_001.RTD")));
  const carried = parseSaveV1(bytes);
  const absent = [...["juglevel", "borrowgun", "blackout", "bottles"]].filter(
    (n) => !carried.numGlobals.has(n) && !carried.strGlobals.has(n),
  );
  expect(absent.length, "the save is silent about at least one puzzle global").toBeGreaterThan(0);

  const session = bareSession();
  // stand in for the game that is being abandoned
  for (const name of absent) session.interp.globals.set(name, 4242);
  session.interp.globals.set("__port_only", 7);
  expect(await session.loadGame(bytes), "the save loads").toBe(true);

  const still = absent.filter((n) => session.interp.globals.has(n));
  expect(still, "no global the file is silent about survives the load").toEqual([]);
  // ...and the port's own bookkeeping is not the file's to speak for
  expect(session.interp.globals.get("__port_only"), "`__` names are left alone").toBe(7);
  // what the file DOES carry is still there
  const [name, value] = [...carried.numGlobals][0];
  expect(session.interp.globals.get(name), `${name} restored`).toBe(value);
});

/**
 * A load stops the scripts the abandoned game was running (#344, second half).
 *
 * A suspended script is suspended inside a builtin, and the teardown in
 * `loadGameV1` RELEASES those without stopping them — so before
 * `abandonRunning()` the next statement ran in a game that no longer existed,
 * against globals the load had just replaced.
 *
 * A movie stands in for the suspension because it is the one this is reported
 * through: `onPlayMovie` returns a promise the test holds open, and
 * `onAbandonMovie` is what the loader calls to release it.
 */
test("a load stops the script the abandoned game was running (#344)", async () => {
  if (!existsSync(DATA_DIR) || !existsSync(join(SAVE_DIR, "D1E_001.RTD"))) {
    console.warn(`no ${DATA_DIR} — skipping (needs the Dust rip)`);
    return;
  }
  const session = bareSession();
  const played: string[] = [];
  let release: (() => void) | null = null;
  session.modalMovies = true;
  session.onPlayMovie = (name: string) => {
    played.push(name.toLowerCase());
    return new Promise<void>((r) => {
      release = r;
    });
  };
  session.onAbandonMovie = () => {
    const r = release;
    release = null;
    r?.();
  };

  // two films back to back: the load lands between them, and the second is the
  // statement that must never run
  const source = `code probe ()\n\tplaymovie ("first.mov")\n\tplaymovie ("second.mov")\nendcode\n`;
  const inst = new ScriptInstance("probe", parseScript(decodeScript(compileScript(source))));
  const running = session.track(session.interp.runHandler(inst, "probe", [], { me: "probe", target: "probe" }));
  for (let i = 0; i < 500 && !release; i++) await drain();
  expect(played, "parked in the first film").toEqual(["first.mov"]);
  expect(session.scriptBusy, "and the session knows a script is running").toBe(true);

  expect(await session.loadGame(new Uint8Array(readFileSync(join(SAVE_DIR, "D1E_001.RTD")))), "loads").toBe(true);
  for (let i = 0; i < 500; i++) await drain();

  expect(played, "the script did not run on into its second film").toEqual(["first.mov"]);
  expect(
    await Promise.race([running.then(() => true), drain().then(() => false)]),
    "the dispatch came back",
  ).toBe(true);
  expect(session.scriptBusy, "and nothing is left running").toBe(false);
});
