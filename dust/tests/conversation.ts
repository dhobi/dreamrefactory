/**
 * Coming BACK from a conversation.
 *
 * Reported (#289): "I spoke with the mayor's wife at `mayupper scene b1 · south`
 * and she moved to meet me. After the conversation, she didn't move back. When I
 * turned to `mayupper scene b1 · north` to enter the room, the wife remained in
 * view, now from behind, blocking the door." — and, from the reporter of the save
 * attached to it: "after first returning to the initial location, after some more
 * talks she doesn't move back anymore. Will she lose her initial location after
 * multiple talks?" Yes, she did, and the save says so: `Mwife · mayupper · star
 * "custom"`, standing at the player's feet, with no `mwifeidle` left in the loop
 * table.
 *
 * Every conversation in Dust runs through GANG.CST's `walktopuppet`, which walks
 * whoever you clicked over to you and afterwards sends them back to where they
 * were going:
 *
 *     if iswalk (who)
 *         savestar = walkdest (who)
 *         ...
 *         stopwalk (who)
 *     else
 *         savestar = actorstar (who)
 *     ...
 *     actorstar (who, "custom")
 *     sendtoactor (who, moveactor (savestar))   ; -> walktostar (me, savestar)
 *
 * So `walkdest` is load-bearing, and what it answers about a TURN is the whole
 * bug: Dust's idles turn constantly (`mwifeidle` faces the camera every 21
 * service steps while you are within `hotdist`), a turn is a walk in this engine
 * (#124), and a turn record with no destination makes `walkdest` fall through
 * to its no-record answer, `"custom"`. Click during a turn and the walk home
 * becomes `walktostar (me, "custom")`: no such star, no walk, no
 * arrival, no `endwalk`, no idle. Nothing in the corpus places a character
 * again (`setupactor` is only ever called from a puppet), so it is permanent —
 * which is why it reads as "she loses her spot after multiple talks".
 *
 * Skipped, not failed, without the disc (the bargain dust/tests/saves.ts makes).
 */
