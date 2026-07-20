import { SetFile, Scene, FrameInfo, Transition, ObjectEntry, RIGHTTURNS, LEFTTURNS } from "./df/set";
import { FrameBuffer, decodeFrame, paletteToRGBA, indexedToRGBA } from "./df/image";
import { decodeShpFrame } from "./df/shp";
import { PUP_LAYERS } from "./df/pup";
import { MovFrame, readMovFile } from "./df/mov";
import { Container } from "./df/container";
import { decodeAudioContainer } from "./df/audio";
import { SetScripts } from "./engine/setscripts";
import { GameSession } from "./engine/session";

/** font for drawstring() text (wireless morse readout, CTL direction keys) —
 *  a fixed-pitch face reads like the period teletype/terminal. Used for both
 *  measuring (stringwidth) and painting so pen advance matches the glyphs. */
const overlayFont = (size: number): string => `${size}px "Courier New", monospace`;

/**
 * Navigation state machine over a parsed SET file.
 *
 * Frames are delta-encoded against whatever was decoded before them, so all
 * frames are pre-decoded once in dfet's extraction order (per scene: right
 * ring then left ring; then per road: both directions) and cached as indexed
 * pixel snapshots keyed by container index.
 */

interface CachedFrame {
  pixels: Uint8Array;
  width: number;
  height: number;
  /** per-pixel depth levels (0..24) from the frame's Z image, if present */
  z?: Uint8Array;
}

const FRAME_MS = 90; // ~11 fps for turn/walk animation, close to the original feel

/** smallest absolute difference between two angles in radians */
function angularDistance(a: number, b: number): number {
  const TAU = Math.PI * 2;
  let d = (a - b) % TAU;
  if (d < 0) d += TAU;
  return Math.min(d, TAU - d);
}

export class SetViewer {
  readonly set: SetFile;
  private palette: Uint8ClampedArray;
  /** full 256-entry set palette — props colorize through the set's CLUT */
  private propPalette: Uint8ClampedArray;
  private cache = new Map<number, CachedFrame>();

  sceneIdx = 0;
  viewIdx = 0; // index into scene.views
  showMap = false;
  showHotspots = false;

  private animation: CachedFrame[] | null = null;
  private animationPos = 0;
  private animationDone: (() => void) | null = null;
  private lastTick = 0;
  private current: CachedFrame | null = null;

  /** active movie playback (cutscene / object close-up) */
  private movie: {
    fileName: string;
    frames: CachedFrame[];
    /** frame types/regions/targets — the movie's own state machine */
    meta: MovFrame[];
    /** frame name (lowercase) -> index, for jump targets */
    frameByName: Map<string, number>;
    /** named event-sound chunks: name (lowercase) -> container location */
    sounds: Map<string, number>;
    containers: Container[];
    hasRegions: boolean;
    palette: Uint8ClampedArray;
    pos: number;
    /** ms per frame; 0 = wait for clicks (click-through object movies) */
    interval: number;
    lastTick: number;
  } | null = null;
  /** cross-movie return stack (type-4 call / type-5 return, TI.EXE depth 5) */
  private movieStack: { movie: string; frame: number }[] = [];

  onHud: (text: string) => void = () => {};
  onLog: (line: string) => void = () => {};
  readonly scripts: SetScripts;

  readonly session: GameSession;

  constructor(set: SetFile, session: GameSession, startScene = "", startView = "") {
    this.set = set;
    this.session = session;
    this.palette = paletteToRGBA(set.paletteRaw, set.colorCount);
    this.propPalette = paletteToRGBA(set.paletteRaw, 256);
    this.scripts = new SetScripts(set, session);
    this.scripts.onLog = (l) => this.onLog(l);
    session.currentSceneName = () => this.scene.sceneName.toLowerCase();
    session.currentViewName = () => this.scene.views[this.viewIdx].viewName.toLowerCase();
    session.currentRotation = () => this.scene.views[this.viewIdx].rotation;
    // canonical set identity = the opened file's basename (see SetScripts)
    session.propRuntime.currentSet = session.currentSetName;
    session.actorRuntime.currentSet = session.currentSetName;
    // crickets attenuate/pan against the camera's ground position + facing
    session.listener = () => {
      const sc = this.scene;
      const v = sc?.views[this.viewIdx];
      return v ? { x: sc.xAxisMap, y: sc.zAxisMap, deg: v.rotation8 } : null;
    };
    session.captureFrame = () => {
      const f = this.current;
      if (!f) return null;
      const rgba = new Uint8ClampedArray(f.width * f.height * 4);
      indexedToRGBA(f.pixels, f.width, f.height, this.palette, rgba);
      return { rgba, width: f.width, height: f.height };
    };
    session.onPlayMovie = (name, startFrame) => void this.playMovie(name, startFrame);
    // stringwidth() measures against the same font drawTextOverlay paints with
    if (typeof document !== "undefined") {
      const mctx = document.createElement("canvas").getContext("2d");
      if (mctx) {
        session.measureText = (text, size) => {
          mctx.font = overlayFont(size);
          return mctx.measureText(text).width;
        };
      }
    }
    this.predecodeAll();
    this.jumpToDefault();
    if (startScene) this.jumpTo(startScene, startView);
    // auto-load sibling resources (the boot script does this in the real game)
    const base = set.setName.toLowerCase();
    for (const bank of [`${base}.trk`, `${base}.sfx`, `${base}.11k`, "unilib.trk"]) {
      const data = session.files(bank);
      if (data) session.audioLib.openBank(bank, data);
    }
    if (session.audioLib.bankNames.length) {
      this.onLog(`audio banks: ${session.audioLib.bankNames.join(", ")}`);
    } else {
      this.onLog(
        `no audio banks — drop UNILIB.TRK and ${base.toUpperCase()}.TRK/.SFX alongside the .SET to hear sound`,
      );
    }
  }

  /**
   * Fire the set's opening lifecycle (openset → openscene). Separate from
   * the constructor because handlers can suspend (delay) or change the set
   * again — the host awaits this from its onSetChange hook.
   */
  async start(): Promise<void> {
    await this.scripts.openSet();
    await this.scripts.openShop(`${this.set.setName.toLowerCase()}.shp`);
    await this.scripts.openScene(this.sceneIdx);
  }

