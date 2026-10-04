/**
 * The set walker's rules (`src/walker.ts`): which moves leave a standpoint,
 * which picture stands for it, the frames a set holds, and the line the page
 * says about a room.
 *
 *   npx vitest run --project dust dust/tests/walker.ts
 *
 * The rules are checked on a made-up set first, so they hold without the disc;
 * then on APOTH.SET, the room the page opens, and UNDER/MINE.SET, the one set with no
 * standing pictures (dust/tests/sets.ts).
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type SetFileV1, type V1Transition, readSetFileV1 } from "@dreamfactory/engine/df/set-v1";
import { VIEW_H, VIEW_W, decodeSetFrames, setSummary, stillAt, turnsFrom, walkFrom, walkerKey } from "../src/walker";

const DATA = fileURLToPath(new URL("../gamefiles/dustcd/DATA", import.meta.url));
const have = existsSync(DATA);

const at = (x: number, z: number, facing: number) => ({ x, z, facing });
const move = (from: ReturnType<typeof at>, to: ReturnType<typeof at>, frames: number[], still = -1): V1Transition => ({
  from,
  to,
  kind: from.x === to.x && from.z === to.z ? "turn" : "walk",
  firstFrame: frames[0] ?? 0,
  frames,
  departureStill: still,
  record: 0,
});

/** two cells, the first facing north with both turns and a walk */
const SET = {
  transitions: [
    move(at(0, 0, 1), at(0, 0, 3), [10, 11], 50),
    move(at(0, 0, 1), at(0, 0, 4), [12, 13]),
    move(at(0, 0, 1), at(0, 1, 1), [14, 15]),
    move(at(0, 1, 1), at(0, 0, 1), [16, 17]),
  ],
  gridWidth: 1,
  gridHeight: 2,
  actors: [],
  cluts: [{ name: "day", raw: new Uint8Array() }],
  warnings: ["one"],
} as unknown as SetFileV1;

describe("the rules, on a made-up set", () => {
  it("finds the two turns, in register order, and the walk", () => {
    expect(turnsFrom(SET, at(0, 0, 1)).map((t) => t.to.facing)).toEqual([3, 4]);
    expect(walkFrom(SET, at(0, 0, 1))?.to).toEqual(at(0, 1, 1));
    expect(walkFrom(SET, at(0, 0, 3))).toBeUndefined();
  });

  it("stands on the still, else on a move's last frame, else on nothing", () => {
    const px = (n: number) => new Uint8Array([n]);
    const frames = new Map([
      [50, px(50)],
      [17, px(17)],
    ]);
    expect(stillAt(SET, frames, at(0, 0, 1))).toEqual(px(50));
    // no still decoded: the frame a move arriving there ends on
    expect(stillAt(SET, new Map([[17, px(17)]]), at(0, 0, 1))).toEqual(px(17));
    expect(stillAt(SET, new Map(), at(0, 0, 1))).toBeNull();
  });

  it("reads the walker's keys", () => {
    expect(["ArrowRight", "ArrowLeft", "ArrowUp", "c", "C", "ArrowDown"].map(walkerKey)).toEqual(["right", "left", "up", "clut", "clut", null]);
  });

  it("says what it opened in one line", () => {
    expect(setSummary("X.SET", SET, 9, 0, null)).toBe(
      "X.SET: v1 · 1x2 grid, 2 standpoints · 4 moves · 9 frames · 1 stills · 0 cast · clut 1/1 · no panel · 1 warnings",
    );
    expect(setSummary("X.SET", { ...SET, warnings: [] }, 9, 0, { flat: "mainpanel", buttons: 7 })).toMatch(/· panel mainpanel \(7 buttons\)$/);
  });
});

describe.skipIf(!have)("the rules, on the disc", () => {
  it("stands in APOTH on its hi-res stills, and walks it", () => {
    const bytes = new Uint8Array(readFileSync(`${DATA}/APOTH.SET`));
    const set = readSetFileV1(bytes);
    const frames = decodeSetFrames(bytes);
    const start = set.transitions[0].from;
    expect(frames.size).toBeGreaterThan(100);
    for (const px of frames.values()) expect(px).toHaveLength(VIEW_W * VIEW_H);
    // two turns from every standpoint, which come back round in four
    let s = start;
    for (let i = 0; i < 4; i++) s = turnsFrom(set, s)[0].to;
    expect(s).toEqual(start);
    const still = set.transitions.find((t) => t.departureStill >= 0 && t.from.x === start.x && t.from.z === start.z && t.from.facing === start.facing)!;
    expect(stillAt(set, frames, start)).toBe(frames.get(still.departureStill));
  });

  it("stands in the mine on each move's last frame, having no stills", () => {
    const bytes = new Uint8Array(readFileSync(`${DATA}/../UNDER/MINE.SET`));
    const set = readSetFileV1(bytes);
    const frames = decodeSetFrames(bytes);
    const t = set.transitions[0];
    expect(set.transitions.every((m) => m.departureStill < 0)).toBe(true);
    const arriving = set.transitions.find((m) => m.to.x === t.from.x && m.to.z === t.from.z && m.to.facing === t.from.facing && frames.has(m.frames[m.frames.length - 1]))!;
    expect(stillAt(set, frames, t.from)).toBe(frames.get(arriving.frames[arriving.frames.length - 1]));
  });
});
