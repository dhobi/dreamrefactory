# The puppet editor

[`site/editors/puppets.html`](https://github.com/dhobi/dreamrefactory/blob/master/site/editors/puppets.html) — source
[`site/editors/puppet-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/editors/puppet-editor.ts).
Open `http://localhost:5173/editors/puppets.html`.

A character has two files, and this is the **brains** half — the conversation.
(The [cast editor](casts.md) has the body.) Load a
[PUP conversation puppet](../engine/formats/pup-cst.md) by upload, drag-and-drop, or
straight from the `gamefiles/` manifest, and it takes the file apart into its
editable parts.

## What it shows

| Part | What you can do with it |
|------|-------------------------|
| the **stances** | every stance's 11 sprite layers with per-frame art: export as PNG, replace from PNG (pixels are matched to the puppet's palette) |
| the **anchors** | the frames' stored anchor offsets |
| the **dialogue table** | editable subtitle text, with voice and animLogic playback |
| the **scripts** and **palette** | the decompiled scripts (read-only) and the puppet's palette |

**The preview follows the line, not the stance picker.** Pick a line and the
composite (and *Play line*) uses the stance that line names in its own record —
which is what the engine does, and the only way a two-character puppet
(`WILZEIT1.PUP`) shows the right mouth moving on the right face
([why](../engine/formats/pup-cst.md#stances-and-animation-logic-the-face-as-11-layers)).
The **stance** picker is for browsing the art: it drives the layer list below, and
the preview only when no line is selected.

**The dialogue table depends on the language picker.** No puppet file records the
character set its subtitles are stored in
([why](../taoot/languages.md#the-code-page-is-not-in-the-data)), so the page
resolves one from the 🌐 picker at start-up and uses it both for what the list shows
and for what an edit writes back. A German file read as English text shows `muß` as
`mu§`; saved from that state it would write back what it displayed. An edit is
re-encoded and clamped to the record's **255 bytes** — not characters — so a
Shift-JIS line can neither overflow the field nor end half a character in.

## Exporting

**Export .pup** repacks the container file (`writeContainerFile` in
[`engine/src/df/container.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/container.ts))
and downloads the result; untouched parts round-trip byte-identically
(see [`taoot/tests/auto/pup-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/pup-editor.ts)).

## See also

- [PUP & CST — characters ("puppets")](../engine/formats/pup-cst.md) — what the structures are
- [Characters](../engine/runtime/characters.md) — how the runtime plays a conversation
- [The cast editor](casts.md) — the other half of a character
- [The browser editors](README.md) — what the seven pages share

