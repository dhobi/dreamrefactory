/**
 * A playthrough's observable state, sampled at a story beat.
 *
 * The point of this is to make a scripted playthrough assert itself. The plot
 * lives entirely in script globals (see docs/04-mission-flow.md) — `mission`,
 * `phase`, and ~140 sub-plot state machines — so a snapshot of the globals
 * table plus the room you're standing in and who owns what IS the game state.
 * Record it once per beat, diff a later run against the recording, and a
 * divergence points at the beat that caused it instead of surfacing three
 * missions later as a missing door.
 *
 * That's the difference between authoring a playthrough as inputs (a click
 * route, which is short) and as expectations (a per-step assertion list, which
 * is not).
 *
 * The same function serves the headless run and the browser one — main.ts
 * exposes it on `dbg` — so the two traces are comparable by construction
 * rather than by two hand-written snapshotters agreeing.
 */
import type { Value } from "./interp";
import type { GameSession } from "./session";

/** the slice of SetViewer a trace needs — kept structural so the engine
 *  doesn't depend on the renderer */
export interface TraceViewer {
  viewIdx: number;
  scene: { sceneName: string; views: { viewName: string }[] };
}

export interface StateTrace {
  /** the beat this was sampled at, e.g. "3. london flat" */
  beat: string;
  set: string;
  scene: string;
  view: string;
  theme: string;
  /** 0 = fully visible, 1 = black — a beat sampled mid-fade isn't settled */
  fade: number;
  /** every script global, key-sorted */
  globals: Record<string, Value>;
  /** props with an owner, key-sorted (the unowned majority is noise) */
  props: Record<string, Value>;
  /** actors with an owner, key-sorted */
  actors: Record<string, Value>;
}

/** key-sorted so two traces serialize identically */
function sorted(entries: [string, Value][]): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [k, v] of entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) out[k] = v;
  return out;
}

/** owned = the script put something there; "" and "none" are the defaults */
function owned(m: Map<string, { owner: Value }>): [string, Value][] {
  return [...m].filter(([, v]) => v.owner !== "" && v.owner !== "none").map(([k, v]) => [k, v.owner]);
}

export function snapshotState(session: GameSession, viewer: TraceViewer | null, beat: string): StateTrace {
  return {
    beat,
    set: session.currentSetName,
    scene: viewer?.scene?.sceneName ?? "none",
    view: viewer?.scene?.views[viewer.viewIdx]?.viewName ?? "none",
    theme: session.currentThemeName,
    fade: session.fade.level,
    globals: sorted([...session.interp.globals]),
    props: sorted(owned(session.propRuntime.props)),
    actors: sorted(owned(session.actorRuntime.actors)),
  };
}

/** stable text for a golden file / a byte-for-byte diff between two runs */
export function formatTrace(trace: StateTrace[]): string {
  return JSON.stringify(trace, null, 2) + "\n";
}
