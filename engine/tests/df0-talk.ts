/**
 * DreamFactory 0's conversation (engine/src/v0/talk.ts) played through on a
 * built talk file: the face drawn from its layers, the menu and what a click
 * outside it, past its last line or on a question not in the file does, a
 * question voiced or not, hidden once asked, a submenu with nothing left in
 * it, going back a menu, the idle racks, Esc in each of the places it ends the
 * talk, and the twelve-deep menu stack.
 *
 *   npx vitest run engine/tests/df0-talk.ts
 *
 * No game: the files are built ({@link file://./helpers/v0-build.ts}).
 */
import { expect, test } from "vitest";
import { ESCAPE } from "@dreamfactory/engine/v0/film";
import type { BitmapFont } from "@dreamfactory/engine/v0/font";
import type { InputEvent } from "@dreamfactory/engine/v0/machine";
import { SCREEN_W } from "@dreamfactory/engine/v0/screen";
import { MENU_LINE, MENU_TOP, talk, type TalkState } from "@dreamfactory/engine/v0/talk";
import { MapMachine, drive, pictureV0, soundV0, talkV0, trackV0, type TalkV0Spec } from "./helpers/v0-build";

// the containers every talk here shares, from 4
const BACKDROP = 4;
const MOUTH = 5;
const VOICE = 6; // 2 blocks: 3 ticks
const TRACK = 7;
const ASK = 8; // 1 block: 2 ticks
const STILL = 9;
const NONE = 99;
const containers = [
  pictureV0(8, 8, 2),
  pictureV0(2, 2, 3),
  soundV0(2),
  // the backdrop on layer 0, a missing picture on layer 1, the mouth on layer 2 moving, and layer 3 past its list
  trackV0([
    { dirty: [0, 0, 8, 8], layers: [[0, 0, 0], [0, 0, 0], [0, 2, 2], [5, 0, 0]] },
    { dirty: [2, 2, 6, 6], layers: [[0, 0, 0], [0, 0, 0], [0, 4, 4], [5, 0, 0]] },
  ]),
  soundV0(1),
  // one keyframe whose layer 1 frame is past its layer's list
  trackV0([{ layers: [[0, 0, 0], [5, 0, 0]] }]),
];
const layers = [[BACKDROP], [NONE], [MOUTH], [MOUTH]];

/** a font of one glyph, 'H', two by two */
const FONT: BitmapFont = {
  height: 2,
  ascent: 2,
  first: 72,
  last: 72,
  glyphs: new Map([[72, { width: 2, rows: [Uint8Array.of(1, 1), Uint8Array.of(1, 1)] }]]),
};

const click = (row: number): InputEvent => ({ kind: "down", x: 10, y: MENU_TOP + row * MENU_LINE + 1 });
const key = (k: string): InputEvent => ({ kind: "key", key: k });

/** a step: once `when` holds of the talk, these events are queued */
type Step = [when: (ts: TalkState) => boolean, events: InputEvent[]];
const menuIs =
  (...q: string[]) =>
  (ts: TalkState): boolean =>
    ts.line === null && JSON.stringify(ts.menu) === JSON.stringify(q);

/** play `spec` through the steps; answers what was played, every menu shown, and the machine */
function run(spec: TalkV0Spec, steps: Step[], opts: { font?: boolean; draws?: boolean; watch?: (m: MapMachine, ts: TalkState) => void } = {}) {
  const m = new MapMachine(new Map([["raife.1", talkV0(spec)]]), { seed: 3, draws: opts.draws });
  if (opts.font) m.font = FONT;
  const state: { talk: TalkState | null } = { talk: null };
  const menus: string[] = [];
  let played: string[] = [];
  drive(m, talk(m, "raife.1", 1, state), () => {
    const ts = state.talk;
    if (!ts) return;
    played = ts.played;
    const shown = ts.menu.join("|");
    if (ts.line === null && shown && menus.at(-1) !== shown) menus.push(shown);
    opts.watch?.(m, ts);
    if (steps.length && !m.events.length && steps[0][0](ts)) m.events.push(...steps.shift()![1]);
  });
  expect(steps).toHaveLength(0);
  expect(state.talk).toBeNull();
  return { played, menus, m };
}

const line = (name: string, wave = VOICE, track = TRACK, frames = 2) => ({ name, wave, track, frames });

