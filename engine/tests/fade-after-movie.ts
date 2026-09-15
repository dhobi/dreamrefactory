/**
 * What a fade takes down after a film is the FILM.
 *
 *   npx vitest run engine/tests/fade-after-movie.ts
 *
 * #380, "[Titanic] Lift door animations broken at end": you ride the lift, the
 * gate animation finishes OPEN, and the doors are shut again for a moment before
 * the screen goes dark and hands you the room.
 *
 * ## The mechanism, traced in the page
 *
 * `ELEV1.PUP/0006 doelev ()` ends the ride on `playmovie ("elevgs.mov")` with the
 * liftboy's own close-up still loaded, and the next statement fades. Sampled
 * every 16 ms at the arrival, the two frames that matter are
 *
 *     51155  movie  pup:VIS  mov:elevgs.mov@10  lvl:0.00  -     busy
 *     51172  faded  pup:VIS  mov:-@-1           lvl:0.10  SNAP  busy
 *
 * — the clip ends on frame 10 (gate open) and a `screentoblack` starts on the
 * very next frame. So the whole ending is a fade-out of a SNAPSHOT, and the
 * question is only what got snapshotted.
 *
 * `GameSession.captureFrame` rebuilds the conversation screen before capturing
 * whenever a close-up is visible. That exception is real and is about subtitles:
 * a line ends by clearing its caption and the script's `screentoblack` runs in
 * the same tick, so the buffer still holds a frame composited with the
 * character's lower 40 px clipped away for a caption that is gone. But a film
 * that has just ended is not that case — the buffer holds the clip's last frame,
 * which is exactly the picture the ramp is meant to take down. Rebuilding the
 * close-up instead fades `elev1.pup`'s 512x264 BACKDROP, and that backdrop is
 * the lift's CLOSED DOORS.
 *
 * `fade.pendingReveal` is the flag that tells the two apart: it means "a movie
 * ended and nothing has said what the screen should look like since", and
 * nothing arms it when a spoken line ends.
 *
 * No game data: the clip is generated here with the same writer `mov-editor`
 * uses, and the room and close-up are stubs.
 */
import { test, expect } from "vitest";
import { buildMovBytes } from "@dreamfactory/engine/df/mov-build";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { ScreenDirector, type RoomLayer } from "@dreamfactory/engine/web/screen-director";
import type { CachedFrame } from "@dreamfactory/engine/web/ring-cache";

/** Titanic's screen, and the lift clip's own 512x264 — which does NOT cover it */
const W = 512;
const H = 384;
const CLIP_W = 512;
const CLIP_H = 264;

/** 0 black, 1 the room (blue-dominant), 2 the clip's open gate (red-dominant) */
const PALETTE = new Uint8Array([0, 0, 0, 40, 80, 190, 220, 30, 30]);
const ROOM = 1;
const GATE_OPEN = 2;

/** the room, in as much as this needs one: a still view that is not the clip */
function stubRoom(): RoomLayer {
  const pixels = new Uint8Array(CLIP_W * CLIP_H).fill(ROOM);
  const frame: CachedFrame = { pixels, width: CLIP_W, height: CLIP_H };
  const pal = new Uint8ClampedArray(256 * 3);
  pal.set(PALETTE);
  return {
    roomVersion: 4,
    roomAnimating: false,
    roomFrame: () => frame,
    roomPalette: () => pal,
    roomPropPalette: () => pal,
    bandPropPalette: () => pal,
    roomCamera: () => null,
    roomOcclusion: () => null,
    applyRoomClut: () => {},
    refreshRoomGamma: () => {},
    advanceRoom: () => frame,
    drawRoomHotspots: () => {},
    roomSignature: () => {},
    pointInRoomImage: () => true,
    roomClickAt: async () => false,
    roomHitTest: () => null,
    sendRoomPainting: async () => {},
    roomKeyDown: async () => false,
    armRoomNav: () => null,
    disarmRoomNav: () => {},
  };
}

/**
 * `elevgs.mov`, in miniature: the gate shut for ten frames and OPEN on the last.
 *
 * Type 6 on every frame but the last and type 1 on it — "advance one frame" then
 * "exit the segment", which is what the shipped clip carries (dumped: frames
 * 0-9 type 6, frame 10 type 1) and what `chooseFrameInterval` looks for. With no
 * stepping frame anywhere a movie is a click-through close-up and waits for a
 * pointer that never comes.
 */
function gateOpeningClip(): Uint8Array {
  const frames = [];
  for (let i = 0; i < 11; i++) {
    const art = new Uint8Array(CLIP_W * CLIP_H).fill(i === 10 ? GATE_OPEN : ROOM);
    frames.push({ name: `f${i}`, art, type: i === 10 ? 1 : 6 });
  }
  return buildMovBytes({ palette: PALETTE, width: CLIP_W, height: CLIP_H, minHoldTicks: 2, frames });
}

/** a canvas that records nothing — the framebuffer is what these read */
function stubCtx(): CanvasRenderingContext2D {
  return {
    canvas: { width: W, height: H },
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
    save: () => {},
    restore: () => {},
    fillRect: () => {},
    fillText: () => {},
    measureText: () => ({ width: 0 }),
  } as unknown as CanvasRenderingContext2D;
}

