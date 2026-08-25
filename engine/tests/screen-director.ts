/**
 * A screen with no room on it.
 *
 *   npx vitest run engine/tests/screen-director.ts
 *
 * The whole point of {@link ScreenDirector} existing separately from `SetViewer`
 * is that a game need not have rooms. Before it did, the compositor, the movie
 * player, the fades and the CLUT all hung off a class whose constructor demanded
 * a `SetFile`, so a game with no `.SET` — *Timelapse* has none on any of its four
 * discs — got no screen at all, and two shipped boots (Titanic's 1996 demo, Dust's
 * intro films) had to open a room they did not want purely to have a surface.
 *
 * So this test never builds a room. It authors a stage instead, at a size that is
 * not the engine's default, and asks the director to composite it — which is
 * exactly what a SET-less game does on every frame of its life.
 *
 * No game data: the stage is generated here (`engine/src/df/stg-build.ts`, the same
 * writer the language chooser's stage is built with), which is what lets this
 * live in the engine's own suite.
 */
import { test, expect } from "vitest";
import { buildStgBytes } from "@dreamfactory/engine/df/stg-build";
import { buildMovBytes } from "@dreamfactory/engine/df/mov-build";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { ScreenDirector } from "@dreamfactory/engine/web/screen-director";
import { SCREEN_W } from "@dreamfactory/engine/web/screen";

/**
 * Timelapse's screen, and the reason this test uses it: it is WIDER than the DF4
 * default, so a framebuffer still pinned to 512 could not hold the right-hand
 * column no matter what else was correct.
 */
const W = 640;
const H = 480;

/** three palette slots: 0 black, 1 the flat's field, 2 its right-edge marker */
const PALETTE = new Uint8Array([0, 0, 0, 40, 80, 160, 220, 30, 30]);

/**
 * A flat whose right half is a clickable region, and whose handler leaves a mark
 * in a global — which is how the input test below reads whether the click
 * actually arrived.
 */
const REGION_SCRIPT = `code mousedown (arg)
\tglobal clicked
\tclicked = "region"
endcode
`;

/** a full-screen flat: index 1 everywhere, index 2 down the last column */
function flatArt(): { pixels: Uint8Array; width: number; height: number } {
  const pixels = new Uint8Array(W * H).fill(1);
  for (let y = 0; y < H; y++) pixels[y * W + (W - 1)] = 2;
  return { pixels, width: W, height: H };
}

function newDirector(): { session: GameSession; dir: ScreenDirector } {
  const bytes = buildStgBytes({
    palette: PALETTE,
    // Two flats, because one is a special case in the reader and this is meant
    // to be an ordinary stage. `openstagefile` lands on the first.
    flats: [
      {
        name: "room1",
        art: flatArt(),
        regions: [
          {
            name: "right",
            top: 0,
            left: W / 2,
            bottom: H - 1,
            right: W - 1,
            script: compileScript(REGION_SCRIPT),
          },
        ],
      },
      { name: "room2", art: flatArt() },
    ],
  });
  const session = new GameSession((name) => (name === "test.stg" ? bytes : null), new NullAudioSink());
  return { session, dir: new ScreenDirector(session, { width: W, height: H }) };
}

test("the screen composites a stage flat with no room ever attached", async () => {
  const { session, dir } = newDirector();
  expect(dir.currentRoom, "no room layer: the case this class exists for").toBeNull();

  await session.stageCtrl.openStageFile("test.stg");
  expect(session.currentFlat).toBe("room1");

  // The compositor's own answer for what it drew. "flat" — not "set", and not
  // null, which is what it had to return when there was no viewer to ask.
  expect(dir.paintWorldInto()).toBe("flat");

  // ...and the pixels are the flat's, at the flat's own size. The right-hand
  // column is the assertion that matters: 639 is past the 512-wide framebuffer
  // this engine used to hardcode, so a screen still pinned to Titanic's geometry
  // cannot pass this line however well everything else works.
  expect(W).toBeGreaterThan(SCREEN_W);
  expect(dir.screen.width).toBe(W);
  expect(dir.screen.height).toBe(H);
  const at = (x: number, y: number): number[] => {
    const o = (y * W + x) * 4;
    return [dir.screen.frame[o], dir.screen.frame[o + 1], dir.screen.frame[o + 2]];
  };
  // through the display gamma, so compare by which slot is brightest rather than
  // by the palette's raw triples (screen-gamma.ts)
  const [fr, fg, fb] = at(320, 240);
  expect(fb, "the flat's field is its blue-dominant slot 1").toBeGreaterThan(fr);
  expect(fb).toBeGreaterThan(fg);
  const [mr, mg] = at(W - 1, 240);
  expect(mr, "the last column is slot 2, red-dominant — so the full width landed").toBeGreaterThan(mg);
});

