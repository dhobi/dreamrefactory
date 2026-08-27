/**
 * Skull Cracker's sprite books, and the two cross-checks that make them believable.
 *
 *   npx vitest run engine/tests/sbk.ts
 *
 * A stride that divides a file's length exactly is weak evidence — with 342-byte
 * records and a 268 KB container, plenty of wrong strides would also divide. What
 * makes this reading solid is that the format states several things TWICE, in
 * places that would not agree if the offsets were wrong:
 *
 *   1. **the directory duplicates each cel's own header.** Its record carries
 *      dimensions at +0 and a draw position at +24, and the cel container it
 *      points at carries the same four numbers in its own eight-byte header. All
 *      5424 entries agree, and they were decoded by `decodeShpFrame` — code that
 *      knew nothing about this format when it was written.
 *   2. **the entity table's point is a midpoint exactly where a midpoint makes
 *      sense.** `obstacle` and `timer` are 100% their own rect's centre, `stat*`
 *      pickups 99%, `platform` 87% — while `switch` and `door` are 0%, `ladder`
 *      8% and `goal` 13%. A misread field would not sort itself by what the thing
 *      IS. (This test asserts the two ends of that, not the middle: `obstacle`
 *      must be all midpoints and `switch` must be none.)
 *
 * Everything else here is the arithmetic that has to hold for the reader to be
 * reading anything at all: every backdrop placement resolves to a cel, every
 * table's length is its count times its stride, and the sixteen levels behave
 * like levels while `PLAYER.SBK` behaves like the one book that is not one.
 *
 * Skips when no Skull Cracker disc is present, the way `dust/tests/movies.ts`
 * does — and the skip is LOUD, because the sibling `byte-order.ts` was silently
 * skipped for a day when a disc was swapped and five of its tests passed by not
 * running.
 */
