import { SetFile, Scene, FrameInfo, Transition, ObjectEntry, RIGHTTURNS, LEFTTURNS } from "./df/set";
import { FrameBuffer, decodeFrame, paletteToRGBA, indexedToRGBA } from "./df/image";
import { FileProvider, SetScripts } from "./engine/setscripts";
import { AudioSink, NullAudioSink } from "./engine/audio";

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

  onHud: (text: string) => void = () => {};
  onLog: (line: string) => void = () => {};
  readonly scripts: SetScripts;

  constructor(set: SetFile, files: FileProvider = () => null, audio: AudioSink = new NullAudioSink()) {
    this.set = set;
    this.palette = paletteToRGBA(set.paletteRaw, set.colorCount);
    this.scripts = new SetScripts(set, files, audio);
    this.scripts.onLog = (l) => this.onLog(l);
    this.predecodeAll();
    this.jumpToDefault();
    // stage/boot layer doesn't exist yet: auto-load sibling resources
    const base = set.setName.toLowerCase();
    for (const bank of [`${base}.trk`, `${base}.sfx`, `${base}.11k`, "unilib.trk"]) {
      const data = files(bank);
      if (data) this.scripts.audioLib.openBank(bank, data);
    }
    if (this.scripts.audioLib.bankNames.length) {
      this.onLog(`audio banks: ${this.scripts.audioLib.bankNames.join(", ")}`);
    } else {
      this.onLog(
        `no audio banks — drop UNILIB.TRK and ${base.toUpperCase()}.TRK/.SFX alongside the .SET to hear sound`,
      );
    }
    this.scripts.openSet();
    this.scripts.openShop(`${base}.shp`);
    this.scripts.openScene(this.sceneIdx);
  }

  /** start looping background music if a theme bank is available */
  startTheme(): void {
    const theme =
      this.scripts.audioLib.theme(`${this.set.setName.toLowerCase()}.trk`) ??
      this.scripts.audioLib.theme();
    if (theme) this.scripts.audio.play("theme", theme, { loop: true });
  }

  /** wire a file added after construction (audio bank or this set's shop) */
  addResource(name: string, data: Uint8Array): boolean {
    const key = name.toLowerCase();
    if (/\.(trk|sfx|11k)$/.test(key)) {
      if (this.scripts.audioLib.openBank(key, data)) {
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
    return this.animation !== null;
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
    this.scripts.propRuntime.tick(now, FRAME_MS);
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
      this.scripts.propRuntime.composite(img.data, f.width, f.height);
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
