/**
 * Where the Titanic `.ti` save keeps its fields: the prop and actor record
 * grids, the fixed offsets in containers 0 and 1, and the strides of the list
 * and table containers — the layout both the decoders and the patcher read by.
 */

/**
 * Serialized prop records (the inventory container) sit on a fixed 158-byte grid.
 * Like the actor record, a prop record is the live struct dumped verbatim with
 * the numeric fields FIRST: the name is at record+0x4e (TI.EXE's own accessors
 * fetch a record into a stack buffer whose name field sits at buffer+0x4e), the
 * current view (propview state) 48 bytes after the name and the owner
 * (propowner) 64 after it. Offsets here are from the NAME, which is what
 * {@link import("./savegame").walkPropGrid} locks onto; the numeric half is at negative offsets.
 */
export const PROP_STRIDE = 158;
/** `propset` (0x4160b0 reads record+0x5e) and `propstar` (0x416490, +0x6e): the
 *  set a world prop belongs to and the star it was placed on, 16 and 32 bytes
 *  after the name — the same two pstr fields the actor record has there */
export const PROP_SET_OFF = 16;
export const PROP_STAR_OFF = 32;
export const PROP_VIEW_OFF = 48;
export const PROP_OWNER_OFF = 64;
/** the name field's offset inside a prop record (TI.EXE `propvisible` 0x416f30
 *  reads record+0 out of a buffer whose name sits at +0x4e) */
export const PROP_RECORD_OFF = -0x4e;
/**
 * The numeric half of the prop record, mapped from TI.EXE's own getters (each
 * fetches the record and reads its field at a fixed offset): `propvisible`
 * +0 (0x416f30), `propxy` +0x14/+0x16 (0x4175c0 — +0x14 is the screen Y and
 * +0x16 the X: the interface band's props all read (324, 256), the band anchor),
 * `propdeg` +0x18 (0x4168a0), `propxyz` +0x1a/+0x1c/+0x1e (0x4173c0's getter
 * arms, axes 1/2/3 — the world place; SMOKE's card table reads (11262, 3860,
 * 234) in all 82 saves that have it placed, its `buick` star's x, z and y),
 * `propdist` +0x26 (the open pocketwatch's
 * lid/hrs/min/sec read −6/−5/−5/−4, exactly the z-order its `open()` assigns),
 * `propscale` +0x28 (0x416a90), `propvalue` +0x46 (0x416240), `propzclip`
 * +0x4a (0x4162d0), `propis3d` +0x12 (0x417760) — 0/1 in every record, and it is
 * what tells a world-placed prop from a screen-anchored one on load: TAOOT's
 * watch/bag read 1 in exactly the 4 pre-boarding saves where they still lie on
 * the cabin furniture, 0 in the other 105 where they sit in the band. All
 * verified by range across the 109 shipped saves' 72-record grids.
 * (`propspeed` +0x24 is 4 in every record ever written — not worth carrying.)
 */
export const PROP_FIELDS = {
  visible: PROP_RECORD_OFF + 0x00,
  is3d: PROP_RECORD_OFF + 0x12,
  y: PROP_RECORD_OFF + 0x14,
  x: PROP_RECORD_OFF + 0x16,
  deg: PROP_RECORD_OFF + 0x18,
  worldX: PROP_RECORD_OFF + 0x1a,
  worldY: PROP_RECORD_OFF + 0x1c,
  worldZ: PROP_RECORD_OFF + 0x1e,
  dist: PROP_RECORD_OFF + 0x26,
  scale: PROP_RECORD_OFF + 0x28,
  value: PROP_RECORD_OFF + 0x46,
  zclip: PROP_RECORD_OFF + 0x4a,
} as const;

