/**
 * Timelapse's verbs — none of its own yet, and that is the honest state of it.
 *
 * Everything a sheet can say today is the engine's ({@link CORE_ACTIONS}): the
 * keys, a click at a raw pixel or at a named region or prop (the engine's own
 * hit test, `hitTestAt`, which needs no room), ESC through a film, the waits and
 * the run's bookkeeping. The ones that assume a ROOM — `up()`, `door()`,
 * `face()` and the rest that confirm a press by the view changing — read the
 * shared predicates' roomless answers (speedrun/src/driver.ts ROOMLESS): a
 * place here is the stage and the flat on screen.
 *
 * A verb is added when a route needs it, not before (dust/src/speedrun/actions.ts
 * says why); this game's will arrive with its route, over the top of the core
 * table in {@link ACTIONS}.
 */
import type { VerbSpec } from "@dreamfactory/speedrun/sheet";
import { CORE_ACTIONS } from "@dreamfactory/speedrun/actions-core";
import { composeActions, resolveIn, verbsOf, type Action, type ActionTable } from "@dreamfactory/speedrun/action";

/**
 * The engine's verbs, and this game's over the top when it has some. Composed
 * once and exported, because the workbench and the parser must be handed the
 * SAME table (`speedrun/src/runner.ts`, `runSheet`).
 */
export const ACTIONS: ActionTable = composeActions(CORE_ACTIONS);

/** the grammar half of {@link ACTIONS}, for the parser */
export const VERBS: Record<string, VerbSpec> = verbsOf(ACTIONS);

/** a verb by name, case-insensitively */
export const resolve = (verb: string): Action | undefined => resolveIn(ACTIONS, verb);
