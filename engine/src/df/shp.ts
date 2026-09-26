import { BinaryReader, writeNameAt } from "./binary";
import { Container, DFContainerFile, patchContainerData, readContainerFile } from "./container";

/**
 * SHP ("shop") files — prop definitions. Port of DFshp (dfet DFshp.h).
 *
 * A shop holds prop groups; each group is one prop with a script and a set
 * of named states ("views" in propview() terms, e.g. "idleclosed", "open");
 * each state has animation frame containers in the transparent-image codec,
 * which carry their own screen draw position.
 */

export interface PropState {
  identifier: string;
  /** container location of the state's descriptor */
  location: number;
  /** byte offset of this state's 32-byte entry in its GROUP container — where
   *  the identifier is stored (edit target, see {@link patchStateIdentifier}) */
  record: number;
  /** byte offset of each frame's 44-byte record in the state container,
   *  permuted with {@link frames} so the two stay index-for-index (edit
   *  target for the stored degree, see {@link patchFrameDegree}) */
  records: number[];
  /** frame container locations (animation frames of this state) */
  frames: number[];
  /** per-frame depth-scale reference (i16 @+42 of each 44-byte frame record,
   *  the same field GANG.CST stores for actors — uniformly 96 in the shipped
   *  shops). world→screen scale is scale×refScale/(1000×depth). */
  refScales: number[];
  /** per-frame stored degree (i16 @+40). propdeg(N) picks the frame whose
   *  degree == N (NOT the Nth frame): a card table's 32 views hold 0,8,…,248;
   *  the blackjack score readout holds 2,3,…,21,BUST=22,BLACKJACK=23 (so the
   *  digit shown is the frame's degree, offset from its index). */
  degrees: number[];
  /**
   * The state's PLAY SCRIPT: 0-based indices into {@link frames}, in the order
   * they are shown, or null when the state has no table.
   *
   * The state header holds a step count at +112 and that many 1-based frame
   * indices from +46. It is a play LIST, not a permutation — steps repeat, which
   * is how the format holds a frame for longer than one tick, and a state can
   * leave a frame unnamed. FUSE.SHP's fusedoor is the case that found this:
   * `opening` lists `1,2,2,3,3,4,4,5,5,6` and `closing` lists `6,5,5,4,4,3,3,2,2,1`
   * — ten steps each, matching the ten `forceupdate()`s in the prop's own
   * `open()`/`close()`. Both states store the same six pictures in the same
   * closed→open direction, so the table is the ONLY thing that says one of them
   * runs backwards, and reading just the first six entries saw the repeats, judged
   * it "not a permutation", and played the opening animation for the closing one.
   *
   * Runtime meaning is {@link playSequence} in runtime/props.ts, which composes it
   * with a deg-variant split (a table whose length is the VARIANT's size indexes
   * within the variant — the boiler/cufflink bags and the deck map store the same
   * six-step swing once per variant).
   */
  playOrder: number[] | null;
  /**
   * DreamFactory 5 only: the group each frame belongs to (the i16 at +8 of its
   * record), index for index with {@link frames}. A step of the play list
   * names a group, not a frame; see {@link steps}.
   */
  groups?: number[];
  /**
   * DreamFactory 5 only: the play list as RedJack.exe reads it — at each step
   * the 0-based GROUP whose frames may be drawn (0x42d198: `word [view + 0x2e
   * + step * 2] - 1`), and of those the one whose angle ({@link degrees}, here
   * in 2^24ths of a turn) is nearest the prop's `propdeg`, or for a prop in the
   * room its facing from the camera (0x42d202–0x42d229). A view with no list
   * is one step of group 0.
   */
  steps?: number[];
  /** true when the state's frames form a real ANIMATION — it has a play script
   *  that accounts for the whole state (an "open" swing lists 1..N, "close" lists
   *  N..1), or its degrees repeat (one animation per variant).
   *  false = the frames are deg-indexed SELECTOR variants (map/life/navarrow
   *  "dark"/"light" = deg 0 normal / deg 1 tour; the signs' directional set):
   *  propview holds the deg-matched frame instead of animating. Without this the
   *  map's 2-frame "dark" auto-animated to frame 1 (the tour icon) on load.
   *  Measured: every such selector state in the corpus stores a step count of 1,
   *  so having a table at all is what tells the two apart. */
  animated: boolean;
  /**
   * DreamFactory 5 only: bit 0 of the view's flags word at +0x14, which
   * RedJack.exe copies into the prop with the view (`propview` 0x428640 →
   * 0x42d2f0, masked with ~0xe). Set on exactly the views whose end a script
   * answers in `endanim` — liznite.shop's `mark crate`, the journal's `opening`
   * and `closing`, the cannon's `firing` and `splash`, the jail spoon's
   * `animated` — and clear on the ones that are held or loop, like the spoon's
   * two-frame `carrying`. Read here as "plays once, and says so at the end".
   */
  playsOnce?: boolean;
  /**
   * DreamFactory 5 only: the i16 at 0x22e, which `propview` copies into the prop
   * (0x42d354). Above 0 the view steps by the clock, one step every that many
   * sixtieths of a second (the stepper 0x42c8b3 divides `0x469f80`, the
   * milliseconds × 0.06, by it); at 0 or below, one step a service pass.
   */
  frameTicks?: number;
  /**
   * DreamFactory 5 only: the view's step count (0x230), which the stepper goes
   * round (0x42c8e5). One step is a view that stands still whatever pictures it
   * holds — the inventory chest's `base` holds its thirteen lid positions for
   * `propdeg` to choose from, and stepping through them opened and shut it.
   */
  playCount?: number;
}