  /** position at a named scene/view (case-insensitive), e.g. from changeset() */
  jumpTo(sceneName: string, viewName = ""): boolean {
    const s = this.set.scenes.findIndex(
      (sc) => sc.sceneName.toLowerCase() === sceneName.toLowerCase(),
    );
    if (s < 0) return false;
    const scene = this.set.scenes[s];
    let v = viewName
      ? scene.views.findIndex((vw) => vw.viewName.toLowerCase() === viewName.toLowerCase())
      : -1;
    if (v < 0 && viewName) {
      // authored view names can be stale (gstair3 changeset targets the
      // typo "view79" in scene65): keep the current facing direction, the
      // same continuity rule road arrival uses. Across a set change the
      // previous viewer's facing is carried in session.lastRotation.
      const rot = this.session.lastRotation ?? this.scene?.views[this.viewIdx]?.rotation;
      this.session.lastRotation = null;
      if (rot !== undefined && rot !== null) {
        let best = Infinity;
        scene.views.forEach((vw, i) => {
          const d = angularDistance(vw.rotation, rot);
          if (d < best) {
            best = d;
            v = i;
          }
        });
      }
    }
    this.sceneIdx = s;
    this.viewIdx = v >= 0 ? v : 0;
    this.showView();
    return true;
  }

  /**
   * Keyboard event into the script chain. Boot's default keydown performs
   * walking/turning itself via the currentscene() setter (onNavigate), so
   * the return value covers both "a script exitcoded" and "we navigated".
   */
  async keyDown(keyName: string): Promise<boolean> {
    if (this.inputLocked) return false;
    // a full-screen overlay stage (the deck map) handles keys itself — page
    // decks with arrows/letters — instead of the world turn/walk navigation
    const target = this.session.keydownTarget();
    if (!this.session.setVisible && target) {
      try {
        await this.session.interp.runHandler(target, "keydown", [keyName], {
          me: target.name,
          target: "",
        });
      } catch (e) {
        this.onLog(`stage keydown: ${(e as Error).message}`);
      }
      return true;
    }
    let navigated = false;
    this.session.onNavigate = (dir) => {
      navigated = true;
      if (dir === "strait") this.walk();
      else if (dir === "left") this.turn(LEFTTURNS);
      else if (dir === "right") this.turn(RIGHTTURNS);
    };
    const consumed = await this.scripts.keyDown(this.sceneIdx, keyName);
    this.session.onNavigate = () => {};
    return consumed || navigated;
  }

  /**
   * Play a MOV file full-screen. With a soundtrack, frames pace themselves
   * over its duration; without one, clicks step through the frames
   * (object close-ups like inspection views).
   */
  playMovie(fileName: string, startFrame = 0): boolean {
    const data = this.session.files(fileName.toLowerCase());
    if (!data) {
      this.onLog(`playmovie: "${fileName}" not available`);
      return false;
    }
    let mov;
    try {
      mov = readMovFile(data);
    } catch (e) {
      this.onLog(`playmovie: ${fileName}: ${(e as Error).message}`);
      return false;
    }
    // frames are delta-encoded: decode all in order
    const fb = new FrameBuffer();
    const frames: CachedFrame[] = [];
    for (const f of mov.frames) {
      const d = decodeFrame(mov.file.containers[f.locationFrame], fb);
      frames.push({
        pixels: fb.pixels.slice(0, d.width * d.height),
        width: d.width,
        height: d.height,
      });
    }
    if (!frames.length) return false;

    const regions = mov.frames.map((f) => f.regions);
    const hasRegions = regions.some((r) => r.length > 0);

    // plain cutscenes play their soundtrack once; in interactive movies the
    // audio chunks are per-click event sounds instead — silence until a click
    let audioSec = 0;
    if (!hasRegions && mov.audioChunks.length) {
      const parts = mov.audioChunks.map((loc) => decodeAudioContainer(mov.file.containers[loc]));
      const total = parts.reduce((a, p) => a + p.samples.length, 0);
      const samples = new Float32Array(total);
      let off = 0;
      for (const p of parts) {
        samples.set(p.samples, off);
        off += p.samples.length;
      }
      const sampleRate = Math.max(...parts.map((p) => p.sampleRate));
      audioSec = total / sampleRate;
      this.session.audio.play("voice", { sampleRate, samples });
    }

    // pacing: soundtrack duration when present; otherwise animate at a
    // default rate if there are pause frames, else pure click-through
    // 145 ms/frame measured from FAUCET.MOV: Brook Babbling (3.62 s) spans
    // exactly its 25 water frames. But audio may be a short one-shot SFX, not a
    // pacing track — bombopen.mov's latch click (~0.4 s) over 22 frames would
    // otherwise play the suitcase opening at ~50 fps. Floor at a native movie
    // rate (~15 fps): audio can only make frames SLOWER (faucet stays 145 ms),
    // never faster than the floor. The soundtrack still plays once from frame 0.
    const NATIVE_FRAME_MS = 66; // ~15 fps
    const interval =
      audioSec > 0
        ? Math.max(NATIVE_FRAME_MS, (audioSec * 1000) / frames.length)
        : hasRegions ? 145 : 0;
    const frameByName = new Map<string, number>();
    mov.frames.forEach((f, i) => f.name && frameByName.set(f.name.toLowerCase(), i));
    this.movie = {
      fileName: fileName.toLowerCase(),
      frames,
      meta: mov.frames,
      frameByName,
      sounds: mov.sounds,
      containers: mov.file.containers,
      hasRegions,
      palette: paletteToRGBA(mov.paletteRaw, 256),
      pos: Math.min(Math.max(startFrame, 0), frames.length - 1),
      interval,
      lastTick: 0,
    };
    this.onLog(
      `movie: ${fileName} (${frames.length} frames${audioSec ? `, ${audioSec.toFixed(1)}s audio` : ""}${hasRegions ? ", interactive" : ""})`,
    );
    return true;
  }

  get moviePlaying(): boolean {
    return this.movie !== null;
  }

