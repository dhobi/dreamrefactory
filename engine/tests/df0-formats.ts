/**
 * DreamFactory 0 — *Lunicus* (1994): its pictures, sounds, puppet tracks and
 * mazes.
 *
 *   npx vitest run engine/tests/df0-formats.ts
 *
 * The first half builds its own bytes and needs no game. The second reads
 * `lunicus/gamefiles` and skips loudly without it. There the evidence is that
 * every reader is STRICT — a row that does not land on its width, a sound that
 * does not end on its last byte, a track that is not whole keyframes all throw —
 * and still nothing in the rip is left over, and that the formats agree with
 * each other where they overlap: a track has one keyframe per two blocks of the
 * voice line beside it, and a maze's films tile its containers exactly.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { V0_BLOCK_SAMPLES, V0_SAMPLE_RATE, decodeAudioV0 } from "@dreamfactory/engine/df/audio";
import { DFContainerFile, readContainerFile, writeContainerFile } from "@dreamfactory/engine/df/container";
import { FrameBuffer, decodeFrame } from "@dreamfactory/engine/df/image";
import { decodeFigureV0, decodeFrameV0 } from "@dreamfactory/engine/df/image-v0";
import { cellV0, ownsFilmV0, readMazeV0, transitionV0 } from "@dreamfactory/engine/df/maze-v0";
import { movFileFromV0, nextFrameV0, paletteV0, readMovFileV0 } from "@dreamfactory/engine/df/mov-v0";
import { readAnimLogic } from "@dreamfactory/engine/df/pup";
import { TALK_BACKDROP, TALK_FIRST_FRAME, isEmptySlotV0, pupFileFromV0, readPuppetTrackV0, readTalkFileV0 } from "@dreamfactory/engine/df/talk-v0";
import { SAVE_V0_SIZE, isSaveV0, readSaveV0, writeSaveV0 } from "@dreamfactory/engine/df/savegame-v0";

const u16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff];
const i32 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
/** a v0 frame: header, then each row's runs behind their byte length */
const frame = (h: number, w: number, ay: number, ax: number, rows: number[][]): Uint8Array =>
  new Uint8Array([...u16(h), ...u16(w), ...u16(ay), ...u16(ax), ...rows.flatMap((r) => [...u16(r.length), ...r])]);

