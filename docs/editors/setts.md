# The sett editor

[`site/editors/setts.html`](https://github.com/dhobi/dreamrefactory/blob/master/site/editors/setts.html) — source
[`site/editors/sett-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/editors/sett-editor.ts).
Open `http://localhost:5173/editors/setts.html`.

RedJack's rooms, the [SETT](../engine/formats/sett.md). Load one by upload,
drag-and-drop, or from the RedJack source's list, grouped by disc. It opens where
the room opens, at MAPR's first node or scene.

## What it shows

| Part | What you can do with it |
|------|-------------------------|
| the **view** | At a node, the sphere drawn through the page's own camera: drag to look round, the wheel to zoom, ← and → to turn. Its exits are the films of the roads that leave it, numbered as `launchexit` numbers them; walking one plays the film at the game's pace (`framerate (2)`) and stands at the far end looking the way it ended. In a scene, ⟲ ⟳ turn on its two films to the next view and ↑ walks the road ahead. The quads are outlined over the picture, and a click on one picks it |
| the **map** | The room from above: nodes, scenes, the roads as their films walk the camera, the quads edge on, the stars and their routes, and you with what you see. A click on a place goes there; on a quad or a star, picks it |
| the **quads** | Rename one, move it, turn and pitch it (in degrees; the file keeps radians), resize it. The outline in the view and the map follow |
| the **stars** | Rename one and move it. A star that ends a route says so |
| the **scripts** | The room's main script, each node's, each scene's and each quad's, decompiled on demand (read-only) |

What the room's scripts do as you arrive is not run: no props, no actors, no
camera turned for you. So a frame that has no picture of its own is black, as
darts' first scene is, and the page says so.

## Exporting

**Export .sett** downloads the room with the edits in it. It is not repacked. The
container writer does not keep a v5 room's padding, so `patchQuad` and
`patchStar` in
[`engine/src/df/sett-patch.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/sett-patch.ts)
write each edit over the bytes the reader took it from. Every other byte stays as
it was, which `engine/tests/df5-room.ts` checks on every room in the rip.

The names are 15 characters at most: each is a pstr in a 16-byte field. Two
things are not followed for you:

- A renamed quad is one the room's scripts no longer find by its old name.
- A moved star leaves the route that ends on it where it was.

## See also

- [SETT — rooms, nodes and spheres](../engine/formats/sett.md): what the structures are
- [DreamFactory 5's rooms at run time](../engine/runtime/rooms-v5.md): what the game does with them
- [The browser editors](README.md): what the pages share
