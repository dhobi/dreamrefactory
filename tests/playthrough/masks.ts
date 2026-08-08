/**
 * Which globals a trace comparison must NOT compare, and why — in one place,
 * because there are two comparisons and they had drifted apart.
 *
 * The headless suite compares one host against its own recorded golden; the
 * browser suite compares a second host against that same golden. Both therefore
 * need to drop the same class of value: a counter whose reading is "how many
 * frames went by", which is a fact about the harness rather than about the story.
 * Each kept its own list, and the lists diverged — the browser suite was missing
 * `lastsail`, so segments 13 onward reported `browser 9926 vs golden 7478` on a
 * frame stamp the headless suite had already identified and masked. That is the
 * drift this module exists to make impossible: {@link isHarnessPaced} is imported
 * by both, and anything either one masks ALONE has to say so at its own call site.
 *
 * The asymmetry that remains is deliberate and documented where it lives: the
 * browser comparison masks strictly more (the clock pair `hrs`/`min`, the ambient
 * sequencers, the drawn crowd, the plant's water levels), because two hosts at one
 * instant disagree about more than one host does over time.
 *
 * Two predicates, because they are two different claims. {@link isHarnessPaced} is
 * a counter nothing reads, and both comparisons drop it. {@link isCoinFlip} is a
 * value the story DOES read, which the BROWSER drops and this host no longer needs
 * to — held apart so that "nothing here masks a value the story reads" stays true
 * of the first one.
 */

/**
 * Globals that count how long a host dwelt, not what the game did.
 *
 * `sec` is the pocketwatch's second hand, `clockcount` the calctime call counter
 * it rolls over from, and `attentionspan`/`…frame` are frame stamps. All are a
 * function of how many ticks a route spent getting somewhere, so any change that
 * makes the route quicker moves them while changing nothing about the story — and
 * the same drift makes them differ host to host at an instant.
 *
 * They no longer differ RUN TO RUN, and that sentence used to be here. It was
 * true, and it was a symptom: `walkAfterFade` polled `session.fading` — a value
 * that clears on the GAME clock — with `setTimeout(r, 0)`, so how many engine
 * steps the arrival walk landed after the fade depended on how loaded the machine
 * was (src/viewer.ts). Two identical headless runs diverged first at
 * `attentionspan` 15388 against 15393 in segment 10, every later segment
 * inherited it, and the run that lost the race failed outright with `gave up
 * hunting for max in recept1c`. On `session.nextFrame` all 27 goldens now record
 * BYTE-IDENTICAL across two full runs, and the only fields that moved against the
 * pre-fix recording were the ones in this list — no actor, no plant reading, no
 * `min`. So this list is now what its name says, a cross-HOST and cross-MODE
 * allowance, and a value here differing between two runs of one host is a fault
 * to chase rather than noise to expect.
 *
 * Measured headless, when `jump()` stopped waiting out a 4 s timeout the first
 * click was never going to satisfy: 15 of the 29 segments changed, and the ONLY
 * fields that moved were these. `hrs`, `min`, `clock`, `phase`, `mission` and
 * `sinkflag` all held. That is the boundary this list draws — the minute hand and
 * everything the sinking runs on stay asserted, so game time genuinely running
 * slow still fails a golden; only the sub-minute noise is dropped.
 *
 * `lastsail` is here from the other end. It is 0 through the first twelve
 * segments, becomes ~7474 during the fencing bout and never moves again — a frame
 * stamp, like `attentionspan`, whose name simply does not end in "frame". Nothing
 * in the corpus reads it: it appears in no decompiled script in the tree, so it
 * arrives from the shipped save's own variable table. It came out 7473 and 7481
 * across two identical continuous headless runs, and 9926 against 7478 across the
 * two hosts — the count of frames a real-time minigame took, and not a fact about
 * the story. (The 7473/7481 pair was the fade poll above and is gone; the
 * cross-host 2448 is not, and is why this stays.)
 *
 * `bjtime` is the same shape and the same story, one minigame later. `blkjack.stg`'s
 * `newgame()` ends `bjtime = tick()`, stamping when the hand was dealt, and nothing
 * in the corpus ever reads it back. Measured across two identical headless runs:
 * 1786850 against 1786700 — 150 ticks apart on a run that played the same cards and
 * won the same hand. A wall stamp, in a list of wall stamps. (That pair was the
 * same fade poll, and a `tick()` stamp is still a wall stamp across hosts.)
 */
export const isHarnessPaced = (name: string): boolean =>
  name === "sec" || name === "secframe" || name === "clockcount" ||
  name === "attentionspan" || name === "lastsail" || name === "bjtime" ||
  /frame$/.test(name);

/**
 * The one thing in the story decided by a COIN FLIP — masked by the BROWSER
 * comparison only, and no longer by the headless one.
 *
 * `restorescreen` (BOOTFILE 0002) offers the Gorse/Jones encounter on arrival in
 * three rooms — `if jumpset = "recept1c" | jumpset = "gstair2" | jumpset =
 * "gstair3"` then `if jonesok() dojones()` — and `jonesok` ends:
 *
 *     if random (100) < 50
 *         return false
 *     endif
 *     return true
 *
 * so whether it fires is one draw off the script stream.
 *
 * It was masked BOTH ways for one afternoon, because the crickets drew from that
 * same stream and re-arm on the clock, which made the coin a function of how long
 * the host dwelt getting there. Measured, carried segments 1-5: un-shadowing
 * `trackbut` took the run from 834 draws to 838 — four cricket re-arms — and the
 * coin came out 0 against 1, with `min`/`hrs` identical at 10:30. The crickets have
 * their own stream now (`GameSession.ambientRng`), which was the better fix and is
 * the one that got done, so on ONE host the coin is a function of the seed and the
 * route and the headless golden asserts it again.
 *
 * The browser keeps masking it, for the ordinary reason this comparison masks more:
 * two hosts do not dispatch the same number of idle-driven scripts, so cross-host a
 * script draw can still land in a different place. Measured before the split: these
 * three were the ONLY divergences in a full browser gate, 27/27 segments otherwise
 * agreeing to the credits. Whether the split closed that too is not yet known —
 * it needs one browser run to say, and until then this stays.
 *
 * What the mask costs on that host, stated plainly: `joneshint = 1` is read, and by
 * a branch — HALLC.SET's port-side door summons Burns's puzzle puppet
 * (`sendtoactor("burns", runpuppet("burns1.pup","puzzle"))`) instead of opening onto
 * C78. Masking the FLAG does not mask that: the puppet, `burnsphase` and every owner
 * they move stay compared, so a coin landing differently still surfaces in the
 * fields around it.
 */
export const isCoinFlip = (name: string): boolean =>
  name === "jonesphase" || name === "joneshint" || name === "jonesvalue";
