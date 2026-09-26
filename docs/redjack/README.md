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
first four days play through headless (see [Machine suites](#machine-suites));
the last three have not been played through yet.

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

## The seven days

The game is seven days, and the BOOTFILE's `advanceday` is where one day
closes and the next one opens: a case for each day, which picks the disc, opens
the day's first room and cast, and often plays a film or starts a talk. Each
puppet file keeps a talk per day, and a mini game is a stage, or a room of
its own such as the cannons.

All seven days are played by the [machine suites](#machine-suites), from the
cold boot to the end of the game.

| Day | Where (disc) | Talks | Mini games | How it ends |
|---|---|---|---|---|
| 1 | Hangman's Reef at night (liznite, disc 1) | Bone, Lyle, Patch, the bartender, Captain Justice | Lyle's three lessons (defense, dodging, striking) and the fight with him on the dock; the trunk; the fire pit; the crate | Nick hides in a marked crate and is loaded onto the Marauder |
| 2 | The Marauder (ship, disc 1) | Justice (the oath, then his cabin), Lyle, Sullivan (Anne) and her letter | The cannons: four dinghies to sink | Justice's last word, and the voyage (`montage.move`) |
| 3 | Port Royal (ptroyal, disc 2) | Justice, Erzulie, the constable, Anne at the jail window, the soldier | The alley fight with Jan and his second (`jcombat`); the jail escape (rum, a rock from the wall, the keys); the street fight's three waves (`bfight`) | Justice is murdered, and Nick is tried at sea (`trialset.move`) |
| 4 | RedJack's island (rjbeach, disc 3) | Anne, RedJack in a dream, Rockfish | The totems (`totem`); the gem lifts at the skull's teeth (`gem`); the lava's pillars; the flame corridor and its switch; the swinging chain; the skeleton, beaten with a vine (`scombat2`); RedJack's lockbox; the crate and its crowbar; the horn caves and the squid door; lighting the beach's fire pit with the torch | Rockfish answers the fire and takes Nick to Blackbeard (`rock3.pupp`) |
| 5 | Blackbeard's island (bb1, disc 2) | Rockfish, Lyle, Denton, Blackbeard, Bone | The lift's handle (`elevator`); Blackbeard's drink (`drink`), with Lyle's sulphur and a coal from the bin by the dock (`charcoal`); the mine carts with the harpoon gun, three sets of Jan's men (mc1–mc3); the fight with Bone (`bcombat`) | Bone beaten, and Blackbeard sends Nick to Cartagena (`arrive.move`) |
| 6 | Cartagena (lock1–lock3, dock, hold, torture, study; disc 2) | Anne, Rockfish, Elizabeth and Jake in their cage, Marquez | The lock: its valves, the pipe, the raft and the two chains (`botvalves`, `lock2.pupp`), and the rope cut with the sword; the torturer's fight, the whip and then the cauldron (`tcombat`); the study's four shields (`shield`), the gearboxes (`switch`) and the switch that lowers the cage | Marquez in his study (`marqintro.move`), and the voyage to RedJack's island (`cartrj.move`) |
| 7 | RedJack's island again (rjbeach, horn caves, ballista; disc 3) | Blackbeard and Marquez face to face (`bbintro3.pupp`), Anne, Blackbeard on the galleons, and at the end Patch, RedJack, Lyle, Blackbeard, Jake, Elizabeth, Cross and Anne | The Spaniard's sword fight on the beach (`spancombat`); Marquez in the horn caves, beaten by a door and the stairs (`mcombat`); the horn, which sets the squid on him; a totem woken, and the ballista: two galleons to sink | Patch and RedJack on the beach, the crew's last words (`finishtheend`), `swimin.move`, and back to the menu |

Some things lie off the suites' route. The bar's darts and the shark in the
bay are day one's, and killing the shark is the other way onto the ship,
the one that leads to the Justice ending.

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

`day2` plays day one to get aboard, then the day at sea:
- the oath to Justice, and the crew on deck;
- Lyle introducing Sullivan, and her talk, with her father's letter;
- the cannons, played out: four dinghies sunk (`cannons.ts`);
- Justice's cabin, and his talk, which sails the Marauder to Port Royal: the
  suite ends on day three's first question.

`day3` plays the first two days, then Port Royal:
- Justice's watch, Erzulie's fortune, and Justice killed in the alley;
- the fight with Jan and his second (`jcombat.stag`);
- arrested, and the jail escape:
  - Anne's rum at the window, which the constable drinks himself asleep on;
  - a rock raked from the wall with the spoon, thrown to bring the rifle down;
  - the keys onto the lock, and the trunk with the sword and pistol;
- the street fight's three waves, and the trial at sea: the suite ends on day
  four at RedJack's beach.

`day4` plays the first three days, then RedJack's island:
- the totems put to sleep, so the darts stay quiet;
- the gem lifts at the skull's teeth, solved as a search (`gems.ts`);
- the lava's pillars, crossed on the rules of which stand when (`lava.ts`);
- the flame corridor, stepped between the bursts, and its switch;
- the swinging chain, grabbed at the start of a swing, and the skeleton,
  brought down by the vine while Nick leans;
- the dream by RedJack's skeleton at the top, his key and lockbox, the journal;
- the crate's crowbar and horn, link1's scepter lock, the horn caves and the
  torch, and the fire pit: the suite ends on day five at Blackbeard's.

`day5` plays the first four days, then Blackbeard's island:
- Rockfish at the dock, and the lift's handle dragged through its slot;
- Rockfish's test in the lounge, a drink for Blackbeard: Lyle's sulphur, a coal
  from the bin downstairs, and the bar's bottles and ale, counted as
  `checkmix` counts them;
- Blackbeard's roar, his talk and his story, until he passes out and Jan's men
  attack;
- the mine carts, three sets of Jan's men shot with the harpoon (`mine.ts`), the
  crash, and the sword fight with Bone: the suite ends on day six at Cartagena.

`day6` plays the first five days, then Cartagena:
- the lock: Anne turns the valve with Nick standing in the drain, and he goes
  down alone. The lock door opens only while the lock above is drained, and
  filling it with the door open drowns him. So he goes through and shuts it,
  asks through the pipe for the fill valve and the raft, and drains the lock
  himself at the bottom valves;
- Rockfish's talk on the raft, the two chains held, and the rope cut with the
  sword: the raft runs out to the dock without Rockfish;
- the hold, and the torture chamber's fight. No sword stroke hurts the
  torturer (tcombat.shop `Edamage` stops on its first line); he is beaten by
  tipping the cauldron's coals at his feet and striking while he dances;
- the study key, the four shields' symbols, the gearboxes' levers, and the
  switch that lowers the cage; Elizabeth, and Marquez in his study: the suite
  ends on day seven at RedJack's beach.

`day7` plays the first six days, then RedJack's island again, to the end:
- Blackbeard and Marquez on the beach, and the Spaniard's sword fight;
- Marquez in the horn caves, behind the squid door. No sword stroke hurts him
  either (mcombat.shop `Edamage` stops on its first line). A switch at the
  fight's first step drops a door that squashes him if he is striking, and
  then he is beaten back up the stairs to Anne;
- the horn, blown with Marquez chained below it: the squid takes him;
- a totem woken, which saves Blackbeard and sends Nick to the ballista, and
  two galleons sunk before they reach the beach;
- the end: Patch, RedJack, the crew's last words and `swimin.move`, and the
  suite ends with the game back at its menu (`control.stag`).

Each step checks the flag the script it cites sets.

The moves are the player's:
- [`route.ts`](https://github.com/dhobi/dreamrefactory/blob/master/redjack/tests/machine/route.ts)
  walks a room by its exits (turn to the exit, then up), clicks what `hittest`
  names, pans or rests on the screen edge to bring a thing out of the scroll
  margin, answers conversations by the text of a choice, and drags an item out of
  the inventory onto its target. It also carries a thing with the button held,
  scrapes it along the jail's bars, and looks down or up by resting on the
  bottom or top edge.
- [`fight.ts`](https://github.com/dhobi/dreamrefactory/blob/master/redjack/tests/machine/fight.ts)
  reads Lyle off the screen and answers with the pointer and the arrows: the
  guard where his wind-up says, the lane no bottle is falling down, the three
  strikes in turn at a hand's pace, and in the fight both, with the button held.
  The same duel fights Jan, closing in when he steps back. In the street fight
  it clicks each man it sees and leads the view with the pointer toward the rest.
  In the torture chamber it leans away from each lash of the whip, takes up the
  sword at the fourth step, and then tips the cauldron and strikes. It puts the
  pointer on a strike's point a pass before it presses, as a hand gets there
  first: a strike reads the pointer before it asks `stilldown ()`, which takes
  a frame, and a strike read at the wrong point is always the same one, which
  the Spaniard then always blocks (spancombat.shop `samestrike`). Against
  Marquez it pulls the door's switch as a strike begins that has another swing
  to come, then presses up the stairs and clicks Anne.
- [`cannons.ts`](https://github.com/dhobi/dreamrefactory/blob/master/redjack/tests/machine/cannons.ts)
  aims with the arrows and fires with a click. For each tilt it follows the
  ball the way the cannon ball's script will, and uses the room's own projection
  and hit test to ask whether the dinghy, where it will have sailed to by then,
  would be under the ball.
- [`gems.ts`](https://github.com/dhobi/dreamrefactory/blob/master/redjack/tests/machine/gems.ts)
  solves the gem lifts on paper, as a breadth-first search over the rules
  gem.shop plays by, and then makes the clicks, checking each lift's level
  against the model.
- [`lava.ts`](https://github.com/dhobi/dreamrefactory/blob/master/redjack/tests/machine/lava.ts)
  holds the skull's other puzzles: the pillars, the flames, the chain and the
  vine.
- [`mine.ts`](https://github.com/dhobi/dreamrefactory/blob/master/redjack/tests/machine/mine.ts)
  rides the mine carts. It steers the view with the pointer onto the nearest
  man, and fires when the harpoon, flown the way the launcher's script flies
  it, would land on anyone: a man, or a dagger or bomb on its way.
- [`ballista.ts`](https://github.com/dhobi/dreamrefactory/blob/master/redjack/tests/machine/ballista.ts)
  fires the ballista the same way. It lays the view on the nearest galleon
  afloat, finds the tilt whose stone, flown as the stone's script flies it,
  lands on the galleon where it will have sailed to, steers there, and fires.

Playing it this way found several engine gaps, each fixed from RedJack.exe where
it could be read and marked as a reading where it could not: puppets opened by a
bare name, the stage header's main-script field, a room opened at a node it
lacks, `actorstar` ending a walk, `endanim`, key releases, and shops closed by the
name they give themselves.

Day two found more, each read from RedJack.exe:
- `sendtocast` and `sendtoprop` finding a room of the same name first;
- the scene, set, actor, cast and prop chains ending on the boot's library;
- `calcvectx`, `calcvecty`, `calcdist` and `calcdeg` in their v5 forms;
- a set opening hidden after a stage closed with no set open;
- a click left consumed by the last key's `exitcode`;
- screen props drawn in a room but not clickable there.

One more was a reading, that a hidden sprite hears no `endanim`. Day five
found it wrong for actors, and the exe says otherwise (below).

Day three found more:
- `sendtoshop` reaching a shop by the name it gives itself;
- `propis3d` as the prop's own flag in v5 (RedJack.exe 0x429d60), where the
  port had always answered 0;
- a v5 view's "plays once" flag (bit 0 at +0x14), which is on exactly the
  views whose end a script answers. Only those now end with `endanim`, and the
  jail spoon's `carrying` no longer runs round forever.

Day four found more:
- `closecastfile` by a bare name, and `closecast` fired (the dispatch
  string `", closecast()"` is in RedJack.exe);
- the flat's click regions and `pointinbutton` measured from the stage's
  origin;
- a v5 room never took the clicks queued while a script ran. It now takes
  them at the start of a pass, as the v4 viewer does, and a press while a
  script polls the button is queued, since RedJack's scripts flush what they
  consume;
- `idle ()` running behind a stage, where it fades the inventory chest in;
- the film header's two action-frame names, which the v5 reader had left
  empty (RedJack.exe 0x44e1ac);
- `propdeg` showing a frame by index where no frame carries the degree, as
  the chest and its lid seemed to need (common.shop open and close). Day six
  found the degrees misread, and the exe says otherwise (below).

Day five found more, each read from RedJack.exe:
- a view's and a pose's play list: at 0x2e, as in v4, not the 0x1ee the
  readers assumed, so no v5 play list had ever been read (the stepper
  0x42d198);
- a view or pose that borrows another's pictures: the u32 at +0x10 names it,
  and the lift's rope goes up on its way-down pictures played backwards
  (0x42d1a8);
- how views and poses step (0x42c89e, 0x4069ee): step 0 on the first pass,
  then by the clock at the step time held at +0x22e, in sixtieths of a second,
  or one step a pass without one. A view or pose that plays once holds its
  last step and hears `endanim` once, and any other goes round without one.
  Actors step and hear it shown or not (0x408481), which is how Jan's men in
  the mine finish their first pose in cover before they show themselves;
- `pointinactor` asking the one actor's own sprite (0x406860), where the port
  asked what was on top: the harpoon is drawn at the very point it asks
  about;
- `idle ()` stopping at the first harpoon: a loop fired in the pass counted as
  a script holding the engine. A v5 room now asks what held the engine as the
  pass began.

Day six found more, each read from RedJack.exe:
- which frame a view draws. A step of the play list names a group of frames,
  and of those the engine draws the one whose angle is nearest the prop's
  degree (0x42d0e0). The angle is an i32 at +0x26 of the frame record, and the
  port read only its top half, which is 0 for the small numbers most views
  count their frames by. So the torturer's cauldron, whose frames are its
  nodes 5 to 8, showed the empty frame it keeps for node 8 and could not be
  clicked; the health bars and Nick's guard poses, numbered from 1, were
  shown one frame off; and the alley fighters' strikes, two frames to a step,
  played at half speed (see
  [the shop, the cast and the puppet](../engine/formats/dreamfactory-5.md#the-shop-the-cast-and-the-puppet));
- `propdeg` only stores the degree, masked to 24 bits (0x428880), and stops
  nothing, so the day-four stand-in that showed a frame by index is gone;
- `puppetevent`'s argument, a wait in sixtieths of a second that answers -2
  when it runs out, where a negative one waits for good (0x42f140). Marquez's
  `puppetevent (0)` just after an answer is a look, not a question, and waited
  out as one his talk asked its first question twice.

Day seven found more, each read from RedJack.exe:
- `sendtoquad` finding the room of the same name first. It looks among the
  room's quads and nowhere else (0x446570, 0x446190). horn4.sett calls
  itself "horn", as it does the quad the horn stands on, so the click on the
  horn reached the set's `mousedown`, which walks on, and the horn could not
  be blown;
- `propinstance` copies the whole prop record and renames it (0x427922), so
  the copy stands where its template stands. The port copied the view and a
  few flags, and the ballista's stone, placed as "brock" and flown as
  "brock 1", flew from the world's origin. The mine carts' harpoons are
  copies too, and now carry the rest of their template's record.

## What does not work yet

- **Ambient sounds run out.** From day four on the log reports
  `makecricket: table full (16)`: the ambient loops never seem to be freed, so
  later rooms lose theirs, as the lock's water does. Not yet read from the exe.
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
