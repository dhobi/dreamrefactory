import type { GameSession } from "../session";
import { createBuiltinCtx } from "./context";
import { registerDispatchBuiltins } from "./dispatch";
import { registerSceneBuiltins } from "./scene";
import { registerPropBuiltins } from "./props";
import { registerAudioBuiltins } from "./audio";
import { registerTimingBuiltins } from "./timing";
import { registerActorBuiltins } from "./actors";
import { registerPuppetBuiltins } from "./puppets";
import { registerPointerBuiltins } from "./pointer";
import { registerHelperBuiltins } from "./helpers";
import { registerSaveGameBuiltins } from "./savegame";
import { registerCoreBuiltins } from "./core";
import { registerPluginBuiltins } from "./plugins";

/**
 * Register every builtin — the language core plus all game families — on the
 * session interpreter (idempotent). Called from the GameSession constructor —
 * must happen before any script runs (shop openshop handlers fire during
 * loadBootResources, before the first set binding exists). Set-specific
 * commands delegate through session.currentBinding so they always act on the
 * active set.
 *
 * The command families are split across this folder's modules; each receives
 * the shared {@link createBuiltinCtx} plumbing. Every builtin name is
 * registered exactly once across the whole folder — Interpreter.register
 * throws on a duplicate, because a silent overwrite is how a wrong `calcmod`
 * (the plain-% one interp.ts used to register) stayed hidden.
 */
export function registerGameBuiltins(session: GameSession): void {
  if (session.builtinsRegistered) return;
  session.builtinsRegistered = true;

  // through a closure, not session.rng directly: the session assigns its
  // default after this constructor call, and a harness reseeds later still.
  registerCoreBuiltins(session.interp, () => session.rng());
  const ctx = createBuiltinCtx(session);
  registerDispatchBuiltins(ctx);
  registerSceneBuiltins(ctx);
  registerPropBuiltins(ctx);
  registerAudioBuiltins(ctx);
  registerTimingBuiltins(ctx);
  registerActorBuiltins(ctx);
  registerPuppetBuiltins(ctx);
  registerPointerBuiltins(ctx);
  registerHelperBuiltins(ctx);
  registerSaveGameBuiltins(ctx);
  registerPluginBuiltins(ctx);
}
