/**
 * Dust's speedrun workbench — this page's entry point.
 *
 * The workbench is the speedrun workspace's (`speedrun/src/workbench.ts`) and so
 * is every verb it can run today (`./speedrun/actions.ts` says why there are no
 * Dust ones yet), which is what makes this file four lines of substance.
 *
 * ## What this game does not tell it
 *
 * No `warmup` and no `fixtureSheet`, and both absences are the truth rather than
 * a stub:
 *
 *   - **No Warm button.** Titanic's warms one edition of six out of a 1.2 GB
 *     tree because a route re-run fifty times is otherwise timed against the
 *     download. Dust is one volume and a boot touches fourteen files of it, so
 *     there is nothing to choose and little to prefetch; when a route exists and
 *     the download is what it is fighting, the list goes here.
 *   - ~~**No sheet to copy.**~~ There is one now — `tests/speedrun/run.sheet.txt`,
 *     published beside this page by the shared speedrun plugin
 *     (speedrun/vite.ts) exactly as Titanic's is, so the panel offers
 *     "copy the full run" here too: cold boot to the credits in one sequence,
 *     planned from the story's gates (docs/dust/README.md, "The speedrun").
 */
import { startWorkbench } from "@dreamfactory/speedrun/workbench";
import { siteUrl } from "@dreamfactory/chrome/site";
import type { SpineVar } from "@dreamfactory/engine/web/debug-panel";
import { ACTIONS } from "./actions";

/**
 * The two variables worth naming before the rest.
 *
 * Titanic's six come from a readout the original game itself carries; Dust has
 * no such dialog to read the answer off, so these are the two its own suites
 * reach for when they need to put the game in a known state — `day`, which
 * decides which targets the shooting range sets out (dust/tests/targets.ts: day
 * 2 and 3 add the pig and the chicken), and `clock`, which the house's props
 * read (dust/tests/props.ts).
 *
 * A short list on purpose. A spine is what a reader wants before anything else,
 * and a guess at that is worse than the full table underneath it — which is
 * always there. When a Dust route exists, what it waits on is what belongs here.
 */
const SPINE: readonly SpineVar[] = [
  { name: "day", label: "Day" },
  { name: "clock", label: "Clock" },
];

startWorkbench({
  // Its own key space, and this is the whole reason the namespace exists: the
  // deployed site serves every game from one origin, so `dust:speedrun:save:…`
  // is what keeps a Dust checkpoint out of Titanic's workbench — where the
  // engine would happily load it and then find itself in a room this disc
  // does not have.
  game: "dust",
  actions: ACTIONS,
  details: { spine: SPINE },
  /**
   * The repository's own route, published beside this page by the speedrun
   * plugin (speedrun/vite.ts) — middleware in dev, an emitted asset in a build, at
   * the same path either way.
   *
   * Resolved HERE, through `siteUrl`, and handed over whole: where a page sits in
   * the deployed tree is `site/`'s question and the engine may not ask it
   * (site/tests/layering.ts). Written "/speedrun/…" it would ask the host's root
   * rather than this game's, so it would work in dev and fetch nothing once
   * deployed under a subdirectory.
   */
  fixtureSheet: siteUrl("speedrun/run.sheet.txt"),
  /** the contributed sheets (dust/speedrun/sheets/), resolved the same way */
  contributedSheets: siteUrl("speedrun/sheets.json"),
});