export interface PropGroup {
  name: string;
  location: number;
  scriptContainerLocation: number;
  states: PropState[];
  /**
   * v5 only: the i16 at 0x14, which RedJack.exe copies into the prop (`0x4275a4`)
   * and its sprite sizer scales by `propscale` / 1000 and lowers the prop by
   * before it takes the depth (`0x4358d0`). Most groups hold 0.
   */
  depthRef?: number;
}

export interface ShpFile {
  file: DFContainerFile;
  refName: string;
  mainScriptLocation: number;
  /** raw palette block ({i16 index, i16 rgb[3]} * 256) */
  paletteRaw: Uint8Array;
  groups: PropGroup[];
}

/** container 0: the file header — version tag, palette, and the group table */
const C0 = {
  version: 0x02,
  palette: 36,
  /**
   * The shop's MAIN SCRIPT container, i32 — and it sits immediately before the
   * ref name, exactly as {@link GROUP.scriptLocation} sits immediately before
   * {@link GROUP.name}. The same idiom, one level up.
   *
   * Read out of both engines rather than measured, because the corpus cannot tell
   * this field from any other constant: it holds 1 in all 207 shipped
   * `.shp`/`.prp` (seven Titanic editions, Dust, Timelapse). TI.EXE's shop opener
   * `0x415780` does exactly two things with container 0 once the version passes:
   *
   *     0x41583b: lea ecx, [ebx + 0x928]   ; the ref name
   *     0x415843: call 0x435740            ;   -> shop->name (esi+0xc)
   *     0x41584b: mov ecx, [ebx + 0x924]   ; THIS
   *     0x415853: mov [esi + 8], ecx       ;   -> shop->mainScript
   *     0x41586b: call 0x4385f0            ; ...and opens that container
   *
   * and DF.EXE carries the same `mov ecx, [ebx+0x924]` beside the same `+0x928`,
   * twice each, so the field is the same in DreamFactory 1 and 4.
   *
   * This used to read offset 20, with `|| 1` on top of it — the container-1
   * convention hardcoded over a field that is 0 in 149 of the 207 and 1 in the
   * other 58, i.e. never a pointer. That is the shape #291 charged us for in
   * `set-v1.ts`: a constant read as a ref, working only because the authoring tool
   * put the script in container 1, until `undertak.set` didn't. Nothing in the
   * corpus exercises the difference — every shop's main script IS container 1 —
   * so this is a correctness fix with no behaviour change, which is the only kind
   * available before a counterexample turns up (#325).
   */
  mainScript: 2340,
  refName: 2344,
  groupCount: 2360,
  groupTable: 2364,
  groupEntrySize: 16,
} as const;

/** a group container: the prop's script, its name, and its state table */
const GROUP = {
  scriptLocation: 38,
  name: 42,
  entryCount: 90,
  entries: 94,
  entrySize: 32,
  entryIdentifier: 16,
} as const;

