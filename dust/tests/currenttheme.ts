/**
 * `currenttheme` asks DF.EXE two different questions (0x407b50).
 *
 *   npx vitest run dust/tests/currenttheme.ts
 *
 *   currenttheme (2)   the playing bank's own name (its header +0x9e, kept at
 *                      bank +0x16 and found by 0x407df0) — CREDITS.FLT saves it
 *                      on the way in and `playtheme`s it on the way out, and
 *                      the saloon and the gang dial it down with `themevol`
 *   currenttheme (1)   the loop CHUNK playing (0x429d10: the theme record's
 *                      +0x45) — TOWN.SET/NITE.SET only let a dog bark or an owl
 *                      call while it is "daymusic5" / "nightwind3"
 *
 * Both are "none" with no theme. Answering the bank's name to (1) kept the
 * town's ambient effects silent for good. Skipped without the rip.
 */
import { expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { decodeAudioContainer } from "@dreamfactory/engine/df/audio";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { readSndFile } from "@dreamfactory/engine/df/snd";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";

const DATA = fileURLToPath(new URL("../gamefiles/dustcd/DATA/", import.meta.url));
const noRip = !existsSync(`${DATA}TOWN.SND`);

const ask = async (s: GameSession, expr: string): Promise<unknown> => {
  const inst = s.instanceFrom(compileScript(`code go ()\n\treturn (${expr})\nendcode\n`), "t")!;
  return (await s.interp.runHandler(inst, "go", [], { me: "t", target: "" })).value;
};
const say = async (s: GameSession, line: string): Promise<void> => {
  const inst = s.instanceFrom(compileScript(`code go ()\n\t${line}\nendcode\n`), "t")!;
  await s.interp.runHandler(inst, "go", [], { me: "t", target: "" });
};

test.skipIf(noRip)("currenttheme (2) is the bank, (1) the loop chunk playing", async () => {
  const bytes = new Uint8Array(readFileSync(`${DATA}TOWN.SND`));
  const s = new GameSession(() => null, new NullAudioSink());
  s.dfVersion = 1;
  expect(s.audioLib.openBank("town.snd", bytes)).toBe(true);
  expect(await ask(s, "currenttheme (2)")).toBe("none");
  expect(await ask(s, "currenttheme (1)")).toBe("none");

  await say(s, 'playtheme ("town.snd")');
  expect(await ask(s, "currenttheme (2)")).toBe("town.snd");
  // TOWN.SND's order opens daymusic1, daymusic5, daymusic5, daymusic9, ...
  expect(await ask(s, "currenttheme (1)")).toBe("daymusic1");
  const snd = readSndFile(bytes);
  const file = readContainerFile(bytes);
  const first = snd.chunks.find((c) => c.identifier === "daymusic1")!;
  const a = decodeAudioContainer(file.containers[first.containerLoc].data);
  const secs = a.samples.length / a.sampleRate;
  s.clock.advance(s.clock.now + secs * 1000 + 50);
  expect(await ask(s, "currenttheme (1)")).toBe("daymusic5");

  await say(s, "halttheme ()");
  expect(await ask(s, "currenttheme (2)")).toBe("none");
  expect(await ask(s, "currenttheme (1)")).toBe("none");
});

test.skipIf(noRip)("the credits put back the theme they found", async () => {
  // CREDITS.FLT: `trackname = currenttheme (2)` ... `closetrackfile
  // ("credits")` and `playtheme (trackname)` — the night bank calls itself
  // "town.snd" too, and that name finds it again
  const s = new GameSession(() => null, new NullAudioSink());
  s.dfVersion = 1;
  s.audioLib.openBank("night.snd", new Uint8Array(readFileSync(`${DATA}NIGHT.SND`)));
  s.audioLib.openBank("credits.snd", new Uint8Array(readFileSync(`${DATA}CREDITS.SND`)));
  await say(s, 'playtheme ("town.snd")');
  const trackname = await ask(s, "currenttheme (2)");
  expect(trackname).toBe("town.snd");
  await say(s, 'playtheme ("credits")');
  expect(await ask(s, "currenttheme (1)")).toBe("harm 1");
  await say(s, 'closetrackfile ("credits")');
  expect(await ask(s, "currenttheme (2)")).toBe("none");
  await say(s, `playtheme ("${trackname}")`);
  expect(await ask(s, "currenttheme (1)")).toBe("nightwind3");
});
