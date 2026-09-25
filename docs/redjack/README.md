# RedJack

*Redjack: Revenge of the Brethren* (1998, published by THQ) is CyberFlix's last
game, and the only one in this repository on **DreamFactory 5**. It is the
first time the engine has a real camera: a room is a set of points you stand at
and look round from in every direction, joined by films that walk you from one
to the next, where every earlier game had fixed views and a turn ring.

What runs here is a **prototype**: the real `GameHost` and `GameSession`
pointed at the three discs, on port 5179 with
`npm run dev -w redjack`. It boots, you can walk the rooms and look round them,
the films, props, actors and puppets play, and the fights' stage opens. The
first day plays through headless (see [Machine suites](#machine-suites)); days
two and three have not been played through yet.

## What was found

No source consulted attributed RedJack to the engine, and its own write-ups
describe several purpose-built engines instead. The discs settle it the way
they settled [Timelapse](../timelapse/) and [Skull Cracker](../skullcracker/):
every one of its data files is a DreamFactory container, and container 0 of
each says version 5. The executable names its own files "DreamFactory 5.0
Boot File" and "DreamFactory 5.0 Saved Game", and `rj.ini` says "DreamFactory 5.0"
too.

| | |
|---|---|
| rooms | 41 `.sett` files |
| films | 179 `.move` files |
| props, casts, puppets | 52 `.shop`, 10 `.cast`, 58 `.pupp` |
| stages, sound banks | 27 `.stag`, 48 `.trak` |
| engine version | 5 — the tag in container 0 of every one of them |
| screen | 640×480 (the BOOTFILE's container 0) |

(Measured with `versionOf` from `engine/src/df/version.ts` over every file in
the rip, not counted by hand.)

Every file type is spelled with four letters (`.sett`, `.move`, `.shop`),
where v4 used three, and the BOOTFILE is `bootfile.boot`. The scripts ask for
the same long names (`openstagefile ("control.stag")`), so
`redjack/src/files.ts` renames only the one file the engine asks for itself.

### Three discs, one day each

The game says which disc it is on. The BOOTFILE's `advanceday` sets a global
`disk` for the new day (`"Disk1:"` to `"Disk3:"`), and `resetpaths` writes
`"RJ" @ disk` into the path table: `path (5, "RJDisk2:movies:")`. The port reads
the volume out of that the way it follows Titanic's `setpath`, and hands it to
the file store as a disc change (`path` in `engine/src/runtime/builtins/helpers.ts`,
the store in `redjack/src/files.ts`).

It matters for one file. The only name all three discs carry is
`movies/death.move`, the film you die to (the BOOTFILE's `nickdeath`), and
each disc's is its own: disc 1's is 50 frames and dated April 1998, and discs 2's
and 3's are 60 frames, dated March, and differ from each other. A name more than
one disc carries is served from the disc the day is on.

**What stayed the same is most of it.** The container file, the script bytecode
and its command ids, the frame codec, the record layouts of props, casts,
puppets, stages and sound banks: all v4's, moved by a few fixed amounts. What
changed is on these pages:

- **[DreamFactory 5's containers](../engine/formats/dreamfactory-5.md)**: the
  24 bytes every container now opens with, the palette that moved into each
  picture, and what that did to each format.
- **[SETT: rooms, nodes and spheres](../engine/formats/sett.md)**: the one
  format that is new rather than moved.
- **[Rooms in play](../engine/runtime/rooms-v5.md)**: the camera, the walk,
  where a sprite goes on the screen, and what hides it.
- **[The v5 commands](../reference/builtins.md#dreamfactory-5-—-maze-ts-and-df5-ts)**:
  the ones RedJack's scripts use that no earlier game had.

## RedJack.exe is the truth

Like Skull Cracker's, every behaviour on these pages was settled by
disassembling the game's executable, `RJDisk1/RedJack/RedJack.exe`, and the
code cites its addresses (`0x435740`, `0x4358d0`…) beside what it ported.
[`redjack/tools/rjdis.mts`](../reference/tools.md#mining-redjack-exe)
does the reading:

```sh
npx tsx redjack/tools/rjdis.mts cmd propflip      # a script command's handlers
npx tsx redjack/tools/rjdis.mts func 0x42caa0     # the whole function an address is in
npx tsx redjack/tools/rjdis.mts str "move.c"      # code that uses a string
```

`cmd` is where a command starts. The engine dispatches a statement and a value
through two different tables, each indexed by the command's id, so a getter and
a setter of the same name are two functions, and `cmd` prints both.

**The source files' names survived in it.** Strings in it name the C files it
was compiled from (`move.c`, `wave.c`, `high.c`, `Flat.c`), so
`rjdis str "move.c"` lands in the film player.

## Machine suites

RedJack is tested the way Skull Cracker is: the game runs in node on the three
discs, with no page and no clock, and each suite steps the engine as fast as the
CPU goes, waiting on the game's state and never on a duration.

    npm test -w redjack                          every suite
    npx tsx tools/runmachine.mts intro           just these (from redjack/)

- [`tests/machine/harness.ts`](https://github.com/dhobi/dreamrefactory/blob/master/redjack/tests/machine/harness.ts)
  serves the discs as the page does, including each disc's own
  `death.move`. A v5 room has no set viewer, so the harness reads the room from
  `session.maze` and sends clicks and keys to the director.
- The harness sets `session.drawsPictures` to false, so a film reads each frame's
  size and palette but skips decoding its pixels. That is most of the time a
  headless run would otherwise take. The film still paces by its own
  soundtrack, so the audio is still decoded.
- `tests.yml` runs the suites on every pull request when the rip is linked.

`intro` runs from the cold boot through the three films to the first room,
`liznite` at Node52, and checks that no script error was logged on the way.

`day1` plays the whole first night, the stowaway's way:
- Bone, Lyle, Jan in the woods and Lyle's rescue at Node54, which puts the fire out;
- the bar: the bartender's door, the mug of ale and Captain Justice;
- the lighthouse, the cave, the trunk with the sword and pistol, and Patch's story;
- Lyle's three lessons and the fight with him on the dock;
- Bone's last two talks, which send him and Cross out to the ship;
- the charcoal from the dead fire, the X on the crate, and into the crate, until
  day two begins aboard with `nickdisc.move`.

Each step checks the flag the script it cites sets.

The moves are the player's, in two files:
- [`route.ts`](https://github.com/dhobi/dreamrefactory/blob/master/redjack/tests/machine/route.ts)
  walks a room by its exits (turn to the exit, then up), clicks what `hittest`
  names, pans or rests on the screen edge to bring a thing out of the scroll
  margin, answers conversations by the text of a choice, and drags an item out of
  the inventory onto its target.
- [`fight.ts`](https://github.com/dhobi/dreamrefactory/blob/master/redjack/tests/machine/fight.ts)
  reads Lyle off the screen and answers with the pointer and the arrows: the
  guard where his wind-up says, the lane no bottle is falling down, the three
  strikes in turn at a hand's pace, and in the fight both, with the button held.

Playing it this way found several engine gaps, each fixed from RedJack.exe where
it could be read and marked as a reading where it could not: puppets opened by a
bare name, the stage header's main-script field, a room opened at a node it
lacks, `actorstar` ending a walk, `endanim`, key releases, and shops closed by the
name they give themselves.

## What does not work yet

- **Copying to the hard disk.** `buildfilenames` and `copylocal` copy game
  files off the disc. The port reads the discs directly, so they are left
  unknown.
- **Sprite size is not checked against the original.** The formula is read out
  of RedJack.exe (`0x4358d0`), but no screenshot of the running game has been
  measured against the port's. See
  [Rooms in play](../engine/runtime/rooms-v5.md#how-big-a-sprite-is).

**The menu bar is a debug menu, and the shipped game hides it.** `boot ()`
builds File, Script and Sound menus (`createmenu`, `appenditem`, `cmdkeyitem`,
`drawmenus`): Quit, Brighter and Darker, ten volumes, and an editor for each
kind of script, the editors each behind `if isdebugging ()`. A few lines earlier,
`menuvisible (isdebugging ())` and `keyaborts (isdebugging ())` switch the bar
and the keyboard abort off, since `isdebugging ()` is 0 in the shipped
RedJack.exe (`0x41a6f0`). It is Titanic's [developer mode](../taoot/devmode.md)
with the flag moved out of the scripts and into the executable. The port builds
no menu either.

A few script calls go to handlers that no script on the discs defines
(`mousemove`, `trackobjects`, `predream`), so the original had nothing to run
for them either.

Back to [Documentation](../README.md).
