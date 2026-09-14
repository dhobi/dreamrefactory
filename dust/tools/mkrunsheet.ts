/**
 * Dust's run sheet, generated from the golden thread's own ladder.
 *
 *     npx tsx dust/tools/mkrunsheet.ts            rewrite tests/speedrun/run.sheet.txt
 *     npx tsx dust/tools/mkrunsheet.ts /tmp/x     somewhere else, to diff first
 *
 * Regenerating OVERWRITES the file, so once a leg has been settled by hand this
 * tool is for diffing against, not for running. It exists because the skeleton
 * is 55 rungs of standpoints and operations that are already written down once,
 * and copying them by hand is one more place for a cell to be wrong.
 *
 * Every standpoint and every take/give below is READ from docs/dust/thread.md
 * rather than copied by hand — the ladder is the route, and a transcription is
 * one more place for a cell to go wrong.
 *
 * What it cannot know it does not invent: a gesture the ladder does not record
 * comes out as a comment, so the sheet always PARSES. A sheet that does not
 * parse is no use as an example.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { claims, rung, segments } from "./rung2sheet";
import { existsSync, readdirSync } from "node:fs";
import { parseSaveV1 } from "@dreamfactory/engine/df/savegame-v1";

import { fileURLToPath } from "node:url";

const LADDER = fileURLToPath(new URL("../../docs/dust/thread.md", import.meta.url));
const OUT = process.argv[2] ?? fileURLToPath(new URL("../tests/speedrun/run.sheet.txt", import.meta.url));

/**
 * WHERE EACH LEG BEGINS, read from the save it begins at.
 *
 * A rung starts from a shipped save and its first gesture assumes that
 * standpoint — `d1e002.ts` opens with `clickActor(p, "leroy")` and Leroy is only
 * on screen from `D1E_001`'s own standpoint. Reported from a real run: at
 * `click(leroy)`, "nothing called leroy is clickable from here ... standing in
 * nite Scene G12/east", with Leroy in the cast and out of view — the sheet had
 * arrived from the hand-written opening, which ends somewhere else entirely.
 *
 * So every leg opens by walking to the standpoint of the save BEFORE it, which
 * is a no-op when the leg before ended where it should and a correction when it
 * did not. That is what makes the legs independent of each other, exactly as the
 * rungs are.
 *
 * The save is a better source than the ladder for this: it records the FACING as
 * well as the cell (`D1E_001` is nite (10,10) facing south), and the ladder's
 * table has only the cell.
 */
const SAVES = fileURLToPath(new URL("../gamefiles/save", import.meta.url));
interface Stand {
  room: string;
  x: number;
  z: number;
  view: string;
  /** every global the save records, by name — the 1995 engine's own state */
  globals: Map<string, string | number>;
}
const stands = new Map<string, Stand>();
if (existsSync(SAVES)) {
  for (const f of readdirSync(SAVES).filter((n) => /\.rtd$/i.test(n))) {
    try {
      const g = parseSaveV1(new Uint8Array(readFileSync(`${SAVES}/${f}`)));
      stands.set(f.replace(/\.rtd$/i, "").toUpperCase(), {
        room: String(g.standpoint.setFile || "").toLowerCase().replace(/\.set$/, ""),
        x: g.standpoint.cellX,
        z: g.standpoint.cellZ,
        view: String(g.standpoint.view || "").toLowerCase(),
        globals: new Map<string, string | number>([...g.numGlobals, ...g.strGlobals]),
      });
    } catch {
      /* a save this reader cannot take is one leg without a standpoint, not a
         reason to emit no sheet */
    }
  }
}

/**
 * WHAT EACH LEG CLAIMS, read off the rung that plays it.
 *
 * A leg used to end at `split()` and nothing else, which meant a green leg had
 * proved only that no line threw. That is a very weak thing to be told about a
 * route: the sheet could walk to the right cell, miss every conversation on the
 * way and still print a split — and for a while it did, because a dropped knock
 * is a conversation that never happened and nothing downstream asked.
 *
 * The rungs already answer this and answer it better than a guess would. Each
 * carries a `claims: [...]` list naming the globals THAT rung is about, and
 * `playthrough.ts` checks exactly those against the save `DF.EXE` wrote at the
 * far end. So the assertions below are not invented here: the names come from
 * the rung and the values come from 1995.
 *
 * Read with a regex rather than by importing the modules, for the reason the
 * transcriber has the same shape: this is a build tool over the repo's own
 * source, and importing 55 rungs to read one array from each would pull the
 * whole playthrough harness — and its disc — into a script that only wants a
 * list of names.
 */
