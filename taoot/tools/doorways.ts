/**
 * Extract every door hotspot in the ship, and the doorway each one opens.
 *
 *   npx tsx taoot/tools/doorways.ts
 *
 * This is what lets `/freeroam/` open a door the story would keep shut. The
 * mechanism the whole page turns on is one line of shipped script, repeated
 * across the ship:
 *
 *     sendtoprop ("door", setupprop ("hallb-b59"))
 *
 * `door` is a single prop the game moves from doorway to doorway. `setupprop`
 * stands it up in the one this hotspot belongs to and plays it open; every
 * walk-through in the corpus then reads `propvisible ("door")` before it will
 * take the step. So the doorway id IS the key to the room, and it is written in
 * the hotspot's own script — which is where this reads it.
 *
 * ## Where a hotspot lives
 *
 * A view's hotspots are its 2D objects ({@link ObjectEntry}), each carrying an
 * identifier and a script container. The three the game treats as doors are the
 * three boot's SPACE key looks for:
 *
 *     if paint = "door" | paint = "locked" | paint = "knock"
 *         sendtopainting (currentscene (), currentview (), paint, mousedown (0))
 *
 * so those are the three collected here, under whatever the artists spelled
 * (`door2`, `knock1` and so on are matched by prefix).
 *
 * ## Why the guards come with it
 *
 * Some hotspots open one of SEVERAL doorways, and which one is a condition:
 * C-78's door is `c78-hallc d` or `c78-hallc l` by `whitelight`, the corridor
 * junctions are port or starboard by `hallside`, and the purser's stairwell
 * picks by `savedeck`. A table of ids alone could not tell them apart, so each
 * id is emitted with the comparisons it sits under, and the page keeps the one
 * whose comparisons hold right now ({@link pickDoorway} in
 * `taoot/src/freeroam/doors.ts`).
 *
 * Only comparisons of a plain global against a literal are kept — those are the
 * ones a page can answer from `interp.globals`. A doorway under anything richer
 * comes through with no conditions and is simply always eligible, which is the
 * safe direction: the worst case is opening a door that was already open.
 *
 * ## ...and where it leads, if anywhere
 *
 * Not every door with a doorway is a way through. `clarisdoor` on D deck opens
 * so that Claris can stand in it and be talked to; the corridor's `uparrow`
 * handlers are at two other views entirely, and there is no room behind D-19 in
 * the game at all. Penny's on F deck and Shay's below are the same shape.
 *
 * So each hotspot also carries the sets a walk-through from ITS view reaches —
 * read out of the same room's `keydown` handlers, which all have one form:
 *
 *     if currentview () = "view40" & arg = "uparrow" & propvisible ("door")
 *         sendtostage (gotospecial ("b59", "scene14", "view19"))
 *
 * An empty list means opening this door shows you a doorway and nothing else,
 * which is a thing free roam should decline to do rather than do badly.
 *
 * ## Both discs
 *
 * 21 rooms ship on both CDs, each in its own act's state, and a hotspot can
 * differ between them — or exist on only one, which Penny's door on F deck does.
 * Each disc is read separately and the results are merged: a hotspot both carry
 * and agree about is emitted once with `disc: 0`, and anything else is emitted
 * once per disc that has it, named.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gamefiles, gamefilesRoot, type Disc } from "./gamefiles";
import { readSetFile, type SetFile } from "@dreamfactory/engine/df/set";
import { sniffScript } from "@dreamfactory/engine/df/script";
import { parseScript } from "@dreamfactory/engine/runtime/parser";
import type { Expr, Stmt } from "@dreamfactory/engine/runtime/ast";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "freeroam", "doors.gen.ts");

/** the hotspot names boot's SPACE key treats as a door, by prefix */
const DOORISH = /^(door|locked|knock)/i;

/** a comparison of a global against a literal — all a page can answer */
interface Cond {
  var: string;
  op: "=" | "!=" | "<" | "<=" | ">" | ">=";
  value: string | number | boolean;
}

