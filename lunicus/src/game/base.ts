/**
 * The moon base: a floor's maze, its crew and what its cells do — the EXE's
 * base mode, 0x40cb8c, which the level dispatcher (0x40ad60) sends a base
 * level's events to.
 *
 * ## Opening a floor (0x40cdfb)
 *
 * The HUD is set for the base — bio full, shields, ammo and enemies empty, the
 * navigation button down — and the player stands at an elevator: (3,11) facing
 * east when `[0x42d1c4]` is 0, else (15,11) facing west. The first visit of a
 * day to the lower floor wakes in bed instead, (4,6) facing west, and moves the
 * day's progress `[0x42d1c8]` from 0 to 1.
 *
 * ## A click on the view (0x40d7e0)
 *
 * The cell's byte for the facing says what is there. 0 is open floor: the click
 * walks — once for each of the depth rects (`WALK_RECTS`) it is inside, then
 * turns toward the side it is on — until a wall, another click or key, or a
 * figure's cell stops it. Anything else is a thing: a click in the middle
 * third uses it (the lower floor's 0x401299, the upper's 0x40103e), and the
 * outer thirds turn. 0xfe, from row 18 down, is the transporter: on the lower
 * floor the briefing (`brief.move`, progress 1 → 2, and on day one straight
 * on to 4); on the upper floor the guard's say.
 *
 * ## The day's progress, `[0x42d1c8]`
 *
 *   0  a new day            1  awake (the lower floor's first visit)
 *   2  briefed              4  briefed on day one, or back from the city
 *
 * The bed (byte 6, lower floor) sleeps only at 4 (`sleep.move`, then day + 1:
 * the level four on) and says INAPPROPRIATE BEDTIME before.
 */
import { decodeFrameV0, type FrameV0 } from "@dreamfactory/engine/df/image-v0";
export type { Hud } from "./panel";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import {
  BAR_FULL, FORWARD, LEFT, LOWER, MSG, RIGHT, UPPER, VIEW_H, VIEW_W, WALK_RECTS, dayOf, floorOf, FRAME_TICKS, CELL,
} from "./data";
import { clickFigure, drawnAt, live, loadCrew, type Drawn, type Figure } from "./crew";
import { playFilm } from "./film";
import type { Co, Machine } from "./machine";
import { MazeView, camera, moved, type Camera, type Pose } from "./maze";
import { Panel, type Hud } from "./panel";
import { inRect, type Rect } from "./screen";
import { talk, talkNumber, type TalkState } from "./talk";

/** everything a saved game would hold, and what a machine test reads */
export interface Progress {
  level: number;
  /** `[0x42d1c0]`: where the last floor change came from (1 below, 2 above …) */
  came: number;
  /** `[0x42d1c4]`: which elevator: 0 the west one, 1 the east */
  elevator: number;
  /** `[0x42d1c8]`: the day's progress */
  day: number;
  suit: boolean;
  weapon: boolean;
  /** `[0x42c15c]`: Settings ▸ Beginner 1 … Expert 4 — Intermediate on a new install; a save carries it */
  difficulty: number;
}

/** the view's rect on the screen */
const VIEW: Rect = [0, 0, VIEW_H, VIEW_W];

export class Base {
  maze!: MazeView;
  pose: Pose = { x: 0, y: 0, dir: 0 };
  /** the view at rest, `[0x42e094]` */
  rest = -1;
  crew: Figure[] = [];
  /** the maze picture under the figures */
  private readonly view = new Uint8Array(VIEW_W * VIEW_H);
  private lastPresent = -FRAME_TICKS;
  cam: Camera = camera({ x: 0, y: 0, dir: 0 }, 0, 0, 3);
  /** set by whatever ends the floor: the level to go to */
  next: number | null = null;
  readonly talkState: { talk: TalkState | null } = { talk: null };
  /** every film the floor has played, by the game's name */
  films: string[] = [];
  /** handling a click, a key or a talk — not waiting for the player */
  busy = false;

  constructor(
    readonly m: Machine,
    readonly p: Progress,
    readonly hud: Hud,
    readonly panelUi: Panel,
    readonly clut: Uint8ClampedArray,
    readonly sounds: Uint8Array[],
  ) {}

