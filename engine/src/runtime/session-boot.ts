import { readContainerFile } from "../df/container";
import { versionOf } from "../df/version";
import { Value } from "./interp";
import { BootPlan, EMPTY_BOOT_PLAN, readBootPlan } from "./bootplan";
import type { GameSession } from "./session";

/**
 * Booting the game: parsing the BOOTFILE into the boot library, opening what
 * its boot plan names when the port stands in for the game's own `boot()`, and
 * putting it all back down for a restart. Owned by GameSession, which forwards
 * `ensureBooted`, `bootedByGame`, `prepareRestart` and `discVolumes` here.
 */
export class SessionBoot {
  constructor(private readonly session: GameSession) {}

  /** set once the boot library and its session-scoped resources are up */
  coreLoaded = false;

  /**
   * **The game is booted**: the BOOTFILE scripts are parsed, their globals
   * seeded, the session-scoped resources its boot plan names open (TAOOT:
   * inven/house shops, the shared audio banks, gang.cst) and the standard
   * in-game stage up. Idempotent by contract, not by patch — asking twice is
   * asking for a state that already holds. Steps in order; each is its own
   * method below.
   *
   * It is a *once* in the game too: TAOOT's `boot()` runs its `openshopfile
   * ("house.shp")`, `opencastfile("gang.cst")`, `openstagefile("main.stg")` at
   * startup and never again. Re-running them is not a no-op — house.shp's
   * `openshop` is a LAYOUT pass (`propxy("bag", 256, 324)`, the interface
   * band), while putting the bag on the C73 bed is `initprops`' one-time job.
   * So a second pass left the bag 2D and the bed bare, and walking out of the
   * cabin and back in through the door lost it. (The game's own restart — the
   * CTL.STG "new game" lever — closes every shop and cast *first* and reopens
   * them by script, so it never needs this to run again.)
   *
   * Callers can't know whether they are first: any entry point may be, and the
   * files only exist once fetched. So they all just say what they need — hence
   * `ensure`, and why the host asks before every set activation.
   *
   * Not latched until the boot scripts are actually in: an early call with no
   * `bootfile` yet must be allowed to try again.
   */
  async ensureBooted(): Promise<void> {
    if (this.coreLoaded) return;
    this.loadBootLibrary();
    await this.loadBootResources();
    await this.initInventoryProps();
    this.syncThemeLever();
    this.coreLoaded = this.session.bootScripts.length > 0;
  }

  /**
   * What this game's boot opens, read from its own BOOTFILE and cached.
   *
   * The session parses that file anyway ({@link loadBootScripts}), and the plan is
   * derived from the same bytes — so this asks no one for it and needs no wiring.
   * The host reads the same plan for what to FETCH (GameHost.bootPlan); this is
   * what to OPEN, which is the other half of the same question.
   */
  private plan: BootPlan | null = null;

  private bootPlan(): BootPlan {
    if (this.plan) return this.plan;
    const bytes = this.session.files("bootfile");
    this.plan = bytes ? readBootPlan(bytes) : EMPTY_BOOT_PLAN;
    return this.plan;
  }

  /**
   * The CD volumes this game's boot mounts, in disc order — `["titanic1",
   * "titanic2"]`, read off its own `setpath` ({@link BootPlan.volumes}). Empty
   * for a single-volume game.
   *
   * Public because a SAVE names the volume it was taken on, by the very label
   * `setpath` mounts it under, and a load has to put that disc back before it
   * reads a byte (see `loadGame`).
   */
  get discVolumes(): readonly string[] {
    return this.bootPlan().volumes;
  }

  /**
   * The half of the boot that is nobody else's to do: parse the BOOTFILE
   * containers into scripts, wire them as the unqualified-call fallbacks, and
   * seed the globals scripts compare against.
   *
   * Split out because both kinds of boot need exactly this and only one of them
   * needs the rest — see {@link bootedByGame}. It is also the half that cannot
   * be skipped by any caller, the game's own `boot()` included: `boot()` lives in
   * the BOOTFILE, so parsing the file is what makes it callable at all.
   */
  private loadBootLibrary(): void {
    this.loadBootScripts();
    this.session.refreshFallbacks();
    this.seedBootGlobals();
  }

