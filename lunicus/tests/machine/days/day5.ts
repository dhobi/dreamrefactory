/**
 * Day five's route, from day four's bed: the briefing, the suit and the gun
 * (the guards let an armed player by today), the lower floor's elevator down
 * to the engine rooms, and the engine rooms until the ENEMIES bar is empty and
 * their elevator goes on down to the hive. The rooms are played by
 * `city-bot.ts`.
 */
import { LOWER, UPPER } from "../../../src/game/data";
import { CityBot } from "../city-bot";
import { fail, ok, posesWith, type Headless } from "../harness";

export function playDay5(h: Headless): void {
  const g = h.game;
  const m = g.m;
  const b = () => g.base!;
  const progress = () => ({ ...g.progress });
  const saw = (film: string): boolean => h.logs.some((l) => l.startsWith("▶ ") && l.includes(film));
  if (progress().level !== 18 || b().floor !== LOWER) fail(`day 5 does not start on its lower floor (level ${progress().level})`);

  h.use(posesWith(h, 0xfe, (p) => p.y >= 18)[0]);
  if (!saw("day5/brief.mov")) fail("day 5's briefing did not play");
  if (progress().day !== 2) fail(`after day 5's briefing the progress is ${progress().day}, not 2`);
  ok("day 5's briefing: progress 2");

  h.use({ x: 3, y: 11, dir: 3 });
  if (progress().level !== 17 || b().floor !== UPPER) fail(`the elevator went to level ${progress().level}`);
  h.use(posesWith(h, 8)[0]);
  h.use(posesWith(h, 4)[0]);
  if (!progress().suit || !progress().weapon) fail("the lockers did not hand out the suit and the gun");
  h.use(posesWith(h, 2)[0]);
  if (progress().level !== 18) fail(`armed, the elevator down went to level ${progress().level}`);
  ok("suited and armed, and back down");

  // the elevator's bottom button: the engine rooms (0x40134e)
  h.press(1);
  h.use({ x: 3, y: 11, dir: 3 });
  h.until(() => g.phase === "city" && !!g.city?.world, "the first engine room");
  if (!saw("day5/engin1ou.mov")) fail("the elevator did not play engin1out.move");
  if (progress().level !== 19) fail(`the elevator's bottom button went to level ${progress().level}`);
  if (g.hud.enemies !== 10000 || g.hud.bullets !== 10000) fail(`the engine rooms opened without a full HUD: ${JSON.stringify(g.hud)}`);
  if (g.city!.drones.length !== 3) fail(`day 5 has ${g.city!.drones.length} drones, not 3`);
  ok(`down to the engine rooms: level 19, ${g.city!.drones.length} drones (t=${m.ticks})`);

  const bot = new CityBot(h);
  const t0 = m.ticks;
  bot.play(60000, () => g.progress.level === 0x15);
  if (!saw("day5/tohive.mov")) fail("the engine rooms did not end with tohive.move");
  const rooms = new Set(h.logs.filter((l) => /^engin[12]maze/.test(l)).map((l) => l.slice(0, 10)));
  ok(`the engine rooms are clear: ${bot.kills} kills, ${bot.shots} bursts, ${bot.trips} trip(s), both rooms: ${[...rooms].join(" ")}, ${Math.round((m.ticks - t0) / 3600)} game minutes`);
  if (progress().level !== 21) fail(`the engine rooms went on to level ${progress().level}, not the hive`);
  h.until(() => !!g.city?.world, "the hive");
  ok(`at the hive's door: level 21 (t=${m.ticks}, ${(m.ticks / 3600).toFixed(1)} game minutes in all)`);
}
