import { CallCtx, Frame, ScriptInstance, Value } from "./interp";
import type { GameSession } from "./session";

/**
 * The sendto* event dispatch: which script a command names, the chain of
 * scripts the event then traverses, running that chain, and the containment
 * fallback when nothing in it answered. Owned by GameSession, which forwards
 * `sendEvent`, `runHandlerChain` and `sendToPainting` here.
 */

/** the sendto* commands that address a CAST member, whoever else answers to the
 *  name — see {@link SessionEvents.resolveEventTarget} */
const ACTOR_ADDRESSEE = /^sendtoactor(fx)?$/;

export class SessionEvents {
  constructor(private readonly session: GameSession) {}

  /**
   * sendto* dispatch, shared by the sendto special forms and loop firing:
   * resolve the named target, build the command's dispatch chain, run it in
   * order, and — when no link had the handler at all — resolve through the
   * target's containment chain. Events sent to a scene forward along
   * scene → set main → stage when unhandled/passed (or when the scene has
   * no script at all).
   */
  async sendEvent(
    cmd: string,
    targetName: string,
    handler: string,
    args: Value[],
    callerName: string,
    /**
     * The frame the `sendto*` was written in, when a SCRIPT is doing the sending.
     * The re-routed event stays part of that chain, which is what keeps
     * `exitcode` meaning the same thing on both sides of a re-route: boot's
     * keydown router forwards the press with `sendtoscene(currentscene(),
     * keydown(arg))` and a set keydown that exitcodes there IS consuming the
     * press, while an `openset` that fires `sendtoactor(…, setupactor())` is not
     * consumed by setupactor's own exitcode. Absent — the host, the scheduler, a
     * click — this is a new chain of its own. See {@link Frame.dispatch}.
     */
    parent?: Frame,
  ): Promise<Value> {
    // a DreamFactory 5 load runs no scripts while it rebuilds (see restoringV5)
    if (this.session.restoringV5) return 0;
    const inst = this.resolveEventTarget(cmd, targetName, handler);
    const chain = this.buildEventChain(cmd, inst, handler);
    if (!chain.length) {
      // Two different things can mean "target not loaded", and only one of them
      // is a fault. A name nothing answers to is a real miss; a target that IS open
      // and simply has no handler for this event is the engine working — the boot
      // fires `sendtoshop(curworldchar, updateallfx())` for every Timelapse world
      // and only `m.shp` implements it. Reported apart so a log line means one
      // thing.
      this.session.onLog(
        inst
          ? `${cmd}("${targetName}", ${handler}(..)) — no ${handler} handler on ${inst.name}`
          : `${cmd}("${targetName}", ${handler}(..)) — target not loaded`,
      );
      return 0;
    }
    // EXPERIMENT: `target` is the ADDRESSEE where the addressee is
    // a THING — a prop, an actor, a scene, a flat. Where it is a FILE (a shop, a
    // cast, the stage, a puppet, the boot) there is no thing being addressed and
    // `target` stays the caller's context.
    const OBJECT_ADDRESSEE = /^sendto(prop|actor|scene|flat)(fx)?$/;
    const evTarget = OBJECT_ADDRESSEE.test(cmd) ? targetName || callerName : callerName;
    // A KEY event's chain ends at the boot library, because that is where the
    // default movement lives: TAOOT's boot holds two keydown handlers and they are
    // a pair. The first is the router — it maps the player's own movement keys
    //
    //     switch (arg)
    //     case keynorth      arg = "uparrow"      ← "w" by default
    //     case keywest       arg = "leftarrow"    ← "a"
    //     case keyeast       arg = "rightarrow"   ← "d"
    //     endswitch
    //     sendtoscene (currentscene (), keydown (arg))
    //
    // and the second is what the re-routed event has to land on
    // (`case "leftarrow": currentscene("left")`). Reaching it along THIS chain is
    // what carries the mapped value; running the two boot handlers side by side
    // instead — which is what we did — gave the second one the key the player
    // actually pressed, so the arrows worked and the A/W/D bindings the control
    // panel offers did nothing at all (#14).
    //
    // `isRunning` is what makes it safe: a script already running this handler
    // further up the stack is refused, so the router cannot resolve its own
    // re-route back into itself. That cycle is why the boot was kept off every
    // fallback list, and it showed as an out-of-memory rather than a wrong answer
    // — TAOOT's TURK scene134 has a script with no keydown of its own.
    const keyEvent = handler === "keydown" || handler === "keyrepeat";
    if (keyEvent) {
      for (const b of this.session.bootScripts) {
        if (!chain.includes(b) && !this.session.interp.isRunning(b, handler)) chain.push(b);
      }
    }
    /**
     * DreamFactory 5 ends a scene's, a set's, an actor's and a cast's chain on
     * the POST SCRIPT, the BOOTFILE's library: RedJack.exe names the links as it
     * builds them — "Scene Script: ", "Set Script: ", "Post Script: " +
     * "BootFile" for `sendtoscene` (0x440ab0), "Actor Script: ", "Cast Script: ",
     * "Post Script: " for `sendtoactor` (0x404ff0), and the same for
     * `sendtoset` (0x440de0) and `sendtocast` (0x405370), and "Prop Script: ",
     * "Shop Script: ", "Post Script: " for `sendtoprop` (0x42b550). The library is the
     * boot's second container, where `sendtopost (advanceday ())` lands.
     *
     * The cannon is what needs it: the boot routes a click in cannon.sett to the
     * scene, the set's `mousedown` tilts the barrel and `passcode`s, and only the
     * library's `mousedown` fires — `sendtoprop ("cannon", fire ())`. Not while
     * the library is already running the handler, as for the keys above.
     */
    const post = this.session.isV5 && /^sendto(scene|set|actor|cast|prop)(fx)?$/.test(cmd) ? this.session.bootScripts[1] : undefined;
    if (post && !chain.includes(post) && !this.session.interp.isRunning(post, handler)) chain.push(post);
    /**
     * `me` is the PROP, not its sprite group, on the prop's own script.
     *
     * `me` is otherwise the running script's name, which is right for every
     * fallback in the chain — a shop main answering for one of its props is
     * itself, and keys on `target`. But a prop's own script is the prop's, and
     * with `propinstance` one script belongs to several props at once:
     * Timelapse's lantern is six of them out of the "Lantern" group, and the
     * script tells them apart by `me` alone —
     *
     *     code mousedown (arg)
     *         switch (me)
     *             case "PrimeLever"  …
     *             case "GasKnob"     if gGasKnobDir = 0 …
     *
     * — so with `me` fixed at the group's name every one of those cases missed.
     * The click arrived, the handler ran, the switch matched nothing and returned
     * 0. Reported as the lamp in the cave not being clickable: no cursor over any
     * of its parts and no response from any of them.
     *
     * Only the prop's OWN script (`chain[0]`), and only for a prop: everywhere
     * else in the corpus the two names are the same string, so this changes
     * nothing that was already working.
     */
    const propOwn = /^sendtoprop(fx)?$/.test(cmd) && !!evTarget;
    const room = this.session.maze;
    const { value, ran, passed, visited } = await this.session.runHandlerChain(
      chain,
      handler,
      args,
      (link) => ({ me: propOwn && link === inst ? evTarget : link.name, target: evTarget }),
      !keyEvent,
      parent,
    );
    // `passcode` means "not mine, ask whoever holds me" — so a chain that ends on
    // one keeps going up the containment chain, exactly as a chain that had no
    // handler at all does. Only the LAST link matters: the loop above already
    // walks a passcode along the chain, and this is what happens when it runs out.
    //
    // The measured case is TAOOT's `inven.shp` notebook (container 0088): its own
    // `setcursor` answers `cursor("arrow")` for the one view where the notebook is
    // scenery on the smokestack platform, and `passcode`s everywhere else — onto
    // the shop main's distance-gated `cursor("touch")`. Without this the passcode
    // was a dead end and the notebook had no cursor at all.
    // ...and nor does its containment: a door's script is parented to the room
    // it leads OUT of (see runHandlerChain)
    if (room && this.session.maze !== room && inst && room.owns(inst)) return value;
    if ((!ran || passed) && inst) {
      return this.resolveViaContainment({ cmd, inst, handler, args, evTarget }, value, visited, parent);
    }
    return value;
  }