  /**
   * The GAME's own `boot()` is what boots this session, so {@link ensureBooted}
   * must never stand in for it: parse the boot library and latch, without opening
   * a single resource.
   *
   * Everything `ensureBooted` opens is a re-creation of what a full game's
   * `boot()` does, kept because the port's other entry points — a set pick, a
   * loaded save — reach a running game without ever passing through `boot()`. An
   * edition whose `boot()` *is* being run does not want that re-creation: TAOOT's
   * 1996 DEMO opens gang.cst, two track banks and demo.shp, and then its own menu
   * stage, and the interface band it never asked for is opened by its `dodemo()`
   * — the moment you pick "DEMO" from that menu, alongside main.stg and the
   * inventory (`openshopfile("house.shp") … openstagefile("main.stg")`). Standing
   * in for it painted house.shp's lifebuoy, bag, watch and deck map over the
   * demo's title screen, in the menu flat's palette, and ran inven.shp's
   * `initprops` a whole game early.
   *
   * A stand-in that ALREADY ran is put back down here, because "never stand in
   * for it" has to hold for a caller that arrives second. Any entry point may
   * come first (a set pick, the harness's pre-boot), and the shops it opened
   * carry state that a re-open deliberately keeps ({@link openShop}) — so a
   * `boot()` running afterwards inherits props that were seeded before it had
   * said anything. TAOOT's interface band is that case: `initprops` ->
   * `initinterface` branches on `tour`, `tour` is set from playmode.mov's
   * GAME / GUIDED TOUR menu, and the tour branch says nothing about the bag and
   * the pocketwatch — so a band built early, for the game, left both of them
   * standing in a guided tour, and boot()'s own `openshopfile` re-fired
   * `openshop`, whose `propxy(…, 256, 324)` is the BAND layout, and dragged the
   * pair out of C73 and into the menu band. Closing the shops drops their props
   * ({@link PropRuntime.removeShop}), so `boot()` builds the band once, from
   * scratch, with the flag it has just set.
   *
   * False when there is no BOOTFILE parsed yet, in which case nothing has been
   * latched and there is no `boot()` to run either — the caller has nothing to
   * boot and should say so rather than carry on.
   */
  async bootedByGame(): Promise<boolean> {
    await this.putDownStandIn();
    this.loadBootLibrary();
    this.coreLoaded = this.session.bootScripts.length > 0;
    return this.coreLoaded;
  }

  /**
   * Close the SHOPS a previous {@link ensureBooted} opened, so the `boot()` about
   * to run opens them itself — see {@link bootedByGame}, which is the only caller.
   *
   * Shops and not everything: the boot's other resources come back clean on their
   * own. An audio bank is bytes, a cast is re-dealt by `initall`'s `initactors`,
   * and a stage file is re-read on open. A shop is the one that deliberately does
   * NOT rebuild ({@link openShop}), because a stage re-entering its own shop must
   * keep the prop states it left — which is right there and wrong here.
   *
   * `__propsinit` goes with them: it is {@link initInventoryProps}' once-latch, and
   * a session whose inventory props no longer exist has not had them dealt.
   *
   * The question asked is whether the SHOPS are open, not whether `coreLoaded` is
   * set — those come apart on the one path that most needs this. `quit()` ->
   * {@link prepareRestart} clears the latch and leaves the finished game's shops
   * standing, so a `coreLoaded` guard would read "nothing stood in" and hand the
   * restarted boot the old game's band.
   */
  private async putDownStandIn(): Promise<void> {
    let closed = false;
    for (const file of this.bootPlan().resources) {
      if (!file.endsWith(".shp") || !this.session.resourceCtrl.shopMains.has(file.toLowerCase())) continue;
      await this.session.closeShop(file);
      closed = true;
    }
    if (closed) this.session.interp.globals.delete("__propsinit");
  }

