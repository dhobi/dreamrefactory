<script setup lang="ts">
/**
 * <ByteMap> — an offset table you can also LOOK at.
 *
 * Every format page in this doc set describes bytes with a table: offset, type,
 * field, meaning. A table is the right thing when you are implementing a reader
 * and the wrong thing when the question is "what is this file mostly made of?",
 * because a table gives every row the same weight whether it covers four bytes
 * or four megabytes. So this renders the SAME region list two ways and lets the
 * reader switch:
 *
 *   - TABLE — the offset table, unchanged in kind from the ones written by hand.
 *   - BLOCK — byte 0 at the top left, one row worth `rowBytes`, every region a
 *     block as wide as it is big, hover for what it is for.
 *
 * The table view is not a fallback, it is the other half: it is what a keyboard
 * reads, what the site's search indexes, what survives a printout, and the
 * relief the palette's light-mode contrast warning asks for.
 *
 * Usage in markdown:
 *   <ByteMap layout="df-header" />          <- a hand-authored struct layout
 *   <ByteMap map="lnghall.set" />           <- a real file, mapped by tools/blockmap.ts
 *   <ByteMap map="lang.stg" view="table" /> <- opening on the table instead
 */
import { computed, onMounted, ref } from "vue";
import { LAYOUTS } from "./layouts";
import {
  KINDS,
  autoRowBytes,
  fillHoles,
  hexOffset,
  humanBytes,
  type ByteKind,
  type ByteMapData,
  type ByteRegion,
} from "./schema";

const props = withDefaults(
  defineProps<{
    /** key into {@link LAYOUTS} — a hand-authored struct */
    layout?: string;
    /** basename of a generated map under `maps/` (without `.json`) */
    map?: string;
    /** which view to open on */
    view?: "block" | "table";
    /** override the row size in bytes (the auto choice is usually right) */
    rowBytes?: number;
  }>(),
  { view: "block" },
);

/**
 * Generated maps load LAZILY, one Vite chunk each.
 *
 * They were eager at first, which server-rendered the table view into the static
 * HTML — nice for the search index — but an eager glob is one module the theme
 * imports, so every page of the site carried every map. That is 214 KB today and
 * grows with each format documented, to serve one page that wants 24 KB of it.
 * So: a page loads the map it names and nothing else, and the table view is a
 * hydrated view rather than a rendered one. Hand-authored struct layouts stay
 * eager — they are a few hundred bytes and they ARE the prose.
 */
const MAP_LOADERS = import.meta.glob<{ default: ByteMapData }>("./maps/*.json");

const loaded = ref<ByteMapData | null>(null);
const pending = ref(false);

const data = computed<ByteMapData | null>(() =>
  props.layout ? LAYOUTS[props.layout] ?? null : loaded.value,
);

const regions = computed<ByteRegion[]>(() =>
  data.value ? fillHoles(data.value.regions, data.value.total) : [],
);

const rowBytes = computed(() =>
  props.rowBytes ?? data.value?.rowBytes ?? autoRowBytes(data.value?.total ?? 1024),
);

/** one row per `rowBytes`, each carrying the slices of the regions crossing it */
interface Slice {
  index: number;
  leftPct: number;
  widthPct: number;
  first: boolean;
  last: boolean;
}
const rows = computed(() => {
  const total = data.value?.total ?? 0;
  const per = rowBytes.value;
  const out: { at: number; slices: Slice[] }[] = [];
  for (let at = 0; at < total; at += per) out.push({ at, slices: [] });
  regions.value.forEach((r, index) => {
    const end = r.at + r.size;
    const firstRow = Math.floor(r.at / per);
    const lastRow = Math.floor((end - 1) / per);
    for (let row = firstRow; row <= lastRow && row < out.length; row++) {
      const rowStart = row * per;
      const from = Math.max(r.at, rowStart);
      const to = Math.min(end, rowStart + per);
      out[row].slices.push({
        index,
        leftPct: ((from - rowStart) / per) * 100,
        widthPct: ((to - from) / per) * 100,
        first: from === r.at,
        last: to === end,
      });
    }
  });
  return out;
});

