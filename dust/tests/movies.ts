/**
 * Dust's movies (DreamFactory 1) — the engine-true record layout, the sound and
 * chain fields, and the adapter that plays them through v4's machinery.
 *
 *   npx vitest run dust/tests/movies.ts
 *
 * The claims are the ones engine/src/df/mov-v1.ts's module comment makes; the layout
 * itself is DF.EXE's (records of 80 bytes at 0x8c2 — `lea esi, [frame*80 +
 * header + 0x8c2]`, 0x40484d), and each field is checked against the whole
 * shipped disc rather than one file:
 *
 *   1. Record +0x20 names the sound a frame STARTS and a type-2 hotspot's +0xa
 *      the sound a CLICK plays, both as bias-relative containers (negative = a
 *      chunk interleaved with the pictures). Every nonzero ref on the disc
 *      lands on an audio container — 0 misses is the whole verification.
 *   2. A chunk nothing references is the segment's BED; one that is referenced
 *      must NOT also play as a bed, which is what had ARMOPEN's door creak
 *      playing over its opening still.
 *   3. Advance is an authored GOTO: action 2 with a 0-based target, backward
 *      for a loop (BELL.MOV's idle), self/clamped for a hold.
 *   4. A type-3 exit chains to the movie named on ITS OWN record +0x30 with the
 *      abort flag set (0x4051d4) — the film ends, the named one plays, nothing
 *      returns. ARMOPEN.MOV runs straight into Diary.mov; its put-the-diary-
 *      back half is reachable only by clicking away mid-animation.
 *   5. Header +0x2e/+0x30 are the action frames as 1-BASED positions — what
 *      `actionframe(1)` reports (MAYBED.MOV's is 4, the frame its bed-click
 *      goto lands on; DIARY.MOV's is 1, whose goto-skipped frame 2 rules a
 *      0-based reading out).
 *   6. Indices 0 and 255 are TRANSPARENT in DF.EXE's blit (0x421b40: 0xff is
 *      folded into 0, masked monochrome, composited with SRCINVERT), so a wait
 *      frame authored as solid 0xff HOLDS the picture before it — the frames
 *      that rendered "completely white", and after half a fix completely black.
 *
 * Skipped, not failed, without the disc (the same bargain dust-saves.ts makes).
 */
import { test, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeAudioContainer,
  readAudioHeader,
} from "@dreamfactory/engine/df/audio";
import {
  compositeFrameV1,
  movFileFromV1,
  readMovFileV1,
} from "@dreamfactory/engine/df/mov-v1";
import {
  decodeFrame,
  FrameBuffer,
  paletteToRGBA,
} from "@dreamfactory/engine/df/image";
import {
  chooseFrameInterval,
  frameHoldMs,
  stepsForward,
} from "@dreamfactory/engine/df/mov-pace";

/*
 * Anchored to THIS FILE, not to the working directory, and not to the old layout.
 *
 * It was `<cwd>/gamefiles/dust/dustcd/MOVIES`, which is where the rip lived before
 * the monorepo split moved it to `dust/gamefiles/`. Nothing failed: `movies()`
 * returned an empty list, `skip()` decided there was no rip, and all nine tests
 * passed by not running. They reported green through the entire restructuring and
 * through a release in which every Dust film was frozen on its first frame.
 *
 * `import.meta.url` because a vitest run's cwd is the repo root and a package
 * script's is the package — the rip's location is a fact about the tree, so ask
 * the tree.
 */
const MOVIE_DIR = fileURLToPath(
  new URL("../gamefiles/dustcd/MOVIES", import.meta.url),
);

const movies = (): string[] =>
  existsSync(MOVIE_DIR)
    ? readdirSync(MOVIE_DIR)
        .filter((f) => /\.mov$/i.test(f))
        .sort()
    : [];

const read = (name: string) =>
  readMovFileV1(new Uint8Array(readFileSync(join(MOVIE_DIR, name))));

const skip = (): boolean => {
  if (movies().length) return false;
  console.warn(`no ${MOVIE_DIR} — skipping (needs the Dust rip)`);
  return true;
};

