/**
 * DreamFactory 0's film player (engine/src/v0/film.ts): what each hotspot type
 * and each frame action ends a film with, a button hotspot that is pressed and
 * let go on or off it, a click that misses on a waiting frame, the film's word
 * and deed sent when it is cut short, and the call stack of `playFilm` — a
 * return with no caller, and the five-deep limit.
 *
 *   npx vitest run engine/tests/df0-film.ts
 *
 * No game: the films are built ({@link file://./helpers/v0-build.ts}).
 */
import { expect, test } from "vitest";
import { ESCAPE, playFilm, playOneFilm, trackPress, type FilmHooks } from "@dreamfactory/engine/v0/film";
import type { Speaker } from "@dreamfactory/engine/v0/machine";
import { MapMachine, drive, filmV0, pictureV0, soundV0, type FrameV0Spec } from "./helpers/v0-build";

const PIC = pictureV0(8, 8, 1);

/** one film, `film.mov`, played on a fresh machine with a click at (y, x) on the first tick */
function clickOn(frames: FrameV0Spec[], y: number, x: number, hooks: FilmHooks = {}, speaker?: Speaker) {
  const m = new MapMachine(new Map([["film.mov", filmV0({ frames, containers: [PIC, soundV0(2)] })]]), { speaker });
  const end = drive(m, playOneFilm(m, "film.mov", 1, hooks), (t) => {
    if (t === 0) m.events.push({ kind: "down", x, y });
  });
  return { m, end };
}

test("a waiting frame's hotspots: 3 with no film exits, 3 chains, 4 calls back to its frame, 5 returns", () => {
  const frame: FrameV0Spec = {
    hotspots: [
      { type: 3, rect: [0, 0, 0, 7] },
      { type: 3, rect: [1, 0, 1, 7], film: "next.move" },
      { type: 4, rect: [2, 0, 2, 7], film: "help.move", target: 5 },
      { type: 5, rect: [3, 0, 3, 7] },
    ],
  };
  expect(clickOn([frame], 0, 3).end).toEqual({ end: "exit", to: "", back: 0 });
  expect(clickOn([frame], 1, 3).end).toEqual({ end: "chain", to: "next.move", back: 0 });
  expect(clickOn([frame], 2, 3).end).toEqual({ end: "call", to: "help.move", back: 5 });
  expect(clickOn([frame], 3, 3).end).toEqual({ end: "return", to: "", back: 0 });
});

test("a hotspot's own sound plays on the click; one naming no container plays nothing", () => {
  const played: number[] = [];
  const speaker: Speaker = { play: (s) => played.push(s.length), stop: () => {} };
  const frame: FrameV0Spec = {
    hotspots: [
      { type: 1, rect: [0, 0, 0, 7], sound: -2 },
      { type: 1, rect: [1, 0, 1, 7], sound: 9 },
    ],
  };
  clickOn([frame], 0, 0, {}, speaker);
  expect(played).toEqual([2 * 370]);
  clickOn([frame], 1, 0, {}, speaker);
  expect(played).toEqual([2 * 370]);
});

test("a click that misses on a waiting frame waits on; Esc then cuts the film and sends its word and deed", () => {
  const sent: string[] = [];
  const m = new MapMachine(
    new Map([
      [
        "film.mov",
        filmV0({
          frames: [{ hotspots: [{ type: 1, rect: [0, 0, 1, 1] }] }, { action: 1 }],
          word: 1,
          deed: 1,
        }),
      ],
    ]),
  );
  const hooks: FilmHooks = {
    word: () => void sent.push("word"),
    *deed() {
      sent.push("deed");
      yield;
    },
  };
  const end = drive(m, playOneFilm(m, "film.mov", 1, hooks), (t) => {
    if (t === 0) m.events.push({ kind: "down", x: 6, y: 6 });
    if (t === 3) {
      expect(m.filmWaiting).toBe(true);
      expect(sent).toEqual([]);
      m.events.push({ kind: "key", key: ESCAPE });
    }
  });
  expect(end.end).toBe("exit");
  expect(sent).toEqual(["word", "deed"]);
});

test("a frame's own end: action 4 calls the film it names, one with no name and 5 end it", () => {
  const ending = (f: FrameV0Spec) => {
    const m = new MapMachine(new Map([["film.mov", filmV0({ frames: [f] })]]));
    return drive(m, playOneFilm(m, "film.mov", 1));
  };
  expect(ending({ action: 4, chainTo: "topic.move", target: 2 })).toEqual({ end: "call", to: "topic.move", back: 2 });
  expect(ending({ action: 4 })).toEqual({ end: "exit", to: "", back: 0 });
  expect(ending({ action: 5 })).toEqual({ end: "return", to: "", back: 0 });
});