const md = readFileSync(LADDER, "utf8");
const rows = md
  .split("\n")
  .filter((l) => /^\|\s*\d+\s*\|/.test(l))
  .map((l) => l.split("|").map((c) => c.trim()).filter((_, i) => i > 0))
  .map((c) => ({ frame: Number(c[0]), save: c[1].replace(/`/g, ""), when: c[2], where: c[3].replace(/`/g, ""), what: c[4] }));

/** `nite.set (10,10)` -> room + cell */
const place = (w: string): { room: string; x: number; z: number } | null => {
  const m = /^([a-z0-9_]+)\.set\s*\((\d+),\s*(\d+)\)$/i.exec(w);
  return m ? { room: m[1].toLowerCase(), x: Number(m[2]), z: Number(m[3]) } : null;
};

const out: string[] = [];
const say = (s = ""): void => void out.push(s);

say("# =====================================================================");
say("# THE SPEEDRUN — Dust: A Tale of the Wired West, any%");
say("#");
say("#   Copy the full run    the panel's own button, which is this file");
say("#   Play                 runs it from the pointer");
say("#");
say("# One action per line. `#` is a comment, `;` separates actions on a line,");
say("# `xN` repeats, `a, b, c` is one action per argument, `key: value` is an");
say("# option. Every line takes `wait:`, `after:`, `budget:` and `gap:`.");
say("#");
say("# EVERY LEG LOADS THE SAVE IT STARTS FROM, which is the thing to");
say("# understand about this file before reading it. The fifty-five legs below");
say("# are the golden thread's rungs (docs/dust/thread.md), and a rung is");
say("# independent of every other one: both its ends are saves the original");
say("# player left on the disc, and it begins by loading the first of them.");
say("#");
say("# So this is not yet a continuous run and its total is not a time. It is");
say("# the route, leg by leg, each one starting from a state that is exactly");
say("# right — because a standpoint is not a state. Walking to where a save was");
say("# taken puts the camera in the right place and leaves the cast wherever the");
say("# world's clocks have carried it: `click(leroy)` failed that way, with");
say("# Leroy in the cast and out of the view. `loadSave` settles the standpoint,");
say("# the cast, the props, the phases and the clock at once.");
say("#");
say("# A leg that runs clean is a leg that can then be joined to its neighbour");
say("# by deleting its `loadSave` — which is how this becomes a run.");
say("#");
say("# STATUS: TRANSCRIBED, and not yet driven. The gestures are read from the");
say("# rungs (dust/tools/rung2sheet.ts) and the rungs are the only place they are");
say("# written down; what a sheet has no grammar for is marked `# TODO`. It will");
say("# stop somewhere, and the report names the line and prints where the game");
say("# was standing. That is how it gets settled.");
say("#");
say("# THE VERBS THIS GAME ADDS");
say("#");
say("#   loadSave(D1E_001)     the disc's own saved games. NOT load(), which is");
say("#                         a checkpoint this run wrote with save().");
say("#   goto(10, 10)          walk to a grid cell of this room. Plans in the");
say("#                         page, answers what interrupts the walk, re-plans");
say("#                         from where it actually got to.");
say("#   doorAt(x0,y0,x1,y1)   click a door's rectangle where the SCENE shows");
say("#                         through it, then walk in.");
say("#   takeInHand(mask)      a thing you are CARRYING into your hand, through");
say("#                         the avatar panel. A thing lying in a ROOM is");
say("#                         click(mask).");
say("#   offer(ring)           hand it to whoever you are TALKING to — the");
say("#                         inventory's 55555 plaque, and its picker.");
say("#   give(bone, to, dog)   drop it on somebody standing in the room.");
say("#   meet(jones)           walk to somebody wherever they have got to and");
say("#                         get them talking. `accost` only turns where it");
say("#                         stands; this walks.");
say("#   talkOut([301,201])    leave a conversation, answering whichever of");
say("#                         those replies is on the plaque — and fine if");
say("#                         nobody is talking at all.");
say("#");
say("# And three the engine grew for this route: `accost` (Titanic's, now");
say("# shared), `key(ArrowUp, until: visible.help)` — press until something is");
say("# true — and `or` in a condition, because what a route waits for is");
say("# usually two things: `until: choosing or global.trotterphase == 4`.");
say("# =====================================================================");
say();

