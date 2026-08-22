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
import { readSaveFile, writeSaveFile } from "@dreamfactory/engine/df/savegame";
import { applyPatchV1, parseSaveV1 } from "@dreamfactory/engine/df/savegame-v1";
import { shippedDustSaves } from "../src/saves";

const SAVE_DIR = join(process.cwd(), "gamefiles", "dust", "save");

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
    // 18 in all five: the writer emits a fixed sequence, as TI.EXE's does
    expect.soft(raw.containers.length, `${f}: container count`).toBe(18);
  }
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
 * Named as a constant because it is the ONE region a rewrite is allowed to
 * differ in: everything before it is header and live table, everything after it
 * is container data, and both have to come back exactly.
 */
const TABLE_SLACK_START = 1024 + 18 * 4;
const DATA_START = 1536;

test("rewriting a Dust save reproduces every byte the loader reads", () => {
  const files = dustSaves();
  if (!files.length) return;
  for (const f of files) {
    const bytes = new Uint8Array(readFileSync(join(SAVE_DIR, f)));
    const out = writeSaveFile(readSaveFile(bytes));
    expect.soft(out.length, `${f}: length`).toBe(bytes.length);
    const stray: number[] = [];
    for (let i = 0; i < Math.min(out.length, bytes.length); i++) {
      if (out[i] === bytes[i]) continue;
      if (i >= TABLE_SLACK_START && i < DATA_START) continue; // the heap junk, above
      stray.push(i);
    }
    // Every byte of the header, of the 18 live table entries, and of all 18
    // containers — reproduced. A regression here means the framing moved.
    expect.soft(stray.slice(0, 8), `${f}: bytes changed outside the table slack`).toEqual([]);
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
  const base = readSaveFile(new Uint8Array(readFileSync(join(SAVE_DIR, "START.RTD"))));
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
    props: [{ name: "Bone", owner: "stranger", view: "large", visible: true, scale: 1200, dist: -1 }],
    actors: [{ name: "Leroy", owner: "stranger", pose: "grunt", deg: 64, star: "town.leroy1", set: "town" }],
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
  expect.soft([after.standpoint.cellX, after.standpoint.cellZ], "cell").toEqual([2, 5]);
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
  // the loop table is rewritten whole, so the base's nine are gone
  expect.soft(after.loops.length, "loops").toBe(1);
  expect.soft(after.loops[0], "the one loop").toEqual({
    kind: "scene",
    name: "scene a2",
    handler: "apothfx",
    period: 5,
  });
  // and nothing else moved: the file is still the same shape it was
  expect.soft(after.raw.containers.length, "containers").toBe(before.raw.containers.length);
  expect.soft(after.actors.length, "cast size").toBe(before.actors.length);
  expect.soft(after.props.length, "prop count").toBe(before.props.length);
  expect.soft(after.castFiles, "cast files").toEqual(before.castFiles);
});

/** the shipped saves, read for the story they tell — a canary on every offset in
 *  the record at once, because these are the values the game itself produced */
test("the shipped saves decode to the game they came from", () => {
  const files = dustSaves();
  if (!files.length) return;
  const read = (f: string) => parseSaveV1(new Uint8Array(readFileSync(join(SAVE_DIR, f))));

  const start = read("START.RTD");
  expect.soft(start.title, "title").toBe("dust 0.3");
  // a fresh game: day 1, five dollars, the street outside at the south edge
  expect.soft(start.numGlobals.get("day"), "day").toBe(1);
  expect.soft(start.numGlobals.get("playercash"), "cash").toBe(5);
  expect.soft(start.standpoint.set, "set").toBe("town");
  expect.soft([start.standpoint.cellX, start.standpoint.cellZ], "cell").toEqual([6, 14]);
  expect.soft(start.standpoint.view, "view").toBe("north");
  // the camera stands at the centre of that cell
  expect.soft(start.standpoint.camX, "camX").toBe(6 * 256 + 128);
  expect.soft(start.standpoint.camY, "camY").toBe(14 * 256 + 128);

  // GOTBONE is the save taken holding the bone, and the record says so twice
  const gotbone = read("GOTBONE.RTD");
  expect.soft(gotbone.strGlobals.get("handitem"), "handitem").toBe("Bone");
  const bone = gotbone.props.find((p) => p.name === "Bone");
  expect.soft(bone?.owner, "who owns the bone").toBe("stranger");
  expect.soft(bone?.visible, "and it is on screen").toBe(true);

  // AFTERDOG is after giving it away: the ring, and the story one phase on
  const afterdog = read("AFTERDOG.RTD");
  expect.soft(afterdog.strGlobals.get("handitem"), "handitem").toBe("ring");
  expect.soft(afterdog.numGlobals.get("phase"), "phase").toBe(2);
  expect.soft(afterdog.props.find((p) => p.name === "Ring")?.owner, "the ring").toBe("stranger");

  // HELP was taken with a conversation open, which is why it has an extra file
  expect.soft(read("HELP.RTD").puppet, "the open puppet").toBe("help1.pup");

  /*
   * The room every one of them reopens is the NIGHT town, not the day one.
   *
   * Both files call themselves "town" inside, so the name field cannot tell them
   * apart — and the name is what a load used to trust, which brought a midnight
   * save back at noon with the day palette over it.
   */
  for (const f of files) {
    const save = read(f);
    expect.soft(save.standpoint.set, `${f} set name`).toBe("town");
    expect.soft(save.standpoint.setFile, `${f} set file`).toBe("nite.set");
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
  const dog = read("DOG.RTD").actors.find((a) => a.name === "dog");
  expect.soft([dog?.x, dog?.y, dog?.z], "the dog's world position").toEqual([1620, 2748, 0]);
  // and its scale, without which the draw list skips it entirely
  expect.soft(dog?.scale, "the dog's scale").toBe(880);
  /*
   * `actorturn` and `actorspeed`, on the scale the LIVE game runs at: the port's
   * script-driven boot puts Leroy, the dog and the horse at speed 3 / turn 7 and
   * the pig's group at turn 16, and these are the fields that agree with it. The
   * pair at +78/+80 does not — 32, 64, 100 and a uniform 100 — which is an order
   * of magnitude out and had every restored walker sprinting.
   */
  expect.soft([dog?.speed, dog?.turn], "the dog's speed and turn").toEqual([3, 7]);
  const pig = read("DOG.RTD").actors.find((a) => a.name === "pig");
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
  const afterWalks = read("AFTERDOG.RTD").walks;
  expect.soft(afterWalks.map((w) => w.actor).sort(), "who was walking").toEqual(["Help", "Jones"]);
  const jones = afterWalks.find((w) => w.actor === "Jones")!;
  expect.soft(jones.star, "where to").toBe("town.jones2");
  expect.soft([jones.startX, jones.startY], "from").toEqual([1736, 2488]);
  expect.soft([jones.dx, jones.dy], "delta").toEqual([-112, -616]);
  expect.soft(jones.dist, "distance").toBe(626);
  // 626 - 111 remaining; the field holds what is LEFT, the port wants what is done
  expect.soft(jones.progress, "covered").toBe(515);
  // and now the reconstruction: start + delta x (covered/dist) has to be where
  // the cast record says he is standing, to the pixel
  // TRUNCATED, not rounded — rounding puts him at x=1644 where the cast record
  // says 1643, which is the same fix-point truncation the projection uses
  const at = (s: number, d: number) => Math.floor(s + d * (jones.progress / jones.dist));
  const jonesActor = read("AFTERDOG.RTD").actors.find((a) => a.name === "Jones")!;
  expect.soft([at(jones.startX, jones.dx), at(jones.startY, jones.dy)], "predicted position").toEqual([
    jonesActor.x,
    jonesActor.y,
  ]);

  // the four saves taken with nobody walking say so — a slot whose active word is
  // clear holds the LAST walk it ran, not a live one
  for (const f of ["START.RTD", "DOG.RTD", "GOTBONE.RTD"]) {
    expect.soft(read(f).walks.length, `${f}: walks in flight`).toBe(0);
  }

  // the frame counter orders them by when they were taken
  const frames = ["START.RTD", "DOG.RTD", "HELP.RTD", "GOTBONE.RTD", "AFTERDOG.RTD"].map((f) => read(f).frame);
  expect.soft(frames, "frames in play order").toEqual([...frames].sort((a, b) => a - b));
});