/**
 * Names in a guard that are not globals a page can read.
 *
 * `arg` is the handler's own parameter — the key that was pressed — and every
 * walk-through tests it. Recording `arg = "uparrow"` as a condition would have a
 * page asking `interp.globals` for a name that is not there and reading a
 * refusal out of the answer.
 */
const NOT_A_GLOBAL = new Set(["arg", "count", "temp"]);

/** the comparison that holds when this one does not */
const NEGATED: Record<Cond["op"], Cond["op"]> = {
  "=": "!=",
  "!=": "=",
  "<": ">=",
  ">=": "<",
  ">": "<=",
  "<=": ">",
};

interface Doorway {
  id: string;
  /** the alternative condition-sets this id appears under; `[]` = unconditional */
  when: Cond[][];
}

/** one room an `uparrow` from a view can reach, where in it, and when */
interface Lead {
  to: string;
  /** the scene and view the script's own `gotospecial` names */
  scene: string;
  view: string;
  when: Cond[][];
}

interface Spot {
  set: string;
  scene: string;
  view: string;
  paint: string;
  disc: 0 | Disc;
  doorways: Doorway[];
  /** the walk-throughs an `uparrow` from this view can make */
  leads: Lead[];
}

/**
 * The comparisons in one `if` condition, as far as they are a global against a
 * literal. `a & b` contributes both; anything else contributes nothing, which
 * leaves the doorway less conditional than it really is and so always eligible.
 */
function conds(e: Expr, negate: boolean): Cond[] {
  if (e.t === "un" && e.op === "not") return conds(e.e, !negate);
  // `A & B` is both; `not (A | B)` is both negated, which is the same shape and
  // the one an early `exitcode` produces — see {@link collect}
  if (e.t === "bin" && (e.op === "&" || e.op === "and") && !negate) {
    return [...conds(e.l, false), ...conds(e.r, false)];
  }
  if (e.t === "bin" && (e.op === "|" || e.op === "or") && negate) {
    return [...conds(e.l, true), ...conds(e.r, true)];
  }
  if (e.t === "bin" && e.op in NEGATED) {
    const lit = (x: Expr): Cond["value"] | undefined =>
      x.t === "str" ? x.v : x.t === "int" ? x.v : x.t === "bool" ? x.v : undefined;
    // `mission < 4` and `4 > mission` are the same fact; the operator flips with
    // the operands so the global is always on the left
    const flip: Record<string, Cond["op"]> = {
      "=": "=",
      "!=": "!=",
      "<": ">",
      ">": "<",
      "<=": ">=",
      ">=": "<=",
    };
    let name: string | undefined;
    let value: Cond["value"] | undefined;
    let op = e.op as Cond["op"];
    if (e.l.t === "var") {
      name = e.l.name;
      value = lit(e.r);
    } else if (e.r.t === "var") {
      name = e.r.name;
      value = lit(e.l);
      op = flip[e.op] ?? op;
    }
    if (name === undefined || value === undefined) return [];
    if (NOT_A_GLOBAL.has(name.toLowerCase())) return [];
    return [{ var: name.toLowerCase(), op: negate ? NEGATED[op] : op, value }];
  }
  // a bare `if tour` / `if not tour` is a comparison against false
  if (e.t === "var" && !NOT_A_GLOBAL.has(e.name.toLowerCase())) {
    return [{ var: e.name.toLowerCase(), op: negate ? "=" : "!=", value: false }];
  }
  return [];
}

/**
 * What an early `exitcode` leaves true for the statements below it.
 *
 * Negating the branch's whole condition is usually worth nothing: `not (A & B &
 * C)` is a disjunction and says only that one of them failed. But a walk-through
 * guard's first conjuncts are always the standpoint — `currentview () =
 * "view12" & arg = "uparrow"` — and those are the very facts the branch BELOW it
 * also tests, so they are known true where this is used. Dropping them leaves
 * the part that really decided it:
 *
 *     not (currentview() = "view12" & arg = "uparrow" & (tour | mission < 4))
 *       ...given the first two hold...
 *     = not (tour | mission < 4)  =  tour = false & mission >= 4
 *
 * which is why the 1st Class Lounge is a mission-4 room and not a tour one.
 * Where more than one condition is left the answer is honestly nothing, because
 * a disjunction of failures is not a fact.
 */
