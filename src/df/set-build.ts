/**
 * Building a SET room from nothing — the write side of [`set.ts`](set.ts)'s
 * reader, and the largest of these builders because a room is the largest thing
 * in the game's data. See [`build.ts`](build.ts) for why these modules exist.
 *
 * What a room is, in the order this assembles it:
 *
 *  - **views** — the directions you can look from one spot, each with its own
 *    hotspots (the clickable rectangles, stored Y-first);
 *  - **turn rings** — one frame register per direction of turn, alternating
 *    standpoints (`motion` 2, a view you can rest at) with in-motion frames
 *    (`motion` 0), wrapping all the way round;
 *  - **roads** — a pair of registers walking between two views, plus the record
 *    naming the two global view ids and the waypoints between them;
 *  - **actors** — where a character stands, each record carrying a nested
 *    secondary star that scripts can walk them to;
 *  - **the deck-plan maps**, lit and dark;
 *  - **the scene register**, 42 bytes a scene, tying each scene's views and rings
 *    together.
 *
 * Pictures are shared by identity: pass the same {@link SetArt} object to a view's
 * standpoint and to the ring frame that depicts it and the art is written once,
 * which is what the shipped files do (a turn ring's standpoint frame IS the view).
 */
import { ContainerBuilder, checkName, emptyScript, f64, i16, i32, paletteBlock, pstr } from "./build";
import { ContainerRef, DFContainerFile, writeContainerFile } from "./container";
import { encodeFrame, encodeZLayer } from "./image";

/** container 0 (the SCDO chunk) — the reader's own C0 table */
const C0 = {
  version: 0x02,
  mapLight: 0x18,
  mapDark: 0x1c,
  mapHeight: 0x24,
  mapWidth: 0x26,
  setDimensionsY: 0x2c,
  setDimensionsX: 0x2e,
  transitionRegister: 0x54,
  actorRegister: 0x58,
  mainScript: 0x5c,
  mainSceneRegister: 0x60,
  sceneCount: 0x64,
  setName: 0x70,
  viewPortWidth: 0x84,
  viewPortHeight: 0x86,
  palette: 0xf2,
  zLevelCount: 0x9fa,
  zFarMax: 0xa08,
  defaultSceneName: 0xa0e,
  defaultViewName: 0xa1e,
  size: 2612,
} as const;

/** a hotspot ("object") record */
const OBJECT = { first: 8, size: 36, rotation8: 4, top: 8, script: 16, identifier: 20 } as const;

/** a scene's view table: its world position, then a 46-byte record per view */
const VIEWS = { position: 0, count: 48, first: 52, size: 46 } as const;
const VIEW = { rotation: 0, rot8: 8, pairType: 10, height: 14, id: 22, objects: 26, name: 30 } as const;

/** a frame register: a destination views container, then 60-byte FrameInfo records */
const REGISTER = { count: 4, destination: 8, first: 12, size: 60 } as const;
const FRAMEINFO = { posX: 0, posZ: 8, posY: 16, axisX: 24, x: 32, z: 34, y: 36, deg: 38, motion: 40, frame: 44, viewID: 56 } as const;

/** a road's own record, and the table that lists roads */
const ROAD = { rotation8: 4, viewIDstart: 6, viewIDend: 10, from: 14, to: 38, name: 62, waypointCount: 78, waypoints: 82 } as const;
const ROADS = { count: 4, first: 8, size: 12 } as const;

/** the actor register: a count, then 54-byte records with a nested secondary */
const ACTORS = { count: 0, first: 8, size: 54 } as const;
const ACTOR = { rotation8: 4, x: 6, z: 8, y: 10, name: 12, secondary: 30 } as const;

/** the main scene register: 42 bytes a scene */
const SCENE = { size: 42, map: 4, views: 10, right: 14, left: 18, script: 22, name: 26 } as const;

/** the version tag `readSetFile` insists on */
const VERSION_4 = 4;

/** name fields, in characters (the length byte is not counted) */
const NAME_FIELD = 15;

/** `motion` values a ring frame can carry */
export const STANDPOINT = 2;
export const IN_MOTION = 0;

/** a picture in a set: the view pixels, plus the depth image that occludes actors */
export interface SetArt {
  pixels: Uint8Array;
  /** per-pixel depth levels; standpoints carry one, in-motion frames need not */
  depth?: Uint8Array;
}

export interface SetBuildHotspot {
  /** what a script's `me`/`target` says, and what the cursor code keys on */
  id: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** the heading the hotspot is authored at */
  rotation8?: number;
  /** the hotspot's own script; without one it is a bare region */
  script?: Uint8Array;
}