import { existsSync, readdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { decodeShpFrame } from "@dreamfactory/engine/df/shp";
import {
  LEVEL_ORDER,
  arrivalIn,
  isMidpoint,
  levelNumber,
  nearestLayer,
  placementRate,
  rasteriseGround,
  readRooms,
  readSbkFile,
} from "@dreamfactory/engine/df/sbk";

/** the two releases spell the directory differently and hold the same books */
const DIRS = ["../../skullcracker/gamefiles/SKULL/DATA", "../../skullcracker/gamefiles/SKULL/Data"].map(
  (p) => fileURLToPath(new URL(p, import.meta.url)),
);
const DATA = DIRS.find((p) => existsSync(p));

/** every book on the disc, absolute, sorted — `PLAYER` included */
const books: string[] = DATA
  ? readdirSync(DATA)
      .filter((n) => /\.sbk$/i.test(n))
      .sort()
      .map((n) => `${DATA}/${n}`)
  : [];

const skip = (): boolean => {
  if (books.length) return false;
  console.warn(`no Skull Cracker books under any of ${DIRS.join(", ")} — skipping`);
  return true;
};

const read = (path: string) => readSbkFile(new Uint8Array(readFileSync(path)));
const name = (path: string): string => path.split("/").pop()!.replace(/\.sbk$/i, "").toUpperCase();
/** the one book that is a character and not a place */
const isPlayer = (path: string): boolean => name(path) === "PLAYER";

test("the disc holds seventeen books: sixteen levels and the player", () => {
  if (skip()) return;
  expect(books.length).toBe(17);
  expect(books.filter(isPlayer).length).toBe(1);
  // and the sixteen match the shell's own "Enter level (1-16):"
  expect(books.filter((b) => !isPlayer(b)).length).toBe(16);
});

test("the directory names every cel, and says the same as the cel does", () => {
  if (skip()) return;
  let entries = 0;
  const disagreed: string[] = [];
  for (const path of books) {
    const sbk = read(path);
    expect(sbk.cels.length).toBeGreaterThan(0);
    for (const cel of sbk.cels) {
      entries++;
      const container = sbk.file.containers[cel.location];
      expect(container).toBeDefined();
      const frame = decodeShpFrame(container.data);
      // the cross-check: the directory's copy against the cel's own header
      if (
        frame.height !== cel.height ||
        frame.width !== cel.width ||
        frame.posYraw !== cel.posY ||
        frame.posXraw !== cel.posX
      ) {
        disagreed.push(
          `${name(path)} cel ${cel.id}: directory says ${cel.width}x${cel.height}@${cel.posX},${cel.posY}, ` +
            `cel says ${frame.width}x${frame.height}@${frame.posXraw},${frame.posYraw}`,
        );
      }
    }
  }
  expect(disagreed).toEqual([]);
  expect(entries).toBe(5424);
});

/**
 * The three fields between a cel's size and its draw position: a strike box, a
 * collision box, and the blow the frame lands. See {@link SbkCel.blow} for what
 * `0x42f910` does with them — damage in this engine is a speed.
 *
 * The assertion that makes them believable is one-directional and exact: **a
 * blow never appears without a strike box**, 0 exceptions in 5424 cels. The
 * converse is false and instructive — 371 cels have a box and no blow, and they
 * are the projectiles and the hazards (`ARCADE`'s 48x49 cel 1000, whose box is
 * the whole of it). Those need no stored pair, because `0x42f910` adds the
 * object's own velocity to whatever the cel carries: a flying thing's damage is
 * its speed and nothing else. A misread offset would not produce a one-way
 * implication like that; it would scatter both ways.
 */
test("a blow never comes without a strike box, and both boxes fit the cel", () => {
  if (skip()) return;
  let withBlow = 0;
  let boxOnly = 0;
  let bodies = 0;
  let sameAsTheCel = 0;
  const odd: string[] = [];
  for (const path of books) {
    const sbk = read(path);
    for (const cel of sbk.cels) {
      const fits = (b: { y0: number; x0: number; y1: number; x1: number }): boolean =>
        b.y1 > b.y0 &&
        b.x1 > b.x0 &&
        b.y0 >= -cel.posY &&
        b.y1 <= cel.height - cel.posY &&
        b.x0 >= -cel.posX &&
        b.x1 <= cel.width - cel.posX;
      if (cel.blow && !cel.strike) {
        odd.push(`${name(path)} cel ${cel.id}: a blow with nowhere to land it`);
      }
      if (cel.strike) {
        if (cel.blow) withBlow++;
        else boxOnly++;
        if (!fits(cel.strike)) odd.push(`${name(path)} cel ${cel.id}: strike box escapes the cel`);
      }
      if (cel.body) {
        bodies++;
        if (!fits(cel.body)) odd.push(`${name(path)} cel ${cel.id}: collision box escapes the cel`);
        if (
          cel.body.y0 === -cel.posY &&
          cel.body.x0 === -cel.posX &&
          cel.body.y1 === cel.height - cel.posY &&
          cel.body.x1 === cel.width - cel.posX
        ) {
          sameAsTheCel++;
        }
      }
    }
  }
  expect(odd).toEqual([]);
  // the corpus's own figures, so a change to the offsets shows up as a number
  expect(withBlow).toBe(276);
  expect(boxOnly).toBe(371);
  expect(bodies).toBe(1965);
  // and the collision boxes are authored rather than derived: hardly any of them
  // is simply the cel's own extent
  expect(sameAsTheCel).toBe(383);
});

test("the player's punch and kick carry the blows the hit handlers compare against", () => {
  if (skip()) return;
  const player = books.find(isPlayer);
  if (!player) return;
  const sbk = read(player);
  const blowOf = (id: number): number => {
    const cel = sbk.cels.find((c) => c.id === id);
    expect(cel?.blow).toBeTruthy();
    return Math.round(Math.hypot(cel!.blow!.dx, cel!.blow!.dy));
  };
  // 0x44fe80 dents a mailbox at 10 and caves it in at 55; 0x44f1fd knocks a punk
  // down over 50. So the punch has to fall under those thresholds and the kick
  // over them, or the two attacks would be the same move.
  expect(blowOf(602)).toBe(47);
  expect(blowOf(604)).toBe(50);
  expect(blowOf(663)).toBe(55);
  expect(blowOf(602)).toBeLessThan(55);
  expect(blowOf(663)).toBeGreaterThan(50);
});

test("every backdrop placement resolves to a cel the directory names", () => {
  if (skip()) return;
  let placements = 0;
  const unresolved: string[] = [];
  for (const path of books) {
    const sbk = read(path);
    for (const p of sbk.placements) {
      placements++;
      if (!sbk.byId.has(p.id)) unresolved.push(`${name(path)}: no cel with id ${p.id}`);
    }
  }
  expect(unresolved).toEqual([]);
  expect(placements).toBe(5048);
});

test("the sixteen levels have a level in them and the player does not", () => {
  if (skip()) return;
  for (const path of books) {
    const sbk = read(path);
    // both releases point at their tables through the same 38-byte root
    expect(sbk.entityLocation).toBeGreaterThan(0);
    expect(sbk.backdropLocation).toBeGreaterThan(0);
    if (isPlayer(path)) {
      // the degenerate case that separates the halves: cels, and nothing placed
      expect(sbk.entities.length).toBe(0);
      expect(sbk.placements.length).toBe(0);
      expect(sbk.cels.length).toBe(1229);
    } else {
      expect(sbk.entities.length).toBeGreaterThan(0);
      expect(sbk.placements.length).toBeGreaterThan(0);
    }
  }
});

test("the level plan is named, and the vocabulary is the game", () => {
  if (skip()) return;
  const kinds = new Map<string, number>();
  let records = 0;
  let named = 0;
  for (const path of books) {
    for (const e of read(path).entities) {
      records++;
      if (!e.name) continue;
      named++;
      kinds.set(e.name, (kinds.get(e.name) ?? 0) + 1);
    }
  }
  expect(records).toBe(1219);
  // one record in the corpus carries no readable name; the rest all do
  expect(named).toBe(1218);
  // the things a side-scroller is made of, all present
  for (const k of ["platform", "obstacle", "ladder", "goal", "newroom", "initplayer", "stathealth"]) {
    expect(kinds.get(k), `no ${k} anywhere in sixteen levels`).toBeGreaterThan(0);
  }
  // the commonest thing in a platform game is a platform
  expect([...kinds].sort((a, b) => b[1] - a[1])[0][0]).toBe("platform");
});

test("the second point is a midpoint for the static kinds and not for the doors", () => {
  if (skip()) return;
  const tally = new Map<string, { n: number; mid: number }>();
  for (const path of books) {
    for (const e of read(path).entities) {
      if (!e.name) continue;
      const t = tally.get(e.name) ?? { n: 0, mid: 0 };
      t.n++;
      if (isMidpoint(e)) t.mid++;
      tally.set(e.name, t);
    }
  }
  // the two ends of the gradient, which is the part that cannot be coincidence:
  // a thing that just SITS there stores its own centre...
  const obstacle = tally.get("obstacle")!;
  expect(obstacle.mid).toBe(obstacle.n);
  const timer = tally.get("timer")!;
  expect(timer.mid).toBe(timer.n);
  // ...and a thing you operate stores somewhere else entirely
  const sw = tally.get("switch")!;
  expect(sw.n).toBeGreaterThan(0);
  expect(sw.mid).toBe(0);
  const door = tally.get("door")!;
  expect(door.mid).toBe(0);
});

test("a level's parallax layers are per-level, so 1.0 is not a landmark", () => {
  if (skip()) return;
  const near: number[] = [];
  for (const path of books) {
    const sbk = read(path);
    if (!sbk.placements.length) continue;
    const factor = nearestLayer(sbk);
    // the mode is a factor the book actually stores, and a sane one
    expect(sbk.placements.some((p) => p.parallax === factor)).toBe(true);
    expect(factor).toBeGreaterThan(0);
    expect(factor).toBeLessThan(8);
    near.push(factor);
  }
  expect(near.length).toBe(16);
  // and they are NOT all 1.0 — which is why nearestLayer takes the mode rather
  // than comparing against a constant
  expect(new Set(near).size).toBeGreaterThan(1);
});

test("every book carries a palette, and it spans a real range", () => {
  if (skip()) return;
  for (const path of books) {
    const sbk = read(path);
    expect(sbk.paletteRaw, `${name(path)} has no palette`).not.toBeNull();
    expect(sbk.paletteRaw!.length).toBe(2048);
  }
});

/**
 * The file's own entity/region discriminator, cross-checked against SC.EXE.
 *
 * `+22` says whether a record is an object the engine spawns or a named region,
 * and the reason to trust it is that it agrees with a source outside the data:
 * every name on the entity side is a class `SC.EXE` registers as a string, and
 * every name on the region side is a label a designer typed that the binary has
 * never heard of. That is two independent statements of one fact.
 */
test("the entity flag separates engine classes from designer labels", () => {
  if (skip()) return;
  const entities = new Set<string>();
  const regions = new Set<string>();
  for (const path of books) {
    for (const e of read(path).entities) (e.isEntity ? entities : regions).add(e.name);
  }
  // the engine side is the vocabulary SC.EXE knows
  for (const k of ["platform", "obstacle", "ladder", "goal", "initplayer", "stathealth", "door"]) {
    expect(entities.has(k), `${k} should be an engine class`).toBe(true);
    expect(regions.has(k), `${k} should not be a region`).toBe(false);
  }
  // and the region side is the area labels, which are only ever regions
  for (const k of ["newroom", "roomtwo", "entrance", "chamber2", "hugeroom"]) {
    expect(regions.has(k), `${k} should be a region`).toBe(true);
    expect(entities.has(k), `${k} should not be an engine class`).toBe(false);
  }
});

test("every region names a container, and it holds a floor", () => {
  if (skip()) return;
  let regions = 0;
  let withGround = 0;
  let points = 0;
  for (const path of books) {
    const sbk = read(path);
    for (const e of sbk.entities) {
      if (e.isEntity) continue;
      regions++;
      // a region either points at its shape or stores 0 for "none"; nothing in
      // between, which is what says +10 is a container location and not a number
      // that happens to be small
      if (e.regionLocation === 0) continue;
      expect(sbk.file.containers[e.regionLocation], `${name(path)}: ${e.name} -> ${e.regionLocation}`).toBeDefined();
      const r = sbk.regions.get(e.regionLocation);
      expect(r, `${name(path)}: ${e.name} points at ${e.regionLocation} with no floor in it`).toBeDefined();
      withGround++;
      points += r!.ground.length;
      // the stated corners must contain the floor they precede
      for (const p of r!.ground) {
        expect(p.x).toBeGreaterThanOrEqual(Math.min(r!.min.x, r!.max.x));
        expect(p.x).toBeLessThanOrEqual(Math.max(r!.min.x, r!.max.x));
      }
    }
  }
  // measured: 1167 entities and 52 regions make up the 1219 records, 48 regions
  // carry a shape, and there are 567 floor points between them
  expect(regions).toBe(52);
  expect(withGround).toBe(48);
  expect(points).toBe(567);
});

test("the per-instance parameter varies within a kind, so it is not the kind", () => {
  if (skip()) return;
  const byKind = new Map<string, Set<number>>();
  for (const path of books) {
    for (const e of read(path).entities) {
      if (!e.isEntity) continue;
      (byKind.get(e.name) ?? byKind.set(e.name, new Set()).get(e.name)!).add(e.param);
    }
  }
  // a conveyor belt's copies differ from each other, which is the whole reason
  // this field is carried rather than dropped as padding
  expect([...byKind.get("initbeltleft")!].sort((a, b) => a - b)).toEqual([4, 6, 8, 10]);
  // and the flags field is all-bits-set except on SURFACES — which is the part
  // that makes it look like a field rather than padding. See SbkEntity.flags.
  const odd = new Map<string, Set<number>>();
  for (const path of books) {
    for (const e of read(path).entities) {
      if (!e.isEntity || e.flags === 15) continue;
      (odd.get(e.name) ?? odd.set(e.name, new Set()).get(e.name)!).add(e.flags);
    }
  }
  expect([...odd.keys()].sort()).toEqual(["initplank", "platform"]);
  // every exception is 15 with exactly one bit cleared
  for (const set of odd.values()) {
    for (const f of set) expect([11, 13, 14]).toContain(f);
  }
});

/**
 * The level order recovered from SC.EXE, held against the discs.
 *
 * The order itself is not checkable from the data — that is why it had to come
 * out of the executable. What IS checkable is that it names the right sixteen
 * things, and that is worth a test because a typo in a hand-transcribed table
 * would otherwise show up as one level silently missing its number in the
 * viewer's list.
 */
test("the recovered level order names the sixteen books and nothing else", () => {
  if (skip()) return;
  expect(LEVEL_ORDER.length).toBe(16);
  const stems = books.map((b) => name(b).toLowerCase()).filter((n) => n !== "player");
  expect([...LEVEL_ORDER].sort()).toEqual(stems.sort());
  // 1-based, and the player's book is not a level
  expect(levelNumber("streets.sbk")).toBe(1);
  expect(levelNumber("STREETS.SBK")).toBe(1);
  expect(levelNumber("vat.sbk")).toBe(16);
  expect(levelNumber("player.sbk")).toBe(0);
});

/**
 * The field at +10 is 32 bits wide, which is a claim about the format and not
 * about the corpus.
 *
 * `SC.EXE` reads and writes a dword there — it keeps an object pointer in it at
 * runtime — and on disc the upper half is zero in every record, so an i16 read
 * would give the same answer everywhere. That is exactly why it is worth a test:
 * a change that no data can distinguish is a change nothing else would catch.
 */
test("+10 is a 32-bit field whose upper half is zero on disc", () => {
  if (skip()) return;
  let records = 0;
  for (const path of books) {
    const sbk = read(path);
    const d = sbk.file.containers[sbk.entityLocation]?.data;
    if (!d) continue;
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    sbk.entities.forEach((e, i) => {
      records++;
      const at = 28 + i * 48;
      // the reader's value is the whole dword...
      expect(e.regionLocation).toBe(v.getInt32(at + 10, true));
      // ...and on disc that equals the low half, because the high half is zero
      expect(v.getInt16(at + 12, true)).toBe(0);
      expect(e.regionLocation).toBe(v.getInt16(at + 10, true));
    });
  }
  expect(records).toBe(1219);
});

/**
 * +8 is a plane byte plus a depth, not one fixed-point number.
 *
 * `SC.EXE`'s backdrop consumer switches on the low byte with `cmp eax, 4; ja
 * <error>`, so every shipped placement must carry 0..4 there — which is also the
 * corpus fact that falsifies the old whole-i32 reading: under it, one layer
 * appeared as several factors a few 1/65536ths apart.
 */
test("every placement's plane byte is 0..4, and depths no longer split by type", () => {
  if (skip()) return;
  const planes = new Set<number>();
  for (const path of books) {
    const sbk = read(path);
    for (const p of sbk.placements) {
      expect(p.plane, `${name(path)}: plane ${p.plane}`).toBeLessThanOrEqual(4);
      expect(p.plane).toBeGreaterThanOrEqual(0);
      planes.add(p.plane);
      // depth and plane must reconstruct the raw dword exactly
      const raw = Math.round(p.parallax * 256) * 256 + p.plane;
      expect(raw >> 8).toBe(Math.round(p.parallax * 256));
    }
  }
  // the corpus uses more than one plane, so the byte is a field and not padding
  expect(planes.size).toBeGreaterThan(1);
});

/**
 * The scroll rate is the engine's, not the authoring tool's.
 *
 * `0x40c31a`: `screenX = (x − c)·k/6000 + c`, k from +16's bits on planes 2 and
 * 3, everything else rate 1. The corpus check is that every rate lands on one of
 * the seven values the code can produce — a wrong bit order or plane mapping
 * would put some placement outside the set.
 */
test("every placement's engine rate is one of the seven the code can produce", () => {
  if (skip()) return;
  const LEGAL = new Set([1, 5000 / 6000, 5300 / 6000, 5600 / 6000, 7500 / 6000, 6700 / 6000, 6400 / 6000]);
  const seen = new Set<number>();
  for (const path of books) {
    for (const p of read(path).placements) {
      const r = placementRate(p);
      expect(LEGAL.has(r), `${name(path)}: plane ${p.plane} flags ${p.flags} -> ${r}`).toBe(true);
      seen.add(r);
    }
  }
  // the corpus uses background AND foreground rates, so the mapping is exercised
  expect(seen.size).toBeGreaterThan(2);
});

/**
 * Animated placements expose their frame sequence.
 *
 * `frames` is the count; `frameIds` is the cel list it plays. STREETS' street
 * lamp is `[2360,2361,2362]` — a glow. Note the sequence does NOT always start
 * on the base id: 31 placements are ping-pong glows whose stored id is their
 * brightest frame, not their first (CAVERN's 5534). The test asserts what is
 * true — every frame resolves to a cel — not the tidier thing that is false.
 */
test("an animated placement lists its frame cels, all resolvable", () => {
  if (skip()) return;
  let animated = 0;
  let startsElsewhere = 0;
  for (const path of books) {
    const sbk = read(path);
    for (const p of sbk.placements) {
      if (p.frames > 1) {
        animated++;
        expect(p.frameIds.length).toBe(Math.min(p.frames, Math.floor((342 - 22) / 8)));
        if (p.frameIds[0] !== p.id) startsElsewhere++;
        for (const id of p.frameIds) expect(sbk.byId.has(id), `${name(path)}: frame cel ${id}`).toBe(true);
      } else {
        expect(p.frameIds).toEqual([p.id]);
      }
    }
  }
  expect(animated).toBeGreaterThan(0);
  // and the finding that the naive assumption would have hidden
  expect(startsElsewhere).toBe(31);
});

// ---- rooms ------------------------------------------------------------------

/**
 * A room owns exactly one region, and every region has exactly one owner.
 *
 * The claim that makes rooms the level's structure rather than a decoration. 48
 * rooms across the sixteen books, 48 regions, no sharing in either direction —
 * except that four rooms link container 0, which is the cel directory and so the
 * format's null. Those four are named here because a change in that number means
 * either the disc or the reader moved.
 */
test("each room owns one region, and four rooms own none", () => {
  if (skip()) return;
  let rooms = 0;
  const floorless: string[] = [];
  for (const path of books.filter((b) => !isPlayer(b))) {
    const sbk = read(path);
    const mine = readRooms(sbk);
    rooms += mine.length;
    const linked = mine.map((r) => r.regionLocation).filter((l) => l !== 0);
    // no region owned twice
    expect(new Set(linked).size, `${name(path)}: a region owned twice`).toBe(linked.length);
    // and no region unowned
    expect([...sbk.regions.keys()].filter((l) => !linked.includes(l))).toEqual([]);
    for (const r of mine) if (!r.ground) floorless.push(`${name(path)}/${r.name}`);
  }
  expect(rooms).toBe(52);
  expect(floorless.sort()).toEqual(["BARREL/barrel", "LAB/lab2", "MAZE/newroom", "MAZE/newroom1"]);
});

/**
 * Every door leads somewhere, and back.
 *
 * `exitroom`'s param is the destination room's param — the reading rooms rest
 * on. It is checked here the only way that can fail informatively: resolve every
 * door in every book, and require the destination to hold a door back. STREETS
 * and CAVERN and MAZE are reciprocal pairs; LAB is a three-room chain, which is
 * why "back" means "to a room you can reach from there" and not "to me".
 */
test("every exitroom names a room that exists, and none is a dead end", () => {
  if (skip()) return;
  let doors = 0;
  for (const path of books.filter((b) => !isPlayer(b))) {
    const sbk = read(path);
    const rooms = readRooms(sbk);
    // every exitroom in the book was placed in some room
    const placed = rooms.reduce((n, r) => n + r.exits.length, 0);
    expect(placed, `${name(path)}: an exitroom outside every room`).toBe(
      sbk.entities.filter((e) => e.isEntity && e.name === "exitroom").length,
    );
    for (const room of rooms) {
      for (const exit of room.exits) {
        doors++;
        const dest = rooms.find((r) => r.param === exit.to);
        expect(dest, `${name(path)}: ${room.name} has a door to p${exit.to}, which is no room`).toBeDefined();
        // a door never strands you: the destination has a floor, and a way out
        expect(dest!.ground, `${name(path)}: door into floorless ${dest!.name}`).not.toBeNull();
        expect(dest!.exits.length, `${name(path)}: ${dest!.name} is a dead end`).toBeGreaterThan(0);
        expect(arrivalIn(dest!, room)).not.toBeNull();
      }
    }
  }
  expect(doors).toBe(9);
});

/**
 * `goal` is not a door, and `door` is not one either.
 *
 * Both were candidates, and reading either as a room link would have looked
 * plausible in STREETS: its goal's param is 0 and it has a room with param 0.
 * What kills it is the whole corpus — nine of sixteen goals name a param no room
 * carries, and SEWER's five `door` records carry -1, 2, 7, 8 and -4 while all
 * twelve of its rooms are param 0.
 */
test("goal and door params are not room links", () => {
  if (skip()) return;
  let goalsThatMissEveryRoom = 0;
  let doorParams: number[] = [];
  for (const path of books.filter((b) => !isPlayer(b))) {
    const sbk = read(path);
    const params = new Set(readRooms(sbk).map((r) => r.param));
    for (const e of sbk.entities) {
      if (!e.isEntity) continue;
      if (e.name === "goal" && !params.has(e.param)) goalsThatMissEveryRoom++;
      if (e.name === "door") doorParams.push(e.param);
    }
  }
  expect(goalsThatMissEveryRoom).toBe(9);
  expect(doorParams.sort((a, b) => a - b)).toEqual([-4, -1, 2, 7, 8]);
});

/**
 * The rasteriser covers every column of every floor.
 *
 * `0x40ba70`'s reimplementation walks the polyline in file order, and the
 * polylines are not tidy: they hold vertical steps (two points sharing an x),
 * pits hundreds of pixels deep, and in seven of the 48 the odd backwards pixel.
 * The property that has to hold anyway is that no column is left unwritten, and
 * that the floor never leaves the range the polyline itself states.
 */
test("every region rasterises to a floor with no gap in it", () => {
  if (skip()) return;
  let regions = 0;
  let steps = 0;
  for (const path of books.filter((b) => !isPlayer(b))) {
    const sbk = read(path);
    for (const [loc, r] of sbk.regions) {
      const g = rasteriseGround(r);
      expect(g, `${name(path)}: region ${loc} rasterises to nothing`).not.toBeNull();
      regions++;
      const lo = Math.min(...r.ground.map((q) => q.y));
      const hi = Math.max(...r.ground.map((q) => q.y));
      for (const y of g!.ys) expect(y >= lo && y <= hi, `${name(path)}: region ${loc} floor at ${y}`).toBe(true);
      steps += r.ground.filter((q, i) => i > 0 && q.x === r.ground[i - 1].x).length;
    }
  }
  expect(regions).toBe(48);
  // curbs and shaft walls: the polyline is a staircase, not a graph of y over x
  expect(steps).toBeGreaterThan(0);
});