test("every sound a frame or a click references is an audio container", () => {
  if (skip()) return;
  let frameRefs = 0;
  let clickRefs = 0;
  for (const name of movies()) {
    const m = read(name);
    for (const sg of m.segments) {
      const audio = new Set(sg.audioChunks);
      // hotspot runs are SHARED suffixes (frames of one phase point into the
      // same table), so count each physical record once, by its offset
      const hotspotSeen = new Set<number>();
      const referenced = new Set<number>();
      for (const f of sg.frames) {
        if (f.sound) {
          frameRefs++;
          referenced.add(f.sound);
          expect
            .soft(audio.has(f.sound), `${name} frame @${f.record}: c${f.sound}`)
            .toBe(true);
        }
        for (const r of f.regions) {
          if (r.sound) referenced.add(r.sound);
          if (hotspotSeen.has(r.record)) continue;
          hotspotSeen.add(r.record);
          if (!r.sound) continue;
          clickRefs++;
          expect
            .soft(
              audio.has(r.sound),
              `${name} hotspot @${r.record}: c${r.sound}`,
            )
            .toBe(true);
        }
      }
      // ...and the bed is exactly what is left over
      expect
        .soft(sg.bed, `${name} seg@c${sg.bias}: bed`)
        .toEqual(sg.audioChunks.filter((c) => !referenced.has(c)));
    }
  }
  // the disc's own numbers, so a regression in the ref reader cannot pass as
  // "no refs found, nothing to check" — 213 frame refs (191 into the up-front
  // bank, 22 negatives at interleaved chunks) and 224 click refs (the old
  // 16-byte-only region reading saw 79 of these; the typed walk reads the
  // PAPERs' and the other odd tables too)
  expect(frameRefs).toBe(213);
  expect(clickRefs).toBe(224);
});

test("the frame table is the engine's: gotos advance, and nothing is unaccounted", () => {
  if (skip()) return;
  for (const name of movies()) {
    const m = read(name);
    expect.soft(m.unaccounted, `${name}: unaccounted pictures`).toBe(0);
    for (const sg of m.segments) {
      for (const f of sg.frames) {
        // 1/2/3 everywhere, plus the lone 5 the three BELL day-variants end on
        expect
          .soft(
            [1, 2, 3, 5].includes(f.action),
            `${name} @${f.record}: action ${f.action}`,
          )
          .toBe(true);
        if (f.action === 3)
          expect
            .soft(f.chainTo, `${name} @${f.record}: chain name`)
            .not.toBe("");
      }
    }
  }
});

test("ARMOPEN.MOV: one wait, a straight run into Diary.mov, no return", () => {
  if (skip()) return;
  const v1 = read("ARMOPEN.MOV");
  const sg = v1.segments[0];
  expect(sg.frames.length).toBe(37);
  // the only click-wait is the FIRST frame — the zoomed, closed armoire
  expect(
    sg.frames.map((f, i) => (f.waitsForClick ? i + 1 : 0)).filter(Boolean),
  ).toEqual([1]);
  // its two boxes tile the picture: the doors open it (goto 0-based 2 = frame 3,
  // where the creak fires), anywhere else leaves (frame 37, the exit)
  const f1 = sg.frames[0];
  expect(f1.regions.slice(0, 2).map((r) => r.target)).toEqual([2, 36]);
  // the three creaks: door opens at 3, diary goes back at 19, doors close at 30
  const fired = sg.frames
    .map((f, i) => (f.sound ? [i + 1, f.sound] : null))
    .filter(Boolean);
  expect(fired).toEqual([
    [3, 1],
    [19, 2],
    [30, 3],
  ]);
  // nothing left for a bed — the creak must not play before the door is clicked
  expect(sg.bed).toEqual([]);
  // frame 19 chains out to the diary close-up — the name is on ITS OWN record
  expect(sg.frames[18].action).toBe(3);
  expect(sg.frames[18].chainTo).toBe("Diary.mov");
  // ...and it holds for its creak first (wait flag bit 0)
  expect(sg.frames[18].waitsForVoice).toBe(true);
  // the put-back half is reached only by the click-away boxes during the
  // opening animation (goto 0-based 20 = frame 21)
  const away = sg.frames[3].regions.filter((r) => r.target === 20);
  expect(away.length).toBeGreaterThan(0);

  const mov = movFileFromV1(v1);
  // v4's own type 3 — exit + chain, NO call stack: Diary.mov ends and the
  // playmovie() sequence is over, which is what lets the script's diary flat
  // open without the wardrobe closing in between
  const f19 = mov.frames[18];
  expect(f19.type).toBe(3);
  expect(f19.event).toBe("Diary.mov");
  expect(f19.target).toBe("");
  expect(mov.segments[0].dfV1).toBe(true);
  // animation frames answer clicks without stopping for them
  expect(mov.frames[0].playsThroughRegions).toBe(false);
  expect(mov.frames[3].playsThroughRegions).toBe(true);
  expect(mov.frames[3].regions.length).toBeGreaterThan(0);
  // the fired sounds resolve through the segment's own sound map
  expect(mov.frames[2].sound).toBe("1");
  expect(mov.sounds.get("1")).toBe(1);
  expect(mov.audioChunks).toEqual([]);
});

