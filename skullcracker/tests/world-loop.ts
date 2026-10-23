/**
 * The player's own state machine (`src/world/loop.ts`), played through the
 * headless harness a tick or a frame at a time: the moves the attack keys start
 * on the ground and off a ledge, the duck's crawl, the punch turning
 * him round, and the monkeybar swung EAST — the way the VAT suite does not.
 *
 *   npx vitest run skullcracker/tests/world-loop.ts
 *
 * Each move is one of the player class's own handlers, `0x4296fc` (the idle),
 * `0x429d6a` (the run), `0x42aadd` (the duck) and `0x42b410` (the bar), and
 * the test asserts the act or the tag the handler installs.
 *
 * Needs the rip; skipped without it.
 */
import { describe, expect, it } from "vitest";
import { haveRip, headless, type Game, type Headless } from "./machine/harness";

let h: Headless;
let g: Game;

async function boot(query: string): Promise<void> {
  if (!h) h = await headless(query);
  else await h.load(query);
  g = h.game;
  h.until(() => g.p.onGround || !!g.p.bar, 60);
  h.frame(4);
}

/** let every key go, and let the act in hand run out */
function settle(): void {
  for (const k of Object.keys(g.held) as (keyof Game["held"])[]) h.hold(k, false);
  h.until(() => !g.p.act && g.p.onGround, 120);
  h.frame(2);
}

describe.skipIf(!haveRip())("the attack keys on the ground (0x4296fc)", () => {
  it("both buttons ducked are the duck's combination, and stood up the headbutt", async () => {
    await boot("level=1&foes=0");
    h.hold("down", true);
    h.frame(2);
    g.setPunchPressed(true);
    g.setKickPressed(true);
    g.tick();
    expect(g.p.act).toBe("duckCombo");
    settle();
    g.setPunchPressed(true);
    g.setKickPressed(true);
    g.tick();
    expect(g.p.act).toBe("headbutt");
  });

  it("a punch turns him round when backward is held as it strikes (0x42a4c4)", async () => {
    await boot("level=1&foes=0");
    g.p.facing = 1;
    h.press("punch");
    g.tick();
    expect(g.p.act).toMatch(/^punch2?$/);
    h.hold("left", true);
    h.until(() => g.p.facing < 0 || !g.p.act, 30);
    expect(g.p.facing).toBe(-1);
  });
});

describe.skipIf(!haveRip())("S at a gun (0x42f081)", () => {
  it("throws down the one in his hands before reaching for another (0x42f0dc)", async () => {
    await boot("level=2&foes=0");
    const i = g.level!.rooms.indexOf(g.p.room!);
    const guns = g.level!.guns[i];
    // armed with the flamer, 0xa, and the blaster's 6 lying a reach ahead
    g.inv.weapon = 0xa;
    g.inv.armed = true;
    g.inv.drawn = false;
    g.p.facing = 1;
    const at = g.p.x + 35;
    guns.push({ code: 6, x: at, y: g.p.y, left: at - 55, right: at + 55, clock: 0 });
    const n = guns.length;
    h.hold("down", true);
    g.tick();
    expect(g.p.act).toBe("reach");
    // the flamer is on the floor beside it, still falling, and his hands are empty
    const now = g.level!.guns[i];
    expect(now).toHaveLength(n + 1);
    expect(now.at(-1)).toMatchObject({ code: 0xa, dropped: true });
    expect(g.inv.armed).toBe(false);
  });
});

describe.skipIf(!haveRip())("the attack keys off a ledge, still in a ground state", () => {
  /** stood in the air over the floor, falling out of `state` */
  function offLedge(state: "run" | "idle"): void {
    settle();
    g.p.y -= 300;
    g.p.onGround = false;
    g.p.launched = false;
    g.p.fallState = state;
    g.p.vyRaw = 0;
  }

  it("the run's P is a punch, coin and all (0x429d6a)", async () => {
    await boot("level=1&foes=0");
    offLedge("run");
    g.setPunchPressed(true);
    g.tick();
    expect(g.p.act).toMatch(/^punch2?$/);
  });

  it("the idle's two buttons are the headbutt, either way round (0x4296fc)", async () => {
    await boot("level=1&foes=0");
    offLedge("idle");
    g.setPunchPressed(true);
    g.held.kick = true;
    g.tick();
    expect(g.p.act).toBe("headbutt");
    offLedge("idle");
    g.setKickPressed(true);
    g.held.punch = true;
    g.tick();
    expect(g.p.act).toBe("headbutt");
  });
});

describe.skipIf(!haveRip())("the duck (0x42aadd)", () => {
  it("crawls on the crawl's 47 rather than the walk's 95", async () => {
    await boot("level=1&foes=0");
    h.hold("down", true);
    h.frame(3);
    h.hold("right", true);
    const x = g.p.x;
    h.frame(6);
    expect(g.p.crouching).toBe(true);
    const crawled = g.p.x - x;
    expect(crawled).toBeGreaterThan(0);
    settle();
    const y = g.p.x;
    h.hold("right", true);
    h.frame(6);
    expect(g.p.x - y).toBeGreaterThan(crawled);
  });
});

describe.skipIf(!haveRip())("VAT's monkeybar swung east (0x42b410)", () => {
  it("toward is tag 1, the holds only count up, the east end holds him in, and W ends the swing in the chin-up", async () => {
    await boot("level=16&x=6600&y=2002");
    h.hold("up", true);
    h.press("jump");
    expect(h.until(() => !!g.p.bar, 25)).toBeGreaterThanOrEqual(0);
    h.hold("up", false);
    h.frame(4);
    const bar = g.p.bar!;
    // the grab is at the east end; four holds west first
    h.hold("left", true);
    h.until(() => g.p.barHold <= 7, 80);
    h.hold("left", false);
    h.until(() => g.p.barTag === 0, 20);
    // facing east, D is toward
    g.p.facing = 1;
    h.hold("right", true);
    h.frame(1);
    expect(g.p.barTag).toBe(1);
    const holds: number[] = [];
    for (let i = 0; i < 80; i++) {
      holds.push(g.p.barHold);
      h.frame();
      // the preamble clamps x into the record and the swing adds its ten back
      // on, so a key held at the east end leaves him at most a frame past it
      expect(g.p.x).toBeLessThanOrEqual(bar.right + 10);
    }
    expect(holds.every((v, i) => i === 0 || v >= holds[i - 1])).toBe(true);
    expect(holds.at(-1)).toBeGreaterThan(holds[0]);
    // W in place of D as a swing ends goes up to the chin-up (0x42b67a)...
    h.hold("right", false);
    h.hold("up", true);
    h.until(() => g.p.barTag !== 1, 20);
    expect(g.p.barTag).toBe(3);
    // ...from a snap clamped to the record: left + n * 65, or its right (0x42b677)
    expect(g.p.x).toBe(Math.min(bar.right, bar.left + g.p.barHold * Math.abs(bar.param)));
    h.hold("up", false);
  });
});
