/**
 * The planner escape hatch, Playwright side.
 *
 * `travel`, `hunt` and `stand` run the real {@link Navigator} — which needs the
 * full browser NavDriver: a state mirror, `.SET` files parsed off disk, and aim
 * sweeps over the whole screen. That is everything a speedrun is trying not to
 * pay for, and none of it exists in a page, which is why this lives here and is
 * INSTALLED into the action table rather than imported by it.
 *
 * It is here to be replaced. The gestures it makes are recorded and printed as
 * sheet lines, so the next edit of the sheet can be literal and the line can go.
 * The gestures are captured by PROXYING the driver rather than by scraping its
 * log, because a log line is prose and a sheet line has to be exact.
 */
import type { Page } from "playwright";
import { ACTIONS, type PlannerFn } from "../../src/speedrun/actions";

export const playwrightPlanner: PlannerFn = async (c, method, target) => {
  const page = c.d.page as Page | undefined;
  if (!page) throw new Error(`${method} needs a Playwright page`);
  const { browserDriver } = await import("../browser/driver");
  const { Navigator } = await import("../playthrough/nav/navigator");
  const lines: string[] = [];
  const nd = await browserDriver(page, { log: () => {} });
  const spy = new Proxy(nd, {
    get(t, prop: string, recv) {
      const v = Reflect.get(t, prop, recv);
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        if (prop === "turn") lines.push(args[0] === 0 ? "right" : "left");
        else if (prop === "pressUp") lines.push("up");
        else if (prop === "pressSpace") lines.push("space");
        else if (prop === "typeKey") lines.push(`key ${String(args[0])}`);
        else if (prop === "clickThing") lines.push(`click ${String(args[0])}`);
        else if (prop === "clickHotspot") lines.push(`clickSpot ${String(args[0])}`);
        else if (prop === "clickAt") lines.push(`clickAt ${args[0]} ${args[1]}`);
        return (v as (...a: unknown[]) => unknown).apply(t, args);
      };
    },
  });
  const nav = new Navigator(spy);
  const go = () =>
    method === "travel" ? nav.travel(target)
    : method === "hunt" ? nav.hunt(target)
    : nav.faceStandpoint([target]);

  /**
   * SOMEBODY STOPPING YOU IS NOT A FAILED WALK — it is a walk with a person in
   * it, and this is the difference between the route's needs and the
   * navigator's.
   *
   * The Navigator refuses outright while a puppet is up ("answer it first") and
   * is right to: `SetViewer.busy` is true, `turn()` and `walk()` would grind
   * their whole budget against a conversation, and a route that is reading the
   * story wants to know it was interrupted. A SPEEDRUN does not — a steward on
   * a staircase is weather. Measured on the way down to the turbine room:
   * `gave up reaching view28 in stair2c (at scene5/view2, conversing) · talking
   * to csea2.pup`, four decks short, with nothing wrong but a greeting.
   *
   * So: ESC out and carry on from wherever the walk had got to. ESC at a
   * PLAQUE answers -1 and ends the conversation (#131), which is the technique
   * `bailOut` exists for and the same one wanted here — whatever they were
   * going to say is not what this run came for. Two retries, because two
   * different people can stop you on one flight of stairs and a third is a
   * route problem rather than traffic.
   */
  let result = await go();
  for (let tries = 0; tries < 2 && !result.ok && /conversing|answer it first/.test(result.reason ?? ""); tries++) {
    const who = await c.d.evaluate<string>(
      `String((window.dbg.viewer && window.dbg.viewer.conversingWith) || "somebody")`,
    );
    /**
     * ANSWERED rather than escaped — `otherwise: first`, because the first plaque
     * of an interruption is the one that means "yes, fine, out of my way"
     * (csea2's is literally "Stand aside!") and a route cannot know in advance
     * who will stop it. It no-ops when there is nothing to answer.
     *
     * This is belt to the braces below, and worth being honest about which of
     * the two did the work: ESC here was ALSO fine. The reason two attempts at
     * this looked like they achieved nothing was the mirror, not the gesture —
     * the report said `said nothing`, which is this call finding no conversation
     * open because there no longer was one.
     */
    await ACTIONS.say.run({
      ...c,
      step: { ...c.step, bevels: [], opts: { ...c.step.opts, otherwise: "first", maxturns: "40" } },
      wait: "none",
    });
    /**
     * AND RESYNC THE MIRROR, which is the whole reason the first two attempts at
     * this looked like they did nothing.
     *
     * The Navigator does not read the page; it reads a MIRROR the browser driver
     * samples in one round trip (tests/browser/driver.ts), because a route's
     * questions are synchronous by design. Everything above talks to the page
     * DIRECTLY — `viewer.conversing` — so after the answer the page and the
     * mirror disagreed, and `nav.travel` refused on a sample taken before the
     * conversation was over. The tell was in the report: `said nothing`, twice.
     * The `say` had found no conversation to answer because there wasn't one any
     * more; only the mirror still thought so.
     */
    await nd.sync();
    await c.d.settle("quiet", "the interruption to finish closing", c.budget);
    c.say(`${who} stopped us on the way; bailed and carried on`);
    result = await go();
  }
  if (!result.ok) throw new Error(result.reason ?? `could not ${method} to ${target}`);

  /**
   * Where it ENDED, printed with the gestures — without which they cannot be
   * pasted back.
   *
   * A walk's arrival facing is decided by the engine, not by the key that
   * started it, and the planner re-plans from live state after every gesture. So
   * replaying its keys blind lands somewhere else: measured on `travel gym`, the
   * eight keys reach the room but stop on View31 while the planner stops
   * elsewhere, and the next `hunt` then walked out of the room looking for
   * someone who was never in reach.
   *
   * The fix is to pin the standpoint after the walk with `face <view>`, which is
   * turn-only and so exists in the page as well. That needs the view NAME, which
   * is what this adds.
   */
  const at = await page.evaluate(`(() => {
    const s = window.dbg.session, v = window.dbg.viewer;
    const view = v.scene.views[v.viewIdx];
    return String(s.currentSetFile || "").replace(/\\.set$/, "") + " " +
      v.scene.sceneName + "/" + (view ? view.viewName : "?");
  })()`);
  c.say(`${lines.length} gestures, ends at ${at}`);
  c.suggest([...lines, `face ${String(at).split("/")[1]}   # pin the arrival facing`].join("\n"));
};
