/**
 * A film's sounds as RAVEN.EXE plays them: a frame's or a hotspot's sound goes
 * on the two channels (0x4134db → 0x428b82), and a channel frees what it holds
 * before it takes the next (0x428536). The high scores screen's CRAFT plays
 * jet.move, whose first frame starts a narration and loops its picture; its
 * Continue, pressed while that voice speaks, jumps to frame 62 and ITS voice —
 * which speaks in the first's place, not over it.
 *
 *   npx tsx tests/machine/films.ts        (from jumpraven/)
 */
import { SCORE_BUTTONS } from "../../src/game/data";
import { fail, ok, pass, start } from "./harness";

/** what the speaker was told, in order, and how many one-shot sounds it holds */
const heard: string[] = [];
let sounding = 0;
const { game, m, until, click, key } = start({
  speaker: {
    play: (s) => (heard.push(`play ${s.length}`), sounding++),
    stop: () => (heard.push("stop"), (sounding = 0)),
  },
});
const skip = (): void => void ((m.film || game.talkState.talk) && m.ticks % 20 === 0 && key("Escape"));
until("the high scores screen", () => (skip(), game.phase === "scores" && game.titleUp));

const craft = SCORE_BUTTONS.find((b) => b.what === "craft")!.rect;
click((craft[1] + craft[3]) >> 1, (craft[0] + craft[2]) >> 1);
until("jet.move", () => m.film === "jet.move");
until("its first voice", () => sounding === 1 && m.soundBusy());
const before = heard.length;
// Continue, bottom left (9,344 to 119,376 in the film), while the voice speaks
click(64, 360);
until("the second voice", () => heard.slice(before).some((h) => h.startsWith("play")));
const after = heard.slice(before);
if (sounding !== 1) fail(`${sounding} voices at once after Continue: ${after.join(", ")}`);
if (after[0] !== "stop") fail(`the first voice was not stopped for the second: ${after.join(", ")}`);
ok(`jet.move's Continue in its first voice: the voice stopped, the next one alone (${m.where})`);
pass("films");
