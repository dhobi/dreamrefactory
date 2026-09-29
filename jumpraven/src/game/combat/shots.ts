/**
 * The shots in the air — RAVEN.EXE 0x41a3de … 0x41b60a: each of the 32 moved
 * a step a frame, stopped by a block or the ground (0x427b6d) and by the
 * first enemy it meets (0x41b70b), and drawn with the mark of what it is
 * aimed at. The player's and the copilot's are one table (src/game/combat/pyro.ts
 * says how they are fired).
 *
 *   lasers    a beam from the last point to this one; 0xc8 (tier 1 and 3: 0xf0)
 *   shells    0x78, 0xb4, 0xb4, 0xdc by tier
 *   rockets   0x834, 0xbb8, 0xbb8, 0xfa0; a hit or a miss drawn two frames
 *   missiles  0xc1c, 0xfa0, 0x1388, 0x1770; drawn three frames
 *   bombs     bounce off the blocks; on the ground: tier 0 bursts for 0xbb8 over
 *             0xf, 1 is a fire, 2 bursts for 0xed8 over 0x14 (and in the air
 *             after 12 frames is napalm), 3 is sixteen pieces
 *   defensive falls for 17 frames, then opens and drifts; gone at 0x28 up
 *
 * Four rockets or missiles into the ground or a block without a hit between,
 * and the pilot says so (line 0xc); one hit in 16 of theirs and the bombs'
 * he cheers (line 0xd).
 */
import type { Shot } from "./api";
import { meets, inBlock, tooFar } from "./lib";
import { BOMBS, DEFENSIVE, LASERS, MISSILES, PIC, ROCKETS, SHELLS, type Pyro } from "./pyro";
import { copyObj, cosMul, dist, sinMul, type Obj } from "./world";

/** a step, and its cell */
function step(s: Shot): void {
  s.o.x += s.vx;
  s.o.y += s.vy;
  s.o.z += s.vz;
  s.o.cellX = s.o.x >> 8;
  s.o.cellY = s.o.y >> 8;
}

/** 0x41a3de: every shot a frame */
export function moveShots(p: Pyro): void {
  const w = p.w;
  for (const s of p.shots) {
    if (!s.on) continue;
    if (--s.life < 0) {
      s.on = 0;
      continue;
    }
    switch (s.kind) {
      case LASERS:
      case SHELLS: {
        const old = copyObj(s.o);
        step(s);
        if (meets(w, old, s.o)) {
          s.met = 1;
          if (s.kind === LASERS) w.sound(0xe);
          else w.sound(w.roll(4) === 1 ? 0xf : 0xd);
        }
        const dmg = s.kind === LASERS ? (s.tier === 0 || s.tier === 2 ? 0xc8 : 0xf0) : s.tier === 0 ? 0x78 : s.tier === 3 ? 0xdc : 0xb4;
        if (w.hitEnemies(old, s.o, dmg, 0)) {
          s.met = 2;
          w.sound(s.kind === LASERS ? 0x12 : 0x11);
          p.taunt(s.kind);
          p.hits(s.who, s.kind);
        }
        if (s.kind === LASERS) drawLaser(p, old, s);
        else drawShell(p, s);
        if (s.met) s.on = 0;
        break;
      }
      case ROCKETS:
      case MISSILES: {
        if (s.met) {
          s.met++;
          if (s.kind === ROCKETS) drawRocket(p, s);
          else drawMissile(p, s);
          if (s.met >= (s.kind === ROCKETS ? 2 : 3)) s.on = 0;
          break;
        }
        const old = copyObj(s.o);
        if (s.flag) {
          s.vz += w.roll(7) - 4;
          if (s.vx > s.vy) s.vy += w.roll(7) - 4;
          else s.vx += w.roll(7) - 4;
        }
        s.o.x += s.vx;
        s.o.y += s.vy;
        s.o.z += s.vz;
        if (s.aim === 2) rehome(s);
        s.o.cellX = s.o.x >> 8;
        s.o.cellY = s.o.y >> 8;
        if (meets(w, old, s.o)) {
          s.met = 1;
          s.life = 0x1f4;
          w.sound(0x10);
          if (++p.misses >= 4) {
            p.pilotSays(0xc);
            p.misses = 0;
          }
        }
        const dmg =
          s.kind === ROCKETS
            ? s.tier === 0 ? 0x834 : s.tier === 3 ? 0xfa0 : 0xbb8
            : [0xc1c, 0xfa0, 0x1388, 0x1770][s.tier] ?? 0xc1c;
        if (w.hitEnemies(old, s.o, dmg, 0)) {
          s.met = 1;
          s.life = 0x1f4;
          w.sound(9);
          if (w.roll(0x10) === 1) p.pilotSays(0xd);
          p.taunt(s.kind);
          p.hits(s.who, s.kind);
          p.misses = 0;
        }
        if (s.kind === ROCKETS) drawRocket(p, s);
        else drawMissile(p, s);
        break;
      }
      case BOMBS:
        moveBomb(p, s);
        break;
      case DEFENSIVE:
        moveDecoy(p, s);
        break;
    }
  }
}

