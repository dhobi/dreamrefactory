/**
 * The six opcodes *Timelapse* asked for that this port did not have.
 *
 *   npx vitest run engine/tests/timelapse-opcodes.ts
 *
 * A third rip is a fresh set of demands on an engine recovered from two, and
 * these are what it turned up: `plugin` (42 calls), `pluginfx` (4), `prophide`
 * (2), `freemem` (1), `sysmem` (1) and `sendtobootfx` (1). Titanic and Dust ask
 * for none of them. Each was reaching `onUnknown` — logged and answered 0 —
 * which for four of the six is a silent wrong answer rather than a missing
 * feature.
 *
 * The largest by far is `plugin("xray", …)`, and its 32 calls are one mechanic
 * three times over.
 *
 * A light you drag across a dark picture, revealing a SECOND flat through the
 * shape of the light: the flashlight in world A, the glowstick in the insect
 * room, the x-ray specs in world E. What the other two named plugins are, and
 * why `scrollflat` is deliberately NOT implemented, is in
 * `engine/src/runtime/plugins.ts`.
 *
 * Two flats and a stencil is all it takes to test, so the stage and the shop
 * below are authored here with the same writers the language chooser's stage is
 * built with — no game data, and the assertions can be about individual pixels
 * rather than about a screenshot.
 *
 * The stage is deliberately 640×480: that is Timelapse's screen, it is the only
 * game that calls these, and a reveal that only worked at the engine's old
 * hardcoded 512×384 would pass a smaller test and fail every real call.
 */
import { test, expect } from "vitest";
import { buildStgBytes } from "@dreamfactory/engine/df/stg-build";
import { buildShpBytes } from "@dreamfactory/engine/df/shp-build";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { ScreenDirector } from "@dreamfactory/engine/web/screen-director";
import {
  CAMERA_NO_PHOTO, CAMERA_OK, PHOTO_H, PHOTO_W, PHOTO_X, PHOTO_Y, Photo, PhotoStore,
} from "@dreamfactory/engine/runtime/photos";

const W = 640;
const H = 480;

/** 0 black, 1 the visible flat's field, 2 the hidden flat's */
const PALETTE = new Uint8Array([0, 0, 0, 30, 30, 200, 200, 30, 30]);

/** a full-screen flat of one index */
const flatArt = (index: number) => ({ pixels: new Uint8Array(W * H).fill(index), width: W, height: H });

/** enough of a 2D context to render into — the framebuffer is what these read */
function stubCtx(): CanvasRenderingContext2D {
  return {
    canvas: { width: W, height: H },
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
    save: () => {}, restore: () => {}, fillRect: () => {}, fillText: () => {},
    measureText: () => ({ width: 0 }),
    set fillStyle(_v: unknown) {}, set globalAlpha(_v: unknown) {}, set font(_v: unknown) {},
    set textBaseline(_v: unknown) {},
  } as unknown as CanvasRenderingContext2D;
}

/**
 * The aperture — and it is deliberately NOT a full rectangle.
 *
 * A 20×20 frame whose opaque pixels form a centred diamond (`|dx| + |dy| <= 9`),
 * because the shape is the whole point: a light's glow is round, and a reveal
 * that blitted the frame's bounding box would look like a window rather than a
 * torch. An all-opaque mask makes every assertion below pass whether or not the
 * stencil is honoured, so the corners being TRANSPARENT is what gives the test
 * its teeth.
 *
 * Stored with the offsets a real prop frame carries, so the placement arithmetic
 * under test is the arithmetic `PropRuntime.composite` does: `posXraw`/`posYraw`
 * at the frame's centre, which puts a prop driven to (x, y) with its middle
 * there — what dragging a light feels like.
 *
 * `indexed` is filled with a colour that appears in neither flat's field, so a
 * reveal that drew the MASK instead of the hidden flat through it would read as
 * "other" rather than passing as a hit.
 */
const APERTURE = 20;
const RADIUS = 9;
const maskFrame = () => {
  const opaque = new Uint8Array(APERTURE * APERTURE);
  for (let y = 0; y < APERTURE; y++) {
    for (let x = 0; x < APERTURE; x++) {
      const d = Math.abs(x - APERTURE / 2) + Math.abs(y - APERTURE / 2);
      if (d <= RADIUS) opaque[y * APERTURE + x] = 1;
    }
  }
  return {
    width: APERTURE,
    height: APERTURE,
    posXraw: APERTURE / 2,
    posYraw: APERTURE / 2,
    indexed: new Uint8Array(APERTURE * APERTURE).fill(0),
    opaque,
  };
};

/**
 * The three call forms, as the shipped scripts write them — arm with four names,
 * drive with a packed point, tear down with none. Written as a script rather than
 * called through the interpreter's API because the discrimination under test is
 * between a STRING argument and a NUMERIC one, and that is a property of what the
 * compiler emits.
 */
