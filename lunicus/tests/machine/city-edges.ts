/**
 * The city's, the buildings' and the hive's corners the days' routes walk
 * past (LUNICUS.EXE 0x40627e, 0x4075ac, 0x406603, 0x4017f2, 0x401d33,
 * 0x40192a, 0x402243, 0x402061), each from a save opened straight onto its
 * level, drawn (`draws: true`, so the panel is painted as the page paints it):
 *
 *   - a click left or right of the walk on a thing turns that way; one right of
 *     the walk in a street turns right; a click deep in the street with another
 *     waiting stops after the first step
 *   - the weapon buttons press only a weapon with ammo; with the node out the
 *     ENEMIES bar blinks
 *   - the down arrow, which is no action, is nothing; the space bar with no rockets fires nothing
 *   - a building's locked door (byte 15 or more) says so and keeps the player out
 *   - a building's elevator up from the top floor jams (FLOOR LOCKED) and stays; its
 *     bottom button goes a floor down
 *   - an engine room's elevator up is locked too
 *   - a building's other things say what they are
 *   - the hive's disc and star films, and its empty cabinet; the final chamber's elevator goes nowhere; the
 *     queen with the ENEMIES bar not empty says so
 *
 *   npm test -w lunicus -- city-edges
 */
import { test } from "vitest";
import { writeSaveV0 } from "@dreamfactory/engine/df/savegame-v0";
import type { Pose } from "../../src/game/maze";
import { BAR_ENEMIES, BUTTON_LEFT, BUTTON_TOP } from "../../src/game/data";
import { SCREEN_W } from "@dreamfactory/engine/v0/screen";
import { CityBot } from "./city-bot";
import { fail, headless, haveRip, ok, pass, type Headless } from "./harness";

const id = (p: Pose): string => `${p.x},${p.y},${p.dir}`;

/** a game opened on city level `level`, on floor `came`, with what the HUD has */
function opened(level: number, came = 1, hud: { enemies?: number; rockets?: number } = {}): { h: Headless; bot: CityBot } {
  const h = headless({ draws: true });
  const g = h.game;
  h.until(() => g.titleUp, "the title");
  g.openGame(
    writeSaveV0({
      difficulty: 2, level, came, elevator: 0, progress: 0, score: 0, enemies: hud.enemies ?? 100,
      energy: 10000, shields: 10000, bullets: 10000, grenades: 10000, rockets: hud.rockets ?? 10000,
    }),
  );
  h.settle(`level ${level}`);
  if (g.phase !== "city" || g.progress.level !== level) fail(`opened on ${g.phase} level ${g.progress.level}, not city level ${level}`);
  return { h, bot: new CityBot(h) };
}

