/**
 * What a minigame page does to a session between parsing the BOOTFILE and
 * opening its stage — everything `boot ()` would have left behind that the three
 * games' own scripts read, and the one call (`transfromflat`) that has nowhere to
 * go without a ship.
 *
 * Kept free of the DOM so taoot/tests/auto/minigames.ts can boot each game
 * headlessly through the very same steps and play every way out of it: each
 * thing in here was once a script error box on one of the pages.
 */
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import type { BootPlan } from "@dreamfactory/engine/runtime/bootplan";

export async function prepareMinigameSession(session: GameSession, plan: BootPlan): Promise<void> {
  /**
   * ...AND THE TWO LINES OF `boot ()` THAT ARE ABOUT THE SCREEN, which not
   * running it left out.
   *
   * `boot ()` opens with `puppetparam (9, 1)` and `puppetparam (10, 25)` and
   * never puts either back, so aboard they hold for every conversation in the
   * game. Slot 10 is the left margin of the answer rows, and 25 is the number
   * that clears the SCREWS: the answer band is a picture inside every PUP with a
   * rivet drawn at each end of all five plaques, and at the un-booted default of
   * 8 the text starts on top of the left one — reported against all three of
   * these pages, and visible in the shot on #391 as Buick's "Yes, I'll play
   * another hand." beginning inside the screw.
   *
   * Read from the BOOTFILE rather than written here, because 25 is TAOOT's
   * number and not the port's — see BootPlan.puppetParams. Applied AFTER
   * `bootedByGame`, which is where the file is parsed, and before any puppet is
   * opened.
   */
  for (const [slot, value] of plan.puppetParams) session.puppetParams.set(slot, value);
  /**
   * ...and the GLOBALS `boot ()` sets before it does anything else.
   *
   * The library's own handlers read them from the first `idle ()` on — `if
   * debugging`, `if lockevents`, `calctime`'s `if not sinkflag` — and not running
   * `boot ()` left them as the bare `global` declaration makes them, 0 (or
   * missing), which a DreamFactory 5 `if` answers with error 0xe (TI.EXE
   * 0x44415d): "if wants a boolean, got 0 (in boot1.idle)" on every idle, on all
   * three pages. Read from the BOOTFILE like the puppet params.
   */
  for (const [name, value] of plan.globals) session.interp.globals.set(name, value);
  /*
   * The two `boot ()` sets under an `if`, which the plan leaves to its caller:
   * `tour` is which door of PLAYMODE.MOV was taken (`if actionframe (1)`), and
   * these pages are the game, not the tour; `optionquit` is the option+shift
   * chord held at launch, which nobody did. Willie's `playagain` reaches
   * `steaming ()`, whose `if currentpuppet () = "none" | tour` is error 0xe on
   * a 0.
   */
  for (const flag of ["tour", "optionquit"]) session.interp.globals.set(flag, session.interp.bool(false));

  /**
   * ...and THE STORY CAST, which `boot ()` opens before any stage.
   *
   * Each game keeps its result on a `GANG.CST` actor and leaves through him:
   * fencing `actorowner ("willie", "won")` and Willie's `postgame` reading it
   * back, the fight `actorowner ("vlad", "lostfight")` and `sendtoactor ("vlad",
   * setupactor (…))` before its `transfromflat ()`. With no cast open each is
   * error 0xa, "no such object", which abandons the handler: the fight never
   * left its flat and Willie never asked for a rematch.
   */
  for (const cast of plan.casts) await session.openCastFile(cast);
  /*
   * ...and its SHOPS, for the same reason: Willie's `postgame` asks
   * `propowner ("ring")` — an INVEN.SHP prop — on every bout, and with no shop
   * open that is error 0xa too. Opening a shop places nothing on screen; its
   * props stay where they are until a script shows them.
   */
  for (const shop of plan.resources.filter((f) => f.endsWith(".shp"))) await session.openShop(shop);
  /**
   * ...and THE WAY BACK, which is the page's and not the ship's.
   *
   * All three games end in the BOOTFILE's `transfromflat ()` (fight's
   * `endfight`, blackjack's `closecards`, fencing's post-bout), and aboard that
   * returns to the room `transtoflat ()` left: it plays `savetheme` again, then
   * `restoreflat ()`/`restorestage ()` pop what `savestages ()` pushed, and
   * reopens it. These pages never ran `transtoflat`, so there is nothing to pop —
   * `playnewtheme (0)` was error 0xe in `getthemevolume`, and the empty stack is
   * `restorestage`'s own `error ()` — and a script error box came up on every
   * exit, just before the page went back to the chooser.
   *
   * So the call is answered here, by the half of it that still means something:
   * the stage is put down (its `closestage ()` runs, as `closestagefile ()`
   * would), and the page's leave-watcher (minigame-boot.ts) takes it from there. A builtin is
   * found before the BOOTFILE's handler for any call from a stage or flat
   * script, which is where all three make it.
   */
  session.interp.register("transfromflat", async () => {
    await session.stageCtrl.closeStageFile();
  });
}

