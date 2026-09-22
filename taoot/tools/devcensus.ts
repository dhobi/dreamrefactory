/**
 * Every use of `debugging` and of the three modifier probes, as a document.
 *
 *   npx tsx taoot/tools/devcensus.ts
 *
 * Writes `docs/taoot/devmode-census.md`. It is generated for the reason the flow
 * map is: the interesting number is in the hundreds, it moves if the corpus is
 * re-read or the decompiler changes, and a hand-kept table would be wrong within
 * a month and wrong silently.
 *
 * ## What it looks for
 *
 * `debugging` is the flag developer mode raises, and `shiftkey`/`optionkey`/
 * `commandkey` are the three probes almost every branch behind it is ALSO gated
 * on — so the two questions only make sense together. For each occurrence this
 * records the file, the container, the enclosing `code` handler, the condition
 * the line sits in, and the first call the branch makes, which between them say
 * what the branch is for without anyone having to summarise it.
 *
 * ## Why identical scripts collapse
 *
 * MAP.STG alone has 52 regions whose mousedown is the same four lines, and a
 * table with 52 identical rows in it is not a census, it is a wall. Rows are
 * grouped by their normalised branch, and the group says how many containers
 * share it and names them. Nothing is dropped: the totals are over occurrences,
 * not over groups, and the appendix lists every container.
 *
 * ## The corpus
 *
 * The English tree, through the same index the game reads (`index.names()`), so
 * each basename is counted once — the discs ship some rooms twice and the dump
 * directory holds both spellings, and counting those twice is how "437
 * containers" became the first number I quoted for this.
 */
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gamefiles, gamefilesRoot } from "./gamefiles";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { sniffScript, scriptToText } from "@dreamfactory/engine/df/script";
import { carriesScript, SCRIPT_BEARING_NAMES } from "../../tools/script-bearing";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "docs", "taoot", "devmode-census.md");

const PROBES = ["shiftkey", "optionkey", "commandkey"] as const;
type Probe = (typeof PROBES)[number];

interface Hit {
  file: string;
  container: number;
  handler: string;
  /** the `if` the line sits under, flattened, or "" at the top of a handler */
  guard: string;
  /** the line itself */
  line: string;
  /** the first call the branch makes after the guard */
  effect: string;
  /** the branch itself, from the guard to its `endif` — what it actually does */
  snippet: string;
  probes: Probe[];
  /** how many times each probe is CALLED on this line */
  calls: Record<Probe, number>;
  flag: boolean;
}

/**
 * The branch a line opens, as text.
 *
 * From the line itself down to the `endif` that closes it, counting nesting so an
 * inner `if` does not end the outer one. A line that opens nothing — `menuvisible
 * (debugging)`, or a bare read inside a `switch` — has no block, so it gets
 * itself and the two lines under it, which is enough to see what it feeds.
 *
 * Capped, because one of these is BOOTFILE's `menuselect` and quoting all 160
 * lines of it in a census would bury everything around it. The cap is generous
 * enough that nothing but that one handler reaches it.
 */
function branchAt(lines: string[], at: number): string {
  const out: string[] = [];
  const strip = (s: string): string => s.replace(/\t/g, "  ").replace(/\s+$/, "");
  if (!/^\s*if\b/.test(lines[at])) {
    for (let i = at; i < Math.min(at + 3, lines.length); i++) out.push(strip(lines[i]));
    return out.join("\n");
  }
  let depth = 0;
  for (let i = at; i < lines.length && out.length < 28; i++) {
    const t = lines[i].trim();
    out.push(strip(lines[i]));
    if (/^if\b/.test(t)) depth++;
    if (/^endif\b/.test(t)) {
      depth--;
      if (depth === 0) break;
    }
    if (/^endcode\b/.test(t)) break;
  }
  if (out.length >= 28) out.push("        …");
  /*
   * A bare GUARD hides its own point. `if not debugging → exitcode` says what is
   * refused and not a word about what is being refused — the `jumpbaby` is on the
   * far side of the `endif` — so all 15 of the deck map's developer areas came
   * out as one indistinguishable block. When the branch is short and does nothing
   * but leave, the lines after it are the content, so they come too.
   */
  const leaves = out.length <= 4 && out.some((l) => /^\s*(exitcode|passcode)\b/.test(l));
  if (leaves) {
    let taken = 0;
    for (let i = at + out.length; i < lines.length && taken < 4; i++) {
      const t = lines[i].trim();
      if (!t) continue;
      if (/^endcode\b/.test(t)) break;
      out.push(strip(lines[i]));
      taken++;
    }
  }
  return out.join("\n");
}

