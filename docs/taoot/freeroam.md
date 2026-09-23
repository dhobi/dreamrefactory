# Free roam

*The guided tour the disc ships, entered directly, with every door answering.
`taoot/freeroam/`, reached from **Play ▸ Free roam** in Titanic's top bar.*

Titanic has two modes, and the second one is a menu away in the original.
`BOOTFILE`'s `boot()` plays a movie with a click region in it and reads which
half was pressed:

```
	playmovie ("playmode.mov")
	cursor ("watch")
	if actionframe (1)
		tour = true
	else
		tour = false
	endif
```

and ends by choosing an advance to match:

```
	if tour
		sendtostage (advancetour ())
	else
		clock = "startdisk1"
		sendtostage (advanceday ())
	endif
```

`/freeroam/` is the play page with `<meta name="start-mode" content="tour">`. It
presses the guided-tour button itself — found in the movie, as whichever region
jumps to the frame the file names as its action frame, so `boot()` sets `tour`
off its own `actionframe(1)` exactly as it would for a player — and skips the
films in front of it with **Esc**, the key the disc gives a player for them. The
page opens in C-73.

## What the tour is

`advancetour()` empties the game of its story and opens the ship:

```
	mission = -1
	phase = -1
	neckphase = -1
	letterphase = -1
```

then resets every actor and every prop owner, plays `opentour.mov`, mounts the
second disc with `setpath (2)` and puts you down in C-73 —
`initall ("c73", "scene51", "view63")`.

Two more things follow from the flag. The deck map is unconditional:

```
code mapdisabled ()
	global tour, mission
	if tour
		return false
	endif
```

so **M** works in every room, with no bag and no watch, and without the refusal
for mission 4 or for the smokestacks, the boiler room, the cargo hold and the
bunkers. And the interface hands you what the map needs rather than making you
find it — `house.shp`'s `initinterface` is `sendtoprop ("map", addmap ())` and
`sendtoprop ("ship", addship ())` when `tour` is up.

`tour` is read on 278 lines across 77 files. Most of them are `openset` and
`closeset`, where the day machine would otherwise stand characters up; eighteen
are door hotspots.

## The doors

Every walk-through in the ship is two steps. Clicking a door runs its hotspot's
script, which stands the shared `door` prop up in this doorway:

```
sendtoprop ("door", setupprop ("hallb-b59"))
```

and the ↑ that follows will only take the step if that worked:

```
if currentview () = "view40" & arg = "uparrow" & propvisible ("door")
	sendtostage (gotospecial ("b59", "scene14", "view19"))
```

Of the 129 doorknob scripts in the game, 104 call `setupprop` unconditionally.
Six answer a tour with a sound instead — the passenger cabins knock, and the
lounge says it is locked:

| Room | Door | A tour gets |
|---|---|---|
| A-14, Sasha's | `halla` `sashadoor` | `voicesound ("knock1")` |
| B-59, Conk's | `hallb` `hallb-b59` | `voicesound ("knock1")` |
| B-70, Charlotte's | `hallb` `hallb-b70` | `voicesound ("knock1")` |
| C-59 | `hallc` `hallc-c59` | `voicesound ("knock1")` |
| C-78, Burns's | `hallc` `hallc-c78` | `voicesound ("knock1")` |
| 1st Class Lounge | `lnghall` `lnghall-lounge` | `voicesound ("doorlocked")` |

All six open here — five of them straightforwardly, and the lounge with the one
extra thing described two sections down.

On this page the game goes first and is not interrupted. The knock plays, the
speech plays, the character who answers answers, and the door that shuts in your
face still shuts. Only once all of that has finished, and the door is standing
shut, does the page stand the doorway up itself — the same `setupprop` line the
hotspot's own script holds, so the ↑ that follows is the game's, landing in the
scene and view the game chose.

"Once all of that has finished" is the engine's own word for it and not a wait:
`session.onHotspotClick` fires from the bottom of the hotspot dispatch chain,
after every handler in it has been awaited. A door with nothing behind it —
B deck's `locked` hotspot is a cabin that opens in no build — stays shut, because
there is no doorway to stand the prop up in.

