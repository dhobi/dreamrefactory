import { toNum, toStr, truthy } from "../interp";
import { BuiltinCtx } from "./context";

/**
 * Puppet (PUP conversation) commands: open/close, speak/clear, choice bevels,
 * the modal puppetevent wait, visibility, and render params.
 */
export function registerPuppetBuiltins(ctx: BuiltinCtx): void {
  const { session, r } = ctx;

  r("openpuppetfile", async (_i, [n]) => ((await session.openPuppetFile(toStr(n ?? ""))) ? 1 : 0));
  r("closepuppetfile", () => session.closePuppetFile());
  r("currentpuppet", () => session.puppet?.name ?? "none");
  r("puppetspeak", (_i, [ident]) => session.puppetSpeak(toStr(ident ?? "")));
  r("puppetclear", () => session.puppetClear());
  r("puppetbevel", (_i, [text, id]) => session.puppetBevel(toStr(text ?? ""), toNum(id ?? 0)));
  r("puppetevent", (_i, [_timeout]) => session.puppetEvent());
  r("countpuppets", () => session.puppet?.scripts.size ?? 0);
  r("indextopuppet", (_i, [idx]) => {
    return [...(session.puppet?.scripts.keys() ?? [])][toNum(idx ?? 0) - 1] ?? "";
  });
  // puppetbase(ident): seat the character in a line's resting pose (bx2 with/
  // without the baby); "" reverts to the neutral opening pose
  r("puppetbase", (_i, [ident]) => session.puppetBase(toStr(ident ?? "")));
  // puppetvisible(v): show/hide the conversation close-up while keeping the
  // puppet LOADED. Blackjack toggles this to swap between the dealer and the
  // table (newgame hides Buick to deal; playagain shows him to ask again).
  // Without it the dealer stayed drawn over the table and the game "hung".
  r("puppetvisible", (_i, [v]) => {
    const p = session.puppet;
    if (!p) return 0;
    if (v === undefined) return p.visible ? 1 : 0;
    p.visible = truthy(v);
  });
  // puppetparam(slot[, value]): TI.EXE puppet render params, indexed by slot.
  // Getter with one arg, setter with two. Slot 7 is the subtitles-enabled flag
  // (the CTL.STG subtoggle lever writes it: 0 = off, 1 = on; openflat reads it
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
