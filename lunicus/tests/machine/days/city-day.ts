/**
 * A city day's route (days two to four), from the last day's bed: the
 * briefing, the suit and the gun, down to the city, the city until its node is
 * gone, back up to the station, and to bed. The city is played by
 * `city-bot.ts`.
 */
import { LOWER, UPPER } from "../../../src/game/data";
import { CityBot } from "../city-bot";
import { fail, ok, posesWith, type Headless } from "../harness";

export function playCityDay(h: Headless, day: number): void {
  const g = h.game;
  const m = g.m;
  const b = () => g.base!;
  const progress = () => ({ ...g.progress });
  const saw = (film: string): boolean => h.logs.some((l) => l.startsWith("▶ ") && l.includes(film));
  const upper = 4 * day - 3;
  const lower = upper + 1;
  if (progress().level !== lower || b().floor !== LOWER) fail(`day ${day} does not start on its lower floor (level ${progress().level})`);

  // the briefing: a city day's is the one that sends the player down
  const brief = posesWith(h, 0xfe, (p) => p.y >= 18)[0];
  h.use(brief);
  if (!saw(`day${day}/brief.mov`)) fail(`day ${day}'s briefing did not play`);
  if (progress().day !== 2) fail(`after day ${day}'s briefing the progress is ${progress().day}, not 2`);
  ok(`day ${day}'s briefing: progress 2`);
  const sasha = h.talkTo("sasha", 0);
  if (!sasha.file.endsWith("sasha.2")) fail(`Sasha on day ${day} after the briefing talked from ${sasha.file}`);
  ok(`sasha: ${sasha.file}, ${sasha.played.length} lines`);

  // up, and into the suit and the gun
  h.use({ x: 3, y: 11, dir: 3 });
  if (progress().level !== upper || b().floor !== UPPER) fail(`the elevator went to level ${progress().level}`);
  const suit = posesWith(h, 8)[0];
  const gun = posesWith(h, 4)[0];
  h.use(suit);
  h.use(gun);
  if (!progress().suit || !progress().weapon) fail("the lockers did not hand out the suit and the gun");
  ok("suited and armed");

  // the transporter, and the city
  h.use(posesWith(h, 0xfe, (p) => p.y >= 18)[0]);
  if (!saw(`day${day}/citydrop.mov`)) fail("the transporter did not drop the player into the city");
  h.until(() => g.phase === "city" && !!g.city?.world, "the city");
  // the transporter puts the player on the top floor of a building (0x40da1a: floor 5, level + 3)
  if (progress().level !== upper + 3 || progress().came !== 5) fail(`the transporter put the player on level ${progress().level}, floor ${progress().came}`);
  const ambience = (): string | undefined => m.ambience?.name;
  if (ambience() !== "citysound" || !m.ambiencePlaying) fail(`the city's ambience is not playing (${m.ambience?.name})`);
  ok(`down to the city: a building's fifth floor, citysound's ambience (t=${m.ticks})`);
  const bot = new CityBot(h);
  const t0 = m.ticks;
  bot.play();
  if (!saw(`day${day}/cityrise.mov`)) fail("the city did not end with cityrise.move");
  h.settle("back on the station");
  if (progress().level !== upper || progress().day !== 4) fail(`back from the city: level ${progress().level}, progress ${progress().day}`);
  if (ambience() !== "moonsound" || !m.ambiencePlaying) fail(`back on the station, the ambience is ${ambience()}`);
  ok(`the node is gone: ${bot.kills} kills, ${bot.shots} bursts, ${bot.trips} trip(s) for ammo, ${Math.round((m.ticks - t0) / 3600)} game minutes; back at ${JSON.stringify(h.pose())}, progress 4`);

  // the suit and the gun back — armed, the guard posts keep the player off the north of the floor
  h.use(suit);
  h.use(gun);
  if (progress().suit || progress().weapon) fail("the lockers did not take the suit and the gun back");
  h.use(posesWith(h, 2)[0]);
  if (progress().level !== lower) fail(`the elevator down went to level ${progress().level}`);
  h.use({ x: 4, y: 6, dir: 3 });
  if (!saw(`day${day}/sleep.mov`)) fail(`the bed did not play day ${day}'s sleep.move`);
  h.settle(`day ${day + 1}'s first view`);
  if (progress().level !== lower + 4 || progress().day !== 1) fail(`after sleeping: level ${progress().level}, progress ${progress().day}`);
  ok(`slept: day ${day + 1}'s lower floor (t=${m.ticks}, ${(m.ticks / 3600).toFixed(1)} game minutes in all)`);
}