/**
 * Serialized ACTOR records — the cast's persistent state, on its own 160-byte
 * grid in a different container from the props.
 *
 * **A record is the live runtime struct, dumped verbatim**, and TI.EXE's own
 * accessors give the layout field for field. `0x410d00` is the one that fetches a
 * record by name, and it settles both the stride and the frame:
 *
 *     mov eax, [0x4605dc]           ; record index
 *     lea eax, [eax + eax*4]        ; 5i
 *     shl eax, 5                    ; 160i          <- the stride
 *     lea ecx, [eax + ebx + 0x50]   ; &record[i] + 0x50
 *     push ecx / push edi / call 0x435630            ; compare against the NAME
 *     ...
 *     mov ecx, 0x28 / rep movsd     ; hand the caller all 160 bytes
 *
 * so **the name is at +0x50, not at +0**: the five string fields are the record's
 * SECOND half and the numeric fields are the first. Every accessor then reads its
 * own field out of that 160-byte copy, which is how the rest is mapped — each one
 * takes the buffer at `esp+8` (`actorxyz` at `esp+0x10`) and reads:
 *
 *     +0   i16  actorvisible   (0x40eec0, `cmp word ptr [esp+8], 0` — >0 is visible)
 *     +24  i16  actordeg       (0x40e850, `movsx ecx, word ptr [esp+0x20]`)
 *     +26  i16  actorxyz(1)    (0x40f285) — X
 *     +28  i16  actorxyz(2)    (0x40f297) — Z in the SET's file order
 *     +30  i16  actorxyz(3)    (0x40f2a9) — Y
 *     +32  i16  actorturn      (0x410937) — degrees per pass while turning
 *     +38  i16  actorspeed     (0x40ead0, `esp+0x2e`)
 *     +72  i32  actorvalue     (0x410be0, `esp+0x50`)
 *     +76  i16  actorzclip     (0x410c70, `esp+0x54`)
 *     +80  pstr name           +96 set   +112 star   +128 pose   +144 actorowner
 *
 * Checked against all 3465 records of the 109 shipped saves: `visible` is only
 * ever 0 or 1 and no visible record lacks a set; `deg` is 0..255; `speed` is one
 * of {4,5,15,25,30,40,45} and `zclip` one of {-2000…1000, 20000} — in both cases
 * exactly the values the scripts pass to those commands; and for the 2122 records
 * whose star is a real star of their recorded set, (+26,+28,+30) equals that
 * star's position **exactly in 2105 of them (99.2%)**. The 17 that differ are Max
 * mid-patrol on the boat deck and one record parked on the `walktostar` sentinel,
 * i.e. the cases where an actor is genuinely not standing on their star.
 *
 * The offsets below are named against the NAME field, because that is what
 * {@link import("./savegame").walkActorGrid} locks the grid onto — a record's own base is 80 bytes
 * earlier ({@link ACTOR_RECORD_OFF}).
 */
export const ACTOR_STRIDE = 160;
/** the name field's offset inside a record — the grid is located by it */
export const ACTOR_RECORD_OFF = -80;
export const ACTOR_OWNER_OFF = 64;
/**
 * `actorvalue` — how many conversations you have had with this character, and
 * the gate on whether they will approach you again.
 *
 * TAOOT's `runpuppet` ends every exchange with `actorvalue(target,
 * actorvalue(target) + 1)`, and each character's idle reads it back:
 * `if actorvalue(me) <= 0 → hasattention(4)`, else `clearattention()`. So a save
 * that drops it reloads with everyone still remembering, and nobody ever walks
 * up to you again for the rest of the session.
 *
 * A DWORD at record+0x48, i.e. **8 bytes BEFORE the name**, as the disassembly
 * says. It looks as though it does not fit a frame based at the name; the
 * 80-byte shift that reconciles the two is the same one that puts "runtime
 * owner at +144" and "saved owner at +64" in agreement. +152, which is
 * `(name + 160) - 8`, is the same field one record along, and would restore
 * every character with their neighbour's count.
 *
 * +152 looks right because it produces a plausible series —
 * only it belongs to the next record: 0→1→3→5→8→13→21 over disk 1 is **Penny's**,
 * the character you report to after every errand, and Morrow's own is 0→2→3.
 */
export const ACTOR_VALUE_OFF = ACTOR_RECORD_OFF + 0x48;

