import { loadGame, snapshotSave } from "./saveload";
import { loadGameV1, snapshotSaveV1 } from "./saveload-v1";
import { loadGameV5, snapshotSaveV5 } from "./saveload-v5";
import type { GameSession } from "./session";
import { forEngine, type EngineFlags } from "./engine";

/**
 * Where the session's three engines part ways, side by side: DF.EXE (Dust,
 * DreamFactory 1), TI.EXE (Titanic, 4) and RedJack.exe (RedJack, 5). The
 * session reads the answer off here instead of asking which engine it is; the
 * scheduler has its own (scheduler-rules.ts).
 */
export interface SessionProfile {
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
  /**
   * A load opens its own set and is not this engine's save format (Dust): the
   * host hands it the bytes and does not take its HUD apart first.
   */
  readonly loadOpensItsSet: boolean;
  /**
   * A load runs no `open…` handler while it rebuilds — `openactor`, `openshop`,
   * `openprop`, `openstage`, `openflat`, `openset`, `openscene`
   * (docs/engine/formats/savegame-v5.md); the v4 and v1 loads mute only the
   * room's lifecycle.
   */
  readonly loadMutesOpens: boolean;
  /** `savegame` refuses with a conversation open or on a road (RedJack.exe 0x43c9b6, 0x43c9e9) */
  readonly refusesBusySaves: boolean;

  // ---- scripts and sprites ----
  /**
   * How the interpreter reads a script (Interpreter.shortCircuit, .classic):
   * RedJack.exe steps over the right operand of a decided `|`/`&` (0x410788);
   * DF.EXE, TI.EXE and tl.exe type their values — a boolean is not a number,
   * and a mismatch is error 0xe — where RedJack.exe keeps 1/0 and lenient
   * operators.
   */
  readonly scripts: { readonly shortCircuit: boolean; readonly typed: boolean };
  /** a sprite's point test is the engines' own (sprite-scaler.ts); DreamFactory 5's was not ported from those */
  readonly enginePointTests: boolean;

  // ---- the boot ----
  /** the BOOTFILE's literal `boot()` assignments seed the globals (SessionBoot.seedFromBoot) */
  readonly seedsGlobalsFromBoot: boolean;
  /** `puppetparam` slots the engine seeds: DreamFactory 5's 3 and 4 are 0x00RRGGBB, white answers and a red frame (0x439d41) */
  readonly puppetParamSeeds: readonly (readonly [slot: number, value: number])[];
  /** closing a sound bank stops its crickets */
  readonly closedSoundsStopCrickets: boolean;
  /** the boot's films are played by the director once a day has been advanced (GameHost) */
  readonly bootAdvancesDay: boolean;

  // ---- files and events ----
  /**
   * A resource name with no extension gets its type's (RedJack.exe 0x43c88e):
   * `runpuppet ("lyle1", …)` opens `lyle1.pupp`; the older engines are handed
   * their names unchanged.
   */
  readonly typedNames: boolean;
  /** a cast has a main script, sent `closecast` when it closes */
  readonly castsHaveMains: boolean;
  /** every set opens visible (RedJack.exe 0x43f8e8) */
  readonly setsOpenVisible: boolean;
  /** the BOOTFILE's library hears the `sendto…` it did not send itself (RedJack's cannon) */
  readonly libraryHearsSends: boolean;
  /** `sendtocast`, `sendtoprop`, `sendtoshop` and `sendtoquad` find their target among their own kind first (RedJack.exe 0x405370, 0x42b550) */
  readonly sendsFindTheirKind: boolean;
  /** a flat is drawn at the stage's origin (`stageorigin`), its regions in the flat's own coordinates */
  readonly flatsAtStageOrigin: boolean;
  /** of overlapping regions the first wins; the older engines take the last */
  readonly firstRegionWins: boolean;
  /** `closeset` closes outside in, set before floor before scene (DF.EXE 0x40f370) */
  readonly closesOutsideIn: boolean;