  /**
   * The game is over: put everything the finished game had running back down, and
   * forget the boot so {@link ensureBooted} runs again.
   *
   * This is what lets `quit()` return to the front door in place instead of
   * reloading the page. The obstacle is real and is handled by the caller, not
   * here: `quit()` is called from inside the script that just played the
   * credits, so a boot re-entered underneath it would be building sets while the
   * old game is still talking. The host schedules this for a later
   * task, and the `settle()` below is the second half of that guarantee — nothing
   * is torn down until the dispatch that asked for it has finished unwinding.
   *
   * What has to go, and why each: the SCHEDULER, or the dead game's loops keep
   * firing at scenes the new one has not built (the same argument as the
   * unscripted-swap reset in GameHost); every AUDIO channel, since a theme is a
   * loop and nothing else would ever stop it; a PUPPET, which would otherwise
   * still hold the dispatch; and the FADE, which is left pinned black by the
   * credits and would keep the front door dark. `coreLoaded` is ensureBooted's
   * idempotence latch and a restart is precisely the case that must run it twice —
   * it re-seeds the boot globals, re-opens main.stg and re-deals the inventory.
   *
   * The GAME state is not reset here on purpose: the title's own boot does it
   * (TAOOT: the BOOTFILE `clock = "startdisk1"` arm — resetgamevars,
   * resetpupvars, and the two loops that walk every actor and prop back to
   * "none"), and the data resetting itself is more faithful than this file
   * guessing at the same list.
   */
  async prepareRestart(): Promise<void> {
    await this.session.settle();
    this.session.scheduler.reset();
    for (const channel of ["sound", "voice", "theme"] as const) this.session.audio.halt(channel);
    this.session.currentThemeName = "none";
    this.session.themeStarted(null);
    this.session.captions = [];
    this.session.puppetCtrl.closePuppetFile();
    this.session.fade.queue.length = 0;
    this.session.fade.snapshot = null;
    this.session.fade.pendingReveal = false;
    this.session.fade.blanked = false;
    this.session.fade.level = 1;
    // and the pointer comes BACK. The endgame's `hidecursor()` has no matching
    // `showcursor()` — the game is over — so a restart in the same page would
    // otherwise begin with an invisible cursor. See cursorDepth: the original
    // unwinds its own counter at two equivalent boundaries.
    this.session.cursorDepth = 0;
    this.session.endWipe(); // a reveal in flight belongs to the screen being thrown away
    // And the SCREEN, because of where quit() is called from. The CTL panel is a
    // flat: reaching Quit means `transtoflat("ctl.stg")` has already run, which
    // pushed main.stg onto the overlay stack and set `setVisible = false`. The
    // normal way back is `transfromflat`, which the player never gets to take —
    // they quit instead. So the restarted game opened its rooms behind a room
    // nobody was allowed to see: the flat's radio played, the landlady shouted
    // and the traffic moved, over a white void where the picture should be, and
    // only loading a save (whose own path does restore this) cleared it (#35).
    //
    // The stack goes with it. Those are the game's own `savestage1..3` globals,
    // still remembering the finished game's main.stg, and a later transfromflat
    // would pop one that belongs to nothing.
    this.session.stageCtrl.resetOverlayStack();
    this.session.setVisible = true;
    this.coreLoaded = false;
  }

  /** parse the BOOTFILE containers into script instances (idempotent) */
  private loadBootScripts(): void {
    const boot = this.session.files("bootfile");
    if (!boot || this.session.bootScripts.length) return;
    try {
      const file = readContainerFile(boot);
      this.session.isV5 = versionOf(file.containers[0]?.data ?? new Uint8Array()) === 5;
      // DreamFactory 5's slots 3 and 4 are 0x00RRGGBB colours, not clut indices:
      // RedJack.exe seeds white answers and a red frame (0x439d41)
      if (this.session.isV5) this.session.puppetParams.set(3, 0xffffff).set(4, 0xff0000);
      if (this.session.isV5) this.session.audioLib.onSoundsClosed = (names) => names.forEach((n) => this.session.scheduler.stopCricket(n));
      for (let i = 1; i < file.containers.length; i++) {
        const inst = this.session.instanceFrom(file.containers[i].data, `boot${i}`);
        if (inst) this.session.bootScripts.push(inst);
      }
      this.session.onLog(
        `boot scripts loaded (${this.session.bootScripts.map((b) => b.script.codes.size).join("+")} handlers)`,
      );
    } catch (e) {
      this.session.onLog(`bootfile: ${(e as Error).message}`);
    }
  }