/** legend: the kinds actually present, with what share of the bytes they hold */
const legend = computed(() => {
  const bytes = new Map<ByteKind, number>();
  for (const r of regions.value) bytes.set(r.kind, (bytes.get(r.kind) ?? 0) + r.size);
  const total = data.value?.total || 1;
  return (Object.keys(KINDS) as ByteKind[])
    .filter((k) => bytes.has(k))
    .map((k) => {
      const share = ((bytes.get(k) ?? 0) / total) * 100;
      // "0%" beside a legend swatch reads as a bug rather than as a proportion
      return { kind: k, ...KINDS[k], share: share < 0.5 ? "<1%" : `${Math.round(share)}%` };
    });
});

const view = ref<"block" | "table">(props.view);
/** false until the client has had a chance to load a map — see the template */
const mounted = ref(false);
const hovered = ref<number | null>(null);
const pinned = ref<number | null>(null);
const onlyKind = ref<ByteKind | null>(null);
const cursor = ref({ x: 0, y: 0 });
const showAll = ref(false);

/** the view choice is a reading preference, so it outlives the page */
const STORE = "df-bytemap-view";
onMounted(async () => {
  if (props.map) {
    const loader = MAP_LOADERS[`./maps/${props.map}.json`];
    if (loader) {
      pending.value = true;
      loaded.value = (await loader()).default;
      pending.value = false;
    }
  }
  mounted.value = true;
  try {
    const saved = localStorage.getItem(STORE);
    if (saved === "block" || saved === "table") view.value = saved;
  } catch {
    /* private mode, blocked storage — the prop default is fine */
  }
});
function setView(v: "block" | "table"): void {
  view.value = v;
  try {
    localStorage.setItem(STORE, v);
  } catch {
    /* ignore */
  }
}

/**
 * Hover is a lookup on the BYTE under the cursor, not a hit on a block.
 *
 * Blocks were <button>s at first, which broke on exactly the files worth
 * looking at: a real SET pads each container to an alignment boundary, so the
 * map carries a hundred 48-byte holes that are half a pixel wide at 64 KB to
 * the row. As elements they overlapped their neighbours and swallowed their
 * hover; as a lookup they are simply the answer when the cursor is over them,
 * and the question "what is at this byte?" is the one a byte map should answer
 * anyway. Keyboard and screen-reader access is the table view — same regions,
 * same words, as text.
 */
/**
 * The file's own pointer graph, by container number: which region a container
 * is, and which containers each one names. Hovering a table lights up every
 * container it addresses, which is the only way this relation is visible at all
 * — the pointers themselves are 4-byte fields inside a payload.
 */
const byContainer = computed(() => {
  const m = new Map<number, number>();
  regions.value.forEach((r, i) => {
    if (r.container !== undefined) m.set(r.container, i);
  });
  return m;
});
const children = computed(() => {
  const m = new Map<number, number[]>();
  for (const r of regions.value) {
    if (r.parent === undefined || r.container === undefined) continue;
    const kids = m.get(r.parent);
    if (kids) kids.push(r.container);
    else m.set(r.parent, [r.container]);
  }
  return m;
});

/** region indices related to the hovered one: what points at it, what it points at */
const linked = computed(() => {
  const i = pinned.value ?? hovered.value;
  const r = i === null ? null : regions.value[i];
  if (!r) return new Set<number>();
  const out = new Set<number>();
  if (r.parent !== undefined) {
    const p = byContainer.value.get(r.parent);
    if (p !== undefined) out.add(p);
  }
  for (const kid of children.value.get(r.container ?? -1) ?? []) {
    const k = byContainer.value.get(kid);
    if (k !== undefined) out.add(k);
  }
  out.delete(i as number);
  return out;
});

