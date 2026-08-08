# The cast editor

[`editors/casts.html`](https://github.com/dhobi/taoot-web/blob/master/editors/casts.html) — source
[`editors/cst-editor.ts`](https://github.com/dhobi/taoot-web/blob/master/editors/cst-editor.ts).
Open `http://localhost:5173/editors/casts.html`.

The other half of a character: the [puppet editor](puppets.md) has the brains,
this has the **body**. Load a [CST cast](../formats/pup-cst.md) — `GANG.CST` is
the 25 named story characters, `EXTRA.CST` the background passengers — and it
comes apart into members → poses → sprites.

## What it shows

| Part | What you can do with it |
|------|-------------------------|
| a **member** | pick one and rename them. This *is* a lookup key — `actorpose`/`sendtoactor`, and a SET's actor marks, all reach a character by this name — so renaming a story character means renaming them across the corpus |
| their **poses** | `stand`, `walk`, `standlj`…, filterable, each badged **stand** (one step) or **cycle** (several), with its step count, sprite count and how many of the 8 directions are missing. Rename one: `actorpose()` matches it lowercased and falls back to pose 0, so a typo freezes an actor rather than crashing them |
| the **sprite grid** | the selected pose as rows of steps × the 8 stored directions (0 = facing the viewer). A direction the pose does not carry shows as a dash rather than silently falling back the way the runtime does |
| the **preview** | an actor is a *world-space* sprite: it draws at its projected world point minus its stored offset, **both scaled** by `k = actorscale × refScale / (1000 × depth)` (`ActorRuntime.rect`). The cross is that world point and **k** is a field, so the two effects can be seen apart — at k=0.5 the figure is half the size *and* half as far below the cross, which is why feet stay on the floor at any distance. The canvas is the 512×384 screen **plus however far the pose reaches outside it**, with the overhang filled flatter and darker and the screen's own edge outlined where it falls: a cast sprite is anchored at the actor's feet, so its stored offset is very nearly its full height (`GANG.CST`'s tallest frame is 392 px with the anchor at 383, against a world point at y=300), and at k=1 the head used to be above y=0 where the canvas simply ended — 83 px of it, and 71 for `EXTRA.CST`. The overhang is measured over the whole **pose**, not the frame on show, so stepping or walking a cycle does not resize the canvas between frames |
| **▶ Walk the cycle** | cycles the pose's steps in the selected direction at the 50 ms service tick, looping — which is what a walk does: the scheduler advances the step every tick for as long as the walk runs |
| a **sprite** | its stored offset, its depicted angle (direction × 32 in the engine's 0..255 space) and its refScale; export it as a transparent PNG, or replace it — one direction of one step at a time, which is the granularity the file stores |
| the **scripts** and **palette** | every member's script (`setupactor`/`idle`/`mousedown`), decompiled on demand, and the file's own 256 colours |

## The eight directions are positions, not camera angles

Which of the eight sprites you see is *not* a function of where the camera looks
but of where it stands: the runtime takes the actor's facing relative to the
**bearing from the actor to the camera**. So the grid's directions are what a
viewer sees from eight positions around a character, not eight camera angles.

## Exporting

**Export .cst** repacks the container file and downloads it. Both names are
copy-on-write patches on the member's own logic container (`patchMemberName`,
`patchPoseName` in
[`src/df/cst.ts`](https://github.com/dhobi/taoot-web/blob/master/src/df/cst.ts)),
and a sprite's anchor goes through `patchFrameAnchor` in
[`src/df/shp.ts`](https://github.com/dhobi/taoot-web/blob/master/src/df/shp.ts) —
a cast sprite *is* a SHP frame, header and all — so everything you did not touch
is the byte it was
(see [`tests/auto/cst-editor.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/cst-editor.ts)).

## See also

- [PUP & CST — characters ("puppets")](../formats/pup-cst.md) — what the structures are
- [Characters](../runtime/characters.md) — actors in the world
- [The puppet editor](puppets.md) — the other half of a character
- [The browser editors](README.md) — what the seven pages share

