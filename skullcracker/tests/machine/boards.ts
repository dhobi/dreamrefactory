/**
 * A death puts the boards back — every plank and every rope bridge, whole and
 * where its creator put it.
 *
 *   npx tsx tools/runmachine.mts boards        (from skullcracker/)
 *
 * Neither prop's think ever leaves its last state: a fallen plank is kind 2,
 * which `0x4531d0` does nothing with, and a bridge that has gone keeps falling.
 * What brings them back is their CLASS pass. `0x453040` steps every plank and
 * then watches `0x402f60` (the player's script kind below 26, the dying
 * scripts'): dead, and then alive again, calls `0x453090` — every plank's
 * crossings to 0, back to the creator's point, no speed, the intact script, no
 * gravity. `0x4221e0` does the same for the bridges with `0x422230`.
 *
 * A living player moved by `zip` or the debug key was never dead, so nothing
 * comes back for them.
 */
import { fail, headless, ok, pass } from "./harness";

const h = await headless("level=2");
const { game } = h;
const p = game.p;

/** from the red to the respawn, however long the fall before it */
function dieAndReturn(what: string): void {
  if (h.until(() => game.deathRed !== null, 600) < 0) fail(`${what}: the player never died`);
  if (h.until(() => game.deathRed === null, 200) < 0) fail(`${what}: the red never ended`);
}

// 1. CITY's first plank: stand on it until it goes, fall into the void, come back
{
  h.frame(9);
  h.hold("right", true);
  h.until(() => p.x >= 1180, 400);
  h.hold("right", false);
  const board = game.planksHere().find((k) => k.x === 1185);
  if (!board || !board.floor) fail(`CITY's plank at x1185, with the platform it owns, is not there`);
  const top = board.floor.top;
  // read afresh: a frame changes it behind TypeScript's narrowing
  const state = (): string => board.state;
  if (h.until(() => board.state === "fall", 80) < 0) fail(`the plank held under a player standing on it`);
  h.frame(4);
  if (board.floor.top === top) fail(`the plank fell and its platform did not go with it`);
  // `zip`'s respawn is a living player's: no plank comes back for it
  game.respawn();
  if (board.state !== "fall") fail(`a respawn without a death put the plank back (${board.state})`);
  ok(`the plank goes, its record with it, and a living player's respawn leaves it gone`);

  h.hold("right", true);
  h.until(() => p.x >= 1180, 400);
  h.hold("right", false);
  let fallenDuringRed = true;
  h.until(() => {
    if (game.deathRed && board.state !== "fall") fallenDuringRed = false;
    return game.deathRed !== null;
  }, 600);
  if (!game.deathRed) fail(`walking off where the plank was should have dropped the player into the void`);
  dieAndReturn("the void under the plank");
  if (!fallenDuringRed) fail(`the plank came back before the respawn — 0x453040 waits for the player alive again`);
  if (state() !== "intact" || board.y !== board.homeY || board.crossings !== 0 || board.gone)
    fail(`after the respawn the plank is ${state()} at y${board.y} (home y${board.homeY}), crossed ${board.crossings}${board.gone ? ", gone" : ""}`);
  if (board.floor.top !== top) fail(`the plank came back without its platform: top ${board.floor.top}, was ${top}`);
  ok(`the death puts it back whole at y${board.y} with its record at y${top} (0x453090)`);

  // and it holds a rider again
  h.hold("right", true);
  h.until(() => p.x >= 1180, 400);
  h.hold("right", false);
  h.frame(4);
  if (!p.onGround || state() === "fall") fail(`the restored plank does not carry the player (${state()}, on ground ${p.onGround})`);
  ok(`and it carries the player again`);
}

// 2. CAVERN's bridge at x7690: stood on until it is gone, then a death
{
  await h.load("level=10&x=7600&y=1100");
  const bridge = game.hereOf((l) => l.bridges).find((b) => b.x === 7690);
  if (!bridge) fail(`a bridge spans x7690`);
  const r = game.level!.rooms.indexOf(p.room!);
  const deck = game.level!.solids[r].platforms.find(
    (q) => bridge.x >= q.left && bridge.x < q.right && bridge.y >= q.top && bridge.y < q.bottom,
  );
  if (!deck) fail(`the bridge owns no platform`);
  const top = deck.top;
  if (h.until(() => bridge.state === "gone" && bridge.y > bridge.homeY + 50, 150) < 0)
    fail(`the bridge never went (${bridge.state})`);
  game.takeHealth(100000);
  dieAndReturn("CAVERN");
  if (bridge.state !== "whole" || bridge.y !== bridge.homeY || bridge.stood !== 0)
    fail(`after the respawn the bridge is ${bridge.state} at y${bridge.y} (home y${bridge.homeY}), rocked ${bridge.stood}`);
  if (deck.top !== top) fail(`the bridge came back without its platform: top ${deck.top}, was ${top}`);
  ok(`the bridge is whole again at y${bridge.y} with its deck at y${top} (0x422230)`);
}

pass(`a death restores the planks and the bridges, as their class passes do`);
