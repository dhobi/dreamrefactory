import { PlayHandle } from "./audio";
import { bearing } from "./geometry";
import type { GameSession } from "./session";

/**
 * One scheduled callback (makeloop). TI.EXE semantics: the countdown
 * decrements once per 66 ms service step; at zero the slot REMOVES ITSELF
 * and fires sendto<kind>(name, handler()) once — persistent loops re-arm
 * inside their own handler. Identity is (kind, name): re-making replaces.
 */
export interface GameLoop {
  kind: string;
  name: string;
  handler: string;
  count: number;
  /** re-fire interval in ticks; period 1 = a smooth per-DISPLAY-frame loop */
  period: number;
  paused: boolean;
}

/**
 * A positional ambient one-shot scheduler (makecricket), bound to the set
 * that created it. Fires its sound with distance volume + bearing pan when
 * the countdown ends AND the previous play finished; re-arms with
 * base + random(jitter), or disappears when jitter < 0.
 */
export interface Cricket {
  name: string;
  x: number;
  y: number;
  radius: number;
  base: number;
  jitter: number;
  count: number;
  paused: boolean;
  setName: string;
  handle: PlayHandle | null;
}

/**
 * The TI.EXE timing runtime: delay-driven loops (makeloop), positional
 * ambient one-shots (makecricket), sound-loop flags, and straight-line actor
 * walks — all serviced on the 66 ms master heartbeat plus a per-display-frame
 * path for smooth loops. Extracted from GameSession, which delegates to it;
 * cross-cutting session state (clock, audio, actors, dispatch) is reached back
 * through the session reference.
 */
export class Scheduler {
  constructor(private readonly session: GameSession) {}

  readonly loops: GameLoop[] = [];
  readonly crickets: Cricket[] = [];
  private soundLoops = new Map<string, PlayHandle>();
  private timeLastTick = 0;

  /** DreamFactory random(n) = 1..n (0 for n <= 0) */
  private rand(n: number): number {
    return n > 0 ? Math.floor(Math.random() * n) + 1 : 0;
  }

  /** makeloop: (kind, name) identity — replaces an existing loop */
  makeLoop(kind: string, name: string, handler: string, period: number): void {
    this.stopLoop(kind, name);
    if (this.loops.length >= 32) {
      this.session.onLog(`makeloop: table full (32), dropping ${kind}/${name}`);
      return;
    }
    this.loops.push({
      kind: kind.toLowerCase(),
      name: name.toLowerCase(),
      handler: handler.toLowerCase(),
      count: Math.max(1, period),
      period: Math.max(1, period),
      paused: false,
    });
  }

  stopLoop(kind: string, name: string): void {
    const k = kind.toLowerCase();
    const n = name.toLowerCase();
    for (let i = this.loops.length - 1; i >= 0; i--) {
      const l = this.loops[i];
      if (l.kind === k && (n === "all" || l.name === n)) this.loops.splice(i, 1);
    }
  }

  pauseLoop(kind: string, name: string, paused: boolean): void {
    const k = kind.toLowerCase();
    const n = name.toLowerCase();
    for (const l of this.loops) {
      if (l.kind === k && (n === "all" || l.name === n)) l.paused = paused;
    }
  }

  isLoop(kind: string, name: string): boolean {
    const k = kind.toLowerCase();
    const n = name.toLowerCase();
    return this.loops.some((l) => l.kind === k && l.name === n);
  }

  makeCricket(name: string, x: number, y: number, radius: number, base: number, jitter: number): void {
    this.stopCricket(name);
    if (this.crickets.length >= 16) {
      this.session.onLog(`makecricket: table full (16), dropping ${name}`);
      return;
    }
    this.crickets.push({
      name: name.toLowerCase(),
      x,
      y,
      radius: Math.max(1, radius),
      base,
      jitter,
      count: jitter >= 0 ? base + this.rand(jitter) : base,
      paused: false,
      setName: this.session.currentSetName,
      handle: null,
    });
  }

  stopCricket(name: string): void {
    const n = name.toLowerCase();
    for (let i = this.crickets.length - 1; i >= 0; i--) {
      const c = this.crickets[i];
      if (n === "all" || c.name === n) {
        c.handle?.stop();
        this.crickets.splice(i, 1);
      }
    }
  }

