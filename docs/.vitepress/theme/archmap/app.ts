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

const GH = "https://github.com/dhobi/dreamrefactory/blob/master/";
const NS = "http://www.w3.org/2000/svg";
const KIND_COLOR = { engine: "--c-engine", game: "--c-game", site: "--c-site", tools: "--c-tools", ext: "--c-ext", person: "--c-ext", docs: "--c-docs" };
const SYM_COLOR = { class: "--c-engine", interface: "--c-site", enum: "--c-tools", type: "--c-tools", function: "--c-game" };
const GAMES = ["taoot", "dust", "timelapse", "redjack", "skullcracker", "lunicus", "jumpraven"];
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const HOW = "<p class=\"hint\">Tap or click a box for its notes, then tap it again or press Open to go one level down. Drag to pan; pinch, scroll or use the buttons to zoom. The breadcrumb goes back up.</p>";

// ---------- small pure helpers ----------
const fmt = (n) => n.toLocaleString("en-US");
const plural = (n, w) => {
  if (n === 1) return `1 ${w}`;
  const ending = w.endsWith("s") ? "es" : "s";
  return `${fmt(n)} ${w}${ending}`;
};
const color = (v) => `var(${v})`;
const esc = (s) => String(s).replaceAll(/[&<>"]/g, (c) => ESCAPES[c]);
const shortComp = (c) => c.replace(/^[^/]+\//, "") || c;
const fileName = (f) => f.split("/").at(-1);
const when = (cond, html) => (cond ? html : "");
const bump = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const byLinesDesc = (files) => (a, b) => files[b].l - files[a].l;
const isClassLike = (s) => s.k === "class" || s.k === "interface";

// the panel's HTML, a piece at a time, so no template sits inside another
const eyebrow = (t) => `<div class="eyebrow">${t}</div>`;
const heading = (t) => `<h2>${esc(t)}</h2>`;
const pathLine = (t) => `<div class="path">${esc(t)}</div>`;
const para = (t) => `<p>${esc(t)}</p>`;
const hint = (t) => `<p class="hint">${t}</p>`;
const note = (t) => `<div class="hint">${esc(t)}</div>`;
const actions = (...html) => `<div class="actions">${html.join("")}</div>`;
const fact = ([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`;
const facts = (pairs) => `<dl>${pairs.map(fact).join("")}</dl>`;
const section = (title, items) => when(items.length, `<h3>${title}</h3><ul>${items.join("")}</ul>`);
const count = (t) => `<span class="n">${t}</span>`;
const goBtn = (v, label) => `<button data-go='${esc(JSON.stringify(v))}'>${esc(label)}</button>`;
const goLink = (v, label) => `<button class="link" data-go='${esc(JSON.stringify(v))}'>${esc(label)}</button>`;
const lineAnchor = (line) => when(line, `#L${line}`);
const src = (path, line) => `<a href="${GH}${path}${lineAnchor(line)}" target="_blank" rel="noopener">Source on GitHub</a>`;
const legendItem = ([label, c]) => `<span style="color:${color(c)}"><i></i>${label}</span>`;

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
function box(id, label, sub, kind, extra = {}) {
  const w = Math.max(150, Math.min(300, Math.max(label.length * 7.6, (sub || "").length * 6.4) + 28));
  return { id, label, sub, kind, w, h: sub ? 52 : 38, ...extra };
}
function memberLine(m) {
  if (m[1] === "m") return `${m[0]}()`;
  return m[2] ? `${m[0]}: ${m[2]}` : m[0];
}
/** an edge's SVG path through dagre's points, rounded at each bend */
function edgePath(pts) {
  let path = `M${pts[0].x},${pts[0].y}`;
  for (let k = 1; k < pts.length - 1; k++) {
    const last = k === pts.length - 2;
    const to = last ? pts[k + 1] : { x: (pts[k].x + pts[k + 1].x) / 2, y: (pts[k].y + pts[k + 1].y) / 2 };
    path += ` Q${pts[k].x},${pts[k].y} ${to.x},${to.y}`;
  }
  if (pts.length === 2) path += ` L${pts[1].x},${pts[1].y}`;
  return path;
}
function el(tag, attrs = {}, parent = null) {
  const x = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v);
  parent?.appendChild(x);
  return x;
}
function svgText(parent, attrs, text) {
  const t = el("text", attrs, parent);
  t.textContent = text;
  return t;
}

/** the model's derived indexes: symbols by key, imports both ways, and the arrows between folders and workspaces */
function indexModel(files, comps) {
  const symIndex = new Map(); // "file#Name" -> sym
  for (const [p, f] of Object.entries(files)) for (const s of f.s) symIndex.set(`${p}#${s.n}`, { ...s, file: p });
  const compEdges = new Map();
  const contEdges = new Map();
  const usedBy = new Map();
  for (const [p, f] of Object.entries(files)) {
    for (const t of f.i.filter((x) => files[x])) {
      if (!usedBy.has(t)) usedBy.set(t, []);
      usedBy.get(t).push(p);
      const a = f.c;
      const b = files[t].c;
      if (a !== b) bump(compEdges, `${a}|${b}`);
      if (comps[a].k !== comps[b].k) bump(contEdges, `${comps[a].k}|${comps[b].k}`);
    }
  }
  return { symIndex, compEdges, contEdges, usedBy };
}

export function mount(root, D, dagre) {
  const byId = (id) => root.querySelector(`[data-am="${id}"]`);
  byId("gen").textContent = `read from ${D.commit}, ${D.generated}`;

  // ---------- what the parts are: tools/archmap-notes.ts, carried in the data ----------
  const CONTAINERS = D.notes.containers;
  const EXTERNALS = D.notes.externals;
  const COMPONENTS = D.notes.components;
  const files = D.files;
  const comps = D.components;
  const { symIndex, compEdges, contEdges, usedBy } = indexModel(files, comps);
  const usersOf = (f) => usedBy.get(f) ?? [];
  const kindOf = (c) => CONTAINERS[comps[c].k].kind;
  const compDesc = (c) => {
    if (COMPONENTS[c]) return COMPONENTS[c];
    const big = comps[c].f.toSorted(byLinesDesc(files))[0];
    return files[big]?.d ?? "";
  };

  // ---------- state ----------
  let view = { level: "system" }; // system | containers | container(id) | component(id, tab) | file(id)
  let selected = null;
  let graph = null;
  let tf = { x: 0, y: 0, k: 1 };
  let bounds = { w: 1, h: 1 };

  // ---------- views: each returns { nodes, edges, rank, levelName, levelNo } ----------
  function viewSystem() {
    const nodes = [
      box("ext:player", "Player", "in a browser", "person"),
      box("sys", "DreamRefactory", "8 games, the engine, editors, docs", "engine", { big: true, w: 280, h: 70, drill: { level: "containers" } }),
      box("ext:gamefiles", "Original game files", "CD rips, served beside the pages", "ext"),
      box("ext:exes", "Original executables", "TI.EXE, DF.EXE, RedJack.exe, SC.EXE…", "ext"),
      box("ext:ci", "GitHub Actions + SonarCloud", "suites, playthrough, analysis", "ext"),
    ];
    const edges = [
      { from: "ext:player", to: "sys", label: "plays, edits" },
      { from: "sys", to: "ext:gamefiles", label: "reads" },
      { from: "sys", to: "ext:exes", label: "disassembles to settle behaviour" },
      { from: "ext:ci", to: "sys", label: "tests every PR" },
    ];
    return { nodes, edges, rank: "LR", levelName: "System context", levelNo: 1 };
  }
  function viewContainers() {
    const nodes = Object.entries(CONTAINERS).map(([id, c]) => {
      const st = D.containers[id];
      return box(`cont:${id}`, c.name, `${plural(st.f, "file")} · ${fmt(st.l)} lines`, c.kind, { drill: { level: "container", id } });
    });
    nodes.push(box("ext:docs", "docs", "VitePress documentation", "docs"), box("ext:gamefiles", "Original game files", "not in git", "ext"));
    const edges = [...contEdges].map(([k, v]) => {
      const [a, b] = k.split("|");
      return { from: `cont:${a}`, to: `cont:${b}`, label: plural(v, "import"), w: v };
    });
    for (const g of GAMES) edges.push({ from: `cont:${g}`, to: "ext:gamefiles", ext: true });
    return { nodes, edges, rank: "TB", levelName: "Containers: the workspaces", levelNo: 2 };
  }
  function viewContainer(id) {
    const own = new Set(Object.keys(comps).filter((c) => comps[c].k === id));
    const nodes = [...own].map((c) => box(`comp:${c}`, shortComp(c), `${plural(comps[c].f.length, "file")} · ${fmt(comps[c].l)} lines`, CONTAINERS[id].kind, { drill: { level: "component", id: c } }));
    const edges = [];
    const stubs = new Set();
    for (const [k, v] of compEdges) {
      const [a, b] = k.split("|");
      const ia = own.has(a);
      const ib = own.has(b);
      if (!ia && !ib) continue;
      if (!ia) stubs.add(a);
      if (!ib) stubs.add(b);
      edges.push({ from: `comp:${a}`, to: `comp:${b}`, label: String(v), w: v, ext: ia !== ib });
    }
    for (const s of stubs) nodes.push(box(`comp:${s}`, s, comps[s].k, kindOf(s), { stub: true, drill: { level: "component", id: s } }));
    return { nodes, edges, rank: "LR", levelName: `Components of ${id}`, levelNo: 3 };
  }
  function viewComponentFiles(id) {
    const own = comps[id].f;
    const ownSet = new Set(own);
    const kind = kindOf(id);
    const nodes = own.map((f) => box(`file:${f}`, fileName(f), `${fmt(files[f].l)} lines · ${plural(files[f].s.filter((s) => s.k === "class").length, "class")}`, kind, { drill: { level: "file", id: f } }));
    const edges = [];
    const outC = new Map();
    const inC = new Map();
    for (const f of own) {
      for (const t of files[f].i.filter((x) => files[x])) {
        if (ownSet.has(t)) edges.push({ from: `file:${f}`, to: `file:${t}` });
        else bump(outC, files[t].c);
      }
      for (const u of usersOf(f).filter((x) => !ownSet.has(x))) bump(inC, files[u].c);
    }
    const stubIds = new Set([...outC.keys(), ...inC.keys()]);
    for (const s of stubIds) nodes.push(box(`comp:${s}`, s, "component", kindOf(s), { stub: true, drill: { level: "component", id: s } }));
    for (const [s, v] of outC) edges.push({ from: `comp:${id}`, to: `comp:${s}`, label: String(v), ext: true });
    for (const [s, v] of inC) edges.push({ from: `comp:${s}`, to: `comp:${id}`, label: String(v), ext: true });
    // edges to/from this component as a whole attach to a frame node
    if (stubIds.size) nodes.push(box(`comp:${id}`, `${shortComp(id)} (this folder)`, "imports shown as one arrow per folder", kind, { frame: true }));
    return { nodes, edges, rank: "LR", levelName: `Files in ${id}`, levelNo: 4, tabs: true };
  }
  function classNode(key, sym, stub) {
    const mem = (sym.m ?? []).filter((m) => !m[3]);
    const lines = stub ? [] : mem.slice(0, 9).map((m) => memberLine(m).slice(0, 38));
    if (!stub && mem.length > 9) lines.push(`+ ${mem.length - 9} more`);
    const w = Math.max(160, Math.min(320, Math.max(sym.n.length * 8, ...lines.map((l) => l.length * 6.7)) + 28));
    const h = 44 + lines.length * 15 + (lines.length ? 6 : 0);
    return { id: `sym:${key}`, label: sym.n, sub: stub ? fileName(sym.file) : sym.k, kind: "sym", symKind: sym.k, members: lines, w, h, stub, drill: { level: "file", id: sym.file, sym: key } };
  }
  /** a symbol's arrows: what it extends, and the classes and interfaces it holds or takes */
  function symbolEdges(key) {
    const s = symIndex.get(key);
    const ext = (s.e ?? []).filter((x) => !x.startsWith("?")).map((x) => ({ from: `sym:${key}`, to: `sym:${x}`, kind: "extends", target: x }));
    const uses = (s.r ?? []).filter((r) => symIndex.has(r) && isClassLike(symIndex.get(r))).map((r) => ({ from: `sym:${key}`, to: `sym:${r}`, kind: "uses", target: r }));
    return [...ext, ...uses];
  }
  function symbolGraph(keys, levelName, levelNo, tabs) {
    const inScope = new Set(keys);
    const nodes = keys.map((k) => classNode(k, symIndex.get(k), false));
    const edges = keys.flatMap(symbolEdges);
    const stubs = new Set(edges.map((e) => e.target).filter((t) => !inScope.has(t)));
    for (const s of stubs) nodes.push(classNode(s, symIndex.get(s), true));
    return { nodes, edges, rank: "TB", levelName, levelNo, tabs, symbols: true };
  }
  function viewComponentClasses(id) {
    const keys = comps[id].f.flatMap((f) => files[f].s.filter((s) => s.k === "class" || (s.k === "interface" && s.x !== 0)).map((s) => `${f}#${s.n}`));
    return symbolGraph(keys, `Classes and interfaces in ${id}`, 4, true);
  }
  function viewFile(id) {
    const keys = files[id].s.filter((s) => isClassLike(s) || s.k === "enum").map((s) => `${id}#${s.n}`);
    return symbolGraph(keys, `Classes in ${fileName(id)}`, 5, false);
  }
  function current() {
    switch (view.level) {
      case "containers": return viewContainers();
      case "container": return viewContainer(view.id);
      case "component": return view.tab === "classes" ? viewComponentClasses(view.id) : viewComponentFiles(view.id);
      case "file": return viewFile(view.id);
      default: return viewSystem();
    }
  }

  // ---------- layout + drawing ----------
  const svg = byId("svg");
  const vp = byId("vp");

  /** dagre's layout of the connected parts; the result's positions by node id */
  function layout(edges, linked, shelve) {
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({ rankdir: graph.rank, nodesep: 26, ranksep: graph.symbols ? 60 : 70, edgesep: 12, marginx: 30, marginy: 50 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of graph.nodes) if (!shelve || linked.has(n.id)) g.setNode(n.id, { width: n.w, height: n.h });
    for (const [i, e] of edges.entries()) g.setEdge(e.from, e.to, { label: e.label, width: e.label ? e.label.length * 6.5 : 0, height: e.label ? 14 : 0, labelpos: "c" }, `e${i}`);
    dagre.layout(g);
    const pos = new Map(g.nodes().map((id) => [id, g.node(id)]));
    return { g, pos, w: g.graph().width || 1, h: g.graph().height || 1 };
  }
  /** parts with no arrows at all, in rows under the drawing; returns the new height */
  function shelveLoose(loose, pos, w, h) {
    const rowW = Math.max(w - 60, 1000);
    let x = 30;
    let y = h + 10;
    let rowH = 0;
    svgText(vp, { class: "sub", x: 30, y }, "Not connected to anything else here:");
    y += 16;
    for (const n of loose.toSorted((a, b) => a.label.localeCompare(b.label))) {
      if (x + n.w > 30 + rowW && x > 30) {
        x = 30;
        y += rowH + 16;
        rowH = 0;
      }
      pos.set(n.id, { x: x + n.w / 2, y: y + n.h / 2 });
      x += n.w + 16;
      rowH = Math.max(rowH, n.h);
    }
    return { w: Math.max(w, rowW + 60), h: y + rowH + 30 };
  }
  function drawEdge(e, d, parent) {
    const ge = el("g", { class: e.ext ? "edge ext" : "edge", "data-a": e.from, "data-b": e.to }, parent);
    const sw = e.w ? Math.min(5, 1 + Math.log10(e.w + 1) * 1.6) : 1.3;
    el("path", { d: edgePath(d.points), "stroke-width": sw, "marker-end": e.kind === "extends" ? "url(#am-tri)" : "url(#am-arr)", "stroke-dasharray": e.kind === "uses" ? "5 4" : "" }, ge);
    if (e.label && d.x !== undefined) svgText(ge, { x: d.x, y: d.y + 4, "text-anchor": "middle" }, e.label);
  }
  function drawNode(n, p, parent) {
    const c = color((n.kind === "sym" ? SYM_COLOR[n.symKind] : KIND_COLOR[n.kind]) || "--c-ext");
    const label = n.sub ? `${n.label}, ${n.sub}` : n.label;
    const gn = el("g", { class: n.stub || n.frame ? "node stub" : "node", transform: `translate(${p.x - n.w / 2},${p.y - n.h / 2})`, tabindex: "0", role: "button", "aria-label": label, "data-id": n.id }, parent);
    el("rect", { class: "box", width: n.w, height: n.h, rx: cornerOf(n), stroke: c }, gn);
    el("rect", { width: 4, height: n.h - 12, x: 0, y: 6, rx: 1, fill: c, opacity: n.stub ? 0.4 : 0.9 }, gn);
    const tag = tagOf(n);
    if (tag) svgText(gn, { class: "tag", x: 14, y: 15, fill: c }, tag);
    const ty = tag ? 32 : 20;
    svgText(gn, { class: "title", x: 14, y: ty, "font-size": n.big ? 16 : 13 }, n.label);
    if (n.sub && n.kind !== "sym") svgText(gn, { class: "sub", x: 14, y: ty + 17 }, n.sub);
    if (n.members?.length) {
      el("line", { x1: 8, x2: n.w - 8, y1: ty + 9, y2: ty + 9, stroke: "var(--line)" }, gn);
      for (const [i, m] of n.members.entries()) svgText(gn, { class: m.startsWith("+ ") ? "mem t" : "mem", x: 14, y: ty + 25 + i * 15 }, m);
    }
    gn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (selected?.id === n.id && n.drill) go(n.drill);
      else select(n);
    });
    gn.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && n.drill) go(n.drill);
      if (ev.key === " ") {
        ev.preventDefault();
        select(n);
      }
    });
    gn.addEventListener("mouseenter", () => focusNode(n.id));
    gn.addEventListener("mouseleave", () => focusNode(selected?.id ?? null));
  }
  function render() {
    graph = current();
    vp.textContent = "";
    const ids = new Set(graph.nodes.map((n) => n.id));
    const edges = graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
    // parts with no arrows at all would sit in one long rank: lay out only the
    // connected ones, and shelve the rest in rows underneath
    const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
    const loose = graph.nodes.filter((n) => !linked.has(n.id));
    const shelve = loose.length > 3 && linked.size > 0;
    const { g, pos, w, h } = layout(edges, linked, shelve);
    bounds = shelve ? shelveLoose(loose, pos, w, h) : { w, h };
    const eg = el("g", {}, vp);
    const ng = el("g", {}, vp);
    vp.insertBefore(eg, vp.firstChild);
    for (const [i, e] of edges.entries()) drawEdge(e, g.edge(e.from, e.to, `e${i}`), eg);
    for (const n of graph.nodes) drawNode(n, pos.get(n.id), ng);
    renderChrome();
    fit();
    const pre = view.sym ? graph.nodes.find((n) => n.id === `sym:${view.sym}`) : null;
    select(pre ?? null, true);
  }
  function focusNode(id) {
    if (!id || !graph.nodes.some((n) => n.id === id)) {
      svg.classList.remove("focus");
      return;
    }
    svg.classList.add("focus");
    const near = new Set([id]);
    for (const e of vp.querySelectorAll(".edge")) {
      const touching = e.dataset.a === id || e.dataset.b === id;
      e.classList.toggle("near", touching);
      if (touching) near.add(e.dataset.a).add(e.dataset.b);
    }
    for (const n of vp.querySelectorAll(".node")) n.classList.toggle("near", near.has(n.dataset.id));
  }

  // ---------- pan and zoom ----------
  function apply() {
    vp.setAttribute("transform", `translate(${tf.x},${tf.y}) scale(${tf.k})`);
  }
  function fit() {
    const r = svg.getBoundingClientRect();
    // fit the whole drawing, but never so small that the boxes cannot be read:
    // past that, start at the top and let the viewer pan
    const whole = Math.min(1.25, (r.width - 20) / bounds.w, (r.height - 40) / bounds.h);
    const k = Math.max(whole, 0.5);
    const x = bounds.w * k < r.width ? (r.width - bounds.w * k) / 2 : 10;
    const y = bounds.h * k < r.height ? Math.max(10, (r.height - bounds.h * k) / 2) : 28;
    tf = { k, x, y };
    apply();
  }
  function zoomAt(f, cx, cy) {
    const k = Math.max(0.08, Math.min(4, tf.k * f));
    tf.x = cx - (cx - tf.x) * (k / tf.k);
    tf.y = cy - (cy - tf.y) * (k / tf.k);
    tf.k = k;
    apply();
  }
  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const r = svg.getBoundingClientRect();
    zoomAt(Math.exp(-ev.deltaY * 0.0015), ev.clientX - r.left, ev.clientY - r.top);
  }, { passive: false });
  let drag = null;
  let pinch = null;
  const touches = new Map();
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
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    tf.x = drag.tx + dx;
    tf.y = drag.ty + dy;
    apply();
  });
  const lift = (ev) => {
    touches.delete(ev.pointerId);
    if (touches.size < 2) pinch = null;
    if (drag && !drag.moved && ev.type === "pointerup") select(null);
    drag = null;
    svg.classList.remove("dragging");
  };
  svg.addEventListener("pointerup", lift);
  svg.addEventListener("pointercancel", lift);
  const center = () => {
    const r = svg.getBoundingClientRect();
    return [r.width / 2, r.height / 2];
  };
  byId("zin").onclick = () => zoomAt(1.3, ...center());
  byId("zout").onclick = () => zoomAt(1 / 1.3, ...center());
  byId("zfit").onclick = fit;
  const onResize = () => graph && fit();
  globalThis.addEventListener("resize", onResize);

  // ---------- navigation ----------
  function go(v) {
    view = { ...v };
    if (view.level === "component" && !view.tab) view.tab = "files";
    render();
    persist();
  }
  function crumbsFor(v) {
    const c = [{ label: "System", v: { level: "system" } }];
    if (v.level === "system") return c;
    c.push({ label: "Containers", v: { level: "containers" } });
    if (v.level === "containers") return c;
    if (v.level === "container") return [...c, { label: v.id, v: { level: "container", id: v.id } }];
    const comp = v.level === "component" ? v.id : files[v.id].c;
    const cont = comps[comp].k;
    c.push(
      { label: cont, v: { level: "container", id: cont } },
      { label: shortComp(comp), v: { level: "component", id: comp, tab: v.level === "file" ? "files" : v.tab } },
    );
    if (v.level === "file") c.push({ label: fileName(v.id), v: { level: "file", id: v.id } });
    return c;
  }
  function renderCrumbs() {
    const cr = byId("crumbs");
    cr.textContent = "";
    const list = crumbsFor(view);
    for (const [i, x] of list.entries()) {
      if (i) {
        const s = document.createElement("span");
        s.className = "sep";
        s.textContent = "/";
        cr.appendChild(s);
      }
      const b = document.createElement("button");
      b.textContent = x.label;
      if (i === list.length - 1) b.setAttribute("aria-current", "page");
      else b.onclick = () => go(x.v);
      cr.appendChild(b);
    }
  }
  function renderTabs() {
    const tabs = byId("tabs");
    tabs.textContent = "";
    if (!graph.tabs) return;
    for (const [t, l] of [["files", "Files"], ["classes", "Classes"]]) {
      const b = document.createElement("button");
      b.textContent = l;
      b.setAttribute("aria-pressed", String((view.tab || "files") === t));
      b.onclick = () => go({ level: "component", id: view.id, tab: t });
      tabs.appendChild(b);
    }
  }
  function renderChrome() {
    renderCrumbs();
    byId("level").innerHTML = `Level ${graph.levelNo} of 5 · <b>${esc(graph.levelName)}</b>`;
    renderTabs();
    const items = graph.symbols
      ? [["class", "--c-engine"], ["interface", "--c-site"], ["enum", "--c-tools"]].map(legendItem).join("") + "<span>▷ extends</span><span>⇢ holds or takes</span>"
      : [["engine", "--c-engine"], ["game", "--c-game"], ["site", "--c-site"], ["tools", "--c-tools"], ["external", "--c-ext"]].map(legendItem).join("") + "<span>→ imports (count)</span>";
    byId("legend").innerHTML = `${items}<span>tap twice to open</span>`;
  }

  // ---------- the side panel ----------
  const panel = byId("panel");
  function select(n, quiet) {
    selected = n;
    for (const x of vp.querySelectorAll(".node")) x.classList.toggle("sel", !!n && x.dataset.id === n.id);
    focusNode(n?.id ?? null);
    panel.innerHTML = n ? detail(n) : overview();
    const ob = byId("openbtn");
    ob.hidden = !n?.drill;
    if (n?.drill) {
      ob.textContent = `Open ${n.label} ›`;
      ob.onclick = () => go(n.drill);
    }
    for (const b of panel.querySelectorAll("[data-go]")) b.addEventListener("click", () => go(JSON.parse(b.dataset.go)));
    if (!quiet && n) panel.scrollTop = 0;
  }
  const fileItem = (x) => `<li>${goLink({ level: "file", id: x }, fileName(x))}${count(esc(shortComp(files[x].c)))}</li>`;
  function fileLinks(p) {
    const by = usersOf(p);
    const more = when(by.length > 60, `<li class="hint">and ${by.length - 60} more</li>`);
    const imported = section("Imported by", [...by.slice(0, 60).map(fileItem), more].filter(Boolean));
    return section("Imports", files[p].i.map(fileItem)) + imported;
  }
  const fnItem = (s) => `<li><code>${esc(s.n)}</code>${count(s.k)}${when(s.d, note(s.d))}</li>`;
  function overviewSystem() {
    return eyebrow("Level 1 · System context") + heading("DreamRefactory")
      + para("A browser port of CyberFlix's DreamFactory games and the engines behind them, rebuilt from the original files and executables. Seven games play in the browser on one shared engine (Skull Cracker brings its own), with editors for every file format and a documentation site.")
      + HOW + actions(goBtn({ level: "containers" }, "Open the containers"));
  }
  function overviewContainers() {
    const tot = Object.values(D.containers).reduce((a, c) => ({ f: a.f + c.f, l: a.l + c.l, cl: a.cl + c.cl }), { f: 0, l: 0, cl: 0 });
    return eyebrow("Level 2 · Containers") + heading("The workspaces")
      + para("Each box is an npm workspace, plus the shared tools. Arrows are TypeScript imports between them: every game page imports the engine and the shared chrome, and so do the front page and the editors. Nothing points into a game. The arrows into tools are build-time scripts, such as the logo makers.")
      + facts([["source files", fmt(tot.f)], ["lines", fmt(tot.l)], ["classes", fmt(tot.cl)]])
      + hint("Tests, generated assets and the game files themselves are left out.") + HOW;
  }
  function overviewContainer() {
    const c = CONTAINERS[view.id];
    const st = D.containers[view.id];
    return eyebrow("Level 3 · Container") + heading(c.title) + para(c.desc)
      + facts([["files", fmt(st.f)], ["lines", fmt(st.l)], ["classes", fmt(st.cl)]])
      + hint("Boxes are folders. Dashed boxes are folders in other workspaces this one imports from or is imported by; the numbers count imports.");
  }
  function overviewComponent() {
    const c = comps[view.id];
    const how = view.tab === "classes"
      ? "Classes and exported interfaces in this folder. A solid arrow with an open head is extends; a dashed arrow means a field or constructor parameter of that type. Dashed boxes live elsewhere."
      : "Files and the imports between them. The folder's imports from elsewhere are drawn once per other folder, from the box marked (this folder). Switch to Classes for the class diagram.";
    return eyebrow("Level 4 · Component") + heading(view.id) + para(compDesc(view.id))
      + facts([["files", fmt(c.f.length)], ["lines", fmt(c.l)]]) + hint(how);
  }
  function overviewFile() {
    const f = files[view.id];
    const fns = f.s.filter((s) => s.k === "function" || s.k === "type");
    return eyebrow("Level 5 · File") + heading(fileName(view.id)) + pathLine(view.id) + para(f.d) + actions(src(view.id))
      + facts([["lines", fmt(f.l)], ["imports", f.i.length], ["imported by", usersOf(view.id).length]])
      + section("Exported functions and types", fns.map(fnItem)) + fileLinks(view.id);
  }
  function overview() {
    switch (view.level) {
      case "containers": return overviewContainers();
      case "container": return overviewContainer();
      case "component": return overviewComponent();
      case "file": return overviewFile();
      default: return overviewSystem();
    }
  }
  function detailExternal(k) {
    const x = EXTERNALS[k];
    const what = { person: "Person", docs: "Docs" }[x.kind] ?? "External system";
    return eyebrow(what) + heading(x.title) + para(x.desc);
  }
  function detailContainer(k) {
    const c = CONTAINERS[k];
    const st = D.containers[k];
    const folders = Object.keys(comps).filter((x) => comps[x].k === k).map((x) => `<li>${goLink({ level: "component", id: x }, shortComp(x))}${count(comps[x].f.length)}</li>`);
    return eyebrow(`Container · ${c.kind}`) + heading(c.title) + para(c.desc) + actions(goBtn({ level: "container", id: k }, "Open"))
      + facts([["files", fmt(st.f)], ["lines", fmt(st.l)], ["classes", fmt(st.cl)]]) + section("Folders", folders);
  }
  function detailComponent(c) {
    const cc = comps[c];
    const biggest = cc.f.toSorted(byLinesDesc(files)).map((x) => `<li>${goLink({ level: "file", id: x }, fileName(x))}${count(fmt(files[x].l))}</li>`);
    return eyebrow(`Component · ${esc(cc.k)}`) + heading(c) + para(compDesc(c))
      + actions(goBtn({ level: "component", id: c, tab: "files" }, "Open files"), goBtn({ level: "component", id: c, tab: "classes" }, "Open classes"))
      + facts([["files", fmt(cc.f.length)], ["lines", fmt(cc.l)]]) + section("Files, largest first", biggest);
  }
  function detailFile(p) {
    const f = files[p];
    const cls = f.s.filter((s) => s.k === "class").map((s) => `<li>${goLink({ level: "file", id: p, sym: p + "#" + s.n }, s.n)}</li>`);
    return eyebrow(`File · ${esc(shortComp(f.c))}`) + heading(fileName(p)) + pathLine(p) + para(f.d) + actions(goBtn({ level: "file", id: p }, "Open classes"), src(p))
      + facts([["lines", fmt(f.l)], ["classes", cls.length]]) + section("Classes", cls) + fileLinks(p);
  }
  const SUFFIX = { m: "()", g: " <span class='t'>(get)</span>" };
  const memberItem = (m) => {
    const type = when(m[2], ` <span class="t">: ${esc(m[2])}</span>`);
    return `<li class="member">${when(m[3], "static ")}${esc(m[0])}${SUFFIX[m[1]] ?? ""}${type}</li>`;
  };
  const relItem = (r) => {
    if (r.startsWith("?")) return `<li><code>${esc(r.slice(1))}</code>${count("outside the repo")}</li>`;
    const t = symIndex.get(r);
    if (!t) return "";
    return `<li>${goLink({ level: "file", id: t.file, sym: r }, t.n)}${count(esc(fileName(t.file)))}</li>`;
  };
  const relSection = (arr, title) => section(title, (arr ?? []).map(relItem).filter(Boolean));
  function detailSymbol(key) {
    const s = symIndex.get(key);
    const mem = s.m ?? [];
    const heldBy = [...symIndex.entries()].filter(([, t]) => (t.r ?? []).includes(key) || (t.e ?? []).includes(key)).map(([k]) => k);
    const ownFile = view.level === "file" && view.id === s.file;
    return eyebrow(esc(s.k) + when(s.x === 0, " · not exported")) + heading(s.n) + pathLine(`${s.file}:${s.ln}`) + when(s.d, para(s.d))
      + actions(when(!ownFile, goBtn({ level: "file", id: s.file, sym: key }, "Open its file")), src(s.file, s.ln))
      + relSection(s.e, "Extends") + relSection(s.r, "Holds or takes") + relSection(heldBy, "Used by")
      + section(`Public members (${mem.length})`, mem.map(memberItem));
  }
  function detail(n) {
    const [kind, ...rest] = n.id.split(":");
    const id = rest.join(":");
    switch (kind) {
      case "sys": return overviewSystem().replace("Level 1 · System context", "The system");
      case "ext": return detailExternal(id);
      case "cont": return detailContainer(id);
      case "comp": return detailComponent(id);
      case "file": return detailFile(id);
      case "sym": return detailSymbol(id);
      default: return "";
    }
  }

  // ---------- search ----------
  const q = byId("q");
  const res = byId("results");
  const index = [
    ...Object.entries(CONTAINERS).map(([k, c]) => ({ k: "container", n: k, p: c.title, v: { level: "container", id: k } })),
    ...Object.keys(comps).map((c) => ({ k: "folder", n: shortComp(c), p: c, v: { level: "component", id: c } })),
    ...Object.keys(files).map((f) => ({ k: "file", n: fileName(f), p: f, v: { level: "file", id: f } })),
    ...[...symIndex.entries()].filter(([, s]) => isClassLike(s)).map(([key, s]) => ({ k: s.k, n: s.n, p: s.file, v: { level: "file", id: s.file, sym: key } })),
  ];
  let hits = [];
  let on = 0;
  const hitButton = (h, i) => `<button data-i="${i}" class="${i === on ? "on" : ""}"><span class="k">${h.k}</span>${esc(h.n)}<span class="p">${esc(h.p)}</span></button>`;
  function showResults() {
    const t = q.value.trim().toLowerCase();
    if (!t) {
      res.hidden = true;
      return;
    }
    const rank = (x) => (x.n.toLowerCase().startsWith(t) ? 0 : 1);
    hits = index.filter((x) => x.n.toLowerCase().includes(t)).sort((a, b) => rank(a) - rank(b) || a.n.length - b.n.length).slice(0, 14);
    on = 0;
    res.innerHTML = hits.length ? hits.map(hitButton).join("") : "<div class=\"hint\" style=\"padding:8px 10px\">Nothing called that.</div>";
    res.hidden = false;
    for (const b of res.querySelectorAll("button")) b.addEventListener("click", () => pick(Number(b.dataset.i)));
  }
  function pick(i) {
    const h = hits[i];
    if (!h) return;
    res.hidden = true;
    q.value = "";
    go(h.v);
  }
  q.addEventListener("input", showResults);
  q.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const step = ev.key === "ArrowDown" ? 1 : -1;
      on = Math.max(0, Math.min(hits.length - 1, on + step));
      for (const [i, b] of [...res.querySelectorAll("button")].entries()) b.classList.toggle("on", i === on);
    } else if (ev.key === "Enter") pick(on);
    else if (ev.key === "Escape") res.hidden = true;
  });
  const onDocClick = (ev) => {
    if (!ev.target.closest(".search")) res.hidden = true;
  };
  document.addEventListener("click", onDocClick);

  // ---------- remember where the viewer was ----------
  function persist() {
    try {
      localStorage.setItem("arch-view", JSON.stringify(view));
    } catch {
      // private windows and blocked storage: the map just starts at the top next time
    }
  }
  const known = (v) => {
    switch (v?.level) {
      case "system":
      case "containers": return true;
      case "container": return !!CONTAINERS[v.id];
      case "component": return !!comps[v.id];
      case "file": return !!files[v.id];
      default: return false;
    }
  };
  try {
    const saved = JSON.parse(localStorage.getItem("arch-view") || "null");
    if (known(saved)) view = saved;
  } catch {
    // as above: no stored view, start at the system
  }
  render();
  return () => {
    globalThis.removeEventListener("resize", onResize);
    document.removeEventListener("click", onDocClick);
  };
}
