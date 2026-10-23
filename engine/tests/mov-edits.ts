/**
 * Titanic's MOV reader and the movie editor's in-place patches
 * (engine/src/df/mov.ts, engine/src/df/mov-build.ts), on films built here:
 * a header that is not version 4, logic containers too short to trust or
 * claiming more regions than they hold, a cue table read back, and each patch
 * refusing a frame with no logic container, or one whose container is gone.
 *
 *   npx vitest run engine/tests/mov-edits.ts
 */
import { expect, test } from "vitest";
import { writeContainerFile } from "@dreamfactory/engine/df/container";
import { buildMovFile, type MovBuildFrame } from "@dreamfactory/engine/df/mov-build";
import {
  patchFrameLogic,
  patchKeySkips,
  patchRegionLogic,
  patchRegionRect,
  readMovFile,
} from "@dreamfactory/engine/df/mov";
import { i32, pstr } from "./helpers/save-fixtures";

const W = 4, H = 2;
const art = new Uint8Array(W * H).fill(1);
const all = { top: 0, left: 0, bottom: H, right: W };
const opts = (frames: MovBuildFrame[]) => ({ palette: [0, 0, 0, 255, 255, 255], width: W, height: H, frames });

test("what the builder refuses", () => {
  expect(() => buildMovFile(opts([]))).toThrow("mov: a segment needs at least one frame");
  expect(() => buildMovFile(opts([{ name: "a" }]))).toThrow('mov: frame "a" has no art');
  expect(() => buildMovFile(opts([{ name: "a", art, noLogic: true, holdTicks: 3 }]))).toThrow(
    'mov: frame "a" wants a hold but no logic container',
  );
});

test("a header from another engine is refused", () => {
  const { file } = buildMovFile(opts([{ name: "a", art }]));
  i32(file.containers[0].data, 2, 5);
  expect(() => readMovFile(writeContainerFile(file))).toThrow("unsupported DreamFactory MOV version (need 4.0)");
});

test("a logic container too short to trust, or claiming regions it does not hold", () => {
  const { file } = buildMovFile(opts([
    { name: "a", art, type: 2, target: "b", regions: [{ ...all, type: 2, target: "b" }] },
    { name: "b", art, type: 1 },
    { name: "c", art, type: 3 },
  ]));
  const m0 = readMovFile(writeContainerFile(file));
  const [logicA, logicB, logicC] = m0.frames.map((f) => f.locationClickRegion);
  i32(file.containers[logicA].data, 1090, 4); // four regions, room for one
  file.containers[logicB] = { id: logicB, data: new Uint8Array(0x20) }; // shorter than the reader trusts
  file.containers[logicC] = { id: logicC, data: file.containers[logicC].data.slice(0, 0x50) }; // logic, no region table
  const m = readMovFile(writeContainerFile(file));
  expect(m.frames[0].regions.map((r) => r.target)).toEqual(["b"]);
  // read as a frame with no logic: the default action, no names, no regions
  expect([m.frames[1].type, m.frames[1].target, m.frames[1].regions]).toEqual([6, "", []]);
  expect([m.frames[2].type, m.frames[2].regions]).toEqual([3, []]);
  // and the editor will not write logic into a container it cannot trust
  expect(patchFrameLogic(m, 1, { type: 2 })).toBe(false);
});

test("a cue table: timed jumps, read until the table runs out", () => {
  const { file } = buildMovFile(opts([{ name: "a", art }, { name: "b", art }]));
  const cues = new Uint8Array(4 + 28 + 10);
  i32(cues, 0, 3); // three cues, room for one
  i32(cues, 4, 120);
  pstr(cues, 4 + 12, "b");
  file.containers[1] = { id: 1, data: cues };
  i32(file.containers[0].data, 0x68, 1);
  const m = readMovFile(writeContainerFile(file));
  expect(m.cues).toEqual([{ tick: 120, target: "b" }]);
  // a cue whose name is not one jumps nowhere; a table too short for its count has no cues
  cues[4 + 12] = 40;
  expect(readMovFile(writeContainerFile(file)).cues).toEqual([{ tick: 120, target: "" }]);
  file.containers[1] = { id: 1, data: new Uint8Array(2) };
  expect(readMovFile(writeContainerFile(file)).cues).toEqual([]);
});

test("patches refuse a frame with no logic container, and one whose container is a gap", () => {
  const { file } = buildMovFile(opts([
    { name: "a", art, noLogic: true },
    { name: "b", art, type: 6, regions: [{ ...all, type: 2, target: "a" }] },
  ]));
  const m = readMovFile(writeContainerFile(file));
  const [bare, b] = m.frames;
  const region = b.regions[0];
  expect(patchFrameLogic(m, 0, { type: 1 })).toBe(false);
  expect(patchFrameLogic(m, 9, { type: 1 })).toBe(false);
  expect(patchRegionLogic(m, bare, region, { target: "b" })).toBe(false);
  expect(patchRegionRect(m, bare, region, { top: 1, left: 1, bottom: 2, right: 2 })).toBe(false);

  // the logic container replaced by a gap: nothing to write into, and the model is left as it was
  m.file.containers[b.locationClickRegion] = { id: b.locationClickRegion, data: new Uint8Array(8), gap: true };
  expect(patchRegionLogic(m, b, region, { target: "b" })).toBe(false);
  expect(region.target).toBe("a");
  expect(patchRegionRect(m, b, region, { top: 1, left: 1, bottom: 2, right: 2 })).toBe(false);
  expect(region.y0).toBe(0);
  // and a header that is a gap keeps its flags
  m.file.containers[0] = { id: 0, data: new Uint8Array(8), gap: true };
  expect(patchKeySkips(m, true)).toBe(false);
  expect(m.keySkips).toBe(false);
});