const DRIVER = `code arm ()
\tplugin ("xray", "lit", "dark", "mask", "torch")
endcode

code aim (x, y)
\tplugin ("xray", makepoint (x, y), 3, makepoint (x, y), 3)
endcode

code disarm ()
\tplugin ("xray")
endcode

code hideall (flag)
\tprophide ("all", flag)
endcode

code askboot ()
\treturn (sendtobootfx (GameOpen2 ()))
endcode

code whichstage ()
\tglobal seenname, seenfile
\tseenname = currentstage ()
\tseenfile = result ()
endcode

code GameOpen2 ()
\treturn ("the flat answered")
endcode

code panelbutton ()
\tsendtoboot (endinterface ())
\treturn (variable ("closedby"))
endcode

code caseless ()
\tglobal gJournalTaken
\tgJournalTaken = 1
\tPlaysound ("ESTOUCHC", 255)
\treturn (Numtostring (gjournaltaken))
endcode

code CasedHandler ()
\treturn ("the handler answered")
endcode

code askcased ()
\treturn (sendtoflatfx ("dark", casedhandler ()))
endcode

code buildlamp ()
	propview ("Lantern", "GasKnob")
	propinstance ("Lantern", "GasKnob")
	propxy ("GasKnob", 200, 200)
	propvisible ("GasKnob", true)
	propview ("Lantern", "PumpHandle")
	propinstance ("Lantern", "PumpHandle")
	propxy ("PumpHandle", 400, 300)
	propvisible ("PumpHandle", true)
endcode

code camopen ()
\treturn (pluginfx ("camera", path (0)))
endcode

code camshoot (id, x, y)
\treturn (pluginfx ("camera", path (0), id, makepoint (x, y)))
endcode

code camshow (id)
\treturn (pluginfx ("camera", path (0), id))
endcode

code postjump ()
\tsendtopost (jumptoframe (873))
\treturn (variable ("landed"))
endcode

code viewfinder ()
\thidecursor ()
endcode

code putitback ()
\tshowcursor ()
endcode
`;

/**
 * One script for a whole family of props, dispatching on `me` — which is what
 * `propinstance` is for and what makes the instance's NAME load-bearing.
 */
const LANTERN_SCRIPT = `code setcursor (pt)
	switch (me)
		case "GasKnob"
			cursor ("touch")
		case "PumpHandle"
			cursor ("hand")
	endswitch
endcode

code mousedown (arg)
	global gGasKnob, gPumped
	switch (me)
		case "GasKnob"
			gGasKnob = gGasKnob + 1
		case "PumpHandle"
			gPumped = gPumped + 1
	endswitch
endcode
`;

async function scene(): Promise<{ session: GameSession; dir: ScreenDirector }> {
  const stg = buildStgBytes({
    palette: PALETTE,
    // the stage's own name, which is not its filename — see the test at the foot
    // of this file for why the difference is load-bearing
    refName: "interface",
    flats: [
      // "dark" is what the player sees; "lit" is the layer the light lets
      // through. Both in ONE stage file, which is how the discs store them —
      // `ab001.371` and `a0001.371` are both in `a027.stg`.
      { name: "dark", art: flatArt(1), script: compileScript(DRIVER) },
      { name: "lit", art: flatArt(2) },
    ],
  });
  const shp = buildShpBytes({
    palette: PALETTE,
    groups: [
      { name: "mask", states: [{ identifier: "still", frames: [{ art: maskFrame() }] }] },
      // one group, one script, told apart by `me` — the shape Timelapse's lantern
      // is built in (see the propinstance test at the foot of this file)
      {
        name: "Lantern",
        script: compileScript(LANTERN_SCRIPT),
        // one state per part, which is what `propview ("Lantern", "GasKnob")`
        // selects before the instance is taken off it
        states: [
          { identifier: "GasKnob", frames: [{ art: maskFrame() }] },
          { identifier: "PumpHandle", frames: [{ art: maskFrame() }] },
        ],
      },
    ],
  });
  const files = (name: string): Uint8Array | null =>
    name === "test.stg" ? stg : name === "test.shp" ? shp : null;
  const session = new GameSession(files, new NullAudioSink());
  await session.openShop("test.shp");
  await session.stageCtrl.openStageFile("test.stg");
  return { session, dir: new ScreenDirector(session, { width: W, height: H }) };
}

/** which palette slot is at (x, y) on the screen, read back through the gamma */
function slotAt(dir: ScreenDirector, x: number, y: number): "visible" | "hidden" | "other" {
  const o = (y * W + x) * 4;
  const [r, g, b] = [dir.screen.frame[o], dir.screen.frame[o + 1], dir.screen.frame[o + 2]];
  // slot 1 is blue-dominant, slot 2 red-dominant — compared by which channel wins
  // rather than by the raw triple, because the display gamma moves the values
  if (b > r && b > g) return "visible";
  if (r > g && r > b) return "hidden";
  return "other";
}

/**
 * Run one of {@link DRIVER}'s handlers on the flat's own script — `runHandler`
 * rather than `fireHandler` because these take arguments and answer values, and
 * `fireHandler` is the no-argument lifecycle path.
 */
const fire = async (session: GameSession, handler: string, args: (string | number)[] = []) => {
  const inst = session.flatScripts.get("dark")!;
  return (await session.interp.runHandler(inst, handler, args, { me: "dark", target: "" })).value;
};

test("an armed reveal draws nothing until it has been aimed", async () => {
  const { session, dir } = await scene();
  await fire(session, "arm");
  expect(session.plugins.xray?.hidden, "armed, and it kept the four names").toBe("lit");
  expect(session.plugins.xray?.mask).toBe("mask");
  expect(session.plugins.xray?.aimed).toBe(false);

  // `invpickup` arms before the pointer has been anywhere. Centring the aperture
  // on the prop's default anchor would flash a hole in the middle of the picture,
  // so an unaimed reveal is not drawn at all.
  expect(dir.paintWorldInto()).toBe("flat");
  expect(slotAt(dir, W / 2, H / 2)).toBe("visible");
});