Which doorway that is comes out of the hotspot's script rather than a list:
`taoot/tools/doorways.ts` reads all 126 door hotspots and the 134 doorways they
name, and carries the conditions each one sits under. Eight hotspots offer a
choice, and the condition decides it — C-78's door is the lit or the dark one by
`whitelight`, the C-deck cabin door is C-59 or C-78 by `hallside`, and the
purser's stairwell picks by `savedeck`.

## Which side of the ship you are on

Free roam breaks story state on purpose — that is the whole of it. What it does
not break is **where you are standing**.

Each passenger corridor is one set used for both sides, mirrored, and `hallside`
says which. B deck's `Scene29/View40` is B-59's door to starboard and B-62's to
port, with the same `hallb-b59` doorway behind it either way; the game never
lets that matter, because the doorknob refuses unless `hallside = "star"`. So
does this page: a doorway whose `hallside` or `savedeck` conditions do not hold
belongs to a different door, and is not opened. B-59 opens to starboard, B-70
and A-14 to port, and C-59 and C-78 are the same door on opposite sides.

## The doors it leaves shut

A door is opened only where walking through it goes somewhere, and there are two
ways it does not.

**There is no room.** D-19 on D deck has a door and a doorway: `clarisdoor`
opens so that Claris can stand in it and be spoken to. What D deck's corridor
does not have is a step behind it — its `uparrow` handlers are at `view103` and
`view32`, and D-19 is not a place the game has. Penny's door on F deck and
Shay's below are the same shape. Opening one would show you a doorway and a
wall, so it stays shut.

## The one step the page takes itself

The 1st Class Lounge is not like those. There is a room behind its door and a
real walk-through to it — what refuses the ↑ is the corridor's own guard, above
the door rather than by it:

```
if currentview () = "view12" & arg = "uparrow" & (tour | mission < 4)
	exitcode
endif
if currentview () = "view12" & arg = "uparrow" & propvisible ("door")
	switch savedeck
	case "stair1c1"
		sendtostage (gotospecial ("lounge1c", "scene10", "view16"))
	case "gstair2"
		sendtostage (gotospecial ("lounge1c", "scene14", "view37"))
```

Nothing a page can set makes that guard false during a tour — `mission = 4`
still leaves `tour` true — so this is the one place free roam runs the step
instead of the room. The gesture is unchanged: you click the door, it opens, you
press ↑. What differs is only who runs the last line, and it is the line the
script below the guard holds, at the standpoint it names — `scene10/view16` off
one staircase and `scene14/view37` off the other, by `savedeck`, so you come in
on the side you walked from.

The same tool reads all of that: each hotspot carries the rooms its view's ↑ can
reach, where in them, **and the conditions on each** — including the ones an
early `exitcode` above it leaves behind.

## What you can reach

Walking the ship's 271 set-to-set trips with `mission = -1`, plus the deck map,
reaches 48 of the 56 rooms. The five cabin doors bring it to 53, and the lounge
to 54. The last two are not doors at all:

- **`deckbd2`**, the flooded boat deck, is what every boat-deck door opens onto
  once `mission >= 4`; `mission = -1` always picks the dry `deckbd`.
- **`bedsit1`**, the London flat the game opens in, has no door anywhere in the
  corpus. It is where `advanceday()` starts and nothing walks into it.

Both ship only on the first CD, which `advancetour`'s `setpath (2)` does not
mount — along with `c59` and `lounge1c`, whose rooms this port loads from the
other disc.

## Keys

The play page's, unchanged. **M** opens the deck map, which works everywhere
here; **←** **→** turn, **↑** (or **W**) walks, and **Space** opens the door in front of you
— `BOOTFILE`'s own `keydown` looks through the view for a hotspot called `door`,
`locked` or `knock` and sends it a click, so the key gets the same answer the
mouse does, including this page's.