test("a v0 frame: skip, literal, repeat, and a copy from earlier in the STREAM", () => {
  // row 0: 3 literal (5 6 7), 3 skipped.  row 1: 2 × 9, then 3 bytes copied from
  // row 0's literals, then 1 literal — kind 00 reaches back into the compressed
  // bytes, which is where the 5 6 7 are; the picture above holds them too, but
  // at a different distance, so a copy-the-row-above reading gets 0 0 0.
  const row0 = [(3 << 2) | 3, 5, 6, 7, (3 << 2) | 1];
  // bytes before the offset: header 8, row0's length 2 + 5, row1's length 2,
  // the repeat 2, the kind-00 flag 1, the offset byte 1 → the stream position
  // after the offset is 21, and the 5 sits at 8 + 2 + 1 = 11
  const row1 = [(2 << 2) | 2, 9, (3 << 2) | 0, 21 - 11, (1 << 2) | 3, 4];
  const f = decodeFrameV0(frame(2, 6, 1, 3, [row0, row1]));
  expect([f.width, f.height, f.anchorY, f.anchorX]).toEqual([6, 2, 1, 3]);
  expect([...f.indexed]).toEqual([5, 6, 7, 0, 0, 0, 9, 9, 5, 6, 7, 4]);
  expect([...f.opaque]).toEqual([1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
});

test("a v0 frame is refused when a row misses its width or bytes are left over", () => {
  expect(() => decodeFrameV0(frame(1, 4, 0, 0, [[(3 << 2) | 1]]))).toThrow(/3 of 4/);
  expect(() => decodeFrameV0(frame(1, 2, 0, 0, [[(3 << 2) | 1]]))).toThrow(/overruns/);
  const extra = new Uint8Array([...frame(1, 1, 0, 0, [[(1 << 2) | 1]]), 0]);
  expect(() => decodeFrameV0(extra)).toThrow(/after the last row/);
});

test("a v0 figure: one kind bit, seven count bits", () => {
  const f = decodeFigureV0(frame(1, 5, 0, 0, [[(2 << 1) | 0, (2 << 1) | 1, 0x80, 0x80, (1 << 1) | 0]]));
  expect([...f.indexed]).toEqual([0, 0, 0x80, 0x80, 0]);
  expect([...f.opaque]).toEqual([0, 0, 1, 1, 0]);
});

test("a v0 sound is a block count and a v40 stream, at the device's 22050", () => {
  // one block: a silent first sample, then 369 more as repeat runs (0xc0 | n-1)
  const bytes = new Uint8Array([...u16(1), 0x40, 0xff, 0xff, 0xff, 0xff, 0xff, 0xc0 | 48]);
  const a = decodeAudioV0(bytes);
  expect(a.sampleRate).toBe(V0_SAMPLE_RATE);
  expect(a.samples).toHaveLength(V0_BLOCK_SAMPLES);
  expect(a.samples.every((s) => s === 0)).toBe(true);
});

test("a puppet track reads as 76-byte keyframes of eight layers", () => {
  const key = (tick: number, dirty: number[], layers: number[][]) =>
    [...u16(tick), ...u16(0), ...dirty.flatMap(u16), ...layers.flatMap((l) => l.flatMap(u16))];
  const layers = Array.from({ length: 8 }, (_, i) => [i, 132 + i, 256 - i, 0x59fe]);
  const bytes = new Uint8Array([...key(0, [0, 0, 264, 512], layers), ...key(2, [180, 232, 208, 286], layers)]);
  const t = readPuppetTrackV0(bytes);
  expect(t.map((k) => k.tick)).toEqual([0, 2]);
  expect(t[1].dirty).toEqual({ top: 180, left: 232, bottom: 208, right: 286 });
  expect(t[0].layers[3]).toEqual({ frame: 3, y: 135, x: 253, unknown: 0x59fe });
  expect(() => readPuppetTrackV0(bytes.subarray(1))).toThrow(/whole keyframes/);
});

test("a v0 maze: the grid's facing bytes, and transitions that share films", () => {
  const pose = (x: number, y: number, d: number) => [...u16(x), ...u16(y), ...u16(d)];
  const rec = (from: number[], to: number[], film: number[][], first: number) =>
    [...from, ...to, ...film[0], ...film[1], ...i32(first)];
  const turnA = [pose(0, 0, 0), pose(0, 0, 1)];
  const c0 = new Uint8Array([
    ...rec(turnA[0], turnA[1], turnA, 2), // owns frames 2..
    ...rec(pose(0, 1, 1), pose(0, 2, 1), [pose(0, 1, 1), pose(0, 2, 1)], 5), // owns 5..
    ...rec(pose(1, 1, 0), pose(1, 1, 1), turnA, 2), // borrows the first turn
  ]);
  const grid = new Int32Array(32 * 32).fill(-1);
  grid[0 * 32 + 1] = 0x0f000102; // cell (x 0, y 1)
  const c1 = new Uint8Array([...u16(2), ...u16(3), ...new Uint8Array(grid.buffer)]);
  const frames = Array.from({ length: 6 }, () => ({ id: 0, data: new Uint8Array(8) }));
  const file: DFContainerFile = {
    header: { fourCC: 0x00010000, fileSize: 0, containerCount: 8, type: 0, gapWhere: 0 },
    containers: [{ id: 0, data: c0 }, { id: 1, data: c1 }, ...frames].map((c, i) => ({ ...c, id: i })),
    headerRaw: new Uint8Array(1024),
    order: "le",
  };
  const maze = readMazeV0(readContainerFile(writeContainerFile(file)));
  expect([maze.width, maze.height]).toEqual([2, 3]);
  expect(cellV0(maze, 0, 1)).toEqual([0x0f, 0x00, 0x01, 0x02]);
  expect(cellV0(maze, 0, 0)).toBeNull(); // -1
  expect(cellV0(maze, 2, 0)).toBeNull(); // outside the bounds
  expect(maze.transitions.map((t) => [t.firstFrame, t.frames, ownsFilmV0(t)])).toEqual([
    [2, 3, true],
    [5, 3, true], // the last film runs to the end of the file
    [2, 3, false],
  ]);
  expect(transitionV0(maze, { x: 1, y: 1, dir: 0 }, { x: 1, y: 1, dir: 1 })?.film.from).toEqual({ x: 0, y: 0, dir: 0 });
  expect(transitionV0(maze, { x: 1, y: 1, dir: 0 }, { x: 1, y: 1, dir: 2 })).toBeNull();
});

// ---- the rip ------------------------------------------------------------------

const ROOT = fileURLToPath(new URL("../../lunicus/gamefiles/LUNICUS", import.meta.url));
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const files: string[] = existsSync(ROOT) ? walk(ROOT).filter((f) => /\/(day\d|shared)\//.test(f)).sort() : [];
const missing = files.length === 0;
if (missing) console.warn(`no Lunicus rip at ${ROOT} — skipping`);
const open = (f: string) => readContainerFile(new Uint8Array(readFileSync(f)));
const base = (f: string) => f.split("/").pop()!;
const TALK = /^(raife|sasha|heisenst|mccallum|molotov|guard|queen)\.\d$/;
const SPRITES = /^(jeep|tank|wasp|drone)\.(in|out)$|^(hand|play|node|pyro|panel|puppet)\.$/;
const FIGURES = /^(raife|sasha|heisenst|mccallum|molotov|guard)\.$/;
const MAZES = /^(citymaze|buildmaz|finalmaz|hivemaze|engin1ma|engin2ma|upperbas|lowerbas)\.$/;
const BANKS = /^(citysoun|moonsoun)\.$/;

/** a sound only if it decodes AND its stream ends on the container's last byte */
function isSound(d: Uint8Array): boolean {
  if (d.length < 3) return false;
  let p = 3;
  let n = 1;
  while (p < d.length) {
    const b = d[p++];
    if (!(b & 0x80)) n++;
    else if (!(b & 0x40)) {
      const k = (b & 0x3f) + 1;
      p += k;
      n += 2 * k;
    } else n += (b & 0x3f) + 1;
  }
  return p === d.length && n === (d[0] | (d[1] << 8)) * V0_BLOCK_SAMPLES;
}

test.skipIf(missing)("every sprite, and every figure, decodes exactly", () => {
  let sprites = 0;
  let figures = 0;
  for (const f of files) {
    if (SPRITES.test(base(f))) for (const c of open(f).containers) (decodeFrameV0(c.data), sprites++);
    if (FIGURES.test(base(f))) for (const c of open(f).containers) (decodeFigureV0(c.data), figures++);
  }
  expect(sprites).toBeGreaterThan(0);
  expect(figures).toBeGreaterThan(0);
});

test.skipIf(missing)("a talk file: a 512x264 backdrop anchored at its centre, a run of head frames, then lines", () => {
  const talks = files.filter((f) => TALK.test(base(f)));
  expect(talks.length).toBeGreaterThan(0);
  let pairs = 0;
  let silent = 0;
  for (const f of talks) {
    const cs = open(f).containers;
    const bg = decodeFrameV0(cs[TALK_BACKDROP].data);
    expect([bg.width, bg.height, bg.anchorX, bg.anchorY]).toEqual([512, 264, 256, 132]);
    let i = TALK_FIRST_FRAME;
    while (i < cs.length && !isSound(cs[i].data)) decodeFrameV0(cs[i++].data);
    expect(i - TALK_FIRST_FRAME, f).toBeGreaterThan(10);
    // from here on: voice lines, each track following the line it animates
    for (; i < cs.length; i++) {
      if (!isSound(cs[i].data)) continue;
      const next = cs[i + 1]?.data;
      if (!next || isSound(next)) continue;
      const blocks = cs[i].data[0] | (cs[i].data[1] << 8);
      const track = readPuppetTrackV0(next);
      i++;
      // a rack may have a wave and no puppet (queen.1 has some) — an empty slot
      if (isEmptySlotV0(next)) {
        silent++;
        continue;
      }
      expect(track.length * 2, `${f} #${i}`).toBe(blocks);
      // layer 0 is the backdrop, placed at its anchor
      expect([track[0].layers[0].y, track[0].layers[0].x]).toEqual([132, 256]);
      pairs++;
    }
  }
  expect(pairs).toBeGreaterThan(0);
  // the unanimated lines are the exception, not a reading that fails everywhere
  expect(silent).toBeLessThan(pairs / 10);
});

test.skipIf(missing)("a sound bank is a table and then sounds that end on their last byte", () => {
  const banks = files.filter((f) => BANKS.test(base(f)));
  expect(banks.length).toBeGreaterThan(0);
  for (const f of banks) {
    const cs = open(f).containers;
    for (const c of cs.slice(1)) {
      expect(isSound(c.data), f).toBe(true);
      expect(decodeAudioV0(c.data).samples).toHaveLength((c.data[0] | (c.data[1] << 8)) * V0_BLOCK_SAMPLES);
    }
  }
});

test.skipIf(missing)("a maze's films tile its frames, every borrowed film exists, and every frame is 384x264", () => {
  const mazes = files.filter((f) => MAZES.test(base(f)));
  expect(mazes.length).toBeGreaterThan(0);
  for (const f of mazes) {
    const file = open(f);
    const maze = readMazeV0(file);
    const owners = maze.transitions.filter(ownsFilmV0);
    // the owned films, end to end, are exactly containers 2..the last
    const spans = [...new Map(owners.map((t) => [t.firstFrame, t.frames])).entries()].sort((a, b) => a[0] - b[0]);
    expect(spans[0][0], f).toBe(2);
    for (let k = 1; k < spans.length; k++) expect(spans[k][0]).toBe(spans[k - 1][0] + spans[k - 1][1]);
    expect(spans.at(-1)![0] + spans.at(-1)![1]).toBe(file.containers.length);
    // a borrower plays a film some owner has, from the same first frame
    for (const t of maze.transitions.filter((t) => !ownsFilmV0(t))) {
      const owner = transitionV0(maze, t.film.from, t.film.to);
      expect(owner && ownsFilmV0(owner) && owner.firstFrame === t.firstFrame, `${f} ${JSON.stringify(t)}`).toBe(true);
    }
    // every pose a transition stands on is a cell that is there
    for (const t of maze.transitions) expect(cellV0(maze, t.from.x, t.from.y), `${f} ${JSON.stringify(t.from)}`).not.toBeNull();
    // and the frames, each film decoded as the delta chain it is
    for (const [first, n] of spans) {
      const fb = new FrameBuffer();
      for (let c = first; c < first + n; c++) {
        const r = decodeFrame(file.containers[c].data, fb);
        expect([r.width, r.height]).toEqual([384, 264]);
      }
    }
  }
});

test.skipIf(missing)("a maze's facing byte is 0 exactly where a step forward leaves the cell", () => {
  const DX = [0, 0, 1, -1];
  const DY = [-1, 1, 0, 0];
  for (const f of files.filter((f) => MAZES.test(base(f)))) {
    const maze = readMazeV0(open(f));
    for (let x = 0; x < maze.width; x++) {
      for (let y = 0; y < maze.height; y++) {
        const c = cellV0(maze, x, y);
        if (!c) continue;
        for (let dir = 0; dir < 4; dir++) {
          const step = transitionV0(maze, { x, y, dir }, { x: x + DX[dir], y: y + DY[dir], dir });
          expect(c[dir] === 0, `${f} ${x},${y} facing ${dir}: byte ${c[dir]}, ${step ? "a step" : "no step"}`).toBe(step !== null);
        }
      }
    }
  }
});

test.skipIf(missing)("a film: every frame decodes at the header's size, its hotspots read in full, every sound is a v0 sound, the palette is the Mac way round", () => {
  // previews/ holds other games' demos, whose sounds are not Lunicus's
  const films = files.filter((f) => /\.mov$/.test(f));
  expect(films.length).toBeGreaterThan(0);
  for (const f of films) {
    const film = readMovFileV0(new Uint8Array(readFileSync(f)));
    const fb = new FrameBuffer();
    film.frames.forEach((fr, i) => {
      const r = decodeFrame(film.file.containers[fr.picture].data, fb);
      expect([r.width, r.height], `${f} #${i}`).toEqual([film.width, film.height]);
      if (fr.sound) expect(isSound(film.file.containers[fr.sound].data), `${f} #${i} sound`).toBe(true);
      expect(fr.hotspots.length, `${f} #${i} hotspots`).toBe(fr.hotspotCount);
      const next = nextFrameV0(film, i);
      expect(next, `${f} #${i}`).toBeLessThan(film.frames.length);
    });
    const pal = paletteV0(film.paletteRaw);
    expect([...pal.subarray(0, 3)], f).toEqual([255, 255, 255]);
    expect([...pal.subarray(255 * 4, 255 * 4 + 3)], f).toEqual([0, 0, 0]);
  }
  // the intro is the boot's first film, and it hands over to the title by name
  const intro = readMovFileV0(new Uint8Array(readFileSync(join(ROOT, "day1/intro.mov"))));
  expect(intro.frames.at(-1)!.chainTo).toBe("flip.move");
});

test.skipIf(missing)("the movie editor's picture of a film: a frame for each, its picture, and a goto to a frame that exists", () => {
  for (const f of files.filter((f) => /\.mov$/.test(f))) {
    const v0 = readMovFileV0(new Uint8Array(readFileSync(f)));
    const film = movFileFromV0(v0);
    expect(film.frames.length, f).toBe(v0.frames.length);
    expect(film.segments).toEqual([film]);
    const names = new Set(film.frames.map((fr) => fr.name));
    film.frames.forEach((fr, i) => {
      expect(fr.locationFrame, `${f} #${i}`).toBe(v0.frames[i].picture);
      if (fr.type === 2) expect(names.has(fr.target), `${f} #${i} → ${fr.target}`).toBe(true);
      for (const r of fr.regions) if (r.type === 2) expect(names.has(r.target), `${f} #${i} hotspot`).toBe(true);
      // every sound named is one the film keeps
      for (const s of [fr.sound, ...fr.regions.map((r) => r.sound)]) if (s) expect(film.sounds.get(s), f).toBe(Number(s));
    });
    // a film that ends hands over by name, which the picture keeps as v4's exit-and-chain
    const last = v0.frames.at(-1)!;
    if (last.action === 3) expect(film.frames.at(-1)!.event, f).toBe(last.chainTo);
  }
});

test.skipIf(missing)("the puppet editor's picture of a talk file: every line and question by name, and each line's track", () => {
  let tracks = 0;
  for (const f of files.filter((f) => TALK.test(base(f)))) {
    const bytes = new Uint8Array(readFileSync(f));
    const t = readTalkFileV0(bytes);
    const pup = pupFileFromV0(bytes);
    expect(pup.dfV0).toBe(true);
    expect(pup.stances).toHaveLength(1);
    expect(pup.stances[0].layers.length, f).toBe(t.layers.length);
    expect(pup.idleTimers).toHaveLength(t.idleMin.length);
    for (const l of t.lines) {
      const d = pup.dialogue.get(l.name.toLowerCase())!;
      expect(d.text, `${f} ${l.name}`).toBe(l.subtitle);
      const anim = readAnimLogic(pup, d.animLogicLocation);
      // a track is a keyframe for each two blocks of its voice, as the rip test above says
      if (d.animLogicLocation && !isEmptySlotV0(pup.file.containers[d.animLogicLocation].data)) {
        expect(anim.length, `${f} ${l.name}`).toBeGreaterThan(0);
        expect(anim[0].layers).toHaveLength(8);
        tracks++;
      }
    }
    for (const q of t.questions) {
      const d = pup.dialogue.get(`q ${q.name}`.toLowerCase())!;
      expect(d.audioLocation, `${f} q ${q.name}`).toBe(q.wave);
      // a question has a voice and no face
      expect(readAnimLogic(pup, d.animLogicLocation)).toEqual([]);
    }
  }
  expect(tracks).toBeGreaterThan(0);
});

test("a saved game (.LUN): 26 little-endian bytes in LUNICUS.EXE's order, the score the one dword, read back as written", () => {
  const game = { difficulty: 3, level: 15, came: 5, elevator: 1, progress: 2, score: 0x12345, enemies: 7000, energy: 8123, shields: 9000, bullets: 10000, grenades: 160, rockets: 640 };
  const b = writeSaveV0(game);
  expect(b).toHaveLength(SAVE_V0_SIZE);
  // 0x417944's record: the words, and the score at 0x0a, off the word grid
  expect([...b.subarray(0, 0x0e)]).toEqual([3, 0, 15, 0, 5, 0, 1, 0, 2, 0, 0x45, 0x23, 0x01, 0x00]);
  expect(b[0x18] | (b[0x19] << 8)).toBe(640);
  expect(readSaveV0(b)).toEqual(game);
  expect(isSaveV0(b)).toBe(true);
  expect(isSaveV0(b.subarray(0, 25))).toBe(false);
  expect(isSaveV0(writeSaveV0({ ...game, level: 23 }))).toBe(false);
  expect(isSaveV0(writeSaveV0({ ...game, energy: 10001 }))).toBe(false);
});
