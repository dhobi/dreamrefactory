import { toStr } from "../interp";
import { BuiltinCtx } from "./context";

/**
 * Event dispatch: the `sendto*` special forms (whose second argument is a
 * DEFERRED call executed against the target object's script), plus the small
 * `cursor`/`message` helpers that sit alongside them.
 */
export function registerDispatchBuiltins(ctx: BuiltinCtx): void {
  const { session, interp, r, log } = ctx;

  // sendto*("name", handler(args)): the second argument is a DEFERRED call,
  // executed against the target object's script — not evaluated locally
  for (const cmd of [
    "sendtoprop", "sendtoactor", "sendtoscene", "sendtoset", "sendtoshop", "sendtoshopfx",
    "sendtopuppet", "sendtocast", "sendtostage", "sendtoflat",
    "sendtoboot", "sendtopost", "sendtoserver",
    // sendtoactorfx/sendtocastfx: the fx variants resolve the same single
    // script as their non-fx siblings (our objects have one script), so they
    // dispatch identically — they were simply missing from this list.
    "sendtoactorfx", "sendtocastfx",
    // "fx" variants target the same object; our props have a single script,
    // so an fx call resolves the same handler as its non-fx sibling.
    // sendtopuppetfx runs a handler on the loaded puppet and returns its value —
    // TAOOT's blackjack newgame asks the dealer `sendtopuppetfx("boot script",
    // playagain())` whether to deal again. Without it registered as a deferred
    // form, the playagain() argument evaluated locally and recursed forever, so
    // a finished hand hung instead of offering another.
    "sendtopropfx", "sendtostagefx", "sendtopuppetfx",
    // ...and the three Dust asks for that Titanic never does. `extra.cst`'s
    // crowd router uses all three (sendtoflatfx, sendtopostfx, sendtoserverfx);
    // unregistered, their deferred argument evaluated locally instead.
    "sendtoflatfx", "sendtopostfx", "sendtoserverfx",
    // ...and the one Timelapse asks for. `sendtobootfx(GameOpen2())` is the
    // single-argument form — the target is implicit — and it is how the game
    // offers a save after the ending: `if not sendtobootfx (GameOpen2 ()) quit ()`.
    // Unregistered, `GameOpen2()` evaluated LOCALLY in the stage's frame, where
    // no such handler exists, so the branch read the handler's absence as a
    // refusal and the game quit on the player instead of offering the dialog.
    "sendtobootfx",
  ]) {
    interp.registerSpecial(cmd, async (ip, argExprs, frame) => {
      /**
       * ...unless this is a DreamFactory 1 game, where two of these ids are not
       * these commands at all.
       *
       * The two engines' command tables diverge on twenty ids (the list, and
       * where both tables were read from, is in engine/src/df/opcodes.ts) and Dust
       * calls eight of them. Two land here:
       *
       *     20021   v1 `rowcoltoscene`   v4 `sendtopostfx`
       *     20100   v1 `scenebuild`      v4 `sendtoserverfx`
       *
       * Neither v1 command takes a deferred call — `rowcoltoscene(row, col)`
       * names the scene at a grid cell and `scenebuild(name)` asks whether that
       * cell is built on — so as deferred forms they found no call in their
       * second argument, logged a complaint and answered 0. `extra.cst`'s bounty
       * hunters are what asks: their `isbuild` is
       *
       *     name = rowcoltoscene (y2, x2)
       *     if name = "none"      return true
       *     if scenebuild (name)  return true
       *
       * so with both answering 0 the hunters treated the whole town as open
       * ground and walked through the buildings. ROW first, then column, which is
       * the order the callers use and the same Y-first habit the rest of this
       * engine's rects have (`isbuild (scenecol (name), scenerow (name))` is the
       * other side of it).
       */
      if (session.isV1 && (cmd === "sendtopostfx" || cmd === "sendtopost")) {
        const row = await ip.evalExpr(argExprs[0], frame);
        const col = await ip.evalExpr(argExprs[1], frame);
        return ctx.sceneAt(row, col) ?? 0;
      }
      if (session.isV1 && (cmd === "sendtoserverfx" || cmd === "sendtoserver")) {
        const name = await ip.evalExpr(argExprs[0], frame);
        return ctx.sceneBuild(name) ? 1 : 0;
      }
      // sendtostage(call()) / sendtoboot(call()) take the deferred call as
      // their only argument — the target is implicit
      let targetName: string;
      let deferred = argExprs[1];
      if (argExprs.length === 1 && argExprs[0]?.t === "call") {
        // `startsWith`, not equality: `sendtobootfx` takes the same implicit
        // target its non-fx sibling does, and matching the exact name sent it to
        // the STAGE instead — the one place in this loop where the fx suffix
        // would have changed which object answered.
        targetName = cmd.startsWith("sendtoboot") ? "boot" : (session.stageScript?.name ?? "main.stg");
        deferred = argExprs[0];
      } else {
        targetName = toStr(await ip.evalExpr(argExprs[0], frame));
      }
      if (!deferred || deferred.t !== "call") {
        log(`${cmd}: no deferred call argument`);
        return 0;
      }
      // arguments of the deferred call ARE evaluated in the caller's frame;
      // resolution + containment-chain forwarding live on the session
      // (shared with makeloop firing)
      const args = await ip.evalArgs(deferred.args, frame);
      return session.sendEvent(cmd, targetName, deferred.name, args, frame.ctx.me, frame);
    });
  }

  // sendtopainting(scene, view, "paint", handler(args)): unlike the generic
  // sendto* (whose 2nd arg is the deferred call), this addresses a hotspot by
  // scene+view+identifier, so the deferred call is the FOURTH arg. Boot's keydown
  // uses it for SPACE (the door opener) and for forwarding setcursor/mousedown/
  // offerobject to the object under the pointer.
  for (const cmd of ["sendtopainting", "sendtopaintingfx"]) {
    interp.registerSpecial(cmd, async (ip, argExprs, frame) => {
      const scene = toStr(await ip.evalExpr(argExprs[0], frame));
      const view = toStr(await ip.evalExpr(argExprs[1], frame));
      const paint = toStr(await ip.evalExpr(argExprs[2], frame));
      const deferred = argExprs[3];
      if (!deferred || deferred.t !== "call") {
        log(`${cmd}: no deferred call argument`);
        return 0;
      }
      const args = await ip.evalArgs(deferred.args, frame);
      return (await session.sendToPainting(scene, view, paint, deferred.name, args, frame)) ? 1 : 0;
    });
  }

  // sendtobutton(flat, "name", handler(args)): unlike the generic sendto*,
  // this has THREE args — a flat, a region NAME, then the deferred call. It
  // dispatches to a flat's named click-region ("button"), the drop-target /
  // hotspot system stage mini-games use. sendtobuttonfx resolves the same.
  for (const cmd of ["sendtobutton", "sendtobuttonfx"]) {
    interp.registerSpecial(cmd, async (ip, argExprs, frame) => {
      const flat = toStr(await ip.evalExpr(argExprs[0], frame));
      const name = toStr(await ip.evalExpr(argExprs[1], frame));
      const deferred = argExprs[2];
      if (!deferred || deferred.t !== "call") {
        log(`${cmd}: no deferred call argument`);
        return 0;
      }
      const args = await ip.evalArgs(deferred.args, frame);
      return session.stageCtrl.sendToButton(flat, name, deferred.name, args, frame.ctx.me, frame);
    });
  }

  // cursor(name): the ONE way a script says what the pointer should look like.
  // On the session rather than the set binding, because a `setcursor` handler is
  // just as likely to run with no set open — every stage button's is (TAOOT: the
  // deck map, the inventory, the Enigma), and while the sink lived on the binding
  // those calls went nowhere.
  r("cursor", (_i, [name]) => {
    session.cursorName = String(name ?? "");
  });
  r("message", (_i, args) => log(`msg: ${args.map(String).join(" ")}`));
}