export interface SetBuildView {
  /** the view's name, as `currentview()` answers it (≤15 chars) */
  name: string;
  /** the heading, in radians */
  rotation: number;
  /** the same heading in the engine's 0..255 space */
  rot8: number;
  /** the GLOBAL view id — roads join views by these, across scenes */
  id: number;
  /** eye height */
  height?: number;
  hotspots?: SetBuildHotspot[];
}

export interface SetBuildFrame {
  art: SetArt;
  /** {@link STANDPOINT} for a view you can rest at, {@link IN_MOTION} between two */
  motion: number;
  /** which view this frame IS when it is a standpoint; -1 in motion */
  viewID: number;
  /** the heading depicted, 0..255 */
  deg: number;
  /** where the camera is; the scene's own position by default */
  position?: [number, number, number];
}

/** one direction of turning, or one direction of walking a road */
export interface SetBuildRing {
  /**
   * The scene whose view table this ring lands in, by index. A turn ring stays in
   * its own scene; a road's forward direction lands in the scene it leads to.
   */
  destinationScene: number;
  frames: SetBuildFrame[];
}

export interface SetBuildScene {
  /** the scene's name, as `currentscene()` answers it (≤15 chars) */
  name: string;
  /** the standpoint in world space, (x, z, y) */
  position: [number, number, number];
  /** where the scene sits on the deck plan, (x, z, y) */
  mapPoint: [number, number, number];
  views: SetBuildView[];
  /** turning right, and turning left — the two rings the arrow keys walk */
  right: SetBuildRing;
  left: SetBuildRing;
  /** the scene's script — `openscene`/`closescene` and its hotspot handlers */
  script?: Uint8Array;
}

export interface SetBuildRoad {
  /** the road's name (≤15 chars) */
  name: string;
  /** the global view ids the road joins */
  fromViewID: number;
  toViewID: number;
  /** the two endpoints in world space */
  from: [number, number, number];
  to: [number, number, number];
  waypoints?: [number, number, number][];
  rotation8?: number;
  /** the frames walked one way, and back */
  forward: SetBuildRing;
  back: SetBuildRing;
}

export interface SetBuildActor {
  /** the star's name, `"sasha.1"` style */
  name: string;
  rotation8: number;
  /** (x, z, y) in world space */
  position: [number, number, number];
  /** the nested secondary star a script can walk them to */
  secondary?: { name: string; rotation8: number; position: [number, number, number] };
}

export interface SetBuildOptions {
  /** the colour table, as RGB triples (up to 256 entries) */
  palette: ArrayLike<number>;
  /** the set's own stored name ("B59") */
  name: string;
  /** a room view's size — the top region of the screen, not the whole screen */
  viewWidth: number;
  viewHeight: number;
  /** the room's extent in world units, (x, y) */
  dimensions?: [number, number];
  scenes: SetBuildScene[];
  roads?: SetBuildRoad[];
  actors?: SetBuildActor[];
  /** the deck-plan images, lit and dark */
  maps?: { light: SetArt; dark: SetArt; width: number; height: number };
  /** the set main script — `openset`/`closeset`/`setupsound` */
  main?: Uint8Array;
  /** where the player arrives when nothing says otherwise */
  defaultScene?: string;
  defaultView?: string;
  /** the depth model: how many levels, and how far the farthest is */
  zLevelCount?: number;
  zFarMax?: number;
  /** dummy gap containers, as the shipped sets carry */
  gaps?: number;
}

export interface SetBuildResult {
  file: DFContainerFile;
  /** where each distinct picture landed — shared art appears once */
  artLocs: Map<SetArt, ContainerRef>;
}