import { test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { PuppetView, PUPPET_ART_H } from "@dreamfactory/engine/web/puppet-view";
import { SetScripts } from "@dreamfactory/engine/runtime/setscripts";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";

/* anchored to this file, not the working directory — see dust/tests/movies.ts */
const CD = fileURLToPath(new URL("../gamefiles/dustcd", import.meta.url));
const DIRS = ["DATA", "PUPPETS", "MOVIES", "INVEN", "SALGAMES"];

/** a session that serves the disc, by name, wherever on it the file lives */
function newSession(logs: string[] = []): GameSession {
  const session = new GameSession((name) => {
    for (const d of DIRS) {
      const path = `${CD}/${d}/${name.toUpperCase()}`;
      if (existsSync(path)) return new Uint8Array(readFileSync(path));
    }
    return null;
  }, new NullAudioSink());
  session.onLog = (m) => logs.push(m);
  session.dfVersion = 1; // what dust/src/main.ts says at boot
  return session;
}

/** call a builtin the way a script does */
const call = (session: GameSession, name: string, args: (string | number)[]): unknown =>
  (session.interp.builtins.get(name) as (i: unknown, a: (string | number)[]) => unknown)(
    session.interp,
    args,
  );

test("a turn does not lose where the actor was going (#289)", async () => {
  if (!existsSync(`${CD}/DATA/MAYUPPER.SET`)) {
    console.warn(`no ${CD} — skipping (needs the Dust rip)`);
    return;
  }
  const logs: string[] = [];
  const session = newSession(logs);
  expect(await session.openCastFile("gang.cst"), "gang.cst opens").toBe(true);
  // the room, bound to the interpreter — which is what makes its stars findable.
  // Bound directly rather than through the host: nothing here needs a screen, a
  // camera or a standpoint, and Dust has no headless host harness of its own.
  const set = session.loadSet("mayupper.set");
  expect(set, "mayupper.set parses").toBeTruthy();
  const binding = new SetScripts(set!, session);
  // a bound set owns the trace (see BuiltinCtx.log), so a builtin's account of
  // itself arrives here rather than on the session
  binding.onLog = (l) => logs.push(l);
  const wife = session.actorRuntime.get("mwife")!;
  expect(wife, "the Mayor's wife is in the cast").toBeTruthy();

  // where the night-1 guest-room scene leaves her: setupactor("upstairs") is
  // `actorstar (me, "mayupper.mwife")`, and stdactor gives her the room's turn
  // rate — which is what makes the turn below take passes rather than land at
  // once, exactly as it does when a player walks up to her
  wife.turn = 10;
  wife.speed = 5;
  call(session, "actorstar", ["mwife", "mayupper.mwife"]);
  const star = session.currentBinding!.set.actors.find(
    (a) => a.identifier.toLowerCase() === "mayupper.mwife",
  )!;
  expect(star, "mayupper.mwife is a star of the room").toBeTruthy();
  expect([wife.worldX, wife.worldY], "she stands on it").toEqual([star.positionX, star.positionZ]);

  // `mwifeidle`: face the camera. A turn is a walk...
  call(session, "turntodeg", ["mwife", (wife.deg + 96) & 0xff]);
  expect(call(session, "iswalk", ["mwife"]), "a turn is a walk (#124)").toBe(1);
  // ...and this is the answer the whole conversation hangs on
  expect(
    call(session, "walkdest", ["mwife"]),
    "mid-turn, she is still on her way to the star she is standing on",
  ).toBe("mayupper.mwife");

  // THE WALK HOME, as `walktopuppet` runs it: it saves the destination, stops the
  // walk, walks her to the player, and afterwards puts "custom" in her star (the
  // sentinel that keeps `endwalk` from re-arming an idle mid-conversation) and
  // sends her back to the name it saved.
  const savestar = String(call(session, "walkdest", ["mwife"]) ?? "");
  call(session, "stopwalk", ["mwife"]);
  call(session, "actorxyz", ["mwife", star.positionX + 240, star.positionZ + 180, 0]);
  call(session, "actorstar", ["mwife", "custom"]);

  // THE FAILURE, spelled out: "custom" is `walkdest`'s no-record answer, and that
  // is not a place anyone can walk to. Left in as the counterfactual because a
  // pass on the name alone cannot tell "the right name" from "any name at all".
  call(session, "walktostar", ["mwife", "custom"]);
  expect(session.scheduler.walks.get("mwife"), 'walktostar("custom") starts no walk').toBeFalsy();
  expect(
    logs.filter((l) => l.includes("not found")),
    "...and says so",
  ).toEqual(['walktostar: mwife -> "custom" not found']);

  call(session, "walktostar", ["mwife", savestar]);
  expect(session.scheduler.walks.get("mwife"), "she sets off").toBeTruthy();

  let clock = 0;
  session.tickTime((clock += 50)); // the session's clock anchor
  // a pass is the idle's, run on the clock the host moves (Scheduler.pass): let
  // each one finish before the next tick
  for (let i = 0; i < 400 && session.scheduler.walks.has("mwife"); i++) {
    session.tickTime((clock += 50));
    await new Promise((r) => setTimeout(r, 0));
  }
  expect([wife.worldX, wife.worldY], "she gets home").toEqual([star.positionX, star.positionZ]);
  expect(wife.starName, "and knows where home is, so her idle can re-arm").toBe("mayupper.mwife");
});

/**
 * The room a conversation happens in is part of the conversation's picture.
 *
 * Reported alongside #289: "at the very beginning of the talk to the puppet, the
 * background from the previous talk is still visible for a very brief moment at
 * the beginning."
 *
 * It is, because a Dust conversation normally has `puppetgrab` on — the
 * BOOTFILE sets it at boot — and then DF.EXE never draws the puppet's own layer
 * 0 at all: the set's clean view stands in for it, in the set's colours 0..127
 * (0x437165 -> 0x437380). So most of a Dust conversation is the room behind the
 * character, and the composite is cached.
 * So the cache key needs the room as well as the character, the stance, the
 * clip and the display gamma: every conversation opens on the same neutral
 * pose, so without it a second talk with the same person builds the same key
 * and comes up over the room the last one happened in.
 *
 * The assertion is the measurement: over two different rooms, the same character
 * at the same instant must not composite to the same pixels.
 */
test("a conversation composites over the room you are having it in (#289)", async () => {
  if (!existsSync(`${CD}/PUPPETS/MWIFE.PUP`)) {
    console.warn(`no ${CD} — skipping (needs the Dust rip)`);
    return;
  }
  const session = newSession();
  call(session, "puppetgrab", [1]); // BOOTFILE/0001's boot
  expect(await session.puppetCtrl.openPuppetFile("mwife.pup"), "mwife.pup opens").toBe(true);
  const view = new PuppetView(session);

  const W = 512, H = 384;
  /** a room, as the director hands one over: a fresh frame and its own palette */
  const room = (index: number) => {
    const palette = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++) {
      palette[i * 4] = i;
      palette[i * 4 + 1] = 255 - i;
      palette[i * 4 + 2] = (i * 7) & 0xff;
      palette[i * 4 + 3] = 255;
    }
    return {
      pixels: new Uint8Array(W * PUPPET_ART_H).fill(index),
      width: W,
      height: PUPPET_ART_H,
      palette,
    };
  };
  const shot = (index: number): Uint8ClampedArray => {
    const buf = new Uint8ClampedArray(W * H * 4);
    view.composite(buf, room(index));
    return buf;
  };

  const here = shot(10);
  const elsewhere = shot(200);
  let differing = 0;
  let backdrop = 0;
  for (let i = 0; i < W * PUPPET_ART_H * 4; i += 4) {
    if (here[i] !== elsewhere[i] || here[i + 1] !== elsewhere[i + 1]) differing++;
    if (here[i] === 10 && here[i + 1] === 245) backdrop++;
  }
  // how much of the screen this is about — and evidence that Dust's opening
  // stance really is a matte, rather than a background that hides the question
  expect(backdrop, "most of a Dust conversation is the room behind the character")
    .toBeGreaterThan(W * PUPPET_ART_H / 2);
  expect(differing, "and all of it follows the room, second talk included").toBe(backdrop);

  // ...and the cache still IS a cache: the same room twice is the same picture,
  // built once. (Identity, not content — see PuppetView.composite.)
  const again = new Uint8ClampedArray(W * H * 4);
  const sameRoom = room(200);
  view.composite(again, sameRoom);
  const twice = new Uint8ClampedArray(W * H * 4);
  view.composite(twice, sameRoom);
  expect(Buffer.from(twice.buffer).equals(Buffer.from(again.buffer)), "a held room repaints the same")
    .toBe(true);
});