/** the two sentences the read-out adds when a region sits in the graph */
const relation = computed(() => {
  const i = pinned.value ?? hovered.value;
  const r = i === null ? null : regions.value[i];
  if (!r) return null;
  const kids = children.value.get(r.container ?? -1) ?? [];
  const parent = r.parent !== undefined ? regions.value[byContainer.value.get(r.parent) ?? -1] : undefined;
  if (!kids.length && !parent) return null;
  return [
    parent ? `named by ${parent.label}` : null,
    kids.length ? `names ${kids.length} container${kids.length > 1 ? "s" : ""}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
});

const starts = computed(() => regions.value.map((r) => r.at));
function regionAt(byte: number): number | null {
  const at = starts.value;
  let lo = 0;
  let hi = at.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = regions.value[mid];
    if (byte < r.at) hi = mid - 1;
    else if (byte >= r.at + r.size) lo = mid + 1;
    else return mid;
  }
  return null;
}
function byteUnder(rowAt: number, e: MouseEvent): number {
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const frac = Math.min(0.999999, Math.max(0, (e.clientX - box.left) / box.width));
  return Math.min((data.value?.total ?? 1) - 1, Math.floor(rowAt + frac * rowBytes.value));
}
function onMove(rowAt: number, e: MouseEvent): void {
  cursor.value = { x: e.clientX, y: e.clientY };
  hovered.value = regionAt(byteUnder(rowAt, e));
}
function onClick(rowAt: number, e: MouseEvent): void {
  const i = regionAt(byteUnder(rowAt, e));
  pinned.value = i !== null && pinned.value === i ? null : i;
}

const active = computed(() => {
  const i = pinned.value ?? hovered.value;
  return i === null ? null : regions.value[i] ?? null;
});
const dimmed = (r: ByteRegion): boolean => onlyKind.value !== null && r.kind !== onlyKind.value;

function toggleKind(k: ByteKind): void {
  onlyKind.value = onlyKind.value === k ? null : k;
}

const TABLE_CAP = 240;
const tableRows = computed(() =>
  showAll.value ? regions.value : regions.value.slice(0, TABLE_CAP),
);
const hasTypes = computed(() => regions.value.some((r) => r.type));

/**
 * How wide a block must be before it carries its name — a twelfth of a row.
 * Below that a name is three letters and an ellipsis, which is worse than no
 * name: the shape is what the block view is for, and the names are one hover or
 * one click on "Table view" away. (Tried it at 6% on the struct layouts, where
 * a 4-byte field is a sliver: "fo…", "fil…", "co…". Not worth it.)
 */
const LABEL_MIN_PCT = 12;
</script>

<template>
  <div v-if="!data && (pending || (props.map && !mounted))" class="bm-loading">
    Loading the map of <code>{{ props.map }}</code>…
  </div>

  <div v-else-if="!data" class="bm-missing">
    <strong>ByteMap:</strong> no such map
    <code>{{ props.layout ?? props.map }}</code
    >. Hand-authored layouts live in
    <code>docs/.vitepress/theme/bytemap/layouts.ts</code>; generated ones under
    <code>docs/.vitepress/theme/bytemap/maps/</code> (see <code>tools/blockmap.ts</code>).
  </div>

  <figure v-else class="bm-root" :class="{ 'bm-picking': pinned !== null }">
    <div class="bm-head">
      <div class="bm-heading">
        <div class="bm-title">{{ data.title }}</div>
        <div v-if="data.subtitle" class="bm-sub">{{ data.subtitle }}</div>
      </div>
      <div class="bm-switch" role="group" aria-label="View">
        <button
          type="button"
          :class="{ on: view === 'block' }"
          :aria-pressed="view === 'block'"
          @click="setView('block')"
        >
          Block view
        </button>
        <button
          type="button"
          :class="{ on: view === 'table' }"
          :aria-pressed="view === 'table'"
          @click="setView('table')"
        >
          Table view
        </button>
      </div>
    </div>

    <template v-if="view === 'block'">
      <div class="bm-legend">
        <button
          v-for="l in legend"
          :key="l.kind"
          type="button"
          class="bm-chip"
          :class="[`k-${l.kind}`, { off: onlyKind !== null && onlyKind !== l.kind }]"
          :title="l.hint"
          :aria-pressed="onlyKind === l.kind"
          @click="toggleKind(l.kind)"
        >
          <span class="bm-swatch" /><span>{{ l.label }}</span>
          <span class="bm-share">{{ l.share }}</span>
        </button>
        <span class="bm-scale">
          {{ humanBytes(rowBytes) }} per row · {{ humanBytes(data.total) }} total
        </span>
      </div>

      <div
        class="bm-rows"
        role="img"
        :aria-label="`Block map of ${data.title}: ${humanBytes(data.total)} in ${regions.length} labelled regions. Switch to the table view for the same data as text.`"
        @mouseleave="hovered = null"
      >
        <div v-for="row in rows" :key="row.at" class="bm-row">
          <span class="bm-gutter">{{ hexOffset(row.at, data.total) }}</span>
          <div class="bm-track" @mousemove="onMove(row.at, $event)" @click="onClick(row.at, $event)">
            <div
              v-for="s in row.slices"
              :key="`${s.index}-${row.at}`"
              class="bm-slice"
              :class="[
                `k-${regions[s.index].kind}`,
                {
                  first: s.first,
                  last: s.last,
                  hot: (pinned ?? hovered) === s.index,
                  link: linked.has(s.index),
                  dim: dimmed(regions[s.index]),
                  hatch: regions[s.index].texture === 'hatch',
                },
              ]"
              :style="{ left: `${s.leftPct}%`, width: `max(1px, calc(${s.widthPct}% - 2px))` }"
            >
              <!-- once per region, not once per row it happens to cross -->
              <span v-if="s.first && s.widthPct > LABEL_MIN_PCT" class="bm-slice-label">
                {{ regions[s.index].label }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="bm-detail" :class="{ empty: !active }">
        <template v-if="active">
          <span class="bm-dot" :class="`k-${active.kind}`" />
          <strong>{{ active.label }}</strong>
          <span class="bm-meta">
            {{ hexOffset(active.at, data.total) }} · {{ humanBytes(active.size) }}
            ({{ active.size.toLocaleString("en-US") }} bytes){{ active.type ? ` · ${active.type}` : "" }}
          </span>
          <span v-if="relation" class="bm-rel">{{ relation }}</span>
          <span v-if="active.detail" class="bm-what">{{ active.detail }}</span>
          <span v-if="pinned !== null" class="bm-pin">pinned — click the block again to release</span>
        </template>
        <template v-else>Hover a block to see what it is for; click to pin it.</template>
      </div>

      <div
        v-if="hovered !== null && pinned === null && regions[hovered]"
        class="bm-tip"
        :style="{ left: `${Math.min(cursor.x + 14, 100000)}px`, top: `${cursor.y + 16}px` }"
      >
        <div class="bm-tip-head">
          <span class="bm-dot" :class="`k-${regions[hovered].kind}`" />
          {{ regions[hovered].label }}
        </div>
        <div class="bm-tip-meta">
          {{ hexOffset(regions[hovered].at, data.total) }} · {{ humanBytes(regions[hovered].size) }}
        </div>
        <div v-if="relation" class="bm-tip-rel">{{ relation }}</div>
        <div v-if="regions[hovered].detail" class="bm-tip-what">{{ regions[hovered].detail }}</div>
      </div>
    </template>

    <div v-else class="bm-tablewrap">
      <table class="bm-table">
        <thead>
          <tr>
            <th class="num">Offset</th>
            <th class="num">Size</th>
            <th v-if="hasTypes">Type</th>
            <th>Field</th>
            <th>What it is for</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in tableRows" :key="i">
            <td class="num mono">{{ hexOffset(r.at, data.total) }}</td>
            <td class="num mono">{{ humanBytes(r.size) }}</td>
            <td v-if="hasTypes" class="mono">{{ r.type ?? "" }}</td>
            <td class="what">
              <span class="bm-dot" :class="`k-${r.kind}`" />{{ r.label }}
            </td>
            <td>{{ r.detail ?? "" }}</td>
          </tr>
        </tbody>
      </table>
      <button
        v-if="!showAll && regions.length > TABLE_CAP"
        type="button"
        class="bm-more"
        @click="showAll = true"
      >
        Show all {{ regions.length }} regions ({{ regions.length - TABLE_CAP }} more)
      </button>
    </div>

    <figcaption v-if="data.source" class="bm-source">Mapped from {{ data.source }}</figcaption>
  </figure>
</template>

<style scoped>
/*
 * Colours: slots 1–3 of the data-viz categorical palette, which are the ones
 * that clear the all-pairs CVD and normal-vision gates in BOTH modes — and a
 * byte map is all-pairs by construction, because reading it means matching a
 * block against every legend swatch. The dark column is its own set of steps
 * for the dark surface, not a filter over the light one.
 */
.bm-root {
  --bm-data: #2a78d6;
  --bm-script: #eb6834;
  --bm-media: #1baf7a;
  --bm-structure: var(--vp-c-text-3);
  --bm-gap: var(--vp-c-divider);
  --bm-ink-on-fill: #10100f;

  margin: 20px 0;
  padding: 12px 14px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
}
:global(.dark) .bm-root {
  --bm-data: #3987e5;
  --bm-script: #d95926;
  --bm-media: #199e70;
}

.k-data .bm-swatch,
.k-data.bm-dot,
.bm-slice.k-data {
  background: var(--bm-data);
}
.k-script .bm-swatch,
.k-script.bm-dot,
.bm-slice.k-script {
  background: var(--bm-script);
}
.k-media .bm-swatch,
.k-media.bm-dot,
.bm-slice.k-media {
  background: var(--bm-media);
}
.k-structure .bm-swatch,
.k-structure.bm-dot,
.bm-slice.k-structure {
  background: var(--bm-structure);
}
.k-gap .bm-swatch,
.k-gap.bm-dot,
.bm-slice.k-gap {
  background: repeating-linear-gradient(
    135deg,
    var(--bm-gap) 0 3px,
    transparent 3px 7px
  );
  border: 1px dashed var(--vp-c-divider);
}

/* head ------------------------------------------------------------------- */
.bm-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}
.bm-heading {
  flex: 1 1 240px;
  min-width: 0;
}
.bm-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
}
.bm-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--vp-c-text-2);
}
.bm-switch {
  display: flex;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  overflow: hidden;
  background: var(--vp-c-bg);
}
.bm-switch button {
  padding: 4px 10px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--vp-c-text-2);
  background: transparent;
  transition: color 0.15s, background-color 0.15s;
}
.bm-switch button + button {
  border-left: 1px solid var(--vp-c-divider);
}
.bm-switch button.on {
  color: var(--vp-c-text-1);
  font-weight: 600;
  background: var(--vp-c-default-soft);
}
.bm-switch button:hover:not(.on) {
  color: var(--vp-c-text-1);
}

/* legend ----------------------------------------------------------------- */
.bm-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin: 12px 0 8px;
}
.bm-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px 2px 6px;
  font-size: 11.5px;
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-divider);
  border-radius: 20px;
  background: var(--vp-c-bg);
  transition: opacity 0.15s;
}
.bm-chip.off {
  opacity: 0.4;
}
.bm-swatch {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex: none;
}
.bm-share {
  color: var(--vp-c-text-3);
  font-variant-numeric: tabular-nums;
}
.bm-scale {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
}

/* the map ---------------------------------------------------------------- */
.bm-rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.bm-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bm-gutter {
  flex: none;
  width: 8ch;
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  color: var(--vp-c-text-3);
  text-align: right;
  user-select: none;
}
.bm-track {
  position: relative;
  flex: 1;
  height: 20px;
  border-radius: 3px;
  background: var(--vp-c-bg);
  cursor: crosshair;
}
.bm-slice {
  position: absolute;
  top: 0;
  bottom: 0;
  overflow: hidden;
  pointer-events: none;
  transition: opacity 0.15s, filter 0.15s;
}
.bm-slice.first {
  border-top-left-radius: 4px;
  border-bottom-left-radius: 4px;
}
.bm-slice.last {
  border-top-right-radius: 4px;
  border-bottom-right-radius: 4px;
}
/* the audio texture sits UNDER the label, or it shreds it */
.bm-slice.hatch::before {
  content: "";
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    45deg,
    rgba(255, 255, 255, 0.34) 0 2px,
    transparent 2px 6px
  );
}
.bm-slice.hot {
  filter: brightness(1.12);
  box-shadow: 0 0 0 2px var(--vp-c-text-1);
  z-index: 2;
}
/* A related container is RINGED, not recoloured: what a block is stays what its
   colour says, and "connected to what I am hovering" is a second channel. */
.bm-slice.link {
  box-shadow: inset 0 0 0 2px var(--vp-c-bg), inset 0 0 0 3px var(--vp-c-text-1);
  z-index: 1;
}
.bm-slice.dim {
  opacity: 0.22;
}
.bm-slice-label {
  position: relative;
  display: block;
  padding: 0 5px;
  font-size: 10px;
  line-height: 20px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
  color: var(--bm-ink-on-fill);
}
.bm-slice.k-gap .bm-slice-label {
  color: var(--vp-c-text-3);
}

/* the read-out ----------------------------------------------------------- */
.bm-detail {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid var(--vp-c-divider);
  font-size: 12.5px;
  min-height: 34px;
}
.bm-detail.empty {
  color: var(--vp-c-text-3);
}
.bm-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 3px;
  flex: none;
  margin-right: 5px;
  vertical-align: baseline;
}
.bm-meta {
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
}
.bm-what {
  flex: 1 1 100%;
  color: var(--vp-c-text-2);
  line-height: 1.5;
}
.bm-rel {
  font-size: 11.5px;
  color: var(--vp-c-text-2);
  padding: 0 6px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
}
.bm-tip-rel {
  margin-top: 2px;
  font-size: 11px;
  color: var(--vp-c-text-2);
}
.bm-pin {
  flex: 1 1 100%;
  font-size: 11px;
  color: var(--vp-c-text-3);
}
.bm-tip {
  position: fixed;
  z-index: 60;
  max-width: 340px;
  padding: 8px 10px;
  pointer-events: none;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-elv);
  box-shadow: var(--vp-shadow-3);
  font-size: 12px;
  line-height: 1.45;
}
.bm-tip-head {
  font-weight: 600;
}
.bm-tip-meta {
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
}
.bm-tip-what {
  margin-top: 4px;
  color: var(--vp-c-text-2);
}

/* table ------------------------------------------------------------------ */
.bm-tablewrap {
  margin-top: 10px;
  overflow-x: auto;
}
.bm-table {
  width: 100%;
  display: table;
  border-collapse: collapse;
  font-size: 13px;
}
.bm-table th,
.bm-table td {
  padding: 5px 10px 5px 0;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--vp-c-divider);
}
.bm-table th {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vp-c-text-3);
  font-weight: 600;
}
.bm-table .num {
  text-align: right;
  white-space: nowrap;
}
.bm-table .what {
  color: var(--vp-c-text-1);
  min-width: 12ch;
}
.bm-table .mono {
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  color: var(--vp-c-text-2);
}
.bm-table td:last-child {
  color: var(--vp-c-text-2);
  line-height: 1.5;
}
.bm-more {
  margin-top: 8px;
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
}
.bm-more:hover {
  color: var(--vp-c-text-1);
}

.bm-source {
  margin-top: 8px;
  font-size: 11px;
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
}
.bm-loading {
  margin: 20px 0;
  padding: 10px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  font-size: 13px;
  color: var(--vp-c-text-3);
}
.bm-missing {
  margin: 20px 0;
  padding: 10px 12px;
  border: 1px solid var(--vp-c-warning-1);
  border-radius: 8px;
  font-size: 13px;
}

@media (max-width: 640px) {
  .bm-gutter {
    display: none;
  }
  .bm-scale {
    margin-left: 0;
    flex: 1 1 100%;
  }
}
</style>