/** which palette slot a pixel of an RGBA buffer is, read as "which channel won" */
function slotIn(rgba: ArrayLike<number>, x: number, y: number, width: number): number {
  const o = (y * width + x) * 4;
  const r = rgba[o];
  const g = rgba[o + 1];
  const b = rgba[o + 2];
  if (r < 8 && g < 8 && b < 8) return 0;
  return b > r ? ROOM : GATE_OPEN;
}

/**
 * The liftboy, loaded and shown for the whole ride.
 *
 * `session.puppet` is a getter onto `puppetCtrl.puppet`, so the close-up is put
 * up where the controller keeps it. The fields are the ones
 * `PuppetView.drawSignature` reads — this is a screen-ownership test and the
 * close-up needs to be VISIBLE, not to be drawable.
 */
function showCloseUp(session: GameSession): void {
  /*
   * `pup` carries the palette and stances `PuppetView.composite` reads. It is
   * a real close-up with no art in it: the stance list is empty, so a rebuilt
   * conversation screen is a CLEARED one — which is what lets the last test
   * below tell "rebuilt" from "kept the film's frame" without shipping a PUP.
   */
  const paletteRaw = new Uint8Array(256 * 3);
  paletteRaw.set(PALETTE);
  (session.puppetCtrl as unknown as { puppet: unknown }).puppet = {
    visible: true,
    name: "elev1",
    stanceIdx: 0,
    subtitle: "",
    bevels: [],
    chosen: null,
    press: null,
    pup: { paletteRaw, stances: [], bandLocation: 0, file: { containers: [] } },
  };
}

function newWorld(): { session: GameSession; dir: ScreenDirector; ctx: CanvasRenderingContext2D } {
  const film = gateOpeningClip();
  const session = new GameSession(
    (name) => (name.toLowerCase() === "elevgs.mov" ? film : null),
    new NullAudioSink(),
  );
  session.currentSetName = "gstair3";
  session.setVisible = true;
  const dir = new ScreenDirector(session, { width: W, height: H });
  dir.setRoom(stubRoom());
  // SetViewer's one line here (viewer.ts:509) — and `showView` paints nothing
  dir.onRoomReveal = () => {};
  return { session, dir, ctx: stubCtx() };
}

/** run the clip to its end, ticking AND rendering the way a host does */
async function playToEnd(
  session: GameSession,
  dir: ScreenDirector,
  ctx: CanvasRenderingContext2D,
): Promise<boolean> {
  void session.onPlayMovie?.("elevgs.mov");
  await Promise.resolve();
  await Promise.resolve();
  expect(dir.movies.playing, "the clip started").toBe(true);
  let now = 0;
  let sawOpenGate = false;
  for (let i = 0; i < 400 && dir.movies.playing; i++) {
    dir.tick((now += 20));
    dir.render(ctx);
    if (dir.movies.playing && slotIn(dir.screen.frame, 256, 132, W) === GATE_OPEN) sawOpenGate = true;
  }
  expect(dir.movies.playing, "the clip reached its end").toBe(false);
  return sawOpenGate;
}

/**
 * The probe proving it watched what it is about to make a claim about — without
 * it the tests below pass on a clip that never played a frame, which two drafts
 * of this file managed (a movie with no stepping frame never advances, and a
 * compositor never driven through `render` never draws one).
 */
test("the open gate really does reach the screen while the clip is playing", async () => {
  const { session, dir, ctx } = newWorld();
  expect(await playToEnd(session, dir, ctx), "the last frame was composited").toBe(true);
});

/**
 * THE #380 ASSERTION.
 *
 * A film has just ended with a close-up still loaded, and the script fades. What
 * the ramp takes down must be the film's last frame — the open gate — and not
 * the close-up's backdrop, which in the shipped puppet is the lift's shut doors.
 */
test("a fade after a film snapshots the film, not the close-up behind it", async () => {
  const { session, dir, ctx } = newWorld();
  showCloseUp(session);
  await playToEnd(session, dir, ctx);

  expect(session.fade.pendingReveal, "a finished film arms the reveal").toBe(true);
  expect(session.puppet?.visible, "and the close-up is still loaded").toBe(true);

  const shot = session.captureFrame?.();
  expect(shot, "there is a frame to fade").toBeTruthy();
  expect(
    slotIn(shot!.rgba, 256, 132, shot!.width),
    "the gate is OPEN in it — the film is what fades",
  ).toBe(GATE_OPEN);
});

/**
 * ...and the subtitle case the exception exists for is untouched.
 *
 * A spoken line ending is not a film ending: nothing arms `pendingReveal`, so a
 * close-up fading mid-conversation still rebuilds its screen from what is true
 * now rather than fading a frame whose caption has just been cleared. Asserted
 * on the rebuild HAPPENING — the stub close-up draws no art, so a rebuilt screen
 * is a cleared one, which is exactly what tells the two paths apart here.
 */
test("a fade with no film behind it still rebuilds the close-up", async () => {
  const { session, dir, ctx } = newWorld();
  await playToEnd(session, dir, ctx);
  // the film is over and something has since spoken for the screen
  session.fade.pendingReveal = false;
  showCloseUp(session);
  dir.render(ctx);

  const shot = session.captureFrame?.();
  expect(shot, "there is a frame to fade").toBeTruthy();
  expect(
    slotIn(shot!.rgba, 256, 132, shot!.width),
    "the conversation screen was rebuilt, not the stale film frame kept",
  ).not.toBe(GATE_OPEN);
});