test("BELL.MOV: three bells, three dings, a backward idle loop", () => {
  if (skip()) return;
  const v1 = read("BELL.MOV");
  const sg = v1.segments[0];
  // no frame fires a sound; each bell's box carries its own ding and its own
  // ring animation, and the fourth box (the whole picture) leaves
  expect(sg.frames.every((f) => f.sound === 0)).toBe(true);
  const spots = sg.frames[0].regions;
  expect(spots.map((r) => [r.sound, r.target])).toEqual([
    [1, 2],
    [2, 22],
    [3, 43],
    [0, 64],
  ]);
  // the idle is an authored backward goto: frame 21 plays back to frame 2
  expect(sg.frames[20].action).toBe(2);
  expect(sg.frames[20].target).toBe(1);
  expect(sg.bed).toEqual([]);
  const mov = movFileFromV1(v1);
  // 0-based targets become 1-based frame names for the player's case 2
  expect(mov.frames[20].type).toBe(2);
  expect(mov.frames[20].target).toBe("2");
  const withSound = mov.frames[0].regions.filter((r) => r.sound);
  expect(withSound.map((r) => [r.sound, r.target])).toEqual([
    ["1", "3"],
    ["2", "23"],
    ["3", "44"],
  ]);
});

test("action frames are 1-based positions in the header", () => {
  if (skip()) return;
  // MAYBED's is frame 4 — where its bed-click goto lands, what advanceday runs
  // on; DIARY's is frame 1 — having SEEN the diary is what MAYROOM.SET asks
  // about, true the moment the chain reaches the film (its goto skips frame 2,
  // which is what rules a 0-based reading out);
  // ARMOPEN itself has none, so the flag can only come from the chained film
  expect(read("MAYBED.MOV").segments[0].actionFrame1).toBe(4);
  expect(read("DIARY.MOV").segments[0].actionFrame1).toBe(1);
  expect(read("ARMOPEN.MOV").segments[0].actionFrame1).toBe(-1);
  // ...and through the adapter they are frame NAMES, which v1 frames carry as
  // their own 1-based position
  const mov = movFileFromV1(read("MAYBED.MOV"));
  expect(mov.actionFrame1).toBe("4");
  expect(mov.frames[3].name).toBe("4");
  // ...which is exactly where its bed-click hotspot goes (goto 0-based 3)
  expect(mov.frames[0].regions[0].target).toBe("4");
  expect(movFileFromV1(read("DIARY.MOV")).actionFrame1).toBe("1");
});

