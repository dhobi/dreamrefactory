import { toStr } from "../interp";
import { BuiltinCtx } from "./context";

/**
 * Save / load game builtins (`savegame` op 12077, `opengame` op 12078), called
 * from the control panel's save/load levers (TAOOT's CTL.STG). Both block on a host
 * dialog the way TI.EXE's native *Save As* / *Open* modal loop does.
 *
 * The CTL scripts wrap these with the screen choreography (fade out, swap
 * ctl.stg → main.stg, show the interface, snapshot, restore) — see the
 * `saveme` handler; the builtins themselves only produce/consume the `.ti`
 * bytes and hand them to the host:
 *
 *   - `savegame` snapshots the live progress ({@link GameSession.snapshotSave})
 *     and passes the bytes to {@link GameSession.onSaveGame} (browser: download).
 *   - `opengame` asks {@link GameSession.onLoadGame} for a chosen file's bytes
 *     (null = the user cancelled) and, on success, loads them
 *     ({@link GameSession.loadGame}), which travels into the saved room. The
 *     CTL lever then checks `currentstage() != "ctl.stg"` to tell a completed
 *     load from a cancel.
 */
export function registerSaveGameBuiltins(ctx: BuiltinCtx): void {
  const { session, r, log } = ctx;

  r("savegame", async (_i, [version]) => {
    const bytes = session.snapshotSave();
    if (!bytes) {
      log("savegame: nothing to save (no base save/template)");
      return 0;
    }
    await session.onSaveGame(bytes, toStr(version ?? ""));
    return 0;
  });

  r("opengame", async (_i, [version]) => {
    const bytes = await session.onLoadGame(toStr(version ?? ""));
    if (!bytes) return 0; // cancelled — stay on the control panel
    await session.loadGame(bytes);
    return 0;
  });
}
