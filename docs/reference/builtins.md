# Builtin commands

*Prerequisite: [The scripting language](../engine/scripting-language.md) — what a
builtin is and how calls resolve.*

This is the inventory of every engine command the port registers — roughly
**249 builtins plus 25 `sendto*` special forms**, grouped by the modules under
[`engine/src/runtime/builtins/`](https://github.com/dhobi/dreamrefactory/tree/master/engine/src/runtime/builtins).
The [opcode table](../engine/formats/script-container.md#command-ids-the-opcode-table)
names ~280 commands in total; the gap between "named" and "implemented" is
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

The last three `fx` forms are **Dust's**, and Titanic asks for none of them:
`extra.cst`'s crowd router uses `sendtoflatfx`, `sendtopostfx` and
`sendtoserverfx`, and unregistered they were not special forms at all, so
their deferred argument evaluated locally instead of on the target.

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

`transtoflat` and `transfromflat` are **not** here either, and that is the biggest
one of these: they are ~200 lines of BOOTFILE script with no opcode id, and
builtins of those names shadowed them. `openstagefile` is the primitive the shipped
handler calls; the overlay sequence around it is the game's
([Stage & UI](../engine/runtime/stage-ui.md)).
`visualeffect` used to be listed as a no-op above and is not one: every effect but
`plain` is a *reveal*, and while this port still draws the effect itself instantly,
a reveal also **ends the transition-black the script put up** — which is what one
stage in the game relies on, and nothing else was doing.

## Props — `props.ts`

`propexists`, `propis3d`, `propdelete`, `propvisible`, `propview`, `propxy`,
`propxyz`, `propset`, `propscale`, `propzclip`, `propowner`, `propinstance`,
`propdeg`, `propdist`, `propspeed`, `propvalue`, `propstar`, `starxyz`,
`countprops`, `indextoprop`, `error`. See [SHP](../engine/formats/shp.md) for the placement
model (`propxy` screen-space vs `propxyz` world-space).

`countprops`/`indextoprop` enumerate **one game-wide table** — the union of every
open shop, in the order the shops opened — and not the asking script's own shop.
TI.EXE keeps a single count at `0x489f18` and a single table at `0x489f14`
(158-byte records), with `countactors`/`indextoactor` the byte-for-byte twins one
table over at `0x489f08`. Nothing about the caller enters into it, which matters
because the callers that are not themselves a shop are the interesting ones: both
of `advanceday`'s world-reset loops, and the control panel's
`allprops`/`countallprops`/`allactors`.

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
A builtin of that name shadowed it (`evalCall` tries builtins before the fallback
chain); what was registered inlined exactly those two lines, faithfully, so nothing
about the game changed when it went — the objection is only that a script should
not have to get past us to run.

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
4), and answers a lookup miss with an **ERROR** where the port answers 0. That is
the loose end behind the C73 door-knocking that never stops: the cabin's `openset`
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
`puppetparam`, `countpuppets`, `indextopuppet` — plus three stubs the corpus
never exercises meaningfully (`puppetsubtitle`, `puppetgrab`,
`puppetscramble`). See [Characters](../engine/runtime/characters.md).

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

`findword`/`putword` have **two modes**, and an empty delimiter is the second one
rather than a default separator. With a delimiter the string is a word list split
on it (`findword("a,b,c", ",", 2)` → `"b"`); with an **empty** delimiter the idx
addresses a single CHARACTER. TI.EXE's own arm settles it — `findword`'s empty
branch (`0x428c5f`) range-checks the idx against the source's length byte, writes
a result of length 1, and copies `source[idx]` into it; out of range is `""`.
`putword`'s (`0x428fc0`) is the counterpart: inside the string it inserts the word
before character idx, one past the end it appends, further out it yields `""`.

Reading that as "split on spaces" was
[#199](https://github.com/dhobi/dreamrefactory/issues/199)'s second half. Three of
TAOOT's own uses need the character rule: the wireless Morse tapper walks
`for count = 1 to stringlength (sound)` and treats `" "` as a value, the keypad
matches one typed letter against `findword ("thayer", "", stringlength
(thayermess) + 1)` in a literal with no spaces, and `extra.cst`'s `setupactor`
takes a crowd star apart by position (`"ex.a.1"` → letter `a`, number `1`) to name
the instance `brown1a1`. It also decided whether a save the ORIGINAL wrote could
be read back: the shipped saves carry `saveprops2 = "11111101100111110"`, dense,
17 characters for the 17 indices the Enigma's `showX` reads, and every one of
those `= "1"` tests failed against a space-joined reading.

## Saved games — `savegame.ts`

`savegame`, `opengame` — see [Saving & loading](../engine/runtime/saves.md).

Back to the [reference index](README.md).
