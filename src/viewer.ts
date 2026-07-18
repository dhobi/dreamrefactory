import { SetFile, Scene, FrameInfo, Transition, ObjectEntry, RIGHTTURNS, LEFTTURNS } from "./df/set";
import { FrameBuffer, decodeFrame, paletteToRGBA, indexedToRGBA } from "./df/image";
import { MovFrame, readMovFile } from "./df/mov";
import { Container } from "./df/container";
import { decodeAudioContainer } from "./df/audio";
import { SetScripts } from "./engine/setscripts";
import { GameSession } from "./engine/session";

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
    session.captureFrame = () => {
      const f = this.current;
      if (!f) return null;
      const rgba = new Uint8ClampedArray(f.width * f.height * 4);
      indexedToRGBA(f.pixels, f.width, f.height, this.palette, rgba);
      return { rgba, width: f.width, height: f.height };
    };
    session.onPlayMovie = (name, startFrame) => void this.playMovie(name, startFrame);
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
    this.scripts.openSet();
    this.scripts.openShop(`${base}.shp`);
    this.scripts.openScene(this.sceneIdx);
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
  keyDown(keyName: string): boolean {
    if (this.busy) return false;
    let navigated = false;
    this.session.onNavigate = (dir) => {
      navigated = true;
      if (dir === "strait") this.walk();
      else if (dir === "left") this.turn(LEFTTURNS);
      else if (dir === "right") this.turn(RIGHTTURNS);
    };
    const consumed = this.scripts.keyDown(this.sceneIdx, keyName);
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
    // exactly its 25 water frames
    const interval =
      audioSec > 0 ? (audioSec * 1000) / frames.length : hasRegions ? 145 : 0;
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
    this.showView();
  }

  /** start looping background music if a theme bank is available */
  startTheme(): void {
    const theme =
      this.session.audioLib.theme(`${this.set.setName.toLowerCase()}.trk`) ??
      this.session.audioLib.theme();
    if (theme) this.session.audio.play("theme", theme, { loop: true });
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
      return this.scripts.openShop(key);
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

  get busy(): boolean {
    return this.animation !== null || this.movie !== null || this.session.fading;
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
      if (target !== this.viewIdx) this.scripts.viewChanged();
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
          this.scripts.closeScene(prevScene);
          this.scripts.openScene(sceneIdx);
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

  click(x: number, y: number): void {
    if (this.movie) {
      this.movieClick(x, y);
      return;
    }
    const hit = this.hitTest(x, y);
    if (!hit) return;
    const consumed = this.scripts.mouseDown(this.sceneIdx, this.viewIdx, hit.objIdx, hit.obj.identifier);
    this.onLog(`click ${hit.obj.identifier}${consumed ? "" : " (unhandled)"}`);
  }

  /** returns the DreamFactory cursor name for this position ("" = default) */
  hover(x: number, y: number): string {
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
      this.applyFade(ctx);
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
      this.session.propRuntime.composite(img.data, f.width, f.height, this.propPalette);
    }
    ctx.putImageData(img, 0, 0);
    this.applyFade(ctx);

    if (this.showHotspots && this.animation === null) {
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
