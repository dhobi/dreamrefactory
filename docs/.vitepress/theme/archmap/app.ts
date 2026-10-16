// @ts-nocheck — ported from a standalone page; the DOM work is plain and the
// data's shape is tools/archmap.mts's ArchModel
/**
 * The architecture map's drawing: five levels, system to class, each laid out
 * by dagre and drawn as SVG into the component's own elements
 * (ArchMap.vue). Everything it shows is the generated model
 * (tools/archmap.mts); the words are tools/archmap-notes.ts.
 *
 * `mount` returns the function that takes its window listeners down again.
 */
export function mount(root, D, dagre) {
const byId = (id) => root.querySelector(`[data-am="${id}"]`);

const GH = "https://github.com/dhobi/dreamrefactory/blob/master/";
byId("gen").textContent = `read from ${D.commit}, ${D.generated}`;

// ---------- what the parts are: tools/archmap-notes.ts, carried in the data ----------
const CONTAINERS = D.notes.containers, EXTERNALS = D.notes.externals, COMPONENTS = D.notes.components;
const KIND_COLOR = { engine: "--c-engine", game: "--c-game", site: "--c-site", tools: "--c-tools", ext: "--c-ext", person: "--c-ext", docs: "--c-docs" };
const SYM_COLOR = { class: "--c-engine", interface: "--c-site", enum: "--c-tools", type: "--c-tools", function: "--c-game" };

// ---------- derived indexes ----------
const files = D.files, comps = D.components;
const compOf = (f) => files[f].c;
const contOf = (c) => comps[c].k;
const shortComp = (c) => c.replace(/^[^/]+\//, "") || c;
const fileName = (f) => f.split("/").pop();
const symIndex = new Map(); // "file#Name" -> sym
for (const [p, f] of Object.entries(files)) for (const s of f.s) symIndex.set(`${p}#${s.n}`, { ...s, file: p });
const compEdges = new Map(), contEdges = new Map(), usedBy = new Map();
const bump = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
for (const [p, f] of Object.entries(files)) for (const t of f.i) {
  if (!files[t]) continue;
  (usedBy.get(t) || usedBy.set(t, []).get(t)).push(p);
  const a = f.c, b = files[t].c;
  if (a !== b) bump(compEdges, a + "|" + b);
  const ca = comps[a].k, cb = comps[b].k;
  if (ca !== cb) bump(contEdges, ca + "|" + cb);
}
const fmt = (n) => n.toLocaleString("en-US");
const plural = (n, w) => {
  if (n === 1) return `1 ${w}`;
  return `${fmt(n)} ${w}${w.endsWith("s") ? "es" : "s"}`;
};
const color = (v) => `var(${v})`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const compDesc = (c) => COMPONENTS[c] || (() => { const big = comps[c].f.slice().sort((a, b) => files[b].l - files[a].l)[0]; return files[big]?.d || ""; })();

// ---------- state ----------
let view = { level: "system" }; // system | containers | container(id) | component(id, tab) | file(id)
let selected = null;

// ---------- views: each returns { nodes, edges, legend, info } ----------
function box(id, label, sub, kind, extra = {}) {
  const w = Math.max(150, Math.min(300, Math.max(label.length * 7.6, (sub || "").length * 6.4) + 28));
  return { id, label, sub, kind, w, h: sub ? 52 : 38, ...extra };
}
function viewSystem() {
  const n = [
    box("ext:player", "Player", "in a browser", "person"),
    box("sys", "DreamRefactory", "8 games, the engine, editors, docs", "engine", { big: true, w: 280, h: 70, drill: { level: "containers" } }),
    box("ext:gamefiles", "Original game files", "CD rips, served beside the pages", "ext"),
    box("ext:exes", "Original executables", "TI.EXE, DF.EXE, RedJack.exe, SC.EXE…", "ext"),
    box("ext:ci", "GitHub Actions + SonarCloud", "suites, playthrough, analysis", "ext"),
  ];
  const e = [
    { from: "ext:player", to: "sys", label: "plays, edits" },
    { from: "sys", to: "ext:gamefiles", label: "reads" },
    { from: "sys", to: "ext:exes", label: "disassembles to settle behaviour" },
    { from: "ext:ci", to: "sys", label: "tests every PR" },
  ];
  return { nodes: n, edges: e, rank: "LR", levelName: "System context", levelNo: 1 };
}
function viewContainers() {
  const n = [];
  for (const [id, c] of Object.entries(CONTAINERS)) {
    const st = D.containers[id];
    n.push(box("cont:" + id, c.name, `${plural(st.f, "file")} · ${fmt(st.l)} lines`, c.kind, { drill: { level: "container", id } }));
  }
  n.push(box("ext:docs", "docs", "VitePress documentation", "docs"));
  n.push(box("ext:gamefiles", "Original game files", "not in git", "ext"));
  const e = [];
  for (const [k, v] of contEdges) { const [a, b] = k.split("|"); e.push({ from: "cont:" + a, to: "cont:" + b, label: plural(v, "import"), w: v }); }
  for (const g of ["taoot", "dust", "timelapse", "redjack", "skullcracker", "lunicus", "jumpraven"]) e.push({ from: "cont:" + g, to: "ext:gamefiles", ext: true });
  return { nodes: n, edges: e, rank: "TB", levelName: "Containers: the workspaces", levelNo: 2 };
}
function viewContainer(id) {
  const own = Object.keys(comps).filter((c) => comps[c].k === id);
  const n = own.map((c) => box("comp:" + c, shortComp(c), `${plural(comps[c].f.length, "file")} · ${fmt(comps[c].l)} lines`, CONTAINERS[id].kind, { drill: { level: "component", id: c } }));
  const e = [], stubs = new Set();
  for (const [k, v] of compEdges) {
    const [a, b] = k.split("|");
    const ia = own.includes(a), ib = own.includes(b);
    if (ia && ib) e.push({ from: "comp:" + a, to: "comp:" + b, label: String(v), w: v });
    else if (ia || ib) {
      const other = ia ? b : a;
      stubs.add(other);
      e.push({ from: "comp:" + a, to: "comp:" + b, label: String(v), w: v, ext: true });
    }
  }
  for (const s of stubs) n.push(box("comp:" + s, s, comps[s].k, CONTAINERS[comps[s].k].kind, { stub: true, drill: { level: "component", id: s } }));
  return { nodes: n, edges: e, rank: "LR", levelName: `Components of ${id}`, levelNo: 3 };
}
function viewComponent(id, tab) {
  if (tab === "classes") return viewComponentClasses(id);
  const own = comps[id].f;
  const ownSet = new Set(own);
  const n = own.map((f) => box("file:" + f, fileName(f), `${fmt(files[f].l)} lines · ${plural(files[f].s.filter((s) => s.k === "class").length, "class")}`, CONTAINERS[comps[id].k].kind, { drill: { level: "file", id: f } }));
  const e = [], outC = new Map(), inC = new Map();
  for (const f of own) for (const t of files[f].i) {
    if (!files[t]) continue;
    if (ownSet.has(t)) e.push({ from: "file:" + f, to: "file:" + t });
    else bump(outC, files[t].c);
  }
  for (const f of own) for (const u of usedBy.get(f) || []) if (!ownSet.has(u)) bump(inC, files[u].c);
  const stubIds = new Set([...outC.keys(), ...inC.keys()]);
  for (const s of stubIds) {
    n.push(box("comp:" + s, s, "component", CONTAINERS[comps[s].k].kind, { stub: true, drill: { level: "component", id: s } }));
  }
  for (const [s, v] of outC) e.push({ from: "comp:" + id, to: "comp:" + s, label: String(v), ext: true, viaGroup: true });
  for (const [s, v] of inC) e.push({ from: "comp:" + s, to: "comp:" + id, label: String(v), ext: true, viaGroup: true });
  // edges to/from this component as a whole attach to a frame node
  if (stubIds.size) n.push(box("comp:" + id, shortComp(id) + " (this folder)", "imports shown as one arrow per folder", CONTAINERS[comps[id].k].kind, { frame: true }));
  return { nodes: n, edges: e, rank: "LR", levelName: `Files in ${id}`, levelNo: 4, tabs: true };
}
function classNode(key, sym, stub) {
  const mem = (sym.m || []).filter((m) => !m[3]);
  const memberLine = (m) => {
    if (m[1] === "m") return m[0] + "()";
    return m[2] ? `${m[0]}: ${m[2]}` : m[0];
  };
  const lines = stub ? [] : mem.slice(0, 9).map((m) => memberLine(m).slice(0, 38));
  if (!stub && mem.length > 9) lines.push(`+ ${mem.length - 9} more`);
  const w = Math.max(160, Math.min(320, Math.max(sym.n.length * 8, ...lines.map((l) => l.length * 6.7)) + 28));
  return { id: "sym:" + key, label: sym.n, sub: stub ? fileName(sym.file) : sym.k, kind: "sym", symKind: sym.k, members: lines, w, h: 44 + lines.length * 15 + (lines.length ? 6 : 0), stub, drill: { level: "file", id: sym.file, sym: key } };
}
function symbolGraph(keys, levelName, levelNo, extraTabs) {
  const inScope = new Set(keys);
  const n = keys.map((k) => classNode(k, symIndex.get(k), false));
  const e = [], stubs = new Set();
  for (const k of keys) {
    const s = symIndex.get(k);
    for (const x of s.e || []) {
      if (x.startsWith("?")) continue;
      if (!inScope.has(x)) stubs.add(x);
      e.push({ from: "sym:" + k, to: "sym:" + x, kind: "extends" });
    }
    for (const r of s.r || []) {
      const rs = symIndex.get(r);
      if (!rs || (rs.k !== "class" && rs.k !== "interface")) continue;
      if (!inScope.has(r)) stubs.add(r);
      e.push({ from: "sym:" + k, to: "sym:" + r, kind: "uses" });
    }
  }
  for (const s of stubs) n.push(classNode(s, symIndex.get(s), true));
  return { nodes: n, edges: e, rank: "TB", levelName, levelNo, tabs: extraTabs, symbols: true };
}
function viewComponentClasses(id) {
  const keys = [];
  for (const f of comps[id].f) for (const s of files[f].s) if (s.k === "class" || (s.k === "interface" && s.x !== 0)) keys.push(`${f}#${s.n}`);
  return symbolGraph(keys, `Classes and interfaces in ${id}`, 4, true);
}
function viewFile(id) {
  const keys = files[id].s.filter((s) => s.k === "class" || s.k === "interface" || s.k === "enum").map((s) => `${id}#${s.n}`);
  const g = symbolGraph(keys, `Classes in ${fileName(id)}`, 5, false);
  return g;
}

// ---------- layout + drawing ----------
const svg = byId("svg"), vp = byId("vp");
const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, parent) => { const x = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v); if (parent) parent.appendChild(x); return x; };
let graph = null, tf = { x: 0, y: 0, k: 1 }, bounds = { w: 1, h: 1 };

