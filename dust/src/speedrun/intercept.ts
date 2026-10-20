/**
 * Stand still and click somebody on the first tick the click would reach them.
 *
 * `meet` is for a route that does not know where they are: it walks to the cell
 * they stand in and chases them when they move on, which is what an unseeded
 * run has to do. A SEEDED run knows. Its dice are the same every time, so where
 * a character walks and when is part of the sheet, and the fastest way to talk
 * to them is to go and stand where they will pass (`goto`) and then this: no
 * walking, no chasing, only the wait for them to come into reach.
 *
 * "Into reach" is the gang cast's own test, and it is two tests
 * (GANG.CST/0343 `mousedown`, GANG.CST/0001 `walktopuppet`):
 *
 *   - `realdist (me) < hotdist ()`: `calcdist` of their position and the
 *     player's, against 384 in the town, the jail, the hotel lobby and the
 *     saloon and 512 anywhere else (GANG.CST/0001 `hotdist`);
 *   - and `walktopuppet` then goes on only if the two of you share a ROW or a
 *     COLUMN of whole cells (`playerxyz (1) / 256 - actorxyz (who, 1) / 256`,
 *     and the same for 2).
 *
 * Both are asked here rather than found out by clicking, because a click inside
 * `hotdist` and off the row and column is not free: `mousedown` still tips the
 * hat and counts the visit (`actorvalue`). Under a sheet's clock the hold stops
 * the game on the very tick the test comes true, so the click lands on the
 * earliest tick it can, and the time it costs is the time they took to come.
 *
 * Only for the gang cast — the characters whose `mousedown` is that one. The
 * help character and the props have rules of their own.
 */
import type { Action } from "@dreamfactory/speedrun/action";

/** a click on `who` would open them, by GANG.CST's own test, and they are drawn */
const REACHABLE = (who: string): string => `(() => {
  const s = window.dbg.session, i = s.interp, b = (n, a) => i.builtins.get(n)(i, a);
  const a = s.actorRuntime.actors.get(${JSON.stringify(who)});
  if (!a || !a.visible || a.setName !== s.actorRuntime.currentSet) return false;
  const cam = s.activeCamera();
  if (!cam || !s.actorRuntime.onScreen(a, cam)) return false;
  const cell = (v) => Math.floor(Number(v) / 256);
  const sameRow = cell(b("playerxyz", [2])) === cell(b("actorxyz", [${JSON.stringify(who)}, 2]));
  const sameCol = cell(b("playerxyz", [1])) === cell(b("actorxyz", [${JSON.stringify(who)}, 1]));
  if (!sameRow && !sameCol) return false;
  const set = String(s.actorRuntime.currentSet || "").toLowerCase();
  const hot = ["town", "jail", "hotlower", "sallower"].includes(set) ? 384 : 512;
  return Number(b("calcdist", [b("actorxyz", [${JSON.stringify(who)}, 4]), b("playerxyz", [4])])) < hot;
})()`;

export const INTERCEPT: Action = {
  args: [1, 1],
  once: true,
  wait: "none",
  sig: "intercept(mwife)",
  help:
    "stay where you stand and click somebody of the gang cast on the first tick the click reaches them " +
    "(their row or column, inside hotdist) — after a goto to where a seeded run knows they will pass",
  run: async (c) => {
    const who = c.step.args[0].toLowerCase();
    // as long as they take to come round, unless the line says how long
    const budget = c.step.opts.budget === undefined ? Math.max(c.budget, 120_000) : c.budget;
    for (let tries = 0; tries < 20; tries++) {
      await c.d.hold(REACHABLE(who), `${who} to come into reach`, budget);
      const at = await c.d.aim("thing", who);
      if (!at) {
        // in reach and on screen, and the hit test cannot find a pixel of them:
        // half-hidden behind something for a tick. The next one, then
        await c.d.sleep(50);
        continue;
      }
      // where they are drawn on THIS tick — not `clickThing`, which first waits
      // for a walker to stop, and they are walking towards us
      await c.d.clickAt(at.x, at.y, "none", budget);
      await c.d.hold(`!!window.dbg.session.puppet`, `${who}'s conversation to open`, budget);
      const late = tries ? ` after ${tries} tick(s) out of sight` : "";
      c.say(`${who} reached${late}`);
      return;
    }
    throw new Error(`${who} came into reach and was never on screen to click`);
  },
};
