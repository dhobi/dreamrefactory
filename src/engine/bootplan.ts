/**
 * What a game's own boot needs, read out of its BOOTFILE.
 *
 * The host has to know two things before it can start a DreamFactory game over
 * HTTP: which files to have in hand so `boot()` never waits mid-sequence, and
 * which room the boot ends up in. Both used to be hardcoded lists of TAOOT
 * filenames — `bedsit1.set`, `logo.mov`, `gang.cst`, `house.shp`, sixteen of them
 * — which is knowledge about one game sitting in the layer that runs any of them.
 * The 1996 demo shares four of those names and needs a fifth the list had never
 * heard of, and a different CyberFlix title would share almost none.
 *
 * So they are read instead. Every one of those files is named, as a string
 * literal, by the boot's own scripts:
 *
 *   opencastfile ("gang.cst")      openshopfile ("house.shp")
 *   opentrackfile ("unilib.trk")   openstagefile ("main.stg")
 *   playmovie ("logo.mov")         initall ("bedsit1")
 *
 * — so the BOOTFILE is the manifest, and this module reads it.
 *
 * ## Where the walk stops, and why
 *
 * The scan follows calls out of `boot()` through the boot library, which is what
 * catches a resource the entry point opens indirectly (the demo's `boot()` ends in
 * `menuscreen()`, and *that* is what opens `demo.stg`).
 *
 * It stops at the {@link DAY_MACHINE} handlers. That boundary is not a
 * convenience — `boot()` ends with `sendtostage(advanceday())`, so a walk that
 * followed it would run on into the entire story: the full game's `advanceday`
 * names `ocredits.mov`, `leave.mov` and `credits.mov`, 85 MB of endgame that a
 * player five seconds into a launch must not be waiting for. It is also exactly
 * the split the host already works to — `GameHost.coldBoot` runs `boot()` and then
 * kicks the day advance itself, because that closing `sendtostage` cannot reach
 * the boot library — so the plan divides where the host divides: `resources` is
 * what the boot needs, {@link BootPlan.landingSet} is where the day machine goes.
 *
 * Those two handler names and `boot` are the only names left in here. That is the
 * whole of what this layer now knows about any particular game.
 */
import { readContainerFile } from "../df/container";
import { sniffScript } from "../df/script";
import { parseScript } from "./parser";
import type { CallExpr, CodeBlock, Expr, Stmt } from "./ast";

/** the startup routine every DreamFactory BOOTFILE defines */
const BOOT_HANDLER = "boot";

/**
 * The day machine: the handlers that move the story on a day, which the host
 * kicks itself after `boot()` returns. A boundary for the scan (see the module
 * comment) and the place the first room is named.
 */
const DAY_MACHINE = ["advanceday", "advancetour"];

/**
 * Calls whose first string literal is a FILE the boot will read.
 *
 * `fileexists` is deliberately absent though it names one: the demo's `boot()`
 * does `fileexists("gstair2.set")` as its "is the CD in the drive?" check, and
 * fetching 9 MB of grand staircase to answer a question about presence would be
 * the most expensive no-op in the boot.
 */
const RESOURCE_CALLS = new Set([
  "opencastfile", "openshopfile", "openstagefile", "opentrackfile",
  "opensetfile", "playmovie", "playtheme", "playnewtheme",
]);

/** calls that name a ROOM rather than a file — `initall("bedsit1")` */
const ROOM_CALLS = new Set(["initall", "changeset", "opensetfile", "gotospecial"]);

/**
 * The routine that mounts a volume, and the call inside it that names one.
 *
 * `setpath(disk)` is how a multi-CD DreamFactory game switches discs, and it says
 * outright which volume each disc is: TAOOT's does `currentcd("Titanic1")` then
 * `mainpath = "titanic1:"` under `if disk = 1`, and the same for 2. A game with no
 * `setpath` does not switch discs, which is why the demo — one volume, and its
 * `boot()` just assigns `mainpath = "3pacdemo:titanic:"` once — yields none.
 */
const VOLUME_ROUTINE = "setpath";
const VOLUME_CALL = "currentcd";

export interface BootPlan {
  /**
   * Every file the startup path names, in the order the boot reaches them —
   * what {@link GameHost.preload} fetches and totals up before the game starts.
   */
  resources: string[];
  /**
   * The cast files the boot opens. Separate because a set change has to keep the
   * story cast in hand while it swaps everything else out, and that is the only
   * subset of the boot's resources a room needs re-asserted.
   */
  casts: string[];
  /**
   * The room the day machine opens first, as a filename (`"bedsit1.set"`), or
   * null when the boot has no day machine of its own.
   *
   * Null is not a degenerate case — it is the demo, whose `boot()` ends on a menu
   * stage and whose `advanceday` lives in `main.stg`, opened three clicks later
   * by the script behind the menu. A boot with no landing room has none to
   * preload and no day for the host to advance, which is precisely the
   * difference between the two cold-boot paths.
   */
  landingSet: string | null;
  /**
   * The volume (CD) directories this game's `setpath` mounts, lowercased and in
   * disc order — `["titanic1", "titanic2"]`.
   *
   * Empty for a single-volume game, which is the honest answer rather than a
   * degenerate one: the demo has no `setpath` at all, and nothing about it needs a
   * disc. {@link FileStore.setVolumes} turns this into "which copy of a basename
   * that ships twice wins", which used to be a `/titanic([12])/` regex.
   */
  volumes: string[];
}

