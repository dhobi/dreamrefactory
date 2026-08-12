/**
 * Holding up your end of a conversation.
 *
 * A PUP script speaks a line at a time and parks on `puppetevent` when it
 * offers choices; the plaques along the bottom of the screen are the answers.
 * Most of the story advances here — `advancephase()` is called from inside
 * these scripts more often than anywhere else — so a route has to be able to
 * say WHICH answer, by the bevel id the script switches on.
 *
 * Nothing is picked implicitly. An unplanned choice is a different story, so
 * the default when nothing planned is on offer is to stop and say so, and a
 * route that just wants to get past someone says as much explicitly with
 * `otherwise`.
 */
import type { NavDriver } from "./navigator";

export interface TalkPlan {
  /**
   * Bevel ids to pick, in order, each time they're offered. These are the
   * script's own numbers — PENNY1.PUP switches on 101/102 — so a route reads
   * against the decompiled conversation.
   */
  say?: number[];
  /**
   * What to do when none of `say` is on offer:
   *   "stop"  — end the conversation attempt and report (the default)
   *   "last"  — take the last plaque, which is where the exit line usually is
   *   "first" — take the first
   */
  otherwise?: "stop" | "first" | "last";
  /** safety net against a conversation that loops forever */
  maxTurns?: number;
}

export interface TalkResult {
  ok: boolean;
  /** bevel ids actually picked, in order */
  picked: number[];
  /** every set of choices offered, for a route that guessed wrong */
  offered: string[][];
  reason?: string;
}

/**
 * Talk until the conversation closes or the plan runs out.
 *
 * Between choices the speaker is talking; ESC skips the current line — and the
 * rest of that speech run with it, which is what a player does to move things
 * along. The driver's `skipLine` is that key, and it's also how a line that no
 * longer has anything to offer ends.
 */
/** ESCs spent getting past spoken lines before we call the puppet stuck */
const MAX_SKIPS = 600;

export async function converse(d: NavDriver, plan: TalkPlan = {}): Promise<TalkResult> {
  const wanted = [...(plan.say ?? [])];
  const otherwise = plan.otherwise ?? "stop";
  const maxTurns = plan.maxTurns ?? 40;
  const picked: number[] = [];
  const offered: string[][] = [];

  // A turn is a DECISION. Clicking past spoken lines is not a decision and must
  // not eat the budget for them — a single answer can be followed by half a dozen
  // lines, and Morrow's seven answers run to well over a hundred.
  let skips = 0;
  for (let turn = 0; turn < maxTurns; ) {
    if (!d.conversing()) {
      // Say how far it got, not just that it stopped. "ended before saying
      // 101,102,103" reads as "he never offered them", and the case that
      // actually happens is he offered and answered some and then the puppet
      // closed under us — which is a different bug and needs the counts to tell
      // apart.
      return wanted.length
        ? {
            ok: false,
            picked,
            offered,
            reason:
              `conversation ended before saying ${wanted.join(",")}` +
              ` (picked ${picked.length ? picked.join(",") : "nothing"} over ${offered.length} plaque set(s)` +
              `${offered.length ? `, last offer ${JSON.stringify(offered[offered.length - 1])}` : ""})`,
          }
        : { ok: true, picked, offered };
    }
    if (d.movieWaiting()) {
      // a movie over the conversation owns the clicks; get rid of it first
      await d.dismissMovie();
      continue;
    }
    if (!d.awaitingChoice()) {
      if (++skips > MAX_SKIPS) {
        return { ok: false, picked, offered, reason: `${MAX_SKIPS} skips and still no plaques offered` };
      }
      await d.skipLine();
      continue;
    }
    turn++;
    const choices = d.choices();
    offered.push(choices.map((c) => `${c.id}:${c.text}`));
    let idx = -1;
    if (wanted.length) idx = choices.findIndex((c) => c.id === wanted[0]);
    if (idx >= 0) {
      picked.push(wanted.shift()!);
    } else if (otherwise === "last") {
      idx = choices.length - 1;
    } else if (otherwise === "first") {
      idx = 0;
    } else {
      return {
        ok: false,
        picked,
        offered,
        reason: wanted.length
          ? `bevel ${wanted[0]} not offered; got ${choices.map((c) => c.id).join(",")}`
          : `unplanned choice: ${choices.map((c) => c.text).join(" | ")}`,
      };
    }
    if (idx < 0) return { ok: false, picked, offered, reason: "no choices to pick from" };
    if (!picked.length || picked[picked.length - 1] !== choices[idx].id) {
      // record fallback picks too, so a trace shows what was actually said
      if (idx >= 0 && (!wanted.length || choices[idx].id !== wanted[0])) picked.push(choices[idx].id);
    }
    await d.chooseBevel(idx);
  }
  return { ok: false, picked, offered, reason: `conversation did not end within ${maxTurns} turns` };
}
