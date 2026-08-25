/**
 * A stage that moves on its own — and the two things that were stopping it.
 *
 *   npx vitest run engine/tests/flat-anim.ts
 *
 * *Timelapse* animates a stage by walking a RUN OF FLATS: `flatstartanim(2, 54,
 * "FlatAnimDone()", 8)` shows `i0001.100.2`, `.3`, `.4` … at 8 fps and then calls
 * back. There are **433** such calls on its four discs and none at all on the
 * other two, so this is a whole mode of the engine that a port recovered from
 * Titanic and Dust never had to run — and did not.
 *
 * What it looked like was a game of still photographs. The opening shot is a
 * flock of birds that lifts off as you arrive; they never moved, and neither did
 * anything else on any of the 156 stages.
 *
 * Neither cause is about animation, which is why both are pinned here rather than
 * in a Timelapse-shaped test: one is a name folded to lower case and one is an
 * event that could not reach the script that answers it. Both are the engine's,
 * and one of them was silently costing Dust a loop too.
 *
 * No game data: the stage, the shop and the boot below are authored here.
 */
import { test, expect } from "vitest";
import { writeContainerFile } from "@dreamfactory/engine/df/container";
import { readStgFile } from "@dreamfactory/engine/df/stg";
import { buildStgBytes } from "@dreamfactory/engine/df/stg-build";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";

const W = 32;
const H = 24;
const PALETTE = new Uint8Array([0, 0, 0, 40, 80, 160]);
const art = () => ({ pixels: new Uint8Array(W * H).fill(1), width: W, height: H });

/**
 * The shape of Timelapse's opening shot, reduced to what matters: a flat whose
 * `enterframe` arms a loop on a CamelCase callback, and a boot that owns the
 * routine which walks the frames.
 */
const FLAT = `code enterframe ()
\tglobal armed
\tarmed = 1
\tmakeloop ("flat", "shot", "DelayBirds", 1)
endcode

code DelayBirds ()
\tglobal birdsflew
\tbirdsflew = 1
\tflattick ()
endcode
`;

/**
 * The boot library: `flattick` lives HERE, as it does in the real BOOTFILE, and
 * it walks the cels exactly the way that one does — `gotoflat` to the next, then
 * re-arm itself on the BASE flat's name.
 *
 * The counter is `cel` and not `step`, which cost a while to see: `step` is an
 * opcode name, so `step = step + 1` parses as an assignment to a call and takes
 * the whole container down with it. A fixture that silently defines no handlers
 * fails the same way a missing fallback does.
 */
const BOOT = `code flattick ()
\tglobal cel
\tcel = cel + 1
\tif cel < 4
\t\tgotoflat ("shot." @ numtostring (cel))
\t\tmakeloop ("flat", "shot", "flattick", 1)
\tendif
endcode
`;

async function scene(): Promise<GameSession> {
  const stg = buildStgBytes({
    palette: PALETTE,
    flats: [
      { name: "shot", art: art(), script: compileScript(FLAT) },
      // the animation cels: real flats with NO script of their own, which is what
      // the shipped ones are and the whole reason the walk could not continue
      { name: "shot.1", art: art() },
      { name: "shot.2", art: art() },
      { name: "shot.3", art: art() },
    ],
  });
  const session = new GameSession((n) => (n === "test.stg" ? stg : null), new NullAudioSink());
  session.bootScripts = [session.instanceFrom(compileScript(BOOT), "boot")!];
  session.refreshFallbacks();
  await session.stageCtrl.openStageFile("test.stg");
  return session;
}

/**
 * Run the scheduler for `n` engine steps.
 *
 * The clock is MONOTONIC across calls, held in the returned closure: `tickTime`
 * derives its step count from how far the clock has moved, so a pump that
 * restarted at 50 ms each time would advance time exactly once and then never
 * again — which looks precisely like a loop that fires once and stops, the very
 * bug under test.
 */
function pumper(session: GameSession): (n: number) => Promise<void> {
  let now = 0;
  return async (n: number) => {
    for (let i = 0; i < n; i++) {
      now += 50;
      session.scheduler.tickTime(now);
      session.scheduler.serviceFrameLoops();
      await session.settle();
    }
  };
}

