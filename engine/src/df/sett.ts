import { pstrAt } from "./binary";
import { DFContainerFile, readContainerFile } from "./container";

/**
 * A DreamFactory 5 room — RedJack's `.sett` — read into what its viewer needs:
 * the nodes you stand at, the spheres you look around from each, the roads
 * between them and the films that walk them, and the "quads" you can click.
 *
 * Every v5 container opens with 24 bytes of its own (`00 00 05 00`, a fourCC
 * written backwards, zeroes); offsets below are from the container's first
 * byte, prefix included.
 *
 * ## The index (MAZE, MAPR)
 *
 * Container 0 is the MAZE, container 1 the set's main script and container 2
 * its MAPR — on all 41 rooms, and MAZE says so at 0x64/0x68. MAPR is the
 * automap and the one table that lists everything: 64-byte records from 0x2c,
 * as many as the counts at 0x10, 0x14 and 0x18 add up to, each typed by the u16
 * at +2 — 1 a scene (SCEN), 2 a node, 0 a road.
 *
 *   node  +4 x, +8 y, +12 z (i32, world × 10⁵ — the camera's own units)
 *         +16 NODE, +20 SPHR, +28 script, +32 name (16-byte pstr)
 *   scene +4 x, +8 y, +12 z, +16 SCEN, +20 and +24 its two turning films,
 *         +28 script, +32 name
 *   road  +8, +12 the ids of the two nodes or scene views it joins, +16 ROAD,
 *         +20 and +24 its two films (one each way), +32 name
 *
 * A NODE carries its id at 0x30 (what a road names it by) and its name again at
 * 0x58; nothing in it lists its exits — those are the films whose far end is
 * somewhere else.
 *
 * ## The scene (SCEN)
 *
 * A place with no sphere: you stand at one of a few fixed views and turn
 * between them on film. The count of views is at 0x48 and 56-byte records
 * follow from 0x4c (`0x434440` and `0x444ee0` step them by 0x38):
 *
 *   view  +4 the road film that leaves ahead (0 for none — `roadahead`),
 *         +8 heading (double, radians), +16 the same in {@link TURN} units,
 *         +32 its id (what a road names it by), +40 name (16-byte pstr)
 *
 * The last record is cut short of its padding. The scene's two films each
 * turn the camera once round on the spot — the first clockwise (`currentscene
 * ("right")`, heading falling), the second the other way — and each frame
 * carries at +100 the index of the view it shows, or -1 between views
 * (RedJack.exe's `0x434b00` stops a turn on the first frame it reaches whose
 * mark is a view). Standing at a view shows the first frame of the second film
 * marked with it (`0x434550`).
 *
 * ## The sphere (SPHR)
 *
 * A quadtree of 256×256 equirectangular tiles: the count at 0x24, 56-byte
 * patches from 0x28 — 8 bytes, then the patch's centre longitude and latitude
 * and its half-extent (doubles, radians), the picture and a depth map
 * (containers), and four children (patch indices, -1 for none; top-left,
 * top-right, bottom-left, bottom-right). Latitude runs 0 at the zenith to π at
 * the nadir; the root's half-extent is π, so its tile covers 2π of latitude and
 * only the top half of it is picture. Each tile carries its own palette.
 *
 * The camera's heading looks down longitude **π − heading**. That is not read
 * out of the renderer (which is hand-written assembly); it is what makes a
 * sphere agree with the films that leave it — every road film's first frame is a
 * picture taken from its node, and projecting the node's sphere at the frame's
 * own heading and field of view reproduces all six of shed.sett's to within two
 * grey levels, with no offset left over.
 *
 * ## The films (CMOV)
 *
 * The destination NODE at 0x14, the frame count at 0x1c, and 112-byte frames
 * from 0x2c — the camera as RedJack.exe's `0x435490` copies it into its globals:
 * position (3 doubles), heading, pitch, roll, fov (doubles, radians), the
 * position again as i32s at +56, the heading, pitch, roll and fov as the
 * scripts' angles at +68..+80 ({@link TURN}), the picture at +88 and a scene
 * film's view mark at +100. A road that ends in a scene names its SCEN at 0x20
 * instead of a NODE at 0x14. The last frame may be cut short of its trailing
 * words.
 *
 * ## The stars (MARK)
 *
 * The points props and actors are put on: the count at 0x18 and 66-byte
 * records from 0x20, each holding one star and room for a second — a point
 * (three i32, the camera's units) at +6 and its name (16-byte pstr) at +0x12,
 * and, when the i32 at +0x22 is not 0, a second point at +0x26 named at +0x32.
 * RedJack.exe's `0x444550` looks a name up in that order, the first name of a
 * record before its second. The file may run on past the last record.
 *
 * ## The quads (BLI3)
 *
 * The things a click can find: the count at 0x18, 80-byte records from 0x20
 * (`0x446190` steps by 0x50 and compares the name at +0x1c), the script at +8,
 * and from +0x2c the geometry `0x497160` projects — a w × h rectangle in its own
 * plane, pitched by the double at +0x40, turned by the one at +0x38, and set
 * down at the i32 point at +0x2c, in the camera's frame (see
 * engine/src/web/maze-view.ts for the axes).
 */

