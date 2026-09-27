/**
 * Write `gamefiles/save/day1.save` … `day7.save`: a saved game at the start of
 * each of RedJack's seven days.
 *
 *   npx tsx tools/mksaves.mts        (from redjack/)
 *
 * These are the PORT's saves, not the original's. No save made by RedJack.exe
 * is available, so the machine suites play the game from the cold boot to the
 * end, and this writes one save a day through the port's own `savegame`
 * (engine/src/runtime/saveload-v5.ts), in the format read out of RedJack.exe
 * (docs/engine/formats/savegame-v5.md). The first file RedJack.exe itself
 * writes is the check on all of them.
 *
 * "The start of a day" is the first moment in it where the original would
 * let you save: a room open, no conversation and no stage up, nobody on a road,
 * the game idle, and no script running or waiting. Most days open inside a
 * talk (day two's is Justice finding the stowaway), and RedJack.exe refuses to
 * save with a puppet open, so the save is taken as that talk ends. Day seven's
 * opening is one script from the standoff through the Spaniard's fight, so its
 * save comes after that fight. The moment is watched for after every pass of
 * the engine while the day suites play, so the suites themselves are untouched.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { headless, ok } from "../tests/machine/harness";
import { playDay1 } from "../tests/machine/days/day1";
import { playDay2 } from "../tests/machine/days/day2";
import { playDay3 } from "../tests/machine/days/day3";
import { playDay4 } from "../tests/machine/days/day4";
import { playDay5 } from "../tests/machine/days/day5";
import { playDay6 } from "../tests/machine/days/day6";
import { playDay7 } from "../tests/machine/days/day7";

const OUT = resolve(import.meta.dirname, "../gamefiles/save");
mkdirSync(OUT, { recursive: true });

const h = await headless();
const s = h.session;
const due = new Set([1, 2, 3, 4, 5, 6, 7]);

// ...and no script held anywhere, not even one paused in a `delay` between a
// day's films and its first talk: a load stops every script, in RedJack.exe as
// here, and a save taken there would come back with the day's opening lost
const savable = (): boolean =>
  !!s.maze && h.idle() && !s.puppetCtrl.puppet && (!s.stageName || s.stageName === "none") && !s.scriptBusy;

const tick = h.host.director.tick.bind(h.host.director);
h.host.director.tick = (now: number) => {
  const frame = tick(now);
  watch();
  return frame;
};
function watch(): void {
  const day = Number(s.interp.globals.get("day") ?? 0);
  if (!due.has(day) || !savable()) return;
  const bytes = s.snapshotSave("2");
  if (!bytes) return;
  due.delete(day);
  writeFileSync(resolve(OUT, `day${day}.save`), bytes);
  ok(`day${day}.save: ${s.currentSetFile} at ${s.maze?.sceneName}, ${(bytes.length / 1024).toFixed(0)} KB`);
}

for (const play of [playDay1, playDay2, playDay3, playDay4, playDay5, playDay6, playDay7]) await play(h);
if (due.size) console.log(`no savable moment found on day ${[...due].join(", ")}`);
process.exit(due.size ? 1 : 0);
