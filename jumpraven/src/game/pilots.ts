/**
 * COPILOT SELECTION (RAVEN.EXE 0x418878): the six who fly with the player, of
 * whom some are ON ASSIGNMENT, an interview with each, and a profile film.
 *
 * ## The screen (0x418970, 0x418f7b)
 *
 * `pilot`'s pictures (SHARED\PILOT): 0 the screen, 1 to 3 INTERVIEW, PROFILE
 * and CONTINUE at their anchors, 4 and 5 the side panels an interview is drawn
 * between (0x418eb3), 6 ON ASSIGNMENT, laid over a portrait 2 in (0x419047).
 * The one chosen is framed 2 pixels thick in 0x28.
 *
 * ## Who is away
 *
 * All six are in, and then some are sent away at random (0x427be7), more the
 * harder the setting and the later the day (0x418a56): Training 1, 2, 3 on
 * days one to three, Intermediate 2, 3, 3, Advanced 3, 4, 4, Expert 3, 4, 5. If
 * the pilot flown last is away, the first who is not takes their place.
 */
import { decodeFrameV0, type FrameV0 } from "@dreamfactory/engine/df/image-v0";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { playFilm, trackPress } from "@dreamfactory/engine/v0/film";
import { talk, type TalkLook, type TalkState } from "@dreamfactory/engine/v0/talk";
import type { Rect } from "@dreamfactory/engine/v0/screen";
import type { Co, Machine } from "./machine";
import { DoubleClick, anchored, inRect } from "./screens";
import type { Records } from "./records";

/** the six, in the EXE's order (`[0x43b300]`), and their files' names */
export const PILOTS = ["lark", "cheese", "chablis", "dogstar", "nikki", "thrash"] as const;

const INTERVIEW = 1;
const PROFILE = 2;
const CONTINUE = 3;
const LEFT_SIDE = 4;
const RIGHT_SIDE = 5;
const AWAY = 6;
const CHOSEN_INK = 0x28;

/** a portrait (0x4190ee): 96 by 129 */
export function portrait(pilot: number): Rect {
  const [top, left] = [[0x10, 0x9a], [0xc6, 0x9a], [0xc6, 0x109], [0xc6, 0x17a], [0x10, 0x109], [0x10, 0x17a]][pilot];
  return [top, left, top + 0x81, left + 0x60];
}

/** how many are away: by difficulty 1–4, then the story level 2, 4 or 6 (0x418a56) */
const AWAY_COUNT: Record<number, number[]> = { 1: [1, 2, 3], 2: [2, 3, 3], 3: [3, 4, 4], 4: [3, 4, 5] };

export interface PilotsState {
  /** who is in */
  here: boolean[];
}

export class Pilots {
  readonly state: PilotsState;
  private readonly pictures: FrameV0[];
  private readonly clicks: DoubleClick;

  constructor(
    private readonly m: Machine,
    private readonly r: Records,
    file: Uint8Array,
    difficulty: number,
    level: number,
  ) {
    this.pictures = readContainerFile(file).containers.map((c) => decodeFrameV0(c.data));
    this.clicks = new DoubleClick(m);
    const here = PILOTS.map(() => true);
    const away = AWAY_COUNT[difficulty]?.[level / 2 - 1] ?? 0;
    for (let n = 0; n < away; n++) {
      const left = here.map((h, k) => (h ? k : -1)).filter((k) => k >= 0);
      here[left[m.roll(left.length) - 1]] = false;
    }
    if (!here[r.pilot]) r.pilot = here.indexOf(true);
    this.state = { here };
  }

  /** 0x418b72: the screen, until CONTINUE */
  *run(day: number, palette: Uint8ClampedArray, talkState: { talk: TalkState | null }, look: TalkLook): Co {
    const m = this.m;
    this.draw();
    yield* m.fadeIn(palette);
    for (;;) {
      const e = m.take();
      if (e?.kind === "down") {
        const what = yield* this.click(e.x, e.y);
        if (what === "continue") return;
        if (what === "interview") {
          yield* m.fadeOut();
          // 0x418eb3: this screen's own side panels, then the pilot's talk
          if (m.draws) {
            m.screen.sprite(this.pictures[LEFT_SIDE], 0, 0);
            m.screen.sprite(this.pictures[RIGHT_SIDE], 0, 0);
          }
          yield* talk(m, `${PILOTS[this.r.pilot]}.pupp`, day, talkState, look);
          this.draw();
          yield* m.fadeIn(palette);
        }
        if (what === "profile") {
          yield* playFilm(m, `${PILOTS[this.r.pilot]}.move`, day);
          this.draw();
        }
      }
      yield;
    }
  }

  private *click(x: number, y: number): Co<"continue" | "interview" | "profile" | null> {
    const m = this.m;
    const inside = (r: Rect) => inRect(r, x, y);
    const doubled = this.clicks.click(x, y);
    for (const [k, what] of [[INTERVIEW, "interview"], [PROFILE, "profile"], [CONTINUE, "continue"]] as const) {
      const r = this.rect(k);
      if (inside(r) && (yield* trackPress(m, r))) return what;
    }
    for (let p = 0; p < PILOTS.length; p++) {
      const r = portrait(p);
      if (!this.state.here[p] || !inside(r) || !(yield* trackPress(m, r))) continue;
      this.r.pilot = p;
      this.draw();
      return doubled ? "interview" : null;
    }
    return null;
  }

  private rect(k: number): Rect {
    return anchored(this.pictures[k]);
  }

  /** 0x418f7b */
  draw(): void {
    const m = this.m;
    if (!m.draws) return;
    const s = m.screen;
    const p = this.pictures;
    s.spriteAt(p[0], 0, 0);
    for (const k of [INTERVIEW, PROFILE, CONTINUE]) s.sprite(p[k], 0, 0);
    this.state.here.forEach((here, k) => {
      if (here) return;
      const [t, l] = portrait(k);
      s.spriteAt(p[AWAY], t + 2, l + 2);
    });
    s.frame(portrait(this.r.pilot), 2, CHOSEN_INK);
  }
}

