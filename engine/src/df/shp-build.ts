/**
 * Building a SHP shop from nothing — the write side of [`shp.ts`](shp.ts)'s
 * reader. See [`build.ts`](build.ts) for why these modules exist.
 *
 * A shop is the props drawn on top of a room: groups (`door`, `life`), each with
 * named states (`idleclosed`, `openclosed`), each state a list of
 * transparent-codec frames plus the **play-order table** that says which order to
 * run them in.
 *
 * Two things the format does that a builder has to allow for:
 *
 *  - **States share frames.** A door's `openclosed` and `closeclosed` are the
 *    same three pictures with the play order reversed — the file stores the art
 *    once. Pass the same {@link ShpFrame} object to both states and it is written
 *    once; identity is how sharing is expressed.
 *  - **A state need not be an animation.** With distinct per-frame degrees and no
 *    usable play order it is a *selector*, and `propdeg` picks the frame rather
 *    than playing them (the lifesaver menu button works this way).
 */
import { ContainerBuilder, checkName, emptyScript, i16, i32, paletteBlock, pstr } from "./build";
import { ContainerRef, DFContainerFile, writeContainerFile } from "./container";
import {
  GROUP_NAME_FIELD,
  SHOP_REF_NAME_FIELD,
  STATE_ID_FIELD,
  ShpFrame,
  encodeShpFrame,
} from "./shp";

/** container 0: the version tag, the palette, the shop name, the group table */
const C0 = {
  version: 0x02,
  palette: 36,
  /** i32, immediately before the ref name — the offset TI.EXE's shop opener reads
   *  it from (`mov ecx, [ebx+0x924]` at `0x41584b`); see the reader's own note. It
   *  was 20 here as well, so a shop this builder wrote named its main script in a
   *  field no engine reads and left the real one zero (#325). */
  mainScript: 2340,
  refName: 2344,
  groupCount: 2360,
  groupTable: 2364,
  groupEntrySize: 16,
} as const;

/** a group container: the prop's script, its name, its state table */
const GROUP = { script: 38, name: 42, entryCount: 90, entries: 94, entrySize: 32, entryIdentifier: 16 } as const;

/** a state container: the play-order table, the frame count, the frame records */
const STATE = {
  playOrder: 46,
  /** i16: how many steps of the table at {@link STATE.playOrder} are real. The
   *  reader needs this — the table is a step LIST whose entries may repeat, so
   *  its length cannot be inferred from the frame count. */
  playOrderCount: 112,
  frameCount: 114,
  frames: 118,
  frameSize: 44,
  degree: 40,
  refScale: 42,
} as const;

/** the version tag `readShpFile` insists on */
const VERSION_4 = 4;

/** how many entries the play-order table has room for */
const PLAY_ORDER_SLOTS = (STATE.playOrderCount - STATE.playOrder) / 2;

export interface ShpBuildFrame {
  art: ShpFrame;
  /**
   * The frame's stored degree — what `propdeg` selects on when the state is a
   * selector rather than an animation. 0 throughout an animation.
   */
  degree?: number;
  /** the depth scale stored beside it; 96 in the shipped shops */
  refScale?: number;
}

export interface ShpBuildState {
  /** the state name a script sets with `propstate` (≤15 chars) */
  identifier: string;
  /** the frames, in STORED order */
  frames: ShpBuildFrame[];
  /**
   * The play order, **1-based** into `frames`. Omitted, the stored order is
   * written (1, 2, 3…). Pass it reversed for the "same pictures backwards" case,
   * or all zeroes for a selector that is not played at all.
   */
  order?: number[];
}

export interface ShpBuildGroup {
  /** the prop's name, as `sendtoprop` and `propxy` address it (≤47 chars) */
  name: string;
  /** the prop's script; a group may legitimately have none */
  script?: Uint8Array;
  states: ShpBuildState[];
}

