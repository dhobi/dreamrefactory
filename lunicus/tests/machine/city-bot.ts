/**
 * A player for the city: it fights what it sees, turns to what lines up with
 * it, and when its ammo runs low walks into a building, empties the cabinets
 * and rides the elevator down again. It plays through the page's own input —
 * keys, clicks, a held button — and knows only what the screen would show a
 * player: what is in view, and where; it aims a shot's rise from the distance,
 * as a player learns to.
 */
import { FORWARD, LEFT, RIGHT } from "../../src/game/data";
import { placeOf, type City } from "../../src/game/city/city";
import { moved, type Pose } from "../../src/game/maze";
import { fail, type Headless } from "./harness";

const TURN_L = [3, 2, 0, 1];
const id = (p: Pose): string => `${p.x},${p.y},${p.dir}`;

export class CityBot {
  kills = 0;
  shots = 0;
  trips = 0;
  private lastEnemies = 10000;
  /** elevator rides taken to top up before the final chamber */
  private rides = 0;
  /** tries in a row a step was blocked with nothing to fight */
  private stuck = 0;

  constructor(readonly h: Headless) {}

  get g() {
    return this.h.game;
  }
  get m() {
    return this.h.game.m;
  }
  get c(): City {
    const c = this.g.city;
    if (!c) fail(`not in a city or building (${this.g.phase}, level ${this.g.progress.level})`);
    return c;
  }

  /** wait until the level has handled everything given it */
  private settle(max = 2000): void {
    const c = this.g.city;
    for (let k = 0; k < 20; k++) {
      this.h.until(() => this.g.city !== c || this.g.phase !== "city" || this.m.filmWaiting || (!c!.busy && !this.m.events.length && !this.m.film), "the city to take its input", max);
      if (!this.m.filmWaiting) return;
      // a film that waits for a click: the harness answers it as a player would
      const hs = this.m.filmHotspots;
      const out = hs.find((s) => [1, 3].includes(Math.abs(s.type))) ?? [...hs].sort((a, b) => b.top - a.top)[0];
      this.h.input.click((out.left + out.right) >> 1, (out.top + out.bottom) >> 1);
      this.h.until(() => !this.m.events.length, "the film to take the click", 200);
    }
  }

  private key(k: string): void {
    this.h.input.press(k);
    this.settle();
  }

