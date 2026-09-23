# Developer mode

*The debug build CyberFlix built the game with, reachable again.
`taoot/devmode/`, reached by the 🛠️ in Titanic's top bar.*

`BOOTFILE`'s `boot()` opens like this:

```
	setloc = false
	debugging = false
	puppetparam (9, 1)
	puppetparam (10, 25)
	menuvisible (debugging)
	keyaborts (debugging)
```

`debugging` is read by 355 lines across 29 files and assigned by that one. A
debug build is this line edited; everything behind the flag is in the shipped
game files.

The `/devmode/` page runs the game with the flag raised, the modifier keys
answering, and TI.EXE's own menu bar on the screen.

## Turning it on

The page raises the flag itself, once the boot has opened a set. Three things
switch it: **Options ▸ Debug On/Off**, its **Ctrl+D** accelerator, and the ● / ○
indicator beside the menu bar.

All three toggle, which goes one step past the disc. `menuselect`'s case is
`if debugging → debugging = false`, so on the disc the command only turns
developer mode *off* and the way back is to relaunch; the page supplies the
missing half so that On/Off does not do nothing on every second press.

Loading a saved game lowers the flag too — `debugging` is one of the 68 numeric
globals a `.ti` file carries, stored as 0 in all of them — and the page
re-raises it.

## The modifier keys

Most branches behind the flag are gated `optionkey () & debugging`: 92 of
`optionkey()`'s 109 calls test the flag on the same line. The ⌥ and ⌘ latches
beside the menu bar hold those keys down for every click, which is the reliable
way to ask — a window manager or a browser may take Alt-click for itself, and
some layouts have no Command key. Holding the real key works too.

Four modifier branches carry no `debugging` test, so they answer whenever the key
is held: `shiftkey()` on the HELP button, and `optionkey()` in the photo album,
on the smokestack's props and on the cricket mover.

## The menu bar

`menuvisible (debugging)` puts a native menu bar across the top of the window. The
menu lives in TI.EXE as an `RT_MENU` resource, and a script hears about it when
the engine calls `menuselect (name)`. `taoot/tools/devmenu.ts` reads the resource
and emits `taoot/src/devmode/menu.gen.ts` — four menus, 24 commands, with the
Win32 command ids and `Ctrl+X` accelerators the resource gives them:

| | |
|---|---|
| **File** | Quit |
| **Options** | Message, Report, Close Puppet, Debug On/Off |
| **Sound** | Volume 0 … Volume 9 |
| **Scripts** | Flat, Scene, Set, Stage, Boot, Post, Server, Painting, Button |

Clicking one calls BOOTFILE's `menuselect` through `runGlobal`, so every
behaviour behind the bar is the game's.

Ten commands are greyed, with the reason in their tooltip. The nine **Scripts**
commands open the in-engine script editor, which needs the authoring tool: TI.EXE
tests an "editor available" flag at `0x489f2c`/`0x489fd8` that is clear in
shipping builds. **Options ▸ Report** is handled in the executable, and
`menuselect` has no case for it.

`menuselect` answers one name the bar does not carry, `"abort"`: the keyboard
abort armed by `keyaborts (debugging)`.

Two commands are useful. **Options ▸ Close Puppet**, with no conversation
open, asks for a name and opens `<name>.pup` cold. **Options ▸ Quit** skips the
confirmation a player gets.

## What to go and do

[The census](devmode-census.md) describes every branch. These are the ones to
start with.

### The bedsit door

Stand in the bedsit facing the door (Scene3/View21) and click it.

- **Plain click** runs `advanceday()`, the game's day machine, which skips
  forward a chapter.
- **Option-click** hands you the bag, the map and the watch, randomises who holds
  the notebook, the painting, the two necklaces and the Rubaiyat, sets the clock
  to `startdisk2` and then advances — a jump to disc 2 with a playable inventory.

### The deck map's developer areas

`MAP.STG` has 32 red areas calling `jumpbaby`, and 15 sit behind
`if not debugging → exitcode`. With the flag up, 14 of them jump: the
**gymnasium** and four spots along the boat-deck promenades, the **1st Class
Smoke Room** and four along A deck's, the **Café Parisian**, the **poop** and
**forecastle** decks on B deck, and one F-deck hallway. Where the live 17 areas
reach staircases, these reach rooms, and the map covers 16 sets instead of 8.

The fifteenth is the 1st Class Lounge, whose region returns at a bare `exitcode`
above its jump:

```
	if not debugging
		exitcode
	endif
	exitcode
	jumpbaby ("lounge1c", "scene60", "view63")
```

