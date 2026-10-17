import { loadGame, snapshotSave } from "./saveload";
import { loadGameV1, snapshotSaveV1 } from "./saveload-v1";
import { loadGameV5, snapshotSaveV5 } from "./saveload-v5";
import type { GameSession } from "./session";

/**
 * Where the session's three engines part ways, side by side: DF.EXE (Dust,
 * DreamFactory 1), TI.EXE (Titanic, 4) and RedJack.exe (RedJack, 5). The
 * session reads the answer off here instead of asking which engine it is; the
 * scheduler has its own (scheduler-rules.ts).
 */
export interface SessionProfile {
  readonly engine: 1 | 4 | 5;
  /** which command table the ids mean — Dust's and Titanic's disagree about what some answer (value-types.ts) */
  readonly commandTable: 1 | 4;
  /** a script error opens the error box and stops the game (TI.EXE); the others log it and go on */
  readonly latchesScriptErrors: boolean;
  /**
   * `wavevolume` is the wave DEVICE's volume, `n · 0xffff / 9` truncated
   * (TI.EXE 0x4072f6, waveOutSetVolume), so it scales the theme too; the other
   * engines' are not read and scale the effects and voices.
   */
  readonly waveVolumeIsDevice: boolean;
  /** TI.EXE's and tl.exe's script debugger window (runtime/debugger.ts); DF.EXE and RedJack.exe have none */
  readonly debugChannel: boolean;
  /** the bytes of a save (saveload.ts, -v1, -v5); `version` is what `savegame` was given */
  readonly save: (session: GameSession, version: string | undefined) => Uint8Array | null;
  /** put a save back; `version` is what `opengame` was given */
  readonly load: (session: GameSession, bytes: Uint8Array, version: string | undefined) => Promise<boolean>;
}

/** Titanic */
const V4: SessionProfile = {
  engine: 4,
  commandTable: 4,
  latchesScriptErrors: true,
  waveVolumeIsDevice: true,
  debugChannel: true,
  save: (session) => snapshotSave(session),
  load: (session, bytes) => loadGame(session, bytes),
};

/** Dust */
const V1: SessionProfile = {
  engine: 1,
  commandTable: 1,
  latchesScriptErrors: false,
  waveVolumeIsDevice: false,
  debugChannel: false,
  save: (session) => snapshotSaveV1(session),
  load: (session, bytes) => loadGameV1(session, bytes),
};

/** RedJack */
const V5: SessionProfile = {
  ...V4,
  engine: 5,
  latchesScriptErrors: false,
  waveVolumeIsDevice: false,
  debugChannel: false,
  save: (session, version) => snapshotSaveV5(session, version),
  // a load is a script's (`opengame`), and RedJack.exe sends no idle while one
  // runs: held as a running script, wherever the host starts it from
  load: (session, bytes, version) => session.track(loadGameV5(session, bytes, version), "load"),
};

/**
 * The profile for the engine a session is running. Asked each time rather than
 * kept, because a session learns which it is as it boots: v5 from the BOOTFILE,
 * v1 from the set it opens.
 */
export function sessionProfile(engine: { readonly isV1: boolean; readonly isV5: boolean }): SessionProfile {
  if (engine.isV5) return V5;
  return engine.isV1 ? V1 : V4;
}