  /**
   * The script instance a sendto* command names, with per-command fallbacks for
   * targets that exist but carry no script of their own.
   *
   * A name says nothing about WHAT it names, and two kinds of thing can answer
   * to the same one: an overlay's prop and a character. The corpus has exactly
   * two such collisions and both are a mini-game's opponent — `fight.shp`'s
   * `vlad` and `fence.shp`'s `willie`, each a screen-space prop drawn over the
   * room the cast member of that name is standing in. So the COMMAND has to pick
   * the kind: `sendtoactor` means the character, whatever else is open.
   *
   * Without that it meant the prop, because both lookups below reach
   * `propScripts` first. `fight.stg`'s `endfight` is where it showed (#84): it
   * closes the fistfight with
   *
   *     actorowner ("vlad", "lostfight")                ← a builtin, resolves the actor
   *     sendtoactor ("vlad", setupactor ("lostfight"))  ← went to the PROP
   *
   * and the fight overlay's prop has no `setupactor`, so the event was dropped
   * without a word (a chain that runs nothing reports nothing). Vlad therefore
   * kept the pose and position he had before the fight — standing, and turned to
   * face you by the `vladidle` loop the moment `transfromflat` un-paused it —
   * instead of lying on the catwalk. The losing branch's `putdownactor()` went
   * the same way, which is why he was still on his feet after knocking you out
   * too. Turning away and back looked like a cure because it re-fires the scene's
   * own `openscene`, and by then `actorowner` — a builtin, which never had the
   * problem — says `lostfight`.
   */
  private resolveEventTarget(cmd: string, targetName: string, handler = ""): ScriptInstance | null {
    /**
     * An event ADDRESSED TO A FLAT resolves on the flat's own script first,
     * when that script actually has the handler.
     *
     * The generic name lookup below can be shadowed: Dust names its inventory
     * flat "avatar" and ALSO has an "avatar" prop (the player portrait in
     * HOUSE.PRP), and the prop's instance won — so the flat loop the
     * inventory's openflat arms (`makeloop("flat", currentflat(),
     * "cashupdate", 2)`) fired `sendtoflat("avatar", cashupdate())` into a
     * prop script with no such handler, and the CASH readout stayed blank.
     * Gated on `has(handler)` so a flat-addressed event whose flat cannot
     * answer still falls through to the shared-handler chain exactly as
     * before (TAOOT's fencing relies on that stage-main fallback).
     */
    const flatFirst =
      cmd === "sendtoflat" ? this.session.flatScripts.get(targetName.toLowerCase()) : undefined;
    /**
     * DreamFactory 5's `sendtocast` looks among the open CASTS and nowhere else:
     * RedJack.exe 0x405370 reads the name and walks the cast table (28-byte
     * records, the name at +0xc) for it. The chain below finds the room first,
     * and RedJack names a room and its cast alike — `sendtocast ("ship",
     * initactors ())` went to ship.sett's main, which has no `initactors`, and
     * the ship's crew never came aboard. Gated on v5.
     */
    const castFirst = cmd === "sendtocast" && this.session.isV5 ? this.session.resourceCtrl.castMainFor(targetName) : null;
    // ...and its `sendtoprop` among the PROPS (0x42b550 finds the name in the prop
    // table): cannon.shop's "cannon" is a prop in cannon.sett, and the boot's
    // `sendtoprop ("cannon", fire ())` reached the room's main instead
    const propFirst =
      /^sendtoprop(fx)?$/.test(cmd) && this.session.isV5 ? this.session.resourceCtrl.propScriptFor(targetName.toLowerCase()) : null;
    // ...and a shop by the names `closeshopfile` knows it by, the one it gives
    // itself among them: jcombat.shop calls itself "combat", and the alley fight
    // asks `sendtoshop ("combat", moveobjects ())` every step (see openShopKey)
    const shopFirst =
      /^sendtoshop(fx)?$/.test(cmd) && this.session.isV5 ? this.session.resourceCtrl.shopMains.get(this.session.resourceCtrl.openShopKey(targetName)) ?? null : null;
    // ...and its `sendtoquad` among the room's QUADS (0x446570 → 0x446190 walks
    // the set's 80-byte quad records, the name at +0x1c): horn4.sett calls itself
    // "horn", as it does the quad the horn stands on, and the boot's
    // `sendtoquad ("horn", mousedown (…))` reached the set's main, whose
    // `mousedown` walks on — the horn could not be blown
    const quadFirst =
      /^sendtoquad(fx)?$/.test(cmd) && this.session.isV5 ? this.session.maze?.quadScript(targetName) ?? null : null;
    let inst =
      castFirst ??
      propFirst ??
      shopFirst ??
      quadFirst ??
      (flatFirst?.script.codes.has(handler) ? flatFirst : null) ??
      (ACTOR_ADDRESSEE.test(cmd) ? this.session.castScripts.get(targetName.toLowerCase()) : null) ??
      this.session.currentBinding?.findInstance(targetName) ??
      this.session.maze?.findInstance(targetName) ??
      this.session.resourceCtrl.findGlobalInstance(targetName);
    if (!inst && cmd === "sendtostage") inst = this.session.stageScript;
    /**
     * `sendtoboot` addresses THE BOOT, which is every one of its containers and
     * not just the first.
     *
     * A BOOTFILE is a stack of script containers — container 1 the boot proper,
     * container 2 the library — and {@link boot} is container 1 alone, because
     * that is where the entry points a host calls live. TAOOT never noticed the
     * difference: all six things its scripts `sendtoboot` are in container 1.
     *
     * Timelapse's interface family is not. `endinterface` (11 call sites),
     * `begininterface` (4) and `docamera` (2) are container 2's, so every one of
     * those dead-ended on container 1 having no such handler — and the panel's
     * own buttons are exactly those call sites. Clicking the camera ran its
     * `mousedown`, set `retinter`, and then asked the boot to close the panel and
     * take the picture; both asks resolved to a script that could not answer, so
     * the panel just sat there. Same for the journal, the photo album and the
     * gene pod, and for the `ok` button that leaves the panel.
     *
     * Gated on the handler being ABSENT, so nothing that already resolved moves:
     * `keydown` is defined in both containers and its 24,349 call sites keep
     * reaching container 1's, which is the one the port has always run.
     */
    /**
     * ...and `sendtopost` addresses it too.
     *
     * "post" is a target this port had registered as a deferred form and then
     * resolved to the STAGE script, which is where the implicit-target branch in
     * `registerDispatchBuiltins` sends anything that is not `sendtoboot`. Nothing
     * in Timelapse's 110 `sendtopost` calls is a stage handler. Every one of the
     * seven names they use — `gotostage` (58 calls), `jumptoframe` (29),
     * `righttoframe`, `lefttoframe`, `invdropcur`, `gototheme`, `invnewprop` — is
     * defined in the BOOTFILE library and NOWHERE else in the corpus, so all 110
     * resolved to a script that could not answer and returned 0 in silence.
     *
     * What that is from the player's side is a click that shows the right cursor
     * and does nothing. The cave's lantern is four of them: the approach views
     * (i0090.867/.877/.967/.977) each carry a `Lantern` region whose whole
     * mousedown is `sendtopost (jumptoframe (873))` — walk up to the lamp — and
     * clicking the lamp did nothing at all. The other 58 are stage-to-stage
     * moves.
     *
     * Whether the 1996 engine's "post" is the boot by another name or an object
     * of its own that falls through to it is NOT settled here; what is settled is
     * where the handlers are. The gate is the same as the boot's above — only a
     * handler the addressed script does not have goes looking — so a stage that
     * does answer for one still wins, and nothing that already resolved moves.
     */
    if (/^sendto(boot|post)(fx)?$/.test(cmd) && !inst?.script.codes.has(handler)) {
      inst = this.session.bootScripts.find((b) => b.script.codes.has(handler)) ?? inst ?? this.session.boot;
    }
    // a flat is contained in its stage: an event to a flat with no own script
    // (TAOOT's fencing: per-flat click regions carry the scripts, not the flat
    // itself) resolves on the stage main, where shared handlers live (its
    // pointgoesto()/centerstage()/setupsmallprops). (findInstance already returns
    // the flat's own script when one exists, so this fallback only fires when it
    // doesn't.)
    if (!inst && cmd === "sendtoflat") inst = this.session.stageScript;
    // a prop with no script of its own (TAOOT: a fuse in the fusebox bank)
    // resolves on its owning shop's main, where the shared handler dispatches by
    // `target` (fuseoff/fuseon do propview(target,…)). Mirrors the viewer's
    // prop-click dispatch so prop RUN LOOPS — makeloop("prop", name, handler) —
    // resolve too; without it a scriptless prop's loop fired into nothing (the
    // fuse never settled).
    if (!inst && cmd === "sendtoprop") {
      const pi = this.session.propRuntime.get(targetName);
      if (pi) inst = this.session.shopMain(pi.shop.name);
    }
    // The same for an actor with no script of its own, resolving on its owning
    // CAST's main — where the shared character handlers live (`runpuppet`,
    // `initactor` via the boot, `stdactor`), all of them written against `target`
    // rather than `me`.
    //
    // A cast entry can be a STUB: TAOOT's 1996-demo gang.cst carries `smeth` —
    // Frank's contact, and the whole of the demo's first scene — with an 8-byte
    // script container and one empty pose, because everything he does is a puppet
    // conversation the cast main runs. Without this, `sendtoactor("smeth",
    // runpuppet("dsmeth.pup", "door"))` had no chain at all and was dropped as
    // "target not loaded": C71's door opened onto nobody.
    //
    // Gated on the cast main ACTUALLY HAVING the handler, which is the difference
    // between resolving an event and inventing a chain for it. A scriptless actor
    // is not a script and cannot own an event; its cast main is the only thing
    // that can answer for it, and where that cannot either, there is nothing to
    // run — which is precisely what the "target not loaded" line reports. Both
    // handlers full TAOOT sends to ITS stub (`purs`) are of that kind:
    // `playcrickets`, the loop gang.cst arms on him, and `initactor` are defined
    // in no script in the tree. Resolving them anyway walked a chain to the boot
    // library, found nothing there either, and returned the same 0 — but the extra
    // await points along the way reordered the crowd extras' star assignment on
    // the boat deck, which two playthrough segments record.
    if (!inst && cmd === "sendtoactor") {
      const ai = this.session.actorRuntime.get(targetName);
      const main = ai ? this.session.resourceCtrl.castMains.get(ai.cast.name.toLowerCase()) : null;
      if (main?.script.codes.has(handler)) inst = main;
    }
    return inst;
  }