test("the aimed aperture lets the hidden flat through, and only there", async () => {
  const { session, dir } = await scene();
  await fire(session, "arm");
  await fire(session, "aim", [200, 150]);
  expect(session.plugins.xray?.aimed).toBe(true);
  expect([session.plugins.xray?.x, session.plugins.xray?.y]).toEqual([200, 150]);

  dir.paintWorldInto();
  // dead centre of the aperture: the hidden flat
  expect(slotAt(dir, 200, 150)).toBe("hidden");
  // out to the diamond's points, on both axes — still inside
  expect(slotAt(dir, 200 + RADIUS, 150)).toBe("hidden");
  expect(slotAt(dir, 200, 150 - RADIUS)).toBe("hidden");
  // ...and its CORNERS, which are inside the frame's 20×20 bounds and outside the
  // shape the artist drew. This is the assertion that the reveal is a stencil and
  // not a blit of the frame's bounding box: |7| + |7| = 14, past the radius.
  expect(slotAt(dir, 200 + 7, 150 + 7), "a corner of the frame is not part of the hole").toBe("visible");
  expect(slotAt(dir, 200 - 7, 150 - 7)).toBe("visible");
  // and past the frame entirely, the picture
  expect(slotAt(dir, 200 + 11, 150)).toBe("visible");
  expect(slotAt(dir, 200, 150 - 11)).toBe("visible");
  expect(slotAt(dir, 20, 20)).toBe("visible");
});

test("the aperture moves with the light", async () => {
  const { session, dir } = await scene();
  await fire(session, "arm");
  await fire(session, "aim", [200, 150]);
  dir.paintWorldInto();
  expect(slotAt(dir, 200, 150)).toBe("hidden");

  await fire(session, "aim", [500, 300]);
  dir.paintWorldInto();
  expect(slotAt(dir, 500, 300), "the hole followed the light").toBe("hidden");
  expect(slotAt(dir, 200, 150), "and closed behind it").toBe("visible");
});

/**
 * ...and the frame is actually REPAINTED when it moves, which is a separate
 * claim and the one that needs `render` rather than `paintWorldInto`.
 *
 * `ScreenPresenter.shouldPaint` skips a present whose signature matches the one
 * already on the canvas, and a drag moves nothing else on the screen — not a
 * prop, not the flat, not the palette. So an aperture missing from the signature
 * gets painted once and then holds while the light moves, and every assertion in
 * the test above still passes, because they read the framebuffer rather than the
 * canvas. This one counts presents.
 */
test("a moved aperture is a repaint, not a matching signature", async () => {
  const { session, dir } = await scene();
  let presents = 0;
  // Enough of a 2D context for `blit`: the size it pins the backing store to,
  // somewhere to build an ImageData when node has no global one, and a count.
  // Sized to the screen up front on purpose — `blit` assigns `canvas.width` on a
  // mismatch, and the signature hashes it, so a stub starting at 0 spends its
  // first two renders on a legitimate resize repaint and never gets to the
  // question this test is asking.
  const ctx = {
    canvas: { width: W, height: H },
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {
      presents++;
    },
  } as unknown as CanvasRenderingContext2D;

  await fire(session, "arm");
  await fire(session, "aim", [200, 150]);
  dir.render(ctx);
  expect(presents).toBe(1);
  // nothing has changed: the second render must be free
  dir.render(ctx);
  expect(presents, "an unchanged screen is not presented twice").toBe(1);

  // ...and the point alone is enough to make it not free
  await fire(session, "aim", [500, 300]);
  dir.render(ctx);
  expect(presents, "the aperture is hashed, so moving it repaints").toBe(2);
});

test("a reveal reaches the right-hand column of a 640-wide screen", async () => {
  const { session, dir } = await scene();
  await fire(session, "arm");
  // x = 634, so the aperture's right edge is at 643 — past the screen, which the
  // blit must clip rather than wrap into the next row. And 634 is past the 512
  // this engine's framebuffer used to be fixed at.
  await fire(session, "aim", [634, 240]);
  dir.paintWorldInto();
  // on the diamond's horizontal axis, 5 px from its centre — inside the shape and
  // 122 px past the 512 this engine's framebuffer used to be fixed at
  expect(slotAt(dir, W - 1, 240)).toBe("hidden");
  expect(slotAt(dir, W - 1, 200), "clipped, not wrapped into another row").toBe("visible");
});

test("teardown closes the hole", async () => {
  const { session, dir } = await scene();
  await fire(session, "arm");
  await fire(session, "aim", [200, 150]);
  dir.paintWorldInto();
  expect(slotAt(dir, 200, 150)).toBe("hidden");

  await fire(session, "disarm");
  expect(session.plugins.xray).toBeNull();
  dir.paintWorldInto();
  expect(slotAt(dir, 200, 150)).toBe("visible");
});

/**
 * ...and a stage change closes it too, which no script guarantees. Timelapse's
 * own `leaveframe` disarms on the way out of the insect room, but a stage change
 * from anywhere else does not, and a reveal held across one names a flat the new
 * stage has never heard of.
 */
test("closing the stage file disarms the reveal", async () => {
  const { session } = await scene();
  await fire(session, "arm");
  await fire(session, "aim", [200, 150]);
  await session.stageCtrl.closeStageFile();
  expect(session.plugins.xray).toBeNull();
});

/**
 * `prophide("all", …)` — the blanket the BOOTFILE wraps a transition in, and the
 * reason it cannot be implemented by writing `visible`: what `ShowVisibleProps`
 * restores is what was visible BEFORE, so hiding must not lose that.
 *
 * It is a BROADCAST of the per-prop flag over what is visible at that instant,
 * not one global latched until it is cleared. `begininterface` hides and does
 * not show again until `endinterface`, and in between the panel builds its own
 * controls — `propvisible ("slider", true)`, `propdeg ("volume", wavevolume
 * ())`. A latch suppressed those for as long as the panel was open: the volume
 * dial and both slider knobs were never drawn, `propAt` never saw them, and the
 * drag loops in P.Shp (`while stilldown () … propxy (me, xloc, 215)`) could not
 * start. The sound settings did nothing you could aim.
 */