  get floor(): number {
    return floorOf(this.p.level);
  }
  get day(): number {
    return dayOf(this.p.level);
  }

  /* ----------------------------------------------------------------------- *
   * Opening
   * ----------------------------------------------------------------------- */

  *open(prev = 0): Co {
    const { m, p, hud } = this;
    // 0x40d014: from anywhere but the base, the base's bank and its ambience again
    if (!floorOf(prev)) {
      m.setAmbience("moonsound", this.sounds);
      m.playAmbience();
    }
    hud.enemies = 0;
    hud.shields = 0;
    hud.energy = BAR_FULL;
    hud.mode = 2;
    this.pose = p.elevator === 0 ? { x: 3, y: 11, dir: 2 } : { x: 15, y: 11, dir: 3 };
    if (this.floor === UPPER) {
      if (p.day === 3) {
        p.day = 4;
        this.pose = { x: 9, y: 20, dir: 2 };
        p.suit = p.weapon = true;
      }
    } else if (p.day === 0) {
      p.day = 1;
      this.pose = { x: 4, y: 6, dir: 3 };
    }
    const name = this.floor === UPPER ? "upperbase" : "lowerbase";
    const { data } = yield* m.file(name, this.day);
    this.maze = new MazeView(name, data);
    this.rest = this.maze.restFrame(this.pose);
    if (this.rest < 0) throw new Error(`${name}: no view at ${JSON.stringify(this.pose)}`);
    this.crew = yield* loadCrew(m, this.floor, this.day);
    // 0x410c99 (0x13 upper, 0x14 lower): the floor's map, the crew and the player on it (0x40db1e)
    this.panelUi.side = {
      picture: this.floor === UPPER ? 0x13 : 0x14,
      marks: () => [...this.crew.map((f) => ({ cellX: f.at.cellX, cellY: f.at.cellY, ink: 0x78 })), { cellX: this.cam.cellX, cellY: this.cam.cellY, ink: 0x74 }],
      key: () => `${this.pose.x},${this.pose.y},${this.pose.dir} ${this.cam.cellX},${this.cam.cellY}`,
    };
    // 0x40de55: the base's radar shows the crew on the floor
    this.panelUi.radar = () => ({ cam: this.cam, blips: this.crew.map((f) => ({ x: f.at.x, y: f.at.y, dot: false })), nodeOut: false });
    m.log(`${name} (level ${p.level}, day ${this.day}): at ${this.pose.x},${this.pose.y} facing ${this.pose.dir}; crew ${this.crew.map((c) => `${c.name} (${c.home.cellX},${c.home.cellY})`).join(", ")}`);
    m.screen.setPalette(this.clut);
    this.showRest();
    this.drawPanel();
    yield* this.present();
  }

  /** draw the view at rest into the maze picture (0x402e9f with `[0x42e094]`) */
  private showRest(): void {
    this.showFrame(this.rest);
  }

  private showFrame(container: number): void {
    const px = this.maze.draw(container, this.m.draws);
    if (px) this.view.set(px.subarray(0, VIEW_W * VIEW_H));
  }

  /* ----------------------------------------------------------------------- *
   * Drawing
   * ----------------------------------------------------------------------- */

  /** the figures as the camera sees them, farthest first (0x409a8d) */
  figures(): Drawn[] {
    return this.crew
      .map((f) => drawnAt(f, this.cam, this.maze.has))
      .filter((d): d is Drawn => !!d)
      .sort((a, b) => b.depth - a.depth);
  }

  /** the guard posts on the upper floor while the player is armed (0x405f76) */
  private posts(): Figure[] {
    const guard = this.crew.find((c) => c.name === "guard");
    if (!guard || !this.armed()) return [];
    return [
      [7, 0xe],
      [0xb, 0xe],
    ].map(([cx, cy]) => {
      const at = { angle: 0x40, x: cx * CELL + 0xd2, y: cy * CELL + 0x7e, z: 0x78, cellX: cx, cellY: cy };
      return { ...guard, name: "post", at, home: at, target: at, state: 0 };
    });
  }

