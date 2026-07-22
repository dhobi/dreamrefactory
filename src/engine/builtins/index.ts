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

/**
 * Register all game builtins on the session interpreter (idempotent).
 * Called from the GameSession constructor — must happen before any script
 * runs (shop openshop handlers fire during loadBootResources, before the
 * first set binding exists). Set-specific commands delegate through
 * session.currentBinding so they always act on the active set.
 *
 * The command families are split across this folder's modules; each receives
 * the shared {@link createBuiltinCtx} plumbing. Registration order between
 * families is immaterial — every builtin name is registered exactly once here
 * (the sole legacy within-file duplicate, `flushevents`, is a no-op either way).
 */
export function registerGameBuiltins(session: GameSession): void {
  if (session.builtinsRegistered) return;
  session.builtinsRegistered = true;

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
}
