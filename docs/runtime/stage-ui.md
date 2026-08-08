# Stage & UI — flats, overlays and the click order

*Prerequisite: [STG — stage files & the UI](../formats/stg.md) (the format);
[Engine architecture](../02-engine-architecture.md) for the layer picture.*

The [STG format doc](../formats/stg.md) explains what a stage file *contains* —
flats, scripts, click regions. This page is about what the engine **does**
with a stage at runtime: how one opens and closes, how the inventory can
appear *over* a mini-game and put it back exactly as it was, and — the thing
you'll need most when debugging — exactly who gets a click first.

Reference implementation:
[`src/engine/stage.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/stage.ts)
(`StageController`; the session delegates to it).

## The render stack

The screen is built back-to-front, and the stage is the **bottom layer**:

```
┌────────────────────────────────┐
│  SET view (top 512×264)         │  ← composited in when "set visible"
├────────────────────────────────┤
│  UI band: menu · held item ·    │  ← STG flat image + house.shp props
│  watch                          │
└────────────────────────────────┘
```

- The current **flat image** is the background for the whole 512×384 frame.
- When the set is visible, the room view is composited into the top 512×264.
- **Props** (from SHP) draw on top, z-ordered by `propdist` — *more negative =
  nearer the front*; inventory items sit in front of the band.
- A **full-screen** flat (the map, the inventory, a puzzle board) calls
  `setvisible(false)` so the room view is hidden and the flat owns the screen.

The bottom band's furniture — the lifesaver menu button, the held item, the
watch — are **`house.shp` props** drawn over `MAIN.STG`'s flat at fixed screen
positions.

## Opening a stage: the lifecycle conventions

`openstagefile` is a **primitive**, and only that: open the file, run the stage's
own **`openstage`** handler (the deck map pages itself to your current deck
here), and if that didn't pick a flat, make the **first flat** current. Closing
is its mirror: **`closestage`**, then the current flat's **`closeflat`**.
Switching flats with `gotoflat` fires `closeflat` / `openflat` — the flat-level
mirror of `closescene` / `openscene`.

Everything *per-stage* belongs to the game's `transtoflat` script below, not to
the primitive, and this is where the port used to keep three tables of TAOOT
stage names:

- the per-stage entry handler **`open<basename>`** — `openwireless()` opens the
  wireless set's shop and track and places its props — is `transtoflat`'s own
  middle switch (`sendtostage(openwireless())`);
- the stages that keep their entry handler **on the flat** instead
  (`blkjack.stg` fires `initgame` and deals the opening hand, `fight.stg` fires
  `openfight`) are its flat switch;
- and the entry effects are its too: entering `redphoto.stg` with the white light
  off darkens the stage via the CLUT (`mixclut("stage", "black", …)`) — the
  darkroom is black until you find the safelight switch — and the trunk opens on
  `trnkopen.mov`.

The teardown half is the same: `close<basename>` (which tears down the stage's
shop and track) is run by `transfromflat` *before* `closestagefile`, so the
primitive must not mirror it — doing so ran it twice.

One naming quirk, and it is the script's rather than ours: the darkroom's two
stages (`photo.stg` white light, `redphoto.stg` red light) are the *same room*
sharing `photo.shp`, so `redphoto` maps to base name `photo` throughout.

## The overlay stack: `transtoflat` / `transfromflat`

The inventory doesn't *replace* your screen, it **covers** it — and can cover
a screen that is itself an overlay.

**This is the game's script, not the engine's.** `transtoflat` and
`transfromflat` are ~200 lines of BOOTFILE code with no opcode id, and the port
registered builtins of those names — which shadowed them, because `evalCall` tries
builtins before the fallback chain, and which is what forced the transcription of
the per-stage switches above. They are gone; `GameSession.transToFlat` runs the
shipped handler, so the host, the dev bar and the ~60 test sites reach it
unchanged. The copy had been skipping content, too: the shipped `restorescreen`
handles a dead player, the unlit cabin, the guided tour and the long fade after
the Vlad fight, none of which the transcription had.

What it does, taking `transtoflat("inven1.stg")`:

1. asks the underlying stage's shop to **hide and stash** its props —
   `sendtoshop(hide<base>())`; each puzzle shop saves its prop visibility so
   the matching `show<base>` can restore it (`main.stg` is special: its band
   lives on `house.shp` via `hideinterface`/`showinterface`);
2. **pushes** the current `{stage, active flat, ambient theme}` on a stack —
   which *is* the boot's `savestage1..3`/`saveflat1..3` globals, no longer a port
   array mirroring them (clearing the stack on a hard navigation therefore means
   clearing those, which is also what a fresh `boot()` does);
3. opens the overlay stage full-screen (`setvisible(false)`), hiding a live
   conversation's puppet so the overlay's own input loop gets the clicks.

`transfromflat` pops the frame and restores **exactly** that screen: the same
stage, the same flat (mid-puzzle state included — returning from the inventory
to the matryoshka puzzle lands on the opened doll, not the puzzle's first
flat), the shown props, the saved ambient theme (so a fencing bout's
`fence.trk` doesn't leak into the room), and the puppet if you were mid-
conversation over `main.stg`. Finally, if a deck-map red-area click stashed a
destination in `jumpset`/`jumpscene`/`jumpview`, the pop completes it with a
`changeset` — that's how "click a red area on the map, close the map, arrive
there" works.

The stack is why nesting works: `patty.stg → inven1.stg → patty.stg` needs
three frames of memory, which the original's three `savestage` globals provide.

One builtin the un-shadowing exposed as a no-op: **`visualeffect`**. Every effect
but `plain` is a *reveal* — the new screen wiped, irised or scrolled in over the
old — and this port draws them instantly, which is only half a translation,
because a reveal also **ends the transition-black the script put up**. Blackjack
is where that showed: `HOUSE` fades the dealer out with `screentoblack("puppet")`
and `transtoflat("blkjack.stg")`, the one stage the boot deliberately neither
blacks out nor fades back in, because `newgame`'s own `visualeffect(wiperight,
20)` is the reveal. The deal ran perfectly behind a screen that stayed dark.
`plain` is excluded because it is the opposite instruction — scripts call it to
clear a pending effect immediately before the `blacktoscreen` that does the
revealing.

## Who gets the click: the full order

Hit-testing on a stage runs **front-to-back through what's drawn**:

1. **Props** — front-to-back by `propdist`, *pixel-accurate* against each
   frame's opaque mask (a transparent hole in a prop is not a hit).
2. **Flat click regions** — the rectangles from the STG's click-logic
   container. Two subtleties recovered the hard way:
   - a region **with** its own script normally handles the click, *but* a
     visible prop with its own `mousedown` drawn over that point wins — the
     prop is foreground art (the matryoshka doll overlaps the very hotspots
     that revealed it);
   - a region **without** a script is a bare hotspot: the flat script and
     stage main get a `mousedown` with the region's name as `target` (the
     fusebox works this way), and the click *also* falls through to the prop
     path.
3. **View hotspots** (when the set shows through, e.g. under `main.stg`'s
   band) — then the **flat script**, then the **stage main** — the usual
   "specific thing first, then fall back" chain.

Keyboard is simpler: a stage's `keydown` goes to the **current flat's**
handler if it has one, else the stage main (the wireless telegraph key).

## Buttons: `sendtobutton`

Mini-games drive their own regions by name — `sendtobutton(flat, "ok",
mousedown())` behaves like a click on that region without a cursor. And it is not
only mini-games: the boot's own `mousedown` dispatches EVERY button click this way
(`case "button": sendtobutton(currentflat(), thename, mousedown(thepoint))`), so
this is the main road, not a side door.

`me` *and* `target` are the button's name — in both branches, whether the region's
own script defines the handler or it resolves up the library chain (flat → stage
main → boot). `target` is the addressee, the same value a click resolved by
position gives that handler, and it is what lets the BOOTFILE's generic `trackbut`
hit-test "this button" for any stage that borrows it: its body reads
`pointinbutton(currentflat(), target, mouse())`. With the caller's name there
instead, every OK button in the game silently refuses its confirm.

Next: the people — **[Characters at runtime](characters.md)**.