`Scene60/View63` exists in the set, and the lounge is reached on foot from the
lounge hallway — `gotospecial ("lounge1c", "scene10", "view16")` from `stair1c1`,
`Scene14/View37` from `gstair2`. Which scene you arrive in depends on the
staircase you came from, the doors back out set `savedeck` to name it, and the
hallway's door branches on that; the map's jump would arrive at `Scene60/View63`
with `savedeck` holding the deck letter `"a"`. It is the only one of the 15 whose
arrival is stateful.

To use them, Frank needs the bag and the watch (`mapdisabled()` checks both), and
a plain press is what jumps — shift opens the button's script editor. The map
also refuses in mission 4 and from the smokestacks, the boiler room, the cargo
hold and the bunkers.

The page outlines them while a plan is open. The map's legend says "click the red
areas" and the reddish fill marks the live 17; the debug areas sit on plain plan
artwork, with `cursor ("arrow")` where a live one says `cursor ("touch")`. The
**map areas** toggle draws all 32 — amber for the 14, green for the live 17,
dashed red for the lounge — from rectangles `taoot/tools/mapareas.ts` reads out
of MAP.STG into `taoot/src/devmode/areas.gen.ts`. The engine's `hittest` decides
what a press does.

### The false smokestack

`SMSTACK2.SET` c1's `pathblocked` returns false, so the crate maze inside the
dummy funnel stops blocking and you can walk through it. It is the game's one
`pathblocked` handler.

### Readouts

Hold ⌥ and `idle()` prints the current set, scene and view, with Vlad's distance,
every tick. Hold ⇧ and point at a character for that actor's distance.
`GANG.CST`'s `runpuppet` names whoever a conversation is starting with. On
`/devmode/` these land in the Details column under the picture.

Shift-clicking the interface band's **HELP** button raises the game's own state
readout — `Mission=…, Phase=…, Letter=…, Necklace=…`, plus `Maze=` and `Level=`
inside the smokestacks.

### The console

The row under the menu bar takes a line of the game's own script, compiles it and
runs it against the live session:

```
sendtoshop ("inven.shp", addallinven ())
propowner ("bag", "frank")
return (currentset () @ " " @ currentscene ())
```

The line is wrapped in a `code console () … endcode` handler, compiled by the
assembler the format editors use, and loaded by `GameSession.instanceFrom` —
the same path a container read off the disc takes. So it resolves builtins, boot
library routines and globals by the rules a script in the game follows, and
`sendtoshop`, `sendtoactor` and the rest reach the same places.

The handler's return value shows beside the prompt, which is what `return (…)`
is for. Anything the line prints with `message ()` goes to the Details pane,
where the engine routes a builtin's log. ↑ and ↓ walk the history.

The console reaches the four handlers with no caller — `addallinven()`
(every item in the game), `movies()` (every item's film), `solvebomb()` and
`solvedoll()`, all invoked from the script editor on the disc. It also stands in
for the nine greyed **Scripts** commands: the editor needs a tool that is not in
a shipping build, but the language it drove is available.

### The placement mode

`BOOTFILE`'s global mousedown hands a click on an actor to `move3dactor`, and on
a prop to `move3dprop` or `move2dprop`:

```
	thename = hittest (thepoint)
	switch result ()
	case "actor"
		if setloc & debugging
			move3dactor (thename)
```

Those three are BOOTFILE handlers written in script. They grab what you clicked:
option-drag slides it across the floor, option+shift-drag raises and lowers it,
shift-drag turns it, and the log prints x, y, z, facing, clip and scale every
frame. Every builtin they call is implemented.

They want a second global. `setloc = false` is `boot()`'s thirteenth line, one
above `debugging`, and its only assignment — the disc had two switches, and so
does the page: the **place** latch beside ⌥ and ⌘ raises it.

Flip it for a moment rather than leaving it up. While `setloc` is raised, every
click on an actor or a prop goes to the mover instead of the object's own
`mousedown`, so nobody can be talked to and nothing can be picked up; and a
plain click on an actor does nothing at all, because `move3dactor` leaves at once
unless option or shift is held. `move2dprop` is the exception — it drags a flat
prop with no modifier.

Positions live in the session, so a reload puts the room back.

## Checking it

| | |
|---|---|
| `taoot/tests/auto/devmode.ts` | the menu against BOOTFILE's `menuselect` cases, the deck map's 15 areas driven with the flag down and up, the modifier probes, and the console against a live session |
| `taoot/tests/browser/devmode.ts` | the flag across a boot and a load, a menu click reaching the script, the latches, the map overlay and the console row |

## The complete list

**[The census](devmode-census.md)** — every read of `debugging` and every
modifier probe in the English tree, with a sentence on what each branch lets you
do and the containers behind it. Generated by
`npx tsx taoot/tools/devcensus.ts`.

Back to [Titanic](README.md).
