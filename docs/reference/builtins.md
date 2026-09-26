# Builtin commands

*Prerequisite: [The scripting language](../engine/scripting-language.md) — what a
builtin is and how calls resolve.*

This is the inventory of every engine command the port registers — the
builtins plus the `sendto*` special forms — grouped by the modules under
[`engine/src/runtime/builtins/`](https://github.com/dhobi/dreamrefactory/tree/master/engine/src/runtime/builtins).
The [opcode table](../engine/formats/script-container.md#command-ids-the-opcode-table)
names more commands than are registered here; the gap between "named" and "implemented" is
tracked mechanically — [`tools/scancmds.mts`](tools.md) diffs the commands the
shipped scripts actually invoke against this registry and regenerates
`builtins_todo.md`.

Three registry-wide rules:

- **Registration throws on duplicates** — every name is registered exactly
  once across the folder, so a wrong implementation can't silently shadow a
  right one.
- **Arity decides getter vs setter**: `propview(me)` reads, `propview(me,
  "x")` writes. This pattern repeats across most property families.
- Per-command semantics were recovered from `TI.EXE` one command at a time;
  the source files carry a doc comment per command with the evidence — this
  page lists *what exists*, the code documents *why it behaves that way*.

## Language core — `core.ts`

Pure functions over values, no game state:

`random`, `sqrt`, `stringtonum`, `substring`, `true`, `false`

One trap: **`substring(haystack, needle)` is a 1-based *find*** returning −1
when absent — not a slice. (ENIGMA maps letters to key angles with
`substring("abcdefghijklmnopqrstuvwxyz ", arg) - 1`, which only works
1-based.)

## Dispatch — `dispatch.ts`

Plain: `cursor`, `message`. Plus the **special forms** (their last argument is
a [deferred call](../engine/scripting-language.md#talking-to-other-objects-sendto),
not evaluated locally):

`sendtoprop`, `sendtoactor`, `sendtoscene`, `sendtoset`, `sendtoshop`,
`sendtopuppet`, `sendtocast`, `sendtostage`, `sendtoflat`, `sendtoboot`,
`sendtopost`, `sendtoserver` — and their `fx` variants (`sendtopropfx`,
`sendtoactorfx`, `sendtocastfx`, `sendtoshopfx`, `sendtostagefx`,
`sendtopuppetfx`, `sendtoflatfx`, `sendtopostfx`, `sendtoserverfx`), which
resolve the same single script as their siblings.
`sendtopainting`/`sendtopaintingfx` take (scene, view, painting, call);
`sendtobutton`/`sendtobuttonfx` take (flat, button, call) — see
[Stage & UI](../engine/runtime/stage-ui.md#buttons-sendtobutton).

In a DreamFactory 5 game the targets and the chains are RedJack.exe's.
`sendtocast` finds only open casts (0x405370) and `sendtoprop` only props
(0x42b550), so a room and a cast or prop of the same name (`ship.sett` and
`ship.cast`, `cannon.sett` and the prop `cannon`) no longer take each other's
events. `sendtoquad` finds only the room's quads (0x446190), so horn4.sett,
which calls itself "horn", no longer takes its horn quad's click. `sendtoshop`
also finds a shop by the name it gives itself (`jcombat.shop` is "combat"). The scene, set, actor, cast and prop chains end on the **post
script**, the BOOTFILE's library: the exe names the links as it builds them
("Scene Script: ", "Set Script: ", "Post Script: " for `sendtoscene` at
0x440ab0).

The last three `fx` forms are **Dust's**, and Titanic asks for none of them:
`extra.cst`'s crowd router uses `sendtoflatfx`, `sendtopostfx` and
`sendtoserverfx`. Registered as special forms, their deferred argument is
evaluated on the target rather than locally.

## Scene, stage & screen — `scene.ts`

The largest family. Set/scene/view state and travel primitives
(`opensetfile`, `closesetfile`, `currentset`, `currentscene`, `currentview`,
`roadahead`, `camerahi`, `scenexyz`), the stage layer (`openstagefile`, `closestagefile`,
`currentstage`, `currentflat`, `gotoflat`, `flattoindex`, `indextoflat`,
`setvisible`, `stagevisible`), resource
open/close (`openshopfile`, `closeshopfile`, `fileexists`), movies
(`playmovie`, `actionframe`), fades and palette effects (`screentoblack`,
`blacktoscreen`, `blackscreen`, `clut`, `mixclut`), audio/pacing state
(`currenttheme`, `themevol`, `wavevolume`, `framerate`), and the
count/index enumeration pairs for scenes, views, flats, shops, buttons and
paintings.

Three groups are **deliberately inert**, each for a recovered reason:

| Group | Names | Why |
|-------|-------|-----|
| Visual transitions (21) | `plain`, `nodraw`, `barndoorclose`/`open`, `irisclose`/`open`, `scrolldown`/`up`/`right`/`left` (sic: `scrolleft`), `venetian`, `wipedown`/`up`/`right`/`left`, `turnright`/`left`/`up`/`down`, `turnhalfleft`/`right` | behave as instant — visual polish for later; the fades that gate logic (`screentoblack`…) are real, and they [block the script](../engine/runtime/timing.md) for their `steps` ticks the way the original's do |
| Debugger family (14) | `propscript`, `buttonscript`, `scenescript`, `flatscript`, `stagescript`, `bootscript`, `postscript`, `setscript`, `paintingscript`, `puppetscript`, `castscript`, `actorscript`, `shopscript`, `serverscript` | opened the in-engine script editor; in every shipping build of `TI.EXE` the editor flag is clear and they no-op |
| Modifier keys (3) | `shiftkey`, `optionkey`, `commandkey` | always 0, keeping `if debugging & shiftkey()` debug branches dormant |

Plus a handful of harmless no-ops: `hidecursor`, `showcursor`, `debugger`,
`exportclut`, and the `propwarm`/`actorwarm`/`shopwarm`
asset pre-warmers (the port instantiates everything up front).

`transtoflat` and `transfromflat` are **not** here either: they are ~200 lines of
BOOTFILE script with no opcode id, which a builtin of the same name would
shadow. `openstagefile` is the primitive the shipped
handler calls; the overlay sequence around it is the game's
([Stage & UI](../engine/runtime/stage-ui.md)).
`visualeffect` is not a no-op: every effect but `plain` is a *reveal*. The ones
the scripts ask for — the wipes (`wipeleft`, `wiperight`, `barndooropen`,
`barndoorclose`) and Timelapse's four turns — are animated over `steps` engine
passes, and the script waits for them; the rest (`venetian`, the irises, the
scrolls) reveal instantly. Either way a reveal also **ends the transition-black
the script put up**, which one stage in the game relies on.

## Props — `props.ts`

`propexists`, `propis3d`, `propdelete`, `propvisible`, `propview`, `propxy`,
`propxyz`, `propset`, `propscale`, `propzclip`, `propowner`, `propinstance`,
`propdeg`, `propdist`, `propspeed`, `propvalue`, `propstar`, `starxyz`,
`countprops`, `indextoprop`, `error`. See [SHP](../engine/formats/shp.md) for the placement
model (`propxy` screen-space vs `propxyz` world-space).

In DreamFactory 5, `propdeg` only stores the degree, masked to 24 bits
(RedJack.exe 0x428880). The frame it picks is picked where the prop is drawn:
of the frames in the group the view's step names, the one whose angle is
nearest (see [DreamFactory 5](../engine/formats/dreamfactory-5.md#the-shop-the-cast-and-the-puppet)).

In DreamFactory 5, `propinstance` copies the whole prop record, placement
included, and renames it (RedJack.exe 0x427922): the ballista's stone is placed
as "brock" and flown as its copy.

`countprops`/`indextoprop` enumerate **one game-wide table** — the union of every
open shop, in the order the shops opened — and not the asking script's own shop.
TI.EXE keeps a single count at `0x489f18` and a single table at `0x489f14`
(158-byte records), with `countactors`/`indextoactor` the byte-for-byte twins one
table over at `0x489f08`. Nothing about the caller enters into it, and the
callers that matter most are not themselves a shop: both of `advanceday`'s world-reset loops, and the control panel's
`allprops`/`countallprops`/`allactors`.

A record carries the prop's name *and* the file it came from, so `indextoprop`
answers the first and leaves the second in **`result()`** — the same slot
`hittest` writes. That is how a caller enumerates one file's props out of the
game-wide table, and both of Dust's saloon card games clear the table between
rounds with it:

```
for count = 1 to countprops ()
    temp = indextoprop (count)
    if result () = "salgames.prp"
        propvisible (temp, false)
```

Every card, both score readouts and the WINNER banner, hidden in one pass and by
FILE — so the saloon hides its own props and not the interface band's. If only
`hittest` set `result()`, the comparison would never be true, the loop would hide
nothing, and a second hand of blackjack would be dealt on top of the first one's
cards and its result. The control panel's `allprops (name1)`, which compares `result()`
against a file name it was handed, is the same reading from the other game.

The name `indextoprop` answers is the one the prop is **registered** under, not
its sprite group's. Those are the same name for a shop's own groups and come apart
for a `propinstance` copy, which shares the group it draws with: blackjack's
dealer-side score readout is one (`propinstance ("bjscores", "bjscores2")`), and so
are poker's per-seat hand names (`nopair2`/`nopair3`/`nopair4`, one per seat off a
single `nopair` group). Reporting the group would make the clear loop name the
first seat's prop once per copy and the other seats' not at all — leaving the
opponent's last total on the table while the player's is hidden three times over.

## Audio — `audio.ts`

`voicesound`, `singlesound`, `multiplesound`, `dualsound`, `bothsound`,
`haltsound`, `haltvoice`, `halttheme`, `sounddone`, `voicedone`,
`currentsound`, `currentvoice`, `soundvol`, `soundpan`, `playtheme`,
`opentrackfile`, `closetrackfile`, and the
count/index pairs for sounds and tracks. The channel model is in
[Audio at runtime](../engine/runtime/audio.md).

`playnewtheme` is **not** here, for the same reason `trackbut` is not: it has no
opcode id, it is two lines of BOOTFILE script — `playtheme(name);
themevol(currenttheme(2), themevolume)` — and both halves it calls *are* opcodes.
A builtin of that name would shadow it (`evalCall` tries builtins before the
fallback chain); left unregistered, the game's own script runs.

`currentsound(1|2)` reads the two SFX slots and is the *only* way a script can ask
whether a sound has finished, so everything that plays on that channel has to
publish itself there — [crickets included](../engine/runtime/timing.md#crickets-sound-with-a-position).

## Timing — `timing.ts`

`delay`, `makeloop`, `stoploop`, `pauseloop`, `isloop`, `countloops`,
`indextoloop`, `makecricket`, `stopcricket`, `pausecricket`, `iscricket`,
`countcrickets`, `indextocricket`, `soundloop`, `forceupdate`. The model —
loops that are really one-shots, crickets, the per-frame special case — is in
[Timing](../engine/runtime/timing.md).

## Actors — `actors.ts`

`opencastfile`, `closecastfile`, `actorexists`, `actorinstance`,
`actordelete`, `actorvisible`, `actorhide`, `actorset`, `actorxyz`,
`actorstar`, `actordeg`, `actorpose`, `actorscale`, `actorzclip`,
`actorspeed`, `actorturn`, `actorvalue`, `actorowner`, `actordist`,
`turntodeg`, the walks (`walktostar`, `walktoxyz`, `walkonpath`, `iswalk`,
`stopwalk`, `pausewalk`, `walkdest`, `countwalks`, `indextowalk`) and the
count/index pairs for actors and casts. See
[Characters](../engine/runtime/characters.md).

One divergence, read out of `TI.EXE` with `disasmcmd`: **`actorvalue`** stores its
value at `+0x50` of the 0xA8-byte actor record, accepts **integers only** (type tag
4), and answers a lookup miss with an **ERROR** where the port answers 0. It
explains the C73 door-knocking that never stops: the cabin's `openset`
gates on `actorvalue("smeth") = 0`, and **nothing in all 465 dumped script
containers ever writes it** — not by literal, not via `me`, not via `name` (those
hits are `extra.cst` storing a facing degree; `SMETH1.PUP` sets `smethphase`
instead). So the gate cannot flip and the knock re-arms on every entry to the
cabin, **in the original too**. `actorvalue` also has no field in the saved-actor
record at all, which is one of the things a `.ti` round trip
[forgets](../taoot/verification.md#one-game-carried-not-a-chain-of-loads).

## Puppets — `puppets.ts`

`openpuppetfile`, `closepuppetfile`, `currentpuppet`, `puppetspeak`,
`puppetclear`, `puppetbevel`, `puppetevent`, `puppetbase`, `puppetvisible`,
`puppetparam`, `countpuppets`, `indextopuppet`, `puppetscramble` — plus two
stubs the corpus never exercises meaningfully (`puppetsubtitle`, `puppetgrab`).
See [Characters](../engine/runtime/characters.md).

`puppetscramble` shuffles the plaques offered **so far**, leaving any pushed
after it in place — which is what pins the way out of a conversation to the
bottom row while the questions above it move. It is 0x4402e0's own loop rather
than a shuffle of our choosing (`bevelCount * 5` swaps, two independent
`rand(bevelCount)` draws each), because the number of draws is what advances
the script random stream and every story coin after it is a function of that.

`puppetevent`'s argument is a wait, in DreamFactory 5: RedJack.exe (0x42f140)
waits that many sixtieths of a second for a plaque and answers -2 when they
run out, and waits for good on a negative one. Marquez's `puppetevent (0)`
straight after an answer is a look for a click, not a question. Titanic's and
Dust's waits still ignore the argument.

## Pointer & text — `pointer.ts`

`makepoint`, `pointx`, `pointy` (the packed point `(x<<16)|y`), `mouse`,
`button`, `stilldown`, `hittest`, `result`, `flushevents`, `mousedown`, the
five hit tests (`pointinbutton`, `pointinprop`, `pointinactor`, `pointinset`,
`pointinstage`), and the text overlay pair `drawstring` / `stringwidth`. These are what drag loops (the wireless tuning
knob, the gramophone crank) are built from.

`trackbut` is deliberately **not** here. It is a BOOTFILE library code the game
ships (container 0002), built out of the primitives above — `propxy`,
`propvisible`, `stilldown`, `forceupdate`, `mouse`, `pointinbutton` — and the
engine resolves it through `Interp.fallbackScripts` like any other library call.
It answers `pointinbutton(currentflat(), target, mouse())`, so what a push-button
tests is the flat's named click REGION, not the bevel prop it lights.

## Helpers — `helpers.ts`

String and math utilities plus host probes: `findword`, `putword`,
`stringlength`, `variable`, `numtostring`, `calcdeg`, `calcmod`, `calcdist`,
`calcvectx`, `calcvecty`, `currentdeg`, `cameraxyz`, `playerxyz`,
`stageparam`, `setparam`, `tick`, `frame`, `menuvisible`, `keyaborts`,
`countbevels`, `path`, `notedialog`, `questiondialog`, `textdialog`, `quit`,
and the environment probes `machinetype` (returns `"win"`), `currentcd`,
`lowmemory` (0) and `heapsize` — 64 MB, so the BOOTFILE's RAM check takes the
full-quality `.trk` path instead of
[the low-memory `.11k` one](../engine/formats/audio.md#_11k-the-low-memory-swap-in),
and 4 MB when the player has asked for
[the low-memory game](../taoot/low-memory.md).
`calcmod` is a **non-negative** modulo, recovered from `TI.EXE` — plain `%`
breaks the compass math.

`variable(name[, val])` reads and writes a variable by **computed** name, and the
name resolves the way one written out in full does: the running block's locals
first, then the globals. Titanic's blackjack uses it for the side it was called
about (`variable (who @ "count")` → `playercount`/`dealercount`), Dust's crowd for
the actor it is (`variable (me, 1)`); Dust's poker classifies a hand by counting
faces into thirteen **locals** and reading them back with it —

```
local card2, card3, … card14
…
for count = 2 to 14
    if variable ("card" @ numtostring (count)) = num
```

— a globals-only lookup answers 0 there, and no hand ever holds a pair. The
*setter* still creates a global for a name the block did not declare local: an
actor storing its walk phase under its own name has to reach the table the next
`switch variable (me)` reads.

`findword`/`putword` have **two modes**, and an empty delimiter is the second one
rather than a default separator. With a delimiter the string is a word list split
on it (`findword("a,b,c", ",", 2)` → `"b"`); with an **empty** delimiter the idx
addresses a single CHARACTER. From TI.EXE's own arm: `findword`'s empty
branch (`0x428c5f`) range-checks the idx against the source's length byte, writes
a result of length 1, and copies `source[idx]` into it; out of range is `""`.
`putword`'s (`0x428fc0`) is the counterpart: inside the string it inserts the word
before character idx, one past the end it appends, further out it yields `""`.

The character mode is
[#199](https://github.com/dhobi/dreamrefactory/issues/199)'s second half. Three of
TAOOT's own uses need the character rule: the wireless Morse tapper walks
`for count = 1 to stringlength (sound)` and treats `" "` as a value, the keypad
matches one typed letter against `findword ("thayer", "", stringlength
(thayermess) + 1)` in a literal with no spaces, and `extra.cst`'s `setupactor`
takes a crowd star apart by position (`"ex.a.1"` → letter `a`, number `1`) to name
the instance `brown1a1`. It also governs reading back a save the ORIGINAL wrote:
the shipped saves carry `saveprops2 = "11111101100111110"`, dense,
17 characters for the 17 indices the Enigma's `showX` reads, and every one of
those `= "1"` tests fails under a space-joined reading.

## Saved games — `savegame.ts`

`savegame`, `opengame` — see [Saving & loading](../engine/runtime/saves.md).

Back to the [reference index](README.md).

## DreamFactory 5 — `maze.ts` and `df5.ts`

RedJack's commands, each read out of `RedJack.exe`
(`npx tsx redjack/tools/rjdis.mts cmd NAME` prints a command's handlers). Every
one answers only in a v5 game. Several of the ids are in v4's table too, so in
any other game they stay the unknown commands they always were. What they do in
a room is on [Rooms in play](../engine/runtime/rooms-v5.md).

**The room** (`maze.ts`): the angle arithmetic `simpletodeg`, `degtosimple`,
`degmask`, `degdiff` and `calcturn`; the camera's `camerapitch` and
`camerafov`; the exits `countexits`, `indextoexit`, `nearexit`, `nodescroll`
and `launchexit`; the quads `pointinquad` and `quadscript`; `nodequality`; and
`sysparam`. `cameraxyz`, `playerxyz` and `scenexyz` answer from the room's
camera and nodes in a v5 game, and v4's `propspeed` id is `sysparam` there.

**Shared names, v5 forms** (`helpers.ts`): `calcvectx` and `calcvecty` are
`trunc (mag × cos/sin (angle × 2π / 2^24))` over the whole 32 bits (0x4356e0,
0x435710), where v4 used a 0..255 table and a 16-bit magnitude. `calcdist` and
`calcdeg` take four coordinates, `(x1, y1, x2, y2)`, instead of two packed
points (0x4185c0, 0x4184f0), and `calcdeg` answers a heading in 2^24ths of a
turn.

`propis3d` (`props.ts`) answers and sets the prop's own 3D flag in a v5 game
(0x429d60), and 0 in every other.

`pointinactor` (`pointer.ts`) asks the one actor in a v5 game: whether its own
sprite covers the point, whatever is drawn over it (0x406860). The older
engines answer from the hit test, which names only what is on top.

**Everything else** (`df5.ts`):

| Commands | What they do |
|---|---|
| `proporder`, `actororder` | where a sprite is in its animation: 1 the length of the order it plays, 2 the step it is on, 3 the picture at that step, 7 how many pictures the view has |
| `propistrue3d`, `propisfacer`, `proppitch`, `actoristrue3d` | a prop drawn as a flat picture set in the room ([pictures that stand in the room](../engine/runtime/rooms-v5.md#pictures-that-stand-in-the-room)) |
| `actorflip` | `propflip`'s twin: 1 mirrors across, 2 upside down. `propflip` itself now works on screen props as well |
| `propbrightness`, `actorbrightness`, `screenbrightness`, `screencontrast` | [colour](../engine/runtime/rooms-v5.md#colour): a number added to each channel, and a gamma |
| `stageflat`, `stageorigin`, `propsnap` | [the fights' stage](../engine/runtime/rooms-v5.md#the-fights-stage): v5's `gotoflat`/`currentflat`, where the stage is drawn, and the props that move with it |
| `themeorder` | the order a theme's loops play in, 1-based into its bank's loop records; if the theme is playing, it restarts in the new order |
| `calcpoint` | a room point's screen point, or (32000, 32000) behind the camera |
| `calcrgb` | one colour, 0x00RRGGBB |
| `spacebar` | whether the space bar is held down now |
| `doublebuffer`, `singlebuffer` | the control panel's 16- or 32-bit switch. The canvas is true-colour either way, so a switch always works and `sysparam (10)` answers the depth asked for |
| `flatwarm`, `castwarm`, `flushcache`, `reboot` | no-ops: loading ahead of need, dropping what was loaded, and a restart only reached behind `isdebugging ()` |
| `isdebugging` | 0, as in the shipped game |

**Still unknown in v5:** the menu-building commands (`createmenu`,
`appenditem`, `cmdkeyitem`, `clearmenus`, `drawmenus`), which build a debug
menu that `menuvisible (isdebugging ())` keeps hidden, and copying game files to the hard
disk (`buildfilenames`, `countfilenames`, `indextofilename`, `copylocal`).