/** what a tree with no readable BOOTFILE plans: nothing, and nothing to boot */
export const EMPTY_BOOT_PLAN: BootPlan = {
  resources: [], casts: [], landingSet: null, volumes: [],
};

/** the call's first argument if it is a non-empty string literal */
function literalArg(call: CallExpr): string | null {
  const first = call.args[0];
  return first && first.t === "str" && first.v ? first.v : null;
}

/** a room reference as a filename: `initall("bedsit1")` -> `"bedsit1.set"` */
function setFileName(name: string): string {
  return /\.[a-z0-9]+$/i.test(name) ? name : `${name}.set`;
}

function walkExpr(e: Expr, onCall: (c: CallExpr) => void): void {
  switch (e.t) {
    case "call":
      onCall(e);
      for (const a of e.args) walkExpr(a, onCall);
      break;
    case "bin":
      walkExpr(e.l, onCall);
      walkExpr(e.r, onCall);
      break;
    case "un":
      walkExpr(e.e, onCall);
      break;
    default:
      break; // int/str/bool/me/target/var carry no calls
  }
}

function walkStmts(body: Stmt[], onCall: (c: CallExpr) => void): void {
  for (const s of body) {
    switch (s.t) {
      case "assign":
        walkExpr(s.value, onCall);
        break;
      case "callstmt":
        walkExpr(s.call, onCall);
        break;
      case "if":
        walkExpr(s.cond, onCall);
        walkStmts(s.then, onCall);
        if (s.else_) walkStmts(s.else_, onCall);
        break;
      case "switch":
        walkExpr(s.subject, onCall);
        for (const c of s.cases) {
          walkExpr(c.match, onCall);
          walkStmts(c.body, onCall);
        }
        break;
      case "while":
        walkExpr(s.cond, onCall);
        walkStmts(s.body, onCall);
        break;
      case "for":
        walkExpr(s.from, onCall);
        walkExpr(s.to, onCall);
        if (s.step) walkExpr(s.step, onCall);
        walkStmts(s.body, onCall);
        break;
      case "return":
        if (s.value) walkExpr(s.value, onCall);
        break;
      default:
        break; // decl/exitcode/passcode/noop carry no calls
    }
  }
}

/** the boot library's handlers by lowercase name; the first definition wins,
 *  which is the order events traverse the containers in (GameSession) */
function bootHandlers(bootfile: Uint8Array): Map<string, CodeBlock> {
  const codes = new Map<string, CodeBlock>();
  const file = readContainerFile(bootfile);
  for (let i = 1; i < file.containers.length; i++) {
    const tokens = sniffScript(file.containers[i].data);
    if (!tokens) continue;
    let script;
    try {
      script = parseScript(tokens);
    } catch {
      continue; // a container that will not parse names no resources
    }
    for (const [name, code] of script.codes) {
      const key = name.toLowerCase();
      if (!codes.has(key)) codes.set(key, code);
    }
  }
  return codes;
}

/**
 * Read a BOOTFILE's own startup requirements.
 *
 * Tolerant by design: a file that is not a container, a container that holds no
 * scripts, a boot library with no `boot()` at all — each yields an empty plan
 * rather than throwing, because the caller's next move is the same in every case
 * (there is nothing here to boot, and it has to say so rather than crash).
 */
export function readBootPlan(bootfile: Uint8Array): BootPlan {
  let codes: Map<string, CodeBlock>;
  try {
    codes = bootHandlers(bootfile);
  } catch {
    return EMPTY_BOOT_PLAN;
  }
  if (!codes.size) return EMPTY_BOOT_PLAN;

  const resources: string[] = [];
  const casts: string[] = [];
  const add = (into: string[], file: string): void => {
    const key = file.toLowerCase();
    if (!into.includes(key)) into.push(key);
  };

  const visited = new Set<string>(DAY_MACHINE);
  const visit = (handler: string): void => {
    const key = handler.toLowerCase();
    if (visited.has(key)) return;
    visited.add(key);
    const code = codes.get(key);
    if (!code) return;
    walkStmts(code.body, (call) => {
      const name = call.name.toLowerCase();
      const file = literalArg(call);
      if (RESOURCE_CALLS.has(name)) {
        if (file) {
          add(resources, name === "opensetfile" ? setFileName(file) : file);
          if (name === "opencastfile") add(casts, file);
        }
        return;
      }
      // an engine command (it has an opcode id) is never a handler to follow
      if (call.id === undefined) visit(name);
    });
  };
  visit(BOOT_HANDLER);

  // The first room the day machine names. First, not last: the full game's
  // `advanceday` is the whole day switch and names every room the story passes
  // through, and the one that matters here is the one a cold boot lands in.
  let landingSet: string | null = null;
  for (const handler of DAY_MACHINE) {
    const code = codes.get(handler);
    if (!code || landingSet) continue;
    walkStmts(code.body, (call) => {
      if (landingSet || !ROOM_CALLS.has(call.name.toLowerCase())) return;
      const room = literalArg(call);
      if (room) landingSet = setFileName(room).toLowerCase();
    });
  }
  // The volumes setpath mounts, in the order its `disk = N` arms name them —
  // which is the disc order, and the only place it is stated.
  const volumes: string[] = [];
  const setpath = codes.get(VOLUME_ROUTINE);
  if (setpath) {
    walkStmts(setpath.body, (call) => {
      if (call.name.toLowerCase() !== VOLUME_CALL) return;
      const volume = literalArg(call);
      if (volume && !volumes.includes(volume.toLowerCase())) volumes.push(volume.toLowerCase());
    });
  }
  return { resources, casts, landingSet, volumes };
}