const index = gamefiles(gamefilesRoot());
const hits: Hit[] = [];
let filesRead = 0;
let containersRead = 0;

for (const name of index.names().filter(carriesScript)) {
  const path = index.resolve(name);
  if (!path) continue;
  let file;
  try {
    file = readContainerFile(new Uint8Array(readFileSync(path)));
  } catch {
    continue;
  }
  filesRead++;
  for (let ci = 0; ci < file.containers.length; ci++) {
    const toks = sniffScript(file.containers[ci]?.data ?? new Uint8Array());
    if (!toks) continue;
    containersRead++;
    const lines = scriptToText(toks).split("\n");
    let handler = "";
    /** the `if` conditions currently open, outermost first */
    const open: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trim();
      if (/^code\s+(\w+)/.test(line)) {
        handler = /^code\s+(\w+)/.exec(line)![1];
        open.length = 0;
        continue;
      }
      if (/^endcode\b/.test(line)) {
        handler = "";
        open.length = 0;
        continue;
      }
      if (/^endif\b/.test(line)) {
        open.pop();
        continue;
      }
      const iff = /^if\s+(.*)$/.exec(line);
      /**
       * A `global debugging, tour` line NAMES the variable, it does not read it.
       * Counting declarations as uses is how the first run of this reported 571
       * lines against 29 files when the reads are a third of that — every handler
       * that touches the flag declares it first, and some declare it and never
       * use it at all (INVEN.SHP's `hotdist`).
       */
      const declares = /^(global|local)\b/.test(line);
      const wants =
        !declares &&
        (/\bdebugging\b/.test(line) || PROBES.some((p) => new RegExp(`\\b${p}\\b`).test(line)));
      if (iff) open.push(iff[1].trim());
      if (!wants) continue;
      // the first call after this line that is not another guard — what it DOES
      let effect = "";
      for (let j = i + 1; j < lines.length && j < i + 12; j++) {
        const nxt = lines[j].trim();
        if (!nxt || /^(if|endif|else|switch|case|endswitch|global|local)\b/.test(nxt)) continue;
        effect = nxt;
        break;
      }
      hits.push({
        snippet: branchAt(lines, i),
        file: name.toLowerCase(),
        container: ci,
        handler: handler || "(top level)",
        guard: (iff ? iff[1] : open[open.length - 1] ?? "").trim(),
        line,
        effect,
        probes: PROBES.filter((p) => new RegExp(`\\b${p}\\b`).test(line)),
        // CALLS, not lines: `if optionkey () & shiftkey ()` is one line and two
        // of them, and the engine's own census (builtins/scene.ts) counts calls
        calls: Object.fromEntries(
          PROBES.map((p) => [p, (line.match(new RegExp(`\\b${p}\\s*\\(`, "g")) ?? []).length]),
        ) as Record<Probe, number>,
        flag: /\bdebugging\b/.test(line),
      });
    }
  }
}

/**
 * What a branch is FOR, from the call it makes.
 *
 * Mechanical on purpose — the classifier is the effect line, not a summary
 * someone wrote — so a branch that changes shape is reclassified rather than
 * quietly keeping a stale label.
 */