  /** the ordered list of scripts the event traverses (exitcode stops it) */
  private buildEventChain(
    cmd: string,
    inst: ScriptInstance | null,
    handler = "",
  ): ScriptInstance[] {
    const chain = inst ? [inst] : [];
    // a DreamFactory 5 quad sits in the node you are looking from: quad → node
    // → set → stage, as a v4 hotspot's object → scene → set → stage
    if ((cmd === "sendtoquad" || cmd === "sendtoquadfx") && this.session.maze) {
      for (const link of [this.session.maze.nodeScript(), this.session.maze.main, this.session.stageScript]) {
        if (link && !chain.includes(link)) chain.push(link);
      }
    }
    if (cmd === "sendtoscene" || cmd === "sendtoscenefx" || cmd === "sendtoset") {
      const main = this.session.currentBinding?.main ?? this.session.maze?.main;
      if (main && main !== inst) chain.push(main);
      if (this.session.stageScript && this.session.stageScript !== inst) chain.push(this.session.stageScript);
    }
    // sendtostage falls through to the boot library when neither the stage nor
    // its main handles the event — the boot holds a title's game-global handlers
    // (TAOOT: the day machine, `advanceday`/`advancetour`). TAOOT's bombit()
    // ends with `sendtostage(advanceday())` to jump Frank from the London flat
    // to the Titanic; without this fallback advanceday no-ops on MAIN.STG (which
    // has no such handler) and the screen stays black after bedex.mov.
    // suppressStageBootFallback: the host's coldBoot runs boot() for its front
    // half (movies/resource loads) but performs the day-advance itself, AFTER
    // resetting currentset→"none" and the mix volumes. TAOOT's boot() ends with
    // its own `sendtostage(advanceday())`; with this fallback live that would
    // fire during runGlobal("boot") — before coldBoot's setup — running
    // advanceday on stale state (clock="startdisk1" then a second advance to
    // clock="bedsit" skips the flat straight to the Titanic). The flag mutes
    // ONLY that boot-internal call.
    if (cmd === "sendtostage" && !this.session.suppressStageBootFallback) {
      for (const b of this.session.bootScripts) if (b !== inst && !chain.includes(b)) chain.push(b);
    }
    // A prop or an actor with NO script of its own still has the boot library
    // behind it, and that is where a title keeps its defaults — written against
    // `target`, because the boot is answering for something else:
    //
    //     code initprop ()                    code resetactor ()
    //         propvisible (target, false)         actorowner (target, "none")
    //         propvalue (target, 0)               actorvalue (target, 0)
    //         propdeg (target, 0)                 initactor ()
    //
    // 70 of the 72 props two open shops give you rely on that default (only
    // `door` and `signs` carry their own), and all 25 cast members rely on the
    // other. A target WITH a script reaches them through containment below; a
    // stub has no `inst` for containment to climb from, so the event died as
    // "target not loaded" — the line the #89 report ends on. TAOOT ships one:
    // `purs` is an actor record with an eight-byte script container, and
    // `advanceday`'s reset loop sent him `resetactor()` to no effect, so the
    // purser still held the cufflink in the next game.
    //
    // GATED on the boot actually HAVING the handler, the same rule the cast-main
    // fallback is gated by: walking to the boot for a handler defined in NO
    // script — TAOOT sends `playcrickets` and `initactor` to this same stub —
    // buys nothing but await points, and those reordered the boat deck's crowd
    // extras badly enough for two playthrough segments to record it.
    //
    // ...and on the boot not ALREADY RUNNING that handler, because the boot holds
    // the click ROUTER as well as the defaults: `boot1.mousedown` hittests the
    // point and re-sends to whatever is under it, so a stub actor's missing
    // `mousedown` would resolve back into that router, which hittests the same
    // unmoved point and sends again ("dispatch cycle: boot1.mousedown at depth
    // 64", every click on a walker eaten). `isRunning` is the guard the keydown
    // fallback above is built on, and it is the right one here rather than "did
    // the boot dispatch this at all" — the boot dispatches the reset loop too,
    // and that has to reach the boot's own default. Re-entering ONE handler is
    // the cycle; one boot handler calling out to another is the library working.
    if (!chain.length && (cmd === "sendtoprop" || cmd === "sendtoactor")) {
      for (const b of this.session.bootScripts) {
        if (b.script.codes.has(handler) && !this.session.interp.isRunning(b, handler)) chain.push(b);
      }
    }
    /**
     * ...and a FLAT falls through to the boot too — but gated on the CHAIN not
     * already answering, rather than on it being empty.
     *
     * The difference matters here and nowhere else: a flat with no script of its
     * own resolves to its STAGE (just above), so the chain is never empty for a
     * flat and the emptiness test could not fire. What is actually true in the
     * failing case is narrower — nothing in the chain has the handler.
     *
     * Timelapse animates a stage by walking a run of flats, and the routine that
     * walks them lives in the BOOTFILE: `flattick` does `gotoflat(baseflat @ "."
     * @ n)` and re-arms itself with `makeloop("flat", baseflat, "flattick", d)`.
     * A flat loop fires on the CURRENT flat (Scheduler.fireLoop), which by the
     * second frame is `i0001.100.2` — an animation cel with no script — so the
     * event reached the stage main, found no `flattick` there, and the walk
     * stopped one frame in. Measured: the birds moved once and froze.
     *
     * Titanic and Dust are untouched by it. Neither calls `flatstartanim` at all,
     * and this can only add a link where every existing one has ALREADY been
     * found not to have the handler — which is to say, where the event is being
     * dropped today. The two other guards are the ones the prop/actor fallback
     * uses and for the same reasons: the boot must actually define it, and must
     * not already be running it (the boot holds the click router as well as the
     * library, and re-entering one handler is the dispatch cycle).
     */
    if (cmd === "sendtoflat" && !chain.some((c) => c.script.codes.has(handler))) {
      for (const b of this.session.bootScripts) {
        if (b.script.codes.has(handler) && !this.session.interp.isRunning(b, handler) && !chain.includes(b)) {
          chain.push(b);
        }
      }
    }
    return chain;
  }

