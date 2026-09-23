# Saving & loading at runtime

*Prerequisite: [Saved games (`.ti`)](../formats/savegame.md) — the byte
format, and why writing means patching.*

The [savegame format doc](../formats/savegame.md) covers the `.ti` file
itself. This page covers the two runtime halves built on it: **what the
session puts into and takes out of a save**, and the **in-browser saved-games
UI** that stands in for the original's native *Save As* / *Open* dialogs.

Reference implementation:
[`engine/src/runtime/saveload.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/saveload.ts)
(session level) over
[`engine/src/df/savegame.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/savegame.ts)
(bytes); the UI is
[`engine/src/web/save-browser.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/save-browser.ts) /
[`save-store.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/save-store.ts) /
[`save-seed.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/src/save-seed.ts).

## Saving: snapshot = base save + patch

Because a `.ti` is a serialized C++ heap that can't be rebuilt from scratch
(see [the format doc](../formats/savegame.md)), `snapshotSave` **patches a
base save**: the last save loaded this session, or — on a fresh playthrough —
a shipped template (disk 1 or disk 2, picked by `mission`). Into the base it
writes:

- every live script global (numbers inline; strings via the base's string
  pool — `clock`, the variable list's head, included),
- the current **set / scene / view**,
- the **CD in play**, by the label `setpath` mounted it under (container 0 @256).
  The base cannot be trusted for this: it is a shipped save or the last one
  loaded, and the story crosses back to disc 1 at mission 4 without either of
  them changing. It matters at both ends: the original engine asks for that CD
  by name, and a load in this port mounts it (step 3 below),
- the **props**: **every prop the engine has loaded**, in the engine's own list
  order, and the whole record — `propowner` and `propview`, plus the numeric half
  (`propvisible`, the screen anchor, `deg`, `dist`, `scale`, `value`, `zclip`) —
  see [Which props get written](#which-props-get-written),
- the **cast**: `actorowner` and `actorvalue` (what each character remembers of
  you) plus the whole placement half of [the actor record](#the-actor-record) —
  set, star, pose, position, facing, speed, **scale**, zclip and `actorvisible` —
  **the crowd included**.

  `setupgroup` makes the deck extras per room from `EXTRA.CST`, the shipped saves
  disagree about which of them exist at all (25 to 64 records), and a patch-write
  cannot grow a slotted container. The actor container, however, declares no
  capacity — TI.EXE's loader duplicates the read container's handle straight into
  the actor-list global, so the record count is implicit in the container's size —
  so a crowd record the base lacks is simply **appended**. Since #143 this is
  required: nothing re-runs `setupgroup` on a load, so the file is the only witness
  to who was standing on that deck.

  A crowd record is instanced from a cast member, and that member lives in
  `extra.cst` — which the room's `openset` opens and a load does not run. The load
  therefore reopens the cast files the save names in container 3; without that,
  344 written records are dropped on the way back in
  ([#186](https://github.com/dhobi/dreamrefactory/issues/186)).

- the **scheduler**: the live `makeloop` and `makecricket` tables, written over the
  base's own (mid-count, so a loop reloads with the ticks it had left), and the
  **walks** table with them ([#191](https://github.com/dhobi/dreamrefactory/issues/191)).
  A walk in flight is written as the record TI.EXE's own mover reads — the origin,
  the deltas it *subtracts*, the distance, the progress and the arrival star — and a
  `walkonpath` **appends a container** for its waypoints, one per type-3 slot in slot
  order, with `+0x12` set non-zero to say it has one. That is the one thing a patch
  writes that does not fit a slot the base already has; the base's own payloads are
  dropped with it, because they belong to the base's moment. Measured over the corpus,
  the walks table is the last container in all 109 shipped saves bar the 3 that carry
  a payload, so this only ever appends past the end. Without it, saving
  mid-conversation-approach reloads to a character parked where they happened to be.
- the **theme** that is playing, written into the track state
  ([the track containers](../formats/savegame.md#the-track-containers-what-was-playing)),
  not into `savetheme` — which is a different thing and lags the file in 91 of the
  109 shipped saves. The playing/looping lists are written **one record per loop
  chunk of the bank**, taken from the open bank itself (`AudioLibrary.loopTable`):
  TI.EXE's post-load resume walks the bank's tables against these lists and a
  shorter one overruns its heap blocks in the original engine — see
  [the lists mirror the bank](../formats/savegame.md#the-playing-looping-lists-mirror-the-bank-record-for-record).

Everything the loader ignores stays byte-for-byte as the base had it.

### Which props get written

**Every one that is loaded**, because that is what the original does: its writer
walks the engine's live prop list and copies one record per node with no filtering,
which is why all 109 shipped saves carry exactly 72 records — `inven.shp`'s 28 then
`house.shp`'s 44, one order across every file. `session.propRuntime.props` is the
same list in the same order, so it is offered whole and `applyPatch` fills whatever
the base has a record for.

A hand-kept subset is easy to get short, and the gaps are story-breaking:

- **`bag`, `watch` and `map`** live in `house.shp`, not the inventory shop.
  `initinterface()` places the bag from `propowner("bag")`, so an unowned bag goes
  back on the C73 bed — and with it the trunk key, which `addbag()` is the only
  source of. A mission-1 save written without it leaves the trunk, and the Enigma
  machine in it, permanently unopenable.
- **`baby`** lives in `house.shp` too, because it is drawn centre-screen instead of
  in a bag slot, and is the only story object kept there. Without it a mission-4
  save reloads with the child belonging to whoever the *base template* says
  (`none`, for the disk-2 template a carried game is lent), so `BX2.PUP` c6's
  opening `if propowner("baby") = "bx"` fails: Beatrix answers with `findconk()` —
  "where's Andrew?" — while you stand there holding Conkling's letter.
  `SHAHACK2.PUP` cannot be given the child back either (`gotbaby()` wants
  `propowner("baby") = "frank"`) and `dorescues()` never promotes Shailagh to
  `rescued` (#107).

So there is no list. Of `house.shp`'s 44 props only four ever carry story state
across the whole corpus — `bag`, `map`, `watch` (`frank`×105) and `baby`
(`bx`×16, `shay`×10, `frank`×3) — and the other 40 are chrome memos (`none` /
`vis` / `notvis` / `on`), so writing all of them costs nothing.

**The file carries the screen.** In a room entered normally, `house.shp`'s
`showinterface()` re-derives `propvisible` from ownership:

```
if propowner ("baby") = "frank"
	propvisible ("baby", true)
endif
```

right beside the same treatment for the watch, the bag, the map and the held item
(measured: with only owner + view restored, `visible` comes back true for exactly
the saves whose owner is `frank`, at `addbaby()`'s own (256,192) anchor), and
`setupsigns()` and `setuparrow()` compute the chrome views from where you stand. A
load runs none of them (#143), so the record supplies the answer: `propvisible`,
the screen anchor at `propxy`, `propdeg`, the `propdist` z-order, `propscale`,
`propvalue` and `propzclip` are all written and all read back. The open pocketwatch
shows it: its lid/hrs/min/sec pieces sit at the band anchor with dist −6/−5/−5/−4,
exactly the stack its own `open()` builds, and the wheels come back showing the
saved time because each one's `deg` picks its frame. No prop needs special-casing
on load.

The HELP button is the clearest of the chrome memos, because two different things
decide it. Its owner remembers whether HELP belongs on screen at all, and your hand
decides whether it may be drawn right now:

```
if propowner ("invenhelp") = "vis" & handitem = ""
	propvisible ("invenhelp", true)
```

Both draw at the left end of the band, so they cannot share it — which is why
`addinven`, the one way anything reaches your hand, opens by taking HELP down
(`sendtoprop ("invenhelp", initprop ())`) before putting the item where it was. It
clears the *picture* and leaves the owner alone, so an empty hand brings HELP back
later. Clearing the memo instead would retire HELP for the rest of the game (#123).

## A load is not an arrival

The original's load is not a script at all. `openscene` is dispatched from exactly
one site in `TI.EXE` (`0x407ea0`, which builds `sendtoscene("SceneNN",
openscene())`); that site has one caller (`0x4076d4`, inside `opensetfile`); and
`opensetfile`'s implementation has one caller — its own command stub. **Only a
script calling `opensetfile` can fire a room's entry events**, and the load never
does: `CTL.STG`'s button is `opengame ("Titanic 1.0")` with nothing after it but a
stage check, and `opengame`'s restore rebuilds the room through the engine's own set
machinery.

So the original puts the room back **from the file**, and so does the port.
Re-running the room (calling the game's own `changeset`, which fires `openset` and
`openscene` like any other arrival) is not equivalent. `LOUNGE1C` Scene45's entry
handler is a trigger:

```
if mission = 4 & actorvisible ("zeit") & currentview () = "view49"
    sendtoactor ("zeit", mousedown (0))
```

and `openset` makes Zeitel visible, so re-running the room on the shipped save taken
in front of him opens his conversation *inside the load* — which headless never
returns from, because it parks on his plaques (#125).

`GameSession.restoringSave` mutes the **whole** set lifecycle for the duration of a
load (`closeset`, `openset`, `openscene`, `closescene`; the guard is one line at the
top of `SetScripts.fireLifecycle`), and every one of those scripts' effects comes out
of the file instead (#143): `propvisible` and a prop's `view`, the live `makeloop`
and `makecricket` tables, the music and sound-loop state, and any parked
conversation — which is not a container of its own but the walks table plus its
waypoint payload (see
[the scheduler containers](../formats/savegame.md#the-scheduler-containers-loops-crickets-and-walks)).
The scene is still recorded as current, so the **first turn or step fires
`openscene` normally** — which matches what the #125 reporter observed of the
original: step off the spot and back, and the trigger runs.

## Loading: restore the engine from the file

`loadGame` restores the serialized engine and runs **no room script at all** — the
original's own choreography (see [A load is not an arrival](#a-load-is-not-an-arrival)):

1. Parse and validate (`"Titanic 1.0"`; a foreign file is rejected with the
   original's error).
2. **Abandon every script still running**, because the game they belong to has
   just been replaced. `Interpreter.abandonRunning` bumps an epoch that every
   frame is stamped with, and a frame carrying the old one stops at its next
   statement and unwinds; the pointer comes back with it, since a script cut off
   mid-arm may never reach its own `showcursor`.

   A suspended script is suspended *inside* a builtin, and the teardown below
   already releases those — so this has to come first, or the release wakes a
   script that then runs on into a game that no longer exists
   ([#340](https://github.com/dhobi/dreamrefactory/issues/340)). BOOTFILE's
   `advanceday()` endgame arm is one straight-line script, so a surviving script
   from a checkpoint pressed during it resumes at the next film and reaches
   `if mission = "good"` with the checkpoint's mission in the global. Measured in
   a browser: `narend.stg` scored the good ending, the load replaced `mission`,
   and the surviving script played the bad ending's `playmore.mov` over the
   loaded room and quit to the boot menu.

   `settle()` cannot do this job. It waits for the in-flight dispatches to
   finish, and the workbench's checkpoint chips call the load from *inside*
   `session.track(...)`, so a load that settled would be waiting for itself.
   (`prepareRestart` can settle because a restart is not reached that way.)

   Safe for the game's own load lever: CTL.STG's button is
   `opengame("Titanic 1.0")` followed only by
   `if currentstage() != "ctl.stg" exitcode`, and a completed load has already
   reopened `main.stg` — so the tail this cuts is the `exitcode` it was going to
   take. The cancel arm never reaches here.
3. **Mount the disc the save was taken on**, before a byte is read off one. 93
   basenames ship on both CDs — the public rooms, once per act — and 70 of them
   differ byte for byte, 19 being `.set` rooms; which copy the engine reads is
   `setpath(disk)`'s to say, and `BOOTFILE` only calls it on a story transition or
   when the tour starts. A load is neither. The file names its own disc by the
   label `setpath` mounts it under (`currentcd("Titanic2")`, container 0 @256),
   matched against the volumes this game's own `setpath` names. Without it a load
   stays on whatever disc the session is already on — disc 1 after a cold boot,
   which opens the wrong act's rooms for 78 of the 109 shipped saves (the
   starboard vestibule door comes out on A deck,
   [#231](https://github.com/dhobi/dreamrefactory/issues/231)).
4. **Drop every global the file does not name**, then restore all number and
   string globals, `clock` and `hallside` among them (without a valid
   `hallside`, halla's `keydown` guard swallows every key; `savedeck` keeps a
   set-derived deck-letter fallback for the four pre-boarding saves that predate
   the variable).

   The records are not a patch over the live session: they are TI.EXE's whole
   variable list, written out and read back wholesale. A global with no record
   did not exist when the game was saved, so after `opengame` it does not exist
   either. Normally that silence is a room's own doing and the room cleans up
   after itself — `dumpglobal` discards a room's globals from its `closeset` or
   `closestage`, and all 64 sites in the corpus sit in a teardown — but a load
   runs no scripts, so nothing is dumped. Setting the records over the live
   session instead would keep everything the file is silent about: BEDSIT1's
   `radiostate`, `ladycount`, `bombmebaby` and the nine `xx…` clippings would
   survive every load in the game.

   The boat deck shows the effect
   ([#340](https://github.com/dhobi/dreamrefactory/issues/340)). `DECKBD2.SET`
   c1012 opens the Gorse-Joneses' lifeboat offer on
   `frame() - jonesframe > 2000 & jonesphase = 0`, and `jonesframe` is never
   initialised anywhere — it springs into existence the first time the offer
   fires, so 101 of the 109 shipped saves have no record for it. Left standing
   while the frame counter rewinds to the save's, the gate's difference
   goes hugely negative: measured at frame 38365 against a `jonesframe` of
   337079 it reads −298714 and reopens after 300714 more frames, five and a half
   hours of play. `jonesphase` restores from the file and looks innocent; the
   stale stamp is the cause.

   Deleted rather than zeroed, because a `global` declaration recreates a
   missing name at 0 — which is what the original hands a script reading a
   variable its restored list has no node for. `__`-prefixed names are the
   port's own bookkeeping and not the file's to speak for (`__propsinit` is a
   once-guard on inven.shp's `initprops`); `snapshotSave` skips the same prefix
   when writing. Everything else a booted session holds is carried by all 109
   saves.

   Safe against the port's own saves being *patches* onto a base with finitely
   many free variable slots, which could in principle be silent about a global
   merely because it did not fit: measured, no single session ever holds enough
   globals for that to happen (the corpus knows 163 between all 109 saves, the
   roomiest base holds 139, and a live session runs 85–127). A global that did
   not fit is already reported by name at the moment it is written.
5. Force **`lockevents = 0`** — every save is taken from the CTL menu with
   world input frozen, so every save *carries* the freeze; a load returns you
   to interactive control.
6. Tear down timed state (`scheduler.reset()`), **silence the voice channel** (the
   theme is halted and re-scored from the file at step 12), drop any pending
   [overlay-stack](stage-ui.md#the-overlay-stack-transtoflat-transfromflat)
   frames, reopen `main.stg`, and make the set visible.
7. **Mute the set lifecycle** (`GameSession.restoringSave`) for everything below.
   The departing room is *detached*, not closed: its `closeset` does not run, its
   timed state died with the scheduler reset, and the host releases its files when
   the new set activates.
8. **Reopen the cast files the save had open** (container 3 — `gang.cst` always,
   plus `extra.cst` in the three rooms with a crowd), before a single record is
   applied. The extras a room places are instanced from `extra.cst`, which the
   room's own `openset` opens — and step 7 just muted that. Skipping this step
   drops 344 characters across 39 of the 109 shipped saves, in the endgame's
   most populated rooms, with only a log line to say so
   ([#186](https://github.com/dhobi/dreamrefactory/issues/186); [the
   container](../formats/savegame.md#the-crowd-comes-from-this-container)). The list
   is the file's own rather than a guess from the set being entered, and
   `opencastfile` is idempotent, so the boot cast costs nothing.
9. **Put the cast back, wholesale.** The live actor list is wiped first —
   `actorinstance` copies removed, cast members put down — because the original
   replaces its list with the container it read, and then every record is applied:
   owner and value, set, star, pose, position, facing, speed, `actorturn`,
   `actorscale`, zclip and `actorvisible`, straight out of
   [the actor record](#the-actor-record). A
   record naming somebody who is not a live actor is a **crowd extra**, re-instanced
   from its cast member by the names' own convention (`brown1a1` ← `brown1`,
   `stok4` ← `stok1`, `life12` ← `life1`).

   `actorvisible` verbatim is what makes wholesale restore safe at all:
   `putdownactor` hides a character without touching `actorset`, so "place everyone
   whose set matches" would resurrect everybody who ever walked through the room.
10. **Put every prop back, both halves** — owner, view, and the numeric fields that
   say where and how it draws. This one step stands in for everything the room's
   scripts would otherwise do to props: `initprops`' mission defaults, the
   `house.shp` `openshop`/`initprops`/`showinterface` sequence, the open
   pocketwatch's assembly, the nav arrow's lighting. (`handitem` is not cleared by
   hand — it restores from its variable record like every global, and every
   shipped save carries `""` there: a save is taken from the CTL panel, which you
   cannot reach mid-drag.)
11. **Restore the scheduler tables mid-count** — every `makeloop` with the ticks it
   had left, every `makecricket` with its position, radius, period, jitter and time
   to next fire. These are what the arriving room's `openset` would otherwise set
   up: the idles that make characters act, the scene timers, the room's positional
   ambience.
12. **Reopen every audio bank the save had open, then score the room from the
   file**: the track whose playing/looping arrays are non-empty is the theme, and
   it is played at the player's `themevolume`. The *other* open banks matter as
   much ([#199](https://github.com/dhobi/dreamrefactory/issues/199)): the loops and
   crickets step 11 restored play out of banks with nothing sounding in them, and
   with only the theme's bank open the sinking's groaning metal comes back as a live
   loop with no bank under it — `sound not found: `, with an empty name, for the
   rest of the game. Across the 18 shipped saves with a cricket table, 49 of 50
   cricket records cannot resolve their sound from the theme's bank alone. See [an
   open bank is not a playing
   bank](../formats/savegame.md#an-open-bank-is-not-a-playing-bank).
13. **Walks come back mid-stride.** The walks table is TI.EXE's own service table,
    and its record carries the walk's origin, its deltas, its total distance, how
    far along it is and the star it lands on — so the walk is *restored*, not
    restarted: the walker sets off from where the save caught them with only what
    was left to run. Load save 17 and Daisy finishes crossing the Grand Staircase,
    arrives on `cash1`, and her `endwalk` fires, which is what the original does.

    The record's **type** says which mover, and only one of the three fills those
    words in. A **type 0** is a `turntodeg` — a facing target, no movement — and a
    **type 3** keeps its waypoints *and* its length in a payload container hanging
    off `+0x12`. Both leave the movement words holding whatever the slot held last
    (`hack`'s route claims a distance of −1422655421), so neither may be read.
    All three resume: 16 slots live across 12 of the 109 shipped saves — 12 turns,
    one straight line, and three routes, including Georgia's ten-point curve
    around the boat deck's structures, which is put back on its own waypoints
    rather than sent along the straight line they exist to avoid ([#122](https://github.com/dhobi/dreamrefactory/issues/122)).

    A walk that cannot be put back is dropped, and its walker **stood up** out of
    the walk pose the record put them in, with their restored idle loop left to
    re-decide. That is not cosmetic: an actor steps through its pose's [play
    script](../formats/pup-cst.md#the-play-script-says-how-long-a-picture-is-held)
    whether a walk is running or not, so a drop that left the pose alone would leave
    a character treadmilling on the spot.
14. Open the saved set/scene/view through the engine's set machinery, still with the
    lifecycle muted. The scene is recorded as current, so the first turn or step
    fires `openscene` normally.

### What the old sequence had to get right, and why it is gone

An alternative load runs the boot's `initall(set, scene, view)` — `changeset` +
`initactors` + `initprops` — and lets the room's own scripts rebuild props, loops,
crickets and music at the restored mission/phase. The script-free load avoids three
constraints that approach runs into, each a real fact about the game's scripts:

- **A cast restore would be pinned between two scripts.** It has to come *after*
  the departing room's `closeset`, because a `closeset` is entitled to put its own
  people down and ENGINE.SET's does exactly that
  (`sendtoactor("vlad", putdownactor())`) — a restore before it is undone whenever
  you load a save of the room you are already standing in. And it has to come
  *before* the `changeset`, so the arriving room keeps the last word over the
  people it places: Scene110's `openscene` sends Vlad a mousedown, which *is* the
  fistfight, and a restore landing after that would teleport him out of the walk it
  starts. **Neither script runs during a load**, so there is no window to hit:
  the file places everybody, and the first `openscene` after the load is a normal
  one, fired by a turn or a step.
- **`actorscale` would have to be re-derived.** `ActorRuntime.drawList` skips
  anything whose scale is 0, so a character restored without one is placed
  correctly, gates every script correctly — and is not drawn (the second half of
  #86: *"the state of the game is correct, I just don't see Vlad standing there."*).
  The game's own question is `actorscale(target, sendtocastfx("gang.cst",
  stdscale(currentset())))`, since `stdscale` is a pure function of the set, with a
  known exception: `gang.cst` 1323 runs `stdactor` and then overrides the stoker
  with 9000. The record carries the field at +42, overrides included, so neither
  the derivation nor its exception is needed.
- **`actorturn` is in the record and must be carried.** Only a script ever sets it
  — every room passes `stdturn` from its own `openset`, and a load runs none — so a
  restored character without it keeps the runtime default and, at 0, turns at
  `stepDeg`'s floor of 1 instead of 10. A half-circle then takes 128 service passes
  instead of 13, most visible in `walktopuppet`: the conversation waits on `iswalk`,
  so an approach becomes seconds of somebody rotating on the spot before a word is
  said. The field is at +32 and takes exactly two values over the 3465 shipped
  records — **16**, the engine's default at creation (every record that names no
  set, and 51 placed ones no room ever set), and **10**, `stdturn`, for the other
  2207 placed ones — so it is restored verbatim rather than re-derived. The
  runtime's own creation default is 16 for the same reason: a default of 0 would
  put a value in saves that no shipped record has, and make the crowd extras
  (`setupgroup` instances no room ever passes `stdturn`) turn at the floor rate in
  play (found with the walks table,
  [#191](https://github.com/dhobi/dreamrefactory/issues/191)).

**Under `initall`, prop and actor ownership would also have to be restored twice —
before it as well as after.** `initall` runs the room's own `openset`, and those
scripts read ownership to decide what the room holds. Zeitel's idle is one of them:
it picks its line from `propowner("painting")`, and a checkpoint taken standing next
to him with the painting already traded would open the branch for someone who
*hasn't* traded — which parks on plaques inside the load, so the load never returns.
A room asks about the world while it is opening, which is a good reason never to
open a room mid-restore; the load opens none.

### What a load is therefore *not*

A faithful reload is not a snapshot of the running game, which is why the
[playthrough](../../taoot/verification.md#one-game-carried-not-a-chain-of-loads)
does not lean on it. Four kinds of loss:

- **Not in the format — very little.** The actor record (`actorowner`,
  `actorvalue`), the crowd extras, the scheduler's own tables, the open-bank list
  ([#199](https://github.com/dhobi/dreamrefactory/issues/199)) and the walk in
  flight (whose writer half,
  [#191](https://github.com/dhobi/dreamrefactory/issues/191), needed the format to
  grow a container rather than fill a slot) are all in the file. A field that seems
  absent is more likely misframed: `actorowner` and `actorvalue` both look missing
  when the record is read 80 bytes out of position. What is genuinely left is the
  positional sound loops beyond the theme, which the room re-arms on the next move.

  What a missing field costs, as a worked example:
  [#86](https://github.com/dhobi/dreamrefactory/issues/86). The engine room passes
  Vlad between three scenes and only Scene108 places him, so a save taken further
  along the catwalk without his placement comes back with him at `(0,0,0)` and no
  set at all. His mousedown opens `if realdist(me) < hotdist()`, so Scene110's
  `sendtoactor("vlad", mousedown(0))` — the gesture that *is* the fistfight —
  reaches nobody, and the player walks on into the smokestack in the wrong phase
  with nothing to find. Measured at the moment of arriving at Scene110: with the
  placement restored his `vlad1.pup` opens, without it no puppet opens at all.
- **Dropped for want of room.** The variable table is fixed-size, so globals the
  base save has no record for and no free slot for are not written; they keep the
  base's value, and the log says which ones.

  How many depends entirely on *which* base, because a `.ti` holds the variable
  list that existed when it was taken. Measured against the 163 globals the shipped
  109 know between them, `1/01 - April 14th, 1942` — the first file in `save/1` —
  can hold 99 and drops **64**, among them the entire turbine puzzle (`boiler`,
  `turbine`, `condensor`, `steamtank`, all four pressures), the smokestack maze
  (`mazenumber`, `stacklevel`), the darkroom's plates, `stokerphase`, `troutmoney`,
  `turkwater`, `fencelevel` and `stackmax`. Ranking the shipped saves by
  [`globalsCapacity`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/savegame.ts)
  instead takes disk 1 to **44** dropped and disk 2 to **24**, and what is left is
  blackjack-table and fistfight scratch that a load re-initialises anyway (#85).
- **Inherited from the skeleton.** A patch-write starts from a *shipped* save, so
  any slot nothing overwrites keeps that save's value — `oldset` "None", and the
  `propview` of a prop the port has never set (an untouched prop is sitting in its
  file default, and `""` is not a reading). The port writes every view it holds,
  including the band's chrome (`door`, `signs`, `wiremsg`, `navtoggle`,
  `subtoggle`, `invenctl`, `lid`, `invenhelp`: 6–8 records per save, measured), and
  the chrome **owners** like any other `propowner`. (`clock` is not here either: it
  is the variable list's head and a patch writes it like any other global —
  measured, "bedsit" written and read back.)
- **A theme the base save never opened.** The container-0 manifest names the files
  that were open and a patch does not rewrite it, so a save whose room is scored by a
  track the base does not carry loses the music — reported, and the room loads
  silent.

Loops and crickets are not on this list, and the music only in the one case above:
they come out of the file, mid-count, which is the difference between a faithful
reload and one that merely re-derives a plausible room.

### The actor record

A cast record is **the live runtime struct, dumped verbatim**, 160 bytes on its own
grid. TI.EXE fixes the frame: `0x410d00` fetches a record by name with a stride of
160 (`lea eax,[eax+eax*4]; shl eax,5`) and string-compares against **record+0x50**,
then hands the caller all 160 bytes. So the name is *not* at +0 — the five string
fields are the record's second half and every number sits before them. Reading it
name-first puts you 80 bytes into the next record's heap pointers.

Each accessor then reads its own field out of that copy (buffer at `esp+8`;
`actorxyz` at `esp+0x10`):

| offset | type | field | recovered from |
|---|---|---|---|
| +0 | i16 | `actorvisible` (>0 is visible) | `0x40eec0` |
| +24 | i16 | `actordeg`, 0..255 | `0x40e850` |
| +26/+28/+30 | i16 | `actorxyz` 1/2/3 — the SET's own X, Z, Y order | `0x40f285/97/a9` |
| +32 | i16 | `actorturn` — degrees per pass while turning (10 = `stdturn`, 16 the default) | `0x410937` |
| +38 | i16 | `actorspeed` | `0x40ead0` |
| +42 | i16 | `actorscale` (1000 neutral; 0 places but never draws) | `0x40ea40` |
| +72 | i32 | `actorvalue` | `0x410be0` |
| +76 | i16 | `actorzclip` | `0x410c70` |
| +80/+96/+112/+128/+144 | pstr | name · set · star · pose · `actorowner` | the grid itself |

Checked against all **3465 records of the 109 shipped saves**: `visible` is only ever
0 or 1 and no visible record lacks a set; `deg` stays inside 0..255; `speed` and
`zclip` only ever hold values a script passes to those commands. The acid test is the
position — for the 2122 records naming a star that really is a star of the set they
also name, the coordinates are **that star's, exactly, in 2105 of them (99.2%)**. The
17 that differ are Max mid-patrol on the boat deck and one record parked on the
`walktostar` sentinel: an actor genuinely not standing on his star. No other framing
of these bytes produces that.

`actorvalue` has a plausible-looking misframe. name+152 is `(name + 160) − 8`, the
same field one record along, so reading it there restores every character with their
**neighbour's** conversation count. It looks right because it produces a plausible
series; that series (0→1→3→5→8→13→21 over disk 1) belongs to Penny, who you report
to after every errand, and the misframe hands it to Morrow, whose own is 0→2→3.

### The arriving room cannot be trusted to silence the last one

Which is why the load halts the theme and the voice channel itself rather than
leaving it to the room. `scheduler.reset()` owns loops, crickets, walks and the
`sound` channel — not the music and not speech — and the destination's `setupsound`
does not always play anything over them: **`setupsound` sometimes scores a room
deliberately silent** (arriving in C73 at mission 1 phase 0 is scored by the
Smethells knock), and then the room you *left* keeps playing. Without the halt,
starting the game in the London flat and loading from the CTL menu leaves
`bedrad1.trk` — whose loop chunks *are* the announcer — reading the news over the
loaded room.

`advanceday()` does the same: it halts the theme before opening the next day's room
(`BOOTFILE` 0002:148), and the dev-tools jump copies it. A load is the same
manoeuvre and silences the same way. `currentThemeName` comes down with the theme,
because [`transfromflat`'s overlay
restore](stage-ui.md#the-overlay-stack-transtoflat-transfromflat) keys off that value
— left stale, closing a later overlay would put the flat's radio *back*. `voice` is
the same hole one channel over: nothing but a skip or a stop halts it, and a load is
neither, so without the halt a load taken mid-line lets the speaker follow you into
the next room.

**What plays afterwards is the file's answer, not `setupsound`'s.** The load scores
the room from the track state in the save. Re-scoring through `setupsound` does not
work: the room's own `themetype` guard — "don't restart the theme, we are already in
this set" — needs `currentset` forced to `"none"` first, and even then every room
`setupsound` deliberately scores silent (#36's London flat, `gstair3`, `bind`) stays
silent, because a room that scores nothing cannot tell you what was playing when you
saved. The file can: exactly one track carries playing/looping records, and it is the
live theme.

## Dust saves through the same two halves

Dust's `.rtd` saves are the same container file (see
[the v1 format doc](../formats/savegame-v1.md)), so the framing layer is shared
outright and only the two ends are Dust's own:
[`engine/src/runtime/saveload-v1.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/saveload-v1.ts)
over
[`engine/src/df/savegame-v1.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/savegame-v1.ts),
dispatched on `GameSession.dfVersion` — which the Dust page declares at boot, and
which nothing else in the engine consults, because a v1 set is translated into
the v4 shape long before anything downstream sees it.

The *choreography* is not duplicated: reset the timed world, apply the file's
records with the script runners muted, arrive through the engine's own set
machinery. That sequence is not about Titanic, it is about what a load is — the
room you arrive in was never entered, so nothing re-derives anything and the file
has to carry the screen. `resetCast`, `restoreActors` and `restoreProps` are
shared, with the v1 records adapted into the shapes they take and any field whose
offset is not yet proven filled from the LIVE object, so applying a record cannot
change what this port has not established.

Four differences:

- **the room is the manifest's, not the name's.** Dust's town is two files that
  are both called `town`, so a load reopens the file the handle at c1+396 points
  at. Trusting the name brings a midnight save back at noon.
- **`lockevents` is honoured, not cleared.** TAOOT's save lever sits on a panel
  that freezes world input, so every `.ti` carries `lockevents=1` and a load must
  drop it. Dust's lever is a button on the inventory panel and sets nothing —
  there the variable is a scene script's, so the file's answer is the right one.
- **the standpoint is a grid cell**, resolved against the set's own scene table
  to get the name `openSetFile` wants (and back again when writing).
- **there is no disc to mount and no crowd to re-instance** — Dust is one CD and
  its cast is the boot cast.

The store is the play page's, with a database of its own (`dust-saves`) and its
own extension: see `SaveKind` in
[`save-store.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/save-store.ts),
and `dust-saves.ts` for the seeding of the saves that ship beside the disc —
one of which is also the base a fresh playthrough's first save is patched into.

