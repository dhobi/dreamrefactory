/**
 * Finding your way around inside one room.
 *
 * A trip out of a room (see shipgraph.ts) names the view you have to be
 * standing in. Getting there is turning and walking: a scene is a ring of
 * views you turn through, and roads join views across scenes. This module is
 * the graph search over that; the geometry it searches — {@link roadsAt} and
 * {@link turnRing} — comes from engine/src/df/set.ts, the same functions
 * SetViewer.turn/availableRoads use, so a planned route can't disagree with
 * what the viewer will actually do when asked.
 *
 * Plans are one gesture deep on purpose. Where a walk leaves you facing is
 * decided at arrival, from the direction of travel against the arrival scene's
 * view rotations (SetViewer.nearestView), so a multi-step plan would be
 * guessing after its first walk. The navigator re-plans from live state after
 * every gesture instead; a BFS over a few hundred standpoints is nothing.
 */
import { LEFTTURNS, RIGHTTURNS, roadsAt, turnRing } from "@dreamfactory/engine/df/set";
import type { Scene, SetFile } from "@dreamfactory/engine/df/set";

/**
 * The scene a walk from this standpoint arrives in, or -1 if there's no road.
 * Mirrors SetViewer.walk: the first road at the standpoint, and the arrival
 * scene from the register's `destination` (the arrival view table's container),
 * falling back to whichever scene owns the road's far end.
 */
export function walkArrival(set: SetFile, globalViewID: number): number {
  const roads = roadsAt(set, globalViewID);
  if (!roads.length) return -1;
  const { road, register, arriveViewID } = roads[0];
  const reg = road.frameRegisters[register];
  let sceneIdx = set.scenes.findIndex((s) => s.locationViews === reg.destination);
  if (sceneIdx < 0) sceneIdx = set.scenes.findIndex((s) => s.views.some((vw) => vw.viewID === arriveViewID));
  return sceneIdx;
}

export type Gesture = { kind: "turn"; dir: number } | { kind: "walk" };

export interface Standpoint {
  sceneIdx: number;
  viewIdx: number;
}

/**
 * Breadth-first search for the first gesture on a shortest path to a
 * standpoint the goal accepts — or `[]` if you are already there, or null if
 * no sequence of turns and walks gets there.
 *
 * A walk expands to EVERY view of the arrival scene, because which one you end
 * up facing isn't knowable here. That optimism is what makes the plan
 * one-gesture-deep rather than a promise; the caller re-plans on arrival.
 */
export function planWithin(
  set: SetFile,
  from: Standpoint,
  goal: (scene: Scene, viewIdx: number) => boolean,
  opts: {
    /**
     * View names (lowercase) where pressing up LEAVES the room — the
     * standpoints the exit trips are guarded on. A road and an exit can share
     * a standpoint, and the script wins: plan a walk there and you end up in
     * the next room, having to come back. The boat deck does this, and without
     * this the navigator paced between deckbd and decka forever.
     */
    avoidWalkFrom?: Set<string>;
    maxVisited?: number;
  } = {},
): Gesture[] | null {
  const maxVisited = opts.maxVisited ?? 4000;
  const avoid = opts.avoidWalkFrom ?? new Set<string>();
  if (goal(set.scenes[from.sceneIdx], from.viewIdx)) return [];
  const key = (s: Standpoint) => `${s.sceneIdx}:${s.viewIdx}`;
  const seen = new Set([key(from)]);
  const queue: { at: Standpoint; path: Gesture[] }[] = [{ at: from, path: [] }];
  let visited = 0;
  while (queue.length && visited++ < maxVisited) {
    const { at, path } = queue.shift()!;
    const scene = set.scenes[at.sceneIdx];
    if (!scene) continue;
    const next: { at: Standpoint; gesture: Gesture }[] = [];
    for (const dir of [RIGHTTURNS, LEFTTURNS]) {
      const turn = turnRing(scene, at.viewIdx, dir);
      if (turn && turn.target !== at.viewIdx) {
        next.push({ at: { sceneIdx: at.sceneIdx, viewIdx: turn.target }, gesture: { kind: "turn", dir } });
      }
    }
    const view = scene.views[at.viewIdx];
    if (view && !avoid.has(view.viewName.toLowerCase())) {
      const arrive = walkArrival(set, view.viewID);
      if (arrive >= 0) {
        for (let v = 0; v < set.scenes[arrive].views.length; v++) {
          next.push({ at: { sceneIdx: arrive, viewIdx: v }, gesture: { kind: "walk" } });
        }
      }
    }
    for (const n of next) {
      if (seen.has(key(n.at))) continue;
      const nextPath = [...path, n.gesture];
      if (goal(set.scenes[n.at.sceneIdx], n.at.viewIdx)) return nextPath;
      seen.add(key(n.at));
      queue.push({ at: n.at, path: nextPath });
    }
  }
  return null;
}

/** goal helper: a named view, optionally pinned to named scenes */
export function atStandpoint(views: string[], scenes: string[] = []) {
  const v = views.map((s) => s.toLowerCase());
  const sc = scenes.map((s) => s.toLowerCase());
  return (scene: Scene, viewIdx: number): boolean => {
    if (sc.length && !sc.includes(scene.sceneName.toLowerCase())) return false;
    const name = scene.views[viewIdx]?.viewName?.toLowerCase();
    return !!name && v.includes(name);
  };
}