/** a state container: the play-order table and the frame records */
const STATE = {
  playOrder: 46,
  /** i16: how many steps of the play script at {@link STATE.playOrder} are real.
   *  Measured decisively — every state's entries stop exactly here and turn to
   *  unrelated data (BOIL boilbag: `1,2,3,4,5,6,-9708,0,…` with a count of 6;
   *  FUSE fusedoor: ten steps then `5,5,5,6,…`). */
  playOrderCount: 112,
  frameCount: 114,
  /** slots between {@link STATE.playOrder} and the count that follows it */
  maxPlayOrder: (112 - 46) / 2,
  frames: 118,
  frameSize: 44,
  frameDegree: 40,
  frameRefScale: 42,
} as const;

/** characters that fit the name fields (the length byte is not counted) */
export const SHOP_REF_NAME_FIELD = 15;
export const GROUP_NAME_FIELD = 47;
export const STATE_ID_FIELD = 15;

/**
 * DreamFactory 5's shop (RedJack's `.shop`), whose containers are SHOP, PROP,
 * VIEW and SPRI behind the 24-byte v5 prefix (`00 00 05 00` and a fourCC
 * written backwards).
 *
 *   - SHOP, container 0: no palette — each sprite carries its own — so what v4
 *     keeps past it closes up: the main script at 0x24, the name at 0x28, the
 *     group count at 0x38 and the 16-byte group table from 0x3c.
 *   - PROP, a group: v4's layout at v4's offsets, unchanged (script 38, name 42,
 *     count 90, 32-byte entries from 94).
 *   - VIEW, a state: the play order at v4's 0x2e, but room for 257 steps
 *     before its step count at 0x230; the frame count at 0x232 and the 44-byte
 *     frame records from 0x236, each as v4's (degree +40, reference scale +42).
 *     RedJack.exe's stepper reads frame `word [view + 0x2e + step * 2] - 1`
 *     (0x42d198, the handle's 0x20 header counted) — and a view whose u32 at
 *     0x10 is not 0 plays the frames of the view at that container location
 *     instead of its own (0x42d1a8–0x42d1f0). The lift's rope is drawn once,
 *     going down: "start up", "loop up" and "finish up" hold no pictures, only
 *     the down views' location there and their steps listed backwards.
 *   - SPRI, a picture: see {@link decodeShpFrame}.
 */
const C0_V5 = { mainScript: 0x24, refName: 0x28, groupCount: 0x38, groupTable: 0x3c } as const;
const STATE_V5 = {
  playOrder: 0x2e,
  playOrderCount: 0x230,
  maxPlayOrder: (0x230 - 0x2e) / 2,
  frameCount: 0x232,
  frames: 0x236,
  frameSource: 0x10,
  /** in each 44-byte frame record: the i16 group the frame belongs to, and its
   *  angle, an i32 in 2^24ths of a turn (RedJack.exe 0x42d202, 0x42d211) */
  frameGroup: 8,
  frameAngle: 0x26,
} as const;

/** is this container DreamFactory 5's, and of this four-character kind? */
export const isV5 = (d: Uint8Array, kind: string): boolean =>
  d.length > 8 && d[2] === 5 && d[3] === 0 && String.fromCharCode(d[7], d[6], d[5], d[4]) === kind;

export function readShpFile(data: Uint8Array): ShpFile {
  const file = readContainerFile(data);
  const containers = file.containers;
  const c0 = containers[0].data;
  const r = new BinaryReader(c0);

  if (isV5(c0, "SHOP")) {
    r.seek(C0_V5.mainScript);
    const mainScriptLocation = r.i32();
    r.seek(C0_V5.refName);
    const refName = r.pstr();
    r.seek(C0_V5.groupCount);
    const groupCount = r.i32();
    const groups: PropGroup[] = [];
    for (let g = 0; g < groupCount; g++) {
      r.seek(C0_V5.groupTable + g * C0.groupEntrySize);
      groups.push(readGroup(r.i32(), containers, STATE_V5));
    }
    // an empty stand-in: every v5 sprite brings its own palette
    return { file, refName, mainScriptLocation, paletteRaw: new Uint8Array(256 * 8), groups };
  }

  r.seek(C0.version);
  const version = r.i32();
  if (version !== 4 && version !== 1) {
    throw new Error(`unsupported DreamFactory SHP/PRP version ${version} (1 and 4 are read)`);
  }

  r.seek(C0.mainScript);
  const mainScriptLocation = r.i32();
  const paletteRaw = c0.subarray(C0.palette, C0.palette + 256 * 8);
  r.seek(C0.refName);
  const refName = r.pstr();
  r.seek(C0.groupCount);
  const groupCount = r.i32();

  const groups: PropGroup[] = [];
  for (let g = 0; g < groupCount; g++) {
    r.seek(C0.groupTable + g * C0.groupEntrySize);
    groups.push(readGroup(r.i32(), containers));
  }
  return { file, refName, mainScriptLocation, paletteRaw, groups };
}