/** 0x41a9de: a bomb — falling, bouncing off the blocks, and what it does on the ground */
function moveBomb(p: Pyro, s: Shot): void {
  const w = p.w;
  if (s.met) {
    s.met++;
    drawBomb(p, s);
    if (s.met >= 4) s.on = 0;
    if (s.tier === 1 || s.tier === 3) s.on = 0;
    return;
  }
  s.vz -= 2;
  const old = copyObj(s.o);
  step(s);
  if (inBlock(w, s.o)) {
    if (s.o.cellX !== old.cellX) {
      s.o.x = ((s.o.cellX + old.cellX) << 7) + 0x80;
      s.o.cellX = s.o.x >> 8;
      s.vx = -Math.trunc(s.vx / 2);
    }
    if (s.o.cellY !== old.cellY) {
      s.o.y = ((s.o.cellY + old.cellY) << 7) + 0x80;
      s.o.cellY = s.o.y >> 8;
      s.vy = -Math.trunc(s.vy / 2);
    }
    w.sound(0x15);
  }
  if (s.o.z <= 0) {
    s.o.z = 1;
    s.met = 1;
    const burst = (dmg: number, r: number): void => {
      if (!w.hitEnemies(old, s.o, dmg, r)) return;
      if (w.roll(0x10) === 1) p.pilotSays(0xd);
      p.taunt(s.kind);
      p.hits(s.who, BOMBS);
    };
    switch (s.tier) {
      case 0:
        w.sound(0x2d);
        burst(0xbb8, 0xf);
        break;
      case 1:
        w.sound(0x2c);
        p.fire1(s.o, s.who);
        break;
      case 2:
        s.tier = 0;
        w.sound(0x2a);
        burst(0xed8, 0x14);
        break;
      case 3:
        w.sound(0x28);
        for (let a = 0; a < 0x100; a += 0x10) p.fan(s.o, a, s.who);
        break;
    }
  }
  if (s.tier === 2 && s.life < 0x1e8) {
    p.napalm(s.o, s.who);
    drawBomb(p, s);
    s.on = 0;
    return;
  }
  drawBomb(p, s);
}

/** 0x41ac8b: a defensive — falling for 17 frames, then open and drifting to a stop */
function moveDecoy(p: Pyro, s: Shot): void {
  const w = p.w;
  if (tooFar(w, s.o) || s.o.z <= 0x28) {
    s.on = 0;
    p.decoys--;
    return;
  }
  if (s.life >= 0x1e3) {
    s.vz -= 2;
    step(s);
    drawDecoy(p, s, false);
    return;
  }
  if (s.opened === 0) {
    if (w.speed) {
      s.vx = cosMul(w.cam.angle, w.speed);
      s.vy = sinMul(w.cam.angle, w.speed);
    } else s.vx = s.vy = 0;
    s.vz = -1;
    if (s.tier === 1) w.sound(0x19);
    else if (s.tier === 2) w.sound(0x1a);
    else if (s.tier === 3) w.sound(0x1b);
  }
  s.opened++;
  if (s.vx > 0) s.vx--;
  if (s.vy > 0) s.vy--;
  if (s.vx < 0) s.vx++;
  if (s.vy < 0) s.vy++;
  step(s);
  drawDecoy(p, s, true);
  if (s.tier === 3 && s.opened >= 8) {
    s.on = 0;
    w.jammer = 0x1f4;
    p.decoys--;
  }
}

/** 0x41a33f: a homing shot's step turned toward where its target is now */
function rehome(s: Shot): void {
  const t = s.target!;
  const dx = t.x - s.o.x;
  const dy = t.y - s.o.y;
  const dz = t.z - s.o.z;
  const n = Math.trunc(dist(dx, dy, dz) / s.speed) + 1;
  s.vx = Math.trunc(dx / n);
  s.vy = Math.trunc(dy / n);
  s.vz = Math.trunc(dz / n);
}

/** the row of 16 by distance, from 0x40 */
const far = (depth: number): number => (depth - 0x40) >> 7;

/**
 * The mark of what a shot is aimed at, in front of everything (0x41af29 …):
 * the point's, or the homing target's, while it is 0x140 away or more; a
 * shot that has come as near as it drops its aim
 */
