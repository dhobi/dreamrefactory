/**
 * Reconstruct the game's mission / flow graph from the decoded scripts.
 *
 * The whole progression lives in data: a handful of global variables
 * (`mission`, `phase`, `tour`, ...) gate every branch, and scripts advance
 * them with plain assignments guarded by `if`/`switch`/`while` conditions.
 * This tool parses every script container into the AST, walks each statement
 * while carrying the stack of enclosing guard conditions, and records typed
 * flow events:
 *
 *   state   assignment to a flow-state global   (mission = 2)
 *   travel  changeset / gotospecial / jump*     (scene graph edges)
 *   actor   setupactor / putdownactor / sendto  (character placement)
 *   movie   playmovie / spotmovie               (cutscenes)
 *   puppet  openpuppetfile / walktopuppet       (conversations)
 *   gate    progress(m,p) test in a condition   (mission gates)
 *
 * Each event carries its location (file / container / handler) and the guard
 * path that leads to it, so the emitted report shows *under what conditions*
 * each mission/phase transition fires and *what changes* as a result.
 *
 * Outputs, under <outDir>/flow/ :
 *   globals.tsv        every flow-state global, ranked by how often it gates
 *   flow.json          every flow event (machine-readable)
 *   phase-graph.json   derived mission.phase -> mission.phase transitions
 *   scene-graph.json   set-to-set travel edges (+ the published Cytoscape map)
 *   FLOW.md            the readable mission-progression report (+ mermaid graph)
 *
 * Plus, into the playthrough suite when taoot/tests/playthrough/nav/ exists:
 *   taoot/tests/playthrough/nav/shipgraph.gen.ts   the travel graph as something WALKABLE — each
 *                              exit's standpoint, the doors it needs open, the
 *                              guard comparisons, and the flow state it sets.
 *                              Unlike scene-graph.json it keeps self-loops: the
 *                              grand staircase changes DECK onto itself, and
 *                              that is the ship's vertical connection.
 *
 *   npx tsx taoot/tools/flowmap.ts gamefiles out/
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, copyFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { sniffScript, Token } from "@dreamfactory/engine/df/script";
import { parseScript } from "@dreamfactory/engine/runtime/parser";
import { CallExpr, Expr, Script, Stmt } from "@dreamfactory/engine/runtime/ast";

const [, , rootDir = "gamefiles", outDir = "out"] = process.argv;

const SCRIPT_BEARING = /\.(SET|STG|PUP|SHP|CST|MOV)$/i;

/** directory names a CD rip carries that are not the game's own data */
const NOT_GAME_DATA = new Set(["install", "support", "shots", "sneak"]);

function* walk(dir: string, disc: 1 | 2 | null = null): Generator<{ path: string; disc: 1 | 2 | null }> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (NOT_GAME_DATA.has(e.toLowerCase())) continue;
      const m = /^titanic([12])$/i.exec(e);
      yield* walk(p, m ? (Number(m[1]) as 1 | 2) : disc);
    } else yield { path: p, disc };
  }
}

// ---------------------------------------------------------------------------
// AST -> readable source
// ---------------------------------------------------------------------------

function exprToStr(e: Expr): string {
  switch (e.t) {
    case "int":
      return String(e.v);
    case "str":
      return JSON.stringify(e.v);
    case "bool":
      return e.v ? "true" : "false";
    case "me":
      return "me";
    case "target":
      return "target";
    case "var":
      return e.name;
    case "call":
      return `${e.name}(${e.args.map(exprToStr).join(", ")})`;
    case "un":
      return e.op === "not" ? `not ${exprToStr(e.e)}` : `-${exprToStr(e.e)}`;
    case "bin":
      return `${exprToStr(e.l)} ${e.op} ${exprToStr(e.r)}`;
  }
}

/** collect every call with the given (lower-cased) name found anywhere in an expr */
function findCalls(e: Expr, name: string, out: CallExpr[]): void {
  switch (e.t) {
    case "call":
      if (e.name.toLowerCase() === name) out.push(e);
      for (const a of e.args) findCalls(a, name, out);
      break;
    case "bin":
      findCalls(e.l, name, out);
      findCalls(e.r, name, out);
      break;
    case "un":
      findCalls(e.e, name, out);
      break;
  }
}

/** collect every variable name referenced in an expr */
function collectVars(e: Expr, out: string[]): void {
  switch (e.t) {
    case "var":
      out.push(e.name);
      break;
    case "call":
      for (const a of e.args) collectVars(a, out);
      break;
    case "bin":
      collectVars(e.l, out);
      collectVars(e.r, out);
      break;
    case "un":
      collectVars(e.e, out);
      break;
  }
}

// ---------------------------------------------------------------------------
// event model
// ---------------------------------------------------------------------------

type EventKind = "state" | "beat" | "travel" | "actor" | "movie" | "puppet" | "gate";

interface FlowEvent {
  file: string;
  container: number;
  handler: string;
  /** the CD(s) the emitting script ships on (see the content-keyed dedup) */
  discs?: (1 | 2)[];
  kind: EventKind;
  detail: string;
  target?: string; // state: global name  | travel: set/flat  | actor: character
  value?: string; // state: assigned value
  guards: string[];
  // travel-only structured fields (for the scene-graph)
  op?: string; // lower-cased call name
  scene?: string;
  view?: string;
  targetLiteral?: boolean; // true when the destination set is a string literal
}

// call names (lower-case) that move the player between scenes / screens
const TRAVEL = new Set([
  "changeset",
  "gotospecial",
  "opensetfile",
  "closesetfile",
  "gotoflat",
  "gotopage",
  "jumppapa",
  "jumpbaby",
  "transtoflat",
  "transfromflat",
]);
// call names that place / remove story characters
const ACTOR = new Set([
  "setupactor",
  "putdownactor",
  "actorset",
  "actorstar",
]);
const MOVIE = new Set(["playmovie", "spotmovie"]);
// BOOTFILE helpers that push the story forward — their call sites are the beats
const PROGRESSION = new Set(["advanceday", "advancephase", "advancetour"]);
const PUPPET = new Set([
  "openpuppetfile",
  "walktopuppet",
  "runpuppet",
  "runyoself",
  "prepuppet",
]);
// sendto* forms: arg0 = target name, arg1 = deferred call in the target's context
const SENDTO = new Set([
  "sendtoactor",
  "sendtoscene",
  "sendtoset",
  "sendtoprop",
  "sendtostage",
  "sendtoboot",
  "sendtopuppet",
  "sendtoflat",
  "sendtoshop",
]);

// ---------------------------------------------------------------------------
// pass 1: parse everything, collect scripts + global-usage statistics
// ---------------------------------------------------------------------------

interface ParsedScript {
  file: string;
  container: number;
  script: Script;
  /** the CD(s) this exact script ships on — both, when the copies are identical */
  discs: (1 | 2)[];
}

