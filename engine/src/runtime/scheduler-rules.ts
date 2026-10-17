import { bearingV5, engineBearing } from "./geometry";

/**
 * Where the scheduler's three engines part ways, side by side: DF.EXE (Dust,
 * DreamFactory 1), TI.EXE (Titanic, 4) and RedJack.exe (RedJack, 5). The
 * scheduler asks {@link schedulerRules} once per use and reads the answer off
 * here instead of asking the session which engine it is; the code that carries
 * each rule out, and the addresses it was read at, stay in scheduler.ts. The
 * sound effects, where the engines differ in what they DO rather than in a
 * number, are classes of their own (sound-channels.ts and its -v1, -v4, -v5), and so are the crickets (crickets.ts).
 */
export interface SchedulerRules {
  readonly engine: 1 | 4 | 5;

  // ---- loops (makeloop) ----
  /** the loop table's slots: TI.EXE's 32, RedJack.exe's 64 (0x4c4a80) */
  readonly loopSlots: number;
  /** a full table is error 0x23 (RedJack.exe 0x41bfa1), not a loop dropped with a log line */
  readonly loopTableFullThrows: boolean;
  /** a negative period is a tick to fall due on (RedJack.exe 0x41bf05) */
  readonly negativePeriodIsDeadline: boolean;

  // ---- walks and turns ----
  /** `stopwalk ("all")` clears every walk; RedJack.exe has no such name */
  readonly stopWalkAll: boolean;
  /** a walker that is not there is error 0xa (RedJack.exe 0x41b3a5), not a slot quietly freed */
  readonly missingWalkerThrows: boolean;
  /** a turn steps the ACTOR's facing (DF.EXE 0x439629), not the walk record's */
  readonly turnStepsActor: boolean;
  /** a whole turn: 256 for the older engines, 2^24 for DreamFactory 5 (#447) */
  readonly turnUnits: number;
  /** the wrap a turn steps across: 0xff, RedJack.exe's 0xffffff (0x41b4dc) */
  readonly turnWrap: number;
  /** a position as a walk record holds it: 16-bit words, RedJack.exe's dwords (0x41b5d4) */
  readonly word: (v: number) => number;
  /** the facing of a delta vector in {@link turnUnits}: the engines' table bearing, or DreamFactory 5's */
  readonly heading: (dx: number, dy: number) => number;

  // ---- the pass and the frame ----
  /** the frame steps only the props it draws, against the room's camera (DF.EXE 0x41eb67) */
  readonly propsByCamera: boolean;
  /** an animation's ending is sent on the next pass (RedJack.exe), not when it ends */
  readonly endAnimsOwed: boolean;
}

/** sign-extend the low 16 bits — the walk records hold their positions in words */
export const s16 = (v: number): number => (v << 16) >> 16;

/** Titanic: the scheduler as TI.EXE runs it, the one the others are told apart from */
const V4: SchedulerRules = {
  engine: 4,
  loopSlots: 32,
  loopTableFullThrows: false,
  negativePeriodIsDeadline: false,
  stopWalkAll: true,
  missingWalkerThrows: false,
  turnStepsActor: false,
  turnUnits: 0x100,
  turnWrap: 0xff,
  word: s16,
  heading: engineBearing,
  propsByCamera: false,
  endAnimsOwed: false,
};

/** Dust */
const V1: SchedulerRules = {
  ...V4,
  engine: 1,
  turnStepsActor: true,
  propsByCamera: true,
};

/** RedJack */
const V5: SchedulerRules = {
  ...V4,
  engine: 5,
  loopSlots: 64,
  loopTableFullThrows: true,
  negativePeriodIsDeadline: true,
  stopWalkAll: false,
  missingWalkerThrows: true,
  turnUnits: 0x1000000,
  turnWrap: 0xffffff,
  word: (v) => v | 0,
  heading: bearingV5,
  endAnimsOwed: true,
};

/**
 * The rules for the engine a session is running. Asked each time rather than
 * kept, because a session learns which it is as it boots: v5 from the BOOTFILE,
 * v1 from the set it opens.
 */
export function schedulerRules(engine: { readonly isV1: boolean; readonly isV5: boolean }): SchedulerRules {
  if (engine.isV5) return V5;
  return engine.isV1 ? V1 : V4;
}