/**
 * Which rung plays which leg.
 *
 * Two spellings, because the collection has two homes: the rungs from `D2A_006`
 * on are one file each (`d2a006.ts`), and the first thirteen are segments of
 * `segments.ts` named by what they run TO. So a ladder save is matched against a
 * file name with its underscores dropped, and failing that against a segment's
 * `to`.
 *
 * The first row's rung is not named after its save either: it is `opening.ts`,
 * "the first four thousand frames: a cold boot to D1E_001", and the one rung
 * that does not start at a shipped save because there is no save before it.
 */
const byRung = new Map<string, string[]>();
for (const r2 of rows) {
  const lines = rung(r2.save.toLowerCase().replace(/_/g, ""));
  if (lines?.length) byRung.set(r2.save, lines);
}
if (rows[0] && !byRung.has(rows[0].save)) {
  const first = rung("opening");
  if (first?.length) byRung.set(rows[0].save, first);
}
for (const seg of segments()) {
  if (seg.to && seg.lines.length && !byRung.has(seg.to)) byRung.set(seg.to, seg.lines);
}

let room = "nite";
let period = "";
for (const [at, r] of rows.entries()) {
  const p = place(r.where);
  say("# ---------------------------------------------------------------------");
  say(`# ${r.save} — ${r.when}, ${r.where}`);
  say(`#   ladder frame ${r.frame}: ${r.what.replace(/\*\*/g, "").replace(/\*/g, "")}`);
  say("# ---------------------------------------------------------------------");
  /*
   * WHERE THE LADDER'S STANDPOINT GOES, which is not at the top of the leg.
   *
   * It is where the save was TAKEN — the leg's END — and writing it first asked
   * the sheet to walk to a cell of a room it had not entered yet. Reported from
   * a real run at `D1E_002`: "goto(2, 3) expects to be in sallower and this is
   * nite", with the rung's own `doorAt` for the saloon door sitting on the line
   * BELOW the walk that needed it.
   *
   * So where a rung transcribes the leg, its own last walk is what lands on the
   * standpoint (`goto(2, 3, west, set: sallower)` there, and it is right), and
   * the ladder's copy is a comment to check that against. A real `goto` is only
   * emitted where nothing transcribes the leg and the standpoint is all there is.
   */
  const played = byRung.get(r.save) ?? [];
  if (!p) {
    say(`# TODO the ladder does not give a cell for this rung ("${r.where}")`);
  } else if (played.length) {
    const ends = stands.get(r.save.toUpperCase());
    say(
      ends
        ? `#   this leg ends at ${ends.room} (${ends.x},${ends.z}) facing ${ends.view} — ${r.save}'s own standpoint`
        : `#   the ladder's standpoint for this leg: ${p.room} (${p.x},${p.z})`,
    );
    room = p.room;
  } else {
    if (p.room !== room) {
      say(`# TODO ${room} -> ${p.room}: a set change, which is a door or an interior`);
      say(`#      jump, and no rung transcribes this leg`);
      room = p.room;
    }
    say(`goto(${p.x}, ${p.z}, set: ${p.room})`);
  }
  /*
   * THE GESTURES, transcribed from the rung that plays this leg
   * (dust/tools/rung2sheet.ts). The ladder says where and what changed; the
   * rung is the only thing that says which door, which reply and which plaque,
   * and it says all three as literals — so they are read rather than invented.
   */
  /*
   * The FIRST leg is the one the hand-written opening above already plays, and
   * it plays it differently: it goes past the dog, which the thread does not,
   * and it is the only part of this sheet anybody has driven. So the thread's
   * own opening is kept as reference and not as instructions — two live copies
   * of the help conversation is one too many.
   */
  const reference = false;
  if (at === 0) {
    say("# The one leg that starts cold: there is no save before the boot. Its");
    say("# films play before any set is opened, so there is no viewer while they");
    say("# run — which is why the skip asks for one rather than for `quiet` or");
    say("# `nomovie`, both of which read false through the whole opening. 183s of");
    say("# film, skipped in under a second.");
    say("reset()");
    say("skipMovie(until: js == !!window.dbg.viewer, budget: 180000)");
    say("# THE BOOT LEAVES A CONVERSATION OPEN, and this waits for it by name.");
    say("#");
    say("# A viewer is the first moment there is a game, not the last moment of");
    say("# the boot — `coldBoot` runs on past it — so the line after this one was");
    say("# asking before there was anybody to answer: \"conversation ended before");
    say("# saying 104 (picked nothing)\".");
    say("#");
    say("# Nobody clicks Leroy. `GANG.CST/0002 leroyidle ()` arms");
    say("# `hasattention (10)` and the boot hands over with `curattention =");
    say("# \"leroy\"` — that timer ALREADY RUN DOWN — so he accosts you as soon as");
    say("# the boot stops, from the standpoint it leaves you on: he stands at");
    say("# town.leroy1, cell (6,13), and you are at (6,14) facing north.");
    say("#");
    say("# So a run does not WAIT for it. `accost` makes the same gesture the");
    say("# timer would have made — `hasattention ()` fires `sendtoactor (target,");
    say("# mousedown (0))`, which is a click on him — and it turns to find him");
    say("# first if the boot left us facing somewhere else.");
    say("accost(leroy)");
  }
  /*
   * The leg's own starting standpoint, from the save it starts at — see the note
   * on `stands`. Skipped for the first leg, which the hand-written opening above
   * plays, and skipped when the save cannot be read.
   */
  /*
   * THE SAVE THIS LEG STARTS FROM, loaded rather than walked to.
   *
   * A `goto` to the standpoint was tried first and is not enough: it puts the
   * camera right and leaves everybody else where the world's own clocks have
   * carried them, which is how `click(leroy)` came to aim at a Leroy who was in
   * the cast and out of the view. The save settles all of it.
   *
   * The first leg has none, because there is no save before the boot — it is the
   * one rung that starts cold.
   */
  const from = at > 0 ? rows[at - 1].save : "";
  if (from) {
    const stand = stands.get(from.toUpperCase());
    say(
      `loadSave(${from}, budget: 120000)` +
        (stand ? `   # ${stand.room} (${stand.x},${stand.z}) facing ${stand.view}` : ""),
    );
  }
  if (played.length) {
    if (reference) {
      say(`#   the thread's own opening, for reference — the live one is above:`);
      for (const line of played) say(`#     ${line}`);
    } else {
      for (const line of played) say(line);
    }
  } else {
    say(`# TODO no rung transcribes this leg — its gestures are not written down yet`);
  }

  // and the operations the ladder records, as a cross-check on the above
  for (const m of r.what.matchAll(/\*\*take\*\*\s+([A-Za-z0-9]+)(?:\s+\(from ([A-Za-z0-9]+)\))?/g)) {
    say(
      m[2]
        ? `#   the ladder also records: take the ${m[1].toLowerCase()} back from ${m[2].toLowerCase()}`
        : `#   the ladder also records: take the ${m[1].toLowerCase()}`,
    );
  }
  for (const m of r.what.matchAll(/\*\*give\*\*\s+([A-Za-z0-9]+)(?:\s+\(to ([A-Za-z0-9]+)\))?/g)) {
    /*
     * A GIVE IS TWO DIFFERENT GESTURES and the ladder does not say which.
     *
     * `give` is a drop: the thing in your hand, dragged onto somebody standing
     * in the room, landing on `offerobject ()`. The other way is a
     * CONVERSATION — the inventory's own plaque, reply 55555 from
     * `addhandbevel ()`, answered by `gift (handitem)` on the character's
     * script — and it is the commoner of the two by a distance: the harness
     * reaches for it ten times against `dropOn`'s one.
     *
     * D1E_005's ring is the case that makes it plain. Ruby "is never an actor
     * on this landing" (rungs/d1e005.ts): you knock inside `pointinruby` three
     * times, answer six plaque sets with 999, and the ring changes hands on
     * 55555. A `give` line there would drag at somebody who is not on screen.
     *
     * So neither is emitted. The rung knows and the ladder does not, and a
     * plausible wrong line is worse here than a marked gap — `offer` does not
     * exist yet either, which is the other half of why this is a TODO.
     */
    const item = m[1].toLowerCase();
    say(`#   the ladder also records: give the ${item}${m[2] ? ` to ${m[2].toLowerCase()}` : ""}`);
  }
  if (/played cards/.test(r.what)) {
    say("#   the ladder also records: a card game played here");
  }
  /*
   * WHAT THE LEG HAS TO HAVE DONE, before it is allowed to call itself finished.
   *
   * `wait` and not a new verb, because the assertion IS a wait: the leg has just
   * played, so a claim that holds holds already and the line costs one read. On
   * a short budget for the same reason — a claim that is going to come true has
   * come true, and two seconds is a fast, specific failure rather than a slow
   * vague one.
   *
   * The standpoint goes in first because it is the cheapest thing to be wrong
   * about and the commonest: `playthrough.ts` checks the room, the scene and the
   * facing against the save before it looks at a single global.
   */
  {
    const ends = stands.get(r.save.toUpperCase());
    const claimed = claims(r.save.toLowerCase().replace(/_/g, ""));
    const lines: string[] = [];
    if (ends && byRung.has(r.save)) {
      lines.push(`wait(set == ${ends.room}, budget: 2000)`);
      if (ends.view) lines.push(`wait(view == ${ends.view}, budget: 2000)`);
    }
    for (const name of claimed) {
      const value = ends?.globals.get(name);
      // a claim whose value this cannot read is NOT emitted as a passing line —
      // an assertion nobody can check is worse than a marked gap, because it
      // reads as coverage
      if (value === undefined) {
        lines.push(`# TODO ${r.save} claims \`${name}\` and its save does not record one`);
        continue;
      }
      /*
       * An EMPTY claim is a claim. `handitem` is "" with nothing in hand,
       * `loopsound` is "" with no ambience and `playerdeath` is "" while you are
       * alive — sixteen of the route's claims are one of those three, and
       * `global.handitem == ` with nothing after it does not compile and would
       * not read if it did. The grammar's accessor form says it: `!global.x`.
       */
      const text = String(value).toLowerCase();
      /*
       * A COMMA IN THE VALUE cannot be carried, and is marked rather than
       * mangled.
       *
       * Three of the route's globals hold a list inside a string — the
       * apothecary's `bottles` is "1,1,0,0,1,0,1,1,", the safe's `combo` is
       * "08,23,41," and the temple's `flutestr` is "0,0,0,0,0," — and `wait`
       * takes several conditions separated by commas, so there is no telling one
       * from the other on a line. Quoting is not the way out either: the
       * tokeniser drops quotes (see the `js ==` note in action.ts).
       *
       * So it says what it cannot check, with the value in it. A line that
       * silently checked the first field would be worse than this in exactly the
       * way this whole pass exists to stop.
       */
      if (text.includes(",")) {
        lines.push(`# TODO ${r.save} claims \`${name}\` is "${text}" — a wait line cannot carry a comma`);
        continue;
      }
      lines.push(
        text === ""
          ? `wait(!global.${name}, budget: 2000)`
          : `wait(global.${name} == ${text}, budget: 2000)`,
      );
    }
    if (lines.length) {
      say(`#   what ${r.save} has to be true of — the rung's own claims, against the 1995 save`);
      for (const l of lines) say(l);
    }
  }
  say(`split(${r.save.toLowerCase()})`);
  /*
   * A checkpoint at each change of period and nowhere else. The panel grows one
   * button per checkpoint that exists, so 55 of them is a control strip nobody
   * can read — and a period boundary is the one that earns it: crossing midnight
   * zeroes every character's phase (docs/dust/thread.md), so it is a different
   * kind of rung from every other one and the natural place to start from.
   */
  if (r.when !== period) {
    say(`save(${r.when.replace(/[^a-z0-9]+/gi, "")})`);
    period = r.when;
  }
  say();
}

writeFileSync(OUT, out.join("\n"));
console.log(`${OUT}: ${out.length} lines, ${rows.length} rungs`);
