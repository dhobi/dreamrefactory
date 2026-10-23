/**
 * The base's corners the days' routes walk past (LUNICUS.EXE 0x40cbd2,
 * 0x40d77d, 0x40dc45, 0x40cd18, 0x401299, 0x40103e, 0x401714, 0x40df7f),
 * each from a save opened straight onto its floor (the first drawn, the panel
 * and its map painted as the page paints them):
 *
 *   - a level opened by the far elevator puts the player at its door, 15,11 facing west
 *   - a click right of the view's walk on a thing turns right; one left or right of
 *     the walk in a corridor turns that way; the panel's weapon buttons are nothing
 *   - a key that is no step is nothing
 *   - the far elevators set the elevator word to 1, both floors; the lower one's
 *     bottom button on a day that is not five goes to the engines and back
 *   - armed on the upper floor the map will not jump into the guarded north, but
 *     will elsewhere; a press on a wall jumps to the cell beside it
 *   - armed, a step north at the guards' line, or a click on a guard post, is the guard's line 7
 *   - the scope's and the greenhouse's films score nothing; the power station's charges
 *     once a visit, and the reactor after it scores nothing more
 *   - left standing among the machinery, the upper floor hums now and then
 *
 *   npm test -w lunicus -- base-edges
 */
import { test } from "vitest";
import { writeSaveV0 } from "@dreamfactory/engine/df/savegame-v0";
import { BUTTON_LEFT, BUTTON_TOP, LOWER, UPPER } from "../../src/game/data";
import { drawnAt } from "../../src/game/crew";
import { fail, headless, haveRip, ok, pass, posesWith, type Headless } from "./harness";

/** a game opened from the title at `level`, progress `day` */
function opened(level: number, day: number, elevator = 0, opts: Parameters<typeof headless>[0] = {}): Headless {
  const h = headless(opts);
  const g = h.game;
  h.until(() => g.titleUp, "the title");
  g.openGame(
    writeSaveV0({ difficulty: 2, level, came: 1, elevator, progress: day, score: 1000, enemies: 0, energy: 10000, shields: 0, bullets: 0, grenades: 0, rockets: 0 }),
  );
  h.settle(`level ${level} opened`);
  if (g.progress.level !== level) fail(`opened on level ${g.progress.level}, not ${level}`);
  return h;
}

const id = (p: { x: number; y: number; dir: number }): string => `${p.x},${p.y},${p.dir}`;

