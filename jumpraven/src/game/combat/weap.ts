/**
 * The weapons ship — RAVEN.EXE 0x429314 … 0x42ab18: one of the EXE's records
 * at 0x43ac5c, the fuel station's record and streets (src/game/combat/fuel.ts)
 * flown 0x12c up: the HUD calls it in when the ammunition runs low
 * (0x4183c1), it flies the streets to the beacon, waits there for the craft
 * to come up under it, and the dealer's Mart opens (0x410540 with
 * `mart.move`).
 *
 * ## How it moves (0x42982f)
 *
 *   0 … 4  the station's, wobbling up to 0x2a across the street, blocked by
 *      blocks and copters (0x42aa3d)
 *   5  in the beacon's cell, to its centre; the dealer calls the craft in
 *      (2, 5 with enemies about, else 8)
 *   6  wait, 500 frames at most (then 2, 7), for the craft at rest 0xe6 up or
 *      more, facing its way or the other, within 0x14 of it: the Mart; then
 *      the beacon off and away
 *   7  on to its cell's edge when that is clear, and choose again (0)
 *   8  killed: turning 8 a frame and sinking one, 0x1f … 0x2e frames, then it
 *      blows up fore and aft
 *
 * Every frame it bumps the craft if it meets it (0x41b820, 0x10e0 within
 * 0x19): a flash and a clang. A hit (0x42a7f8) is taken within its reach +
 * 0x3c across and half that up and down, and costs its strength
 * (`[0x43cfc6]`) — the dealer complains the first time (2, 6); killing it
 * costs 150 points. Its pictures (WEAP, 0x120) are the station's, from 0x20
 * on.
 */
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import type { WeapApi } from "./api";
import { approach, callDepot, craftOver, depotWhere, driveDepot, driveOff, drawDepot, newDepot, shiftDepot } from "./fuel";
import { objOf } from "./jeep";
import { tooFar } from "./lib";
import { KIND, cosMul, readPictures, setObj, sinMul, type Obj, type World } from "./world";

/** who the dealer is on the comms (0x4142b9's 2) */
const DEALER = 2;

export class Weap implements WeapApi {
  /** 0x43acd0: WEAP's pictures (0x429314, read once at startup) */
  private readonly pics: (FrameV0 | undefined)[];
  /** 0x43ac5c */
  private readonly r = newDepot();
  /**
   * 0x410540(1) is due: the craft came up under the ship. The EXE opens the
   * Mart (after `mart.move`) inside the ship's frame (0x42a3d7); the flight
   * plays it after the frame and clears this. The ship has already gone on
   * (the beacon off, 7).
   */
  mart = false;

  constructor(
    readonly w: World,
    pictures: Uint8Array,
  ) {
    this.pics = readPictures(pictures);
  }

  /** 0x429355: gone (a flight's start, and when the pods come down, 0x40b5c8) */
  reset(): void {
    this.r.self = -1;
  }

  /** 0x42aa3d: a block or a copter's cell */
  private readonly blocked = (x: number, y: number): boolean => this.w.solid(x, y) || this.w.copter.occupied(x, y, -1);

  /** 0x429360 */
  callIn(): void {
    callDepot(this.w, this.r, this.blocked, 0x12c, this.w.params.x43cfc6);
    this.w.comms.ask(DEALER, 4);
  }

  /** 0x4296c7: gone once nine cells off when it is not the beacon's; else it moves, bumps the craft, and is drawn */
  frame(): void {
    const w = this.w;
    const r = this.r;
    if (r.self < 0) return;
    if (tooFar(w, r) && !r.called) {
      r.self = -1;
      return;
    }
    setObj(r.last, r);
    this.think();
    if (w.pyro.hitsCraft(r.last, r, 0x10e0, 0x19)) {
      this.flash(r);
      w.sound(0x31);
    }
    drawDepot(w, r, this.pics, 0x20);
  }

  /** 0x4297db: pyro's burst picture over `o`, just in front of it */
  private flash(o: Obj): void {
    const w = this.w;
    const p = w.project(o);
    if (p.depth < 0x40) return;
    let n = (p.depth - 0x40) >> 7;
    if (n >= 0x10) n = 0xf;
    w.sprite(w.pyro.pics[0xc0 + n], p.y, p.x, p.depth - 1, false);
  }