## The saved-games UI

The original called the Windows *Save As* / *Open* dialogs from `CTL.STG`. A
browser has neither, so the session's `onSaveGame`/`onLoadGame` hooks open an
in-app modal instead:

- **Storage** is IndexedDB (database `taoot-saves`): each entry is the raw
  `.ti` bytes plus folder/name metadata — a little file system the game can't
  tell from a disk.
- **Seeding**: on first run, every shipped save under `gamefiles/<lang>/save/**/*.ti`
  in the dev-server manifest is imported once, and one **template** per disk
  is cached for fresh-playthrough saves.
- **The browser** groups saves into *My Saves* / *Disk 1* / *Disk 2* /
  *Endgame* folders, and supports save-under-a-name (sanitised, Enter
  confirms, Escape cancels), delete, per-row **download** of the `.ti`, and
  **import** of an external `.ti` (validated by actually parsing it) — so
  saves round-trip with a real DOS/Windows installation.

Keystrokes inside the modal don't reach the game — typing a save name mustn't
walk you down a corridor.

### What the dialog does to the game behind it

The original's dialog is not a thing drawn over the game; it is a thing drawn
*instead of* it, and the game stops dead for its duration. Both levers reach the
same wrapper (`0x420e40`, the only two callers being `opengame` at `0x4138c7`
and `savegame` at `0x436f35`), and that wrapper:

- **hides the game.** `0x420500` walks the window list at `0x486390` plus the
  main window at `0x485c40`, `ShowWindow`s each of them away and forces the OS
  cursor back on; `0x4205e0` puts them back after. So the black the *Open*
  dialog sits in (#162) is not a frame the game painted — it is **no window at
  all**. The port has one canvas and cannot take it away, so `opengame` paints
  what taking it away shows, and restores the panel exactly as it was if the
  player cancels or picks a file the port can't read.
- **stops the world.** `GetOpenFileNameA` runs its own modal message loop, so
  the game's loop does not run while the dialog is up: no service pass, no
  frame counter, no `delay` expiring, no animation. `GameSession.freezeTime`
  reproduces that by holding the one clock reading the viewer feeds the engine
  (`gameTime`) — every timed thing downstream is a delta off it, so they all
  stop together, and afterwards continue from where they stopped instead of
  replaying the gap.
- **goes quiet, without muting anything.** The wave device is opened with
  `CALLBACK_FUNCTION` (`0x406843`), and the callback (`0x406e40`) only retires
  finished headers on `WOM_DONE` — it never queues the next buffer. Refilling
  is the game's own code, so a stopped game starves the device within a buffer
  or two. Nothing in the dialog path mutes it: the only `waveOutPause` /
  `waveOutRestart` in the binary are inside the submitter's own queue
  bookkeeping. `freezeTime` therefore *suspends* the sink rather than halting
  it — the theme picks up mid-bar, which is what starving and then feeding it
  again sounds like.

The load's own restore blacks the screen too, in engine code rather than in
script: at `0x41420e`, partway through `0x414080`, it runs the same five calls
in the same order with the same arguments that are the whole body of the
`blackscreen` command (`0x43e650`), and only then rebuilds the palette and the
loop tables. Nothing lifts that black — the room is simply drawn over it, which
is why the port's `opengame` clears the fade level outright instead of ramping.

The **save** lever needs none of this from the port, because `CTL.STG`'s `saveme` does
it in script: `screentoblack ("stage", 10)`, `blackscreen ()`, the stage swap,
and `blacktoscreen ("stage", 10)` on the way back. It also brackets the write
with `doloops (false)` … `doloops (true)` — un-pausing the world it was saved
from, so the file records a **running** game rather than the control panel's
frozen one. (Every flat freezes the world on entry: `transtoflat` opens with
`pausewalk`/`pausecricket`/`pausetheloops (true)`, and the theme survives only
because `keeptheme` lists `ctl.stg`.)

Next: everything else the browser provides — **[The browser host](host.md)**.
