/**
 * A film's captions from a puppet's lines (engine/src/runtime/session-captions.ts),
 * with a puppet built here: a movie's caption waits for the puppet to be read
 * and then walks its lines by progress; a film's bed is captioned chunk by
 * chunk by the clock, looping or not, and not at all once its handle is done;
 * and a film sound whose name the MOV's 15-character field cut short still
 * finds its line.
 *
 *   npx vitest run engine/tests/movie-captions.ts
 */
import { expect, test } from "vitest";
import { writeContainerFile } from "@dreamfactory/engine/df/container";
import { buildPupFile } from "@dreamfactory/engine/df/pup-build";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";

const PUP = writeContainerFile(buildPupFile({
  palette: [0, 0, 0, 255, 255, 255],
  dialogue: [
    { ident: "penny1.132", text: "Look at this photograph." },
    { ident: "burnscorrections", text: "Burns, correction." },
    { ident: "penny2", text: "Again." },
  ],
}).file);

function session() {
  const s = new GameSession((n) => (n.toLowerCase() === "penny.pup" ? PUP : null), new NullAudioSink());
  s.everyLineSubtitled = true;
  s.puppetParams.delete(7);
  return { s, c: s.captionCtrl };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test("a movie's caption waits for its puppet, then walks the lines by how far the film has got", async () => {
  const { c } = session();
  c.movieCaptionSources.set("zeit.mov", { puppet: "penny.pup", lines: ["Penny1.132", "nosuchline", "penny2"], who: "Penny" });
  c.movieCaptionSources.set("blank.mov", { puppet: "penny.pup", lines: ["nosuchline"] });
  expect(c.movieCaption("ZEIT.MOV", 0)).toBeNull();
  expect(c.movieCaption("zeit.mov", 0)).toBeNull(); // still reading
  expect(c.movieCaption("blank.mov", 0)).toBeNull();
  await settle();
  expect(c.movieCaption("zeit.mov", 0)).toEqual({ who: "Penny", text: "Look at this photograph." });
  expect(c.movieCaption("zeit.mov", 0.99)).toEqual({ who: "Penny", text: "Again." });
  expect(c.movieCaption("zeit.mov", 5)).toEqual({ who: "Penny", text: "Again." });
  // a film none of whose lines the puppet has stays uncaptioned
  expect(c.movieCaption("blank.mov", 0.5)).toBeNull();
});

test("a film's bed is captioned chunk by chunk, looping, and not once it has ended", async () => {
  const { s, c } = session();
  let now = 0;
  Object.defineProperty(s.clock, "now", { get: () => now });
  c.movieBedSources.set("bed.mov", { puppet: "penny.pup", chunks: ["penny2", null, "nosuch"] });
  c.captionMovieBed("silent.mov", [1], false, { done: false }); // a film with no bed of lines
  expect(c.captionLines()).toEqual([]);
  const early = { done: true };
  c.captionMovieBed("bed.mov", [1, 1, 1], true, early); // ended before the words arrived
  await settle();
  expect(c.captionLines()).toEqual([]);

  const handle = { done: false };
  c.captionMovieBed("bed.mov", [1, 1, 1], true, handle); // the words are in now
  now = 3500; // half a second into the second pass
  expect(c.captionLines()).toEqual([{ who: undefined, text: "Again." }]);
  c.captionMovieBed("bed.mov", [1, 1, 1], false, handle);
  now = 7000; // a bed that does not loop has nothing to say past its end
  expect(c.captionLines()).toEqual([]);
});

test("a film sound cut to the MOV's 15 characters still finds its line, unless the film has moved on", async () => {
  const { c } = session();
  c.movieSoundSources.set("brncl.mov", { "burns correctio": "penny.pup", burnscorrection: "penny.pup" });
  const stopped = { done: false };
  c.captionMovieSound("brncl.mov", "burnscorrection", stopped);
  stopped.done = true;
  await settle();
  expect(c.captions).toEqual([]);
  const handle = { done: false };
  c.captionMovieSound("brncl.mov", "BurnsCorrection", handle);
  expect(c.captions.map((x) => x.text)).toEqual(["Burns, correction."]);
  // a name of exactly 15 characters that no ident starts with has no words, nor has a shorter one the puppet lacks
  c.captionMovieSound("brncl.mov", "burns correctio", { done: false });
  c.movieSoundSources.set("other.mov", { nosuch: "penny.pup" });
  c.captionMovieSound("other.mov", "nosuch", { done: false });
  expect(c.captions.map((x) => x.text)).toEqual(["Burns, correction."]);
});