function current() {
  switch (view.level) {
    case "system": return viewSystem();
    case "containers": return viewContainers();
    case "container": return viewContainer(view.id);
    case "component": return viewComponent(view.id, view.tab || "files");
    case "file": return viewFile(view.id);
  }
}
/** how round a box's corners are: a person is a pill, the system a softer box */
function cornerOf(n) {
  if (n.kind === "person") return 22;
  return n.big ? 10 : 6;
}
/** the small capitals over a box's name, or none */
function tagOf(n) {
  if (n.kind === "sym") return n.symKind;
  if (n.kind === "person") return "person";
  if (n.stub) return "elsewhere";
  return n.kind === "ext" ? "external" : null;
}
function render() {
  graph = current();
  vp.textContent = "";
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: graph.rank, nodesep: 26, ranksep: graph.symbols ? 60 : 70, edgesep: 12, marginx: 30, marginy: 50 });
  g.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(graph.nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  // parts with no arrows at all would sit in one long rank: lay out only the
  // connected ones, and shelve the rest in rows underneath
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const loose = graph.nodes.filter((n) => !linked.has(n.id));
  const shelve = loose.length > 3 && linked.size > 0;
  for (const n of graph.nodes) if (!shelve || linked.has(n.id)) g.setNode(n.id, { width: n.w, height: n.h });
  edges.forEach((e, i) => g.setEdge(e.from, e.to, { label: e.label, width: e.label ? e.label.length * 6.5 : 0, height: e.label ? 14 : 0, labelpos: "c" }, "e" + i));
  dagre.layout(g);
  const pos = new Map();
  for (const id of g.nodes()) pos.set(id, g.node(id));
  let W = g.graph().width || 1, H = g.graph().height || 1;
  if (shelve) {
    const rowW = Math.max(W - 60, 1000);
    let x = 30, y = H + 10, rowH = 0;
    const lbl = el("text", { class: "sub", x: 30, y: y }, vp);
    lbl.textContent = "Not connected to anything else here:";
    y += 16;
    for (const n of loose.slice().sort((a, b) => a.label.localeCompare(b.label))) {
      if (x + n.w > 30 + rowW && x > 30) { x = 30; y += rowH + 16; rowH = 0; }
      pos.set(n.id, { x: x + n.w / 2, y: y + n.h / 2 });
      x += n.w + 16; rowH = Math.max(rowH, n.h);
    }
    W = Math.max(W, rowW + 60); H = y + rowH + 30;
  }
  bounds = { w: W, h: H };

  const eg = el("g", {}, vp), ng = el("g", {}, vp);
  vp.insertBefore(eg, vp.firstChild);
  edges.forEach((e, i) => {
    const d = g.edge(e.from, e.to, "e" + i);
    const pts = d.points;
    let path = `M${pts[0].x},${pts[0].y}`;
    for (let k = 1; k < pts.length - 1; k++) {
      const mx = (pts[k].x + pts[k + 1].x) / 2, my = (pts[k].y + pts[k + 1].y) / 2;
      path += ` Q${pts[k].x},${pts[k].y} ${k === pts.length - 2 ? pts[k + 1].x + "," + pts[k + 1].y : mx + "," + my}`;
    }
    if (pts.length === 2) path += ` L${pts[1].x},${pts[1].y}`;
    const ge = el("g", { class: "edge" + (e.ext ? " ext" : ""), "data-a": e.from, "data-b": e.to }, eg);
    const sw = e.w ? Math.min(5, 1 + Math.log10(e.w + 1) * 1.6) : 1.3;
    el("path", { d: path, "stroke-width": sw, "marker-end": e.kind === "extends" ? "url(#am-tri)" : "url(#am-arr)", "stroke-dasharray": e.kind === "uses" ? "5 4" : "" }, ge);
    if (e.label && d.x !== undefined) { const t = el("text", { x: d.x, y: d.y + 4, "text-anchor": "middle" }, ge); t.textContent = e.label; }
  });
  for (const n of graph.nodes) {
    const p = pos.get(n.id);
    const x = p.x - n.w / 2, y = p.y - n.h / 2;
    const c = n.kind === "sym" ? color(SYM_COLOR[n.symKind] || "--c-ext") : color(KIND_COLOR[n.kind] || "--c-ext");
    const gn = el("g", { class: "node" + (n.stub ? " stub" : ""), transform: `translate(${x},${y})`, tabindex: "0", role: "button", "aria-label": n.label + (n.sub ? ", " + n.sub : ""), "data-id": n.id }, ng);
    if (n.frame) gn.classList.add("stub");
    el("rect", { class: "box", width: n.w, height: n.h, rx: cornerOf(n), stroke: c }, gn);
    el("rect", { width: 4, height: n.h - 12, x: 0, y: 6, rx: 1, fill: c, opacity: n.stub ? 0.4 : 0.9 }, gn);
    const tag = tagOf(n);
    let ty = 20;
    if (tag) { const t = el("text", { class: "tag", x: 14, y: 15, fill: c }, gn); t.textContent = tag; ty = 32; }
    const t = el("text", { class: "title", x: 14, y: ty, "font-size": n.big ? 16 : 13 }, gn); t.textContent = n.label;
    if (n.sub && n.kind !== "sym") { const s = el("text", { class: "sub", x: 14, y: ty + 17 }, gn); s.textContent = n.sub; }
    if (n.members?.length) {
      el("line", { x1: 8, x2: n.w - 8, y1: ty + 9, y2: ty + 9, stroke: "var(--line)" }, gn);
      n.members.forEach((m, i) => { const mt = el("text", { class: "mem" + (m.startsWith("+ ") ? " t" : ""), x: 14, y: ty + 25 + i * 15 }, gn); mt.textContent = m; });
    }
    gn.addEventListener("click", (ev) => { ev.stopPropagation(); if (selected?.id === n.id && n.drill) go(n.drill); else select(n); });
    gn.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { if (n.drill) go(n.drill); } else if (ev.key === " ") { ev.preventDefault(); select(n); } });
    gn.addEventListener("mouseenter", () => focusNode(n.id));
    gn.addEventListener("mouseleave", () => focusNode(selected?.id ?? null));
  }
  renderChrome();
  fit();
  const pre = view.sym ? graph.nodes.find((n) => n.id === "sym:" + view.sym) : null;
  select(pre || null, true);
}
function focusNode(id) {
  if (!id || !graph.nodes.some((n) => n.id === id)) { svg.classList.remove("focus"); return; }
  svg.classList.add("focus");
  const near = new Set([id]);
  vp.querySelectorAll(".edge").forEach((e) => {
    const on = e.dataset.a === id || e.dataset.b === id;
    e.classList.toggle("near", on);
    if (on) { near.add(e.dataset.a); near.add(e.dataset.b); }
  });
  vp.querySelectorAll(".node").forEach((n) => n.classList.toggle("near", near.has(n.dataset.id)));
}

