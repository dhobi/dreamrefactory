// writeName: a pascal name clamped to its field and to what the container holds
import { writeNameAt as writeName } from "./binary";
import { patchContainerData } from "./container";
import { ACTOR, C0, OBJECT, SCENE_ENTRY, SetFile, TRANSITION_INFO, VIEW } from "./set";

/**
 * Edits — the write path of the set editor (editors/sets.html). The runtime
 * only reads sets (engine/src/df/set.ts); everything that writes one back lives here.
 *
 * Every edit is a copy-on-write patch on ONE container: the names, the hotspot
 * rectangles and the actor placements all live in the register/table containers,
 * not in the frames, so an export carries the bytes of everything untouched (see
 * taoot/tests/auto/set-editor.ts). Frame art is replaced by the caller, which swaps a
 * whole container for an `encodeFrame` result.
 */

/** characters that fit each name field (the byte before them is the length) */
export const SET_NAME_FIELD = 19;
export const SCENE_NAME_FIELD = 15;
export const VIEW_NAME_FIELD = 15;
export const OBJECT_ID_FIELD = 15;
export const TRANSITION_NAME_FIELD = 15;
export const DEFAULT_NAME_FIELD = 15;

/**
 * Copy-on-write one container and hand it to `edit`. Containers are subarray
 * views into the loaded file's buffer, which must stay pristine, so the patch
 * replaces the container it touches with a copy; the result serializes through
 * writeContainerFile (engine/src/df/container.ts) with only those bytes changed. False for a
 * container that isn't there (or is a gap) — the register said it was.
 */
function patchContainer(set: SetFile, loc: number, edit: (d: Uint8Array) => void): boolean {
  if (!patchContainerData(set.file, loc, edit)) return false;
  // the palette is a window into container 0, which the copy just replaced
  if (loc === 0) {
    const d = set.file.containers[0].data;
    set.paletteRaw = d.subarray(C0.palette, C0.palette + 256 * 8);
  }
  return true;
}

const i16 = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v)));

/** the set's name — what a script's `changeset` names this room by */
export function patchSetName(set: SetFile, name: string): string {
  let stored = set.setName;
  patchContainer(set, 0, (d) => {
    stored = writeName(d, C0.setName, name, SET_NAME_FIELD);
  });
  set.setName = stored;
  return stored;
}

/** the standpoint and facing a fresh load of this set starts on */
export function patchDefaultStart(
  set: SetFile,
  sceneName: string,
  viewName: string,
): { scene: string; view: string } {
  const stored = { scene: set.defaultSceneName, view: set.defaultViewName };
  patchContainer(set, 0, (d) => {
    stored.scene = writeName(d, C0.defaultSceneName, sceneName, DEFAULT_NAME_FIELD);
    stored.view = writeName(d, C0.defaultViewName, viewName, DEFAULT_NAME_FIELD);
  });
  set.defaultSceneName = stored.scene;
  set.defaultViewName = stored.view;
  return stored;
}

/** a scene's name, in the main scene register — the set's own label for a
 *  standpoint (`defaultSceneName` and the scripts' `gotoscene` match on it) */
export function patchSceneName(set: SetFile, sceneIdx: number, name: string): string {
  const scene = set.scenes[sceneIdx];
  if (!scene) return "";
  let stored = scene.sceneName;
  patchContainer(set, set.mainSceneRegister, (d) => {
    stored = writeName(d, scene.record + SCENE_ENTRY.identifier, name, SCENE_NAME_FIELD);
  });
  scene.sceneName = stored;
  return stored;
}

/** a view's name, in its scene's view table (`gotoview`/`defaultViewName`) */
export function patchViewName(
  set: SetFile,
  sceneIdx: number,
  viewIdx: number,
  name: string,
): string {
  const scene = set.scenes[sceneIdx];
  const view = scene?.views[viewIdx];
  if (!view) return "";
  let stored = view.viewName;
  patchContainer(set, scene.locationViews, (d) => {
    stored = writeName(d, view.record + VIEW.identifier, name, VIEW_NAME_FIELD);
  });
  view.viewName = stored;
  return stored;
}