test("prophide(\"all\") suppresses drawing without forgetting what was up", async () => {
  const { session } = await scene();
  const mask = session.propRuntime.get("mask")!;
  mask.visible = true;
  await fire(session, "hideall", [1]);
  expect(mask.hidden, "suppressed").toBe(true);
  expect(mask.visible, "the script's own answer is untouched").toBe(true);

  await fire(session, "hideall", [0]);
  expect(mask.hidden, "released").toBe(false);

  // ...and a prop that was PUT AWAY when the blanket came down, then shown while
  // it is still down, is drawn. That is the panel's slider exactly —
  // `endinterface` left it invisible, `begininterface` hides, and the panel's
  // own `openflatx` shows it — and the whole of the difference between a
  // broadcast over what is visible and one global latch.
  mask.visible = false;
  await fire(session, "hideall", [1]);
  mask.visible = true;
  expect(mask.hidden, "shown during a hidden span, so not suppressed").toBe(false);

  await fire(session, "hideall", [0]);
  expect(mask.visible).toBe(true);
});

/**
 * The memory report, and the reason it is a small number rather than a large one.
 *
 * `minMemory` is not a quality setting: it picks between two implementations of
 * the turn handler, and only `lefttoframeMin` is built out of opcodes this port
 * has. Report a generous machine and Timelapse takes the `plugin("scrollflat")`
 * path, where nothing is implemented and turning stops changing the picture. So
 * the thresholds the BOOTFILE tests — `freemem() / 1024 < 3595` and `sysmem() /
 * 1024 < 10000` — are pinned here, in the game's own arithmetic.
 */
test("the memory report keeps Timelapse on the turn path this port implements", async () => {
  const { session } = await scene();
  const ask = async (src: string) => {
    const inst = session.instanceFrom(compileScript(`code ask ()\n\treturn (${src})\nendcode\n`), "ask")!;
    return (await session.interp.runHandler(inst, "ask", [], { me: "ask", target: "" })).value;
  };
  expect(await ask("freemem () / 1024 < 3595")).toBeTruthy();
  expect(await ask("sysmem () / 1024 < 10000")).toBeTruthy();
  // ...and they are REGISTERED, which the two lines above cannot tell on their
  // own: an unregistered builtin answers 0, and 0 is under both thresholds too.
  // So the flag came out right by accident before this, and a log line per boot
  // was the only sign either question had been asked.
  expect(await ask("freemem ()")).toBeGreaterThan(0);
  expect(await ask("sysmem () > freemem ()"), "a machine has more than is free of it").toBeTruthy();
});

/**
 * `sendtobootfx(GameOpen2())` — the SINGLE-argument form, where the target is
 * implicit, and the one place in the `sendto*` family where the `fx` suffix
 * changed which object answered.
 *
 * The dispatch loop chose the implicit target with `cmd === "sendtoboot"`, so the
 * `fx` spelling fell through to the STAGE. Timelapse asks it once, and it is the
 * last thing the game ever does: after the ending,
 *
 *     if questiondialog ("Would you like to open a saved game?")
 *         blackscreen ()
 *         if not sendtobootfx (GameOpen2 ())
 *             quit ()
 *
 * — so a call that reached the wrong object read as a refusal, and the game quit
 * on the player instead of offering the dialog. The decoy below is what makes
 * this a real test: the flat carries a `GameOpen2` of its own, answering
 * differently, so "did it reach the boot" cannot be confused with "did it reach
 * anything".
 */
/**
 * `sendtopost` addresses the BOOT's containers, and Timelapse has 110 of them.
 *
 * The dispatch loop registers it as a deferred form and then hands anything that
 * is not `sendtoboot` the STAGE as its implicit target — so all 110 resolved to a
 * script with no such handler and answered 0 without a word. Every one of the
 * seven handlers they name (`gotostage` 58 times, `jumptoframe` 29,
 * `righttoframe`, `lefttoframe`, `invdropcur`, `gototheme`, `invnewprop`) is
 * defined in the BOOTFILE library and nowhere else in the corpus, which is what
 * makes this unambiguous rather than a preference.
 *
 * What it looks like is the cave: the four views that approach the lantern each
 * carry a `Lantern` region whose entire mousedown is `sendtopost (jumptoframe
 * (873))`, so the lamp showed a `touch` cursor and clicking it did nothing.
 * Measured on the discs (i0090.867/.877/.967) — each now walks to i0090.873, and
 * before this stayed where it was. The other 58 are stage-to-stage moves.
 */
test("sendtopost reaches the boot library, where all of its handlers live", async () => {
  const { session } = await scene();
  session.bootScripts = [
    session.instanceFrom(compileScript('code keydown (k)\n\treturn (0)\nendcode\n'), "boot1")!,
    session.instanceFrom(
      compileScript('code jumptoframe (n)\n\tglobal landed\n\tlanded = n\nendcode\n'),
      "boot2",
    )!,
  ];
  expect(await fire(session, "postjump"), "the library's jumptoframe ran").toBe(873);
});

test("sendtobootfx addresses the boot, not the stage", async () => {
  const { session } = await scene();
  session.bootScripts = [
    session.instanceFrom(compileScript('code GameOpen2 ()\n\treturn ("the boot answered")\nendcode\n'), "boot")!,
  ];
  expect(await fire(session, "askboot")).toBe("the boot answered");
});

/**
 * `currentstage()` — the stage's own name, with its FILE in `result()`.
 *
 * Not one of the six missing opcodes: this one was REGISTERED and answering the
 * wrong string, which is the harder kind of gap to see. It answered the filename,
 * and on Titanic that is indistinguishable from the right answer because all
 * fifteen of its stages store their own filename in the name field. Timelapse's
 * `p.stg` is called `"interface"`, and its space bar is
 *
 *     if currentstage () = "interface"
 *         endinterface ()
 *     else
 *         begininterface (1)
 *
 * so the panel opened and could never close: the branch that puts it away could
 * not be reached. Measured in a browser before the fix — SPACE twice left the
 * game on `p.stg` both times.
 */
