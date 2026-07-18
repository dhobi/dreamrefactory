import { BinaryReader } from "./binary";
import { Container, DFContainerFile, readContainerFile } from "./container";

/**
 * SET file structures — port of DFset (dfet/libs/DFfile/DFset/*.cpp),
 * DreamFactory version 4.0 (Titanic: Adventure Out of Time).
 *
 * A Set is a room/section. It has Scenes (standpoints), each Scene has
 * Views (directions you can face) plus full 360° turn-frame rings, and
 * Transitions ("roads") connect scenes with walk animation frames.
 */

export interface FrameInfo {
  posX: number;
  posZ: number;
  posY: number;
  /** horizontal camera rotation, radians */
  axisX: number;
  posX16: number;
  posZ16: number;
  posY16: number;
  axisX8: number;
  /** 0 = in-motion frame, 1 = low-res standpoint, 2 = hi-res standpoint */
  motionInfo: number;
  frameContainerLoc: number;
  framePairID: number;
  transitionLog: number;
  /** index into the scene's view table, -1 = unnamed */
  viewID: number;
}

export interface TurnRegister {
  destination: number;
  frames: FrameInfo[];
}

export interface ObjectEntry {
  rotation8: number;
  startRegionX: number;
  startRegionY: number;
  endRegionX: number;
  endRegionY: number;
  locationScript: number;
  identifier: string;
}

export interface SceneView {
  /** radians */
  rotation: number;
  rotation8: number;
  viewPairType: number;
  viewID: number;
  locationObjects: number;
  viewName: string;
  objects: ObjectEntry[];
}

export interface Scene {
  index: number;
  sceneName: string;
  xAxisMap: number;
  zAxisMap: number;
  yAxisMap: number;
  locationViews: number;
  locationScript: number;
  sceneLocation: [number, number, number];
  views: SceneView[];
  /** [RIGHTTURNS, LEFTTURNS] — full turn ring in each direction */
  turns: [TurnRegister, TurnRegister];
}

export interface Transition {
  locationTransitionInfo: number;
  viewIDstart: number;
  viewIDend: number;
  start: [number, number, number];
  end: [number, number, number];
  transitionName: string;
  waypoints: [number, number, number][];
  /** [0]: frames A→B, [1]: frames B→A (per dfet writeAllFrames naming) */
  frameRegisters: [TurnRegister, TurnRegister];
}

export interface Actor {
  rotation8: number;
  positionX: number;
  positionZ: number;
  positionY: number;
  identifier: string;
}

export interface SetFile {
  file: DFContainerFile;
  setName: string;
  defaultSceneName: string;
  defaultViewName: string;
  viewPortWidth: number;
  viewPortHeight: number;
  mapLight: number;
  mapDark: number;
  mapWidth: number;
  mapHeight: number;
  setDimensionsX: number;
  setDimensionsY: number;
  mainScript: number;
  /** raw 2048-byte palette block ({i16 index, i16 rgb[3]} * 256) */
  paletteRaw: Uint8Array;
  /** SET frames only use the first 128 palette entries */
  colorCount: number;
  scenes: Scene[];
  transitions: Transition[];
  actors: Actor[];
}

export const RIGHTTURNS = 0;
export const LEFTTURNS = 1;

function readTurnRegister(c: Container): TurnRegister {
  const r = new BinaryReader(c.data);
  r.skip(4); // unknownInt
  const frameCount = r.i32();
  const destination = r.i32();
  const frames: FrameInfo[] = [];
  for (let i = 0; i < frameCount; i++) {
    const base = r.pos;
    frames.push({
      posX: r.f64be(),
      posZ: r.f64be(),
      posY: r.f64be(),
      axisX: r.f64be(),
      posX16: r.i16(),
      posZ16: r.i16(),
      posY16: r.i16(),
      axisX8: r.i16(),
      motionInfo: r.i32(),
      frameContainerLoc: r.i32(),
      framePairID: r.i32(),
      transitionLog: r.i32(),
      viewID: r.i32(),
    });
    r.seek(base + 60);
  }
  return { destination, frames };
}

function readObjects(c: Container): ObjectEntry[] {
  const r = new BinaryReader(c.data);
  const objectCount = r.i32();
  r.skip(4); // unknownInt
  const objects: ObjectEntry[] = [];
  for (let i = 0; i < objectCount; i++) {
    r.skip(4); // unknownInt
    const rotation8 = r.i16();
    r.skip(2); // unknownShort2
    const startRegionX = r.i16();
    const startRegionY = r.i16();
    const endRegionX = r.i16();
    const endRegionY = r.i16();
    const locationScript = r.i32();
    const identifier = r.pstr(15);
    objects.push({
      rotation8,
      startRegionX,
      startRegionY,
      endRegionX,
      endRegionY,
      locationScript,
      identifier,
    });
  }
  return objects;
}