function readGroup(
  location: number,
  containers: Container[],
  at: { playOrder: number; playOrderCount: number; maxPlayOrder: number; frameCount: number; frames: number; frameSource?: number } = STATE,
): PropGroup {
  const r = new BinaryReader(containers[location].data);
  r.seek(GROUP.scriptLocation);
  const scriptContainerLocation = r.i32();
  const name = r.pstr(GROUP_NAME_FIELD);
  r.seek(GROUP.entryCount);
  const entryCount = r.i32();

  const states: PropState[] = [];
  for (let e = 0; e < entryCount; e++) {
    const record = GROUP.entries + e * GROUP.entrySize;
    r.seek(record);
    const entryLoc = r.i32();
    r.skip(12); // 3 unknown ints
    const identifier = r.pstr(STATE_ID_FIELD);
    const ed = containers[entryLoc].data;
    const ev = new DataView(ed.buffer, ed.byteOffset, ed.byteLength);
    // v5: the pictures may be another view's (see STATE_V5); the play order stays this one's
    const source = at.frameSource !== undefined && ed.length >= at.frameSource + 4 ? ev.getUint32(at.frameSource, true) : 0;
    const fd = source && containers[source] ? containers[source].data : ed;
    const fv = new DataView(fd.buffer, fd.byteOffset, fd.byteLength);
    const subCount = fv.getInt32(at.frameCount, true);
    const frames: number[] = [];
    const refScales: number[] = [];
    const degrees: number[] = [];
    const records: number[] = [];
    const groups: number[] = [];
    for (let s = 0; s < subCount; s++) {
      const rec = at.frames + STATE.frameSize * s;
      records.push(rec);
      frames.push(fv.getInt32(rec, true));
      // v5 keeps the whole angle at +0x26; the i16 at +40 is only its top half,
      // which is 0 for the small numbers most views count their frames by
      if (at === STATE_V5) {
        degrees.push(fv.getInt32(rec + STATE_V5.frameAngle, true) & 0xffffff);
        groups.push(fv.getInt16(rec + STATE_V5.frameGroup, true));
      } else degrees.push(fv.getInt16(rec + STATE.frameDegree, true));
      refScales.push(fv.getInt16(rec + STATE.frameRefScale, true) || 96);
    }
    // The play script (see PropState.playOrder): a step count at +112 and that
    // many 1-based frame indices from +46. Kept as a SEQUENCE — the frames stay in
    // stored order and playOrder says what to show when — because the steps repeat
    // and so cannot be expressed as a permutation of the frames.
    const orderCount = Math.max(0, Math.min(ev.getInt16(at.playOrderCount, true), at.maxPlayOrder));
    const order: number[] = [];
    for (let s = 0; s < orderCount; s++) order.push(ev.getInt16(at.playOrder + 2 * s, true) - 1);
    // Ten states in the corpus name frames that do not exist (BLKJACK's
    // `winner`, WIRELESS's tuner lights and FIGHT's two duel lamps all have one
    // frame and a table reaching for a second) — a table authored against art
    // that changed. Those are dropped whole rather than clamped: a step count
    // that disagrees with the frame count is not evidence about anything.
    // A one-step view that borrows its pictures stands on the one it names: the
    // rope's `idle` is step 1 of `start down`'s 21.
    if (source && order.length === 1 && order[0] >= 0 && order[0] < subCount) {
      const keep = order[0];
      for (const list of [frames, degrees, refScales, records, groups]) list.splice(0, list.length, list[keep]);
    }
    let playOrder: number[] | null =
      order.length > 1 && order.every((v) => v >= 0 && v < subCount) ? order : null;
    // A table SHORTER than the art it steps through is vestigial — left behind
    // when the frames were redrawn — and must not be believed. HOUSE.SHP's
    // `flames` is the proof: 21 frames drawn one per bearing around the circle
    // (degrees 0,36,72,…208) with a nine-step table naming only the first three.
    // Honouring that would play three pictures of a fire that has twenty-one.
    // A real script is at least as long as its frames, because its repeats are
    // holds; one unnamed frame is allowed for the settled pose stored beside the
    // swing (FUSE's fusehall has 9 frames and an 8-step table whose 9th frame
    // repeats the 1st by degree; BOIL's boilswitch, 5 and 4, the same).
    //
    // Judged against the STATE here, and against the VARIANT at playSequence:
    // a deg-split state stores the same swing once per variant, so its table is
    // one variant long (the boiler bag, 12 frames and 6 steps) and is perfectly
    // real. So the test cannot be applied at parse time for those.
    const hasDupDeg = degrees.length > 1 && new Set(degrees).size < degrees.length;
    if (playOrder && !hasDupDeg && playOrder.length < subCount - 1) playOrder = null;
    // Is this state a real ANIMATION or a deg-indexed SELECTOR? A selector maps
    // deg -> exactly one frame, so its degrees are all DISTINCT (map/life/navarrow
    // "dark"/"light" = [0,1]; blkjacktable = [0,8,…248]; signs' directions). An
    // animation either has a play script or has DUPLICATE degrees — the deck map's
    // 12-frame "open"/"close" are [0,0,0,0,0,0,1,1,1,1,1,1]: many frames per deg,
    // so deg can't pick among them; they must play. Measured: every 2-frame
    // selector in the corpus stores a step count of 1, so no selector is caught by
    // the first arm.
    const animated = !!playOrder || hasDupDeg;
    states.push({
      identifier,
      location: entryLoc,
      record,
      records,
      frames,
      refScales,
      degrees,
      playOrder,
      animated,
      // v5: the view's flags word, bit 0 "plays once" (see PropState.playsOnce)
      ...(at === STATE_V5 && ed.length >= 0x18 ? { playsOnce: (ev.getUint32(0x14, true) & 1) === 1 } : {}),
      ...(at === STATE_V5 && ed.length >= 0x230 ? { frameTicks: ev.getInt16(0x22e, true), playCount: orderCount } : {}),
      ...(at === STATE_V5 ? { groups, steps: order.length ? order : [0] } : {}),
    });
  }
  orientToSettledPose(states, containers);
  const group: PropGroup = { name, location, scriptContainerLocation, states };
  if (at !== STATE) {
    const d = containers[location].data;
    group.depthRef = new DataView(d.buffer, d.byteOffset, d.byteLength).getInt16(0x14, true);
  }
  return group;
}

