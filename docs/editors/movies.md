# The movie editor

[`site/editors/movies.html`](https://github.com/dhobi/dreamrefactory/blob/master/site/editors/movies.html) — source
[`site/editors/mov-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/editors/mov-editor.ts).
Open `http://localhost:5173/editors/movies.html`.

Mostly an **inspector**, and the only editor whose art is read-only. Load a
[MOV](../engine/formats/mov.md) and it shows the thing the format doc describes and
nothing in the port could previously display: a movie is not a video, it is a
**state machine of frames**, each of which either takes an action or waits for a
click — and a *file* is a **chain of those machines**, which is why the page has a
segment picker and why every edit is addressed to the segment it was made in.

## What it shows

| Part | What you can do with it |
|------|-------------------------|
| the **segment picker** | a film is a **chain of segments** ([MOV](../engine/formats/mov.md#a-file-is-a-chain-of-segments)), and this is where you move between them — each option gives its frame count and the container its header sits at, which is the index every location inside it is relative to. Hidden when the file has only one. Switching restarts the decode chain and the frame cursor, because each segment's frames are delta-encoded against a fresh buffer, exactly as the player treats them |
| the **picture** | scrub any frame, step through, or **▶ Follow the machine** — which plays at the film's **own authored pace** (`frameHoldMs`, the same rule the game uses; see [pacing](../engine/formats/mov.md#a-movie-carries-its-own-pacing)) and stops where the movie itself stops: on a frame with regions, saying so, because that frame waits for a click |
| **clicking it** | does what the movie would do with that click. A region's type 2 really jumps to its target frame; an exit or a chain to another file is reported, since there is no sequence here to leave. A click outside every region does nothing, exactly as in game |
| the **frame list** | every frame with its action, its outgoing edges (`→target`, `⇒event`, exit), its entry sound and whether it is an action frame — filterable, and "only frames that wait" reduces a 300-frame cutscene to the handful that are interactive |
| a **frame's logic** | its name, its action code, and the three names it carries (entry sound, chained movie, target frame). A frame with no logic container says so: it is a plain animation frame, and there is nowhere to put an action |
| the **regions** | action code, rectangle and the same three names, with the rectangles drawn over the picture; **▶ take it** does the click without aiming |
| the **movie** | the two **action-frame** slots — what `actionframe(1)`/`actionframe(2)` report having passed through, which is what `PLAYMODE.MOV` uses to decide `tour` — and the **ESC aborts** flag (header bit 0, set by all 218 shipped movies). Both are the **showing segment's**: each header in the chain carries its own pair and its own flags word, and the engine reads the playing segment's |
| the **audio** | every chunk, playable, labelled by which table it came from: the loop table is a *bed* played under the whole movie, the one-shot block is the movie's **event sounds** fired by a frame or a region. A later segment that starts no bed of its own says so — it keeps playing the one before it |
| the **pacing note** | what the player will do with this segment, in the same words the rule is written in: the ms-per-frame and fps its holds work out to, whether a soundtrack is a *bed* far longer than the picture, and whether the frames jump backwards (a picture authored as a loop). It comes from the shared [`mov-pace.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/mov-pace.ts) rather than a second copy, which is exactly what it is for — the editor used to preview everything at the native rate while the player paced a cutscene off its soundtrack, so what you watched here was not what the game would do |

## A name is a string, not a link

Renaming a frame does not retarget the jumps that named it, so the page counts
them and says which are now broken, action-frame slots included. The count is
taken **within the segment**, which is the right scope rather than a convenience:
a jump's `target` names a frame of the segment it is in, and the action-frame
slots are that segment's own.

## Why the art is read-only

**Frames are delta-encoded in one chain, per segment.** That is why showing
frame N decodes 0…N of the segment on screen (going back replays the chain from
its start, and switching segments starts a new one), and why there is no art
import: a replaced frame would leave everything after it decoding against a
picture that no longer exists.

[`taoot/tests/auto/mov-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/mov-editor.ts)
pins that rather than asserting it — it hand-builds a frame that holds the
picture before it (row mode 10, the mode our own encoder never emits) and shows
the swap changing what that frame decodes to. A single frame *can* still be
exported as a PNG.

## Exporting

**Export .mov** repacks the container file and downloads it. Every edit is a
copy-on-write patch on one container — the frame names and the header fields in
**the showing segment's header container**, a frame's action and its regions in
that frame's own logic container (`patchFrameName`, `patchFrameLogic`,
`patchRegionLogic`, `patchRegionRect`, `patchActionFrames`, `patchKeySkips` in
[`engine/src/df/mov.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/mov.ts)) —
so everything you did not touch is the byte it was.

Each of those takes a `MovSegment`, not the file. That is what makes reaching a
later segment safe: the patches used to hardcode container 0, which is only the
*first* segment's header, so an edit made while looking at segment 3 wrote its
frame name into segment 0's table at the same record offset and silently renamed
an unrelated frame. A single-segment movie patches exactly where it always did,
because a `MovFile` **is** its first segment.

## See also

- [MOV — movies & inspectable objects](../engine/formats/mov.md) — what the structures are
- [The browser host](../engine/runtime/host.md) — the movie player the game plays these with
- [The browser editors](README.md) — what the seven pages share

