# Timelapse: Ancient Civilizations

**GTE Interactive Media**, 1996, on **DreamFactory 4** — the same engine
generation as *Titanic*, shipped a few months later, and the last one there was.

It is the one game in this project CyberFlix did not make. They wrote the engine
and licensed it; this is somebody else's adventure built on it, although the rest
of these pages say "the DreamFactory games" as though that were one studio's
shelf.

Four CDs, one language, and **not one `.SET` file on any of them**. That absence
is why the game has its own section: everything the other two do with a room — a
standpoint, a turn ring, a hotspot, a road to walk down — this game does with a
**stage flat** and a script table, so it needs a compositor that does not belong
to a room.

## What it is, in one paragraph

You travel to Easter Island, Atlantis, a Maya city and a moon base, through
somebody else's teleport network, always one step behind the archaeologist who
built it. It is a first-person adventure of pre-rendered stills with films
between them, and it navigates almost entirely by the **shape of the mouse
cursor**: the picture has no visible affordances, and the arrow that appears
under your hand is the whole interface.

That last part is measured. **11,031 of the game's 13,200
`cursor(...)` calls** are `godown` and `goup` — *you can back up from here*, *you
can step forward here* — and **27,179 of its 29,105 clickable regions** are named
`up`, `down`, `left` or `right`, across 7,967 flats. Both step arrows were
**redrawn** for this game: the same resource names in *Titanic*'s executable are
plain arrows, and Timelapse's stand on a foot. This is therefore the one game in
the project whose port carries the original 32×32 cursor art rather than
mapping it onto CSS keywords — see
[`engine/src/web/cursors.ts`](../engine/architecture.md) and
[`tools/dumpcursors.ts`](../reference/tools.md).

## What runs today

The page boots off the four discs through the same `GameHost` the other two use:

- **the boot**, out of the game's own `BOOTFILE` — which is not on a disc at all
  but in the installer's tree, with half the game beside it (below);
- **the opening**, `open.mov` — seven segments and 51 seconds of scored film,
  played as a modal movie by `enterworld("I")` before the first room exists;
- **the world**, walked with the six directions each stage's own table offers,
  the four edge regions, and the cursor that says which of them are there;
- **the interface panel** — `P.Stg`, the journal and the camera, opened by the
  space bar the way `interfacekey(" ")` does;
- **the camera**, with its photo album in IndexedDB — the one thing this engine
  produces that the *player* made, and the one thing the original also kept
  outside a saved game ([`photos-idb.ts`](../engine/architecture.md));
- **the x-ray light**, a `plugin("xray")` aperture dragged over a flat to reveal
  a second flat through the light's own shape.

The whole game plays through, which the machine suites check (below). Saved games are not wired up yet. Nor is `actorhitbox`, which the v1 corpus asks
for 32 times and this one never does.

## Four things that are only true here

**The rooms are stage flats.** There is no scene and no view: a position is a
world letter, a stage, a region and a **frame**, and the frame is the standpoint
and the facing at once — turning left changes it exactly as walking does. Where
each direction leads is a six-word string in the stage's own container 1
(`getframeaction`), one word per direction, whose verbs are `J` jump to a frame,
`TL`/`TR` turn to one, `G` cross to another region, `S` to another stage, and `X`
for *the game does not offer that from here*. A refused key is the commonest
thing to mistake for a broken one, so the port's page prints the whole table.

**The screen is 640×480.** 512×384 is the DreamFactory 4 *default*, not the law,
and every one of this game's stage headers says otherwise. The framebuffer is
therefore not a constant: a fixed 512×384 leaves a fifth of every picture off the
right and bottom edges.

**Half the game is in the installer's tree.** `TLAPSE1/install/data/` holds
fourteen files and 43 MB the 1996 installer copied to the hard disc rather than
playing off the CD: the `BOOTFILE`, six shop files, five track banks, the shared
panel stage, and the camera. The port's manifest walker deliberately skips any
directory called `install` — *Titanic*'s installer tree is not game data and one
of its subtrees ships a rival `bootfile` — so these fourteen are named
explicitly rather than the rule being relaxed.

**One letter per world, and it is the same letter everywhere.** `curworldchar` is
the entire naming scheme, one character standing for four things at once:

| letter | disc directory | shop | stages |
|---|---|---|---|
| I | `TLAPSE1/i/` | `I.Shp` | `i001.stg` … |
| E | `TLAPSE1/e/` | `E.Shp` | `e001.stg` … |
| A | `TLAPSE2/a/` | `A.Shp` | `a001.stg` … |
| M | `TLAPSE3/m/` | `M.Shp` | `m001.stg` … |
| Z | `TLAPSE4/z/` | `Z.Shp` | `z001.stg` … |

`P` is the shared panel — six props and a stage, no directory and no world — and
`T` is the transition films, byte-identical on all four discs. Every name the
game opens is *built* from that letter (`openshopfile(curworldchar @ ".Shp")`,
`curworldchar @ threezeronum(n) @ ".Stg"`), which has a consequence the loader
has to live with: no string literal in the scripts says `i001.stg`, so nothing
that walks the scripts looking for filenames can find the first stage. The
BOOTFILE's own plan names seven resources; the six names of world I are written
down in the port instead, and the page says so in its boot log.

## Machine suites

The whole game is played through headless, from `open.mov` to the last
question it asks, the way RedJack's and Lunicus's are: the real `GameHost` on
the four discs, stepped as fast as the CPU goes, waiting on the game's own
globals and never on a duration.

    npm test -w timelapse                        every suite
    npm test -w timelapse -- maya                just this one

