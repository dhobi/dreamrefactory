/**
 * What a route is allowed to know.
 *
 * A segment (segments.ts) is a list of gestures and the story state it expects
 * to reach. It is deliberately written against this small surface rather than
 * against a GameSession, because the same segment has to run in two places: in
 * this process against a pumped headless host, and over the wire against a real
 * browser, where the engine is in another process and every read is a round trip.
 *
 * Hence the getters are SYNCHRONOUS and the gestures are not. A browser
 * implementation keeps a mirror of the state a route can ask about and refreshes
 * it on every settle and inside every poll loop, so a getter is as fresh as the
 * last gesture — which is the only moment a route reads anything anyway. Nothing
 * here lets a route reach past the mirror, and that is the point: a route that
 * could only work locally would be a route the browser can't watch.
 */
import type { Navigator, NavDriver } from "./nav/navigator";

export interface Story {
  /** plan and walk routes */
  nav: Navigator;
  /** individual gestures, for the steps a route makes by hand */
  d: NavDriver;
  /** a numeric script global (mission, phase, the sub-plot machines) */
  num(name: string): number;
  /** a string script global (handitem, zeitclue, hallside, …) */
  str(name: string): string;
  /** is Frank carrying this prop? */
  owns(prop: string): boolean;
  /** a prop's `deg` — a dial's number, a switch's position, a wire's plug */
  deg(prop: string): number;
  /**
   * A character's `actorowner` — the one-word memory each of them keeps of you.
   *
   * Not a global and not a possession, but the guard a whole beat can hang off:
   * the chief engineer's turbine job is gated on `actorowner("csea")` walking
   * "none" → "helpme" → "helping" → "thanks1", and gang.cst reads it to decide
   * whether clicking him starts a conversation or opens the puzzle. A route that
   * cannot see it can only infer where it stands from whether the next gesture
   * happened to work.
   */
  actorOwner(name: string): string;
  /** settle, then record a beat in the trace the run is judged against */
  beat(name: string): Promise<void>;
  /** wait for the game to reach a state; throws naming `what` if it never does */
  waitFor(until: () => boolean, what: string): Promise<void>;
  /** progress, for a route worth watching */
  log?(message: string): void;
}