  /**
   * Run `handler` along an ordered chain of scripts — THE event-traversal
   * rule, shared by the sendto* chain ({@link sendEvent}), containment
   * resolution ({@link resolveViaContainment}) and the stage's
   * region→flat→stage click routing (StageController.stageClickAt): a link
   * without the handler is skipped; a link that ran stops the walk unless it
   * `passcode`d on; a consumed event ({@link Interpreter.eventConsumed})
   * always stops it. `passed` is true when the LAST link to run passed the
   * event on and the chain then ran out — the caller carries on up the
   * containment chain, as `passcode` asks.
   *
   * NOT for the walkers whose rules differ on purpose: SetScripts'
   * fireLifecycle (consumption by the handler's own signal, and it continues
   * past a link that throws), sendToButton's library fallback (first match
   * wins, no passcode climb) and runGlobal (first match wins).
   */
  async runHandlerChain(
    chain: (ScriptInstance | null | undefined)[],
    handler: string,
    args: Value[],
    ctxFor: (link: ScriptInstance) => CallCtx,
    /**
     * Whether a link that RAN ends the walk. True for every event but the
     * keyboard's, where the original's rule is different and the corpus shows it:
     * `deckbd.set`'s keydown is a ladder of `if currentview() = "viewNN" & arg =
     * "uparrow" … exitcode`, and for any other key it simply falls off the end. If
     * that ended the walk, no arrow would ever reach the boot's default movement
     * — so for a key event only `exitcode` stops the chain (see
     * SetScripts.keyDown, which has always said this).
     */
    stopOnHandled = true,
    /** the frame this chain is being run FROM, if a script is running it — see
     *  {@link sendEvent} and {@link Frame.dispatch} */
    parent?: Frame,
  ): Promise<{ value: Value; ran: boolean; passed: boolean; visited: ScriptInstance[] }> {
    let value: Value = 0;
    let ran = false;
    let passed = false;
    const visited: ScriptInstance[] = [];
    const room = this.session.maze;
    for (const link of chain) {
      if (!link?.script.codes.has(handler)) continue;
      /**
       * A DreamFactory 5 room's scripts stop answering once the room is gone.
       * RedJack's doors are a `mousedown` that does `gotonode` into the next room
       * and then `passcode`s, and the rest of the chain was the room just left:
       * its main's `mousedown` ran `keydown ("up")` in the new room and turned
       * you to its nearest exit the moment you arrived.
       */
      if (room && this.session.maze !== room && room.owns(link)) continue;
      ran = true;
      visited.push(link);
      const res = await this.session.interp.runHandler(link, handler, args, ctxFor(link), parent);
      value = res.value;
      passed = res.passed;
      if (this.session.interp.eventConsumed) break;
      if (stopOnHandled && res.handled && !res.passed) break;
    }
    return { value, ran, passed, visited };
  }