  /** fire at whatever is in view that this ammo can reach; answers whether it did */
  fight(): boolean {
    const { c, g, m } = this;
    const w = c.world;
    if (w.maze.byte(w.pose) !== 0 && !c.building) {
      // a click in a weapon's mode would go through the door: face away first
      this.key("d");
      return true;
    }
    // the drones last: 3 and on
    const foes = [c.tank.o, c.jeep.o, c.wasp.o, ...c.drones.map((d) => (d.hit ? null : d.o))];
    for (const [i, o] of foes.entries()) {
      if (!o || !w.visible(o)) continue;
      const pt = w.project(o);
      // a vehicle too close to be drawn is still there, shelling: fire straight at it
      if (pt.depth < 0x19a && (i >= 2 || pt.depth < 0)) continue;
      const node = i === 2 && !c.wasp.wasp;
      // a rocket flies at where the flyer was: only worth it when it is coming straight on
      const coming = ((o.angle - w.cam.angle) & 0xff) === 0x80;
      // in the hive, where the wasps are what hurts, every rocket is worth one
      const spare = node || g.hud.enemies <= 0 || placeOf(g.progress.level) === 3 ? 640 : 640 * 3;
      // out of bullets and grenades, a rocket is what is left for a vehicle
      const dry = g.hud.bullets < 12 && g.hud.grenades < 160;
      // day 6 halves the gun and the grenades but not the rockets: a rocket is a vehicle's end (900 of its 800)
      const hive = placeOf(g.progress.level) === 3;
      const rocket = (i === 2 && coming && pt.depth < 1600 && g.hud.rockets >= spare) || (i < 2 && (dry || hive) && g.hud.rockets >= 640);
      // close up, a grenade climbs to a flyer's height where a bullet cannot
      // close up, a grenade climbs to a flyer's height where a bullet cannot — the wasp's, and a drone's
      const lob = i >= 2 && pt.depth < 800 && g.hud.grenades >= 160;
      const bullets = !rocket && !lob && g.hud.bullets >= 12 && !(hive && i < 2 && g.hud.grenades >= 160);
      const grenade = !rocket && !bullets && (i < 2 || lob) && g.hud.grenades >= 160;
      if (!rocket && !bullets && !grenade) continue;
      const k = Math.max(1, Math.round((pt.depth - 0xfc) / (grenade ? 40 : 60)) + 1);
      // a drone flies where it likes: the screen shows how high
      const zt = i === 0 ? 55 : i === 1 ? 60 : i === 2 ? 284 : o.z;
      const vz = Math.round((zt - (w.cam.z + 10)) / k) + (grenade ? Math.round(k / 16) : 0);
      // a bullet rises at most 24 a step: the wasp and the node only from far enough
      if (i >= 2 && !rocket && vz > 24) continue;
      if (i >= 2 && grenade && vz < 8) continue;
      const y = Math.max(0, Math.min(240, 220 - 9 * vz));
      const x = Math.max(0, Math.min(383, pt.x));
      const hand = this.h.input;
      hand.press(rocket ? "l" : grenade ? "k" : "j");
      hand.move(x, y);
      hand.down(x, y);
      // a rocket is one a click: let go at once; the gun and the grenades fire while the button is held
      if (rocket) hand.up(x, y);
      this.shots++;
      this.h.frame(rocket ? 6 : 12);
      if (!rocket) hand.up(x, y);
      this.settle();
      this.count();
      return true;
    }
    let want = -1;
    const cx = w.cam.cellX;
    const cy = w.cam.cellY;
    for (const o of foes) {
      if (!o) continue;
      if (o.cellX === cx && o.cellY !== cy) want = o.cellY < cy ? 0 : 1;
      else if (o.cellY === cy && o.cellX !== cx) want = o.cellX > cx ? 2 : 3;
      if (want >= 0) break;
    }
    if (want >= 0 && want !== w.pose.dir) {
      this.key(TURN_L[w.pose.dir] === want ? "a" : "d");
      return true;
    }
    return false;
  }

  private count(): void {
    // a bar filled again (the final chamber) counts down from full
    if (this.g.hud.enemies > this.lastEnemies) this.lastEnemies = this.g.hud.enemies;
    if (this.g.hud.enemies < this.lastEnemies) {
      this.kills++;
      this.lastEnemies = this.g.hud.enemies;
    }
  }

  /** a step toward the nearest of `goals` by the maze's transitions; false when there is none */
  private stepToward(goals: Pose[]): boolean {
    const w = this.c.world;
    const from = w.pose;
    const want = new Set(goals.map(id));
    if (want.has(id(from))) return false;
    // the way round a vehicle standing in the road, if there is one; else the road
    const parked = [this.c.tank.o, this.c.jeep.o].map((o) => `${o.cellX},${o.cellY}`);
    const search = (avoid: string[]) => {
      const prev = new Map<string, { p: Pose; move: number } | null>([[id(from), null]]);
      const queue = [from];
      let end: Pose | null = null;
      while (queue.length && !end) {
        const p = queue.shift()!;
        for (const move of [FORWARD, LEFT, RIGHT]) {
          const q = moved(p, move);
          if (prev.has(id(q)) || !w.maze.transition(p, q)) continue;
          if (move === FORWARD && avoid.includes(`${q.x},${q.y}`)) continue;
          prev.set(id(q), { p, move });
          if (want.has(id(q))) (end = q), queue.length = 0;
          queue.push(q);
        }
      }
      return { prev, end };
    };
    let { prev, end } = search(parked);
    if (!end) ({ prev, end } = search([]));
    if (!end) fail(`no way from ${id(from)} in ${w.maze.name}`);
    let at = end;
    let first = prev.get(id(at))!;
    while (id(first.p) !== id(from)) (at = first.p), (first = prev.get(id(at))!);
    const before = id(from);
    this.key(first.move === FORWARD ? "w" : first.move === LEFT ? "a" : "d");
    if (this.g.city && id(this.g.city.world.pose) === before && this.g.city.world.maze === w.maze) {
      // something is in the way: deal with it, or wait for it
      if (!this.fight()) {
        this.h.frame(30);
        this.stuck++;
      }
    } else this.stuck = 0;
    return true;
  }