const parsed: ParsedScript[] = [];
const globalDecls = new Set<string>(); // vars declared `global`/`dumpglobal`
const litWrites = new Map<string, Set<string>>(); // var -> distinct literal values written
const condReads = new Map<string, number>(); // var -> #times read inside a condition
let filesScanned = 0;
let scriptsParsed = 0;
let parseFailures = 0;

function isLiteral(e: Expr): boolean {
  return e.t === "int" || e.t === "str" || e.t === "bool" || e.t === "un";
}

/** first pass over a statement list: harvest declarations, literal writes, condition reads */
function harvest(stmts: Stmt[]): void {
  for (const s of stmts) {
    switch (s.t) {
      case "decl":
        if (s.kind === "global" || s.kind === "dumpglobal")
          for (const n of s.names) globalDecls.add(n);
        break;
      case "assign":
        if (isLiteral(s.value)) {
          let set = litWrites.get(s.name);
          if (!set) litWrites.set(s.name, (set = new Set()));
          set.add(exprToStr(s.value));
        }
        break;
      case "if": {
        const vs: string[] = [];
        collectVars(s.cond, vs);
        for (const v of vs) condReads.set(v, (condReads.get(v) ?? 0) + 1);
        harvest(s.then);
        if (s.else_) harvest(s.else_);
        break;
      }
      case "switch": {
        const vs: string[] = [];
        collectVars(s.subject, vs);
        for (const v of vs) condReads.set(v, (condReads.get(v) ?? 0) + 1);
        for (const c of s.cases) harvest(c.body);
        break;
      }
      case "while": {
        const vs: string[] = [];
        collectVars(s.cond, vs);
        for (const v of vs) condReads.set(v, (condReads.get(v) ?? 0) + 1);
        harvest(s.body);
        break;
      }
      case "for":
        harvest(s.body);
        break;
    }
  }
}

/**
 * Dedup key: room + container + SCRIPT CONTENT, not basename.
 *
 * Both CDs ship the 21 shared public rooms, each carrying that room in its own
 * act's state, and 8 of them differ in script content — the act-2 staircases and
 * hallways hold noticeably more guarded exits. Keying on the basename (which is
 * also why the two spellings hallb.set / HALLB.SET used to look like one file)
 * dropped whichever copy the walk reached second, silently losing ~26% of the
 * game's navigation trips, all of them from one act.
 *
 * Keying on content instead gets both properties: the copies that ARE identical
 * still collapse to one entry, so no trip or mission/phase transition is counted
 * twice, while a genuinely different variant is kept and tagged with its disc.
 */
const seenScripts = new Map<string, ParsedScript>();
const seenFiles = new Set<string>();
let discVariants = 0;
for (const { path, disc } of walk(rootDir)) {
  const name = basename(path);
  const isBoot = /^BOOTFILE$/i.test(name);
  if (!SCRIPT_BEARING.test(name) && !isBoot) continue;

  let file;
  try {
    file = readContainerFile(new Uint8Array(readFileSync(path)));
  } catch {
    continue;
  }
  filesScanned++;
  seenFiles.add(name.toLowerCase());

  for (let i = 0; i < file.containers.length; i++) {
    const tokens = sniffScript(file.containers[i].data);
    if (!tokens) continue;
    if (!tokens.some((t: Token) => t.kind === "op")) continue;
    let script: Script;
    try {
      script = parseScript(tokens);
    } catch {
      parseFailures++;
      continue;
    }
    // the token stream IS the content; two discs' identical copies hash alike
    const body = tokens
      .map((t: Token) =>
        t.kind === "var"
          ? `var:${t.name}`
          : t.kind === "op"
            ? `op:${t.id}`
            : t.kind === "break"
              ? `br:${t.indent}`
              : `${t.kind}:${t.value}`,
      )
      .join("\u0001");
    const key = `${name.toLowerCase()}#${i}#${body}`;
    const hit = seenScripts.get(key);
    if (hit) {
      if (disc && !hit.discs.includes(disc)) hit.discs.push(disc); // same script, both CDs
      continue;
    }
    scriptsParsed++;
    const entry: ParsedScript = { file: name, container: i, script, discs: disc ? [disc] : [] };
    seenScripts.set(key, entry);
    parsed.push(entry);
    // a second, DIFFERENT script for the same room+container = a per-act variant
    if ([...seenScripts.keys()].some((k) => k !== key && k.startsWith(`${name.toLowerCase()}#${i}#`))) {
      discVariants++;
    }
    for (const code of script.codes.values()) harvest(code.body);
    harvest(script.topLevel);
  }
}

// A flow-state global gates branching: it is declared global, receives at
// least one literal write, and is read in at least one condition.
const flowGlobals = new Set<string>();
for (const g of globalDecls) {
  if ((condReads.get(g) ?? 0) >= 1 && litWrites.has(g)) flowGlobals.add(g);
}
// `mission`/`phase` are the primary axes — always tracked even if a decl was missed
flowGlobals.add("mission");
flowGlobals.add("phase");

// ---------------------------------------------------------------------------
// pass 2: emit flow events with guard context
// ---------------------------------------------------------------------------

const events: FlowEvent[] = [];

function emitFromStmts(
  stmts: Stmt[],
  guards: string[],
  loc: { file: string; container: number; handler: string; discs?: (1 | 2)[] },
): void {
  for (const s of stmts) {
    switch (s.t) {
      case "assign":
        if (flowGlobals.has(s.name)) {
          events.push({
            ...loc,
            kind: "state",
            detail: `${s.name} = ${exprToStr(s.value)}`,
            target: s.name,
            value: exprToStr(s.value),
            guards: [...guards],
          });
        }
        break;
      case "callstmt":
        classifyCall(s.call, guards, loc);
        break;
      case "if": {
        // gate events: progress() tests inside the condition
        collectGates(s.cond, guards, loc);
        const g = exprToStr(s.cond);
        emitFromStmts(s.then, [...guards, g], loc);
        if (s.else_) emitFromStmts(s.else_, [...guards, `not (${g})`], loc);
        break;
      }
      case "switch": {
        const subj = exprToStr(s.subject);
        for (const c of s.cases)
          emitFromStmts(c.body, [...guards, `${subj} = ${exprToStr(c.match)}`], loc);
        break;
      }
      case "while":
        collectGates(s.cond, guards, loc);
        emitFromStmts(s.body, [...guards, exprToStr(s.cond)], loc);
        break;
      case "for":
        emitFromStmts(s.body, guards, loc);
        break;
    }
  }
}

