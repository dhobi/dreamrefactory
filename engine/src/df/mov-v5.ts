import { readLoopTableV5 } from "./banks";
import { pstrAtChecked } from "./binary";
import { DFContainerFile, readContainerFile } from "./container";
import { V5_PIXELS_AT } from "./image-v5";
import { MOV_NAME_FIELD, MovClickRegion, MovFile, MovFrame, MovSegment } from "./mov";

/**
 * A DreamFactory 5 film — RedJack's `.move` — read into the same {@link MovFile}
 * a v4 `.mov` becomes, so the player below it does not care which engine wrote
 * it (the one thing it does care about, the per-frame palette, is flagged by
 * {@link MovSegment.dfV5}).
 *
 * Every v5 container opens with 24 bytes of its own: `00 00 05 00`, a fourCC
 * written backwards, sixteen zeroes. A film is built of six kinds of them —
 * MHED the segment header, MFRM a frame's logic, STEP a picture, SOUN a sound,
 * MSND the one-shot sound table, MTHM the soundtrack loop table, MTRG the cue
 * table — and RedJack.exe's player (`move.c`, 0x44dbd0) and loader (0x456540)
 * are where each offset below was read from. Where a table's offsets are the
 * v4 table's plus those 24 bytes, it is said.
 *
 * ## The segment header (MHED)
 *
 * v4's up to 0x6c — flags 0x18, minimum hold 0x1c, origin 0x24, next segment
 * 0x2c, the one-shot, loop and cue tables at 0x60/0x64/0x68 — and then the
 * palette is simply GONE (it moved into each frame, engine/src/df/image-v5.ts),
 * so what v4 kept at 0x870 is at 0x70: the size, the frame count at 0x78, and
 * the frame table at 0x7c. A frame record is 46 bytes, v4's 42 with four more
 * ahead of the dimensions: height +12, width +14, picture +16, logic +20, the
 * picture's size +26 and the name +30.
 *
 * ## A frame's logic (MFRM)
 *
 * v4's record behind the 24-byte prefix, which is what the player's own default
 * for a frame with none says (it builds one on its stack at 0x44dc03: type 6,
 * the `0x10` name width, three empty names): type 0x18, hold 0x1a, flags 0x1e,
 * sound 0x2a, event 0x3a, target 0x4a, region count 0x5a (tested at 0x44ea41),
 * and the regions from 0x5e, 68 bytes apart (0x44eab3 copies 17 dwords of each;
 * 0x44ec46 steps by 0x44). A region is v4's 64 with four bytes first: type +4,
 * flags +6, the rectangle +12 (y0 x0 y1 x1), sound +20, event +36, target +52.
 *
 * Containers are often longer than their records — a region table ends in
 * bytes nobody reads — so a length is never taken to mean a count.
 *
 * ## The sound tables
 *
 * MSND (one-shots) is v4's with six bytes more per record: the count at 0x1c,
 * 48-byte records from 0x20 with the container at +10, the name at +16 and the
 * follow-on frame at +32. MTHM (the loop bed) has the loop count at 0x1c and its
 * order from 0x1e, as v4 has them at 4 and 6 — the same table a sound bank
 * keeps, read by `readLoopTableV5` in banks.ts. MTRG (cues) is present in
 * every film and filled in none of RedJack's, so it is read as empty.
 */

const HEAD = {
  flags: 0x18,
  minHold: 0x1c,
  origin: 0x24,
  next: 0x2c,
  audio: 0x60,
  loop: 0x64,
  size: 0x70,
  frameCount: 0x78,
  frames: 0x7c,
  frameSize: 46,
} as const;

const FRAME = { height: 12, width: 14, picture: 16, logic: 20, name: 30 } as const;

const LOGIC = {
  type: 0x18,
  hold: 0x1a,
  flags: 0x1e,
  sound: 0x2a,
  event: 0x3a,
  target: 0x4a,
  regionCount: 0x5a,
  regions: 0x5e,
  regionSize: 68,
} as const;

const REGION = { type: 4, rect: 12, sound: 20, event: 36, target: 52 } as const;

const ONESHOT = { count: 0x1c, records: 0x20, size: 48, loc: 10, name: 16, follow: 32 } as const;

/** is this a DreamFactory 5 film? (container 0 is an MHED) */
export function isMovV5(data: Uint8Array): boolean {
  if (data.length < 1028) return false;
  const pos = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(1024, true);
  return data[pos + 8 + 2] === 5 && String.fromCharCode(...data.subarray(pos + 12, pos + 16)) === "DEHM";
}

export function readMovFileV5(data: Uint8Array): MovFile {
  const file = readContainerFile(data);
  const segments: MovSegment[] = [];
  const seen = new Set<number>();
  let bias = 0;
  while (!seen.has(bias) && bias >= 0 && bias < file.containers.length) {
    seen.add(bias);
    const { segment, next } = readSegment(file, bias);
    segments.push(segment);
    if (next <= 0) break;
    bias = next;
  }
  return Object.assign(segments[0], { segments }) as MovFile;
}