function afterExit(e: Expr): Cond[] {
  const rest: Expr[] = [];
  const split = (x: Expr): void => {
    if (x.t === "bin" && (x.op === "&" || x.op === "and")) {
      split(x.l);
      split(x.r);
      return;
    }
    const positional =
      x.t === "bin" &&
      x.op === "=" &&
      ((x.l.t === "call" && /^current(view|scene)$/i.test(x.l.name)) ||
        (x.l.t === "var" && NOT_A_GLOBAL.has(x.l.name.toLowerCase())));
    if (!positional) rest.push(x);
  };
  split(e);
  return rest.length === 1 ? conds(rest[0], true) : [];
}

/**
 * Does this branch stop the handler where it stands?
 *
 * `exitcode` ends the handler, so everything AFTER an `if C ... exitcode ...
 * endif` only runs when C did not hold — and that is not a detail. The lounge's
 * own walk-through is behind one:
 *
 *     if currentview () = "view12" & arg = "uparrow" & (tour | mission < 4)
 *         exitcode
 *     endif
 *     if currentview () = "view12" & arg = "uparrow" & propvisible ("door")
 *         ...gotospecial ("lounge1c", ...)
 *
 * so in a tour the step is refused before the door is even looked at, and a
 * reader that walked only the enclosing `if`s would report the lounge as a room
 * you can walk into. Whether the branch RETURNS is therefore carried, and its
 * condition is negated onto everything below it.
 */
function exits(stmts: Stmt[]): boolean {
  return stmts.some(
    (st) =>
      st.t === "exitcode" ||
      st.t === "return" ||
      (st.t === "callstmt" && /^(error|quit)$/i.test(st.call.name)) ||
      (st.t === "if" && !!st.else_ && exits(st.then) && exits(st.else_)),
  );
}

/** one `setupprop` call site: the doorway and the comparisons above it */
interface Site {
  id: string;
  when: Cond[];
}

/** walk a handler body, carrying the comparisons each statement sits under */
function collect(stmts: Stmt[], when: Cond[], out: Site[]): void {
  const fromExpr = (e: Expr): void => {
    if (e.t === "call") {
      if (e.name.toLowerCase() === "setupprop") {
        const a = e.args[0];
        if (a?.t === "str") out.push({ id: a.v, when: [...when] });
      }
      for (const a of e.args) fromExpr(a);
    } else if (e.t === "bin") {
      fromExpr(e.l);
      fromExpr(e.r);
    } else if (e.t === "un") {
      fromExpr(e.e);
    }
  };
  // everything below an `if C ... exitcode` is reached only when C did not hold
  let below: Cond[] = [];
  for (const s of stmts) {
    const here = [...when, ...below];
    switch (s.t) {
      case "callstmt":
        fromExpr(s.call);
        break;
      case "assign":
        fromExpr(s.value);
        break;
      case "if":
        collect(s.then, [...here, ...conds(s.cond, false)], out);
        if (s.else_) collect(s.else_, [...here, ...conds(s.cond, true)], out);
        if (exits(s.then) && !s.else_) below = [...below, ...afterExit(s.cond)];
        break;
      case "switch": {
        const name = s.subject.t === "var" ? s.subject.name.toLowerCase() : undefined;
        for (const c of s.cases) {
          const lit =
            c.match.t === "str" ? c.match.v : c.match.t === "int" ? c.match.v : undefined;
          const extra: Cond[] =
            name !== undefined && lit !== undefined ? [{ var: name, op: "=", value: lit }] : [];
          collect(c.body, [...here, ...extra], out);
        }
        break;
      }
      case "while":
      case "for":
        collect(s.body, here, out);
        break;
    }
  }
}