test("a movie chains by name on its way out", () => {
  if (skip()) return;
  // the linear chains: intro2 -> intro3, towerup -> towertop -> towerdn,
  // and all four endings -> finalend; plus the armoire's diary
  const chains = new Map<string, string>();
  for (const name of movies()) {
    for (const sg of read(name).segments) {
      for (const f of sg.frames)
        if (f.chainTo) chains.set(name, f.chainTo.toLowerCase());
    }
  }
  expect(chains.get("INTRO2.MOV")).toBe("intro3.mov");
  expect(chains.get("TOWERUP.MOV")).toBe("towertop.mov");
  expect(chains.get("MARIEEND.MOV")).toBe("finalend.mov");
  expect(chains.get("ARMOPEN.MOV")).toBe("diary.mov");
  expect(chains.size).toBe(8);
});

test("FINALEND.MOV: unreferenced chunks are the bed — the credits music plays", () => {
  if (skip()) return;
  const v1 = read("FINALEND.MOV");
  const sg = v1.segments[0];
  expect(sg.frames.every((f) => f.sound === 0)).toBe(true);
  expect(sg.bed).toEqual([1, 2, 3, 4]);
  expect(movFileFromV1(v1).audioChunks).toEqual([1, 2, 3, 4]);
});

test("index 255 is transparent: a wait frame HOLDS the picture before it", () => {
  if (skip()) return;
  // ARMOPEN frames 17 and 20 decode as SOLID index 255 — the frames that
  // showed "completely white", then (one wrong fix later) completely black.
  // DF.EXE's blit keys palette-index-0 pixels out through a monochrome mask and
  // a 0x660046 SRCINVERT composite, with 0xff folded into the key — so such a
  // frame leaves the previous picture on screen. compositeFrameV1 is that
  // blit's answer, and the decode buffer stays raw exactly as the original's
  // does (its save/restore of the 0xff bytes around the blit is FOR the delta
  // chain).
  const v1 = read("ARMOPEN.MOV");
  const fb = new FrameBuffer();
  const shown: Uint8Array[] = [];
  let solid = 0;
  for (const f of v1.segments[0].frames) {
    const d = decodeFrame(v1.file.containers[f.picture].data, fb);
    const px = fb.pixels.slice(0, d.width * d.height);
    if (px.every((p) => p === 255)) solid++;
    compositeFrameV1(px, shown.length ? shown[shown.length - 1] : null);
    shown.push(px);
  }
  expect(solid).toBe(2);
  // composited, the held frame IS the frame before it
  expect(shown[16]).toEqual(shown[15]);
  expect(shown[19]).toEqual(shown[18]);
  expect(shown[16].every((p) => p === 255)).toBe(false);
  // ...and the first frame keeps its raw indices, which the adapter no longer
  // second-guesses. It used to paint entry 255 as entry 0 here, on the reading
  // that a keyframe's 0xff has nothing under it and so should come out as the
  // background. It comes out as a COLOUR — see the keyframe test below, where
  // that alias turned INTRO3's sun into a black hole in a purple sky. The
  // palette goes through untouched and paletteToRGBA's reserve decides 255.
  const mov = movFileFromV1(v1);
  expect(Array.from(mov.paletteRaw.subarray(255 * 8, 255 * 8 + 8))).toEqual(
    Array.from(v1.paletteRaw.subarray(255 * 8, 255 * 8 + 8)),
  );
  const rgba = paletteToRGBA(mov.paletteRaw, 256);
  expect([rgba[255 * 4], rgba[255 * 4 + 1], rgba[255 * 4 + 2]]).toEqual([
    255, 255, 255,
  ]);
});

test("segment audio banks decode and the up-front count matches the header", () => {
  if (skip()) return;
  // header +0x1a counts the chunks that sit right after the header; every one
  // must decode as audio (the range positive sound refs point into)
  for (const name of movies()) {
    const m = read(name);
    for (const sg of m.segments) {
      const c0 = m.file.containers[sg.bias].data;
      const bank = new DataView(
        c0.buffer,
        c0.byteOffset,
        c0.byteLength,
      ).getInt16(0x1a, true);
      for (let k = 1; k <= bank; k++) {
        const c = m.file.containers[sg.bias + k];
        expect
          .soft(
            c && !c.gap && !!readAudioHeader(c.data),
            `${name} c${sg.bias + k}`,
          )
          .toBe(true);
      }
    }
  }
});