test("the screen's own per-frame service runs with no room", () => {
  const { session, dir } = newDirector();
  // A fade is the clearest case: it is a script-driven ramp the session steps in
  // `tickFade`, it used to be stepped inside `SetViewer.tick`, and a game with no
  // room therefore never faded at all.
  session.fade.level = 1;
  session.fade.queue.push({ to: 0, steps: 4 });
  let now = 0;
  for (let i = 0; i < 12; i++) expect(dir.tick((now += 50))).toBeNull();
  expect(session.fade.level, "the ramp ran to its end without a room to run it").toBe(0);
});

test("with no room, nothing claims the screen but the world", async () => {
  const { session, dir } = newDirector();
  expect(dir.screenOwner()).toBe("world");
  await session.stageCtrl.openStageFile("test.stg");
  expect(dir.screenOwner()).toBe("world");
  // and a flat is never mistaken for a MATTE, which is a hole for a room view to
  // be composited into: no room, no holes. Asking would have used Titanic's
  // 512x264 view region on a 640x480 picture.
  expect(dir.paintWorldInto()).toBe("flat");
});

test("a click reaches a flat's region with no room in the chain", async () => {
  const { session, dir } = newDirector();
  await session.stageCtrl.openStageFile("test.stg");

  // The whole priority chain, not a shortcut into the stage: `press` is a movie's
  // clicks, then a conversation's, then the `lockevents` gate, then the queue,
  // then props, then the ROOM — absent here — then the stage. Every one of those
  // steps used to live on a class that needed a `SetFile` to exist, so this call
  // was unreachable for a game with no rooms.
  session.pointerDown = true;
  await dir.press(320 + 40, 240);
  dir.release(360, 240);
  expect(session.interp.globals.get("clicked"), "the region's mousedown ran").toBe("region");

  // ...and the left half is not the region, so the click falls through it to the
  // flat/stage surface rather than being claimed
  session.interp.globals.set("clicked", "");
  await dir.press(10, 240);
  expect(session.interp.globals.get("clicked")).toBe("");
});

test("hittest with no room answers for the stage, never for a scene", async () => {
  const { session, dir } = newDirector();
  await session.stageCtrl.openStageFile("test.stg");
  // "button" over the region, "flat" beside it — and never "scene" or "painting",
  // which are the room's two answers and cannot arise without one. Asked through
  // the session hook, because that is what the game's own scripts call.
  expect(session.hitTestAt(400, 240)).toEqual({ name: "right", type: "button" });
  expect(session.hitTestAt(10, 240)).toEqual({ name: "room1", type: "flat" });
  expect(session.pointInSet(1, 1), "no room image to be inside of").toBe(false);
  expect(session.pointInStage(10, 240)).toBe(true);
});

test("a key with no room is offered to the screen and then not consumed", async () => {
  const { session, dir } = newDirector();
  await session.stageCtrl.openStageFile("test.stg");
  // The stage here handles no keys and there is no room to navigate, so nothing
  // takes it — which is the honest answer, and it is an ANSWER rather than a
  // crash, which is what asking a null viewer used to be.
  expect(await dir.keyDown("w")).toBe(false);
});

/**
 * A film is FETCHED before it is looked for.
 *
 * `MoviePlayer.load` reads the provider synchronously, and a browser's provider
 * only answers for what has already arrived — so the first `playmovie` of any
 * film that was not preloaded found nothing, logged "not available", and the
 * script carried on as though the movie had played and ended.
 *
 * Timelapse is the game with no preload list at all. Its `boot()` ends in
 * `enterworld ("I")` and every name it opens is built by concatenation, so
 * `readBootPlan` has no string literal to find and every film arrives on the
 * miss that wants it. Reported from play on the journal, whose `dojournal` is
 *
 *     playmovie (curworldchar @ "098.Mov")
 *     playmovie (curworldchar @ "099.Mov")
 *
 * — nothing the first time you opened it, and both films the second, because the
 * failed first attempt is what pulled them in. The panel's Credits button
 * (`playmovie ("credits.mov")`) is the same fault, and so is every film on the
 * four discs.
 *
 * The other two games hid it completely: their BOOTFILEs name their films as
 * literals, so the boot plan has fetched them long before a script asks.
 *
 * The provider here is a browser's, in miniature: it answers only for what
 * `ensureFile` has already been awaited for.
 */
