/**
 * Day six's route, from the engine rooms' elevator: the hive until its
 * ENEMIES bar is empty, its elevator down to the final chamber, that chamber's
 * bar emptied again, and the queen — the end of the game. Played by
 * `city-bot.ts`.
 */
import { CityBot } from "../city-bot";
import { fail, ok, type Headless } from "../harness";

export function playDay6(h: Headless): void {
  const g = h.game;
  const m = g.m;
  const level = (): number => g.progress.level;
  const saw = (film: string): boolean => h.logs.some((l) => l.startsWith("▶ ") && l.includes(film));
  if (level() !== 21 || !g.city?.world) fail(`day 6 does not start in the hive (level ${level()})`);
  if (g.city.drones.length !== 4) fail(`the hive has ${g.city.drones.length} drones, not 4`);
  ok(`the hive: ${g.city.world.maze.name}, ${g.city.drones.length} drones`);

  const bot = new CityBot(h);
  const t0 = m.ticks;
  bot.play(60000, () => level() === 22 && !!g.city?.world);
  if (!saw("day6/finalout.mov")) fail("the hive's elevator did not play finalout.move");
  if (g.hud.enemies !== 10000) fail(`the final chamber opened with the ENEMIES bar at ${g.hud.enemies}`);
  ok(`the hive is clear: ${bot.kills} kills, ${bot.trips} trip(s), ${Math.round((m.ticks - t0) / 3600)} game minutes; down to the final chamber (${g.city!.world.maze.name})`);

  const t1 = m.ticks;
  bot.play(60000, () => g.won);
  for (const f of ["finalin.mov", "trans.mov", "final.mov"]) if (!saw(`day6/${f}`)) fail(`the end did not play ${f}`);
  if (!h.logs.some((l) => l.startsWith("talk day6/queen.1"))) fail("the queen did not talk");
  if (!g.won || level() !== 0) fail(`not won: level ${level()}`);
  ok(`the queen: ${bot.kills} kills in all, ${Math.round((m.ticks - t1) / 3600)} game minutes in the final chamber — the game is won`);
  // level 0 is the title again (0x416ec8): the intro, then the title waiting for File ▸ New
  h.until(() => g.phase === "title" && m.film === "flip.move", "the title after the end", 20_000);
  ok("back at the title, waiting for File ▸ New");
  ok(`the game played through: t=${m.ticks}, ${(m.ticks / 3600).toFixed(1)} game minutes, score ${g.hud.score}`);
}
