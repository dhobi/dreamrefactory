/**
 * The comms box: a small talking head, 92 by 125 at (27, 18) — the pilot on
 * the radio in flight, the dealer in the Mart's VIDEO box. RAVEN.EXE keeps
 * five heads loaded (0x40ecd2, 0x413763), one `.mupp` each, and plays one line
 * at a time in the box, a tick at a time:
 *
 *   0  the pilot (`lark.mupp` until another is chosen, 0x418878)
 *   1  `fuel.mupp`
 *   2  `weap.mupp`, the Mart's dealer
 *   3  `rbay.mupp`
 *   4  `enem.mupp`, the enemy breaking in on the pilot
 *
 * A `.mupp` is a talk file (engine/src/df/talk-v0.ts) whose lines are the
 * head's things to say; lines 0 to 3 are its idle racks, played silent (but for
 * the enemy's) at random waits between the file's shortest and longest
 * (0x414120), as a conversation's are.
 *
 * ## Asking for a line (0x4142b9)
 *
 * A line is only asked for; whether it plays depends on what is playing. The
 * pilot is heard only while the pilot's head is up, never twice running, and
 * not over a line of higher priority (table 0x431b1c). The fuel, the Mart and
 * the repair bay take the box from whoever has it, and on their own head the
 * same rules hold by their own table (0x431bb4). The enemy breaks in only on
 * the pilot.
 *
 * ## A tick (0x413c6d)
 *
 * A new head is drawn at its first line's first keyframe (0x413b7e); a new line
 * starts, with its voice (0x41496f); a playing line shows the keyframe its
 * clock has reached, one per two ticks, and is over at its last keyframe, the
 * voice cut there if still going (0x414a9d, 0x414b1a).
 *
 * ## The chatter in flight (0x413c6d with its flag set, 0x413cf3 … 0x414158)
 *
 * On a quiet tick in flight the box is the pilot's again (another head's line
 * over, 0x414105), and the pilot, in this order, says:
 *
 *   - once, 100 … 200 ticks into the flight (`[0x4373cc]`, 0x413af8), line 4
 *     if no COPILOT button is down
 *   - line 0x1e, the copilot has the navigation (`[0x4373dc]`, 0x414b65 when
 *     the beacon goes up)
 *   - line 0x20, the Mart was left by CONTINUE (`[0x4373e4]`)
 *   - one of lines 0x21 … 0x23 (a roll of 4, never the last one again; a 4
 *     says nothing) after the enemy broke in (`[0x4373e0]`, 0x414b8f)
 *   - 150 … 350 ticks after the last line began (`[0x4373c8]`), a remark by a
 *     roll of 6 (table 0x431ae8): the copilots (9 all three buttons down,
 *     0xa none), the shields (0xe under 0x21c0, else 0xf), 0x10 or 0x11, 5
 *     with wreckage about; or a 5 or 6 lets the enemy break in (lines 0, 4,
 *     6, 7 by a roll of 4, never the last again: table 0x431af8)
 *   - else, facing a quarter, that what the beacon marks is ahead within five
 *     cells, once for each beacon (`[0x437404]`, table 0x431b08): 6 the fuel
 *     station, 7 the weapons ship, 0x24 the pods, 8 the repair bay
 *   - and then, with two or more homing things up, one time in eight line
 *     0xb; else the idle racks come round as ever.
 *
 * With the flag clear (the Mart) all of these are forgotten each quiet tick
 * (0x414120).
 */
import { readTalkFileV0, type TalkFileV0, type TrackKeyV0 } from "@dreamfactory/engine/df/talk-v0";
import { FaceDrawer } from "@dreamfactory/engine/v0/talk";
import type { Rect } from "@dreamfactory/engine/v0/screen";
import type { Co, Machine } from "./machine";

/**
 * What the flight's chatter asks of the flight (src/game/combat/lib.ts's
 * chatterOf gives the world's)
 */
