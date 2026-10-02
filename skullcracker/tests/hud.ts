/**
 * The interface panel's painter, `paintHud` in `src/hud.ts`, on a context that
 * records what it is asked to draw.
 *
 *   npx vitest run skullcracker/tests/hud.ts
 *
 * The machine suite `tests/machine/hud.ts` asserts that the game HANDS the panel
 * the right state; the page is the only thing that paints it, so no playthrough
 * ever reaches the painter. What it does with that state is arithmetic out of
 * `SC.EXE`, and the module comment of `src/hud.ts` carries the addresses:
 *
 *   - the health bars SLIDE, they are not scaled: `0x40d8ea` puts the player's
 *     fill at `15 + 196·(health − max)/max` and `0x40d7ca` the enemy's at
 *     `500 + 196·(max − health)/max`, each clipped to its own rect;
 *   - a dead enemy keeps its bar and loses its name (`0x40d837` wants both);
 *   - the four gauge rows are the magazine scaled to 0…64, sixteen a row
 *     (`0x40d6a2`), `14300` full and `14316 − remainder` partial;
 *   - one life light per life left, at most the five points of `0x46bd78`;
 *   - the quota is always two digits, clamped to 0…99;
 *   - each button shows `11404+i` while its bit is down and `11412+i` when up;
 *   - the key names are centred in a fifteen-pixel box with an arithmetic shift,
 *     so a wide one overhangs both sides (`0x40cf00`).
 */
import { describe, expect, it } from "vitest";
import type { ShpFrame } from "@dreamfactory/engine/df/shp";
import { BUTTONS, CEL, CLOCK, KEY_LABELS, LABEL, type HudArt, type HudState, paintHud } from "../src/hud";

/** one cel drawn: which, where its top-left landed, and the clip it landed in */
interface Drawn {
  id: number;
  x: number;
  y: number;
  clip: [number, number, number, number] | null;
}

/** every cel answers, 8 wide, with its anchor where `ANCHORS` says (0,0 otherwise) */
const ANCHORS: Record<number, [number, number]> = {
  // the two fills, anchored as the disc stores them: 4 from the left, and 191
  [CEL.playerFill]: [4, 0],
  [CEL.enemyFill]: [191, 0],
};

const ART: HudArt = {
  art: (id) => ({ id }) as unknown as CanvasImageSource,
  hdr: (id) => {
    const [posXraw, posYraw] = ANCHORS[id] ?? [0, 0];
    return { width: 8, height: 12, posXraw, posYraw } as unknown as ShpFrame;
  },
};

