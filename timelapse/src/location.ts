/**
 * Where you are, and which way you are looking.
 *
 * Timelapse ships no `.SET` on any of its four discs, so there is no scene and
 * view to read the way there is in Titanic — but that does not mean the position
 * is unknowable. The BOOTFILE keeps it in globals and builds every flat name out
 * of them: `framename` is `curworldchar @ frametype @ region @ "." @ frame`, so
 * `i0001.330` is world I, an ordinary view (`0`), region 001, frame 330. The
 * FRAME is both the standpoint and the facing — turning left changes it exactly
 * as walking does — which is why there is no separate bearing to report.
 *
 * The game agrees, and says so itself: its `showloc()` is
 *
 *     message ("stage " @ curstagename @ ", region " @ numtostring (curregionnum)
 *              @ ", frame " @ numtostring (curframenum))
 *
 * fired after every move when `debugging` is on. This is that, plus the exits,
 * and without turning `debugging` on — which the game also reads for its
 * developer clicks (`optionkey() & shiftkey()` opens prop scripts and a testing
 * dialog) and would change how the game plays.
 */

export const EXITS = ["forward", "back", "left", "right", "back-left", "back-right"] as const;
export const ARROWS = ["↑", "↓", "←", "→", "↙", "↘"] as const;

const esc = (s: string): string => s.replace(/[&<>]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt" }[c]};`);

/**
 * One slot of a `getframeaction` string, in words.
 *
 * The table is six space-separated words, one per direction, and the verbs are
 * the ones `transitionaction` switches on: `J` jumps to a frame, `TL`/`TR` turn
 * to one, `G` crosses to another region, `S` to another stage. `X` is the game
 * saying NO — a direction it does not offer from here, which is worth showing as
 * such rather than as a blank, because a refused key is the commonest thing to
 * mistake for a broken one. The switch compares caselessly, as the language
 * does, and e002's `s.1.1.137` is a way the game takes.
 */
export function exitText(word: string): string {
  if (!word || word === "X") return "—";
  const [verb, ...rest] = word.split(".");
  const where = rest.join(".");
  switch (verb.toUpperCase()) {
    case "J":
      return `→${where}`;
    case "TL":
      return `↺${where}`;
    case "TR":
      return `↻${where}`;
    case "G":
      return `region ${rest[0]}, frame ${rest[1] ?? "?"}`;
    case "S":
      return `stage ${where}`;
  }
  return word;
}

/** what the readout is drawn from: the BOOTFILE's globals and the session's flat */
export interface Place {
  world: string;
  stage: string;
  region: string;
  frame: string;
  flat: string;
}

/**
 * The same line a bug report carries, so an issue says where it was opened —
 * and the FLAT leads it.
 *
 * A bug report's title is the first segment of this (site/src/bug-report.ts),
 * and led by the world it read "Bug in world I" on every report this game will
 * ever produce. The flat name is the one identifier that is unique and compact:
 * `i0001.100.6` is world I, region 001, frame 100, variant 6 — which is both
 * what a triager would grep the discs for and what `tl.jump()` takes.
 */
export const bugLine = (p: Place): string =>
  `flat ${p.flat} · world ${p.world || "?"} · stage ${p.stage} · region ${p.region} · frame ${p.frame}`;

/** the readout's first line, as HTML */
export const whereHtml = (p: Place): string =>
  `<b>world ${p.world || "?"}</b>  stage ${p.stage}  region ${p.region}  <b>frame ${p.frame}</b>  <i>${esc(p.flat)}</i>`;

/** the readout's second line: the six ways and where each leads, as HTML */
export function exitsHtml(action: string): string {
  const words = action.trim().split(/\s+/);
  return EXITS.map((_, i) => `${ARROWS[i]} ${esc(exitText(words[i]))}`).join("   ");
}
