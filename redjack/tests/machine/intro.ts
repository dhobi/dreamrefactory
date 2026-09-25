/**
 * The boot, the three films and the first room — cold, from the discs.
 *
 *   npx tsx tests/machine/intro.ts        (from redjack/)
 *
 * What the BOOTFILE does before the player has the game, and what this checks:
 *
 *   - **the films, in order**: `thq.move`, `cflogo.move`, then `intro.move` in
 *     its three segments. A film the port cannot open is a skipped line in the
 *     log and nothing on screen, so the order is read off the log.
 *   - **the landing**: `opensetfile ("liznite.sett", "Node52", "node")`, on disc
 *     one, with the casts and shops the room asks for.
 *   - **the player has it**: the room owns the screen, nothing walks and nothing
 *     runs — the state every later suite starts from.
 *   - **no script error** on the way: the interpreter logs one and carries on,
 *     which is exactly what a machine run is here to notice.
 */
import { STEP, fail, headless, ok, pass } from "./harness";

const h = await headless();
ok("the BOOTFILE boots from disc one");

const films = (): string[] =>
  h.logs.flatMap((l) => {
    const m = /^movie: (\S+)(?: \((\d)\/\d segments\)| segment (\d)\/\d)?/.exec(l);
    return m ? [`${m[1]}${m[2] || m[3] ? `#${m[2] ?? m[3]}` : ""}`] : [];
  });
const WANT = ["thq.move", "cflogo.move", "intro.move#1", "intro.move#2", "intro.move#3"];

const passes = await h.until(() => h.room() === "liznite" && h.owner() === "world", "the first room", 60_000);
const seen = films();
if (seen.join() !== WANT.join()) fail(`films ${seen.join(", ") || "(none)"}; the BOOTFILE plays ${WANT.join(", ")}`);
ok(`${WANT.join(", ")}, in order (${Math.round((passes * STEP) / 1000)} s of game time)`);

await h.settle("the first room");
if (h.node() !== "Node52") fail(`the room opens at ${h.node()}; the boot names Node52`);
if (h.disc() !== 1) fail(`the game says disc ${h.disc()}; day one is disc one`);
ok(`liznite at Node52, disc one, the room owns the screen and nothing runs`);

for (const want of ["cast loaded: gang.cast", "shop loaded: liznite.shop", "shop loaded: inven.shop"]) {
  if (!h.logs.some((l) => l.startsWith(want))) fail(`never logged "${want}"`);
}
ok("the gang, the room's props and the inventory are loaded");

const errors = h.logs.filter((l) => /script error|cannot parse|not found on/i.test(l));
if (errors.length) fail(`${errors.length} error(s) on the way in, first: ${errors[0]}`);
ok("no script error from the boot to the first room");

pass("intro");