export interface ShpBuildOptions {
  /** the colour table, as RGB triples (up to 256 entries) */
  palette: ArrayLike<number>;
  /**
   * The shop's own stored name (dfet's refName, ≤15 chars). Scripts reach a shop
   * by FILENAME, so this is a label rather than a lookup key.
   */
  refName?: string;
  /** the shop main script — `openshop`/`closeshop` and the prop helpers */
  main?: Uint8Array;
  groups: ShpBuildGroup[];
  /** dummy gap containers, as the shipped shops carry */
  gaps?: number;
}

export interface ShpBuildResult {
  file: DFContainerFile;
  /** where each distinct piece of art landed — shared frames appear once */
  frameLocs: Map<ShpFrame, ContainerRef>;
}

/** Assemble a shop. */
export function buildShpFile(opts: ShpBuildOptions): ShpBuildResult {
  const { groups } = opts;
  if (!groups.length) throw new Error("shp: a shop needs at least one group");

  const b = new ContainerBuilder();
  const { data: c0 } = b.reserve(C0.groupTable + groups.length * C0.groupEntrySize);
  i32(c0, C0.version, VERSION_4);
  c0.set(paletteBlock(opts.palette), C0.palette);
  if (opts.refName !== undefined) {
    checkName("shp: shop", opts.refName, SHOP_REF_NAME_FIELD);
    pstr(c0, C0.refName, opts.refName, SHOP_REF_NAME_FIELD);
  }
  i32(c0, C0.mainScript, b.add(opts.main ?? emptyScript()));
  for (let g = 0; g < (opts.gaps ?? 0); g++) b.gap();

  // one container per distinct piece of art: two states of the same animation
  // played in opposite directions are the same pictures, and the file says so
  const frameLocs = new Map<ShpFrame, ContainerRef>();
  const artLoc = (art: ShpFrame): ContainerRef => {
    let loc = frameLocs.get(art);
    if (loc === undefined) frameLocs.set(art, (loc = b.add(encodeShpFrame(art))));
    return loc;
  };

  const stateBlock = (state: ShpBuildState): ContainerRef => {
    const order = state.order ?? state.frames.map((_, i) => i + 1);
    if (order.length > PLAY_ORDER_SLOTS) {
      throw new Error(`shp: state "${state.identifier}" play order is longer than ${PLAY_ORDER_SLOTS}`);
    }
    const locs = state.frames.map((f) => artLoc(f.art));
    const d = new Uint8Array(STATE.frames + state.frames.length * STATE.frameSize);
    order.forEach((o, i) => i16(d, STATE.playOrder + i * 2, o));
    i16(d, STATE.playOrderCount, order.length);
    i32(d, STATE.frameCount, state.frames.length);
    state.frames.forEach((f, i) => {
      const at = STATE.frames + i * STATE.frameSize;
      i32(d, at, locs[i]);
      i16(d, at + STATE.degree, f.degree ?? 0);
      i16(d, at + STATE.refScale, f.refScale ?? 96);
    });
    return b.add(d);
  };

  i32(c0, C0.groupCount, groups.length);
  groups.forEach((group, g) => {
    checkName("shp: group", group.name, GROUP_NAME_FIELD);
    for (const s of group.states) checkName("shp: state", s.identifier, STATE_ID_FIELD);
    const scriptLoc = group.script ? b.add(group.script) : 0;
    const stateLocs = group.states.map(stateBlock);

    const d = new Uint8Array(GROUP.entries + group.states.length * GROUP.entrySize);
    i32(d, GROUP.script, scriptLoc);
    pstr(d, GROUP.name, group.name, GROUP_NAME_FIELD);
    i32(d, GROUP.entryCount, group.states.length);
    group.states.forEach((s, i) => {
      const at = GROUP.entries + i * GROUP.entrySize;
      i32(d, at, stateLocs[i]);
      pstr(d, at + GROUP.entryIdentifier, s.identifier, STATE_ID_FIELD);
    });
    i32(c0, C0.groupTable + g * C0.groupEntrySize, b.add(d));
  });

  return { file: b.finish(), frameLocs };
}

/** {@link buildShpFile}, serialized */
export function buildShpBytes(opts: ShpBuildOptions): Uint8Array {
  return writeContainerFile(buildShpFile(opts).file);
}
