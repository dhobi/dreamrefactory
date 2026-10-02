/**
 * Who is drawn in front of whom — `enemyPasses` and `enemyLayer` in `src/game.ts`.
 *
 *   npm test -w skullcracker -- passes
 *
 * Every level's draw function calls its creature classes' collectors in a
 * fixed order, the player among them, and some collectors run twice with a
 * layer argument: a thing whose layer word matches the argument is drawn on
 * that pass. `ENEMY_PASSES` carries the table with each level's addresses; on
 * STREETS (`0x44dc10`) it reads
 *
 *     0x44df10(0) 0x44fd10 0x44e480 0x44f2d0 | player | 0x44df10(1) 0x44fa30
 *
 * so a rat still in its hole (`AI+4` clear) is behind the mailbox and the
 * werewolves, one out of it (`0x44e137` sets the word) is in front of the
 * player, and the hydrant is always last. The page draws `before`, then the
 * player, then `after`; no node suite draws, so what the page is handed is
 * asserted here, on the level as it stands up.
 */
import { test } from "vitest";
import { ENEMY_PASSES, enemyLayer } from "../../src/game";
import type { Enemy } from "../../src/brains/kit";
import { fail, headless, ok, pass, haveRip } from "./harness";

test.skipIf(!haveRip())("passes", async () => {
  // 1. the four layer words, each the class's own (`enemyLayer`'s comment has
  //    the addresses): a rat or a dog's AI+4, a skeleton until its corpse
  //    state, an arm until it breaks out of the wall
  {
    const e = (kind: string, over: Partial<Enemy>) => ({ kind, state: "gait", decisions: 0, shove: 0, ...over }) as Enemy;
    const words = [
      enemyLayer(e("initrat", { decisions: 0 })),
      enemyLayer(e("initrat", { decisions: 3 })),
      enemyLayer(e("initdog", { decisions: 1 })),
      enemyLayer(e("initskel", {})),
      enemyLayer(e("initskel", { state: "dead" })),
      enemyLayer(e("initarm", { shove: 0 })),
      enemyLayer(e("initarm", { shove: 2 })),
      enemyLayer(e("initwerea", { decisions: 1 })),
    ].join("");
    if (words !== "01110010") fail(`the layer words should read 01110010 (rat in/out, dog out, skeleton up/down, arm in/out, a werewolf none); got ${words}`);
    ok(`the layer words: a rat or dog out of its hole, a standing skeleton and an arm out of the wall are layer 1`);
  }

  const h = await headless("level=1");
  const { game } = h;
  h.frame(2);
  const list = ENEMY_PASSES.STREETS;
  const split = list.indexOf("player");
  const slot = (e: Enemy) =>
    list.findIndex((q) => q !== "player" && (typeof q === "string" ? q === e.kind : q[0] === e.kind && q[1] === enemyLayer(e)));

  // 2. everything in the room is drawn exactly once, on one side of the player
  const here = game.spawnedHere();
  const { before, after } = game.enemyPasses();
  if (before.length + after.length !== here.length || here.some((e) => !before.includes(e) && !after.includes(e)))
    fail(`every spawned thing is drawn once: ${here.length} here, ${before.length} before and ${after.length} after`);
  const kinds = new Set(here.map((e) => e.kind));
  for (const k of ["initwerea", "initrat", "inithydrant"]) if (!kinds.has(k)) fail(`STREETS' first room should hold an ${k}; it holds ${[...kinds].join(" ")}`);

  // 3. ...in the level's own order, and the hydrant after the player
  const order = (xs: Enemy[]) => xs.map(slot);
  const sorted = (xs: number[]) => xs.every((v, i) => i === 0 || xs[i - 1] <= v);
  if (!sorted(order(before)) || !sorted(order(after))) fail(`each side keeps 0x44dc10's order: ${order(before)} | ${order(after)}`);
  if (before.some((e) => slot(e) > split) || after.some((e) => slot(e) < split)) fail(`a thing is drawn on the wrong side of the player`);
  if (!after.some((e) => e.kind === "inithydrant") || before.some((e) => e.kind === "inithydrant"))
    fail(`0x44fa30, the hydrant, is drawn after the player`);
  if (after.some((e) => e.kind === "initwerea") || !before.some((e) => e.kind === "initwerea"))
    fail(`0x44e480, the werewolf, is drawn before the player`);
  ok(`STREETS draws ${before.length} before the player and ${after.length} after, in 0x44dc10's order`);

  // 4. a rat changes sides as its word changes: behind everything in its hole,
  //    in front of the player once out of it
  const rat = here.find((e) => e.kind === "initrat")!;
  const was = rat.decisions;
  rat.decisions = 0;
  const hidden = game.enemyPasses();
  rat.decisions = 1;
  const out = game.enemyPasses();
  rat.decisions = was;
  if (hidden.before[0] !== rat && !hidden.before.slice(0, hidden.before.indexOf(rat)).every((e) => e.kind === "initrat"))
    fail(`a rat in its hole is drawn first, 0x44df10(0)`);
  if (!out.after.includes(rat) || out.after.indexOf(rat) > out.after.findIndex((e) => e.kind === "inithydrant"))
    fail(`a rat out of its hole is drawn after the player and before the hydrant, 0x44df10(1)`);
  ok(`a rat is drawn behind everything in its hole and in front of the player out of it`);

  pass(`the page is handed each level's draw order`);
});