/**
 * Every `uparrow` walk-through in a set, as view -> the sets it reaches.
 *
 * Only the ones gated on `propvisible ("door")`, because those are the ones a
 * door being open is the key to. A view whose exit needs something else — the
 * grand staircase's bare `currentscene()` tests, D deck's `actorvisible
 * ("cash")` — is not a door this page can help with.
 */
function walkThroughs(set: SetFile): Map<string, Lead[]> {
  const out = new Map<string, Lead[]>();
  const add = (view: string, dest: Omit<Lead, "when">, when: Cond[]): void => {
    const list = out.get(view.toLowerCase()) ?? [];
    // keyed by the whole destination: the lounge is reached at two different
    // standpoints depending on which staircase you came up, and which one is
    // right is the condition on the arm
    const seen = list.find(
      (l) => l.to === dest.to && l.scene === dest.scene && l.view === dest.view,
    );
    const arm = JSON.stringify(when);
    if (!seen) list.push({ ...dest, when: when.length ? [when] : [] });
    else if (!when.length) seen.when = [];
    else if (seen.when.length && !seen.when.some((w) => JSON.stringify(w) === arm)) {
      seen.when.push(when);
    }
    out.set(view.toLowerCase(), list);
  };
  for (const c of set.file.containers) {
    const toks = sniffScript(c.data);
    if (!toks) continue;
    let script;
    try {
      script = parseScript(toks);
    } catch {
      continue;
    }
    const code = script.codes.get("keydown");
    if (!code) continue;
    const visit = (
      stmts: Stmt[],
      view: string | null,
      door: boolean,
      when: Cond[],
    ): void => {
      // ...and the same early-exit rule the doorway walker follows: the lounge's
      // own step is below an `if (tour | mission < 4) exitcode`
      let below: Cond[] = [];
      for (const st of stmts) {
        const here = [...when, ...below];
        if (st.t === "if") {
          const facts = guardFacts(st.cond);
          visit(st.then, facts.view ?? view, door || facts.door, [
            ...here,
            ...conds(st.cond, false),
          ]);
          if (st.else_) visit(st.else_, view, door, [...here, ...conds(st.cond, true)]);
          if (exits(st.then) && !st.else_) below = [...below, ...afterExit(st.cond)];
        } else if (st.t === "switch") {
          const name = st.subject.t === "var" ? st.subject.name.toLowerCase() : undefined;
          for (const cse of st.cases) {
            const lit =
              cse.match.t === "str" ? cse.match.v : cse.match.t === "int" ? cse.match.v : undefined;
            const extra: Cond[] =
              name !== undefined && lit !== undefined ? [{ var: name, op: "=", value: lit }] : [];
            visit(cse.body, view, door, [...here, ...extra]);
          }
        } else if (st.t === "while" || st.t === "for") {
          visit(st.body, view, door, here);
        } else if (st.t === "callstmt" && view && door) {
          for (const dest of travelTargets(st.call)) add(view, dest, here);
        }
      }
    };
    visit(code.body, null, false, []);
  }
  return out;
}

/** the two things a walk-through's guard has to say */
function guardFacts(e: Expr): { view: string | null; door: boolean } {
  let view: string | null = null;
  let door = false;
  const walk = (x: Expr): void => {
    if (x.t === "bin") {
      if (
        x.op === "=" &&
        x.l.t === "call" &&
        x.l.name.toLowerCase() === "currentview" &&
        x.r.t === "str"
      ) {
        view = x.r.v;
      }
      walk(x.l);
      walk(x.r);
    } else if (x.t === "un") {
      walk(x.e);
    } else if (x.t === "call") {
      if (x.name.toLowerCase() === "propvisible" && x.args[0]?.t === "str" && x.args[0].v === "door") {
        door = true;
      }
      for (const a of x.args) walk(a);
    }
  };
  walk(e);
  return { view, door };
}

/**
 * The room a `gotospecial`/`changeset` names, wherever it is nested.
 *
 * All three arguments, because the standpoint is part of the answer: the lounge
 * is entered at `scene10/view16` from one staircase and `scene14/view37` from
 * the other, and a page that has to take the step itself must take the game's
 * own — not a guess at which side of the room you came in on.
 */