function readScene(index: number, containers: Container[], mainSceneRegister: number): Scene {
  // 42-byte entry per scene in the main scene register
  const r = new BinaryReader(containers[mainSceneRegister].data, index * 42);
  r.skip(4); // unknownDWORD1
  const xAxisMap = r.i16();
  const zAxisMap = r.i16();
  const yAxisMap = r.i16();
  const locationViews = r.i32();
  const locRight = r.i32();
  const locLeft = r.i32();
  const locationScript = r.i32();
  const sceneName = r.pstr();

  // view table container
  const vr = new BinaryReader(containers[locationViews].data);
  const sceneLocation: [number, number, number] = [vr.f64be(), vr.f64be(), vr.f64be()];
  vr.seek(48);
  const viewCount = vr.i32();
  const views: SceneView[] = [];
  for (let i = 0; i < viewCount; i++) {
    const rotation = vr.f64be();
    const rotation8 = vr.i16();
    const viewPairType = vr.i32();
    vr.f64be(); // unknownDB2
    const viewID = vr.i32();
    const locationObjects = vr.i32();
    const viewName = vr.pstr(15);
    views.push({
      rotation,
      rotation8,
      viewPairType,
      viewID,
      locationObjects,
      viewName,
      objects: locationObjects ? readObjects(containers[locationObjects]) : [],
    });
  }

  return {
    index,
    sceneName,
    xAxisMap,
    zAxisMap,
    yAxisMap,
    locationViews,
    locationScript,
    sceneLocation,
    views,
    turns: [readTurnRegister(containers[locRight]), readTurnRegister(containers[locLeft])],
  };
}

function readTransitions(containers: Container[], transitionRegister: number): Transition[] {
  const r = new BinaryReader(containers[transitionRegister].data);
  r.skip(4); // unknownInt
  const count = r.i32();
  const transitions: Transition[] = [];
  for (let road = 0; road < count; road++) {
    const locationTransitionInfo = r.i32();
    const locationSceneA = r.i32();
    const locationSceneB = r.i32();
    r.skip(4); // unknownShort1/2

    const ri = new BinaryReader(containers[locationTransitionInfo].data);
    ri.skip(4); // unknownInt
    ri.skip(2); // rotation8
    const viewIDstart = ri.i32();
    const viewIDend = ri.i32();
    const start: [number, number, number] = [ri.f64be(), ri.f64be(), ri.f64be()];
    const end: [number, number, number] = [ri.f64be(), ri.f64be(), ri.f64be()];
    const transitionName = ri.pstr(15);
    const entriesCount = ri.i32();
    const waypoints: [number, number, number][] = [];
    for (let e = 0; e < entriesCount; e++) {
      waypoints.push([ri.f64be(), ri.f64be(), ri.f64be()]);
    }

    transitions.push({
      locationTransitionInfo,
      viewIDstart,
      viewIDend,
      start,
      end,
      transitionName,
      waypoints,
      frameRegisters: [
        readTurnRegister(containers[locationSceneA]),
        readTurnRegister(containers[locationSceneB]),
      ],
    });
  }
  return transitions;
}

function readActors(c: Container): Actor[] {
  const r = new BinaryReader(c.data);
  const count = r.i32();
  r.skip(4); // unknownInt
  const actors: Actor[] = [];
  for (let i = 0; i < count; i++) {
    r.skip(4); // unknownInt
    const rotation8 = r.i16();
    const positionX = r.i16();
    const positionZ = r.i16();
    const positionY = r.i16();
    const identifier = r.pstr(41);
    actors.push({ rotation8, positionX, positionZ, positionY, identifier });
  }
  return actors;
}

export function readSetFile(data: Uint8Array): SetFile {
  const file = readContainerFile(data);
  const containers = file.containers;
  const c0 = containers[0].data;
  const r = new BinaryReader(c0);

  r.seek(0x02);
  const version = r.i32();
  if (version !== 4) {
    throw new Error(`Unsupported DreamFactory SET version ${version} (only 4.0 is supported)`);
  }

  r.seek(0x18);
  const mapLight = r.i32();
  const mapDark = r.i32();
  r.skip(4);
  const mapHeight = r.i16();
  const mapWidth = r.i16();
  r.skip(4);
  const setDimensionsY = r.i16();
  const setDimensionsX = r.i16();
  r.skip(16);
  r.f64be(); // setDimensionsYf
  r.f64be(); // setDimensionsXf

  const sceneRegister = r.i32();
  const transitionRegister = r.i32();
  const actorRegister = r.i32();
  const mainScript = r.i32();
  const mainSceneRegister = r.i32();
  const sceneCount = r.i32();
  r.skip(8); // unknown 0x68 / 0x6C
  const setName = r.pstr();
  void sceneRegister;

  r.seek(0x84);
  const viewPortWidth = r.i16();
  const viewPortHeight = r.i16();
  r.skip(5 * 8 + 3 * 4); // coords, rotations, 3 unknown floats
  r.skip(3 * 18); // 3 unknown data entries

  const paletteRaw = c0.subarray(r.pos, r.pos + 256 * 8);
  r.skip(256 * 8);
  r.pstr(255); // secondaryRefName
  r.skip(8 + 6 + 8);
  r.skip(2); // setDimensionsY_2
  r.skip(4); // heightDifference
  const defaultSceneName = r.pstr(15);
  const defaultViewName = r.pstr();

  const scenes: Scene[] = [];
  for (let s = 0; s < sceneCount; s++) {
    scenes.push(readScene(s, containers, mainSceneRegister));
  }

  return {
    file,
    setName,
    defaultSceneName,
    defaultViewName,
    viewPortWidth,
    viewPortHeight,
    mapLight,
    mapDark,
    mapWidth,
    mapHeight,
    setDimensionsX,
    setDimensionsY,
    mainScript,
    paletteRaw,
    colorCount: 128,
    scenes,
    transitions: readTransitions(containers, transitionRegister),
    actors: readActors(containers[actorRegister]),
  };
}
