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

> **Dust writes the same file.** DreamFactory 1's `.rtd` saves share this
> envelope byte for byte — the same `fourCC`, the same `ODTRTRFD`, the same
> position table and 64-byte alignment — so the reader and writer below take them
> unchanged. What differs is the offsets inside two containers and four record
> strides: see **[Saved games, DreamFactory 1 (`.rtd`)](savegame-v1.md)**.

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
They still have to be treated as pointers rather than as magic numbers, which is
a lesson this format charged us for once: see
[Finding the grid](#finding-the-grid-the-vtable-is-a-pointer).
Two consequences:

- The **number of containers varies per save** (24 in an early save, 21 in
  another) but the **order does not**. The writer is a single routine
  (`0x413910`, called by `savegame`'s implementation at `0x4137a0`) and it emits
  its containers in one fixed sequence, below; the count varies by exactly
  **(open files) + 3 × (open tracks) + (active walks carrying a waypoint
  payload)**. All 109 shipped saves match that map positionally, with no
  exceptions.
- To *read* a save you skip the pointers and take the names, counts and values;
  to *write* one byte-compatibly you reproduce the meaningful bytes and may put
  anything (we use zeros) where the loader expects an ignored pointer.

## What each container holds

The roles were first recovered empirically (diffing the same record across many
saves to separate stable structure from per-run pointers); the order below is
the writer's own, read out of `0x413910` and then checked positionally against
all 109 shipped saves.

| Container | Contents |
|-----------|----------|
| **0** | manifest, built on the stack: `"Titanic 1.0"` version (Pascal string @0), disk family `"Titanic1"`/`"Titanic2"` (@+0x104), nine 256-byte path slots (@+0x1fc — the *Save As* / tour directories), the **live CLUT** (@+0xb0c, 256 × {i16 index, i16 rgb[3]} — the loader copies it into the palette global and applies it, `0x414aa8..0x414b07`; the lower 128 entries are the open set's own palette table and a cross-room patch must replace them or the room comes back in the old room's colours), the open-file count (@+0x130c), then one **260-byte record per open file** at +0x1310: the file's **old heap handle** (u32) followed by its path as a Pascal string (`titanic2:data:cargo.set`). The handle is not junk — it is the key every other container's file references resolve through, see [how the loader re-opens the room](#the-loader-re-opens-the-room-from-the-manifest-not-from-the-set-name) |
| **1** | current location, a fixed 786 bytes from `0x489d40`: the **frame counter** (@442 — see [below](#the-frame-counter-c1-442)), stage file (@520, `"main.stg"`), the open **set file's old handle** (@544 — resolved through the manifest, above), set base (@596), scene (@612), view (@628), the set's **actor / main-scene register container refs** (@644 / @652) and the scene register's **record count** (@656 — the loader's scene lookup walks exactly this many records; equal to the set's scene count in all 109 shipped saves) |
| **2** | the cast: n × 160-byte actor records — see [The actor container](#the-actor-container-fixed-160-byte-actor-records) |
| **3** | open casts: n × 28 (two pointers, a u32, the `.cst` filename as a Pascal string at +12). **A load has to reopen these** — the room's crowd is instanced from them and no `openset` runs to open them itself; see [The crowd comes from this container](#the-crowd-comes-from-this-container) |
| **4** | inventory — every loaded prop: **72 × 158** in every shipped save, inventory items first — see [The inventory container](#the-inventory-container-fixed-158-byte-prop-records) |
| **5** | open shops (`.shp`): n × 28, the same shape as the casts |
| **6** | open tracks: n × 40-byte descriptors. **A load has to reopen all of them**, not just the one that was playing — see [The track containers](#the-track-containers-what-was-playing) |
| 7 … 6+3n | **three containers per open track**, in descriptor order: the track's registered, playing and looping sound lists, 104 bytes per record. Counts come from the descriptor's `+4`/`+6`/`+8` |
| **globals** | the script global variables — the core story progress (`clock`, `phase`, `mission`, `playerdeath`, every `…phase`/`…count`, the boiler pressures, the minigame state…) |
| **globals + 1** | the globals' **string pool**: every string-valued variable's text, as `[len][chars]` entries. The loader reads the pair together (TI.EXE stores the pool handle at globals-blob `+0x10`) |
| +2 | the **loops** table, verbatim: `0x540` = 32 × 42 |
| +3 | the **crickets** table, verbatim: `0x4a0` = 16 × 74 |
| +4 | the **walks** table, verbatim: `0x6e0` = 16 × 110 |
| (var) | one **waypoint payload** container per active walk slot whose handle at `+0x12` is non-null — see [The scheduler containers](#the-scheduler-containers-loops-crickets-and-walks) |

The three tables at the end are not a serialization of anything: `0x442530`
sits directly in front of the master service pass `0x442550` and hands back
pointers to its own three tables (`0x48bcd0` loops, `0x48b830` crickets,
`0x48b150` walks), which the writer `memcpy`s into the file. The save *is* the
live scheduler.

(There is **no location-stream container**. A "savestate stack" of facing, road,
coordinate and set strings was long believed to have one — see
[the container that wasn't there](#the-location-container-that-wasnt-there).)

### The crowd comes from this container

Container 3 was mapped early and read late, and the gap cost the game its extras.

A room's crowd is not in the boot cast. `gang.cst` is opened once at boot and
holds the 25 named characters; the eight members the extras are instanced from —
`life1 bruce1 jim1 jay1 brown1 paul1 ani1 molly1` — live in **`extra.cst`**, which
`lounge1c.set`, `smoke.set` and `deckbd2.set` each `opencastfile` from their own
`openset`.

A load runs no `openset` ([#143](https://github.com/dhobi/taoot-web/issues/143)).
So the file was never opened, the crowd records had no cast member to be
re-instanced from, and `restoreActors` dropped every one of them. Measured across
the 109 shipped English saves:

| | |
|---|---|
| saves listing `extra.cst` here | **47 of 109** |
| saves restoring a room with **placed, visible** characters that resolved to nothing | **39 of 109** |
| such records | **344** |

Worst case `ENDGAME1/09 - Traded letter for Baby` (deckbd2), 39 records. The three
affected sets are the most populated rooms of the endgame, so a loaded game was
visibly emptier than the game that was saved.

The identification is the correlation: the 47 saves whose container 3 carries a
second record carry `extra.cst` in **every** one, and they are exactly the 47 with
crowd records that resolve to nothing. Reopening what the list names fixes all
344 ([#186](https://github.com/dhobi/taoot-web/issues/186)).

Two things worth keeping in mind:

- **The list is the file's, not a guess from the set being entered.** The save
  records what was open, which is precisely the question being asked.
- **A cast file the previous room had open and the save does not name is left
  open**, not closed. It is inert — `resetCast` puts every member down, and a
  member the file has no record for stays down.

It went unnoticed because `restoreActors` *logs* a drop rather than failing, and
the saves the suite leant on hardest are in rooms that only ever need `gang.cst`.
The regression added with the fix is the assertion that would have caught it:
every record with a set and `visible`, in every shipped save, has to resolve to a
live actor after the load.

## The loader re-opens the room from the manifest, not from the set name

The set base name at c1 @596 is written and restored, but it is **not what the
loader opens**. `opengame`'s resume re-opens every file the container-0 manifest
names, then (`0x41514a`) takes the set file's **old handle from c1 @544**, finds
the manifest record whose first dword matches (`0x4153f0` — a miss is its own
fatal, line 0x1127), and treats **that record's path** as the open set. It then
reads the set's scene register from the container refs restored at **c1 @644 /
@652** and looks the saved scene and view names up in it (`0x43a0b0`) — walking
exactly **c1 @656** records, a count that is restored verbatim and never
recomputed from the file it just read. A scene the walk doesn't reach raises
error 10 → **"Fatal error at line 4248 (code 2)"**, and there are two ways to
earn it: the manifest still pathing another room's set, and a base set with
fewer scenes than the current one, whose smaller count hides the tail of the
register (crew's 2 hid cargo's Scene4–6 — both happened, in that order, on the
first DosBox loads). The casts, shops and tracks resolve the same way: each of
their records leads with an old handle that is matched against the manifest
(`0x4152e0` with the `ODCC`/`ODDP`/`GNOS`/`ODCS` type tags).

Measured across all 109 shipped saves: c1 @544 matches exactly one manifest
record, that record's path names a set file whose scene register contains the
save's scene (the name compare is case-insensitive — the registers store
`Scene10`, the saves `scene10`), and @644/@652 equal that file's own register
refs from its container-0 header.

**Only the basename of that path is read.** Between finding the record and
opening the file, the resolver hands the buffer to `0x42bc20`, which strips
everything up to and including the LAST `":"` — `titanic2:data:cargo.set` becomes
`cargo.set` — and `0x429e30` opens *that*, through the resource path table, in the
same call the engine uses for a script's own `opensetfile("cargo.set")`. So the
volume and directory a record carries are decoration: which disc the file comes
off is settled by the mounted CD (container 0 @256), not by the prefix. Which is
why a patch may keep the base's prefix even when the story has crossed to the
other disc since — it names the wrong volume and nothing reads it.

The consequence for writing: a patch that changes the room **must re-path the
manifest's set record and rewrite the register refs and the scene count**
(`SavePatch.setFile` — the record's id is left alone so everything else still
resolves). This was found the hard way: the port's first DosBox-tested save
carried `crew.set` in the manifest and `cargo`/`scene4` in c1, so TI.EXE
restored the crew hallway and died at line 4248 looking for a scene it could
never have; the second, with the manifest fixed, kept crew's scene count of 2
and died at the same line with cargo's Scene5 sitting unreachable at register
index 4. (A correlation sweep of every u16/u32 in c1's tail against the sets'
own facts — scene index, view index/ID/count, register record offsets,
viewport — matches nothing else across the 109; @656 is the only set-shape
field the blob restores.)

## The frame counter (c1 @442)

Container 1 is a verbatim dump of the 786 bytes at `0x489d40`, and the loader
copies all 786 back — but not blindly. Before the copy (`0x4142b2`) it stashes
**three 146-byte windows** of the live block on the stack — `[+0, +146)`,
`[+146, +292)`, `[+292, +438)` — along with the dwords at `+778` and `+782`, and
puts them all back afterwards (`0x41431b..0x414365`). So the range the *file*
actually gets to restore is exactly **`[438, 778)`**, and the first thing in it
is the engine's displayed-**frame counter**, `0x489efa − 0x489d40` = **@442**.
(`framerate` is the dword after it, @446. It reads 3 in all 109 shipped saves:
the scripts that change it — the fencing stage, the turbine — put it back before
the player can reach the save menu.)

The counter is what `frame()` answers with (`0x4273b0` fetches it; `0x439b80`
bumps it once per pass, 20 a second — see
[timing](../runtime/timing.md#framerate-and-frame-paced-by-the-clock-not-by-the-display)),
and restoring it is what makes an absolute frame stamp in a global mean
anything after a load. BOOTFILE's `advancephase` writes `paintframe = frame()`
when mission 2 opens and BINL.SET's cargo crate asks
`frame() - paintframe > 10000`, so a counter that kept running from the
*session's* start rather than the *saved game's* declared the ten minutes over
the instant the save came back — the painting gone, on a save taken with it
still in the crate
([#221](https://github.com/dhobi/taoot-web/issues/221)). Measured across the
corpus: the counter rises monotonically along each numbered series (disc 1:
64 → 32469 → … → 346349) and no [frame stamp](#how-wide-is-the-value-32-bits)
in the globals ever exceeds its own save's.

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
| +2 / +6 | ptr | the CST file and the member's data handle (rebuilt; `actorlock`'s unlock path `0x411ab0` locks +6 and re-reads container +14 from file +2) | `0x411ab0` |
| +10 / +14 | u16 | the member's **logic / script container locations** in its CST — `logicLocation` and `logicLocation + 1`, 3101 of 3101 named-member records | the CST files |
| +18 | i16 | **placed flag** — 1 iff the record names a set (2258/2258 vs 0/1207): assigned a place at least once, and `putdownactor` hides without clearing it | the corpus |
| +24 | i16 | `actordeg`, 0..255 | `0x40e850` |
| +26 / +28 / +30 | i16 | `actorxyz` 1/2/3 — the SET's own X, Z, Y order | `0x40f285/97/a9` |
| +32 | i16 | **`actorturn`** — degrees per service pass while turning. Exactly two values over the 3465 records: **16** (the engine's default at creation — every record naming no set, plus 51 placed ones) and **10** (`stdturn`, the other 2207 placed). Carried by the port since [#191](https://github.com/dhobi/taoot-web/issues/191); before that a load left it 0 and every restored character turned ten times too slowly | `0x410937` |
| +34 | i16 | current **step** within the pose (the walk cycle's frame; < the count at +36 in 2959 of 3101) | the corpus |
| +36 | i16 | **step count** of the current pose, cached (stand = 1, the gang's walk = 20 — matches the CST pose tables) | the CST files |
| +38 | i16 | `actorspeed` | `0x40ead0` |
| +42 | i16 | **`actorscale`** — 1000 is neutral | `0x40ea40` |
| +46 | i16 | a **creation counter** — per save, member *k* of the cast reads base+*k* with the base growing monotonically over the session (save `1/01` reads 5,6,7…; late saves read 8125+). Engine bookkeeping, nothing to restore | the corpus |
| +72 | i32 | `actorvalue` — conversations had | `0x410be0` |
| +76 | i16 | `actorzclip` | `0x410c70` |
| +78 | i16 | resource-**lock** flag (`actorlock` `0x411950`/`0x411ab0` pin/release the sprite data) | `0x41195a` |
| +80 | pstr | actor (cast member) **name** | the grid |
| +96 | pstr | the **set** the actor is in (`"deckbd"`, `"control"`, `"gym"`) | |
| +112 | pstr | `actorstar` — the spot they were put on, or a walk sentinel | |
| +128 | pstr | `actorpose` (`"stand"` / `"walk"` / `"dead"`) | |
| +144 | pstr | **`actorowner`** | |

With those, the record's numeric half has **no unexplained structure left**: what
is not a restorable field is resource bookkeeping the loader rebuilds (the
pointers, the lock, the container locations — implicit in the member's name) or
animation scratch the next service pass overwrites (step, step count, the
counter). Nothing here changes what a load restores.

Every offset above is checked against all **3465 records of the 109 shipped saves**:
`actorvisible` is only ever 0 or 1 and no visible record lacks a set; `deg` stays
inside 0..255; `speed` and `zclip` only ever hold values a script passes to those
commands. The decisive one is the position — for the 2122 records naming a star that
really is a star of the set they also name, the coordinates are **that star's,
exactly, in 2105 (99.2%)**. The 17 that differ are Max mid-patrol on the boat deck
and one record parked on the `walktostar` sentinel, i.e. an actor genuinely not
standing on his star. No other framing of these bytes produces that.

`actorscale` at **+42** is the late addition, and it is confirmed three ways: the
accessor (`0x40ea40` reads `[esp+0x32]` of a buffer at `esp+8`, i.e. record+42),
the value distribution (a handful of round values per actor, 1000 neutral), and
the per-character clustering — about one scale per room, which is what `stdscale`
being a table of per-room constants predicts. It is the field that makes a
restored character **drawable**: a record put back with scale 0 is placed
correctly and gates every script correctly, and is never drawn. It also carries
the two script overrides `stdscale(currentset())` cannot reproduce (`gang.cst`
1323's stoker at 9000, `extra.cst` 0003's 2700), which is why the port now reads
it from the record and writes it back rather than asking the cast — see
[Saving & loading at runtime](../runtime/saves.md#loading-restore-the-engine-from-the-file).

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
and the placement half — including, since #143, the **crowd extras**. This page
used to say they were not written *and could not be*, because a patch-write cannot
grow a container. That is true of the globals blob, which declares its own storage,
and it is **not** true here: the actor container has no self-declared capacity at
all. TI.EXE's save writer dumps the live actor-list handle, and its loader
(`0x4143d2`) duplicates the read container's handle straight back into the
actor-list global — so the record count is **implicit in the container's size**, and
one more 160-byte record on the end is one more actor. Which is exactly why the
shipped saves disagree about how many there are: `setupgroup` makes the deck extras
per room from `EXTRA.CST`, and the corpus runs from 25 records to 64, the named cast
constant and the extras churning. Every one of the 109 does hold a record for all 25
named characters, so those never want for a slot; a crowd record the base save lacks
is now **appended**. That mattered as soon as the load stopped re-running the room:
the file is the only witness left to a crowd nobody is going to remake. See
[Saving & loading at runtime](../runtime/saves.md#the-actor-record) for what the load
does with them.

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
| +12 | u32 | the string pool's **size** — equal to the pool container's length in all 109, but *not* a constant: 8 of them hold 4102–4105 (`1/36 - Found the Notebook!`, `2/08 - Showing Pipe to Trask`, `ENDGAME1/10`, `ENDGAME2/10` among them) and the rest 2048. The engine does grow the pool, so a from-scratch writer may pick any size as long as the blob declares it |
| +16 | u32 | the pool's heap pointer (rebuilt on load) |

Each node's fields sit at fixed offsets:

| Offset | Type | Field |
|-------:|------|-------|
| +0 | u32 | heap pointer (ignored) |
| +4 | u32 | heap pointer (ignored) |
| +8 | — | **name**: one length byte + characters, in a 12-byte buffer (trailing bytes are uninitialised) |
| +20 | u32 | DFValue **vtable** — a raw code pointer, **not a constant**: `0x00431e0f` in all 109 shipped saves, `0x87c4596f` in a player's own (#179). It is still what the node grid is found by, but the value has to be read out of the file rather than matched against ours — see [Finding the grid](#finding-the-grid-the-vtable-is-a-pointer) |
| +24 | u16 | **type tag** (2, 3 or 4) |
| +26 | i32 | **value** (see [How wide is the value?](#how-wide-is-the-value-32-bits)) |
| +30 | … | trailing padding |

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

### Finding the grid: the vtable is a pointer

The node array is located by the word at `+20`, because it is the one field
whose value repeats across every node. What it is *not* is a format constant.
It is the address of the DFValue vtable in the running engine, dumped along
with the object, and it is only stable for as long as the engine is loaded at
the same address.

All 109 shipped saves read `0x00431e0f`, which made that look like a fact about
the format for a long time. A save Nicholas Mischler made in his own DosBox
reads `0x87c4596f` — the same game, somewhere else in memory. Matching the
corpus's byte pattern found nothing in it, so the reader decoded **zero**
variables, and a load applied an empty map: the right room opened with the
previous game's mission, phase and every other global still in place (#179 —
Trask still showing you the clock, a shawl in your hand three missions before it
exists). Nothing about that announces itself as a parse failure, which is why it
was reported as a room bug.

So the grid is found by **agreement** instead: whatever address a session ran
at, all of its nodes carry the same one, and the most common word at `+20`
across the container wins by about a hundred to one. Nodes whose names are
12–15 characters clobber their own vtable (see below) and are left out of the
vote. `nodeVtable` in `src/df/savegame.ts`; the fixture and the regression are
`tests/data/M4P0FCL.ti` and `tests/auto/save-original.ts`, the one save test
that needs no copy of the rip.

The **writer** reads the same value rather than stamping ours: a save the port
writes patches the file that was loaded, so a record made for a new global goes
into a grid that may be foreign. Stamped with the corpus's constant, that node
is one neither reader ever finds again.

Two quirks:

- The **first** name in the list (`clock`) pairs one stride BACK, into the blob
  header, whose bytes past the pool handle turn out to be its real DFValue —
  see `decodeVarSlots`, and the measurement in its comment (missions 0–3 read
  type 3 → "bedsit"; every mission-4 save reads type 4 → `hrs*100+min`, exactly
  what BOOTFILE's `calctime` writes there).
- Names of 12–15 characters **overflow** the 12-byte name buffer and clobber
  the low bytes of their own node's vtable (`curattention`, `attentionspan`) —
  a DreamFactory quirk the engine tolerates; validation must skip the
  clobbered bytes.

### Value semantics by type tag

Each node's `+20..+27` is a serialized `DFValue`:

- **type 2 → boolean**, stored inline as the 16-bit 0/1 at `+26`. This is what
  a script's `true`/`false` produce, and it is **a distinct runtime type, not a
  second spelling of number**: TI.EXE's boolean-taking commands demand exactly
  tag 2 (`propvisible`'s argument fetch is `cmp word [esp], 2` at `0x416ed8`)
  and its number-taking ones exactly tag 4 (~30 `cmp …, 4` → error-14 sites).
  Feeding the wrong tag is the ignorable-but-endless DosBox dialog *"A
  scripting error has occured … [Bad argument type.]"* (interpreter error 14 =
  string 1100+14). This page used to say "type 2 / type 4 → number", and the
  merged reading survived every corpus measurement because both carry an
  inline 16-bit value — it took loading a port-written save in the real
  engine, and bisecting the resulting dialog down to exactly ten `02→04` tag
  bytes, to split them. The port's writer therefore **preserves a tag-2
  record's tag** while the value stays 0/1 (its interpreter carries booleans
  as numbers, so the tag is the only witness), and lets a non-boolean value
  retype the record the way an assignment in the original would.
- **type 4 → number**, stored inline as the signed i32 at `+26`.
- **type 3 → string**: `+26` (unsigned) is the **byte offset of the string in
  the string-pool container** that follows the globals container. The pool is a
  block of `[len][chars]` entries, 2048 bytes in most saves and about 4100 in the
  eight the engine grew it in — a *live engine structure saved and
  restored wholesale*, which is why the offsets stay valid across processes
  (this is how the original restores string variables; there is no rebuilt atom
  table).

### How wide is the value? 32 bits

A word was read here for a long time, and nothing in the game's own story state
minds: a phase, a count, a clock reading and a pool offset all fit in 16 bits,
and the boolean tag carries 0/1. What does not fit is the other thing a script
can put in a variable — a **`frame()` reading**. The counter runs at 20 Hz, so it
leaves 32767 behind after 27 minutes of play, and TAOOT stamps four globals with
it: `paintframe`, `lastsail`, `jonesframe` and `secframe`.

The node has room for the full dword — the value field runs `+26..+30` inside a
32-byte node, and TI.EXE's `frame` handler (`0x4273b0`) writes one:
`mov ecx, [0x489efa]` / `mov [eax+2], ecx`. The corpus settles it. Across all
109 shipped saves the high word at `+28` is **0 in every string (3380 records)
and every boolean (1015)**, and non-zero in exactly six numbers — every one of
which reads as noise truncated to a word and as the obvious thing at full width:

| Variable | i32 | as i16 |
|----------|----:|-------:|
| `lowmemory` | 6144000 (a byte count — 6 MB) | −16384 |
| `condensor` | 40000 | −25536 |
| `paintframe` | 165697 | −30911 |
| `lastsail` | 156350 … 314751 | assorted |
| `jonesframe` | 337079 | 9399 |
| `secframe` | 347697 … 352610 | assorted |

and each of the frame stamps lands a few hundred to a few thousand frames below
its own save's [frame counter](#the-frame-counter-c1-442), which is the
relationship the game reads them for. Truncating `paintframe` is what stopped
the cargo hold's ten-minute painting timer from surviving a save
([#221](https://github.com/dhobi/taoot-web/issues/221)).

With the corrected pairing, save 20 ("Meeting Conkling in his suite") decodes
completely and self-consistently: `mission=2`, `letterphase=3` (a plain number —
satisfying the B59 knock's `letterphase = 2 | letterphase = 3`, so Conkling says
*"Come in"* exactly as the original does), `neckphase=5`, `hrs/min/sec` =
10:50:42 PM, `hallside="star"`, `savedeck="b"`, `newset="hallb"`,
`oldset="stair1c1"`, `fusebox="1,1,1,1,1,"`, `coalchute="coal4"`,
`savetheme="decka.trk"`, `handitem=""`. (`savetheme` is the theme to restore after
an interlude, *not* what was playing — see
[the track containers](#the-track-containers-what-was-playing).)

**Loader policy** ([`parseSave`](https://github.com/dhobi/taoot-web/blob/master/src/df/savegame.ts)):
`decodeVars` walks the grid with the shifted pairing and decodes both kinds —
numbers into `numGlobals`, strings (via the pool) into `strGlobals`; both are
restored into the interpreter on load. Duplicate names keep the first
occurrence (the engine's lookup walks the list from the head).

**Writing** ([`applyPatch`](https://github.com/dhobi/taoot-web/blob/master/src/df/savegame.ts))
targets the same shifted slot: numbers are written inline and tagged type 4,
strings as a pool offset tagged type 3.

### Writing must not lengthen this container

The rule that governs both of the below: **a save has to load in the original
engine, not only in this port.** The blob declares its own storage (capacity at
+2, pool size at +12) and TI.EXE allocates from those declarations and copies the
containers into them — so a container that has outgrown its own header is either
truncated on load (the state silently lost) or copied past the end of its block.
This port would never notice: it resolves a string by offset and walks nodes to
the end of the container. So nothing here changes the globals pair's length.

The rule is about **a header that declares its own storage**, not about save files
in general — which is why
[the actor container](#the-actor-container-fixed-160-byte-actor-records) *can* be
grown a record at a time: it declares nothing, and TI.EXE's loader takes its record
count from the container's size.

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
length](#writing-must-not-lengthen-this-container).

**Not verified: TI.EXE's loader itself.** The design is built to need as little of
it as possible — no container that declares its own storage changes length, so no
allocation-size assumption is made anywhere; a new string is written past every
offset any record resolves to, so no record's value can change under it; and a new
node is written at the same stride, with the base's *own* vtable, in space real
saves also leave. The one container that *is* grown, the actor grid, is grown because the
disassembly says its count comes from its size (`0x4143d2`) — a claim about the
loader, and so on this list rather than off it. The result *should*
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

### The location container that wasn't there

This page used to describe a "location container": a clean Pascal-string stream of
facing, road, coordinates and set names, read as a **stack of location snapshots**,
with two loader fallbacks hanging off it (`hallside` from its last
`"port"`/`"star"` token, `savedeck` from the hall set's deck letter). Decompiling
the writer ended that: its fixed order emits no such container, and the heuristic
that "found" one was locking onto the **string pool** — measured, in 109 of 109
shipped saves — whose entries are the same facing/side/coordinate strings, in
allocation order, because they are the string *globals'* values (`savestage1-3`
and friends).

The fallbacks it fed also never fired. Exactly 4 shipped saves lack a decodable
`hallside` record, all pre-boarding (bedsit1/c73), and none of their pools hold a
side token, because no hallway had ever been entered — an unset `hallside` is what
a fresh game has until the first hall assigns one. So `hallside` now decodes from
its variable record alone (it still matters: halla's `keydown` guard is
`if hallside != "star" & hallside != "port" error()`, which swallows **every** key
on an invalid value), and `savedeck` keeps only the set-derived deck-letter
fallback, which never depended on the phantom container.

## The inventory container: fixed 158-byte prop records

The inventory container serializes the **runtime state of every loaded prop** —
the `inven.shp` items first, then the interface/control-panel props — as an array
of fixed **158-byte records**.

**Every loaded prop, with no filtering**, is literally the rule. The writer
(`0x413910`) walks the engine's live prop list — `+0x24` is a node's name, `+0x540`
its next pointer — and copies one fixed-size record per node until the list runs
out. Measured across the 109 shipped saves: **72 records in every single one**,
exactly the two boot shops' props (`inven.shp`'s 28 then `house.shp`'s 44), in
**one** order across all 109 files, none missing and no extras. So the original
draws no distinction between an inventory item, a story object and a bit of
interface furniture; a save taken with a room's own shop open would simply hold
more records.

Within each record the fields sit at constant offsets. As with the actor grid the
record is the **live object dumped verbatim**, so the numeric fields come *before*
the name and TI.EXE's own accessors give the frame — each fetches its record into a
local buffer whose name field sits at `buffer+0x4e`:

| From the base | From the name | Type | Field |
|--------------:|--------------:|------|-------|
| +0 | −0x4e | i16 | `propvisible` (`0x416f30`, `cmp word ptr [esp+8], 0` — >0 is shown) |
| +0x0a / +0x0e | −0x44 / −0x40 | u16 | the group's **logic / script container locations** in its SHP — `location` and `location + 1`, **7848 of 7848** records against the parsed boot shops. Rebuilt from the name on load |
| +0x12 | −0x3c | i16 | `propis3d` (`0x417760`) — strictly 0/1 across the corpus. 1 = placed in the world (`propxyz`), so the x/y anchor below is stale; the loader restores this flag, since the live one is whatever the running game last did (TAOOT's watch/bag: 1 in exactly the 4 pre-boarding saves where they still lie on the cabin furniture, 0 in the 105 where they sit in the band) |
| +0x14 / +0x16 | −0x3a / −0x38 | i16 | `propxy` (`0x4175c0`): **+0x14 is the screen Y and +0x16 the X**. The interface band's props all read x = 256, y = 324 — the band anchor |
| +0x18 | −0x36 | i16 | `propdeg` (`0x4168a0`, `movsx ecx, word ptr [esp+0x20]`) |
| +0x20 | −0x2e | i16 | current **frame** within the view — a valid index in 7848 of 7848 (`0 ≤ frame < max(1, play length)`) |
| +0x22 | −0x2c | i16 | **play length** of the current view: the frame count for a real animation, **1 for a deg-selector state** (which shows one frame) — 7404 of 7848; the misses cluster on states whose animated bit the engine decides at play time |
| +0x24 | −0x2a | i16 | `propspeed` (`0x416b20`) — **4 in every record ever written**; nothing changes a prop's speed |
| +0x26 | −0x28 | i16 | `propdist` — z-order, more negative = nearer |
| +0x28 | −0x26 | i16 | `propscale` (`0x416a90`) — 10 distinct values in the corpus, about 1.1 per prop |
| +0x46 | −0x08 | u32 | `propvalue` (`0x416240`) — 0 or 1 in the corpus |
| +0x4a | −0x04 | i16 | `propzclip` (`0x4162d0`) — 7 distinct values |
| +0x4e | +0 | pstr | prop **name** |
| +0x7e | +48 | pstr | current `propview` state (`0x416610`, `lea ecx, [esp+0x86]`) — `"large"`, `"panel1"`, … |
| +0x8e | +64 | pstr | `propowner` (`0x4161c0`, `lea ecx, [esp+0x96]`) — `"frank"` = in Frank's possession, else `"none"`/`"vlad"`/`"purser"`/… |

The offsets that matter for reading are the ones from the **record base**, because
that is what the getters use; the second column is the same field measured from the
name, which is what [`walkPropGrid`](https://github.com/dhobi/taoot-web/blob/master/src/df/savegame.ts)
locks the grid onto — so every numeric field is at a *negative* offset there, and
every read of one is bounds-checked at both ends.

`view` and `owner` are 16 bytes apart, which is what fixes the name at `+0x4e` and
makes the two empirically-recovered offsets (+48/+64) and the disassembly agree.
Both string fields hold a length byte + up to 15 characters — the longest `owner`
in the whole corpus is `"xxxfrank"` (8) and the longest `view` is
`"deckbd-wireless"` at exactly 15.

`propvisible` checks out by range against the corpus, on the one prop where it can
be read against something independent: the baby is `visible = 1` in exactly the 3
saves whose `propowner` is `"frank"` and `0` in all 106 others. `propdist` gets the
same kind of independent check from the open pocketwatch, whose four pieces read
−6/−5/−5/−4 for lid/hrs/min/sec — exactly the z-order stack the watch's own `open()`
assigns them, in that order.

Still structured but unnamed — all engine bookkeeping, none of it restorable
state: `+0x1a`–`+0x1e` (animation timing scratch — non-zero only on the two
ever-animated big-scale props, the watch and the bag, with tick-sized values),
`+0x30` (a per-prop constant across all 109 — 0 for the inventory items, small
ordinals for some interface chrome; not the state index, not the shop-wide state
ordinal, both tested), and `+0x34`…`+0x42`, eight consecutive small words that
look like two screen rects (last-drawn bounds). The pointer columns are
`+0x02`/`+0x04`, `+0x06`/`+0x08` (always `0x9f`/`0xa6` heap) and `+0x2c`. As with
the actor record, everything a load could *use* is already named.

The two disks differ in how a collected item is shown (disk 1 stows to `panel1`;
disk 2 keeps it `large`), so the loader restores the raw `owner`+`view` verbatim
per item rather than interpreting them — the `inven.shp` scripts read exactly
those fields to draw the bag and quick-slots. `decodeVars`' sibling
`walkPropGrid` locks onto the 158-byte grid (the same anti-junk technique as the
variable grid) and yields one record per slot — name, view, owner and the whole
numeric half.

### What we write back

`applyPatch` overwrites a record **in place**, in records the original wrote: the
two string fields (`view`, `owner`) and the whole numeric half — `visible`, the
screen anchor, `deg`, `dist`, `scale`, `value` and `zclip`. A prop with no record
in the base is skipped: unlike
[the actor container](#the-actor-container-fixed-160-byte-actor-records), this one
is not grown, and the extras it would take — the props of a room's own shop, on top
of the two boot shops' 72 — are furniture that room rebuilds anyway.
`inventorySnapshot` offers every prop the engine has loaded, in the engine's own
list order — the same rule as above, arrived at after a hand-kept list came up
short twice (first the bag/pocketwatch/deck map, then `baby`; see
[runtime/saves.md](../runtime/saves.md)).

**This used to be `view` and `owner` only, and the rationale is worth keeping as
history.** The argument was that the game re-derives the rest per room —
`setupsigns()` picks the destination sign from where you stand, `showinterface()`
re-derives `propvisible` from the owner, `setuparrow()` recolours the nav arrow —
so writing our value over the original engine's reading would replace a real
measurement with a worse guess. Measured against four saves spanning the game, our
`owner` agreed with the file for **72 of 72** props while the `view` disagreed for
**6–8** (`navtoggle`, `subtoggle`, `invenctl`, `lid`, `invenhelp`, `door`, `signs`,
`wiremsg`) — a real disagreement, and at the time the room was going to overwrite
those fields anyway, so the base's value was the better one to keep.

#143 removed the premise. The load no longer runs `showinterface`, `setupsigns` or
`setuparrow` — it runs no room script at all — so **the file's values *are* the
restore**, and a field left unwritten is a field the base save gets to decide. The
port therefore writes every one of them, and the disagreement above is now the
port's own state being written where the room used to have the last word. The one
field still withheld is a **`view` the port has never set**: an untouched prop is
sitting in its file default and `""` is not a reading, so the base's stays.

## The scheduler containers: loops, crickets and walks

The last three fixed containers are the **master service pass's own tables,
dumped verbatim**. `0x442530` sits directly in front of the service pass
`0x442550` and hands back pointers to `0x48bcd0` (loops), `0x48b830` (crickets)
and `0x48b150` (walks); the writer `memcpy`s all three, which is why their
lengths are constants — 1344 / 1184 / 1760 — in every save. The triple is also
the cheapest fingerprint for finding them:
[`findSchedulerIndex`](https://github.com/dhobi/taoot-web/blob/master/src/df/savegame.ts)
looks for three consecutive containers of exactly those sizes.

There is **no separate "puppet container"**. The parked-conversation state this
page used to list as an unknown is the walks table plus its per-walk payload —
a character mid-`walkto` is the only "in-flight" thing the format carries.

### The loop record — 42 bytes (`makeloop`, builder `0x442950`)

| Offset | Type | Field |
|-------:|------|-------|
| +0 | u16 | active — the slot is free if 0 |
| +2 | u16 | busy — in-service reentrancy flag; 0 in every shipped record |
| +4 | u16 | **kind**: 1 = actor, 2 = prop, 3 = scene, 4 = flat (`0x4449f0`) |
| +6 | u32 | period — ticks remaining, mid-count, on the engine's 50 ms service step |
| +10 | pstr16 | name — the actor/prop/scene the loop belongs to |
| +26 | pstr16 | handler script |

It decodes cleanly in 109 of 109: `actor ga → gaidle`, `actor purs →
playcrickets`, `scene scene49 → smethknock` at `per = 278`, the stoker's dig
loops, the extras' `extraidle` — every record a real script at a sane countdown.
This table is what a load used to have to rebuild by re-running the arriving
room's `openset`: the idles that make characters act, and the scene timers.

### The cricket record — 74 bytes (`makecricket`, builder `0x444130`)

| Offset | Type | Field |
|-------:|------|-------|
| +0 / +2 | u16 | active / busy |
| +4 / +6 | i16 | x / y |
| +8 | u32 | radius |
| +0xc | u32 | base period |
| +0x10 | i32 | jitter (−1 = none, i.e. a one-shot) |
| +0x14 | u32 | next fire = base + rand(jitter), mid-count |
| +0x18 / +0x1a | i16 | listener x / y at make-time |
| +0x1c | u32 | distance to the listener |
| +0x20 | u16 | pan / angle (`0x444b70(dx, dy)`) |
| +0x2a | pstr16 | the **set** it was made in (the global at `0x489f94`) |
| +0x3a | pstr16 | cricket / sound name |

The corpus holds 15 distinct crickets, all real room ambience: `party1` at
(5683, 148) with `rad = 2000` in `deckbd2`, `piston3` at `rad = 7000`,
`jit = −1` in `engine`, `citycricket` at `base = 45` in `bedsit1`. The four
fields from `+0x18` on are the service pass's own working state — listener
position, distance and pan at the moment the cricket last fired — and are
recomputed the next time it does, which is why the port writes zeros there and
a centred pan.

### The walk record's payload

A walk record is the 110 bytes mapped before (+4 type, +0xa deg, +0xc/+0xe/+0x10
xyz, +0x16 progress, +0x2e actor), with one field that had no meaning until the
writer was read: **`+0x12` is a handle to the walk's waypoint path**, and only
type-3 walks have one. Each active slot with a non-null handle appends **one
payload container** after the walks table:

| Offset | Type | Field |
|-------:|------|-------|
| +0 | u32 | total path length |
| +4 | u32 | *(unread; 0 in every authored path and every shipped payload)* |
| +8 | u32 | **waypoint count** |
| +12 | 4 × i16 | the path's **bounding box** — (Zmin, Xmin, Zmax, Xmax), see below |
| +20… | count × 8 | waypoints: i16 x, y, z, u16 segment length |

The block is the set file's **authored path structure**, verbatim — the same
`{total, 0, count, bbox, points}` that `readStarPath` (src/df/set.ts) reads out
of a star record's path container. `walkonpath` COPIES the authored block and
adjusts the points: snapped to the live stars' positions, reversed when the
walker starts from the `b` end (2/33's `hack` walks his authored path
backwards), legs and total recomputed to match. **The box is copied unchanged**,
which is why the shipped payloads' boxes fit their authored polylines exactly —
byte-identical at +12 with `deckbd`'s `ga.1→ga.2` and `scot3`'s `hack1→hack2` —
and miss their own runtime points by the width of the snap. It reads as noise
until the two files are put side by side; this page called it "the current
segment" for as long as they weren't.

The container is the raw allocation, so a row or two of slack trails it. The
loader (`0x4149bd`) `memcpy`s the walks table back and then, for each active
slot with `+0x12 ≠ 0`, reads the next container and **stores the new handle back
at `+0x12`** — which is what closes the round trip and also proves the payloads
are in slot order.

Exactly **3 of the 109** shipped saves carry one, and their trailing containers
match: `1/20 - Meeting Conkling in his suite - B59` (36 bytes),
`2/05 - Talking with Max` (108) and `2/33 - Got clue from Jack Hacker` (92). In
`2/05` it is ga's 10 waypoints marching x = 4498 → 6787 at constant z — a
mid-`walkto` across the boat deck, serialized.

**The port resumes a walk from all of this** — see [Loading, step
11](../runtime/saves.md). The record holds the origin, the deltas, the distance
and the progress, and a route holds its waypoints and its length here, so the
walker sets off from where the save caught them with only what was left to run.
Rebuilding the position from these fields lands on the actor record's own for
every live slot in the corpus, which is what says they are read right.

Two things to hold on to. The **type is which mover**, and only type 1 fills the
record's movement words in: a type-0 turn has no mover, and a type-3 route keeps
its length in the payload, so both leave those words holding whatever the slot
held last (`hack`'s route claims a distance of −1422655421). And a walk that
cannot be put back is **dropped and its walker stood up** — an actor steps
through its pose's play script whether a walk is running or not, so a drop that
left the walk pose alone leaves a character treadmilling.

**The port writes one too** ([#191](https://github.com/dhobi/taoot-web/issues/191)).
It used to zero the walks table instead, because a base slot left active would send
the original's loader looking for a payload container belonging to the previous
save's moment — correct for as long as we wrote nothing, and an asymmetry a player
met the moment they saved mid-conversation-approach (`walktopuppet` is a walk, and
it is how most characters reach you).

What writing one takes, beyond filling the slot:

- **The payload is appended**, one per type-3 slot, in slot order — the order being
  the only thing that matches a payload to its slot. This is the single field a save
  patch writes that does not fit a slot the base already has; every other one does.
  The base's own payloads are dropped rather than left as tails, which is what the
  zeroing was protecting against.
- **`+0x12` is a flag, not a pointer to forge.** The shipped values are DOS heap
  addresses TI.EXE allocated (`0xa6b4b0`, `0xa6c1f0`, `0xa6d820`), and the loader
  stores its own handle back over the word, so any non-zero value does. The port
  writes one of the real ones, so a save it writes is shaped like a save TI.EXE wrote.
- **Every header field is written with its meaning, including the box.** `+4` is 0
  everywhere. `+12` is the bounding box above; the port computes it over the points
  it writes — exact where TI.EXE's own copy is stale. And the box is provably inert
  on a resume: the mover's position function (`0x444d70`, reached from the walk
  service's type-3 branch at `0x443f14`) reads the total, the count and the
  waypoints, and never touches `+4` or `+12` — in either of its branches, mid-path
  interpolation or arrival. The box serves the path lookup at `walkonpath` START,
  which queries the set's own registry, never a save's payload.

All 16 live slots across the 12 shipped saves that have one are written back and read
again unchanged — all three shapes. That is the strongest claim available without
running the original: the expected bytes are the ones TI.EXE wrote. It is not the
same as TI.EXE reading ours — **which DosBox has now said**: one save per shape,
written by this writer mid-flight and opened in TI.EXE — `cash` mid-`walktostar` on
the Grand Staircase, `ga` mid-`walkonpath` across the boat deck (the appended
waypoint container, box and all — the shape the shipped-save writer's five DosBox
fatals said to fear), `max` mid-`turntodeg` — and all three resumed and finished
their walks in the original engine (#191).

## The track containers: what was playing

Container 6 lists the **open tracks** as 40-byte descriptors, and each descriptor
is followed by three containers of its own further down the file:

| Offset | Type | Field |
|-------:|------|-------|
| +0 | u32 | heap pointer |
| +4 / +6 / +8 | u16 | the **three array counts**: registered / playing / looping |
| +0xa / +0xe / +0x12 | u32 | the three arrays' heap pointers |
| +0x16 | pstr16 | track name — `inven.trk`, `unilib.trk`, `cricket.sfx`, `deckbd.trk` |

The counts match the following containers' record counts in every save, which is
what
[`findTracksIndex`](https://github.com/dhobi/taoot-web/blob/master/src/df/savegame.ts)
verifies rather than trusting the position. Each of the three arrays is a grid of
**104-byte sound records**:

| Offset | Type | Field |
|-------:|------|-------|
| +0 | u16 | the chunk's **container location in its bank** (`01 main` in CARGO.TRK lives at container 2, and its record reads 2) |
| +2 | u16 | 0 in every playing/looping record; the registered arrays hold small ordinals |
| +4 | u16 | volume (255 default) |
| +6 | u16 | pan (128 = centre) |
| +8 | pstr16 | the chunk **identifier**, verbatim from the bank (`01 main`, `Boat Deck`, `doorlocked`) |

The rest of the record is heap junk. Array 1 is the track's registered sounds
(where volume/pan are the last play's — the positional `motor` cricket sits at
volume 9 / pan 0x8a, attenuated exactly as it was last audible); **arrays 2 and 3
are the playing and looping lists**, and they are the answer to "what was this
room sounding like": a boat-deck save carries `Boat Deck` in both.

### An open bank is not a playing bank

The descriptor list answers a *different* question from the playing/looping
arrays, and reading only the second one was
[#199](https://github.com/dhobi/taoot-web/issues/199). A bank can be open with
all three of its arrays empty and still be the bank a restored `makeloop` or
`makecricket` reaches into: BOOTFILE's `playcrickets` opens `insddest.sfx` once
when mission 4 starts, then picks a random one-shot out of it every few seconds,
so the sinking's groaning metal is a live loop over a silent bank.

Measured over the corpus: a `.sfx` bank is **never** the playing theme in any of
the 109 shipped saves, 33 of them hold one, and across the 18 with a live cricket
table **49 of 50** cricket records cannot resolve their sound from the theme's
bank alone. All 50 resolve from the banks the descriptor list names.

It does not heal by walking, either. `setupsound` only calls `setupcrickets()`
when `crickettype(currentset())` changes, and lnghall, lounge1c and smoke are all
`"insd"` — so a load that skipped the bank spent the rest of the game logging
`sound not found: ` with an **empty name** (`countsounds` 0 → `indextosound` "").

**`savetheme` is not the playing theme.** The script global of that name records
the theme to restore *after* an interlude, and measured against all 109 shipped
saves it lags the file's track state in **91** of them. The playing theme is the
one track whose playing/looping arrays are non-empty — exactly one track in every
shipped save. That is the value a load restores.

### The playing/looping lists mirror the bank, record for record

The two live lists are **not free-form**, and this page learning that cost a
DosBox fatal. Measured across all 109 shipped saves (111 live tracks, 2583
records, no exceptions): the playing list is **one record per loop-table record
of the bank, in table order**, and the looping list is **one record per entry of
the bank's play order**, each a copy of the playing record the order entry names.
`idx` is the chunk's container location, `+2` is 0, pan is 128, and the name is
the chunk identifier — the shipped cargo-hold save carries `01 main`…`11 end`,
idx 2–12, counts `0, 11, 11`.

The reason is the loader's other half. `opengame`'s post-restore resume
(`0x414a70`) pairs playing record *n* with the **bank's own loop-table record
*n*** — the save's record contributes only volume and pan — and then rebuilds
the looping list by copying `playing[order[n] − 1]` for every entry of the
bank's play order, **bounded by the bank's chunk count** (the u16 at
`loop table + 0x10a`), not by the save's counts. The arrays were allocated from
the descriptor counts at `+6`/`+8`, so a playing list shorter than the bank's
tables is an out-of-bounds read *and* write on 104-byte-stride heap blocks. The
port's writer once put a single invented record (`idx=1, name="cargo"`) there;
TI.EXE allocated 104 bytes per list, copied eleven records through both, and
the smashed heap surfaced as **"Memory error at line 301 (code 2): Unknown
compression format"** — the codec-table lookup at `0x401539` (raise `0x435160`,
error 999) reading a clobbered sound header. The port loaded the same file
happily, which is exactly why [what is verified](#what-is-verified-and-what-is-not)
insists a save has to load in the original engine, not only here.

So `applyPatch` writes the lists from the bank itself: `SavePatch.theme` carries
the loop records (container location + identifier) and the play order, supplied
at save time by the open bank (`AudioLibrary.loopTable`), and the descriptor
counts move with the container lengths as always.

Writing it back has one real limit. `applyPatch` can empty every track's
playing/looping arrays and write one base track's lists (descriptor counts and
container lengths move together, so the file keeps the shape the original writes),
but it **cannot open a track the base save never had**: the container-0 manifest
names the open files and the patcher does not rewrite the manifest. A theme whose
track is not in the base is dropped, reported through `SavePatch.onDrop`, and the
room loads silent.

## How the web port loads a save

**It restores the engine from the file, and runs no room script at all.** That is
what the original does — `opengame` (`0x413860` → the restore at `0x414080`)
rebuilds the room through the engine's own set machinery and never reaches the
script runners — and since #143 it is what this port does too. The port used to
put the room back by *arriving* in it: restore the globals, then travel to the
saved set/scene/view through `initall` (`changeset` + `initactors` + `initprops`)
and let the normal `openset`/`openscene` scripts rebuild the loops, props, crickets
and music at the restored mission/phase. That worked because the loader deliberately
*didn't* restore the fields those scripts recompute; the two halves were one
decision, and reading the remaining containers is what allowed both to be dropped.
The history — and the bug that forced the question, a conversation opening *inside*
a load ([#125](https://github.com/dhobi/taoot-web/issues/125)) — is in
[Saving & loading at runtime](../runtime/saves.md#a-load-is-not-an-arrival).

What a load now takes out of the file:

- the **globals**, numbers and strings, plus the `hallside`/`savedeck` fallbacks;
- the **open cast files** (container 3), reopened before any record is applied —
  see [the crowd](#the-crowd-comes-from-this-container);
- the **cast**, wholesale — the live actor list is wiped and every record applied,
  including the crowd extras, which are re-instanced from their cast member by name
  (`brown1a1` ← `brown1`, `stok4` ← `stok1`), and including `actorscale` from
  [the record's +42](#the-actor-container-fixed-160-byte-actor-records);
- every **prop**, both halves — owner and view, plus visible, the screen anchor,
  `deg`, `dist`, `scale`, `value` and `zclip`, which is how the band's lit-or-dark,
  the nav arrow's colour, the destination signs and the open pocketwatch's whole
  assembly come back without `showinterface`/`setupsigns`/`setuparrow` running;
- the **open audio banks** (container 6), every one of them — the restored loops
  and crickets play out of banks that need not be sounding, see
  [an open bank is not a playing bank](#an-open-bank-is-not-a-playing-bank);
- the **loop and cricket tables**, mid-count, straight into the scheduler;
- the **theme**, from the track state rather than from `savetheme` or a re-score;
- **walks are dropped**, with a log line naming the character (the actor's restored
  position stands and their restored idle re-decides).

The set/scene/view is then opened through the engine's set machinery with the whole
lifecycle muted — no `closeset` on the way out, no `openset`/`openscene` on the way
in. The scene is still recorded as current, so the first turn or step fires
`openscene` normally. See
[`loadGame`/`snapshotSave`](https://github.com/dhobi/taoot-web/blob/master/src/engine/saveload.ts)
and the `savegame`/`opengame` builtins in
[`src/engine/builtins/savegame.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/builtins/savegame.ts).

**Writing is the same list from the other side**, since a round trip has to feed
that loader. `snapshotSave` patches a base save (the last one loaded, or a
host-supplied per-disk template) with the current globals, the set/scene/view **and
the set file's manifest path + register refs** (see
[the loader re-opens the room from the manifest](#the-loader-re-opens-the-room-from-the-manifest-not-from-the-set-name)),
every loaded prop's full record, every actor's full record — **appending** one for a
crowd extra the base save lacks — the scheduler's loop and cricket tables (walks
zeroed), and the playing theme
([one record per loop chunk of the bank](#the-playinglooping-lists-mirror-the-bank-record-for-record)).
Everything the loader ignores stays byte-for-byte as the base had it.

Back to the [format index](README.md), or on to how the running game uses
this: **[Saving & loading at runtime](../runtime/saves.md)**.
