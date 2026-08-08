import { CstFile, CastMember, CastPose } from "../df/cst";
import { ShpFrame, decodeShpFrame } from "../df/shp";
import { WorldCamera, Occlusion, projectPoint, depthLevel, sceneryOccludes, bearing } from "./geometry";
import type { DrawSignature } from "./signature";

// Occlusion lives in the neutral ./geometry module; re-exported here so
// viewer.ts's import("./engine/actors").Occlusion keeps resolving.
export type { Occlusion } from "./geometry";

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
  /**
   * Free-form script storage, and "none" until a script puts something there.
   *
   * NOT "" — the TAOOT corpus reads this slot as a small state machine per character
   * and spells the empty state "none": eleven scripts test `actorowner(x) =
   * "none"` as "we have not spoken yet", and not one of them ever assigns it, so
   * that is the value the original must start from. CSEA1.PUP is the clearest
   * case — its whole mission-1 branch hangs off it, and at "" the chief engineer
   * falls through to his brush-off line and the turbine job cannot be accepted
   * at all. (Found by segment 4 walking into it; see propowner, same convention.)
   */
  owner: string | number = "none";
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
      f = decodeShpFrame(this.cst.file.containers[containerLoc].data);
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
 * Global multiplier on actor depth-scaling, kept as a tuning knob. Left at 1:
 * the raw formula k = actorscale × refScale / (1000 × depth) reproduces the
 * correct on-screen size (verified against TAOOT's SMOKE crowd actors and HALLA Sasha
 * at a distance — both match the rendered floor and read at natural height).
 * An earlier 0.58 "shrink" was WRONG — it made every actor too small. What can
 * look off is purely proximity: an NPC standing ~2 m from the standpoint fills
 * the frame with the feet below the interface band, which is geometrically
 * correct, not a scale bug.
 */
const ACTOR_SCALE_CORRECTION = 1;

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

  /** actorinstance(src, dst): a new actor sharing src's cast sprite (TAOOT's gang
   *  cast spawns its lifeboat crowd this way). No-op if src is unknown or dst
   *  already exists. */
  instance(src: string, dst: string): void {
    const s = this.get(src);
    const key = dst.toLowerCase();
    if (!s || this.actors.has(key)) return;
    this.actors.set(key, new ActorInstance(s.member, s.cast));
  }

  /** actordelete(name): drop an actor instance from the world */
  remove(name: string): void {
    this.actors.delete(String(name).toLowerCase());
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
    // which side you see depends on where you STAND relative to the actor, so
    // the reference is the bearing from the actor to the CAMERA. Sprite dir 0
    // (angle 0) is the front (face toward viewer): when the actor faces the
    // camera (deg == actor→camera bearing) rel is 0 → dir 0. (Using camera→
    // actor here inverted it: facing you showed the back, and walkers moonwalked.)
    const camBearing = bearing(cam.x - a.worldX, cam.y - a.worldY);
    const rel = (a.deg - camBearing) & 0xff;
    const dir = Math.round(rel / 32) & 7;
    const cf = step[dir] ?? step.find((f) => !!f);
    return cf ? a.cast.frame(cf.location) : null;
  }

  /**
   * Depth-scaling reference: the frame record's i16 @+42 (96 in TAOOT's GANG.CST).
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
      // Behind the camera is projectPoint's own answer (it returns null on
      // depth <= 0). zclip is NOT a second cull — see occludeAt.
      if (!proj) continue;
      out.push({ a, proj });
    }
    return out.sort((x, y) => y.proj.depth - x.proj.depth);
  }

  /**
   * The depth an actor's sprite is OCCLUDED at — its own depth, biased by zclip.
   *
   * That bias is what `actorzclip` is for, and reading it as a near-clip plane
   * instead (cull when `depth <= zclip`) is what kept TAOOT's chief engineer out of
   * his own control room. The corpus settles it. Every value in it is a nudge
   * against scenery: `stdactor` gives everyone 32, so an actor standing at a
   * scenery boundary isn't sliced by it; the many negative ones (-200, -1000,
   * -1500) push a character BEHIND more of the room, which is how they are seen
   * through doorways and over railings; and gang.cst asks for 20000 in exactly
   * one place — csea in `control`, who stands behind the console and has to be
   * drawn in front of it, since clicking him is the only way into the turbine
   * puzzle. As a clip plane that last one hid him from all twenty-four
   * standpoints (his depth there runs 700..8300, never 20000), and the game has
   * no other route to CSEA1.PUP.
   *
   * Read as a bias every one of those makes sense, and the cull it replaces was
   * redundant anyway: projectPoint already answers null behind the camera.
   */
  private occludeAt(a: ActorInstance, depth: number, occ: Occlusion): number {
    return depthLevel(depth - Number(a.zclip), occ);
  }

  /** screen rect of an actor sprite (same depth scaling as world props) */
  rect(a: ActorInstance, proj: { x: number; y: number; depth: number }, cam: WorldCamera) {
    const f = this.frameFor(a, cam);
    if (!f) return null;
    const k = (a.scale * this.refScale(a) * ACTOR_SCALE_CORRECTION) / (1000 * proj.depth);
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
      const level = occ ? this.occludeAt(a, proj.depth, occ) : 0;
      const maxY = Math.min(cam.clipH, height, r.y + r.h);
      const maxX = Math.min(cam.clipW, width, r.x + r.w);
      for (let ty = Math.max(0, r.y); ty < maxY; ty++) {
        const sy = Math.min(r.f.height - 1, Math.floor((ty - r.y) / r.k));
        for (let tx = Math.max(0, r.x); tx < maxX; tx++) {
          const sx = Math.min(r.f.width - 1, Math.floor((tx - r.x) / r.k));
          const s = sy * r.f.width + sx;
          if (!r.f.opaque[s]) continue;
          // scenery in front of the actor hides this pixel (SET Z image)
          if (occ && sceneryOccludes(occ, tx, ty, level)) continue;
          const pal = r.f.indexed[s] * 4;
          const d = (ty * width + tx) * 4;
          rgba[d] = paletteRGBA[pal];
          rgba[d + 1] = paletteRGBA[pal + 1];
          rgba[d + 2] = paletteRGBA[pal + 2];
        }
      }
    }
  }

  /**
   * The actor half of the renderer's "has anything moved?" — see
   * {@link PropRuntime.drawSignature}, which this mirrors, and
   * src/engine/signature.ts for why the inputs are hashed rather than the
   * writes counted.
   *
   * `step` is in here because a walk cycle advances it without touching
   * anything else: it is the one field that makes a standing-still frame differ
   * from the one before it. The camera is NOT — the viewer hashes that itself,
   * since it is the same camera the props are projected through.
   */
  drawSignature(sig: DrawSignature): void {
    sig.num(this.actors.size).str(this.currentSet);
    for (const a of this.actors.values()) {
      sig.bool(a.visible);
      if (!a.visible) continue;
      sig.ref(a.member).str(a.setName).str(a.poseName);
      sig.num(a.worldX).num(a.worldY).num(a.worldZ);
      sig.num(a.deg).num(a.step).num(a.scale).num(a.zclip);
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
      if (occ && sceneryOccludes(occ, x, y, this.occludeAt(a, proj.depth, occ))) continue;
      return a;
    }
    return null;
  }
}
