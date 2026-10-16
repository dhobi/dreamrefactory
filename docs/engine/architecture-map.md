---
layout: page
title: Architecture map
---

<ClientOnly>
  <ArchMap />
</ClientOnly>

<div class="am-about">

The repository from the system down to a class, read out of the code by
[`tools/archmap.mts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/archmap.mts)
each time these docs are built, so it is always the code they were built from.
What each workspace and folder is for is written down in
[`tools/archmap-notes.ts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/archmap-notes.ts);
a file or a class is described by its own first doc comment.
[Engine architecture](architecture.md) says in prose which way the packages
point and why.

</div>

<style>
.am-about { max-width: 720px; margin: 24px auto 48px; padding-inline: 24px; color: var(--vp-c-text-2); }
</style>
