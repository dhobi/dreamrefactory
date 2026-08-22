import { toStr } from "../interp";
import type { GameSession } from "../session";
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
 *
 * Both freeze the world for as long as the host's modal is up, because the
 * original does: `GetOpenFileNameA` / `GetSaveFileNameA` run their own modal
 * message loop, so the game's loop does not run at all while the dialog is on
 * screen (see {@link GameSession.gameTime}). Only `opengame` owns its screen as
 * well (see {@link blackTheScreen}) — `saveme` blacks the screen itself, in
 * script, before it ever gets here.
 */
export function registerSaveGameBuiltins(ctx: BuiltinCtx): void {
  const { session, r, log } = ctx;

  r("savegame", async (_i, [version]) => {
    const bytes = session.snapshotSave();
    if (!bytes) {
      log("savegame: nothing to save (no base save/template)");
      return 0;
    }
    session.freezeTime();
    try {
      await session.onSaveGame(bytes, toStr(version ?? ""));
    } finally {
      session.thawTime();
    }
    return 0;
  });

  r("opengame", async (_i, [version]) => {
    const back = blackTheScreen(session);
    session.freezeTime();
    let bytes: Uint8Array | null;
    try {
      bytes = await session.onLoadGame(toStr(version ?? ""));
    } finally {
      session.thawTime();
    }
    // Cancelled, or the file is not a save we can read: the panel comes back
    // exactly as it was, with no ramp — in the original it was never repainted,
    // only uncovered.
    if (!bytes) return back();
    if (!(await session.loadGame(bytes))) return back();
    // Loaded. The restore blacked the screen and rebuilt the room behind it;
    // what is showing now is the room, so stop holding the black over it.
    session.fade.level = 0;
    return 0;
  });
}

/**
 * Black the screen for the length of a load, and hand back the undo.
 *
 * TI.EXE shows the *Open* dialog through one shared wrapper (`0x420e40`), and
 * that wrapper hides the game: `0x420500` walks the window list at `0x486390`
 * plus the main window at `0x485c40` and `ShowWindow`s each of them away (then
 * forces the OS cursor back on) before calling `GetOpenFileNameA`; `0x4205e0`
 * shows them again after. So the "save/load void" the dialog sits in (#162) is
 * not a painted frame at all — it is the absence of a window. We have one
 * canvas and cannot take it away, so paint what taking it away shows.
 *
 * The restore itself blacks too, and not by accident: at `0x41420e`, partway
 * through `0x414080`, it runs `0x41f8d0(0x489de4)` / `0x41fcc0(0x489de4, &r)` /
 * `0x41fdb0()` / `0x41fd40(0)` / `0x420240(&r)` — the same five calls, in the
 * same order, with the same arguments, that ARE the whole body of the
 * `blackscreen` command (`0x43e650`). Only then does it rebuild the palette and
 * the loop tables. Nothing lifts that black either: the room simply gets drawn
 * over it, which is why the caller above clears the level instead of ramping.
 *
 * None of this is scripted — `CTL.STG`'s load lever is `opengame` and a stage
 * check, nothing else. The SAVE lever's `saveme` is the opposite: it does its
 * own `screentoblack`/`blackscreen`, swaps the stage, and fades back with
 * `blacktoscreen` — so a save is already black here without any help.
 */
function blackTheScreen(session: GameSession): () => number {
  const f = session.fade;
  const was = { level: f.level, queue: [...f.queue], snapshot: f.snapshot, pending: f.pendingReveal };
  f.queue.length = 0;
  f.snapshot = null;
  f.level = 1;
  f.pendingReveal = false;
  return () => {
    f.level = was.level;
    f.queue.push(...was.queue);
    f.snapshot = was.snapshot;
    f.pendingReveal = was.pending;
    return 0;
  };
}