/**
 * Geometric identity of a prop frame, from the 8-byte transparent-image header
 * (height, width, posY, posX) — enough to recognise the same pose in another
 * state without decompressing the pixels.
 */
function frameSignature(data: Uint8Array): string {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return `${v.getInt16(0, true)}x${v.getInt16(2, true)}@${v.getInt16(4, true)},${v.getInt16(6, true)}`;
}

/**
 * Second-guess the play-order table where the SHP contradicts itself.
 *
 * A transition animation and the still pose it settles into must line up:
 * `open<S>` has to END on the `idle<S>` frame and `close<S>` has to START from
 * it. TRUNK.SHP's gramdrawer breaks that. Its three wax variants share one
 * order-table convention (open* = 1..N, close* = N..1), but the `1`/`2` art is
 * stored in the OPPOSITE direction from the `12` art, so the table plays those
 * four states backwards: clicking the drawer open showed it already open, slid
 * it shut, then snapped it open again (and the mirror of that on close).
 *
 * So when a state's settled pose sits at the wrong END of the played sequence,
 * flip the sequence. This is a structural check, not a list of known-bad state
 * names, and it only fires on a state that HAS a matching `idle<S>` pose landing
 * on the wrong end — across the shipped corpus (226 prop groups) that is exactly
 * gramdrawer's open1/open2/close1/close2. Every other open/close pair (the
 * boiler door, the four bags, the fusebox switches) already satisfies the
 * invariant and is left untouched.
 *
 * It flips the PLAY SCRIPT where there is one, and the frames themselves only for
 * a state that has none (a deg-split animation, whose sequence is its stored
 * order). Judging the ends by the script matters as much as fixing them by it:
 * the ends of `frames` are not the ends of the animation once a table says
 * otherwise.
 */
