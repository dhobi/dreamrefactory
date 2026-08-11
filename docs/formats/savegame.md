# Saved games (`.ti`)

*Prerequisite: [The DFile container format](README.md) and
[STG — stage files & the UI](stg.md).*

When you pick **Save** on the control stage (`CTL.STG`), the game runs the
`savegame("Titanic 1.0")` builtin, which pops the native *Save As* dialog and
writes a `.ti` file. **Load game** runs `opengame`, which reads one back. The
example saves under `gamefiles/<lang>/save/**/*.ti` were produced by the shipped
`TI.EXE`.

Reference implementation:
[`src/df/savegame.ts`](https://github.com/dhobi/taoot-web/blob/master/src/df/savegame.ts)
(the byte format) and
[`src/engine/saveload.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/saveload.ts)
(what the session puts in and takes out — see
**[Saving & loading at runtime](../runtime/saves.md)**, which also covers the
in-browser saved-games UI).

## A save is a DFile with a different signature

A save file is the **same container skeleton** as every other game file — a
1024-byte header, a position table, then numbered containers — but two header
bytes mark it as a save rather than a room:

| Offset | Value in a save | Value in a normal game file |
|-------:|-----------------|-----------------------------|
| 0 (`fourCC`) | `0x00010000` | file-specific |
| 32 (signature) | `ODTRTRFD` | `LPPALPPA` |

`opengame` checks both (and the `"Titanic 1.0"` version string, below) — the
error messages *"This is not a valid saved game file."* and *"This saved game
is from a different version of this title."* come from these checks.

### Packing is fixed and reproducible

Unlike the RAM-garbage padding inside the containers (see below), the **file
layout is deterministic**, so we can rewrite a save and reproduce every byte the
loader reads (the output is not byte-identical — we zero the ignored regions the
original left junk in, see below):

- container 0 always begins at offset **1536** (1024-byte header + a 512-byte,
  128-entry position-table region);
- every later container is aligned to a **64-byte** boundary after the previous
  container's data;
- the file size is rounded up to 64.

The bytes *between* the position table and 1536, and the padding *between*
containers, are leftover process memory (stale heap pointers) — the loader never
reads them. We zero-fill them; the original left junk there. Everything the
loader actually reads (header fields, position table, and each container's
`id`/`size`/`data`) round-trips exactly across all shipped saves.

## It is a memory dump, not a tidy document

The containers are a **serialization of the engine's live C++ object graph**.
Many records embed raw process pointers (`0x7c91056d`, `0x01d2…`, a DFValue
vtable at `0x00431e0f`) that mean nothing on reload — the loader rebuilds them.
Two consequences:

- The **number and order of containers varies per save** (24 in an early save,
  21 in another): a save serializes exactly the shops, tracks, casts and scenes
  that happen to be open, so a busier room writes more containers.
- To *read* a save you skip the pointers and take the names, counts and values;
  to *write* one byte-compatibly you reproduce the meaningful bytes and may put
  anything (we use zeros) where the loader expects an ignored pointer.

## What each container holds

Roles were recovered empirically (diffing the same record across many saves to
separate stable structure from per-run pointers). Indices drift with the open-
file set; the notable fixed ones are 0 and 1.

| Container | Contents |
|-----------|----------|
| **0** | header block: `"Titanic 1.0"` version (Pascal string @0), disk family `"Titanic1"`/`"Titanic2"` (@256), the *Save As* / tour directory paths, and the open-file manifest (`.set`/`.trk`/`.shp` paths) |
| **1** | current location: stage file (@520, `"main.stg"`), set base (@596), scene (@612), view (@628) — all at fixed offsets |
| 2 / 3 | actor (CST) state + the cast file (`gang.cst`) — see [The actor container](#the-actor-container-fixed-160-byte-actor-records) |
| 4 | inventory (all loaded props): the runtime state of every open prop, inventory items first — see [The inventory container](#the-inventory-container-fixed-158-byte-prop-records) |
| 5 / 6 | open shops (`.shp`) / tracks (`.trk`) |
| 7…(var) | per-shop prop runtime state (doors, switches, the smokestack puzzle…) |
| (var) | music / sound-loop state |
| **globals** | the script global variables — the core story progress (`clock`, `phase`, `mission`, `playerdeath`, every `…phase`/`…count`, the boiler pressures, the minigame state…) |
| **globals + 1** | the globals' **string pool**: every string-valued variable's text, as `[len][chars]` entries. The loader reads the pair together (TI.EXE stores the pool handle at globals-blob `+0x10`) |
| location | a clean Pascal-string stream: facing direction, road, ground coordinates, the current clock-event script, and the set/stage/flat names |
| (var) | active loops (`makeloop`), positional crickets (`makecricket`), puppet/conversation state |

## The actor container: fixed 160-byte actor records

The actor container is a grid of **160-byte** records, and each one is **the live
runtime struct dumped verbatim** — which is why the frame is the whole difficulty.
It is tempting to read a record as beginning at its name, the way the prop grid
does. It does not, and TI.EXE says so: `0x410d00` is the routine that fetches a
record by name, and it computes the record with a stride of 160
(`lea eax,[eax+eax*4]; shl eax,5`), string-compares against **`record+0x50`**, and
then `rep movsd`s all 160 bytes to the caller.

So the **name is at +0x50**: the five string fields are the record's *second* half
and every numeric field sits before them. Each accessor then reads its own field out
of that copy, which is how the rest is mapped — the buffer is at `esp+8`, or
`esp+0x10` for `actorxyz`:

| Offset | Type | Field | Recovered from |
|-------:|------|-------|----------------|
| +0 | i16 | **`actorvisible`** — >0 is on screen | `0x40eec0` |
| +24 | i16 | `actordeg`, 0..255 | `0x40e850` |
| +26 / +28 / +30 | i16 | `actorxyz` 1/2/3 — the SET's own X, Z, Y order | `0x40f285/97/a9` |
| +38 | i16 | `actorspeed` | `0x40ead0` |
| +72 | i32 | `actorvalue` — conversations had | `0x410be0` |
| +76 | i16 | `actorzclip` | `0x410c70` |
| +80 | pstr | actor (cast member) **name** | the grid |
| +96 | pstr | the **set** the actor is in (`"deckbd"`, `"control"`, `"gym"`) | |
| +112 | pstr | `actorstar` — the spot they were put on, or a walk sentinel | |
| +128 | pstr | `actorpose` (`"stand"` / `"walk"` / `"dead"`) | |
| +144 | pstr | **`actorowner`** | |

Every offset above is checked against all **3465 records of the 109 shipped saves**:
`actorvisible` is only ever 0 or 1 and no visible record lacks a set; `deg` stays
inside 0..255; `speed` and `zclip` only ever hold values a script passes to those
commands. The decisive one is the position — for the 2122 records naming a star that
really is a star of the set they also name, the coordinates are **that star's,
exactly, in 2105 (99.2%)**. The 17 that differ are Max mid-patrol on the boat deck
and one record parked on the `walktostar` sentinel, i.e. an actor genuinely not
standing on his star. No other framing of these bytes produces that.

Two conclusions were drawn from the wrong frame and are worth recording as traps.
`actorvalue` was read at name+152 — which is `(name+160)−8`, the same field one
record along — so every character was restored with their **neighbour's**
conversation count, and that count gates whether anyone ever walks up to you again;
the plausible series 0→1→3→5→8→13→21 belongs to Penny, not Morrow (his is 0→2→3).
And the numeric half, read from the name, lands in the *next* record's heap pointers,
which is what made the positions look like uninterpretable junk. **Validate a binary
frame by range, not by whether the values look plausible.**

`actorowner` is the one-word memory each character keeps of the player, and it
is a story gate, not decoration: the Purser's whole mission-2 errand is a ladder
of his (`none → sendgram → sentgram → left1 → none2 → findcuff → foundcuff →
left2`), Morrow's permission to enter the wireless room is `"enterwireless"`, and
the chief engineer's turbine job is `actorowner("csea")`. The port did not save
it at all until this was found, which cost more than it looks: a playthrough
checkpoint taken at the wireless came back with the Purser at `"none"` — the
telegram in your hand unexplained and his ladder reset — and it also produced a
*wrong measurement*, that Morrow has to be re-persuaded after the mission
rollover. He does not; the save had simply forgotten him. `resetpupvars()` zeroes
the puppet's globals (`morrowphase`), not actor owners.

Ground truth is the shipped save named for that exact moment: `1/12 - Sending
Telegram for Jack Thayer.ti` holds `purs` at c2+3760 with `"sendgram"` 64 bytes
later, plus `morrow → "enterwireless"`, `csea → "thanks1"`, `vlad → "help"`,
`max → "yofrank"`.

Finding the container is by grid, with one trap worth knowing: the **globals**
container is an array of 32-byte nodes and 32 divides 160, so every fifth node
sits one actor stride from the last and a pair of variable names 64 bytes apart
decodes as a perfect name/owner record. Three shipped saves (ENDGAME2 09/12/13)
prefer it to their real actor container on record count alone, and a patch would
then write actor owners over variable names — so the globals container, its pool
and the prop container are excluded explicitly.

The whole record is written and restored: the memory of the player (owner, value)
and the placement half. The **crowd extras are not**, and cannot be — `setupgroup`
makes them per room from `EXTRA.CST`, so which of them exist varies from save to save
(25 records to 64, the named cast constant and the extras churning) and a patch-write
cannot grow the container. Every one of the 109 shipped saves does hold a record for
all 25 named characters, so those never want for a slot. See
[Saving & loading at runtime](../runtime/saves.md#the-actor-record) for what the load
does with them, and why the arriving room still gets the last word.

## The globals container: 32-byte variable nodes + a string pool

The most important container pair for *loading* holds the script variables. The
globals container is a small blob header followed by an array of **32-byte list
nodes** on a 32-byte grid.

The blob header describes its own storage, which is what makes it safe to write
into (measured across all 109 shipped saves):

| Offset | Type | Field |
|-------:|------|-------|
| +0 | u16 | *unknown* — reads as a node count in `1/01` (96, against 96 names) and cannot be one in `1/04` (92, against the same 96). Never written |
| +2 | u16 | node array **capacity**: `container length = 20 + 32 × capacity`, in all 109 |
| +8 | u32 | the string pool's **allocation watermark** (next free offset) — exactly the end of the highest string any variable points at in 81 of the 109, and past it in the rest (an allocation whose variable was later overwritten) |
| +12 | u32 | the string pool's **size** — 2048, and equal to the pool container's length, in all 109 |
| +16 | u32 | the pool's heap pointer (rebuilt on load) |

Each node's fields sit at fixed offsets:

| Offset | Type | Field |
|-------:|------|-------|
| +0 | u32 | heap pointer (ignored) |
| +4 | u32 | heap pointer (ignored) |
| +8 | — | **name**: one length byte + characters, in a 12-byte buffer (trailing bytes are uninitialised) |
| +20 | u32 | DFValue **vtable** `0x00431e0f` (constant — the reliable anchor for finding nodes) |
| +24 | u16 | **type tag** (2, 3 or 4) |
| +26 | 16-bit | **value** |
| +28 | … | trailing fields / padding |

### The crucial subtlety: a name pairs with the PREVIOUS node's value

The C++ object is laid out `[DFValue][links][name]` — the name comes **last** in
the struct — so on the 32-byte grid, **the DFValue in node *k* belongs to the
name in node *k+1***. Reading the name and the value out of the same 32-byte
window (the "obvious" pairing) silently mis-assigns *every* variable to its
neighbour's value: it yields plausible-looking but wrong numbers (`neckphase=3`
where the truth is `neckphase=5`, `mission=0` instead of `2`) and turns every
string variable into apparent garbage. This mis-pairing is what previously led
us to believe type-3 values were "unrecoverable heap pointers / atom ids" — they
are not; see below. (Recovered by decompiling TI.EXE's `savegame` writer —
container *N* = the live variables blob, container *N+1* = the pool handle
stored at blob `+0x10` — and confirmed by same-session DosBox save pairs:
after saving on the poop deck the shifted pairing reads `oldset="stair2c"`,
`newset="poop"`; keyboard bindings decode as `keynorth="w"`, `keyeast="d"`,
`keywest="a"`; `mainpath="titanic2:"`.)

Two quirks:

- The **first** name in the list (`clock`) pairs with the blob header, which
  holds no DFValue — it is not decodable here. (Its value, the pending
  clock-event script, is recovered from the location container instead.)
- Names of 12–15 characters **overflow** the 12-byte name buffer and clobber
  the low bytes of their own node's vtable (`curattention`, `attentionspan`) —
  a DreamFactory quirk the engine tolerates; validation must skip the
  clobbered bytes.

### Value semantics by type tag

Each node's `+20..+27` is a serialized `DFValue`:

- **type 2 / type 4 → number**, stored inline as the signed i16 at `+26`.
- **type 3 → string**: `+26` (unsigned) is the **byte offset of the string in
  the string-pool container** that follows the globals container. The pool is a
  2048-byte block of `[len][chars]` entries — a *live engine structure saved and
  restored wholesale*, which is why the offsets stay valid across processes
  (this is how the original restores string variables; there is no rebuilt atom
  table).

With the corrected pairing, save 20 ("Meeting Conkling in his suite") decodes
completely and self-consistently: `mission=2`, `letterphase=3` (a plain number —
satisfying the B59 knock's `letterphase = 2 | letterphase = 3`, so Conkling says
*"Come in"* exactly as the original does), `neckphase=5`, `hrs/min/sec` =
10:50:42 PM, `hallside="star"`, `savedeck="b"`, `newset="hallb"`,
`oldset="stair1c1"`, `fusebox="1,1,1,1,1,"`, `coalchute="coal4"`,
`savetheme="decka.trk"`, `handitem=""`.

**Loader policy** ([`parseSave`](https://github.com/dhobi/taoot-web/blob/master/src/df/savegame.ts)):
`decodeVars` walks the grid with the shifted pairing and decodes both kinds —
numbers into `numGlobals`, strings (via the pool) into `strGlobals`; both are
restored into the interpreter on load. Duplicate names keep the first
occurrence (the engine's lookup walks the list from the head).

**Writing** ([`applyPatch`](https://github.com/dhobi/taoot-web/blob/master/src/df/savegame.ts))
targets the same shifted slot: numbers are written inline and tagged type 4,
strings as a pool offset tagged type 3.

### Writing must not lengthen a container

The rule that governs both of the below: **a save has to load in the original
engine, not only in this port.** The blob declares its own storage (capacity at
+2, pool size at +12) and TI.EXE allocates from those declarations and copies the
containers into them — so a container that has outgrown its own header is either
truncated on load (the state silently lost) or copied past the end of its block.
This port would never notice: it resolves a string by offset and walks nodes to
the end of the container. So nothing here changes any container's length.

- **A string the pool lacks** is allocated the way the original allocator does:
  inside the block, with the watermark bumped by `1 + len`. It starts at the
  watermark *or past the end of any string a record still points at*, whichever is
  higher — usually identical (both 118 in the template, which has 1930 of its 2048
  bytes free), but in 28 of the 109 saves a record holds a stale offset above the
  watermark, pointing at zeroed space that decodes as `""` (the blackjack
  down-cards, `saveeast`). Writing under one of those would turn that variable's
  `""` into whatever landed there. (The first version of this appended past the
  container's end instead — round-tripped perfectly here, and would not have
  survived DosBox.)
- **A global the base has no record for** gets one in a FREE node slot. A `.ti`
  carries the variable list that existed when it was taken and the engine creates
  a global on first assignment, so an early save simply has no record for a later
  one: `savedeck` and `hallside` are missing from exactly the four pre-boarding
  saves of the 109, and `shippedSaveTemplate` picks the first file in `save/1`,
  which is one of them — 12 of the globals the engine holds by mission 2 could
  not be written at all. Every shipped save has free slots (4 in that template,
  26 in one of the boiler saves): the array is allocated at `capacity` and the
  engine takes the next slot when a script assigns a new global, which is exactly
  the gesture being reproduced, at the same stride, inside the same block.

  The pairing quirk does the linking: the last named node's own DFValue belongs
  to nobody (dangling, and zero in every shipped save), so a name written one
  stride past it adopts that DFValue and leaves its own as the next dangling one.
  Nothing to relink. (It is *unused*, not necessarily zero: it is zeroed in only 12
  of the 109 — elsewhere it holds heap junk with an impossible type tag — and it is
  overwritten either way.)

  The u16 at +0 is not touched, and the reason matters for whether any of this
  works in the original engine: it **cannot** be the list's length, so the loader
  cannot be walking it as a count, so a record in a free slot is read like any
  other. `1/01` makes it look like a count (96, against 96 names); `1/12` reads 95
  against 112 names, and the 17 past it are live game state — `boiler=20000`,
  `condtemp=10`, `electricity=78`, `saveeast="d"`. A loader that stopped at 95
  would lose the entire turbine plant.

Free slots and pool bytes are finite, so a patch can still leave something out.
Which globals get the slots is ordered by what a load cannot recover any other
way (`savedeck`, `hallside` first — they decide where you come back standing),
and anything dropped is **reported** through `SavePatch.onDrop` rather than
vanishing. `zeitclue` vanishing quietly once cost a mission.

### What is verified, and what is not

Everything above is **measured** — but measured *here*, and against the 109
shipped `.ti` files, never in DosBox. That distinction is the whole risk of
writing saves at all, so here is the split.

**From the shipped files** (written by the real engine), all 109 unless stated:

- the actor grid, its stride and its `name@+0`/`owner@+64` layout, cross-checked
  against what the scripts do with those values;
- `globals length = 20 + 32 × capacity` (the u16 at +2), and the pool container's
  length equal to the size the blob declares at +12;
- the pool's allocator watermark at +8 — exactly the end of the highest string any
  record points at in 81 of them;
- free node slots at the end of the array (98 of 109 have at least one; 11 have
  none, and as a base they would carry nothing new);
- `attentionspan`/`curattention` proving that a name longer than 11 characters
  overflows into its own vtable and the engine tolerates it — which is why a made
  record writes the vtable FIRST and the name over the top of it, the same
  collision the original loses;
- every `actorowner` fitting the 15-character field (the longest any script assigns
  is `readhackerclue`).

**The one thing that needed more than shape** is whether the loader walks a
*count*, which would make a record in a free slot invisible to it. It does not, and
the files say so — [the u16 at +0 cannot be a
length](#writing-must-not-lengthen-a-container).

**Not verified: TI.EXE's loader itself.** The design is built to need as little of
it as possible — no container changes length, so no allocation-size assumption is
made anywhere; a new string is written past every offset any record resolves to, so
no record's value can change under it; and a new node is written at the same
stride, with the same vtable, in space real saves also leave. The result *should*
be indistinguishable from a save the original wrote, and "should" is doing work in
that sentence until someone loads `out/checkpoints/m2gram.ti` in DosBox — walk to
the wireless room after it and the Purser should still be expecting his telegram
(`actorowner("purs") = "sendgram"`), with the staircase showing C deck. `opengame`
is at `0x413860` and the load routine it calls at `0x414080`, which is where to
pick up the disassembly if the file alone is not enough.

**Two route "facts" have been produced by save bugs**, which is the practical
argument for fixing these before trusting a measurement taken after a load. A
checkpoint that dropped actor owners produced "Morrow has to be re-persuaded after
the mission rollover" — he does not, the save had forgotten him. And `zeitclue`
vanishing quietly once cost a whole mission.

### The location container is a savestate stack (fallbacks)

The location container is a **stack of location snapshots** (the `savestage`
checkpoints plus the current position), each a run of Pascal strings holding a
set/flat name, coordinates, facing, and — for hallway snapshots — the side you
were facing (`"port"`/`"star"`).

`hallside` and `savedeck` now decode directly from their variable records; the
loader keeps two location-stack fallbacks for saves whose record doesn't decode:
the last `"port"`/`"star"` token in the stack (the most-recently-pushed = current
side), and the current hall/deck set's deck letter. `hallside` matters because
halla's `keydown` guard is `if hallside != "star" & hallside != "port" error()` —
an invalid value makes `error()` swallow **every** key, so a loaded hall save
couldn't walk or leave the deck.

## The inventory container: fixed 158-byte prop records

The inventory container serializes the **runtime state of every loaded prop** —
the `inven.shp` items first, then the interface/control-panel props — as an array
of fixed **158-byte records**. Within each record the fields sit at constant
offsets from the record start:

| Offset | Field |
|-------:|-------|
| +0 | prop name (Pascal string) |
| +48 | current `propview` state — `"large"`, `"panel1"`, `"panel2"`, … |
| +64 | `propowner` — `"frank"` = in Frank's possession, else `"none"`/`"vlad"`/`"purser"`/… |

The two disks differ in how a collected item is shown (disk 1 stows to `panel1`;
disk 2 keeps it `large`), so the loader restores the raw `owner`+`view` verbatim
per item rather than interpreting them — the `inven.shp` scripts read exactly
those fields to draw the bag and quick-slots. `decodeVars`' sibling
`walkPropGrid` locks onto the 158-byte grid (the same anti-junk technique as the
variable grid) and yields one `{name, view, owner}` per slot.

## How the web port loads a save

Rather than reconstruct every subsystem from the pointer-laden containers, the
port loads the way the game itself does: restore the **globals** (numbers and
strings — the core story progress) and the **clock**, tear down the old room's timed state,
then **travel** to the saved set/scene/view (`initall` = changeset + initactors
+ initprops) and let the normal `openset`/`openscene` scripts rebuild the loops,
props, crickets and music at the restored mission/phase.

The **cast is put back from the file** rather than re-derived: set, star, pose,
position, facing, speed, zclip and `actorvisible` straight out of
[the actor record](#the-actor-container-fixed-160-byte-actor-records). *Where* that
happens in the load matters more than it looks — after the departing room's
`closeset`, which is entitled to put its own people down, and before the `changeset`,
so the arriving room keeps the last word over the ones it places. And `actorscale`
does **not** come from the record; it comes from the game's own `stdscale`, without
which a restored character is invisible even though every script can see them. Both
points are worked through in
[Saving & loading at runtime](../runtime/saves.md#loading-restore-globals-then-travel),
and both were faults in the first pass at
[#86](https://github.com/dhobi/taoot-web/issues/86). See
`GameSession.loadGame` / `snapshotSave` in
[`src/engine/session.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/session.ts)
and the `savegame`/`opengame` builtins in
[`src/engine/builtins/savegame.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/builtins/savegame.ts).
`initall` seeds the *default* inventory for the mission, so the loader then
overwrites each `inven.shp` prop's owner + view with the player's actual
collected items from the inventory container (`GameSession.restoreInventory`).

Writing patches a base save (the last one loaded, or a host-supplied per-disk
template) with the current globals, set/scene/view, the live inventory (each
`inven.shp` prop's owner + view, written back into the inventory container's fixed
+48/+64 fields) — without which a save would keep the base's stale inventory — **and
the cast**, both halves of each named character's record. The crowd extras are
skipped, for the reasons in the actor-container section above.

Back to the [format index](README.md), or on to how the running game uses
this: **[Saving & loading at runtime](../runtime/saves.md)**.
