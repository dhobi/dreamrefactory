/**
 * A jump made from inside the scene lifecycle does not ask for the event again.
 *
 *   npx vitest run dust/tests/lifecycle.ts
 *
 * Reported from play, and it takes the tab with it: load the last save of day
 * one, sleep in the hotel room, and try to leave in the morning. The screen
 * goes to the darkened room — the `screentoblack` half of `gotospecial` — and
 * freezes there at 100% CPU.
 *
 * Leaving lands you in `hotupper.set` Scene C4 (advanceday's `savescene`), whose
 * openscene is
 *
 *     if day = 2 & clock = 1 & phase = 0
 *         lockevents = true
 *         currentview ("north")
 *         makeloop ("scene", currentscene (), "trigger", 20)
 *
 * `currentview()` reaches `SetViewer.teleport`, which dispatched the scene
 * lifecycle again unconditionally — so openscene re-entered openscene, and the
 * gate was still open because `phase` is cleared to 1 only by the `trigger` the
 * last line arms, which never gets a service pass. An unbounded async chain
 * that starves the one thing that would have ended it.
 *
 * The original cannot do this: it has one event queue and pops one event at a
 * time, so a handler never recursively dispatches the event it is handling.
 * Fourteen of Dust's openscene handlers jump the standpoint; this is the one
 * whose gate does not close behind it. (TAOOT's `c59` does the same thing and
 * survives only because it sets `bombphase = 1` before it turns.)
 *
 * Both halves matter. The guard has to stop the re-entry AND leave an ordinary
 * jump alone, because a jump from a normal handler still owes the event — that
 * is what closes the door TAOOT would otherwise leave hanging in mid-air (#71).
 *
 * Skipped, not failed, without the disc (the bargain dust/tests/saves.ts makes).
 */
import { test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { SetScripts } from "@dreamfactory/engine/runtime/setscripts";
import { readSetFileAsV4 } from "@dreamfactory/engine/df/set-v1-to-v4";

const CD = fileURLToPath(new URL("../gamefiles/dustcd", import.meta.url));
const DIRS = ["DATA", "PUPPETS", "MOVIES", "INVEN", "SALGAMES"];

function corridor(): { session: GameSession; scripts: SetScripts; sceneIdx: number } | null {
  if (!existsSync(`${CD}/DATA/HOTUPPER.SET`)) return null;
  const session = new GameSession((n) => {
    for (const d of DIRS) {
      const p = `${CD}/${d}/${n.toUpperCase()}`;
      if (existsSync(p)) return new Uint8Array(readFileSync(p));
    }
    return null;
  }, new NullAudioSink());
  session.dfVersion = 1;
  session.onLog = () => {};
  const set = readSetFileAsV4(new Uint8Array(readFileSync(`${CD}/DATA/HOTUPPER.SET`)));
  const scripts = new SetScripts(set, session);
  scripts.onLog = () => {};
  // the morning after, on the standpoint leaving the room puts you at
  for (const [k, v] of [["day", 2], ["clock", 1], ["phase", 0]] as const) {
    session.interp.globals.set(k, v);
  }
  const sceneIdx = set.scenes.findIndex((s) => s.sceneName.toLowerCase() === "scene c4");
  expect(sceneIdx, "hotupper.set has a Scene C4").toBeGreaterThanOrEqual(0);
  return { session, scripts, sceneIdx };
}

/** what SetViewer.teleport does on a jump, guard and all */
function wireTeleport(
  c: { session: GameSession; scripts: SetScripts; sceneIdx: number },
  onDispatch: () => void,
): void {
  c.session.onSceneJump = () => {};
  c.session.onViewJump = () => {
    if ((c.scripts as unknown as { inLifecycle: boolean }).inLifecycle) return;
    onDispatch();
    void c.session.track(
      (async () => {
        await c.scripts.viewSettled(c.sceneIdx);
      })(),
      "jump",
    );
  };
}

test("openscene's own currentview() does not re-enter openscene", async () => {
  const c = corridor();
  if (!c) {
    console.warn(`no ${CD} — skipping (needs the Dust rip)`);
    return;
  }
  let dispatches = 0;
  wireTeleport(c, () => {
    dispatches++;
  });
  await c.scripts.viewSettled(c.sceneIdx);
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 5));
  // it re-dispatched without limit before the guard — 200 was only where the
  // reproduction's own cap stopped counting
  expect(dispatches, "the jump inside openscene asked for the event again").toBe(0);
  // and the handler really did run, so this is not a vacuous pass: it is the
  // one that arms the trigger, and it locks events on the way
  expect(c.session.interp.globals.get("lockevents"), "openscene ran").toBeTruthy();
});

test("a jump from outside the lifecycle still dispatches it", async () => {
  const c = corridor();
  if (!c) return;
  let dispatches = 0;
  wireTeleport(c, () => {
    dispatches++;
  });
  // no lifecycle in flight — this is the `dopurser` case, and it must still
  // fire, or TAOOT's door hangs in mid-air (#71)
  expect((c.scripts as unknown as { inLifecycle: boolean }).inLifecycle).toBe(false);
  c.session.onViewJump?.("north");
  expect(dispatches, "an ordinary jump still owes the scene event").toBe(1);
});