  /** click during a movie: only region frames react (modal wait) */
  private movieClick(x: number, y: number): void {
    const m = this.movie;
    if (!m) return;
    // pure click-through movies (no regions anywhere): any click steps
    if (!m.hasRegions) {
      if (m.interval === 0) {
        m.pos++;
        if (m.pos >= m.frames.length) this.endMovie();
      }
      return;
    }
    const regions = m.meta[m.pos].regions;
    if (!regions.length) return; // animation in flight
    const region = regions.find(
      (r) =>
        x >= Math.min(r.x0, r.x1) && x <= Math.max(r.x0, r.x1) &&
        y >= Math.min(r.y0, r.y1) && y <= Math.max(r.y0, r.y1),
    );
    this.onLog(
      `movie click (${x},${y}) frame ${m.pos}${region ? ` -> type ${region.type} "${region.target || region.event}"` : " (no region hit)"}`,
    );
    if (!region) return;
    if (region.sound) this.playMovieSound(region.sound);
    m.lastTick = 0;
    this.movieAction(region.type, region.target, region.event);
  }

  /** event sounds live in the movie's own chunk table, banks as fallback */
  private playMovieSound(name: string): void {
    const m = this.movie;
    if (!m) return;
    const loc = m.sounds.get(name.toLowerCase());
    const snd = loc !== undefined
      ? decodeAudioContainer(m.containers[loc])
      : this.session.audioLib.sound(name);
    if (snd) this.session.audio.play("sound", snd);
  }

  /** move playback to a frame, firing its entry sound (faucet on/off…) */
  private movieEnter(idx: number): void {
    const m = this.movie!;
    m.pos = idx;
    const sound = m.meta[idx].sound;
    if (sound) this.playMovieSound(sound);
  }

  /**
   * Apply a type-code action (region click or region-less frame). Codes from
   * TI.EXE's movie loop: 1 exit · 2 goto target · 3 chain to event movie ·
   * 4 call event movie (resume at target on return) · 5 return · 6/7 step.
   */
  private movieAction(type: number, target: string, event: string): void {
    const m = this.movie!;
    switch (type) {
      case 2: {
        const idx = m.frameByName.get(target.toLowerCase());
        if (idx === undefined) {
          this.onLog(`movie: no frame named "${target}"`);
          this.endMovie();
        } else {
          this.movieEnter(idx);
        }
        return;
      }
      case 3:
      case 4: {
        if (type === 4) {
          const idx = m.frameByName.get(target.toLowerCase());
          if (idx !== undefined && this.movieStack.length < 5) {
            this.movieStack.push({ movie: m.fileName, frame: idx });
          }
        }
        this.endMovie();
        if (event) this.session.onPlayMovie(event);
        return;
      }
      case 5: {
        const ret = this.movieStack.pop();
        this.endMovie();
        if (ret) this.session.onPlayMovie(ret.movie, ret.frame);
        return;
      }
      case 6:
        if (m.pos + 1 < m.frames.length) this.movieEnter(m.pos + 1);
        else this.endMovie();
        return;
      case 7:
        if (m.pos > 0) this.movieEnter(m.pos - 1);
        return;
      default:
        this.endMovie(); // 1 = exit
    }
  }

  /** clock tick on a region-less frame: run the frame's own auto-action */
  private movieAdvance(): void {
    const m = this.movie;
    if (!m) return;
    const f = m.meta[m.pos];
    this.movieAction(f.type, f.target, f.event);
  }

  private endMovie(): void {
    this.movie = null;
    this.session.audio.halt("voice");
    // Reveal whatever the movie transitioned to. blackscreen() paints the
    // screen black one-shot before an intro movie (bomb's openstage:
    // blackscreen -> playmovie("bombopen.mov") -> setvisible(false) with no
    // blacktoscreen to follow); in our retained renderer that left fade.level
    // pinned at 1, so the flat stayed black after the movie. When no animated
    // fade is in progress (a queued screentoblack/blacktoscreen owns the
    // level, e.g. spotmovie's postmovie), clear the one-shot black now.
    if (!this.session.fade.queue.length && !this.session.fade.snapshot) {
      this.session.fade.level = 0;
    }
    this.showView();
  }

  /** start looping background music if a theme bank is available */
  startTheme(): void {
    // Authentic theme control lives in BOOTFILE setupsound(), which openset
    // runs from viewer.start(): it plays the DECK theme (recept1c -> deckd.trk,
    // halla -> decka.trk — the track is named by deck, not by set) and, just
    // as important, LEAVES the theme untouched when the deck is unchanged, so
    // same-deck travel (halla -> lnghall) keeps decka.trk playing seamlessly.
    // Don't fight it: never replace an already-playing theme, and never fall
    // back to "any loaded bank" (that bleeds inven/unilib over the room). Only
    // best-effort start the set-named bank on a cold start with nothing
    // playing; setupsound corrects it a frame later if the deck track differs.
    if (this.session.currentThemeName !== "none") return;
    const key = `${this.set.setName.toLowerCase()}.trk`;
    const theme = this.session.audioLib.theme(key);
    if (theme) {
      this.session.audio.play("theme", theme, { loop: true });
      this.session.currentThemeName = key;
    }
  }

  /** wire a file added after construction (audio bank or this set's shop) */
  addResource(name: string, data: Uint8Array): boolean {
    const key = name.toLowerCase();
    if (/\.(trk|sfx|11k)$/.test(key)) {
      if (this.session.audioLib.openBank(key, data)) {
        this.onLog(`audio bank opened: ${key}`);
        return true;
      }
      return false;
    }
    if (key === `${this.set.setName.toLowerCase()}.shp`) {
      void this.session.track(this.scripts.openShop(key));
      return true;
    }
    return false;
  }

