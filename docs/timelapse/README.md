# Timelapse: Ancient Civilizations

**GTE Interactive Media**, 1996, on **DreamFactory 4** — the same engine
generation as *Titanic*, shipped a few months later, and the last one there was.

It is the one game in this project CyberFlix did not make. They wrote the engine
and licensed it; this is somebody else's adventure built on it, which is worth
saying at the top because everything else on these pages says "the DreamFactory
games" as though that were one studio's shelf.

Four CDs, one language, and **not one `.SET` file on any of them**. That single
absence is what makes this game worth a section: everything the other two do with
a room — a standpoint, a turn ring, a hotspot, a road to walk down — this game
does with a **stage flat** and a script table, and for a long time the port could
not draw it at all because its compositor belonged to a room.

## What it is, in one paragraph

You travel to Easter Island, Atlantis, a Maya city and a moon base, through
somebody else's teleport network, always one step behind the archaeologist who
built it. It is a first-person adventure of pre-rendered stills with films
between them, and it navigates almost entirely by the **shape of the mouse
cursor**: the picture has no visible affordances, and the arrow that appears
under your hand is the whole interface.

That last part is measured, not impressionistic. **11,031 of the game's 13,200
`cursor(...)` calls** are `godown` and `goup` — *you can back up from here*, *you
can step forward here* — and **27,179 of its 29,105 clickable regions** are named
`up`, `down`, `left` or `right`, across 7,967 flats. Both step arrows were
**redrawn** for this game: the same resource names in *Titanic*'s executable are
plain arrows, and Timelapse's stand on a foot. Which is why this is the one game
in the project whose port carries the original 32×32 cursor art rather than
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

Saved games are not wired up yet. Nor is `actorhitbox`, which the v1 corpus asks
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
and every one of this game's stage headers says otherwise. The framebuffer used
to be a constant; a fifth of every picture was off the right and bottom edges
until it was not.

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

## The page

`npm run dev -w timelapse`, port 5177. It is a game page rather than a report now —
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
also what a browser wants before it will make a sound: for as long as the page
started its boot on load, that scored film played to a page nobody had clicked.

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
