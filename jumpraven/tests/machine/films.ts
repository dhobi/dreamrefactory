/**
 * A film's sounds as RAVEN.EXE plays them: a frame's or a hotspot's sound goes
 * on the two channels (0x4134db → 0x428b82), and a channel frees what it holds
 * before it takes the next (0x428536). The high scores screen's CRAFT plays
 * jet.move, whose first frame starts a narration and loops its picture; its
 * Continue, pressed while that voice speaks, jumps to frame 62 and ITS voice —
 * which speaks in the first's place, not over it.
 *
 * And every frame of every film on the disc decodes as DreamFactory 0's frame
 * decoder reads it (RAVEN.EXE 0x409557, `decodeFrame(…, "v0")`): a row byte that
 * is none of its eighteen modes is a row that draws nothing. The last three
 * frames of `shared/miss2.mov` have such rows, and come out rough; the film
 * loops from its last frame back to its third, and that one is whole again.
 *
 *   npx tsx tests/machine/films.ts        (from jumpraven/)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FrameBuffer, decodeFrame } from "@dreamfactory/engine/df/image";
import { readMovFileV0 } from "@dreamfactory/engine/df/mov-v0";
import { SCORE_BUTTONS } from "../../src/game/data";
import { RIP, fail, ok, pass, start } from "./harness";

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

// every frame of every film, as the film player decodes them
{
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  let films = 0;
  let frames = 0;
  for (const path of walk(RIP).filter((p) => /\.mov$/i.test(p))) {
    const film = readMovFileV0(new Uint8Array(readFileSync(path)));
    const fb = new FrameBuffer();
    film.frames.forEach((f, i) => {
      try {
        decodeFrame(film.file.containers[f.picture].data, fb, undefined, "v0");
      } catch (e) {
        fail(`${path.slice(RIP.length + 1)} frame ${i + 1}: ${(e as Error).message}`);
      }
      frames++;
    });
    films++;
  }
  ok(`every frame decodes: ${frames} in ${films} films`);

  const miss2 = readMovFileV0(new Uint8Array(readFileSync(join(RIP, "SHARED/MISS2.MOV"))));
  const fb = new FrameBuffer();
  const show = (i: number): Uint8Array => (decodeFrame(miss2.file.containers[miss2.frames[i].picture].data, fb, undefined, "v0"), fb.pixels.slice());
  let third: Uint8Array | null = null;
  for (let i = 0; i < miss2.frames.length; i++) {
    const px = show(i);
    if (i === 2) third = px;
  }
  const again = show(2);
  if (miss2.frames.at(-1)!.target !== 2 || String(again) !== String(third)) fail("miss2.mov's third frame is not whole again after the loop");
  ok("miss2.mov: the loop's rough frames 30 to 32, and its third frame whole again after them");
}
pass("films");