  private predecodeAll(): void {
    const fb = new FrameBuffer();
    const snap = (fi: FrameInfo) => {
      if (!fi.frameContainerLoc || this.cache.has(fi.frameContainerLoc)) {
        // still decode duplicates? dfet decodes every reference in order; a
        // container referenced twice decodes to the same image the second
        // time only if it is not a delta. Keep the first decode, but run the
        // decoder anyway so the delta chain for subsequent frames stays intact.
        if (fi.frameContainerLoc) decodeFrame(this.set.file.containers[fi.frameContainerLoc], fb);
        return;
      }
      const d = decodeFrame(this.set.file.containers[fi.frameContainerLoc], fb);
      this.cache.set(fi.frameContainerLoc, {
        pixels: fb.pixels.slice(0, d.width * d.height),
        width: d.width,
        height: d.height,
        // the SET Z image occludes world sprites (actors) behind scenery
        z: d.hasZ ? fb.zPixels.slice(0, d.width * d.height) : undefined,
      });
    };
    for (const scene of this.set.scenes) {
      for (const dir of [RIGHTTURNS, LEFTTURNS] as const) {
        for (const fi of scene.turns[dir].frames) snap(fi);
      }
    }
    for (const road of this.set.transitions) {
      for (const reg of road.frameRegisters) {
        for (const fi of reg.frames) snap(fi);
      }
    }
  }

  private jumpToDefault(): void {
    const s = this.set.scenes.findIndex((sc) => sc.sceneName === this.set.defaultSceneName);
    this.sceneIdx = s >= 0 ? s : 0;
    const scene = this.scene;
    const v = scene.views.findIndex((vw) => vw.viewName === this.set.defaultViewName);
    this.viewIdx = v >= 0 ? v : 0;
    this.showView();
  }

  get scene(): Scene {
    return this.set.scenes[this.sceneIdx];
  }

  /** re-emit the HUD line for the current view (e.g. after wiring onHud) */
  refreshHud(): void {
    this.showView();
  }

  get globalViewID(): number {
    return this.scene.views[this.viewIdx].viewID;
  }

  /** the standpoint frame of the current view (from the right-turn ring) */
  private standFrame(): CachedFrame | null {
    const ring = this.scene.turns[RIGHTTURNS].frames;
    const fi = ring.find((f) => f.viewID === this.viewIdx && f.motionInfo > 0) ?? null;
    return fi ? (this.cache.get(fi.frameContainerLoc) ?? null) : null;
  }

  private showView(): void {
    this.current = this.standFrame();
    const v = this.scene.views[this.viewIdx];
    const roads = this.availableRoads();
    this.onHud(
      `${this.set.setName} — ${this.scene.sceneName} / ${v.viewName}` +
        (roads.length ? `  ·  ↑ ${roads.map((r) => r.road.transitionName).join(", ")}` : "") +
        (v.objects.length ? `  ·  ${v.objects.length} hotspot(s)` : ""),
    );
  }

  /**
   * Engine-side busy: something visual is in flight. Checked by walk/turn —
   * deliberately WITHOUT scriptBusy, because the engine default movement is
   * itself invoked from inside a running script (boot's keydown).
   */
  get busy(): boolean {
    return (
      this.animation !== null ||
      this.movie !== null ||
      (this.session.puppet?.visible ?? false) || // conversation in progress
      this.session.fading
    );
  }

  /** gate for NEW user input: also waits for running/suspended scripts */
  get inputLocked(): boolean {
    return this.busy || this.session.scriptBusy;
  }

  /**
   * the current view's depth map for occluding world sprites behind scenery.
   * scale (units/level) = zFarMax / zLevelCount from the SET's SCDO chunk.
   */
  private occlusion(): import("./engine/actors").Occlusion | null {
    const f = this.current;
    if (!f || !f.z) return null;
    const levels = this.set.zLevelCount || 24;
    const scale = this.set.zFarMax / levels;
    if (!(scale > 0)) return null;
    return { z: f.z, w: f.width, h: f.height, scale, levels };
  }

  /** camera of the current view, for world-space (propxyz) props */
  worldCamera(): import("./engine/props").WorldCamera | null {
    const sc = this.scene;
    const v = sc?.views[this.viewIdx];
    if (!v) return null;
    const w = this.set.viewPortWidth || 512;
    const h = this.set.viewPortHeight || 264;
    // the view's stand frame carries the camera's true world position
    // (posX16/posZ16/posY16) — scale-free across sets (C73 is 150 units/m,
    // DECKBD 55/m; the old cameraHeight×512 only held for C73's scale and
    // floated deck cameras 2-3× too high). Vista views ride the same ring.
    const fi = sc.turns[RIGHTTURNS].frames.find(
      (f) => f.viewID === this.viewIdx && f.motionInfo > 0,
    );
    return {
      x: fi ? fi.posX16 : sc.xAxisMap,
      y: fi ? fi.posZ16 : sc.zAxisMap,
      z: fi ? fi.posY16 : Math.round(v.cameraHeight * 512),
      deg: v.rotation8,
      f: Math.max(w, h) / 2,
      cx: w / 2,
      cy: h / 2,
      clipW: w,
      clipH: h,
    };
  }

  /** dir: RIGHTTURNS or LEFTTURNS */
  turn(dir: number): void {
    if (this.busy) return;
    const ring = this.scene.turns[dir].frames;
    const from = ring.findIndex((f) => f.viewID === this.viewIdx && f.motionInfo > 0);
    if (from < 0) return;
    const frames: CachedFrame[] = [];
    let i = from;
    let target = this.viewIdx;
    for (let step = 0; step < ring.length; step++) {
      i = (i + 1) % ring.length;
      const fi = ring[i];
      const cf = this.cache.get(fi.frameContainerLoc);
      if (cf) frames.push(cf);
      if (fi.viewID >= 0 && fi.motionInfo > 0) {
        target = fi.viewID;
        break;
      }
    }
    this.play(frames, () => {
      if (target !== this.viewIdx) void this.session.track(this.scripts.viewChanged());
      this.viewIdx = target;
      this.showView();
    });
  }

  availableRoads(): { road: Transition; register: number; arriveViewID: number }[] {
    const gid = this.globalViewID;
    const out: { road: Transition; register: number; arriveViewID: number }[] = [];
    for (const road of this.set.transitions) {
      if (road.viewIDstart === gid) out.push({ road, register: 0, arriveViewID: road.viewIDend });
      else if (road.viewIDend === gid) out.push({ road, register: 1, arriveViewID: road.viewIDstart });
    }
    return out;
  }