test.skipIf(!haveRip())("city-edges", async () => {
  /* ---- day 2's city ---- */
  {
    const { h, bot } = opened(7, 1, { rockets: 0 });
    const g = h.game;
    const w = () => g.city!.world;
    const pose = (): Pose => ({ ...w().pose });
    const at = (b: number): Pose[] => w().maze.poses().filter((p) => w().maze.byte(p) === b);
    // a letter that is no action, and the space bar with no rockets
    const p0 = pose();
    const ammo = g.hud.rockets;
    h.key("ArrowDown");
    h.key(" ");
    h.settle("nothing");
    if (id(pose()) !== id(p0) || g.hud.mode !== 2 || g.hud.rockets !== ammo) fail(`the down arrow and the space bar: at ${id(pose())}, mode ${g.hud.mode}`);
    ok("the down arrow, no step in Lunicus, is nothing; the space bar with no rockets fires nothing and leaves navigation");

    // the panel's weapon buttons: bullets and grenades pressed, the empty rockets not
    for (const i of [3, 4, 5]) {
      h.click(BUTTON_LEFT[i] + 20, BUTTON_TOP + 20);
      h.settle(`weapon button ${i}`);
      if (g.hud.mode !== Math.min(i, 4)) fail(`weapon button ${i}: mode ${g.hud.mode}`);
    }
    h.key("h");
    h.settle("navigation");
    ok("the weapon buttons: bullets and grenades pressed, the empty rockets not");
    // the node out: the ENEMIES bar blinks blue and black
    {
      w().radarOn = true;
      const inks = new Set<number>();
      for (let i = 0; i < 40; i++) {
        h.frame(1);
        inks.add(g.m.screen.pixels[(BAR_ENEMIES[0] + 2) * SCREEN_W + BAR_ENEMIES[1] + 2]);
      }
      w().radarOn = false;
      if (!inks.has(0x71) || !inks.has(0xff)) fail(`the node out: the ENEMIES bar drawn in ${[...inks].join(",")}`);
      ok("the node out: the ENEMIES bar blinks blue and black");
    }
    // a locked door
    bot.walkTo(at(15));
    h.key("h");
    h.click(192, 132);
    h.settle("the locked door");
    if (g.hud.message !== 0x25 || g.progress.level !== 7) fail(`a door of byte 15: message ${g.hud.message}, level ${g.progress.level}`);
    ok(`a door of byte 15 (${id(pose())}): message 0x25, still in the street`);
    // a thing ahead: left and right of the walk turn
    const thing = pose();
    h.click(10, 100);
    h.settle("a left turn");
    if (pose().dir === thing.dir || pose().x !== thing.x) fail(`a click left of the walk on a door went to ${id(pose())}`);
    h.click(370, 100);
    h.settle("a right turn");
    if (id(pose()) !== id(thing)) fail(`left then right of the walk on a door: ${id(pose())}`);
    h.click(370, 100);
    h.settle("a right turn");
    if (pose().dir === thing.dir || pose().x !== thing.x) fail(`a click right of the walk on a door went to ${id(pose())}`);
    h.click(10, 100);
    h.settle("a left turn");
    if (id(pose()) !== id(thing)) fail(`left then right of the walk on a door: ${id(pose())}`);
    ok("a click left or right of the walk on a door turns that way");

    // a street: right of the walk turns right
    const street = w().maze.poses().find((p) => !w().maze.byte(p) && w().maze.transition(p, { x: p.x + [0, 0, 1, -1][p.dir], y: p.y + [-1, 1, 0, 0][p.dir], dir: p.dir }))!;
    bot.walkTo([street]);
    h.key("h");
    const s0 = pose();
    h.click(375, 100);
    h.settle("a right turn in the street");
    if (pose().dir === s0.dir || pose().x !== s0.x || pose().y !== s0.y) fail(`right of the walk in the street went to ${id(pose())}`);
    h.click(10, 100);
    h.settle("back");
    // deep in the street, with a key waiting: one step, then the key's own
    if (id(pose()) !== id(s0)) fail(`right then left in the street: ${id(pose())}`);
    {
      h.click(192, 200);
      h.key("ArrowDown");
      h.settle("one step");
      const steps = Math.abs(pose().x - s0.x) + Math.abs(pose().y - s0.y);
      if (steps !== 1) fail(`a deep click with a key waiting walked ${steps} cells`);
      ok("in the street: right of the walk turns right; a deep click with a key waiting stops after one step");
    }
  }

  /* ---- a building's top floor ---- */
  {
    const { h, bot } = opened(8, 5);
    const g = h.game;
    const w = () => g.city!.world;
    // the building's things: their messages; 7 takes the click and says nothing
    for (const [b, msg] of [[5, 0x21], [6, 0x22], [8, 0x24], [7, -1]] as const) {
      bot.walkTo(w().maze.poses().filter((p) => w().maze.byte(p) === b));
      h.key("h");
      g.hud.message = -1;
      const bullets = g.hud.bullets;
      h.click(192, 132);
      h.settle(`the building's ${b}`);
      if (g.hud.message !== msg || g.hud.bullets !== bullets) fail(`the building's ${b}: message ${g.hud.message}, bullets ${bullets - g.hud.bullets} spent`);
    }
    ok("a building's 5, 6 and 8 say 0x21, 0x22 and 0x24; its 7 takes the click and says nothing");
    const lift = w().maze.poses().filter((p) => w().maze.byte(p) === 3);
    bot.walkTo(lift);
    h.key("h");
    h.press(0);
    h.click(192, 132);
    h.settle("up from the top floor");
    if (g.progress.came !== 5 || g.progress.level !== 8 || g.hud.message !== 0x1e) fail(`up from the top floor: floor ${g.progress.came}, message ${g.hud.message}`);
    ok("a building's elevator up from the top floor: FLOOR LOCKED, still the top floor");
    bot.walkTo(w().maze.poses().filter((p) => w().maze.byte(p) === 3));
    h.key("h");
    h.press(1);
    h.click(192, 132);
    h.settle("down a floor");
    const now = () => ({ ...g.progress });
    if (now().came !== 4 || now().level !== 8) fail(`down from the top floor: floor ${now().came}, level ${now().level}`);
    ok("its bottom button: a floor down");
  }

  /* ---- an engine room ---- */
  {
    const { h, bot } = opened(19, 1);
    const g = h.game;
    const w = () => g.city!.world;
    bot.walkTo(w().maze.poses().filter((p) => w().maze.byte(p) === 3));
    h.key("h");
    h.press(0);
    h.click(192, 132);
    h.settle("the engine room's elevator up");
    if (g.progress.level !== 19 || g.hud.message !== 0x1e) fail(`an engine room's elevator up: level ${g.progress.level}, message ${g.hud.message}`);
    ok("an engine room's elevator up: FLOOR LOCKED, the same room");
  }

  /* ---- the hive and the final chamber ---- */
  {
    const { h, bot } = opened(21, 1);
    const g = h.game;
    const w = () => g.city!.world;
    const saw = (film: string): boolean => h.logs.some((l) => l.startsWith("▶ ") && l.includes(film));
    for (const [b, film] of [[4, "disc.mov"], [6, "star.mov"]] as const) {
      bot.walkTo(w().maze.poses().filter((p) => w().maze.byte(p) === b));
      h.key("h");
      h.click(192, 132);
      h.settle(film);
      if (!saw(film)) fail(`the hive's ${b} did not play ${film}`);
    }
    // a cabinet emptied, used again: 0x12
    const cab = w().maze.poses().filter((p) => w().maze.byte(p) === 2);
    bot.walkTo(cab);
    const at = { ...w().pose };
    h.key("h");
    h.click(192, 132);
    h.settle("the cabinet");
    if (w().maze.byte(at) !== 10) fail(`the hive's cabinet emptied is ${w().maze.byte(at)}, not 10`);
    g.hud.message = -1;
    h.click(192, 132);
    h.settle("the empty cabinet");
    if (g.hud.message !== 0x12) fail(`the hive's empty cabinet said ${g.hud.message}`);
    ok("the hive: the disc and the star; a cabinet emptied is 10, and says 0x12");
  }
  {
    const { h, bot } = opened(22, 1);
    const g = h.game;
    const w = () => g.city!.world;
    bot.walkTo(w().maze.poses().filter((p) => w().maze.byte(p) === 3));
    h.key("h");
    h.click(192, 132);
    h.settle("the final chamber's elevator");
    if (g.progress.level !== 22 || g.hud.message !== 0x1e) fail(`the final chamber's elevator: level ${g.progress.level}, message ${g.hud.message}`);
    bot.walkTo(w().maze.poses().filter((p) => w().maze.byte(p) === 8));
    h.key("h");
    h.click(192, 132);
    h.settle("the queen");
    const said = (): number => g.hud.message;
    if (g.won || said() !== 0x2d) fail(`the queen with enemies left: won ${g.won}, message ${said()}`);
    ok("the final chamber: its elevator goes nowhere; the queen with the ENEMIES bar not empty says so");
  }
  pass("city-edges");
});