/**
 * Blackjack's start: the two lines the dealer's conversation would have left
 * behind (`firsthand = true`, `buickphase = 1`), the dealer himself, and the
 * flat's `initgame`.
 *
 * THE DEALER HIMSELF, because the rematch is his line.
 *
 * When a hand is settled the table asks him, not us: `BLKJACK.STG/0002` ends
 * `puppetvisible (true); puppetgrab (false); visualeffect (wipeleft, 20);
 * return sendtopuppetfx ("boot script", playagain ())`, and his `playagain`
 * reacts to who won (`playerwin ()`, `buickwin ()`, `draw ()`) before
 * offering "Yes, I'll play another hand." / "No, I've got to go now.".
 *
 * With no puppet loaded that dispatch finds nobody, `playagain ()` answers
 * nothing, and `newgame ()` takes its `if not playagain ()` branch straight to
 * `closecards ()` — one hand and the table shuts. So he is opened before the
 * first deal, which is also where the ship has him: his conversation is what
 * gets you to the table in the first place.
 *
 * Not `runyoself` though — that is the "have we met?" conversation, and it is
 * the one thing here the ship does that this page deliberately does not.
 *
 * `initgame` is the FLAT's, not the stage main's.
 *
 * `BLKJACK.STG` container 1 carries `openstage`/`closestage`/`shuffle` and
 * container 2 — the flat `blkjack`'s own script — carries the game:
 * `initgame`, `newgame`, `dealcards`, `hitplayer`, `checktotals`. Fired at
 * `stageScript` it lands on a script that has never heard of it, which is a
 * boot that opens the table and deals nothing (globals `{firsthand: true}` and
 * not one card).
 */
export async function startBlackjack(session: GameSession, deck: string): Promise<void> {
  await session.puppetCtrl.openPuppetFile("blkjack1.pup");
  const g = session.interp.globals;
  g.set("playingcards", deck);
  g.set("firsthand", session.interp.bool(true)); // BLKJACK1.PUP: `firsthand = true`
  g.set("buickphase", 1);
  const flat = session.flatScripts.get(session.currentFlat.toLowerCase());
  await session.fireHandler(flat, "initgame", session.currentFlat);
}

/** Fencing's start: the difficulty picked, and `willphase` at "a bout is on". See fence-page.ts. */
export function startFence(session: GameSession, level: number): void {
  session.interp.globals.set("fencelevel", level);
  session.interp.globals.set("willphase", 201);
}

/**
 * The squash court's own loop after a bout: Willie's `runyoself ("fence")`.
 * "again" when he was told yes (`willphase` back at 201). See fence-page.ts.
 */
export async function fenceAfterBout(session: GameSession): Promise<"again" | "done"> {
  if (!(await session.puppetCtrl.openPuppetFile("wilfenc1.pup"))) return "done";
  const boot = session.puppet?.scripts.get("boot script");
  if (boot) {
    // `fireHandler` passes no arguments and this handler is all argument —
    // `runyoself (msg)` does nothing at all unless msg is "fence".
    await session.interp.runHandler(boot, "runyoself", ["fence"], { me: "wilfenc1.pup", target: "" });
  }
  session.puppetCtrl.closePuppetFile();
  return session.interp.globals.get("willphase") === 201 ? "again" : "done";
}