  walk(): void {
    if (this.busy) return;
    const roads = this.availableRoads();
    if (!roads.length) return;
    const { road, register, arriveViewID } = roads[0];
    const reg = road.frameRegisters[register];
    const frames = reg.frames
      .map((fi) => this.cache.get(fi.frameContainerLoc))
      .filter((f): f is CachedFrame => !!f);
    this.play(frames, () => {
      // arrival scene: the register's `destination` is the container index
      // of the arrival scene's view table; fall back to the scene owning the
      // road's far-end global view id
      let sceneIdx = this.set.scenes.findIndex((s) => s.locationViews === reg.destination);
      if (sceneIdx < 0) {
        sceneIdx = this.set.scenes.findIndex((s) =>
          s.views.some((vw) => vw.viewID === arriveViewID),
        );
      }
      if (sceneIdx >= 0) {
        const prevScene = this.sceneIdx;
        this.sceneIdx = sceneIdx;
        // arrival view: keep facing the direction of travel — the road's
        // endpoint view faces BACK along the road, so match the last walked
        // frame's camera angle against the scene's view rotations instead
        const travelDir = reg.frames[reg.frames.length - 1].axisX;
        const views = this.scene.views;
        let best = 0;
        let bestDist = Infinity;
        for (let v = 0; v < views.length; v++) {
          const d = angularDistance(views[v].rotation, travelDir);
          if (d < bestDist) {
            bestDist = d;
            best = v;
          }
        }
        this.viewIdx = best;
        // lifecycle events fire AFTER arrival — openscene handlers check
        // currentview() (gstair's deck-transition scenes forward via
        // changeset from their openscene)
        if (sceneIdx !== prevScene) {
          void this.session.track(
            (async () => {
              await this.scripts.closeScene(prevScene);
              await this.scripts.openScene(sceneIdx);
            })(),
          );
        }
      }
      this.showView();
    });
  }

  /** hotspot under the given view-pixel position in the current view */
  hitTest(x: number, y: number): { objIdx: number; obj: ObjectEntry } | null {
    if (this.busy) return null;
    const objects = this.scene.views[this.viewIdx].objects;
    for (let o = 0; o < objects.length; o++) {
      const obj = objects[o];
      const x0 = Math.min(obj.startRegionX, obj.endRegionX);
      const x1 = Math.max(obj.startRegionX, obj.endRegionX);
      const y0 = Math.min(obj.startRegionY, obj.endRegionY);
      const y1 = Math.max(obj.startRegionY, obj.endRegionY);
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return { objIdx: o, obj };
    }
    return null;
  }

  async click(x: number, y: number): Promise<void> {
    // publish the cursor position so scripts that hit-test themselves (stage
    // flats, draggable props) read the click via mouse()/pointx/pointy. The
    // caller (pointerdown) has already set pointerDown, so held-button drag
    // loops (`while stilldown()`) see the button held.
    this.session.setPointer(x, y);
    // Capture busy state up front: this dispatch is itself tracked (adds to
    // inflight), and in an overlay stage the `await stageClickAt` below
    // suspends us long enough for our own promise to register — which would
    // otherwise make the inputLocked gate reject the prop path spuriously.
    const busyOnEntry = this.inputLocked;
    // conversation clicks reach the puppet even while its script is
    // suspended in puppetevent/puppetspeak — but only while it is shown; a
    // hidden puppet (blackjack table between prompts) lets clicks reach the flat
    if (this.session.puppet?.visible) {
      this.session.puppetChoose(this.puppetBevelAt(x, y));
      return;
    }
    if (this.movie) {
      this.movieClick(x, y);
      return;
    }
    // a full-screen overlay stage (the deck map) resolves clicks through its
    // own click-logic regions — deck buttons, OK, red-area jumps. But when a
    // script is already suspended in an interactive poll loop (the crank play
    // loop, drag loops), that loop OWNS the input: it reads mouse()/button()
    // itself and dispatches the button by name (sendtobutton). Dispatching the
    // region here too would run the same handler twice concurrently (the trunk
    // OK would close the flat while the play loop's cleanup still runs). The
    // original engine is single-threaded: a modal loop pumps input, nothing
    // interleaves — so while busy, just publish the pointer and stand back.
    if (!this.session.setVisible && this.session.stage) {
      if (busyOnEntry) return;
      if (await this.session.stageClickAt(x, y)) return;
    }
    if (busyOnEntry) return; // a script was already running/suspended (delay)
    // props (UI band, inventory items) sit in front of everything
    const prop = this.session.propRuntime.propAt(
      x, y, this.session.setVisible ? this.worldCamera() : null, this.session.setVisible,
    );
    if (prop) {
      const name = prop.group.name;
      // A prop's mousedown may live on its own script (the trunk's gramdrawer)
      // OR only on the owning shop's main, which dispatches by `switch target`
      // for a whole bank of props (the Enigma switch/wires/dials share one
      // handler). Try the prop script first, then fall through to the shop
      // main, with target = the prop name so that dispatcher matches.
      const own = this.session.propScripts.get(name.toLowerCase());
      const shopMain = this.session.shopMain(prop.shop.name);
      const chain = [own, shopMain].filter(
        (s): s is NonNullable<typeof s> => !!s && s.script.codes.has("mousedown"),
      );
      if (chain.length) {
        // mousedown's ARGUMENT is the click point, not the prop name — the
        // original boot routes `sendtoprop(name, mousedown(thepoint))`, so a
        // handler like the bomb switches' `pointinbutton(currentflat(), "3B",
        // arg)` can hit-test the sub-region under the cursor. The prop NAME is
        // carried in the me/target context (the shop-main dispatcher keys on
        // target). Passing the name as the arg silently broke point-reading
        // props (every switch click was a no-op at point 0,0).
        const point = this.session.pointerPoint();
        this.session.interp.eventConsumed = false;
        for (const inst of chain) {
          try {
            const res = await this.session.interp.runHandler(inst, "mousedown", [point], {
              me: name,
              target: name,
            });
            if (this.session.interp.eventConsumed || (res.handled && !res.passed)) break;
          } catch (e) {
            this.onLog(`script error in ${name}.mousedown: ${(e as Error).message}`);
            break;
          }
        }
        this.onLog(`click prop ${name}`);
        return;
      }
    }
    // actors stand in the world between the props and the view hotspots
    if (this.session.setVisible && this.current && y < this.current.height) {
      const cam = this.worldCamera();
      const act = cam ? this.session.actorRuntime.actorAt(x, y, cam, this.occlusion()) : null;
      if (act) {
        const inst = this.session.castScripts.get(act.member.name);
        if (inst?.script.codes.has("mousedown")) {
          try {
            await this.session.interp.runHandler(inst, "mousedown", [act.member.name], {
              me: act.member.name,
              target: act.member.name,
            });
          } catch (e) {
            this.onLog(`script error in ${act.member.name}.mousedown: ${(e as Error).message}`);
          }
          this.onLog(`click actor ${act.member.name}`);
          return;
        }
      }
    }
    // inside the set view: the usual hotspot chain
    if (this.session.setVisible && this.current && y < this.current.height) {
      const hit = this.hitTest(x, y);
      if (hit) {
        const consumed = await this.scripts.mouseDown(
          this.sceneIdx, this.viewIdx, hit.objIdx, hit.obj.identifier,
        );
        this.onLog(`click ${hit.obj.identifier}${consumed ? "" : " (unhandled)"}`);
        return;
      }
    }
    // flat surface: flat script -> stage script
    const flat = this.session.flatScripts.get(this.session.currentFlat.toLowerCase());
    const interp = this.session.interp;
    interp.eventConsumed = false;
    for (const inst of [flat, this.session.stage]) {
      if (!inst || !inst.script.codes.has("mousedown")) continue;
      try {
        const res = await interp.runHandler(inst, "mousedown", [""], { me: inst.name, target: "" });
        if (interp.eventConsumed || (res.handled && !res.passed)) return;
      } catch (e) {
        this.onLog(`script error in ${inst.name}.mousedown: ${(e as Error).message}`);
      }
    }
  }

