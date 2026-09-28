# Lunicus

*Lunicus* (1994) is CyberFlix's first game, and the oldest in this repository.
You are one of the crew of Lunicus, a station on the Moon, and the game is six
days of it: briefed on the station each morning, sent down by its transporter
to fight an alien hive in three cities in turn, then into the station's own
engine rooms, and at last aboard the hive, where its queen waits.

It is also the first DreamFactory game. Its files are the engine's containers,
but none of them carries a version tag, so this port calls the generation
**DreamFactory 0** and reads it with its own `-v0` readers
([DreamFactory 0's containers](../engine/formats/dreamfactory-0.md)). There are
no scripts: the game's logic is all in `LUNICUS.EXE`.

It runs on port 5180 with `npm run dev -w lunicus`, and it has a door on the
site's front page. The whole game plays: the station and its
crew, the three cities, the engine rooms and the hive, to the queen and back to
the title. The machine suites play it through from the intro to the end
([Machine suites](#machine-suites)), and a browser suite replays that run on
the page ([The playthrough in a browser](#the-playthrough-in-a-browser)).

## What was found

Every data file on the disc opens with the DreamFactory container's envelope
(`0x00010000`), which LUNICUS.EXE checks at `0x419807` ("bad star file
version"). Unlike every later game, container 0 carries no version, so nothing
in a file says which generation it is. A caller routes by game instead.

| | |
|---|---|
| films | 114 `.mov` files |
| mazes | 12: the station's two floors, the city and the building of days two to four, the two engine rooms, the hive and the final chamber |
| conversations | 69 talk files, a crew member's per day's progress (`sasha.1` … `sasha.3`) |
| sound banks | 6: the station's, and one for each place of the combat days |
| the executable | `lunicus/lunicus.exe`, 206,336 bytes |
| screen | 512×384, the view 384×264 above the panel |

(Measured with `find` over the rip in `lunicus/gamefiles/LUNICUS/`, not counted by hand.)

Every format kept its shape into DreamFactory 1 and later, and each changed in
some way. The frame codec can copy from its own compressed stream, the sounds
have no header, and a maze is a grid of cells joined by short films that its
transitions share. [DreamFactory 0's
containers](../engine/formats/dreamfactory-0.md) has them all, with the save
file at the end.

## LUNICUS.EXE is the truth

As with [Skull Cracker](../skullcracker/) and [RedJack](../redjack/), every
behaviour here was settled by disassembling the game's executable, and the
code cites its addresses (`0x406240`, `0x4018db`…) beside what it ported.
[`lunicus/tools/ludis.mts`](https://github.com/dhobi/dreamrefactory/blob/master/lunicus/tools/ludis.mts)
does the reading, and prints the names of the imports and the strings an
instruction uses:

```sh
npx tsx lunicus/tools/ludis.mts func 0x4018db     # the whole function an address is in
npx tsx lunicus/tools/ludis.mts callers 0x41771d  # who calls it
npx tsx lunicus/tools/ludis.mts str "tohive.move" # code that uses a string
npx tsx lunicus/tools/ludis.mts find 0x42d1c8     # every instruction that names an address
```

The game is a tick machine. `lunicus/src/game/` runs it as generators, one
yield a sixtieth of a second, as `_portgetime` counts time. The page drives it
at 60 ticks a second, and the tests drive it as fast as the CPU goes. What each
level does is one handler behind the level dispatcher (`0x40ad60`): the title,
the station's two floors, and one mode for all the combat levels (`0x406240`),
from the cities to the hive.

## The six days

Each day starts on the station's lower floor. The briefing at the transporter
end sets the day's progress (`[0x42d1c8]`), and the talks change with it.
Then the day's work, and the bed ends it. To play it step by step, see [the
walkthrough](walkthrough.md).

| Day | Where | Against | How it ends |
|---|---|---|---|
| 1 | The station: both floors, the crew, the briefing | nobody | The bed, once briefed |
| 2 | Los Angeles: a building's fifth floor, down to the street | tanks, jeeps and wasps, then the node | The node destroyed (`cityrise.move`), and the bed |
| 3 | Tokyo | the same and a drone, a flying bomb | The same |
| 4 | Moscow | the same and two drones, with the pulse gun | The same |
| 5 | The engine rooms, through the lower floor's elevator | three drones and the rest, in two rooms | The ENEMIES bar empty, and down to the hive (`tohive.move`) |
| 6 | The hive, then the final chamber | four drones and the rest | The queen (`finalin`, `trans`, her talk, `final.move`), and the title again |

The combat is ported whole from LUNICUS.EXE: the tank and the jeep (one piece
of code with two sets of numbers), the wasp and the node that takes its place
once the city's ENEMIES bar is empty, the drones, and the player's gun,
grenades and rockets. The difficulty table (`0x417f1b`) is Intermediate unless
a save says otherwise, scaled by the day. Day six halves the gun and the
grenades and not the rockets.

## Machine suites

Lunicus is tested the way RedJack and Skull Cracker are: the game machine runs
in node on the rip, with no page and no clock, and each suite steps it as fast
as the CPU goes, waiting on the game's state and never on a duration.

    npm test -w lunicus                          every suite
    npx tsx tools/runmachine.mts day3            just these (from lunicus/)

- [`tests/machine/harness.ts`](https://github.com/dhobi/dreamrefactory/blob/master/lunicus/tests/machine/harness.ts)
  walks the station by the maze's own transitions, clicks a crew member's
  figure where the camera draws it, answers a talk's menus, and clicks through
  a film that waits. Every gesture goes through
  [`src/game/input.ts`](https://github.com/dhobi/dreamrefactory/blob/master/lunicus/src/game/input.ts),
  the door the page's own mouse and keyboard use.
- [`tests/machine/city-bot.ts`](https://github.com/dhobi/dreamrefactory/blob/master/lunicus/tests/machine/city-bot.ts)
  plays the combat levels as a player does. It aims what the screen shows,
  from the distance and the height a shot has to climb, and turns to what lines
  up with it. It lobs grenades at a flyer too high for the gun, goes round a
  vehicle parked in its road, and restocks from the cabinets and the elevators
  when it runs low.
- `day1` to `day6` play the game from the intro, each day continuing the one
  before, so `day6` is the whole game. The route of each day is in `days/`,
  and one route serves days two to four, the city days.
- `saveload` saves on the panel's button and opens the file back, and plays on
  from the opened game; see [Saved games](#saved-games).
- `menu` gives the menu bar's commands on the title and in a game; see
  [The menu bar](#the-menu-bar).

The roll is seeded, so a run is the same run every time. The bot is not
certain to win, though. The route wins on seed 1994, which the suites use, and
on about two thirds of the seeds tried. The hive and the final chamber are
where it loses.

Playing it through this way found a good deal in the EXE:
- **The hive and the final chamber.** An emptied cabinet stays empty on the
  next floor, because a level opened again from itself keeps its maze
  (`0x4068b5`).
- **The cell writer.** It writes into a cell that is not there (`0x40367a`),
  which is how the final chamber opens the ring of cells round the queen.
- **The shake does not move the picture** (`0x40739c`). A light one paints the
  view's top rows black for a frame, and a heavy one drops the frame.
- **The film player's tracked buttons.** A hotspot of type −1 is a button,
  and the elevators' floors are two of them.
- **The ENTERING message** shows only when the level before was not a combat
  level (`0x40a4b2`).

## The playthrough in a browser

The machine run can be replayed on the real page, tick for tick.
[`tests/browser/playthrough.ts`](https://github.com/dhobi/dreamrefactory/blob/master/lunicus/tests/browser/playthrough.ts)
plays the route headless first and keeps every gesture, with the tick it came
before, and a checkpoint at each of the route's checks.

    npm run dev -w lunicus                       (port 5180)
    npm run test:browser -w lunicus              Chromium, headless, about ten minutes

It opens the page with `?drive&seed=`. The page then ticks only when told, on
the run's seed, and every file the run read is fetched before the first tick.
Each gesture goes in as a real Playwright mouse or key event on the canvas, at
its tick. Since the machine is deterministic, the page plays the same game. At
each checkpoint the suite compares the page's level, progress and score with
the run's, and the first that differs fails, naming the tick. Screenshots land
in `out/lunicus/playthrough/`.

To watch the same run with the sound on, open the page on the dev server with
`?replay=/replays/playthrough.json&seed=1994&pace=4` and press Enter. It plays
the last recording on its own clock, and `[` and `]` halve and double the pace.

## Saved games

The panel's floppy button saves, and the page's **Load** button is File ▸ Open.
The file is the EXE's own `.LUN`: 26 bytes holding the level, the day's
progress and the HUD, and nothing about the suit, the gun or the cabinets
([Saved games](../engine/formats/dreamfactory-0.md#saved-games)). A load
applies the file as File ▸ Open does (`0x4184cc`), from the title or in the
middle of a level. The page keeps the files in the browser, in the same
saved-games dialog as RedJack's, and can download and upload them.

**Five saves, one a day, made by the port.** No save written by the original is
available. `SAVES=gamefiles/save npx tsx tests/machine/day6.ts` (from
`lunicus/`) writes `day2.lun` … `day6.lun` at the start of each day, and the page
lists them under *Days two to six (made by this port)*.
[`tests/browser/saves.ts`](https://github.com/dhobi/dreamrefactory/blob/master/lunicus/tests/browser/saves.ts)
opens one on the page, saves through the dialog, and opens the saved file again.

## The menu bar

The window's menu bar is LUNIRES.DLL's resource `MENUS`, which LUNICUS.EXE
loads at `0x4186db`: File, Edit, Settings, Sound and Help.
[`tools/menu.ts`](https://github.com/dhobi/dreamrefactory/blob/master/lunicus/tools/menu.ts)
writes it out as `src/menu.gen.ts`, and the page draws it with the engine's
[`window-bar.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/window-bar.ts),
on the picture's frame.

**It is up on the title and nowhere else.** The EXE takes it off the window for
the intro, for Help and About, and for the whole of a game (`0x418701`). In a
game only its accelerators reach the game, the QUICKEYS table in the same DLL.

WM_COMMAND (`0x40b80a`) turns an id into a Macintosh menu and item: the
hundreds are the menu, and 600 and up is menu 1, Help. The title's handler
(`0x418446`) takes every command; a level's (`0x417412`) takes only Save, Exit,
Keys, Cache Mazes, Sound and Help.

| Command | What it does |
|---|---|
| File ▸ New | a new game (`0x4184ec`), as a click on the title is |
| File ▸ Open | the saved-games dialog, then the file's game (`0x4184cc`) |
| File ▸ Save | in a game, the panel's save button (`0x4175c3`); grey on the title |
| File ▸ Exit | on the title the EXE quits, and the page goes to the front door; in a game it ends the game with no question asked, the title again (`0x41745e`) |
| Edit | grey in the resource; nothing handles it |
| Settings ▸ Beginner … Expert | the difficulty a new game opens with (`0x41784b`), on the title only; Intermediate to start |
| Settings ▸ Keys | the keys dialog (`dlog3`, `0x418b50`), on the title or, by Ctrl+K, in a game; see [Keys and high scores](#keys-and-high-scores) |
| Settings ▸ Cache Mazes | a mark that follows the setting; the EXE copied the mazes to the hard disk, and a page has nowhere to copy them |
| Sound ▸ Sound Off … Level 7 | the device's volume, level × 1/7 (`0x4209a8`); 7 to start, where the EXE reads the device's own |
| Sound ▸ Theme | the ambience on or off (`0x4178e8`) |
| Help ▸ About Lunicus | `about.move` over the title (`0x417760`); its credits go round until Esc |
| Help ▸ Help | `help.move`, on the title, or in a game as the help button |

The accelerators keep the DLL's one slip. The Sound Level 6 entry has no Ctrl
flag, so the plain 6 key sets level 6 anywhere, and Ctrl+6 does nothing. A
browser keeps Ctrl+N, Ctrl+T and Ctrl+W for itself, and most take Ctrl+1 to
Ctrl+8 for their tabs, so those do not reach the page. New is a click on the
title as well, and the rest are on the bar.

None of these settings last beyond the page, and they did not in the EXE either.
It kept only the keys and the high scores, in `lunicus.sco`.

## Keys and high scores

`lunicus.sco` is one 1040-byte block, which
[`src/game/sco.ts`](https://github.com/dhobi/dreamrefactory/blob/master/lunicus/src/game/sco.ts)
reads and writes:

- **The key table**, 256 bytes: one per character code, giving the action that
  character is. The actions are 1 forward, 2 left, 3 right, 4 navigate,
  5 bullets, 6 grenades and 7 rockets. The city and the base both look keys up
  in it (`0x4173ff`), so W, A and D walk in the base as well as in the city.
  The arrows are Macintosh character codes 0x1c to 0x1e, and the EXE puts them
  back as forward, left and right whatever the file says (`0x417efb`).
- **The high scores**: 4 difficulties, 7 places each, 28 bytes a place. Each
  place is an i32 score and a Pascal-string name of at most 23 characters.

The rip's file holds the EXE's defaults. The page keeps its own copy in the
browser's `localStorage`, under `lunicus.sco`, in the same layout. It writes the
copy as soon as the block changes, where the EXE wrote the file only as its
window closed (`0x417ce4`). A page is not told when it closes. A driven or
replayed run uses the defaults and asks nothing, so that it stays the machine
run it replays.

**The title's plate.** The band under the title's picture is picture 1 of
`puppet.`, the Cyberflix plate, which the EXE loads as the title opens
(`0x417039`). The current difficulty's seven places are drawn on its blank half
(`0x417b01`). The font is LUNIRES.DLL's 0x3a16, which the DLL maps to Raven
Digital (`0x401d8b`), and the pen is palette index 0, which is white. Changing
the difficulty redraws the places.

**A high score.** When the title opens again after a game (`0x41733d`), a score
above the seventh place asks for a name in the High Score dialog (`dlog2`). OK
with an empty name counts as Cancel, as it does at `0x418af9`. The name takes
the seventh place, and the places are sorted best first (`0x417a44`), so a tie
stays below the older score.

**Settings ▸ Keys** is the Edit Keys dialog (`dlog3`, `0x418b72`). It has seven
one-letter fields, each showing the letter (or digit) its action has now. OK
binds each field's first character, in both cases for a letter (`0x418db1`).
Default puts the EXE's own keys back in the fields, and Cancel keeps the table
as it was. In a game the level waits and the sound stops while the dialog is up.

Both dialogs are LUNIRES.DLL's own templates.
[`tools/dialogs.ts`](https://github.com/dhobi/dreamrefactory/blob/master/lunicus/tools/dialogs.ts)
writes them out as `src/dialogs.gen.ts`, and the engine's
[`window-dialog.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/window-dialog.ts)
draws them on the picture's frame, every control where the template put it.
Neither procedure handles IDCANCEL, so Esc closes neither of them, as in the EXE.
The DLL has five more dialogs (Message, Quit, Pause, Sound, Progress), and no
code in the EXE opens any of them.

## The page

The title card is `lunicus/assets/lunicus-full.png`. It came as a flat RGB
render with a transparency checkerboard painted into it, as RedJack's did;
[`mklunicuslogo.ts`](https://github.com/dhobi/dreamrefactory/blob/master/lunicus/tools/mklunicuslogo.ts)
keys it out with RedJack's key, which also finds the squares the letters close
in (`npm run mklogo -w lunicus`). The palette in
[`src/theme.css`](https://github.com/dhobi/dreamrefactory/blob/master/lunicus/src/theme.css)
is sampled from the keyed card: the crew's navy for the ground, chrome for
text, the letters' gold bevel for edges and links, and fire for what is live.
The favicon, `public/lunicus-mark.svg`, is the card's chrome L. The home-screen
icons are rendered from it by `npx tsx tools/mkappicons.ts lunicus`.

## What does not work yet

- **The bot's odds.** The route wins on the seed the suites use, not on every
  seed. See [Machine suites](#machine-suites).

Back to [Documentation](../README.md).
