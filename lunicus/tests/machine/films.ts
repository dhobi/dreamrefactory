/**
 * A film's frame waits for its sound (frame flag bit 0).
 *
 * LUNICUS.EXE's player (0x40e038) holds each frame for the larger of the film's
 * floor and the frame's own hold, in sixtieths of a second (`_portgetime` is
 * timeGetTime × 3 / 50). A frame with bit 0 of its flags is then held on
 * until both sound channels are idle (0x40e6e5 → 0x420904 → 0x420975). The
 * intro is where it shows: frame 62 starts a narration of 1153 ticks, frames
 * 62 to 79 hold 30 ticks each, and frame 79 carries the bit, so frame 80 comes
 * when the narration ends and not nine seconds early.
 *
 *   npm test -w lunicus -- films
 */
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readMovFileV0 } from "../../../engine/src/df/mov-v0";
import { playOneFilm } from "@dreamfactory/engine/v0/film";
import { Machine } from "../../src/game/machine";
import { RIP, diskFiles, fail, ok, pass, haveRip } from "./harness";

test.skipIf(!haveRip())("films", async () => {
  const m = new Machine(diskFiles(), undefined, 1994, false);
  const film = readMovFileV0(new Uint8Array(readFileSync(join(RIP, "day1/intro.mov"))));
  const narration = m.soundTicks(film.file.containers[film.frames[61].sound].data);

  // the tick each frame first came on screen
  const cameOn = new Map<number, number>();
  const co = playOneFilm(m, "intro.move", 1);
  for (let guard = 0; guard < 100_000; guard++) {
    const at = /frame (\d+) of/.exec(m.where ?? "")?.[1];
    if (at && !cameOn.has(Number(at))) cameOn.set(Number(at), m.ticks);
    if (cameOn.has(81)) break;
    if (co.next().done) break;
    m.ticks++;
  }
  const start = cameOn.get(62);
  const next = cameOn.get(80);
  if (start === undefined || next === undefined) fail(`the intro never reached frame 80: ${[...cameOn.keys()].slice(-3)}`);
  // eighteen frames of 30 ticks before the wait, and the wait itself
  const pictures = [...Array(18)].reduce((t: number, _, k) => t + Math.max(film.frames[61 + k].holdTicks, film.framerate), 0);
  if (next - start < narration) fail(`frame 80 came ${next - start} ticks after the narration began; it runs ${narration}`);
  if (next - start > narration + 2) fail(`frame 80 came ${next - start} ticks after the narration began, past its end at ${narration}`);
  ok(`intro.mov: frames 62–79 are ${pictures} ticks of pictures, and frame 80 waits for the narration: ${next - start} ticks, the sound ${narration}`);
  pass("films");
});