test("currentstage answers the stage's own name and result() the file", async () => {
  const { session } = await scene();
  await fire(session, "whichstage");
  expect(session.interp.globals.get("seenname")).toBe("interface");
  expect(session.interp.globals.get("seenfile"), "the file is still reachable").toBe("test.stg");
});

/**
 * ...and a stage with no name of its own falls back to the file, which is what
 * keeps Dust exactly as it was. A v1 `.FLT` has no name field at all — 2104 is its
 * first FLAT RECORD — and its only question of this builtin is `currentstage() !=
 * "none"`, a sentinel that lives outside the file entirely.
 */
test("an unnamed stage falls back to its filename, and a closed one to \"none\"", async () => {
  const bytes = buildStgBytes({
    palette: PALETTE,
    flats: [{ name: "dark", art: flatArt(1), script: compileScript(DRIVER) }],
  });
  const session = new GameSession((n) => (n === "plain.stg" ? bytes : null), new NullAudioSink());
  await session.stageCtrl.openStageFile("plain.stg");
  await fire(session, "whichstage");
  expect(session.interp.globals.get("seenname")).toBe("plain.stg");

  await session.stageCtrl.closeStageFile();
  expect(session.stageCtrl.stageRefName()).toBe("");
  expect(session.stageName).toBe("none");
});

/**
 * `sendtoboot` addresses THE BOOT — every container of it, not just the first.
 *
 * A BOOTFILE is a stack of script containers: container 1 the boot proper,
 * container 2 the library. `GameSession.boot` is container 1, because that is
 * where the entry points a host calls live, and TAOOT never showed the
 * difference — all six things its scripts `sendtoboot` are container 1's.
 *
 * Timelapse's interface family is container 2's: `endinterface` (11 call sites),
 * `begininterface` (4), `docamera` (2). Every one of them dead-ended on
 * container 1 having no such handler, and the panel's buttons ARE those call
 * sites. Clicking the camera ran its `mousedown` (P.Stg container 6), set
 * `retinter`, and then asked the boot to close the panel and take the picture:
 * both asks resolved to a script that could not answer, so the panel sat there
 * doing nothing. Same for the journal, the photo album, the gene pod, and the
 * `ok` that leaves the panel.
 *
 * Two containers here, and only the second can answer — which is the shape of
 * the real BOOTFILE and the thing that was not being walked.
 */
test("sendtoboot reaches the boot LIBRARY, not just its first container", async () => {
  const { session } = await scene();
  session.bootScripts = [
    session.instanceFrom(
      compileScript('code keydown (k)\n\treturn ("container one")\nendcode\n'),
      "boot1",
    )!,
    session.instanceFrom(
      compileScript('code endinterface ()\n\tglobal closedby\n\tclosedby = "the library answered"\nendcode\n'),
      "boot2",
    )!,
  ];
  expect(await fire(session, "panelbutton")).toBe("the library answered");
  // ...and container one still wins for a handler it HAS: `keydown` is defined in
  // both containers of the real BOOTFILE and its 24,349 call sites have always
  // reached the first, so the fallback must not move them.
  session.interp.globals.set("closedby", "");
  const one = session.instanceFrom(
    compileScript('code go ()\n\treturn (sendtoboot (keydown ("right")))\nendcode\n'),
    "go",
  )!;
  expect(
    (await session.interp.runHandler(one, "go", [], { me: "go", target: "" })).value,
    "a handler container one has is still container one's",
  ).toBe("container one");
});

/**
 * Names fold case — variables, commands and handlers alike — because the
 * language does and the shipped scripts rely on it.
 *
 * Timelapse's journal is what this cost. Its pickup (i001.stg container 1742) is
 *
 *     global debugging, gJournalTaken
 *     Playsound ("ESTOUCHC", 255)
 *     gJournalTaken = 1
 *     gotoflat (baseflat)
 *
 * and every reader of that global is lowercase: the `enterframe` on flats 348
 * and 350 (`if gjournaltaken != 1: gotoflat (baseflat @ ".2")`), the panel's
 * `dojournal`, and the BOOTFILE's own `gjournaltaken = 0`. So the pickup wrote a
 * second, private variable. The journal left the ground while you stood there —
 * `gotoflat (baseflat)` is unconditional — and was lying there again the moment
 * you walked away and back, because `enterframe` still read 0. Reported from
 * play as "I can pick the journal up but I never have it".
 *
 * `Playsound` in the same four lines is the same fault one layer along: the
 * registry is keyed by the opcode table's lowercase name, so the capitalised
 * spelling reached no builtin and no handler and was logged as an unknown
 * command. That is the pickup that made no sound.
 *
 * The camera two flats away (container 1733) spells both `gCameraTaken` and
 * `playsound` the way everything else does, and worked — which is exactly what
 * made these look like unrelated bugs.
 */
test("a name is a name whatever its case: variables, commands and handlers", async () => {
  const { session } = await scene();
  // the boot initialises the lowercase spelling, as Timelapse's does, and its
  // LIBRARY carries `PlaySound` — which is a handler, not an engine builtin
  session.interp.globals.set("gjournaltaken", 0);
  session.bootScripts = [
    session.instanceFrom(compileScript('code keydown (k)\n\treturn (0)\nendcode\n'), "boot1")!,
    session.instanceFrom(
      compileScript('code PlaySound (sound, volume)\n\tglobal heard\n\theard = sound\nendcode\n'),
      "boot2",
    )!,
  ];
  session.interp.fallbackScripts = session.bootScripts;

  // the pickup, in the shape the disc has it: capitalised global, capitalised
  // command, and a lowercase read of the same name
  expect(
    await fire(session, "caseless"),
    "the lowercase reader sees the write, through a capitalised builtin",
  ).toBe("1");
  expect(session.interp.globals.get("gjournaltaken"), "one variable, not two").toBe(1);
  expect(
    session.interp.globals.get("heard"),
    "`Playsound` found the library's `PlaySound` — the pickup is not silent",
  ).toBe("ESTOUCHC");

  // ...and a handler, which is how `sendtoflat (…, openflatx ())` finds the
  // panel's `openFlatX`
  expect(await fire(session, "askcased")).toBe("the handler answered");
});