export interface Chatter {
  /** 0x417617: the three COPILOT buttons (navigation, HOVER, weapons) */
  copilots(): [number, number, number];
  /** 0x417917: the shields */
  shields(): number;
  /** 0x41d6c3: the wreckage pieces that are targets */
  wreckage(): number;
  /** 0x417d4d: what the beacon marks, −1 for none */
  beacon(): number;
  /** the craft's heading is a quarter's (`[0x43cd1c]` & 0x3f is 0) */
  squared(): boolean;
  /**
   * 0x41444c: what the beacon marks — the fuel station for 0 (0x40b04c), the
   * weapons ship for 1 (0x42aa01), else the beacon's cell — is down the
   * craft's heading within five cells
   */
  ahead(kind: number): boolean;
  /** 0x407cb5 + 0x403345 + 0x425412: the homing things up, the copters' missiles, the boss's, the tanks' shells */
  homing(): number;
}

export const PILOT = 0;
export const FUEL = 1;
export const DEALER = 2;
export const REPAIR = 3;
export const ENEMY = 4;

/** where the box is (0x41482a: the face offset by 18, 27) */
export const COMMS_BOX: Rect = [0x1b, 0x12, 0x1b + 125, 0x12 + 92];

/** the pilot's lines' priorities (0x431b1c) */
const PILOT_PRIORITY = [0, 0, 0, 0, 100, 50, 200, 200, 200, 100, 100, 30, 20, 20, 10, 10, 5, 5, 1000, 500, 500, 500, 500, 500, 500, 60, 10, 10, 10, 30, 100, 20, 120, 3, 3, 3, 800, 300];
/** the fuel's, the dealer's and the repair bay's (0x431bb4) */
const CREW_PRIORITY = [0, 0, 0, 0, 500, 200, 500, 500, 200, 800, 200, 50, 50, 50, 200, 1000];

interface Head {
  file: string;
  talk: TalkFileV0;
  drawer: FaceDrawer;
  /** when each idle rack comes round next, in ticks */
  next: number[];
}

export class Comms {
  private readonly heads: (Head | null)[] = [null, null, null, null, null];
  /** `[0x4373e8]`, `[0x4373f0]`: whose line was asked for last, and which */
  who = PILOT;
  line = -1;
  /** `[0x4373ec]`, `[0x4373f4]`: the head and the line the box shows */
  private shownWho = -1;
  private shownLine = -1;
  /** `[0x4373f8]`: the keyframe of the line playing, -1 when none is */
  private key = -1;
  private drawnKey = -1;
  private startedAt = 0;
  private voiced = false;
  private keys: TrackKeyV0[] = [];
  private frames = 0;
  /**
   * `[0x4373e4]`: the Mart was left by CONTINUE (0x414ba9); the pilot says so
   * on the next quiet tick in flight (line 0x20, 0x413d82)
   */
  leaving = false;
  /** `[0x4373c8]`: when the pilot next remarks (ticks), 0 not yet */
  private remarkAt = 0;
  /** `[0x4373cc]`: when the pilot opens the flight (ticks), 0 once done */
  private openAt = 0;
  /** `[0x4373dc]`: the copilot has the navigation — the pilot says so (0x414b65) */
  navSaid = false;
  /** `[0x4373d4]`, `[0x4373d8]`: the enemy's last line and the pilot's last answer (by their rolls) */
  private lastEnemy = -1;
  private lastAnswer = -1;
  /** `[0x437404]`: the beacon last called ahead */
  private called = -1;
  /** every line started, as `who:line` — what a machine test reads */
  readonly spoken: string[] = [];

  constructor(private readonly m: Machine) {}

  /** 0x413763: a head's file read, into its slot */
  *load(who: number, name: string, day: number): Co {
    const { path, data } = yield* this.m.file(name, day);
    const talk = readTalkFileV0(data);
    const next = [0, 1, 2, 3].map((k) => this.m.ticks + this.wait(talk, k));
    this.heads[who] = { file: path, talk, drawer: new FaceDrawer(this.m, talk, COMMS_BOX), next };
    if (this.shownWho === who) this.shownWho = -1;
  }

  headFile(who: number): string | null {
    return this.heads[who]?.file ?? null;
  }

  /** an idle rack's next wait: its shortest, and a roll up to its longest */
  private wait(t: TalkFileV0, k: number): number {
    return t.idleMin[k] + this.m.roll(Math.max(1, t.idleMax[k] - t.idleMin[k]));
  }

  /** `[0x4373f8]`, which 0x41438a reads (src/game/combat/lib.ts) */
  keyframe(): number {
    return this.key;
  }

