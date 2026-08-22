import { CstFile, CastMember, CastPose } from "../df/cst";
import type { Actor as StarRecord } from "../df/set";
import { ShpFrame, decodeShpFrame } from "../df/shp";
import { WorldCamera, Occlusion, projectPoint, depthLevel, sceneryOccludes, bearing } from "./geometry";
import type { DrawSignature } from "./signature";

// Occlusion lives in the neutral ./geometry module; re-exported here so
// viewer.ts's import("./engine/actors").Occlusion keeps resolving.
export type { Occlusion } from "./geometry";

/**
 * Runtime for cast characters ("actors"). Actors are world-space sprites
 * like propxyz props, but with several stored views per pose: the drawn frame
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
  /**
   * How far into the current pose's PLAY SCRIPT the actor is — an index into
   * {@link CastPose.play}, not into its pictures. TI.EXE keeps it in the actor
   * record at +0x22, with the script's length cached beside it at +0x24.
   */
  step = 0;
  scale = 0;
  zclip = 0;
  speed = 0;
  /**
   * `actorturn` — degrees of facing per service pass while turning. 16, not 0:
   * it is TI.EXE's creation default, measured over the save corpus (the field
   * takes exactly two values across all 3465 shipped actor records — 16 for
   * every record no room ever set, 10 where a room passed `stdturn`), and the
   * save writer dumps this field verbatim, so a 0 here would put a value in our
   * saves that no shipped record has — and one TI.EXE's turn stepper, which has
   * no floor, would spin on forever (#191 review).
   */
  turn = 16;
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
  /**
   * `actorstar` named a star the open set does not have, so this actor is still
   * standing wherever it was — see {@link ActorRuntime.settleStars}.
   *
   * Never true in Titanic: its star names are bare and a room places its own
   * cast from its own `openset`, so the table in hand is always the right one.
   */
  starPending = false;
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