function orientToSettledPose(states: PropState[], containers: Container[]): void {
  const settled = new Map<string, string>();
  for (const s of states) {
    if (s.frames.length === 1) {
      settled.set(s.identifier.toLowerCase(), frameSignature(containers[s.frames[0]].data));
    }
  }
  if (!settled.size) return;
  for (const s of states) {
    // a v5 view says its order itself (PropState.steps)
    if (!s.animated || s.frames.length < 2 || s.steps) continue;
    const m = /^(open|close)(.+)$/.exec(s.identifier.toLowerCase());
    if (!m) continue;
    const pose = settled.get(`idle${m[2]}`);
    if (!pose) continue;
    const seq = s.playOrder ?? s.frames.map((_, i) => i);
    const first = frameSignature(containers[s.frames[seq[0]]].data);
    const last = frameSignature(containers[s.frames[seq[seq.length - 1]]].data);
    if (first === last) continue;
    // "open" settles INTO the pose, "close" departs FROM it — finding the pose
    // at the other end means these frames are running the wrong way.
    if (m[1] === "open" ? first !== pose : last !== pose) continue;
    if (s.playOrder) {
      s.playOrder.reverse();
      continue;
    }
    s.frames.reverse();
    s.refScales.reverse();
    s.degrees.reverse();
    s.records.reverse(); // the parallel array of edit targets moves with them
  }
}

export interface ShpFrame {
  width: number;
  height: number;
  /** raw stored position shorts (Y first, X second, center-relative) */
  posYraw: number;
  posXraw: number;
  /** palette indexes, width*height */
  indexed: Uint8Array;
  /** 1 = opaque, 0 = transparent, width*height */
  opaque: Uint8Array;
  /**
   * A DreamFactory 5 sprite's OWN palette, as RGBA. Absent on v1 and v4, whose
   * sprites draw through the palette of whatever they are drawn over.
   */
  palette?: Uint8ClampedArray;
}

/**
 * A DreamFactory 5 SPRI: the v5 prefix, then height 0x1a, width 0x1c, the raw
 * position 0x20/0x22, a 256-entry {blue, green, red, reserved} palette at 0x24,
 * and from 0x424 exactly v4's run stream below — a row-size word and the four
 * run kinds, landing on the width on every row of RedJack's props.
 */
const SPRI = { height: 0x1a, width: 0x1c, posY: 0x20, posX: 0x22, palette: 0x24, pixels: 0x424 } as const;

/**
 * Transparent-image codec used by SHP/STG/prop frames.
 * Port of DFfile::writeTransPNGimage, kept palette-independent: props are
 * colorized at composite time with the ACTIVE SET's palette (the engine
 * shares one CLUT — see the clut/mixclut script commands).
 */