  /**
   * A frame of the view: the crew live a frame, the maze and the figures on
   * top, three ticks after the last (0x40d37e, 0x40d662). Answers a figure
   * that has just walked up to talk.
   */
  *present(): Co<Figure | null> {
    let talker: Figure | null = null;
    for (const f of this.crew) if (live(f, this.cam) && !talker) talker = f;
    if (this.m.draws) {
      this.m.screen.put(this.view, VIEW_W, VIEW_H, 0, 0);
      for (const d of [...this.figures(), ...this.posts().map((f) => drawnAt(f, this.cam, this.maze.has)).filter((d): d is Drawn => !!d)])
        this.m.screen.spriteScaled(d.frame, d.rect, d.clip);
    }
    while (this.m.ticks < this.lastPresent + FRAME_TICKS) yield;
    this.lastPresent = this.m.ticks;
    // 0x40d659, 0x40d774: every frame ends with the panel redrawn — its radar and its map live
    this.drawPanel();
    this.updateHud();
    return talker;
  }

  drawPanel(): void {
    this.panelUi.draw();
  }

  say(n: number): void {
    this.panelUi.say(n);
  }

  private updateHud(): void {
    this.panelUi.tick();
  }

  /* ----------------------------------------------------------------------- *
   * Moving
   * ----------------------------------------------------------------------- */

  /** 0x4061f3: carrying the suit or the gun on the upper floor */
  armed(): boolean {
    return (this.p.suit || this.p.weapon) && this.floor === UPPER && !(this.day === 5 && this.p.day === 2);
  }

  /** 0x40d091: a move; false when a wall, or the guard, stops it */
  *move(kind: number): Co<boolean> {
    if (this.armed() && this.pose.y <= 0xe && this.pose.dir === 0 && kind === FORWARD) {
      yield* this.converse("guard", 7);
      return false;
    }
    const to = moved(this.pose, kind);
    const t = this.maze.transition(this.pose, to);
    if (!t) return false;
    const n = MazeView.framesOf(t);
    // the film's first frame is the view already up; decoding it keeps the delta chain whole
    this.showFrame(t.firstFrame);
    for (let i = 1; i <= n; i++) {
      this.showFrame(t.firstFrame + i);
      this.cam = camera(this.pose, to.dir, i, kind);
      yield* this.present();
    }
    this.pose = to;
    this.cam = camera(this.pose, this.pose.dir, 0, kind);
    this.rest = this.maze.restFrame(this.pose);
    if (this.rest < 0) throw new Error(`${this.maze.name}: no view at ${JSON.stringify(to)}`);
    return true;
  }

  /** 0x40d29b: a figure stands in the view's cell */
  private figureHere(): boolean {
    return this.crew.some((f) => f.home.cellX === this.cam.cellX && f.home.cellY === this.cam.cellY);
  }

  /** 0x40d77d: what a click on a thing does — 1 turn left, 2 right, 3 use it */
  private classify(y: number, x: number): number {
    if (this.maze.byte(this.pose) === 2 && inRect(WALK_RECTS[0], y, x)) return 3;
    if (x < 0x60) return LEFT;
    if (x > 0x120) return RIGHT;
    return 3;
  }

  /** mouse-down or a key waiting: what stops a click's walk (0x414d99, mask 10) */
  private interrupted(): boolean {
    return this.m.events.some((e) => e.kind === "down" || e.kind === "key");
  }

  /* ----------------------------------------------------------------------- *
   * Clicks and keys
   * ----------------------------------------------------------------------- */

  /** 0x4175c3: help, save or navigation pressed */
  private *button(i: number): Co {
    this.hud.mode = i;
    if (i === 0) yield* this.panelUi.help(this.day, () => this.showRest(), this.clut);
    if (i === 1 && this.panelUi.save) yield* this.panelUi.save();
    if (this.hud.mode === 1) this.hud.mode = 2;
  }

  /**
   * 0x417412: a menu command, between one thing and the next — File ▸ Save as
   * the save button, Help ▸ Help as the help button, Settings ▸ Keys its
   * dialog (0x417495), File ▸ Exit the game ended there and then (0x41745e), no
   * confirmation, the title again.
   */
  private *command(c: { menu: number; item: number }): Co {
    if (c.menu === 2 && c.item === 3) yield* this.button(1);
    if (c.menu === 1 && c.item === 2) yield* this.button(0);
    if (c.menu === 4 && c.item === 6) yield* this.m.keysDialog();
    if (c.menu === 2 && c.item === 4) {
      this.m.log("File ▸ Exit: the game ended, the title again");
      Object.assign(this.p, { came: 0, elevator: 0, day: 0 });
      this.m.quitAsked = true;
      this.next = 0;
    }
  }