/** a full turn in the scripts' angle units: `degmask(-1)` is TURN - 1 */
export const TURN = 1 << 24;

export interface SphrPatch {
  lon: number;
  lat: number;
  half: number;
  picture: number;
  depth: number;
  kids: number[];
}

export interface MazeNode {
  name: string;
  id: number;
  node: number;
  sphere: number;
  script: number;
  /** i32 world × 10⁵, as the camera takes it */
  x: number;
  y: number;
  z: number;
}

export interface MazeFilmFrame {
  picture: number;
  x: number;
  y: number;
  z: number;
  /** radians */
  heading: number;
  pitch: number;
  roll: number;
  fov: number;
  /** the same four in {@link TURN} units */
  headDeg: number;
  pitchDeg: number;
  rollDeg: number;
  fovDeg: number;
  /** on a scene's turning film, the index of the view this frame shows; else -1 */
  view: number;
}

export interface MazeFilm {
  container: number;
  /** the NODE container it arrives at, 0 for none */
  to: number;
  /** the SCEN container it arrives at, 0 for none */
  toScene: number;
  frames: MazeFilmFrame[];
}

export interface MazeSceneView {
  name: string;
  id: number;
  /** the film ahead, which `currentscene ("strait")` walks */
  road: MazeFilm | null;
  /** {@link TURN} units */
  heading: number;
}

/** a scene: views to stand at, and two films to turn between them */
export interface MazeScene {
  name: string;
  scen: number;
  script: number;
  x: number;
  y: number;
  z: number;
  /** clockwise ("right") first, then anticlockwise ("left") */
  films: MazeFilm[];
  views: MazeSceneView[];
}

export interface MazeRoad {
  name: string;
  a: number;
  b: number;
  road: number;
  films: MazeFilm[];
}

export interface MazeQuad {
  name: string;
  script: number;
  x: number;
  y: number;
  z: number;
  /** radians */
  heading: number;
  pitch: number;
  w: number;
  h: number;
}

/** a named point a prop or an actor is put on (`propstar`, `actorstar`) */
export interface MazeStar {
  name: string;
  /** i32 world × 10⁵, as the camera's */
  x: number;
  y: number;
  z: number;
}

export interface SettFile {
  file: DFContainerFile;
  name: string;
  mainScript: number;
  nodes: MazeNode[];
  scenes: MazeScene[];
  roads: MazeRoad[];
  quads: MazeQuad[];
  /** in MARK's order, which is the order `propstar` looks them up in */
  stars: MazeStar[];
  /** the first node or scene in MAPR's order — where a room opened without one starts */
  first: string;
  /**
   * MAZE 0x10a: how far away a sprite can be and still be drawn, less its
   * `propzclip`/`actorzclip`. RedJack.exe copies it out as the room opens
   * (0x43f95a) and each sprite's placement drops one at or past it (0x42cb7e
   * for props, 0x406cc2 for actors) — 1,350,000 in most rooms.
   */
  far: number;
}

const tagOf = (d: Uint8Array): string =>
  d.length >= 8 ? String.fromCharCode(d[7], d[6], d[5], d[4]) : "";

