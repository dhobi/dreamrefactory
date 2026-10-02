/**
 * The page's film player, `src/film.ts`, driven through the disc's own menus.
 *
 *   npx vitest run skullcracker/tests/film.ts
 *
 * The machine suites play films only through to their end (`tests/machine/
 * sound.ts` sits through a kill vignette); the half a PLAYER answers — a click
 * on a region, Escape, a film that names its own next frame — is the page's,
 * and no playthrough clicks. These do, on the two films whose regions are the
 * whole of their meaning:
 *
 *   - `MENU.MOV` waits on its first frame for one of seven regions, each a
 *     type-2 jump to a one-frame "frame N" at its tail that is itself an exit —
 *     and the frame it ends ON is the menu's whole answer. "frame 5" is the one
 *     type-3 exit, chaining to `prefs.mov`.
 *   - `PAUSEA.MOV` is 512x232 at origin (0, 42), the only panel whose regions
 *     are measured from a non-zero origin, and its frames are play-through: it
 *     animates while it waits and loops itself with a frame-level type-2 jump
 *     back to "pauseA 3". Its header names "pauseA 61" and "pauseA 62" as the
 *     two action frames, which is how `0x45e1e0` learns which button closed it.
 *
 * Codes 4, 5 and 7 are on no frame and no region of the disc (the count is in
 * `Film.act`'s comment), so what the player does with them is the port's own —
 * log and advance, or step back — and is pinned here on a film edited in memory.
 *
 * Needs the rip; without it every test is skipped and says so.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readMovFile, type MovFile } from "@dreamfactory/engine/df/mov";
import type { AudioSink, PlayHandle } from "@dreamfactory/engine/runtime/audio";
import { Film } from "../src/film";

const MOVIES = join(import.meta.dirname, "../gamefiles/SKULL/MOVIES");
const HAVE = existsSync(join(MOVIES, "MENU.MOV")) && existsSync(join(MOVIES, "PAUSEA.MOV"));
if (!HAVE) console.warn(`no ${MOVIES} — skipping (needs the Skull Cracker rip)`);

const read = (name: string): MovFile => readMovFile(new Uint8Array(readFileSync(join(MOVIES, name))));

/** what a film told its host, in order */
let said: string[];
/** every sound started, by channel, with its handle — `done` is the test's to set */
let played: { channel: string; handle: PlayHandle & { done: boolean; stopped: boolean } }[];
let now: number;

function host(): ConstructorParameters<typeof Film>[2] {
  const audio = {
    play(channel: string) {
      const handle = {
        done: false,
        stopped: false,
        stop() {
          this.stopped = true;
          this.done = true;
        },
      };
      played.push({ channel, handle });
      return handle;
    },
  } as unknown as AudioSink;
  return {
    audio,
    paint() {},
    log: (m) => said.push(`log ${m}`),
    onChain: (m) => said.push(`chain ${m}`),
    onAction: (w) => said.push(`action ${w}`),
    onEnd: (f) => said.push(`end ${f}`),
  };
}

/** one tick far enough on that any hold is over */
function step(film: Film, n = 1): void {
  for (let i = 0; i < n; i++) {
    now += 10_000;
    film.tick(now);
  }
}

/** a film's frames and regions, as something a test may edit */
type Editable = { segments: { keySkips: boolean; frames: { type: number; regions: { target: string }[] }[] }[] };

beforeEach(() => {
  said = [];
  played = [];
  now = performance.now();
});

