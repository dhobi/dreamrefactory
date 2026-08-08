import { FrameInfo, LEFTTURNS, RIGHTTURNS, SetFile } from "./df/set";
import { FrameBuffer, decodeFrame } from "./df/image";

/** one decoded scenery frame, cached as an indexed pixel snapshot */
export interface CachedFrame {
  pixels: Uint8Array;
  width: number;
  height: number;
  /** per-pixel depth levels (0..24) from the frame's Z image, if present */
  z?: Uint8Array;
  /**
   * Camera pose of this motion frame (posX16/posZ16/posY16 + axisX8). Every
   * turn/walk frame carries one, so world sprites (actors, propxyz/propstar
   * props) can be projected onto the frame WHILE the room turns or walks —
   * without it they vanished until the standpoint and popped back at the end.
   * axisX8 == the destination view's rotation8 at standpoints, so the reveal is
   * seamless with the still-camera worldCamera().
   */
  cam?: { x: number; y: number; z: number; deg: number };
}

/**
 * How much decoded scenery to keep. A ring (one standpoint's turn circle, or
 * one road) is ~2–5 MB with its Z plane, and the working set at a standpoint is
 * its two turn rings plus the roads leading out — so this holds where you are
 * and where you can go, and lets the rest of the room go. TAOOT's whole boat deck
 * decoded at once was 366 MB.
 */
const RING_BUDGET_BYTES = 24 * 1024 * 1024;

/**
 * The decoded frames of a set's RINGS — a scene's right/left turn circle, one
 * direction of a road — decoded a ring at a time and held under an LRU budget.
 *
 * Frames are DELTA-encoded — each is a patch on the buffer the previous one
 * left — so they cannot be decoded individually. The chain unit is the ring,
 * and a ring turns out to be entirely self-contained: its first frame
 * repaints every pixel. Measured over the 20 largest TAOOT sets — all 998 rings,
 * each decoded from a fresh buffer and from a deliberately poisoned one —
 * every frame comes out byte-identical. So a ring needs no base, and the
 * order rings are decoded in doesn't matter.
 *
 * That was not always the reading. Before the codec's back-references were
 * fixed to tile (see decodeFrame's run mode 7), 38 of those rings "needed"
 * a predecessor and roads "needed" the standpoint they depart — both were
 * the same corruption seen from different angles.
 *
 * The alternative (what this replaces) was decoding every ring at set-open:
 * 366 MB for the boat deck. Frames already on screen or queued in an
 * animation are held by reference, so eviction can never blank them.
 */
export class RingCache {
  private rings: {
    frames: FrameInfo[];
    /** decoded images by container location; null = not decoded / evicted */
    frames_: Map<number, CachedFrame> | null;
    bytes: number;
    /** LRU stamp */
    used: number;
  }[] = [];
  private index = new Map<FrameInfo[], number>();
  private clock = 0;
  private decodedBytes = 0;

  /** index every ring of the set; nothing is decoded until {@link ensure} */
  constructor(private readonly set: SetFile) {
    const add = (frames: FrameInfo[]): void => {
      this.index.set(frames, this.rings.length);
      this.rings.push({ frames, frames_: null, bytes: 0, used: 0 });
    };
    for (const scene of set.scenes) {
      for (const dir of [RIGHTTURNS, LEFTTURNS] as const) add(scene.turns[dir].frames);
    }
    for (const road of set.transitions) {
      for (const reg of road.frameRegisters) add(reg.frames);
    }
  }

  /** decode a ring if it isn't decoded, and return its frames by container location */
  ensure(frames: FrameInfo[]): Map<number, CachedFrame> {
    const idx = this.index.get(frames);
    if (idx === undefined) return new Map();
    const ring = this.rings[idx];
    ring.used = ++this.clock;
    if (ring.frames_) return ring.frames_;

    const fb = new FrameBuffer();
    const decoded = new Map<number, CachedFrame>();
    let bytes = 0;
    for (const fi of frames) {
      if (!fi.frameContainerLoc) continue;
      const d = decodeFrame(this.set.file.containers[fi.frameContainerLoc].data, fb);
      // a container referenced twice in one ring keeps its FIRST decode, but
      // the decoder still runs so the frames after it see the right buffer
      if (decoded.has(fi.frameContainerLoc)) continue;
      const n = d.width * d.height;
      decoded.set(fi.frameContainerLoc, {
        pixels: fb.pixels.slice(0, n),
        width: d.width,
        height: d.height,
        // the SET Z image occludes world sprites (actors) behind scenery
        z: d.hasZ ? fb.zPixels.slice(0, n) : undefined,
        // camera pose so actors/world props stay projected during the motion
        cam: { x: fi.posX16, y: fi.posZ16, z: fi.posY16, deg: fi.axisX8 & 0xff },
      });
      bytes += n * (d.hasZ ? 2 : 1);
    }
    ring.frames_ = decoded;
    ring.bytes = bytes;
    this.decodedBytes += bytes;
    this.evict();
    return decoded;
  }

  /** a known ring that is not yet decoded — what the standpoint warmer looks for */
  needsDecode(frames: FrameInfo[]): boolean {
    const idx = this.index.get(frames);
    return idx !== undefined && !this.rings[idx].frames_;
  }

  /** drop least-recently-used rings until the decoded set fits the budget */
  private evict(): void {
    if (this.decodedBytes <= RING_BUDGET_BYTES) return;
    const live = this.rings.filter((r) => r.frames_).sort((a, b) => a.used - b.used);
    for (const ring of live) {
      if (this.decodedBytes <= RING_BUDGET_BYTES || live.length < 2) break;
      if (ring.used === this.clock) continue; // never the one just asked for
      this.decodedBytes -= ring.bytes;
      ring.frames_ = null;
      ring.bytes = 0;
    }
  }
}
