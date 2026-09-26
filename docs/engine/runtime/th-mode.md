# TH mode — the menu band tucked away

**TH mode** ("Tyler Hartman mode") is a box beside *stretch to fill* under the
picture on [Titanic](../../taoot/)'s and [Dust](../../dust/)'s play pages. Ticked,
the picture is the room alone, with the menu band under it hidden until it is
wanted. It is meant for a wide display, where the room fits much better than the
whole 4:3 screen.

It is named for, and follows the idea of, **Tyler Hartman**'s fullscreen builds
of Titanic:
[TylerHartman/Titanic-Adventure-Out-Of-Time-Fullscreen](https://github.com/TylerHartman/Titanic-Adventure-Out-Of-Time-Fullscreen).
His repository ships four builds of the original Windows game, each presenting
the same 512×384 game differently. Its *Immersive Fullscreen* build "uses the
512x264 world viewport as the fullscreen source during normal exploration,
removing the lower HUD/menu from the presentation", and a right click toggles it.
As he puts it, "the game itself still renders at its original dimensions.
Scaling and cropping are handled at presentation time rather than by altering
scene geometry". That is the rule here too.

## Why the band

Both games draw one 512×384 framebuffer. Its top 512×264 is the room, the set's
viewport, and the 120 rows under it are the stage's menu band: the inventory,
the buttons, and a conversation's answers ([the screen
contract](host.md), [stage & UI](stage-ui.md)).

| picture | shape | on a 16:9 display |
|---|---|---|
| the whole screen | 4:3 (1.33:1) | bars down both sides, or a third of its height pulled out by *stretch to fill* |
| the room alone | 512:264 (1.94:1) | the full width, with a thin bar above and below |

TH mode and *stretch to fill* are two answers to the same question, so they
exclude each other: ticking one unticks the other.

## What the player sees

- **Walking about**: the room's view alone, in the page and in fullscreen (a
  phone is rarely in fullscreen, so the page gets it too).
- **The band, when it is wanted**: the band slides in under the room over a
  quarter of a second, and the room squeezes up to make way rather than being
  covered. It comes in when
  - a conversation asks for an **answer**, which the band holds, and
  - the player **right-clicks**, or on a phone taps with **two fingers**. The
    same again slides it out. A long press is not used, because a phone reports
    a held finger as one and that is half of every swipe to walk. Nor is the
    one-finger double tap, which is Escape and skips a film.
- **A picture of the whole screen**: a close-up such as Titanic's bedsit desk
  papers, a menu, or a film that reaches into the band's rows. It fills the same
  box whole, all 384 rows, at once rather than sliding, because the picture
  itself has changed. It is pulled further out of 4:3 than the room is, and that
  is deliberate: the box does not jump about between a room, its band and its
  close-ups.

## How it works

It is layout and nothing else, the same promise [*stretch to
fill*](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/stretch.ts)
makes. The framebuffer, the scripts and the hotspots see the same 512×384, and
no set, film or script knows the mode is on.

- **The box** is the room's shape. In fullscreen it is the largest 512:264 that
  fits the display. In the page it is the canvas's own width at 512:264, and
  Dust's page, which sizes its frame and stage from a 4:3 `--pic-h`, is handed
  the view's height instead.
- **Showing some rows of the screen** takes two CSS properties: `scaleY(384 /
  rows)` from the top, and a `clip-path` cutting off the rows below. Sliding the
  band animates `rows` between 264 and 384. A transform moves the box that
  `getBoundingClientRect` reports along with it. So each page's mapping of a
  click to a screen pixel (per axis, against that box) and the size of the
  cursor stay right with no change. The clipped rows take no clicks.
- **The rim**: the clip would cut the canvas's own rim (Titanic's brass hairline,
  Dust's moulding lip), so in the page the rim moves to an overlay the size of
  the canvas.
- **What is on screen** comes from the director: `ScreenDirector.picture`
  records whether the last frame it painted was the room's view over the band
  or a picture of the whole screen. A frame it holds, during a room change for
  instance, leaves it as it was, so the layout does not flicker. Nothing in the
  engine reads it, only the pages.

The code is
[`engine/src/web/tylerhartman.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/tylerhartman.ts),
wired into
[`taoot/src/main.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/src/main.ts)
and
[`dust/src/main.ts`](https://github.com/dhobi/dreamrefactory/blob/master/dust/src/main.ts).
The box is remembered per game and per browser (`taoot.picture.th`,
`dust.picture.th`), so ticking it on one device does not tick it on another.