/**
 * `plugin("camera", …)` — the shutter, the album, and the one answer the shutter
 * is allowed to give.
 *
 * The contract and the geometry are `engine/src/runtime/photos.ts`, read out of
 * `tz.dll`: a photograph is 320x240, the album draws it at (160, 120) — the
 * rect at 0x140016af, written top/left/bottom/right as this engine writes every
 * rect — and the three forms are told apart by argument count. The script agrees
 * from its own side: `docamera` clamps the viewfinder to x in [160, 480] and y in
 * [120, 360], which is exactly where a 320x240 window's CENTRE can sit on a
 * 640x480 screen.
 *
 * The one that needs a test rather than a comment is the SAVE's answer. It is
 * read inside a `while true`:
 *
 *     rand = random (32000)
 *     variable ("pic" @ numtostring (pictotal), rand)
 *     if pluginfx ("camera", path (0), rand, arg) = 0
 *
 * so non-zero means "that id is taken, roll another" and nothing else. Any other
 * refusal — a store that will not open, a screen too small to grab — spins the
 * game inside the shutter forever, which is why those answer 0 and let the album
 * be empty instead.
 */
/** run a line of script on a session, for the tests that need one directly */
const go2 = (session: GameSession, src: string) =>
  session.interp.runHandler(
    session.instanceFrom(compileScript(`code go ()\n${src}\nendcode\n`), "go")!,
    "go", [], { me: "go", target: "" },
  );

test("the camera: a shot is 320x240 from where it was aimed, and lands where tz.dll draws it", async () => {
  const s = await scene();
  const { session, dir } = s;
  const ctx = stubCtx();
  // a picture to photograph, and a marker band so the grab's ORIGIN is checkable
  await session.stageCtrl.gotoFlat("dark");
  dir.render(ctx);
  const frame = dir.screen.frame;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      // a gradient across the screen: every column a different red
      frame[o] = (x >> 1) & 0xff;
      frame[o + 1] = y & 0xff;
      frame[o + 2] = 0;
    }
  }

  expect(await fire(session, "camopen"), "the album opens with no store behind it").toBe(CAMERA_OK);

  // aimed dead centre, which is the middle of the viewfinder's own range
  expect(await fire(session, "camshoot", [4242, 320, 240])).toBe(CAMERA_OK);
  const shot = session.photos.get(4242)!;
  expect(shot, "the shot is in the album").toBeTruthy();
  expect([shot.width, shot.height]).toEqual([PHOTO_W, PHOTO_H]);
  // its top-left is the screen's (160, 120) — the window is CENTRED on the aim
  expect(shot.rgba[0], "sourced from x=160, not from the screen's edge").toBe((160 >> 1) & 0xff);
  expect(shot.rgba[1]).toBe(120 & 0xff);

  // ...and aimed elsewhere it is a different 320x240 window
  expect(await fire(session, "camshoot", [7, 480, 360])).toBe(CAMERA_OK);
  expect(session.photos.get(7)!.rgba[0], "sourced from x=320").toBe((320 >> 1) & 0xff);

  // the ONE refusal: an id already used. `docamera` rolls another and retries.
  expect(await fire(session, "camshoot", [4242, 300, 200]), "that id is taken").not.toBe(CAMERA_OK);
  expect(session.photos.photos.size, "and nothing was overwritten").toBe(2);

  // DISPLAY: a photo the album does not have is the script's "not in photo album"
  // black from this instant, no ramp to tick
  await go2(session, '\tblackscreen ()');
  expect(await fire(session, "camshow", [999])).toBe(CAMERA_NO_PHOTO);
  expect(session.photoOverlay, "and nothing is put on screen for it").toBeNull();
  expect(session.fade.level, "...and a photo that is not there lights nothing").not.toBe(0);

  // ...and one it does have goes up at the rect the DLL draws it in
  expect(await fire(session, "camshow", [4242])).toBe(CAMERA_OK);
  expect(session.photoOverlay?.x).toBe(PHOTO_X);
  expect(session.photoOverlay?.y).toBe(PHOTO_Y);
  expect(session.photoOverlay?.photo).toBe(shot);

  // showing it also LIGHTS the album: both doors into the album flat dim the
  // screen on the way in and its own openflatx never calls blacktoscreen, so
  // the photograph's arrival is what lifts it (see the note on the display form)
  expect(session.fade.level, "the album is lit by the photograph landing").toBe(0);

  // it is part of the PICTURE, not an overlay on the canvas: a script that
  // captures the screen after this captures the photograph too
  dir.render(ctx);
  const at = (x: number, y: number) => {
    const o = (y * W + x) * 4;
    return [dir.screen.frame[o], dir.screen.frame[o + 1], dir.screen.frame[o + 2]];
  };
  expect(at(PHOTO_X, PHOTO_Y), "the photo's own first pixel, in the framebuffer")
    .toEqual([shot.rgba[0], shot.rgba[1], shot.rgba[2]]);
  // ...and the flat is still the flat outside it
  expect(at(PHOTO_X - 8, PHOTO_Y - 8)).not.toEqual([shot.rgba[0], shot.rgba[1], shot.rgba[2]]);

  // a flat change puts the album away, so a photograph cannot float over the
  // next picture (the same rule the text layer follows)
  await session.stageCtrl.gotoFlat("lit");
  expect(session.photoOverlay).toBeNull();
});

