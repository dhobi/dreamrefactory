# Saving & loading at runtime

*Prerequisite: [Saved games (`.ti`)](../formats/savegame.md) — the byte
format, and why writing means patching.*

The [savegame format doc](../formats/savegame.md) covers the `.ti` file
itself. This page covers the two runtime halves built on it: **what the
session puts into and takes out of a save**, and the **in-browser saved-games
UI** that stands in for the original's native *Save As* / *Open* dialogs.

Reference implementation:
[`src/engine/saveload.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/saveload.ts)
(session level) over
[`src/df/savegame.ts`](https://github.com/dhobi/taoot-web/blob/master/src/df/savegame.ts)
(bytes); the UI is
[`src/save-browser.ts`](https://github.com/dhobi/taoot-web/blob/master/src/save-browser.ts) /
[`save-store.ts`](https://github.com/dhobi/taoot-web/blob/master/src/save-store.ts) /
[`save-seed.ts`](https://github.com/dhobi/taoot-web/blob/master/src/save-seed.ts).

## Saving: snapshot = base save + patch

Because a `.ti` is a serialized C++ heap that can't be rebuilt from scratch
(see [the format doc](../formats/savegame.md)), `snapshotSave` **patches a
base save**: the last save loaded this session, or — on a fresh playthrough —
a shipped template (disk 1 or disk 2, picked by `mission`). Into the base it
writes:

- every live script global (numbers inline; strings via the base's string
  pool — `clock` excluded, its record isn't writable),
- the current **set / scene / view**,
- the **props**: `propowner` for **every prop the engine has loaded**, in the
  engine's own list order, plus `propview` for the ones whose view the save owns
  (the `inven.shp` items and the four band props) — see
  [Which props get written](#which-props-get-written), and
- the **cast**: `actorowner` and `actorvalue` (what each character remembers of
  you) plus the whole placement half of [the actor record](#the-actor-record) —
  set, star, pose, position, facing, speed, zclip and `actorvisible`.

  The **crowd** is deliberately excluded. `setupgroup` makes the deck extras per
  room from `EXTRA.CST` and the arriving room makes its own, which is why the
  shipped saves disagree about which of them exist at all: 25 to 64 records, the
  named cast constant and the extras churning. There would be nowhere to put them
  anyway — a patch-write cannot grow the container — whereas every one of the 109
  shipped saves *does* have a record for all 25 named characters, so those are
  never dropped for want of a slot.

Everything the loader ignores stays byte-for-byte as the base had it.

### Which props get written

**Every one that is loaded**, because that is what the original does: its writer
walks the engine's live prop list and copies one record per node with no filtering,
which is why all 109 shipped saves carry exactly 72 records — `inven.shp`'s 28 then
`house.shp`'s 44, one order across every file. `session.propRuntime.props` is the
same list in the same order, so it is offered whole and `applyPatch` fills whatever
the base has a record for.

This was a hand-kept list twice, and **both times it was short**:

- **the inventory shop alone**, which lost `bag`, `watch` and `map`.
  `initinterface()` places the bag from `propowner("bag")`, so an unowned bag went
  back on the C73 bed — and with it the trunk key, which `addbag()` is the only
  source of. Loading your own mission-1 save left the trunk, and the Enigma machine
  in it, permanently unopenable. Three names were added.
- **plus those three**, which lost `baby`. It lives in `house.shp` rather than
  `inven.shp` because it is drawn centre-screen instead of in a bag slot, and is the
  only story object kept there. A mission-4 save reloaded with the child belonging
  to whoever the *base template* said (`none`, for the disk-2 template a carried
  game is lent), so `BX2.PUP` c6's opening `if propowner("baby") = "bx"` failed:
  Beatrix answered with `findconk()` — "where's Andrew?" — while you stood there
  holding Conkling's letter. `SHAHACK2.PUP` could not be given the child back
  either (`gotbaby()` wants `propowner("baby") = "frank"`) and `dorescues()` never
  promoted Shailagh to `rescued` (#107).

So there is no list. Of `house.shp`'s 44 props only four ever carry story state
across the whole corpus — `bag`, `map`, `watch` (`frank`×105) and `baby`
(`bx`×16, `shay`×10, `frank`×3) — and the other 40 are chrome memos (`none` /
`vis` / `notvis` / `on`), which is why writing all of them changes nothing but the
one that was missing.

**Possession is the only field that has to survive.** The record does carry
`propvisible` (see [the format doc](../formats/savegame.md)), but nothing needs it
restored, because `house.shp`'s `showinterface()` re-derives it:

```
if propowner ("baby") = "frank"
	propvisible ("baby", true)
endif
```

right beside the same treatment for the watch, the bag, the map and the held item.
Measured after a load with only owner + view restored: `visible` is true for exactly
the saves whose owner is `frank`, at `addbaby()`'s own (256,192) anchor, and the prop
is in the draw list. The view is left to the room for the same reason — `setupsigns()`
and `setuparrow()` compute the chrome from where you stand.

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
later. Reaching only for the picture is the whole trick: clear the memo instead and
HELP is retired for the rest of the game (#123).

## A load is not an arrival

The original's load is not a script at all, and that turns out to matter. `openscene`
is dispatched from exactly one site in `TI.EXE` (`0x407ea0`, which builds
`sendtoscene("SceneNN", openscene())`); that site has one caller (`0x4076d4`, inside
`opensetfile`); and `opensetfile`'s implementation has one caller — its own command
stub. **Only a script calling `opensetfile` can fire a room's entry events**, and the
load never does: `CTL.STG`'s button is `opengame ("Titanic 1.0")` with nothing after
it but a stage check, and `opengame`'s restore rebuilds the room through the engine's
own set machinery.

So the original puts the room back **from the file**, where this port puts it back by
re-running the room — it arrives by calling the game's own `changeset`, which fires
`openset` and `openscene` like any other arrival. For one room that is a bug rather
than a detail. `LOUNGE1C` Scene45's entry handler is a trigger:

```
if mission = 4 & actorvisible ("zeit") & currentview () = "view49"
    sendtoactor ("zeit", mousedown (0))
```

and `openset` has just made Zeitel visible, so loading the shipped save taken in front
of him opened his conversation *inside the load* — which headless never returns from,
because it parks on his plaques (#125). The scene event is therefore muted for a load.
Only that half: the original fires neither, but this port still needs `openset` to
place the actors, score the theme and dress the props, because it deliberately does
**not** restore the fields that would replace it (`propvisible` and a prop's `view`,
above). The two halves are one decision — the original can skip the room because it
reads the file; this port can skip those fields because it runs the room. A faithful
script-free restore starts by reading them back, and would also have to reconstruct
what the save's later containers hold and this loader ignores: the live `makeloop` and
`makecricket` tables, the music and sound-loop state, and any parked conversation.

## Loading: restore globals, then travel

`loadGame` deliberately does *not* try to reconstruct subsystems from the
save's pointer-laden containers. It loads the way the game itself effectively
does — restore the variables, then **replay the arrival**:

1. Parse and validate (`"Titanic 1.0"`; a foreign file is rejected with the
   original's error).
2. Restore all number and string globals, plus `clock` and the
   `hallside`/`savedeck` fallbacks recovered from the location container
   (without a valid `hallside`, halla's `keydown` guard swallows every key).
3. Force **`lockevents = 0`** — every save is taken from the CTL menu with
   world input frozen, so every save *carries* the freeze; a load returns you
   to interactive control.
4. Tear down timed state (`scheduler.reset()`), **silence the theme and voice
   channels**, drop any pending
   [overlay-stack](stage-ui.md#the-overlay-stack-transtoflat-transfromflat)
   frames, reopen `main.stg`, and make the set visible.
5. Run the boot's **`initall(set, scene, view)`** — `changeset` +
   `initactors` + `initprops` — so the normal `openset`/`openscene` scripts
   rebuild props, loops, crickets and music *at the restored mission/phase*.
6. **Put the cast back where the save left them** — set, star, pose, position,
   facing, speed, zclip and `actorvisible`, straight out of
   [the actor record](#the-actor-record).

   **Where** this happens in the sequence is the whole of it, and it is pinned
   between two things that will otherwise undo it. It has to be **after the
   departing room's `closeset`**, because a `closeset` is entitled to put its own
   people down and one of them does exactly that — ENGINE.SET's is
   `sendtoactor("vlad", putdownactor())` — so a restore before it is undone
   whenever you load a save of the room you are already standing in. And it has to
   be **before the `changeset`**, so the arriving room still gets the last word
   over the people it does place: Scene110's `openscene` sends Vlad a mousedown,
   which *is* the fistfight, and a restore landing after that would teleport him
   out of the walk it starts. Everyone the arriving standpoint says nothing about
   is what the save then fills in.

   `actorscale` is the one field that does **not** come out of the record, and it
   has to come from somewhere: `ActorRuntime.drawList` skips anything whose scale
   is 0, so a character restored without one is placed correctly, gates every
   script correctly — and is not drawn. That is worth stating plainly because it
   was the second half of #86 and it produced a confusing symptom: *"the state of
   the game is correct, I just don't see Vlad standing there."* The game's own
   source is `stdactor` —
   `actorscale(target, sendtocastfx("gang.cst", stdscale(currentset())))` — and
   `stdscale` is a pure function of the set, a table of per-room constants, so the
   loader asks the cast the same question instead of copying that table. (The
   stoker is the known exception: gang.cst 1323 runs `stdactor` and then overrides
   with 9000. Arriving in the boiler room re-places him properly, which is the
   same "room gets the last word" rule doing its job.)
7. Overwrite the default props `initall` seeded with the save's actual owner per
   prop, and view where the save owns it. Every `house.shp` prop's **owner** comes
   back, held item or chrome, because for the chrome the owner *is* the band's memo
   (`hideinterface()` writes it, `showinterface()` reads it); for the chrome that is
   *all* that comes back, since its look is worked out for the room. The four
   **band props** (`bag`, `watch`, `map`, `life`) get their view too — the save owns
   how the band looked. `handitem` is always cleared (you can't be mid-drag after a
   load).

**Prop and actor ownership is restored twice — before step 5 as well as after
it.** `initall` runs the room's own `openset`, and those scripts read ownership to
decide what the room holds. Zeitel's idle is one of them: it picks its line from
`propowner("painting")`, and a checkpoint taken standing next to him with the
painting already traded made him open the branch for someone who *hasn't* traded —
which parks on plaques inside the load, so the load never returned. A room asks
about the world while it is opening, so the world has to be right before it opens.

### What a load is therefore *not*

A faithful reload is not a snapshot of the running game, and the difference is worth
naming because it is what the [playthrough](../verification.md#one-game-carried-not-a-chain-of-loads)
had to stop leaning on. Three kinds of loss — the first of which has turned out to be
much smaller than this page twice claimed:

- **Not in the format — but check the frame before believing that.** This page said
  exactly that twice, first about `actorowner` and then about `actorvalue`, and both
  times the field was there and *we* were reading the record 80 bytes out of position.
  The genuine residue is now small: the crowd extras (above) and the scheduler's own
  tables, which a load rebuilds from the arriving room rather than from the file.

  What it used to cost is worth keeping as the worked example.
  [#86](https://github.com/dhobi/taoot-web/issues/86): the engine room passes Vlad
  between three scenes and only Scene108 places him, so a save taken further along
  the catwalk came back with him at `(0,0,0)` and no set at all. His mousedown opens
  `if realdist(me) < hotdist()`, so Scene110's `sendtoactor("vlad", mousedown(0))` —
  the gesture that *is* the fistfight — reached nobody, and the player walked on into
  the smokestack in the wrong phase with nothing to find. Measured at the moment of
  arriving at Scene110: with the placement restored his `vlad1.pup` opens, without it
  no puppet opens at all.
- **Dropped for want of room.** The variable table is fixed-size, so globals the
  base save has no record for and no free slot for are not written; they keep the
  base's value, and the log says which ones.

  How many depends entirely on *which* base, because a `.ti` holds the variable
  list that existed when it was taken. Measured against the 163 globals the shipped
  109 know between them, `1/01 - April 14th, 1942` — the first file in `save/1`,
  and what the template picker used to hand a fresh playthrough — could hold 99 and
  dropped **64**, among them the entire turbine puzzle (`boiler`, `turbine`,
  `condensor`, `steamtank`, all four pressures), the smokestack maze
  (`mazenumber`, `stacklevel`), the darkroom's plates, `stokerphase`, `troutmoney`,
  `turkwater`, `fencelevel` and `stackmax`. Ranking the shipped saves by
  [`globalsCapacity`](https://github.com/dhobi/taoot-web/blob/master/src/df/savegame.ts)
  instead takes disk 1 to **44** dropped and disk 2 to **24**, and what is left is
  blackjack-table and fistfight scratch that a load re-initialises anyway (#85).
- **Inherited from the skeleton.** A patch-write starts from a *shipped* save, so
  any slot nothing overwrites keeps that save's value — `oldset` "None", the
  location container's facing and road, and the `propview` of the chrome the port
  never sets (`door`, `signs`, `wiremsg`, `navtoggle`, `subtoggle`, `invenctl`,
  `lid`, `invenhelp`: 6–8 records per save, measured). Those are inherited *on
  purpose* — the base's value is a real reading by the original engine and ours
  would be the prop's first state, and the arriving room recomputes them regardless.
  The chrome **owners** are no longer in this list: the band's memo is written like
  any other `propowner`. (`clock` is not here either: it is the variable list's head
  and a patch writes it like any other global — measured, "bedsit" written and read
  back.)

Everything else — loops, crickets, music — is rebuilt by re-running the room's own
`openset`/`openscene` at the restored progress, which is faithful and still not the
same thing as continuing.

### The actor record

A cast record is **the live runtime struct, dumped verbatim**, 160 bytes on its own
grid. The frame is the whole difficulty, and TI.EXE settles it: `0x410d00` fetches a
record by name with a stride of 160 (`lea eax,[eax+eax*4]; shl eax,5`) and
string-compares against **record+0x50**, then hands the caller all 160 bytes. So the
name is *not* at +0 — the five string fields are the record's second half and every
number sits before them. Reading it the other way round puts you 80 bytes into the
next record's heap pointers, which is exactly where two wrong conclusions came from.

Each accessor then reads its own field out of that copy (buffer at `esp+8`;
`actorxyz` at `esp+0x10`):

| offset | type | field | recovered from |
|---|---|---|---|
| +0 | i16 | `actorvisible` (>0 is visible) | `0x40eec0` |
| +24 | i16 | `actordeg`, 0..255 | `0x40e850` |
| +26/+28/+30 | i16 | `actorxyz` 1/2/3 — the SET's own X, Z, Y order | `0x40f285/97/a9` |
| +38 | i16 | `actorspeed` | `0x40ead0` |
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

`actorvalue`'s offset is the cautionary one. It sat at name+152 — which is
`(name + 160) − 8`, the same field one record along — so every character was restored
with their **neighbour's** conversation count. It looked right because it produces a
plausible series; that series (0→1→3→5→8→13→21 over disk 1) simply belongs to Penny,
who you report to after every errand, and it was being handed to Morrow, whose own is
0→2→3.

### The arriving room cannot be trusted to silence the last one

Which is why step 4 halts the theme and voice channels itself rather than leaving
it to step 5. `scheduler.reset()` owns loops, crickets, walks and the `sound`
channel — not the music and not speech — and the tempting assumption is that the
destination's `setupsound` will simply play over them. It does not always play
anything: **`setupsound` sometimes scores a room deliberately silent** (arriving in
C73 at mission 1 phase 0 is scored by the Smethells knock), and then the room you
*left* keeps playing. Start the game in the London flat, load from the CTL menu, and
`bedrad1.trk` — whose loop chunks *are* the announcer — reads the news over the
loaded room.

`advanceday()` has always known this: it halts the theme before opening the next
day's room (`BOOTFILE` 0002:148), and the dev-tools jump copied it. A load is the
same manoeuvre and now silences the same way. `currentThemeName` comes down with the
theme, because [`transfromflat`'s overlay
restore](stage-ui.md#the-overlay-stack-transtoflat-transfromflat) keys off that value
— left stale, closing a later overlay would put the flat's radio *back*. `voice` is
the same hole one channel over: nothing but a skip or a stop halts it, and a load is
neither, so a load taken mid-line let the speaker follow you into the next room.

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

Next: everything else the browser provides — **[The browser host](host.md)**.