  pauseCricket(name: string, paused: boolean): void {
    const n = name.toLowerCase();
    for (const c of this.crickets) {
      if (n === "all" || c.name === n) c.paused = paused;
    }
  }

  isCricket(name: string): boolean {
    const n = name.toLowerCase();
    return this.crickets.some((c) => c.name === n);
  }

  /** sound names flagged by soundloop(name, true): they LOOP when played */
  readonly loopFlags = new Set<string>();

  /**
   * soundloop(name, on/off): flag a sound as looping — it does NOT play
   * anything itself. Every corpus call pairs the flag with a play that
   * follows (`soundloop("hissloop", true); singlesound("hissloop")`, or a
   * makecricket for positional ambience); off clears the flag AND stops the
   * loop if it is sounding (BOMB stops its tick with soundloop(off) alone).
   */
  soundLoop(name: string, on: boolean): void {
    const key = name.toLowerCase();
    if (on) {
      this.loopFlags.add(key);
      return;
    }
    this.loopFlags.delete(key);
    this.soundLoops.get(key)?.stop();
    this.soundLoops.delete(key);
  }

  /**
   * Play a named sound on the sound channel, honouring the loop flag.
   * A flagged play loops and is TRACKED, so haltsound()/soundloop(off) can
   * stop it (an untracked looping source would sound forever — the
   * gramophone hiss outliving the whole trunk stage). A flagged sound that
   * is already looping is left alone (no double start on re-entry).
   */
  playSound(name: string, overlap: boolean): void {
    const key = name.toLowerCase();
    const audio = this.session.audioLib.sound(key);
    if (!audio) {
      this.session.onLog(`sound not found: ${name} (banks: ${this.session.audioLib.bankNames.join(", ") || "none"})`);
      return;
    }
    if (this.loopFlags.has(key)) {
      const existing = this.soundLoops.get(key);
      if (existing && !existing.done) return;
      this.soundLoops.set(key, this.session.audio.play("sound", audio, { loop: true, overlap: true }));
      return;
    }
    this.session.audio.play("sound", audio, { overlap });
  }

  /** haltsound(n): stop the sound channel INCLUDING tracked looping sounds */
  haltSounds(): void {
    this.session.audio.halt("sound");
    for (const h of this.soundLoops.values()) h.stop();
    this.soundLoops.clear();
  }

  /** silence every ambient sound (set change cleans its crickets itself) */
  stopAllAmbient(): void {
    for (const h of this.soundLoops.values()) h.stop();
    this.soundLoops.clear();
  }

  // ---- actor walking (walktostar/walktoxyz/walkonpath) --------------------

  /**
   * One straight-line walk per actor (TI.EXE fn 0x443260 record shape:
   * start position, deltas, total distance, facing = bearing to target).
   * Progress advances with the actor's per-set speed each 66 ms service
   * step while the walk pose cycles; on arrival the actor snaps to the
   * target and returns to "stand".
   */
  readonly walks = new Map<
    string,
    { sx: number; sy: number; sz: number; dx: number; dy: number; dz: number; dist: number; progress: number; paused: boolean; arriveStar?: string }
  >();

  /** arriveStar: the value actorstar() should report once the walk lands
   *  (walkonpath rides the "walkonpath" sentinel while moving, then settles
   *  on the destination star so pacing loops can tell where the actor is). */
  startWalk(name: string, tx: number, ty: number, tz: number, arriveStar?: string): void {
    const a = this.session.actorRuntime.get(name);
    if (!a) return;
    const dx = tx - a.worldX;
    const dy = ty - a.worldY;
    const dz = tz - a.worldZ;
    const dist = Math.max(1, Math.round(Math.hypot(dx, dy, dz)));
    a.deg = bearing(dx, dy);
    if (a.member.poses.some((p) => p.name === "walk")) {
      a.poseName = "walk";
      a.step = 0;
    }
    this.walks.set(a.member.name, {
      sx: a.worldX, sy: a.worldY, sz: a.worldZ,
      dx, dy, dz, dist, progress: 0, paused: false, arriveStar,
    });
  }

