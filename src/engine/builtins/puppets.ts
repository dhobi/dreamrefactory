import { toNum, toStr, truthy } from "../interp";
import { decodeText } from "../../df/text";
import { BuiltinCtx } from "./context";

/**
 * Puppet (PUP conversation) commands: open/close, speak/clear, choice bevels,
 * the modal puppetevent wait, visibility, and render params.
 */
export function registerPuppetBuiltins(ctx: BuiltinCtx): void {
  const { session, r } = ctx;

  r("openpuppetfile", async (_i, [n]) => ((await session.puppetCtrl.openPuppetFile(toStr(n ?? ""))) ? 1 : 0));
  r("closepuppetfile", () => session.puppetCtrl.closePuppetFile());
  // The puppet's OWN name (PupFile.pupName, container 0 +0x85E), not the file it
  // came out of. TI.EXE's openpuppetfile copies that field into a static buffer
  // and currentpuppet hands the buffer back (0x43f103 / 0x43ffba); answering
  // "purs1.pup" where the original answers "purs1" is a value no script can
  // match. TAOOT's inven.shp picks the wording for offering the item you are
  // holding with `switch currentpuppet()` over "trask1"/"trask2"/"purs1"/"zeit1",
  // so the Purser asked "Would you like something...?" — the switch's generic arm
  // — instead of "I would like to check something in..." (#53).
  r("currentpuppet", () => session.puppet?.pup.pupName || (session.puppet ? session.puppet.name : "none"));
  r("puppetspeak", (_i, [ident]) => session.puppetCtrl.puppetSpeak(toStr(ident ?? "")));
  r("puppetclear", () => session.puppetCtrl.puppetClear());
  // the bevel caption is a script string literal, so it is localised text and
  // arrives as raw bytes — the only place a puppet's choices are written down
  r("puppetbevel", (_i, [text, id]) =>
    session.puppetCtrl.puppetBevel(decodeText(toStr(text ?? ""), session.textEncoding()), toNum(id ?? 0)),
  );
  r("puppetevent", (_i, [_timeout]) => session.puppetCtrl.puppetEvent());
  r("countpuppets", () => session.puppet?.scripts.size ?? 0);
  r("indextopuppet", (_i, [idx]) => {
    return [...(session.puppet?.scripts.keys() ?? [])][toNum(idx ?? 0) - 1] ?? "";
  });
  // puppetbase(ident): seat the character in a line's resting pose (TAOOT: bx2
  // with/without the baby); "" reverts to the neutral opening pose
  r("puppetbase", (_i, [ident]) => session.puppetCtrl.puppetBase(toStr(ident ?? "")));
  // puppetvisible(v): show/hide the conversation close-up while keeping the
  // puppet LOADED. TAOOT's blackjack toggles this to swap between the dealer
  // and the table (newgame hides Buick to deal; playagain shows him to ask again).
  // Without it the dealer stayed drawn over the table and the game "hung".
  r("puppetvisible", (_i, [v]) => {
    const p = session.puppet;
    if (!p) return 0;
    if (v === undefined) return p.visible ? 1 : 0;
    p.visible = truthy(v);
  });
  // puppetparam(slot[, value]): TI.EXE puppet render params, indexed by slot.
  // Getter with one arg, setter with two. Slot 7 is the subtitles-enabled flag
  // (TAOOT's CTL.STG subtoggle lever writes it: 0 = off, 1 = on; openflat reads it
  // to pick the lever's idleon/idleoff view). The viewer gates subtitle drawing
  // on it (session.subtitlesOn). Other slots (9/10 = gesture params from boot)
  // are stored but otherwise unused.
  r("puppetparam", (_i, [slot, value]) => {
    const s = toNum(slot);
    if (value === undefined) return session.puppetParams.get(s) ?? (s === 7 ? 1 : 0);
    session.puppetParams.set(s, toNum(value));
    return 0;
  });
  // remaining puppet effects are rare and unverified: puppetsubtitle (override
  // text), puppetgrab (hold an item in-frame), puppetscramble (garbled face)
  for (const stub of ["puppetsubtitle", "puppetgrab", "puppetscramble"]) {
    r(stub, () => {});
  }
}