/**
 * A `makeloop` callback keeps the case it was written in.
 *
 * `makeLoop` folded the handler to lower case along with the kind and the name,
 * and those are two different kinds of name: kind and name are MATCHED (by
 * `stopLoop`, `isLoop`, and `makeLoop`'s own replacement) and the corpus spells
 * them freely, but a handler is CALLED — it ends at `Script.codes.get(handler)`,
 * whose keys are stored exactly as the 1996 compiler wrote them.
 *
 * Titanic hid it completely: all 67 of its loop callbacks are lower case, so the
 * fold was the identity. Timelapse names 9 of its 34 in CamelCase — `DelayBirds`,
 * `RunFire`, `TurnEyes`, `BridgeUp` — and Dust one, `SOUNDFXS`, which is
 * CHIN.SET's ambient sound loop re-arming itself in Chinatown.
 */
test("a loop callback with a capital letter is still found", async () => {
  const session = await scene();
  await session.stageCtrl.gotoFlat("shot");
  await session.interp.runHandler(session.flatScripts.get("shot")!, "enterframe", [], {
    me: "shot",
    target: "",
  });
  expect(session.interp.globals.get("armed"), "the loop was armed").toBe(1);
  // and it is stored as written, not folded
  expect(session.scheduler.loops.map((l) => l.handler)).toEqual(["DelayBirds"]);

  await pumper(session)(4);
  expect(session.interp.globals.get("birdsflew"), "the callback resolved and ran").toBe(1);
});

/**
 * ...and a flat loop reaches a handler the BOOT owns.
 *
 * `flattick` calls `gotoflat` and then re-arms itself, and a flat loop fires on
 * the CURRENT flat (`Scheduler.fireLoop`) — which by the second frame is an
 * animation cel with no script at all. A flat with no script of its own resolves
 * to its STAGE, so the chain was never empty; it simply had no link that knew the
 * handler, and the walk stopped one frame in.
 */
test("a flat loop whose handler is the boot's walks the whole run", async () => {
  const session = await scene();
  await session.stageCtrl.gotoFlat("shot");
  await session.interp.runHandler(session.flatScripts.get("shot")!, "enterframe", [], {
    me: "shot",
    target: "",
  });

  // seeded with where it starts: the first pump already fires the armed loop, so
  // sampling only after it would miss the flat the run began on
  const seen: string[] = [session.currentFlat];
  const pump = pumper(session);
  for (let i = 0; i < 20; i++) {
    await pump(1);
    if (seen[seen.length - 1] !== session.currentFlat) seen.push(session.currentFlat);
  }
  // every cel, in order — the assertion that the loop kept re-arming from a flat
  // that could not answer for it
  expect(seen).toEqual(["shot", "shot.1", "shot.2", "shot.3"]);
  expect(session.interp.globals.get("cel")).toBe(4);
});

/**
 * The gate that keeps the two games that were fine, fine: the boot is only
 * consulted when nothing already in the chain has the handler.
 *
 * A flat that answers for itself must never be overridden by a boot routine of
 * the same name — the boot is a LIBRARY behind the object, not in front of it.
 */
test("a flat that answers for itself is not overridden by the boot", async () => {
  const session = await scene();
  const own = `code enterframe ()
\tglobal who
\twho = "the flat"
endcode
`;
  const boot = `code enterframe ()
\tglobal who
\twho = "the boot"
endcode
`;
  session.bootScripts = [session.instanceFrom(compileScript(boot), "boot")!];
  session.flatScripts.set("shot", session.instanceFrom(compileScript(own), "shot")!);
  session.refreshFallbacks();
  await session.sendEvent("sendtoflat", "shot", "enterframe", [], "shot");
  expect(session.interp.globals.get("who")).toBe("the flat");
});

// ---------------------------------------------------------------------------
// The cels are DELTAS, and they are decoded over the flat they belong to
// ---------------------------------------------------------------------------

