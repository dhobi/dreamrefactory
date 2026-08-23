# BOOTFILE — startup & the standard library

*Prerequisite: [The DFile container format](README.md) and
[The scripting language](../scripting-language.md).*

Every DreamFactory game has at least one **BOOTFILE**. It has no room, no
picture you look at — it's a container file full of **scripts**. It plays two
roles at once:

1. **The startup routine** — it decides what the game loads first and hands
   control to the first real screen.
2. **The standard library** — its handlers define the shared behaviour that
   every set, scene and prop relies on: how doors work, how the menu works,
   how you move, how you travel between rooms.

Reference: it's read with the ordinary [container](README.md) reader; its
special *role* is implemented across
[`engine/src/runtime/session.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/session.ts) and the interpreter's
fallback resolution in [`engine/src/runtime/interp.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/interp.ts).

## Why the boot is the "standard library"

Recall from [the scripting doc](../scripting-language.md) that an
unqualified command call resolves in this order:

```
local script  →  engine builtins  →  stage script  →  boot library
```

The **boot library is the last stop before failure**, and it defines roughly
**76 globally-callable handlers** — `changeset`, `spotmovie`, `progress`,
`setupactor`, `putdownactor`, and many more. `gotospecial` (the fade-wrapped
room-to-room travel routine) is defined in `MAIN.STG`'s main script, which sits
in the same resolution chain. So when a set script calls `changeset("hallb",
"scene29", "view41")` and nothing local matches, the call lands in the boot
library, which ultimately calls the engine primitives `opensetfile` /
`closesetfile`.

This is the mechanism that lets thousands of little per-room scripts stay tiny:
the hard work is written once, in the boot.

## The two script containers, and the movement model

The BOOTFILE's script containers are kept **separate**, and this separation is
load-bearing:

- **Container 1's `keydown`** routes the key to the current scene:
  `sendtoscene(currentscene(), keydown(arg))`. This gives scene scripts first
  crack at the key.
- **Container 2's `keydown`** is the **default movement**. It implements
  walking and turning via a *setter* form of `currentscene`: `"strait"` walks
  forward, `"left"` / `"right"` turn.

Because events run the whole [event chain](../scripting-language.md#the-chain-and-how-an-event-is-consumed),
a key press reaches container 2's default movement **only if nothing earlier
consumed it**. That's precisely how a scene script suppresses the default walk
and instead sends you through a door to another set: it handles `keydown` and
ends with `exitcode`.

The whole BOOTFILE, and it is the odd one out among these maps:

<ByteMap map="bootfile" />

Four containers, no pictures, no tables — and **no pointer graph at all**. Every
other format here is a tree of containers naming each other; the boot's handlers
are reached **by name**, through the resolution chain above, so nothing in the
file points at anything else in it. That is what "standard library" means in
bytes.

## What the boot loads at startup

At session start the boot brings in the resources that must exist before any
room opens — and they stay loaded for the **whole session**, not per-set. In
TAOOT that is:

- **`house.shp`** — 44 ship-wide props, including the `door` prop with its 135
  route-named states and the UI-band furniture.
- **`inven.shp`** — the inventory props.
- **`inven.trk` / `unilib.trk`** — shared audio banks (generic voice lines,
  inventory sounds).
- **`MAIN.STG`** — the always-present stage that provides the UI band
  background and `gotospecial`.

**That list is not written down anywhere in the port.** It is *read out of the
BOOTFILE*, because the boot's own scripts name every one of those files as a
string literal — `openshopfile("house.shp")`, `opentrackfile("unilib.trk")`,
`openstagefile("main.stg")`, `opencastfile("gang.cst")`, `playmovie("logo.mov")`,
`initall("bedsit1")` — so the BOOTFILE *is* the manifest of what a launch needs.
A browser host has to know it in advance (it cannot block on a fetch mid-`boot()`),
and a hardcoded list of TAOOT filenames would be knowledge about one game sitting
in the layer that runs any of them: the 1996 demo shares four of these names, needs
a fifth this list never heard of, and boots into a menu stage rather than a room.
The same read also yields the game's disc volumes, from `setpath`'s own
`currentcd("Titanic1")`. How the walk is done, and where it deliberately stops, is
**[the boot plan](../runtime/host.md#the-boot-plan-what-a-game-says-it-needs)**.

Global variables the scripts expect to exist (`savestage1-3`, `handitem`, the
saved-deck markers, …) are **seeded** at session start, because scripts test
them with `!= ""` and an uninitialised `0` would break under text comparison.

## Initialisation: `initprop` / `initprops`

Because boot-loaded props are session-scoped and shared, they're initialised
through the boot too. A `sendto*` to a prop that has **no matching handler**
falls back to the boot library with `me` set to the target's name — so a
generic `initprop()` in the boot runs "as" each prop in turn. That's how the
whole prop set gets set up from one place at startup.

## In short

The BOOTFILE is where "the game" — as opposed to "the rooms" — actually lives.
If you're trying to understand *why* something happens game-wide (a door
closing when you leave, the ↑ key walking you forward, a fade covering a room
change), the answer is almost always a handler in the boot library.

Next, if you want to go all the way down: **[the script container on
disk](script-container.md)**.
