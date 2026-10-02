/**
 * The floating barrels, `initbarrel` — `barrelFrame` in `src/game.ts`, the
 * class think `0x43fc30`, one engine frame at a time.
 *
 *   npx vitest run skullcracker/tests/barrels.ts
 *
 * A barrel's whole life is a counter in its user data and three scripts, and
 * `src/props.ts`'s `BARREL` carries every number with its address:
 *
 *   - a positive `param` is a delay with no script at all; when it runs out the
 *     bob goes on and the counter starts at -40 (`0x43fc39`, `0x43fc5b`);
 *   - stood on — the player's point inside the rect carried with the barrel,
 *     and at most 150 above it (`0x43fcce`, `0x43fd32`) — a SINKER counts up and,
 *     once the count read reaches -10, wobbles (`0x43fd49`); one that is not a
 *     sinker (`0x435d91`'s coin) just bobs under you for ever;
 *   - the wobble counts on while he stays and goes under past -2 (`0x43fe11`),
 *     ten pixels a frame down and along (`0x43fd99`), then comes back up where
 *     it started on a fresh bob;
 *   - the drift is held to ±7 (`0x43fc80`) and the y put back three inside the
 *     rect (`0x43fca6`).
 *
 * The playthroughs ride a barrel only as a platform; what it does under a
 * player who STAYS is a state machine with a counter, so it is pinned here in
 * node, frame by frame, with no level and no rip.
 */
import { describe, expect, it } from "vitest";
import * as game from "../src/game";
import { BARREL, type Barrel } from "../src/props";

/** a barrel at (0, 100) in a 100x200 rect, already bobbing */
function barrel(over: Partial<Barrel> = {}): Barrel {
  return {
    x: 0, y: 100, homeX: 0, homeY: 100, top: 0, left: -50, bottom: 200, right: 50,
    clock: 0, aclock: 0, wait: BARREL.rest, sinker: true, tag: "bob",
    vx: 0, vy: 0, mirror: false, bounced: false, ...over,
  };
}

/** `0x42f8b0`'s rounding: away from zero */
const away = (v: number): number => Math.sign(v) * Math.ceil(Math.abs(v));

/** the player's anchor 50 above the barrel's point, over its middle */
const ON = 50;
/** ...and well clear of it */
const OFF = 1_000;

/** step until the barrel's script changes, and say how many frames that took */
function framesUntil(b: Barrel, ay: number, tag: Barrel["tag"], max = 200): number {
  for (let f = 1; f <= max; f++) {
    game.barrelFrame(b, ay);
    if (b.tag === tag) return f;
  }
  return -1;
}

describe("a barrel's delay", () => {
  it("counts a positive param down with no script, then bobs on a counter of -40 (0x43fc39)", () => {
    const b = barrel({ tag: "none", wait: 3 });
    game.p.x = OFF;
    game.barrelFrame(b, 0);
    game.barrelFrame(b, 0);
    expect(b.tag).toBe("none");
    expect(b.aclock).toBe(0);
    game.barrelFrame(b, 0);
    expect(b.tag).toBe("bob");
    expect(b.wait).toBe(BARREL.rest);
  });
});

describe("standing on a barrel", () => {
  it("wobbles a sinker on the 31st frame he stands on it: -40 counted up until the count read is -10 (0x43fd49)", () => {
    game.p.x = 0;
    const b = barrel();
    expect(framesUntil(b, ON, "wobble")).toBe(31);
    // the think stops it dead and the wobble's first cel pushes: 20 over ten
    expect(b.vy).toBe(away(BARREL.wobble.dy[0] / BARREL.divisor));
    expect(b.aclock).toBe(1);
  });

  it("puts it under on the eighth frame of the wobble, and brings it back up where it started (0x43fe11, 0x43fd99)", () => {
    game.p.x = 0;
    const b = barrel();
    framesUntil(b, ON, "wobble");
    expect(framesUntil(b, ON, "sink")).toBe(8);
    expect(b.wait).toBe(BARREL.rest);
    // going under: ten down and ten along a frame, whatever the mover does
    const y = b.y;
    const x = b.x;
    game.barrelFrame(b, ON);
    expect([b.x - x, b.y - y]).toEqual([BARREL.sinkStep, BARREL.sinkStep]);
    // ...and when the script has run, back at its own y on a fresh bob
    expect(framesUntil(b, ON, "bob", BARREL.sink.cels.length + 1)).toBeGreaterThan(0);
    expect(b.y).toBe(b.homeY);
    expect(b.aclock).toBe(1);
  });

  it("leaves a barrel that is not a sinker bobbing under him for ever", () => {
    game.p.x = 0;
    const b = barrel({ sinker: false });
    expect(framesUntil(b, ON, "wobble", 300)).toBe(-1);
    expect(b.tag).toBe("bob");
  });

  it("keeps wobbling, and does not go under, once he steps off mid-wobble", () => {
    game.p.x = 0;
    const b = barrel();
    framesUntil(b, ON, "wobble");
    const wait = b.wait;
    game.p.x = OFF;
    expect(framesUntil(b, ON, "sink", 60)).toBe(-1);
    expect(b.tag).toBe("wobble");
    expect(b.wait).toBe(wait);
  });

  it("counts him on it only within 150 above its point, and inside the rect it carries along", () => {
    for (const [px, ay] of [[0, 100 - BARREL.reach], [0, 100], [60, ON], [-60, ON]]) {
      game.p.x = px;
      const b = barrel();
      expect(framesUntil(b, ay, "wobble", 60), `player at x${px}, anchor ${ay}`).toBe(-1);
      expect(b.wait).toBe(BARREL.rest);
    }
    // the rect moves with the barrel: 40 along, x60 is inside it
    game.p.x = 60;
    const moved = barrel({ x: 40 });
    expect(framesUntil(moved, ON, "wobble")).toBe(31);
  });
});

describe("a barrel adrift", () => {
  it("holds its drift to ±7, flips its facing when it bounces, and is put back inside its rect (0x43fc80, 0x43fca6)", () => {
    game.p.x = OFF;
    const b = barrel({ vx: 30, bounced: true, y: -20 });
    game.barrelFrame(b, 0);
    expect(b.mirror).toBe(true);
    expect(b.bounced).toBe(false);
    // ±7 held, then the bob's own first push (22 over the divisor of ten, mirrored) added
    const push = away(BARREL.bob.dx[0] / BARREL.divisor);
    expect(b.vx).toBe(BARREL.drift - push);
    expect(b.y).toBe(b.top + BARREL.inset);
    const low = barrel({ vx: -30, y: 250 });
    game.barrelFrame(low, 0);
    expect(low.y).toBe(low.bottom - BARREL.inset);
    expect(low.vx).toBe(-BARREL.drift + push);
  });
});