  /** 0x40cbd2: a mouse-down */
  *click(y: number, x: number): Co {
    if (!inRect(VIEW, y, x)) {
      // 0x410671 with no weapons (`[0x42b3e8]` 0): help, save and navigation; then 0x4175c3
      const i = Panel.buttonAt(y, x);
      if (i < 0) return yield* this.mapClick(y, x);
      if (i > 2) return;
      return yield* this.button(i);
    }
    if (this.hud.mode === 2) {
      for (const f of this.crew) {
        if (clickFigure(f, this.cam, this.maze.has, y, x)) {
          this.m.log(`${f.name} walks up`);
          return;
        }
      }
      for (const post of this.posts()) {
        if (post.home.cellX === this.cam.cellX && post.home.cellY === this.cam.cellY) {
          const d = drawnAt(post, this.cam, this.maze.has);
          if (d && inRect(d.rect, y, x)) return yield* this.converse("guard", 7);
        }
      }
    }
    const b = this.maze.byte(this.pose);
    if (!b) {
      for (const r of WALK_RECTS) {
        if (!inRect(r, y, x)) {
          yield* this.move(x > 0xc0 ? RIGHT : LEFT);
          return;
        }
        if (!(yield* this.move(FORWARD))) return;
        if (this.interrupted() || this.figureHere()) return;
      }
      return;
    }
    const kind = this.classify(y, x);
    if (b === 0xfe && this.pose.y >= 0x12 && kind === 3) return yield* this.transporter();
    if (kind === 3) return yield* this.use(b);
    yield* this.move(kind);
  }