function collectGates(
  cond: Expr,
  guards: string[],
  loc: { file: string; container: number; handler: string; discs?: (1 | 2)[] },
): void {
  const calls: CallExpr[] = [];
  findCalls(cond, "progress", calls);
  for (const c of calls)
    events.push({
      ...loc,
      kind: "gate",
      detail: `progress(${c.args.map(exprToStr).join(", ")})`,
      guards: [...guards],
    });
}

function classifyCall(
  call: CallExpr,
  guards: string[],
  loc: { file: string; container: number; handler: string; discs?: (1 | 2)[] },
): void {
  const n = call.name.toLowerCase();

  if (PROGRESSION.has(n)) {
    events.push({
      ...loc,
      kind: "beat",
      detail: `${call.name}()`,
      target: n,
      guards: [...guards],
    });
    return;
  }

  if (SENDTO.has(n)) {
    // arg0 = target, arg1 = deferred call — classify by the inner call
    const targetArg = call.args[0];
    const inner = call.args.find((a) => a.t === "call") as CallExpr | undefined;
    const target = targetArg ? exprToStr(targetArg) : "?";
    if (inner) {
      const innerName = inner.name.toLowerCase();
      if (ACTOR.has(innerName) || innerName === "setupactor") {
        events.push({
          ...loc,
          kind: "actor",
          detail: `${n}(${target}, ${exprToStr(inner)})`,
          target: unquote(target),
          guards: [...guards],
        });
        return;
      }
      // recurse into the deferred call so its travel/movie/puppet effects register
      classifyCall(inner, guards, loc);
    }
    return;
  }

  if (TRAVEL.has(n)) {
    const a = call.args;
    const asStr = (e?: Expr) => (e ? (e.t === "str" ? e.v : exprToStr(e)) : undefined);
    events.push({
      ...loc,
      kind: "travel",
      detail: exprToStr(call),
      target: a[0] ? unquote(exprToStr(a[0])) : undefined,
      op: n,
      scene: asStr(a[1]),
      view: asStr(a[2]),
      targetLiteral: a[0]?.t === "str",
      guards: [...guards],
    });
    return;
  }
  if (ACTOR.has(n)) {
    events.push({
      ...loc,
      kind: "actor",
      detail: exprToStr(call),
      target: call.args[0] ? unquote(exprToStr(call.args[0])) : undefined,
      guards: [...guards],
    });
    return;
  }
  if (MOVIE.has(n)) {
    events.push({
      ...loc,
      kind: "movie",
      detail: exprToStr(call),
      target: call.args[0] ? unquote(exprToStr(call.args[0])) : undefined,
      guards: [...guards],
    });
    return;
  }
  if (PUPPET.has(n)) {
    events.push({
      ...loc,
      kind: "puppet",
      detail: exprToStr(call),
      guards: [...guards],
    });
    return;
  }
  // scan nested args for effects invoked as arguments (rare)
  for (const a of call.args) if (a.t === "call") classifyCall(a, guards, loc);
}

function unquote(s: string): string {
  return s.replace(/^"|"$/g, "");
}

for (const { file, container, script, discs } of parsed) {
  for (const [handler, code] of script.codes)
    emitFromStmts(code.body, [], { file, container, handler, discs });
  if (script.topLevel.length)
    emitFromStmts(script.topLevel, [], { file, container, handler: "<top>", discs });
}

// ---------------------------------------------------------------------------
// derive the mission.phase transition graph from state writes
// ---------------------------------------------------------------------------

/** pull `mission = N` / `phase = N` equalities out of a guard string list */
function ctxFromGuards(guards: string[]): { mission?: string; phase?: string } {
  const ctx: { mission?: string; phase?: string } = {};
  for (const g of guards) {
    const m = g.match(/\bmission\s*=\s*(\d+)/);
    if (m) ctx.mission = m[1];
    const p = g.match(/\bphase\s*=\s*(\d+)/);
    if (p) ctx.phase = p[1];
  }
  return ctx;
}

interface Transition {
  from: string; // "M.P" best-known context before the write
  to: string; // "M.P" after the write
  detail: string;
  where: string;
}

const transitions: Transition[] = [];
for (const e of events) {
  if (e.kind !== "state") continue;
  if (e.target !== "mission" && e.target !== "phase") continue;
  const v = (e.value ?? "").match(/^\d+$/) ? e.value! : null;
  if (v == null) continue; // skip computed writes for the graph
  const ctx = ctxFromGuards(e.guards);
  const fromM = ctx.mission ?? "?";
  const fromP = ctx.phase ?? "?";
  let toM = fromM;
  let toP = fromP;
  if (e.target === "mission") {
    toM = v;
    toP = "0"; // a mission bump conventionally resets phase; approximate
  } else {
    toP = v;
  }
  transitions.push({
    from: `${fromM}.${fromP}`,
    to: `${toM}.${toP}`,
    detail: e.detail,
    where: `${e.file}#${e.container} [${e.handler}]`,
  });
}

// ---------------------------------------------------------------------------
// write outputs
// ---------------------------------------------------------------------------

const flowDir = join(outDir, "flow");
mkdirSync(flowDir, { recursive: true });

// globals.tsv
const gRows = [...flowGlobals]
  .map((g) => ({
    g,
    reads: condReads.get(g) ?? 0,
    values: [...(litWrites.get(g) ?? [])].sort(),
  }))
  .sort((a, b) => b.reads - a.reads);
writeFileSync(
  join(flowDir, "globals.tsv"),
  "global\tcondition_reads\tdistinct_values\tvalues\n" +
    gRows
      .map((r) => `${r.g}\t${r.reads}\t${r.values.length}\t${r.values.join(" | ")}`)
      .join("\n"),
);

// flow.json
writeFileSync(join(flowDir, "flow.json"), JSON.stringify(events, null, 1));

// phase-graph.json (unique edges with counts)
const edgeMap = new Map<string, { from: string; to: string; count: number; wheres: string[] }>();
for (const t of transitions) {
  const key = `${t.from}->${t.to}`;
  let e = edgeMap.get(key);
  if (!e) edgeMap.set(key, (e = { from: t.from, to: t.to, count: 0, wheres: [] }));
  e.count++;
  if (e.wheres.length < 8) e.wheres.push(`${t.where}: ${t.detail}`);
}
writeFileSync(join(flowDir, "phase-graph.json"), JSON.stringify([...edgeMap.values()], null, 1));

// ---------------------------------------------------------------------------
// scene-travel graph (the interactive "world map")
// ---------------------------------------------------------------------------

// only travel calls that name a concrete destination set
const TRAVEL_GRAPH_OPS = new Set(["changeset", "gotospecial", "opensetfile", "jumppapa"]);

function roomOf(file: string): { id: string; type: "room" | "context" } {
  if (/\.set$/i.test(file)) return { id: file.replace(/\.set$/i, "").toLowerCase(), type: "room" };
  return { id: file.toLowerCase(), type: "context" };
}

