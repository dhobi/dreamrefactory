import type { Builtin, Interpreter } from "../interp";
import { isDfEffect, isExeEffect } from "../visual-effects";
import { forEngine, type EngineFlags, type PerEngine } from "../engine";

/**
 * Where the three engines' commands part ways, side by side: DF.EXE (Dust,
 * DreamFactory 1), TI.EXE (Titanic, 4) and RedJack.exe (RedJack, 5). A command
 * reads the rule off here instead of asking which engine it is; a command whose
 * whole body differs is registered {@link byEngine} instead.
 */
export interface CommandRules {
  /** `actorinstance` copies the source's whole record (DF.EXE 0x411cc0, see copyActorRecord) */
  readonly actorInstanceCopiesRecord: boolean;
  /** `propinstance` copies the source's whole record */
  readonly propInstanceCopiesRecord: boolean;
  /** a world prop placed without a `propscale` draws at its authored size (becomeWorldProp) */
  readonly worldPropsDrawAuthored: boolean;
  /** a star carries a facing that placing on it takes; DreamFactory 5's is a point and no more (0x428430) */
  readonly starsFace: boolean;
  /** `actorstar` drops the actor's walk before it looks the star up (RedJack.exe) */
  readonly starStopsWalk: boolean;
  /** `actordelete` first sends the actor `closeactor ()` and takes its walk and loop (RedJack.exe 0x4017f0) */
  readonly deleteClosesActor: boolean;
  /** a walk to a star off the open set waits for that set (TI.EXE 0x442fb4, RedJack.exe 0x41c959); DF.EXE walks at once */
  readonly defersWalksOffSet: boolean;
  /** `walkonpath` walks the route or fails, with no straight line to fall back on (RedJack.exe 0x41ce80) */
  readonly pathWalksNeedRoute: boolean;
  /** `currentscene (word)` looks the word up in the set's scene table first (DF.EXE 0x40ee66) */
  readonly sceneWordsFromSet: boolean;
  /** the directions `currentscene` knows (DF.EXE 0x40ef44 has a fourth) */
  readonly directions: ReadonlySet<string>;
  /**
   * A polled command answers at once, and only the ask a bare poll loop makes —
   * the same call again in the same tick — waits a frame (RepeatedAsk). RedJack.exe's
   * `button`, `stilldown`, `voicedone` and `currentsound` read state, and its
   * fights ask them from loops that run inside a pass.
   */
  readonly pollsAnswerAtOnce: boolean;
  /** `sendtopost` and `sendtoserver` are DF.EXE's grid questions, `rowcoltoscene` and `scenebuild` */
  readonly postAndServerAreGrid: boolean;
  /** `pointinprop` tests the drawn frame's box (RedJack.exe); TI.EXE tests the box and then the pixel (0x417120) */
  readonly pointInPropIsBox: boolean;
  /**
   * A bad call is a script error: an argument too many (`puppetspeak`), a word
   * that is no direction (`currentscene`), an accessor's unknown name, the
   * scripts' own `error()`. DreamFactory 5 logs or ignores them, as the port
   * always did — it was never checked against RedJack.exe.
   */
  readonly strictCalls: boolean;
  /** `random (n)` with n <= 0 is error 0xa (TI.EXE 0x42a900, tl.exe 0x43a040); DF.EXE has no check */
  readonly randomRefusesNonPositive: boolean;
  readonly effects: {
    /**
     * Effect names outside the engine's band, error 0xe before anything else:
     * DF.EXE's band is 24001..24014 (0x4202fa..0x42030a -> 0x4203cd), so the
     * turns and `nodraw` are not effects there at all, and RedJack.exe's is
     * 24001..24020 (0x408ba2..0x408bb6 -> 0x408c6f), so `turnhalfright` (24021)
     * is not one.
     */
    readonly outOfBand: ReadonlySet<string>;
    /** an effect the exe draws itself, strip by strip */
    readonly drawn: (name: string) => boolean;
    /** how it is drawn: DF.EXE's fixed passes (dfPlan) or TI.EXE's steps */
    readonly draws: "df" | "ti";
    /** `turnhalfleft` is a dissolve (RedJack.exe) */
    readonly halfLeftDissolves: boolean;
  };
}

const TI_DIRECTIONS: ReadonlySet<string> = new Set(["left", "right", "strait"]);

/** Titanic */
const V4: CommandRules = {
  actorInstanceCopiesRecord: false,
  propInstanceCopiesRecord: false,
  worldPropsDrawAuthored: false,
  starsFace: true,
  starStopsWalk: false,
  deleteClosesActor: false,
  defersWalksOffSet: true,
  pathWalksNeedRoute: false,
  sceneWordsFromSet: false,
  directions: TI_DIRECTIONS,
  pollsAnswerAtOnce: false,
  postAndServerAreGrid: false,
  pointInPropIsBox: false,
  strictCalls: true,
  randomRefusesNonPositive: true,
  effects: { outOfBand: new Set(), drawn: isExeEffect, draws: "ti", halfLeftDissolves: false },
};

/** Dust */
const V1: CommandRules = {
  ...V4,
  actorInstanceCopiesRecord: true,
  worldPropsDrawAuthored: true,
  defersWalksOffSet: false,
  sceneWordsFromSet: true,
  postAndServerAreGrid: true,
  randomRefusesNonPositive: false,
  directions: new Set([...TI_DIRECTIONS, "backwards"]),
  effects: {
    outOfBand: new Set(["turnright", "turnleft", "turnup", "turndown", "nodraw", "turnhalfleft", "turnhalfright"]),
    drawn: isDfEffect,
    draws: "df",
    halfLeftDissolves: false,
  },
};

/** RedJack */
const V5: CommandRules = {
  ...V4,
  propInstanceCopiesRecord: true,
  starsFace: false,
  starStopsWalk: true,
  deleteClosesActor: true,
  pathWalksNeedRoute: true,
  pollsAnswerAtOnce: true,
  pointInPropIsBox: true,
  strictCalls: false,
  randomRefusesNonPositive: false,
  effects: { ...V4.effects, outOfBand: new Set(["turnhalfright"]), halfLeftDissolves: true },
};

/** the command rules of the engine a session is running */
export function commandRules(engine: EngineFlags): CommandRules {
  return forEngine(engine, { v4: V4, v1: V1, v5: V5 });
}

/** a command whose whole body differs by engine, picked at each call */
export function byEngine(engine: EngineFlags, each: PerEngine<Builtin>): Builtin {
  return (i, args, call, frame) => forEngine(engine, each)(i, args, call, frame);
}

/** a command one engine has and the others do not: there, the unknown command it always was */
export function unknownCommand(name: string): Builtin {
  return (i, args) => {
    i.onUnknown(name, args);
    return 0;
  };
}

/** narrow a command already registered to DreamFactory 5: elsewhere it stays the unknown command it always was */
export function onlyOnV5(engine: EngineFlags, interp: Interpreter, name: string): void {
  const v5 = interp.builtins.get(name)!;
  interp.builtins.set(name, byEngine(engine, { v4: unknownCommand(name), v5 }));
}

/** give a command already registered DreamFactory 5's own body, which may fall back to the older one it is handed */
export function overrideOnV5(engine: EngineFlags, interp: Interpreter, name: string, v5: (v4: Builtin) => Builtin): void {
  const v4 = interp.builtins.get(name)!;
  interp.builtins.set(name, byEngine(engine, { v4, v5: v5(v4) }));
}
