# Rooms in play — DreamFactory 5

*Prerequisite: [SETT](../formats/sett.md) for what a v5 room holds, and
[Characters](characters.md) for how v4 draws its sprites.*

This is what the port does with a [RedJack](../../redjack/) room once it is
open: the camera, the walk, where a prop or an actor goes on the screen, how big
it is, and what hides it. Every rule here was read out of `RedJack.exe`, and the
code cites the address beside each one.

| | |
|---|---|
| [`engine/src/runtime/maze.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/maze.ts) | the room's state and rules: the camera, the exits, the walk, the sprite camera; no pixels |
| [`engine/src/runtime/maze-render.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/maze-render.ts) | a node's sphere, drawn through the camera |
| [`engine/src/web/maze-view.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/maze-view.ts) | the room on the screen: the sphere, the film while you walk, the depths that hide sprites |
| [`engine/src/runtime/builtins/maze.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/builtins/maze.ts), [`df5.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/builtins/df5.ts) | the commands the scripts drive it with |

## The scripts do the moving

Almost none of the navigation is the engine's. The room's main script owns it,
written against the BOOTFILE's library:

- **Looking round.** `setcursor` scrolls the view while the pointer is near an
  edge, through the BOOTFILE's `tracknodescroll`.
- **Walking.** `keydown ("up")` finds the exit nearest the way you face, scrolls
  to it with `nodescroll` and walks it with `launchexit`.
- **Turning to the next exit.** Left and right go to the next exit round with
  `gotosaver`.

What is left for the engine is the camera, the list of exits, playing the walk,
and working out where a click lands.

The original calls the BOOTFILE's `idle ()` whenever nothing else is running,
and `idle` sends `setcursor` to whatever is under the pointer. That is how the
view scrolls while the pointer rests at an edge. The browser only reports the
pointer when it moves, so the view runs `idle` itself on every frame it stands
at a node.

**The event chain** is v4's with nodes in place of scenes and quads in place of
hotspots: quad script → node script → room main → stage → boot.

## The angles

Every angle a script sees is a fraction of a turn, in 2²⁴ parts. `degmask (-1)`
is 2²⁴ − 1, `camerafov (64 * 65536)` is 90°, and the films store the same
integers beside their radians (a heading of 91.53° next to 4265445). Pitch is
kept masked too, so looking down is just under a whole turn; the BOOTFILE's
`tncalcnewturn` clamps it with `if curpitch < simpletodeg (180)`.

`simpletodeg`, `degtosimple`, `degmask`, `degdiff` and `calcturn` are the
arithmetic the scripts do on them.

## Scenes

A room with scenes instead of spheres (the shark's rowboat, the darts, the
flame run) stands you at fixed views. `currentscene ("left")` or `("right")`
plays one of the scene's two turning films, from the view you are at to the
next one it reaches, and `currentscene ("strait")` walks the road ahead of the
view. While any film plays `currentview ()` is `"moving"`; at a node it is
`"node"`, and in a scene it is the view's name.

## Where a sprite goes on the screen

Props and actors are placed in the room at a point (`propxyz`, `propstar`) and
drawn through the camera. RedJack.exe builds a matrix from the camera's heading,
pitch and roll (`0x435a40`), and `0x435740` puts a point through it: the point
less the camera, taken as (x, z, y), gives how far down the screen, how far
across, and how deep along the view it is. The screen point is the view's centre
less focal × down / depth (and across). The focal length is half the view's
width over tan(fov / 2), the same the room's quads are projected with.

**It hands back two depths, and they do different jobs:**

- **The distance** (the square root of the three deltas squared). Sprites are
  sorted by it, far first, and the room's far limit cuts at it.
- **The depth along the view.** The scenery hides a sprite by this one
  (`0x42ce18`).

In the port, `SpriteCamera.project` returns both, `depth` and `axial`, and
`hiddenBy` in `geometry.ts` picks the one scenery hides by.

**The far limit.** A sprite whose distance, less its `propzclip` or
`actorzclip`, is at or past the room's limit (MAZE 0x10a, 1,350,000 in most
rooms) is not drawn at all (`0x42cb7e` for props, `0x406cc2` for actors).

**Which frame a sprite shows.** A sprite that faces a way (`propdeg`) shows the
frame nearest its facing less the bearing from it to the camera (`0x41df00`), in
the frames' 0..255, which is the high byte of a script angle.

## How big a sprite is

`0x4358d0`: a frame is drawn at

```
scale × focal / (depth′ × 1000)
```

times its own size, where depth′ is the depth of the point lowered by
ref × scale / 1000, and the result is held to 0..4096 pixels. `scale` is
`propscale` or `actorscale`. `ref` is the i16 at 0x14 of the prop's group or the
actor's cast member. Most props hold 0. Nick and the walk-ons hold 0; the people
you talk to hold -120 to -370.

**Not checked against the running game.** The formula is the disassembly's,
but no screenshot of RedJack itself has been measured beside the port's at the
same place.

`camerahi` plays no part. RedJack.exe stores it (`0x408895`) and reads it back
(`0x418b70`) and does nothing else with it, so neither does the port.

## Pictures that stand in the room

`propistrue3d (p, true)` stops a prop being a sprite square to the screen: it
becomes a flat picture set in the room (`0x42caa0` hands it to the 3D renderer,
`0x456540`).

- **Where it is.** The frame's hot spot sits on the prop's point, and one pixel
  of the frame is scale / 1000 of a room unit.
- **Which way it faces.** A **facer** turns to the camera. Every prop is a facer
  until told otherwise (`0x427783`), so only `propisfacer (p, false)` changes
  what you see: then `propdeg` turns the picture and `proppitch` tilts it.
- **Flip.** `propflip` turns the picture half round: bit 1 on the heading, bit 2
  on the pitch.

This is how Cartagena's plank lies flat across the gap in the hold, and how the
lock's chain hangs straight from its hook. The port draws such a card by
following each screen pixel's ray to the picture's plane (`PropRuntime.cardOf`
and `cardTexel`), so what hides it is the depth of the card at that pixel, not
at its point.

**One part is taken on trust.** Which way the picture's right and down run for
a given heading is not followed through RedJack.exe's matrix. It is taken to be
the camera's own convention, which puts a facer square and unmirrored in front
of you: the one case that can be checked by eye.

`actoristrue3d` is kept too. No script calls `actorisfacer`, so every actor
stays a facer, which draws as the sprite it already was.

## What hides a sprite

**At a node,** the scenery's depth comes from the sphere's depth maps, drawn
through the same camera as its pictures: one distance per pixel. RedJack.exe's
placement looks at the depths under a sprite's rectangle (`0x436350` →
`0x497510`) and drops a sprite that is behind all of them (`0x42ce18`). The
frame pass then sends one that is behind only some of them through a depth
buffer (`0x4331a0` → `0x435d40`), a pixel at a time. A sprite pixel is not
drawn where the scenery under it is nearer than the sprite's depth along the
view, less its zclip.

**On film,** during a walk, a turn or a scene, the picture on the screen
carries its own depths behind its pixels
([the film's depth map](../formats/dreamfactory-5.md#the-film-s-depth-map)),
and the placement uses those instead (`0x4363bd` → `0x44c000`). This is how a
character on the Lizard Point porch stays behind its railing while you walk up.

## The fights' stage

The sword fights are a stage, not a room. `stageflat` is v5's `gotoflat` and
`currentflat` in one (the old ids have no handler in RedJack.exe), and the
fights keep their camera in the flat's name (`findword (stageflat (), " ", 2)`).

`stageorigin (x, y)` moves where the open stage's top-left is drawn, which the
fights use to shake the screen and follow a leap. A prop with `propsnap` on is
moved with it (`0x416420`). With no stage open, `stageorigin` does nothing
(`0x41573c`), and closing the stage puts the origin back to (0, 0).

## Colour

- **Brightness** is a number added to each colour channel of a sprite
  (`propbrightness`, `actorbrightness`) or the whole screen
  (`screenbrightness`), held to -255..255 (`0x40a7f0`). The tavern's bottles
  are lit with it, and the big fight turns the screen red when Nick is hit.
- **Contrast** is really a gamma. `screencontrast (c, c, c)` stores 128 − c,
  held to 0..256, and indexes a table (`0x46ecd0`) that maps a channel v to
  255 · (v / 255)^(m / (256 − m)). So 0 leaves the picture as it is and a
  positive number brightens it. The BOOTFILE's Brighter and Darker menu items
  step it by 5, in a debug menu the shipped game keeps hidden.

## Input

`spacebar ()` is the key held down now (`GetAsyncKeyState`), not a key press.
The chests and crates play their opening `while not spacebar ()`, so holding
space skips it. On a phone the page's SPACE button holds it for a moment.

Back to [the runtime](README.md).