const view = (d: Uint8Array): DataView => new DataView(d.buffer, d.byteOffset, d.byteLength);

/** is this a DreamFactory 5 room? (container 0 is a MAZE) */
export function isSett(data: Uint8Array): boolean {
  if (data.length < 1028) return false;
  const pos = view(data).getUint32(1024, true);
  return data[pos + 8 + 2] === 5 && String.fromCharCode(...data.subarray(pos + 12, pos + 16)) === "EZAM";
}

export function readSettFile(data: Uint8Array): SettFile {
  const file = readContainerFile(data);
  const c = (i: number): Uint8Array | undefined => file.containers[i]?.data;
  const maze = c(0);
  if (!maze || tagOf(maze) !== "MAZE") throw new Error("not a DreamFactory 5 room: no MAZE");
  const mv = view(maze);
  const name = pstrAt(maze, 0x74);
  const mainScript = mv.getInt32(0x64, true);
  const far = mv.getInt32(0x10a, true);
  const mapr = c(mv.getInt32(0x68, true));
  if (!mapr || tagOf(mapr) !== "MAPR") throw new Error(`${name}: no MAPR`);
  const pv = view(mapr);
  // scenes, nodes and roads, counted at 0x10/0x14/0x18
  // and typed by the u16 at +2 (1, 2, 0). The last record is often cut short of
  // its padding, so a record is read if its name fits.
  const total = pv.getInt32(0x10, true) + pv.getInt32(0x14, true) + pv.getInt32(0x18, true);
  const nodes: MazeNode[] = [];
  const scenes: MazeScene[] = [];
  const roads: MazeRoad[] = [];
  let first = "";
  for (let i = 0; i < total; i++) {
    const r = 0x2c + i * 64;
    if (r + 48 > mapr.length) break;
    const kind = pv.getUint16(r + 2, true);
    if (kind === 1) {
      const scen = pv.getInt32(r + 16, true);
      const sc = c(scen);
      if (!sc || tagOf(sc) !== "SCEN") continue;
      const sv = view(sc);
      const views: MazeSceneView[] = [];
      for (let k = 0; k < sv.getInt32(0x48, true); k++) {
        const at = 0x4c + k * 0x38;
        if (at + 0x29 > sc.length) break;
        views.push({
          name: pstrAt(sc, at + 0x28),
          id: sv.getInt32(at + 0x20, true),
          road: readFilm(file, sv.getInt32(at + 4, true)),
          heading: sv.getInt32(at + 0x10, true),
        });
      }
      scenes.push({
        name: pstrAt(mapr, r + 32),
        scen,
        script: pv.getInt32(r + 28, true),
        x: pv.getInt32(r + 4, true),
        y: pv.getInt32(r + 8, true),
        z: pv.getInt32(r + 12, true),
        films: [20, 24].map((at) => readFilm(file, pv.getInt32(r + at, true))).filter((f): f is MazeFilm => !!f),
        views,
      });
      first ||= scenes[scenes.length - 1].name;
    } else if (kind === 2) {
      const node = pv.getInt32(r + 16, true);
      const nd = c(node);
      if (!nd || tagOf(nd) !== "NODE") continue;
      nodes.push({
        name: pstrAt(mapr, r + 32),
        id: view(nd).getInt32(0x30, true),
        node,
        sphere: pv.getInt32(r + 20, true),
        script: pv.getInt32(r + 28, true),
        x: pv.getInt32(r + 4, true),
        y: pv.getInt32(r + 8, true),
        z: pv.getInt32(r + 12, true),
      });
      first ||= nodes[nodes.length - 1].name;
    } else if (kind === 0) {
      const road = pv.getInt32(r + 16, true);
      if (tagOf(c(road) ?? new Uint8Array()) !== "ROAD") continue;
      const films: MazeFilm[] = [];
      for (const at of [20, 24]) {
        const film = readFilm(file, pv.getInt32(r + at, true));
        if (film) films.push(film);
      }
      roads.push({
        name: pstrAt(mapr, r + 32),
        a: pv.getInt32(r + 8, true),
        b: pv.getInt32(r + 12, true),
        road,
        films,
      });
    }
  }

  const quads: MazeQuad[] = [];
  for (const { data: d } of file.containers) {
    if (tagOf(d) !== "BLI3") continue;
    const qv = view(d);
    const n = qv.getInt32(0x18, true);
    for (let i = 0; i < n; i++) {
      const r = 0x20 + i * 0x50;
      if (r + 0x50 > d.length) break;
      quads.push({
        name: pstrAt(d, r + 0x1c),
        script: qv.getInt32(r + 8, true),
        x: qv.getInt32(r + 0x2c, true),
        y: qv.getInt32(r + 0x30, true),
        z: qv.getInt32(r + 0x34, true),
        heading: qv.getFloat64(r + 0x38, true),
        pitch: qv.getFloat64(r + 0x40, true),
        w: qv.getInt32(r + 0x48, true),
        h: qv.getInt32(r + 0x4c, true),
      });
    }
  }

  const stars: MazeStar[] = [];
  for (const { data: d } of file.containers) {
    if (tagOf(d) !== "MARK") continue;
    const mv = view(d);
    const n = mv.getInt32(0x18, true);
    for (let i = 0; i < n; i++) {
      const r = 0x20 + i * 0x42;
      if (r + 0x42 > d.length) break;
      const at = (o: number, name: string): MazeStar => ({
        name,
        x: mv.getInt32(o, true),
        y: mv.getInt32(o + 4, true),
        z: mv.getInt32(o + 8, true),
      });
      stars.push(at(r + 6, pstrAt(d, r + 0x12)));
      if (mv.getInt32(r + 0x22, true)) stars.push(at(r + 0x26, pstrAt(d, r + 0x32)));
    }
  }

  return { file, name, mainScript, nodes, scenes, roads, quads, stars, first, far };
}