  /** walk to one of `goals`, fighting on the way; false if the level changed under it */
  walkTo(goals: Pose[], max = 4000): boolean {
    const c = this.c;
    this.stuck = 0;
    for (let i = 0; i < max; i++) {
      if (this.g.city !== c || this.g.phase !== "city") return false;
      // blocked with nothing to clear the way: give up this walk
      if (this.stuck >= 20) return false;
      if (this.fightIfThreatened()) continue;
      if (!this.stepToward(goals)) return true;
    }
    fail(`no way to ${goals.map(id).join(" ")} in ${max} steps from ${id(c.world.pose)}`);
  }

  /** shoot only what is close enough to be shooting back */
  private fightIfThreatened(): boolean {
    const w = this.c.world;
    for (const o of [this.c.tank.o, this.c.jeep.o, this.c.wasp.o, ...this.c.drones.map((d) => d.o)]) if (w.visible(o) && w.project(o).depth < 1800) return this.fight();
    return false;
  }

  /** low enough that a building is worth the walk */
  private hungry(): boolean {
    const h = this.g.hud;
    return h.bullets < 3000 || (h.enemies <= 0 && h.rockets < 1280);
  }

  /** a building or an engine room: the cabinets, then the elevator's down button */
  private restock(): void {
    const c = this.c;
    const w = c.world;
    for (let guard = 0; guard < 40 && this.g.city === c; guard++) {
      const full = w.maze.poses().filter((p) => w.maze.byte(p) === 2);
      if (!full.length || c.stock.every((n) => n <= 0)) break;
      if (!this.walkTo(full)) return;
      this.h.input.press("h");
      this.h.input.click(192, 132);
      this.settle();
    }
    if (this.g.city !== c) return;
    const doors = w.maze.poses().filter((p) => w.maze.byte(p) === 3);
    if (!this.walkTo(doors)) return;
    this.h.input.press("h");
    this.h.input.click(192, 132);
    this.h.until(() => this.m.filmWaiting || this.g.city !== c, "the elevator's buttons", 20000);
    if (this.m.filmWaiting) {
      // its bottom button: down, and out at the first floor
      const b = this.m.filmHotspots[1];
      this.h.input.click((b.left + b.right) >> 1, (b.top + b.bottom) >> 1);
    }
    this.h.until(() => this.g.city !== c, "the elevator to take the player out", 20000);
    this.h.until(() => !!this.g.city?.world || this.g.phase !== "city", "the street", 20000);
  }

  /** walk to one of `goals` and use what it faces; false if there is none or the level changed on the way */
  private useAt(goals: Pose[]): boolean {
    const c = this.c;
    if (!goals.length || !this.walkTo(goals) || this.g.city !== c) return false;
    this.h.input.press("h");
    this.h.input.click(192, 132);
    this.settle();
    return true;
  }

