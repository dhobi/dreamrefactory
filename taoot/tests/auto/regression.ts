/**
 * Regression suite — runs headless against the original game files.
 *
 *   npx vitest run taoot/tests/auto/regression.ts
 *   TAOOT_GAMEFILES=/path/to/gamefiles npx vitest run   # override data dir
 */
import { test, expect } from "vitest";
import { gamefiles, gamefilesRoot } from "../../tools/gamefiles";
import { readSetFile, readStarPath, RIGHTTURNS, LEFTTURNS } from "@dreamfactory/engine/df/set";
import { ENGINE_STEP_MS, RAMP_STEP_MS } from "@dreamfactory/engine/runtime/clock";
import { readShpFile } from "@dreamfactory/engine/df/shp";
import { frameIndexForDegree, isDegreeSelector } from "@dreamfactory/engine/runtime/props";
import { FrameBuffer, decodeFrame, paletteToRGBA } from "@dreamfactory/engine/df/image";
import {
  ALL_CHANNELS,
  DEFAULT_SCREEN_GAMMA,
  SCREEN_GAMMA_STEP,
  type GammaChannels,
  displayPalette,
  resetScreenGamma,
  screenGamma,
  screenGammaGeneration,
  screenGammas,
  setScreenGamma,
  stepScreenGamma,
} from "@dreamfactory/engine/web/screen-gamma";
import { readStgFile, readStgRegions } from "@dreamfactory/engine/df/stg";
import { MAP_EXIT_REGION, MAP_JUMPS, MAP_PAGE_BUTTONS, mapUsable } from "../playthrough/nav/mapjumps";
import { readMovFile } from "@dreamfactory/engine/df/mov";
import { readPupFile, type PupAnimFrame, type PupDialogue } from "@dreamfactory/engine/df/pup";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { subtitled } from "@dreamfactory/engine/runtime/puppet";
import type { CallExpr } from "@dreamfactory/engine/runtime/ast";
import { sniffScript, scriptToText } from "@dreamfactory/engine/df/script";
import { parseScript } from "@dreamfactory/engine/runtime/parser";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { EventQueue, EVENT_CAPACITY } from "@dreamfactory/engine/runtime/input";
import { PUPPET_ART_H } from "@dreamfactory/engine/web/puppet-view";
import { SCREEN_W } from "@dreamfactory/engine/web/screen";
import { ScriptInstance, type Value } from "@dreamfactory/engine/runtime/interp";
import { DeferredAudioSink, NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { projectPoint } from "@dreamfactory/engine/runtime/props";
import { SetViewer } from "@dreamfactory/engine/web/viewer";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadGame } from "@dreamfactory/engine/runtime/saveload";
import { newHost, root } from "../harness";
import { readBootPlan } from "@dreamfactory/engine/runtime/bootplan";
import { EXTRA_EDITIONS } from "../../src/languages";

/** the demo's tree, named where the six languages are not — see EXTRA_EDITIONS */
const DEMO_EDITION = EXTRA_EDITIONS[0].code;

// module-level view for the handful of tests that read a file directly
const provider = gamefiles(root).provider;

// A thin shim over Vitest's soft assertions: every check in a scenario runs
// (soft = doesn't abort the test on first failure), and the rich `detail`
// readout is carried in the assertion message, so it surfaces in full on any
// failure — which is where the per-check engine-state diagnostics matter.
function check(name: string, ok: boolean, detail = ""): void {
  expect.soft(ok, `${name}${detail ? ` — ${detail}` : ""}`).toBe(true);
}

/** most tests only want the session + a viewer */
async function newSession(): Promise<{
  session: GameSession;
  sink: NullAudioSink;
  viewer: () => SetViewer;
}> {
  return newHost();
}

/**
 * Stand an actor where the camera can SEE them: `dist` units dead ahead of the
 * active camera, at eye height, visible and at a drawable scale.
 *
 * Three scenarios below need a character the accost machinery will look at, and
 * since #180 that takes more than a short distance: `actordist` answers the
 * 32000 not-present sentinel unless the actor's sprite actually lands on the
 * screen. Placing them by hand near the LISTENER — which is a ground position,
 * with no facing and no height — was enough while distance was the whole test
 * and is not enough now, so the placement lives here once and is asserted.
 */
function standInView(session: GameSession, who: string, dist = 300): boolean {
  const a = session.actorRuntime.get(who);
  const cam = session.activeCamera();
  if (!a || !cam) return false;
  const rad = ((cam.deg & 0xff) / 256) * 2 * Math.PI;
  a.visible = true;
  if (a.scale <= 0) a.scale = 1000;
  a.worldX = cam.x + Math.round(Math.cos(rad) * dist);
  a.worldY = cam.y + Math.round(Math.sin(rad) * dist);
  a.worldZ = cam.z;
  return session.actorRuntime.onScreen(a, cam);
}

// one monotonic virtual clock for the whole suite (sessions each track their
// own offsets; time must never run backwards for delay()/loop service)
let clock = 0;

// --- 0a. the host's set activation: what every entry point runs through -----
// These four checks were unreachable while activation lived in main.ts (the
// suite hand-rolled a 7-line onSetChange instead), and each of them is a defect
// that shipped: the theme fallback blipping the wrong bank ahead of setupsound,
// the previous room's scheduled work surviving an unscripted swap, and the
// boot's session resources being re-established on every set change.
test("host: set activation — theme, scheduler, and boot resources", async () => {
  let stageShown = 0;
  const { host, session, sink, viewer } = await newHost({ onShowStage: () => stageShown++ });

  // 1. the room's own theme, and no fallback blip before it. bedsit1's openset
  // -> setupsound plays bedrad1.trk (the flat's radio); the set-named bank
  // bedsit1.trk is the BOMB scene's music and must never be heard here.
  await host.loadServerSet("bedsit1.set");
  const themes = sink.calls.filter((c) => c.channel === "theme");
  check(
    "the flat comes up on its radio, with nothing played before it",
    themes.length === 1 && themes[0].seconds > 60 && session.currentThemeName === "bedrad1.trk",
    `themes=${JSON.stringify(themes)} current=${session.currentThemeName}`,
  );

  // 2. the flat arms a scene loop (the woman in the window) and a sound loop
  const armed = session.scheduler.loops.length > 0 || session.scheduler.loopFlags.size > 0;
  check("the flat arms its scheduled work", armed,
    `loops=${session.scheduler.loops.length} soundLoops=${[...session.scheduler.loopFlags]}`);

  // 3. an UNSCRIPTED swap (the set picker, a dev jump) has no closeset to stop
  // it, so activation must — else the flat's loop keeps firing at a scene that
  // no longer exists, inside the next set
  await host.loadServerSet("turk.set");
  check(
    "a bare swap leaves nothing of the old room running",
    session.scheduler.loops.length === 0 && session.scheduler.loopFlags.size === 0,
    `loops=${JSON.stringify(session.scheduler.loops)} soundLoops=${[...session.scheduler.loopFlags]}`,
  );

  // 4. ...while the boot's session-scoped resources survive it. house.shp's
  // openshop laid the bag out on the C73 bed; re-running it on a later
  // activation puts the prop back in the interface band and the bed is bare.
  await host.loadServerSet("c73.set");
  const bag = session.propRuntime.get("bag");
  check(
    "the bag is still a world prop after three activations",
    !!bag?.worldSpace && !!bag?.visible,
    `vis=${bag?.visible} ws=${bag?.worldSpace}`,
  );
  check("and a viewer is up for the last set", viewer().set.setName.toLowerCase() === "c73");

  // 5. showStage fires on EVERY activation, not once per game — so nothing that
  // belongs to a game may be reset by it. main.ts used to clear the details pane
  // there, which threw the script log away and shut the pane the player had
  // opened at every changeset (#22, "resets on every set change"): 28 rooms over
  // a full playthrough. The page now resets on the boot instead, and this is the
  // number that says why it had to.
  check(
    "the stage is shown once per set activation",
    stageShown === 3,
    `three sets activated, showStage fired ${stageShown}x`,
  );
}
);

// --- 0a2. leaving a set gives its resources back ---------------------------
// The engine's changeset closes the departing set (closesetfile), which fires
// the scripts' teardown but frees nothing: the host held the bytes (DECKBD.SET
// alone is 32 MB) and the parsed set for the rest of the session, so the file
// cache only ever grew. What must NOT be released with it: the boot's
// session-scoped resources, and the deck theme banks the scripts own.
test("host: leaving a set gives its resources back, keeping the boot's", async () => {
  const evicted: string[] = [];
  const { host, session } = await newHost({ onEvict: (n) => evicted.push(n) });
  await host.loadServerSet("bedsit1.set");
  check("the flat is resident", host.loadedSets.has("bedsit1.set"));
  const bootBanks = () => session.audioLib.bankNames.filter((b) => b === "unilib.trk" || b === "inven.trk");
  check("boot audio banks are open", bootBanks().length === 2, session.audioLib.bankNames.join(","));

  await host.loadServerSet("c73.set");
  check(
    "the flat's set file and parse are handed back",
    !host.loadedSets.has("bedsit1.set") && evicted.includes("bedsit1.set"),
    `loaded=${[...host.loadedSets.keys()]} evicted=${evicted}`,
  );
  check(
    "...but nothing session-scoped is",
    bootBanks().length === 2 && !evicted.some((e) => e.startsWith("house") || e.startsWith("inven") ||
      e.startsWith("gang") || e === "bootfile"),
    `banks=${session.audioLib.bankNames.join(",")} evicted=${evicted}`,
  );
  check("the theme bank stays for the scripts to close", !evicted.includes("bedsit1.trk"), `${evicted}`);
  check("and the arriving room is up", session.currentSetName === "c73" && host.loadedSets.has("c73.set"));
}
);

// --- 0a3. what the viewer draws while you move around ----------------------
// The oracle for frame decoding. A set's frames are DELTA-encoded in chains,
// and the viewer decodes every one of them at set-open (predecodeAll) — which
// is why a big room costs hundreds of MB. Decoding lazily instead is only safe
// if a frame decoded later still comes out identical, so this pins the
// contract independently of how the decoding is scheduled: walk the set the way
// predecodeAll does to get a reference image for every frame, then navigate and
// require that every frame the viewer actually draws is byte-identical to one
// of them — and that each standpoint shows the exact frame that view names.
// RECEPT1C is chosen for having chains that are NOT ring-local (4 of its 40
// rings continue from the previous ring), the case a lazy decoder gets wrong.
test("viewer: moving around draws exactly the frames a full decode produces", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("recept1c.set");
  const v = viewer();

  const hash = (px: Uint8Array, n: number): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < n; i++) h = Math.imul(h ^ px[i], 0x01000193) >>> 0;
    return `${n}:${h.toString(16)}`;
  };
  // Reference. Turn rings: one continuous decode in the set's own order. Roads:
  // primed from the standpoint they depart, because that is what a walk is a
  // delta against — decoding them in file order leaves another frame's residue
  // in whatever the walk doesn't repaint (the shipped sky artifact).
  const ref = new Map<number, string>();
  {
    const fb = new FrameBuffer();
    const snap = (fi: { frameContainerLoc: number }): void => {
      if (!fi.frameContainerLoc) return;
      const d = decodeFrame(v.set.file.containers[fi.frameContainerLoc].data, fb);
      if (!ref.has(fi.frameContainerLoc)) ref.set(fi.frameContainerLoc, hash(fb.pixels, d.width * d.height));
    };
    for (const scene of v.set.scenes) {
      for (const dir of [0, 1]) for (const fi of scene.turns[dir].frames) snap(fi);
    }
    for (const road of v.set.transitions) {
      road.frameRegisters.forEach((reg, i) => {
        const departing = i === 0 ? road.viewIDstart : road.viewIDend;
        const rfb = new FrameBuffer();
        for (const scene of v.set.scenes) {
          const local = scene.views.findIndex((vw) => vw.viewID === departing);
          if (local < 0) continue;
          for (const fi of scene.turns[0].frames) {
            if (fi.frameContainerLoc) decodeFrame(v.set.file.containers[fi.frameContainerLoc].data, rfb);
            if (fi.viewID === local && fi.motionInfo > 0) break;
          }
          break;
        }
        for (const fi of reg.frames) {
          if (!fi.frameContainerLoc) continue;
          const d = decodeFrame(v.set.file.containers[fi.frameContainerLoc].data, rfb);
          if (!ref.has(fi.frameContainerLoc)) {
            ref.set(fi.frameContainerLoc, hash(rfb.pixels, d.width * d.height));
          }
        }
      });
    }
  }
  const known = new Set(ref.values());
  check("the reference decoded the whole set", ref.size > 200, `${ref.size} frames`);

  // Sweep the WHOLE set, not a lucky route: stand at every view of every
  // scene, turn the full ring in both directions, and walk every road that
  // offers itself. A lazy decoder is only wrong on the chains it gets to
  // rebuild, so the test has to make it rebuild all of them.
  const drawn: string[] = [];
  const step = (): void => {
    const f = v.tick((clock += 100));
    if (f) drawn.push(hash(f.pixels, f.width * f.height));
  };
  const runAnim = (): void => {
    for (let i = 0; i < 500 && v.busy; i++) step();
  };
  /**
   * The frame the CURRENT view is supposed to show, straight from the set: the
   * HI-RES standpoint (#68). The right-turn ring's standpoints are motionInfo 1
   * and the left-turn ring's are 2, paired by framePairID, and a settled view is
   * drawn from the hi-res one — so this looks the twin up the same way the viewer
   * does, and falls back to the low-res frame for a scene that has no twin.
   */
  const expectedStand = (): string | undefined => {
    const lo = v.scene.turns[0].frames.find((f) => f.viewID === v.viewIdx && f.motionInfo > 0);
    if (!lo) return undefined;
    const hi = v.scene.turns[1]?.frames.find(
      (f) => f.motionInfo === 2 && f.framePairID === lo.framePairID,
    );
    return ref.get((hi ?? lo).frameContainerLoc);
  };
  const standOk: boolean[] = [];
  let walks = 0;
  for (const scene of v.set.scenes) {
    if (!v.jumpTo(scene.sceneName)) continue;
    step();
    standOk.push(drawn[drawn.length - 1] === expectedStand());
    for (const dir of [0, 1]) {
      for (let i = 0; i < scene.views.length; i++) {
        v.turn(dir);
        runAnim();
        step();
        standOk.push(drawn[drawn.length - 1] === expectedStand());
      }
    }
    if (v.availableRoads().length && walks < 6) {
      walks++;
      v.walk();
      runAnim();
      step();
      standOk.push(drawn[drawn.length - 1] === expectedStand());
    }
  }

  check(
    "the sweep turned every ring and walked roads",
    drawn.length > 300 && standOk.length > 40 && walks > 0,
    `${drawn.length} frames drawn, ${standOk.length} standpoints, ${walks} walks`,
  );
  const strangers = drawn.filter((h) => !known.has(h)).length;
  check(
    "every frame drawn is one the full decode produced, byte for byte",
    strangers === 0,
    `${strangers} of ${drawn.length} frames differ from the reference`,
  );
  check(
    "every standpoint shows the frame its view names",
    standOk.every(Boolean),
    `stand checks: ${standOk.map((b) => (b ? "ok" : "WRONG")).join(",")}`,
  );
}
);

// --- 0a4. every frame chain stands on its own ------------------------------
// A ring's first frame repaints every pixel, so a ring can be decoded from any
// buffer state and comes out the same. That is what makes the lazy per-ring
// decode safe: no ordering, no priming, no route dependence.
//
// It is also a codec canary. While run-mode-7 back-references memmoved instead
// of tiling, 38 rings across the largest sets "needed" a predecessor and roads
// "needed" the standpoint they departed — the corruption made rings look
// history-dependent. Anything that reintroduces that will fail here first.
test("frames: a ring decodes the same from any buffer state", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("deckbd.set", "scene44", "view212");
  const v = viewer();
  const set = v.set;
  const rings: (typeof set.scenes)[0]["turns"][0]["frames"][] = [];
  for (const sc of set.scenes) for (const dir of [0, 1]) rings.push(sc.turns[dir].frames);
  for (const road of set.transitions) for (const reg of road.frameRegisters) rings.push(reg.frames);

  const hashRing = (frames: (typeof rings)[0], fb: FrameBuffer): string => {
    let h = 2166136261 >>> 0;
    for (const fi of frames) {
      if (!fi.frameContainerLoc) continue;
      const d = decodeFrame(set.file.containers[fi.frameContainerLoc].data, fb);
      for (let i = 0; i < d.width * d.height; i++) h = Math.imul(h ^ fb.pixels[i], 16777619) >>> 0;
    }
    return (h >>> 0).toString(16);
  };

  let differ = 0;
  for (const frames of rings) {
    const clean = new FrameBuffer();
    // poisoned: every earlier ring replayed, then the buffer scribbled on — if
    // any frame reads what was there before, these cannot match
    const dirty = new FrameBuffer();
    dirty.ensure(set.viewPortWidth || 512, set.viewPortHeight || 264);
    dirty.pixels.fill(0x5a);
    if (hashRing(frames, clean) !== hashRing(frames, dirty)) differ++;
  }
  check(
    "no ring in DECKBD depends on what was decoded before it",
    differ === 0,
    `${differ} of ${rings.length} rings decode differently from a poisoned buffer`,
  );
});

// --- 0a2. the codec's back-references tile ---------------------------------
// Run mode 7 copies `count` bytes from `off` bytes back. When off < count the
// source overlaps what the run is writing, and the original repeats the
// pattern (LZ77 / `rep movsb`). A memmove — which is what Array.copyWithin is —
// duplicates the block once instead, and since every later frame is a delta on
// this one, four such runs in a DECKBD walk were enough to streak the whole
// sky. See the walk test below for the symptom.
test("image codec: a back-reference shorter than its run repeats, it doesn't memmove", () => {
  // 1 row, 8 px: two literals, then a 6-px run copying from 2 bytes back
  const frame = new Uint8Array([
    1, 0, 8, 0, // height 1, width 8
    5 << 2, // row mode 5 (sets the lookback, no row copy)
    (2 << 3) | 5, 7, 9, // run mode 5: literals 7, 9
    (6 << 3) | 7, 2, 0, // run mode 7: 6 px from 2 bytes back
  ]);
  const fb = new FrameBuffer();
  const d = decodeFrame(frame, fb);
  const got = [...fb.pixels.slice(0, d.width * d.height)];
  check(
    "the two-pixel pattern tiles across the run",
    got.join(",") === "7,9,7,9,7,9,7,9",
    `got ${got.join(",")} (a memmove copy gives 7,9,7,9,0,0,0,0)`,
  );
});

// --- 0a3. the symptom, on the deck the player reported it on ----------------
// Walking aft along the boat deck (Scene44/View212, Road281) leaves the second
// funnel behind, so by the end of the walk the top of the frame is empty night
// sky. With the memmove copy above, the funnel's glow tiled back into it as
// bright horizontal dashes that grew frame by frame — "orange artifacts in the
// sky", visible only during the walk animation.
test("walking the boat deck aft: the sky the player walks away from stays dark", async () => {
  const { session, viewer } = await newSession();
  // named standpoint on purpose: DECKBD has no default scene, and scene 0's
  // openscene forwards through the stairhead into DECKA
  await session.openSetFile("deckbd.set", "scene44", "view212");
  const v = viewer();
  const set = v.set;
  const pal = paletteToRGBA(set.paletteRaw, set.colorCount);
  const lum = (i: number): number => 0.3 * pal[i * 4] + 0.6 * pal[i * 4 + 1] + 0.1 * pal[i * 4 + 2];
  const scene = set.scenes.find((s) => s.sceneName.toLowerCase() === "scene44")!;
  const local = scene.views.findIndex((vw) => vw.viewName.toLowerCase() === "view212");
  const gid = scene.views[local].viewID;
  const road = set.transitions.find((t) => t.transitionName.toLowerCase() === "road281")!;
  const reg = road.frameRegisters[road.viewIDstart === gid ? 0 : 1];

  // stand where the road departs, then walk it
  const fb = new FrameBuffer();
  for (const fi of scene.turns[0].frames) {
    if (fi.frameContainerLoc) decodeFrame(set.file.containers[fi.frameContainerLoc].data, fb);
    if (fi.viewID === local && fi.motionInfo > 0) break;
  }
  const skyBright: number[] = [];
  for (const fi of reg.frames) {
    if (!fi.frameContainerLoc) continue;
    const d = decodeFrame(set.file.containers[fi.frameContainerLoc].data, fb);
    let n = 0;
    for (let y = 0; y < 40; y++) for (let x = 0; x < d.width; x++) if (lum(fb.pixels[y * d.width + x]) > 70) n++;
    skyBright.push(n);
  }
  // last third of the walk: the funnel is out of frame by then
  const tail = skyBright.slice(10).reduce((a, b) => a + b, 0);
  check(
    "by the end of the walk the sky band is dark",
    tail < 300,
    `${tail} bright px over the last ${skyBright.length - 10} frames (a memmove copy leaves ~2200); series ${skyBright.join(",")}`,
  );
});

// --- 0b. the cold boot, end to end -----------------------------------------
// The real TI.EXE startup (BOOTFILE boot(): logos -> menu -> resources ->
// advanceday), which no test could reach while it lived in main.ts. Drives it
// exactly as the landing screen does and checks where it lands.
test("host: cold boot runs boot() through to the London flat", async () => {
  const { host, session, sink } = await newHost();
  // This pump is a frame source, so let playmovie block the way TI.EXE's does
  // — without it the menu is not a menu: boot() runs straight through
  // playmode.mov and the GAME click below lands after the fact, on nothing.
  session.modalMovies = true;
  let booted = false;
  const boot = session.track(host.coldBoot().then(() => (booted = true)));
  // the menu movie is interactive: it waits for a click on GAME. Pump frames
  // until it is up, answer it, then pump on to the flat.
  const pump = async (until: () => boolean, max = 8000): Promise<boolean> => {
    for (let i = 0; i < max && !until(); i++) {
      host.viewer?.tick((clock += 66));
      await drain();
    }
    return until();
  };
  const menuUp = await pump(() => !!host.viewer?.awaitingInput &&
    sink.calls.some((c) => c.channel === "voice" && c.loop));
  check("the boot reaches the main menu, with its theme, and waits there", menuUp,
    `movie=${host.viewer?.moviePlaying} awaiting=${host.viewer?.awaitingInput} plays=${JSON.stringify(sink.calls)}`);
  check("the screen is black under the movies", session.fade.level === 1);

  await host.viewer!.click(266, 254); // the GAME region of playmode.mov
  // NOT `currentSetName === "bedsit1"`: coldBoot opens the flat as a bare movie
  // host before the logos play, so that is true from the very first tick.
  const landed = await pump(() => booted && !session.fade.queue.length);
  await boot;
  check(
    "it lands in the London flat, faded in, on the flat's radio",
    landed && session.currentSetName === "bedsit1" && session.fade.level === 0 &&
      session.currentThemeName === "bedrad1.trk",
    `set=${session.currentSetName} fade=${session.fade.level} theme=${session.currentThemeName}`,
  );
  // the boot's own opening mix: half volume, wave dial parked mid
  check(
    "the cold boot opens at a 50% mix",
    session.waveVolume === 5 && Number(session.interp.globals.get("themevolume")) === 128,
    `wave=${session.waveVolume} theme=${session.interp.globals.get("themevolume")}`,
  );
}
);

// --- 0b1. the OTHER button on that menu -------------------------------------
// The guided tour, and the reason it is worth its own boot: the interface band is
// built by house.shp's `initprops` -> `initinterface`, which BRANCHES ON `tour` —
// the tour gets the deck map and the ship, the game gets the bag and the
// pocketwatch. `tour` is set by this menu, so anything that builds the band
// before the click builds the wrong one, and the tour branch says nothing about
// the bag, so a wrongly-built one is never taken back down. That is what the
// port's stand-in boot was doing: user-reported as "the bag is misplaced in the
// menu band" on a tour, and measured as bag and watch 2D at (256, 324) — the
// anchor `openshop`'s own `propxy` gives a band prop — beside the map and ship.
test("host: the guided tour gets the tour's band, and not the game's", async () => {
  const { host, session } = await newHost();
  session.modalMovies = true; // as above: without it the menu is not a menu
  let booted = false;
  const boot = session.track(host.coldBoot().then(() => (booted = true)));
  const pump = async (until: () => boolean, max = 8000): Promise<boolean> => {
    for (let i = 0; i < max && !until(); i++) {
      host.viewer?.tick((clock += 66));
      await drain();
    }
    return until();
  };
  check("the boot reaches the main menu", await pump(() => !!host.viewer?.awaitingInput));

  // playmode.mov's LOWER region (y 307..348): a type-2 jump to frame "GAME 3",
  // which is the movie's actionframe(1) — what boot() reads `tour` off.
  await host.viewer!.click(266, 327);
  const landed = await pump(() => booted && !session.fade.queue.length);
  await boot;
  check(
    "it lands in C73 on the tour, not in the London flat",
    landed && !!Number(session.interp.globals.get("tour")) && session.currentSetName === "c73",
    `tour=${session.interp.globals.get("tour")} set=${session.currentSetName} landed=${landed}`,
  );

  const band = (name: string): string => {
    const p = session.propRuntime.get(name);
    if (!p) return "absent";
    return `${p.visible ? "shown" : "hidden"} ${p.stateName || "-"} @${p.anchorX},${p.anchorY}${p.worldSpace ? " (world)" : ""}`;
  };
  const shown = (name: string): boolean => !!session.propRuntime.get(name)?.visible;
  check(
    "the tour's band is the deck map and the ship",
    shown("map") && shown("ship") && shown("life"),
    `map=${band("map")} ship=${band("ship")} life=${band("life")}`,
  );
  check(
    "and the bag and the pocketwatch are not in it",
    !shown("bag") && !shown("watch"),
    `bag=${band("bag")} watch=${band("watch")}`,
  );
}
);

// --- 0b2. the boot's resource list, read out of the BOOTFILE ----------------
// It used to be three hardcoded lists of TAOOT filenames in engine/src/web/host.ts. Now the
// BOOTFILE is the manifest — every one of those files is named by the boot's own
// scripts — which is what lets the host start a game it knows nothing about.
test("bootplan: what the boot needs is read from the BOOTFILE, not known", () => {
  const boot = gamefiles(root).resolve("bootfile");
  if (!boot) return; // no tree to read
  const plan = readBootPlan(new Uint8Array(readFileSync(boot)));
  // What the full game's boot() actually opens. Not a restatement of the old
  // constant — each of these is `openshopfile("house.shp")` and friends inside
  // BOOTFILE container 1, and the check is that the scan finds them all.
  for (const f of ["logo.mov", "playmode.mov", "gang.cst", "inven.shp", "inven.trk",
    "unilib.trk", "house.shp", "main.stg"]) {
    check(`the plan names ${f}`, plan.resources.includes(f), plan.resources.join(", "));
  }
  check("the story cast is called out for set changes", plan.casts.join() === "gang.cst", plan.casts.join());
  // `initall("bedsit1")`, the first room the day machine names
  check("and the landing room is derived", plan.landingSet === "bedsit1.set", `${plan.landingSet}`);
  // The walk must NOT follow boot()'s closing sendtostage(advanceday()) into the
  // story: advanceday names the endgame's movies, and leave.mov alone is 37.5 MB
  // that a player five seconds into a launch would be waiting for.
  for (const f of ["leave.mov", "ocredits.mov", "credits.mov", "debris.mov"]) {
    check(`the endgame's ${f} is NOT preloaded`, !plan.resources.includes(f), plan.resources.join(", "));
  }
  // the demo's CD check names a 9 MB room it only wants to know the existence of
  check("a fileexists() probe is not a resource", !plan.resources.includes("gstair2.set"));
  // `setpath` names the volumes: currentcd("Titanic1"/"Titanic2"), in disc order.
  // This is what decides which copy of a both-discs room wins, and it used to be a
  // /titanic([12])/ regex in the file layer.
  check(
    "and the volumes are derived, in disc order",
    plan.volumes.join() === "titanic1,titanic2",
    plan.volumes.join(),
  );
}
);

// --- 0c. the demo edition: a game whose own boot() is the whole boot ---------
// The 1996 demo (gamefiles/demo/) ships its own BOOTFILE, and it opens what it
// needs: gang.cst, two track banks, demo.shp, and its own menu stage. The port
// must therefore stand in for NONE of it — ensureBooted's re-creation of the full
// game's boot() opened house.shp and main.stg over that menu, which drew the
// interface band's lifebuoy across the middle porthole, in the menu flat's
// palette, and ran inven.shp's initprops a whole game early.
const demoIndex = gamefiles(root, DEMO_EDITION);
const demoBoot = demoIndex.resolve("bootfile");
// a tree that boots its own way is one whose boot names no first room — the same
// question GameHost.coldBoot asks, read from the BOOTFILE (engine/src/runtime/bootplan.ts)
const noDemo =
  !demoBoot || !!readBootPlan(new Uint8Array(readFileSync(demoBoot))).landingSet;
test.skipIf(noDemo)("host: the demo edition boots its own way", async () => {
  const { host, session } = await newHost({ edition: DEMO_EDITION });
  // no boot library and no resources yet: this edition's own boot() is what
  // brings them up, and the check below is that nothing did it for it
  check("nothing is booted in front of it", session.stageName === "none", `stage=${session.stageName}`);

  let booted = false;
  const boot = session.track(host.coldBoot().then(() => (booted = true)));
  // Frames, because the boot plays open.mov and playmovie only ends on them — and
  // through the DIRECTOR, because there is no viewer to tick: this boot borrows no
  // room now, which is the point of the check further down.
  for (let i = 0; i < 40000 && !(booted && session.stageName === "demo.stg"); i++) {
    host.director.tick((clock += 66));
    await drain();
  }
  await boot;

  check(
    "it reaches the demo's own menu stage",
    session.stageName === "demo.stg" && session.currentFlat !== "none",
    `stage=${session.stageName} flat=${session.currentFlat}`,
  );
  // The band, the inventory and the in-game stage belong to `dodemo()` — the
  // script behind the middle porthole — and not to the boot. house.shp not being
  // open at all is what the lifebuoy's absence comes down to, so ask for that
  // rather than for a pixel.
  check(
    "and the port opened none of the full game's boot resources over it",
    [...session.propRuntime.shops.keys()].join() === "demo.shp" &&
      !session.propRuntime.get("life") &&
      !session.interp.globals.has("__propsinit"),
    `shops=${[...session.propRuntime.shops.keys()].join()} life=${!!session.propRuntime.get("life")}`,
  );
  // ...and it opened NO ROOM AT ALL, which is the inversion of what this used to
  // assert. The port had to borrow one — "any of the game's rooms will do", 9 MB
  // of grand staircase pinned black — because the frame loop drew through a
  // SetViewer and the demo's boot plays a movie and opens a stage with no room
  // behind either. The screen is not a room's any more
  // (engine/src/web/screen-director.ts), so the honest state here is no viewer,
  // no set, nothing showing, and a director compositing the menu stage anyway.
  check(
    "it borrows no room to draw into",
    !host.viewer && session.currentSetName === "none" && !session.viewShowing,
    `viewer=${!!host.viewer} set=${session.currentSetName} showing=${session.viewShowing}`,
  );
  check(
    "and the screen composites the menu stage without one",
    host.director.paintWorldInto() === "flat" && host.director.screenOwner() !== "held",
    `drew=${host.director.paintWorldInto()} owner=${host.director.screenOwner()}`,
  );
  check(
    "and its menu opens at the same 50% mix the full game does",
    session.waveVolume === 5 && Number(session.interp.globals.get("themevolume")) === 128,
    `wave=${session.waveVolume} theme=${session.interp.globals.get("themevolume")}`,
  );

  // The other half of the same bug: the band came up EMPTY when the game opened
  // house.shp itself, because only the port's stand-in boot marked those shops as
  // the ones whose screen props draw over the room view. `dodemo()` is what opens
  // them here, so the flag has to follow the shop and not the opener.
  await session.openShop("house.shp");
  check(
    "a boot-UI shop the GAME opens still draws over the room view",
    session.propRuntime.shops.get("house.shp")?.persistent === true,
    `persistent=${session.propRuntime.shops.get("house.shp")?.persistent}`,
  );
}
);

// --- 0d. a scriptless cast member still receives its events -----------------
// A cast entry may be a STUB: `smeth` in the demo's gang.cst (Frank's contact,
// and the whole of the demo's first scene) has an 8-byte script container,
// because everything he does is a puppet conversation the CAST MAIN runs
// (`runpuppet`, written against `target`). Without resolving a scriptless actor
// on its cast main, `sendtoactor("smeth", runpuppet("dsmeth.pup", "door"))` had
// no chain at all and was dropped as "target not loaded" — C71's door opened
// onto nobody. The full game has one too: `purs`.
test.skipIf(noDemo)("engine: a scriptless cast member resolves on its cast main", async () => {
  const { session } = await newHost({ edition: DEMO_EDITION });
  session.bootedByGame();
  await session.openCastFile("gang.cst");
  // the stub is real, and it is what makes this test worth having
  check(
    "smeth is a scriptless member of the demo's cast",
    !!session.actorRuntime.get("smeth") && !session.castScripts.has("smeth"),
    `inRuntime=${!!session.actorRuntime.get("smeth")} hasScript=${session.castScripts.has("smeth")}`,
  );
  // `hotdist` is a plain cast-main query with no side effects — the cheapest
  // handler that proves the dispatch arrives rather than being dropped
  const before = logs(session);
  await session.sendEvent("sendtoactor", "smeth", "hotdist", [], "test");
  check(
    "and an event sent to him is not dropped",
    !before().some((l) => l.includes("target not loaded")),
    before().join(" | "),
  );
}
);

// --- 0d2. a click on an actor nobody wrote a handler for ends, not recurses -
// boot1.mousedown routes a click on an actor with `sendtoactor(thename,
// mousedown(thepoint))`. The demo's crowd-walker cast member `extra` has no
// mousedown anywhere in its chain (gang.cst's main has none either), and the
// sendtoactor containment fallback — added so putdownactor/moveactorstar reach
// the BOOTFILE — resolved the event right back into boot1.mousedown, whose
// hittest found the same actor under the same unmoved point: "dispatch cycle:
// boot1.mousedown at depth 64", and every click on a walker was eaten
// (user-reported from Burns' cabin, where it read as "the table not working").
// The rule: an event does not resolve INTO the boot library when the boot
// library is what dispatched it — the fallback is for events arriving under a
// DIFFERENT outer handler, which is every case it was built for.
test.skipIf(noDemo)("engine: a click on a handler-less actor completes instead of recursing", async () => {
  const { session } = await newHost({ edition: DEMO_EDITION });
  session.bootedByGame();
  await session.openCastFile("gang.cst");
  // a click parked on a crowd walker: hittest answers the extra every time
  session.hitTestAt = () => ({ name: "extra", type: "actor" });
  const boot1 = session.bootScripts.find((b) => b.script.codes.has("mousedown"))!;
  check("the demo boot ships its own mousedown router", !!boot1);
  let error = "";
  try {
    await session.interp.runHandler(boot1, "mousedown", [0], { me: boot1.name, target: "" });
  } catch (e) {
    error = (e as Error).message;
  }
  check("the click completes — no dispatch cycle", error === "", error);
}
);

// --- 0e. a line named by its subtitle instead of its ident ------------------
// The demo's dpenny.pup is the only file in either tree whose script says
// `puppetspeak("No, that's not Mr. Conkling.")` rather than `puppetspeak
// ("dpen.01")` — all 36 of its calls name a SUBTITLE and none name an ident, so
// Penny stood silent with `puppetspeak: no line` in the log. The fallback is
// consulted only after the ident lookup misses, which is why it cannot move any
// other puppet in any tree: their scripts all hit the ident map first.
test.skipIf(noDemo)("engine: puppetspeak finds a line named by its subtitle", async () => {
  const { session } = await newHost({ edition: DEMO_EDITION });
  session.bootedByGame();
  check("the demo's Penny puppet opens", await session.puppetCtrl.openPuppetFile("dpenny.pup"));
  const line = [...(session.puppet?.pup.dialogue.values() ?? [])].find((l) => /Conkling/i.test(l.text));
  check("and it carries the line the script names by text", !!line, `${line?.ident} / ${line?.text}`);
  if (!line) return;
  // A speak SUSPENDS for the line's duration, and the subtitle is posted before
  // that wait — so fire it, give the clock a few frames, and read what it put up.
  const say = async (ident: string): Promise<string> => {
    let done = false;
    void session.puppetCtrl.puppetSpeak(ident).then(() => (done = true));
    for (let i = 0; i < 60 && !done && !session.puppet?.subtitle; i++) {
      session.tickTime((clock += 66));
      await drain();
    }
    const said = session.puppet?.subtitle ?? "";
    session.puppet!.speakSkip?.(); // abandon the rest of the line
    await drain();
    if (session.puppet) session.puppet.subtitle = "";
    return said;
  };
  // exactly what dpenny.pup's own script passes
  check(
    "speaking it by subtitle plays that line",
    (await say(line.text)) === line.text,
    `wanted=${JSON.stringify(line.text)}`,
  );
  // and the ident still resolves, which is every other script's route in
  const byIdent = session.puppet?.pup.dialogue.get("dpen.03")?.text ?? "?";
  check("an ident still wins, and is unaffected", (await say("dpen.03")) === byIdent, `wanted=${JSON.stringify(byIdent)}`);
}
);

// --- 0e2. a handler that never closes its switch ---------------------------
// User-reported (#177): "Smethells is supposed to intercept you and tell you the
// lounge is closed… I can open the door and attempt to walk through, but the
// screen just fades to black and back", with `? smethellslounger()` — the port's
// unknown-command marker — as the last line in the log.
//
// LNGHALL's door runs `sendtoactor("smeth", runpuppet("smeth1.pup", "nolounge"))`
// for the whole of missions 1-3, and SMETH1.PUP's `before` script answers it with
// `smethellslounger()`. Both live in the SAME script container, twenty lines
// apart, and the call could not find the handler.
//
// The reason is eleven blocks earlier. `stewardwell` opens two `switch`es and
// closes one — the author nested a second plaque inside `case 101` and never
// wrote its `endswitch` (the source is not even indented for it) — so the outer
// switch was still open when `endcode` arrived. The parser, looking for `case` or
// `endswitch`, read straight through the handler boundary and ate the four
// handlers that followed: `soundfx`, `idlespeaks`, `byesmeth` and
// `smethellslounger`.
//
// So `endcode`, and the `code` that starts the next handler, close whatever is
// still open. That tolerance already existed one level up, for a handler ending
// in a bare `exitcode` with no `endcode` (TURBINE's `boilsound`); this is the
// same rule at every depth. Measured across all six editions afterwards: every
// declared handler in every script container is parsed, the only remaining
// difference being gang.cst 1267, which really does declare `endwalk` twice.
test("engine: an unclosed switch ends at endcode, not at the next handler", async () => {
  const { session } = await newHost();
  session.bootedByGame();
  check("smeth1.pup opens", await session.puppetCtrl.openPuppetFile("smeth1.pup"));

  // the shape, from the file itself — if this ever stops being true the rest of
  // this test is checking nothing
  const pup = session.puppet!.pup;
  const before = pup.scripts.find((x) => x.name === "before")!;
  const text = scriptToText(sniffScript(pup.file.containers[before.location].data)!);
  const body = text.slice(text.indexOf("code stewardwell"));
  const stewardwell = body.slice(0, body.indexOf("endcode"));
  check(
    "stewardwell opens two switches and closes one",
    (stewardwell.match(/\bswitch\b/g) ?? []).length === 2 &&
      (stewardwell.match(/\bendswitch\b/g) ?? []).length === 1,
    stewardwell.slice(-120),
  );

  // ...and every handler declared in that container is reachable
  const declared = (text.match(/^code +([a-z0-9_]+)/gim) ?? []).map((m) => m.split(/\s+/)[1].toLowerCase());
  const parsed = parseScript(sniffScript(pup.file.containers[before.location].data)!).codes;
  check(
    "every handler after it survives the parse",
    declared.every((n) => parsed.has(n)),
    `missing: ${declared.filter((n) => !parsed.has(n)).join(", ")}`,
  );
  check("including the one the lounge door calls", parsed.has("smethellslounger"));

  // the behaviour: the door's own message, answered. The reporter's log ended on
  // `? smethellslounger()`, which is the marker a bound SET installs for an
  // unresolved call (SetScripts) — no set is open here, so the test installs its
  // own, or the check below would be one that cannot fail.
  const unknown: string[] = [];
  session.interp.onUnknown = (name) => unknown.push(name);
  const inst = session.puppet!.scripts.get("before")!;
  // `runyoself("nolounge")` speaks a line and then WAITS on a plaque, so it is
  // fired rather than awaited — what matters is that it gets that far
  void session.interp.runHandler(inst, "runyoself", ["nolounge"], { me: "smeth", target: "smeth" });
  for (let i = 0; i < 120 && !session.puppet?.bevels.length; i++) {
    session.tickTime((clock += 50));
    await drain();
  }
  check(
    "the lounge refusal resolves instead of reading as an unknown command",
    !unknown.includes("smethellslounger"),
    unknown.join(", "),
  );
  check(
    "and Smethells puts his two choices up",
    session.puppet?.bevels.length === 2,
    JSON.stringify(session.puppet?.bevels),
  );
  session.puppet?.eventWaiter?.(-1); // walk out, so nothing is left suspended
  await drain();
}
);

// --- 0f. the four answers hittest gives a room ------------------------------
// Every click and every cursor in the game is a `switch result()` over these, and
// TI.EXE's own hittest (id 20070, 0x4277f0) answers in four zones: the sprite list
// first, wherever the point is; then the SET, if the point is inside the image it
// draws — a hotspot there is a "painting" and the room behind them is the "scene",
// BY NAME; then the STAGE, where the set's image is not — a click-region is a
// "button" and the rest is the current "flat". Three of the four were wrong in a
// room: no prop step at all, hotspots labelled "scene", and the room itself
// answering nothing while the click went to the band's flat.
//
// The property worth pinning is the AGREEMENT: whatever the click path dispatches
// to, hittest must name — they are one function and one zone test apart now.
test("hittest: the four answers a room gives, and the click path agrees", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  // 1. a PROP in the world. Asserted as a set rather than at a coordinate: the
  // point is that world props are reachable at all, and the pixels belong to the
  // art. c73 puts Frank's bag on the bed (house.shp initprops).
  const asProp = new Set<string>();
  for (let y = 4; y < 264; y += 4) {
    for (let x = 4; x < 512; x += 4) {
      const hit = session.hitTestAt(x, y);
      if (hit.type === "prop") asProp.add(hit.name.toLowerCase());
    }
  }
  check(
    "a world prop in the room answers as a prop",
    asProp.has("bag"),
    `reported: ${[...asProp].join(", ") || "(none)"}`,
  );
  // 2. a view hotspot is a PAINTING, named after itself — that is what
  // `sendtopainting(currentscene(), currentview(), thename, …)` needs, and it is
  // resolved in the view you are looking at rather than by name across the set.
  // c73's default view carries no hotspots, so stand somewhere that does.
  let painting = "";
  let scene = "";
  for (const sc of v.set.scenes) {
    for (const vw of sc.views) {
      if (!vw.objects.length || painting) continue;
      v.jumpTo(sc.sceneName, vw.viewName);
      for (const o of v.scene.views[v.viewIdx].objects) {
        const cx = Math.floor((o.startRegionX + o.endRegionX) / 2);
        const cy = Math.floor((o.startRegionY + o.endRegionY) / 2);
        const hit = session.hitTestAt(cx, cy);
        if (hit.type === "painting" && hit.name.toLowerCase() === o.identifier.toLowerCase()) {
          painting = `${vw.viewName}:${hit.name}`;
        }
      }
      // 3. and the room BEHIND the hotspots answers for itself, by scene name —
      // the boot's `case "scene": sendtoscene(thename, mousedown(thepoint))`.
      for (let y = 4; y < 264 && !scene; y += 4) {
        for (let x = 4; x < 512; x += 4) {
          const hit = session.hitTestAt(x, y);
          if (hit.type === "scene") {
            scene = hit.name === session.currentSceneName() ? "" : `wrong name: ${hit.name}`;
            if (!scene) scene = "ok";
            break;
          }
        }
      }
    }
  }
  check("a hotspot answers as a painting, under its own name", !!painting, painting);
  check("the room behind them answers as the scene, by scene name", scene === "ok", scene);
  // 4. below the set's image the STAGE answers: in-game the room is the top 264
  // rows and the interface band belongs to main.stg's "main 1".
  const band = session.hitTestAt(6, 370);
  check(
    "the band below the room answers for the flat",
    band.type === "flat" && band.name === "main 1",
    `${band.type}:${band.name}`,
  );
  // ...and NOTHING in the band answers for an ACTOR. A projected sprite reaches
  // below the room's image for anyone standing near the camera, and the render
  // clips it there, so asking the actors outside that image talked to a character
  // through the interface band — 1558 such points in gstair2 alone. It presented
  // as one extra brush-off conversation: `fourcount`, the counter that rotates
  // which line a seaman fobs you off with, came out one ahead over a full route.
  const { session: s2, viewer: v2 } = await newSession();
  await s2.openSetFile("gstair2.set");
  const rooms = v2();
  let bandActors = "";
  for (const sc of rooms.set.scenes) {
    for (const vw of sc.views) {
      if (bandActors) break;
      rooms.jumpTo(sc.sceneName, vw.viewName);
      for (let y = 266; y < 384 && !bandActors; y += 4) {
        for (let x = 2; x < 512; x += 4) {
          const hit = s2.hitTestAt(x, y);
          if (hit.type === "actor") { bandActors = `${vw.viewName} ${x},${y} -> ${hit.name}`; break; }
        }
      }
    }
  }
  check("no actor answers below the room, where none is drawn", !bandActors, bandActors);

  // And the click path agrees with all four. The one that had been wrong in the
  // room is the fourth: a click on the FLOOR ran the current flat's mousedown,
  // which in-game is `sendtoshop("house.shp", deactivateinterface())` — clicking
  // the carpet put the interface away. Now only the band does that.
  await session.sendEvent("sendtoshop", "house.shp", "activateinterface", [], "test");
  const lit = () => session.propRuntime.get("light")?.visible === true;
  const wasLit = lit();
  let floor = { x: -1, y: -1 };
  for (let y = 4; y < 264 && floor.x < 0; y += 4) {
    for (let x = 4; x < 512; x += 4) {
      if (session.hitTestAt(x, y).type === "scene") { floor = { x, y }; break; }
    }
  }
  await v.click(floor.x, floor.y);
  await session.settle(50);
  const stillLit = lit();
  await v.click(6, 370); // the band's own background, where that handler lives
  await session.settle(50);
  check(
    "the floor leaves the interface alone; the band still puts it away",
    wasLit && stillLit && !lit(),
    `lit=${wasLit} afterFloor=${stillLit} afterBand=${lit()} floor=${floor.x},${floor.y}`,
  );
}
);

/** collect a session's log lines from here on, for a check that asks "was anything
 *  complained about?" rather than "what happened?" */
function logs(session: GameSession): () => string[] {
  const seen: string[] = [];
  const prev = session.onLog;
  session.onLog = (l) => {
    seen.push(l);
    prev?.(l);
  };
  return () => seen;
}

/** let suspended scripts (await points, resolved delays) continue */
const drain = () => new Promise<void>((resolve) => setImmediate(resolve));

async function runAnimations(v: SetViewer): Promise<void> {
  let guard = 0;
  while (v.busy || v.session.scriptBusy) {
    v.tick((clock += 100));
    await drain();
    if (++guard > 2000) throw new Error("animation never finished");
  }
}

// --- 1. hotspot alignment + cursor + click (B59 door) ---
test("hotspot alignment + cursor + click (B59 door)", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("b59.set");
  const v = viewer();
  const view = v.scene.views[v.viewIdx];
  const obj = view.objects[0];
  const cx = Math.floor((obj.startRegionX + obj.endRegionX) / 2);
  const cy = Math.floor((obj.startRegionY + obj.endRegionY) / 2);
  check("b59 door hotspot present", obj?.identifier === "door");
  check("hover returns touch cursor", (await v.hover(cx, cy)) === "touch");
}
);

// --- 1b. SPACE is the door opener (BOOTFILE keydown -> sendtopainting) ---
test("space key opens/closes the door hotspot (B59)", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("b59.set");
  const v = viewer();
  check("b59 default view has a door hotspot", v.scene.views[v.viewIdx].objects[0]?.identifier === "door");
  check("door starts hidden", session.propRuntime.get("door")?.visible !== true);
  // SPACE routes through boot's keydown -> sendtopainting(scene, view, "door",
  // mousedown(0)) -> the door object's mousedown opens it
  await v.keyDown(" ");
  await runAnimations(v);
  check("space opens the door", session.propRuntime.get("door")?.visible === true,
    `door.visible=${session.propRuntime.get("door")?.visible}`);
  // pressing space again toggles it shut
  await v.keyDown(" ");
  await runAnimations(v);
  check("space again closes the door", session.propRuntime.get("door")?.visible === false,
    `door.visible=${session.propRuntime.get("door")?.visible}`);
}
);

// --- 2. road arrival faces travel direction (user-reported bug) ---
test("road arrival faces travel direction (user-reported bug)", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("turk.set");
  const v = viewer();
  v.jumpTo("scene11", "View116");
  v.walk();
  await runAnimations(v);
  const scene = v.scene.sceneName;
  const view = v.scene.views[v.viewIdx].viewName;
  check("turk Road144 arrival", scene === "Scene134" && view === "View138", `${scene}/${view}`);
}
);

// --- 2b. a walk's arrival scripts drive the camera (the demo's deck warp) ---
// The demo fakes a three-deck grand staircase with two set files: landing in
// gstair2's Scene65 (view68, the couch alcove off the top landing) runs an
// openscene that reads `savedeck` and warps you a deck — `changeset(theset);
// currentscene(thescene); currentview(theview)`, the demo build's script style
// (the full game passes the pair INSIDE changeset). Those setters are
// unconditional in TI.EXE, but the port armed them only during a user
// gesture's script chain — and a walk's arrival lifecycle runs ticks after the
// gesture ended, so the warp's changeset fired with the jumps dropped, and
// every climb landed at the arriving set's DEFAULT scene. Reported as landing
// somewhere wrong walking forward from gstair2 Scene50/View53 (Road75).
test.skipIf(noDemo)("nav: the deck warp lands where its arrival script says", async () => {
  for (const [deck, wantSet, wantScene, wantView, wantDeck] of [
    ["a", "gstair1", "Scene17", "View29", "a"], // top deck: cross to the other set file
    ["b", "gstair2", "Scene13", "View32", "a"], // mid deck: SAME set, one deck up, counter down
  ] as const) {
    const { host, session, viewer } = await newHost({ edition: DEMO_EDITION });
    await session.openSetFile("gstair2.set");
    const v = viewer();
    session.interp.globals.set("savedeck", deck);
    v.jumpTo("Scene50", "View53");
    v.walk();
    await runAnimations(v);
    // the warp may have swapped the viewer (changeset): settle the async chain
    // and read the CURRENT one
    for (let i = 0; i < 50; i++) {
      host.viewer?.tick((clock += 66));
      await drain();
    }
    const vv = host.viewer!;
    const at = `${session.currentSetName} ${vv.scene.sceneName}/${vv.scene.views[vv.viewIdx].viewName}`;
    check(
      `deck "${deck}" climbs to ${wantSet} ${wantScene}/${wantView}`,
      at === `${wantSet} ${wantScene}/${wantView}` &&
        session.interp.globals.get("savedeck") === wantDeck,
      `at=${at} savedeck=${session.interp.globals.get("savedeck")}`,
    );
  }
}
);

// --- 2c. a clut on the showing surface ends the transition black -----------
// The darkroom: `transtoflat("redphoto.stg")` puts up screentoblack("current")
// and ends on `mixclut("stage", "black", 0, 255, 245)` with NO blacktoscreen —
// in TI.EXE a fade is a palette ramp, so the mixclut's dim palette IS the
// reveal. The port's overlay fade had nothing lifting it: Burns' darkroom sat
// pitch black, red lamp and all ("the table seems not working"). The reveal is
// scoped to a clut on the surface the screen is SHOWING — CTL's exit runs
// clut("set") between a stage's screentoblack and its blacktoscreen, and that
// one must keep the black up.
test.skipIf(noDemo)("stage: the darkroom's mixclut is its own reveal", async () => {
  const { session, viewer } = await newHost({ edition: DEMO_EDITION });
  session.bootedByGame();
  // dodemo()'s state: interface + inventory shops, the in-game stage
  await session.openShop("inven.shp");
  await session.openShop("house.shp");
  await session.stageCtrl.openStageFile("main.stg");
  await session.openSetFile("b59.set");
  const v = viewer();
  session.interp.globals.set("whitelight", "off");
  v.jumpTo("Scene17", "View33");
  await v.click(350, 190); // the photo table (lights off -> redphoto.stg)
  await runAnimations(v);
  for (let i = 0; i < 50; i++) {
    v.tick((clock += 66));
    await drain();
  }
  check(
    "the darkroom is up and the transition black is gone",
    session.stageName === "redphoto.stg" && session.fade.level === 0,
    `stage=${session.stageName} fade=${session.fade.level}`,
  );
}
);

// --- 3. interpreter runs real game logic (blackjack winner()) ---
test("interpreter runs real game logic (blackjack winner())", async () => {
  const { session } = await newSession();
  const file = readContainerFile(provider("blkjack.stg")!);
  let inst: ScriptInstance | null = null;
  for (const c of file.containers) {
    const tokens = sniffScript(c.data);
    if (!tokens) continue;
    const script = parseScript(tokens);
    if (script.codes.has("winner")) {
      inst = new ScriptInstance("blkjack", script);
      break;
    }
  }
  const winner = async (p: number, d: number) => {
    session.interp.globals.set("playertotal", p);
    session.interp.globals.set("dealertotal", d);
    return (await session.interp.runHandler(inst!, "winner", [], { me: "blkjack", target: "" }))
      .value;
  };
  check(
    "blackjack winner()",
    (await winner(20, 18)) === "player" && (await winner(18, 20)) === "dealer" &&
      (await winner(19, 19)) === "draw" && (await winner(20, 22)) === "player" &&
      (await winner(21, 21)) === "draw",
  );
}
);

// --- 4. audio: locked-door voice line through the script chain ---
test("audio: locked-door voice line through the script chain", async () => {
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("b59.set");
  const v = viewer();
  const main = v.scripts.findInstance("b59")!;
  await session.interp.runHandler(main, "mousedown", ["locked"], { me: "b59", target: "locked" });
  const call = sink.calls.find((c) => c.channel === "voice");
  check("doorlocked voice plays", !!call && call.seconds > 0.5, `${call?.seconds.toFixed(2)}s`);
}
);

// --- 5. cross-set travel via stage gotospecial, globals persist ---
test("cross-set travel via stage gotospecial, globals persist", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("b59.set");
  session.interp.globals.set("testmarker", 42);
  await session.interp.runHandler(session.stageScript!, "gotospecial", ["hallb", "scene29", "view41"], {
    me: "main.stg",
    target: "",
  });
  const v = viewer();
  check(
    "gotospecial b59 -> hallb",
    session.currentSetName === "hallb" &&
      v.scene.sceneName.toLowerCase() === "scene29" &&
      v.scene.views[v.viewIdx].viewName.toLowerCase() === "view41",
    `${session.currentSetName}/${v.scene.sceneName}/${v.scene.views[v.viewIdx].viewName}`,
  );
  check("globals persist across sets", session.interp.globals.get("testmarker") === 42);
}
);

// --- 6. props: shop loads, prop state machinery works (TURK) ---
// turk.shp belongs to TURK.STG, which opens it in `openstage` and closes it in
// `closestage` (0001:3 and 0001:8) — the ROOM must arrive without it. Five shops
// share a room's name (boil, cargo, turk, wireless, bridge) and all five are
// stage shops; entering the room used to open them anyway, which is how the
// boiler's chute controls and the cargo hold's painting crate ended up drawn
// over the save panel and clickable there (#17, #18).
test("props: shop loads, prop state machinery works (TURK)", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("turk.set");
  void viewer();
  check(
    "the room does not bring the close-up stage's shop with it",
    !session.propRuntime.shops.has("turk.shp") && !session.propRuntime.get("turkwater"),
    `shops=${[...session.propRuntime.shops.keys()].join(",")}`,
  );
  // the stage does, through its own openstage
  await session.runGlobal("transtoflat", ["turk.stg"]);
  await session.settle(200);
  const p = session.propRuntime.get("turkwater");
  check("turk.shp props loaded by turk.stg", !!p, session.propRuntime.shops.size + " shop(s)");
  if (p) {
    p.visible = true;
    p.stateName = "run";
    check("prop state has frames", (p.state()?.frames.length ?? 0) === 16);
  }
}
);

// --- 7. door opens: prop becomes visible, sound plays, uparrow travels ---
test("door opens: prop becomes visible, sound plays, uparrow travels", async () => {
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("b59.set");
  let v = viewer();
  // click the door hotspot in Scene14/View18
  const obj = v.scene.views[v.viewIdx].objects[0];
  await v.click(
    Math.floor((obj.startRegionX + obj.endRegionX) / 2),
    Math.floor((obj.startRegionY + obj.endRegionY) / 2),
  );
  const door = session.propRuntime.get("door");
  check(
    "door prop opens on click",
    !!door && door.visible && door.stateName === "b59-hallb",
    `visible=${door?.visible} state=${door?.stateName}`,
  );
  const voice = sink.calls.find((c) => c.channel === "voice");
  check("dooropen sound plays", !!voice && voice.seconds > 0.1, `${voice?.seconds.toFixed(2)}s`);
  // with the door open, uparrow is intercepted by the scene script -> hallb
  const consumed = await v.keyDown("uparrow");
  v = viewer();
  check(
    "uparrow through open door travels to hallb",
    consumed && session.currentSetName === "hallb",
    `consumed=${consumed} set=${session.currentSetName} ${v.scene.sceneName}/${v.scene.views[v.viewIdx].viewName}`,
  );
}
);

test("hall crossover: uparrow at a dead-end toggles hallside + cuts across", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("hallc.set");
  const v = viewer();
  // stand at the star-side dead-end facing forward, side = star
  session.interp.globals.set("hallside", "star");
  v.jumpTo("scene52", "view59");
  await runAnimations(v);
  // uparrow: HALLC keydown does currentscene("scene10")/currentview("view15")
  // to cut to the mirrored (port) side — the currentscene/currentview setters
  // that were previously no-ops, leaving the player stuck at the dead-end.
  const consumed = await v.keyDown("uparrow");
  await runAnimations(v);
  check(
    "uparrow crosses to the other side (hallside flips star->port)",
    consumed && session.interp.globals.get("hallside") === "port",
    `consumed=${consumed} hallside=${session.interp.globals.get("hallside")}`,
  );
  check(
    "uparrow leaves the scene52/view59 dead-end",
    v.scene.sceneName.toLowerCase() !== "scene52",
    `now ${v.scene.sceneName}/${v.scene.views[v.viewIdx].viewName}`,
  );
});

// --- 8. doors close on navigation (boot's default closescene) ---
test("doors close on navigation (boot's default closescene)", async () => {
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("b59.set");
  const v = viewer();
  const obj = v.scene.views[v.viewIdx].objects[0];
  const cx = Math.floor((obj.startRegionX + obj.endRegionX) / 2);
  const cy = Math.floor((obj.startRegionY + obj.endRegionY) / 2);
  const door = session.propRuntime.get("door")!;

  // open door, then walk away to another scene in the same set
  await v.click(cx, cy);
  sink.calls.length = 0;
  v.jumpTo("Scene14", "View19"); // View19 faces Road34 to Scene15
  v.walk();
  await runAnimations(v);
  const closedOnWalk = !door.visible;
  const closeSound = sink.calls.find((c) => c.channel === "voice");
  check("door closes when walking away", closedOnWalk, `visible=${door.visible}`);
  check("doorclose sound plays", !!closeSound, `${closeSound?.seconds.toFixed(2) ?? "-"}s`);

  // open again, then just turn: view change must also close the door
  v.jumpTo("Scene14", "View18");
  await v.click(cx, cy);
  sink.calls.length = 0;
  v.turn(0);
  await runAnimations(v);
  check("door closes on turn", !door.visible, `visible=${door.visible}`);
  check("doorclose sound on turn", sink.calls.some((c) => c.channel === "voice"));

  // open again, travel to another set: door must not survive the trip
  v.jumpTo("Scene14", "View18");
  await v.click(cx, cy);
  await session.interp.runHandler(session.stageScript!, "gotospecial", ["hallb", "scene29", "view41"], {
    me: "main.stg",
    target: "",
  });
  check("door closes on set change", !door.visible, `visible=${door.visible}`);
}
);

// --- 8b. a movie owns the screen, through a fade the script left standing -----
// The demo's Smethells briefing plays its note with no `blackscreen()` between the
// fade and the clip (dsmeth.pup meet(): `screentoblack("puppet", 15);
// puppetvisible(false); playmovie("penote.mov")`), so the held snapshot kept the
// screen and penote.mov played CLICKABLE BEHIND A BLACK RECTANGLE. In TI.EXE
// screentoblack (0x43e550 -> 0x435b90) is a blocking ramp that finishes and
// returns — it leaves no layer behind, so whatever draws next owns the screen, and
// a movie carries its own palette and its own full-screen frames.
//
// The same two lines are in the shipped game twice: PHOTO.STG 0012 (the darkroom's
// photobox.mov) and WIRELESS.SHP 0120 (portrait.mov, whose `clut("black")` is a
// no-op here precisely because it is normally paired with the missing blackscreen).
test("a movie outranks a held fade — the screen is the clip, not the black", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("turk.set");
  const v = viewer();
  // the engine's own builtin, so the state under test cannot drift from what a
  // script produces (its two trailing parameters are the call site and the frame,
  // which this one does not read)
  const screentoblack = session.interp.builtins.get("screentoblack")!;
  await screentoblack(session.interp, ["puppet", 15], undefined as never, undefined as never);
  check("the fade is holding a frame", !!session.fade.snapshot);
  check("and it owns the screen while nothing else does", v.screenOwner() === "faded", v.screenOwner());
  v.playMovie("menu.mov");
  for (let i = 0; i < 50 && !v.moviePlaying; i++) await Promise.resolve();
  const settle8b = () => {
    for (let i = 0; i < 30 && v.moviePlaying; i++) v.tick((clock += 250));
  };
  settle8b();
  check(
    "the clip owns the screen, with the fade still held",
    v.moviePlaying && !!session.fade.snapshot && v.screenOwner() === "movie",
    `playing=${v.moviePlaying} snapshot=${!!session.fade.snapshot} owner=${v.screenOwner()}`,
  );
  // And when the clip ends the screen is STILL BLACK — which is what the script's
  // own `blacktoscreen("puppet", 15)` fades up from. The black, not the frozen
  // frame: the snapshot is dropped when a movie finishes, because the picture it
  // froze is one the movie has since painted over, and what a ramp should bring up
  // is the live screen. In TI.EXE there is no layer to hold — `screentoblack` ramps
  // the PALETTE and returns, so a later `blacktoscreen` brings up whatever is
  // drawn now.
  //
  // Keeping it was a deadlock, and a shipped one. tickFade will not lift a black
  // while a snapshot is held, and only blacktoscreen/blackscreen/visualeffect
  // clear one — so a script that screentoblacks, plays a movie and then simply
  // STOPS pins the screen for ever. TAOOT's demo trunk does exactly that
  // (transtoflat -> screentoblack -> open trunk.stg -> trnkopen.mov -> nothing):
  // the trunk was open and composited behind a permanently black screen.
  await v.click(460, 350); // menu.mov's OK -> the exit chain
  settle8b();
  check(
    "the screen is still black when it ends, over the live frame",
    !v.moviePlaying && session.fade.level === 1 && !session.fade.snapshot,
    `playing=${v.moviePlaying} level=${session.fade.level} snapshot=${!!session.fade.snapshot} owner=${v.screenOwner()}`,
  );
  // ...and it is a black that something can now lift: with the script quiet and
  // no fade of its own established, the armed reveal comes through
  session.tickFade((clock += 50));
  check(
    "and a quiet script gets the reveal that a held snapshot used to block",
    session.fade.level === 0,
    `level=${session.fade.level} pending=${session.fade.pendingReveal}`,
  );
}
);

// --- 9. movies: boot's spotmovie -> playmovie builtin -> viewer playback ---
test("movies: boot's spotmovie -> playmovie builtin -> viewer playback", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("turk.set");
  const v = viewer();
  // playmovie is MODAL: spotmovie (premovie -> playmovie -> postmovie) blocks at
  // the movie until it ends, so don't await it here — start it, drive the movie
  // to completion with ticks/clicks, then await the tail (postmovie) at the end.
  const spot = session.runGlobal("spotmovie", ["turknmes.mov"]);
  for (let i = 0; i < 50 && !v.moviePlaying; i++) await Promise.resolve();
  check("spotmovie starts playback", v.moviePlaying);
  const settle9 = () => {
    for (let i = 0; i < 30 && v.moviePlaying; i++) v.tick((clock += 250));
  };
  settle9();
  check("movie pauses at the OK frame", v.moviePlaying);
  await v.click(10, 10); // not on a region: nothing happens
  settle9();
  check("click outside regions is ignored", v.moviePlaying);
  await v.click(458, 350); // on the OK button (region 431..485 x 339..362)
  settle9(); // OK jumps to the pressed-button frame, then the exit chain
  check("OK click closes the movie", !v.moviePlaying);
  await spot; // playmovie resolved -> postmovie ran -> spotmovie returns
}
);

// --- 10. movie zoom cycle (MENU.MOV): paper toggles zoom, only OK leaves ---
test("movie zoom cycle (MENU.MOV): paper toggles zoom, only OK leaves", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("turk.set"); // any set; movie loads via provider
  const v = viewer();
  v.playMovie("menu.mov");
  const settle = () => {
    for (let i = 0; i < 30 && v.moviePlaying; i++) v.tick((clock += 250));
  };
  settle();
  check("menu pauses on the closed view", v.moviePlaying);
  await v.click(460, 350); // OK -> pressed-button frame, then exit
  settle();
  check("OK leaves from the closed view", !v.moviePlaying);

  v.playMovie("menu.mov");
  settle();
  await v.click(280, 210); // the menu paper -> hard cut to "frame3" (zoomed)
  settle();
  check("paper click zooms (still in movie)", v.moviePlaying);
  await v.click(250, 200); // zoomed paper -> hard cut back to "frame1"
  settle();
  check("second paper click unzooms, does NOT leave", v.moviePlaying);
  await v.click(460, 350); // OK button
  settle();
  check("OK leaves the menu movie", !v.moviePlaying);
}
);

// --- 10b. ESC skips a movie, and skips the whole chain with it ---
test("ESC skips a movie, and the rest of its chain with it", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("turk.set");
  const v = viewer();
  const settle = () => {
    for (let i = 0; i < 30 && v.moviePlaying; i++) v.tick((clock += 250));
  };

  // ESC as the engine sees it: TI.EXE's window proc hands it on as the
  // character "." with the special-key marker set (main.ts does the same).
  const esc = () => v.keyDown(".", true);

  // Every movie in the corpus carries the "ESC aborts" flag (MOV header +0x18
  // bit 0) — this pins that we read it rather than assume it.
  const flags = (name: string) => readMovFile(session.files(name)!).keySkips;
  check("menu.mov and turknmes.mov both allow the skip", flags("menu.mov") && flags("turknmes.mov"));

  // playmovie BLOCKS until the chain ends, so an abort has to resolve it — a
  // skip that only cleared the screen would hang the script that played it.
  let done = false;
  const playing = v.playMovie("menu.mov").then(() => { done = true; });
  settle();
  check("the menu movie is parked on its first region frame", v.moviePlaying);
  // the marker is what the filter tests, so a plain "." is a character
  check("a key during a movie is consumed by it", await v.keyDown("."));
  check("...and a plain '.' does not abort", v.moviePlaying);
  await v.keyDown("x", true);
  check("nor does a marked key the filter doesn't know", v.moviePlaying);
  await esc();
  check("ESC does", !v.moviePlaying);
  await playing;
  check("the blocked playmovie() resolved", done);

  // The one that matters for a cutscene: OK on turknmes.mov jumps to a pressed
  // frame and THEN exits, i.e. the movie has somewhere to go after the frame
  // you are on. An abort must not follow it.
  v.playMovie("turknmes.mov");
  settle();
  await esc();
  check("ESC leaves from a mid-chain frame without playing on", !v.moviePlaying);

  // With nothing playing the key is no longer the movie's: it goes down the
  // script chain as "." (boot's keydown forwards it to the scene, which
  // ignores it) rather than being swallowed by a host-level ESC handler.
  await esc();
  check("ESC with no movie up is harmless", !v.moviePlaying);
}
);

/**
 * `currentstage()` answers the stage's own NAME now, not its filename — and on
 * this disc those are the same string, which is the claim that has to hold.
 *
 * The field is a 16-byte Pascal string at 2104 of container 0 (`StgFile.refName`),
 * v4 only, and it went unread for as long as it did because Titanic fills it with
 * its own filename in every stage it ships. Timelapse does not: its `p.stg` is
 * called `"interface"` and its space bar tests for exactly that, so the panel
 * opened and could never be closed while the file was the answer.
 *
 * So this is the regression guard on the OTHER side of that change. If any stage
 * on this disc stored something else there, Titanic's own `currentstage()`
 * comparisons — `!= "bomb.stg"`, `!= "fence.stg"`, `= "main.stg"`, `!= "ctl.stg"`
 * — would have silently started failing, and each of those guards a door or a
 * panel rather than throwing anything.
 *
 * The two that do NOT match are named here rather than excused: `inven1.stg` and
 * `inven2.stg` both say `"inven.stg"`, and nothing compares `currentstage()`
 * against either — the inventory's own `switch currentstage()` runs after
 * `transfromflat()` has popped back to the stage underneath, so what it reads is
 * that stage's name and never its own.
 */
test("every stage on the disc stores the name currentstage() used to answer", async () => {
  const { session } = await newSession();
  // the two the inventory shares, by design: a name is not required to be unique
  const SHARED = new Map([
    ["inven1.stg", "inven.stg"],
    ["inven2.stg", "inven.stg"],
  ]);
  const names = [
    "main.stg", "map.stg", "ctl.stg", "tour.stg", "inven1.stg", "inven2.stg",
    "blkjack.stg", "bomb.stg", "enigma.stg", "wireless.stg", "trunk.stg",
  ];
  let checked = 0;
  for (const file of names) {
    const bytes = session.files(file);
    if (!bytes) continue; // a stage this edition does not carry
    const { refName } = readStgFile(bytes);
    check(`${file} names itself "${SHARED.get(file) ?? file}", not "${refName}"`,
      refName === (SHARED.get(file) ?? file));
    checked++;
  }
  check(`at least the five core stages were read (got ${checked})`, checked >= 5);
});

// --- 10c. the deck map's jump table, against MAP.STG itself ---
test("the deck map's jump table says what MAP.STG says", async () => {
  const { session } = await newSession();
  const stg = readStgFile(session.files("map.stg")!);
  check("eight deck plans", stg.flats.length === 8);

  // The table is generated (taoot/tools/mapjumps.ts) from the same file the engine
  // loads, so this is not "does the generator agree with itself": it re-derives
  // the regions here and checks the emitted table names a REAL region of the
  // page it claims, with the destination that region's script actually jumps to.
  // A decoder change that shifted a rectangle or a field would land here rather
  // than as a playthrough that clicks the wrong room three segments later.
  for (const jump of MAP_JUMPS) {
    const flat = stg.flats[jump.page - 1];
    const regions = readStgRegions(stg.file.containers[flat.locationClickLogic].data);
    const region = regions.find((r) => r.name === jump.region);
    check(`${jump.to}: "${jump.region}" is a region of plan ${jump.page}`, !!region);
    const script = scriptToText(sniffScript(stg.file.containers[region!.script].data)!);
    check(
      `${jump.to}: "${jump.region}" jumps there`,
      new RegExp(`jumpbaby \\("${jump.to}", "${jump.arrive[0]}", "${jump.arrive[1]}"\\)`, "i").test(script),
    );
    // and it is a jump a PLAYER can make: 15 of the 32 red areas sit behind
    // `if not debugging → exitcode` and do nothing in a shipped game
    check(`${jump.to}: "${jump.region}" is not debug-only`, !/if not debugging/i.test(script));
  }
  // what survives is stairwells — the plan takes you to the staircase on a deck,
  // not into a room, and a route walks from there
  check(
    "every reachable set is a staircase or a stair landing",
    [...new Set(MAP_JUMPS.map((j) => j.to))].every((s) => /^(g?stair|recept1c|turkstrs)/.test(s)),
  );

  // Every plan carries all eight page tabs and the one exit plaque — which is
  // what lets a route turn to any deck from any deck in a single click.
  for (const [i, flat] of stg.flats.entries()) {
    const names = new Set(readStgRegions(stg.file.containers[flat.locationClickLogic].data).map((r) => r.name));
    for (const b of MAP_PAGE_BUTTONS) check(`plan ${i + 1} has the tab for page ${b.page}`, names.has(b.region));
    check(`plan ${i + 1} has the exit plaque`, names.has(MAP_EXIT_REGION));
  }

  // mapdisabled() as the game writes it: the bag AND the watch, or no travel.
  const flow = { mission: 1 };
  const has = (held: string[]) => (p: string) => held.includes(p);
  check("no bag, no map", !mapUsable("c73", flow, has(["watch"])));
  check("no watch, no map", !mapUsable("c73", flow, has(["bag"])));
  check("both, and the map works", mapUsable("c73", flow, has(["bag", "watch"])));
  check("not from the boiler room", !mapUsable("boil", flow, has(["bag", "watch"])));
  check("and not while the ship is sinking", !mapUsable("c73", { mission: 4 }, has(["bag", "watch"])));
  // the guided tour is nothing but map jumps, so it overrides all of that
  check("the tour may always travel", mapUsable("boil", { mission: 4, tour: 1 }, has([])));
});

// --- 11. curtains (user-reported): silent open, endless toggle, OK exits ---
test("curtains (user-reported): silent open, endless toggle, OK exits", async () => {
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  sink.calls.length = 0;
  v.playMovie("curtains.mov");
  const settle = () => {
    for (let i = 0; i < 40 && v.moviePlaying; i++) v.tick((clock += 250));
  };
  settle();
  check("curtains open silently on the closed view", v.moviePlaying && sink.calls.length === 0);
  await v.click(230, 200); // the curtain (frame 1: x116..350 y82..354) -> opens
  settle();
  const openSound = sink.calls.length;
  check("curtain click plays sound + open animation", v.moviePlaying && openSound > 0);
  await v.click(140, 250); // left curtain edge (frame 8) -> closes again
  settle();
  check("second click closes the curtain", v.moviePlaying && sink.calls.length > openSound);
  await v.click(230, 200); // closed again (frame 15) -> jumps back, reopens
  settle();
  check("toggle repeats endlessly", v.moviePlaying);
  await v.click(455, 350); // OK at the open view (frame 8) -> exit animation
  settle();
  check("OK plays the exit animation and closes", !v.moviePlaying);
}
);

// --- 12. faucet: water cycle with per-frame sounds, OK-position exits ---
test("faucet: water cycle with per-frame sounds, OK-position exits", async () => {
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  sink.calls.length = 0;
  v.playMovie("faucet.mov");
  const settle = () => {
    for (let i = 0; i < 60 && v.moviePlaying; i++) v.tick((clock += 250));
  };
  settle();
  check("faucet opens silently on the off view", v.moviePlaying && sink.calls.length === 0);
  await v.click(220, 140); // the handle (frame 1: x171..274 y116..163) -> water runs
  settle();
  const sounds = sink.calls.filter((c) => c.channel === "sound").map((c) => c.seconds.toFixed(2));
  check(
    "water cycle fires on/babble/off sounds",
    v.moviePlaying && sounds.length === 3 && sounds[0] === "0.23" && sounds[1] === "3.62" && sounds[2] === "0.19",
    sounds.join(","),
  );
  await v.click(220, 140); // handle again (frame 38) -> the cycle replays
  settle();
  check(
    "handle replays the cycle",
    v.moviePlaying && sink.calls.filter((c) => c.channel === "sound").length === 6,
  );
  await v.click(455, 350); // bottom-right region on frame 38 -> steps out, exits
  settle();
  check("corner click leaves the faucet movie", !v.moviePlaying);
}
);

// --- 12a. the main menu's theme (user-reported: "I miss the main menu theme").
// An interactive movie's ONE-SHOT chunks are its event sounds (faucet, above),
// but a LOOP table is a scored bed and must play under the movie — PLAYMODE.MOV
// (the Game/Tour menu the boot stops at) carries nothing but that bed: one 8 s
// chunk listed 4x, no event sounds at all. It played only for regionless
// cutscenes, so the menu sat in silence.
test("main menu theme: an interactive movie's LOOP table plays as a bed", async () => {
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("bedsit1.set");
  const v = viewer();
  sink.calls.length = 0;
  v.playMovie("playmode.mov");
  for (let i = 0; i < 10 && !v.moviePlaying; i++) v.tick((clock += 250));
  const bed = sink.calls.filter((c) => c.channel === "voice");
  check(
    "the menu bed starts, looped, as the menu comes up",
    v.moviePlaying && bed.length === 1 && bed[0].loop && bed[0].seconds.toFixed(2) === "7.99",
    `plays=${JSON.stringify(sink.calls)}`,
  );
  // the GAME region starts the game: the movie closes and the bed goes with it
  sink.halts.length = 0;
  await v.click(266, 254);
  for (let i = 0; i < 30 && v.moviePlaying; i++) v.tick((clock += 250));
  check(
    "leaving the menu stops the bed",
    !v.moviePlaying && sink.halts.includes("voice") &&
      sink.calls.filter((c) => c.channel === "voice").length === 1,
    `halts=${sink.halts} plays=${JSON.stringify(sink.calls)}`,
  );
}
);

// --- 12a0. audio that starts before the AudioContext can exist. A browser
// only lets us build one from a user gesture, and a set can open before the
// player has clicked anything (drag-and-drop). One-shots dropped in that window
// are moments that have passed, but a LOOP is state the engine now believes is
// playing (currentThemeName), so nothing would ever start it: the room stayed
// silent until the next set change.
test("audio started while muted: loops survive to the unlock, one-shots don't", async () => {
  const deferred = new DeferredAudioSink();
  const pcm = (sec: number) => ({ sampleRate: 100, samples: new Float32Array(sec * 100) });
  const theme = deferred.play("theme", pcm(30), { loop: true });
  deferred.play("voice", pcm(3)); // a line spoken into the void — gone for good
  const loopSound = deferred.play("sound", pcm(2), { loop: true });
  check("a held loop reads as playing, not finished", !theme.done && !deferred.isDone("theme"));
  deferred.setChannelVolume("theme", 0.5); // the settings the boot applies meanwhile
  loopSound.stop(); // ...and a loop the game stopped again before the unlock

  const real = new NullAudioSink();
  deferred.attach(real);
  check(
    "the unlock starts the live loops only, at the volume asked for",
    real.calls.length === 1 && real.calls[0].channel === "theme" && real.calls[0].loop &&
      real.channelVolume.theme === 0.5,
    `calls=${JSON.stringify(real.calls)} vol=${real.channelVolume.theme}`,
  );
  // the handle handed out before the unlock still governs the real play
  theme.stop();
  check("halting reaches through to the started play", real.calls[0].stopped && theme.done);

  // and once attached it is a plain pass-through
  deferred.play("voice", pcm(1));
  check("after attach every play goes straight to the real sink", real.calls.length === 2);
}
);

// --- 12a1. a movie's event sounds die with the movie (user-reported: a spot
// movie between puppet lines "does not stop when OK is clicked, and overlaps
// the next sentence"). LENIN.MOV — Penny's Lenin aside, PENNY2.PUP 0006:
// `spotmovie("lenin.mov")` then straight into `puppetspeak("penny2.30")` —
// fires a 3.5 s spoken line (penny2.29) as its middle frame's ENTRY sound and
// then waits for the OK region. Click through early and that line used to run
// on over Penny's next sentence: event sounds play on the shared "sound"
// channel (next to room ambience, so the channel can't just be halted) and
// nothing stopped them.
test("a movie's event sounds stop when the movie does (LENIN.MOV over Penny)", async () => {
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  sink.calls.length = 0;
  v.playMovie("lenin.mov");
  // frame 0 steps itself into frame 1, whose entry sound is the spoken line
  for (let i = 0; i < 20 && sink.calls.length === 0; i++) v.tick((clock += 100));
  const line = sink.calls.find((c) => c.channel === "sound");
  check(
    "the middle frame speaks Penny's line",
    !!line && line.seconds.toFixed(2) === "3.53" && !line.stopped,
    `calls=${JSON.stringify(sink.calls)}`,
  );
  // OK (region 423..500 x 333..376) long before the 3.5 s line is over
  await v.click(460, 350);
  for (let i = 0; i < 20 && v.moviePlaying; i++) v.tick((clock += 100));
  check(
    "clicking OK ends the movie AND cuts its line",
    !v.moviePlaying && !!line?.stopped,
    `playing=${v.moviePlaying} line=${JSON.stringify(line)}`,
  );
}
);

// --- 12a1b. ...and the other half: a CUTSCENE keeps its line to the end
// (user-reported: "the audio of the sequence where we are lowered in the lifeboat
// 'Tell them we did our best, tell them...' is cut. Is it possible that sound is
// cut when the movie has no more frames to play?" — yes, it was).
//
// leave.mov's FIRST SEGMENT is 70 frames with no regions anywhere. Frame 41
// fires Morrow's `morrow2.83`, 3.34 s, and pacing it off the 5.57 s `cloop3`
// bed entered that frame at 3.26 s and ended the film at 5.57 s, cutting the
// line 1.03 s short. Nobody dismissed anything; the film ran out. The stop in
// finish() belongs to the LENIN case above, where the PLAYER clicks past a
// line, and an interactive clip is what that case always is.
//
// The file does not stop there: it is TEN segments, 1628 frames — the whole
// sinking montage (MovFile.segments; the port played segment 0 and called it
// the movie, which is where "leave.mov alone is 37.5 MB" for 70 frames came
// from). Segment 0's exit now leads to segment 1, so this also pins the
// transition: the film keeps playing past the old truncation point, and the
// line is intact when it does.
test("a cutscene's line outlives the last frame, and the next film (leave.mov)", async () => {
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  sink.calls.length = 0;
  v.playMovie("leave.mov");
  // run past segment 0: segment 1's first frame fires an event sound of its
  // own ("mb 11k"), so a THIRD sound-channel play means the transition
  // happened — and happened without finish() running (which would have
  // stopped the line, the regression this test exists for)
  const sounds = () => sink.calls.filter((c) => c.channel === "sound").length;
  for (let i = 0; i < 1500 && sounds() < 3; i++) v.tick((clock += 100));

  // Both of segment 0's event sounds, by the frame that fires them — NOT by a
  // duration window. Frame 2 fires "Track 87.SE" (3.07 s, the davits) and
  // frame 41 fires "morrow2.83" (3.34 s, the line), and a `find` for 3–4 s
  // matches the DAVITS: this test used to assert about the wrong sound
  // entirely, and would have passed with Morrow's line cut to nothing.
  const fired = sink.calls.filter((c) => c.channel === "sound");
  check(
    "segment 0's two event sounds fired, in frame order",
    fired.length >= 2 && fired[0].seconds > 3.0 && fired[0].seconds < 3.1 && fired[1].seconds > 3.3,
    `sounds=${JSON.stringify(fired.map((c) => +c.seconds.toFixed(2)))}`,
  );
  // NOT `!line.displaced`: segment 1's own sound legitimately takes the
  // shared channel over — after frame 68's waitsForVoice held segment 0 open
  // for the line to finish. The sink cannot tell succession from a cut (its
  // own docs draw that line); a STOP is what finish() would have done.
  const line = fired[1];
  check(
    "the film plays on past its first segment, and nothing STOPPED the line",
    v.moviePlaying && sounds() >= 3 && !!line && !line.stopped,
    `playing=${v.moviePlaying} sounds=${sounds()} line=${JSON.stringify(line)}`,
  );
  // The davits DO get cut, by the line itself — one "sound" channel, and the
  // engine gives it to whoever speaks last. That is the original's behaviour and
  // the reason the channel cannot simply be halted at movie end.
  check("...and the davits gave the channel up to it", fired[0].displaced, JSON.stringify(fired[0]));

  // Now the whole film: nine more segments, 1628 frames on their authored
  // holds. The line must come through it never STOPPED — later segments'
  // own event sounds displace it on the shared channel, but only after
  // frame 68's waitsForVoice has held segment 0 open for it to finish, so a
  // displacement here is succession, not a cut (the sink's own docs draw
  // that distinction).
  for (let i = 0; i < 6000 && v.moviePlaying; i++) v.tick((clock += 100));
  check("the whole ten-segment film runs out", !v.moviePlaying, `still playing, sounds=${sounds()}`);

  // The endgame does not stop here: BOOTFILE 0002's `clock = "endgame"` arm runs
  // leave.mov -> clut/blackscreen -> debris.mov with nothing in between.
  v.playMovie("debris.mov");
  for (let i = 0; i < 2000 && (v.moviePlaying || i < 2); i++) v.tick((clock += 100));
  check(
    "and the film that follows it never STOPS the line",
    !v.moviePlaying && !line.stopped,
    `playing=${v.moviePlaying} line=${JSON.stringify(line)}`,
  );
}
);

// --- 12a1c. a cutscene's bed outlasts the PICTURE, not the prediction
// (user-reported, the fly-in to C73: "just before we reach the cabin, the audio
// is cut and the fly in scene goes on for 1-2 seconds, then the next scene starts
// with the Titanic horn playing").
//
// The bed was cut to `interval x frames`, which assumes every frame arrives the
// instant it is due. Frames advance on ticks — `now - lastTick >= interval` — so a
// tick granularity that does not divide the interval makes every frame cost the
// next whole tick, which is exactly what a display refresh is. Driven at 16.7 ms
// (60 Hz), ocredits.mov's 1225 frames take 81.85 s against a predicted 80.85 s:
// one second of picture past the end of its own soundtrack. opentour.mov overruns
// by 2.70 s. The margin + loop in play() is what covers it.
test("a cutscene's soundtrack outlasts an overrunning film (60 Hz ticks)", async () => {
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();

  // 367 frames paced on its 27.96 s bed: the cheap case that still overruns.
  sink.calls.length = 0;
  const t0 = clock;
  v.playMovie("opentour.mov");
  // 16.7 ms, NOT a divisor of the frame interval — a real refresh, not a
  // conveniently aligned one. A test that ticks in exact multiples of the
  // interval cannot see this bug at all.
  for (let i = 0; i < 40000 && (v.moviePlaying || i < 2); i++) v.tick((clock += 16.7));
  const ran = (clock - t0) / 1000;

  const bed = sink.calls.find((c) => c.channel === "voice");
  check("the film has a bed", !!bed, `calls=${JSON.stringify(sink.calls.map((c) => c.channel))}`);
  check(
    "the film really does overrun its predicted runtime",
    ran > 28.5,
    `ran=${ran.toFixed(2)}s, predicted ~27.96s`,
  );
  check(
    "and the bed still covers the picture, to the last frame",
    !!bed && (bed.loop || bed.seconds >= ran),
    `bed=${bed?.seconds.toFixed(2)}s loop=${bed?.loop} film=${ran.toFixed(2)}s`,
  );
}
);

// --- 12a2. the end of a movie only ARMS the reveal (user-reported: the cold
// boot showed the bedsit fully lit for a moment, then blacked out and faded the
// same room back in). blackscreen() is a one-shot paint in TI.EXE and a
// retained level here, so clearing it the instant a movie ends flashed whatever
// the script was still setting up under the black — the boot opens the flat and
// plays the date caption between the menu movie and advanceday's blacktoscreen.
// The black must survive until no script dispatch is left in flight, and any
// fade the script does establish cancels the pending reveal outright.
test("movie end: the reveal waits for the script, and a fade cancels it", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  const settle = () => {
    for (let i = 0; i < 60 && v.moviePlaying; i++) v.tick((clock += 250));
  };
  const call = (name: string, args: unknown[] = []): void => {
    void session.interp.builtins.get(name)!(
      session.interp, args as never, { me: "", target: "" } as never, undefined as never,
    );
  };
  // the boot's shape: black, a cutscene over it, and a script still running
  call("blackscreen");
  let release = (): void => {};
  const busy = session.track(new Promise<void>((r) => (release = r)));
  v.playMovie("datebed.mov");
  settle();
  v.tick((clock += 250));
  check(
    "the black survives the movie while the script is still running",
    session.fade.level === 1 && session.fade.pendingReveal,
    `level=${session.fade.level} pending=${session.fade.pendingReveal}`,
  );
  // ...and what the script goes on to say about the screen wins
  call("blackscreen");
  check("blackscreen cancels the pending reveal", !session.fade.pendingReveal);
  call("blacktoscreen", ["set", 60]);
  v.tick((clock += 250));
  check(
    "the room fades in from black rather than snapping in",
    session.fade.level < 1 && session.fade.level > 0.9,
    `level=${session.fade.level}`,
  );
  session.fade.queue.length = 0;
  session.fade.level = 1;

  // the other shape (bomb.stg's openstage: blackscreen -> intro movie ->
  // setvisible(false), no fade ever): the reveal lands once the script is quiet
  v.playMovie("datebed.mov");
  settle();
  v.tick((clock += 250));
  check("still black while the dispatch is in flight", session.fade.level === 1);
  release();
  await drain();
  v.tick((clock += 250));
  check(
    "the black lifts once nothing is left running",
    session.fade.level === 0 && !session.fade.pendingReveal,
    `level=${session.fade.level} busy=${session.scriptBusy}`,
  );
}
);

// --- 12b. actionframe(n): the movie header's action-frame names (container-0
// +0x40/+0x50) are tracked during playback; the car-light toggle (BIND/BINL)
// and the purser window both branch on it. LIGHTOFF.MOV names "lightson" as
// action frame 1: turning the light on traverses it (actionframe(1) true ->
// carlights -> binl); leaving it off never does (actionframe(1) false -> bind).
test("actionframe(n): the movie header's action-frame names (container-0", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("turk.set"); // any set; movie loads via provider
  const v = viewer();
  const settle = () => {
    for (let i = 0; i < 60 && v.moviePlaying; i++) v.tick((clock += 250));
  };
  const af = () => [session.movieActions.has(1), session.movieActions.has(2)];

  session.movieActions.clear();
  v.playMovie("lightoff.mov");
  settle();
  await v.click(220, 230); // the light switch (center) -> starts the turn-on anim
  settle();
  await v.click(456, 350); // HEAD16 bottom-right -> "lightson" -> exit (light ON)
  settle();
  const on = af();
  check("actionframe: turning the car light on sets actionframe(1)", on[0] && !on[1], `af=${on}`);

  session.movieActions.clear();
  v.playMovie("lightoff.mov");
  settle();
  await v.click(456, 350); // immediate OK from HEAD1 -> "HEAD 18" (light stays OFF)
  settle();
  const off = af();
  check("actionframe: leaving the light off clears actionframe(1)", !off[0] && !off[1], `af=${off}`);

  // MAINC.MOV names openit/endit (n=1/2): knocking chains through pursopen -> action set
  session.movieActions.clear();
  v.playMovie("mainc.mov");
  settle();
  await v.click(250, 190); // knock the window -> "openit" (action 1) -> pursopen -> exit
  settle();
  const knock = af();
  check("actionframe: knocking the purser window sets an action frame", knock[0] || knock[1], `af=${knock}`);
}
);

// --- 12c. clut/mixclut: the darkroom light switch dims the CABIN palette
// (mixclut "set" blends the set CLUT toward black; clut "set" restores it).
// The C78 white-light switch does mixclut("set","black",0,127,240). clut("black")
// must stay a no-op (it's paired with blackscreen() in movie transitions).
test("clut/mixclut: the darkroom light switch dims the CABIN palette", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("c78.set");
  const v = viewer();
  // average brightness of palette entries 0-127 (the range the switch dims)
  const bright = (): number => {
    const p = (v as unknown as { palette: Uint8ClampedArray }).palette;
    let s = 0;
    for (let i = 0; i < 128; i++) s += p[i * 4] + p[i * 4 + 1] + p[i * 4 + 2];
    return Math.round(s / 128);
  };
  const call = (name: string, args: unknown[]): void => {
    void session.interp.builtins.get(name)!(
      session.interp, args as never, { me: "", target: "" } as never, undefined as never,
    );
  };
  const lit = bright();
  call("mixclut", ["set", "black", 0, 127, 240]);
  const dark = bright();
  call("clut", ["set"]);
  const restored = bright();
  call("clut", ["black"]); // must NOT dim
  const afterBlack = bright();
  check(
    "clut/mixclut: the light switch dims the cabin, clut restores, clut(black) is a no-op",
    lit > 100 && dark < lit * 0.25 && restored === lit && afterBlack === lit,
    `lit=${lit} dark=${dark} restored=${restored} afterBlack=${afterBlack}`,
  );
  // And by HOW much, which is the display gamma's doing and worth pinning rather
  // than bounding loosely. `mixclut(…,240)` scales the CLUT by (255-240)/255 = 5.9%
  // in the palette's own space; the screen then shows `pow(0.059, 0.65)` = 15.9% of
  // the lit picture, because the gamma is applied AFTER the dim exactly as TI.EXE
  // applies it after everything (see engine/src/web/screen-gamma.ts). This test read ~6% while
  // the port rendered the palette verbatim — the darkroom used to go almost pitch
  // black where the original only drops it to a sixth (#115).
  const predicted = Math.pow((255 - 240) / 255, screenGamma());
  check(
    "clut/mixclut: and the dim lands where the display gamma puts it",
    Math.abs(dark / lit - predicted) < 0.02,
    `dark/lit=${(dark / lit).toFixed(4)} vs pow(15/255, ${screenGamma()})=${predicted.toFixed(4)}`,
  );
}
);

// --- 12d. darkroom stage darkness: entering redphoto.stg with the white light
// off starts DARK (you must switch on the red safelight before handling photos);
// the safelight toggles the stage CLUT; leaving doesn't leak the dim onward.
test("darkroom stage darkness: entering redphoto.stg with the white light", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("c78.set");
  const v = viewer();
  // the stage dim lives on the SCREEN now (ScreenDirector), not on the room
  // standing in front of it — a stage outlives any one set
  const stageDark = (): boolean =>
    (v.dir as unknown as { stageDim: unknown }).stageDim !== null;
  const call = (name: string, args: unknown[]): void => {
    void session.interp.builtins.get(name)!(
      session.interp, args as never, { me: "", target: "" } as never, undefined as never,
    );
  };
  session.interp.globals.set("whitelight", "off"); // player killed the cabin light
  await session.transToFlat("redphoto.stg");
  const onEntry = stageDark();
  call("clut", ["stage"]); // red safelight on -> room lit
  const lampOn = stageDark();
  call("mixclut", ["stage", "black", 0, 255, 245]); // safelight off -> room dark
  const lampOff = stageDark();
  await session.transToFlat("cuff.stg"); // leave: dim must not bleed to the next stage
  const afterLeave = stageDark();
  check(
    "darkroom: enters dark (safelight off), safelight toggles the stage CLUT, no leak on exit",
    onEntry && !lampOn && lampOff && !afterLeave,
    `entry=${onEntry} lampOn=${lampOn} lampOff=${lampOff} afterLeave=${afterLeave}`,
  );
}
);

// --- 13. grand staircase: deck flips + cross-set travel (user-reported) ---
test("grand staircase: deck flips + cross-set travel (user-reported)", async () => {
  const { session, viewer } = await newSession();
  const state = () => {
    const v = viewer();
    return `${session.currentSetName} ${v.scene.sceneName}/${v.scene.views[v.viewIdx].viewName}`;
  };
  // B deck, down the stairs: keydown interceptor lives in the SET MAIN
  // script (scene13 has no script container). It flips savedeck to "c",
  // changesets to the Scene65 deck-transition arrival spot (targeting the
  // shipped typo "view79" — facing-continuity fallback lands on View69), then
  // PASSCODEs so boot's default walk carries you off that transition scene into
  // the C-deck landing (Scene50/View54, via Road75) — same walk-through pattern
  // as the recept1c exit below.
  await session.openSetFile("gstair3.set");
  session.interp.globals.set("savedeck", "b");
  viewer().jumpTo("Scene13", "View33");
  await viewer().keyDown("uparrow");
  await runAnimations(viewer());
  check(
    "gstair3 B-deck stairs flip to C deck landing",
    state() === "gstair3 Scene50/View54" && session.interp.globals.get("savedeck") === "c",
    `${state()} savedeck=${session.interp.globals.get("savedeck")}`,
  );
  // C deck, down again: leads to the reception set. gstair3's keydown does
  // gotospecial(recept1c, scene102, view104) then PASSCODEs, so boot's default
  // walk carries you off the scene102 arrival spot into the reception hall
  // (Scene10/View88) — the walk fires on the NEW viewer via the re-armed hooks.
  await session.openSetFile("gstair3.set");
  session.interp.globals.set("savedeck", "c");
  viewer().jumpTo("Scene13", "View33");
  await viewer().keyDown("uparrow");
  await runAnimations(viewer());
  check("gstair3 C-deck stairs reach recept1c hall", state() === "recept1c Scene10/View88", state());
  // B deck, walk UP: road to Scene64, arrival openscene forwards to gstair2
  await session.openSetFile("gstair3.set");
  session.interp.globals.set("savedeck", "b");
  viewer().jumpTo("Scene50", "View54");
  viewer().walk();
  await runAnimations(viewer());
  check("gstair3 walk up reaches gstair2", state() === "gstair2 Scene17/View49", state());
}
);

// --- 13b. 2nd class staircase: the landing turns 90°, and down is down -------
// (user-reported: "going all the way down ends up teleported to the top again")
// STAIR2C is the only SET in the game whose keydown takes leftarrow/rightarrow:
// its two landing scenes carry EIGHT views — the four standpoints that have
// somewhere to go, interleaved with four corner views — so one press turns
// TWICE and exitcodes. Binding the arrows straight to viewer.turn() (main.ts
// did) skipped that and stopped you on the corners, where forward does nothing
// and the stairs-UP standpoint (deck +1) sits where the player expects the next
// one round — so walking "down" the ship walked you up it, deck after deck,
// until the wrap ran out at A deck and the flight above the landing dumped you
// on the boat deck. Both facts are asserted here: the press granularity, and a
// descent that actually descends.
test("2nd class staircase: landings turn 90°, and down goes down (user-reported)", async () => {
  const { session, viewer } = await newSession();
  const where = (): string => {
    const v = viewer();
    return `${v.scene.sceneName}/${v.scene.views[v.viewIdx].viewName}`;
  };
  const deck = (): string => String(session.interp.globals.get("savedeck"));
  // No nextFrame wiring here on purpose: the landing's turn spins
  // `while currentview() = "moving" forceupdate() endwhile`, and the host is
  // what renders the frame that ends it (GameHost's nextFrame). A test that had
  // to wire its own frame source would be proving the wiring, not the game.
  await session.openSetFile("stair2c.set");
  session.interp.globals.set("savedeck", "c");
  session.interp.globals.set("mission", 1);
  session.interp.globals.set("phase", 1);

  // One press per standpoint, all the way round: the C-deck landing's ring is
  // View50, View70, View52, View72, View51, View71, View53, View73, and the
  // player must only ever stop on the even ones. The nav arrow is why it
  // matters — every corner reads RED (nothing ahead), so on 45° stops half the
  // stops are dead ends, and the first arrow that isn't red as you turn away
  // from the corridor is View51's GREEN, which walks you UP a deck.
  viewer().jumpTo("Scene42", "View52");
  const ring: string[] = [];
  for (let i = 0; i < 4; i++) {
    await viewer().pressNav("rightarrow");
    await runAnimations(viewer());
    ring.push(`${where()}/${session.propRuntime.get("navarrow")?.stateName}`);
  }
  check(
    "the landing turns 90° a press — the four standpoints, no corners",
    ring.join(" ") ===
      "Scene42/View51/green Scene42/View53/yellow Scene42/View50/red Scene42/View52/green",
    ring.join(" "),
  );

  // Now walk down: the corridor to Scene41, the flight to Scene12 and Scene11,
  // and at Scene11/View18 the keydown wrap flips savedeck one deck DOWN and
  // teleports to the flight below (Scene43), whose road carries you onto the
  // next landing. Four presses, one deck.
  const trail: string[] = [];
  for (const [scene, view] of [
    ["Scene42", "View52"], ["Scene41", "View47"], ["Scene12", "View25"], ["Scene11", "View18"],
  ]) {
    viewer().jumpTo(scene, view); // face the way down (turning is asserted above)
    await viewer().pressNav("uparrow");
    await runAnimations(viewer());
    trail.push(`${where()}@${deck()}`);
  }
  check(
    "one flight down from the C deck landing arrives on the D deck landing",
    where() === "Scene42/View50" && deck() === "d",
    trail.join(" -> "),
  );

  // The treadmill has a floor: from E deck nextdeck("down") is "", so the wrap
  // does NOT fire and the intercept passes the key through — boot's default walk
  // takes Road31 into the flight below the bottom landing (Scene10), which is
  // how the stairs reach F deck at all.
  session.interp.globals.set("savedeck", "e");
  viewer().jumpTo("Scene11", "View18");
  await viewer().pressNav("uparrow");
  await runAnimations(viewer());
  check(
    "below E deck the wrap gives out and the real flight to F deck opens",
    where() === "Scene10/View14",
    `${where()} savedeck=${deck() || "''"}`,
  );
}
);

// --- 13c. lockevents freezes the world (clicks too, not just keys) -----------
// The scripts set `lockevents` when the game is doing something TO you and an
// interruption would break it: bedsit1's air raid (`gotowin` turns the camera to
// the window itself, then bombs the flat), the turbine puzzle's OK (its trigger
// loop runs after the flat closes), Vlad walking up to start the fight,
// `narend.stg`. BOOTFILE honours it in both input handlers — keydown and
// mousedown — and the port only got the keydown half for free, by routing keys
// through the chain. Clicks are dispatched natively, so they walked straight
// through every one of those windows.
test("lockevents freezes the world: clicks and keys, but not a conversation", async () => {
  const { session, viewer } = await newSession();
  const doorShut = (): boolean => session.propRuntime.get("door")?.visible === false;
  const aimDoor = (): [number, number] => {
    const obj = viewer().scene.views[viewer().viewIdx].objects[0];
    return [
      Math.floor((obj.startRegionX + obj.endRegionX) / 2),
      Math.floor((obj.startRegionY + obj.endRegionY) / 2),
    ];
  };
  // One room, one door, one flag: locked first (so the door starts shut), then
  // the identical gesture unlocked. Re-opening the same set does NOT reset its
  // props, so this is the only order in which the flag is the only difference.
  await session.openSetFile("b59.set");
  await runAnimations(viewer());
  session.interp.globals.set("lockevents", 1);
  const shutBefore = doorShut();
  const cursor = await viewer().hover(...aimDoor());
  await session.track(viewer().click(...aimDoor()));
  await runAnimations(viewer());
  const clickRefused = shutBefore && doorShut();
  await viewer().pressNav("uparrow"); // boot1's keydown gate — was already right
  await runAnimations(viewer());
  const stayedPut = session.currentSetName === "b59";

  session.interp.globals.set("lockevents", 0);
  await session.track(viewer().click(...aimDoor()));
  await runAnimations(viewer());
  const opened = session.propRuntime.get("door")?.visible === true;
  check(
    "locked: the click is refused, forward is refused, the cursor says watch",
    clickRefused && stayedPut && cursor === "watch" && opened,
    `shutBefore=${shutBefore} refused=${clickRefused} stayed=${stayedPut} ` +
      `cursor=${cursor} unlockedOpens=${opened}`,
  );

  // ...but a conversation still answers: boot1 tests the puppet BEFORE the gate,
  // which is what lets csea thank you for the turbine while the world is frozen.
  await session.puppetCtrl.openPuppetFile("morrow1.pup");
  const puppetUp = session.puppet?.visible === true;
  const overPuppet = await viewer().hover(256, 120);
  check(
    "locked: a visible puppet is still ahead of the gate",
    puppetUp && overPuppet !== "watch",
    `puppet visible=${puppetUp} cursor over it=${overPuppet}`,
  );
}
);

// --- 13d. the event queue: input made mid-gesture waits, it isn't dropped ----
// TI.EXE keeps an event queue (32 slots, recovered in engine/src/runtime/input.ts) and the
// port had none: `turn()`/`walk()` refuse while a move is on screen and the
// press was simply gone, and `flushevents()` — which the scripts call in 92
// places to discard input they don't want to inherit — had nothing to discard.
// Note what this is NOT: a *held* key always worked, because a browser repeats
// it and every repeat that lands on an idle frame dispatches. What was lost is a
// single press or click made while something was moving.
test("the event queue: input made mid-gesture waits its turn", async () => {
  const { session, viewer } = await newSession();
  const at = (): string =>
    `${viewer().scene.sceneName}/${viewer().scene.views[viewer().viewIdx].viewName}`;
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 1500 && (viewer().busy || session.scriptBusy || session.events.length); i++) {
      viewer().tick((clock += 100));
      await drain();
    }
  };

  // hallb is a straight corridor: each arrival faces the next road, so four
  // presses one engine frame apart is four rooms' worth of intent arriving while
  // the first walk is still on screen.
  await session.openSetFile("hallb.set");
  await settle();
  viewer().jumpTo("Scene31", "View50");
  const from = at();
  for (let i = 0; i < 4; i++) {
    void session.track(viewer().pressNav("uparrow"));
    viewer().tick((clock += 100));
    await drain();
  }
  await settle();
  check(
    "a press made during a walk is taken when the walk ends (two rooms, not one)",
    at() === "Scene29/View42",
    `${from} -> ${at()} posted=${session.events.posted} taken=${session.events.taken} ` +
      `dropped=${session.events.dropped}`,
  );
  check(
    "...and a burst collapses instead of piling up: one press stays pending",
    session.events.posted === 3 && session.events.taken === 1 && session.events.length === 0,
    `posted=${session.events.posted} taken=${session.events.taken} pending=${session.events.length}`,
  );

  // The SAME burst on the movement letter. W/A/D are not a second way to walk in
  // the original — they are the walk, and the arrows are its other name: TI.EXE
  // queues in the window proc and pops in the main loop, both above any notion of
  // which key it was, and BOOTFILE 0001's `keydown` only translates the letter
  // afterwards, reading `keynorth`/`keywest`/`keyeast` (W/A/D by default, and
  // rebindable from the control panel). The port kept its gate in `pressNav`,
  // which only the three arrow NAMES reach, so this burst walked one room while
  // the arrow burst above walked two.
  viewer().jumpTo("Scene31", "View50");
  // by hand because the harness never runs `code boot`, which is where BOOTFILE
  // sets the three bindings (0001: `keynorth = "w"`)
  session.interp.globals.set("keynorth", "w");
  const wFrom = at();
  const wTaken = session.events.taken;
  for (let i = 0; i < 4; i++) {
    void session.track(viewer().keyDown("w"));
    viewer().tick((clock += 100));
    await drain();
  }
  await settle();
  check(
    "the movement LETTER queues the same way the arrow does (w, not uparrow)",
    at() === "Scene29/View42" && session.events.taken === wTaken + 1,
    `${wFrom} -> ${at()} taken=${session.events.taken} (was ${wTaken})`,
  );

  // a click made while the camera moves is kept too — what it then lands on is
  // whatever is under the cursor at that point, exactly as in the original
  viewer().jumpTo("Scene31", "View50");
  const takenBefore = session.events.taken;
  void session.track(viewer().pressNav("uparrow"));
  viewer().tick((clock += 100));
  await drain();
  const midWalk = viewer().busy;
  void session.track(viewer().click(210, 266));
  const queuedIt = session.events.has("mousedown");
  await settle();
  check(
    "a click made during a walk is queued and dispatched, not dropped",
    midWalk && queuedIt && session.events.taken === takenBefore + 1 && session.events.length === 0,
    `midWalk=${midWalk} queued=${queuedIt} taken=${session.events.taken} (was ${takenBefore})`,
  );

  // flushevents(): the 92 call sites, now load-bearing
  session.events.post({ kind: "mousedown", x: 10, y: 10 });
  session.events.post({ kind: "keydown", key: "uparrow", special: false });
  const before = session.events.length;
  void session.interp.builtins.get("flushevents")!(
    session.interp, [] as never, { me: "", target: "" } as never, undefined as never,
  );
  check(
    "flushevents() discards what is waiting",
    before === 2 && session.events.length === 0,
    `before=${before} after=${session.events.length}`,
  );

  // and the queue's own policies, straight from the binary: 32 slots, and a
  // coalescing post replaces the pending copy of the same event
  const q = new EventQueue();
  for (let i = 0; i < 40; i++) q.post({ kind: "mousedown", x: i, y: 0 });
  const capped = q.length;
  const oldest = q.take();
  q.flush();
  for (let i = 0; i < 5; i++) q.post({ kind: "keydown", key: "uparrow", special: false }, { coalesce: true });
  q.post({ kind: "keydown", key: "leftarrow", special: false }, { coalesce: true });
  check(
    "32 slots (TI.EXE's 0x20), oldest out first, and coalescing keeps one per key",
    capped === EVENT_CAPACITY && (oldest as { x: number }).x === 0 && q.length === 2,
    `capped=${capped} oldest=${JSON.stringify(oldest)} afterCoalesce=${q.length}`,
  );
}
);

// --- 13e. a movie owns the queue: it flushes on the way in and on the way out -
// User-reported (#5): clicking the sofa in c73 a few more times while its
// close-up loaded re-opened the close-up once per impatient click — the clicks
// were banked by the ordinary mid-gesture rule (13d) and then replayed into the
// room the moment the movie closed. The original never lets them get that far:
// `playmovie` reads the .MOV containers and calls flushevents unconditionally
// before its playback loop (TI.EXE 0x449104), and flushes again at teardown
// unless the film asked for any input to abort it (0x449330, header flags bit 3
// — which nothing in TAOOT sets).
test("a movie flushes the event queue on both sides (#5)", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  const settle = () => {
    for (let i = 0; i < 60 && v.moviePlaying; i++) v.tick((clock += 250));
  };

  // three impatient clicks on the sofa while its close-up fetches — exactly what
  // SetViewer.clickDispatch banks whenever a gesture is already running
  for (let i = 0; i < 3; i++) session.events.post({ kind: "mousedown", x: 453, y: 354 });
  const banked = session.events.length;
  const takenBefore = session.events.taken;
  v.playMovie("c73sofa.mov");
  const afterStart = session.events.length;
  check(
    "starting a movie discards what the load banked",
    banked === 3 && afterStart === 0,
    `banked=${banked} pending after start=${afterStart}`,
  );

  // ...and the click that dismisses it dies with it. c73sofa is three frames:
  // the OK region on frame 1 advances to frame 2, whose own action exits.
  settle();
  const played = v.moviePlaying;
  session.events.post({ kind: "mousedown", x: 453, y: 354 });
  await v.click(456, 351);
  settle();
  // give the drain in tick() every chance to replay anything still waiting
  for (let i = 0; i < 20; i++) {
    v.tick((clock += 250));
    await drain();
  }
  check(
    "leaving a movie leaves nothing to replay into the room behind it",
    played && !v.moviePlaying && session.events.length === 0 &&
      session.events.taken === takenBefore,
    `played=${played} stillPlaying=${v.moviePlaying} pending=${session.events.length} ` +
      `taken=${session.events.taken} (was ${takenBefore})`,
  );
}
);

// --- 13f. #146: a set change holds the screen, it does not show the matte ---
// User-reported as a "white flash" climbing the grand staircase. It is neither
// white nor a flash: main.stg's flat fills the whole 512x264 view region with
// palette index 253, which in that flat's own palette is a cream — the matte the
// room view is composited into. While a set change is in flight the departing
// room's bytes are already handed back (GameHost.activateSet releases before the
// arriving viewer exists), so there is no frame to cover it, and the matte was
// painted for the length of the load — 2.47 s in the report's video, measured
// there at (247,241,222).
//
// TI.EXE never has that state: screentoblack is a palette ramp, so the departing
// room's pixels stay in the framebuffer until the arriving room's overwrite them.
// Holding the screen is that behaviour.
test("a set change holds the last frame instead of exposing the flat's matte (#146)", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("gstair2.set");
  const v = viewer();

  // what the matte IS — the reason the flash was cream and not white
  const flat = session.stageCtrl.flatImage()!;
  const idx = flat.pixels[100 * flat.width + 256]; // inside the view region
  const pal = displayPalette(flat.palette);
  const matte = [pal[idx * 4], pal[idx * 4 + 1], pal[idx * 4 + 2]];
  check(
    "main.stg's view region is a solid cream matte, not black",
    idx === 253 && matte[0] > 200 && matte[1] > 200 && matte[2] > 200,
    `idx=${idx} rgb=(${matte.join(",")})`,
  );

  // the ordinary case still paints
  const withView = (v as never as { paintWorldInto(): string | null }).paintWorldInto();
  check(
    "with a room view to composite, the flat path paints as before",
    withView === "flat" && session.viewShowing,
    `drew=${withView} viewShowing=${session.viewShowing}`,
  );

  // mid-set-change: the room is expected, the frame is gone
  (v as never as { current: unknown }).current = null;
  const midChange = (v as never as { paintWorldInto(): string | null }).paintWorldInto();
  check(
    "with the room expected but no frame, nothing is painted — the screen holds",
    midChange === null && session.viewShowing,
    `drew=${midChange} viewShowing=${session.viewShowing}`,
  );

  // ...and a flat that legitimately owns the screen (setvisible(false) — the map,
  // the CTL panel, an inventory) still paints. It has to be a REAL flat: main.stg
  // with the room hidden is a bare matte, which is the bug itself (see 13g), so
  // the distinction is drawn on the flat's own pixels rather than on setVisible.
  (session as never as { setVisible: boolean }).setVisible = false;
  await session.stageCtrl.openStageFile("tour.stg");
  const flatOnly = (v as never as { paintWorldInto(): string | null }).paintWorldInto();
  check(
    "a real flat with the room hidden still paints on its own",
    flatOnly === "flat" && !session.viewShowing,
    `drew=${flatOnly} viewShowing=${session.viewShowing}`,
  );
}
);

// --- 13g. #146 again: the matte must never be shown bare -------------------
// The first fix (13f) guarded "the room is expected and there is no frame", and
// missed the window that actually bites: `changeset` runs `closesetfile` FIRST,
// which sets currentSetName to "none", so viewShowing goes false while the
// departing room's frame is still in hand — the view blit is skipped and
// main.stg's matte is bare for the whole crossing. Walking gstair3 Scene50/View53
// into the next set, 109 of 120 painted frames were matte-coloured.
//
// The rule is now on the FLAT, not on engine state: a view region that is one
// flat colour is a hole, and a hole is never drawn without something in it.
test("a set crossing never shows the flat's matte (#146)", async () => {
  const walk = async (setFile: string, scene: string, view: string) => {
    const { session, viewer } = await newSession();
    await session.openSetFile(setFile);
    const v = viewer();
    const step = async (): Promise<void> => {
      v.tick((clock += 50));
      await drain();
    };
    for (let i = 0; i < 400 && (v.busy || session.scriptBusy); i++) await step();
    v.jumpTo(scene, view);
    for (let i = 0; i < 400 && (v.busy || session.scriptBusy); i++) await step();
    let bright = 0, painted = 0, held = 0, sawNoSet = false;
    void session.track(v.pressNav("uparrow"));
    for (let i = 0; i < 120; i++) {
      await step();
      if (session.currentSetName === "none") sawNoSet = true;
      const drew = (viewer() as never as { paintWorldInto(): string | null }).paintWorldInto();
      if (!drew) { held++; continue; }
      painted++;
      const buf = (viewer() as never as { screen: { frame: Uint8ClampedArray } }).screen.frame;
      const d = (100 * SCREEN_W + 256) * 4;
      if (buf[d] > 180 && buf[d + 1] > 180 && buf[d + 2] > 150) bright++;
    }
    return { bright, painted, held, sawNoSet };
  };

  const a = await walk("gstair3.set", "Scene50", "View53");
  check(
    "walking out of gstair3 Scene50/View53 paints no matte frame",
    a.bright === 0 && a.sawNoSet && a.held > 0,
    `bright=${a.bright} painted=${a.painted} held=${a.held} sawSetNone=${a.sawNoSet}`,
  );
  const b = await walk("gstair3.set", "Scene50", "View54");
  check(
    "...nor from View54, the other reported crossing",
    b.bright === 0 && b.held > 0,
    `bright=${b.bright} painted=${b.painted} held=${b.held}`,
  );

  // and the discriminator itself: only a hole looks like a hole. Measured over
  // the 15 disc-1 stage flats, main.stg's view region is 100% one index and
  // every other flat is 3.4%-22.4%, the ending (narend) among them.
  const { session, viewer } = await newSession();
  await session.openSetFile("gstair3.set");
  const dir = viewer().dir;
  const isMatte = (dir as never as { flatIsMatte(f: unknown): boolean }).flatIsMatte.bind(dir);
  const main = session.stageCtrl.flatImage()!;
  await session.stageCtrl.openStageFile("tour.stg");
  const tour = session.stageCtrl.flatImage()!;
  check(
    "main.stg reads as a matte and a real flat does not",
    isMatte(main) === true && isMatte(tour) === false,
    `main=${isMatte(main)} tour=${isMatte(tour)}`,
  );
}
);

// --- 13h. #158: the band's lit plate belongs to the flat's half of the CLUT ---
// User-reported as "the menu band is wrongly lit — a slightly lighter greyish
// background", on the bridge and nowhere else. What lights the band is house.shp's
// `light` prop, a SOLID 251x120 rectangle laid over the middle third of main.stg's
// flat, and it only disappears into the flat because its corners are the same
// marble the flat has there — the same palette INDICES, resolved through the same
// CLUT.
//
// TI.EXE has one CLUT, filled from two files: a set supplies its own colours (72
// of the 75 sets on the discs draw their views from 0..127 alone) and the stage
// supplies the interface half above them, which is where every band pixel lives.
// Reading all 256 from the set passed everywhere else because 74 of the 75 carry a
// byte-identical copy of main.stg's upper half; bridge.set's copy is uniformly
// darker, so on the bridge the plate stopped matching the flat and grew a seam
// down both its sides.
test("the lit band's plate matches the flat it is laid over (#158)", async () => {
  const band = async (setFile: string) => {
    const { session, viewer } = await newSession();
    await session.openSetFile(setFile);
    // what a first click on a dark band icon does: propvisible("light", true)
    await session.sendEvent("sendtoshop", "house.shp", "activateinterface", [], "test");
    const v = viewer();
    const drew = (v as never as { paintWorldInto(): string | null }).paintWorldInto();
    const buf = (v as never as { screen: { frame: Uint8ClampedArray } }).screen.frame;
    const lum = (x: number, y: number): number => {
      const d = (y * SCREEN_W + x) * 4;
      return 0.299 * buf[d] + 0.587 * buf[d + 1] + 0.114 * buf[d + 2];
    };
    // the plate's own left and right edges: propxy(256, 324) less the frame's
    // stored offset puts its 251 columns at x = 128..378
    let seam = 0;
    for (let y = 268; y < 380; y++) seam += Math.abs(lum(128, y) - lum(127, y)) + Math.abs(lum(378, y) - lum(379, y));
    const flatPal = displayPalette(session.stageCtrl.flatImage()!.palette);
    const setPal = displayPalette(paletteToRGBA(v.set.paletteRaw, 256));
    const d = (264 * SCREEN_W + 128) * 4; // the plate's top-left pixel, index 131
    return {
      drew,
      lit: session.propRuntime.get("light")?.visible === true,
      seam: seam / 224,
      corner: buf[d],
      flat131: flatPal[131 * 4],
      set131: setPal[131 * 4],
      rows: buf.slice(264 * SCREEN_W * 4),
    };
  };

  // the reported room, and one whose two CLUT halves already agreed
  const bridge = await band("bridge.set");
  const c73 = await band("c73.set");
  check(
    "both rooms drew a lit band",
    bridge.drew === "flat" && bridge.lit && c73.drew === "flat" && c73.lit,
    `bridge=${bridge.drew}/${bridge.lit} c73=${c73.drew}/${c73.lit}`,
  );
  check(
    "bridge.set is the room whose CLUT halves disagree — the premise of the bug",
    bridge.flat131 !== bridge.set131 && c73.flat131 === c73.set131,
    `bridge flat=${bridge.flat131} set=${bridge.set131}; c73 flat=${c73.flat131} set=${c73.set131}`,
  );
  check(
    "the plate resolves through the flat's half of the CLUT, not the set's",
    bridge.corner === bridge.flat131 && c73.corner === c73.flat131,
    `bridge corner=${bridge.corner} (flat ${bridge.flat131}, set ${bridge.set131}); c73 corner=${c73.corner}`,
  );
  check(
    "so the bridge's band has no more of a seam than a room that never had one",
    bridge.seam <= c73.seam + 0.01,
    `bridge=${bridge.seam.toFixed(2)} c73=${c73.seam.toFixed(2)} mean |dLuma| across the plate's two edges`,
  );
  // The band is the same furniture in every room, so the two should now draw it
  // near-identically. Not exactly: a handful of pixels at its very top edge are
  // world sprites, which follow the room and are meant to differ. Bounded rather
  // than pinned for that reason — the number it discriminates against is the
  // recoloured plate, 30078 of the 61440.
  let differing = 0;
  for (let i = 0; i < bridge.rows.length; i += 4) if (bridge.rows[i] !== c73.rows[i]) differing++;
  check(
    "and the two rooms' bands agree everywhere but the world sprites over them",
    differing < 200,
    `${differing}/${bridge.rows.length / 4} band pixels differ between bridge and c73`,
  );
}
);

// --- 14. stage layer: main.stg UI, inventory pickup, inven1 flat ---
test("stage layer: main.stg UI, inventory pickup, inven1 flat", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("b59.set");
  const v = viewer();
  check(
    "main stage active with its flat",
    session.stageName === "main.stg" && session.currentFlat === "main 1",
    `${session.stageName}/${session.currentFlat}`,
  );
  check("flat image decodes 512x384", session.stageCtrl.flatImage()?.width === 512 && session.stageCtrl.flatImage()?.height === 384);
  check("UI band lifesaver visible", session.propRuntime.get("life")?.visible === true);
  // bag/watch live in the C73 world (propxyz) — they must NOT pile into
  // the band at their screen anchor (user-reported stacking)
  check(
    "world-space props stay out of the band",
    session.propRuntime.get("bag")?.worldSpace === true &&
      session.propRuntime.get("watch")?.worldSpace === true &&
      session.propRuntime.propAt(256, 324)?.group.name !== "bag",
  );

  // pick up an item: inven.shp's addinven puts it in Frank's hand
  session.interp.globals.set("mission", 1);
  void v;
  check("inven shop main resolvable", !!session.shopMain("inven.shp"));
  await session.interp.runHandler(session.shopMain("inven.shp")!, "addinven", ["carkeys"], {
    me: "inven.shp",
    target: "",
  });
  const keys = session.propRuntime.get("carkeys")!;
  check(
    "addinven puts carkeys in hand",
    session.interp.globals.get("handitem") === "carkeys" && keys.owner === "frank" && keys.visible,
    `handitem=${session.interp.globals.get("handitem")} owner=${keys.owner} visible=${keys.visible}`,
  );

  // open the inventory: boot's transtoflat swaps the stage
  await session.runGlobal("transtoflat", ["inven1.stg"]);
  check(
    "transtoflat opens inven1",
    session.stageName === "inven1.stg" && session.currentFlat === "inven 1",
    `${session.stageName}/${session.currentFlat}`,
  );
  check("set hidden behind inventory", !session.setVisible);
  check("carkeys shown highlighted", keys.visible && keys.stateName === "hilite1", keys.stateName);

  // and back
  await session.runGlobal("transfromflat", []);
  check(
    "transfromflat restores main.stg",
    session.stageName === "main.stg" && session.currentFlat === "main 1",
    `${session.stageName}/${session.currentFlat}`,
  );
}
);

// --- 15. world-space props: the bag on the C73 bed, projected + takeable ---
test("world-space props: the bag on the C73 bed, projected + takeable", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  v.jumpTo("Scene50", "View59");
  const bag = session.propRuntime.get("bag")!;
  check("bag is a visible world prop", bag.visible && bag.worldSpace, `vis=${bag.visible} ws=${bag.worldSpace}`);
  // scan the view for the bag under the cursor (projection + opaque mask)
  const cam = v.worldCamera()!;
  let hit: { x: number; y: number } | null = null;
  for (let y = 140; y < 264 && !hit; y += 4) {
    for (let x = 200; x < 400 && !hit; x += 4) {
      if (session.propRuntime.propAt(x, y, cam)?.group.name === "bag") hit = { x, y };
    }
  }
  check("bag projects into View59", !!hit, hit ? `${hit.x},${hit.y}` : "not found");
  // the projected anchor must sit on the bed. Camera z comes from the
  // view's stand FRAME (posY16 = 2190 here) — scale-free across sets;
  // the earlier fitted cameraHeight×512 (2351) gave y=200, the frame
  // camera gives y=177 at the same x/depth (both on the bed)
  const proj = projectPoint(cam, bag.worldX, bag.worldY, bag.worldZ);
  check(
    "projection matches TI.EXE math",
    !!proj && proj.x === 314 && proj.y === 177 && proj.depth === 1755,
    proj ? `${proj.x},${proj.y} d=${proj.depth}` : "behind camera",
  );
  // depth scaling reads the frame's refScale (i16 @+42), not a fitted constant:
  // uniformly 96 in the shipped shops, matching GANG.CST (the old 180 ballooned
  // near props like the wireless message slips)
  check(
    "world prop refScale comes from the frame record (96, not the fitted 180)",
    bag.state()?.refScales[0] === 96,
    `ref=${bag.state()?.refScales[0]}`,
  );
  if (hit) await v.click(hit.x, hit.y); // bag's mousedown -> addbag()
  check(
    "clicking the bag picks it up",
    bag.owner === "frank" && !bag.worldSpace && bag.anchorY === 324,
    `owner=${bag.owner} ws=${bag.worldSpace} anchor=${bag.anchorX},${bag.anchorY}`,
  );
  check("trunkkey comes along", session.propRuntime.get("trunkkey")?.owner === "frank");
}
);

// --- 16. timing model: makeloop/makecricket/starxyz/delay/soundloop -------
test("timing model: makeloop/makecricket/starxyz/delay/soundloop", async () => {
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  // C73's openset arms the Smethells door-knock loop on scene49
  // (makeloop("scene","scene49","smethknock",300) — actorvalue("smeth")=0)
  check("openset arms the knock loop", session.scheduler.isLoop("scene", "scene49"));

  // fast-forward ~25 s of game time: the loop fires ONCE (loops are
  // self-clearing one-shots), plays a knock cricket at the buzzer star
  // (starxyz -> actor "buzzer" at 3787,1251), and re-arms itself
  sink.calls.length = 0;
  for (let i = 0; i < 380; i++) {
    v.tick((clock += 66));
    if (i % 10 === 0) await drain();
  }
  await session.settle();
  const knock = sink.calls.find((c) => c.channel === "sound" && c.volume < 1 && c.volume > 0);
  check(
    "knock cricket fires with positional volume",
    !!knock,
    knock ? `vol=${knock.volume.toFixed(2)} pan=${knock.pan.toFixed(2)}` : `${sink.calls.length} calls`,
  );
  check("one-shot cricket removed after firing", session.scheduler.crickets.length === 0);
  check("knock loop re-armed itself", session.scheduler.isLoop("scene", "scene49"));

  // delay(n) = n/60 s of game time; the script stays suspended (busy) while
  // the clock ticks and resumes exactly after the interval
  let resumed = false;
  const delayFn = session.interp.builtins.get("delay")!;
  void session.track(
    Promise.resolve(
      delayFn(session.interp, [60], null as never, null as never) as Promise<void>,
    ).then(() => {
      resumed = true;
    }),
  );
  v.tick((clock += 500));
  await drain();
  check("delay(60) still suspended after 0.5s", !resumed && v.inputLocked);
  v.tick((clock += 600));
  await drain();
  check("delay(60) resumes after 1s", resumed && !v.inputLocked);

  // soundloop: a FLAG — the sound loops when subsequently played (the corpus
  // always pairs `soundloop(x, true)` with a singlesound/multiplesound or a
  // makecricket); playing a flagged sound twice doesn't stack; haltsound
  // stops the tracked loop (the gramophone hiss must not outlive the crank)
  sink.calls.length = 0;
  session.scheduler.soundLoop("doorlocked", true);
  check("soundloop alone plays nothing (it only flags)", sink.calls.length === 0, `${sink.calls.length} plays`);
  session.scheduler.playSound("doorlocked", false);
  session.scheduler.playSound("doorlocked", false); // already looping: no second start
  const loops = sink.calls.filter((c) => c.loop);
  check("flagged sound plays as ONE tracked loop", loops.length === 1 && sink.calls.length === 1, `${loops.length} loop starts of ${sink.calls.length} plays`);
  session.scheduler.haltSounds();
  sink.calls.length = 0;
  session.scheduler.playSound("doorlocked", false); // flag persists: loops again after halt
  check("haltsound stops the loop; flag persists for the next play", sink.calls.filter((c) => c.loop).length === 1, `${sink.calls.length} plays`);
  session.scheduler.soundLoop("doorlocked", false);
  sink.calls.length = 0;
  session.scheduler.playSound("doorlocked", false);
  check("soundloop(off) unflags: plays one-shot again", sink.calls.length === 1 && !sink.calls[0].loop, `loop=${sink.calls[0]?.loop}`);
}
);

// --- 17. actors: GANG.CST loads, DECKBD openset places Morrow -------------
test("actors: GANG.CST loads, DECKBD openset places Morrow", async () => {
  const { session, sink, viewer } = await newSession();
  check("gang.cst cast loads at boot", session.actorRuntime.actors.size === 25,
    `${session.actorRuntime.actors.size} actors`);
  // mission state that makes DECKBD's openset place gang actors
  session.interp.globals.set("mission", 1);
  session.interp.globals.set("phase", 1);
  sink.calls.length = 0;
  // enter next to morrow's star (the default scene auto-forwards to DECKA —
  // the two decks chain like the grand staircase)
  await session.openSetFile("deckbd.set", "scene33", "view94");
  const v = viewer();
  check("still on deckbd (no auto-forward)", session.currentSetName === "deckbd",
    session.currentSetName);
  const morrow = session.actorRuntime.get("morrow")!;
  check(
    "setupactor places morrow on deckbd",
    morrow.visible && morrow.setName === "deckbd" && morrow.scale > 0 &&
      (morrow.worldX !== 0 || morrow.worldY !== 0),
    `vis=${morrow.visible} set=${morrow.setName} scale=${morrow.scale} @${morrow.worldX},${morrow.worldY} pose=${morrow.poseName}`,
  );
  // ambience = soundloop flag + makecricket; a cricket starts LOOPING on the
  // first service tick the player is within its radius (positional — the far
  // one stays armed and will start when approached, so exactly one of
  // motor/machine is audible from this spawn)
  for (let i = 0; i < 3; i++) { session.tickTime((clock += 66)); await drain(); }
  check(
    "deckbd ambient: soundloop-flagged crickets loop; both registered",
    sink.calls.filter((c) => c.loop).length >= 1 &&
      session.scheduler.isCricket("motor") && session.scheduler.isCricket("machine"),
    `${sink.calls.filter((c) => c.loop).length} loops, motor=${session.scheduler.isCricket("motor")} machine=${session.scheduler.isCricket("machine")}`,
  );
  // find the view where morrow projects LARGEST while fully on screen — the
  // conversational view you actually approach him in (not a distant/empty one)
  let seen = "";
  let bestH = 0;
  for (let s = 0; s < v.set.scenes.length; s++) {
    for (let vi = 0; vi < v.set.scenes[s].views.length; vi++) {
      v.sceneIdx = s;
      v.viewIdx = vi;
      const cam = v.worldCamera()!;
      const list = session.actorRuntime.drawList(cam);
      const hit = list.find((e) => e.a === morrow);
      if (!hit) continue;
      const r = session.actorRuntime.rect(morrow, hit.proj, cam);
      if (r && r.x >= 0 && r.x + r.w <= 512 && r.h > 20 && r.h < 400 && r.h > bestH) {
        bestH = r.h;
        seen = `${v.set.scenes[s].sceneName}/${v.set.scenes[s].views[vi].viewName} rect ${r.x},${r.y} ${r.w}x${r.h}`;
      }
    }
  }
  check("morrow projects into a deckbd view at person size", seen !== "", seen);

  // --- actor Z-occlusion (SET Z image): scenery hides world sprites ---------
  // fraction of an actor's sprite bbox NOT occluded by the SET depth map;
  // null when the actor isn't in the draw list / has no rect
  const notOccludedFrac = (actor: typeof morrow): number | null => {
    const cam = v.worldCamera();
    if (!cam) return null;
    const hit = session.actorRuntime.drawList(cam).find((e) => e.a === actor);
    if (!hit) return null;
    const r = session.actorRuntime.rect(actor, hit.proj, cam);
    const cur = (v as unknown as { current?: { z?: Uint8Array; width: number; height: number } })
      .current;
    const z = cur?.z;
    if (!r || !cur || !z) return null;
    const scale = v.set.zFarMax / (v.set.zLevelCount || 24);
    const level = Math.max(0, Math.floor(hit.proj.depth / Math.max(1, scale)));
    let vis = 0;
    let tot = 0;
    for (let ty = Math.max(0, r.y); ty < Math.min(cur.height, r.y + r.h); ty++) {
      for (let tx = Math.max(0, r.x); tx < Math.min(cur.width, r.x + r.w); tx++) {
        tot++;
        if (z[ty * cur.width + tx] >= level) vis++;
      }
    }
    return tot ? vis / tot : null;
  };

  check(
    "deckbd SET carries depth quantization (SCDO)",
    v.set.zLevelCount === 24 && v.set.zFarMax === 2750,
    `levels=${v.set.zLevelCount} farMax=${v.set.zFarMax}`,
  );
  // asea stands far down the promenade, behind the deckhouse wall (all near
  // levels) — the ship must hide him (user-reported occlusion bug)
  const asea = session.actorRuntime.get("asea")!;
  v.jumpTo("Scene33", "View94");
  const aseaFrac = asea ? notOccludedFrac(asea) : null;
  check(
    "asea is occluded by the deckhouse on Scene33/View94",
    aseaFrac === 0,
    `notOccludedFrac=${aseaFrac}`,
  );
  // but morrow, at conversational distance where he projects at person size,
  // must NOT be wrongly hidden by his own scenery
  const [msc, mvw] = seen.split(" ")[0].split("/");
  v.jumpTo(msc, mvw);
  const morrowFrac = notOccludedFrac(morrow);
  check(
    "morrow is not over-occluded where he faces the player",
    morrowFrac !== null && morrowFrac > 0.5,
    `notOccludedFrac=${morrowFrac} at ${msc}/${mvw}`,
  );
}
);

// --- 18. puppets: SMETH1 conversation — speaks, choices, branching --------
test("puppets: SMETH1 conversation — speaks, choices, branching", async () => {
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  const conversation = session.track(
    (async () => {
      await session.puppetCtrl.openPuppetFile("smeth1.pup");
      await session.sendEvent("sendtopuppet", "before", "intro", [], "test");
      session.puppetCtrl.closePuppetFile();
    })(),
  );
  const pump = async (until: () => boolean, max = 3000): Promise<boolean> => {
    for (let i = 0; i < max && !until(); i++) {
      v.tick((clock += 100));
      await drain();
    }
    return until();
  };
  check("puppet file opens into puppet mode", await pump(() => session.puppet !== null));
  const line = (id: string) => session.puppet?.pup.dialogue.get(id)?.text ?? "?";
  check(
    "first line speaks with its subtitle",
    await pump(() => session.puppet?.subtitle === line("smeth1.031")),
  );
  const voice = sink.calls.find((c) => c.channel === "voice");
  check("line voice audio plays", !!voice && voice.seconds > 0.5, `${voice?.seconds.toFixed(2)}s`);
  // click through the rows the renderer actually reports, not a hand-computed
  // y: the band geometry is TI.EXE's (five fixed 24-px rows from y=264) and a
  // test that recomputes it is testing its own arithmetic
  const clickChoice = async (i: number): Promise<void> => {
    const r = v.choiceRects[i];
    await v.click(r.x + r.w / 2, r.y + r.h / 2);
  };
  const offers = (...texts: string[]) =>
    v.choices.length === texts.length && texts.every((t, i) => v.choices[i].text === t);
  check(
    "two choice bevels appear after the speeches",
    await pump(() => offers("What's mal de mer?", "Yes, just a touch.")),
  );
  await clickChoice(1); // "Yes, just a touch."
  check(
    "choice branches to the next line",
    await pump(() => session.puppet?.subtitle === line("smeth1.034")),
  );
  // the answered list stays up, framed, until the script's own puppetclear —
  // so the next round is identified by its TEXT, not by the count
  check(
    "second choice round appears",
    await pump(() =>
      offers("Yes, I could use some help.", "No, I don't need any help."),
    ),
  );
  await clickChoice(1); // "No, I don't need any help." -> closing line
  check("conversation ends, puppet closes", await pump(() => session.puppet === null));
  await conversation;
  check("world display returns after the talk", !session.puppet && !v.moviePlaying);
}
);

// --- 18b. skipping a spoken line silences it. The other half of the movie
// overlap above: PENNY2.PUP's Lenin beat is `puppetspeak(28)`, `puppetclear()`,
// `spotmovie("lenin.mov")`. Skip line 28 and only the NEXT puppetspeak would
// cut it (a non-overlapping play halts the channel) — but what follows here is
// a movie, so the skipped line talked under it.
//
// It also pins WHAT skips: ESC, not a click. The original's wait drops any
// event that is not a key on the filter's first instruction (0x441d80), so a
// click on a talking character does nothing at all (#3).
test("skipping a spoken line silences it, not just its subtitle", async () => {
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  const conversation = session.track(
    (async () => {
      await session.puppetCtrl.openPuppetFile("smeth1.pup");
      await session.sendEvent("sendtopuppet", "before", "intro", [], "test");
      session.puppetCtrl.closePuppetFile();
    })(),
  );
  const pump = async (until: () => boolean, max = 3000): Promise<boolean> => {
    for (let i = 0; i < max && !until(); i++) {
      v.tick((clock += 100));
      await drain();
    }
    return until();
  };
  const speaking = await pump(() => !!session.puppet?.subtitle);
  sink.halts.length = 0;
  // a click on the picture while someone is talking: ignored, the line runs on
  await v.click(4, 4);
  await drain();
  const survivedClick = !!session.puppet?.subtitle && !sink.halts.includes("voice");
  // routed the way main.ts routes it, so this covers the wiring too
  const consumed = await v.keyDown(".", true);
  await drain();
  check(
    "a click does not skip a spoken line; ESC does, and stops the voice with it",
    speaking && survivedClick && consumed && sink.halts.includes("voice"),
    `speaking=${speaking} survivedClick=${survivedClick} consumed=${consumed} halts=${sink.halts}`,
  );
  session.puppetCtrl.closePuppetFile();
  await conversation.catch(() => {});
}
);

// --- 18b1. #7: a fade over a conversation fades the picture as it IS -------
// User-reported: with subtitles on, ending a conversation left the character's
// lower body missing for the length of the fade — a gap exactly the height of
// the caption bar, between the body and the interface band.
//
// TI.EXE has no snapshot: `screentoblack` (0x43e550 -> 0x435b90) dims the LIVE
// screen `steps` times and returns, so it fades whatever the picture is at that
// instant. The port freezes a copy instead, and was taking it from the last
// PRESENTED composite — which is a frame stale, because a line ends by clearing
// the subtitle and the script's screentoblack runs in the same tick before any
// render. So the frozen copy still had the character clipped 40 px short for a
// caption bar that lives only on the canvas, and the room showed through the
// hole. Subtitles-only, because with them off nothing is ever clipped.
test("a fade over a conversation captures the live picture, not a stale one (#7)", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("gstair3.set");
  const v = viewer();
  const conversation = session.track(
    (async () => {
      await session.puppetCtrl.openPuppetFile("smeth1.pup");
      await session.sendEvent("sendtopuppet", "before", "intro", [], "test");
    })(),
  );
  const pump = async (until: () => boolean, max = 3000): Promise<boolean> => {
    for (let i = 0; i < max && !until(); i++) {
      v.tick((clock += 100));
      await drain();
    }
    return until();
  };
  // the 40 rows the caption bar occupies — cut out of the character, not added
  // below it (0x440981), which is why they are the rows that can end up empty
  const SUBTITLE_H = 40;
  const STRIP = SUBTITLE_H * SCREEN_W;
  const blackInStrip = (rgba: Uint8ClampedArray): number => {
    let n = 0;
    for (let y = PUPPET_ART_H - SUBTITLE_H; y < PUPPET_ART_H; y++) {
      for (let x = 0; x < SCREEN_W; x++) {
        const d = (y * SCREEN_W + x) * 4;
        if (rgba[d] === 0 && rgba[d + 1] === 0 && rgba[d + 2] === 0) n++;
      }
    }
    return n;
  };

  const speaking = await pump(() => !!session.puppet?.subtitle);
  const midLine = session.captureFrame!();
  check(
    "mid-line, the frozen picture carries the caption bar the player can see",
    speaking && !!midLine && blackInStrip(midLine.rgba) === STRIP,
    `speaking=${speaking} black=${midLine ? blackInStrip(midLine.rgba) : "no frame"}/${STRIP}`,
  );

  // the line ends: the subtitle clears and the character is whole again, which
  // is the picture the original would have been dimming
  const ended = await pump(() => !session.puppet?.subtitle);
  const atExit = session.captureFrame!();
  // strictly fewer than mid-line, so this cannot pass on a capture that simply
  // ignores the conversation and hands back the same picture both times
  check(
    "once the line ends, the same rows are the character again, not a hole",
    ended && !!atExit && !!midLine &&
      blackInStrip(atExit.rgba) < blackInStrip(midLine.rgba) &&
      blackInStrip(atExit.rgba) < STRIP / 2,
    `ended=${ended} black=${atExit ? blackInStrip(atExit.rgba) : "no frame"}/${STRIP} ` +
      `(mid-line ${midLine ? blackInStrip(midLine.rgba) : "?"})`,
  );

  session.puppetCtrl.closePuppetFile();
  await conversation.catch(() => {});
}
);

// --- 18b2. the volume digits, in both waits that take keys ----------------
// The two key filters' jump tables are byte-identical (0x441ea0/0x441e60 for a
// spoken line, 0x44a584/0x44a544 for a movie): `0`..`9` call the wave-volume
// setter with their own value and answer "not an interrupt", so the line or the
// clip carries on. Bound BARE here rather than as the original's Ctrl chords,
// which a browser reserves for zoom and tab switching (#129).
test("the volume digits set the wave volume without interrupting", async () => {
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  const conversation = session.track(
    (async () => {
      await session.puppetCtrl.openPuppetFile("smeth1.pup");
      await session.sendEvent("sendtopuppet", "before", "intro", [], "test");
      session.puppetCtrl.closePuppetFile();
    })(),
  );
  const pump = async (until: () => boolean, max = 3000): Promise<boolean> => {
    for (let i = 0; i < max && !until(); i++) {
      v.tick((clock += 100));
      await drain();
    }
    return until();
  };
  const speaking = await pump(() => !!session.puppet?.subtitle);
  const said = session.puppet?.subtitle ?? "";
  sink.halts.length = 0;
  // routed the way main.ts routes a digit: no marker, straight through keyDown
  const consumed = await v.keyDown("3");
  await drain();
  check(
    "a digit during a line sets the volume and leaves the line running",
    speaking && consumed && session.waveVolume === 3 &&
      session.puppet?.subtitle === said && !sink.halts.includes("voice"),
    `consumed=${consumed} vol=${session.waveVolume} subtitle unchanged=${session.puppet?.subtitle === said} halts=${sink.halts}`,
  );
  // 0 is a real setting, not "unset" — the arm at 0x441dc8 passes 0
  await v.keyDown("0");
  await drain();
  check(
    "0 is silence, and it reaches both channels",
    session.waveVolume === 0 && sink.channelVolume.voice === 0 && sink.channelVolume.sound === 0,
    `vol=${session.waveVolume} voice=${sink.channelVolume.voice} sound=${sink.channelVolume.sound}`,
  );
  // and a letter is NOT a volume: the other 56 chars are the filter's ignored arm
  await v.keyDown("x");
  await drain();
  check("a letter is not a volume", session.waveVolume === 0, `vol=${session.waveVolume}`);
  session.puppetCtrl.closePuppetFile();
  await conversation.catch(() => {});
}
);

// --- 18b3. the scripts' wavevolume() is the same funnel as the keys --------
// TI.EXE has one setter (0x4249b0) with twenty-one callers: wavevolume's own
// site at 0x43de4c and the ten digit arms in each of the two key filters. This
// port has one too (GameSession.setWaveVolume), and that is what keeps the
// CTL.STG dial, the digit keys and the play page's slider from disagreeing.
test("wavevolume() and the volume keys write one value", async () => {
  const { session, sink } = await newSession();
  await session.openSetFile("c73.set");
  const wavevolume = session.interp.builtins.get("wavevolume")!;
  const call = (...args: number[]) =>
    wavevolume(session.interp, args, null as never, null as never);
  await call(4);
  check(
    "the script setter drives the channels through the session",
    session.waveVolume === 4 && Math.abs(sink.channelVolume.voice - 4 / 9) < 1e-9,
    `vol=${session.waveVolume} voice=${sink.channelVolume.voice}`,
  );
  const readBack = await call();
  check("and reads back what it wrote", Number(readBack) === 4, `read=${readBack}`);
  session.setWaveVolume(99); // clamped: 0x4249b0's only inputs are the 0..9 arms
  check("out of range clamps to the original's nine", session.waveVolume === 9,
    `vol=${session.waveVolume}`);
}
);

// --- 18b4. ESC at a plaque answers -1 and walks the player out -------------
// The plaque wait takes ESC too, and its answer is -1 (0x4418a7). That is not a
// spare value: every one of the 516 puppetevent calls in the tree is
// `puppetevent (-1)` followed by a switch with a `case -1` arm — SMETH1's
// `regular()` and `intro()` both `exitcode` there — so until now those were
// branches the authors wrote and nothing could reach (#131).
test("ESC at a dialogue plaque answers -1", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  await session.puppetCtrl.openPuppetFile("smeth1.pup");
  session.puppetCtrl.puppetBevel("What's mal de mer?", 101);
  session.puppetCtrl.puppetBevel("Yes, just a touch.", 102);
  const answered = session.puppetCtrl.puppetEvent();
  check("the plaque is waiting", v.awaitingChoice && v.choices.length === 2);
  // routed the way main.ts routes it, so this covers the wiring too
  const consumed = await v.keyDown(".", true);
  const arg = await answered;
  check(
    "ESC ends the wait with -1, and answers no bevel",
    consumed && arg === -1 && !v.awaitingChoice && session.puppet?.chosen === null,
    `consumed=${consumed} arg=${arg} awaiting=${v.awaitingChoice} chosen=${session.puppet?.chosen}`,
  );
  check(
    "and does NOT leave the skip flag standing, so the -1 arm can still speak",
    session.puppet?.interrupted === false,
    `interrupted=${session.puppet?.interrupted}`,
  );
  // a plaque nobody answered has no picked row for a later repeat to frame
  check(
    "the abandoned plaque is remembered with no chosen row",
    session.puppet?.lastPlaque?.chosen === null && session.puppet?.lastPlaque?.bevels.length === 2,
    `lastPlaque=${JSON.stringify(session.puppet?.lastPlaque)}`,
  );
  session.puppetCtrl.closePuppetFile();

  // ...and the same thing against the real script, because the value only
  // matters if a scenario acts on it. SMETH1's `regular()` is `while true` around
  // five bevels with `case -1: exitcode` — so an unanswered plaque is the ONLY way
  // out of that loop, and the handler returning is the arm having run.
  await session.puppetCtrl.openPuppetFile("smeth1.pup");
  let ended = false;
  const advice = session.track(
    session.sendEvent("sendtopuppet", "before", "regular", [], "test").then(() => (ended = true)),
  );
  const pump = async (until: () => boolean, max = 3000): Promise<boolean> => {
    for (let i = 0; i < max && !until(); i++) {
      v.tick((clock += 100));
      await drain();
    }
    return until();
  };
  const offered = await pump(() => v.awaitingChoice && v.choices.length === 5);
  check("smeth1 regular() offers its five", offered, `choices=${v.choices.length}`);
  await v.keyDown(".", true);
  const unwound = await pump(() => ended);
  check(
    "the script's own `case -1: exitcode` runs — the while-true loop is left",
    offered && unwound,
    `ended=${ended}`,
  );
  session.puppetCtrl.closePuppetFile();
  await advice.catch(() => {});
}
);

// --- 18b5. characters fidget while you read the choices -------------------
// TI.EXE's plaque wait carries four idle timers inline (0x441780), each one an
// `idle N` line on its own interval out of the PUP header (0x83a/0x84a), seeded
// with min + rand(1..max-min) and re-drawn every time it fires. `puppetparam 8`
// is the switch and it is the GAME's: of the 316 puppets in the tree exactly four
// turn it on, each bracketing one exchange (#132).
test("idle timers fidget a character at a plaque, and only when asked", async () => {
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  await session.puppetCtrl.openPuppetFile("smeth1.pup");
  const timers = session.puppet!.pup.idleTimers;
  check(
    "the four intervals come out of the PUP, in ticks",
    timers.length === 4 && timers.every((t) => t.minTicks > 0 && t.maxTicks >= t.minTicks) &&
      timers[0].minTicks < timers[3].minTicks,
    JSON.stringify(timers),
  );
  const voices = () => sink.calls.filter((c) => c.channel === "voice").length;
  const pump = async (until: () => boolean, max = 4000): Promise<boolean> => {
    for (let i = 0; i < max && !until(); i++) {
      v.tick((clock += 50));
      await drain();
    }
    return until();
  };
  // slot 8 clear is the default, and nothing must fidget
  session.puppetCtrl.puppetBevel("one", 101);
  const quiet = session.puppetCtrl.puppetEvent();
  const before = voices();
  await pump(() => false, 200); // ten game seconds — well past slot 1's ~2 s
  check(
    "with puppetparam 8 clear no slot is armed and nothing is said",
    session.puppet?.idle.length === 0 && voices() === before,
    `armed=${session.puppet?.idle.length} voices=${before}->${voices()}`,
  );
  session.puppetCtrl.puppetChoose(0);
  await quiet;

  // ...and with it set, the blink comes round on its own
  session.puppetParams.set(8, 1);
  session.puppetCtrl.puppetClear();
  session.puppetCtrl.puppetBevel("one", 101);
  const busy = session.puppetCtrl.puppetEvent();
  check("all four slots arm", session.puppet?.idle.length === 4, `armed=${session.puppet?.idle.length}`);
  const played = voices();
  const fidgeted = await pump(() => voices() > played, 400);
  check("a slot comes due and plays its line", fidgeted, `voices=${played}->${voices()}`);
  check(
    "and an idle line prints nothing — its ident is the subtitle gate (0x44084c)",
    !session.puppet?.subtitle,
    `subtitle=${JSON.stringify(session.puppet?.subtitle)}`,
  );
  // the plaque is still answerable: a click during an idle line is NOT dropped
  // here, which is the one deliberate deviation in this path
  session.puppetCtrl.puppetChoose(0);
  const arg = await busy;
  check("the choice still answers", arg === 101, `arg=${arg}`);
  check("and the slots are disarmed with the plaque", session.puppet?.idle.length === 0);
  session.puppetCtrl.closePuppetFile();
}
);

// --- 18b6. the choices are shuffled, and the way out of them is not --------
// `puppetscramble` was a no-op stub, so every conversation that calls it offered
// its plaques in the order the puppet defines them — Morrow's wireless-room
// questions came out the same way every time, where the original never repeats
// (#298). The handler is 0x4402e0: `bevelCount * 5` swaps, each of two
// independent `rand(bevelCount)` draws, over the list as it stands AT THE CALL.
//
// Which is the whole point of it being a command and not a flag: MORROW1's
// `wireless()` scrambles and THEN pushes "Good night.", so the questions move and
// the exit line does not. BURNS1 is the plainest case — five plaques carrying
// only the ids 101 and 102, an answer you have to read rather than count to.
test("puppetscramble shuffles the plaques already offered, and only those", async () => {
  const { session } = await newSession();
  await session.openSetFile("c73.set");
  await session.puppetCtrl.openPuppetFile("smeth1.pup");
  const rows = (): string => session.puppet!.bevels.map((b) => b.id).join(",");

  // A seed rather than Math.random, so the claim is about THIS shuffle and a
  // rerun cannot quietly agree with itself.
  session.seedRandom(7);
  for (const id of [101, 102, 103, 104]) session.puppetCtrl.puppetBevel(`q${id}`, id);
  session.puppetCtrl.puppetScramble();
  const scrambled = rows();
  session.puppetCtrl.puppetBevel("Good night.", 105);
  check(
    "the four questions are reordered",
    scrambled !== "101,102,103,104" && [...scrambled.split(",")].sort().join(",") === "101,102,103,104",
    `rows=${scrambled}`,
  );
  check(
    "and a plaque pushed after the scramble is still last",
    rows() === `${scrambled},105`,
    `rows=${rows()}`,
  );
  // the text travels with the id — a swap moves whole records (65 dwords each),
  // and a shuffle that separated them would offer Morrow's words under Morrow's
  // wrong number, which no route and no player could see
  check(
    "each plaque keeps its own words",
    session.puppet!.bevels.every((b) => b.text === (b.id === 105 ? "Good night." : `q${b.id}`)),
    JSON.stringify(session.puppet!.bevels),
  );

  // Every ordering is reachable, and none of them is fixed: 24 permutations of
  // four plaques, and 200 seeds have to find more than one of them.
  const seen = new Set<string>();
  for (let seed = 0; seed < 200; seed++) {
    session.seedRandom(seed);
    session.puppetCtrl.puppetClear();
    for (const id of [101, 102, 103, 104]) session.puppetCtrl.puppetBevel(`q${id}`, id);
    session.puppetCtrl.puppetScramble();
    seen.add(rows());
  }
  check("the order really varies with the draw", seen.size > 1, `orders=${seen.size}`);

  // 0x440313 returns before drawing at all below two plaques — and that matters
  // beyond tidiness, because a draw taken here would move the script RNG stream
  // for every story coin that follows it.
  const draws = { n: 0 };
  const counted = session.rng;
  session.rng = () => (draws.n++, counted());
  session.puppetCtrl.puppetClear();
  session.puppetCtrl.puppetBevel("only one", 101);
  session.puppetCtrl.puppetScramble();
  check("one plaque draws nothing", draws.n === 0 && rows() === "101", `draws=${draws.n}`);
  // ...and with a list to shuffle it draws exactly twice per swap, 5n swaps
  session.puppetCtrl.puppetBevel("and another", 102);
  session.puppetCtrl.puppetScramble();
  check("two plaques draw 2 x 5 x 2", draws.n === 20, `draws=${draws.n}`);
  session.puppetCtrl.closePuppetFile();
}
);

// --- 18c. one ESC gets past the whole speech, not one line of it ----------
// TI.EXE's skip is a FLAG, not a race: 0x440620 raises 0x48ac00, and every
// following puppetspeak queues its line and returns without playing it
// (0x43f887) until puppetevent lowers the flag again (0x43f718). So the player
// presses ESC once per speech, not once per sentence.
test("one ESC gets past the whole speech run", async () => {
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  const conversation = session.track(
    (async () => {
      await session.puppetCtrl.openPuppetFile("smeth1.pup");
      await session.sendEvent("sendtopuppet", "before", "intro", [], "test");
      session.puppetCtrl.closePuppetFile();
    })(),
  );
  const pump = async (until: () => boolean, max = 3000): Promise<boolean> => {
    for (let i = 0; i < max && !until(); i++) {
      v.tick((clock += 100));
      await drain();
    }
    return until();
  };
  const voices = () => sink.calls.filter((c) => c.channel === "voice").length;
  const speaking = await pump(() => !!session.puppet?.subtitle);
  const playedBefore = voices();
  await v.keyDown(".", true); // one press, and only one
  const gotPlaque = await pump(() => v.choices.length > 0);
  // the queue is what proves the run had more to say: it holds every line
  // spoken since the last plaque, skipped ones included (it caps at three)
  const queued = session.puppet?.voiceQueue.length ?? 0;
  check(
    "one ESC reaches the plaque and none of the skipped lines is heard",
    speaking && gotPlaque && queued > 1 && voices() === playedBefore,
    `speaking=${speaking} plaque=${gotPlaque} queued=${queued} voices=${playedBefore}->${voices()}`,
  );
  check(
    "the plaque lowers the flag again, so the next speech is heard",
    session.puppet?.interrupted === false,
    `interrupted=${session.puppet?.interrupted}`,
  );
  session.puppetCtrl.closePuppetFile();
  await conversation.catch(() => {});
}
);

// --- 18d. a click on the picture repeats the last exchange ----------------
// The other half of #3. While the choices are up, a click above the answer band
// puts the PREVIOUS plaque back with the row you picked framed (0x44199c,
// 0x4419b5) and plays the queued replies again (0x441a35) — then restores the
// choices you were being offered. Nothing re-enters the script, which is why a
// scenario's stage directions do not come back with it.
test("a click on the picture repeats the last exchange", async () => {
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  const conversation = session.track(
    (async () => {
      await session.puppetCtrl.openPuppetFile("smeth1.pup");
      await session.sendEvent("sendtopuppet", "before", "intro", [], "test");
      session.puppetCtrl.closePuppetFile();
    })(),
  );
  const pump = async (until: () => boolean, max = 3000): Promise<boolean> => {
    for (let i = 0; i < max && !until(); i++) {
      v.tick((clock += 100));
      await drain();
    }
    return until();
  };
  const texts = () => v.choices.map((c) => c.text);
  const skipTo = async (plaque: () => boolean): Promise<boolean> => {
    for (let i = 0; i < 40 && !plaque(); i++) {
      await v.keyDown(".", true);
      if (await pump(plaque, 60)) break;
    }
    return plaque();
  };
  const first = await skipTo(() => v.choices.length > 0);
  const firstTexts = texts();
  const r = v.choiceRects[1];
  await v.click(r.x + r.w / 2, r.y + r.h / 2);
  const second = await skipTo(() => v.choices.length > 0 && texts().join() !== firstTexts.join());
  const secondTexts = texts();
  const voicesBefore = sink.calls.filter((c) => c.channel === "voice").length;
  // the click the old build used to skip a line with: y=4 is the picture
  await v.click(4, 4);
  await drain();
  const duringTexts = texts();
  const framed = session.puppet?.chosen;
  const replayed = await pump(
    () => sink.calls.filter((c) => c.channel === "voice").length > voicesBefore,
    200,
  );
  check(
    "the repeat puts the answered plaque back up with the picked row framed",
    first && second && duringTexts.join() === firstTexts.join() && framed === 1,
    `first=${JSON.stringify(firstTexts)} during=${JSON.stringify(duringTexts)} framed=${framed}`,
  );
  check("the repeat says the queued lines again", replayed);
  const restored = await pump(() => texts().join() === secondTexts.join());
  check(
    "and the choices you were being offered come back after it",
    restored,
    `wanted=${JSON.stringify(secondTexts)} got=${JSON.stringify(texts())}`,
  );
  session.puppetCtrl.closePuppetFile();
  await conversation.catch(() => {});
}
);

// --- 19. actor walking: morrow strolls to his next deck star --------------
test("actor walking: morrow strolls to his next deck star", async () => {
  const { session, viewer } = await newSession();
  session.interp.globals.set("mission", 1);
  session.interp.globals.set("phase", 1);
  await session.openSetFile("deckbd.set", "scene33", "view94");
  const v = viewer();
  const morrow = session.actorRuntime.get("morrow")!;
  const startX = morrow.worldX;
  // send him to morrow.2 (13045,551) through the real builtin path
  await session.interp.builtins.get("walktostar")!(
    session.interp, ["morrow", "morrow.2"], null as never, null as never,
  );
  // A walk begins by TURNING, standing still, and the pose stays whatever the
  // script left — the cast's own `endturn` is what makes it "walk", once the
  // facing has come round (see Scheduler.serviceWalks).
  const beganStanding = session.scheduler.isWalk("morrow") && morrow.poseName !== "walk";
  const startedAt = morrow.worldX;
  // the record's own turn phase is the thing to watch: `endturn` is a dispatch,
  // so the POSE lands a microtask after the facing does
  const turning = () => session.scheduler.walks.get("morrow")?.turnTo !== undefined;
  let held = true;
  let passes = 0;
  // one SERVICE step an iteration (the step is 50 ms): a +100 tick would run two,
  // and could finish the turn and move him inside a single loop pass
  while (turning() && passes++ < 60) {
    v.tick((clock += 50));
    await drain();
    if (morrow.worldX !== startedAt) held = false;
  }
  v.tick((clock += 100)); // let endturn's dispatch settle
  await drain();
  check(
    "walk starts by turning on the spot, and endturn hands over the walk pose",
    beganStanding && held && passes > 1 && morrow.poseName === "walk",
    `began=${beganStanding} turnPasses=${passes} stoodStill=${held} pose=${morrow.poseName} deg=${morrow.deg}`,
  );
  for (let i = 0; i < 4; i++) {
    v.tick((clock += 100));
    await drain();
  }
  const midX = morrow.worldX;
  const midStep = morrow.step;
  check(
    "mid-walk: position moved toward the target, cycle advancing",
    midX > startX && midX < 13045 && midStep > 0,
    `x ${startX} -> ${midX} (target 13045) step=${midStep}`,
  );
  let guard = 0;
  while (session.scheduler.isWalk("morrow") && guard++ < 500) {
    v.tick((clock += 100));
    await drain();
  }
  check(
    "arrival: at the star, stand pose, walk slot freed",
    morrow.worldX === 13045 && morrow.worldY === 551 &&
      morrow.poseName === "stand" && !session.scheduler.isWalk("morrow"),
    `@${morrow.worldX},${morrow.worldY} pose=${morrow.poseName}`,
  );
  check("actorstar getter reports the destination", morrow.starName === "morrow.2");
}
);

// --- 19b. one service pass advances exactly actorspeed -------------------
// TI.EXE's straight-line mover (0x443e7c) is four instructions of arithmetic:
// `[walk+0x16] += actor[0x26]` (progress += actorspeed), clamp to the distance,
// interpolate, arrive when the distance is reached. The pass rate is the 50 ms
// this scheduler already runs at — the master service (0x442550) ends by drawing
// a frame (0x439b80), which spins until `framerate` ticks have gone by, 3 by
// default.
//
// A ×4 approximation stood here for a while and moved the whole cast at four
// times its scripted pace — Penny crossing the gym in 0.40 s rather than 1.60,
// Max pacing A-deck in 3.70 s a leg rather than 14.65 (issue #9). Pinning the
// rule rather than the constant: the assertion is "a pass moves actorspeed",
// which no rescaling can satisfy.
test("actor walking: one service pass advances exactly actorspeed", async () => {
  const { session } = await newSession();
  session.interp.globals.set("mission", 1);
  await session.openSetFile("deckbd.set", "scene33", "view94");
  const morrow = session.actorRuntime.get("morrow")!;
  morrow.speed = 30;
  const startX = morrow.worldX;
  const startY = morrow.worldY;
  // a session's first tickTime only sets its clock anchor, so spend it here
  // rather than measuring it as a pass that moved nobody
  session.tickTime((clock += 50));
  await drain();
  // straight down +x, far enough that no pass can reach the end
  session.scheduler.startWalk("morrow", startX + 6000, startY, morrow.worldZ);
  // spend the turn phase first: a walk stands and turns before it moves, so the
  // opening passes advance nobody and measuring them would measure the turn
  let guard = 0;
  while (morrow.worldX === startX && guard++ < 60) {
    session.tickTime((clock += 50));
    await drain();
  }
  const per: number[] = [morrow.worldX - startX];
  let last = morrow.worldX;
  for (let i = 0; i < 4; i++) {
    session.tickTime((clock += 50));
    await drain();
    per.push(morrow.worldX - last);
    last = morrow.worldX;
  }
  check(
    "each 50 ms pass moves one actorspeed of world units",
    per.every((d) => d === 30),
    `speed=${morrow.speed} per-pass=${per.join(",")}`,
  );

  // and the record's length is TI's truncating isqrt (0x435950), floored and
  // never below 1 — so a 3-4-5 triangle is 5 units, and a walk to where you
  // already stand still takes one pass rather than none
  session.scheduler.stopWalk("morrow");
  morrow.worldX = 0; morrow.worldY = 0; morrow.worldZ = 0;
  morrow.speed = 1;
  session.scheduler.startWalk("morrow", 3, 4, 0);
  const legs = session.scheduler.walks.get("morrow")!;
  const diag = legs.dist;
  session.scheduler.stopWalk("morrow");
  session.scheduler.startWalk("morrow", 0, 0, 0);
  const onTheSpot = session.scheduler.walks.get("morrow")!.dist;
  check(
    "walk length is the floored integer distance, clamped to 1",
    diag === 5 && onTheSpot === 1,
    `3-4-5=${diag} zero=${onTheSpot}`,
  );
}
);

// --- 19c. a walk turns before it moves, at actorturn per pass ---------------
// TI.EXE's walk record carries a facing target (+8, built at 0x4436d0); while it
// is set the service steps the facing by the actor's `actorturn` the short way
// round (0x445080) and returns without moving, and only when it lands does it
// dispatch `endturn()` and begin the movement passes (0x443cfa).
//
// `stdturn` is 10 for every set in TAOOT, so a half-circle is 128/10 = 13 passes
// — about 0.65 s of standing and turning before anyone sets off. The port used
// to snap the facing and set the walk pose itself, both in the same tick.
test("actor walking: a walk turns before it moves, at actorturn per pass", async () => {
  const { session } = await newSession();
  session.interp.globals.set("mission", 1);
  await session.openSetFile("deckbd.set", "scene33", "view94");
  const morrow = session.actorRuntime.get("morrow")!;
  morrow.speed = 30;
  morrow.turn = 10; // stdturn, for every set in the corpus
  session.tickTime((clock += 50)); // the session's clock anchor
  await drain();

  // due east of him, so the target facing is 0 and he starts a half-turn away
  morrow.deg = 128;
  const startX = morrow.worldX;
  session.scheduler.startWalk("morrow", startX + 6000, morrow.worldY, morrow.worldZ);
  const degs: number[] = [];
  let passes = 0;
  while (morrow.worldX === startX && passes++ < 60) {
    session.tickTime((clock += 50));
    await drain();
    degs.push(morrow.deg);
  }
  // 128 units at 10 a pass: 13 passes to arrive (the last one clamps rather than
  // overshooting), and the 14th is the first that moves him
  check(
    "he turns 10 a pass, standing still, and only then sets off",
    degs.slice(0, 13).join(",") === "118,108,98,88,78,68,58,48,38,28,18,8,0" && passes === 14,
    `passes=${passes} degs=${degs.slice(0, 14).join(",")}`,
  );

  // the short way round, in both directions and across the wrap. Facing due east
  // (target 0) from 250 is 6 units forwards and 250 back, so it goes forwards —
  // and clamps on the target rather than overshooting to 4.
  const turnFrom = (deg: number, tx: number, ty: number): number => {
    session.scheduler.stopWalk("morrow");
    morrow.deg = deg;
    session.scheduler.startWalk("morrow", morrow.worldX + tx, morrow.worldY + ty, morrow.worldZ);
    session.tickTime((clock += 50));
    return morrow.deg;
  };
  const nearlyThere = turnFrom(250, 6000, 0); // target 0: 6 forwards -> clamps
  const wrapsForward = turnFrom(250, 0, 6000); // target 64: 70 forwards -> 4, over the wrap
  const goesBack = turnFrom(10, 0, -6000); // target 192: 182 forwards, 74 back -> 0
  check(
    "the facing takes the short way round and clamps on the target",
    nearlyThere === 0 && wrapsForward === 4 && goesBack === 0,
    `250->0 gave ${nearlyThere}, 250->64 gave ${wrapsForward}, 10->192 gave ${goesBack}`,
  );
}
);

// --- 19d. an actorinstance() copy can be sent events -----------------------
// `castScripts` is keyed by CAST MEMBER name and built once at cast load, so a
// copy made by `actorinstance(src, dst)` had no entry at all: the very next line
// of TAOOT's stoker setup,
//
//     actorinstance ("stok1", "stok" @ numtostring (count))
//     sendtoactor ("stok" @ numtostring (count), setupactor ("boil"))
//
// found no chain and was dropped as `sendtoactor("stok3", setupactor(..)) —
// target not loaded`. The copy was therefore never placed, never scaled and
// never made visible: `stok1` is the only stoker who is a cast member, so the
// boiler room ran with one man on the shovel line instead of up to ten
// (user-reported, issue #16). The boat deck's lifeboat crowd is built the same
// way, out of `life1`.
//
// A copy gets its OWN script instance sharing the source's parsed script — `me`
// has to be the copy's name, because every line of the shared handler is written
// against it (`actorpose(me, …)`, `makeloop("actor", me, "stokidle", …)`).
test("actorinstance: a copy is placed and idles like the member it came from", async () => {
  const { session, logs } = await newHost();
  session.interp.globals.set("mission", 1);
  const from = logs.length;
  await session.openSetFile("boil.set"); // its openset sets stok1 up, and he spawns the rest
  await drain();
  for (let i = 0; i < 20; i++) {
    session.tickTime((clock += 50));
    await drain();
  }
  const stokers = [...session.actorRuntime.actors].filter(([n]) => n.startsWith("stok"));
  const dropped = logs.slice(from).filter((l) => l.includes("target not loaded"));
  // gang.cst 1323 forces the tenth (`if random (100) < 60 | count = 10`), so
  // however the draws fall there is always more than one man down there
  const ten = session.actorRuntime.get("stok10");
  check(
    "the shovel line is more than one man, and stok10 is always among them",
    stokers.length > 1 && !!ten,
    `${stokers.length} stokers: ${stokers.map(([n]) => n).join(", ")}`,
  );
  check(
    "every copy was placed on its own star, visible and scaled",
    stokers.every(([n, a]) => a.visible && a.starName === n && a.scale === 9000),
    stokers.map(([n, a]) => `${n}@${a.starName} vis=${a.visible} scale=${a.scale}`).join(" "),
  );
  check(
    "and each is running its own idle loop, not the member's",
    stokers.every(([n]) => session.scheduler.isLoop("actor", n)),
    stokers.map(([n]) => `${n}=${session.scheduler.isLoop("actor", n)}`).join(" "),
  );
  check("no event was dropped for want of a script", dropped.length === 0, dropped.join(" | "));
}
);

/**
 * A walk started on an actorinstance belongs to the INSTANCE (#212).
 *
 * The start functions used to key the walks table on `a.member.name` — the
 * SOURCE cast member for an instance, since `instance()` shares the source's
 * member object — so `stok10`'s turn was filed under `stok1`: the mover stepped
 * the wrong character's facing, `iswalk("stok10")` answered false while the
 * walk ran, and `stopWalk("stok10")` missed the record. The crowd is nothing
 * but instances and `extraidle` turns them constantly, so this fired routinely;
 * and since #191 the writer persists the table, so the mis-key outlived the
 * session. `restoreWalk` was already keyed right — its docblock said so — which
 * is what made the start functions the odd ones out.
 */
test("a walk started on an actorinstance is the instance's, not its source's (#212)", async () => {
  const { session } = await newHost();
  session.interp.globals.set("mission", 1);
  await session.openSetFile("boil.set");
  await drain();
  for (let i = 0; i < 20; i++) {
    session.tickTime((clock += 50));
    await drain();
  }
  const ten = session.actorRuntime.get("stok10")!;
  const one = session.actorRuntime.get("stok1")!;
  session.scheduler.pauseLoop("actor", "stok10", true);
  session.scheduler.pauseLoop("actor", "stok1", true);
  const srcDeg = one.deg;
  const target = (ten.deg + 128) & 0xff;
  session.scheduler.startTurn("stok10", target);
  expect(session.scheduler.isWalk("stok10"), "the record is filed under the instance").toBe(true);
  expect(session.scheduler.isWalk("stok1"), "and not under its source member").toBe(false);
  for (let i = 0; i < 20 && session.scheduler.turning("stok10"); i++) session.tickTime((clock += 50));
  expect(ten.deg, "the instance turned").toBe(target);
  expect(one.deg, "the source did not").toBe(srcDeg);
  expect(session.scheduler.isWalk("stok10"), "and the turn ended").toBe(false);
  // the walk starter files the same way, and stopWalk through the instance's
  // own name reaches the record
  session.scheduler.startWalk("stok10", ten.worldX + 500, ten.worldY, ten.worldZ);
  expect(session.scheduler.isWalk("stok10"), "the walk is the instance's").toBe(true);
  expect(session.scheduler.isWalk("stok1"), "not the source's").toBe(false);
  session.scheduler.stopWalk("stok10");
  expect(session.scheduler.isWalk("stok10"), "and stopWalk reaches it").toBe(false);
});

// --- the crowd's names come out of its star, one character at a time --------
// `extra.cst`'s setupactor takes a crowd star apart by POSITION:
//
//     number = findword (where, "", 6)        where = "ex.a.1"
//     letter = findword (where, "", 4)
//     center = "ex." @ letter @ ".cen"
//     name   = me @ letter @ number           -> "brown1a1"
//
// which only works because an empty delimiter means the idx-th character. While
// it meant "split on spaces", both came back empty: every extra of a group was
// named after the member itself, so `actorinstance` made one copy where the room
// wanted three, and each of them looked for a star called "ex..cen" —
// `starxyz: no star "ex..cen" in lounge1c`, fourteen times, which is what the
// #199 report showed alongside the sound it was really about.
test("the crowd is named and placed from its star (findword by character)", async () => {
  const { session, logs } = await newHost();
  const from = logs.length;
  await session.openSetFile("lounge1c.set"); // its openset builds up to 14 extras
  await drain();
  const extras = [...session.actorRuntime.actors].filter(([, a]) => a.starName.startsWith("ex."));
  const missing = logs.slice(from).filter((l) => /starxyz: no star/.test(l));
  check("the room really does place a crowd", extras.length > 1, `${extras.length} extras`);
  check(
    "each is named <member><letter><number>, from its own star",
    extras.every(([n, a]) => n === `${a.member.name.toLowerCase()}${a.starName[3]}${a.starName[5]}`),
    extras.map(([n, a]) => `${n}@${a.starName}`).join(" "),
  );
  check(
    "and each stands on a star of its own, visible",
    new Set(extras.map(([, a]) => a.starName)).size === extras.length && extras.every(([, a]) => a.visible),
    extras.map(([n, a]) => `${n}@${a.starName} vis=${a.visible}`).join(" "),
  );
  check("no star lookup missed", missing.length === 0, missing.join(" | "));
}
);

// --- 20. puppet frame cache is per-pup (switching characters, no overlap) --
test("puppet frame cache is per-pup (switching characters, no overlap)", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  await session.puppetCtrl.openPuppetFile("morrow1.pup");
  const mpup = session.puppet!.pup;
  const locs = [
    ...new Set(mpup.stances.flatMap((s) => s.layers.flatMap((l) => l.frames))),
  ].filter((n) => n > 0);
  const aByLoc = new Map<number, ReturnType<SetViewer["puppetLayerFrame"]>>();
  for (const loc of locs) {
    try {
      aByLoc.set(loc, v.puppetLayerFrame(loc));
    } catch {
      /* undecodable under morrow — skip */
    }
  }
  session.puppetCtrl.closePuppetFile();
  // a DIFFERENT character: the same container loc must not return morrow's
  // cached sprite (the reported "leftover data overlaps" bug)
  await session.puppetCtrl.openPuppetFile("smeth1.pup");
  const spup = session.puppet!.pup;
  let tested = 0;
  let stale = 0;
  for (const loc of locs) {
    const a = aByLoc.get(loc);
    if (!a || !spup.file.containers[loc]) continue;
    let b: ReturnType<SetViewer["puppetLayerFrame"]> = null;
    try {
      b = v.puppetLayerFrame(loc);
    } catch {
      continue;
    }
    if (!b) continue;
    tested++;
    if (a === b) stale++; // same object => cache reused morrow's frame
  }
  check(
    "puppet frames are cached per-pup (no cross-character sprite reuse)",
    tested > 0 && stale === 0,
    `checked ${tested} shared locs, ${stale} reused the previous character`,
  );
}
);

// --- 21. MAP.STG deck plan: opens, 8 deck flats, renders full-screen -------
test("MAP.STG deck plan: opens, 8 deck flats, renders full-screen", async () => {
  const { session } = await newSession();
  await session.openSetFile("c73.set");
  const ok = await session.stageCtrl.openStageFile("map.stg");
  check("map.stg opens as a stage", ok && session.stageName === "map.stg");
  check(
    "map.stg has 8 deck flats (Boat..G)",
    session.stageCtrl.stageFile?.flats.length === 8 &&
      session.stageCtrl.stageFile.flats[0].name === "Map 1",
    `${session.stageCtrl.stageFile?.flats.length} flats`,
  );
  session.setVisible = false;
  await session.stageCtrl.gotoFlat("Map 1");
  const img = session.stageCtrl.flatImage();
  check(
    "map.stg flat decodes to a full 512x384 deck plan",
    !!img && img.width === 512 && img.height === 384,
    img ? `${img.width}x${img.height}` : "no image",
  );
}
);

// --- 22. point + live pointer builtins (makepoint/pointx/pointy/mouse) -----
test("point + live pointer builtins (makepoint/pointx/pointy/mouse)", async () => {
  const { session, viewer } = await newSession();
  // invoke a builtin by name (call/frame args are unused by these primitives)
  const inv = (name: string, args: number[] = []): number =>
    Number((session.interp.builtins.get(name) as unknown as (i: unknown, a: number[]) => number)(
      session.interp,
      args,
    ));
  const p = inv("makepoint", [353, 137]);
  check(
    "makepoint/pointx/pointy round-trip",
    inv("pointx", [p]) === 353 && inv("pointy", [p]) === 137,
    `p=${p} -> ${inv("pointx", [p])},${inv("pointy", [p])}`,
  );
  // mouse() reflects the live cursor the viewer publishes on move/click
  await session.openSetFile("c73.set");
  await viewer().hover(200, 150);
  const m = inv("mouse");
  check(
    "mouse() reflects the pointer the viewer set on hover",
    inv("pointx", [m]) === 200 && inv("pointy", [m]) === 150,
    `mouse=${inv("pointx", [m])},${inv("pointy", [m])}`,
  );
}
);

// --- 23. deck map interactivity: transtoflat opens to the player's deck ----
test("deck map interactivity: transtoflat opens to the player's deck", async () => {
  const { session } = await newSession();
  // player is in c73 = C Deck; currentpage() should map that to deck 4
  await session.openSetFile("c73.set");
  await session.transToFlat("map.stg");
  check(
    "transtoflat opens the map full-screen (setvisible off)",
    session.stageName === "map.stg" && session.setVisible === false,
    `stage=${session.stageName} setVisible=${session.setVisible}`,
  );
  check(
    "map opens to the player's current deck (c73 -> C Deck = Map 4)",
    session.currentFlat === "Map 4",
    session.currentFlat,
  );
  check("flattoindex resolves names and indices", session.stageCtrl.flatToIndex("Map 4") === 4);
  // page to A Deck via the stage's gotopage (numeric gotoflat under the hood)
  await session.runGlobal("gotopage", [2]);
  check("gotopage pages decks (A Deck = Map 2)", session.currentFlat === "Map 2", session.currentFlat);
  // leaving the map restores the in-game stage
  await session.transFromFlat();
  check(
    "transfromflat restores the in-game stage",
    session.stageName === "main.stg" && session.setVisible === true,
    `stage=${session.stageName} setVisible=${session.setVisible}`,
  );
}
);

// --- 24. deck map click-logic regions: deck buttons + OK are clickable -----
test("deck map click-logic regions: deck buttons + OK are clickable", async () => {
  const { session } = await newSession();
  await session.openSetFile("c73.set");
  await session.transToFlat("map.stg"); // opens to Map 4 (C Deck)
  // regions decode with clean pascal names and in-bounds Y-first rects
  const stg = session.stageCtrl.stageFile!;
  const flat = stg.flats.find((f) => f.name === session.currentFlat)!;
  const regions = readStgRegions(stg.file.containers[flat.locationClickLogic].data);
  check(
    "click-logic regions parse (count + clean names + in bounds)",
    regions.length === 12 &&
      regions.every((r) => /^[\x20-\x7e]*$/.test(r.name)) &&
      regions.every((r) => r.top >= 0 && r.left >= 0 && r.bottom <= 384 && r.right <= 512),
    `${regions.length} regions, names e.g. "${regions[0]?.name}"`,
  );
  // clicking the Boat Deck button (fixed bottom-panel position) pages the map
  const handled = await session.stageCtrl.stageClickAt(123, 325);
  check(
    "clicking a deck button pages to that deck",
    handled && session.currentFlat === "Map 1",
    `handled=${handled} flat=${session.currentFlat}`,
  );
  // clicking OK runs exitmap -> transfromflat -> back to the in-game stage
  await session.stageCtrl.stageClickAt(399, 340);
  check(
    "clicking OK closes the deck map",
    session.stageName === "main.stg" && session.setVisible === true,
    `stage=${session.stageName} setVisible=${session.setVisible}`,
  );
}
);

// --- 25. deck map red-area jump: click a zone -> travel to that location ---
test("deck map red-area jump: click a zone -> travel to that location", async () => {
  const { session } = await newSession();
  await session.openSetFile("c73.set");
  // mapdisabled() gates jumping on owning the bag + watch (and not mission 4)
  const bag = session.propRuntime.get("bag");
  const watch = session.propRuntime.get("watch");
  if (bag) bag.owner = "frank";
  if (watch) watch.owner = "frank";
  await session.transToFlat("map.stg"); // -> Map 4 (C Deck)
  // find a red-area (jumpbaby) region and click its centre
  const stg = session.stageCtrl.stageFile!;
  const flat = stg.flats.find((f) => f.name === session.currentFlat)!;
  const regions = readStgRegions(stg.file.containers[flat.locationClickLogic].data);
  let jumped = "";
  for (const r of regions) {
    const toks = sniffScript(stg.file.containers[r.script].data);
    if (!toks || !scriptToText(toks).includes("jumpbaby")) continue;
    await session.stageCtrl.stageClickAt(
      Math.round((r.left + r.right) / 2),
      Math.round((r.top + r.bottom) / 2),
    );
    jumped = session.currentSetName;
    break;
  }
  check(
    "clicking a red map area travels there and closes the map",
    jumped !== "" && jumped !== "c73" && session.stageName === "main.stg" && session.setVisible,
    `set=${jumped} stage=${session.stageName}`,
  );
}
);

// --- 26. deck map cosmetics: you-are-here dot, deck highlight, disable bar --
test("deck map cosmetics: you-are-here dot, deck highlight, disable bar", async () => {
  const { session } = await newSession();
  await session.openSetFile("c73.set"); // C Deck = page 4
  // tour mode opens the map with jumps enabled (mapdisabled() -> false)
  session.interp.globals.set("tour", 1);
  await session.transToFlat("map.stg");
  const buttons = session.propRuntime.get("buttons")!;
  const spot = session.propRuntime.get("spot")!;
  const disable = session.propRuntime.get("disable")!;
  check(
    "map props default to their first state (no propview in scripts)",
    buttons.state()?.identifier === "untitled" &&
      spot.state()?.identifier === "blink" &&
      disable.state()?.identifier === "untitled",
    `buttons=${buttons.state()?.identifier} spot=${spot.state()?.identifier}`,
  );
  check(
    // propdeg("buttons", page-1): page 4 -> deg 3. The frames' stored degrees
    // are [8,0,1,2,3,4,5,6,7], so deg 3 is frame index 4 (deg 8 = frame 0 =
    // "no deck highlighted"). Selecting by frame index instead of degree used
    // to highlight the wrong deck / show a deck for exitmap's "none".
    "deck highlight pins the current deck's frame (C Deck = deg 3 -> frame 4)",
    buttons.visible && buttons.frameLocked && buttons.frameIdx === 4,
    `visible=${buttons.visible} locked=${buttons.frameLocked} frame=${buttons.frameIdx}`,
  );
  check(
    "you-are-here dot is placed off the default anchor (posdot ran)",
    spot.visible && !(spot.anchorX === 256 && spot.anchorY === 192),
    `visible=${spot.visible} anchor=(${spot.anchorX},${spot.anchorY})`,
  );
  check("tour mode hides the disable bar", disable.visible === false);
  // paging to another deck moves the highlight frame with it
  await session.runGlobal("gotopage", [2]); // A Deck
  check(
    "deck highlight follows paging (A Deck = page 2 -> deg 1 -> frame 2)",
    session.currentFlat === "Map 2" && buttons.frameIdx === 2,
    `flat=${session.currentFlat} frame=${buttons.frameIdx}`,
  );
}
);

// --- 27. deck map disable bar shows when jumps are locked (no bag/watch) ----
test("deck map disable bar shows when jumps are locked (no bag/watch)", async () => {
  const { session } = await newSession();
  await session.openSetFile("c73.set");
  // fresh session: no bag, no watch, no tour -> mapdisabled() is true
  await session.transToFlat("map.stg");
  const disable = session.propRuntime.get("disable")!;
  check(
    "disable bar is shown + centred when the map is locked",
    disable.visible && disable.anchorX === 256 && disable.anchorY === 192,
    `visible=${disable.visible} anchor=(${disable.anchorX},${disable.anchorY})`,
  );
}
);

// --- 28. wireless stage: opens, sets up its props, zooms into a control -----
test("wireless stage: opens, sets up its props, zooms into a control", async () => {
  const { session } = await newSession();
  await session.openSetFile("wireless.set");
  await session.transToFlat("wireless.stg");
  check(
    "wireless stage opens full-screen to its overview flat",
    session.stageName === "wireless.stg" && session.setVisible === false &&
      session.currentFlat === "wireless 1",
    `stage=${session.stageName} flat=${session.currentFlat} setVisible=${session.setVisible}`,
  );
  // openwireless() -> openshopfile("wireless.shp"); openshop() -> setupsmallprops()
  // makes the overview ("small") apparatus props visible on the stage
  const senderhandle = session.propRuntime.get("senderhandle")!;
  const tunerneedle = session.propRuntime.get("tunerneedle")!;
  const wirelessbag = session.propRuntime.get("wirelessbag")!;
  check(
    "openshop re-fires on stage entry -> overview props set up (setupsmallprops)",
    senderhandle.visible && senderhandle.stateName === "small" &&
      tunerneedle.visible && wirelessbag.visible,
    `sender=${senderhandle.visible}/${senderhandle.stateName} tuner=${tunerneedle.visible} bag=${wirelessbag.visible}`,
  );
  // the in-game interface band (house.shp) is hidden behind the full-screen stage
  check("in-game interface band hidden during the stage", session.propRuntime.get("life")?.visible === false);
  // clicking the "tuner" control region zooms into its big flat (openflat sets
  // tunerneedle to its "big" view)
  const stg = session.stageCtrl.stageFile!;
  const flat = stg.flats.find((f) => f.name === session.currentFlat)!;
  const regions = readStgRegions(stg.file.containers[flat.locationClickLogic].data);
  const tuner = regions.find((r) => r.name === "tuner")!;
  await session.stageCtrl.stageClickAt(
    Math.round((tuner.left + tuner.right) / 2),
    Math.round((tuner.top + tuner.bottom) / 2),
  );
  check(
    "clicking a control zooms into its flat (tuner -> big view)",
    session.currentFlat !== "wireless 1" && tunerneedle.stateName === "big",
    `flat=${session.currentFlat} tunerneedle=${tunerneedle.stateName}`,
  );
}
);

// --- 29. wireless knob drag: held-button (stilldown) rotates a control ------
test("wireless knob drag: held-button (stilldown) rotates a control", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("wireless.set");
  await session.transToFlat("wireless.stg");
  const v = viewer();
  await runAnimations(v); // the stage fades in; a drag started under it is queued
  await session.stageCtrl.gotoFlat("wireless 2"); // breaker big flat
  const breaker = session.propRuntime.get("breakerhandle")!;
  // the breaker lever's clickable pivot sits near (200,85); its big-view
  // mousedown enters a `while stilldown()` loop that sets propdeg from the
  // live pointer x — x>198 selects deg 4 -> owner "rx"
  session.setPointer(200, 85);
  session.pointerDown = true;
  const drag = session.track(v.click(200, 85));
  // pump the clock so stilldown()'s per-frame yield resolves, then release
  let done = false;
  drag.then(() => (done = true));
  for (let i = 0; i < 6 && !done; i++) {
    v.tick((clock += 50));
    await drain();
  }
  const draggedDeg = breaker.deg;
  session.pointerDown = false; // release ends the loop
  for (let i = 0; i < 8 && !done; i++) {
    v.tick((clock += 50));
    await drain();
  }
  await drag;
  check(
    "held-button drag rotates the breaker knob and commits on release",
    draggedDeg === 4 && breaker.owner === "rx",
    `deg-during=${draggedDeg} owner-after=${breaker.owner}`,
  );
}
);

// --- 30. wireless OK button: trackbut commits only if released over it ------
test("wireless OK button: trackbut commits only if released over it", async () => {
for (const [label, releaseX, releaseY, expectExit] of [
  ["released over OK -> exits the stage", 457, 350, true],
  ["released off OK -> stays in the stage", 100, 100, false],
] as [string, number, number, boolean][]) {
  const { session } = await newSession();
  await session.openSetFile("wireless.set");
  await session.transToFlat("wireless.stg");
  // OK button rect ~ (428..485, 338..363); press inside it
  session.setPointer(457, 350);
  session.pointerDown = true;
  const p = session.track(session.stageCtrl.stageClickAt(457, 350));
  let done = false;
  p.then(() => (done = true));
  for (let i = 0; i < 4 && !done; i++) {
    session.tickTime((clock += 50));
    await drain();
  }
  session.setPointer(releaseX, releaseY); // move to release point
  session.tickTime((clock += 50));
  await drain();
  session.pointerDown = false; // release
  for (let i = 0; i < 8 && !done; i++) {
    session.tickTime((clock += 50));
    await drain();
  }
  await p;
  const exited = session.stageName === "main.stg" && session.setVisible === true;
  check(`wireless OK: ${label}`, exited === expectExit, `stage=${session.stageName} setVisible=${session.setVisible}`);
}
});

// --- 31. wireless message readout: drawstring text layer accumulates/clears -
test("wireless message readout: drawstring text layer accumulates/clears", async () => {
  const { session } = await newSession();
  await session.openSetFile("wireless.set");
  await session.transToFlat("wireless.stg");
  // find the flat whose script owns the morse readout (drawtext/clearmessagebox)
  let readoutFlat: string | null = null;
  for (const fn of session.flatNames) {
    if (session.flatScripts.get(fn)?.script.codes.has("drawtext")) {
      readoutFlat = fn;
      break;
    }
  }
  await session.stageCtrl.gotoFlat(readoutFlat!);
  const inst = session.flatScripts.get(session.currentFlat)!;
  const ctx = { me: session.currentFlat, target: "" };
  const call = (h: string, a: (string | number)[] = []) =>
    session.interp.runHandler(inst, h, a, ctx);

  // clearmessagebox() resets the pen to 75 and flashes messageboxclear, whose
  // visibility hook wipes the text layer
  await call("clearmessagebox");
  const clearedFirst = session.textOverlay.length === 0;

  // each drawtext(letter) paints one glyph at the pen and advances the pen by
  // its stringwidth — so the layer grows and the x coordinates increase
  for (const ch of ["h", "e", "l", "l", "o"]) await call("drawtext", [ch]);
  const ov = session.textOverlay;
  const grew = ov.length === 5;
  const advancing = ov.every((e, i) => i === 0 || e.x > ov[i - 1].x);
  // the pen advanced past the left margin (messagebox value tracks the x pen)
  const penMoved = (session.propRuntime.get("messagebox")!.value as number) > 75;
  check(
    "wireless readout: drawtext lays out glyphs left-to-right",
    clearedFirst && grew && advancing && penMoved,
    `cleared=${clearedFirst} n=${ov.length} advancing=${advancing} pen=${session.propRuntime.get("messagebox")!.value}`,
  );

  // clearmessagebox() again empties the layer (messageboxclear shown -> hook)
  await call("clearmessagebox");
  check(
    "wireless readout: clearmessagebox() wipes the text layer",
    session.textOverlay.length === 0,
    `n=${session.textOverlay.length}`,
  );

  // a full line (pen past 340) auto-wraps: the next drawtext clears then draws
  // one glyph back at the left margin
  session.propRuntime.get("messagebox")!.value = 345;
  await call("drawtext", ["z"]);
  const wrapped = session.textOverlay.length === 1 && session.textOverlay[0].x < 100;
  check(
    "wireless readout: pen past the right edge wraps to a fresh line",
    wrapped,
    `n=${session.textOverlay.length} x=${session.textOverlay[0]?.x}`,
  );
}
);

// --- 32. wireless tuner gating: propxy getter + tuned() -> tunerknob "on" ----
test("wireless tuner gating: propxy getter + tuned() -> tunerknob \"on\"", async () => {
  const { session } = await newSession();
  await session.openSetFile("wireless.set");
  await session.transToFlat("wireless.stg");
  const needle = session.propRuntime.get("tunerneedle")!;
  const knob = session.propScripts.get("tunerknob")!;
  const runKnob = (h: string, a: any[] = []) =>
    session.interp.runHandler(knob, h, a, { me: "tunerknob", target: "" });

  // the needle's screen Y IS the frequency. adjustneedle() reads it via the
  // propxy(name,2) GETTER and writes it back via the setter — exercising both.
  needle.anchorX = 256;
  needle.anchorY = 100;
  await runKnob("adjustneedle", [2]);
  const movedY = needle.anchorY; // 100 -> 102 iff the propxy getter works

  // RX puzzle preconditions: sender on, breaker rx, needle in the 81-87 window
  session.propRuntime.get("senderhandle")!.owner = "on";
  session.propRuntime.get("breakerhandle")!.owner = "rx";
  session.propRuntime.get("tunerneedle")!.value = 84;
  const tunedIn = (await runKnob("tuned")).value;

  // off-window -> not tuned
  session.propRuntime.get("tunerneedle")!.value = 100;
  const tunedOut = (await runKnob("tuned")).value;

  // tuneron() latches the knob "on" and lights the tuner
  session.propRuntime.get("tunerneedle")!.value = 84;
  await runKnob("tuneron", ["big"]);
  const knobOwner = session.propRuntime.get("tunerknob")!.owner;
  const lit = session.propRuntime.get("tunerlight1")!.visible;

  check(
    "wireless tuner: propxy getter moves needle; tuned() gates; tuneron latches on",
    movedY === 102 && !!tunedIn && !tunedOut && knobOwner === "on" && lit,
    `movedY=${movedY} in=${tunedIn} out=${tunedOut} owner=${knobOwner} lit=${lit}`,
  );
}
);

// --- 33. wireless TX keydown routes to the flat script (not the stage main) --
test("wireless TX keydown routes to the flat script (not the stage main)", async () => {
  const { session } = await newSession();
  await session.openSetFile("wireless.set");
  await session.transToFlat("wireless.stg");
  // the deck-map-style stage routes keydown to the stage main; wireless routes
  // to the current FLAT (its keydown/tx lives there). On the readout flat the
  // target is that flat; the stage main has no keydown of its own.
  let readoutFlat: string | null = null;
  for (const fn of session.flatNames) {
    if (session.flatScripts.get(fn)?.script.codes.has("keydown")) { readoutFlat = fn; break; }
  }
  await session.stageCtrl.gotoFlat(readoutFlat!);
  const target = session.stageCtrl.keydownTarget();
  const isFlat = target === session.flatScripts.get(session.currentFlat);
  const stageHasNoKeydown = !session.stageScript!.script.codes.has("keydown");
  check(
    "wireless TX: keydown routes to the readout flat, not the stage main",
    isFlat && stageHasNoKeydown && target !== null,
    `target=${target?.name} stageKeydown=${!stageHasNoKeydown}`,
  );
}
);

// --- 34. puppetbase seats the character in a line's resting pose ----------
test("puppetbase seats the character in a line's resting pose", async () => {
  const { session } = await newSession();
  await session.puppetCtrl.openPuppetFile("bx2.pup");
  const hands1 = () => session.puppetCtrl.puppetFrame()?.layers[8]?.frame; // hands1 layer
  session.puppetCtrl.puppetBase("bx2.07"); // baby present -> hands1 holds it (frame 2)
  const withBaby = hands1();
  session.puppetCtrl.puppetBase("bx2.01"); // no baby -> hands1 hidden (-1)
  const noBaby = hands1();
  session.puppetCtrl.puppetBase(""); // revert to the neutral opening pose
  const reverted = session.puppetCtrl.puppetFrame() === session.puppet?.defaultPose;
  check(
    "puppetbase seats the character in a line's resting pose (bx2 baby)",
    withBaby === 2 && noBaby === -1 && reverted,
    `withBaby=${withBaby} noBaby=${noBaby} reverted=${reverted}`,
  );
  session.puppetCtrl.closePuppetFile();
}
);

// --- 34a. two people in one close-up: each line animates its OWN face -------
// The reported bug: "whenever there are two puppets side by side the mouth is
// over the wrong one". A PUP holds up to 64 stances and re-uses its eleven layer
// slots between them — WILZEIT1 (Willie and Colonel Zeitel, shoulder to shoulder)
// parks the animated `jaw` at x=171 in stances 0/1 (the left face) and at x=388
// in stance 2 (the right one), holding the silent one's mouth on another slot.
// Which stance a line is animated against is a field of the LINE (record+0), and
// the port used to pin stance 0 for the whole file: the anchors then still came
// from the tick (the talker's side of the frame) while the sprites came from
// stance 0 (the other face's lips), so the wrong mouth moved — and the layers
// stance 0 has fewer frames for clamped, smearing a second head over the first.
//
// The measure of that, needing no screenshot: a face layer's tick anchor sits
// within a few px of where its own stance parks that layer, and hundreds of px
// away when the stance is wrong.
test("two-character puppet: each line animates its own character's face", async () => {
  const { session } = await newSession();
  await session.puppetCtrl.openPuppetFile("wilzeit1.pup");
  const p = session.puppet!;
  const FACE = [2, 3, 4, 5, 6]; // head, eyes, eyebrows, nose, jaw
  /** how far this tick's face layers sit from where `stanceIdx` parks them */
  const drift = (stanceIdx: number, frame: PupAnimFrame | null): number => {
    const st = p.pup.stances[stanceIdx] ?? p.pup.stances[0];
    let worst = 0;
    for (const l of FACE) {
      const layer = st.layers[l];
      const rec = frame?.layers[l];
      if (!layer?.frames.length || !rec || rec.frame < 0) continue;
      worst = Math.max(worst, Math.abs(layer.anchorX - rec.x));
    }
    return worst;
  };

  // every line of the conversation, seated through the engine (puppetbase is the
  // synchronous half of the same stance switch puppetspeak does)
  let worstLive = 0;
  let worstPinned = 0; // the control: what pinning stance 0 would have drawn
  let live = "";
  let pinned = "";
  const stances = new Set<number>();
  for (const ident of p.pup.dialogue.keys()) {
    session.puppetCtrl.puppetBase(ident);
    const frame = session.puppetCtrl.puppetFrame();
    stances.add(session.puppet!.stanceIdx);
    const now = drift(session.puppet!.stanceIdx, frame);
    const then = drift(0, frame);
    if (now > worstLive) [worstLive, live] = [now, ident];
    if (then > worstPinned) [worstPinned, pinned] = [then, ident];
  }
  check(
    "a two-character puppet uses more than one stance across its lines",
    stances.size > 1,
    `stances seen: ${[...stances].sort().join(",")}`,
  );
  check(
    "every line's face layers land on the face its own stance parks them at",
    worstLive <= 16,
    `worst drift ${worstLive}px (${live}); pinning stance 0 drifts ${worstPinned}px (${pinned})`,
  );
  check(
    "and the fixture really does exercise it — stance 0 would be far out",
    worstPinned > 200,
    `stance-0 drift ${worstPinned}px (${pinned})`,
  );

  // the speak path switches stance too, and does it before the first tick is
  // drawn: wilzeit1.13 is one of Zeitel's lines (stance 2)
  const zeitel = p.pup.dialogue.get("wilzeit1.13")!;
  const speaking = session.puppetCtrl.puppetSpeak("wilzeit1.13");
  const spoken = session.puppet!.stanceIdx;
  const spokenDrift = drift(spoken, session.puppetCtrl.puppetFrame());
  check(
    "puppetspeak animates the line against the line's own stance",
    spoken === zeitel.stance && zeitel.stance !== 0 && spokenDrift <= 16,
    `stance=${spoken} (line says ${zeitel.stance}), drift ${spokenDrift}px`,
  );
  session.puppetCtrl.closePuppetFile();
  await speaking;
}
);

// --- 35. walkonpath: sentinel while moving, dest on arrival, endwalk fires -
test("walkonpath: sentinel while moving, dest on arrival, endwalk fires", async () => {
  const { session, viewer } = await newSession();
  session.interp.globals.set("mission", 1);
  session.interp.globals.set("tour", 1); // morrowidle idles in place (deterministic)
  await session.openSetFile("deckbd.set", "scene33", "view94");
  const v = viewer();
  const morrow = session.actorRuntime.get("morrow")!;
  session.interp.builtins.get("walkonpath")!(
    session.interp, ["morrow", "morrow.1", "morrow.2"], null as never, null as never,
  );
  // while walking, actorstar() reports the KIND of walk, never the destination
  // (TI.EXE 0x443ac0 stamps "defer" for both walktostar and walkonpath)
  const sentinel = morrow.starName === "defer" && session.scheduler.isWalk("morrow");
  let guard = 0;
  while (session.scheduler.isWalk("morrow") && guard++ < 500) { v.tick((clock += 100)); await drain(); }
  // let the arrival endwalk() dispatch run. It can take a further service pass:
  // an arrival never dispatches INTO a script that is in flight, it waits for
  // the next free pass (Scheduler.fireEndwalks) — which is the whole of the
  // accost-softlock fix, and the walk slot is already freed either way.
  for (let i = 0; i < 3; i++) { v.tick((clock += 100)); await drain(); }
  // on arrival: settles on the destination star + endwalk fired (morrowidle
  // reschedules itself as an actor loop — proof the arrival handler ran)
  const endwalkFired = session.scheduler.loops.some((l) => l.kind === "actor" && l.name === "morrow");
  check(
    "walkonpath: sentinel while moving, dest star on arrival, endwalk fires",
    sentinel && morrow.starName === "morrow.2" && endwalkFired,
    `sentinel=${sentinel} arrived=${morrow.starName} endwalkLoop=${endwalkFired}`,
  );
}
);

// --- 35b. walkdest() names the destination, so an interrupted patrol resumes -
// GANG.CST's `walktopuppet` is the only caller of `walkdest` in the corpus, and
// it is how a character you interrupt gets back to what they were doing:
//
//     if iswalk (who)
//         savestar = walkdest (who)
//         …
//     sendtoactor (who, moveactorstar (savestar))   → walktostar (me, savestar)
//
// so whatever `walkdest` answers has to be a name `walktostar` can resolve. We
// answered a packed (x<<16)|y point, which arrived as the star name
// "529465746" — that literal is straight out of #41's report, and 0x1f8f0192 is
// the pack of Max's decka destination. Every walking character on every deck
// stood still for the rest of the set once you had talked to them.
//
// TI.EXE's handler (0x4428e0) returns the walk record's +0x3e — the same field
// the arrival copies into `actorstar` — and "None" when no walk is running.
test("walkdest names the destination, so an interrupted walk can resume", async () => {
  const { session, viewer, logs } = await newHost();
  session.interp.globals.set("mission", 1);
  session.interp.globals.set("tour", 1);
  await session.openSetFile("deckbd.set", "scene33", "view94");
  const v = viewer();
  const morrow = session.actorRuntime.get("morrow")!;
  const walkto = session.interp.builtins.get("walktostar")!;
  const dest = () =>
    (session.interp.builtins.get("walkdest") as (i: unknown, a: string[]) => unknown)(
      session.interp, ["morrow"],
    );

  const idle = dest(); // no walk running
  await walkto(session.interp, ["morrow", "morrow.2"], null as never, null as never);
  const walking = dest();
  // mid-walk actorstar is the KIND, and walkdest is the WHERE — the two are
  // different strings, which is the whole point of the record having both
  const sentinel = morrow.starName === "defer";

  // now do what walktopuppet does: stop them, then send them back with the
  // saved value. This is the step that used to die on "not found".
  session.scheduler.stopWalk("morrow");
  const from = logs.length;
  await walkto(session.interp, ["morrow", walking as string], null as never, null as never);
  const resumed = session.scheduler.isWalk("morrow");
  const complained = logs.slice(from).some((l) => l.includes("walktostar:"));

  let guard = 0;
  while (session.scheduler.isWalk("morrow") && guard++ < 500) { v.tick((clock += 100)); await drain(); }
  check(
    "walkdest: names the destination mid-walk, resolves back through walktostar",
    idle === "None" && walking === "morrow.2" && sentinel && resumed && !complained,
    `idle=${JSON.stringify(idle)} walking=${JSON.stringify(walking)} ` +
      `sentinel=${morrow.starName} resumed=${resumed} complained=${complained}`,
  );
}
);

// --- 36. actor facing: sprite direction faces the camera (front, not back) -
test("actor facing: sprite direction faces the camera (front, not back)", async () => {
  const { session } = await newSession();
  await session.openSetFile("deckbd.set");
  const morrow = session.actorRuntime.get("morrow")!;
  const stand = morrow.member.poses.find((p) => p.name === "stand")!;
  morrow.poseName = "stand";
  morrow.step = 0;
  // actor due east of the camera → actor→camera bearing is 128 (west)
  morrow.worldX = 1000; morrow.worldY = 0; morrow.worldZ = 0; morrow.scale = 900;
  const cam = { x: 0, y: 0, z: 0, deg: 0, f: 256, cx: 256, cy: 132, clipW: 512, clipH: 264 };
  const proj = { x: 256, y: 132, depth: 482 };
  const front = morrow.cast.frame(stand.steps[0][0]!.location); // dir 0 (angle 0) = face toward viewer
  const back = morrow.cast.frame(stand.steps[0][4]!.location); //  dir 4 (angle 128) = back
  morrow.deg = 128; // facing the camera → must show the FRONT sprite
  const facing = session.actorRuntime.rect(morrow, proj, cam)?.f;
  morrow.deg = 0; // facing away (east, into the scene) → BACK sprite
  const away = session.actorRuntime.rect(morrow, proj, cam)?.f;
  check(
    "actor facing the camera shows the front sprite, not the back",
    facing === front && away === back,
    `facing=front?${facing === front} away=back?${away === back}`,
  );
}
);

// --- 37. trunk gramophone: clicking gramdrawerbut opens the drawer ----------
// Exercises the stage "button" dispatch: a region whose own script only sets
// the cursor forwards its mousedown up region -> flat -> stage main, keyed by
// target; the trunk main runs sendtoprop("gramdrawer", open()), and the prop's
// open() handler shows the drawer and (via makeloop) settles it to "idle".
test("trunk gramophone: clicking gramdrawerbut opens the drawer", async () => {
  const { session } = await newSession();
  await session.openSetFile("b59.set");
  await session.transToFlat("trunk.stg");
  await session.stageCtrl.gotoFlat("Trunk 2");
  const gd = session.propRuntime.get("gramdrawer")!;
  const before = gd.visible;
  await session.stageCtrl.stageClickAt(344, 328); // gramdrawerbut region center
  const openedView = gd.stateName;
  for (let i = 0; i < 8; i++) { session.tickTime((clock += 66)); await drain(); } // makeloop -> idle
  check(
    "trunk: gramdrawerbut opens the drawer (region->stage main->sendtoprop open())",
    !before && gd.visible && openedView.startsWith("open") && gd.stateName.startsWith("idle"),
    `before=${before} openedView=${openedView} settled=${gd.stateName}`,
  );
}
);

// --- 38. trunk: pointinbutton hit-tests a flat's named click-region ---------
test("trunk: pointinbutton hit-tests a flat's named click-region", async () => {
  const { session } = await newSession();
  await session.openSetFile("b59.set");
  await session.transToFlat("trunk.stg");
  await session.stageCtrl.gotoFlat("Trunk 2");
  const pib = session.interp.builtins.get("pointinbutton")!;
  const pt = (x: number, y: number) => ((x & 0xffff) << 16) | (y & 0xffff);
  const flat = session.currentFlat; // "Trunk 2"
  // wax1 drop-slot region ~ [391,304,437,358]
  const inside = pib(session.interp, [flat, "wax1", pt(414, 331)], null as never, null as never);
  const outside = pib(session.interp, [flat, "wax1", pt(10, 10)], null as never, null as never);
  const nosuch = pib(session.interp, [flat, "nope", pt(414, 331)], null as never, null as never);
  check(
    "trunk: pointinbutton is 1 inside a flat region, 0 outside / unknown",
    inside === 1 && outside === 0 && nosuch === 0,
    `in=${inside} out=${outside} nosuch=${nosuch}`,
  );
}
);

// --- 39. substring(haystack, needle) is a 1-based find, not a slice ---------
// Scripts gate on it: `substring(propview(me),"idle") >= 0` (trunk drawer),
// `substring(path(1),"titanic1:") = 1` (prefix), and ENIGMA's key mapping
// `substring("abcdefghijklmnopqrstuvwxyz ", arg) - 1` needs 'a' -> 1.
test("substring(haystack, needle) is a 1-based find, not a slice", async () => {
  const { session } = await newSession();
  const sub = session.interp.builtins.get("substring")!;
  const call = (s: string, n: string) => sub(session.interp, [s, n], null as never, null as never);
  check(
    "substring is a 1-based case-insensitive find (-1 when absent)",
    call("abcdefghijklmnopqrstuvwxyz ", "a") === 1 && call("abcdefghijklmnopqrstuvwxyz ", "c") === 3 &&
      call("idle12", "idle") === 1 && call("open2", "idle") === -1 &&
      call("Titanic1:foo", "titanic1:") === 1,
    `a=${call("abcdefghijklmnopqrstuvwxyz ", "a")} c=${call("abcdefghijklmnopqrstuvwxyz ", "c")} miss=${call("open2", "idle")}`,
  );
}
);

// --- 40. putword/findword round-trip (save/restore prop lists) --------------
// hideenigma/hidetrunk save each prop's visibility into a slot string via
// putword, then showX reads it back with findword.
//
// An empty delimiter is CHARACTER mode, not a default separator of space — the
// arm at TI.EXE 0x428c5f returns a one-character result, `source[idx]`, and ""
// when the idx falls outside the string (see the builtin). The shipped saves are
// the corroboration: they carry `saveprops2 = "11111101100111110"`, dense, 17
// characters for the 17 indices the scripts read back, and the space-joined form
// this test used to assert matched none of them.
test("putword/findword round-trip (save/restore prop lists)", async () => {
  const { session } = await newSession();
  const put = session.interp.builtins.get("putword")!;
  const find = session.interp.builtins.get("findword")!;
  const B = session.interp;
  const P = (s: unknown, d: string, i: number, w: string) =>
    put(B, [s as never, d, i, w], null as never, null as never);
  const F = (s: string, d: string, i: number) => find(B, [s, d, i], null as never, null as never);

  // the shape every saveprops in the game is built with: from "", one slot per
  // pass, which is the append arm throughout
  let s: any = "";
  for (const [i, bit] of ["1", "0", "1"].entries()) s = P(s, "", i + 1, bit);
  const readBack = [1, 2, 3].map((i) => F(s, "", i));
  check("putword builds the dense string the original wrote", s === "101", `s="${s}"`);
  check("findword reads it back a character at a time", readBack.join("") === "101", readBack.join(","));

  // out of range both ways, and the one-past-the-end append that builds it
  check("findword past the end is empty", F("101", "", 4) === "" && F("101", "", 0) === "", "");
  check("putword past one-past-the-end is empty", P("101", "", 5, "1") === "", `${P("101", "", 5, "1")}`);

  // inside the string putword INSERTS rather than replaces (0x428fc0 memmoves
  // the tail right and writes the word in front of it, deleting nothing). No
  // script takes this arm — they all build from "" — but the rule is the rule.
  check("putword inside the string inserts", P("101", "", 2, "1") === "1101", `${P("101", "", 2, "1")}`);

  // an explicit delimiter is unchanged: real word lists, still split on it
  check("an explicit delimiter still splits", F("a,b,c", ",", 2) === "b", `${F("a,b,c", ",", 2)}`);
  check("and putword replaces that word", P("a,b,c", ",", 2, "z") === "a,z,c", `${P("a,b,c", ",", 2, "z")}`);

  // the three uses in the game that settle it without the disassembly
  check("the keypad's letter", F("thayer", "", 3) === "a", `${F("thayer", "", 3)}`);
  check("the morse tapper's space survives", F("- .", "", 2) === " ", `"${F("- .", "", 2)}"`);
  check(
    "a crowd star comes apart by position",
    F("ex.a.1", "", 4) === "a" && F("ex.a.1", "", 6) === "1",
    `${F("ex.a.1", "", 4)}/${F("ex.a.1", "", 6)}`,
  );
}
);

// --- 41. ENIGMA decode logic: dial gate + typed message accumulation --------
// With power on (switch + wires) and the dials at the mission's unlock combo,
// checkey() lets typed letters accumulate into dialmess (dialset() gates the
// first letter); a decode compares dialmess to goodmess. Drives the real stage
// keydown handler; the powerup animation is bypassed by seeding state directly.
test("ENIGMA decode logic: dial gate + typed message accumulation", async () => {
  const { session } = await newSession();
  await session.openSetFile("b59.set");
  await session.transToFlat("enigma.stg");
  session.interp.globals.set("mission", 1);
  const set = (n: string, deg: number) => { const p = session.propRuntime.get(n); if (p) p.deg = deg; };
  set("enigsw", 1); // switchon()
  set("enigwirer", 0); set("enigwireg", 0); // wireson()
  set("zeitgram", 0); // -> combo 8,7,5,4 ; goodmess below
  set("dial1", 8); set("dial2", 7); set("dial3", 5); set("dial4", 4);
  const goodmess = "anhqsppaixwbfcxyam";
  session.interp.globals.set("goodmess", goodmess);
  session.interp.globals.set("dialmess", "");
  const kd = session.stageCtrl.keydownTarget()!;
  const type = async (ch: string) =>
    session.interp.runHandler(kd, "keydown", [ch], { me: kd.name, target: kd.name });
  const beforeGate = session.stageCtrl.keydownTarget()?.script.codes.has("keydown");
  for (const ch of goodmess) await type(ch);
  const dialmess = session.interp.globals.get("dialmess");
  check(
    "enigma: powered + dials set -> typed letters accumulate into dialmess == goodmess",
    beforeGate === true && dialmess === goodmess,
    `dialmess="${dialmess}"`,
  );
  // negative: with the dials WRONG, dialset() fails so the first letter is
  // rejected and dialmess stays empty
  session.interp.globals.set("dialmess", "");
  set("dial4", 0); // break the combo
  for (const ch of goodmess) await type(ch);
  check(
    "enigma: wrong dial combo -> dialset() gate keeps dialmess empty",
    session.interp.globals.get("dialmess") === "",
    `dialmess="${session.interp.globals.get("dialmess")}"`,
  );
}
);

// --- 42. BOIL boiler chute: door opens, switch slides the gate + flips flat -
// Reuses the shared machinery with no new opcodes: prop mousedowns (own
// scripts), sendtoprop up()/down(), the soundloop-flagged slide, and gotoflat
// between the two flats (boil 1 closed <-> boil 2 chute revealed).
test("BOIL boiler chute: door opens, switch slides the gate + flips flat", async () => {
  const { session } = await newSession();
  await session.openSetFile("b59.set");
  await session.transToFlat("boil.stg");
  await session.stageCtrl.gotoFlat("boil 1");
  const door = session.propRuntime.get("boildoor")!;
  const sw = session.propRuntime.get("boilswitch")!;
  const fire = async (name: string) => {
    const inst = session.propScripts.get(name)!;
    await session.interp.runHandler(inst, "mousedown", [name], { me: name, target: name });
    await drain();
  };
  const startFlat = session.currentFlat;
  await fire("boildoor"); // idleclosed -> idleopen
  const doorOpen = door.stateName;
  await fire("boilswitch"); // idleup -> down; boilgate.down() slides + gotoflat(2)
  const afterDown = { sw: sw.stateName, flat: session.currentFlat };
  await fire("boilswitch"); // idledown -> up; boilgate.up() -> gotoflat(1)
  const afterUp = { sw: sw.stateName, flat: session.currentFlat };
  check(
    "boil: door opens; switch slides the gate and flips flat 1<->2",
    startFlat === "boil 1" && doorOpen === "idleopen" &&
      afterDown.sw === "idledown" && afterDown.flat === "boil 2" &&
      afterUp.sw === "idleup" && afterUp.flat === "boil 1",
    `door=${doorOpen} down=${JSON.stringify(afterDown)} up=${JSON.stringify(afterUp)}`,
  );
}
);

// --- 43. a close-up's controls never reach the room, or the save panel ------
// #17 and #18. Five rooms share their name with a shop — boil, cargo, turk,
// wireless, bridge — and all five of those shops belong to the room's CLOSE-UP
// STAGE, which opens them in `openstage` and closes them in `closestage`.
// Entering the room opened them too, and `openshop` parks their controls at
// screen 256,192 and makes them visible (BOIL.SHP: boilbag, boildoor,
// boilswitch; CARGO.SHP: cargopainting, cargobag).
//
// In the room that was merely invisible, because the set view draws boot-UI
// shops only. But that filter is the set view's, and the CTL save panel is not
// the set view: opening it drew the coal-chute door and the painting crate over
// the menu in the panel's own palette, and left them clickable. Clicking the
// crate's painting ran the real `mousedown` and put the painting in your bag
// during mission 1 — which is a softlock, since M2P1's crate is then empty and
// Penny never moves off her cargo-hold clues.
//
// Assert both halves: the room arrives clean, the panel over it stays its own,
// and the stage still gets its shop when you actually open the close-up.
test("a close-up stage's controls reach neither the room nor the save panel", async () => {
  for (const [set, stg, control] of [
    ["boil.set", "boil.stg", "boildoor"],
    ["cargo.set", "cargo.stg", "cargopainting"],
  ]) {
    const { session } = await newSession();
    session.interp.globals.set("mission", 1);
    await session.openSetFile(set);
    await session.settle(200);
    const roomClean = !session.propRuntime.shops.has(stg.replace(".stg", ".shp")) &&
      !session.propRuntime.get(control);

    // the save panel, which is where it showed: nothing of the close-up's may
    // answer a hittest anywhere on it
    await session.runGlobal("transtoflat", ["ctl.stg"]);
    await session.settle(200);
    let leaked = "";
    for (let y = 4; y < 384 && !leaked; y += 6) {
      for (let x = 4; x < 512; x += 6) {
        const h = session.hitTestAt(x, y);
        if (h.type === "prop" && h.name.toLowerCase().startsWith(stg.slice(0, 4))) {
          leaked = `${h.name}@${x},${y}`;
          break;
        }
      }
    }
    await session.runGlobal("transfromflat", []);
    await session.settle(200);

    // and the close-up itself still works — the stage opens its own shop
    await session.runGlobal("transtoflat", [stg]);
    await session.settle(200);
    const stageHasIt = !!session.propRuntime.get(control)?.visible;
    check(
      `${set}: the close-up's controls belong to ${stg}, not to the room`,
      roomClean && leaked === "" && stageHasIt,
      `roomClean=${roomClean} leakedOverPanel=${leaked || "none"} onStage=${stageHasIt}`,
    );
  }
}
);

// --- 44. per-deck theme selection via changeset -> setupsound --------------
// Themes are named by DECK, not by set (recept1c -> deckd.trk, halla ->
// decka.trk); BOOTFILE setupsound() picks them on set entry. Two bugs made
// rooms silent: (1) a set's openset passcodes to boot's setupsound but first
// fires sendtoactor(setupactor()) whose handler exitcodes — the shared
// eventConsumed flag leaked and fireLifecycle skipped boot's openset; (2) the
// lowmemory() deck path (decka/deckb/decke/deckf/cargo) loaded the .11k bank
// while playnewtheme asked for the .trk, because heapsize() reported 0. This
// exercises the authentic boot changeset() path end to end.
test("per-deck theme selection via changeset -> setupsound", async () => {
  const { session } = await newSession();
  await session.runGlobal("changeset", ["recept1c", "", ""]); // deckd, no lowmemory branch
  const deckd = session.currentThemeName;
  await session.runGlobal("changeset", ["halla", "", ""]); // decka, via lowmemory() branch
  const decka = session.currentThemeName;
  // same-deck travel must keep the theme playing (setupsound exits early)
  let themePlays = 0;
  const origPlay = session.audio.play.bind(session.audio);
  (session.audio as unknown as { play: unknown }).play = (ch: string, a: unknown, o: unknown) => {
    if (ch === "theme") themePlays++;
    return (origPlay as (c: string, a: unknown, o: unknown) => unknown)(ch, a, o);
  };
  await session.runGlobal("changeset", ["lnghall", "", ""]); // decka again -> no change
  const stayed = session.currentThemeName;
  check(
    "themes are chosen per deck; same-deck travel is seamless",
    deckd === "deckd.trk" && decka === "decka.trk" && stayed === "decka.trk" && themePlays === 0,
    `recept1c=${deckd} halla=${decka} lnghall=${stayed} sameDeckReplays=${themePlays}`,
  );
}
);

// --- 45. BOMB defuse: hit-test routing, changedone, timer loop, OK win ------
// The bomb is a timed multi-switch logic puzzle. Exercises: openstage setup;
// authentic click routing (hit-test which prop is drawn under a region, then
// dispatch its mousedown with the point — the prop's own pointinbutton reads
// the sub-region); changedone() re-evaluation; the NEW stage-flat self-re-arming
// timer (makeloop("flat", currentflat(), "unibomnoise", …) firing the stage
// handler each service step, sweeping the second hand); and the hitok() win
// (door open + key out + power spent -> addinven + transfromflat).
test("BOMB defuse: hit-test routing, changedone, timer loop, OK win", async () => {
  const { session } = await newSession();
  await session.openSetFile("b59.set");
  await session.transToFlat("bomb.stg");
  await drain();
  const g = (n: string): unknown => session.interp.globals.get(n);
  const setup = {
    door: g("unibomdoor"),
    power: g("unibompower"),
    sw1: session.propRuntime.get("switch1")?.deg,
  };
  const center = (name: string): [number, number] => {
    const r = session.stageCtrl.flatRegion(session.currentFlat, name)!;
    return [Math.floor((r.left + r.right) / 2), Math.floor((r.top + r.bottom) / 2)];
  };
  const pt = (x: number, y: number): number => (x << 16) | (y & 0xffff);
  const clickRegion = async (name: string): Promise<void> => {
    const [x, y] = center(name);
    session.pointerX = x;
    session.pointerY = y;
    const p = session.propRuntime.propAt(x, y, null, false)!; // prop drawn there
    const inst = session.propScripts.get(p.group.name)!;
    await session.interp.runHandler(inst, "mousedown", [pt(x, y)], {
      me: p.group.name,
      target: p.group.name,
    });
    await drain();
  };
  await clickRegion("3B"); // top switch -> power on, starts the countdown
  const poweredOn =
    g("unibompower") === 1 &&
    session.scheduler.loops.some((l) => l.kind === "flat" && l.handler === "unibomnoise") &&
    session.currentThemeName === "bomb.trk";
  const tin0 = session.propRuntime.get("tinhands")?.deg ?? 0;
  let now = 0;
  for (let i = 0; i < 90; i++) {
    session.tickTime((now += 66));
    session.scheduler.serviceFrameLoops(); // a frame also services per-frame (period-1) loops
    await drain();
  }
  const ticked = (session.propRuntime.get("tinhands")?.deg ?? 0) > tin0;
  // win: reach the OK-accepted state directly, then hit OK -> hitok() leaves
  session.interp.globals.set("unibomdoor", 0);
  session.interp.globals.set("unibompower", -1);
  session.propRuntime.get("key")!.deg = 5;
  const flatBefore = session.currentFlat;
  await session.stageCtrl.sendToButton(session.currentFlat, "OK", "mousedown", [pt(...center("OK"))], "OK");
  await drain();
  const won = flatBefore === "Bomb 1" && session.currentFlat !== "Bomb 1";
  check(
    "bomb: openstage setup, click routing, ticking timer loop, OK win",
    setup.door === 1 && setup.power === 0 && setup.sw1 === 1 && poweredOn && ticked && won,
    `setup=${JSON.stringify(setup)} poweredOn=${poweredOn} ticked=${ticked} leftFlat=${won}`,
  );
}
);

// --- 46. TURBINE plant: continuous sim loop, control -> gauge response ------
// A steam-plant simulation: valves/pumps/slider feed a physics step
// (iterateone) that moves water between boiler/turbine/condensor/steamtank and
// derives pressures/temps/electricity, read out on 20-frame gauges. The sim
// self-re-arms via makeloop("flat",…,"changedone",10) (same loop machinery as
// BOMB). Exercises sendtostagefx (controls read `valve = sendtostagefx(
// degtonum(...))`), framerate() round-trip, and the gauge mapping (numtodeg).
test("TURBINE plant: continuous sim loop, control -> gauge response", async () => {
  const { session } = await newSession();
  await session.openSetFile("turb.set");
  await session.transToFlat("turbine.stg");
  await drain();
  const g = (n: string): number => Number(session.interp.globals.get(n) ?? 0);
  const stageName = session.stageScript!.name;
  const runSim = (): Promise<unknown> =>
    session.sendEvent("sendtostage", stageName, "changedone", [], "test");
  const loopArmed = session.scheduler.loops.some((l) => l.kind === "flat" && l.handler === "changedone");
  const valve1Init = g("valve1"); // initvalue() sets 50
  // boilpres = boiler * valve3 / 400 — higher valve3 must raise boiler pressure
  session.interp.globals.set("boiler", 80000);
  session.interp.globals.set("valve3", 2);
  await runSim();
  const presLow = g("boilpres");
  session.interp.globals.set("boiler", 80000);
  session.interp.globals.set("valve3", 76);
  await runSim();
  const presHigh = g("boilpres");
  // gauge reflects the sim: pressure1 deg == numtodeg(boilpres, 5000) clamped 0..19
  const expectDeg = Math.max(0, Math.min(19, Math.floor((g("boilpres") * 19) / 5000)));
  const gaugeDeg = session.propRuntime.get("pressure1")?.deg;
  // slider parse-regression: boilsound ends with a bare `exitcode` (no
  // `endcode`), which used to make it swallow the following calcswitchdeg
  // handler — the slider then read 0 always and pinned to one end. Verify the
  // handler survives parsing and maps mouse-Y (245..345) -> deg 0..20.
  const slider = session.propScripts.get("slider")!;
  const hasCalc = slider.script.codes.has("calcswitchdeg");
  session.setPointer(239, 290);
  const calcMid = Number(
    (await session.interp.runHandler(slider, "calcswitchdeg", [], { me: "slider", target: "slider" })).value,
  );
  check(
    "turbine: sim loop, control raises pressure, gauge tracks; slider handler parses",
    loopArmed && valve1Init === 50 && presHigh > presLow && gaugeDeg === expectDeg &&
      hasCalc && calcMid === 9,
    `loop=${loopArmed} valve1=${valve1Init} presLow=${presLow} presHigh=${presHigh} gauge=${gaugeDeg} expect=${expectDeg} calcswitchdeg?${hasCalc} mid=${calcMid}`,
  );
}
);

// --- 47. BLACKJACK: deal + variable() + transToFlat lifts transition-black --
// Self-contained game (shuffle/deal/hit/dealer/win) launched from a dealer
// puppet. Exercises variable(name[,val]) dynamic globals (playercount via
// `variable(who @ "count")`), and the fade-lift: HOUSE screentoblack("puppet")s
// the dealer out THEN transtoflat("blkjack.stg") — the reveal is a wipe
// visualeffect we render instantly, so transToFlat must clear the leftover
// black or the table stays dark ("black screen after the talk").
test("BLACKJACK: deal + variable() + transToFlat lifts transition-black", async () => {
  const { session } = await newSession();
  // simulate the post-dialog state: screen faded to black + stale snapshot
  session.fade.level = 1;
  session.fade.snapshot = { rgba: new Uint8ClampedArray(4), width: 1, height: 1 };
  session.fade.queue.push({ to: 1, steps: 10 });
  session.interp.globals.set("firsthand", 1);
  session.interp.globals.set("mission", 1);
  await session.openSetFile("halla.set");
  // transToFlat -> openStageFile now deals the opening hand itself (the boot's
  // per-stage initgame hook), just like the real Buick entry — so pump the
  // clock while it runs (each dealt card spins forceupdate 19x in take()).
  let now = 0;
  const p = session.transToFlat("blkjack.stg");
  let done = false;
  void p.then(() => (done = true)).catch(() => (done = true));
  for (let i = 0; i < 3000 && !done; i++) {
    session.tickTime((now += 66));
    await drain();
  }
  await p;
  const fadeLifted = session.fade.level === 0 && !session.fade.snapshot && session.fade.queue.length === 0;
  const g = (n: string): number => Number(session.interp.globals.get(n) ?? -1);
  // both hands got two cards; playerphase is set (1 mid-hand, 0 if the opening
  // deal was itself a blackjack/gameover — either way the deal ran)
  const dealt = g("playercount") === 2 && g("dealercount") === 2 && g("playerphase") >= 0;
  // variable() drives the per-side counts
  const varWorks = Number(session.interp.globals.get("playercount")) === 2;
  check(
    "blackjack: transToFlat deals via the boot initgame hook + lifts transition-black",
    fadeLifted && dealt && varWorks,
    `fadeLifted=${fadeLifted} player=${g("playertotal")}(${g("playercount")}) dealer=${g("dealertotal")}(${g("dealercount")}) phase=${g("playerphase")}`,
  );
  // regression: blkjack.shp ships playerscores AND dealerscores as its own
  // groups (same anchor, different baked offsets -> player-side vs dealer-side).
  // openshop calls propinstance("playerscores","dealerscores"); that must NOT
  // replace dealerscores' group with playerscores' or the two totals collapse
  // onto each other at the end of the hand.
  const ps = session.propRuntime.get("playerscores");
  const ds = session.propRuntime.get("dealerscores");
  check(
    "blackjack: player/dealer score props keep distinct groups (propinstance doesn't clobber dealerscores)",
    !!ps && !!ds && ps.group !== ds.group,
    `player=${!!ps} dealer=${!!ds} sameGroup=${ps?.group === ds?.group}`,
  );
}
);

// --- 48a. propxyz answers as a getter, and does not MOVE what it is asked about
// Regression for segment 23's notebook: `propxyz` was setter-only, so
// inven.shp's `realdist(name)` — `calcdist(propxyz(name, 4), playerxyz(4))` —
// fell through into the setter and parked the prop at (4, 0, 0). Every object
// lying in a room is taken through `if realdist(what) < hotdist()`, so nothing
// in a room could be picked up: the notebook's click ran the whole handler
// (phase advanced, Zeitel walked over) and left the notebook on the platform.
test("propxyz is a getter too, and reading a position does not change it", async () => {
  const { session } = await newSession();
  await session.openSetFile("smoke.set");
  const table = session.propRuntime.get("blkjacktable")!;
  const was = { x: table.worldX, y: table.worldY, z: table.worldZ };
  const call = (args: unknown[]): unknown =>
    session.interp.builtins.get("propxyz")!(
      session.interp,
      args as never,
      { t: "call", name: "propxyz", args: [] } as never,
      null as never,
    );
  const axes = [call(["blkjacktable", 1]), call(["blkjacktable", 2]), call(["blkjacktable", 3])];
  const packed = Number(call(["blkjacktable", 4]));
  const unchanged = table.worldX === was.x && table.worldY === was.y && table.worldZ === was.z;
  check(
    "propxyz(name, axis) reads x/y/z and the packed ground point, leaving the prop where it is",
    unchanged &&
      axes[0] === was.x &&
      axes[1] === was.y &&
      axes[2] === was.z &&
      ((packed >> 16) & 0xffff) === (was.x & 0xffff) &&
      (packed & 0xffff) === (was.y & 0xffff),
    `axes=${JSON.stringify(axes)} packed=${packed} was=${JSON.stringify(was)} now=(${table.worldX},${table.worldY},${table.worldZ})`,
  );
});

// --- 48. smoke: blkjacktable is a world prop placed by propstar ------------
// Regression for "Buck Riviera and his table float fixed-centre": propstar was
// unimplemented, so the (persistent HOUSE.SHP) table stayed a screen-space
// overlay pinned at the anchor centre over every view. propstar must bind it
// into the world at the "buick" star, and propdeg must orient it (directional
// sprite) instead of clamping+locking a frame.
test("smoke: blkjacktable is a world prop placed by propstar", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("smoke.set");
  await runAnimations(viewer());
  const table = session.propRuntime.get("blkjacktable")!;
  const flames = session.propRuntime.get("flames")!;
  const buick = session.currentBinding!.set.actors.find((a) => a.identifier.toLowerCase() === "buick")!;
  const placed =
    table.worldSpace &&
    table.setName === "smoke" &&
    table.scale > 0 &&
    table.worldX === buick.positionX &&
    table.worldY === buick.positionZ &&
    table.directional &&
    !table.frameLocked &&
    Number(table.deg) === 250; // propdeg(250) overrides the star's rotation seed
  // directional frame tracks the camera: two opposite bearings pick different frames
  const nf = table.state()!.frames.length;
  const frameAt = (camDeg: number): number => {
    // mirror worldFrameIdx: rel = deg - bearing(prop->camera)
    const cam = viewer().worldCamera()!;
    const dx = cam.x - table.worldX;
    const dy = cam.y - table.worldY;
    const bearing = Math.round((Math.atan2(dy, dx) * 256) / (2 * Math.PI)) & 0xff;
    void camDeg;
    return Math.round((((Number(table.deg) - bearing) & 0xff) * nf) / 256) % nf;
  };
  check(
    "smoke: blkjacktable placed in the world by propstar (not floating at centre)",
    placed && flames.worldSpace && flames.directional && nf === 32 && frameAt(0) >= 0,
    `world=${table.worldSpace} set=${table.setName} scale=${table.scale} dir=${table.directional} locked=${table.frameLocked} deg=${table.deg} @(${table.worldX},${table.worldY}) star=(${buick.positionX},${buick.positionZ}) flamesWorld=${flames.worldSpace} frames=${nf}`,
  );
}
);

// --- 49. blackjack entry through Buick hides the puppet to reveal the table -
// Regression for "hangs with Buick, no table": the dealer puppet stays LOADED
// while you play (for the "play again?" prompt), but puppetvisible(false) — a
// stub before — must hide it so the flat renders and hit/stay clicks reach the
// table. newgame() (via the boot initgame hook) calls puppetvisible(false), so
// after the deal the puppet is hidden but not closed, and the viewer is no
// longer "busy" on it.
test("blackjack entry through Buick hides the puppet to reveal the table", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("smoke.set");
  await runAnimations(viewer());
  session.interp.globals.set("firsthand", 1);
  session.interp.globals.set("mission", 1);
  await session.puppetCtrl.openPuppetFile("blkjack1.pup");
  const shownDuringTalk = session.puppet?.visible === true && viewer().busy;
  // enter the table (deals via the boot initgame hook); pump the clock
  let now = 0;
  const p = session.transToFlat("blkjack.stg");
  let done = false;
  void p.then(() => (done = true)).catch(() => (done = true));
  for (let i = 0; i < 3000 && !done; i++) {
    session.tickTime((now += 66));
    await drain();
  }
  await p;
  const g = (n: string): number => Number(session.interp.globals.get(n) ?? -1);
  const hiddenForTable =
    session.puppet !== null && // still loaded for the play-again prompt
    session.puppet.visible === false && // but hidden so the table shows
    !viewer().busy && // not blocking hit/stay input
    g("playercount") === 2 &&
    g("dealercount") === 2;
  check(
    "blackjack: entering through Buick hides the puppet and deals the table",
    shownDuringTalk && hiddenForTable,
    `shownDuringTalk=${shownDuringTalk} loaded=${session.puppet !== null} visible=${session.puppet?.visible} busy=${viewer().busy} player=${g("playercount")} dealer=${g("dealercount")}`,
  );
}
);

// --- 50. blackjack: a finished hand offers "play again"; Yes re-deals -------
// Regression for "does not nicely end and is not repeatable": newgame() asks
// the dealer `sendtopuppetfx("boot script", playagain())` whether to deal
// again. sendtopuppetfx wasn't a registered deferred-call form, so its
// playagain() argument evaluated locally and recursed forever. With it fixed,
// finishing a hand re-shows Buick (puppetvisible true) with Yes/No bevels, and
// Yes deals a fresh hand.
test("blackjack: a finished hand offers \"play again\"; Yes re-deals", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("smoke.set");
  await runAnimations(viewer());
  session.interp.globals.set("firsthand", 1);
  session.interp.globals.set("mission", 1);
  await session.puppetCtrl.openPuppetFile("blkjack1.pup");
  let now = 0;
  const pump = async (until: () => boolean, max = 8000): Promise<boolean> => {
    for (let i = 0; i < max && !until(); i++) {
      session.tickTime((now += 66));
      await drain();
    }
    return until();
  };
  const g = (n: string): number => Number(session.interp.globals.get(n) ?? -1);
  // enter + deal via the boot initgame hook
  const enter = session.transToFlat("blkjack.stg");
  let entered = false;
  void enter.then(() => (entered = true));
  const dealt = await pump(() => entered) && g("playercount") === 2;
  // stand -> dealer draws to completion -> gameover schedules the newgame loop.
  // Run dealerdraw as the STAY REGION does — with me = the region name, NOT the
  // flat (regions dispatch with me=region and flat handlers inherit it). This is
  // what broke the browser: gameover's makeloop("flat", me, "newgame") then
  // captured the region name; fireLoop must target the current flat regardless.
  if (g("playerphase") === 1) {
    session.interp.globals.set("playerstand", 1);
    const flat = session.flatScripts.get(session.currentFlat.toLowerCase())!;
    void session.track(
      session.interp.runHandler(flat, "dealerdraw", [], { me: "staybevel", target: "staybevel" }),
    );
  }
  // the newgame loop fires playagain(): Buick returns (visible) with Yes/No
  const offered = await pump(
    () => (session.puppet?.visible ?? false) && (session.puppet?.bevels.length ?? 0) === 2,
  );
  // click "Yes" (bevel index 0, id 101) -> playagain() true -> a fresh hand.
  // playerphase was 0 at the prompt (gameover); a re-deal drives it back to 1
  // with two fresh cards. (Don't assert the puppet is hidden — if the re-dealt
  // hand is itself an instant blackjack it bounces straight back to the prompt.)
  session.puppetCtrl.puppetChoose(0);
  const replayed = await pump(() => g("playerphase") === 1 && g("playercount") === 2);
  check(
    "blackjack: a finished hand offers play-again via Buick; Yes re-deals",
    dealt && offered && replayed,
    `dealt=${dealt} offered=${offered} replayed=${replayed} visible=${session.puppet?.visible} phase=${g("playerphase")} pc=${g("playercount")}`,
  );
}
);

// --- 51. blackjack score readout shows the right number (propdeg by degree) -
// Regression for "cards counted +1": showscores does propdeg(who@"scores",
// total), and the score sprite's frames store degrees 2,3,…,21,BUST=22,
// BLACKJACK=23 — offset ~2 from their frame index. Selecting the frame WHOSE
// DEGREE equals the total (not the total-th frame) makes the digit match.
test("blackjack score readout shows the right number (propdeg by degree)", async () => {
  const { session } = await newSession();
  await session.openSetFile("smoke.set");
  session.interp.globals.set("firsthand", 1);
  session.interp.globals.set("mission", 1);
  let now = 0;
  const pump = async (until: () => boolean, max = 3000): Promise<boolean> => {
    for (let i = 0; i < max && !until(); i++) {
      session.tickTime((now += 66));
      await drain();
    }
    return until();
  };
  const enter = session.transToFlat("blkjack.stg");
  let entered = false;
  void enter.then(() => (entered = true));
  await pump(() => entered);
  const flat = session.flatScripts.get(session.currentFlat.toLowerCase())!;
  const scores = session.propRuntime.get("playerscores")!;
  const degAt = (): number => scores.state()!.degrees[scores.frameIdx];
  // a plain total: the shown frame's degree must equal the total
  session.interp.globals.set("playertotal", 17);
  session.interp.globals.set("playercount", 3);
  await session.interp.runHandler(flat, "showscores", ["player"], { me: flat.name, target: "" });
  const at17 = degAt();
  // a bust: total > 21 -> propdeg(22) -> the BUST frame (degree 22)
  session.interp.globals.set("playertotal", 24);
  await session.interp.runHandler(flat, "showscores", ["player"], { me: flat.name, target: "" });
  const atBust = degAt();
  check(
    "blackjack: the score readout frame's degree matches the total (no +1/+2 skew)",
    at17 === 17 && atBust === 22,
    `deg@17=${at17} deg@bust=${atBust} frames=${scores.state()!.degrees.length}`,
  );
}
);

// --- 52. world sprites keep a camera during movement (no vanish on turn) ----
// Regression for "actors vanish while moving, reappear at the standpoint": each
// motion frame carries its own camera (posX16/axisX8), so the viewer projects
// actors/world props THROUGHOUT a turn instead of only at rest. activeCamera()
// returns the moving motion-frame camera mid-turn and the standpoint at rest.
test("world sprites keep a camera during movement (no vanish on turn)", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("smoke.set");
  const v = viewer();
  const anyv = v as unknown as {
    animation: unknown;
  };
  const standDeg = v.worldCamera()!.deg;
  v.turn(0); // start a right turn
  v.tick((clock += 100)); // step into the animation
  v.tick((clock += 100));
  const animating = anyv.animation !== null;
  const midCam = v.roomCamera();
  // mid-turn: a camera exists (was null before) and it has moved off the standpoint
  const tracksWhileMoving = animating && !!midCam && midCam.deg !== standDeg;
  await runAnimations(v);
  // at rest: back to the standpoint camera, seamlessly
  const restCam = v.roomCamera();
  const backToStand = anyv.animation === null && !!restCam && restCam.deg === v.worldCamera()!.deg;
  check(
    "world sprites track the camera during movement, not just at the standpoint",
    tracksWhileMoving && backToStand,
    `animating=${animating} midDeg=${midCam?.deg} standDeg=${standDeg} back=${backToStand}`,
  );
}
);

// --- 53. dev "give kit": bag + watch + map dock into the bottom band --------
// The dev button fires each HOUSE.SHP prop's own add handler (addbag/addwatch/
// addmap), which Frank normally triggers by picking them up in C73: owner=frank,
// moved to the band anchor (256,324) as a screen prop, closed/idle view.
test("dev \"give kit\": bag + watch + map dock into the bottom band", async () => {
  const { session } = await newSession();
  await session.openSetFile("smoke.set");
  for (const [prop, handler] of [
    ["bag", "addbag"],
    ["map", "addmap"],
    ["watch", "addwatch"],
  ] as const) {
    await session.sendEvent("sendtoprop", prop, handler, [], "dev");
    const inst = session.propRuntime.get(prop);
    if (inst) inst.visible = true;
  }
  const docked = (name: string): boolean => {
    const p = session.propRuntime.get(name);
    return (
      !!p && p.visible && p.owner === "frank" && !p.worldSpace && p.anchorX === 256 && p.anchorY === 324
    );
  };
  check(
    "dev give-kit docks bag + watch + map into the band (owner frank, screen band anchor)",
    docked("bag") && docked("watch") && docked("map"),
    `bag=${docked("bag")} watch=${docked("watch")} map=${docked("map")}`,
  );
}
);

// --- 54. life preserver keeps its tour/mission variant across state changes -
// The band's "life" button is deg 0 (mission) / 1 (tour); each of its states
// holds both variants as 2 frames. propview used to animate through them and
// end on the last (tour), so a mission-mode click flipped the icon to the tour
// art. A deg-locked selector must re-pick its variant by deg on every state.
test("life preserver keeps its tour/mission variant across state changes", async () => {
  const { session } = await newSession();
  await session.openSetFile("smoke.set"); // house.shp (persistent) -> life prop
  const life = session.propRuntime.get("life")!;
  const call = (name: string, args: (string | number)[]): void => {
    (session.interp.builtins.get(name) as (i: unknown, a: (string | number)[]) => void)(
      session.interp,
      args,
    );
  };
  call("propview", ["life", "light"]);
  call("propdeg", ["life", 0]); // mission
  const missionAfterDeg = life.frameIdx;
  call("propview", ["life", "push"]); // a click's push animation...
  call("propview", ["life", "light"]); // ...must return to the mission variant
  const missionAfterClick = life.frameIdx;
  call("propdeg", ["life", 1]); // tour
  call("propview", ["life", "light"]);
  const tourAfterClick = life.frameIdx;
  check(
    "life preserver keeps its tour/mission variant across state changes",
    missionAfterDeg === 0 && missionAfterClick === 0 && tourAfterClick === 1 && life.frameLocked,
    `afterDeg=${missionAfterDeg} missionClick=${missionAfterClick} tourClick=${tourAfterClick} locked=${life.frameLocked}`,
  );
}
);

// --- 55. band prop close animations + variant persistence ------------------
// "close" states store the SAME frames as "open" (closed->open) plus a play-
// order table (header @46) that reverses them; honouring it makes close play
// open->closed instead of replaying the opening. And a deg-variant prop (map)
// keeps its mission/tour icon after its open/close animation, not the last frame.
test("band prop close animations + variant persistence", async () => {
  const { session } = await newSession();
  await session.openSetFile("smoke.set");
  const stateOf = (prop: string, name: string) =>
    session.propRuntime.get(prop)!.group.states.find((s) => s.identifier === name)!;
  // The direction lives in the state's play SCRIPT, not in the order its frames
  // are stored: an "open" steps 1..N and its "close" steps N..1 through the same
  // stored art. So ask the script, which is what the runtime plays.
  const asc = (a: number[]) => a[0] < a[a.length - 1];
  const script = (prop: string, name: string) => {
    const st = stateOf(prop, name);
    return st.playOrder ?? st.frames.map((_, i) => i);
  };
  const reordered =
    asc(script("lid", "open")) && !asc(script("lid", "close")) &&
    asc(script("bag", "darkopen")) && !asc(script("bag", "darkclose"));
  // map keeps its mission variant (frame 0) through open/close, not tour (1)
  const map = session.propRuntime.get("map")!;
  const call = (name: string, a: (string | number)[]): void => {
    (session.interp.builtins.get(name) as (i: unknown, args: (string | number)[]) => void)(
      session.interp,
      a,
    );
  };
  await session.sendEvent("sendtoprop", "map", "addmap", [], "dev"); // deg 0 (mission)
  call("propview", ["map", "open"]);
  call("propview", ["map", "close"]);
  call("propview", ["map", "light"]);
  const mapVariantKept = map.frameIdx === 0 && map.degVariants;
  check(
    "close animations play reversed; deg-variant icon survives open/close",
    reordered && mapVariantKept,
    `lidClose=[${script("lid", "close")}] reordered=${reordered} mapFrame=${map.frameIdx} degVariants=${map.degVariants}`,
  );
}
);

// --- 55a. a state holding one animation PER DEGREE plays only its variant ---
// house.shp's map stores its close swing twice — six frames for normal play and
// six for the guided tour — in ONE 12-frame state, degrees [0x5, 1x6, 0]. The
// script asks for exactly six updates (`for count = 1 to 6 / forceupdate()`),
// and stepping the raw index played five normal frames then the tour ones, so
// the map shut with the tour artwork and jumped when propview("light") put a
// deg-0 frame back. A rotational swing (lid: one frame per angle, 0,32,...224)
// must be left alone — filtering THAT to a degree would leave a single frame.
test("deg-variant animations play one variant, rotational swings play whole", async () => {
  const { session } = await newSession();
  await session.openSetFile("smoke.set");
  const call = (name: string, a: (string | number)[]): void => {
    (session.interp.builtins.get(name) as (i: unknown, args: (string | number)[]) => void)(
      session.interp,
      a,
    );
  };
  const map = session.propRuntime.get("map")!;
  const stateOf = (prop: string, name: string) =>
    session.propRuntime.get(prop)!.group.states.find((s) => s.identifier === name)!;

  // deg is set directly rather than through propdeg(): a propdeg in the SAME
  // interp event is the `signs` selector idiom and deliberately holds one frame
  // (see propview). In play, addmap() sets it an event before open()/close().
  const variant = (deg: number): number[] => {
    map.deg = deg;
    call("propview", ["map", "close"]);
    return map.frameOrder ?? [];
  };
  const closeSt = stateOf("map", "close");
  const degsOf = (idx: number[]) => idx.map((i) => closeSt.degrees[i]);
  const normal = variant(0);
  const normalDegs = degsOf(normal);
  const tour = variant(1);
  const tourDegs = degsOf(tour);

  // the rotational swing keeps every frame and no variant map
  map.deg = 0;
  call("propview", ["lid", "open"]);
  const lid = session.propRuntime.get("lid")!;
  const lidSt = stateOf("lid", "open");
  // A rotational swing plays every frame once: its script is the identity, so
  // frameOrder is that list rather than null and the count is the whole state.
  const lidWhole =
    lid.frameCount(lidSt) === lidSt.frames.length &&
    (lid.frameOrder ?? lidSt.frames.map((_, i) => i)).every((v, i) => v === i);

  const sixEach = normal.length === 6 && tour.length === 6;
  const pure = normalDegs.every((d) => d === 0) && tourDegs.every((d) => d === 1);
  const disjoint = !normal.some((i) => tour.includes(i));
  check(
    "map close plays its own six frames per degree; lid swing plays all 12",
    sixEach && pure && disjoint && lidWhole,
    `normal=[${normal}] degs=[${normalDegs}] tour=[${tour}] degs=[${tourDegs}] ` +
      `lidFrames=${lid.frameCount(lidSt)}/${lidSt.frames.length} order=${lid.frameOrder}`,
  );
}
);

// --- 56. fence stage (M1 staging): duel opens onto the piste at centre -------
// SQUASH.SET's fence() seeds fencelevel/willphase then transtoflat("fence.stg").
// openstage loads fence.shp/fence.trk, stands Willie + the player on the 16-flat
// piste, goes to centre (flat "fence 8"), lights the "engage" button, and kicks
// the idle loops — but does NOT start fighting until the engage click.
test("fence stage (M1 staging): duel opens onto the piste at centre", async () => {
  const { session } = await newSession();
  session.interp.globals.set("fencelevel", 15);
  session.interp.globals.set("willphase", 201);
  await session.openSetFile("squash.set");
  await session.transToFlat("fence.stg");
  const willie = session.propRuntime.get("willie");
  const player = session.propRuntime.get("player");
  const start = session.propRuntime.get("startfence");
  const staged =
    session.stageName === "fence.stg" &&
    session.setVisible === false &&
    session.flatNames.length === 15 &&
    session.stageCtrl.flatToIndex(session.currentFlat) === 8;
  const fighters =
    !!willie && willie.visible && willie.stateName === "idle1" &&
    !!player && player.visible && player.stateName === "idle1";
  const ready =
    !!start && start.visible &&
    !session.interp.globals.get("fighting");
  check(
    "fence duel opens onto the piste at centre with fighters idle and engage lit",
    staged && fighters && ready,
    `stage=${session.stageName} flats=${session.flatNames.length} idx=${session.stageCtrl.flatToIndex(session.currentFlat)} ` +
      `willie=${willie?.visible}/${willie?.stateName} player=${player?.visible}/${player?.stateName} ` +
      `start=${start?.visible} fighting=${session.interp.globals.get("fighting")}`,
  );
}
);

// --- 57. fence M2: engage + live mouse-driven parry --------------------------
// Clicking the lit "engage" fires the flat's newpoint(): fighting flips true and
// the engage button hides. Then playeridle() polls mouse-X every tick and sets
// the player's blade angle (propdeg 0..8) + playerblock (left/none/right) — the
// defense is steered entirely by where the cursor sits across the piste.
test("fence M2: engage + live mouse-driven parry", async () => {
  const { session, viewer } = await newSession();
  session.interp.globals.set("fencelevel", 15);
  session.interp.globals.set("willphase", 201);
  await session.openSetFile("squash.set");
  await session.transToFlat("fence.stg");
  const player = session.propRuntime.get("player")!;
  const start = session.propRuntime.get("startfence")!;
  // fire a duel action the way the engine does: tracked, so scriptBusy suppresses
  // loop-firing while it runs (deterministic), then pump the clock to settle it.
  const fire = async (p: Promise<unknown>) => { session.track(p); await runAnimations(viewer()); };

  // engage: the lit "engage" is the flat's "startfence" click-region; its
  // mousedown does `if trackbut("startlit",…) newpoint()`. Dispatch newpoint by
  // name (the same by-name button path the engine exposes) to start the bout.
  await fire(session.stageCtrl.sendToButton(session.currentFlat, "startfence", "newpoint", [], "test"));
  const engaged = !!session.interp.globals.get("fighting") && start.visible === false;

  // defense: sweep the cursor across the piste; each band picks a blade deg +
  // block side. At centre flat 8 the backed-up weakenings don't apply, so the
  // thresholds are the raw ones from playeridle.
  const probe = async (x: number) => {
    session.setPointer(x, 190);
    await fire(session.sendEvent("sendtoprop", "player", "playeridle", [], "test"));
    return { deg: player.deg, block: session.interp.globals.get("playerblock") };
  };
  const farRight = await probe(350); // >=346 -> deg 8, right
  const right = await probe(320);    // >=316 -> deg 7, right
  const centre = await probe(260);   // >=256 -> deg 5, none
  const left = await probe(150);     // >=136 -> deg 1, left
  const farLeft = await probe(130);  // <136  -> deg 0, left

  const defends =
    farRight.deg === 8 && farRight.block === "right" &&
    right.deg === 7 && right.block === "right" &&
    centre.deg === 5 && centre.block === "none" &&
    left.deg === 1 && left.block === "left" &&
    farLeft.deg === 0 && farLeft.block === "left" &&
    player.stateName === "defend";
  check(
    "fence engage starts the bout; mouse-X drives the player's parry + block side",
    engaged && defends,
    `engaged=${engaged} far-right=${farRight.deg}/${farRight.block} right=${right.deg}/${right.block} ` +
      `centre=${centre.deg}/${centre.block} left=${left.deg}/${left.block} far-left=${farLeft.deg}/${farLeft.block} ` +
      `view=${player.stateName}`,
  );
}
);

// --- 58. fence M3a: player attack vs Willie's open quadrants -----------------
// A lunge (mousedown) targets a quadrant (UL/UR/LL/LR by click x/y). willieblock
// holds the quadrants Willie leaves OPEN (pickdef fills them by fencelevel — a
// higher/"mediocre" level opens more). notdefended(quad) is true when that quad
// is open (and we're past the 2-lunge warmup): the thrust lands and scores;
// otherwise Willie parries it. (Confirmed backwards from the name — the guard is
// `if notdefended(quad) -> pointgoesto("player")`.)
test("fence M3a: player attack vs Willie's open quadrants", async () => {
  const { session, viewer } = await newSession();
  const g = session.interp.globals;
  g.set("fencelevel", 15);
  g.set("willphase", 201);
  await session.openSetFile("squash.set");
  await session.transToFlat("fence.stg");
  await runAnimations(viewer()); // the stage fades in before the first engagement
  const playerscore = session.propRuntime.get("playerscore")!;
  const UR = (300 << 16) | 150; // x>256, y<193 -> upper-right quadrant
  const fire = async (p: Promise<unknown>) => { session.track(p); await runAnimations(viewer()); };
  const engage = () => fire(session.stageCtrl.sendToButton(session.currentFlat, "startfence", "newpoint", [], "test"));
  const attack = (pt: number) => fire(session.sendEvent("sendtoprop", "player", "playerattack", [pt], "test"));

  // PARRIED: UR is NOT among Willie's open quadrants -> he defends, no touch
  await engage();
  g.set("willieblock", "xx;xx;xx;xx;");
  g.set("attacktot", 5); // past the 2-lunge warmup
  await attack(UR);
  const parried = playerscore.visible === false;

  // TOUCH: Willie has left UR open -> the lunge lands; pointgoesto("player")
  // reveals the score readout (first touch = degree 0) and stiffens Willie (-4)
  await engage();
  g.set("willieblock", "UR;xx;xx;xx;");
  g.set("attacktot", 5);
  await attack(UR);
  const touched = playerscore.visible === true && playerscore.deg === 0;
  const stiffened = g.get("fencelevel") === 11;

  check(
    "fence player attack: a lunge into a covered quadrant is parried, into an open one it touches",
    parried && touched && stiffened,
    `parried=${parried} touched=${touched}(vis=${playerscore.visible} deg=${playerscore.deg}) fencelevel=${g.get("fencelevel")}`,
  );
}
);

// --- 59. fence M3b: Willie's attack vs the player's guard side ----------------
// Willie commits to a side (willieside, from willieintent); willieattack lands
// unless the player's guard (playerblock, steered live by the mouse) is on that
// same side. A matched guard is a parry (miss), a mismatched guard is a touch
// for Willie and eases him off (fencelevel +4).
test("fence M3b: Willie's attack vs the player's guard side", async () => {
  const { session, viewer } = await newSession();
  const g = session.interp.globals;
  g.set("fencelevel", 15);
  g.set("willphase", 201);
  await session.openSetFile("squash.set");
  await session.transToFlat("fence.stg");
  const williescore = session.propRuntime.get("williescore")!;
  const fire = async (p: Promise<unknown>) => { session.track(p); await runAnimations(viewer()); };
  const engage = () => fire(session.stageCtrl.sendToButton(session.currentFlat, "startfence", "newpoint", [], "test"));
  const willieAtk = () => fire(session.sendEvent("sendtoprop", "willie", "willieattack", [], "test"));

  // PARRIED: guard side matches Willie's committed side -> he misses, no touch
  await engage();
  g.set("willieside", "left");
  g.set("playerblock", "left");
  await willieAtk();
  const willieMissed = williescore.visible === false;

  // SCORES: guard on the wrong side -> the thrust lands, williescore appears
  await engage();
  g.set("willieside", "right");
  g.set("playerblock", "left");
  await willieAtk();
  const willieScored = williescore.visible === true && williescore.deg === 0;
  const eased = g.get("fencelevel") === 19;

  check(
    "fence Willie attack: matched guard parries; mismatched guard is a touch for Willie",
    willieMissed && willieScored && eased,
    `missed=${willieMissed} scored=${willieScored}(vis=${williescore.visible} deg=${williescore.deg}) fencelevel=${g.get("fencelevel")}`,
  );
}
);

// --- 60. fence M4: a full match to five touches ends the bout ----------------
// Score five touches (each: engage, leave UR open, lunge past the warmup) and the
// score readout climbs deg 0..4. On the fifth, pointgoesto's end-branch fires:
// fighting stops, Willie is marked "won" (the player won), fencewins increments,
// and transfromflat() leaves the stage — after which sendtoset(fence()) opens the
// post-match conversation (which blocks on a bevel), so we pump a bounded number
// of steps rather than waiting on the puppet, and assert the pre-conversation win.
test("fence M4: a full match to five touches ends the bout", async () => {
  const { session, viewer } = await newSession();
  const g = session.interp.globals;
  g.set("fencelevel", 15);
  g.set("willphase", 201);
  g.set("fencewins", 0);
  g.set("fencecount", 0);
  g.set("mission", 2);
  await session.openSetFile("squash.set");
  await session.transToFlat("fence.stg");
  await runAnimations(viewer()); // the stage fades in before the first engagement
  const playerscore = session.propRuntime.get("playerscore")!;
  const UR = (300 << 16) | 150;
  const ownerOf = (n: string) =>
    (session.interp.builtins.get("actorowner") as (i: unknown, a: string[]) => string)(session.interp, [n]);
  const fire = async (p: Promise<unknown>) => { session.track(p); await runAnimations(viewer()); };
  const engage = () => fire(session.stageCtrl.sendToButton(session.currentFlat, "startfence", "newpoint", [], "test"));

  // touches 1..4 — bout continues, score readout climbs to deg 3
  for (let i = 0; i < 4; i++) {
    await engage();
    g.set("willieblock", "UR;xx;xx;xx;");
    g.set("attacktot", 5); // skip the 2-lunge warmup
    await fire(session.sendEvent("sendtoprop", "player", "playerattack", [UR], "test"));
  }
  const fourTouches = playerscore.visible && playerscore.deg === 3 && !session.interp.globals.get("fighting");

  // fifth (winning) touch: fire it, then pump a bounded number of steps — the
  // end-branch runs (win recorded, stage left) before the conversation blocks.
  await engage();
  g.set("willieblock", "UR;xx;xx;xx;");
  g.set("attacktot", 5);
  session.track(session.sendEvent("sendtoprop", "player", "playerattack", [UR], "test"));
  for (let i = 0; i < 120; i++) {
    session.tickTime((clock += 66));
    await drain();
    if (session.puppet?.bevels?.length || session.stageName !== "fence.stg") break;
  }
  const won =
    !session.interp.globals.get("fighting") &&
    ownerOf("willie") === "won" &&
    session.interp.globals.get("fencewins") === 1 &&
    session.stageName !== "fence.stg";
  check(
    "fence: a match won five-touches-to-nil ends the bout and records the win",
    fourTouches && won,
    `fourTouches=${fourTouches}(deg=${playerscore.deg}) fighting=${session.interp.globals.get("fighting")} ` +
      `owner=${ownerOf("willie")} fencewins=${session.interp.globals.get("fencewins")} stage=${session.stageName}`,
  );
}
);

// --- 61. fence theme doesn't leak: leaving the overlay restores the ambient --
// The duel is a STG overlay (set stays the squash court), and its openstage does
// playnewtheme("fence.trk"). Overlays bypass changeset, so setupsound never runs
// to swap the theme back; declining the rematch travels same-deck, which is
// seamless (no replay) -> the combat theme used to keep looping in the hall.
// transToFlat now remembers the ambient theme and transFromFlat restores it.
test("fence theme doesn't leak: leaving the overlay restores the ambient", async () => {
  const { session } = await newSession();
  await session.openSetFile("squash.set");
  const call = (n: string, a: (string | number)[]) =>
    (session.interp.builtins.get(n) as (i: unknown, args: (string | number)[]) => unknown)(session.interp, a);
  // stand in for the ambient deck theme playing when the duel is entered
  await call("opentrackfile", ["bomb.trk"]);
  // through the boot library, not the builtin table: playnewtheme is BOOTFILE
  // script (`playtheme` + `themevol`), which is how every caller in the game
  // reaches it — there is no builtin of that name to fetch any more
  await session.runGlobal("playnewtheme", ["bomb.trk"]);
  const ambient = session.currentThemeName;
  await session.transToFlat("fence.stg"); // openstage -> playnewtheme("fence.trk")
  const during = session.currentThemeName;
  await session.transFromFlat(); // leaving must put the ambient back
  const after = session.currentThemeName;
  check(
    "fence: leaving the duel restores the ambient theme (combat theme doesn't leak)",
    ambient === "bomb.trk" && during === "fence.trk" && after === "bomb.trk",
    `ambient=${ambient} during=${during} after=${after}`,
  );
}
);

// --- 62. fight stage (M1 staging): the brawl opens with both fighters ready --
// GSTAIR1.SET's runfight() transtoflats("fight.stg") at mission 3 / phase 1.
// openstage loads fight.shp/fight.trk and openfight() stands Vlad + the first-
// person fists on the default flat ("flat 0"), shows both power bars, sets both
// powers to 512 (full), and kicks Vlad's idle loop. fightover stays false.
test("fight stage (M1 staging): the brawl opens with both fighters ready", async () => {
  const { session } = await newSession();
  await session.openSetFile("gstair1.set");
  await session.transToFlat("fight.stg");
  const g = session.interp.globals;
  const vlad = session.propRuntime.get("vlad");
  const fists = session.propRuntime.get("fists");
  const vladbar = session.propRuntime.get("vladbar");
  const playerbar = session.propRuntime.get("playerbar");
  const staged =
    session.stageName === "fight.stg" &&
    session.setVisible === false &&
    session.flatNames.length === 15 &&
    session.currentFlat === "flat 0";
  const fighters =
    !!vlad && vlad.visible && vlad.stateName === "idle" &&
    !!fists && fists.visible && fists.stateName === "idle";
  const hud = !!vladbar && vladbar.visible && !!playerbar && playerbar.visible;
  const ready =
    g.get("vladpower") === 512 && g.get("playerpower") === 512 && !g.get("fightover");
  check(
    "fight brawl opens with Vlad + fists idle, power bars up, both powers full",
    staged && fighters && hud && ready,
    `stage=${session.stageName} flat=${session.currentFlat} flats=${session.flatNames.length} ` +
      `vlad=${vlad?.visible}/${vlad?.stateName} fists=${fists?.visible}/${fists?.stateName} ` +
      `bars=${vladbar?.visible}/${playerbar?.visible} vp=${g.get("vladpower")} pp=${g.get("playerpower")} over=${g.get("fightover")}`,
  );
}
);

// --- 63. fight M2: punches land both ways ------------------------------------
// Clicking Vlad throws a player punch whose type comes from where you click
// (upper-middle = uppercut); vladdamage() drops vladpower. Vlad's own offense
// (his idle loop picks punches) lands on the player and drops playerpower.
test("fight M2: punches land both ways", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("gstair1.set");
  await session.transToFlat("fight.stg");
  const g = session.interp.globals;
  const fire = async (p: Promise<unknown>) => { session.track(p); await runAnimations(viewer()); };

  // player punch: click upper-middle (y in 160..270) -> uppercut -> vladpower drops
  session.setPointer(256, 200);
  const vp0 = g.get("vladpower") as number;
  await fire(session.sendEvent("sendtoprop", "fists", "mousedown", [(256 << 16) | 200], "test"));
  const playerLanded = (g.get("vladpower") as number) < vp0;

  // Vlad punch: fire an explicit uppercut from his prop -> playerpower drops
  const pp0 = g.get("playerpower") as number;
  await fire(session.sendEvent("sendtoprop", "vlad", "punch", ["uppercut"], "test"));
  const vladLanded = (g.get("playerpower") as number) < pp0;

  check(
    "fight punches: a player hit lowers vladpower; a Vlad hit lowers playerpower",
    playerLanded && vladLanded,
    `vladpower ${vp0}->${g.get("vladpower")} (playerLanded=${playerLanded}) ` +
      `playerpower ${pp0}->${g.get("playerpower")} (vladLanded=${vladLanded})`,
  );
}
);

// --- 64. fight M3: a knock-out ends the bout ---------------------------------
// When a fighter's power falls below -50, Vlad's idle loop calls endfight(),
// which resolves the winner (vladpower < playerpower => player wins), marks Vlad
// "lostfight", halts the combat theme, and transfromflat()s back out of the
// stage. Drive Vlad's power under and fire his idle tick to trigger it.
test("fight M3: a knock-out ends the bout", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("gstair1.set");
  await session.transToFlat("fight.stg");
  const g = session.interp.globals;
  const fire = async (p: Promise<unknown>) => { session.track(p); await runAnimations(viewer()); };
  const ownerOf = (n: string) =>
    (session.interp.builtins.get("actorowner") as (i: unknown, a: string[]) => string)(session.interp, [n]);

  g.set("vladpower", -60); // Vlad is spent
  await fire(session.sendEvent("sendtoprop", "vlad", "idle", [], "test"));
  const won = ownerOf("vlad") === "lostfight" && session.stageName !== "fight.stg";
  check(
    "fight KO: dropping Vlad below -50 ends the bout as a player win and leaves the stage",
    won,
    `owner=${ownerOf("vlad")} stage=${session.stageName}`,
  );
  // `fightover` is NOT among the outcomes: endfight sets it true and then
  // `dumpglobal`s it four lines later, along with the rest of the bout's working
  // set. What survives a fight is the actor's owner, which is what the room's
  // openscene reads. (This check used to assert fightover was true, which only
  // passed because dumpglobal was being read as a declaration — see #85.)
  const scratch = ["playerpower", "vladpower", "fightover", "oldside", "firstpunch", "secondpunch", "thirdpunch"];
  const left = scratch.filter((n) => g.has(n));
  check("...and the bout's working globals are destroyed with it", left.length === 0, `still held: ${left.join(", ")}`);
}
);

// --- 65. fuse stage (M1 staging): the fusebox opens with its fuses lit --------
// HALLA.SET transtoflats("fuse.stg") when you click the panel at view61 (port).
// openstage loads fuse.shp/fuse.snd; the shop's openshop shows the (closed) door
// and sets each fuse "light"/"off" from the fusebox slot-string. Also confirms
// the BOOTFILE progress(m,p) gate helper resolves + compares correctly (its
// decompiled body ends oddly, so pin it: at mission 1/phase 4, progress(1,4) is
// true, progress(1,5)/progress(2,0) false).
test("fuse stage (M1 staging): the fusebox opens with its fuses lit", async () => {
  const { session } = await newSession();
  const g = session.interp.globals;
  g.set("mission", 1);
  g.set("phase", 4);
  g.set("neckphase", 6);
  g.set("hallside", "port");
  g.set("fusebox", "1,1,1,1,");
  await session.openSetFile("halla.set", "scene52", "view61");
  await session.transToFlat("fuse.stg");
  const door = session.propRuntime.get("fusedoor");
  const f14 = session.propRuntime.get("fuse14");
  const f20 = session.propRuntime.get("fuse20");
  const staged =
    session.stageName === "fuse.stg" && session.setVisible === false;
  const wired =
    !!door && door.visible && door.stateName === "closed" &&
    !!f14 && f14.visible && f14.stateName === "light" &&
    !!f20 && f20.visible && f20.stateName === "light";
  const prog = (m: number, p: number) => session.runGlobal("progress", [m, p]);
  const gate = !!(await prog(1, 4)) && !(await prog(1, 5)) && !(await prog(2, 0));
  check(
    "fuse stage opens with door closed + fuses lit; progress() gate resolves",
    staged && wired && gate,
    `stage=${session.stageName} door=${door?.stateName} f14=${f14?.stateName} f20=${f20?.stateName} ` +
      `progress(1,4)=${await prog(1, 4)} progress(1,5)=${await prog(1, 5)} progress(2,0)=${await prog(2, 0)}`,
  );
}
);

// --- 66. fuse M2: fuses toggle (light<->off) + door opens/closes -------------
// A fuse click reaches BOTH the STG main (light->off, sets its fusebox slot "0")
// and the prop's shop main (off->on, slot "1"); a run loop (fuseoff/fuseon)
// settles the switch into its resting light/off frame. The door opens only when
// the boot progress(1,4) + neckphase + view61 + port gate holds.
//
// The order matters and this test used to have it wrong. It closed the door again
// before clicking a fuse, and passed — because clicks over a flat resolved the
// click REGION before the prop, so the press went straight through the shut door
// to the region behind it. BOOTFILE 0001 dispatches `hittest`'s answer, which is
// prop-first (see clickDispatch), and `fusedoor` closed spans x 91..346 — over
// all four fuse regions. So the door has to be OPEN to reach a fuse, which is
// what a player does and what is checked here now, shut door included.
test("fuse M2: fuses toggle (light<->off) + door opens/closes", async () => {
  const { session, viewer } = await newSession();
  const g = session.interp.globals;
  g.set("mission", 1); g.set("phase", 4); g.set("neckphase", 6);
  g.set("hallside", "port"); g.set("fusebox", "1,1,1,1,");
  await session.openSetFile("halla.set", "scene52", "view61");
  session.currentViewName = () => "view61";
  await session.transToFlat("fuse.stg");
  const f14 = session.propRuntime.get("fuse14")!;
  const door = session.propRuntime.get("fusedoor")!;
  const stg = session.stageCtrl.stageFile!;
  const regions = readStgRegions(stg.file.containers[stg.flats[0].locationClickLogic].data);
  const r = regions.find((x) => x.name === "fuse14")!;
  const cx = Math.round((r.left + r.right) / 2), cy = Math.round((r.top + r.bottom) / 2);
  const fire = async (p: Promise<unknown>) => { session.track(p); await runAnimations(viewer()); };
  // pump service steps until the run loops drain (settling the switch frame)
  const pump = async () => { for (let i = 0; i < 40 && session.scheduler.loops.length; i++) { session.tickTime((clock += 100)); await drain(); } };

  const slot = () => String(g.get("fusebox")).split(",")[0];
  // Aim at the fuse with the door shut and it is the DOOR that answers: its
  // gated mousedown opens it, and the fuse behind it is left alone. One click,
  // and the two halves of that are what the ordering fix is about.
  const startClosed = door.stateName === "closed";
  await fire(viewer().click(cx, cy));
  const opened = door.stateName === "open";
  const fuseUntouched = slot() === "1" && f14.stateName === "light";

  // fuse toggle: click the lit fuse -> off (STG main), then click again -> on
  // (shop main), with a run loop settling each switch into its resting frame
  await fire(viewer().click(cx, cy));
  const off1 = slot() === "0";
  await pump();
  const nowOff = f14.stateName === "off";
  await fire(viewer().click(cx, cy));
  const on1 = slot() === "1";
  await pump();
  const nowLit = f14.stateName === "light";

  // and it closes again
  await fire(session.sendEvent("sendtoprop", "fusedoor", "mousedown", [0], "test"));
  const closed = door.stateName === "closed";

  check(
    "fuse toggle both ways (light<->off, fusebox slot) and the door opens/closes",
    startClosed && opened && fuseUntouched && closed && off1 && nowOff && on1 && nowLit,
    `door closed=${startClosed}->open=${opened}->closed=${closed}` +
      ` | shut door left the fuse alone=${fuseUntouched}` +
      ` | off1=${off1} nowOff=${nowOff} on1=${on1} nowLit=${nowLit}`,
  );
}
);

// --- 67. fuse M3: confirming with fuse #1 off advances the Sasha subplot ------
// Clicking the OK button (fuseokdark) runs the STG confirm: trackbut(fuseoklit)
// -> close the door, transfromflat() out, and if fuse #1 (fuse14) is off and
// neckphase == 6, advance neckphase to 7 (Sasha is freed to the hall).
test("fuse M3: confirming with fuse #1 off advances the Sasha subplot", async () => {
  const { session, viewer } = await newSession();
  const g = session.interp.globals;
  g.set("mission", 1); g.set("phase", 4); g.set("neckphase", 6);
  g.set("hallside", "port"); g.set("fusebox", "0,1,1,1,"); // fuse #1 already off
  await session.openSetFile("halla.set", "scene52", "view61");
  session.currentViewName = () => "view61";
  await session.transToFlat("fuse.stg");
  const fire = async (p: Promise<unknown>) => { session.track(p); await runAnimations(viewer()); };
  // hold the pointer over the OK button so trackbut(fuseoklit) reads "released
  // over the button" (its rect is anchored at 256,192 minus the frame offset),
  // then run the confirm keyed on target = fuseokdark
  const okp = session.propRuntime.get("fuseoklit")!;
  const okst = okp.state()!;
  const okf = okp.shop.frame(okst.frames[Math.min(okp.frameIdx, okst.frames.length - 1)]);
  session.setPointer(256 - okf.posXraw + Math.floor(okf.width / 2), 192 - okf.posYraw + Math.floor(okf.height / 2));
  await fire(session.sendEvent("sendtostage", "fuse.stg", "mousedown", [0], "fuseokdark"));
  const advanced = g.get("neckphase") === 7 && session.stageName !== "fuse.stg";
  check(
    "fuse confirm: OK with fuse #1 off leaves the stage and advances neckphase 6->7",
    advanced,
    `neckphase=${g.get("neckphase")} stage=${session.stageName}`,
  );
}
);

// --- 68. actor putdownactor (boot lifecycle helper) hides the actor ----------
// The officer/Sasha leave via sendtoactor(name, putdownactor()); putdownactor is
// a BOOTFILE helper (actorvisible(target,false)+stoploop+stopwalk), not on the
// actor/cast, so sendtoactor's resolution must reach the boot fallback for it.
test("actor putdownactor (boot lifecycle helper) hides the actor", async () => {
  const { session } = await newSession();
  session.interp.globals.set("neckphase", 6);
  session.interp.globals.set("mission", 1);
  session.interp.globals.set("phase", 4);
  session.interp.globals.set("hallside", "port");
  await session.openSetFile("halla.set", "scene52", "view61");
  await session.sendEvent("sendtoactor", "asea", "setupactor", ["fuse"], "test");
  const before = session.actorRuntime.get("asea")?.visible;
  await session.sendEvent("sendtoactor", "asea", "putdownactor", [], "test");
  const after = session.actorRuntime.get("asea")?.visible;
  check(
    "putdownactor hides the actor (boot lifecycle helper resolves via sendtoactor)",
    before === true && after === false,
    `visible before=${before} after=${after}`,
  );
}
);

// --- 69. Sasha walks away down the hall (sasha.1 -> sasha.2) -----------------
// After the fuse subplot (neckphase 7) Sasha appears in his doorway (sasha.1);
// --- #127: a turn owes the WHOLE openscene chain, boot included ---------------
// `openscene` is a per-view event all the way down, and BOOTFILE's arm of it does
// three things: setuparrow(), setupsigns() and — at mission 4 only — the sinking
// clock's `sec = sec + 1`, throttled to one bump per 20 rendered frames via
// `secframe`. viewChanged() used to stop after the set main, so a turn got none of
// them: viewer.ts hand-rolled the first two as sendtoprops and nobody noticed the
// third was gone, which made turning in place free in the endgame where the
// original charges a second for it.
test("a turn runs boot's openscene, so the sinking clock charges for it (#127)", async () => {
  const turn = async (mission: number) => {
    const { session, viewer } = await newSession();
    await session.openSetFile("lounge1c.set", "scene14", "view37");
    for (const [k, val] of [["mission", mission], ["phase", 0], ["hrs", 13], ["min", 0],
                            ["sec", 0], ["clockcount", 0], ["secframe", 0],
                            ["sinkflag", mission === 4 ? 1 : 0]] as const)
      session.interp.globals.set(k, val);
    const v = viewer();
    const pump = async (n: number) => {
      for (let i = 0; i < n; i++) { v.tick((clock += 50)); await drain(); }
    };
    const settle = async (n: number) => {
      for (let i = 0; i < n && (v.busy || session.scriptBusy); i++) { v.tick((clock += 50)); await drain(); }
    };
    await settle(300);
    // the throttle is `frame() - secframe >= 20`, so the clock has to have run a
    // second before a bump is allowed at all
    await pump(40);
    const before = Number(session.interp.globals.get("sec"));
    void session.track(v.pressNav("rightarrow"));
    await settle(400);
    await session.settle(50);
    return {
      secframe: Number(session.interp.globals.get("secframe")),
      sec: Number(session.interp.globals.get("sec")),
      before,
      // setuparrow() picks a COLOUR (green road ahead / yellow door / red none),
      // so what the turn owes is the same colour arriving at that view any other
      // way would give
      view: session.currentViewName?.() ?? "",
      arrow: String(session.propRuntime.get("navarrow")?.stateName ?? ""),
    };
  };

  const m4 = await turn(4);
  check(
    "turning in the endgame bumps the clock — boot's openscene ran",
    m4.secframe > 0 && m4.sec > m4.before,
    `secframe=${m4.secframe} sec ${m4.before}->${m4.sec}`,
  );
  // the arrow the turn produced is the arrow ENTERING at that view produces —
  // the equivalence that used to be maintained by hand in viewer.ts
  const { session: s2 } = await newSession();
  await s2.openSetFile("lounge1c.set", "scene14", m4.view);
  await s2.settle(50);
  const entered = String(s2.propRuntime.get("navarrow")?.stateName ?? "");
  check(
    "...and the arrow it leaves is the one entering at that view gives",
    m4.arrow !== "" && m4.arrow === entered,
    `turned to ${m4.view} -> "${m4.arrow}", entered at ${m4.view} -> "${entered}"`,
  );
  const m1 = await turn(1);
  check(
    "outside mission 4 the same turn leaves the clock alone (the arm is gated)",
    m1.secframe === 0,
    `secframe=${m1.secframe} sec ${m1.before}->${m1.sec}`,
  );
}
);

// entering Scene52 facing View62 fires HALLA.SET openscene -> walkonpath(sasha,
// sasha.1, sasha.2). sasha.2 lives in the actor table's nested SECONDARY slot
// (record tail +32) — the fixed-41 skip used to drop it, so the star wasn't
// found and Sasha stood frozen in the doorway (rendering huge/headless right in
// front of the camera). With the star recovered the walk runs and he leaves.
test("Sasha walks away down the hall (sasha.1 -> sasha.2)", async () => {
  const { session, viewer } = await newSession();
  session.interp.globals.set("neckphase", 7);
  session.interp.globals.set("mission", 1);
  session.interp.globals.set("phase", 4);
  session.interp.globals.set("tour", 0);
  await session.openSetFile("halla.set", "scene52", "view62");
  const v = viewer();
  // Sasha in the doorway on sasha.1
  await session.sendEvent("sendtoactor", "sasha", "setupactor", ["halla"], "test");
  const sasha = session.actorRuntime.get("sasha")!;
  const startedOnStar = sasha.starName === "sasha.1" && sasha.visible;
  const dest = session.currentBinding?.set.actors.find((a) => a.identifier === "sasha.2");
  // fire the scene's openscene (as scene entry would) -> triggers the walk
  session.interp.builtins.get("stoploop")!(session.interp, ["actor", "sasha"], null as never, null as never);
  session.interp.builtins.get("walkonpath")!(
    session.interp, ["sasha", "sasha.1", "sasha.2"], null as never, null as never,
  );
  // "walkonpath" while it runs, not "defer": that is the sentinel TI.EXE's route
  // builder stamps and the one `walktopuppet` reads back (#230)
  const walking = sasha.starName === "walkonpath" && session.scheduler.isWalk("sasha");
  let guard = 0;
  while (session.scheduler.isWalk("sasha") && guard++ < 800) { v.tick((clock += 100)); await drain(); }
  await drain();
  // he ends down the hall — sasha.2, or sasha.3 if the idle loiter loop has
  // toggled him along (sashaidle nudges sasha.2<->sasha.3); either proves he
  // left the doorway (sasha.1) rather than freezing there as a giant.
  const arrived = sasha.starName === "sasha.2" || sasha.starName === "sasha.3";
  check(
    "Sasha walks the doorway->hall path (sasha.2 recovered from the actor-table tail)",
    startedOnStar && !!dest && dest.positionZ > 8668 && walking && arrived,
    `start=${startedOnStar} sasha.2@Z=${dest?.positionZ} walking=${walking} arrived=${sasha.starName}`,
  );
}
);

// --- camerahi: BOOTFILE adjustcamera() sets the per-set projection bias that
//     grounds the A-deck halls' world sprites (TI.EXE fn 0x43a970 / global
//     0x48a792). halla=139, non-halls=0; the bias raises the camera eye so the
//     projected feet drop onto the pre-rendered floor instead of floating. ---
test("TURNING to view62 fires openscene (per-view event) -> Sasha walks", async () => {
  const { session, viewer } = await newSession();
  // a non-hall set leaves the bias at 0 (matches grounded sets)
  await session.openSetFile("b59.set");
  const biasB59 = session.cameraHiBias;

  // entering halla runs openset -> adjustcamera() -> camerahi(139)
  await session.openSetFile("halla.set", "scene52", "view61");
  const biasHalla = session.cameraHiBias;
  const v = viewer();
  const camZ = v.worldCamera()!.z;

  // the bias must move a floor point's screen row DOWN vs. the old (bias-0)
  // camera. Use a floor point straight ahead of the camera so depth > 0.
  const camBiased = v.worldCamera()!;
  const camPlain = { ...camBiased, z: camBiased.z - session.cameraHiBias };
  const ang = (2 * Math.PI * camBiased.deg) / 256;
  const fx = camBiased.x + Math.round(2000 * Math.cos(ang));
  const fz = camBiased.y + Math.round(2000 * Math.sin(ang));
  const floorH = camPlain.z - 200; // a point on the floor, below the eye
  const feetBiased = projectPoint(camBiased, fx, fz, floorH);
  const feetPlain = projectPoint(camPlain, fx, fz, floorH);
  const dropped = !!feetBiased && !!feetPlain && feetBiased.y > feetPlain.y;

  check(
    "camerahi grounds the halls: b59=0, halla=139, camera eye raised, feet drop",
    biasB59 === 0 && biasHalla === 139 && camZ > 0 && dropped,
    `b59=${biasB59} halla=${biasHalla} camZ=${camZ} feetPlainY=${feetPlain?.y} feetBiasedY=${feetBiased?.y}`,
  );
}
);

// --- matryoshka doll (PATTY.STG): a visible foreground prop with its own
//     mousedown script must intercept clicks before the flat click-regions
//     beneath it. The doll prop overlaps the doll1/dial hotspots that revealed
//     it; before the fix every "open a layer" click on the doll's left half was
//     swallowed by those regions and the doll only ever closed. ---
test("TURNING to view62 fires openscene (per-view event) -> Sasha walks", async () => {
  const { session, viewer } = await newSession();
  const g = session.interp.globals;
  g.set("mission", 1); g.set("tour", 0); g.set("neckphase", 8); g.set("debugging", 1);
  await session.openSetFile("a14.set", "scene1", "view11");
  // real necklace inside the doll (Vlad's), fake in the player's hand to swap
  await session.sendEvent("sendtoshop", "inven.shp", "giveinven", ["realneck", "vlad"], "test");
  await session.sendEvent("sendtoshop", "inven.shp", "addinven", ["fakeneck"], "test");
  await session.track(session.transToFlat("patty.stg"));
  const v = viewer();
  await runAnimations(v); // the stage fades in; a click before it lands is queued
  await session.sendEvent("sendtostage", "patty.stg", "solvedoll", [], "test");
  const click = async (x: number, y: number) => {
    session.setPointer(x, y);
    session.pointerDown = true;
    await v.click(x, y);
    session.pointerDown = false;
    await drain();
  };
  const doll = () => session.propRuntime.get("doll");
  const preal = () => session.propRuntime.get("pattyreal");

  await click(120, 170); // doll1 region -> reveal the doll prop
  const revealed = !!doll()?.visible && doll()?.deg === 0;
  await click(150, 226); // doll LEFT half -> peel a layer (reaches the prop now)
  const peeled1 = doll()?.deg === 1;
  // RIGHT half closes: step the layer back down
  await click(250, 226);
  const closed = doll()?.deg === 0;
  // peel all the way open -> patty 3 reveals the real necklace inside
  await click(150, 226); await click(150, 226); await click(150, 226);
  const openedToNecklace = session.currentFlat.toLowerCase() === "patty 3" && !!preal()?.visible;
  // take the real necklace out (into the player's hand)
  await click(256, 180);
  const took = String(g.get("handitem")) === "realneck";

  // nested overlay: the inventory bag (inven1.stg) opens OVER the doll to swap
  // an item; leaving it must return to the EXACT prior screen — patty 3, doll
  // opened, set still hidden — not re-initialise the puzzle to "patty 1". This
  // is the stage stack + saved-flat + hide/show restore.
  await session.track(session.transToFlat("inven1.stg"));
  await runAnimations(v);
  const onBag = session.stageName === "inven1.stg";
  await session.track(session.transFromFlat());
  await runAnimations(v);
  const returned =
    session.stageName === "patty.stg" &&
    session.currentFlat.toLowerCase() === "patty 3" &&
    session.setVisible === false;

  check(
    "matryoshka doll: foreground prop intercepts, peels open/close, reveals + takes the real necklace",
    revealed && peeled1 && closed && openedToNecklace && took,
    `reveal=${revealed} peel=${peeled1} close=${closed} necklace=${openedToNecklace} took=${took}`,
  );
  check(
    "inventory bag opens over the doll and returns to the same screen (nested overlay stage stack)",
    onBag && returned,
    `onBag=${onBag} backStage=${session.stageName} backFlat=${session.currentFlat} setVisible=${session.setVisible}`,
  );
}
);

// --- Sasha subplot conclusion: after swapping the necklace (real in your bag,
//     fake left in the doll -> owned "vlad"), leaving Sasha's cabin triggers the
//     A14 door "kickout": Sasha's sasha1.pup conversation runs, neckphase 8->9,
//     and a changeset drops you into the HALLA corridor with the real necklace
//     and NO player death (the "swap" outcome, vs "steal" which kills you). ---
test("TURNING to view62 fires openscene (per-view event) -> Sasha walks", async () => {
  const { session, viewer } = await newSession();
  const g = session.interp.globals;
  g.set("mission", 1); g.set("tour", 0); g.set("neckphase", 8);
  await session.openSetFile("a14.set", "scene2", "view21");
  await session.sendEvent("sendtoshop", "inven.shp", "addinven", ["realneck"], "test"); // real -> frank
  await session.sendEvent("sendtoshop", "inven.shp", "giveinven", ["fakeneck", "vlad"], "test"); // fake -> doll
  const v = viewer();
  const door = v.scene.views[v.viewIdx].objects.find((o) => o.identifier.toLowerCase() === "door")!;
  const cx = Math.floor((door.startRegionX + door.endRegionX) / 2);
  const cy = Math.floor((door.startRegionY + door.endRegionY) / 2);
  session.setPointer(cx, cy);
  session.pointerDown = true;
  void v.click(cx, cy); // kickout(): puppet conversation + delays + changeset — driven below
  session.pointerDown = false;
  // drive the delays/puppet/changeset by ticking the (possibly swapped) viewer
  for (let i = 0; i < 300 && Number(g.get("neckphase")) !== 9; i++) {
    viewer()?.tick((clock += 100));
    await drain();
  }
  check(
    "Sasha subplot end: door kickout runs the conversation, advances neckphase 8->9 into halla, no death",
    Number(g.get("neckphase")) === 9 &&
      session.currentSetName === "halla" &&
      String(g.get("playerdeath") ?? "") === "",
    `neck=${g.get("neckphase")} set=${session.currentSetName} death=${g.get("playerdeath")}`,
  );
}
);

// --- darkroom (PHOTO.STG / REDPHOTO.STG): the red-light view reuses photo.shp
//     + openphoto (stageBase maps redphoto -> photo). Develop a negative by
//     turning on the red safelight, opening its case, and dragging it into the
//     "start" bath (good) vs "stop" (spoiled). Exercises the entry-handler alias
//     and the region-vs-foreground-prop click routing. ---
test("TURNING to view62 fires openscene (per-view event) -> Sasha walks", async () => {
  const { session, viewer } = await newSession();
  const g = session.interp.globals;
  g.set("mission", 1); g.set("tour", 0);
  for (const k of ["picone", "pictwo", "picthree", "badone", "badtwo", "badthree"]) g.set(k, 0);
  await session.openSetFile("c78.set");
  await session.track(session.transToFlat("redphoto.stg")); // red-light view (whitelight off)
  const v = viewer();
  const redphotoSetUp =
    session.stageName === "redphoto.stg" &&
    String(g.get("whitelight")) === "off" &&
    (session.propRuntime.get("photobag")?.deg === 1); // deg-1 = red-light variants (openphoto ran)

  const click = async (x: number, y: number) => {
    session.setPointer(x, y);
    session.pointerDown = true;
    void v.click(x, y);
    for (let i = 0; i < 8; i++) { v.tick((clock += 50)); await drain(); }
    session.pointerDown = false;
    for (let i = 0; i < 8; i++) { v.tick((clock += 50)); await drain(); }
  };
  // turn on the red safelight via the region's own handler (dispatch by name —
  // robust vs pixel routing), then let its forceupdate loop settle
  void session.stageCtrl.sendToButton(session.currentFlat, "redlight", "mousedown", [0], "test");
  for (let i = 0; i < 10; i++) { v.tick((clock += 50)); await drain(); }
  const lampOn = session.propRuntime.get("redlamp")?.visible === true;
  await click(276, 193); // open case1
  const caseOpen = session.propRuntime.get("case1")?.stateName === "openpic";
  // develop: press on the open case, drag the negative into bath 1 (start), release
  session.setPointer(276, 193);
  session.pointerDown = true;
  void v.click(276, 193);
  for (let i = 0; i < 10; i++) { v.tick((clock += 50)); await drain(); }
  session.setPointer(120, 290); // bath 1 = "start" region (good develop)
  for (let i = 0; i < 6; i++) { await drain(); }
  session.pointerDown = false;
  for (let i = 0; i < 20; i++) { v.tick((clock += 50)); await drain(); }
  const developedGood =
    Number(g.get("picone")) === 1 &&
    Number(g.get("badone")) === 0 &&
    session.propRuntime.get("pic1")?.owner !== "bad";

  check(
    "darkroom: redphoto opens (photo.shp reused), red safelight + drag negative to bath 1 develops it good",
    redphotoSetUp && lampOn && caseOpen && developedGood,
    `redSetup=${redphotoSetUp} lamp=${lampOn} case=${caseOpen} picone=${g.get("picone")} badone=${g.get("badone")} owner=${session.propRuntime.get("pic1")?.owner}`,
  );
}
);

// --- volume settings plumbing (CTL.STG dial + slider): wavevolume() drives the
//     sound+voice channel gains, themevol() the theme channel, and a theme that
//     starts (playtheme) picks up the current global themevolume. ---
test("TURNING to view62 fires openscene (per-view event) -> Sasha walks", async () => {
  const { session, sink } = await newSession();
  // builtins are (interp, args, call, ctx) but ignore the last two here
  type Bi = (i: typeof session.interp, a: (number | string)[]) => unknown;
  const wv = session.interp.builtins.get("wavevolume")! as unknown as Bi;
  const tv = session.interp.builtins.get("themevol")! as unknown as Bi;
  // setter scales sound + voice (0..9 -> 0..1); getter reads it back; clamps
  await wv(session.interp, [3]);
  const setOk =
    session.waveVolume === 3 &&
    Math.abs(sink.channelVolume.sound - 3 / 9) < 1e-6 &&
    Math.abs(sink.channelVolume.voice - 3 / 9) < 1e-6;
  const getOk = (await wv(session.interp, [])) === 3;
  await wv(session.interp, [99]);
  const clampOk = session.waveVolume === 9 && Math.abs(sink.channelVolume.sound - 1) < 1e-6;
  // themevol(track, vol 0..255) sets the theme channel gain
  await tv(session.interp, ["boil.trk", 128]);
  const themeOk = Math.abs(sink.channelVolume.theme - 128 / 255) < 1e-6;
  // ...and themevol(track) READS it back. The scripts duck the score with a
  // read-modify-write — `themevol(t, themevol(t) / 4)` around every conversation
  // in the demo's gang.cst, and in three stages through NAREND.STG's bad ending —
  // so a getter that answers nothing sets the music to zero and then multiplies
  // zero back up. Both halves are checked: the read, and the idiom's round trip.
  const themeGetOk = (await tv(session.interp, ["boil.trk"])) === 128;
  const ducked = Math.floor((await tv(session.interp, ["boil.trk"])) as number) / 4;
  await tv(session.interp, ["boil.trk", ducked]);
  const duckOk =
    (await tv(session.interp, ["boil.trk"])) === 32 &&
    Math.abs(sink.channelVolume.theme - 32 / 255) < 1e-6;
  await tv(session.interp, ["boil.trk", ((await tv(session.interp, ["boil.trk"])) as number) * 4]);
  const restoreOk = (await tv(session.interp, ["boil.trk"])) === 128;
  // a theme that starts adopts the current global themevolume (slider persists
  // across set changes, not just when a script re-issues themevol)
  session.interp.globals.set("themevolume", 0);
  await session.openSetFile("c78.set");
  const pt = session.interp.builtins.get("playtheme")! as unknown as Bi;
  await pt(session.interp, []);
  const themeStarted = session.currentThemeName !== "none";
  const persistOk = !themeStarted || Math.abs(sink.channelVolume.theme - 0) < 1e-6;
  check(
    "volume settings: wavevolume scales sound+voice, themevol reads back and scales theme, playtheme adopts themevolume",
    setOk && getOk && clampOk && themeOk && themeGetOk && duckOk && restoreOk && persistOk,
    `set=${setOk} get=${getOk} clamp=${clampOk} theme=${themeOk} themeGet=${themeGetOk} ` +
      `duck=${duckOk} restore=${restoreOk} started=${themeStarted} persist=${persistOk} ` +
      `(sound=${sink.channelVolume.sound.toFixed(3)} theme=${sink.channelVolume.theme.toFixed(3)})`,
  );
}
);

// --- CTL.STG settings panel (the "life" pocketwatch → dolife → transtoflat
//     ctl.stg): the full-screen panel opens over the game, its HOUSE.SHP props
//     (the wave-volume dial, the theme lever) are shown, and dragging the
//     "themetoggle" flat region writes the global themevolume live. ---
test("TURNING to view62 fires openscene (per-view event) -> Sasha walks", async () => {
  const { session, viewer } = await newSession();
  const g = session.interp.globals;
  g.set("mission", 1); g.set("tour", 0);
  await session.openSetFile("c78.set");
  await session.track(session.transToFlat("ctl.stg"));
  const v = viewer();
  const panelUp =
    session.stageName === "ctl.stg" &&
    session.currentFlat.toLowerCase() === "ctl 1" &&
    session.setVisible === false;
  // the dial + lever sprites (HOUSE.SHP props, repositioned by openflat) show
  const dialShown = session.propRuntime.get("volume")?.visible === true;
  const leverShown = session.propRuntime.get("themetoggle")?.visible === true;
  // drag the theme lever: hold the pointer inside the "themetoggle" region at a
  // known x (handler reads themevolume = 8*(x-322), clamped) and pump frames
  session.setPointer(338, 340); // x-322 = 16 -> themevolume 128
  session.pointerDown = true;
  void session.stageCtrl.sendToButton(session.currentFlat, "themetoggle", "mousedown", [session.pointerPoint()], "test");
  for (let i = 0; i < 8; i++) { v.tick((clock += 50)); await drain(); }
  session.pointerDown = false;
  for (let i = 0; i < 6; i++) { v.tick((clock += 50)); await drain(); }
  const themevolSet = Number(g.get("themevolume")) === 128;
  check(
    "settings panel: ctl.stg opens with the volume dial + theme lever, dragging the lever sets themevolume",
    panelUp && dialShown && leverShown && themevolSet,
    `panel=${panelUp} dial=${dialShown} lever=${leverShown} themevolume=${g.get("themevolume")}`,
  );
}
);

// --- SHIFT-clicking HELP raises the game's own state readout (#8) -----------
// This was never missing, only unreachable. house.shp's "help" prop answers a
// shift-click with `notedialog("Mission=" @ … @ ", Phase=" @ …)` — and our
// `shiftkey()` was hard-wired to 0, so the branch could not be reached. Census of
// the English tree behind that change: 383 modifier probes across 248 containers,
// all but four gated on `debugging` (assigned once in the corpus, `debugging =
// false` in BOOTFILE) — and three of the four ungated ones are `optionkey`, which
// still answers 0.
//
// Driven as a CLICK on the button's own rect rather than by handing the handler its
// event: what was broken was the modifier a press carries, so a test that sends the
// handler its arguments would pass with the bug still in place.
test("shift-clicking HELP raises the game's own readout, and a plain click does not", async () => {
  const notes: string[] = [];
  const { host, session } = await newHost();
  session.onNoteDialog = (m) => void notes.push(m);
  const g = session.interp.globals;
  g.set("mission", 1); g.set("phase", 4); g.set("tour", 0);
  await host.loadServerSet("c78.set");
  await session.track(session.transToFlat("ctl.stg"));
  const v = host.viewer!;
  const region = (name: string) => {
    const r = session.stageCtrl.flatRegion(session.currentFlat, name)!;
    return { x: Math.round((r.left + r.right) / 2), y: Math.round((r.top + r.bottom) / 2) };
  };
  const help = region("help");
  const under = session.propRuntime.propAt(help.x, help.y, null, false)?.group.name;
  check("the HELP button's own sprite is what a click there lands on", under === "help", `propAt=${under}`);

  // 1. shift held: the readout, in the original's own spelling. The same string as
  // the screenshot in #8 — "Mission=1, Phase=4, Letter=0, Necklace=0" — and a
  // dialog, as it is there: the game stopping to answer is the behaviour, and the
  // details pane already carries a live version of the same six (taoot/src/debug-panel.ts).
  session.shiftDown = true;
  await session.track(v.click(help.x, help.y));
  for (let i = 0; i < 12; i++) { v.tick((clock += 50)); await drain(); }
  check(
    "shift-click on HELP says where the player is",
    notes.includes("Mission=1, Phase=4, Letter=0, Necklace=0"),
    `dialogs=${JSON.stringify(notes)}`,
  );

  // 2. nothing held: the ordinary help behaviour, and no readout. The button plays
  // help2w.mov, which is interactive and parks — hence `void`, and the movie is
  // asserted by what the engine says rather than by waiting for it to end.
  notes.length = 0;
  session.shiftDown = false;
  void session.track(v.click(help.x, help.y));
  for (let i = 0; i < 12; i++) { v.tick((clock += 50)); await drain(); }
  check("a plain click raises no readout", notes.length === 0, `dialogs=${JSON.stringify(notes)}`);
}
);

// The same button in the smokestack, where the readout carries two more fields:
// `if currentset() = "smstack1" | … ` adds Maze and Level, which are the two things
// about that puzzle a player cannot see — which of the four mazes is live, and how
// far up it they are.
test("in the smokestack the readout names the maze and the level", async () => {
  const notes: string[] = [];
  const { host, session } = await newHost();
  session.onNoteDialog = (m) => void notes.push(m);
  const g = session.interp.globals;
  g.set("mission", 3); g.set("phase", 2); g.set("tour", 0);
  await host.loadServerSet("smstack1.set");
  g.set("mazenumber", 2); g.set("stacklevel", 3);
  await session.track(session.transToFlat("ctl.stg"));
  const v = host.viewer!;
  const r = session.stageCtrl.flatRegion(session.currentFlat, "help")!;
  session.shiftDown = true;
  await session.track(v.click(Math.round((r.left + r.right) / 2), Math.round((r.top + r.bottom) / 2)));
  for (let i = 0; i < 12; i++) { v.tick((clock += 50)); await drain(); }
  check(
    "the smokestack readout carries the maze and the level",
    notes.some((n) => n.includes("Maze=2") && n.includes("Level=3")),
    `set=${session.currentSetName} dialogs=${JSON.stringify(notes)}`,
  );
}
);

// --- subtitles toggle + quiet-music default: subtitles are gated on
//     puppetparam slot 7 (the CTL.STG subtoggle lever), and music starts very
//     quiet with the theme lever synced to that low rest position. ---
test("TURNING to view62 fires openscene (per-view event) -> Sasha walks", async () => {
  const { session } = await newSession();
  const g = session.interp.globals;
  type Bi = (i: typeof session.interp, a: (number | string)[]) => unknown;
  const pp = session.interp.builtins.get("puppetparam")! as unknown as Bi;
  // music default is quiet and the theme lever reflects it (not the boot's deg 5)
  const quietDefault = Number(g.get("themevolume")) === 24;
  const leverSynced = Number(session.propRuntime.get("themetoggle")?.deg) === 0;
  // subtitles: on by default, puppetparam(7) flips the gate the viewer reads
  const onByDefault = session.subtitlesOn() === true && Number(pp(session.interp, [7])) === 1;
  pp(session.interp, [7, 0]);
  const offAfter = session.subtitlesOn() === false;
  pp(session.interp, [7, 1]);
  const onAgain = session.subtitlesOn() === true;
  check(
    "subtitles gate on puppetparam(7) + music starts quiet with the theme lever synced low",
    quietDefault && leverSynced && onByDefault && offAfter && onAgain,
    `themevol=${g.get("themevolume")} leverDeg=${session.propRuntime.get("themetoggle")?.deg} on=${onByDefault} off=${offAfter} onAgain=${onAgain}`,
  );
}
);

// --- cufflink clue pickup (CUFF.STG): the mission-2 purser investigation.
//     Clicking the cufflink1 chair in RECEPT1C sets cuffchair + transtoflat
//     "cuff.stg"; cuff.shp openshop reveals the hidden cufflink only when
//     mission=2 & cufflink unowned & the purs actor is on "findcuff" & chair 1.
//     You examine it (small->med->big) then take it into your bag. ZERO new
//     engine code — pure overlay-stage + prop + inventory reuse. ---
test("TURNING to view62 fires openscene (per-view event) -> Sasha walks", async () => {
  const { session, viewer } = await newSession();
  const g = session.interp.globals;
  g.set("mission", 2); g.set("tour", 0); g.set("cuffchair", "cufflink1");
  await session.openSetFile("recept1c.set");
  // satisfy the openshop gate so the hidden cufflink appears
  const purs = session.actorRuntime.get("purs");
  if (purs) purs.owner = "findcuff";
  const link = () => session.propRuntime.get("cufflink");
  if (link()) link()!.owner = "none";
  await session.track(session.transToFlat("cuff.stg"));
  const v = viewer();
  await runAnimations(v); // let the stage's fade-in finish before clicking
  const cuffcuff = () => session.propRuntime.get("cuffcuff");
  // opened on the right flat with the cufflink shown small and the bag posed
  const opened =
    session.stageName === "cuff.stg" &&
    session.currentFlat.toLowerCase() === "cuff 1" &&
    !!cuffcuff()?.visible && cuffcuff()?.stateName === "small" &&
    Number(session.propRuntime.get("cuffbag")?.deg) === 1;
  // click a prop where it actually draws (the sprite is offset from its anchor)
  const hitCenter = (name: string): [number, number] | null => {
    const inst = session.propRuntime.get(name);
    if (!inst?.visible) return null;
    const pts: [number, number][] = [];
    for (let y = 2; y < 384; y += 3)
      for (let x = 2; x < 512; x += 3)
        if (session.propRuntime.propAt(x, y, null, false) === inst) pts.push([x, y]);
    if (!pts.length) return null;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return [
      Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
      Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
    ];
  };
  const clickCuff = async () => {
    const c = hitCenter("cuffcuff");
    if (!c) return;
    session.setPointer(c[0], c[1]);
    session.pointerDown = true;
    await v.click(c[0], c[1]);
    session.pointerDown = false;
    await drain();
  };
  // the open transition leaves a one-frame loop in flight; let it finish so the
  // input gate (inputLocked) doesn't reject the prop clicks below
  let clk = 1000;
  for (let i = 0; i < 10 && session.scriptBusy; i++) { v.tick((clk += 50)); await drain(); }
  await clickCuff();
  const med = cuffcuff()?.stateName === "med";
  await clickCuff();
  const big = cuffcuff()?.stateName === "big";
  await clickCuff(); // big -> addcuff(): take it into the bag
  const took =
    !cuffcuff()?.visible &&
    String(link()?.owner) === "frank" &&
    String(g.get("handitem")) === "cufflink";

  check(
    "cufflink clue (CUFF.STG): flat opens with the hidden cufflink, examine small->med->big, take into inventory",
    opened && med && big && took,
    `opened=${opened} med=${med} big=${big} took=${took}`,
  );
}
);

// --- ship's-wheel steering sim (BRIDGE.STG): reached from BRIDGE.SET via
//     transtoflat "bridge.stg". openstage lays out the bridge frame + wheel +
//     four tiling sky props (sky3/sky4 are propinstance copies of sky1/sky2)
//     and starts the self-re-registering `skydrift` loop at framerate(2).
//     Turning the wheel sets `driftdesire`; skydrift eases `drifttotal` toward
//     it, and once it passes ±64 the ship swings off course (driftpos != 256 ->
//     drifthappen=1) and the sky scrolls. Needs 2 new builtins: propinstance +
//     calcmod. ---
test("TURNING to view62 fires openscene (per-view event) -> Sasha walks", async () => {
  const { session, viewer } = await newSession();
  const g = session.interp.globals;
  await session.openSetFile("bridge.set");
  await session.track(session.transToFlat("bridge.stg"));
  const v = viewer();
  let clk = 1000;
  const tick = (n: number) => (async () => {
    for (let i = 0; i < n; i++) { v.tick((clk += 66)); await drain(); }
  })();
  await tick(4); // let openstage place props + the open transition settle

  const P = (n: string) => session.propRuntime.get(n);
  // propinstance: sky3/sky4 exist and are drawn with sky1/sky2's sprite group
  const instanced =
    !!P("sky3") && !!P("sky4") &&
    P("sky3")!.group === P("sky1")!.group &&
    P("sky4")!.group === P("sky2")!.group;
  const opened =
    session.stageName === "bridge.stg" &&
    ["sky1", "sky2", "sky3", "sky4", "wheel", "bridge"].every((n) => P(n)?.visible) &&
    Number(g.get("driftpos")) === 256 &&
    Number(g.get("drifthappen")) === 0 &&
    Number(session.frameRate) === 2;
  const sky1x0 = Number(P("sky1")!.anchorX);

  // turn the wheel hard over (what the wheel drag writes) and let the ship drift
  g.set("driftdesire", 60);
  await tick(220);
  const drifted =
    Number(g.get("drifttotal")) > 64 &&
    Number(g.get("drifthappen")) === 1 &&
    Number(g.get("driftpos")) !== 256 &&
    Number(P("sky1")!.anchorX) !== sky1x0; // the sky scrolled with driftpos

  // calcmod: the wheel's getpropdeg maps a 0..255 angle into 0..4 frames
  type Bi = (i: typeof session.interp, a: (number | string)[]) => unknown;
  const calcmod = session.interp.builtins.get("calcmod")! as unknown as Bi;
  const modOk = calcmod(session.interp, [70, 32]) === 6 && calcmod(session.interp, [-1, 32]) === 31;

  check(
    "bridge steering (BRIDGE.STG): opens with the tiling sky (propinstance) + wheel, turning the wheel drifts the ship off course and scrolls the sky",
    opened && instanced && drifted && modOk,
    `opened=${opened} instanced=${instanced} drifted=${drifted} (pos=${g.get("driftpos")} total=${g.get("drifttotal")} happen=${g.get("drifthappen")}) calcmod=${modOk}`,
  );
}
);

// --- endgame slideshow logic (NAREND.STG): the ending is chosen by who owns
//     the four artifacts. worldwar1/worldwar2/rushrev return the list of
//     "newspaper" flats to show and set onehappens/twohappens/revhappens;
//     futures() maps those three flags to the final future (last word -> the
//     ending movie; "proz" is the only mission="good" outcome). Pure logic, so
//     we drive the handlers directly (like the blackjack winner() test). ZERO
//     new engine code — a scripted slideshow over existing machinery. ---
test("TURNING to view62 fires openscene (per-view event) -> Sasha walks", async () => {
  const { session } = await newSession();
  await session.openSetFile("c78.set"); // loads inven.shp so the artifact props exist
  const file = readContainerFile(provider("narend.stg")!);
  let inst: ScriptInstance | null = null;
  for (const c of file.containers) {
    const tokens = sniffScript(c.data);
    if (!tokens) continue;
    const script = parseScript(tokens);
    if (script.codes.has("futures")) {
      inst = new ScriptInstance("narend", script);
      break;
    }
  }
  const own = (n: string, o: string) => {
    const p = session.propRuntime.get(n);
    if (p) p.owner = o;
  };
  const run = async (h: string): Promise<string> =>
    String((await session.interp.runHandler(inst!, h, [], { me: "narend", target: "" })).value ?? "");
  const lastWord = (s: string): string => s.split(",").pop() ?? "";

  // best ending: artifacts preserved -> all three flags false -> Prozac future
  own("painting", "frank");
  own("notebook", "frank");
  own("rubaiyat", "frank");
  own("realneck", "frank");
  const g1 = await run("worldwar1");
  const g2 = await run("worldwar2");
  const g3 = await run("rushrev");
  const gf = await run("futures");
  // futures() reads the onehappens/twohappens/revhappens globals that the three
  // war/rev handlers set, so a correct `gf` also proves those flags propagated
  const good =
    g1 === "4,07,11,11b,12" &&
    g2 === "6,17,17b,18,18b,19,20" &&
    g3 === "5,22,23,24,25,26" &&
    lastWord(gf) === "proz";

  // worst ending: rubaiyat + necklace to vlad, painting to hack, notebook lost
  // -> all three flags true -> "nochange" future (boom.mov), mission stays bad
  own("rubaiyat", "vlad");
  own("realneck", "vlad");
  own("painting", "hack");
  own("notebook", "vlad");
  const b1 = await run("worldwar1");
  const b2 = await run("worldwar2");
  const b3 = await run("rushrev");
  const bf = await run("futures");
  const bad =
    b1 === "3,03,04,05" &&
    b2 === "2,15,16" &&
    b3 === "1,21" &&
    lastWord(bf) === "nochange.01";

  check(
    "endgame (NAREND.STG): artifact ownership drives worldwar1/2/rushrev + futures (good=Prozac, bad=nochange)",
    !!inst && good && bad,
    `good=${good} (ww1=${g1} fut=${lastWord(gf)}) bad=${bad} (ww1=${b1} fut=${lastWord(bf)})`,
  );
}
);

// --- 59. Game clock: tickTime drives boot idle()->calctime(), on both hosts ---
// The menu-band pocketwatch's second-hand ticks because the real engine ran
// calctime() every idle() pass (calctime advances one game-second per 20 calls,
// BOOTFILE 0002:40). We drive it from tickTime at 20 calls per second of the
// `now` the host feeds in — wall time in a browser, the pumped virtual clock
// headless. It is NOT gated on hasRealFrames: calctime is where mission 4's
// sinkflag turns into advancephase(), so gating it left the headless sinking
// frozen and the mission-4 goldens traces of a ship that isn't sinking.
//
// Two things are pinned here. The rate, which is the pocketwatch keeping time;
// and that the heartbeat is NOT scriptBusy while it dispatches — it is the idle
// pass, not a script the player started, and the input queue waits on scriptBusy.
test("game clock: tickTime drives calctime at 1 sec/second, and is not scriptBusy", async () => {
  const { session } = await newSession();
  const g = (n: string): number => Number(session.interp.globals.get(n) ?? 0);
  const set = (n: string, v: number): void => void session.interp.globals.set(n, v);
  set("sinkflag", 0);
  set("clockcount", 0);
  set("sec", 0);
  set("min", 30);
  set("hrs", 9);

  // 20 calctime calls per second of `now` -> the second hand advances once a
  // second. Drive ~3 seconds at 50 ms a frame; the first call only anchors.
  let now = 0;
  let busyDuringHeartbeat = false;
  session.tickTime((now += 50));
  await drain();
  for (let i = 0; i < 61; i++) {
    session.tickTime((now += 50));
    // sampled INSIDE the tick's microtask window, which is the only moment the
    // dispatch is in flight at all — the bug this guards was invisible from
    // outside it, and cost the input queue two of three presses.
    if (session.scriptBusy) busyDuringHeartbeat = true;
    await drain();
  }
  // 60 dispatched calls after the anchor -> sec crossed 20 and 40 -> 3
  const secAdvanced = g("sec");

  check(
    "game clock: second hand ticks ~1/second and the heartbeat never reads busy",
    secAdvanced === 3 && !busyDuringHeartbeat,
    `sec=${secAdvanced} clockcount=${g("clockcount")} busyDuringHeartbeat=${busyDuringHeartbeat}`,
  );
}
);

// --- 59a. canadvance(): the sinking clock is pinned at each phase threshold ---
// BOOTFILE's calctime() has two arms, and the sinking one is gated on
// canadvance(): while the clock has reached a threshold that the phase has not
// caught up with, minutes do NOT advance — only sec cycles — and advancephase()
// retries sinkmovie() until it takes (it refuses while a cast member is within
// 300 units or the camera is mid-move). That gate is why hrs/min are the same in
// both hosts at every phase boundary even though the seconds between them never
// are, and it is the whole reason mission 4 can be gated cross-host at all.
test("canadvance: mission 4 pins hrs/min at a phase threshold until the movie takes", async () => {
  const { session } = await newSession();
  const g = (n: string): number => Number(session.interp.globals.get(n) ?? 0);
  const set = (n: string, v: number | string): void => void session.interp.globals.set(n, v);
  set("mission", 4);
  set("sinkflag", 1);
  set("hrs", 13);
  set("min", 15);
  set("sec", 0);

  // the gate itself: reached-but-not-serviced is true, serviced is false — and it
  // is `phase` that flips it, which is why sinkmovie refusing keeps time stopped.
  // canadvance reads `clock`, the HHMM calctime last wrote — not hrs/min direct.
  set("clock", 1315);
  set("phase", 0);
  const heldAtThreshold = Boolean(await session.runGlobal("canadvance"));
  set("phase", 1);
  const releasedOnceServiced = !(await session.runGlobal("canadvance"));

  // and the integration: driven from 13:14:59 the clock lands ON 1315 rather
  // than stepping over it, because the minute hand is pinned the moment the
  // threshold is reached and only released when the phase catches up.
  set("phase", 0);
  set("min", 14);
  set("sec", 59);
  set("clockcount", 19);
  set("clock", 1314); // one second short of the threshold, gate open
  let now = 0;
  session.tickTime((now += 50));
  await drain();
  for (let i = 0; i < 200; i++) {
    session.tickTime((now += 50));
    await drain();
  }
  await session.settle();
  // sinkmovie() takes here (nothing is within 300 units of a fresh session and
  // the camera is still), so phase steps exactly once: 0 -> 1, at 13:15 sharp.
  const landedOnThreshold = g("hrs") === 13 && g("min") === 15 && g("clock") === 1315;

  check(
    "canadvance: gate holds at a reached threshold, releases once phase catches up",
    heldAtThreshold && releasedOnceServiced && landedOnThreshold && g("phase") === 1,
    `held=${heldAtThreshold} released=${releasedOnceServiced} ` +
      `hrs=${g("hrs")} min=${g("min")} sec=${g("sec")} phase=${g("phase")} clock=${g("clock")}`,
  );
}
);

// --- 59b. Attention does not outlive the loop that would clear it ------------
// gang.cst's hasattention(seconds) accosts you once frame() - attentionspan
// passes its threshold, and the ONLY thing that drops the claim is
// clearattention(), called from the character's own idle loop when you step out
// of hotdist(). The boot library's putdownactor (bootfile c2) hides the actor
// and stops that loop in consecutive lines, so once a room is left nothing can
// clear the claim — while frame() keeps climbing. Come back and they accost you
// on the doorstep instead of after four seconds, for ever.
//
// Measured before the fix: leave stair2c with the claim held and
// attentionspan froze at 46 while frame() ran to 266, with zero loops armed.
test("attention: putting a character down drops their claim on your attention", async () => {
  const { session } = await newSession();
  const g = (n: string): string => String(session.interp.globals.get(n) ?? "");
  const vis = session.interp.builtins.get("actorvisible")!;
  // actorvisible ignores both of these; they only exist to satisfy the signature
  const site: CallExpr = { t: "call", name: "actorvisible", args: [] };
  const frame = { ctx: { me: "", target: "" }, locals: new Map() } as unknown as Parameters<typeof vis>[3];
  const someone = [...(session.actorRuntime as unknown as { actors: Map<string, unknown> }).actors.keys()][0];

  // held by a character who is on screen
  session.interp.globals.set("curattention", someone);
  await vis(session.interp, [someone, 1], site, frame);
  const heldWhilePresent = g("curattention") === someone;

  // putdownactor's first line — after which its second stops their idle loop
  await vis(session.interp, [someone, 0], site, frame);
  const droppedOnceGone = g("curattention") === "";

  // and someone else's claim is none of our business
  session.interp.globals.set("curattention", "somebodyelse");
  await vis(session.interp, [someone, 0], site, frame);
  const leavesOthersAlone = g("curattention") === "somebodyelse";

  check(
    "attention: kept while present, dropped when put down, and scoped to that character",
    heldWhilePresent && droppedOnceGone && leavesOthersAlone,
    `actor=${someone} held=${heldWhilePresent} dropped=${droppedOnceGone} scoped=${leavesOthersAlone}`,
  );
}
);

// --- 59c. A close-up is out of sight, so nobody's attention runs down in one --
// The other half of the same guard. gang.cst's hasattention(seconds) opens with
// `if actordist(target) = 32000 → attentionspan = frame()`: a character you
// cannot see restarts the clock rather than running it down. `setVisible` false
// is the engine saying the room is not being drawn at all — a stage flat is over
// it — so the sentinel is the honest answer there.
//
// Measured before the fix, in recept1c with cuff.stg open: maxidle re-armed every
// 20 ticks, hasattention(4) came due at frame 122 and Max walked up and started a
// conversation ON TOP of the chair close-up, which left the flat's own OK
// unreachable behind the puppet. Headless the route was out of the flat inside
// four seconds; a browser spends real ones (docs/taoot/verification.md).
test("actordist: a flat over the room reads as not present, so hasattention re-arms", async () => {
  const { session } = await newSession();
  session.interp.globals.set("mission", 1);
  await session.openSetFile("stair2c.set");
  const dist = session.interp.builtins.get("actordist")!;
  const site: CallExpr = { t: "call", name: "actordist", args: [] };
  const frame = { ctx: { me: "", target: "" }, locals: new Map() } as unknown as Parameters<typeof dist>[3];
  const who = [...(session.actorRuntime as unknown as { actors: Map<string, { visible: boolean }> }).actors.keys()][0];
  check(`${who} stands where the camera sees them`, standInView(session, who), who);

  const inTheRoom = Number(await dist(session.interp, [who], site, frame));
  session.setVisible = false; // what transtoflat() leaves behind it
  const behindAFlat = Number(await dist(session.interp, [who], site, frame));
  session.setVisible = true;
  const backInTheRoom = Number(await dist(session.interp, [who], site, frame));

  check(
    "actordist: a real distance in the room, the 32000 sentinel under a flat",
    inTheRoom !== 32000 && behindAFlat === 32000 && backInTheRoom === inTheRoom,
    `actor=${who} room=${inTheRoom} flat=${behindAFlat} back=${backInTheRoom}`,
  );
}
);

// The THIRD half of the same guard, and the one that shipped broken: a puppet
// CONVERSATION is a close-up too, and it does not touch `setVisible` — only a
// stage flat clears that. So while you were talking to someone, the whole cast's
// idles went on counting down, and `hasattention(4)` came due and accosted you
// inside the conversation you were already having: `sendtoactor(target,
// mousedown(0))` re-enters the character's own mousedown, which runs
// `walktopuppet` a second time and replays the exchange from the top.
//
// User-reported, and visible in the console as every line arriving twice —
// `msg: vlad` twice, which is `walktopuppet`'s own first statement
// (`message(who)`), and Morrow's ending saying each of its stage directions twice.
// It is audible as well: the second run's `puppetspeak` halts the first's on the
// shared channel, cutting the line off mid-word.
//
// Vlad is the plain case. gang.cst 0960 opens him with `walktopuppet(20, …)` —
// unlike the `-1` path that one never `pauseloop`s the actor — so `vladidle`
// re-arms every 20 ticks and its `hasattention(4)` fires four seconds in. Four
// REAL seconds is why no headless test caught this and a person always does; the
// cuff.stg case above only ever showed in a browser for exactly that reason.
test("actordist: a conversation reads as not present, so nobody accosts you mid-talk", async () => {
  const { session } = await newSession();
  session.interp.globals.set("mission", 1);
  await session.openSetFile("stair2c.set");
  const dist = session.interp.builtins.get("actordist")!;
  const site: CallExpr = { t: "call", name: "actordist", args: [] };
  const frame = { ctx: { me: "", target: "" }, locals: new Map() } as unknown as Parameters<typeof dist>[3];
  const actors = (session.actorRuntime as unknown as { actors: Map<string, { visible: boolean }> }).actors;
  const who = [...actors.keys()][0];
  check(`${who} stands where the camera sees them`, standInView(session, who), who);

  const inTheRoom = Number(await dist(session.interp, [who], site, frame));
  check("a visible actor in the room has a real distance", inTheRoom !== 32000, `${who}=${inTheRoom}`);

  // what openpuppetfile leaves behind it: the world display is replaced, and
  // `setVisible` is untouched — which is the whole bug.
  const opened = await session.puppetCtrl.openPuppetFile("vlad2.pup");
  check("the conversation opened", opened && !!session.puppet?.visible, `opened=${opened}`);
  check(
    "...and setVisible is still true, so the flat guard cannot cover this",
    session.setVisible,
    `setVisible=${session.setVisible}`,
  );
  const inConversation = Number(await dist(session.interp, [who], site, frame));
  check(
    "an actor read from inside a conversation is not present",
    inConversation === 32000,
    `${who}=${inConversation}`,
  );

  session.puppetCtrl.closePuppetFile();
  const after = Number(await dist(session.interp, [who], site, frame));
  check("and the real distance is back once it closes", after === inTheRoom, `${who}=${after}`);
}
);

// --- 59c-bis. Out of view is out of reach ----------------------------------
// The fourth face of the same guard, and the one a player meets first: a
// character you simply cannot SEE must not stop you either (#180).
//
// Daisy Cashmore stands on the B-deck landing of `stair1c1`, and the room's two
// decks are one set, so `realdist(me) < hotdist()` — the only range gate
// `cashidle` has — is satisfied from the A-deck landing directly above her. She
// walked up through the floor and started talking. What the original leans on is
// the other gate, in `hasattention`: `actordist` runs the actor→screen
// projection and answers 32000 wherever it refuses, and an empty intersection
// with the view rectangle is a refusal (see ActorRuntime.onScreen).
//
// The reporter measured seven standpoints in the original against the port, and
// they are the whole test — six where the original leaves you alone and one
// where it accosts. Distance alone gets six of the seven WRONG (every one of
// them is inside hotdist's 4000 for this room bar Scene101); distance plus the
// projection gets all seven right, and the two gates are visible separately in
// the numbers below.
test("hasattention: a character you cannot see does not accost you (#180)", async () => {
  // scene, view, on screen?, inside hotdist("stair1c1") = 4000?, what the original does
  const SPOTS: [string, string, boolean, boolean, string][] = [
    ["Scene55", "View74", false, true, "A deck, where the report was filed"],
    ["Scene56", "View66", false, true, "A deck, the report's headline standpoint"],
    ["Scene54", "View69", false, true, "A deck, right over her head"],
    ["Scene43", "View47", false, true, "B deck, facing away from her"],
    ["Scene23", "View31", false, true, "B deck, in front of her but facing aside"],
    ["Scene101", "View102", true, false, "the forward side: in view, out of range"],
    ["Scene43", "View46", true, true, "the corner facing her — the ONE that accosts"],
  ];
  const { session, viewer, logs } = await newHost();
  session.interp.globals.set("mission", 1);
  await session.openSetFile("stair1c1.set", "Scene55", "View74");
  await drain();
  await session.sendEvent("sendtoactor", "cash", "setupactor", ["stair1c1"], "cash");
  await drain();

  const cash = session.actorRuntime.get("cash")!;
  check("Cashmore is in the room", cash.visible && cash.setName === "stair1c1", `set=${cash.setName}`);

  const dist = session.interp.builtins.get("actordist")!;
  const site: CallExpr = { t: "call", name: "actordist", args: [] };
  const frame = { ctx: { me: "", target: "" }, locals: new Map() } as unknown as Parameters<typeof dist>[3];

  for (const [scene, view, seen, inRange, note] of SPOTS) {
    viewer().jumpTo(scene, view);
    await drain();
    const answer = Number(await dist(session.interp, ["cash"], site, frame));
    const lis = session.listener()!;
    const real = Math.round(Math.hypot(cash.worldX - lis.x, cash.worldY - lis.y));
    check(
      `${scene}/${view}: ${note}`,
      (answer !== 32000) === seen && (real < 4000) === inRange,
      `actordist=${answer} realdist=${real} (want ${seen ? "in view" : "out of view"}, ` +
        `${inRange ? "in range" : "out of range"})`,
    );
  }

  // ...and the trace the reporter asked for alongside the fix: who has claimed
  // you, and whether they can see you. Both are on the pane, in the same place
  // the scripts' own `msg:` lines are.
  check(
    "the log says who claimed your attention",
    logs.some((l) => l.startsWith('glob: curattention = "cash"')),
    logs.filter((l) => l.startsWith("glob:")).join(" | ") || "no glob: line",
  );
  check(
    "...and that she cannot see you from there",
    logs.some((l) => l.startsWith("sight: cash out of view")) &&
      logs.some((l) => l.startsWith("sight: cash in view")),
    logs.filter((l) => l.startsWith("sight:")).join(" | ") || "no sight: line",
  );
}
);

// --- 59d. An engine-driven arrival runs no idle ----------------------------
// The guards above cover a conversation that is ALREADY open. This is the window
// before it: `walktopuppet` walks the character to you with `moveactorxyz` ->
// `walktoxyz` and holds `while iswalk(who) forceupdate()`, and their arrival used
// to run their own idle inside that wait.
//
// `endwalk` runs the idle, the idle calls `hasattention`, and `hasattention` only
// releases its claim (`curattention = ""`) AFTER `sendtoactor(target,
// mousedown(0))` returns. So mid-approach the claim still stands and
// `attentionspan` is still stale, and it accosts you again on the spot, nesting
// one more `walktopuppet` each round.
//
// Measured before the fix, standing still and touching nothing: boil gave 13
// `msg: vlad` (that line is `walktopuppet`'s own `message(who)`), 9 opens of
// vlad1.pup and `dispatch cycle … at depth 64`; recept1c the same with Max. The
// count is a stack ceiling, not a rate — every repeat walk is 1 unit long
// because `walktopuppet` recomputes a destination the character is already
// standing on, so it is the same whatever `actorspeed` says.
//
// decka is the third face of it: Max's `endwalk` there starts the next leg of his
// patrol, so `iswalk(who)` never goes false, `walktopuppet` never reaches
// `runpuppet`, and the player is left holding `cursor("watch")` with the dispatch
// still in flight. (Issues #10, #19, #21.)
//
// What stops all three is the arrival STAR, which is where TAOOT put the guard:
// a `walktoxyz` lands on `"custom"` and every `endwalk` in the corpus opens by
// returning on it. The port used to leave the old star in place, so the guard
// never fired. This test held with an engine-side rule instead (arrivals deferred
// out of a running script) and holds identically with the sentinel — the A/B is
// in #31; take the sentinel out and boil goes back to 5 accosts and decka hangs.
test("actor arrival: an engine-driven arrival runs no idle", async () => {
  // room, character, and whether the player clicks them or just stands there
  const CASES: [string, string, boolean][] = [
    ["boil.set", "vlad", false],      // #19 — he comes to you
    ["recept1c.set", "max", false],   // #21 — same, in the reception room
    ["decka.set", "max", true],       // #10 — you click him, mid-patrol
  ];
  for (const [set, who, clicked] of CASES) {
    const { session, logs } = await newHost();
    session.interp.globals.set("mission", 1);
    session.interp.globals.set("maxphase", 0);
    await session.openSetFile(set);
    await drain();
    await session.sendEvent("sendtoactor", who, "setupactor", [set.replace(".set", "")], who);
    await drain();

    const a = session.actorRuntime.get(who)!;
    const lis = session.listener()!;
    const tick = async (n: number): Promise<void> => {
      for (let i = 0; i < n; i++) {
        session.tickTime((clock += 50));
        await drain();
      }
    };
    await tick(40); // let the room's idles arm

    // Stand them in front of the camera — inside hotdist() AND on screen, which
    // is what arms the accost — and do it here rather than before the settle,
    // because a patrol would have walked them off again.
    //
    // "On screen" is the half added by #180. The old placement put them 200
    // units to the side at a height of `lis.y + 200` — thousands of units in the
    // air, nowhere the camera looks — which was inside hotdist() and so used to
    // arm the accost all the same. That is the bug this suite now refuses.
    session.scheduler.stopWalk(who);
    check(`${set}: ${who} stands where the camera sees them`, standInView(session, who), who);
    // 300 units ahead, because `hotdist("decka")` is the tightest in the game
    // at 500 (gang.cst 0001) and the accost has to be inside it
    check(
      `${set}: ...and inside hotdist()`,
      Math.hypot(a.worldX - lis.x, a.worldY - lis.y) < 500,
      `realdist=${Math.round(Math.hypot(a.worldX - lis.x, a.worldY - lis.y))}`,
    );

    const from = logs.length;
    if (clicked) void session.track(session.sendEvent("sendtoactor", who, "mousedown", [0], who));
    await tick(600); // 30 s of standing still: ample for hasattention(4)
    const said = logs.slice(from);
    const accosts = said.filter((l) => l === `msg: ${who}`).length;
    const puppets = said.filter((l) => l.startsWith("puppet opened")).length;
    const cycles = said.filter((l) => l.includes("dispatch cycle")).length;
    check(
      `${set}: one approach, one conversation, no re-entry`,
      accosts === 1 && puppets === 1 && cycles === 0 && !session.scheduler.isWalk(who),
      `walktopuppet=${accosts} puppets=${puppets} cycles=${cycles} ` +
        `stillWalking=${session.scheduler.isWalk(who)}`,
    );
  }
}
);

// --- 60. Overlay-bag hittest: items -> "prop", OK/examine -> "button" ---------
// A bag opened FROM a puppet conversation (INVEN.SHP selhandbevel -> transtoflat
// -> handleselect) is driven by handleselect's own modal poll loop, which reads
// hittest()/result() itself rather than going through the host click path — and
// `switch result()` on "prop" (select item) / "button" (OK, examine). The
// overlay hitTestAt used to resolve EVERY hit as "flat", so nothing was
// selectable. Assert it now matches the real engine's ordering: foreground prop
// first, then a named flat region as "button". (Also the contract HOUSE.SHP's
// invenctl relies on: `if result()="button" sendtobutton else sendtoflat`.)
test("overlay bag hittest: items resolve as props, OK/examine as buttons (conversation gift path)", async () => {
  const { session } = await newSession();
  const g = session.interp.globals;
  g.set("mission", 1);
  await session.openSetFile("c73.set", "scene51", "view63");
  await session.sendEvent("sendtoshop", "inven.shp", "addinven", ["carkeys"], "test");
  await session.sendEvent("sendtoshop", "inven.shp", "addinven", ["notebook"], "test");
  await session.runGlobal("transtoflat", ["inven1.stg"]);
  await session.settle(200);
  const onBag = session.stageName === "inven1.stg" && !session.setVisible;

  // find an opaque point on an inventory-item sprite -> must hittest as "prop"
  let itemHit = { name: "", type: "" };
  outer: for (let y = 0; y < 384; y += 4) {
    for (let x = 0; x < 512; x += 4) {
      const p = session.propRuntime.propAt(x, y, null, false);
      if (p && (p.group.name === "carkeys" || p.group.name === "notebook")) {
        itemHit = session.hitTestAt(x, y);
        break outer;
      }
    }
  }

  // examine (magnifier) + OK are flat REGIONS -> must hittest as "button"
  const region = (n: string) =>
    session.stageCtrl.currentFlatRegions().find((r) => r.name.toLowerCase() === n)!;
  const centre = (n: string): { name: string; type: string } => {
    const r = region(n);
    return session.hitTestAt((r.left + r.right) >> 1, (r.top + r.bottom) >> 1);
  };
  const examHit = centre("examine");
  const okHit = centre("ok");

  check(
    "overlay bag: item->prop, examine/ok->button",
    onBag &&
      itemHit.type === "prop" &&
      examHit.type === "button" && examHit.name.toLowerCase() === "examine" &&
      okHit.type === "button" && okHit.name.toLowerCase() === "ok",
    `onBag=${onBag} item=${itemHit.type}:${itemHit.name} examine=${examHit.type}:${examHit.name} ok=${okHit.type}:${okHit.name}`,
  );

  // The OK button confirms via `sendtobuttonfx(flat, "ok", trackbut(...))`, but
  // trackbut is a BOOTFILE helper, not on the "ok" region. sendToButton must
  // fall through to the boot library (with target="ok" so trackbut's
  // pointinbutton(currentflat(), target, ...) hit-tests THIS region) — without
  // it OK returned 0 and the bag never closed. Drive the press-hold-release: a
  // release OVER the region returns 1 (closes), a release outside returns 0.
  const okRegion = region("ok");
  const okCx = (okRegion.left + okRegion.right) >> 1;
  const okCy = (okRegion.top + okRegion.bottom) >> 1;
  const trackOK = async (x: number, y: number): Promise<number> => {
    session.setPointer(x, y);
    session.pointerDown = true;
    let now = session.clock.now;
    const p = session.stageCtrl.sendToButton("inven 1", "ok", "trackbut", ["invenctl", 256, 192], "inven.shp");
    let done = false;
    let ret: unknown;
    void p.then((v) => { done = true; ret = v; });
    for (let i = 0; i < 3 && !done; i++) { session.clock.advance((now += 20)); await drain(); }
    session.pointerDown = false; // release
    for (let i = 0; i < 20 && !done; i++) { session.clock.advance((now += 20)); await drain(); }
    await p;
    return Number(ret);
  };
  const releasedOnOK = await trackOK(okCx, okCy);
  const releasedOffOK = await trackOK(10, 10);

  check(
    "overlay bag: OK (trackbut via boot fallback) closes on release-over, cancels on release-off",
    releasedOnOK === 1 && releasedOffOK === 0,
    `over=${releasedOnOK} off=${releasedOffOK}`,
  );
}
);


// --- 61. passcode climbs the containment chain, and the cursor rides it -------
// `passcode` means "not mine, ask whoever holds me". sendEvent honoured that
// ALONG a chain but not OFF the end of one, and for a prop the chain is one link
// long — so a prop handler's passcode was a dead end and the shop main behind it
// was unreachable.
//
// inven.shp's notebook (container 0088) is the measured case. Its own setcursor
// answers for the one place the notebook is scenery rather than luggage:
//
//     if currentset () = "smstack3" & propview (me) = "small"
//        & not (currentview () = "view53" | currentview () = "view55")
//         cursor ("arrow")
//         exitcode
//     endif
//     passcode
//
// so in View53 it passcodes, and the only script that can answer is the shop
// main — whose own answer is DISTANCE-GATED (`if realdist(target) < hotdist()`),
// which is where the hand cursor over a takeable thing comes from in the first
// place, and why an object across the room is not one.
test("passcode off the end of a chain reaches the shop main (notebook setcursor)", async () => {
  const at = async (scene: string, view: string): Promise<{ cursor: string; far: string }> => {
    const { session } = await newSession();
    await session.openSetFile("smstack3.set", scene, view);
    await session.sendEvent("sendtoprop", "notebook", "setupprop", ["smstack3"], "test");
    const point = session.pointerPoint();
    session.cursorName = "";
    await session.sendEvent("sendtoprop", "notebook", "setcursor", [point], "boot script");
    const cursor = session.cursorName;
    // and the gate itself: the same prop, out of reach. The main's small-item arm
    // passcodes when realdist >= hotdist, nothing above it answers, and the
    // pointer stays the plain arrow rather than promising a click that won't take.
    const nb = session.propRuntime.get("notebook")!;
    nb.worldX += 100_000;
    session.cursorName = "";
    await session.sendEvent("sendtoprop", "notebook", "setcursor", [point], "boot script");
    return { cursor, far: session.cursorName };
  };
  // View53: the own handler passcodes -> the shop main answers for a prop within reach
  const close = await at("scene38", "view53");
  // View51: the own handler answers itself, and the main is never asked
  const scenery = await at("scene38", "view51");
  check(
    "notebook: a passcode in View53 reaches inven.shp's main (touch), View51 answers itself (arrow)",
    close.cursor === "touch" && scenery.cursor === "arrow",
    `view53=${JSON.stringify(close.cursor)} view51=${JSON.stringify(scenery.cursor)}`,
  );
  check(
    "notebook: out of reach, the main passcodes too and the cursor stays the plain arrow",
    close.far === "",
    `far=${JSON.stringify(close.far)}`,
  );
});

// --- 82. a load and a restart both arrive from nowhere ----------------------
// Two entry points that are not a walk between rooms, and both used to leave the
// screen set up for the room the player was leaving.
//
// LOAD (#36). `changeset` records `oldset = currentset()` before it opens
// anything, and the arriving room's `setupsound` opens with `if themetype
// (currentset ()) = themetype (oldset) exitcode` — the guard that keeps a deck
// theme playing as you walk. Load a save of the room you are ALREADY in and the
// two are equal, so nothing scored the room; the load path had just halted the
// theme, so that meant silence, and the host's startTheme fallback then played
// the SET-NAMED bank. Measured over the shipped saves, reloading in place:
// gstair3, bind, hallb and sqhall came back silent, and the London flat came
// back playing `bedsit1.trk` — the BOMBING score, not the flat's radio.
//
// Which in bedsit1 is a lock, not a wrong tune: BEDSIT1.SET's `setcursor` gives
// memory, paper, cabinet, obit, cards, mantle, poster and radio a `touch` cursor
// only while `currenttheme (2) != "bedsit1.trk"`. The game's own first save
// saves the room you start in, so loading it started the sirens and left only
// the door and the landlady clickable.
//
// RESTART (#35). Quit is reached from the CTL panel, which is a flat — so
// `transtoflat("ctl.stg")` has already pushed main.stg onto the overlay stack
// and set `setVisible = false`, and the player quits instead of taking the
// `transfromflat` that would put it back. The new game then opened its rooms
// behind a room nobody could see: audio, loops and traffic over a white void.
test("a load and a restart both arrive from nowhere", async () => {
  // --- the load ---
  const { session, viewer, logs } = await newHost();
  let clock = 0;
  const tick = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) { viewer()?.tick((clock += 50)); await drain(); }
  };
  await session.openSetFile("bedsit1.set");
  await drain();
  await tick(20);
  const saves = gamefiles(root).savesDir();
  const dir = saves ? join(saves, "1") : "";
  const file = dir ? (readdirSync(dir).find((f) => f.startsWith("01 -")) ?? "") : "";
  if (file) {
    await loadGame(session, new Uint8Array(readFileSync(join(dir, file))));
    await tick(60);
    const theme = String(session.currentThemeName);
    // setupsound's own two effects for this room: the radio as the theme, and
    // the scene3 sfx loop it arms alongside
    const sfxArmed = session.scheduler.loops.some(
      (l) => l.kind === "scene" && String(l.handler) === "sfx",
    );
    // and the room's gate, asked the way the game asks it — hover each hotspot
    const v = viewer()!;
    const cursors: string[] = [];
    for (const o of v.scene.views[v.viewIdx].objects) {
      await v.hover(
        Math.floor((o.startRegionX + o.endRegionX) / 2),
        Math.floor((o.startRegionY + o.endRegionY) / 2),
      );
      await drain();
      cursors.push(session.cursorName || "arrow");
    }
    check(
      "load into the room you are standing in: the flat's radio, not the bombing score",
      theme === "bedrad1.trk" && sfxArmed && cursors.length > 0 &&
        cursors.every((c) => c === "touch"),
      `theme=${theme} sfxLoop=${sfxArmed} cursors=${cursors.join(",") || "(no hotspots)"}`,
    );
  }
  void logs;

  // --- the restart ---
  const { session: s2 } = await newHost();
  await s2.openSetFile("bedsit1.set");
  await drain();
  await s2.runGlobal("transtoflat", ["ctl.stg"]);
  await s2.settle(200);
  const onPanel = s2.setVisible === false && s2.interp.globals.get("savestage1") === "main.stg";
  await s2.prepareRestart();
  check(
    "quit from the save panel leaves the next game a screen it may draw on",
    onPanel && s2.setVisible === true && s2.interp.globals.get("savestage1") === "",
    `onPanel=${onPanel} setVisible=${s2.setVisible} ` +
      `savestage1=${JSON.stringify(s2.interp.globals.get("savestage1"))}`,
  );
});

// --- 82b. a load puts the watch and the bag back ON the band ----------------
// The #143 restore reads the prop record verbatim — but `worldSpace` stayed the
// port's own live flag, and the London flat (the boot's landing room) places
// TAOOT's watch and bag as WORLD props (`setuprop`'s propxyz onto the cabin
// furniture). Loading any post-boarding save then restored their band state
// and never drew them: drawList skips world props, so the band came back with
// no bag and no watch — no inventory and no pocketwatch, in every load taken
// from a fresh boot. The record's own `propis3d` is the flag, so a load
// restores it in both directions.
test("a load restores propis3d: band props draw, furniture props stay world", async () => {
  const { session } = await newHost();
  await session.openSetFile("bedsit1.set");
  await drain();
  const watch = () => session.propRuntime.get("watch")!;
  const bag = () => session.propRuntime.get("bag")!;
  check(
    "the flat places the watch and bag in the world first",
    watch().worldSpace && bag().worldSpace,
    `watch=${watch().worldSpace} bag=${bag().worldSpace}`,
  );
  const saves = gamefiles(root).savesDir();
  const dir = saves ? join(saves, "1") : "";
  const banded = dir ? (readdirSync(dir).find((f) => f.startsWith("10 -")) ?? "") : "";
  const preBoarding = dir ? (readdirSync(dir).find((f) => f.startsWith("02 -")) ?? "") : "";
  if (!banded || !preBoarding) return;
  // a save with both in the band: they come back screen-space, anchored, lit
  await loadGame(session, new Uint8Array(readFileSync(join(dir, banded))));
  check(
    "the band's watch and bag are screen props again",
    !watch().worldSpace && !bag().worldSpace &&
      watch().visible && bag().visible &&
      watch().anchorX === 256 && watch().anchorY === 324,
    `watch world=${watch().worldSpace} vis=${watch().visible} @${watch().anchorX},${watch().anchorY} ` +
      `bag world=${bag().worldSpace} vis=${bag().visible}`,
  );
  // and the mirror: a save with the bag still on C73's floor puts it back in
  // the world (its place re-derives from the room, as the original's does)
  await loadGame(session, new Uint8Array(readFileSync(join(dir, preBoarding))));
  check(
    "the pre-boarding save's bag is a world prop again",
    bag().worldSpace && bag().stateName === "small",
    `world=${bag().worldSpace} view=${bag().stateName}`,
  );
});

// --- 83. a click holds the engine, so nothing dispatches over a movie -------
// #33, the London flat's softlock. A click is a script, and the engine is
// single-threaded — but a click went untracked, so while a hotspot's
// `spotmovie` sat modal on the screen `scriptBusy` was false and the scheduler
// read the engine as free.
//
// BEDSIT1.SET arms the air raid the instant bombpoints passes 10 —
// `makeloop ("scene", "scene1", "bomb", random (100))` — so it comes due while
// you are still looking at whatever you clicked to score that point. `bomb`
// starts the sirens and hands off to the scene's `gotowin`, which turns you to
// the window with a bare
//
//     while currentview () != "view23"
//         currentscene ("right")
//         …
//     endwhile
//
// and a movie owns the screen, so `currentscene()` cannot turn, so that view
// never comes round. The room stopped answering with the sirens playing over it
// — measured from the reporter's own standpoint, Scene3/View22, and from
// Scene2/View14. Scene1 escaped because its `gotowin` is already on the window.
//
// `fireDueLoops` has always held firing on `scriptBusy` and kept counting down
// while it waits, so nothing is slowed by this — the scheduler simply was not
// being told that a click was in flight.
test("a click holds the engine: no loop dispatches over an open movie", async () => {
  for (const [scene, view] of [["scene3", "view22"], ["scene2", "view14"]]) {
    const { session, viewer } = await newHost();
    let clock = 0;
    const tick = async (n: number): Promise<void> => {
      for (let i = 0; i < n; i++) { viewer()?.tick((clock += 50)); await drain(); }
    };
    session.modalMovies = true; // the browser's semantics: playmovie blocks
    await session.openSetFile("bedsit1.set", scene, view);
    await drain();
    await tick(20);
    const v = viewer()!;
    const spot = v.scene.views[v.viewIdx].objects[0];
    void v.click(
      Math.floor((spot.startRegionX + spot.endRegionX) / 2),
      Math.floor((spot.startRegionY + spot.endRegionY) / 2),
    ).catch(() => {});
    await tick(8);
    const onMovie = !!viewer()?.moviePlaying;
    const held = session.scriptBusy;

    // arm the raid the way the score does, and let the SCHEDULER decide
    session.interp.globals.set("bombpoints", -20000);
    (session.interp.builtins.get("makeloop") as unknown as (
      i: unknown, a: (string | number)[],
    ) => void)(session.interp, ["scene", scene, "bomb", 5]);
    await tick(60);

    // bomb() is what starts the sirens; if it ran, it ran over the movie
    const raidRanOverMovie = String(session.currentThemeName) === "bedsit1.trk";
    const stillHere = session.currentSetName === "bedsit1" &&
      viewer()?.scene.sceneName.toLowerCase() === scene;
    check(
      `${scene}/${view}: the air raid waits for the movie the player is watching`,
      onMovie && held && !raidRanOverMovie && stillHere,
      `onMovie=${onMovie} scriptBusy=${held} theme=${session.currentThemeName} ` +
        `at=${session.currentSetName}/${viewer()?.scene.sceneName}`,
    );
  }
});

// --- 84. the air raid reaches the window from every standpoint ---------------
// BEDSIT1's air raid walks you to the window and turns you to face it, from
// wherever you were standing. Two things it relies on were wrong (#40).
//
// It WAITS for a turn and it does not wait for a road (container 0005, Scene2):
//
//     while currentview () != "view17"
//         currentscene ("left")
//         while currentview () = "moving"   <- a turn is waited out
//             forceupdate ()
//         endwhile
//     endwhile
//     for count = 1 to 10
//         forceupdate ()
//     endfor
//     currentscene ("strait")
//     for count = 1 to 10                   <- a road gets ten passes, no wait
//         forceupdate ()
//     endfor
//     currentscene ("right")
//     ...
//     bombit ()
//
// 1. `walk()` and `turn()` open with `if (this.busy) return`, which is right for
//    a player leaning on a key and wrong for a script: a script is not repeating
//    itself, so the turn that arrived while the road still ran was DROPPED and
//    you watched the bombing from the bed or the chair.
// 2. Ten passes for a 7-frame road (Road4, Scene2->Scene1) or a 6-frame one
//    (Road43, Scene3->Scene1) is the script author naming the original's rate:
//    one frame per pass. At FRAME_MS a road spends 2n+1 passes on n frames, so
//    Scene2's road wanted 15 of its 10 and the deferred turn still came in after
//    `bombit` had played bedex.mov.
//
// Scene1's views by facing are View32=0 View38=42 View34=82 View36=112
// View31=180 View37=222 View33=262 View35=292; the roads land you on View36 from
// Scene2 and View37 from Scene3, and one step RIGHT and one step LEFT of those
// is View31 — the window.
for (const [scene, view] of [["scene1", "view37"], ["scene2", "view14"], ["scene3", "view22"]]) {
  test(`the air raid turns you to the window, from ${scene}`, async () => {
    const { session, viewer } = await newHost();
    let clock = 0;
    await session.openSetFile("bedsit1.set", scene, view);
    await drain();
    for (let i = 0; i < 20; i++) { viewer()?.tick((clock += 50)); await drain(); }

    let reached = "";
    const os = session.sendEvent.bind(session);
    (session as unknown as { sendEvent: unknown }).sendEvent = (
      c: string, t: string, h: string, a: unknown[], e?: unknown,
    ) => {
      if (h === "advanceday") {
        const v = viewer()!;
        reached = reached || `${v.scene.sceneName}/${v.scene.views[v.viewIdx].viewName}`;
        return Promise.resolve(0);
      }
      return (os as (...x: unknown[]) => Promise<unknown>)(c, t, h, a, e);
    };
    session.interp.globals.set("bombpoints", -20000);
    (session.interp.builtins.get("makeloop") as unknown as (
      i: unknown, a: (string | number)[],
    ) => void)(session.interp, ["scene", scene, "gotowin", 10]);
    for (let i = 0; i < 1200 && !reached; i++) { viewer()?.tick((clock += 50)); await drain(); }
    check(
      "the air raid turns you to the window before it drops the bomb",
      reached === "Scene1/View31",
      `bombed while looking at ${reached || "(the raid never landed)"}`,
    );
  });
}

// --- 85. a nested gesture gives the camera back -----------------------------
// Gestures nest, and the pair that arms the camera for one did not account for
// it. `press()` arms the viewer's nav hooks, runs the click, and disarms in a
// `finally` — by writing no-ops, not by putting back what it found.
//
// A modal movie is dismissed by a click, and that click is a gesture of its own
// (press -> clickDispatch -> movies.click) running while the script that OPENED
// the movie is still suspended inside `spotmovie`. So the inner press disarmed
// the outer press's hooks and the outer script came back to a dead camera.
//
// SCOT3's rope close-up is the one that shows it (#47). It turns you to Hacker
// before he speaks:
//
//     spotmovie ("scotrope.mov")
//     if mission = 3 & propowner ("rubiclue") = "frank" & hackphase = 0 & ...
//         sendtoactor ("hack", setupactor ("scot3"))
//         while currentview () != "view22"
//             if currentview () != "moving"
//                 currentscene ("right")
//             endif
//             forceupdate ()
//         endwhile
//         ...
//         sendtoactor ("hack", mousedown (0))
//
// Dismiss the close-up and view22 never came round: 3000 service steps, 3022
// turns asked for and not one attempted, the player still facing the rope with
// the room no longer answering. With the hooks restored the turn lands on the
// 12th ask and hack1.pup opens.
//
// The scheduler's own withNavDriversArmed has always been a save/restore pair.
// This is that rule at the other entry point.
test("a click inside a click gives the camera back to the script that owns it", async () => {
  const { session, viewer } = await newHost();
  session.modalMovies = true; // the browser's semantics: playmovie blocks
  let clock = 0;
  const tick = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) { viewer()?.tick((clock += 50)); await drain(); }
  };
  session.interp.globals.set("mission", 3);
  session.interp.globals.set("hackphase", 0);
  session.interp.globals.set("tour", 0);
  await session.openSetFile("scot3.set", "scene13", "view25");
  await drain();
  await tick(20);
  // Willie's first clue in hand — the guard the close-up's mousedown reads
  await (session.interp.builtins.get("propowner") as unknown as (
    i: unknown, a: string[],
  ) => Promise<unknown>)(session.interp, ["rubiclue", "frank"]);

  const v = viewer()!;
  const rope = v.scene.views[v.viewIdx].objects[0];
  void v.click(
    Math.floor((rope.startRegionX + rope.endRegionX) / 2),
    Math.floor((rope.startRegionY + rope.endRegionY) / 2),
  ).catch(() => {});

  // let the close-up come up, then dismiss it the way the player does: a real
  // click on its exit region, which is a whole second gesture.
  for (let i = 0; i < 60 && !v.moviePlaying; i++) await tick(1);
  const cameUp = v.moviePlaying;
  void v.press(457, 341).catch(() => {});

  // the turn loop has 3000 service steps to reach the window on Hacker
  let turned = "";
  for (let i = 0; i < 3000 && !turned; i++) {
    await tick(1);
    const name = v.scene.views[v.viewIdx]?.viewName.toLowerCase();
    if (name === "view22") turned = name;
  }
  check(
    "dismissing the rope close-up leaves the script able to turn you to Hacker",
    cameUp && turned === "view22",
    `closeup=${cameUp} ended facing ${v.scene.views[v.viewIdx]?.viewName}`,
  );
});

// --- 86. a message is logged once ------------------------------------------
// `ctx.log` — what every builtin logs through — was
//
//     log: (l) => session.currentBinding?.onLog(l) ?? session.onLog(l)
//
// meaning to say "the open set's log, else the session's". `?.` guards the
// CALL, not its result: with a set open the binding logged the line, the call
// answered undefined because onLog is void, and `??` logged the same line again
// through the session. Every `message()` in the game arrived twice in the
// details pane (#49), while lines emitted straight through session.onLog
// (`stage loaded:`, `movie:`) came once — which is the pattern in the reports.
//
// The reason no test ever saw it is this suite's own sink: the harness passes
// `{ log: (l) => logs.push(l) }` and push answers the new LENGTH, which is not
// nullish, so `??` short-circuited and the second call never happened. The
// page's `log()` has a statement body and answers undefined, so a browser
// always doubled. Hence a VOID sink below, and a count of calls rather than of
// collected lines — a test written against the harness's sink passes either way.
test("a message() reaches the log once, with a set open", async () => {
  const { session } = await newHost();
  await session.openSetFile("bedsit1.set", "scene2", "view14");
  await drain();
  const binding = session.currentBinding!;
  const message = session.interp.builtins.get("message") as unknown as (
    i: unknown, a: string[],
  ) => Promise<void>;

  for (const [name, wired] of [["a set open", true], ["no set open", false]] as const) {
    let lines = 0;
    session.onLog = () => { lines++; }; // void, as the page's own sink is
    binding.onLog = () => { lines++; };
    session.currentBinding = wired ? binding : null;
    await message(session.interp, ["ACT -- a stage direction"]);
    check(`one message() is one line (${name})`, lines === 1, `logged ${lines} times`);
  }
  session.currentBinding = binding;
});

// --- 87. a note is not a subtitle ------------------------------------------
// TI.EXE consults a gate (0x440810) before it draws a spoken line's text
// (0x441ef0, from the speak path at 0x4406d4), and the port drew the text
// unconditionally. So the studio's own annotations were printed at the player:
// `*RUBY.MOV: They say he smuggles art.` (#48).
//
// The gate's four ways to print nothing, and the offsets are our own parser's:
//
//     0x440828  movzx di, byte ptr [esi+0x18]   text length 0        (pup +24)
//     0x440839  cmp byte ptr [esi+0x19], 0x2a   text[0] == '*'
//     0x44084c  ...                             ident "idle 1".."idle 4" (+280)
//     0x4408e9  cmp byte ptr [..+0x18], cl      all spaces (cl = 0x20)
//
// Asserted against the shipped puppets rather than against invented records,
// and in BOTH directions — a rule that hid everything would pass half of it.
test("a puppet line beginning with '*' is heard but not printed", async () => {
  const { session } = await newHost();
  const pup = readPupFile(session.files("penny1.pup")!, session.textEncoding());
  const line = (id: string): PupDialogue => pup.dialogue.get(id)!;

  // hidden: the studio note, with and without the colon the marker often lacks
  check("*SASHA.MOV: is a note", !subtitled(line("penny1.070")));
  check("*RUBY.MOV: is a note", !subtitled(line("penny1.079")));
  check("*PLANS.MOV without a colon is still a note", !subtitled(line("penny1.113")));
  // ...and an animation pose, whose text is an animator's label
  check("an idle pose is not a line", !subtitled(line("idle 1")));

  // shown: the lead-in that prompts Carlson to look, which the original subtitles
  check("penny1.078 is a line", subtitled(line("penny1.078")));

  // the whole corpus, both arms, so neither rule can quietly swallow the other
  let shown = 0;
  let hidden = 0;
  for (const [, d] of pup.dialogue) (subtitled(d) ? shown++ : hidden++);
  check("penny1.pup: 21 records are notes, the rest are lines",
    hidden === 21 && shown === pup.dialogue.size - 21, `shown=${shown} hidden=${hidden}`);

  // and it must reach the SCREEN, not just the predicate. puppetSpeak suspends
  // for the line's length, so start it and read the subtitle it has just set
  // rather than awaiting a sleep no tick in this test advances.
  await session.puppetCtrl.openPuppetFile("penny1.pup");
  const speak = async (id: string): Promise<string> => {
    void session.puppetCtrl.puppetSpeak(id).catch(() => {});
    await drain();
    const shown = session.puppet?.subtitle ?? "(no puppet)";
    session.puppet?.speakSkip?.();
    await drain();
    return shown;
  };
  const note = await speak("penny1.070");
  check("a note prints nothing", note === "", `subtitle=${JSON.stringify(note)}`);
  const said = await speak("penny1.078");
  check("a line still prints", said.startsWith("I don't have any information"),
    `subtitle=${JSON.stringify(said)}`);
});

// --- 88. the puppet knows its own name -------------------------------------
// `currentpuppet()` answered the FILE the conversation was loaded from. TI.EXE
// answers the puppet's own name: openpuppetfile copies container 0 +0x85E into a
// static buffer (0x43f103, `strcpy(0x489ffc, container0 + 0x85E)`) and
// currentpuppet hands that buffer back (0x43ffba).
//
// "purs1.pup" is a value no script can match, and one script matches on it.
// TAOOT's inven.shp chooses the wording for offering whatever you are holding:
//
//     switch currentpuppet ()
//     case "purs1"
//         puppetbevel ("I would like to check something in...", 55555)
//     ...
//     endswitch
//     puppetbevel ("Would you like something...?", 55555)
//
// so the Purser — who takes items INTO the safe rather than being given them —
// asked whether you would like something, off the generic arm (#53).
//
// 269 of the 316 puppets in the tree are called "untitled" and the four that are
// not are exactly the four this switch names: PURS1, TRASK1, TRASK2, ZEIT1.
test("currentpuppet answers the puppet's name, so the Purser offers his own wording", async () => {
  const { session } = await newHost();
  const current = (): string =>
    String((session.interp.builtins.get("currentpuppet") as unknown as () => unknown)());

  check("no conversation reads none", current() === "none", current());

  // the four the corpus names, and one of the many it does not
  for (const [file, want] of [
    ["purs1.pup", "purs1"], ["trask1.pup", "trask1"],
    ["zeit1.pup", "zeit1"], ["penny1.pup", "untitled"],
  ] as const) {
    await session.puppetCtrl.openPuppetFile(file);
    check(`${file} is "${want}"`, current() === want, `got "${current()}"`);
  }

  // ...and the wording itself, off inven.shp's own switch. handflag=1 is the
  // "nothing in hand yet" arm, which is where the Purser's line lives.
  await session.openSetFile("gstair3.set");
  await session.puppetCtrl.openPuppetFile("purs1.pup");
  session.interp.globals.set("handflag", 1);
  session.interp.globals.set("handitem", "");
  await session.sendEvent("sendtoshop", "inven.shp", "addhandbevel", [], "test");
  const captions = (session.puppet?.bevels ?? []).map((b) => b.text);
  check(
    "the Purser is asked to check something in, not offered something",
    captions.some((c) => /check something in/i.test(c)) &&
      !captions.some((c) => /Would you like something/i.test(c)),
    `bevels=${JSON.stringify(captions)}`,
  );
});

// --- 89. a settled view is drawn sharp -------------------------------------
// Every scene ships each standpoint TWICE: `motionInfo` is 1 (low-res) all
// through the right-turn ring and 2 (hi-res) all through the left-turn one,
// paired by `framePairID`. Measured over gamefiles/en, all 546 scenes of all 78
// sets are shaped that way and all 3048 standpoints have a twin. The low-res
// frames are half-resolution art doubled into the 512x264 buffer — 100.0% of
// their 2x2 pixel blocks are flat, against 16.0% for a hi-res twin.
//
// We drew the low-res one for every settled view in the game, because the
// settled frame came from the right-turn ring (#68).
//
// The asymmetry the original has, and this reproduces, follows from the rings: a
// RIGHT turn ends on its ring's low-res standpoint and then sharpens as the view
// settles, a LEFT turn ends on the hi-res frame and lands sharp already. A WALK
// is a third case: every road register in gamefiles/en (all 722) ends on an
// in-motion frame, so a walk has no landing standpoint of its own and arrives
// sharp.
//
// `session.pictureMode` is #75: the original's three-way split, and the three
// ways of making every direction agree — always sharp, always soft-then-sharp,
// always soft (the port's own pre-#68 picture, kept for players the quality
// change makes motion-sick).
test("a settled view is drawn from the hi-res standpoint", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("bedsit1.set", "scene2", "view14");
  const v = viewer()!;
  let clock = 0;
  const hash = (f: { pixels: Uint8Array; width: number; height: number } | null): string => {
    if (!f) return "none";
    let h = 0x811c9dc5;
    const n = f.width * f.height;
    for (let i = 0; i < n; i++) h = Math.imul(h ^ f.pixels[i], 0x01000193) >>> 0;
    return h.toString(16);
  };
  /**
   * Turn, and answer the last TWO frames the animation drew plus the settled
   * frame. `prev` is where the soft landing beat shows up: the sharp frame is the
   * animation's own last frame, so the soft one is the frame before it.
   */
  const turnAndWatch = (dir: number): { prev: string; landed: string; settled: string } => {
    v.turn(dir);
    let prev = "none";
    let landed = "none";
    for (let i = 0; i < 500 && v.busy; i++) {
      const f = v.tick((clock += 100));
      if (f && hash(f) !== landed) {
        prev = landed;
        landed = hash(f);
      }
    }
    return { prev, landed, settled: hash(v.tick((clock += 100))) };
  };

  /** the two versions of the CURRENT standpoint, decoded straight from the set */
  const standpoint = (): { lo: string; hi: string } => {
    const lo = v.scene.turns[RIGHTTURNS].frames.find(
      (f) => f.viewID === v.viewIdx && f.motionInfo > 0,
    )!;
    const hi = v.scene.turns[LEFTTURNS].frames.find(
      (f) => f.motionInfo === 2 && f.framePairID === lo.framePairID,
    )!;
    const one = (loc: number): string => {
      const fb = new FrameBuffer();
      const d = decodeFrame(v.set.file.containers[loc].data, fb);
      let h = 0x811c9dc5;
      for (let i = 0; i < d.width * d.height; i++) h = Math.imul(h ^ fb.pixels[i], 0x01000193) >>> 0;
      return h.toString(16);
    };
    return { lo: one(lo.frameContainerLoc), hi: one(hi.frameContainerLoc) };
  };

  const right = turnAndWatch(RIGHTTURNS);
  const rightPt = standpoint();
  check(
    "a right turn ends up on the hi-res standpoint",
    right.landed === rightPt.hi && right.settled === rightPt.hi,
    `landed ${right.landed}, settled ${right.settled}, wanted ${rightPt.hi}`,
  );
  check(
    "...one beat after the low-res one, which is what the original shows",
    right.prev === rightPt.lo,
    `the frame before the landing was ${right.prev}, wanted the low-res ${rightPt.lo}`,
  );

  const left = turnAndWatch(LEFTTURNS);
  const leftPt = standpoint();
  check(
    "a left turn lands on the hi-res frame directly, with no soft beat",
    left.landed === leftPt.hi && left.settled === leftPt.hi && left.prev !== leftPt.lo,
    `landed ${left.landed}, settled ${left.settled}, prev ${left.prev}, wanted ${leftPt.hi}`,
  );

  // #75: the other three settings, each asked of BOTH turns — the whole point of
  // them is that the direction stops mattering. `beat` is whether the low-res
  // frame gets its one interval on screen before the landing.
  const beat: Record<string, boolean> = { sharp: false, transition: true, soft: false };
  for (const mode of ["sharp", "transition", "soft"] as const) {
    session.pictureMode = mode;
    for (const dir of [RIGHTTURNS, LEFTTURNS]) {
      const way = dir === RIGHTTURNS ? "right" : "left";
      const got = turnAndWatch(dir);
      const pt = standpoint();
      const want = mode === "soft" ? pt.lo : pt.hi;
      check(
        `${mode}: a ${way} turn settles on the ${mode === "soft" ? "low" : "hi"}-res standpoint`,
        got.landed === want && got.settled === want,
        `landed ${got.landed}, settled ${got.settled}, wanted ${want}`,
      );
      check(
        `${mode}: ...${beat[mode] ? "one beat after the low-res one" : "and never shows the low-res one"}`,
        (got.prev === pt.lo) === beat[mode],
        `the frame before the landing was ${got.prev}, the low-res one is ${pt.lo}`,
      );
    }
  }
  session.pictureMode = "original";
});

// --- 89b. and a walk lands the way the setting says too (#75) ---------------
// A road is the third landing, and the odd one out: its register ends on an
// in-motion frame rather than on a standpoint, so the original arrives sharp
// with no soft moment at all — there is no soft frame in the animation to see.
// "always transition" is therefore the only setting that has to ADD one, which
// it does by ending the walk on the standpoint being walked to.
test("a walk lands the way the picture setting says", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("bedsit1.set");
  const v = viewer()!;
  let clock = 0;
  const hash = (f: { pixels: Uint8Array; width: number; height: number } | null): string => {
    if (!f) return "none";
    let h = 0x811c9dc5;
    const n = f.width * f.height;
    for (let i = 0; i < n; i++) h = Math.imul(h ^ f.pixels[i], 0x01000193) >>> 0;
    return h.toString(16);
  };
  /** the two versions of the CURRENT standpoint, hashed from the ring images */
  const standpoint = (): { lo: string; hi: string } => {
    const lo = v.scene.turns[RIGHTTURNS].frames.find(
      (f) => f.viewID === v.viewIdx && f.motionInfo > 0,
    )!;
    const hi = v.scene.turns[LEFTTURNS].frames.find(
      (f) => f.motionInfo === 2 && f.framePairID === lo.framePairID,
    )!;
    const one = (loc: number): string => {
      const fb = new FrameBuffer();
      const d = decodeFrame(v.set.file.containers[loc].data, fb);
      let h = 0x811c9dc5;
      for (let i = 0; i < d.width * d.height; i++) h = Math.imul(h ^ fb.pixels[i], 0x01000193) >>> 0;
      return h.toString(16);
    };
    return { lo: one(lo.frameContainerLoc), hi: one(hi.frameContainerLoc) };
  };
  /** walk, and answer the last two frames drawn plus the settled one */
  const walkAndWatch = async (): Promise<{ prev: string; landed: string; settled: string }> => {
    v.walk();
    let prev = "none";
    let landed = "none";
    for (let i = 0; i < 500 && (v.busy || session.scriptBusy); i++) {
      const f = v.tick((clock += 100));
      if (f && hash(f) !== landed) {
        prev = landed;
        landed = hash(f);
      }
      await drain();
    }
    return { prev, landed, settled: hash(v.tick((clock += 100))) };
  };
  // stand somewhere a road leaves from — a turn is enough in bedsit1
  for (let i = 0; i < 8 && !v.availableRoads().length; i++) {
    v.turn(RIGHTTURNS);
    await runAnimations(v);
  }
  check("bedsit1 has a road to walk", v.availableRoads().length > 0, "no road from here");

  const start = { scene: v.scene.sceneName, view: v.scene.views[v.viewIdx].viewName };
  const back = async (): Promise<void> => {
    v.jumpTo(start.scene, start.view);
    await runAnimations(v);
  };

  for (const [mode, wantBeat] of [
    ["original", false],
    ["sharp", false],
    ["transition", true],
    ["soft", false],
  ] as const) {
    await back();
    session.pictureMode = mode;
    const got = await walkAndWatch();
    const pt = standpoint();
    const want = mode === "soft" ? pt.lo : pt.hi;
    check(
      `${mode}: a walk settles on the ${mode === "soft" ? "low" : "hi"}-res standpoint`,
      got.settled === want,
      `settled ${got.settled}, wanted ${want}`,
    );
    check(
      `${mode}: ...${wantBeat ? "one beat after the low-res one" : "and never shows the low-res one on the way"}`,
      (got.prev === pt.lo) === wantBeat,
      `the frame before the landing was ${got.prev}, the low-res one is ${pt.lo}`,
    );
  }
  session.pictureMode = "original";
});

// --- 90. the air raid gets its loop back from the traffic --------------------
// Two scene loops sharing one (kind, name) key, and only one of them can be in
// the table. BEDSIT1's air raid arms the turn-to-the-window on the scene you are
// standing in:
//
//     mousedown: bombpoints > 10 -> makeloop ("scene", "scene1", "bomb", random (100))
//     bomb:      stoploop ("scene", "all"); makeloop (..., "gotoship", 320)
//     gotoship:  bombmebaby = true; sendtoscene (currentscene (), openscene ())
//     openscene: makeloop ("scene", currentscene (), "gotowin", 10)
//
// and Scene3 — alone of the three — already runs a loop on that key: `sfx`, the
// city traffic, re-arming itself every 2 passes at the top of its own handler.
//
// `fireNow` used to splice the whole due batch out of the table before running
// any of it, so on the pass where both came due `sfx` re-armed AFTER `gotowin`
// was armed and replaced it (makeloop clears the (kind, name) match first). The
// sirens then played over a room that never turned, which is the softlock (#74,
// and the half of #33 that #45 did not reach). TI.EXE clears one slot and runs
// that handler to completion before looking at the next (0x442ae0), so a slot a
// previous handler has replaced is simply not serviced.
//
// Driven the way a player gets there — the hotspot's own mousedown is what scores
// the 11th point and arms the raid, so the click and the raid cannot be separated.
test("the air raid still fires where the traffic loop shares its key", async () => {
  for (const [scene, view] of [["scene3", "view22"], ["scene3", "view23"], ["scene2", "view14"]]) {
    const { session, viewer } = await newHost();
    let clock = 0;
    await session.openSetFile("bedsit1.set", scene, view);
    await drain();
    const v = (): SetViewer => viewer()!;
    const tick = (): void => { viewer()?.tick((clock += 50)); };
    for (let i = 0; i < 40; i++) { tick(); await drain(); }

    let reached = "";
    const sent = session.sendEvent.bind(session);
    (session as unknown as { sendEvent: unknown }).sendEvent = (
      c: string, t: string, h: string, a: unknown[], e?: unknown,
    ) => {
      if (h === "advanceday") {
        reached = `${v().scene.sceneName}/${v().scene.views[v().viewIdx].viewName}`;
        return Promise.resolve(0);
      }
      return (sent as (...x: unknown[]) => Promise<unknown>)(c, t, h, a, e);
    };

    // one point short, so the click below is the one that arms the raid
    session.interp.globals.set("bombpoints", 10);
    const spot = (v().scene.views[v().viewIdx].objects ?? [])[0];
    check(`${scene}/${view} has a hotspot to click`, !!spot, "no objects on this view");
    if (!spot) continue;
    void session.track(
      v().press(
        Math.floor((spot.startRegionX + spot.endRegionX) / 2),
        Math.floor((spot.startRegionY + spot.endRegionY) / 2),
      ),
      "raid-probe-click",
    );
    for (let i = 0; i < 60; i++) { tick(); await drain(); }
    // close the close-up the way ESC does — the public key path, since it is an
    // interactive movie and sits there waiting to be clicked through otherwise
    for (let r = 0; r < 25 && v().busy; r++) {
      void v().keyDown(".", true);
      for (let i = 0; i < 20; i++) { tick(); await drain(); }
    }
    check(
      `${scene}/${view}: the click armed the raid`,
      session.interp.globals.get("bombpoints") === -20000,
      `bombpoints=${String(session.interp.globals.get("bombpoints"))}`,
    );

    for (let i = 0; i < 2000 && !reached; i++) { tick(); await drain(); }
    check(
      `the raid from ${scene}/${view} reaches the window and drops the bomb`,
      reached === "Scene1/View31",
      reached ? `bombed at ${reached}` : "the raid never landed (softlock)",
    );
  }
}, 120_000);

// --- 91. a jump puts the door away, like a turn does -------------------------
// One prop named "door" serves every doorway in the game (house.shp container
// 0660): `setupprop(where)` shows it in that doorway's state at a fixed screen
// position, `initprop()` closes and hides it. The ONLY thing in the corpus that
// closes it is boot's closescene, which every standpoint change owes:
//
//     code closescene ()
//         propview ("navarrow", "red")
//         if propvisible ("door")
//             sendtoprop ("door", initprop ())
//         endif
//
// A turn ran it and a scripted JUMP did not, and GSTAIR3 leaves the purser's
// office by jumping — with the door you opened to get in still open:
//
//     code dopurser ()
//         ... the office ...
//         currentscene ("scene14")
//         currentview ("view37")
//
// so an open door hung in mid-air down the corridor (#71). The jump stays inside
// Scene14, so it is the view changing that owes the event.
test("a scripted jump closes the door a turn would have closed", async () => {
  const { session, viewer } = await newHost();
  let clock = 0;
  await session.openSetFile("gstair3.set", "scene14", "view36");
  await drain();
  const v = (): SetViewer => viewer()!;
  const tick = (): void => { viewer()?.tick((clock += 50)); };
  for (let i = 0; i < 60; i++) { tick(); await drain(); }
  session.interp.globals.set("savedeck", "c");

  // View36's one hotspot is the purser's office door: its mousedown runs
  // sendtoprop("door", setupprop("gs3-purs"))
  const spot = (v().scene.views[v().viewIdx].objects ?? [])[0];
  check("View36 has the office door hotspot", spot?.identifier === "door", `got ${spot?.identifier}`);
  await session.track(
    v().press(
      Math.floor((spot.startRegionX + spot.endRegionX) / 2),
      Math.floor((spot.startRegionY + spot.endRegionY) / 2),
    ),
    "door-click",
  );
  for (let i = 0; i < 60; i++) { tick(); await drain(); }
  const opened = session.propRuntime.get("door");
  check(
    "clicking it opens the door",
    opened?.visible === true && opened?.stateName === "gs3-purs",
    `visible=${opened?.visible} state=${opened?.stateName}`,
  );

  // leave the way dopurser does — currentscene/currentview, not a turn
  const prev = v().armNavHooks();
  session.onSceneJump("scene14");
  session.onViewJump("view37");
  v().disarmNavHooks(prev);
  for (let i = 0; i < 120; i++) { tick(); await drain(); }

  check(
    "the jump landed at View37",
    v().scene.views[v().viewIdx].viewName === "View37",
    `at ${v().scene.sceneName}/${v().scene.views[v().viewIdx].viewName}`,
  );
  check(
    "and the door is not still hanging there",
    session.propRuntime.get("door")?.visible === false,
    `door visible=${session.propRuntime.get("door")?.visible}`,
  );
}, 60_000);

// --- 91b. the smokestack maze's crates block the road they are drawn on ------
// The same family as the test above — an openscene that a view change owes — and
// the other end of the chain. SMSTACK2's openscene is on the SET MAIN, and all it
// does is remember whether the road ahead is walled up:
//
//     code openscene ()
//         blocked = pathblocked (currentscene (), currentview ())
//
//     code keydown (arg)
//         if blocked & arg = "uparrow"
//             exitcode
//
// `viewChanged` ran only the SCENE script, so on a turn the set main never spoke
// and `blocked` kept the answer for whichever view you entered the scene at.
// Measured at maze 1 / level 3 (`blocks` = "2,6,"): turning around scene64 gave
// blocked=1 at view82 (right), view79 (no case at all) and view81 (section 3, not
// in the list) — so entering a section facing a crate made all of it impassable,
// and entering it facing a clear road made every crate in it walkable. The second
// is what #88 reported: "I walked through crates which should not be possible".
test("the maze's crates block the road they are drawn on, whichever way you came in", async () => {
  const { host, session } = await newHost();
  const g = session.interp.globals;
  let clock = 0;
  g.set("tour", 0); g.set("mission", 3);
  // Set BEFORE the set opens: openset calls setupblocks(), so a maze arriving
  // later is too late. Maze 1 / level 3 walls up sections 2 and 6.
  g.set("mazenumber", 1); g.set("stacklevel", 3);
  await host.loadServerSet("smstack2.set");
  const v = host.viewer!;
  const settle = async (n = 50): Promise<void> => {
    for (let i = 0; i < n; i++) { v.tick((clock += 50)); await drain(); }
  };
  await settle();
  check("the maze walls up the sections it was asked to", g.get("blocks") === "2,6,", `blocks=${JSON.stringify(g.get("blocks"))}`);

  // The crates themselves: smstack.shp ships block1 and block2 only, and its
  // openshop clones six more with propinstance(); the set then puts each blocked
  // one on the star named "<set>.<section>".
  const crate = (n: number) => session.propRuntime.get(`block${n}`);
  const shown = [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => crate(n)?.visible);
  check("a crate stands in each walled-up section, and nowhere else", JSON.stringify(shown) === "[2,6]",
    `visible=${JSON.stringify(shown)}`);
  check("…on the set's own star for that section",
    crate(2)?.starName === "2.2" && crate(6)?.starName === "2.6" && !!crate(6)?.worldSpace,
    `block2=${crate(2)?.starName} block6=${crate(6)?.starName} world=${crate(6)?.worldSpace}`);

  const where = () => `${session.currentSceneName()}/${session.currentViewName()}`.toLowerCase();
  const blocked = () => (Number(g.get("blocked")) ? 1 : 0);
  // pathblocked()'s own table for this set, section by section
  check("the set opens facing the crate in section 2", where() === "scene37/view47" && blocked() === 1,
    `${where()} blocked=${blocked()}`);

  // A TURN: view50 has no case in pathblocked at all, so nothing is blocked there
  await session.track(v.keyDown("leftarrow"));
  await settle();
  check("turning away from it clears the flag", where() === "scene37/view50" && blocked() === 0,
    `${where()} blocked=${blocked()}`);

  // and view48 is section 1, which this maze leaves open
  await session.track(v.keyDown("leftarrow"));
  await settle();
  check("and an open road reads as open", where() === "scene37/view48" && blocked() === 0,
    `${where()} blocked=${blocked()}`);

  // so it can be walked, and the section beyond it reads for ITSELF
  await session.track(v.keyDown("uparrow"));
  await settle(80);
  check("walking the open road arrives in the next section", where() === "scene63/view76",
    `arrived at ${where()}`);
  check("…which answers for its own view", blocked() === 0, `${where()} blocked=${blocked()}`);

  // then turn back to a crate and confirm the road is shut
  for (let i = 0; i < 6 && where() !== "scene37/view47"; i++) {
    await session.track(v.keyDown(i < 2 ? "leftarrow" : "uparrow"));
    await settle(80);
  }
  check("back at the crate", where() === "scene37/view47" && blocked() === 1, `${where()} blocked=${blocked()}`);
  const before = where();
  await session.track(v.keyDown("uparrow"));
  await settle(80);
  check("and the crate cannot be walked through", where() === before, `walked to ${where()}`);
}, 120_000);

// --- 91c. jumpTo positions; only the SCRIPT's jump fires the event -----------
// The distinction this suite depends on and had never stated. `jumpTo` is the
// harness's way to stand somewhere — 21 checks in here use it — and it fires no
// scene lifecycle at all. The scripted pair currentscene()/currentview() goes
// through onSceneJump/onViewJump to teleport(), which does (#71).
//
// Getting those two confused while diagnosing #88 produced a bug report for a
// defect that did not exist (#96): the flag under test still held what the set's
// opening openScene had left, because a `jumpTo` had not recomputed it. The
// sentinel is what tells those apart — 999 is a value no script can produce, so
// surviving means "nothing ran" rather than "ran and answered 999".
test("a jumpTo fires no scene event; the script's own jump does", async () => {
  const { host, session } = await newHost();
  const g = session.interp.globals;
  let clock = 0;
  g.set("tour", 0); g.set("mission", 3);
  g.set("mazenumber", 1); g.set("stacklevel", 3); // walls up sections 2 and 6
  await host.loadServerSet("smstack2.set");
  const v = host.viewer!;
  const settle = async (n = 60): Promise<void> => {
    for (let i = 0; i < n; i++) { v.tick((clock += 50)); await drain(); }
  };
  await settle();
  const where = () => `${session.currentSceneName()}/${session.currentViewName()}`.toLowerCase();
  // the script's true()/false() are 1 and 0, so this flag is a number
  const flag = () => Number(g.get("blocked"));
  check("the set opened facing section 2, which is walled up", where() === "scene37/view47" && flag() === 1,
    `${where()} blocked=${JSON.stringify(g.get("blocked"))}`);

  // 1. the harness jump: it moves the camera and says nothing to the scripts
  g.set("blocked", 999);
  v.jumpTo("Scene64", "View81");
  await settle();
  check("jumpTo arrives", where() === "scene64/view81", `at ${where()}`);
  check("…and fires no openscene, so nothing recomputed the flag", flag() === 999,
    `blocked=${JSON.stringify(g.get("blocked"))} (999 means nothing ran)`);

  // 2. the script's jump: the same destination, and the event a standpoint change
  // owes. view81 is section 3, which this maze leaves open.
  g.set("blocked", 999);
  v.jumpTo("Scene37", "View47");
  await settle();
  const prev = v.armNavHooks();
  session.onSceneJump("scene64");
  session.onViewJump("view81");
  v.disarmNavHooks(prev);
  await settle(120);
  check("a scripted jump arrives at the same place", where() === "scene64/view81", `at ${where()}`);
  check(
    "…and openscene ran there, against the view it ARRIVED at",
    flag() === 0,
    `blocked=${JSON.stringify(g.get("blocked"))} — 999 is "never ran", 1 is "read the view it left"`,
  );
}, 120_000);

// --- 92. a prop animation gets to the end of itself -------------------------
// A prop animation is played by putting the prop in the moving state, spending a
// FIXED budget of service passes on it, and then forcing the resting state.
// BOIL.SHP's coal chute (`open` on its `boildoor`):
//
//     propview (me, "opening")
//     for count = 1 to 11
//         forceupdate ()
//     endfor
//     propview (me, "idleopen")
//
// `opening` holds 11 frames, so the budget is one frame per pass — censused over
// gamefiles/en, 21 of the 33 sites shaped like this budget exactly as many passes
// as the state has frames (or one fewer), and the rest an exact half or third,
// which is a state holding one animation per degree.
//
// We ticked props at the camera's FRAME_MS (90 ms) against a 50 ms pass, so the
// chute got 5 of its 11 frames before the script slammed it to `idleopen`: "move
// slowly, then at about 60% of the animation jumps to the end" (#15).
test("a prop animation reaches its last frames inside the script's budget", async () => {
  const { session, viewer } = await newHost();
  let clock = 0;
  await session.openSetFile("boil.set", "scene12", "view25");
  await drain();
  const v = (): SetViewer => viewer()!;
  const tick = (): void => { viewer()?.tick((clock += 50)); };
  for (let i = 0; i < 80; i++) { tick(); await drain(); }

  // the chute hotspot opens boil.stg, where the doors live as props
  const spot = (v().scene.views[v().viewIdx].objects ?? [])[0];
  await session.track(
    v().press(
      Math.floor((spot.startRegionX + spot.endRegionX) / 2),
      Math.floor((spot.startRegionY + spot.endRegionY) / 2),
    ),
    "chute-click",
  );
  for (let i = 0; i < 200; i++) { tick(); await drain(); }
  const door = session.propRuntime.get("boildoor");
  check(
    "the chute flat is up with the door closed",
    session.stageName === "boil.stg" && door?.stateName === "idleclosed",
    `stage=${session.stageName} door=${door?.stateName}`,
  );
  if (!door) return;

  // the door is a prop on the flat, not a region: click where it is drawn
  let at: { x: number; y: number } | null = null;
  for (let y = 0; y < 384 && !at; y += 2) {
    for (let x = 0; x < 512 && !at; x += 2) {
      if (session.propRuntime.propAt(x, y) === door) at = { x, y };
    }
  }
  check("the door is on screen to be clicked", !!at, "propAt never found it");
  if (!at) return;

  let deepest = -1;
  void session.track(v().press(at.x, at.y), "door-click");
  for (let i = 0; i < 250; i++) {
    if (String(door.stateName).toLowerCase() === "opening") {
      deepest = Math.max(deepest, door.frameIdx);
    }
    tick();
    await drain();
  }
  check(
    "the door opens all the way before the script forces it open",
    deepest >= 9,
    `the opening animation only reached frame ${deepest} of 11`,
  );
  check("...and ends up open", door.stateName === "idleopen", `state=${door.stateName}`);
}, 60_000);

// --- 93. a prop reports the state it is actually in -------------------------
// `PropInstance.state()` resolves a prop no script has touched to its FIRST state,
// and that is the one the engine draws. The `propview` GETTER answered "" instead,
// so scripts were told something the screen disagreed with.
//
// BOIL.STG's Ok region is where that shows. It tidies the boiler panel up on the
// way out of the flat:
//
//     if trackbut ("boilok", 256, 192)
//         if propview ("boilswitch") = "idledown" & propview ("boildoor") = "idleopen"
//             sendtoprop ("boilswitch", up ())
//             sendtoprop ("boilgate", up ())
//         endif
//         if propview ("boildoor") = "idleopen"
//             sendtoprop ("boildoor", close ())
//         endif
//         if propview ("boilgate") != "up"
//             sendtoprop ("boilgate", up ())
//         endif
//
// and `boilgate`'s first state IS "up" (BOIL.SHP: up 13 frames, down 13), so that
// last guard is there to do NOTHING when the big door is already up. Reading ""
// made it true every time, so leaving the panel played the big door's 13-frame
// raise for no reason (#79, the other half of what #15 reported).
test("a prop with no state set reports its first state, not nothing", async () => {
  const { session, viewer } = await newHost();
  let clock = 0;
  await session.openSetFile("boil.set", "scene12", "view25");
  await drain();
  const v = (): SetViewer => viewer()!;
  const tick = (): void => { viewer()?.tick((clock += 50)); };
  for (let i = 0; i < 80; i++) { tick(); await drain(); }

  const spot = (v().scene.views[v().viewIdx].objects ?? [])[0];
  await session.track(
    v().press(
      Math.floor((spot.startRegionX + spot.endRegionX) / 2),
      Math.floor((spot.startRegionY + spot.endRegionY) / 2),
    ),
    "chute-click",
  );
  for (let i = 0; i < 200; i++) { tick(); await drain(); }

  // what the SCRIPT sees for a prop nothing has set: the first state
  const propview = session.interp.builtins.get("propview") as unknown as (
    i: unknown, a: (string | number)[],
  ) => string;
  check(
    "propview answers the state the engine draws",
    String(propview(session.interp, ["boilgate"])).toLowerCase() === "up",
    `propview("boilgate") = "${String(propview(session.interp, ["boilgate"]))}"`,
  );

  // open the small control door, then leave with Ok: the big door must not move
  const door = session.propRuntime.get("boildoor")!;
  let at: { x: number; y: number } | null = null;
  for (let y = 0; y < 384 && !at; y += 2) {
    for (let x = 0; x < 512 && !at; x += 2) {
      if (session.propRuntime.propAt(x, y) === door) at = { x, y };
    }
  }
  if (!at) {
    check("the control door is on screen", false, "propAt never found it");
    return;
  }
  void session.track(v().press(at.x, at.y), "door-click");
  for (let i = 0; i < 250; i++) { tick(); await drain(); }

  const ok = session.stageCtrl.currentFlatRegions().find((r) => /^ok$/i.test(r.name))!;
  let gateMoved = false;
  void session.track(
    v().press(Math.floor((ok.left + ok.right) / 2), Math.floor((ok.top + ok.bottom) / 2)),
    "ok-click",
  );
  for (let i = 0; i < 300; i++) {
    const g = session.propRuntime.get("boilgate");
    if (g && g.frameIdx > 0) gateMoved = true;
    tick();
    await drain();
  }
  check("leaving the panel does not raise a door that is already up", !gateMoved, "boilgate animated");
}, 60_000);

// --- 94. a page turn is a wipe, not a cut ----------------------------------
// `visualeffect(effect, steps)` says how the NEXT screen arrives, and every effect
// but `plain` is a reveal. We drew them instantly, which is what left the ending
// scrapbook cutting between pages instead of turning them (#12):
//
//     gotoflat (findword (worldwar1 (), ",", count))
//     voicesound ("paper")
//     visualeffect (wipeleft, 30)
//     voicesound ("n." @ findword (worldwar1 (), ",", count))
//     voicewait ()
//
// The pages that CONTINUE one picture ("11b", "33b", "51b" …) ask for
// `visualeffect(plain, 0)` instead, so `plain` must stay the instant clear it
// already was — it is also what the scripts use to cancel a pending effect before
// a blacktoscreen, 184 of the corpus's 193 visualeffect calls.
//
// Stepped on the GAME clock, one step per engine pass, so a slow host takes the
// same 30 passes as a fast one.
test("visualeffect wipes over its step count, and plain does not", async () => {
  const { session } = await newHost();
  const effect = session.interp.builtins.get("visualeffect") as unknown as (
    i: unknown, a: (string | number)[],
  ) => void;
  // stand in for the host's composite: a wipe holds the screen it is leaving
  session.captureFrame = () => ({
    rgba: new Uint8ClampedArray(512 * 384 * 4),
    width: 512,
    height: 384,
  });

  void effect(session.interp, ["plain", 0]);
  check("plain starts no wipe", !session.wiping, `dir=${session.wipe.dir}`);

  void effect(session.interp, ["wipeleft", 30]);
  check("wipeleft starts one", session.wiping && session.wipe.dir === "left", `dir=${session.wipe.dir}`);
  check("...over the steps it was given", session.wipe.steps === 30, `steps=${session.wipe.steps}`);

  // One step per 60 Hz tick — TI.EXE's own wipe clock, not the 50 ms service
  // pass: 0x41de90 returns (ms * 3) / 50 and the pacer waits for tick i. So the
  // scrapbook's 30 steps take half a second.
  let clock = 0;
  for (let i = 0; i < 29; i++) session.tickWipe((clock += RAMP_STEP_MS));
  check(
    "29 ticks in, the reveal is not finished",
    session.wiping && session.wipe.step === 29,
    `step=${session.wipe.step} of ${session.wipe.steps}`,
  );
  session.tickWipe((clock += RAMP_STEP_MS));
  check("the 30th ends it", !session.wiping, `step=${session.wipe.step} dir=${session.wipe.dir}`);
  check(
    "...half a second after it started, as in the original",
    Math.round(30 * RAMP_STEP_MS) === 500,
    `30 steps = ${30 * RAMP_STEP_MS} ms`,
  );

  void effect(session.interp, ["wiperight", 20]);
  check("wiperight goes the other way", session.wipe.dir === "right", `dir=${session.wipe.dir}`);
  // steps are clamped 1..1000 the way TI.EXE clamps them
  session.endWipe();
  void effect(session.interp, ["wipeleft", 99999]);
  check("steps are capped at 1000", session.wipe.steps === 1000, `steps=${session.wipe.steps}`);
  // an effect the corpus never asks for keeps the old instant reveal
  session.endWipe();
  void effect(session.interp, ["venetian", 20]);
  check("an unused effect stays instant", !session.wiping, `dir=${session.wipe.dir}`);
});

// --- 95. a degree selector shows the frame its degree names ------------------
// A prop state is either an animation to play or a SELECTOR whose frames are
// alternatives indexed by degree — `PropState.animated` says which, and for a
// selector `frameIdx` means nothing at all (see isDegreeSelector).
//
// BOMB.STG opens the bomb panel with
//
//     propvisible ("solenoid", true)
//     propxy ("solenoid", 256, 192)
//
// and NO propdeg, because the default 0 is the safe, de-energised state: the arm
// is `propdeg ("solenoid", 1)` and `if propdeg ("solenoid") = 1` is what calls
// `boomer ()`. The solenoid's two frames carry degrees 1 and 0 IN THAT ORDER, so
// deg 0 is the second frame — and drawing frame 0 showed a closed solenoid on a
// bomb with no power to it (#11). switch3's degrees are 0,1,2 in order, which is
// why the switches looked right and only the solenoid did not.
test("a prop with no propdeg shows the frame degree 0 names", async () => {
  const { session } = await newHost();
  const shp = readShpFile(new Uint8Array(readFileSync(gamefiles(root).resolve("bomb.shp")!)));
  const sol = shp.groups.find((g) => g.name.toLowerCase() === "solenoid");
  const st = sol?.states[0];
  check("the solenoid is a two-frame selector", !!st && st.frames.length === 2, `${st?.frames.length} frames`);
  if (!st) return;
  check(
    "...whose degrees are stored 1 then 0",
    st.degrees?.join(",") === "1,0",
    `degrees=${st.degrees?.join(",")}`,
  );
  check("...and it is not an animation", !st.animated && isDegreeSelector(st), `animated=${st.animated}`);

  // degree 0 must name the SECOND frame, and that is what gets drawn
  check(
    "degree 0 selects the frame stored against it",
    frameIndexForDegree(st, 0) === 1 && frameIndexForDegree(st, 1) === 0,
    `deg0 -> ${frameIndexForDegree(st, 0)}, deg1 -> ${frameIndexForDegree(st, 1)}`,
  );

  // and through the runtime, with nothing but propvisible called on it
  await session.stageCtrl.openStageFile("bomb.stg");
  await drain();
  const p = session.propRuntime.get("solenoid");
  check("the bomb panel has a solenoid", !!p, "no solenoid prop");
  if (!p) return;
  const drawn = p.currentFrameIdx(p.state()!);
  check(
    "an untouched solenoid draws its safe frame, not frame 0",
    drawn === 1,
    `drawing frame index ${drawn}`,
  );
});

// --- 96. a character and an overlay's prop can share a name ------------------
// `sendtoactor` addresses the CAST, and it was reaching a prop of the same name:
// the resolution order (`propScripts` before `castScripts`) let whatever shop was
// open speak for a character.
//
// Two shops in the corpus collide, and both are a mini-game's opponent drawn as a
// screen-space prop over the room he is standing in: fight.shp's `vlad` and
// fence.shp's `willie`. Only the fistfight actually sends to the actor while its
// overlay is up, and both of its endings do —
//
//     actorowner ("vlad", "lostfight")                 ← a builtin: the actor
//     sendtoactor ("vlad", setupactor ("lostfight"))   ← went to the prop, silently
//
// so Vlad kept the pose he had before the fight and stayed on his feet after you
// beat him (#84), and after knocking you out the losing branch's `putdownactor()`
// was dropped the same way.
test("a sendtoactor reaches the character, not the overlay prop of that name", async () => {
  const { host, session } = await newHost();
  const g = session.interp.globals;
  let clock = 0;
  const settle = async (n = 20): Promise<void> => {
    for (let i = 0; i < n; i++) { host.viewer?.tick((clock += 50)); await drain(); }
  };
  g.set("tour", 0); g.set("mission", 3); g.set("phase", 1);
  await session.runGlobal("changeset", ["engine", "Scene108", "View112"]);
  await settle();
  const vlad = session.actorRuntime.get("vlad");
  check(
    "the catwalk's openscene stands Vlad up for the fight",
    !!vlad && vlad.visible && vlad.poseName === "stand" && vlad.starName === "vlad1",
    `${vlad?.visible} ${vlad?.poseName} ${vlad?.starName}`,
  );
  if (!vlad) return;

  // the fight overlay, opened the way the cast's own runfight() opens it
  await session.runGlobal("transtoflat", ["fight.stg"]);
  await settle();
  check(
    "the fight overlay brings a PROP called vlad, beside the cast member",
    session.propScripts.has("vlad") && session.castScripts.has("vlad"),
    `prop=${session.propScripts.has("vlad")} cast=${session.castScripts.has("vlad")}`,
  );

  // the prop side still works: the fight's own idle loop is dispatched to the
  // prop's script, which clears the three punch globals on an idle pass
  g.set("firstpunch", "held");
  await settle(40);
  check(
    "…and sendtoprop still reaches the prop (its idle clears the punch memo)",
    g.get("firstpunch") === "",
    `firstpunch=${JSON.stringify(g.get("firstpunch"))}`,
  );

  // the actor side is the fix: endfight's own line, with the overlay still open
  await session.sendEvent("sendtoactor", "vlad", "setupactor", ["lostfight"], "test");
  await settle(5);
  check(
    "sendtoactor puts the CHARACTER down on the catwalk",
    vlad.visible && vlad.poseName === "dead" && vlad.starName === "vlad2",
    `visible=${vlad.visible} pose=${vlad.poseName} star=${vlad.starName}`,
  );
}, 120_000);

// --- 98. dumpglobal destroys, and the turbine puzzle says so ----------------
// `dumpglobal x, y` reads like `global x, y` and does the opposite. Its 64 uses in
// the corpus are all in a teardown, and TURBINE.STG carries the pair in one file:
//
//     code closestage ()              code initvalue ()
//         …                               global coal, valve1, …
//         dumpturbineglobals ()           coal = 50 …
//
// Read as a declaration, the puzzle's 18 working variables stayed in the session
// for the rest of the game — which is what made a save report 37 globals it could
// not store (#85; `coal`, `valve1..3`, `pump1`, `pump2` have a record in NONE of
// the 109 shipped saves, because the original discards them the same way).
test("closing the turbine puzzle destroys the globals it was working in", async () => {
  const { session } = await newHost();
  const g = session.interp.globals;
  const PUZZLE = [
    "coal", "valve1", "valve2", "valve3", "pump1", "pump2",
    "boilpres", "valvpres", "seaspres", "condpres",
    "boiler", "turbine", "steamtank", "condensor",
    "condtemp", "boiltemp", "electricity", "electlag",
  ];
  await session.stageCtrl.openStageFile("turbine.stg");
  await session.sendEvent("sendtostage", "turbine.stg", "initvalue", [], "test");
  await drain();
  const seeded = PUZZLE.filter((n) => g.has(n));
  check(
    "opening it seeds the working set",
    g.get("coal") === 50 && g.get("boiler") === 100000 && seeded.length >= 10,
    `${seeded.length} of ${PUZZLE.length} present, coal=${g.get("coal")}`,
  );

  // the stage's own teardown — nothing hand-written about which names go
  await session.sendEvent("sendtostage", "turbine.stg", "dumpturbineglobals", [], "test");
  await drain();
  const left = PUZZLE.filter((n) => g.has(n));
  check("closing it destroys every one of them", left.length === 0, `still held: ${left.join(", ")}`);
  // ...and a read of a destroyed global is 0, exactly as one never assigned is
  check("a destroyed global reads as 0", session.interp.globals.get("coal") === undefined
    && Number(session.interp.globals.get("coal") ?? 0) === 0);
});

// --- 97. a fade runs on the ramp's clock, not the service pass ---------------
// The same measurement as the wipe above, one function over. `screentoblack`
// (0x43e550 -> 0x435b90) and `blacktoscreen` (0x43e5d0 -> 0x435be0) are one loop
// twice: draw the blend for step di, then spin on 0x41de90 — the (ms * 3) / 50
// tick counter — until it has advanced by one. One step, one 1/60 s tick.
//
// At the 50 ms service pass every fade in the game took three times as long as
// the original's. Reported from the one place a script asks for a long one (#87):
// losing the fistfight brings the engine room back over 240 steps.
test("a fade takes one script tick a step, not one service pass", async () => {
  const { session } = await newHost();
  const cmd = (name: string) =>
    session.interp.builtins.get(name) as unknown as (i: unknown, a: (string | number)[]) => void;
  session.captureFrame = () => ({
    rgba: new Uint8ClampedArray(512 * 384 * 4),
    width: 512,
    height: 384,
  });
  let clock = 0;
  const run = (steps: number): number => {
    session.fade.queue.length = 0;
    session.fade.lastTick = 0;
    session.fade.level = 1;
    void cmd("blacktoscreen")(session.interp, ["set", steps]);
    const started = clock;
    for (let i = 0; i < steps * 4 && session.fading; i++) session.tickFade((clock += RAMP_STEP_MS));
    return clock - started;
  };
  // the ordinary fade the whole game uses
  const ten = run(10);
  check(
    "a 10-step fade is 10 ticks, a sixth of a second",
    Math.round(ten) === Math.round(10 * RAMP_STEP_MS) && Math.round(ten) === 167,
    `${Math.round(ten)} ms (the service pass would be ${10 * 50} ms)`,
  );
  // and restorescreen's slow one, the reported case
  const long = run(240);
  check(
    "restorescreen's 240-step fade is four seconds, not twelve",
    Math.round(long / 100) === 40,
    `${(long / 1000).toFixed(2)} s`,
  );
  check("...and it finished", !session.fading && session.fade.level === 0, `level=${session.fade.level}`);
});

// --- 12d. the display gamma TI.EXE applies to every palette entry (#115).
// The port used to hand each channel's byte to the canvas verbatim, i.e. gamma 1.0,
// and was reported as "very dark in general". TI.EXE builds its hardware palette as
// `pow(c/255, gamma) * 255` per channel with the exponent defaulting to 0.65
// (0x419c9c, feeding AnimatePalette at 0x419da8), which BRIGHTENS — most of all in
// the dark half of the range, which is most of this game.
test("the display gamma matches TI.EXE's palette build", async () => {
  check("the default exponent is the one TI.EXE ships", DEFAULT_SCREEN_GAMMA === 0.65,
    `${DEFAULT_SCREEN_GAMMA}`);
  check("and it is what a fresh session renders with", screenGamma() === DEFAULT_SCREEN_GAMMA,
    `${screenGamma()}`);

  // the curve itself, against values worked out from the disassembled formula
  const want: [number, number][] = [
    [0, 0], [16, 42], [32, 66], [64, 104], [96, 135], [128, 163], [160, 188],
    [200, 218], [240, 245], [255, 255],
  ];
  const clut = new Uint8ClampedArray(256 * 4);
  for (const [c] of want) { clut[c * 4] = c; clut[c * 4 + 1] = c; clut[c * 4 + 2] = c; }
  const out = displayPalette(clut);
  for (const [c, expected] of want) {
    check(`gamma: ${c} -> ${expected}`, out[c * 4] === expected, `got ${out[c * 4]}`);
  }
  // 0 and 255 are fixed points, so paletteToRGBA's forced black and white survive
  check("black stays black and white stays white", out[0] === 0 && out[255 * 4] === 255,
    `${out[0]} / ${out[255 * 4]}`);
  // alpha is not a colour
  check("alpha is untouched", out[3] === clut[3], `${out[3]}`);

  // and a real room comes out brighter than its palette bytes, which is the report
  const { session, viewer } = await newSession();
  await session.openSetFile("c78.set");
  const v = viewer();
  const shown = (v as unknown as { palette: Uint8ClampedArray }).palette;
  const raw = paletteToRGBA(v.set.paletteRaw, v.set.colorCount);
  let lifted = 0;
  let dimmed = 0;
  for (let i = 0; i < 128 * 4; i += 4) {
    for (let k = 0; k < 3; k++) {
      if (shown[i + k] > raw[i + k]) lifted++;
      else if (shown[i + k] < raw[i + k]) dimmed++;
    }
  }
  check("every non-extreme entry of a real room is lifted, none pushed down",
    lifted > 300 && dimmed === 0, `lifted=${lifted} dimmed=${dimmed}`);
}
);

// --- 12e. the original's own gamma keys, and the caches that hold a palette (#115).
// TI.EXE's WM_KEYDOWN jump table (0x41b118) gives F1-F9 to 0x41b210: F1/F2 move all
// three exponents, F3-F8 one channel each, F9 resets. F1 BRIGHTENS — it divides the
// exponent by 1.05, and a smaller exponent lifts a colour.
test("F1-F9 move the display gamma the way TI.EXE moves it", () => {
  const start = screenGammas().slice() as [number, number, number];
  try {
    // F1/F2: all three together, and the pair is a round trip
    stepScreenGamma(false, ALL_CHANNELS);
    const brighter = screenGammas();
    check("F1 lowers all three exponents (a lower exponent is brighter)",
      brighter.every((g, i) => Math.abs(g - start[i] / SCREEN_GAMMA_STEP) < 1e-9),
      JSON.stringify(brighter));
    stepScreenGamma(true, ALL_CHANNELS);
    check("F2 puts them back", screenGammas().every((g, i) => Math.abs(g - start[i]) < 1e-9),
      JSON.stringify(screenGammas()));

    // F3/F4 etc: one channel only, the other two untouched
    for (const [label, ch] of [
      ["red", [true, false, false]], ["green", [false, true, false]], ["blue", [false, false, true]],
    ] as [string, GammaChannels][]) {
      const before = screenGammas().slice();
      stepScreenGamma(false, ch);
      const after = screenGammas();
      const moved = after.map((g, i) => g !== before[i]);
      check(`the ${label} pair moves ${label} alone`,
        moved.every((m, i) => m === ch[i]), `moved=${JSON.stringify(moved)}`);
    }

    // F9 puts everything back, whatever state the channels were left in
    resetScreenGamma();
    check("F9 resets all three to what the original ships with",
      screenGammas().every((g) => g === DEFAULT_SCREEN_GAMMA), JSON.stringify(screenGammas()));

    // and a change is observable to a cache holder, which is the only thing they watch
    const gen = screenGammaGeneration();
    stepScreenGamma(false, ALL_CHANNELS);
    check("a change bumps the generation", screenGammaGeneration() > gen,
      `${gen} -> ${screenGammaGeneration()}`);
    const same = screenGammaGeneration();
    setScreenGamma(screenGammas()[0]);
    check("and setting the value it already has does not", screenGammaGeneration() === same,
      `${same} -> ${screenGammaGeneration()}`);
  } finally {
    resetScreenGamma();
  }
});

// A live change has to reach the palettes a room is already drawing with, or the
// picture only changes at the next set. The viewer rebuilds them on the tick after
// the generation moves — and replacing the arrays is also what makes the frame
// cache (buildSignature refs both) repaint.
test("moving the gamma repaints the room the player is standing in", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("c78.set");
  const v = viewer();
  const peek = (): { palette: Uint8ClampedArray; propPalette: Uint8ClampedArray } =>
    v as unknown as { palette: Uint8ClampedArray; propPalette: Uint8ClampedArray };
  const sum = (p: Uint8ClampedArray): number => {
    let s = 0;
    for (let i = 0; i < 128 * 4; i++) s += p[i];
    return s;
  };
  let clock = 0;
  const lit = sum(peek().palette);
  const wasPalette = peek().palette;
  try {
    stepScreenGamma(false, ALL_CHANNELS); // F1: brighter
    check("nothing has moved until the next tick", peek().palette === wasPalette);
    v.tick((clock += 50));
    check("the tick after F1 rebuilt the set palette, brighter",
      sum(peek().palette) > lit, `${lit} -> ${sum(peek().palette)}`);
    check("and a NEW array, so the frame cache sees a repaint",
      peek().palette !== wasPalette);
    const brightened = sum(peek().palette);

    resetScreenGamma(); // F9
    v.tick((clock += 50));
    check("F9 puts the room back exactly where it was",
      sum(peek().palette) === lit, `${brightened} -> ${sum(peek().palette)} vs ${lit}`);

    // the prop palette is the other half of the same room and must move with it
    stepScreenGamma(false, ALL_CHANNELS);
    const props = sum(peek().propPalette);
    v.tick((clock += 50));
    check("the prop palette moves with it", sum(peek().propPalette) > props,
      `${props} -> ${sum(peek().propPalette)}`);
  } finally {
    resetScreenGamma();
    v.tick((clock += 50));
  }
}
);

// --- 12f. the movement keys the control panel binds (#14).
// CTL.STG offers three rebindable movement keys and BOOTFILE's boot() defaults them
// to W/A/D (`keynorth`/`keywest`/`keyeast`). Nothing in the 808-file corpus READS
// them except the boot's own keydown, which maps them to the arrows and re-routes
// with `sendtoscene(currentscene(), keydown(arg))` — so the mapped value only
// arrives if that re-route reaches the boot's OTHER keydown, the default that does
// `case "leftarrow": currentscene("left")`. Running the two boot containers side by
// side instead gave the default the raw key: the arrows worked and A/W/D did nothing.
//
// Turning is what this asserts, not walking: an arrow always changes the view, while
// "w" (walk) can legitimately do nothing where there is no road.
test("the bound movement keys turn the camera, like the arrows they map to", async () => {
  const { session, viewer } = await newSession();
  // boot() is what assigns the defaults — a session that skipped it has no bindings
  await session.runGlobal("boot");
  const v0 = viewer();
  for (let i = 0; i < 120; i++) v0.tick((clock += 50));
  check("boot() sets the default bindings",
    session.interp.globals.get("keynorth") === "w" &&
      session.interp.globals.get("keywest") === "a" &&
      session.interp.globals.get("keyeast") === "d",
    `north=${session.interp.globals.get("keynorth")} west=${session.interp.globals.get("keywest")} ` +
      `east=${session.interp.globals.get("keyeast")}`);

  await session.runGlobal("changeset", ["deckbd", "Scene33", "View99"]);
  const v = viewer();
  const settle = async (n = 60): Promise<void> => {
    for (let i = 0; i < n; i++) { v.tick((clock += 50)); await drain(); }
  };
  await settle(80);
  const view = (): string =>
    String(v.scene?.views[(v as unknown as { viewIdx: number }).viewIdx]?.viewName).toLowerCase();
  const press = async (k: string): Promise<string> => {
    void session.track(v.keyDown(k));
    await settle(60);
    return view();
  };

  const start = view();
  const viaLeft = await press("leftarrow");
  check("the left arrow turns", viaLeft !== start, `${start} -> ${viaLeft}`);
  await press("rightarrow"); // back
  check("and the right arrow brings it back", view() === start, `now ${view()}`);
  const viaA = await press("a");
  check('"a" turns the same way the left arrow does', viaA === viaLeft, `${start} -> ${viaA} vs ${viaLeft}`);
  await press("d");
  check('"d" brings it back, like the right arrow', view() === start, `now ${view()}`);

  // and a REBINDING — which is what the reporter tried second (J/I/L)
  session.interp.globals.set("keywest", "j");
  const viaJ = await press("j");
  check('a rebound "j" turns left', viaJ === viaLeft, `${start} -> ${viaJ} vs ${viaLeft}`);
  await press("d");
  const viaOldA = await press("a");
  check('and "a" does nothing once it is not bound', viaOldA === start, `${start} -> ${viaOldA}`);
}
);

// --- 99. a new game starts clean, because the BOOTFILE's reset loops run (#89)
// The bad ending is not a dead end: `playmore.mov` offers another game, and
// BOOTFILE `advanceday`'s failure arm walks the world back itself before dealing
// mission 1 —
//
//     size = countprops ()
//     for count = 1 to size
//         name = indextoprop (count)
//         propowner (name, "none")
//     endfor
//
// — the same pair of loops the `startdisk1` arm runs. Both were dead here, and
// only the prop half: `countprops` answered from the CALLING FRAME's shop, so
// inven.shp asking got its own 28 and the BOOTFILE asking got 0. Zero iterations,
// so every ownership from the finished game survived into the next one: the
// reporter arrived in C-73 carrying the trunk key, the fake necklace, a telegram,
// the painting and the notebook, with the map/bag/watch already dealt and an item
// parked over the HELP button, and mission 2 unfinishable because the painting was
// still Zeitel's and the car keys still in the void (#89).
//
// TI.EXE has ONE prop table and no notion of a calling shop: countprops is
// `mov ecx, [0x489f18]` (0x418660) and indextoprop bounds-checks against that same
// dword before walking the table at [0x489f14] in 158-byte records (0x418710) —
// which is `propRuntime.props`, the union of every open shop, in the order they
// opened. countactors/indextoactor are the byte-for-byte twins one table over
// ([0x489f08], 0x410610) and were already global here, which is why the ACTOR
// half of the same reset always worked.
test("a new game after a bad ending starts with nothing carried (#89)", async () => {
  const { session } = await newHost();
  const g = session.interp.globals;
  await session.openSetFile("c73.set"); // inven.shp + house.shp: 72 props
  await drain();

  // 1. the mechanism, from the frame that actually asks. The BOOTFILE is not a
  // shop and never can be, so a shop-scoped answer is 0 for every boot caller —
  // both reset loops, and the CTL console's allprops/countallprops/allactors.
  const call = (name: string, args: unknown[], me: string): unknown =>
    (session.interp.builtins.get(name) as unknown as (
      i: unknown, a: unknown[], c: unknown, f: unknown,
    ) => unknown)(session.interp, args, { me, target: "" }, { ctx: { me, target: "" } });
  const known = session.propRuntime.props.size;
  const fromBoot = Number(call("countprops", [], "bootfile"));
  check(
    "countprops() answers the whole table, whoever asks",
    fromBoot === known && known > 0,
    `${fromBoot} from the BOOTFILE vs ${known} props open ` +
      `(${[...session.propRuntime.shops.keys()].join(" + ")})`,
  );
  const walked = Array.from({ length: fromBoot }, (_, i) => String(call("indextoprop", [i + 1], "bootfile")));
  check(
    "and indextoprop walks it, naming each prop once",
    new Set(walked).size === known && !walked.includes(""),
    `${new Set(walked).size} distinct of ${known}; first=${walked[0]} last=${walked[walked.length - 1]}`,
  );

  // 2. the outcome — the failure arm end to end. Its movies are stubbed and only
  // its movies: leave.mov alone is 39 MB, and what they look like is the browser
  // gate's job (taoot/tests/browser/endgame.ts). Everything that RESETS runs for real.
  const played: string[] = [];
  session.onPlayMovie = (name) => {
    played.push(name);
  };
  // a finished game, dirty in every way the reporter's was
  const DIRT: [string, string][] = [
    ["painting", "zeit"], ["cufflink", "purs"], ["carkeys", "xxxfrank"],
    ["notebook", "frank"], ["fakeneck", "frank"], ["trunkkey", "frank"],
  ];
  for (const [prop, owner] of DIRT) {
    const p = session.propRuntime.get(prop);
    if (p) p.owner = owner;
  }
  const dirtied = DIRT.filter(([n]) => !!session.propRuntime.get(n));
  check("the finished game's ownerships are in place to be cleared",
    dirtied.length === DIRT.length, `missing: ${DIRT.filter(([n]) => !session.propRuntime.get(n)).map(([n]) => n)}`);
  // ...and the ACTOR half of the same reset, which failed for a different reason:
  // the loop DID run 25 times (countactors was always global here), but
  // `sendtoactor(name, resetactor())` resolved on the actor's own script, none of
  // the 25 has a `resetactor`, and nothing walked on to the boot library that
  // does. 25 no-ops, so who owned whom survived the ending too.
  const purs = session.actorRuntime.get("purs");
  const zeit = session.actorRuntime.get("zeit");
  if (purs) { purs.owner = "cufflink"; purs.value = 3; }
  if (zeit) { zeit.owner = "painting"; zeit.value = 1; }

  const STORY: [string, number][] = [
    ["neckphase", 3], ["letterphase", 2], ["zeitgossip", 1], ["metzeitel", 1],
    ["fencewins", 4], ["smethphase", 5], ["pennyphase", 6], ["zeitelphase", 2],
  ];
  for (const [name, v] of STORY) g.set(name, v);
  g.set("handitem", "realneck");
  g.set("mission", 4); // anything but "good" takes the play-again arm
  g.set("phase", 3);
  g.set("clock", "endgame");

  await session.runGlobal("advanceday");
  await session.settle();
  await drain();

  check("the arm ran its own way through (bktoship.mov, then the new day)",
    played.includes("bktoship.mov") && played.includes("datecab.mov"), played.join(" -> "));

  // Every INVENTORY prop back to "none" — except the two the new game is dealt
  // with, which inven.shp's own initprops() hands out at mission 1 (rubaiyat to
  // the coal chute, the real necklace to Vlad). Asserting around those rather than
  // excluding them: a reset that also wiped the fresh deal would be its own bug.
  //
  // inven.shp only. The other open shop is house.shp, the interface, and half of
  // it keeps its STATE in the owner field rather than an owner — `navtoggle=on`,
  // `light=off`, `invenhelp=notvis`. The loop walks those too (one table, and
  // TI.EXE's has no idea which is which), and what puts them back is the arriving
  // room's own `initinterface`.
  const DEALT: Record<string, string> = { rubaiyat: "coal4", realneck: "vlad" };
  const inven = [...session.propRuntime.props.entries()].filter(([, p]) => p.shop.name === "inven.shp");
  const held = inven.filter(([n, p]) => p.owner !== "none" && p.owner !== "" && p.owner !== DEALT[n]);
  check("no artifact is owned by anyone the new game did not deal it to",
    held.length === 0 && inven.length > 0,
    `${inven.length} inventory props; still held: ${held.map(([n, p]) => `${n}=${p.owner}`).join(" ") || "(none)"}`);
  for (const [prop, owner] of Object.entries(DEALT)) {
    const p = session.propRuntime.get(prop);
    check(`and mission 1 is dealt: ${prop} is with ${owner}`, p?.owner === owner, `${prop}=${p?.owner}`);
  }

  const stillOwned = [purs, zeit].filter((a) => a && (a.owner !== "none" || a.value !== 0));
  check("no actor still owns what the finished game left them holding",
    stillOwned.length === 0,
    stillOwned.map((a) => `${a!.member.name}=${a!.owner}/${a!.value}`).join(" "));

  // resetgamevars/resetpupvars, which run in the same arm and are reached the
  // same way — a stale `neckphase` is a mission that thinks it is half-done
  const stale = STORY.filter(([n]) => Number(g.get(n) ?? 0) !== 0);
  check("the story and puppet variables are back to zero",
    stale.length === 0, stale.map(([n]) => `${n}=${g.get(n)}`).join(" "));
  check("nothing is in the player's hand", (g.get("handitem") ?? "") === "", `handitem=${g.get("handitem")}`);
  check("and it is mission 1 phase 0 in C-73",
    g.get("mission") === 1 && g.get("phase") === 0 && session.currentSetName === "c73",
    `mission=${g.get("mission")} phase=${g.get("phase")} set=${session.currentSetName}`);
}
);

// --- 100. an item you are handed takes the HELP button down with it (#123) ----
// `addinven` is how anything reaches your hand, and its FIRST line is the clear:
//
//     code addinven (newitem)
//         sendtoprop ("invenhelp", initprop ())      <- HELP goes
//         ...
//         propxy (handitem, 94, 319)                 <- the item lands where it was
//
// Both draw at the left end of the interface band, which is why the order is not
// decoration: the item is put exactly where HELP was. `invenhelp` has a script of
// its own (setupprop/setcursor/mousedown) and no `initprop`, so the default in the
// boot library is what has to answer — and nothing walked there. Georgia handed
// over the fake necklace and it was drawn on top of a HELP button that should
// already have gone (#123, reported from deckbd in M1P1).
//
// `showinterface` is the tell that this is a state and not a repaint: it brings
// HELP back with `if propowner ("invenhelp") = "vis" & handitem = ""` — the owner
// field remembers whether HELP belongs on screen at all, and the hand decides
// whether it may show. So initprop must take the PICTURE down and leave the owner
// alone, which is exactly what the boot's three lines do.
test("an item handed to you takes the HELP button down (#123)", async () => {
  const { session } = await newHost();
  const g = session.interp.globals;
  g.set("mission", 1);
  g.set("phase", 0);
  await session.openSetFile("c73.set");
  await session.settle();

  const help = session.propRuntime.get("invenhelp")!;
  const item = session.propRuntime.get("fakeneck")!;
  check("the default initprop is in the boot library, not in the prop",
    !!help && session.bootScripts.some((b) => b.script.codes.has("initprop")),
    `invenhelp=${!!help} boot=${session.bootScripts.map((b) => b.script.codes.has("initprop")).join(",")}`);
  // the state the reporter was in: HELP up, nothing in hand
  help.owner = "vis";
  help.visible = true;
  g.set("handitem", "");

  // Georgia's line, verbatim (ga1.pup 0006:131)
  await session.sendEvent("sendtoshop", "inven.shp", "addinven", ["fakeneck"], "ga1.pup");
  await session.settle();
  await drain();

  check("the necklace is in hand", g.get("handitem") === "fakeneck" && item.owner === "frank",
    `handitem=${g.get("handitem")} fakeneck=${item.owner}`);
  check("HELP is no longer drawn", !help.visible, `invenhelp visible=${help.visible}`);
  // ...and the owner is untouched, so showinterface can bring it back once your
  // hand is empty again. Clearing it here would retire HELP for the rest of the game.
  check("but HELP is still ON, for when your hand is empty again",
    help.owner === "vis", `invenhelp owner=${help.owner}`);

  // the pair, as showinterface reads it
  g.set("handitem", "");
  await session.sendEvent("sendtoshop", "house.shp", "showinterface", [], "test");
  await session.settle();
  check("an empty hand brings HELP back", !!help.visible, `invenhelp visible=${help.visible}`);
}
);

// --- 101. walkonpath walks the route the SET authored (#122) ------------------
// A star record that pairs two stars can also carry a WALKING ROUTE between them:
// an i16 container ref at record +28, holding `{i32 total, i32, i32 count}`, a
// (Zmin,Xmin,Zmax,Xmax) box, then count × `{i16 X, Z, Y, distance-from-previous}`.
// Nothing read it, so `walkonpath` drew the straight line between the endpoints
// and actors cut through the scenery: Georgia crossed the second-class stairs on
// the boat deck, and Sasha clipped the corner of a wall outside A14 instead of
// stepping into the hall first (#122).
//
// The corpus authors six of these and three bend. Both reported cases are here,
// and the third (scot3 hack1->hack2, nine points) comes with them. A two-point
// path is a straight line and must stay one — halla's own ex1->ex2, the crowd
// walkers' route, is one of those.
test("walkonpath follows the SET's authored route, corners and all (#122)", async () => {
  const { session } = await newHost();

  // 1. the routes, as authored. Read from the data rather than asserted from a
  // list: what matters is that a bend is a bend and a straight line is not.
  const ROUTES: [string, string, string, number][] = [
    ["deckbd.set", "ga.1", "ga.2", 10],
    ["halla.set", "sasha.1", "sasha.2", 5],
    ["scot3.set", "hack1", "hack2", 9],
    ["halla.set", "ex1", "ex2", 2],
  ];
  for (const [file, a, b, points] of ROUTES) {
    const set = readSetFile(provider(file)!);
    const rec = set.starPaths.find((p) => p.a.toLowerCase() === a && p.b.toLowerCase() === b);
    const pts = rec ? readStarPath(set.file.containers, rec.container) : [];
    check(`${file}: ${a} -> ${b} is a ${points}-point route`, pts.length === points,
      `${pts.length} points: ${pts.map((p) => `(${p.x},${p.z})`).join(" ")}`);
    if (pts.length < 2) continue;
    // the ends ARE the two stars, which is what makes the middle a detour
    const starA = set.actors.find((s) => s.identifier.toLowerCase() === a)!;
    const starB = set.actors.find((s) => s.identifier.toLowerCase() === b)!;
    check(`${file}: and it runs from ${a} to ${b}`,
      pts[0].x === starA.positionX && pts[0].z === starA.positionZ &&
        pts[pts.length - 1].x === starB.positionX && pts[pts.length - 1].z === starB.positionZ,
      `(${pts[0].x},${pts[0].z})->(${pts[pts.length - 1].x},${pts[pts.length - 1].z}) vs ` +
        `(${starA.positionX},${starA.positionZ})->(${starB.positionX},${starB.positionZ})`);
    // each stored distance is the leg it describes (this is what the one-scalar
    // progress arithmetic in the walk service relies on)
    const legs = pts.slice(1).every((p, i) =>
      Math.abs(Math.hypot(p.x - pts[i].x, p.z - pts[i].z) - p.fromPrev) <= 2);
    check(`${file}: every stored leg length matches its own geometry`, legs,
      pts.map((p) => p.fromPrev).join(","));
  }

  // 2. Sasha's walk, in the engine. Her route leaves the cabin heading -X with Z
  // held, then turns down the hall; the straight line to sasha.2 does neither.
  await session.openSetFile("halla.set");
  await session.openCastFile("gang.cst");
  await session.settle();
  const sasha = session.actorRuntime.get("sasha")!;
  const set = session.currentBinding!.set;
  const star = (n: string) => set.actors.find((s) => s.identifier.toLowerCase() === n)!;
  const s1 = star("sasha.1");
  const s2 = star("sasha.2");
  // Standing on sasha.1, which HALLA.SET's openscene makes a CONDITION of the
  // call (`& actorstar ("sasha") = "sasha.1"`). Placing her is the test's job
  // since #230: a route walk no longer teleports the actor onto its head, it
  // leaves them where they are and the first movement pass puts them on it —
  // TI.EXE builds the record with the actor's own position (0x4437f0) and reads
  // every later one out of the route.
  sasha.worldX = s1.positionX;
  sasha.worldY = s1.positionZ;
  sasha.worldZ = s1.positionY;

  // the script's own call (HALLA.SET 0436)
  void (session.interp.builtins.get("walkonpath") as unknown as (
    i: unknown, a: unknown[], c: unknown, f: unknown,
  ) => unknown)(
    session.interp, ["sasha", "sasha.1", "sasha.2"],
    { me: "halla.set", target: "sasha" }, { ctx: { me: "halla.set", target: "sasha" } },
  );
  await drain();
  check("the walk is running, and knows where it is headed",
    session.scheduler.isWalk("sasha"), `walks=${[...session.scheduler.walks.keys()]}`);

  // worldY is the ground plane's second axis (a star's positionZ); worldZ is
  // height — the same pairing walktostar builds its record with.
  const seen: { x: number; z: number }[] = [];
  for (let i = 0; i < 4000 && session.scheduler.isWalk("sasha"); i++) {
    session.scheduler.tickTime((clock += 50));
    await drain();
    seen.push({ x: sasha.worldX, z: sasha.worldY });
  }
  check("she arrives at sasha.2", sasha.worldX === s2.positionX && sasha.worldY === s2.positionZ,
    `at (${sasha.worldX},${sasha.worldY}) want (${s2.positionX},${s2.positionZ})`);

  // The straight line from sasha.1 to sasha.2 is the wall she used to clip. Every
  // sample must be measurably off it — the route's own midpoints are 300+ units
  // away, and a diagonal walk would hug it to within rounding.
  const off = (p: { x: number; z: number }): number => {
    const vx = s2.positionX - s1.positionX;
    const vz = s2.positionZ - s1.positionZ;
    const len = Math.hypot(vx, vz);
    return Math.abs((p.x - s1.positionX) * vz - (p.z - s1.positionZ) * vx) / len;
  };
  const worst = Math.max(...seen.map(off));
  check("her route leaves the straight line, by a wall's worth",
    worst > 150, `furthest from the diagonal: ${Math.round(worst)} units over ${seen.length} samples`);

  // And the first leg is the authored one: straight out of the door, the ground
  // axis held, X falling. Sampled from where she actually sets off, because a walk
  // TURNS before it moves and those first passes are her standing still.
  const moving = seen.findIndex((p) => p.x !== s1.positionX || p.z !== s1.positionZ);
  const early = seen.slice(moving, moving + 6);
  check("the first leg holds the ground axis and moves in X, as authored",
    moving >= 0 && early.length > 0 &&
      early.every((p) => p.z === s1.positionZ) && early[early.length - 1].x < s1.positionX,
    `sets off at sample ${moving}: ${early.map((p) => `(${p.x},${p.z})`).join(" ")}`);
}
);

// --- 102. a turn is a walk, so a conversation waits for it (#124) -------------
// `turntodeg` set the facing outright. In the original it BUILDS A WALK RECORD
// (0x443550) in the same table `iswalk` answers from — the facing target at +8,
// the actor's own position, and mode 0 at +4 where a straight walk's is 1 and
// walkonpath's is 3. A turn is a walk that goes nowhere.
//
// That is what every "turn round before you talk" moment in the game is built on,
// because gang.cst's walktopuppet waits on exactly it:
//
//     pauseloop ("actor", who, true)
//     turntodeg (who, calcdeg (actorxyz (who, 4), cameraxyz (4)))
//     while iswalk (who)  forceupdate ()  endwhile
//     runpuppet (pupname, pupmessage)
//
// With the facing set outright, `iswalk` was false the instant turntodeg returned,
// the wait never spun, and runpuppet opened in the same breath: Zeitel took your
// approach in the first-class lounge without turning round, and the conversation
// began with his back to you (#124).
//
// Asserted on the mechanism rather than by running walktopuppet: its wait is a
// synchronous `while ... forceupdate()` script loop, and headless has no real
// frames for forceupdate to give up, so the loop cannot be driven from a test the
// way a browser drives it. What broke and what is fixed is the state that loop
// reads, and that is what this pins.
test("turntodeg turns over time, and iswalk is true until it lands (#124)", async () => {
  const { session, viewer } = await newSession();
  session.interp.globals.set("mission", 4);
  // NOT scene45/view49: that view is the accost trigger, and its conversation
  // parks a headless run (which is #125, still open)
  await session.openSetFile("lounge1c.set", "scene14", "view37");
  await session.openCastFile("gang.cst");
  await session.settle();
  const v = viewer();
  const zeit = session.actorRuntime.get("zeit")!;
  const turn = (deg: number): void => {
    void (session.interp.builtins.get("turntodeg") as unknown as (
      i: unknown, a: unknown[], c: unknown, f: unknown,
    ) => unknown)(session.interp, ["zeit", deg], { me: "test", target: "zeit" }, undefined);
  };

  // stop anything the room armed for him, so this measures the turn alone
  session.scheduler.stopWalk("zeit");
  zeit.deg = 0;
  const away = zeit.deg;
  turn(128); // face the other way: the longest turn there is

  check("the turn registers as a walk, which is what walktopuppet waits on",
    session.scheduler.isWalk("zeit"), `walks=${[...session.scheduler.walks.keys()]}`);
  check("and it has not snapped round", zeit.deg === away, `deg=${zeit.deg}`);

  // it arrives over several passes, at the actor's own turn rate
  let passes = 0;
  const degs: number[] = [];
  while (session.scheduler.isWalk("zeit") && passes++ < 400) {
    v.tick((clock += 50));
    await drain();
    degs.push(zeit.deg);
  }
  check("the facing comes round over many passes, not one",
    passes > 4 && zeit.deg === 128,
    `${passes} passes, deg ${away} -> ${zeit.deg}, turn rate ${zeit.turn}; first few ${degs.slice(0, 5).join(",")}`);
  check("and the slot is freed when the facing lands", !session.scheduler.isWalk("zeit"));

  // A turn goes NOWHERE: it must not move him, and must not land on a star or
  // fire the arrival lifecycle — an endwalk would re-arm his idle, and for a
  // character on a patrol it re-targets them (which is what stranded Morrow
  // halfway to morrow.2 while this was being built).
  const at = { x: zeit.worldX, y: zeit.worldY };
  turn(0);
  for (let i = 0; i < 400 && session.scheduler.isWalk("zeit"); i++) {
    v.tick((clock += 50));
    await drain();
  }
  check("a turn does not move the actor",
    zeit.worldX === at.x && zeit.worldY === at.y,
    `(${at.x},${at.y}) -> (${zeit.worldX},${zeit.worldY})`);
  check("a turn does not put him in the walk pose", zeit.poseName !== "walk", `pose=${zeit.poseName}`);

  // ...and a turn asked for the facing he already holds records nothing, which is
  // what keeps the idles from recurring through each other
  turn(zeit.deg);
  check("a turn to the facing already held is not a walk at all",
    !session.scheduler.isWalk("zeit"), `deg=${zeit.deg} walks=${[...session.scheduler.walks.keys()]}`);
}
);

// --- 103. the small game a 1996 machine got (`lowmemory`) --------------------
// Nothing in the engine decides this. BOOTFILE defines its own `lowmemory()` as
// `heapsize() < 6144000` — under 6 MB free — and its `setupdecksound` then opens
// the `.11k` bank instead of the `.trk` one while still asking for the theme by
// its `.trk` name, because a `.11k` file calls itself by the name of the file it
// stands in for (AudioLibrary.find). Despite the name they are not 11 kHz: same
// codec, same 22050 Hz, about half the loop chunks.
//
// So the player-facing setting is one lie in one builtin (`heapsize`), and this
// is the whole chain end to end: the box moves a number, the game's own scripts
// open a different file, and the theme that comes out is half as long.
test("the small-memory setting opens the game's own short themes", async () => {
  const measure = async (low: boolean): Promise<{ banks: string[]; seconds: number; rate: number }> => {
    const { session } = await newHost();
    session.lowMemory = low;
    // A-deck: BOOTFILE's setupdecksound case for gstair*/gym/vest*/wireless
    await session.openSetFile("wireless.set");
    const theme = session.audioLib.theme("decka.trk");
    return {
      banks: session.audioLib.bankNames,
      seconds: theme ? theme.samples.length / theme.sampleRate : 0,
      rate: theme?.sampleRate ?? 0,
    };
  };

  const full = await measure(false);
  check("off, the game opens the full A-deck bank",
    full.banks.includes("decka.trk") && !full.banks.includes("decka.11k"),
    `banks=${JSON.stringify(full.banks)}`);

  const small = await measure(true);
  check("on, it opens the .11k one instead",
    small.banks.includes("decka.11k") && !small.banks.includes("decka.trk"),
    `banks=${JSON.stringify(small.banks)}`);
  // the point of the whole exercise: playnewtheme("decka.trk") still finds it
  check("...and the theme still resolves by the .trk name the script asks for",
    small.seconds > 0, `theme=${small.seconds}s`);
  check("...and is about half as long, at the same rate",
    small.seconds < full.seconds * 0.6 && small.rate === full.rate,
    `${full.seconds.toFixed(1)}s -> ${small.seconds.toFixed(1)}s, ${full.rate}Hz -> ${small.rate}Hz`);
}
);

// --- 104. the transitions: a fade blocks, and a movie's last frame holds -----
//
// Both halves of what TI.EXE does between two screens, and both were reported.
//
// `screentoblack` / `blacktoscreen` (12050/12049 at 0x43e550/0x43e5d0) reach a
// palette lerp whose loop — 0x435b90 and 0x435be0 — BUSY-WAITS one 60 Hz tick
// per step on 0x41de90, with no message pump and no service pass inside it. The
// interpreter is frozen for the whole ramp, so the statement after a fade cannot
// run until the fade is done. Ours queued the ramp and returned.
//
// `gang.cst`'s `prepuppet` is where that showed:
//
//     screentoblack ("current", 10)      blacktoscreen ("puppet", 10)
//     openpuppetfile (pupname)           quiettheme ()
//     visualeffect (plain, 0)          / / ...and only THEN, in runpuppet:
//                                        sendtopuppet ("boot script", ...)
//
// The boot script is what speaks the first line, and it is two statements after
// a fade that is supposed to have finished. #6: "when starting a conversation
// with anyone, they begin speaking their lines before the fade in completes".
test("engine: a conversation's first line waits for the fade-in (#6)", async () => {
  const { host, session } = await newHost();
  session.modalMovies = true; // this pump is a frame source — see the cold boot above
  await session.ensureBooted();
  await session.openSetFile("c73.set");
  const viewer = host.viewer!;

  let clock = 0;
  const seen: { level: number; queued: number; lines: number }[] = [];
  const pump = async (until: () => boolean, max = 4000): Promise<boolean> => {
    for (let i = 0; i < max && !until(); i++) {
      viewer.tick((clock += RAMP_STEP_MS));
      await drain();
      seen.push({
        level: session.fade.level,
        queued: session.fade.queue.length,
        lines: session.puppet?.voiceQueue.length ?? 0,
      });
    }
    return until();
  };

  // the steward, opened through the game's own runpuppet — prepuppet, the boot
  // script, postpuppet, all of it
  void session.track(
    session.sendEvent("sendtoactor", "smeth", "runpuppet", ["smeth1.pup", "door"], "test"),
  );
  const spoke = await pump(() => (session.puppet?.voiceQueue.length ?? 0) > 0);
  check("smeth1.pup opens and says something", spoke,
    `puppet=${session.puppet?.name ?? "none"} lines=${session.puppet?.voiceQueue.length ?? 0}`);

  // the premise: a fade really did run. Without this the ordering below is
  // vacuously true and the test would survive the bug it exists for.
  check("prepuppet's screentoblack took the screen all the way down",
    seen.some((s) => s.level === 1), `levels=${[...new Set(seen.map((s) => s.level))].join(",")}`);

  const firstLine = seen.findIndex((s) => s.lines > 0);
  const at = seen[firstLine];
  check("...and by the first line the fade-in has finished — not black, not still ramping",
    !!at && at.level === 0 && at.queued === 0,
    `tick ${firstLine}: level=${at?.level} queued=${at?.queued}`);
}
);

// The other half. `playmovie` frees its buffers and restores NOTHING (0x448b00,
// exit path 0x44969e-0x4496c7): the clip's last frame is still in the
// framebuffer and its palette is still installed, until a script says otherwise.
// We handed the screen back to `world` on the frame the movie ended, and since
// the script resumes a rAF later that is one fully-lit frame of the room in
// between — measured in a browser at exactly one 16 ms frame of the un-bombed
// London flat between `bedex.mov` and `ocredits.mov` (#209).
//
// THE SYMPTOM IS BROWSER-ONLY and this test does not reproduce it: headless, the
// script resumes from `playmovie` inside the same drain the movie ended in, so no
// frame falls between the two and there is nothing to see. It was measured with a
// Playwright probe sampling screenOwner() per rAF, which is where the 16 ms above
// comes from. What is testable here is the decision that makes the browser right
// — who owns the screen the instant a movie is over — so that is what this pins,
// along with the four things a script can say to take it back.
test("engine: the screen after a movie is the movie's, until a script draws (#209)", async () => {
  const { host, session } = await newHost();
  session.modalMovies = true;
  await session.ensureBooted();
  await session.openSetFile("bedsit1.set");
  const viewer = host.viewer!;

  let clock = 0;
  const play = async (name: string): Promise<void> => {
    const done = session.track(viewer.playMovie(name));
    for (let i = 0; i < 4000 && viewer.moviePlaying; i++) {
      viewer.tick((clock += 66));
      await drain();
    }
    await done;
  };
  // the screen builtins read only their args, so the call site and frame a real
  // dispatch would hand them are not needed here
  const say = (name: string, ...args: Value[]) =>
    session.interp.builtins.get(name)!(session.interp, args, null as never, null as never);

  await play("datebed.mov");
  // no tick since it ended: this is the state the script resumes into
  check("a finished movie leaves the screen nobody's — pendingReveal armed",
    session.fade.pendingReveal, `pending=${session.fade.pendingReveal}`);
  check("...and until something draws, the screen is still the movie's",
    viewer.screenOwner() === "held", `owner=${viewer.screenOwner()}`);

  // Every way a script says what the screen should look like ends the hold. The
  // first two are the pair the transition idiom always uses (`blackscreen` clears
  // the buffer, `clut("black")` makes every later draw invisible); the fades are
  // the ramps either side of it.
  for (const [name, call] of [
    ["blackscreen", () => say("blackscreen")],
    ["clut(\"black\")", () => say("clut", "black")],
    ["screentoblack", () => say("screentoblack", "current", 10)],
    ["blacktoscreen", () => say("blacktoscreen", "set", 10)],
  ] as const) {
    await play("datebed.mov");
    if (viewer.screenOwner() !== "held") { check(`${name}: the hold was not armed`, false); continue; }
    void call();
    check(`${name} takes the screen back off the movie`,
      viewer.screenOwner() !== "held", `owner=${viewer.screenOwner()}`);
    session.fade.queue.length = 0; // the ramps, unticked here — see the note in savegame.ts
  }
}
);

// --- 105. the blackjack deal plays its swing, not its first frame ------------
//
// Reported (#223): "Riveria's dealing animation is not playing as intended. It
// appears to start on the first frame, waits on it, then displays the last frame
// when it would be played. The intermediate frames of hand moving the card to
// the table doesn't appear."
//
// BLKJACK.STG's `take` deals a card with
//
//     propview ("buick", "deal")
//     if playingcards = "dust"  propdeg ("buick", 1)  else  propdeg ("buick", 0)
//     for count = 1 to 19 / forceupdate () / endfor
//     propview ("buick", "idle")
//
// and `deal` stores the swing TWICE — a clean deck and a dusty one, degrees
// [0,0,0,0,1,1,1,1,0,1], with a play script written against the variant
// (0,0,0,0,1,1,1,1,…,4,4,4,4). So the propdeg is choosing which deck is dealt,
// not which picture is shown, and this port's frame pin — right for a selector,
// which is what propdeg usually addresses — stopped the animation dead on both
// halves of the idiom: the propdeg itself, and the NEXT card's propview, which
// found degVariants set from within the same event.
test("blackjack: the deal plays its swing, at the deck's own variant", async () => {
  const { session } = await newSession();
  await session.openSetFile("smoke.set");
  await session.openShop("blkjack.shp");
  const buick = session.propRuntime.get("buick")!;
  const call = (name: string, args: (string | number)[]): void => {
    (session.interp.builtins.get(name) as (i: unknown, a: (string | number)[]) => void)(
      session.interp,
      args,
    );
  };
  // one card, `take`'s own choreography and its own budget of 19 service passes
  const deal = (deg: number): number[] => {
    call("propview", ["buick", "deal"]);
    call("propdeg", ["buick", deg]);
    const shown: number[] = [];
    for (let i = 0; i < 19; i++) {
      shown.push(buick.currentFrameIdx(buick.state()!));
      session.propRuntime.tick((clock += 50), 50);
    }
    return shown;
  };
  const clean = deal(0);
  // the second card of the hand: same event, degVariants already set
  const dusty = deal(1);
  const pictures = (a: number[]) => new Set(a).size;

  check("the deal animates instead of holding its first picture",
    pictures(clean) >= 4, `frames=${JSON.stringify(clean)}`);
  check("...through the clean deck's own frames, and ending on its last",
    clean.every((i) => [0, 1, 2, 3, 8].includes(i)) && clean[clean.length - 1] === 8,
    `frames=${JSON.stringify(clean)}`);
  check("the card after it animates too (the propdeg before it is not a pin)",
    pictures(dusty) >= 4, `frames=${JSON.stringify(dusty)}`);
  check("...and a dusty deck deals the dusty deck's pictures",
    dusty.every((i) => [4, 5, 6, 7, 9].includes(i)) && dusty[dusty.length - 1] === 9,
    `frames=${JSON.stringify(dusty)}`);
}
);

// --- 106. a route walked BACKWARDS keeps its own leg lengths (#224) ----------
//
// Reported: after the rope clue in Scotland Road the hacker "walks away in a
// very broken way. First too fast down the hallway, then too slow in the corner,
// then too fast and too slow reaching the door", against an original whose walk
// down that hall is one constant speed.
//
// GANG.CST's hacker leaves with `walkonpath (me, "resume", "hack1")`, and SCOT3
// authors that route the other way round — nine points, hack1 -> hack2 — so it
// is walked reversed. A point's `fromPrev` is the length of the leg BEHIND it,
// which means reversing the array of points alone hands every leg the length of
// its neighbour: the hallway's 3983 units were paced as 856 (4.65x too fast),
// the corners at 0.29x and 0.45x, and the last leg to the door was left with a
// stored length of ZERO, so the hacker covered its 752 units in one pass. The
// route's total came out 4678 against the 8661 its own container header
// declares, which is the check that says it in one number.
//
// One progress scalar over the whole polyline is right (see startWalkPath); it
// is only right if the legs it is spent against are the real ones.
test("a route walked backwards keeps its own leg lengths (#224)", async () => {
  const { session } = await newHost();
  await session.openSetFile("scot3.set");
  await session.openCastFile("gang.cst");
  await session.settle();
  const hack = session.actorRuntime.get("hack")!;
  const set = session.currentBinding!.set;
  const star = (n: string) => set.actors.find((s) => s.identifier.toLowerCase() === n)!;
  const to = star("hack1");
  // the room's own entry (SCOT3.SET 0110): standing on hack2, at the hall's
  // speed and scale
  await session.sendEvent("sendtoactor", "hack", "setupactor", ["scot3"], "test");
  await session.settle();

  // the script's own call (GANG.CST 0258 mousedown, after the puppet)
  void (session.interp.builtins.get("walkonpath") as unknown as (
    i: unknown, a: unknown[], c: unknown, f: unknown,
  ) => unknown)(
    session.interp, ["hack", "resume", "hack1"],
    { me: "scot3.set", target: "hack" }, { ctx: { me: "scot3.set", target: "hack" } },
  );
  await drain();

  const seen: { x: number; y: number }[] = [{ x: hack.worldX, y: hack.worldY }];
  for (let i = 0; i < 4000 && session.scheduler.isWalk("hack"); i++) {
    session.scheduler.tickTime((clock += 50));
    await drain();
    seen.push({ x: hack.worldX, y: hack.worldY });
  }
  check("he arrives at hack1", hack.worldX === to.positionX && hack.worldY === to.positionZ,
    `at (${hack.worldX},${hack.worldY}) want (${to.positionX},${to.positionZ})`);

  // Every pass covers the same ground: `progress += actorspeed`, once per 50 ms.
  // Sampled between the first move and the last (a walk turns before it moves,
  // and the arrival pass is a part-step onto the star).
  const steps: number[] = [];
  for (let i = 1; i < seen.length; i++) {
    steps.push(Math.hypot(seen[i].x - seen[i - 1].x, seen[i].y - seen[i - 1].y));
  }
  const moving = steps.filter((d) => d > 0);
  const paced = moving.slice(0, -1);
  const fastest = Math.max(...paced);
  const slowest = Math.min(...paced);
  check("he walks the whole route at one speed",
    fastest - slowest <= 2,
    `steps ranged ${slowest.toFixed(1)}..${fastest.toFixed(1)} units over ${paced.length} passes`);
  check("...his actorspeed's worth of it, every pass",
    Math.abs(fastest - hack.speed) <= 2,
    `speed=${hack.speed} fastest step=${fastest.toFixed(1)}`);
  // 8661 units at his speed, and no leg skipped: the count is the route's own
  // length divided by the pace, not a shortened 4678-unit version of it
  check("...for as long as the route the set authored is",
    Math.abs(moving.length - 8661 / hack.speed) <= 2,
    `${moving.length} passes at speed ${hack.speed}, want ~${Math.round(8661 / hack.speed)}`);
}
);

// --- 107. an interrupted route resumes where it was left (#230) -------------
//
// Reported, continuing #224: "at the conversation's end, Jack appears to
// jump/teleport to the first star he's to walk to", and "when interrupted in the
// midst of the walk, Jack will reset to the start of the walk" — against an
// original where "Jack turns and begins walking after the conversation, and
// resumes where he left off when interrupted".
//
// Both are one missing step. `walkonpath (me, "resume", "hack1")` (gang.cst 0258
// mousedown, and again out of `walktopuppet` when the walk itself is what you
// interrupted) does not merely LOOK a route up more loosely than the named form:
// TI.EXE's resume lookup ends by calling 0x40a200, which cuts the route down to
// the part still ahead of the actor — nearest point, actor's own position
// written over it, everything before it dropped, every remaining leg re-measured.
// The named lookup (0x409fd0) never calls it. Without it the route always begins
// at its own first point, and since the mover reads position out of the ROUTE,
// the actor is standing there on the next pass however far away they were.
//
// `walktopuppet` is what puts them far away: it stands the character in front of
// the camera for the conversation, and it is also what re-issues the walk, on the
// mid-walk sentinel this test checks last.
test("an interrupted route resumes where it was left (#230)", async () => {
  const { session } = await newHost();
  await session.openSetFile("scot3.set");
  await session.openCastFile("gang.cst");
  await session.settle();
  const hack = session.actorRuntime.get("hack")!;
  const set = session.currentBinding!.set;
  const star = (n: string) => set.actors.find((s) => s.identifier.toLowerCase() === n)!;
  const to = star("hack1");
  const walkonpath = (from: string, dest: string): void => {
    void (session.interp.builtins.get("walkonpath") as unknown as (
      i: unknown, a: unknown[], c: unknown, f: unknown,
    ) => unknown)(
      session.interp, ["hack", from, dest],
      { me: "scot3.set", target: "hack" }, { ctx: { me: "scot3.set", target: "hack" } },
    );
  };
  /** run the walk out, reporting where he went */
  const run = async (passes: number): Promise<{ x: number; y: number }[]> => {
    const seen: { x: number; y: number }[] = [{ x: hack.worldX, y: hack.worldY }];
    for (let i = 0; i < passes && session.scheduler.isWalk("hack"); i++) {
      session.scheduler.tickTime((clock += 50));
      await drain();
      seen.push({ x: hack.worldX, y: hack.worldY });
    }
    return seen;
  };
  // the room's own entry (SCOT3.SET 0110): standing on hack2, the far end of the
  // nine-point route SCOT3 authors hack1 -> hack2
  await session.sendEvent("sendtoactor", "hack", "setupactor", ["scot3"], "test");
  await session.settle();

  // 1. THE CONVERSATION'S END. `walktopuppet` has walked him off the route to
  // stand in front of the camera — `playerxyz + calcvect (currentdeg, hotdist/6)`
  // — and gang.cst's mousedown then resumes the route. He must set off from
  // there, not from the route's head 4000-odd units up Scotland Road.
  const aside = { x: hack.worldX + 260, y: hack.worldY - 180 };
  hack.worldX = aside.x;
  hack.worldY = aside.y;
  walkonpath("resume", "hack1");
  await drain();
  check("the call itself moves nobody",
    hack.worldX === aside.x && hack.worldY === aside.y,
    `stood at (${aside.x},${aside.y}), call left him at (${hack.worldX},${hack.worldY})`);
  const away = await run(4000);
  const firstMove = away.find((p, i) => i > 0 && (p.x !== away[0].x || p.y !== away[0].y))!;
  check("...and he walks OUT of where he stood, one step",
    Math.hypot(firstMove.x - aside.x, firstMove.y - aside.y) <= hack.speed + 1,
    `first move (${firstMove.x},${firstMove.y}) is ` +
    `${Math.hypot(firstMove.x - aside.x, firstMove.y - aside.y).toFixed(0)} from (${aside.x},${aside.y})`);
  check("he still arrives at hack1",
    hack.worldX === to.positionX && hack.worldY === to.positionZ,
    `at (${hack.worldX},${hack.worldY}) want (${to.positionX},${to.positionZ})`);

  // 2. INTERRUPTED MID-WALK. Walk part of the route, stop him where the click
  // would have (`stopwalk (who)` in walktopuppet), and resume: what is left to
  // walk is what was left, not the whole route again.
  await session.sendEvent("sendtoactor", "hack", "setupactor", ["scot3"], "test");
  await session.settle();
  walkonpath("resume", "hack1");
  await drain();
  check("a route walk says what KIND of walk it is, while it runs",
    hack.starName === "walkonpath",
    `actorstar(hack) = "${hack.starName}" — walktopuppet's saveonpath reads this`);
  await run(60);
  const whole = session.scheduler.walks.get("hack")!;
  const left = whole.dist - whole.progress;
  const stopped = { x: hack.worldX, y: hack.worldY };
  check("...and he is under way, part of the route behind him",
    left > 0 && left < whole.dist * 0.95,
    `${left} of ${whole.dist} left`);
  session.scheduler.stopWalk("hack");
  walkonpath("resume", "hack1");
  await drain();
  check("the resumed walk does not put him back at the start",
    hack.worldX === stopped.x && hack.worldY === stopped.y,
    `stopped at (${stopped.x},${stopped.y}), resumed at (${hack.worldX},${hack.worldY})`);
  const again = session.scheduler.walks.get("hack")!;
  // Same ground still to cover, to within the re-measure: the resumed route's
  // first leg is a new one (his position to the next point) that the truncating
  // isqrt rounds down, where the interrupted walk was partway along an authored
  // leg.
  check("...and what it has left to walk is what was left",
    Math.abs(again.dist - left) <= hack.speed,
    `resumed with ${again.dist} to walk, ${left} was outstanding`);
  await run(4000);
  check("...and it still ends at hack1",
    hack.worldX === to.positionX && hack.worldY === to.positionZ,
    `at (${hack.worldX},${hack.worldY}) want (${to.positionX},${to.positionZ})`);
}
);

// --- 108. a press consumed while another chain is in flight stays consumed (#232)
//
// Reported: "by holding the forward input, it is occasionally possible to force
// oneself through crates in the smokestack… my guess is a mistiming: the
// continued movement is processed before the game can tell movement that you're
// supposed to be blocked."
//
// The block is computed in time — `blocked` reads 1 at the crate on every one of
// those passes (that was #88, and it holds). What fails is the CONSUMPTION.
// SMSTACK2's set main is the whole of the crate:
//
//     code keydown (arg)
//         if blocked & arg = "uparrow"
//             exitcode
//
// and `exitcode` only counts when the frame is a handler OF THE EVENT BEING
// DISPATCHED — otherwise every routine that ends in one would eat the player's
// press (see Interpreter.eventConsumed). The port answered "which event" from a
// single interpreter-wide field, set by `runHandler` when its depth counter read
// zero. That counter is shared, and the port runs more than one chain at a time:
// `serviceGameClock` dispatches `calctime` through `trackIdle` PRECISELY so the
// heartbeat does not read as a busy player script, so a press drained on the same
// tick begins while calctime is still suspended at an await, sees depth > 0, and
// never names its own event. Every `exitcode` in that chain then compared itself
// against "calctime", quietly declined to consume, and the chain ran on into the
// boot library's default move — `currentscene ("strait")`, a walk through the
// crate.
//
// Intermittent exactly as reported: it needs the heartbeat mid-flight at the
// instant the press is dispatched, which is most of the time when a key is HELD,
// because that is when a press is waiting in the queue to be drained on the very
// tick boundary the heartbeat fires on.
test("a press consumed while another chain is in flight stays consumed (#232)", async () => {
  const { host, session } = await newHost();
  const g = session.interp.globals;
  let clock = 0;
  g.set("tour", 0); g.set("mission", 3);
  // maze 1 / level 3 walls up sections 2 and 6; the set opens facing section 2
  g.set("mazenumber", 1); g.set("stacklevel", 3);
  await host.loadServerSet("smstack2.set");
  const v = () => host.viewer!;
  const where = () => `${session.currentSceneName()}/${session.currentViewName()}`.toLowerCase();
  const settle = async (n = 40): Promise<void> => {
    for (let i = 0; i < n; i++) { v().tick((clock += 50)); await drain(); }
  };
  await settle();
  check("standing at the crate, and it knows it",
    where() === "scene37/view47" && Number(g.get("blocked")) === 1,
    `${where()} blocked=${g.get("blocked")}`);

  // 1. THE MECHANISM, on its own. `calctime` is what the heartbeat dispatches;
  // leave it suspended and send the press while it is.
  const heartbeat = session.runGlobal("calctime");
  await session.sendEvent("sendtoscene", session.currentSceneName(), "keydown", ["uparrow"], "test");
  check("the set's exitcode consumes the press it was dispatched for",
    session.interp.eventConsumed,
    "eventConsumed was false — the chain would run on into the boot's default move");
  await heartbeat;
  await settle();

  // 2. THE SYMPTOM, deterministically. A press made while the camera was moving
  // is QUEUED (that is what makes a held key walk a corridor), and the drain
  // happens on a tick — after `tickTime` has fired the heartbeat on that same
  // tick. One queued press at the crate is the whole bug.
  const before = where();
  session.events.post({ kind: "keydown", key: "uparrow", special: false }, { coalesce: true });
  await settle(60);
  check("a QUEUED press at the crate does not walk through it", where() === before,
    `queued press took us ${before} -> ${where()}`);

  // 3. THE REPORTER'S GESTURE. Turn to the open road (section 1) and hold the
  // key: the walk goes 1 -> 8 -> 7 and must stop at the crate in section 6.
  for (let i = 0; i < 2; i++) { await session.track(v().keyDown("leftarrow")); await settle(); }
  check("facing the open road", where() === "scene37/view48" && Number(g.get("blocked")) === 0,
    `${where()} blocked=${g.get("blocked")}`);
  const visited: string[] = [where()];
  for (let i = 0; i < 400; i++) {
    void session.track(v().pressNav("uparrow"));       // the auto-repeat of a held key
    v().tick((clock += 50));
    await drain();
    if (where() !== visited[visited.length - 1]) visited.push(where());
  }
  await settle(120);
  if (where() !== visited[visited.length - 1]) visited.push(where());
  // section 6 is scene66/view73 — the far side of it is scene39, and reaching
  // scene39 means the crate was walked through
  check("the held key stops at the crate instead of forcing through it",
    where() === "scene66/view73" && !visited.includes("scene39/view57"),
    `held up and ended at ${where()} via ${visited.filter((w) => !w.endsWith("/moving")).join(" -> ")}`);
}, 120_000);


// --- movement speed: the player's pace is theirs, the script's is the game's --
// #222 asks for the transition rate to be a choice — motion sickness at one end
// ("Carlson isn't sprinting everywhere"), Myst-style snapping at the other. #205
// had just finished proving the rate is NOT a matter of taste (50 ms a frame is
// `framerate`'s shipped 3 ticks of 50/3 ms), so the two only coexist because the
// default IS that number and the choice is the player's own moves alone.
//
// Three things have to hold, and each one is a way the feature could be wrong:
//
//  1. the pace is the pace. A turn at `slow` takes twice the ticks a turn at
//     `original` does, and one at `fast` takes half — which is only possible
//     because a sub-step pace may spend more than one frame on a tick (a
//     headless tick is 50 ms; 25 ms a frame is two of them). `instant` spends
//     the whole ring on ONE tick.
//  2. `instant` never draws a frame of the ring. The settle runs inside the tick
//     that draws the animation's last frame, so the only picture that reaches
//     the screen is the standpoint arrived at.
//  3. a SCRIPT's move is untouched by any of it. BEDSIT1's air raid budgets ten
//     passes for a 7-frame road and does not wait; at `slow` that road would
//     want twenty and the turn after it would land after the bomb, which is
//     exactly the #40 the pace split was invented to stop.
test("movement speed: the player's pace is theirs, a script's is the game's (#222)", async () => {
  const { session, viewer } = await newSession();
  await session.openSetFile("bedsit1.set", "scene2", "view14");
  const v = viewer();
  const anyv = v as unknown as { animation: { pixels: Uint8Array }[] | null };
  const hash = (f: { pixels: Uint8Array; width: number; height: number } | null): string => {
    if (!f) return "none";
    let h = 0x811c9dc5;
    const n = f.width * f.height;
    for (let i = 0; i < n; i++) h = Math.imul(h ^ f.pixels[i], 0x01000193) >>> 0;
    return h.toString(16);
  };

  /**
   * One right turn at the current setting, ticked at the engine step — which is
   * what the headless host runs at, so the counts below are the browser's too
   * for any pace at or above it.
   *
   * `ticks` counts the FIRST tick as well, and that one never draws: it is where
   * the animation's clock starts (`lastTick`), so every count here is n+1.
   */
  const turnRight = (): { ticks: number; frames: number; drawn: string[]; landed: number } => {
    v.turn(RIGHTTURNS);
    const frames = anyv.animation?.length ?? 0;
    const drawn: string[] = [];
    let ticks = 0;
    while (anyv.animation && ticks < 500) {
      ticks++;
      const f = v.tick((clock += ENGINE_STEP_MS));
      const h = hash(f);
      if (h !== drawn[drawn.length - 1]) drawn.push(h);
    }
    return { ticks, frames, drawn, landed: v.viewIdx };
  };

  const from = v.viewIdx;
  session.moveSpeed = "original";
  const orig = turnRight();
  check("the ring is worth measuring", orig.frames >= 2 && orig.landed !== from,
    `frames=${orig.frames} ${from} -> ${orig.landed}`);
  check("original: one frame a tick, which is what it has always been",
    orig.ticks === orig.frames + 1, `${orig.ticks} ticks for ${orig.frames} frames`);

  // back to where we started, so every speed turns the same ring
  const backTo = (idx: number): void => {
    for (let i = 0; i < 12 && v.viewIdx !== idx; i++) {
      v.turn(LEFTTURNS);
      for (let n = 0; n < 500 && anyv.animation; n++) v.tick((clock += ENGINE_STEP_MS));
    }
  };

  backTo(from);
  session.moveSpeed = "slow";
  const slow = turnRight();
  check("slow: 100 ms a frame is two ticks each, and the same frames",
    slow.frames === orig.frames && slow.ticks === 2 * orig.frames + 1 && slow.landed === orig.landed,
    `${slow.ticks} ticks for ${slow.frames} frames -> ${slow.landed}`);

  backTo(from);
  session.moveSpeed = "fast";
  const fast = turnRight();
  check("fast: 25 ms a frame is two frames a tick, and the same landing",
    fast.frames === orig.frames && fast.ticks === Math.ceil(orig.frames / 2) + 1 &&
      fast.landed === orig.landed,
    `${fast.ticks} ticks for ${fast.frames} frames -> ${fast.landed}`);

  backTo(from);
  session.moveSpeed = "instant";
  const now = turnRight();
  check("instant: the whole ring on one tick, landing where the others landed",
    now.frames === orig.frames && now.ticks === 1 && now.landed === orig.landed,
    `${now.ticks} ticks for ${now.frames} frames -> ${now.landed}`);
  // and what that one tick DREW is the standpoint, not a frame of the turn:
  // `showView` runs inside it. The settled picture is what the next tick shows.
  const settled = hash(v.tick((clock += ENGINE_STEP_MS)));
  check("instant: no frame of the turn ever reaches the screen",
    now.drawn.length === 1 && now.drawn[0] === settled,
    `drew ${now.drawn.length} picture(s): ${now.drawn.join(", ")} settled=${settled}`);

  // 3. the script's move keeps the engine's rate, at the setting most likely to
  // wreck it. `navDriver` is the hook the scheduler arms around a scene loop.
  backTo(from);
  session.moveSpeed = "instant";
  const prev = v.armNavHooks();
  session.navFromScript = true;
  try {
    session.navDriver("right");
  } finally {
    session.navFromScript = false;
    v.disarmNavHooks(prev);
  }
  const scripted = anyv.animation?.length ?? 0;
  let scriptTicks = 0;
  while (anyv.animation && scriptTicks < 500) {
    scriptTicks++;
    v.tick((clock += ENGINE_STEP_MS));
  }
  check("a scripted move still spends one pass a frame, whatever the player asked for",
    scripted === orig.frames && scriptTicks === orig.frames + 1,
    `${scriptTicks} ticks for ${scripted} frames at moveSpeed=${session.moveSpeed}`);
});