test.skipIf(!haveRip())("base-edges", async () => {
  /* ---- day 2's upper floor, by the far elevator ---- */
  {
    const played: number[] = [];
    const h = opened(5, 1, 1, { draws: true, speaker: { play: (s) => void played.push(s.length), stop: () => {}, loop: () => {} } });
    const g = h.game;
    const b = g.base!;
    if (b.floor !== UPPER || id(h.pose()) !== "15,11,3") fail(`the far elevator opened at ${id(h.pose())}`);
    ok("opened by the far elevator: 15,11 facing west");

    // the elevator's own cell: right of the walk turns right, inside it is the elevator
    h.click(370, 100);
    h.settle("the turn");
    if (h.pose().dir !== 0) fail(`a click right of the walk on the elevator turned to ${h.pose().dir}`);
    // the panel's weapon buttons are the city's
    h.click(BUTTON_LEFT[4] + 10, BUTTON_TOP + 10);
    h.settle("nothing");
    // a key that is no step
    h.key("Enter");
    h.key("ArrowDown");
    h.settle("nothing");
    if (id(h.pose()) !== "15,11,0") fail(`a weapon button, Enter or the down arrow moved the player to ${id(h.pose())}`);
    ok("a click right of the walk turns right; the weapon buttons, Enter and the down arrow do nothing");

    // a corridor: clicks left and right of the walk turn, not step
    const corridor = b.maze.poses().find((p) => b.maze.byte(p) === 0 && !b.crew.some((c) => c.home.cellX === p.x && c.home.cellY === p.y))!;
    h.walkTo(corridor);
    h.click(10, 100);
    h.settle("a left turn");
    if (h.pose().x !== corridor.x || h.pose().y !== corridor.y || h.pose().dir === corridor.dir) fail(`a click left of the walk at ${id(corridor)} went to ${id(h.pose())}`);
    const turned = h.pose().dir;
    h.click(375, 100);
    h.settle("a right turn");
    if (h.pose().dir !== corridor.dir) fail(`left then right at ${id(corridor)} faces ${h.pose().dir}, from ${turned}`);
    // a deep click with a key waiting: one step, then the key's own
    {
      const from = h.pose();
      h.click(192, 200);
      h.key("ArrowDown");
      h.settle("one step");
      const steps = Math.abs(h.pose().x - from.x) + Math.abs(h.pose().y - from.y);
      if (steps > 1) fail(`a deep click with a key waiting walked ${steps} cells from ${id(from)}`);
    }
    ok(`in a corridor (${id(corridor)}) clicks left and right of the walk turn that way; a deep click with a key waiting stops after a step`);

    // the scope first: no score; then the greenhouse: the power rooms' score, once
    const score0 = g.hud.score;
    const nine = (dir: number) => posesWith(h, 9).find((p) => p.dir === dir)!;
    h.use(nine(0));
    if (g.hud.score !== score0) fail(`the scope scored ${g.hud.score - score0}`);
    h.use(nine(2));
    if (g.hud.score !== score0) fail(`the greenhouse scored ${g.hud.score - score0}`);
    h.use(nine(3));
    const charged = g.hud.score - score0;
    if (charged !== 0x32 * 0x14) fail(`the power station scored ${charged}, not ${0x32 * 0x14}`);
    h.use(posesWith(h, 3)[0]);
    if (g.hud.score !== score0 + charged) fail("the reactor scored again in the same visit");
    ok(`the scope and the greenhouse score nothing, the power station ${charged} and the reactor after it nothing more`);

    // standing among the machinery: the hum, one time in a hundred a frame
    const machinery = b.maze.poses().find((p) => p.x >= 7 && p.x <= 0xb && p.y >= 7 && p.y <= 0xb && !b.crew.some((c) => c.home.cellX === p.x && c.home.cellY === p.y));
    if (!machinery) fail("no pose among the machinery");
    h.walkTo(machinery);
    const n0 = played.length;
    h.frame(3000);
    const among = played.length - n0;
    const north = b.maze.poses().find((p) => p.y < 3 && !b.crew.some((c) => c.home.cellX === p.x && c.home.cellY === p.y));
    if (!north) fail("no pose in the north rooms");
    h.walkTo(north);
    const n1 = played.length;
    h.frame(3000);
    if (!among || played.length === n1) fail(`the hum: ${among} among the machinery, ${played.length - n1} in the north`);
    ok(`left standing, the upper floor hums: ${among} times among the machinery, ${played.length - n1} in the north rooms`);

    // the far elevator down: the elevator word 1
    const far = posesWith(h, 2).find((p) => p.dir !== 3)!;
    h.use(far);
    if (g.progress.level !== 6 || g.progress.elevator !== 1) fail(`the far elevator down: level ${g.progress.level}, elevator ${g.progress.elevator}`);
    if (id(h.pose()) !== "15,11,3") fail(`down the far elevator at ${id(h.pose())}`);
    ok(`down the far elevator (${id(far)}): level 6 at 15,11, the elevator word 1`);

    // the lower floor's far elevator: the word 1 again; its bottom button on day 2, to the engines and back
    h.press(1);
    const lowerFar = posesWith(h, 2).find((p) => p.dir !== 3)!;
    h.use(lowerFar);
    if (g.progress.level !== 6 || g.base!.floor !== LOWER || g.progress.elevator !== 1) fail(`the bottom button on day 2: level ${g.progress.level}, elevator ${g.progress.elevator}`);
    if (!h.logs.some((l) => l.startsWith("▶ ") && l.includes("enginbac"))) fail("the bottom button on day 2 did not play enginback.move");
    ok("the lower floor's far elevator, bottom button on day 2: to the engines and back to the same floor");
  }

  /* ---- day 2's upper floor, armed: the guards ---- */
  {
    const h = opened(5, 3);
    const g = h.game;
    const b = g.base!;
    if (!g.progress.suit || !g.progress.weapon || id(h.pose()) !== "9,20,2") fail(`progress 3 on the upper floor: ${id(h.pose())}, suit ${g.progress.suit}`);
    // the map: not into the guarded north
    const from = h.pose();
    const mapAt = (x: number, y: number): void => h.click(0x180 + x * 5 + 0x13 + 2, y * 5 + 0x67 + 2);
    const northern = b.maze.poses().find((p) => p.dir === from.dir && p.y <= 0xe)!;
    mapAt(northern.x, northern.y);
    h.settle("no jump");
    if (id(h.pose()) !== id(from)) fail(`armed, the map jumped north to ${id(h.pose())}`);
    // a cell with no view facing east, whose neighbour has one: the jump goes beside it
    const has = new Set(b.maze.poses().filter((p) => p.dir === from.dir).map((p) => `${p.x},${p.y}`));
    let wall: { x: number; y: number } | null = null;
    for (let y = 0x10; y < 0x16 && !wall; y++)
      for (let x = 1; x < 0x14 && !wall; x++) if (!has.has(`${x},${y}`) && (has.has(`${x - 1},${y}`) || has.has(`${x + 1},${y}`))) wall = { x, y };
    if (!wall) fail("no wall cell beside a view on the south of the upper floor");
    mapAt(wall.x, wall.y);
    h.settle("the jump beside the wall");
    if (h.pose().y !== wall.y || Math.abs(h.pose().x - wall.x) !== 1) fail(`a press on the wall at ${wall.x},${wall.y} went to ${id(h.pose())}`);
    ok(`armed: the map will not jump north to ${northern.x},${northern.y}; a press on the wall at ${wall.x},${wall.y} lands beside it`);

    // a guard post, clicked
    const talks = (): number => h.logs.filter((l) => l.startsWith("talk ") && l.includes("guard.7")).length;
    const post = b.maze.poses().find((p) => p.x === 7 && p.y === 0xe);
    if (post) {
      h.walkTo({ x: 7, y: 0xf, dir: 0 });
      const before = talks();
      // a step north onto the guards' line is allowed; from it, the next is not
      h.key("ArrowUp");
      h.settle("onto the line");
      if (h.pose().y !== 0xe) fail(`armed, a step north from 7,15 went to ${id(h.pose())}`);
      h.key("ArrowUp");
      h.settle("the guard");
      if (talks() <= before || h.pose().y !== 0xe) fail(`armed, a step north at the line: ${talks() - before} talks, at ${id(h.pose())}`);
      ok("armed, the step onto the guards' line is allowed, the next north is the guard's line 7");
      // the post in the cell, clicked
      const stepped0 = talks();
      const guard = b.crew.find((c) => c.name === "guard")!;
      const at = { angle: 0x40, x: 7 * 0x1a4 + 0xd2, y: 0xe * 0x1a4 + 0x7e, z: 0x78, cellX: 7, cellY: 0xe };
      const d = drawnAt({ ...guard, name: "post", at, home: at, target: at, state: 0 }, b.cam, b.maze.has);
      if (d) {
        const [t, l, bt, r] = d.rect;
        h.click(Math.trunc((Math.max(l, d.clip[1]) + Math.min(r, d.clip[3])) / 2), Math.trunc((Math.max(t, d.clip[0]) + Math.min(bt, d.clip[2])) / 2));
        const stepped = stepped0;
        h.settle("the post's guard");
        if (talks() <= stepped) fail("a click on the guard post was not the guard's line 7");
        ok("armed, a click on the guard post in the cell is the guard's line 7");
      }
    }
  }
  /* ---- day 2's upper floor after the briefing: the guard by the transporter ---- */
  {
    const h = opened(5, 2);
    const g = h.game;
    const b = g.base!;
    const guardTalks = (): string[] => h.logs.filter((l) => l.startsWith("talk ") && l.includes("guard."));
    const facing = (): number => {
      const gd = b.crew.find((c) => c.name === "guard")!;
      const ox = gd.home.x % 420;
      const oy = gd.home.y % 420;
      if (ox !== 210) return ox > 210 ? 2 : 3;
      return oy > 210 ? 1 : 0;
    };
    // unarmed, the transporter is the guard's line 5
    h.use(posesWith(h, 0xfe, (p) => p.y >= 18)[0]);
    if (!guardTalks().some((l) => l.includes("guard.5"))) fail(`unarmed at the transporter on day 2: ${guardTalks().join(" | ")}`);
    ok("unarmed, the transporter on day 2 is the guard's line 5");
    // walked up to by the guard down there: 5 unarmed, 4 armed
    const gd = b.crew.find((c) => c.name === "guard")!;
    if (gd.home.cellY >= 0x13) {
      const n = guardTalks().length;
      h.talkTo("guard", facing());
      const said = guardTalks().slice(n).join(" | ");
      if (!said.includes("guard.5")) fail(`the guard walked up to an unarmed player and said ${said}`);
      h.use(posesWith(h, 8)[0]);
      h.use(posesWith(h, 4)[0]);
      const k = guardTalks().length;
      h.talkTo("guard", facing());
      const armed = guardTalks().slice(k).join(" | ");
      if (!armed.includes("guard.4")) fail(`the guard walked up to an armed player and said ${armed}`);
      ok("the guard, walked up by the transporter on day 2: line 5 unarmed, line 4 suited and armed");
    }
  }
  pass("base-edges");
});