/** a 2D context that remembers its draws, its clips and its text */
function recorder() {
  const drawn: Drawn[] = [];
  const text: { name: string; x: number; y: number; ink: string }[] = [];
  const clips: ([number, number, number, number] | null)[] = [null];
  let pending: [number, number, number, number] | null = null;
  const ctx = {
    fillStyle: "",
    font: "",
    textBaseline: "",
    save: () => clips.push(clips[clips.length - 1]),
    restore: () => void clips.pop(),
    beginPath: () => undefined,
    rect: (x: number, y: number, w: number, h: number) => {
      pending = [x, y, w, h];
    },
    clip: () => {
      clips[clips.length - 1] = pending;
    },
    drawImage: (img: { id: number }, x: number, y: number) =>
      drawn.push({ id: img.id, x, y, clip: clips[clips.length - 1] }),
    // a monospace 6 px a character, which is all the centring needs
    measureText: (s: string) => ({ width: s.length * 6 }),
    fillText(name: string, x: number, y: number) {
      text.push({ name, x, y, ink: this.fillStyle });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn, text };
}

/** a panel state with everything at rest, and the parts a test wants changed */
function state(over: Partial<HudState> = {}): HudState {
  return {
    player: { health: 100, max: 100, nameCel: CEL.skullcracker },
    enemy: null,
    score: 0,
    lives: 3,
    quota: 0,
    ticks: CLOCK.noLimit,
    buttons: 0,
    weapon: null,
    ...over,
  };
}

function paint(over: Partial<HudState> = {}) {
  const r = recorder();
  paintHud(r.ctx, ART, state(over));
  return r;
}

const of = (drawn: Drawn[], id: number): Drawn[] => drawn.filter((d) => d.id === id);

describe("the health bars", () => {
  it("slides the player's fill left as health falls, by 196 over the maximum, inside its own clip", () => {
    const full = of(paint().drawn, CEL.playerFill);
    // x15 is where the ANCHOR lands, and the anchor is 4 from the left edge
    expect(full).toEqual([{ id: CEL.playerFill, x: 15 - 4, y: 14, clip: [0, 4, 200, 20] }]);
    const quarter = of(paint({ player: { health: 25, max: 100, nameCel: 0 } }).drawn, CEL.playerFill)[0];
    expect(quarter.x).toBe(15 + Math.round((196 * (25 - 100)) / 100) - 4);
    // dead is all the way out, and health past the maximum is the maximum
    expect(of(paint({ player: { health: -40, max: 100, nameCel: 0 } }).drawn, CEL.playerFill)[0].x).toBe(15 - 196 - 4);
    expect(of(paint({ player: { health: 150, max: 100, nameCel: 0 } }).drawn, CEL.playerFill)[0].x).toBe(15 - 4);
  });

  it("slides the enemy's fill right as its health falls, the same trick mirrored", () => {
    const at = (health: number) =>
      of(paint({ enemy: { health, max: 200, nameCel: 13450 } }).drawn, CEL.enemyFill)[0];
    expect(at(200)).toEqual({ id: CEL.enemyFill, x: 500 - 191, y: 14, clip: [300, 4, 212, 20] });
    expect(at(50).x).toBe(500 + Math.round((196 * 150) / 200) - 191);
    expect(at(0).x).toBe(500 + 196 - 191);
  });

  it("names the enemy while it lives, and keeps the bar but drops the name once it is dead", () => {
    const alive = paint({ enemy: { health: 1, max: 200, nameCel: 13450 } }).drawn;
    expect(of(alive, 13450)).toEqual([{ id: 13450, x: 457, y: 35, clip: [362, 29, 110, 13] }]);
    const dead = paint({ enemy: { health: 0, max: 200, nameCel: 13450 } }).drawn;
    expect(of(dead, 13450)).toEqual([]);
    expect(of(dead, CEL.enemyFill)).toHaveLength(1);
    expect(of(dead, CEL.enemyCap)).toHaveLength(1);
  });

  it("shows only the empty cap on the right until something has claimed the bar", () => {
    const { drawn } = paint({ enemy: null });
    expect(of(drawn, CEL.enemyFill)).toEqual([]);
    expect(of(drawn, CEL.enemyCap)).toEqual([{ id: CEL.enemyCap, x: 499, y: 14, clip: [300, 4, 212, 20] }]);
  });

  it("plates the player's name only when there is one to plate", () => {
    expect(of(paint().drawn, CEL.skullcracker)).toHaveLength(1);
    const none = paint({ player: { health: 100, max: 100, nameCel: 0 } }).drawn;
    expect(none.filter((d) => d.y === 35)).toEqual([]);
  });
});

describe("the lower band", () => {
  it("lights one life per life left, and no more than its five points", () => {
    const lights = (lives: number) =>
      paint({ lives }).drawn.filter((d) => d.id >= CEL.life && d.id < CEL.life + 10).map((d) => [d.id, d.x]);
    expect(lights(0)).toEqual([]);
    expect(lights(2)).toEqual([[CEL.life, 360], [CEL.life + 1, 380]]);
    expect(lights(9)).toHaveLength(5);
  });

  it("typesets the score from x238 in the panel's own numerals, one pixel apart", () => {
    const digits = paint({ score: 1100.7 }).drawn.filter((d) => d.clip?.[1] === 23);
    expect(digits.map((d) => [d.id - CEL.digit, d.x, d.y])).toEqual([
      [1, 238, 23],
      [1, 247, 23],
      [0, 256, 23],
      [0, 265, 23],
    ]);
    // a negative score is shown as nothing owed
    expect(paint({ score: -5 }).drawn.filter((d) => d.clip?.[1] === 23).map((d) => d.id)).toEqual([CEL.digit]);
  });

  it("scales the magazine to 0…64 and lays it out sixteen to a row", () => {
    const rows = (weapon: HudState["weapon"]) =>
      paint({ weapon }).drawn.filter((d) => d.x === 417).map((d) => [d.id, d.y]);
    // 5 of 8 is 40 of 64: two full rows, a row of 8, and an empty one
    expect(rows({ iconCel: 14400, ammo: 5, magazine: 8 })).toEqual([
      [CEL.gaugeFull, 333],
      [CEL.gaugeFull, 340],
      [CEL.gaugePartial - 8, 347],
      [CEL.gaugePartial, 354],
    ]);
    // empty hands, and a weapon with no magazine, are four empty rows
    const empty = [333, 340, 347, 354].map((y) => [CEL.gaugePartial, y]);
    expect(rows(null)).toEqual(empty);
    expect(rows({ iconCel: 14400, ammo: 3, magazine: 0 })).toEqual(empty);
  });

  it("draws the weapon's icon over its plate only while a weapon is held", () => {
    const held = paint({ weapon: { iconCel: 14400, ammo: 1, magazine: 1 } }).drawn;
    const plate = held.findIndex((d) => d.id === CEL.weaponPlate);
    const icon = held.findIndex((d) => d.id === 14400);
    expect(plate).toBeGreaterThanOrEqual(0);
    expect(icon).toBeGreaterThan(plate);
    expect(held[icon]).toMatchObject({ x: 365, y: 340 });
    expect(of(paint().drawn, 14400)).toEqual([]);
  });

  it("always shows the quota as two digits, clamped to 0…99", () => {
    const quota = (n: number) =>
      paint({ quota: n }).drawn.filter((d) => d.y === 346).map((d) => [d.id - CEL.digit, d.x]);
    expect(quota(7)).toEqual([[0, 467], [7, 479]]);
    expect(quota(42)).toEqual([[4, 467], [2, 479]]);
    expect(quota(123)).toEqual([[9, 467], [9, 479]]);
    expect(quota(-3)).toEqual([[0, 467], [0, 479]]);
  });

  it("shows the empty dial on a level with no limit, and a cel the caller names over the clock's", () => {
    const dial = (over: Partial<HudState>) => paint(over).drawn.filter((d) => d.x === 473 && d.y === 305).map((d) => d.id);
    expect(dial({ ticks: CLOCK.noLimit })).toEqual([CEL.dialOff]);
    expect(dial({ ticks: CLOCK.step * CLOCK.states })).toEqual([CEL.dial]);
    expect(dial({ ticks: 900, dial: CEL.dial + 3 })).toEqual([CEL.dial + 3]);
  });

  it("lights each held button and leaves the others up", () => {
    const mask = (1 << 1) | (1 << 5); // right and kick
    const lights = paint({ buttons: mask }).drawn.filter(
      (d) => (d.id >= CEL.buttonDown && d.id < CEL.buttonDown + 8) || (d.id >= CEL.buttonUp && d.id < CEL.buttonUp + 8),
    );
    expect(lights.map((d) => d.id)).toEqual(
      BUTTONS.map((_, i) => (mask & (1 << i) ? CEL.buttonDown : CEL.buttonUp) + i),
    );
    expect(lights.map((d) => [d.x, d.y])).toEqual(BUTTONS.map((b) => [b.x, b.y]));
  });
});

describe("the key names", () => {
  it("centres each name in its fifteen-pixel box at the table's baseline, in the book's ink", () => {
    const keys = ["W", "D", "S", "A", "P", "K", "I", "SPACE"];
    const { text } = paint({ keys, labelInk: "#123456" });
    expect(text).toHaveLength(8);
    // "W" is 6 wide in this context: (15 - 6) >> 1 = 4 in from the box
    expect(text[0]).toEqual({ name: "W", x: KEY_LABELS[0].x + 4, y: KEY_LABELS[0].y, ink: "#123456" });
    // "SPACE" is 30 wide and overhangs both sides: (15 - 30) >> 1 = -8
    expect(text[7]).toEqual({ name: "SPACE", x: KEY_LABELS[7].x - 8, y: KEY_LABELS[7].y, ink: "#123456" });
    expect(Math.floor((LABEL.box - 30) / 2)).toBe((LABEL.box - 30) >> 1);
  });

  it("writes nothing beside an unbound button, and nothing at all without a key map", () => {
    expect(paint({ keys: ["W", "", "S", "", "", "", "", ""] }).text.map((t) => t.name)).toEqual(["W", "S"]);
    expect(paint({ keys: ["W"] }).text[0].ink).toBe("#e0e0c0");
    expect(paint().text).toEqual([]);
  });
});