/** Assemble a room. */
export function buildSetFile(opts: SetBuildOptions): SetBuildResult {
  const { scenes, viewWidth: w, viewHeight: h } = opts;
  if (!scenes.length) throw new Error("set: a set needs at least one scene");

  const b = new ContainerBuilder();
  const { data: c0 } = b.reserve(C0.size);
  const mainScript = b.add(opts.main ?? emptyScript());
  for (let g = 0; g < (opts.gaps ?? 0); g++) b.gap();

  // one container per distinct picture: a turn ring's standpoint frame IS the
  // view it depicts, so the same art arrives here more than once
  const artLocs = new Map<SetArt, ContainerRef>();
  const artLoc = (art: SetArt): ContainerRef => {
    let loc = artLocs.get(art);
    if (loc === undefined) {
      if (art.pixels.length < w * h) {
        throw new Error(`set: a picture is ${art.pixels.length} bytes, needs ${w * h}`);
      }
      const z = art.depth ? encodeZLayer(art.depth, w, h) : undefined;
      artLocs.set(art, (loc = b.add(encodeFrame(art.pixels, w, h, z))));
    }
    return loc;
  };

  const hotspotBlock = (hotspots: SetBuildHotspot[]): ContainerRef => {
    const d = new Uint8Array(OBJECT.first + hotspots.length * OBJECT.size);
    i32(d, 0, hotspots.length);
    hotspots.forEach((o, i) => {
      const at = OBJECT.first + i * OBJECT.size;
      i16(d, at + OBJECT.rotation8, o.rotation8 ?? 0);
      i16(d, at + OBJECT.top, o.top);
      i16(d, at + OBJECT.top + 2, o.left);
      i16(d, at + OBJECT.top + 4, o.bottom);
      i16(d, at + OBJECT.top + 6, o.right);
      i32(d, at + OBJECT.script, o.script ? b.add(o.script) : 0);
      pstr(d, at + OBJECT.identifier, o.id, NAME_FIELD);
    });
    return b.add(d);
  };

  const viewsBlock = (scene: SetBuildScene): ContainerRef => {
    // the hotspot containers first, so the view records can point at them
    const objectLocs = scene.views.map((v) =>
      v.hotspots?.length ? hotspotBlock(v.hotspots) : 0,
    );
    const d = new Uint8Array(VIEWS.first + scene.views.length * VIEWS.size);
    scene.position.forEach((p, i) => f64(d, VIEWS.position + i * 8, p));
    i32(d, VIEWS.count, scene.views.length);
    scene.views.forEach((v, i) => {
      checkName("set: view", v.name, NAME_FIELD);
      const at = VIEWS.first + i * VIEWS.size;
      f64(d, at + VIEW.rotation, v.rotation);
      i16(d, at + VIEW.rot8, v.rot8);
      i32(d, at + VIEW.pairType, 1);
      f64(d, at + VIEW.height, v.height ?? 1.75);
      i32(d, at + VIEW.id, v.id);
      i32(d, at + VIEW.objects, objectLocs[i]);
      pstr(d, at + VIEW.name, v.name, NAME_FIELD);
    });
    return b.add(d);
  };

  // every scene's views before any ring, because a ring points at one (its own,
  // or — for a road — the scene it leads to)
  const viewLocs = scenes.map(viewsBlock);

  const registerBlock = (ring: SetBuildRing, home: [number, number, number]): ContainerRef => {
    const destination = viewLocs[ring.destinationScene];
    if (destination === undefined) {
      throw new Error(`set: a register points at scene ${ring.destinationScene}, which does not exist`);
    }
    const locs = ring.frames.map((f) => artLoc(f.art));
    const d = new Uint8Array(REGISTER.first + ring.frames.length * REGISTER.size);
    i32(d, REGISTER.count, ring.frames.length);
    i32(d, REGISTER.destination, destination);
    ring.frames.forEach((f, i) => {
      const at = REGISTER.first + i * REGISTER.size;
      const [x, z, y] = f.position ?? home;
      f64(d, at + FRAMEINFO.posX, x);
      f64(d, at + FRAMEINFO.posZ, z);
      f64(d, at + FRAMEINFO.posY, y);
      f64(d, at + FRAMEINFO.axisX, (f.deg * Math.PI) / 128);
      i16(d, at + FRAMEINFO.x, x);
      i16(d, at + FRAMEINFO.z, z);
      i16(d, at + FRAMEINFO.y, y);
      i16(d, at + FRAMEINFO.deg, f.deg);
      i32(d, at + FRAMEINFO.motion, f.motion);
      i32(d, at + FRAMEINFO.frame, locs[i]);
      i32(d, at + FRAMEINFO.viewID, f.viewID);
    });
    return b.add(d);
  };

  const roads = opts.roads ?? [];
  const roadLocs = roads.map((road) => {
    const waypoints = road.waypoints ?? [];
    const d = new Uint8Array(ROAD.waypoints + waypoints.length * 24);
    i16(d, ROAD.rotation8, road.rotation8 ?? 0);
    i32(d, ROAD.viewIDstart, road.fromViewID);
    i32(d, ROAD.viewIDend, road.toViewID);
    road.from.forEach((p, i) => f64(d, ROAD.from + i * 8, p));
    road.to.forEach((p, i) => f64(d, ROAD.to + i * 8, p));
    pstr(d, ROAD.name, road.name, NAME_FIELD);
    i32(d, ROAD.waypointCount, waypoints.length);
    waypoints.forEach((wp, k) => wp.forEach((p, i) => f64(d, ROAD.waypoints + k * 24 + i * 8, p)));
    return {
      info: b.add(d),
      forward: registerBlock(road.forward, road.from),
      back: registerBlock(road.back, road.to),
    };
  });
  if (roadLocs.length) {
    const d = new Uint8Array(ROADS.first + roadLocs.length * ROADS.size);
    i32(d, ROADS.count, roadLocs.length);
    roadLocs.forEach((r, i) => {
      const at = ROADS.first + i * ROADS.size;
      i32(d, at, r.info);
      i32(d, at + 4, r.forward);
      i32(d, at + 8, r.back);
    });
    i32(c0, C0.transitionRegister, b.add(d));
  }

  const actors = opts.actors ?? [];
  if (actors.length) {
    const d = new Uint8Array(ACTORS.first + actors.length * ACTORS.size);
    i32(d, ACTORS.count, actors.length);
    actors.forEach((a, i) => {
      const at = ACTORS.first + i * ACTORS.size;
      i16(d, at + ACTOR.rotation8, a.rotation8);
      i16(d, at + ACTOR.x, a.position[0]);
      i16(d, at + ACTOR.z, a.position[1]);
      i16(d, at + ACTOR.y, a.position[2]);
      pstr(d, at + ACTOR.name, a.name, NAME_FIELD);
      if (a.secondary) {
        const s = a.secondary;
        i16(d, at + ACTOR.secondary, s.rotation8);
        i16(d, at + ACTOR.secondary + 2, s.position[0]);
        i16(d, at + ACTOR.secondary + 4, s.position[1]);
        i16(d, at + ACTOR.secondary + 6, s.position[2]);
        pstr(d, at + ACTOR.secondary + 8, s.name, NAME_FIELD);
      }
    });
    i32(c0, C0.actorRegister, b.add(d));
  }

  if (opts.maps) {
    i32(c0, C0.mapLight, artLoc(opts.maps.light));
    i32(c0, C0.mapDark, artLoc(opts.maps.dark));
    i16(c0, C0.mapHeight, opts.maps.height);
    i16(c0, C0.mapWidth, opts.maps.width);
  }

  // the scene register last: it names the rings, which had to exist first
  const sceneReg = new Uint8Array(scenes.length * SCENE.size);
  scenes.forEach((scene, i) => {
    checkName("set: scene", scene.name, NAME_FIELD);
    const at = i * SCENE.size;
    scene.mapPoint.forEach((p, k) => i16(sceneReg, at + SCENE.map + k * 2, p));
    i32(sceneReg, at + SCENE.views, viewLocs[i]);
    i32(sceneReg, at + SCENE.right, registerBlock(scene.right, scene.position));
    i32(sceneReg, at + SCENE.left, registerBlock(scene.left, scene.position));
    i32(sceneReg, at + SCENE.script, scene.script ? b.add(scene.script) : mainScript);
    pstr(sceneReg, at + SCENE.name, scene.name, NAME_FIELD);
  });

  i32(c0, C0.version, VERSION_4);
  i16(c0, C0.setDimensionsX, opts.dimensions?.[0] ?? 0);
  i16(c0, C0.setDimensionsY, opts.dimensions?.[1] ?? 0);
  i32(c0, C0.mainScript, mainScript);
  i32(c0, C0.mainSceneRegister, b.add(sceneReg));
  i32(c0, C0.sceneCount, scenes.length);
  pstr(c0, C0.setName, opts.name, NAME_FIELD);
  i16(c0, C0.viewPortWidth, w);
  i16(c0, C0.viewPortHeight, h);
  c0.set(paletteBlock(opts.palette), C0.palette);
  i16(c0, C0.zLevelCount, opts.zLevelCount ?? 32);
  i16(c0, C0.zFarMax, opts.zFarMax ?? 4096);
  pstr(c0, C0.defaultSceneName, opts.defaultScene ?? scenes[0].name, NAME_FIELD);
  pstr(c0, C0.defaultViewName, opts.defaultView ?? scenes[0].views[0]?.name ?? "", NAME_FIELD);

  return { file: b.finish(), artLocs };
}

/** {@link buildSetFile}, serialized */
export function buildSetBytes(opts: SetBuildOptions): Uint8Array {
  return writeContainerFile(buildSetFile(opts).file);
}
