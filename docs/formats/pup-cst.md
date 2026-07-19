# PUP & CST — characters ("puppets")

*Prerequisite: [The DFile container format](README.md),
[The image codec](image-codec.md), and [SET](set.md).*

> **Status: documented, not yet ported.** The engine doesn't run characters
> yet. This doc records what's known from
> [DFET's `FileInfos.md`](https://github.com/M3tox/DFET/blob/main/FileInfos.md)
> and the format headers so the work is ready to pick up. There's no
> `src/df/pup.ts` or `cst.ts` yet; DFET's
> [`DFpup`](https://github.com/M3tox/DFET/blob/main/libs/DFfile/DFpup.h) /
> [`DFcst`](https://github.com/M3tox/DFET/blob/main/libs/DFfile/DFcst.h) are
> the reference.

CyberFlix called the game's characters **puppets**. A character you can
interact with is split across **two** file types that work together:

| File | Holds |
|------|-------|
| **.PUP** | the "brains" — dialogue text, conversation logic (scripts), voice audio, and facial-animation frames + timing |
| **.CST** | the "body" — the character's exterior sprites and animations (walking, idle, …) at various scales |

## Why two files?

Because they answer two different questions. The **PUP** is everything about
*talking to* a character: what they say, how the conversation branches, the
audio for each line, and how the face animates while speaking. The **CST**
("cast") is everything about *seeing* a character move around the room: the
sprite art, drawn on top of the SET background like any other moving thing.

## PUP — dialogue, voice, and faces

A puppet file contains:

- **Dialogue text** — the lines needed to talk to the character.
- **Conversation logic** — [scripts](../03-scripting-language.md) (the same
  language as everything else) that decide how the conversation branches.
- **Voice audio** — the recorded lines, and per-text-element a table that
  drives the **facial animation** so the mouth matches the words.
- **Facial-animation frames** — the face images. DFET notes there are
  surprisingly *many unused ones*.

Notably, a PUP does **not** contain the character's body/exterior model —
that's the CST's job.

### The "1" and "2" split

In TAOOT each character has **two** puppet files. A `1` in the filename means
**before** the sinking; a `2` means **during** the sinking. This wasn't a
design choice about story so much as a **distribution** one: the game shipped
on two CDs, and the split let each CD carry the puppets it needed.

## CST — the body that scales with distance

A cast file holds the character's **exterior sprites**: sets of images at
different sizes so the character can be drawn **larger up close and smaller far
away** as they (or you) move around the room.

Here's where it connects back to [SET](set.md): choosing the right sprite scale
— and deciding whether the character is even *visible* at a given spot — uses
the SET frame's **[Z depth layer](image-codec.md#the-z-layer-a-hidden-depth-map)**.
The engine compares the character's distance against the depth map so that
scenery closer to the camera (a chair, a doorway) correctly **hides** the
character behind it. The pre-rendered world and the live characters share one
depth model; that's what keeps a walking puppet from floating in front of
furniture it should be behind.

## Related structures in the SET

A SET already carries **actor** placement markers (`Actor` in
[`set.ts`](https://github.com/dhobi/taoot-web/blob/master/src/df/set.ts)) — position and facing for where characters
belong. The boot library's `setupactor` / `putdownactor` handlers, plus the
`opencastfile` / `openpuppetfile` and `sendtoactor` / `sendtopuppet` commands
(all in the [opcode table](script-container.md#command-ids-the-opcode-table)),
are the script-side hooks that will drive puppets once the loaders exist.

## When this gets built

The natural order, following the milestones so far, is: parse the CST sprites
and PUP dialogue tables, wire `openpuppetfile` / `opencastfile`, drive facial
animation off the per-line tables, and depth-test sprites against the SET Z
layer for correct occlusion and scaling. Until then, characters are the main
missing piece between "you can walk the ship" and "you can play the game."

Back to the [format index](README.md) or the
[documentation home](../README.md).