describe.skipIf(!HAVE)("the main menu", () => {
  it("waits on its first frame for a click, and only a region owns one", () => {
    const film = new Film("menu.mov", read("MENU.MOV"), host());
    expect(film.waiting).toHaveLength(7);
    step(film, 5);
    expect(film.frameIndex).toBe(0);
    // the first button is x327..492, y80..107
    expect(film.owns(400, 90)).toBe(true);
    expect(film.owns(10, 10)).toBe(false);
    expect(film.click(10, 10, now)).toBe(false);
    expect(said).toEqual([]);
  });

  it("answers a button with the frame it ends on, after the click's own sound has finished", () => {
    const film = new Film("menu.mov", read("MENU.MOV"), host());
    const bed = played.find((p) => p.channel === "theme");
    expect(bed).toBeDefined();
    expect(film.click(400, 90, now)).toBe(true);
    // the region's "sound 1" plays once, and the jump lands on the one-frame exit
    const click = played.filter((p) => p.channel === "sound");
    expect(click).toHaveLength(1);
    expect(film.where).toContain(`"frame 2"`);
    // "frame 2" is authored to hold until the voice is done (flags bit 0)
    step(film, 3);
    expect(said).toEqual([]);
    click[0].handle.done = true;
    step(film);
    expect(said).toEqual(["end frame 2"]);
    // and the film's bed dies with it
    expect(bed!.handle.stopped).toBe(true);
  });

  it("chains to the preferences film from its fifth button, which is a type-3 exit", () => {
    const film = new Film("menu.mov", read("MENU.MOV"), host());
    // "frame 5" is y180..208
    expect(film.click(400, 190, now)).toBe(true);
    for (const p of played) p.handle.done = true;
    step(film);
    expect(said).toEqual(["end frame 5", "chain prefs.mov"]);
  });

  it("ends on the frame on screen when Escape is pressed, because its header lets it", () => {
    const film = new Film("menu.mov", read("MENU.MOV"), host());
    expect(film.skip()).toBe(true);
    expect(said).toEqual(["end frame 1"]);
  });

  it("ignores Escape on a film whose header does not allow it", () => {
    const mov = read("MENU.MOV");
    (mov as unknown as Editable).segments[0].keySkips = false;
    const film = new Film("menu.mov", mov, host());
    expect(film.skip()).toBe(false);
    expect(said).toEqual([]);
  });

  it("exits, and says why, when a region names a frame the film does not have", () => {
    const mov = read("MENU.MOV");
    (mov as unknown as Editable).segments[0].frames[0].regions[0].target = "frame 99";
    const film = new Film("menu.mov", mov, host());
    expect(film.click(400, 90, now)).toBe(true);
    expect(said).toEqual([`log menu.mov: frame "frame 99" not found — exiting`, "end frame 1"]);
  });
});

describe.skipIf(!HAVE)("the pause panel", () => {
  it("animates while it waits, and loops itself back to its third frame", () => {
    const film = new Film("pausea.mov", read("PAUSEA.MOV"), host());
    // its first two frames each start a sound of their own
    step(film, 2);
    expect(played.filter((p) => p.channel === "sound")).toHaveLength(2);
    // play-through frames: the regions are there, the film does not stop for them
    expect(film.frameIndex).toBe(2);
    expect(film.waiting).toEqual([]);
    step(film, 56);
    expect(film.frameIndex).toBe(58);
    // "pauseA 59" is a type-2 jump back to "pauseA 3"
    step(film);
    expect(film.frameIndex).toBe(2);
    expect(said).toEqual([]);
  });

  it("measures a click from the panel's own origin, 42 pixels down the screen", () => {
    const film = new Film("pausea.mov", read("PAUSEA.MOV"), host());
    // a click before the buttons have been drawn reaches nothing
    expect(film.click(400, 160, now)).toBe(false);
    step(film, 4);
    // Continue is y107..133 in the film, y149..175 on screen: y118 is the bezel above it
    expect(film.click(400, 118, now)).toBe(false);
    expect(film.click(400, 160, now)).toBe(true);
    for (const p of played) p.handle.done = true;
    step(film);
    expect(said).toEqual(["end pauseA 60"]);
  });

  it("reports the header's action frame as playback reaches it, then ends there", () => {
    const film = new Film("pausea.mov", read("PAUSEA.MOV"), host());
    step(film, 4);
    // the second button, y141..167 in the film, jumps to "pauseA 61" — action frame ONE
    expect(film.click(400, 193, now)).toBe(true);
    expect(said).toEqual(["action 1"]);
    for (const p of played) p.handle.done = true;
    step(film);
    expect(said).toEqual(["action 1", "end pauseA 61"]);
  });
});

describe.skipIf(!HAVE)("the codes no film on the disc uses", () => {
  it("steps back one frame on a 7", () => {
    const mov = read("PAUSEA.MOV");
    (mov as unknown as Editable).segments[0].frames[1].type = 7;
    const film = new Film("pausea.mov", mov, host());
    step(film);
    expect(film.frameIndex).toBe(1);
    step(film);
    expect(film.frameIndex).toBe(0);
  });

  it("logs a call or a return as not implemented and advances past it", () => {
    for (const code of [4, 5]) {
      said = [];
      const mov = read("PAUSEA.MOV");
      (mov as unknown as Editable).segments[0].frames[0].type = code;
      const film = new Film("pausea.mov", mov, host());
      step(film);
      expect(film.frameIndex).toBe(1);
      expect(said).toEqual([`log pausea.mov: action ${code} (call/return) is not implemented — advancing`]);
    }
  });
});
