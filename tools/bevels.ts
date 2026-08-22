/**
 * Every conversation choice in the game, by puppet, as a reference.
 *
 *   npx tsx tools/bevels.ts gamefiles/en out/bevels.md
 *
 * A route says `talk purser[1,3,5]` and those numbers are the SCRIPT's own bevel
 * ids — `puppetbevel("What's the Rubaiyat?", 101)` in PENNY1.PUP. Reading a route
 * therefore means reading the decompiled puppet beside it, and writing one means
 * finding the ids by hand across fifty PUP files. This prints them.
 *
 * The unit is a CHOICE SET, not a bevel: a puppet offers several plaques and then
 * parks on `arg = puppetevent(-1)` waiting for one, and which ids are on offer
 * together is the thing a route has to know. So the bevels are grouped by the
 * `puppetevent` that closes them, and each set is printed with the `code` block it
 * sits in — the block name is usually the beat ("greet", "askmission"), which is
 * the only context that makes a bare id mean anything.
 *
 * Ids repeat across sets on purpose (101, 102, 103 over and over), so an id alone
 * is ambiguous and a route's list is read in ORDER against the sets it will meet.
 * That is also why the sets are printed in file order rather than sorted.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { sniffScript, scriptToText } from "@dreamfactory/engine/df/script";

const [, , root = "gamefiles/en", out = "out/bevels.md"] = process.argv;

/** one plaque: the words on it and the number the script switches on */
interface Bevel {
  text: string;
  id: number;
  /**
   * What picking it actually DOES, if anything worth naming.
   *
   * The point of the whole file for a speedrun. Most plaques are lore — they
   * play a line and come back to the same question — and a run wants the one
   * that moves the story. `advancephase()` is the clearest tell (it is called
   * from inside these scripts more than anywhere else), but handing over an
   * item or writing an actor's memory counts too, since those are what the next
   * beat is gated on.
   */
  does: string[];
  /**
   * How many lines the puppet SPEAKS if you pick it.
   *
   * The other half of the question, and the half that decides most plaques. A
   * bevel that advances the story in one line and a bevel that advances it in
   * six are the same to a route and are not remotely the same to a run — in a
   * browser those lines play in real time, and `skipLines` still has to press
   * ESC through each one. Counted from the branch, so "cheapest answer that
   * still gets there" is readable straight off the page.
   */
  speaks: number;
}

/**
 * Calls that mean a plaque is load-bearing rather than conversational.
 *
 * Deliberately a small list. The question being answered is "would skipping this
 * plaque break the route", and these are the things a later beat can be gated on:
 * the phase machine, possession, and the one-word memory each character keeps of
 * you (`actorowner`, which gates e.g. the chief engineer's turbine job).
 */
const LOAD_BEARING = [
  "advancephase", "addinven", "sendtoshop", "setactorowner", "actorowner",
  "propowner", "givetoplayer", "removeinven", "advanceday", "changeset",
];

/** the plaques offered together, and where in the script they are offered */
interface ChoiceSet {
  /** the `code <name>` block it sits in — usually the beat */
  block: string;
  /** container file it came from, for anyone going back to the source */
  container: string;
  line: number;
  bevels: Bevel[];
}