function travelTargets(e: Expr): Omit<Lead, "when">[] {
  const out: Omit<Lead, "when">[] = [];
  const walk = (x: Expr): void => {
    if (x.t === "call") {
      const n = x.name.toLowerCase();
      if (
        (n === "gotospecial" || n === "changeset") &&
        x.args[0]?.t === "str" &&
        x.args[1]?.t === "str" &&
        x.args[2]?.t === "str"
      ) {
        out.push({
          to: x.args[0].v.toLowerCase(),
          scene: x.args[1].v.toLowerCase(),
          view: x.args[2].v.toLowerCase(),
        });
      }
      for (const a of x.args) walk(a);
    } else if (x.t === "bin") {
      walk(x.l);
      walk(x.r);
    } else if (x.t === "un") {
      walk(x.e);
    }
  };
  walk(e);
  return out;
}

/** every door hotspot on one disc */
function readDisc(disc: Disc): Map<string, Spot> {
  const index = gamefiles(gamefilesRoot());
  index.setDisc(disc);
  const spots = new Map<string, Spot>();
  for (const name of index.names()) {
    if (!name.endsWith(".set")) continue;
    // the copy on THIS disc, or nothing: `resolve` falls back to the other CD
    // for a room that ships on one only, and a fallback row would claim the
    // wrong act's doorways for a disc that never had that room
    const path = index.resolve(name);
    if (!path || !new RegExp(`titanic${disc}`, "i").test(path)) continue;
    const bytes = index.provider(name);
    if (!bytes) continue;
    let set;
    try {
      set = readSetFile(bytes);
    } catch {
      continue; // not a v4 room
    }
    const setName = name.replace(/\.set$/, "");
    const exits = walkThroughs(set);
    for (const scene of set.scenes) {
      for (const view of scene.views) {
        for (const obj of view.objects) {
          if (!DOORISH.test(obj.identifier) || !obj.locationScript) continue;
          const toks = sniffScript(set.file.containers[obj.locationScript].data);
          if (!toks) continue;
          const sites: Site[] = [];
          try {
            for (const code of parseScript(toks).codes.values()) {
              collect(code.body, [], sites);
            }
          } catch {
            continue; // a container this parser cannot read opens no door
          }
          if (!sites.length) continue;
          // One id, however many arms call it: the choice a page has to make is
          // between DOORWAYS, and an id that appears six times under six
          // different story states is still the one door in this wall. The arms
          // are kept as alternatives so {@link pickDoorway} can score them.
          const doorways: Doorway[] = [];
          for (const site of sites) {
            const seen = doorways.find((d) => d.id === site.id);
            const arm = JSON.stringify(site.when);
            if (!seen) doorways.push({ id: site.id, when: site.when.length ? [site.when] : [] });
            else if (site.when.length && !seen.when.some((w) => JSON.stringify(w) === arm)) {
              seen.when.push(site.when);
            } else if (!site.when.length) seen.when = [];
          }
          const key = `${setName}\u0000${scene.sceneName}\u0000${view.viewName}\u0000${obj.identifier}`;
          spots.set(key, {
            set: setName,
            scene: scene.sceneName.toLowerCase(),
            view: view.viewName.toLowerCase(),
            paint: obj.identifier,
            disc: 0,
            doorways,
            leads: exits.get(view.viewName.toLowerCase()) ?? [],
          });
        }
      }
    }
  }
  return spots;
}

const one = readDisc(1);
const two = readDisc(2);
const shape = (s: Spot): string => JSON.stringify([s.doorways, s.leads]);

const spots: Spot[] = [];
for (const key of new Set([...one.keys(), ...two.keys()])) {
  const a = one.get(key);
  const b = two.get(key);
  // `0` means both CDs carry this hotspot AND agree about it. A hotspot only one
  // carries is NOT that, and saying so is not pedantry: Penny's door knocks on
  // the second disc and is not a door at all on the first, so a row marked
  // shared would name a doorway `setupprop` could not find.
  if (a && b && shape(a) === shape(b)) spots.push(a);
  else {
    if (a) spots.push({ ...a, disc: 1 });
    if (b) spots.push({ ...b, disc: 2 });
  }
}
spots.sort(
  (x, y) =>
    x.set.localeCompare(y.set) ||
    x.scene.localeCompare(y.scene) ||
    x.view.localeCompare(y.view) ||
    x.paint.localeCompare(y.paint) ||
    x.disc - y.disc,
);

