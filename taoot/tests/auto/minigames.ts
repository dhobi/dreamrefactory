/**
 * The three minigame pages, booted headlessly and played to every way out.
 *
 * Each page holds the BOOTFILE library without running `boot ()`, and so stands
 * on whatever {@link prepareMinigameSession} leaves behind in its place. Every
 * gap in that has shown up the same way — a script error box, on every idle or
 * at the end of a game, just before the page went back to the chooser — and a
 * browser probe that only checked the page arrived back caught none of them:
 *
 *   - `if debugging` in boot1.idle on the declaration's 0 (error 0xe)
 *   - `actorowner ("vlad"/"willie")` with no GANG.CST open (0xa)
 *   - `propowner ("ring")` with no INVEN.SHP open (0xa)
 *   - `transfromflat`'s `playnewtheme (savetheme)` and empty stage stack (0xe, `error ()`)
 *   - `steaming`'s `| tour` on a 0 (0xe)
 *
 * So the claim here is the strong one: the game runs AND ends, and not one
 * script error is logged on the way. Driven through the same functions the pages
 * call (taoot/minigames/src/minigame-session.ts), with the answers a player
 * would click given through `puppetChoose`.
 */
import { expect, test } from "vitest";
import { gamefiles } from "../../tools/gamefiles";
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import { drain, newHost, root } from "../harness";
import {
  fenceAfterBout,
  prepareMinigameSession,
  startBlackjack,
  startFence,
} from "../../minigames/src/minigame-session";

const haveRip = !!gamefiles(root).resolve("bootfile");

/** a session as a minigame page has it: library parsed, `boot ()` not run, the stage open */
async function boot(stage: string): Promise<{ session: GameSession; errors: () => string[] }> {
  const h = await newHost({ cold: true });
  const session = h.session;
  const seen: string[] = [];
  const log = session.onLog;
  session.onLog = (l: string) => {
    seen.push(l);
    log?.call(session, l);
  };
  // both stages are on the second disc, which the page says outright
  session.onDiscChange?.(2);
  const plan = await h.host.bootPlan();
  expect(await session.bootedByGame()).toBe(true);
  await prepareMinigameSession(session, plan);
  expect(await session.stageCtrl.openStageFile(stage)).toBe(true);
  return {
    session,
    errors: () => [...seen, ...h.logs].filter((l) => /script error|error \d+:/i.test(l)),
  };
}

/** a few passes of the boot library's `idle ()`, which a page runs every frame */
async function idle(session: GameSession, passes = 8): Promise<void> {
  const boot = session.bootScripts.find((b) => b.script.codes.has("idle"));
  expect(boot, "the BOOTFILE has an idle").toBeTruthy();
  for (let i = 0; i < passes; i++) {
    await answering(session, -1, session.interp.runHandler(boot!, "idle", [], { me: boot!.name, target: "" }));
  }
}

/**
 * Run `work` to completion with game time moving, clicking answer `index`
 * whenever the conversation offers a choice — as a player who always says the
 * same thing (-1: never answers).
 */
async function answering<T>(session: GameSession, index: number, work: Promise<T>): Promise<T> {
  let done = false;
  const out = work.finally(() => (done = true));
  // game time, 20 ms a step, for the delays, wipes and spoken lines on the way
  for (let i = 0; i < 20_000 && !done; i++) {
    if (index >= 0 && (session.puppet?.bevels.length ?? 0) > index && session.puppet?.eventWaiter) {
      session.puppetCtrl.puppetChoose(index);
    }
    session.clock.advance(session.clock.now + 20);
    await drain();
  }
  expect(done, "the game came to rest").toBe(true);
  return out;
}

test.skipIf(!haveRip)("fight: idles, and both endings put the stage down without a script error", async () => {
  for (const [vlad, player] of [[0, 100], [100, 0]]) {
    const { session, errors } = await boot("fight.stg");
    await idle(session);
    session.interp.globals.set("vladpower", vlad);
    session.interp.globals.set("playerpower", player);
    await session.fireHandler(session.stageScript, "endfight", "");
    expect(session.stageName, `vladpower ${vlad}, playerpower ${player}`).toBe("none");
    expect(errors()).toEqual([]);
  }
});

test.skipIf(!haveRip)("blackjack: deals, and saying no to another hand closes the table without a script error", async () => {
  const { session, errors } = await boot("blkjack.stg");
  await answering(session, 0, startBlackjack(session, "titanic"));
  await idle(session);
  expect(typeof session.interp.globals.get("cardstring"), "a hand was dealt").toBe("string");
  const flat = session.flatScripts.get(session.currentFlat.toLowerCase());
  // the dealer's `playagain`: 0 "Yes, I'll play another hand.", 1 "No, I've got to go now."
  await answering(session, 1, session.fireHandler(flat, "newgame", session.currentFlat));
  expect(session.stageName).toBe("none");
  expect(errors()).toEqual([]);
});

test.skipIf(!haveRip)("fence: a bout won ends, and Willie asks for another without a script error", async () => {
  for (const [answer, verdict] of [[1, "done"], [0, "again"]] as const) {
    const { session, errors } = await boot("fence.stg");
    startFence(session, 15);
    await idle(session);
    // five touches to the player is the bout (`pointgoesto`: propdeg of the score reaches 4)
    for (let i = 0; i < 5 && session.stageScript; i++) {
      const stage = session.stageScript;
      await answering(session, 0, session.interp.runHandler(stage, "pointgoesto", ["player"], { me: session.stageName, target: "" }));
    }
    expect(session.stageName, "the bout put its stage down").toBe("none");
    // Willie: 0 "Yes, I'll fence.", 1 "No, I've got to go."
    expect(await answering(session, answer, fenceAfterBout(session))).toBe(verdict);
    expect(errors()).toEqual([]);
  }
});