  // ---- puppet mode (conversation close-ups) --------------------------------

  /** cached layer composite of the active puppet stance */
  private puppetImage: { key: string; rgba: Uint8ClampedArray } | null = null;
  /**
   * decoded puppet layer frames, keyed by "<pup name>:<container loc>". The
   * pup name MUST be part of the key: different PUP files hold different data
   * at the same container index, so keying by loc alone made a second
   * character reuse the first's decoded sprites (garbled overlap).
   */
  private puppetFrames = new Map<string, import("./df/shp").ShpFrame>();

  /**
   * Decode (once, cached per pup) a layer sprite of the active puppet. The
   * cache key includes the pup name so switching characters never reuses the
   * previous one's sprites at the same container index.
   */
  puppetLayerFrame(loc: number): import("./df/shp").ShpFrame | null {
    const p = this.session.puppet;
    if (!p) return null;
    const key = `${p.name}:${loc}`;
    let f = this.puppetFrames.get(key);
    if (!f) {
      f = decodeShpFrame(p.pup.file.containers[loc]);
      this.puppetFrames.set(key, f);
    }
    return f;
  }

  /**
   * Bevel button geometry (shared by render + click hit-test, so they can
   * never disagree). The block is anchored to the bottom of the 384-px screen
   * and the row pitch shrinks to fit however many choices there are — a line
   * with 5+ options (e.g. Morrow's opener) no longer runs off the bottom.
   */
  private puppetBevelRects(): { x: number; y: number; w: number; h: number }[] {
    const p = this.session.puppet;
    if (!p) return [];
    const n = p.bevels.length;
    if (!n) return [];
    const preferredTop = 276; // where a short list sits (unchanged for n<=3)
    const bottomY = 378; // 6-px margin at the screen edge
    const topMin = 208; // for long lists: don't climb over the speaker's face
    const gap = 4;
    // full pitch (26) until the list would overflow, then compress; also raise
    // the block toward topMin so even a long list fits above the bottom edge
    const pitch = Math.min(26, Math.max(12, Math.floor((bottomY - topMin) / n)));
    const h = Math.max(12, pitch - gap);
    const startY = Math.min(preferredTop, bottomY - n * pitch);
    return p.bevels.map((_, i) => ({ x: 96, y: startY + i * pitch, w: 320, h }));
  }

