# The maze viewer

`/editors/mazes.html` — [`site/editors/maze-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/editors/maze-editor.ts)

The second page that only reads, after the [sprite book viewer](books.md). It
opens one of Lunicus's mazes — the station's two floors (`upperbas.`,
`lowerbas.`), the city and its building for days two to four (`citymaze.`,
`buildmaz.`), the two engine rooms, the hive and the final chamber — through the
reader the game itself uses, `readMazeV0` in
[`engine/src/df/maze-v0.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/maze-v0.ts)
([DreamFactory 0's containers](../engine/formats/dreamfactory-0.md)).

A maze is a grid of cells. You stand in one facing one of four ways, a *pose*, and
every step and every quarter turn between two poses is a short pre-rendered film.

## What it shows

**The view.** The picture from the pose you stand in: the first frame of a film
that leaves it, which is what the game shows at rest (0x4034fe). ⟲, ↑ and ⟳, or
the arrow keys, make the game's own moves: the transition from this pose to the
one the move asks for, and none means a wall (0x403420). A step plays its film's
frames 1 to 7 and a turn 1 to 6, three ticks of 60 Hz apart (0x40d200). Slow
motion plays them at a quarter of that. Beside the picture, the cell's four bytes,
the one the pose faces, and where each move goes and whose film it plays.

**The map.** The grid, north up, x across and y down (a step north is y − 1).
Each cell is a square and each wall a line on its side, coloured by the byte the
cell holds for that facing. The legend lists this maze's bytes, commonest first,
with how many sides have each. A click stands the view in that cell, facing the
same way when that pose has a view. Hovering shows the cell's bytes.

**The films.** Every film the maze owns, in container order: its first frame, its
length, and whether it is a step or a turn, with the transitions that borrow it.
A film is shared where two places look the same, so a maze stores fewer films
than transitions. A click stands the view where the film starts and plays it.

## The facing bytes

In every maze of the rip a cell's byte for a facing is 0 exactly where a step
forward leaves the cell. So a byte that is not 0 is the wall the pose faces, and
says what that wall is. It is what a click on the view acts on.
`engine/tests/df0-formats.ts` checks the fact over the whole rip. The values
mean different things in different places: an elevator on the base, a
building's door in the city. The page names the ones
[the format doc](../engine/formats/dreamfactory-0.md) lists from LUNICUS.EXE, and
shows the rest as numbers only.

## The palette

A maze carries none. The base, the city and every maze are drawn in the `CLUT128`
resource of `LUNIRES.DLL` (0x40a988), read by `readClutV0` in
[`engine/src/df/clut-v0.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/clut-v0.ts).
A maze picked from the Lunicus source fetches the DLL with it. An uploaded maze
can bring it along: drop the DLL on the page too, in the same drop or after.
Without it the view is drawn in a grey ramp, and the page says so.

## What it does not show

The game draws things over the view that are not in the maze: the crew, the
enemies, the panel beside the view. None of those are here.

## Why there is no export

Nothing writes a v0 maze. The other v0 files open read-only in their editors for
the same reason: an export with no round-trip test behind it would be a promise
the page cannot keep.