/**
 * Every film on the disc paces itself, because a DF1 straight run is a goto.
 *
 * `chooseFrameInterval` returns 0 for "click-through close-up: do not advance on
 * the clock", and it decided that for 57 of Dust's 160 films — every one without
 * click regions, the intro among them. It was asking for a type-6 frame,
 * DreamFactory 4's "advance one frame", and **DreamFactory 1 does not have that
 * action**: it writes a straight run as a type-2 goto to the next frame. There is
 * not one type-6 frame in any of the 160.
 *
 * What that looked like: the film held frame 0 for ever while its soundtrack —
 * started separately, paced by nothing — played to the end. Audible, motionless,
 * no error. The decoder was never at fault; 16 consecutive intro frames decode to
 * 16 distinct pictures, which is asserted elsewhere in this file.
 */
test("every Dust film self-paces: a v1 straight run is a forward goto", () => {
  if (skip()) return;
  const names = movies();
  expect(names.length).toBeGreaterThan(100);

  let type67 = 0;
  const dead: string[] = [];
  for (const name of names) {
    const mov = movFileFromV1(read(name));
    for (const [i, seg] of mov.segments.entries()) {
      if (seg.frames.some((f) => f.type === 6 || f.type === 7)) type67++;
      const hasRegions = seg.frames.some((f) => f.regions.length > 0);
      // the arguments the player passes (movie-player.ts): a v1 bed never paces
      const interval = chooseFrameInterval(
        seg,
        seg.frames.length,
        hasRegions || !seg.audioLoops ? 0 : 1,
        hasRegions,
      );
      if (interval === 0) dead.push(`${name} segment ${i}`);
    }
  }

  // the premise: DF1 genuinely has no "advance one frame" anywhere on the disc,
  // so a test for type 6/7 alone can only ever have been vacuous here
  expect(type67).toBe(0);
  expect(
    dead,
    `films frozen on frame 0: ${dead.slice(0, 8).join(", ")}`,
  ).toEqual([]);
});

test("the intro runs at its own authored rate, not one we invented", () => {
  if (skip()) return;
  const mov = movFileFromV1(read("INTRO.MOV"));
  const seg = mov.segments[0];

  expect(stepsForward(seg)).toBe(true);
  // named "1".."136", each handing on to its successor: 135 forward, none back
  expect(seg.frames.length).toBe(136);
  expect(
    seg.frames.filter((f, i) => f.type === 2 && Number(f.target) - 1 > i)
      .length,
  ).toBe(135);

  // And the hold is the FILM's own, not a rate derived from its audio:
  // max(this frame's holdTicks, the movie's floor) x one tick. Frame 0 of the
  // intro holds 20 ticks against a floor of 2, so the FRAME wins here — which is
  // the half of that max a test asserting only the floor would never see.
  const TICK = 50 / 3;
  expect(frameHoldMs(seg, 0)).toBeCloseTo(
    Math.max(seg.frames[0].holdTicks, seg.minHoldTicks) * TICK,
    5,
  );
  expect(seg.frames[0].holdTicks).toBeGreaterThan(seg.minHoldTicks);
  expect(frameHoldMs(seg, 0)).toBeGreaterThan(0);
});

test("stepsForward refuses to touch a DreamFactory 4 film", () => {
  // The guard that keeps Titanic's pacing exactly as it was: a type-2 goto in a
  // DF4 close-up is a toggle waiting on a click, and reading it as a step would
  // make click-through movies run themselves. Asserted on a hand-built segment so
  // it holds with no rip of either game present.
  const frame = (name: string, type: number, target: string) => ({
    type,
    height: 0,
    width: 0,
    locationFrame: 0,
    name,
    sound: "",
    event: "",
    target,
    regions: [],
    holdTicks: 0,
    waitsForVoice: false,
    holdsDeadline: false,
    playsThroughRegions: false,
  });
  const frames = [frame("1", 2, "2"), frame("2", 2, "3"), frame("3", 1, "")];
  const base = {
    frames,
    cues: [],
    audioChunks: [],
    bed: [],
    sounds: new Map<string, number>(),
    paletteRaw: new Uint8Array(0),
    minHoldTicks: 3,
    audioLoops: false,
    bias: 0,
  } as unknown as Parameters<typeof stepsForward>[0];

  expect(stepsForward({ ...base, dfV1: true })).toBe(true);
  expect(stepsForward({ ...base, dfV1: false })).toBe(false);
  // absent, not merely false: every DF4 segment this port has ever read
  expect(stepsForward(base)).toBe(false);
});

