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
- the current **set / scene / view**, and
- the **inventory**: each `inven.shp` prop's owner + view, so possession
  survives.

Everything the loader ignores stays byte-for-byte as the base had it.

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
   rebuild props, actors, loops, crickets and music *at the restored
   mission/phase*.
6. Overwrite the default inventory `initall` seeded with the save's actual
   owner/view per prop. The four **band props** (`bag`, `watch`, `map`,
   `life`) are restored by possession only — their on-band appearance is
   rebuilt by `initinterface` — and `handitem` is always cleared (you can't
   be mid-drag after a load).

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
had to stop leaning on. Three kinds of loss, all of them the original's too:

- **Not in the format.** `actorvalue` has no field in the actor record at all
  (measured across four shipped saves: only the owner moves), so a load forgets it.
  `actorowner` was lost the same way until `SavedActor` learned it — which is what
  lets the Purser remember his errand across a checkpoint.
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
  location container's facing and road, the interface band's own chrome memos.
  (`clock` is not one of them: it is the variable list's head and a patch writes it
  like any other global — measured, "bedsit" written and read back.)

Everything else — loops, crickets, music, actor positions — is rebuilt by re-running
the room's own `openset`/`openscene` at the restored progress, which is faithful and
still not the same thing as continuing.

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
