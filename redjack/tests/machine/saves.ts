/**
 * Saving and loading, played: a `.save` written out of the running game, loaded
 * back into it, and written again, has to say the same thing twice.
 *
 *   npx tsx tests/machine/saves.ts        (from redjack/)
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readSaveV5 } from "@dreamfactory/engine/df/savegame-v5";
import { fail, headless, ok, pass } from "./harness";
import { playDay6 } from "./days/day6";

const h = await headless();
await h.until(() => h.room() === "liznite" && h.owner() === "world", "the first room", 60_000);
await h.settle("the first room");

const first = h.session.snapshotSave("2");
if (!first) fail("no save written in liznite");
const a = readSaveV5(first);
ok(`saved in ${a.runt.setName} at ${a.runt.scene}: ${a.actors.length} actors, ${a.props.length} props, ${a.globals.length} globals, ${a.casts.length} casts, ${a.shops.length} shops, ${a.tracks.length} tracks`);

if (!(await h.session.loadGame(first, "2"))) fail(`the save did not load:\n  ${h.logs.slice(-5).join("\n  ")}`);
const dropped = h.logs.filter((l) => /opengame: .*(dropped|left standing|left out)/.test(l));
if (dropped.length) console.log(dropped.join("\n"));
if (h.room() !== "liznite" || h.node().toLowerCase() !== a.runt.scene.toLowerCase()) fail(`the load arrived in ${h.room()} at ${h.node()}`);
ok(`loaded: back in ${h.room()} at ${h.node()}`);

const b = readSaveV5(h.session.snapshotSave("2")!);
const lost = a.props.filter((p) => !b.props.some((q) => q.name === p.name)).map((p) => p.name);
if (lost.length) console.log("lost props:", lost.join(", "), "| logs:", h.logs.filter((l) => /bottles|propinstance/.test(l)).slice(0, 6).join(" / "));
const plain = (s: ReturnType<typeof readSaveV5>) => JSON.stringify({ ...s, runt: { ...s.runt, frame: 0 } }, (_k, v) => (v instanceof Uint8Array ? Array.from(v).join(",") : v));
if (plain(a) !== plain(b)) {
  const ka = JSON.parse(plain(a)), kb = JSON.parse(plain(b));
  const diff = Object.keys(ka).filter((k) => JSON.stringify(ka[k]) !== JSON.stringify(kb[k]));
  for (const k of diff) {
    if (Array.isArray(ka[k])) {
      const i = ka[k].findIndex((x: unknown, j: number) => JSON.stringify(x) !== JSON.stringify(kb[k][j]));
      console.log(`  ${k}[${i}]: ${JSON.stringify(ka[k][i])}\n     vs ${JSON.stringify(kb[k][i])}  (lengths ${ka[k].length}/${kb[k].length})`);
    } else console.log(`  ${k}: ${JSON.stringify(ka[k]).slice(0, 300)}\n     vs ${JSON.stringify(kb[k]).slice(0, 300)}`);
  }
  fail(`saving the loaded game wrote something else: ${diff.join(", ")}`);
}
ok("saving the loaded game writes the same save");

// A player's save is made on the control panel (space, then SAVE), so it holds
// the panel's stage; loading it brings the panel back, and its OK returns to
// the room, which the panel's `exit ()` shows again as it would after any visit
h.key(" ");
await h.until(() => h.session.stageName === "control.stag", "the control panel", 2_000);
await h.settle("the control panel");
const onPanel = h.session.snapshotSave("2")!;
if (!(await h.session.loadGame(onPanel, "2"))) fail("a save made on the panel did not load");
if (h.session.stageName !== "control.stag") fail(`a save made on the panel loads to stage ${h.session.stageName}`);
await h.settle("the panel after the load");
h.click(126, 435);
await h.until(() => h.session.stageName === "none" && h.owner() === "world", "OK back to the room", 2_000);
await h.settle("the room after OK");
if (!h.session.setVisible) fail("OK on the reloaded panel left the room hidden");
ok(`a save made on the control panel loads onto the panel, and OK returns to ${h.room()} at ${h.node()}`);

// Each day's save, from tools/mksaves.mts, loaded into the running game one
// after another: it arrives where it was saved, on its day, and saving it again
// says the same thing (only the discs it needs are switched by the load itself)
const dir = resolve(import.meta.dirname, "../../gamefiles/save");
for (let day = 1; day <= 7; day++) {
  const path = resolve(dir, `day${day}.save`);
  if (!existsSync(path)) {
    console.log(`skip  day${day}.save is not there (npx tsx tools/mksaves.mts writes it)`);
    continue;
  }
  const bytes = new Uint8Array(readFileSync(path));
  const want = readSaveV5(bytes);
  const from = h.logs.length;
  if (!(await h.session.loadGame(bytes, "2"))) fail(`day${day}.save did not load:\n  ${h.logs.slice(from).slice(-5).join("\n  ")}`);
  if (h.room() !== want.runt.setName.toLowerCase() && `${h.room()}` !== baseOf(want)) fail(`day${day}.save arrived in ${h.room()}, not ${want.runt.setName}`);
  if (h.node().toLowerCase() !== want.runt.scene.toLowerCase()) fail(`day${day}.save arrived at ${h.node()}, not ${want.runt.scene}`);
  if (Number(h.session.interp.globals.get("day")) !== day) fail(`day${day}.save loads as day ${h.session.interp.globals.get("day")}`);
  const again = readSaveV5(h.session.snapshotSave("2")!);
  if (plain(again) !== plain(want)) fail(`saving day${day}.save once loaded wrote something else`);
  await h.settle(`day ${day} after its load`);
  const errors = h.logs.slice(from).filter((l) => /script error|cannot parse|not found on|dropped|left standing/i.test(l));
  if (errors.length) fail(`day${day}.save: ${errors.slice(0, 4).join(" / ")}`);
  ok(`day${day}.save: day ${day} in ${h.room()} at ${h.node()}, and saving it again writes the same save`);
}
// ...and a loaded game plays on: day six's save is taken as the day opens, so
// its suite can play the whole day from it, through to day seven
if (existsSync(resolve(dir, "day6.save"))) {
  if (!(await h.session.loadGame(new Uint8Array(readFileSync(resolve(dir, "day6.save"))), "2"))) fail("day6.save did not load");
  await h.settle("day six after its load");
  await playDay6(h);
  if (Number(h.session.interp.globals.get("day")) !== 7) fail("day six from its save did not end in day seven");
  ok("day six played from day6.save to its end, into day seven");
}
pass("saves");

/** the room a save's set handle names, by file */
function baseOf(s: ReturnType<typeof readSaveV5>): string {
  const f = s.files.find((x) => x.handle === s.runt.setHandle)?.path ?? "";
  return f.slice(f.lastIndexOf("\\") + 1).replace(/\.sett$/i, "").toLowerCase();
}