  /**
   * 0x40dc45: a press on the floor's map — the player is there at once, if
   * the cell under the press, or one round it, has a view facing the way the
   * player faces (0x40ddaf), in a fade out and in. Armed on the upper floor,
   * not into the guarded north (0x4061f3).
   */
  private *mapClick(y: number, x: number): Co {
    const mx = x - VIEW_W;
    const my = this.floor === LOWER ? y + 12 : y;
    const cx = Math.trunc((mx - 0x13) / 5);
    const cy = Math.trunc((my - 0x67) / 5);
    if (this.armed() && cy <= 0xe) return;
    // the EXE's own order: never straight above or below
    const round: [number, number][] = [[0, 0], [-1, 0], [1, 0], [1, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [dx, dy] of round) {
      const to = { x: cx + dx, y: cy + dy, dir: this.pose.dir };
      const rest = this.maze.restFrame(to);
      if (rest < 0) continue;
      this.m.log(`the map: to ${to.x},${to.y}`);
      this.pose = to;
      this.cam = camera(to, to.dir, 0, FORWARD);
      this.rest = rest;
      yield* this.m.fadeOut();
      this.showRest();
      yield* this.present();
      yield* this.m.fadeIn(this.clut);
      return;
    }
  }

  /** 0x40cd18: a key — a step's key, held, keeps walking */
  *key(key: string): Co {
    // 0x40cd1b: the key table's first three actions are the steps; the modes are the city's
    const kind = [0, FORWARD, LEFT, RIGHT][this.m.action(key)] ?? 0;
    if (!kind) return;
    while ((yield* this.move(kind)) && this.m.keysHeld.has(key)) {}
  }

  /* ----------------------------------------------------------------------- *
   * What the cells do
   * ----------------------------------------------------------------------- */

  /** `[0x42e2ba]` the reactor's and the power station's score, once a visit */
  private charged = false;

  /**
   * a film over the view, then the view again (0x40166a); its word and deed
   * (0x40169e, 0x401714) are the lockers' messages and the power rooms' score
   */
  *film(name: string): Co {
    this.hud.message = -1;
    this.films.push(name);
    const b = this.maze.byte(this.pose);
    const word = (): Co => this.filmWord(b);
    const deed = (): Co => this.filmDeed(b);
    yield* playFilm(this.m, name, this.day, { word, deed });
    this.m.screen.setPalette(this.clut);
    this.showRest();
    this.drawPanel();
    yield* this.present();
  }

  private *filmWord(b: number): Co {
    if (this.floor !== UPPER) return;
    if (b === 4) this.say(this.p.weapon ? 0x11 : 0x10);
    if (b === 8) this.say(this.p.suit ? 0x1b : 0x1a);
  }

  private *filmDeed(b: number): Co {
    if (this.floor !== UPPER || this.charged) return;
    if (b === 3 || (b === 9 && (this.pose.dir === 2 || this.pose.dir === 3))) {
      for (let i = 0; i < 0x32; i++) {
        this.hud.score += 0x14;
        this.drawPanel();
        yield* this.m.wait(2);
      }
      this.charged = true;
    }
  }

  private sound(n: number): void {
    const s = this.sounds[n + 1];
    if (s) this.m.sound(s);
  }

  /** 0x401299 and 0x40103e */
  *use(b: number): Co {
    const p = this.p;
    this.m.log(`use ${b} at ${this.pose.x},${this.pose.y} facing ${this.pose.dir}`);
    if (this.floor === LOWER) {
      switch (b) {
        case 2: {
          // the elevator: its top button up; the bottom one to the engine rooms on day 5, else back out
          p.elevator = this.pose.dir === 3 ? 0 : 1;
          this.say(MSG.leavingFloor);
          let button = 0;
          this.films.push("lowerin.move");
          yield* playFilm(this.m, "lowerin.move", this.day, { word: function* (this: Base) { this.say(0x1d); }.bind(this), button: (b) => (button = b) });
          if (button === 0) {
            p.came = 2;
            this.films.push("upperout.move");
            yield* playFilm(this.m, "upperout.move", this.day);
            this.next = p.level - 1;
            return;
          }
          if (this.day === 5 && p.day === 2) {
            // 0x40134e: down to the first engine room (level 19), everything full
            p.came = 0;
            p.day = 0;
            this.films.push("engin1out.move");
            yield* playFilm(this.m, "engin1out.move", this.day);
            Object.assign(this.hud, { enemies: BAR_FULL, shields: BAR_FULL, energy: BAR_FULL, bullets: BAR_FULL, grenades: BAR_FULL, rockets: BAR_FULL, mode: 2 });
            this.next = 0x13;
            return;
          }
          this.films.push("enginback.move", "lowerout.move");
          yield* playFilm(this.m, "enginback.move", this.day);
          p.came = 1;
          yield* playFilm(this.m, "lowerout.move", this.day);
          this.next = p.level;
          return;
        }
        case 3:
          if (this.pose.x === 5) yield* this.film("info.move");
          if (this.pose.x === 0xd) yield* this.film("food.move");
          return;
        case 5:
          return this.say(MSG.nothingInDesk);
        case 6:
          if (p.day !== 4) return this.say(MSG.inappropriateBedtime);
          this.films.push("sleep.move");
          yield* playFilm(this.m, "sleep.move", this.day);
          p.came = 1;
          p.elevator = 0;
          p.day = 0;
          this.next = p.level + 4;
          return;
        case 9:
          return yield* this.film("cpanel.move");
      }
      return;
    }
    switch (b) {
      case 2: // the elevator down
        p.elevator = this.pose.dir === 3 ? 0 : 1;
        this.say(MSG.leavingFloor);
        this.films.push("upperin.move", "lowerout.move");
        yield* playFilm(this.m, "upperin.move", this.day, { word: function* (this: Base) { this.say(0x1d); }.bind(this) });
        p.came = 1;
        yield* playFilm(this.m, "lowerout.move", this.day);
        this.next = p.level + 1;
        return;
      case 3:
        return yield* this.film("reactor.move");
      case 4:
        yield* this.film(p.weapon ? "wpnput.move" : "wpnget.move");
        p.weapon = !p.weapon;
        return;
      case 8:
        yield* this.film(p.suit ? "suitput.move" : "suitget.move");
        p.suit = !p.suit;
        return;
      case 9:
        if (this.pose.dir === 0) yield* this.film("scope.move");
        if (this.pose.dir === 2) yield* this.film("ghouse.move");
        if (this.pose.dir === 3) yield* this.film("pwrstat.move");
        return;
      case 0x19:
        this.sound(3);
        return this.say(MSG.transformer);
      case 5:
        return this.say(MSG.nothingInDesk);
      case 0x18:
        return this.say(MSG.noUnauthorizedAccess);
      case 0x1a:
        return this.say(MSG.hydroponics);
      case 6:
        return this.say(MSG.privateBed);
    }
  }

  /** 0x40d82c: the transporter, and on the lower floor the briefing */
  *transporter(): Co {
    const p = this.p;
    if (this.floor === LOWER) {
      if (p.day !== 1) return this.say(MSG.briefingOver);
      this.m.speaker.stop();
      this.m.stopAmbience();
      yield* this.m.fadeOut();
      this.films.push("brief.move");
      yield* playFilm(this.m, "brief.move", this.day);
      this.showRest();
      this.drawPanel();
      yield* this.present();
      yield* this.m.fadeIn(this.clut);
      this.m.playAmbience();
      p.day = this.day === 1 ? 4 : 2;
      this.m.log(`briefed: progress ${p.day}`);
      return;
    }
    if (p.day === 2 && this.day >= 2 && this.day <= 4) {
      if (p.suit && p.weapon) {
        // 0x40d97f: down to the city, everything full
        yield* this.m.fadeOut();
        this.films.push("citydrop.move");
        yield* playFilm(this.m, "citydrop.move", this.day);
        Object.assign(this.hud, { enemies: BAR_FULL, shields: BAR_FULL, energy: BAR_FULL, bullets: BAR_FULL, grenades: BAR_FULL, rockets: BAR_FULL, mode: 2 });
        Object.assign(p, { elevator: 0, came: 5, day: 0 });
        this.next = p.level + 3;
        return;
      }
      return yield* this.converse("guard", 5);
    }
    yield* this.converse("guard", 6);
  }

  /** 0x401570: a conversation, then the view again */
  *converse(name: string, number: number): Co {
    const n = number >= 1 ? number : talkNumber(this.p.day);
    // 0x401602: the effects and the ambience silenced for the talk, the ambience again after it (0x40164d)
    this.m.stopAmbience();
    yield* talk(this.m, name, n, this.day, this.talkState);
    this.m.playAmbience();
    this.m.screen.setPalette(this.clut.map(() => 0));
    this.showRest();
    this.drawPanel();
    yield* this.present();
    yield* this.m.fadeIn(this.clut);
  }

  /** the guard's line when he has walked up (0x405d72) */
  private guardLine(): number {
    if (this.floor === UPPER && this.pose.y >= 0x13) {
      if (this.p.day === 2 && this.day >= 2 && this.day <= 4) return this.p.weapon && this.p.suit ? 4 : 5;
      return 6;
    }
    return -1;
  }

  /* ----------------------------------------------------------------------- *
   * The floor's loop
   * ----------------------------------------------------------------------- */

  /** until something sends the player off the floor; answers the level to go to */
  *run(): Co<number> {
    this.cam = camera(this.pose, this.pose.dir, 0, FORWARD);
    while (this.next === null) {
      const c = this.m.commands.shift();
      if (c) {
        yield* this.command(c);
        continue;
      }
      const e = this.m.take();
      this.busy = !!e;
      if (e?.kind === "down") yield* this.click(e.y, e.x);
      else if (e?.kind === "key") yield* this.key(e.key);
      else {
        const talker = yield* this.present();
        this.busy = !!talker;
        if (talker) yield* this.converse(talker.name, talker.name === "guard" ? this.guardLine() : -1);
        this.ambient();
      }
      this.busy = false;
    }
    return this.next;
  }

  /** 0x40df7f: the upper floor's machinery hums now and then */
  private ambient(): void {
    if (this.floor !== UPPER) return;
    const { x, y } = this.pose;
    if (x >= 7 && x <= 0xb && y >= 7 && y <= 0xb) {
      if (this.m.roll(100) === 1) this.sound(1);
    } else if (y < 3 && this.m.roll(100) === 1) this.sound(2);
  }
}

/** the panel's 21 pictures (`shared/panel.`) */
export function readPanel(data: Uint8Array): FrameV0[] {
  return readContainerFile(data).containers.map((c) => decodeFrameV0(c.data));
}

/** a sound bank's sounds, by container (`moonsound`: 0x419136) */
export function readBank(data: Uint8Array): Uint8Array[] {
  return readContainerFile(data).containers.map((c) => c.data);
}