One suite per world, each continuing from the one before, so `atlantis` is the
whole game: `easter` (the camera, the lantern, the six masks, the time gate),
`egypt`, `maya`, `anasazi` and `atlantis` (the robot trapped, the gene pods on
the transmission panel, and the escape that leaves Atlantis to launch without
you). The routes are in `tests/machine/worlds/`, one file a world.

`stages` is the rest of the map, which no route reaches: every stage's
`getframeaction` table and every hotspot that moves you, read off the four
discs without a game tick, each way out of each frame landing on a frame that
exists. Five do not, and are listed in the suite with the script line that
says so: two words in a035's second `case 100`/`case 102`, which the switch
never reaches, and three of the game's own — i004 frame 604's left and right
(`J.363`, `J.463`, frames no Indus stage has) and i006 frame 958's forward
with the lantern unlit (`J.862`, which is i005's).

- **A route names the frame it wants.**
  [`nav.ts`](https://github.com/dhobi/dreamrefactory/blob/master/timelapse/tests/machine/nav.ts)
  reads every stage's `getframeaction` table off the disc and finds the keys by
  a shortest path, pressed one at a time as a player presses them. It adds the
  hotspots whose scripts move you (`jumptoframe`, `gotostage`), takes a way the
  table computes at run time once the game has answered it, and leaves a
  close-up by its `down` region.
- **A puzzle is solved from its own script, not from a walkthrough.** The
  crystals, the calendar's gears, the skeleton's joints, the skull pyramid's
  ring of lights, the Sun temple's stones, the wheels of red and green: each
  answer is read out of the handler that checks it, and where the script only
  gives the rules (the geared calendar, the pyramid, the stones, the wheels) the
  route searches for the moves.
- **The action is aimed, not tried.** The arrow through the spire and the
  energy ball at the robot are flown in the route with the formulas of
  `arrowflight` and `FireBall`, for the wind or the robot as they are at that
  moment, and let go when the flight hits. The spider maze is searched pixel by
  pixel over the hit test, with the holes as jumps and the red spiders' beats
  priced dear.
- **`tests/machine/probe.ts`** plays any of the route's steps and then moves by
  hand, printing each flat's scripts with `SRC=1`: how a route is written.
  `tools/flats.mts` and `tools/props.mts` index the stages' flats and the shops'
  props against the decompiled scripts.

The roll is seeded (`SEED`, 19961031), so a run is the same run every time.

Playing it through found these in the engine, each fixed:

- **The last region wins** where two overlap (TI.EXE `0x44703b` walks a flat's
  table backwards): the time gate's buttons lay inside its `down` region.
- **A prop no script places is anchored at (0, 0)** here, not at the middle of
  the screen: Timelapse's props store where they stand.
- **A click made while a loop runs is replayed** when there is no room to do it.
- **A film's first segment with more after it plays out** instead of waiting
  for a click (`E020.Mov` after the red gem).
- **`closeshopfile` finds a shop by its stem or its ref name**, as it already
  did for DreamFactory 5: the snakes game's props stayed on the screen.
- **`propxy (name, 3)` answers the point**, not x alone: the red spiders never
  turned, and the Sun temple's stones shuffled off the board.
- **A key is a tracked script**, as a click is (not in DreamFactory 5): a loop
  fired into a step's transition and broke the gold heart's cooling.
- **A script's own loops fire in its `forceupdate`** unless that would re-enter
  one: the match could not light the Anasazi's fire while held.
- **`pointinprop` tests the frame the prop shows, and its pixels** (TI.EXE
  `0x417120`): the tablets' 45 glyphs are one group told apart by degree.
- **`plugin ("scrollflat")` turns**: Atlantis calls `lefttoframe` directly.
- **The BOOTFILE's `idle ()` runs** each pass for a game with no room: it
  walks the robot, and `EndTimer` plays every ending.
- **A container with no statement is no script**, and logs no parse error.

## The page

`npm run dev -w timelapse`, port 5177. It is a game page rather than a report —
a title card, a gauge that measures real bytes, and the picture in a moulding
taken off the title card's own letters — but the **boot log is still the
deliverable** when something goes wrong on a rip this project is still finding
out, so it is a panel over the picture that `b` opens, and an error opens it by
itself.

Two numbers explain the loading page. The boot moves **69.9 MB before the first
frame**, and 52 MB of that is two files — `i001.stg`, which is a stage and all
283 flats in it, and `open.mov`. Both are fetched *in front of* the Enter button
rather than behind it, because `open.mov` is what plays the instant the boot ends
and a stall there lands exactly where the game's opening starts. The button is
also the gesture a browser wants before it will make a sound; a boot started on
load would play that scored film to a page nobody had clicked.

## The engine pages that carry Timelapse's half

Most of what this game taught the port is about the *engine*, so it is written up
there rather than here:

| | |
|---|---|
| [The browser host](../engine/runtime/host.md) | the screen with no room on it, which is what lets a `.SET`-less game composite, fade and play films at all |
| [Stage & UI — flats & overlays](../engine/runtime/stage-ui.md) | flats, and animation by walking a **run** of them (`flatstartanim`, 433 times across these discs and never once in the other two games) |
| [Timing — heartbeat, loops & crickets](../engine/runtime/timing.md) | why a loop that comes due mid-drag has to fire on `forceupdate()` — the worked example is this game's match, struck and audible with no flame |
| [The scripting language](../engine/scripting-language.md) | the six opcodes a third rip asked for that an engine recovered from two did not have |
| [Engine architecture](../engine/architecture.md) | where the cursor sheet, the photo store and the screen contract live |
| [Tests](../reference/tests.md) | what is actually checked, including the cursors this game navigates by |