/**
 * The album is HYDRATED from the store, and a store that fails costs
 * persistence and nothing else.
 *
 * The shutter's retry loop is the reason: an `open` that reported failure would
 * reach `cameraerror(err, 3)` and tell the player their camera is broken, and a
 * `save` that did would spin. So a broken store is logged, dropped, and the
 * session carries on with an album that works until the page closes.
 */
test("the camera: photos come back from the store, and a broken store is not fatal", async () => {
  const photo = (fill: number): Photo => ({
    rgba: new Uint8ClampedArray(PHOTO_W * PHOTO_H * 4).fill(fill),
    width: PHOTO_W,
    height: PHOTO_H,
  });

  const kept = new Map<number, Photo>([[11, photo(60)], [22, photo(90)]]);
  const good = await scene();
  const puts: number[] = [];
  good.session.photos.store = {
    all: async () => new Map(kept),
    put: async (id, p) => { puts.push(id); kept.set(id, p); },
  } satisfies PhotoStore;

  good.dir.render(stubCtx());
  expect(await fire(good.session, "camopen")).toBe(CAMERA_OK);
  expect([...good.session.photos.photos.keys()].sort((a, b) => a - b), "hydrated").toEqual([11, 22]);
  // an id the STORE already holds is taken, which is the point of hydrating
  // before the shutter rolls one
  expect(await fire(good.session, "camshoot", [11, 320, 240])).not.toBe(CAMERA_OK);
  good.dir.render(stubCtx());
  expect(await fire(good.session, "camshoot", [33, 320, 240])).toBe(CAMERA_OK);
  expect(puts, "a new shot is written through").toEqual([33]);

  const bad = await scene();
  const logs: string[] = [];
  bad.session.onLog = (l) => logs.push(l);
  bad.session.photos.onLog = (l) => logs.push(l);
  bad.session.photos.store = {
    all: async () => { throw new Error("site data is blocked"); },
    put: async () => { throw new Error("quota exceeded"); },
  } satisfies PhotoStore;

  expect(await fire(bad.session, "camopen"), "a store that will not open is still no error").toBe(CAMERA_OK);
  bad.dir.render(stubCtx());
  expect(await fire(bad.session, "camshoot", [5, 320, 240]), "and the shot is still taken").toBe(CAMERA_OK);
  expect(bad.session.photos.get(5), "kept for this session").toBeTruthy();
  expect(logs.some((l) => /store could not be read/.test(l)), `said so: ${logs.join(" | ")}`).toBe(true);
});

/**
 * A stage swap un-fades the screen, which is what makes the photo album visible
 * at all.
 *
 * `screentoblack(name, steps)` ramps a named CLUT to black, and the name
 * Timelapse hands it over a stage is `curclutname` — `"stage"`. `begininterface`
 * then throws that stage away: `closestagefile ()`, `openstagefile ("P.Stg")`.
 * The palette the ramp was against is gone, so the ramp cannot survive it.
 *
 * Three of the panel's four flats end their `openflatx` with `blacktoscreen` and
 * would not have noticed. The photo album (flat 3, container 32) does not — its
 * `openflatx` checks the film count and arms `makeloop ("flat", me,
 * "updateflat", 2)`, nothing else — so a level that outlived the swap left the
 * album's furniture, its caption and the photograph painted correctly into a
 * framebuffer nobody could see. Reported from play as the album being black.
 *
 * `blacktoscreen` therefore reveals FROM black rather than from wherever the
 * level happens to be, or clearing it here would turn every overlay's fade-in
 * into a pop.
 */
test("opening a stage file lifts the fade the old stage's palette was under", async () => {
  const one = buildStgBytes({ palette: PALETTE, flats: [{ name: "world", art: flatArt(1) }] });
  const two = buildStgBytes({ palette: PALETTE, flats: [{ name: "album", art: flatArt(2) }] });
  const session = new GameSession(
    (n) => (n === "one.stg" ? one : n === "two.stg" ? two : null),
    new NullAudioSink(),
  );
  await session.stageCtrl.openStageFile("one.stg");
  await session.stageCtrl.gotoFlat("world");
  const go = (src: string) =>
    session.interp.runHandler(
      session.instanceFrom(compileScript(`code go ()\n${src}\nendcode\n`), "go")!,
      "go", [], { me: "go", target: "" },
    );
  /** run the fade ramp to its end, on the engine's own 60 Hz tick */
  let clock = 0;
  const ramp = () => { for (let i = 0; i < 240 && session.fade.queue.length; i++) session.tickFade((clock += 17)); };

  await go('\tscreentoblack ("stage", 4)');
  ramp();
  expect(session.fade.level, "the screen went black").toBe(1);

  // the stage the ramp was against is replaced, so the ramp goes with it
  await session.stageCtrl.openStageFile("two.stg");
  expect(session.fade.level, "and the new stage is not under it").toBe(0);
  expect(session.fade.snapshot, "nor is the old screen still being held").toBeNull();

  // ...and a flat that DOES ask for its fade-in still gets one, which is why
  // this is safe: the reveal starts from black rather than from where it is
  await go('\tblacktoscreen ("stage", 4)');
  expect(session.fade.level, "revealing FROM black rather than from nothing").toBeGreaterThan(0);
  ramp();
  expect(session.fade.level, "...and arriving at the picture").toBe(0);
});