  stopWalk(name: string): void {
    const key = name.toLowerCase();
    const a = this.session.actorRuntime.get(key);
    if (this.walks.delete(key) && a && a.poseName === "walk") {
      a.poseName = "stand";
      a.step = 0;
    }
  }

  isWalk(name: string): boolean {
    return this.walks.has(name.toLowerCase());
  }

  pauseWalk(name: string, paused: boolean): void {
    const w = this.walks.get(name.toLowerCase());
    if (w) w.paused = paused;
  }

  private serviceWalks(): void {
    const arrived: string[] = [];
    for (const [key, w] of this.walks) {
      if (w.paused) continue;
      const a = this.session.actorRuntime.get(key);
      if (!a) {
        this.walks.delete(key);
        continue;
      }
      // units per 66 ms step: actorspeed × 4 — APPROXIMATION (the exact
      // TI stepping lives in fn 0x443730's per-type movers; stdspeed is
      // per-set, so this constant only tunes overall walking pace)
      w.progress += Math.max(1, a.speed) * 4;
      const t = Math.min(1, w.progress / w.dist);
      a.worldX = Math.round(w.sx + w.dx * t);
      a.worldY = Math.round(w.sy + w.dy * t);
      a.worldZ = Math.round(w.sz + w.dz * t);
      a.step++; // walk pose cycle advances per service tick
      if (t >= 1) {
        this.walks.delete(key);
        if (a.poseName === "walk") {
          a.poseName = "stand";
          a.step = 0;
        }
        if (w.arriveStar !== undefined) a.starName = w.arriveStar;
        arrived.push(key);
      }
    }
    // fire each arrived actor's endwalk() — the arrival lifecycle handler.
    // NPCs use it to face the player, resume an idle loop, or start the next
    // leg of a patrol; without it walk-driven actors freeze after one leg.
    // (Fired after the loop so a new walk it starts doesn't perturb this pass.)
    for (const key of arrived) {
      if (this.session.castScripts.get(key)?.script.codes.has("endwalk")) {
        void this.session.track(this.session.sendEvent("sendtoactor", key, "endwalk", [], "walk"));
      }
    }
  }

  /**
   * Advance game time: resolve delay()s, then run 66 ms service steps —
   * walks, then crickets, then due loops (TI.EXE master service order).
   */
  tickTime(now: number): void {
    this.session.clock.advance(now);
    const STEP_MS = 66;
    if (!this.timeLastTick) this.timeLastTick = now;
    let steps = Math.floor((now - this.timeLastTick) / STEP_MS);
    if (steps <= 0) return;
    this.timeLastTick += steps * STEP_MS;
    // after a long stall (suspended tab) don't replay the whole gap
    if (steps > 64) steps = 64;
    for (let s = 0; s < steps; s++) this.serviceStep();
  }

  private serviceStep(): void {
    this.serviceWalks();
    for (let i = this.crickets.length - 1; i >= 0; i--) {
      const c = this.crickets[i];
      if (c.paused) continue;
      if (c.count > 0) c.count--;
      if (c.count > 0) continue;
      if (c.setName && c.setName !== this.session.currentSetName) continue;
      if (c.handle && !c.handle.done) continue; // previous play still sounding
      this.fireCricket(c);
      if (c.jitter < 0) this.crickets.splice(i, 1);
      else c.count = c.base + this.rand(c.jitter);
    }
    // Coarse timer loops (period >= 2) fire on the 66 ms master service.
    // Smooth per-frame loops (period 1) are serviced separately at the DISPLAY
    // frame rate (serviceFrameLoops) so animation-rate loops — the bridge's
    // sky drift, the fencer's idle/parry pose — actually run at frame rate in
    // the browser rather than crawling at 15 Hz. (Headless has one frame per
    // tick, so both paths fire once per tick and tests are unaffected.)
    this.fireDueLoops((l) => l.period > 1);
  }

  /**
   * Fire due period-1 (per-display-frame) loops. Called once per rendered
   * frame from the viewer — ~60 Hz in the browser, once per tick headless.
   */
  serviceFrameLoops(): void {
    this.fireDueLoops((l) => l.period <= 1);
  }