interface Trip {
  from: string;
  handler: string;
  op: string;
  scene?: string;
  view?: string;
  guard: string;
  mission: string;
  /** which CD's copy of the room this exit comes from; both when they agree */
  discs: (1 | 2)[];
  /** flow globals this exit's own branch assigns (hallside, savedeck, …) */
  sets: { name: string; value: string }[];
}

/**
 * Flow-global assignments indexed by the exact code block they sit in
 * (file + container + handler + guard path), so a travel event can be asked
 * "what else does this branch set?".
 *
 * It matters because some exits are not merely guarded by flow state, they
 * ESTABLISH it: C73's door sets `hallside = "star"` on the way out, and the
 * grand staircase's landings set `savedeck`, which is what later decides
 * which deck its doors open onto. A route planner that reads guards but not
 * effects concludes the ship is disconnected above C deck.
 */
const blockAssigns = new Map<string, { name: string; value: string }[]>();
const blockKey = (e: FlowEvent) => `${e.file}\u0000${e.container}\u0000${e.handler}\u0000${e.guards.join(" & ")}`;
for (const e of events) {
  if (e.kind !== "state" || !e.target || e.value === undefined) continue;
  const k = blockKey(e);
  let list = blockAssigns.get(k);
  if (!list) blockAssigns.set(k, (list = []));
  list.push({ name: e.target, value: e.value });
}

const nodeInfo = new Map<string, { type: "room" | "context"; missions: Set<string> }>();
const gEdges = new Map<string, { source: string; target: string; trips: Trip[] }>();

function ensureNode(id: string, type: "room" | "context") {
  let n = nodeInfo.get(id);
  if (!n) nodeInfo.set(id, (n = { type, missions: new Set() }));
  if (type === "room") n.type = "room"; // a set seen only as a target is still a room
  return n;
}

for (const e of events) {
  if (e.kind !== "travel" || !e.op || !TRAVEL_GRAPH_OPS.has(e.op)) continue;
  if (!e.targetLiteral || !e.target) continue;
  const target = e.target.toLowerCase();
  if (!target || /[^a-z0-9_]/.test(target)) continue; // skip empty / non-literal targets
  const src = roomOf(e.file);
  if (src.id === target) continue; // ignore self-loops (same-set scene jumps)
  ensureNode(src.id, src.type);
  ensureNode(target, "room");
  const mission = ctxFromGuards(e.guards).mission ?? "any";
  const key = `${src.id}\u0000${target}`;
  let ed = gEdges.get(key);
  if (!ed) gEdges.set(key, (ed = { source: src.id, target, trips: [] }));
  ed.trips.push({
    from: e.file.toLowerCase(),
    handler: e.handler,
    op: e.op,
    scene: e.scene,
    view: e.view,
    guard: e.guards.join(" & "),
    mission,
    discs: e.discs ?? [],
    sets: blockAssigns.get(blockKey(e)) ?? [],
  });
  nodeInfo.get(src.id)!.missions.add(mission);
  nodeInfo.get(target)!.missions.add(mission);
}

const graphNodes = [...nodeInfo].map(([id, info]) => ({
  id,
  label: id.toUpperCase(),
  type: info.type,
  degree: 0, // filled below
  missions: [...info.missions].sort(),
}));
const degree = new Map<string, number>();
const graphEdges = [...gEdges.values()].map((ed, i) => {
  degree.set(ed.source, (degree.get(ed.source) ?? 0) + 1);
  degree.set(ed.target, (degree.get(ed.target) ?? 0) + 1);
  return {
    id: `e${i}`,
    source: ed.source,
    target: ed.target,
    count: ed.trips.length,
    missions: [...new Set(ed.trips.map((t) => t.mission))].sort(),
    discs: [...new Set(ed.trips.flatMap((t) => t.discs))].sort(),
    trips: ed.trips,
  };
});
for (const n of graphNodes) n.degree = degree.get(n.id) ?? 0;
const sceneGraph = { nodes: graphNodes, edges: graphEdges };
writeFileSync(join(flowDir, "scene-graph.json"), JSON.stringify(sceneGraph, null, 1));

// ---------------------------------------------------------------------------
// The navigation graph — taoot/tests/playthrough/nav/shipgraph.gen.ts
// ---------------------------------------------------------------------------
/**
 * The travel graph again, distilled into something that can be WALKED rather
 * than read: for each set→set trip, the view you must be standing in, the
 * doors that must be open, and the flow globals the guard pins.
 *
 * Every trip in the corpus has the same shape — stand in a view, open the door
 * if there is one, press uparrow (or click the hotspot) — and the guards draw
 * on a vocabulary of six variables. So the guard is not evaluated in general:
 * each term is matched against the handful of forms below and anything left
 * over marks the trip `partial`, which the navigator refuses to plan through.
 * A guard we half-understand is worse than one we admit we don't.
 *
 * Emitted as TypeScript rather than JSON so it type-checks with the code that
 * consumes it, and so a production build (which ships no game files) can still
 * plan a route — see taoot/tests/playthrough/nav/navigator.ts.
 */
interface NavTrip {
  from: string;
  to: string;
  by: "keydown" | "mousedown" | "openscene" | "other";
  stand: string[];
  standScene: string[];
  needsVisible: string[];
  needs: { var: string; op: string; value: string | number }[];
  sets: Record<string, string | number>;
  arrive: [string, string];
  partial: boolean;
  guard: string;
}

