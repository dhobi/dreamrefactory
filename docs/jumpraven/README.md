# Jump Raven

*Jump Raven* (1994) is CyberFlix's second game, a year after Lunicus and on the
same engine. New York is under water and overrun. You fly a Raven, a
hovercraft, through the drowned city with a copilot of your choosing, for three
days: each day briefed by your commander, then out to shoot what carries the
day's pods, pick the pods up, and kill the boss they call down. At the end your
copilot has an ending of their own.

Like [Lunicus](../lunicus/), it is **DreamFactory 0**: the files are the
engine's containers with no version tag, read with the `-v0` readers
([DreamFactory 0's containers](../engine/formats/dreamfactory-0.md)), and there
are no scripts. The whole game is in `RAVEN.EXE`, and it was ported from the
disassembly.

It runs on port 5181 with `npm run dev -w jumpraven`, and it has a door on the
site's front page. The whole game plays: the opening and the high scores, each
day's briefings, the Mart, the copilots, the band, the three days' flying and
their bosses, the way back and the debrief, to the copilot's ending. The
machine suites play it from the intro to the end twice over, once with the game
set up and once by a player that wins it with no shortcuts
([Machine suites](#machine-suites)), and the page can play itself
([Autoplay](#autoplay)).

## What was found

| | |
|---|---|
| films | 125 `.mov` files |
| conversations | 35 `.pup` talk files (the briefings, the debrief) |
| heads | 12 `.mup` files: the comms box's faces, the six copilots and the voices on the radio |
| the executable | `RAVEN/RAVEN.EXE`, 266,752 bytes, dated 14 June 1994 |
| screen | 512×384, the view in the middle of the panels |

(Measured with `find` over the rip in `jumpraven/gamefiles/RAVEN/`, not counted by hand.)

`RAVEN.EXE` is a month OLDER than `LUNICUS.EXE`, though Lunicus shipped first,
and most of the engine in it is the same code. So the runtime the two share —
the machine, the screen, the font, the film player and the talks — was lifted
out of `lunicus/` into `engine/src/v0/`, and each game keeps only what is its
own. The formats needed two things more: a sound bank's block count can be big-
endian (`blocksV0`), and a flight's city is a maze of words that wraps round
(`solidV0`, `wordCellV0`).

## RAVEN.EXE is the truth

As with Lunicus, every behaviour here was settled by disassembling the
executable, and the code cites its addresses (`0x40b190`, `0x4218a8`…) beside
what it ported.
[`jumpraven/tools/rvdis.mts`](https://github.com/dhobi/dreamrefactory/blob/master/jumpraven/tools/rvdis.mts)
does the reading, modelled on Lunicus's `ludis.mts`, and
[`match.mts`](https://github.com/dhobi/dreamrefactory/blob/master/jumpraven/tools/match.mts)
pairs each function with its twin in `LUNICUS.EXE`, so what one port learned
can be looked up in the other:

```sh
npx tsx jumpraven/tools/rvdis.mts func 0x40b190     # the whole function an address is in
npx tsx jumpraven/tools/rvdis.mts callers 0x428536  # who calls it
npx tsx jumpraven/tools/rvdis.mts sum 0x4134db      # its callees, strings and globals, with their Lunicus pairs
npx tsx jumpraven/tools/rvdis.mts str "Flat.c"      # code that uses a string
```

The game is a tick machine, as Lunicus's is: `jumpraven/src/game/` runs it as
generators, one yield a sixtieth of a second, the page drives it at 60 ticks a
second and the tests as fast as the CPU goes. The level dispatcher (`0x40e911`)
has three kinds of level: the story (the even levels, `0x426124`), the high
scores screen (level 1, `0x420840`) and the flying (3, 5 and 7, `0x40b190`).

## The three days

A run with nothing to open starts at level 0: the intro, the first briefing and
the tutorial, then the high scores screen, where PLAY is a new game. Each day's
story is the same run of steps (`0x426124`):

| Step | What it is |
|---|---|
| `bat1.pupp` | the commander's briefing |
| `enem.move` | the enemies you will meet |
| `bat2.pupp`, then the Mart | weapons bought, upgraded, refilled and traded in (`0x410540`) |
| `bat3.pupp`, then the copilots | one of six — Lark, Cheese, Chablis, Dogstar, Nikki and Thrash — chosen from their interviews (`0x418878`) |
| `bat4.pupp`, then the music | the band that plays in the flight (`0x414bfc`) |
| `bat5.pupp`, `trans.move` | and out to the city |

The flight (`0x40b190`, [`src/game/combat/`](https://github.com/dhobi/dreamrefactory/tree/master/jumpraven/src/game/combat))
is the city as a maze of cells, 4 by 4 and wrapping round its blocks, flown in
eight-frame moves, FLY or HOVER (T). Jeeps, bikes, tanks and helicopters come
in; one in eight of them carries a pod, which it drops when killed, as long as
fewer than two wrecks lie about (`0x40cc37`). The PODS bar counts down as the pods are drawn in: 29 pods
on Intermediate. When it is empty `pods.move` plays, a beacon calls the boss
down, and the boss killed and the craft landed on the beacon is the next level.
Along the way are the fuel tanker, which sells fuel by the point, the repair bay
(`0x41f990`), which mends a system the enemies knocked out, and the weapons
ship, which opens the Mart mid-flight.

The copilot (`0x404d26`) takes three buttons on the HUD: NAVIGATION flies,
HOVER CONTROL slides and climbs, ARMS CONTROL fires. A craft lost costs a life
and the weapons' upgrades: the new one comes with its bars and ammunition full,
but every weapon back at its first tier (`0x40b469`). A game starts with four
lives, and nothing gives one back. The way back (levels 4, 6 and 8) is the drop, the damage screen and the
debrief (60% accuracy or better is `bata.pupp` and its LEVEL BONUS). After day
three the copilot's own ending, `trans<n>.move`, and the high scores.

## Machine suites

Jump Raven is tested as Lunicus is: the game machine runs in node on the rip,
with no page and no clock, and each suite waits on the game's state, never on a
duration. Every gesture goes through
[`src/game/input.ts`](https://github.com/dhobi/dreamrefactory/blob/master/jumpraven/src/game/input.ts),
the door the page's own mouse and keys use.

    npm test -w jumpraven                        every suite
    npm test -w jumpraven -- fairgame            just one

- `opening`, `back` and `flight` — the intro to the high scores, the way back
  from a flight, and the city's moves.
- `combat` — the enemies firing at a craft sitting still, and a jeep shot.
- `day1` to `day3` — each day's flight to its end, flown by the copilot with
  its three buttons on. Two shortcuts keep them short (PODS one pod from empty,
  the boss weak); what they cut is more of the same code, not other code.
- `wholegame` — the intro, three days and the ending, chained.
- `fairgame` — the whole game WON with nothing set: see below.
- `menu`, `saves` and `films` — the menu bar and its dialogs, the `.RVN`
  saves, and a film's sounds.

### The fair player

[`src/player.ts`](https://github.com/dhobi/dreamrefactory/blob/master/jumpraven/src/player.ts)
plays as a person would: it shops (the empty weapons first, then upgrades, then
refills), chooses its copilots, mends at the repair bay and keeps the copilot's
three buttons on — all but NAVIGATION with the last pod left, until the shields
are up. It does not win every game. It won 8 of 32 seeds when measured
(2026-09-29), so `fairgame` plays seed 7, which it wins. The lines it prints say
where the lives went, so a seed that stops winning after a change can be told
from a change that broke something.

What playing it through found:
- **Only three copilots win a day.** Copilots 1, 4 and 2 (Cheese, Nikki,
  Chablis) do; the other three never did in any seed tried.
- **Lives never refill**, so the game is won or lost on how few crafts a day
  costs — about 1.7 a day for the player. A lost craft zeroes the HUD, so the
  copilot's buttons go off and have to be pressed again.
- **The boss resets on each life**, at 18,000 strength.
- **A click does not fire while ARMS is on.**

## Autoplay

`?autoplay` puts the same player on the page, and the ▶ Autoplay button under
the picture turns it on at four times the speed. `?autoplay=<seed>` plays a
given seed and `&speed=` goes from 1 to 32; press Enter once, as the page needs
a gesture for its sound.

## Saved games

The HUD's SAVE writes a `.RVN` file, 0x94 bytes with no header (`0x4218a8`):
the difficulty, the level, the copilot, the band, the score, the weapons, the
bars, the lives and the tally. File ▸ Open reads it back (`0x421487`,
`0x421199`), each field through the clamp the EXE adds it with. A save opened
before the run starts there, with no intro (`0x422489`); on the high scores
screen File ▸ Open is the page's Load button. Both go through the shared
saved-games dialog. Pinned by `tests/machine/saves.ts`.

## The menu bar

The game window's bar and its dialogs, read from `RAVENRES.DLL`
(`jumpraven/tools/menu.ts`, `dialogs.ts`). It is up on the high scores screen
only (`0x422558`); in a flight the HUD's buttons are the menu (`0x421094`):
SAVE, SOUND, KEYS, PAUSE, HELP and QUIT. The high scores are `RAVEN.SCO`, kept
in `localStorage`.

## The page

The page wears its own palette, sampled from the title card
(`jumpraven/src/theme.css`): the raven's blue-black wings for the ground, its
chrome head for the words, the bronze rim round the letters' band for the edges,
the letters' red for the Enter button alone, and the sunset for what is live.
The logo was keyed off its white ground by `jumpraven/tools/mkjumpravenlogo.ts`.
On a phone a double tap is Esc and a swipe an arrow.

## Sound

A film's sounds go on channels 1 and 2, and a new one takes the channel from the
one before it (`0x428536`), so a film's second voice speaks in the first's
place, not over it. The flight's **theme tune** is the band chosen at the
briefing: its bank (`hiphop`, `tek`, `grunge` or `metal` in each day's folder)
holds sixty sounds and a set of music pieces with the order to string them in,
and the string plays round and round on channel 3 (`0x422ef6`, `0x4233ba`). The
Sound dialog's Theme turns it on and off; the HUD's buttons silence it for their
action and start it again after (`0x4210b4`, `0x421176`); the flight's end stops
it (`0x4231da`). It is Lunicus's ambience, the same code, now in
`engine/src/v0/machine.ts` for both.

On a quiet tick in flight the pilot talks (`0x413cfd` …): the opener, what the
copilot has taken over, the enemy breaking in over the radio, the shields, the
wreckage, and what the beacon marks ahead. `combat` pins it.

## Faithful, though it looks wrong

- **The last three frames of `shared/miss2.mov`**, the Hawk missile turning in
  the Mart, come out rough for a moment each time round its loop. The frames'
  rows run past their width, and the next rows start with bytes that are none of
  the eighteen row modes, which DreamFactory 0's decoder (`0x409557`) skips
  without drawing. A port of that loop instruction by instruction reads the
  bytes the same way the engine's decoder does, so the original drew the
  same, and the loop's third frame is whole again after them. `films` checks
  every frame of every film decodes.
- **The radar is white.** `0x41885f` clears it to palette index 0 and draws the
  marks on it, and index 0 is white in the flight's palette: the marks are red,
  green and pure blue, which read on white and not on black.
