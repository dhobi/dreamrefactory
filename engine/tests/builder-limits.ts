/**
 * The write-side builders' limits and their optional parts
 * (engine/src/df/{cst,stg,pup,banks}-build.ts), and the version probe every
 * reader starts from (engine/src/df/version.ts): each builder refuses what the
 * format has no room for, with the field it ran out of, and writes the
 * optional pieces — region scripts, a line's voice, gap containers — where
 * the reader finds them.
 *
 *   npx vitest run engine/tests/builder-limits.ts
 */
import { expect, test } from "vitest";
import { writeContainerFile } from "@dreamfactory/engine/df/container";
import { emptyScript } from "@dreamfactory/engine/df/build";
import { buildCstFile } from "@dreamfactory/engine/df/cst-build";
import { buildStgBytes, buildStgFile } from "@dreamfactory/engine/df/stg-build";
import { readStgFile, readStgRegions } from "@dreamfactory/engine/df/stg";
import { buildPupFile } from "@dreamfactory/engine/df/pup-build";
import { PUP_LAYERS, readAnimLogic, readPupFile } from "@dreamfactory/engine/df/pup";
import { buildBankFile } from "@dreamfactory/engine/df/banks-build";
import { readBankTables } from "@dreamfactory/engine/df/banks";
import { detectVersion, versionOf } from "@dreamfactory/engine/df/version";
import { MAC } from "@dreamfactory/engine/df/byte-order";
import { patchFrameAnchor, patchFrameDegree, readShpFile, type ShpFrame } from "@dreamfactory/engine/df/shp";
import { buildShpFile } from "@dreamfactory/engine/df/shp-build";

const PALETTE = [0, 0, 0, 255, 255, 255];
const dot: ShpFrame = { width: 1, height: 1, posXraw: 0, posYraw: 0, indexed: new Uint8Array([1]), opaque: new Uint8Array([1]) };

test("a cast: at least one member, at most the play script's steps, eight directions a step", () => {
  expect(() => buildCstFile({ palette: PALETTE, members: [] })).toThrow("cst: a cast needs at least one member");
  const eight = Array.from({ length: 8 }, () => dot);
  expect(() => buildCstFile({
    palette: PALETTE,
    members: [{ name: "a", poses: [{ name: "long", steps: Array.from({ length: 34 }, () => eight) }] }],
  })).toThrow('cst: pose "long" has 34 steps, the play script holds 33');
  expect(() => buildCstFile({
    palette: PALETTE,
    members: [{ name: "a", poses: [{ name: "odd", steps: [[dot, dot]] }] }],
  })).toThrow('cst: pose "odd" has a step of 2 directions, needs 8');
});

test("a stage: at least one flat, a picture its size, and region scripts written where the regions point", () => {
  const art = { pixels: new Uint8Array(4), width: 2, height: 2 };
  expect(() => buildStgFile({ palette: PALETTE, refName: "x", flats: [] })).toThrow("stg: a stage needs at least one flat");
  expect(() => buildStgFile({ palette: PALETTE, refName: "x", flats: [{ name: "a", art: { ...art, pixels: new Uint8Array(3) } }] }))
    .toThrow(/stg: /);
  const stg = readStgFile(buildStgBytes({
    palette: PALETTE,
    refName: "panel",
    flats: [{
      name: "front", art,
      regions: [
        { name: "ok", top: 0, left: 0, bottom: 1, right: 1, script: emptyScript() },
        { name: "plain", top: 1, left: 1, bottom: 2, right: 2 },
      ],
    }],
  }));
  const [ok, plain] = readStgRegions(stg.file.containers[stg.flats[0].locationClickLogic].data);
  expect([ok.name, ok.script > 0, plain.name, plain.script]).toEqual(["ok", true, "plain", 0]);
});

test("a puppet: the stance register's slots, a layer's frames, and the optional parts", () => {
  expect(() => buildPupFile({ palette: PALETTE, stances: Array.from({ length: 65 }, () => ({ layers: {} })) }))
    .toThrow("pup: 65 stances, register holds 64");
  expect(() => buildPupFile({ palette: PALETTE, stances: [{ layers: { [PUP_LAYERS[0]]: Array.from({ length: 33 }, () => dot) } }] }))
    .toThrow(`pup: layer ${PUP_LAYERS[0]} has 33 frames, max 32`);
  // nothing optional at all
  const bare = readPupFile(writeContainerFile(buildPupFile({ palette: PALETTE }).file));
  expect([bare.dialogue.size, bare.stances.length]).toEqual([0, 0]);
  // a line's animation: none past the file's end, none in a container that is not whole 82-byte records
  expect(readAnimLogic(bare, 999)).toEqual([]);
  expect(bare.file.containers[1].data.length % 82).not.toBe(0);
  expect(readAnimLogic(bare, 1)).toEqual([]);
  // a voiced line and a silent one, behind two gap containers
  const voiced = readPupFile(writeContainerFile(buildPupFile({
    palette: PALETTE,
    gaps: 2,
    dialogue: [{ ident: "hello", text: "Hello.", audio: new Uint8Array(16) }, { ident: "quiet", text: "..." }],
  }).file));
  expect(voiced.dialogue.get("hello")!.audioLocation).toBeGreaterThan(0);
  expect(voiced.dialogue.get("quiet")!.audioLocation).toBe(0);
});

test("a bank: a play order longer than its field is refused; a nameless, empty bank still reads", () => {
  expect(() => buildBankFile({ loopOrder: Array.from({ length: 131 }, () => 1) }))
    .toThrow("bank: play order has 131 entries, the field holds 130");
  const t = readBankTables(buildBankFile({}).file);
  expect([t.trackName, t.loopRecords, t.singles]).toEqual(["", [], []]);
});

test("the version probe: too short to say, a Macintosh header, and a file whose first container is not where it says", () => {
  expect(versionOf(new Uint8Array(3))).toBe(0);
  expect(versionOf(new Uint8Array(1), MAC)).toBe(0);
  expect(versionOf(new Uint8Array([0, 4, 0, 0]), MAC)).toBe(4);
  const file = new Uint8Array(1100);
  new DataView(file.buffer).setUint32(1024, 1090, true); // container 0 runs off the end
  expect(detectVersion(file)).toBe(0);
  expect(detectVersion(new Uint8Array(10))).toBe(0);
});

test("a shop from another engine is refused; a frame anchor patch needs a frame container", () => {
  const { file } = buildShpFile({ palette: PALETTE, groups: [{ name: "lamp", states: [{ identifier: "on", frames: [{ art: dot }] }] }] });
  const shp = readShpFile(writeContainerFile(file));
  expect(patchFrameAnchor(shp.file, 99, 1, 1)).toBe(false);
  expect(patchFrameAnchor(shp.file, 0, 1, 1)).toBe(true);
  expect(patchFrameDegree(shp, 0, 0, 7, 64)).toBe(false);
  new DataView(file.containers[0].data.buffer, file.containers[0].data.byteOffset).setInt32(2, 3, true);
  expect(() => readShpFile(writeContainerFile(file))).toThrow("unsupported DreamFactory SHP/PRP version 3 (1 and 4 are read)");
});

test("a region table too short for its count has no regions", () => {
  expect(readStgRegions(new Uint8Array(10))).toEqual([]);
});
