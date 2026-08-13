/**
 * The intro film and its question, played the way a player plays it — headless,
 * over the bytes tools/mknightdive.ts generates, through a real
 * {@link GameSession} and the engine's own {@link MoviePlayer}.
 *
 * Same claim as the language chooser's suite (tests/auto/lang-chooser.ts): no
 * `gamefiles/` and no BOOTFILE. The intro runs *before* the boot, so it must not
 * need anything a language tree carries — and the answer it produces has to come
 * back through the engine's own `actionframe()` channel rather than through a
 * hook the page installed, which is the part worth pinning.
 *
 * The GIF is made up here rather than read from disk: the animation the site
 * actually ships this from is somebody else's and is not in the repository, and a
 * test that skips when an asset is missing is a test that stops running.
 */
import { test, expect } from "vitest";
import { NullAudioSink } from "../../src/engine/audio";
import { GameSession } from "../../src/engine/session";
import { NIGHTDIVE_MOVIE, NightdiveIntro, introPlaysFor } from "../../src/nightdive";
import { EXTRA_EDITIONS, LANGUAGES } from "../../src/languages";
import { readMovFile } from "../../src/df/mov";
import { FrameBuffer, decodeFrame } from "../../src/df/image";
import { SCREEN_H, SCREEN_W } from "../../src/screen";
import { GifImage } from "../../tools/gif";
import { buildNightdiveMov } from "../../tools/mknightdive";

/**
 * A stand-in animation: four frames of a shape that moves, at 10 cs each.
 *
 * It has to actually change from frame to frame and it has to have a brightest
 * frame that is not the last one — that is the rule the question's background is
 * chosen by (the last frame within 5% of the peak), and a flat animation would
 * let a broken rule pass.
 */
function fakeGif(): GifImage {
  const width = 64;
  const height = 32;
  const frames = [0, 1, 2, 3].map((i) => {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        // a bar that grows for three frames and then goes dark again
        const lit = i < 3 && x < (i + 1) * 16;
        rgba[o] = lit ? 40 + i * 60 : 8;
        rgba[o + 1] = lit ? 90 : 8;
        rgba[o + 2] = lit ? 150 : 16;
        rgba[o + 3] = 255;
      }
    }
    return { rgba, delayCs: 10 };
  });
  return { width, height, frames };
}

const MOVIE = buildNightdiveMov(fakeGif()).bytes;

/** a session whose only file is the intro */
function newSession(): GameSession {
  const session = new GameSession(
    (name) => (name.toLowerCase() === NIGHTDIVE_MOVIE ? MOVIE : null),
    new NullAudioSink(),
  );
  session.onLog = () => {};
  return session;
}

/** a file store that has the movie, as the page's FileStore would after a fetch */
const served = { load: async (): Promise<Uint8Array | null> => MOVIE };

async function openIntro(): Promise<{ session: GameSession; intro: NightdiveIntro }> {
  const session = newSession();
  const intro = new NightdiveIntro(session);
  expect(await intro.open(served)).toBe(true);
  return { session, intro };
}

/**
 * Run the film out: the port advances a self-paced movie from the clock, so a
 * caller ticks it with a clock that runs faster than real time. Stops at the
 * question, which parks (a frame with regions waits for a click and no amount of
 * ticking moves it).
 */
function playToQuestion(intro: NightdiveIntro): number {
  let now = 0;
  for (let i = 0; i < 2000 && intro.regions().length === 0; i++) {
    now += 100;
    intro.tick(now);
  }
  expect(intro.regions().length).toBe(2);
  return now;
}

/** the middle of the button whose click leads to `target` */
function centre(intro: NightdiveIntro, target: string): { x: number; y: number } {
  const region = intro.regions().find((r) => r.target === target);
  if (!region) throw new Error(`no region targeting ${target}`);
  return { x: Math.round((region.x0 + region.x1) / 2), y: Math.round((region.y0 + region.y1) / 2) };
}

// --- the file ---------------------------------------------------------------

test("the generated movie is a two-segment film: the animation, then the question", () => {
  const mov = readMovFile(MOVIE);
  expect(mov.segments.length).toBe(2);
  // segment 0 is the GIF, frame for frame, at the GIF's own rate (10 cs = 6 ticks)
  expect(mov.frames.length).toBe(4);
  expect(mov.minHoldTicks).toBe(6);
  // every frame steps but the last, which exits INTO the question — without a
  // step anywhere the port reads the segment as a click-through close-up and
  // parks on frame 0 (see chooseFrameInterval)
  expect(mov.frames.map((f) => f.type)).toEqual([6, 6, 6, 1]);
  expect(mov.keySkips).toBe(true); // ESC skips it, as it skips every shipped movie

  const question = mov.segments[1];
  expect(question.frames.map((f) => f.name.toLowerCase())).toEqual(["ask", "yes", "gog"]);
  expect(question.frames[0].regions.map((r) => r.target)).toEqual(["yes", "gog"]);
  // the answer's channel: both destinations are the header's action-frame slots
  expect([question.actionFrame1, question.actionFrame2]).toEqual(["yes", "gog"]);
});

test("every frame decodes at full screen size, question included", () => {
  const mov = readMovFile(MOVIE);
  for (const seg of mov.segments) {
    const fb = new FrameBuffer();
    for (const frame of seg.frames) {
      const d = decodeFrame(mov.file.containers[frame.locationFrame].data, fb);
      expect([d.width, d.height]).toEqual([SCREEN_W, SCREEN_H]);
    }
  }
});

