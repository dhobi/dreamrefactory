# The script container on disk

*Prerequisite: [The DFile container format](README.md) and
[The scripting language](../03-scripting-language.md). This is the deepest
format doc — you only need it if you're working on the decoder itself.*

Scripts don't live in their own files. A script is **one container** inside
whatever file owns it — a SET, an STG, the BOOTFILE. This doc explains what
that container's bytes look like.

Reference implementation: [`src/df/script.ts`](https://github.com/dhobi/taoot-web/blob/master/src/df/script.ts), ported
from DFET's [`DFscript`](https://github.com/M3tox/DFET/blob/main/libs/DFfile/DFscript.cpp).

## First surprise: the script is *bigger* compiled than as text

You might expect a compiled script to be a compact stream of one-byte opcodes.
It isn't — the on-disk form is **larger** than the readable text. The reason is
**speed, not size**: the format is laid out so the 1996 engine could step
through it with almost no parsing. Every token is a fixed-width record it can
read in one go. It was already "interpreted" (tokenised) at build time.

## The token stream: fixed 8-byte segments

A script container is a sequence of **8-byte segments**, terminated by a zero
segment. Each segment is:

| Offset | Type | Field |
|-------:|------|-------|
| +0 | u16 | `cmd` — what kind of token this is |
| +2 | u32 | `info` — a value whose meaning depends on `cmd` |
| +6 | u16 | padding (always 0) |

So reading a script is just: walk 8 bytes at a time, and for each segment look
at `cmd`.

### The five kinds of token

Four `cmd` values are "special" (they carry data); everything else is a
**command or operator ID**:

| `cmd` | Kind | What `info` means |
|------:|------|-------------------|
| 3 | string literal | a **byte offset** from this segment to a Pascal string (stored later in the container) |
| 4 | integer literal | the integer value itself |
| 5 | variable name | like a string — an offset to the variable's name |
| 6 | line break | the **indent level** (in tabs) — cosmetic, for pretty-printing |
| *anything else* | a command / operator | the value **is** the command ID |

This is why DFET's notes say strings "are defined at the bottom of the
container": literals and variable names are stored as a **string pool** after
the token stream, and the tokens just point into it by offset. Integers, being
fixed-size, sit right in the `info` field.

```mermaid
flowchart LR
  subgraph Container
    T["token stream<br/>(8-byte segments)"]
    P["string pool<br/>(pascal strings)"]
  end
  T -- "cmd 3 / 5: info = offset →" --> P
```

## Command IDs: the opcode table

When `cmd` isn't 3/4/5/6, it's an **opcode** — a number naming a built-in
command or operator. The IDs are banded by purpose:

| Band | Purpose | Examples |
|------|---------|----------|
| 4xxx | control flow / syntax | `code`, `if`, `switch`, `case`, `exitcode`, `passcode`, `me`, `target` |
| 8xxx | operators | `+` `-` `*` `/`, `&` `\|`, `@` (concat), `=` `!=` `>` `<` |
| 12xxx | actions | `delay`, `makeloop`, `playmovie`, `voicesound`, `opensetfile`, `sendtoprop` |
| 16xxx | property get/set | `propxy`, `propview`, `propvisible`, `currentscene`, `setvisible` |
| 20xxx | queries / functions | lookups and computed values |
| 24xxx | visual transitions | screen fades and wipes |

The full table (~351 entries) is the `OPCODES` map in
[`script.ts`](https://github.com/dhobi/taoot-web/blob/master/src/df/script.ts). It originally came from DFET's
[`DFscript.h`](https://github.com/M3tox/DFET/blob/main/libs/DFfile/DFscript.h),
and was then **validated byte-for-byte against `TI.EXE`**: the
executable contains a plaintext table of 6-byte records `{ char* name, u16 id
}` mapping every command name to its ID. The tool that extracts that table is
[`tools/exetable.ts`](https://github.com/dhobi/taoot-web/blob/master/tools/exetable.ts).

> **Names vs. behaviour — the crucial gap.** Having the ID→name table means we
> can *decompile* a script into readable text. It does **not** tell us what
> each command *does*. `propxy` is command 16018 — but *how* it places a prop
> had to be recovered from the disassembly. Recovering these per-command
> semantics, one at a time, is the bulk of the reverse-engineering work; the
> [scripting doc](../03-scripting-language.md) explains where they land
> (the interpreter's builtin registry).

## From bytes to a running script

The pipeline, end to end:

```mermaid
flowchart LR
  BYTES["script container<br/>(8-byte segments + string pool)"]
  --> DEC["script.ts<br/>decode → token list"]
  --> PARSE["parser.ts<br/>tokens → syntax tree"]
  --> INTERP["interp.ts<br/>run it"]
```

1. **[`script.ts`](https://github.com/dhobi/taoot-web/blob/master/src/df/script.ts)** turns the container's bytes into a
   flat list of `Token`s (and can decompile them straight back to text).
2. **[`parser.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/parser.ts)** turns the token list into an
   abstract syntax tree, tolerating the original compiler's quirks (see the
   [scripting doc](../03-scripting-language.md#values-operators-and-quirks)).
3. **[`interp.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/interp.ts)** executes the tree.

The parser handles **100%** of the shipped scripts — on the order of 1,000
script containers and ~2,900 `code` blocks — which is the main evidence that
the format above is understood correctly.

## Related tools

- `tools/dumpscripts.ts` — decompile every script in a file back to text, plus
  an opcode-frequency count.
- `tools/parsecheck.ts` — run the parser over the whole corpus and report
  coverage.
- `tools/exetable.ts` — extract the command-name → ID table from `TI.EXE`.

Back to the [format index](README.md), or on to the last format —
**[PUP & CST characters](pup-cst.md)**.