const rows = spots
  .map(
    (s) =>
      `  { set: ${JSON.stringify(s.set)}, scene: ${JSON.stringify(s.scene)}, ` +
      `view: ${JSON.stringify(s.view)}, paint: ${JSON.stringify(s.paint)}, disc: ${s.disc},\n` +
      `    leads: [${s.leads
        .map(
          (l) =>
            `{ to: ${JSON.stringify(l.to)}, scene: ${JSON.stringify(l.scene)}, ` +
            `view: ${JSON.stringify(l.view)}, when: ${JSON.stringify(l.when)} }`,
        )
        .join(", ")}],\n` +
      `    doorways: [${s.doorways
        .map((d) => `{ id: ${JSON.stringify(d.id)}, when: ${JSON.stringify(d.when)} }`)
        .join(", ")}] },`,
  )
  .join("\n");

writeFileSync(
  OUT,
  `/**
 * Every door hotspot in the ship and the doorway it opens — GENERATED, do not edit.
 *
 * Regenerate with \`npx tsx taoot/tools/doorways.ts\`, which explains where a
 * hotspot lives and why the conditions travel with it. What it is FOR is in
 * \`taoot/src/freeroam/doors.ts\`.
 */

/** a comparison of one script global against a literal */
export interface DoorCond {
  var: string;
  op: "=" | "!=" | "<" | "<=" | ">" | ">=";
  value: string | number | boolean;
}

/** one room an \`uparrow\` from a hotspot's view can reach, and when */
export interface Lead {
  to: string;
  /** the standpoint in it the script's own \`gotospecial\` names */
  scene: string;
  view: string;
  /** the alternative condition-sets it is reachable under; \`[]\` = always */
  when: DoorCond[][];
}

/** one doorway this hotspot can stand the \`door\` prop up in */
export interface Doorway {
  /** the argument \`setupprop\` is called with */
  id: string;
  /**
   * The alternative condition-sets this doorway is called under in the
   * hotspot's own script — one entry per arm, every comparison in an arm
   * holding together. Empty means the script reaches it unconditionally.
   */
  when: DoorCond[][];
}

/** one door hotspot, in the view it is drawn in */
export interface DoorSpot {
  set: string;
  scene: string;
  view: string;
  /** the hotspot's own name — \`door\`, \`locked\`, \`knock\` and their variants */
  paint: string;
  /**
   * 0 when both CDs carry this hotspot and agree about it, else the CD this row
   * was read from — which also covers a hotspot only one CD has at all.
   */
  disc: 0 | 1 | 2;
  /**
   * The rooms an \`uparrow\` from this view can reach, and under what.
   *
   * Empty for a door that opens onto no room at all: \`clarisdoor\` on D deck,
   * Penny's on F and Shay's below are doorways a character stands in, and D-19
   * is not a place the game has. A lead whose conditions cannot hold is the
   * other way a door leads nowhere — the 1st Class Lounge's step is refused
   * outright in a tour, above the door rather than by it.
   */
  leads: Lead[];
  doorways: Doorway[];
}

export const DOOR_SPOTS: readonly DoorSpot[] = [
${rows}
];
`,
);

const ways = spots.reduce((n, s) => n + s.doorways.length, 0);
const split = spots.filter((s) => s.disc !== 0).length;
const many = spots.filter((s) => s.doorways.length > 1).length;
const blind = spots.filter((s) => s.leads.length === 0).length;
console.log(
  `${OUT}: ${spots.length} door hotspots, ${ways} doorways — ` +
    `${many} offer more than one, ${blind} lead nowhere, ${split} rows belong to one CD`,
);