/**
 * `propinstance` copies make several props out of ONE sprite group, and the
 * script that serves them all tells them apart by `me`.
 *
 * Timelapse's paraffin lantern is the case. Its `enterframe` (i005.stg container
 * 209) builds six props out of the "Lantern" group —
 *
 *     propview ("Lantern", "GasKnob")
 *     propinstance ("Lantern", "GasKnob")
 *     propxy ("GasKnob", 320, 240)
 *     propdeg ("GasKnob", gGasKnob)
 *     propvisible ("GasKnob", true)
 *
 * and the same for TopLight, MantelLight, LampSway, PrimeLever and PumpHandle.
 * All six share the group's script (I.Shp container 310), whose every handler
 * opens `switch (me)` on those names.
 *
 * Three things had to line up and none of them did:
 *
 *   1. `hittest` answered the GROUP's name, so the boot's `mousedown` dispatched
 *      `sendtoprop ("Lantern", …)` for whichever part was under the pointer.
 *   2. `propScripts` is keyed by group — correctly, that is where a sprite's
 *      script lives — so an event addressed to "GasKnob" resolved nothing at all.
 *   3. `me` was the running SCRIPT's name, so even once it arrived the switch was
 *      matched against "Lantern" and fell through every case.
 *
 * What that is from the player's side is a lamp with no cursor over any of its
 * parts that does nothing when any of them is clicked, which is how it was
 * reported. Everywhere else in the corpus a prop's name and its group's are the
 * same string, which is why two engines' worth of games never showed it.
 */
test("propinstance: each copy is addressed by its OWN name, on the group's script", async () => {
  const { session, dir } = await scene();
  const ctx = stubCtx();
  await session.stageCtrl.gotoFlat("dark");

  // build two props out of the one group, as the lantern's enterframe does
  await fire(session, "buildlamp");
  const knob = session.propRuntime.get("GasKnob")!;
  const pump = session.propRuntime.get("PumpHandle")!;
  expect(knob, "the instance exists").toBeTruthy();
  expect(knob.group.name, "...out of the group's sprite").toBe("Lantern");
  expect(knob.name, "...under the name the script gave it").toBe("GasKnob");

  // 1. hittest names the INSTANCE, which is what the boot dispatches on
  dir.render(ctx);
  const at = (p: typeof knob) => {
    const f = p.shop.frame(p.currentFrame(p.state()!));
    // the CENTRE of the sprite: the mask art is a diamond, so its corners are
    // inside the frame rect and outside the shape
    return [
      p.anchorX - f.posXraw + (f.width >> 1),
      p.anchorY - f.posYraw + (f.height >> 1),
    ] as const;
  };
  expect(session.hitTestAt?.(...at(knob))).toEqual({ name: "GasKnob", type: "prop" });
  expect(session.hitTestAt?.(...at(pump))).toEqual({ name: "PumpHandle", type: "prop" });

  // 2 + 3. the event finds the GROUP's script and runs it with `me` set to the
  // instance, so the switch inside it matches
  session.interp.globals.set("gGasKnob", 0);
  session.interp.globals.set("gPumped", 0);
  await session.sendEvent("sendtoprop", "GasKnob", "mousedown", [0], "test");
  expect(session.interp.globals.get("gGasKnob"), "the knob's own case ran").toBe(1);
  expect(session.interp.globals.get("gPumped"), "and only that one").toBe(0);

  await session.sendEvent("sendtoprop", "PumpHandle", "mousedown", [0], "test");
  expect(session.interp.globals.get("gPumped")).toBe(1);
  expect(session.interp.globals.get("gGasKnob"), "unchanged by the other part").toBe(1);

  // ...including the cursor, which is the only feedback that a part is live
  session.setPointer(...at(knob));
  expect(await dir.hover(...at(knob)), "the knob asks for its own cursor").toBe("touch");
  expect(await dir.hover(...at(pump))).toBe("hand");
});

/**
 * `hidecursor()`, and it is a COUNTER.
 *
 * Timelapse takes the pointer away in exactly three places, and all three are
 * places where it draws its own instead: the bow being drawn (`a.shp`'s
 * `mousedown`, a `while stilldown()` with the arrow prop following the mouse),
 * the camera's viewfinder bevel (`docamera`'s `while not button()`, which is the
 * `cambev` prop following it), and the endgame. So what the player should see
 * there is the prop and nothing else — the port drew a hand over all three.
 *
 * The counter is the original's: `tl.exe` 0x4087b0 is `ShowCursor(FALSE)` and a
 * decrement of its own tally at 0x45b418, 0x408790 the increment, and Windows'
 * rule is that the cursor is visible at zero and above. Which makes the ending's
 * unmatched `hidecursor()` the interesting case — see the restart below.
 */
test("hidecursor/showcursor: a depth, and the pointer comes back on a restart", async () => {
  const { session, dir } = await scene();
  const ctx = stubCtx();
  await session.stageCtrl.gotoFlat("dark");
  await fire(session, "buildlamp");
  dir.render(ctx);
  const knob = session.propRuntime.get("GasKnob")!;
  const f = knob.shop.frame(knob.currentFrame(knob.state()!));
  const at = [knob.anchorX - f.posXraw + (f.width >> 1), knob.anchorY - f.posYraw + (f.height >> 1)] as const;
  expect(await dir.hover(...at), "the prop answers while the pointer is visible").toBe("touch");

  // hidden: the chain is not even asked, and the answer is the name of the
  // game's own blank cursor rather than a new word a shell would have to learn
  await fire(session, "viewfinder");
  expect(session.cursorHidden).toBe(true);
  expect(await dir.hover(...at)).toBe("none");

  // nested, which is why a flag would not do: two hides need two shows
  await fire(session, "viewfinder");
  await fire(session, "putitback");
  expect(session.cursorHidden, "one show does not undo two hides").toBe(true);
  await fire(session, "putitback");
  expect(session.cursorHidden).toBe(false);
  expect(await dir.hover(...at), "and the prop is asked again").toBe("touch");

  // ...and the endgame's hide, which the scripts never balance because the game
  // is over. The original winds its own counter back at two boundaries; here it
  // is the restart, or a new game would begin with an invisible pointer.
  await fire(session, "viewfinder");
  expect(session.cursorHidden).toBe(true);
  await session.prepareRestart();
  expect(session.cursorDepth, "the restart puts it back").toBe(0);
});
