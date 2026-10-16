<script setup lang="ts">
/**
 * <ArchMap> — the repository from the system down to a class, read out of the
 * code (docs/engine/architecture-map.md).
 *
 * The data is tools/archmap.mts's, written before every docs:dev and docs:build
 * and loaded only on this page; the drawing is ./app.ts, which needs a DOM, so
 * the page puts this inside <ClientOnly>.
 */
import { onBeforeUnmount, onMounted, ref } from "vue";

const root = ref<HTMLElement | null>(null);
let unmount: (() => void) | undefined;

onMounted(async () => {
  const [{ mount }, dagre, data] = await Promise.all([import("./app"), import("dagre"), import("./data.json")]);
  if (root.value) unmount = mount(root.value, data.default, dagre.default ?? dagre);
});
onBeforeUnmount(() => unmount?.());
</script>

<template>
<div class="am-root" ref="root">
  <header>
    <div class="am-title">Architecture map <small data-am="gen"></small></div>
    <nav class="crumbs" data-am="crumbs" aria-label="Where you are"></nav>
    <div class="search">
      <input data-am="q" type="search" placeholder="Find a file, class or folder" autocomplete="off" aria-label="Find a file, class or folder">
      <div class="results" data-am="results" hidden></div>
    </div>
  </header>
  <main>
    <div class="board" data-am="board">
      <svg data-am="svg" role="img" aria-label="Architecture diagram"><defs>
        <marker id="am-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--muted)"></path></marker>
        <marker id="am-tri" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="11" markerHeight="11" orient="auto-start-reverse"><path d="M0,0 L12,6 L0,12 z" fill="var(--surface)" stroke="var(--muted)" stroke-width="1.2"></path></marker>
      </defs><g data-am="vp"></g></svg>
      <div class="level" data-am="level"></div>
      <div class="tabs" data-am="tabs"></div>
      <div class="legend" data-am="legend"></div>
      <button class="open" data-am="openbtn" hidden></button>
      <div class="zoom"><button data-am="zin" aria-label="Zoom in">+</button><button data-am="zout" aria-label="Zoom out">−</button><button data-am="zfit" aria-label="Fit to screen">⤢</button></div>
    </div>
    <aside data-am="panel" aria-live="polite"></aside>
  </main>
</div>
</template>

<style>
.am-root {
  /* the docs theme's own colours and fonts (VitePress's --vp-* variables), so the
     map follows its light and dark modes */
  --bg: var(--vp-c-bg-alt);
  --board: var(--vp-c-bg-soft);
  --surface: var(--vp-c-bg);
  --ink: var(--vp-c-text-1);
  --muted: var(--vp-c-text-2);
  --line: var(--vp-c-divider);
  --grid: var(--vp-c-gutter);
  --accent: var(--vp-c-brand-1);
  --c-engine: var(--vp-c-brand-1);
  --c-game: var(--vp-c-warning-1);
  --c-site: var(--vp-c-tip-1);
  --c-tools: var(--vp-c-purple-1, var(--vp-c-indigo-1));
  --c-ext: var(--vp-c-text-3);
  --c-docs: var(--vp-c-yellow-1, var(--vp-c-warning-2));
  --hl: var(--vp-c-danger-1);
  --font-display: var(--vp-font-family-base);
  --font-body: var(--vp-font-family-base);
  --font-mono: var(--vp-font-family-mono);
}
.am-root, .am-root * { box-sizing: border-box; }
.am-root { display: grid; grid-template-rows: auto 1fr; height: calc(100vh - var(--vp-nav-height) - 24px); min-height: 520px; padding-inline: 16px; padding-block: 12px; gap: 10px; background: var(--bg); color: var(--ink); font-family: var(--font-body); font-size: 14px; line-height: 1.5; }
.am-root header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 20px; }
.am-root .am-title { font-family: var(--font-display); font-weight: 700; font-size: 20px; margin: 0; letter-spacing: -0.01em; }
.am-root .am-title small { font-family: var(--font-mono); font-weight: 400; font-size: 11px; color: var(--muted); margin-left: 8px; letter-spacing: 0; }
.am-root nav.crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; font-family: var(--font-mono); font-size: 12.5px; min-width: 0; flex: 1 1 300px; }
.am-root nav.crumbs button { background: none; border: 0; padding: 3px 6px; border-radius: 4px; color: var(--accent); font: inherit; cursor: pointer; }
.am-root nav.crumbs button:hover, .am-root nav.crumbs button:focus-visible { background: var(--surface); outline: none; }
.am-root nav.crumbs button[aria-current] { color: var(--ink); font-weight: 500; cursor: default; }
.am-root nav.crumbs .sep { color: var(--muted); }
.am-root .search { position: relative; flex: 0 1 280px; min-width: 180px; }
.am-root .search input { width: 100%; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink); font: 13px var(--font-body); }
.am-root .search input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.am-root .results { position: absolute; z-index: 5; top: calc(100% + 4px); left: 0; right: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; max-height: 340px; overflow: auto; box-shadow: 0 8px 24px rgb(0 0 0 / 0.15); }
.am-root .results button { display: block; width: 100%; text-align: left; background: none; border: 0; padding: 6px 10px; color: var(--ink); font: 13px var(--font-body); cursor: pointer; }
.am-root .results button:hover, .am-root .results button.on { background: var(--bg); }
.am-root .results .k { font: 10.5px var(--font-mono); color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-right: 6px; }
.am-root .results .p { display: block; font: 11px var(--font-mono); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.am-root main { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 10px; min-height: 0; }
@media (max-width: 860px) { .am-root main { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(420px, 62vh) auto; } .am-root { height: auto; } }
.am-root .board { position: relative; background: var(--board); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; min-height: 0;
  background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px); background-size: 24px 24px; }