  /** 0x4142b9: a line asked for */
  ask(who: number, line: number): void {
    const playing = this.key >= 0 && this.line >= 0;
    if (who === ENEMY) {
      if (this.who !== PILOT) return;
    } else if (who === PILOT) {
      if (this.who !== PILOT) return;
      if (playing && (PILOT_PRIORITY[line] ?? 0) < (PILOT_PRIORITY[this.line] ?? 0)) return;
      if (this.line === line) return;
    } else if (this.who === who && playing) {
      if ((CREW_PRIORITY[line] ?? 0) < (CREW_PRIORITY[this.line] ?? 0)) return;
      if (this.line === line) return;
    }
    this.who = who;
    this.line = line;
    this.navSaid = false;
    this.leaving = false;
    this.shownLine = -1;
    this.hinted = false;
  }

  /** 0x413af8: the line stopped and forgotten, the pilot on the box again; the flight's opening 100 … 200 ticks off */
  reset(): void {
    this.stop();
    this.hinted = false;
    this.shownWho = -1;
    this.shownLine = -1;
    this.line = -1;
    this.lastEnemy = -1;
    this.lastAnswer = -1;
    this.remarkAt = 0;
    this.leaving = false;
    this.navSaid = false;
    this.called = -1;
    this.who = PILOT;
    this.openAt = this.m.roll(0x64) + this.m.ticks + 0x64;
  }

  /** 0x414b65: the beacon went up — with the copilot navigating, the pilot says so (`navigates` 0x417617's first) */
  x414b65(navigates: number): void {
    if (navigates !== 0) this.navSaid = true;
  }

  /** 0x414bb4: whose line is playing, −1 while none is */
  talking(): number {
    return this.who >= 0 && this.key >= 0 ? this.who : -1;
  }

  /** `[0x4373e0]`: the enemy broke in (0x414b8f) — the pilot answers (0x413da7) */
  hinted = false;

  /** 0x414b8f: one time in two, `[0x4373e0]` set */
  x414b8f(): void {
    if (this.m.roll(2) === 1) this.hinted = true;
  }

  /**
   * 0x414bce: the line playing cut, and who asked last the pilot, for line 0
   * (`[0x4373e8]`, `[0x4373f0]`: 0, not 0x413af8's −1), the box to show it
   * again, `[0x4373e0]`, `[0x4373e4]` and `[0x4373dc]` clear
   */
  x414bce(): void {
    this.stop();
    this.who = PILOT;
    this.line = 0;
    this.shownLine = -1;
    this.navSaid = false;
    this.leaving = false;
    this.hinted = false;
  }

  /** 0x414b1a: the line playing stopped, its voice cut */
  private stop(): void {
    if (this.key < 0) return;
    this.key = -1;
    if (this.voiced) this.m.stopSound();
  }

  /** 0x413c6d with its flag clear — the Mart's idle: one step of the box */
  tick(): void {
    this.step(null);
  }

  /** 0x413c6d(1): a step of the box in flight, the pilot's chatter with it */
  flightTick(f: Chatter): void {
    this.step(f);
  }

  /** 0x413c6d's ticks: roll(200) + the time + 150 (0x413cbe, 0x413f83, 0x414136) */
  private later(): number {
    return this.m.roll(0xc8) + this.m.ticks + 0x96;
  }

  private step(f: Chatter | null): void {
    const m = this.m;
    const head = this.heads[this.who];
    if (!head) return;
    if (this.who !== this.shownWho) {
      // 0x413b7e: the new head, at its first line's first keyframe
      this.shownWho = this.who;
      const first = head.talk.lines[0];
      if (first) head.drawer.draw(head.drawer.track(first.track), -1, 0);
      return;
    }
    if (this.line !== this.shownLine) {
      this.shownLine = this.line;
      this.start(head);
      this.remarkAt = this.later();
    }
    if (this.key >= 0) return this.advance(head);
    if (f) {
      if (this.chatter(f)) return;
    } else {
      // 0x414120
      this.hinted = false;
      this.openAt = 0;
      this.leaving = false;
      this.navSaid = false;
      this.remarkAt = this.later();
    }
    // 0x414158: nothing playing — the idle racks come round
    for (let k = 0; k < 4; k++) {
      if (m.ticks < head.next[k]) continue;
      head.next[k] = m.ticks + this.wait(head.talk, k);
      this.ask(this.who, k);
    }
  }