/**
 * A frame that changes ONE ROW and keeps the rest, hand-assembled.
 *
 * `encodeFrame` only writes keyframes, so a delta has to be built by hand — and
 * it is four bytes of header and one byte per row, which is little enough to be
 * legible: `rowMode 10` is "keep this row from the previous image", and the row
 * that does change asks for a run of `runMode 6`, "fill with the byte that
 * follows".
 *
 * This is the shape of every one of Timelapse's animation cels. Nothing else in
 * the three corpora is encoded this way, which is why decoding each flat into a
 * fresh buffer went unnoticed for two whole games.
 */
function deltaRow(width: number, height: number, changedRow: number, value: number): Uint8Array {
  const out: number[] = [height & 0xff, height >> 8, width & 0xff, width >> 8];
  for (let y = 0; y < height; y++) {
    if (y !== changedRow) {
      out.push(10 << 2); // keep the row from the previous image
      continue;
    }
    out.push(0); // no whole-row mode: the row is a sequence of runs
    // runMode 6 = "fill with the byte that follows". The count is five bits and
    // escapes to a whole second byte at 32 — which W is exactly, so writing it
    // inline would overflow into the mode bits and decode as something else.
    if (width < 32) out.push((width << 3) | 6);
    else out.push(6, width - 32);
    out.push(value);
  }
  return new Uint8Array(out);
}

/** a stage whose second flat is that delta over the first */
function deltaStage(): Uint8Array {
  const bytes = buildStgBytes({
    palette: PALETTE,
    flats: [
      { name: "base", art: art() },
      { name: "cel", art: art() },
    ],
  });
  const stg = readStgFile(bytes);
  const loc = stg.flats[1].locationFrame;
  stg.file.containers[loc] = { id: stg.file.containers[loc].id, data: deltaRow(W, H, 3, 2) };
  return writeContainerFile(stg.file);
}

/**
 * The cel is decoded over the flat it follows, so the pixels it does not mention
 * are the ones that were already there.
 *
 * Decoded cold — into `new FrameBuffer()`, which is what this did — every row the
 * cel keeps comes out index 0. On the real discs that is the whole picture minus
 * the birds, and it is why the opening shot went black the moment the animation
 * was made to run at all.
 */
test("a delta cel keeps the pixels it does not mention", async () => {
  const bytes = deltaStage();
  const session = new GameSession((n) => (n === "d.stg" ? bytes : null), new NullAudioSink());
  await session.stageCtrl.openStageFile("d.stg");
  await session.stageCtrl.gotoFlat("base");
  expect(session.stageCtrl.flatImage()!.pixels.every((p) => p === 1)).toBe(true);

  await session.stageCtrl.gotoFlat("cel");
  const img = session.stageCtrl.flatImage()!;
  // the row the cel DOES mention
  expect([...img.pixels.subarray(3 * W, 4 * W)].every((p) => p === 2)).toBe(true);
  // ...and every row it does not, which is the assertion that carries the fix
  expect([...img.pixels.subarray(0, 3 * W)].every((p) => p === 1), "kept, not blacked").toBe(true);
  expect([...img.pixels.subarray(4 * W)].every((p) => p === 1)).toBe(true);
});

/**
 * ...and a KEYFRAME is unaffected by whatever was underneath it, which is the
 * claim that keeps Titanic and Dust exactly as they were.
 *
 * Neither game animates a stage; every flat they own is a whole picture, and a
 * whole picture writes every pixel. Seeding the buffer from the outgoing flat can
 * therefore only be seen by art that deliberately leaves pixels alone.
 */
test("a keyframe decodes the same whatever preceded it", async () => {
  const bytes = deltaStage();
  const session = new GameSession((n) => (n === "d.stg" ? bytes : null), new NullAudioSink());
  await session.stageCtrl.openStageFile("d.stg");

  // reached directly...
  await session.stageCtrl.gotoFlat("base");
  const cold = Uint8Array.from(session.stageCtrl.flatImage()!.pixels);
  // ...and reached after the cel has dirtied the buffer with a row of 2s
  await session.stageCtrl.gotoFlat("cel");
  await session.stageCtrl.gotoFlat("base");
  expect(Uint8Array.from(session.stageCtrl.flatImage()!.pixels)).toEqual(cold);
});

