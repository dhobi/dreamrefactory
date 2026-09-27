/**
 * Saving and loading a RedJack game: what the session puts into a `.save` and
 * takes out of one.
 *
 * *Prerequisite: [`../df/savegame-v5.ts`](../df/savegame-v5.ts), the byte format,
 * and [docs/engine/formats/savegame-v5.md](../../../docs/engine/formats/savegame-v5.md),
 * which says what RedJack.exe's writer puts in and its loader takes out.*
 *
 * The same division as Titanic's and Dust's: the format module knows the bytes,
 * this one knows the session. Two things differ from both.
 *
 *  - **It writes from nothing.** A v4 or v1 save is written by patching a real
 *    one, because those records hold fields nobody has mapped. No RedJack save
 *    exists to patch, and its loader copies most tables verbatim, so this fills
 *    every mapped field from the port's model and leaves the rest zero.
 *  - **The room being left is CLOSED.** RedJack.exe's loader tears the game down
 *    with the routine `quit` uses (0x439df0) before it reads anything, so the
 *    casts, shops, room, stage and puppet being left all hear their `close…`
 *    events. Then its resume (0x43dd80) rebuilds everything with no script
 *    running at all, which is what {@link GameSession.restoringV5} mutes.
 *
 * Files are addressed by basename, as everywhere in the port; a saved path is
 * `path (0)` then the name, which is how the engine writes one and how its loader
 * rebases one onto another install.
 */
import {
  REDJACK_SAVE_VERSION,
  SaveActorV5,
  SaveFileRef,
  SaveGameV5,
  SaveGlobalV5,
  SavePropV5,
  SaveTrackV5,
  TABLE,
  readSaveV5,
  saveVersionMatches,
  writeSaveV5,
} from "../df/savegame-v5";
import { decodeCrickets, decodeLoops, decodeWalks, encodeCrickets, encodeLoops, encodeWalks } from "./saveload-v5-tables";
import { toNum } from "./interp";
import { frameIndexForDegree } from "./props";
import type { GameSession } from "./session";

/**
 * Where a saved path says the game is installed, when the game never set slot
 * 0. The loader only uses it to rebase the paths, and the port finds files by
 * basename, so any prefix the paths share will do; this one reads like one.
 */
const HOME = "C:\\RedJack\\";

