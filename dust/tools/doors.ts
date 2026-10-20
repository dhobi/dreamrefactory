/**
 * Every way out of every room in Dust, read off the scene scripts.
 *
 *   npx tsx dust/tools/doors.ts            # the whole map
 *   npx tsx dust/tools/doors.ts nite       # the rooms whose name starts so
 *
 * A Dust door is two handlers on the cell it is opened from. `mousedown` checks
 * the facing and a `pointin…` rectangle and sets the door prop's owner
 * (`sendtoprop ("door", setupprop ("saloon"))`), unless a `lock…` function
 * says no. Then `keydown` checks the same facing and that owner, and takes the
 * up arrow through: `gotointerior ("sallower.set")`, `gototown ("east")` or
 * `gotospecial (…)`. Stairs and gates skip the first half: an up arrow facing
 * the right way is the whole door. So the map is in the scripts, not drawn
 * anywhere, and this prints it in the shape a sheet uses —
 * `doorAt(x0, y0, x1, y1, owner: …)` from `goto(x, z, facing)` — with the
 * conditions each step is under, for the reader to weigh. A lock that reads
 * the day and the story is printed by name, not evaluated.
 *
 * What it does not follow: a room changed by a conversation or a cast script
 * (Mrs Mayor's dinner, a fade to the jail). Those are story, not doors.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { scriptToText, sniffScript } from "@dreamfactory/engine/df/script";
import { readSetFileV1 } from "@dreamfactory/engine/df/set-v1";

const CD = fileURLToPath(new URL("../gamefiles/dustcd", import.meta.url));
const only = (process.argv[2] ?? "").toLowerCase();

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.set$/i.test(e)) yield p;
  }
}

/** one `code … endcode` body, its lines with the conditions of every `if` they sit inside */
interface Line {
  text: string;
  under: string[];
}

function handlers(text: string): Map<string, Line[]> {
  const out = new Map<string, Line[]>();
  let name = "";
  let body: Line[] = [];
  const stack: { depth: number; cond: string }[] = [];
  for (const raw of text.split("\n")) {
    const depth = raw.length - raw.replace(/^\t+/, "").length;
    const line = raw.trim();
    const head = /^code (\w+)/.exec(line);
    if (head) {
      name = head[1].toLowerCase();
      body = [];
      stack.length = 0;
      continue;
    }
    if (line === "endcode") {
      if (name) out.set(name, body);
      name = "";
      continue;
    }
    if (!name || !line) continue;
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    if (/^(endif|else)$/.test(line)) continue;
    body.push({ text: line, under: stack.map((s) => s.cond) });
    const cond = /^(?:if|while) (.*)$/.exec(line);
    if (cond) stack.push({ depth, cond: cond[1] });
  }
  return out;
}

const RECT = /pointx \(arg\) > (\d+) & pointy \(arg\) > (\d+) & pointx \(arg\) < (\d+) & pointy \(arg\) < (\d+)/;

function rects(hs: Map<string, Line[]>): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const [name, body] of hs) {
    if (!name.startsWith("pointin")) continue;
    const m = body.map((l) => RECT.exec(l.text)).find(Boolean);
    if (m) out.set(name, m.slice(1, 5).map(Number));
  }
  return out;
}

const view = (conds: string[]): string | null => {
  for (const c of conds) {
    const m = /currentview \(\) = "(\w+)"/.exec(c);
    if (m) return m[1];
  }
  return null;
};

/** what a condition list says beyond the facing, the rectangle and the key — the part a reader weighs */
const rest = (conds: string[]): string =>
  conds
    .flatMap((c) => c.split(/ & /))
    .filter((c) => !/currentview \(\)|pointin\w+ \(arg\)|arg = "uparrow"|propowner \("door"\)|^isrepeat$/.test(c))
    .join(" & ");

const target = (text: string): string | null => {
  const m =
    /gotointerior \("([\w.]+)"\)/.exec(text) ??
    /gotospecial(?:dark)? \("([\w.]+)"/.exec(text) ??
    /opensetfile \("([\w.]+)"\)/.exec(text);
  if (m) return m[1].toLowerCase().replace(/\.set$/, "");
  const t = /gototown \((.*)\)/.exec(text);
  if (!t) return null;
  const facing = /^"(\w+)"$/.exec(t[1].trim());
  return `town (facing ${facing ? facing[1] : "as you leave"})`;
};

const rows: string[] = [];
for (const path of [...walk(CD)].sort()) {
  const room = basename(path).toLowerCase().replace(/\.set$/, "");
  if (only && !room.startsWith(only)) continue;
  const bytes = new Uint8Array(readFileSync(path));
  const set = readSetFileV1(bytes);
  const file = readContainerFile(bytes);
  const out: string[] = [];
  for (const scene of set.scenes) {
    const tokens = sniffScript(file.containers[scene.scriptLocation]?.data ?? new Uint8Array());
    if (!tokens) continue;
    const hs = handlers(scriptToText(tokens));
    const box = rects(hs);
    // the click half: which owner a click gives the door, from which facing and rectangle
    const owners = new Map<string, { view: string | null; rect: number[] | null; lock: string | null; when: string }>();
    for (const l of hs.get("mousedown") ?? []) {
      const o = /sendtoprop \("door", setupprop \("(\w+)"\)\)/.exec(l.text);
      if (!o) continue;
      const pin = l.under.map((c) => /(pointin\w+) \(arg\)/.exec(c)?.[1]).find(Boolean) ?? null;
      // the click is in the `else` of `if lockx ()`, which this reads as the
      // sibling `if` with the same conditions around it
      const lock =
        (hs.get("mousedown") ?? [])
          .filter((m) => m.under.join("|") === l.under.slice(0, -1).join("|") || m.under.join("|") === l.under.join("|"))
          .map((m) => /^if (lock\w+) \(\)$/.exec(m.text)?.[1])
          .find(Boolean) ?? null;
      owners.set(o[1].toLowerCase(), {
        view: view(l.under),
        rect: pin ? box.get(pin) ?? null : null,
        lock,
        when: rest(l.under.filter((c) => !/^lock\w+ \(\)$/.test(c))),
      });
    }
    // the walk half: the up arrow, and where it goes
    for (const l of hs.get("keydown") ?? []) {
      const to = target(l.text);
      if (!to) continue;
      const conds = l.under;
      if (!conds.some((c) => /arg = "uparrow"/.test(c))) continue;
      const owner = conds.map((c) => /propowner \("door"\) = "(\w+)"/.exec(c)?.[1]).find(Boolean)?.toLowerCase();
      const facing = view(conds);
      const at = `${room} ${scene.name} (${scene.x},${scene.z})`;
      const when = rest(conds);
      if (owner) {
        const o = owners.get(owner);
        const r = o?.rect;
        out.push(
          `${at} ${facing ?? "?"}: ${r ? `doorAt(${r.join(", ")}, owner: ${owner})` : `door "${owner}" (no rectangle found)`} → ${to}` +
            (o?.lock ? `  [${o.lock}]` : "") +
            (o?.when ? `  [click: ${o.when}]` : "") +
            (when ? `  [${when}]` : ""),
        );
      } else {
        out.push(`${at} ${facing ?? "?"}: key(ArrowUp) → ${to}${when ? `  [${when}]` : ""}`);
      }
    }
  }
  if (out.length) rows.push(...out);
}
console.log(rows.join("\n"));