  /**
   * The hive and the final chamber: fight; low on ammo, the cabinets, and with
   * them empty the switch that fills them; with the ENEMIES bar empty the
   * elevator down, and in the final chamber the queen.
   */
  private hive(): void {
    const c = this.c;
    const w = c.world;
    const poses = (b: number): Pose[] => w.maze.poses().filter((p) => w.maze.byte(p) === b);
    if (this.fight()) return;
    // the final chamber gives nothing back but its cabinets: go down full. The hive's elevator
    // refills its cabinets only while the bar has something left — so top up before the last of it
    const hd0 = this.g.hud;
    if (this.g.progress.level === 0x15 && hd0.enemies > 0 && hd0.enemies < 2000 && this.rides < 3 && (hd0.energy < 9000 || hd0.shields < 9000)) {
      this.trips++;
      if (c.stock.some((n) => n > 0) && this.useAt(poses(2))) return;
      this.rides++;
      if (this.useAt(poses(3))) {
        this.h.until(() => this.g.city !== c || this.g.phase !== "city", "the hive's elevator", 20000);
        this.h.until(() => !!this.g.city?.world || this.g.phase !== "city", "the hive again", 20000);
      }
      return;
    }
    if (this.g.hud.enemies <= 0) {
      if (this.g.progress.level === 0x15) {
        this.trips++;
        this.useAt(poses(3));
        this.h.until(() => this.g.city !== c || this.g.phase !== "city", "the hive's elevator", 20000);
        this.h.until(() => !!this.g.city?.world || this.g.phase !== "city", "the final chamber", 20000);
      } else {
        // the queen: her films and her talk, played through as a player would
        if (!this.walkTo(poses(8)) || this.g.city !== c) return;
        this.h.input.press("h");
        this.h.input.click(192, 132);
        // the end's film runs its credits once, then loops their last page until a click (every frame is an exit)
        this.h.settle("the queen", 200_000, () => {
          if (this.m.film === "final.move" && / frame 753 of /.test(this.m.where) && !this.m.events.length) this.h.input.click(192, 132);
        });
      }
      return;
    }
    // the hive hits hard: shields and energy are worth the walk too
    const hd = this.g.hud;
    const hurt = hd.shields < 5000 || hd.energy < 7000 || hd.bullets < 3000 || hd.rockets < 1280;
    if (this.hungry() || hurt) {
      this.trips++;
      if (c.stock.some((n) => n > 0) && this.useAt(poses(2))) return;
      if (this.useAt(poses(9))) return;
      // the hive's elevator: a ride, and back to the hive with its cabinets full (0x4022e5, and 0x4017b8 as it opens)
      if (this.g.progress.level === 0x15 && this.useAt(poses(3))) {
        this.h.until(() => this.g.city !== c || this.g.phase !== "city", "the hive's elevator", 20000);
        this.h.until(() => !!this.g.city?.world || this.g.phase !== "city", "the hive again", 20000);
        return;
      }
    }
    this.h.frame(3);
    this.count();
  }

  /** the city until the node is gone, the engine rooms until the hive, the hive until the queen: answers when the player has left them, or `done` */
  play(max = 60000, done: () => boolean = () => false): void {
    const t0 = Date.now();
    for (let step = 0; step < max && !done(); step++) {
      if (process.env.BOTLOG && step % +(process.env.BOTLOG === "1" ? 500 : process.env.BOTLOG) === 0) console.log(`  bot step ${step} ${Date.now() - t0} ms, tick ${this.m.ticks}, level ${this.g.progress.level}, pose ${this.g.city ? id(this.g.city.world.pose) : "-"}, energy ${this.g.hud.energy}, shields ${this.g.hud.shields}, enemies ${this.g.hud.enemies}, node ${this.g.city ? !this.g.city.wasp.wasp : "-"}, ammo ${this.g.hud.bullets}/${this.g.hud.grenades}/${this.g.hud.rockets}`);
      if (this.g.phase !== "city") return;
      const c = this.c;
      if (c.world.state === 1 || c.next !== null) {
        this.h.until(() => this.g.phase !== "city" || this.g.city !== c, "the level to change", 20000);
        continue;
      }
      const place = placeOf(this.g.progress.level);
      if (place === 3) {
        this.hive();
        continue;
      }
      if (place === 1) {
        this.restock();
        continue;
      }
      // an engine room: the enemies come to the player; low on ammo, or with the bar empty, the cabinets and the elevator down
      if (place === 2) {
        if (this.fight()) continue;
        if (this.hungry() || this.g.hud.enemies <= 0) {
          this.trips++;
          this.restock();
        } else this.h.frame(3), this.count();
        continue;
      }
      if (this.fight()) continue;
      if (this.hungry()) {
        this.trips++;
        const doors = c.world.maze.poses().filter((p) => {
          const b = c.world.maze.byte(p);
          return b >= 1 && b < 0xf;
        });
        if (this.walkTo(doors) && this.g.city === c) {
          this.h.input.press("h");
          this.h.input.click(192, 132);
          this.h.until(() => this.g.city !== c, "the building's door", 20000);
          this.h.until(() => !!this.g.city?.world || this.g.phase !== "city", "the building", 20000);
        }
        continue;
      }
      this.h.frame(3);
      this.count();
    }
    if (!done()) fail(`the city is not done after ${max} steps: ${JSON.stringify(this.g.hud)}`);
  }
}
