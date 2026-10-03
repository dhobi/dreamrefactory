/**
 * Where the words of TAOOT's ending are (#50; GameSession.captionSources).
 *
 * The ending — NARREND.STG's `opennarend` — is a run of newspaper pictures with
 * a voice over each, `voicesound("n." @ …)` out of NARREND.SFX, and nothing
 * on screen to read. The words are on the disc all the same: NARRATE.PUP, a
 * puppet no script opens, is the script the clips were recorded from, a line
 * per clip — and in the German and French editions, translated.
 */
import type { GameSession } from "@dreamfactory/engine/runtime/session";

export const NARRATION_BANK = "narend.sfx";

/**
 * The NARRATE.PUP line a NARREND.SFX clip speaks.
 *
 * The clips were named one letter later than the lines: a sentence split in two
 * is `n.14` + `n.14a` in the puppet and `n.14` + `n.14b` in the bank, and
 * lines `n.46`, `46a`, `46b` are clips `n.46`, `46b`, `46c` — the order the
 * ending's own play lists give them in (`"8,44,45,46,46b,46c,47,48,soviet.01"`).
 * So the same name is the WRONG line where both exist: clip `n.46b` is line
 * `n.46a`, not `n.46b`. The one other mismatch is lines `n.05a`/`n.06`, which
 * are clips `n.06`/`n.06b` by their lengths (2.7 s cannot be `n.06`'s 104
 * characters); no list plays either.
 */
export function narrationLine(clip: string): string {
  if (clip === "n.06") return "n.05a";
  if (clip === "n.06b") return "n.06";
  return clip.replace(/^(n\.\d+)([b-z])$/, (_, n: string, c: string) => n + String.fromCharCode(c.charCodeAt(0) - 1));
}

export const NARRATION_WORDS = {
  puppet: "narrate.pup",
  line: narrationLine,
} satisfies Parameters<GameSession["captionSources"]["set"]>[1];