/**
 * `gotoflat` sends a flat's lifecycle events along the CHAIN, so a boot library's
 * DEFAULT `openflat`/`closeflat` gets them.
 *
 * These used to go straight at the flat's own script, so a flat with no handler
 * was the end of it — right for two games and wrong for the third. Timelapse's
 * BOOTFILE holds the defaults, and they are what keep the game's own idea of
 * where it is up to date: `openflat` sets `baseflat = currentflat()` and calls
 * `PatchEnterFrame`, `closeflat` clears it and calls `PatchLeaveFrame`, and those
 * two patches are what fire a frame's `enterframe`/`leaveframe`.
 *
 * Without them a move WITHIN a stage left `baseflat` pointing at whichever flat
 * the stage was entered on, and no frame ever got its `enterframe`. Since
 * `flatstartanim` animates `baseflat`, the sea off the opening cliffs walked
 * frame 192's water while the player stood at 196, and navigation kept putting
 * 196 back — the water jumped between two views. `leaveframe` never ran either,
 * so nothing ever called `flatstopanim` to stop the one that was going.
 *
 * Neither Titanic's BOOTFILE nor Dust's defines either handler, so neither game
 * can be reached by this.
 */
test("a flat with no openflat of its own reaches the boot's default", async () => {
  const bytes = buildStgBytes({
    palette: PALETTE,
    flats: [
      { name: "shot", art: art(), script: compileScript(FLAT) },
      // no script at all, which is what most of Timelapse's frames have
      { name: "shot.1", art: art() },
    ],
  });
  const session = new GameSession((n) => (n === "d.stg" ? bytes : null), new NullAudioSink());
  const boot = `code openflat ()
\tglobal opened
\topened = currentflat ()
endcode

code closeflat ()
\tglobal closed
\tclosed = 1
endcode
`;
  session.bootScripts = [session.instanceFrom(compileScript(boot), "boot")!];
  session.refreshFallbacks();
  await session.stageCtrl.openStageFile("d.stg");

  await session.stageCtrl.gotoFlat("shot.1");
  expect(session.interp.globals.get("opened"), "the boot's default ran for a script-less flat").toBe("shot.1");
  // ...and leaving one fires the other half, which is what stops an animation
  await session.stageCtrl.gotoFlat("shot");
  expect(session.interp.globals.get("closed")).toBe(1);
});

/**
 * A coarse loop armed DURING a drag fires while the drag is still running.
 *
 * `fireDueLoops` counts a timer loop down whether or not a script is in flight
 * and then declines to fire it, so a loop armed inside a `while stilldown()`
 * handler sits at zero until the player lets go. Timelapse's match is the
 * worked example, and it was reported as one: `HandleMatch` drags the match
 * across the box, and striking it plays the sound and arms `makeloop("prop",
 * "Matches", "MatchBurn()", 30 / 6)` — so the strike was audible and the flame
 * did not start until the button came up.
 *
 * `forceupdate()` is the drag's own yield, and in the original it IS a service
 * pass, so a due loop runs there. The pump fires without counting down, which is
 * what keeps the PACE the engine's: a period-5 loop still comes round every five
 * 50 ms steps rather than every pumped frame.
 */