const BEVEL = /puppetbevel\s*\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*(-?\d+)\s*\)/;
const EVENT = /puppetevent\s*\(/;
const CODE = /^\s*code\s+([A-Za-z0-9_]+)/;

/**
 * Walk a decompiled puppet and pull out its choice sets.
 *
 * Deliberately line-based rather than a parse of the AST: a bevel's `if` guards
 * are what decide whether it is on offer this time, and reproducing that here
 * would be reimplementing the interpreter to answer a question the route already
 * answers by running. What is wanted is "these ids exist, in this block, in this
 * order", which the text gives directly.
 */
function choiceSets(text: string, container: string): ChoiceSet[] {
  const all = text.split("\n");
  const sets: ChoiceSet[] = [];
  let block = "";
  let pending: Bevel[] = [];
  let firstLine = 0;

  text.split("\n").forEach((line, i) => {
    const code = CODE.exec(line);
    if (code) {
      // a new block with plaques still pending means the puppet fell out of the
      // last one without ever parking — keep them rather than lose them
      if (pending.length) {
        sets.push({ block, container, line: firstLine, bevels: pending });
        pending = [];
      }
      block = code[1];
      return;
    }
    const bevel = BEVEL.exec(line);
    if (bevel) {
      if (!pending.length) firstLine = i + 1;
      pending.push({ text: bevel[1].replace(/\\"/g, '"'), id: Number(bevel[2]), does: [], speaks: 0 });
      return;
    }
    // `arg = puppetevent(-1)` is the park: everything gathered above it is one
    // set of plaques the player picks from
    if (EVENT.test(line) && pending.length) {
      annotate(all, i, pending);
      sets.push({ block, container, line: firstLine, bevels: pending });
      pending = [];
    }
  });
  if (pending.length) sets.push({ block, container, line: firstLine, bevels: pending });
  return sets;
}

/**
 * Fill in each bevel's {@link Bevel.does} from the `switch arg` that follows.
 *
 * The park is `arg = puppetevent(-1)` and directly under it is a switch over the
 * ids just offered, so the branch for an id is readable without evaluating
 * anything. Nested switches are tracked so a `case` belonging to an inner one is
 * not credited to the outer — a puppet that asks a follow-up question inside a
 * branch is common, and mis-attributing its effects would mark the wrong plaque
 * as the load-bearing one.
 */
function annotate(lines: string[], eventLine: number, bevels: Bevel[]): void {
  const byId = new Map(bevels.map((b) => [b.id, b]));
  let depth = 0;
  let current: Bevel | undefined;
  for (let i = eventLine; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*switch\b/.test(line)) {
      depth++;
      continue;
    }
    if (/^\s*endswitch\b/.test(line)) {
      if (--depth <= 0) return;
      continue;
    }
    if (depth !== 1) continue;
    const c = /^\s*case\s+(-?\d+)/.exec(line);
    if (c) {
      current = byId.get(Number(c[1]));
      continue;
    }
    if (!current) continue;
    if (/\bpuppetspeak\s*\(/.test(line)) current.speaks++;
    for (const call of LOAD_BEARING) {
      if (new RegExp(`\\b${call}\\s*\\(`).test(line) && !current.does.includes(call)) {
        current.does.push(call);
      }
    }
  }
}

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.PUP$/i.test(e)) yield p;
  }
}

const lines: string[] = [
  "# Conversation bevels",
  "",
  "Generated by `npx tsx tools/bevels.ts` — do not edit.",
  "",
  "Each heading is a puppet; each block under it is one set of plaques offered",
  "together, in the order the script offers them. The number after each line is",
  "the bevel id a route names (`talk penny[101,103]`). Ids repeat across sets, so",
  "a route's list is matched in order against the sets it actually meets.",
  "",
  "A bevel marked **-> advancephase** (or addinven, etc.) is load-bearing: picking",
  "it is what moves the story. Everything unmarked plays a line and comes back to",
  "the same question, which is exactly what a speedrun skips.",
  "",
  "_(n lines)_ is how many the puppet speaks if you pick it — the run still has",
  "to ESC through every one, so the cheapest plaque that still advances wins.",
  "",
];

let puppets = 0;
let total = 0;
for (const file of [...walk(root)].sort()) {
  const name = basename(file).toLowerCase();
  const container = readContainerFile(new Uint8Array(readFileSync(file)));
  const sets: ChoiceSet[] = [];
  container.containers.forEach((c, i) => {
    const script = sniffScript(c.data);
    if (!script) return;
    sets.push(...choiceSets(scriptToText(script), String(i).padStart(4, "0")));
  });
  if (!sets.length) continue;
  puppets++;
  lines.push(`## ${name}`, "");
  for (const s of sets) {
    total++;
    lines.push(`**${s.block || "(top level)"}** · container ${s.container} line ${s.line}`, "");
    for (const b of s.bevels) {
      const does = b.does.length ? `  **-> ${b.does.join(", ")}**` : "";
      const cost = b.speaks ? `  _(${b.speaks} line${b.speaks === 1 ? "" : "s"})_` : "";
      lines.push(`- \`${b.id}\` ${b.text}${cost}${does}`);
    }
    lines.push("");
  }
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join("\n"));
console.log(`${total} choice sets across ${puppets} puppets -> ${out}`);