test("a film is fetched before it is played, so the FIRST play works", async () => {
  const stg = buildStgBytes({ palette: PALETTE, flats: [{ name: "room1", art: flatArt() }] });
  const film = buildMovBytes({
    palette: PALETTE,
    width: 32,
    height: 24,
    minHoldTicks: 2,
    frames: [{ name: "f0", art: new Uint8Array(32 * 24).fill(1), type: 1 }],
  });

  /** arrived, and therefore answerable — the browser's own distinction */
  const arrived = new Map<string, Uint8Array>([["test.stg", stg]]);
  const onDisc = new Map<string, Uint8Array>([["i098.mov", film]]);
  const fetched: string[] = [];

  const session = new GameSession((name) => arrived.get(name.toLowerCase()) ?? null, new NullAudioSink());
  session.ensureFile = async (name) => {
    fetched.push(name);
    const bytes = onDisc.get(name.toLowerCase());
    if (bytes) arrived.set(name.toLowerCase(), bytes);
  };
  const dir = new ScreenDirector(session, { width: W, height: H });
  const logs: string[] = [];
  session.onLog = (l) => logs.push(l);
  dir.onLog = (l) => logs.push(l);
  await session.stageCtrl.openStageFile("test.stg");

  // the name the script builds, in the case the script builds it in
  void session.onPlayMovie?.("I098.Mov");
  // one turn of the microtask queue is all the fetch needs here
  await Promise.resolve();
  await Promise.resolve();

  expect(fetched, "it asked for the film before looking for it").toContain("i098.mov");
  expect(
    logs.filter((l) => /not available/.test(l)),
    `nothing went missing: ${logs.join(" | ")}`,
  ).toEqual([]);
  expect(dir.movies.playing, "and it is playing on the FIRST call").toBe(true);
});

/**
 * The cursor changes when the SCREEN's owner does, not only when the mouse moves.
 *
 * A shell hears about pointer movement and nothing else, and the cursor does not
 * depend on the pointer alone: `lockevents` freezing the world answers `watch`
 * whatever is under it. In the original that hourglass appears the instant the
 * lock goes up, because its idle loop calls `cursor("watch")` and `SetCursor`
 * every pass — the player waiting for a character to walk over to them has a
 * still hand, and a still hand used to mean a stale pointer here.
 *
 * Reported as a memory of the sand clock: "when for example a character is
 * approaching you".
 */
test("the cursor is re-asked when the screen's owner changes, not just on a move", async () => {
  const { session, dir } = newDirector();
  await session.stageCtrl.openStageFile("test.stg");
  const seen: string[] = [];
  dir.onCursor = (name) => seen.push(name);
  session.setPointer(10, 10);

  let now = 0;
  const frames = async (n: number) => {
    for (let i = 0; i < n; i++) {
      dir.tick((now += 50));
      await session.settle();
      // the re-ask is not tracked as a script dispatch (a cursor is cosmetic and
      // must never be something `settle` waits on), so yield the loop for it
      await new Promise((r) => setTimeout(r, 0));
    }
  };

  // the first pass establishes the gate and answers once for it
  await frames(2);
  const settled = seen.length;
  expect(settled, "one answer for the state it found").toBeGreaterThan(0);

  // nothing changes: no more asking, however long it runs
  await frames(10);
  expect(seen.length, "a still screen is not re-asked sixty times a second").toBe(settled);

  // the world freezes, and the pointer hears about it without moving
  session.interp.globals.set("lockevents", 1);
  await frames(2);
  expect(seen.at(-1), "the hourglass, with no mouse move at all").toBe("watch");

  // ...and it comes back off again
  session.interp.globals.set("lockevents", 0);
  await frames(2);
  expect(seen.at(-1), "and the world answers for itself again").not.toBe("watch");
});
