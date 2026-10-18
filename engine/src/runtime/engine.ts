/**
 * Which engine a session runs: DF.EXE (Dust, DreamFactory 1), TI.EXE (Titanic
 * and Timelapse, 4) or RedJack.exe (RedJack, 5). A session learns it as it
 * boots — v5 from the BOOTFILE, v1 from the set it opens — so it is asked each
 * time rather than kept.
 */
export interface EngineFlags {
  readonly isV1: boolean;
  readonly isV5: boolean;
}

/** one thing per engine: Titanic's, and Dust's or RedJack's where theirs differs */
export interface PerEngine<T> {
  readonly v4: T;
  readonly v1?: T;
  readonly v5?: T;
}

/** this engine's own of {@link PerEngine} — the one place an engine is told apart */
export function forEngine<T>(engine: EngineFlags, each: PerEngine<T>): T {
  if (engine.isV5) return each.v5 ?? each.v4;
  return (engine.isV1 ? each.v1 : undefined) ?? each.v4;
}
