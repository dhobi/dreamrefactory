/**
 * Dust's own verbs — and today there are none.
 *
 * That is the honest state of it and worth writing down rather than leaving as
 * an empty file somebody wonders about. The whole gesture layer a route needs is
 * the engine's already ({@link CORE_ACTIONS}): the four arrows and Space, a
 * click at a named thing or a raw pixel, a held press, ESC through a film, a
 * conversation answered by bevel, the waits, and the run's own bookkeeping. All
 * of it is written against a DreamFactory session, and Dust is one — the same
 * `hittest`, the same props, the same conversation machinery, read by the same
 * engine two years earlier.
 *
 * So a Dust sheet works out of the box, and this file is where the first thing
 * that does NOT will go. Likely candidates, from what the disc actually asks of
 * a player:
 *
 *   - **the town grid.** Dust's rooms are cells of a 15x15 town and moving
 *     between them is `rowcoltoscene`/`scenebuild` rather than a door
 *     (dust/tests/scenegrid.ts). Titanic's `mapjump` has no counterpart here;
 *     what this game wants is something that says "go to the saloon".
 *   - **the shooting range**, and the gun generally: a light-gun aim, which is
 *     `combo`'s shape (a cycle of points until a condition) but wants naming.
 *   - **the saloon's card games**, whose scripts this port already runs
 *     (dust/tests/salgames.ts) and which are a plaque-and-bevel dialogue that
 *     `say` may or may not be able to hold up its end of.
 *
 * None of those is guessed at here. A verb earns its place by a route needing
 * it, and a table of verbs written before any route exists is a table that will
 * be wrong in ways nobody can see yet — which is the mistake Titanic's own
 * `travel` was invented to avoid making.
 */
import type { VerbSpec } from "@dreamfactory/engine/web/speedrun/sheet";
import { CORE_ACTIONS } from "@dreamfactory/engine/web/speedrun/actions-core";
import {
  composeActions,
  resolveIn,
  verbsOf,
  type Action,
  type ActionTable,
} from "@dreamfactory/engine/web/speedrun/action";

/** what Dust adds to the engine's vocabulary — see the header */
export const DUST_ACTIONS: ActionTable = {};

/**
 * Dust's whole vocabulary.
 *
 * Composed even though one half is empty, because that is the shape the next
 * verb goes into and because the workbench and the parser must be handed the
 * same table (`engine/src/web/speedrun/runner.ts`, `runSheet`).
 */
export const ACTIONS: ActionTable = composeActions(CORE_ACTIONS, DUST_ACTIONS);

/** the grammar half of {@link ACTIONS}, for the parser */
export const VERBS: Record<string, VerbSpec> = verbsOf(ACTIONS);

/** a verb by name, case-insensitively */
export const resolve = (verb: string): Action | undefined => resolveIn(ACTIONS, verb);
