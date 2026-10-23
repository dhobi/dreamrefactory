/**
 * The held weapons and the poses a creature puts on the player
 * (`src/world/arsenal.ts`, `src/world/hurt.ts`): which stream opens and what it
 * says, for either player; the blaster with nothing in it; the four poses of
 * `0x42f2e0` and the pin a grabber writes.
 *
 *   npx vitest run skullcracker/tests/world-arms.ts
 *
 * Called on their own on a level stood up from the rip, with a recording
 * stand-in for the sound, and held to the addresses in `src/guns.ts` and the
 * functions' own comments.
 *
 * Needs the rip; skipped without it.
 */
import { describe, expect, it } from "vitest";
import { STREAMS } from "../src/guns";
import { haveRip, headless, recordSound, type Game, type Headless } from "./machine/harness";

let h: Headless;
let g: Game;

async function boot(query: string): Promise<void> {
  if (!h) h = await headless(query);
  else await h.load(query);
  g = h.game;
  g.killStreams();
}

describe.skipIf(!haveRip())("the streams (0x42ba49)", () => {
  it("open one at a time, on rounds, with the player's own sound — 0x16 for the first player and 0xf for the second", async () => {
    await boot("level=2&foes=0");
    g.inv.weapon = 10;
    g.inv.rounds[10] = 0;
    g.openStream();
    expect(g.streams).toHaveLength(0);
    g.inv.rounds[10] = 50;
    let heard = recordSound(g);
    g.openStream();
    g.openStream();
    expect(g.streams).toHaveLength(1);
    expect(heard).toEqual([{ call: "own", args: [STREAMS[10].sound.own, g.p.x, g.p.y] }]);
    expect(g.streamCel(g.streams[0])).toBe(STREAMS[10].start.cels[0]);
    // the shut-off silences it, and the cancel takes it away silencing it again
    heard = recordSound(g);
    g.shutStreams();
    expect(g.streams[0].state).toBe("stop");
    expect(heard).toEqual([{ call: "mute", args: [STREAMS[10].sound.own, true] }]);
    g.killStreams();
    expect(g.streams).toHaveLength(0);

    await boot("level=2&foes=0&char=1");
    g.inv.weapon = 10;
    g.inv.rounds[10] = 50;
    heard = recordSound(g);
    g.openStream();
    expect(heard[0]).toEqual({ call: "own", args: [STREAMS[10].sound.own1, g.p.x, g.p.y] });
    heard = recordSound(g);
    g.killStreams();
    expect(heard).toEqual([{ call: "mute", args: [STREAMS[10].sound.own1, true] }]);
    g.useCharacter(0);
  });

  it("the scepter's is a shot: forty rounds and the chapter's 0x22, no voice of the player's (0x41f7b6)", async () => {
    await boot("level=12&foes=0");
    g.inv.weapon = 16;
    g.inv.rounds[16] = 100;
    const heard = recordSound(g);
    g.openStream();
    expect(g.inv.rounds[16]).toBe(60);
    expect(heard).toEqual([{ call: "effect", args: [0x22, g.p.x, g.p.y] }]);
    g.killStreams();
  });
});

describe.skipIf(!haveRip())("the blaster (0x412b5b)", () => {
  it("fires nothing with nothing in it", async () => {
    await boot("level=13&foes=0");
    g.setBolts([]);
    g.inv.rounds[6] = 0;
    g.fireBolt();
    expect(g.bolts).toHaveLength(0);
    g.inv.rounds[6] = 2;
    g.fireBolt();
    expect(g.bolts).toHaveLength(1);
    expect(g.inv.rounds[6]).toBe(1);
    g.setBolts([]);
  });
});

describe.skipIf(!haveRip())("the poses a creature puts on him (0x42f2e0)", () => {
  it("-1 is posed, 3 held, 4 the jolt; 2 is the knockdown, but not over one already down", async () => {
    await boot("level=1&foes=0");
    g.posePlayer(-1);
    expect(g.p.act).toBe("posed");
    g.posePlayer(3);
    expect(g.p.act).toBe("held");
    g.posePlayer(4);
    expect(g.p.act).toBe("jolt");
    g.p.act = "downBack";
    g.p.actClock = 7;
    g.posePlayer(2);
    expect(g.p.act).toBe("downBack");
    expect(g.p.actClock).toBe(7);
    g.p.act = null;
    g.posePlayer(2);
    expect(g.p.act).toBe("downFront");
  });

  it("on a ladder or a bar the knockdown only knocks him off (0x42f363)", async () => {
    await boot("level=1&foes=0");
    g.p.act = null;
    g.setKnockedOff(false);
    g.p.climbing = true;
    g.posePlayer(2);
    expect(g.p.act).toBeNull();
    expect(g.knockedOff).toBe(true);
    g.p.climbing = false;
    g.setKnockedOff(false);
  });

  it("a pin writes the point, and a speed that is not downward is no fall at all (0x42fdb0)", async () => {
    await boot("level=1&foes=0");
    g.p.fallPx = 120;
    g.pinPlayer({ x: 500, y: 300 }, { vx: 4, vy: -3, facing: -2 });
    expect(g.p.x).toBe(500);
    expect(g.p.y).toBe(300 + g.p.feet);
    expect(g.p.vx).toBe(4);
    expect(g.p.vyRaw).toBe(-3);
    expect(g.p.fallPx).toBe(0);
    expect(g.p.facing).toBe(-1);
    // ...and one going down keeps the fall it had
    g.p.fallPx = 120;
    g.pinPlayer({ x: 500, y: 300 }, { vy: 5, facing: 3 });
    expect(g.p.fallPx).toBe(120);
    expect(g.p.facing).toBe(1);
  });
});