function drawMark(p: Pyro, s: Shot, depth: number): void {
  const w = p.w;
  let at: Obj;
  let pic: number;
  if (s.aim === 1) {
    at = s.at;
    pic = PIC.aimMark;
  } else if (s.aim) {
    at = s.target!;
    pic = PIC.homeMark;
  } else return;
  const m = w.project(at);
  if (m.depth < 0x140) return;
  const i = Math.min((m.depth - 0x140) >> 7, 3);
  w.sprite(p.pic(pic + i), m.y, m.x, -1);
  if (m.depth <= depth) s.aim = 0;
}

/** 0x41ae38: a laser's beam from where it was to where it is, and a spark where it struck */
function drawLaser(p: Pyro, from: Obj, s: Shot): void {
  const w = p.w;
  const a = w.project(s.o);
  if (a.depth < 0x40) return;
  let i = far(a.depth);
  const b = w.project(from);
  if (b.depth < 0x40) return;
  if (i >= 4) i = 3;
  w.beam(p.pic((s.tier === 0 || s.tier === 2 ? PIC.laser : PIC.laser2) + i), a.y, a.x, b.y, b.x, a.depth);
  if (s.met === 2) w.sprite(p.pic(PIC.hit + Math.min(i, 0xf)), a.y, a.x, a.depth);
  else if (s.met) w.sprite(p.pic(PIC.chip + Math.min(i, 0xf)), a.y, a.x, a.depth);
  else drawMark(p, s, a.depth);
}

/** 0x41afe9: a shell, a tracer, or the spark where it struck */
function drawShell(p: Pyro, s: Shot): void {
  const w = p.w;
  const a = w.project(s.o);
  if (a.depth < 0x40) return;
  const i = Math.min(far(a.depth), 0xf);
  if (s.met === 2) return void w.sprite(p.pic(PIC.hit + i), a.y, a.x, a.depth);
  if (s.met) return void w.sprite(p.pic(PIC.chip + i), a.y, a.x, a.depth);
  w.sprite(p.pic((s.flag ? PIC.tracer : PIC.shell) + i), a.y, a.x, a.depth);
  drawMark(p, s, a.depth);
}

/** 0x41b172: a rocket, or its blast */
function drawRocket(p: Pyro, s: Shot): void {
  const w = p.w;
  const a = w.project(s.o);
  if (a.depth < 0x40) return;
  const i = Math.min(far(a.depth), 0xf);
  if (s.met === 1) return void w.sprite(p.pic(PIC.blast + i), a.y, a.x, a.depth);
  if (s.met === 2) return void w.sprite(p.pic(PIC.blast2 + i), a.y, a.x, a.depth);
  w.sprite(p.pic(PIC.rocket + i), a.y, a.x, a.depth);
  drawMark(p, s, a.depth);
}

/** 0x41b2d4: a missile, or its blast */
function drawMissile(p: Pyro, s: Shot): void {
  const w = p.w;
  const a = w.project(s.o);
  if (a.depth < 0x40) return;
  const i = Math.min(far(a.depth), 0xf);
  if (s.met === 2) return void w.sprite(p.pic(PIC.blast2 + i), a.y, a.x, a.depth);
  if (s.met) return void w.sprite(p.pic(PIC.blast + i), a.y, a.x, a.depth);
  w.sprite(p.pic(PIC.missile + i), a.y, a.x, a.depth);
  drawMark(p, s, a.depth);
}

/** 0x41b436: a bomb, or its blast (a tier-1 or tier-3 one's a spark) */
function drawBomb(p: Pyro, s: Shot): void {
  const w = p.w;
  const a = w.project(s.o);
  if (a.depth < 0x40) return;
  const i = Math.min(far(a.depth), 0xf);
  let pic: number = PIC.bomb;
  if (s.met) pic = s.tier === 1 || s.tier === 3 ? PIC.chip : s.met === 2 || s.met === 3 ? PIC.blast2 : PIC.blast;
  w.sprite(p.pic(pic + i), a.y, a.x, a.depth);
}

/** 0x41b51a: a defensive, closed (spinning through 8) or open (its tier's frames, the last few over and over) */
function drawDecoy(p: Pyro, s: Shot, open: boolean): void {
  const w = p.w;
  const a = w.project(s.o);
  if (a.depth < 0x40) return;
  let pic: number;
  if (open && s.tier === 1) {
    if (s.opened >= 0xa) s.opened = 5;
    pic = PIC.open1 + s.opened;
  } else if (open && s.tier === 2) {
    if (s.opened >= 0xd) s.opened = 7;
    pic = PIC.open2 + s.opened;
  } else if (open && s.tier === 3) {
    if (s.opened >= 9) s.opened = 8;
    pic = PIC.open3 + s.opened;
  } else {
    if (++s.flag >= 8) s.flag = 0;
    pic = PIC.decoy + s.flag;
  }
  w.sprite(p.pic(pic), a.y, a.x, a.depth);
}

