/**
 * Where the three engines' screens part ways, side by side: DF.EXE (Dust,
 * DreamFactory 1), TI.EXE (Titanic and Timelapse, 4) and RedJack.exe (RedJack,
 * 5). The director, the room viewer and the conversation read the rule off here
 * instead of asking which engine it is; the commands have theirs
 * (runtime/builtins/command-rules.ts), the scheduler its own.
 */
export interface ScreenRules {
  // ---- input -----------------------------------------------------------------
  /** the pass takes a queued press at its head (DF.EXE, see ScreenDirector.tick) */
  readonly inputAtPassHead: boolean;
  /** a gesture made while the BOOTFILE idle runs waits for it (TI.EXE en 0x431c43, RedJack.exe); DF.EXE's pass takes it at its head */
  readonly idleHoldsGestures: boolean;
  /**
   * The director takes the event queue itself, every frame, while nothing holds
   * the engine: RedJack.exe's main loop sends `idle ()` (event 9, 0x41e8c3) and
   * only then takes at most one event (0x41e9b1). A v4 or v1 room's viewer pops
   * its own; a game with no room at all is the director's either way.
   */
  readonly directorTakesQueue: boolean;
  /** a press while the engine is busy is always queued; the others dispatch it to a loop that polls the button */
  readonly queuesBusyPresses: boolean;
  /** a queued click that moved the pointer leaves it moved */
  readonly queuedClickKeepsMove: boolean;
  /** a click is a new event, not yet consumed (RedJack's cannon.sett, MazeView.roomKeyDown) */
  readonly clickClearsConsumed: boolean;
  /** a key holds the engine like a running script; RedJack's duels are fought by keys while their loops run */
  readonly keysHoldEngine: boolean;
  /** a key's release reaches the scripts (RedJack.exe's `keyup`) */
  readonly hearsKeyUp: boolean;
  /** a flat is drawn at the stage's origin (`stageorigin`), its regions in the flat's own coordinates */
  readonly flatsAtStageOrigin: boolean;
  // ---- drawing ---------------------------------------------------------------
  /** films, the stage's flat and the puppet are drawn through their light groups (`stagebrightness`…, 0x41658d) */
  readonly lightGroups: boolean;
  /** over a room only the boot's UI shops draw (PropRuntime.drawList); a v5 game's screen props are all over the room */
  readonly onlyUiPropsOverRoom: boolean;
  /** the answer rows are coloured by an RGB value rather than a palette index */
  readonly bevelInkIsRgb: boolean;
  /** `puppetgrab`: the set's view stands in for layer 0 (DF.EXE 0x437165) */
  readonly puppetGrab: boolean;
  // ---- the room --------------------------------------------------------------
  /** DF.EXE's moves (SetViewer.navigateAsDf), not TI.EXE's */
  readonly dfMoves: boolean;
  /** a `currentscene`/`currentview` jump happens at once (SetViewer.jumpV1), not paired up */
  readonly jumpsAtOnce: boolean;
  /** `openset` ends the opening when its jump left this scene (DF.EXE), not when the set was closed (TI.EXE 0x407ed7) */
  readonly openSetJumpEndsOpening: boolean;
  /** an arrival is a running script, held like the pass's loop handlers (DF.EXE 0x4115f0) */
  readonly arrivalIsScript: boolean;
  /** a refused move still leaves the scene (DF.EXE); TI.EXE checks for a road before its closescene */
  readonly refusedMoveDeparts: boolean;
  /** the pass steps the room's camera (DF.EXE 0x433d20) */
  readonly passStepsCamera: boolean;
}

/** Titanic and Timelapse */
const V4: ScreenRules = {
  inputAtPassHead: false,
  idleHoldsGestures: true,
  directorTakesQueue: false,
  queuesBusyPresses: false,
  queuedClickKeepsMove: false,
  clickClearsConsumed: false,
  keysHoldEngine: true,
  hearsKeyUp: false,
  flatsAtStageOrigin: false,
  lightGroups: false,
  onlyUiPropsOverRoom: true,
  bevelInkIsRgb: false,
  puppetGrab: false,
  dfMoves: false,
  jumpsAtOnce: false,
  openSetJumpEndsOpening: false,
  arrivalIsScript: false,
  refusedMoveDeparts: false,
  passStepsCamera: false,
};

/** Dust */
const V1: ScreenRules = {
  ...V4,
  inputAtPassHead: true,
  idleHoldsGestures: false,
  puppetGrab: true,
  dfMoves: true,
  jumpsAtOnce: true,
  openSetJumpEndsOpening: true,
  arrivalIsScript: true,
  refusedMoveDeparts: true,
  passStepsCamera: true,
};

/** RedJack */
const V5: ScreenRules = {
  ...V4,
  directorTakesQueue: true,
  queuesBusyPresses: true,
  queuedClickKeepsMove: true,
  clickClearsConsumed: true,
  keysHoldEngine: false,
  hearsKeyUp: true,
  flatsAtStageOrigin: true,
  lightGroups: true,
  onlyUiPropsOverRoom: false,
  bevelInkIsRgb: true,
};

/** the screen rules of the engine a session is running — asked each time, because it learns it as it boots */
export function screenRules(engine: { readonly isV1: boolean; readonly isV5: boolean }): ScreenRules {
  if (engine.isV5) return V5;
  return engine.isV1 ? V1 : V4;
}