  /**
   * boot()'s variable initialization — scripts test these with != "" and
   * text-compares would treat the uninitialized 0 as "0". The NAMES are
   * TAOOT's boot globals (game knowledge the engine still carries; a title
   * whose boot declares different globals seeds its own via its own `global`
   * declarations, and these extras are harmless to it).
   *
   * One deliberate DIVERGENCE from the original: themevolume. TAOOT's own
   * boot sets 255 (full), but the ambient themes at full volume are wearing
   * over a long session, so this port starts the music very quiet; the player
   * raises it with the CTL.STG theme lever. wavevolume (SFX/voice) stays at
   * full. syncThemeLever() below keeps the settings panel consistent.
   */
  private seedBootGlobals(): void {
    if (this.session.interp.globals.has("handitem")) return;
    for (const [k, v] of [
      ["handitem", ""], ["savestage1", ""], ["savestage2", ""], ["savestage3", ""],
      ["saveflat1", ""], ["saveflat2", ""], ["saveflat3", ""],
      ["jumpset", ""], ["playerdeath", ""], ["loopsound", ""], ["seldir", "north"],
      ["twocount", 1], ["threecount", 1], ["fourcount", 1], ["fivecount", 1],
      ["themevolume", 24], // the port's quiet-music default — see docblock
    ] as [string, Value][]) {
      this.session.interp.globals.set(k, v);
    }
  }

  /** run the inventory shop's initprops once, seeding its prop states
   *  (TAOOT: inven.shp — the name is game knowledge, see BOOT_UI_SHOPS) */
  private async initInventoryProps(): Promise<void> {
    const inven = this.session.shopMain("inven.shp");
    if (!inven?.script.codes.has("initprops") || this.session.interp.globals.has("__propsinit")) return;
    this.session.interp.globals.set("__propsinit", 1);
    await this.session.fireHandler(inven, "initprops", "inven.shp", "initprops");
  }

  /**
   * Sync the theme lever's rest position to our low default themevolume —
   * TAOOT-specific by nature, like the quiet-music divergence it exists for
   * (a title with no "themetoggle" prop makes this a no-op). house.shp's
   * openshop hardcodes deg 5 = loud; CTL.STG's slider maps themevolume = 8·x,
   * deg = x/6, so deg = themevolume/48. Without this the panel would show the
   * lever near the top over deliberately quiet music.
   */
  private syncThemeLever(): void {
    const lever = this.session.propRuntime.get("themetoggle");
    if (!lever) return;
    const vol = Number(this.session.interp.globals.get("themevolume") ?? 0);
    lever.deg = Math.max(0, Math.min(5, Math.floor(vol / 8 / 6)));
  }

  /**
   * Replay the resource openings this game's `boot()` performs, without its game
   * flow — the movies it plays and the day it advances into.
   *
   * Derived, not listed. Naming TAOOT's `inven.trk`, `unilib.trk`, `inven.shp`,
   * `house.shp`, `gang.cst` and `main.stg` here would be one game's boot
   * transcribed into the engine; {@link bootPlan} reads the same six out of the
   * BOOTFILE that opens them, so a different title's stand-in opens ITS resources
   * instead. The order is the boot's own.
   *
   * Dispatch is by extension, because that is what the primitive the boot called
   * is determined by: `.cst` was an `opencastfile`, `.shp` an `openshopfile`. A
   * MOVIE is skipped — `playmovie("logo.mov")` is game flow, and the whole point
   * of a stand-in is to reach a running game without playing the intro.
   */
  async loadBootResources(): Promise<void> {
    for (const file of this.bootPlan().resources) {
      if (!this.session.files(file)) continue; // a name this tree does not carry
      if (file.endsWith(".trk")) this.session.audioLib.openBank(file, this.session.files(file)!);
      else if (file.endsWith(".shp")) await this.session.openShop(file);
      else if (file.endsWith(".cst")) await this.session.openCastFile(file);
      else if (file.endsWith(".stg")) await this.session.stageCtrl.openStageFile(file);
    }
  }
}