export function decodeShpFrame(data: Uint8Array): ShpFrame {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const v5 = isV5(data, "SPRI");
  const at = v5 ? SPRI : { height: 0, width: 2, posY: 4, posX: 6, pixels: 8 };
  const height = view.getInt16(at.height, true);
  const width = view.getInt16(at.width, true);
  const posYraw = view.getInt16(at.posY, true);
  const posXraw = view.getInt16(at.posX, true);
  let palette: Uint8ClampedArray | undefined;
  if (v5) {
    palette = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++) {
      const p = SPRI.palette + i * 4;
      palette[i * 4] = data[p + 2];
      palette[i * 4 + 1] = data[p + 1];
      palette[i * 4 + 2] = data[p];
      palette[i * 4 + 3] = 255;
    }
  }

  const indexed = new Uint8Array(width * height);
  const opaque = new Uint8Array(width * height);
  let inPos = at.pixels;
  let outPos = 0;

  for (let row = 0; row < height; row++) {
    const segmentSize = view.getInt16(inPos, true);
    inPos += 2;
    const segmentEnd = inPos + segmentSize;
    while (inPos < segmentEnd) {
      const flag = data[inPos++];
      const count = flag >> 2;
      if (flag & 1) {
        if (flag & 2) {
          // literal run: copy `count` palette pixels
          for (let i = 0; i < count; i++) {
            indexed[outPos] = data[inPos++];
            opaque[outPos++] = 1;
          }
        } else {
          // transparent run
          outPos += count;
        }
      } else {
        if (flag & 2) {
          // repeat one palette pixel `count` times
          indexed.fill(data[inPos], outPos, outPos + count);
          opaque.fill(1, outPos, outPos + count);
          outPos += count;
          inPos++;
        } else {
          // copy from previous row
          indexed.copyWithin(outPos, outPos - width, outPos - width + count);
          opaque.copyWithin(outPos, outPos - width, outPos - width + count);
          outPos += count;
        }
      }
    }
  }

  return palette
    ? { width, height, posYraw, posXraw, indexed, opaque, palette }
    : { width, height, posYraw, posXraw, indexed, opaque };
}

/**
 * Encode a frame back into the transparent-image codec — the import path of
 * the puppet editor (editors/puppets.html). Uses the codec's transparent-run,
 * repeat-pixel, literal and copy-from-previous-row modes (run length ≤ 63,
 * the 6 count bits of the flag byte); output round-trips exactly through
 * {@link decodeShpFrame}. The compression need not match CyberFlix's
 * encoder byte-for-byte — any valid run sequence decodes the same.
 */
export function encodeShpFrame(frame: ShpFrame): Uint8Array {
  const { width, height, indexed, opaque } = frame;
  const MAXRUN = 63;
  const chunks: number[] = [];
  const rowStarts: number[] = []; // chunk offset where each row's runs begin

  for (let row = 0; row < height; row++) {
    rowStarts.push(chunks.length);
    const base = row * width;
    let x = 0;
    while (x < width) {
      if (!opaque[base + x]) {
        let n = 1;
        while (x + n < width && !opaque[base + x + n]) n++;
        for (let left = n; left > 0; left -= MAXRUN) {
          chunks.push((Math.min(left, MAXRUN) << 2) | 1);
        }
        x += n;
        continue;
      }
      // opaque pixel: prefer copy-from-previous-row (1 byte/run), then
      // repeat-pixel (2 bytes), else accumulate a literal
      const prevLen = (p: number): number => {
        if (row === 0) return 0;
        let n = 0;
        while (
          p + n < width &&
          n < MAXRUN &&
          opaque[base + p + n] &&
          opaque[base - width + p + n] &&
          indexed[base + p + n] === indexed[base - width + p + n]
        ) n++;
        return n;
      };
      const repLen = (p: number): number => {
        let n = 1;
        while (
          p + n < width &&
          n < MAXRUN &&
          opaque[base + p + n] &&
          indexed[base + p + n] === indexed[base + p]
        ) n++;
        return n;
      };
      const pl = prevLen(x);
      const rl = repLen(x);
      if (pl >= 4 && pl >= rl) {
        chunks.push(pl << 2); // flag bits 00: copy from previous row
        x += pl;
      } else if (rl >= 3) {
        chunks.push((rl << 2) | 2, indexed[base + x]); // repeat one pixel
        x += rl;
      } else {
        // literal run: extend until a cheaper mode would start
        let n = 0;
        while (
          x + n < width &&
          n < MAXRUN &&
          opaque[base + x + n] &&
          !(n > 0 && (prevLen(x + n) >= 4 || repLen(x + n) >= 3))
        ) n++;
        chunks.push((n << 2) | 3);
        for (let i = 0; i < n; i++) chunks.push(indexed[base + x + i]);
        x += n;
      }
    }
  }
  rowStarts.push(chunks.length);

  const out = new Uint8Array(8 + height * 2 + chunks.length);
  const view = new DataView(out.buffer);
  view.setInt16(0, height, true);
  view.setInt16(2, width, true);
  view.setInt16(4, frame.posYraw, true);
  view.setInt16(6, frame.posXraw, true);
  let pos = 8;
  for (let row = 0; row < height; row++) {
    const size = rowStarts[row + 1] - rowStarts[row];
    view.setInt16(pos, size, true);
    pos += 2;
    for (let i = rowStarts[row]; i < rowStarts[row + 1]; i++) out[pos++] = chunks[i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Edits — the write path of the shop editor (editors/shops.html)
// ---------------------------------------------------------------------------
// Every edit but frame art is a copy-on-write patch on ONE container: the shop's
// own name sits in container 0, a prop's name and its state identifiers in that
// prop's group container, a frame's stored degree in the state container, and a
// frame's anchor in the frame container itself. Frame ART is replaced by the
// caller, which swaps a whole container for an `encodeShpFrame` result (see
// taoot/tests/auto/shp-editor.ts).

const i16clamp = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v)));