/** a hotspot's identifier — the name its own script sees as the clicked object */
export function patchObjectIdentifier(
  set: SetFile,
  sceneIdx: number,
  viewIdx: number,
  objIdx: number,
  identifier: string,
): string {
  const view = set.scenes[sceneIdx]?.views[viewIdx];
  const obj = view?.objects[objIdx];
  if (!view || !obj) return "";
  let stored = obj.identifier;
  patchContainer(set, view.locationObjects, (d) => {
    stored = writeName(d, obj.record + OBJECT.identifier, identifier, OBJECT_ID_FIELD);
  });
  obj.identifier = stored;
  return stored;
}

/**
 * A hotspot's clickable rectangle, in view pixels. Stored Y-first
 * (top, left, bottom, right) — see the reader's readObjects; callers pass the
 * corners by name so the axis order stays in one place.
 */
export function patchObjectRegion(
  set: SetFile,
  sceneIdx: number,
  viewIdx: number,
  objIdx: number,
  region: { startX: number; startY: number; endX: number; endY: number },
): boolean {
  const view = set.scenes[sceneIdx]?.views[viewIdx];
  const obj = view?.objects[objIdx];
  if (!view || !obj) return false;
  // the parsed entry is what the editor draws from, so it is updated with the
  // bytes — under the field names it reads them back as
  const next = {
    startRegionX: i16(region.startX),
    startRegionY: i16(region.startY),
    endRegionX: i16(region.endX),
    endRegionY: i16(region.endY),
  };
  const ok = patchContainer(set, view.locationObjects, (d) => {
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const at = obj.record + OBJECT.regionYStart;
    v.setInt16(at, next.startRegionY, true);
    v.setInt16(at + 2, next.startRegionX, true);
    v.setInt16(at + 4, next.endRegionY, true);
    v.setInt16(at + 6, next.endRegionX, true);
  });
  if (ok) Object.assign(obj, next);
  return ok;
}

/** an actor/star placement: where a character stands and which name a
 *  script's `walkonpath`/`placestar` reaches it by */
export function patchActor(
  set: SetFile,
  actorIdx: number,
  fields: {
    identifier?: string;
    rotation8?: number;
    positionX?: number;
    positionZ?: number;
    positionY?: number;
  },
): boolean {
  const actor = set.actors[actorIdx];
  if (!actor) return false;
  const next = {
    rotation8: i16(fields.rotation8 ?? actor.rotation8),
    positionX: i16(fields.positionX ?? actor.positionX),
    positionZ: i16(fields.positionZ ?? actor.positionZ),
    positionY: i16(fields.positionY ?? actor.positionY),
  };
  let identifier = actor.identifier;
  const ok = patchContainer(set, set.actorRegister, (d) => {
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    v.setInt16(actor.record, next.rotation8, true);
    v.setInt16(actor.record + ACTOR.positionX, next.positionX, true);
    v.setInt16(actor.record + ACTOR.positionX + 2, next.positionZ, true);
    v.setInt16(actor.record + ACTOR.positionX + 4, next.positionY, true);
    if (fields.identifier !== undefined) {
      identifier = writeName(d, actor.record + ACTOR.identifier, fields.identifier, actor.idLimit);
    }
  });
  if (ok) Object.assign(actor, next, { identifier });
  return ok;
}

/** a road's name — the label the HUD shows for the walk leaving a standpoint */
export function patchTransitionName(set: SetFile, roadIdx: number, name: string): string {
  const road = set.transitions[roadIdx];
  if (!road) return "";
  let stored = road.transitionName;
  patchContainer(set, road.locationTransitionInfo, (d) => {
    stored = writeName(d, TRANSITION_INFO.identifier, name, TRANSITION_NAME_FIELD);
  });
  road.transitionName = stored;
  return stored;
}