// ---------- pan and zoom ----------
function apply() { vp.setAttribute("transform", `translate(${tf.x},${tf.y}) scale(${tf.k})`); }
function fit() {
  const r = svg.getBoundingClientRect();
  // fit the whole drawing, but never so small that the boxes cannot be read:
  // past that, start at the top and let the viewer pan
  const whole = Math.min(1.25, (r.width - 20) / bounds.w, (r.height - 40) / bounds.h);
  const k = Math.max(whole, 0.5);
  tf = { k, x: bounds.w * k < r.width ? (r.width - bounds.w * k) / 2 : 10, y: bounds.h * k < r.height ? Math.max(10, (r.height - bounds.h * k) / 2) : 28 };
  apply();
}
function zoomAt(f, cx, cy) {
  const k = Math.max(0.08, Math.min(4, tf.k * f));
  tf.x = cx - (cx - tf.x) * (k / tf.k); tf.y = cy - (cy - tf.y) * (k / tf.k); tf.k = k; apply();
}
svg.addEventListener("wheel", (ev) => { ev.preventDefault(); const r = svg.getBoundingClientRect(); zoomAt(Math.exp(-ev.deltaY * 0.0015), ev.clientX - r.left, ev.clientY - r.top); }, { passive: false });
let drag = null;
const touches = new Map();
let pinch = null;
svg.addEventListener("pointerdown", (ev) => {
  touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (touches.size === 2) {
    const [a, b] = [...touches.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: tf.k };
    drag = null;
    return;
  }
  if (ev.target.closest(".node")) return;
  drag = { x: ev.clientX, y: ev.clientY, tx: tf.x, ty: tf.y, moved: false };
  svg.setPointerCapture(ev.pointerId);
  svg.classList.add("dragging");
});
svg.addEventListener("pointermove", (ev) => {
  if (touches.has(ev.pointerId)) touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pinch && touches.size === 2) {
    const [a, b] = [...touches.values()];
    const r = svg.getBoundingClientRect();
    const f = (pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d) / tf.k;
    zoomAt(f, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
    return;
  }
  if (!drag) return;
  const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
  tf.x = drag.tx + dx; tf.y = drag.ty + dy; apply();
});
const lift = (ev) => {
  touches.delete(ev.pointerId);
  if (touches.size < 2) pinch = null;
  if (drag && !drag.moved && ev.type === "pointerup") select(null);
  drag = null; svg.classList.remove("dragging");
};
svg.addEventListener("pointerup", lift);
svg.addEventListener("pointercancel", lift);
const center = () => { const r = svg.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
byId("zin").onclick = () => zoomAt(1.3, ...center());
byId("zout").onclick = () => zoomAt(1 / 1.3, ...center());
byId("zfit").onclick = fit;
const onResize = () => graph && fit();
window.addEventListener("resize", onResize);

// ---------- navigation ----------
function go(v) { view = { ...v }; if (view.level === "component" && !view.tab) view.tab = "files"; render(); persist(); }
function crumbsFor(v) {
  const c = [{ label: "System", v: { level: "system" } }];
  if (v.level === "system") return c;
  c.push({ label: "Containers", v: { level: "containers" } });
  if (v.level === "containers") return c;
  const ownComp = v.level === "component" ? v.id : compOf(v.id);
  const cont = v.level === "container" ? v.id : comps[ownComp].k;
  c.push({ label: cont, v: { level: "container", id: cont } });
  if (v.level === "container") return c;
  const comp = v.level === "component" ? v.id : compOf(v.id);
  c.push({ label: shortComp(comp), v: { level: "component", id: comp, tab: v.level === "file" ? "files" : v.tab } });
  if (v.level === "component") return c;
  c.push({ label: fileName(v.id), v: { level: "file", id: v.id } });
  return c;
}
function renderChrome() {
  const cr = byId("crumbs"); cr.textContent = "";
  const list = crumbsFor(view);
  list.forEach((x, i) => {
    if (i) { const s = document.createElement("span"); s.className = "sep"; s.textContent = "/"; cr.appendChild(s); }
    const b = document.createElement("button"); b.textContent = x.label;
    if (i === list.length - 1) b.setAttribute("aria-current", "page"); else b.onclick = () => go(x.v);
    cr.appendChild(b);
  });
  byId("level").innerHTML = `Level ${graph.levelNo} of 5 · <b>${esc(graph.levelName)}</b>`;
  const tabs = byId("tabs"); tabs.textContent = "";
  if (graph.tabs) for (const [t, l] of [["files", "Files"], ["classes", "Classes"]]) {
    const b = document.createElement("button"); b.textContent = l; b.setAttribute("aria-pressed", String((view.tab || "files") === t));
    b.onclick = () => go({ level: "component", id: view.id, tab: t }); tabs.appendChild(b);
  }
  const lg = byId("legend");
  const items = graph.symbols
    ? [["class", "--c-engine"], ["interface", "--c-site"], ["enum", "--c-tools"]].map(([l, c]) => `<span style="color:${color(c)}"><i></i>${l}</span>`).join("") + `<span>▷ extends</span><span>⇢ holds or takes</span>`
    : [["engine", "--c-engine"], ["game", "--c-game"], ["site", "--c-site"], ["tools", "--c-tools"], ["external", "--c-ext"]].map(([l, c]) => `<span style="color:${color(c)}"><i></i>${l}</span>`).join("") + `<span>→ imports (count)</span>`;
  lg.innerHTML = items + `<span>tap twice to open</span>`;
}

// ---------- the side panel ----------
const panel = byId("panel");
function select(n, quiet) {
  selected = n;
  vp.querySelectorAll(".node").forEach((x) => x.classList.toggle("sel", !!n && x.dataset.id === n.id));
  focusNode(n?.id ?? null);
  panel.innerHTML = n ? detail(n) : overview();
  const ob = byId("openbtn");
  ob.hidden = !n?.drill;
  if (n?.drill) { ob.textContent = `Open ${n.label} ›`; ob.onclick = () => go(n.drill); }
  panel.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => go(JSON.parse(b.dataset.go))));
  panel.querySelectorAll("[data-sel]").forEach((b) => b.addEventListener("click", () => { const t = graph.nodes.find((x) => x.id === b.dataset.sel); if (t) select(t); }));
  if (!quiet && n) panel.scrollTop = 0;
}
const goBtn = (v, label) => `<button data-go='${esc(JSON.stringify(v))}'>${esc(label)}</button>`;
const goLink = (v, label) => `<button class="link" data-go='${esc(JSON.stringify(v))}'>${esc(label)}</button>`;
const src = (path, line) => `<a href="${GH}${path}${line ? "#L" + line : ""}" target="_blank" rel="noopener">Source on GitHub</a>`;
function overview() {
  const lvl = graph.levelNo;
  const how = `<p class="hint">Tap or click a box for its notes, then tap it again or press Open to go one level down. Drag to pan; pinch, scroll or use the buttons to zoom. The breadcrumb goes back up.</p>`;
  if (view.level === "system") return `<div class="eyebrow">Level 1 · System context</div><h2>DreamRefactory</h2><p>A browser port of CyberFlix's DreamFactory games and the engines behind them, rebuilt from the original files and executables. Seven games play in the browser on one shared engine (Skull Cracker brings its own), with editors for every file format and a documentation site.</p>${how}<div class="actions">${goBtn({ level: "containers" }, "Open the containers")}</div>`;
  if (view.level === "containers") {
    const tot = Object.values(D.containers).reduce((a, c) => ({ f: a.f + c.f, l: a.l + c.l, cl: a.cl + c.cl }), { f: 0, l: 0, cl: 0 });
    return `<div class="eyebrow">Level 2 · Containers</div><h2>The workspaces</h2><p>Each box is an npm workspace, plus the shared tools. Arrows are TypeScript imports between them: every game page imports the engine and the shared chrome, and so do the front page and the editors. Nothing points into a game. The arrows into tools are build-time scripts, such as the logo makers.</p><dl><dt>source files</dt><dd>${fmt(tot.f)}</dd><dt>lines</dt><dd>${fmt(tot.l)}</dd><dt>classes</dt><dd>${fmt(tot.cl)}</dd></dl><p class="hint">Tests, generated assets and the game files themselves are left out.</p>${how}`;
  }
  if (view.level === "container") { const c = CONTAINERS[view.id], st = D.containers[view.id]; return `<div class="eyebrow">Level 3 · Container</div><h2>${esc(c.title)}</h2><p>${esc(c.desc)}</p><dl><dt>files</dt><dd>${fmt(st.f)}</dd><dt>lines</dt><dd>${fmt(st.l)}</dd><dt>classes</dt><dd>${fmt(st.cl)}</dd></dl><p class="hint">Boxes are folders. Dashed boxes are folders in other workspaces this one imports from or is imported by; the numbers count imports.</p>`; }
  if (view.level === "component") { const c = comps[view.id]; return `<div class="eyebrow">Level 4 · Component</div><h2>${esc(view.id)}</h2><p>${esc(compDesc(view.id))}</p><dl><dt>files</dt><dd>${fmt(c.f.length)}</dd><dt>lines</dt><dd>${fmt(c.l)}</dd></dl><p class="hint">${view.tab === "classes" ? "Classes and exported interfaces in this folder. A solid arrow with an open head is extends; a dashed arrow means a field or constructor parameter of that type. Dashed boxes live elsewhere." : "Files and the imports between them. The folder's imports from elsewhere are drawn once per other folder, from the box marked (this folder). Switch to Classes for the class diagram."}</p>`; }
  if (view.level === "file") {
    const f = files[view.id];
    const fns = f.s.filter((s) => s.k === "function" || s.k === "type");
    return `<div class="eyebrow">Level 5 · File</div><h2>${esc(fileName(view.id))}</h2><div class="path">${esc(view.id)}</div><p>${esc(f.d)}</p><div class="actions">${src(view.id)}</div><dl><dt>lines</dt><dd>${fmt(f.l)}</dd><dt>imports</dt><dd>${f.i.length}</dd><dt>imported by</dt><dd>${(usedBy.get(view.id) || []).length}</dd></dl>${fns.length ? `<h3>Exported functions and types</h3><ul>${fns.map((s) => `<li><code>${esc(s.n)}</code><span class="n">${s.k}</span>${s.d ? `<div class="hint">${esc(s.d)}</div>` : ""}</li>`).join("")}</ul>` : ""}${fileLinks(view.id)}`;
  }
  return "";
}
function fileLinks(p) {
  const imp = files[p].i, by = usedBy.get(p) || [];
  const li = (x) => `<li>${goLink({ level: "file", id: x }, fileName(x))}<span class="n">${esc(shortComp(files[x].c))}</span></li>`;
  const more = by.length > 60 ? `<li class="hint">and ${by.length - 60} more</li>` : "";
  const imports = imp.length ? `<h3>Imports</h3><ul>${imp.map(li).join("")}</ul>` : "";
  const importedBy = by.length ? `<h3>Imported by</h3><ul>${by.slice(0, 60).map(li).join("")}${more}</ul>` : "";
  return imports + importedBy;
}
function detail(n) {
  const id = n.id;
  if (id === "sys") return overview().replace("Level 1 · System context", "The system");
  if (id.startsWith("ext:")) { const x = EXTERNALS[id.slice(4)]; const what = { person: "Person", docs: "Docs" }[x.kind] ?? "External system"; return `<div class="eyebrow">${what}</div><h2>${esc(x.title)}</h2><p>${esc(x.desc)}</p>`; }
  if (id.startsWith("cont:")) {
    const k = id.slice(5), c = CONTAINERS[k], st = D.containers[k];
    const cs = Object.keys(comps).filter((x) => comps[x].k === k);
    return `<div class="eyebrow">Container · ${c.kind}</div><h2>${esc(c.title)}</h2><p>${esc(c.desc)}</p><div class="actions">${goBtn({ level: "container", id: k }, "Open")}</div><dl><dt>files</dt><dd>${fmt(st.f)}</dd><dt>lines</dt><dd>${fmt(st.l)}</dd><dt>classes</dt><dd>${fmt(st.cl)}</dd></dl><h3>Folders</h3><ul>${cs.map((x) => `<li>${goLink({ level: "component", id: x }, shortComp(x))}<span class="n">${comps[x].f.length}</span></li>`).join("")}</ul>`;
  }
  if (id.startsWith("comp:")) {
    const c = id.slice(5), cc = comps[c];
    const biggest = cc.f.slice().sort((a, b) => files[b].l - files[a].l);
    return `<div class="eyebrow">Component · ${esc(cc.k)}</div><h2>${esc(c)}</h2><p>${esc(compDesc(c))}</p><div class="actions">${goBtn({ level: "component", id: c, tab: "files" }, "Open files")}${goBtn({ level: "component", id: c, tab: "classes" }, "Open classes")}</div><dl><dt>files</dt><dd>${fmt(cc.f.length)}</dd><dt>lines</dt><dd>${fmt(cc.l)}</dd></dl><h3>Files, largest first</h3><ul>${biggest.map((x) => `<li>${goLink({ level: "file", id: x }, fileName(x))}<span class="n">${fmt(files[x].l)}</span></li>`).join("")}</ul>`;
  }
  if (id.startsWith("file:")) {
    const p = id.slice(5), f = files[p];
    const cls = f.s.filter((s) => s.k === "class");
    return `<div class="eyebrow">File · ${esc(shortComp(f.c))}</div><h2>${esc(fileName(p))}</h2><div class="path">${esc(p)}</div><p>${esc(f.d)}</p><div class="actions">${goBtn({ level: "file", id: p }, "Open classes")}${src(p)}</div><dl><dt>lines</dt><dd>${fmt(f.l)}</dd><dt>classes</dt><dd>${cls.length}</dd></dl>${cls.length ? `<h3>Classes</h3><ul>${cls.map((s) => `<li>${goLink({ level: "file", id: p, sym: p + "#" + s.n }, s.n)}</li>`).join("")}</ul>` : ""}${fileLinks(p)}`;
  }
  if (id.startsWith("sym:")) {
    const key = id.slice(4), s = symIndex.get(key);
    const mem = s.m || [];
    const suffix = { m: "()", g: " <span class='t'>(get)</span>" };
    const row = (m) => `<li class="member">${m[3] ? "static " : ""}${esc(m[0])}${suffix[m[1]] ?? ""}${m[2] ? ` <span class="t">: ${esc(m[2])}</span>` : ""}</li>`;
    const rel = (arr, title) => arr?.length ? `<h3>${title}</h3><ul>${arr.map((r) => r.startsWith("?") ? `<li><code>${esc(r.slice(1))}</code><span class="n">outside the repo</span></li>` : (() => { const t = symIndex.get(r); return t ? `<li>${goLink({ level: "file", id: t.file, sym: r }, t.n)}<span class="n">${esc(fileName(t.file))}</span></li>` : ""; })()).join("")}</ul>` : "";
    const heldBy = [...symIndex.entries()].filter(([, t]) => (t.r || []).includes(key) || (t.e || []).includes(key)).map(([k]) => k);
    return `<div class="eyebrow">${esc(s.k)}${s.x === 0 ? " · not exported" : ""}</div><h2>${esc(s.n)}</h2><div class="path">${esc(s.file)}:${s.ln}</div>${s.d ? `<p>${esc(s.d)}</p>` : ""}<div class="actions">${view.level !== "file" || view.id !== s.file ? goBtn({ level: "file", id: s.file, sym: key }, "Open its file") : ""}${src(s.file, s.ln)}</div>${rel(s.e, "Extends")}${rel(s.r, "Holds or takes")}${rel(heldBy, "Used by")}${mem.length ? `<h3>Public members (${mem.length})</h3><ul>${mem.map(row).join("")}</ul>` : ""}`;
  }
  return "";
}