/**
 * The shop's own stored name (dfet's refName). Scripts reach a shop by FILENAME
 * (`openshopfile("blkjack.shp")`) and a prop by its group name, so this is a
 * label rather than a lookup key — renaming it changes nothing the engine
 * resolves, which is exactly why it is safe to rename.
 */
export function patchShopRefName(shp: ShpFile, name: string): string {
  let stored = shp.refName;
  patchContainerData(shp.file, 0, (d) => {
    stored = writeNameAt(d, C0.refName, name, SHOP_REF_NAME_FIELD);
    // the palette is a window into container 0, which the copy just replaced
    shp.paletteRaw = d.subarray(C0.palette, C0.palette + 256 * 8);
  });
  shp.refName = stored;
  return stored;
}

/** a prop's name — what `sendtoprop`/`propvisible`/`propview` address it by */
export function patchGroupName(shp: ShpFile, groupIdx: number, name: string): string {
  const group = shp.groups[groupIdx];
  if (!group) return "";
  let stored = group.name;
  patchContainerData(shp.file, group.location, (d) => {
    stored = writeNameAt(d, GROUP.name, name, GROUP_NAME_FIELD);
  });
  group.name = stored;
  return stored;
}

/** a state's identifier — the look `propview(prop, "open")` asks for. Stored in
 *  the GROUP container's state table, not in the state container itself. */
export function patchStateIdentifier(
  shp: ShpFile,
  groupIdx: number,
  stateIdx: number,
  identifier: string,
): string {
  const group = shp.groups[groupIdx];
  const state = group?.states[stateIdx];
  if (!group || !state) return "";
  let stored = state.identifier;
  patchContainerData(shp.file, group.location, (d) => {
    stored = writeNameAt(d, state.record + GROUP.entryIdentifier, identifier, STATE_ID_FIELD);
  });
  state.identifier = stored;
  return stored;
}

/**
 * A frame's stored degree — what `propdeg(N)` matches on. The frame it picks is
 * the one whose degree is closest to N, NOT the Nth frame (see
 * {@link PropState.degrees} and frameIndexForDegree in engine/src/runtime/props.ts), so
 * this is the field that decides which art a selector prop shows.
 */
export function patchFrameDegree(
  shp: ShpFile,
  groupIdx: number,
  stateIdx: number,
  frameIdx: number,
  deg: number,
): boolean {
  const state = shp.groups[groupIdx]?.states[stateIdx];
  const record = state?.records[frameIdx];
  if (!state || record === undefined) return false;
  const value = i16clamp(deg);
  const ok = patchContainerData(shp.file, state.location, (d) => {
    new DataView(d.buffer, d.byteOffset, d.byteLength).setInt16(
      record + STATE.frameDegree,
      value,
      true,
    );
  });
  if (ok) state.degrees[frameIdx] = value;
  return ok;
}

/**
 * A frame's stored draw offset, in the frame container's own 8-byte header
 * (Y before X, as everywhere in these formats). The prop draws at
 * `anchor - storedOffset`, anchor defaulting to the screen centre (256,192) and
 * moved by `propxy` — so this is where the cut-out sits relative to that anchor.
 * Every state that references the container sees the change: one frame, one
 * offset, however many states share it.
 */
export function patchFrameAnchor(file: DFContainerFile, loc: number, y: number, x: number): boolean {
  if ((file.containers[loc]?.data.length ?? 0) < 8) return false;
  return patchContainerData(file, loc, (d) => {
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    v.setInt16(4, i16clamp(y), true);
    v.setInt16(6, i16clamp(x), true);
  });
}