  /**
   * 0x413cfd … 0x414158: the pilot's chatter on a quiet tick in flight; true
   * when the tick is done, false when the idle racks come round after it
   */
  private chatter(f: Chatter): boolean {
    const m = this.m;
    const sum = (): number => {
      const [nav, hover, arms] = f.copilots();
      return nav + hover + arms;
    };
    if (this.who !== PILOT) {
      // 0x414105
      this.who = PILOT;
      this.line = 0;
      this.shownLine = -1;
      return true;
    }
    if (this.openAt !== 0) {
      if (m.ticks > this.openAt) {
        if (sum() === 0) this.ask(PILOT, 4);
        this.openAt = 0;
      }
      return true;
    }
    if (this.navSaid) {
      this.ask(PILOT, 0x1e);
      this.navSaid = false;
      return true;
    }
    if (this.leaving) {
      this.ask(PILOT, 0x20);
      this.leaving = false;
      return true;
    }
    if (this.hinted) {
      let k: number;
      do k = m.roll(4);
      while (k === this.lastAnswer);
      this.lastAnswer = k;
      if (k <= 3) this.ask(PILOT, 0x20 + k);
      this.hinted = false;
      return true;
    }
    if (this.remarkAt !== 0 && m.ticks > this.remarkAt) {
      switch (m.roll(6)) {
        case 1: {
          const n = sum();
          if (n >= 3) this.ask(PILOT, 9);
          if (n <= 0) this.ask(PILOT, 0xa);
          break;
        }
        case 2:
          this.ask(PILOT, f.shields() < 0x21c0 ? 0xe : 0xf);
          break;
        case 3:
          this.ask(PILOT, m.roll(2) === 1 ? 0x10 : 0x11);
          break;
        case 4:
          if (f.wreckage() !== 0) this.ask(PILOT, 5);
          break;
        default: {
          let k: number;
          do k = m.roll(4);
          while (k === this.lastEnemy);
          this.lastEnemy = k;
          this.ask(ENEMY, [0, 4, 6, 7][k - 1]);
          this.x414b8f();
        }
      }
      this.remarkAt = this.later();
      return true;
    }
    const kind = f.beacon();
    if (kind !== this.called && f.squared()) {
      if (kind === -1) this.called = kind;
      else if (kind >= 0 && kind <= 3 && f.ahead(kind)) {
        this.ask(PILOT, [6, 7, 0x24, 8][kind]);
        this.called = kind;
      }
    }
    if (f.homing() >= 2 && m.roll(8) === 1) {
      this.ask(PILOT, 0xb);
      return true;
    }
    return false;
  }

  /** 0x41496f */
  private start(head: Head): void {
    this.stop();
    const line = head.talk.lines[this.line];
    if (!line) return;
    this.voiced = this.line > 3 || this.who === ENEMY;
    this.keys = head.drawer.track(line.track);
    this.frames = line.frames;
    const wave = head.talk.containers[line.wave];
    if (this.voiced && wave) this.m.sound(wave);
    this.key = 0;
    this.drawnKey = -1;
    this.startedAt = this.m.ticks;
    this.spoken.push(`${this.who}:${this.line}`);
  }

  /** 0x414a9d: the keyframe the line's clock has reached, and its end */
  private advance(head: Head): void {
    const key = (this.m.ticks - this.startedAt) >> 1;
    if (key >= this.frames) {
      const last = this.frames - 1;
      if (last !== this.drawnKey && last >= 0) head.drawer.draw(this.keys, this.drawnKey, last);
      this.drawnKey = last;
      this.stop();
      return;
    }
    this.key = key;
    if (key !== this.drawnKey) {
      head.drawer.draw(this.keys, this.drawnKey, key);
      this.drawnKey = key;
    }
  }

  /** the box redrawn whole at the keyframe it shows (after the screen under it was repainted) */
  redraw(): void {
    const head = this.heads[this.shownWho];
    if (!head) return;
    const line = head.talk.lines[this.key >= 0 ? this.line : 0];
    if (!line) return;
    head.drawer.draw(head.drawer.track(line.track), -1, Math.max(0, this.key >= 0 ? this.drawnKey : 0));
  }
}