/**
 * `puppetgrab` decides whose background a puppet has — DF.EXE 0x4361c0 stores
 * the flag, the loader skips layer 0 while it is set (0x435a4b), and the draw
 * either puts the set's clean view in layer 0's place with the set's palette
 * entries 0..127 copied over the puppet's (0x437380, the range is puppetparam 1
 * and 2), or draws the puppet's own layer 0 (0x4372c0).
 *
 * The scripts clear it round the characters painted against a background of
 * their own — `puppetgrab (false)`, `runpuppet ("dead.pup")`, `puppetgrab
 * (true)` in GANG.CST — and those are exactly the PUPs whose layer 0 is a
 * picture rather than one flat colour: DEAD.PUP's has 58 colours, MWIFE.PUP's
 * one. So both halves are checked on the two of them.
 */
test("puppetgrab: the set's view and colours, or the puppet's own background", async () => {
  if (!existsSync(`${CD}/PUPPETS/DEAD.PUP`)) {
    console.warn(`no ${CD} — skipping (needs the Dust rip)`);
    return;
  }
  const W = 512, H = 384;
  // a room in one colour, index 10, whose own palette makes it pure green
  const palette = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) palette.set([0, 255, 0, 255], i * 4);
  const room = { pixels: new Uint8Array(W * PUPPET_ART_H).fill(10), width: W, height: PUPPET_ART_H, palette };
  const greens = (buf: Uint8ClampedArray): number => {
    let n = 0;
    for (let i = 0; i < W * PUPPET_ART_H * 4; i += 4) if (buf[i] === 0 && buf[i + 1] === 255 && buf[i + 2] === 0) n++;
    return n;
  };
  const shot = async (pup: string, grab: boolean, lo?: number, hi?: number) => {
    const session = newSession();
    call(session, "puppetgrab", [grab ? 1 : 0]);
    if (lo !== undefined) call(session, "puppetparam", [1, lo]);
    if (hi !== undefined) call(session, "puppetparam", [2, hi]);
    expect(await session.puppetCtrl.openPuppetFile(pup), `${pup} opens`).toBe(true);
    const buf = new Uint8ClampedArray(W * H * 4);
    new PuppetView(session).composite(buf, room);
    return greens(buf);
  };
  const area = W * PUPPET_ART_H;
  // grabbed: the room shows behind the character, in the room's colour
  expect(await shot("dead.pup", true), "the set behind dead.pup when grabbed").toBeGreaterThan(area / 4);
  // not grabbed: the puppet's own painted background covers all of it
  expect(await shot("dead.pup", false), "dead.pup's own painting when not").toBe(0);
  // ...and a flat plate is drawn as what it is, not read as a matte. MWIFE's is
  // 511 wide, so one column of the room (264 pixels) is all that is left of it.
  expect(await shot("mwife.pup", false), "mwife's plate, ungrabbed").toBeLessThanOrEqual(PUPPET_ART_H);
  // the room's colour reaches only the entries the range copies: index 10 is
  // outside [64, 128), so it keeps the puppet's own colour for it
  expect(await shot("mwife.pup", true, 64, 128), "index 10 not copied").toBe(0);
  expect(await shot("mwife.pup", true, 0, 11), "index 10 copied").toBeGreaterThan(area / 2);
});