/**
 * The placement half of the record, all offsets from the NAME — the fields a load
 * needs in order to put the cast back where the player left them rather than
 * re-deriving them from each room's own scripts (#86).
 *
 * `visible` is the one that makes restoring safe at all: without it the only rule
 * available was "place anyone whose recorded set is the set being loaded", which
 * would resurrect everybody who had ever walked through that room, because
 * `putdownactor` hides a character without touching `actorset`.
 */
export const ACTOR_PLACEMENT = {
  visible: ACTOR_RECORD_OFF + 0,
  deg: ACTOR_RECORD_OFF + 24,
  x: ACTOR_RECORD_OFF + 26,
  y: ACTOR_RECORD_OFF + 28,
  z: ACTOR_RECORD_OFF + 30,
  speed: ACTOR_RECORD_OFF + 38,
  /**
   * `actorturn` (0x410937) — degrees of facing per service pass while turning.
   *
   * Only a SCRIPT ever sets this (it is an accessor and nothing else writes it),
   * and a load runs no `openset` to set it again (#143) — so a restored actor
   * left at the runtime's own `0` would, through `stepDeg`'s floor of 1, turn at
   * a tenth of their proper rate for the rest of the session. The
   * turn is sub-second in the original and several seconds long that way, which
   * is most visible in `walktopuppet`: the conversation waits on `iswalk`, so the
   * character stands there rotating before anyone speaks.
   *
   * The field takes exactly two values over the 3465 shipped records, and they
   * separate cleanly: **16** is the engine's default at creation (every one of
   * the 1207 records that names no set, plus 51 placed ones no room ever set),
   * and **10** is `stdturn`, which is what every room passes and what the other
   * 2207 placed records hold. So this is restored verbatim rather than defaulted
   * to `stdturn` — the file already knows which of the two a character had.
   */
  turn: ACTOR_RECORD_OFF + 32,
  /**
   * `actorscale` — confirmed three ways: the accessor (0x40ea40 reads
   * `[esp+0x32]` of a buffer at esp+8 → record+42), the value distribution
   * (4–6 round values per actor across the corpus, 1000 neutral), and the
   * per-character clustering (about one scale per room, because `stdscale` is a
   * per-room constant). It is the field that makes a restored character
   * DRAWABLE — a scale of 0 places and gates correctly but never draws — and
   * it carries the two script overrides `stdscale(set)` cannot reproduce
   * (extra.cst 0003's 2700, gang.cst 1323's stoker at 9000).
   */
  scale: ACTOR_RECORD_OFF + 42,
  zclip: ACTOR_RECORD_OFF + 76,
} as const;
/** the three pstr fields between the name and the owner */
export const ACTOR_SET_OFF = 16;
export const ACTOR_STAR_OFF = 32;
export const ACTOR_POSE_OFF = 48;

/** container 1: current stage/set/scene/view Pascal strings at fixed offsets
 *  (set/scene/view sit on a 16-byte stride) */
export const C1_STAGE = 520;
export const C1_SET = 596;
export const C1_SCENE = 612;
export const C1_VIEW = 628;
/**
 * The engine's displayed-FRAME COUNTER — `frame()`'s own counter at `0x489efa`,
 * saved and restored with the rest of container 1.
 *
 * Container 1 is a verbatim 786-byte dump of `0x489d40`, and the loader
 * (0x4142b2..0x414365) copies all 786 bytes back — but not blindly: it first
 * stashes three 146-byte windows of the LIVE block ([+0, +146), [+146, +292),
 * [+292, +438)) plus the dwords at +778/+782 on the stack, and puts them back
 * after the copy. So exactly `[438, 778)` comes out of the FILE, and the frame
 * counter, at 0x489efa − 0x489d40 = **442**, is inside it. (`framerate` is the
 * dword right after, at 446; it is 3 in all 109 shipped saves, because the
 * scripts that change it — the fencing stage, the turbine — put it back before
 * the player can reach the save menu.)
 *
 * Restoring it is what makes an absolute frame stamp in a global mean anything
 * after a load: BINL.SET's cargo crate asks `frame() - paintframe > 10000` and
 * BOOTFILE stamps `paintframe = frame()` when mission 2 opens, so a counter
 * that kept running from the *session's* start rather than the *game's* would
 * say the ten minutes were up the moment the save came back (#221). Measured across
 * the shipped saves: the counter rises monotonically along each numbered series
 * (disc 1: 64 → 32469 → … → 346349) and every frame stamp in the globals sits a
 * few hundred to a few thousand frames below it.
 */