test("a talk walked through: hidden questions, a submenu, an empty one backed out of, back a menu, and an end", () => {
  let pressedSeen = false;
  let face: number[] = [];
  const { played, menus } = run(
    {
      voiced: true,
      idleMin: [40],
      idleMax: [41],
      lines: [line("Startup"), line("A1", VOICE, STILL, 1), line("idle 1", NONE, NONE, 1)],
      questions: [
        { name: "q1", text: "Hello", wave: ASK },
        { name: "q2", text: "Bye", wave: NONE },
        { name: "q3", text: "Deeper", wave: ASK },
        { name: "q4", text: "Back", wave: ASK },
      ],
      menus: [
        [
          { question: "q1", answer: "A1", hide: true, next: -1 },
          { question: "q3", answer: "", next: 1 },
          { question: "nobody", answer: "A1", next: -1 },
          { question: "q2", answer: "", next: -3 },
        ],
        [
          { question: "q4", answer: "", next: -2 },
          { question: "q1", answer: "", next: 2 },
        ],
        [{ question: "nobody", answer: "", next: -1 }],
      ],
      layers,
      containers,
    },
    [
      // a click above the menu, one under its last line and a key that is not Esc: all nothing
      [menuIs("Hello", "Deeper", "Bye"), [{ kind: "down", x: 10, y: 10 }, click(4), key("a")]],
      // Hello, and a key during its voice that is not Esc
      [menuIs("Hello", "Deeper", "Bye"), [click(0), key("b")]],
      [(ts) => menuIs("Deeper", "Bye")(ts) && ts.played.includes("idle 1"), [click(0)]],
      [menuIs("Back", "Hello"), [click(1)]],
      [menuIs("Back", "Hello"), [click(0)]],
      [menuIs("Deeper", "Bye"), [click(1)]],
    ],
    {
      font: true,
      draws: true,
      watch: (m, ts) => {
        // the pressed line in its ink, the face as Startup's last keyframe left it
        if (m.screen.pixels[(MENU_TOP + 14) * SCREEN_W + 8] === 0x74) pressedSeen = true;
        if (!face.length && ts.menu.length) face = [0, 2 * SCREEN_W + 2, 4 * SCREEN_W + 4, 9 * SCREEN_W + 9].map((i) => m.screen.pixels[i]);
      },
    },
  );
  expect(played.filter((l) => l !== "idle 1")).toEqual(["Startup", "A1"]);
  expect(menus.slice(0, 3)).toEqual(["Hello|Deeper|Bye", "Deeper|Bye", "Back|Hello"]);
  expect(menus.at(-1)).toBe("Deeper|Bye");
  expect(pressedSeen).toBe(true);
  // backdrop at 0,0 and where the mouth was; the mouth at 4,4; white paper past the backdrop
  expect(face).toEqual([2, 2, 3, 255]);
});

test("Esc ends a talk wherever it is pressed: the menu, an idle rack, a question's voice, an answer", () => {
  const spec = (voiced: boolean, idle: boolean): TalkV0Spec => ({
    voiced,
    idleMin: [idle ? 5 : 0],
    idleMax: [idle ? 6 : 0],
    lines: [line("Startup"), line("A1"), ...(idle ? [line("idle 1")] : [])],
    questions: [{ name: "q1", text: "Hello", wave: ASK }],
    menus: [[{ question: "q1", answer: "A1", next: -1 }]],
    layers,
    containers,
  });
  expect(run(spec(false, false), [[menuIs("Hello"), [key(ESCAPE)]]]).played).toEqual(["Startup"]);
  expect(run(spec(false, true), [[(ts) => ts.line === "idle 1", [key(ESCAPE)]]]).played).toEqual(["Startup", "idle 1"]);
  // voiced: Esc with the click lands in the question's voice, and no answer follows
  expect(run(spec(true, false), [[menuIs("Hello"), [click(0), key(ESCAPE)]]]).played).toEqual(["Startup"]);
  // not voiced: the answer starts at once, and Esc cuts it
  expect(run(spec(false, false), [[menuIs("Hello"), [click(0), key(ESCAPE)]]]).played).toEqual(["Startup", "A1"]);
});

test("a talk with no lines draws no face and, its menu empty, is over at once", () => {
  const { played, menus } = run({ lines: [], questions: [], menus: [], containers: [] }, []);
  expect(played).toEqual([]);
  expect(menus).toEqual([]);
});

test("going back into a menu whose questions are all hidden goes back again: out of the first, the talk is over", () => {
  const { played, menus } = run(
    {
      lines: [line("Startup", NONE, NONE, 0)],
      questions: [
        { name: "q1", text: "Deeper", wave: NONE },
        { name: "q2", text: "Back", wave: NONE },
      ],
      menus: [[{ question: "q1", answer: "", hide: true, next: 1 }], [{ question: "q2", answer: "", next: -2 }]],
      containers,
    },
    [
      [menuIs("Deeper"), [click(0)]],
      [menuIs("Back"), [click(0)]],
    ],
  );
  expect(played).toEqual(["Startup"]);
  expect(menus).toEqual(["Deeper", "Back"]);
});

test("the menu stack is twelve deep: the twelfth submenu ends the talk", () => {
  const { played, m } = run(
    {
      lines: [line("Startup", NONE, NONE, 0)],
      questions: [{ name: "q1", text: "Again", wave: NONE }],
      menus: [[{ question: "q1", answer: "", next: 0 }]],
      containers,
    },
    [[menuIs("Again"), Array.from({ length: 13 }, () => click(0))]],
  );
  expect(played).toEqual(["Startup"]);
  // twelve clicks taken; the thirteenth was never read
  expect(m.events).toHaveLength(1);
});
