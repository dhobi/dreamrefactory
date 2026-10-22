/**
 * The shape of RedJack's verbs: one move of the suites' played through the
 * speedrun driver. Its own module so ./actions.ts and the day files it
 * composes (./day2.ts…) can both build verbs with it without importing each
 * other.
 */
import type { Action, ActionContext } from "@dreamfactory/speedrun/action";
import { fail, type Player } from "../play/player";
import { playerFor } from "./player";

/** a line's `budget:` as passes, when the line gives one */
export const passesOf = (c: ActionContext): number | undefined =>
  c.step.opts.budget === undefined ? undefined : Math.max(1, Math.round(Number(c.step.opts.budget) / 50));

/** a verb that is one move of the suites' — `wait: none`, it has waited already */
export const move = (spec: Omit<Action, "run" | "wait">, play: (h: Player, c: ActionContext) => Promise<unknown>): Action => ({
  ...spec,
  wait: "none",
  run: async (c) => {
    await play(await playerFor(c), c);
  },
});

/** argument `i` of the line, as a number */
export const num = (c: ActionContext, i: number, what: string): number => {
  const n = Number(c.step.args[i]);
  if (!Number.isFinite(n)) fail(`${c.step.verb}: ${what} is a number, not "${c.step.args[i] ?? ""}"`);
  return n;
};