  /**
   * Nothing in the chain had the handler: the target resolves it through its
   * CONTAINMENT chain (prop -> shop main, where initprop() lives; then the
   * stage), with me = the target. Deliberately NOT the boot scripts in
   * general: a boot's keydown routes events via sendtoscene, so resolving a
   * scene's missing keydown back into boot would recurse forever (TAOOT's TURK
   * scene134 has a script without keydown — user-reported OOM). EXCEPTION:
   * actor-lifecycle helpers (TAOOT: putdownactor/moveactorstar/moveactorxyz)
   * live in the BOOTFILE and are dispatched via sendtoactor(name,
   * putdownactor()); most casts don't override them, so an actor's putdownactor
   * must reach the boot fallback — without it the officer/Sasha never hid
   * ("actor doesn't leave"). Scoped to sendtoactor so the keydown/scene
   * recursion above is unaffected.
   */
  private async resolveViaContainment(
    { cmd, inst, handler, args, evTarget }: {
      cmd: string;
      inst: ScriptInstance;
      handler: string;
      args: Value[];
      evTarget: string;
    },
    fallback: Value = 0,
    visited: ScriptInstance[] = [],
    /** the frame the `sendto*` was written in — see {@link sendEvent} */
    parent?: Frame,
  ): Promise<Value> {
    const libs: ScriptInstance[] = [];
    for (let p = inst.parent; p; p = p.parent) libs.push(p);
    if (this.session.stageScript && this.session.stageScript !== inst) libs.push(this.session.stageScript);
    // ...and NOT when the boot library is what dispatched this very event.
    // A boot's mousedown routes a click with `sendtoactor(thename,
    // mousedown(thepoint))`; an actor with no mousedown anywhere in its chain
    // (TAOOT's demo crowd-walker cast member `extra` — gang.cst's main has no
    // mousedown either) resolved it right back into boot1.mousedown, whose
    // hittest found the same actor under the same point: the reported
    // "dispatch cycle: boot1.mousedown at depth 64", and the click was eaten.
    // The original cannot be routing input back into its own router — TAOOT's
    // demo ships that exact actor — so the fallback is for events the boot
    // did NOT originate: dispatched under a different outer handler, the
    // lifecycle helpers this exception exists for still resolve (closescene
    // sending putdownactor arrives on a chain dispatched as "closescene").
    // The event is the SENDING FRAME's, not an interpreter-wide "outermost
    // dispatch" — chains overlap; see Frame.dispatch.
    //
    // A PROP is the same case one command over: `initprop`, the
    // boot's default that hides a prop and zeroes it, is what 70 of the 72 props
    // two open shops give you rely on — only `door` and `signs` carry their own.
    // So `addinven`'s opening `sendtoprop ("invenhelp", initprop ())`, which takes
    // the HELP button down before putting the item you were just handed in its
    // place, would reach nothing and the item be drawn on top of HELP (#123).
    if (
      (cmd === "sendtoactor" || cmd === "sendtoprop") &&
      parent?.dispatch !== handler
    ) {
      for (const b of this.session.bootScripts) if (!libs.includes(b)) libs.push(b);
    }
    // A link the chain already ran must not run twice. It can be on both lists:
    // a scene's chain is scene -> set main -> stage, and the stage is also the
    // last thing containment would try — so a stage handler that passcodes used
    // to be the one that got run again. (And a passcode here keeps climbing —
    // the shared traversal rule, see runHandlerChain.)
    const res = await this.session.runHandlerChain(
      libs.filter((l) => !visited.includes(l)),
      handler,
      args,
      () => ({ me: inst.name, target: evTarget }),
      true,
      parent,
    );
    return res.ran ? res.value : fallback;
  }

  /** sendtopainting(scene, view, paint, handler(args)): fire an event at a named
   *  hotspot in a view (a boot's SPACE door opener routes mousedown here). */
  sendToPainting(
    scene: string,
    view: string,
    paint: string,
    handler: string,
    args: Value[],
    /** the frame a script sent it from — see {@link sendEvent} */
    parent?: Frame,
  ): Promise<boolean> {
    return (
      this.session.currentBinding?.paintingEvent(scene, view, paint, handler, args, parent) ??
      Promise.resolve(false)
    );
  }
}