test("the question is drawn ON the film: same palette, and the logo under it", () => {
  const mov = readMovFile(MOVIE);
  // one palette for both segments is what lets the question be an overlay rather
  // than a screen of its own
  expect([...mov.segments[1].paletteRaw]).toEqual([...mov.paletteRaw]);

  // the "ask" frame is the film's brightest frame with things drawn on it, so
  // most of it has to be pixels the film already had. The brightest frame of the
  // stand-in animation is index 2 — not the last one, which goes dark.
  const fb = new FrameBuffer();
  const film: Uint8Array[] = mov.frames.map((f) => {
    decodeFrame(mov.file.containers[f.locationFrame].data, fb);
    return fb.pixels.slice(0, SCREEN_W * SCREEN_H);
  });
  const fb2 = new FrameBuffer();
  decodeFrame(mov.file.containers[mov.segments[1].frames[0].locationFrame].data, fb2);
  const ask = fb2.pixels.slice(0, SCREEN_W * SCREEN_H);
  const sameAs = (n: number): number =>
    ask.reduce((count, v, i) => count + (v === film[n][i] ? 1 : 0), 0);
  const best = [0, 1, 2, 3].reduce((b, n) => (sameAs(n) > sameAs(b) ? n : b), 0);
  expect(best).toBe(2);
  expect(sameAs(2) / ask.length).toBeGreaterThan(0.8);
});

// --- playing it -------------------------------------------------------------

test("the film plays itself out and then WAITS on the question", async () => {
  const { intro } = await openIntro();
  const now = playToQuestion(intro);
  // it parked rather than ran out: more ticks change nothing
  for (let i = 0; i < 50; i++) intro.tick(now + 100 * i);
  expect(intro.regions().length).toBe(2);
  expect(intro.answer()).toBe("unanswered");
});

test('clicking YES answers "owns" — and does so while the click is still live', async () => {
  const { intro } = await openIntro();
  let now = playToQuestion(intro);
  const { x, y } = centre(intro, "yes");
  intro.click(x, y);
  // synchronously, because the page acts on the answer inside the gesture
  expect(intro.answer()).toBe("owns");
  for (let i = 0; i < 200; i++) intro.tick((now += 100));
  await intro.done;
  expect(intro.answer()).toBe("owns");
});

test('clicking NO answers "wants"', async () => {
  const { intro } = await openIntro();
  let now = playToQuestion(intro);
  const { x, y } = centre(intro, "gog");
  intro.click(x, y);
  expect(intro.answer()).toBe("wants");
  for (let i = 0; i < 200; i++) intro.tick((now += 100));
  await intro.done;
  expect(intro.answer()).toBe("wants");
});

test("a click outside both buttons answers nothing and does not end the movie", async () => {
  const { intro } = await openIntro();
  playToQuestion(intro);
  intro.click(2, 2);
  expect(intro.answer()).toBe("unanswered");
  expect(intro.regions().length).toBe(2);
});

test("ESC presses past the FILM and lands on the question (#171)", async () => {
  const { intro } = await openIntro();
  intro.tick(0);
  // the movie's own key filter: the marker is what it insists on, and a plain
  // key is not it
  expect(intro.key("x")).toBe(false);
  expect(intro.key(".", true)).toBe(true);
  // it did NOT take the question with it — that is the bug this replaced, where
  // one press booted the game without ever asking
  expect(intro.regions().length).toBe(2);
  expect(intro.answer()).toBe("unanswered");
});

test("ESC over the QUESTION does nothing at all (#171)", async () => {
  const { intro } = await openIntro();
  let now = playToQuestion(intro);
  // the question segment carries no skip flag, so the key filter turns it away
  expect(intro.key(".", true)).toBe(false);
  expect(intro.regions().length).toBe(2);
  // and no amount of clock ends it either: it is answered, or it is on screen
  for (let i = 0; i < 200; i++) intro.tick((now += 100));
  expect(intro.regions().length).toBe(2);
  expect(intro.answer()).toBe("unanswered");

  // ...and the buttons still work, so it is a question and not a trap
  const { x, y } = centre(intro, "yes");
  intro.click(x, y);
  expect(intro.answer()).toBe("owns");
});

test("closing hands the action-frame set back, so boot() can ask its own", async () => {
  const { session, intro } = await openIntro();
  let now = playToQuestion(intro);
  const { x, y } = centre(intro, "yes");
  intro.click(x, y);
  for (let i = 0; i < 200; i++) intro.tick((now += 100));
  await intro.done;
  expect(session.movieActions.size).toBeGreaterThan(0);
  intro.close();
  // boot() reads actionframe(1) off playmode.mov within a second of this, and a
  // leftover bit there is the difference between the guided tour and the game
  expect(session.movieActions.size).toBe(0);
});

// --- which editions get it --------------------------------------------------

test("English only: no other edition plays the intro", () => {
  expect(introPlaysFor("en")).toBe(true);
  expect(introPlaysFor("EN")).toBe(true);
  for (const lang of LANGUAGES) {
    if (lang.code === "en") continue;
    expect(introPlaysFor(lang.code)).toBe(false);
  }
  // and the cuts that are not translations — the demo
  for (const edition of EXTRA_EDITIONS) expect(introPlaysFor(edition.code)).toBe(false);
  expect(introPlaysFor("")).toBe(false);
});
