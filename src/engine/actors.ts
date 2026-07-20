import { CstFile, CastMember, CastPose } from "../df/cst";
import { ShpFrame, decodeShpFrame } from "../df/shp";
import { WorldCamera, projectPoint } from "./props";

/**
 * Runtime for cast characters ("actors"). Actors are world-space sprites
 * like propxyz props, but with 8 view directions per pose: the drawn frame
 * depends on the actor's facing relative to the camera. Scripts drive them
 * with actorset/actorstar/actorxyz/actordeg/actorpose/actorvisible/
 * actorscale — the same getter/setter-by-arity pattern as props.
 */

export class ActorInstance {
  visible = false;
  setName = "";
  worldX = 0;
  worldY = 0;
  worldZ = 0;
  /** facing, 0..255 like the camera */
  deg = 0;
  poseName = "stand";
  /** animation step within the pose (walk cycles advance this) */
  step = 0;
  scale = 0;
  zclip = 0;
  speed = 0;
  turn = 0;
  owner: string | number = "";
  value: string | number = 0;
  /** name of the star the actor was last placed on (actorstar getter) */
  starName = "";
  lastTick = 0;

  constructor(
    readonly member: CastMember,
    readonly cast: LoadedCast,
  ) {}

  pose(): CastPose | null {
    return this.member.poses.find((p) => p.name === this.poseName) ?? this.member.poses[0] ?? null;
  }
}

export class LoadedCast {
  private frameCache = new Map<number, ShpFrame>();

  constructor(
    readonly name: string,
    readonly cst: CstFile,
  ) {}

  frame(containerLoc: number): ShpFrame {
    let f = this.frameCache.get(containerLoc);
    if (!f) {
      f = decodeShpFrame(this.cst.file.containers[containerLoc]);
      this.frameCache.set(containerLoc, f);
    }
    return f;
  }
}

interface DrawEntry {
  a: ActorInstance;
  proj: { x: number; y: number; depth: number };
}

/**
 * The current SET view's depth map, for occluding actors behind scenery.
 * z holds per-pixel levels 0..levels (low = near, high = far) at w×h; scale
 * is world-depth units per level (SET.zFarMax / SET.zLevelCount). TI.EXE
 * (blit 0x412940) draws an actor pixel only where the scenery level is >= the
 * actor's level, i.e. where the scenery is farther-or-equal.
 */
export interface Occlusion {
  z: Uint8Array;
  w: number;
  h: number;
  scale: number;
  levels: number;
}

/** actor's quantized depth level (groundOffset defaults to 0; TI.EXE 0x41140e) */
function actorLevel(depth: number, occ: Occlusion): number {
  return Math.max(0, Math.floor(depth / Math.max(1, occ.scale)));
}

/** true if scenery at (x, y) is nearer than the actor level → hide the pixel */
function occluded(occ: Occlusion, x: number, y: number, level: number): boolean {
  if (x < 0 || y < 0 || x >= occ.w || y >= occ.h) return false;
  return occ.z[y * occ.w + x] < level;
}

export class ActorRuntime {
  readonly actors = new Map<string, ActorInstance>();
  readonly casts = new Map<string, LoadedCast>();
  /** the set currently displayed — actors only draw in their own set */
  currentSet = "";

  addCast(name: string, cst: CstFile): LoadedCast {
    const cast = new LoadedCast(name.toLowerCase(), cst);
    this.casts.set(cast.name, cast);
    for (const m of cst.members) {
      if (!this.actors.has(m.name)) this.actors.set(m.name, new ActorInstance(m, cast));
    }
    return cast;
  }

  removeCast(name: string): void {
    const cast = this.casts.get(name.toLowerCase());
    if (!cast) return;
    this.casts.delete(cast.name);
    for (const [key, a] of this.actors) {
      if (a.cast === cast) this.actors.delete(key);
    }
  }

  get(name: string): ActorInstance | null {
    return this.actors.get(String(name).toLowerCase()) ?? null;
  }

  /**
   * The sprite frame for an actor as seen from the camera. TI.EXE (actor
   * draw fn at 0x411235): the view angle is the actor's facing relative
   * to the BEARING from the camera to the actor — which side of a person
   * you see depends on where you stand, not where you look. The engine
   * keeps the frame record whose depicted angle (direction × 32, in the
   * 0..255 angle space) is angularly closest; /32 rounding is equivalent.
   */
  private frameFor(a: ActorInstance, cam: WorldCamera): ShpFrame | null {
    const pose = a.pose();
    if (!pose || !pose.steps.length) return null;
    const step = pose.steps[a.step % pose.steps.length];
    if (!step) return null;
    const dx = a.worldX - cam.x;
    const dy = a.worldY - cam.y;
    const bearing = Math.round((Math.atan2(dy, dx) * 256) / (2 * Math.PI)) & 0xff;
    const rel = (a.deg - bearing) & 0xff;
    const dir = Math.round(rel / 32) & 7;
    const cf = step[dir] ?? step.find((f) => !!f);
    return cf ? a.cast.frame(cf.location) : null;
  }