  // ---- conversations ----
  /** one conversation at a time: `openpuppetfile` is error 0x2d while one is open (DF.EXE 0x43585d) */
  readonly oneConversation: boolean;
  /** opening a conversation shows the arrow (RedJack.exe's Pupp.c, 0x42e6b0, #446) */
  readonly conversationArrow: boolean;
  /** `puppetevent (n)` waits n ticks (PuppetController.puppetEvent); before DreamFactory 5 it takes no argument */
  readonly puppetEventWaits: boolean;
  /** how long a line with no recording is held, in ticks (PuppetController.holdUnknownLine) */
  readonly unknownLineTicks: (length: number, param9: number | undefined) => number;
  /** a `path` that names one of the game's discs, its number captured, and the discs' name */
  readonly disc: { readonly path: RegExp; readonly name: string };
}

/** Titanic */
const V4: SessionProfile = {
  commandTable: 4,
  latchesScriptErrors: true,
  waveVolumeIsDevice: true,
  debugChannel: true,
  save: (session) => snapshotSave(session),
  load: (session, bytes) => loadGame(session, bytes),
  loadOpensItsSet: false,
  loadMutesOpens: false,
  refusesBusySaves: false,
  scripts: { shortCircuit: false, typed: true },
  enginePointTests: true,
  puppetEventWaits: false,
  seedsGlobalsFromBoot: true,
  puppetParamSeeds: [],
  closedSoundsStopCrickets: false,
  bootAdvancesDay: false,
  typedNames: false,
  castsHaveMains: false,
  setsOpenVisible: false,
  libraryHearsSends: false,
  sendsFindTheirKind: false,
  flatsAtStageOrigin: false,
  firstRegionWins: false,
  closesOutsideIn: false,
  oneConversation: false,
  conversationArrow: false,
  // TI.EXE `length * puppetparam(9)` ticks, at least 60 — TAOOT's boot sets slot 9 to 1
  unknownLineTicks: (length, param9) => Math.max(length * (param9 ?? 2), 60),
  disc: { path: /^titanic([12]):/i, name: "titanic" },
};

/** Dust */
const V1: SessionProfile = {
  ...V4,
  commandTable: 1,
  latchesScriptErrors: false,
  waveVolumeIsDevice: false,
  debugChannel: false,
  save: (session) => snapshotSaveV1(session),
  load: (session, bytes) => loadGameV1(session, bytes),
  loadOpensItsSet: true,
  closesOutsideIn: true,
  oneConversation: true,
  unknownLineTicks: (length) => (length >> 1) + 60,
};

/** RedJack */
const V5: SessionProfile = {
  ...V4,
  latchesScriptErrors: false,
  waveVolumeIsDevice: false,
  debugChannel: false,
  save: (session, version) => snapshotSaveV5(session, version),
  // a load is a script's (`opengame`), and RedJack.exe sends no idle while one
  // runs: held as a running script, wherever the host starts it from
  load: (session, bytes, version) => session.track(loadGameV5(session, bytes, version), "load"),
  loadMutesOpens: true,
  refusesBusySaves: true,
  scripts: { shortCircuit: true, typed: false },
  enginePointTests: false,
  puppetEventWaits: true,
  seedsGlobalsFromBoot: false,
  puppetParamSeeds: [[3, 0xffffff], [4, 0xff0000]],
  closedSoundsStopCrickets: true,
  bootAdvancesDay: true,
  typedNames: true,
  castsHaveMains: true,
  setsOpenVisible: true,
  libraryHearsSends: true,
  sendsFindTheirKind: true,
  flatsAtStageOrigin: true,
  firstRegionWins: true,
  conversationArrow: true,
  disc: { path: /^rjdisk([1-3]):/i, name: "rjdisk" },
};

/**
 * The profile for the engine a session is running. Asked each time rather than
 * kept, because a session learns which it is as it boots: v5 from the BOOTFILE,
 * v1 from the set it opens.
 */
export function sessionProfile(engine: EngineFlags): SessionProfile {
  return forEngine(engine, { v4: V4, v1: V1, v5: V5 });
}