/** split a guard into `&`-joined terms, without splitting inside parens */
function guardTerms(guard: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < guard.length; i++) {
    const c = guard[i];
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (depth === 0 && guard.startsWith(" & ", i)) {
      out.push(cur.trim());
      cur = "";
      i += 2;
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const FLOW_VARS = ["hallside", "savedeck", "mission", "phase", "handitem", "stacklevel"];
const NEGATE: Record<string, string> = { "=": "!=", "!=": "=", "<": ">=", ">=": "<", ">": "<=", "<=": ">" };

/**
 * One guard term as a comparison on a flow global, or null if it isn't one.
 * Handles `not (...)` and `tour | ...` / `not (tour | ...)`: the guided tour is
 * a mode a playthrough never enters, so those reduce to the other side.
 */
function parseComparison(term: string): { var: string; op: string; value: string | number } | null {
  let t = term.trim();
  let negated = false;
  const not = /^not\s*\((.*)\)$/.exec(t);
  if (not) {
    negated = true;
    t = not[1].trim();
  }
  // `tour | rest` — drop the tour alternative (never taken)
  const alts = t.split("|").map((a) => a.trim());
  if (alts.length === 2 && alts[0] === "tour") t = alts[1];
  else if (alts.length > 1) return null;
  const m = new RegExp(`^(${FLOW_VARS.join("|")})\\s*(=|!=|<=|>=|<|>)\\s*(?:"(\\w*)"|(-?\\d+))$`).exec(t);
  if (!m) return null;
  const op = negated ? NEGATE[m[2]] : m[2];
  return { var: m[1], op, value: m[3] !== undefined ? m[3] : Number(m[4]) };
}
/**
 * Built from the raw events rather than from `graphEdges`, because the scene
 * graph drops self-loops as uninteresting ("same-set scene jumps") and one of
 * them is load-bearing: the grand staircase changes DECK with
 * `changeset("gstair3", …)` onto itself, setting `savedeck` as it goes. Drop
 * that and every deck above the one you start on is unreachable.
 */
const navSource: { source: string; target: string; trip: Trip }[] = [];
for (const e of events) {
  if (e.kind !== "travel" || !e.op || !TRAVEL_GRAPH_OPS.has(e.op)) continue;
  if (!e.targetLiteral || !e.target) continue;
  const target = e.target.toLowerCase();
  if (!target || /[^a-z0-9_]/.test(target)) continue;
  const src = roomOf(e.file);
  navSource.push({
    source: src.id,
    target,
    trip: {
      from: e.file.toLowerCase(), handler: e.handler, op: e.op, scene: e.scene, view: e.view,
      guard: e.guards.join(" & "), mission: ctxFromGuards(e.guards).mission ?? "any",
      discs: e.discs ?? [], sets: blockAssigns.get(blockKey(e)) ?? [],
    },
  });
}

const unparsedTerms = new Map<string, number>();
const navTrips: NavTrip[] = [];
{
  for (const { source, target, trip: t } of navSource) {
    const trip: NavTrip = {
      from: source,
      to: target,
      by: t.handler === "keydown" || t.handler === "mousedown" || t.handler === "openscene" ? t.handler : "other",
      stand: [],
      standScene: [],
      needsVisible: [],
      needs: [],
      sets: {},
      arrive: [(t.scene ?? "").toLowerCase(), (t.view ?? "").toLowerCase()],
      partial: false,
      guard: t.guard,
    };
    // what taking this exit establishes — only the flow vars a guard can read
    // back, and only literal assignments (a computed one isn't plannable)
    for (const a of t.sets) {
      if (!FLOW_VARS.includes(a.name)) continue;
      const lit = /^"(\w*)"$/.exec(a.value) ?? /^(-?\d+)$/.exec(a.value);
      if (lit) trip.sets[a.name] = /^-?\d+$/.test(lit[1]) ? Number(lit[1]) : lit[1];
    }
    for (const term of guardTerms(t.guard)) {
      // the standpoint, possibly an OR of a few views
      const views = [...term.matchAll(/currentview\s*\(\)\s*=\s*"(\w+)"/g)].map((m) => m[1].toLowerCase());
      if (views.length && /^(?:currentview[^|]*\|?\s*)+$/.test(term.replace(/"[^"]*"/g, '""'))) {
        trip.stand.push(...views);
        continue;
      }
      // some standpoints are pinned by scene as well as view — the grand
      // staircase reuses one view name across its decks
      const scenes = [...term.matchAll(/currentscene\s*\(\)\s*=\s*"(\w+)"/g)].map((m) => m[1].toLowerCase());
      if (scenes.length && /^(?:currentscene[^|]*\|?\s*)+$/.test(term.replace(/"[^"]*"/g, '""'))) {
        trip.standScene.push(...scenes);
        continue;
      }
      // which key/gesture — the handler already says, so this is noise
      if (/^arg\s*=\s*"(uparrow|downarrow|leftarrow|rightarrow)"$/.test(term)) continue;
      // the guided tour is never the path we walk
      if (/^not\s+tour$/.test(term)) continue;
      // a door (or hatch, or gate) has to be open before you can walk through
      const vis = /^propvisible\s*\(\s*"(\w+)"\s*\)$/.exec(term);
      if (vis) {
        trip.needsVisible.push(vis[1].toLowerCase());
        continue;
      }
      // A comparison on a flow global, optionally negated, optionally OR'd with
      // `tour`. The tour is the guided demo, which a playthrough never enters,
      // so `tour | X` reduces to X and `not (tour | X)` to `not X` — stated
      // here rather than hidden, because it is the one assumption in the
      // extractor that isn't read straight off the script.
      const cmp = parseComparison(term);
      if (cmp) {
        trip.needs.push(cmp);
        continue;
      }
      trip.partial = true; // an unrecognised term: don't plan through this trip
      unparsedTerms.set(term, (unparsedTerms.get(term) ?? 0) + 1);
    }
    if (!trip.stand.length) trip.partial = true; // nowhere to stand = nothing to plan
    navTrips.push(trip);
  }
}

const navDir = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "playthrough", "nav");
if (existsSync(navDir)) {
  const usable = navTrips.filter((t) => !t.partial);
  const lines = navTrips.map(
    (t) =>
      `  { from: ${JSON.stringify(t.from)}, to: ${JSON.stringify(t.to)}, by: ${JSON.stringify(t.by)},` +
      ` stand: ${JSON.stringify(t.stand)}, standScene: ${JSON.stringify(t.standScene)}, needsVisible: ${JSON.stringify(t.needsVisible)},` +
      ` needs: ${JSON.stringify(t.needs)}, sets: ${JSON.stringify(t.sets)},` +
      ` arrive: ${JSON.stringify(t.arrive)}, partial: ${t.partial},\n    guard: ${JSON.stringify(t.guard)} },`,
  );
  writeFileSync(
    join(navDir, "shipgraph.gen.ts"),
    `/* GENERATED by taoot/tools/flowmap.ts — do not edit.\n` +
      ` * ${navTrips.length} set-to-set trips, ${usable.length} of them fully understood.\n` +
      ` * Regenerate: npx tsx taoot/tools/flowmap.ts gamefiles out/\n */\n` +
      `import type { ShipTrip } from "./shipgraph";\n\n` +
      `export const SHIP_TRIPS: ShipTrip[] = [\n${lines.join("\n")}\n];\n`,
  );
  console.log(`  nav graph: ${usable.length}/${navTrips.length} trips walkable -> taoot/tests/playthrough/nav/shipgraph.gen.ts`);
  const top = [...unparsedTerms].sort((a, b) => b[1] - a[1]).slice(0, 14);
  for (const [t, n] of top) console.log(`    unparsed x${String(n).padStart(3)}  ${t}`);
}

// render the self-contained interactive page and publish it into the docs site
const flowMapHtml = buildFlowMapHtml(sceneGraph);
const here = dirname(fileURLToPath(import.meta.url));
const docsPublic = join(here, "..", "docs", "public");
let published = false;
if (existsSync(docsPublic)) {
  // Serve as a directory index (flow-map/index.html), NOT flow-map.html:
  // VitePress `cleanUrls` 301-redirects any *.html URL to its extensionless
  // form, which 404s for a public asset. A directory index is left alone.
  const mapDir = join(docsPublic, "flow-map");
  mkdirSync(mapDir, { recursive: true });
  writeFileSync(join(mapDir, "index.html"), flowMapHtml);
  const vendorDir = join(mapDir, "vendor");
  mkdirSync(vendorDir, { recursive: true });
  const nm = join(here, "..", "node_modules");
  // fcose 2.x needs cose-base 2.x / layout-base 2.x — take them from fcose's
  // own nested node_modules, not the top-level 1.x copies (cose-bilkent's).
  const fc = join(nm, "cytoscape-fcose");
  const vendorFiles: [string, string][] = [
    [join(nm, "cytoscape", "dist", "cytoscape.umd.js"), "cytoscape.umd.js"],
    [join(fc, "node_modules", "layout-base", "layout-base.js"), "layout-base.js"],
    [join(fc, "node_modules", "cose-base", "cose-base.js"), "cose-base.js"],
    [join(fc, "cytoscape-fcose.js"), "cytoscape-fcose.js"],
  ];
  for (const [src, name] of vendorFiles) {
    const dest = join(vendorDir, name);
    if (!existsSync(dest) && existsSync(src)) copyFileSync(src, dest);
  }
  published = existsSync(join(vendorDir, "cytoscape.umd.js"));
  if (published) console.log("    served at /flow-map/ (directory index; cleanUrls-safe)");
}

// ---- FLOW.md ----
const md: string[] = [];
md.push("# TAOOT — reconstructed mission / game flow");
md.push("");
md.push(
  "_Generated by `taoot/tools/flowmap.ts` directly from the decoded scripts — no additional TI.EXE reverse engineering. " +
    "Every entry is a flow event lifted from the AST together with the guard conditions that lead to it._",
);
md.push("");
md.push(
  `Coverage: **${filesScanned}** container files, **${scriptsParsed}** scripts parsed ` +
    `(${parseFailures} unparseable), **${events.length}** flow events extracted.`,
);
md.push("");

// section: flow-state globals
md.push("## Flow-state globals");
md.push("");
md.push("Globals that gate branching, ranked by how often they are read in a condition.");
md.push("");
md.push("| global | condition reads | values written |");
md.push("|---|---:|---|");
for (const r of gRows.slice(0, 30))
  md.push(`| \`${r.g}\` | ${r.reads} | ${r.values.map((v) => `\`${v}\``).join(", ") || "—"} |`);
md.push("");

// section: mission progression graph (mermaid)
md.push("## Mission progression graph");
md.push("");
md.push(
  "`mission` (1–4) × `phase` are the primary axes. Edges are `mission`/`phase` writes; " +
    "the source node is the best-known `mission=…`/`phase=…` guard in scope (`?` = unguarded / computed). " +
    "A `mission` bump is shown resetting phase to 0 (approximate).",
);
md.push("");
md.push("```mermaid");
md.push("graph LR");
const nodeIds = new Map<string, string>();
const nid = (n: string) => {
  if (!nodeIds.has(n)) nodeIds.set(n, `n${nodeIds.size}`);
  return nodeIds.get(n)!;
};
for (const e of edgeMap.values()) {
  if (e.from === e.to) continue;
  const lbl = e.count > 1 ? `|${e.count}×|` : "";
  md.push(`  ${nid(e.from)}["${e.from}"] -->${lbl} ${nid(e.to)}["${e.to}"]`);
}
md.push("```");
md.push("");

// section: story beats — where the progression helpers are called
md.push("## Story beats — where the story advances");
md.push("");
md.push(
  "Call sites of the BOOTFILE progression helpers (`advanceday`/`advancephase`/`advancetour`). " +
    "These are the concrete moments — mostly inside conversations — that push `mission`/`phase` forward. " +
    "The `mission = …`/`phase = …` guards show which story beat each one is.",
);
md.push("");
const beats = events.filter((e) => e.kind === "beat");
const byFileBeat = groupBy(beats, (e) => e.file);
for (const [file, evs] of byFileBeat) {
  md.push(`### ${file}`);
  md.push("");
  for (const e of evs) {
    const guard = e.guards.length ? `\`${e.guards.join(" & ")}\`` : "_(unconditional)_";
    md.push(`- **${e.detail}** — container ${e.container} \`${e.handler}\`  \n  when ${guard}`);
  }
  md.push("");
}

// section: transitions table
md.push("## Mission / phase transitions (with guards)");
md.push("");
md.push("Every literal write to `mission` or `phase`, with the conditions that gate it.");
md.push("");
const stateEvents = events.filter(
  (e) => e.kind === "state" && (e.target === "mission" || e.target === "phase"),
);
// group by file
const byFileState = groupBy(stateEvents, (e) => e.file);
for (const [file, evs] of byFileState) {
  md.push(`### ${file}`);
  md.push("");
  for (const e of evs) {
    const guard = e.guards.length ? `\`${e.guards.join(" & ")}\`` : "_(unconditional)_";
    md.push(`- **${e.detail}** — container ${e.container} \`${e.handler}\`  \n  when ${guard}`);
  }
  md.push("");
}

// section: what changes per mission — travel/actor/movie gated by mission/phase
md.push("## Branches gated by mission / phase");
md.push("");
md.push(
  "Travel, character placement and cutscenes whose guards mention `mission` or `phase` — " +
    "i.e. what the world does differently as the story advances.",
);
md.push("");
const gated = events.filter(
  (e) =>
    (e.kind === "travel" || e.kind === "actor" || e.kind === "movie") &&
    e.guards.some((g) => /\b(mission|phase)\b/.test(g)),
);
const byFileGated = groupBy(gated, (e) => e.file);
for (const [file, evs] of byFileGated) {
  md.push(`### ${file}`);
  md.push("");
  for (const e of evs) {
    const guard = e.guards.filter((g) => /\b(mission|phase)\b/.test(g)).join(" & ");
    md.push(`- \`[${e.kind}]\` ${e.detail} — \`${e.handler}\` when \`${guard}\``);
  }
  md.push("");
}

// section: progress() gates
md.push("## `progress()` gates");
md.push("");
md.push("Points where the game checks whether the player has reached at least a given `mission.phase`.");
md.push("");
const gates = events.filter((e) => e.kind === "gate");
const byFileGate = groupBy(gates, (e) => e.file);
for (const [file, evs] of byFileGate) {
  const uniq = [...new Set(evs.map((e) => e.detail))].sort();
  md.push(`- **${file}**: ${uniq.map((d) => `\`${d}\``).join(", ")}`);
}
md.push("");

writeFileSync(join(flowDir, "FLOW.md"), md.join("\n"));

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    let a = m.get(k);
    if (!a) m.set(k, (a = []));
    a.push(it);
  }
  return m;
}

/**
 * A self-contained interactive scene-travel map (Cytoscape.js, `cose` layout).
 * Nodes = sets (rooms) and the non-SET scripts that trigger travel; edges =
 * changeset/gotospecial/opensetfile/jumppapa, coloured by mission gate. The
 * page references `vendor/cytoscape.umd.js` (vendored into docs/public).
 */
function buildFlowMapHtml(graph: { nodes: unknown[]; edges: unknown[] }): string {
  const data = JSON.stringify(graph);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TAOOT — scene-travel map</title>
<style>
  :root {
    --bg:#ffffff; --fg:#1a1a1a; --muted:#666; --panel:#f7f7f8; --border:#e2e2e5;
    --chip:#ececed; --accent:#3451b2;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#1b1b1f; --fg:#e6e6e8; --muted:#9a9aa2; --panel:#232329;
            --border:#33333b; --chip:#2c2c34; --accent:#7c93f0; }
  }
  * { box-sizing:border-box; }
  html,body { margin:0; height:100%; background:var(--bg); color:var(--fg);
    font:13px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  #bar { display:flex; flex-wrap:wrap; align-items:center; gap:10px;
    padding:8px 12px; border-bottom:1px solid var(--border); background:var(--panel); }
  #bar h1 { font-size:13px; font-weight:600; margin:0 8px 0 0; }
  .grp { display:flex; align-items:center; gap:4px; }
  .lbl { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
  .mbtn { cursor:pointer; border:1px solid var(--border); border-radius:20px;
    padding:2px 10px; font-size:12px; background:var(--bg); color:var(--fg); opacity:.45; }
  .mbtn.on { opacity:1; font-weight:600; }
  .mbtn .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:5px; vertical-align:middle; }
  input[type=search] { border:1px solid var(--border); border-radius:6px; padding:3px 8px;
    background:var(--bg); color:var(--fg); font-size:12px; width:150px; }
  label.ck { display:flex; align-items:center; gap:4px; font-size:12px; cursor:pointer; }
  button.act { cursor:pointer; border:1px solid var(--border); border-radius:6px; padding:3px 10px;
    background:var(--bg); color:var(--fg); font-size:12px; }
  #stage { display:flex; height:calc(100vh - 43px); }
  #cy { flex:1; height:100%; }
  #info { width:340px; max-width:45vw; border-left:1px solid var(--border);
    background:var(--panel); overflow:auto; padding:12px 14px; }
  #info h2 { font-size:14px; margin:0 0 2px; }
  #info .sub { color:var(--muted); font-size:11px; margin-bottom:12px; }
  #info .empty { color:var(--muted); }
  .trip { border-top:1px solid var(--border); padding:8px 0; }
  .trip .to { font-weight:600; }
  .trip .meta { color:var(--muted); font-size:11px; }
  .trip code { background:var(--chip); padding:1px 4px; border-radius:4px; font-size:11px;
    word-break:break-word; }
  .sec { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted);
    margin:14px 0 2px; }
</style>
</head>
<body>
  <div id="bar">
    <h1>Scene-travel map</h1>
    <div class="grp"><span class="lbl">mission</span>
      <span class="mbtn on" data-m="1"><span class="dot" style="background:#4f9dde"></span>1</span>
      <span class="mbtn on" data-m="2"><span class="dot" style="background:#57b894"></span>2</span>
      <span class="mbtn on" data-m="3"><span class="dot" style="background:#e0a458"></span>3</span>
      <span class="mbtn on" data-m="4"><span class="dot" style="background:#d9534f"></span>4</span>
      <span class="mbtn on" data-m="any"><span class="dot" style="background:#9aa0a6"></span>ungated</span>
    </div>
    <label class="ck"><input type="checkbox" id="ctx"> scripts (PUP/SHP/…)</label>
    <input type="search" id="q" placeholder="find a set…">
    <button class="act" id="fit">Fit</button>
    <button class="act" id="relayout">Re-layout</button>
  </div>
  <div id="stage">
    <div id="cy"></div>
    <aside id="info"><div class="empty">Click a room to see where you can go, and how you got there.</div></aside>
  </div>
  <script src="vendor/cytoscape.umd.js"></script>
  <script src="vendor/layout-base.js"></script>
  <script src="vendor/cose-base.js"></script>
  <script src="vendor/cytoscape-fcose.js"></script>
  <script>
    if (window.cytoscapeFcose) cytoscape.use(window.cytoscapeFcose);
    var DATA = ${data};
    var MC = { "1":"#4f9dde", "2":"#57b894", "3":"#e0a458", "4":"#d9534f", "any":"#9aa0a6" };
    var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    function primary(missions){
      var nums = missions.filter(function(m){return m!=="any";}).map(Number).sort(function(a,b){return a-b;});
      return nums.length ? String(nums[0]) : "any";
    }
    function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]; }); }

    var elements = [];
    DATA.nodes.forEach(function(n){
      elements.push({ data:{ id:n.id, label:n.label, type:n.type, degree:n.degree,
        missions:n.missions, pm:primary(n.missions) } });
    });
    DATA.edges.forEach(function(e){
      elements.push({ data:{ id:e.id, source:e.source, target:e.target, count:e.count,
        missions:e.missions, pm:primary(e.missions), trips:e.trips } });
    });

    var cy = cytoscape({
      container: document.getElementById("cy"),
      elements: elements,
      wheelSensitivity: 0.2,
      style: [
        { selector:"node", style:{
          "label":"data(label)", "font-size":8, "color": dark?"#e6e6e8":"#1a1a1a",
          "text-valign":"center", "text-halign":"center",
          "background-color": function(el){ return MC[el.data("pm")]; },
          "shape": function(el){ return el.data("type")==="context" ? "diamond" : "round-rectangle"; },
          "width": function(el){ return Math.max(26, el.data("label").length*5.5); },
          "height": function(el){ return el.data("type")==="context" ? 26 : 20; },
          "border-width":0, "text-outline-width":2,
          "text-outline-color": dark?"#1b1b1f":"#ffffff" } },
        { selector:"node[?context]", style:{} },
        { selector:"edge", style:{
          "curve-style":"bezier", "target-arrow-shape":"triangle",
          "width": function(el){ return Math.min(1 + el.data("count"), 6); },
          "line-color": function(el){ return MC[el.data("pm")]; },
          "target-arrow-color": function(el){ return MC[el.data("pm")]; },
          "arrow-scale":0.8, "opacity":0.75 } },
        { selector:".hidden", style:{ "display":"none" } },
        { selector:".dim", style:{ "opacity":0.08 } },
        { selector:".match", style:{ "border-width":3, "border-color": dark?"#fff":"#111" } },
        { selector:".sel", style:{ "border-width":3, "border-color":"#3451b2" } },
        { selector:"edge.hl", style:{ "opacity":1, "width":4, "z-index":9 } }
      ],
      layout: layoutCfg()
    });

    function layoutCfg(){
      if (window.cytoscapeFcose)
        return { name:"fcose", quality:"proof", animate:false, randomize:true, padding:50,
          nodeSeparation:130, idealEdgeLength:110, nodeRepulsion:9000, gravity:0.2,
          numIter:2500, nodeDimensionsIncludeLabels:true, packComponents:true };
      // fallback if fcose failed to load
      return { name:"cose", animate:false, padding:40, nodeRepulsion:12000,
        idealEdgeLength:110, gravity:0.2, numIter:2000, nodeDimensionsIncludeLabels:true };
    }

    function activeMissions(){
      var s = {};
      [].forEach.call(document.querySelectorAll(".mbtn.on"), function(b){ s[b.dataset.m]=1; });
      return s;
    }
    function applyFilters(){
      var act = activeMissions();
      var hideCtx = !document.getElementById("ctx").checked;
      cy.batch(function(){
        cy.edges().forEach(function(e){
          var missOk = e.data("missions").some(function(m){ return act[m]; });
          var ctxOk = !hideCtx || (e.source().data("type")!=="context" && e.target().data("type")!=="context");
          e.toggleClass("hidden", !(missOk && ctxOk));
        });
        cy.nodes().forEach(function(n){
          if (hideCtx && n.data("type")==="context"){ n.addClass("hidden"); return; }
          var visible = n.connectedEdges().some(function(e){ return !e.hasClass("hidden"); });
          n.toggleClass("hidden", !visible);
        });
      });
    }

    [].forEach.call(document.querySelectorAll(".mbtn"), function(b){
      b.addEventListener("click", function(){ b.classList.toggle("on"); applyFilters(); });
    });
    document.getElementById("ctx").addEventListener("change", applyFilters);
    document.getElementById("fit").addEventListener("click", function(){ cy.animate({fit:{padding:40}},{duration:300}); });
    document.getElementById("relayout").addEventListener("click", function(){ cy.layout(layoutCfg()).run(); });

    document.getElementById("q").addEventListener("input", function(ev){
      var q = ev.target.value.trim().toLowerCase();
      cy.batch(function(){
        cy.nodes().forEach(function(n){
          var hit = q && n.id().indexOf(q) >= 0;
          n.toggleClass("match", !!hit);
          n.toggleClass("dim", !!q && !hit);
        });
      });
      if (q){ var m = cy.nodes(".match"); if (m.length) cy.animate({fit:{eles:m,padding:120}},{duration:300}); }
    });

    function tripHtml(t, dir){
      var loc = t.from + (t.handler ? " ["+t.handler+"]" : "");
      var sv = [t.scene, t.view].filter(Boolean).join(" / ");
      var g = t.guard ? "<div class='meta'>when <code>"+esc(t.guard)+"</code></div>" : "<div class='meta'>unconditional</div>";
      // both CDs ship the shared public rooms, each in its own act's state; an
      // exit present on only one is act-specific routing, so say which
      var d = (t.discs && t.discs.length === 1) ? "<div class='meta'>CD"+t.discs[0]+" only</div>" : "";
      return "<div class='trip'><div class='to'>"+dir+" "+esc(t.op)+"("+esc(sv)+")</div>"+
        g + d + "<div class='meta'>from "+esc(loc)+"</div></div>";
    }
    function showNode(n){
      cy.elements().removeClass("sel hl");
      n.addClass("sel");
      var outs=[], ins=[];
      n.connectedEdges().forEach(function(e){
        if (e.hasClass("hidden")) return;
        e.addClass("hl");
        var trips = e.data("trips");
        if (e.source().id()===n.id()) trips.forEach(function(t){ outs.push(["→ "+e.target().data("label"), t]); });
        else trips.forEach(function(t){ ins.push(["← "+e.source().data("label"), t]); });
      });
      var h = "<h2>"+esc(n.data("label"))+"</h2><div class='sub'>"+
        (n.data("type")==="context"?"script trigger":"set / room")+
        " · reached in mission "+(n.data("missions").join(", "))+"</div>";
      h += "<div class='sec'>goes to ("+outs.length+")</div>";
      h += outs.length ? outs.map(function(p){ return tripHtml(p[1], p[0]); }).join("") : "<div class='empty'>—</div>";
      h += "<div class='sec'>reached from ("+ins.length+")</div>";
      h += ins.length ? ins.map(function(p){ return tripHtml(p[1], p[0]); }).join("") : "<div class='empty'>—</div>";
      document.getElementById("info").innerHTML = h;
    }
    cy.on("tap","node", function(ev){ showNode(ev.target); });
    cy.on("tap", function(ev){
      if (ev.target === cy){
        cy.elements().removeClass("sel hl");
        document.getElementById("info").innerHTML = "<div class='empty'>Click a room to see where you can go, and how you got there.</div>";
      }
    });
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// console summary
// ---------------------------------------------------------------------------

console.log(`files scanned:     ${filesScanned}`);
console.log(`scripts parsed:    ${scriptsParsed}  (${parseFailures} unparseable)`);
console.log(`flow events:       ${events.length}`);
const byKind = groupBy(events, (e) => e.kind);
for (const k of ["state", "beat", "travel", "actor", "movie", "puppet", "gate"] as EventKind[])
  console.log(`  ${k.padEnd(8)} ${byKind.get(k)?.length ?? 0}`);
console.log(`flow globals:      ${flowGlobals.size}`);
console.log(`mission/phase transitions: ${transitions.length}  (${edgeMap.size} distinct edges)`);
console.log(`\ntop flow globals by condition-reads:`);
for (const r of gRows.slice(0, 12))
  console.log(`  ${r.g.padEnd(16)} reads=${String(r.reads).padStart(4)}  values: ${r.values.join(", ")}`);
const tripCount = graphEdges.reduce((n, e) => n + e.trips.length, 0);
const perAct = (d: 1 | 2) => graphEdges.reduce((n, e) => n + e.trips.filter((t) => t.discs.length === 1 && t.discs[0] === d).length, 0);
console.log(`scene graph:       ${graphNodes.length} nodes, ${graphEdges.length} edges, ${tripCount} trips`);
console.log(`  per-act variants: ${discVariants} script(s) differ between the CDs`);
console.log(`  trips only on CD1: ${perAct(1)}   only on CD2: ${perAct(2)}   on both: ${tripCount - perAct(1) - perAct(2)}`);
console.log(`\nwrote ${join(flowDir, "FLOW.md")} (+ globals.tsv, flow.json, phase-graph.json, scene-graph.json)`);
console.log(
  published
    ? `published interactive map -> docs/public/flow-map/index.html`
    : `(docs/public not found — skipped publishing the interactive map)`,
);
