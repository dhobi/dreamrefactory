/**
 * DreamFactory 0's conversations — a *Lunicus* talk file (`raife.1`, `sasha.3`
 * …, one per character per day; `guard.1`..`7` and `queen.1` too).
 *
 * What is read so far, container by container:
 *
 *   0     the character's side: the replies, each with the node it answers
 *         (`111-1`), in records of 312 bytes behind a header — NOT read here yet
 *   1     the player's side: the question menu, the same node numbers
 *   2     the authoring tool's layout: "Rack 1", "Rack 2" …, each a Puppet and a
 *         Wave (a track and a voice line below)
 *   3     the puppet's eight layers: from +2, 0x106 bytes each, an i16 count
 *         and from +6 the containers of the layer's pictures (the talk,
 *         `lunicus/src/game/talk.ts`, reads it)
 *   4     the backdrop: a {@link file://./image-v0.ts} frame, 512x264, anchored
 *         at its centre
 *   5..   the talking head's frames, the same codec
 *   then  a voice line ({@link file://./audio.ts}'s `decodeAudioV0`) and the
 *         puppet track that animates it, pair after pair
 *
 * A PUPPET TRACK is keyframes of 76 bytes:
 *
 *   0x00  u16  tick
 *   0x02  u16  (0 wherever looked)
 *   0x04  i16 ×4  the rectangle this keyframe repaints: top, left, bottom, right
 *                 — the whole screen on the first, the mouth after
 *   0x0c  8 layers of {u16 frame, i16 y, i16 x, u16 (constant)}
 *
 * Layer 0 is the backdrop, placed at its own anchor so it fills the screen. A
 * slot a keyframe does not use holds coordinates far off screen, which the
 * clipping discards. A track has exactly one keyframe per two of its voice
 * line's blocks, on every line in the game that has one — a few lines (the
 * queen's) have an empty puppet slot and play unanimated. The tick field usually counts up by
 * two from 0, but some tracks carry a stale one (0,0,0 … 26), so a player should
 * go by POSITION; that the engine does too is expected but not yet read.
 */

export interface TrackLayerV0 {
  /** an index into the layer's list of pictures in container 3 (LUNICUS.EXE 0x415b9e) */
  frame: number;
  y: number;
  x: number;
  /** a u16 that has been one constant wherever looked */
  unknown: number;
}

export interface TrackKeyV0 {
  tick: number;
  unknown: number;
  dirty: { top: number; left: number; bottom: number; right: number };
  layers: TrackLayerV0[];
}

export const TRACK_KEY_BYTES = 76;
export const TRACK_LAYERS = 8;

/**
 * An empty rack slot: a zero u16 and one byte that is whatever the authoring
 * tool's buffer held. Racks with no wave or no puppet are stored so, and read
 * as a sound of no blocks and a track of no keyframes.
 */
export function isEmptySlotV0(data: Uint8Array): boolean {
  return data.length === 3 && data[0] === 0 && data[1] === 0;
}

export function readPuppetTrackV0(data: Uint8Array): TrackKeyV0[] {
  if (isEmptySlotV0(data)) return [];
  if (data.length % TRACK_KEY_BYTES) throw new Error(`v0 track: ${data.length} bytes is not whole keyframes`);
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return Array.from({ length: data.length / TRACK_KEY_BYTES }, (_, k) => {
    const at = k * TRACK_KEY_BYTES;
    return {
      tick: v.getUint16(at, true),
      unknown: v.getUint16(at + 2, true),
      dirty: {
        top: v.getInt16(at + 4, true),
        left: v.getInt16(at + 6, true),
        bottom: v.getInt16(at + 8, true),
        right: v.getInt16(at + 10, true),
      },
      layers: Array.from({ length: TRACK_LAYERS }, (_, l) => {
        const p = at + 12 + l * 8;
        return {
          frame: v.getUint16(p, true),
          y: v.getInt16(p + 2, true),
          x: v.getInt16(p + 4, true),
          unknown: v.getUint16(p + 6, true),
        };
      }),
    };
  });
}

/** the talk file's backdrop container */
export const TALK_BACKDROP = 4;
/** where its head frames begin */
export const TALK_FIRST_FRAME = 5;
