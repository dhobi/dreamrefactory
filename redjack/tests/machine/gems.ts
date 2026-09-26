/**
 * The gem lifts at the skull's teeth (gem.stag, gem.shop), the player's way:
 * find the moves on paper first, then make them one click at a time.
 *
 * The puzzle, as gem.shop has it:
 *
 *   - **ten sockets**, five by Nick's lift (1–5) and five by Anne's (6–10); a
 *     lift at level L faces socket L (Nick) or L + 5 (Anne). They start
 *     `b r x g x r x g x b` (gem.stag setgems) and must end with
 *     `x b x g r x g b x r` — the x's not cared about (checkforwin).
 *   - **a click on Nick** takes the gem in his socket (`get`) and **a click on
 *     the gem he holds** puts it into an empty one (`put`). Either sends ANNE's
 *     lift up or down by the gem's colour: green 1, red 2, blue 3 levels
 *     (`sendtoprop ("Anne", elevator (…))`). A click on Anne, or on what she
 *     holds, moves NICK's lift the same way (`elevator (4|5|6)`, less 3).
 *   - **a lift** runs 1 → 5 → 1 and round again: its counter (`npos`, `apos`)
 *     goes 1..8, up while it is below 5 (`go`).
 *   - the panel's button ends the attempt (`mezzanine`), won or not.
 *
 * Nothing moves while a lift or a hand is moving, so the route waits for both
 * to stand still between clicks, and checks each click against the model.
 */
import { fail, type Headless } from "./harness";
import { findOnScreen } from "./route";

type Gem = "r" | "g" | "b" | "x";
/** what each holds: one gem of each colour at most, since each is a prop of its own (`biggem 1`–`6`) */
interface State { n: number; a: number; gems: Gem[]; nh: string; ah: string }
type Move = "nick" | "anne" | "nickput r" | "nickput g" | "nickput b" | "anneput r" | "anneput g" | "anneput b";

const START: Gem[] = ["b", "r", "x", "g", "x", "r", "x", "g", "x", "b"];
const GOAL: Gem[] = ["x", "b", "x", "g", "r", "x", "g", "b", "x", "r"];
const STEPS: Record<string, number> = { g: 1, r: 2, b: 3 };

const level = (pos: number): number => (pos <= 5 ? pos : 10 - pos);
/** a lift's counter after `k` levels (gem.shop go: wrap past 8 before each step) */
const ride = (pos: number, k: number): number => {
  for (let i = 0; i < k; i++) {
    if (pos > 8) pos = 1;
    pos++;
  }
  return pos;
};
const won = (g: Gem[]): boolean => GOAL.every((c, i) => c === "x" || g[i] === c);

function next(s: State, m: Move): State | null {
  const gems = [...s.gems];
  const [act, c] = m.split(" ") as [string, Gem | undefined];
  const nick = act.startsWith("nick");
  const i = nick ? level(s.n) - 1 : level(s.a) + 4;
  const hand = nick ? s.nh : s.ah;
  let held: string;
  let colour: Gem;
  if (act === "nick" || act === "anne") {
    // take what is in the socket; one of a colour in a hand
    colour = gems[i];
    if (colour === "x" || hand.includes(colour)) return null;
    gems[i] = "x";
    held = [...hand + colour].sort().join("");
  } else {
    colour = c!;
    if (!hand.includes(colour) || gems[i] !== "x") return null;
    gems[i] = colour;
    held = hand.replace(colour, "");
  }
  // whatever Nick does moves Anne's lift, and the other way round
  return nick
    ? { ...s, gems, nh: held, a: ride(s.a, STEPS[colour]) }
    : { ...s, gems, ah: held, n: ride(s.n, STEPS[colour]) };
}

/** the shortest run of clicks from the start to the goal, both hands empty */
export function solveGems(): Move[] {
  const key = (s: State): string => `${((s.n - 1) % 8) + 1},${((s.a - 1) % 8) + 1},${s.gems.join("")},${s.nh},${s.ah}`;
  const start: State = { n: 1, a: 1, gems: START, nh: "", ah: "" };
  const seen = new Map<string, { from: string; move: Move } | null>([[key(start), null]]);
  const states = new Map<string, State>([[key(start), start]]);
  const queue = [start];
  while (queue.length) {
    const s = queue.shift()!;
    if (won(s.gems) && !s.nh && !s.ah) {
      const path: Move[] = [];
      for (let k = key(s); seen.get(k); k = seen.get(k)!.from) path.unshift(seen.get(k)!.move);
      return path;
    }
    for (const m of ["nick", "anne", "nickput r", "nickput g", "nickput b", "anneput r", "anneput g", "anneput b"] as Move[]) {
      const t = next(s, m);
      if (!t) continue;
      const k = key(t);
      if (seen.has(k)) continue;
      seen.set(k, { from: key(s), move: m });
      states.set(k, t);
      queue.push(t);
    }
  }
  fail("the gem lifts have no solution in the model");
}

/** play the solution on the open gem stage, a click at a time; answers the clicks */
export async function playGems(h: Headless): Promise<number> {
  if (h.session.stageName !== "gem.stag") fail(`the gem lifts are not up (stage ${h.session.stageName})`);
  const props = h.session.propRuntime;
  const still = (): boolean =>
    ["nick", "anne"].every((p) => /^[1-5]$/.test(props.get(p)?.stateName ?? "")) && h.running().length === 0;
  const moves = solveGems();
  let s: State = { n: 1, a: 1, gems: START, nh: "", ah: "" };
  for (const m of moves) {
    await h.until(still, "the lifts to stand still", 2_000);
    const t = next(s, m)!;
    const [act, c] = m.split(" ");
    // what the click lands on: a lift, or the gem a hand holds (biggem 1–3 are
    // Nick's green, red and blue, 4–6 Anne's)
    const what = c ? `biggem ${STEPS[c] + (act === "anneput" ? 3 : 0)}` : act;
    const at = findOnScreen(h, what, "prop") ?? fail(`the gem lifts: "${what}" is not on screen`);
    h.click(at.x, at.y);
    await h.frame(3);
    // the last gem wins, and the stage closes on it (gem.shop wait → gemmouth.move)
    const gone = (): boolean => h.session.stageName !== "gem.stag";
    await h.until(() => still() || gone(), `the lifts after ${m}`, 2_000);
    s = t;
    if (gone()) break;
    const levels = `${props.get("nick")?.stateName},${props.get("anne")?.stateName}`;
    if (levels !== `${level(s.n)},${level(s.a)}`) fail(`the gem lifts after ${m}: at ${levels}, the model says ${level(s.n)},${level(s.a)}`);
  }
  if (!won(s.gems)) fail("the gem lifts closed before the gems were in place");
  return moves.length;
}