/** how far apart two 0..255 facings are, the short way round (TI.EXE 0x444d40) */
function angleApart(a: number, b: number): number {
  const d = (a - b) & 0xff;
  return Math.min(d, 256 - d);
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

  /** actorinstance(src, dst): a new actor sharing src's cast sprite (TAOOT's gang
   *  cast spawns its lifeboat crowd this way). No-op if src is unknown or dst
   *  already exists. */
  instance(src: string, dst: string): void {
    const s = this.get(src);
    const key = dst.toLowerCase();
    if (!s || this.actors.has(key)) return;
    this.actors.set(key, new ActorInstance(s.member, s.cast));
  }

  /**
   * Re-seat this set's actors on the stars they name, now that its star table is
   * the one in hand.
   *
   * `actorstar(who, name)` places an actor the moment it is called, from the star
   * table of the set that happens to be OPEN. In Titanic that is always the right
   * table, because a room places its own cast from its own `openset` — the names
   * are bare (`jones1`), so they could not mean anything else.
   *
   * Dust qualifies them (`town.horse1`, `chin.help3`) and places from the STAGE:
   * `new.flt`'s `advanceday` calls `sendtocast("gang", initactors())`, which runs
   * `setupactor` for the whole town while whatever room the player is standing in
   * is the open one. So most of those calls name a star the current set has never
   * heard of, and land the actor at the origin — which is how this was found:
   * Leroy read `star=town.leroy1 xyz=0,0,0` while the horses, placed by a script
   * that happened to run in `town`, read real coordinates.
   *
   * Deferring to set entry is enough because an actor is only ever DRAWN in its
   * own set ({@link currentSet}), so a position is only required to be right by
   * the time that set is the one being looked at.
   *
   * Only actors whose `actorstar` actually MISSED are moved
   * ({@link ActorInstance.starPending}), never every actor carrying a star name.
   * The difference matters: a script is free to place an actor by star and then
   * nudge it with `actorxyz`, and re-seating that on set entry would undo the
   * nudge. A miss is unambiguous — the position it wanted was never applied.
   *
   * Two more things it deliberately does not do:
   *
   *  - **the facing.** `actorstar` seeds `deg` from the star, but `setupactor`
   *    then overrides it (`actordeg (me, 240 + 128)` right after the star), so
   *    re-seeding here would undo the script.
   *  - **a walking actor.** Its position is the scheduler's to own until it
   *    arrives; snapping it back to its departure star would teleport it.
   */
  settleStars(stars: readonly StarRecord[], walking: (name: string) => boolean): number {
    let moved = 0;
    for (const [name, a] of this.actors) {
      if (!a.starPending || a.setName.toLowerCase() !== this.currentSet) continue;
      if (walking(name)) continue;
      const want = a.starName.toLowerCase();
      const star = stars.find((s) => s.identifier.toLowerCase() === want);
      if (!star) continue;
      a.worldX = star.positionX;
      a.worldY = star.positionZ;
      a.worldZ = star.positionY;
      a.starPending = false;
      moved++;
    }
    return moved;
  }

  /** actordelete(name): drop an actor instance from the world */
  remove(name: string): void {
    this.actors.delete(String(name).toLowerCase());
  }

  /**
   * Advance every actor one step through its pose's play script — TI.EXE
   * 0x411030, three instructions at the head of the frame draw:
   *
   *     mov ax, [ebp+0x22]      ; the step
   *     inc ax
   *     cmp [ebp+0x24], ax      ; the play script's length
   *     jg  keep
   *     mov [ebp+0x22], 0       ; wrap
   *
   * EVERY actor, not only the ones walking, and only ever ONCE per service pass:
   * the draw it heads is the tail of the master service (0x442550 -> 0x439b80),
   * and the two draw paths that are not that one pass a flag saying "do not
   * advance" (0x43abd1). A still pose comes to the same thing anyway — every
   * `stand` in the game has a one-step script — but `stok1`'s `dig` and `throw`
   * do not, and the port used to advance only walkers, so the stoker shovelled
   * one frozen frame of coal.
   */
  advanceAnimation(): void {
    for (const a of this.actors.values()) {
      const n = a.pose()?.play.length ?? 0;
      if (n > 0) a.step = (a.step + 1) % n;
    }
  }

  /**
   * The sprite frame for an actor as seen from the camera — TI.EXE's frame
   * search at 0x4114e0, which is one loop over the step's records keeping the
   * angularly closest, first one winning a tie (0x4115ba's `jge` skips equals).
   */
  private frameFor(a: ActorInstance, cam: WorldCamera): ShpFrame | null {
    const pose = a.pose();
    if (!pose || !pose.play.length) return null;
    // through the play script, which is what says how long a picture is HELD —
    // TI.EXE 0x411588, `poseContainer[0x2e + step*2] - 1` matched against the
    // frame record's own step number. See {@link CastPose.play} for #181.
    const step = pose.steps[pose.play[a.step % pose.play.length]];
    if (!step?.length) return null;
    // which side you see depends on where you STAND relative to the actor, so
    // the reference is the bearing from the actor to the CAMERA. Angle 0 is the
    // front (face toward viewer): when the actor faces the camera (deg == actor→
    // camera bearing) rel is 0. (Using camera→actor here inverted it: facing you
    // showed the back, and walkers moonwalked.)
    const camBearing = bearing(cam.x - a.worldX, cam.y - a.worldY);
    const rel = (a.deg - camBearing) & 0xff;
    let cf = step[0];
    let best = angleApart(cf.angle, rel);
    for (const f of step) {
      const d = angleApart(f.angle, rel);
      if (d < best) {
        best = d;
        cf = f;
      }
    }
    return a.cast.frame(cf.location);
  }

  /**
   * Depth-scaling reference: the frame record's i16 @+42 (96 in TAOOT's GANG.CST).
   * TI.EXE's actor draw computes k = actorscale × ref / (1000 × depth)
   * with exactly this per-record value — the same shape as prop drawing,
   * just with the reference stored per frame record instead of per state.
   */
  private refScale(a: ActorInstance): number {
    const pose = a.pose();
    return pose?.steps[0]?.[0]?.refScale || 96;
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
   * Is this actor's sprite actually somewhere on the screen right now?
   *
   * The same question {@link drawList} and {@link rect} answer between them,
   * asked as a predicate — and in the original it is literally the same code.
   * `actordist` (0x40e790) does not measure anything itself: it runs the shared
   * actor→screen projection at 0x411180 and answers 32000 whenever that
   * REFUSES, so "not present" means "would not be drawn". Its gates, in order:
   *
   *   1. `actorvisible <= 0`                              (0x411190)
   *   2. a set open, and the `setvisible` global nonzero  (0x489f58 / 0x489f5a)
   *   3. the actor's own set name vs the current one      (strcmp at 0x435630)
   *   4. behind the camera / outside the depth window     (0x411252, 0x411262)
   *   5. **the sprite rectangle intersected with the view's** (0x435300) — and
   *      an empty intersection is a refusal like any other.
   *
   * Step 5 is the one this port was missing, and #180 is what that costs: a
   * character standing a deck below you, or behind your shoulder, is inside
   * `hotdist()` all the same, so `cashidle` kept re-arming, `hasattention(6)`
   * came due against a distance that was merely SHORT rather than VISIBLE, and
   * Daisy Cashmore stopped you on the A-deck landing while she was down on B.
   * The reporter's six standpoints in `stair1c1` all separate on this and
   * nothing else — distance alone predicts the wrong answer at five of them.
   *
   * The depth window (step 4) is not ported: its two globals are screen-space
   * constants of the original's own rasteriser and nothing in the corpus reads
   * them. Everything the report turns on is the rectangle.
   */
  onScreen(a: ActorInstance, cam: WorldCamera): boolean {
    if (!a.visible || a.scale <= 0) return false;
    if (a.setName && a.setName !== this.currentSet) return false;
    const proj = projectPoint(cam, a.worldX, a.worldY, a.worldZ);
    if (!proj) return false; // behind the camera
    const r = this.rect(a, proj, cam);
    if (!r) return false; // no frame to draw
    return r.x < cam.clipW && r.y < cam.clipH && r.x + r.w > 0 && r.y + r.h > 0;
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
    return depthLevel(depth - Number(a.zclip) + (occ.groundBias ?? 0), occ);
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
    for (const entry of this.drawList(cam)) {
      this.compositeOne(entry, rgba, width, height, paletteRGBA, cam, occ);
    }
  }

  /**
   * Blit ONE actor — the loop body of {@link composite}, callable per entry so
   * the viewer can interleave actors and world props into a single far-to-near
   * pass on a v1 set (see Viewer.compositeWorld for the DF.EXE evidence).
   */
  compositeOne(
    { a, proj }: DrawEntry,
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    paletteRGBA: Uint8ClampedArray,
    cam: WorldCamera,
    occ: Occlusion | null = null,
  ): void {
    const r = this.rect(a, proj, cam);
    if (!r) return;
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

  /**
   * The actor half of the renderer's "has anything moved?" — see
   * {@link PropRuntime.drawSignature}, which this mirrors, and
   * engine/src/runtime/signature.ts for why the inputs are hashed rather than the
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