  /**
   * Depth-scaling reference: the frame record's i16 @+42 (96 in GANG.CST).
   * TI.EXE's actor draw computes k = actorscale × ref / (1000 × depth)
   * with exactly this per-record value — the same shape as prop drawing,
   * just with the reference stored per frame record instead of per state.
   */
  private refScale(a: ActorInstance): number {
    const pose = a.pose();
    const cf = pose?.steps[0]?.find((f) => !!f);
    return cf?.refScale || 96;
  }

  /** visible actors of the current set, far to near */
  drawList(cam: WorldCamera): DrawEntry[] {
    const out: DrawEntry[] = [];
    for (const a of this.actors.values()) {
      if (!a.visible || a.scale <= 0) continue;
      if (a.setName && a.setName !== this.currentSet) continue;
      const proj = projectPoint(cam, a.worldX, a.worldY, a.worldZ);
      if (!proj || proj.depth - a.zclip <= 0) continue;
      out.push({ a, proj });
    }
    return out.sort((x, y) => y.proj.depth - x.proj.depth);
  }

  /** screen rect of an actor sprite (same depth scaling as world props) */
  rect(a: ActorInstance, proj: { x: number; y: number; depth: number }, cam: WorldCamera) {
    const f = this.frameFor(a, cam);
    if (!f) return null;
    const k = (a.scale * this.refScale(a)) / (1000 * proj.depth);
    return {
      f,
      k,
      x: proj.x - Math.round(f.posXraw * k),
      y: proj.y - Math.round(f.posYraw * k),
      w: Math.max(1, Math.round(f.width * k)),
      h: Math.max(1, Math.round(f.height * k)),
    };
  }

  /** blit visible actors into the view buffer (before screen-space props) */
  composite(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    paletteRGBA: Uint8ClampedArray,
    cam: WorldCamera,
    occ: Occlusion | null = null,
  ): void {
    for (const { a, proj } of this.drawList(cam)) {
      const r = this.rect(a, proj, cam);
      if (!r) continue;
      const level = occ ? actorLevel(proj.depth, occ) : 0;
      const maxY = Math.min(cam.clipH, height, r.y + r.h);
      const maxX = Math.min(cam.clipW, width, r.x + r.w);
      for (let ty = Math.max(0, r.y); ty < maxY; ty++) {
        const sy = Math.min(r.f.height - 1, Math.floor((ty - r.y) / r.k));
        for (let tx = Math.max(0, r.x); tx < maxX; tx++) {
          const sx = Math.min(r.f.width - 1, Math.floor((tx - r.x) / r.k));
          const s = sy * r.f.width + sx;
          if (!r.f.opaque[s]) continue;
          // scenery in front of the actor hides this pixel (SET Z image)
          if (occ && occluded(occ, tx, ty, level)) continue;
          const pal = r.f.indexed[s] * 4;
          const d = (ty * width + tx) * 4;
          rgba[d] = paletteRGBA[pal];
          rgba[d + 1] = paletteRGBA[pal + 1];
          rgba[d + 2] = paletteRGBA[pal + 2];
        }
      }
    }
  }

  /** front-most actor whose opaque pixels cover (x, y) — for talking */
  actorAt(x: number, y: number, cam: WorldCamera, occ: Occlusion | null = null): ActorInstance | null {
    const list = this.drawList(cam);
    for (let i = list.length - 1; i >= 0; i--) {
      const { a, proj } = list[i];
      const r = this.rect(a, proj, cam);
      if (!r) continue;
      if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) continue;
      const sx = Math.min(r.f.width - 1, Math.floor((x - r.x) / r.k));
      const sy = Math.min(r.f.height - 1, Math.floor((y - r.y) / r.k));
      if (!r.f.opaque[sy * r.f.width + sx]) continue;
      // a click landing on scenery that occludes the actor doesn't reach them
      if (occ && occluded(occ, x, y, actorLevel(proj.depth, occ))) continue;
      return a;
    }
    return null;
  }
}