  private puppetBevelAt(x: number, y: number): number {
    const rects = this.puppetBevelRects();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
    }
    return -1;
  }

  private renderPuppet(ctx: CanvasRenderingContext2D): void {
    const p = this.session.puppet!;
    const W = 512;
    const H = 384;
    const canvas = ctx.canvas;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    // layer state for this instant: animLogic playback while a line is
    // spoken (~30 records/s: lip sync, blinks, gestures), else the held
    // pose from the last record
    const state = this.session.puppetFrame();
    const key = `${p.name}:${p.stanceIdx}:${state ? state.layers.map((l) => l.frame).join(",") : "-"}`;
    if (!this.puppetImage || this.puppetImage.key !== key) {
      // the character composites OVER the live scene view; a stance's
      // "background" layer that is one flat colour is a key-colour matte
      // (SMETH1: all-247 plate), not a backdrop
      const rgba = new Uint8ClampedArray(W * H * 4);
      const cur = this.current;
      if (cur) {
        const view = new Uint8ClampedArray(cur.width * cur.height * 4);
        indexedToRGBA(cur.pixels, cur.width, cur.height, this.palette, view);
        for (let y = 0; y < cur.height && y < H; y++) {
          rgba.set(view.subarray(y * cur.width * 4, (y + 1) * cur.width * 4), y * W * 4);
        }
      }
      const pal = paletteToRGBA(p.pup.paletteRaw, 256);
      const stance = p.pup.stances[p.stanceIdx] ?? p.pup.stances[0];
      if (stance && state) {
        for (let l = 0; l < PUP_LAYERS.length; l++) {
          const st = state.layers[l];
          const layer = stance.layers[l];
          if (!st || st.frame < 0 || !layer?.frames.length) continue;
          const loc = layer.frames[Math.min(st.frame, layer.frames.length - 1)];
          try {
            const f = this.puppetLayerFrame(loc)!;
            if (l === 0) {
              let flat = true;
              const first = f.indexed[0];
              for (let i = 1; i < f.width * f.height; i++) {
                if (f.opaque[i] && f.indexed[i] !== first) {
                  flat = false;
                  break;
                }
              }
              if (flat) continue; // key-colour matte: keep the scene
            }
            // the record's anchor minus the frame's stored offset
            const dx = st.x - f.posXraw;
            const dy = st.y - f.posYraw;
            for (let yy = 0; yy < f.height; yy++) {
              const ty = dy + yy;
              if (ty < 0 || ty >= H) continue;
              for (let xx = 0; xx < f.width; xx++) {
                const tx = dx + xx;
                if (tx < 0 || tx >= W) continue;
                const s = yy * f.width + xx;
                if (!f.opaque[s]) continue;
                const c = f.indexed[s] * 4;
                const d = (ty * W + tx) * 4;
                rgba[d] = pal[c];
                rgba[d + 1] = pal[c + 1];
                rgba[d + 2] = pal[c + 2];
                rgba[d + 3] = 255;
              }
            }
          } catch {
            /* skip undecodable layer */
          }
        }
      }
      this.puppetImage = { key, rgba };
    }
    const img = ctx.createImageData(W, H);
    img.data.set(this.puppetImage.rgba);
    ctx.putImageData(img, 0, 0);
    // subtitle while a line is being spoken
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "14px Georgia, serif";
    if (p.subtitle) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 268, W, 40);
      ctx.fillStyle = "#e8e2d0";
      const words = p.subtitle.split(" ");
      const lines: string[] = [""];
      for (const w of words) {
        const cur = lines[lines.length - 1];
        if (ctx.measureText(cur + " " + w).width > W - 60) lines.push(w);
        else lines[lines.length - 1] = cur ? cur + " " + w : w;
      }
      lines.slice(0, 2).forEach((ln, i) => ctx.fillText(ln, W / 2, 284 + i * 17));
    }
    // choice bevels — font tracks the (possibly compressed) row height, text
    // is vertically centred so it stays legible even when rows are tight
    const rects = this.puppetBevelRects();
    rects.forEach((r, i) => {
      ctx.fillStyle = "#2c2618";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = "#6a5c3a";
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.fillStyle = "#e8e2d0";
      ctx.font = `${Math.min(14, r.h - 4)}px Georgia, serif`;
      ctx.textBaseline = "middle";
      ctx.fillText(this.session.puppet!.bevels[i].text, r.x + r.w / 2, r.y + r.h / 2 + 1);
    });
    ctx.restore();
    this.applyFade(ctx);
  }

  /** returns the DreamFactory cursor name for this position ("" = default) */
  async hover(x: number, y: number): Promise<string> {
    this.session.setPointer(x, y); // keep mouse() current as the cursor moves
    if (this.session.puppet?.visible) return this.puppetBevelAt(x, y) >= 0 ? "touch" : "";
    const prop = this.session.propRuntime.propAt(
      x, y, this.session.setVisible ? this.worldCamera() : null, this.session.setVisible,
    );
    if (prop) {
      const name = prop.group.name;
      const inst = this.session.propScripts.get(name.toLowerCase());
      if (inst?.script.codes.has("setcursor")) {
        this.scripts.cursorName = "";
        try {
          await this.session.interp.runHandler(inst, "setcursor", [name], {
            me: name,
            target: name,
          });
        } catch {
          /* cursor is cosmetic */
        }
        return this.scripts.cursorName || "touch";
      }
      return "touch";
    }
    if (!this.session.setVisible || (this.current && y >= this.current.height)) return "";
    const cam = this.worldCamera();
    if (cam && this.session.actorRuntime.actorAt(x, y, cam, this.occlusion())) return "talk";
    const hit = this.hitTest(x, y);
    if (!hit) return "";
    return this.scripts.setCursor(this.sceneIdx, this.viewIdx, hit.objIdx, hit.obj.identifier);
  }

  private play(frames: CachedFrame[], done: () => void): void {
    if (!frames.length) {
      done();
      return;
    }
    this.animation = frames;
    this.animationPos = 0;
    this.animationDone = done;
    this.lastTick = 0;
  }

  /** advance animation; returns the frame to draw this tick */
  tick(now: number): CachedFrame | null {
    this.session.propRuntime.tick(now, FRAME_MS);
    this.session.tickFade(now);
    this.session.tickTime(now); // delay() clock + loop/cricket service
    if (this.movie) {
      const m = this.movie;
      if (m.interval > 0 && m.meta[m.pos].regions.length === 0) {
        if (!m.lastTick) m.lastTick = now;
        if (now - m.lastTick >= m.interval) {
          m.lastTick = now;
          this.movieAdvance();
        }
      }
      return this.movie ? this.movie.frames[this.movie.pos] : this.current;
    }
    if (this.animation) {
      if (!this.lastTick) this.lastTick = now;
      if (now - this.lastTick >= FRAME_MS) {
        this.lastTick = now;
        this.current = this.animation[this.animationPos++];
        if (this.animationPos >= this.animation.length) {
          const done = this.animationDone!;
          this.animation = null;
          this.animationDone = null;
          done();
        }
      }
    }
    return this.current;
  }

  render(ctx: CanvasRenderingContext2D): void {
    // conversation close-up (openpuppetfile) replaces the world display — only
    // while shown; puppetvisible(false) keeps the puppet loaded but reveals the
    // stage flat behind it (blackjack table between "play again?" prompts)
    if (this.session.puppet?.visible && !this.session.fade.snapshot) {
      this.renderPuppet(ctx);
      return;
    }
    // frozen pre-transition frame while fading out (the set may already
    // have changed underneath — gotospecial fades around changeset)
    const snap = this.session.fade.snapshot;
    if (snap) {
      const canvas = ctx.canvas;
      if (canvas.width !== snap.width || canvas.height !== snap.height) {
        canvas.width = snap.width;
        canvas.height = snap.height;
      }
      const simg = ctx.createImageData(snap.width, snap.height);
      simg.data.set(snap.rgba);
      ctx.putImageData(simg, 0, 0);
      this.applyFade(ctx);
      return;
    }
    if (this.movie) {
      const m = this.movie;
      const f = m.frames[Math.min(m.pos, m.frames.length - 1)];
      const canvas = ctx.canvas;
      if (canvas.width !== f.width || canvas.height !== f.height) {
        canvas.width = f.width;
        canvas.height = f.height;
      }
      const img = ctx.createImageData(f.width, f.height);
      indexedToRGBA(f.pixels, f.width, f.height, m.palette, img.data);
      ctx.putImageData(img, 0, 0);
      // A live movie presents its own pixels at full brightness — it is NOT
      // dimmed by the persistent fade level. Fade-OUTs around a movie use the
      // snapshot branch above (screentoblack captures the frame first), and a
      // preceding blackscreen() is a one-shot clear the movie draws over. Do
      // NOT applyFade here, or an intro movie after blackscreen renders black.
      return;
    }
    // stage flat active: full 512×384 screen — flat image as background,
    // the set view composited into the top region, props over everything
    const flat = this.session.flatImage();
    if (flat) {
      const canvas = ctx.canvas;
      if (canvas.width !== flat.width || canvas.height !== flat.height) {
        canvas.width = flat.width;
        canvas.height = flat.height;
      }
      const img = ctx.createImageData(flat.width, flat.height);
      indexedToRGBA(flat.pixels, flat.width, flat.height, flat.palette, img.data);
      const f = this.current;
      if (this.session.setVisible && f) {
        const view = new Uint8ClampedArray(f.width * f.height * 4);
        indexedToRGBA(f.pixels, f.width, f.height, this.palette, view);
        for (let y = 0; y < f.height && y < flat.height; y++) {
          img.data.set(view.subarray(y * f.width * 4, (y + 1) * f.width * 4), y * flat.width * 4);
        }
      }
      // during walk/turn animation only the UI band props keep drawing
      const minAnchorY = this.animation !== null ? (f?.height ?? 0) : -Infinity;
      const propPal = this.session.setVisible ? this.propPalette : flat.palette;
      const cam = this.session.setVisible && this.animation === null ? this.worldCamera() : null;
      if (cam) {
        this.session.actorRuntime.composite(
          img.data, flat.width, flat.height, propPal, cam, this.occlusion(),
        );
      }
      this.session.propRuntime.composite(
        img.data, flat.width, flat.height, propPal, minAnchorY, cam, this.session.setVisible,
      );
      ctx.putImageData(img, 0, 0);
      this.drawTextOverlay(ctx);
      this.applyFade(ctx);
      if (this.session.setVisible) this.drawHotspots(ctx);
      return;
    }
    const f = this.current;
    if (!f) return;
    const canvas = ctx.canvas;
    if (canvas.width !== f.width || canvas.height !== f.height) {
      canvas.width = f.width;
      canvas.height = f.height;
    }
    const img = ctx.createImageData(f.width, f.height);
    indexedToRGBA(f.pixels, f.width, f.height, this.palette, img.data);
    if (this.animation === null) {
      const cam = this.worldCamera();
      if (cam) {
        this.session.actorRuntime.composite(
          img.data, f.width, f.height, this.propPalette, cam, this.occlusion(),
        );
      }
      this.session.propRuntime.composite(
        img.data, f.width, f.height, this.propPalette, -Infinity, cam, this.session.setVisible,
      );
    }
    ctx.putImageData(img, 0, 0);
    this.drawTextOverlay(ctx);
    this.applyFade(ctx);
    this.drawHotspots(ctx);
  }

  /** paint the persistent drawstring() text layer over the composited frame */
  private drawTextOverlay(ctx: CanvasRenderingContext2D): void {
    const ov = this.session.textOverlay;
    if (!ov.length) return;
    ctx.save();
    ctx.textBaseline = "alphabetic"; // drawstring's y is the text baseline (QuickDraw heritage)
    for (const e of ov) {
      ctx.font = overlayFont(e.size);
      // color 0 = black (the wireless readout / CTL keys); other indices fall
      // back to a bright ink until we need a real palette lookup here
      ctx.fillStyle = e.color === 0 ? "#000" : "#e8e8e8";
      ctx.fillText(e.text, e.x, e.y);
    }
    ctx.restore();
  }

  private drawHotspots(ctx: CanvasRenderingContext2D): void {
    if (!this.showHotspots || this.animation !== null) return;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 220, 120, 0.9)";
    ctx.fillStyle = "rgba(255, 220, 120, 0.9)";
    ctx.font = "10px sans-serif";
    for (const o of this.scene.views[this.viewIdx].objects) {
      const x = Math.min(o.startRegionX, o.endRegionX);
      const y = Math.min(o.startRegionY, o.endRegionY);
      const w = Math.abs(o.endRegionX - o.startRegionX);
      const h = Math.abs(o.endRegionY - o.startRegionY);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      ctx.fillText(o.identifier, x + 2, y + 10);
    }
    ctx.restore();
  }

  /** black overlay for screentoblack/blacktoscreen transitions */
  private applyFade(ctx: CanvasRenderingContext2D): void {
    const level = this.session.fade.level;
    if (level <= 0) return;
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, level).toFixed(3)})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  /** decode a map container on demand (256-color palette) */
  renderMap(ctx: CanvasRenderingContext2D): void {
    const fb = new FrameBuffer();
    const d = decodeFrame(this.set.file.containers[this.set.mapLight], fb);
    const pal = paletteToRGBA(this.set.paletteRaw, 256);
    ctx.canvas.width = d.width;
    ctx.canvas.height = d.height;
    const img = ctx.createImageData(d.width, d.height);
    indexedToRGBA(fb.pixels, d.width, d.height, pal, img.data);
    ctx.putImageData(img, 0, 0);

    // scene markers via their map-pixel coordinates
    ctx.font = "9px sans-serif";
    for (const s of this.set.scenes) {
      ctx.fillStyle = s === this.scene ? "#ff4040" : "#2060ff";
      ctx.beginPath();
      ctx.arc(s.xAxisMap, s.zAxisMap, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