/**
 * On a segment's FIRST frame, 0xff is white — it is a colour, not transparency.
 *
 * `movFileFromV1` used to alias palette entry 255 onto entry 0 on the grounds that
 * DF.EXE folds 0xff into 0 and that 0xff is transparent anyway. Transparency is
 * real and handled at decode by `compositeFrameV1`, which is what lets a DELTA
 * frame hold the picture before it. A KEYFRAME has nothing to hold, so there the
 * index is just a colour, and the alias painted it black.
 *
 * Six segments on the disc carry enough index-255 on their first frame to see it:
 * INTRO3's sun, DOCTCHES's and DOCTBONE's anatomy charts, and PAPER1-3. Asserted
 * on the two extremes rather than all six, and on the pixels rather than on the
 * palette alone, because the palette is pinned twice on the way to the screen
 * (`paletteToRGBA`'s reserve, and once upon a time this alias after it) and only
 * the pixels say which pinning won.
 */
/**
 * How long a v1 film runs, played the way the movie loop plays it: each frame
 * held for its own `max(hold, floor)`, and a frame that says so held longer
 * still — until the sound it started has finished.
 *
 * The same `max` the player applies, and deliberately not a sum: the wait is a
 * floor under the hold, not time added after it (DF.EXE reaches the hold
 * deadline and the sound spin one after the other, so whichever is later wins).
 */
const runtimeMs = (mov: ReturnType<typeof movFileFromV1>, segIdx = 0): number => {
  const seg = mov.segments[segIdx];
  const raw = mov.file.containers;
  let now = 0;
  let soundEnds = 0;
  seg.frames.forEach((f, i) => {
    if (f.sound) {
      const loc = seg.sounds.get(f.sound.toLowerCase());
      const pcm = loc === undefined ? null : decodeAudioContainer(raw[loc].data);
      if (pcm) soundEnds = now + (pcm.samples.length / pcm.sampleRate) * 1000;
    }
    now += frameHoldMs(seg, i);
    if (f.waitsForVoice) now = Math.max(now, soundEnds);
  });
  return now;
};

test("DOG1.MOV: the dog growls twice, because the film waits for each growl", () => {
  if (skip()) return;
  const v1 = read("DOG1.MOV");
  const mov = movFileFromV1(v1);
  const seg = mov.segments[0];
  const raw = v1.segments[0];

  // six frames, one growl chunk, and the growl fired TWICE — once per snarl
  expect(seg.frames.length).toBe(6);
  expect(raw.audioChunks.length).toBe(1);
  expect(seg.frames.map((f) => f.sound)).toEqual(["", "1", "", "1", "", ""]);
  const growl = decodeAudioContainer(mov.file.containers[1].data);
  const growlMs = (growl.samples.length / growl.sampleRate) * 1000;
  expect(growlMs).toBeGreaterThan(800);

  // The two firings are 100 ms apart on the film's own frame holds — two copies
  // of one 0.88 s growl that close together is ONE growl, which is what was
  // reported. What separates them is +0x1a bit 0 on the frame AFTER each
  // firing: hold until the sound is done.
  expect(raw.frames.map((f) => f.holdsForSound)).toEqual([
    false,
    false,
    true,
    false,
    true,
    false,
  ]);
  // and it arrives in the player as v4's own name for the same sentence
  expect(seg.frames[2].waitsForVoice).toBe(true);
  expect(seg.frames[4].waitsForVoice).toBe(true);

  // frames 1 and 3 are 100 ms apart on holds alone; the wait pushes the second
  // growl past the end of the first
  const holdsOnly = raw.frames.reduce(
    (a, _, i) => a + frameHoldMs(seg, i),
    0,
  );
  expect(holdsOnly).toBeLessThan(1_100);
  expect(runtimeMs(mov)).toBeGreaterThan(holdsOnly + growlMs);
  expect(runtimeMs(mov)).toBeGreaterThan(2_300);
});