function readFilm(file: DFContainerFile, container: number): MazeFilm | null {
  const d = file.containers[container]?.data;
  if (!d || tagOf(d) !== "CMOV") return null;
  const v = view(d);
  const n = v.getInt32(0x1c, true);
  const frames: MazeFilmFrame[] = [];
  for (let i = 0; i < n; i++) {
    const r = 0x2c + i * 112;
    if (r + 92 > d.length) break;
    frames.push({
      picture: v.getInt32(r + 88, true),
      x: v.getInt32(r + 56, true),
      y: v.getInt32(r + 60, true),
      z: v.getInt32(r + 64, true),
      heading: v.getFloat64(r + 24, true),
      pitch: v.getFloat64(r + 32, true),
      roll: v.getFloat64(r + 40, true),
      fov: v.getFloat64(r + 48, true),
      headDeg: v.getInt32(r + 68, true),
      pitchDeg: v.getInt32(r + 72, true),
      rollDeg: v.getInt32(r + 76, true),
      fovDeg: v.getInt32(r + 80, true),
      view: r + 104 <= d.length ? v.getInt32(r + 100, true) : -1,
    });
  }
  return { container, to: v.getInt32(0x14, true), toScene: v.getInt32(0x20, true), frames };
}

/** a sphere's patches, root first */
export function readSphere(file: DFContainerFile, container: number): SphrPatch[] {
  const d = file.containers[container]?.data;
  if (!d || tagOf(d) !== "SPHR") return [];
  const v = view(d);
  const n = v.getInt32(0x24, true);
  const out: SphrPatch[] = [];
  for (let i = 0; i < n; i++) {
    const r = 0x28 + i * 56;
    if (r + 56 > d.length) break;
    out.push({
      lon: v.getFloat64(r + 8, true),
      lat: v.getFloat64(r + 16, true),
      half: v.getFloat64(r + 24, true),
      picture: v.getInt32(r + 32, true),
      depth: v.getInt32(r + 36, true),
      kids: [0, 1, 2, 3].map((k) => v.getInt32(r + 40 + k * 4, true)),
    });
  }
  return out;
}

/** the films that leave a node, in road order — its exits, 1-based in the scripts */
export function exitsOf(sett: SettFile, node: MazeNode): MazeFilm[] {
  const out: MazeFilm[] = [];
  for (const road of sett.roads) {
    if (road.a !== node.id && road.b !== node.id) continue;
    for (const f of road.films) if (f.to !== node.node && f.frames.length) out.push(f);
  }
  return out;
}