export const C1_FRAME = 442;
/** container 0 manifest: the open-file records — count at +0x130c, then
 *  260-byte records of { old heap handle u32, path pstr } at +0x1310. */
export const C0_FILE_COUNT = 0x130c;
export const C0_FILE_RECORDS = 0x1310;
export const C0_FILE_STRIDE = 0x104;
/** record kind tag ↔ name, from the `makeloop` builder's 0x4449f0. */
export const LOOP_KINDS = ["", "actor", "prop", "scene", "flat"] as const;

/**
 * The list of OPEN CAST FILES — one 28-byte record per `opencastfile` still in
 * force, laid out like every other list the engine dumps:
 * `[+0/+4 heap ptrs][+8 u32][+12 name: len byte + chars]`.
 *
 * This is what a load needs. A room's crowd is not in
 * its own cast file: `lounge1c.set`, `smoke.set` and `deckbd2.set` each
 * `opencastfile("extra.cst")` from their `openset`, and a load runs no openset
 * (#143). Without this list the eight members the extras are instanced from —
 * `life1 bruce1 jim1 jay1 brown1 paul1 ani1 molly1` — are never loaded,
 * `instanceSource` finds nothing to instance from, and every crowd record is
 * dropped: 344 of them across 39 of the 109 shipped saves, in the three most
 * populated rooms of the endgame (#186).
 *
 * The file says which. 47 of the 109 carry a second record here and it is
 * `extra.cst` in every one — the same 47 that carry crowd records resolving to
 * nothing, which is what identifies the container.
 */
export const CAST_STRIDE = 28;
export const CAST_NAME = 12;

/** the three master service tables' fixed sizes: 32×42 loops, 16×74 crickets,
 *  16×110 walks. The save writer (0x413910) dumps them verbatim, back to back,
 *  right after the string pool — the triple is the fingerprint. */
export const LOOPS_SIZE = 32 * 42;
export const CRICKETS_SIZE = 16 * 74;
export const WALKS_SIZE = 16 * 110;

/**
 * One 110-byte walk slot's field offsets — the record TI.EXE's mover reads
 * (0x443E7C), shared by {@link import("./savegame").decodeWalks} and the writer
 * in {@link import("./savegame").applyPatch} the way {@link ACTOR_PLACEMENT} and
 * PROP_FIELDS are, so an offset correction
 * is one edit and the round trip cannot fall out of step for a field the
 * 16-slot corpus happens not to exercise. See {@link import("./savegame").SavedWalk} for what each
 * field means and which mover writes it.
 */
export const WALK_SLOT = {
  active: 0x00, // u16
  paused: 0x02, // u16
  type: 0x04, // i16 — which mover: 0 turn, 1 line, 3 route
  turnTo: 0x08, // i16 — facing target; -1 once the turn is done
  deg: 0x0a, // i16 — the walk's own copy of the facing
  x: 0x0c, // i16 ×3 — the origin
  y: 0x0e,
  z: 0x10,
  payload: 0x12, // u32 — waypoint container handle, non-zero = has one
  progress: 0x16, // i32
  dx: 0x1a, // i32 ×3 — the deltas the mover SUBTRACTS
  dy: 0x1e,
  dz: 0x22,
  dist: 0x26, // i32 — only the line mover writes it
  actor: 0x2e, // pstr
  star: 0x3e, // pstr — the arrival star
} as const;

/** a track-list record's name field (pstr at +0x16 of the 40-byte descriptor). */
export const TRACK_STRIDE = 40;
export const TRACK_NAME_OFF = 0x16;
/** the three per-track array counts (registered / playing / looping). */
export const TRACK_COUNTS = [4, 6, 8] as const;
/** one 104-byte sound record: index u16, track# u16, volume u16, pan u16, name pstr@8. */
export const SOUND_STRIDE = 104;