test("+0x1a bit 0 is what times 50 of the disc's films, the four endings among them", () => {
  if (skip()) return;

  // The flag is real and it is rare: 152 frames of 6717, and never bit 4 —
  // the step-advance the earlier reading named is not on this disc at all.
  //
  // The spread is counted too, because it is the figure the module comment and
  // the format notes quote and the one nothing else would catch drifting: 69
  // segments of 185, across 50 films of 160.
  let carrying = 0;
  let stepping = 0;
  let frames = 0;
  let segments = 0;
  let segmentsWaiting = 0;
  let films = 0;
  let filmsWaiting = 0;
  for (const name of movies()) {
    films++;
    let anyInFilm = false;
    for (const seg of read(name).segments) {
      segments++;
      let anyInSegment = false;
      for (const f of seg.frames) {
        frames++;
        if (f.holdsForSound) {
          carrying++;
          anyInSegment = true;
          anyInFilm = true;
        }
        if (f.flags2 & 0x10) stepping++;
      }
      if (anyInSegment) segmentsWaiting++;
    }
    if (anyInFilm) filmsWaiting++;
  }
  expect(frames).toBe(6717);
  expect(carrying).toBe(152);
  expect(stepping).toBe(0);
  expect([films, filmsWaiting]).toEqual([160, 50]);
  expect([segments, segmentsWaiting]).toEqual([185, 69]);

  // every one of them reaches the player as a frame that holds for its sound
  for (const name of movies()) {
    const v1 = read(name);
    const mov = movFileFromV1(v1);
    v1.segments.forEach((raw, i) =>
      raw.frames.forEach((f, k) => {
        if (f.holdsForSound)
          expect(mov.segments[i].frames[k].waitsForVoice).toBe(true);
      }),
    );
  }

  // MAYOREND.MOV is the film it matters most to: the mayor's last speech is
  // fired frame by frame and the picture is four times shorter than it. Without
  // the wait the film ended at 15 s and the teardown cut the rest.
  const mayor = movFileFromV1(read("MAYOREND.MOV"));
  expect(runtimeMs(mayor)).toBeGreaterThan(55_000);
});

test("a v1 keyframe's 0xff renders white, not black", () => {
  if (skip()) return;

  for (const [name, atLeast] of [
    ["INTRO3.MOV", 0.05],
    ["DOCTCHES.MOV", 0.05],
  ] as const) {
    const mov = movFileFromV1(read(name));
    const seg = mov.segments[0];
    const rgba = paletteToRGBA(seg.paletteRaw, 256);

    // the reserve: 0 black and 255 white, whatever the film's own table says —
    // every one of these six ships a raw entry 255 of 0,0,0
    expect
      .soft([rgba[255 * 4], rgba[255 * 4 + 1], rgba[255 * 4 + 2]])
      .toEqual([255, 255, 255]);
    expect.soft([rgba[0], rgba[1], rgba[2]]).toEqual([0, 0, 0]);

    const fb = new FrameBuffer();
    const f = seg.frames[0];
    const decoded = decodeFrame(mov.file.containers[f.locationFrame].data, fb);
    const pixels = decoded.width * decoded.height;
    let indexed255 = 0;
    let white = 0;
    for (let i = 0; i < pixels; i++) {
      if (fb.pixels[i] !== 255) continue;
      indexed255++;
      const c = fb.pixels[i] * 4;
      if (rgba[c] > 250 && rgba[c + 1] > 250 && rgba[c + 2] > 250) white++;
    }
    expect
      .soft(indexed255 / pixels, `${name}: index-255 coverage on frame 0`)
      .toBeGreaterThan(atLeast);
    // every one of them, not most: a partial fix is what made this black
    expect
      .soft(white, `${name}: index-255 pixels rendering white`)
      .toBe(indexed255);
  }
});