/** a saved path's basename, whichever separator the saving machine used */
const baseName = (path: string): string => path.slice(Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"), path.lastIndexOf(":")) + 1);

/** `name[3]` → `name`, 3; a plain name → itself, -1 */
function splitElement(key: string): { name: string; index: number } {
  const m = /^(.*)\[(\d+)\]$/.exec(key);
  return m ? { name: m[1], index: Number(m[2]) } : { name: key, index: -1 };
}

// ---- writing -------------------------------------------------------------------

/**
 * The bytes of a save of the running game, or null when there is no room open
 * to save (RedJack.exe saves only from inside the game).
 */
export function snapshotSaveV5(session: GameSession, version = REDJACK_SAVE_VERSION): Uint8Array | null {
  const maze = session.maze;
  const home = session.pathSlots[0] || HOME;
  const files: SaveFileRef[] = [];
  const handleOf = new Map<string, number>();
  const handle = (name: string): number => {
    if (!name) return 0;
    const key = name.toLowerCase();
    let h = handleOf.get(key);
    if (!h) {
      h = files.length + 1;
      handleOf.set(key, h);
      files.push({ handle: h, path: home + key });
    }
    return h;
  };

  const setFile = session.currentSetFile ? `${session.currentSetFile}.sett` : "";
  const casts = [...session.actorRuntime.casts.keys()].map((name) => ({ handle: handle(name), name: name.replace(/\.cast$/, "") }));
  const shops = [...session.propRuntime.shops.keys()].map((name) => ({ handle: handle(name), name: name.replace(/\.shop$/, "") }));
  const tracks: SaveTrackV5[] = session.audioLib.bankNames.map((name) => ({
    handle: handle(name),
    name: name.replace(/\.trak$/, ""),
    sounds: new Uint8Array(0),
    themes: new Uint8Array(0),
    order: new Uint8Array(0),
  }));
  const stageFile = session.stageCtrl.stageFile ? session.stageName : "";

  const actors: SaveActorV5[] = [...session.actorRuntime.actors.values()].map((a) => ({
    name: a.name || a.member.name,
    visible: a.visible,
    castHandle: handle(a.cast.name),
    member: a.member.logicLocation,
    is3d: a.worldSpace,
    true3d: a.true3d,
    deg: a.deg,
    pitch: 0,
    roll: 0,
    x: a.worldX,
    y: a.worldY,
    z: a.worldZ,
    turn: a.turn,
    speed: a.speed,
    scale: a.scale,
    value: toNum(a.value),
    zclip: a.zclip,
    snap: false,
    ink: a.ink,
    flip: a.flip,
    contrast: 0,
    brightness: 0,
    litby: 0,
    facer: false,
    set: a.setName,
    star: a.starName,
    pose: a.poseName,
    owner: String(a.owner),
  }));
  // `prophide ("all")` is in effect while any prop is hidden; the engine then
  // holds every prop one below its shown value (see SavePropV5.shown)
  const hiding = [...session.propRuntime.props.values()].some((p) => p.hidden);
  const props: SavePropV5[] = [...session.propRuntime.props.values()].map((p) => ({
    name: p.name,
    shown: (p.visible ? 1 : 0) - (p.hidden || (hiding && !p.visible) ? 1 : 0),
    shopHandle: handle(p.shop.name),
    member: p.group.location,
    is3d: p.worldSpace,
    true3d: p.true3d,
    deg: toNum(p.deg),
    pitch: p.pitch,
    roll: 0,
    // a screen prop's place is its anchor, a world prop's its point
    x: p.worldSpace ? p.worldX : p.anchorX,
    y: p.worldSpace ? p.worldY : p.anchorY,
    z: p.worldSpace ? p.worldZ : p.dist,
    scale: p.scale,
    value: toNum(p.value),
    zclip: p.zclip,
    snap: p.snap,
    ink: p.ink,
    flip: p.flip,
    contrast: 0,
    brightness: 0,
    litby: 0,
    facer: p.facer,
    set: p.setName,
    star: p.starName,
    view: p.stateName,
    owner: String(p.owner),
  }));

  // the globals, and not the permanents, which live in the BOOTFILE; nor the
  // port's own `__` bookkeeping. An array's elements are one node each.
  const sizes = new Map<string, number>();
  for (const key of session.interp.globals.keys()) {
    const { name, index } = splitElement(key);
    if (index >= 0) sizes.set(name.toLowerCase(), Math.max(sizes.get(name.toLowerCase()) ?? 0, index + 1));
  }
  const globals: SaveGlobalV5[] = [];
  for (const [key, value] of session.interp.globals) {
    const { name, index } = splitElement(key);
    const lower = name.toLowerCase();
    if (name.startsWith("__") || session.interp.permanents.has(lower)) continue;
    if (typeof value !== "number" && typeof value !== "string") continue;
    globals.push({ name, value, arraySize: index >= 0 ? sizes.get(lower) ?? 0 : 0, index: Math.max(0, index) });
  }

  const theme = session.currentThemeName && session.currentThemeName !== "none" ? session.currentThemeName : "";
  const themeTrack = theme ? session.audioLib.bankNames.find((b) => b.replace(/\.trak$/, "") === theme.toLowerCase()) : undefined;
  const walks = encodeWalks(session, handle);

  const save: SaveGameV5 = {
    version,
    disc: session.mountedCd,
    paths: session.pathSlots.map((p, i) => (i === 0 ? home : p)),
    files,
    themeTrack: themeTrack ? handle(themeTrack) : 0,
    soundTrack: 0,
    soundContainer: 0,
    runt: {
      frame: session.frameCounter,
      framerate: session.frameRate,
      setOpen: !!maze && !!setFile,
      setVisible: session.setVisible,
      setHandle: maze && setFile ? handle(setFile) : 0,
      setName: maze?.sett.name ?? "",
      scene: maze?.sceneName ?? "",
      view: maze?.view ?? "",
      deg: maze?.heading ?? 0,
      pitch: maze?.pitch ?? 0,
      roll: 0,
      fov: maze?.fov ?? 0,
      stageOpen: !!stageFile,
      stageHandle: handle(stageFile),
      stageName: stageFile.replace(/\.stag$/, ""),
      flat: Math.max(0, session.stageCtrl.stageFile?.flats.findIndex((f) => f.name.toLowerCase() === session.currentFlat.toLowerCase()) ?? 0),
    },
    actors,
    casts,
    props,
    shops,
    tracks,
    globals,
    loops: encodeLoops(session),
    crickets: encodeCrickets(session),
    walks: walks.table,
    routes: walks.routes,
    copies: new Uint8Array(TABLE.copies.slots * TABLE.copies.stride),
  };
  return writeSaveV5(save);
}

// ---- reading -------------------------------------------------------------------

/**
 * Load a `.save` into the session, as RedJack.exe's `opengame` does. False, with
 * the reason in the log, when the file is not a save of this version, and then
 * nothing has been touched.
 */
export async function loadGameV5(session: GameSession, bytes: Uint8Array, version = REDJACK_SAVE_VERSION): Promise<boolean> {
  let save: SaveGameV5;
  try {
    save = readSaveV5(bytes);
  } catch (e) {
    session.onLog(`opengame: ${(e as Error).message}`);
    return false;
  }
  if (!saveVersionMatches(save.version, version)) {
    session.onLog("opengame: This saved game is from a different version of this title.");
    return false;
  }
  const fileOf = new Map(save.files.map((f) => [f.handle, baseName(f.path).toLowerCase()]));
  const file = (h: number): string => fileOf.get(h) ?? "";
  session.onLog(
    `opengame: ${save.runt.setName || "no room"} at ${save.runt.scene || "?"}` +
      `${save.runt.stageOpen ? `, stage ${save.runt.stageName}` : ""}; ${save.actors.length} actors, ${save.props.length} props`,
  );

  // Past the point of no return: the scripts of the game being left stop at
  // their next statement, as Dust's and Titanic's loads do (#344).
  session.interp.abandonRunning();

  // ---- close the game being left, with its scripts (0x439df0) ----------------
  for (const cast of [...session.actorRuntime.casts.keys()]) await session.closeCastFile(cast);
  for (const shop of [...session.propRuntime.shops.keys()]) await session.closeShop(shop);
  if (session.maze) await session.maze.closeSet();
  if (session.stageCtrl.stageFile) await session.stageCtrl.closeStageFile();
  session.puppetCtrl.closePuppetFile();
  for (const bank of [...session.audioLib.bankNames]) session.audioLib.closeBank(bank);
  session.scheduler.reset();
  session.audio.halt("voice");
  session.audio.halt("theme");
  session.endWipe();
  session.onAbandonMovie?.();

  // ---- the state that is not a room ------------------------------------------
  // the globals the file names, and only those; permanents are the BOOTFILE's
  for (const key of [...session.interp.globals.keys()]) {
    const { name } = splitElement(key);
    if (name.startsWith("__") || session.interp.permanents.has(name.toLowerCase())) continue;
    session.interp.globals.delete(key);
  }
  for (const g of save.globals) {
    const key = g.arraySize > 0 ? session.interp.elementKey(g.name, g.index) : g.name;
    session.interp.globals.set(key, g.value);
  }
  session.frameCounter = save.runt.frame;
  if (save.runt.framerate) session.frameRate = save.runt.framerate;
  // path slots 1–8 are installed (0x43c7f0); slot 0 stays the running game's
  for (let i = 1; i < 9; i++) session.pathSlots[i] = save.paths[i] ?? "";
  if (save.disc) session.mountedCd = save.disc;

  // ---- the rebuild, with every script muted ----------------------------------
  session.restoringSave = true;
  try {
    for (const c of save.casts) await session.openCastFile(file(c.handle) || c.name);
    for (const s of save.shops) await session.openShop(file(s.handle) || s.name);
    for (const t of save.tracks) await session.openTrackFile(file(t.handle) || t.name);

    restoreActorsV5(session, save, file);
    restorePropsV5(session, save, file);
    decodeLoops(session, save.loops);
    decodeCrickets(session, save.crickets);
    decodeWalks(session, save.walks, save.routes, file);

    if (save.runt.setOpen) {
      const room = file(save.runt.setHandle) || `${save.runt.setName}.sett`;
      await session.openSetFile(room, save.runt.scene, save.runt.view === "node" ? "" : save.runt.view);
      const maze = session.maze;
      if (maze) {
        maze.setHeading(save.runt.deg);
        maze.setPitch(save.runt.pitch);
        if (save.runt.fov) maze.setFov(save.runt.fov);
      }
    }
    // opening the room shows it (0x43f8ed); the file says whether a stage hid it
    session.setVisible = save.runt.setVisible;
    if (save.runt.stageOpen) {
      await session.stageCtrl.openStageFile(file(save.runt.stageHandle) || save.runt.stageName);
      const flat = session.stageCtrl.stageFile?.flats[save.runt.flat]?.name;
      if (flat && flat.toLowerCase() !== session.currentFlat.toLowerCase()) await session.stageCtrl.gotoFlat(flat);
    }
  } finally {
    session.restoringSave = false;
  }

  // the theme starts again from its beginning (0x43e68c), not where it was
  const track = save.themeTrack ? file(save.themeTrack).replace(/\.trak$/, "") : "";
  const theme = track ? session.audioLib.theme(track) : null;
  if (theme) {
    session.audio.play("theme", theme, { loop: true });
    session.currentThemeName = track;
    const asked = session.volumeForTrack(track);
    session.setThemeVolume(asked ?? toNum(session.interp.globals.get("themevolume") ?? 255), track);
  }
  return true;
}

/**
 * The actor records, whole: every field the port models comes from the file.
 * An actor the reopened casts do not have is an `actorinstance` copy, and is
 * made again from the member its record names, as the scripts made it.
 */
function restoreActorsV5(session: GameSession, save: SaveGameV5, file: (h: number) => string): void {
  for (const r of save.actors) {
    let a = session.actorRuntime.get(r.name);
    if (!a) {
      const cast = session.actorRuntime.casts.get(file(r.castHandle));
      const src = cast?.cst.members.find((m) => m.logicLocation === r.member)?.name;
      if (!src || !session.actorRuntime.get(src)) {
        session.onLog(`opengame: no cast member to make "${r.name}" from — dropped`);
        continue;
      }
      session.actorRuntime.instance(src, r.name);
      session.instanceCastScript(src, r.name);
      a = session.actorRuntime.get(r.name);
      if (!a) continue;
    }
    a.visible = r.visible;
    a.worldSpace = r.is3d;
    a.true3d = r.true3d;
    a.deg = r.deg;
    a.worldX = r.x;
    a.worldY = r.y;
    a.worldZ = r.z;
    a.turn = r.turn;
    a.speed = r.speed;
    a.scale = r.scale;
    a.value = r.value;
    a.zclip = r.zclip;
    a.ink = r.ink;
    a.flip = r.flip;
    a.setName = r.set;
    a.starName = r.star;
    a.poseName = r.pose || "stand";
    a.owner = r.owner;
  }
}

/** the prop records, whole, and each prop's view entered as `propview` enters one */
function restorePropsV5(session: GameSession, save: SaveGameV5, file: (h: number) => string): void {
  // a prop below 0 is one a `prophide` took down from 0: one is in effect
  const hiding = save.props.some((r) => r.shown < 0);
  for (const r of save.props) {
    let p = session.propRuntime.get(r.name);
    if (!p) {
      // a `propinstance` copy: made again from the group its record names
      const shop = session.propRuntime.shops.get(file(r.shopHandle));
      const src = shop?.shp.groups.find((g) => g.location === r.member)?.name;
      if (src) session.propRuntime.instance(src, r.name, true);
      p = session.propRuntime.get(r.name);
    }
    if (!p) {
      session.onLog(`opengame: no prop "${r.name}" in the reopened shops — dropped`);
      continue;
    }
    // shown one above what the counter says while a `prophide` holds it down
    p.visible = r.shown + (hiding ? 1 : 0) > 0;
    p.hidden = hiding && p.visible;
    p.worldSpace = r.is3d;
    p.true3d = r.true3d;
    p.deg = r.deg;
    p.pitch = r.pitch;
    if (r.is3d) {
      p.worldX = r.x;
      p.worldY = r.y;
      p.worldZ = r.z;
    } else {
      p.anchorX = r.x;
      p.anchorY = r.y;
      p.dist = r.z;
    }
    p.scale = r.scale;
    p.value = r.value;
    p.zclip = r.zclip;
    p.snap = r.snap;
    p.ink = r.ink;
    p.flip = r.flip;
    p.facer = r.facer;
    p.setName = r.set;
    p.starName = r.star;
    p.owner = r.owner;
    p.stateName = r.view;
    p.lastTick = 0;
    p.frameLocked = false;
    p.frameOrder = null;
    const st = p.state();
    p.frameIdx = st && p.degVariants ? frameIndexForDegree(st, r.deg) : 0;
  }
}