  /** 0x42982f */
  private think(): void {
    const w = this.w;
    const r = this.r;
    switch (r.state) {
      case 0:
      case 1:
      case 2:
      case 3:
      case 4:
        return driveDepot(w, r, this.blocked, 0x2a, () => this.think());
      case 5:
        if (!approach(w, r)) return;
        r.state = 6;
        w.comms.ask(DEALER, w.pyro.x41d396(r) ? 5 : 8);
        r.wait = 0x1f4;
        return;
      case 6: {
        if (--r.wait <= 0) {
          w.comms.ask(DEALER, 7);
          return this.served();
        }
        const a = w.cam.angle;
        if (w.cam.z < 0xe6 || w.speed !== 0) return;
        if (a !== r.angle && ((a + 0x80) & 0xff) !== r.angle) return;
        if (!craftOver(w, r)) return;
        this.mart = true;
        return this.served();
      }
      case 7:
        driveOff(r, this.blocked);
        return;
      case 8: {
        // 0x42a4dc: going down
        r.angle = (r.angle + 8) & 0xff;
        r.z--;
        if (--r.way > 0) return;
        const fore = objOf(r);
        fore.x += cosMul(fore.angle, 0x20);
        fore.y += sinMul(fore.angle, 0x20);
        fore.z += 0xc;
        w.pyro.burst(fore, 0, 0, 0);
        const aft = objOf(r);
        aft.x += cosMul(aft.angle, -0x20);
        aft.y += sinMul(aft.angle, -0x20);
        aft.z += 0xc;
        w.pyro.burst(aft, 0, 0, 0);
        r.self = -1;
        return;
      }
    }
  }

  /** 0x42a3df: the beacon off, no longer the beacon's, and away (7) */
  private served(): void {
    this.w.hud.x417d33();
    this.r.called = 0;
    this.r.state = 7;
  }

  /**
   * 0x42a7f8 (0x41b70b's list, and 0x41b7a9's while it is waiting): within
   * `reach` + 0x3c across and half that up and down, not going down; killed,
   * −150 points, a fireball behind it, and it goes down (8) 0x1f … 0x2e frames
   */
  hit(a: Obj, b: Obj, dmg: number, reach: number): boolean {
    const w = this.w;
    const r = this.r;
    if (r.self < 0 || r.state === 8) return false;
    const across = reach + 0x3c;
    const up = Math.trunc(across / 2);
    if (r.z - up > a.z && r.z - up > b.z) return false;
    if (r.z + up < a.z && r.z + up < b.z) return false;
    if (r.x - across > a.x && r.x - across > b.x) return false;
    if (r.x + across < a.x && r.x + across < b.x) return false;
    if (r.y - across > a.y && r.y - across > b.y) return false;
    if (r.y + across < a.y && r.y + across < b.y) return false;
    r.strength -= dmg;
    if (!r.complained) {
      r.complained = 1;
      w.comms.ask(DEALER, 6);
    }
    if (r.strength > 0) return true;
    w.hud.addScore(-0x96);
    const at = objOf(r);
    at.x += cosMul(at.angle, -0x20);
    at.y += sinMul(at.angle, -0x20);
    at.z += 0x12;
    w.pyro.burst(at, 0, 0, 0);
    r.way = w.roll(0x10) + 0x1e;
    r.state = 8;
    if (r.called) w.hud.x417d33();
    r.called = 0;
    return true;
  }

  /** 0x42a99e */
  shift(dx: number, dy: number): void {
    shiftDepot(this.r, dx, dy);
  }

  /** 0x42a9f4 */
  count(): number {
    return this.r.self < 0 ? 0 : 1;
  }

  /** 0x42aa01 */
  nth(k: number): { obj: Obj; kind: number; flag: number; dying: number } {
    if (k >= 1 || this.r.self < 0) throw new Error("0x42aa01: no such weapons ship (0x41e28a 0x6b, 0xb8)");
    return { obj: objOf(this.r), kind: KIND.weap, flag: 0, dying: 0 };
  }

  /** 0x42aa71: up and in cell (x, y) — its cell only, not the one it is going to */
  x42aa71(x: number, y: number): boolean {
    const r = this.r;
    return r.self >= 0 && r.cellX === x && r.cellY === y;
  }

  /** 0x42aa99 */
  where(): Obj | null {
    return depotWhere(this.w, this.r);
  }
}