.am-root .board svg { width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; user-select: none; }
.am-root .board svg.dragging { cursor: grabbing; }
.am-root .level { position: absolute; top: 10px; left: 12px; font: 11px var(--font-mono); color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; pointer-events: none; }
.am-root .level b { color: var(--ink); font-weight: 500; }
.am-root .tabs { position: absolute; top: 8px; right: 12px; display: flex; gap: 4px; }
.am-root .tabs button, .am-root .zoom button { border: 1px solid var(--line); background: var(--surface); color: var(--ink); font: 12px var(--font-body); padding: 4px 10px; border-radius: 5px; cursor: pointer; }
.am-root .tabs button[aria-pressed="true"] { background: var(--ink); color: var(--surface); border-color: var(--ink); }
.am-root .zoom { position: absolute; bottom: 10px; right: 12px; display: flex; gap: 4px; }
.am-root .zoom button { width: 32px; padding: 4px 0; font-family: var(--font-mono); }
.am-root .tabs button:focus-visible, .am-root .zoom button:focus-visible, .am-root aside button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.am-root .open { position: absolute; left: 50%; transform: translateX(-50%); bottom: 46px; z-index: 3; border: 0; border-radius: 999px; background: var(--hl); color: #fff; font: 600 14px var(--font-body); padding: 9px 18px; box-shadow: 0 4px 14px rgb(0 0 0 / 0.25); cursor: pointer; max-width: calc(100% - 32px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.am-root .open:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.am-root .legend { position: absolute; bottom: 10px; left: 12px; display: flex; flex-wrap: wrap; gap: 4px 12px; font: 11px var(--font-mono); color: var(--muted); max-width: calc(100% - 140px); pointer-events: none; }
.am-root .legend span { display: inline-flex; align-items: center; gap: 5px; }
.am-root .legend i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; border: 1.5px solid currentColor; }
.am-root aside { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 16px 18px; overflow: auto; min-height: 0; min-width: 0; }
.am-root aside .eyebrow { font: 11px var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.am-root aside h2 { font-family: var(--font-display); font-weight: 700; font-size: 19px; margin: 2px 0 8px; text-wrap: balance; overflow-wrap: anywhere; }
.am-root aside p { margin: 0 0 12px; max-width: 65ch; }
.am-root aside .path { font: 12px var(--font-mono); color: var(--muted); overflow-wrap: anywhere; margin-bottom: 10px; }
.am-root aside dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 14px; margin: 0 0 14px; font-size: 13px; }
.am-root aside dt { color: var(--muted); }
.am-root aside dd { margin: 0; font-variant-numeric: tabular-nums; font-family: var(--font-mono); font-size: 12.5px; }
.am-root aside h3 { font: 600 12px var(--font-body); text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); margin: 16px 0 6px; }
.am-root aside ul { list-style: none; margin: 0; padding: 0; }
.am-root aside li { padding: 2px 0; font-size: 13px; overflow-wrap: anywhere; }
.am-root aside li button.link { background: none; border: 0; padding: 0; color: var(--accent); font: inherit; cursor: pointer; text-align: left; }
.am-root aside li button.link:hover { text-decoration: underline; }
.am-root aside li .n { color: var(--muted); font: 11.5px var(--font-mono); margin-left: 6px; }
.am-root aside code, .am-root aside .mono { font-family: var(--font-mono); font-size: 12.5px; }
.am-root .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 12px; }
.am-root .actions button, .am-root .actions a { border: 1px solid var(--accent); background: var(--accent); color: var(--surface); font: 500 13px var(--font-body); padding: 5px 12px; border-radius: 5px; cursor: pointer; text-decoration: none; }
.am-root .actions a { background: none; color: var(--accent); }
.am-root .member { font: 12px var(--font-mono); }
.am-root .member .t { color: var(--muted); }
.am-root .hint { color: var(--muted); font-size: 12.5px; }
.am-root svg text { font-family: var(--font-body); }
.am-root .node rect.box { fill: var(--surface); stroke-width: 1.5; }
.am-root .node.stub rect.box { fill: var(--board); stroke-dasharray: 5 4; }
.am-root .node .title { font-weight: 600; font-size: 13px; fill: var(--ink); }
.am-root .node .sub { font-size: 11px; fill: var(--muted); font-family: var(--font-mono); }
.am-root .node .mem { font-size: 11px; fill: var(--ink); font-family: var(--font-mono); }
.am-root .node .mem.t { fill: var(--muted); }
.am-root .node .tag { font-size: 9.5px; font-family: var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; }
.am-root .node { cursor: pointer; }
.am-root .node:hover rect.box, .am-root .node.sel rect.box { stroke-width: 2.5; }
.am-root .node.sel rect.box { stroke: var(--hl) !important; }
.am-root .node:focus-visible { outline: none; }
.am-root .node:focus-visible rect.box { stroke: var(--hl) !important; stroke-width: 3; }
.am-root .edge path { fill: none; stroke: var(--muted); stroke-opacity: 0.55; }
.am-root .edge.ext path { stroke-dasharray: 2 4; }
.am-root .edge text { font: 10.5px var(--font-mono); fill: var(--muted); paint-order: stroke; stroke: var(--board); stroke-width: 4px; }
.am-root svg.focus .node:not(.near) { opacity: 0.25; }
.am-root svg.focus .edge:not(.near) { opacity: 0.08; }
.am-root svg.focus .edge.near path { stroke: var(--hl); stroke-opacity: 0.9; }
@media (prefers-reduced-motion: no-preference) { .am-root .node, .am-root .edge { transition: opacity 120ms; } }

</style>
