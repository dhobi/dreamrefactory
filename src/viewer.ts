import { SetFile, Scene, FrameInfo, Transition, ObjectEntry, RIGHTTURNS, LEFTTURNS } from "./df/set";
import { FrameBuffer, decodeFrame, paletteToRGBA, indexedToRGBA } from "./df/image";
import { MovClickRegion, readMovFile } from "./df/mov";
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
    frames: CachedFrame[];
    /** per-frame click regions — playback pauses on frames that have any */
    regions: MovClickRegion[][];
    kinds: number[];
    firstRegionIdx: number;
    lastRegionIdx: number;
    regionFrameCount: number;
    palette: Uint8ClampedArray;
    pos: number;
    /** ms per frame; 0 = wait for clicks (click-through object movies) */
    interval: number;
    lastTick: number;
    /** holding on a click-region frame (e.g. an OK button) */
    paused: boolean;
    /**
     * initial: waiting still, a click starts playback · intro: play to
     * first pause · cycle: wrap between pauses · exit: play out
     */
    mode: "initial" | "intro" | "cycle" | "exit";
  } | null = null;

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
    session.onPlayMovie = (name) => void this.playMovie(name);
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
    this.sceneIdx = s;
    const v = viewName
      ? this.scene.views.findIndex((vw) => vw.viewName.toLowerCase() === viewName.toLowerCase())
      : -1;
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
  playMovie(fileName: string): boolean {
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

    // soundtrack: concatenate the ordered chunks, play once
    let audioSec = 0;
    if (mov.audioChunks.length) {
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

    const regions = mov.frames.map((f) => f.regions);
    const kinds = mov.frames.map((f) => f.kind);
    const regionIdxs = regions.map((r, i) => (r.length ? i : -1)).filter((i) => i >= 0);
    const hasPausePoints = regionIdxs.length > 0;
    // pacing: soundtrack duration when present; otherwise animate at a
    // default rate if there are pause points, else pure click-through
    const interval =
      audioSec > 0 ? (audioSec * 1000) / frames.length : hasPausePoints ? 200 : 0;
    this.movie = {
      frames,
      regions,
      kinds,
      firstRegionIdx: regionIdxs[0] ?? -1,
      lastRegionIdx: regionIdxs[regionIdxs.length - 1] ?? -1,
      regionFrameCount: regionIdxs.length,
      palette: paletteToRGBA(mov.paletteRaw, 256),
      pos: 0,
      interval,
      lastTick: 0,
      // interactive movies open on a still and wait for a click to start;
      // plain cutscenes (no regions) auto-play
      paused: hasPausePoints,
      mode: hasPausePoints ? "initial" : "intro",
    };
    this.onLog(
      `movie: ${fileName} (${frames.length} frames${audioSec ? `, ${audioSec.toFixed(1)}s audio` : ""}${hasPausePoints ? ", waits for click" : ""})`,
    );
    return true;
  }

  get moviePlaying(): boolean {
    return this.movie !== null;
  }

  /** click during a movie: resume from a pause point / advance / dismiss */
  private movieClick(x: number, y: number): void {
    const m = this.movie;
    if (!m) return;
    if (m.mode === "initial") {
      // waiting still: OK (a leave-action region of the first pause frame,
      // whose button is already visible) exits; any other click starts it
      const okHit = m.regions[m.firstRegionIdx]?.some(
        (r) =>
          r.action === 1 &&
          x >= Math.min(r.x0, r.x1) && x <= Math.max(r.x0, r.x1) &&
          y >= Math.min(r.y0, r.y1) && y <= Math.max(r.y0, r.y1),
      );
      this.onLog(`movie click (${x},${y})${okHit ? " on OK -> leave" : " -> start"}`);
      if (okHit) {
        this.endMovie();
        return;
      }
      m.mode = "intro";
      m.paused = false;
      m.lastTick = 0;
      return;
    }
    if (m.paused) {
      // waiting on a click-region frame: only a region hit does anything
      const region = m.regions[m.pos].find(
        (r) =>
          x >= Math.min(r.x0, r.x1) && x <= Math.max(r.x0, r.x1) &&
          y >= Math.min(r.y0, r.y1) && y <= Math.max(r.y0, r.y1),
      );
      this.onLog(
        `movie click (${x},${y}) frame ${m.pos}${region ? ` -> action ${region.action}` : " (no region hit)"}`,
      );
      if (!region) return;
      if (region.sound) {
        const snd = this.session.audioLib.sound(region.sound);
        if (snd) this.session.audio.play("sound", snd);
      }
      m.paused = false;
      m.lastTick = 0;
      if (m.interval === 0) m.interval = 200;
      if (region.action === 1) {
        // leave: jump to the exit segment (after the last pause frame; with
        // multiple pauses, the transition frames there belong to the cycle)
        let exit = m.lastRegionIdx + 1;
        if (m.regionFrameCount >= 2) {
          while (exit < m.frames.length && m.kinds[exit] === 2 && !m.regions[exit].length) exit++;
        }
        if (exit >= m.frames.length) {
          this.endMovie();
          return;
        }
        m.pos = exit;
        m.mode = "exit";
      } else {
        // cycle: animate to the next pause frame (or wrap back to the first)
        m.mode = "cycle";
      }
      return;
    }
    // pure click-through movies (no regions anywhere)
    if (m.regionFrameCount === 0) {
      m.pos++;
      if (m.pos >= m.frames.length) this.endMovie();
    }
  }

  /** advance one movie frame according to the playback mode */
  private movieAdvance(): void {
    const m = this.movie;
    if (!m) return;
    const next = m.pos + 1;
    if (m.mode === "cycle") {
      // cycle segment: transition (kind 2) frames run; anything else wraps
      // back to the first pause frame without playing the exit animation
      if (next >= m.frames.length || (!m.regions[next].length && m.kinds[next] !== 2)) {
        m.pos = m.firstRegionIdx;
        m.paused = true;
        return;
      }
    } else if (next >= m.frames.length) {
      this.endMovie();
      return;
    }
    m.pos = next;
    if (m.mode !== "exit" && m.regions[next].length) m.paused = true;
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
    return this.animation !== null || this.movie !== null;
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
        if (sceneIdx !== this.sceneIdx) {
          this.scripts.closeScene(this.sceneIdx);
          this.scripts.openScene(sceneIdx);
        }
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
    if (this.movie) {
      const m = this.movie;
      if (m.interval > 0 && !m.paused) {
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
    if (!this.busy) {
      this.session.propRuntime.composite(img.data, f.width, f.height, this.propPalette);
    }
    ctx.putImageData(img, 0, 0);

    if (this.showHotspots && !this.busy) {
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