test("a button hotspot: let go on it, it is pressed; dragged off and let go, the click goes on to the next hotspot", () => {
  const frames: FrameV0Spec[] = [
    {
      hotspots: [
        { type: -1, rect: [0, 0, 3, 3] },
        { type: 3, rect: [0, 0, 7, 7], film: "other.move" },
      ],
    },
  ];
  const run = (script: (m: MapMachine, t: number) => void) => {
    const m = new MapMachine(new Map([["film.mov", filmV0({ frames })]]));
    const pressed: number[] = [];
    const end = drive(m, playOneFilm(m, "film.mov", 1, { button: (i) => pressed.push(i) }), (t) => script(m, t));
    return { end, pressed, m };
  };
  const down = (m: MapMachine): void => {
    m.mouseHeld = true;
    m.pointer = { x: 1, y: 1 };
    m.events.push({ kind: "down", x: 1, y: 1 });
  };
  // held, then let go on the button
  const on = run((m, t) => {
    if (t === 0) down(m);
    if (t === 4) m.events.push({ kind: "up", x: 2, y: 2 });
  });
  expect(on.end.end).toBe("exit");
  expect(on.pressed).toEqual([0]);
  expect(on.m.pointer).toEqual({ x: 2, y: 2 });
  // dragged off and let go off: the second hotspot takes the click
  const off = run((m, t) => {
    if (t === 0) down(m);
    if (t === 2) m.pointer = { x: 6, y: 6 };
    if (t === 4) m.events.push({ kind: "up", x: 6, y: 6 });
  });
  expect(off.end).toEqual({ end: "chain", to: "other.move", back: 0 });
  expect(off.pressed).toEqual([1]);
  // dragged off, then back on, and the button let go of with no event: still pressed
  const back = run((m, t) => {
    if (t === 0) down(m);
    if (t === 2) m.pointer = { x: 6, y: 6 };
    if (t === 4) m.pointer = { x: 1, y: 1 };
    if (t === 6) m.mouseHeld = false;
  });
  expect(back.pressed).toEqual([0]);
});

test("a press is shown at least ten ticks; let go off the button inside them and back on before they end, it counts", () => {
  const m = new MapMachine(new Map());
  m.mouseHeld = true;
  m.pointer = { x: 5, y: 5 };
  const before = m.screen.pixels.slice();
  const hit = drive(m, trackPress(m, [0, 0, 10, 10]), (t) => {
    if (t === 1) m.pointer = { x: 50, y: 50 };
    if (t === 2) m.events.push({ kind: "up", x: 50, y: 50 });
    if (t === 5) m.pointer = { x: 4, y: 4 };
  });
  expect(hit).toBe(true);
  expect(m.ticks).toBe(10);
  // the frame inverted on and off an even number of times: the screen is as it was
  expect(m.screen.pixels).toEqual(before);
  // and let go off it, staying off: not pressed, the frame not drawn back
  const n = new MapMachine(new Map());
  n.mouseHeld = true;
  n.pointer = { x: 5, y: 5 };
  expect(
    drive(n, trackPress(n, [0, 0, 10, 10]), (t) => {
      if (t === 1) n.events.push({ kind: "up", x: 50, y: 50 });
    }),
  ).toBe(false);
});

test("playFilm: a call comes back to its frame, a return with no caller ends, and calls stop five deep", () => {
  const log: string[] = [];
  const rip = new Map([
    ["main.mov", filmV0({ frames: [{ action: 4, chainTo: "topic.mov", target: 1 }, { action: 1, sound: 2 }], containers: [PIC, soundV0(1)] })],
    ["topic.mov", filmV0({ frames: [{ action: 5 }] })],
    ["self.mov", filmV0({ frames: [{ action: 4, chainTo: "self.mov" }] })],
  ]);
  const played: number[] = [];
  const m = new MapMachine(rip, { speaker: { play: (s) => played.push(s.length), stop: () => {} }, log: (l) => log.push(l.trim()) });
  drive(m, playFilm(m, "main.mov", 1));
  expect(log.filter((l) => !l.startsWith("▶"))).toEqual(["calls topic.mov", "back to main.mov"]);
  // main's second frame, come back to, played its sound
  expect(played).toEqual([370]);
  expect(m.film).toBeNull();
  log.length = 0;
  drive(m, playFilm(m, "topic.mov", 1));
  expect(log).toEqual(["▶ topic.mov — 1 frames"]);
  log.length = 0;
  drive(m, playFilm(m, "self.mov", 1));
  expect(log.filter((l) => l.startsWith("calls"))).toHaveLength(5);
  expect(log.filter((l) => l.startsWith("▶"))).toHaveLength(6);
});
