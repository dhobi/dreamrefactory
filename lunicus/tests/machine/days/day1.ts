/**
 * Day one's route: from the intro to the bed that ends the day, through
 * everything the station has on day one — both floors, their rooms, the
 * briefing, the lockers, the guard, and a talk with each of the crew. Day two
 * starts where it ends (`days/day2.ts`).
 */
import { LOWER, MSG, UPPER } from "../../../src/game/data";
import { fail, ok, posesWith, type Headless } from "../harness";

export function playDay1(h: Headless): void {
  const g = h.game;
  const m = g.m;
  // read through functions: the machine changes these under TypeScript's narrowing
  const hud = (): number => g.hud.message;
  const progress = () => ({ ...g.progress });
  const saw = (film: string): boolean => h.logs.some((l) => l.startsWith(`▶ `) && l.includes(film));

  // the opening: the intro chains to the title, which waits for File ▸ New
  // the title loops (its last frame goes back to its first) until File ▸ New
  h.until(() => m.film === "flip.move", "the title after the intro");
  h.frame(600);
  ok(`the intro chained to the title at tick ${m.ticks}`);
  // a click on the title: File ▸ New
  h.input.click(192, 132);
  h.settle("the first view after first.move");
  if (!saw("first.mov")) fail("a new game did not play first.move");
  const b = () => g.base!;
  if (progress().level !== 2 || b().floor !== LOWER) fail(`a new game is on level ${progress().level}, not day one's lower floor`);
  if (JSON.stringify(h.pose()) !== JSON.stringify({ x: 4, y: 6, dir: 3 }) || progress().day !== 1) fail(`woke at ${JSON.stringify(h.pose())}, progress ${progress().day}`);
  ok(`woke in bed at 4,6 facing west, progress 1 (t=${m.ticks})`);

  // the panel's help button (0x4175c3): help.move, and back to navigation
  h.click(32, 0x147 + 20);
  h.settle("the help film and the view again");
  if (!saw("help.mov") || g.hud.mode !== 2) fail(`the help button: film ${saw("help.mov")}, mode ${g.hud.mode}`);
  ok("the help button plays help.move and comes back in navigation");

  // too early for bed
  h.use({ x: 4, y: 6, dir: 3 });
  if (hud() !== MSG.inappropriateBedtime) fail(`the bed before the briefing said ${hud()}`);
  ok("the bed says INAPPROPRIATE BEDTIME before the briefing");

  // a press on the floor's map (0x40dc45): the player is there at once, facing as before
  {
    const from = h.pose();
    const far = g.base!.maze.poses().filter((p) => p.dir === from.dir && Math.abs(p.x - from.x) + Math.abs(p.y - from.y) >= 6)[0];
    h.click(0x180 + far.x * 5 + 0x13, far.y * 5 + 0x67 - 12);
    h.settle("the jump on the map");
    if (JSON.stringify(h.pose()) !== JSON.stringify(far)) fail(`the map sent the player to ${JSON.stringify(h.pose())}, not ${JSON.stringify(far)}`);
    ok(`the floor's map: a press on ${far.x},${far.y} and the player is there, from ${from.x},${from.y}`);
  }

  // the lower floor's rooms
  h.use({ x: 6, y: 6, dir: 2 });
  if (hud() !== MSG.nothingInDesk) fail(`the desk said ${hud()}`);
  for (const [x, y, dir, film] of [[5, 15, 0, "info.mov"], [13, 15, 0, "food.mov"], [5, 5, 0, "cpanel.mov"]] as const) {
    h.use({ x, y, dir });
    if (!saw(film)) fail(`${x},${y} facing ${dir} did not play ${film}`);
  }
  ok("the desk, the info screen, the galley and the control panel");

  // the lower floor's crew, before the briefing: their .1 talks
  for (const [name, facing] of [["sasha", 0], ["molotov", 0]] as const) {
    const t = h.talkTo(name, facing);
    if (!t.file.endsWith(`${name}.1`)) fail(`${name} talked from ${t.file}`);
    if (t.played.length < 2) fail(`the talk with ${name} played only ${t.played.join(", ")}`);
    ok(`${name}: ${t.file}, ${t.played.length} lines (${t.played.join(", ")})`);
  }
  const guardFacing = (() => {
    const gd = b().crew.find((c) => c.name === "guard")!;
    const ox = gd.home.x % 420;
    const oy = gd.home.y % 420;
    return ox > 210 ? 2 : ox < 210 ? 3 : oy > 210 ? 1 : 0;
  })();
  const guard = h.talkTo("guard", guardFacing);
  if (!guard.file.endsWith("guard.1")) fail(`the guard talked from ${guard.file}`);
  ok(`the guard: ${guard.file}, ${guard.played.length} lines`);

  // the briefing, at the transporter end of the lower floor
  const brief = posesWith(h, 0xfe, (p) => p.y >= 18)[0];
  h.use(brief);
  if (!saw("day1/brief.mov")) fail("the transporter end did not play the briefing");
  if (progress().day !== 4) fail(`after day one's briefing the progress is ${progress().day}, not 4`);
  ok(`the briefing at ${brief.x},${brief.y}: progress 4`);
  h.use(brief);
  if (hud() !== MSG.briefingOver) fail("a second briefing was not BRIEFING OVER");
  ok("and a second time, BRIEFING OVER");

  // the talks after it are the .3 ones
  const sasha3 = h.talkTo("sasha", 0);
  if (!sasha3.file.endsWith("sasha.3")) fail(`Sasha after the briefing talked from ${sasha3.file}`);
  ok(`sasha after the briefing: ${sasha3.file}`);

  // up the elevator
  h.use({ x: 3, y: 11, dir: 3 });
  if (progress().level !== 1 || b().floor !== UPPER) fail(`the elevator went to level ${progress().level}`);
  if (!saw("lowerin.mov") || !saw("upperout.mov")) fail("the elevator's films did not play");
  ok(`up the elevator: level 1, at ${JSON.stringify(h.pose())}`);

  // the upper floor's things
  const upper = [
    [3, "reactor.mov", -1], [0x19, null, MSG.transformer], [5, null, MSG.nothingInDesk],
    [0x18, null, MSG.noUnauthorizedAccess], [0x1a, null, MSG.hydroponics], [6, null, MSG.privateBed],
  ] as const;
  // a crew member standing in the cell would take the click
  const free = (p: { x: number; y: number }): boolean => !b().crew.some((c) => c.home.cellX === p.x && c.home.cellY === p.y);
  for (const [byte, film, msg] of upper) {
    const at = posesWith(h, byte, free)[0];
    if (!at) fail(`the upper floor has no ${byte} clear of the crew`);
    h.use(at);
    if (film && !saw(film)) fail(`${byte} at ${at.x},${at.y} did not play ${film}`);
    if (msg >= 0 && hud() !== msg) fail(`${byte} at ${at.x},${at.y} said ${hud()}, not ${msg}`);
    ok(`upper ${byte} at ${at.x},${at.y},${at.dir}: ${film ?? `HUD ${hud()}`}`);
  }
  for (const at of posesWith(h, 9)) {
    const film = ["scope.mov", null, "ghouse.mov", "pwrstat.mov"][at.dir];
    h.use(at);
    if (film && !saw(film)) fail(`9 at ${at.x},${at.y} facing ${at.dir} did not play ${film}`);
  }
  ok("the scope, the greenhouse and the power status");

  // the upper floor's crew
  for (const name of ["raife", "mccallum", "heisenstein", "guard"]) {
    const f = b().crew.find((c) => c.name === name);
    if (!f) fail(`${name} is not on the upper floor`);
    const ox = f.home.x % 420;
    const oy = f.home.y % 420;
    const facing = ox > 210 ? 2 : ox < 210 ? 3 : oy > 210 ? 1 : 0;
    const t = h.talkTo(name, facing);
    if (!t.file.includes(`${name.slice(0, 8)}.`)) fail(`${name} talked from ${t.file}`);
    ok(`${name} at ${f.home.cellX},${f.home.cellY}: ${t.file}, ${t.played.length} lines`);
  }

  // the lockers: the suit and the gun on, then the guard will not let the player north
  const suit = posesWith(h, 8)[0];
  const gun = posesWith(h, 4)[0];
  h.use(suit);
  h.use(gun);
  if (!progress().suit || !progress().weapon) fail("the lockers did not hand out the suit and the gun");
  ok(`the suit (${suit.x},${suit.y}) and the gun (${gun.x},${gun.y}) taken`);
  // the transporter on day one: the guard's line 6, armed or not
  h.use(posesWith(h, 0xfe, (p) => p.y >= 18)[0]);
  if (!h.logs.some((l) => l.startsWith("talk ") && l.includes("guard.6"))) fail("the transporter on day one did not have the guard say line 6");
  ok("the transporter on day one: guard.6");
  h.use(suit);
  h.use(gun);
  if (progress().suit || progress().weapon) fail("the lockers did not take the suit and the gun back");
  ok("and both put back");

  // down again, and to bed
  h.use(posesWith(h, 2)[0]);
  if (progress().level !== 2) fail(`the elevator down went to level ${progress().level}`);
  h.use({ x: 4, y: 6, dir: 3 });
  if (!saw("sleep.mov")) fail("the bed did not play sleep.move");
  h.settle("day two's first view");
  if (progress().level !== 6 || b().day !== 2 || progress().day !== 1) fail(`after sleeping: level ${progress().level}, day ${b().day}, progress ${progress().day}`);
  ok(`slept: day two's lower floor, awake at ${JSON.stringify(h.pose())} (t=${m.ticks}, ${(m.ticks / 3600).toFixed(1)} game minutes)`);


}