function readSegment(file: DFContainerFile, bias: number): { segment: MovSegment; next: number } {
  const c0 = file.containers[bias].data;
  const v = new DataView(c0.buffer, c0.byteOffset, c0.byteLength);
  const i32 = (at: number): number => v.getInt32(at, true);
  const flags = i32(HEAD.flags);
  const next = i32(HEAD.next);
  const height = v.getInt16(HEAD.size, true);
  const width = v.getInt16(HEAD.size + 2, true);
  const count = i32(HEAD.frameCount);

  const name = (d: Uint8Array, at: number): string => pstrAtChecked(d, at, 1, MOV_NAME_FIELD) ?? "";

  const frames: MovFrame[] = [];
  for (let i = 0; i < count; i++) {
    const rec = HEAD.frames + i * HEAD.frameSize;
    if (rec + HEAD.frameSize > c0.length) break;
    const logicAt = i32(rec + FRAME.logic);
    const locationClickRegion = logicAt ? logicAt + bias : 0;
    let type = 6;
    let holdTicks = 0;
    let frameFlags = 0;
    let sound = "";
    let event = "";
    let target = "";
    const regions: MovClickRegion[] = [];
    const rd = locationClickRegion ? file.containers[locationClickRegion]?.data : undefined;
    if (rd && rd.length >= LOGIC.regions) {
      const rv = new DataView(rd.buffer, rd.byteOffset, rd.byteLength);
      type = rv.getInt16(LOGIC.type, true);
      holdTicks = rv.getInt32(LOGIC.hold, true);
      frameFlags = rd[LOGIC.flags];
      sound = name(rd, LOGIC.sound);
      event = name(rd, LOGIC.event);
      target = name(rd, LOGIC.target);
      const n = rv.getInt32(LOGIC.regionCount, true);
      for (let g = 0; g < n; g++) {
        const off = LOGIC.regions + g * LOGIC.regionSize;
        if (off + LOGIC.regionSize > rd.length) break;
        regions.push({
          type: rv.getInt16(off + REGION.type, true),
          y0: rv.getInt16(off + REGION.rect, true),
          x0: rv.getInt16(off + REGION.rect + 2, true),
          y1: rv.getInt16(off + REGION.rect + 4, true),
          x1: rv.getInt16(off + REGION.rect + 6, true),
          sound: name(rd, off + REGION.sound),
          event: name(rd, off + REGION.event),
          target: name(rd, off + REGION.target),
          record: off,
        });
      }
    }
    frames.push({
      type,
      height: v.getInt16(rec + FRAME.height, true),
      width: v.getInt16(rec + FRAME.width, true),
      locationFrame: i32(rec + FRAME.picture) + bias,
      name: name(c0, rec + FRAME.name),
      sound, event, target, regions,
      locationClickRegion,
      record: rec,
      holdTicks,
      waitsForVoice: (frameFlags & 1) !== 0,
      holdsDeadline: (frameFlags & 8) !== 0,
      playsThroughRegions: (frameFlags & 4) !== 0,
    });
  }

  // the soundtrack: the loop order, each entry naming a record (1-based)
  const audioChunks: number[] = [];
  const loopAt = i32(HEAD.loop);
  const lt = loopAt > 0 ? file.containers[loopAt + bias]?.data : undefined;
  if (lt) {
    const { order, records } = readLoopTableV5(lt, "film");
    for (const o of order) {
      const rec = records[o - 1];
      if (rec) audioChunks.push(rec.containerLoc + bias);
    }
  }

  const sounds = new Map<string, number>();
  const soundFollows = new Map<string, string>();
  const shotAt = i32(HEAD.audio);
  const st = shotAt > 0 ? file.containers[shotAt + bias]?.data : undefined;
  if (st && st.length >= ONESHOT.records) {
    const sv = new DataView(st.buffer, st.byteOffset, st.byteLength);
    const n = sv.getInt32(ONESHOT.count, true);
    for (let i = 0; i < n; i++) {
      const at = ONESHOT.records + i * ONESHOT.size;
      if (at + ONESHOT.size > st.length) break;
      const id = name(st, at + ONESHOT.name).toLowerCase();
      if (!id) continue;
      sounds.set(id, sv.getInt32(at + ONESHOT.loc, true) + bias);
      const follow = name(st, at + ONESHOT.follow);
      if (follow) soundFollows.set(id, follow);
    }
  }

  const segment: MovSegment = {
    file,
    bias,
    width,
    height,
    originX: v.getInt16(HEAD.origin, true),
    originY: v.getInt16(HEAD.origin + 2, true),
    // the palette lives in each frame; the first frame's stands in for callers
    // that ask a segment for one (editors, thumbnails)
    paletteRaw: v4PaletteOf(file, frames[0]?.locationFrame),
    frames,
    // the two action frames, by name, where v4 keeps them: RedJack.exe's movie
    // loop looks the pstrs at header +0x40 and +0x50 up among the frame names
    // (0x44e1ac, 0x44e202) and sets `actionframe` 1 and 2 on reaching them
    // (0x44e94c). The skull's dream is the one RedJack asks after: dream2.move's
    // "newfile 1" is what hands Nick RedJack's key (top.sett skeleton)
    actionFrame1: name(c0, 0x40),
    actionFrame2: name(c0, 0x50),
    flags,
    keySkips: (flags & 1) !== 0,
    minHoldTicks: i32(HEAD.minHold),
    audioChunks,
    audioLoops: audioChunks.length > 0,
    sounds,
    soundFollows,
    cues: [],
    dfV5: true,
  };
  return { segment, next };
}

/** a v5 frame's BGRx palette in v4's 8-byte-per-entry shape (paletteToRGBA's) */
function v4PaletteOf(file: DFContainerFile, loc: number | undefined): Uint8Array {
  const out = new Uint8Array(256 * 8);
  const d = loc !== undefined ? file.containers[loc]?.data : undefined;
  if (!d || d.length < V5_PIXELS_AT) return out;
  for (let i = 0; i < 256; i++) {
    const p = 0x28 + i * 4;
    // i16 index, then three i16 components whose HIGH byte is the colour
    out[i * 8 + 3] = d[p + 2];
    out[i * 8 + 5] = d[p + 1];
    out[i * 8 + 7] = d[p];
  }
  return out;
}