function purpose(h: { effect: string; line: string; handler?: string }): string {
  // The handler's own name beats the effect line where it is more honest:
  // `solvedoll` is four `propdeg` calls and would otherwise read as "drags a
  // prop", which is exactly backwards — it is a puzzle being skipped.
  if (h.handler && /^(solvebomb|solvedoll)$/.test(h.handler)) return "skips a puzzle";
  if (h.handler && /^(move3dactor|move3dprop|move2dprop)$/.test(h.handler))
    return "places a prop or actor by hand";
  if (h.handler === "setuptour") return "forces a scene or actor";
  if (/\b\w*script\s*\(/.test(h.effect)) return "opens the script editor";
  if (/^debugger\s*\(/.test(h.effect)) return "opens the debugger";
  if (/^message\s*\(/.test(h.effect) || /^notedialog\s*\(/.test(h.effect)) return "prints a readout";
  // The bulk shape is the DRAG LOOP — `while stilldown () → propxy (...)`,
  // copied onto every clickable prop. A lone `propdeg (me, propdeg (me) + 1)` is
  // a single step and a different thing entirely, and lumping the two put a
  // branch worth describing into a bin that is never written up.
  if (/^while stilldown/.test(h.effect)) return "drags or places a prop";
  if (/^exitcode\b/.test(h.effect) && /if not debugging/.test(h.line)) return "gates content behind the flag";
  if (/^(addinven|sendtoshop|sendtoprop|propowner)\s*\(/.test(h.effect)) return "hands over items";
  if (/^(sendtoactor|sendtostage|sendtocast)\s*\(/.test(h.effect)) return "forces a scene or actor";
  if (/^return (false|true)\b/.test(h.effect)) return "answers a guard differently";
  if (/^(menuvisible|keyaborts)\s*\(/.test(h.effect)) return "switches the menu bar on";
  if (/^for\b/.test(h.effect)) return "sweeps every item or script";
  return "other";
}


/**
 * What each branch lets you DO, in a sentence or two.
 *
 * The rest of this file is measured; this is written, and it has to be — no
 * classifier can tell you that the bedsit's door is a chapter skip. The page is
 * for somebody who has just switched developer mode on and wants to know where
 * to go and what to press, and a wall of quoted script does not answer that.
 *
 * The prose lives HERE, beside the sweep, rather than in the hand-written page,
 * so the two cannot drift apart: a note claims the branches it matches, every
 * rare branch must be claimed, and the tool says so loudly when one is not. A
 * branch that changes shape stops matching and gets noticed; a note for a branch
 * that no longer exists is reported as unused.
 *
 * `when` is matched against the branch text. Notes are tried in order and the
 * first match wins, so put the specific ones first. Every group a note claims is
 * merged into one entry — which is the point for the deck map, where 15
 * identical-in-kind regions are one thing a reader wants to know about, not 15.
 */
interface Note {
  file: string;
  handler: RegExp;
  when?: RegExp;
  /** a short title for the entry */
  title: string;
  /** the prose — what it lets you do, and how to reach it */
  text: string;
}

const NOTES: Note[] = [
  {
    file: "map.stg",
    handler: /^mousedown$/,
    when: /if not debugging/,
    title: "The deck map's 15 developer areas",
    text:
      "Press a red area on a deck plan and it jumps you straight there. With the flag down 15 of the 32 refuse; " +
      "with it up, **14 of them work** and take you into a *room* rather than a stairwell, which is all the shipped " +
      "17 ever reach: the **gymnasium** and four spots along the boat-deck promenades, the **1st Class Smoke Room** " +
      "and four along A deck's, the **Café Parisian** and the **poop** and **forecastle** decks on B, and one F-deck " +
      "hallway. The map goes from 8 sets to 16.\n\n" +
      "The fifteenth is the **1st Class Lounge**, whose region returns at a bare `exitcode` above its jump. The lounge " +
      "is reached on foot, from the lounge hallway.\n\n" +
      "To use them Frank needs the bag *and* the watch (`mapdisabled()` checks both); the map also refuses in mission 4 " +
      "and from the smokestacks, boiler room, cargo hold and bunkers. **Press them plain** — shift opens the " +
      "button's script editor. `/devmode/` outlines all 32 while the plan is open.",
  },
  {
    file: "bedsit1.set",
    handler: /^mousedown$/,
    title: "The bedsit door — a chapter skip, and a kit",
    text:
      "Stand in the bedsit facing the door (Scene3/View21) and click it:\n\n" +
      "- **plain click** — runs `advanceday()`, the game's own day machine, which skips you forward a chapter.\n" +
      "- **option-click** — hands you the bag, the map and the watch, randomises who holds the notebook, the painting, " +
      "the real and fake necklaces and the Rubaiyat, sets the clock to `startdisk2` and *then* advances: a jump " +
      "straight to disc 2 with a playable inventory.\n\n" +
      "It is the nearest thing the game has to a level select.",
  },
  {
    file: "smstack2.set",
    handler: /^pathblocked$/,
    title: "The false smokestack loses its walls",
    text:
      "`pathblocked` answers `false`, so the crate maze inside the dummy funnel stops blocking anything and you can " +
      "walk straight through it. It is the game's one `pathblocked` handler.",
  },
  {
    file: "bootfile",
    handler: /^setuptour$/,
    title: "The guided tour's ten narrators, whether or not their films shipped",
    text:
      "Each tour guide is normally placed only if their film is on the disc (`fileexists (\"tour1.mov\")`); the flag " +
      "puts them there regardless. Ten rooms, one narrator each: **Penny** on the poop deck, **Burns** in the smoking " +
      "room, **Willie** in the gym, **Cash** on the grand staircase, **Morrow** on the bridge and again in the " +
      "wireless room, **Stokes** in the boiler room, **Trask** in the Turkish bath, **Smethells** in cabin C73 and " +
      "**Shay** in scot3.",
  },
  {
    file: "house.shp",
    handler: /^move$/,
    title: "Option-drag a cricket to move it in Z — not behind the flag",
    text:
      "A *cricket* is a sound emitter parked in the room, and this drags it: without a modifier across the floor, " +
      "with **option** held up and down, printing its position, distance and volume as it goes. Ungated, so it answers " +
      "whenever the ⌥ latch is on.",
  },
  {
    file: "bootfile",
    handler: /^(move3dactor|move3dprop|move2dprop|mousedown)$/,
    // wide enough to take the INNER branches of the three handlers as well as
    // the mousedown that reaches them, so the whole feature is one entry rather
    // than a headline and three loose fragments
    when: /setloc|actorxyz|propxyz|actordeg|propdeg \(name|actorscript/,
    title: "The placement mode — drag actors and props around the room",
    text:
      "BOOTFILE's global mousedown hands a click on an actor to `move3dactor` and on a prop to `move3dprop` or " +
      "`move2dprop`, and then you have hold of it: **option-drag** slides it across the floor, **option+shift-drag** " +
      "raises and lowers it, **shift-drag** turns it, and the log prints its x, y, z, facing, clip and scale every " +
      "frame. Props get the same through `move3dprop` and `move2dprop`.\n\n" +
      "It wants a **second** global: `setloc`, assigned `false` in `boot()` one line above `debugging` and nowhere " +
      "else. The page leaves it down — dragging artwork out of position is a different kind of power from reading a " +
      "flag, and it was a separate switch on the disc too — the **place** latch raises it. The three handlers are " +
      "BOOTFILE script, and every builtin they call is implemented.",
  },
  {
    file: "bootfile",
    handler: /^idle$/,
    when: /actordist/,
    title: "Hold option: where you are, every tick",
    text:
      "The log prints the current **set, scene and view** plus how far away Vlad is, refreshed on every idle tick. " +
      "The way to read a room's own name while standing in it. On `/devmode/` the log is the Details column under the " +
      "picture.",
  },
  {
    file: "bootfile",
    handler: /^idle$/,
    when: /realdist/,
    title: "Hold shift and point at someone: how far away they are",
    text: "Point the cursor at a character with shift held and the log prints that actor's real distance from Frank.",
  },
  {
    file: "gang.cst",
    handler: /^runpuppet$/,
    title: "Conversations: who you are talking to, and how far off they are",
    text:
      "As a conversation starts, the flag adds three shortcuts. **shift+option** prints the target's distance and " +
      "stops. **option** prints the target's name and asks for its actor script. **shift** opens every puppet script " +
      "in the `.pup` file. The two that print land in the log; the script editors need the authoring tool.",
  },
  {
    file: "house.shp",
    handler: /^mousedown$/,
    when: /notedialog/,
    title: "Shift-click HELP: the game's own state readout",
    text:
      "The interface band's **HELP** button answers a shift-click with a dialog reading " +
      "`Mission=…, Phase=…, Letter=…, Necklace=…` — and inside the three smokestack sets it adds `Maze=` and `Level=`, " +
      "which is how you read which of the four crate mazes you are in. It is one of the four ungated modifier branches, " +
      "so it answers on the play page as well.",
  },
  {
    file: "house.shp",
    handler: /^mousedown$/,
    when: /addmap/,
    title: "Picking up the bag also gives you the map and the watch",
    text:
      "Taking the small bag normally gives you just the bag. With the flag up it hands over the map and the watch " +
      "with it — which between them are what `mapdisabled()` checks, so this is the other way to make the deck map live.",
  },
  {
    file: "house.shp",
    handler: /^mousedown$/,
    when: /propdeg \(me, propdeg/,
    title: "Option-click a band prop to step it round",
    text: "Option-clicking this interface prop advances its `propdeg` by one — a way to walk a dial or hand through its frames by hand.",
  },
  {
    file: "house.shp",
    handler: /^mousedown$/,
    when: /setupsigns/,
    title: "Command-click the signs prop to rebuild it",
    text:
      "The interface band's signs prop answers three modifiers behind the flag: **shift** asks for its script, " +
      "**option** steps its `propdeg` on by one, and **command** re-runs `setupsigns ()`, which rebuilds the sign " +
      "faces from the current state.",
  },
  {
    file: "tour.shp",
    handler: /^openshop$/,
    title: "All ten guided-tour props, film or no film",
    text:
      "The tour's own shop normally shows a tour prop only when its film is on the disc. With the flag up all ten are " +
      "made visible and parked at the centre of the screen — the companion to `setuptour` above, which places the " +
      "narrators themselves.",
  },
  {
    file: "house.shp",
    handler: /^visdeg$/,
    title: "Command-click opens the debugger",
    text:
      "Held while this prop is being shown, **command** calls `debugger()`, which opens the in-engine debugger on the " +
      "disc and is a no-op here.",
  },
  {
    file: "main.stg",
    handler: /^mousedown$/,
    title: "Option-click the room itself opens the debugger",
    text: "The main stage's own mousedown calls `debugger()` on an option-click.",
  },
  {
    file: "photo.shp",
    handler: /^mousedown$/,
    title: "The photo album's debugger — and it is not behind the flag",
    text:
      "Option-clicking in the photo album calls `debugger()`. One of the four ungated modifier branches, so it answers " +
      "whenever option is held.",
  },
  {
    file: "smstack.shp",
    handler: /^mousedown$/,
    title: "Option-drag rescales a smokestack prop — also ungated",
    text:
      "Dragging on the false smokestack's props with **option** held changes their `propscale` and without it their " +
      "`propzclip`, printing the value as it goes. Ungated, so it answers whenever option is held — which is why the " +
      "play page leaves `optionkey()` at 0: it is artwork, and a drag reshapes it.",
  },
  {
    file: "inven.shp",
    handler: /^addallinven$/,
    title: "Every item in the game, at once",
    text:
      "Loops `countitems()` and adds all of them. Invoked from the script editor on the disc; type " +
      "`sendtoshop (\"inven.shp\", addallinven ())` into the console.",
  },
  {
    file: "inven.shp",
    handler: /^movies$/,
    title: "Play every item's own film",
    text: "Sends `infoyoself()` to each item in turn, which plays its info movie. Reached through the console the same way.",
  },
  {
    file: "inven.shp",
    handler: /^stdmouse$/,
    title: "Option-click an item to name it",
    text: "Option-clicking an item in the inventory panel prints its name to the log and asks for its script.",
  },
  {
    file: "bomb.stg",
    handler: /^solvebomb$/,
    title: "Solve the bomb",
    text:
      "Opens the bomb's door, sets the key's position, kills its power and puts the **bomb key** in your inventory. " +
      "Reached through the console.",
  },
  {
    file: "patty.stg",
    handler: /^solvedoll$/,
    title: "Solve the doll",
    text: "Sets the four dials of the Russian doll puzzle to their answer. Reached through the console.",
  },
  {
    file: "bootfile",
    handler: /^menuselect$/,
    when: /openpuppetfile/,
    title: "Options ▸ Close Puppet — open any conversation by name",
    text:
      "With a conversation open it shuts it. With none open it asks you to type a name and opens `<name>.pup` cold — " +
      "the quickest way to look at a conversation you would otherwise have to earn.",
  },
  {
    file: "bootfile",
    handler: /^menuselect$/,
    when: /questiondialog/,
    title: "Options ▸ Quit stops asking",
    text:
      "A player gets \"are you sure?\" and an offer to save first. With the flag up the whole confirmation block is " +
      "skipped and Quit quits.",
  },
  {
    file: "bootfile",
    handler: /^menuselect$/,
    when: /lockevents/,
    title: "The menu works while the game is busy",
    text:
      "Menu commands are normally dropped whenever `lockevents` is set — during a film, a walk, a scripted beat. The " +
      "flag lets a developer pick one anyway.",
  },
  {
    file: "bootfile",
    handler: /^menuselect$/,
    title: "The Scripts menu — nine commands that open an editor",
    text:
      "`painting scripts`, `scene script`, `set script`, `button scripts`, `flat script` and the rest each sweep the " +
      "current view, set or flat and call the matching `*script` builtin, with **option** held widening the sweep to " +
      "every scene in the set. They need the authoring tool: TI.EXE tests an \"editor available\" flag that is " +
      "clear in shipping builds, so `/devmode/` greys them out and says so.",
  },
  {
    file: "bootfile",
    handler: /^closeset$/,
    title: "A leak check on the way out of a room",
    text:
      "Leaving a set, the flag makes the game walk every actor and raise a dialog naming any that is **still visible** " +
      "— a check for a character left on screen who should have been put away.",
  },
  {
    file: "bootfile",
    handler: /^boot$/,
    when: /debugging = false/,
    title: "The one assignment",
    text:
      "`debugging = false`, the fourteenth line of `boot()`, and the only write to this global in the game data. " +
      "Options ▸ Debug On/Off lowers it again — the case is `if debugging → debugging = false`, so the command only " +
      "ever turned developer mode off and the way back was to relaunch. `/devmode/` makes all three of its switches " +
      "toggle.",
  },
  {
    file: "bootfile",
    handler: /^boot$/,
    when: /optionquit/,
    title: "Holding option+shift at launch arms a quit guard",
    text:
      "Launch with both held and `optionquit` is set, which makes **Options ▸ Quit during a guided tour** require the " +
      "same two keys held again. A guard against somebody ending a museum kiosk's tour by accident. Not behind the " +
      "flag — it is read at boot, before anything is decided.",
  },
  {
    file: "bootfile",
    handler: /^boot$/,
    title: "The menu bar and the keyboard abort",
    text:
      "`menuvisible (debugging)` is what put the menu bar on the screen, and `keyaborts (debugging)` is what let a " +
      "keypress abandon whatever the game was doing — TI.EXE's \"Programmer keyboard abort.\". Both take the flag " +
      "directly, so a debug build got both. `/devmode/` rebuilds the bar in HTML from the executable's own resource.",
  },
];

/** the note that claims a branch, if any */
function noteFor(g: { file: string; handler: string; snippet: string }): Note | null {
  return (
    NOTES.find(
      (n) =>
        n.file === g.file &&
        n.handler.test(g.handler) &&
        (!n.when || n.when.test(g.snippet)),
    ) ?? null
  );
}

// ---- grouping: identical (file, handler, line, effect) collapse ----
interface Group {
  key: string;
  file: string;
  handler: string;
  line: string;
  effect: string;
  snippet: string;
  purpose: string;
  containers: number[];
}
const groups = new Map<string, Group>();
for (const h of hits) {
  const key = `${h.file}\u0000${h.handler}\u0000${h.line}\u0000${h.effect}\u0000${h.snippet}`;
  const g = groups.get(key) ?? {
    key,
    file: h.file,
    handler: h.handler,
    line: h.line,
    effect: h.effect,
    snippet: h.snippet,
    purpose: purpose(h),
    containers: [],
  };
  g.containers.push(h.container);
  groups.set(key, g);
}
const all = [...groups.values()].sort(
  (a, b) => b.containers.length - a.containers.length || a.file.localeCompare(b.file),
);

const flagHits = hits.filter((h) => h.flag);
const probeHits = hits.filter((h) => h.probes.length);
const byProbe = (p: Probe): Hit[] => hits.filter((h) => h.probes.includes(p));
const gated = (p: Probe): number => byProbe(p).filter((h) => h.flag).length;
const callsOf = (p: Probe): number => hits.reduce((n, h) => n + h.calls[p], 0);
const probeContainers = new Set(probeHits.map((h) => `${h.file}#${h.container}`)).size;
const md = (s: string): string => s.replace(/\|/g, "\\|");
const cell = (s: string): string => (s ? `\`${md(s)}\`` : "—");
const files = [...new Set(flagHits.map((h) => h.file))].sort();

let unwritten = 0;
let unusedNotes: string[] = [];
const lines: string[] = [];
const w = (s = ""): void => void lines.push(s);

w("# Developer mode: the census");
w();
w("*Every use of `debugging` and of the three modifier probes, in the English tree.*");
w();
w("**GENERATED — do not edit.** `npx tsx taoot/tools/devcensus.ts`.");
w("[Developer mode](devmode.md) is the guide; this is the full list.");
w();
w("Scope: " + SCRIPT_BEARING_NAMES + ", read through the game's own file index, which");
w("resolves each basename once across the two discs.");
w();
w("| | |");
w("|---|---|");
w(`| script-bearing files read | ${filesRead} |`);
w(`| containers carrying a script | ${containersRead} |`);
w(`| lines reading \`debugging\` | ${flagHits.length}, in ${files.length} files |`);
w(`| modifier-probe **calls** | ${PROBES.reduce((n, p) => n + callsOf(p), 0)}, on ${probeHits.length} lines in ${probeContainers} containers |`);
for (const p of PROBES)
  w(
    `| …\`${p}()\` | ${callsOf(p)} calls on ${byProbe(p).length} lines, of which ${gated(p)} also test \`debugging\` |`,
  );
w();
w("## The one assignment");
w();
w("`debugging` is written in one place in the corpus, BOOTFILE's `boot()`, and the");
w("menu's `debug on/off` lowers it again. A saved game writes it too: the flag is");
w("among the numeric globals every `.ti` restores, stored as 0 in all of them.");
w();
w("## What the flag is for");
w();
w("Every occurrence classified by the call its branch makes, from the effect line");
w("itself (`taoot/tools/devcensus.ts`).");
w();
w("| What it does | Occurrences | Files |");
w("|---|---:|---|");
{
  const byPurpose = new Map<string, Hit[]>();
  for (const h of hits) {
    const k = purpose(h);
    byPurpose.set(k, [...(byPurpose.get(k) ?? []), h]);
  }
  for (const [k, hs] of [...byPurpose.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const fs = [...new Set(hs.map((h) => h.file))].sort();
    const shown = fs.length > 6 ? `${fs.slice(0, 6).map((f) => `\`${f}\``).join(", ")} …` : fs.map((f) => `\`${f}\``).join(", ");
    w(`| ${k} | ${hs.length} | ${shown} |`);
  }
}
w();
/**
 * Which KINDS get written up.
 *
 * By the kind's total rather than by each group's own count: the script-editor
 * openers are one four-line `mousedown` copied onto every clickable prop in the
 * game and spread over 32 files, so a per-group threshold let most of them back
 * in one file at a time and buried the branches that are each different.
 */
const QUOTE_UNDER = 20;
const kindTotal = new Map<string, number>();
for (const h of hits) kindTotal.set(purpose(h), (kindTotal.get(purpose(h)) ?? 0) + 1);
const bulkKinds = [...kindTotal.entries()].filter(([, n]) => n >= QUOTE_UNDER).map(([k]) => k);

w("## What you can actually do");
w();
w("What each branch lets you do, and how to reach it, for every kind the game does");
w("in only a handful of places. The script behind each is under a disclosure.");
w();
{
  const rare = all.filter((g) => !bulkKinds.includes(g.purpose));
  /** note -> the groups it claims, merged */
  const claimed = new Map<Note, Group[]>();
  const orphans: Group[] = [];
  for (const g of rare) {
    const n = noteFor(g);
    if (!n) orphans.push(g);
    else claimed.set(n, [...(claimed.get(n) ?? []), g]);
  }
  // biggest first: the deck map and the bedsit door are what a reader came for
  const entries = [...claimed.entries()].sort(
    (a, b) =>
      b[1].reduce((n, g) => n + g.containers.length, 0) - a[1].reduce((n, g) => n + g.containers.length, 0),
  );
  for (const [note, gs] of entries) {
    const where = gs
      .map((g) => {
        const cs = g.containers.sort((a, b) => a - b);
        const list = cs.length > 8 ? `${cs.slice(0, 8).join(", ")} … (+${cs.length - 8})` : cs.join(", ");
        return `\`${g.file}\` · \`${g.handler}\` · ${cs.length === 1 ? "container" : "containers"} ${list}`;
      })
      .join("<br>");
    w(`### ${note.title}`);
    w();
    w(note.text);
    w();
    w(`<small>${where}</small>`);
    w();
    w("<details><summary>the script</summary>");
    w();
    for (const g of gs) {
      w("```");
      w(g.snippet);
      w("```");
      w();
    }
    w("</details>");
    w();
  }
  if (orphans.length) {
    w("### Not yet written up");
    w();
    w("These branches have no note in `taoot/tools/devcensus.ts` yet. They are listed");
    w("so that a new one cannot arrive unnoticed.");
    w();
    for (const g of orphans) {
      w(`- \`${g.file}\` · \`${g.handler}\` · containers ${g.containers.sort((a, b) => a - b).join(", ")} — \`${md(g.line)}\``);
    }
    w();
  }
  unwritten = orphans.length;
  unusedNotes = NOTES.filter((n) => !claimed.has(n)).map((n) => n.title);
}
w("### The kinds that are not written up");
w();
w("One shape each, copied onto every clickable prop and region in the game: a");
w("developer shift-clicking a prop wanted that prop's script, so the same few lines");
w("sit on all of them. The widest copy of each:");
w();
for (const kind of bulkKinds.sort((a, b) => (kindTotal.get(b) ?? 0) - (kindTotal.get(a) ?? 0))) {
  const gs = all.filter((g) => g.purpose === kind);
  const canonical = gs.slice().sort((a, b) => b.containers.length - a.containers.length)[0];
  const spread = gs.reduce((n, g) => n + g.containers.length, 0);
  const inFiles = new Set(gs.map((g) => g.file)).size;
  w(`**${kind}** — ${spread} occurrences across ${inFiles} files. The widest copy is`);
  w(`\`${canonical.file}\` · \`${canonical.handler}\` (${canonical.containers.length} containers):`);
  w();
  w("```");
  w(canonical.snippet);
  w("```");
  w();
}
w("## Every occurrence");
w();
w("Identical branches in one file collapse into a row carrying its container count;");
w("the totals above are over occurrences. `Effect` is the first call the branch");
w("makes, quoted from the script.");
w();
w("| File | Handler | × | Condition | Effect |");
w("|---|---|---:|---|---|");
for (const g of all) {
  w(
    `| \`${g.file}\` | \`${g.handler}\` | ${g.containers.length} | ${cell(g.line)} | ${cell(g.effect)} |`,
  );
}
w();
w("## Which containers");
w();
w("Every container behind each row above, for finding a line in the file it came");
w("from.");
w();
w("| File | Handler | Condition | Containers |");
w("|---|---|---|---|");
for (const g of all) {
  const list = g.containers.sort((a, b) => a - b);
  const shown = list.length > 24 ? `${list.slice(0, 24).join(", ")} … (+${list.length - 24})` : list.join(", ");
  w(`| \`${g.file}\` | \`${g.handler}\` | ${cell(g.line)} | ${shown} |`);
}
w();
w("Back to [Developer mode](devmode.md).");

writeFileSync(OUT, lines.join("\n") + "\n");
console.log(
  `${OUT}: ${flagHits.length} debugging lines + ${probeHits.length} probe lines in ${all.length} rows, ` +
    `from ${containersRead} scripts in ${filesRead} files`,
);
// Loud, because the whole value of the prose layer is that it is complete: an
// unwritten branch is a thing the page silently does not tell anyone about.
if (unwritten) console.log(`  ${unwritten} branch(es) have no note yet — see "Not yet written up"`);
for (const t of unusedNotes) console.log(`  note matches nothing any more: "${t}"`);
