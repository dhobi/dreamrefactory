/**
 * A running hash of "everything the next frame will be drawn from".
 *
 * The renderer composites the whole 512×384 screen from scratch on every
 * animation frame — palette-expand the flat, palette-expand the view over it,
 * walk every visible prop and actor, upload the lot. That is the right amount
 * of work when something moved, and it is ~7 ms of a 1.1 GHz laptop's frame
 * budget when nothing did, which for an adventure game standing in a room is
 * almost always. Skipping those frames needs a cheap, trustworthy answer to
 * "would this composite be the same picture as the last one?".
 *
 * Answering it by hashing the INPUTS rather than counting mutations is the
 * whole point. A revision counter has to be bumped at every write, and the
 * writes are spread across the builtins, the scheduler, save/load and the
 * viewer itself — one missed bump is a frozen screen with no other symptom.
 * A hash of the live fields cannot be forgotten at a write site; it can only
 * be incomplete at the read site, which is one function per runtime, sitting
 * next to the `composite` it mirrors.
 *
 * Two independent 32-bit accumulators rather than one, so a collision needs
 * both to land — at 60 Hz a single 32-bit hash would drop a frame every few
 * days of continuous play, and a dropped frame here means a stale screen until
 * the next change, not a flicker.
 */

/** float scratch: the rare non-integer (a fade level) still has to hash */
const asF64 = new Float64Array(1);
const asWords = new Uint32Array(asF64.buffer);

let nextRefId = 1;
const refIds = new WeakMap<object, number>();

/**
 * A stable small integer per object, so "is this the same decoded flat / the
 * same palette / the same cached frame as last time?" is one word of hash.
 * The renderer's big inputs are all cached objects that are REPLACED rather
 * than mutated (stage.flatImage's cache, the ring frame maps, the CLUT slices
 * setClut hands out), which is exactly what makes identity enough for them.
 */
function refId(o: object): number {
  let id = refIds.get(o);
  if (id === undefined) {
    id = nextRefId++;
    refIds.set(o, id);
  }
  return id;
}

export class DrawSignature {
  private a = 0x811c9dc5 | 0;
  private b = 0x9e3779b9 | 0;

  /** start a new frame's signature (the instance is reused — no per-frame garbage) */
  reset(): this {
    this.a = 0x811c9dc5 | 0;
    this.b = 0x9e3779b9 | 0;
    return this;
  }

  /** the two halves, compared separately by the caller */
  get lo(): number {
    return this.a >>> 0;
  }
  get hi(): number {
    return this.b >>> 0;
  }

  private word(v: number): void {
    this.a = Math.imul(this.a ^ v, 0x01000193);
    this.b = Math.imul(this.b + v, 0x85ebca6b);
    this.b = (this.b ^ (this.b >>> 15)) | 0;
  }

  num(v: number): this {
    // world coordinates, frame indices, anchors: integers, one word each
    if ((v | 0) === v) this.word(v);
    else {
      asF64[0] = v;
      this.word(asWords[0]);
      this.word(asWords[1]);
    }
    return this;
  }

  /** 1/2 rather than 1/0, so a false doesn't hash the same as an absent number */
  bool(v: boolean): this {
    return this.num(v ? 1 : 2);
  }

  str(v: string): this {
    this.word(v.length ^ 0x5bf03fd7);
    for (let i = 0; i < v.length; i++) this.word(v.charCodeAt(i));
    return this;
  }

  /** a script slot (propdeg, actorowner) holds whichever the script last wrote */
  any(v: string | number | null | undefined): this {
    if (v === null || v === undefined) return this.num(0x7fff0001);
    return typeof v === "number" ? this.num(v) : this.str(v);
  }

  /** identity, for the cached objects the renderer reads wholesale */
  ref(o: object | null | undefined): this {
    return this.num(o ? refId(o) : 0);
  }
}