  /**
   * Fire period-1 loops from within a forceupdate() cooperative yield, so a
   * long-running drag/animation loop (the bridge wheel's stilldown loop) still
   * lets independent per-frame loops (the sky drift) advance while it runs —
   * otherwise the drag holds scriptBusy and the sky freezes until release.
   * Excludes the caller's OWN loop so a handler can't re-enter itself mid-swing
   * (the fencer's attack sets its player-prop pose in a forceupdate loop and
   * must not trip that same prop's idle/defend loop). Called only in the
   * browser (real frames); headless forceupdate keeps its deterministic step.
   */
  pumpFrameLoops(exceptName: string): void {
    const ex = String(exceptName).toLowerCase();
    const due = this.loops.filter(
      (l) => !l.paused && l.period <= 1 && l.name !== ex && --l.count <= 0,
    );
    if (!due.length) return;
    for (const l of due) this.loops.splice(this.loops.indexOf(l), 1);
    this.session.track(
      (async () => {
        for (const l of due) await this.fireLoop(l);
      })(),
    );
  }

  /** loops fire one at a time and never re-enter a running script (the
   * original engine is single-threaded; its service is likewise guarded) */
  private fireDueLoops(select: (l: GameLoop) => boolean): void {
    if (this.session.scriptBusy) return;
    const due = this.loops.filter((l) => !l.paused && select(l) && --l.count <= 0);
    if (!due.length) return;
    for (const l of due) this.loops.splice(this.loops.indexOf(l), 1);
    this.session.track(
      (async () => {
        for (const l of due) await this.fireLoop(l);
      })(),
    );
  }

  private fireCricket(c: Cricket): void {
    const audio = this.session.audioLib.sound(c.name);
    if (!audio) return;
    let volume = 1;
    let pan = 0;
    const lis = this.session.listener();
    if (lis) {
      const dx = c.x - lis.x;
      const dy = c.y - lis.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= c.radius) return; // out of earshot (counts as fired)
      // linear falloff (exact TI curve unrecovered); pan = sine of the
      // bearing relative to the camera facing, same convention as the
      // projection's lateral axis (positive = right of screen)
      volume = 1 - dist / c.radius;
      if (dist > 1) {
        const th = ((lis.deg & 0xff) / 256) * 2 * Math.PI;
        const lateral = dy * Math.cos(th) - dx * Math.sin(th);
        pan = Math.max(-1, Math.min(1, lateral / dist));
      }
    }
    // a soundloop-flagged cricket starts once and keeps looping in place
    // (handle.done stays false, so the re-fire check never triggers again) —
    // this is how the sets run positional ambience: soundloop("motor", true)
    // + makecricket("motor", ...) on deckbd
    c.handle = this.session.audio.play("sound", audio, {
      overlap: true, volume, pan, loop: this.loopFlags.has(c.name),
    });
  }

  private async fireLoop(l: GameLoop): Promise<void> {
    const cmd =
      { actor: "sendtoactor", prop: "sendtoprop", scene: "sendtoscene", flat: "sendtoflat" }[
        l.kind
      ] ?? "sendtoprop";
    // A "flat" loop belongs to the ONE active overlay flat, so fire it on the
    // current flat rather than the captured name. blackjack's gameover() does
    // makeloop("flat", me, "newgame", 45), but when the hand ends from a click
    // in a flat REGION (hit/stay), `me` is that region's name, not the flat —
    // sendtoflat(region) wouldn't resolve newgame and the play-again prompt
    // never fired. (For the deal-triggered gameover, me already IS the flat.)
    const target = l.kind === "flat" ? this.session.currentFlat : l.name;
    try {
      // caller/target = the loop's own target: a prop loop handler resolved on
      // the shop main dispatches by `target` (the fusebox's fuseoff/fuseon run
      // loops do propview(target,…)), so it must be the prop name, not a marker.
      await this.session.sendEvent(cmd, target, l.handler, [], target);
    } catch (e) {
      this.session.onLog(`loop ${l.kind}/${l.name}.${l.handler}: ${(e as Error).message}`);
    }
  }
}