// ---------- search ----------
const q = byId("q"), res = byId("results");
const index = [
  ...Object.entries(CONTAINERS).map(([k, c]) => ({ k: "container", n: k, p: c.title, v: { level: "container", id: k } })),
  ...Object.keys(comps).map((c) => ({ k: "folder", n: shortComp(c), p: c, v: { level: "component", id: c } })),
  ...Object.keys(files).map((f) => ({ k: "file", n: fileName(f), p: f, v: { level: "file", id: f } })),
  ...[...symIndex.entries()].filter(([, s]) => s.k === "class" || s.k === "interface").map(([key, s]) => ({ k: s.k, n: s.n, p: s.file, v: { level: "file", id: s.file, sym: key } })),
];
let hits = [], on = 0;
function showResults() {
  const t = q.value.trim().toLowerCase();
  if (!t) { res.hidden = true; return; }
  hits = index.filter((x) => x.n.toLowerCase().includes(t)).sort((a, b) => (a.n.toLowerCase().startsWith(t) ? 0 : 1) - (b.n.toLowerCase().startsWith(t) ? 0 : 1) || a.n.length - b.n.length).slice(0, 14);
  on = 0;
  res.innerHTML = hits.length ? hits.map((h, i) => `<button data-i="${i}" class="${i === on ? "on" : ""}"><span class="k">${h.k}</span>${esc(h.n)}<span class="p">${esc(h.p)}</span></button>`).join("") : `<div class="hint" style="padding:8px 10px">Nothing called that.</div>`;
  res.hidden = false;
  res.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => pick(+b.dataset.i)));
}
function pick(i) { const h = hits[i]; if (!h) return; res.hidden = true; q.value = ""; go(h.v); }
q.addEventListener("input", showResults);
q.addEventListener("keydown", (ev) => {
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); on = Math.max(0, Math.min(hits.length - 1, on + (ev.key === "ArrowDown" ? 1 : -1))); res.querySelectorAll("button").forEach((b, i) => b.classList.toggle("on", i === on)); }
  else if (ev.key === "Enter") pick(on);
  else if (ev.key === "Escape") { res.hidden = true; }
});
const onDocClick = (ev) => { if (!ev.target.closest(".search")) res.hidden = true; };
document.addEventListener("click", onDocClick);

// ---------- remember where the viewer was ----------
function persist() { try { localStorage.setItem("arch-view", JSON.stringify(view)); } catch {} }
try {
  const saved = JSON.parse(localStorage.getItem("arch-view") || "null");
  const valid = saved && (saved.level === "system" || saved.level === "containers" || (saved.level === "container" && CONTAINERS[saved.id]) || (saved.level === "component" && comps[saved.id]) || (saved.level === "file" && files[saved.id]));
  if (valid) view = saved;
} catch {}
render();
return () => { window.removeEventListener("resize", onResize); document.removeEventListener("click", onDocClick); };
}