test("a timer loop due mid-drag fires on the forceupdate pump, at its own pace", async () => {
  const session = await scene();
  await session.stageCtrl.gotoFlat("shot");
  session.interp.globals.set("burns", 0);
  const inst = session.instanceFrom(
    compileScript(
      'code MatchBurn ()\n\tglobal burns\n\tburns = burns + 1\n\tmakeloop ("prop", "matches", "MatchBurn()", 5)\nendcode\n',
    ),
    "matchscript",
  )!;
  session.propScripts.set("matches", inst);
  session.scheduler.makeLoop("prop", "matches", "MatchBurn()", 5);

  // hold the world the way a `while stilldown()` handler does. Not `settle()`
  // anywhere below for the same reason the drag is the problem: nothing can
  // settle while it is held, so the pump's own dispatch is awaited by yielding
  // the event loop a few times instead.
  let release = () => {};
  session.track(new Promise<void>((r) => (release = r)), "the drag");
  expect(session.scriptBusy, "a script is in flight").toBe(true);
  const yieldTurns = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };

  let now = 0;
  const steps = async (n: number) => {
    for (let i = 0; i < n; i++) {
      now += 50;
      session.scheduler.tickTime(now);
      await yieldTurns();
    }
  };

  await steps(6); // more than the five 50 ms steps the loop asked for
  expect(session.interp.globals.get("burns"), "the service will not fire it while busy").toBe(0);

  session.scheduler.pumpFrameLoops("the drag");
  await yieldTurns();
  expect(session.interp.globals.get("burns"), "the drag's own yield does").toBe(1);

  // ...and not again until the service has counted the re-armed loop down: the
  // pump is a permission to run, not a tick of its own
  session.scheduler.pumpFrameLoops("the drag");
  await yieldTurns();
  expect(session.interp.globals.get("burns"), "no free extra firing").toBe(1);
  await steps(5);
  session.scheduler.pumpFrameLoops("the drag");
  await yieldTurns();
  expect(session.interp.globals.get("burns"), "and round it comes again").toBe(2);

  release();
  await session.settle();
});

/**
 * A jump into the MIDDLE of a variant chain decodes the chain, not the picture
 * you came from.
 *
 * Timelapse names a variant of a flat `i{region}.{frame}.{n}` — three components
 * — and those are a chain: `.1` is a delta over the base, `.2` over `.1`. Walking
 * an animation is fine either way, because the previous cel is also what you
 * arrived from. A JUMP is not, and the game jumps on purpose: the lantern's
 * instruction sheet is `gotoflat("i0001.605.1")` with the matches still on the
 * table and `gotoflat("i0001.605.2")` once they are taken, both from the table
 * itself. Decoded over the table, `.2` changed 4,771 of its pixels and left
 * 302,429 — so the player clicked the instructions and got the table back, which
 * is how it was reported.
 */
test("a jump into a variant chain decodes its own predecessors", async () => {
  const bytes = (() => {
    const built = buildStgBytes({
      palette: PALETTE,
      flats: [
        { name: "elsewhere", art: { pixels: new Uint8Array(W * H).fill(4), width: W, height: H } },
        { name: "s.100", art: art() },
        { name: "s.100.1", art: art() },
        { name: "s.100.2", art: art() },
      ],
    });
    const stg = readStgFile(built);
    // .1 changes row 3, .2 changes row 5 — each a delta over the one before it
    for (const [i, row, value] of [[2, 3, 2], [3, 5, 3]] as const) {
      const loc = stg.flats[i].locationFrame;
      stg.file.containers[loc] = { id: stg.file.containers[loc].id, data: deltaRow(W, H, row, value) };
    }
    return writeContainerFile(stg.file);
  })();
  const session = new GameSession((n) => (n === "c.stg" ? bytes : null), new NullAudioSink());
  await session.stageCtrl.openStageFile("c.stg");

  // stand somewhere unrelated, then jump straight to the second variant
  await session.stageCtrl.gotoFlat("elsewhere");
  await session.stageCtrl.gotoFlat("s.100.2");
  const px = session.stageCtrl.flatImage()!.pixels;
  const row = (y: number) => [...px.subarray(y * W, (y + 1) * W)];

  // both deltas applied, over the BASE — not over the flat we came from
  expect(row(3).every((p) => p === 2), "the first variant's row survived").toBe(true);
  expect(row(5).every((p) => p === 3), "the second variant's own row").toBe(true);
  for (const y of [0, 1, 2, 4, 6, H - 1]) {
    expect(row(y).every((p) => p === 1), `row ${y} is the base picture, not the flat we left`).toBe(true);
  }
  // ...and the one we came from left nothing behind, which is the whole bug: its
  // pixels are 4 and none of them are here
  expect([...px].some((p) => p === 4)).toBe(false);
});
